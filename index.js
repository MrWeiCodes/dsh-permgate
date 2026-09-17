// dsh-permgate — 权限网关（宿主半）
// 注册 perm_* 工具、挂钩 tools/pre-execute 审查、经 webServer 提供 /permgate/* JSON 路由供浏览器 UI 调用。
// 配置持久化于 $DSH_HOME/dsh-permgate/config.json（用户级、不进任何 git 仓库）。
import { defineTool } from '@deepseek-ai/dsh-tools'
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import { join as pathJoin, resolve as pathResolve, isAbsolute as pathIsAbsolute } from 'node:path'
import { existsSync as fsExistsSync, readFileSync as fsReadFileSync, readdirSync as fsReaddirSync, unlinkSync as fsUnlinkSync, lstatSync as fsLstatSync, realpathSync as fsRealpathSync } from 'node:fs'
import { homedir as osHomedir } from 'node:os'
const CATS = ['directory', 'command', 'read', 'image', 'edit', 'undo', 'subagent', 'doomloop']
const EXC_CATS = ['directory', 'command', 'read', 'image', 'edit', 'undo']
// 分类枚举清单派生：三处工具 schema 的 enum 直接引用，避免新增分类时逐处漏改
const CATEGORY_ENUM = CATS.slice()
const EXC_CATEGORY_ENUM = EXC_CATS.slice()
const MODES = ['ask', 'allow', 'deny']
const ALL_MODES = ['ask', 'allow', 'deny', 'inherit']
const MAX_DECISIONS = 30
// 快捷工具预设：无文件/命令语义、只能按工具名设默认动作的清单（设置页据此展示，新配置按 QUICK_DEFAULTS 落默认）
// 低风险观测/会话类工具默认放行，避免每次都弹窗；
// 其余工具默认询问（ask）：mcp__*（外装 MCP）、改权限配置的 perm_*（只读的 perm_status 除外）、
// 以及管理动态插件的 cordis_run/stop/undefine —— perm_* 曾经被 decide 无条件放行，等于
// 「AI 可自我提权、且全程无弹窗」；纳入本清单后统一按 ask 裁决，只有用户在设置页显式改成 allow
// 才会静默放行（预设默认优先于兜底策略，改兜底也不会漏）。
const QUICK_DEFAULTS = {
  web_search: 'ask', skill: 'allow', grep: 'allow', glob: 'allow', web_fetch: 'ask',
  ask_user_question: 'allow', todo_write: 'allow', list_agents: 'allow',
  job_list: 'allow', job_output: 'allow', job_kill: 'allow',
  get_goal: 'allow', create_goal: 'allow', update_goal: 'allow',
  send_message: 'allow', interrupt_agent: 'allow',
  present: 'allow', exit_plan_mode: 'allow',
  cordis_define: 'allow', cordis_inspect_list: 'allow', cordis_inspect_query: 'allow', cordis_inspect_self: 'allow',
  // 改权限配置 = 元操作，一律先问；只有 perm_status 是只读查询，默认放行（想看随时能看）
  perm_status: 'allow', perm_set_category: 'ask', perm_set_fallback: 'ask', perm_set_editor_kernel: 'ask',
  perm_add_exception: 'ask', perm_remove_exception: 'ask', perm_set_quick: 'ask',
  perm_add_rule: 'ask', perm_remove_rule: 'ask', perm_reload: 'ask',
  // cordis_run 在宿主进程里执行代码、stop/undefine 管理（可移除）动态插件 —— 同属元操作，一律先问
  cordis_run: 'ask', cordis_stop: 'ask', cordis_undefine: 'ask',
}
// 单一来源：预设清单由 QUICK_DEFAULTS 的键派生（顺序即键的插入顺序），
// 避免「清单」与「默认值」两份定义在新增工具时漂移（设置页展示与 locked 迁移共用这一份）
const QUICK_PRESET = Object.keys(QUICK_DEFAULTS)
// eslint-disable-next-line no-unused-vars -- 有意保留：记录「审批已改为永不超时」前的历史口径
const ASK_TIMEOUT_MS = 300000 // 保留常量（历史/文档用途）；审批已改为永不超时
const DECIDE_CHOICES = ['allow', 'deny', 'allow-global', 'allow-project', 'deny-global', 'deny-project']
const REPEAT_STREAK = 4
const PS_KEYWORDS = { foreach: 1, if: 1, else: 1, elseif: 1, for: 1, while: 1, do: 1, until: 1, switch: 1, return: 1, function: 1, filter: 1, param: 1, begin: 1, process: 1, end: 1, try: 1, catch: 1, finally: 1, throw: 1, break: 1, continue: 1, trap: 1, in: 1, not: 1, and: 1, or: 1, class: 1, enum: 1, using: 1, exit: 1, dynamicparam: 1, data: 1 }
// 子命令路由器命令族：候选细化到「git status *」这一粒度，而不是一放全放「git *」
const ROUTER_CMDS = { git: 1, npm: 1, pnpm: 1, yarn: 1, docker: 1, kubectl: 1, dotnet: 1, cargo: 1, go: 1, gh: 1, pip: 1, uv: 1, conda: 1 }

const FILE_READ_TOOLS = { read: 1 }
// 图片读取单列一类：判定链与 read 完全同构（工作区外先过「目录访问」闸，再过本分类 + 路径例外），
// 但配置与默认值都独立 —— 「读文件」的设置不管读图，且 image 默认 ask（read 默认 allow），
// 老配置升级后读图会先询问（v1 的 locked 配置保持 deny），是否放宽由用户自己决定。
const FILE_IMAGE_TOOLS = { read_image: 1 }
const FILE_WRITE_TOOLS = { write: 1, edit: 1 }
const COMMAND_TOOLS = { pwsh: 1, bash: 1 }
const SUBAGENT_TOOLS = { subagent: 1, subagent_fork: 1, workflow: 1, ralph: 1 }

// str_replace_editor 的写命令（view 只读；undo_edit 只抛 E_UNSUPPORTED、不写盘，故不计入写）
const SRE_WRITE_CMDS = { create: 1, str_replace: 1, insert: 1 }

// str_replace_editor 的内核：DSH 内置（官方语义，insert_line 0 基、插到该行之后）
// 或 dsh-better-edit 的同名 shadow 覆盖（1 基、插到该行之前）。两者语义相反，
// 预览必须按实际生效的那个算，否则会把插入位置画到错误的地方。
const EDITOR_KERNELS = ['auto', 'builtin', 'shadow']
const EDITOR_KERNEL_VALUES = ['auto', 'builtin', 'shadow', 'inherit']

// str_replace_editor 命令名提取统一：isFileWrite/isFileRead 与各预览分支共用同一解析口径，
// 避免命令字符串解析在多处独立演化（create 等命令的判定曾在两处各写一份）
function sreCommand(args) {
  try { return String((args && args.command) || '') } catch (e) { return '' }
}

// 文件写工具判定：write/edit 原生工具，或 str_replace_editor 的写命令
function isFileWrite(name, args) {
  if (FILE_WRITE_TOOLS[name]) return true
  if (name !== 'str_replace_editor') return false
  return !!SRE_WRITE_CMDS[sreCommand(args)]
}

// 文件读（文本）工具判定：read，或 str_replace_editor 的 view
function isFileRead(name, args) {
  if (FILE_READ_TOOLS[name]) return true
  if (name !== 'str_replace_editor') return false
  return sreCommand(args) === 'view'
}

// 图片读工具判定：read_image（参数同样取 file_path，路径解析复用 pathArg）
function isFileImage(name) {
  return !!FILE_IMAGE_TOOLS[name]
}

// 撤销类工具（dsh-better-edit 的 undo_last_edit）：会写盘但不是「编辑」——它恢复既有内容、
// 不接受调用方提供的新内容，因此单列一类（undo），默认询问。
const UNDO_TOOLS = { undo_last_edit: 1 }
function isUndo(name) { return !!UNDO_TOOLS[name] }

// 工具自身所属的路径类分类（不含 directory 闸）：工作区外审批的「仅此文件」候选要写哪个分类，
// 不能靠 entry.cat —— 它只记录「作出决定的那道闸」，directory 处于 ask 时反映不出工具本身属于哪类。
function pathToolCat(name, args) {
  if (isFileWrite(name, args)) return 'edit'
  if (isFileImage(name)) return 'image'
  if (isUndo(name)) return 'undo'
  if (isFileRead(name, args)) return 'read'
  return null
}

// 「可预览文件内容」判定：详情 diff 与「打开文件」路由共用同一口径（写类/文本读类/图片类/撤销类），
// 避免两处判据分叉导致「面板有对比但打开文件报不支持」
function isPreviewableFileTool(name, args) {
  return !!(isFileWrite(name, args) || isFileRead(name, args) || isFileImage(name) || isUndo(name))
}

// ── 图片嗅探（详情缩略图用）────────────────────────────────────────
// read_image 支持 PNG/JPEG/WebP/GIF。这里不引图像库，直接按各格式文件头取格式与像素尺寸；
// 只在「详情」预览通道里用，嗅探失败即视为不可预览，不影响权限判定本身。
const IMAGE_MIME = { png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }
// 缩略图体积上限：data URL 比原字节还要大 1/3，超过就只给格式/尺寸、不返回图片本体
const IMAGE_MAX_BYTES = 2 * 1024 * 1024
// 像素/边长上限：服务端不做降采样，原图直接内联给浏览器解码，故这里等于「弹窗解码预算」——
// 16 MP ≈ 4096×4096 ≈ 64MB RGBA；边长闸与像素闸同量级，避免小体积超大清屏图（解压炸弹）。
const IMAGE_MAX_PIXELS = 16 * 1000 * 1000
const IMAGE_MAX_DIM = 4096
// 头部读取上限：JPEG 的 SOF 段可能落在较后面，64KB 足以覆盖常规图片
const IMAGE_HEAD_BYTES = 64 * 1024

function be32(b, o) { return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0 }
function le16(b, o) { return b[o] | (b[o + 1] << 8) }
function le24(b, o) { return b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) }

// 返回 { format, width, height }；无法识别返回 null；尺寸取不到时宽高为 null
function sniffImage(b) {
  if (!b || b.length < 16) return null
  // PNG：89 50 4E 47 0D 0A 1A 0A，IHDR 宽高在固定偏移（大端 32 位）
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    if (b.length < 24) return { format: 'png', width: null, height: null }
    return { format: 'png', width: be32(b, 16), height: be32(b, 20) }
  }
  // GIF87a / GIF89a：逻辑屏幕宽高（小端 16 位）
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    return { format: 'gif', width: le16(b, 6), height: le16(b, 8) }
  }
  // JPEG：FF D8 之后逐段跳过，遇 SOFn 帧头取高宽（大端）
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue }
      const m = b[i + 1]
      if (m === 0xff) { i++; continue } // 段间填充字节
      if (m === 0x01 || (m >= 0xd0 && m <= 0xd8)) { i += 2; continue } // 无长度字段的段
      const len = (b[i + 2] << 8) | b[i + 3]
      if (len < 2) break
      const isSof = (m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf)
      if (isSof) return { format: 'jpeg', height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8] }
      if (m === 0xda) break // SOS：之后是压缩数据，不会再有尺寸段
      i += 2 + len
    }
    return { format: 'jpeg', width: null, height: null }
  }
  // WebP：RIFF....WEBP + 变体块
  if (b.length >= 30 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    const cc = String.fromCharCode(b[12], b[13], b[14], b[15])
    if (cc === 'VP8X') return { format: 'webp', width: le24(b, 24) + 1, height: le24(b, 27) + 1 }
    if (cc === 'VP8 ') return { format: 'webp', width: (b[26] | (b[27] << 8)) & 0x3fff, height: (b[28] | (b[29] << 8)) & 0x3fff }
    if (cc === 'VP8L') {
      const bits = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0
      return { format: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
    }
    return { format: 'webp', width: null, height: null }
  }
  return null
}

// target 归一化统一：缺失/非法一律落到 global（三个设置路由共用，避免漏改某处把项目设置写进全局）
function normTarget(a) {
  return a && a.target === 'project' ? 'project' : 'global'
}

