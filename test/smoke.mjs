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
  ok('group5: status 下发 quickPreset（35 项：22 常规 + 10 个 perm_* + cordis_run/stop/undefine）', presetList.length === 35, 'len=' + presetList.length)
  ok('group5: quickPreset 与 quickDefaults 键一致', presetList.length > 0 && presetList.every((t) => Object.prototype.hasOwnProperty.call(defaults, t)), JSON.stringify(presetList.filter((t) => !Object.prototype.hasOwnProperty.call(defaults, t))))
  // issue #3：perm_* 曾在 decide 里被无条件放行（AI 可自我提权且无弹窗）；纳入快捷预设后必须走 ask
  const rp1 = await probe('perm_add_exception')
  ok('group5: perm_add_exception 默认不被静默放行', rp1.nexted === false, JSON.stringify(rp1.out))
  const rp2 = await probe('perm_set_category')
  ok('group5: perm_set_category 默认不被静默放行', rp2.nexted === false, JSON.stringify(rp2.out))
  const rp3 = await probe('cordis_run')
  ok('group5: cordis_run 默认不被静默放行', rp3.nexted === false, JSON.stringify(rp3.out))

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
  // read 默认 allow，需显式改 ask 才会进审批；image/edit/undo 默认已是 ask
  await setCat5('read', 'ask')
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

if (fail.length) {
  console.log('\nFAIL (' + fail.length + ')：')
  for (const f of fail) console.log('  ✗ ' + f)
  process.exit(1)
}
console.log('\nSMOKE ALL PASS')
