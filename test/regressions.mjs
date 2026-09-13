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
const ok = (name, cond) => { if (!cond) fail.push(name) }
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
ok('open-file 守卫使用 isPreviewableFileTool', src.includes('if (!isPreviewableFileTool(entry.tool, args)) return json'))
ok('normTarget 定义 + 三处路由使用', src.includes('function normTarget(a) {') && (src.match(/const target = normTarget\(a\)/g) || []).length === 3)
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
ok('切 tab 清空确认态', cli.includes('setConfirm(null); }, [tab])'))
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
ok('client 有图片渲染块与文案', cli.includes('function ImageBlock({ data })') && cli.includes("'app.imageTooLarge'") && cli.includes('catS.image'))
ok('面板 chips 含 image', cli.includes("chip(catShort('image'), eff.image)"))
// 防回退：image 不套用老模式迁移（off/permissive→ask、locked→deny），不能变回 allow
ok('迁移不把老模式套到 image 上', src.includes("c === 'image' ? (oldMode === 'locked' ? 'deny' : 'ask')") && !src.includes('for (const c of CATS) cfg.global[c].mode = map[oldMode] || \'allow\''))
// 防回退：图片详情默认收起（客户端不在 pending 出现时自动预取整图）
ok('pending 下发 imagePreview 标记', src.includes('imagePreview: isFileImage(exec.name) === true') && src.includes('imagePreview: e.imagePreview === true'))
ok('client 图片详情默认收起且不自动预取', cli.includes('!!p.hasDiff && !p.imagePreview') && cli.includes('p.imagePreview && !userOpened'))
// 防回退：工作区外审批给两条候选（整个目录 / 仅此文件），且「仅此文件」写两条例外（自身分类 + 目录精确路径）
ok('工作区外 path 审批给两条候选', src.includes("const outsideHere = !!(catKey && catKey !== 'directory' && isOutside(entry.value, root))") && src.includes('function pathToolCat(name, args)') && src.includes('toolCat: pathToolCat(exec.name, exec.arguments)'))
ok('「仅允许此文件」写自身分类 + 目录精确路径两条例外', src.includes("{ cat: catKey, kind: 'path', value: entry.value }, { cat: 'directory', kind: 'path', value: entry.value }") && src.includes('const cand = r.id ? (entry.candidates || []).find((c) => c.id === r.id) : null') && cli.includes('({ id: c.id, value: c.value, kind: c.kind, decision: sel[c.id] })'))
ok('「整个目录」同时写目录闸与自身分类的 glob', src.includes("{ cat: 'directory', kind: 'path', value: glob }, { cat: catKey, kind: 'path', value: glob }") && src.includes('const hasKindGlob = globSafe && alreadyInProject(glob'))
// 防回退：缩略图像素上限、落盘分类/类型自洽、reason 前缀跟随决定闸、read 复用预检单点
ok('缩略图有像素/边长上限（16MP / 4096），尺寸未知时一律不内联', src.includes('const IMAGE_MAX_PIXELS = 16 * 1000 * 1000') && src.includes('const IMAGE_MAX_DIM = 4096') && src.includes('const pixelOver = !!(sizeKnown && (') && src.includes('if (!sizeKnown) { out.sizeUnknown = true; return out }'))
ok('拒绝候选不落 directory 例外（单点过滤，候选与旧形态共用）', src.includes('const writeException = (cat, kind, value, decision)') && src.includes("if (decision === 'deny' && cat === 'directory') return") && (src.match(/writeException\(/g) || []).length === 2 && !src.includes("w.cat === 'directory') continue"))
ok('同值相反 action 不再静默覆盖历史例外（守卫按同向判定）', (src.match(/findIndex\(\(r\) => r\.(path|match) === value && r\.action === decision\)/g) || []).length === 2 && !src.includes('idx !== -1 && c.exceptions[idx].action === decision') && src.includes('const item = build({ path: value })') && src.includes('const item = build({ match: value })'))
ok('面板与工具写入统一走 addProjectException（不再尾部 push）', (src.match(/addProjectException\(a\.category|addProjectException\(args\.category/g) || []).length === 2 && !src.includes('block[a.category].exceptions.push(e)') && !src.includes('block[args.category].exceptions.push(e)'))
ok('含通配符/.. 的路径不生成目录 glob 候选', src.includes('const hasParentSeg =') && src.includes('const globSafe = !hasGlobMeta(entry.value) && !hasParentSeg(entry.value)'))
ok('预算内图片只读一次盘（嗅探与内联共用缓冲）', src.includes('whole = await fsService.readBytes(target, undefined, IMAGE_MAX_BYTES)') && src.includes('const bytes = whole || await fsService.readBytes'))
ok('写入缺省作用域与删除侧一致（缺省全局，候选显式项目块）', src.includes("const target = o.target === 'project' ? 'project' : 'global'") && src.includes("addProjectException(cat, kind, value, decision, { target: 'project' })") && !src.includes('function addProjectRule'))
ok('reason 与 normalizeException 同口径（仅 deny、trim、截断 200）', src.includes("decision === 'deny' && o.reason ? String(o.reason).trim().slice(0, 200)"))
ok('整读后直接用整份缓冲嗅探', src.includes('sniffImage(whole || head)'))
ok('不可达的 directory else-if 候选分支已删除', !src.includes("else if (entry.cat === 'directory')"))
ok('两条候选文案都写明拒绝只写自身分类', (src.match(/拒绝时只写入「/g) || []).length === 2)
ok('拒绝态下 allow 单选置灰而非清除勾选', cli.includes("const muted = v === 'allow' && !!denyMode[p.id]") && !cli.includes("sel[c.id] === 'allow') delete next[c.id]"))
ok('同向去重按「同值 + 同向」判定（方向交替不再累积）', src.includes('const idx = c.exceptions.findIndex((r) => r.path === value && r.action === decision)') && src.includes('const idx = c.exceptions.findIndex((r) => r.match === value && r.action === decision)'))
ok('拒绝只提交 deny 方向规则，服务端二次拦截', cli.includes('const pickedDenyRules = (p) => pickedRules(p).filter((r) => r.decision === \'deny\')') && cli.includes("decide(p.id, 'deny', pickedDenyRules(p), reason || undefined)") && cli.includes('const enterDeny = (p) =>') && src.includes("if (!allow && r.decision === 'allow') continue"))
ok('hasGlobMeta 只拦 * 与 ?（[ ] 是字面量）', src.includes('const hasGlobMeta = (p) => /[*?]/.test(String(p || \'\'))'))
ok('例外落盘校验分类与类型自洽', src.includes("if (kind === 'path' && cat && cat !== 'command' && EXC_CATS.indexOf(cat) !== -1)") && src.includes("if (kind === 'command' && cat === 'command')") && src.includes('if (!p) return false'))
ok('工作区外 reason 前缀跟随决定闸', src.includes('const OUTSIDE_PREFIX = {') && (src.match(/m\.pz \+ /g) || []).length === 12)
ok('工作区外 allow 的 cat 与 ruleId 同源（不再硬编码 catKey）', src.includes("const cat = src === d ? 'directory' : catKey") && !src.includes("return { action: 'allow', src: d.ruleId ? d : (e.ruleId ? e : null), cat: catKey"))
ok('read/image 详情复用预检单点且跳过体积闸', (src.match(/skipSizeCheck: true/g) || []).length === 2)
// 防回退：含通配符的文件路径不生成「仅此文件」候选；旧形态（无 id）按 value 反查候选复用 writes
ok('glob 元字符路径不生成文件级候选', src.includes('const hasGlobMeta = (p) =>') && src.includes('!hasGlobMeta(entry.value) && !alreadyInProject(entry.value'))
ok('旧形态 rules 按 value 反查候选复用 writes', src.includes('const byValue = (entry.candidates || []).find((c) => c.value === String(r.value))'))
// 防回退：例外删除必须是单点且严格按 id 删除，并回传同路径剩余条目数供 UI 提示
ok('例外删除严格按 id 并回传 remaining', src.includes('function removeExceptionEntries(block, catKey, id)') && (src.match(/removeExceptionEntries\(block, (a|args)\.category/g) || []).length === 2 && src.includes('const kept = c.exceptions.filter((r) => r.id !== id)') && src.includes('return { removed: true, count, remaining, exception: target }') && !src.includes('const kept = c.exceptions.filter((r) => !(r[key] === value'))
ok('图片 base64 用视图避免整份字节拷贝', src.includes('Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)'))
ok('两条候选文案分别落在「整个目录」与「仅此文件」', src.includes("'整个目录：' + kindLabel[0] + '（允许时同时写入") && src.includes("'仅此文件：' + kindLabel[0] + '（允许时同时写入"))
ok('dirGlob 盘根直接拼 /*（不再产生匹配不到的 G://*）', src.includes("if (/^[a-zA-Z]:$/.test(dir)) return dir + '/*'") && !src.includes("if (/^[a-zA-Z]:$/.test(dir)) dir += '/'") )
ok('choice 路径复用例外写入单点', src.includes("addProjectException(entry.cat, 'path', String(entry.value), action, { target })") && src.includes("addProjectException('command', 'command', String(entry.value), action, { target })") && !src.includes('cat.exceptions[idx].action = action'))
ok('客户端删除用返回 promise 的 call 并反馈结果', cli.includes("call('permgate:remove-exception', { target: tab, category: c, id })") && !cli.includes("invoke('permgate:remove-exception'") && cli.includes("T('panel.delFailed')"))
ok('同向去重命中后把条目提到头部并回写 reason', src.includes('const hit = c.exceptions.splice(idx, 1)[0]') && (src.match(/c\.exceptions\.unshift\(hit\)/g) || []).length === 2 && src.includes('if (reason) hit.reason = reason'))
ok('choice 路径不再套用候选的 deny-directory 过滤', !src.includes("if (!(action === 'deny' && entry.cat === 'directory'))"))
// ─────────────────────────────────────────────────────────────
if (fail.length) {
  console.log('\nFAIL (' + fail.length + ')：')
  for (const f of fail) console.log('  ✗ ' + f)
  process.exit(1)
}
console.log('\nALL PASS（共 ' + (fail.length === 0 ? '全部' : '') + '断言通过）')
