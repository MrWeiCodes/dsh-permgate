#!/usr/bin/env node
// dsh-permgate 回归套件：把历轮审查/修复中确认过的口径与边界固定下来，防止「修好的被改回去」。
// 用法：node test/regressions.mjs
// 约定：只做静态断言 + 纯函数复算 + 模块级冒烟，不依赖 DSH 运行时，不发起网络请求。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join as pathJoin, resolve as pathResolve, isAbsolute as pathIsAbsolute } from 'node:path'
import { existsSync as fsExistsSync, readFileSync as fsReadFileSync, readdirSync as fsReaddirSync, unlinkSync as fsUnlinkSync, lstatSync as fsLstatSync, realpathSync as fsRealpathSync } from 'node:fs'
import { homedir as osHomedir } from 'node:os'

const ROOT = pathResolve(pathJoin(fileURLToPath(import.meta.url), '..', '..'))
const src = readFileSync(pathJoin(ROOT, 'index.js'), 'utf8')
const cli = readFileSync(pathJoin(ROOT, 'client.js'), 'utf8')

const fail = []
// extra：失败时附带的诊断信息（与 smoke.mjs 的 ok 同签名）。golden 比对类断言必须给，
// 否则失败时只报「某条断言不通过」，改的人看不出期望与实际的差异在哪。
const ok = (name, cond, extra) => { if (!cond) fail.push(name + (extra ? ' — ' + extra : '')) }
const group = (t) => console.log('\n— ' + t)

// ─────────────────────────────────────────────────────────────
group('1. 模块级冒烟：头部（export default 之前的全部定义）在无 DSH 环境下可求值')
// 目的：捕获「模块级函数引用闭包内常量/未定义标识符」这类只在运行时才炸的错误
const headEnd = src.indexOf('export default {')
ok('能定位 export default', headEnd > 0)
const head = src.slice(0, headEnd).replace(/^import .*$/gm, '')
let mod = null
try {
  mod = new Function(
    'pathJoin', 'pathResolve', 'pathIsAbsolute',
    'fsExistsSync', 'fsReadFileSync', 'fsReaddirSync', 'fsUnlinkSync', 'fsLstatSync', 'fsRealpathSync',
    'osHomedir', 'process', 'console',
    head + '\n; return { overMaxChars, sreCommand, isFileWrite, isFileRead, isFileImage, sniffImage, IMAGE_MIME, isUndo, isPreviewableFileTool, normTarget, normPathKey, fileTooLarge, readFail, bi, L, normLang, CATS, EXC_CATS, CATEGORY_ENUM, EXC_CATEGORY_ENUM, EDITOR_KERNELS, EDITOR_KERNEL_VALUES, DIFF_MAX_CHARS };'
  )(
    pathJoin, pathResolve, pathIsAbsolute,
    fsExistsSync, fsReadFileSync, fsReaddirSync, fsUnlinkSync, fsLstatSync, fsRealpathSync,
    osHomedir, process, console
  )
  ok('模块级头部求值成功（无 ReferenceError）', true)
} catch (e) {
  ok('模块级头部求值成功（无 ReferenceError）：' + (e && e.message), false)
}
if (mod) {
  ok('DIFF_MAX_CHARS 可用且为 1MB', mod.DIFF_MAX_CHARS === 1048576)
  ok('overMaxChars 可调用（作用域正确）', mod.overMaxChars('a', 'b') === false)
  ok('overMaxChars 超限为真', mod.overMaxChars('a'.repeat(1048576), 'b') === true)
  ok('readFail 形状', mod.readFail(new Error('x')).zh === '读取失败: x' && mod.readFail('y').en === 'Read failed: y')
  ok('normLang 归一化', mod.normLang('en') === 'en' && mod.normLang('jp') === 'zh')
  ok('CATEGORY_ENUM 与 CATS 一致', JSON.stringify(mod.CATEGORY_ENUM) === JSON.stringify(mod.CATS) && mod.CATS.indexOf('undo') !== -1)
  ok('EXC_CATEGORY_ENUM 与 EXC_CATS 一致', JSON.stringify(mod.EXC_CATEGORY_ENUM) === JSON.stringify(mod.EXC_CATS))
  ok('fileTooLarge 用参数而非闭包常量', mod.fileTooLarge({ size: 2000000 }, mod.DIFF_MAX_CHARS) === true && mod.fileTooLarge({ size: 10 }, mod.DIFF_MAX_CHARS) === false)
}

