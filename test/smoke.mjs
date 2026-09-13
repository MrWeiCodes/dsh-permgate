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

try { rmSync(workspace, { recursive: true, force: true }); rmSync(dshHome, { recursive: true, force: true }) } catch (e) {}

if (fail.length) {
  console.log('\nFAIL (' + fail.length + ')：')
  for (const f of fail) console.log('  ✗ ' + f)
  process.exit(1)
}
console.log('\nSMOKE ALL PASS')
