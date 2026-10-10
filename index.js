// dsh-permgate — 权限网关（宿主半）
// 注册 perm_* 工具、挂钩 tools/pre-execute 审查、经 webServer 提供 /permgate/* JSON 路由供浏览器 UI 调用。
// 配置持久化于 $DSH_HOME/dsh-permgate/config.json（用户级、不进任何 git 仓库）。
import { defineTool } from '@deepseek-ai/dsh-tools'
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import { assessCommand, matchCommand, codeLabel, tierLabel, decomposeCommand, segmentLabel, nestedInlineProgram, isDestructiveSegment, canCarryDestructivePayload, isPayloadCarrierLabel, blastRadiusOf, blastRadiusOfCommandPattern, BLAST_ORDER, SHELL_OF_TOOL, DESTRUCTIVE_LABELS, TIERS, GROUP_MEMBERS } from './shell-parse.js'
import { join as pathJoin, resolve as pathResolve, isAbsolute as pathIsAbsolute } from 'node:path'
import { existsSync as fsExistsSync, readFileSync as fsReadFileSync, readdirSync as fsReaddirSync, unlinkSync as fsUnlinkSync, lstatSync as fsLstatSync, realpathSync as fsRealpathSync } from 'node:fs'
import { homedir as osHomedir } from 'node:os'
const CATS = ['directory', 'command', 'read', 'image', 'edit', 'undo', 'subagent', 'doomloop']
const EXC_CATS = ['directory', 'command', 'read', 'image', 'edit', 'undo']
const MODES = ['ask', 'allow', 'deny']
const ALL_MODES = ['ask', 'allow', 'deny', 'inherit']
// 严格度序：allow < ask < deny（越大越严）。做法 A 的「取更严者」合并与面板的
// warnSubMismatch 判据同源 —— 两处都表达「谁更严」，不该各写一份比较逻辑。
const MODE_STRICTNESS = { allow: 0, ask: 1, deny: 2 }
// 档位名 → 存储键 的**映射单点**：`inside` 档由老键 `action` 承载（**老键义不变**，§7.1），
// 其余七档各有一个同名键。读取侧（destructiveTiers）与写入侧（setCommandSub）都走它。
//
// 为什么必须收敛成单点：这条映射散落时，任何一处写错都是 **fail-open**。
//   · 归一化侧（normalizeSubSetting）的 tierOk 判据**显式排除 inside**（它只认 r[t]，
//     不认 r.action），故那里写错键会让整条 `destructive` 被判为非法而**整块丢弃**、
//     回落 command mode —— 用户以为设了「拒绝」，命令却被**静默放行**；
//   · 读取侧与写入侧漂移，则「面板显示的值」与「裁决实际用的值」分叉。
// 两者都是本文件反复警告的「面板说谎 / 静默失效」那一类，且都不会报错，故只能靠单点防。
//
// ⚠️ `normalizeSubSetting` 内**仍有一处必须内联**的同义映射（见该处注释）：那个函数会被
// test/regressions.mjs 抽取进 `new Function` 独立求值，注入的自由变量只有
// MODES / ALL_MODES / TIERS / normalizeText —— 引用本函数会 ReferenceError 并让
// 「子设置键集封闭」那条断言变红。故**改这里的键名映射时必须同步改那一处**，反之亦然。
const keyOfTier = (tier) => (tier === 'inside' ? 'action' : tier)
// 「无项目块」探针 root：statusView 的 `globalEffectiveProbe` 用它求**全局层单独**的生效值。
//
// 取一个**不可能成为项目键**的值：`projectBlock` 按 norm+小写比对 `config.projects` 的键，
// 而任何真实路径都不可能含 NUL，故不存在与之相等的项目 —— 于是
// `destructiveTiers(GLOBAL_PROBE_ROOT)` 恒等于「全局层单独解析」的结果。
// 不用 `'__no_such_root__'` 这类普通字符串：用户真有一个叫它的项目键时探针会取到那个项目，
// 面板全局 tab 又会显示成项目的值 —— 正是本探针要消除的那类面板说谎。
const GLOBAL_PROBE_ROOT = '\u0000__no_project__'
const MAX_DECISIONS = 30
// 候选值（例外模式）的字符上限：超限的候选**不产出**。
//
// 破坏性/载荷族段的候选值是「整段原文」，而命令行由 AI 生成、长度无上界 ——
// 没有上限时一条 190,896 字符的命令一次「允许并记住」就把 config.json 撑到 194 KB，
// 此后每次 statusView 全量下发（实测 GET /permgate/status 196,285 bytes、
// perm_status 向 AI 下发 196,322 bytes），且重启后不会被截断。
// 上限取 2000：正常破坏性命令（含几十个路径）远低于它，而单条例外的下发体积被限制在 2 KB 量级。
const CAND_VALUE_MAX_CHARS = 2000
// 审批弹窗「意图」文本的字符上限。六级取值链**共用这一处裁剪**（见 intentFor）。
//
// 为什么必须收在一处：此前这条链上有三种口径 —— `description` **完全无上限**、
// 用户的话 200、机械标签 80。`description` 那个是活的漏洞：schema 写的是「5-10 words」，
// 但那是**给模型的建议、不是校验**，模型写 3000 字时它会经 /permgate/pending 原样下发
// 并渲染进 .pg-intent 框，而卡片只有 max-height:82vh —— 允许/拒绝按钮会被挤出可视区。
// （与 note 曾经的洞是同一个，见 askUser 里 note 的注释。）
//
// 取 120：比 normalizeText 的 200 短（那是**存储口径**，服务例外/分类默认值/兜底/快捷工具
// 四处落盘，与显示层无关，不应复用），比原机械标签的 80 长（够放一句完整的话）。
const INTENT_MAX_CHARS = 120
// ④ 思考末尾的取样长度（字符）。见 reasoningTail 的按行收敛规则。
const REASONING_TAIL_CHARS = 100
// 回溯（intentLookback）**最多往前扫几条消息**。
//
// 为什么用「限定步数」而不是「判定轮边界」：本功能第一版按 source.kind 白名单划轮边界
// （只有已知注入类 kind 可跨越，其余 user 角色一律当边界）。那个方向对，但清单**不可能穷举** ——
// MessageSourceMap 是 merge-extensible 联合，且第三方插件会持续引入新 kind（实测本机
// dsh-loop-guard 用 kind:'loop-guard' 注入，935 次；compact-checkpoint 198 次；plan-mode 36 次），
// 它们不在白名单里，于是被误判成轮边界、回溯提前终止。实测 949 个会话：需回溯 43454 次，
// 其中 1849 次（4.3%）被这类假边界挡掉、退化成 ⑤「用户意图」。
//
// 改法：不再问「这条算不算轮边界」，只问「往前几步之内有没有我要的东西」——
// 命中「模型文本 / 模型思考 / 用户文本(kind==='user')」即停，其余消息一律跳过（含注入、
// goal/schedule/webhook、tool 结果、以及 loop-guard 这类第三方注入）。
//
// 取 6 的依据（同一批 949 会话，40870 个需回溯的 assistant 消息实测）：
//   N=2  命中 26310 (64.4%)   跨轮 3
//   N=4  命中 35107 (85.9%)   跨轮 3
//   N=6  命中 38219 (93.5%)   跨轮 3      ← 取此值
//   N=8  命中 39493 (96.6%)   跨轮 6
//   N=12 命中 40395 (98.8%)   跨轮 6
// 6 是拐点：再往后每加 2 步只多覆盖约 3%，而跨轮次数翻倍。
//
// ⚠️ 跨轮**没有**被消除，只是被压到 0.01%（3/38219）：往前扫 N 步必然先撞上模型自己的文本，
// 所以到不了轮边界 —— 这是覆盖率带来的副作用，不是判据。那 3 例已核对（都是「上一轮末尾的
// 收尾话」被当成下一步的意图），代价可接受，且远比旧版被假边界挡掉 1849 次小。
//
// 步数口径：**每条被扫过的消息都计 1 步**，注入与 tool 结果同样消耗预算（实测消息序列是
// assistant / tool / assistant / tool …，且注入常成串出现 —— agent-instructions + runtime-context
// + skill-catalog 三连是常态，故 N=6 约等于「往回看 3 条 assistant 消息」）。
const INTENT_LOOKBACK_STEPS = 6
// 快捷工具预设：无文件/命令语义、只能按工具名设默认动作的清单（设置页据此展示，新配置按 QUICK_DEFAULTS 落默认）
// 低风险观测/会话类工具默认放行，避免每次都弹窗；
// 其余工具默认询问（ask）：mcp__*（外装 MCP）、以及管理动态插件的 cordis_run/stop/undefine
// —— perm_* 曾经被 decide 无条件放行，等于「AI 可自我提权、且全程无弹窗」；纳入本清单后
// 统一按 ask 裁决，只有用户在设置页显式改成 allow 才会静默放行（预设默认优先于兜底策略，
// 改兜底也不会漏）。权限写工具已整体移除，本清单里的 perm_* 只剩只读的 perm_status（allow）。
const QUICK_DEFAULTS = {
  web_search: 'ask', skill: 'allow', grep: 'allow', glob: 'allow', web_fetch: 'ask',
  ask_user_question: 'allow', todo_write: 'allow', list_agents: 'allow',
  job_list: 'allow', job_output: 'allow', job_kill: 'allow',
  get_goal: 'allow', create_goal: 'allow', update_goal: 'allow',
  send_message: 'allow', interrupt_agent: 'allow',
  present: 'allow', exit_plan_mode: 'allow',
  // cordis_define 默认 ask（曾为 allow）：它在宿主进程内定义并执行任意代码，
  // 能力等价于 cordis_run（后者本就是 ask），而它比 run 更靠前——定义阶段即可
  // 执行模块顶层代码。allow 意味着这条路径全程无弹窗，是本清单里唯一「可执行代码
  // 却默认放行」的项，与「元操作一律先问」的口径自相矛盾，故收紧为 ask。
  // 注意：只改这一行对**存量配置**是无效的 —— 旧版 freshConfig 已把当时的 allow
  // seed 落盘，显式键优先于预设默认。真正让收紧生效的是 QUICK_RETIRED_DEFAULTS
  // 那次一次性收敛，改本表时必须同步考虑它（否则等于没改）。
  // 三个 inspect_* 是只读检视，维持 allow。
  cordis_define: 'ask', cordis_inspect_list: 'allow', cordis_inspect_query: 'allow', cordis_inspect_self: 'allow',
  // 改权限配置类工具（已整体移除）曾一律先问；现仅 perm_status 只读查询，默认放行（想看随时能看）
  // 其余 9 个写工具（perm_set_category / perm_set_fallback / perm_set_editor_kernel /
  // perm_add_exception / perm_remove_exception / perm_set_quick / perm_add_rule /
  // perm_remove_rule / perm_reload）已整体移除，理由：
  //   ① 与设置页 UI 重复 —— 除编辑器内核外，其余能力均由 /permgate/* 路由覆盖，工具没有独占能力；
  //      编辑器内核（builtin/shadow 判别）本就无面板入口，配置项 editorKernel 与工具已一并移除，
  //      判别恒为 detectEditorKernel 自动探测：config.json 里手写该键不会生效（buildConfig 不再
  //      读取它，且会在下次保存时被抹掉）。探测失准时的纠正手段只剩调整工具描述；
  //   ② 它们构成自我提权面 —— AI 可主动请求放宽约束自己的规则，而弹窗看起来只是普通
  //      工具调用，不会告诉用户「这是 AI 在请求放宽约束」；用户在现场勾「允许此项」时
  //      信息量完全不同，两者却共用同一个弹窗；
  //   ③ 成本常驻 —— 9 个工具约 1200 字符描述 + 30 个参数，每轮请求都带，且无 deferLoading
  //      （而 deferLoading 需要额外的激活通道才可用，平台注释明确「延迟基线工具只能在
  //      首次被 addition 之后才可见」，不是低成本方案）；
  //   ④ 无使用证据 —— 中英文 README 均未提及，实测决策记录零调用。
  // 保留 perm_status：只读、不改配置（下发内容含例外 reason/note 与绝对路径，属既有设计），
  // 提供 UI 给不了的对话价值（AI 能回答「为什么这次被拦」「现在是什么配置」）。
  perm_status: 'allow',
  // cordis_run 在宿主进程里执行代码、stop/undefine 管理（可移除）动态插件 —— 同属元操作，一律先问
  cordis_run: 'ask', cordis_stop: 'ask', cordis_undefine: 'ask',
}
// 单一来源：预设清单由 QUICK_DEFAULTS 的键派生（顺序即键的插入顺序），
// 避免「清单」与「默认值」两份定义在新增工具时漂移（设置页展示与 locked 迁移共用这一份）
const QUICK_PRESET = Object.keys(QUICK_DEFAULTS)
// 已移除的权限写工具名：旧配置里可能残留它们的 quickTools 键（1.5.1–1.5.8 的 freshConfig
// 会把当时 QUICK_DEFAULTS 的每个键都 seed 进配置并落盘），加载时按名单丢弃，理由：
//   · 这些工具已不再注册，残留键永远命不中，却会继续占用每次 decide 的键扫描，
//     并在设置页渲染成没有用途说明的孤儿行（对应 i18n 标签已随工具删除）；
//   · 更关键的是 fail-open 隐患：残留的 { action: 'allow' } 优先级高于预设默认，
//     一旦将来重新引入同名写工具，它会在不弹窗的情况下被静默放行（即 issue #3 那条老路）。
// 只按这份精确名单删，不做「未知键一律清理」——用户手填的自定义工具名必须保留。
const REMOVED_WRITE_TOOLS = ['perm_set_category', 'perm_set_fallback', 'perm_set_editor_kernel',
  'perm_add_exception', 'perm_remove_exception', 'perm_set_quick', 'perm_add_rule',
  'perm_remove_rule', 'perm_reload']
const REMOVED_WRITE_TOOL_SET = new Set(REMOVED_WRITE_TOOLS)
// 预设默认值的历史值：旧版 freshConfig 会把**当时**的 QUICK_DEFAULTS 全量 seed 进配置并落盘
// （1.5.1–1.5.8 一直如此），而 quickAction 的优先级是「项目键 → 全局键 → 预设默认 → 兜底」，
// 落盘的显式值会永久压过新默认 —— 于是「只改 QUICK_DEFAULTS」对存量配置零效果：
// 面板显示新默认（quickDefaults 下发的是新值），实际裁决却仍按旧值走，且此后任何一次
// persist 都会把旧值固化。cordis_define 由 allow 收紧为 ask 正是这种情况。
// 故加载时按「精确名单 + 精确旧值」做一次性收敛：值恰好等于历史默认、且新默认已不同时丢弃该键，
// 使其回落新默认。与 REMOVED_WRITE_TOOLS 同一口径，只删这份精确名单，用户手填的自定义工具名不受影响。
// 代价（有意接受）：升级前**特意**把该工具设为旧默认值的用户，需在设置页重设一次；
// 否则收紧等于白改，而「以为收紧了、其实没有」比「需要重设一次」危险得多。
// 仅作用于全局层：旧版 freshConfig 只 seed 全局，项目层出现该键必是用户显式设置，不动。
const QUICK_RETIRED_DEFAULTS = { cordis_define: 'allow' }
// 该收敛的迁移 ID：写进配置的 migrations 名单，表示「这条迁移已经评估过」。
// 为什么需要它（而不是只比一个全局版本号）：收敛判据是「值等于历史默认」，而用户升级后
// 完全可能主动把 cordis_define 设回 allow（那是他的明确意图）。若只看值，每次加载都会
// 把这次显式设置再删一遍；若只看**全局**版本号，则将来为别的迁移把版本从 1 升到 2 时，
// 本条会被判为「未跑过」而重新执行，同样静默回滚用户设置（已实测复现）。
// 故按「迁移 ID 是否已在名单里」判断，各条迁移互不牵连。
const RETIRE_QUICK_DEFAULTS_MIGRATION = 'retire-quick-defaults-cordis_define'
// eslint-disable-next-line no-unused-vars -- 有意保留：记录「审批已改为永不超时」前的历史口径
const ASK_TIMEOUT_MS = 300000 // 保留常量（历史/文档用途）；审批已改为永不超时
const DECIDE_CHOICES = ['allow', 'deny', 'allow-global', 'allow-project', 'deny-global', 'deny-project']
// 循环检测的默认阈值：连续【静默放行】多少次相同调用后触发提醒（第 N+1 次触发）。
// 可配置（global.doomloop.threshold / 项目层可 inherit 穿透），默认值由读取侧推导，
// **不物化落盘** —— 理由与 destructive 子设置完全同构（见 doomloopSetting 的注释）：
// 推导值一旦落盘就成了「用户表态」，日后调整默认阈值对存量配置零效果。
const DEFAULT_REPEAT_STREAK = 6
// 阈值下限：1（= 第 2 次触发），**不钳到 2**。参考工程的「1 would turn EVERY auto-allowed
// call into an ask」在 permgate 不成立 —— 它是先记后查，我们是先查后记（decide 在记录之前），
// 阈值 1 只会让第 2 次触发。既然不存在「每次都问」，就不该设人为下限。
const MIN_REPEAT_STREAK = 1
// 阈值上限：**没有**。上限唯一的用途是「不许超过窗口」，而窗口（recent 数组）已随
// (键, 次数) 计数实现一并删除 —— 计数能数到任意大，阈值 999 就是「连续静默放行 999 次后提醒」，
// 语义准确，不是静默失效。故这里刻意不定义 MAX 常量（曾有的 REPEAT_STREAK_MAX 是数组实现的副产品）。
// 每会话循环状态桶的上限：按 LRU 淘汰最久未更新的会话（参考工程 LOOP_GUARD_MAX_KEYS 是同一手法）。
// 每桶只占两个字段（键 + 次数），32 足够覆盖同时活跃的对话数。
const SESSION_BUCKET_MAX = 32
// PS_KEYWORDS / ROUTER_CMDS / ROUTER_OPT_VALUE 已随命令判定一起迁到 shell-parse.js：
// 「哪些是 PowerShell 关键字」「哪些命令是子命令路由器」属于解析器的词汇表，
// 留一份在宿主里就会与解析器实际用的那份漂移（候选生成与判定各按一张表走）。

const FILE_READ_TOOLS = { read: 1 }
// 图片读取单列一类：判定链与 read 完全同构（工作区外先过「目录访问」闸，再过本分类 + 路径例外），
// 但配置与默认值都独立 —— 「读文件」的设置不管读图，且 image 默认 ask（read 默认 allow），
// 老配置升级后读图会先询问（v1 的 locked 配置保持 deny），是否放宽由用户自己决定。
const FILE_IMAGE_TOOLS = { read_image: 1 }
const FILE_WRITE_TOOLS = { write: 1, edit: 1 }
// 命令工具 → shell 方言：由 shell-parse.js 的 SHELL_OF_TOOL 派生（单一来源），
// 避免「哪些工具是命令工具」与「它属于哪个 shell」两份定义在新增工具时漂移。
const COMMAND_TOOLS = {}
for (const k of Object.keys(SHELL_OF_TOOL)) COMMAND_TOOLS[k] = 1
const SUBAGENT_TOOLS = { subagent: 1, subagent_fork: 1, workflow: 1, ralph: 1 }

// str_replace_editor 的写命令（view 只读）。
// undo_edit 有意不在列：它是否写盘取决于当前生效的内核 —— DSH 内置根本没有该命令、
// dsh-better-edit 有但抛 E_UNSUPPORTED（不写盘）、dsh-fs-encoding 转发 performUndo（真写盘）。
// 故它由 isUndo 按内核单独判别，而不是在这里一刀切。
const SRE_WRITE_CMDS = { create: 1, str_replace: 1, insert: 1 }
// str_replace_editor 的撤销子命令名：语义等同 undo_last_edit（恢复既有内容、不接受新内容）
const SRE_UNDO_CMD = 'undo_edit'

// 参数里接受 encoding 的工具（预览的磁盘侧基准来源）。当前只有 read：dsh-fs-encoding 的
// read 提供 encoding 参数（"Reopen with Encoding" 语义，按它解码）。判据必须按**工具名**
// 而非 isFileRead —— 后者回答的是「这是不是文件读工具」（str_replace_editor + view 也为真），
// 而该工具的参数表里并没有 encoding（实测 dsh-fs-encoding/src/tool-str-replace-editor.ts），
// 其 view 走 encoding memo。混用会让模型多塞的 encoding 被当成预览基准，而工具按 memo 解码，
// 预览与工具所见脱钩——正是本功能要消除的失败。
const DECODE_ENCODING_TOOLS = { read: 1 }

// str_replace_editor 的内核：DSH 内置（官方语义，insert_line 0 基、插到该行之后）
// 或 dsh-better-edit 的同名 shadow 覆盖（1 基、插到该行之前）。两者语义相反，
// 预览必须按实际生效的那个算，否则会把插入位置画到错误的地方。
// 判别**只由 detectEditorKernel 自动探测**：原先还支持配置项 editorKernel 人工指定
// （auto/builtin/shadow），但那个设置只有 AI 工具能写、无面板入口，已随权限写工具一并移除。

// str_replace_editor 命令名提取统一：isFileWrite/isFileRead 与各预览分支共用同一解析口径，
// 避免命令字符串解析在多处独立演化（create 等命令的判定曾在两处各写一份）
function sreCommand(args) {
  try { return String((args && args.command) || '') } catch (e) { return '' }
}

// dsh-fs-encoding 的 insert 是**独立注册的工具**（DSH 内置没有这个名字，内置的 insert 只是
// str_replace_editor 的子命令）。它会写盘，故归入 edit 分类。
const FILE_INSERT_TOOLS = { insert: 1 }

// insert 判定：名字 + 参数形状双重确认。只按名字会把别的插件注册的同名工具（数据库 insert、
// 数组 insert 之类）也算成写文件；要求「文件路径 + 至少一个文件插入专有参数」才认定 ——
// file_path/path 是它的路径形状，insert_line/new_string 是它区别于「带 path 的其它 insert」的特征。
// 有意不校验这两个参数的类型：形状畸形时仍按写文件拦住（fail-closed），否则一个
// insert_line:"1" 的畸形调用就能绕过 edit 分类的拒绝例外、掉到兜底策略上。
// 未装该插件时这个名字根本不存在，判定永不触发 —— 不构成对它的依赖。
function isFileInsert(name, args) {
  if (!FILE_INSERT_TOOLS[name]) return false
  try {
    if (!args || typeof args !== 'object') return false
    const p = typeof args.file_path === 'string' ? args.file_path : (typeof args.path === 'string' ? args.path : '')
    if (!p) return false
    return args.insert_line !== undefined || typeof args.new_string === 'string'
  } catch (e) { return false }
}

// 文件写工具判定：write/edit 原生工具、insert（dsh-fs-encoding），或 str_replace_editor 的写命令
function isFileWrite(name, args) {
  if (FILE_WRITE_TOOLS[name]) return true
  if (isFileInsert(name, args)) return true
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

// 撤销类工具：会写盘但不是「编辑」——它恢复既有内容、不接受调用方提供的新内容，
// 因此单列一类（undo），默认询问。dsh-better-edit 与 dsh-fs-encoding 都注册这个名字。
const UNDO_TOOLS = { undo_last_edit: 1 }

// 撤销判定。undoWrites 表示「当前生效的 str_replace_editor 的 undo_edit 会不会写盘」，
// 由调用方用 sreUndoWrites() 探测后传入 —— 探测要读 ctx.tools，而本函数有意保持为纯函数。
// undo_last_edit 恒为撤销；str_replace_editor 只有 undo_edit 子命令才是，且仅当它真写盘。
function isUndo(name, args, undoWrites) {
  if (UNDO_TOOLS[name]) return true
  if (name !== 'str_replace_editor') return false
  return sreCommand(args) === SRE_UNDO_CMD && undoWrites === true
}

// 「可预览文件内容」判定：详情 diff 与「打开文件」路由共用同一口径（写类/文本读类/图片类/撤销类），
// 避免两处判据分叉导致「面板有对比但打开文件报不支持」。undoWrites 含义同 isUndo。
function isPreviewableFileTool(name, args, undoWrites) {
  return !!(isFileWrite(name, args) || isFileRead(name, args) || isFileImage(name) || isUndo(name, args, undoWrites))
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
//
// 尾部分隔符剥离用**线性 while**，与 apply() 内的 norm 同源同写法：`.replace(/\/+$/, '')`
// 在 V8 上对「一段连续斜杠 + 非斜杠结尾」的输入呈平方增长（`\/+$` 在每个起点回退后
// 重新扫描整段连续斜杠）。实测 40000 个连续斜杠：正则版 350 ms、while 版 0.01 ms。
// 这里曾被漏掉（apply() 的 norm 改了，这一份没改），而它的入参同样是 AI 生成的路径原文。
function normPathKey(p) {
  let s = String(p || '').replace(/\\/g, '/')
  let end = s.length
  while (end > 0 && s.charCodeAt(end - 1) === 47) end -= 1
  if (end !== s.length) s = s.slice(0, end)
  return s.toLowerCase()
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

// 双语文案：bi(zh, en) 生成 {zh,en}；L(obj, lang) 按语言取值（缺省回退中文）。
//
// L 必须同时接受**字符串**：reason 有两种合法形态，来源不同、都不可改 ——
//   · bi() 对象 —— 宿主自己拼的文案（分类默认值、兜底、工作区外…共 24 个出口）；
//   · 裸字符串 —— **用户写进配置的**文字（自定义规则的 reason、分类/兜底/子设置的
//     reason 都经 normalizeText 落盘成字符串，例外同理）。
// 第二种必须是字符串：配置是给人读改的 JSON，把 reason 落成 {zh,en} 会让用户没法手写，
// 也会破坏存量配置。故**兼容放在 L 这一处**，而不是要求每个出口都包 bi()。
//
// 曾经的写法只认对象：`(o && (o[lang] || o.zh)) || ''`。对字符串取 .zh/.en 恒为 undefined
// → 回落空串，于是**用户在自定义规则里填的拒绝原因被静默丢弃**（实测：填了 reason 的规则
// 回给 AI 的是空串，而不填时反倒能显示「自定义规则 r1 命中」这句回落文案）。
// 之所以只在 L 修：当时有 3 个消费点自行写了 `typeof x === 'string' ? x : L(x)` 守卫
// （statusView 的 recentDecisions、/permgate/pending、file-diff 的错误），另 2 个
// （console.log 与 deny 回传）漏了。这种「同一守卫散落在 N 个消费点」的形态必然会再漏 ——
// 根治点是让唯一的取值函数本身正确，消费点就不必记得任何事。
const bi = (zh, en) => ({ zh, en })
const L = (o, lang) => {
  if (typeof o === 'string') return o
  return (o && (o[lang] || o.zh)) || ''
}
// 语言参数归一化：只有 en 用英文，其余（缺失/空/非法）一律中文
const normLang = (v) => (v === 'en' ? 'en' : 'zh')

// 「读取失败」错误对象统一构造：各读盘/预检分支共用，避免中英文案与字段在多处独立演化
const readFail = (e) => {
  const emsg = (e && e.message ? e.message : String(e))
  return { zh: '读取失败: ' + emsg, en: 'Read failed: ' + emsg }
}

// ── 非 UTF-8 文本预览：复用 dsh-fs-encoding 的解码服务 ──────────────────────
// 背景：ctx.fs 的文件系统契约是 UTF-8-only（严格 TextDecoder，非 UTF-8 直接抛
// invalid UTF-8 text）。dsh-fs-encoding 在**工具层** shadow read/write/edit 解决
// 编码问题，但不替换 ctx.fs——所以绕过工具层、直接读 ctx.fs 的调用方（本插件的
// 审批预览）拿不到它的能力，非 UTF-8 文件的预览会直接报错。
//
// 该插件现已提供 `ctx.fsEncoding` 服务（其 service.ts 明确定位就是「给渲染型消费者
// 用」：不读文件、不记录、refusal 是返回值而非异常）。本插件**可选**复用它：
//   有服务  → 把字节交给它判定，连「这是猜的还是确定的」一起拿到，如实展示；
//   没服务  → 完全不猜，维持原有报错行为（多用户环境里它可能根本没装）。
// 这条可选性是硬要求：permgate 不能依赖另一个插件存在。
//
// 刻意不做的事：**不自己实现猜测**。同一份字节在两处各自猜，正是服务注释里点名的
// 「一个部署的两半对同一个文件的内容产生分歧」。判定权归它，本插件只负责展示。
const FS_ENCODING_SERVICE = 'fsEncoding'

// 交给解码服务的字节上限（readBytes 的 maxBytes）。
// 这是**本插件的内存硬保护**，不是业务上限：必须显式传（漏传即无界整读，dsh-fs-local
// 的 `info.size > undefined` 恒为 false 且 createReadStream({end: undefined}) 读到 EOF），
// 但也不能取小值去替服务做业务判定——服务的 maxFileBytes 可配置（默认 10MiB，
// 支持配置文件与 DSH_FS_ENCODING_MAX_FILE_BYTES），且 service.ts 未暴露读取它的接口，
// 因此无法真正对齐；取小了会把「服务本来能解码」的文件提前拦成 FS_TOO_LARGE。
// 故取一个明显高于任何合理服务配置的值，业务上限交给服务用自己的 E_TOO_LARGE 判定
// （文案准确），这里只挡住 GB 级文件被整读进内存的真实内存风险。
const ENC_READ_MAX_BYTES = 64 * 1024 * 1024

// 取解码服务：拿不到或不是本服务（同名被别的插件占了）时返回 null。
// 不写进 inject——那是硬依赖，会让本插件在没装 dsh-fs-encoding 时一直等待服务出现。
function getFsEncodingService(ctx) {
  try {
    const svc = ctx.get(FS_ENCODING_SERVICE)
    if (!svc || typeof svc !== 'object') return null
    // 能力判定而非 instanceof：同名服务可能由别的插件提供，直接调它的方法会抛
    if (typeof svc.tryDecode !== 'function') return null
    return svc
  } catch (e) { return null }
}

// 「服务在场但没有 recordedEncoding」的告警，**进程内只发一次**。
// 服务侧 README 明确要求：能力缺失应当告警，不能静默降级——它与「本会话确实没读过该文件」
// （recordedEncoding 返回 undefined，属正常状态）是两回事，前者可由运维升级插件解决。
// 只在进程内告警一次：这条路径每次预览都会走到，逐次告警会淹没日志。
//
// 文案只说「该实例没有这个方法」这一**可验证的事实**，不断言「升级即可恢复」：本插件不
// import 该服务、也拿不到它的版本号，无法知道是否存在可升级的版本（实测 npm 上就长期没有
// 带该方法的新版本）。断言一个运维无法执行的动作，比不提示更糟。
let warnedMissingRecordedEncoding = false
function warnMissingRecordedEncoding() {
  if (warnedMissingRecordedEncoding) return
  warnedMissingRecordedEncoding = true
  try {
    console.warn('[permgate] dsh-fs-encoding 的当前实例没有 recordedEncoding 方法：'
      + '非 UTF-8 文件的编辑/写入预览无法按工具实际使用的编码解码，将退回原报错。'
      + '（该只读出口由较新的 dsh-fs-encoding 提供；本插件不依赖它，功能降级但不影响正常使用。）')
  } catch (e) {}
}

// 取「某会话为该文件记录的编码」——dsh-fs-encoding 的 encoding memo 的只读出口。
//
// 为什么必须走它、而不是自己判定：edit / insert / str_replace_editor **没有** encoding
// 参数，它们的编码**完全**来自这份记录（tool-edit.js 调 readFile 时不传 encodingHint）；
// read 未指定时也回落到它（io.js 的 `opts.encodingHint ?? memo?.encoding`）。本插件若自行
// 判定，就可能落在另一页上，于是预览描述的文本与工具实际要改的文本不是同一份——而审批者
// 正是照预览决定是否放行。这正是"宁可不显示，也不显示一页可能是错的编码"的落点。
//
// 三重防御，缺一不可：
//   · **显式**能力判定 `typeof svc.recordedEncoding === 'function'`：本方法 1.4.0 才加入，
//     更早的实例没有它。服务侧推荐的写法是 `isFsEncodingService(svc, 'recordedEncoding')`，
//     但那是**模块级导出**、需要 import，而本插件把它当可选依赖、不 import，故按官方文档
//     给出的等价手写式判定（README：不能 import 的消费者手写
//     `typeof fsEncoding?.recordedEncoding === "function"`）。`!svc` 已先判，故此处不必再写 `?.`。
//   · 没有会话 id 就**不查**：recordedEncoding(undefined, …) 读的是「无 agent」匿名桶，那是
//     另一条记录；拿它当本会话的基准会张冠李戴。宁可退回报错。
//   · 整段 try/catch：消费方是别人写的插件，契约说它不抛，仍兜住以防契约变化。
//
// version 的语义（1.4.0 起，与早期工作树**相反**，是本次接口调整的重点）：
//   · 传 stat 拿到的当前版本 → 记录与文件版本不一致时服务返回 undefined。用的是与写盘
//     路径**同一个** isStale 比较，故预览与工具不会对「这条记录还算不算数」产生分歧。
//   · **省略该参数是 fail-closed**（仍走 isStale，未带版本的记录会被判不可用），不是
//     "跳过判定"。这正是我们要的：拿不到版本就如实当"无法确认"，别把记录当新鲜用。
//   · 只有显式传 `null` 才跳过判定。本插件**永不**传 null——那会让一条过期记录被当成
//     工具将要用的那一页，正是本功能要消除的失败。版本号本身是内部记账细节，不解析。
function recordedEncodingOf(ctx, sessionId, target, version) {
  try {
    if (typeof sessionId !== 'string' || !sessionId) return null
    const svc = getFsEncodingService(ctx)
    if (!svc) return null
    if (typeof svc.recordedEncoding !== 'function') {
      // 服务在场但没有这个方法 = 实例太旧（1.4.0 之前）。README 明确要求这种情形
      // **告警而不是静默降级**：它与「本会话确实没读过该文件」（recordedEncoding 返回
      // undefined）是两回事，前者可由运维升级插件解决，后者是正常状态。
      // 只在进程内告警一次：这条路径每次预览都会走到，逐次告警会淹没日志。
      warnMissingRecordedEncoding()
      return null
    }
    const rec = svc.recordedEncoding(sessionId, target, version)
    if (!rec || typeof rec !== 'object') return null
    const encoding = typeof rec.encoding === 'string' && rec.encoding ? rec.encoding : null
    if (!encoding) return null
    const d = rec.decided
    // provenance 白名单：只接受服务文档列出的四个取值（DecodeProvenance），别的一律当
    // "未知"（null），由调用方按"未经服务"处理——不编造一个来源。
    const decided = (d === 'utf8' || d === 'bom' || d === 'hint' || d === 'guessed') ? d : null
    return { encoding, decided }
  } catch (e) { return null }
}

// 预览用文本读取：UTF-8 优先（走原有 fsService.readText，快且不依赖服务）；
// 失败时若解码服务在场，则改走「字节读 + 交给服务判定」。
//
// target 必须是**已解析的 target 对象**（statTargetChecked 或 fsService.resolve 的返回值）：
// ctx.fs 的字节/文本接口都要求已解析的 target，传路径字符串会抛
// "path argument must be of type string"。
//
// size 可选：调用方已 stat 过时传入 info.size，用于在整读前先做体积预检——
// 避免为一个注定超限的文件先付出一次完整读盘（readText 的失败判定本身已整读一次，
// 不预检则 readBytes 会再整读一次，峰值达文件大小的两倍）。
//
// 返回 { ok:true, text, encoding, decided } 或 { ok:false, error }。
// decided 取值：'utf8'（本就 UTF-8）/ 'bom'|'hint'|'guessed'（服务给出）/ null（未经服务）。
// encodingHint：工具自己透传的解码方式（read 的 encoding 参数；非空字符串时按它解，跳过猜测）。
// recorded：该会话为该文件记录的编码（recordedEncodingOf 的返回值，或 null）。
//   有它时必须按它解码——edit/insert 的编码**完全**来自这份记录，本插件自行判定就可能落到
//   另一页上，预览描述的文本与工具要改的文本就不是同一份。没有它则维持原有行为（服务自行判定）。
// 本函数**不做编码决策**：要么按调用方透传的编码解，要么把服务的判定/拒绝原样带出。
async function readPreviewText(fsService, target, encService, size, encodingHint, recorded) {
  const readText = async (t) => {
    try { return { ok: true, text: await fsService.readText(t) } } catch (e) { return { ok: false, error: e } }
  }
  // 基准编码（预览的磁盘侧口径）必须与工具会用的是**同一页**：
  //   · 工具透传的 encoding 优先（read 的 "Reopen with Encoding" 语义，工具就按它解码）；
  //   · 其次会话为该文件记录的编码（edit/insert/write 的编码完全来自它）。
  // 基准不是 UTF-8 族时，**必须**绕开 ① 的直通走服务：直通只判「字节是不是合法 UTF-8」，
  // 而这两个问题不等价。基准为 gbk 的文件其字节完全可能正是合法 UTF-8（AI 用
  // read(encoding:'gbk') 读过一个 ASCII/双合法文件就会这样——服务的 hint 分支无条件胜过
  // UTF-8 校验），此时直通会把内容当 utf-8 展示，而工具按 gbk 解码。两侧不一致正是本插件
  // 要防的，故这里以基准为准，而不是以字节像不像 UTF-8 为准。
  //
  // 判定只看**基准**，不看单一来源：曾经只按「记录」判 forceService，而 ③ 段按「透传优先」
  // 取解码编码——同一个「该不该走直通」的决策被写成两份口径且互相矛盾，于是「AI 指定了
  // 编码、会话记录仍是 utf8」时直通短路、服务一次都不调，预览按 utf-8 展示而工具按指定
  // 编码解码（正是本函数要消除的脱钩），且 decided='utf8' 还会让客户端连编码徽标都不显示。
  const recEnc = recorded && typeof recorded.encoding === 'string' && recorded.encoding ? recorded.encoding : null
  const hintEnc = (typeof encodingHint === 'string' && encodingHint) ? encodingHint : null
  const baseEnc = hintEnc || recEnc
  // 编码名归一化只用于判「是不是 UTF-8 族」，口径与服务 normalizeEncoding 一致
  // （trim + 转小写 + 去 - _ 空格）。本插件不 import 该服务，故这里**不**承担「识别任意
  // 编码」的职责：认不出的一律按「需要服务」处理——走服务只会更准确，不会更差。
  const isUtf8Name = (enc) => {
    if (typeof enc !== 'string') return false
    const k = enc.trim().toLowerCase().replace(/[-_\s]/g, '')
    return k === 'utf8' || k === 'utf8bom'
  }
  // 解码服务**缺席**时不强制走服务：那时无从按基准解码，退回直通（与引入本功能前的行为
  // 一致）——宁可按 UTF-8 尽力显示，也不把一个本来能读的文件变成「缺插件」的报错。
  const forceService = !!baseEnc && !isUtf8Name(baseEnc) && !!encService
  // ① UTF-8 正常路径：绝大多数文件走这里，且不需要任何服务。
  // 这里也要查 NUL：ctx.fs 的 readText 只对**前 8192 字节**采样判二进制
  // （dsh-fs-local 的 BINARY_SAMPLE_BYTES），NUL 落在采样窗口之后时它会成功返回一段
  // 含 U+0000 的文本。若不在这里查，同一份含 NUL 的内容会因 NUL 的位置不同而行为不同
  // （窗口内→被 readText 拒→走服务路径→被下面的检查拦下；窗口外→直接放行并渲染）。
  // 两条路径口径统一，判据也一致：解出的文本含 U+0000 即按二进制处理。
  const direct = forceService ? { ok: false, error: null } : await readText(target)
  // 「读取失败」文案的统一出口：forceService 时 direct.error 恒为 null（我们根本没试直通），
  // 而 readFail(null) 会渲染成字面量「读取失败: null」——审批者据此既看不到真实原因，
  // 也无法区分「按基准解码后是二进制」与「服务出错」。故各回退点统一经此出口，按
  // 「直通的原因 → 本次调用的原因 → 通用文案」依次回落，**绝不**把 null 交给 readFail。
  // 顺序上直通原因优先，是为了让非 forceService 路径的错误文案与引入本功能前逐字一致。
  const failFromDirect = (e) => readFail(direct.error || e || new Error('not decodable text'))
  if (direct.ok) {
    const t0 = String(direct.text == null ? '' : direct.text)
    // 文案与 ctx.fs 的二进制拒绝保持一致（用户看到的语义是「这是二进制，不预览」）
    if (t0.indexOf('\u0000') !== -1) {
      const dp0 = (target && typeof target.displayPath === 'string' && target.displayPath) || 'file'
      return { ok: false, error: readFail(new Error('cannot read "' + dp0 + '": binary file')) }
    }
    return { ok: true, text: t0, encoding: 'utf-8', decided: 'utf8' }
  }
  // ② 非 UTF-8：只有解码服务在场时才继续。没有就维持原报错（不猜）。
  // 注：forceService 已要求服务在场，故走到这里时 direct.error 一定来自真实的 readText 失败
  // （直通的原因），failFromDirect 会如实带出它。
  if (!encService) return { ok: false, error: failFromDirect(null) }
  // 已知体积且已超本插件的硬保护上限：直接给「文件过大」文案，不再整读一次
  // （readBytes 也会以 FS_TOO_LARGE 拒绝，这里只是省掉那次无用的整读）
  if (typeof size === 'number' && size > ENC_READ_MAX_BYTES) {
    return { ok: false, error: bi('文件过大，无法生成对比', 'File too large to compare') }
  }
  let bytes = null
  try {
    // 必须显式传 maxBytes：契约里它是必填的整文件上限（dsh-fs-local 的预检是
    // info.size > maxBytes，漏传时该比较恒为 false，createReadStream({end: undefined})
    // 会一路读到 EOF）——漏传等于让任意大小的文件被无界整读进内存，而 readText
    // 的失败判定本身已经整读过一次，峰值会是文件大小的两倍。
    //
    // 这个值只作**本插件的内存硬保护**，不承担业务判定：服务的 maxFileBytes 是可配置的
    // （配置文件 / DSH_FS_ENCODING_MAX_FILE_BYTES，默认 10MiB），而 service.ts 没暴露
    // 读取它的接口，所以无法真正对齐。取一个明显高于任何合理服务配置的值（64MiB）：
    // 服务配得更大时不会被我方提前拦截（业务上限交给服务用自己的 E_TOO_LARGE 判定，
    // 文案准确）；同时仍挡住「GB 级文件被整读进内存」这种真正的内存风险。
    bytes = await fsService.readBytes(target, undefined, ENC_READ_MAX_BYTES)
  } catch (e) {
    // 字节读失败要**带出自己的原因**，不能退回 direct.error（那是 readText 的
    // invalid UTF-8 text）——那会把「文件太大」谎报成「编码读不出」，审批者据此
    // 去查编码却查不到真实原因。
    //
    // 但体积超限要单独走项目既有的「文件过大」口径，不能把 FS_TOO_LARGE 的原始
    // message 直接抛给用户：它形如 `cannot read "<绝对路径>": 73400316 bytes exceeds
    // the 67108864-byte limit`，会把本插件的**内部内存保护上限**当成对用户有意义的
    // 业务信息展示出来（那是实现细节，且与别处 `bi('文件过大…')` 的口径不一致）。
    if (e && e.code === 'FS_TOO_LARGE') {
      return { ok: false, error: bi('文件过大，无法生成对比', 'File too large to compare') }
    }
    return { ok: false, error: readFail(e) }
  }
  // 字节读返回了不可用的值（null / 无 length 的对象）。真实 dsh-fs-local 的 readBytes
  // 恒返回 Buffer（空文件也是 length=0 的真值 Buffer），故这条对真实实现不可达，是防御；
  // 但文案要与上面的 catch 保持同一原则——带出「字节读不可用」而非退回 readText 的错误
  // （后者会把「读不到字节」说成「编码读不出」，审批者据此查编码却查不到真实原因）。
  if (!bytes || bytes.length === undefined) return { ok: false, error: readFail(new Error('byte read returned no content')) }
  // 交给服务解码的单次调用（opts 组装单点）：displayPath 只在非空字符串时放入，
  // encoding 只在调用方显式指定时放入——两者都必须"缺席"而不是传 null/undefined 之外
  // 的假值，服务对 opts 做严格校验（见下方注释）。
  const dp = target && typeof target.displayPath === 'string' && target.displayPath ? target.displayPath : null
  const callDecode = async (encoding) => {
    const opts = {}
    if (dp) opts.displayPath = dp
    if (typeof encoding === 'string' && encoding) opts.encoding = encoding
    // 服务文档承诺 tryDecode 对任意输入都不抛（refusal 是返回值），故这里不需要
    // 包一层 catch；但消费方是别人写的插件，仍兜住以防契约变化。
    return Object.keys(opts).length ? await encService.tryDecode(bytes, opts) : await encService.tryDecode(bytes)
  }
  // ③ 单次解码。优先级：
  //   ① 工具自己透传的 encoding（read 的 "Reopen with Encoding" 语义，工具就按它解码）；
  //   ② 会话为该文件**记录的**编码（edit/insert 的编码完全来自它；read 未指定时也回落到它）；
  //   ③ 都没有 → 交给服务自行判定（服务拒绝就把说明原样带出，见 ④）。
  //
  // 本插件**不做编码决策**，这条是刻意的：曾经在服务拒绝（E_NOT_TEXT，猜测关闭）时用
  // refusal.candidates[0] 回灌一次显式编码，好让非 UTF-8 文件在审批详情里有内容可看。
  // 那等于本插件替用户挑了一页编码，而工具真正写盘用的是它**自己的编码记录**
  // （dsh-fs-encoding 的 encoding memo：io.js 里 `opts.encodingHint ?? memo?.encoding`）。
  // 于是预览可能是 A 页、写盘按 B 页，而审批者正是照这段预览判断是否放行——比"没有预览"
  // 更危险。现在只认**工具会用**的那一页：工具透传的参数，或它将要读取的那份记录。
  const wantEncoding = (typeof encodingHint === 'string' && encodingHint) ? encodingHint : recEnc
  let out = null
  try {
    out = await callDecode(wantEncoding)
  } catch (e) {
    // 带出**本次调用**的原因：forceService 下 direct.error 为 null，退回它会显示
    // 「读取失败: null」，把「服务抛了」谎报成空原因。
    return { ok: false, error: failFromDirect(e) }
  }
  // ④ 拒绝原样带出。候选编码（refusal.candidates）不再下发：没有切换 UI 就不需要它，
  // 而留着它只会诱使调用方再去做一次本插件无权做的编码决策。
  if (!out || out.ok !== true || !out.result) {
    const refusal = out && out.refusal
    // 服务自己的体积超限要走项目既有的「文件过大」口径，不能把它的 message 原样抛给用户：
    // 那句是**对模型说的**（"Raise maxBytes (or the plugin's maxFileBytes) to decode it."），
    // 且内含服务的内部上限数字（默认 10485760），对审批者既无意义又与本插件 297 行的
    // 处理自相矛盾（同一个上限数字只是换了个来源照样进弹窗）。
    if (refusal && refusal.code === 'E_TOO_LARGE') {
      return { ok: false, error: bi('文件过大，无法生成对比', 'File too large to compare') }
    }
    // E_BAD_ENCODING 是**我方调用参数**的问题（opts 类型/字段非法），不是这个文件的问题，
    // 它的 message（如 "displayPath must be a string"）对审批者毫无意义——展示它等于把
    // 本插件的 bug 说成文件的错。退回 ctx.fs 的原始报错（即改动前的行为）。
    // 这里必须**自己记日志**：调用链上 4 个调用点都是返回值传递、不会进入任何 catch，
    // 路由的 console.error 只在 buildFileDiffData 抛出时触发，此路径永不抛出——
    // 不记日志的话，我方 opts 参数错误会在用户侧伪装成「读取失败」而运维侧零线索。
    if (refusal && refusal.code === 'E_BAD_ENCODING') {
      try { console.error('[permgate] fsEncoding rejected our opts:', refusal.message) } catch (e) {}
      return { ok: false, error: failFromDirect(null) }
    }
    // 其余拒绝（E_NOT_TEXT 二进制 / 猜测关闭）：把服务的说明原样带出——
    // 它比 ctx.fs 的 invalid UTF-8 text 更准确（能区分「没尝试猜」与「猜了但失败」）
    const msg = refusal && refusal.message ? String(refusal.message) : (direct.error && direct.error.message) || 'not decodable text'
    return { ok: false, error: { zh: msg, en: msg } }
  }
  const r = out.result
  const text = String(r.text == null ? '' : r.text)
  // readText 的失败原因不只是编码：ctx.fs 还会以「NUL 采样命中」拒绝二进制文件，
  // 而某些字节序列恰好是合法 UTF-8（ASCII 与 NUL 交替），服务会把 NUL 原样解出来。
  // 这类内容不可预览——既不能当文本展示，也不该替换掉原本明确的「binary file」报错。
  //
  // 判据只看「解出的文本是否含 U+0000」，**不按 decided 豁免**。曾经的写法是
  // 「只对未做编码转换的结果（decided==='utf8'，后加 'bom'+UTF-8 族）施加检查」，
  // 理由是「guessed 时服务真的解出了文本，不该推翻」——这个理由不成立：
  // 猜测路径的语义是「在候选编码里挑一个能解通的」，而单字节编码
  // （windows-1251/iso-8859-1 等）能把**任意字节**映射成字符，所以二进制必然「解通」。
  // 那不是成功解码，是兜底映射：实测 autoGuessEncoding=true 时一个 MZ 头二进制被解成
  // windows-1251/guessed 且满是 U+0000，会被放行并当文件内容渲染。
  //
  // 判据的依据是**单向蕴含**：解出文本含 U+0000 ⟹ 输入含 0x00 字节 ⟹ 二进制或损坏文件。
  // （实测：对全部编码做 1 字节 0x01–0xFF 与全部 2 字节非零组合穷举，无任何非零输入产出
  // U+0000，故蕴含方向成立。补充：0x00 在单字节编码与多字节编码下都产出 U+0000；仅
  // UTF-16/32 对**孤立**的单字节 0x00 例外——utf16le/utf16be 在服务层被
  // isAcceptableDecode 拒为 E_DECODE_FAILED（decodeBytes 层给 U+FFFD），utf32le/utf32be
  // 返回空串，那是码元不完整的处理。该例外只影响孤立字节的穷举结论，不影响上面的单向
  // 蕴含——注意**不能**反过来用「0x00 成对出现」论证安全：UTF-16LE 里 0x00 恰恰是成对的
  // 高字节（如 [41 00] → "A"），成对出现正是反向不成立的原因，见下。）
  // 反向**不成立**，这是本判据的已知残余缺口：UTF-16/32 解码会把 0x00 字节吸收进
  // 码元，故「UTF-16 BOM 前缀 + 二进制体」若每个 16 位单元的高字节非零，解出的文本
  // 不含 U+0000 而会被放行（实测 FF FE + 随机体 → utf16le/bom，无 NUL）。
  //
  // 缺口暴露面**不小**（实测 UTF-16 BOM + 随机字节经本函数的放行率）：1KB≈100%、
  // 4KB≈97%、64KB≈63%、256KB≈13%、~590KB 才降到 ~0%。即只有「恰好以 UTF-16 BOM 开头」
  // 这一条件较苛刻（对随机二进制约 1/65536），一旦满足，中小型二进制**大多会被当文本渲染**。
  // 未为此再加「像文本」闸的原因：这类内容解出的是乱码，审批者能自行看出不是正常文本，
  // 风险是观感而非误判放行；而加闸需要设计可打印性阈值，误伤合法 UTF-16/32 的代价更高。
  // 若日后要收紧，应对 decided==='bom' 的结果另加可打印性检查，而**不能**用「字节含
  // 0x00」一刀切——合法 UTF-16/32 文本的字节里全是 0x00，那正是本功能存在的理由。
  // 这不会误伤合法文本：实测各 UTF BOM 变体（utf16le/utf16be/utf32le/utf8bom）与
  // GBK/Big5/Shift-JIS 的正常文件解出的文本都不含 U+0000。
  if (text.indexOf('\u0000') !== -1) {
    // 文案要与直通路径的二进制拒绝同口径（用户看到的语义是「这是二进制，不预览」），
    // 而 forceService 下 direct.error 为 null，不能退回它（会显示「读取失败: null」）。
    const dp1 = (target && typeof target.displayPath === 'string' && target.displayPath) || 'file'
    return { ok: false, error: readFail(new Error('cannot read "' + dp1 + '": binary file')) }
  }
  // decided 的取值，按「这次解码是谁定的」如实标注：
  //   · 工具透传了 encoding → 'hint' 是服务给的正确标注（调用方指定了编码），原样透传；
  //   · 用**记录**里的编码解 → 服务只会回 'hint'（"调用方指定了编码"），但那一页不是本插件
  //     或调用方定的，而是**记录**里的。记录自带真实 provenance（'guessed' 表示当初是猜的），
  //     必须用它覆盖，否则一条猜测记录会被呈现成确定编码——审批者正是照这段预览决定是否
  //     放行，把猜的显示成确定的正是本插件要防的。这正是 recordedEncoding 返回 decided 的
  //     理由（服务文档：重解码拿不回真实 provenance）。
  //   · 服务自行判定（无透传、无记录）→ 原样透传（'guessed' 时客户端显示「?」与警告）。
  // usedRecord 时若记录没给出可识别的 provenance（recordedEncodingOf 只放行服务文档列出的
  // 四个取值），退回 'guessed' 而**不是** r.decided：后者恒为 'hint'（"调用方指定了编码"），
  // 而这一页既不是调用方定的、来源又未知——把它说成确定的就是本插件要防的"把猜测当事实"。
  // 宁可多显示一个「?」，也不能让审批者以为这一页已经确定。
  const usedRecord = !(typeof encodingHint === 'string' && encodingHint) && !!recEnc
  const decided = usedRecord ? (recorded.decided || 'guessed') : (r.decided || null)
  return { ok: true, text, encoding: r.encoding || null, decided }
}

export default {
  inject: ['fs', 'sandboxPolicy', 'tools', 'webServer', 'timer', 'approval', 'permissionPresets', 'sessions'],
  apply(ctx) {
    const fs = ctx.fs
    const sp = ctx.sandboxPolicy
    const disposers = []
    const onDispose = (fn) => disposers.push(fn)
    ctx.effect(() => () => { for (let i = disposers.length - 1; i >= 0; i--) { try { disposers[i]() } catch (e) {} } })

    // 部署级工作区根（无会话可依时的回落）。必须保证非空：isOutside 对空根判定为
    // 「非工作区外」，会让工作区外路径跳过目录闸（fail-open）。sp.workspaceRoot 理论上
    // 恒有值，但拿不到时退到进程 cwd，宁可判宽也不留空串。
    // norm 会剥掉全部尾部分隔符：`/`、`//`、`\` 都归一到空串，故 norm(process.cwd()) 同样
    // 可能得空串（POSIX 容器 WORKDIR / 时 cwd 即 /）——末位再兜一个 '/'，确保恒非空。
    const fallbackRoot = norm(String(sp.workspaceRoot || '').replace(/[\\/]+$/, '')) || norm(process.cwd()) || '/'
    // target 是「配置文件路径」：配置按 DSH home 归属、对所有会话是同一个文件，
    // 故它作为模块级缓存是正确的（与按会话的工作区根不是一回事）。
    // targetBase 只用于 ensureTarget 的早退比较：记录 target 是依据哪个会话根派生的。
    let target = null
    let targetBase = null
    let loaded = false
    let agentRef = null
    let dshHomeCache = null
    // home 解析失败后的抑制窗口：load/persist 一次流程内会多次调用 resolveDshHome，
    // 失败即重试会导致每次调用都重新 spawn cmd 探测并刷错误日志
    let dshHomeFailAt = 0
    const HOME_FAIL_TTL_MS = 200
    let config = freshConfig()
    // 本次加载收敛掉的历史预设默认值键数（见 QUICK_RETIRED_DEFAULTS）：由 buildConfig 的
    // 返回值经 load 写入。刻意放在 config 之外——config 会被 JSON.stringify 整体落盘，
    // 把该计数挂在 config 上会让它变成配置文件里的一个字段，被下次加载读回并原样写下去。
    let retiredQuickDefaults = 0
    let loadError = null
    let saveError = null
    const decisions = []
    // 循环检测状态：每会话只存「上次静默放行的调用键 + 连续次数」。
    //
    // 这里曾经是一个全局数组 recent（push 调用键、超过 12 条从头截断），判定时从尾部回扫、
    // 遇不同键就 break。两个结构性缺陷：
    //   ① 全局共享 → A 会话连续 4 次，B 会话**第 1 次**同一调用就被牵连弹窗；
    //   ② 数组的窗口长度同时充当了 streak 的上限 → 「阈值 > 12」变成静默失效
    //      （故当时才需要 REPEAT_STREAK_MAX 来堵它，并产生「两常量必须联动」的约束）。
    // 而回扫只读**最后那段连续区**，更早的条目永远读不到（push 序列 A,A,B,B,B → 查 A 得 0），
    // 所以数组本身是纯冗余：实测对拍 270,000 次随机查询，数组实现与 (键,次数) 计数零不一致。
    // 换成按会话分桶的 (键, 次数) 后，① 由分桶解决，② 从根上消失（计数能数到任意大），
    // 于是 REPEAT_STREAK_MAX 与「窗口」一起被删掉 —— 简化即修复。
    const streakBySession = new Map()
    const pendingApprovals = new Map()
    // SSE 订阅者：/permgate/events 长连接的响应对象集合（状态/待审批变化即推）
    const sseClients = new Set()
    // 沙箱升级跟踪：{token: {session, prev}}，工具执行完成后写回原沙箱（一次性升级）
    const upgradedCalls = new Map()
    // 客户端最近请求的语言（zh/en），用于宿主即时文案（弹窗标签、升级审批提示）
    let uiLang = 'zh'
    // 例外爆炸半径的**按模式文本记忆化**（statusView 每次都要现算，而例外文本无长度上限）。
    //
    // 为什么需要：exceptionBlast 对每条 allow 例外最多做 2 次 decomposeCommand（两门方言）
    // + 判档，而 statusView 由 GET /permgate/status、每次 SSE status/refresh、各写盘路由回带、
    // perm_status 工具反复调用 —— 一条长例外（候选值把整段原文无截断落盘）就让面板每次刷新
    // 重付几十毫秒。实测 60000 个参数（649 KB）单条 164.6 ms。
    //
    // 键是**模式文本**（判档的唯一输入）＋ root（root 影响 isOutsideWorkspace，
    // 同一次进程内 root 会随会话变化，故必须进键）。
    //
    // ── 不用「按条数 FIFO 淘汰」────────────────────────────────────────────────
    // 这里曾经是「Map 满 500 就删最旧再插入」。那个策略在 key 数 > 上限时**命中率恒为 0**：
    // 每次 get 未命中 → 插入前先删掉最旧的一条（很可能正是自己上一轮插入的），于是缓存
    // 等于不存在。插桩实测（同一进程、只改例外条数）：n=500 → hit 500 / miss 0；
    // n=501 → hit **0** / miss 501；n=1000 → hit 0 / miss 1000，且多轮 statusView 后仍是全 miss。
    // 而 key 空间 = 例外数 × 会话根数，8 个会话根 + 63 条例外（504 keys）就会触发 ——
    // 即「多项目 + 中等例外数」这一常见配置下，注释声称要消除的开销原封不动地留着。
    //
    // 改为**按配置世代失效**：配置变化时整体 clear()（见 invalidateBlastMemo 的调用点）。
    // 例外是配置派生的、只在写盘/reload 时变化，故世代失效既不会读到陈旧结论，
    // 也不会像条数淘汰那样在正常规模下自废武功。上限仍保留一个**远高于实际规模**的
    // 兜底（防止极端情况下无界增长），取 20000：达到它意味着配置里有两万条不同例外，
    // 那时真正的瓶颈是配置文件本身而不是这张表。
    const blastPatternMemo = new Map()
    const BLAST_PATTERN_MEMO_MAX = 20000
    // 配置世代失效：任何一次写盘（persist）与 reload 之后调用。
    // 只清空、不重建：下次 statusView 现算即可，正确性不依赖缓存内容。
    function invalidateBlastMemo() {
      if (blastPatternMemo.size) blastPatternMemo.clear()
    }

    function norm(p) {
      // 尾部分隔符剥离用**线性 while**，不能写 `.replace(/\/+$/, '')`：V8 对该正则在
      // 「一段连续斜杠 + 非斜杠结尾」的输入上呈平方增长（`\/+$` 在每个起点回退后重新扫描
      // 整段连续斜杠）。实测单次 replace：n=10000 → 21.6 ms、20000 → 100.6 ms、
      // 40000 → 389.2 ms（倍率≈4.0，标准平方），而 while 版本 n=40000 时 0.005 ms。
      //
      // 这里必须与 shell-parse.js 的 blastRadiusOf 同步修：那里也做了一次同样的剥离，
      // 但它把**未归一的原文**交给本文件的 isOutside → norm，于是那处优化被这一跳绕过 ——
      // 实测端到端 `rm -rf <40000 个斜杠>x`（39 KB）仍是 382.7 ms，且它在判定热路径
      // （tools/pre-execute）的逐词元循环里，词元长度由 AI 生成、无上界，挂起即该次调用不返回。
      // 修在本函数一处即可覆盖全部调用点（isOutside / dirGlob / recordDecision …）。
      let s = String(p).replace(/\\/g, '/')
      let end = s.length
      while (end > 0 && s.charCodeAt(end - 1) === 47) end -= 1
      return end === s.length ? s : s.slice(0, end)
    }

    // ── 工作区根的唯一派生点 ────────────────────────────────────────────────
    // root 曾经是一个模块级闭包变量，由 ensureTarget 在每次 init(exec) 时按当前 exec 的
    // cwd 覆写。那是跨会话共享的可变单例：A 会话在 await 期间 B 会话 init，A 随后读到的
    // 就是 B 的根。实测危害分两类：
    //   ① 写盘归属：addProjectException 走 projectBlock()/ensureProject()，例外会写进
    //      别的项目块（用户实测「在 proj-alpha 点的，写到了 MCP 项目里」）。
    //   ② 安全判定：isOutside 的 6 个调用点里 4 处在 decide()。root 漂移到「包含目标」
    //      的位置时判定翻转为 false，工作区外路径被判成区内、直接跳过目录闸（fail-open）。
    // 故 root 一律由调用方从自己的会话上下文显式取得，不再有全局状态：
    //   · 工具执行链 → rootOf(exec)
    //   · 审批落盘   → entry.projRoot（审批发起时的快照：弹窗可能挂起很久、期间会切会话）
    //   · HTTP 路由  → rootOf(该请求的 exec)（路由入口已按 sessionId 解析）
    // 返回恒为非空串：空串会让 isOutside 判「非区外」（fail-open），故兜底到 fallbackRoot。
    function rootOf(exec) {
      try {
        const session = exec && exec.agent && exec.agent.session
        const cwd = session && session.header && session.header.cwd
        // 必须先归一化再判空：norm 会剥掉尾部分隔符，cwd 为盘根形态（'/'、'//'、'\'）时
        // 归一化结果为 ''。若按原文判空就直接 return norm(cwd)，会返回空串绕过下面的兜底，
        // 而 isOutside 对空根判「非工作区外」（fail-open）→ 工作区外路径跳过目录闸。
        const n = typeof cwd === 'string' && cwd ? norm(cwd) : ''
        if (n) return n
      } catch (e) {}
      return fallbackRoot
    }

    // 路径规范化单点：相对路径先按 root 绝对化，再折叠 .. 与重复分隔符。
    // glob/norm/globToRegExp 都不折叠 ..，仅规范化写入侧会让例外永不命中参数原文。
    // root 由调用方显式传入（见 rootOf 注释）：这是「同一条例外在三处同答案」的前提，
    // 否则判重、写入、匹配会各自按不同的根绝对化。
    function normAbsPath(p, root) {
      const s = norm(p)
      if (!s) return s
      // glob 不是文件路径：绝对化会改变匹配范围（`**/*.env` 会被拼成 `X:/ws/**/*.env`，
      // 从「任意目录」缩成「仅工作区内」），故只做斜杠归一，不绝对化也不折叠 ..。
      // 与 hasGlobMeta 同口径：只认 * 与 ?（[ ] 在 globToRegExp 里是字面量，不是通配符）。
      if (/[*?]/.test(s)) return s
      // file:// 等 URL 形态不是文件系统路径，原样返回（与 resolveArgPath 同口径）
      if (s.indexOf('://') !== -1) return s
      const isAbs = s.indexOf('/') === 0 || /^[a-zA-Z]:/.test(s)
      const base = root || fallbackRoot
      const abs = isAbs ? s : norm(base + '/' + s)
      if (!abs) return s
      return norm(pathResolve(/^[a-zA-Z]:$/.test(abs) ? abs + '/' : abs))
    }

    // 路径同一性键：判重、写入去重、匹配三处共用同一口径，保证「同一条例外」在三处同答案。
    // 必须基于 normAbsPath（绝对化 + 折叠 ..）而非裸 normPathKey，否则候选写入的规范值
    // 与面板/工具入口写入的相对路径或含 .. 原文会被当成两条不同例外。
    function pathKey(p, root) {
      return normPathKey(normAbsPath(p, root))
    }

    function safeJson(v) {
      try { return JSON.stringify(v) } catch (e) { return '' }
    }

    function freshConfig() {
      const g = { quickTools: {}, custom: [], sandboxMode: 'danger-full-access', fallbackMode: 'ask' }
      for (const c of CATS) g[c] = freshCategory(c, false)
      for (const k of Object.keys(QUICK_DEFAULTS)) g.quickTools[k] = { action: QUICK_DEFAULTS[k] }
      // 新建配置：历史默认值收敛无对象可收敛（本来就用新默认值 seed），
      // 直接把它标记为已跑过，避免首次加载白跑一次迁移判定。
      return { migrations: [RETIRE_QUICK_DEFAULTS_MIGRATION], global: g, projects: {} }
    }

    function freshProject() {
      const pb = { quickTools: {}, custom: [], sandboxMode: 'inherit', fallbackMode: 'inherit' }
      for (const c of CATS) pb[c] = freshCategory(c, true)
      return pb
    }

    function freshCategory(key, inheritDefault) {
      // 默认 ask：不可逆/越界/涉及外部执行或输入的分类（含读图）从严。
      // 默认 allow：read/subagent 这类只读或可回收的，以及 undo。
      //
      // undo 默认 allow 的**影响面**：这里是「配置里没有该键」时的回落值，而 normalizeCategory
      // 对缺键形态正是回落到它，故它作用于**所有未显式设置过 undo 的配置** —— 不只是新建配置。
      // undo 分类是 v1.4.0 才引入的，从更早版本（无 undo 键）直升的存量配置同样吃这个默认值，
      // 且随后任何一次 persist 都会把 allow 固化。需要 undo 每次确认的用户须显式设为 ask。
      //
      // 这个默认值是一个**取舍**，不是「撤销无害」的结论：两个撤销实现的破坏面不同 ——
      //   dsh-fs-encoding：记录只在进程内存、按 session 分桶，且文件被改动后直接拒绝，破坏面受限；
      //   dsh-better-edit：记录落盘 sqlite（undo 表以 path 为主键，无 session 维度）、按 workspace
      //     共享、跨会话、TTL 7 天 —— 同 workspace 的新会话可无弹窗回退到别的会话 7 天内的旧状态。
      // 即 allow 下这条写路径没有用户可见的检查点（不弹窗即无 diff 预览）。取 allow 是因为撤销
      // 恢复的是「既有内容」、不接受调用方提供的新内容，破坏方向有限；认定该风险不可接受时，
      // 把 undo 显式设为 ask 即可恢复逐次确认。
      const cat = { mode: inheritDefault ? 'inherit' : (key === 'directory' || key === 'command' || key === 'edit' || key === 'image' || key === 'doomloop' ? 'ask' : 'allow') }
      if (EXC_CATS.indexOf(key) !== -1) cat.exceptions = []
      // command 分类的子设置「破坏性命令」：判定链是 例外 → 子设置 → 分类默认值，
      // 子设置比大分类「知道得更多」（它认识 rm/dd/chmod 这些具体命令名），
      // 故更细的判定优先于更粗的判定 —— 大分类设为 allow 时破坏性命令仍按子设置走。
      // 默认 ask 是**修复一个失效的原有意图**（旧 DANGEROUS_CMD_RE 只在快速通道上生效，
      // 够不到大分类 allow 这条路径），不是新增一层；用户可显式设为 allow 回到原行为。
      //
      // **这里不种 destructive 默认值**：freshCategory 的产物会经 ensureProject/freshProject
      // 落盘，种下的值就成了一条「用户表态」。项目层种的是 inherit，读取侧看到「本层有表态」
      // 便穿透全局 —— 用户在面板把「本项目命令」设为拒绝时，破坏性命令反而按全局 ask 弹窗
      // （实测过：面板写 → rm 待批；同意图手写配置 → deny）。档位缺省值统一由读取侧
      // destructiveTiers 按「项目显式 → 全局显式 → ask」取值 —— **与 command mode 无关**，
      // 落盘只承载用户显式写下的值。
      return cat
    }

    // ── 这里曾经有第二个「八档默认值」实现：`destructiveTierDefaults`（已删）──────────
    // 它按**本层 command mode** 现算档位缺省值：`inside` = 本层 mode 本身，其余七档
    // = `strictest(ask, inside)`。它的唯一用途是守住「存量 `destructive:{action:'deny'}` +
    // mode=allow 的用户，七档不得从 deny 掉到 ask」这一件事。
    //
    // 那套规则已按用户要求删除（依据 .plan/blast-tier-design.md：八档平级、不考虑旧配置
    // 迁移兼容，且该文档**明确否定**了「子设置默认值不得宽于本层 mode」这条语义）。
    // 现在档位缺省值**只有一份实现** —— `destructiveTiers` 的「项目显式 → 全局显式 → ask」，
    // 也就是裁决链真正用的那一份。曾经并存的第二份实现会让同一份配置在
    // 「面板/AI 看到的默认值」与「实际裁决用的值」之间逐档分叉，故整块删除而不是留着对比：
    // 两份真相本身就是缺陷来源（详见 destructiveTiers 处的说明）。
    //
    // ⚠️ 唯一必须保住的意图是**反向**那一半，它由 `destructiveTiers` 的末级兜底承担：
    // 大分类 allow 时档位缺省仍是 ask（若跟着 mode 变成 allow，就等于把破坏性命令静默放行，
    // 正是 D-6 要修的那个洞）。**不要把「按 mode 推导」以任何形式加回来**。

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
      // note 就只是一句备注。它会不会被 AI 读到、算不算隐私问题——明确不管，不作为议题。
      if (r.action === 'deny') { const t = normalizeText(r.reason); if (t) e.reason = t }
      if (r.action === 'ask') { const t = normalizeText(r.note); if (t) e.note = t }
      if (key === 'command') e.match = value
      else e.path = value
      return e
    }

    // command 分类子设置「破坏性命令」的归一化：动作值走 MODES/ALL_MODES（与 mode 同口径），
    // reason 只在 deny 时保留（allow 不弹窗、ask 有自己的备注，存了也读不到）。
    // 名单固定，不开放用户增删 —— 故**只认八个档位键与 reasons**，其余一律丢弃，
    // 老配置里手写的 labels/未知键不会被悄悄带进内存（否则「名单固定」只是界面上的约定）。
    //
    // 缺键或值非法时返回 **null**（不是补一个默认动作）：推导交给读取侧
    // （destructiveTiers），落盘只承载用户显式表态 —— 理由见 normalizeCategory 的注释。
    //
    // ── 存储形状（§7.1）────────────────────────────────────────────────────────
    //   { "action": "allow",              ← 老键义不变 = inside 档
    //     "outside": "ask", "wide": "deny", …,   ← 七个新档位键
    //     "reasons": { "wide": "删系统目录", "priv": "别提权" } }
    //
    // `action` 键义不变是**向后兼容的关键**：老配置原样可读，且旧客户端（不传 tier）
    // 写的就是它。新档位键与 `reasons` 都是**追加**，不改变任何既有键的含义。
    function normalizeSubSetting(raw, inheritDefault) {
      const r = raw && typeof raw === 'object' ? raw : {}
      const allowed = inheritDefault ? ALL_MODES : MODES
      const actionOk = allowed.indexOf(r.action) !== -1
      // ── 合法性判据：`action` 合法 **或** 至少有一个合法档位键 ──────────────────────
      // 「只写一档」是面板的**主用法**：档位下拉框只写 `sub[tier]`、根本不碰 `action`，
      // 故它必须与「写了 action」同样合法。曾经的判据只看 `action`，后果（两轨独立实测）：
      //   ① 面板写下的 `{"wide":"deny"}` 在下次加载时被整条丢弃（return null）
      //      → normalizeCategory 不设 cat.destructive → 用户的逐档设置**静默失效**、
      //      回落默认值（`rm -rf C:/Windows` 由 deny 变 ask）；
      //   ② 此后任意一次无关写盘（例如改 read 分类）会把内存配置整体序列化回磁盘，
      //      磁盘上那条 `{"wide":"deny"}` 被**永久抹掉**（destructive 变 undefined）。
      // 项目层同样复现。故「只写一档」必须是**合法**形态，而不是被丢弃的形态。
      const tierOk = TIERS.some((t) => t !== 'inside' && allowed.indexOf(r[t]) !== -1)
      if (!actionOk && !tierOk) return null
      const out = {}
      // `action` 缺失/非法 → **不补值**（不是补一个推导值）：缺键 = 本层未对 inside 表态，
      // 由读取侧 destructiveTiers 按「项目显式 → 全局显式 → ask」取值。补一个推导值会经
      // persist 落盘成「用户表态」，此后用户放松大分类时它还会粘住旧值（见 normalizeCategory 的注释）。
      if (actionOk) out.action = r.action
      // 七个新档位键：值域与 action 同口径（项目层额外接受 inherit）。
      // **不补推导值**：缺键就留空，由读取侧 destructiveTiers 补 ——
      // 补在这里会经 persist 落盘成显式键，那就把「推导值」变成了「用户表态」。
      for (const t of TIERS) {
        if (t === 'inside') continue          // inside 由 action 承载，不重复存
        if ((inheritDefault ? ALL_MODES : MODES).indexOf(r[t]) === -1) continue
        out[t] = r[t]
      }
      // per-tier 拒绝理由：只在**该档显式配成 deny** 时保留（与 action 侧同口径：
      // allow 不弹窗、ask 有自己的备注）。只认档位名做键，其余丢弃。
      const rawReasons = r.reasons && typeof r.reasons === 'object' ? r.reasons : null
      const reasons = {}
      for (const t of TIERS) {
        // ⚠️ 这一处是 `keyOfTier`（模块级映射单点）的**唯一强制内联副本**，不能改成
        // `out[keyOfTier(t)]`：本函数会被 test/regressions.mjs 抽取进 `new Function`
        // 独立求值（「子设置键集封闭」那条断言），注入的自由变量只有
        // MODES / ALL_MODES / TIERS / normalizeText —— 引用模块级符号会 ReferenceError，
        // 使该断言变红（已实测）。故**改 keyOfTier 的映射时必须同步改这一行**。
        // 语义等价：keyOfTier('inside') === 'action'，其余档 t → t。
        const explicit = t === 'inside' ? out.action : out[t]
        if (explicit !== 'deny') continue
        const txt = normalizeText(rawReasons ? rawReasons[t] : null)
        if (txt) reasons[t] = txt
      }
      // ── 存量 `reason` 字符串：**原样保留，不在这里搬家** ────────────────────────
      // 老配置是 `{ "action": "deny", "reason": "rm 危险" }`，语义是「整个破坏性类别」，
      // 它对应 `action` 键承载的那一档，即 `reasons.inside`。
      //
      // 但**读取侧兼容不等于写盘时搬家**（§7.1）：这里若把它搬进 `reasons`，
      // 一次纯加载就会改写用户配置文件的字节 —— 而「加载后字节不变」是既有纪律
      // （normalizeCategory 的注释与测试 44 都守着它）。搬家的代价还不止于此：
      // 用户看到自己的 `reason` 键在面板上消失、变成 `reasons.inside`，会以为是插件擅自改配置。
      //
      // 故：**这里原样保留 `reason`**，由读取侧 `destructiveTiers` 把它当作
      // `reasons.inside` 的兜底（`reasons.inside` 优先，它才是用户在新面板上填的那个）。
      if (out.action === 'deny') {
        const legacy = normalizeText(r.reason)
        if (legacy) out.reason = legacy
      }
      if (Object.keys(reasons).length) out.reasons = reasons
      return out
    }

    // doomloop 子设置「阈值」的归一化（L-3/L-7/L-8）。
    //   缺失 / 非数字 / 非有限 / ≤ 0 → **null（丢弃该键）**，由读取侧 doomloopSetting 推导默认值；
    //   非整数 → 向下取整后钳到下限 1；
    //   上限 → **不设**（窗口已删，计数能数到任意大，阈值多大都能触发，不存在静默失效）；
    //   项目层额外接受 'inherit'（穿透全局，与 mode 同口径）。
    //
    // 为什么非法值「丢弃」而不是落一个默认值：normalizeCategory 的产物会被 persist 整体序列化
    // 落盘，落一个 6 就等于把**推导值**变成**用户表态** —— 日后把默认阈值从 6 改成 8 时，
    // 这些配置不会跟随，且此后任何一次无关写盘都会把 6 固化。这与 destructive 子设置
    // 踩过的坑完全同构（见 normalizeCategory 的注释与 QUICK_RETIRED_DEFAULTS 的历史）。
    // 「关闭检测」不是把阈值写 0，而是把 mode 设为 allow —— 语义明确且在面板上有提示（G2-3）。
    function normalizeThreshold(v, inheritDefault) {
      if (inheritDefault && v === 'inherit') return 'inherit'
      if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null
      return Math.max(MIN_REPEAT_STREAK, Math.floor(v))
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
      // 子设置：**只保留用户显式写下的值**，缺键/非法值一律留空（不落 action）。
      //
      // 为什么不在这里补推导值（曾经的写法是 `normalizeSubSetting(c.destructive, …, 档位缺省值)`，
      // 其中缺省值由已删除的 `destructiveTierDefaults(mode)` 算出）：
      // normalizeCategory 的结果会被 persist 整体序列化落盘，于是**推导值会变成显式键**，
      // 而显式键在下次加载时会被当成「用户表过态」原样保留。两个后果都已实测复现：
      //   ① 面板把项目层 command 设为 deny 时，setCategoryMode 用 freshCategory 建块拿到
      //      `destructive: inherit` 并落盘 → 读取侧穿透到全局 ask → 用户的拒绝被旁路，
      //      而同意图手写配置文件（无该键）却能正确推导出 deny —— 同一意图两种结果；
      //   ② 存量 deny 配置加载后推导出 deny，任意一次**无关写盘**把它固化；此后用户把
      //      command 放松为 allow，子设置仍是 deny —— 放松不生效且重启后粘住。
      // 现在推导完全交给读取侧（destructiveTiers 的「项目显式 → 全局显式 → ask」），
      // 落盘只承载用户表态，幂等性恢复：destructive 的取值不再取决于「中间有没有发生过一次写盘」。
      if (key === 'command') {
        const sub = normalizeSubSetting(c.destructive, inheritDefault)
        if (sub) cat.destructive = sub
      }
      // doomloop 的阈值：与 destructive 同口径 —— **只保留用户显式写下的值**，
      // 缺键/非法值一律留空（推导交给读取侧 doomloopSetting）。理由见 normalizeThreshold。
      if (key === 'doomloop') {
        const th = normalizeThreshold(c.threshold, inheritDefault)
        if (th !== null) cat.threshold = th
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

    // applyRetiredDefaults 仅对**全局层**为真：项目层的同名键必是用户显式设置（旧版 freshConfig
    // 只 seed 全局），收敛它等于篡改用户的项目级意图。
    // stats.retired 记录本次收敛掉的键数，供 load 判断是否需要落盘（判据只此一处，不在别处重写）。
    function normalizeQuick(q, applyRetiredDefaults, stats) {
      const out = {}
      if (!q || typeof q !== 'object') return out
      for (const k of Object.keys(q)) {
        // 已移除的权限写工具：丢弃残留键（理由见 REMOVED_WRITE_TOOLS 处注释）。
        // 只删这份精确名单，用户手填的自定义工具名不受影响。
        if (REMOVED_WRITE_TOOL_SET.has(k)) continue
        const e = normalizeQuickEntry(q[k])
        if (e) {
          // 历史预设默认值的收敛（理由见 QUICK_RETIRED_DEFAULTS 处注释）：仅当落盘值恰好等于
          // 该键的历史默认、且当前默认已不同时才丢弃，使其回落新默认。值被用户改过就不动。
          if (applyRetiredDefaults && Object.prototype.hasOwnProperty.call(QUICK_RETIRED_DEFAULTS, k) &&
            QUICK_RETIRED_DEFAULTS[k] === e.action && QUICK_DEFAULTS[k] !== e.action) {
            if (stats) stats.retired++
            continue
          }
          out[k] = e
        }
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

    // stats 由调用方传入（形如 { retired: 0 }），normalizeQuick 往里累加本次收敛掉的键数
    // （见 QUICK_RETIRED_DEFAULTS）。刻意走独立参数而不是返回值：返回值是 config 本体，
    // 会被 JSON.stringify 整体落盘，把计数挂上去就会变成配置文件里的一个字段。
    function buildConfig(parsed, stats) {
      const g = parsed.global && typeof parsed.global === 'object' ? parsed.global : {}
      const gFb = MODES.indexOf(g.fallbackMode) !== -1 ? g.fallbackMode : 'ask'
      // 迁移闸门：按「该迁移 ID 是否已在本配置的 migrations 名单里」判断，而不是比一个全局版本号。
      // 全局版本号会让「为别的迁移升版本」连带把本条重新执行一遍，从而静默回滚用户的显式设置
      // （已实测复现）。名单式判定下各条迁移互不牵连。
      const doneMigrations = Array.isArray(parsed.migrations) ? parsed.migrations.filter((m) => typeof m === 'string') : []
      const needRetire = doneMigrations.indexOf(RETIRE_QUICK_DEFAULTS_MIGRATION) === -1
      // 名单本身需要更新（本次首次评估该迁移）时也要落盘：否则下次加载会再判定一遍，
      // 而那时用户可能已显式设回旧值——又会被当成「待收敛」删掉。
      if (stats && needRetire) stats.pending = true
      const global = { quickTools: normalizeQuick(g.quickTools, needRetire, stats), custom: Array.isArray(g.custom) ? g.custom.map(normalizeRule).filter(Boolean) : [], sandboxMode: ['workspace-write', 'danger-full-access'].indexOf(g.sandboxMode) !== -1 ? g.sandboxMode : 'danger-full-access', fallbackMode: gFb }
      // 兜底拒绝原因：与分类同口径，只在 deny 时保留
      if (gFb === 'deny') { const t = normalizeText(g.fallbackReason); if (t) global.fallbackReason = t }
      for (const c of CATS) global[c] = normalizeCategory(g[c], c, false)
      const projects = {}
      const rawProjects = parsed.projects && typeof parsed.projects === 'object' ? parsed.projects : {}
      for (const key of Object.keys(rawProjects)) {
        const p = rawProjects[key] && typeof rawProjects[key] === 'object' ? rawProjects[key] : {}
        const pFb = ALL_MODES.indexOf(p.fallbackMode) !== -1 ? p.fallbackMode : 'inherit'
        const pb = { quickTools: normalizeQuick(p.quickTools, false), custom: Array.isArray(p.custom) ? p.custom.map(normalizeRule).filter(Boolean) : [], sandboxMode: ['workspace-write', 'danger-full-access', 'inherit'].indexOf(p.sandboxMode) !== -1 ? p.sandboxMode : 'inherit', fallbackMode: pFb }
        if (pFb === 'deny') { const t = normalizeText(p.fallbackReason); if (t) pb.fallbackReason = t }
        for (const c of CATS) pb[c] = normalizeCategory(p[c], c, true)
        projects[key] = pb
      }
      // migrations 落盘：把本次评估过的迁移 ID 记入名单，使各条迁移都只跑一次
      // （理由见 RETIRE_QUICK_DEFAULTS_MIGRATION）。保留原有名单项，只补不删。
      const nextMigrations = doneMigrations.slice()
      if (nextMigrations.indexOf(RETIRE_QUICK_DEFAULTS_MIGRATION) === -1) nextMigrations.push(RETIRE_QUICK_DEFAULTS_MIGRATION)
      return { migrations: nextMigrations, global, projects }
    }

    function migrateOld(parsed) {
      const g = parsed.global && typeof parsed.global === 'object' ? parsed.global : {}
      const oldMode = ['off', 'permissive', 'locked'].indexOf(g.mode) !== -1 ? g.mode : 'off'
      const cfg = freshConfig()
      const map = { off: 'allow', permissive: 'allow', locked: 'deny' }
      // image 是本版新增的从严分类，不套用老模式映射：off/permissive 老配置按新默认 ask
      // （升级后读图先询问，由用户决定是否放宽），locked 仍保持 deny，避免比旧行为更松。
      for (const c of CATS) cfg.global[c].mode = c === 'image' ? (oldMode === 'locked' ? 'deny' : 'ask') : (map[oldMode] || 'allow')
      // 注意：这里**不**为 command 物化 destructive 子设置。
      // 曾经写过 `cfg.global.command.destructive = { action: destructiveTierDefaults(mode, false) }`，
      // 那是为了解决「老 locked 配置升级后 mode=deny 但子设置默认 ask」—— 那套「按本层 mode
      // 推导档位缺省值」的规则已按用户要求整体删除（见 destructiveTiers 处的说明），
      // 故老配置升级后八档一律落 ask（弹窗询问，fail-closed 方向，不静默放行）。
      // 而物化本身会带来另一个问题：推导值一旦落盘就成了「用户表态」，
      // 此后用户把 command 放松为 allow 时，子设置仍保留 deny —— 放松不生效且重启后粘住
      // （实测复现过）。
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
        // 与全局层同理：项目层也**不**物化子设置（推导由读取侧按「项目显式 → 全局显式 → ask」负责）
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

    // 沙箱策略解析。必须带 session：sp.resolve 的 workspaceRoot 取自
    // session.header.cwd（无 session 时退到部署级 workspaceRoot），不带就等于拿到一个
    // 与会话无关的根。sessionPolicy 只在 ensureTarget 里用于「无 cwd 会话」的兜底。
    function sessionPolicy(session) {
      try { return sp.resolve ? sp.resolve(session ? { session } : {}) : null } catch (e) { return null }
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

    // 会话标题：DSH 把标题作为会话事件 'session/title' 落在事件日志里
    //（SessionTitleEventData { title, messageSeqs }），宿主侧 session 上没有 title 字段
    //（SessionHeader 只有 id/createdAt/cwd/parentSession/origin/delegationDepth/agentPreset）。
    // 故倒序折叠事件日志取最后一个标题事件。日志读法：0.1.5 的 Session 只暴露
    // eventAt/snapshotEvents/ownEvents，没有 events 属性（读 session.events 恒 undefined，
    // 会让本函数静默恒返回 null、标题永远不显示），旧版若只暴露 events 则回退用它。
    // 会话来源只认 exec.agent.session —— 必须与 sessionId 同源：currentSession 在
    // exec.agent 缺失时会回退到 agentRef / sessions.list() 的最后一个会话，
    // 那会把「别的对话的标题」当成本次审批的来源显示，误导用户授权判断。
    // 取不到返回 null —— 由客户端回落到只显示会话 id 前缀，不编造占位文案。
    function sessionTitleOf(exec) {
      try {
        const session = exec && exec.agent && exec.agent.session
        if (!session) return null
        const evs = typeof session.snapshotEvents === 'function' ? session.snapshotEvents() : session.events
        if (Array.isArray(evs)) {
          for (let i = evs.length - 1; i >= 0; i--) {
            const e = evs[i]
            if (e && e.type === 'session/title' && e.data) {
              const t = e.data.title
              if (typeof t === 'string' && t.trim()) return t.trim().slice(0, 120)
            }
          }
        }
        return null
      } catch (e) { return null }
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
    function effectiveSandboxConfig(root) {
      const proj = projectBlock(root)
      const p = proj && proj.sandboxMode ? proj.sandboxMode : 'inherit'
      if (p !== 'inherit') return p
      return config.global.sandboxMode || 'danger-full-access'
    }

    function setSandboxConfig(root, target, mode) {
      if (target === 'global') {
        if (mode !== 'workspace-write' && mode !== 'danger-full-access') return false
        config.global.sandboxMode = mode
        return true
      }
      if (mode !== 'workspace-write' && mode !== 'danger-full-access' && mode !== 'inherit') return false
      const block = ensureProject(root)
      block.sandboxMode = mode
      return true
    }

    // 会话处于「自定义审查」时，把解析后的底层沙箱同步为会话 sandbox。
    // 根与会话必须同源：session 取自 (exec.agent || agentRef)，故根也要由**同一个 session**
    // 派生。若直接用 rootOf(exec)，exec 为 null（请求不带 sessionId）时根会落到 fallbackRoot，
    // 而 session 是 agentRef 的会话 —— 两者指向不同项目，会把部署根项目的沙箱策略写进本会话。
    function syncSandbox(exec) {
      try {
        if (sessionPresetName(exec) !== 'custom-review') return
        const agent = (exec && exec.agent) || agentRef
        const session = agent && agent.session
        if (!session) return
        const mode = effectiveSandboxConfig(rootOf({ agent: { session } }))
        const cur = sp.overrideOf(session)
        if (cur !== mode) setSandboxMode(session, mode)
      } catch (e) {
        console.error('[permgate] syncSandbox error:', e)
      }
    }

    // 写类工具 + 目标在工作区外 + 会话沙箱受限（workspace-write）→ 需要沙箱升级
    function needsUpgrade(exec) {
      try {
        if (!isFileWrite(exec.name, exec.arguments) && !isUndoNow(exec.name, exec.arguments, exec)) return false
        const fp = pathArg(exec.arguments)
        if (!fp || !isOutside(fp, rootOf(exec))) return false
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

    // **用户家目录**（`~` 的展开落点），与 homeFromEnv() 的 DSH home 是两回事。
    //
    // 爆炸半径的「家目录」档判的是「这一下会不会删掉用户的家目录」，而 `rm -rf ~`
    // 删的是 `os.homedir()`，不是 `<家目录>/.dsh`。两者混用的后果（实测）：传 DSH home 时
    // `rm -rf ~` 的警告条显示 `C:/Users/me/.dsh`（一个与真实删除目标不符的路径），
    // 而真正删家目录的 `rm -rf C:/Users/me` 落到 system 档而非 home 档。
    function userHomeDir() {
      try {
        const oh = osHomedir()
        if (oh) return norm(String(oh))
        const h = process.env.HOME || process.env.USERPROFILE
        if (h) return norm(String(h))
      } catch (e) {}
      return null
    }

    // **平台**（供爆炸半径判档用），与方言（SHELL_OF_TOOL）是两回事：
    // Linux/macOS 上跑 PowerShell Core（pwsh 工具）时方言是 pwsh、路径却是 POSIX 的。
    // 判档需要平台来选「哪一套系统目录名单」与「`/x` 是不是 cmd 开关」——
    // 把方言当平台会让 Linux 上的 `/etc` 被当开关跳过（漏报真系统目录）。
    function shellPlatform() {
      try { return process.platform === 'win32' ? 'win32' : 'posix' } catch (e) { return undefined }
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
            // home 探测与工作区无关（只是读环境变量），用部署级根即可，不取会话根
            cwd: String(fallbackRoot || 'C:\\').replace(/\//g, '\\'),
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

    // 配置目标解析。注意：配置路径只由 DSH home 决定（所有会话共用一份配置），
    // 与会话工作区根无关 —— 早退比较因此用 targetBase（派生 target 时用的会话根）
    // 而非 root：root 已不再是全局状态，且它本就不该影响配置路径。
    async function ensureTarget(exec) {
      const cwd = agentCwd(exec)
      const session = exec && exec.agent && exec.agent.session
      const pol = sessionPolicy(session)
      const base = cwd || (pol && pol.workspaceRoot ? norm(String(pol.workspaceRoot)) : '') || fallbackRoot
      if (target && targetBase === base) return target
      const home = await resolveDshHome()
      const resolved = home
        ? await homeConfigTarget(home)
        : await fs.resolve(base + '/.dsh/.permgate.json')
      // 配置路径发生切换时不重置磁盘快照：persist 的防覆盖守卫（磁盘内容 vs 快照）依赖它，
      // 置空会让守卫整段跳过，可能用「旧路径加载的内存配置」静默覆盖新路径上已存在的配置。
      // 切换后由 load() 对新目标重新建立快照基线；若 persist 在切换后未经 load 直接保存，
      // 守卫会因新旧目标内容不一致而拒绝并提示「重新加载配置文件」，方向安全。
      target = resolved
      targetBase = base
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
            // 建的是 home 下的配置目录，与工作区无关，用部署级根即可
            cwd: String(fallbackRoot || 'C:\\').replace(/\//g, '\\'),
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
        await cleanupStaleProjects(exec)
      }
    }

    // 清理失效工作区配置：删除磁盘上已**确认不存在**的项目块。
    // 保护集必须是「所有当前活跃会话的根」而非单个全局 root —— 旧实现只跳过触发清理的
    // 那一个根，其他会话若恰有目录不可达（网络盘/权限）就会被误删配置。
    // 但保护集只覆盖「本进程 live 的会话」，用户本次没打开过的项目不在其中，故判定侧必须
    // 区分「确认不存在」与「不可达」。实测 fs 服务语义（dsh-fs-local）：
    //   · fs.resolve 对不存在的路径不抛错（ENOENT 时回溯到最近存在祖先再拼回余段）；
    //   · fs.stat 对不存在的目标返回 undefined 而非抛错。
    // 于是「未挂载的网络盘/拔掉的移动盘」与「目录真被删除」都表现为 stat→undefined，
    // 仅靠 stat 结果无法区分——直接删就会把离线盘上的项目配置永久删除（persist 是原子
    // 替换且无备份，删除不可逆）。故先确认**卷根可达**：卷根都不可达说明盘未挂载，跳过。
    // 只有卷可达 + stat 返回空值，才认定该项目确已被删除。
    function volumeRootOf(key) {
      const k = norm(key)
      // 盘根单独处理：norm 已剥掉尾斜杠，'G:/' 会变成 'G:'，故必须在带斜杠的盘符正则之前
      // 匹配裸盘符形态——否则它会落到最后的 '/'，把「未挂载的 Z: 盘」误查成当前盘根
      if (/^[a-zA-Z]:$/.test(k)) return k + '/'
      const drive = /^([a-zA-Z]:)\//.exec(k)
      if (drive) return drive[1] + '/'
      const unc = /^(\/\/[^/]+\/[^/]+)/.exec(k)
      if (unc) return unc[1]
      return '/'
    }
    async function cleanupStaleProjects(exec) {
      try {
        const projs = config.projects || {}
        const keys = Object.keys(projs)
        if (!keys.length) return
        const keep = new Set([norm(rootOf(exec)).toLowerCase()])
        try {
          const all = ctx.sessions && typeof ctx.sessions.list === 'function' ? ctx.sessions.list() : []
          if (!Array.isArray(all)) throw new Error('sessions.list() 未返回数组')
          for (const s of all) {
            const c = s && s.header && s.header.cwd
            if (typeof c === 'string' && c) keep.add(norm(c).toLowerCase())
          }
        } catch (e) {
          // 保护集不完整时不再继续删除：宁可不清理，也不误删用户配置
          console.warn('[permgate] 会话列表不可用，跳过失效工作区清理:', (e && e.message) || String(e))
          return
        }
        const removed = []
        const keptBackup = {}
        for (const key of keys) {
          if (keep.has(norm(key).toLowerCase())) continue
          // 先确认卷根可达：不可达（盘未挂载/已拔出）时 stat 也会返回「不存在」，
          // 无法据此判断项目是否真被删除，一律保留
          const volRoot = volumeRootOf(key)
          let volOk = false
          try {
            const vd = await fs.resolve(volRoot)
            volOk = !!(await fs.stat(vd))
          } catch (e) { volOk = false }
          if (!volOk) {
            console.warn('[permgate] 卷不可达（盘未挂载？），保留其配置:', key)
            continue
          }
          let missing = false
          try {
            const d = await fs.resolve(norm(key))
            const info = await fs.stat(d)
            missing = !info
          } catch (e) {
            // 权限/IO 故障：无法确认是否真的不存在，保守跳过
            console.warn('[permgate] 工作区不可达，保留其配置:', key, (e && e.message) || String(e))
            continue
          }
          if (missing) {
            keptBackup[key] = projs[key]
            delete projs[key]
            removed.push(key)
          }
        }
        if (removed.length) {
          // 日志带上被删块的完整内容：删除不可逆，事后只能靠日志还原用户规则
          console.log('[permgate] 清理失效工作区配置:', removed.join(', '),
            '\n[permgate] 被删内容（如需恢复请手工写回 config.json 的 projects 段）:', JSON.stringify(keptBackup))
          await persist(exec)
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

    // 命令例外匹配（matchCommand）的实现已迁到 shell-parse.js：它是纯函数，且
    // 「词边界精确」与「通配符锚定」两条语义必须与段级判定用的是同一份代码 ——
    // 两处各写一份时，测试通过的那份与运行时用的那份会分家（旧实现正是如此：
    // 子串匹配 + 通配符 `.*` 吞操作符，两处缺陷叠在一起才造成静默放行）。

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

    // 项目块读写：root 由调用方显式传入（见 rootOf 注释）。两者必须同口径查找——
    // 迁移来的 key 可能只是大小写/斜杠形式不同，若 ensureProject 用精确 root 查找
    // 会另建一个条目，同一项目出现两个 key（面板改动看似无效）。
    function projectBlock(root) {
      const key = norm(root).toLowerCase()
      const projs = config.projects || {}
      for (const k of Object.keys(projs)) {
        if (norm(k).toLowerCase() === key) return projs[k]
      }
      return undefined
    }

    function ensureProject(root) {
      const key = norm(root).toLowerCase()
      const projs = config.projects || {}
      for (const k of Object.keys(projs)) {
        if (norm(k).toLowerCase() === key) return projs[k]
      }
      if (!config.projects) config.projects = {}
      const k = norm(root)
      config.projects[k] = freshProject()
      return config.projects[k]
    }

    // 分类默认值写入单点（设置页面板路由专用）。
    // reason 是「拒绝原因」：只在 mode=deny 时有意义，切成别的动作时一并清掉——
    // 否则配置里会留着一条对当前动作无效的僵尸文字，面板再切回 deny 时又冒出来，看着像没保存成功。
    // 但「没传 reason」不等于「要清掉」：面板与 HTTP 直连可能只想重设动作或确认当前值，
    // 一律删除会让用户写好的原因在一次无关写入后静默消失。故 reason 的三种语义分开：
    //   未提供（undefined）—— 保留原值；空串/纯空白 —— 显式清除；有内容 —— 覆盖。
    function setCategoryMode(root, targetKey, cat, mode, reason) {
      const allowed = targetKey === 'global' ? MODES : ALL_MODES
      if (allowed.indexOf(mode) === -1) return false
      const block = targetKey === 'global' ? config.global : ensureProject(root)
      if (!block[cat]) {
        block[cat] = freshCategory(cat, targetKey !== 'global')
        // command 的子设置**不随建块物化**：freshCategory(cat, true) 给项目层的是
        // `destructive: {action:'inherit'}`，一旦落盘就成了显式键 —— 读取侧看到「本层有表态」
        // 便穿透到全局，于是用户在面板上把「本项目命令」设为拒绝时，破坏性命令却按全局 ask
        // 走弹窗（实测：面板写 → rm 待批；同意图手写配置 → deny，两种结果）。
        // 删掉它，让读取侧（destructiveTiers）按「项目显式 → 全局显式 → ask」取值
        // —— 那才是正确的默认来源（**与 command mode 无关**，八档平级）。
        if (cat === 'command') delete block[cat].destructive
      }
      block[cat].mode = mode
      // 这里**刻意不联动** command 的 destructive 子设置。曾经加过「收紧到 deny 时把子设置
      // 也改成 deny」，但写入侧无法区分「子设置是默认值」与「用户显式设成了 ask」——
      // 两者在值上完全相同，于是那次同步会**静默覆盖用户的显式表态**
      // （实测：用户先把子设置设为「询问」，再把大分类设为「拒绝」，子设置被改写成「拒绝」）。
      // 顺序不同结果不同 = 用户无法预期，比「大分类 deny 时破坏性命令仍弹窗」更糟。
      //
      // 现在的语义是纯读取侧决定的，无顺序依赖：
      //   · 用户显式设过子设置 → 一律尊重（判定链上子设置优先于大分类）；
      //   · 老配置（连 destructive 键都没有）→ 八档一律落 ask（弹窗询问，fail-closed 方向）。
      //     「按本层 mode 推导档位缺省值」（mode=deny 时推 deny）那套规则已按用户要求删除，
      //     故收紧大分类**不会**再把破坏性命令一起变成 deny —— 要全拒请逐档设。
      // 面板上「当前生效」一行会把实际取值与来源显示出来，用户能看到大分类 deny 下
      // 破坏性命令仍按子设置走，需要一并收紧就去改子设置。
      if (mode !== 'deny') { delete block[cat].reason; return true }
      if (reason === undefined) return true
      const t = normalizeText(reason)
      if (t) block[cat].reason = t
      else delete block[cat].reason
      return true
    }

    // 快捷工具写入单点（设置页面板路由与弹窗「记住此决定」共用）。
    // action=inherit 表示删除该键（回落到下一级：全局键 → 预设默认 → 兜底）。
    // reason 语义与 setCategoryMode 一致：未提供（undefined）保留该键原有原因、空串显式清除、有内容覆盖。
    function setQuickAction(root, targetKey, tool, action, reason) {
      if (ALL_MODES.indexOf(action) === -1) return false
      const block = targetKey === 'project' ? ensureProject(root) : config.global
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

    // str_replace_editor 工具定义的文字描述（顶层 + 相关参数）：内核判别与 undo_edit 判别共用
    // 同一次探测，避免两处各自 tools.get + 解析而漂移。探测不到返回 null（未注册 / 无描述 / 抛错）。
    function sreToolText(exec) {
      try {
        const tools = ctx.tools
        if (!tools || typeof tools.get !== 'function') return null
        const def = tools.get('str_replace_editor', (exec && exec.agent) || agentRef)
        if (!def) return null
        const top = typeof def.description === 'string' ? def.description : ''
        const params = def.parameters && typeof def.parameters === 'object' ? def.parameters : null
        // defineTool 编译后 parameters 是 JSON Schema（{type:'object', properties:{...}}），
        // 参数描述在 properties.<name>.description；兼容可能存在的旧式扁平结构
        const props = params && params.properties && typeof params.properties === 'object' ? params.properties : params
        const propDesc = (k) => (props && props[k] && typeof props[k].description === 'string') ? props[k].description : ''
        const all = [top, propDesc('insert_line'), propDesc('command')].join('\n')
        return all.trim() ? { top, propDesc, all } : null
      } catch (e) { return null }
    }

    function detectEditorKernel(exec) {
      const t = sreToolText(exec)
      if (!t) return null
      // 内置的「AFTER the line」只出现在 insert_line 的**参数**描述里（顶层描述没有该短语），
      // 故把参数描述一并纳入匹配，使两种内核都能被正向识别，而不是让内置只能靠回退
      const desc = t.top + '\n' + t.propDesc('insert_line')
      // shadow: "inserts new line(s) before insert_line (1-indexed, lines+1 appends)"
      if (/before\s+insert_line/i.test(desc) || /1-indexed/i.test(desc)) return 'shadow'
      // 内置: "The `new_str` will be inserted AFTER the line `insert_line`"
      if (/AFTER the line/i.test(desc)) return 'builtin'
      return null
    }

    // str_replace_editor 的 undo_edit 是否写盘。三个内核各不相同：
    //   DSH 内置         —— 描述只列 view/create/str_replace/insert，没有 undo_edit：调用必然失败，不写盘
    //   dsh-better-edit  —— 描述列了 undo_edit，但实现抛 E_UNSUPPORTED：不写盘
    //   dsh-fs-encoding  —— 描述列了 undo_edit，且转发 performUndo：真写盘
    // 描述无法区分后两者，故「命令存在」即按会写盘处理（fail-closed）：误报只是多一次确认，
    // 漏报则是一条绕过 undo 分类的无闸写盘路径。探测不到描述时同样按会写盘处理。
    function sreUndoWrites(exec) {
      const t = sreToolText(exec)
      if (!t) return true
      return /undo_edit/i.test(t.all)
    }

    // 撤销类工具判定：undo_last_edit 直接命中；str_replace_editor 的 undo_edit 按内核判别。
    // exec 用于探测当前会话实际生效的 str_replace_editor，缺省时按全局 agentRef 探测。
    function isUndoNow(name, args, exec) {
      return isUndo(name, args, sreUndoWrites(exec))
    }

    // 工具自身所属的路径类分类（不含 directory 闸）：工作区外审批的「仅此文件」候选要写哪个分类，
    // 不能靠 entry.cat —— 它只记录「作出决定的那道闸」，directory 处于 ask 时反映不出工具本身属于哪类。
    function pathToolCat(name, args, exec) {
      if (isFileWrite(name, args)) return 'edit'
      if (isFileImage(name)) return 'image'
      if (isUndoNow(name, args, exec)) return 'undo'
      if (isFileRead(name, args)) return 'read'
      return null
    }

    // 纯函数版的可预览判定需要调用方先探测内核，这里包一层，调用点不必各自记着探测
    function isPreviewableFileToolNow(name, args, exec) {
      return isPreviewableFileTool(name, args, sreUndoWrites(exec))
    }

    // 内核判别恒为自动探测：不再接受人工指定（原 editorKernel 配置项与 perm_set_editor_kernel
    // 工具已移除 —— 那个设置只有 AI 能写、无面板入口，无人使用）。
    // root 参数保留：调用点统一按「函数收显式 root」的约定传参（见 regressions 的根参数守卫），
    // 且将来若要恢复项目级覆盖，签名不必再改。
    function resolveEditorKernel(exec, root) {
      const detected = detectEditorKernel(exec)
      if (detected) return { kernel: detected, source: 'detected' }
      return { kernel: 'builtin', source: 'fallback' }
    }

    // 兜底策略：未匹配任何规则的调用如何处理（project 覆盖 global，默认 ask）。
    // 与分类默认值同构：mode 与它自己的拒绝原因同源取用——项目显式配置就取项目的，
    // 项目是 inherit 才穿透到全局的（否则会出现「动作来自项目、文字来自全局」的错配）。
    function fallbackSetting(root) {
      const proj = projectBlock(root)
      const pv = proj && proj.fallbackMode
      if (pv && pv !== 'inherit') return { mode: pv, reason: normalizeText(proj.fallbackReason) }
      return { mode: config.global.fallbackMode || 'ask', reason: normalizeText(config.global.fallbackReason) }
    }

    function fallbackMode(root) {
      return fallbackSetting(root).mode
    }

    function setFallbackMode(root, targetKey, mode, reason) {
      const allowed = targetKey === 'global' ? MODES : ALL_MODES
      if (allowed.indexOf(mode) === -1) return false
      const block = targetKey === 'global' ? config.global : ensureProject(root)
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

    function matchException(r, value, kind, root) {
      // 路径两侧统一走 normAbsPath：写入值可能来自候选（规范绝对路径），而 value 是
      // 工具参数原文（可能是相对路径或含 ..）——只规范化写入侧会让例外永不命中。
      if (kind === 'path') return matchGlob(normAbsPath(r.path, root), normAbsPath(value, root))
      return matchCommand(r.match, value)
    }

    function resolveCategory(catKey, value, kind, root) {
      const proj = projectBlock(root)
      const pCat = proj ? proj[catKey] : undefined
      const gCat = config.global[catKey] || freshCategory(catKey, false)
      if (value !== null && value !== undefined && EXC_CATS.indexOf(catKey) !== -1) {
        const pl = pCat && Array.isArray(pCat.exceptions) ? pCat.exceptions : []
        for (const r of pl) if (matchException(r, value, kind, root)) return { action: r.action, ruleId: r.id, reason: (r.action === 'deny' && r.reason) ? r.reason : undefined, note: (r.action === 'ask' && r.note) ? r.note : undefined }
        const gl = Array.isArray(gCat.exceptions) ? gCat.exceptions : []
        for (const r of gl) if (matchException(r, value, kind, root)) return { action: r.action, ruleId: r.id, reason: (r.action === 'deny' && r.reason) ? r.reason : undefined, note: (r.action === 'ask' && r.note) ? r.note : undefined }
      }
      // 没命中例外 → 落分类默认值：它的拒绝原因与 mode 同源取用（项目显式配置就取项目的，
      // 项目 inherit 才穿透全局），避免「动作来自项目、文字来自全局」的错配。
      const pv = pCat && pCat.mode
      if (pv && pv !== 'inherit') return { action: pv, ruleId: null, reason: normalizeText(pCat.reason) }
      // 项目未显式配置（缺失或 inherit）才穿透全局：此处 pv 已确定不生效，
      // 故直接取全局值，不再经 firstEffective 传一个恒不命中的 projVal（与 fallbackSetting 同形）。
      return { action: gCat.mode || 'allow', ruleId: null, reason: normalizeText(gCat.reason) }
    }

    // ── 「reason 为空时不建键」这条纪律的去处 ──────────────────────────────────────
    // 这里曾有一个 `subView(action, rawReason, source)` 帮助函数，专门保证
    // 「reason 为空时不建这个键」。它现在**不需要了**：读取侧从「返回一个动作 + 一个理由」
    // 改成返回**八档表**（destructiveTiers），而理由收在 `reasons` 子对象里、
    // 只在 `if (txt) reasons[t] = txt` 处赋值 —— 空理由根本不产生键，
    // 不再有「键存在但值为 undefined」这条路径。
    //
    // 纪律本身仍然有效，且**必须**有效：DSH 0.2.0 起工具返回值要过一道 lossless-JSON
    // 校验（dsh-tools 的 snapshotToolValue → dsh-util-values 的 walkJsonValue），
    // 规则比 JSON 本身严 —— **属性值为 undefined 会让整个返回值判失败**。
    // 旧版只走 JSON.stringify（静默丢弃 undefined），所以这个坑一直没暴露，
    // 直到 DSH 升级后 perm_status 直接报：
    //   tool "perm_status" returned invalid output: value is not lossless JSON
    // 测试用 losslessViolation 复算这条规则（smoke.mjs），任何新增的字段都要过它。

    // 存量裸 `reason` 字符串的**读取单点**（§7.1：老配置语义 = 「整个破坏性类别」）。
    //
    // 两个消费方（面板下发的 `explicitReasonsOf` 与裁决下发的 `destructiveTiers` ③）
    // **共用它** —— 「读哪个键、怎么归一」只有一份。各写一份必然漂移，而漂移的后果是
    // **面板显示的理由与实际裁决带着的理由不一致**（本文件反复警告的那一类）。
    //
    // 它们对「这句理由管哪几档」的答案**不同**，那是两个不同的提问，各自在调用处
    // 写明依据：面板回答「用户在哪一档上写下了理由」，裁决回答「AI 该收到哪句话」。
    function legacyReasonOf(sub) {
      return (sub && typeof sub === 'object') ? normalizeText(sub.reason) : undefined
    }

    // 某一层**显式**的 per-tier 理由视图（`null` = 该层没设过任何理由）。
    //
    // 为什么不能直接把 `destructive.reasons` 下发：存量配置只有裸 `reason` 字符串
    // （老配置：`{ action: 'deny', reason: 'rm 危险' }`，语义 = 整个破坏性类别）。
    // 它属于 **inside 档**（`action` 键承载的那一档），而「读取侧兼容」意味着**下发视图里也要能看见**
    // —— 否则面板上 inside 那一档的理由框是空的，用户会以为自己没设过，
    // 而实际裁决正带着那句理由拒绝（面板说谎，正是本文件反复警告的那一类）。
    //
    // **只读派生、不写盘**：这里只是把两个来源合成一个视图，磁盘上的 `reason` 键原样不动
    // （搬家的代价见 normalizeSubSetting 的注释）。
    function explicitReasonsOf(sub) {
      if (!sub || typeof sub !== 'object') return null
      const raw = (sub.reasons && typeof sub.reasons === 'object') ? sub.reasons : null
      const out = {}
      for (const t of TIERS) {
        const txt = normalizeText(raw ? raw[t] : null)
        if (txt) out[t] = txt
      }
      // inside 档的兜底：`reasons.inside` 优先（那才是用户在新面板上填的），
      // 没有时才回落到存量裸 `reason`（读取单点 legacyReasonOf）。其余档**不给**这个兜底 ——
      // 本视图回答的是「用户**在哪一档上**写下了理由」，而裸 `reason` 是**类别级**字符串
      // （老配置语义 = 「整个破坏性类别」），它归 `action` 承载的那一档，即 inside。
      // 摊给七档会让面板显示用户没设过的理由（面板说谎）。
      // ⚠️ 裁决下发（`destructiveTiers` ③）对同一句裸 `reason` **给每一档**，
      //    理由与两者的分工见那里的注释 —— 两个视图口径不同是**有意**的，不是分叉。
      if (!out.inside) {
        const legacy = legacyReasonOf(sub)
        if (legacy) out.inside = legacy
      }
      return Object.keys(out).length ? out : null
    }

    // command 分类的子设置读取：与 resolveCategory 同口径（项目显式 → 全局 → 默认），
    // 项目层 inherit 穿透全局。**单一读取点**：assessCommand 的 destructive 钩子与 statusView
    // 的下发都走它，避免「面板显示一个值、实际裁决按另一个值」的双份真相。
    //
    // **推导在这里做，不在 normalizeCategory 里做**：那边补的值会被 persist 落盘成显式键，
    // 于是「推导值」与「用户表态」在磁盘上不可区分（详见 normalizeCategory 的注释与两处实测）。
    // 现在的优先级（**逐档独立**，不是整块取用）：
    //   ① 项目层显式非 inherit → 用它
    //   ② 全局层显式非 inherit → 用它
    //   ③ 都没显式值 → `ask`
    //
    // ── 为什么必须**逐档**而不是整块 ─────────────────────────────────────────────
    // 用户在项目层只把 `wide` 设成 deny、其余档没表态时，那七档应当继续穿透全局，
    // 而不是一起变成「本层的推导默认值」。整块取用会让「只改一档」变成「改八档」，
    // 而面板上显示的值与实际裁决分叉（面板显示全局的 ask、裁决走末级兜底的 ask ——
    // 恰好相等时看不出，一旦全局改了就分叉）。
    //
    // 返回的是**八档的动作表**（供 shell-parse 的 `strictestTierAction` 取最严），
    // 外加 `reasons`（per-tier 拒绝理由）与 `source`（每档各自的来源，供面板标注）。
    //
    // ── 八档一律「项目显式 → 全局显式 → ask」，不再有第三个来源 ───────────────────
    // 这里曾经写着「两遍解析：先定 `inside`，再用 `strictest(ask, inside 生效值)` 定其余七档」，
    // 即档位缺省值**按本层 command mode 现算**。那套规则已按用户要求删除，改为与其余分类
    // 完全同构的继承语义 —— 面板上「项目未设置 = 继承全局」这句现在是**字面属实**的：
    //
    //   旧：七档缺省 = strictest(ask, 本层 mode 的生效值)
    //   新：七档缺省 = 全局层的**同名档**；全局也没有 → ask
    //
    // 被删掉的那套规则原本只为守住一件事：存量 `destructive:{action:'deny'}` + mode=allow
    // 的用户，七档不得从 deny 掉到 ask（§6.2）。**新规则守不住这一件**，而且是逐档可见地
    // 守不住 —— `action` 只是 **inside 那一档**的键（`keyOfTier`），全局块里并没有
    // `wide` / `proc` 等键，故项目未表态的**其余七档**落末级兜底 `ask`：
    //
    //   全局 `{action:'deny'}`（无项目层）→ inside=deny，其余七档全 ask
    //   同一份配置在旧规则下            → **八档全 deny**
    //
    // 即「只有 inside 档保住 deny，其余七档由 deny 变 ask」（smoke.mjs 43b 钉的就是这一形态）。
    // 这正是设计文档 §58 点名的那处**有意放松**：八档与「执行命令」是两个独立设置项，
    // 八档更细、优先级更高；默认「询问」是 fail-closed 的方向（命令一定被拦下来问一次，
    // 弹窗里带破坏性标注与爆炸半径警告条，用户看到后可以去设置里逐档调整）。
    // 用户明确接受「忽略旧配置迁移兼容」后，这条顾虑不再需要靠 mode 推导来兜。
    //
    // ⚠️ 由此产生的一处**行为变化**（有意接受，不是回归）：本层 mode 比全局更严时，
    // 档位不再跟着本层 mode 收紧。实测 `项目 mode=deny + 全局 mode=ask`：
    //   旧：八档全 deny（inside 由 mode 推导，七档 strictest(ask,deny)=deny）
    //   新：八档全 ask（项目未表态 → 继承全局；全局也没表态 → ask）
    // 即「执行命令」设为拒绝后，破坏性命令改为**弹窗询问**而不是直接拒绝。
    // 用户判断可接受：弹窗里带完整的破坏性标注（`argLines[].note` = 「破坏性命令大范围」
    // 等）与爆炸半径警告条，用户看到后会去设置里调 —— 弹窗本身就是发现入口。
    // 且方向是 fail-closed（ask 一定拦得住），不存在静默放行。
    function destructiveTiers(root) {
      const proj = projectBlock(root)
      const pSub = (proj && proj.command && proj.command.destructive) || null
      const gSub = (config.global.command && config.global.command.destructive) || null
      const out = {}
      const reasons = {}
      const source = {}
      // 档位键：inside 由 `action` 承载（老键义不变），其余七档各有一个同名键。
      // 映射单点 = 模块级 keyOfTier（收敛前这里另写了一份同样的三元表达式）。
      const keyOf = keyOfTier
      // 取某档的显式配置来源（项目优先 → 全局），没有则 null
      const explicitOf = (t) => {
        const k = keyOf(t)
        const pv = pSub ? pSub[k] : undefined
        if (pv && pv !== 'inherit') return { v: pv, from: pSub, src: 'project' }
        const gv = gSub ? gSub[k] : undefined
        if (gv && gv !== 'inherit') return { v: gv, from: gSub, src: 'global' }
        return null
      }
      // 八档**同一套规则**：项目显式 → 全局显式 → ask。
      //
      // `inside` 不再有任何特殊待遇（它曾经 = 本层 mode）。八档在判定链上平级，
      // 取值规则也必须平级 —— 否则面板上会出现「一档显示继承全局、七档显示 ask」
      // 那种同一状态两种画法的错位（实测反馈的正是这一处）。
      //
      // 末级兜底取 `ask` 而不是 `inherit`：`strictestTierAction` 会**跳过** inherit 档
      // （见 shell-parse.js 的注释），若这里真下发 inherit，命中该档的破坏性命令会静默
      // 落大分类 —— fail-open。档位表是**裁决输入**，必须恒为具体动作。
      // 面板的「继承全局」是**显示层**的事（client.js 按本层显式配置渲染），不靠这里表达。
      for (const t of TIERS) {
        const e = explicitOf(t)
        out[t] = e ? e.v : 'ask'
        source[t] = e ? e.src : 'default'
      }
      // ③ per-tier 理由：`reasons[t]` 优先；**每一档**都额外回落存量裸 `reason` 字符串。
      //    只在**该档最终是 deny** 时取 —— 与 normalizeSubSetting 的存储侧口径同源。
      //
      // ── 为什么裸 `reason` 要摊给**每一档**（而不是像面板视图那样只给 inside）──────
      // 存量配置只有 `{action:'deny', reason:'rm 危险'}` 一个动作 + 一句理由，语义是
      // **「整个破坏性类别」**。而这句理由说的是那**整类**拒绝 —— 于是每一档都该带上它。
      //
      // 不摊的后果（实测，端到端）：存量「全拒 + 理由」配置下，`rm -rf C:/Windows`(wide)、
      // `kill 1234`(proc)、`sudo ls`(priv) 全部 deny 但 **reason=null** —— 用户写过的拒绝理由
      // 静默消失，AI 收到的拒绝指令是空的。而面板上那句理由仍显示在 inside 档
      // （explicitReasonsOf 的口径），于是「看得见理由、AI 收不到理由」= 面板说谎。
      //
      // ⚠️ 两个视图**口径不同是有意的**，不要「统一」掉任何一个：
      //   · `explicitReasonsOf`（面板）回答「用户在哪一档上写下了理由」→ 归 inside
      //     （`action` 即 inside 档，摊给七档会让面板显示用户没设过的理由）；
      //   · 本处（裁决）回答「AI 该收到哪句话」→ 每档都给（同一份存量配置因调用方形状
      //     不同而给出不同拒绝文案，正是本处要消除的那个分叉）。
      //   两句判据的**读取**共用 `legacyReasonOf` 单点；只有「归哪几档」各自决定。
      //
      // 归属层：**先跟该档自己的显式来源走**（`explicitOf(t).from`），取不到时再回落
      // **另一层**的同类裸 `reason`（次序 = 项目 → 全局，与 `explicitOf` 的层级优先级同源）。
      //
      // ── 为什么必须跨层回落（不要把下面两句当成冗余删掉）────────────────────────
      // 裸 `reason` 是**类别级**字符串（老配置语义 = 「整个破坏性类别」），它落在哪一层
      // 与「该档的动作来自哪一层」**没有必然关系** —— 两者可以不同层。两个方向都实测过，
      // 后果都是同一族缺陷（面板看得见理由、AI 收不到理由）：
      //   · 全局 `{action:'deny', reason:'rm 危险'}` + 项目 `{wide:'deny'}`
      //     → `rm -rf C:/Windows` 命中 wide，动作来源是**项目**（项目只写了动作没写理由），
      //       那句理由却在**全局** → 只按 `from` 取会得到 null；
      //   · 反向：全局 `{wide:'deny'}` + 项目 `{action:'deny', reason:'项目理由'}`。
      // 这里曾经回落的是「决定 `inside` 生效值的那一层」（`insideLayer`）—— 那是 `inside`
      // 还有特殊语义（= 本层 mode、由两遍解析定出）时的产物，`insideLayer` 已随那套规则消失；
      // 但**跨层回落本身必须留下**，否则上面两个方向当场丢理由。改为直接按「本层 → 另一层」
      // 的固定次序取：`from` 恒是 `pSub` / `gSub` 之一（能走到这里就说明该档有显式来源），
      // 故下面那串回落覆盖了**裸 `reason`** 的全部跨层情形，且不依赖任何 `inside` 语义。
      // 链式回落（`||`）：本层显式改了动作却没写理由时，仍能拿到另一层那句类别级理由。
      //
      // ── per-tier 理由（`reasons[t]`）**同样**必须跨层（别只给裸 `reason` 补回落）──────
      // 上面那条跨层性质对 per-tier 理由一样成立，而且形态更常见：面板的档位下拉框只提交
      // `{target, tier, action}`、**不带 reason**（client.js 的 changeSubDestructive），
      // 只有用户点「编辑原因」时才带上（commitSubReason）。于是
      //   全局 `{wide:'deny', reasons:{wide:'…'}}` + 项目 `{wide:'deny'}`
      // 里 wide 的动作来源是**项目**、per-tier 理由却在**全局**：只按 `from.reasons[t]` 取得到
      // undefined —— 裁决仍是 deny，但 AI 收到的是默认档位文案，而面板上那句理由照旧显示在
      // wide 档（`explicitReasonsOf` 的口径），又是「面板看得见理由、AI 收不到理由」那一族。
      // 故两种理由形态共用**同一套次序**：本层（该档动作的来源层）→ 项目 → 全局。
      // 「本层优先」指该档动作的来源层先试（理由与动作同源），其后才是层级次序；
      // 两层都写时项目层压过全局层。两层都没有理由时不补 —— 不凭空造理由。
      //
      // ── 「本层优先」必须同时覆盖**两种形态**（下面那串 `||` 的次序即此意）──────────
      // 判据是「理由与动作同源」：该档动作来自哪一层，那一层写的理由就该先被采用 ——
      // **per-tier 也好、裸 `reason` 也好，都算**。故本层两项（`normalizeText(r)` 与
      // `legacyReasonOf(from)`）必须**相邻地**排在另一层任何一项之前。
      //
      // ⚠️ 这里曾经把「本层裸 `reason`」排在「另一层 per-tier 理由」**之后**（次序是
      // `本层 per-tier → 项目 per-tier → 全局 per-tier → 本层裸 → 项目裸 → 全局裸`），
      // 与上面那句注释自称的次序**自相矛盾**，且相对更早的版本是**行为回归**。实测（win32，
      // `rm test.txt`，真实 `assessCommand`）：
      //   项目 `{action:'deny', reason:'P'}` + 全局 `{action:'deny', reason:'G2', reasons:{inside:'G2'}}`
      //   → inside 档动作来源是**项目**、项目层确实写着理由 `P`，但旧次序取到 `rt(gSub,'inside')='G2'`；
      //     而面板项目 tab 那一行（`explicitReasonsOf(pSub)`）显示的是 `P`
      //     → 「面板显示 P、AI 收到 G2」，正是本文件反复警告的那族分叉。
      // 注意 `legacyReasonOf(from)` **不是**冗余项，**不得**因为它「看起来能被后面的
      // `legacyReasonOf(pSub)` 覆盖」而删掉：`from` 可以是**全局**（该档动作来自全局层），
      // 此时若没有它，`legacyReasonOf(pSub)` 会抢先，把项目层那句**别的**类别级理由顶上来。
      // 实测：全局 `{wide:'deny', reason:'GB'}` + 项目 `{action:'deny', reason:'PB'}`
      // （wide 档动作来源 = 全局）→ 保留时得 `GB`，删掉后退化为 `PB`。
      //
      // ── 次序的**取向**：本层优先对两种形态一视同仁 ────────────────────────────────
      // 把本层两项（per-tier、裸 `reason`）排在另一层任何一项之前，含义是「理由与动作
      // 同源」这条判据**同时覆盖两种形态**，而不是只覆盖 per-tier。
      //
      // ⚠️ 这是一处**有意取舍**，且**可达**：它意味着「本层**裸** `reason`」能压过
      // 「另一层 per-tier 理由」。实测（win32，`rm -rf C:/Windows`，真实 `assessCommand`）：
      //   全局 `{wide:'deny', reasons:{wide:'RW'}}` + 项目 `{action:'deny', reason:'B', wide:'deny'}`
      //   → 得 `B`（项目层那句裸 reason），而旧次序会给 `RW`（全局那份 per-tier）。
      // 代价：AI 收到项目层那句 `B`，而面板 wide 行看不见 `B`（`B` 归 inside 档、
      // `RW` 显示在全局 tab）—— 等于用「另一处的面板分叉」换掉了上面那处。
      // 取舍依据是**次序自洽**（「本层优先」对两种理由形态一视同仁），且两处都恒为 deny
      // （不是 fail-open）。该取舍由 regressions.mjs 60f ⑧ 的反向格钉住，防止被顺手改回去。
      //
      // 注：那一格（`{wide:'deny', reason:'B'}`，**不带 `action`**）在写盘侧不可达 ——
      // 裸 `reason` 的保留条件是 `out.action === 'deny'`（见 normalizeSubSetting），
      // 缺 `action` 时那句裸 `reason` 在加载时就被丢了，实测得 `RW`。
      // 但**取舍本身不依赖那一格**：带上 `action:'deny'` 即上面的可达形态（面板写 inside 档
      // 的「编辑原因」时正是同时写 `reasons.inside` 与裸 `reason`，见 setCommandSub）。
      // 故这里**不是**「不可达分支」—— 别据此把次序改回去。
      //
      // 注：写盘侧不会产生「理由在项目、该档动作在全局」的形状（normalizeSubSetting 只在
      // **该层该档显式 deny** 时保留 `reasons[t]`，故理由所在层必然也是该档动作的来源层）；
      // 回落照旧留着 —— 它守的是「两种形态共用一份次序」这件事，而不是某个已知可达形状。
      const rt = (s, k) => ((s && s.reasons && typeof s.reasons === 'object') ? normalizeText(s.reasons[k]) : undefined)
      for (const t of TIERS) {
        if (out[t] !== 'deny') continue
        const e = explicitOf(t)
        const from = e ? e.from : null
        const r = (from && from.reasons && typeof from.reasons === 'object') ? from.reasons[t] : null
        // 次序：本层 per-tier → 本层裸 reason → 项目 per-tier → 全局 per-tier → 项目裸 → 全局裸
        const txt = normalizeText(r) || legacyReasonOf(from)
          || rt(pSub, t) || rt(gSub, t) || legacyReasonOf(pSub) || legacyReasonOf(gSub)
        if (txt) reasons[t] = txt
      }
      out.source = source
      if (Object.keys(reasons).length) out.reasons = reasons
      return out
    }

    // doomloop 阈值的读取单点（与 destructiveTiers 同构）：项目显式 → 全局显式 → 默认。
    // **推导在这里做，不在 normalizeCategory/freshCategory 里做** —— 那边的产物会经 persist
    // 落盘成显式键，于是「推导值」与「用户表态」在磁盘上不可区分：日后把默认阈值从 6 调成 8 时，
    // 存量配置里那条固化的 6 会永久压过新默认（面板显示 8、实际按 6 裁决），
    // 且此后任何一次无关写盘都会把 6 固化 —— 这正是 QUICK_RETIRED_DEFAULTS 当年要造
    // 一次性收敛迁移的原因，不值得再犯一次。
    // 优先级：
    //   ① 项目层显式数字 → 用它
    //   ② 全局层显式数字 → 用它
    //   ③ 都没显式值 → DEFAULT_REPEAT_STREAK（6）
    // 非法值（非数字/≤0/非有限）在加载时已被 normalizeThreshold 丢弃，故这里只会看到合法值；
    // 仍做一次防御性校验：万一有路径绕过归一化，回落默认而不是把 NaN 带进比较
    // （NaN 参与 >= 比较恒为 false，那会变成「循环检测静默失效」—— fail-open，必须避免）。
    function doomloopSetting(root) {
      const proj = projectBlock(root)
      const pv = proj && proj.doomloop && proj.doomloop.threshold
      if (typeof pv === 'number' && Number.isFinite(pv) && pv > 0) return { threshold: Math.max(MIN_REPEAT_STREAK, Math.floor(pv)), source: 'project' }
      const gv = config.global.doomloop && config.global.doomloop.threshold
      if (typeof gv === 'number' && Number.isFinite(gv) && gv > 0) return { threshold: Math.max(MIN_REPEAT_STREAK, Math.floor(gv)), source: 'global' }
      return { threshold: DEFAULT_REPEAT_STREAK, source: 'default' }
    }

    // 子设置写入单点（设置页路由专用）。reason 语义与 setCategoryMode 完全一致：
    // 未提供（undefined）保留原值；空串/纯空白显式清除；有内容覆盖。
    // 全局层不接受 inherit（与 setCategoryMode 同口径：inherit 是项目层专属的「穿透」语义）。
    //
    // ── `tier` 参数（本计划新增）──────────────────────────────────────────────────
    // **缺省 = `inside`**，于是旧客户端（不传 tier）写的就是老语义的 `action`，行为完全不变。
    // 新客户端传 `tier` 时写该档：`inside` 落到既有的 `action` 键（**老键义不变**），
    // 其余七档落到同名键（`wide` → `destructive.wide`）。
    //
    // 拒绝理由按档存进 `reasons[tier]`（§7.1）。**某档从 deny 切走时删掉该档理由** ——
    // 与既有行为一致（`setCommandSub` 现在在 `action !== 'deny'` 时删 `reason`）。
    // 已知代价（有意接受）：从拒绝改成询问再改回拒绝，理由已丢，需要重填。
    // 保持这个行为是为了与既有口径一致，且避免配置里积累「看不见的旧理由」。
    function setCommandSub(root, targetKey, action, reason, tier) {
      const allowed = targetKey === 'global' ? MODES : ALL_MODES
      if (allowed.indexOf(action) === -1) return false
      // 未知档位一律拒绝（不静默落 inside）：路由收到非法 tier 时应当报错，
      // 而不是把用户改 A 档的意图写成 B 档的动作。
      const t = tier === undefined || tier === null || tier === '' ? 'inside' : String(tier)
      if (TIERS.indexOf(t) === -1) return false
      // 档位键走**映射单点** keyOfTier（inside → 老键 `action`，其余同名）。
      // 收敛前这里是第三份手写的三元表达式，与读取侧各写一份 —— 漂移即 fail-open。
      const key = keyOfTier(t)
      const block = targetKey === 'global' ? config.global : ensureProject(root)
      if (!block.command) block.command = freshCategory('command', targetKey !== 'global')
      // 八档**一律逐档**写入（**含 inside**）：`tier` 参数说的就是「只改这一档」，
      // 故只写 `sub[key] = action`，绝不碰兄弟档位键与 `reasons`。
      //
      // 依据是**读取侧的形状**：`destructiveTiers` 的 `explicitOf` 是**逐档独立**的
      // （`keyOf('inside') === 'action'`，其余档是各自同名键），它把 `'inherit'` 视为
      // 「本层未表态」并**逐档**穿透全局。实测 `{action:'inherit', wide:'deny'}` 得到
      // `inside` = 全局值、`wide` = `deny`(source=project) —— 即读取侧完全支持「半层 inherit」，
      // 写入侧没有理由把整层清掉。
      //
      // inside 档曾经是唯一例外：写 `action='inherit'` 时**整块重建** `{ action: 'inherit' }`，
      // 理由是「半层 inherit 半层表态自相矛盾」。但那个理由与读取侧的实际语义不符，且整块重建
      // 会删掉本层其余档位键与 `reasons`。后果（端到端实测）：项目层先设 `wide=deny`
      // （`rm -rf C:/Windows` = deny，理由「删系统目录」），用户只把 **inside** 改成「继承全局」，
      // 磁盘被重建为 `{"action":"inherit"}` → `wide` 由 **deny 变 ask**、`reasons.wide` 整块丢失。
      // 即「只动一档却静默**放松**了另一档的显式拒绝」，与「改 wide 却动了 inside」是同一个
      // 缺陷的两个方向。面板在项目层每一档都提供「继承全局」选项（client.js:4406 传 ALL_MODES），
      // 故这是常规可达路径，不是边角。
      if (!block.command.destructive) block.command.destructive = {}
      const sub = block.command.destructive
      sub[key] = action
      if (action !== 'deny') {
        // 切离 deny：删掉**该档**的理由。`inside` 档额外清存量裸 `reason`
        // （它是类别级字符串，归 `action` 键承载的那一档）。
        if (sub.reasons && typeof sub.reasons === 'object') {
          delete sub.reasons[t]
          if (!Object.keys(sub.reasons).length) delete sub.reasons
        }
        if (t === 'inside') delete sub.reason
        return true
      }
      // reason === undefined = 保留原值（与 setCategoryMode 同口径）
      if (reason === undefined) return true
      const txt = normalizeText(reason)
      if (txt) {
        if (!sub.reasons) sub.reasons = {}
        sub.reasons[t] = txt
        // inside 档同步写裸 `reason`：老客户端（只读 `reason`）仍能看到理由，
        // 且老配置的形态保持一致。其余档不写 —— 那个键的语义是「整个破坏性类别」。
        if (t === 'inside') sub.reason = txt
      } else {
        if (sub.reasons && typeof sub.reasons === 'object') {
          delete sub.reasons[t]
          if (!Object.keys(sub.reasons).length) delete sub.reasons
        }
        if (t === 'inside') delete sub.reason
      }
      return true
    }

    // doomloop 阈值写入单点（设置页路由专用）。
    //   threshold === 'inherit' → **删除本层的 threshold 键**（= 本层没有表态，穿透到下一级）。
    //     两层都接受：threshold 是数字字段，不像 mode 那样有「inherit 这个动作取值」的语义，
    //     「本层不表态」在数据上就是缺键。全局层删掉即回落内置默认值，与项目层删掉即回落
    //     全局是同一件事 —— 故这里不像 setCommandSub 那样对全局层拒绝（那里 inherit 是一个
    //     动作取值，全局层没有「穿透」的对象，写进去会变成非法 mode）。
    //   合法数字 → 落盘；非法 → 返回 false，由路由回错误（**不静默回落默认**：那会让用户
    //              以为自己设的值生效了，而实际按默认走 —— 面板与实际裁决分叉）。
    function setDoomloopThreshold(root, targetKey, threshold) {
      const block = targetKey === 'global' ? config.global : ensureProject(root)
      if (!block.doomloop) block.doomloop = freshCategory('doomloop', targetKey !== 'global')
      if (threshold === 'inherit') {
        delete block.doomloop.threshold
        return true
      }
      const th = normalizeThreshold(threshold, false)
      if (th === null) return false
      block.doomloop.threshold = th
      return true
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
      const b = base || fallbackRoot
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

    // 插入类工具的「文件行数」上限口径：末尾换行不另开一行、空文件为 0 行。
    // 与 dsh-fs-encoding 的 splitForEdit / insertAfterLine 的 [0, lines] 同源；
    // 不能直接用 splitDiffLines(...).length —— 它会为末尾换行多算一行。
    // 入参是**已物化的行数组**（splitDiffLines(text) 的结果），而不是原文：调用点本来就要这个
    // 数组去渲染，让它顺手传进来即可，不必为取一个行数把同一份全文再归一化+切分一遍。
    // 判据全部从数组本身读：normEol(text)==='' ⟺ ['']；归一化后以 \n 结尾 ⟺ 末项为空串
    //（末尾的 \r 已被 normEol 折成 \n，故这里天然覆盖 CR/CRLF 结尾，不会漏算一行）。
    function insertLineCount(lines) {
      const arr = Array.isArray(lines) ? lines : splitDiffLines(lines)
      if (arr.length === 1 && arr[0] === '') return 0
      return arr[arr.length - 1] === '' ? arr.length - 1 : arr.length
    }

    // 插入参数解析单点：sre 的 insert 子命令与 dsh-fs-encoding 的独立 insert 工具共用。
    // 两者只差**内容键名**（sre 用 new_str、独立工具用 new_string），占位值折算规则必须一致 ——
    // 都喂给同一个 previewInsert，各写一份的话「改一处忘另一处」会预览出一次必然失败的插入
    //（该公式历史上出现过 off-by-one）。故键名作为参数传入，规则本身只此一份。
    // null/''/false 等占位值不得折算为 0：两个内核的取参都把 null 视为未提供并报 required，
    // 折算成 0 会被当成合法的 0 基位置。
    function insertArgsOf(args, textKey) {
      const rawInsLine = args.insert_line
      const insLine = (rawInsLine === null || rawInsLine === undefined || rawInsLine === '' || rawInsLine === false) ? NaN : Number(rawInsLine)
      const insText = typeof args[textKey] === 'string' ? args[textKey] : ''
      return { insLine, insText }
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

    // enc：本次请求的编码来源 holder（由 buildFileDiffData 创建）。给默认值是为了
    // 漏传时不崩（只是少一个标注），而不是静默接受缺参——调用点只有 buildFileDiffDataRaw 一处。
    async function buildUndoDiffData(entry, fsService, fp, enc = { meta: null, want: null }) {
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
      // 撤销记录的存放位置随内核而异：dsh-better-edit 落在可读的 sqlite store，dsh-fs-encoding
      // 只存在进程内存里、外部读不到。读不到不等于「没有记录」，更不等于撤销会被跳过，
      // 故这里只说明「无法预览」，不对撤销本身是否执行下结论。
      if (!row) return { ok: false, error: bi('无法预览撤销内容（不影响撤销本身是否执行）', 'Cannot preview the undo (this does not affect whether it runs)') }
      try {
        // 撤销预览要拿磁盘当前内容与撤销目标比对，非 UTF-8 文件同样要能读出，
        // 否则撤销预览直接报 invalid UTF-8 text 而看不到将被恢复的内容。
        //
        // **这里刻意不传 recordedEncoding 的记录**：本函数读的是 dsh-better-edit 的 sqlite
        // store（见上面 betterEditStoreFor），而 better-edit 有**它自己**的编码状态
        // （dsh-better-edit 的 file-encoding-state.ts，全仓零处引用 dsh-fs-encoding），
        // 与 fs-encoding 的 memo 是两套互不相干的记录。把 fs-encoding 的 memo 当成本撤销
        // 内核的基准，等于用 A 插件的记录去解释 B 插件的行为——比不传更糟。
        const curRR = await readPreviewText(fsService, target, getFsEncodingService(ctx), info && info.size, enc.want)
        if (!curRR.ok) return curRR
        const curText = curRR.text
        // 记录编码来源：撤销预览同样是「按解码文本生成的对比」，须让客户端能标注
        enc.meta = { encoding: curRR.encoding, decided: curRR.decided }
        const after = row.content === null || row.content === undefined ? '' : String(row.content)
        if (overMaxChars(curText, after)) return { ok: false, error: bi('文件过大，无法生成对比', 'File too large to compare') }
        // 与 better-edit 的校验口径对齐：better-edit 用 undo 行的 bom/ending 做字节级精确比较，
        // 撤销校验含 BOM 与行尾。这里先做归一化比较，再对 BOM/行尾做敏感复核——
        // 仅行尾（CRLF↔LF）或 BOM 差异的覆盖在 better-edit 会返回 E_UNDO_STALE，预览同步按 stale 处理。
        const resultContent = row.result_content === null || row.result_content === undefined ? '' : String(row.result_content)
        const normTxt = (s) => normEol(String(s || '').replace(/^\uFEFF/, ''))
        // 解码是否与**写盘内核实际使用的那份**同源：内核按它自己记录的编码（encoding memo）
        // 解码后再做字节级校验（better-edit 用 undo 行的 bom/ending）。本插件的预览拿不到
        // 那个 memo（service.d.ts 明写「the recorded encoding is deliberately NOT part of
        // this service」），只能靠「服务的判定是否确定」间接对齐：
        //   · 'utf8' / 'bom' 是确定性判定（严格 UTF-8 校验、BOM 权威），与 memo 必然一致
        //     ——memo 首次也是由同一套 admission 记录的；
        //   · 'guessed' 是概率性选择（autoGuessEncoding=true），可能与 memo 记的那一页不同；
        //   · enc.want 是工具透传的编码，与内核的 memo 未必同源（撤销预览当前恒为 null，
        //     因为 undo 类工具没有 encoding 参数；此处保留判断以免日后新增调用方时失守）。
        // 非同源时据此下结论不是「少一条提示」，而是**反向误导**：预览输出「撤销不会执行
        // （无变化）」，审批者以为放行无副作用，实际撤销会执行并改盘——正是本插件要防的误判
        // 放行。故非同源时只渲染对比、不对撤销是否执行下结论（宁可少说，不能说错；与上面
        // 「无法预览」分支同一原则）。
        const decodeMatchesKernel = !enc.want && curRR.decided !== 'guessed'
        if (decodeMatchesKernel && normTxt(curText) !== normTxt(resultContent)) {
          return { ok: false, error: bi('文件在该次编辑后已被改动，撤销不会执行（无变化）', 'File changed after that edit; the undo will not run (no change)') }
        }
        const undoBom = row.bom === '\uFEFF' ? '\uFEFF' : ''
        const undoEnding = row.ending === '\r\n' || row.ending === '\r' ? row.ending : '\n'
        // 磁盘真实 BOM 状态：readText 经 TextDecoder 解码会剥离前导 BOM，故直接读前 3 字节比对
        // EF BB BF；读不到时回退到「stat.size 与文本字节数比对」的旧判据，与 undo.bom 不一致视为 stale
        let bomCheckable = true
        if (typeof info.size === 'number') {
          let diskHasBom = false
          try {
            // readBytes 的 maxBytes 是「整文件上限」（超限直接抛 FS_TOO_LARGE），
            // 取文件头要用区间读取；不支持时由 catch 回退到 size 判据
            const head = (fsService.readByteRange && target) ? await fsService.readByteRange(target, { offset: 0, length: 3 }, undefined) : null
            diskHasBom = !!(head && head.length >= 3 && head[0] === 0xEF && head[1] === 0xBB && head[2] === 0xBF)
          } catch (e) {
            // size 判据按 curText 的 UTF-8 字节数反推，依赖预览解码结果：解码与内核不同源时
            // 该反推不成立（会得出错误的 BOM 结论），此时放弃这条复核而不是给出错误断言。
            if (decodeMatchesKernel) diskHasBom = info.size === Buffer.byteLength(curText, 'utf8') + 3
            else bomCheckable = false
          }
          const wantBom = undoBom !== ''
          if (bomCheckable && diskHasBom !== wantBom) {
            return { ok: false, error: bi('文件 BOM 在该次编辑后已被改动，撤销不会执行（无变化）', 'File BOM changed after that edit; the undo will not run (no change)') }
          }
        }
        // 内容与行尾精确比较：curText 保留原始 CRLF；resultContent 为 \n 规范化存储，按 undo.ending 还原
        // undoEnding 为 '\n'（LF 文件，最常见）时该 replace 是恒等变换，短路避免整串副本
        const exactResult = undoEnding === '\n' ? String(resultContent) : String(resultContent).replace(/\n/g, undoEnding)
        if (decodeMatchesKernel && curText !== exactResult) {
          return { ok: false, error: bi('文件行尾/编码在该次编辑后已被改动，撤销不会执行（无变化）', 'File line endings or encoding changed after that edit; the undo will not run (no change)') }
        }
        const oldLines = splitDiffLines(curText)
        const newLines = splitDiffLines(after)
        const p = commonPrefixLen(oldLines, newLines)
        const s = commonSuffixLen(oldLines, newLines, p)
        const out = windowedDiffPayload(fp, oldLines, newLines, p + 1, oldLines.length - s - p, newLines.length - s - p, 200)
        // 上面跳过了 stale 判定时，必须让客户端把这件事显式说出来：不给提示等于让审批者
        // 以为「没报 stale = 撤销会正常执行」，而这里其实什么都没判定。文案口径与
        // 「无法预览」分支一致——只说明判断不了，不对撤销本身是否执行下结论。
        if (out && out.ok === true && !decodeMatchesKernel) out.undoVerdictSkipped = true
        return out
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

    // 统一「预检 + readText」：返回 {ok:true,target,info,text,encoding,decided,candidates}
    // 或 {ok:false,error}。
    // 写分支各读盘入口共用；preText 非空时直接复用（调用方已完成预检读盘，如 str_replace 唯一性检查），避免双读盘。
    // 注意：本函数不写编码来源——它拿不到本次请求的 holder，且 preText 短路时并未读盘，
    // 编码来源由调用方按返回的 encoding/decided 自行记录（见 readTargetCheckedMeta）。
    // encodingHint：工具自己透传的解码方式（read 的 encoding 参数），由调用方从 holder 透传
    // （本函数自己拿不到 holder）。
    // sessionId：审批发起时的会话，用来取该会话为此文件**记录的**编码（edit/insert 的编码
    // 完全来自它）。由调用方从 holder 透传，理由同上。
    async function readTargetChecked(fp, projRoot, fsService, preText, encodingHint, sessionId) {
      // preText 短路（str_replace 唯一性检查已读盘）只在**未指定编码**时成立：
      // 本函数无法自证 preText 是用哪个编码解出来的，指定编码时若照样短路，
      // 就会返回一段与指定编码不符的文本（编辑预览的磁盘侧内容与编码标注不一致）。
      // 故 encodingHint 非空时一律重新读盘，让该编码真正生效。
      //
      // 当前调用图下 encodingHint 恒为空：它的唯一来源是 holder 的 enc.want =
      // toolDecodeEncoding(...)，而该函数只对 read 返回非空；本函数的调用点全部位于
      // isFileWrite 分支内，read 走的是另一条预览路径。故这个重读分支是**为日后把
      // toolDecodeEncoding 扩展到写类工具预留的契约**，当前不产生额外读盘（勿据「会多读一次」
      // 误判热路径开销）。保留它是因为「preText 与本函数的编码同源」是调用点的性质、
      // 不是本函数能验证的前提——真要扩展时，短路必须失效才不会拿错文本。
      const hintGiven = typeof encodingHint === 'string' && encodingHint
      if (!hintGiven && preText !== null && preText !== undefined) return { ok: true, target: null, info: null, text: preText }
      const st = await statTargetChecked(fp, projRoot, fsService)
      if (!st.ok) return st
      // 记录里的编码（edit/insert 的编码来源）。version 传 stat 拿到的当前版本，让服务用与
      // 写盘路径同一个 isStale 比较，避免预览与工具对「这条记录还算不算数」产生分歧。
      const recorded = recordedEncodingOf(ctx, sessionId, st.target, st.info && st.info.version)
      // 走 readPreviewText：UTF-8 直接读；非 UTF-8 且解码服务在场时由它判定。
      // 写类 diff 同样需要读到非 UTF-8 文件的既有内容，否则编辑预览会报 invalid UTF-8 text。
      const rr = await readPreviewText(fsService, st.target, getFsEncodingService(ctx), st.info && st.info.size, encodingHint, recorded)
      if (!rr.ok) return rr
      return { ok: true, target: st.target, info: st.info, text: rr.text, encoding: rr.encoding, decided: rr.decided }
    }

    // 读盘并把编码来源记到**本次请求的** holder：写类 diff 的 payload 由
    // diffPayloadOrFallback / windowedDiffPayload / previewInsert 等多个构造器产出，
    // 逐个加 encoding/decided 必漏改（漏改即「猜测解码」在对比面板里无标注地当成
    // 文件真实内容展示）。故读盘处统一记录、buildFileDiffData 出口统一附加。
    // holder 由调用方按请求创建（不是 entry 属性），避免并发请求互相覆盖。
    async function readTargetCheckedMeta(enc, fp, projRoot, fsService, preText) {
      const rd = await readTargetChecked(fp, projRoot, fsService, preText, enc.want, enc.sessionId)
      if (rd.ok && rd.encoding && rd.decided) enc.meta = { encoding: rd.encoding, decided: rd.decided }
      return rd
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

    // 编码来源单点附加：各读盘分支都经 readPreviewText 拿到 encoding/decided，
    // 统一记到**本次请求的局部** holder，由 buildFileDiffData 在出口挂到 payload 上——
    // 写类 diff 与撤销预览的 payload 由 diffPayloadOrFallback / windowedDiffPayload /
    // newFilePayload / previewInsert 各自构造，逐个加字段必漏改（漏改即「猜测解码」
    // 在对比面板里无标注地当成文件真实内容展示）。
    //
    // holder 必须是局部对象，**不能挂在 entry 上**：file-diff 是 HTTP 路由且无按 id
    // 串行化（见路由处直接 await），同一 entry 的两个并发请求会交错读写同一字段——
    // 撤销路径的「赋值 → await readByteRange → 出口读取」窗口会让先完成的那次丢掉
    // 标注、或拿到另一次请求的编码（实测复现）。挂 entry 上等于把请求内数据放进
    // 跨请求共享的可变状态。
    function withEncMeta(out, meta) {
      if (out && out.ok === true && meta && meta.encoding && meta.decided) {
        out.encoding = meta.encoding
        out.decided = meta.decided
        // 不下发候选、不设"可否切换"标记：客户端只把编码名与来源显示出来，没有任何
        // 选择/下拉交互。编码基准由**工具自己透传**（read 的 encoding 参数），本插件
        // 不提供第二种选择——预览换一页编码就会与工具实际写入的那一页脱钩，而审批者
        // 正是照这段预览判断是否放行（详见 readPreviewText 的 ③ 注释）。
      }
      return out
    }

    // 工具参数里显式指定的解码方式（预览的磁盘侧基准）。
    // 只有 read 有这个概念：dsh-fs-encoding 的 read 提供 encoding 参数（"Reopen with
    // Encoding" 语义，按它解码）。其余工具的参数**不能**拿来当磁盘侧基准：
    //   · write 的 encoding 只对**新建文件**有效——已存在文件时它会直接抛
    //     E_ENCODING_NOT_APPLICABLE（实测其 tool-write.ts：operation === 'update' 即抛），
    //     而新建文件没有磁盘侧内容可解，故对预览无意义；
    //   · edit / insert **没有** encoding 参数，它们的编码来自插件自己的 encoding memo
    //     （源码注释：Read through the plugin's own path so the encoding memo is populated
    //     and the file is decoded under its real encoding）——那个 memo 不经 ctx.fs 暴露，
    //     permgate 拿不到，故无法据此对齐；
    //   · str_replace_editor **也没有** encoding 参数（实测其 parameters 表只有
    //     command/path/file_text/insert_line/new_str/old_str/replace_all/view_range，
    //     见 dsh-fs-encoding/src/tool-str-replace-editor.ts），其 view 子命令的编码同样走
    //     memo（该文件调 readFile 时不传 encodingHint）。故 **不能**复用 isFileRead 当判据：
    //     那个函数回答的是「这是不是文件读工具」（含 sre view 这一支），而这里要问的是
    //     「该工具是否接受 encoding 参数」。两者混用会让 sre view 上模型多塞的 encoding
    //     被当成预览基准，而 sre 实际按 memo 解码——预览与工具所见脱钩，正是本功能要消除的。
    // 判据因此**只看工具名**：当前只有 read 有该参数（新增带 encoding 的工具时才加进这里）。
    function toolDecodeEncoding(name, args) {
      try {
        if (!DECODE_ENCODING_TOOLS[name]) return null
        const e = args && typeof args === 'object' ? args.encoding : null
        return typeof e === 'string' && e ? e : null
      } catch (err) { return null }
    }

    async function buildFileDiffData(entry, fsService) {
      const name = entry.tool
      const args = parseEntryArgs(entry)
      const fp = pathArg(args)
      // 每次请求各建一个 holder：请求内传递编码来源，请求间互不可见。
      // want 只有一个来源：**工具参数里的 encoding**（read 的 "Reopen with Encoding" 语义，
      // 工具按它解码，预览就该按它解，否则标注与内容都不是工具实际看到的那份）。
      // 没有它时回落到**会话为该文件记录的**编码（edit/insert/write 的编码完全来自那份记录，
      // read 未指定时也回落到它）；再没有就交给解码服务自行判定，服务拒绝就原样报错。
      // 客户端**不能**指定编码：预览换一页就会与工具实际写入的那一页脱钩。
      //
      // sessionId 取自 entry（审批发起时快照的会话），不是「当前会话」：审批可能挂起很久、
      // 期间用户会切会话，而这份记录必须来自**发起该审批的那个会话**——工具用的是它的记录。
      const want = toolDecodeEncoding(name, args)
      const enc = { meta: null, want, sessionId: entry.sessionId || null }
      const r = await buildFileDiffDataRaw(entry, fsService, name, args, fp, enc)
      return withEncMeta(r, enc.meta)
    }

    async function buildFileDiffDataRaw(entry, fsService, name, args, fp, enc) {
      // entry.toolCat 是审批发起时判定的工具归属（见 pendingApprovals 的构造），与本处探测同源；
      // 两者取或，避免 entry 缺该字段时漏判。此处没有发起调用的 exec，探测走全局 agentRef。
      if (entry.toolCat === 'undo' || isUndoNow(name, args, null)) return await buildUndoDiffData(entry, fsService, fp, enc)
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
          // 非 UTF-8 文件（GBK/Big5/…）：streamText 是 UTF-8-only 契约，对这类文件会抛
          // 「invalid UTF-8 text」，且**抛在迭代时**而非调用时（实测：streamText() 正常返回
          // 一个流，for await 第一次取块才抛）——所以不能只包住 streamText() 调用本身。
          // 失败时改走 readPreviewText：它只在 dsh-fs-encoding 的解码服务在场时才继续
          // （没有服务就维持原报错，不自造猜测），拿到的文本再在内存里切窗口。
          try {
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
          } catch (e) {
            // 流式失败才回退（正常 UTF-8 文件不付这份整读代价）
            // 必须复位流式阶段已累积的状态：streamText 是**逐块解码、解码失败才抛**，
            // 前段合法 UTF-8 的块已经 yield 并被上面推入 out——不复位就会把整个窗口
            // 追加在那些残留行之后，预览出现大段重复行、行号错位，outBytes 也会被
            // 双重计费而提前触发 MAX_BYTES 截断。
            out.length = 0
            outBytes = 0
            cut = false
            // read 分支：read 未指定 encoding 时工具也会回落到会话记录（io.js 的
            // `opts.encodingHint ?? memo?.encoding`），故这里同样要带上记录，否则同一份
            // 文件在「AI 指定了编码」与「AI 没指定但会话已记录」两种情况下会解出不同文本。
            const rec = recordedEncodingOf(ctx, enc.sessionId, target, st.info && st.info.version)
            const rr = await readPreviewText(fsService, target, getFsEncodingService(ctx), st.info && st.info.size, enc.want, rec)
            if (!rr.ok) return { ok: false, error: rr.error }
            // 记录编码来源到本次请求的 holder：read 详情同样要能标注编码。
            // read 分支的流式路径在非 UTF-8 文件上必然失败，故只有回退分支会走到这里。
            enc.meta = { encoding: rr.encoding, decided: rr.decided }
            const lines = String(rr.text).split(/\r?\n/)
            // 尾随换行会多出一个空元素：它既不是真实行（不该被渲染成末行并占用行号），
            // 也不该参与「下方还有更多行」的比较（否则文件恰好结束在窗口边界时误报）
            if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
            const slice = lines.slice(winStart - 1, winEnd)
            for (const s0 of slice) {
              if (outBytes >= MAX_BYTES) { cut = true; break }
              let s = s0
              if (s.length > MAX_LINE) { s = s.slice(0, MAX_LINE); cut = true }
              out.push(s)
              outBytes += s.length
            }
            return {
              ok: true, kind: 'read', file: fp, text: out.join('\n'),
              startLine: winStart,
              // 与流式分支同口径：窗口之前确实有内容才算「上方还有更多行」，
              // 否则 offset 越过文件末尾时会对审批者谎报省略行数
              topOmitted: winStart > 1 && lines.length >= winStart,
              bottomOmitted: lines.length > winEnd || cut,
              // 如实标注编码来源：'guessed' 是概率性选择，必须让用户知道不是原文编码
              encoding: rr.encoding,
              decided: rr.decided,
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
      // str_replace_editor 的 undo_edit：写盘的内核（dsh-fs-encoding）已在上面被 isUndo 接走，
      // 能走到这里说明当前内核不写盘 —— 内置没有该命令、better-edit 抛 E_UNSUPPORTED，都没有改动可预览
      if (name === 'str_replace_editor' && sreCommand(args) === SRE_UNDO_CMD) {
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
              const rd = await readTargetCheckedMeta(enc, fp, entry.projRoot, fsService)
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
            // 参数解析（含占位值折算）走 insertArgsOf 单点，与 fs-encoding 的独立 insert 共用
            const { insLine, insText } = insertArgsOf(args, 'new_str')
            const rd = await readTargetCheckedMeta(enc, fp, entry.projRoot, fsService)
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
        // dsh-fs-encoding 的独立 insert 工具（不是 str_replace_editor 的子命令）：
        // 参数 file_path/insert_line/new_string，语义与内置 sre 的 insert 一致
        //（0 基、插到该行之后，范围 [0, 行数]），故复用同一条 previewInsert 路径，不做内核分叉。
        // 同样不能折算成 old_string='' 的 edit —— 理由见上面 sre insert 分支。
        if (isFileInsert(name, args)) {
          // 参数解析走 insertArgsOf 单点（与 sre 的 insert 子命令共用占位值折算规则），
          // 只把内容键名换成该工具的契约名 new_string
          const { insLine, insText } = insertArgsOf(args, 'new_string')
          const rd = await readTargetCheckedMeta(enc, fp, entry.projRoot, fsService)
          if (!rd.ok) return rd
          const fileText = rd.text
          if (overMaxChars(fileText, insText)) return { ok: false, error: bi('文件过大，无法生成对比', 'File too large to compare') }
          // 渲染用行数组保留末尾空行（与既有 insert 预览一致），上限另按工具自己的行计数算：
          // 该工具的 insertAfterLine 以「末尾换行不另开一行、空文件为 []」计数，直接用渲染数组的
          // length 会让合法范围多出一行，预览出一次必然被工具 RangeError 拒绝的插入。
          // 行数组只物化一次，上限由它推导（insertLineCount 接受行数组，不再重复扫全文）。
          const oldLines = splitDiffLines(fileText)
          return previewInsert(fp, oldLines, splitDiffLines(insText), insLine, insertLineCount(oldLines))
        }
        if (tool === 'edit') {
          // dsh-better-edit 兼容：{path, edits:[[remove_from,remove_to,replacement_text],...]} hash 锚点格式。
          // 与旧格式（old_string/new_string）互斥，优先识别 edits 数组。
          if (Array.isArray(args.edits) && args.edits.length > 0) {
            const rd = await readTargetCheckedMeta(enc, fp, entry.projRoot, fsService)
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
          const rd = await readTargetCheckedMeta(enc, fp, entry.projRoot, fsService, sreText)
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
          // 非 UTF-8 文件的编辑预览同样要能读出既有内容（否则直接报 invalid UTF-8 text）。
          // 这里只用于展示 diff；写盘编码由 DSH/编码插件按原编码处理，不受此解码影响。
          // 记录：write 的整文件覆盖同样按**会话记录**里的编码读写既有内容（tool-write 的
          // 基线读不传 encodingHint，走的就是这份记录），故预览必须按同一页解。
          const recW = recordedEncodingOf(ctx, enc.sessionId, target, info && info.version)
          const oldRR = await readPreviewText(fsService, target, getFsEncodingService(ctx), info && info.size, enc.want, recW)
          if (!oldRR.ok) return oldRR
          const oldText = oldRR.text
          // 记录编码来源：write 全文对比同样按解码文本生成，须让客户端能标注
          enc.meta = { encoding: oldRR.encoding, decided: oldRR.decided }
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

    // ── 路径归一的**唯一一份**实现（§5.5）─────────────────────────────────────────
    // isOutside 与 isWorkspaceRoot **必须共用这一份**：两处各手抄一份必然漂移，而漂移的后果是
    // **fail-open** —— 同一路径既不算「外」（isOutside 返 false）又不算「根」（钩子返 false）时
    // 落 inside 档，`rm -rf .` 一族静默放行。设计文档把「口径漂移」列为风险项并要求共用归一逻辑
    // （.plan/blast-tier-plan.md:1800）。这与 blastRadiusOf 里「判据必须直接问 isSystemDir，
    // 不能手抄一份平台分派」是同一类纪律。
    //
    // 盘根 'G:'（norm 剥掉尾斜杠）补回根斜杠：pathResolve('G:') 会落到 cwd 而非盘根；
    // UNC 根 pathResolve 输出带尾部分隔符，前缀判断需按「rr 已以分隔符结尾」分支处理。
    // 根侧归一化的记忆（norm + fixRoot + toLowerCase 三件套）。root 变化时整体失效：
    // 键就是 norm 后的根字符串，换根即重算，不存在读到陈旧结论的路径。
    let rootMemo = null
    const fixRoot = (v) => {
      // 根侧短路：热路径上（shell-parse.js 的逐词元循环对每个判为 inside 的目标各调一次钩子）
      // fixRoot 的一半调用都是**同一个根**，而它是整段循环的不变量。非根的调用不写入记忆，
      // 故不会与目标侧互相驱逐（1 条记忆就够，也不会无界增长）。
      if (rootMemo && v === rootMemo.norm) return rootMemo.fixed
      return pathResolve(/^[a-zA-Z]:$/.test(v) ? v + '/' : v)
    }
    function rootMemoOf(rootKey) {
      const r = norm(rootKey)
      if (!r) return null
      if (!rootMemo || rootMemo.norm !== r) {
        const fixed = pathResolve(/^[a-zA-Z]:$/.test(r) ? r + '/' : r)
        rootMemo = { norm: r, fixed, lower: fixed.toLowerCase() }
      }
      return rootMemo
    }
    // 目标侧归一（相对路径先拼根）—— 返回**未折叠**的绝对形态，fixRoot 由调用方施加
    // （isOutside 要对两侧各折叠一次并做分隔符边界比较，isWorkspaceRoot 只比较相等）。
    // 空/不可读的目标返回 null，由调用方按各自的方向处置。
    function absOf(p, rootNorm) {
      const s = norm(p)
      if (!s) return null
      return (s.indexOf('/') === 0 || /^[a-zA-Z]:/.test(s)) ? s : rootNorm + '/' + s
    }

    function isOutside(p, rootKey) {
      const rm = rootMemoOf(rootKey)
      // 空根判「非工作区外」（fail-open）：这正是 rootOf 的兜底不可为空的原因
      if (!rm) return false
      const r = rm.norm
      const abs = absOf(p, r)
      if (abs === null) return false
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

    // 「这个目标就是工作区根本身吗」—— 给解析器的 `isWorkspaceRoot` 钩子用（§5.5）。
    //
    // 为什么解析器判不了、必须由宿主给：`blastRadiusOf` 把 `rm -rf .` / `rm -rf *` 的目标
    // 经 globRootOf 归约为 `.`，再问 isOutsideWorkspace —— 而 `.` 显然是「区内」，
    // 于是段级 blast 为 null，大分类 allow 时**删掉整个项目不弹窗**（一族五种写法实测全落 inside）。
    // 解析器不知道工作区根在哪，这个事实只有宿主有。
    //
    // **必须与 isOutside 同口径**（相对路径先拼根、再 pathResolve 归一）：
    // 两者若在边界上打架，同一路径可能既不算「外」（isOutside 返 false）又不算「根」
    // （本函数返 false），落进 inside 静默 —— 那正是要堵的洞，只是换了个地方出现。
    // 归一逻辑**真的只有一份**：本函数与 isOutside 都调 absOf / fixRoot（§5.5）。
    // 曾经这里是手抄的第二份副本，且两处已经结构性分叉（本函数多一句 `if (!s) return false`、
    // 尾部比较也不同）—— 那正是文档列为风险项的「口径漂移」。
    //
    // 钩子收到的是 **globRootOf 的结果**（解析器传的是 `blast.path`），故 `*`、`./*`、
    // `.\*` 与绝对路径写法都能命中，而 `..`、`./build`、`src/tmp` 不会误判。
    //
    // 性能：解析器在 `blastRadiusOfSegment` 的**逐词元循环**里对每个判为 inside 的目标各调一次
    // （调用点就在该函数的循环体内；此处**不写行号** —— 跨文件行号会随 shell-parse.js
    // 的增删漂移，函数名才是稳定锚点），而根侧取值在整段循环里是不变量 —— 故根侧计算走
    // rootMemoOf 的记忆化（约 1 µs/次 → 0），本函数内只留 `norm(p)` 与一次 pathResolve 比较。
    // 实测 `rm -rf` + N 个区内路径：N=30000（546 KB）时 68.6 → 39.5 ms（回到 N=10000 的量级）。
    // 命令文本由 AI 生成、参数个数无上界，这条热路径不该随参数个数线性付常量开销。
    function isWorkspaceRoot(p, rootKey) {
      const rm = rootMemoOf(rootKey)
      if (!rm) return false
      const abs = absOf(p, rm.norm)
      if (abs === null) return false
      return fixRoot(abs).toLowerCase() === rm.lower
    }

    function callKey(name, args) {
      return name + '\u0000' + safeJson(args)
    }

    // 循环状态按**会话**分桶：键取 exec.agent.session.id（与 askUser 里下发给客户端的
    // sessionId 同源）。取不到时返回 null，调用方据此**既不读也不写**。
    //
    // 为什么取不到时直接跳过检测，而不是回落成一个全局共享桶：共享桶等于把「A 会话连续 4 次
    // → B 会话第 1 次就被牵连」原样保留。方向虽然不危险（多弹窗），但会误伤正常工作流。
    // 循环检测只是「额外提醒」，拿不准会话身份时不提醒是安全的（最坏少一次提醒，
    // 不会放宽任何权限）—— 方向 fail-closed。
    // 也**不能**为每次调用建一个独立桶：那会让 Map 无界增长，或把真实会话的桶挤出淘汰。
    function loopSessionKey(exec) {
      try {
        const id = exec && exec.agent && exec.agent.session && exec.agent.session.id
        return typeof id === 'string' && id ? id : null
      } catch (e) { return null }
    }

    // 判定：本次调用**之前**已连续静默放行了几次。decide() 在记录之前调用，故读到的是「之前」。
    // 键不同（或该会话没有桶）一律返回 0 —— 断链即重新计数，不需要数组那种回扫。
    function repeatStreak(sessionKey, name, args) {
      if (!sessionKey) return 0
      const s = streakBySession.get(sessionKey)
      if (!s || s.key !== callKey(name, args)) return 0
      return s.count
    }

    // 记录：**只在静默放行时**调用（L-2）。其余动作走 resetStreak（L-11）。
    // 两者口径不同是**有意的**：循环检测要抓的是「用户没看见的重复」（静默放行在烧 token
    // 而无人察觉）；弹窗批准时用户本来就在环里、每次都看到了，提醒是冗余的。
    // 审计（recordDecision）则是另一回事，它记全部动作、保持原位不动 —— 不要在这一点上「统一」。
    function noteLoopCall(sessionKey, name, args) {
      if (!sessionKey) return
      const key = callKey(name, args)
      const s = streakBySession.get(sessionKey)
      if (s && s.key === key) {
        s.count += 1
        // LRU：命中后把该桶移到 Map 末尾（delete + set 重排插入顺序），
        // 这样淘汰掉的总是「最久没活动」的会话，活跃会话不会被误伤。
        streakBySession.delete(sessionKey)
        streakBySession.set(sessionKey, s)
      } else {
        streakBySession.set(sessionKey, { key, count: 1 })
      }
      while (streakBySession.size > SESSION_BUCKET_MAX) {
        const oldest = streakBySession.keys().next()
        if (oldest.done) break
        streakBySession.delete(oldest.value)
      }
    }

    // 清零（L-11 / fire-and-reset）：**任何非静默放行的调用**都把该会话的连续计数清零。
    //
    // 为什么清零而不是继续累积：累积模式下，触发后用户点一次「允许」并不能让提醒停下来
    // ——计数仍 ≥ 阈值，之后每次相同调用都弹窗。这与「用户已表态」的直觉相反。
    // 顺带解决了「被拒调用是否清零」这个 L-2 没说清的问题：否则会出现
    // 「4 次静默放行 → 被拒 → 再静默放行」时计数仍停在 4 的怪状态。
    // 与参考工程一致（其注释原文：a human allow never buys a permanent exemption）。
    function resetStreak(sessionKey) {
      if (!sessionKey) return
      streakBySession.delete(sessionKey)
    }

    function quickAction(name, root) {
      const proj = projectBlock(root)
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

    // ── 意图取值链（六级）────────────────────────────────────────────────────
    // 弹窗「意图说明」框的内容来源，按**具体度**从高到低：
    //
    //   ① justification  提权意图  —— 模型为这次提权专门写的一句话
    //   ② description    执行意图  —— 命令/任务描述（命令类工具必有）
    //   ③ 模型说的话      模型意图  —— 发起这次调用的那条 assistant 消息的 text 块
    //   ④ 思考末尾        模型思考  —— 同一条消息的 reasoning 块（③ 与 ④ **同源**）
    //   ⑤ 用户说的话      用户意图  —— 最近一条**真人**输入
    //   ⑥ 机械标签        操作概要  —— describeIntent（永不为空）
    //
    // 每一级**自带标签**（intentFor 一并返回），因为六级回答的是**不同的问题**：
    // ③ 是「这一步要干什么」，⑤ 是「你要的最终结果」，⑥ 只是「这是什么操作」。
    // 此前一律挂「意图说明」的牌子，等于让 ⑤⑥ 冒充 ③。
    //
    // ③④ 同源：一次 callId 定位，两种块各试一次。但**同源不等于够用** ——
    // 实测（一次真实会话，逐条核对投影后的消息）确实存在「自己那条一个文字块都没有」
    // 的工具调用：seq 160 的 edit 只含 tool-call，而描述它的那句话在 seq 155（上一个 step）。
    // 故 ③④ 落空后还要**往前扫有限步**，见 intentLookback。
    //
    // 为什么是「限定步数」而不是「划轮边界」：第一版按 source.kind 白名单判定轮边界
    // （只有已知注入类可跨越），方向对但清单穷举不了 —— 第三方插件会持续引入新 kind
    // （实测 dsh-loop-guard 的 'loop-guard' 935 次、'compact-checkpoint' 198 次、
    // 'plan-mode' 36 次都不在白名单里），它们被误判成轮边界，回溯提前终止。
    // 949 会话实测：需回溯 43454 次，其中 1849 次（4.3%）被这类假边界挡掉、退化成 ⑤。
    // 改成限定步数后，覆盖率 93.5%、跨轮 0.01%（3/38219）—— 两个指标都优于旧版。
    // 取舍与依据详见 INTENT_LOOKBACK_STEPS 常量处。

    // 块 → 文本。只认 type，不做「兜底猜字段」：
    // 旧实现有 `typeof b.text === 'string'` / `typeof b.content === 'string'` 两条猜测分支，
    // 会让**任意**带 text/content 字段的非文本块（如 tool-call 的 arguments 若改名叫 text）
    // 混进意图。ContentBlock 是 merge-extensible 联合，类型由 type 判别，按 type 取才稳。
    function textOfBlock(b) {
      if (!b || typeof b !== 'object') return ''
      return b.type === 'text' && typeof b.text === 'string' ? b.text : ''
    }

    function reasoningOfBlock(b) {
      if (!b || typeof b !== 'object') return ''
      return b.type === 'reasoning' && typeof b.text === 'string' ? b.text : ''
    }

    // ④ 思考末尾：取末尾 REASONING_TAIL_CHARS 字符，再**按行收敛**。
    //
    // 规则（用户方案）：切点落在行中间时，那半行不要 —— 宁可少显示一行，
    // 也不给审批人看半句话。切点正好落在行首时第一行其实也完整，但**无法判断**，
    // 故一律丢弃首行（保守方向，代价很小）。
    //
    // 换行三态都要认：\r\n（Windows 模型输出常见）、\n、\r。
    function reasoningTail(s) {
      const full = String(s == null ? '' : s).trim()
      if (!full) return ''
      let t = full
      if (full.length > REASONING_TAIL_CHARS) {
        let cut = full.length - REASONING_TAIL_CHARS
        // 代理对不能切一半：低位代理（DC00-DFFF）说明切点落在字符中间，往回退一格。
        const c = full.charCodeAt(cut)
        if (c >= 0xdc00 && c <= 0xdfff) cut += 1
        t = full.slice(cut)
        // 首行是否被切断，只看**切点是否落在行首**：nl > 0 说明切点之后还有内容
        // 才遇到换行 ⇒ 首行是半行，丢掉。nl === 0（切点正好落在换行上）时首行不存在，
        // nl === -1（整段无换行）时按用户规则「直接用这 100 字符」，都不丢。
        const nl = t.search(/[\r\n]/)
        if (nl > 0) t = t.slice(nl)
      }
      // 收敛成单行：意图框是一行标签 + 一段文字，多行会把卡片撑高。
      return t.replace(/[\r\n]+/g, ' ').trim()
    }

    // ③④ 的共同定位：**哪条 assistant 消息里含有 id === exec.callId 的 tool-call 块**。
    // 这是构造上的精确对应（tool-call 块带 id，exec.callId 就是它），不是时间上的「最近」。
    //
    // 返回 { msg, msgs } 而不是只返回 msg：调用方（③ 落空后的回溯）需要同一份消息表
    // 来定界与继续往前扫。这里返回它，就省掉第二次 session.deriveMessages() ——
    // 那是纯开销（该方法内部走缓存，但每次仍要建一份快照数组）。
    function assistantMessageForCall(exec) {
      try {
        const callId = exec && exec.callId
        if (!callId) return null
        const agent = (exec && exec.agent) || agentRef
        const session = agent && agent.session
        if (!session || typeof session.deriveMessages !== 'function') return null
        const msgs = session.deriveMessages()
        for (let i = msgs.length - 1; i >= 0; i--) {
          const m = msgs[i]
          if (!m || m.role !== 'assistant') continue
          const c = m.content
          if (!Array.isArray(c)) continue
          for (const b of c) {
            if (b && b.type === 'tool-call' && b.id === callId) return { msg: m, msgs }
          }
        }
        return null
      } catch (e) { return null }
    }

    // 「消息 → 文本」的**单一来源**（③④⑤ 与回溯共用同一套口径）。
    // 兼容 content 为裸字符串的形态（历史消息可能有），其余按块类型取。
    // 曾按角色分成两份（assistant 版不认裸字符串、user 版认）—— 那是漂移面：
    // 同一形态在 ③④ 被判「无文字」而在 ⑤ 有文字，取值规则一改就要两处同改。
    function messageTextOf(m) {
      if (!m) return ''
      const c = m.content
      if (typeof c === 'string') return c.trim()
      if (!Array.isArray(c)) return ''
      let out = ''
      for (const b of c) out += textOfBlock(b)
      return String(out).trim()
    }

    function assistantReasoningOf(m) {
      if (!m || !Array.isArray(m.content)) return ''
      let out = ''
      for (const b of m.content) {
        const r = reasoningOfBlock(b)
        if (r) out += (out ? '\n' : '') + r
      }
      return out.trim()
    }

    // 「这条消息是不是模型产生的」：判**来源**，不是判角色。
    //
    // 为什么不能只判 role === 'assistant'：DSH 的 live append 路径**不校验**消息来源 ——
    // 强制 `assistant ⇒ kind:'model'` 的 assertMessageEventShape 只在 seed/restore 时调用，
    // append 只过 validateSessionEventData（该函数对 user/assistant 角色不作要求），
    // 投影层 deriveEventMessage 又是原样透传。实测：往 user/message 事件里塞
    // { role:'assistant', source:{ kind:'任意' } } 的消息，deriveMessages() 原样返回。
    // 弹窗是审批依据，把这类文本挂「模型意图」＝ 让第三方插件替模型说话。
    //
    // 真实模型消息的 source.kind 恒为 'model'（createAssistantMessage 构造时即带上），
    // 故这条判据不会误伤。
    function isModelMessage(m) {
      if (!m || m.role !== 'assistant') return false
      const src = m.source
      return !!src && src.kind === 'model'
    }

    // 一条**模型消息**能提供的意图候选：text 优先、reasoning 次之，各带自己的标签。
    // ③④（owner 那条）与回溯（往前扫到的每条）都走这里 —— 两处各写一遍的话，
    // 改标签措辞或调换优先级时漏改一处，同一条消息就会在两个入口给出不同结果。
    function modelIntentOf(m) {
      if (!isModelMessage(m)) return null
      const t = messageTextOf(m)
      if (t) return { raw: t, label: bi('模型意图', 'Model intent') }
      const r = assistantReasoningOf(m)
      if (r) return { raw: reasoningTail(r), label: bi('模型思考', 'Model reasoning') }
      return null
    }

    // ③ 的补充定位：**自己那条没有文字块时，往前扫有限步，找最近的一条可用文本**。
    //
    // 为什么需要它（实测）：DSH 一个 step 产出一条 assistant 消息，而「模型先说一句、
    // 再连发几个工具调用」的形态里，文字只落在**其中一条**上。逐条核对真实会话记录
    // （按 deriveEventMessage 投影后的结构，42 个 tool-call）：39 个（93%）自己那条就带文字，
    // 剩 3 个不带 —— 其中就有弹窗上显示成「用户意图」的那次 edit（文字在上一 step 的消息里）。
    // 比例不高但后果显眼：审批人看到的是自己上一句话，而不是模型这一步要干什么。
    //
    // 命中三类之一即停（各带自己的标签，与 ③④⑤ 同一套）：
    //   · 模型的文本   → 模型意图
    //   · 模型的思考   → 模型思考
    //   · 用户的文本   → 用户意图（判据同 ⑤：source.kind === 'user'）
    // 其余消息一律跳过且**不终止**：注入、goal/schedule/webhook 这类开轮消息、tool 结果、
    // 以及 loop-guard / compact-checkpoint / plan-mode 这类第三方或未列出的 kind。
    //
    // ⚠️ 两类消息都必须按 source.kind 判，不能只看 role：
    //   · user 角色是**任何生产者都能投递**的公共车道。loop-guard 的注入就是 user 角色 + text
    //     块（正文如「你的思考内容已连续重复 987 个字符而没有进展…」，本机 738 次落在回溯窗口内），
    //     goal 的正文是 <goal_round> 包装、compact-checkpoint 是「This is an automatically
    //     generated checkpoint…」；放宽成「任何 user 角色」就会把这些当意图糊到审批人脸上，
    //     正是 ⑤ 当初修掉的那个症状。
    //   · tool 结果也要排除。它投影出的消息 role 恒为 'tool'（实测 957 会话 184647 条，
    //     100% 是 role='tool'，role='user' 0 条；口径：tool/result 事件的 data.message.role，
    //     与投影规则 deriveEventMessage 的 `case "tool/result": return event.data.message` 一致）。
    //     故它在下面的循环里既非 assistant 也非 user，会自然落到下一格。
    //     ⚠️ 此处曾写作「投影出两种角色（role='tool' 184390、role='user' 129868）」——
    //     实测不成立，且 129868 对不上任何一种口径（全表 user 也只有 14994 条，
    //     那是 user/message 事件投影来的，不是 tool 结果）。结论不变但依据必须是真的。
    //   · assistant 角色同理不可信：live append 不校验来源（见 isModelMessage），
    //     只判 role 就会让第三方插件伪造的 assistant 文本冒充「模型意图」。
    //
    // 步数口径：**扫过的消息条数**（含 tool 结果与注入消息）。实测消息序列是
    // assistant / tool / assistant / tool …，故 N=6 约等于「往回看 3 条 assistant 消息」。
    // 步数上限的依据见 INTENT_LOOKBACK_STEPS 常量处（949 会话实测的覆盖率-跨轮权衡）。
    //
    // 起点是**被审批调用自己那条消息**（owner），不是消息表末尾：同一轮里可能有多个
    // 工具调用，先审批的那个执行时，后面的消息未必已经存在；从末尾起扫会越界到本次调用
    // **之后**的消息。owner 为 null（callId 定位不到）时直接放弃 —— 定位不到就无从知道
    // 当前位置在哪，此时硬扫等于按时间猜。
    //
    // 返回 { raw, label }（raw 未经裁剪，由调用方过 level 的 cut）；找不到返回 null，
    // 让调用方继续落到 ⑤，而不是硬凑一个。
    function intentLookback(msgs, owner) {
      try {
        if (!Array.isArray(msgs) || !owner) return null
        const from = msgs.indexOf(owner)
        if (from < 0) return null
        let steps = 0
        for (let i = from - 1; i >= 0 && steps < INTENT_LOOKBACK_STEPS; i--) {
          // 先计步、再判形状：步数是「扫过几条」的预算，非对象条目也占一格。
          // 反过来写（形状不合格就 continue 且不计步）会让这类条目免费通过、上界被无限稀释 ——
          // 实测消息表里确实会出现裸字符串这类非对象条目（deriveMessages 只判 truthy 就 push）。
          steps++
          const m = msgs[i]
          if (!m || typeof m !== 'object') continue
          if (m.role === 'assistant') {
            // 与 ③④ 同源（text 优先、reasoning 次之），且**最近一条命中的胜出**，
            // 不是「整段窗口里优先 text」；来源判据也在 modelIntentOf 里面。
            const hit = modelIntentOf(m)
            if (hit) return hit
            continue
          }
          if (m.role === 'user') {
            const src = m.source
            if (!src || src.kind !== 'user') continue
            const t = messageTextOf(m)
            if (t) return { raw: t, label: bi('用户意图', 'User intent') }
            continue
          }
        }
        return null
      } catch (e) { return null }
    }

    // ⑤ 用户说的话：**白名单**过滤。
    //
    // 为什么必须是白名单（旧实现是黑名单，只挡 tool/plugin）：
    // MessageSourceMap 的契约是 merge-extensible 联合，注释写死了 ——
    // 「Model and tool sources answer their role messages; **user messages carry any
    // producer's kind**, and consumers fall through unknown kinds」
    // （dsh-llm/lib/types/message.d.ts:95-99）。
    // 即 **user 角色是「任何生产者都能投递」的公共车道**，真实人类输入的 kind 恰好是 'user'
    // （dsh-api-session-controller/lib/index.js:856 prompt() 的 source）。
    //
    // 黑名单漏判的失败方向是**往审批人脸上糊几百字注入文本**（实测：dsh-tool-skill 的
    // skill 目录带 kind:'skill-catalog'，既非 tool 也非 plugin，整段 <system-reminder>
    // 灌进了意图框）；白名单漏判只会返回空串、落到下一级。
    // 且注入消息都排在本轮用户消息**之后**，跳过它们正好命中发起本轮的那句话。
    //
    // 保留展示的两类 kind:'user' 但非键盘输入：subagent 的 prompt（父 agent 写给子会话的
    // 任务正文）与 plan mode 的 steer（/plan 附带的正文）—— 两者确是本会话的输入。
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
          if (!src || src.kind !== 'user') continue
          const text = messageTextOf(m)
          if (text) return text
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

    function argJustification(args) {
      try {
        if (!args || typeof args !== 'object') return ''
        const j = args.justification
        if (typeof j === 'string' && j.trim()) return j.trim()
        return ''
      } catch (e) { return '' }
    }

    // 六级取值链的**唯一出口**：返回 { text, label }，两者都是 bi 对象，text 恒非空。
    //
    // ⚠️ text 必须是 bi 而**不是裸字符串**：entry.intent 历来是 bi，由投影层 L(e.intent, lang)
    // 按语言取（用户切语言时弹窗要跟着变）。①-⑤ 的文本是模型/用户原话、无需翻译，
    // 但仍要包成 bi(s, s) 以维持这一契约；⑥ 的 describeIntent 本来就产出 bi。
    // 曾经这里对 ⑥ 直接 String(bi) ⇒ entry.intent 变成 "[object Object]"。
    //
    // 裁剪在**这里**统一做（INTENT_MAX_CHARS），不散到各取值函数里 ——
    // 散着切必然漏（description 就是这么漏成无上限的），且口径会分叉（曾有 200/80/无 三种）。
    function intentFor(exec, d) {
      const asBi = (v) => {
        if (typeof v === 'string') return bi(v, v)
        return (v && typeof v === 'object') ? v : bi('', '')
      }
      const cutOne = (s) => {
        const t = String(s == null ? '' : s).trim()
        return t.length > INTENT_MAX_CHARS ? t.slice(0, INTENT_MAX_CHARS) + '…' : t
      }
      // 两种语言各自独立裁剪：中英前缀长度不同（「执行命令 」5 字 vs「Run command 」12 字），
      // 按同一数值分别切才是「每种语言都最多 120 字」。
      const cut = (v) => { const o = asBi(v); return bi(cutOne(o.zh), cutOne(o.en)) }
      const args = exec && exec.arguments
      // 逐级**惰性**求值，命中即返回。不写成「先构造五元组再遍历」——
      // 那样即使 ① 命中也会把 ③④⑤ 全算一遍，其中 ③④⑤ 都要调 session.deriveMessages()
      // （⑤ 还要倒序扫全表），在一次审批的入口路径上白付三遍。
      const level = (raw, label) => {
        const text = cut(raw)
        return (text.zh || text.en) ? { text, label } : null
      }
      // 「候选 { raw, label } → 过 cut 的一级」：③④ 与回溯都由取值函数带回自己的标签，
      // 故这里只负责裁剪与空判定（标签不再由调用方各写一份）。
      const levelOf = (cand) => (cand ? level(cand.raw, cand.label) : null)
      const hit =
        level(argJustification(args), bi('提权意图', 'Escalation intent')) ||
        level(argDescription(args), bi('执行意图', 'Execution intent'))
      if (hit) return hit
      // ③④ 同源：定位一次，两种块各试一次（见上方注释）。
      const located = assistantMessageForCall(exec)
      if (located) {
        const h3 = levelOf(modelIntentOf(located.msg))
        if (h3) return h3
        // 自己那条一个文字块都没有 —— 往前扫有限步（同一份消息表，不再调 deriveMessages）。
        // 这一步可能命中的三类各带**自己的标签**（模型意图 / 模型思考 / 用户意图），
        // 因为往回扫有可能先撞上「本轮开头用户那句话」——那时说成「模型意图」就是不实的。
        const h3b = levelOf(intentLookback(located.msgs, located.msg))
        if (h3b) return h3b
      }
      const h5 = level(recentUserText(exec), bi('用户意图', 'User intent'))
      if (h5) return h5
      // ⑥ 兜底：describeIntent 的结果自带「执行命令 …」前缀，本身已说明是什么操作，
      // 标签用「操作概要」。它**不含任何意图信息**，故不叫「意图」。
      return { text: cut(describeIntent(exec, d)), label: bi('操作概要', 'Operation summary') }
    }

    function describeIntent(exec, d) {
      const t = exec.name
      const v = d.value !== undefined && d.value !== null ? String(d.value) : ''
      if (d.kind === 'command' && v) {
        // 取第一段作为意图摘要：与判定同源（同一份 decomposeCommand + 同一方言）。
        // 不再自己 split(/[;|]/) —— 那是本文件里的第三份分段实现，口径与判定侧不一致时
        // 会给出与实际判定无关的摘要。
        // 方言必须按工具取（曾经硬编码 'bash'）：pwsh 工具用 bash 词法器分解时，
        // `\` 会被当转义符吃掉、尾部反斜杠直接判失败，摘要与判定看到的不是同一条命令。
        // 判定结果里已带 segments（commandDecision 下发的），有就直接复用，省掉第二次分解。
        let first = v
        if (d.segments && d.segments.length) first = d.segments[0].text
        else {
          const dec = decomposeCommand(v, SHELL_OF_TOOL[exec.name] || 'bash')
          if (dec.ok && dec.segments.length) first = dec.segments[0].text
        }
        // 段文本**不在这里截断**：整条意图链的裁剪统一由 intentFor 的 cut 做（INTENT_MAX_CHARS）。
        // 这里曾有一道 `> 80` 的内切，是链条上的第二套口径 —— 它与 intentFor 的 120 叠加后，
        // 实际显示长度取决于「先撞到哪一个」，改上限时必漏一处。
        return bi('执行命令 ' + first, 'Run command ' + first)
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
      // 尾部分隔符剥离用**线性 while**（同 normPathKey 的理由）：这一份曾经被漏掉，
      // 而它的入参是**未归一的原始** `pathArg(args)`（工具调用里的 file_path 原文，
      // 由 AI 生成、长度无上界），调用点是审批入口的 humanArgsPreview —— 40 KB 的
      // 连续斜杠串会让弹窗出现前多付约 350 ms。语义与 norm() 完全一致。
      let s = String(p || '').replace(/\\/g, '/')
      let end = s.length
      while (end > 0 && s.charCodeAt(end - 1) === 47) end -= 1
      if (end !== s.length) s = s.slice(0, end)
      const idx = s.lastIndexOf('/')
      return idx >= 0 ? s.slice(idx + 1) : s
    }

    // d：本次判定结果（可选）。命令工具会带 segments，用于**按段展示**命令 ——
    // 审批人要能看清这条命令由几段组成、每段是什么：旧实现把整条命令塞成一行，
    // `git status && rm -rf ~/.dsh` 在弹窗里只是一条长字符串，而真正需要人看的恰恰是第二段。
    function humanArgsPreview(name, args, exec, d) {
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
        // 意图框是否已被 ① 级 justification 独占 —— 决定 description 要不要在参数框补位。
        //
        // 判据直接调 `argJustification`（① 级的**唯一**取值函数，intentFor 也调它），
        // 不另写一份「args.justification 非空」：那是同一条链的第二份口径，日后 ① 级
        // 改名、加白名单或改裁剪时，两处必然漂移，而漂移的后果正是下面要防的那个洞。
        // `argJustification` 自身已做 trim + 非空判定，`!!` 与 intentFor 里
        // `level(...)` 的命中判据等价（cut 对非空串恒非空）。
        const escOwnsIntent = !!argJustification(args)
        // 补位值。与 `escOwnsIntent` **同构**：也走该级的唯一取值函数 `argDescription`
        // （② 级，intentFor 调的是同一个），不写裸判据。
        //
        // ⚠️ 曾写 `typeof args.description === 'string' && args.description`：那是**裸真值判断、
        // 不 trim**，于是纯空白的 description（'   '）能通过守卫，而下面的 push 只挡空串
        // （`if (!s) return`）不挡空白 —— 参数框会多出一条视觉上全空的「说明：」行。
        // 两个半边一个 trim 一个不 trim，正是本条要消除的口径分叉。
        const descFallback = escOwnsIntent ? argDescription(args) : ''
        if (isUndoNow(name, args, exec)) {
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
            : (name === 'edit' ? t('修改', 'Edit') : (isFileInsert(name, args) ? t('插入', 'Insert') : t('写入', 'Write')))
          push(wLabel, fp ? baseName(fp) : '', fp ? { path: fp } : undefined)
          if (fp) push(t('路径', 'Path'), fp, { path: fp })
          // 插入位置是审批时的关键信息（0 = 文件最顶端），单列一行而不是混在内容里
          if (isFileInsert(name, args)) push(t('插入到第几行之后', 'Insert after line'), args.insert_line)
          const content = typeof args.content === 'string'
            ? args.content
            : (typeof args.new_string === 'string'
              ? args.new_string
              : (typeof args.new_str === 'string' ? args.new_str : (typeof args.file_text === 'string' ? args.file_text : '')))
          if (content) push(t('内容', 'Content'), content.length > 140 ? content.slice(0, 140) + '…（共 ' + content.length + ' 字符）' : content)
        } else if (COMMAND_TOOLS[name]) {
          const segs = (d && Array.isArray(d.segments)) ? d.segments : null
          // ── 档位标签（§7.2b）────────────────────────────────────────────────────
          // `codeLabel(s.code)` 只回答「为什么被标出来」（破坏性命令 / 无法解析 / 重定向到
          // 工作区外），而弹窗的段级标注**只有这一个来源** —— 于是这些命令在弹窗上
          // 显示**完全一样**（实测）：
          //     sudo ls / sudo rm -rf /etc / kill 1234 / shutdown /s / taskkill /im x.exe
          //     reg delete HKLM\Software\X /f / set-executionpolicy unrestricted
          //     diskpart / rm -rf ./build        → 全部「破坏性命令」
          // **这不是可选优化，是接线的一部分**：本计划把八档拆开供用户分别配置，
          // 但若弹窗上全写「破坏性命令」，用户看到 `kill 1234` 弹窗时**不知道该去调哪个开关**
          // —— 面板上八个下拉框，弹窗上零个线索指向它们。
          //
          // `sudo rm -rf /etc` 显示**两个**标签，正好回答那个困惑：
          // 「我把大范围设成允许了，为什么还问？」→ 因为提权档也在管。
          //
          // `tiers` 是**集合**而不是「胜者」单值，因为一个段可以同时命中多档
          // （`sudo rm -rf /etc` = wide + priv，两档都在生效）—— 填单值必然漏掉另一个。
          //
          // 显示形状：`破坏性命令[大范围][提权]` —— 档位标签接在 code 标签之后，
          // 两者语义不同故都保留（code 说「为什么标出来」，tiers 说「哪一档在管它」）。
          const noteOf = (sg) => {
            const tag = codeLabel(sg.code)
            const tags = (sg.tiers || []).map((x) => tierLabel(x)).filter(Boolean).map((x) => L(x, lang)).join('')
            return (tag ? L(tag, lang) : '') + tags
          }
          if (segs && segs.length > 1) {
            for (let i = 0; i < segs.length; i++) {
              const s = segs[i]
              // 段号 + 引出该段的操作符：`段 2 &&` 一眼看出这是 `&&` 后面的那一段
              const label = t('段', 'Seg') + ' ' + (i + 1) + (i === 0 ? '' : ' ' + s.op)
              const nt = noteOf(s)
              push(label, s.text, nt ? { note: nt } : undefined)
            }
          } else {
            // ── 单段命令也要带档位标签 ────────────────────────────────────────────
            // 这里的条件是 `segs.length > 1`（**不改**）：改成 `>= 1` 会让单段命令的
            // label 从「命令」变成「段 1」，措辞反而变差。故只给这一行加 note。
            // 修之前 `sudo ls` **连「破坏性命令」都不显示**（实测）。
            const nt = segs && segs.length === 1 ? noteOf(segs[0]) : ''
            push(t('命令', 'Command'), args.command || '', nt ? { note: nt } : undefined)
          }
          // ⚠️ `args.description` 平时**刻意不在这里显示**。
          //
          // 它的 schema 定位就是「给人看的一句话」，不是执行参数 ——
          // dsh-tool-pwsh 的 schema 原文：「Clear, concise description of what this
          // command does in active voice, 5-10 words **(shown in the UI)**」。
          // 而本插件已把它作为意图链的第 ② 级消费（argDescription → intentFor），
          // 弹窗顶部那个意图框显示的就是它。此处再 push 一行「说明」，就是
          // **同一个值被两条独立路径各渲染一次**（实测：命令弹窗上意图框与参数框
          // 逐字重复同一句 "Inspect raw bytes for BOM and line endings"）。
          //
          // 删这一行而不是删意图链的 ② 级：意图框才是它该待的地方（它答的是
          // 「这条命令要干什么」，正是意图框的问题）；参数框该放的是 command /
          // timeoutMs / workdir 这类**真正参与执行**的值。
          // 段文本（上面的「段 N」行）已经把命令全文摊开了，再补一行说明等于
          // 同一条信息在卡片上出现第三次。
          //
          // ⚠️ 但「意图框独占它」有**一个例外**：① 级 justification 命中时，
          // 意图框装的是提权理由（且标签是「提权意图」），② 级根本没被求值
          // —— `intentFor` 是 `level(①) || level(②)` 的短路求值。
          // 而宿主 pwsh/bash 的 schema 里 `description` 是 **required: true**、
          // `justification` 是「Required with sandbox_permissions」：**提权调用
          // 必然同时带两者**。此时若仍不显示，description 在弹窗上就**一处都没有**
          // —— 参数框只有「命令」行，且客户端在 argLines 非空时不回落 argsJson
          // （client.js 的 argsBox：`p.argLines.length ? map(...) : p.args`）。
          // 那等于在**风险最高的那类审批**（提权）上，比普通命令少显示一条信息：
          // 意图框只剩「为什么提权」，而「这条命令要干什么」的自述消失了。
          // 故这里按 `escOwnsIntent` 补位 —— 补的**只在这一种情况下**发生，
          // 普通调用的去重效果原样保留。值走 `descFallback`（见其定义处：与守卫同源、
          // 已 trim，空白串不会产出空行）。
          if (descFallback) push(t('说明', 'Description'), descFallback)
        } else if (name === 'web_search' || name === 'web_fetch') {
          if (typeof args.query === 'string') push(t('查询', 'Query'), args.query)
          if (typeof args.url === 'string') push('URL', args.url)
        } else {
          if (fp) push(t('路径', 'Path'), fp)
          // 同上的理由：subagent / workflow 的 description 也写着 "for display"
          // （dsh-tool-subagent schema：「A short (3-5 word) description of the
          // delegated task, for display.」），同样由意图链 ② 级消费。
          // 这里一并删掉 —— 否则同一个重复会在 subagent / workflow 弹窗上复现，
          // 只是那些弹窗不常开、不易撞见。
          //
          // ⚠️ 补位条件与命令分支**同一口径**（同一个 `escOwnsIntent`）：
          // subagent/workflow 自身没有 justification 参数，但这一分支还会接住
          // **外装 MCP 工具**（mcp__* 走兜底），它们的参数表由外部服务器定义、
          // 可以同时带 justification 与 description。此时 ① 级独占意图框、
          // ② 级未被求值，description 同样会一处都不显示。
          // 判据共用同一个变量而不是各写各的，是为了让「意图框装了什么」与
          // 「参数框补了什么」永远由**同一个**条件决定。
          if (descFallback) push(t('说明', 'Description'), descFallback)
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

    function outsideMatrix(catKey, fp, root) {
      const d = resolveCategory('directory', fp, 'path', root)
      const e = resolveCategory(catKey, fp, 'path', root)
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
      // 本会话的工作区根：全部判定（例外匹配、工作区内外、写盘归属）都必须基于它。
      // 从 exec 派生而非读全局变量：否则并发会话会互相改写，导致 isOutside 用错根
      // 把工作区外路径判成区内、直接跳过目录闸（fail-open）。
      const root = rootOf(exec)
      // 自定义文字分两种，用途不同、不可互换，且**在数据层彻底分离**：
      //   reason —— 拒绝理由，会随 kind:'deny' 回给 AI（「为什么被拒、该怎么改」）；
      //             例外的 reason、分类默认值的 reason、兜底/快捷工具拒绝时的 reason 都走它。
      //   note   —— ask 例外的备注（「当初为什么特意拦它」），只给人看：经 decide() 的 note
      //             字段 → askUser 的 entry.note → /permgate/pending → 弹窗独立展示位
      //             （client.js 的 p.note），**不拼进 reason 字符串**。
      // 为什么必须分开：reason 会被 recordDecision 写入决策记录，再随 perm_status 的
      // recentDecisions 下发给 AI。note 若拼进 reason，就等于搭着这条链路一起被 AI 读到——
      // 而备注的设计用途只有「弹窗上给人看」这一处，没有理由进入审计与工具出口。
      // 无自定义文字时回退「（例外 id）」标注，方便去设置页定位是哪一条。
      // 例外 id 的字段名有两处来源：resolveCategory 的返回值用 ruleId，而 shell-parse 的
      // assessCommand 返回值用 matched（命令分支直接把 a 传进来）。两处都认，
      // 否则命令分支命中 ask 例外时这一支恒不成立（ask 的 reason 已被 shell-parse 清空），
      // 文案里再也不出现「（例外 e1）」—— 相对 HEAD 是一次静默退化。
      const exIdOf = (d) => (d && (d.ruleId || d.matched)) || null
      const exReason = (d) => {
        if (d && d.action === 'deny' && d.reason) return '（' + d.reason + '）'
        const id = exIdOf(d)
        if (id) return '（例外 ' + id + '）'
        return ''
      }
      const exReasonEn = (d) => {
        if (d && d.action === 'deny' && d.reason) return ' (' + d.reason + ')'
        const id = exIdOf(d)
        if (id) return ' (exception ' + id + ')'
        return ''
      }
      // ask 例外的备注：与 reason 分开下发，仅供弹窗展示（理由见上方 note 说明）。
      // 非 ask、或未填备注时为 null —— 不产出空串，免得消费侧还要额外判空。
      const exNote = (d) => (d && d.action === 'ask' && d.note ? d.note : null)
      // 注意：perm_* 曾在此被无条件放行，等于给 AI 留了一条「自我提权且无弹窗」的后门
      // （当时 perm_set_category / perm_set_fallback / perm_add_exception … 改动即生效）。
      // 后来改为不再特判、统一走下面的正常判定链（自定义规则 → 分类 → 快捷工具 → 兜底），
      // 其默认动作由 QUICK_DEFAULTS 钉成 ask；设置面板走 /permgate/* HTTP 路由、不经这里，不受影响。
      // 现在那 9 个写工具已整体移除（理由见 QUICK_DEFAULTS 处注释），只剩只读的 perm_status
      // （QUICK_DEFAULTS 钉为 allow）；这条注释保留为历史记录 —— 若将来重新引入权限写工具，
      // 必须回到「不特判、由 QUICK_DEFAULTS 钉动作」的做法，绝不能在此无条件放行。
      const customReview = sessionPresetName(exec) === 'custom-review'
      // ── 循环检测（doomloop）：算出**候选**，不在这里 return ────────────────────
      //
      // 旧实现是「命中即 return」，它是判定链的**第一道**，于是覆盖了下游任何更严的判定：
      //   · 用户把 command 分类设为 deny（「命令一律拒绝」）→ 前 4 次 DENY，第 5 次起变 ASK
      //     （本该 DENY，一次误点即放行）；
      //   · 自定义规则 deny + doomloop=ask → 同样被降级为弹窗。
      // 两者都是 **fail-open**：用户显式写的拒绝被削弱。根因与段级解析修掉的那类问题同源 ——
      // **放宽方向的判定覆盖了收紧方向的判定**。
      //
      // 语义上 doomloop 不是「一类判定」，而是「对重复行为的额外提醒」：它只应把 allow 升级为
      // 提醒，**永不应把 deny 降级**。故改为「参与合并、取更严者」（做法 A），与段级合并
      // 「拒绝面取并集、放行面取交集」是同一条原则。
      //
      // 行为变更面（实测推演）只有一处：`doomloop=ask` 遇上「下游 deny」时由 ask 变回 deny
      // —— 那正是修复本身。allow/ask 与 allow/ask 的组合、以及 doomloop=deny 的组合全部不变。
      //
      // 生效范围保持现状（L-6）：仅「自定义审查」模式。非该模式时下面第一行就放行了，
      // 那时连计数都不该发生 —— 故 doom 的读取也被 customReview 挡住，不放进 out() 里懒算。
      let doom = null
      if (customReview) {
        const sk = loopSessionKey(exec)
        const th = doomloopSetting(root).threshold
        const streak = repeatStreak(sk, name, args)
        if (streak >= th) {
          const d = resolveCategory('doomloop', null, null, root)
          // d.action === 'allow' = 用户知情关闭（L-3/L-5），此时 doom 保持 null，完全不参与合并
          if (d.action !== 'allow') {
            doom = {
              action: d.action,
              // L-10：doomloop 触发时理由优先。N 取**实际连续次数**（正常等于阈值；
              // 若用户在计数途中调低了阈值，它可能已经更大 —— 报真实值比报配置值准确）。
              reason: bi('重复操作(Doom Loop)：' + name + ' 已连续放行 ' + streak + ' 次相同调用' + exReason(d), 'Doom Loop: ' + name + ' silently allowed ' + streak + ' identical calls in a row' + exReasonEn(d)),
              note: exNote(d),
              ruleId: d.ruleId,
              cat: 'doomloop',
              value: null,
              kind: null,
            }
          }
        }
      }
      // 判定出口的统一包装：把候选按「取更严者」并进最终判定。
      // 为什么做成出口包装而不是在末尾合并：decide() 有二十多个 return 出口，
      // 在末尾合并要求每个出口都先赋给同一个变量再落到末尾 —— 那会把「就近返回」
      // 这个可读性优势换掉，且漏改一个出口就是静默的 fail-open（最危险的方向）。
      // 包装后每个出口的语义不变：写出来的仍是我这一支的判定，doomloop 只是额外收紧。
      const out = (base) => {
        if (!doom) return base
        const b = MODE_STRICTNESS[base.action]
        const d = MODE_STRICTNESS[doom.action]
        // 取更严者：doom 不更严（含相等）时一律以 base 为准。
        // 相等时让 doom 接管：动作相同、只是理由换成循环提醒 —— 与旧行为一致（L-10 理由优先），
        // 也是「提醒」这一语义该有的表现（用户需要知道为什么这次被拦）。
        if (b === undefined || d === undefined || d < b) return base
        return doom
      }
      if (!customReview) {
        return out({ action: 'allow', reason: bi('会话未选择「自定义审查」，由 DSH 权限预设处理', 'Session has not selected "Custom Review"; handled by DSH permission presets'), cat: null, value: null, kind: null })
      }
      const proj = projectBlock(root)
      const rules = []
      if (proj && Array.isArray(proj.custom)) { for (const r of proj.custom) rules.push(r) }
      if (Array.isArray(config.global.custom)) { for (const r of config.global.custom) rules.push(r) }
      // 自定义规则：**首条命中即返回** —— 数组顺序就是优先级。
      //
      // 为什么不是「最严命中」：那会让「更具体的规则覆盖更宽泛的规则」这个最自然的写法失效。
      // 实测（曾经改成最严命中时的行为）：
      //   [0] allow tool=pwsh args="git status"   ← 想放行的具体用法
      //   [1] deny  tool=pwsh                     ← 想拒绝的宽泛规则
      // 用户意图是「pwsh 一律拒绝，但 git status 例外」，最严命中下 git status 也变成 deny —— 意图无法表达。
      // 「顺序即优先级」是**能力**：用户既能写「宽泛兜底 + 具体例外」，也能写「具体拒绝 + 宽泛放行」，
      // 取决于他要哪一种。参考工程的「顺序无关」是为**文本规则行**（顺序不可见、可能由 LLM 生成）设计的，
      // permgate 的规则是面板上的结构化列表、顺序可见且由用户手动添加，前提不成立。
      //
      // 与例外的关系（本轮已统一，**不再有差别**）：
      //   例外与规则**都是写入侧 push 到尾部**，顺序完全归用户、写入侧不自动重排。
      //   这里曾经写着「例外 unshift 到头部（最新决定先生效），规则 push 到尾部」并把它
      //   解释为「有意保留的差别」—— 那个差别已按用户要求取消：面板自上而下渲染，
      //   unshift 会让新条目突然出现在最上面、与用户刚在底部添加行操作的位置脱节。
      //   两者共用「首条命中」这一读侧语义。
      // 代价（有意接受）：新条目若被前面命中的条目遮蔽就不生效，直到用户手动把它调到前面。
      //   例外侧**有行内标注**（statusView 的 exceptionShadow → 面板显示「未生效」），
      //   用户能看到「我加的这条没起作用」并知道要往上移；规则侧暂无标注。
      // 「调到前面」由面板的排序控件提供（↑↓ + 拖动），落盘走 /permgate/reorder →
      // reorderEntries 这一个原语：面板只报「把 id 放到 anchor 之前/之后」，宿主不做任何推断。
      // 这里曾经写着「面板拖动排序是独立议题（尚未实现）」—— 那个议题已经落地，注释随之更新。
      for (const rule of rules) {
        if (ruleMatches(rule, name, args)) {
          return out({ action: rule.action, ruleId: rule.id, reason: rule.reason || bi('自定义规则 ' + rule.id + ' 命中', 'Custom rule ' + rule.id + ' matched'), cat: 'custom', value: null, kind: 'rule' })
        }
      }
      if (isFileRead(name, args)) {
        const fp = pathArg(args)
        if (fp && isOutside(fp, root)) {
          // 与 image/edit/undo 同口径：工作区外先过「目录访问」闸，再过「读取文件」闸。
          // 只取 directory 的动作，会让 read 分类的 mode 与 deny 例外在跨工作区时完全不生效。
          const m = outsideMatrix('read', fp, root)
          if (m.action === 'deny') return out({ action: 'deny', reason: bi(m.pz + '拒绝读取工作区外文件 ' + fp + exReason(m.src), m.pe + 'read outside workspace denied ' + fp + exReasonEn(m.src)), ruleId: m.src.ruleId, cat: m.cat, value: fp, kind: 'path' })
          if (m.action === 'ask') return out({ action: 'ask', reason: bi(m.pz + '读取工作区外文件 ' + fp + (m.src ? exReason(m.src) : '（需确认）'), m.pe + 'read outside workspace ' + fp + (m.src ? exReasonEn(m.src) : ' (requires confirmation)')), note: m.src ? exNote(m.src) : null, ruleId: m.src ? m.src.ruleId : null, cat: m.cat, value: fp, kind: 'path' })
          return out({ action: 'allow', reason: bi(m.pz + '读取工作区外文件 ' + fp + (m.src ? exReason(m.src) : ''), m.pe + 'read outside workspace ' + fp + (m.src ? exReasonEn(m.src) : '')), ruleId: m.src ? m.src.ruleId : null, cat: m.cat, value: fp, kind: 'path' })
        }
        const d = resolveCategory('read', fp, 'path', root)
        const exZh = exReason(d)
        const exEn = exReasonEn(d)
        return out({ action: d.action, reason: bi('读取权限' + (fp ? '：' + fp : '') + exZh, 'Read permission' + (fp ? ': ' + fp : '') + exEn), note: exNote(d), ruleId: d.ruleId, cat: 'read', value: fp, kind: 'path' })
      }
      // 读图与读文件同一条判定链（工作区外先过「目录访问」闸，再落本分类 + 路径例外），
      // 只是分类从 read 换成 image：两边的默认动作与例外各自独立配置。
      if (isFileImage(name)) {
        const fp = pathArg(args)
        if (fp && isOutside(fp, root)) {
          // 工作区外读图：directory + image 合并矩阵（不能用 directory 的动作短路，
          // 否则 image 默认 ask 与 image 的 deny/路径例外在跨工作区场景下全部失效）。
          const m = outsideMatrix('image', fp, root)
          if (m.action === 'deny') return out({ action: 'deny', reason: bi(m.pz + '拒绝读取工作区外图片 ' + fp + exReason(m.src), m.pe + 'image read outside workspace denied ' + fp + exReasonEn(m.src)), ruleId: m.src.ruleId, cat: m.cat, value: fp, kind: 'path' })
          if (m.action === 'ask') return out({ action: 'ask', reason: bi(m.pz + '读取工作区外图片 ' + fp + (m.src ? exReason(m.src) : '（需确认）'), m.pe + 'read image outside workspace ' + fp + (m.src ? exReasonEn(m.src) : ' (requires confirmation)')), note: m.src ? exNote(m.src) : null, ruleId: m.src ? m.src.ruleId : null, cat: m.cat, value: fp, kind: 'path' })
          return out({ action: 'allow', reason: bi(m.pz + '读取工作区外图片 ' + fp + (m.src ? exReason(m.src) : ''), m.pe + 'read image outside workspace ' + fp + (m.src ? exReasonEn(m.src) : '')), ruleId: m.src ? m.src.ruleId : null, cat: m.cat, value: fp, kind: 'path' })
        }
        const d = resolveCategory('image', fp, 'path', root)
        const exZh = exReason(d)
        const exEn = exReasonEn(d)
        return out({ action: d.action, reason: bi('读取图片权限' + (fp ? '：' + fp : '') + exZh, 'Read image permission' + (fp ? ': ' + fp : '') + exEn), note: exNote(d), ruleId: d.ruleId, cat: 'image', value: fp, kind: 'path' })
      }
      if (isFileWrite(name, args)) {
        const fp = pathArg(args)
        if (fp && isOutside(fp, root)) {
          // 工作区外写入：directory + edit 合并矩阵（与读图/撤销同口径，单点在 outsideMatrix）。
          const m = outsideMatrix('edit', fp, root)
          if (m.action === 'deny') return out({ action: 'deny', reason: bi(m.pz + '拒绝写入工作区外 ' + fp + exReason(m.src), m.pe + 'write to outside workspace denied ' + fp + exReasonEn(m.src)), ruleId: m.src.ruleId, cat: m.cat, value: fp, kind: 'path' })
          if (m.action === 'ask') return out({ action: 'ask', reason: bi(m.pz + '访问工作区外 ' + fp + (m.src ? exReason(m.src) : '（写入需确认）'), m.pe + 'access outside workspace ' + fp + (m.src ? exReasonEn(m.src) : ' (write requires confirmation)')), note: m.src ? exNote(m.src) : null, ruleId: m.src ? m.src.ruleId : null, cat: m.cat, value: fp, kind: 'path' })
          return out({ action: 'allow', reason: bi(m.pz + '访问工作区外 ' + fp + (m.src ? exReason(m.src) : ''), m.pe + 'access outside workspace ' + fp + (m.src ? exReasonEn(m.src) : '')), ruleId: m.src ? m.src.ruleId : null, cat: m.cat, value: fp, kind: 'path' })
        }
        const d = resolveCategory('edit', fp, 'path', root)
        const exZh = exReason(d)
        const exEn = exReasonEn(d)
        return out({ action: d.action, reason: bi('编辑权限' + (fp ? '：' + fp : '') + exZh, 'Edit permission' + (fp ? ': ' + fp : '') + exEn), note: exNote(d), ruleId: d.ruleId, cat: 'edit', value: fp, kind: 'path' })
      }
      // 撤销：会写盘但不是「编辑」——恢复既有内容、不接受调用方提供的新内容，故单列一类（默认询问）。
      // 与写类一致：工作区外仍先过「目录访问」闸（directory + undo 合并矩阵）。
      if (isUndoNow(name, args, exec)) {
        const fp = pathArg(args)
        if (fp && isOutside(fp, root)) {
          const m = outsideMatrix('undo', fp, root)
          if (m.action === 'deny') return out({ action: 'deny', reason: bi(m.pz + '拒绝撤销工作区外 ' + fp + exReason(m.src), m.pe + 'undo outside workspace denied ' + fp + exReasonEn(m.src)), ruleId: m.src.ruleId, cat: m.cat, value: fp, kind: 'path' })
          if (m.action === 'ask') return out({ action: 'ask', reason: bi(m.pz + '撤销工作区外文件 ' + fp + (m.src ? exReason(m.src) : '（需确认）'), m.pe + 'undo outside workspace ' + fp + (m.src ? exReasonEn(m.src) : ' (requires confirmation)')), note: m.src ? exNote(m.src) : null, ruleId: m.src ? m.src.ruleId : null, cat: m.cat, value: fp, kind: 'path' })
          return out({ action: 'allow', reason: bi(m.pz + '撤销工作区外文件 ' + fp + (m.src ? exReason(m.src) : ''), m.pe + 'undo outside workspace ' + fp + (m.src ? exReasonEn(m.src) : '')), ruleId: m.src ? m.src.ruleId : null, cat: m.cat, value: fp, kind: 'path' })
        }
        const d = resolveCategory('undo', fp, 'path', root)
        const exZh = exReason(d)
        const exEn = exReasonEn(d)
        return out({ action: d.action, reason: bi('撤销权限' + (fp ? '：' + fp : '') + exZh, 'Undo permission' + (fp ? ': ' + fp : '') + exEn), note: exNote(d), ruleId: d.ruleId, cat: 'undo', value: fp, kind: 'path' })
      }
      if (COMMAND_TOOLS[name]) {
        return out(commandDecision(exec, root, exReason, exReasonEn, exNote))
      }
      if (SUBAGENT_TOOLS[name]) {
        const d = resolveCategory('subagent', null, null, root)
        return out({ action: d.action, reason: bi('启动子代理' + exReason(d), 'Spawn subagent' + exReasonEn(d)), note: exNote(d), ruleId: d.ruleId, cat: 'subagent', value: null, kind: null })
      }
      const q = quickAction(name, root)
      if (q) {
        // 命中预设默认值时区分措辞，避免把「默认动作」说成用户显式设置
        const label = q.isDefault ? '快捷默认' : '快捷设置'
        const labelEn = q.isDefault ? 'Quick default' : 'Quick setting'
        // 该工具被显式设成 deny 且写了拒绝原因时带上它（回给 AI）；预设默认值没有原因
        const qr = q.action === 'deny' && q.reason ? '（' + q.reason + '）' : ''
        const qrEn = q.action === 'deny' && q.reason ? ' (' + q.reason + ')' : ''
        return out({ action: q.action, reason: bi(label + '：' + name + ' → ' + q.action + qr, labelEn + ': ' + name + ' → ' + q.action + qrEn), ruleId: null, cat: 'quick', value: name, kind: 'tool' })
      }
      const fb = fallbackSetting(root)
      if (fb.mode === 'allow') return out({ action: 'allow', reason: bi('未匹配任何规则，放行', 'No rule matched, allowed'), cat: null, value: null, kind: null })
      // 兜底的拒绝原因同样回给 AI（ask 时它只是弹窗文案的一部分，不参与回传）
      const fr = fb.mode === 'deny' && fb.reason ? '（' + fb.reason + '）' : ''
      const frEn = fb.mode === 'deny' && fb.reason ? ' (' + fb.reason + ')' : ''
      return out({ action: fb.mode, reason: bi('未匹配任何规则，按兜底策略处理：' + fb.mode + fr, 'No rule matched; handled by fallback policy: ' + fb.mode + frEn), ruleId: null, cat: 'fallback', value: name, kind: 'tool' })
    }

    // 段级判定摘要：把「哪一段被拦、命中哪一档」讲清楚。
    //
    // ── 它为什么**不再进弹窗的 reason** ──────────────────────────────────────
    // 这段摘要原本拼进弹窗 reason，于是弹窗上同时出现两个「段」的口径：
    //   · reason 里的「—— 分段：Get-Location」   —— 只列**非 allow** 的段（1 段）
    //   · 参数区的「段 1 / 段 2 ; / 段 3 |」      —— 列**全部**段（3 段）
    // 同屏一个说 1 段、一个说 3 段，审批人只能读成判定自相矛盾（实测截图）。
    // 而参数区已经把每段逐行列出、还带段号与引出它的操作符，弹窗侧这段摘要纯属重复。
    //
    // ── 两个消费方（都不经弹窗的 reason）────────────────────────────────────
    //   · 决策日志（设置页「最近决策」，`recordDecision`）—— 那里没有参数区，
    //     reason 是**唯一**的线索，故摘要必须在这里，事后才能看出「是哪一段、哪一档」；
    //   · **直接拒绝**时回给 AI 的那条 reason（`pre-execute` 的 `d.action === 'deny'`
    //     出口）—— 那条路径**没有弹窗**，AI 拿不到任何参数区，摘要同样是唯一线索。
    // ⚠️ 两者共用**同一个** `segmentSummary`，不是各拼一次：口径分叉时「AI 收到的理由」
    //    与「日志记的理由」会不一致，而它们本该回答同一个问题。
    // ⚠️ 唯一**不**带摘要的是**弹窗**那条 reason（用户就在看参数区，见上）。
    //
    // 总量上限：decisions 是 MAX_DECISIONS 条的环形缓冲，段数随命令行数线性增长，
    // 不截断时一条 2000 行的脚本会让单条 reason 达到 ~160 KB（中英各一份）。
    const SEG_SUMMARY_MAX_PARTS = 5
    const SEG_SUMMARY_MAX_CHARS = 300
    function segmentSummary(d) {
      const base = d && d.reason
      // reason 是 bi() 对象（分类/例外分支）或裸字符串（超时补记那条）。
      // 后者没有 segments，也不需要摘要 —— 原样返回。
      if (!base || typeof base !== 'object') return base || ''
      const segs = (d.segments || []).filter((s) => s.action !== 'allow')
      if (!segs.length) return base
      const partsOf = (lang) => {
        const parts = []
        for (const s of segs.slice(0, SEG_SUMMARY_MAX_PARTS)) {
          const tag = codeLabel(s.code)
          // 档位标签必须一并带上（§8.2 的 23d）：决策记录是事后追溯「为什么问这一次」的
          // 唯一入口，而只记 code 时八档的摘要**完全一样**（全是「破坏性命令」）——
          // 用户看不出到底是 wide 还是 priv 那一档在管，也就不知道该去调哪个开关。
          const tiers = (s.tiers || []).map((x) => tierLabel(x)).filter(Boolean).map((x) => L(x, lang)).join('')
          const t = s.text.length > 80 ? s.text.slice(0, 80) + '…' : s.text
          const note = (tag ? L(tag, lang) : '') + tiers
          parts.push(t + (note ? '（' + note + '）' : ''))
        }
        // 省略提示必须给出**还有几段**：只写「…」会让看日志的人以为已经看全了。
        // 它必须在**硬截断之后**再拼：曾经先 push 提示、再对整串按 300 字符截断，
        // 而提示位于串尾、最先被吃掉 —— 实测 8 段各 75 字符时中英两版都不含提示，
        // 恰好违背了「不能让人以为已经看全」的初衷。
        const rest = segs.length - parts.length
        const more = rest > 0 ? (lang === 'en' ? ' … +' + rest + ' more' : ' …另有 ' + rest + ' 段') : ''
        let joined = parts.join(lang === 'en' ? ' ; ' : ' ；')
        const budget = Math.max(40, SEG_SUMMARY_MAX_CHARS - more.length)
        if (joined.length > budget) joined = joined.slice(0, budget) + '…'
        return (lang === 'en' ? ' — segments: ' : ' —— 分段：') + joined + more
      }
      return bi(base.zh + partsOf('zh'), base.en + partsOf('en'))
    }

    function recordDecision(d, exec) {
      // code 一并留痕：它是「为什么问这一次」的机器可读答案（destructive / unparsable /
      // write-outside / segment-* ），与 reason 那种人读长文本互补。
      // 此前 commandDecision 已经把 code 放进返回值，但这里没写 —— 注释声称「决策日志记 code」
      // 而日志里没有这个字段，属于写了没人读的死数据。
      decisions.push({ ts: new Date().toISOString(), tool: exec.name, action: d.action, ruleId: d.ruleId || null, code: d.code || null, reason: segmentSummary(d) })
      if (decisions.length > MAX_DECISIONS) decisions.splice(0, decisions.length - MAX_DECISIONS)
    }

    function dirGlob(p) {
      // 尾部分隔符剥离用**线性 while**（同 normPathKey 的理由）：同一份拷贝里被漏掉的一份，
      // 与 norm 语义一致。
      let s = String(p).replace(/\\/g, '/')
      let end = s.length
      while (end > 0 && s.charCodeAt(end - 1) === 47) end -= 1
      if (end !== s.length) s = s.slice(0, end)
      const idx = s.lastIndexOf('/')
      let dir = idx >= 0 ? s.slice(0, idx) : s
      // 盘根（G:）本身就是父目录，直接拼 /*；若补分隔符会得到 G://*，而 norm 不折叠中间双斜杠，
      // 该 glob 匹配不到任何真实路径，会让「整个目录」候选写出的例外永不生效
      if (/^[a-zA-Z]:$/.test(dir)) return dir + '/*'
      if (!dir) dir = '/'
      return dir + '/*'
    }

    /**
     * 命令例外的**判重键**（读侧 alreadyInProject 与写侧 addProjectException 共用这一份）。
     *
     * 为什么需要它：判重此前写的是 `r.match === value` —— **大小写敏感的精确比较**，
     * 而例外真正生效的匹配走 `matchCommand`，那个函数两侧都 `toLowerCase()`（大小写不敏感）。
     * 两套口径不一致的后果是**同一条例外能存两份**：
     *   用户面板里写 `Get-ChildItem *`，弹窗候选值是 `get-childitem *`（segmentLabel 输出全小写），
     *   `'Get-ChildItem *' === 'get-childitem *'` 为 false ⇒ 判重不命中 ⇒ 按钮照常产出；
     *   点一次后 `addProjectException` 的写侧判重同样不命中 ⇒ 再 push 一条 `get-childitem *`。
     * 配置里于是出现两条 matchCommand 语义**完全等价**的例外，用户看不出为什么要两条。
     *
     * 归一方式与 `matchCommand` 同源：只做小写折叠（它自己就是这么比的），
     * **不 trim**——matchCommand 也不 trim，这里多剥一层会让「带前导空格的模式」在
     * 判重时被视为与不带空格的那条相同，而实际匹配行为并不相同（口径再次分叉）。
     */
    function cmdExcKey(s) { return String(s == null ? '' : s).toLowerCase() }

    function alreadyInProject(value, kind, catKey, root) {
      const proj = projectBlock(root)
      if (!proj) return false
      // 只有「方向明确」的例外（allow / deny）才算已表态，ask 例外不算：
      // ask 例外表达的是「这个值每次都问我」，不是「用户已决定放行或拒绝」。
      // 若把 ask 也算作已覆盖，用户加了 ask 例外后弹窗里就再也不给「允许此项」候选，
      // 想改成永久放行只能去设置面板手工编辑 —— 与候选「一键记住这个决定」的用途相反。
      const decided = (r) => r.action !== 'ask'
      if (kind === 'command') {
        const cat = proj.command
        const key = cmdExcKey(value)
        return !!(cat && Array.isArray(cat.exceptions) && cat.exceptions.some((r) => decided(r) && cmdExcKey(r.match) === key))
      }
      if (kind === 'path' && catKey && EXC_CATS.indexOf(catKey) !== -1) {
        const cat = proj[catKey]
        // 与 pathKey 同口径：相对路径、含 .. 、斜杠与大小写写法都归一到同一条
        return !!(cat && Array.isArray(cat.exceptions) && cat.exceptions.some((r) => decided(r) && pathKey(r.path, root) === pathKey(value, root)))
      }
      if (kind === 'tool') {
        return !!(Array.isArray(proj.custom) && proj.custom.some((r) => r.tool === value))
      }
      return false
    }

    // ── 命令判定：段级例外（本计划的核心修复）────────────────────────────────
    // 旧实现在这里有三份独立实现（commandTokens / commandFullyCovered / splitCommandSegments）
    // 且例外匹配作用于**整条命令串**，于是 `git status *` 编译出的 `^git status( .*)?$` 里的 `.*`
    // 吞掉了 `;` `|` `&&` 之后的一切 —— 实测 11 条命令被静默执行（含 `rm -rf ~/.dsh`）。
    // 现在判定统一委托给 shell-parse.js 的 assessCommand：分解成段 → 逐段判定 → fail-closed 合并。
    // 本函数只负责「把宿主状态注入成钩子」与「把段级结果翻成 decide() 的返回形状」。
    //
    // 判定链（逐段，见 shell-parse.js 的 assessCommand）：
    //   ① 用户例外（段级匹配）  → ② destructive 子设置（更细，优先于大分类）→ ③ command 分类默认值
    //   读不懂的段跳过 ①②，直接落 ③ —— 读不懂的内容不可被授权。
    function commandDecision(exec, root, exReason, exReasonEn, exNote) {
      const cmd = commandArg(exec.arguments)
      const shell = SHELL_OF_TOOL[exec.name] || 'bash'
      // 例外匹配：作用对象是**单个命令段**（seg.text），不是整条命令串。
      //
      // 匹配对象有两个：① 段原文（用户手写的例外，如 `git status *` 匹配 `git status -s`）；
      // ② 归一化 label（弹窗候选写下的例外，如候选值 `git status *` 要能命中段原文
      //    `env FOO=1 git status`、`/usr/bin/git status`、`git -c a=b status`）。
      // 只试 ① 会让「允许此项」写下的例外永不命中（候选值是 label 派生的，段原文带 wrapper/路径前缀），
      // 用户点了按钮却还在反复弹窗，且 alreadyInProject 判重让该候选下次不再出现 —— 变成死结。
      // 只试 ② 则用户手写的更具体模式（含参数）会失效。
      //
      // **层级顺序必须先于匹配对象**：对「项目层 → 全局层」的每一层，都完整试两个对象。
      // 曾经写成「先按段原文走完整层序，未命中再按 label 走一遍」，那会产生第三种优先级 ——
      // 全局层命中段原文 会压过 项目层命中 label：实测全局 `env *`=allow + 项目 `git status *`=deny 时
      // `env FOO=1 git status` 命中全局 allow（项目级拒绝被静默遮蔽），
      // 而把全局那条换成 `echo *`（不匹配段原文）后同一条命令正确命中项目 deny。
      // 现在项目层只要在任一对象上命中就先返回，与 resolveCategory 既有的层级语义一致。
      const matchSegmentException = (segText, label) => {
        const proj = projectBlock(root)
        const pCat = proj ? proj.command : undefined
        const gCat = config.global.command || freshCategory('command', false)
        const targets = (label && label !== segText) ? [segText, label] : [segText]
        const lists = []
        if (pCat && Array.isArray(pCat.exceptions)) lists.push(pCat.exceptions)
        if (Array.isArray(gCat.exceptions)) lists.push(gCat.exceptions)
        for (const list of lists) {
          for (const r of list) {
            for (const target of targets) {
              if (!matchCommand(r.match, target)) continue
              return {
                action: r.action,
                ruleId: r.id,
                reason: (r.action === 'deny' && r.reason) ? r.reason : undefined,
                note: (r.action === 'ask' && r.note) ? r.note : undefined,
              }
            }
          }
        }
        return null
      }
      const a = assessCommand(cmd, shell, {
        home: homeFromEnv(),
        // userHome 单独给爆炸半径的家目录档用（`~` 的展开落点 = 用户家目录，
        // 而 home 是 DSH home）。两者混用会让「删家目录」这一档判错并显示错误路径。
        userHome: userHomeDir(),
        // platform 给爆炸半径判档用（选系统目录名单 + 判 `/x` 是不是 cmd 开关）：
        // 方言不能代替它 —— Linux 上 pwsh 工具用的是 POSIX 路径。
        platform: shellPlatform(),
        matchException: matchSegmentException,
        // destructive 钩子返回**八档表**（§7.2 的契约变更）：合并逻辑留在解析器
        // （tierSetOf + strictestTierAction），宿主只回答「每一档用户配的是什么」。
        // 这样档位语义只有一份定义 —— 宿主改配置不会与解析器分叉。
        destructive: () => destructiveTiers(root),
        category: () => resolveCategory('command', null, null, root),
        isOutsideWorkspace: (p) => isOutside(p, root),
        // 工作区根判据（§5.5）：解析器判不了「这是工作区根」（它不知道根在哪），
        // 故由宿主注入。必须与 isOutside 同口径，见该函数的注释。
        isWorkspaceRoot: (p) => isWorkspaceRoot(p, root),
      })
      // inherit：两层都没给出动作 → 落兜底策略（与分类 mode 的 inherit 同口径）。
      // 不在这里直接问 fallbackSetting 是为了让「为什么走到兜底」这件事由 decide() 统一处理。
      //
      // 可达性说明（不要误以为这条分支在日常生效）：当前宿主下它**恒不成立** ——
      //   · destructiveTiers 对每一档都给出具体动作（两层都未配置时回落内置默认 ask）；
      //   · resolveCategory 对 command 分类只会返回具体 mode（项目层 inherit 已在读取时穿透全局，
      //     全局层经 MODES 校验，永远落不出 inherit）。
      // 保留它是因为 assessCommand 的契约允许返回 inherit，且宿主的默认值策略不该由解析器假定；
      // 但**任何依赖它生效的改动都是无效的**（例如指望「用户配的兜底 allow 能放行命令」）。
      // test/shell-parse.mjs 的 F26 用自造钩子触发这条路径，那是模块契约测试，不代表宿主可达。
      if (a.action === 'inherit') {
        const fb = fallbackSetting(root)
        const fr = fb.mode === 'deny' && fb.reason ? '（' + fb.reason + '）' : ''
        const frEn = fb.mode === 'deny' && fb.reason ? ' (' + fb.reason + ')' : ''
        return { action: fb.mode, reason: bi('执行命令：未配置判定，按兜底策略处理：' + fb.mode + fr, 'Run command: no verdict configured; handled by fallback policy: ' + fb.mode + frEn), ruleId: null, cat: 'command', value: cmd, kind: 'command', segments: a.segments }
      }
      const exZh = exReason(a)
      const exEn = exReasonEn(a)
      // 段级信息随判定一起下发：弹窗按段渲染、决策日志记 code（「为什么问这一次」可追溯）。
      // 段数组只含判定所需的最小字段，不含命令全文以外的任何内容。
      // blast 随段一起下发（只有破坏性段有）：弹窗据此把「这一下有多重」摆在审批人眼前，
      // 见 blastRadiusOf 的注释（`rmdir /s /q B:\` 与删一个普通目录在判定链上完全一样）。
      return {
        action: a.action,
        reason: bi('执行命令' + exZh, 'Run command' + exEn),
        note: exNote(a),
        ruleId: a.matched,
        cat: 'command',
        value: cmd,
        kind: 'command',
        segments: a.segments,
        code: a.code,
        // 取最严重的那一档（段之间取并集：任一段炸得大，整条命令就该带警告）
        blast: worstBlast(a.segments),
      }
    }

    // 最严重的一档爆炸半径（段之间取并集）。等级顺序即严重度，**引用 shell-parse 导出的
    // BLAST_ORDER**（全项目唯一一份）：曾经在这里手抄一份、键集合已经不同（缺 inside/broad），
    // 而消费方式是「未知档静默跳过」—— shell-parse 侧日后新增或改名档位时不会报错、
    // 不会告警，只会让爆炸半径警告整体静默失效，测试只覆盖已知键也发现不了。
    function worstBlast(segments) {
      let worst = null
      for (const s of (segments || [])) {
        if (!s || !s.blast) continue
        // 未知档不再静默丢弃：它是「新增档位忘了接线」的信号，保留并告警（方向 fail-safe：
        // 多显示一条警告好过把一条警告静默吃掉）。
        if (!(s.blast.level in BLAST_ORDER)) {
          console.warn('[permgate] unknown blast level:', s.blast.level)
          if (!worst) worst = s.blast
          continue
        }
        if (!worst || BLAST_ORDER[s.blast.level] < BLAST_ORDER[worst.level]) worst = s.blast
      }
      return worst
    }

    function buildCandidates(entry) {
      // 候选的判重、路径规范化与「工作区外」判定都必须基于**审批发起时**的项目根
      // （entry.projRoot 快照），不能用当前会话的根：弹窗可能挂起很久，期间用户会切会话，
      // 用当前根会让候选的判重与落盘归属跟实际发起审批的项目不一致。
      const root = entry.projRoot || fallbackRoot
      const out = []
      // hint：候选行下方的灰色小字（说明这条会放开什么），与 label（主文案，通常就是路径）分开下发，
      // 由客户端排版成「路径 + 小字 + 按钮」，避免把说明塞进 label 里挤成一大段
      const push = (label, value, kind, writes, hint) => out.push({ id: 'c' + Math.random().toString(36).slice(2, 8), label, value, kind, writes: Array.isArray(writes) ? writes : [{ cat: entry.cat, kind, value }], ...(hint ? { hint } : {}) })
      const t = (zh, en) => (uiLang === 'en' ? en : zh)
      if (entry.kind === 'command' && entry.value) {
        // 候选与判定同源：**直接用判定算出的段**（entry.segments，assessCommand 的产物），
        // 不再自己 decomposeCommand 一遍（见 §3.7「单一来源」）。
        //
        // 为什么必须是同一份对象而不是「同一次调用的两次结果」：判定那份段带 action/code/tiers，
        // 分解那份带 words —— 两次解析各持一半信息，候选侧因此**看不见 action**。
        // 实测后果：用户已把 `Get-ChildItem *` 配成 allow，`Get-Location ; Get-ChildItem -Force
        // | Select-Object Mode,Length,Name` 仍产出 `get-childitem *`、`select-object *` 两个候选
        // （前者还与既有例外大小写不同、判重不命中），点一次就多写一条语义重复的例外。
        //
        // 方言同源这件事随之自动成立（段就是判定按 SHELL_OF_TOOL 分解出来的）——
        // 历史上这里曾硬编码 'bash'，pwsh 工具下两侧分段不同：
        //   `.\scripts\build.ps1 -Clean` 候选 label 成了 `.scriptsbuild`（写下的例外永不命中）；
        //   `Remove-Item -Recurse -Force B:\Temp\` 在 bash 下直接 ok:false（一个候选都不产出）。
        const d = { ok: entry.segments.length > 0, segments: entry.segments }
        // 判重集合用 **Object.create(null)**，不能用 `{}`：键 `val` 来自命令文本，
        // 而对象字面量继承 Object.prototype —— `seen['constructor']`、`seen['toString']`、
        // `seen['valueOf']`、`seen['__proto__']` 全部恒为真值，那些候选会被**静默丢弃**，
        // 用户看不到任何按钮（`__proto__` 更隐蔽：`seen['__proto__'] = true` 不写自有属性，
        // 读回来仍是原型对象，故它也永远判为「已见过」）。
        // 与 shell-parse.js 的 dict() 是同一条纪律，见那里的说明。
        const seen = Object.create(null)
        if (d.ok) {
          for (const seg of d.segments) {
            const label = segmentLabel(seg.words)
            // ★ 已放行的段不生成候选。
            //
            // 这一段判定结果是 allow（用户例外 / 破坏性子设置 / 分类默认值任一放行），
            // 而它出现在弹窗里的唯一理由是**别的段**需要审批。给它一个「允许此项」按钮
            // 是把「已经被放行的东西」再授权一遍 —— 点了就多一条语义重复的例外。
            // 方向上也说不通：用户要拒绝这一段的话，该用的是「拒绝」而不是加 allow 例外。
            if (seg.action === 'allow') continue
            // 读不懂的段不生成候选：给一个「允许 $(任意代码) *」的按钮等于给用户一把
            // 看起来能解决问题、实际把授权面开得极大的钥匙（判定侧也不会采纳它）。
            //
            // 判据必须与判定侧**同源**：assessCommand 里是
            //   `!!seg.opaque || !label || nestedInlineProgram(label, seg.words)`
            // 曾经这里只看前两项，于是 `node -e "..."` / `bash -lc "..."` 这类
            // 「段首可读但带内联程序」的段会产出候选 `node *`：用户点了写入成功，
            // 判定侧仍不采纳（读不懂的内容不可被授权），命令继续弹窗 ——
            // 而 alreadyInProject 判重已把它当「已表态」，**下次弹窗候选变成空**，
            // 用户既没放行成功、也再没有按钮可点，形成死结。
            if (!label || seg.opaque || nestedInlineProgram(label, seg.words)) continue
            // ★ 破坏性命令**不给通配候选**。
            //
            // 原行为：一律给 `label + ' *'`。对 `rmdir /s /q B:\` 给出的候选是 `rmdir *`，
            // 而它同时匹配
            //   rmdir /s /q B:\                    ← 整个 B 盘
            //   rmdir /s /q C:\Windows
            //   rmdir /s /q B:\demo-app\build ← 一个构建目录
            // 即：用户为「删一个构建目录」点一次「允许并记住」，从此**所有 rmdir 永久静默放行**，
            // 包括下一次删盘根。而且这条 allow 例外会**压过 destructive=deny**（例外 > 子设置，
            // 实测：设了「破坏性命令一律拒绝」后写一条 `rmdir *`=allow，三个目标全部静默放行）。
            // 于是「一次点击」就能把用户显式设下的那道闸永久关掉，且他多半不知道。
            //
            // 现在的做法：破坏性段只给**精确到此命令**的例外（整段原文，无通配）。
            // 代价（有意接受）：下次一条**不同**的 rmdir 还会弹窗。这正是破坏性命令该有的
            // 待遇 —— 每次都要人看一眼。想少弹窗的用户可以自己在设置页写宽泛例外，
            // 那是显式表态、看得见后果；而弹窗上的一键按钮不该替他把这件事做了。
            //
            // 判据必须与判定侧**完全同源**：用 isDestructiveSegment(seg.words)，它内部走
            // 判定侧同一份 segmentLabels（会为 `find -delete` / `find -exec rm` 合成 `rm` label）。
            //
            // 这里曾经写 isDestructiveLabel(label)（只判段首主 label），对 find 族结论相反：
            // `find . -delete` 的主 label 是 `find`（不在破坏性名单），于是仍走通配分支生成
            // `find *`；而判定侧同一段是 destructive。用户点一次「允许并记住」后，
            // `find . -delete` 在 destructive=deny 下由 deny 变 allow（实测）—— 正是上面
            // 这段注释要堵的洞，只是换了个命令族（rm/rmdir 堵住了，find 没堵）。
            const isDestructive = isDestructiveSegment(seg.words)
            // ★ 破坏性命令**自带 glob 元字符时不给候选**。
            //
            // 候选值是**匹配模式**（判定侧 matchCommand 把 `*`/`?` 当通配符），所以「整段原文」
            // 只在原文恰好不含元字符时才等于「精确到此命令」。实测：候选 `rm -rf *` 同时命中
            // `rm -rf /`、`rm -rf /etc`、`rm -rf C:/Windows`；候选 `rm -rf ?` 命中 `rm -rf /`。
            // 用户在**零警告**下点一次「允许并记住」，写下的就是一条能放行删盘根的 allow 例外，
            // 并压过 destructive=deny —— 正是上面那段注释要堵的洞，只是换了命令形态。
            //
            // 路径候选侧（下方 hasGlobMeta）正因同一理由拒绝含 glob 的候选，此处与它同源。
            // 代价（有意接受）：`rm -rf build/*` 这类命令不给按钮，用户想少弹窗就自己在设置页
            // 写例外 —— 那是显式表态、看得见后果；一键按钮不该替他决定一个比点击目标更宽的范围。
            if (isDestructive && /[*?]/.test(String(seg.text))) continue
            // ★ 非破坏性段也要挡住「能携带破坏性载荷」的命令族的**裸通配候选**。
            //
            // `find` / `env` / `xargs` 的主 label 不在破坏性名单里（`find` 的破坏性只在
            // `-delete` / `-exec rm` 被 segmentLabels 合成 label 时才成立），于是
            // `find . -name x` 这类**非破坏性**段会照常生成通配候选 `find *` ——
            // 而实测 `matchCommand('find *', 'find / -delete')` 为 true：用户为「找一下文件」
            // 点一次「允许并记住」，从此 `find / -delete` 在 destructive=deny 下静默放行。
            // 这是同一个洞的第三种形态（前两种是 rm/rmdir 的 `label + ' *'`、`rm -rf *` 的自带通配）。
            //
            // 处置与破坏性段一致：**用整段原文**而不是 `label + ' *'`。
            // 不必额外加 `+ ' *'`：matchCommand 对无通配的 pattern 本就做**词边界前缀**匹配
            // （`lh === lp || lh.startsWith(lp + ' ')`），故 `find . -name x` 已经覆盖
            // `find . -name x -print`，与 `find . -name x *` 的匹配集**完全相同**（实测逐例对拍 0 差异）。
            // 加通配只会让写入的模式与按钮上显示的原文不一致，且把 `*` 写进配置徒增歧义。
            //
            // 与破坏性段一样，原文自带 glob 元字符时不给候选（写下的模式会比所点命令更宽）。
            const isCarrier = !isDestructive && isPayloadCarrierLabel(label)
            if (isCarrier && /[*?]/.test(String(seg.text))) continue
            // 用整段原文的两种情形：破坏性段、载荷族段 —— 两者的按钮都显示这段原文
            // （见下方 push 的第一个参数：显示值必须与写入值同源，否则用户点的是
            //  「find」而实际写入一条覆盖整条命令的例外，文案与行为不符）。
            const useExactText = isDestructive || isCarrier
            // ★ 候选值长度上限。
            //
            // 破坏性段/载荷族段的候选值现在是**整段原文**（不再是无长度上限的 `label + ' *'`，
            // 但原文本身同样无上界：命令行由 AI 生成）。这个值会经 addProjectException
            // 原样落盘进 config.json，此后每次 statusView 都全量下发 —— 实测一条
            // 190,896 字符的命令行（`rm -rf` + 4000 个路径）一次「允许并记住」后
            // config.json = 193,981 bytes，`GET /permgate/status` 每次 196,285 bytes、
            // perm_status 每次向 AI 下发 196,322 bytes，且重启后不会被截断；
            // 对照组（同长度参数的非破坏性 `git status`，走旧 `label + ' *'`）只落盘 12 字符。
            // statusView 有 17 个宿主调用点、persist 每次成功写盘都 broadcast status，
            // 于是这笔开销是**持续**的。
            //
            // 处置：超限时**不产出该候选**（而不是截断）。截断会让写下的模式与实际命令不符
            // —— 用户点的是「这条命令」，落盘的却是一条被砍掉尾巴的**前缀模式**，
            // 而 matchCommand 的前缀语义会让它匹配到一批他没看过的命令（授权面反而更大）。
            // 不产出则与既有取舍一致：破坏性命令本来就不给宽泛候选，用户想少弹窗
            // 就自己在设置页写例外（显式表态、看得见后果）。
            // 上限取 2000：正常破坏性命令（含几十个路径）远低于它，
            // 而它把单条例外的下发体积限制在 2 KB 量级。
            const val = useExactText ? String(seg.text) : (label + ' *')
            if (val.length > CAND_VALUE_MAX_CHARS) continue
            // 判重键用**候选值**而不是 label：同一 label 可以同时产出两条候选 ——
            // `find . -name x && find . -delete` 的两段 label 都是 `find`。
            // 按 label 去重会让先出现的段占住键位、把后面那条丢掉。
            if (seen[val]) continue
            seen[val] = true
            if (alreadyInProject(val, 'command', null, root)) continue
            const exactLabel = String(seg.text).length > 60 ? String(seg.text).slice(0, 60) + '…' : String(seg.text)
            push(useExactText ? exactLabel : label, val, 'command',
              undefined,
              // hint 只给破坏性段：它是「这次点击的授权面」说明，载荷族段（只读的 find 等）
              // 的授权面就是那条命令本身，写「破坏性命令不给通配」会与实际不符。
              //
              // ── 措辞必须说「前缀」而不是「这一条命令本身」──────────────────────
              // 这里的候选值是整段原文，**不含通配符**，而 matchCommand 对无通配的模式做的是
              // 词边界**前缀**匹配（`lh === lp || lh.startsWith(lp + ' ')`），不是全串相等。
              // 实测：写入候选 `rm -rf ./build` 后，`rm -rf ./build /`、
              // `rm -rf ./build /etc`、`rm -rf ./build --no-preserve-root /` 全部被放行
              // （无该例外时都是 deny）—— 与「仅放行这一条命令本身」的字面承诺不符。
              // 载荷族同理：`find . -name x` 的候选放行 `find . -name x -delete`。
              //
              // 为什么是改文案而不是改匹配语义：让候选真正「只此一条」需要引入 exact 语义
              // （整串相等或结束锚），那是**匹配格式的语义变更** —— 存量例外全是按前缀语义
              // 写的，改了会让它们集体失效（用户已放行的命令突然重新弹窗），
              // 代价远大于收益。而这里的实际授权面（前缀到命令名之后）比改动前的
              // `label + ' *'`（如 `rm *`）已经窄得多，且用户仍可在设置页自行写宽泛例外。
              // 文案与行为一致是本条要守的底线，故说清「这一条命令及其后续参数」。
              isDestructive ? t('放行以这条命令开头的调用（含后续追加的参数；破坏性命令不给通配，避免一次点击放行所有同类操作）', 'Allows calls starting with this exact command (including appended arguments; destructive commands get no wildcard, so one click cannot allow every operation of this kind)') : undefined)
          }
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
          // （实测 B:/x/*/../y.txt → B:/x/y.txt），使通配路径被误当成精确路径生成候选。
          const absVal = hasGlobMeta(entry.value) ? norm(entry.value) : normAbsPath(entry.value, root)
          // 守卫按**原始值**判定：absVal 已折叠 ..，对它判 hasParentSeg 恒为 false，等于没有守卫。
          // 含 .. 的原文不给目录 glob——dirGlob 取父目录，`..` 可拼出覆盖整个盘根的 `G:/*`。
          const globSafe = !hasGlobMeta(entry.value) && !hasParentSeg(entry.value)
          const glob = globSafe ? dirGlob(absVal) : ''
          const hasDirGlob = globSafe && alreadyInProject(glob, 'path', 'directory', root)
          const hasKindGlob = globSafe && alreadyInProject(glob, 'path', catKey, root)
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
          const covered = fileWrites.every((w) => alreadyInProject(w.value, 'path', w.cat, root))
          // 文件候选只要求原文无通配符：含 .. 的原文已被规范化成精确绝对路径，可以安全给候选
          if (!hasGlobMeta(entry.value) && !covered) {
            push(fileVal, fileVal, 'path', fileWrites, t('工作区外访问文件 + ' + kindLabel[0] + '权限', 'Outside workspace · file + ' + kindLabel[1]))
          }
        } else if (!hasGlobMeta(entry.value)) {
          // 工作区内同样走规范化单点，避免同一份配置里两种路径写法并存
          const absVal = normAbsPath(entry.value, root)
          if (!alreadyInProject(absVal, 'path', entry.cat, root)) push(absVal, absVal, 'path')
        }
      }
      // 其余分类无「例外」候选：快捷工具（web_search/skill 等）走 quickTools 设置；
      // 子代理/重复操作只有模式默认值 —— 均不生成候选
      return out
    }

    // 审批弹窗。opts（可选）：
    //   opts.timeoutMs  超时时长（毫秒）。0 / 未传 = 永不超时（默认，现有行为）。
    //   opts.onTimeout  超时后的动作，只能是 'allow' | 'deny'。
    //   opts.note       附加说明（异常原因等），随弹窗下发，供人判断「为什么走到这一步」。
    //                   注意：d.note（命中的 ask 例外备注）优先于它，二者都只进 entry.note，
    //                   绝不拼进 reason（reason 会被记入决策记录并随 perm_status 回给 AI）。
    // 机制本身是通用的（不写死为 auto 专用），但**当前仓库内没有任何调用方传入 opts**
    // （唯一调用点是本文件 tools/pre-execute 的 askUser(exec, d)）：auto 的异常回落路径
    // 目前只存在于 .plan/auto-approval-plan.md（尚未实现）。所以超时是给 auto 预留的能力，
    // 接线前它在生产中不可达。onTimeout 只能是 allow/deny 的论证：能走到超时机制的配置，
    // 其 autoFallback 必然不是 ask（若为 ask，异常与正常失败本来就都弹窗，不需要超时），
    // 故落点必然二选一。
    function askUser(exec, d, opts) {
      const o = opts || {}
      // 必须同时校验「有限」与「正数」，并把上界钳到 32 位有符号整数上限：
      // setTimeout 的延迟超出该范围时，Node 只发 TimeoutOverflowWarning 并把延迟**改成 1ms**。
      // 于是 Infinity（调用方想表达「永不超时」）或任意超大值会让定时器几乎立刻触发 ——
      // 若 onTimeout === 'allow'，那就是一次无人在环的立即自动放行（fail-open）。
      // 非法/超范围值一律回退 0（= 不建定时器 = 永不超时），保证失败方向是「更安全」。
      const TIMEOUT_MAX = 2147483647
      const timeoutMs = Number.isFinite(o.timeoutMs) && o.timeoutMs > 0 ? Math.min(o.timeoutMs, TIMEOUT_MAX) : 0
      const onTimeout = o.onTimeout === 'allow' ? 'allow' : 'deny'
      return new Promise((resolve) => {
        let settled = false
        let onAbort = null
        let timer = null
        // 清定时器单点：cleanup（结案）与 cancelTimeout（用户点「停止倒计时」）共用。
        // 不写成两份内联副本 —— 漏改其中一份时不会有任何断言变红，而漏改 cancelTimeout
        // 那份的后果是：界面已按宿主回执承诺「不再自动结案」，宿主定时器却仍在，
        // 到点照常结案（onTimeout === 'allow' 时即一次用户已明确拒绝的自动放行）。
        const clearTimer = () => {
          if (timer !== null) { try { timer() } catch (e) {} timer = null }
        }
        const id = 'p' + Math.random().toString(36).slice(2, 10)
        const argsJson = safeJson(exec.arguments)
        // 意图：六级取值链的唯一出口（见 intentFor）。intent 与 intentLabel 成对产出 ——
        // 标签必须与**实际命中那一级**同源，否则会「内容取自 ③、牌子写 ⑤」。
        //
        // 取值失败**绝不能**把审批带停：这里是 askUser 的 Promise executor 之内，抛出去会让
        // 这个 Promise 变成 rejected —— 弹窗根本不会出现，而调用方 await 到异常后只能走
        // pre-execute 的 catch 分支，那条路径现为 fail-safe（返回 deny，不再是 next()）。
        // 即「意图取不到」这种与安全判定无关的显示层故障，会把本该弹窗的调用变成**误拒**。
        // 故在**唯一调用点**兜底，降级为 ⑥「操作概要」：弹窗照常弹、用户照常批准/拒绝，
        // 只是意图退回机械摘要（它本来就只描述「是什么操作」，不含任何意图信息）。
        //
        // 只包这一处、不给六级链内部各取值函数逐个包：本函数全仓只有这一个调用点，这里就是
        // 唯一咽喉；逐级包一层则是把同一份兜底抄六遍，日后新增一级必漏。
        let intentInfo
        try {
          intentInfo = intentFor(exec, d)
        } catch (e) {
          // 兜底自身也必须安全：⑥ 要过 decomposeCommand，与链上其它取值同属「可能出问题的那一半」，
          // 故再包一层。连它都失败时给出**空 bi**（bi('', '')）—— 维持 intentFor 的
          // 「text 恒为 bi」契约，客户端对 falsy intent 整块不渲染、标签回落 T('app.intent')。
          // 弹窗仍照常出现。任何情况下都不得因为「意图取不到」而放行。
          //
          // ⚠️ 不要以为「给 null 而非空串」能多表达什么：投影层是 `L(e.intent, lang)`，
          // 而 L 的实现是 `(o && (o[lang] || o.zh)) || ''` —— null 与 '' 都会被折成 ''，
          // 客户端收到的永远是空串。二者的区别在本链路里**不可观测**。
          let text = bi('', '')
          try { text = describeIntent(exec, d) } catch (e2) {}
          intentInfo = { text, label: bi('操作概要', 'Operation summary') }
          // warn 而非 error：这是**预期内的显示层降级**（弹窗照常工作、用户照常决定），
          // 不是宿主故障。与 approval timed out 同类，故用 warn；
          // error 留给 syncSandbox / route error 那种真正的故障。
          try {
            console.warn('[permgate] 意图取值失败，已降级为「操作概要」：', e)
          } catch (e3) {}
        }
        const entry = {
          id,
          tool: exec.name,
          argsJson,
          cat: d.cat || null,
          value: d.value !== undefined && d.value !== null ? String(d.value) : null,
          kind: d.kind || null,
          // 爆炸半径（只有破坏性命令段有）：弹窗据此把「这一下有多重」显式摆出来。
          // 与 reason 分开存、不进 reason —— 它是给人看的信息，不是回给 AI 的拒绝理由。
          blast: d.blast || null,
          reason: d.reason || bi('', ''),
          // 判定算出的段（含每段的 action/code/tiers 与 words）。存下来是为了让
          // buildCandidates **消费判定结果**，而不是把同一条命令再解析一遍。
          //
          // 此前 entry 上没有这个字段，于是候选侧唯一能拿到的分段信息来自它自己那次
          // decomposeCommand —— 那份段**没有 action**，候选侧因此不知道某一段已经被放行：
          // 用户早已配好 `Get-ChildItem *`=allow，弹窗仍给出 `get-childitem *` 候选，
          // 点一次就往配置里再写一条语义重复的例外（matchCommand 大小写不敏感，两条等效）。
          //
          // 不进 /permgate/pending 的下发白名单（见那里的投影）：它只服务宿主内部的候选生成。
          segments: Array.isArray(d.segments) ? d.segments : [],
          intent: intentInfo.text,
          // 意图标签：与 intent 同级、成对下发。客户端只负责显示，**不做任何推导** ——
          // 「这一级是谁说的」是判定侧的语义，客户端拿不到取值来源，推导必错。
          intentLabel: intentInfo.label,
          ts: Date.now(),
          candidates: [],
          argLines: humanArgsPreview(exec.name, exec.arguments, exec, d),
          // 超时相关：deadline 是**绝对时间戳**，客户端据此本地倒数（不用服务端每秒推送）；
          // 服务端 setTimeout 才是超时的权威作者，浏览器只负责显示。
          // 这样即使后台标签被节流，超时也照常按时发生，且客户端不会累计漂移。
          // 不另存 timeoutMs：客户端只认绝对 deadline（倒计时）与 onTimeout（落点文案），
          // 「有没有超时」已由 deadline 是否为 null 表达；多存一份只写不读的状态，
          // 日后改动时无法判断它是否还有人依赖。
          deadline: timeoutMs ? Date.now() + timeoutMs : null,
          onTimeout: timeoutMs ? onTimeout : null,
          // note 有两个来源，都是「为什么走到这一步」的说明，优先取本次判定命中的 ask 例外备注
          // （d.note，最具体：就是当初特意拦它的那句话），无则回退 opts.note（auto 异常回落预留）。
          // 二者都不拼进 reason —— reason 会被 recordDecision 写入决策记录并随 perm_status 下发给
          // AI，而备注只该在弹窗上给人看（详见 decide() 中 exNote 的说明）。
          // 统一走 normalizeText（trim + 截断 200 + 非字符串丢弃），与 reason/例外 note 同口径。
          // 早先这里是裸 String(o.note)，是全文件唯一无上界的弹窗文本通道：该字段会经
          // /permgate/pending 原样下发并渲染进卡片（卡片只有 max-height:82vh），
          // 超长文本会把「允许/拒绝」按钮挤出可视区。
          note: normalizeText(d.note) || normalizeText(o.note) || null,
          // 审批发起时的项目根：审批可能挂起很久、期间用户会切会话，故必须把发起时的
          // 根快照下来 —— 打相对路径/对比/打开侧栏/落盘例外都用它，不能用「当前会话」的根。
          projRoot: rootOf(exec),
          // 会话标识：session 挂在 agent 上，不在 exec 上（ToolExecutionInput 只有 agent/name/
          // arguments/callId/signal，没有 session）。旧写法读 exec.session 恒为 undefined，
          // 导致下发给客户端的 sessionId 一直是 null —— 弹窗因此认不出「来自哪个对话」，
          // 「打开文件」也拿不到会话、构造不出 dsh-resource://file/session/<id>/<path> 地址。
          sessionId: (exec.agent && exec.agent.session && exec.agent.session.id) || null,
          // 会话标题：同一会话可能同时开着多个弹窗，标题比 id 更便于人辨认。
          // 取不到就留 null，由客户端回落到只显示 id 前缀，不编造占位文案。
          sessionTitle: sessionTitleOf(exec),
          // 编辑/写入，或带文件路径的读取 → 弹窗「详情」默认展开并自动取数据
          // （写类=diff，读类=窗口化内容；图片是整图 data URL，受 IMAGE_MAX_BYTES/像素上限约束）
          hasDiff: isPreviewableFileToolNow(exec.name, exec.arguments, exec) && !!pathArg(exec.arguments),
          toolCat: pathToolCat(exec.name, exec.arguments, exec),
          // str_replace_editor 的内核在审批发起时定下（insert 的 insert_line 语义随内核相反），
          // 详情预览按发起时的实际内核解释，避免中途判别漂移
          editorKernel: resolveEditorKernel(exec, rootOf(exec)).kernel,
          resolve,
          // 结案认领单点：置 settled + 清定时器 + 摘 abort 监听 + 移出待审批池。
          // 所有结束路径（用户操作 / 超时 / abort）都必须经过它，否则定时器泄漏。
          //
          // claim() 与 cleanup() 分开的原因：`/permgate/decide` 路由在结案前还有
          // `await init(exec)` 这个真实 I/O 挂起点（fs.resolve/stat/readText），而
          // `entry.resolve()` 对已 settle 的 Promise 是静默无效的。若用户恰在倒计时
          // 末尾点「允许」，超时回调会在该 await 期间抢先结案：用户点的是允许，本次
          // 调用却被拒绝、审计补记成 timeout-deny（与用户动作相反），而路由照常返回
          // {ok:true}。故路由必须在**第一个 await 之前**先 claim()，把定时器摘掉。
          claim() {
            if (settled) return false
            settled = true
            clearTimer()
            return true
          },
          // 结案收尾单点（幂等）：cleanup + resolve。认领成功之后必须保证走到这里 ——
          // 认领只负责「抢占」，真正把条目移出待审批池并让 askUser 的 Promise settle
          // 是这一句。cleanup 本身幂等（clearTimer 有守卫、Map.delete 幂等、广播无害），
          // resolve 对已 settle 的 Promise 是 no-op，故重复调用安全。
          settle(out) {
            entry.cleanup()
            resolve(out)
          },
          cleanup() {
            clearTimer()
            if (onAbort && exec.signal) { try { exec.signal.removeEventListener('abort', onAbort) } catch (e) {} }
            pendingApprovals.delete(id)
            broadcast({ type: 'pending' })
          },
          // 「停止倒计时」单点：清掉定时器并把本条转为永不超时（等同普通 ask 的等待语义）。
          // 客户端只改本地 state 是不够的 —— 超时的权威作者是宿主，定时器不取消，
          // 到点仍会自动结案（onTimeout === 'allow' 时即自动放行），而按钮文案向用户
          // 承诺的正是「不再自动结案，一直等你决定」。故必须提供这条宿主侧通道。
          // 结案时 deadline/onTimeout 一并置空，客户端据此收起倒计时条。
          cancelTimeout() {
            clearTimer()
            entry.deadline = null
            entry.onTimeout = null
            broadcast({ type: 'pending' })
          },
        }
        entry.candidates = buildCandidates(entry)
        pendingApprovals.set(id, entry)
        broadcast({ type: 'pending' })
        // 默认永不超时：审批完全由用户在弹窗中决定。传了 timeoutMs 才启动倒计时。
        // abort 与 timeout 都走 claim() 单点认领：只有第一个认领者能结案，避免双结案。
        onAbort = () => {
          if (!entry.claim()) return
          entry.settle({ kind: 'deny', reason: uiLang === 'en' ? 'Approval request cancelled' : '审批请求已取消' })
        }
        if (timeoutMs) {
          try {
            timer = ctx.timer.setTimeout(() => {
              // 定时器已触发，先置空引用（此时 disposer 已是 no-op，置空只为语义清晰）
              timer = null
              if (!entry.claim()) return
              // 超时落点由调用方指定（只能是 allow/deny）。理由见函数头注释。
              entry.settle(onTimeout === 'allow'
                ? { kind: 'allow', reason: uiLang === 'en' ? 'Approval timed out; allowed' : '审批超时，已自动允许', timedOut: true }
                : { kind: 'deny', reason: uiLang === 'en' ? 'Approval timed out; denied' : '审批超时，已自动拒绝', timedOut: true })
            }, timeoutMs)
          } catch (e) { timer = null }
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
    // root 由调用方显式传入（位置参数，与其余根消费函数同一通道），且必须是**决定归属的
    // 那个根**：审批落盘用 entry.projRoot（发起时的快照，弹窗挂起期间可能已切会话），
    // 面板/工具入口用当前请求会话的根。
    // 不再走 opts.root：根有两条通道时，漏传不会报错而是静默落到部署根，例外会写进别的
    // 项目块（正是旧实现「在 proj-alpha 点的例外写进了 MCP 项目块」那类归属错误），且 arity
    // 守卫只校验位置参数、拦不住 opts 里的漏传。
    // 缺根时显式回落 fallbackRoot（仍是非空兜底），但调用方必须显式传根。
    function addProjectException(cat, kind, value, decision, root, opts) {
      const o = opts || {}
      const rootKey = root || fallbackRoot
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
      // 新条目**追加到数组末尾**（用户定）：顺序即优先级，新加的排最后，
      // 由用户自己在面板上拖动/上下移调整到想要的优先级。
      //
      // 这里曾经是 unshift（新条目插到头部，即「最新决定先生效」）。改成 push 的理由：
      // 面板的列表是**自上而下**渲染的，unshift 会让新条目突然出现在最上面，
      // 而用户刚在底部的添加行里填完内容、视线还在底部 —— 他看不到自己刚加的那条，
      // 会以为没加上而重复添加。追加到末尾则新条目就出现在视线附近（配合面板自动滚到底）。
      //
      // 代价（有意接受，用户明确表态「用户会自己调整顺序」）：resolveCategory 仍是
      // 首条命中即生效，故新加的例外若与前面某条**同目标且反向**，它不会生效 ——
      // 面板会把它画在列表里（看得见），用户可自行把它拖到前面。这与规则列表的
      // 语义一致（那边也是 push 到尾部、顺序完全归用户）。
      //
      // 但「看得见」不等于「看得出没生效」：面板会提示「已保存」，那一行也照常渲染，
      // 用户会以为决定已生效（实测最危险的是「以为拦住了破坏性命令、实际仍放行」）。
      // 故读侧配套了**行内标注**：statusView 现算 exceptionShadow，面板在该行显示
      // 「未生效」并说明被哪一条遮蔽（用户按提示用 ↑ 移上去即可）。
      //
      // 同方向重复写入仍然跳过并返回既有条目（去重逻辑不变，只是不再提到头部）：
      // 否则同一决定会在列表里堆积成一串。
      const build = (extra) => Object.assign({ id: 'e' + Math.random().toString(36).slice(2, 8), action: decision }, extra, reason ? { reason } : {}, note ? { note } : {})
      try {
        const block = target === 'global' ? config.global : ensureProject(rootKey)
        if (kind === 'path' && cat && cat !== 'command' && EXC_CATS.indexOf(cat) !== -1) {
          const c = block[cat] || freshCategory(cat, target === 'project')
          if (!c.exceptions) c.exceptions = []
          // 去重与 alreadyInProject / matchException 同口径（pathKey：绝对化 + 折叠 .. + 大小写/斜杠归一）：
          // 否则候选写规范绝对路径、面板写相对或含 .. 原文时会各存一条指向同一路径的例外。
          const idx = c.exceptions.findIndex((r) => pathKey(r.path, rootKey) === pathKey(value, rootKey) && r.action === decision)
          if (idx !== -1) {
            // 命中既有同向条目：原地更新文字（不移动位置 —— 用户没要求改顺序，
            // 静默重排会让他看到自己没动过的列表变了样）。
            const hit = c.exceptions[idx]
            textPatch(hit)
            block[cat] = c
            return hit
          }
          // 落盘统一存规范化路径，与判重/匹配口径一致
          const item = build({ path: normAbsPath(value, rootKey) })
          c.exceptions.push(item)
          block[cat] = c
          return item
        }
        if (kind === 'path') return null
        if (kind === 'command' && cat === 'command') {
          const c = block.command || freshCategory('command', target === 'project')
          if (!c.exceptions) c.exceptions = []
          const key = cmdExcKey(value)
          const idx = c.exceptions.findIndex((r) => cmdExcKey(r.match) === key && r.action === decision)
          if (idx !== -1) {
            const hit = c.exceptions[idx]
            textPatch(hit)
            block.command = c
            return hit
          }
          const item = build({ match: value })
          c.exceptions.push(item)
          block.command = c
          return item
        }
        if (kind === 'command') return null
        if (!block.custom) block.custom = []
        const idx = block.custom.findIndex((r) => r.tool === value)
        if (idx !== -1) { block.custom[idx].action = decision; return block.custom[idx] }
        const item = { id: 'r' + Math.random().toString(36).slice(2, 8), action: decision, tool: value }
        block.custom.push(item)
        return item
      } catch (e) {
        console.error('[permgate] addProjectException error:', e)
        return null
      }
    }

    // 例外删除单点（/permgate/remove-exception 路由专用）：
    // 判定只取数组首个匹配，故同一 path 上可能并存方向相反的多条（**首条命中生效**，
    // 即最早写入的那条在前；被它遮蔽的条目由 statusView 的 exceptionShadow 标注为「未生效」）。
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
      // 「同值」必须与读侧 alreadyInProject、写侧 addProjectException 同源（命令分类走 cmdExcKey，
      // 因为例外真正生效的 matchCommand 大小写不敏感）。这里若退回裸 `r[key] === value`，删掉
      // `Get-ChildItem *` 时配置里等价的 `get-childitem *` 会被算成「没有剩余」→ UI 清掉提示，
      // 而那条等价例外仍在生效：用户以为授权收紧了，实际没有。
      const same = key === 'match' ? (a, b) => cmdExcKey(a) === cmdExcKey(b) : (a, b) => a === b
      const remaining = kept.filter((r) => same(r[key], value)).length
      return { removed: true, count, remaining, exception: target }
    }

    // 例外修改单点（/permgate/set-exception 路由专用）：**就地改，不挪位置**。
    //
    // ── 为什么必须就地改，而不是「删掉再加一条」──────────────────────────────────
    // 列表顺序**就是优先级**（resolveCategory / matchSegmentException 都取首个匹配），
    // 而 addProjectException 把新条目**追加到末尾**。于是「删了重加」会把这条例外
    // 从它原来的优先级位置挪到最后 —— 用户只是想把 `git status *` 改成 `git diff *`，
    // 却顺带把它的优先级降到最低。若它原本遮蔽着后面某条 allow，这一改就会
    // **静默放松权限**（原来被遮蔽的 allow 现在生效了）。就地改没有这个问题。
    //
    // ── 改 `match`/`path` 的连带影响（有意接受，不额外处理）────────────────────
    // 改模式后，这条例外指向的东西变了，可能不再遮蔽后面的条目、或反过来被遮蔽 ——
    // 那由 statusView 的 exceptionShadow 重新算并标注，不需要在这里做补偿。
    // 同值反向的重复条目也不清理：删除单点（removeExceptionEntries）已经确立了
    // 「严格按 id 操作，不动同值的其它行」这条纪律，这里保持一致。
    function setExceptionEntry(block, catKey, id, patch) {
      if (EXC_CATS.indexOf(catKey) === -1) return { ok: false, reason: '该分类不支持例外' }
      const c = block && block[catKey]
      if (!c || !Array.isArray(c.exceptions)) return { ok: false, reason: '例外列表不存在' }
      const idx = c.exceptions.findIndex((r) => r.id === id)
      // id 找不到时**报错而不是追加**：静默追加会让一次「改错了 id」的请求变成
      // 凭空多出一条例外 —— 权限被放宽，而用户以为自己只是改了个字。
      if (idx === -1) return { ok: false, reason: '未找到 id=' + id }
      const cur = c.exceptions[idx]
      const key = catKey === 'command' ? 'match' : 'path'
      const next = Object.assign({}, cur)
      // 动作：只有显式给了才改（undefined = 保留原值），值域与 mode 同口径
      if (patch.action !== undefined) {
        if (MODES.indexOf(patch.action) === -1) return { ok: false, reason: '非法动作' }
        next.action = patch.action
      }
      // 模式：空串视为非法（一条匹配不到任何东西的例外没有意义，且它仍会占一个优先级位）
      if (patch.value !== undefined) {
        const v = typeof patch.value === 'string' ? patch.value.trim() : ''
        if (!v) return { ok: false, reason: '匹配内容不能为空' }
        // 长度上限与候选写入路径（`CAND_VALUE_MAX_CHARS`）**对齐** —— 二者是同一条例外的
        // 同一个字段，上限必须一致，否则两条写入路径会给出互相矛盾的可写范围：
        // 「允许并记住」能写 2000 字符，而升级后想改这一个字却卡在 500，
        // 存量 500–2000 的例外**永久无法通过面板保存**（beginExEdit 会把原值预填进输入框，
        // 用户一个字不改、直接点保存也收到「匹配内容过长」，且他并不知道这是新增限制）
        // —— 与 §7.5.2「就地可改」的意图直接冲突。方向虽是拒绝（fail-closed），
        // 但后果是「改不了」而非「被绕过」，属可用性缺陷。
        //
        // ⚠️ 这里写**字面量**、不引用 `CAND_VALUE_MAX_CHARS`：本函数会被
        // test/regressions.mjs 抠出放进 `new Function` 独立求值，注入名单里没有该常量，
        // 引用会让「可独立求值」那条断言以 ReferenceError 变红。**两边数值的同源性
        // 由该套件的断言锁定**（改了常量而不改这里，套件即红），故不是「抄一份没人管」。
        if (v.length > 2000) return { ok: false, reason: '匹配内容过长' }
        next[key] = v
      }
      // reason / note 的语义与 setCategoryMode 完全一致：
      // 未提供（undefined）保留原值；空串/纯空白显式清除；有内容覆盖。
      // 归一化交给 normalizeException 统一做（trim + 截断 200 + 按动作各归其位），
      // 这里不自己写一遍 —— 两处各写一遍必然漂移。
      if (patch.reason !== undefined) next.reason = patch.reason
      if (patch.note !== undefined) next.note = patch.note
      const normalized = normalizeException(next, catKey)
      if (!normalized) return { ok: false, reason: '非法的例外参数' }
      // **就地替换**（保 id、保下标）：splice 而不是 push，顺序即优先级。
      // 重新归一化会丢掉不在白名单里的字段，这正是想要的（与 add 同口径）。
      c.exceptions[idx] = normalized
      return { ok: true, exception: normalized, index: idx }
    }

    // 列表排序单点（/permgate/reorder 路由专用）。管两个「顺序即优先级」的列表：
    //   规则（block.custom）—— decide() 首条命中即返回，数组顺序就是优先级；
    //   例外（block[cat].exceptions）—— resolveCategory / matchSegmentException 同样是首个匹配生效。
    //
    // **只实现一个原语：「把 id 移到 anchor 之前 / 之后」**，不提供「移到第 N 位」。
    // 理由是面板的列表可以处于**过滤态**，此时用户看到的第 N 行与底层数组的第 N 项不是同一个东西：
    // 传下标会让「按看到的顺序拖」变成「按看不见的顺序插」——两种解释都说得通，于是必有一方是 bug。
    // anchor 是真实条目的 id，无论列表是否被过滤都唯一确定一个位置，没有这个歧义。
    // 面板的 ↑↓ 按钮也归约到同一原语（anchor = 相邻的**可见**条目），故宿主只需实现一次。
    //
    // 越界与自反一律拒绝而不是「就近修正」：静默改写用户没要求过的顺序，比报错更难排查。
    function reorderEntries(a, root) {
      const kind = a.kind === 'rule' ? 'rule' : (a.kind === 'exception' ? 'exception' : null)
      if (!kind) return { ok: false, reason: 'kind 必须是 rule 或 exception' }
      const id = a.id ? String(a.id) : ''
      const anchor = a.anchor ? String(a.anchor) : ''
      if (!id || !anchor) return { ok: false, reason: 'id 与 anchor 不能为空' }
      if (id === anchor) return { ok: false, reason: 'id 与 anchor 相同' }
      // position **必须显式给出**：缺省值看似友好，实则把「面板忘了传」变成「静默按 before 处理」——
      // 用户看到的顺序会莫名其妙地变（面板 bug 表现为权限顺序被改），比报错难查得多。
      if (a.position !== 'before' && a.position !== 'after') return { ok: false, reason: 'position 必须是 before 或 after' }
      const pos = a.position
      const target = a.target === 'project' ? 'project' : 'global'
      const block = target === 'global' ? config.global : ensureProject(root)
      let list = null
      let where = ''
      if (kind === 'rule') {
        if (!block.custom) block.custom = []
        list = block.custom
        where = '规则'
      } else {
        const cat = String(a.category || '')
        if (EXC_CATS.indexOf(cat) === -1) return { ok: false, reason: '该分类不支持例外' }
        const c = block[cat]
        if (!c || !Array.isArray(c.exceptions)) return { ok: false, reason: '例外列表不存在' }
        list = c.exceptions
        where = cat + ' 例外'
      }
      const from = list.findIndex((r) => r && r.id === id)
      if (from === -1) return { ok: false, reason: '未找到 id=' + id }
      const hit = list.findIndex((r) => r && r.id === anchor)
      if (hit === -1) return { ok: false, reason: '未找到 anchor=' + anchor }
      const item = list.splice(from, 1)[0]
      // 取出后 anchor 的下标会变：anchor 原本排在 from **之后**时要减一。
      // 这一步错了不会报错，只会让条目落在相邻一格上（差一位），故单独说明。
      const at = hit > from ? hit - 1 : hit
      const to = pos === 'after' ? at + 1 : at
      list.splice(to, 0, item)
      return { ok: true, list: where, from: from, to: to }
    }

    // 弹窗「记住此决定」的落盘。root 取审批发起时的快照（entry.projRoot）：
    // 与 addProjectException 同源，保证「哪个项目发起的审批，就写进哪个项目块」。
    function addRememberedRule(entry, action, target) {
      const root = entry.projRoot || fallbackRoot
      try {
        const block = target === 'project' ? ensureProject(root) : config.global
        if (entry.cat === 'quick') {
          setQuickAction(root, target, entry.tool, action)
          return
        }
        if (entry.kind === 'path' && entry.cat && EXC_CATS.indexOf(entry.cat) !== -1 && entry.value) {
          // 复用例外写入单点。注意：choice 是用户在弹窗上的显式选择（「拒绝并加入项目黑名单」），
          // 不能套用候选双写场景的「deny 不写 directory 例外」过滤，否则显式决定会被静默丢弃。
          addProjectException(entry.cat, 'path', String(entry.value), action, root, { target })
          return
        }
        if (entry.kind === 'command' && entry.cat === 'command' && entry.value) {
          addProjectException('command', 'command', String(entry.value), action, root, { target })
          return
        }
        if (!block.custom) block.custom = []
        const idx = block.custom.findIndex((r) => r.tool === entry.tool)
        if (idx !== -1) { block.custom[idx].action = action; return }
        const rule = { id: 'r' + Math.random().toString(36).slice(2, 8), action, tool: entry.tool }
        if (entry.cat === 'doomloop' && entry.argsJson) rule.args = entry.argsJson
        // 追加到末尾（与 addProjectException 的新条目同口径）：面板自上而下渲染，
        // 插到头部会让新规则突然出现在最上面、与用户刚操作的位置脱节。
        // 顺序即优先级，用户可在面板上自行调整。
        block.custom.push(rule)
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
        // 写策略用本会话自己的根：配置目标在 home 下、mode 是 full access，workspaceRoot
        // 实际不参与判定，但取值口径应与调用会话一致（旧实现读全局 root，会取到别的会话的根）
        const writePolicy = { mode: 'danger-full-access', workspaceRoot: rootOf(exec) }
        await fs.writeText(t, JSON.stringify(config, null, 2), undefined, undefined, writePolicy)
        lastDiskJson = JSON.stringify(config, null, 2)
        saveError = null
        // 配置已变 → 例外爆炸半径的缓存作废（世代失效，见 blastPatternMemo 的注释）。
        // 放在写盘成功之后：写盘失败时内存配置没变，缓存仍然有效。
        invalidateBlastMemo()
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
    function projectsFromConfig(srcText, root) {
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
    function removeMigratedSource(p, root) {
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
                const projCfg = await fs.resolve(rootOf(exec) + '/.dsh/.permgate.json')
                if (projCfg) {
                  const projExists = await configExists(fs, projCfg)
                  if (projExists) {
                    try {
                      const projText = await fs.readText(projCfg)
                      // 并入项目残留配置：只采纳 projects 段（工作区内文件不可信，其 global 一律忽略），
                      // 迁移成功落盘后再删除源文件
                      const mergedText = projectsFromConfig(projText, rootOf(exec))
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
        // retired 收集本次收敛的历史预设默认值键数与「名单是否需更新」（见 QUICK_RETIRED_DEFAULTS）
        const retired = { retired: 0, pending: false }
        config = isOld ? migrateOld(parsed) : buildConfig(parsed, retired)
        retiredQuickDefaults = retired.retired
        lastDiskJson = String(text).trim()
        loadError = null
        saveError = null
        // 配置整体换了一份 → 例外爆炸半径的缓存作废（世代失效，见 blastPatternMemo 的注释）。
        // 必须在下面那次可能的 persist() 之前也生效：那份 persist 只处理迁移落盘。
        invalidateBlastMemo()
        // 历史预设默认值被收敛过就必须落盘（理由见 QUICK_RETIRED_DEFAULTS）：
        // 只改内存会让「面板显示 / 磁盘值 / 生效值」三者长期不一致，且下次加载还要再算一遍。
        // 落盘失败也不阻断加载——内存里已是收敛后的值，本次运行行为正确，persist 会设
        // saveError 供面板显示（与既有写盘失败路径同口径）。
        if (isOld || migratedFromProject || retiredQuickDefaults > 0 || retired.pending) {
          const saved = await persist(exec)
          // 迁移成功落盘后才删除项目残留文件，避免写盘失败导致配置丢失
          if (saved && migratedFromPath) removeMigratedSource(migratedFromPath, rootOf(exec))
        }
        broadcast({ type: 'status' })
      } catch (e) {
        loadError = '配置解析失败: ' + ((e && e.message) || String(e))
        lastDiskJson = LOAD_FAILED_MARK
      }
    }

    function statusView(exec, lang) {
      const l = normLang(lang || uiLang)
      // 本视图对应的项目根：HTTP 路由按 sessionId 解析出 exec，工具调用直接有 exec，
      // 都从会话派生；拿不到时回落部署级根（面板显示的是「当前请求会话」的项目配置）。
      const root = rootOf(exec)
      const proj = projectBlock(root)
      const effective = {}
      for (const c of CATS) {
        effective[c] = firstEffective(proj && proj[c] && proj[c].mode, config.global[c] && config.global[c].mode, 'allow')
      }
      const stats = { deny: 0, ask: 0 }
      for (const d of decisions) {
        if (d.action === 'deny') stats.deny++
        else if (d.action === 'ask') stats.ask++
      }
      // 会话真实生效的沙箱（浏览器半的权限选择器图标按它区分受限/非受限）：
      // 语义等价于 resolve 内部对 mode 的计算（会话 sandbox/mode 折叠值 ?? 部署默认），
      // 但不用 resolve —— 它顺带算 workspaceRoot，内部走 canonicalPath 的
      // realpathSync.native（同步文件系统调用），而 statusView 在 HTTP 路由与每次
      // 工具调用上都会跑，这里只要 mode，没必要付出这个代价。
      // 不能只用 overrideOf：它对「从未写过 sandbox/mode」的会话返回 undefined，
      // 客户端会按「非受限」渲染，但部署默认（DSH_PERMISSION_MODE 未设时）恰是受限的。
      // 与 sandbox.effective（permgate 配置解析值）区分开：配置值在 syncSandbox
      // 尚未落地的瞬间可能与会话真实值不一致。
      const sess = currentSession(exec)
      let sessionSandbox = null
      try {
        if (sess) {
          const ov = sp.overrideOf ? sp.overrideOf(sess) : null
          if (ov) sessionSandbox = ov
          else if (typeof sp.defaultMode === 'string') sessionSandbox = sp.defaultMode
          else if (sp.resolve) sessionSandbox = sp.resolve({ session: sess }).mode || null
        }
      } catch (e) { sessionSandbox = null }
      // 平台选择器「此刻会显示哪个预设名」= 投影的 derive 结果（客户端渲染 currentValue
      // 用的就是它）。与 activeForSession 不是一回事：后者回答「审查是否生效」（显式
      // permission/preset 事件），本字段回答「平台原生显示什么」。两者会分叉——
      // 选了 custom-review 但 knobs 落在别的组合时平台显示 Custom；反之 preset 为空
      // 而 knobs 恰好命中 custom-review 表项时平台原生就显示审查名。
      // 浏览器半据此决定是否要把 Custom 改写成审查名，以及自己的改写标记是否已过期。
      let platformPreset = null
      try {
        const pp = ctx.permissionPresets
        if (sess && pp && typeof pp.current === 'function') {
          const arg = typeof pp.permissionState === 'function' ? sess : (sess && sess.events)
          platformPreset = pp.current(arg) || null
        }
      } catch (e) { platformPreset = null }
      // 新会话（尚未创建）时没有会话可查：权限状态由「新会话默认预设」唯一决定，
      // 平台在 pinInitialPermission 里正是用它 seed 新会话。浏览器半据此判断
      // 新会话界面的选择器该显示什么 —— 不提供的话它会按「平台态未知」保守不动，
      // 新会话就永远显示内置未匹配态 Custom（新会话界面拿不到会话态，见客户端注释）。
      let defaultView = null
      try {
        const pp = ctx.permissionPresets
        const dp = pp && typeof pp.defaultPreset === 'string' ? pp.defaultPreset : null
        if (dp) {
          defaultView = {
            // 新会话还没有会话日志，permissions 投影为空，平台的 derive() 落到内置
            // 未匹配态（新会话界面确实渲染 Custom），故固定为 'custom'。
            platformPreset: 'custom',
            // 审查是否生效由默认预设决定：平台按它 seed 新会话
            activeForSession: dp === 'custom-review',
            // 沙箱用 permgate 的配置解析值，而非预设捆绑值：新会话创建后 syncSandbox
            // 会把会话沙箱对齐到该值，用它才能与创建后看到的图标一致（预设捆绑值是
            // 平台的初始意图，随后就被 permgate 覆盖，拿它会让图标闪一下再变）。
            sandbox: effectiveSandboxConfig(root),
          }
        }
      } catch (e) { defaultView = null }
      return {
        configPath: target ? (fs.processPath ? fs.processPath(target) : String(root)) : String(root) + '/.dsh/.permgate.json',
        active: true,
        preset: sessionPresetName(exec),
        sandbox: {
          global: config.global.sandboxMode || 'danger-full-access',
          project: (proj && proj.sandboxMode) || 'inherit',
          effective: effectiveSandboxConfig(root),
          session: sessionSandbox,
        },
        activeForSession: sessionPresetName(exec) === 'custom-review',
        // 平台选择器此刻原生会显示哪个预设（'custom' = 内置未匹配态）。浏览器半据它
        // 判断「Custom 是不是平台原生渲染的」——只有平台确实渲染 Custom 时才该改写，
        // 也只有在平台仍渲染 Custom 时才该把自己的改写还原回去。
        platformPreset,
        // 新会话（无 sessionId）视图：浏览器半在 sessionId 缺失时用它，让新会话界面
        // 的选择器也能显示插件预设名与图标。null = 取不到默认预设（宿主未挂载
        // permissionPresets 时），此时客户端保持「平台态未知」的保守行为。
        defaultView,
        projectKey: root,
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
          // 循环状态当前跟踪的会话桶数（只读诊断）。
          // 为什么要下发它：这个 Map 是**唯一**无上界风险的状态（每会话一个桶，按 LRU 淘汰到
          // SESSION_BUCKET_MAX）。它的两个失败模式（取不到会话时「每次调用建一个桶」而增长、
          // 或淘汰逻辑写错而超限）在外部**完全不可观察** —— 行为上看不出区别，只有内存慢慢涨。
          // 故把桶数下发出来，让测试与面板都能直接断言/看到它没有失控。
          loopBuckets: streakBySession.size,
        },
        stats,
        recentDecisions: decisions.slice(-10).map((d) => Object.assign({}, d, { reason: L(d.reason, l) })),
        cats: CATS,
        // command 分类的子设置「破坏性命令」：下发**八档**的生效值、各层显式配置与推导默认值。
        // 与 quickTools/quickDefaults 同口径 —— 面板显示的就是裁决实际用的那个值。
        // labels 一并下发供设置页**只读展示**（名单固定，不开放用户增删，D-12）。
        // groups 下发组 → 成员表。**字段保留**：§7.3 把它列为下发契约，删掉是设计冲突。
        // ⚠️ 但面板的分组**不由它驱动** —— 客户端用自己的 `SUB_TIER_META` 的 `g` 字段分组
        //   （radius / group 两组，见 client.js 的 subTierList 与两处渲染点），
        //   `commandSub.groups` 在 client.js 中出现 **0 次**；生产侧目前只有本处赋值
        //   与 test/smoke.mjs 的一条存在性断言。故它是**供外部消费的协议契约**，
        //   不在渲染链上：改它不会改变面板分组（要改分组得动客户端的 SUB_TIER_META）。
        // 分组本身要表达的判据差异不变：半径档（del/disk/perm + priv 的半径面）与
        //   组档（proc/power/priv/reg）判据不同，用户需要知道「这一档是按目标范围判的，
        //   还是按命令名判的」（§7.4）。
        //
        // global/project 是该层的**显式配置**（null = 用户没设过）。
        //
        // ── *Default 字段（globalDefault / projectDefault）：**已删除**──────────────────
        // 这里曾下发 `globalDefault` / `projectDefault`，由**另一个**函数
        // `destructiveTierDefaults(本层 mode)` 算出（按 mode 推导），与裁决用的
        // `destructiveTiers` 是**两套规则**。两者在存量配置上会逐档分叉，例如
        // 存量 `destructive:{action:'deny'}` + command mode=allow：
        //   · 旧 *Default（按 mode） → inside=allow、其余七档=ask
        //   · 实际裁决（同构继承）   → inside=deny（显式）、其余七档=ask
        // 即同一份响应里会同时出现两个互相矛盾的 `inside` 默认值（实测 1/8 档分叉）。
        //
        // 删除理由（而不是继续标注为「仅供对比的旧口径」）：
        //   · 该字段**没有生产消费方** —— 客户端已改读 `effective[tier]` /
        //     `globalEffectiveProbe`（见 client.js 的回填逻辑），`commandSub.*Default`
        //     在 client.js 中的引用已归零；
        //   · 它经 `perm_status`（本文件的 registerTool）原样回给 **AI**，而「按本层 mode
        //     推导档位缺省」这套语义已被 .plan/blast-tier-design.md 明确否定 ——
        //     继续下发等于把一个已下线的口径当作契约对外承诺，AI 读到的是一个
        //     与实际裁决不一致的默认值表；
        //   · 「八档默认值」这条规则因此**只剩一份实现**（`destructiveTiers`），
        //     不会再有第二份真相需要同步维护。
        // 面板与外部消费方要「未配置时实际会用哪个值」，请读 `effective`（按当前项目）
        // 或 `globalEffectiveProbe`（全局层单独解析）—— 两者都由 `destructiveTiers` 求出。
        commandSub: {
          key: 'destructive',
          tiers: TIERS,
          // effective：每档的**生效值**（含推导），面板直接显示；附 source 标注该档来自哪一层
          effective: destructiveTiers(root),
          // globalEffectiveProbe：**全局层单独**的生效值（无项目块时的 destructiveTiers）。
          //
          // ── 为什么必须单独下发（面板 tab 的分派依据）──────────────────────────────
          // `effective` 是按**当前项目**算的（explicitOf 项目优先），而面板有**两个** tab。
          // 全局 tab 拿它回填，就会把「项目层显式配置的值」显示成全局层的值 ——
          //   实测：全局层从未配置、当前项目只设了 `wide:'deny'` 时，全局 tab 的 wide
          //   显示成「拒绝」（全局层真实值是 ask/未表态）。用户切到全局 tab 看到「拒绝」，
          //   会以为全局已受保护；删掉项目配置或换个项目后保护**静默消失**。
          //   更严重的是**写错层**：该行既然显示 deny 就会渲染出「编辑原因」按钮，用户补一句
          //   理由，commitSubReason 便以 target:'global' + action:'deny' 提交 ——
          //   在全局层**凭空写入 wide=deny**，影响所有项目。
          // 与 doomloop 阈值行（client.js 的 `defN` 按 tab 分派）是同一类坑、同一条纪律：
          // **全局 tab 不能用按当前项目算的生效值**。
          //
          // ── 为什么不能回落到「按本层 mode 推导的档位缺省值」────────────────────────
          // 本字段是「全局层单独解析」的生效值，必须与裁决**同源**（同一个 destructiveTiers）。
          // 曾经有个按本层 mode 推导的 *Default 字段可作回落，但它与裁决是两套规则：
          // 存量 `{action:'deny'}` + mode=allow 时它给出 inside=allow、其余七档=ask，
          // 而全局层单独生效值是 inside=deny、其余七档=ask —— 用它回填等于把「面板说谎」
          // 原样复制到另一族形态上（方向还相反：显示 allow、实际 deny），正是上面那段
          // 分叉警示警告的情形。那个字段已整体删除（理由见上方 *Default 段），
          // 故这里**只有** `destructiveTiers` 这一个来源，不存在可回落的第二份口径。
          globalEffectiveProbe: destructiveTiers(GLOBAL_PROBE_ROOT),
          // global/project：每档的**显式配置**（null = 该层没设过），用于不协调提示
          global: (config.global.command && config.global.command.destructive) || null,
          project: (proj && proj.command && proj.command.destructive) || null,
          // per-tier 拒绝理由（§7.1）：{ wide: "删系统目录", priv: "别提权" }
          // 老配置的 `reason` 字符串在读取侧归入 reasons.inside（**不写盘**）
          globalReasons: explicitReasonsOf(config.global.command && config.global.command.destructive),
          projectReasons: explicitReasonsOf(proj && proj.command && proj.command.destructive),
          labels: [...DESTRUCTIVE_LABELS].sort(),
          groups: GROUP_MEMBERS,
        },
        // doomloop 的阈值下发（与 commandSub 同口径）：effective 是**实际生效值 + 来源**，
        // global/project 是该层的**显式配置**（null = 用户没设过），defaultThreshold 是内置默认。
        // 三者必须分开下发：面板要「未配置时显示默认」，但默认值的推导在宿主（读取侧单一来源），
        // 客户端不能自己写死一个 6 —— 否则日后改默认阈值时，面板会显示旧值而裁决按新值走（面板说谎）。
        doomloop: {
          key: 'threshold',
          effective: doomloopSetting(root),
          global: (config.global.doomloop && typeof config.global.doomloop.threshold === 'number') ? config.global.doomloop.threshold : null,
          project: (proj && proj.doomloop && typeof proj.doomloop.threshold === 'number') ? proj.doomloop.threshold : null,
          defaultThreshold: DEFAULT_REPEAT_STREAK,
          min: MIN_REPEAT_STREAK,
          // 无上限（§2.4）：窗口已删，计数能数到任意大。下发 null 而不是一个具体数，
          // 免得客户端把「某个大数」当成上限去钳制 —— 那正是本计划要避免的双份钳制。
          max: null,
        },
        editorKernel: resolveEditorKernel(exec, root),
        fallback: { global: config.global.fallbackMode || 'ask', project: (proj && proj.fallbackMode) || 'inherit', effective: fallbackMode(root), globalReason: normalizeText(config.global.fallbackReason) || null, projectReason: normalizeText(proj && proj.fallbackReason) || null },
        excCats: EXC_CATS,
        // 例外的爆炸半径（只读派生，**不落盘**）：给面板的例外列表标注「这条例外放开的目标
        // 是盘根 / 系统目录 / 家目录 / 工作区外」。
        //
        // 为什么必须**读侧现算**而不是写进配置：那正是本文件反复警告的「推导值物化成用户表态」
        // （见 doomloopSetting / normalizeCategory 的注释）—— 一旦落盘，日后改判据时存量配置里
        // 的旧结论会永久压过新判据，且此后任何一次无关写盘都会把它固化。
        //
        // 只算 **allow 例外**：deny 例外指向盘根是**保护**而不是风险，标注它只会制造噪音，
        // 而噪音会让真正的警告被忽略（狼来了）。
        //
        // 形状是 { global: { [例外id]: {level,path} }, project: {...} } 的分层表，
        // 不改动 categories 的形状：categories 是原样下发的配置本体，
        // 往里面塞派生字段会被 persist 带进磁盘。
        exceptionBlast: (function () {
          // home 给 expandTilde 用（DSH home，与既有约定一致）；**userHome 单独给档位判据用** ——
          // `rm -rf ~` 删的是用户家目录，不是 DSH home。两者混用会让「家目录」这一档整个失效
          // 并显示错误路径（实测：传 DSH home 时 `rm -rf ~` 显示 `C:/Users/me/.dsh`，
          // 而 `rm -rf C:/Users/me` 落到 system 档）。
          // platform 同样必需：它决定查哪一套系统目录名单、`/x` 是不是 cmd 开关。
          //
          // isWorkspaceRoot 与 isOutside **必须同源同口径**（§5.5）：解析器判不了「这是工作区根」，
          // 缺这一钩子的 opts 会把 `rm -rf .` / `rm -rf ./*` / `Remove-Item -Recurse -Force .` /
          // `rmdir /s /q .` 的目标（globRootOf 归约为 `.`）判成 inside → 面板对「放行了删整个
          // 项目根」的 allow 例外**零标注**（实测本处返回 null），而弹窗里同一命令标注为
          // workspace-root —— 同一命令两处口径分叉。本块自陈是「唯一能让人**事后**发现
          // 『我什么时候放行了删盘根』的地方」，故这一档不能缺。
          //
          // 这份 opts 与 commandDecision 里 assessCommand 那份**必须成对增删**：宿主内同一个
          // 判档 opts 写了两遍，新增钩子只接一处会让另一处静默失效（本文件曾如此）。
          // test/regressions.mjs 有「两处 opts 键集合一致」的断言钉住这一点。
          const opts = { home: homeFromEnv(), userHome: userHomeDir(), platform: shellPlatform(), isOutsideWorkspace: (p) => isOutside(p, root), isWorkspaceRoot: (p) => isWorkspaceRoot(p, root) }
          // 命令例外的 match 是**整条命令模式**，必须先按段分解再判档 ——
          // 直接把 `rmdir /s /q B:\` 喂给 blastRadiusOf 会把它当成一个路径，
          // 实测得到 {level:'outside', path:'rmdir /s /q B:'}（整个命令串被当路径、盘根信息丢失）。
          //
          // 哪些模式值得标注：用 canCarryDestructivePayload 而不是 isDestructiveSegment。
          // 后者只认「这一段就是破坏性的」（`rm -rf *`），会漏掉**模式本身不含破坏性选项、
          // 但 `*` 位置可能被填成删除动作**的族：`find *`（匹配 `find / -delete`）、
          // `env *`（匹配 `env FOO=1 rm -rf /`）、`xargs *`（匹配 `xargs rm -rf /`）。
          // 这三条正是 HEAD 的候选生成器写下的形态，属必然存在的存量配置，而它们实测能放行
          // 删盘根 —— 只认 isDestructiveSegment 会让它们在面板上零标注。
          // 反向仍要收住：`git status *` 这类普通命令不标注（噪音会让真警告被忽略）。
          const blastOfCommand = (pattern) => {
            // 记忆化：statusView 每次都要现算，而例外文本长度无上限（见 blastPatternMemo）。
            // 键含 root：判档里的 isOutsideWorkspace 闭包捕获了 root，换项目根结论会变。
            const memoKey = root + '\u0000' + String(pattern)
            if (blastPatternMemo.has(memoKey)) return blastPatternMemo.get(memoKey)
            const result = (() => {
              let worst = null
              // 方言必须与**候选侧**同源（SHELL_OF_TOOL）——例外没有工具信息，只能按两门都试。
              // 但不能固定 pwsh 优先：bash 词法器把 `\` 当转义符，同一串两侧段划分不同，
              // 于是同一条例外在弹窗与列表会得出不同档位（实测 `rm -rf C:\Users\me`：
              // pwsh 分解 → home|C:/Users/me，bash 工具弹窗 → outside|C:Usersme）。
              // 两门都跑、取更严重的一档：两侧都可能是用户实际使用的方言，取并集方向 fail-safe。
              for (const sh of ['pwsh', 'bash']) {
                let dd = null
                try { dd = decomposeCommand(String(pattern), sh) } catch (e) { dd = null }
                if (!dd || !dd.ok) continue
                for (const seg of dd.segments) {
                  if (!canCarryDestructivePayload(seg.words)) continue
                  // 宽泛通配（`rm -rf *`）走 blastRadiusOfCommandPattern：它能放行盘根删除，
                  // 但 globRootOf 归约后判成 inside 而返回 null —— 面板上零标注。
                  const b = blastRadiusOfCommandPattern(seg.words, opts)
                  if (b && BLAST_ORDER[b.level] !== undefined
                    && (!worst || BLAST_ORDER[b.level] < BLAST_ORDER[worst.level])) worst = b
                }
              }
              return worst
            })()
            // 上限兜底：达到它说明配置里有两万条不同例外，那时真正的瓶颈是配置文件本身。
            // **不再逐条 FIFO 淘汰** —— 那个策略在 key 数 > 上限时命中率恒为 0（见 blastPatternMemo 的注释）。
            if (blastPatternMemo.size >= BLAST_PATTERN_MEMO_MAX) invalidateBlastMemo()
            blastPatternMemo.set(memoKey, result)
            return result
          }
          // 路径例外的记忆化：与命令例外共用同一张表（问题同源 —— 路径例外同样是用户配置、
          // 长度同样无上限，而它在同一循环里每次 statusView 都要现算）。
          // 键前缀区分两类输入（命令模式 vs 路径），避免同文本互相串用结论。
          const blastOfPath = (pathText) => {
            const memoKey = root + '\u0000p\u0000' + String(pathText)
            if (blastPatternMemo.has(memoKey)) return blastPatternMemo.get(memoKey)
            const result = blastRadiusOf(pathText, opts)
            if (blastPatternMemo.size >= BLAST_PATTERN_MEMO_MAX) invalidateBlastMemo()
            blastPatternMemo.set(memoKey, result)
            return result
          }
          // **按层分开**：`out` 曾是以例外 id 为唯一键的平表，而全局块与项目块的 id 空间
          // 并不共享（normalizeException 只在缺失时才补随机 id，手写/存量配置可相同），
          // 后遍历的项目块会覆盖全局块 → 标注串台。实测：全局 `{id:'same', match:'rmdir /s /q B:\'}`
          // + 项目 `{id:'same', match:'git status *'}` → 无害的 `git status *` 被标成「目标是一整个盘」；
          // 反向（全局无害 + 项目危险）则危险那条**丢掉警告**。面板按 tab 分别渲染，
          // 两处都读同一份平表，故必须分层下发。
          const out = { global: {}, project: {} }
          const lists = [[config.global, 'global'], [proj, 'project']]
          for (const pair of lists) {
            const blk = pair[0]
            const layer = pair[1]
            if (!blk) continue
            for (const c of EXC_CATS) {
              const cat = blk[c]
              if (!cat || !Array.isArray(cat.exceptions)) continue
              for (const r of cat.exceptions) {
                if (!r || !r.id || r.action !== 'allow') continue
                const target = c === 'command' ? r.match : r.path
                if (!target) continue
                const b = c === 'command' ? blastOfCommand(target) : blastOfPath(target)
                // 未知档不再静默丢弃（同 worstBlast 的理由：那是「忘了接线」的信号）
                if (!b) continue
                if (b.level === 'inside') continue
                // 判「是否已知档」用属性取值而不是 `in`：`in` 会命中原型链
                // （`'constructor' in BLAST_ORDER` 为 true），把未知档误判成已知档。
                if (BLAST_ORDER[b.level] === undefined) console.warn('[permgate] unknown blast level:', b.level)
                out[layer][r.id] = b
              }
            }
          }
          return out
        })(),
        // 例外遮蔽关系（只读派生，**不落盘**）：给面板标注「这条例外被前面某条更早的例外遮蔽，
        // 当前不生效」。
        //
        // 为什么需要：写入侧已改为 push 到末尾（顺序即优先级、归用户），而读侧
        // （resolveCategory / matchSegmentException）仍是**首条命中即生效**。于是新加的例外
        // 若与前面某条同目标且方向相反，它不会生效 —— 用户却只看到列表里多了一行、
        // 面板还提示「已保存」，会以为决定已生效。用户明确要求用「行内标注」来暴露这一点。
        //
        // 判据与读侧**同构**：对每条例外，检查它前面是否存在「会先命中同一目标」的反向条目。
        // 逐条按同口径比较（命令走 matchCommand，路径走 matchGlob + normAbsPath），
        // 不自行发明一套「同目标」判据 —— 否则标注会说「没被遮蔽」而实际被遮蔽（或反之）。
        //
        // ── 判据的方向性与边界（有意取舍）──────────────────────────────────────
        // 两个 glob 模式是否**相交**在一般情况下不可判定，故这里不做那种判断，只判
        // 「前面那条的模式能否命中**这一条的目标文本**」（hits(prev, curTarget)）：
        //   · 命中 → 这条例外**永远轮不到**（任何会被 cur 命中的命令，都会先被 prev 命中），
        //     标注「被遮蔽」是确定的结论，不是猜测；
        //   · 不命中 → 不标注。这里会**漏报**「cur 比 prev 更宽泛」的情形（如 prev=`git status`、
        //     cur=`git *`）：那种情况下 cur 对部分命令仍然生效，并非「不生效」，
        //     标注它反而会让用户以为刚加的宽泛规则完全没用 —— 漏报比误报安全。
        //
        // 同向条目不标注：读侧首条命中即生效，同向时后面的那条即使被遮蔽，**结论也相同**
        // （allow 被 allow 遮蔽仍是 allow），标注它只会制造噪音（狼来了）。
        // ask 例外不排除：它同样会「先命中」并改变结果（弹窗 vs 静默放行），是真实冲突。
        //
        // 与 exceptionBlast 同样是**读侧现算**：顺序会随用户拖动而变，落盘会变成
        // 「推导值物化成用户表态」（见 doomloopSetting / normalizeCategory 的注释），
        // 且排序后必须重算才准 —— 现算天然满足「调整顺序后重新处理标注」。
        //
        // 形状 { global: { [例外id]: {byId, byAction} }, project: {...} }，与 exceptionBlast 分层同构。
        //
        // ── 为什么要预算规范化与正则（不是过早优化）────────────────────────────
        // 判据是「逐条看它前面有没有能命中它的反向条目」，朴素写法是二重循环里直接调
        // matchGlob / normAbsPath —— 那是 O(n²) 次**昂贵**调用：normAbsPath 内含 pathResolve
        // （同步文件系统相关的路径解析），matchGlob 每次都 new RegExp。
        // 实测（本机）朴素写法：n=100 → 3.2 ms、n=300 → 29 ms、n=600 → 119 ms，
        // 而 statusView 由 GET /permgate/status、每次 SSE 推送、各写盘路由回带、
        // perm_status 工具反复调用 —— 与 exceptionBlast 当初要消除的开销同量级。
        // 故这里把「每条自身的规范化结果」与「每条模式的正则」各算一次（O(n)），
        // 内层只做纯比较（正则 test 与手写 glob 匹配）。
        //
        // 注意：这里**不需要** exceptionBlast 那套按世代失效的记忆化 —— 本函数每次现算，
        // 而缓存只活在本次调用内（局部 Map），不存在跨 status 的陈旧问题。
        exceptionShadow: (function () {
          const out = { global: {}, project: {} }
          const lists = [[config.global, 'global'], [proj, 'project']]
          for (const pair of lists) {
            const blk = pair[0]
            const layer = pair[1]
            if (!blk) continue
            for (const c of EXC_CATS) {
              const cat = blk[c]
              if (!cat || !Array.isArray(cat.exceptions)) continue
              const exs = cat.exceptions
              const isCmd = c === 'command'
              // ① 预算：每条例外的「目标」与「自身作为模式时的正则」各算一次。
              //    路径侧两侧都要 normAbsPath（写入口径不一：候选写规范绝对路径，
              //    面板可写相对或含 .. 的原文），与 matchException 同口径。
              const targets = new Array(exs.length)
              const regexps = new Array(exs.length)
              for (let i = 0; i < exs.length; i++) {
                const r = exs[i]
                if (!r) continue
                const raw = isCmd ? r.match : r.path
                if (!raw) continue
                if (isCmd) { targets[i] = String(raw); continue }
                try {
                  const t = normAbsPath(raw, root)
                  targets[i] = t
                  // globToRegExp 内含 norm，而 t 已是规范化结果（幂等），故可直接复用。
                  regexps[i] = globToRegExp(t)
                } catch (e) { targets[i] = null }
              }
              // ② 判「前面的 prev 能否命中 target」。命令例外必须按读侧方向调用：
              //    matchCommand 做的是词边界**前缀**匹配，方向不对称（模式在前、原文在后），
              //    反过来传会得出完全不同的结论。
              const hits = (prevIdx, target) => {
                const prev = exs[prevIdx]
                if (!prev || !target) return false
                try {
                  if (isCmd) return matchCommand(prev.match, target)
                  const re = regexps[prevIdx]
                  // 与 matchGlob 等价：globToRegExp(模式).test(规范化的值)，
                  // 两侧都已规范化，故省掉 matchGlob 内部那两次 norm。
                  return !!re && re.test(target)
                } catch (e) { return false }
              }
              for (let i = 0; i < exs.length; i++) {
                const cur = exs[i]
                if (!cur || !cur.id) continue
                const target = targets[i]
                if (!target) continue
                let blocker = null
                for (let k = 0; k < i; k++) {
                  const prev = exs[k]
                  if (!prev || prev.action === cur.action) continue
                  if (hits(k, target)) { blocker = prev; break }
                }
                if (blocker) out[layer][cur.id] = { byId: blocker.id, byAction: blocker.action }
              }
            }
          }
          return out
        })(),
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

    // ── 路由信任栅栏 ─────────────────────────────────────────────────────────
    // 为什么需要：/permgate/* 是**写权限配置**的入口（set-category / add-rule …），
    // 而 webServer 不提供任何鉴权（其包文档明说「It knows no harness concepts」）。
    // 于是本路由此前对任何能连上端口的客户端都无条件执行——实测
    // `POST /permgate/set-category` 无凭据即返回 200 并改掉配置。
    // 后果：AI 有 pwsh 工具，`curl http://127.0.0.1:3080/permgate/set-category` 就能
    // 改自己的权限约束——把「移除 9 个权限写工具」的安全收益整个抵消。
    //
    // 两层，按可靠性从高到低：
    //
    // 【第一层 · 真凭据】DSH 的 `connection` service 暴露 requestRejection()，内部是
    // 官方的 Host/Origin 栅栏 + **浏览器会话令牌认证**（HttpOnly/SameSite=Strict 的签名
    // cookie，Path=/ 故本路由也收得到；未认证返回 401）。它同时接受官方认可的
    // trustedHosts（LAN 字面量、`--trusted-host`），因此 LAN/反代部署不会被误伤。
    // 能用就用它——这是唯一真正区分「操作员浏览器」与「本机任意进程」的东西。
    // 用 ctx.get('connection') 可选获取而非写进 inject：Electron/shell 载体与测试宿主
    // 可能没有该 service，硬 inject 会让插件整体加载失败。
    //
    // 【第二层 · 兜底栅栏】拿不到 connection 时退到下面这套请求头判据。必须说清它的
    // 真实强度：**它不是认证，只防 DNS rebinding 与跨站请求**。官方 isTrustedApiRequest
    // 的文档自陈「not an auth layer」，本兜底同理——请求头由客户端完全控制，
    // 本机进程补一个 `Sec-Fetch-Site: same-origin` 就能通过（实测）。
    // 故它挡不住「AI 用 pwsh 自行调路由」，只提高了一点门槛；真正的防线是第一层。
    // 判据（全部满足才放行）：
    //   ① Host 必须是回环地址（防 DNS rebinding：攻击者域名解析到本机时 Host 是攻击者域名）；
    //   ② 不得带 `sec-fetch-site: cross-site`（浏览器明确标记的跨站请求）；
    //   ③ 带 Origin 时必须与 Host 同源；
    //   ④ 必须带 `sec-fetch-site`（拦掉不伪装的最朴素 curl）。
    // 第 ④ 条的代价：非浏览器客户端（脚本/CI）不能再直接调这些路由，且这条**挡不住
    // 有意伪造者**。若将来需要脚本化，应走第一层的令牌而非放开此栅栏。
    //
    // 只读路由（status/pending/file-diff/events）也一并设栅栏：status 会下发例外
    // reason/note 与绝对路径，属部署内部信息，同样不该对本机任意进程敞开。
    //
    // authority 规范化只此一处：两套写法（如 Host `localhost:80` vs Origin `http://localhost`、
    // IPv6 `[0:0:0:0:0:0:0:1]` vs `[::1]`）交给 WHATWG URL 收敛，避免①与③对同一请求
    // 得出相反结论——那种冲突会让白名单里的某些写法在带 Origin 的写路径上永远不可达。
    function parseAuthority(hostHeader) {
      try {
        const raw = String(hostHeader || '').trim()
        if (!raw) return null
        // 借 WHATWG 归一化：默认端口省略、IPv6 压缩、大小写都按同一口径收敛
        const u = new URL('http://' + raw)
        return { hostname: u.hostname.toLowerCase(), host: u.host.toLowerCase() }
      } catch (e) { return null }
    }
    function isLoopbackAuthority(authority) {
      if (!authority) return false
      // WHATWG 把 IPv6 hostname 连方括号一起返回（形如 "[::1]"）
      const h = authority.hostname
      return h === '127.0.0.1' || h === 'localhost' || h === '[::1]'
    }
    function trustRouteRequest(req) {
      try {
        const host = req.headers && req.headers.host
        const authority = parseAuthority(host)
        if (!isLoopbackAuthority(authority)) return false
        const site = req.headers['sec-fetch-site']
        if (site === 'cross-site') return false
        const origin = req.headers.origin
        if (origin !== undefined && origin !== null && origin !== '') {
          // 同源比较走同一套规范化：Origin 的 host 与 Host 的 host 都取自 WHATWG URL
          if (new URL(origin).host.toLowerCase() !== authority.host) return false
        }
        // 必须带 Fetch Metadata：浏览器对 fetch 与 EventSource 都会带，最朴素的 curl 不带
        if (site === undefined || site === null || site === '') return false
        return true
      } catch (e) { return false }
    }
    // 第一层：官方 connection service 的 Host/Origin 栅栏 + 令牌认证。
    // 返回 401/403 表示拒绝，undefined 表示放行；null 表示「该 service 不可用，请走兜底」。
    function officialRejection(req) {
      try {
        const conn = ctx.get('connection')
        if (!conn || typeof conn.requestRejection !== 'function') return null
        const r = conn.requestRejection({ headers: req.headers || {} })
        return r === 401 || r === 403 ? r : undefined
      } catch (e) { return null }
    }
    // 被拒日志限速：EventSource 对 403 会持续自动重连，若每个请求都打一行，
    // 一个打开着的设置页就能刷满日志。按「来源 + 判定结果」在时间窗内只记首条。
    const FENCE_LOG_WINDOW_MS = 60000
    let fenceLogAt = 0
    let fenceLogSuppressed = 0
    function logFenceRejection(req, status) {
      const now = Date.now()
      if (now - fenceLogAt < FENCE_LOG_WINDOW_MS) { fenceLogSuppressed++; return }
      const extra = fenceLogSuppressed > 0 ? ' (+' + fenceLogSuppressed + ' suppressed)' : ''
      fenceLogAt = now
      fenceLogSuppressed = 0
      console.warn('[permgate] route rejected by trust fence:', status, (req.method || '?'), req.url || '?', extra)
    }

    async function routePermgate(req, res) {
      try {
        // 信任栅栏先于一切分支：拒绝的请求不解析路径、不读 body、不触碰配置。
        // 状态码语义与官方 /api 对齐：403 = 来源不可信（Host/Origin 栅栏），
        // 401 = 来源可信但缺浏览器凭据（需从 dsh web 打印的 URL 重新进入）。
        const official = officialRejection(req)
        if (official) {
          logFenceRejection(req, official)
          return json(res, official === 401
            ? { error: 'unauthorized: reopen the URL printed by dsh web to authenticate this browser', code: 'unauthenticated' }
            : { error: 'forbidden: request is not from the trusted browser origin', code: 'untrusted-origin' }, official)
        }
        // 兜底路径：connection 不可用（如 Electron/shell 载体或测试宿主）时才走请求头判据
        if (official === null && !trustRouteRequest(req)) {
          logFenceRejection(req, 403)
          return json(res, { error: 'forbidden: request is not from the trusted browser origin', code: 'untrusted-origin' }, 403)
        }
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
        // 按会话解析（设置面板/OverlayRoot 传 sessionId）：后续所有项目解析跟随该会话，
        // 切换会话后面板显示与写入的都是当前会话的项目配置
        let exec = null
        const sid = method === 'POST' ? a.sessionId : (search ? search.get('sessionId') : null)
        if (sid && ctx.sessions && typeof ctx.sessions.get === 'function') {
          try {
            const s = ctx.sessions.get(sid)
            if (s) exec = { agent: { session: s } }
          } catch (e) {}
        }
        // 未带 sessionId 时回落到 agentRef 的会话，而不是让 exec 保持 null：
        // 下游根派生 rootOf(exec) 会因此落到部署根，而 syncSandbox/agentCwd 用的是
        // agentRef.session —— 同一请求内「根」与「会话」分属两个项目，写盘归属与沙箱
        // 同步都会串台。在此统一到同一会话，使整条路由的根与会话同源。
        if (!exec && agentRef && agentRef.session) exec = { agent: { session: agentRef.session } }
        if (pathname === '/permgate/pending' && method === 'GET') {
          const out = []
          for (const e of pendingApprovals.values()) {
            const argsPreview = e.argsJson && e.argsJson.length > 160 ? e.argsJson.slice(0, 160) + '…' : (e.argsJson || '')
            const reason = L(e.reason, lang)
            const intent = L(e.intent, lang)
            // projRoot 下发给客户端：打开 DSH 右侧栏的 file tab 需要它来把工作区内的绝对路径
            // 折算成工作区相对路径（工作区外的绝对路径则原样进地址），与上游 fileAddressFor 同口径
            // projRoot/sessionId 下发给客户端：打开 DSH 右侧栏的 file tab 需要它们来构造
            // dsh-resource://file/session/<sessionId>/<path> 地址（工作区内的绝对路径还依赖 projRoot 折算）
            //
            // cat/deadline/onTimeout/note 也必须在白名单里：客户端缩小方块要按 cat 选图标与
            // 标签（缺失则永远回落通用扳手图标 + 裸工具名），倒计时条要按 deadline 倒数、
            // 按 onTimeout 显示超时落点，note 是「为什么走到这一步」的唯一说明位。
            // 白名单式投影漏字段不会报错，只会让客户端静默退化，故新增 entry 字段时必须同步此处。
            out.push({ id: e.id, tool: e.tool, reason, ts: e.ts, args: argsPreview, intent, intentLabel: e.intentLabel ? L(e.intentLabel, lang) : null, candidates: e.candidates || [], argLines: e.argLines || [], hasDiff: e.hasDiff === true, projRoot: e.projRoot || null, sessionId: e.sessionId || null, sessionTitle: e.sessionTitle || null, cat: e.cat || null, deadline: e.deadline || null, onTimeout: e.onTimeout || null, note: e.note || null, blast: e.blast || null })
          }
          return json(res, out)
        }
        if (pathname === '/permgate/file-diff' && method === 'POST') {
          const entry = pendingApprovals.get(a.id)
          if (!entry) return json(res, { ok: false, error: lang === 'en' ? 'Approval request not found or expired' : '审批请求不存在或已过期' })
          try {
            // a.encoding 不再接受：编码基准只由**工具自己透传**（read 的 encoding 参数），
            // 客户端指定一页就会与工具实际写入的那一页脱钩（详见 readPreviewText 的 ③）。
            const r = await buildFileDiffData(entry, fs)
            if (!r) return json(res, { ok: false, error: lang === 'en' ? 'Cannot build comparison' : '无法生成对比' })
            if (!r.ok) return json(res, { ok: false, error: L(r.error, lang) })
            return json(res, r)
          } catch (e) {
            // 记录真实错误，避免生产故障只以泛化文案呈现而不可见
            console.error('[permgate] file-diff error:', e)
            return json(res, { ok: false, error: lang === 'en' ? 'Cannot build comparison' : '无法生成对比' })
          }
        }
        if (pathname === '/permgate/status' && method === 'GET') {
          await init(exec)
          // 按会话查询：web 端 OverlayRoot/设置面板传 sessionId，状态只反映该会话的权限；
          // 缺失时走全局回退（最近权限事件会话 / 最后创建会话）
          return json(res, statusView(exec, lang))
        }
        if (pathname === '/permgate/decide' && method === 'POST') {
          const entry = pendingApprovals.get(a.id)
          if (!entry) return json(res, { error: lang === 'en' ? 'Approval request not found or expired' : '审批请求不存在或已过期' })
          // 本路由的会话上下文：客户端 decide 载荷只有 {id, action, rules, reason}，不带 sessionId，
          // 故按 entry.sessionId（审批发起时记下的会话）反查。没有它时 init/persist 会退到
          // 「最近活跃会话」，落盘路径与写策略都会跟着别的会话走 —— 这正是「第一次点允许没写进去、
          // 第二次才成功」的成因（首次进入本路由时闭包 root/target 可能还停在别的项目）。
          let exec = null
          if (entry.sessionId && ctx.sessions && typeof ctx.sessions.get === 'function') {
            try {
              const s = ctx.sessions.get(entry.sessionId)
              if (s) exec = { agent: { session: s } }
            } catch (e) {}
          }
          // 载荷校验提前到认领之前：纯检查、无副作用。若放在认领之后，非法选择走错误
          // 分支时本条会「已认领但未结案」—— 既不结案也不再超时，永久挂在待审批池里。
          // 判定只此一份，下面的分支不再重复校验（避免两处清单漂移）。
          const direct = typeof a.action === 'string' && (a.action === 'allow' || a.action === 'deny')
          if (!direct && DECIDE_CHOICES.indexOf(a.choice) === -1) {
            return json(res, { error: lang === 'en' ? 'Invalid choice' : '非法选择' })
          }
          // 先认领再 await：`init` 内部有真实 I/O 挂起点（fs.resolve/stat/readText），
          // 期间事件循环会让出到 timers 阶段。若用户恰在倒计时末尾点「允许」，超时回调
          // 会抢先结案（resolve 对已 settle 的 Promise 静默无效），结果是「用户点允许、
          // 本次调用却被拒绝」，且审计补记成 timeout-deny —— 与用户动作相反。
          // claim() 与 get() 之间没有 await，定时器回调不可能插进来，故此处认领即彻底关闭竞态。
          // 认领失败 = 已被超时/abort 结案（正常情况下列表里也已无此条，走上面的 not found）。
          if (typeof entry.claim === 'function' && !entry.claim()) {
            return json(res, { error: lang === 'en' ? 'Approval request already settled' : '该审批已结案' })
          }
          // 认领之后必须保证以 settle 收尾：认领只负责「抢占」，而 cleanup + resolve 在其后。
          // 这里包 try/catch 的原因 —— `await init(exec)`（及 `await persist`）是真实 I/O，
          // 抛错会被 routePermgate 最外层 catch 转成 500，若不做收尾，该条目会停在
          // 「已 settled、定时器已清、但未 cleanup 未 resolve」的终态：卡片永久留在
          // /permgate/pending 里、用户再点任何按钮都被判「该审批已结案」而无法重试、
          // 连 abort 兜底（onAbort 里的 claim）也失效，askUser 的 Promise 永不 settle，
          // 对应工具调用永久挂起。fail-closed：异常一律按拒绝结案（宁可拒绝也不静默放行）。
          try {
            // 与其余写盘路由一致：先确保配置已加载、target 已解析，再落盘。
            await init(exec)
            let allow = false
            let ruleCount = 0
            // 例外落盘单点（候选路径与旧形态规则共用）：内含「拒绝时不写 directory 例外」这道安全过滤
            // 与计数，避免同一决定因入口不同而落盘范围不同；候选写入一律显式落到项目块。
            // root 用 entry.projRoot（审批发起时的快照）：弹窗可能挂起很久、期间用户会切会话，
            // 用「当前会话」的根会把例外写进别的项目块（用户实测：在 proj-alpha 点的写进了 MCP）。
            const entryRoot = entry.projRoot || rootOf(exec)
            const writeException = (cat, kind, value, decision) => {
              if (decision === 'deny' && cat === 'directory') return
              addProjectException(cat, kind, value, decision, entryRoot, { target: 'project' })
              ruleCount++
            }
            const writeCandidate = (cand, decision) => {
              for (const w of cand.writes) writeException(w.cat, w.kind || 'path', String(w.value), decision)
            }
            // 复用上面 `direct` 的判定结果：该集合只能有一份，否则放宽一处会让载荷
            // 先通过校验并 claim()，再落到 else 读 a.choice（undefined）→ 静默当成普通 deny 结案，
            // 用户的 action 被丢弃，且没有任何断言会变红。
            if (direct) {
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
              // 合法性已在认领之前统一校验（那里是唯一一份判定）
              const m = /^(allow|deny)-(global|project)$/.exec(choice)
              if (m) {
                addRememberedRule(entry, m[1], m[2])
                ruleCount++
              }
              allow = choice === 'allow' || choice === 'allow-global' || choice === 'allow-project'
            }
            const customReason = typeof a.reason === 'string' ? a.reason.trim().slice(0, 500) : ''
            if (ruleCount > 0) await persist(exec)
            entry.settle(allow
              ? { kind: 'allow', ruleAdded: ruleCount > 0 }
              : { kind: 'deny', reason: customReason || (lang === 'en' ? (ruleCount > 0 ? 'User denied and rule added' : 'User denied') : (ruleCount > 0 ? '用户拒绝并加入规则' : '用户拒绝')) })
            return json(res, { ok: true, ruleAdded: ruleCount > 0 })
          } catch (e) {
            // 已认领但中途失败：必须以结案收尾，否则该审批永久卡死（见上方注释）。
            console.error('[permgate] decide failed after claim:', e)
            entry.settle({ kind: 'deny', reason: uiLang === 'en' ? 'Approval failed to complete; denied' : '审批处理失败，已拒绝' })
            return json(res, { error: (e && e.message) ? e.message : String(e) }, 500)
          }
        }
        if (pathname === '/permgate/cancel-timeout' && method === 'POST') {
          const entry = pendingApprovals.get(a.id)
          // 已结案/不存在时按幂等成功处理：用户的意图（别再自动结案）已经达成，
          // 返回错误只会让客户端弹出无意义的失败提示。
          if (!entry) return json(res, { ok: true, cancelled: false })
          if (typeof entry.cancelTimeout === 'function') entry.cancelTimeout()
          return json(res, { ok: true, cancelled: true })
        }
        if (pathname === '/permgate/set-sandbox' && method === 'POST') {
          await init(exec)
          const target = normTarget(a)
          if (!setSandboxConfig(rootOf(exec), target, a.mode)) return json(res, { error: '非法沙箱参数: target=' + target + ' mode=' + a.mode })
          await persist(exec)
          syncSandbox(exec)
          return json(res, statusView(exec))
        }
        if (pathname === '/permgate/set-fallback' && method === 'POST') {
          await init(exec)
          const target = normTarget(a)
          if (!setFallbackMode(rootOf(exec), target, a.mode, a.reason)) return json(res, { error: '非法兜底参数: target=' + target + ' mode=' + a.mode })
          await persist(exec)
          return json(res, statusView(exec))
        }
        if (pathname === '/permgate/set-categories' && method === 'POST') {
          await init(exec)
          for (const t of ['global', 'project']) {
            const src = a[t]
            if (!src || typeof src !== 'object') continue
            for (const c of CATS) {
              if (typeof src[c] === 'string') setCategoryMode(rootOf(exec), t, c, src[c])
            }
          }
          await persist(exec)
          return json(res, statusView(exec))
        }
        if (pathname === '/permgate/set-category' && method === 'POST') {
          await init(exec)
          // target 与其它设置路由同口径归一（缺失/非法一律 global）：若直接把 a.target 传进
          // setCategoryMode，非 'global' 的值会落到 project 并 ensureProject(rootOf(exec)) 凭空建块写盘。
          const target = normTarget(a)
          if (CATS.indexOf(a.category) === -1) return json(res, { error: '未知分类: ' + a.category })
          if (!setCategoryMode(rootOf(exec), target, a.category, a.mode, a.reason)) return json(res, { error: '非法的 target/mode 组合' })
          await persist(exec)
          return json(res, statusView(exec))
        }
        if (pathname === '/permgate/set-command-sub' && method === 'POST') {
          await init(exec)
          // target 与其它设置路由同口径归一（缺失/非法一律 global），理由见 set-category 处注释
          const target = normTarget(a)
          // tier 缺省 = inside（**向后兼容**：旧客户端不传 tier，写的就是老语义的 `action`）。
          // 非法 tier 由 setCommandSub 返回 false → 这里回错误，不静默落到某个档 ——
          // 静默落档会让「用户改 A 档的理由，把 B 档的动作改成了 deny」。
          if (!setCommandSub(rootOf(exec), target, a.action, a.reason, a.tier)) {
            return json(res, { error: '非法的 target/action/tier 组合' })
          }
          await persist(exec)
          return json(res, statusView(exec))
        }
        if (pathname === '/permgate/set-doomloop' && method === 'POST') {
          await init(exec)
          const target = normTarget(a)
          // threshold 语义与 set-category 的 reason 同口径：undefined = 不动（本路由当前只写阈值，
          // 动作仍走 set-category 的 doomloop 分类，故这里不重复一个 action 参数）。
          // 非法值**回错误而不是静默回落默认** —— 静默回落会让面板显示的值与实际裁决分叉
          // （用户以为设了 999，实际按 6 走）。
          if (a.threshold === undefined) return json(res, { error: 'threshold 不能为空' })
          if (!setDoomloopThreshold(rootOf(exec), target, a.threshold)) {
            return json(res, { error: '非法阈值: ' + a.threshold + '（需为正数，或项目层的 inherit）' })
          }
          await persist(exec)
          return json(res, statusView(exec))
        }
        if (pathname === '/permgate/set-quick' && method === 'POST') {
          await init(exec)
          const target = normTarget(a)
          if (!a.tool || !String(a.tool)) return json(res, { error: 'tool 不能为空' })
          if (!setQuickAction(rootOf(exec), target, a.tool, a.action, a.reason)) return json(res, { error: '非法动作' })
          await persist(exec)
          return json(res, statusView(exec))
        }
        if (pathname === '/permgate/add-exception' && method === 'POST') {
          await init(exec)
          if (EXC_CATS.indexOf(a.category) === -1) return json(res, { error: '该分类不支持例外' })
          if (!a.match || !String(a.match)) return json(res, { error: 'match 不能为空' })
          const e = normalizeException({ id: 'e' + Math.random().toString(36).slice(2, 8), action: a.action, reason: a.reason, note: a.note, path: a.category === 'command' ? undefined : a.match, match: a.category === 'command' ? a.match : undefined }, a.category)
          if (!e) return json(res, { error: '非法的例外参数' })
          // 例外写入统一走 addProjectException：与候选写入共用「同方向不重复、新条目追加到末尾」的语义。
          // 顺序即优先级（resolveCategory 首条命中即生效），而面板可拖动/上下移调整 ——
          // 新加的排最后，用户自己把它调到想要的优先级（与规则列表同一套语义）。
          const written = addProjectException(a.category, a.category === 'command' ? 'command' : 'path', a.match, a.action, rootOf(exec), { target: a.target, reason: a.reason, note: a.note })
          if (!written) return json(res, { error: '例外未写入：分类/参数不支持' })
          await persist(exec)
          return json(res, { added: written, status: statusView(exec) })
        }
        if (pathname === '/permgate/set-exception' && method === 'POST') {
          await init(exec)
          const block = a.target === 'project' ? ensureProject(rootOf(exec)) : config.global
          // patch 只带上「请求里真的出现过的字段」：`reason: ''` 是显式清除，
          // 而字段缺席是保留原值 —— 两者语义不同，不能在这里用 `|| undefined` 折叠掉。
          const patch = {}
          if (a.action !== undefined) patch.action = a.action
          if (a.value !== undefined) patch.value = a.value
          if (a.reason !== undefined) patch.reason = a.reason
          if (a.note !== undefined) patch.note = a.note
          const r = setExceptionEntry(block, a.category, a.id, patch)
          // 失败一律回 `{ error }`（与其它写盘路由同形），**不用** `{ ok:false, reason }`：
          // 客户端对写盘端点已有一条统一的错误链（error → saveError → applyStatus），
          // 多造一种失败形状就得在客户端多写一条分支，而那条分支恰好会绕过
          // 「写盘失败要 applyStatus 回填」的既有纪律。
          if (!r.ok) return json(res, { error: r.reason })
          await persist(exec)
          return json(res, { ok: true, exception: r.exception, index: r.index, status: statusView(exec) })
        }
        if (pathname === '/permgate/remove-exception' && method === 'POST') {
          await init(exec)
          const block = a.target === 'project' ? ensureProject(rootOf(exec)) : config.global
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
          const block = a.target === 'project' ? ensureProject(rootOf(exec)) : config.global
          if (!block.custom) block.custom = []
          // 新规则**插到数组尾部**（后加的排最后）—— 用户定：保持这个顺序，优先级由用户之后
          // 手动调节（面板的 ↑↓ 与拖动排序走 /permgate/reorder，见 decide() 规则循环处的说明）。
          //
          // 已知后果（有意接受）：decide() 首条命中即返回，所以新规则若被前面任何一条命中遮蔽，
          // 就不会生效 —— 直到用户把它调到前面。面板上两条规则看起来一样，这一点不直观，
          // 但「自动插到头部」会让用户失去对顺序的控制权（他会看到自己没动过的顺序变了），
          // 两害相权取其轻：**顺序只由用户改**。
          block.custom.push(rule)
          await persist(exec)
          return json(res, { added: rule, status: statusView(exec) })
        }
        if (pathname === '/permgate/remove-rule' && method === 'POST') {
          await init(exec)
          const block = a.target === 'project' ? ensureProject(rootOf(exec)) : config.global
          const list = block.custom || []
          const idx = list.findIndex((r) => r.id === a.id)
          if (idx === -1) return json(res, { removed: false, reason: '未找到 id=' + a.id })
          const removed = list.splice(idx, 1)[0]
          await persist(exec)
          return json(res, { removed: true, rule: removed, status: statusView(exec) })
        }
        if (pathname === '/permgate/reorder' && method === 'POST') {
          await init(exec)
          const r = reorderEntries(a, rootOf(exec))
          if (!r.ok) return json(res, { error: r.reason })
          await persist(exec)
          return json(res, { reordered: true, list: r.list, from: r.from, to: r.to, status: statusView(exec) })
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
              // 打开配置文件：目标在 home 下，与会话工作区无关，用本请求会话的根即可
              cwd: String(rootOf(exec) || 'C:\\').replace(/\//g, '\\'),
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

    // 工具返回的视图：去掉例外的 note。
    // note 是 ask 例外上的一句说明（「当初为什么特意拦它」），只在弹窗与设置页展示，工具侧不需要。
    //
    // 说明：note 只是一句备注，这里去掉它只是分工——工具侧不需要展示备注，面板侧照旧。
    // 它会不会被 AI 读到、算不算隐私问题——明确不管，直接忽略，不作为议题。
    //
    // 另外返回副本：categories.* 是 config 的引用，就地删会改坏运行中的配置。
    function toolView(view) {
      try {
        if (!view || typeof view !== 'object') return view
        const cats = view.categories
        if (!cats || typeof cats !== 'object') return view
        const cleanBlock = (block) => {
          if (!block || typeof block !== 'object') return block
          const out = Object.assign({}, block)
          for (const key of Object.keys(out)) {
            const cat = out[key]
            if (!cat || typeof cat !== 'object') continue
            if (!Array.isArray(cat.exceptions)) continue
            if (!cat.exceptions.some((r) => r && typeof r === 'object' && 'note' in r)) continue
            out[key] = Object.assign({}, cat, {
              exceptions: cat.exceptions.map((r) => {
                if (!r || typeof r !== 'object' || !('note' in r)) return r
                const e = Object.assign({}, r)
                delete e.note
                return e
              }),
            })
          }
          return out
        }
        return Object.assign({}, view, { categories: { global: cleanBlock(cats.global), project: cleanBlock(cats.project) } })
      } catch (e) {
        // 清洗失败不能让 perm_status 整个报错：退回原视图保证工具仍可用。
        // 但必须留痕 —— 静默退回会让「工具侧不显示备注」这条分工在无感知的情况下失效，
        // 与 tools/pre-execute 等处 catch 必打日志的口径保持一致。
        console.error('[permgate] toolView failed:', e)
        return view
      }
    }

    registerTool({
      name: 'perm_status',
      description: '查看权限网关(permgate)当前生效的分类默认(目录/命令/读取/读取图片/编辑/撤销操作/子代理/重复操作)、例外、快捷工具、自定义规则、最近决策与配置路径。',
      parameters: {},
      output: { schema: { type: 'json' }, render: renderer() },
      async execute(_args, exec) { await init(exec); return toolView(statusView(exec)) },
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
    // 让设置页/权限选择器在选择器切换权限后立即联动。
    ctx.on('session/event', async (session, event) => {
      try {
        if (!event) return
        if (event.type === 'permission/preset' || event.type === 'sandbox/mode' || event.type === 'approval/policy') {
          if (agentRef === null && session) agentRef = { session }
          broadcast({ type: 'status' })
        }
        // 自动同步：用户在设置页/权限选择器切换权限预设（仅「自定义审查」）后，
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
        // 会话键在这里算一次：decide() 内部读计数、下面写计数都用它，避免两处各自从
        // exec 派生（派生逻辑一旦分叉，就会变成「读的是 A 会话、写的是 B 会话」）。
        const sk = loopSessionKey(exec)
        // 审查是否生效：与 decide() 内那一处**同一个函数、同一个 exec**（不是第二份判据），
        // 故不会漂移。这里需要它是因为计数点在 decide() 之外，而计数必须受同一个闸门约束。
        const customReview = sessionPresetName(exec) === 'custom-review'
        const d = decide(exec)
        recordDecision(d, exec)
        // ── 循环检测的计数口径（L-2 / L-11）──────────────────────────────────
        // 只有**真正静默放行并执行了**的调用才推进连续计数；其余一切路径都清零。
        // 为什么清零要在这里先做：`d.action !== 'allow'`（deny / ask）无论后面弹窗结果如何，
        // 都不是「用户没看见的重复」—— 弹窗批准时用户本来就在环里、每次都看到了（提醒是冗余的），
        // 而累积模式会让用户点一次「允许」之后仍被反复提醒，与「用户已表态」的直觉相反。
        // 清零放在这里而不是各 return 之前：那些路径有四条（ask 被拒 / deny / 升级被拒 / 抛错），
        // 逐条写就是四个漏改点，而漏改的方向恰好是「提醒偏多」之外还让计数卡住不清。
        //
        // ★ `!customReview` 也必须清零：非「自定义审查」时 decide() 恒返回 allow（它自己
        //   第一行就早退），于是 `d.action !== 'allow'` 恒不成立、计数只增不减。用户之后把
        //   该会话切到「自定义审查」，第一次相同调用就会命中一个**从未在审查模式下发生过**
        //   的连续次数（默认 ask 下立刻弹窗报出那个虚高的 N，doomloop=deny 时直接中断 AI
        //   且不弹窗）—— 而面板此刻还写着「循环检测不生效」。触发时机取决于审查关闭期间的
        //   调用，用户无从预期。清零（而非仅仅跳过计数）同时抹掉切换前可能残留的桶。
        if (d.action !== 'allow' || !customReview) resetStreak(sk)
        console.log('[permgate]', d.action, exec.name, L(d.reason, uiLang) || '')
        if (d.action === 'ask') {
          const out = await askUser(exec, d)
          // 超时自动结案必须留痕：recordDecision 在审批**之前**执行且只记 d.action === 'ask'，
          // 若此处不补记，事后无法区分「人工批准」与「超时自动放行」——尤其 onTimeout === 'allow'
          // 是一条无人在环的放行路径，审计缺失会让它彻底不可追溯。
          // 走 recordDecision 单点（不自行 push+splice）：截断口径与字段形状只有一份实现，
          // 否则日后改 MAX_DECISIONS 或给记录增补字段时，这里会静默按旧语义走。
          if (out.timedOut) {
            recordDecision({ action: out.kind === 'allow' ? 'timeout-allow' : 'timeout-deny', ruleId: null, reason: out.reason || '' }, exec)
            console.warn('[permgate] approval timed out ->', out.kind, exec.name)
          }
          if (out.kind !== 'allow') return { kind: 'deny', reason: out.reason || (uiLang === 'en' ? 'User denied' : '用户拒绝') }
        } else if (d.action === 'deny') {
          // 判定直接拒绝（没有弹窗）时，AI 拿到的就是这条 —— 它是 AI 唯一的线索，
          // 故带上段摘要（「哪一段、命中哪一档」）。与决策日志同一份 segmentSummary，
          // 不是两处各拼一次：口径分叉时「AI 收到的理由」与「日志记的理由」会不一致，
          // 而两者本该回答同一个问题。
          return { kind: 'deny', reason: L(segmentSummary(d), uiLang) }
        }
        // 放行（或询问允许）后：写类工具 + 工作区外 + 沙箱受限 → 原生升级审批 → 临时放开
        flushStaleUpgrades()
        if (needsUpgrade(exec)) {
          const ok = await requireSandboxUpgrade(exec)
          // 升级被拒 = 本次调用最终未执行 → 不计数，且清零（与上面同口径）
          if (!ok) { resetStreak(sk); return { kind: 'deny', reason: uiLang === 'en' ? 'Sandbox upgrade denied (write outside workspace)' : '沙箱升级被拒绝（工作区外写入）' } }
        }
        // 计数点必须在**所有拦截之后**：`d.action === 'allow'` 只是「判定放行」，
        // 上面的沙箱升级闸仍可能拦下它。放在这里才真正等价于「静默放行且执行了」。
        // `perm_*` 的排除保持现状：权限查询工具反复调用不代表卡死，不是循环。
        // `customReview` 是**硬前提**：非该模式下 decide() 恒 allow，若不挡就会攒出一个
        // 审查模式下从未发生过的连续次数（理由见上方清零处）。与清零用同一个变量，
        // 保证「跳过计数」与「清零」两个方向不会各自漂移。
        if (customReview && d.action === 'allow' && (typeof exec.name !== 'string' || exec.name.indexOf('perm_') !== 0)) {
          noteLoopCall(sk, exec.name, exec.arguments)
        }
        return next()
      } catch (e) {
        console.error('[permgate] pre-execute error:', e)
        // 抛错 = 本次调用被拒绝（见下）→ 不计数。这里**不清零**：异常可能来自与本调用无关的宿主故障，
        // 拿它清掉用户的连续计数会让「提醒」被无关故障吞掉；而计数本身不会因异常前进，
        // 方向安全（最坏是少一次清零，不是放宽权限）。
        //
        // ★ 异常必须 fail-safe：这里**不得 next()**。
        // next() 是宿主 waterfall 的内层兜底回调，它返回 { kind: 'allow' }（放行）——
        // 于是「permgate 自己崩了」会变成一次**静默放行**：弹窗不出现、用户与 AI 都看不见，
        // 与「工具本来就不需要审批」在外部完全不可区分（实测：rm -rf build 被直接放行）。
        // 宿主自己那层 try/catch 本是 fail-safe（catch → final-result 报错），但它在
        // waterfall **之外** —— 本函数只要调了 next()，就抢先把它转成了 fail-open。
        // 故此处显式返回 deny：拿不准就拒绝，AI 收到这条理由、用户可重新发起。
        return { kind: 'deny', reason: uiLang === 'en' ? 'permgate internal error; call denied' : 'permgate 内部错误，已拒绝本次调用' }
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
