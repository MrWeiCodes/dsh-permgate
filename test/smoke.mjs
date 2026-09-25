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
    projects: { [ws2]: { fallbackMode: 'ask' }, 'C:/other-project': { fallbackMode: 'allow' } },
  }, null, 2), 'utf8')

  const status = host2.registered.get('perm_status')
  ok('perm_status 工具已注册', !!status && typeof status.execute === 'function')
  const view = await status.execute({}, makeExec(ws2, 'perm_status', {}))
  ok('perm_status 返回 status 视图', !!(view && view.configPath))

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

  // (b) 面板/工具新增的例外与历史条目方向相反时，新决定立即生效（插到数组头部）
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
  ok('新决定排在例外数组头部（最新先生效）', rows5[0] && rows5[0].action === 'deny' && rows5.some((e) => e.action === 'allow'), JSON.stringify(rows5.map((e) => e.action)))
  const out5 = await Promise.race([pre5(makeExec(ws5, 'read_image', { file_path: img5 }), async () => ({ kind: 'allow' })), new Promise((r) => setTimeout(() => r({ kind: 'timeout' }), 400))])
  ok('面板新增的 deny 直接生效（不再被历史 allow 屏蔽）', !!out5 && out5.kind === 'deny', JSON.stringify(out5))
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

  // (f) 同向重复写入必须让该决定生效：命中的旧条目要被提到头部，否则会被前面的反向条目遮蔽
  const ws9 = mkdtempSync(join(tmpdir(), 'pg-smoke-ws9-'))
  const home9 = mkdtempSync(join(tmpdir(), 'pg-smoke-home9-'))
  mkdirSync(join(home9, 'dsh-permgate'), { recursive: true })
  const h9 = createHost({ workspaceRoot: ws9, dshHome: home9 })
  const pre9 = h9.hooks.get('tools/pre-execute')
  const img9 = join(ws9, 'w.png')
  writeFileSync(img9, Buffer.from(PNG, 'base64'))
  const add9 = (action) => callRoute(h9.routes, 'POST', '/permgate/add-exception', { target: 'project', category: 'image', action, match: img9 })
  const rows9 = async () => {
    const st = await callRoute(h9.routes, 'GET', '/permgate/status')
    return ((((st.data || {}).categories || {}).project || {}).image || {}).exceptions || []
  }
  await add9('deny')
  await add9('allow')
  ok('先 deny 后 allow 时 allow 排在头部生效', (await rows9())[0].action === 'allow')
  await add9('deny')
  const rows9b = await rows9()
  ok('同向重复写入把命中的 deny 提到头部', rows9b.length === 2 && rows9b[0].action === 'deny', JSON.stringify(rows9b.map((e) => e.action)))
  const out9 = await Promise.race([pre9(makeExec(ws9, 'read_image', { file_path: img9 }), async () => ({ kind: 'allow' })), new Promise((r) => setTimeout(() => r({ kind: 'timeout' }), 400))])
  ok('该路径按最新决定拒绝（不再被前面的 allow 遮蔽）', !!out9 && out9.kind === 'deny', JSON.stringify(out9))
  // 同向重复写入带新理由时应更新既有条目的 reason（面板显示最新理由）
  const add9r = (action, reason) => callRoute(h9.routes, 'POST', '/permgate/add-exception', { target: 'project', category: 'image', action, match: img9, reason })
  await add9r('deny', '第一次理由')
  await add9r('deny', '更新后的理由')
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
  ok('group15: 弹窗文案带出该例外的备注', !!itemA && String(itemA.reason).indexOf('这个目录的文本需人工确认') !== -1, String(itemA && itemA.reason))
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
  ok('group15: 新 allow 例外插到 ask 例外之前（最新决定先生效）', rowsA5.length === 2 && rowsA5[0].action === 'allow' && rowsA5[1].action === 'ask', JSON.stringify(rowsA5.map((e) => e.action)))
  let nextedA5 = false
  const pA6 = preA(makeExec(wsA, 'read', { file_path: join(outA, 'note.txt') }), async () => { nextedA5 = true; return { kind: 'allow' } })
  pA6.catch(() => {})
  await Promise.race([pA6, new Promise((r) => setTimeout(r, 300))])
  ok('group15: 之后的同类读取被 allow 例外静默放行（ask 例外已被盖过）', nextedA5 === true)

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
  ok('group15: 工作区外 ask 例外的文案带自己的备注', !!itemA4 && String(itemA4.reason).indexOf('外部图片需确认') !== -1, String(itemA4 && itemA4.reason))
  const stA4 = await callRoute(hA2.routes, 'GET', '/permgate/status')
  const decA4 = ((stA4.data && stA4.data.recentDecisions) || []).filter((d) => d.tool === 'read_image').pop()
  ok('group15: 工作区外 ask 例外的 ruleId 与文案同源', !!decA4 && decA4.ruleId === idA2, JSON.stringify({ got: decA4 && decA4.ruleId, want: idA2 }))
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

if (fail.length) {
  console.log('\nFAIL (' + fail.length + ')：')
  for (const f of fail) console.log('  ✗ ' + f)
  process.exit(1)
}
console.log('\nSMOKE ALL PASS')
