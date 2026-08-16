// dsh-permgate — 权限网关（宿主半）
// 注册 perm_* 工具、挂钩 tools/pre-execute 审查、经 webServer 提供 /permgate/* JSON 路由供浏览器 UI 调用。
// 配置持久化于 $DSH_HOME/dsh-permgate/config.json（用户级、不进任何 git 仓库）。
import { defineTool } from '@deepseek-ai/dsh-tools'
import { effectivePermissionPreset } from '@deepseek-ai/dsh-permission-presets'
import { effectiveSandboxMode, setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'

const CATS = ['directory', 'command', 'read', 'edit', 'subagent', 'doomloop']
const EXC_CATS = ['directory', 'command', 'read', 'edit']
const MODES = ['ask', 'allow', 'deny']
const ALL_MODES = ['ask', 'allow', 'deny', 'inherit']
const MAX_DECISIONS = 30
const QUICK_PRESET = ['web_search', 'skill', 'grep', 'glob', 'web_fetch']
const QUICK_DEFAULTS = { web_search: 'ask', skill: 'allow', grep: 'allow', glob: 'allow', web_fetch: 'ask' }
const ASK_TIMEOUT_MS = 300000 // 保留常量（历史/文档用途）；审批已改为永不超时
const DECIDE_CHOICES = ['allow', 'deny', 'allow-global', 'allow-project', 'deny-global', 'deny-project']
const REPEAT_STREAK = 2
const PS_KEYWORDS = { foreach: 1, if: 1, else: 1, elseif: 1, for: 1, while: 1, do: 1, until: 1, switch: 1, return: 1, function: 1, filter: 1, param: 1, begin: 1, process: 1, end: 1, try: 1, catch: 1, finally: 1, throw: 1, break: 1, continue: 1, trap: 1, in: 1, not: 1, and: 1, or: 1, class: 1, enum: 1, using: 1, exit: 1, dynamicparam: 1, data: 1 }
// 子命令路由器命令族：候选细化到「git status *」这一粒度，而不是一放全放「git *」
const ROUTER_CMDS = { git: 1, npm: 1, pnpm: 1, yarn: 1, docker: 1, kubectl: 1, dotnet: 1, cargo: 1, go: 1, gh: 1, pip: 1, uv: 1, conda: 1 }

const FILE_READ_TOOLS = { read: 1, read_image: 1 }
const FILE_WRITE_TOOLS = { write: 1, edit: 1 }
const COMMAND_TOOLS = { pwsh: 1, bash: 1 }
const SUBAGENT_TOOLS = { subagent: 1, subagent_fork: 1, workflow: 1, ralph: 1 }

// 双语文案：bi(zh, en) 生成 {zh,en}；L(obj, lang) 按语言取值（缺省回退中文）
const bi = (zh, en) => ({ zh, en })
const L = (o, lang) => (o && (o[lang] || o.zh)) || ''
// 语言参数归一化：只有 en 用英文，其余（缺失/空/非法）一律中文
const normLang = (v) => (v === 'en' ? 'en' : 'zh')

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

    function safeJson(v) {
      try { return JSON.stringify(v) } catch (e) { return '' }
    }

    function freshConfig() {
      const g = { quickTools: {}, custom: [], sandboxMode: 'workspace-write' }
      for (const c of CATS) g[c] = freshCategory(c, false)
      for (const k of Object.keys(QUICK_DEFAULTS)) g.quickTools[k] = QUICK_DEFAULTS[k]
      return { global: g, projects: {} }
    }

    function freshProject() {
      const pb = { quickTools: {}, custom: [], sandboxMode: 'inherit' }
      for (const c of CATS) pb[c] = freshCategory(c, true)
      return pb
    }

    function freshCategory(key, inheritDefault) {
      const cat = { mode: inheritDefault ? 'inherit' : (key === 'directory' || key === 'command' || key === 'edit' || key === 'doomloop' ? 'ask' : 'allow') }
      if (EXC_CATS.indexOf(key) !== -1) cat.exceptions = []
      return cat
    }

    function normalizeException(r, key) {
      if (!r || typeof r !== 'object') return null
      if (MODES.indexOf(r.action) === -1) return null
      const value = key === 'command' ? r.match : r.path
      if (typeof value !== 'string' || !value) return null
      const e = { id: r.id || 'e' + Math.random().toString(36).slice(2, 8), action: r.action }
      if (key === 'command') e.match = value
      else e.path = value
      return e
    }

    function normalizeCategory(raw, key, inheritDefault) {
      const def = freshCategory(key, inheritDefault)
      const c = raw && typeof raw === 'object' ? raw : {}
      const cat = { mode: (inheritDefault ? ALL_MODES : MODES).indexOf(c.mode) !== -1 ? c.mode : def.mode }
      if (EXC_CATS.indexOf(key) !== -1) {
        cat.exceptions = Array.isArray(c.exceptions) ? c.exceptions.map((r) => normalizeException(r, key)).filter(Boolean) : []
      }
      return cat
    }

    function normalizeQuick(q) {
      const out = {}
      if (!q || typeof q !== 'object') return out
      for (const k of Object.keys(q)) {
        if (ALL_MODES.indexOf(q[k]) !== -1) out[k] = q[k]
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
      const global = { quickTools: normalizeQuick(g.quickTools), custom: Array.isArray(g.custom) ? g.custom.map(normalizeRule).filter(Boolean) : [], sandboxMode: g.sandboxMode === 'danger-full-access' ? 'danger-full-access' : 'workspace-write' }
      for (const c of CATS) global[c] = normalizeCategory(g[c], c, false)
      const projects = {}
      const rawProjects = parsed.projects && typeof parsed.projects === 'object' ? parsed.projects : {}
      for (const key of Object.keys(rawProjects)) {
        const p = rawProjects[key] && typeof rawProjects[key] === 'object' ? rawProjects[key] : {}
        const pb = { quickTools: normalizeQuick(p.quickTools), custom: Array.isArray(p.custom) ? p.custom.map(normalizeRule).filter(Boolean) : [], sandboxMode: ['workspace-write', 'danger-full-access', 'inherit'].indexOf(p.sandboxMode) !== -1 ? p.sandboxMode : 'inherit' }
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
      for (const c of CATS) cfg.global[c].mode = map[oldMode] || 'allow'
      cfg.global.doomloop.mode = oldMode === 'off' ? 'allow' : 'ask'
      if (oldMode === 'locked') {
        for (const k of Object.keys(cfg.global.quickTools)) cfg.global.quickTools[k] = 'deny'
      }
      cfg.global.custom = Array.isArray(g.rules) ? g.rules.map(normalizeRule).filter(Boolean) : []
      const rawProjects = parsed.projects && typeof parsed.projects === 'object' ? parsed.projects : {}
      for (const key of Object.keys(rawProjects)) {
        const p = rawProjects[key] && typeof rawProjects[key] === 'object' ? rawProjects[key] : {}
        const pm = ['off', 'permissive', 'locked'].indexOf(p.mode) !== -1 ? p.mode : 'off'
        const pb = { quickTools: {}, custom: Array.isArray(p.rules) ? p.rules.map(normalizeRule).filter(Boolean) : [] }
        for (const c of CATS) {
          pb[c] = freshCategory(c, true)
          pb[c].mode = pm === 'off' ? 'allow' : (map[pm] || 'allow')
        }
        pb.doomloop.mode = pm === 'off' ? 'allow' : 'ask'
        if (pm === 'locked') {
          for (const k of QUICK_PRESET) pb.quickTools[k] = 'deny'
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
    function sessionPresetName(exec) {
      try {
        const session = currentSession(exec)
        if (!session) return null
        const explicit = effectivePermissionPreset(session.events)
        if (explicit) return explicit
        const pp = ctx.permissionPresets
        if (pp && typeof pp.current === 'function') {
          const c = pp.current(session.events)
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
      return config.global.sandboxMode || 'workspace-write'
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
        const cur = effectiveSandboxMode(session.events)
        if (cur !== mode) setSandboxMode(session, mode)
      } catch (e) {
        console.error('[permgate] syncSandbox error:', e)
      }
    }

    // 写类工具 + 目标在工作区外 + 会话沙箱受限（workspace-write）→ 需要沙箱升级
    function needsUpgrade(exec) {
      try {
        if (!FILE_WRITE_TOOLS[exec.name]) return false
        const fp = pathArg(exec.arguments)
        if (!fp || !isOutside(fp, root)) return false
        const agent = (exec && exec.agent) || agentRef
        const session = agent && agent.session
        if (!session) return false
        return effectiveSandboxMode(session.events) === 'workspace-write'
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
        upgradedCalls.set(exec.token, { session, prev: effectiveSandboxMode(session.events) || 'workspace-write' })
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
      for (const [tok, rec] of upgradedCalls) {
        try { if (rec && rec.session) setSandboxMode(rec.session, rec.prev || 'workspace-write') } catch (e) {}
      }
      upgradedCalls.clear()
    }

    async function resolveDshHome() {
      if (dshHomeCache !== null) return dshHomeCache
      dshHomeCache = ''
      try {
        const sub = ctx.get('subprocess')
        if (!sub) return dshHomeCache
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
      const abs = home ? home + '/dsh-permgate/config.json' : (base ? base + '/.dsh/.permgate.json' : '.dsh/.permgate.json')
      target = await fs.resolve(abs)
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
        const dir = root ? root + '/.dsh' : '.dsh'
        const d = await fs.resolve(dir)
        const info = await fs.stat(d)
        if (info) return true
        const sub = ctx.get('subprocess')
        if (!sub) return false
        const exe = await sub.resolveExecutable('cmd')
        const winPath = String(dir).replace(/\//g, '\\')
        const handle = sub.spawn({
          argv: [exe, '/c', 'mkdir', winPath],
          cwd: String(root || '.').replace(/\//g, '\\'),
          stdio: { stdin: 'ignore', stdout: { maxBytes: 8192 }, stderr: { maxBytes: 8192 } },
          graceMs: 5000,
        })
        await handle.done
        return true
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
      if (!config.projects[root]) config.projects[root] = freshProject()
      return config.projects[root]
    }

    function setCategoryMode(targetKey, cat, mode) {
      const allowed = targetKey === 'global' ? MODES : ALL_MODES
      if (allowed.indexOf(mode) === -1) return false
      const block = targetKey === 'global' ? config.global : ensureProject()
      if (!block[cat]) block[cat] = freshCategory(cat, targetKey !== 'global')
      block[cat].mode = mode
      return true
    }

    function matchException(r, value, kind) {
      if (kind === 'path') return matchGlob(r.path, value)
      return matchCommand(r.match, value)
    }

    function resolveCategory(catKey, value, kind) {
      const proj = projectBlock()
      const pCat = proj ? proj[catKey] : undefined
      const gCat = config.global[catKey] || freshCategory(catKey, false)
      if (value !== null && value !== undefined && EXC_CATS.indexOf(catKey) !== -1) {
        const pl = pCat && Array.isArray(pCat.exceptions) ? pCat.exceptions : []
        for (const r of pl) if (matchException(r, value, kind)) return { action: r.action, ruleId: r.id }
        const gl = Array.isArray(gCat.exceptions) ? gCat.exceptions : []
        for (const r of gl) if (matchException(r, value, kind)) return { action: r.action, ruleId: r.id }
      }
      const mode = (pCat && pCat.mode && pCat.mode !== 'inherit') ? pCat.mode : (gCat.mode || 'allow')
      return { action: mode, ruleId: null }
    }

    function pathArg(args) {
      try { return args && typeof args === 'object' && typeof args.file_path === 'string' ? args.file_path : null } catch (e) { return null }
    }

    // open-file 允许打开的扩展名白名单（文本/文档类）。`cmd /c start` 对 Windows 上"运行"关联的
    // 可执行/脚本类（exe/bat/cmd/ps1/vbs/js/py/msi/jar/lnk/svg 等）执行的是运行而非编辑，
    // 白名单之外的扩展名一律拒绝，防止点击「打开文件」执行 agent 可控路径的脚本。
    const OPEN_TEXT_EXTS = new Set([
      'txt', 'md', 'markdown', 'json', 'jsonc', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'log',
      'csv', 'tsv', 'xml', 'html', 'htm', 'css', 'ts', 'tsx', 'jsx', 'c', 'h', 'cpp', 'hpp', 'cc',
      'cxx', 'cs', 'java', 'go', 'rs', 'sql', 'gradle', 'properties',
    ])

    // ── 文件对比数据（按需路由 /permgate/file-diff 生成）───────────────
    // 弹窗「详情」与右侧对比抽屉共用：edit/write 生成行级 Myers diff 操作流，
    // 客户端渲染成带行号/底色的 unified diff（dsh-file-review 风格）；read 返回
    // 文件内容预览。软失败：内容过大/读取失败返回 {ok:false}；变更行数或中间区
    // 过大时走 fallback 旧式 ± 视图（前 200 变更行 + 截断计数，不阻塞审批）。
    // DIFF_MAX_CHARS：对比双方文本总长上限（edit 为磁盘全文+新文本；write 为磁盘+内容）。
    // 1MB 覆盖常见大文件（如打包产物）；超限返回「文件过大，无法生成对比」。
    const DIFF_MAX_CHARS = 1048576
    const DIFF_MAX_LINES = 200
    // Myers 中间区行数预算：超限走旧式 fallback（避免 trace 内存暴涨）。2048 行最坏时
    // trace 累计约 33MB 瞬时分配 + 数百万次迭代（服务端主线程）；512 行时约 2MB/数十万次，
    // 足够覆盖常规编辑场景。
    const DIFF_BUDGET_LINES = 512
    function splitDiffLines(s) {
      return String(s == null ? '' : s).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
    }
    function computeLineDiff(oldText, newText) {
      const oldLines = splitDiffLines(oldText)
      const newLines = splitDiffLines(newText)
      let prefix = 0
      const maxP = Math.min(oldLines.length, newLines.length)
      while (prefix < maxP && oldLines[prefix] === newLines[prefix]) prefix++
      let suffix = 0
      while (suffix < oldLines.length - prefix && suffix < newLines.length - prefix && oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]) suffix++
      const removed = oldLines.slice(prefix, oldLines.length - suffix)
      const added = newLines.slice(prefix, newLines.length - suffix)
      const lines = []
      let shownR = 0
      let shownA = 0
      const n = Math.max(removed.length, added.length)
      for (let i = 0; i < n; i++) {
        if (lines.length >= DIFF_MAX_LINES) break
        // 行号：差异区从 prefix+1 行开始；删除行标旧文件行号，新增行标新文件行号
        const no = String(prefix + i + 1).padStart(4, ' ')
        if (i < removed.length) { lines.push('- ' + no + ' ' + removed[i]); shownR++ }
        if (i < added.length) { lines.push('+ ' + no + ' ' + added[i]); shownA++ }
      }
      return { added: added.length, removed: removed.length, lines, truncated: (removed.length - shownR) + (added.length - shownA) }
    }
    // Myers 行级 diff：返回相对输入数组的 op 流（t: c/a/d，o/n: 1 基行号，s: 行文本）
    function myersOps(a, b) {
      const n = a.length
      const m = b.length
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
      let p = 0
      const maxP = Math.min(oldLines.length, newLines.length)
      while (p < maxP && oldLines[p] === newLines[p]) p++
      let s = 0
      while (s < oldLines.length - p && s < newLines.length - p && oldLines[oldLines.length - 1 - s] === newLines[newLines.length - 1 - s]) s++
      const midA = oldLines.slice(p, oldLines.length - s)
      const midB = newLines.slice(p, newLines.length - s)
      // 廉价预过滤：|midA.length - midB.length| > DIFF_MAX_LINES 时 added+removed 必超 200
      // （added - removed === midB.length - midA.length），Myers 结果必被丢弃，直接走 fallback，
      // 避免无谓的 O((N+M)*D) 计算与 trace 内存。
      if (Math.abs(midA.length - midB.length) > DIFF_MAX_LINES) {
        const d = computeLineDiff(oldText, newText)
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
      const d = computeLineDiff(oldText, newText)
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
    // 按审批 entry 生成对比数据（/permgate/file-diff 路由用；失败返回 {ok:false,error}，不支持返回 null）
    async function buildFileDiffData(entry, fsService) {
      const name = entry.tool
      const args = parseEntryArgs(entry)
      const fp = pathArg(args)
      if (FILE_READ_TOOLS[name]) {
        if (!fp) return { ok: false, error: bi('缺少文件路径', 'Missing file path') }
        try {
          const target = await fsService.resolve(fp)
          const info = await fsService.stat(target)
          if (info === undefined) return { ok: false, error: bi('文件不存在', 'File not found') }
          if (info.type !== 'file') return { ok: false, error: bi('不是普通文件', 'Not a regular file') }
          // 窗口化读取：只取 offset/limit 附近（前后各 W 行）的内容，流式消费到窗口末尾即停，
          // 不整读大文件；末尾省略行数未知，由客户端显示通用提示。
          // 资源上限：offset/limit 来自 agent 工具参数（不可信），且文件中可能存在无换行的
          // 极长行，故对窗口行数（MAX_LIMIT）、返回文本总字节（MAX_BYTES）与单行长度
          // （MAX_LINE）设硬上限，超限即截断并标记省略，避免服务端主线程无界内存分配。
          const W = 200
          const MAX_LIMIT = 4096
          const MAX_BYTES = 262144
          const MAX_LINE = 65536
          const offset = Number.isFinite(args.offset) && args.offset > 0 ? Math.floor(args.offset) : 1
          const limit = Math.min(Number.isFinite(args.limit) && args.limit > 0 ? Math.floor(args.limit) : 200, MAX_LIMIT)
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
          const emsg = (e && e.message ? e.message : String(e))
          return { ok: false, error: { zh: '读取失败: ' + emsg, en: 'Read failed: ' + emsg } }
        }
      }
      if (FILE_WRITE_TOOLS[name]) {
        if (!fp) return { ok: false, error: bi('缺少文件路径', 'Missing file path') }
        if (name === 'edit') {
          const oldText = typeof args.old_string === 'string' ? args.old_string : ''
          const newText = typeof args.new_string === 'string' ? args.new_string : ''
          if (oldText.length + newText.length > DIFF_MAX_CHARS) return { ok: false, error: bi('内容过大，无法生成对比', 'Content too large to compare') }
          // 关键：edit 是补丁式，仅对比 old_string/new_string 会丢失文件上下文（抽屉只会显示
          // 补丁那几行）。改为读取磁盘当前内容、应用补丁后，取改动前后各 W 行的窗口做 diff——
          // 行号从真实位置起算，payload 恒定小，大文件无需整文件对比（write 才是整文件语义）。
          try {
            const target = await fsService.resolve(fp)
            const info = await fsService.stat(target)
            if (info === undefined) return { ok: false, error: bi('文件不存在', 'File not found') }
            if (info.type !== 'file') return { ok: false, error: bi('不是普通文件', 'Not a regular file') }
            if (info.size !== undefined && info.size + newText.length > DIFF_MAX_CHARS) return { ok: false, error: bi('文件过大，无法生成对比', 'File too large to compare') }
            const fileText = await fsService.readText(target)
            if (fileText.length + newText.length > DIFF_MAX_CHARS) return { ok: false, error: bi('文件过大，无法生成对比', 'File too large to compare') }
            const idx = oldText ? fileText.indexOf(oldText) : -1
            if (idx === -1) {
              // 磁盘内容已与提案脱节（旧文本未找到）：退回补丁级对比，至少展示改动意图
              return diffPayloadOrFallback(fp, oldText, newText, 'modified')
            }
            const applied = fileText.slice(0, idx) + newText + fileText.slice(idx + oldText.length)
            const W = 200
            const oldLines = splitDiffLines(fileText)
            const newLines = splitDiffLines(applied)
            const lineStart = fileText.slice(0, idx).split('\n').length
            const oldCnt = splitDiffLines(oldText).length
            const newCnt = splitDiffLines(newText).length
            const winStart = Math.max(1, lineStart - W)
            const winOldEnd = Math.min(oldLines.length, lineStart + oldCnt - 1 + W)
            const winNewEnd = Math.min(newLines.length, lineStart + newCnt - 1 + W)
            const winOldText = oldLines.slice(winStart - 1, winOldEnd).join('\n')
            const winNewText = newLines.slice(winStart - 1, winNewEnd).join('\n')
            return diffPayloadOrFallback(fp, winOldText, winNewText, 'modified', winStart)
          } catch (e) {
            const emsg = (e && e.message ? e.message : String(e))
            return { ok: false, error: { zh: '读取失败: ' + emsg, en: 'Read failed: ' + emsg } }
          }
        }
        const content = typeof args.content === 'string' ? args.content : ''
        if (!content || content.length > DIFF_MAX_CHARS) return { ok: false, error: bi('内容缺失或过大', 'Content missing or too large') }
        try {
          const target = await fsService.resolve(fp)
          const info = await fsService.stat(target)
          if (info === undefined) return newFilePayload(fp, content)
          if (info.type !== 'file') return { ok: false, error: bi('不是普通文件', 'Not a regular file') }
          if (info.size !== undefined && info.size + content.length > DIFF_MAX_CHARS) return { ok: false, error: bi('文件过大，无法生成对比', 'File too large to compare') }
          const oldText = await fsService.readText(target)
          if (oldText.length + content.length > DIFF_MAX_CHARS) return { ok: false, error: bi('文件过大，无法生成对比', 'File too large to compare') }
          return diffPayloadOrFallback(fp, oldText, content, 'modified')
        } catch (e) {
          // 注意：不能与字符串直接拼接（bi() 返回 {zh,en} 对象，+ 会得到 "[object Object]"）；
          // 返回双语对象，由路由侧 L(r.error, lang) 按语言取值。
          const emsg = (e && e.message ? e.message : String(e))
          return { ok: false, error: { zh: '读取失败: ' + emsg, en: 'Read failed: ' + emsg } }
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
      return abs.toLowerCase().indexOf(r.toLowerCase()) !== 0
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
      for (const k of Object.keys(pMap)) {
        if (pMap[k] !== 'inherit' && matchGlob(k, name)) return { action: pMap[k] }
      }
      const gMap = config.global.quickTools || {}
      for (const k of Object.keys(gMap)) {
        if (matchGlob(k, name)) return { action: gMap[k] }
      }
      return null
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
        if (d.cat === 'edit') return bi('写入/修改文件 ' + v, 'Write/modify file ' + v)
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
        const fp = typeof args.file_path === 'string' ? args.file_path : null
        if (FILE_READ_TOOLS[name]) {
          const target = fp || args.path || ''
          // 图片无法按文本预览，路径不做可点击（其余 read 可点击打开内容预览）
          const clickable = name === 'read_image' ? undefined : { path: fp }
          push(name === 'read_image' ? t('读取图片', 'Read image') : t('读取', 'Read'), target ? baseName(target) : '', fp ? clickable : undefined)
          if (fp) push(t('路径', 'Path'), fp, clickable)
          if (args.offset !== undefined) push(t('偏移', 'Offset'), args.offset)
          if (args.limit !== undefined) push(t('行数', 'Lines'), args.limit)
        } else if (FILE_WRITE_TOOLS[name]) {
          push(name === 'edit' ? t('修改', 'Edit') : t('写入', 'Write'), fp ? baseName(fp) : '', fp ? { path: fp } : undefined)
          if (fp) push(t('路径', 'Path'), fp, { path: fp })
          const content = typeof args.content === 'string' ? args.content : (typeof args.new_string === 'string' ? args.new_string : '')
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

    function decide(exec) {
      const name = exec.name
      const args = exec.arguments
      if (typeof name === 'string' && name.indexOf('perm_') === 0) {
        return { action: 'allow', reason: bi('permgate 自身管理工具，始终放行', 'permgate management tool, always allowed'), cat: null, value: null, kind: null }
      }
      if (sessionPresetName(exec) !== 'custom-review') {
        return { action: 'allow', reason: bi('会话未选择「自定义审查」，由 DSH 权限预设处理', 'Session has not selected "Custom Review"; handled by DSH permission presets'), cat: null, value: null, kind: null }
      }
      if (repeatStreak(name, args) >= REPEAT_STREAK) {
        const d = resolveCategory('doomloop', null, null)
        if (d.action !== 'allow') {
          return { action: d.action, reason: bi('重复操作(Doom Loop)：' + name + ' 已连续重复 ' + (REPEAT_STREAK + 1) + ' 次相同调用', 'Doom Loop: ' + name + ' repeated ' + (REPEAT_STREAK + 1) + ' identical calls'), ruleId: d.ruleId, cat: 'doomloop', value: null, kind: null }
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
      if (FILE_READ_TOOLS[name]) {
        const fp = pathArg(args)
        if (fp && isOutside(fp, root)) {
          const d = resolveCategory('directory', fp, 'path')
          const exZh = d.ruleId ? '（例外 ' + d.ruleId + '）' : ''
          const exEn = d.ruleId ? ' (exception ' + d.ruleId + ')' : ''
          return { action: d.action, reason: bi('目录权限：访问工作区外 ' + fp + exZh, 'Directory permission: access outside workspace ' + fp + exEn), ruleId: d.ruleId, cat: 'directory', value: fp, kind: 'path' }
        }
        const d = resolveCategory('read', fp, 'path')
        const exZh = d.ruleId ? '（例外 ' + d.ruleId + '）' : ''
        const exEn = d.ruleId ? ' (exception ' + d.ruleId + ')' : ''
        return { action: d.action, reason: bi('读取权限' + (fp ? '：' + fp : '') + exZh, 'Read permission' + (fp ? ': ' + fp : '') + exEn), ruleId: d.ruleId, cat: 'read', value: fp, kind: 'path' }
      }
      if (FILE_WRITE_TOOLS[name]) {
        const fp = pathArg(args)
        if (fp && isOutside(fp, root)) {
          const d = resolveCategory('directory', fp, 'path')
          const exZh = d.ruleId ? '（例外 ' + d.ruleId + '）' : ''
          const exEn = d.ruleId ? ' (exception ' + d.ruleId + ')' : ''
          return { action: d.action, reason: bi('目录权限：访问工作区外 ' + fp + exZh, 'Directory permission: access outside workspace ' + fp + exEn), ruleId: d.ruleId, cat: 'directory', value: fp, kind: 'path' }
        }
        const d = resolveCategory('edit', fp, 'path')
        const exZh = d.ruleId ? '（例外 ' + d.ruleId + '）' : ''
        const exEn = d.ruleId ? ' (exception ' + d.ruleId + ')' : ''
        return { action: d.action, reason: bi('编辑权限' + (fp ? '：' + fp : '') + exZh, 'Edit permission' + (fp ? ': ' + fp : '') + exEn), ruleId: d.ruleId, cat: 'edit', value: fp, kind: 'path' }
      }
      if (COMMAND_TOOLS[name]) {
        const cmd = commandArg(args)
        // 命令的所有可识别命令 token 均已命中 allow 例外 → 视为已覆盖，直接放行（不再弹窗）
        if (commandFullyCovered(cmd)) {
          return { action: 'allow', reason: bi('命令组成均已命中例外，放行', 'All command tokens covered by exceptions, allowed'), cat: null, value: null, kind: null }
        }
        const d = resolveCategory('command', cmd, 'command')
        const exZh = d.ruleId ? '（例外 ' + d.ruleId + '）' : ''
        const exEn = d.ruleId ? ' (exception ' + d.ruleId + ')' : ''
        return { action: d.action, reason: bi('执行命令' + exZh, 'Run command' + exEn), ruleId: d.ruleId, cat: 'command', value: cmd, kind: 'command' }
      }
      if (SUBAGENT_TOOLS[name]) {
        const d = resolveCategory('subagent', null, null)
        return { action: d.action, reason: bi('启动子代理' + (d.ruleId ? '（例外）' : ''), 'Spawn subagent' + (d.ruleId ? ' (exception)' : '')), ruleId: d.ruleId, cat: 'subagent', value: null, kind: null }
      }
      const q = quickAction(name)
      if (q) return { action: q.action, reason: bi('快捷设置：' + name + ' → ' + q.action, 'Quick setting: ' + name + ' → ' + q.action), ruleId: null, cat: 'quick', value: name, kind: 'tool' }
      return { action: 'allow', reason: bi('未匹配任何规则，放行', 'No rule matched, allowed'), cat: null, value: null, kind: null }
    }

    function recordDecision(d, exec) {
      decisions.push({ ts: new Date().toISOString(), tool: exec.name, action: d.action, ruleId: d.ruleId || null, reason: d.reason || '' })
      if (decisions.length > MAX_DECISIONS) decisions.splice(0, decisions.length - MAX_DECISIONS)
    }

    function dirGlob(p) {
      const s = String(p).replace(/\\/g, '/').replace(/\/+$/, '')
      const idx = s.lastIndexOf('/')
      let dir = idx >= 0 ? s.slice(0, idx) : s
      if (/^[a-zA-Z]:$/.test(dir)) dir += '/'
      if (!dir) dir = '/'
      return dir + '/*'
    }

    function alreadyInProject(value, kind, catKey) {
      const proj = projectBlock()
      if (!proj) return false
      if (kind === 'command') {
        const cat = proj.command
        return !!(cat && Array.isArray(cat.exceptions) && cat.exceptions.some((r) => r.match === value))
      }
      if (kind === 'path' && catKey && EXC_CATS.indexOf(catKey) !== -1) {
        const cat = proj[catKey]
        return !!(cat && Array.isArray(cat.exceptions) && cat.exceptions.some((r) => r.path === value))
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
        if (!/^[A-Za-z_]/.test(t)) return ''
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

    // 命令的所有可识别命令 token（如 Get-ChildItem / git status）是否均已命中 allow 例外
    function commandFullyCovered(cmd) {
      try {
        const parts = String(cmd || '').split(/[|;]/)
        const results = []
        for (const seg of parts) {
          const toks = commandTokens(seg)
          if (!toks.length) continue
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

    function buildCandidates(entry) {
      const out = []
      const push = (label, value, kind) => out.push({ id: 'c' + Math.random().toString(36).slice(2, 8), label, value, kind })
      if (entry.kind === 'command' && entry.value) {
        const parts = String(entry.value).split(/[|;]/)
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
        let val = entry.value
        if (entry.cat === 'directory') val = dirGlob(entry.value)
        if (!alreadyInProject(val, 'path', entry.cat)) push(val, val, 'path')
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
        const argsPreview = argsJson && argsJson.length > 160 ? argsJson.slice(0, 160) + '…' : (argsJson || '')
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
          // 编辑/写入且有文件路径 → 弹窗「详情」默认展开、按需取对比数据
          hasDiff: !!FILE_WRITE_TOOLS[exec.name] && !!pathArg(exec.arguments),
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

    function addProjectRule(entry, kind, value, decision) {
      try {
        const block = ensureProject()
        if (kind === 'path' && entry.cat && EXC_CATS.indexOf(entry.cat) !== -1) {
          const cat = block[entry.cat] || freshCategory(entry.cat, true)
          if (!cat.exceptions) cat.exceptions = []
          const idx = cat.exceptions.findIndex((r) => r.path === value)
          if (idx !== -1) { cat.exceptions[idx].action = decision; block[entry.cat] = cat; return }
          cat.exceptions.unshift({ id: 'e' + Math.random().toString(36).slice(2, 8), action: decision, path: value })
          block[entry.cat] = cat
          return
        }
        if (kind === 'command') {
          const cat = block.command || freshCategory('command', true)
          if (!cat.exceptions) cat.exceptions = []
          const idx = cat.exceptions.findIndex((r) => r.match === value)
          if (idx !== -1) { cat.exceptions[idx].action = decision; block.command = cat; return }
          cat.exceptions.unshift({ id: 'e' + Math.random().toString(36).slice(2, 8), action: decision, match: value })
          block.command = cat
          return
        }
        if (!block.custom) block.custom = []
        const idx = block.custom.findIndex((r) => r.tool === value)
        if (idx !== -1) { block.custom[idx].action = decision; return }
        block.custom.unshift({ id: 'r' + Math.random().toString(36).slice(2, 8), action: decision, tool: value })
      } catch (e) {
        console.error('[permgate] addProjectRule error:', e)
      }
    }

    function addRememberedRule(entry, action, target) {
      try {
        const block = target === 'project' ? ensureProject() : config.global
        if (entry.cat === 'quick') {
          if (!block.quickTools) block.quickTools = {}
          block.quickTools[entry.tool] = action
          return
        }
        if (entry.kind === 'path' && entry.cat && EXC_CATS.indexOf(entry.cat) !== -1 && entry.value) {
          const cat = block[entry.cat] || freshCategory(entry.cat, target === 'project')
          if (!cat.exceptions) cat.exceptions = []
          const idx = cat.exceptions.findIndex((r) => r.path === entry.value)
          if (idx !== -1) { cat.exceptions[idx].action = action; block[entry.cat] = cat; return }
          cat.exceptions.unshift({ id: 'e' + Math.random().toString(36).slice(2, 8), action, path: entry.value })
          block[entry.cat] = cat
          return
        }
        if (entry.kind === 'command' && entry.cat === 'command' && entry.value) {
          const cat = block.command || freshCategory('command', target === 'project')
          if (!cat.exceptions) cat.exceptions = []
          const idx = cat.exceptions.findIndex((r) => r.match === entry.value)
          if (idx !== -1) { cat.exceptions[idx].action = action; block.command = cat; return }
          cat.exceptions.unshift({ id: 'e' + Math.random().toString(36).slice(2, 8), action, match: entry.value })
          block.command = cat
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

    async function persist(exec) {
      try {
        const t = await ensureTarget(exec)
        await ensureConfigDir()
        // 防覆盖守卫：配置在加载后被外部修改（手工编辑、其他实例写入）时拒绝保存，
        // 避免静默覆盖用户规则；点击「重新加载配置文件」后守卫自动放行。
        try {
          const cur = await fs.readText(t)
          if (lastDiskJson !== null && String(cur || '').trim() !== lastDiskJson) {
            saveError = uiLang === 'en' ? 'Config file changed on disk; save cancelled. Click "Reload config file" first.' : '配置文件已被外部修改，已取消保存；请先点击「重新加载配置文件」'
            broadcast({ type: 'status' })
            return false
          }
        } catch (e) {}
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

    async function load(exec) {
      try {
        const t = await ensureTarget(exec)
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
            loadError = null
            config = freshConfig()
            await persist(exec)
          } else {
            loadError = uiLang === 'en' ? 'Cannot read config file: ' + t : '无法读取配置文件: ' + t
          }
          return
        }
        const parsed = JSON.parse(text)
        if (!parsed || typeof parsed !== 'object') throw new Error('根节点必须是对象')
        const isOld = parsed.global && typeof parsed.global === 'object' && parsed.global.mode !== undefined && parsed.global.directory === undefined
        config = isOld ? migrateOld(parsed) : buildConfig(parsed)
        lastDiskJson = String(text).trim()
        loadError = null
        if (isOld) await persist(exec)
        broadcast({ type: 'status' })
      } catch (e) {
        loadError = '配置解析失败: ' + ((e && e.message) || String(e))
      }
    }

    function statusView(exec, lang) {
      const l = normLang(lang || uiLang)
      const proj = projectBlock()
      const effective = {}
      for (const c of CATS) {
        effective[c] = (proj && proj[c] && proj[c].mode && proj[c].mode !== 'inherit') ? proj[c].mode : (config.global[c] ? config.global[c].mode : 'allow')
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
          global: config.global.sandboxMode || 'workspace-write',
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
            out.push({ id: e.id, tool: e.tool, reason, ts: e.ts, args: argsPreview, intent, candidates: e.candidates || [], argLines: e.argLines || [], hasDiff: e.hasDiff === true })
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
          if (typeof a.action === 'string' && (a.action === 'allow' || a.action === 'deny')) {
            allow = a.action === 'allow'
            if (Array.isArray(a.rules)) {
              for (const r of a.rules) {
                if (r && r.value && (r.decision === 'allow' || r.decision === 'deny')) {
                  addProjectRule(entry, r.kind || null, String(r.value), r.decision)
                  ruleCount++
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
          const target = a.target === 'project' ? 'project' : 'global'
          if (!setSandboxConfig(target, a.mode)) return json(res, { error: '非法沙箱参数: target=' + target + ' mode=' + a.mode })
          await persist(exec)
          syncSandbox(exec)
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
          if (CATS.indexOf(a.category) === -1) return json(res, { error: '未知分类: ' + a.category })
          if (!setCategoryMode(a.target, a.category, a.mode)) return json(res, { error: '非法的 target/mode 组合' })
          await persist(exec)
          return json(res, statusView(exec))
        }
        if (pathname === '/permgate/set-quick' && method === 'POST') {
          await init(exec)
          if (!a.tool || !String(a.tool)) return json(res, { error: 'tool 不能为空' })
          if (ALL_MODES.indexOf(a.action) === -1) return json(res, { error: '非法动作' })
          const block = a.target === 'project' ? ensureProject() : config.global
          if (!block.quickTools) block.quickTools = {}
          if (a.action === 'inherit') delete block.quickTools[a.tool]
          else block.quickTools[a.tool] = a.action
          await persist(exec)
          return json(res, statusView(exec))
        }
        if (pathname === '/permgate/add-exception' && method === 'POST') {
          await init(exec)
          if (EXC_CATS.indexOf(a.category) === -1) return json(res, { error: '该分类不支持例外' })
          if (!a.match || !String(a.match)) return json(res, { error: 'match 不能为空' })
          const e = normalizeException({ id: 'e' + Math.random().toString(36).slice(2, 8), action: a.action, path: a.category === 'command' ? undefined : a.match, match: a.category === 'command' ? a.match : undefined }, a.category)
          if (!e) return json(res, { error: '非法的例外参数' })
          const block = a.target === 'project' ? ensureProject() : config.global
          if (!block[a.category]) block[a.category] = freshCategory(a.category, a.target === 'project')
          if (!block[a.category].exceptions) block[a.category].exceptions = []
          block[a.category].exceptions.push(e)
          await persist(exec)
          return json(res, { added: e, status: statusView(exec) })
        }
        if (pathname === '/permgate/remove-exception' && method === 'POST') {
          await init(exec)
          const block = a.target === 'project' ? ensureProject() : config.global
          const cat = block[a.category]
          if (!cat || !Array.isArray(cat.exceptions)) return json(res, { removed: false, reason: '例外列表不存在' })
          const idx = cat.exceptions.findIndex((r) => r.id === a.id)
          if (idx === -1) return json(res, { removed: false, reason: '未找到 id=' + a.id })
          const removed = cat.exceptions.splice(idx, 1)[0]
          await persist(exec)
          return json(res, { removed: true, exception: removed, status: statusView(exec) })
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
        // 打开被对比的文件：用系统默认关联的编辑器打开（同 open-config 的做法）。
        // 安全约束：仅文件读写工具（read/write/edit）的待审批 entry 可触发，且仅允许
        // 文本/文档类扩展名——`cmd /c start` 对 .exe/.bat/.ps1 等执行的是"运行"而非"编辑"。
        if (pathname === '/permgate/open-file' && method === 'POST') {
          const entry = pendingApprovals.get(a.id)
          if (!entry) return json(res, { ok: false, error: lang === 'en' ? 'Approval request not found or expired' : '审批请求不存在或已过期' })
          if (!FILE_READ_TOOLS[entry.tool] && !FILE_WRITE_TOOLS[entry.tool]) return json(res, { ok: false, error: lang === 'en' ? 'Unsupported tool for opening file' : '该审批不支持打开文件' })
          const args = parseEntryArgs(entry)
          const fp = pathArg(args)
          if (!fp) return json(res, { ok: false, error: lang === 'en' ? 'Missing file path' : '缺少文件路径' })
          // 仅允许文本/文档类扩展名（点开头文件如 .gitignore 视为无扩展名，Windows 不会执行）
          const openBase = String(fp).split(/[\\/]/).pop() || ''
          const openExt = openBase.indexOf('.') > 0 ? openBase.slice(openBase.lastIndexOf('.') + 1).toLowerCase() : ''
          if (openExt && !OPEN_TEXT_EXTS.has(openExt)) return json(res, { ok: false, error: lang === 'en' ? 'Unsupported file type: ' + openExt : '不支持打开该文件类型: ' + openExt })
          const sub = ctx.get('subprocess')
          if (!sub) return json(res, { ok: false, error: 'subprocess 服务不可用' })
          try {
            const t = await fs.resolve(fp)
            const winPath = fs.processPath ? fs.processPath(t) : String(t).replace(/\//g, '\\')
            const exe = await sub.resolveExecutable('cmd')
            const handle = sub.spawn({
              argv: [exe, '/c', 'start', '', winPath],
              cwd: String(root || 'C:\\').replace(/\//g, '\\'),
              stdio: { stdin: 'ignore', stdout: { maxBytes: 1024 }, stderr: { maxBytes: 1024 } },
              graceMs: 5000,
            })
            await handle.done
            return json(res, { ok: true, path: winPath })
          } catch (e) {
            return json(res, { ok: false, error: lang === 'en' ? 'Cannot open file: ' + ((e && e.message) || String(e)) : '打开文件失败: ' + ((e && e.message) || String(e)) })
          }
        }
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

    // ── 工具注册 ────────────────────────────────────────────────────────────────

    function renderer() {
      return function (_a, v) { return [{ type: 'text', text: JSON.stringify(v, null, 2) }] }
    }

    function registerTool(definition) {
      onDispose(ctx.tools.register(defineTool(definition)))
    }

    registerTool({
      name: 'perm_status',
      description: '查看权限网关(permgate)当前生效的分类默认(目录/命令/读取/编辑/子代理/重复操作)、例外、快捷工具、自定义规则、最近决策与配置路径。',
      parameters: {},
      output: { schema: { type: 'json' }, render: renderer() },
      async execute(_args, exec) { await init(exec); return statusView(exec) },
    })

    registerTool({
      name: 'perm_set_category',
      description: '设置一个权限分类的默认动作。分类: directory=目录访问(工作区外), command=执行命令, read=读取文件, edit=编辑文件, subagent=启动子代理, doomloop=重复操作。动作: ask=询问, allow=允许, deny=拒绝; 项目(target=project)还支持 inherit=继承全局。',
      parameters: {
        target: { type: 'string', required: true, enum: ['global', 'project'] },
        category: { type: 'string', required: true, enum: ['directory', 'command', 'read', 'edit', 'subagent', 'doomloop'] },
        mode: { type: 'string', required: true, enum: ['ask', 'allow', 'deny', 'inherit'], description: '目标动作；inherit 仅适用于项目' },
      },
      output: { schema: { type: 'json' }, render: renderer() },
      async execute(args, exec) {
        await init(exec)
        if (CATS.indexOf(args.category) === -1) return { error: '未知分类: ' + args.category }
        if (!setCategoryMode(args.target, args.category, args.mode)) return { error: '非法的 target/mode 组合' }
        await persist(exec)
        return statusView(exec)
      },
    })

    registerTool({
      name: 'perm_add_exception',
      description: '给分类添加一条例外。directory/read/edit 分类用 path(路径 glob，支持 * 与 ** 通配，如 G:/MCP/**、**/*.env)；command 分类用 match(命令名或子串，支持 * 通配任意剩余，如 Get-Item * / git status)。例外优先于分类默认动作，仅 allow/deny。',
      parameters: {
        target: { type: 'string', required: true, enum: ['global', 'project'] },
        category: { type: 'string', required: true, enum: ['directory', 'command', 'read', 'edit'] },
        match: { type: 'string', required: true, description: '路径 glob 或命令名/子串（* 匹配任意剩余）' },
        action: { type: 'string', required: true, enum: ['allow', 'deny'], description: '命中例外后的动作' },
      },
      output: { schema: { type: 'json' }, render: renderer() },
      async execute(args, exec) {
        await init(exec)
        if (EXC_CATS.indexOf(args.category) === -1) return { error: '该分类不支持例外' }
        if (!args.match || !String(args.match)) return { error: 'match 不能为空' }
        const e = normalizeException({ id: 'e' + Math.random().toString(36).slice(2, 8), action: args.action, path: args.category === 'command' ? undefined : args.match, match: args.category === 'command' ? args.match : undefined }, args.category)
        if (!e) return { error: '非法的例外参数' }
        const block = args.target === 'project' ? ensureProject() : config.global
        if (!block[args.category]) block[args.category] = freshCategory(args.category, args.target === 'project')
        if (!block[args.category].exceptions) block[args.category].exceptions = []
        block[args.category].exceptions.push(e)
        await persist(exec)
        return { added: e, status: statusView(exec) }
      },
    })

    registerTool({
      name: 'perm_remove_exception',
      description: '按 id 删除一条分类例外(id 见 perm_status 返回的 exceptions 或 perm_add_exception 返回)。',
      parameters: {
        target: { type: 'string', required: true, enum: ['global', 'project'] },
        category: { type: 'string', required: true, enum: ['directory', 'command', 'read', 'edit'] },
        id: { type: 'string', required: true },
      },
      output: { schema: { type: 'json' }, render: renderer() },
      async execute(args, exec) {
        await init(exec)
        const block = args.target === 'project' ? ensureProject() : config.global
        const cat = block[args.category]
        if (!cat || !Array.isArray(cat.exceptions)) return { removed: false, reason: '例外列表不存在', status: statusView(exec) }
        const idx = cat.exceptions.findIndex((r) => r.id === args.id)
        if (idx === -1) return { removed: false, reason: '未找到 id=' + args.id, status: statusView(exec) }
        const removed = cat.exceptions.splice(idx, 1)[0]
        await persist(exec)
        return { removed: true, exception: removed, status: statusView(exec) }
      },
    })

    registerTool({
      name: 'perm_set_quick',
      description: '设置快捷工具默认动作(如 web_search/skill/grep/glob 等)。action=inherit 表示移除该项目覆盖(继承全局)。',
      parameters: {
        target: { type: 'string', required: true, enum: ['global', 'project'] },
        tool: { type: 'string', required: true, description: '工具名，支持通配如 cordis_*' },
        action: { type: 'string', required: true, enum: ['ask', 'allow', 'deny', 'inherit'], description: '动作；inherit 移除' },
      },
      output: { schema: { type: 'json' }, render: renderer() },
      async execute(args, exec) {
        await init(exec)
        if (!args.tool || !String(args.tool)) return { error: 'tool 不能为空' }
        if (ALL_MODES.indexOf(args.action) === -1) return { error: '非法动作' }
        const block = args.target === 'project' ? ensureProject() : config.global
        if (!block.quickTools) block.quickTools = {}
        if (args.action === 'inherit') delete block.quickTools[args.tool]
        else block.quickTools[args.tool] = args.action
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

    // 新会话默认权限修正：平台对 seeded 会话（web 新窗口几乎都是）固定为
    // 「组合派生预设」，忽略用户在设置里选的默认。这里在会话创建时检测：
    // 全新（无任何活动）+ 当前预设恰为组合派生值 + 用户默认不同 → 按用户默认
    // 重定。已恢复/有历史的会话（hasActivity）保持原样。
    ctx.on('session/created', (session) => {
      try {
        if (!session) return
        const pp = ctx.permissionPresets
        if (!pp || typeof pp.current !== 'function' || typeof pp.set !== 'function') return
        const composedDefault = pp.current([])
        const userDefault = pp.defaultPreset
        if (!userDefault || userDefault === composedDefault) return
        const evs = session.events || []
        // 真正的「已使用」判定：发生过轮次/工具调用。seed 里可能含合成的
        // user/message，不能作为已使用的依据；恢复的会话历史必然含 turn/start。
        const hasActivity = evs.some((e) => e.type === 'turn/start' || e.type === 'tool/call')
        if (hasActivity) return
        if (pp.current(evs) !== composedDefault) return
        pp.set(session, userDefault)
        if (agentRef === null) agentRef = { session }
        broadcast({ type: 'status' })
      } catch (e) {}
    })

    // ── 预执行审查 ──────────────────────────────────────────────────────────────

    // 会话权限/沙箱/审批变化（DSH 侧写入，不经 permgate）→ 推送浏览器刷新，
    // 让快捷栏/设置页在选择器切换权限后立即联动。
    ctx.on('session/event', (session, event) => {
      try {
        if (!event) return
        if (event.type === 'permission/preset' || event.type === 'sandbox/mode' || event.type === 'approval/policy') {
          if (agentRef === null && session) agentRef = { session }
          broadcast({ type: 'status' })
        }
      } catch (e) {}
    })

    ctx.on('tools/pre-execute', async (exec, next) => {
      try {
        await init(exec)
        // 注意：聊天/工具调用绝不改写会话 sandbox knob（否则权限选择器显示会漂移）；
        // 底层沙箱只在设置页显式切换时经 /permgate/set-sandbox 同步一次。
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
