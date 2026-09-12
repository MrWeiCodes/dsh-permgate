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
function makeReq(method, url, body) {
  const req = new EventEmitter()
  req.method = method
  req.url = url
  req.headers = { host: '127.0.0.1:3080', 'content-type': 'application/json' }
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

function createHost({ workspaceRoot, dshHome }) {
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
    get: (k) => (k === 'subprocess' ? null : undefined),
  }
  process.env.DSH_HOME = dshHome
  plugin.apply(ctx)
  return { ctx, registered, routes, hooks, fs }
}

async function callRoute(routes, method, url, body) {
  const entry = routes.find((r) => url.startsWith(r.path))
  if (!entry) throw new Error('no route for ' + url)
  const req = makeReq(method, url, body)
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
ok('apply 注册了 perm_* 工具', host.registered.size >= 8, 'registered=' + host.registered.size)
ok('apply 注册了 /permgate 路由', host.routes.length >= 1 && host.routes[0].path === '/permgate')
ok('apply 注册了 tools/pre-execute 钩子', typeof host.hooks.get('tools/pre-execute') === 'function')

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
async function runApproval(name, args, fileText, fileName) {
  if (fileText !== undefined) writeFileSync(join(workspace, fileName || 'a.txt'), fileText, 'utf8')
  const exec = makeExec(workspace, name, args)
  const pending = pre(exec, async () => ({ kind: 'allow' }))
  pending.catch(() => {})
  await new Promise((r) => setTimeout(r, 30))
  const p = await callRoute(host.routes, 'GET', '/permgate/pending')
  const list = Array.isArray(p.data) ? p.data : ((p.data && p.data.pending) || [])
  const item = list[0]
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
  const msg = typeof err === 'string' ? err : (err && (err.zh || err.message)) || ''
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

  const setCat = host2.registered.get('perm_set_category')
  const saved = await setCat.execute({ target: 'global', category: 'edit', mode: 'deny' }, makeExec(ws2, 'perm_set_category', {}))
  ok('perm_set_category 返回 status', !!(saved && saved.configPath))
  let parsed2 = null
  try { parsed2 = JSON.parse(readFileSync(homeCfg, 'utf8')) } catch (e) {}
  ok('保存后 home 配置写入 edit=deny', !!(parsed2 && parsed2.global && parsed2.global.edit && parsed2.global.edit.mode === 'deny'), JSON.stringify(parsed2 && parsed2.global && parsed2.global.edit))

  try { rmSync(ws2, { recursive: true, force: true }); rmSync(home2, { recursive: true, force: true }) } catch (e) {}
}

// ─────────────────────────────────────────────────────────────
group('5. 快捷工具：预设默认值参与裁决、显式配置优先、删除键回退、status 契约')
{
  // 用干净 home 写一份「老配置代际」：quickTools 只有旧 5 键，其余预设键缺席
  const ws3 = mkdtempSync(join(tmpdir(), 'pg-smoke-ws3-'))
  const home3 = mkdtempSync(join(tmpdir(), 'pg-smoke-home3-'))
  mkdirSync(join(home3, 'dsh-permgate'), { recursive: true })
  writeFileSync(join(home3, 'dsh-permgate', 'config.json'), JSON.stringify({
    global: { quickTools: { web_search: 'ask', skill: 'allow', grep: 'allow', glob: 'allow', web_fetch: 'ask' }, fallbackMode: 'ask' },
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

  const setQuick = host3.registered.get('perm_set_quick')
  ok('group5: perm_set_quick 工具已注册', !!setQuick && typeof setQuick.execute === 'function')
  await setQuick.execute({ target: 'global', tool: 'job_kill', action: 'deny' }, makeExec(ws3, 'perm_set_quick', {}))
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
  ok('group5: status 下发 quickPreset（22 项）', presetList.length === 22, 'len=' + presetList.length)
  ok('group5: quickPreset 与 quickDefaults 键一致', presetList.length > 0 && presetList.every((t) => Object.prototype.hasOwnProperty.call(defaults, t)), JSON.stringify(presetList.filter((t) => !Object.prototype.hasOwnProperty.call(defaults, t))))

  try { rmSync(ws3, { recursive: true, force: true }); rmSync(home3, { recursive: true, force: true }) } catch (e) {}
}

// ─────────────────────────────────────────────────────────────
try { rmSync(workspace, { recursive: true, force: true }); rmSync(dshHome, { recursive: true, force: true }) } catch (e) {}

if (fail.length) {
  console.log('\nFAIL (' + fail.length + ')：')
  for (const f of fail) console.log('  ✗ ' + f)
  process.exit(1)
}
console.log('\nSMOKE ALL PASS')