// 路径归一化（better-edit store 路径匹配共用）：大小写/斜杠/尾斜杠归一化
function normPathKey(p) {
  return String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

// 「文件过大」预检统一口径：size 为字节数（多字节 UTF-8 下 ≥ 字符数），超过上限即可安全提前拒绝；
// 各分支读盘后另有字符数兜底（磁盘全文 + 新增文本总长），两层守卫互补
function fileTooLarge(info, maxChars) {
  return !!(info && typeof info.size === 'number' && info.size > maxChars)
}

// 「文件过大」字符数兜底统一：磁盘全文 + 新增文本总长超过 DIFF_MAX_CHARS 即拒绝。
// 各读盘分支共用，避免上限口径多份独立演化（文案由调用方按场景选择）。
// 常量必须定义在模块作用域：overMaxChars 是模块级函数，访问不到 apply() 内的局部常量
const DIFF_MAX_CHARS = 1048576

function overMaxChars(a, b) {
  return String(a == null ? '' : a).length + String(b == null ? '' : b).length > DIFF_MAX_CHARS
}

// 双语文案：bi(zh, en) 生成 {zh,en}；L(obj, lang) 按语言取值（缺省回退中文）
const bi = (zh, en) => ({ zh, en })
const L = (o, lang) => (o && (o[lang] || o.zh)) || ''
// 语言参数归一化：只有 en 用英文，其余（缺失/空/非法）一律中文
const normLang = (v) => (v === 'en' ? 'en' : 'zh')

// 「读取失败」错误对象统一构造：各读盘/预检分支共用，避免中英文案与字段在多处独立演化
const readFail = (e) => {
  const emsg = (e && e.message ? e.message : String(e))
  return { zh: '读取失败: ' + emsg, en: 'Read failed: ' + emsg }
}

export default {
  inject: ['fs', 'sandboxPolicy', 'tools', 'webServer', 'timer', 'approval', 'permissionPresets', 'sessions'],
  apply(ctx) {
    const fs = ctx.fs
    const sp = ctx.sandboxPolicy
    const disposers = []
    const onDispose = (fn) => disposers.push(fn)
    ctx.effect(() => () => { for (let i = disposers.length - 1; i >= 0; i--) { try { disposers[i]() } catch (e) {} } })

    const fallbackRoot = String(sp.workspaceRoot || '').replace(/[\\/]+$/, '')
    let root = norm(fallbackRoot)
    let rootSource = 'policy'
    let target = null
    let loaded = false
    let agentRef = null
    let dshHomeCache = null
    // home 解析失败后的抑制窗口：load/persist 一次流程内会多次调用 resolveDshHome，
    // 失败即重试会导致每次调用都重新 spawn cmd 探测并刷错误日志
    let dshHomeFailAt = 0
    const HOME_FAIL_TTL_MS = 200
    let config = freshConfig()
    let loadError = null
    let saveError = null
    const decisions = []
    const recent = []
    const pendingApprovals = new Map()
    // SSE 订阅者：/permgate/events 长连接的响应对象集合（状态/待审批变化即推）
    const sseClients = new Set()
    // 沙箱升级跟踪：{token: {session, prev}}，工具执行完成后写回原沙箱（一次性升级）
    const upgradedCalls = new Map()
    // 客户端最近请求的语言（zh/en），用于宿主即时文案（弹窗标签、升级审批提示）
    let uiLang = 'zh'

    function norm(p) {
      return String(p).replace(/\\/g, '/').replace(/\/+$/, '')
    }

    // 路径规范化单点：相对路径先按 root 绝对化，再折叠 .. 与重复分隔符。
    // glob/norm/globToRegExp 都不折叠 ..，仅规范化写入侧会让例外永不命中参数原文。
    function normAbsPath(p) {
      const s = norm(p)
      if (!s) return s
      // glob 不是文件路径：绝对化会改变匹配范围（`**/*.env` 会被拼成 `G:/MCP/**/*.env`，
      // 从「任意目录」缩成「仅工作区内」），故只做斜杠归一，不绝对化也不折叠 ..。
      // 与 hasGlobMeta 同口径：只认 * 与 ?（[ ] 在 globToRegExp 里是字面量，不是通配符）。
      if (/[*?]/.test(s)) return s
      // file:// 等 URL 形态不是文件系统路径，原样返回（与 resolveArgPath 同口径）
      if (s.indexOf('://') !== -1) return s
      const isAbs = s.indexOf('/') === 0 || /^[a-zA-Z]:/.test(s)
      const abs = isAbs ? s : (root ? norm(root + '/' + s) : '')
      if (!abs) return s
      return norm(pathResolve(/^[a-zA-Z]:$/.test(abs) ? abs + '/' : abs))
    }

    // 路径同一性键：判重、写入去重、匹配三处共用同一口径，保证「同一条例外」在三处同答案。
    // 必须基于 normAbsPath（绝对化 + 折叠 ..）而非裸 normPathKey，否则候选写入的规范值
    // 与面板/工具入口写入的相对路径或含 .. 原文会被当成两条不同例外。
    function pathKey(p) {
      return normPathKey(normAbsPath(p))
    }

    function safeJson(v) {
      try { return JSON.stringify(v) } catch (e) { return '' }
    }

    function freshConfig() {
      const g = { quickTools: {}, custom: [], sandboxMode: 'danger-full-access', fallbackMode: 'ask', editorKernel: 'auto' }
      for (const c of CATS) g[c] = freshCategory(c, false)
      for (const k of Object.keys(QUICK_DEFAULTS)) g.quickTools[k] = { action: QUICK_DEFAULTS[k] }
      return { global: g, projects: {} }
    }

    function freshProject() {
      const pb = { quickTools: {}, custom: [], sandboxMode: 'inherit', fallbackMode: 'inherit', editorKernel: 'inherit' }
      for (const c of CATS) pb[c] = freshCategory(c, true)
      return pb
    }

    function freshCategory(key, inheritDefault) {
      // 默认 ask：不可逆/越界/涉及外部执行或输入的分类（含读图）从严；read/subagent 这类只读或可回收的默认放行
      const cat = { mode: inheritDefault ? 'inherit' : (key === 'directory' || key === 'command' || key === 'edit' || key === 'undo' || key === 'image' || key === 'doomloop' ? 'ask' : 'allow') }
      if (EXC_CATS.indexOf(key) !== -1) cat.exceptions = []
      return cat
    }

    // 文本类字段（拒绝原因 / 备注）的统一口径：trim + 截断 200，空串视为未填。
    // 例外、分类默认值、兜底、快捷工具四处共用，避免「写入当下」与「重新加载后」口径不一致。
    function normalizeText(v) {
      return typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : undefined
    }

    function normalizeException(r, key) {
      if (!r || typeof r !== 'object') return null
      if (MODES.indexOf(r.action) === -1) return null
      const value = key === 'command' ? r.match : r.path
      if (typeof value !== 'string' || !value) return null
      const e = { id: r.id || 'e' + Math.random().toString(36).slice(2, 8), action: r.action }
      // reason 与 note 是两种东西，按动作各归其位，互不串用：
      //   reason —— deny 专属，拒绝时随 kind:'deny' 回给 AI（「为什么被拒、该怎么改」）；
      //   note   —— ask 专属，命中时显示在审批弹窗上（「当初为什么特意拦它」），方便日后回看。
      // allow 两者都不存：放行的调用不再弹窗，reason 也用不上。
      // 注意：note 是给人看的备注，不是保密字段——它会随配置一起被 perm_status 等读取权限的调用读到，
      // 故 UI/文档只说「备注」，不承诺「AI 看不到」，也提示用户不要写入敏感信息。
      if (r.action === 'deny') { const t = normalizeText(r.reason); if (t) e.reason = t }
      if (r.action === 'ask') { const t = normalizeText(r.note); if (t) e.note = t }
      if (key === 'command') e.match = value
      else e.path = value
      return e
    }

    function normalizeCategory(raw, key, inheritDefault) {
      const def = freshCategory(key, inheritDefault)
      const c = raw && typeof raw === 'object' ? raw : {}
      const cat = { mode: (inheritDefault ? ALL_MODES : MODES).indexOf(c.mode) !== -1 ? c.mode : def.mode }
      // 分类默认值的拒绝原因：只在 deny 时有用（allow 不弹窗、ask 用自己的 note），
      // 与例外同口径存一个 reason，供 decide() 拼进拒绝文案回给 AI。
      if (cat.mode === 'deny') { const t = normalizeText(c.reason); if (t) cat.reason = t }
      if (EXC_CATS.indexOf(key) !== -1) {
        cat.exceptions = Array.isArray(c.exceptions) ? c.exceptions.map((r) => normalizeException(r, key)).filter(Boolean) : []
      }
      return cat
    }

    // 快捷工具条目：老配置是裸动作字符串（'allow'），本版起是 { action, reason? }。
    // 两种形态都在这一个入口收敛成对象，之后全链路只认对象——以后要给每个工具再加属性时
    // 不必把所有读法再改一遍，也不会出现「动作在一张表、文字在另一张表」的双份真相
    // （那种结构在删除/改名时漏改一张就漂移，正是要避免的堆叠）。
    function normalizeQuickEntry(v) {
      const raw = typeof v === 'string' ? { action: v } : (v && typeof v === 'object' ? v : null)
      if (!raw) return null
      if (ALL_MODES.indexOf(raw.action) === -1) return null
      const out = { action: raw.action }
      // 拒绝原因只在 deny 时有意义：allow 不弹窗、ask 有自己的备注，存了也不会被读到
      if (raw.action === 'deny') { const t = normalizeText(raw.reason); if (t) out.reason = t }
      return out
    }

    function normalizeQuick(q) {
      const out = {}
      if (!q || typeof q !== 'object') return out
      for (const k of Object.keys(q)) {
        const e = normalizeQuickEntry(q[k])
        if (e) out[k] = e
      }
      return out
    }

    function normalizeRule(r) {
      if (!r || typeof r !== 'object') return null
      if (MODES.indexOf(r.action) === -1) return null
      const rule = { id: r.id || 'r' + Math.random().toString(36).slice(2, 8), action: r.action }
      if (r.tool !== undefined && r.tool !== null && r.tool !== '') rule.tool = String(r.tool)
      if (r.path !== undefined && r.path !== null && r.path !== '') rule.path = String(r.path)
      if (r.args !== undefined && r.args !== null && r.args !== '') rule.args = String(r.args)
      if (r.reason !== undefined && r.reason !== null && r.reason !== '') rule.reason = String(r.reason)
      return rule
    }

    function buildConfig(parsed) {
      const g = parsed.global && typeof parsed.global === 'object' ? parsed.global : {}
      const gFb = MODES.indexOf(g.fallbackMode) !== -1 ? g.fallbackMode : 'ask'
      const global = { quickTools: normalizeQuick(g.quickTools), custom: Array.isArray(g.custom) ? g.custom.map(normalizeRule).filter(Boolean) : [], sandboxMode: ['workspace-write', 'danger-full-access'].indexOf(g.sandboxMode) !== -1 ? g.sandboxMode : 'danger-full-access', fallbackMode: gFb, editorKernel: EDITOR_KERNELS.indexOf(g.editorKernel) !== -1 ? g.editorKernel : 'auto' }
      // 兜底拒绝原因：与分类同口径，只在 deny 时保留
      if (gFb === 'deny') { const t = normalizeText(g.fallbackReason); if (t) global.fallbackReason = t }
      for (const c of CATS) global[c] = normalizeCategory(g[c], c, false)
      const projects = {}
      const rawProjects = parsed.projects && typeof parsed.projects === 'object' ? parsed.projects : {}
      for (const key of Object.keys(rawProjects)) {
        const p = rawProjects[key] && typeof rawProjects[key] === 'object' ? rawProjects[key] : {}
        const pFb = ALL_MODES.indexOf(p.fallbackMode) !== -1 ? p.fallbackMode : 'inherit'
        const pb = { quickTools: normalizeQuick(p.quickTools), custom: Array.isArray(p.custom) ? p.custom.map(normalizeRule).filter(Boolean) : [], sandboxMode: ['workspace-write', 'danger-full-access', 'inherit'].indexOf(p.sandboxMode) !== -1 ? p.sandboxMode : 'inherit', fallbackMode: pFb, editorKernel: EDITOR_KERNEL_VALUES.indexOf(p.editorKernel) !== -1 ? p.editorKernel : 'inherit' }
        if (pFb === 'deny') { const t = normalizeText(p.fallbackReason); if (t) pb.fallbackReason = t }
        for (const c of CATS) pb[c] = normalizeCategory(p[c], c, true)
        projects[key] = pb
      }
      return { global, projects }
    }

    function migrateOld(parsed) {
      const g = parsed.global && typeof parsed.global === 'object' ? parsed.global : {}
      const oldMode = ['off', 'permissive', 'locked'].indexOf(g.mode) !== -1 ? g.mode : 'off'
      const cfg = freshConfig()
      const map = { off: 'allow', permissive: 'allow', locked: 'deny' }
      // image 是本版新增的从严分类，不套用老模式映射：off/permissive 老配置按新默认 ask
      // （升级后读图先询问，由用户决定是否放宽），locked 仍保持 deny，避免比旧行为更松。
      for (const c of CATS) cfg.global[c].mode = c === 'image' ? (oldMode === 'locked' ? 'deny' : 'ask') : (map[oldMode] || 'allow')
      cfg.global.fallbackMode = map[oldMode]
      cfg.global.doomloop.mode = oldMode === 'off' ? 'allow' : 'ask'
      if (oldMode === 'locked') {
        for (const k of Object.keys(cfg.global.quickTools)) cfg.global.quickTools[k] = { action: 'deny' }
      }
      cfg.global.custom = Array.isArray(g.rules) ? g.rules.map(normalizeRule).filter(Boolean) : []
      const rawProjects = parsed.projects && typeof parsed.projects === 'object' ? parsed.projects : {}
      for (const key of Object.keys(rawProjects)) {
        const p = rawProjects[key] && typeof rawProjects[key] === 'object' ? rawProjects[key] : {}
        const explicitMode = ['off', 'permissive', 'locked'].indexOf(p.mode) !== -1
        const pm = explicitMode ? p.mode : 'off'
        const pb = { quickTools: {}, custom: Array.isArray(p.rules) ? p.rules.map(normalizeRule).filter(Boolean) : [] }
        for (const c of CATS) {
          pb[c] = freshCategory(c, true)
          // 同上：image 不套用老模式 —— 未显式配置的项目保持 inherit（跟随全局 ask），locked 仍 deny
          if (c === 'image') { if (pm === 'locked') pb[c].mode = 'deny'; continue }
          pb[c].mode = pm === 'off' ? 'allow' : (map[pm] || 'allow')
        }
        pb.doomloop.mode = pm === 'off' ? 'allow' : 'ask'
        // 仅显式配置过旧模式的项目保留旧行为（off→allow）；未显式配置（缺省 off）用 inherit 跟随全局，
        // 否则之后全局收紧兜底时这些老项目仍按 allow 静默放行
        pb.fallbackMode = explicitMode ? (pm === 'off' ? 'allow' : map[pm]) : 'inherit'
        if (pm === 'locked') {
          for (const k of QUICK_PRESET) pb.quickTools[k] = { action: 'deny' }
        }
        cfg.projects[key] = pb
      }
      return cfg
    }

    function sessionPolicy() {
      try { return sp.resolve ? sp.resolve() : null } catch (e) { return null }
    }

    function agentCwd(exec) {
      try {
        const agent = (exec && exec.agent) || agentRef
        if (!agent || !agent.session || !agent.session.header) return undefined
        const c = agent.session.header.cwd
        return typeof c === 'string' && c ? norm(c) : undefined
      } catch (e) { return undefined }
    }

    // 当前会话解析：工具执行上下文 → 最近权限事件会话 → 最后创建的会话（新窗口兜底）
    function currentSession(exec) {
      try {
        const agent = (exec && exec.agent) || agentRef
        if (agent && agent.session) return agent.session
        if (ctx.sessions && typeof ctx.sessions.list === 'function') {
          const all = ctx.sessions.list()
          if (Array.isArray(all) && all.length) return all[all.length - 1]
        }
      } catch (e) {}
      return null
    }

    // 当前会话选中的权限预设：显式 permission/preset 事件优先（保持既有语义，
    // 即使 knobs 被手动改偏也按所选预设审查）；无显式事件时用
    // permissionPresets.current() 派生（覆盖仅由 knobs 决定的会话）。
    // 兼容层：0.1.2 读 permissions 投影折叠态（permissionState API，等价于 0.1.1 的
    // effectivePermissionPreset(events)）；0.1.1 无该 API 时自行折叠 session.events。
    function explicitPreset(session) {
      try {
        const pp = ctx.permissionPresets
        if (pp && typeof pp.permissionState === 'function') {
          // 0.1.2：读取 permissions 投影折叠态得到显式选择
          return pp.permissionState(session).preset || null
        }
        // 0.1.1 兼容：无 permissionState API 时自行折叠 session.events 日志，
        // 取最后一个 permission/preset 事件（与 0.1.1 导出的
        // effectivePermissionPreset(events) 同算法）。
        const evs = session && session.events
        if (Array.isArray(evs)) {
          for (let i = evs.length - 1; i >= 0; i--) {
            const e = evs[i]
            if (e && e.type === 'permission/preset' && e.data) return e.data.preset || null
          }
        }
      } catch (e) {}
      return null
    }

    function sessionPresetName(exec) {
      try {
        const session = currentSession(exec)
        if (!session) return null
        const explicit = explicitPreset(session)
        if (explicit) return explicit
        const pp = ctx.permissionPresets
        if (pp && typeof pp.current === 'function') {
          // 0.1.2 起 current 收 session；0.1.1 收 events 数组（foldKnobs 遍历）。
          // 以 permissionState API 是否存在作为 0.1.2 特征检测。
          const arg = typeof pp.permissionState === 'function' ? session : (session && session.events)
          const c = pp.current(arg)
          return c === 'custom' ? null : c
        }
      } catch (e) {}
      return null
    }

    // 底层沙箱有效值：项目非 inherit 用项目值，否则用全局值
    function effectiveSandboxConfig() {
      const proj = projectBlock()
      const p = proj && proj.sandboxMode ? proj.sandboxMode : 'inherit'
      if (p !== 'inherit') return p
      return config.global.sandboxMode || 'danger-full-access'
    }

    function setSandboxConfig(target, mode) {
      if (target === 'global') {
        if (mode !== 'workspace-write' && mode !== 'danger-full-access') return false
        config.global.sandboxMode = mode
        return true
      }
      if (mode !== 'workspace-write' && mode !== 'danger-full-access' && mode !== 'inherit') return false
      const block = ensureProject()
      block.sandboxMode = mode
      return true
    }

    // 会话处于「自定义审查」时，把解析后的底层沙箱同步为会话 sandbox
    function syncSandbox(exec) {
      try {
        if (sessionPresetName(exec) !== 'custom-review') return
        const mode = effectiveSandboxConfig()
        const agent = (exec && exec.agent) || agentRef
        const session = agent && agent.session
        if (!session) return
        const cur = sp.overrideOf(session)
        if (cur !== mode) setSandboxMode(session, mode)
      } catch (e) {
        console.error('[permgate] syncSandbox error:', e)
      }
    }

    // 写类工具 + 目标在工作区外 + 会话沙箱受限（workspace-write）→ 需要沙箱升级
    function needsUpgrade(exec) {
      try {
        if (!isFileWrite(exec.name, exec.arguments) && !isUndo(exec.name)) return false
        const fp = pathArg(exec.arguments)
        if (!fp || !isOutside(fp, root)) return false
        const agent = (exec && exec.agent) || agentRef
        const session = agent && agent.session
        if (!session) return false
        return sp.overrideOf(session) === 'workspace-write'
      } catch (e) { return false }
    }

    // 发起 DSH 原生沙箱升级审批；批准后临时把会话沙箱设为 full access，
    // 工具执行读到放开状态即可写工作区外；执行完成后由 post-execute 写回。
    async function requireSandboxUpgrade(exec) {
      try {
        const agent = exec.agent
        const session = agent && agent.session
        if (!agent || !session) return false
        const outcome = await ctx.approval.request({
          agent,
          toolName: exec.name,
          callId: exec.callId,
          reason: (uiLang === 'en' ? 'Sandbox upgrade required: write outside workspace ' : '需要沙箱升级：工作区外写入 ') + (pathArg(exec.arguments) || ''),
          signal: exec.signal,
        })
        if (outcome !== 'allowed-once') return false
        upgradedCalls.set(exec.token, { session, prev: sp.overrideOf(session) || 'workspace-write' })
        setSandboxMode(session, 'danger-full-access')
        return true
      } catch (e) {
        console.error('[permgate] requireSandboxUpgrade error:', e)
        return false
      }
    }

    // 兜底：异常/取消路径残留的升级在下次调用前写回
    function flushStaleUpgrades() {
      if (!upgradedCalls.size) return
      for (const rec of upgradedCalls.values()) {
        try { if (rec && rec.session) setSandboxMode(rec.session, rec.prev || 'workspace-write') } catch (e) {}
      }
      upgradedCalls.clear()
    }

    // 从宿主环境变量/系统 home 解析 DSH home（跨平台，且能省掉一次 cmd 子进程探测）：
    // DSH_HOME 本身即 home；否则 用户家目录 + '/.dsh'
    function homeFromEnv() {
      try {
        const win = process.platform === 'win32'
        // win32 上还要求盘符或 UNC 前缀（charCode 92 为反斜杠、47 为斜杠），
        // 避免 /c/Users/x 这类取值被 path.resolve 解析到当前盘
        const isWinAbs = (s) => (s.length > 2 && s.charAt(1) === ':' && (s.charCodeAt(2) === 92 || s.charCodeAt(2) === 47)) || (s.charCodeAt(0) === 92 && s.charCodeAt(1) === 92)
        const localAbs = (v) => {
          const s = String(v == null ? '' : v).trim()
          if (!s || !pathIsAbsolute(s)) return null
          if (win && !isWinAbs(s)) return null
          return norm(s)
        }
        // 顺序与 harness（@deepseek-ai/dsh-home-paths）一致：DSH_HOME → os.homedir()/.dsh → HOME/USERPROFILE
        const dh = localAbs(process.env.DSH_HOME)
        if (dh) return dh
        const oh = osHomedir()
        if (oh) return norm(String(oh) + '/.dsh')
        const h = localAbs(process.env.HOME || process.env.USERPROFILE)
        if (h) return norm(h + '/.dsh')
      } catch (e) {}
      return null
    }

    // home 配置目标路径统一：ensureTarget/persist/probeHomeConfig/load 共用同一拼接，
    // 避免同一路径多处内联后漂移（读一个文件、写另一个文件）
    async function homeConfigTarget(home) {
      return await fs.resolve(String(home) + '/dsh-permgate/config.json')
    }

    async function resolveDshHome() {
      if (dshHomeCache !== null) return dshHomeCache
      // 失败不缓存（初始化早期 subprocess 可能未就绪，保持 null 以便后续重试），
      // 但抑制短时间内重复重试：load/persist 一次流程会多次调用本函数
      if (dshHomeFailAt && Date.now() - dshHomeFailAt < HOME_FAIL_TTL_MS) return null
      // 先看宿主环境变量与系统 home（跨平台）：cmd 探测只在 Windows 可用，
      // 仅依赖它会让 macOS/Linux 上 home 恒解析失败、配置永久无法落盘
      const envHome = homeFromEnv()
      if (envHome) { dshHomeCache = envHome; return dshHomeCache }
      try {
        const sub = ctx.get('subprocess')
        if (!sub) { dshHomeFailAt = Date.now(); return dshHomeCache }
        const exe = await sub.resolveExecutable('cmd')
        const tryEcho = async (expr) => {
          const handle = sub.spawn({
            argv: [exe, '/c', 'echo', expr],
            cwd: String(root || 'C:\\').replace(/\//g, '\\'),
            stdio: { stdin: 'ignore', stdout: { maxBytes: 8192 }, stderr: { maxBytes: 8192 } },
            graceMs: 5000,
          })
          await handle.done
          const out = handle.collected.stdout ? handle.collected.stdout.readFrom(0).text : ''
          return String(out || '').trim()
        }
        let home = await tryEcho('%DSH_HOME%')
        if (home && home.indexOf('%') === -1 && (home.indexOf(':') !== -1 || home.indexOf('/') === 0 || home.indexOf('\\') === 0)) {
          dshHomeCache = norm(home)
          return dshHomeCache
        }
        const profile = await tryEcho('%USERPROFILE%')
        if (profile && profile.indexOf('%') === -1 && profile.indexOf(':') !== -1) {
          dshHomeCache = norm(profile + '/.dsh')
          return dshHomeCache
        }
      } catch (e) {
        console.error('[permgate] resolveDshHome error:', e)
      }
      dshHomeFailAt = Date.now()
      return dshHomeCache
    }

    async function ensureTarget(exec) {
      const cwd = agentCwd(exec)
      const pol = sessionPolicy()
      const base = cwd || (pol && pol.workspaceRoot ? norm(String(pol.workspaceRoot)) : '') || (fallbackRoot ? norm(fallbackRoot) : '')
      const source = cwd ? 'agent' : 'policy'
      if (target && rootSource === source && norm(root) === norm(base)) return target
      root = base
      rootSource = source
      const home = await resolveDshHome()
      const resolved = home
        ? await homeConfigTarget(home)
        : await fs.resolve(base ? base + '/.dsh/.permgate.json' : '.dsh/.permgate.json')
      // 配置路径发生切换时不重置磁盘快照：persist 的防覆盖守卫（磁盘内容 vs 快照）依赖它，
      // 置空会让守卫整段跳过，可能用「旧路径加载的内存配置」静默覆盖新路径上已存在的配置。
      // 切换后由 load() 对新目标重新建立快照基线；若 persist 在切换后未经 load 直接保存，
      // 守卫会因新旧目标内容不一致而拒绝并提示「重新加载配置文件」，方向安全。
      target = resolved
      return target
    }

    async function ensureConfigDir() {
      try {
        const home = await resolveDshHome()
        if (home) {
          const d = await fs.resolve(home + '/dsh-permgate')
          const info = await fs.stat(d)
          if (info) return true
          const sub = ctx.get('subprocess')
          if (!sub) return false
          const exe = await sub.resolveExecutable('cmd')
          const winPath = String(home + '/dsh-permgate').replace(/\//g, '\\')
          const handle = sub.spawn({
            argv: [exe, '/c', 'mkdir', winPath],
            cwd: String(root || 'C:\\').replace(/\//g, '\\'),
            stdio: { stdin: 'ignore', stdout: { maxBytes: 8192 }, stderr: { maxBytes: 8192 } },
            graceMs: 5000,
          })
          await handle.done
          return true
        }
        // home 不可用（初始化早期 subprocess 未就绪等）时不再创建目录：旧实现在此
        // mkdir <root>/.dsh，而 home 恢复后配置写回 home，项目里只留下一个空 .dsh。
        // 配置目录应与实际写入位置一致；home 不可用是暂时状态，重试即恢复。
        return false
      } catch (e) {
        console.error('[permgate] ensureConfigDir error:', e)
        return false
      }
    }

    async function init(exec) {
      if (exec && exec.agent) agentRef = exec.agent
      await ensureTarget(exec)
      await ensureConfigDir()
      if (!loaded) {
        loaded = true
        await load(exec)
        await cleanupStaleProjects()
      }
    }

    async function cleanupStaleProjects() {
      try {
        const projs = config.projects || {}
        const keys = Object.keys(projs)
        if (!keys.length) return
        let removed = []
        for (const key of keys) {
          if (norm(key).toLowerCase() === norm(root).toLowerCase()) continue
          let exists = false
          try {
            const d = await fs.resolve(norm(key))
            const info = await fs.stat(d)
            exists = !!info
          } catch (e) { exists = false }
          if (!exists) {
            delete projs[key]
            removed.push(key)
          }
        }
        if (removed.length) {
          console.log('[permgate] 清理失效工作区配置:', removed.join(', '))
          await persist()
        }
      } catch (e) {
        console.error('[permgate] cleanupStaleProjects error:', e)
      }
    }

    function globToRegExp(glob) {
      const g = norm(glob)
      let out = ''
      for (let i = 0; i < g.length; i++) {
        const c = g[i]
        if (c === '*') {
          if (g[i + 1] === '*') { out += '.*'; i++ }
          else out += '[^/]*'
        } else if (c === '?') {
          out += '[^/]'
        } else if ('\\^$.[]{}()|+-'.indexOf(c) !== -1) {
          out += '\\' + c
        } else {
          out += c
        }
      }
      return new RegExp('^' + out + '$', 'i')
    }

    function matchGlob(glob, value) {
      try { return globToRegExp(glob).test(norm(value)) } catch (e) { return false }
    }

    function matchCommand(pat, hay) {
      const p = String(pat || '')
      const h = String(hay || '')
      // 空 pattern 不匹配任何命令（否则 indexOf('') === 0 恒真，等于放行所有命令）
      if (!p) return false
      if (p.indexOf('*') === -1 && p.indexOf('?') === -1) return h.toLowerCase().indexOf(p.toLowerCase()) !== -1
      let body = p
      let tail = '.*'
      // 「cmd *」尾随通配：也匹配无参数的原命令（git status * 同时覆盖 git status）
      if (p.endsWith(' *')) {
        body = p.slice(0, -2)
        tail = '( .*)?'
      }
      let re = ''
      for (const c of body) {
        if (c === '*') re += '.*'
        else if (c === '?') re += '.'
        else if ('\\^$.[]{}()|+-'.indexOf(c) !== -1) re += '\\' + c
        else re += c
      }
      re += tail
      try { return new RegExp('^' + re + '$', 'i').test(h) } catch (e) { return false }
    }

    function collectStrings(v, acc) {
      if (typeof v === 'string') acc.push(v)
      else if (Array.isArray(v)) { for (const x of v) collectStrings(x, acc) }
      else if (v && typeof v === 'object') { for (const k of Object.keys(v)) collectStrings(v[k], acc) }
    }

    function ruleMatches(rule, name, args) {
      if (rule.tool && !matchGlob(rule.tool, name)) return false
      if (rule.path) {
        const acc = []
        collectStrings(args, acc)
        if (!acc.some((s) => matchGlob(rule.path, s))) return false
      }
      if (rule.args) {
        let hay = ''
        try { hay = JSON.stringify(args) } catch (e) { hay = '' }
        if (hay.toLowerCase().indexOf(String(rule.args).toLowerCase()) === -1) return false
      }
      return true
    }

    function projectBlock() {
      const key = norm(root).toLowerCase()
      const projs = config.projects || {}
      for (const k of Object.keys(projs)) {
        if (norm(k).toLowerCase() === key) return projs[k]
      }
      return undefined
    }

    function ensureProject() {
      // 与 projectBlock() 同口径查找：迁移来的 key 可能只是大小写/斜杠形式不同，
      // 若这里用精确 root 查找会另建一个条目，同一项目出现两个 key（面板改动看似无效）
      const key = norm(root).toLowerCase()
      const projs = config.projects || {}
      for (const k of Object.keys(projs)) {
        if (norm(k).toLowerCase() === key) return projs[k]
      }
      if (!config.projects) config.projects = {}
      config.projects[root] = freshProject()
      return config.projects[root]
    }

    // 分类默认值写入单点（面板路由与 perm_set_category 共用）。
    // reason 是「拒绝原因」：只在 mode=deny 时有意义，切成别的动作时一并清掉——
    // 否则配置里会留着一条对当前动作无效的僵尸文字，面板再切回 deny 时又冒出来，看着像没保存成功。
    // 但「没传 reason」不等于「要清掉」：perm_set_category 与 HTTP 直连可能只想重设动作或确认当前值，
    // 一律删除会让用户写好的原因在一次无关写入后静默消失。故 reason 的三种语义分开：
    //   未提供（undefined）—— 保留原值；空串/纯空白 —— 显式清除；有内容 —— 覆盖。
    function setCategoryMode(targetKey, cat, mode, reason) {
      const allowed = targetKey === 'global' ? MODES : ALL_MODES
      if (allowed.indexOf(mode) === -1) return false
      const block = targetKey === 'global' ? config.global : ensureProject()
      if (!block[cat]) block[cat] = freshCategory(cat, targetKey !== 'global')
      block[cat].mode = mode
      if (mode !== 'deny') { delete block[cat].reason; return true }
      if (reason === undefined) return true
      const t = normalizeText(reason)
      if (t) block[cat].reason = t
      else delete block[cat].reason
      return true
    }

    // 快捷工具写入单点（面板路由、perm_set_quick 与弹窗「记住此决定」共用）。
    // action=inherit 表示删除该键（回落到下一级：全局键 → 预设默认 → 兜底）。
    // reason 语义与 setCategoryMode 一致：未提供（undefined）保留该键原有原因、空串显式清除、有内容覆盖。
    function setQuickAction(targetKey, tool, action, reason) {
      if (ALL_MODES.indexOf(action) === -1) return false
      const block = targetKey === 'project' ? ensureProject() : config.global
      if (!block.quickTools) block.quickTools = {}
      if (action === 'inherit') { delete block.quickTools[tool]; return true }
      // 与 normalizeQuickEntry 同构：只存 { action } / { action, reason }，deny 才带原因
      if (action !== 'deny') { block.quickTools[tool] = { action }; return true }
      const prev = block.quickTools[tool]
      const prevReason = prev && typeof prev === 'object' && prev.action === 'deny' ? prev.reason : undefined
      const t = reason === undefined ? prevReason : normalizeText(reason)
      block.quickTools[tool] = t ? { action, reason: t } : { action }
      return true
    }

    // 覆盖语义统一：project 显式配置优先、inherit 穿透到 global、缺省用 def。
    // fallback 与分类 mode 共用（缺省值不同：fallback='ask'、分类='allow'），避免覆盖判定独立演化
    function firstEffective(projVal, globalVal, def) {
      if (projVal && projVal !== 'inherit') return projVal
      return globalVal || def
    }

    // 编辑器内核判别：str_replace_editor 可能被 dsh-better-edit 的同名 shadow 实现覆盖，
    // 两者 insert 的 insert_line 语义相反（内置 0 基、插到该行之后 / shadow 1 基、插到该行之前），
    // 预览必须按实际生效的那个算，否则会把插入位置画到错误的地方。
    // 判别顺序：显式配置 > 工具描述探测 > 回退内置（内置始终存在）。
    function editorKernelSetting() {
      const proj = projectBlock()
      return firstEffective(proj && proj.editorKernel, config.global.editorKernel, 'auto')
    }

    function detectEditorKernel(exec) {
      try {
        const tools = ctx.tools
        if (!tools || typeof tools.get !== 'function') return null
        const def = tools.get('str_replace_editor', (exec && exec.agent) || agentRef)
        // 内置的「AFTER the line」只出现在 insert_line 的**参数**描述里（顶层描述没有该短语），
        // 故把参数描述一并纳入匹配，使两种内核都能被正向识别，而不是让内置只能靠回退
        const top = def && typeof def.description === 'string' ? def.description : ''
        const params = def && def.parameters && typeof def.parameters === 'object' ? def.parameters : null
        // defineTool 编译后 parameters 是 JSON Schema（{type:'object', properties:{...}}），
        // 参数描述在 properties.insert_line.description；兼容可能存在的旧式扁平结构
        const props = params && params.properties && typeof params.properties === 'object' ? params.properties : params
        const insDesc = (props && props.insert_line && typeof props.insert_line.description === 'string') ? props.insert_line.description : ''
        const desc = top + '\n' + insDesc
        if (!desc.trim()) return null
        // shadow: "inserts new line(s) before insert_line (1-indexed, lines+1 appends)"
        if (/before\s+insert_line/i.test(desc) || /1-indexed/i.test(desc)) return 'shadow'
        // 内置: "The `new_str` will be inserted AFTER the line `insert_line`"
        if (/AFTER the line/i.test(desc)) return 'builtin'
        return null
      } catch (e) { return null }
    }

    function resolveEditorKernel(exec) {
      const setting = editorKernelSetting()
      if (setting === 'builtin' || setting === 'shadow') return { kernel: setting, source: 'config' }
      const detected = detectEditorKernel(exec)
      if (detected) return { kernel: detected, source: 'detected' }
      return { kernel: 'builtin', source: 'fallback' }
    }

    function setEditorKernel(targetKey, mode) {
      const allowed = targetKey === 'global' ? EDITOR_KERNELS : EDITOR_KERNEL_VALUES
      if (allowed.indexOf(mode) === -1) return false
      const block = targetKey === 'global' ? config.global : ensureProject()
      block.editorKernel = mode
      return true
    }

    // 兜底策略：未匹配任何规则的调用如何处理（project 覆盖 global，默认 ask）。
    // 与分类默认值同构：mode 与它自己的拒绝原因同源取用——项目显式配置就取项目的，
    // 项目是 inherit 才穿透到全局的（否则会出现「动作来自项目、文字来自全局」的错配）。
    function fallbackSetting() {
      const proj = projectBlock()
      const pv = proj && proj.fallbackMode
      if (pv && pv !== 'inherit') return { mode: pv, reason: normalizeText(proj.fallbackReason) }
      return { mode: config.global.fallbackMode || 'ask', reason: normalizeText(config.global.fallbackReason) }
    }

    function fallbackMode() {
      return fallbackSetting().mode
    }

    function setFallbackMode(targetKey, mode, reason) {
      const allowed = targetKey === 'global' ? MODES : ALL_MODES
      if (allowed.indexOf(mode) === -1) return false
      const block = targetKey === 'global' ? config.global : ensureProject()
      block.fallbackMode = mode
      // 与分类同口径：拒绝原因只在 deny 时保留，切走时清掉；
      // 未提供 reason（undefined）保留原值，避免无关写入静默清空用户写好的原因。
      if (mode !== 'deny') { delete block.fallbackReason; return true }
      if (reason === undefined) return true
      const t = normalizeText(reason)
      if (t) block.fallbackReason = t
      else delete block.fallbackReason
      return true
    }

    function matchException(r, value, kind) {
      // 路径两侧统一走 normAbsPath：写入值可能来自候选（规范绝对路径），而 value 是
      // 工具参数原文（可能是相对路径或含 ..）——只规范化写入侧会让例外永不命中。
      if (kind === 'path') return matchGlob(normAbsPath(r.path), normAbsPath(value))
      return matchCommand(r.match, value)
    }

    function resolveCategory(catKey, value, kind) {
      const proj = projectBlock()
      const pCat = proj ? proj[catKey] : undefined
      const gCat = config.global[catKey] || freshCategory(catKey, false)
      if (value !== null && value !== undefined && EXC_CATS.indexOf(catKey) !== -1) {
        const pl = pCat && Array.isArray(pCat.exceptions) ? pCat.exceptions : []
        for (const r of pl) if (matchException(r, value, kind)) return { action: r.action, ruleId: r.id, reason: (r.action === 'deny' && r.reason) ? r.reason : undefined, note: (r.action === 'ask' && r.note) ? r.note : undefined }
        const gl = Array.isArray(gCat.exceptions) ? gCat.exceptions : []
        for (const r of gl) if (matchException(r, value, kind)) return { action: r.action, ruleId: r.id, reason: (r.action === 'deny' && r.reason) ? r.reason : undefined, note: (r.action === 'ask' && r.note) ? r.note : undefined }
      }
      // 没命中例外 → 落分类默认值：它的拒绝原因与 mode 同源取用（项目显式配置就取项目的，
      // 项目 inherit 才穿透全局），避免「动作来自项目、文字来自全局」的错配。
      const pv = pCat && pCat.mode
      if (pv && pv !== 'inherit') return { action: pv, ruleId: null, reason: normalizeText(pCat.reason) }
      // 项目未显式配置（缺失或 inherit）才穿透全局：此处 pv 已确定不生效，
      // 故直接取全局值，不再经 firstEffective 传一个恒不命中的 projVal（与 fallbackSetting 同形）。
      return { action: gCat.mode || 'allow', ruleId: null, reason: normalizeText(gCat.reason) }
    }

    function pathArg(args) {
      try {
        if (!args || typeof args !== 'object') return null
        // 工具参数里的文件路径：str_replace_editor（内置与 better-edit shadow）只读 path，
        // 而 read/write 用 file_path。若统一让 file_path 优先，agent 同时传两个字段时就会
        // 「审查/预览看一个文件、实际写另一个文件」，故先按工具语义取 path
        if (typeof args.command === 'string' && typeof args.path === 'string') return args.path
        if (typeof args.file_path === 'string') return args.file_path
        if (typeof args.path === 'string') return args.path
        return null
      } catch (e) { return null }
    }

    // 工具参数里的文件路径可能是相对路径：fs 服务默认按自身 cwd 解析，会解析到错误位置
    // （导致「文件不存在」/ 打不开文件）。这里把相对路径先按指定根（缺省用 permgate 项目
    // root）归一化为绝对路径；绝对路径 / UNC / file:// 原样返回。
    function resolveArgPath(fp, base) {
      const s = norm(String(fp || ''))
      if (s === '') return s
      if (s.indexOf('://') !== -1) return s
      if (/^[a-zA-Z]:[\\/]/.test(s)) return s
      if (s[0] === '/') return s
      const b = base || root
      return b ? norm(b + '/' + s) : s
    }


    // ── 文件对比数据（按需路由 /permgate/file-diff 生成）───────────────
    // 弹窗「详情」与右侧对比抽屉共用：edit/write 生成行级 Myers diff 操作流，
    // 客户端渲染成带行号/底色的 unified diff（dsh-file-review 风格）；read 返回
    // 文件内容预览。软失败：内容过大/读取失败返回 {ok:false}；变更行数或中间区
    // 过大时走 fallback 旧式 ± 视图（前 200 变更行 + 截断计数，不阻塞审批）。
    // DIFF_MAX_CHARS：对比双方文本总长上限（edit 为磁盘全文+新文本；write 为磁盘+内容）。
    // 1MB 覆盖常见大文件（如打包产物）；超限返回「文件过大，无法生成对比」。
    const DIFF_MAX_LINES = 200
    // Myers 中间区行数预算：超限走旧式 fallback（避免 trace 内存暴涨）。2048 行最坏时
    // trace 累计约 33MB 瞬时分配 + 数百万次迭代（服务端主线程）；512 行时约 2MB/数十万次，
    // 足够覆盖常规编辑场景。
    const DIFF_BUDGET_LINES = 512
    // 行尾归一化（CRLF/CR → LF）：splitDiffLines 与 edit 预览的归一化匹配共用同一规则，
    // 保证 fileNorm.indexOf(oldNorm) 得到的偏移与 splitDiffLines 的行边界精确对齐
    function normEol(s) {
      return String(s == null ? '' : s).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    }
    function splitDiffLines(s) {
      return normEol(s).split('\n')
    }

    // 统计字符串 [0, end) 区间的换行数：只计数不物化数组
    //（避免为取一个行号对最大 1MB 文本 split 出数十万元素的数组）
    function countNewlines(s, end) {
      const t = String(s == null ? '' : s)
      const n = Math.min(typeof end === 'number' ? end : t.length, t.length)
      let c = 0
      for (let i = 0; i < n; i++) if (t.charCodeAt(i) === 10) c++
      return c
    }

    // 公共前缀/后缀长度（行对齐共用）：computeLineDiff 与 undo 窗口预览复用，避免同一算法两份实现漂移
    function commonPrefixLen(a, b) {
      const maxP = Math.min(a.length, b.length)
      let p = 0
      while (p < maxP && a[p] === b[p]) p++
      return p
    }
    function commonSuffixLen(a, b, prefix) {
      let s = 0
      while (s < a.length - prefix && s < b.length - prefix && a[a.length - 1 - s] === b[b.length - 1 - s]) s++
      return s
    }
    function computeLineDiff(oldText, newText, baseLine) {
      const b = baseLine || 1
      const oldLines = splitDiffLines(oldText)
      const newLines = splitDiffLines(newText)
      const prefix = commonPrefixLen(oldLines, newLines)
      const suffix = commonSuffixLen(oldLines, newLines, prefix)
      const removed = oldLines.slice(prefix, oldLines.length - suffix)
      const added = newLines.slice(prefix, newLines.length - suffix)
      const lines = []
      let shownR = 0
      let shownA = 0
      const n = Math.max(removed.length, added.length)
      for (let i = 0; i < n; i++) {
        if (lines.length >= DIFF_MAX_LINES) break
        // 行号：差异区从 prefix+1 行开始；删除行标旧文件行号，新增行标新文件行号
        const no = String(prefix + i + b).padStart(4, ' ')
        if (i < removed.length) { lines.push('- ' + no + ' ' + removed[i]); shownR++ }
        if (i < added.length) { lines.push('+ ' + no + ' ' + added[i]); shownA++ }
      }
      return { added: added.length, removed: removed.length, lines, truncated: (removed.length - shownR) + (added.length - shownA) }
    }
    // Myers 行级 diff：返回相对输入数组的 op 流（t: c/a/d，o/n: 1 基行号，s: 行文本）
    function myersOps(a, b) {
      const n = a.length
      const m = b.length
      // 双空输入防御：d 循环（d<=max=0）只跑 d=0 一轮且 done 置不齐，回溯 trace[1]
      // 不存在 → undefined[-1] 崩溃；直接返回空 op 流。
      if (n === 0 && m === 0) return []
      const max = n + m
      const off = max
      const v = new Int32Array(2 * max + 1)
      const trace = []
      let d = 0
      let done = false
      for (; d <= max; d++) {
        trace.push(v.slice())
        for (let k = -d; k <= d; k += 2) {
          let x
          if (k === -d || (k !== d && v[k - 1 + off] < v[k + 1 + off])) x = v[k + 1 + off]
          else x = v[k - 1 + off] + 1
          let y = x - k
          while (x < n && y < m && a[x] === b[y]) { x++; y++ }
          v[k + off] = x
          if (x >= n && y >= m) { done = true; break }
        }
        if (done) break
      }
      const ops = []
      let x = n
      let y = m
      for (let di = d; di > 0; di--) {
        const prev = trace[di]
        const k = x - y
        const kOff = k + off
        let prevK
        if (k === -di || (k !== di && prev[kOff - 1] < prev[kOff + 1])) prevK = k + 1
        else prevK = k - 1
        const px = prev[prevK + off]
        const py = px - prevK
        while (x > px && y > py) { ops.push({ t: 'c', o: x, n: y, s: a[x - 1] }); x--; y-- }
        if (x === px) { ops.push({ t: 'a', o: null, n: y, s: b[y - 1] }); y-- }
        else { ops.push({ t: 'd', o: x, n: null, s: a[x - 1] }); x-- }
      }
      while (x > 0 && y > 0) { ops.push({ t: 'c', o: x, n: y, s: a[x - 1] }); x--; y-- }
      ops.reverse()
      return ops
    }
    function parseEntryArgs(entry) {
      try {
        const v = JSON.parse(entry.argsJson || '{}')
        return v && typeof v === 'object' ? v : {}
      } catch (e) { return {} }
    }
    // 上下文运行折叠：>12 行时保留头尾各 3 行，中间折叠为 gap（c: 隐藏行数，lines: 可展开数据）。
    // MAX_CTX 为 gap 携带的隐藏行上限（100000）：未超过时 gap 携带完整行数据、可展开；
    // 超过时 op.lines 为 null，客户端降级为「…」提示（pg2-gap-more）。pos 决定 gap 与
    // 上下文的位置（避免 gap 前后都贴内容显得突兀）：
    // - lead（窗口/文件开头段）：gap 在外侧，尾部 3 行贴改动侧
    // - trail（结尾段）：头部 3 行贴改动侧，gap 在外侧
    // ≤12 行的小段直接全显示不折叠。
    function pushCtxRun(out, lines, startOld, startNew, pos) {
      const MAX_CTX = 100000
      const FULL = 12
      let o = startOld
      let n = startNew
      if (lines.length <= FULL) {
        for (const s of lines) { out.push({ t: 'c', o, n, s }); o++; n++ }
        return
      }
      const push = (arr) => {
        for (const s of arr) { out.push({ t: 'c', o, n, s }); o++; n++ }
      }
      // 仅在隐藏行数不超过 MAX_CTX（需要携带行数据）时才做 slice/map，避免对超大上下文
      // 段先整段复制再丢弃（服务端主线程瞬时大数组分配）。
      const gap = (hidden, mk) => {
        out.push({ t: 'g', c: hidden, lines: hidden <= MAX_CTX ? mk() : null })
        o += hidden
        n += hidden
      }
      if (pos === 'lead') {
        gap(lines.length - 3, () => lines.slice(0, lines.length - 3).map((s, i) => ({ o: o + i, n: n + i, s })))
        push(lines.slice(lines.length - 3))
      } else if (pos === 'trail') {
        push(lines.slice(0, 3))
        gap(lines.length - 3, () => lines.slice(3).map((s, i) => ({ o: o + i, n: n + i, s })))
      }
    }
    // 完整 diff payload（pretty 模式）；超限时自动降级为旧式 fallback（不返回 null）。
    // baseLine：窗口化对比时传入窗口首行的真实行号（默认 1），保证行号与文件实际位置一致。
    function diffPayloadOrFallback(fp, oldText, newText, kind, baseLine) {
      const base = baseLine || 1
      const oldLines = splitDiffLines(oldText)
      const newLines = splitDiffLines(newText)
      const p = commonPrefixLen(oldLines, newLines)
      const s = commonSuffixLen(oldLines, newLines, p)
      const midA = oldLines.slice(p, oldLines.length - s)
      const midB = newLines.slice(p, newLines.length - s)
      // 完全相同（含空窗口）：无差异，直接返回空 ops。
      // 不能落入 myersOps([], [])：其 d 循环读 v[off+1] 越界 undefined 置不齐 done，
      // 回溯取 trace[d]（d=1 时不存在）→ undefined[-1] 抛
      // "Cannot read properties of undefined (reading '-1')"。
      if (midA.length === 0 && midB.length === 0) {
        return { ok: true, kind, file: fp, added: 0, removed: 0, ops: [], truncated: 0 }
      }
      // 廉价预过滤：|midA.length - midB.length| > DIFF_MAX_LINES 时 added+removed 必超 200
      // （added - removed === midB.length - midA.length），Myers 结果必被丢弃，直接走 fallback，
      // 避免无谓的 O((N+M)*D) 计算与 trace 内存。
      if (Math.abs(midA.length - midB.length) > DIFF_MAX_LINES) {
        const d = computeLineDiff(oldText, newText, base)
        return { ok: true, kind, file: fp, fallback: true, added: d.added, removed: d.removed, lines: d.lines, truncated: d.truncated }
      }
      if (midA.length + midB.length <= DIFF_BUDGET_LINES) {
        const ops = myersOps(midA, midB)
        let added = 0
        let removed = 0
        for (const op of ops) {
          if (op.t === 'a') added++
          else if (op.t === 'd') removed++
        }
        if (added + removed <= DIFF_MAX_LINES) {
          const out = []
          pushCtxRun(out, oldLines.slice(0, p), base, base, 'lead')
          for (const op of ops) out.push({ t: op.t, o: op.o === null ? null : op.o + p + base - 1, n: op.n === null ? null : op.n + p + base - 1, s: op.s })
          let curO = base + p
          let curN = base + p
          for (const op of ops) {
            if (op.o !== null) curO++
            if (op.n !== null) curN++
          }
          pushCtxRun(out, oldLines.slice(oldLines.length - s), curO, curN, 'trail')
          return { ok: true, kind, file: fp, added, removed, ops: out, truncated: 0 }
        }
      }
      const d = computeLineDiff(oldText, newText, base)
      return { ok: true, kind, file: fp, fallback: true, added: d.added, removed: d.removed, lines: d.lines, truncated: d.truncated }
    }
    // 新文件（write 到不存在路径）：全部为新增行
    function newFilePayload(fp, content) {
      const total = splitDiffLines(content).length
      if (total > DIFF_MAX_LINES) {
        const lines = splitDiffLines(content).slice(0, DIFF_MAX_LINES).map((l, i) => '+ ' + String(i + 1).padStart(4, ' ') + ' ' + l)
        return { ok: true, kind: 'new', file: fp, fallback: true, added: total, removed: 0, lines, truncated: total - lines.length }
      }
      const ops = splitDiffLines(content).map((s, i) => ({ t: 'a', o: null, n: i + 1, s }))
      return { ok: true, kind: 'new', file: fp, added: total, removed: 0, ops, truncated: 0 }
    }

    // ── dsh-better-edit 兼容：hash 锚点 edit 的 diff 预览 ──────────────────
    // better-edit 的 edit 参数是 {path, edits:[[remove_from,remove_to,replacement_text],...]}，
    // 锚点是 3 字符行 hash（来自 read 输出的 HASH│ 前缀）。要生成 diff 需把 hash 映射回行号：
    // better-edit 把每行 hash 持久化在 ~/.dsh/plugins/dsh-better-edit/runtime/<ws>-<hash8>/hash-store.sqlite
    // （snapshots 表：path → hashes JSON 数组，按行对应）。permgate 扫描 runtime 目录、用 .wsPath
    // sidecar 匹配项目根，读目标文件的 hashes，再按 [start,end] 行区间应用替换。
    // 任何一步失败（store 不存在/无快照/锚点失效）→ 降级为补丁意图展示，不阻塞审批。
    const BETTER_EDIT_ANCHOR_RE = /^([+-]?)([A-Za-z0-9]{3})[│|]/i
    function betterEditAnchor(ref) {
      try {
        const s = String(ref || '').trim()
        const m = s.match(BETTER_EDIT_ANCHOR_RE)
        if (m) return m[2]
        if (/^[A-Za-z0-9]{3}$/.test(s)) return s
        return null
      } catch (e) { return null }
    }
    // better-edit store 定位缓存（projRoot → store 路径）：runtime 目录扫描是 30+ 次文件 IO，
    // 每次 undo/edit 预览详情都重复执行；projRoot 在会话内不变，缓存安全
    const betterEditStoreCache = new Map()
    // store 缓存失效统一：DB 打开/查询失败时清掉正缓存，避免坏结果被固化
    function invalidateStoreCache(projRoot) {
      try { betterEditStoreCache.delete(projRoot) } catch (e) {}
    }
    // 扫描 better-edit runtime 目录，返回匹配 projRoot 的 store 路径（.wsPath sidecar 匹配）
    function betterEditStoreFor(projRoot) {
      if (betterEditStoreCache.has(projRoot)) return betterEditStoreCache.get(projRoot)
      let found = null
      try {
        // 与 homeFromEnv()/harness 同口径：DSH_HOME 本身即 home，其它情况才是「用户家目录 + '/.dsh'」
        const base = homeFromEnv()
        if (base) {
          const rt = pathJoin(base, 'plugins', 'dsh-better-edit', 'runtime')
          if (fsExistsSync(rt)) {
            const want = normPathKey(projRoot)
            for (const dir of fsReaddirSync(rt)) {
              const full = pathJoin(rt, dir)
              const wsPath = pathJoin(full, '.wsPath')
              let ws = null
              try { ws = fsReadFileSync(wsPath, 'utf8').trim() } catch (e) {}
              if (ws && normPathKey(ws) === want) {
                const store = pathJoin(full, 'hash-store.sqlite')
                if (fsExistsSync(store)) { found = store; break }
              }
            }
          }
        }
      } catch (e) { found = null }
      // 负缓存修复：store 未创建（found=null）时不缓存，避免 better-edit 后续创建 store 后
      // 本会话永远找不到；正结果仍缓存（命中路径性能不受影响）
      if (found) betterEditStoreCache.set(projRoot, found)
      return found
    }
    // store 查询路径统一提取：resolve 结果对象 → targetKey（realpath）优先，displayPath 次之，fallback 兜底。
    // betterEditHashesFor 与 buildUndoDiffData 共用，避免 fallback 语义分叉（'' vs fp）
    // resolve 结果对象 → 原生路径字符串统一口径：processPath（targetKey=realpath）优先，
    // 其次 targetKey/displayPath，最后 fallback。store 查询、持久化路径比较与迁移清理共用，
    // 避免「比较用路径」与「操作用路径」分叉（曾导致删除落到 realpath 指向的工作区外文件）
    function pathString(v, fallback) {
      if (typeof v === 'string') return v
      if (v && typeof v === 'object') {
        const viaProcess = fs.processPath && fs.processPath(v)
        return String(viaProcess || v.targetKey || v.displayPath || fallback || '')
      }
      return String(v == null ? (fallback || '') : v)
    }

    // store 查询路径统一提取：betterEditHashesFor 与 buildUndoDiffData 共用（复用统一 pathString）
    function extractStorePath(v, fallback) {
      return pathString(v, fallback)
    }
    // better-edit store 行查找统一：WHERE path 精确查询（走主键），miss 时全表按归一化匹配回退。
    // undo/snapshots 两表共用，避免查询策略独立演化（table/cols 均为内部常量，无注入面）
    function storeRowByPath(db, table, cols, rawPath, want) {
      const exact = String(rawPath || '')
      const row = db.prepare('SELECT ' + cols + ' FROM ' + table + ' WHERE path = ?').get(exact) || null
      if (row) return row
      // 回退：只取主键列做归一化匹配，命中后再按主键取大列——一次 miss 不应把整表大字段
      // （undo 的 content/result_content 是编辑前后全文）全部物化为 JS 字符串
      const keys = db.prepare('SELECT path FROM ' + table).all()
      let hit = null
      for (const r of keys) { if (normPathKey(r.path) === want) { hit = r.path; break } }
      if (hit === null) return null
      return db.prepare('SELECT ' + cols + ' FROM ' + table + ' WHERE path = ?').get(hit) || null
    }

    async function betterEditHashesFor(projRoot, targetPath, fallbackFp) {
      const storePath = betterEditStoreFor(projRoot)
      if (!storePath) return null
      try {
        const { DatabaseSync } = await import('node:sqlite')
        // fsService.resolve 可能返回 {displayPath, targetKey} 对象（dsh-fs-local resolveLocalTarget），
        // 先提取路径字符串，否则 String() 恒得 '[object Object]'，WHERE 与归一化匹配全部落空
        // targetKey（realpath）优先：store 的 path 列存的是磁盘真实大小写，用输入大小写的
        // displayPath 做 WHERE 在 Windows 上大小写不一致时确定 miss、回退全表载入大列
        const rawPath = extractStorePath(targetPath, fallbackFp || '')
        const want = normPathKey(rawPath)
        const db = new DatabaseSync(storePath, { readOnly: true })
        try {
          // 优先按 path 精确查询（snapshots 表 path 是主键，可走索引，避免全表载入全部 hashes）；
          // 存储格式与磁盘路径可能不完全一致（大小写/斜杠），miss 时回退全表按归一化匹配。
          const row = storeRowByPath(db, 'snapshots', 'path, hashes', rawPath, want)
          if (row) {
            try {
              const arr = JSON.parse(row.hashes)
              if (Array.isArray(arr)) return arr
            } catch (e) {}
            return null
          }
          return null
        } finally { try { db.close() } catch (e) {} }
      } catch (e) { invalidateStoreCache(projRoot); return null }
    }

    // ── 从磁盘内容重算 better-edit 行 hash ─────────────────────────────
    // store 快照可能过期（文件在 read 后被改）：此时按 better-edit 的 hash 算法
    // （canon → xxh32(seed=0) → probe 分配，见 hashline/hash-assign.js）从磁盘全文重算，
    // 这样锚点总能映射到当前文件。xxh32 用 xxhash-wasm 的 wasm 实现（file URL 动态加载，
    // 绕过 pnpm 隔离；加载失败自动降级返回 null，走原有降级路径）。
    const BE_ALPH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    const BE_HASH_LEN = 3
    const BE_HASH_SPACE = BE_ALPH.length ** BE_HASH_LEN
    const BE_PROBE_STRIDE = BE_ALPH.length ** 2 + BE_ALPH.length + 1
    const BE_BITSET_WORDS = Math.ceil(BE_HASH_SPACE / 32)
    let beHasherP = null
    function beIdxToHash(idx) {
      let out = ''
      for (let j = 0; j < BE_HASH_LEN; j++) { out = BE_ALPH[idx % BE_ALPH.length] + out; idx = Math.floor(idx / BE_ALPH.length) }
      return out
    }
    function beCanon(line) { return String(line || '').replace(/[ \t\r\n]+/g, '') }
    function beLoadHasher() {
      if (beHasherP) return beHasherP
      beHasherP = (async () => {
        // 在 better-edit 的安装树里找 xxhash-wasm 的 esm 入口
        // 与 homeFromEnv()/harness 同口径（见 betterEditStoreFor）
        const base = homeFromEnv()
        if (!base) return null
        const profileNm = pathJoin(base, 'profiles', 'web', 'node_modules', '.pnpm')
        const dirs = fsExistsSync(profileNm) ? fsReaddirSync(profileNm) : []
        let entry = null
        for (const d of dirs) {
          if (d.indexOf('xxhash-wasm@') !== 0) continue
          const cand = pathJoin(profileNm, d, 'node_modules', 'xxhash-wasm', 'esm', 'xxhash-wasm.js')
          if (fsExistsSync(cand)) { entry = cand; break }
        }
        if (!entry) return null
        const mod = await import('file:///' + entry.replace(/\\/g, '/'))
        const api = await mod.default()
        return api.h32 || null
      })().catch(() => null)
      return beHasherP
    }
    // 复刻 lineHashesPure：返回每行 3 字符 hash（未剥离 BOM——调用方先 strip）
    async function betterEditHashesFromDisk(fileText) {
      const h32 = await beLoadHasher()
      if (!h32) return null
      try {
        const norm = String(fileText || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
        const lines = norm.split('\n')
        const hashes = new Array(lines.length)
        const used = new Uint32Array(BE_BITSET_WORDS)
        let hint = 0
        const getBit = (idx) => (used[idx >>> 5] >>> (idx & 31) & 1) !== 0
        const setBit = (idx) => { used[idx >>> 5] |= 1 << (idx & 31) }
        const nextZero = (start) => {
          let idx = start % BE_HASH_SPACE
          for (let i = 0; i < BE_HASH_SPACE; i++) {
            if (!getBit(idx)) return idx
            idx += BE_PROBE_STRIDE
            if (idx >= BE_HASH_SPACE) idx -= BE_HASH_SPACE
          }
          return -1
        }
        for (let i = 0; i < lines.length; i++) {
          const base = (h32(beCanon(lines[i]), 0) >>> 14) % BE_HASH_SPACE
          if (!getBit(base)) {
            setBit(base); hint = base + BE_PROBE_STRIDE; hashes[i] = beIdxToHash(base)
          } else {
            const nxt = nextZero(hint)
            if (nxt < 0) return null
            setBit(nxt); hint = nxt + BE_PROBE_STRIDE; hashes[i] = beIdxToHash(nxt)
          }
        }
        return hashes
      } catch (e) { return null }
    }

    // 顺序应用 better-edit edits（hash 锚点 → 行号区间替换），返回 { text, minLine, maxLine }；
    // 任一锚点失效返回 null。语义对齐 better-edit 的稳定重哈希：应用一个 edit 后，
    // 未变行保留原 hash（后续锚点可继续解析），被删行失去 hash，新增行无法预知 hash
    // （agent 只能引用 read 时的旧锚点，指向新增行必然失效 → 与 better-edit 实际行为一致）。
    function applyBetterEdits(fileText, edits, hashes, only) {
      try {
        // only：可选索引集合，只应用这些 edit（供分窗口 diff：每组只看自己的变更）
        const indices = only ? [...only].sort((a, b) => a - b) : edits.map((_, i) => i)
        const normEolTxt = String(fileText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
        const lines = normEolTxt.split('\n')
        // curHash[i]：当前 lines[i] 的 hash（未变行保持原 hash；被删/新增行置 null）
        const curHash = hashes.slice()
        if (curHash.length < lines.length) curHash.length = lines.length
        let minLine = Infinity
        let maxLine = -Infinity
        for (const idx of indices) {
          const raw = edits[idx]
          const e = editTuple(raw)
          const fromHash = betterEditAnchor(e && e.remove_from)
          const toHash = betterEditAnchor(e && e.remove_to)
          const repl = editReplNorm(raw)
          if (!fromHash || !toHash) return null
          // 在当前（已部分应用）的内容上找锚点：仅未变行的原 hash 有效
          const start = curHash.indexOf(fromHash)
          const end = curHash.indexOf(toHash)
          if (start === undefined || start < 0 || end === undefined || end < 0) return null
          const s = Math.min(start, end)
          const t = Math.max(start, end)
          if (s < 0 || t >= lines.length) return null
          const replLines = repl === '' ? [] : repl.split('\n')
          // 记录变更范围（1 基行号，用当前行号；最终窗口按原始锚点行换算见调用方）
          if (s + 1 < minLine) minLine = s + 1
          if (t + 1 > maxLine) maxLine = t + 1
          // 替换区间：删除 [s..t]，插入 replLines
          lines.splice(s, t - s + 1, ...replLines)
          // 稳定重哈希：区间内原 hash 删除；区间后未变行 hash 平移保留；新增行 hash 未知（null）
          const removedHashes = curHash.slice(s, t + 1)
          const tailHashes = curHash.slice(t + 1)
          curHash.length = s
          for (let i = 0; i < removedHashes.length; i++) curHash[s + i] = null
          for (let i = 0; i < replLines.length; i++) curHash[s + i] = null
          for (let i = 0; i < tailHashes.length; i++) curHash[s + replLines.length + i] = tailHashes[i]
          // 清理尾部空洞
          while (curHash.length > lines.length) curHash.pop()
          while (curHash.length > 0 && curHash[curHash.length - 1] === null) curHash.pop()
        }
        return { text: lines.join('\n'), minLine, maxLine }
      } catch (e) { return null }
    }

    // 撤销（undo_last_edit）的对比数据：读 better-edit 的 undo 行取「撤销后内容」，
    // 与磁盘当前内容做窗口 diff。文件在编辑后被改动时 better-edit 会拒绝撤销（E_UNDO_STALE），
    // 此处按同一条件提示，避免展示一次不会执行的变化。
    // 窗口化 diff 共用：给定变化区（1 基 changeStart 起始行 + old/new 侧变化行数），
    // 生成前后各 W 行的展示窗口并交给 diffPayloadOrFallback。undo/insert 预览共用，
    // 避免窗口公式多份独立演化（曾因此产生 insert 预览 off-by-one）。
    function windowedDiffPayload(fp, oldLines, newLines, changeStart, oldSpan, newSpan, W) {
      const winStart = Math.max(1, changeStart - W)
      const winOldText = oldLines.slice(winStart - 1, Math.min(oldLines.length, changeStart - 1 + oldSpan + W)).join('\n')
      const winNewText = newLines.slice(winStart - 1, Math.min(newLines.length, changeStart - 1 + newSpan + W)).join('\n')
      return diffPayloadOrFallback(fp, winOldText, winNewText, 'modified', winStart)
    }

    // 插入预览统一：内置（0 基 after）与 shadow（1 基 before）只差插入点索引与上限的换算，
    // 参数校验、越界文案与窗口渲染全部共用，避免两侧独立演化（该公式历史上出现过 off-by-one）
    function previewInsert(fp, oldLines, addedLines, at, maxAt) {
      if (!Number.isInteger(at) || at < 0) return { ok: false, error: bi('insert_line 无效，无法预览', 'Invalid insert_line; cannot preview') }
      if (at > maxAt) return { ok: false, error: bi('插入位置超出文件范围', 'Insert position is beyond end of file') }
      // 只构造窗口范围（±W 行）再交给 diffPayloadOrFallback：避免为渲染小窗口深拷贝整文件行数组
      const W = 200
      const winStart = Math.max(0, at - W)
      const winEnd = Math.min(oldLines.length, at + W)
      const winOld = oldLines.slice(winStart, winEnd)
      const k = at - winStart
      const winNew = winOld.slice(0, k).concat(addedLines, winOld.slice(k))
      return diffPayloadOrFallback(fp, winOld.join('\n'), winNew.join('\n'), 'modified', winStart + 1)
    }

    async function buildUndoDiffData(entry, fsService, fp) {
      if (!fp) return { ok: false, error: bi('缺少文件路径', 'Missing file path') }
      let row = null
      // 先 stat + size 预检，再读 DB：避免 >1MB 文件先全量载入 undo 大行（content/result_content 各约等于文件大小）
      const st = await statTargetChecked(fp, entry.projRoot, fsService)
      if (!st.ok) return st
      const target = st.target
      const info = st.info
      try {
        const storePath = betterEditStoreFor(entry.projRoot)
        const resolved0 = target
        if (storePath) {
          const { DatabaseSync } = await import('node:sqlite')
          const db = new DatabaseSync(storePath, { readOnly: true })
          try {
            const rawPath = extractStorePath(resolved0, fp)
            const want = normPathKey(rawPath)
            // undo 行 content/result_content 为历史全文（编辑时大小、无上限）：读行前先做 SQL 层
            // 大小预检，避免 >1MB 历史行被全量载入后才被字符数兜底拒绝（WHERE 精确命中时有效）
            const lenRow = db.prepare('SELECT LENGTH(content) + LENGTH(result_content) AS total FROM undo WHERE path = ?').get(String(rawPath || ''))
            if (lenRow && typeof lenRow.total === 'number' && lenRow.total > DIFF_MAX_CHARS) {
              return { ok: false, error: bi('文件过大，无法生成对比', 'File too large to compare') }
            }
            // 优先按 path 精确查询（undo 表 path 是主键，可走索引，避免全表载入全部历史编辑内容）；
            // 存储格式与磁盘路径可能不完全一致（大小写/斜杠），miss 时回退全表按归一化匹配。
            row = storeRowByPath(db, 'undo', 'path, content, result_content, bom, ending', rawPath, want)
          } finally { try { db.close() } catch (e) {} }
        }
      } catch (e) { invalidateStoreCache(entry.projRoot); row = null }
      if (!row) return { ok: false, error: bi('该文件没有可撤销的编辑记录，撤销会被跳过', 'No undo history for this file; the undo will be skipped') }
      try {
        const curText = await fsService.readText(target)
        const after = row.content === null || row.content === undefined ? '' : String(row.content)
        if (overMaxChars(curText, after)) return { ok: false, error: bi('文件过大，无法生成对比', 'File too large to compare') }
        // 与 better-edit 的校验口径对齐：better-edit 用 undo 行的 bom/ending 做字节级精确比较，
        // 撤销校验含 BOM 与行尾。这里先做归一化比较，再对 BOM/行尾做敏感复核——
        // 仅行尾（CRLF↔LF）或 BOM 差异的覆盖在 better-edit 会返回 E_UNDO_STALE，预览同步按 stale 处理。
        const resultContent = row.result_content === null || row.result_content === undefined ? '' : String(row.result_content)
        const normTxt = (s) => normEol(String(s || '').replace(/^\uFEFF/, ''))
        if (normTxt(curText) !== normTxt(resultContent)) {
          return { ok: false, error: bi('文件在该次编辑后已被改动，撤销不会执行（无变化）', 'File changed after that edit; the undo will not run (no change)') }
        }
        const undoBom = row.bom === '\uFEFF' ? '\uFEFF' : ''
        const undoEnding = row.ending === '\r\n' || row.ending === '\r' ? row.ending : '\n'
        // 磁盘真实 BOM 状态：readText 经 TextDecoder 解码会剥离前导 BOM，故直接读前 3 字节比对
        // EF BB BF；读不到时回退到「stat.size 与文本字节数比对」的旧判据，与 undo.bom 不一致视为 stale
        if (typeof info.size === 'number') {
          let diskHasBom = false
          try {
            // readBytes 的 maxBytes 是「整文件上限」（超限直接抛 FS_TOO_LARGE），
            // 取文件头要用区间读取；不支持时由 catch 回退到 size 判据
            const head = (fsService.readByteRange && target) ? await fsService.readByteRange(target, { offset: 0, length: 3 }, undefined) : null
            diskHasBom = !!(head && head.length >= 3 && head[0] === 0xEF && head[1] === 0xBB && head[2] === 0xBF)
          } catch (e) {
            diskHasBom = info.size === Buffer.byteLength(curText, 'utf8') + 3
          }
          const wantBom = undoBom !== ''
          if (diskHasBom !== wantBom) {
            return { ok: false, error: bi('文件 BOM 在该次编辑后已被改动，撤销不会执行（无变化）', 'File BOM changed after that edit; the undo will not run (no change)') }
          }
        }
        // 内容与行尾精确比较：curText 保留原始 CRLF；resultContent 为 \n 规范化存储，按 undo.ending 还原
        // undoEnding 为 '\n'（LF 文件，最常见）时该 replace 是恒等变换，短路避免整串副本
        const exactResult = undoEnding === '\n' ? String(resultContent) : String(resultContent).replace(/\n/g, undoEnding)
        if (curText !== exactResult) {
          return { ok: false, error: bi('文件行尾/编码在该次编辑后已被改动，撤销不会执行（无变化）', 'File line endings or encoding changed after that edit; the undo will not run (no change)') }
        }
        const oldLines = splitDiffLines(curText)
        const newLines = splitDiffLines(after)
        const p = commonPrefixLen(oldLines, newLines)
        const s = commonSuffixLen(oldLines, newLines, p)
        return windowedDiffPayload(fp, oldLines, newLines, p + 1, oldLines.length - s - p, newLines.length - s - p, 200)
      } catch (e) {
        return { ok: false, error: readFail(e) }
      }
    }
    // edits 条目统一解析：元组 [remove_from, remove_to, replacement_text] 或对象 {remove_from, remove_to, replacement_text}
    function editTuple(raw) {
      if (Array.isArray(raw) && raw.length >= 3) return { remove_from: raw[0], remove_to: raw[1], replacement_text: raw[2] }
      return raw || {}
    }
    // replacement_text 统一提取（不含行尾归一化，供「过大」上限等上界用途）
    function editReplacement(raw) {
      const t = editTuple(raw)
      return typeof t.replacement_text === 'string' ? t.replacement_text : ''
    }
    // replacement_text 统一提取（行尾归一化，供补丁应用/窗口 diff 用途）
    function editReplNorm(raw) {
      const t = editTuple(raw)
      return (t && typeof t.replacement_text === 'string') ? t.replacement_text.replace(/\r\n/g, '\n').replace(/\r/g, '\n') : ''
    }


    // 统一「resolve→stat→存在/类型/size」预检（不 readText）：readTargetChecked、undo 预检与
    // 图片详情（skipSizeCheck + 自定义「不存在」文案）共用，
    // 避免预检检查与文案多份独立演化（曾因此出现 size 预检形式漂移）
    // 配置目标存在性判定（守卫方向敏感）：stat 失败按「存在」处理——
    // 宁可拒绝写入并提示，也不静默覆盖已有配置
    async function configExists(fsService, p) {
      try { return (await fsService.stat(p)) !== undefined } catch (e) { return true }
    }

    // opts.skipSizeCheck：图片详情另有自己的体积上限（IMAGE_MAX_BYTES），不套用 DIFF_MAX_CHARS 预检
    // opts.notFoundZh/notFoundEn：调用方覆盖「文件不存在」文案（图片详情用「图片不存在」）
    async function statTargetChecked(fp, projRoot, fsService, opts) {
      const o = opts || {}
      try {
        const target = await fsService.resolve(resolveArgPath(fp, projRoot))
        const info = await fsService.stat(target)
        if (info === undefined) return { ok: false, error: bi(o.notFoundZh || '文件不存在', o.notFoundEn || 'File not found') }
        if (info.type !== 'file') return { ok: false, error: bi('不是普通文件', 'Not a regular file') }
        if (!o.skipSizeCheck && fileTooLarge(info, DIFF_MAX_CHARS)) return { ok: false, error: bi('文件过大，无法生成对比', 'File too large to compare') }
        return { ok: true, target, info }
      } catch (e) {
        return { ok: false, error: readFail(e) }
      }
    }

    // 统一「预检 + readText」：返回 {ok:true,target,info,text} 或 {ok:false,error}。
    // 写分支各读盘入口共用；preText 非空时直接复用（调用方已完成预检读盘，如 str_replace 唯一性检查），避免双读盘
    async function readTargetChecked(fp, projRoot, fsService, preText) {
      if (preText !== null && preText !== undefined) return { ok: true, target: null, info: null, text: preText }
      const st = await statTargetChecked(fp, projRoot, fsService)
      if (!st.ok) return st
      try {
        const text = await fsService.readText(st.target)
        return { ok: true, target: st.target, info: st.info, text }
      } catch (e) {
        return { ok: false, error: readFail(e) }
      }
    }

    // 按审批 entry 生成对比数据（/permgate/file-diff 路由用；失败返回 {ok:false,error}，不支持返回 null）
    // 图片详情数据：格式/尺寸 + 缩略图（data URL）。失败一律 {ok:false,error}，客户端显示错误文本；
    // 超过体积上限则只给格式/尺寸并标记 tooLarge，不返回图片本体。
    async function buildImageDiffData(entry, fsService, fp) {
      if (!fp) return { ok: false, error: bi('缺少文件路径', 'Missing file path') }
      // 预检复用 statTargetChecked：跳过文本 diff 的字符数上限（图片另有 IMAGE_MAX_BYTES）
      const st = await statTargetChecked(fp, entry.projRoot, fsService, { skipSizeCheck: true, notFoundZh: '图片不存在', notFoundEn: 'Image not found' })
      if (!st.ok) return { ok: false, error: st.error }
      const target = st.target
      const size = Number(st.info.size) || 0
      let head = null
      let whole = null
      try {
        // 体积在预览预算内：一次性整读，既用于嗅探也直接用于内联，避免同一文件被读两遍
        // （照片常见的 64KB~2MB 区间原本会读两次）；体积超预算或读不到 size 时只读头部窗口，
        // 先确认格式与尺寸，再决定要不要整读。
        if (size > 0 && size <= IMAGE_MAX_BYTES) {
          whole = await fsService.readBytes(target, undefined, IMAGE_MAX_BYTES)
          head = whole.subarray(0, Math.min(whole.length, IMAGE_HEAD_BYTES))
        } else {
          const len = Math.max(16, Math.min(size || IMAGE_HEAD_BYTES, IMAGE_HEAD_BYTES))
          head = await fsService.readByteRange(target, { offset: 0, length: len }, undefined)
        }
      } catch (e) {
        return { ok: false, error: readFail(e) }
      }
      // 已整读时直接用整份缓冲嗅探：JPEG 的 SOF 段可能落在 64KB 头部窗口之外，
      // 而已持有全部字节（≤ IMAGE_MAX_BYTES），不必因为窗口取不到尺寸就放弃预览。
      const meta = sniffImage(whole || head)
      if (!meta) return { ok: false, error: bi('无法预览：不是可识别的图片（仅支持 PNG/JPEG/WebP/GIF）', 'Cannot preview: not a recognized image (PNG/JPEG/WebP/GIF)') }
      const out = { ok: true, kind: 'image', file: fp, format: meta.format, mime: IMAGE_MIME[meta.format] || '', width: meta.width, height: meta.height, size }
      // 尺寸未知（JPEG 的 SOF 段被 >64KB 的元数据段推到头部窗口之外、畸形段、WebP 未知 chunk 等）时，
      // 像素与边长闸无从判断，一律不内联本体，否则「弹窗解码预算」会被 2MB 以内的高压缩比图绕过。
      const sizeKnown = !!(meta.width && meta.height)
      const pixelOver = !!(sizeKnown && (meta.width * meta.height > IMAGE_MAX_PIXELS || meta.width > IMAGE_MAX_DIM || meta.height > IMAGE_MAX_DIM))
      if (!sizeKnown) { out.sizeUnknown = true; return out }
      if (size > IMAGE_MAX_BYTES || pixelOver) { out.tooLarge = true; if (size > IMAGE_MAX_BYTES) out.limit = IMAGE_MAX_BYTES; return out }
      try {
        // 预算内已整读过就直接复用；否则（头部窗口内已判合规而 size 未知）再整读一次
        const bytes = whole || await fsService.readBytes(target, undefined, IMAGE_MAX_BYTES)
        out.dataUrl = 'data:' + (out.mime || 'application/octet-stream') + ';base64,' + Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')
      } catch (e) {
        // 不带图片本体，客户端按「暂无可用的缩略图」提示；记录真实错误，避免失败原因不可见
        console.error('[permgate] image preview error:', e)
      }
      return out
    }

    async function buildFileDiffData(entry, fsService) {
      const name = entry.tool
      const args = parseEntryArgs(entry)
      const fp = pathArg(args)
      if (isUndo(name)) return await buildUndoDiffData(entry, fsService, fp)
      if (isFileImage(name)) return await buildImageDiffData(entry, fsService, fp)
      if (isFileRead(name, args)) {
        if (!fp) return { ok: false, error: bi('缺少文件路径', 'Missing file path') }
        // 与图片/撤销详情共用预检单点；read 走窗口化读取，不需要 DIFF_MAX_CHARS 体积闸
        const st = await statTargetChecked(fp, entry.projRoot, fsService, { skipSizeCheck: true })
        if (!st.ok) return st
        try {
          const target = st.target
          // 窗口化读取：只取 offset/limit 附近（前后各 W 行）的内容，流式消费到窗口末尾即停，
          // 不整读大文件；末尾省略行数未知，由客户端显示通用提示。
          // 资源上限：offset/limit 来自 agent 工具参数（不可信），且文件中可能存在无换行的
          // 极长行，故对窗口行数（MAX_LIMIT）、返回文本总字节（MAX_BYTES）与单行长度
          // （MAX_LINE）设硬上限，超限即截断并标记省略，避免服务端主线程无界内存分配。
          const W = 200
          const MAX_LIMIT = 4096
          const MAX_BYTES = 262144
          const MAX_LINE = 65536
          // str_replace_editor 的 view 用 view_range（[start, end]，1 基，end=-1 表示到文件尾）；
          // 预览据此换算 offset/limit，否则展示区域与实际读取不符（恒为文件开头）
          let vOffset = args.offset
          let vLimit = args.limit
          if (name === 'str_replace_editor' && Array.isArray(args.view_range) && args.view_range.length >= 2) {
            const vs = Number(args.view_range[0])
            const ve = Number(args.view_range[1])
            if (Number.isFinite(vs) && vs > 0) {
              vOffset = vs
              // end=-1 表示到文件尾（受 MAX_LIMIT 截断）；end<start 等非法组合会被工具报错，预览同样提示失败
              if (Number.isFinite(ve) && ve === -1) vLimit = MAX_LIMIT
              else if (Number.isFinite(ve) && ve >= vs) vLimit = ve - vs + 1
              else return { ok: false, error: bi('view_range 不合法，该命令将失败（无改动可预览）', 'Invalid view_range; the command will fail (no change to preview)') }
            }
          }
          const offset = Number.isFinite(vOffset) && vOffset > 0 ? Math.floor(vOffset) : 1
          const limit = Math.min(Number.isFinite(vLimit) && vLimit > 0 ? Math.floor(vLimit) : 200, MAX_LIMIT)
          const winStart = Math.max(1, offset - W)
          const winEnd = offset + limit - 1 + W
          const out = []
          let outBytes = 0
          let cut = false
          let buf = ''
          let line = 0
          let done = false
          let sawMore = false
          outer:
          for await (const chunk of await fsService.streamText(target)) {
            buf += chunk
            // 无换行的极长行：只保留尾部片段，防止 buf 无界增长；该行内容被截断时标记省略
            if (buf.indexOf('\n') === -1 && buf.length > MAX_LINE) { cut = true; buf = buf.slice(buf.length - MAX_LINE) }
            let nl
            while ((nl = buf.indexOf('\n')) !== -1) {
              line++
              // 窗口末行之后确认还有内容才标记「下方还有更多行」（文件恰好结束在窗口边界时不误报）
              if (done) { sawMore = true; break outer }
              if (line >= winStart && line <= winEnd) {
                if (outBytes < MAX_BYTES) {
                  let s = buf.slice(0, nl)
                  if (s.length > MAX_LINE) { s = s.slice(0, MAX_LINE); cut = true }
                  out.push(s)
                  outBytes += s.length
                } else { cut = true; break outer }
              }
              buf = buf.slice(nl + 1)
              if (line >= winEnd) done = true
            }
          }
          if (done && buf !== '') sawMore = true
          if (!done && buf !== '') {
            line++
            if (line >= winStart && line <= winEnd) {
              if (outBytes < MAX_BYTES) {
                let s = buf
                if (s.length > MAX_LINE) { s = s.slice(0, MAX_LINE); cut = true }
                out.push(s)
                outBytes += s.length
              } else {
                cut = true
              }
            }
          }
          return { ok: true, kind: 'read', file: fp, text: out.join('\n'), startLine: winStart, topOmitted: winStart > 1 && line >= winStart, bottomOmitted: sawMore || cut }
        } catch (e) {
          // 注意：不能与字符串直接拼接（bi() 返回 {zh,en} 对象，+ 会得到 "[object Object]"）；
          // 返回双语对象，由路由侧 L(r.error, lang) 按语言取值。
          return { ok: false, error: readFail(e) }
        }
      }
      // str_replace_editor 的 undo_edit 命令不写盘（better-edit 直接抛 E_UNSUPPORTED），无改动可预览
      if (name === 'str_replace_editor' && sreCommand(args) === 'undo_edit') {
        return { ok: false, error: bi('该命令没有可预览的改动', 'This command has no previewable change') }
      }
      if (isFileWrite(name, args)) {
        // str_replace 唯一性检查已读盘时缓存文本，供下方 edit 分支复用，避免同一文件双读盘
        let sreText = null
        if (!fp) return { ok: false, error: bi('缺少文件路径', 'Missing file path') }
        // str_replace_editor 参数适配：折算成 write/edit 的等价形式复用下面的成熟路径
        // （create→write 全文；str_replace/insert→edit 补丁；undo_edit 无改动内容可预览）
        let tool = name
        // sreKind：本次预览的 str_replace_editor 子命令（非 sre 工具时为空串），
        // 供下方 write 分支特判 create 复用，避免同一命令在两处各判一次
        let sreKind = ''
        // str_replace_editor 只有被 shadow 覆盖时 insert_line 才是 1 基/插到该行之前；
        // 内核在审批发起时判定并存入 entry（entry 生命周期内不变）；resolveEditorKernel 恒返回
        // builtin|shadow，故这里只在异常数据下用 'builtin' 兜底，不再重复做一次探测
        const kernel = entry.editorKernel || 'builtin'
        if (name === 'str_replace_editor') {
          const cmd = sreCommand(args)
          sreKind = cmd
          if (cmd === 'create') {
            // create 拒绝覆盖已存在文件（E_FILE_EXISTS，不写盘）：已存在时不能生成覆盖 diff。
            // 存在性检查由下方 write 分支的 stat 承担（此处不再重复 resolve+stat）
            tool = 'write'
            args.content = typeof args.file_text === 'string' ? args.file_text : ''
          } else if (cmd === 'str_replace') {
            // 两种内核在 old_str 多次匹配时都拒绝写盘（内置抛 FS_AMBIGUOUS_EDIT、shadow 同要求唯一匹配），
            // 故不做内核分叉：一律按「不唯一即失败」提示，避免展示一次永远不会发生的替换
            const oldStr = typeof args.old_str === 'string' ? args.old_str : ''
            if (oldStr) {
              const rd = await readTargetChecked(fp, entry.projRoot, fsService)
              if (!rd.ok) return rd
              let count = 0
              let at = 0
              while (count < 2 && (at = rd.text.indexOf(oldStr, at)) !== -1) { count++; at += oldStr.length }
              if (count > 1) {
                return { ok: false, error: bi('old_str 出现多次，该命令将失败（无改动可预览）', 'old_str occurs multiple times; the command will fail (no change to preview)') }
              }
              sreText = rd.text
            }
            tool = 'edit'
            args.old_string = oldStr
            args.new_string = typeof args.new_str === 'string' ? args.new_str : ''
          } else if (cmd === 'insert') {
            // insert 的 insert_line 语义随内核相反：DSH 内置 0 基、插到该行之后（官方语义）；
            // dsh-better-edit shadow 1 基、插到该行之前。按审批发起时判定的内核解释，
            // 否则会把插入位置画到错误的地方。
            // 不能折算成 old_string='' 的 edit —— 那会让 rawIdx 恒为 -1，插入位置被伪造成
            // 「文件开头第 1 行」。这里读盘后按真实插入点生成窗口 diff，行号与实际执行一致。
            // null/''/false 等占位值不得折算为 0：内置取参把 null 视为未提供并报 required，
            // 折算成 0 会被当成合法的 0 基位置，预览出一次必定失败的插入
            const rawInsLine = args.insert_line
            const insLine = (rawInsLine === null || rawInsLine === undefined || rawInsLine === '' || rawInsLine === false) ? NaN : Number(rawInsLine)
            const insText = typeof args.new_str === 'string' ? args.new_str : ''
            const rd = await readTargetChecked(fp, entry.projRoot, fsService)
            if (!rd.ok) return rd
            const fileText = rd.text
            if (overMaxChars(fileText, insText)) return { ok: false, error: bi('文件过大，无法生成对比', 'File too large to compare') }
            const addedLines = splitDiffLines(insText)
            if (kernel === 'builtin') {
              // 官方语义：insert_line 0 基，插入到该 index 之前（= 第 insert_line 行之后），范围 [0, 行数]
              const oldLines = splitDiffLines(fileText)
              return previewInsert(fp, oldLines, addedLines, insLine, oldLines.length)
            }
            // shadow：insert_line 1 基、插入到该行之前；空文件行数组为 []、上限「去尾换行行数 + 1」
            const oldLines = fileText.length === 0 ? [] : splitDiffLines(fileText)
            const maxInsert = fileText.length === 0 ? 1 : (fileText.endsWith('\n') ? oldLines.length : oldLines.length + 1)
            return previewInsert(fp, oldLines, addedLines, insLine - 1, maxInsert - 1)
          }
        }
        if (tool === 'edit') {
          // dsh-better-edit 兼容：{path, edits:[[remove_from,remove_to,replacement_text],...]} hash 锚点格式。
          // 与旧格式（old_string/new_string）互斥，优先识别 edits 数组。
          if (Array.isArray(args.edits) && args.edits.length > 0) {
            const rd = await readTargetChecked(fp, entry.projRoot, fsService)
            if (!rd.ok) return rd
            const fileText = rd.text
            const target = rd.target
            // 「文件过大」兜底：磁盘全文 + 全部 replacement_text 总长（agent 可控，必须计入上限）
            let replTotal = 0
            for (const raw of args.edits) { replTotal += editReplacement(raw).length }
            if (overMaxChars(fileText, replTotal)) return { ok: false, error: bi('文件过大，无法生成对比', 'File too large to compare') }
            // 1) 优先 store 快照；2) 快照过期则从磁盘内容重算（xxh32 复刻）；3) 都失败再降级
            let hashes = await betterEditHashesFor(entry.projRoot, target, fp)
            if (!hashes || !Array.isArray(hashes) || hashes.length === 0) {
              hashes = await betterEditHashesFromDisk(fileText)
            }
            if (!hashes || !Array.isArray(hashes) || hashes.length === 0) {
              // 无任何 hash 来源：无法映射锚点，退回补丁意图展示（至少显示替换文本）
              const intent = args.edits.map(editReplacement).join('\n')
              return diffPayloadOrFallback(fp, '', intent, 'modified')
            }
            const applied = applyBetterEdits(fileText, args.edits, hashes)
            if (applied === null) {
              // 锚点失效或 store 与磁盘不一致：退回补丁意图展示
              const intent = args.edits.map(editReplacement).join('\n')
              return diffPayloadOrFallback(fp, '', intent, 'modified')
            }
            // 分窗口 diff：把相距较远的 edits 分成多组（相邻间隔 ≤ 2W 同组），
            // 每组独立生成一个小窗口 diff 再拼接——避免单个大窗口把中间大段未变内容
            // 算成 +N/-N 假变更（如 +300 -300）。
            // 关键：new 侧不从「整文件应用后按行号切片」——行数变化（如 1 行换 52 行）会让
            // new 侧整体偏移，窗口尾部与 old 错位，把大量未变行误判为变更（+52/-52、+342/-342
            // 等假象）。改为以 old 窗口行为基底、仅在该窗口内应用本组 edits（跟踪 offset），
            // 使 old/new 覆盖同一内容区域、行号天然对齐。
            const W = 200
            const oldLines = splitDiffLines(String(fileText).replace(/\r\n/g, '\n').replace(/\r/g, '\n'))
            // 每个 edit 的原始行区间（0 基）
            const editRanges = args.edits.map((raw) => {
              const e = editTuple(raw)
              const a = betterEditAnchor(e && e.remove_from)
              const b = betterEditAnchor(e && e.remove_to)
              let s = -1, t = -1
              if (a && hashes) { const i = hashes.indexOf(a); if (i >= 0) s = i }
              if (b && hashes) { const i = hashes.indexOf(b); if (i >= 0) t = i }
              if (s < 0 && t >= 0) s = t
              if (t < 0 && s >= 0) t = s
              return { s, t }
            })
            // 分组：按起始行排序，间隔 > 2W 开新组
            const order = args.edits.map((_, i) => i).sort((x, y) => editRanges[x].s - editRanges[y].s)
            const groups = []
            let cur = null
            for (const i of order) {
              const line = editRanges[i].s
              if (line < 0) continue
              if (!cur || line - cur.max > 2 * W) {
                cur = { min: line, max: line, indices: [i] }
                groups.push(cur)
              } else {
                cur.max = Math.max(cur.max, line)
                cur.indices.push(i)
              }
            }
            const allOps = []
            let totalAdded = 0
            let totalRemoved = 0
            for (const g of groups) {
              let gMin0 = Infinity, gMax0 = -Infinity
              for (const i of g.indices) {
                const r = editRanges[i]
                if (r.s < gMin0) gMin0 = r.s
                if (r.t > gMax0) gMax0 = r.t
              }
              if (gMin0 === Infinity) continue
              const gMin = Math.max(1, gMin0 + 1 - W)
              const gOldEnd = Math.min(oldLines.length, gMax0 + 1 + W)
              // 新侧：以 old 窗口为基底，仅应用本组 edits，跟踪 offset
              const local = oldLines.slice(gMin - 1, gOldEnd)
              let off = 0
              let resolved = true
              for (const i of g.indices) {
                const r = editRanges[i]
                const raw = args.edits[i]
                const repl = editReplNorm(raw)
                const ls = r.s - (gMin - 1) + off
                const lt = r.t - (gMin - 1) + off
                if (ls < 0 || lt < ls || lt > local.length) { resolved = false; break }
                const replLines = repl === '' ? [] : repl.split('\n')
                local.splice(ls, lt - ls + 1, ...replLines)
                off += replLines.length - (lt - ls + 1)
              }
              if (!resolved) continue
              const oldWin = oldLines.slice(gMin - 1, gOldEnd).join('\n')
              const newWin = local.join('\n')
              const p = diffPayloadOrFallback(fp, oldWin, newWin, 'modified', gMin)
              if (!p || !p.ok) continue
              if (p.fallback) return p
              totalAdded += p.added || 0
              totalRemoved += p.removed || 0
              if (Array.isArray(p.ops)) {
                for (const op of p.ops) allOps.push(op)
              } else if (p.lines) {
                return p
              }
            }
            if (allOps.length === 0 && totalAdded === 0 && totalRemoved === 0) {
              return diffPayloadOrFallback(fp, oldLines.join('\n'), splitDiffLines(applied.text).join('\n'), 'modified', 1)
            }
            return { ok: true, kind: 'modified', file: fp, added: totalAdded, removed: totalRemoved, ops: allOps, truncated: 0, grouped: true }
          }
          const oldText = typeof args.old_string === 'string' ? args.old_string : ''
          const newText = typeof args.new_string === 'string' ? args.new_string : ''
          if (overMaxChars(oldText, newText)) return { ok: false, error: bi('内容过大，无法生成对比', 'Content too large to compare') }
          // 关键：edit 是补丁式，仅对比 old_string/new_string 会丢失文件上下文（抽屉只会显示
          // 补丁那几行）。改为读取磁盘当前内容、应用补丁后，取改动前后各 W 行的窗口做 diff——
          // 行号从真实位置起算，payload 恒定小，大文件无需整文件对比（write 才是整文件语义）。
          const rd = await readTargetChecked(fp, entry.projRoot, fsService, sreText)
          if (!rd.ok) return rd
          const fileText = rd.text
          if (overMaxChars(fileText, newText)) return { ok: false, error: bi('文件过大，无法生成对比', 'File too large to compare') }
          // 行尾处理：磁盘文件可能是 CRLF/CR 而工具参数为 LF。优先按原始文本字面匹配
          // （预览与实际 edit 结果一致）；字面匹配失败且磁盘含 CR/CRLF 时，退而按 \n
          // 归一化匹配构建预览窗口（与 splitDiffLines 同一归一化规则），并在 payload 上
          // 标记 eolNormalized——此时预览仅为意图展示：实际 edit 按原始字节字面匹配
          // 仍可能失败，由客户端提示，避免审批者基于"假成功"预览做决策。
          const rawIdx = oldText ? fileText.indexOf(oldText) : -1
          // oldNorm/newNorm 为补丁级小字符串，供行数统计与归一化预览共用；fileNorm
          // 为全文件副本，仅在字面匹配失败且文件确实含 \r 时才构建（避免常见路径对
          // 最多 1MB 文件做两趟全量 replace 扫描）。
          const oldNorm = normEol(oldText)
          const newNorm = normEol(newText)
          let eolNormalized = false
          let idx = rawIdx
          let baseText = fileText
          let oldLen = oldText.length
          if (rawIdx === -1 && oldNorm && fileText.indexOf('\r') !== -1) {
            const fileNorm = normEol(fileText)
            const normIdx = fileNorm.indexOf(oldNorm)
            if (normIdx !== -1) {
              idx = normIdx
              baseText = fileNorm
              oldLen = oldNorm.length
              eolNormalized = true
            }
          }
          if (idx === -1) {
            // 磁盘内容已与提案脱节（旧文本未找到）：退回补丁级对比，至少展示改动意图
            return diffPayloadOrFallback(fp, oldText, newText, 'modified')
          }
          const applied = baseText.slice(0, idx) + (eolNormalized ? newNorm : newText) + baseText.slice(idx + oldLen)
          const oldLines = splitDiffLines(baseText)
          const newLines = splitDiffLines(applied)
          const lineStart = 1 + countNewlines(baseText, idx)
          const oldCnt = splitDiffLines(oldNorm).length
          const newCnt = splitDiffLines(newNorm).length
          const payload = windowedDiffPayload(fp, oldLines, newLines, lineStart, oldCnt, newCnt, 200)
          // diffPayloadOrFallback 恒返回 ok:true 的 payload（失败时返回 fallback 视图而非 ok:false）
          if (eolNormalized) payload.eolNormalized = true
          return payload
        }
        const content = typeof args.content === 'string' ? args.content : ''
        if (!content || content.length > DIFF_MAX_CHARS) return { ok: false, error: bi('内容缺失或过大', 'Content missing or too large') }
        try {
          const target = await fsService.resolve(resolveArgPath(fp, entry.projRoot))
          const info = await fsService.stat(target)
          if (info === undefined) return newFilePayload(fp, content)
          // create 拒绝覆盖已存在文件：write 分支已 stat，此处特判（避免 create 分支重复 resolve+stat）
          if (sreKind === 'create') {
            return { ok: false, error: bi('create 不会覆盖已存在的文件（该命令将失败），无改动可预览', 'create will fail: file already exists; no change to preview') }
          }
          if (info.type !== 'file') return { ok: false, error: bi('不是普通文件', 'Not a regular file') }
          if (fileTooLarge(info, DIFF_MAX_CHARS)) return { ok: false, error: bi('文件过大，无法生成对比', 'File too large to compare') }
          const oldText = await fsService.readText(target)
          if (overMaxChars(oldText, content)) return { ok: false, error: bi('文件过大，无法生成对比', 'File too large to compare') }
          return diffPayloadOrFallback(fp, oldText, content, 'modified')
        } catch (e) {
          // 注意：不能与字符串直接拼接（bi() 返回 {zh,en} 对象，+ 会得到 "[object Object]"）；
          // 返回双语对象，由路由侧 L(r.error, lang) 按语言取值。
          return { ok: false, error: readFail(e) }
        }
      }
      return null
    }

    function commandArg(args) {
      try { return args && typeof args === 'object' && typeof args.command === 'string' ? args.command : '' } catch (e) { return '' }
    }

    function isOutside(p, rootKey) {
      const r = norm(rootKey)
      if (!r) return false
      const s = norm(p)
      const abs = (s.indexOf('/') === 0 || /^[a-zA-Z]:/.test(s)) ? s : r + '/' + s
      // 盘根 'G:'（norm 剥掉尾斜杠）补回根斜杠：pathResolve('G:') 会落到 cwd 而非盘根；
      // UNC 根 pathResolve 输出带尾部分隔符，前缀判断需按「rr 已以分隔符结尾」分支处理
      const fixRoot = (v) => pathResolve(/^[a-zA-Z]:$/.test(v) ? v + '/' : v)
      const ra = fixRoot(abs)
      const rr = fixRoot(r)
      const lowerRa = ra.toLowerCase()
      const lowerRr = rr.toLowerCase()
      // 根本身（含盘根/UNC 根，rr 可能以分隔符结尾）为区内；前缀比较带分隔符边界
      if (lowerRa === lowerRr) return false
      const rrEndSep = lowerRr.endsWith('/') || lowerRr.endsWith('\\')
      if (rrEndSep) return lowerRa.indexOf(lowerRr) !== 0
      return lowerRa.indexOf(lowerRr + '/') !== 0 && lowerRa.indexOf(lowerRr + '\\') !== 0
    }

    function callKey(name, args) {
      return name + '\u0000' + safeJson(args)
    }

    function repeatStreak(name, args) {
      const key = callKey(name, args)
      let n = 0
      for (let i = recent.length - 1; i >= 0; i--) {
        if (recent[i] === key) n++
        else break
      }
      return n
    }

    function quickAction(name) {
      const proj = projectBlock()
      const pMap = proj && proj.quickTools ? proj.quickTools : {}
      // 取值函数：正常路径下配置项恒为对象（normalizeQuick 已在加载时收敛，freshConfig/migrateOld/
      // setQuickAction 也都只写对象），所以下面的字符串回退当前不可达，它是纯防御——万一有路径让
      // 非对象形态进入内存（绕过 normalizeQuick），按裸动作字符串取值，而不是产出 undefined 让
      // decide() 返回非法 action（pre-execute 会把非 ask/deny 一律当放行）。
      // 注意与下面的 inherit 守卫不同：normalizeQuickEntry 用 ALL_MODES 校验，'inherit' 能存活。
      const modeOf = (v) => (v && typeof v === 'object' ? v.action : v)
      const reasonOf = (v) => (v && typeof v === 'object' ? v.reason : undefined)
      for (const k of Object.keys(pMap)) {
        if (modeOf(pMap[k]) !== 'inherit' && matchGlob(k, name)) return { action: modeOf(pMap[k]), reason: reasonOf(pMap[k]) }
      }
      const gMap = config.global.quickTools || {}
      for (const k of Object.keys(gMap)) {
        // 与项目分支同口径：全局层本不该出现 inherit（写入侧 setQuickAction 对 global+inherit
        // 走 delete），但手工编辑 config.json 可以塞进来。若不跳过，decide() 拿到的 action 既不是
        // ask 也不是 deny，pre-execute 会直接 next() —— 等于静默放行。
        if (modeOf(gMap[k]) !== 'inherit' && matchGlob(k, name)) return { action: modeOf(gMap[k]), reason: reasonOf(gMap[k]) }
      }
      // 预设工具的默认动作同样是「决策默认」：配置里缺席（升级前生成的老配置不含新键）时按
      // QUICK_DEFAULTS 裁决，与面板显示走同一条链（项目键 → 全局键 → 预设默认 → 兜底），
      // 新老配置行为一致；显式配置项与 migrateOld 的 locked deny 仍优先于此。
      const def = Object.prototype.hasOwnProperty.call(QUICK_DEFAULTS, name) ? QUICK_DEFAULTS[name] : null
      return def ? { action: def, isDefault: true } : null
    }

    function textOfBlock(b) {
      if (!b) return ''
      if (typeof b === 'string') return b
      if (b.type === 'text' && typeof b.text === 'string') return b.text
      if (typeof b.text === 'string') return b.text
      if (typeof b.content === 'string') return b.content
      return ''
    }

    function recentUserText(exec) {
      try {
        const agent = (exec && exec.agent) || agentRef
        const session = agent && agent.session
        if (!session || typeof session.deriveMessages !== 'function') return ''
        const msgs = session.deriveMessages()
        for (let i = msgs.length - 1; i >= 0; i--) {
          const m = msgs[i]
          if (!m || m.role !== 'user') continue
          const src = m.source
          if (src && (src.kind === 'tool' || src.kind === 'plugin')) continue
          let text = ''
          const c = m.content
          if (typeof c === 'string') text = c
          else if (Array.isArray(c)) {
            for (const b of c) text += textOfBlock(b)
          }
          text = String(text).trim()
          if (text) return text.length > 200 ? text.slice(0, 200) + '…' : text
        }
        return ''
      } catch (e) { return '' }
    }

    function argDescription(args) {
      try {
        if (!args || typeof args !== 'object') return ''
        const d = args.description
        if (typeof d === 'string' && d.trim()) return d.trim()
        return ''
      } catch (e) { return '' }
    }

    function describeIntent(exec, d) {
      const t = exec.name
      const v = d.value !== undefined && d.value !== null ? String(d.value) : ''
      if (d.kind === 'command' && v) {
        const first = String(v).split(/[;|]/)[0].trim()
        const f = first.length > 80 ? first.slice(0, 80) + '…' : first
        return bi('执行命令 ' + f, 'Run command ' + f)
      }
      if (d.kind === 'path' && v) {
        if (d.cat === 'read') return bi('读取文件 ' + v, 'Read file ' + v)
        if (d.cat === 'image') return bi('读取图片 ' + v, 'Read image ' + v)
        if (d.cat === 'edit') return bi('写入/修改文件 ' + v, 'Write/modify file ' + v)
        if (d.cat === 'undo') return bi('撤销操作（恢复上次编辑前的内容）：' + v, 'Undo edit (revert last edit): ' + v)
        return bi('访问路径 ' + v, 'Access path ' + v)
      }
      if (d.cat === 'doomloop') return bi('重复操作拦截：' + t + ' 连续多次相同调用，疑似循环', 'Doom Loop: ' + t + ' repeated identically, possible loop')
      if (d.cat === 'subagent') return bi('启动子代理（' + t + '）', 'Spawn subagent (' + t + ')')
      if (d.cat === 'quick') return bi('调用快捷工具 ' + t, 'Call quick tool ' + t)
      if (d.cat === 'custom') return bi('命中自定义规则，调用 ' + t, 'Custom rule matched, calling ' + t)
      return bi('调用 ' + t, 'Calling ' + t)
    }

    function baseName(p) {
      const s = String(p || '').replace(/\\/g, '/').replace(/\/+$/, '')
      const idx = s.lastIndexOf('/')
      return idx >= 0 ? s.slice(idx + 1) : s
    }

    function humanArgsPreview(name, args) {
      const lang = uiLang
      const lines = []
      const push = (label, value, extra) => {
        if (value === undefined || value === null) return
        const s = String(value)
        if (!s) return
        const e = { label, value: s.length > 200 ? s.slice(0, 200) + '…' : s }
        if (extra) { for (const k of Object.keys(extra)) e[k] = extra[k] }
        lines.push(e)
      }
      const t = (zh, en) => (lang === 'en' ? en : zh)
      try {
        if (!args || typeof args !== 'object') return lines
        const fp = pathArg(args)
        if (isUndo(name)) {
          push(t('撤销', 'Undo'), fp ? baseName(fp) : '', fp ? { path: fp } : undefined)
          if (fp) push(t('路径', 'Path'), fp, { path: fp })
        } else if (isFileRead(name, args)) {
          const target = fp || args.path || ''
          push(t('读取', 'Read'), target ? baseName(target) : '', fp ? { path: fp } : undefined)
          if (fp) push(t('路径', 'Path'), fp, { path: fp })
          if (args.offset !== undefined) push(t('偏移', 'Offset'), args.offset)
          if (args.limit !== undefined) push(t('行数', 'Lines'), args.limit)
        } else if (isFileImage(name)) {
          // 图片与文本走同一个 file 地址（DSH 按 media type 选渲染器），所以路径同样可点：
          // 交给 DSH 右侧栏展示，不再受原「打开文件」白名单（只收文本/文档类）的限制。
          const target = fp || args.path || ''
          push(t('读取图片', 'Read image'), target ? baseName(target) : '', fp ? { path: fp } : undefined)
          if (fp) push(t('路径', 'Path'), fp, { path: fp })
        } else if (isFileWrite(name, args)) {
          const isSre = name === 'str_replace_editor'
          const sreCmd = isSre ? sreCommand(args) : ''
          const wLabel = isSre
            ? (sreCmd === 'create' ? t('创建', 'Create') : t('编辑', 'Edit'))
            : (name === 'edit' ? t('修改', 'Edit') : t('写入', 'Write'))
          push(wLabel, fp ? baseName(fp) : '', fp ? { path: fp } : undefined)
          if (fp) push(t('路径', 'Path'), fp, { path: fp })
          const content = typeof args.content === 'string'
            ? args.content
            : (typeof args.new_string === 'string'
              ? args.new_string
              : (typeof args.new_str === 'string' ? args.new_str : (typeof args.file_text === 'string' ? args.file_text : '')))
          if (content) push(t('内容', 'Content'), content.length > 140 ? content.slice(0, 140) + '…（共 ' + content.length + ' 字符）' : content)
        } else if (COMMAND_TOOLS[name]) {
          push(t('命令', 'Command'), args.command || '')
          if (typeof args.description === 'string' && args.description) push(t('说明', 'Description'), args.description)
        } else if (name === 'web_search' || name === 'web_fetch') {
          if (typeof args.query === 'string') push(t('查询', 'Query'), args.query)
          if (typeof args.url === 'string') push('URL', args.url)
        } else {
          if (fp) push(t('路径', 'Path'), fp)
          if (typeof args.description === 'string' && args.description) push(t('说明', 'Description'), args.description)
        }
      } catch (e) {}
      return lines
    }

    // 工作区外路径类工具的合并矩阵单点（read / image / edit / undo 共用）：
    // 先过「目录访问」闸，再过工具自身分类闸；任一 deny → 拒绝，任一 ask → 询问，否则放行。
    // cat 取「真正作出决定的那道闸」：它决定弹窗候选（加入例外）写到哪个分类的例外里——
    // 若只写自身分类而目录闸仍是 ask，用户点「允许」后同一个文件会反复弹窗、且候选会因已存在而消失。
    // 分类名文案：决定由哪道闸作出，reason 就用哪道闸的名字（否则 cat 已是自身分类、
    // ruleId 也指向自身分类的例外，文案却写「目录权限」，用户会去改错分类的配置）
    // deny / ask / allow 三个分支都遵循这一条：cat、前缀、ruleId 三者必须同源。
    const OUTSIDE_PREFIX = {
      directory: ['目录权限：', 'Directory permission: '],
      read: ['读取权限：', 'Read permission: '],
      image: ['读取图片权限：', 'Read image permission: '],
      edit: ['编辑权限：', 'Edit permission: '],
      undo: ['撤销权限：', 'Undo permission: '],
    }

    function outsideMatrix(catKey, fp) {
      const d = resolveCategory('directory', fp, 'path')
      const e = resolveCategory(catKey, fp, 'path')
      if (d.action === 'deny' || e.action === 'deny') {
        const src = d.action === 'deny' ? d : e
        const cat = src === d ? 'directory' : catKey
        const p = OUTSIDE_PREFIX[cat] || OUTSIDE_PREFIX.directory
        return { action: 'deny', src, cat, pz: p[0], pe: p[1] }
      }
      if (d.action === 'ask' || e.action === 'ask') {
        // 与 deny/allow 同口径：由**例外**触发的 ask 让 cat 跟随该例外所在闸，前缀与 ruleId 同源；
        // 纯模式默认值触发的 ask 沿用「目录闸优先」的既有取法（此时无 ruleId，文案回落「（需确认）」）。
        const src = (d.action === 'ask' && d.ruleId) ? d : ((e.action === 'ask' && e.ruleId) ? e : null)
        const cat = src ? (src === d ? 'directory' : catKey) : (d.action === 'ask' ? 'directory' : catKey)
        const p = OUTSIDE_PREFIX[cat] || OUTSIDE_PREFIX.directory
        return { action: 'ask', src, cat, pz: p[0], pe: p[1] }
      }
      // allow：与 deny/ask 同口径——由哪道闸的例外实际放行，cat 就跟随哪道闸，
      // 保证 reason 前缀、ruleId、cat 三者同源（否则文案写「读取图片权限：」
      // 而括号里的例外 id 属于目录闸，用户会去错分类找一条不存在的规则）。
      const src = d.ruleId ? d : (e.ruleId ? e : null)
      const cat = src === d ? 'directory' : catKey
      const p = OUTSIDE_PREFIX[cat] || OUTSIDE_PREFIX.directory
      return { action: 'allow', src, cat, pz: p[0], pe: p[1] }
    }

    function decide(exec) {
      const name = exec.name
      const args = exec.arguments
      // 自定义文字分两种，用途不同、不可互换：
      //   reason —— 拒绝理由，会随 kind:'deny' 回给 AI（「为什么被拒、该怎么改」）；
      //             例外的 reason、分类默认值的 reason、兜底/快捷工具拒绝时的 reason 都走它。
      //   note   —— 给人看的备注，出现在审批弹窗文案与决策记录里（「当初为什么特意拦它」）。
      //             它只是「给人看」，不是保密字段：决策记录会随 perm_status 下发，故不承诺 AI 看不到。
      // 无自定义文字时回退「（例外 id）」标注，方便去设置页定位是哪一条。
      const exReason = (d) => {
        if (d && d.action === 'deny' && d.reason) return '（' + d.reason + '）'
        if (d && d.action === 'ask' && d.note) return '（' + d.note + '）'
        if (d && d.ruleId) return '（例外 ' + d.ruleId + '）'
        return ''
      }
      const exReasonEn = (d) => {
        if (d && d.action === 'deny' && d.reason) return ' (' + d.reason + ')'
        if (d && d.action === 'ask' && d.note) return ' (' + d.note + ')'
        if (d && d.ruleId) return ' (exception ' + d.ruleId + ')'
        return ''
      }
      // 注意：perm_* 曾在此被无条件放行，等于给 AI 留了一条「自我提权且无弹窗」的后门
      // （perm_set_category / perm_set_fallback / perm_add_exception … 改动即生效）。
      // 现在不再特判，统一走下面的正常判定链（自定义规则 → 分类 → 快捷工具 → 兜底），
      // 其默认动作由 QUICK_DEFAULTS 钉成 ask；设置面板走 /permgate/* HTTP 路由、不经这里，不受影响。
      if (sessionPresetName(exec) !== 'custom-review') {
        return { action: 'allow', reason: bi('会话未选择「自定义审查」，由 DSH 权限预设处理', 'Session has not selected "Custom Review"; handled by DSH permission presets'), cat: null, value: null, kind: null }
      }
      if (repeatStreak(name, args) >= REPEAT_STREAK) {
        const d = resolveCategory('doomloop', null, null)
        if (d.action !== 'allow') {
          // 分类默认值的拒绝原因同样带上（doomloop 无例外，d.reason 只可能来自分类默认值）
          return { action: d.action, reason: bi('重复操作(Doom Loop)：' + name + ' 已连续重复 ' + (REPEAT_STREAK + 1) + ' 次相同调用' + exReason(d), 'Doom Loop: ' + name + ' repeated ' + (REPEAT_STREAK + 1) + ' identical calls' + exReasonEn(d)), ruleId: d.ruleId, cat: 'doomloop', value: null, kind: null }
        }
      }
      const proj = projectBlock()
      const rules = []
      if (proj && Array.isArray(proj.custom)) { for (const r of proj.custom) rules.push(r) }
      if (Array.isArray(config.global.custom)) { for (const r of config.global.custom) rules.push(r) }
      for (const rule of rules) {
        if (ruleMatches(rule, name, args)) {
          return { action: rule.action, ruleId: rule.id, reason: rule.reason || bi('自定义规则 ' + rule.id + ' 命中', 'Custom rule ' + rule.id + ' matched'), cat: 'custom', value: null, kind: 'rule' }
        }
      }
      if (isFileRead(name, args)) {
        const fp = pathArg(args)
        if (fp && isOutside(fp, root)) {
          // 与 image/edit/undo 同口径：工作区外先过「目录访问」闸，再过「读取文件」闸。
          // 只取 directory 的动作，会让 read 分类的 mode 与 deny 例外在跨工作区时完全不生效。
          const m = outsideMatrix('read', fp)
          if (m.action === 'deny') return { action: 'deny', reason: bi(m.pz + '拒绝读取工作区外文件 ' + fp + exReason(m.src), m.pe + 'read outside workspace denied ' + fp + exReasonEn(m.src)), ruleId: m.src.ruleId, cat: m.cat, value: fp, kind: 'path' }
          if (m.action === 'ask') return { action: 'ask', reason: bi(m.pz + '读取工作区外文件 ' + fp + (m.src ? exReason(m.src) : '（需确认）'), m.pe + 'read outside workspace ' + fp + (m.src ? exReasonEn(m.src) : ' (requires confirmation)')), ruleId: m.src ? m.src.ruleId : null, cat: m.cat, value: fp, kind: 'path' }
          return { action: 'allow', reason: bi(m.pz + '读取工作区外文件 ' + fp + (m.src ? exReason(m.src) : ''), m.pe + 'read outside workspace ' + fp + (m.src ? exReasonEn(m.src) : '')), ruleId: m.src ? m.src.ruleId : null, cat: m.cat, value: fp, kind: 'path' }
        }
        const d = resolveCategory('read', fp, 'path')
        const exZh = exReason(d)
        const exEn = exReasonEn(d)
        return { action: d.action, reason: bi('读取权限' + (fp ? '：' + fp : '') + exZh, 'Read permission' + (fp ? ': ' + fp : '') + exEn), ruleId: d.ruleId, cat: 'read', value: fp, kind: 'path' }
      }
      // 读图与读文件同一条判定链（工作区外先过「目录访问」闸，再落本分类 + 路径例外），
      // 只是分类从 read 换成 image：两边的默认动作与例外各自独立配置。
      if (isFileImage(name)) {
        const fp = pathArg(args)
        if (fp && isOutside(fp, root)) {
          // 工作区外读图：directory + image 合并矩阵（不能用 directory 的动作短路，
          // 否则 image 默认 ask 与 image 的 deny/路径例外在跨工作区场景下全部失效）。
          const m = outsideMatrix('image', fp)
          if (m.action === 'deny') return { action: 'deny', reason: bi(m.pz + '拒绝读取工作区外图片 ' + fp + exReason(m.src), m.pe + 'image read outside workspace denied ' + fp + exReasonEn(m.src)), ruleId: m.src.ruleId, cat: m.cat, value: fp, kind: 'path' }
          if (m.action === 'ask') return { action: 'ask', reason: bi(m.pz + '读取工作区外图片 ' + fp + (m.src ? exReason(m.src) : '（需确认）'), m.pe + 'read image outside workspace ' + fp + (m.src ? exReasonEn(m.src) : ' (requires confirmation)')), ruleId: m.src ? m.src.ruleId : null, cat: m.cat, value: fp, kind: 'path' }
          return { action: 'allow', reason: bi(m.pz + '读取工作区外图片 ' + fp + (m.src ? exReason(m.src) : ''), m.pe + 'read image outside workspace ' + fp + (m.src ? exReasonEn(m.src) : '')), ruleId: m.src ? m.src.ruleId : null, cat: m.cat, value: fp, kind: 'path' }
        }
        const d = resolveCategory('image', fp, 'path')
        const exZh = exReason(d)
        const exEn = exReasonEn(d)
        return { action: d.action, reason: bi('读取图片权限' + (fp ? '：' + fp : '') + exZh, 'Read image permission' + (fp ? ': ' + fp : '') + exEn), ruleId: d.ruleId, cat: 'image', value: fp, kind: 'path' }
      }
      if (isFileWrite(name, args)) {
        const fp = pathArg(args)
        if (fp && isOutside(fp, root)) {
          // 工作区外写入：directory + edit 合并矩阵（与读图/撤销同口径，单点在 outsideMatrix）。
          const m = outsideMatrix('edit', fp)
          if (m.action === 'deny') return { action: 'deny', reason: bi(m.pz + '拒绝写入工作区外 ' + fp + exReason(m.src), m.pe + 'write to outside workspace denied ' + fp + exReasonEn(m.src)), ruleId: m.src.ruleId, cat: m.cat, value: fp, kind: 'path' }
          if (m.action === 'ask') return { action: 'ask', reason: bi(m.pz + '访问工作区外 ' + fp + (m.src ? exReason(m.src) : '（写入需确认）'), m.pe + 'access outside workspace ' + fp + (m.src ? exReasonEn(m.src) : ' (write requires confirmation)')), ruleId: m.src ? m.src.ruleId : null, cat: m.cat, value: fp, kind: 'path' }
          return { action: 'allow', reason: bi(m.pz + '访问工作区外 ' + fp + (m.src ? exReason(m.src) : ''), m.pe + 'access outside workspace ' + fp + (m.src ? exReasonEn(m.src) : '')), ruleId: m.src ? m.src.ruleId : null, cat: m.cat, value: fp, kind: 'path' }
        }
        const d = resolveCategory('edit', fp, 'path')
        const exZh = exReason(d)
        const exEn = exReasonEn(d)
        return { action: d.action, reason: bi('编辑权限' + (fp ? '：' + fp : '') + exZh, 'Edit permission' + (fp ? ': ' + fp : '') + exEn), ruleId: d.ruleId, cat: 'edit', value: fp, kind: 'path' }
      }
      // 撤销：会写盘但不是「编辑」——恢复既有内容、不接受调用方提供的新内容，故单列一类（默认询问）。
      // 与写类一致：工作区外仍先过「目录访问」闸（directory + undo 合并矩阵）。
      if (isUndo(name)) {
        const fp = pathArg(args)
        if (fp && isOutside(fp, root)) {
          const m = outsideMatrix('undo', fp)
          if (m.action === 'deny') return { action: 'deny', reason: bi(m.pz + '拒绝撤销工作区外 ' + fp + exReason(m.src), m.pe + 'undo outside workspace denied ' + fp + exReasonEn(m.src)), ruleId: m.src.ruleId, cat: m.cat, value: fp, kind: 'path' }
          if (m.action === 'ask') return { action: 'ask', reason: bi(m.pz + '撤销工作区外文件 ' + fp + (m.src ? exReason(m.src) : '（需确认）'), m.pe + 'undo outside workspace ' + fp + (m.src ? exReasonEn(m.src) : ' (requires confirmation)')), ruleId: m.src ? m.src.ruleId : null, cat: m.cat, value: fp, kind: 'path' }
          return { action: 'allow', reason: bi(m.pz + '撤销工作区外文件 ' + fp + (m.src ? exReason(m.src) : ''), m.pe + 'undo outside workspace ' + fp + (m.src ? exReasonEn(m.src) : '')), ruleId: m.src ? m.src.ruleId : null, cat: m.cat, value: fp, kind: 'path' }
        }
        const d = resolveCategory('undo', fp, 'path')
        const exZh = exReason(d)
        const exEn = exReasonEn(d)
        return { action: d.action, reason: bi('撤销权限' + (fp ? '：' + fp : '') + exZh, 'Undo permission' + (fp ? ': ' + fp : '') + exEn), ruleId: d.ruleId, cat: 'undo', value: fp, kind: 'path' }
      }
      if (COMMAND_TOOLS[name]) {
        const cmd = commandArg(args)
        // 命令的所有可识别命令 token 均已命中 allow 例外 → 视为已覆盖，直接放行（不再弹窗）
        if (commandFullyCovered(cmd)) {
          return { action: 'allow', reason: bi('命令组成均已命中例外，放行', 'All command tokens covered by exceptions, allowed'), cat: null, value: null, kind: null }
        }
        const d = resolveCategory('command', cmd, 'command')
        const exZh = exReason(d)
        const exEn = exReasonEn(d)
        return { action: d.action, reason: bi('执行命令' + exZh, 'Run command' + exEn), ruleId: d.ruleId, cat: 'command', value: cmd, kind: 'command' }
      }
      if (SUBAGENT_TOOLS[name]) {
        const d = resolveCategory('subagent', null, null)
        return { action: d.action, reason: bi('启动子代理' + exReason(d), 'Spawn subagent' + exReasonEn(d)), ruleId: d.ruleId, cat: 'subagent', value: null, kind: null }
      }
      const q = quickAction(name)
      if (q) {
        // 命中预设默认值时区分措辞，避免把「默认动作」说成用户显式设置
        const label = q.isDefault ? '快捷默认' : '快捷设置'
        const labelEn = q.isDefault ? 'Quick default' : 'Quick setting'
        // 该工具被显式设成 deny 且写了拒绝原因时带上它（回给 AI）；预设默认值没有原因
        const qr = q.action === 'deny' && q.reason ? '（' + q.reason + '）' : ''
        const qrEn = q.action === 'deny' && q.reason ? ' (' + q.reason + ')' : ''
        return { action: q.action, reason: bi(label + '：' + name + ' → ' + q.action + qr, labelEn + ': ' + name + ' → ' + q.action + qrEn), ruleId: null, cat: 'quick', value: name, kind: 'tool' }
      }
      const fb = fallbackSetting()
      if (fb.mode === 'allow') return { action: 'allow', reason: bi('未匹配任何规则，放行', 'No rule matched, allowed'), cat: null, value: null, kind: null }
      // 兜底的拒绝原因同样回给 AI（ask 时它只是弹窗文案的一部分，不参与回传）
      const fr = fb.mode === 'deny' && fb.reason ? '（' + fb.reason + '）' : ''
      const frEn = fb.mode === 'deny' && fb.reason ? ' (' + fb.reason + ')' : ''
      return { action: fb.mode, reason: bi('未匹配任何规则，按兜底策略处理：' + fb.mode + fr, 'No rule matched; handled by fallback policy: ' + fb.mode + frEn), ruleId: null, cat: 'fallback', value: name, kind: 'tool' }
    }

    function recordDecision(d, exec) {
      decisions.push({ ts: new Date().toISOString(), tool: exec.name, action: d.action, ruleId: d.ruleId || null, reason: d.reason || '' })
      if (decisions.length > MAX_DECISIONS) decisions.splice(0, decisions.length - MAX_DECISIONS)
    }

    function dirGlob(p) {
      const s = String(p).replace(/\\/g, '/').replace(/\/+$/, '')
      const idx = s.lastIndexOf('/')
      let dir = idx >= 0 ? s.slice(0, idx) : s
      // 盘根（G:）本身就是父目录，直接拼 /*；若补分隔符会得到 G://*，而 norm 不折叠中间双斜杠，
      // 该 glob 匹配不到任何真实路径，会让「整个目录」候选写出的例外永不生效
      if (/^[a-zA-Z]:$/.test(dir)) return dir + '/*'
      if (!dir) dir = '/'
      return dir + '/*'
    }

    function alreadyInProject(value, kind, catKey) {
      const proj = projectBlock()
      if (!proj) return false
      // 只有「方向明确」的例外（allow / deny）才算已表态，ask 例外不算：
      // ask 例外表达的是「这个值每次都问我」，不是「用户已决定放行或拒绝」。
      // 若把 ask 也算作已覆盖，用户加了 ask 例外后弹窗里就再也不给「允许此项」候选，
      // 想改成永久放行只能去设置面板手工编辑 —— 与候选「一键记住这个决定」的用途相反。
      const decided = (r) => r.action !== 'ask'
      if (kind === 'command') {
        const cat = proj.command
        return !!(cat && Array.isArray(cat.exceptions) && cat.exceptions.some((r) => decided(r) && r.match === value))
      }
      if (kind === 'path' && catKey && EXC_CATS.indexOf(catKey) !== -1) {
        const cat = proj[catKey]
        // 与 pathKey 同口径：相对路径、含 .. 、斜杠与大小写写法都归一到同一条
        return !!(cat && Array.isArray(cat.exceptions) && cat.exceptions.some((r) => decided(r) && pathKey(r.path) === pathKey(value)))
      }
      if (kind === 'tool') {
        return !!(Array.isArray(proj.custom) && proj.custom.some((r) => r.tool === value))
      }
      return false
    }

    // 路由器命令的「带值选项」：跳过选项本身后还要跳过它的值（git -c key=val / npm --prefix ./x）
    const ROUTER_OPT_VALUE = { '-c': 1, '-C': 1, '--config': 1, '--config-env': 1, '--git-dir': 1, '--work-tree': 1, '--namespace': 1, '--exec-path': 1, '-H': 1, '--prefix': 1, '--cwd': 1, '--project': 1, '--registry': 1 }

    function commandTokens(seg) {
      const toks = String(seg).trim().split(/\s+/)
      if (!toks.length) return []
      let idx = 0
      if (toks[0].indexOf('$') === 0) {
        if (toks[1] === '=') idx = 2
        else return []
      }
      const cleanToken = (t) => {
        t = String(t).replace(/[;|]$/, '')
        t = t.replace(/^[.\/\\]/, '').trim()
        if (!t) return ''
        if (t.indexOf('$') !== -1 || t.indexOf('@') !== -1) return ''
        if (t.indexOf(':') !== -1 || t.indexOf('\\') !== -1 || t.indexOf('/') !== -1) return ''
        if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(t)) return ''
        if (/[()[\]{}'"]/.test(t)) return ''
        return t
      }
      const first = cleanToken(toks[idx])
      if (!first) return []
      if (PS_KEYWORDS[first.toLowerCase()]) {
        // 关键字开头（foreach/if…）：继续向后找真正的命令 token
        for (let j = idx + 1; j < toks.length; j++) {
          const t = cleanToken(toks[j])
          if (!t) continue
          if (PS_KEYWORDS[t.toLowerCase()]) continue
          return [t]
        }
        return []
      }
      if (!ROUTER_CMDS[first.toLowerCase()]) return [first]
      // 路由器命令：跳过选项（含带值选项的值），取第一个非选项 token 作子命令
      // 子命令位不做 PS 关键字过滤（git switch 是真子命令；子命令属于路由器自己的词汇表）
      let sub = ''
      for (let j = idx + 1; j < toks.length; j++) {
        const raw = String(toks[j]).replace(/[;|]$/, '')
        if (raw.indexOf('-') === 0) {
          if (ROUTER_OPT_VALUE[raw]) j++
          continue
        }
        const t = cleanToken(raw)
        if (!t) continue
        sub = t
        break
      }
      return sub ? [first, sub] : [first]
    }

    // 命令的所有可识别命令 token（如 Get-ChildItem / git status）是否均已命中 allow 例外。
    // 两道安全闸：① 破坏性命令（杀进程/删文件/改系统）一律不走「全命中」快速通道，
    // ② 任一命令段识别不出命令 token（变量赋值/表达式/字符串拼接等）也不视为已覆盖。
    // 两者命中时仍需弹窗走正常判定（用户显式配置的 allow 例外仍会命中，这里只挡「碰巧覆盖」）。
    const DANGEROUS_CMD_RE = /\b(?:Stop-Process|Stop-Service|Stop-Computer|Stop-Job|Restart-Computer|Restart-Service|Remove-Item|Remove-ItemProperty|Remove-Service|Remove-PSDrive|Remove-Variable|Remove-Alias|Remove-Event|Remove-Job|Start-Process|Start-Service|Start-Computer|Start-Job|taskkill|shutdown|format|diskpart|rmdir|erase|Clear-Content|Clear-Item|Set-ExecutionPolicy|icacls|takeown|attrib|reg\s+delete|wmic\s+process)\b/i
    function commandFullyCovered(cmd) {
      try {
        const whole = String(cmd || '')
        // 破坏性命令：即便命令 token 命中 allow 例外，也不允许静默放行
        if (DANGEROUS_CMD_RE.test(whole)) return false
        const parts = whole.split(/[|;]/)
        const results = []
        for (const seg of parts) {
          const toks = commandTokens(seg)
          // 识别不出命令 token 的段：解析器看不懂，不能当作「已覆盖」
          if (!toks.length) return false
          let label = toks[0]
          if (toks.length >= 2 && ROUTER_CMDS[toks[0].toLowerCase()]) label = toks[0] + ' ' + toks[1]
          const value = label + ' *'
          const proj = projectBlock()
          const lists = []
          if (proj && proj.command && Array.isArray(proj.command.exceptions)) lists.push(proj.command.exceptions)
          if (config.global.command && Array.isArray(config.global.command.exceptions)) lists.push(config.global.command.exceptions)
          let hit = false
          for (const list of lists) {
            for (const r of list) {
              if (r.action === 'allow' && matchCommand(r.match, value)) { hit = true; break }
            }
            if (hit) break
          }
          results.push(hit)
        }
        return results.length > 0 && results.every(Boolean)
      } catch (e) { return false }
    }

    // 引号感知的命令分段：只把引号外的 | 与 ; 当分段符。
    // 正则/字符串里常含 |（如匹配盘符的正则），按管道切开会产生 C:\ 这类假命令。
    function splitCommandSegments(s) {
      const out = []
      let cur = ''
      let quote = null
      for (let i = 0; i < s.length; i++) {
        const ch = s[i]
        if (quote !== null) {
          cur += ch
          if (ch === quote) {
            if (quote === "'" && s[i + 1] === "'") { cur += s[++i]; continue }
            if (quote === '"' && s[i - 1] === '`') continue
            quote = null
          }
          continue
        }
        if (ch === "'" || ch === '"') { quote = ch; cur += ch; continue }
        if (ch === '|' || ch === ';') { out.push(cur); cur = ''; continue }
        cur += ch
      }
      out.push(cur)
      return out
    }

    function buildCandidates(entry) {
      const out = []
      // hint：候选行下方的灰色小字（说明这条会放开什么），与 label（主文案，通常就是路径）分开下发，
      // 由客户端排版成「路径 + 小字 + 按钮」，避免把说明塞进 label 里挤成一大段
      const push = (label, value, kind, writes, hint) => out.push({ id: 'c' + Math.random().toString(36).slice(2, 8), label, value, kind, writes: Array.isArray(writes) ? writes : [{ cat: entry.cat, kind, value }], ...(hint ? { hint } : {}) })
      const t = (zh, en) => (uiLang === 'en' ? en : zh)
      if (entry.kind === 'command' && entry.value) {
        const parts = splitCommandSegments(String(entry.value))
        const seen = {}
        for (const seg of parts) {
          const toks = commandTokens(seg)
          if (!toks.length) continue
          let label = toks[0]
          if (toks.length >= 2 && ROUTER_CMDS[toks[0].toLowerCase()]) label = toks[0] + ' ' + toks[1]
          if (seen[label]) continue
          seen[label] = true
          const val = label + ' *'
          if (alreadyInProject(val, 'command', null)) continue
          push(label, val, 'command')
        }
      } else if (entry.kind === 'path' && entry.value) {
        // 例外按 glob 匹配：文件路径若含 * 或 ?，写成的例外会比「仅此路径」宽得多
        // （例如 ** 会匹配整个子树）——这类路径不生成以「文件」为粒度的候选，避免文案与授权范围不符。
        // 注意：[ ] 在 globToRegExp 里被转义成字面量、不是通配符，故不拦（否则含 [1] 的合法文件名会被误伤）。
        const hasGlobMeta = (p) => /[*?]/.test(String(p || ''))
        // 含 .. 段的路径同样不能用来拼目录 glob：glob 只做字符串匹配、不折叠 ..，
        // 写出的模式会命中解析后与「整个目录」文案完全不同的路径（授权面更大）。
        const hasParentSeg = (p) => /(^|[\\/])\.\.([\\/]|$)/.test(String(p || ''))
        const catKey = entry.toolCat && EXC_CATS.indexOf(entry.toolCat) !== -1 ? entry.toolCat : entry.cat
        const outsideHere = !!(catKey && catKey !== 'directory' && isOutside(entry.value, root))
        // 候选文案用的分类名：说明这条候选会放开「哪一类操作」，避免文案与落盘的例外分类不符
        // 标签与设置面板的分类名保持一致（edit 就叫「编辑文件」，不再写「写入/编辑」）
        const KIND_LABEL = { read: ['读取文件', 'file reads'], image: ['读取图片', 'image reads'], edit: ['编辑文件', 'file edits'], undo: ['撤销操作', 'undo actions'] }
        const kindLabel = KIND_LABEL[catKey] || ['此类操作', 'this kind of operation']
        if (outsideHere) {
          // 工作区外路径：两道闸各给一条候选。「整个目录」写 directory 与该分类的目录 glob ——
          // 点一次后该类操作在该目录下都不再询问；「仅此文件」写自身分类例外 + directory 的精确路径例外。
          // 路径先规范化为绝对路径（折叠 .. 与重复分隔符）：判重与落盘值统一基于它。
          // 含通配符的原文不做折叠——pathResolve 会把 `*` 当普通目录名、被其后的 .. 吃掉
          // （实测 C:/x/*/../y.txt → C:/x/y.txt），使通配路径被误当成精确路径生成候选。
          const absVal = hasGlobMeta(entry.value) ? norm(entry.value) : normAbsPath(entry.value)
          // 守卫按**原始值**判定：absVal 已折叠 ..，对它判 hasParentSeg 恒为 false，等于没有守卫。
          // 含 .. 的原文不给目录 glob——dirGlob 取父目录，`..` 可拼出覆盖整个盘根的 `G:/*`。
          const globSafe = !hasGlobMeta(entry.value) && !hasParentSeg(entry.value)
          const glob = globSafe ? dirGlob(absVal) : ''
          const hasDirGlob = globSafe && alreadyInProject(glob, 'path', 'directory')
          const hasKindGlob = globSafe && alreadyInProject(glob, 'path', catKey)
          if (globSafe && (!hasDirGlob || !hasKindGlob)) {
            // label 就是路径本身（弹窗里最该被看清的东西），范围说明走 hint 小字
            push(glob, glob, 'path', [{ cat: 'directory', kind: 'path', value: glob }, { cat: catKey, kind: 'path', value: glob }], t('工作区外访问目录 + ' + kindLabel[0] + '权限', 'Outside workspace · directory + ' + kindLabel[1]))
          }
          const fileVal = absVal
          // 判重按该候选实际要写的**全部分类**判定：它同时写 catKey 与 directory 两条例外，
          // 只要其中一道闸还没有等价例外就得给出候选——否则用户补不上那道闸，只能改选
          // 「整个目录」，精确授权被迫放大为目录级授权。
          const fileWrites = [{ cat: catKey, kind: 'path', value: fileVal }, { cat: 'directory', kind: 'path', value: fileVal }]
          // 按候选实际要写的两个分类（catKey + directory）各自判重：任一道闸缺等价例外即给候选。
          // 注：能走到这里就说明至少一道闸没命中等价例外（两道都命中时 resolveCategory 直接
          // 返回 allow/deny、不会弹窗），因此 covered 当前恒为 false——保留它是防御性冗余，
          // 用来表达「两条写入目标各自判重」的语义，避免未来弹窗流程变更后候选被误隐藏。
          const covered = fileWrites.every((w) => alreadyInProject(w.value, 'path', w.cat))
          // 文件候选只要求原文无通配符：含 .. 的原文已被规范化成精确绝对路径，可以安全给候选
          if (!hasGlobMeta(entry.value) && !covered) {
            push(fileVal, fileVal, 'path', fileWrites, t('工作区外访问文件 + ' + kindLabel[0] + '权限', 'Outside workspace · file + ' + kindLabel[1]))
          }
        } else if (!hasGlobMeta(entry.value)) {
          // 工作区内同样走规范化单点，避免同一份配置里两种路径写法并存
          const absVal = normAbsPath(entry.value)
          if (!alreadyInProject(absVal, 'path', entry.cat)) push(absVal, absVal, 'path')
        }
      }
      // 其余分类无「例外」候选：快捷工具（web_search/skill 等）走 quickTools 设置；
      // 子代理/重复操作只有模式默认值 —— 均不生成候选
      return out
    }

    function askUser(exec, d) {
      return new Promise((resolve) => {
        let settled = false
        let onAbort = null
        const id = 'p' + Math.random().toString(36).slice(2, 10)
        const argsJson = safeJson(exec.arguments)
        const taskText = argDescription(exec.arguments) || recentUserText(exec)
        const entry = {
          id,
          tool: exec.name,
          argsJson,
          cat: d.cat || null,
          value: d.value !== undefined && d.value !== null ? String(d.value) : null,
          kind: d.kind || null,
          reason: d.reason || bi('', ''),
          intent: taskText || describeIntent(exec, d),
          ts: Date.now(),
          candidates: [],
          argLines: humanArgsPreview(exec.name, exec.arguments),
          // 审批发起时的项目根：root 是跨会话共享的闭包变量，随后可能被其他会话覆盖，
          // 审批发起时的项目根与会话 id：root 是跨会话共享的闭包变量，随后可能被其他会话覆盖，
          // 打相对路径/对比/打开侧栏必须用发起会话自己的这两样（会话 id 用来构造 file 地址）。
          projRoot: root || null,
          sessionId: (exec.session && exec.session.id) || null,
          // 编辑/写入，或带文件路径的读取 → 弹窗「详情」默认展开并自动取数据
          // （写类=diff，读类=窗口化内容；图片是整图 data URL，受 IMAGE_MAX_BYTES/像素上限约束）
          hasDiff: isPreviewableFileTool(exec.name, exec.arguments) && !!pathArg(exec.arguments),
          toolCat: pathToolCat(exec.name, exec.arguments),
          // str_replace_editor 的内核在审批发起时定下（insert 的 insert_line 语义随内核相反），
          // 详情预览按发起时的实际内核解释，避免中途判别漂移
          editorKernel: resolveEditorKernel(exec).kernel,
          resolve,
          cleanup() {
            if (onAbort && exec.signal) { try { exec.signal.removeEventListener('abort', onAbort) } catch (e) {} }
            pendingApprovals.delete(id)
            broadcast({ type: 'pending' })
          },
        }
        entry.candidates = buildCandidates(entry)
        pendingApprovals.set(id, entry)
        broadcast({ type: 'pending' })
        // 永不超时：审批完全由用户在弹窗中决定，不会自动拒绝。
        // 唯一结束路径：用户允许/拒绝，或执行被取消（abort，见下）。
        onAbort = () => {
          if (settled) return
          settled = true
          entry.cleanup()
          resolve({ kind: 'deny', reason: uiLang === 'en' ? 'Approval request cancelled' : '审批请求已取消' })
        }
        if (exec.signal && exec.signal.addEventListener) {
          try { exec.signal.addEventListener('abort', onAbort, { once: true }) } catch (e) {}
        }
      })
    }

    // 例外落盘单点：按「分类 + 类型（path/command/custom）+ 值」写入目标块（缺省全局，
    // 候选写入由调用方显式指定项目块）。
    // 候选各自携带目标分类（buildCandidates 的 writes），不再由 entry.cat 统一决定——
    // 否则「仅允许此文件」这类要写两条例外（自身分类 + 目录闸）的候选会写错分类。
    function addProjectException(cat, kind, value, decision, opts) {
      const o = opts || {}
      const target = o.target === 'project' ? 'project' : 'global'
      // reason / note 直接复用 normalizeText（trim + 截断 200 + 非字符串丢弃），与 normalizeException
      // 同一份实现：否则同一请求会先经 normalizeException 校验、再经这里落盘，两份口径一旦分叉，
      // 就会出现「校验认为没有 reason、落盘却写了 reason」的不一致。
      // 两者按动作各归其位：reason 只随 deny、note 只随 ask（allow 放行后不再弹窗，都存不下）。
      const reason = decision === 'deny' ? normalizeText(o.reason) : undefined
      const note = decision === 'ask' ? normalizeText(o.note) : undefined
      // 回写既有条目时用的字段补丁（同向去重命中后要把新文字写回去）
      const textPatch = (hit) => {
        if (reason) hit.reason = reason
        if (note) hit.note = note
        return hit
      }
      // 新条目一律插到数组头部：resolveCategory 只取首个匹配，即「最新决定先生效」；
      // 同方向重复写入直接跳过并返回既有条目，避免同一决定在列表里堆积。
      const build = (extra) => Object.assign({ id: 'e' + Math.random().toString(36).slice(2, 8), action: decision }, extra, reason ? { reason } : {}, note ? { note } : {})
      try {
        const block = target === 'global' ? config.global : ensureProject()
        if (kind === 'path' && cat && cat !== 'command' && EXC_CATS.indexOf(cat) !== -1) {
          const c = block[cat] || freshCategory(cat, target === 'project')
          if (!c.exceptions) c.exceptions = []
          // 去重与 alreadyInProject / matchException 同口径（pathKey：绝对化 + 折叠 .. + 大小写/斜杠归一）：
          // 否则候选写规范绝对路径、面板写相对或含 .. 原文时会各存一条指向同一路径的例外。
          const idx = c.exceptions.findIndex((r) => pathKey(r.path) === pathKey(value) && r.action === decision)
          if (idx !== -1) {
            // 命中既有同向条目：提到数组头部，否则它会被前面的反向旧条目遮蔽（resolveCategory 只取首个匹配），
            // 用户的决定等于被静默丢弃；带新理由时一并回写（reason 已在入口按 deny + trim + 200 规范化）。
            const hit = c.exceptions.splice(idx, 1)[0]
            textPatch(hit)
            c.exceptions.unshift(hit)
            block[cat] = c
            return hit
          }
          // 落盘统一存规范化路径，与判重/匹配口径一致
          const item = build({ path: normAbsPath(value) })
          c.exceptions.unshift(item)
          block[cat] = c
          return item
        }
        if (kind === 'path') return null
        if (kind === 'command' && cat === 'command') {
          const c = block.command || freshCategory('command', target === 'project')
          if (!c.exceptions) c.exceptions = []
          const idx = c.exceptions.findIndex((r) => r.match === value && r.action === decision)
          if (idx !== -1) {
            const hit = c.exceptions.splice(idx, 1)[0]
            textPatch(hit)
            c.exceptions.unshift(hit)
            block.command = c
            return hit
          }
          const item = build({ match: value })
          c.exceptions.unshift(item)
          block.command = c
          return item
        }
        if (kind === 'command') return null
        if (!block.custom) block.custom = []
        const idx = block.custom.findIndex((r) => r.tool === value)
        if (idx !== -1) { block.custom[idx].action = decision; return block.custom[idx] }
        const item = { id: 'r' + Math.random().toString(36).slice(2, 8), action: decision, tool: value }
        block.custom.unshift(item)
        return item
      } catch (e) {
        console.error('[permgate] addProjectException error:', e)
        return null
      }
    }

    // 例外删除单点（/permgate/remove-exception 路由与 perm_remove_exception 工具共用）：
    // 判定只取数组首个匹配，故同一 path 上可能并存方向相反的多条（最新在前生效）。
    // 删除严格按 id：只删用户点的那一行。同值同向的其它条目（方向交替写入可能累积）留给用户
    // 自行逐条清理，否则删一条历史行会连带删掉正在生效的那条，权限会静默变化。
    function removeExceptionEntries(block, catKey, id) {
      if (EXC_CATS.indexOf(catKey) === -1) return { removed: false, reason: '该分类不支持例外' }
      const c = block && block[catKey]
      if (!c || !Array.isArray(c.exceptions)) return { removed: false, reason: '例外列表不存在' }
      const target = c.exceptions.find((r) => r.id === id)
      if (!target) return { removed: false, reason: '未找到 id=' + id }
      const key = catKey === 'command' ? 'match' : 'path'
      const value = target[key]
      const kept = c.exceptions.filter((r) => r.id !== id)
      const count = c.exceptions.length - kept.length
      c.exceptions = kept
      // 同值、方向相反的条目可能仍然留在列表里并继续生效：回传给 UI 提示，避免用户以为已彻底清除
      const remaining = kept.filter((r) => r[key] === value).length
      return { removed: true, count, remaining, exception: target }
    }

    function addRememberedRule(entry, action, target) {
      try {
        const block = target === 'project' ? ensureProject() : config.global
        if (entry.cat === 'quick') {
          setQuickAction(target, entry.tool, action)
          return
        }
        if (entry.kind === 'path' && entry.cat && EXC_CATS.indexOf(entry.cat) !== -1 && entry.value) {
          // 复用例外写入单点。注意：choice 是用户在弹窗上的显式选择（「拒绝并加入项目黑名单」），
          // 不能套用候选双写场景的「deny 不写 directory 例外」过滤，否则显式决定会被静默丢弃。
          addProjectException(entry.cat, 'path', String(entry.value), action, { target })
          return
        }
        if (entry.kind === 'command' && entry.cat === 'command' && entry.value) {
          addProjectException('command', 'command', String(entry.value), action, { target })
          return
        }
        if (!block.custom) block.custom = []
        const idx = block.custom.findIndex((r) => r.tool === entry.tool)
        if (idx !== -1) { block.custom[idx].action = action; return }
        const rule = { id: 'r' + Math.random().toString(36).slice(2, 8), action, tool: entry.tool }
        if (entry.cat === 'doomloop' && entry.argsJson) rule.args = entry.argsJson
        block.custom.unshift(rule)
      } catch (e) {
        console.error('[permgate] addRememberedRule error:', e)
      }
    }

    // 最近一次成功读取/写入的磁盘原文：persist 前与磁盘比对，防止覆盖外部手工编辑
    let lastDiskJson = null
    // 加载失败哨兵：load 未能建立磁盘基线时置此值，persist 守卫据此拒绝保存，
    // 防止「配置存在但读取失败」后下一次 persist 静默覆盖磁盘上的用户配置
    const LOAD_FAILED_MARK = '\u0000__PERMGATE_LOAD_FAILED__'

    async function persist(exec) {
      try {
        let t = await ensureTarget(exec)
        await ensureConfigDir()
        // 配置只应写到 home：home 不可用时会退到 <root>/.dsh/.permgate.json，而 DSH 的 writeText
        // 会自动 mkdir 父目录——一旦落盘就在项目里留下 .dsh（home 恢复后这份配置还会成为孤儿）。
        // 故此处直接拒绝，等 home 就绪后由 load() 重新落盘。
        const homeNow = await resolveDshHome()
        const pathOf = (v) => norm(pathString(v)).toLowerCase()
        // home 归属判定两侧必须同口径：pathOf 取的是 realpath（processPath），故 home 前缀也要由
        // 解析后的 home 目标派生——否则 home 含 junction/符号链接时前缀恒不匹配，保存会被永久拒绝
        const homeTarget = homeNow ? await homeConfigTarget(homeNow) : null
        const homePrefix = homeTarget ? pathOf(homeTarget).replace(/[\\/][^\\/]*$/, '/') : ''
        const inHome = !!(homeTarget && homePrefix && pathOf(t).indexOf(homePrefix) === 0)
        // home 已恢复但 target 仍停在回退路径时就地重算，省掉一次「重新加载配置文件」
        if (!inHome && homeTarget) {
          target = homeTarget
          t = target
          // 目标切换后旧基线不再属于该目标：基线为空却直接放行，会用内存里的（可能默认）配置
          // 覆盖 home 上已存在的用户配置——故 home 已有文件时拒绝保存并要求先重新加载
            if (lastDiskJson === null && await configExists(fs, t)) {
              saveError = uiLang === 'en' ? 'Config target switched to DSH home; reload the config file before saving.' : '配置路径已切换到 DSH home，请先「重新加载配置文件」再保存'
              broadcast({ type: 'status' })
              return false
            }
        }
        if (!homeTarget || !homePrefix || pathOf(t).indexOf(homePrefix) !== 0) {
          // 区分「home 不可用」与「目标不在 home 下」：前者稍后重试即可，后者需要重新加载配置
          saveError = homeTarget
            ? (uiLang === 'en' ? 'Config target is outside the DSH home; reload the config file before saving.' : '配置目标不在 DSH home 下，请先「重新加载配置文件」再保存')
            : (uiLang === 'en' ? 'DSH home is not ready; save skipped to avoid creating a stray .dsh in the project. Retry shortly.' : 'DSH home 未就绪，已跳过保存（避免在项目里产生 .dsh）；稍后重试即可')
          broadcast({ type: 'status' })
          return false
        }
        // 防覆盖守卫：配置在加载后被外部修改（手工编辑、其他实例写入）时拒绝保存，
        // 避免静默覆盖用户规则；点击「重新加载配置文件」后守卫自动放行。
        try {
          const cur = await fs.readText(t)
          if (lastDiskJson !== null && String(cur || '').trim() !== lastDiskJson) {
            saveError = uiLang === 'en' ? 'Config file changed on disk; save cancelled. Click "Reload config file" first.' : '配置文件已被外部修改，已取消保存；请先点击「重新加载配置文件」'
            broadcast({ type: 'status' })
            return false
          }
        } catch (e) {
          // 读取失败：先用 stat 区分「目标不存在」与「存在但读不出」——
          // 目标不存在（首次落盘 / 迁移到新路径）视为尚无磁盘内容，允许写入并重建基线；
          // 已建立过基线却读不出（被占用、权限、IO 错误）时保守拒绝，避免静默覆盖用户手工编辑的规则
          if (await configExists(fs, t) && lastDiskJson !== null) {
            saveError = uiLang === 'en' ? 'Config file unreadable; save cancelled. Check the file (locked / permission / non-text encoding), then click "Reload config file".' : '配置文件无法读取，已取消保存；请检查该文件（被占用/权限/非文本编码）后再点击「重新加载配置文件」'
            broadcast({ type: 'status' })
            return false
          }
        }
        const writePolicy = { mode: 'danger-full-access', workspaceRoot: root }
        await fs.writeText(t, JSON.stringify(config, null, 2), undefined, undefined, writePolicy)
        lastDiskJson = JSON.stringify(config, null, 2)
        saveError = null
        broadcast({ type: 'status' })
        return true
      } catch (e) {
        saveError = (e && e.message) ? e.message : String(e)
        return false
      }
    }

    // 项目残留配置并入（迁移用）：只采纳 projects 段——工作区内的 .dsh/.permgate.json 可能随
    // 仓库分发或被 agent 写入（不可信），其 global 段一律忽略，避免 clone 即得的宽松「全局」
    // 策略覆盖用户配置；源里若只有旧格式 global（无 projects）则不迁移，从而不会走 migrateOld
    // （旧模式 permissive 会被映射成全 allow）。源不可解析或无可迁移内容时返回 null。
    function projectsFromConfig(srcText) {
      try {
        const src = JSON.parse(String(srcText == null ? '' : srcText))
        if (!src || typeof src !== 'object') return null
        const projects = src.projects && typeof src.projects === 'object' ? src.projects : null
        if (!projects) return null
        // 只接纳当前工作区自己的条目：工作区文件可能随仓库分发或被 agent 写入（不可信），
        // 其他 key 会被 cleanupStaleProjects 逐个 resolve/stat（UNC 会触发网络访问），
        // 也会长期套用于别的项目，故一律丢弃
        const rootKey = normPathKey(root)
        const keep = {}
        if (rootKey) {
          for (const key of Object.keys(projects)) {
            if (normPathKey(key) !== rootKey) continue
            keep[key] = projects[key]
          }
        }
        if (!Object.keys(keep).length) return null
        return JSON.stringify({ projects: keep })
      } catch (e) { return null }
    }

    // 迁移成功后清理项目残留配置文件（删除失败只影响清理，不影响已完成的落盘）
    function removeMigratedSource(p) {
      try {
        const raw = pathString(p)
        // 迁移源必须是工作区内那个字面文件：targetKey 为 realpath，符号链接会让删除落到
        // 工作区外的真实文件，故以「父目录 realpath + 文件名」构造期望路径，再与文件 realpath 比较
        if (!raw) return false
        let want = ''
        try { want = pathJoin(fsRealpathSync(pathResolve(root, '.dsh')), '.permgate.json') } catch (e2) { return false }
        let st = null
        try { st = fsLstatSync(raw) } catch (e2) { return false }
        if (!st || !st.isFile()) return false
        const real = fsRealpathSync(raw)
        if (normPathKey(real) !== normPathKey(want)) return false
        fsUnlinkSync(real)
        return true
      } catch (e) { return false }
    }

    // home 配置探测统一（missing 分支重试与非 missing 分支校验共用）：
    // 返回 {target, text}（可读）、{target, missing:true}（不存在）、{target, readFailed:true}（存在但读失败）、null（home 不可用）
    async function probeHomeConfig() {
      const homeNow = await resolveDshHome()
      if (!homeNow) return null
      const target = await homeConfigTarget(homeNow)
      if (!target) return null
      const exists = await configExists(fs, target)
      if (!exists) return { target, missing: true }
      try {
        const text = await fs.readText(target)
        if (text === null) return { target, readFailed: true }
        return { target, text }
      } catch (e) { return { target, readFailed: true } }
    }

    async function load(exec) {
      try {
        const t = await ensureTarget(exec)
        let migratedFromProject = false
        let migratedFromPath = null
        let projReadFailed = false
        let text = null
        let missing = false
        try {
          const info = await fs.stat(t)
          missing = !info
        } catch (e) { missing = true }
        if (!missing) {
          try { text = await fs.readText(t) } catch (e) { text = null }
        }
        if (missing || text === null) {
          // 文件不存在 → 首次运行，落盘默认配置；
          // 存在但读取失败 → 保留内存配置并提示，绝不静默覆盖磁盘（避免误删规则）
          if (missing) {
            // 初始化早期 subprocess 可能未就绪导致 home 解析失败、target 落到项目目录；
            // 落盘默认配置前重试一次 home 定位，优先复用 home 配置（避免在项目内新建配置文件）
            const hp = await probeHomeConfig()
            if (hp) {
              if (hp.text !== undefined) {
                target = hp.target
                text = hp.text
              } else if (hp.readFailed) {
                // home 配置存在但读取失败：保留内存配置并提示，绝不静默覆盖磁盘
                lastDiskJson = LOAD_FAILED_MARK
                loadError = uiLang === 'en' ? 'Cannot read config file: ' + hp.target : '无法读取配置文件: ' + hp.target
                return
              } else {
                // home 配置不存在：检查项目目录残留配置（1.3.x 竞态期可能 persist 到项目
                // .dsh/.permgate.json），存在且可读则迁移为初始配置（解析后落盘 homeT），避免用户规则静默丢失
                const projCfg = root ? await fs.resolve(root + '/.dsh/.permgate.json') : null
                if (projCfg) {
                  const projExists = await configExists(fs, projCfg)
                  if (projExists) {
                    try {
                      const projText = await fs.readText(projCfg)
                      // 并入项目残留配置：只采纳 projects 段（工作区内文件不可信，其 global 一律忽略），
                      // 迁移成功落盘后再删除源文件
                      const mergedText = projectsFromConfig(projText)
                      if (mergedText !== null) { target = hp.target; text = mergedText; migratedFromProject = true; migratedFromPath = projCfg }
                    } catch (e) {
                      // 残留存在但读不出（权限/占用/非 UTF-8）：与 home 的 readFailed 同口径——置哨兵并提示，
                      // 且不落默认配置，避免项目残留里的用户规则被静默放弃（此前会永久跳过迁移）
                      projReadFailed = true
                    }
                  }
                }
              }
            }
            if (text === null) {
              // 项目残留配置存在却读不出：不落默认配置（否则 home 一旦写入就再也不迁移），
              // 置哨兵并提示，修复该文件后重新加载即可继续迁移
              if (projReadFailed) {
                lastDiskJson = LOAD_FAILED_MARK
                loadError = uiLang === 'en' ? 'Cannot read the project residual config; migration skipped. Fix that file and reload.' : '项目残留配置无法读取，已跳过迁移；修复该文件后重新加载即可'
                return
              }
              loadError = null
              config = freshConfig()
              // 正常初始化路径：清除加载失败哨兵，允许创建默认配置
              lastDiskJson = null
              // home 可能在本次探测中已恢复：显式把 target 切回 home，避免默认配置
              // 落到项目回退路径（DSH 的 writeText 会自动 mkdir，从而在项目里留下 .dsh）
              const homeNow = await resolveDshHome()
              if (homeNow) target = await homeConfigTarget(homeNow)
              await persist(exec)
              return
            }
          } else {
            // 配置存在但读取失败：置加载失败哨兵，阻止后续 persist 静默覆盖
            lastDiskJson = LOAD_FAILED_MARK
            loadError = uiLang === 'en' ? 'Cannot read config file: ' + t : '无法读取配置文件: ' + t
            return
          }
        }
        // home 配置优先：竞态期 target 可能落在项目目录且项目残留配置存在（missing=false 时
        // 上面不会重试 home）。此时若 home 可解析且 home 配置存在，切回 home，避免永久使用项目旧配置。
        // 只有当 target 不是 home 配置（竞态期落在项目回退路径）时才探测：否则会对同一份
        // 文件重复 resolve+stat+readText（load 顶部已读过一次）
        if (!missing && text !== null) {
          const homeNow = await resolveDshHome()
          const homeTarget = homeNow ? await homeConfigTarget(homeNow) : null
          if (homeTarget && normPathKey(pathString(homeTarget)) !== normPathKey(pathString(target))) {
            const hp = await probeHomeConfig()
            if (hp && hp.text !== undefined && hp.target !== target) {
              target = hp.target
              text = hp.text
            }
          }
        }
        const parsed = JSON.parse(text)
        if (!parsed || typeof parsed !== 'object') throw new Error('根节点必须是对象')
        const isOld = parsed.global && typeof parsed.global === 'object' && parsed.global.mode !== undefined && parsed.global.directory === undefined
        config = isOld ? migrateOld(parsed) : buildConfig(parsed)
        lastDiskJson = String(text).trim()
        loadError = null
        saveError = null
        if (isOld || migratedFromProject) {
          const saved = await persist(exec)
          // 迁移成功落盘后才删除项目残留文件，避免写盘失败导致配置丢失
          if (saved && migratedFromPath) removeMigratedSource(migratedFromPath)
        }
        broadcast({ type: 'status' })
      } catch (e) {
        loadError = '配置解析失败: ' + ((e && e.message) || String(e))
        lastDiskJson = LOAD_FAILED_MARK
      }
    }

    function statusView(exec, lang) {
      const l = normLang(lang || uiLang)
      const proj = projectBlock()
      const effective = {}
      for (const c of CATS) {
        effective[c] = firstEffective(proj && proj[c] && proj[c].mode, config.global[c] && config.global[c].mode, 'allow')
      }
      const stats = { deny: 0, ask: 0 }
      for (const d of decisions) {
        if (d.action === 'deny') stats.deny++
        else if (d.action === 'ask') stats.ask++
      }
      return {
        configPath: target ? (fs.processPath ? fs.processPath(target) : String(root)) : String(root) + '/.dsh/.permgate.json',
        active: true,
        preset: sessionPresetName(exec),
        sandbox: {
          global: config.global.sandboxMode || 'danger-full-access',
          project: (projectBlock() && projectBlock().sandboxMode) || 'inherit',
          effective: effectiveSandboxConfig(),
        },
        activeForSession: sessionPresetName(exec) === 'custom-review',
        projectKey: root,
        rootSource,
        debugAgentCwd: agentCwd(exec) || null,
        loadError,
        saveError,
        categories: {
          global: config.global,
          project: proj || null,
        },
        effective,
        quickTools: {
          global: config.global.quickTools || {},
          project: (proj && proj.quickTools) || {},
        },
        // 预设清单下发（单一来源为 QUICK_DEFAULTS）：浏览器半边不再硬编码工具名清单
        quickPreset: QUICK_PRESET,
        // 预设默认动作一并下发：面板未配置行按「项目键 → 全局键 → 预设默认 → 兜底」显示，与 quickAction 同链
        quickDefaults: QUICK_DEFAULTS,
        custom: {
          global: config.global.custom || [],
          project: (proj && proj.custom) || [],
        },
        counts: {
          globalCustom: (config.global.custom || []).length,
          projectCustom: (proj && proj.custom ? proj.custom : []).length,
        },
        stats,
        recentDecisions: decisions.slice(-10).map((d) => Object.assign({}, d, { reason: typeof d.reason === 'string' ? d.reason : L(d.reason, l) })),
        cats: CATS,
        editorKernel: { setting: editorKernelSetting(), ...resolveEditorKernel(exec) },
        fallback: { global: config.global.fallbackMode || 'ask', project: (proj && proj.fallbackMode) || 'inherit', effective: fallbackMode(), globalReason: normalizeText(config.global.fallbackReason) || null, projectReason: normalizeText(proj && proj.fallbackReason) || null },
        excCats: EXC_CATS,
        modes: MODES,
        allModes: ALL_MODES,
      }
    }

    // ── HTTP 路由（浏览器 UI 经 /permgate/* 同源调用）──────────────────────────

    function json(res, data, status) {
      const body = JSON.stringify(data)
      res.writeHead(status || 200, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) })
      res.end(body)
    }

    function readBody(req) {
      return new Promise((resolve, reject) => {
        const chunks = []
        req.on('data', (c) => { chunks.push(c) })
        req.on('end', () => {
          try {
            const text = Buffer.concat(chunks).toString('utf8').trim()
            resolve(text ? JSON.parse(text) : {})
          } catch (e) { reject(e) }
        })
        req.on('error', reject)
      })
    }

    // ── SSE：/permgate/events 长连接推送（状态/待审批变化即时通知浏览器）────────

    function broadcast(payload) {
      const data = 'data: ' + JSON.stringify(payload) + '\n\n'
      for (const res of sseClients) {
        try { res.write(data) } catch (e) { sseClients.delete(res) }
      }
    }

    function handleEvents(req, res) {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      })
      res.write(': connected\n\n')
      sseClients.add(res)
      const done = () => { sseClients.delete(res) }
      req.on('close', done)
      res.on('close', done)
      res.on('error', done)
    }

    async function routePermgate(req, res) {
      try {
        let pathname = '/permgate'
        let search = null
        try {
          const u = new URL(req.url || '/permgate', 'http://localhost')
          pathname = u.pathname.replace(/\/+$/, '') || '/permgate'
          search = u.searchParams
        } catch (e) {}
        const method = (req.method || 'GET').toUpperCase()
        if (pathname === '/permgate/events' && method === 'GET') return handleEvents(req, res)
        const a = method === 'POST' ? await readBody(req) : {}
        // 语言参数归一化：缺失/空/非法一律中文；同时更新 uiLang 供宿主即时文案
        const lang = normLang(method === 'GET' ? (search ? search.get('lang') : null) : a.lang)
        uiLang = lang
        // 按会话解析（设置面板/DockBar 传 sessionId）：后续所有项目解析跟随该会话，
        // 切换会话后面板显示与写入的都是当前会话的项目配置
        let exec = null
        const sid = method === 'POST' ? a.sessionId : (search ? search.get('sessionId') : null)
        if (sid && ctx.sessions && typeof ctx.sessions.get === 'function') {
          try {
            const s = ctx.sessions.get(sid)
            if (s) exec = { agent: { session: s } }
          } catch (e) {}
        }
        if (pathname === '/permgate/pending' && method === 'GET') {
          const out = []
          for (const e of pendingApprovals.values()) {
            const argsPreview = e.argsJson && e.argsJson.length > 160 ? e.argsJson.slice(0, 160) + '…' : (e.argsJson || '')
            const reason = typeof e.reason === 'string' ? e.reason : L(e.reason, lang)
            const intent = typeof e.intent === 'string' ? e.intent : L(e.intent, lang)
            // projRoot 下发给客户端：打开 DSH 右侧栏的 file tab 需要它来把工作区内的绝对路径
            // 折算成工作区相对路径（工作区外的绝对路径则原样进地址），与上游 fileAddressFor 同口径
            // projRoot/sessionId 下发给客户端：打开 DSH 右侧栏的 file tab 需要它们来构造
            // dsh-resource://file/session/<sessionId>/<path> 地址（工作区内的绝对路径还依赖 projRoot 折算）
            out.push({ id: e.id, tool: e.tool, reason, ts: e.ts, args: argsPreview, intent, candidates: e.candidates || [], argLines: e.argLines || [], hasDiff: e.hasDiff === true, projRoot: e.projRoot || null, sessionId: e.sessionId || null })
          }
          return json(res, out)
        }
        if (pathname === '/permgate/file-diff' && method === 'POST') {
          const entry = pendingApprovals.get(a.id)
          if (!entry) return json(res, { ok: false, error: lang === 'en' ? 'Approval request not found or expired' : '审批请求不存在或已过期' })
          try {
            const r = await buildFileDiffData(entry, fs)
            if (!r) return json(res, { ok: false, error: lang === 'en' ? 'Cannot build comparison' : '无法生成对比' })
            if (!r.ok) return json(res, { ok: false, error: typeof r.error === 'string' ? r.error : L(r.error, lang) })
            return json(res, r)
          } catch (e) {
            // 记录真实错误，避免生产故障只以泛化文案呈现而不可见
            console.error('[permgate] file-diff error:', e)
            return json(res, { ok: false, error: lang === 'en' ? 'Cannot build comparison' : '无法生成对比' })
          }
        }
        if (pathname === '/permgate/status' && method === 'GET') {
          await init(exec)
          // 按会话查询：web 端 DockBar/设置面板传 sessionId，状态只反映该会话的权限；
          // 缺失时走全局回退（最近权限事件会话 / 最后创建会话）
          return json(res, statusView(exec, lang))
        }
        if (pathname === '/permgate/decide' && method === 'POST') {
          const entry = pendingApprovals.get(a.id)
          if (!entry) return json(res, { error: lang === 'en' ? 'Approval request not found or expired' : '审批请求不存在或已过期' })
          let allow = false
          let ruleCount = 0
          // 例外落盘单点（候选路径与旧形态规则共用）：内含「拒绝时不写 directory 例外」这道安全过滤
          // 与计数，避免同一决定因入口不同而落盘范围不同；候选写入一律显式落到项目块。
          const writeException = (cat, kind, value, decision) => {
            if (decision === 'deny' && cat === 'directory') return
            addProjectException(cat, kind, value, decision, { target: 'project' })
            ruleCount++
          }
          const writeCandidate = (cand, decision) => {
            for (const w of cand.writes) writeException(w.cat, w.kind || 'path', String(w.value), decision)
          }
          if (typeof a.action === 'string' && (a.action === 'allow' || a.action === 'deny')) {
            allow = a.action === 'allow'
            if (Array.isArray(a.rules)) {
              for (const r of a.rules) {
                if (!r || (r.decision !== 'allow' && r.decision !== 'deny')) continue
                // 整体为拒绝时不接受 allow 方向的规则：前端可能残留「允许此项」的勾选，
                // 若不拦就会变成「本次拒绝 + 持久化一条 allow 例外」，与用户显式拒绝的意图相反。
                if (!allow && r.decision === 'allow') continue
                const cand = r.id ? (entry.candidates || []).find((c) => c.id === r.id) : null
                if (cand && Array.isArray(cand.writes) && cand.writes.length) {
                  writeCandidate(cand, r.decision)
                  continue
                }
                if (r.value) {
                  // 旧形态（无候选 id）：按 value 反查候选，复用它的 writes，避免只落一条例外而导致同一文件反复弹窗
                  const byValue = (entry.candidates || []).find((c) => c.value === String(r.value))
                  if (byValue && Array.isArray(byValue.writes) && byValue.writes.length) {
                    writeCandidate(byValue, r.decision)
                    continue
                  }
                  writeException(entry.cat, r.kind || null, String(r.value), r.decision)
                }
              }
            }
          } else {
            const choice = a.choice
            if (DECIDE_CHOICES.indexOf(choice) === -1) return json(res, { error: lang === 'en' ? 'Invalid choice' : '非法选择' })
            const m = /^(allow|deny)-(global|project)$/.exec(choice)
            if (m) {
              addRememberedRule(entry, m[1], m[2])
              ruleCount++
            }
            allow = choice === 'allow' || choice === 'allow-global' || choice === 'allow-project'
          }
          const customReason = typeof a.reason === 'string' ? a.reason.trim().slice(0, 500) : ''
          entry.cleanup()
          if (ruleCount > 0) await persist()
          entry.resolve(allow
            ? { kind: 'allow', ruleAdded: ruleCount > 0 }
            : { kind: 'deny', reason: customReason || (lang === 'en' ? (ruleCount > 0 ? 'User denied and rule added' : 'User denied') : (ruleCount > 0 ? '用户拒绝并加入规则' : '用户拒绝')) })
          return json(res, { ok: true, ruleAdded: ruleCount > 0 })
        }
        if (pathname === '/permgate/set-sandbox' && method === 'POST') {
          await init(exec)
          const target = normTarget(a)
          if (!setSandboxConfig(target, a.mode)) return json(res, { error: '非法沙箱参数: target=' + target + ' mode=' + a.mode })
          await persist(exec)
          syncSandbox(exec)
          return json(res, statusView(exec))
        }
        if (pathname === '/permgate/set-fallback' && method === 'POST') {
          await init(exec)
          const target = normTarget(a)
          if (!setFallbackMode(target, a.mode, a.reason)) return json(res, { error: '非法兜底参数: target=' + target + ' mode=' + a.mode })
          await persist(exec)
          return json(res, statusView(exec))
        }
        if (pathname === '/permgate/set-editor-kernel' && method === 'POST') {
          await init(exec)
          const target = normTarget(a)
          if (!setEditorKernel(target, a.mode)) return json(res, { error: '非法内核参数: target=' + target + ' mode=' + a.mode })
          await persist(exec)
          return json(res, statusView(exec))
        }
        if (pathname === '/permgate/set-categories' && method === 'POST') {
          await init(exec)
          for (const t of ['global', 'project']) {
            const src = a[t]
            if (!src || typeof src !== 'object') continue
            for (const c of CATS) {
              if (typeof src[c] === 'string') setCategoryMode(t, c, src[c])
            }
          }
          await persist(exec)
          return json(res, statusView(exec))
        }
        if (pathname === '/permgate/set-category' && method === 'POST') {
          await init(exec)
          // target 与其它设置路由同口径归一（缺失/非法一律 global）：若直接把 a.target 传进
          // setCategoryMode，非 'global' 的值会落到 project 并 ensureProject() 凭空建块写盘。
          const target = normTarget(a)
          if (CATS.indexOf(a.category) === -1) return json(res, { error: '未知分类: ' + a.category })
          if (!setCategoryMode(target, a.category, a.mode, a.reason)) return json(res, { error: '非法的 target/mode 组合' })
          await persist(exec)
          return json(res, statusView(exec))
        }
        if (pathname === '/permgate/set-quick' && method === 'POST') {
          await init(exec)
          const target = normTarget(a)
          if (!a.tool || !String(a.tool)) return json(res, { error: 'tool 不能为空' })
          if (!setQuickAction(target, a.tool, a.action, a.reason)) return json(res, { error: '非法动作' })
          await persist(exec)
          return json(res, statusView(exec))
        }
        if (pathname === '/permgate/add-exception' && method === 'POST') {
          await init(exec)
          if (EXC_CATS.indexOf(a.category) === -1) return json(res, { error: '该分类不支持例外' })
          if (!a.match || !String(a.match)) return json(res, { error: 'match 不能为空' })
          const e = normalizeException({ id: 'e' + Math.random().toString(36).slice(2, 8), action: a.action, reason: a.reason, note: a.note, path: a.category === 'command' ? undefined : a.match, match: a.category === 'command' ? a.match : undefined }, a.category)
          if (!e) return json(res, { error: '非法的例外参数' })
          // 例外写入统一走 addProjectException：与候选写入共用「同方向不重复、新决定插头部」的语义，
          // 否则面板新加的例外会排在历史条目之后，被 resolveCategory 的首个匹配静默屏蔽。
          const written = addProjectException(a.category, a.category === 'command' ? 'command' : 'path', a.match, a.action, { target: a.target, reason: a.reason, note: a.note })
          if (!written) return json(res, { error: '例外未写入：分类/参数不支持' })
          await persist(exec)
          return json(res, { added: written, status: statusView(exec) })
        }
        if (pathname === '/permgate/remove-exception' && method === 'POST') {
          await init(exec)
          const block = a.target === 'project' ? ensureProject() : config.global
          const del = removeExceptionEntries(block, a.category, a.id)
          if (!del.removed) return json(res, { removed: false, reason: del.reason })
          await persist(exec)
          return json(res, { removed: true, exception: del.exception, removedCount: del.count, remaining: del.remaining, status: statusView(exec) })
        }
        if (pathname === '/permgate/add-rule' && method === 'POST') {
          await init(exec)
          if (!a.tool && !a.path && !a.args) return json(res, { error: '至少提供 tool/path/args 之一' })
          const rule = normalizeRule({ id: 'r' + Math.random().toString(36).slice(2, 8), action: a.action, tool: a.tool, path: a.path, args: a.args, reason: a.reason })
          if (!rule) return json(res, { error: '非法的规则参数' })
          const block = a.target === 'project' ? ensureProject() : config.global
          if (!block.custom) block.custom = []
          block.custom.push(rule)
          await persist(exec)
          return json(res, { added: rule, status: statusView(exec) })
        }
        if (pathname === '/permgate/remove-rule' && method === 'POST') {
          await init(exec)
          const block = a.target === 'project' ? ensureProject() : config.global
          const list = block.custom || []
          const idx = list.findIndex((r) => r.id === a.id)
          if (idx === -1) return json(res, { removed: false, reason: '未找到 id=' + a.id })
          const removed = list.splice(idx, 1)[0]
          await persist(exec)
          return json(res, { removed: true, rule: removed, status: statusView(exec) })
        }
        if (pathname === '/permgate/reload' && method === 'POST') {
          // 重置 target 缓存：强制重新解析配置路径，保证竞态残留的项目路径配置可切回 home
          target = null
          await load(exec)
          return json(res, statusView(exec))
        }
        // 打开配置文件：用系统默认关联的编辑器打开（Windows: cmd start）
        if (pathname === '/permgate/open-config' && method === 'POST') {
          await init(exec)
          const t = target
          if (!t) return json(res, { error: '配置文件路径未知' })
          const sub = ctx.get('subprocess')
          if (!sub) return json(res, { error: 'subprocess 服务不可用' })
          try {
            const winPath = fs.processPath ? fs.processPath(t) : String(t).replace(/\//g, '\\')
            const exe = await sub.resolveExecutable('cmd')
            const handle = sub.spawn({
              argv: [exe, '/c', 'start', '', winPath],
              cwd: String(root || 'C:\\').replace(/\//g, '\\'),
              stdio: { stdin: 'ignore', stdout: { maxBytes: 1024 }, stderr: { maxBytes: 1024 } },
              graceMs: 5000,
            })
            await handle.done
            // 附带 status：客户端 invoke 会把响应应用为面板状态，缺了会把配置路径冲掉
            return json(res, { ok: true, path: winPath, status: statusView(exec) })
          } catch (e) {
            return json(res, { error: '打开配置文件失败: ' + ((e && e.message) || String(e)) })
          }
        }
        // 打开被对比的文件：入口已从「系统关联程序打开」改为客户端打开 DSH 右侧栏的 file tab。
        // 说明：原先的 /permgate/open-file（`cmd /c start` 系统打开 + OPEN_TEXT_EXTS 白名单）
        // 已移除 —— 文件和图片现在由客户端交给 DSH 右侧栏的 file tab 展示
        // （ctx.sidebarRight.openResource，同一地址由 DSH 按 media type 选渲染器）。
        // 那份白名单当初只是为了挡住「打开」退化成「运行」关联脚本（exe/bat/ps1 等），
        // 现在不再唤起系统程序，这条约束连同路由一起退场。
        return json(res, { error: 'not found: ' + pathname }, 404)
      } catch (e) {
        console.error('[permgate] route error:', e)
        return json(res, { error: (e && e.message) ? e.message : String(e) }, 500)
      }
    }

    onDispose(ctx.webServer.register({ kind: 'prefix', path: '/permgate', handler: routePermgate }))
    // SSE 心跳：每 30 秒向订阅者写注释帧，防止空闲连接被中间层掐断
    onDispose(ctx.timer.interval(() => {
      for (const res of sseClients) {
        try { res.write(': ka\n\n') } catch (e) { sseClients.delete(res) }
      }
    }, 30000))

    // 启动后全量对齐：重启时恢复的会话由 dsh-permission-presets 的 pinInitialPermission
    // 按预设捆绑 seed，会话沙箱旋钮可能 ≠ permgate 配置（如项目配置 full access 被
    // 写回 workspace-write）。此时恢复会话的 seed 事件可能发生在插件加载之前，
    // session/event hook 捕捉不到。这里延迟等会话恢复完成后，对所有处于
    // 「自定义审查」的会话补一次同步，使配置真正生效。
    onDispose(ctx.timer.setTimeout(() => {
      (async () => {
        try {
          const all = ctx.sessions && typeof ctx.sessions.list === 'function' ? ctx.sessions.list() : []
          if (!Array.isArray(all)) return
          for (const s of all) {
            if (!s) continue
            try {
              const ex = { agent: { session: s } }
              await init(ex)
              syncSandbox(ex)
            } catch (e) {}
          }
        } catch (e) {
          console.error('[permgate] startup sandbox sync error:', e)
        }
      })()
    }, 1200))

    // ── 工具注册 ────────────────────────────────────────────────────────────────

    function renderer() {
      return function (_a, v) { return [{ type: 'text', text: JSON.stringify(v, null, 2) }] }
    }

    function registerTool(definition) {
      onDispose(ctx.tools.register(defineTool(definition)))
    }
    // ── 工具注册 ────────────────────────────────────────────────────────────────

    function renderer() {
      return function (_a, v) { return [{ type: 'text', text: JSON.stringify(v, null, 2) }] }
    }

    function registerTool(definition) {
      onDispose(ctx.tools.register(defineTool(definition)))
    }

    registerTool({
      name: 'perm_status',
      description: '查看权限网关(permgate)当前生效的分类默认(目录/命令/读取/读取图片/编辑/撤销操作/子代理/重复操作)、例外、快捷工具、自定义规则、最近决策与配置路径。',
      parameters: {},
      output: { schema: { type: 'json' }, render: renderer() },
      async execute(_args, exec) { await init(exec); return statusView(exec) },
    })

    registerTool({
      name: 'perm_set_category',
      description: '设置一个权限分类的默认动作。分类: directory=目录访问(工作区外), command=执行命令, read=读取文件, image=读取图片, edit=编辑文件, undo=撤销操作(恢复上次编辑前的内容), subagent=启动子代理, doomloop=重复操作。动作: ask=询问, allow=允许, deny=拒绝; 项目(target=project)还支持 inherit=继承全局。',
      parameters: {
        target: { type: 'string', required: true, enum: ['global', 'project'] },
        category: { type: 'string', required: true, enum: CATEGORY_ENUM },
        mode: { type: 'string', required: true, enum: ['ask', 'allow', 'deny', 'inherit'], description: '目标动作；inherit 仅适用于项目' },
        reason: { type: 'string', description: '拒绝原因，仅 mode=deny 生效：该分类被拒时回给 AI（为什么被拒、该怎么改）' },
      },
      output: { schema: { type: 'json' }, render: renderer() },
      async execute(args, exec) {
        await init(exec)
        if (CATS.indexOf(args.category) === -1) return { error: '未知分类: ' + args.category }
        if (!setCategoryMode(args.target, args.category, args.mode, args.reason)) return { error: '非法的 target/mode 组合' }
        await persist(exec)
        return statusView(exec)
      },
    })

    registerTool({
      name: 'perm_set_fallback',
      description: '设置「未匹配任何规则」时的兜底动作（默认 ask=询问）：ask=每个未匹配的调用都弹审批；allow=直接放行；deny=直接拒绝。directory/command/read/image/edit/undo/subagent/doomloop 之外的所有工具调用都归兜底策略。项目(target=project)还支持 inherit=继承全局。',
      parameters: {
        target: { type: 'string', required: true, enum: ['global', 'project'] },
        mode: { type: 'string', required: true, enum: ALL_MODES, description: '兜底动作；inherit 仅适用于项目' },
        reason: { type: 'string', description: '拒绝原因，仅 mode=deny 生效：被兜底拒绝时回给 AI（为什么被拒、该怎么改）' },
      },
      output: { schema: { type: 'json' }, render: renderer() },
      async execute(args, exec) {
        await init(exec)
        if (!setFallbackMode(args.target, args.mode, args.reason)) return { error: '非法的 target/mode 组合' }
        await persist(exec)
        return statusView(exec)
      },
    })

    registerTool({
      name: 'perm_set_editor_kernel',
      description: '设置 str_replace_editor 的内核（默认 auto=自动判别）：auto=按当前实际注册的工具描述判别；builtin=DSH 内置（官方语义，insert_line 0 基、插入到该行之后）；shadow=dsh-better-edit 的覆盖实现（insert_line 1 基、插入到该行之前）。两者 insert 的 insert_line 语义相反，判别错误会让审批弹窗展示错误位置的改动。项目(target=project)还支持 inherit=继承全局。',
      parameters: {
        target: { type: 'string', required: true, enum: ['global', 'project'] },
        mode: { type: 'string', required: true, enum: EDITOR_KERNEL_VALUES, description: '内核判别方式；inherit 仅适用于项目' },
      },
      output: { schema: { type: 'json' }, render: renderer() },
      async execute(args, exec) {
        await init(exec)
        if (!setEditorKernel(args.target, args.mode)) return { error: '非法的 target/mode 组合' }
        await persist(exec)
        return statusView(exec)
      },
    })

    registerTool({
      name: 'perm_add_exception',
      description: '给分类添加一条例外。directory/read/image/edit/undo 分类用 path(路径 glob，支持 * 与 ** 通配，如 G:/MCP/**、**/*.env)；command 分类用 match(命令名或子串，支持 * 通配任意剩余，如 Get-Item * / git status)。例外优先于分类默认动作；action: allow=命中即放行，ask=命中即弹审批，deny=命中即拒绝。',
      parameters: {
        target: { type: 'string', required: true, enum: ['global', 'project'] },
        category: { type: 'string', required: true, enum: EXC_CATEGORY_ENUM },
        match: { type: 'string', required: true, description: '路径 glob 或命令名/子串（* 匹配任意剩余）' },
        action: { type: 'string', required: true, enum: ['ask', 'allow', 'deny'], description: '命中例外后的动作' },
        reason: { type: 'string', description: '拒绝原因，仅 deny 例外生效：拒绝时会回给 AI（为什么被拒、该怎么改）' },
        note: { type: 'string', description: '备注，仅 ask 例外生效：命中时显示在审批弹窗上，方便日后回看当初为什么特意拦它。注意这是给人看的备注、不是保密字段，请勿写入敏感信息' },
      },
      output: { schema: { type: 'json' }, render: renderer() },
      async execute(args, exec) {
        await init(exec)
        if (EXC_CATS.indexOf(args.category) === -1) return { error: '该分类不支持例外' }
        if (!args.match || !String(args.match)) return { error: 'match 不能为空' }
        const e = normalizeException({ id: 'e' + Math.random().toString(36).slice(2, 8), action: args.action, reason: args.reason, note: args.note, path: args.category === 'command' ? undefined : args.match, match: args.category === 'command' ? args.match : undefined }, args.category)
        if (!e) return { error: '非法的例外参数' }
        // 与面板路由共用同一写入点：同方向不重复、新决定插到数组头部，避免被历史条目遮蔽。
        const written = addProjectException(args.category, args.category === 'command' ? 'command' : 'path', args.match, args.action, { target: args.target, reason: args.reason, note: args.note })
        if (!written) return { error: '例外未写入：分类/参数不支持' }
        await persist(exec)
        return { added: written, status: statusView(exec) }
      },
    })

    registerTool({
      name: 'perm_remove_exception',
      description: '按 id 删除一条分类例外(id 见 perm_status 返回的 exceptions 或 perm_add_exception 返回)。',
      parameters: {
        target: { type: 'string', required: true, enum: ['global', 'project'] },
        category: { type: 'string', required: true, enum: EXC_CATEGORY_ENUM },
        id: { type: 'string', required: true },
      },
      output: { schema: { type: 'json' }, render: renderer() },
      async execute(args, exec) {
        await init(exec)
        const block = args.target === 'project' ? ensureProject() : config.global
        const del = removeExceptionEntries(block, args.category, args.id)
        if (!del.removed) return { removed: false, reason: del.reason, status: statusView(exec) }
        await persist(exec)
        return { removed: true, exception: del.exception, removedCount: del.count, remaining: del.remaining, status: statusView(exec) }
      },
    })

    registerTool({
      name: 'perm_set_quick',
      description: '设置快捷工具默认动作(如 web_search/skill/grep/glob 等)。action=inherit 表示移除该项目覆盖(继承全局)。',
      parameters: {
        target: { type: 'string', required: true, enum: ['global', 'project'] },
        tool: { type: 'string', required: true, description: '工具名，支持通配如 cordis_*' },
        action: { type: 'string', required: true, enum: ['ask', 'allow', 'deny', 'inherit'], description: '动作；inherit 移除' },
        reason: { type: 'string', description: '拒绝原因，仅 action=deny 生效：该工具被拒时回给 AI（为什么被拒、该怎么改）' },
      },
      output: { schema: { type: 'json' }, render: renderer() },
      async execute(args, exec) {
        await init(exec)
        if (!args.tool || !String(args.tool)) return { error: 'tool 不能为空' }
        if (!setQuickAction(args.target, args.tool, args.action, args.reason)) return { error: '非法动作' }
        await persist(exec)
        return statusView(exec)
      },
    })

    registerTool({
      name: 'perm_add_rule',
      description: '新增一条自定义规则(通用匹配)。匹配器至少提供一个：tool=按工具名匹配(支持 * 与 ? 通配，如 cordis_*)；path=匹配调用参数里任意路径字符串(glob)；args=匹配序列化参数里的子串(如 rm -rf)。action: allow=放行，ask=弹审批，deny=拒绝。项目规则优先于全局规则。',
      parameters: {
        target: { type: 'string', required: true, enum: ['global', 'project'], description: '规则放在全局还是当前项目' },
        action: { type: 'string', required: true, enum: ['allow', 'ask', 'deny'], description: '命中后的动作' },
        tool: { type: 'string', description: '工具名通配，如 cordis_*' },
        path: { type: 'string', description: '路径 glob，匹配参数中的路径字符串' },
        args: { type: 'string', description: '参数子串，匹配序列化后的参数' },
        reason: { type: 'string', description: '命中时展示的原因' },
      },
      output: { schema: { type: 'json' }, render: renderer() },
      async execute(args, exec) {
        await init(exec)
        if (!args.tool && !args.path && !args.args) return { error: '至少提供 tool/path/args 之一' }
        const rule = normalizeRule({ id: 'r' + Math.random().toString(36).slice(2, 8), action: args.action, tool: args.tool, path: args.path, args: args.args, reason: args.reason })
        if (!rule) return { error: '非法的规则参数' }
        const block = args.target === 'project' ? ensureProject() : config.global
        if (!block.custom) block.custom = []
        block.custom.push(rule)
        await persist(exec)
        return { added: rule, status: statusView(exec) }
      },
    })

    registerTool({
      name: 'perm_remove_rule',
      description: '按 id 删除一条自定义规则(id 见 perm_status 或 perm_add_rule 的返回)。',
      parameters: {
        target: { type: 'string', required: true, enum: ['global', 'project'] },
        id: { type: 'string', required: true, description: '要删除的规则 id' },
      },
      output: { schema: { type: 'json' }, render: renderer() },
      async execute(args, exec) {
        await init(exec)
        const block = args.target === 'project' ? ensureProject() : config.global
        const list = block.custom || []
        const idx = list.findIndex((r) => r.id === args.id)
        if (idx === -1) return { removed: false, reason: '未找到 id=' + args.id, status: statusView(exec) }
        const removed = list.splice(idx, 1)[0]
        await persist(exec)
        return { removed: true, rule: removed, status: statusView(exec) }
      },
    })

    registerTool({
      name: 'perm_reload',
      description: '从磁盘重新加载权限配置文件(手动编辑后调用)。',
      parameters: {},
      output: { schema: { type: 'json' }, render: renderer() },
      async execute(_args, exec) { await load(exec); return statusView(exec) },
    })

    // 新会话默认权限修正已交由 dsh-permission-presets 0.1.2 原生处理：其在
    // session/created 钩子里调用 pinInitialPermission，为新会话 seed 用户默认
    // 预设、对 seeded/恢复会话保留其有效值。旧 0.1.1 时代这里的 re-seed 补偿
    // （检测「全新无活动 + 组合派生预设 ≠ 用户默认」后重定）已移除。
    ctx.on('session/created', (session) => {
      // 沙箱对齐：session/created 是同步 emit，本监听可能在 pinInitialPermission
      // 之前/之后执行、且恢复会话的 seed 事件在插件加载前已发生。延迟一 tick 后
      // 再按 permgate 配置对齐该会话沙箱（对 custom-review 会话幂等）。
      ctx.timer.setTimeout(() => {
        (async () => {
          try {
            const ex = { agent: { session } }
            await init(ex)
            syncSandbox(ex)
          } catch (e) {}
        })()
      }, 0)
    })

    // ── 预执行审查 ──────────────────────────────────────────────────────────────

    // 会话权限/沙箱/审批变化（DSH 侧写入，不经 permgate）→ 推送浏览器刷新，
    // 让快捷栏/设置页在选择器切换权限后立即联动。
    ctx.on('session/event', async (session, event) => {
      try {
        if (!event) return
        if (event.type === 'permission/preset' || event.type === 'sandbox/mode' || event.type === 'approval/policy') {
          if (agentRef === null && session) agentRef = { session }
          broadcast({ type: 'status' })
        }
        // 自动同步：用户在设置页/快捷栏切换权限预设（仅「自定义审查」）后，
        // 立即把 permgate 配置解析出的沙箱模式推给该会话，无需再手动去拨沙箱开关。
        // sandbox/mode 是我们 setSandboxMode 自己的回声，跳过以杜绝同步环。
        if (event.type === 'permission/preset' && session) {
          const exec = { agent: { session } }
          await init(exec)
          syncSandbox(exec)
        }
      } catch (e) {}
    })

    ctx.on('tools/pre-execute', async (exec, next) => {
      try {
        await init(exec)
        // 注意：聊天/工具调用绝不改写会话 sandbox knob（否则权限选择器显示会漂移）；
        // 底层沙箱只在设置页显式切换（/permgate/set-sandbox）或用户切换
        // 「自定义审查」预设时（session/event → permission/preset 自动同步）写入。
        const d = decide(exec)
        recordDecision(d, exec)
        if (typeof exec.name !== 'string' || exec.name.indexOf('perm_') !== 0) {
          recent.push(callKey(exec.name, exec.arguments))
          if (recent.length > 12) recent.splice(0, recent.length - 12)
        }
        console.log('[permgate]', d.action, exec.name, L(d.reason, uiLang) || '')
        if (d.action === 'ask') {
          const out = await askUser(exec, d)
          if (out.kind !== 'allow') return { kind: 'deny', reason: out.reason || (uiLang === 'en' ? 'User denied' : '用户拒绝') }
        } else if (d.action === 'deny') {
          return { kind: 'deny', reason: L(d.reason, uiLang) }
        }
        // 放行（或询问允许）后：写类工具 + 工作区外 + 沙箱受限 → 原生升级审批 → 临时放开
        flushStaleUpgrades()
        if (needsUpgrade(exec)) {
          const ok = await requireSandboxUpgrade(exec)
          if (!ok) return { kind: 'deny', reason: uiLang === 'en' ? 'Sandbox upgrade denied (write outside workspace)' : '沙箱升级被拒绝（工作区外写入）' }
        }
        return next()
      } catch (e) {
        console.error('[permgate] pre-execute error:', e)
        return next()
      }
    })

    // 一次性沙箱升级：该调用执行完成后写回原沙箱
    ctx.on('tools/post-execute', async (exec, result, next) => {
      try {
        const rec = upgradedCalls.get(exec.token)
        if (rec) {
          upgradedCalls.delete(exec.token)
          try { if (rec.session) setSandboxMode(rec.session, rec.prev || 'workspace-write') } catch (e) {}
        }
      } catch (e) {}
      return next()
    })
  },
}