// ─────────────────────────────────────────────────────────────
group('2. 路径与 home：单一来源、口径一致')
ok('pathString 定义并含 processPath 优先', src.includes('function pathString(v, fallback) {') && src.includes('const viaProcess = fs.processPath && fs.processPath(v)'))
ok('extractStorePath 委托 pathString', src.includes('return pathString(v, fallback)'))
ok('homeFromEnv 定义', src.includes('function homeFromEnv() {'))
ok('homeFromEnv 顺序 DSH_HOME → os.homedir → HOME', /const dh = localAbs\(process\.env\.DSH_HOME\)[\s\S]{0,600}?const oh = osHomedir\(\)[\s\S]{0,300}?const h = localAbs\(process\.env\.HOME/.test(src))
ok('homeFromEnv 要求绝对路径 + win32 盘符', src.includes('if (!s || !pathIsAbsolute(s)) return null') && src.includes('if (win && !isWinAbs(s)) return null'))
ok('homeConfigTarget 统一拼接', src.includes('async function homeConfigTarget(home) {') && (src.match(/homeConfigTarget\(/g) || []).length >= 5)
ok('无内联 home 配置拼接', !/fs\.resolve\((homeNow|home) \+ '\/dsh-permgate\/config\.json'\)/.test(src))
ok('better-edit 路径复用 homeFromEnv', src.includes('const base = homeFromEnv()\n        if (base) {') && src.includes('const base = homeFromEnv()\n        if (!base) return null'))
ok('无 process.env.DSH_HOME 直读', !src.includes('process.env.DSH_HOME ||'))
ok('fixRoot 用于 isOutside 两侧', src.includes('const ra = fixRoot(abs)') && src.includes('const rr = fixRoot(r)'))

// ─────────────────────────────────────────────────────────────
group('3. 命令/工具判定：命令解析单一来源')
ok('sreCommand 定义一次', (src.match(/function sreCommand\(args\)/g) || []).length === 1)
ok('无裸 args.command 解析（仅 sreCommand 内）', (src.match(/String\(\(?args(?: && args)?\.command/g) || []).length === 1)
ok('isFileWrite 走 sreCommand', src.includes('return !!SRE_WRITE_CMDS[sreCommand(args)]'))
ok('isFileRead 走 sreCommand', src.includes("return sreCommand(args) === 'view'"))
ok('isPreviewableFileTool 定义并组合四类（含图片）', src.includes('function isPreviewableFileTool(name, args) {') && src.includes('return !!(isFileWrite(name, args) || isFileRead(name, args) || isFileImage(name) || isUndo(name))'))
ok('hasDiff 使用 isPreviewableFileTool', src.includes('hasDiff: isPreviewableFileTool(exec.name, exec.arguments)'))
ok('系统打开入口已移除（改走 DSH 右侧栏的 file tab）', !src.includes("pathname === '/permgate/open-file'") && !src.includes('const OPEN_TEXT_EXTS') && cli.includes("'permgate:open-file'") === false && cli.includes('openInSidebar(file,'))
ok('侧边栏用当前 GUI 会话身份（不是宿主下发的 exec.session.id）', cli.includes('props.useSessions((st) => (st ? st.current : undefined))') && cli.includes('(props && props.sessionId) || (p && p.sessionId)'))
ok('normTarget 定义 + 五个设置路由统一使用（含 set-category / set-quick）', src.includes('function normTarget(a) {') && (src.match(/const target = normTarget\(a\)/g) || []).length === 5)
ok('pathArg 对 str_replace_editor 取 path（command+path 优先）', src.includes("if (typeof args.command === 'string' && typeof args.path === 'string') return args.path"))

// ─────────────────────────────────────────────────────────────
group('4. 预览：上限、窗口、计数、view_range')
ok('overMaxChars 引用模块级 DIFF_MAX_CHARS', src.indexOf('const DIFF_MAX_CHARS = 1048576') < src.indexOf('export default {') && (src.match(/const DIFF_MAX_CHARS = 1048576/g) || []).length === 1)
ok('previewInsert 只在窗口内构造', src.includes('const winOld = oldLines.slice(winStart, winEnd)') && src.includes('const winNew = winOld.slice(0, k).concat(addedLines, winOld.slice(k))'))
ok('previewInsert 承担校验（含 maxAt）', src.includes('function previewInsert(fp, oldLines, addedLines, at, maxAt) {') && src.includes("if (at > maxAt) return { ok: false, error: bi('插入位置超出文件范围'"))
ok('builtin/shadow 只做口径换算', src.includes('return previewInsert(fp, oldLines, addedLines, insLine, oldLines.length)') && src.includes('return previewInsert(fp, oldLines, addedLines, insLine - 1, maxInsert - 1)'))
ok('countNewlines 定义并用于行号', src.includes('function countNewlines(s, end) {') && src.includes('const lineStart = 1 + countNewlines(baseText, idx)'))
ok('无 split 物化取行号', !src.includes("baseText.slice(0, idx).split('\\n').length"))
ok('view_range 支持 end=-1', src.includes('if (Number.isFinite(ve) && ve === -1) vLimit = MAX_LIMIT'))
ok('view_range 非法组合提示失败', src.includes('Invalid view_range; the command will fail'))
ok('BOM 判定读文件头（readByteRange）', src.includes('fsService.readByteRange(target, { offset: 0, length: 3 }, undefined)'))
ok('BOM 回退判据保留', src.includes("diskHasBom = info.size === Buffer.byteLength(curText, 'utf8') + 3"))
ok('str_replace 唯一性校验不分内核', !src.includes("if (kernel !== 'builtin') {") && src.includes('while (count < 2 && (at = rd.text.indexOf(oldStr, at)) !== -1)'))
ok('insert_line 占位值不折算为 0', src.includes("(rawInsLine === null || rawInsLine === undefined || rawInsLine === '' || rawInsLine === false) ? NaN : Number(rawInsLine)"))

// ─────────────────────────────────────────────────────────────
group('5. 配置迁移与持久化守卫')
ok('projectsFromConfig 只保留当前 root 的 key', src.includes('if (normPathKey(key) !== rootKey) continue') && src.includes('return JSON.stringify({ projects: keep })'))
ok('仅采纳 projects 段（忽略 global）', src.includes('const projects = src.projects && typeof src.projects === \'object\' ? src.projects : null'))
ok('ensureProject 与 projectBlock 同口径（归一化查找）', src.includes('if (norm(k).toLowerCase() === key) return projs[k]'))
ok('迁移读失败不静默（projReadFailed）', src.includes('let projReadFailed = false') && src.includes('projReadFailed = true') && src.includes('Cannot read the project residual config'))
ok('迁移成功后删除源（先落盘成功）', src.includes('if (saved && migratedFromPath) removeMigratedSource(migratedFromPath)'))
ok('删除前 lstat 普通文件 + 双侧 realpath', src.includes('if (!st || !st.isFile()) return false') && src.includes("want = pathJoin(fsRealpathSync(pathResolve(root, '.dsh')), '.permgate.json')") && src.includes('if (normPathKey(real) !== normPathKey(want)) return false'))
ok('configExists 统一（定义 + 4 处调用）', src.includes('async function configExists(fsService, p) {') && (src.match(/configExists\(/g) || []).length === 5)
ok('无内联存在性守卫', !src.includes('let homeExists') && !src.includes('let targetExists') && !src.includes('let projExists'))
ok('persist 基线校验（切换目标后拒绝覆盖）', src.includes("if (lastDiskJson === null && await configExists(fs, t)) {") && src.includes('Config target switched to DSH home'))
ok('persist 读失败按 stat 区分', src.includes('if (await configExists(fs, t) && lastDiskJson !== null) {'))
ok('homePrefix 由 homeTarget 派生（realpath 口径）', src.includes('const homeTarget = homeNow ? await homeConfigTarget(homeNow) : null') && src.includes("const homePrefix = homeTarget ? pathOf(homeTarget).replace("))
ok('persist 分支复用 homeTarget', src.includes('          target = homeTarget') && !/\n {10}target = await homeConfigTarget\(homeNow\)/.test(src))
ok('load 仅在 target 不是 home 配置时才探测', src.includes('if (homeTarget && normPathKey(pathString(homeTarget)) !== normPathKey(pathString(target)))'))
ok('两种 home 错误文案并存', src.includes('Config target is outside the DSH home') && src.includes('DSH home is not ready'))
ok('迁移映射无不可达兜底', !src.includes("map[oldMode] || 'ask'") && !src.includes("map[pm] || 'ask'"))

// ─────────────────────────────────────────────────────────────
group('6. 死代码/口径回归（历轮修掉的写法不得回潮）')
ok('无 osHomedir 恒真三元', !src.includes('osHomedir ? osHomedir()'))
ok('内核兜底不做探测', src.includes("const kernel = entry.editorKernel || 'builtin'") && !src.includes('resolveEditorKernel(null)'))
ok('detectEditorKernel 读 properties 层', src.includes('const props = params && params.properties && typeof params.properties') && !src.includes('params && params.insert_line && typeof params.insert_line.description'))
ok('无未使用的 editTuple 绑定', !/for \(const i of g\.indices\) \{\r?\n\s+const r = editRanges\[i\]\r?\n\s+const raw = args\.edits\[i\]\r?\n\s+const e = editTuple\(raw\)/.test(src))
ok('schema enum 用常量', src.includes("enum: ALL_MODES, description: '兜底动作") && src.includes("enum: EDITOR_KERNEL_VALUES, description: '内核判别方式"))
ok('store 回退只取主键列', src.includes("const keys = db.prepare('SELECT path FROM ' + table).all()"))
ok('无遗留 projectsOnlyFromConfig/mergeMigratedConfig', !src.includes('projectsOnlyFromConfig') && !src.includes('mergeMigratedConfig'))

// ─────────────────────────────────────────────────────────────
group('7. 浏览器半部分：清单以宿主下发为准')
ok('client 清单为可变并保留默认', cli.includes("let CATS = ['directory', 'command', 'read', 'image', 'edit', 'undo', 'subagent', 'doomloop'];") && cli.includes("let EXC_CATS = ['directory', 'command', 'read', 'image', 'edit', 'undo'];"))
ok('client applyStatusLists 覆盖清单', cli.includes('function applyStatusLists(s) {') && cli.includes('applyStatusLists(s);'))
ok('client 读取 status 下发的清单', cli.includes('s.cats') && cli.includes('s.excCats') && cli.includes('s.modes') && cli.includes('s.allModes'))
ok('client 无 editorKernel 残留（面板入口已移除）', !cli.includes('editorKernel') && !cli.includes('set-editor-kernel'))
ok('client set-fallback 通道在', cli.includes("'permgate:set-fallback'") && cli.includes("invoke('permgate:set-fallback'"))

// ─────────────────────────────────────────────────────────────
group('8. 快捷工具面板口径（修好的写法不得回潮）')
ok('client 快捷清单与默认值初始为空、等宿主下发', cli.includes('let QUICK_PRESET = [];') && cli.includes('let QUICK_DEFAULTS = {};'))
ok('client 主动读 status 的 quickPreset/quickDefaults', cli.includes('s.quickPreset') && cli.includes('s.quickDefaults'))
ok('client 不再硬编码任何预设工具名', !cli.includes("'web_search', 'skill'") && !cli.includes("job_kill: 'allow'") && !cli.includes("todo_write: 'allow'"))
ok('快捷工具新增行带动作下拉（与例外行一致）', cli.includes('sel(newToolAction, (e) => setNewToolAction(e.target.value), MODES, busy)') && !cli.includes("action: 'allow' }, () => setNewTool('')"))
ok('存在自有键判定 hasOwnKey', cli.includes('function hasOwnKey(o, k)'))
ok('quick 存在性判断不用原型链写法', !cli.includes("pq[t] && pq[t] !== 'inherit'") && !cli.includes('gq[t] !== undefined'))
ok('删除按钮只给「自加且本层有键」的行', cli.includes('(!isPreset && hasKey)'))
ok('删除不做本地乐观删除', !cli.includes('delete next[tool]'))
ok('确认态 key 含层级', cli.includes("'quick:' + tab + ':' + t"))
ok('切 tab 清空确认态（并丢弃草稿焦点与编辑态）', cli.includes('React.useEffect(() => { setConfirm(null); reasonFocus.current = null; setReasonEditing(null); }, [tab]);'))
ok('兜底文案不再以 todo/cordis 举例', !cli.includes('如 MCP、todo、cordis') && !cli.includes('(e.g. MCP, todo, cordis)'))
ok('自定义规则优先级说明已移除', !cli.includes("'panel.rulesHint'"))
{
  const readmeZh = readFileSync(pathJoin(ROOT, 'README.md'), 'utf8')
  const readmeEn = readFileSync(pathJoin(ROOT, 'README_EN.md'), 'utf8')
  ok('README 不再有兜底策略说明条目', !readmeZh.includes('**兜底策略**') && !readmeEn.includes('**Fallback policy**'))
}

// ─────────────────────────────────────────────────────────────
group('9. 行为复算（纯函数）')
function countNewlines(s, end) {
  const t = String(s == null ? '' : s)
  const n = Math.min(typeof end === 'number' ? end : t.length, t.length)
  let c = 0
  for (let i = 0; i < n; i++) if (t.charCodeAt(i) === 10) c++
  return c
}
let cntOk = true
for (const t of ['', 'a', 'a\nb', 'a\nb\n', '\n\n\nx', 'a\r\nb']) {
  for (let i = 0; i <= t.length; i++) if (t.slice(0, i).split('\n').length !== 1 + countNewlines(t, i)) { cntOk = false; break }
}
ok('countNewlines 与旧公式逐点等价', cntOk)

const W = 200
let winOk = true
for (const [len, at] of [[10, 0], [10, 5], [10, 10], [1000, 0], [1000, 500], [1000, 1000], [401, 200], [1, 0], [1, 1]]) {
  const oldStart0 = Math.max(1, (at + 1) - W) - 1
  const oldEnd0 = Math.min(len, at + W)
  if (oldStart0 !== Math.max(0, at - W) || oldEnd0 !== Math.min(len, at + W)) winOk = false
}
ok('previewInsert 窗口与旧公式等价', winOk)

function projectsFromConfig(srcText, root, npk) {
  try {
    const s = JSON.parse(String(srcText == null ? '' : srcText))
    if (!s || typeof s !== 'object') return null
    const projects = s.projects && typeof s.projects === 'object' ? s.projects : null
    if (!projects) return null
    const rootKey = npk(root)
    const keep = {}
    if (rootKey) for (const k of Object.keys(projects)) { if (npk(k) !== rootKey) continue; keep[k] = projects[k] }
    if (!Object.keys(keep).length) return null
    return JSON.stringify({ projects: keep })
  } catch (e) { return null }
}
const npk = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
ok('迁移保留当前 root 条目', projectsFromConfig(JSON.stringify({ projects: { 'G:/a': { x: 1 }, 'G:/b': { y: 2 } } }), 'G:/a', npk) === JSON.stringify({ projects: { 'G:/a': { x: 1 } } }))
ok('迁移丢弃 UNC key', projectsFromConfig(JSON.stringify({ projects: { '//evil/share': { x: 1 } } }), 'G:/a', npk) === null)
ok('迁移丢弃 global-only', projectsFromConfig(JSON.stringify({ global: { mode: 'permissive' } }), 'G:/a', npk) === null)
ok('迁移对坏 JSON 返回 null', projectsFromConfig('{bad', 'G:/a', npk) === null)

function ensureProjectSim(norm, root, config, fresh) {
  const key = norm(root).toLowerCase()
  const projs = config.projects || {}
  for (const k of Object.keys(projs)) if (norm(k).toLowerCase() === key) return projs[k]
  if (!config.projects) config.projects = {}
  config.projects[root] = fresh()
  return config.projects[root]
}
const normSim = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '')
const cfgA = { projects: { 'g:/mcp': { tag: 'migrated' } } }
ok('ensureProject 复用迁移条目', ensureProjectSim(normSim, 'G:\\MCP', cfgA, () => ({ tag: 'fresh' })).tag === 'migrated')
ok('ensureProject 不新增第二个 key', Object.keys(cfgA.projects).length === 1)
const cfgB = { projects: {} }
ok('ensureProject 无匹配时新建', ensureProjectSim(normSim, 'G:\\MCP', cfgB, () => ({ tag: 'fresh' })).tag === 'fresh')

function pathArgSim(args) {
  try {
    if (!args || typeof args !== 'object') return null
    if (typeof args.command === 'string' && typeof args.path === 'string') return args.path
    if (typeof args.file_path === 'string') return args.file_path
    if (typeof args.path === 'string') return args.path
    return null
  } catch (e) { return null }
}
ok('pathArg: str_replace_editor 取 path', pathArgSim({ command: 'str_replace', path: 'P', file_path: 'F' }) === 'P')
ok('pathArg: write 取 file_path', pathArgSim({ file_path: 'F', path: 'P' }) === 'F')
ok('pathArg: 仅 path', pathArgSim({ path: 'P' }) === 'P')
ok('pathArg: 空参 null', pathArgSim(null) === null && pathArgSim({}) === null)

function viewRangeTo(vsIn, veIn, MAX_LIMIT = 4096) {
  let vOffset, vLimit
  const vs = Number(vsIn), ve = Number(veIn)
  if (Number.isFinite(vs) && vs > 0) {
    vOffset = vs
    if (Number.isFinite(ve) && ve === -1) vLimit = MAX_LIMIT
    else if (Number.isFinite(ve) && ve >= vs) vLimit = ve - vs + 1
    else return { err: 'invalid' }
  }
  return { offset: vOffset, limit: vLimit }
}
ok('view_range [11,12] → 2 行', viewRangeTo(11, 12).limit === 2)
ok('view_range [5,-1] → 到文件尾', viewRangeTo(5, -1).limit === 4096)
ok('view_range [10,3] → 非法', viewRangeTo(10, 3).err === 'invalid')

function storeRowByPathSim(rows, rawPath, want, npk2) {
  const row = rows.find((r) => r.path === String(rawPath || '')) || null
  if (row) return row
  let hit = null
  for (const r of rows) if (npk2(r.path) === want) { hit = r.path; break }
  if (hit === null) return null
  return rows.find((r) => r.path === hit) || null
}
const rowsSim = [{ path: 'D:\\A\\x.txt', content: 'BIG' }]
ok('store 精确命中', storeRowByPathSim(rowsSim, 'D:\\A\\x.txt', npk('D:\\A\\x.txt'), npk).content === 'BIG')
ok('store 大小写 miss 后归一化命中', storeRowByPathSim(rowsSim, 'd:/a/x.txt', npk('d:/a/x.txt'), npk).path === 'D:\\A\\x.txt')
ok('store 无命中返回 null', storeRowByPathSim(rowsSim, 'D:\\C\\z.txt', npk('D:\\C\\z.txt'), npk) === null)

function homeFromEnvSim(env, osHome, isWin) {
  const isWinAbs = (s) => (s.length > 2 && s.charAt(1) === ':' && (s.charCodeAt(2) === 92 || s.charCodeAt(2) === 47)) || (s.charCodeAt(0) === 92 && s.charCodeAt(1) === 92)
  const localAbs = (v) => {
    const s = String(v == null ? '' : v).trim()
    if (!s || !pathIsAbsolute(s)) return null
    if (isWin && !isWinAbs(s)) return null
    return s.replace(/\\/g, '/')
  }
  const dh = localAbs(env.DSH_HOME); if (dh) return dh
  const oh = osHome ? String(osHome).replace(/\\/g, '/') : ''
  if (oh) return oh + '/.dsh'
  const h = localAbs(env.HOME || env.USERPROFILE); if (h) return h + '/.dsh'
  return null
}
const A = process.platform === 'win32' ? 'C:\\a\\.dsh' : '/a/.dsh'
const B = process.platform === 'win32' ? 'C:\\b' : '/b'
const C = process.platform === 'win32' ? 'C:\\c' : '/c'
ok('home: DSH_HOME 优先', homeFromEnvSim({ DSH_HOME: A, HOME: B }, C, process.platform === 'win32').replace(/\\/g, '/') === A.replace(/\\/g, '/'))
ok('home: os.homedir 优先于 HOME', homeFromEnvSim({ HOME: B }, C, process.platform === 'win32').replace(/\\/g, '/') === C.replace(/\\/g, '/') + '/.dsh')
ok('home: 无 osHome 回退 HOME', homeFromEnvSim({ HOME: B }, '', process.platform === 'win32').replace(/\\/g, '/') === B.replace(/\\/g, '/') + '/.dsh')
ok('home: 相对路径被拒', homeFromEnvSim({ DSH_HOME: 'rel/path' }, '', process.platform === 'win32') === null)

// ─────────────────────────────────────────────────────────────
group('10. 读图独立分类（image）口径')
ok('read_image 已从 read 移出、单列 FILE_IMAGE_TOOLS', !src.includes('FILE_READ_TOOLS = { read: 1, read_image: 1 }') && src.includes('const FILE_IMAGE_TOOLS = { read_image: 1 }'))
ok('image 进入分类清单与例外分类清单', src.includes("const CATS = ['directory', 'command', 'read', 'image'") && src.includes("const EXC_CATS = ['directory', 'command', 'read', 'image'"))
ok('decide 里有 image 判定（与 read 同链：工作区外先过目录访问）', src.includes("resolveCategory('image', fp, 'path')") && src.includes('if (isFileImage(name)) {'))
ok('pathToolCat 把 read_image 归到 image（不继承 read）', src.includes("if (isFileImage(name)) return 'image'") && src.includes("if (isFileRead(name, args)) return 'read'"))
ok('image 默认 ask（read/subagent 仍默认 allow）', src.includes("key === 'undo' || key === 'image' || key === 'doomloop' ? 'ask' : 'allow'"))
// 图片嗅探：直接断言解析行为（构造最小文件头），而非只匹配源码里的格式字面量
const sn = mod.sniffImage
const pngHead = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64')
ok('sniffImage: PNG 取 IHDR 宽高', (() => { const r = sn(pngHead); return !!r && r.format === 'png' && r.width === 1 && r.height === 1 })())
const gifHead = Buffer.alloc(32); gifHead.write('GIF89a', 0, 'latin1'); gifHead.writeUInt16LE(10, 6); gifHead.writeUInt16LE(20, 8)
ok('sniffImage: GIF 小端宽高', (() => { const r = sn(gifHead); return !!r && r.format === 'gif' && r.width === 10 && r.height === 20 })())
const jpegHead = Buffer.concat([Buffer.from([0xFF, 0xD8]), Buffer.from([0xFF, 0xE0, 0x00, 0x10]), Buffer.alloc(14, 0), Buffer.from([0xFF, 0xC0, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x20]), Buffer.alloc(20, 1)])
ok('sniffImage: JPEG SOF0 宽高（跨过 APP0 段）', (() => { const r = sn(jpegHead); return !!r && r.format === 'jpeg' && r.width === 32 && r.height === 16 })())
const webpHead = (fourcc) => { const b = Buffer.alloc(64); b.write('RIFF', 0, 'latin1'); b.write('WEBP', 8, 'latin1'); b.write(fourcc, 12, 'latin1'); return b }
const vp8x = webpHead('VP8X'); vp8x.writeUIntLE(99, 24, 3); vp8x.writeUIntLE(49, 27, 3)
const vp8l = webpHead('VP8L'); vp8l[20] = 0x2F; vp8l.writeUInt32LE(((49 + 1) | ((99 + 1) << 14)) >>> 0, 21)
const vp8 = webpHead('VP8 '); vp8.writeUInt16LE(50, 26); vp8.writeUInt16LE(100, 28)
ok('sniffImage: WebP VP8X/VP8L/VP8 三种 chunk 宽高', (() => { const a = sn(vp8x), b = sn(vp8l), c = sn(vp8); return !!a && a.width === 100 && a.height === 50 && !!b && b.width === 51 && b.height === 101 && !!c && c.width === 50 && c.height === 100 })())
ok('sniffImage: 非图片/空缓冲/短缓冲返回 null', sn(Buffer.from('definitely not an image, just text padding to exceed the sniff length\n')) === null && sn(Buffer.alloc(0)) === null && sn(Buffer.alloc(8)) === null)
ok('IMAGE_MIME 覆盖 PNG/JPEG/GIF/WebP', mod.IMAGE_MIME.png === 'image/png' && mod.IMAGE_MIME.jpeg === 'image/jpeg' && mod.IMAGE_MIME.gif === 'image/gif' && mod.IMAGE_MIME.webp === 'image/webp')
ok('isFileImage 只认 read_image', mod.isFileImage('read_image') === true && mod.isFileImage('read') === false && mod.isFileImage('str_replace_editor') === false)
// 防回退：工作区外读图必须走 directory+image 合并矩阵单点，不得再用 directory 的动作短路 image 分类
ok('工作区外读图走合并矩阵单点（不被 directory 短路）', /if \(isFileImage\(name\)\)[\s\S]{0,400}?outsideMatrix\('image', fp\)/.test(src) && !/if \(isFileImage\(name\)\)[\s\S]{0,400}?return \{ action: d\.action, reason: bi\('目录权限/.test(src))
// 防回退：read 也必须走合并矩阵（deny 例外与 read=ask 在跨工作区时必须生效）
ok('工作区外读文件走合并矩阵单点（不被 directory 短路）', /if \(isFileRead\(name, args\)\)[\s\S]{0,400}?outsideMatrix\('read', fp\)/.test(src))
ok('read/image/edit/undo 共用工作区外合并矩阵单点', (src.match(/outsideMatrix\('/g) || []).length === 4)
ok('缩略图有体积上限', src.includes('const IMAGE_MAX_BYTES = 2 * 1024 * 1024'))
ok('读图的文本预览分支已移除', !src.includes('图片内容不在此预览'))
ok('client 有图片渲染块与文案', cli.includes('function ImageBlock({ data, onOpenSidebar })') && cli.includes("'app.imageTooLarge'") && cli.includes('catS.image'))
ok('面板 chips 含 image', cli.includes("chip(catShort('image'), eff.image)"))
// 防回退：image 不套用老模式迁移（off/permissive→ask、locked→deny），不能变回 allow
ok('迁移不把老模式套到 image 上', src.includes("c === 'image' ? (oldMode === 'locked' ? 'deny' : 'ask')") && !src.includes('for (const c of CATS) cfg.global[c].mode = map[oldMode] || \'allow\''))
// 防回退：imagePreview 字段已废弃（客户端不再据它分流，详情看 hasDiff），不得回潮
ok('pending 不再下发已废弃的 imagePreview 标记', !src.includes('imagePreview') && !cli.includes('imagePreview'))
ok('图片详情默认展开并自动预取（读图时直接看到缩略图）', cli.includes("openDetail[p.id] === undefined ? !!p.hasDiff") && !cli.includes('!p.imagePreview') && !cli.includes('p.imagePreview && !userOpened'))
// 防回退：工作区外审批给两条候选（整个目录 / 仅此文件），且「仅此文件」写两条例外（自身分类 + 目录精确路径）
ok('工作区外 path 审批给两条候选', src.includes("const outsideHere = !!(catKey && catKey !== 'directory' && isOutside(entry.value, root))") && src.includes('function pathToolCat(name, args)') && src.includes('toolCat: pathToolCat(exec.name, exec.arguments)'))
ok('「仅允许此文件」写自身分类 + 目录精确路径两条例外（值取归一化路径）', src.includes("{ cat: catKey, kind: 'path', value: fileVal }, { cat: 'directory', kind: 'path', value: fileVal }") && src.includes('const cand = r.id ? (entry.candidates || []).find((c) => c.id === r.id) : null') && cli.includes('({ id: c.id, value: c.value, kind: c.kind, decision: sel[c.id] })'))
ok('「整个目录」同时写目录闸与自身分类的 glob', src.includes("{ cat: 'directory', kind: 'path', value: glob }, { cat: catKey, kind: 'path', value: glob }") && src.includes('const hasKindGlob = globSafe && alreadyInProject(glob'))
// 防回退：缩略图像素上限、落盘分类/类型自洽、reason 前缀跟随决定闸、read 复用预检单点
ok('缩略图有像素/边长上限（16MP / 4096），尺寸未知时一律不内联', src.includes('const IMAGE_MAX_PIXELS = 16 * 1000 * 1000') && src.includes('const IMAGE_MAX_DIM = 4096') && src.includes('const pixelOver = !!(sizeKnown && (') && src.includes('if (!sizeKnown) { out.sizeUnknown = true; return out }'))
ok('拒绝候选不落 directory 例外（单点过滤，候选与旧形态共用）', src.includes('const writeException = (cat, kind, value, decision)') && src.includes("if (decision === 'deny' && cat === 'directory') return") && (src.match(/writeException\(/g) || []).length === 2 && !src.includes("w.cat === 'directory') continue"))
ok('同值相反 action 不再静默覆盖历史例外（守卫按同向判定）', (src.match(/findIndex\(\(r\) => r\.match === value && r\.action === decision\)/g) || []).length === 1 && src.includes('pathKey(r.path) === pathKey(value) && r.action === decision') && !src.includes('idx !== -1 && c.exceptions[idx].action === decision') && src.includes('const item = build({ path: normAbsPath(value) })') && src.includes('const item = build({ match: value })'))
ok('面板与工具写入统一走 addProjectException（不再尾部 push）', (src.match(/addProjectException\(a\.category|addProjectException\(args\.category/g) || []).length === 2 && !src.includes('block[a.category].exceptions.push(e)') && !src.includes('block[args.category].exceptions.push(e)'))
ok('含通配符/.. 的原文不生成目录 glob 候选（守卫作用于原始值）', src.includes('const hasParentSeg =') && src.includes('const globSafe = !hasGlobMeta(entry.value) && !hasParentSeg(entry.value)'))
ok('预算内图片只读一次盘（嗅探与内联共用缓冲）', src.includes('whole = await fsService.readBytes(target, undefined, IMAGE_MAX_BYTES)') && src.includes('const bytes = whole || await fsService.readBytes'))
ok('写入缺省作用域与删除侧一致（缺省全局，候选显式项目块）', src.includes("const target = o.target === 'project' ? 'project' : 'global'") && src.includes("addProjectException(cat, kind, value, decision, { target: 'project' })") && !src.includes('function addProjectRule'))
ok('reason 与 normalizeException 同口径（仅 deny、共用 normalizeText）', src.includes("const reason = decision === 'deny' ? normalizeText(o.reason) : undefined"))
ok('整读后直接用整份缓冲嗅探', src.includes('sniffImage(whole || head)'))
ok('不可达的 directory else-if 候选分支已删除', !src.includes("else if (entry.cat === 'directory')"))
ok('范围说明下移到候选小字（hint），标题下只留一句话', !src.includes('允许时同时写入') && src.includes("t('工作区外访问目录 + '") && src.includes("t('工作区外访问文件 + '") && cli.includes("'app.cand.hint': '点亮条目后点「允许 / 拒绝」即写入当前项目例外。'") && cli.includes('c.hint ? React.createElement'))
ok('拒绝态收起 allow 勾选、取消时恢复并清快照（不再只是置灰变浅）', cli.includes('const [denySaved, setDenySaved]') && cli.includes('const snap = denySaved[p.id]') && cli.includes('setDenySaved(Object.assign({}, denySaved, { [p.id]: snap }))') && cli.includes('if (snap && Object.keys(snap).length) setSel(Object.assign({}, sel, snap))') && (cli.match(/delete rest\[p\.id\]/g) || []).length === 2 && cli.includes('RADIO_DISABLED_CSS') && !cli.includes('const muted = v ==='))
ok('同向去重按「同值 + 同向」判定（方向交替不再累积）', src.includes('const idx = c.exceptions.findIndex((r) => pathKey(r.path) === pathKey(value) && r.action === decision)') && src.includes('const idx = c.exceptions.findIndex((r) => r.match === value && r.action === decision)'))
ok('拒绝只提交 deny 方向规则，服务端二次拦截', cli.includes('const pickedDenyRules = (p) => pickedRules(p).filter((r) => r.decision === \'deny\')') && cli.includes("decide(p.id, 'deny', pickedDenyRules(p), reason || undefined)") && cli.includes('const enterDeny = (p) =>') && src.includes("if (!allow && r.decision === 'allow') continue"))
ok('hasGlobMeta 只拦 * 与 ?（[ ] 是字面量）', src.includes('const hasGlobMeta = (p) => /[*?]/.test(String(p || \'\'))'))
ok('例外落盘校验分类与类型自洽', src.includes("if (kind === 'path' && cat && cat !== 'command' && EXC_CATS.indexOf(cat) !== -1)") && src.includes("if (kind === 'command' && cat === 'command')") && src.includes('if (!p) return false'))
ok('工作区外 reason 前缀跟随决定闸', src.includes('const OUTSIDE_PREFIX = {') && (src.match(/m\.pz \+ /g) || []).length === 12)
ok('工作区外 allow 的 cat 与 ruleId 同源（不再硬编码 catKey）', src.includes("const cat = src === d ? 'directory' : catKey") && !src.includes("return { action: 'allow', src: d.ruleId ? d : (e.ruleId ? e : null), cat: catKey"))
ok('read/image 详情复用预检单点且跳过体积闸', (src.match(/skipSizeCheck: true/g) || []).length === 2)
// 防回退：路径先规范化再判定（含 .. 的原文会写出不生效的例外）；文件级判重按候选要写的全部分类；
// 通配符仍由 hasGlobMeta 拦下。旧形态（无 id）按 value 反查候选复用 writes
ok('路径两侧同口径 + 文件级候选按全部分类判重 + 通配符仍拦', src.includes('function normAbsPath(p)') && src.includes('const absVal = hasGlobMeta(entry.value) ? norm(entry.value) : normAbsPath(entry.value)') && src.includes('return matchGlob(normAbsPath(r.path), normAbsPath(value))') && src.includes('const fileWrites = [{ cat: catKey, kind: \'path\', value: fileVal }, { cat: \'directory\', kind: \'path\', value: fileVal }]') && src.includes('fileWrites.every((w) => alreadyInProject(w.value, \'path\', w.cat))') && src.includes('const hasGlobMeta = (p) =>'))
ok('旧形态 rules 按 value 反查候选复用 writes', src.includes('const byValue = (entry.candidates || []).find((c) => c.value === String(r.value))'))
// 防回退：例外删除必须是单点且严格按 id 删除，并回传同路径剩余条目数供 UI 提示
ok('例外删除严格按 id 并回传 remaining', src.includes('function removeExceptionEntries(block, catKey, id)') && (src.match(/removeExceptionEntries\(block, (a|args)\.category/g) || []).length === 2 && src.includes('const kept = c.exceptions.filter((r) => r.id !== id)') && src.includes('return { removed: true, count, remaining, exception: target }') && !src.includes('const kept = c.exceptions.filter((r) => !(r[key] === value'))
ok('图片 base64 用视图避免整份字节拷贝', src.includes('Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)'))
ok('两条候选主文案是纯路径、范围各走 hint（目录 / 文件）', src.includes("push(glob, glob, 'path',") && src.includes("push(fileVal, fileVal, 'path',") && src.includes("工作区外访问目录 + ") && src.includes("工作区外访问文件 + ") && !src.includes("'整个目录：'") && !src.includes("'仅此文件：'"))
ok('dirGlob 盘根直接拼 /*（不再产生匹配不到的 G://*）', src.includes("if (/^[a-zA-Z]:$/.test(dir)) return dir + '/*'") && !src.includes("if (/^[a-zA-Z]:$/.test(dir)) dir += '/'") )
ok('choice 路径复用例外写入单点', src.includes("addProjectException(entry.cat, 'path', String(entry.value), action, { target })") && src.includes("addProjectException('command', 'command', String(entry.value), action, { target })") && !src.includes('cat.exceptions[idx].action = action'))
ok('客户端删除用返回 promise 的 call 并反馈结果', cli.includes("call('permgate:remove-exception', { target: tab, category: c, id })") && !cli.includes("invoke('permgate:remove-exception'") && cli.includes("T('panel.delFailed')"))
ok('同向去重命中后把条目提到头部并回写文字', src.includes('const hit = c.exceptions.splice(idx, 1)[0]') && (src.match(/c\.exceptions\.unshift\(hit\)/g) || []).length === 2 && src.includes('textPatch(hit)'))
ok('choice 路径不再套用候选的 deny-directory 过滤', !src.includes("if (!(action === 'deny' && entry.cat === 'directory'))"))
// ─────────────────────────────────────────────────────────────
group('11. 权限元操作纳入管控（issue #3：perm_* 曾无条件放行）')
ok('decide 不再硬编码放行 perm_*', !src.includes("name.indexOf('perm_') === 0) {") && !src.includes('permgate management tool, always allowed'))
{
  // 少一个都会让「AI 自我提权」重新变成静默操作，故按清单整体校验
  const ASK_TOOLS = ['perm_set_category', 'perm_set_fallback', 'perm_set_editor_kernel', 'perm_add_exception', 'perm_remove_exception', 'perm_set_quick', 'perm_add_rule', 'perm_remove_rule', 'perm_reload', 'cordis_run', 'cordis_stop', 'cordis_undefine']
  const missing = ASK_TOOLS.filter((t) => !new RegExp('\\b' + t + ": 'ask'").test(src))
  ok('改权限/管插件的元操作全部纳入快捷预设且默认 ask', missing.length === 0, JSON.stringify(missing))
  // perm_status 只读查询：明确放宽为 allow，防止被顺手改回 ask
  ok('perm_status 默认 allow（只读查询不弹窗）', src.includes("perm_status: 'allow'"))
}
ok('面板为新工具补了用途说明（中英）', cli.includes("'quick.perm_add_exception': '添加例外'") && cli.includes("'quick.cordis_run': '运行动态插件'") && cli.includes("'quick.perm_add_exception': 'add an exception'"))

// ─────────────────────────────────────────────────────────────
group('12. 审批弹窗候选文案与路径口径')
ok('候选分类标签与设置面板一致（不再写「写入/编辑」）', !src.includes("'写入/编辑'") && src.includes("edit: ['编辑文件', 'file edits']"))
ok('两条候选路径写法一致（均取规范化绝对路径）', src.includes('const absVal = normAbsPath(entry.value)') && src.includes('const fileVal = absVal') && src.includes("push(fileVal, fileVal, 'path',") && !src.includes(") + entry.value, entry.value, 'path'"))
ok('判重/去重/匹配三处共用 pathKey（同一路径不同写法不重复写入、且能命中）', src.includes('function pathKey(p)') && src.includes('return normPathKey(normAbsPath(p))') && src.includes('pathKey(r.path) === pathKey(value)') && (function () { const i = src.indexOf('function normAbsPath'); const j = src.indexOf('function pathKey'); return i >= 0 && j > i && src.slice(i, j).indexOf("indexOf('://')") !== -1 })())
ok('相对 glob 不被绝对化（glob 不是文件路径，只做斜杠归一）', (function () { const i = src.indexOf('function normAbsPath'); const j = src.indexOf('function pathKey'); const body = i >= 0 && j > i ? src.slice(i, j) : ''; return body.indexOf('if (/[*?]/.test(s)) return s') !== -1 && body.indexOf('glob 不是文件路径') !== -1 })())

// ─────────────────────────────────────────────────────────────
group('13. 例外三态（ask / allow / deny）：ask 是可写、可命中的一等动作')
// 防回退：normalizeException 曾用 MODES 校验（已含 ask），但 reason 只认 deny、面板只给 allow/deny
// reason 与 note 必须保持两个字段：前者是回给 AI 的拒绝原因，后者是命中时显示在弹窗上供日后回看的备注，不可合并
ok('reason（deny→AI）与 note（ask→弹窗备注）按动作各归其位', src.includes("if (r.action === 'deny') { const t = normalizeText(r.reason); if (t) e.reason = t }") && src.includes("if (r.action === 'ask') { const t = normalizeText(r.note); if (t) e.note = t }") && !src.includes("if (r.action !== 'allow' && typeof r.reason === 'string'"))
ok('resolveCategory 按动作分别带回 reason / note', (src.match(/reason: \(r\.action === 'deny' && r\.reason\) \? r\.reason : undefined, note: \(r\.action === 'ask' && r\.note\) \? r\.note : undefined/g) || []).length === 2)
ok('exReason/exReasonEn 按动作取对应字段（ask 用 note）', src.includes("if (d && d.action === 'deny' && d.reason) return '（' + d.reason + '）'") && src.includes("if (d && d.action === 'ask' && d.note) return '（' + d.note + '）'") && src.includes("if (d && d.action === 'ask' && d.note) return ' (' + d.note + ')'"))
ok('落盘时 reason 只随 deny、note 只随 ask（allow 两者都不存）', src.includes("const reason = decision === 'deny' ? normalizeText(o.reason) : undefined") && src.includes("const note = decision === 'ask' ? normalizeText(o.note) : undefined") && src.includes('reason ? { reason } : {}, note ? { note } : {}'))
// 防回退：addProjectException 曾自建一份 trim200（会对非字符串 String() 强转），与 normalizeText 分叉
ok('例外落盘与 normalizeException 共用 normalizeText 单点（不再有第二份 trim200）', !src.includes('const trim200 =') && src.includes("const reason = decision === 'deny' ? normalizeText(o.reason) : undefined"))
ok('同向去重命中后用 textPatch 回写（reason/note 各写各的）', src.includes('const textPatch = (hit) => {') && (src.match(/textPatch\(hit\)/g) || []).length === 2 && (src.match(/if \(reason\) hit\.reason = reason/g) || []).length === 1 && (src.match(/if \(note\) hit\.note = note/g) || []).length === 1)
ok('工作区外 ask 分支回传例外来源（cat/ruleId 与文案同源）', src.includes("const src = (d.action === 'ask' && d.ruleId) ? d : ((e.action === 'ask' && e.ruleId) ? e : null)") && (src.match(/m\.src \? m\.src\.ruleId : null/g) || []).length === 8)
ok('工作区外 ask 的文案在有例外时用例外备注、无例外时回落「需确认」', (src.match(/m\.src \? exReason\(m\.src\) : '（需确认）'/g) || []).length === 3 && src.includes("m.src ? exReason(m.src) : '（写入需确认）'"))
ok('面板例外动作下拉复用宿主下发的 MODES（三态，不再硬编码两项）', cli.includes('sel(exAction, (e) => setExAction(e.target.value), MODES, busy)') && !cli.includes("React.createElement('option', { value: 'allow' }, T('panel.allow'))"))
ok('面板两个输入框按动作二选一（deny→拒绝原因，ask→说明）', cli.includes("exAction === 'deny' ? React.createElement('input', { className: 'pg-field', style: { maxWidth: 220 }, placeholder: T('panel.excReasonPh')") && cli.includes("exAction === 'ask' ? React.createElement('input', { className: 'pg-field', style: { maxWidth: 220 }, placeholder: T('panel.excNotePh')"))
ok('面板按动作分派 reason / note 两个字段', cli.includes("reason: exAction === 'deny' ? (String(exReasonVal || '').trim() || undefined) : undefined") && cli.includes("note: exAction === 'ask' ? (String(exNoteVal || '').trim() || undefined) : undefined") && cli.includes('const [exNoteVal, setExNoteVal] = React.useState'))
ok('例外列表把 reason 与 note 分开显示（拒绝红 / 备注灰）', cli.includes("r.reason ? React.createElement('span', { style: { fontSize: 12, color: MODE_COLORS.deny") && cli.includes("r.note ? React.createElement('span', { style: { fontSize: 12, color: 'rgba(128,128,128,0.9)'"))
ok('perm_add_exception 的 action 枚举含 ask（工具与文档同口径）', src.includes("action: { type: 'string', required: true, enum: ['ask', 'allow', 'deny'], description: '命中例外后的动作' }") && src.includes('ask=命中即弹审批') && !src.includes('例外优先于分类默认动作，仅 allow/deny'))
ok('perm_add_exception 的 reason/note 参数说明各自讲清用途', src.includes('拒绝原因，仅 deny 例外生效：拒绝时会回给 AI') && src.includes('备注，仅 ask 例外生效：命中时显示在审批弹窗上') && src.includes('不是保密字段'))
ok('面板文案保持两种用途分开（拒绝原因 vs 备注）', cli.includes("'panel.excReason': '拒绝原因'") && cli.includes("'panel.excNote': '备注'") && cli.includes("'panel.excReasonPh': '选填：会告知 AI 为什么被拒'") && cli.includes("'panel.excNotePh': '选填：命中时显示在弹窗上，勿写敏感信息'"))
// 防回退：note 是给人看的备注、不是保密字段，注释/文案不得再承诺「AI 看不到」（配置会随 perm_status 下发）；
// 「给自己看」同样在扫描范围内——它暗示了排他性，与「AI 读得到」的口径冲突，统一改成「方便日后回看」。
ok('note 不再被描述为「AI 看不到」的保密字段', !src.includes('绝不回给 AI') && !cli.includes('仅自己可见的备注') && !cli.includes('不会回给 AI') && !cli.includes('给自己看') && !src.includes('给自己看'))

// ─────────────────────────────────────────────────────────────
group('14. 拒绝原因（reason）扩展到「默认动作」层级：分类 / 兜底 / 快捷工具')
// 口径：reason（拒绝原因，回给 AI）属于所有默认动作层级；note（备注，给自己）只属于 ask 例外。
// 防回退：这三处曾经完全没有 reason 字段，只有例外能写。
ok('分类默认值可带拒绝原因，且只在 deny 时保留', src.includes("if (cat.mode === 'deny') { const t = normalizeText(c.reason); if (t) cat.reason = t }") && src.includes("if (reason === undefined) return true") && src.includes('else delete block[cat].reason'))
// 防回退：写入单点曾把「未提供 reason」当成「清除 reason」，一次无关写入就会静默删掉用户写好的原因
ok('未提供 reason 时保留原值（不再把 undefined 当成清除）', (src.match(/if \(reason === undefined\) return true/g) || []).length === 2 && src.includes("const t = reason === undefined ? prevReason : normalizeText(reason)"))
ok('resolveCategory 的 reason 与 mode 同源取用（项目 inherit 才穿透全局）', src.includes("if (pv && pv !== 'inherit') return { action: pv, ruleId: null, reason: normalizeText(pCat.reason) }") && src.includes("return { action: gCat.mode || 'allow', ruleId: null, reason: normalizeText(gCat.reason) }"))
ok('兜底 mode 与 reason 同源（fallbackSetting 单点）', src.includes('function fallbackSetting() {') && src.includes("if (pv && pv !== 'inherit') return { mode: pv, reason: normalizeText(proj.fallbackReason) }") && src.includes("return { mode: config.global.fallbackMode || 'ask', reason: normalizeText(config.global.fallbackReason) }") && src.includes('return fallbackSetting().mode'))
ok('兜底拒绝原因落盘并在切离 deny 时清除', src.includes("if (t) block.fallbackReason = t") && src.includes('else delete block.fallbackReason') && src.includes("if (mode !== 'deny') { delete block.fallbackReason; return true }") && src.includes("if (gFb === 'deny') { const t = normalizeText(g.fallbackReason); if (t) global.fallbackReason = t }"))
ok('快捷工具改为 { action, reason? } 对象形态，老字符串由单一入口收敛', src.includes('function normalizeQuickEntry(v) {') && src.includes("const raw = typeof v === 'string' ? { action: v } : (v && typeof v === 'object' ? v : null)") && src.includes("if (raw.action === 'deny') { const t = normalizeText(raw.reason); if (t) out.reason = t }"))
ok('快捷工具读写各自单一入口（不再各处直接赋值）', src.includes('function setQuickAction(targetKey, tool, action, reason) {') && (src.match(/setQuickAction\(/g) || []).length === 4 && !src.includes('block.quickTools[a.tool] = a.action') && !src.includes('block.quickTools[args.tool] = args.action') && !src.includes('block.quickTools[entry.tool] = action'))
ok('quickAction 用取值函数取值，并保留防御性字符串回退（防非对象形态产出非法 action）', src.includes("const modeOf = (v) => (v && typeof v === 'object' ? v.action : v)") && src.includes("const reasonOf = (v) => (v && typeof v === 'object' ? v.reason : undefined)") && src.includes("return { action: modeOf(pMap[k]), reason: reasonOf(pMap[k]) }"))
ok('三处 reason 都拼进回给 AI 的拒绝文案', src.includes("const qr = q.action === 'deny' && q.reason ? '（' + q.reason + '）' : ''") && src.includes("const fr = fb.mode === 'deny' && fb.reason ? '（' + fb.reason + '）' : ''") && src.includes("' 次相同调用' + exReason(d)"))
ok('perm_set_category / set_fallback / set_quick 都收 reason 参数', src.includes("reason: { type: 'string', description: '拒绝原因，仅 mode=deny 生效：该分类被拒时回给 AI") && src.includes("reason: { type: 'string', description: '拒绝原因，仅 mode=deny 生效：被兜底拒绝时回给 AI") && src.includes("reason: { type: 'string', description: '拒绝原因，仅 action=deny 生效：该工具被拒时回给 AI"))
ok('status 下发三处的 reason（面板回填用）', src.includes('globalReason: normalizeText(config.global.fallbackReason) || null') && src.includes('projectReason: normalizeText(proj && proj.fallbackReason) || null'))
ok('面板各处共用同一个 reasonInput 渲染函数（分类/快捷工具/兜底/快捷工具新增行）', cli.includes('const reasonInput = (value, onChange, onCommit, show, focus, onCancel) => {') && (cli.match(/reasonInput\(/g) || []).length === 4)
// 防回退：快捷工具行的原因输入框必须在动作下拉**之后**——该行工具名 span 有 minWidth 撑出固定
// 列宽，输入框插在它前面会把下拉右推（窄面板下换行），只有选「拒绝」的行会漂移。
ok('快捷工具行的原因输入框排在动作下拉之后（否则下拉位置漂移）', (function () { const i = cli.indexOf('const quickRow = (t) =>'); const j = cli.indexOf('const ruleRow = (r) =>'); const body = i >= 0 && j > i ? cli.slice(i, j) : ''; const a = body.indexOf('sel(mode, changeQuick(t)'); const b = body.indexOf('reasonInput('); return a !== -1 && b !== -1 && a < b })())
// 防回退：新增行选了拒绝却无处填原因，只能先添加再补填。
// 注意空值必须折叠成 undefined：新增行可以输入本层已存在的工具名，而宿主把「空串」定义为
// 显式清除——用户没填原因就点「添加」，会静默删掉该键已保存的拒绝原因（改动前不传 reason 则保留）。
ok('快捷工具新增行也带拒绝原因输入框并下发 reason（空值折叠为未提供）', cli.includes('const [newToolReason, setNewToolReason] = React.useState') && cli.includes("reason: newToolAction === 'deny' ? (String(newToolReason || '').trim() || undefined) : undefined") && cli.includes("() => { setNewTool(''); setNewToolReason(''); }"))
// 防回退：输入框曾「永远可编辑 + 只在失焦时保存」，界面没有任何状态提示，用户填完不知道算不算数。
// 现在改为只读展示 + 编辑/保存两态按钮：当前值可见、「改了有没有生效」有确定答案。
ok('拒绝原因默认只读，点「编辑」才可输入（按钮变保存/取消）', cli.includes('const [reasonEditing, setReasonEditing] = React.useState(null)') && cli.includes("btn(T('panel.reasonEdit'), beginEdit)") && cli.includes("btn(T('panel.reasonSave'), () => { onCommit(focus); endEdit(); })") && cli.includes("btn(T('panel.cancel'), () => { onCancel(); endEdit(); })"))
ok('只读态显示当前原因、未设置时给灰色占位（不留空）', cli.includes("}, txt || T('panel.denyReasonNone')),") && cli.includes("color: txt ? 'inherit' : 'rgba(128,128,128,0.8)'"))
// 防回退：占位文案必须说清「未设置的是什么」——只写「未设置」时用户不知道指哪个字段
ok('未设置占位文案点明字段与后果', cli.includes("'panel.denyReasonNone': '未设置拒绝原因，将用默认原因'") && cli.includes("'panel.denyReasonNone': 'no reason set; default is used'"))
ok('回车即保存并给出「已保存」反馈', cli.includes("if (e.key === 'Enter') { e.preventDefault(); onCommit(focus); endEdit(); }") && cli.includes("'✓ ' + T('panel.reasonSaved')") && cli.includes("'panel.denyReasonHint'") && cli.includes('const [reasonSaved, setReasonSaved] = React.useState(null)'))
// 防回退：取消必须还原成服务端当前值，而不是清空——用户可能只是改错了想放弃，清空等于误删。
// 三处（cat / quick / fb）都要断言取值表达式，且必须**限定在 revertReason 函数体内**：
// `commitQuickReason` 里存在一模一样的 map 表达式、`commitCatReason` 里也有同形的 categories 取值，
// 若只做全文 cli.includes(...)，改坏 revertReason 那一份时另一份仍会让断言为真（实测空转）。
ok('取消编辑还原服务端当前值（不是清空）——三处取值口径齐全', (function () {
  const body = cli.slice(cli.indexOf('const revertReason = (kind, key) =>'), cli.indexOf('const exitEditOf = (kind, key) =>'));
  return body.includes("const block = status && status.categories && status.categories[tab] ? status.categories[tab] : null;")
    && body.includes("const cur = (block && block[key] && block[key].reason) || ''")
    && body.includes("const map = tab === 'global' ? (status && status.quickTools && status.quickTools.global) : (status && status.quickTools && status.quickTools.project);")
    && body.includes("const cur = map && map[key] && typeof map[key] === 'object' ? (map[key].reason || '') : ''")
    && body.includes("const cur = (status && status.fallback && (tab === 'global' ? status.fallback.globalReason : status.fallback.projectReason)) || ''");
})())
// 防回退：后台 status 推送（AI 改权限 / 配置重载 / 会话事件）会用服务端值整表重建三份 reason state，
// 若不保留聚焦中的草稿，用户「已输入未失焦」的文字会被静默清空（注释曾宣称不会，实际会）。
ok('聚焦中的拒绝原因草稿不被 status 回填覆盖（且仅在输入框仍可见时兜住）', cli.includes('const reasonFocus = React.useRef(null)') && cli.includes('const focusNow = reasonFocus.current') && cli.includes("focusNow.kind === 'cat'") && cli.includes("focusNow.kind === 'quick'") && cli.includes("focusNow.kind === 'fb'") && cli.includes("cs[focusNow.tab][focusNow.key] === 'deny'") && cli.includes("qs[focusNow.key][sub] === 'deny'") && cli.includes("fbShow[focusNow.tab] === 'deny'") && cli.includes('reasonFocus.current = focus'))
// 防回退：兜底可见性判据必须取 fallbackMode，不能误用存原因文本的 fbNext（那会让兜底草稿保护形同虚设）
ok('兜底草稿判据取 fallbackMode 而非原因文本', cli.includes("const fbShow = {") && !cli.includes("fbNext[focusNow.tab] === 'deny'"))
// 防回退：面板全局列若不跳过 inherit，select 会拿到不在选项内的值（显示空白），与实际裁决分叉
ok('面板全局列与服务端同径跳过 inherit', cli.includes("hasOwnKey(gq, t) && quickMode(gq[t]) !== 'inherit'"))
// 防回退：面板曾用 `|| undefined` 把清空产生的空串折叠成 undefined，而宿主把 undefined 解释为
// 「保留原值」——用户于是永远删不掉写错的拒绝原因（旧文字还会被 applyStatus 回填）。
// 空串必须原样下发才能命中宿主的「显式清除」分支。
ok('面板清空拒绝原因时透传空串（不折叠成 undefined）', cli.includes('const v = catReasons[tab] ? catReasons[tab][c] : undefined') && cli.includes('const v = fbReason[tab]') && cli.includes('const v = quickReason[tool] ? quickReason[tool][key] : undefined') && cli.includes("mode: 'deny', reason: v }") && cli.includes("action: 'deny', reason: v }") && !cli.includes('catReasons[tab][c] || undefined') && !cli.includes('fbReason[tab] || undefined') && !cli.includes('quickReason[tool][key] || undefined'))
// 防回退：只固定中间变量声明是不够的——把下发字段改成 `reason: v || undefined` 时，
// 上面的 `const v = ...` 仍在，断言会空转。故必须同时校验真正下发的三个字段。
ok('三处下发字段确实原样透传 v（不是只声明了 v）', (cli.match(/reason: v \}/g) || []).length === 3)
// 防回退：对勾曾在 invoke 之前无条件点亮，写盘失败（r.error / catch 只 setMsg）时界面
// 仍显示「✓ 已保存」，与错误信息并存。必须由成功回调点亮。
ok('「已保存」对勾只在写盘成功回调里点亮', (cli.match(/\(\) => markReasonSaved\(focus\)/g) || []).length === 3 && !cli.includes('setReasonSaved(reasonKeyOf(focus));'))
// 防回退：同一格连续保存两次时，若 reasonSaved 只存稳定字符串键，第二次 setState 会 bail out，
// 旧定时器不重置、对勾按第一次的时间点提前消失。带 seq 才能每次产生新身份。
ok('对勾状态带 seq，避免同格二次保存被 React bail out', cli.includes('const reasonSavedSeq = React.useRef(0)') && cli.includes('setReasonSaved({ key: reasonKeyOf(f), seq: reasonSavedSeq.current })') && cli.includes('reasonSaved.key === fk'))
// 防回退：回车保存必须排除输入法组合态，否则中文用户按回车确认候选词会提交未上屏的拼音串。
// 必须断言**完整语句含 return**：只匹配 isComposing 子串时，把 `return;` 换成 `;` 就能让守卫
// 彻底失效而断言仍通过（守卫形同虚设，但测试全绿）。
ok('回车保存排除输入法组合态（isComposing / keyCode 229，且确实 return）', cli.includes('if (e.nativeEvent && (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229)) return;'))
// 防回退：退出编辑态曾用 setReasonEditing(null) 不分格地清掉全部格，且不清 reasonFocus，
// 于是别的行退回只读态却仍被草稿保护兜住，长期显示未落盘的草稿。必须按格退出并同步清焦点。
// 注意要断言**函数体**：只固定函数名与调用点时，保留外壳、把函数体掏回旧的全局语义即可绕过
// （实测该变异会让「改 A 行下拉误关 B 行编辑态」回归，而断言仍全绿）。
ok('退出编辑态按格进行并同步清焦点（exitEditOf）', cli.includes('const exitEditOf = (kind, key) => {') && cli.includes('setReasonEditing((cur) => (cur === fk ? null : cur));') && cli.includes('if (reasonKeyOf(reasonFocus.current) === fk) {') && cli.includes('revertReason(kind, key);') && cli.includes("if (mode !== 'deny') exitEditOf('cat', c);") && cli.includes("if (mode !== 'deny') exitEditOf('quick', tool);") && cli.includes("if (mode !== 'deny') exitEditOf('fb', null);") && !cli.includes("if (mode !== 'deny') setReasonEditing(null);"))
// 防回退：点另一格「编辑」时，前一格未保存的草稿既不提交也不该被静默丢弃（旧版是失焦即保存，
// 用户会以为已写入）。必须按「取消」口径还原成服务端值。
ok('切到另一格编辑前先还原前一格草稿', cli.includes('const beginEdit = () => {') && cli.includes('if (prevF && reasonKeyOf(prevF) !== fk) revertReason(prevF.kind, prevF.key);'))
// 防回退：三处「取消」与 exitEditOf 共用同一份还原逻辑，取值口径须与服务端同源
// （1 处定义 + 4 处调用：三处取消 + exitEditOf 内部）
ok('取消/退出编辑共用单一还原入口（revertReason）', cli.includes('const revertReason = (kind, key) => {') && (cli.match(/revertReason\(/g) || []).length === 5 && !cli.includes('setCatReasons(Object.assign({}, catReasons, { [tab]: Object.assign({}, catReasons[tab], { [c]: (block'))
// 防回退：只数调用次数是不够的——quick 分支的三要素（tab→global/project 表选择、legacy 对象守卫、
// 写回 setQuickReason 的 sub 桶）必须逐项固定。同样必须限定在 revertReason 函数体内：
// 这三要素里的 map 表达式在 commitQuickReason 中重复出现，全文匹配会空转（实测漏网）。
ok('revertReason 的 quick 分支：表选择 / 对象守卫 / 写回 sub 桶三要素齐全', (function () {
  const body = cli.slice(cli.indexOf('const revertReason = (kind, key) =>'), cli.indexOf('const exitEditOf = (kind, key) =>'));
  return body.includes("const map = tab === 'global' ? (status && status.quickTools && status.quickTools.global) : (status && status.quickTools && status.quickTools.project);")
    && body.includes("typeof map[key] === 'object' ? (map[key].reason || '') : ''")
    && body.includes("const sub = tab === 'global' ? 'g' : 'p';")
    && body.includes('setQuickReason((prev) => Object.assign({}, prev, { [key]: Object.assign({}, prev[key], { [sub]: cur }) }))');
})())
// 防回退：写盘失败不能算成功。宿主 persist() 失败时只设 status.saveError（HTTP 仍 200、无 error），
// 若 invoke 只看 r.error，就会出现「磁盘没写、界面显示已保存」的假成功（已实测复现）。
// 三处细节必须同时守住：① status 的位置不统一——多数路由平铺返回 statusView，例外/规则增删返回
// `{ added|removed, status: statusView }`，只读顶层会漏掉后者；② 判据必须 return 收尾，
// 否则删掉 return 会继续执行 setMsg('已保存')；③ 只对**会写盘的端点**生效——status.saveError 是
// 宿主侧粘滞状态，reload/open-config 这类只读调用也会回带它，不加区分会把「成功打开配置文件」
// 误报成上一次的写盘错误（已实测复现）。
ok('invoke 把 saveError 与 error 同等对待（写盘失败不报「已保存」）', (function () {
  const body = cli.slice(cli.indexOf('const invoke = (method, args, done) =>'), cli.indexOf('const confirmDelete = (key, fn) =>'));
  const assign = 'const saveErr = (r && r.saveError) || (st && st.saveError);';
  const guard = "if (saveErr && WRITE_METHODS.indexOf(method) !== -1) { setMsg(String(saveErr)); applyStatus(st); return; }";
  return body.includes('const st = r && r.status ? r.status : r;')
    && body.includes(assign)
    && body.includes(guard)
    // 顺序必须比较**整条赋值语句**与「已保存」的位置：只比较变量名 `saveErr` 的首次出现会空转
    // ——把声明连同 if 一起搬到 setMsg 之后时，变量名位置也随之后移，比较结果依然为真（实测漏网）。
    && body.indexOf(assign) < body.indexOf("setMsg(T('panel.saved'))")
    && body.indexOf(guard) < body.indexOf("setMsg(T('panel.saved'))");
})())
// 防回退：WRITE_METHODS 必须与「面板实际调用的写盘端点」集合一致。
// 少一个 -> 该端点的假成功漏网；多一个 -> 只读调用被误拦（两者都已实测复现过）。
// 比对范围限定为**面板调用过的端点**：宿主还有面板已移除入口的写盘路由（如 set-editor-kernel），
// 那些不该出现在面板清单里（另有断言钉住「client 无 set-editor-kernel 残留」）。
ok('WRITE_METHODS 与面板调用的写盘端点一致（不多不少）', (function () {
  const canon = (s) => s.replace(/^\/?permgate[\/:]/, '').replace(/^\/+/, '');
  // 宿主侧：真正调用 persist() 的路由
  const hostWrites = new Set();
  for (const b of src.split(/if \(pathname === '/).slice(1)) {
    const raw = (b.match(/^([^']+)'/) || [])[1];
    if (raw && /await persist\(exec\)/.test(b.slice(0, 1500))) hostWrites.add(canon(raw));
  }
  // 面板侧：invoke(...) 调用过的端点
  const called = new Set();
  for (const mm of cli.matchAll(/invoke\('permgate:([^']+)'/g)) called.add(mm[1]);
  // 契约一：面板经 invoke 调用的每个写盘端点都必须列出；列出的每个端点都必须是写盘端点
  const shouldList = [...called].filter((c) => hostWrites.has(c)).sort();
  const m = cli.match(/const WRITE_METHODS = \[([\s\S]*?)\];/);
  if (!m || !shouldList.length) return false;
  const listed = m[1].split(',').map((s) => canon(s.trim().replace(/^'|'$/g, ''))).filter(Boolean).sort();
  const missing = shouldList.filter((w) => listed.indexOf(w) === -1);
  const extra = listed.filter((w) => hostWrites.has(w) === false);
  if (missing.length || extra.length) {
    ok('WRITE_METHODS 与面板调用的写盘端点一致（不多不少）', false,
      '未列出: [' + missing.join(', ') + '] 列了非写盘端点: [' + extra.join(', ') + ']');
    return false;
  }
  return true;
})())
// 防回退：白名单只覆盖 invoke 路径。若有写盘端点绕开 invoke、直接用 call(...)，它**不会**被
// WRITE_METHODS 保护，必须在该调用点自查 saveError —— 否则那条路径的假成功照样漏网。
// 实测背景：remove-exception 走 call()，删除例外的写盘失败曾显示「已删除」而磁盘未写，
// 下次 reload 该例外「复活」。
// 断言方式：对「走 call 的写盘调用点」逐字比对**整段判定链**。
// 之所以不查「附近是否出现 saveErr 字样」：删掉拦截语句后赋值行仍在，那种写法会空转
// （实测 4/6 变异漏网）；逐字比对才能同时守住「赋值在」「拦截在」「顺序对」。
ok('走 call 的写盘端点逐字自查 saveError（不被 WRITE_METHODS 覆盖的那条路）', (function () {
  const canon = (s) => s.replace(/^\/?permgate[\/:]/, '').replace(/^\/+/, '');
  const hostWrites = new Set();
  for (const b of src.split(/if \(pathname === '/).slice(1)) {
    const raw = (b.match(/^([^']+)'/) || [])[1];
    if (raw && /await persist\(exec\)/.test(b.slice(0, 1500))) hostWrites.add(canon(raw));
  }
  const lines = cli.split('\n');
  const problems = [];
  lines.forEach((l, i) => {
    const mm = l.match(/\bcall\('permgate:([^']+)'/);
    if (!mm || !hostWrites.has(canon(mm[1]))) return;
    // 该调用点起、到本语句块结束（连续缩进段落）为止，取判定链
    const seg = [];
    for (let k = i; k < Math.min(lines.length, i + 14); k++) seg.push(lines[k].trim());
    const chain = seg.join('\n');
    const norm = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\s+/g, ' ').trim();
    // 必须按顺序出现：error 分支 -> saveErr 赋值 -> saveErr 拦截+return -> 再 applyStatus
    const needError = /if \(r && r\.error\) \{ setMsg\(String\(r\.error\)\); return; \}/;
    const needAssign = /const saveErr = \(r && r\.saveError\) \|\| \(st && st\.saveError\);/;
    const needGuard = /if \(saveErr\) \{ setMsg\(String\(saveErr\)\); applyStatus\(st\); return; \}/;
    const cn = norm(chain);
    const mErr = cn.match(needError);
    const mAsg = cn.match(needAssign);
    const mGrd = cn.match(needGuard);
    if (!mErr || !mAsg || !mGrd) { problems.push(canon(mm[1]) + ' @' + (i + 1)); return; }
    const iErr = cn.indexOf(mErr[0]);
    const iAsg = cn.indexOf(mAsg[0]);
    const iGrd = cn.indexOf(mGrd[0]);
    // 拦截必须**紧跟在赋值之后**（中间不得出现 applyStatus / removed / remaining）：
    // 只检查「拦截在成功提示之前」不够——把拦截挪到 applyStatus 与 removed 判定之间时，
    // 它仍在成功提示之前，会漏网（实测）。
    // 注意用 mAsg[0].length（实际匹配文本）而非正则 source 长度：source 含 `\(` 等转义，
    // 长度比实际匹配串长，会让切片起点偏移、between 取空从而恒真（已踩过）。
    const between = cn.slice(iAsg + mAsg[0].length, iGrd);
    const adjacencyOk = !/applyStatus|removed === false|remaining > 0/.test(between);
    if (!(iErr < iAsg && iAsg < iGrd) || !adjacencyOk) {
      problems.push(canon(mm[1]) + ' @' + (i + 1));
    }
  });
  if (problems.length) {
    ok('走 call 的写盘端点逐字自查 saveError（不被 WRITE_METHODS 覆盖的那条路）', false,
      '判定链不完整或顺序不对: ' + problems.join(', '));
    return false;
  }
  return true;
})())
// 防回退：编辑态只在「用户主动操作」时清理是不够的——AI 侧 perm_* 写入、配置重载、删行、换会话
// 都是服务端驱动的，编辑态会残留成「没点编辑却可输入」。applyStatus 必须按新的 mode 收敛一次。
// 注意必须断言**函数体内部判据**：只固定函数名与两处调用时，把判据 `=== 'deny'` 改成 `=== 'ask'`、
// 或在函数体开头加 `return true/false`、或让冒号切分退化，都能绕过（实测 5/8 变异漏网）。
// 行首的 `;` 是**必需的**，不是笔误：上一条语句以 `})())` 结尾，若去掉它，ASI 会把两者连成
// `ok(...)(function(){...})`，运行时报 `TypeError: ok(...) is not a function`（已实测）。
;(function () {
  const body = cli.slice(cli.indexOf('const stillEditable = (fk) =>'), cli.indexOf('setReasonEditing((cur) => (stillEditable(cur)'));
  // 去注释、折叠空白后与**期望实现逐字比对**。
  // 之所以不用逐条 includes：插入式变异（在函数体开头加一句 `return false;`）不会破坏任何
  // 既有子串，却能改变行为（误清正在编辑的格）——逐条 includes 对它完全无感（实测漏网）。
  const norm = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\s+/g, ' ').trim();
  const expected = [
    'const stillEditable = (fk) => {',
    'if (!fk) return false;',
    // 键解析：按**前两个**冒号切分（key 本身可能含冒号，工具名允许）
    "const i = fk.indexOf(':');",
    "const j = fk.indexOf(':', i + 1);",
    'if (i < 0 || j < 0) return false;',
    'const kind = fk.slice(0, i);',
    'const t = fk.slice(i + 1, j);',
    'const key = fk.slice(j + 1);',
    // 三处判据都必须以 deny 为准（写反成 ask / 恒真 / 恒假都会失败）
    "if (kind === 'cat') return !!(cs[t] && cs[t][key] === 'deny');",
    "if (kind === 'quick') { const sub = t === 'global' ? 'g' : 'p';",
    "return !!(qs[key] && qs[key][sub] === 'deny'); }",
    "return fbShow[t] === 'deny'; };",
  ].join(' ');
  // 两处收敛调用必须在
  const callOk = cli.includes('setReasonEditing((cur) => (stillEditable(cur) ? cur : null));')
    && cli.includes('if (reasonFocus.current && !stillEditable(reasonKeyOf(reasonFocus.current))) reasonFocus.current = null;');
  const bodyOk = norm(body) === expected;
  // 逐字比对失败时给出期望/实际：等价改写也会走到这里（该断言刻意偏严格，宁可误报不可漏报）
  ok('applyStatus 按新 mode 收敛残留的编辑态与焦点', bodyOk && callOk,
    bodyOk ? '收敛调用缺失' : ('stillEditable 函数体与期望不符\n      期望: ' + expected + '\n      实际: ' + norm(body)));
})()
// 防回退：回车与「保存」按钮会各触发一次提交，必须按「与已落盘值相同就跳过」去重，
// 否则每次点开又保存都写一次盘。
ok('回车/保存按钮双触发按值去重（同值不重复写盘）', (cli.match(/if \(\(v \|\| ''\) === (cur|\(prev \|\| ''\))\) return;/g) || []).length === 3)
ok('面板读快捷工具值时兼容对象/字符串两种形态', cli.includes('function quickMode(v) { return v && typeof v === \'object\' ? v.action : v; }') && cli.includes('function quickReasonOf(v) { return v && typeof v === \'object\' ? v.reason : undefined; }'))
// 防回退：ask 例外不能算「已表态」，否则弹窗里再不给「允许此项」候选，用户只能去面板手工改
ok('alreadyInProject 只认方向明确的例外（ask 不算已表态）', src.includes("const decided = (r) => r.action !== 'ask'") && (src.match(/exceptions\.some\(\(r\) => decided\(r\) && /g) || []).length === 2)
// 防回退：commandFullyCovered 只认 allow（ask 例外不得触发「命令组成均已命中例外」静默放行）
ok('命令全覆盖判定只认 allow 例外（ask 例外不静默放行）', src.includes("if (r.action === 'allow' && matchCommand(r.match, value)) { hit = true; break }"))
// 防回退：全局快捷工具曾不跳过 inherit —— decide() 只处理 ask/deny，inherit 落到 pre-execute
// 的「两者都不匹配」分支直接 next()，等于静默放行（项目分支一直有该守卫，两侧须同口径）
ok('全局快捷工具同样跳过 inherit（与项目分支同口径，不静默放行）', src.includes("if (modeOf(gMap[k]) !== 'inherit' && matchGlob(k, name))") && (src.match(/!== 'inherit' && matchGlob\(k, name\)/g) || []).length === 2)

// ─────────────────────────────────────────────────────────────
if (fail.length) {
  console.log('\nFAIL (' + fail.length + ')：')
  for (const f of fail) console.log('  ✗ ' + f)
  process.exit(1)
}
console.log('\nALL PASS（共 ' + (fail.length === 0 ? '全部' : '') + '断言通过）')
