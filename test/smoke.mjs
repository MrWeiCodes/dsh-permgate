#!/usr/bin/env node
// headless 冒烟：真加载 index.js（cordis 插件），用 mock 宿主驱动「审批 → 预览」「持久化」「迁移」三条链路。
// 与 test/regressions.mjs 的分工：regressions 是静态/纯函数断言，本文件跑的是**真实运行时路径**。
// 依赖：需要能解析 @deepseek-ai/cordis 与 @deepseek-ai/dsh-fs-local（本机 DSH 安装目录，或 npm install 装 devDependencies）。
// 用法：node test/smoke.mjs
import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve as pathResolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// 宿主提供这两个包；缺失时给出可执行的修复提示，而不是丢一个裸 ERR_MODULE_NOT_FOUND
async function loadDep(name) {
  try { return await import(name) } catch (e) {
    console.error('缺少测试依赖 ' + name + '：')
    console.error('  ' + String((e && e.message) || e))
    console.error('  请在 dsh-permgate 目录执行 npm install（devDependencies 已声明这两个包），')
    console.error('  或让 Node 能从某个已安装 DSH 的目录解析到它们。')
    process.exit(1)
  }
}
const { Context } = await loadDep('@deepseek-ai/cordis')
const { LocalFileSystem } = await loadDep('@deepseek-ai/dsh-fs-local')

const HERE = fileURLToPath(import.meta.url)
const ROOT = pathResolve(join(HERE, '..', '..'))
const fail = []
const ok = (name, cond, extra) => { if (!cond) fail.push(name + (extra ? ' — ' + extra : '')) }
const group = (t) => console.log('\n— ' + t)

// ── 工具返回值的 lossless-JSON 校验 ─────────────────────────────────────────
// DSH 0.2.0 起，dsh-tools 在工具返回后加了一道严格校验（snapshotToolValue →
// dsh-util-values 的 walkJsonValue），规则**比 JSON 本身严**：
//   · 属性值为 undefined → 整个返回值判失败（旧版只走 JSON.stringify，会静默丢弃它，
//     所以这类泄漏在升级前完全不可见 —— perm_status 就是这么在 0.2.0 上直接报
//     `tool "perm_status" returned invalid output: value is not lossless JSON` 的）；
//   · number 必须有限且不是 -0；· 对象原型必须是 plain 或 null；
//   · 数组必须 dense 且是 intrinsic Array；· 不得有 symbol 键或不可枚举自有属性；· 不得循环。
// 这里复刻同一套规则：DSH 未导出该函数（它在 dsh-util-values 内部），而本插件的测试
// 不依赖 DSH 内部包 —— 复刻的规则集一旦与上游分叉，断言会以「本该通过却失败」的形式
// 暴露出来，方向是安全的（宁可误报，不可漏报）。
function losslessViolation(value) {
  const bad = []
  const ancestors = new Set()
  const walk = (v, path) => {
    if (v === null) return
    const t = typeof v
    if (t === 'string' || t === 'boolean') return
    if (t === 'number') { if (!Number.isFinite(v) || Object.is(v, -0)) bad.push(path + ' 非法 number: ' + String(v)); return }
    if (t !== 'object') { bad.push(path + ' 非 JSON 类型 typeof=' + t); return }
    if (ancestors.has(v)) { bad.push(path + ' 循环引用'); return }
    ancestors.add(v)
    try {
      if (Array.isArray(v)) {
        if (Object.getPrototypeOf(v) !== Array.prototype) { bad.push(path + ' 数组原型非 intrinsic'); return }
        if (Reflect.ownKeys(v).length !== v.length + 1) { bad.push(path + ' 数组非 dense'); return }
        for (let i = 0; i < v.length; i++) walk(v[i], path + '[' + i + ']')
        return
      }
      const proto = Object.getPrototypeOf(v)
      if (proto !== null && proto !== Object.prototype) { bad.push(path + ' 对象原型非 plain/null'); return }
      for (const k of Reflect.ownKeys(v)) {
        if (typeof k !== 'string' || !Object.prototype.propertyIsEnumerable.call(v, k)) { bad.push(path + ' symbol 键或不可枚举属性'); continue }
        walk(v[k], path + '.' + k)
      }
    } finally { ancestors.delete(v) }
  }
  walk(value, '$')
  return bad
}

const plugin = (await import(pathToFileURL(join(ROOT, 'index.js')).href)).default

// ── 宿主 mock ────────────────────────────────────────────────
function makeReq(method, url, body, headers) {
  const req = new EventEmitter()
  req.method = method
  req.url = url
  // 不传 headers = 模拟**真实浏览器同源请求**（Host 回环 + Fetch Metadata + 同源 Origin），
  // 路由的信任栅栏要求这组头（见 index.js 的 trustRouteRequest）。
  // 传了 headers = **整组替换**，不再与默认值合并 —— 栅栏测试需要构造「完全不带
  // Sec-Fetch-*」的 curl 形态，而 Object.assign 合并是删不掉键的（早先的写法因此
  // 让「curl」用例实际带着 same-origin，栅栏看起来失效，还污染了后续用例的配置）。
  req.headers = headers !== undefined ? Object.assign({}, headers) : {
    host: '127.0.0.1:3080',
    'content-type': 'application/json',
    'sec-fetch-site': 'same-origin',
    'sec-fetch-mode': 'cors',
    origin: 'http://127.0.0.1:3080',
  }
  setImmediate(() => {
    if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body), 'utf8'))
    req.emit('end')
  })
  return req
}
function makeRes() {
  return {
    statusCode: 200, headers: {}, body: '', ended: false,
    writeHead(code, headers) { this.statusCode = code; Object.assign(this.headers, headers || {}) },
    write(s) { this.body += String(s); return true },
    end(s) { if (s !== undefined) this.body += String(s); this.ended = true; return this },
  }
}

function createHost({ workspaceRoot, dshHome, fsEncoding, connection }) {
  const registered = new Map()
  const routes = []
  const hooks = new Map()
  // 真实 fs 实现：LocalFileSystem 是 cordis 服务，必须由 cordis 上下文实例化
  const app = new Context()
  // LocalFileSystem.Config 负责填默认值（cwd / diffBasisMaxBytes），构造函数会自我注册为 ctx 服务
  const fs = new LocalFileSystem(app, LocalFileSystem.Config({ cwd: workspaceRoot }))
  const ctx = {
    fs,
    sandboxPolicy: { workspaceRoot, resolve: () => null, overrideOf: () => 'danger-full-access', setMode: () => {} },
    tools: {
      register: (def) => { registered.set(def.name, def); return () => {} },
      get: () => null,
    },
    webServer: { register: (r) => { routes.push(r); return () => {} } },
    timer: { interval: () => () => {}, setTimeout: () => () => {}, clearTimeout: () => {} },
    approval: { request: async () => 'denied' },
    permissionPresets: { permissionState: () => ({ preset: 'custom-review' }), current: () => 'custom-review', resolved: () => ({ preset: 'custom-review' }) },
    sessions: { list: () => [], get: () => null },
    effect: (fn) => { let d = null; try { d = fn && fn() } catch (e) {} return () => { try { d && d() } catch (e) {} } },
    on: (evt, fn) => { hooks.set(evt, fn); return () => {} },
    // connection 可选：传了就模拟 DSH 官方的 Host/Origin 栅栏 + 浏览器会话令牌认证
    // （真部署里由 dsh-client-connection 提供，是路由的第一层防线）。
    // 不传 = 该 service 不可用（Electron/shell 载体形态），路由退到兜底栅栏。
    get: (k) => {
      if (k === 'subprocess') return null
      if (k === 'fsEncoding') return fsEncoding
      if (k === 'connection') return connection
      return undefined
    },
  }
  process.env.DSH_HOME = dshHome
  plugin.apply(ctx)
  return { ctx, registered, routes, hooks, fs }
}

async function callRoute(routes, method, url, body, headers) {
  const entry = routes.find((r) => url.startsWith(r.path))
  if (!entry) throw new Error('no route for ' + url)
  const req = makeReq(method, url, body, headers)
  const res = makeRes()
  await entry.handler(req, res)
  const trimmed = String(res.body || '').trim()
  let parsed = null
  try { parsed = trimmed ? JSON.parse(trimmed) : null } catch (e) { parsed = null }
  return { status: res.statusCode, body: trimmed, data: parsed }
}

function makeExec(workspaceRoot, name, args, session) {
  return {
    name,
    arguments: args,
    callId: 'call-1',
    token: 'tok-1',
    agent: { cwd: workspaceRoot, session: session || { id: 'sess-1' } },
    signal: undefined,
  }
}

const workspace = mkdtempSync(join(tmpdir(), 'pg-smoke-ws-'))
const dshHome = mkdtempSync(join(tmpdir(), 'pg-smoke-home-'))
mkdirSync(join(dshHome, 'dsh-permgate'), { recursive: true })

const host = createHost({ workspaceRoot: workspace, dshHome })
group('0. 插件加载与宿主挂载')
// 9 个权限写工具已移除，现在只注册 perm_status 一个
ok('apply 只注册 perm_status（其余 perm_* 写工具已移除）',
  host.registered.size === 1 && host.registered.has('perm_status'), 'registered=' + host.registered.size + ' [' + [...host.registered.keys()].join(',') + ']')
ok('apply 注册了 /permgate 路由', host.routes.length >= 1 && host.routes[0].path === '/permgate')
ok('apply 注册了 tools/pre-execute 钩子', typeof host.hooks.get('tools/pre-execute') === 'function')

// ── 路由信任栅栏 ────────────────────────────────────────────────────────────
// 背景：webServer 不提供鉴权，故 permgate 自建栅栏。它分两层：
//   第一层（真凭据）：DSH 的 connection service 做 Host/Origin 栅栏 + 浏览器会话令牌认证。
//   第二层（兜底）：拿不到 connection 时退到请求头判据（Host 回环 + Fetch Metadata + 同源 Origin）。
// 本宿主**没有** connection service，因此下面整块测的是第二层兜底栅栏 —— 必须明确它的真实强度：
// 它**不是认证**，只防 DNS rebinding 与跨站请求。请求头由客户端完全控制，本机进程补一个
// Sec-Fetch-Site 就能通过（见下方「诚实边界」用例）。不要把它当成「挡住了 AI」的保证。
{
  // 用**独立宿主**：本块要发真实的写请求（set-category），若打在共享的 host 上，
  // 会把 edit 分类的默认值改掉，后面所有依赖「edit 默认 ask 才会弹审批」的用例
  // 都会被静默短路（group 1 的 insert 预览就是这样挂掉的）。
  const fh = createHost({
    workspaceRoot: mkdtempSync(join(tmpdir(), 'pg-fence-ws-')),
    dshHome: mkdtempSync(join(tmpdir(), 'pg-fence-home-')),
  })
  const browserHdr = { host: '127.0.0.1:3080', 'sec-fetch-site': 'same-origin', origin: 'http://127.0.0.1:3080' }
  const allow = await callRoute(fh.routes, 'GET', '/permgate/status', undefined, browserHdr)
  ok('★ 栅栏：浏览器同源请求放行', allow.status === 200 && !!(allow.data && allow.data.configPath), 'status=' + allow.status)

  // curl / pwsh：无 Fetch Metadata（不伪装的最朴素形态）
  const curl = await callRoute(fh.routes, 'GET', '/permgate/status', undefined, { host: '127.0.0.1:3080' })
  ok('★ 栅栏：无 Fetch Metadata 的请求被拒 403', curl.status === 403, 'status=' + curl.status + ' body=' + curl.body)

  // 只带 Origin 但补不上 Sec-Fetch-Site —— 仍拒
  const spoof = await callRoute(fh.routes, 'GET', '/permgate/status', undefined, { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' })
  ok('★ 栅栏：仅伪造 Origin（无 Sec-Fetch-Site）仍被拒', spoof.status === 403, 'status=' + spoof.status)

  // 恶意网页跨站：Origin 取**同源**值，使这条只能被 sec-fetch-site 判据拦下 ——
  // 若 Origin 用 evil.example，403 会由「Origin 与 Host 不同源」产生，cross-site 分支
  // 就完全没有回归保护（删掉那行测试仍全绿）。
  const cross = await callRoute(fh.routes, 'GET', '/permgate/status', undefined, { host: '127.0.0.1:3080', 'sec-fetch-site': 'cross-site', origin: 'http://127.0.0.1:3080' })
  ok('★ 栅栏：sec-fetch-site: cross-site 被拒（同源 Origin 下只能由该判据拦下）', cross.status === 403, 'status=' + cross.status)

  // 跨站且 Origin 不同源
  const liar = await callRoute(fh.routes, 'GET', '/permgate/status', undefined, { host: '127.0.0.1:3080', 'sec-fetch-site': 'same-origin', origin: 'http://evil.example' })
  ok('★ 栅栏：谎报 same-origin 但 Origin 不同源 → 拒', liar.status === 403, 'status=' + liar.status)

  // DNS rebinding：Host 是攻击者域名
  const rebind = await callRoute(fh.routes, 'GET', '/permgate/status', undefined, { host: 'evil.example', 'sec-fetch-site': 'same-origin', origin: 'http://evil.example' })
  ok('★ 栅栏：DNS rebinding（Host 非回环）被拒', rebind.status === 403, 'status=' + rebind.status)

  // 非回环局域网 IP
  const lan = await callRoute(fh.routes, 'GET', '/permgate/status', undefined, { host: '192.168.1.5:3080', 'sec-fetch-site': 'same-origin' })
  ok('★ 栅栏：非回环地址被拒', lan.status === 403, 'status=' + lan.status)

  // 无 Host 头
  const nohost = await callRoute(fh.routes, 'GET', '/permgate/status', undefined, { 'sec-fetch-site': 'same-origin' })
  ok('★ 栅栏：缺 Host 头被拒', nohost.status === 403, 'status=' + nohost.status)

  // localhost / IPv6 变体照常放行（整组替换：Origin 需与 Host 同源，故一并给出）
  const lh = await callRoute(fh.routes, 'GET', '/permgate/status', undefined, { host: 'localhost:3080', 'sec-fetch-site': 'same-origin', origin: 'http://localhost:3080' })
  ok('栅栏：localhost 变体放行', lh.status === 200, 'status=' + lh.status)
  const v6 = await callRoute(fh.routes, 'GET', '/permgate/status', undefined, { host: '[::1]:3080', 'sec-fetch-site': 'same-origin', origin: 'http://[::1]:3080' })
  ok('栅栏：IPv6 回环放行', v6.status === 200, 'status=' + v6.status)

  // authority 规范化走 WHATWG（与官方同口径），故等价写法不再互相打架：
  // Host 的默认端口可省、IPv6 可展开写，Origin 侧由浏览器序列化 —— 两边都收敛到同一 host。
  const defPort = await callRoute(fh.routes, 'GET', '/permgate/status', undefined, { host: 'localhost:80', 'sec-fetch-site': 'same-origin', origin: 'http://localhost' })
  ok('栅栏：Host 默认端口省略与 Origin 等价 → 放行（WHATWG 规范化）', defPort.status === 200, 'status=' + defPort.status)
  const v6expand = await callRoute(fh.routes, 'GET', '/permgate/status', undefined, { host: '[0:0:0:0:0:0:0:1]:3080', 'sec-fetch-site': 'same-origin', origin: 'http://[::1]:3080' })
  ok('栅栏：IPv6 展开写法与压缩写法等价 → 放行（WHATWG 规范化）', v6expand.status === 200, 'status=' + v6expand.status)
  // 不同 authority（同机不同写法）仍须拒：规范化只收敛等价形式，不把 127.0.0.1 与 localhost 视同
  const mix = await callRoute(fh.routes, 'GET', '/permgate/status', undefined, { host: 'localhost:3080', 'sec-fetch-site': 'same-origin', origin: 'http://127.0.0.1:3080' })
  ok('栅栏：Host 与 Origin 确属不同 authority → 拒', mix.status === 403, 'status=' + mix.status)

  // ★ 诚实边界：兜底栅栏挡不住有意伪造者。这条用例把真实强度钉进测试 ——
  // 本机进程（AI 走 pwsh/curl 就是这种形态）补上浏览器会带的头即可通过并写盘。
  // 真正的防线是第一层的令牌认证（connection service 可用时），不是这里。
  const forgedWrite = await callRoute(fh.routes, 'POST', '/permgate/set-category', { target: 'global', category: 'edit', mode: 'allow', lang: 'zh' }, browserHdr)
  ok('★ 诚实边界：兜底栅栏可被伪造请求头绕过（写请求返回 200）——它不是认证',
    forgedWrite.status === 200, 'status=' + forgedWrite.status + ' body=' + forgedWrite.body)
  // 既已写盘，就用它验证「栅栏确实位于所有分支之前」的另一面：合法写请求真的生效
  const stAfter = await callRoute(fh.routes, 'GET', '/permgate/status', undefined, browserHdr)
  ok('★ 兜底栅栏：合法写请求确实改到了配置（对照上一条，说明 200 是真写盘而非空转）',
    !!(stAfter.data && stAfter.data.effective && stAfter.data.effective.edit === 'allow'),
    'edit=' + (stAfter.data && stAfter.data.effective && stAfter.data.effective.edit))

  // 被拒请求不得读取 body / 不得触碰配置：先复位成 deny，再用「不带 Fetch Metadata」的写请求打，
  // 然后确认配置没被改动。注意顺序 —— 必须放在上面的合法写之后，否则前一条已把 edit 写成 allow。
  await callRoute(fh.routes, 'POST', '/permgate/set-category', { target: 'global', category: 'edit', mode: 'deny', lang: 'zh' }, browserHdr)
  const writeByPlain = await callRoute(fh.routes, 'POST', '/permgate/set-category', { target: 'global', category: 'edit', mode: 'allow', lang: 'zh' }, { host: '127.0.0.1:3080' })
  ok('★ 栅栏：无 Fetch Metadata 的写请求被拒 403', writeByPlain.status === 403, 'status=' + writeByPlain.status + ' body=' + writeByPlain.body)
  const st = await callRoute(fh.routes, 'GET', '/permgate/status', undefined, browserHdr)
  ok('★ 栅栏：被拒的写请求未改动配置（edit 仍为 deny）',
    !!(st.data && st.data.effective && st.data.effective.edit === 'deny'),
    'edit=' + (st.data && st.data.effective && st.data.effective.edit))
  // createHost 会把 process.env.DSH_HOME 设成自己那个 home（模块级全局）。本块用了独立宿主，
  // 必须在这里复位回主 host 的 home —— 否则后面所有用 `host` 的用例首次 init 时会去读
  // 本块那个临时 home（实测：主 host 的 configPath 会指向 pg-fence-home-*），
  // 属于「测试之间互相串台」，排查起来极其费时。
  process.env.DSH_HOME = dshHome
}

// ── 历史预设默认值的收敛（QUICK_DEFAULTS 变更对存量配置必须生效）────────────
// 背景：旧版 freshConfig 会把当时的 QUICK_DEFAULTS 全量 seed 落盘，而 quickAction 的优先级是
// 「项目键 → 全局键 → 预设默认 → 兜底」—— 落盘的显式值会永久压过新默认。于是 cordis_define
// 由 allow 收紧为 ask 时，存量配置里那个显式 allow 会让收紧**完全失效**（面板显示 ask、
// 实际裁决 allow，且此后每次 persist 都把 allow 固化）。这里钉住收敛行为：
// 仅当「值恰好等于历史默认」且「当前默认已不同」时才丢弃该键，让新默认接管。
{
  const ws = mkdtempSync(join(tmpdir(), 'pg-retired-ws-'))
  const home = mkdtempSync(join(tmpdir(), 'pg-retired-home-'))
  mkdirSync(join(home, 'dsh-permgate'), { recursive: true })
  // 存量配置：cordis_define 显式 allow（旧默认）、cordis_run 显式 deny（用户改过的值，不得动）、
  // 以及一个用户手填的自定义工具名（同样不得动）
  const legacy = {
    global: {
      quickTools: {
        cordis_define: { action: 'allow' },
        cordis_run: { action: 'deny' },
        my_custom_tool: { action: 'allow' },
      },
      custom: [], sandboxMode: 'danger-full-access', fallbackMode: 'ask',
    },
    projects: {},
  }
  writeFileSync(join(home, 'dsh-permgate', 'config.json'), JSON.stringify(legacy, null, 2))
  const h = createHost({ workspaceRoot: ws, dshHome: home })
  const pre = h.hooks.get('tools/pre-execute')
  const probe = async (name) => {
    let nexted = false
    const exec = makeExec(ws, name, {}, { id: 'sess-1' })
    const p = pre(exec, () => { nexted = true })
    await Promise.race([Promise.resolve(p).catch(() => {}), new Promise((r) => setTimeout(r, 1500))])
    return nexted
  }
  // 收敛发生在 load 期，先触一次路由让配置加载完成
  await callRoute(h.routes, 'GET', '/permgate/status', undefined, { host: '127.0.0.1:3080', 'sec-fetch-site': 'same-origin', origin: 'http://127.0.0.1:3080' })

  ok('★ 收敛：存量配置的 cordis_define=allow 被丢弃，回落新默认 ask（不再静默放行）',
    (await probe('cordis_define')) === false)
  ok('★ 收敛：用户改过的值不受影响（cordis_run 仍按其显式 deny 裁决）',
    (await probe('cordis_run')) === false)
  ok('★ 收敛：手填的自定义工具名不被清理（my_custom_tool 仍按显式 allow 放行）',
    (await probe('my_custom_tool')) === true)
  // 收敛必须落盘：否则每次加载都要重算，面板行仍来自磁盘旧值
  const savedCfg = JSON.parse(readFileSync(join(home, 'dsh-permgate', 'config.json'), 'utf8'))
  ok('★ 收敛：结果已落盘（磁盘上不再有 cordis_define 的显式 allow）',
    !(savedCfg.global.quickTools && savedCfg.global.quickTools.cordis_define),
    JSON.stringify(savedCfg.global.quickTools))
  ok('★ 收敛：落盘内容不含内部计数字段（retiredQuickDefaults 不得写进配置）',
    savedCfg.retiredQuickDefaults === undefined && Object.keys(savedCfg).sort().join(',') === 'global,migrations,projects',
    Object.keys(savedCfg).join(','))
  ok('★ 收敛：落盘写入迁移名单（供后续加载判断该迁移是否已跑过）',
    Array.isArray(savedCfg.migrations) && savedCfg.migrations.indexOf('retire-quick-defaults-cordis_define') !== -1,
    JSON.stringify(savedCfg.migrations))

  // ★ 收敛必须**只跑一次**：用户升级后完全可能主动把 cordis_define 设回 allow，那是他的明确意图。
  // 若判据只看「值是否等于历史默认」，每次加载都会把这次显式设置再删一遍 ——
  // 表现为「用户改完、一重新加载就被静默回滚」，比不收敛更糟。故用迁移名单钉住。
  await callRoute(h.routes, 'POST', '/permgate/set-quick', { target: 'global', tool: 'cordis_define', action: 'allow', lang: 'zh' })
  const afterSet = JSON.parse(readFileSync(join(home, 'dsh-permgate', 'config.json'), 'utf8'))
  ok('★ 一次性：用户显式设回 allow 能正常落盘',
    !!(afterSet.global.quickTools && afterSet.global.quickTools.cordis_define && afterSet.global.quickTools.cordis_define.action === 'allow'),
    JSON.stringify(afterSet.global.quickTools && afterSet.global.quickTools.cordis_define))
  await callRoute(h.routes, 'POST', '/permgate/reload', { lang: 'zh' })
  const afterReload = JSON.parse(readFileSync(join(home, 'dsh-permgate', 'config.json'), 'utf8'))
  ok('★★ 一次性：重新加载后该显式 allow 不被静默回滚（收敛已跑过就不再动它）',
    !!(afterReload.global.quickTools && afterReload.global.quickTools.cordis_define && afterReload.global.quickTools.cordis_define.action === 'allow'),
    JSON.stringify(afterReload.global.quickTools && afterReload.global.quickTools.cordis_define))

  // ★ 闸门必须按**迁移 ID** 判定，而不是全局版本号：否则将来为别的迁移升版本时，
  // 本条会被判为「未跑过」而重新执行，把用户的显式 allow 再删一次（已实测复现）。
  // 这里直接在磁盘配置里追加一个「别的迁移」的名单项，模拟那种升级，再加载一次。
  const other = JSON.parse(readFileSync(join(home, 'dsh-permgate', 'config.json'), 'utf8'))
  other.migrations = (other.migrations || []).concat(['some-future-migration'])
  writeFileSync(join(home, 'dsh-permgate', 'config.json'), JSON.stringify(other, null, 2))
  await callRoute(h.routes, 'POST', '/permgate/reload', { lang: 'zh' })
  const afterFuture = JSON.parse(readFileSync(join(home, 'dsh-permgate', 'config.json'), 'utf8'))
  ok('★★ 一次性：新增别的迁移名单项后，用户的显式 allow 仍不被回滚（按 ID 判定，不牵连）',
    !!(afterFuture.global.quickTools && afterFuture.global.quickTools.cordis_define && afterFuture.global.quickTools.cordis_define.action === 'allow'),
    JSON.stringify(afterFuture.global.quickTools && afterFuture.global.quickTools.cordis_define))
  ok('★ 一次性：原有迁移名单项不被覆盖丢弃（只补不删）',
    Array.isArray(afterFuture.migrations) && afterFuture.migrations.indexOf('some-future-migration') !== -1 &&
    afterFuture.migrations.indexOf('retire-quick-defaults-cordis_define') !== -1,
    JSON.stringify(afterFuture.migrations))

  // ★ 名单必须在**首次加载**时就落盘，而不是等用户后续某次写操作顺带补上。
  // 否则「加载 → 用户把 cordis_define 设为 allow → 再次加载」这条链上，第二次加载时
  // 名单仍为空 → 该显式 allow 会被当成待收敛值删掉。上面各用例都带写操作，
  // 写操作会顺带落盘而掩盖这个缺陷，故这里用「只加载、不写任何东西」的干净场景单独钉住。
  {
    const ws2 = mkdtempSync(join(tmpdir(), 'pg-gate-ws-'))
    const home2 = mkdtempSync(join(tmpdir(), 'pg-gate-home-'))
    mkdirSync(join(home2, 'dsh-permgate'), { recursive: true })
    // 配置里该键已是新默认 ask（无需收敛），但 migrations 名单为空 —— 升级后的真实形态
    writeFileSync(join(home2, 'dsh-permgate', 'config.json'), JSON.stringify({
      global: { quickTools: { cordis_define: { action: 'ask' } }, custom: [], sandboxMode: 'danger-full-access', fallbackMode: 'ask' },
      projects: {},
    }, null, 2))
    const h2 = createHost({ workspaceRoot: ws2, dshHome: home2 })
    await callRoute(h2.routes, 'GET', '/permgate/status', undefined, { host: '127.0.0.1:3080', 'sec-fetch-site': 'same-origin', origin: 'http://127.0.0.1:3080' })
    const g = JSON.parse(readFileSync(join(home2, 'dsh-permgate', 'config.json'), 'utf8'))
    ok('★★ 一次性：首次加载（无任何写操作）就把迁移名单落盘，不必等后续写操作顺带补',
      Array.isArray(g.migrations) && g.migrations.indexOf('retire-quick-defaults-cordis_define') !== -1,
      JSON.stringify(g.migrations))
    process.env.DSH_HOME = dshHome
  }
  // 同栅栏块：本块也用了独立宿主，收尾时把 DSH_HOME 复位回主 host 的 home，避免测试串台
  process.env.DSH_HOME = dshHome
}

// ── 第一层：官方 connection service 的令牌认证（真正的防线）────────────────────
// 上面那块测的是「拿不到 connection 时的兜底栅栏」，而兜底栅栏可被伪造请求头绕过。
// 真部署里 dsh-client-connection 一定在（web GUI 靠它承载 /api），所以真正拦住
// 「AI 用 pwsh 自行调路由改权限」的是这一层：Host/Origin 栅栏 + HttpOnly 会话 cookie。
// 这里用与官方 requestRejection 同构的桩验证路由**确实**把它当第一判据，
// 且不再退回兜底（否则伪造头又能写盘，等于修复失效）。
{
  const fh = createHost({
    workspaceRoot: mkdtempSync(join(tmpdir(), 'pg-conn-ws-')),
    dshHome: mkdtempSync(join(tmpdir(), 'pg-conn-home-')),
    // 桩：与官方 requestRejection 同构 —— 非回环 Host 或 cross-site → 403；
    // 有 Host 但无有效会话 cookie → 401；两者都过 → undefined（放行）
    connection: {
      requestRejection: ({ headers }) => {
        const h = headers || {}
        const host = String(h.host || '')
        if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host)) return 403
        if (h['sec-fetch-site'] === 'cross-site') return 403
        return (h.cookie && String(h.cookie).indexOf('dsh-auth-') !== -1) ? undefined : 401
      },
    },
  })
  const hdr = { host: '127.0.0.1:3080', 'sec-fetch-site': 'same-origin', origin: 'http://127.0.0.1:3080' }
  const authed = Object.assign({}, hdr, { cookie: 'dsh-auth-abc=xyz' })

  // 带凭据的浏览器照常可用（不能把合法调用方挡掉）
  const okStatus = await callRoute(fh.routes, 'GET', '/permgate/status', undefined, authed)
  ok('★ 第一层：带会话凭据的浏览器放行', okStatus.status === 200 && !!(okStatus.data && okStatus.data.configPath), 'status=' + okStatus.status)

  // ★ 核心：伪造全部浏览器头但无凭据 —— 兜底栅栏会放行，第一层必须拦下
  const forged = await callRoute(fh.routes, 'GET', '/permgate/status', undefined, hdr)
  ok('★★ 第一层：伪造浏览器头但无凭据 → 401（兜底栅栏挡不住的那种请求）',
    forged.status === 401, 'status=' + forged.status + ' body=' + forged.body)
  ok('★ 第一层：401 带可识别 code（客户端据此提示重新认证，而不是渲染假配置）',
    !!(forged.data && forged.data.code === 'unauthenticated'), JSON.stringify(forged.data))

  // 写路由同样拦下：这是「移除 perm_* 工具的安全收益」的真正保障
  const forgedWrite = await callRoute(fh.routes, 'POST', '/permgate/set-category',
    { target: 'global', category: 'command', mode: 'allow', lang: 'zh' }, hdr)
  ok('★★ 第一层：无凭据的写请求被拦（不再能改权限配置）', forgedWrite.status === 401, 'status=' + forgedWrite.status)
  const stAfter = await callRoute(fh.routes, 'GET', '/permgate/status', undefined, authed)
  ok('★ 第一层：被拒的写请求未改动配置（command 仍为 ask）',
    !!(stAfter.data && stAfter.data.effective && stAfter.data.effective.command !== 'allow'),
    'command=' + (stAfter.data && stAfter.data.effective && stAfter.data.effective.command))

  // Host/Origin 栅栏仍生效（403 与 401 语义区分：来源不可信 vs 缺凭据）
  const badHost = await callRoute(fh.routes, 'GET', '/permgate/status', undefined, { host: 'evil.example', 'sec-fetch-site': 'same-origin' })
  ok('★ 第一层：非回环 Host → 403（与缺凭据的 401 区分）', badHost.status === 403, 'status=' + badHost.status)
  const crossSite = await callRoute(fh.routes, 'GET', '/permgate/status', undefined, { host: '127.0.0.1:3080', 'sec-fetch-site': 'cross-site', cookie: 'dsh-auth-abc=xyz' })
  ok('★ 第一层：cross-site → 403（即便带凭据）', crossSite.status === 403, 'status=' + crossSite.status)
  process.env.DSH_HOME = dshHome
}

// 模拟「内置 str_replace_editor」的工具定义，供内核探测
host.ctx.tools.get = (name) => {
  if (name !== 'str_replace_editor') return null
  return {
    description: 'Custom editing tool for viewing, creating and editing files',
    parameters: {
      type: 'object',
      properties: {
        command: { description: 'The commands to run. Allowed options are: view, create, str_replace, insert.' },
        insert_line: { description: 'Required integer parameter of `insert` command. The `new_str` will be inserted AFTER the line `insert_line` of `path`.' },
      },
    },
  }
}

const pre = host.hooks.get('tools/pre-execute')

// 任何一步挂起都要显式暴露，否则 harness 会静默停在 unsettled top-level await
function withTimeout(p, label, ms = 2000) {
  let timer = null
  const guard = new Promise((r) => {
    timer = setTimeout(() => { console.log('  TIMEOUT: ' + label); r(null) }, ms)
  })
  const raced = Promise.race([
    Promise.resolve(p).catch((e) => ({ error: String((e && e.message) || e) })),
    guard,
  ])
  // race 已分出胜负时必须清掉守卫定时器，否则进程退出前会补打无意义的 TIMEOUT
  return raced.finally(() => clearTimeout(timer))
}
// 残留清理：runApproval 的早退路径（本次审批还没出现）不会 decide，会把审批留在表里。
// 之后每个用例取到的都是「上一次那条」，把上一份 diff 当成自己的，连环错位。
// 只服务模块级 host：probe18/freshUndo 各自新建 host、pendingApprovals 独立，不需要清理。
async function drainPending() {
  const p = await callRoute(host.routes, 'GET', '/permgate/pending')
  const list = Array.isArray(p.data) ? p.data : ((p.data && p.data.pending) || [])
  for (const x of list) {
    await callRoute(host.routes, 'POST', '/permgate/decide', { id: x.id, action: 'deny', lang: 'zh' })
  }
}

// 等「本次」审批出现：轮询 + 按工具名取最后一个（pendingApprovals 是 Map、按插入序，本次的排在最末）。
// 固定 sleep(30) 在机器繁忙时不够：一旦没等到就早退，调用方会把「本该 ask」读成 allow/deny，
// 后续用例还会全部错位一格（实测会连环失败）。故等待逻辑只此一份，各用例共用。
//
// 两个退出条件，缺一不可：
//   ① 该工具名的审批出现在 pending 里 → 返回它（调用方按 ask 处理）；
//   ② hook 已落定（done.value）→ 返回 null：放行/拒绝已经发生，不会再冒出审批了。
// 只有 ① 时，「期望不弹窗」的用例（放行与拒绝）每例都要空转满 40×25ms —— 实测 6 例约 6 秒纯等待。
// 先查一次再睡：命中时不必白等一个轮询间隔。
// h 缺省用模块级 host；probe18/freshUndo 各自新建 host，须显式传入。
async function awaitPending(name, done, h) {
  const hh = h || host
  for (let i = 0; i < 40; i++) {
    const p = await callRoute(hh.routes, 'GET', '/permgate/pending')
    const list = Array.isArray(p.data) ? p.data : ((p.data && p.data.pending) || [])
    const mine = list.filter((x) => x.tool === name)
    if (mine.length) return mine[mine.length - 1]
    if (done && done.value) return null
    await new Promise((r) => setTimeout(r, 25))
  }
  return null
}

// hook 落定标记：resolve 与 reject 都要置位，否则失败路径会白等满轮询上限。
// 用 then(mark, mark) 而非 finally —— 后者会把 rejection 再抛一次，需要额外的 catch 兜。
function settleFlag() {
  const done = { value: false }
  const mark = () => { done.value = true }
  return { done, mark }
}

async function runApproval(name, args, fileText, fileName) {
  await drainPending()
  if (fileText !== undefined) writeFileSync(join(workspace, fileName || 'a.txt'), fileText, 'utf8')
  const exec = makeExec(workspace, name, args)
  const { done, mark } = settleFlag()
  const pending = pre(exec, async () => ({ kind: 'allow' }))
  pending.then(mark, mark)
  const item = await awaitPending(name, done)
  if (!item) return { id: null, pending, decided: null, diff: null }
  const diff = await withTimeout(callRoute(host.routes, 'POST', '/permgate/file-diff', { id: item.id, lang: 'zh' }), 'file-diff')
  const decided = await withTimeout(callRoute(host.routes, 'POST', '/permgate/decide', { id: item.id, action: 'deny', lang: 'zh' }), 'decide')
  const outcome = await withTimeout(pending, 'pre-execute settle')
  return { id: item.id, diff, decided, outcome }
}

// ─────────────────────────────────────────────────────────────
group('1. insert 预览（覆盖 overMaxChars / previewInsert / windowedDiffPayload）')
{
  const r = await runApproval('str_replace_editor', { command: 'insert', path: 'a.txt', insert_line: 2, new_str: 'X' }, 'L1\nL2\nL3\n')
  ok('发起审批并拿到 pending id', !!r.id)
  ok('file-diff 返回 ok:true（overMaxChars 不再抛 ReferenceError）', !!(r.diff && r.diff.data && r.diff.data.ok === true), JSON.stringify(r.diff && r.diff.data && r.diff.data.error))
  const ops = (r.diff && r.diff.data && r.diff.data.ops) || []
  const added = ops.filter((o) => o.t === 'a')
  ok('insert 预览含新增行', added.length === 1 && added[0].s === 'X', JSON.stringify(added))
  ok('新增行行号 = 3（内置 0 基，插到第 2 行之后）', added[0] && added[0].n === 3, 'n=' + (added[0] && added[0].n))
  ok('decide 正常返回', !!(r.decided && r.decided.data && r.decided.data.ok === true))
  ok('审批结果为拒绝', r.outcome && r.outcome.kind === 'deny', JSON.stringify(r.outcome))
}

// ─────────────────────────────────────────────────────────────
group('2. str_replace 唯一性（old_str 重复 → 提示将失败，不画假 diff）')
{
  const r = await runApproval('str_replace_editor', { command: 'str_replace', path: 'dup.txt', old_str: 'same', new_str: 'Y' }, 'same\nsame\n', 'dup.txt')
  ok('file-diff 返回 ok:false', !!(r.diff && r.diff.data && r.diff.data.ok === false))
  const err = r.diff && r.diff.data && r.diff.data.error
  ok('提示 old_str 多次出现', /出现多次|occurs multiple/.test(JSON.stringify(err || '')), JSON.stringify(err))
}

// ─────────────────────────────────────────────────────────────
group('3. view + view_range（end=-1 到文件尾）')
{
  // view 属于 read 分类，默认放行；先改成 ask 才能走审批链路（顺带验证 set-category 路由可写配置）
  const setRead = await callRoute(host.routes, 'POST', '/permgate/set-category', { target: 'project', category: 'read', mode: 'ask', lang: 'zh', sessionId: 'sess-1' })
  ok('set-category read=ask 成功', !!(setRead.data && !setRead.data.error), JSON.stringify(setRead.data && setRead.data.error))
  const ten = Array.from({ length: 10 }, (_, i) => 'R' + (i + 1)).join('\n') + '\n'
  const r = await runApproval('str_replace_editor', { command: 'view', path: 'view.txt', view_range: [3, -1] }, ten, 'view.txt')
  const d = r.diff && r.diff.data
  // 说明：view 预览带前后各 200 行上下文窗口，故短文件的 startLine 恒为 1，不能断言为 3
  ok('view 预览返回 ok:true', !!(d && d.ok === true), JSON.stringify(d && d.error))
  // view_range 非法（end < start）必须提示失败，而不是画出与实际读取不符的假窗口
  const bad = await runApproval('str_replace_editor', { command: 'view', path: 'view.txt', view_range: [5, 2] }, ten, 'view.txt')
  const bd = bad.diff && bad.diff.data
  ok('非法 view_range 返回 ok:false', !!(bd && bd.ok === false), JSON.stringify(bd))
  ok('提示 view_range 不合法', /view_range/.test(JSON.stringify((bd && bd.error) || '')), JSON.stringify(bd && bd.error))
  ok('包含 R3 与 R10（到文件尾）', !!(d && /R3/.test(d.text || '') && /R10/.test(d.text || '')), (d && d.text || '').slice(0, 60))
}

// ─────────────────────────────────────────────────────────────
group('4. 全新 home 的配置迁移 + 持久化（只迁当前工作区 key，global 被忽略）')
{
  // 迁移只在 home 配置不存在时发生，故必须用一个干净的 home（前面的 set-category 已经写过配置）
  const ws2 = mkdtempSync(join(tmpdir(), 'pg-smoke-ws2-'))
  const home2 = mkdtempSync(join(tmpdir(), 'pg-smoke-home2-'))
  mkdirSync(join(home2, 'dsh-permgate'), { recursive: true })
  const host2 = createHost({ workspaceRoot: ws2, dshHome: home2 })
  mkdirSync(join(ws2, '.dsh'), { recursive: true })
  const residual = join(ws2, '.dsh', '.permgate.json')
  writeFileSync(residual, JSON.stringify({
    global: { fallbackMode: 'allow', directory: { mode: 'allow' } },
    projects: { [ws2]: { fallbackMode: 'ask' }, 'B:/other-project': { fallbackMode: 'allow' } },
  }, null, 2), 'utf8')

  const status = host2.registered.get('perm_status')
  ok('perm_status 工具已注册', !!status && typeof status.execute === 'function')
  const view = await status.execute({}, makeExec(ws2, 'perm_status', {}))
  ok('perm_status 返回 status 视图', !!(view && view.configPath))
  // ★ 工具返回值必须过 DSH 的 lossless-JSON 校验（0.2.0 起收紧）
  // 反例：commandSubSetting 里 `reason: undefined`（键在、值为 undefined）—— 升级后
  // perm_status 整个报错。这条断言就是那次缺陷的回归闸：任何新增的 undefined 属性值、
  // -0、非 plain 原型或稀疏数组都会在这里被点名到具体路径。
  const lv = losslessViolation(view)
  ok('★ perm_status 返回值满足 DSH 的 lossless-JSON 校验', lv.length === 0, lv.join(' | '))

  // ★★ 八档体系新增字段的 lossless 复算（§7.3）：`commandSub` 从「一个动作 + 一个理由」
  // 扩成「八档 + reasons + source + groups」，新增字段每一个都可能引入 undefined ——
  // 而那正是上一轮让 perm_status 整个报错的原因（键在、值为 undefined）。
  // 这里**逐个配置态**复算：八档的每种取值组合都会走到不同的赋值分支，
  // 只测一个态覆盖不到「deny 但没写理由」「项目层只设了一档」这些形态。
  {
    const tierCases = [
      ['全默认（无 command 块）', { global: { fallbackMode: 'ask' }, projects: {} }],
      ['mode=allow 无 destructive 键', { global: { fallbackMode: 'ask', command: { mode: 'allow', exceptions: [] } }, projects: {} }],
      ['mode=deny 无 destructive 键', { global: { fallbackMode: 'ask', command: { mode: 'deny' } }, projects: {} }],
      // ↓ 上一轮咬人的那个形态：deny 但**没有理由**（键不能存在，值更不能是 undefined）
      ['存量 deny 无 reason（上一轮的雷区）', { global: { fallbackMode: 'ask', command: { mode: 'allow', destructive: { action: 'deny' } } }, projects: {} }],
      ['存量 deny 有 reason', { global: { fallbackMode: 'ask', command: { mode: 'allow', destructive: { action: 'deny', reason: 'rm 危险' } } }, projects: {} }],
      ['八档全显式 + per-tier reason', {
        global: { fallbackMode: 'ask', command: { mode: 'allow', destructive: { action: 'allow', outside: 'ask', wide: 'deny', unknown: 'ask', proc: 'ask', power: 'ask', priv: 'deny', reg: 'ask', reasons: { wide: '删系统目录', priv: '别提权' } } } }, projects: {},
      }],
      ['八档全 deny（无任何 reason）', {
        global: { fallbackMode: 'ask', command: { mode: 'deny', destructive: { action: 'deny', outside: 'deny', wide: 'deny', unknown: 'deny', proc: 'deny', power: 'deny', priv: 'deny', reg: 'deny' } } }, projects: {},
      }],
      ['老格式 off', { global: { mode: 'off' }, projects: {} }],
      ['老格式 locked', { global: { mode: 'locked' }, projects: {} }],
    ]
    const tierBad = []
    for (const [label, cfg] of tierCases) {
      const wsT2 = mkdtempSync(join(tmpdir(), 'pg-ll-ws-'))
      const homeT2 = mkdtempSync(join(tmpdir(), 'pg-ll-home-'))
      mkdirSync(join(homeT2, 'dsh-permgate'), { recursive: true })
      writeFileSync(join(homeT2, 'dsh-permgate', 'config.json'), JSON.stringify(cfg, null, 2), 'utf8')
      const hT2 = createHost({ workspaceRoot: wsT2, dshHome: homeT2 })
      const stT2 = hT2.registered.get('perm_status')
      const viewT2 = await stT2.execute({}, makeExec(wsT2, 'perm_status', {}))
      const bad = losslessViolation(viewT2)
      // 顺带确认八档确实被下发（否则这条断言可能因为字段整个缺失而空转）
      const csT2 = viewT2 && viewT2.commandSub
      if (!csT2 || !Array.isArray(csT2.tiers) || csT2.tiers.length !== 8
        || !csT2.effective || typeof csT2.effective.inside !== 'string') {
        bad.push('commandSub 八档未完整下发: ' + JSON.stringify(csT2 && Object.keys(csT2)))
      }
      if (bad.length) tierBad.push(label + ' → ' + bad.join(' | '))
      try { rmSync(wsT2, { recursive: true, force: true }); rmSync(homeT2, { recursive: true, force: true }) } catch (e) {}
    }
    ok('★★ perm_status 在九种配置态下都满足 lossless-JSON（含「deny 无理由」这个上一轮的雷区）',
      tierBad.length === 0, JSON.stringify(tierBad))
  }

  const homeCfg = join(home2, 'dsh-permgate', 'config.json')
  ok('home 配置文件已生成', existsSync(homeCfg))
  let parsed = null
  try { parsed = JSON.parse(readFileSync(homeCfg, 'utf8')) } catch (e) {}
  ok('home 配置可解析', !!parsed)
  // 插件内部对路径统一归一化（分隔符/大小写），断言同样归一化后再比较
  const normKey = (s) => String(s).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const keys = parsed && parsed.projects ? Object.keys(parsed.projects) : []
  ok('只迁入当前工作区的 project key', keys.length === 1 && normKey(keys[0]) === normKey(ws2), JSON.stringify(keys))
  ok('global 未被工作区文件采纳（fallbackMode 不是 allow）', !!(parsed && parsed.global && parsed.global.fallbackMode !== 'allow'), parsed && parsed.global && parsed.global.fallbackMode)
  ok('迁移成功后源文件被删除', !existsSync(residual))

  // 权限写工具已整体移除，改用设置页路由（同一写入单点、同一持久化路径）
  const saved = await callRoute(host2.routes, 'POST', '/permgate/set-category', { target: 'global', category: 'edit', mode: 'deny' })
  ok('set-category 返回 status', !!(saved && saved.data && saved.data.configPath))
  let parsed2 = null
  try { parsed2 = JSON.parse(readFileSync(homeCfg, 'utf8')) } catch (e) {}
  ok('保存后 home 配置写入 edit=deny', !!(parsed2 && parsed2.global && parsed2.global.edit && parsed2.global.edit.mode === 'deny'), JSON.stringify(parsed2 && parsed2.global && parsed2.global.edit))

  try { rmSync(ws2, { recursive: true, force: true }); rmSync(home2, { recursive: true, force: true }) } catch (e) {}
}

// ─────────────────────────────────────────────────────────────
group('5. 快捷工具：预设默认值参与裁决、显式配置优先、删除键回退、status 契约')
{
  // 用干净 home 写一份「老配置代际」：quickTools 只有旧 5 键，其余预设键缺席；
  // 并故意混入 1.5.x 时代落盘的、已移除的权限写工具键（含一条 allow，用于验证清理与 fail-open 防线）
  const ws3 = mkdtempSync(join(tmpdir(), 'pg-smoke-ws3-'))
  const home3 = mkdtempSync(join(tmpdir(), 'pg-smoke-home3-'))
  mkdirSync(join(home3, 'dsh-permgate'), { recursive: true })
  writeFileSync(join(home3, 'dsh-permgate', 'config.json'), JSON.stringify({
    global: {
      quickTools: {
        web_search: 'ask', skill: 'allow', grep: 'allow', glob: 'allow', web_fetch: 'ask',
        perm_add_exception: { action: 'allow' }, perm_set_category: { action: 'allow' }, perm_reload: { action: 'deny' },
        my_custom_tool: { action: 'deny' },
      },
      fallbackMode: 'ask',
    },
    projects: {},
  }, null, 2), 'utf8')
  const host3 = createHost({ workspaceRoot: ws3, dshHome: home3 })
  const pre3 = host3.hooks.get('tools/pre-execute')
  ok('group5: tools/pre-execute 钩子已注册', typeof pre3 === 'function')

  // 探测某个工具调用是否被直接放行（next 被调用）；未放行说明走了审批/拒绝
  const probe = async (name) => {
    let nexted = false
    const pending = pre3(makeExec(ws3, name, {}), async () => { nexted = true; return { kind: 'allow' } })
    pending.catch(() => {})
    const out = await Promise.race([pending, new Promise((r) => setTimeout(() => r(null), 300))])
    return { nexted, out }
  }

  const r1 = await probe('job_kill')
  ok('group5: 配置里缺席的预设键按默认值放行（job_kill）', r1.nexted === true, JSON.stringify(r1.out))
  const r2 = await probe('mcp__not-a-preset')
  ok('group5: 非预设键仍走兜底、未被放行（mcp__*）', r2.nexted === false, JSON.stringify(r2.out))

  // 权限写工具已移除，改用设置页路由写入
  const sq = await callRoute(host3.routes, 'POST', '/permgate/set-quick', { target: 'global', tool: 'job_kill', action: 'deny' })
  ok('group5: set-quick 路由写入成功', !!(sq && sq.data && sq.data.quickTools))
  const r3 = await probe('job_kill')
  ok('group5: 显式 deny 优先于预设默认值', r3.nexted === false, JSON.stringify(r3.out))

  // 面板「删除」按钮走的就是 action=inherit
  const del = await callRoute(host3.routes, 'POST', '/permgate/set-quick', { target: 'global', tool: 'job_kill', action: 'inherit' })
  const gAfter = (del.data && del.data.quickTools && del.data.quickTools.global) || {}
  ok('group5: set-quick inherit 删除了该键', !Object.prototype.hasOwnProperty.call(gAfter, 'job_kill'), JSON.stringify(gAfter))
  const r4 = await probe('job_kill')
  ok('group5: 删除键后回退到预设默认值（放行）', r4.nexted === true, JSON.stringify(r4.out))

  const st = await callRoute(host3.routes, 'GET', '/permgate/status')
  const presetList = (st.data && st.data.quickPreset) || []
  const defaults = (st.data && st.data.quickDefaults) || {}
  // 35 → 26：9 个权限写工具已移除（22 常规 + perm_status + cordis_run/stop/undefine）
  ok('group5: status 下发 quickPreset（26 项：22 常规 + perm_status + cordis_run/stop/undefine）', presetList.length === 26, 'len=' + presetList.length)
  ok('group5: quickPreset 与 quickDefaults 键一致', presetList.length > 0 && presetList.every((t) => Object.prototype.hasOwnProperty.call(defaults, t)), JSON.stringify(presetList.filter((t) => !Object.prototype.hasOwnProperty.call(defaults, t))))
  // 9 个权限写工具已移除：它们既不该在预设清单里，也不再是可调用的工具
  const permWrites = presetList.filter((t) => /^perm_/.test(t) && t !== 'perm_status')
  ok('★ group5: 预设清单不含任何 perm_ 写工具', permWrites.length === 0, JSON.stringify(permWrites))
  ok('★ group5: 预设清单保留 perm_status', presetList.indexOf('perm_status') !== -1)
  // perm_status 是只读查询，默认放行（想看随时能看）
  const rp1 = await probe('perm_status')
  ok('group5: perm_status 默认放行（只读）', rp1.nexted === true, JSON.stringify(rp1.out))
  const rp3 = await probe('cordis_run')
  ok('group5: cordis_run 默认不被静默放行', rp3.nexted === false, JSON.stringify(rp3.out))

  // 老配置残留的已移除写工具键：必须在加载时被丢弃（否则设置页出现无说明的孤儿行，
  // 且残留的 allow 会在将来同名工具复活时绕过 QUICK_DEFAULTS 的 ask —— issue #3 老路）
  const gq = (st.data && st.data.quickTools && st.data.quickTools.global) || {}
  const leftovers = Object.keys(gq).filter((t) => /^perm_/.test(t) && t !== 'perm_status')
  ok('★ group5: 残留的写工具快捷键已被清理（不下发到面板）', leftovers.length === 0, JSON.stringify(leftovers))
  // 精确名单式清理：用户手填的自定义工具名必须保留（不能一刀切删未知键）
  ok('★ group5: 用户自定义工具键未被误删', Object.prototype.hasOwnProperty.call(gq, 'my_custom_tool'), JSON.stringify(Object.keys(gq)))
  // 即便残留 allow 曾写进配置，同名调用也不得被静默放行（工具已不存在 → 走兜底 ask）
  const rpLegacy = await probe('perm_add_exception')
  ok('★ group5: 残留 allow 不会让已移除工具被静默放行', rpLegacy.nexted === false, JSON.stringify(rpLegacy.out))

  try { rmSync(ws3, { recursive: true, force: true }); rmSync(home3, { recursive: true, force: true }) } catch (e) {}
}

// ─────────────────────────────────────────────────────────────
group('6. 读图独立分类（image）：默认 ask、判定链 + 缩略图 + 错误文本')
{
  // 不预置任何 image 配置：该分类默认 ask，读图应当直接进审批
  // （read 是 allow，若还「继承」read 就会静默放行，这条正是防它）
  const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='
  writeFileSync(join(workspace, 'pic.png'), Buffer.from(PNG_1X1, 'base64'))

  const r = await runApproval('read_image', { file_path: 'pic.png' }, undefined, 'pic.png')
  const d = r.diff && r.diff.data
  ok('image 默认 ask → 读图进入审批', !!r.id, String(r.id))
  ok('详情返回 kind:image', !!(d && d.ok === true && d.kind === 'image'), JSON.stringify(d && (d.error || d.kind)))
  ok('解析出 png 格式', !!(d && d.format === 'png'), JSON.stringify(d && d.format))
  ok('解析出 1×1 尺寸', !!(d && d.width === 1 && d.height === 1), String(d && (d.width + '×' + d.height)))
  ok('返回缩略图 data URL', !!(d && typeof d.dataUrl === 'string' && d.dataUrl.indexOf('data:image/png;base64,') === 0), String((d && d.dataUrl) || '').slice(0, 32))

  // 扩展名骗人的非图片：必须给「无法预览」而不是空白
  writeFileSync(join(workspace, 'notpic.png'), 'definitely not an image, just text padding to exceed the sniff length\n')
  const bad = await runApproval('read_image', { file_path: 'notpic.png' }, undefined, 'notpic.png')
  const bd = bad.diff && bad.diff.data
  ok('非图片返回 ok:false', !!(bd && bd.ok === false), JSON.stringify(bd && bd.ok))
  ok('非图片给「无法预览」文本', /无法预览/.test(JSON.stringify((bd && bd.error) || '')), JSON.stringify(bd && bd.error))

  const miss = await runApproval('read_image', { file_path: 'nope.png' }, undefined, 'nope.png')
  const md = miss.diff && miss.diff.data
  ok('缺失图片返回 ok:false + 文本', !!(md && md.ok === false && /不存在/.test(String(md.error || ''))), JSON.stringify(md && md.error))

  // 单独把 image 设为 allow：读图直接放行；此时 read 仍是 ask（group 3 设过），证明两者互不影响
  const setImg = await callRoute(host.routes, 'POST', '/permgate/set-category', { target: 'project', category: 'image', mode: 'allow', lang: 'zh', sessionId: 'sess-1' })
  ok('set-category image 可写', !!(setImg.data && !setImg.data.error), JSON.stringify(setImg.data && setImg.data.error))
  let imgNexted = false
  const pImg = host.hooks.get('tools/pre-execute')(makeExec(workspace, 'read_image', { file_path: 'pic.png' }), async () => { imgNexted = true; return { kind: 'allow' } })
  pImg.catch(() => {})
  const imgOut = await Promise.race([pImg, new Promise((res) => setTimeout(() => res(null), 300))])
  ok('image=allow 时读图放行（与 read=ask 互不影响）', imgNexted === true, JSON.stringify(imgOut))
  // 还原成默认 ask，避免影响其它用例
  await callRoute(host.routes, 'POST', '/permgate/set-category', { target: 'project', category: 'image', mode: 'ask', lang: 'zh', sessionId: 'sess-1' })
}

// ─────────────────────────────────────────────────────────────
group('11. 工作区外 allow 的 cat / reason 前缀 / ruleId 同源')
{
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='
  const ext = mkdtempSync(join(tmpdir(), 'pg-out-a-'))
  const img = join(ext, 'o.png')
  writeFileSync(img, Buffer.from(PNG, 'base64'))
  const ws = mkdtempSync(join(tmpdir(), 'pg-smoke-ws4-'))
  const home = mkdtempSync(join(tmpdir(), 'pg-smoke-home4-'))
  mkdirSync(join(home, 'dsh-permgate'), { recursive: true })
  const h = createHost({ workspaceRoot: ws, dshHome: home })
  const pre4 = h.hooks.get('tools/pre-execute')
  const addEx = (cat, action, match) => callRoute(h.routes, 'POST', '/permgate/add-exception', { target: 'project', category: cat, action, match })
  const setCat4 = (cat, mode) => callRoute(h.routes, 'POST', '/permgate/set-category', { target: 'project', category: cat, mode, lang: 'zh', sessionId: 'sess-1' })
  const lastDecision = async () => { const st = await callRoute(h.routes, 'GET', '/permgate/status'); const list = (st.data && st.data.recentDecisions) || []; return list[list.length - 1] }
  const runOut = async (file) => {
    let nexted = false
    const p = pre4(makeExec(ws, 'read_image', { file_path: file }), async () => { nexted = true; return { kind: 'allow' } })
    p.catch(() => {})
    await Promise.race([p, new Promise((r) => setTimeout(() => r(null), 400))])
    return nexted
  }

  // (a) 目录例外与图片例外同时命中：三者都指向目录闸（与 deny / ask 同口径）
  const dAdd = await addEx('directory', 'allow', join(ext, '*'))
  await addEx('image', 'allow', join(ext, '*'))
  const nextedA = await runOut(img)
  const dA = await lastDecision()
  const dId = dAdd.data && dAdd.data.added && dAdd.data.added.id
  ok('工作区外 allow：目录例外优先决定文案（不写图片前缀）', !!dA && dA.action === 'allow' && !/读取图片权限/.test(String(dA.reason)), String(dA && dA.reason).slice(0, 50))
  ok('工作区外 allow：ruleId 与 reason 前缀同源', !!dA && dA.ruleId === dId && /目录权限/.test(String(dA.reason)), JSON.stringify(dA && { ruleId: dA.ruleId, want: dId, reason: String(dA.reason).slice(0, 50) }))
  ok('工作区外 allow：确实放行未弹窗', nextedA === true)

  // (b) 目录闸为 allow 且无例外（无 ruleId）→ cat 落回自身分类
  const ext2 = mkdtempSync(join(tmpdir(), 'pg-out-b-'))
  const img2 = join(ext2, 'p.png')
  writeFileSync(img2, Buffer.from(PNG, 'base64'))
  await setCat4('directory', 'allow')
  const iAdd = await addEx('image', 'allow', join(ext2, '*'))
  await runOut(img2)
  const dB = await lastDecision()
  const iId = iAdd.data && iAdd.data.added && iAdd.data.added.id
  ok('工作区外 allow：目录闸无例外时前缀落回自身分类', !!dB && dB.ruleId === iId && /读取图片权限/.test(String(dB.reason)) && !/目录权限/.test(String(dB.reason)), JSON.stringify(dB && { ruleId: dB.ruleId, want: iId, reason: String(dB.reason).slice(0, 50) }))

  try { rmSync(ext, { recursive: true, force: true }); rmSync(ext2, { recursive: true, force: true }); rmSync(ws, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }) } catch (e) {}
}

// ─────────────────────────────────────────────────────────────
group('12. 本轮修复：尺寸未知不内联、面板例外最新先生效')
{
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='
  // (a1) SOF 被 >64KB 的元数据段推到头部窗口之外，但整读后能用整份缓冲判出尺寸 → 走像素闸
  const big = Buffer.alloc(70 * 1024)
  big[0] = 0xff; big[1] = 0xd8; big[2] = 0xff; big[3] = 0xe1; big[4] = 0xff; big[5] = 0xff
  const off = 66 * 1024
  big[off] = 0xff; big[off + 1] = 0xc0; big[off + 2] = 0x00; big[off + 3] = 0x11; big[off + 4] = 8
  big[off + 5] = 0x75; big[off + 6] = 0x30; big[off + 7] = 0x75; big[off + 8] = 0x30
  writeFileSync(join(workspace, 'far-sof.jpg'), big)
  await callRoute(host.routes, 'POST', '/permgate/set-category', { target: 'project', category: 'image', mode: 'ask', lang: 'zh', sessionId: 'sess-1' })
  const rFar = await runApproval('read_image', { file_path: 'far-sof.jpg' }, undefined, 'far-sof.jpg')
  const dFar = rFar.diff && rFar.diff.data
  ok('SOF 在 64KB 之外也能判出尺寸并按像素闸拦下', !!(dFar && dFar.tooLarge === true && !dFar.dataUrl && dFar.width === 30000 && dFar.height === 30000), JSON.stringify(dFar && { tooLarge: dFar.tooLarge, hasUrl: !!dFar.dataUrl, w: dFar.width, h: dFar.height }))
  try { rmSync(join(workspace, 'far-sof.jpg'), { force: true }) } catch (e) {}

  // (a2) 尺寸确实解析不出来（SOS 提前终止）→ 不下发图片本体
  const noSize = Buffer.alloc(32)
  noSize[0] = 0xff; noSize[1] = 0xd8; noSize[2] = 0xff; noSize[3] = 0xda
  writeFileSync(join(workspace, 'unknown-size.jpg'), noSize)
  const rUnknown = await runApproval('read_image', { file_path: 'unknown-size.jpg' }, undefined, 'unknown-size.jpg')
  const dUnknown = rUnknown.diff && rUnknown.diff.data
  ok('尺寸确实无法解析时不下发缩略图（sizeUnknown）', !!(dUnknown && dUnknown.sizeUnknown === true && !dUnknown.dataUrl && !dUnknown.tooLarge), JSON.stringify(dUnknown && { sizeUnknown: dUnknown.sizeUnknown, tooLarge: dUnknown.tooLarge, hasUrl: !!dUnknown.dataUrl, w: dUnknown.width, h: dUnknown.height }))
  try { rmSync(join(workspace, 'unknown-size.jpg'), { force: true }) } catch (e) {}

  // (b) 新条目**追加到末尾**（用户定）：顺序即优先级，由用户在面板上自己调整。
  //
  // 这里曾断言「新决定插到数组头部、立即生效」（unshift 语义）。改成 push 之后，
  // 「先 allow 后 deny」的 deny 排在 allow 之后 → 首条命中即 allow → 新 deny **不生效**。
  // 这是有意接受的代价（用户明确表态「用户会自己调整顺序」），故断言要钉的是
  // **新语义本身**，而不是旧的「立即生效」：
  //   ① 新条目确实在**末尾**（不是头部）；
  //   ② 它**看得见**（在列表里，用户能找到并拖到前面）—— 这是「让用户自己调整」的前提；
  //   ③ 手动把它调到前面后立即生效（顺序确实即优先级）。
  const ws5 = mkdtempSync(join(tmpdir(), 'pg-smoke-ws5-'))
  const home5 = mkdtempSync(join(tmpdir(), 'pg-smoke-home5-'))
  mkdirSync(join(home5, 'dsh-permgate'), { recursive: true })
  const h5 = createHost({ workspaceRoot: ws5, dshHome: home5 })
  const pre5 = h5.hooks.get('tools/pre-execute')
  const img5 = join(ws5, 'y.png')
  writeFileSync(img5, Buffer.from(PNG, 'base64'))
  const add5 = (action) => callRoute(h5.routes, 'POST', '/permgate/add-exception', { target: 'project', category: 'image', action, match: img5 })
  await add5('allow')
  const denied5 = await add5('deny')
  ok('面板新增 deny 写入成功并返回新条目', !!(denied5.data && denied5.data.added && denied5.data.added.action === 'deny'), JSON.stringify(denied5.data && (denied5.data.error || denied5.data.added)))
  const st5 = await callRoute(h5.routes, 'GET', '/permgate/status')
  const rows5 = (((st5.data.categories || {}).project || {}).image || {}).exceptions || []
  ok('★★ 新例外追加在数组**末尾**（顺序归用户，不再插头部）',
    rows5.length === 2 && rows5[0].action === 'allow' && rows5[1].action === 'deny',
    JSON.stringify(rows5.map((e) => e.action)))
  const out5 = await Promise.race([pre5(makeExec(ws5, 'read_image', { file_path: img5 }), async () => ({ kind: 'allow' })), new Promise((r) => setTimeout(() => r({ kind: 'timeout' }), 400))])
  // 首条命中即 allow —— 新 deny 排在后面故被遮蔽。这不是 bug，是「顺序即优先级」的直接后果。
  ok('★ 新 deny 排在 allow 之后时被遮蔽（已知后果，由用户手动调节顺序解决）',
    !!out5 && out5.kind === 'allow', JSON.stringify(out5))
  // 对照：把 deny 调到前面（模拟用户拖动排序）→ 立即生效
  {
    const st = await callRoute(h5.routes, 'GET', '/permgate/status')
    const list = (((st.data.categories || {}).project || {}).image || {}).exceptions || []
    const allowId = (list.find((e) => e.action === 'allow') || {}).id
    const denyId = (list.find((e) => e.action === 'deny') || {}).id
    const mv = await callRoute(h5.routes, 'POST', '/permgate/reorder', { target: 'project', kind: 'exception', category: 'image', id: denyId, anchor: allowId, position: 'before', lang: 'zh' })
    ok('★ 例外排序路由把 deny 提到前面', !!(mv.data && mv.data.reordered), JSON.stringify(mv.data && mv.data.error))
    const out5b = await Promise.race([pre5(makeExec(ws5, 'read_image', { file_path: img5 }), async () => ({ kind: 'allow' })), new Promise((r) => setTimeout(() => r({ kind: 'timeout' }), 400))])
    ok('★★ 用户手动把新例外调到前面后立即生效（顺序 = 优先级）',
      !!out5b && out5b.kind === 'deny', JSON.stringify(out5b))
  }
  try { rmSync(ws5, { recursive: true, force: true }); rmSync(home5, { recursive: true, force: true }) } catch (e) {}

  // (c) 拒绝语义下即便携带 allow 规则，服务端也必须拦截（不写 allow 例外）
  const ws6 = mkdtempSync(join(tmpdir(), 'pg-smoke-ws6-'))
  const home6 = mkdtempSync(join(tmpdir(), 'pg-smoke-home6-'))
  mkdirSync(join(home6, 'dsh-permgate'), { recursive: true })
  const h6 = createHost({ workspaceRoot: ws6, dshHome: home6 })
  const pre6 = h6.hooks.get('tools/pre-execute')
  const ext6 = mkdtempSync(join(tmpdir(), 'pg-out-c-'))
  const img6 = join(ext6, 'z.png')
  writeFileSync(img6, Buffer.from(PNG, 'base64'))
  await callRoute(h6.routes, 'POST', '/permgate/set-category', { target: 'project', category: 'directory', mode: 'ask', lang: 'zh', sessionId: 'sess-1' })
  await callRoute(h6.routes, 'POST', '/permgate/set-category', { target: 'project', category: 'image', mode: 'ask', lang: 'zh', sessionId: 'sess-1' })
  const p6 = pre6(makeExec(ws6, 'read_image', { file_path: img6 }), async () => ({ kind: 'allow' }))
  p6.catch(() => {})
  await new Promise((r) => setTimeout(r, 60))
  const list6 = await callRoute(h6.routes, 'GET', '/permgate/pending')
  const item6 = (Array.isArray(list6.data) ? list6.data : []).filter((x) => x.tool === 'read_image').pop()
  const cand6 = ((item6 && item6.candidates) || [])[0]
  const denied6 = await callRoute(h6.routes, 'POST', '/permgate/decide', { id: item6 && item6.id, action: 'deny', rules: cand6 ? [{ id: cand6.id, decision: 'allow' }] : [], lang: 'zh' })
  await Promise.race([p6, new Promise((r) => setTimeout(r, 200))])
  const st6 = await callRoute(h6.routes, 'GET', '/permgate/status')
  const rows6 = ((((st6.data || {}).categories || {}).project || {}).image || {}).exceptions || []
  const dirRows6 = ((((st6.data || {}).categories || {}).project || {}).directory || {}).exceptions || []
  ok('拒绝时携带 allow 规则不落 allow 例外（两个分类都没写）', !!(item6 && cand6) && rows6.length === 0 && dirRows6.length === 0, JSON.stringify({ decisions: (denied6.data || {}).ruleAdded, rows: rows6.map((e) => e.action), dirRows: dirRows6.map((e) => e.action) }))
  try { rmSync(ws6, { recursive: true, force: true }); rmSync(home6, { recursive: true, force: true }); rmSync(ext6, { recursive: true, force: true }) } catch (e) {}

  // (d) 反向确认：拒绝态下勾选的「拒绝此项」必须照常落盘（过滤只针对 allow 方向）
  const ws7 = mkdtempSync(join(tmpdir(), 'pg-smoke-ws7-'))
  const home7 = mkdtempSync(join(tmpdir(), 'pg-smoke-home7-'))
  mkdirSync(join(home7, 'dsh-permgate'), { recursive: true })
  const h7 = createHost({ workspaceRoot: ws7, dshHome: home7 })
  const pre7 = h7.hooks.get('tools/pre-execute')
  const ext7 = mkdtempSync(join(tmpdir(), 'pg-out-d-'))
  const img7 = join(ext7, 'w.png')
  writeFileSync(img7, Buffer.from(PNG, 'base64'))
  await callRoute(h7.routes, 'POST', '/permgate/set-category', { target: 'project', category: 'directory', mode: 'ask', lang: 'zh', sessionId: 'sess-1' })
  await callRoute(h7.routes, 'POST', '/permgate/set-category', { target: 'project', category: 'image', mode: 'ask', lang: 'zh', sessionId: 'sess-1' })
  const p7 = pre7(makeExec(ws7, 'read_image', { file_path: img7 }), async () => ({ kind: 'allow' }))
  p7.catch(() => {})
  await new Promise((r) => setTimeout(r, 60))
  const list7 = await callRoute(h7.routes, 'GET', '/permgate/pending')
  const item7 = (Array.isArray(list7.data) ? list7.data : []).filter((x) => x.tool === 'read_image').pop()
  const cands7 = (item7 && item7.candidates) || []
  const cand7 = cands7.find((c) => /[\\/]\*$/.test(String(c.value))) || cands7[0]
  await callRoute(h7.routes, 'POST', '/permgate/decide', { id: item7 && item7.id, action: 'deny', rules: cand7 ? [{ id: cand7.id, decision: 'deny' }] : [], lang: 'zh' })
  await Promise.race([p7, new Promise((r) => setTimeout(r, 200))])
  const st7 = await callRoute(h7.routes, 'GET', '/permgate/status')
  const img7Rows = ((((st7.data || {}).categories || {}).project || {}).image || {}).exceptions || []
  const dir7Rows = ((((st7.data || {}).categories || {}).project || {}).directory || {}).exceptions || []
  ok('拒绝时勾选「拒绝此项」仍照常落盘（image 记 deny、目录闸不连带）', !!cand7 && img7Rows.length === 1 && img7Rows[0].action === 'deny' && dir7Rows.length === 0, JSON.stringify({ img: img7Rows.map((e) => e.action), dir: dir7Rows.map((e) => e.action) }))
  try { rmSync(ws7, { recursive: true, force: true }); rmSync(home7, { recursive: true, force: true }); rmSync(ext7, { recursive: true, force: true }) } catch (e) {}

  // (e) 例外删除严格按 id：删掉被遮蔽的 allow 不影响生效中的 deny；方向交替写入也不累积同向条目
  const ws8 = mkdtempSync(join(tmpdir(), 'pg-smoke-ws8-'))
  const home8 = mkdtempSync(join(tmpdir(), 'pg-smoke-home8-'))
  mkdirSync(join(home8, 'dsh-permgate'), { recursive: true })
  const h8 = createHost({ workspaceRoot: ws8, dshHome: home8 })
  const pre8 = h8.hooks.get('tools/pre-execute')
  const img8 = join(ws8, 'v.png')
  writeFileSync(img8, Buffer.from(PNG, 'base64'))
  const readRows8 = async () => {
    const st = await callRoute(h8.routes, 'GET', '/permgate/status')
    return ((((st.data || {}).categories || {}).project || {}).image || {}).exceptions || []
  }
  const add8 = (action) => callRoute(h8.routes, 'POST', '/permgate/add-exception', { target: 'project', category: 'image', action, match: img8 })
  await add8('allow')
  const denied8 = await add8('deny')
  // 方向交替（allow → deny → allow）不应累积重复同向条目
  await add8('allow')
  const rowsDedup8 = await readRows8()
  ok('方向交替写入不累积同向条目（仍为 allow + deny 两条）', rowsDedup8.length === 2 && rowsDedup8.filter((e) => e.action === 'allow').length === 1 && rowsDedup8.filter((e) => e.action === 'deny').length === 1, JSON.stringify(rowsDedup8.map((e) => e.action)))
  const rows8a = await readRows8()
  const allowRow8 = rows8a.find((e) => e.action === 'allow')
  const del8 = await callRoute(h8.routes, 'POST', '/permgate/remove-exception', { target: 'project', category: 'image', id: allowRow8 && allowRow8.id })
  const rows8b = await readRows8()
  ok('删除严格按 id（删被遮蔽的 allow 不影响生效的 deny）并回传 remaining', !!(del8.data && del8.data.removed) && del8.data.removedCount === 1 && del8.data.remaining === 1 && rows8b.length === 1 && rows8b[0].action === 'deny' && rows8b[0].id === denied8.data.added.id, JSON.stringify({ count: del8.data && del8.data.removedCount, remaining: del8.data && del8.data.remaining, rows: rows8b.map((e) => e.action) }))
  const out8 = await Promise.race([pre8(makeExec(ws8, 'read_image', { file_path: img8 }), async () => ({ kind: 'allow' })), new Promise((r) => setTimeout(() => r({ kind: 'timeout' }), 400))])
  ok('删掉被遮蔽的 allow 后 deny 依旧生效', !!out8 && out8.kind === 'deny', JSON.stringify(out8))
  const del8b = await callRoute(h8.routes, 'POST', '/permgate/remove-exception', { target: 'project', category: 'image', id: denied8.data.added.id })
  const rows8c = await readRows8()
  ok('两条逐一删除后例外清空', !!(del8b.data && del8b.data.removed) && del8b.data.removedCount === 1 && rows8c.length === 0, JSON.stringify({ count: del8b.data && del8b.data.removedCount, rows: rows8c.map((e) => e.action) }))
  let nexted8 = false
  const p8 = pre8(makeExec(ws8, 'read_image', { file_path: img8 }), async () => { nexted8 = true; return { kind: 'allow' } })
  p8.catch(() => {})
  await new Promise((r) => setTimeout(r, 200))
  ok('例外清空后 read_image 回到默认询问', nexted8 === false)
  const list8 = await callRoute(h8.routes, 'GET', '/permgate/pending')
  const item8 = (Array.isArray(list8.data) ? list8.data : []).filter((x) => x.tool === 'read_image').pop()
  if (item8) await callRoute(h8.routes, 'POST', '/permgate/decide', { id: item8.id, action: 'deny', lang: 'zh' })
  await Promise.race([p8, new Promise((r) => setTimeout(r, 200))])
  try { rmSync(ws8, { recursive: true, force: true }); rmSync(home8, { recursive: true, force: true }) } catch (e) {}

  // (e2) 大小写等价的例外：删掉其中一条时，remaining 必须与读侧 alreadyInProject、写侧
  // addProjectException 同源（命令分类走 cmdExcKey，因为例外真正生效的 matchCommand 大小写不敏感）。
  //
  // 为什么这条语料承重：修复前 remaining 是裸 `r[key] === value`，删 `Get-ChildItem *` 时等价的
  // `get-childitem *` 被算成「没有剩余」→ 返回 0 → 客户端清掉提示 → 用户以为已彻底清除，
  // 而那条等价例外**仍在生效**（以为收紧了授权，实际没有）。
  //
  // 三条数据的形态都是刻意的，各自钉住一种写错的实现（少任何一条，断言都会退化成恒真）：
  //   · eLower 与 eUpper **仅大小写不同** —— 裸比较（大小写敏感）会让 remaining 错回 0；
  //   · eSpaced 只多一个前导空格 —— `matchCommand` 不 trim（实测 `' Get-ChildItem *'` 匹配不上
  //     `Get-ChildItem x`），故它与另两条**不等价**、不该计入 remaining。它同时把「剩余同值条数」
  //     （1）与「剩余总条数」（2）分开，钉住 `remaining = kept.length` 与「给 cmdExcKey 加 trim」
  //     这两种写法 —— 只有两条数据时这两处错法与正确值恰好相同，语料照样全绿。
  //
  // 用预置配置文件而不是走 add-exception：写侧判重修复后已不会再产出第二条等价条目，
  // 而这里要守的恰是**存量配置**里已经并存两条的形态（历史遗留，用户删不掉印象里的那条）。
  const wsEq = mkdtempSync(join(tmpdir(), 'pg-smoke-wseq-'))
  const homeEq = mkdtempSync(join(tmpdir(), 'pg-smoke-homeeq-'))
  mkdirSync(join(homeEq, 'dsh-permgate'), { recursive: true })
  writeFileSync(join(homeEq, 'dsh-permgate', 'config.json'), JSON.stringify({
    global: {
      sandboxMode: 'danger-full-access', fallbackMode: 'ask',
      command: {
        mode: 'ask',
        exceptions: [
          { id: 'eUpper', action: 'allow', match: 'Get-ChildItem *' },
          { id: 'eLower', action: 'deny', match: 'get-childitem *', reason: '合成数据：等价例外仍在生效' },
          { id: 'eSpaced', action: 'allow', match: ' get-childitem *' },
        ],
      },
    },
    projects: {},
  }, null, 2), 'utf8')
  const hEq = createHost({ workspaceRoot: wsEq, dshHome: homeEq })
  const rowsEq = async () => {
    const st = await callRoute(hEq.routes, 'GET', '/permgate/status')
    return ((((st.data || {}).categories || {}).global || {}).command || {}).exceptions || []
  }
  const delEq = await callRoute(hEq.routes, 'POST', '/permgate/remove-exception', { target: 'global', category: 'command', id: 'eUpper' })
  const rowsEqB = await rowsEq()
  ok('★ 大小写等价的命令例外：删掉其中一条时 remaining === 1（另一条仍在，未被算成「已清空」）',
    !!(delEq.data && delEq.data.removed) && delEq.data.removedCount === 1 && delEq.data.remaining === 1 &&
    JSON.stringify(rowsEqB.map((r) => r.id)) === JSON.stringify(['eLower', 'eSpaced']),
    JSON.stringify({ count: delEq.data && delEq.data.removedCount, remaining: delEq.data && delEq.data.remaining, rows: rowsEqB.map((r) => r.id + '=' + r.match) }))
  try { rmSync(wsEq, { recursive: true, force: true }); rmSync(homeEq, { recursive: true, force: true }) } catch (e) {}

  // (f) 同向重复写入：命中的旧条目**原地更新文字**（不移动位置）。
  //
  // 这里曾断言「把命中的条目提到头部」（unshift 语义）—— 新语义下位置归用户，
  // 去重命中只回写 reason/note，不动顺序。故断言改为：
  //   ① 同向重复写入**不新增条目**（去重仍生效，否则列表会堆成一串）；
  //   ② 位置不变（先 deny 后 allow 之后，再写 deny 不会把它挪到前面）。
  const ws9 = mkdtempSync(join(tmpdir(), 'pg-smoke-ws9-'))
  const home9 = mkdtempSync(join(tmpdir(), 'pg-smoke-home9-'))
  mkdirSync(join(home9, 'dsh-permgate'), { recursive: true })
  const h9 = createHost({ workspaceRoot: ws9, dshHome: home9 })
  const pre9 = h9.hooks.get('tools/pre-execute')
  const img9 = join(ws9, 'w.png')
  writeFileSync(img9, Buffer.from(PNG, 'base64'))
  const add9 = (action, reason) => callRoute(h9.routes, 'POST', '/permgate/add-exception', { target: 'project', category: 'image', action, match: img9, reason })
  const rows9 = async () => {
    const st = await callRoute(h9.routes, 'GET', '/permgate/status')
    return ((((st.data || {}).categories || {}).project || {}).image || {}).exceptions || []
  }
  await add9('deny')
  await add9('allow')
  ok('★ 先 deny 后 allow 时顺序为 [deny, allow]（新条目追加在末尾）',
    JSON.stringify((await rows9()).map((e) => e.action)) === JSON.stringify(['deny', 'allow']),
    JSON.stringify((await rows9()).map((e) => e.action)))
  await add9('deny')
  const rows9b = await rows9()
  ok('★ 同向重复写入不新增条目（去重生效，位置不变）',
    rows9b.length === 2 && rows9b[0].action === 'deny' && rows9b[1].action === 'allow',
    JSON.stringify(rows9b.map((e) => e.action)))
  // 首条命中即 deny —— 这条路径本来就该拒绝（deny 排在第一位）
  const out9 = await Promise.race([pre9(makeExec(ws9, 'read_image', { file_path: img9 }), async () => ({ kind: 'allow' })), new Promise((r) => setTimeout(() => r({ kind: 'timeout' }), 400))])
  ok('该路径按首条命中的 deny 拒绝', !!out9 && out9.kind === 'deny', JSON.stringify(out9))
  // 同向去重要能回写文字：给 deny 补一个 reason，应落到既有那条上而不是新建
  await add9('deny', '新理由')
  const rows9c = await rows9()
  ok('★ 同向重复写入回写文字（reason 落到既有条目上，不新建）',
    rows9c.length === 2 && rows9c[0].action === 'deny' && rows9c[0].reason === '新理由',
    JSON.stringify(rows9c.map((e) => ({ a: e.action, r: e.reason }))))
  // 同向重复写入带新理由时应更新既有条目的 reason（面板显示最新理由）
  // 复用上面的 add9（两者请求体完全相同，各写一份会在加字段时只改一处）
  await add9('deny', '第一次理由')
  await add9('deny', '更新后的理由')
  const denyRow9 = (await rows9()).find((e) => e.action === 'deny')
  ok('同向重复写入会更新既有条目的 reason', !!denyRow9 && denyRow9.reason === '更新后的理由', JSON.stringify(denyRow9 && denyRow9.reason))
  try { rmSync(ws9, { recursive: true, force: true }); rmSync(home9, { recursive: true, force: true }) } catch (e) {}
}

// ─────────────────────────────────────────────────────────────
group('13. 复合权限（工作区外 + 各自分类）的候选：四种都带分类自适应的灰色小字')
{
  const outDir = mkdtempSync(join(tmpdir(), 'pg-cand-out-'))
  const ws5 = mkdtempSync(join(tmpdir(), 'pg-cand-ws-'))
  const home5 = mkdtempSync(join(tmpdir(), 'pg-cand-home-'))
  mkdirSync(join(home5, 'dsh-permgate'), { recursive: true })
  const h5 = createHost({ workspaceRoot: ws5, dshHome: home5 })
  const pre5 = h5.hooks.get('tools/pre-execute')
  const setCat5 = (cat, mode) => callRoute(h5.routes, 'POST', '/permgate/set-category', { target: 'project', category: cat, mode, lang: 'zh', sessionId: 'sess-1' })
  // read 默认 allow，需显式改 ask 才会进审批；image/edit 默认已是 ask，
  // undo 现默认 allow，故这里显式设回 ask 才能走到候选断言（本组测的是候选文案，不是默认值）
  await setCat5('read', 'ask')
  await setCat5('undo', 'ask')
  const preview = async (name, args) => {
    const p = pre5(makeExec(ws5, name, args), async () => ({ kind: 'allow' }))
    p.catch(() => {})
    await new Promise((r) => setTimeout(r, 40))
    const pr = await callRoute(h5.routes, 'GET', '/permgate/pending')
    const list = Array.isArray(pr.data) ? pr.data : ((pr.data && pr.data.pending) || [])
    const item = list[0]
    if (item) await callRoute(h5.routes, 'POST', '/permgate/decide', { id: item.id, action: 'deny', lang: 'zh' })
    return item
  }
  const CASES = [
    ['read', 'read', '读取文件', { file_path: join(outDir, 'r.txt') }],
    ['read_image', 'image', '读取图片', { file_path: join(outDir, 'i.png') }],
    ['write', 'edit', '编辑文件', { file_path: join(outDir, 'w.txt'), content: 'x' }],
    ['undo_last_edit', 'undo', '撤销操作', { path: join(outDir, 'u.txt') }],
  ]
  for (const [tool, cat, label, args] of CASES) {
    const item = await preview(tool, args)
    const cands = (item && item.candidates) || []
    ok('group13: ' + cat + ' 工作区外给出两条复合候选', cands.length === 2, JSON.stringify(cands.map((c) => c.label)))
    ok('group13: ' + cat + ' 候选主文案是纯路径、小字含「' + label + '」', cands.length === 2 && cands.every((c) => c.label === c.value && typeof c.hint === 'string' && c.hint.indexOf(label) !== -1), JSON.stringify(cands.map((c) => c.hint)))
    ok('group13: ' + cat + ' 小字同时点出目录闸', cands.length === 2 && cands.every((c) => c.hint.indexOf('工作区外访问') === 0), JSON.stringify(cands.map((c) => c.hint)))
  }
  try { rmSync(outDir, { recursive: true, force: true }); rmSync(ws5, { recursive: true, force: true }); rmSync(home5, { recursive: true, force: true }) } catch (e) {}
}

// ─────────────────────────────────────────────────────────────
group('14. 相对 glob 例外不被绝对化（`**/*.env` 仍匹配任意目录）')
{
  const wsG = mkdtempSync(join(tmpdir(), 'pg-glob-ws-'))
  const homeG = mkdtempSync(join(tmpdir(), 'pg-glob-home-'))
  const outG = mkdtempSync(join(tmpdir(), 'pg-glob-out-'))
  mkdirSync(join(homeG, 'dsh-permgate'), { recursive: true })
  const hG = createHost({ workspaceRoot: wsG, dshHome: homeG })
  const preG = hG.hooks.get('tools/pre-execute')
  // read 默认 allow：先设 ask，这样才能靠「例外命中即放行」判定 glob 是否真的生效；
  // directory 默认 ask：工作区外访问会先被目录闸拦住（cat=目录权限），必须放开它才测得到 read 的例外
  await callRoute(hG.routes, 'POST', '/permgate/set-category', { target: 'global', category: 'directory', mode: 'allow', lang: 'zh', sessionId: 'sess-1' })
  await callRoute(hG.routes, 'POST', '/permgate/set-category', { target: 'global', category: 'read', mode: 'ask', lang: 'zh', sessionId: 'sess-1' })
  const add = await callRoute(hG.routes, 'POST', '/permgate/add-exception', { target: 'global', category: 'read', action: 'allow', match: '**/*.env' })
  const addedPath = add.data && add.data.added && add.data.added.path
  ok('group14: 相对 glob 原样落盘（不被拼成绝对路径）', addedPath === '**/*.env', JSON.stringify(addedPath))
  const probeG = async (file) => {
    let nexted = false
    const p = preG(makeExec(wsG, 'read', { file_path: file }), async () => { nexted = true; return { kind: 'allow' } })
    p.catch(() => {})
    const out = await Promise.race([p, new Promise((r) => setTimeout(() => r(null), 400))])
    return { nexted, out }
  }
  const hitG = await probeG(join(outG, '.env'))
  ok('group14: 工作区外的 .env 被该例外放行（未被绝对化收窄）', hitG.nexted === true, JSON.stringify(hitG.out))
  const missG = await probeG(join(outG, 'plain.txt'))
  ok('group14: 非匹配文件仍走审批（例外没被放宽）', missG.nexted === false, JSON.stringify(missG.out))
  try { rmSync(wsG, { recursive: true, force: true }); rmSync(homeG, { recursive: true, force: true }); rmSync(outG, { recursive: true, force: true }) } catch (e) {}
}

// ─────────────────────────────────────────────────────────────
group('15. 例外三态（ask / allow / deny）：ask 例外照常弹窗并携带自己的备注')
{
  const wsA = mkdtempSync(join(tmpdir(), 'pg-excask-ws-'))
  const homeA = mkdtempSync(join(tmpdir(), 'pg-excask-home-'))
  const outA = mkdtempSync(join(tmpdir(), 'pg-excask-out-'))
  mkdirSync(join(homeA, 'dsh-permgate'), { recursive: true })
  const hA = createHost({ workspaceRoot: wsA, dshHome: homeA })
  const preA = hA.hooks.get('tools/pre-execute')
  const addA = (cat, action, match, extra) => callRoute(hA.routes, 'POST', '/permgate/add-exception', Object.assign({ target: 'project', category: cat, action, match }, extra || {}))
  const setCatA = (cat, mode) => callRoute(hA.routes, 'POST', '/permgate/set-category', { target: 'project', category: cat, mode, lang: 'zh', sessionId: 'sess-1' })

  // (a) 面板可写入 ask 例外，并保留自己的备注（note），且不会串到 deny 的 reason 上
  const rA = await addA('read', 'ask', join(outA, '*.txt'), { note: '这个目录的文本需人工确认' })
  ok('group15: ask 例外可写入', !!(rA.data && rA.data.added && rA.data.added.action === 'ask'), JSON.stringify(rA.data && (rA.data.error || rA.data.added)))
  ok('group15: ask 例外把备注存进 note 字段', !!(rA.data && rA.data.added && rA.data.added.note === '这个目录的文本需人工确认'), JSON.stringify(rA.data && rA.data.added))
  ok('group15: ask 例外不占用 deny 的 reason 字段', !!(rA.data && rA.data.added && rA.data.added.reason === undefined), JSON.stringify(rA.data && rA.data.added))
  // 反向：给 ask 例外传 reason 也不该被收下（两个字段各归其位）
  const rA0 = await addA('undo', 'ask', join(outA, '*.bak'), { reason: '不该出现在 ask 上' })
  ok('group15: 传给 ask 例外的 reason 被忽略（不串字段）', !!(rA0.data && rA0.data.added && rA0.data.added.reason === undefined && rA0.data.added.note === undefined), JSON.stringify(rA0.data && rA0.data.added))

  // (b) ask 例外命中 → 仍走审批（不静默放行、也不静默拒绝），且弹窗 reason 带出自己的备注
  await setCatA('directory', 'allow')   // 排除目录闸干扰：只看 read 分类这一条
  await setCatA('read', 'allow')        // 分类默认 allow，若例外不生效就会被静默放行
  const pA = preA(makeExec(wsA, 'read', { file_path: join(outA, 'note.txt') }), async () => ({ kind: 'allow' }))
  pA.catch(() => {})
  await new Promise((r) => setTimeout(r, 60))
  const listA = await callRoute(hA.routes, 'GET', '/permgate/pending')
  const itemA = (Array.isArray(listA.data) ? listA.data : []).filter((x) => x.tool === 'read').pop()
  ok('group15: ask 例外命中 → 仍进审批（分类默认 allow 也拦得住）', !!itemA, JSON.stringify(listA.data))
  // note 走独立字段下发（不拼进 reason）：reason 会被 recordDecision 写入决策记录、
  // 再随 perm_status 的 recentDecisions 回给 AI，而备注只该在弹窗上给人看。
  ok('group15: 弹窗带出该例外的备注（独立 note 字段）', !!itemA && String(itemA.note || '').indexOf('这个目录的文本需人工确认') !== -1, JSON.stringify(itemA && { reason: itemA.reason, note: itemA.note }))
  ok('group15: 该备注不拼进 reason（否则会随决策记录下发给 AI）', !!itemA && String(itemA.reason).indexOf('这个目录的文本需人工确认') === -1, String(itemA && itemA.reason))
  if (itemA) await callRoute(hA.routes, 'POST', '/permgate/decide', { id: itemA.id, action: 'deny', lang: 'zh' })
  await Promise.race([pA, new Promise((r) => setTimeout(r, 200))])

  // (c) ask 例外同样能盖过 deny 分类默认值（三态优先级一致：例外 > 分类默认）
  await setCatA('read', 'deny')
  const pA2 = preA(makeExec(wsA, 'read', { file_path: join(outA, 'note2.txt') }), async () => ({ kind: 'allow' }))
  pA2.catch(() => {})
  await new Promise((r) => setTimeout(r, 60))
  const listA2 = await callRoute(hA.routes, 'GET', '/permgate/pending')
  const itemA2 = (Array.isArray(listA2.data) ? listA2.data : []).filter((x) => x.tool === 'read').pop()
  ok('group15: ask 例外盖过 deny 分类默认值（仍弹窗而非直接拒）', !!itemA2, JSON.stringify(listA2.data))
  if (itemA2) await callRoute(hA.routes, 'POST', '/permgate/decide', { id: itemA2.id, action: 'deny', lang: 'zh' })
  await Promise.race([pA2, new Promise((r) => setTimeout(r, 200))])

  // (d) 未命中该例外的路径仍按分类默认值拒绝（例外没有放宽范围）
  let nextedA = false
  const pA3 = preA(makeExec(wsA, 'read', { file_path: join(outA, 'other.log') }), async () => { nextedA = true; return { kind: 'allow' } })
  pA3.catch(() => {})
  const outA3 = await Promise.race([pA3, new Promise((r) => setTimeout(() => r({ kind: 'timeout' }), 400))])
  ok('group15: 非匹配路径仍按 deny 分类默认值拒绝', nextedA === false && !!outA3 && outA3.kind === 'deny', JSON.stringify(outA3))

  // (e) ask 例外不算「已表态」：弹窗里仍给出「允许此项」候选，点一次即可改成永久放行
  // （若 alreadyInProject 把 ask 也算作已覆盖，用户就只能去设置面板手工编辑）
  await setCatA('read', 'ask')
  const pA5 = preA(makeExec(wsA, 'read', { file_path: join(outA, 'note.txt') }), async () => ({ kind: 'allow' }))
  pA5.catch(() => {})
  await new Promise((r) => setTimeout(r, 60))
  const listA5 = await callRoute(hA.routes, 'GET', '/permgate/pending')
  const itemA5 = (Array.isArray(listA5.data) ? listA5.data : []).filter((x) => x.tool === 'read').pop()
  const candA5 = (itemA5 && itemA5.candidates) || []
  ok('group15: 已有 ask 例外时仍给出「允许此项」候选（ask 不算已表态）', candA5.length >= 1 && candA5.some((c) => String(c.value).indexOf('note.txt') !== -1), JSON.stringify(candA5.map((c) => c.value)))
  if (itemA5) {
    const pick = candA5.find((c) => String(c.value).indexOf('note.txt') !== -1)
    await callRoute(hA.routes, 'POST', '/permgate/decide', { id: itemA5.id, action: 'allow', rules: pick ? [{ id: pick.id, decision: 'allow' }] : [], lang: 'zh' })
  }
  const outA5 = await Promise.race([pA5, new Promise((r) => setTimeout(() => r({ kind: 'timeout' }), 400))])
  ok('group15: 从 ask 例外一键改为永久放行后本次即放行', !!outA5 && outA5.kind === 'allow', JSON.stringify(outA5))
  const stA5 = await callRoute(hA.routes, 'GET', '/permgate/status')
  const rowsA5 = ((((stA5.data || {}).categories || {}).project || {}).read || {}).exceptions || []
  // 新语义：新条目追加在末尾 → 顺序为 [ask, allow]，首条命中的 ask 仍在生效。
  // 这里曾断言「allow 插到 ask 之前、之后被静默放行」（unshift 语义）—— 已按用户要求改掉。
  // 钉住新语义：位置在末尾，且该例外**确实看得见**（用户能自己拖到前面去）。
  ok('★ group15: 新 allow 例外追加在 ask 例外之后（顺序归用户）',
    rowsA5.length === 2 && rowsA5[0].action === 'ask' && rowsA5[1].action === 'allow',
    JSON.stringify(rowsA5.map((e) => e.action)))
  // 首条命中的仍是 ask → 同类读取继续弹窗（不是静默放行）。
  // 判据是「没有静默放行」：ask 会去弹窗，而测试桩的 approval 永不 resolve，
  // 故 Promise.race 超时返回 timeout —— 那正是「在等审批」的表现，不是失败。
  let nextedA5 = false
  const pA6 = preA(makeExec(wsA, 'read', { file_path: join(outA, 'note.txt') }), async () => { nextedA5 = true; return { kind: 'allow' } })
  pA6.catch(() => {})
  await Promise.race([pA6, new Promise((r) => setTimeout(r, 300))])
  ok('★ group15: ask 例外排在前面时仍弹窗等待（未被后面的 allow 静默放行）', nextedA5 === false)
  // 对照：把 allow 调到前面（模拟用户拖动排序）→ 立即静默放行
  {
    const allowId = (rowsA5.find((e) => e.action === 'allow') || {}).id
    const askId = (rowsA5.find((e) => e.action === 'ask') || {}).id
    const mvA = await callRoute(hA.routes, 'POST', '/permgate/reorder', { target: 'project', kind: 'exception', category: 'read', id: allowId, anchor: askId, position: 'before', lang: 'zh' })
    ok('group15: 例外排序路由把 allow 提到 ask 之前', !!(mvA.data && mvA.data.reordered), JSON.stringify(mvA.data && mvA.data.error))
    let nextedA5b = false
    const pA7 = preA(makeExec(wsA, 'read', { file_path: join(outA, 'note.txt') }), async () => { nextedA5b = true; return { kind: 'allow' } })
    pA7.catch(() => {})
    await Promise.race([pA7, new Promise((r) => setTimeout(() => r({ kind: 'timeout' }), 300))])
    ok('★★ group15: 用户手动把 allow 调到前面后同类读取被静默放行（顺序 = 优先级）', nextedA5b === true)
  }

  // (f) 工作区外的 ask 例外：cat / ruleId 同源，说明随弹窗展示
  const wsA2 = mkdtempSync(join(tmpdir(), 'pg-excask2-ws-'))
  const homeA2 = mkdtempSync(join(tmpdir(), 'pg-excask2-home-'))
  mkdirSync(join(homeA2, 'dsh-permgate'), { recursive: true })
  const hA2 = createHost({ workspaceRoot: wsA2, dshHome: homeA2 })
  const preA2 = hA2.hooks.get('tools/pre-execute')
  const addA2 = (cat, action, match, extra) => callRoute(hA2.routes, 'POST', '/permgate/add-exception', Object.assign({ target: 'project', category: cat, action, match }, extra || {}))
  await callRoute(hA2.routes, 'POST', '/permgate/set-category', { target: 'project', category: 'directory', mode: 'allow', lang: 'zh', sessionId: 'sess-1' })
  await callRoute(hA2.routes, 'POST', '/permgate/set-category', { target: 'project', category: 'image', mode: 'allow', lang: 'zh', sessionId: 'sess-1' })
  const rA2 = await addA2('image', 'ask', join(outA, '*.png'), { note: '外部图片需确认' })
  const idA2 = rA2.data && rA2.data.added && rA2.data.added.id
  const pA4 = preA2(makeExec(wsA2, 'read_image', { file_path: join(outA, 'z.png') }), async () => ({ kind: 'allow' }))
  pA4.catch(() => {})
  await new Promise((r) => setTimeout(r, 60))
  const listA4 = await callRoute(hA2.routes, 'GET', '/permgate/pending')
  const itemA4 = (Array.isArray(listA4.data) ? listA4.data : []).filter((x) => x.tool === 'read_image').pop()
  // cat 不下发给客户端，但 reason 前缀与 ruleId 同源于 cat：前缀是「读取图片权限」即证明
  // 例外触发时 cat 跟随例外所在闸（image），而不是回落成目录闸
  ok('group15: 工作区外 ask 例外 → 进审批且文案前缀跟随例外所在闸', !!itemA4 && String(itemA4.reason).indexOf('读取图片权限：') === 0, JSON.stringify(itemA4 && { reason: itemA4.reason }))
  ok('group15: 工作区外 ask 例外的备注走独立字段（不拼进 reason）', !!itemA4 && String(itemA4.note || '').indexOf('外部图片需确认') !== -1 && String(itemA4.reason).indexOf('外部图片需确认') === -1, JSON.stringify(itemA4 && { reason: itemA4.reason, note: itemA4.note }))
  const stA4 = await callRoute(hA2.routes, 'GET', '/permgate/status')
  const decA4 = ((stA4.data && stA4.data.recentDecisions) || []).filter((d) => d.tool === 'read_image').pop()
  ok('group15: 工作区外 ask 例外的 ruleId 与文案同源', !!decA4 && decA4.ruleId === idA2, JSON.stringify({ got: decA4 && decA4.ruleId, want: idA2 }))
  // 本次改动的核心目标：备注不再随决策记录流到 AI。recentDecisions 会被 perm_status 下发给 AI，
  // 故这里必须确认 note 文本**不在**其中（reason 是决策记录里唯一的自由文本位）。
  ok('★ group15: ask 例外的备注不随决策记录（recentDecisions）下发给 AI',
    !!decA4 && String(decA4.reason).indexOf('外部图片需确认') === -1, JSON.stringify(decA4 && { reason: decA4.reason }))
  if (itemA4) await callRoute(hA2.routes, 'POST', '/permgate/decide', { id: itemA4.id, action: 'deny', lang: 'zh' })
  await Promise.race([pA4, new Promise((r) => setTimeout(r, 200))])

  try {
    rmSync(wsA, { recursive: true, force: true }); rmSync(homeA, { recursive: true, force: true })
    rmSync(wsA2, { recursive: true, force: true }); rmSync(homeA2, { recursive: true, force: true })
    rmSync(outA, { recursive: true, force: true })
  } catch (e) {}
}
try { rmSync(workspace, { recursive: true, force: true }); rmSync(dshHome, { recursive: true, force: true }) } catch (e) {}

// ─────────────────────────────────────────────────────────────
group('16. 拒绝原因（reason）：分类默认值 / 兜底 / 快捷工具三处都能写，且只随 deny 回给 AI')
{
  const wsR = mkdtempSync(join(tmpdir(), 'pg-reason-ws-'))
  const homeR = mkdtempSync(join(tmpdir(), 'pg-reason-home-'))
  mkdirSync(join(homeR, 'dsh-permgate'), { recursive: true })
  const hR = createHost({ workspaceRoot: wsR, dshHome: homeR })
  const preR = hR.hooks.get('tools/pre-execute')
  const post = (url, body) => callRoute(hR.routes, 'POST', url, Object.assign({ lang: 'zh', sessionId: 'sess-1' }, body))
  const lastDecision = async (tool) => {
    const st = await callRoute(hR.routes, 'GET', '/permgate/status')
    return ((st.data && st.data.recentDecisions) || []).filter((d) => d.tool === tool).pop()
  }
  // 直接问宿主要判定结果：deny 时 pre-execute 返回的 reason 就是回给 AI 的文本
  const runTool = async (name, args) => {
    let out = null
    const p = preR(makeExec(wsR, name, args || {}), async () => { out = { kind: 'allow' }; return out })
    p.catch(() => {})
    const raced = await Promise.race([p, new Promise((r) => setTimeout(() => r(null), 400))])
    return raced || out
  }

  // (a) 分类默认值：deny + reason → 该分类的调用被拒时带上原因
  const sc = await post('/permgate/set-category', { target: 'project', category: 'command', mode: 'deny', reason: '这个项目不许执行命令' })
  ok('group16: 分类默认值可写入拒绝原因', !!(sc.data && sc.data.categories.project.command.reason === '这个项目不许执行命令'), JSON.stringify(sc.data && sc.data.categories.project.command))
  const outCmd = await runTool('pwsh', { command: 'echo hi' })
  ok('group16: 分类默认值拒绝时把原因回给 AI', !!outCmd && outCmd.kind === 'deny' && String(outCmd.reason).indexOf('这个项目不许执行命令') !== -1, JSON.stringify(outCmd))
  const decCmd = await lastDecision('pwsh')
  ok('group16: 决策记录里也带该原因', !!decCmd && String(decCmd.reason).indexOf('这个项目不许执行命令') !== -1, JSON.stringify(decCmd && decCmd.reason))

  // (b) 切成别的动作时原因被清掉（不留僵尸文字），切回 deny 也不会自己冒出来
  const sc2 = await post('/permgate/set-category', { target: 'project', category: 'command', mode: 'ask' })
  ok('group16: 切离 deny 时分类拒绝原因被清除', !!(sc2.data && sc2.data.categories.project.command.reason === undefined), JSON.stringify(sc2.data && sc2.data.categories.project.command))

  // (c) 兜底：deny + reason → 未匹配任何规则的调用被拒时带上原因
  const sf = await post('/permgate/set-fallback', { target: 'project', mode: 'deny', reason: '兜底：未知工具一律拒绝' })
  ok('group16: 兜底可写入拒绝原因', !!(sf.data && sf.data.fallback.projectReason === '兜底：未知工具一律拒绝'), JSON.stringify(sf.data && sf.data.fallback))
  const outUnk = await runTool('mcp__not-a-preset', {})
  ok('group16: 兜底拒绝时把原因回给 AI', !!outUnk && outUnk.kind === 'deny' && String(outUnk.reason).indexOf('兜底：未知工具一律拒绝') !== -1, JSON.stringify(outUnk))

  // (d) 快捷工具：deny + reason（对象形态落盘）→ 该工具被拒时带上原因
  const sq = await post('/permgate/set-quick', { target: 'global', tool: 'web_search', action: 'deny', reason: '联网检索需走人工' })
  ok('group16: 快捷工具按对象形态落盘（action + reason）', !!(sq.data && sq.data.quickTools.global.web_search && sq.data.quickTools.global.web_search.action === 'deny' && sq.data.quickTools.global.web_search.reason === '联网检索需走人工'), JSON.stringify(sq.data && sq.data.quickTools.global.web_search))
  const outWs = await runTool('web_search', {})
  ok('group16: 快捷工具拒绝时把原因回给 AI', !!outWs && outWs.kind === 'deny' && String(outWs.reason).indexOf('联网检索需走人工') !== -1, JSON.stringify(outWs))

  // (e) 老配置（裸字符串）仍被正常读入，且 reason 只在 deny 时保留
  const sq2 = await post('/permgate/set-quick', { target: 'global', tool: 'web_search', action: 'allow', reason: '不该被存下' })
  ok('group16: 非 deny 动作不保留快捷工具原因', !!(sq2.data && sq2.data.quickTools.global.web_search && sq2.data.quickTools.global.web_search.reason === undefined && sq2.data.quickTools.global.web_search.action === 'allow'), JSON.stringify(sq2.data && sq2.data.quickTools.global.web_search))

  // (e2) ★★ 自定义规则的 reason（本组唯一的**裸字符串** reason 来源）→ 必须回给 AI。
  // 回归背景：normalizeRule 把 reason 收敛成 String（配置是给人读改的 JSON，落成 {zh,en}
  // 会让用户没法手写），而其余 24 个出口都走 bi() 产出 {zh,en}。pre-execute 回传时统一走
  // L(d.reason, uiLang)，旧实现只认对象 → 对字符串取 .zh/.en 恒 undefined → 回落空串。
  // 实测症状：**填了 reason 的规则回给 AI 的是空串，不填时反倒能显示回落文案**。
  // 这条必须端到端断言（走真实 pre-execute 返回值），只测 L() 本身不够 ——
  // 当初的缺陷正是「L 用对了地方、但用错了语义」。
  const addR = await post('/permgate/add-rule', { target: 'project', action: 'deny', tool: 'my_custom_tool', reason: '自定义规则的拒绝原因' })
  ok('group16: 自定义规则带 reason 写入成功', !!(addR.data && addR.data.added && addR.data.added.reason === '自定义规则的拒绝原因'), JSON.stringify(addR.data && (addR.data.error || addR.data.added)))
  const outRule = await runTool('my_custom_tool', {})
  ok('★★ group16: 自定义规则的 reason 回给 AI（裸字符串不得被静默丢弃）',
    !!outRule && outRule.kind === 'deny' && String(outRule.reason).indexOf('自定义规则的拒绝原因') !== -1, JSON.stringify(outRule))
  // 对照：未填 reason 时走回落文案 —— 证明上一条不是「恒返回某个非空串」导致的假通过
  const addR2 = await post('/permgate/add-rule', { target: 'project', action: 'deny', tool: 'my_custom_tool2' })
  ok('group16: 无 reason 的规则写入成功（对照前置）', !!(addR2.data && addR2.data.added), JSON.stringify(addR2.data && addR2.data.error))
  const outRule2 = await runTool('my_custom_tool2', {})
  ok('★ group16: 无 reason 时回落「自定义规则 rx 命中」文案（与上一条互为对照）',
    !!outRule2 && outRule2.kind === 'deny'
    && String(outRule2.reason).indexOf('自定义规则') !== -1 && String(outRule2.reason).indexOf('自定义规则的拒绝原因') === -1,
    JSON.stringify(outRule2))
  // 决策记录（会随 perm_status 下发给 AI）同样必须带上它 —— 这条走的是 statusView 的
  // recentDecisions 分支，与 pre-execute 的返回值是**两条独立的取值路径**，都要覆盖。
  const decRule = await lastDecision('my_custom_tool')
  ok('★★ group16: 决策记录里也带自定义规则的原因（recentDecisions 是另一条取值路径）',
    !!decRule && String(decRule.reason).indexOf('自定义规则的拒绝原因') !== -1, JSON.stringify(decRule && decRule.reason))
  // 清掉这两条规则，避免影响本组后续用例（它们都是 deny 且匹配具体工具名，影响面有限，
  // 但 my_custom_tool 前缀与后续「兜底」用例的未匹配工具名形态相近，清掉更稳）
  for (const rr of [addR, addR2]) {
    const id = rr.data && rr.data.added && rr.data.added.id
    if (id) await post('/permgate/remove-rule', { target: 'project', id: id })
  }

  // (f) 未提供 reason 的写入必须保留原值：perm_*/HTTP 只想重设动作或确认当前值时，
  // 不得把用户写好的拒绝原因静默删掉（曾经「不传 reason」被当成「清除 reason」）
  const keep1 = await post('/permgate/set-category', { target: 'project', category: 'command', mode: 'deny', reason: '保留测试' })
  ok('group16: 分类原因已写入（前置）', !!(keep1.data && keep1.data.categories.project.command.reason === '保留测试'), JSON.stringify(keep1.data && keep1.data.categories.project.command))
  const keep2 = await post('/permgate/set-category', { target: 'project', category: 'command', mode: 'deny' })
  ok('group16: 分类同动作重设且不传 reason 时保留原原因', !!(keep2.data && keep2.data.categories.project.command.reason === '保留测试'), JSON.stringify(keep2.data && keep2.data.categories.project.command))
  const keep3 = await post('/permgate/set-category', { target: 'project', category: 'command', mode: 'deny', reason: '' })
  ok('group16: 显式传空串才清除分类原因', !!(keep3.data && keep3.data.categories.project.command.reason === undefined), JSON.stringify(keep3.data && keep3.data.categories.project.command))

  const keepF1 = await post('/permgate/set-fallback', { target: 'project', mode: 'deny', reason: '兜底保留测试' })
  const keepF2 = await post('/permgate/set-fallback', { target: 'project', mode: 'deny' })
  ok('group16: 兜底同动作重设且不传 reason 时保留原原因', !!(keepF1.data && keepF2.data && keepF2.data.fallback.projectReason === '兜底保留测试'), JSON.stringify(keepF2.data && keepF2.data.fallback))

  const keepQ1 = await post('/permgate/set-quick', { target: 'global', tool: 'web_search', action: 'deny', reason: '快捷保留测试' })
  const keepQ2 = await post('/permgate/set-quick', { target: 'global', tool: 'web_search', action: 'deny' })
  ok('group16: 快捷工具同动作重设且不传 reason 时保留原原因', !!(keepQ1.data && keepQ2.data && keepQ2.data.quickTools.global.web_search.reason === '快捷保留测试'), JSON.stringify(keepQ2.data && keepQ2.data.quickTools.global.web_search))
  const keepQ3 = await post('/permgate/set-quick', { target: 'global', tool: 'web_search', action: 'allow' })
  ok('group16: 快捷工具切离 deny 时原因被清除', !!(keepQ3.data && keepQ3.data.quickTools.global.web_search.reason === undefined && keepQ3.data.quickTools.global.web_search.action === 'allow'), JSON.stringify(keepQ3.data && keepQ3.data.quickTools.global.web_search))

  // (h) 面板「新增工具名」行：选拒绝时原因必须一并写入（否则用户只能先添加、再到该行补填）
  const addQ = await post('/permgate/set-quick', { target: 'global', tool: 'todo_write', action: 'deny', reason: '新增行的原因' })
  ok('group16: 新增行带 reason 一次写入成功', !!(addQ.data && addQ.data.quickTools.global.todo_write && addQ.data.quickTools.global.todo_write.action === 'deny' && addQ.data.quickTools.global.todo_write.reason === '新增行的原因'), JSON.stringify(addQ.data && addQ.data.quickTools.global.todo_write))
  const outAdd = await runTool('todo_write', {})
  ok('group16: 新增行的原因同样回给 AI', !!outAdd && outAdd.kind === 'deny' && String(outAdd.reason).indexOf('新增行的原因') !== -1, JSON.stringify(outAdd))

  // (i) 宿主 reason 三态契约的固定：undefined=保留原值、''=显式清除。
  // 注意本文件只加载宿主 index.js，**不加载面板 client.js**，所以这一段固定的是宿主侧语义，
  // 不是面板行为。它之所以值得钉住：面板「新增工具名」行允许输入本层已存在的工具名，
  // 面板侧必须把「没填原因」折叠成 undefined（见 regressions.mjs 的对应守卫），
  // 否则一旦原样下发空串，宿主就会走「显式清除」分支，把该键已保存的拒绝原因静默删掉。
  // 面板侧的回归守卫在 test/regressions.mjs（字符串断言），此处只保证宿主契约不被改坏。
  const seedKeep = await post('/permgate/set-quick', { target: 'global', tool: 'todo_write', action: 'deny', reason: '既有的原因' })
  ok('group16: 重名新增前先写入非空原因（前置，避免断言空转）', !!(seedKeep.data && seedKeep.data.quickTools.global.todo_write.reason === '既有的原因'), JSON.stringify(seedKeep.data && seedKeep.data.quickTools.global.todo_write))
  const blankAdd = await post('/permgate/set-quick', { target: 'global', tool: 'todo_write', action: 'deny' })
  ok('group16: 宿主契约——不下发 reason（undefined）保留既有原因', !!(blankAdd.data && blankAdd.data.quickTools.global.todo_write.reason === '既有的原因'), JSON.stringify(blankAdd.data && blankAdd.data.quickTools.global.todo_write))
  const emptyAdd = await post('/permgate/set-quick', { target: 'global', tool: 'todo_write', action: 'deny', reason: '' })
  ok('group16: 宿主契约——显式空串仍按「清除」处理', !!(emptyAdd.data && emptyAdd.data.quickTools.global.todo_write.reason === undefined), JSON.stringify(emptyAdd.data && emptyAdd.data.quickTools.global.todo_write))

  // (g) 面板清空输入框的等价请求：必须真的清除，而不是被当成「未提供」保留原值。
  // 回归背景：面板曾用 `|| undefined` 把空串折叠掉，于是清空后 reason 键根本不发出，
  // 服务端走「保留原值」分支 → 旧文字被 statusView 回填，用户永远删不掉写错的原因。
  // 注意必须先写入非空原因，否则前置值本就是 undefined，断言会空转（不能区分「清除」与「保留」）。
  const clearCat0 = await post('/permgate/set-category', { target: 'project', category: 'command', mode: 'deny', reason: '待清空' })
  ok('group16: 清空前先写入非空分类原因（前置，避免断言空转）', !!(clearCat0.data && clearCat0.data.categories.project.command.reason === '待清空'), JSON.stringify(clearCat0.data && clearCat0.data.categories.project.command))
  const clearCat = await post('/permgate/set-category', { target: 'project', category: 'command', mode: 'deny', reason: '' })
  ok('group16: 面板清空分类原因（reason=""）真的清除', !!(clearCat.data && clearCat.data.categories.project.command.reason === undefined), JSON.stringify(clearCat.data && clearCat.data.categories.project.command))
  const clearFb = await post('/permgate/set-fallback', { target: 'project', mode: 'deny', reason: '' })
  ok('group16: 面板清空兜底原因（reason=""）真的清除', !!(clearFb.data && clearFb.data.fallback.projectReason === null), JSON.stringify(clearFb.data && clearFb.data.fallback))

  try { rmSync(wsR, { recursive: true, force: true }); rmSync(homeR, { recursive: true, force: true }) } catch (e) {}
}

// ─────────────────────────────────────────────────────────────
group('17. 非 UTF-8 预览：有 dsh-fs-encoding 服务就复用，没有也不出问题')
{
  // 用真实的 LocalFileSystem（UTF-8-only 契约），验证两种部署：
  //   ① 未安装 dsh-fs-encoding（ctx.get('fsEncoding') 为 undefined）→ 维持原报错，不崩；
  //   ② 已安装（注入一个符合服务契约的桩）→ 预览出内容，并如实透传 decided。
  // 服务契约取自 dsh-fs-encoding/src/service.ts：
  //   tryDecode(bytes, opts) → { ok:true, result:{ text, encoding, decided, hasBOM, lineEnding } }
  //                          | { ok:false, refusal:{ message, code, candidates, ranked, adoptable, autoGuessEnabled } }
  const GBK = Buffer.from([0xC4, 0xE3, 0xBA, 0xC3, 0xA3, 0xAC, 0xCA, 0xC0, 0xBD, 0xE7, 0x0A, 0x68, 0x69, 0x0A])

  // opts: { bytes 自定义样本, tool/args/category 自定义审批目标 }
  // 默认是 read 审批（group17 早期用例的形态）；写类路径（write/edit）需显式传入，
  // 否则「非 UTF-8 + 服务在场的写类预览标注」永远没有行为覆盖。
  const mk = async (label, fsEncoding, opts) => {
    const o = opts || {}
    const tool = o.tool || 'read'
    const category = o.category || (tool === 'read' ? 'read' : 'edit')
    const ws = mkdtempSync(join(tmpdir(), 'pg-svc-ws-'))
    const home = mkdtempSync(join(tmpdir(), 'pg-svc-home-'))
    mkdirSync(join(home, 'dsh-permgate'), { recursive: true })
    const h = createHost({ workspaceRoot: ws, dshHome: home, fsEncoding })
    const pre = h.hooks.get('tools/pre-execute')
    const p = join(ws, 'gbk.txt')
    const sample = o.bytes || GBK
    writeFileSync(p, sample)
    // 前置：确认这份字节确实非法 UTF-8，否则后面的断言会空转
    let strictFails = false
    try { new TextDecoder('utf-8', { fatal: true }).decode(sample) } catch (e) { strictFails = true }
    ok('group17: [' + label + '] 前置——样本确实非法 UTF-8', strictFails)
    // 默认 allow，需改 ask 才会进审批。用 project 层，避免碰 global
    await callRoute(h.routes, 'POST', '/permgate/set-category', { target: 'project', category, mode: 'ask', lang: 'zh', sessionId: 'sess-1' })
    const args = o.args ? o.args(p) : { file_path: p }
    const pending = pre(makeExec(ws, tool, args), async () => ({ kind: 'allow' }))
    pending.catch(() => {})
    await new Promise((r) => setTimeout(r, 80))
    const list = await callRoute(h.routes, 'GET', '/permgate/pending')
    const item = (Array.isArray(list.data) ? list.data : []).filter((x) => x.tool === tool).pop()
    ok('group17: [' + label + '] GBK 文件进入审批', !!item)
    const diff = await callRoute(h.routes, 'POST', '/permgate/file-diff', { id: item && item.id, lang: 'zh' })
    if (item) await callRoute(h.routes, 'POST', '/permgate/decide', { id: item.id, action: 'deny', lang: 'zh' })
    await Promise.race([pending, new Promise((r) => setTimeout(r, 200))])
    try { rmSync(ws, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }) } catch (e) {}
    return diff.data
  }

  // ① 未安装该插件：维持原报错（不得崩、不得自己猜）
  const d1 = await mk('无服务', undefined)
  ok('group17: 无服务时返回 ok:false（维持原行为）', !!(d1 && d1.ok === false), JSON.stringify(d1 && d1.ok))
  ok('group17: 无服务时报错仍是 invalid UTF-8 text', !!(d1 && /invalid UTF-8 text/.test(String((d1.error && d1.error.zh) || d1.error))), JSON.stringify(d1 && d1.error))

  // ② 已安装（桩）：预览出内容，decided 如实透传
  const svc = {
    tryDecode: async () => ({ ok: true, result: { text: '你好，世界\nhi\n', encoding: 'gbk', decided: 'guessed', hasBOM: false, lineEnding: '\n' } }),
  }
  const d2 = await mk('有服务', svc)
  ok('group17: 有服务时预览成功', !!(d2 && d2.ok === true), JSON.stringify(d2 && d2.error))
  ok('group17: 解出正确内容', !!(d2 && d2.ok && String(d2.text).indexOf('你好，世界') === 0), JSON.stringify(d2 && d2.text))
  ok('group17: 透传 encoding=gbk 与 decided=guessed', !!(d2 && d2.encoding === 'gbk' && d2.decided === 'guessed'), JSON.stringify(d2 && { enc: d2.encoding, decided: d2.decided }))

  // ③ 服务拒绝（猜测关闭 / 二进制）：带出服务的说明，而非 ctx.fs 的泛化报错
  const refuseSvc = { tryDecode: async () => ({ ok: false, refusal: { message: 'E_NOT_TEXT: not decodable text; enable autoGuessEncoding or re-read with an explicit encoding', code: 'E_NOT_TEXT' } }) }
  const d3 = await mk('服务拒绝', refuseSvc)
  ok('group17: 服务拒绝时带出服务自己的说明', !!(d3 && d3.ok === false && /E_NOT_TEXT/.test(String((d3.error && d3.error.zh) || d3.error))), JSON.stringify(d3 && d3.error))

  // ④ 服务抛异常（契约说不会，消费方仍须兜住）：退回原报错，不崩
  const throwSvc = { tryDecode: async () => { throw new Error('boom') } }
  const d4 = await mk('服务抛异常', throwSvc)
  ok('group17: 服务抛异常时退回原报错（不崩）', !!(d4 && d4.ok === false && /invalid UTF-8 text/.test(String((d4.error && d4.error.zh) || d4.error))), JSON.stringify(d4 && d4.error))

  // ⑤ 回归：UTF-8 文件在两种部署下都必须正常（服务不该被调用）
  {
    const ws = mkdtempSync(join(tmpdir(), 'pg-svc-utf8-'))
    const home = mkdtempSync(join(tmpdir(), 'pg-svc-utf8h-'))
    mkdirSync(join(home, 'dsh-permgate'), { recursive: true })
    let called = false
    const spy = { tryDecode: async () => { called = true; return { ok: true, result: { text: 'x', encoding: 'gbk', decided: 'guessed' } } } }
    const h = createHost({ workspaceRoot: ws, dshHome: home, fsEncoding: spy })
    const pre = h.hooks.get('tools/pre-execute')
    const p = join(ws, 'utf8.txt')
    writeFileSync(p, '你好，世界\nhi\n', 'utf8')
    await callRoute(h.routes, 'POST', '/permgate/set-category', { target: 'project', category: 'read', mode: 'ask', lang: 'zh', sessionId: 'sess-1' })
    const pending = pre(makeExec(ws, 'read', { file_path: p }), async () => ({ kind: 'allow' }))
    pending.catch(() => {})
    await new Promise((r) => setTimeout(r, 80))
    const list = await callRoute(h.routes, 'GET', '/permgate/pending')
    const item = (Array.isArray(list.data) ? list.data : []).filter((x) => x.tool === 'read').pop()
    const diff = await callRoute(h.routes, 'POST', '/permgate/file-diff', { id: item && item.id, lang: 'zh' })
    const d = diff.data
    ok('group17: UTF-8 文件预览正常且未调用解码服务', !!(d && d.ok === true && String(d.text).indexOf('你好，世界') === 0 && called === false), JSON.stringify(d && { ok: d.ok, called: called }))
    if (item) await callRoute(h.routes, 'POST', '/permgate/decide', { id: item.id, action: 'deny', lang: 'zh' })
    await Promise.race([pending, new Promise((r) => setTimeout(r, 200))])
    try { rmSync(ws, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }) } catch (e) {}
  }

  // ⑥ 大文件必须仍可预览：交给解码服务的字节上限曾误取 DIFF_MAX_CHARS(1MiB)，
  // 把服务本来能解码的 1~10MiB 非 UTF-8 文件提前拦成 FS_TOO_LARGE。该上限只作
  // 本插件的内存硬保护（服务自己的 maxFileBytes 可配置且未暴露读取接口，无法对齐），
  // 故须取得远高于服务的默认业务上限，业务判定交给服务的 E_TOO_LARGE。
  {
    const unit = Buffer.from([0xC4, 0xE3, 0xBA, 0xC3, 0xA3, 0xAC]) // 「你好，」
    const twoMB = Buffer.concat(Array.from({ length: Math.floor((2 * 1024 * 1024) / unit.length) }, () => unit))
    let sawBytes = 0
    const bigSvc = {
      tryDecode: async (bytes) => {
        sawBytes = bytes.length
        return { ok: true, result: { text: '你好，世界\nhi\n', encoding: 'gbk', decided: 'guessed', hasBOM: false, lineEnding: '\n' } }
      },
    }
    const d6 = await mk('2MB 大文件', bigSvc, { bytes: twoMB })
    ok('group17: 2MB 非 UTF-8 文件仍能交给服务解码（上限未误收紧）',
      !!(d6 && d6.ok === true && sawBytes > 1024 * 1024), JSON.stringify(d6 && { ok: d6.ok, sawBytes: sawBytes, err: d6.error }))
  }

  // ⑦ 混合编码文件（前段合法 UTF-8 + 尾部 GBK 字节）：streamText 会先 yield 出
  // 若干块、之后才抛，回退分支若不复位 out/outBytes 就会把窗口再追加一遍，
  // 预览出现大段重复行与行号错位（实测曾把 400 行文件渲染成 729 行）。
  {
    const head = Array.from({ length: 400 }, (_, i) => 'ROW' + String(i + 1).padStart(4, '0') + ' ' + 'x'.repeat(190)).join('\n') + '\n'
    const mixed = Buffer.concat([Buffer.from(head, 'utf8'), Buffer.from([0xC4, 0xE3, 0xBA, 0xC3, 0xA3, 0xAC, 0x0A])])
    const mixedSvc = {
      tryDecode: async (bytes) => ({
        ok: true,
        result: { text: Buffer.from(bytes).toString('latin1').replace(/\xC4\xE3\xBA\xC3\xA3\xAC/g, '你好，'), encoding: 'gbk', decided: 'guessed', hasBOM: false, lineEnding: '\n' },
      }),
    }
    const d7 = await mk('混合编码大文件', mixedSvc, { bytes: mixed })
    const rows = d7 && d7.ok === true ? String(d7.text).split('\n') : []
    const first = rows[0] || ''
    const dupCount = rows.filter((r) => r === first).length
    ok('group17: 混合编码大文件预览不重复、行数正确（回退分支已复位流式残留状态）',
      !!(d7 && d7.ok === true && rows.length === 400 && dupCount === 1 && first.indexOf('ROW0001') === 0),
      JSON.stringify({ ok: d7 && d7.ok, rows: rows.length, dupOfFirstRow: dupCount, first: first.slice(0, 12) }))
  }

  // ⑧ 写类预览（edit）的编码标注必须有**行为覆盖**：group17 此前只触发 read 审批，
  // 而「写类 diff / 撤销预览曾整块漏挂编码标注」正是本轮要防的事——纯文本断言
  // （源码里出现 encoding/decided 字样）证明不了数据真的流到 payload。
  {
    const svc = { tryDecode: async () => ({ ok: true, result: { text: '你好世界\n第二行\n', encoding: 'gbk', decided: 'guessed', hasBOM: false, lineEnding: '\n' } }) }
    const d8 = await mk('写类 edit 预览', svc, {
      tool: 'edit',
      args: (p) => ({ file_path: p, old_string: '你好世界', new_string: '再见世界' }),
    })
    ok('group17: 写类 edit 预览带 encoding/decided（透传到 payload）',
      !!(d8 && d8.ok === true && d8.encoding === 'gbk' && d8.decided === 'guessed'),
      JSON.stringify(d8 && { ok: d8.ok, encoding: d8.encoding, decided: d8.decided, err: d8.error }))
  }

  // ⑨ 并发两次 file-diff 必须各自拿到自己的编码：编码来源曾挂在 entry 上（跨请求
  // 共享可变状态），而 file-diff 路由无按 id 串行化——两个并发请求会交错读写同一
  // 字段，先完成的那次会丢掉标注、或拿到另一次请求的编码（实测复现）。
  {
    const ws = mkdtempSync(join(tmpdir(), 'pg-svc-race-'))
    const home = mkdtempSync(join(tmpdir(), 'pg-svc-raceh-'))
    mkdirSync(join(home, 'dsh-permgate'), { recursive: true })
    let seq = 0
    // 交替返回两种可区分的编码，便于识别「拿到别人的值」
    const svc = { tryDecode: async () => { seq++; const n = seq; return { ok: true, result: { text: '你好世界\n', encoding: n % 2 ? 'gbk' : 'big5', decided: n % 2 ? 'guessed' : 'bom', hasBOM: false, lineEnding: '\n' } } } }
    const h = createHost({ workspaceRoot: ws, dshHome: home, fsEncoding: svc })
    const pre = h.hooks.get('tools/pre-execute')
    const p = join(ws, 'gbk.txt')
    writeFileSync(p, GBK)
    await callRoute(h.routes, 'POST', '/permgate/set-category', { target: 'project', category: 'edit', mode: 'ask', lang: 'zh', sessionId: 'sess-1' })
    const pending = pre(makeExec(ws, 'edit', { file_path: p, old_string: '你好世界', new_string: '再见世界' }), async () => ({ kind: 'allow' }))
    pending.catch(() => {})
    await new Promise((r) => setTimeout(r, 80))
    const list = await callRoute(h.routes, 'GET', '/permgate/pending')
    const item = (Array.isArray(list.data) ? list.data : []).filter((x) => x.tool === 'edit').pop()
    const [ra, rb] = await Promise.all([
      callRoute(h.routes, 'POST', '/permgate/file-diff', { id: item && item.id, lang: 'zh' }),
      callRoute(h.routes, 'POST', '/permgate/file-diff', { id: item && item.id, lang: 'zh' }),
    ])
    const da = ra && ra.data
    const db = rb && rb.data
    ok('group17: 并发两次 file-diff 都带标注（编码来源不挂 entry）',
      !!(da && db && da.ok === true && db.ok === true && da.encoding && da.decided && db.encoding && db.decided),
      JSON.stringify({ a: da && { enc: da.encoding, dec: da.decided }, b: db && { enc: db.encoding, dec: db.decided } }))
    if (item) await callRoute(h.routes, 'POST', '/permgate/decide', { id: item.id, action: 'deny', lang: 'zh' })
    await Promise.race([pending, new Promise((r) => setTimeout(r, 200))])
    try { rmSync(ws, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }) } catch (e) {}
  }
}

// ── 18. insert / undo_edit 并入文件类分类闸（可选依赖：未装 dsh-fs-encoding 时这些名字不存在）──
group('18. dsh-fs-encoding 的 insert / str_replace_editor.undo_edit 并入 edit / undo 分类')
{
  const SRE_BUILTIN = {
    description: 'Custom editing tool for viewing, creating and editing files',
    parameters: { type: 'object', properties: {
      command: { description: 'The commands to run. Allowed options are: view, create, str_replace, insert.' },
      insert_line: { description: 'Required integer parameter of `insert` command. The `new_str` will be inserted AFTER the line `insert_line` of `path`.' },
    } },
  }
  const SRE_FSENC = {
    description: 'View, create and edit text files by exact string match, preserving each file\'s encoding. Commands: `view` {path} shows numbered lines; `insert` {path, insert_line, new_str} inserts AFTER insert_line (0 is the top); `undo_edit` {path} reverts the last edit, exactly like `undo_last_edit`.',
    parameters: { type: 'object', properties: {
      command: { description: 'The command to run. One of: view, create, str_replace, insert, undo_edit.' },
      insert_line: { description: 'For `insert`: the line number to insert AFTER. 0 inserts at the very top; the number of lines in the file appends.' },
    } },
  }

  // 分类全 deny + 兜底 allow：命中分类闸 → 弹窗（ask 态记为 cat）；掉到兜底 → 直接放行。
  // 这样「是否被闸住」与「落在哪个分类」一次跑出来。
  async function probe18(sreDef, name, args, askCat) {
    const ws = mkdtempSync(join(tmpdir(), 'pg-g18-ws-'))
    const home = mkdtempSync(join(tmpdir(), 'pg-g18-home-'))
    mkdirSync(join(home, 'dsh-permgate'), { recursive: true })
    const h = createHost({ workspaceRoot: ws, dshHome: home })
    h.ctx.tools.get = () => sreDef
    await callRoute(h.routes, 'POST', '/permgate/set-fallback', { target: 'global', mode: 'allow' })
    for (const c of ['edit', 'undo', 'read', 'directory']) {
      await callRoute(h.routes, 'POST', '/permgate/set-category', { target: 'global', category: c, mode: 'deny' })
    }
    // 目标分类改 ask：deny 会直接拒绝、不弹窗，看不到落点；ask 才能从 pending 里读出 cat
    if (askCat) await callRoute(h.routes, 'POST', '/permgate/set-category', { target: 'global', category: askCat, mode: 'ask' })
    const file = join(ws, 'a.txt')
    // 固定 3 行内容：本组的上限边界断言（insert_line=3 可、=4 越界）就按这个行数设计
    writeFileSync(file, 'l1\nl2\nl3\n', 'utf8')
    const realArgs = JSON.parse(JSON.stringify(args).replace(/__FILE__/g, file.replace(/\\/g, '\\\\')))
    const exec = makeExec(ws, name, realArgs)
    const hook = h.hooks.get('tools/pre-execute')
    let nextCalled = false
    const { done, mark } = settleFlag()
    const pending = hook(exec, async () => { nextCalled = true; return { kind: 'allow' } })
    pending.then(mark, mark)
    // 与 runApproval 同一等待助手（不传 host 会去等模块级 host 的 pending，永远等不到）
    const item = await awaitPending(name, done, h)
    let diff = null
    if (item) {
      const d = await withTimeout(callRoute(h.routes, 'POST', '/permgate/file-diff', { id: item.id, lang: 'zh' }), 'g18 file-diff')
      diff = d && d.data
      await callRoute(h.routes, 'POST', '/permgate/decide', { id: item.id, action: 'deny', lang: 'zh' })
    }
    await withTimeout(pending, 'g18 settle')
    const verdict = item ? 'ask' : (nextCalled ? 'allow' : 'deny')
    // pending 不下发 cat（只有 id/tool/reason/intent/...）。分类从 reason 文案里读：
    // 「编辑权限…」「撤销权限…」「读取权限…」分别是 edit / undo / read 三条闸的措辞；
    // intent 是动作描述（「写入/修改文件 …」），不带分类名，不能用来判分类。
    const reason = item ? String(item.reason || '') : ''
    const cat = /撤销权限/.test(reason) ? 'undo'
      : (/编辑权限/.test(reason) ? 'edit'
        : (/读取权限/.test(reason) ? 'read' : null))
    try { rmSync(ws, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }) } catch (e) {}
    return { verdict, cat, diff }
  }

  // insert 是 dsh-fs-encoding 的独立工具：会写盘 ⇒ 必须落 edit 闸（旧行为掉兜底，静默放行）
  const i1 = await probe18(SRE_BUILTIN, 'insert', { file_path: '__FILE__', insert_line: 1, new_string: 'NEW' }, 'edit')
  ok('group18: insert 落 edit 闸（不再掉兜底）', i1.verdict === 'ask' && i1.cat === 'edit', JSON.stringify({ v: i1.verdict, cat: i1.cat }))
  // 形状判定独立于内核：没有 sre 定义时同样认得出
  const i2 = await probe18(null, 'insert', { file_path: '__FILE__', insert_line: 1, new_string: 'NEW' }, 'edit')
  ok('group18: 内核探测不到时 insert 仍落 edit 闸', i2.verdict === 'ask' && i2.cat === 'edit', JSON.stringify({ v: i2.verdict, cat: i2.cat }))
  // 同名但非文件语义的 insert（数据库类）不得被误判 —— 应掉兜底放行
  const i3 = await probe18(SRE_BUILTIN, 'insert', { collection: 'users', document: { a: 1 } })
  ok('group18: 非文件形状的同名 insert 不误判', i3.verdict === 'allow' && !i3.cat, JSON.stringify({ v: i3.verdict, cat: i3.cat }))
  // 预览：insert_line=0 插到最顶端，insert_line=2 插到第 2 行之后（不得折算成 old_string='' 的 edit）
  const i4 = await probe18(SRE_BUILTIN, 'insert', { file_path: '__FILE__', insert_line: 0, new_string: 'NEW' }, 'edit')
  ok('group18: insert_line=0 预览插在最顶端', !!(i4.diff && i4.diff.ok && i4.diff.ops && i4.diff.ops[0] && i4.diff.ops[0].t === 'a' && i4.diff.ops[0].s === 'NEW'), JSON.stringify(i4.diff && i4.diff.ops && i4.diff.ops.slice(0, 3)))
  const i5 = await probe18(SRE_BUILTIN, 'insert', { file_path: '__FILE__', insert_line: 2, new_string: 'NEW' }, 'edit')
  ok('group18: insert_line=2 预览插在第 2 行之后', !!(i5.diff && i5.diff.ok && i5.diff.ops && i5.diff.ops[2] && i5.diff.ops[2].t === 'a'), JSON.stringify(i5.diff && i5.diff.ops && i5.diff.ops.slice(0, 4)))
  // 上限口径：3 行文件的合法范围是 [0,3]，4 必须被拒（用 splitDiffLines(...).length 会多算一行而放过 4）
  const i6 = await probe18(SRE_BUILTIN, 'insert', { file_path: '__FILE__', insert_line: 3, new_string: 'NEW' }, 'edit')
  ok('group18: insert_line=3（3 行文件的合法上限）可预览', !!(i6.diff && i6.diff.ok === true), JSON.stringify(i6.diff && i6.diff.error))
  const i7 = await probe18(SRE_BUILTIN, 'insert', { file_path: '__FILE__', insert_line: 4, new_string: 'NEW' }, 'edit')
  ok('group18: insert_line=4 越界被拒', !!(i7.diff && i7.diff.ok === false), JSON.stringify(i7.diff))

  // undo_last_edit 恒落 undo 闸（两个插件都注册这个名字）
  const u1 = await probe18(SRE_BUILTIN, 'undo_last_edit', { file_path: '__FILE__' }, 'undo')
  ok('group18: undo_last_edit 落 undo 闸', u1.verdict === 'ask' && u1.cat === 'undo', JSON.stringify({ v: u1.verdict, cat: u1.cat }))
  // undo_edit 的写盘与否随内核：内置没有该命令 ⇒ 不写盘 ⇒ 不占用 undo 闸（掉兜底）
  const u2 = await probe18(SRE_BUILTIN, 'str_replace_editor', { command: 'undo_edit', path: '__FILE__' })
  ok('group18: 内置内核的 undo_edit 不占用 undo 闸（该命令不存在）', u2.verdict === 'allow' && !u2.cat, JSON.stringify({ v: u2.verdict, cat: u2.cat }))
  // dsh-fs-encoding 的 undo_edit 真写盘 ⇒ 必须落 undo 闸
  const u3 = await probe18(SRE_FSENC, 'str_replace_editor', { command: 'undo_edit', path: '__FILE__' }, 'undo')
  ok('group18: fs-encoding 内核的 undo_edit 落 undo 闸', u3.verdict === 'ask' && u3.cat === 'undo', JSON.stringify({ v: u3.verdict, cat: u3.cat }))
  // 探测不到描述 ⇒ fail-closed，按会写盘拦住
  const u4 = await probe18(null, 'str_replace_editor', { command: 'undo_edit', path: '__FILE__' }, 'undo')
  ok('group18: 探测不到内核时 undo_edit 按会写盘拦住（fail-closed）', u4.verdict === 'ask' && u4.cat === 'undo', JSON.stringify({ v: u4.verdict, cat: u4.cat }))
  // 撤销预览文案中性：读不到记录 ≠ 会被跳过（fs-encoding 的记录只在内存里）
  ok('group18: 撤销预览为中性文案（不说「会被跳过」）', !!(u1.diff && u1.diff.ok === false && /无法预览撤销内容/.test(u1.diff.error) && !/跳过/.test(u1.diff.error)), JSON.stringify(u1.diff))
  // 同类闸不得误伤：view 仍走 read
  const u5 = await probe18(SRE_FSENC, 'str_replace_editor', { command: 'view', path: '__FILE__' }, 'read')
  ok('group18: sre view 仍落 read 闸（未被 undo 判定误伤）', u5.verdict === 'ask' && u5.cat === 'read', JSON.stringify({ v: u5.verdict, cat: u5.cat }))
}

// ── 18b. undo 默认 allow：影响面是「所有未显式设置过 undo 的配置」，显式落盘的值不迁移 ──
group('18b. 撤销分类默认值 = allow（缺键回落），显式落盘的值不迁移')
{
  // seed 非空时预置隔离 config.json，模拟「老用户已落盘」的配置
  async function freshUndo(seed) {
    const ws = mkdtempSync(join(tmpdir(), 'pg-g18b-ws-'))
    const home = mkdtempSync(join(tmpdir(), 'pg-g18b-home-'))
    mkdirSync(join(home, 'dsh-permgate'), { recursive: true })
    if (seed) writeFileSync(join(home, 'dsh-permgate', 'config.json'), JSON.stringify(seed), 'utf8')
    const h = createHost({ workspaceRoot: ws, dshHome: home })
    const st = await callRoute(h.routes, 'GET', '/permgate/status')
    const file = join(ws, 'a.txt')
    writeFileSync(file, 'l1\nl2\nl3\n', 'utf8')
    const exec = makeExec(ws, 'undo_last_edit', { path: file })
    const hook = h.hooks.get('tools/pre-execute')
    let nextCalled = false
    const { done, mark } = settleFlag()
    const p = hook(exec, async () => { nextCalled = true; return { kind: 'allow' } })
    p.then(mark, mark)
    // 与 runApproval/probe18 同一等待助手：固定 sleep 在机器繁忙时会把「本该 ask」读成
    // allow/deny —— 对期望 deny 的用例更糟，那是**假通过**（verdict 半边失去判别力）
    const item = await awaitPending('undo_last_edit', done, h)
    if (item) await callRoute(h.routes, 'POST', '/permgate/decide', { id: item.id, action: 'deny', lang: 'zh' })
    await withTimeout(p, 'g18b settle')
    const verdict = item ? 'ask' : (nextCalled ? 'allow' : 'deny')
    try { rmSync(ws, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }) } catch (e) {}
    // 整个 effective 一并返回：对照断言要能检查 undo 之外的分类是否被顺手放宽
    return { eff: st.data && st.data.effective && st.data.effective.undo, effective: (st.data && st.data.effective) || null, verdict }
  }

  // ① 全新配置：undo 默认 allow，撤销不再弹窗
  const n1 = await freshUndo(null)
  ok('group18b: 新建配置 undo 默认 allow', n1.eff === 'allow', 'effective.undo=' + n1.eff)
  ok('group18b: 新建配置下撤销不再弹窗', n1.verdict === 'allow', 'verdict=' + n1.verdict)
  // ② 老配置已显式落盘 ask → 必须保持 ask（不迁移）
  const n2 = await freshUndo({ global: { undo: { mode: 'ask', exceptions: [] }, fallbackMode: 'ask' }, projects: {} })
  ok('group18b: 老配置 undo:ask 保持 ask（不迁移）', n2.eff === 'ask' && n2.verdict === 'ask', JSON.stringify(n2))
  // ③ 老配置已显式落盘 deny → 必须保持 deny
  const n3 = await freshUndo({ global: { undo: { mode: 'deny', exceptions: [] }, fallbackMode: 'ask' }, projects: {} })
  ok('group18b: 老配置 undo:deny 保持 deny（不迁移）', n3.eff === 'deny' && n3.verdict === 'deny', JSON.stringify(n3))
  // ④ 对照：改 undo 的默认值不得顺手放宽其它从严分类。
  // 必须真的断言 edit/image/doomloop/directory/command —— 只断言 undo 自己等于没测
  //（把 freshCategory 的 ask 集合写成只剩 directory/command 也必须在这里失败）。
  const n4 = await freshUndo(null)
  const e4 = n4.effective || {}
  ok('group18b: 对照 —— undo=allow 不牵连其它从严分类',
    n4.eff === 'allow' && e4.edit === 'ask' && e4.image === 'ask' && e4.doomloop === 'ask' && e4.directory === 'ask' && e4.command === 'ask',
    JSON.stringify({ undo: n4.eff, edit: e4.edit, image: e4.image, doomloop: e4.doomloop, directory: e4.directory, command: e4.command }))
  // ⑤ 缺 undo 键的存量配置（1.3.x 直升路径）：回落 allow 是**已知取舍**，此处钉住实际行为，
  // 避免「注释说只影响新建配置、实际也放宽存量」这类无声漂移再次发生（要改行为先改这条断言）
  const legacy = { global: { directory: { mode: 'ask', exceptions: [] }, command: { mode: 'ask', exceptions: [] }, read: { mode: 'allow', exceptions: [] }, image: { mode: 'ask', exceptions: [] }, edit: { mode: 'ask', exceptions: [] }, fallbackMode: 'ask' }, projects: {} }
  const n5 = await freshUndo(legacy)
  ok('group18b: 缺 undo 键的存量配置回落 allow（影响面已如实标注）', n5.eff === 'allow' && n5.verdict === 'allow', JSON.stringify({ eff: n5.eff, verdict: n5.verdict }))
  ok('group18b: 缺 undo 键的存量配置里，显式的 edit:ask 仍存活', (n5.effective || {}).edit === 'ask', JSON.stringify(n5.effective))
}

// ─────────────────────────────────────────────────────────────
group('19. 会话记录的编码驱动预览（recordedEncoding 端到端）')
// 背景：edit / insert / str_replace_editor 没有 encoding 参数，编码完全来自
// dsh-fs-encoding 的 encoding memo；write 的基线读、read 未指定时也回落到它。
// permgate 此前拿不到那份记录，只能自行判定，可能落在另一页上——预览描述的文本与工具
// 实际要改的文本就不是同一份。该只读出口由较新的 dsh-fs-encoding 提供
// （本插件按能力探测使用，不依赖它存在：缺失时只告警并退回原报错，功能降级但不影响正常使用）。
//
// 本组用**真实链路**（HTTP 路由 + 真实 LocalFileSystem + 桩服务）验证接线：
// 记录存在时按记录解，记录缺失/过期时退回原行为，老版服务（无该方法）不崩。
{
  const GBK = Buffer.from([0xC4, 0xE3, 0xBA, 0xC3, 0xA3, 0xAC, 0xCA, 0xC0, 0xBD, 0xE7, 0x0A, 0x68, 0x69, 0x0A])

  // 桩服务：记录表由用例注入；tryDecode 显式 encoding 时恒回 'hint'（与真实服务一致），
  // 这正是「必须用记录的 provenance 覆盖」的理由。
  //
  // version 语义按 **1.4.0** 实现（与早期工作树相反）：省略/undefined 是 fail-closed
  // （仍走 isStale，带版本的记录被判不可用），只有显式 null 才跳过判定。
  // 桩必须照实实现，否则测的是「假契约」——perm gate 传真实版本时行为看似正常，
  // 而一旦它漏传版本，桩会静默放行而真实服务会拒绝。
  const mkSvc = (records) => ({
    tryDecode: async (bytes, opts) => {
      const enc = opts && opts.encoding
      if (enc) return { ok: true, result: { text: 'DECODED-AS-' + enc + '\n', encoding: enc, decided: 'hint' } }
      return { ok: false, refusal: { code: 'E_NOT_TEXT', message: '[E_NOT_TEXT] stub: guessing off', candidates: [] } }
    },
    recordedEncoding: (sessionId, target, version) => {
      const key = sessionId + '|' + (target && (target.targetKey || target.displayPath))
      const rec = records[key]
      if (!rec) return undefined
      // 1.4.0：null 才跳过；undefined 走 isStale（记录里没版本 → 判 stale）
      if (version !== null && rec.version !== version) return undefined
      return { encoding: rec.encoding, decided: rec.decided, hasBOM: false, lineEnding: '\n' }
    },
  })

  const mk = async (label, records, opts) => {
    const o = opts || {}
    const ws = mkdtempSync(join(tmpdir(), 'pg-memo-ws-'))
    const home = mkdtempSync(join(tmpdir(), 'pg-memo-home-'))
    mkdirSync(join(home, 'dsh-permgate'), { recursive: true })
    const h = createHost({ workspaceRoot: ws, dshHome: home, fsEncoding: o.svc !== undefined ? o.svc : mkSvc(records) })
    const pre = h.hooks.get('tools/pre-execute')
    const p = join(ws, 'gbk.txt')
    writeFileSync(p, o.bytes || GBK)
    const tool = o.tool || 'read'
    const category = tool === 'read' ? 'read' : 'edit'
    await callRoute(h.routes, 'POST', '/permgate/set-category', { target: 'project', category, mode: 'ask', lang: 'zh', sessionId: 'sess-1' })
    const args = o.args ? o.args(p) : { file_path: p }
    // 等待逻辑复用文件内既有的 awaitPending（40×25ms 轮询 + hook 落定标记），
    // 而不是固定睡眠：慢机器/CI 上固定 80ms 内审批可能尚未入表，会让断言以
    // 「功能坏了」的形式假失败。host 非模块级，故必须显式传入（见该函数的 h 参数）。
    const { done, mark } = settleFlag()
    const pending = pre(makeExec(ws, tool, args), async () => ({ kind: 'allow' }))
    pending.then(mark, mark)
    const item = await awaitPending(tool, done, h)
    const diff = await callRoute(h.routes, 'POST', '/permgate/file-diff', { id: item && item.id, lang: 'zh' })
    if (item) await callRoute(h.routes, 'POST', '/permgate/decide', { id: item.id, action: 'deny', lang: 'zh' })
    await withTimeout(pending, label + ' settle')
    try { rmSync(ws, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }) } catch (e) {}
    return { item, data: diff.data, sessionId: item && item.sessionId }
  }

  // ① edit 审批带 sessionId：记录查询的**前提**（本块只验证这个前提，不验证记录本身——
  // 真正验证「有记录 → 按记录解码」的是下面第二块，它才构造了 records）。
  {
    const r = await mk('edit 带 sessionId', null, { tool: 'edit', args: (p) => ({ file_path: p, old_string: 'x', new_string: 'y' }) })
    ok('group19: edit 审批带 sessionId（记录查询的前提）', !!r.sessionId, JSON.stringify(r.sessionId))
  }
  // 用真实 key（sessionId|targetKey）构造记录：targetKey 是 realpath，先算出来
  {
    const ws = mkdtempSync(join(tmpdir(), 'pg-memo-k-'))
    const home = mkdtempSync(join(tmpdir(), 'pg-memo-kh-'))
    mkdirSync(join(home, 'dsh-permgate'), { recursive: true })
    const p = join(ws, 'gbk.txt')
    writeFileSync(p, GBK)
    const h0 = createHost({ workspaceRoot: ws, dshHome: home, fsEncoding: undefined })
    const resolved = await h0.fs.resolve(p)
    const tk = resolved && (resolved.targetKey || resolved.displayPath)
    // 记录的 version 必须与 permgate 预览时 stat 到的**真实**版本一致，
    // 否则 1.4.0 的 fail-closed/stale 判定会把记录判为过期（这正是要测的语义）
    const realVersion = (await h0.fs.stat(resolved)).version
    const records = {}
    records['sess-1|' + tk] = { encoding: 'gbk', decided: 'guessed', hasBOM: false, lineEnding: '\n', version: realVersion }
    // 用同一份 ws 重开一个带记录的宿主，走真实审批 → file-diff
    const svc = mkSvc(records)
    const h = createHost({ workspaceRoot: ws, dshHome: home, fsEncoding: svc })
    const pre = h.hooks.get('tools/pre-execute')
    await callRoute(h.routes, 'POST', '/permgate/set-category', { target: 'project', category: 'edit', mode: 'ask', lang: 'zh', sessionId: 'sess-1' })
    const { done, mark } = settleFlag()
    const pending = pre(makeExec(ws, 'edit', { file_path: p, old_string: 'x', new_string: 'y' }), async () => ({ kind: 'allow' }))
    pending.then(mark, mark)
    const item = await awaitPending('edit', done, h)
    const diff = await callRoute(h.routes, 'POST', '/permgate/file-diff', { id: item && item.id, lang: 'zh' })
    const d = diff.data
    ok('group19: ★ 有记录时 edit 预览成功（此前只能报 invalid UTF-8 / E_NOT_TEXT）',
      !!(d && d.ok === true), JSON.stringify(d && (d.error || d.ok)))
    ok('group19: ★ 预览按记录里的 gbk 解码', !!(d && d.ok && d.encoding === 'gbk'), JSON.stringify(d && { enc: d.encoding, dec: d.decided }))
    // 关键：服务对显式 encoding 只回 'hint'，而记录写的是 'guessed'。必须用记录的 provenance，
    // 否则一条猜测记录会被呈现成确定编码（审批者正是照预览决定是否放行）。
    ok('group19: ★ provenance 取记录的 guessed（未被服务的 hint 覆盖）',
      !!(d && d.ok && d.decided === 'guessed'), JSON.stringify(d && { enc: d.encoding, dec: d.decided }))
    if (item) await callRoute(h.routes, 'POST', '/permgate/decide', { id: item.id, action: 'deny', lang: 'zh' })
    await withTimeout(pending, 'g19-1 settle')
    try { rmSync(ws, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }) } catch (e) {}
  }
  // ② 无记录（服务回 undefined）→ 退回原行为：服务拒绝则原样报错，不崩
  {
    const r = await mk('edit 无记录', {})
    ok('group19: 无记录时 edit 预览维持原报错（不自行猜编码）',
      !!(r.data && r.data.ok === false && r.data.error), JSON.stringify(r.data && r.data.error))
  }
  // ③ 记录过期（服务对版本不符回 undefined）→ 同样退回原行为
  {
    const ws = mkdtempSync(join(tmpdir(), 'pg-memo-s-'))
    const home = mkdtempSync(join(tmpdir(), 'pg-memo-sh-'))
    mkdirSync(join(home, 'dsh-permgate'), { recursive: true })
    const p = join(ws, 'gbk.txt')
    writeFileSync(p, GBK)
    const h0 = createHost({ workspaceRoot: ws, dshHome: home, fsEncoding: undefined })
    const resolved = await h0.fs.resolve(p)
    const tk = resolved && (resolved.targetKey || resolved.displayPath)
    // 桩：无论版本一律回 undefined，模拟 isStale 判过期
    const svc = {
      tryDecode: async () => ({ ok: false, refusal: { code: 'E_NOT_TEXT', message: '[E_NOT_TEXT] stale', candidates: [] } }),
      recordedEncoding: () => undefined,
    }
    const h = createHost({ workspaceRoot: ws, dshHome: home, fsEncoding: svc })
    const pre = h.hooks.get('tools/pre-execute')
    await callRoute(h.routes, 'POST', '/permgate/set-category', { target: 'project', category: 'edit', mode: 'ask', lang: 'zh', sessionId: 'sess-1' })
    const { done, mark } = settleFlag()
    const pending = pre(makeExec(ws, 'edit', { file_path: p, old_string: 'x', new_string: 'y' }), async () => ({ kind: 'allow' }))
    pending.then(mark, mark)
    const item = await awaitPending('edit', done, h)
    const diff = await callRoute(h.routes, 'POST', '/permgate/file-diff', { id: item && item.id, lang: 'zh' })
    ok('group19: 记录过期（服务回 undefined）时退回原报错',
      !!(diff.data && diff.data.ok === false && diff.data.error), JSON.stringify(diff.data && diff.data.error))
    ok('group19: 过期判定由服务负责（预览不自行比较 version）', !!tk)
    if (item) await callRoute(h.routes, 'POST', '/permgate/decide', { id: item.id, action: 'deny', lang: 'zh' })
    await withTimeout(pending, 'g19-3 settle')
    try { rmSync(ws, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }) } catch (e) {}
  }
  // ④ 老版服务（只有 tryDecode，没有 recordedEncoding）→ 不崩、退回原行为
  {
    const oldSvc = { tryDecode: async () => ({ ok: false, refusal: { code: 'E_NOT_TEXT', message: '[E_NOT_TEXT] old service', candidates: [] } }) }
    const r = await mk('老版服务', null, { tool: 'edit', args: (p) => ({ file_path: p, old_string: 'x', new_string: 'y' }), svc: oldSvc })
    ok('group19: ★ 老版服务（无 recordedEncoding）不崩且退回原报错（可选依赖不被破坏）',
      !!(r.data && r.data.ok === false && r.data.error), JSON.stringify(r.data && r.data.error))
  }
  // ④b ★ 1.4.0 的 fail-closed：perm gate **必须**把 stat 到的真实版本传下去。
  // 若它漏传版本，服务会把记录判为过期 → 预览退回原报错（静默失效，不报错）。
  // 这条用例让桩**照实**实现 1.4.0 语义（undefined → 判 stale），故能捕获"漏传版本"。
  {
    const ws = mkdtempSync(join(tmpdir(), 'pg-memo-fc-'))
    const home = mkdtempSync(join(tmpdir(), 'pg-memo-fch-'))
    mkdirSync(join(home, 'dsh-permgate'), { recursive: true })
    const p = join(ws, 'gbk.txt')
    writeFileSync(p, GBK)
    const h0 = createHost({ workspaceRoot: ws, dshHome: home, fsEncoding: undefined })
    const resolved = await h0.fs.resolve(p)
    const tk = resolved && (resolved.targetKey || resolved.displayPath)
    const realVersion = (await h0.fs.stat(resolved)).version
    // 记录带**正确**版本 → 应当取到并按 gbk 解（证明 permgate 确实传了版本）
    const records = {}
    records['sess-1|' + tk] = { encoding: 'gbk', decided: 'guessed', hasBOM: false, lineEnding: '\n', version: realVersion }
    const h = createHost({ workspaceRoot: ws, dshHome: home, fsEncoding: mkSvc(records) })
    const pre = h.hooks.get('tools/pre-execute')
    await callRoute(h.routes, 'POST', '/permgate/set-category', { target: 'project', category: 'edit', mode: 'ask', lang: 'zh', sessionId: 'sess-1' })
    const f1 = settleFlag()
    const pending = pre(makeExec(ws, 'edit', { file_path: p, old_string: 'x', new_string: 'y' }), async () => ({ kind: 'allow' }))
    pending.then(f1.mark, f1.mark)
    const item = await awaitPending('edit', f1.done, h)
    const diff = await callRoute(h.routes, 'POST', '/permgate/file-diff', { id: item && item.id, lang: 'zh' })
    const d = diff.data
    ok('group19: ★★ 记录带正确版本时能取到（证明 permgate 确实把 stat 的版本传下去了）',
      !!(d && d.ok === true && d.encoding === 'gbk'), JSON.stringify(d && { ok: d.ok, enc: d.encoding, err: d.error }))
    // 对照：把记录的版本改错 → 服务判 stale → 退回原报错。两例成对，才能证明
    // 「取到」不是因为桩忽略了版本（那样两例都会通过）。
    const h2 = createHost({ workspaceRoot: ws, dshHome: home, fsEncoding: mkSvc({ ['sess-1|' + tk]: { encoding: 'gbk', decided: 'guessed', hasBOM: false, lineEnding: '\n', version: 'wrong-version' } }) })
    const pre2 = h2.hooks.get('tools/pre-execute')
    await callRoute(h2.routes, 'POST', '/permgate/set-category', { target: 'project', category: 'edit', mode: 'ask', lang: 'zh', sessionId: 'sess-1' })
    const f2 = settleFlag()
    const pending2 = pre2(makeExec(ws, 'edit', { file_path: p, old_string: 'x', new_string: 'y' }), async () => ({ kind: 'allow' }))
    pending2.then(f2.mark, f2.mark)
    const item2 = await awaitPending('edit', f2.done, h2)
    const diff2 = await callRoute(h2.routes, 'POST', '/permgate/file-diff', { id: item2 && item2.id, lang: 'zh' })
    ok('group19: ★★ 对照——版本不符时服务判 stale、退回原报错（证明上例真的走了版本判定）',
      !!(diff2.data && diff2.data.ok === false), JSON.stringify(diff2.data && { ok: diff2.data.ok, enc: diff2.data.encoding }))
    if (item) await callRoute(h.routes, 'POST', '/permgate/decide', { id: item.id, action: 'deny', lang: 'zh' })
    if (item2) await callRoute(h2.routes, 'POST', '/permgate/decide', { id: item2.id, action: 'deny', lang: 'zh' })
    await withTimeout(pending, 'g19-4b settle')
    await withTimeout(pending2, 'g19-4b2 settle')
    try { rmSync(ws, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }) } catch (e) {}
  }
  // ⑤ read 审批 + AI 透传 encoding → 工具透传优先（这条路径不依赖记录）
  {
    const r = await mk('read 透传 encoding', {}, { tool: 'read', args: (p) => ({ file_path: p, encoding: 'big5' }) })
    ok('group19: ★ read 透传 encoding 优先于记录（工具就按它解码）',
      !!(r.data && r.data.ok === true && r.data.encoding === 'big5'), JSON.stringify(r.data && { ok: r.data.ok, enc: r.data.encoding }))
    ok('group19: 透传时 decided=hint（调用方指定的，服务标注正确）',
      !!(r.data && r.data.ok && r.data.decided === 'hint'), JSON.stringify(r.data && r.data.decided))
  }
  // ⑥ **优先级对照**：记录与透传**同时存在且不同**时，必须用透传的那一页。
  // ⑤ 只有透传、没有记录，故证明不了优先级——实测把 wantEncoding 的顺序反过来
  // （`recEnc || encodingHint`）后 ⑤ 照样通过。这一条才是有区分力的对照。
  {
    const ws = mkdtempSync(join(tmpdir(), 'pg-memo-p-'))
    const home = mkdtempSync(join(tmpdir(), 'pg-memo-ph-'))
    mkdirSync(join(home, 'dsh-permgate'), { recursive: true })
    const p = join(ws, 'gbk.txt')
    writeFileSync(p, GBK)
    const h0 = createHost({ workspaceRoot: ws, dshHome: home, fsEncoding: undefined })
    const resolved = await h0.fs.resolve(p)
    const tk = resolved && (resolved.targetKey || resolved.displayPath)
    // 记录写 gbk，工具透传 big5：两者不同，结果必须体现 big5
    const realVersion = (await h0.fs.stat(resolved)).version
    const records = {}
    records['sess-1|' + tk] = { encoding: 'gbk', decided: 'guessed', hasBOM: false, lineEnding: '\n', version: realVersion }
    const h = createHost({ workspaceRoot: ws, dshHome: home, fsEncoding: mkSvc(records) })
    const pre = h.hooks.get('tools/pre-execute')
    await callRoute(h.routes, 'POST', '/permgate/set-category', { target: 'project', category: 'read', mode: 'ask', lang: 'zh', sessionId: 'sess-1' })
    const f6 = settleFlag()
    const pending = pre(makeExec(ws, 'read', { file_path: p, encoding: 'big5' }), async () => ({ kind: 'allow' }))
    pending.then(f6.mark, f6.mark)
    const item = await awaitPending('read', f6.done, h)
    const diff = await callRoute(h.routes, 'POST', '/permgate/file-diff', { id: item && item.id, lang: 'zh' })
    const d = diff.data
    ok('group19: ★★ 记录=gbk 且透传=big5 时，必须用透传的 big5（优先级对照）',
      !!(d && d.ok && d.encoding === 'big5'),
      JSON.stringify(d && { ok: d.ok, enc: d.encoding, dec: d.decided }))
    ok('group19: ★★ 此时 provenance 用服务的 hint（透传是调用方指定的），而非记录的 guessed',
      !!(d && d.ok && d.decided === 'hint'), JSON.stringify(d && { enc: d.encoding, dec: d.decided }))
    if (item) await callRoute(h.routes, 'POST', '/permgate/decide', { id: item.id, action: 'deny', lang: 'zh' })
    await withTimeout(pending, 'g19-6 settle')
    try { rmSync(ws, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }) } catch (e) {}
  }
}

// ─────────────────────────────────────────────────────────────
group('20. 命令判定：段级例外（真实运行时链路，计划 §6.2）')
{
  // 背景（实测漏洞）：旧实现用**整条命令串**匹配例外，`git status *` 编译出的
  // `^git status( .*)?$` 里的 `.*` 吞掉了 `;` `|` `&&` 之后的一切 —— 11 条命令被静默执行。
  // 本组走**真实 tools/pre-execute 链路**复现那 11 条，断言它们不再整条静默放行。
  // 断言口径是「不返回 next()」（即不无条件放行），而不是钉死 ask/deny ——
  // 具体落点由配置决定，测试不该把某个默认值固化成语义。
  const ws = mkdtempSync(join(tmpdir(), 'pg-seg-ws-'))
  const home = mkdtempSync(join(tmpdir(), 'pg-seg-home-'))
  mkdirSync(join(home, 'dsh-permgate'), { recursive: true })
  const EXC = ['git status *', 'git log *', 'git diff *', 'Get-ChildItem *', 'Get-Content *',
    'Copy-Item *', 'cd *', 'node --check *', 'docker ps *', 'grep *']
  writeFileSync(join(home, 'dsh-permgate', 'config.json'), JSON.stringify({
    global: {
      sandboxMode: 'danger-full-access', fallbackMode: 'ask',
      command: { mode: 'ask', destructive: { action: 'ask' }, exceptions: EXC.map((m, i) => ({ id: 'e' + i, action: 'allow', match: m })) },
    },
    projects: {},
  }, null, 2), 'utf8')
  const h = createHost({ workspaceRoot: ws, dshHome: home })
  const pre = h.hooks.get('tools/pre-execute')
  // 探测：nexted 为真 = 被静默放行；否则说明走了审批/拒绝
  const probe = async (cmd) => {
    let nexted = false
    const p = pre(makeExec(ws, 'bash', { command: cmd }), async () => { nexted = true; return { kind: 'allow' } })
    p.catch(() => {})
    const out = await Promise.race([p, new Promise((r) => setTimeout(() => r({ kind: 'timeout' }), 300))])
    return { nexted, verdict: out && out.kind }
  }

  // A 组：操作符穿透（修复前 11/11 静默放行）
  const A = [
    'git status && rm -rf ~/.dsh', 'git status ; rm -rf ~/.dsh', 'git status | rm -rf ~/.dsh',
    'git status `rm -rf ~/.dsh`', 'git status $(rm -rf ~/.dsh)', 'git status & rm -rf ~/.dsh',
    'git status\nrm -rf ~/.dsh', 'git status\n&& rm -rf ~/.dsh',
    'cd /tmp && rm -rf ~/.dsh', 'Get-Content a && rm -rf ~/.dsh', 'Copy-Item a b && rm -rf ~/.dsh',
  ]
  const leaked = []
  for (const c of A) { const r = await probe(c); if (r.nexted) leaked.push(c) }
  ok('★ group20: A 组 11 条操作符穿透命令均不再静默放行', leaked.length === 0, JSON.stringify(leaked))

  // C 组：命令替换 / 嵌套解释器
  const C = ['git status $(rm -rf ~/.dsh)', 'git status `rm -rf ~/.dsh`', 'sh -c "rm -rf ~/.dsh"',
    'pwsh -Command "Remove-Item ~/.dsh -Recurse"', 'node -e "require(\'fs\').rmSync(\'x\')"']
  const leakedC = []
  for (const c of C) { const r = await probe(c); if (r.nexted) leakedC.push(c) }
  ok('★ group20: C 组命令替换/嵌套均不静默放行', leakedC.length === 0, JSON.stringify(leakedC))

  // I 组：部分覆盖（一段有例外、另一段没有）
  const I = ['git status && npm publish', 'cd /tmp && rm -rf ~/.dsh', 'echo x && git push --force']
  const leakedI = []
  for (const c of I) { const r = await probe(c); if (r.nexted) leakedI.push(c) }
  ok('★ group20: I 组部分覆盖均不整条放行', leakedI.length === 0, JSON.stringify(leakedI))

  // 反向：不得过度收紧（单段命中例外仍免审 —— G/H 组的运行时对照）
  const KEEP = ['git status', 'git status --short', 'git log --format=oneline',
    'git log --pretty=format:%h', 'docker ps --format json', 'Get-ChildItem -Recurse', 'node --check x.js']
  const blocked = []
  for (const c of KEEP) { const r = await probe(c); if (!r.nexted) blocked.push(c) }
  ok('★ group20: 命中例外的单段命令仍免审（未过度收紧；含 D3 的 format 误报回归）',
    blocked.length === 0, JSON.stringify(blocked))

  // ★ D-6 核心回归：command 大分类 = allow 时，破坏性命令仍不返回 next()
  // （现有实现在此场景下会放行 —— 这正是 §1.2b 的缺陷）
  await callRoute(h.routes, 'POST', '/permgate/set-category', { target: 'project', category: 'command', mode: 'allow', lang: 'zh', sessionId: 'sess-1' })
  const DESTRUCTIVE = ['Remove-Item -Recurse -Force B:\\x', 'taskkill /f /im x.exe',
    'icacls B:\\x /grant everyone:F', 'rm -rf ~/.dsh']
  const leakedD = []
  for (const c of DESTRUCTIVE) { const r = await probe(c); if (r.nexted) leakedD.push(c) }
  ok('★★ group20: command=allow 时破坏性命令仍不静默放行（D-6 核心修复，§1.2b）',
    leakedD.length === 0, JSON.stringify(leakedD))
  // 对照：同一配置下普通命令确实放行（证明大分类仍生效，不是整类被锁死）
  const rPlain = await probe('some-unknown-tool --flag')
  ok('group20: 同一配置下普通命令仍按大分类 allow 放行（大分类仍生效）', rPlain.nexted === true, JSON.stringify(rPlain))

  // ★ 子设置可配置性：destructive=allow 时**区内**破坏性命令回到放行（用户知情放开）
  //
  // ⚠️ 这里用 `rm -rf ./build`（目标在**工作区内** → `inside` 档），不是 `rm -rf ~/.dsh`。
  // 八档体系下「设 allow」只作用于 `inside` 一档（老客户端不传 tier，落的就是它）——
  // 其余七档不松于 ask（D-6 的核心）。`~/.dsh` 在工作区**之外**（`outside` 档），
  // 设 allow 后仍然要问，那正是本计划要的效果。见下面那条「只放行 inside 档」的断言。
  await callRoute(h.routes, 'POST', '/permgate/set-command-sub', { target: 'project', action: 'allow', lang: 'zh', sessionId: 'sess-1' })
  const rAllow = await probe('rm -rf ./build')
  ok('★ group20: destructive=allow 时区内破坏性命令放行（子设置可配置，用户知情放开）', rAllow.nexted === true, JSON.stringify(rAllow))
  // ★★ 关键：`inside` 档设 allow **不得**连带放行其余七档（否则等于把整个子设置关掉）
  const rAllowOutside = await probe('rm -rf ~/.dsh')
  ok('★★ group20: 只放行 inside 档时，工作区外的破坏性命令仍然要问（其余七档不松于 ask）',
    rAllowOutside.nexted === false, JSON.stringify(rAllowOutside))
  // ★ destructive=deny 时直接拒绝，且理由取自子设置 reason
  // 同上：用区内目标（`inside` 档）—— 这是老客户端唯一能写的档，也是本用例要守的那条路径。
  await callRoute(h.routes, 'POST', '/permgate/set-command-sub', { target: 'project', action: 'deny', reason: '不许删', lang: 'zh', sessionId: 'sess-1' })
  let denyOut = null
  const pDeny = pre(makeExec(ws, 'bash', { command: 'rm -rf ./build' }), async () => ({ kind: 'allow' }))
  pDeny.catch(() => {})
  denyOut = await Promise.race([pDeny, new Promise((r) => setTimeout(() => r({ kind: 'timeout' }), 300))])
  ok('★ group20: destructive=deny 时直接拒绝', !!denyOut && denyOut.kind === 'deny', JSON.stringify(denyOut))
  ok('★ group20: 拒绝理由取自子设置 reason', !!denyOut && String(denyOut.reason || '').indexOf('不许删') !== -1, JSON.stringify(denyOut && denyOut.reason))

  // ★ 分组/花括号包住的破坏性命令（走真实链路）：段内 opaque 不得关掉子设置。
  // 根因：分组被整块当 opaque 文本吞掉 → 段 words 为空 → label 为空 → 破坏性判定恒 false。
  // 这是「段内 opaque 不得关掉子设置」那条修复的遗漏分支（只覆盖了「词元提取得出」的形态）。
  const GROUPED = ['(rm -rf ~/.dsh)', '( rm -rf ~/.dsh )', '{ rm -rf ~/.dsh; }',
    '(cd /tmp; rm -rf ~/.dsh)', 'echo a; (rm -rf ~/.dsh)', 'if true; then (rm -rf ~/.dsh); fi',
    '(sudo rm -rf /x)', '(chmod 777 /etc/passwd)']
  const leakedG = []
  for (const c of GROUPED) { const r = await probe(c); if (r.nexted) leakedG.push(c) }
  ok('★★ group20: 分组/花括号包住的破坏性命令不被静默放行（段内 opaque 不得关掉子设置）',
    leakedG.length === 0, JSON.stringify(leakedG))

  // ★ 用户例外优先于子设置（D-5）
  await callRoute(h.routes, 'POST', '/permgate/add-exception', { target: 'project', category: 'command', action: 'allow', match: 'rm -rf /tmp/*', lang: 'zh', sessionId: 'sess-1' })
  const rExFirst = await probe('rm -rf /tmp/x')
  ok('★ group20: 用户例外优先于 destructive 子设置（D-5）', rExFirst.nexted === true, JSON.stringify(rExFirst))

  // ★ status 下发子设置（面板据它渲染；来源与名单一并下发）
  const st = await callRoute(h.routes, 'GET', '/permgate/status')
  const cs = st.data && st.data.commandSub
  ok('★ group20: status 下发 commandSub（当前值 + 来源 + 只读名单）',
    !!(cs && cs.key === 'destructive' && cs.effective && Array.isArray(cs.labels) && cs.labels.length > 10),
    JSON.stringify(cs && { key: cs.key, eff: cs.effective, n: (cs.labels || []).length }))
  ok('★ group20: commandSub.effective.source 反映实际来源（本项目设置）',
    !!(cs && cs.effective && cs.effective.source && cs.effective.source.inside === 'project'),
    JSON.stringify(cs && cs.effective))
  ok('★ group20: 名单只读下发且不含 mv/cp（刻意不列入的高频命令）',
    !!(cs && cs.labels.indexOf('mv') === -1 && cs.labels.indexOf('cp') === -1 && cs.labels.indexOf('rm') !== -1),
    JSON.stringify(cs && cs.labels.filter((l) => l === 'mv' || l === 'cp' || l === 'rm')))

  // ★ 老配置（无 destructive 键）加载后补默认值 ask
  const ws2 = mkdtempSync(join(tmpdir(), 'pg-seg2-ws-'))
  const home2 = mkdtempSync(join(tmpdir(), 'pg-seg2-home-'))
  mkdirSync(join(home2, 'dsh-permgate'), { recursive: true })
  writeFileSync(join(home2, 'dsh-permgate', 'config.json'), JSON.stringify({
    global: { fallbackMode: 'ask', command: { mode: 'ask', exceptions: [] } }, projects: {},
  }, null, 2), 'utf8')
  const h2 = createHost({ workspaceRoot: ws2, dshHome: home2 })
  const st2 = await callRoute(h2.routes, 'GET', '/permgate/status')
  const cs2 = st2.data && st2.data.commandSub
  // source 为 'global' 而不是 'default' 是**正确的**：normalizeCategory 会把默认值补进
  // 全局块并落盘（与 mode 的默认值完全同口径 —— 每个分类的 mode 也是这样补进去的）。
  // 故 'default' 只在「全局块里连 command 都没有」时才出现，正常加载后恒为具体层。
  // 关键断言是「动作是 ask」——即老配置升级后破坏性命令确实被拦（下面那条运行时用例）。
  ok('★ group20: 老配置（无 destructive 键）→ 迁移补默认值 ask',
    !!(cs2 && cs2.effective && cs2.effective.inside === 'ask' && cs2.effective.wide === 'ask'),
    JSON.stringify(cs2 && cs2.effective))
  // 老配置下破坏性命令同样不被静默放行
  let nexted2 = false
  const pre2 = h2.hooks.get('tools/pre-execute')
  // 用**工作区外**目标：mode=allow 时 `inside` 档会跟随大分类放行（本计划的**有意**变化，
  // 见 §6.1），而这里要守的是「老配置升级后大范围破坏仍被拦」——那属于其余七档。
  const p2 = pre2(makeExec(ws2, 'bash', { command: 'rm -rf ~/.dsh' }), async () => { nexted2 = true; return { kind: 'allow' } })
  p2.catch(() => {})
  await Promise.race([p2, new Promise((r) => setTimeout(r, 300))])
  ok('★ group20: 老配置下工作区外的破坏性命令也不静默放行', nexted2 === false)

  // ★★ group20b：八档取值 = 项目显式 → 全局显式 → ask（**不再按大分类 mode 推导**）
  //
  // ── 期望已按用户指定的新规则改写 ───────────────────────────────────────────────
  // 旧规则：`command=deny` + 无 destructive 键 → 八档按本层 mode 推导为 **deny**
  //   （本条原名「显式收紧的 command=deny 不得被子设置默认值放松」，是 §6.2② 的核心断言）。
  // 新规则（用户指定，忽略旧配置迁移兼容）：八档一律「项目显式 → 全局显式 → ask」。
  //   → `command=deny` + 无 destructive 键 ⇒ 八档全 **ask**，破坏性命令**弹窗询问**。
  //
  // ⚠️ 这是**有意的行为变化**，不是回归：用户明确接受「大分类设拒绝时破坏性命令改为弹窗」，
  // 理由：弹窗里带完整的破坏性标注（argLines[].note）与爆炸半径警告条，
  // 用户看到后会去设置里逐档调 —— 弹窗本身就是发现入口。
  // 方向仍是 fail-closed（ask 一定拦得住，不存在静默放行），故下面同时断言「没有 next」。
  // 反例（实测变红）：把八档末级兜底改回按 mode 推导，本条即失败。
  const ws3 = mkdtempSync(join(tmpdir(), 'pg-seg3-ws-'))
  const home3 = mkdtempSync(join(tmpdir(), 'pg-seg3-home-'))
  mkdirSync(join(home3, 'dsh-permgate'), { recursive: true })
  writeFileSync(join(home3, 'dsh-permgate', 'config.json'), JSON.stringify({
    global: { fallbackMode: 'ask', command: { mode: 'deny', reason: '命令一律拒绝' } }, projects: {},
  }, null, 2), 'utf8')
  const h3 = createHost({ workspaceRoot: ws3, dshHome: home3 })
  const st3 = await callRoute(h3.routes, 'GET', '/permgate/status')
  const cs3 = st3.data && st3.data.commandSub
  ok('★★ group20b: 全局 command=deny + 无 destructive 键 → 八档全 ask（八档同构继承，不再按 mode 推导）',
    !!(cs3 && cs3.effective && cs3.effective.inside === 'ask' && cs3.effective.wide === 'ask'
      && cs3.effective.proc === 'ask' && cs3.effective.priv === 'ask'), JSON.stringify(cs3 && cs3.effective))
  // 运行时：破坏性命令必须**弹窗询问**（而不是直接 deny）—— 但**绝不能静默放行**
  let denyOut3 = null
  let nexted3b = false
  const pre3 = h3.hooks.get('tools/pre-execute')
  const p3 = pre3(makeExec(ws3, 'bash', { command: 'rm -rf x' }), async () => { nexted3b = true; return { kind: 'allow' } })
  p3.catch(() => {})
  denyOut3 = await Promise.race([p3, new Promise((r) => setTimeout(() => r({ kind: 'timeout' }), 300))])
  ok('★★ group20b: command=deny 时破坏性命令落 ask（弹窗；不得静默放行、也不得直接拒绝）',
    nexted3b === false && !!denyOut3 && denyOut3.kind === 'timeout', JSON.stringify({ out: denyOut3, nexted: nexted3b }))

  // ★★ group20c：opaque 构造不得关掉破坏性子设置，也不得绕开显式 deny 例外
  // 反例：shell-parse 的 destructive 判定写回 `!unparsable && …`，本组即失败。
  // 注意这里**只收「段首就是破坏性命令」的形态**：`bash -lc "..."` 这类段首是解释器的
  // 嵌套调用按 D-4 落大分类默认值（大分类 allow 即放行）—— 那是计划里明确接受的取舍
  // （§10.5 登记为「参考工程是 deny，本计划是 ask」），不在本组的断言范围。
  const opaqueCases = ['rm -rf ~/.dsh $(true)', 'rm -rf ~/.dsh `true`', 'if true; then rm -rf ~/.dsh; fi',
    'find . -exec rm -rf {} +', 'Remove-Item -Recurse -Force $(Get-Location)']
  await callRoute(h3.routes, 'POST', '/permgate/set-command-sub', { target: 'global', action: 'ask', lang: 'zh', sessionId: 'sess-1' })
  await callRoute(h3.routes, 'POST', '/permgate/set-category', { target: 'global', category: 'command', mode: 'allow', lang: 'zh', sessionId: 'sess-1' })
  const leakedOpaque = []
  for (const c of opaqueCases) {
    let nexted3 = false
    const p = pre3(makeExec(ws3, 'bash', { command: c }), async () => { nexted3 = true; return { kind: 'allow' } })
    p.catch(() => {})
    await Promise.race([p, new Promise((r) => setTimeout(() => r({ kind: 'timeout' }), 300))])
    if (nexted3) leakedOpaque.push(c)
  }
  ok('★★ group20c: 大分类 allow 时 opaque 构造/控制关键字/find -exec 均不得静默放行破坏性命令',
    leakedOpaque.length === 0, JSON.stringify(leakedOpaque))

  // ★★ group20d：设置顺序不得影响结果（无顺序依赖）
  // 背景：曾让 setCategoryMode 在「大分类收紧到 deny」时联动把子设置也改成 deny。
  // 但写入侧无法区分「子设置是默认 ask」与「用户显式设成了 ask」—— 两者值相同，
  // 于是那次同步会**静默覆盖用户的显式表态**，且造成「先设 A 后设 B」与「先设 B 后设 A」
  // 结果不同。本组用两条**相反顺序**的操作序列断言最终状态一致，并断言用户表态被保留。
  const orderCases = [
    ['先设子设置=ask，再设大分类=deny', async (routes) => {
      await callRoute(routes, 'POST', '/permgate/set-command-sub', { target: 'global', action: 'ask', lang: 'zh', sessionId: 'sess-1' })
      await callRoute(routes, 'POST', '/permgate/set-category', { target: 'global', category: 'command', mode: 'deny', lang: 'zh', sessionId: 'sess-1' })
    }],
    ['先设大分类=deny，再设子设置=ask', async (routes) => {
      await callRoute(routes, 'POST', '/permgate/set-category', { target: 'global', category: 'command', mode: 'deny', lang: 'zh', sessionId: 'sess-1' })
      await callRoute(routes, 'POST', '/permgate/set-command-sub', { target: 'global', action: 'ask', lang: 'zh', sessionId: 'sess-1' })
    }],
  ]
  const orderResults = []
  for (const [label, runSteps] of orderCases) {
    const wsO = mkdtempSync(join(tmpdir(), 'pg-order-ws-'))
    const homeO = mkdtempSync(join(tmpdir(), 'pg-order-home-'))
    mkdirSync(join(homeO, 'dsh-permgate'), { recursive: true })
    const hO = createHost({ workspaceRoot: wsO, dshHome: homeO })
    await runSteps(hO.routes)
    const stO = await callRoute(hO.routes, 'GET', '/permgate/status')
    const subO = stO.data && stO.data.commandSub
    const preO = hO.hooks.get('tools/pre-execute')
    const probeO = async (cmd) => {
      let nexted = false
      const p = preO(makeExec(wsO, 'bash', { command: cmd }), async () => { nexted = true; return { kind: 'allow' } })
      p.catch(() => {})
      const out = await Promise.race([p, new Promise((r) => setTimeout(() => r({ kind: 'timeout' }), 300))])
      return nexted ? 'allow' : ((out && out.kind) || 'timeout')
    }
    const subAction = subO && subO.global && subO.global.action
    const destructive = await probeO('rm -rf x')
    const plain = await probeO('git status')
    orderResults.push({ label, subAction, destructive, plain })
    // 用户显式设的 ask 必须被保留（不得被子设置默认值/联动改写覆盖）
    ok('★★ group20d: ' + label + ' → 用户显式设的子设置保留为 ask',
      subAction === 'ask', JSON.stringify(subO))
    // 判定链：子设置优先于大分类 → 破坏性命令弹窗；普通命令落大分类 deny
    ok('★★ group20d: ' + label + ' → 破坏性命令按子设置走（ask，不落大分类 deny）',
      destructive === 'timeout', 'got=' + destructive)
    ok('★★ group20d: ' + label + ' → 普通命令落大分类（deny）',
      plain === 'deny', 'got=' + plain)
    try { rmSync(wsO, { recursive: true, force: true }); rmSync(homeO, { recursive: true, force: true }) } catch (e) {}
  }
  ok('★★ group20d: 两种设置顺序结果完全一致（无顺序依赖）',
    orderResults.length === 2 && JSON.stringify(orderResults[0].subAction) === JSON.stringify(orderResults[1].subAction)
    && orderResults[0].destructive === orderResults[1].destructive && orderResults[0].plain === orderResults[1].plain,
    JSON.stringify(orderResults))

  // ★★ group20e：老格式 migrateOld 路径的八档取值
  //
  // ── 期望已按新规则改写（旧规则删除）────────────────────────────────────────────
  // 旧：migrateOld 走 freshConfig()，八档由读取侧按本层 mode 推导 ——
  //     `locked`（mode=deny）⇒ 八档全 deny，破坏性命令直接拒绝。
  // 新（用户指定，忽略旧配置迁移兼容）：八档一律「项目显式 → 全局显式 → ask」，
  //     migrateOld **不物化** destructive（见 58c），故三种老格式的八档**全是 ask**，
  //     运行时落点一律是弹窗（timeout），与大分类 mode 无关。
  //
  // ⚠️ 行为变化（有意）：老 `locked` 预设升级后，破坏性命令由「直接拒绝」变「弹窗询问」。
  //     方向仍 fail-closed（ask 一定拦得住，不存在静默放行），故下面同时断言 `nexted=false`。
  // 判据保留「inside / outside 两档都查」：单查一档时「八档恒 ask」与「只有这两档 ask」
  // 分不出来，而后者是漏改的典型形态。
  for (const [label, oldMode, wantInside, wantSub, wantVerdict] of [
    ['group20e: locked → 八档全 ask（不再按 mode 推导为 deny）', 'locked', 'ask', 'ask', 'timeout'],
    ['group20e: permissive → 八档全 ask', 'permissive', 'ask', 'ask', 'timeout'],
    ['group20e: off → 八档全 ask', 'off', 'ask', 'ask', 'timeout'],
  ]) {
    const wsM = mkdtempSync(join(tmpdir(), 'pg-old-ws-'))
    const homeM = mkdtempSync(join(tmpdir(), 'pg-old-home-'))
    mkdirSync(join(homeM, 'dsh-permgate'), { recursive: true })
    // 老格式：只有 global.mode，没有分类键（触发 migrateOld）
    writeFileSync(join(homeM, 'dsh-permgate', 'config.json'), JSON.stringify({ global: { mode: oldMode } }, null, 2), 'utf8')
    const hM = createHost({ workspaceRoot: wsM, dshHome: homeM })
    const stM = await callRoute(hM.routes, 'GET', '/permgate/status')
    const csM = stM.data && stM.data.commandSub
    ok('★★ ' + label,
      !!(csM && csM.effective && csM.effective.inside === wantInside && csM.effective.outside === wantSub),
      JSON.stringify(csM && csM.effective))
    // 运行时：落点必须与八档一致，且**不得静默放行**（新规则下三种老格式都是弹窗）
    let nextedM = false
    const pM = hM.hooks.get('tools/pre-execute')(makeExec(wsM, 'bash', { command: 'rm -rf ~/.dsh' }), async () => { nextedM = true; return { kind: 'allow' } })
    pM.catch(() => {})
    const outM = await Promise.race([pM, new Promise((r) => setTimeout(() => r({ kind: 'timeout' }), 300))])
    const gotM = nextedM ? 'allow' : ((outM && outM.kind) || 'timeout')
    ok('★★ group20e: ' + oldMode + ' 老配置下工作区外破坏性命令落点 = ' + wantVerdict + '（弹窗，不得静默放行）',
      gotM === wantVerdict, 'got=' + gotM)
    try { rmSync(wsM, { recursive: true, force: true }); rmSync(homeM, { recursive: true, force: true }) } catch (e) {}
  }

  // ★★ group20f：间接执行的破坏性命令必须被用户的 deny 例外拦住（例外视野与子设置对称）。
  // 背景：破坏性子设置看的是 labels **并集**（能看到 `find -exec rm` 里的 rm），
  // 而例外匹配一度只看「段原文 + 主 label」（`find . -exec rm …` 的主 label 是 `find`）——
  // 于是「子设置能拦、用户的 deny 例外却拦不住」。实测（子设置 allow + 例外 `rm *`=deny）：
  //   `rm -rf /x`                → deny（例外命中）
  //   `find . -exec rm -rf {} +` → **allow** ← 用户显式写的「rm 一律拒绝」被绕过
  // 修法：例外匹配抽成单一实现 resolveException，opaque 段与可读段共用、都试全部 label。
  // 用**独立 host**：本组需要一条 `rm *`=deny 例外，它会按「顺序即优先级」压过 group20 里
  // 已有的 allow 例外，污染后续断言（实测踩过）。
  const wsF = mkdtempSync(join(tmpdir(), 'pg-segF-ws-'))
  const homeF = mkdtempSync(join(tmpdir(), 'pg-segF-home-'))
  mkdirSync(join(homeF, 'dsh-permgate'), { recursive: true })
  writeFileSync(join(homeF, 'dsh-permgate', 'config.json'), JSON.stringify({
    global: {
      fallbackMode: 'ask',
      command: {
        mode: 'allow', destructive: { action: 'allow' },
        exceptions: [{ id: 'e1', action: 'deny', match: 'rm *' }],
      },
    },
    projects: {},
  }, null, 2), 'utf8')
  const hF = createHost({ workspaceRoot: wsF, dshHome: homeF })
  const preF = hF.hooks.get('tools/pre-execute')
  const probeF = async (c) => {
    let nexted = false
    const p = preF(makeExec(wsF, 'bash', { command: c }), async () => { nexted = true; return { kind: 'allow' } })
    p.catch(() => {})
    const out = await Promise.race([p, new Promise((r) => setTimeout(() => r({ kind: 'timeout' }), 300))])
    return { nexted, verdict: out && out.kind }
  }
  const leakedInd = []
  for (const c of ['find . -exec rm -rf {} +', 'find . -delete', 'time find . -delete',
    'find . -exec rm -rf {} \\;', 'echo $(rm -rf /x)', 'echo "`rm -rf /x`"']) {
    const r = await probeF(c)
    if (!(r.verdict === 'deny')) leakedInd.push(c + ' → ' + r.verdict)
  }
  ok('★★ group20f: 间接执行的破坏性命令被 deny 例外拦住（find -exec / find -delete / 命令替换）',
    leakedInd.length === 0, JSON.stringify(leakedInd))
  // 反向：额外 label 不得让无关例外命中（不得引入误报）
  const fpInd = []
  for (const c of ['find . -name "*.log"', 'find . -exec echo {} +', 'echo $(date)', 'find . -type f']) {
    const r = await probeF(c)
    if (r.nexted !== true) fpInd.push(c + ' → ' + r.verdict)
  }
  ok('group20f: 无关命令不被 rm 例外误伤（额外 label 不引入误报）', fpInd.length === 0, JSON.stringify(fpInd))
  try { rmSync(wsF, { recursive: true, force: true }); rmSync(homeF, { recursive: true, force: true }) } catch (e) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // group20g：八档体系的端到端（计划 blast-tier-plan.md §6.1 / §5.5 / §7.3）
  // ═══════════════════════════════════════════════════════════════════════════
  // 本组走**真实 tools/pre-execute 链路**，验证本计划的核心收益与必须守住的红线：
  //   ① mode=allow 时 `rm test.txt`（区内）**不再弹窗** —— 这是计划的目标，不是回归；
  //   ② 同一配置下 `rm -rf B:\` / `sudo ls` / `kill 1234` **仍然要问** —— D-6 的核心。
  // 两条必须一起断言：只测 ① 会漏掉「把七档也一起放开了」这种致命放松。
  {
    const wsT = mkdtempSync(join(tmpdir(), 'pg-tier-ws-'))
    const homeT = mkdtempSync(join(tmpdir(), 'pg-tier-home-'))
    mkdirSync(join(homeT, 'dsh-permgate'), { recursive: true })
    // 大分类 allow、子设置**一个字都不写** —— 让读取侧按 mode 推导（这才是新装用户的形态）
    writeFileSync(join(homeT, 'dsh-permgate', 'config.json'), JSON.stringify({
      global: { fallbackMode: 'ask', command: { mode: 'allow', exceptions: [] } }, projects: {},
    }, null, 2), 'utf8')
    const hT = createHost({ workspaceRoot: wsT, dshHome: homeT })
    const preT = hT.hooks.get('tools/pre-execute')
    const probeT = async (c) => {
      let nexted = false
      const p = preT(makeExec(wsT, 'bash', { command: c }), async () => { nexted = true; return { kind: 'allow' } })
      p.catch(() => {})
      const out = await Promise.race([p, new Promise((r) => setTimeout(() => r({ kind: 'timeout' }), 300))])
      return nexted ? 'allow' : ((out && out.kind) || 'timeout')
    }

    // ① 新规则下 mode=allow 时区内破坏性命令**仍然弹窗**
    //
    // ── 期望已按新规则改写（旧规则删除）────────────────────────────────────────────
    // 旧：八档按本层 mode 推导，inside = mode = allow ⇒ `rm test.txt` / `rm -rf ./build`
    //     静默放行。那是旧计划的核心收益。
    // 新（用户指定）：八档一律「项目显式 → 全局显式 → ask」，配置里没写 destructive
    //     ⇒ 八档全 ask ⇒ 区内删除也弹窗。
    // ⚠️ 这是**有意的行为变化**：新规则下「想放行区内删除」必须显式把 inside 档设为 allow
    //     （面板上就是「工作区内」那一档的下拉框）。用户接受，理由：档位设置可见可改，
    //     而默认全 ask 是 fail-closed 的方向。
    // 判据同时查「没有 next」（防空转）：只查 === 'allow' 时，把实现改成恒 deny 也能通过。
    const insideOut = { f: await probeT('rm test.txt'), d: await probeT('rm -rf ./build') }
    ok('★★ group20g: mode=allow 且未显式设档时，区内删除**仍要问**（八档同构继承 → 全 ask）',
      insideOut.f !== 'allow' && insideOut.d !== 'allow',
      JSON.stringify(insideOut))
    // ①b 显式把 inside 档设成 allow 后，区内删除才静默放行（新规则下这条路径必须真的通）
    //
    // **用独立宿主**：在 hT 上写 inside 会往配置里落一个显式的 `action:'ask'`（复原那一步
    // 也照样落盘），于是后面 ④ 的 `source.inside === 'default'` 与 ⑤ 的
    // `global.action === undefined` 全部失败 —— 实测踩过（残留把两条断言一起弄红）。
    // 本组只关心「显式设置能否生效」，不需要污染 hT 的配置。
    {
      const wsI = mkdtempSync(join(tmpdir(), 'pg-inside-ws-'))
      const homeI = mkdtempSync(join(tmpdir(), 'pg-inside-home-'))
      mkdirSync(join(homeI, 'dsh-permgate'), { recursive: true })
      writeFileSync(join(homeI, 'dsh-permgate', 'config.json'), JSON.stringify({
        global: { fallbackMode: 'ask', command: { mode: 'allow', exceptions: [] } }, projects: {},
      }, null, 2), 'utf8')
      const hI = createHost({ workspaceRoot: wsI, dshHome: homeI })
      const preI = hI.hooks.get('tools/pre-execute')
      const probeI = async (c) => {
        let nexted = false
        const p = preI(makeExec(wsI, 'bash', { command: c }), async () => { nexted = true; return { kind: 'allow' } })
        p.catch(() => {})
        const out = await Promise.race([p, new Promise((r) => setTimeout(() => r({ kind: 'timeout' }), 300))])
        return nexted ? 'allow' : ((out && out.kind) || 'timeout')
      }
      const before = await probeI('rm test.txt')
      await callRoute(hI.routes, 'POST', '/permgate/set-command-sub',
        { target: 'global', tier: 'inside', action: 'allow', lang: 'zh', sessionId: 'sess-1' })
      const after = { f: await probeI('rm test.txt'), d: await probeI('rm -rf ./build') }
      ok('★★ group20g: 显式把 inside 档设为 allow 后，区内删除才静默放行（档位设置真的生效）',
        before !== 'allow' && after.f === 'allow' && after.d === 'allow',
        JSON.stringify({ before: before, after: after }))
      // 且此时 wide 档仍是 ask（设 inside 不得连带放开其它档 —— 「逐档」的意义）
      ok('★ group20g: 设 inside=allow 不得连带放开 wide 档（rm -rf C:/Windows 仍不是 allow）',
        (await probeI('rm -rf C:/Windows')) !== 'allow')
      try { rmSync(wsI, { recursive: true, force: true }); rmSync(homeI, { recursive: true, force: true }) } catch (e) {}
    }

    // ② 红线：同一配置下这些**必须仍然要问**（D-6 的核心，保护范围收窄但没消失）
    //
    // 目标必须用**宿主的平台**能判出来的形态：宿主是 Windows（shellPlatform() 给 win32），
    // 于是 `/etc` 在 win32 下不是系统目录（它是「当前盘根下的 etc」，实测判 outside），
    // 而 `C:/Windows` 才是。用错平台的目标会让这条断言假红（实测踩过）。
    const mustAsk = [
      ['rm -rf ~/.dsh', '工作区外删除（outside 档）'],
      ['rm -rf C:/Windows', '系统目录（wide 档）'],
      ['sudo ls', '提权（priv 档，改前由 destructive=allow 静默放行）'],
      ['kill 1234', '结束进程（proc 档，改前静默）'],
      ['shutdown -h now', '关机（power 档）'],
      ['taskkill /im x.exe', '结束进程（proc 档）'],
      ['rm -rf $TARGET', '目标读不出（unknown 档，fail-closed）'],
    ]
    const leaked = []
    for (const [c, why] of mustAsk) {
      const v = await probeT(c)
      if (v === 'allow') leaked.push(c + '（' + why + '）')
    }
    ok('★★ group20g: 同一配置下七档仍不松于 ask（大范围/提权/进程/电源/读不出 → 不是 allow）',
      leaked.length === 0, JSON.stringify(leaked))

    // ③ §5.5 的核心收益：删整个项目**不再静默**（改前一族五种写法全落 inside → allow）
    const wsRoot = []
    for (const c of ['rm -rf .', 'rm -rf *', 'rm -rf ./*']) {
      const v = await probeT(c)
      if (v === 'allow') wsRoot.push(c)
    }
    ok('★★ group20g: mode=allow 时删整个项目根仍要问（工作区根归 wide，§5.5 核心收益）',
      wsRoot.length === 0, JSON.stringify(wsRoot))

    // ④ §7.3：statusView 下发八档 + groups
    //    ⚠️ 期望已按新规则改写：配置里没写 destructive ⇒ 八档全 ask（含 inside）。
    //    旧规则下 inside 由 mode 推导为 allow。
    //    `globalDefault` / `projectDefault` 两个字段**已删除**（连同「按本层 mode 推导
    //    档位缺省值」那套规则）—— 它们是「两份八档默认值规则并存」的第二份，
    //    与裁决用的 `effective` 会逐档分叉（同一响应里出现两个矛盾的 inside 默认值），
    //    且经 perm_status 回给 AI。故这里从「断言字段存在」改为**断言字段已消失**，
    //    防止有人把第二份真相加回来。
    const stT = await callRoute(hT.routes, 'GET', '/permgate/status')
    const csT = stT.data && stT.data.commandSub
    ok('★ 48 statusView 下发八档：tiers / effective（八档 + source）/ groups；*Default 已删除',
      !!(csT && Array.isArray(csT.tiers) && csT.tiers.length === 8
        && csT.effective && csT.effective.inside === 'ask' && csT.effective.wide === 'ask'
        && csT.effective.source && csT.effective.source.inside === 'default'
        && csT.globalDefault === undefined && csT.projectDefault === undefined
        && csT.groups && Array.isArray(csT.groups.del) && csT.groups.del.indexOf('rm') !== -1),
      JSON.stringify(csT && { tiers: csT.tiers, eff: csT.effective, groups: csT.groups && Object.keys(csT.groups),
        globalDefault: csT.globalDefault, projectDefault: csT.projectDefault }))
    // ⑤ 八档可**独立**写入（写 wide 不得连带改 inside）
    //    ⚠️ 期望已改写：inside 不再是 allow 而是 ask（未显式配置 → 末级兜底 ask）。
    //    判据的重点没变 —— 写 wide 时 inside **不得被连带改动**。
    await callRoute(hT.routes, 'POST', '/permgate/set-command-sub', { target: 'global', tier: 'wide', action: 'deny', reason: '不许删系统目录', lang: 'zh', sessionId: 'sess-1' })
    const stT2 = await callRoute(hT.routes, 'GET', '/permgate/status')
    const csT2 = stT2.data && stT2.data.commandSub
    ok('★★ 48b 八档可独立写入：写 wide=deny 不改动 inside（仍是未表态的 ask）',
      !!(csT2 && csT2.effective.inside === 'ask' && csT2.effective.wide === 'deny'
        && csT2.global && csT2.global.wide === 'deny' && csT2.global.action === undefined),
      JSON.stringify(csT2 && { inside: csT2.effective.inside, wide: csT2.effective.wide, g: csT2.global }))
    // 且 wide=deny 立即生效：`rm -rf C:/Windows` 变 deny，而 `rm test.txt` 仍不是 deny
    //    （新规则下未配置的 inside 档是 ask，故这里断言 `!== 'deny'` 而不是 `=== 'allow'`）
    const wideOut = { win: await probeT('rm -rf C:/Windows'), txt: await probeT('rm test.txt') }
    ok('★★ 48c wide=deny 生效且不误伤：rm -rf C:/Windows → deny；rm test.txt → 不是 deny',
      wideOut.win === 'deny' && wideOut.txt !== 'deny', JSON.stringify(wideOut))
    // ⑥ 非法 tier 必须被拒绝（不静默落到某个档）
    const badTier = await callRoute(hT.routes, 'POST', '/permgate/set-command-sub', { target: 'global', tier: 'nope', action: 'deny', lang: 'zh', sessionId: 'sess-1' })
    ok('★ 48d 非法 tier 被拒绝（回错误，不静默落 inside）',
      !!(badTier && badTier.data && badTier.data.error), JSON.stringify(badTier && badTier.data))
    // ── ★★ 48e：`globalEffectiveProbe` 必须下发「**全局层单独**的生效值」────────────────
    // 它是面板**全局 tab** 的取值来源（客户端按 tab 分派：项目 → effective、全局 → 本字段）。
    // 缺了它，客户端只能拿 `effective` 回填全局 tab，而 effective 是
    // `destructiveTiers(root)`、其 `explicitOf` **项目优先** —— 于是全局 tab 会显示成
    // **当前项目**的值：用户切到全局 tab 看到「拒绝」，以为全局已受保护（删掉项目配置
    // 或换项目后保护静默消失）；更严重的是那一行既然显示 deny 就渲染出「编辑原因」按钮，
    // 用户补一句理由会以 target:'global' 提交 —— **在全局层凭空写入 wide=deny**。
    //
    // 判据（三场景，全部落在**真实 statusView 下发值**上）：
    //   ① 全局层从未配置 + 当前项目只设 wide=deny → probe.wide 必须是 **ask**（不是项目的 deny）；
    //      且同一响应里 effective.wide 仍是 deny（证明两者确实是**不同口径**、不是同值空转）；
    //   ② probe 必须与「全局层单独解析」一致：存量 `{action:'deny'}` + mode=allow 时
    //      **仅 inside=deny、其余七档 ask**（与裁决一致）—— 这一条同时钉死「不得按本层
    //      mode 推导档位」：那样会得到 inside=allow、其余七档 ask，用它回填会让全局 tab
    //      显示「允许 1 · 询问 7」而实际裁决 inside=deny（面板说谎换个形态再来一遍）。
    //      ⚠️ 那个「按 mode 推导」的表（`globalDefault` 字段）**已删除**，故现在客户端
    //      没有可回落的第二来源；本组的反查仍保留，防止有人把那条路径加回来。
    //   ③ 全局层**显式** wide=deny → probe.wide 必须是 deny（修复不得把全局 tab 变成恒 ask）。
    {
      // ① 独立宿主：全局层一个字都不写，项目层只写 wide=deny
      const wsP = mkdtempSync(join(tmpdir(), 'pg-probe-ws-'))
      const homeP = mkdtempSync(join(tmpdir(), 'pg-probe-home-'))
      mkdirSync(join(homeP, 'dsh-permgate'), { recursive: true })
      writeFileSync(join(homeP, 'dsh-permgate', 'config.json'), JSON.stringify({
        global: { fallbackMode: 'ask', command: { mode: 'ask', exceptions: [] } }, projects: {},
      }, null, 2), 'utf8')
      const hP = createHost({ workspaceRoot: wsP, dshHome: homeP })
      await callRoute(hP.routes, 'POST', '/permgate/set-command-sub', { target: 'project', tier: 'wide', action: 'deny', reason: '删系统目录', lang: 'zh', sessionId: 'sess-1' })
      const csP = (await callRoute(hP.routes, 'GET', '/permgate/status')).data.commandSub
      ok('★★ 48e 全局 tab 的来源字段：全局未配置 + 项目 wide=deny → globalEffectiveProbe.wide=ask，而 effective.wide=deny（两者口径必须分叉，否则全局 tab 会显示项目层的值）',
        !!(csP && csP.globalEffectiveProbe && csP.globalEffectiveProbe.wide === 'ask'
          && csP.effective.wide === 'deny'
          && csP.global === null && csP.project && csP.project.wide === 'deny'
          && csP.globalEffectiveProbe.inside === 'ask'),
        JSON.stringify(csP && { probe: csP.globalEffectiveProbe, eff: csP.effective, g: csP.global, p: csP.project }))
      // 反向形态：项目显式 wide=allow 时全局 tab 也不得显示「允许」（方向相反的同一污染）
      await callRoute(hP.routes, 'POST', '/permgate/set-command-sub', { target: 'project', tier: 'wide', action: 'allow', lang: 'zh', sessionId: 'sess-1' })
      const csP2 = (await callRoute(hP.routes, 'GET', '/permgate/status')).data.commandSub
      ok('★★ 48e-2 方向相反的同一污染：项目显式 wide=allow 时 globalEffectiveProbe.wide 仍是 ask（全局 tab 不得显示成「允许」）',
        !!(csP2 && csP2.globalEffectiveProbe && csP2.globalEffectiveProbe.wide === 'ask' && csP2.effective.wide === 'allow'),
        JSON.stringify(csP2 && { probe: csP2.globalEffectiveProbe && csP2.globalEffectiveProbe.wide, eff: csP2.effective.wide }))
      try { rmSync(wsP, { recursive: true, force: true }); rmSync(homeP, { recursive: true, force: true }) } catch (e) {}
    }
    // ② `{action:'deny'}` + mode=allow → probe 里**只有 inside 档是 deny**，其余七档 ask
    //
    //    ⚠️ 期望已按新规则改写：旧规则把 `action` 摊成八档全 deny（§6.2②），
    //    新规则下 `action` 只是 inside 那一档的键，其余七档各自继承/兜底。
    //    本条不再需要「不得回落 globalDefault」那半句 —— 那个字段（以及它代表的
    //    「按本层 mode 推导档位」规则）**已整体删除**，不存在第二来源可回落。
    //    故这里钉**真正要守的东西**：probe 与真实裁决必须一致（下一条 48e-4）。
    {
      const wsQ = mkdtempSync(join(tmpdir(), 'pg-probe2-ws-'))
      const homeQ = mkdtempSync(join(tmpdir(), 'pg-probe2-home-'))
      mkdirSync(join(homeQ, 'dsh-permgate'), { recursive: true })
      writeFileSync(join(homeQ, 'dsh-permgate', 'config.json'), JSON.stringify({
        global: { fallbackMode: 'ask', command: { mode: 'allow', destructive: { action: 'deny' }, exceptions: [] } }, projects: {},
      }, null, 2), 'utf8')
      const hQ = createHost({ workspaceRoot: wsQ, dshHome: homeQ })
      const csQ = (await callRoute(hQ.routes, 'GET', '/permgate/status')).data.commandSub
      const onlyInsideDeny = csQ && csQ.globalEffectiveProbe
        && csQ.globalEffectiveProbe.inside === 'deny'
        && csQ.tiers.filter((t) => t !== 'inside').every((t) => csQ.globalEffectiveProbe[t] === 'ask')
      ok('★★ 48e-3 存量 action=deny + mode=allow → probe 里仅 inside=deny、其余七档 ask（八档同构继承，不再摊派）',
        !!(csQ && onlyInsideDeny && csQ.effective.inside === 'deny'),
        JSON.stringify(csQ && { probe: csQ.globalEffectiveProbe, eff: csQ.effective }))
      // 运行时对照：`rm -rf C:/Windows` 落 **wide** 档（不是 inside）→ 新规则下是 ask（弹窗），
      // 而不是旧规则下被 `action:'deny'` 摊派出来的 deny。
      // 这条同时证明「probe 与裁决同源」—— probe.wide 是 ask，裁决也是 ask。
      const preQ = hQ.hooks.get('tools/pre-execute')
      let nextedQ = false
      const pQ = preQ(makeExec(wsQ, 'bash', { command: 'rm -rf C:/Windows' }), async () => { nextedQ = true; return { kind: 'allow' } })
      pQ.catch(() => {})
      const outQ = await Promise.race([pQ, new Promise((r) => setTimeout(() => r({ kind: 'timeout' }), 300))])
      ok('★★ 48e-4 probe 的 wide=ask 与真实裁决一致：rm -rf C:/Windows 落 wide 档 → 弹窗（不得静默放行）',
        !nextedQ && outQ && outQ.kind === 'timeout',
        JSON.stringify({ nexted: nextedQ, kind: outQ && outQ.kind, probeWide: csQ && csQ.globalEffectiveProbe && csQ.globalEffectiveProbe.wide }))
      // 48e-4b inside 档本身仍是 deny（配置真的生效，不是恒 ask 的摆设）
      let nextedQ2 = false
      const pQ2 = preQ(makeExec(wsQ, 'bash', { command: 'rm -rf ./build' }), async () => { nextedQ2 = true; return { kind: 'allow' } })
      pQ2.catch(() => {})
      const outQ2 = await Promise.race([pQ2, new Promise((r) => setTimeout(() => r({ kind: 'timeout' }), 300))])
      ok('★★ 48e-4b inside 档的 deny 仍然生效：rm -rf ./build（区内）→ deny',
        !nextedQ2 && outQ2 && outQ2.kind === 'deny', JSON.stringify({ nexted: nextedQ2, kind: outQ2 && outQ2.kind }))
      try { rmSync(wsQ, { recursive: true, force: true }); rmSync(homeQ, { recursive: true, force: true }) } catch (e) {}
    }
    // ③ 全局层**显式**配置必须正常显示（防空转对照：probe 不得恒 ask）
    {
      const csR = (await callRoute(hT.routes, 'GET', '/permgate/status')).data.commandSub
      ok('★★ 48e-5 防空转对照：全局层显式 wide=deny 时 globalEffectiveProbe.wide 必须是 deny（probe 不是恒 ask 的摆设）',
        !!(csR && csR.globalEffectiveProbe && csR.globalEffectiveProbe.wide === 'deny'
          && csR.global && csR.global.wide === 'deny'),
        JSON.stringify(csR && { probe: csR.globalEffectiveProbe, g: csR.global }))
    }
    // ── ★★ 60e：decisive 档无理由时理由必须回落到**并列在最严档**的命中档（发现 6）──────
    // 本组是本缺陷的**生产现场**：用户在新面板上逐档填理由（这里填 `outside`），而
    // `unknown` 档**没有**用户写下的理由（用户只为 `outside` 写过）—— 它是被
    // `tierSetOf` 因「目标读不出」并进来的，或用户设了动作却没填理由。
    //
    // 而 `tierSetOf` 对「读得出的目标 + 读不出的目标」同段共存会并列并入 `unknown`
    // （发现 1 的修法），`TIER_ORDER` 里 `unknown` 排在 `outside` **之前** ——
    // 于是 decisive 档从 `outside` 变成 `unknown`，`tierVerdict` 取不到理由：
    //     rm -rf /etc          → deny，理由含「删工作区外文件」✅
    //     rm -rf /etc $TARGET  → deny，理由**不含**该句 ❌（同一句理由在面板上仍显示着）
    // 即**动作始终 deny（不是 fail-open），丢的是用户写给 AI 的那句拒绝理由**。
    //
    // 判据（缺一即为空转 / 改错方向）：
    //   ① 修复现场：`rm -rf /etc $TARGET` 一族必须 deny **且**理由里含用户写的那句；
    //   ② 动作不变（对照）：与不带 `$TARGET` 的形态**同 kind**，且都不是 ask/allow；
    //   ③ 面板口径不变：`statusView` 下发的 `globalReasons.outside` 仍是那句，
    //      且 `unknown` 档**没有**理由（证明 `unknown` 是派生的、用户没表过态）；
    //   ④ 防空转：不带 `$TARGET` 的基线形态本来就带理由 —— 否则「加了 $TARGET 才有理由」
    //      这句话无从谈起（差异确实由本修法引入）。
    {
      const ws6 = mkdtempSync(join(tmpdir(), 'pg-r60-ws-'))
      const home6 = mkdtempSync(join(tmpdir(), 'pg-r60-home-'))
      mkdirSync(join(home6, 'dsh-permgate'), { recursive: true })
      // 用户显式配：outside 与 unknown 两档都是 deny，但**只为 outside 写了理由**。
      //
      // ⚠️ 场景构造已按新规则改写：旧规则下 `unknown` 由 `inside=deny` 经
      // `strictest(ask, inside)` **派生**为 deny（用户没表过态）；新规则下八档不再派生，
      // 故这里把 `unknown: 'deny'` **显式写出来**，才复现出同一个现场 ——
      // 「unknown 与 outside 并列在最严档，但只有 outside 有理由」。
      // 被测的东西没变：`tierVerdict` 在 decisive 档取不到理由时，必须回落到并列档的那句。
      // ⚠️ `outside` / `unknown` 的 deny **必须显式写**：`normalizeSubSetting` 只在
      // **该档显式配成 deny** 时保留 `reasons[t]`（allow 不弹窗、ask 有自己的备注）——
      // 只写 `action:'deny'` 的话 `reasons.outside` 在加载时就被丢弃，测的就不是
      // 「用户在面板上写下了理由」这个现场了。
      writeFileSync(join(home6, 'dsh-permgate', 'config.json'), JSON.stringify({
        global: {
          fallbackMode: 'ask',
          command: {
            mode: 'allow', exceptions: [],
            destructive: { action: 'deny', outside: 'deny', unknown: 'deny', reasons: { outside: '删工作区外文件' } },
          },
        },
        projects: {},
      }, null, 2), 'utf8')
      const h6 = createHost({ workspaceRoot: ws6, dshHome: home6 })
      const pre6 = h6.hooks.get('tools/pre-execute')
      const probe6 = async (c) => {
        let nexted = false
        const p = pre6(makeExec(ws6, 'bash', { command: c }), async () => { nexted = true; return { kind: 'allow' } })
        p.catch(() => {})
        const out = await Promise.race([p, new Promise((r) => setTimeout(() => r({ kind: 'timeout' }), 300))])
        return { nexted, kind: (out && out.kind) || 'timeout', reason: String((out && out.reason) || '') }
      }
      const bad60e = []
      const mixed60e = ['rm -rf /etc $TARGET', 'rm -rf $TARGET /etc', 'dd of=$DEV of=/dev/sda']
      const seen60e = []
      for (const c of mixed60e) {
        const r = await probe6(c)
        seen60e.push([c, r.nexted, r.kind, r.reason.slice(0, 60)])
        // ① 现场：仍是 deny，且理由真的到了 AI 看到的文本里
        if (r.nexted || r.kind !== 'deny') { bad60e.push([c, 'action', r.nexted, r.kind]); continue }
        if (r.reason.indexOf('删工作区外文件') === -1) bad60e.push([c, 'reason-missing', r.reason])
      }
      // ④ 基线（防空转）：不带读不出目标的形态**本来就**带这句理由
      const base60e = await probe6('rm -rf /etc')
      // ② 动作不变：现场与基线同 kind（都是 deny）
      const actSame60e = base60e.kind === 'deny' && !base60e.nexted
        && seen60e.every((s) => s[1] === false && s[2] === 'deny')
      // ③ 面板口径不变：理由仍挂在 outside 档；unknown 档是派生的、没有理由
      const st6 = await callRoute(h6.routes, 'GET', '/permgate/status')
      const cs6 = st6.data && st6.data.commandSub
      ok('★★ 60e 生产路径：decisive 档（unknown，派生为 deny 且无理由）无理由时，拒绝理由必须回落到并列的 outside 档（rm -rf /etc $TARGET 必须带回用户在面板上写下的那句）',
        bad60e.length === 0
        // ④ 基线对照（防空转）：不带 `$TARGET` 时理由本来就在
        && base60e.kind === 'deny' && base60e.reason.indexOf('删工作区外文件') !== -1
        // ② 动作不变（补理由绝不改动作）
        && actSame60e
        // ③ 面板口径不变：那句理由仍显示在 outside 档；unknown 档没有理由（用户没为它写过）
        && !!(cs6 && cs6.globalReasons && cs6.globalReasons.outside === '删工作区外文件'
          && !cs6.globalReasons.unknown)
        // ③b 八档确实全 deny（unknown 与 outside 都显式 deny —— 这正是「派生档没有理由」的前提）
        && !!(cs6 && cs6.effective && cs6.effective.inside === 'deny' && cs6.effective.unknown === 'deny'
          && cs6.effective.outside === 'deny'),
        JSON.stringify({ bad60e, seen60e, base: [base60e.kind, base60e.reason.slice(0, 60)],
          panel: cs6 && { reasons: cs6.globalReasons, eff: cs6.effective } }))
      try { rmSync(ws6, { recursive: true, force: true }); rmSync(home6, { recursive: true, force: true }) } catch (e) {}
    }

    // ⑦ §7.2d 的缺陷回归：改 wide 的理由**不得**改动 inside 的动作
    // 这条走真实路由，正是 `commitSubReason` 修复前会写错的那条路径
    // （它硬编码 `action: 'deny'` 且不带 tier → 写到缺省档 inside）。
    const before7 = (await callRoute(hT.routes, 'GET', '/permgate/status')).data.commandSub
    await callRoute(hT.routes, 'POST', '/permgate/set-command-sub', { target: 'global', tier: 'wide', action: 'deny', reason: '改过的理由', lang: 'zh', sessionId: 'sess-1' })
    const after7 = (await callRoute(hT.routes, 'GET', '/permgate/status')).data.commandSub
    ok('★★ 59c 改 wide 的理由不改动 inside 的动作（§7.2d 缺陷回归）',
      !!(after7.effective.inside === before7.effective.inside && after7.effective.inside === 'ask'
        && after7.globalReasons && after7.globalReasons.wide === '改过的理由'
        && !after7.globalReasons.inside),
      JSON.stringify({ before: before7.effective.inside, after: after7.effective.inside, reasons: after7.globalReasons }))
    // ⑧ per-tier reason 各自独立：再给 priv 一个不同的理由，两条并存
    await callRoute(hT.routes, 'POST', '/permgate/set-command-sub', { target: 'global', tier: 'priv', action: 'deny', reason: '别提权', lang: 'zh', sessionId: 'sess-1' })
    const after8 = (await callRoute(hT.routes, 'GET', '/permgate/status')).data.commandSub
    ok('★ 59 per-tier reason 独立：wide 与 priv 两条理由并存，互不覆盖',
      !!(after8.globalReasons && after8.globalReasons.wide === '改过的理由' && after8.globalReasons.priv === '别提权'),
      JSON.stringify(after8.globalReasons))
    // ⑨ 某档切离 deny 时**只删该档**理由
    await callRoute(hT.routes, 'POST', '/permgate/set-command-sub', { target: 'global', tier: 'wide', action: 'ask', lang: 'zh', sessionId: 'sess-1' })
    const after9 = (await callRoute(hT.routes, 'GET', '/permgate/status')).data.commandSub
    ok('★ 59 某档切离 deny 时只删该档理由（priv 的仍在）',
      !!(after9.globalReasons && !after9.globalReasons.wide && after9.globalReasons.priv === '别提权'),
      JSON.stringify(after9.globalReasons))
    // ⑪ ★★ 59d：项目层把 **inside 档**改成 inherit **不得整块重建** `destructive` —— 八档一律逐档写入。
    // 缺陷原状：setCommandSub 在 inside 档收到 inherit 时执行 `block.command.destructive = { action: 'inherit' }`
    // （整块重建），把本层**其余七档的显式键与 `reasons` 一并清掉**。而读取侧的 `explicitOf` 是**逐档独立**的：
    // `{action:'inherit', wide:'deny'}` 本就是合法状态（inside 穿透全局、wide 仍取本层 deny），
    // 故「只把 inside 改成继承全局」不该连带放松 wide。
    // 走**真实路由**（与上面 ⑤～⑨ 同一套调用方式）：缺陷就在写入侧那个分支里，纯函数/形状断言够不到它。
    // 全局 wide 此刻停在 ask（⑨ 刚把它从 deny 改回 ask），于是本层 wide 一旦被清掉，生效值立刻由 deny 掉到 ask：
    // 三个字段同时变红，不会出现「恰好与全局相等所以看不出」的假绿。
    await callRoute(hT.routes, 'POST', '/permgate/set-command-sub', { target: 'project', tier: 'wide', action: 'deny', reason: '删系统目录', lang: 'zh', sessionId: 'sess-1' })
    const pSubPre = (await callRoute(hT.routes, 'GET', '/permgate/status')).data.commandSub
    ok('★★ 59d 前置：项目层 wide=deny 已写入本层（显式值 + 理由都在，避免下面空转）',
      !!(pSubPre && pSubPre.effective.wide === 'deny'
        && pSubPre.project && pSubPre.project.wide === 'deny'
        && pSubPre.projectReasons && pSubPre.projectReasons.wide === '删系统目录'),
      JSON.stringify(pSubPre && { eff: pSubPre.effective, proj: pSubPre.project, reasons: pSubPre.projectReasons }))
    // 再给项目层 **inside 档**写一个带理由的显式 deny，让它成为 59d-2 的前置：
    // 「写 deny」与「改 inherit」落在**同一个键**上，于是「该档理由被清」这一步不是空转
    // （从没设过理由时它必然为空，断言就白写了）。
    await callRoute(hT.routes, 'POST', '/permgate/set-command-sub', { target: 'project', tier: 'inside', action: 'deny', reason: '本层不许删', lang: 'zh', sessionId: 'sess-1' })
    const pSubPre2 = (await callRoute(hT.routes, 'GET', '/permgate/status')).data.commandSub
    ok('★★ 59d 前置②：项目层 inside=deny（带理由）已写入本层（59d-2 的「该档理由被清」才不是空转）',
      !!(pSubPre2 && pSubPre2.project && pSubPre2.project.action === 'deny'
        && pSubPre2.projectReasons && pSubPre2.projectReasons.inside === '本层不许删'
        && pSubPre2.effective.inside === 'deny'),
      JSON.stringify(pSubPre2 && { proj: pSubPre2.project, reasons: pSubPre2.projectReasons, eff: pSubPre2.effective }))
    await callRoute(hT.routes, 'POST', '/permgate/set-command-sub', { target: 'project', tier: 'inside', action: 'inherit', lang: 'zh', sessionId: 'sess-1' })
    const pSubPost = (await callRoute(hT.routes, 'GET', '/permgate/status')).data.commandSub
    ok('★★ 59d 项目层 inside 档改 inherit 不得整块重建 destructive：wide 的显式 deny 与理由必须原样留在本层（八档逐档独立写入）',
      !!(pSubPost && pSubPost.effective.wide === 'deny'
        && pSubPost.projectReasons && pSubPost.projectReasons.wide === '删系统目录'
        && pSubPost.project && pSubPost.project.wide === 'deny'),
      JSON.stringify(pSubPost && { eff: pSubPost.effective, proj: pSubPost.project, reasons: pSubPost.projectReasons }))
    // 59d-2：上面那条只覆盖「写 wide → 写 inside=inherit → 查 **wide**」的首尾，
    // **中间那次写入本身的落盘结果无人校验** —— 于是它对「过度写入」有效，
    // 对「写入丢失」是盲的：写入侧若静默吞掉这次 inside+inherit（既不写 action、
    // 也不清该档理由），wide 的三个字段全都原样不动，上面那条照样绿，
    // 而用户点「继承全局」后本层仍是 action:'deny'、effective.source.inside 仍停在
    // 'project' —— 面板操作静默失效、面板与实际裁决分叉。故这里直接查**该档自己的键**。
    ok('★★ 59d-2 项目层 inside 档改 inherit 的这次写入必须真的落盘：本层 action 变 inherit、该档理由被清、生效值穿透回全局（写入不得被静默吞掉）',
      !!(pSubPost && pSubPost.project && pSubPost.project.action === 'inherit'
        && pSubPost.projectReasons && !pSubPost.projectReasons.inside
        && pSubPost.effective.inside === 'ask'
        && pSubPost.effective.source && pSubPost.effective.source.inside === 'default'),
      JSON.stringify(pSubPost && { proj: pSubPost.project, reasons: pSubPost.projectReasons, eff: pSubPost.effective }))
    // 上面那条读的是 statusView —— 也就是**内存里的 config**，整块没有一次读盘，故它守不住落盘：
    // `persist()` 有多条 `return false` 早退路径（home 未就绪、外部修改守卫、home 切换），而
    // set-command-sub 路由**不检查它的返回值**。于是「写内存成功、磁盘保留旧值」时上面那条照样绿：
    // 面板与运行时（都读内存）一致显示已继承全局，磁盘却仍是 action:'deny'，**reload 后静默变回
    // deny** —— 用户点「继承全局」的这次操作在重启后无声消失，而测试全程绿灯。
    // 故这里必须**真读盘**，且一条断言同时覆盖两件事：
    //   ① 这次写入确实落了盘（不是只改内存）：盘上该档 action=inherit、该档理由已清；
    //   ② 没有**过度写入**：兄弟档 wide 的显式 deny 与理由仍在盘上（整块重建会一并清掉它们）。
    const diskCfgT = JSON.parse(readFileSync(join(homeT, 'dsh-permgate', 'config.json'), 'utf8'))
    // 项目键不硬编码：按本组已有的工作区变量归一化后匹配（与本文件既有的 normKey 口径一致 ——
    // 插件内部 projectBlock/ensureProject 也用 norm() 归一化，分隔符与大小写都可能不同）
    const normDiskKey = (s) => String(s).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
    const diskKeyT = Object.keys(diskCfgT.projects || {}).filter((k) => normDiskKey(k) === normDiskKey(wsT))[0]
    const diskSubT = (diskKeyT && diskCfgT.projects[diskKeyT] && diskCfgT.projects[diskKeyT].command
      && diskCfgT.projects[diskKeyT].command.destructive) || null
    ok('★★ 59d-2（落盘）inside 档 inherit 必须真的写进磁盘 config.json，而不只是内存：盘上 action=inherit、该档理由已清；且兄弟档 wide 的显式 deny 与理由仍在盘上（写入既没丢、也没过度写）',
      !!(diskKeyT && diskSubT
        && diskSubT.action === 'inherit'
        && !(diskSubT.reasons && diskSubT.reasons.inside)
        && diskSubT.wide === 'deny'
        && diskSubT.reasons && diskSubT.reasons.wide === '删系统目录'),
      JSON.stringify({ key: diskKeyT, keys: Object.keys(diskCfgT.projects || {}), sub: diskSubT }))
    // 同一件事的**运行时**一侧：inside 档写 inherit 就是穿透回全局（全局该档是 ask → 本层弹窗），
    // 而 wide 的显式 deny 仍拦着。面板显示的值与实际裁决必须是同一个值 —— 分开断两处，
    // 免得「面板绿、裁决红」这种双份真相溜过去。
    //
    // ⚠️ 期望已按新规则改写：旧规则下全局 mode=allow 让 inside 派生为 allow，
    // 故 `rm test.txt` 是 allow；新规则下全局未显式设 inside 档 → ask，
    // 故它是**弹窗**。判据改为「不是 allow」（= 继承真的发生了，且方向 fail-closed）。
    const inheritOut = { txt: await probeT('rm test.txt'), win: await probeT('rm -rf C:/Windows') }
    ok('★★ 59d-2 inside 档 inherit 后生效值穿透回全局（rm test.txt → 不是 allow，即弹窗），而本层 wide 的 deny 仍在拦（rm -rf C:/Windows → deny）',
      inheritOut.txt !== 'allow' && inheritOut.win === 'deny', JSON.stringify(inheritOut))

    // ⑩ 存量 `reason` 字符串读进 inside 档，且**不搬家**（`reason` 键原样留在盘上）
    const legacyHome = mkdtempSync(join(tmpdir(), 'pg-legacy-home-'))
    const legacyWs = mkdtempSync(join(tmpdir(), 'pg-legacy-ws-'))
    mkdirSync(join(legacyHome, 'dsh-permgate'), { recursive: true })
    const legacyCfg = JSON.stringify({
      global: { fallbackMode: 'ask', command: { mode: 'allow', destructive: { action: 'deny', reason: 'rm 危险' } } }, projects: {},
    }, null, 2)
    writeFileSync(join(legacyHome, 'dsh-permgate', 'config.json'), legacyCfg, 'utf8')
    const hL = createHost({ workspaceRoot: legacyWs, dshHome: legacyHome })
    const stL = await callRoute(hL.routes, 'GET', '/permgate/status')
    const csL = stL.data && stL.data.commandSub
    ok('★★ 59b 存量 reason 字符串：读取侧归 inside 档（其余七档拿不到理由，与「用户没表过态」一致）',
      !!(csL && csL.effective.inside === 'deny'
        // ⚠️ 期望已按新规则改写：旧规则下七档 = strictest(ask, inside=deny) = deny；
        // 新规则下 `action:'deny'` 只是 inside 那一档，其余七档落 ask。
        && csL.effective.outside === 'ask'
        && csL.effective.wide === 'ask'
        && csL.globalReasons && csL.globalReasons.inside === 'rm 危险'
        && !csL.globalReasons.wide),
      JSON.stringify(csL && { eff: csL.effective, reasons: csL.globalReasons }))
    // 不搬家：纯加载（只 GET status，不写任何东西）后，磁盘上的 `reason` 键**原样还在**
    // —— 读取侧兼容 ≠ 写盘时搬家。搬家的代价：一次纯加载就改写用户配置文件，
    // 而用户看到自己的 `reason` 变成 `reasons.inside` 会以为是插件擅自改配置。
    const onDisk = JSON.parse(readFileSync(join(legacyHome, 'dsh-permgate', 'config.json'), 'utf8'))
    const dsub = onDisk.global.command.destructive
    ok('★★ 59b 纯加载不搬家：磁盘上仍是裸 reason 键，未被改写为 reasons.inside',
      !!(dsub && dsub.reason === 'rm 危险' && dsub.reasons === undefined),
      JSON.stringify(dsub))
    // 老配置下 wide 档的取值：新规则下 `action:'deny'` 不再摊给七档 ⇒ wide/proc/priv 全是 ask
    //
    // ⚠️ 期望已按新规则改写：旧规则「七档 = strictest(ask, inside=deny) = deny（全拒保住）」。
    // 新规则下只有 inside 是 deny，其余七档落 ask。这是「忽略旧配置迁移兼容」的直接后果。
    ok('★★ 43b 存量 destructive=deny + mode=allow → 仅 inside=deny，七档为 ask（不再摊派全拒）',
      !!(csL && csL.effective.inside === 'deny'
        && csL.effective.wide === 'ask' && csL.effective.proc === 'ask' && csL.effective.priv === 'ask'),
      JSON.stringify(csL && csL.effective))
    // 运行时对照：老配置下 `rm -rf C:/Windows` 落 **wide** 档 → 新规则下是弹窗（不是直接拒绝），
    // 但**绝不能静默放行**（fail-closed 方向）。
    let nextedL = false
    const pL = hL.hooks.get('tools/pre-execute')(makeExec(legacyWs, 'bash', { command: 'rm -rf C:/Windows' }), async () => { nextedL = true; return { kind: 'allow' } })
    pL.catch(() => {})
    const outL = await Promise.race([pL, new Promise((r) => setTimeout(() => r({ kind: 'timeout' }), 300))])
    ok('★★ 43b 存量配置下 rm -rf C:/Windows（wide 档）→ 弹窗询问，不得静默放行',
      !nextedL && outL && outL.kind === 'timeout', JSON.stringify({ nexted: nextedL, kind: outL && outL.kind }))

    // ── ★★ 存量 `reason` 必须**随拒绝一起下发**，非 inside 档也不例外 ──────────────
    // 缺陷原状（本差异引入）：`tierVerdict` 只在 `decisiveTierOf` 选中的那一档取理由，
    // 而读取侧把存量裸 `reason` **只**归入 `reasons.inside`（§7.1/§6.2 的有意设计）。
    // §6.2 把七档一起推成 deny 之后，**所有非 inside 档的命中都拿不到理由**：
    // 用户写过的拒绝理由静默消失，AI 收到的拒绝指令是空的 —— 而面板上那句理由仍显示在
    // inside 档（`explicitReasonsOf` 的口径），即「面板看得见、AI 收不到」= 面板说谎。
    //
    // 为什么必须在**生产钩子路径**上断：同一份存量配置经 `tierTableOf`（旧契约兼容路径）
    // 拿得到理由，只有 `destructiveTiers`（生产路径）拿不到 —— 两条路径分叉，
    // 而纯函数/形状断言够不到这个分叉（它只在真实钩子返回值上显形）。
    //
    // 三档各覆盖一类判据（§3.2）：wide=半径档、proc=组档、priv=半径+组并存。
    // ⚠️ 旧的 `legacyReasonCases` 列表已随摊派规则一起删除 —— 新规则下这三档是 ask，
    // 「每档都拿到拒绝理由」这个需求不再存在（见下）。
    // ── 存量裸 `reason` 的**归属**：只随 inside 档下发 ─────────────────────────────
    //
    // ⚠️ 本块已按新规则改写。旧规则下 `action:'deny'` 被摊成八档全 deny，于是
    // wide / proc / priv 三档命中时也要拿到那句理由（否则「看得见理由、AI 收不到理由」）。
    // 新规则下这三档是 **ask**（不弹窗时用不上拒绝理由），那句理由只对 inside 档有意义 ——
    // 「每档都给」这个需求随摊派规则一起消失了。
    //
    // 保留下来的是**真正还成立的那半条**：inside 档命中时必须带回那句理由
    // （AI 收到的拒绝指令不能是空的）。这条是基线，也是唯一还可达的形态。
    {
      let nextedI = false
      const pI = hL.hooks.get('tools/pre-execute')(makeExec(legacyWs, 'bash', { command: 'rm test.txt' }), async () => { nextedI = true; return { kind: 'allow' } })
      pI.catch(() => {})
      const outI = await Promise.race([pI, new Promise((r) => setTimeout(() => r({ kind: 'timeout' }), 300))])
      ok('★★ 存量「拒绝 + reason」在 inside 档命中时带回那句理由（AI 收到的拒绝指令不为空）',
        !nextedI && !!outI && outI.kind === 'deny' && String(outI.reason || '').indexOf('rm 危险') !== -1,
        JSON.stringify({ nexted: nextedI, kind: outI && outI.kind, reason: outI && outI.reason }))
    }
    // 反向对照：wide 档在新规则下是 ask，**不得**带着那句拒绝理由（它属于 inside 档的拒绝）
    {
      let nextedW = false
      const pW = hL.hooks.get('tools/pre-execute')(makeExec(legacyWs, 'bash', { command: 'rm -rf C:/Windows' }), async () => { nextedW = true; return { kind: 'allow' } })
      pW.catch(() => {})
      const outW = await Promise.race([pW, new Promise((r) => setTimeout(() => r({ kind: 'timeout' }), 300))])
      ok('★ 反向对照：wide 档在新规则下是 ask，不携带 inside 档的拒绝理由（理由不跨档乱窜）',
        !nextedW && !!outW && outW.kind === 'timeout' && String(outW.reason || '').indexOf('rm 危险') === -1,
        JSON.stringify({ nexted: nextedW, kind: outW && outW.kind, reason: outW && outW.reason }))
    }
    // 且面板视图的口径**不变**：裸 `reason` 仍只显示在 inside 档（§7.1 的有意设计）。
    // 这一条与上面两条**不是**矛盾 —— 面板回答「用户在哪一档上写下了理由」（归 inside），
    // 裁决回答「AI 该收到哪句话」（每档都给）。两个提问不同，故口径不同是**有意**的。
    // 断言它，是为了防止下一个人把两处「统一」掉时**悄悄改掉面板语义**而无人发现。
    ok('★★ 面板视图口径不变：存量裸 reason 仍只显示在 inside 档（不因裁决侧摊到八档而跟着摊）',
      !!(csL && csL.globalReasons && csL.globalReasons.inside === 'rm 危险'
        && !csL.globalReasons.wide && !csL.globalReasons.proc && !csL.globalReasons.priv),
      JSON.stringify(csL && csL.globalReasons))
    try { rmSync(legacyWs, { recursive: true, force: true }); rmSync(legacyHome, { recursive: true, force: true }) } catch (e) {}

    // ── ★★ 动作来源层 ≠ 理由来源层：裸 `reason` 必须跨层回落（两个方向都要）────────────
    // 缺陷原状（本差异引入）：`destructiveTiers` ③ 只按**该档自己的显式来源**（`explicitOf(t).from`）
    // 取理由，即「动作来自哪一层，就去哪一层找理由」。这条假设**不成立** ——
    // 裸 `reason` 是**类别级**字符串（老配置语义 = 「整个破坏性类别」），它落在哪一层
    // 与「该档的动作来自哪一层」没有必然关系，两者可以不同层。于是两个方向都丢理由：
    //
    //   ① 全局 `{action:'deny', reason:'…'}` + 项目 `{wide:'deny'}`
    //      → `rm -rf C:/Windows` 命中 wide，动作来源是**项目**（项目只写了动作、没写理由），
    //        那句类别级理由却在**全局** → 只按 `from` 取得到 null；
    //   ② 反向：全局 `{wide:'deny'}` + 项目 `{action:'deny', reason:'…'}`
    //      → wide 的动作来源是**全局**，理由却在**项目**。
    //
    // 两个方向都**不是 fail-open**（动作始终 deny），丢的是用户写给 AI 的那句拒绝理由，
    // 而面板上那句理由仍显示在 inside 档（`explicitReasonsOf` 的口径）——
    // 「面板看得见理由、AI 收不到理由」，正是本文件反复警告的那一族。
    //
    // 为什么必须在**生产钩子路径**上断：丢理由发生在 `destructiveTiers` 产出的档位表里，
    // 而它经 `assessCommand` → `tierVerdict` 才变成最终 `reason`；纯函数/形状断言
    // 够不到「档位表 → 裁决理由」这一跳。故这里走真实 pre-execute，读最终返回值。
    //
    // 判据（缺一即为空转 / 改错方向）：
    //   ① 两个方向都必须 **deny**（动作不得因补理由而变化）；
    //   ② 两个方向都必须带回**另一层**那句理由（含「跨层」二字才算真跨了层）；
    //   ③ 防空转对照：两层都没写理由时，同一条命令仍是 deny 但 **reason 里不含任何理由句**
    //      —— 否则「拿到了理由」无从谈起（可能是无条件拼了一句常量）。
    for (const dir of [
      { name: '方向①动作在项目、理由在全局', g: { action: 'deny', reason: '全局那句理由' }, p: { tier: 'wide', action: 'deny' }, want: '全局那句理由' },
      { name: '方向②动作在全局、理由在项目', g: { wide: 'deny' }, p: { tier: 'inside', action: 'deny', reason: '项目那句理由' }, want: '项目那句理由' },
    ]) {
      const wsX = mkdtempSync(join(tmpdir(), 'pg-xlayer-ws-'))
      const homeX = mkdtempSync(join(tmpdir(), 'pg-xlayer-home-'))
      mkdirSync(join(homeX, 'dsh-permgate'), { recursive: true })
      writeFileSync(join(homeX, 'dsh-permgate', 'config.json'), JSON.stringify({
        global: { fallbackMode: 'ask', command: { mode: 'allow', exceptions: [], destructive: dir.g } }, projects: {},
      }, null, 2), 'utf8')
      const hX = createHost({ workspaceRoot: wsX, dshHome: homeX })
      // 项目层经**真实路由**写入（与面板同一条路径），故它落盘的形状与用户点面板一致
      await callRoute(hX.routes, 'POST', '/permgate/set-command-sub',
        { target: 'project', tier: dir.p.tier, action: dir.p.action, reason: dir.p.reason, lang: 'zh', sessionId: 'sess-1' })
      const preX = hX.hooks.get('tools/pre-execute')
      const probeX = async (c) => {
        let nexted = false
        const p = preX(makeExec(wsX, 'bash', { command: c }), async () => { nexted = true; return { kind: 'allow' } })
        p.catch(() => {})
        const out = await Promise.race([p, new Promise((r) => setTimeout(() => r({ kind: 'timeout' }), 300))])
        return { nexted, kind: nexted ? 'allow' : ((out && out.kind) || 'timeout'), reason: String((out && out.reason) || '') }
      }
      // 前置：wide 档此刻确实是 deny（否则下面拿到的 deny 不是这条路径给的，断言空转）
      const csX = (await callRoute(hX.routes, 'GET', '/permgate/status')).data.commandSub
      const outX = await probeX('rm -rf C:/Windows')
      ok('★★ 跨层理由回落 ' + dir.name + '：rm -rf C:/Windows（wide 档）必须 deny **且**带回另一层那句理由（动作来源层 ≠ 理由来源层）',
        !!(!outX.nexted && outX.kind === 'deny' && outX.reason.indexOf(dir.want) !== -1
          && csX && csX.effective && csX.effective.wide === 'deny'),
        JSON.stringify({ dir: dir.name, nexted: outX.nexted, kind: outX.kind, reason: outX.reason, wide: csX && csX.effective && csX.effective.wide }))
      // ③ 防空转对照：**两层都没写任何理由**时，同一命令仍是 deny，但 reason 里不含上面两句
      const wsY = mkdtempSync(join(tmpdir(), 'pg-xlayer2-ws-'))
      const homeY = mkdtempSync(join(tmpdir(), 'pg-xlayer2-home-'))
      mkdirSync(join(homeY, 'dsh-permgate'), { recursive: true })
      writeFileSync(join(homeY, 'dsh-permgate', 'config.json'), JSON.stringify({
        global: { fallbackMode: 'ask', command: { mode: 'allow', exceptions: [], destructive: { action: 'deny' } } }, projects: {},
      }, null, 2), 'utf8')
      const hY = createHost({ workspaceRoot: wsY, dshHome: homeY })
      await callRoute(hY.routes, 'POST', '/permgate/set-command-sub',
        { target: 'project', tier: 'wide', action: 'deny', lang: 'zh', sessionId: 'sess-1' })
      let nextedY = false
      const pY = hY.hooks.get('tools/pre-execute')(makeExec(wsY, 'bash', { command: 'rm -rf C:/Windows' }), async () => { nextedY = true; return { kind: 'allow' } })
      pY.catch(() => {})
      const outY = await Promise.race([pY, new Promise((r) => setTimeout(() => r({ kind: 'timeout' }), 300))])
      const reasonY = String((outY && outY.reason) || '')
      ok('★ 跨层理由回落 防空转对照：两层都没写理由时同一命令仍 deny，且理由里不含任何一层的那句（不是无条件拼常量）',
        !!(!nextedY && outY && outY.kind === 'deny'
          && reasonY.indexOf('全局那句理由') === -1 && reasonY.indexOf('项目那句理由') === -1),
        JSON.stringify({ nexted: nextedY, kind: outY && outY.kind, reason: reasonY }))
      try {
        rmSync(wsX, { recursive: true, force: true }); rmSync(homeX, { recursive: true, force: true })
        rmSync(wsY, { recursive: true, force: true }); rmSync(homeY, { recursive: true, force: true })
      } catch (e) {}
    }

    // ── ★★ 同一条跨层性质对 **per-tier 理由**（`reasons[tier]`）同样必须成立 ────────────
    // 上面那族用例只覆盖**裸 `reason`**（类别级字符串），而 per-tier 理由是**另一条**取值
    // 路径（`destructive.reasons[tier]`）。缺陷原状：`destructiveTiers` ③ 对 per-tier 理由
    // 仍只读**该档动作的来源层**（`explicitOf(t).from.reasons[t]`），跨层回落只补给了裸
    // `reason` —— 于是 per-tier 这一族照旧丢理由。
    //
    // 形态比裸 `reason` 那族**更常见**，因为它就是面板档位下拉框的产物：下拉框只提交
    // `{target, tier, action}`、**不带 reason**（client.js 的 changeSubDestructive），
    // 只有用户点「编辑原因」时才带上（commitSubReason）。故
    //   全局 `{wide:'deny', reasons:{wide:'…'}}` + 项目 `{wide:'deny'}`（下拉框写的）
    // 是常规可达路径，不是边角：wide 的动作来源是**项目**、per-tier 理由却在**全局**。
    //
    // 判据（与上面那族同源）：
    //   ① 动作必须仍是 deny（补理由不得改动作）；
    //   ② 必须带回**另一层**那份 per-tier 理由；
    //   ③ **本层优先**：两层都写了同一档的理由时，取该档动作来源层的（项目压过全局）；
    //   ④ 防空转对照：两层都没写任何理由时仍是 deny，且理由里不含任何一句
    //      —— 否则「拿到了理由」无从谈起（可能是无条件拼了一句常量）。
    //
    // ⚠️ 反向（理由在项目、该档动作在全局）在本文件**构造不出来**，故不在这里断：
    // 写盘侧 normalizeSubSetting 只在**该层该档显式 deny** 时保留 `reasons[t]`
    // （`const explicit = t === 'inside' ? out.action : out[t]; if (explicit !== 'deny') continue`），
    // 故「理由所在层」必然同时是「该档动作的来源层」—— 反方向是**不可达形状**。
    // 读取侧对反方向的次序由 regressions.mjs 直接喂原始块覆盖（那里绕开归一化）。
    {
      const mkXHost = async (globalDestructive, projectCalls) => {
        const w = mkdtempSync(join(tmpdir(), 'pg-tierr-ws-'))
        const h = mkdtempSync(join(tmpdir(), 'pg-tierr-home-'))
        mkdirSync(join(h, 'dsh-permgate'), { recursive: true })
        writeFileSync(join(h, 'dsh-permgate', 'config.json'), JSON.stringify({
          global: { fallbackMode: 'ask', command: { mode: 'allow', exceptions: [], destructive: globalDestructive } }, projects: {},
        }, null, 2), 'utf8')
        const host = createHost({ workspaceRoot: w, dshHome: h })
        for (const c of projectCalls) {
          await callRoute(host.routes, 'POST', '/permgate/set-command-sub',
            { target: 'project', tier: c.tier, action: c.action, reason: c.reason, lang: 'zh', sessionId: 'sess-1' })
        }
        const pre = host.hooks.get('tools/pre-execute')
        const probe = async (cmd) => {
          let nexted = false
          const p = pre(makeExec(w, 'bash', { command: cmd }), async () => { nexted = true; return { kind: 'allow' } })
          p.catch(() => {})
          const out = await Promise.race([p, new Promise((r) => setTimeout(() => r({ kind: 'timeout' }), 300))])
          return { nexted, kind: nexted ? 'allow' : ((out && out.kind) || 'timeout'), reason: String((out && out.reason) || '') }
        }
        return { w, h, host, probe }
      }
      // ① per-tier 理由在**全局**、动作来源在**项目**（面板下拉框的常规产物）
      const cA = await mkXHost({ wide: 'deny', reasons: { wide: '全局那份逐档理由' } }, [{ tier: 'wide', action: 'deny' }])
      const stA = (await callRoute(cA.host.routes, 'GET', '/permgate/status')).data.commandSub
      const outA = await cA.probe('rm -rf C:/Windows')
      ok('★★ per-tier 理由跨层回落（方向①动作在项目、reasons.wide 在全局）：wide 档必须 deny **且**带回全局那份逐档理由',
        !!(!outA.nexted && outA.kind === 'deny' && outA.reason.indexOf('全局那份逐档理由') !== -1
          && stA && stA.effective && stA.effective.wide === 'deny'),
        JSON.stringify({ nexted: outA.nexted, kind: outA.kind, reason: outA.reason, wide: stA && stA.effective && stA.effective.wide }))
      // 且面板视图照旧只在**写了理由的那一层**显示它（口径不变，不因裁决侧跨层回落而跟着搬）
      ok('★ per-tier 理由跨层回落：面板视图仍把该理由显示在全局层（不因裁决跨层取用而搬到项目层）',
        !!(stA && stA.globalReasons && stA.globalReasons.wide === '全局那份逐档理由'
          && !(stA.projectReasons && stA.projectReasons.wide)),
        JSON.stringify({ g: stA && stA.globalReasons, p: stA && stA.projectReasons }))
      try { rmSync(cA.w, { recursive: true, force: true }); rmSync(cA.h, { recursive: true, force: true }) } catch (e) {}

      // ② 本层优先：两层都写了 wide 的 per-tier 理由时，取**该档动作来源层**（项目）那句
      const cB = await mkXHost({ wide: 'deny', reasons: { wide: '全局那份逐档理由' } },
        [{ tier: 'wide', action: 'deny', reason: '项目那份逐档理由' }])
      const outB = await cB.probe('rm -rf C:/Windows')
      ok('★★ per-tier 理由本层优先：两层都写了 wide 的理由时取项目层那句（项目压过全局），且动作仍是 deny',
        !!(!outB.nexted && outB.kind === 'deny' && outB.reason.indexOf('项目那份逐档理由') !== -1
          && outB.reason.indexOf('全局那份逐档理由') === -1),
        JSON.stringify({ nexted: outB.nexted, kind: outB.kind, reason: outB.reason }))
      try { rmSync(cB.w, { recursive: true, force: true }); rmSync(cB.h, { recursive: true, force: true }) } catch (e) {}

      // ③ 防空转对照：两层都没写**任何**理由（per-tier 与裸都没有）→ 仍是 deny，且理由里不含那两句
      //
      // ⚠️ 判据不能只比「不含那两句具体文字」—— 那样一个**无条件拼常量**的实现只要常量换句话
      // 就能溜过去（实测：把回落写成 `|| '凭空造的理由'` 时，只比文字的版本照样通过）。
      // 故这里同时断**档位表本身**：`effective.reasons` 里根本不得出现 wide 这个键
      // —— 「两层都没写过理由」的直接含义就是该档没有理由可给。
      const cC = await mkXHost({ wide: 'deny' }, [{ tier: 'wide', action: 'deny' }])
      const stC = (await callRoute(cC.host.routes, 'GET', '/permgate/status')).data.commandSub
      const outC = await cC.probe('rm -rf C:/Windows')
      const effReasonsC = (stC && stC.effective && stC.effective.reasons) || null
      ok('★ per-tier 理由跨层回落 防空转对照：两层都没写理由时同一命令仍 deny，且理由里不含任何一层那句（不凭空造理由）',
        !!(!outC.nexted && outC.kind === 'deny'
          && outC.reason.indexOf('全局那份逐档理由') === -1 && outC.reason.indexOf('项目那份逐档理由') === -1
          // 档位表里该档**根本没有**理由键（「两层都没写过」= 无可给的理由，不是「给了句别的」）
          && !(effReasonsC && effReasonsC.wide !== undefined)
          && stC && stC.effective && stC.effective.wide === 'deny'),
        JSON.stringify({ nexted: outC.nexted, kind: outC.kind, reason: outC.reason, effReasons: effReasonsC, wide: stC && stC.effective && stC.effective.wide }))
      try { rmSync(cC.w, { recursive: true, force: true }); rmSync(cC.h, { recursive: true, force: true }) } catch (e) {}
    }

    try { rmSync(wsT, { recursive: true, force: true }); rmSync(homeT, { recursive: true, force: true }) } catch (e) {}
  }

  try {
    rmSync(ws, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true })
    rmSync(ws2, { recursive: true, force: true }); rmSync(home2, { recursive: true, force: true })
    rmSync(ws3, { recursive: true, force: true }); rmSync(home3, { recursive: true, force: true })
  } catch (e) {}
}

// ─────────────────────────────────────────────────────────────
group('21. 自定义规则：数组顺序 = 优先级（首条命中即返回）')
{
  // 背景：曾把规则改成「最严命中」，实测毁掉「具体规则覆盖宽泛规则」这个最自然的写法。
  // 本组把两种意图都钉住：顺序即优先级是**能力**，不是缺陷。
  const ws = mkdtempSync(join(tmpdir(), 'pg-rule-ws-'))
  const home = mkdtempSync(join(tmpdir(), 'pg-rule-home-'))
  mkdirSync(join(home, 'dsh-permgate'), { recursive: true })
  // 判定探针：跑一次 `tools/pre-execute`，返回 `{ nexted, verdict }`。
  // `nexted` = 是否走到 `next()`（放行）；`verdict` = 宿主返回的 `kind`。
  // 300ms 超时兜底：宿主挂起时不能让测试永久卡住（超时得到 `kind:'timeout'`）。
  // `pre` 由调用方传入 —— 本区块每组用例都重建宿主（`setRules`），hook 各不相同。
  const probe = async (pre, name, args) => {
    let nexted = false
    const p = pre(makeExec(ws, name, args || {}), async () => { nexted = true; return { kind: 'allow' } })
    p.catch(() => {})
    const out = await Promise.race([p, new Promise((r) => setTimeout(() => r({ kind: 'timeout' }), 300))])
    return { nexted, verdict: out && out.kind }
  }
  const setRules = (rules) => {
    writeFileSync(join(home, 'dsh-permgate', 'config.json'), JSON.stringify({
      global: { fallbackMode: 'ask', custom: rules }, projects: {},
    }, null, 2), 'utf8')
    return createHost({ workspaceRoot: ws, dshHome: home })
  }

  // 意图一：「宽泛兜底 + 具体例外」——具体 allow 排在宽泛 deny 之前，必须生效
  let h1 = setRules([
    { id: 'r1', action: 'allow', tool: 'pwsh', args: 'git status' },
    { id: 'r2', action: 'deny', tool: 'pwsh' },
  ])
  const pre1 = h1.hooks.get('tools/pre-execute')
  const r1 = await probe(pre1, 'pwsh', { command: 'git status' })
  ok('★ group21: 具体 allow 排在宽泛 deny 之前 → 该具体用法放行（顺序即优先级）', r1.nexted === true)
  const r1b = await probe(pre1, 'pwsh', { command: 'rm -rf /' })
  ok('★ group21: 同一配置下其它 pwsh 命令仍被宽泛 deny 拦住', r1b.verdict === 'deny', JSON.stringify(r1b))

  // 意图二：「具体拒绝 + 宽泛放行」——反过来写也要能表达
  const h2 = setRules([
    { id: 'r1', action: 'deny', tool: 'pwsh', args: 'rm -rf' },
    { id: 'r2', action: 'allow', tool: 'pwsh' },
  ])
  const pre2 = h2.hooks.get('tools/pre-execute')
  const r2 = await probe(pre2, 'pwsh', { command: 'rm -rf /' })
  ok('★ group21: 具体 deny 排在宽泛 allow 之前 → 该具体用法被拒（反方向同样可表达）',
    r2.verdict === 'deny', JSON.stringify(r2))
  const r2b = await probe(pre2, 'pwsh', { command: 'git status' })
  ok('★ group21: 同一配置下其它 pwsh 命令按宽泛 allow 放行', r2b.nexted === true)

  // ★ add-rule 插到**尾部**（后加的排最后）：顺序完全归用户，不自动重排 —— 用户定。
  // 已知后果（有意接受）：新规则若被前面命中的规则遮蔽就不生效，直到用户手动把它调到前面。
  const h3 = setRules([{ id: 'rOld', action: 'deny', tool: 'pwsh' }])
  const addRes = await callRoute(h3.routes, 'POST', '/permgate/add-rule', { target: 'global', action: 'allow', tool: 'pwsh', args: 'git status', lang: 'zh' })
  ok('group21: add-rule 写入成功', !!(addRes.data && addRes.data.added), JSON.stringify(addRes.data && (addRes.data.error || addRes.data.added)))
  const st3 = await callRoute(h3.routes, 'GET', '/permgate/status')
  const list3 = (st3.data && st3.data.custom && st3.data.custom.global) || []
  ok('★ group21: 新规则排在数组尾部（顺序只由用户改，不自动重排）',
    list3.length === 2 && list3[1].id === (addRes.data.added && addRes.data.added.id) && list3[0].id === 'rOld',
    JSON.stringify(list3.map((r) => r.id)))
  // 端到端确认这个已知后果确实如此（不是 bug，是有意接受的取舍）：
  // 新加的 allow 排在老 deny 之后 → 被遮蔽，暂不生效；用户把它调到前面即可生效。
  const pre3 = h3.hooks.get('tools/pre-execute')
  const r3 = await probe(pre3, 'pwsh', { command: 'git status' })
  ok('★ group21: 新规则排在老规则之后时被遮蔽（已知后果，由用户手动调节顺序解决）',
    r3.nexted === false && r3.verdict === 'deny', JSON.stringify(r3))
  // 对照：把新规则手动调到前面（模拟用户拖动排序后的配置）→ 立即生效
  const h4 = setRules([
    { id: 'rNew', action: 'allow', tool: 'pwsh', args: 'git status' },
    { id: 'rOld', action: 'deny', tool: 'pwsh' },
  ])
  const pre4 = h4.hooks.get('tools/pre-execute')
  const r4 = await probe(pre4, 'pwsh', { command: 'git status' })
  ok('★★ group21: 用户手动把规则调到前面后立即生效（顺序 = 优先级）', r4.nexted === true)

  // ★★ 排序路由（/permgate/reorder）：上面那条用的是「手写配置文件模拟拖动后的顺序」，
  // 它证明的是**读侧**尊重顺序，而不是**写侧**能把顺序改对。这里补写侧：调路由 → 看落盘 →
  // 看真实判定链是否随之改变。三件事缺一不可，否则「路由返回 200 但没写盘」照样通过。
  {
    const h5 = setRules([
      { id: 'rA', action: 'deny', tool: 'pwsh' },
      { id: 'rB', action: 'allow', tool: 'pwsh', args: 'git status' },
      { id: 'rC', action: 'deny', tool: 'pwsh', args: 'rm -rf' },
    ])
    const readList = async () => {
      const st = await callRoute(h5.routes, 'GET', '/permgate/status')
      return ((st.data && st.data.custom && st.data.custom.global) || []).map((r) => r.id)
    }
    ok('group21: 排序前置条件 —— 初始顺序为 [rA, rB, rC]', JSON.stringify(await readList()) === JSON.stringify(['rA', 'rB', 'rC']), JSON.stringify(await readList()))

    // ① 前移：把末位的 rC 放到首位之前（跨多条）
    const mv1 = await callRoute(h5.routes, 'POST', '/permgate/reorder', { target: 'global', kind: 'rule', id: 'rC', anchor: 'rA', position: 'before', lang: 'zh' })
    ok('★ group21: reorder 前移（跨多条）返回成功', !!(mv1.data && mv1.data.reordered), JSON.stringify(mv1.data && (mv1.data.error || mv1.data)))
    ok('★★ group21: reorder 前移落位正确（[rA,rB,rC] → rC 提到 rA 之前）',
      JSON.stringify(await readList()) === JSON.stringify(['rC', 'rA', 'rB']), JSON.stringify(await readList()))

    // ② 后移：把 rC 放到 rA 之后（anchor 原本排在它后面 → 下标要减一，差一位的经典坑）
    const mv2 = await callRoute(h5.routes, 'POST', '/permgate/reorder', { target: 'global', kind: 'rule', id: 'rC', anchor: 'rA', position: 'after', lang: 'zh' })
    ok('★ group21: reorder 后移返回成功', !!(mv2.data && mv2.data.reordered), JSON.stringify(mv2.data && mv2.data.error))
    ok('★★★ group21: reorder 后移落位正确（anchor 在 id 之后时下标减一，不得差一位）',
      JSON.stringify(await readList()) === JSON.stringify(['rA', 'rC', 'rB']), JSON.stringify(await readList()))

    // ③ 写侧真的改变了**判定结果**：现在 rC 排在 rB 之前，故 rm -rf 命中 deny 而不是被 allow 放行
    const pre5 = h5.hooks.get('tools/pre-execute')
    const afterMove = await probe(pre5, 'pwsh', { command: 'rm -rf /' })
    ok('★★ group21: 排序后的顺序在真实判定链上生效（rC 的 deny 不再被 rB 的宽泛 allow 遮蔽）',
      afterMove.nexted === false && afterMove.verdict === 'deny', JSON.stringify(afterMove))

    // ④ 非法参数一律回错误，且**不改动顺序**（静默「就近修正」会让用户以为拖动生效了）
    const bad = await Promise.all([
      callRoute(h5.routes, 'POST', '/permgate/reorder', { target: 'global', kind: 'rule', id: 'rA', anchor: 'rA', position: 'before', lang: 'zh' }),
      callRoute(h5.routes, 'POST', '/permgate/reorder', { target: 'global', kind: 'rule', id: 'nope', anchor: 'rA', position: 'before', lang: 'zh' }),
      callRoute(h5.routes, 'POST', '/permgate/reorder', { target: 'global', kind: 'rule', id: 'rA', anchor: 'nope', position: 'before', lang: 'zh' }),
      callRoute(h5.routes, 'POST', '/permgate/reorder', { target: 'global', kind: 'rule', id: 'rA', anchor: 'rB', lang: 'zh' }),
      callRoute(h5.routes, 'POST', '/permgate/reorder', { target: 'global', kind: 'bogus', id: 'rA', anchor: 'rB', position: 'before', lang: 'zh' }),
    ])
    ok('★ group21: reorder 非法参数（自反 / id 不存在 / anchor 不存在 / 缺 position / kind 非法）一律回错误',
      bad.every((r) => r.data && r.data.error), JSON.stringify(bad.map((r) => r.data && r.data.error)))
    ok('★★ group21: 非法 reorder 不改动顺序（拒绝而不是就近修正）',
      JSON.stringify(await readList()) === JSON.stringify(['rA', 'rC', 'rB']), JSON.stringify(await readList()))

    // ⑤ **相邻互换双向**与**中间项移到两端**：这两类是「差一位」最容易漏的形态
    //    （`at = hit > from ? hit - 1 : hit` 的两个分支各只覆盖一半）。
    //    上面的 ① 只覆盖「anchor 在 id 之后的前移」、② 只覆盖「anchor 在 id 之后的后移」，
    //    即 `hit > from` 分支；`hit < from` 分支（把某条往**后**挪到它后面那条之后）
    //    与相邻互换在旧断言里完全没覆盖 —— 实测把 `hit - 1` 改成 `hit` 后上面全部仍通过。
    {
      // 当前 ['rA','rC','rB']：相邻互换（rA 与 rC 换位）双向各来一次
      const sw1 = await callRoute(h5.routes, 'POST', '/permgate/reorder', { target: 'global', kind: 'rule', id: 'rC', anchor: 'rA', position: 'before', lang: 'zh' })
      ok('★★★ group21: 相邻互换（上移）落位正确', !!(sw1.data && sw1.data.reordered)
        && JSON.stringify(await readList()) === JSON.stringify(['rC', 'rA', 'rB']), JSON.stringify(await readList()))
      const sw2 = await callRoute(h5.routes, 'POST', '/permgate/reorder', { target: 'global', kind: 'rule', id: 'rC', anchor: 'rA', position: 'after', lang: 'zh' })
      ok('★★★ group21: 相邻互换（下移，hit < from 分支）落位正确', !!(sw2.data && sw2.data.reordered)
        && JSON.stringify(await readList()) === JSON.stringify(['rA', 'rC', 'rB']), JSON.stringify(await readList()))
      // 中间项移到两端：先把顺序调成 [rA, rC, rB] 之外的形态不必要，直接用三项验证两端
      const toEnd = await callRoute(h5.routes, 'POST', '/permgate/reorder', { target: 'global', kind: 'rule', id: 'rA', anchor: 'rB', position: 'after', lang: 'zh' })
      ok('★★★ group21: 首项移到末项之后（hit > from 的边界）落位正确', !!(toEnd.data && toEnd.data.reordered)
        && JSON.stringify(await readList()) === JSON.stringify(['rC', 'rB', 'rA']), JSON.stringify(await readList()))
      const toFront = await callRoute(h5.routes, 'POST', '/permgate/reorder', { target: 'global', kind: 'rule', id: 'rA', anchor: 'rC', position: 'before', lang: 'zh' })
      ok('★★★ group21: 末项移到首项之前（hit < from 的边界）落位正确', !!(toFront.data && toFront.data.reordered)
        && JSON.stringify(await readList()) === JSON.stringify(['rA', 'rC', 'rB']), JSON.stringify(await readList()))
    }
  }

  // ★★ 例外列表的排序（同一原语，kind='exception'）：例外的顺序同样是「首条命中即生效」。
  // 用独立 host + 独立配置文件，避免污染上面的规则组。
  {
    const wsE = mkdtempSync(join(tmpdir(), 'pg-exc-ws-'))
    const homeE = mkdtempSync(join(tmpdir(), 'pg-exc-home-'))
    mkdirSync(join(homeE, 'dsh-permgate'), { recursive: true })
    const setExcs = (exceptions) => {
      writeFileSync(join(homeE, 'dsh-permgate', 'config.json'), JSON.stringify({
        global: { fallbackMode: 'ask', command: { mode: 'ask', exceptions: exceptions } }, projects: {},
      }, null, 2), 'utf8')
      return createHost({ workspaceRoot: wsE, dshHome: homeE })
    }
    // 例外模式的选择有个坑：`rm *` 这类**同时命中段 label**（`rm`）的宽泛模式，在
    // shell-parse 的 resolveException 里会走「label 目标」那一轮，而那一轮是
    // **deny > ask > allow** 优先（见 shell-parse.js 的注释：allow 命中不能立即收工，
    // 否则外层 allow 会短路内层 deny）。于是「顺序」在那条路径上不起作用 ——
    // 用它做排序测试会得到一个恒定的结果，断言失败的方向会指向 reorder 而不是模式选得不对。
    // 这里刻意选**只匹配段原文**（不匹配 label `rm`）的模式，让顺序成为唯一变量。
    const h6 = setExcs([
      { id: 'e1', action: 'deny', match: 'rm -rf *' },
      { id: 'e2', action: 'allow', match: 'git *' },
      { id: 'e3', action: 'allow', match: 'rm -rf /tmp/*' },
    ])
    const readExcs = async () => {
      const st = await callRoute(h6.routes, 'GET', '/permgate/status')
      const c = st.data && st.data.categories && st.data.categories.global && st.data.categories.global.command
      return ((c && c.exceptions) || []).map((r) => r.id)
    }
    ok('group21: 例外排序前置条件 —— 初始顺序为 [e1, e2, e3]',
      JSON.stringify(await readExcs()) === JSON.stringify(['e1', 'e2', 'e3']), JSON.stringify(await readExcs()))
    const mvE = await callRoute(h6.routes, 'POST', '/permgate/reorder', { target: 'global', kind: 'exception', category: 'command', id: 'e3', anchor: 'e1', position: 'before', lang: 'zh' })
    ok('★ group21: 例外 reorder 返回成功', !!(mvE.data && mvE.data.reordered), JSON.stringify(mvE.data && (mvE.data.error || mvE.data)))
    ok('★★ group21: 例外 reorder 落位正确（e3 提到 e1 之前）',
      JSON.stringify(await readExcs()) === JSON.stringify(['e3', 'e1', 'e2']), JSON.stringify(await readExcs()))
    // 判定链随之改变：e3 是 `rm -rf /tmp/*`=allow，提到 `rm -rf *`=deny 之前后该命令被放行
    const pre6 = h6.hooks.get('tools/pre-execute')
    const run6 = async (cmd) => {
      let nexted = false
      const p = pre6(makeExec(wsE, 'pwsh', { command: cmd }), async () => { nexted = true; return { kind: 'allow' } })
      p.catch(() => {})
      const out = await Promise.race([p, new Promise((r) => setTimeout(() => r({ kind: 'timeout' }), 300))])
      return { nexted, verdict: out && out.kind }
    }
    const e3First = await run6('rm -rf /tmp/x')
    ok('★★ group21: 例外排序后的顺序在真实判定链上生效（具体 allow 提到宽泛 deny 之前即放行）',
      e3First.nexted === true, JSON.stringify(e3First))
    // 对照：同一个 host 下 e1 仍压着别的 rm（证明上面不是「例外整体失效」）
    const e1Still = await run6('rm -rf /opt')
    ok('group21(对照): 未被移动的宽泛 deny 例外仍生效（证明上一条不是例外整体失效）',
      e1Still.nexted === false && e1Still.verdict === 'deny', JSON.stringify(e1Still))
    // 例外排序必须校验分类：EXC_CATS 之外的分类一律拒绝（否则会往 doomloop 这类无例外列表上写）
    const badCat = await callRoute(h6.routes, 'POST', '/permgate/reorder', { target: 'global', kind: 'exception', category: 'doomloop', id: 'e1', anchor: 'e2', position: 'before', lang: 'zh' })
    ok('★ group21: 例外 reorder 拒绝不支持例外的分类（doomloop）', !!(badCat.data && badCat.data.error), JSON.stringify(badCat.data))
    try { rmSync(wsE, { recursive: true, force: true }); rmSync(homeE, { recursive: true, force: true }) } catch (e) {}
  }

  try {
    rmSync(ws, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true })
  } catch (e) {}
}

// ─────────────────────────────────────────────────────────────
group('23. 爆炸半径与破坏性候选：盘根删除的警告与候选范围')
{
  // 本组钉住两件事：
  //   ① 弹窗给出的一键候选对破坏性命令**不给通配**。原行为一律给 `rmdir *`，
  //      实测它同时匹配「整个盘」与「一个构建目录」—— 点一次「允许并记住」
  //      = 从此所有 rmdir 永久静默放行；而且这条 allow 例外会**压过 destructive=deny**
  //      （例外 > 子设置），即一次点击永久关掉用户设的闸。
  //   ② 判定链不区分「整个盘」与「一个目录」，两者动作与候选完全相同 ——
  //      故额外下发 blast 分档，让审批人有信息可依。
  // 盘符用 B:（本机不存在该盘），示例不会被误当成真实目标。
  const wsB = mkdtempSync(join(tmpdir(), 'pg-blast-ws-'))
  const homeB = mkdtempSync(join(tmpdir(), 'pg-blast-home-'))
  mkdirSync(join(homeB, 'dsh-permgate'), { recursive: true })
  const bootB = (cfg) => {
    writeFileSync(join(homeB, 'dsh-permgate', 'config.json'), JSON.stringify(cfg, null, 2), 'utf8')
    return createHost({ workspaceRoot: wsB, dshHome: homeB })
  }
  // 审批**挂住**：这样条目留在 pending 池里，能查到它的候选与 blast。
  // 让 approval 直接返回 'denied' 的话条目立刻被 cleanup 摘掉，查到的永远是空。
  // （这里曾有第二个 host 工厂 bootHeld，与 bootB 只差 connection 覆盖；下面的测试体
  //  改成内联 createHost 后它再没被调用，已删 —— 留着的死 helper 会让读的人以为有两条路径。）
  const AUTH = { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', cookie: 'dsh-auth-x=1' }
  const pendOf = async (h) => {
    const r = await callRoute(h.routes, 'GET', '/permgate/pending', undefined, AUTH)
    return Array.isArray(r.data) ? r.data : []
  }

  // ── 洞 2：blast 随 pending 下发，且分档正确 ──────────────────────────────
  {
    // 用 createHost 的 approval 桩：它返回 'denied' 会让条目立刻结案 —— 故改用
    // 一个**永不 resolve** 的 approval，借 ctx 覆盖。createHost 不接受 approval 覆盖，
    // 于是这里直接构造：先建 host 再把 ctx.approval.request 换掉（apply 已读入闭包，
    // 但 askUser 是每次调用时现取 ctx.approval.request，故替换生效）。
    const h = createHost({ workspaceRoot: wsB, dshHome: homeB, connection: { requestRejection: ({ headers }) => ((headers || {}).cookie ? undefined : 401) } })
    h.ctx.approval.request = () => new Promise(() => {})
    writeFileSync(join(homeB, 'dsh-permgate', 'config.json'), JSON.stringify({ global: { fallbackMode: 'ask' }, projects: {} }, null, 2), 'utf8')
    const pre = h.hooks.get('tools/pre-execute')
    const fire = (cmd) => { const p = pre(makeExec(wsB, 'pwsh', { command: cmd }), async () => ({ kind: 'allow' })); p.catch(() => {}); return p }
    fire('rmdir /s /q B:\\')
    await new Promise((r) => setTimeout(r, 200))
    const items = await pendOf(h)
    const it = items[0] || null
    ok('★★ group23: 盘根删除的审批带 blast=drive-root（审批人能看到「这是整个盘」）',
      !!it && !!it.blast && it.blast.level === 'drive-root', JSON.stringify(it && it.blast))
    ok('★ group23: blast 带上算出来的目标路径（用于界面显示与 title）',
      !!it && !!it.blast && typeof it.blast.path === 'string' && it.blast.path.length > 0, JSON.stringify(it && it.blast))
    // ★★ 洞 1：候选不得是通配
    const cands = (it && it.candidates) || []
    ok('★★ group23: 破坏性命令的候选不含通配（洞 1：一次点击不得放行所有同类操作）',
      cands.length > 0 && cands.every((c) => !/[*?]/.test(String(c.value))),
      JSON.stringify(cands.map((c) => c.value)))
    ok('★ group23: 破坏性候选的值就是这条命令本身（精确到此命令）',
      cands.some((c) => String(c.value).indexOf('rmdir') === 0), JSON.stringify(cands.map((c) => c.value)))
    ok('★ group23: 破坏性候选带 hint 说明「只放行这一条」（用户点之前就知道范围）',
      cands.some((c) => !!c.hint), JSON.stringify(cands.map((c) => c.hint)))
    // 对照：非破坏性命令仍给通配候选（不能把整个候选机制收紧掉）
    fire('git status')
    await new Promise((r) => setTimeout(r, 200))
    const items2 = await pendOf(h)
    const gitIt = items2.find((x) => String(x.tool) === 'pwsh' && JSON.stringify(x.args || '').indexOf('git status') !== -1)
    const gitCands = (gitIt && gitIt.candidates) || []
    ok('★ group23(对照): 非破坏性命令仍给通配候选（git status → git status *）',
      gitCands.some((c) => c.value === 'git status *'), JSON.stringify(gitCands.map((c) => c.value)))
    ok('★ group23(对照): 非破坏性命令不带 blast 警告（不制造噪音）',
      !!gitIt && !gitIt.blast, JSON.stringify(gitIt && gitIt.blast))

    // ★★ group23 追加：**find 族的候选不得是通配**。
    //
    // 这是「洞 1」在另一个命令族上的形态，也是本次修复的核心：候选侧的破坏性判据若用
    // segmentLabel 的主 label（`find`），而判定侧用 segmentLabels（会为 `-delete`/`-exec`
    // 合成 `rm`），两者结论相反 —— `find . -delete` 在判定侧是 destructive，
    // 候选侧却按非破坏性给出 `find *`。实测写入该例外后 `find . -delete` 在
    // destructive=deny 下由 **deny 变 allow**，与洞 1 完全同构。
    // 用 `find . -delete`（判定侧 code=destructive）做用例，断言候选必须精确到命令本身。
    fire('find . -delete')
    await new Promise((r) => setTimeout(r, 200))
    const items3 = await pendOf(h)
    const findIt = items3.find((x) => JSON.stringify(x.args || '').indexOf('find . -delete') !== -1)
    const findCands = (findIt && findIt.candidates) || []
    ok('★★ group23: find 族的破坏性命令也不给通配候选（find . -delete → 精确候选，不得是 find *）',
      findCands.length > 0 && findCands.every((c) => !/[*?]/.test(String(c.value))),
      JSON.stringify(findCands.map((c) => c.value)))

    // ★★ group23 追加 2：**命令自带 glob 元字符的破坏性命令不给候选**。
    //
    // 候选值是**匹配模式**（matchCommand 把 `*`/`?` 当通配符），故「整段原文」只在原文
    // 不含元字符时才等于「精确到此命令」。实测候选 `rm -rf *` 同时命中 `rm -rf /`、
    // `rm -rf /etc`、`rm -rf C:/Windows` —— 用户点一次「允许并记住」就写下一条能放行
    // 删盘根的 allow 例外（并压过 destructive=deny），与洞 1 完全同构。
    // 这类形态**不给候选**（想少弹窗就自己在设置页写例外，那是显式表态）。
    for (const risky of ['rm -rf *', 'rm -rf ?', 'del /f /s /q *']) {
      fire(risky)
      await new Promise((r) => setTimeout(r, 200))
      const itemsR = await pendOf(h)
      const itR = itemsR.find((x) => JSON.stringify(x.args || '').indexOf(risky) !== -1)
      const cR = (itR && itR.candidates) || []
      ok('★★ group23: 自带通配的破坏性命令不给候选（' + risky + '，避免写入比点击目标更宽的例外）',
        !!itR && cR.every((c) => !/[*?]/.test(String(c.value))),
        JSON.stringify(cR.map((c) => c.value)))
    }
    // 对照：自带通配但**非破坏性**的命令不受影响（`git log --grep=x` 之类仍可记住）
    fire('ls -la')
    await new Promise((r) => setTimeout(r, 200))
    const itemsL = await pendOf(h)
    const lsIt = itemsL.find((x) => JSON.stringify(x.args || '').indexOf('ls -la') !== -1)
    ok('★ group23(对照): 非破坏性命令仍给通配候选（ls -la → ls *）',
      !!lsIt && ((lsIt.candidates || []).some((c) => c.value === 'ls *')),
      JSON.stringify((lsIt && lsIt.candidates || []).map((c) => c.value)))

    // ★★ group23 追加 3：**能携带破坏性载荷的非破坏性段**（`find . -name x`）不得给出
    // `find *` 这种通配候选 —— 它实测匹配 `find / -delete`，用户为「找一下文件」点一次
    // 就放行了删盘根（在 destructive=deny 下由 deny 变 allow）。
    // 修复后写入的是**整段原文** `find . -name x`（matchCommand 对无通配模式做词边界前缀
    // 匹配，已覆盖 `find . -name x -print`，无需再加 ` *`）。
    fire('find . -name x')
    await new Promise((r) => setTimeout(r, 200))
    const itemsF = await pendOf(h)
    const fIt = itemsF.find((x) => JSON.stringify(x.args || '').indexOf('find . -name x') !== -1)
    const fCands = (fIt && fIt.candidates) || []
    ok('★★ group23: find 族的非破坏性段不给裸通配候选（不得是 find *，应为整段原文）',
      !!fIt && fCands.length > 0 && fCands.every((c) => c.value !== 'find *')
      && fCands.some((c) => c.value === 'find . -name x'),
      JSON.stringify(fCands.map((c) => c.value)))
    // ★★ 按钮显示的值必须与写入的值同源：载荷族段若显示裸 label「find」而写入整条命令，
    //    用户点的是「find」、实际授权的是那条完整命令 —— 文案与行为不符。
    //    破坏性段早已如此（显示整段原文），载荷族段必须一致。
    ok('★★ group23: 载荷族候选的显示值就是写入值（不得显示裸 label 而写入整条命令）',
      !!fIt && fCands.some((c) => c.value === 'find . -name x' && String(c.label) === 'find . -name x'),
      JSON.stringify(fCands.map((c) => ({ label: c.label, value: c.value }))))
    // ★★ 载荷族**自带通配**时不给候选：`find . -name *` 写下的模式会比所点命令更宽
    //    （`*` 在模式里是通配符，会匹配到别的 find 调用），与破坏性段同一处置。
    fire('find . -name *')
    await new Promise((r) => setTimeout(r, 200))
    const itemsFG = await pendOf(h)
    const fgIt = itemsFG.find((x) => JSON.stringify(x.args || '').indexOf('find . -name *') !== -1)
    ok('★★ group23: 载荷族自带通配时不给任何候选（写下的模式会比点击目标更宽）',
      !!fgIt && ((fgIt.candidates || []).length === 0),
      JSON.stringify((fgIt && fgIt.candidates || []).map((c) => c.value)))

    // ★★ group23 追加 4：**已被放行的段不得给出候选按钮**。
    //
    // 这条是运行时断言，静态断言挡不住它：候选侧曾经自己再 decomposeCommand 一遍，
    // 那份段**没有 action** —— 源码里「调了 segmentLabel、方言也对」看起来完全正常，
    // 只有真跑一遍才能看出它把已放行的段又授权了一次。
    // 变异测试实测：把 words 透传删掉、或把 `seg.action === 'allow'` 那行删掉，
    // regressions 的静态断言会**存活**，只有本组会红。
    //
    // 场景取自真实弹窗（用户截图）：三段命令，其中两段已被项目例外放行。
    {
      const hC = createHost({ workspaceRoot: wsB, dshHome: homeB, connection: { requestRejection: ({ headers }) => ((headers || {}).cookie ? undefined : 401) } })
      hC.ctx.approval.request = () => new Promise(() => {})
      // 项目层配两条 allow：段 2 的 Get-ChildItem 与段 3 的 Select-Object
      writeFileSync(join(homeB, 'dsh-permgate', 'config.json'), JSON.stringify({
        global: { fallbackMode: 'ask', command: { mode: 'ask', exceptions: [] } },
        projects: {
          [String(wsB).replace(/\\/g, '/')]: {
            command: { mode: 'inherit', exceptions: [
              { id: 'e1', action: 'allow', match: 'Get-ChildItem *' },
              { id: 'e2', action: 'allow', match: 'Select-Object *' },
            ] },
          },
        },
      }, null, 2), 'utf8')
      const preC = hC.hooks.get('tools/pre-execute')
      const CMD = 'Get-Location ; Get-ChildItem -Force | Select-Object Mode, Length, Name'
      const pc = preC(makeExec(wsB, 'pwsh', { command: CMD }), async () => ({ kind: 'allow' }))
      pc.catch(() => {})
      await new Promise((r) => setTimeout(r, 200))
      const itemsC = await pendOf(hC)
      const itC = itemsC.find((x) => JSON.stringify(x.args || '').indexOf('Get-Location') !== -1)
      const cC = (itC && itC.candidates) || []
      const vals = cC.map((c) => String(c.value))
      ok('★★ group23: 已被 allow 的段不给候选（否则把已放行的东西再授权一遍、多写重复例外）',
        !!itC && !vals.some((v) => /get-childitem|select-object/i.test(v)),
        JSON.stringify(vals))
      // 对照：仍需审批的那一段（Get-Location，无既有例外）必须照常给按钮 ——
      // 否则「跳过已放行段」会退化成「一律不给候选」，用户想放行也没有按钮可点。
      ok('★ group23(对照): 仍需审批的段照常给候选（Get-Location → get-location *）',
        vals.some((v) => /get-location/i.test(v)), JSON.stringify(vals))
    }
    try { rmSync(homeB, { recursive: true, force: true }) } catch (e) {}
  }

  // ── 洞 2 后半：例外列表的标注（statusView.exceptionBlast）────────────────
  {
    mkdirSync(join(homeB, 'dsh-permgate'), { recursive: true })
    const h = bootB({
      global: {
        fallbackMode: 'ask',
        command: {
          mode: 'ask',
          exceptions: [
            { id: 'e1', action: 'allow', match: 'rmdir /s /q B:\\' },
            { id: 'e2', action: 'allow', match: 'git status *' },
            // e3 是**有爆炸半径的 deny 例外**：它若不慎被标注，断言立刻变红，
            // 从而证明「只标 allow」这道过滤真的在跑（而不是碰巧没有可标注的条目）。
            { id: 'e3', action: 'deny', match: 'rm -rf C:\\Windows' },
            { id: 'e4', action: 'allow', match: 'rmdir /s /q B:\\demo-app\\build' },
            // ★★ e6 是**宽泛通配的 allow 例外**（`rm -rf *`）：它的目标归约后是 `.`
            //    （旧实现判 inside → 返回 null → 面板零标注），但它实测能放行
            //    `rm -rf /`、`rm -rf /etc`、`rm -rf C:/Windows`。面板的例外列表是
            //    「唯一能让人事后发现『我什么时候放行了删盘根』的地方」，此处必须标出。
            { id: 'e6', action: 'allow', match: 'rm -rf *' },
          ],
        },
        read: { mode: 'allow', exceptions: [{ id: 'e5', action: 'allow', path: 'C:\\Windows\\System32\\*' }] },
      },
      projects: {},
    })
    const st = await callRoute(h.routes, 'GET', '/permgate/status')
    // 标注按**层**下发（{ global, project }）：全局块与项目块的例外 id 空间不共享，
    // 平表会让后写入的一层覆盖另一层（无害例外被标成「整个盘」／危险那条丢警告）。
    // 本组的例外全在 global 层。
    const ebAll = (st.data && st.data.exceptionBlast) || {}
    const eb = ebAll.global || {}
    ok('★★ group23: 例外列表标注 —— 指向盘根的 allow 例外被标为 drive-root',
      !!eb.e1 && eb.e1.level === 'drive-root', JSON.stringify(eb.e1))
    ok('★ group23: 例外列表标注 —— 工作区外的 allow 例外被标为 outside',
      !!eb.e4 && eb.e4.level === 'outside', JSON.stringify(eb.e4))
    ok('★ group23: 例外列表标注 —— 指向系统目录的路径例外被标为 system',
      !!eb.e5 && eb.e5.level === 'system', JSON.stringify(eb.e5))
    // ★★ 两条**不该出现**的：非破坏性命令（`git status *` 不删任何东西）与 deny 例外
    //    （deny 指向盘根是保护、不是风险）。多标它们就是噪音，噪音会让真警告被忽略。
    //    判据必须同时查「不该有的没有」与「该有的有」：只查前者时，把整个 exceptionBlast
    //    改成恒空对象也能通过（实测该变异会漏网）。
    ok('★★ group23: 非破坏性例外与 deny 例外都**不**标注（只标「allow 且破坏性」）',
      !eb.e2 && !eb.e3 && !!eb.e1 && !!eb.e4 && !!eb.e5,
      JSON.stringify({ e1: eb.e1, e2: eb.e2, e3: eb.e3, e4: eb.e4, e5: eb.e5 }))
    // ★★ 宽泛通配的 allow 例外必须被标为 broad：它是「面板上看起来无害、实际能放行删盘根」
    //    的那一类，正是面板标注最该覆盖的形态（旧实现返回 null → 零标注）。
    ok('★★ group23: 宽泛通配例外被标为 broad（rm -rf * 能放行 rm -rf /，不得静默）',
      !!eb.e6 && eb.e6.level === 'broad', JSON.stringify(eb.e6))
    // ★★ 派生值不得落盘：exceptionBlast 是读侧现算的视图，写进配置会让旧结论永久固化
    //    （与 doomloopSetting / normalizeCategory 同一条纪律）。
    //    同时查「响应里有该键」与「磁盘上没有该键」：只查磁盘会把「整块不下发」判成通过。
    const cfgRaw = readFileSync(join(homeB, 'dsh-permgate', 'config.json'), 'utf8')
    ok('★★ group23: exceptionBlast 只读下发、不落盘（响应里有它、配置文件里没有它）',
      st.data && st.data.exceptionBlast && Object.keys(eb).length > 0
      && cfgRaw.indexOf('exceptionBlast') === -1,
      JSON.stringify({ keys: Object.keys(eb), inFile: cfgRaw.indexOf('exceptionBlast') !== -1 }))
    // ★★ 跨层 id 相同不得串台：全局与项目块的 id 空间不共享，平表会让后写入的一层
    //    覆盖另一层 —— 无害的例外被标成「目标是一整个盘」，或危险那条丢掉警告。
    //    面板按 tab 分别渲染，故两层必须各拿各的结论。
    //    注：add-exception 路由自行为新例外生成 id（不接受调用方指定），故这里不构造
    //    「同 id」而是直接验分层本身：项目层新增条目后，全局层的键必须**原样还在**，
    //    且两层是不同的对象（退化成平表时全局键会与项目键混在同一个集合里）。
    {
      const st2 = await callRoute(h.routes, 'POST', '/permgate/add-exception', {
        category: 'command', action: 'allow', match: 'rmdir /s /q B:\\', target: 'project',
      })
      ok('★ group23(前置): 项目层写入一条盘根例外', !!(st2 && st2.data && st2.data.added),
        JSON.stringify(st2 && st2.data && st2.data.error))
      const newId = st2 && st2.data && st2.data.added ? st2.data.added.id : null
      const st3 = await callRoute(h.routes, 'GET', '/permgate/status')
      const eb2 = (st3.data && st3.data.exceptionBlast) || {}
      const g2 = eb2.global || {}
      const p2 = eb2.project || {}
      ok('★★ group23: 例外标注按层隔离（项目层新增不覆盖全局层，两层各拿各的结论）',
        !!newId && !!g2.e1 && g2.e1.level === 'drive-root'
        && !!p2[newId] && p2[newId].level === 'drive-root'
        // 平表退化检测：全局层里不得出现项目层的键
        && !Object.prototype.hasOwnProperty.call(g2, newId)
        && eb2.global !== eb2.project,
        JSON.stringify({ global: Object.keys(g2), project: Object.keys(p2), newId: newId }))
    }
    try { rmSync(wsB, { recursive: true, force: true }); rmSync(homeB, { recursive: true, force: true }) } catch (e) {}
  }
}

// ─────────────────────────────────────────────────────────────
group('22. 循环检测（doomloop）：会话分桶 / 只记静默放行 / 取更严者 / 阈值可配')
{
  // 本组全部走**真实 tools/pre-execute 链路**（不调 decide()，那是内部函数）。
  // 计数口径是「只有真正静默放行并执行了才计数」，故探测函数必须能区分三种落点：
  //   'allow' —— next() 被调用且**没有弹窗**（= 唯一会推进计数的情形）
  //   'deny'  —— decide() 直接拒绝（不弹窗、不计数）
  //   'ask'   —— 出现了审批弹窗（结案后不计数，且清零）
  // 注意 'allow' 与「弹窗后点允许」必须分开：后者也走 next()，但它不该计数（L-2）。
  // 故弹窗分支在返回前就定成 'ask'，不去看 nexted。
  const probe = async (h, ws, sess, name, args, answer) => {
    const pre = h.hooks.get('tools/pre-execute')
    const exec = {
      name: name, arguments: args || {}, callId: 'call-1', token: 'tok-1',
      agent: sess ? { cwd: ws, session: { id: sess } } : { cwd: ws },
      signal: undefined,
    }
    let nexted = false
    let settled = false
    let result = null
    const p = pre(exec, async () => { nexted = true; return { kind: 'allow' } })
    // 不用固定睡眠判定「是否弹窗」。askUser 的 Promise executor 是**同步**执行的
    //（pendingApprovals.set(id, entry) 在 executor 内完成），故 hook 一旦挂在弹窗上，
    // /permgate/pending 立刻就有条目；而 allow/deny 路径只需等 init() 的文件 I/O 完成即可 settle。
    // 原先的 `Promise.race([p, setTimeout(250)])` 会让**每个 ask 落点都实打实空等满 250 ms**
    //（该组约 20 次 ask 探测合计近 5 s），且该开销只与 ask 探测次数成正比 —— 后续再补用例会线性放大。
    //
    // 现在分两段：先只让出事件循环等 settle（**不查 pending**，allow/deny 这条多数路径因此
    // 零额外开销），超过 SUSPECT_MS 仍未 settle 才认定「可能挂在弹窗上」，开始查 pending 确认。
    // 阈值大小只影响性能、不影响正确性：若 allow 路径因系统负载超过该阈值，多查一次 pending
    // 得到空列表后会继续等 settle，落点判据不变。
    p.then((r) => { settled = true; result = r }, () => { settled = true })
    let items = []
    const t0 = Date.now()
    const deadline = t0 + 15000
    const SUSPECT_MS = 30
    while (Date.now() < deadline) {
      if (nexted || settled) break
      if (Date.now() - t0 >= SUSPECT_MS) {
        const list = await callRoute(h.routes, 'GET', '/permgate/pending')
        items = (Array.isArray(list.data) ? list.data : []).filter((x) => x.tool === name)
        if (items.length) break
      }
      await new Promise((r) => setTimeout(r, 1))
    }
    if (nexted) return 'allow'
    if (!items.length) {
      // 没有弹窗：按 hook 的实际落点归类。settle 后仍无落点属探测异常，
      // 显式抛出而不是静默归成某类 —— 后者会让用例假通过。
      if (result && result.kind === 'deny') return 'deny'
      if (result && result.kind === 'allow') return 'allow'
      if (!settled) throw new Error('probe 超时：hook 既未返回也未进入审批弹窗（' + name + '）')
      return 'deny'
    }
    // 走到这里 = 弹窗还挂着：结案（默认拒绝，传 'allow' 则模拟用户点允许）后收尾
    for (const it of items) {
      await callRoute(h.routes, 'POST', '/permgate/decide', { id: it.id, action: answer === 'allow' ? 'allow' : 'deny', lang: 'zh' })
    }
    await Promise.race([p, new Promise((r) => setTimeout(r, 1000))])
    return 'ask'
  }
  // 配置工厂：只写全局层（项目层另有专门用例）。fallbackMode=allow 让 my_tool 这类
  // 未分类工具的判定完全由兜底决定 —— 计数的前进/中断都能被单独观察，不受分类默认值干扰。
  const mkHost = (globalExtra, projects) => {
    const ws = mkdtempSync(join(tmpdir(), 'pg-loop-ws-'))
    const home = mkdtempSync(join(tmpdir(), 'pg-loop-home-'))
    mkdirSync(join(home, 'dsh-permgate'), { recursive: true })
    writeFileSync(join(home, 'dsh-permgate', 'config.json'), JSON.stringify({
      global: Object.assign({ fallbackMode: 'allow' }, globalExtra || {}),
      projects: projects || {},
    }, null, 2), 'utf8')
    return { ws, home, h: createHost({ workspaceRoot: ws, dshHome: home }) }
  }
  const readCfg = (home) => JSON.parse(readFileSync(join(home, 'dsh-permgate', 'config.json'), 'utf8'))
  // 未分类工具：quickAction 不命中 → 落兜底 allow。用它观察计数，避免被 command 分类的
  // 默认值（ask）干扰 —— 那会让「静默放行」这个前提不成立。
  const T = 'my_tool'
  const A = { a: 1 }
  const run = async (h, ws, sess, n, args) => {
    const seq = []
    for (let i = 0; i < n; i++) seq.push(await probe(h, ws, sess, T, args || A))
    return seq
  }

  // ── S1：T5（默认阈值 6 → 第 7 次触发）+ 默认值不物化落盘 ──────────────────
  {
    const { ws, home, h } = mkHost({ doomloop: { mode: 'ask' } })
    const st = await callRoute(h.routes, 'GET', '/permgate/status')
    const dl = st.data && st.data.doomloop
    ok('★ group22 S1: 默认阈值 6 由读取侧推导（effective.source = default，本层无显式配置）',
      !!(dl && dl.effective && dl.effective.threshold === 6 && dl.effective.source === 'default' && dl.global === null && dl.project === null),
      JSON.stringify(dl))
    const seq = await run(h, ws, 's1', 7)
    ok('★★ group22 T5: 默认阈值 6 → 前 6 次静默放行、第 7 次触发 ASK',
      seq.slice(0, 6).every((v) => v === 'allow') && seq[6] === 'ask', JSON.stringify(seq))
    // 推导值**不得**落盘：落盘就成了「用户表态」，日后改默认阈值对存量配置零效果
    // （QUICK_RETIRED_DEFAULTS 当年正因此才需要一次性收敛迁移）。
    const disk = readCfg(home)
    ok('★★ group22 S1: 默认阈值不物化落盘（推导值不得变成用户表态）',
      !disk.global.doomloop || disk.global.doomloop.threshold === undefined,
      JSON.stringify(disk.global.doomloop))
    try { rmSync(ws, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }) } catch (e) {}
  }

  // ── S2：T9（threshold=1 原样接受 → 第 2 次触发，**不钳到 2**）──────────────
  {
    const { ws, home, h } = mkHost({ doomloop: { mode: 'ask', threshold: 1 } })
    const st = await callRoute(h.routes, 'GET', '/permgate/status')
    const dl = st.data && st.data.doomloop
    ok('★ group22 T9: threshold=1 原样接受（不钳到 2）',
      !!(dl && dl.effective && dl.effective.threshold === 1 && dl.effective.source === 'global' && dl.global === 1),
      JSON.stringify(dl))
    const seq = await run(h, ws, 's2', 2)
    ok('★★ group22 T9: 阈值 1 = 第 2 次触发（先查后记的直接推论，不是「每次都问」）',
      seq[0] === 'allow' && seq[1] === 'ask', JSON.stringify(seq))
    try { rmSync(ws, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }) } catch (e) {}
  }

  // ── S3：T10b（threshold=13 > 旧数组窗口 12 → 第 14 次触发）───────────────
  // 这条是「删掉窗口」的**运行时证据**：旧实现用长度 12 的数组回扫，streak 被窗口截断在 12，
  // 于是阈值 13 永远触发不了（静默失效）—— 那正是 REPEAT_STREAK_MAX 存在的原因。
  // 现在 (键,次数) 计数能数到任意大，阈值多大都能触发，故上限也不需要。
  // 注意触发点是**第 N+1 次**（先查后记：decide 在计数之前），故阈值 13 → 第 14 次。
  {
    const { ws, home, h } = mkHost({ doomloop: { mode: 'ask', threshold: 13 } })
    const seq = await run(h, ws, 's3', 14)
    ok('★★ group22 T10: 阈值 13（> 旧窗口 12）仍能触发 —— 窗口已删，不存在「阈值超窗口即静默失效」',
      seq.slice(0, 13).every((v) => v === 'allow') && seq[13] === 'ask', JSON.stringify(seq.slice(10)))
    try { rmSync(ws, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }) } catch (e) {}
  }

  // ── S4：T1（会话分桶：A 的连续计数不得牵连 B 的第 1 次）──────────────────
  // 修复前 recent 是**全局数组**：A 连续 4 次后 B 第 1 次同一调用即 ASK。
  {
    const { ws, home, h } = mkHost({ doomloop: { mode: 'ask', threshold: 3 } })
    const a3 = await run(h, ws, 'sessA', 3)
    const b1 = await probe(h, ws, 'sessB', T, A)
    ok('★★ group22 T1: A 会话连续 3 次后，B 会话第 1 次同一调用不受影响（不共享计数）',
      a3.every((v) => v === 'allow') && b1 === 'allow', JSON.stringify({ a3: a3, b1: b1 }))
    // 对照：A 自己的第 4 次确实触发了 —— 证明上一条不是因为「计数根本没工作」
    const a4 = await probe(h, ws, 'sessA', T, A)
    ok('★★ group22 T1: 同一配置下 A 的第 4 次确实触发（对照，证明计数在工作）',
      a4 === 'ask', JSON.stringify({ a4: a4 }))
    try { rmSync(ws, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }) } catch (e) {}
  }

  // ── S5：T7（A/B 交错：各自独立计数，都不提前触发）──────────────────────
  // 交错序列里每个会话的**调用键完全相同**（同工具同参数），故共享桶的实现会在 A 的第 3 次
  // 就看到 streak=5 ≥ 3 而提前触发 —— 本组因此能区分「分桶」与「共享」。
  {
    const { ws, home, h } = mkHost({ doomloop: { mode: 'ask', threshold: 3 } })
    const seq = []
    for (let i = 0; i < 3; i++) {
      seq.push(await probe(h, ws, 'sessA', T, A))
      seq.push(await probe(h, ws, 'sessB', T, A))
    }
    ok('★★ group22 T7: A/B 交错各 3 次同一调用 → 6 次全静默放行（两个会话各自独立计数）',
      seq.every((v) => v === 'allow'), JSON.stringify(seq))
    const a4 = await probe(h, ws, 'sessA', T, A)
    const b4 = await probe(h, ws, 'sessB', T, A)
    ok('★★ group22 T7: 交错之后 A/B 各自的第 4 次都触发（两条独立的连续链都数满了）',
      a4 === 'ask' && b4 === 'ask', JSON.stringify({ a4: a4, b4: b4 }))
    try { rmSync(ws, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }) } catch (e) {}
  }

  // ── S6：T8（断链：中途一次别的调用即重新计数）──────────────────────────
  // 阈值 3 → 触发点是**第 4 次**连续（先查后记）。故断链后 A 需要重新数满 3 次才触发。
  {
    const { ws, home, h } = mkHost({ doomloop: { mode: 'ask', threshold: 3 } })
    const s1 = await probe(h, ws, 's6', T, A)
    const s2 = await probe(h, ws, 's6', T, A)
    const s3 = await probe(h, ws, 's6', T, { a: 2 })
    const s4 = await probe(h, ws, 's6', T, A)
    const s5 = await probe(h, ws, 's6', T, A)
    const s6 = await probe(h, ws, 's6', T, A)
    const s7 = await probe(h, ws, 's6', T, A)
    ok('★★ group22 T8: 中途插入一次不同调用即断链（断链后的 3 次仍全放行）',
      [s1, s2, s3, s4, s5, s6].every((v) => v === 'allow'), JSON.stringify([s1, s2, s3, s4, s5, s6]))
    ok('★★ group22 T8: 断链后重新数满 3 次才触发（第 4 次）—— 证明计数确实从断链处重来',
      s7 === 'ask', JSON.stringify({ s7: s7 }))
    try { rmSync(ws, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }) } catch (e) {}
  }

  // ── S7：T6（精确键的已知边界：参数微调即换键 → 全部放行）────────────────
  // 这是**有意行为**（L-1），不是缺陷：段级签名会把「git add file1/2/3.txt」这类
  // 完全正常的工作折叠成「循环」而误报，误报率零的精确键是权衡后的选择。
  {
    const { ws, home, h } = mkHost({ doomloop: { mode: 'ask', threshold: 2 } })
    const seq = []
    for (let i = 0; i < 8; i++) seq.push(await probe(h, ws, 's7', T, { dir: 'dir' + i }))
    ok('★ group22 T6: 参数微调 8 次全部放行（精确键的已知边界，记录为有意行为）',
      seq.every((v) => v === 'allow'), JSON.stringify(seq))
    try { rmSync(ws, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }) } catch (e) {}
  }

  // ── S8：T11 + T15（doomloop=deny：被拒调用不推进计数，触发后清零）─────────
  // 期望序列：allow allow allow deny | allow allow allow deny
  // 若「被拒调用推进计数」或「触发后不清零」，第 4 次之后会**连续** deny（不再放行）。
  {
    const { ws, home, h } = mkHost({ doomloop: { mode: 'deny', threshold: 3 } })
    const seq = await run(h, ws, 's8', 8)
    ok('★★ group22 T11+T15: doomloop=deny 时 3 次放行→拒绝，之后**重新数**（被拒不计数且清零）',
      JSON.stringify(seq) === JSON.stringify(['allow', 'allow', 'allow', 'deny', 'allow', 'allow', 'allow', 'deny']),
      JSON.stringify(seq))
    try { rmSync(ws, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }) } catch (e) {}
  }

  // ── S9：T12（用户点「允许」的 ask 调用不计入）───────────────────────────
  // 期望序列：allow allow ask | allow allow ask
  // 若弹窗批准也计数，第 4 次就会立刻 ask（而不是放行两次之后）。
  {
    const { ws, home, h } = mkHost({ doomloop: { mode: 'ask', threshold: 2 } })
    const seq = []
    seq.push(await probe(h, ws, 's9', T, A))
    seq.push(await probe(h, ws, 's9', T, A))
    seq.push(await probe(h, ws, 's9', T, A, 'allow'))
    seq.push(await probe(h, ws, 's9', T, A))
    seq.push(await probe(h, ws, 's9', T, A))
    seq.push(await probe(h, ws, 's9', T, A, 'allow'))
    ok('★★ group22 T12: 弹窗批准的调用不计入（弹过窗 = 用户已经知道，提醒是冗余的）',
      JSON.stringify(seq) === JSON.stringify(['allow', 'allow', 'ask', 'allow', 'allow', 'ask']),
      JSON.stringify(seq))
    try { rmSync(ws, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }) } catch (e) {}
  }

  // ── S10：T13（用户点「拒绝」的 ask 调用不计入且清零）────────────────────
  {
    const { ws, home, h } = mkHost({ doomloop: { mode: 'ask', threshold: 2 } })
    const seq = []
    seq.push(await probe(h, ws, 's10', T, A))
    seq.push(await probe(h, ws, 's10', T, A))
    seq.push(await probe(h, ws, 's10', T, A, 'deny'))
    seq.push(await probe(h, ws, 's10', T, A))
    seq.push(await probe(h, ws, 's10', T, A))
    seq.push(await probe(h, ws, 's10', T, A, 'deny'))
    ok('★★ group22 T13: 弹窗拒绝的调用不计入且清零（与「允许」同口径）',
      JSON.stringify(seq) === JSON.stringify(['allow', 'allow', 'ask', 'allow', 'allow', 'ask']),
      JSON.stringify(seq))
    try { rmSync(ws, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }) } catch (e) {}
  }

  // ── S11：T16（非静默放行清零：4 次放行 → 一次 ask 被拒 → 再 4 次放行不得触发）──
  // 若不清零，第二次的 4 次放行会从计数 4 继续数到 6/7 而误触发。
  {
    const { ws, home, h } = mkHost({ doomloop: { mode: 'ask', threshold: 6 } })
    const first = await run(h, ws, 's11', 4)
    // 用一条 ask 规则制造一次弹窗（用户拒绝），再把规则删掉
    const addAsk = await callRoute(h.routes, 'POST', '/permgate/add-rule', { target: 'global', action: 'ask', tool: T, lang: 'zh' })
    ok('group22 S11: 临时 ask 规则写入成功', !!(addAsk.data && addAsk.data.added), JSON.stringify(addAsk.data && addAsk.data.error))
    const asked = await probe(h, ws, 's11', T, A, 'deny')
    const ruleId = addAsk.data && addAsk.data.added && addAsk.data.added.id
    await callRoute(h.routes, 'POST', '/permgate/remove-rule', { target: 'global', id: ruleId, lang: 'zh' })
    const second = await run(h, ws, 's11', 4)
    ok('★★ group22 T16: 一次弹窗（被拒）把连续计数清零 —— 之后再 4 次放行不得触发',
      first.every((v) => v === 'allow') && asked === 'ask' && second.every((v) => v === 'allow'),
      JSON.stringify({ first: first, asked: asked, second: second }))
    try { rmSync(ws, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }) } catch (e) {}
  }

  // ── S12：T14 + T3（做法 A 的核心：doomloop 命中时下游是 deny → 取更严者）──
  // 这是本次改动**唯一**的行为变更面，也是 G2-4 的修复点：
  // 前两次合法放行把 streak 数满，第 3 次时下游出现 deny（刚加的规则）——
  // 修复前 doomloop 命中即 return，会把这条 deny 覆盖成 ask（一次误点即放行）。
  //
  // ★ 必须带**对照会话**：只断言「第 3 次是 deny」是无效的 —— 下游本来就是 deny，
  //   即使 doomloop 完全没触发也会得到 deny（断言会假通过）。故用同一宿主、同一配置下的
  //   另一个会话先证明「streak=2 时第 3 次确实会触发 doomloop（ask）」，
  //   再证明「同样的 streak 遇上 deny 时落点是 deny」——两者合起来才排除了假通过。
  {
    const { ws, home, h } = mkHost({ doomloop: { mode: 'ask', threshold: 2 } })
    // ① 两个会话各自数满 2 次（此时还没有 deny 规则）
    const ctl1 = await probe(h, ws, 's12ctl', T, A)
    const ctl2 = await probe(h, ws, 's12ctl', T, A)
    const own1 = await probe(h, ws, 's12', T, A)
    const own2 = await probe(h, ws, 's12', T, A)
    // ② 对照：同配置下第 3 次确实触发 doomloop（证明 streak 已数满、doom 真的会命中）
    const ctl3 = await probe(h, ws, 's12ctl', T, A)
    ok('★★ group22 S12(对照): 无 deny 规则时第 3 次触发 doomloop → ASK（证明 streak 已数满、doom 确实命中）',
      [ctl1, ctl2, own1, own2].every((v) => v === 'allow') && ctl3 === 'ask',
      JSON.stringify({ ctl: [ctl1, ctl2, ctl3], own: [own1, own2] }))
    // ③ 现在给同一个工具加一条 deny 规则，再让 s12 走第 3 次
    const addDeny = await callRoute(h.routes, 'POST', '/permgate/add-rule', { target: 'global', action: 'deny', tool: T, reason: '规则拒绝', lang: 'zh' })
    ok('group22 S12: deny 规则写入成功', !!(addDeny.data && addDeny.data.added), JSON.stringify(addDeny.data && addDeny.data.error))
    const own3 = await probe(h, ws, 's12', T, A)
    // ★★ 这条断言才是做法 A 的核心：doomloop（ask）不得把下游的 deny 削弱成 ask。
    // 修复前这里是 'ask'（doomloop 命中即 return，覆盖了规则判定）。
    ok('★★★ group22 T14: doomloop 命中（ask）+ 下游 deny → 取更严者 DENY（不得被降级为 ask）',
      own3 === 'deny', JSON.stringify({ own3: own3, ctl3: ctl3 }))
    // 反向：doomloop 比下游更严时必须由它接管（否则「取更严者」被写成了「永远以 base 为准」）
    // 用 deny 型 doomloop + allow 型兜底验证：命中后必须 deny，且理由换成循环提醒。
    {
      const r2 = mkHost({ fallbackMode: 'allow', doomloop: { mode: 'deny', threshold: 1 } })
      const a1 = await probe(r2.h, r2.ws, 's12b', T, A)
      const a2 = await probe(r2.h, r2.ws, 's12b', T, A)
      ok('★★ group22 T14(反向): doomloop=deny 比下游 allow 更严 → 由 doomloop 接管（DENY）',
        a1 === 'allow' && a2 === 'deny', JSON.stringify({ a1: a1, a2: a2 }))
      try { rmSync(r2.ws, { recursive: true, force: true }); rmSync(r2.home, { recursive: true, force: true }) } catch (e) {}
    }
    try { rmSync(ws, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }) } catch (e) {}
  }

  // ── S13：T2（command 收紧为 deny 后，doomloop 不得把它降级为 ask）────────
  // G2-2 的原始场景：用户把「命令」设为拒绝，前几次 DENY，之后 doomloop 命中 → 变 ASK。
  // 对抗性判据：断言**一次 ASK 都不出现**（fail-open 的表现正是「中间某几次变成 ask」）。
  {
    const { ws, home, h } = mkHost({ command: { mode: 'allow' }, doomloop: { mode: 'ask', threshold: 3 } })
    const pre3 = []
    for (let i = 0; i < 3; i++) pre3.push(await probe(h, ws, 's13', 'bash', { command: 'git status' }))
    await callRoute(h.routes, 'POST', '/permgate/set-category', { target: 'global', category: 'command', mode: 'deny', reason: '命令一律拒绝', lang: 'zh', sessionId: 'sess-1' })
    const after = []
    for (let i = 0; i < 3; i++) after.push(await probe(h, ws, 's13', 'bash', { command: 'git status' }))
    ok('★★★ group22 T2: command=deny 后 doomloop=ask 不得削弱它 —— 6 次全 DENY、一次 ASK 都不出现',
      pre3.every((v) => v === 'allow') && after.every((v) => v === 'deny'),
      JSON.stringify({ pre3: pre3, after: after }))
    try { rmSync(ws, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }) } catch (e) {}
  }

  // ── S14：T2 字面形态（command=deny 全程 6 次 → 6 次全 DENY）────────────
  // ⚠️ 配置已按新规则调整：旧规则下 `mode:'deny'` 会把八档一起推成 deny，
  // 故只写 mode 就够；新规则下八档一律「项目显式 → 全局显式 → ask」，
  // **必须显式写出** `destructive:{action:'deny'}` 才能让 `rm -rf x`（inside 档）落在 deny。
  // 被测的东西没变：doomloop=ask 不得把更严的 deny 削弱成 ask。
  {
    const { ws, home, h } = mkHost({ command: { mode: 'deny', destructive: { action: 'deny' }, reason: '命令一律拒绝' }, doomloop: { mode: 'ask', threshold: 3 } })
    const seq = []
    for (let i = 0; i < 6; i++) seq.push(await probe(h, ws, 's14', 'bash', { command: 'rm -rf x' }))
    ok('★★ group22 T2(字面): command=deny + inside 档显式 deny 全程 6 次 → 6 次全 DENY（无一次 ASK）',
      seq.every((v) => v === 'deny'), JSON.stringify(seq))
    try { rmSync(ws, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }) } catch (e) {}
  }

  // ── S15：T4（doomloop=allow = 知情关闭：行为不变，但 status 必须能让面板提示）──
  {
    const { ws, home, h } = mkHost({ doomloop: { mode: 'allow', threshold: 1 } })
    const st = await callRoute(h.routes, 'GET', '/permgate/status')
    ok('★ group22 T4: doomloop=allow 时 status 仍下发动作与阈值（面板据此给出「检测已关闭」提示）',
      !!(st.data && st.data.effective && st.data.effective.doomloop === 'allow'
        && st.data.categories && st.data.categories.global && st.data.categories.global.doomloop
        && st.data.categories.global.doomloop.mode === 'allow'),
      JSON.stringify({ eff: st.data && st.data.effective && st.data.effective.doomloop, cat: st.data && st.data.categories && st.data.categories.global && st.data.categories.global.doomloop }))
    const seq = await run(h, ws, 's15', 10)
    ok('★ group22 T4: doomloop=allow 时连续 10 次同一调用全部放行（知情关闭，行为不变）',
      seq.every((v) => v === 'allow'), JSON.stringify(seq))
    try { rmSync(ws, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }) } catch (e) {}
  }

  // ── S16：阈值可配的归一化与层级（T9/T10 的配置面）────────────────────────
  {
    const { ws, home, h } = mkHost({ doomloop: { mode: 'ask' } })
    const setTh = (body) => callRoute(h.routes, 'POST', '/permgate/set-doomloop', Object.assign({ lang: 'zh', sessionId: 'sess-1' }, body))
    // 非法值必须**回错误**，不得静默回落默认（静默回落会让面板显示与实际裁决分叉）
    const bad = []
    for (const v of [0, -3, 'abc', null, true]) {
      const r = await setTh({ target: 'global', threshold: v })
      if (!(r.data && r.data.error)) bad.push(v)
    }
    ok('★★ group22 S16: 非法阈值（0 / 负数 / 非数字 / null / true）一律回错误，不静默回落默认',
      bad.length === 0, JSON.stringify(bad))
    // 小数向下取整（与宿主同口径，避免「面板显示 1.5、实际按 1 跑」）
    const dec = await setTh({ target: 'global', threshold: 2.7 })
    ok('★ group22 S16: 小数阈值向下取整后落盘（2.7 → 2）',
      !!(dec.data && dec.data.doomloop && dec.data.doomloop.global === 2), JSON.stringify(dec.data && dec.data.doomloop))
    // ★★ 小于 1 的小数（0.5）必须被**钳到下限 1**，不得落盘成 0。
    // 这条是下限存在的唯一理由：0.5 通过了「> 0」这道校验，但 Math.floor 之后是 0，
    // 而 0 会让「streak >= 0」恒真 —— 变成**每次调用都触发**。而且它还会造成面板与实际
    // 裁决分叉：读取侧 doomloopSetting 对 0 会判非法并回落默认 6，于是 status 里
    // `global: 0`（面板显示 0）与 `effective: 6`（实际按 6 走）同时存在。
    // 实测：把 normalizeThreshold 的下限去掉，只测 2.7 的版本完全测不出来。
    const frac = await setTh({ target: 'global', threshold: 0.5 })
    const fd = frac.data && frac.data.doomloop
    ok('★★ group22 S16: 小于 1 的小数被钳到下限 1（不得落盘成 0 → 恒触发 + 面板与实际分叉）',
      !!(fd && fd.global === 1 && fd.effective && fd.effective.threshold === 1),
      JSON.stringify(fd))
    // 大值原样接受：**无上限**（窗口已删，阈值多大都能触发）
    const big = await setTh({ target: 'global', threshold: 999 })
    ok('★★ group22 T10: 阈值 999 原样接受且原样下发（无上限、不是静默失效）',
      !!(big.data && big.data.doomloop && big.data.doomloop.global === 999
        && big.data.doomloop.effective && big.data.doomloop.effective.threshold === 999
        && big.data.doomloop.max === null),
      JSON.stringify(big.data && big.data.doomloop))
    // 项目层：显式值优先于全局；恢复 inherit 后回落全局
    const pSet = await setTh({ target: 'project', threshold: 4 })
    ok('★ group22 S16: 项目层阈值生效并标记来源为 project',
      !!(pSet.data && pSet.data.doomloop && pSet.data.doomloop.effective
        && pSet.data.doomloop.effective.threshold === 4 && pSet.data.doomloop.effective.source === 'project'),
      JSON.stringify(pSet.data && pSet.data.doomloop))
    const pInh = await setTh({ target: 'project', threshold: 'inherit' })
    ok('★ group22 S16: 项目层恢复 inherit 后穿透全局（回落 999）',
      !!(pInh.data && pInh.data.doomloop && pInh.data.doomloop.effective
        && pInh.data.doomloop.effective.threshold === 999 && pInh.data.doomloop.effective.source === 'global'
        && pInh.data.doomloop.project === null),
      JSON.stringify(pInh.data && pInh.data.doomloop))
    // 项目层阈值在真实判定链上生效：阈值 2 → 第 3 次触发
    const pv = await setTh({ target: 'project', threshold: 2 })
    ok('group22 S16: 项目层阈值 2 写入成功', !!(pv.data && pv.data.doomloop && pv.data.doomloop.effective.threshold === 2), JSON.stringify(pv.data && pv.data.doomloop))
    const seq = await run(h, ws, 's16', 3)
    ok('★★ group22 S16: 项目层阈值在真实判定链上生效（阈值 2 → 第 3 次触发）',
      seq[0] === 'allow' && seq[1] === 'allow' && seq[2] === 'ask', JSON.stringify(seq))
    try { rmSync(ws, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }) } catch (e) {}
  }

  // ── S17：T17（计数实现的等价性：模型级对拍）──────────────────────────────
  // 这条验证的是 §2.3 里「数组是纯冗余」这个**结论本身**（它是删掉窗口与 REPEAT_STREAK_MAX
  // 的依据）。故它是模型级断言：用同一串随机记录分别喂给「旧数组回扫」与「(键,次数) 计数」，
  // 逐次比较**查询结果**（两者都在记录之前查，与 decide() 的次序一致）。
  // 两件事要分开说清：
  //   ① 与**无窗口**的数组语义**完全等价**（零不一致）—— 所以计数不是近似，是等价替换；
  //   ② 与**带 12 窗口**的旧实现只在「连续长度 > 12」处不同，且差异恒为「数组被截断成 12」
  //      —— 这正是旧实现「阈值 > 窗口即静默失效」的来源，也是删窗口的理由。
  {
    let s = 123456789
    const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s |= 0; return (s >>> 0) / 4294967296 }
    const KEYS = ['a', 'b', 'c', 'd']
    const tail = (arr, k) => { let n = 0; for (let i = arr.length - 1; i >= 0; i--) { if (arr[i] === k) n++; else break } return n }
    const N = 270000
    let arrFree = []
    let arrWin = []
    let cur = null
    let badFree = 0
    let badWin = 0
    let badWinOther = 0
    for (let i = 0; i < N; i++) {
      const k = KEYS[Math.floor(rnd() * KEYS.length)]
      const free = tail(arrFree, k)
      const win = tail(arrWin, k)
      const cnt = (cur && cur.key === k) ? cur.count : 0
      if (free !== cnt) badFree++
      if (win !== cnt) { badWin++; if (!(win === 12 && cnt > 12)) badWinOther++ }
      arrFree.push(k)
      arrWin.push(k)
      if (arrWin.length > 12) arrWin.splice(0, arrWin.length - 12)
      if (cur && cur.key === k) cur.count += 1
      else cur = { key: k, count: 1 }
    }
    ok('★★ group22 T17: (键,次数) 计数与无窗口数组回扫 270,000 次对拍零不一致（等价替换，不是近似）',
      badFree === 0, 'badFree=' + badFree)
    ok('★★ group22 T17: 与带 12 窗口的旧实现只在「连续长度 > 12」处不同，且差异恒为数组被截断成 12',
      badWinOther === 0, 'badWin=' + badWin + ' badWinOther=' + badWinOther)
  }
  // ── S18：T18（会话键取不到时 → 不读不写、不触发）────────────────────────
  // 取不到会话身份时**跳过循环检测**，而不是回落到一个全局共享桶：
  // 共享桶等于把「A 连续 N 次 → B 第 1 次就被牵连」原样保留；方向虽不危险（多弹窗），
  // 但会误伤正常工作流。循环检测只是「额外提醒」，拿不准身份时不提醒是安全的。
  //
  // ★ 构造难点：createHost 的 sessions.list 默认返回 []，而 sessionPresetName 依赖
  //   currentSession(exec) —— exec.agent.session 缺失时会回退到 sessions.list() 的最后一个。
  //   若它也是空，sessionPresetName 返回 null → decide() 第一行就放行，
  //   那样本用例会因为「不是自定义审查」而通过，**测不到**会话键缺失这条路径（假通过）。
  //   故这里把 sessions.list 换成有会话的版本，让审查生效、只缺 exec 上的会话 id。
  {
    const { ws, home, h } = mkHost({ doomloop: { mode: 'ask', threshold: 1 } })
    h.ctx.sessions.list = () => [{ id: 'fallback-sess' }]
    // 先确认审查确实生效（否则下面的「不触发」无法归因于会话键缺失）
    const st = await callRoute(h.routes, 'GET', '/permgate/status')
    ok('group22 S18: 前置条件 —— 审查生效（custom-review），故下面的「不触发」不是因为它没生效',
      !!(st.data && st.data.activeForSession === true), JSON.stringify({ active: st.data && st.data.activeForSession, preset: st.data && st.data.preset }))
    // 会话键缺失（exec.agent 无 session）：阈值 1 = 第 2 次就该触发，但这里必须一次都不触发
    const bucketsBefore = (await callRoute(h.routes, 'GET', '/permgate/status')).data.counts.loopBuckets
    const noSess = []
    for (let i = 0; i < 4; i++) noSess.push(await probe(h, ws, null, T, A))
    ok('★★ group22 T18: 会话键取不到时不触发循环检测（阈值 1 也一次都不触发）',
      noSess.every((v) => v === 'allow'), JSON.stringify(noSess))
    // ★★ 桶数不增长 —— 这是「不建桶」的**唯一可观察证据**（plan §2.3 明确要求断言它）。
    // 只断言「不触发」是不够的：一个「取不到会话就每次调用建一个独立桶」的实现同样不触发，
    // 但它会让 Map 无界增长（或把真实会话的桶挤出 LRU）。实测：把 loopSessionKey 改成
    // 每次返回唯一值，只断言落点的版本**完全测不出来**。
    const bucketsAfter = (await callRoute(h.routes, 'GET', '/permgate/status')).data.counts.loopBuckets
    ok('★★ group22 T18: 会话键取不到时不建桶（桶数不因这 4 次调用增长）—— 防 Map 无界增长',
      bucketsAfter === bucketsBefore, JSON.stringify({ before: bucketsBefore, after: bucketsAfter }))
    // 对照：同一个宿主、同一配置下带上会话 id → 第 2 次立即触发。
    // 这一条排除了「阈值 1 根本没生效」或「探测函数恒返回 allow」这类假通过。
    const withSess = [await probe(h, ws, 's18', T, A), await probe(h, ws, 's18', T, A)]
    ok('★★ group22 T18(对照): 同一配置下带会话 id 时第 2 次立即触发（证明阈值 1 确实生效）',
      withSess[0] === 'allow' && withSess[1] === 'ask', JSON.stringify(withSess))
    // 对照二：带会话 id 且**不触发**时确实建了桶 —— 证明上面那条「桶数不变」不是因为计数根本没在写。
    // 注意不能用上面那对调用读桶数：第 2 次触发 ask → resetStreak 把桶删掉了（那是正确行为），
    // 读到的必然是 0。故这里用一个**新会话只调一次**（阈值 1 下第 1 次恒为 allow、不会清零）。
    await probe(h, ws, 's18b', T, A)
    const bucketsWith = (await callRoute(h.routes, 'GET', '/permgate/status')).data.counts.loopBuckets
    ok('★★ group22 T18(对照): 带会话 id 且未触发时确实建桶（证明「桶数不变」不是计数没写）',
      bucketsWith === bucketsBefore + 1, JSON.stringify({ before: bucketsBefore, withSess: bucketsWith }))
    // ★ LRU 淘汰：桶数不得超过 SESSION_BUCKET_MAX（32）。这里用 40 个会话各调一次，
    // 断言桶数被压在 32 —— 防「淘汰逻辑写错导致 Map 无界增长」。
    // 每个会话只调一次（阈值 1 下恒为 allow、不清零），故 40 个都会留下桶。
    for (let i = 0; i < 40; i++) await probe(h, ws, 'lru-' + i, T, A)
    const bucketsLru = (await callRoute(h.routes, 'GET', '/permgate/status')).data.counts.loopBuckets
    ok('★★ group22 T18: 会话桶数被 LRU 压在 SESSION_BUCKET_MAX(32) 以内（40 个会话后仍 ≤ 32）',
      bucketsLru <= 32, JSON.stringify({ buckets: bucketsLru }))
    // 淘汰的必须是**最久未更新**的桶（LRU，不是 FIFO/随机）：最早那批（s18b 与 lru-0…）
    // 应已被淘汰，而最后写入的 lru-39 必须还在。
    // 判据：给 lru-39 再调一次（阈值 1 → 第 2 次触发 ask），能触发就说明它的桶还在。
    const lruLast = await probe(h, ws, 'lru-39', T, A)
    ok('★★ group22 T18: LRU 保留最近活动的桶（lru-39 的第 2 次仍能触发 → 它的桶未被淘汰）',
      lruLast === 'ask', JSON.stringify({ lruLast: lruLast }))
    try { rmSync(ws, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }) } catch (e) {}
  }
  // ── S19：T18 补 —— LRU 而非 FIFO（淘汰的必须是「最久未更新」，不是「最早创建」）──
  // 为什么单独测：LRU 与 FIFO 在「桶数不超限」这条断言下**完全等价**（都压到 32），
  // 只有「一个老会话在中间被重新活动过」才能区分二者。写错方向的后果是真实的：
  // FIFO 会把**正在活跃**的会话桶淘汰掉，那个会话的连续计数凭空归零（提醒静默失效）。
  // 判据构造（阈值 3，触发点是第 4 次）：
  //   s_old 调 1 次 → 31 个新会话（此时桶满 32，s_old 在插入序最前）
  //   → s_old 再调 1 次（LRU 下它被移到末尾；FIFO 下仍留在最前）
  //   → 再开 1 个新会话（超限淘汰：LRU 淘汰 lru-0，FIFO 淘汰 s_old）
  //   → s_old 调第 3、4 次：桶还在则第 4 次触发；被淘汰则计数从 0 重来、第 4 次仍放行
  {
    const { ws, home, h } = mkHost({ doomloop: { mode: 'ask', threshold: 3 } })
    await probe(h, ws, 's_old', T, A)
    for (let i = 0; i < 31; i++) await probe(h, ws, 'lru2-' + i, T, A)
    const b1 = (await callRoute(h.routes, 'GET', '/permgate/status')).data.counts.loopBuckets
    await probe(h, ws, 's_old', T, A)
    await probe(h, ws, 'lru2-new', T, A)
    const b2 = (await callRoute(h.routes, 'GET', '/permgate/status')).data.counts.loopBuckets
    const s3 = await probe(h, ws, 's_old', T, A)
    const s4 = await probe(h, ws, 's_old', T, A)
    ok('★★ group22 T18: 桶数在插入 32 个会话后达到上限、再插入仍不超限',
      b1 === 32 && b2 === 32, JSON.stringify({ b1: b1, b2: b2 }))
    ok('★★ group22 T18: 淘汰的是最久未更新的桶（LRU）—— 被重新活动过的老会话计数不丢',
      s3 === 'allow' && s4 === 'ask', JSON.stringify({ s3: s3, s4: s4 }))
    try { rmSync(ws, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }) } catch (e) {}
  }

  // ── S20：计数点必须在**所有拦截之后**（沙箱升级被拒 = 未执行 → 不计数）────────
  // §2.2 的表格明确要求「沙箱升级被拒 → 不计数」，而这是唯一一条「判定放行（d.action==='allow'）
  // 但最终没执行」的路径。计数点若放在升级闸之前，这条路径会推进计数 —— 方向是「提醒偏多」，
  // 不危险，但会让「连续静默放行」这个语义失真（用户看到的是「已连续放行 N 次」，
  // 而其中几次其实被沙箱闸拦下了、根本没放行）。
  // 判据构造（阈值 3）：先让 3 次工作区外写入全部卡在升级闸（overrideOf=workspace-write、
  // 升级审批被拒）→ 再把沙箱放开，同一调用第 4 次：计数正确则放行，计数错误则触发 ASK。
  {
    const { ws, home, h } = mkHost({ doomloop: { mode: 'ask', threshold: 3 } })
    // 工作区外写入 + 编辑/目录分类都 allow → decide 给 allow，但 needsUpgrade 为真
    await callRoute(h.routes, 'POST', '/permgate/set-categories', { target: 'global', global: { edit: 'allow', directory: 'allow' }, lang: 'zh', sessionId: 'sess-1' })
    const outDir = mkdtempSync(join(tmpdir(), 'pg-loop-out-'))
    const outFile = join(outDir, 'x.txt')
    h.ctx.sandboxPolicy.overrideOf = () => 'workspace-write'
    const deniedSeq = []
    for (let i = 0; i < 3; i++) deniedSeq.push(await probe(h, ws, 's20', 'write', { file_path: outFile, content: 'x' }))
    ok('group22 S20: 前置条件 —— 沙箱受限时工作区外写入被升级闸拦下（3 次全 deny）',
      deniedSeq.every((v) => v === 'deny'), JSON.stringify(deniedSeq))
    // 放开沙箱：同一调用不再需要升级 → 直接放行
    h.ctx.sandboxPolicy.overrideOf = () => 'danger-full-access'
    const s4 = await probe(h, ws, 's20', 'write', { file_path: outFile, content: 'x' })
    ok('★★ group22 S20: 被沙箱升级闸拦下的调用不推进连续计数（第 4 次仍放行，未误触发）',
      s4 === 'allow', JSON.stringify({ denied: deniedSeq, s4: s4 }))
    try { rmSync(ws, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }); rmSync(outDir, { recursive: true, force: true }) } catch (e) {}
  }

  // ── S21：perm_* 的排除保持现状（权限查询反复调用不代表卡死，不是循环）──────────
  // perm_status 是当前唯一保留的 perm_* 工具（只读），QUICK_DEFAULTS 钉为 allow。
  // 它若被计入，AI 每轮开头查一次权限就会攒出「循环」并弹窗 —— 那是纯噪音。
  // 阈值 2 → 若计数则第 3 次 ASK；不计数则 4 次全 allow。
  {
    const { ws, home, h } = mkHost({ doomloop: { mode: 'ask', threshold: 2 } })
    const seq = []
    for (let i = 0; i < 4; i++) seq.push(await probe(h, ws, 's21', 'perm_status', {}))
    ok('★★ group22 S21: perm_* 不计入循环检测（反复查询权限状态不触发提醒）',
      seq.every((v) => v === 'allow'), JSON.stringify(seq))
    // 对照：同一宿主下换一个普通工具、同样 4 次 → 第 3 次触发（证明阈值 2 确实生效）
    const ctl = []
    for (let i = 0; i < 3; i++) ctl.push(await probe(h, ws, 's21b', T, A))
    ok('★★ group22 S21(对照): 同一配置下普通工具第 3 次触发（证明阈值 2 确实生效）',
      ctl[0] === 'allow' && ctl[1] === 'allow' && ctl[2] === 'ask', JSON.stringify(ctl))
    try { rmSync(ws, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }) } catch (e) {}
  }

  // ── S22：非「自定义审查」模式不累积计数（切回审查模式不得凭空触发）──────────────
  // 非该模式下 decide() 恒返回 allow（它自己第一行就早退），若计数点只靠
  // `d.action !== 'allow'` 清零，计数会只增不减。用户之后把该会话切到「自定义审查」，
  // 第一次相同调用就会命中一个**审查模式下从未发生过**的连续次数（默认 ask 立刻弹窗，
  // doomloop=deny 时直接中断 AI 且不弹窗）—— 而面板此刻还写着「循环检测不生效」。
  //
  // 判据构造（阈值 2，触发点是第 3 次）：
  //   ① 审查关闭时同一会话连续 5 次（远超阈值）→ 全 allow 且不得留下计数；
  //   ② 打开审查后，同一会话第 1、2 次必须仍放行（若①累积了 5，这里第 1 次就会 ask）。
  // ②是**必需的对照片段**：只断言①无效 —— 一个「完全不计数」的实现同样让①通过。
  {
    const { ws, home, h } = mkHost({ doomloop: { mode: 'ask', threshold: 2 } })
    // 审查关闭：permissionPresets 报一个非 custom-review 的预设
    h.ctx.permissionPresets = { permissionState: () => ({ preset: 'default' }), current: () => 'default', resolved: () => ({ preset: 'default' }) }
    const offSeq = []
    for (let i = 0; i < 5; i++) offSeq.push(await probe(h, ws, 's22', T, A))
    ok('group22 S22: 前置条件 —— 审查关闭时 5 次同一调用全放行',
      offSeq.every((v) => v === 'allow'), JSON.stringify(offSeq))
    const bucketsOff = (await callRoute(h.routes, 'GET', '/permgate/status')).data.counts.loopBuckets
    ok('★★ group22 S22: 审查关闭期间不建桶（计数不累积）',
      bucketsOff === 0, JSON.stringify({ buckets: bucketsOff }))
    // 打开审查：同一会话、同一调用。若①期间累积过计数，这里第 1 次就会立刻 ask。
    h.ctx.permissionPresets = { permissionState: () => ({ preset: 'custom-review' }), current: () => 'custom-review', resolved: () => ({ preset: 'custom-review' }) }
    const on1 = await probe(h, ws, 's22', T, A)
    const on2 = await probe(h, ws, 's22', T, A)
    const on3 = await probe(h, ws, 's22', T, A)
    ok('★★ group22 S22: 切回审查模式后计数从零开始（第 1 次不得凭空触发；第 3 次才 ask）',
      on1 === 'allow' && on2 === 'allow' && on3 === 'ask', JSON.stringify({ on1: on1, on2: on2, on3: on3 }))
    try { rmSync(ws, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }) } catch (e) {}
  }
}

if (fail.length) {
  console.log('\nFAIL (' + fail.length + ')：')
  for (const f of fail) console.log('  ✗ ' + f)
  process.exit(1)
}
console.log('\nSMOKE ALL PASS')
