#!/usr/bin/env node
// shell-parse.js 的单元测试：分解器 + 段级判定。
// 用法：node test/shell-parse.mjs
//
// 分组（对应计划 §6.1 的对抗性用例表）：
//   A 操作符穿透（当前全部静默放行）
//   B 重定向（只标注，不拦 —— D-8）
//   C 命令替换 / 嵌套（code: 'unparsable'，动作落回分类默认值）
//   D 引号感知（不得误切）
//   E 解析失败（落回 command 分类默认值）
//   F 破坏性命令（落 destructive 子设置）
//   G 误报回归（必须仍然免审 —— 修好 D3）
//   H 正常免审（不得过度收紧）
//   I 部分覆盖（不得整条放行）
//   J 子设置可配置性
//
// 断言风格：绝大多数用例断言 verdict !== 'allow'（「绝不静默放行」），而不是断言
// 具体是 ask 还是 deny —— 具体落点由配置决定，测试不该把某个默认值钉死成语义。
import { fileURLToPath } from 'node:url'
import { join as pathJoin, resolve as pathResolve } from 'node:path'
import { readFileSync } from 'node:fs'
import {
  decomposeCommand, segmentLabel, isDestructiveLabel, isDestructiveSegment, canCarryDestructivePayload,
  isPayloadCarrierLabel, assessCommand, matchCommand,
  expandTilde, globRootOf, unwrapWords, flagEmbeddedPath, looksLikeExplicitPath,
  tildeUserTarget, isNullSink, DESTRUCTIVE_LABELS, SHELL_OF_TOOL, WIN_SLASH_SWITCH_CMDS,
  blastRadiusOf, blastRadiusOfSegment, blastRadiusOfCommandPattern, BLAST_ORDER,
  rawCommandNames,
  // 八档体系（blast-tier-plan.md）
  GROUP_MEMBERS, GROUP_OF_LABEL, BARE_INTERACTIVE, NON_PATH_ARG,
  PRIV_PREFIXES, PURE_RADIUS_GROUPS,
  segmentLabels, segmentPrivilege, radiusTierOf, groupTiersOf, tierSetOf,
  // `widened ⊆ labels` 不变量的观测点（见 54D 判据④）：两个集合由它单点产出
  segmentLabelsCore,
  strictestTierAction, decisiveTierOf, tierLabel, TIERS, TIER_ORDER,
  // 语句关键字全表（54p 按**全表**穷举，不抽样 —— 新增关键字时漏改会立刻红灯）
  STATEMENT_KEYWORDS,
} from '../shell-parse.js'

const ROOT = pathResolve(pathJoin(fileURLToPath(import.meta.url), '..', '..'))
const fail = []
const ok = (name, cond, extra) => { if (!cond) fail.push(name + (extra ? ' — ' + extra : '')) }
const group = (t) => console.log('\n— ' + t)

const HOME = 'C:/Users/me'
const WS = 'X:/ws'

// ── 性能断言的**单点计时器**（本文件 9 处倍率断言共用）────────────────────────────
//
// 为什么必须单点：这 9 处（54m / 54m2 / 54v / 54w / 54A / 54B / 54C…）此前各自手写
// 「预热一次 + 循环 3 次取 min」，而**取样 3 次太少**是它们共同的假红来源：
// 实测 `su (/reg --config)*n` 的比值分布（40 轮）——
//   k=3  → p95=1.82、max=**3.00**（恰好越过 3.0 阈值，实测红过）
//   k=7  → p95=1.26、max=1.29（0/40 越界）
//   k=15 → p95=1.21、max=1.22
// 真实倍率约 1.18（线性，正确），k=3 时的越界纯粹是单次 GC/调度抖动被 `Math.min`
// 漏掉 —— 3 次里只要有一次被抖动打中，min 就救不回来，而分母 s4000 只有 ~0.009 ms，
// 抖动的**绝对**幅度虽小（p90 是 min 的 4 倍），落到比值上却是成倍的。
//
// 取 k=7：分布已收敛（max 1.29，离阈值 3.0 有 2.3 倍余量），而总耗时只增加 4 次调用
// （每次 ~0.01–0.09 ms，可忽略）。**不取更大**是因为 k≥15 的收敛收益已趋平（1.21 vs 1.26），
// 没有必要为噪声多付一倍时间。
//
// `fn` 由调用方传闭包（各自构造词元数组），故这里不做记忆化 —— 记忆化会让
// 「构造开销」被排除在外，而某些断言恰恰要测构造后的整体耗时。
const PERF_SAMPLES = 7
function timeBest(fn) {
  fn()   // 预热（JIT）
  let best = Infinity
  for (let k = 0; k < PERF_SAMPLES; k += 1) {
    const t0 = process.hrtime.bigint()
    fn()
    const dt = Number(process.hrtime.bigint() - t0) / 1e6
    if (dt < best) best = dt
  }
  return best
}

// ── 判定钩子：模拟真实配置 ────────────────────────────────────────────────────
// 默认形态：用户配了 23 条 allow 例外（全是命令前缀 + ` *`），command 分类默认 ask，
// destructive 子设置默认 ask。这与用户当前真实配置同形。
function hooks(opts) {
  const o = opts || {}
  const exc = o.exceptions || [
    'git status *', 'git log *', 'git diff *', 'git commit -m *',
    'Get-ChildItem *', 'Get-Process *', 'Copy-Item *', 'cd *',
    'node --check *', 'npm run format *', 'docker ps *', 'grep *',
  ]
  return {
    home: HOME,
    // userHome 与 platform 与宿主同契约（index.js 的 assessCommand 调用点传这两个）：
    //   · userHome —— `~` 的展开落点 = 用户家目录，不是 DSH home（HOME 在本文件里
    //     代表家目录，与生产传 DSH home 不同，故必须显式给 userHome 才与生产同义）。
    //   · platform —— 决定查哪一套系统目录名单、`/x` 是不是 cmd 开关。
    //     不传会让判档落到「平台未知」的 fail-safe 分支，测的就不是宿主走的那条路径。
    userHome: o.userHome || HOME,
    platform: o.platform || 'win32',
    matchException: (segText, label) => {
      // 两个匹配对象都试：段原文（用户手写例外）与归一化 label（弹窗候选写下的例外），
      // 与宿主 index.js 的 matchException 同构（先原文、未命中再 label）。
      for (const pat of exc) {
        if (matchCommand(pat, segText) || (label && matchCommand(pat, label))) {
          // excActions：按模式指定动作（{ 'echo *': 'allow', 'rm *': 'deny' }），
          // 用于验证「不同例外不同动作」的优先级场景；未提供时统一走 excAction。
          const action = (o.excActions && o.excActions[pat]) || o.excAction || 'allow'
          return { action, ruleId: 'e1', reason: o.excReason, note: o.excNote }
        }
      }
      return null
    },
    destructive: () => ({ action: o.destructive || 'ask', reason: o.destructiveReason || null }),
    category: () => ({ action: o.category || 'ask', reason: o.categoryReason || null }),
    isOutsideWorkspace: (p) => {
      // 钩子收到的是**可能相对的**目标（模块不做路径解析，那是宿主的 normAbsPath 的职责）。
      // 这里模拟宿主：相对路径按工作区根绝对化，再判内外。
      const raw = String(p).replace(/\\/g, '/')
      const abs = (raw.startsWith('/') || /^[a-zA-Z]:/.test(raw)) ? raw : WS + '/' + raw
      const s = abs.toLowerCase()
      return !(s === WS.toLowerCase() || s.startsWith(WS.toLowerCase() + '/'))
    },
  }
}
const run = (cmd, shell, opts) => assessCommand(cmd, shell || 'bash', hooks(opts))
// 整行绝不静默放行
const neverAllow = (label, cmd, shell, opts) => {
  const r = run(cmd, shell, opts)
  ok(label + ' 【' + cmd.replace(/\n/g, '\\n') + '】', r.action !== 'allow', 'action=' + r.action + ' code=' + r.code)
  return r
}

// ── 「藏命令的构造」方言矩阵（**单一来源**，AA / AB / AC 三组共用）────────────────────
//
// ⚠️ **反引号不是 pwsh 的命令替换定界符** —— 它是 pwsh 的**转义符**。AA / AB / AC 三组
// 此前都把 `BT + c + BT` 当成「四种构造」之一去测**全部四个** (shell, platform) 组合，
// 于是对 pwsh 断言「`` `rm -rf X `` 必须 deny」—— 而实测那条命令**根本不执行 rm**：
//
//   官方解析器 + 实际执行（PowerShell 5.1，逐条跑过）：
//     `` `rm -rf X ``                        → 词元 `<CR>m`（`` `r `` = CR 转义）→ 命令不存在，**不执行 rm**
//     `` `kill 1234 ``                       → 词元 `kill`（`` `k `` 未知转义 = 字面 k）→ **会执行 kill**
//     `` `Remove-Item -Recurse -Force X ``   → 词元 `Remove-Item`（`` `R `` 未知转义）→ **会执行**
//     反引号在 bash 里同样写法               → **真命令替换**，`rm` 会执行
//
// 即「反引号能藏命令」这条性质**只对 bash 成立**：pwsh 侧藏命令的是
// `$( )` / `( )` / `{ }` / `@( )`（四种实测**全部** deny 且三档齐全），
// 而反引号在 pwsh 侧的真危险形态是**未知转义**那一族 —— 名字被保留、真会执行，
// 且只在**命令位**成立（`Write-Output `` `Remove-Item `` 只是把它当参数打印，不执行）。
// 那一族由 AA 组 ② 尾单独钉住。
//
// 拿 bash 的构造集去测 pwsh，得到的红是**假红**（断言了一条不存在的执行语义），
// 不是解析器缺陷 —— 这正是本矩阵存在的理由。与 Z2 组「尾部 `&` 按方言分列」同法。
const BT = String.fromCharCode(96)
const OPAQUE_FORMS = {
  bash: [['$( )', (c) => '$(' + c + ')'], ['( )', (c) => '(' + c + ')'],
    ['{ }', (c) => '{ ' + c + '; }'], ['反引号', (c) => BT + c + BT]],
  pwsh: [['$( )', (c) => '$(' + c + ')'], ['( )', (c) => '(' + c + ')'],
    ['{ }', (c) => '{ ' + c + '; }'], ['@( )', (c) => '@(' + c + ')']],
}
// pwsh 侧「反引号 + **未知**转义」= 反引号被丢掉、真命令名被保留 —— 真会执行的那一族。
// 已知转义（`n `r `t `0 `a `b `e `f `v）产出控制字符，命令名被改坏、不执行（实测）。
const PWSH_ESCAPED_NAMES = [BT + 'Remove-Item -Recurse -Force C:/Windows', BT + 'kill 1234']
// 分隔符语料（AA / AB / AC 三组同值，故单点定义）：覆盖「构造独立成段」与「构造挂在
// 分隔符之后」两族 —— 后者是「藏起来的命令被当成下一段」的漏网形态。
const SEPS = ['', 'echo a | ', 'echo a && ', 'echo a || ', 'echo a & ', 'echo a ; ', 'echo a\n']

// ═════════════════════════════════════════════════════════════════════════════
group('0. 分解器基础：段 / 词元 / 重定向 / opaque')
{
  const d1 = decomposeCommand('git status', 'bash')
  ok('0.1 单段分解', d1.ok && d1.segments.length === 1 && d1.segments[0].words.length === 2, JSON.stringify(d1))
  ok('0.2 首段 op 为 start', d1.ok && d1.segments[0].op === 'start')

  const d2 = decomposeCommand('git status && rm -rf x', 'bash')
  ok('0.3 && 分段', d2.ok && d2.segments.length === 2, JSON.stringify(d2.ok ? d2.segments.map((s) => s.text) : d2))
  ok('0.4 第二段记录 op=&&', d2.ok && d2.segments[1].op === '&&')

  const d3 = decomposeCommand('a ; b | c || d & e', 'bash')
  ok('0.5 五种操作符都分段', d3.ok && d3.segments.length === 5, d3.ok ? JSON.stringify(d3.segments.map((s) => s.op)) : JSON.stringify(d3))

  const d4 = decomposeCommand('git status\nrm -rf x', 'bash')
  ok('0.6 换行分段', d4.ok && d4.segments.length === 2 && d4.segments[1].op === 'newline', d4.ok ? JSON.stringify(d4.segments.map((s) => s.text)) : JSON.stringify(d4))

  const d5 = decomposeCommand('git status\r\nrm -rf x', 'bash')
  ok('0.7 CRLF 只算一次分段', d5.ok && d5.segments.length === 2, d5.ok ? JSON.stringify(d5.segments.map((s) => s.text)) : JSON.stringify(d5))

  const d6 = decomposeCommand('echo hi > out.txt', 'bash')
  ok('0.8 > 记入 writeTargets 且不单独成段', d6.ok && d6.segments.length === 1 && d6.segments[0].writeTargets[0] === 'out.txt', JSON.stringify(d6.ok ? d6.segments : d6))

  const d7 = decomposeCommand('echo hi >> out.txt', 'bash')
  ok('0.9 >> 记入 writeTargets', d7.ok && d7.segments[0].writeTargets[0] === 'out.txt')

  const d8 = decomposeCommand('cat < in.txt', 'bash')
  ok('0.10 < 记入 readTargets', d8.ok && d8.segments[0].readTargets[0] === 'in.txt')

  const d9 = decomposeCommand('cmd 2> err.txt', 'bash')
  ok('0.11 2> 的 fd 号不进词元', d9.ok && d9.segments[0].writeTargets[0] === 'err.txt' && d9.segments[0].words.join(' ') === 'cmd', JSON.stringify(d9.ok ? d9.segments[0] : d9))

  const d10 = decomposeCommand('cmd 2>&1', 'bash')
  ok('0.12 2>&1 是描述符复制，不是写目标', d10.ok && d10.segments[0].writeTargets.length === 0, JSON.stringify(d10.ok ? d10.segments[0] : d10))

  const d11 = decomposeCommand('cmd &> out.txt', 'bash')
  ok('0.13 &> 是合并重定向，不是后台执行', d11.ok && d11.segments.length === 1 && d11.segments[0].writeTargets[0] === 'out.txt', JSON.stringify(d11.ok ? d11.segments : d11))

  const d12 = decomposeCommand('git status |', 'bash')
  ok('0.14 悬空管道 → ok:false（段边界不可信）', d12.ok === false, JSON.stringify(d12))

  const d13 = decomposeCommand('git status "unclosed', 'bash')
  ok('0.15 未闭合引号 → ok:false', d13.ok === false, JSON.stringify(d13))

  const d14 = decomposeCommand('echo x >', 'bash')
  ok('0.16 重定向无目标 → ok:false', d14.ok === false, JSON.stringify(d14))

  const d15 = decomposeCommand('   ', 'bash')
  ok('0.17 空命令 → ok:false', d15.ok === false, JSON.stringify(d15))

  const d16 = decomposeCommand('echo a;', 'bash')
  ok('0.18 尾随分号是合法 shell 语法，不算悬空', d16.ok === true && d16.segments.length === 1, JSON.stringify(d16))

  const d17 = decomposeCommand('git status $(rm -rf x)', 'bash')
  ok('0.19 $(...) 段级 opaque（段边界仍确定）', d17.ok && d17.segments.length === 1 && !!d17.segments[0].opaque, JSON.stringify(d17.ok ? d17.segments[0] : d17))

  const d18 = decomposeCommand('git status `rm -rf x`', 'bash')
  ok('0.20 反引号段级 opaque', d18.ok && !!d18.segments[0].opaque)

  const d19 = decomposeCommand('(git status)', 'bash')
  ok('0.21 括号分组段级 opaque', d19.ok && !!d19.segments[0].opaque, JSON.stringify(d19.ok ? d19.segments[0] : d19))

  const d20 = decomposeCommand('git status # comment', 'bash')
  ok('0.22 词首 # 起注释', d20.ok && d20.segments[0].words.length === 2 && d20.segments[0].text === 'git status', JSON.stringify(d20.ok ? d20.segments[0] : d20))

  const d21 = decomposeCommand('echo a#b', 'bash')
  ok('0.23 词中 # 不是注释', d21.ok && d21.segments[0].words[1] === 'a#b', JSON.stringify(d21.ok ? d21.segments[0] : d21))
  const d22 = decomposeCommand('git status\n&& rm -rf x', 'bash')
  ok('0.24 换行后接 && 仍分两段', d22.ok && d22.segments.length === 2, JSON.stringify(d22.ok ? d22.segments.map((s) => s.op + ':' + s.text) : d22))

  // 引号感知：段全文保留原样引号（例外匹配的对象），词元已剥引号
  const d23 = decomposeCommand('git commit -m "fix: a; b"', 'bash')
  ok('0.25 引号内的 ; 不分段', d23.ok && d23.segments.length === 1, JSON.stringify(d23.ok ? d23.segments.map((s) => s.text) : d23))
  ok('0.26 段全文保留引号', d23.ok && d23.segments[0].text === 'git commit -m "fix: a; b"', d23.ok ? d23.segments[0].text : '')
  ok('0.27 词元已剥引号', d23.ok && d23.segments[0].words[3] === 'fix: a; b', d23.ok ? JSON.stringify(d23.segments[0].words) : '')

  const d24 = decomposeCommand("echo 'x && y'", 'bash')
  ok('0.28 单引号内的 && 不分段', d24.ok && d24.segments.length === 1, JSON.stringify(d24.ok ? d24.segments.map((s) => s.text) : d24))

  const d25 = decomposeCommand('echo "a > b"', 'bash')
  ok('0.29 引号内的 > 不是重定向', d25.ok && d25.segments[0].writeTargets.length === 0, JSON.stringify(d25.ok ? d25.segments[0] : d25))

  const d26 = decomposeCommand('git log --grep="a|b"', 'bash')
  ok('0.30 引号内的 | 不分段', d26.ok && d26.segments.length === 1, JSON.stringify(d26.ok ? d26.segments.map((s) => s.text) : d26))

  // 空白归一化：例外匹配用段全文，排版差异不该影响匹配
  const d27 = decomposeCommand('git   status', 'bash')
  ok('0.31 引号外多空格归一为单空格', d27.ok && d27.segments[0].text === 'git status', d27.ok ? d27.segments[0].text : '')

  const d28 = decomposeCommand('printf x >\n~/.ssh/keys', 'bash')
  ok('0.32 重定向目标可跨换行', d28.ok && d28.segments[0].writeTargets[0] === '~/.ssh/keys', JSON.stringify(d28.ok ? d28.segments : d28))

  // 变量：只标记不求值
  const d29 = decomposeCommand('echo $HOME', 'bash')
  ok('0.33 变量展开标记 dynamic', d29.ok && d29.segments[0].dynamic === true && d29.segments[0].opaque === null, JSON.stringify(d29.ok ? d29.segments[0] : d29))

  const d30 = decomposeCommand('echo $env:USERPROFILE', 'pwsh')
  ok('0.34 pwsh $env:VAR 可解析', d30.ok && d30.segments[0].dynamic === true && !d30.segments[0].opaque, JSON.stringify(d30.ok ? d30.segments[0] : d30))

  const d31 = decomposeCommand('echo %USERPROFILE%', 'pwsh')
  ok('0.35 pwsh %VAR% 可解析（不再判 opaque）', d31.ok && d31.segments[0].dynamic === true && !d31.segments[0].opaque, JSON.stringify(d31.ok ? d31.segments[0] : d31))

  // heredoc：正文在后续行，段边界不可信 → 整行读不懂（正文里可以出现任何东西，
  // 包括看起来像命令的行；把它切成段就等于把数据当命令判）
  const d32 = decomposeCommand('cat <<EOF\nrm -rf x\nEOF', 'bash')
  ok('0.36 heredoc 整行判读不懂（不把正文当命令）', d32.ok === false, JSON.stringify(d32))

  // find -exec 的 {} 是字面量占位符
  const d33 = decomposeCommand('find . -name x -exec rm {} \\;', 'bash')
  ok('0.37 find -exec 的 {} 不算花括号展开', d33.ok && !d33.segments[0].opaque, JSON.stringify(d33.ok ? d33.segments[0] : d33))
}

// ═════════════════════════════════════════════════════════════════════════════
group('A. 操作符穿透（当前全部静默放行 —— 核心漏洞）')
{
  neverAllow('A1 && 穿透', 'git status && rm -rf ~/.dsh')
  neverAllow('A2 ; 穿透', 'git status ; rm -rf ~/.dsh')
  neverAllow('A3 | 穿透', 'git status | rm -rf ~/.dsh')
  neverAllow('A4 || 穿透', 'git status || rm -rf ~/.dsh')
  neverAllow('A5 & 穿透', 'git status & rm -rf ~/.dsh')
  neverAllow('A6 换行穿透', 'git status\nrm -rf ~/.dsh')
  neverAllow('A7 CRLF 穿透', 'git status\r\nrm -rf ~/.dsh')
  neverAllow('A8 换行 + && 穿透', 'git status\n&& rm -rf ~/.dsh')
  neverAllow('A9 cd 前缀穿透', 'cd /tmp && rm -rf ~/.dsh')
  neverAllow('A10 Get-Content 前缀穿透', 'Get-Content a && rm -rf ~/.dsh')
  neverAllow('A11 Copy-Item 前缀穿透', 'Copy-Item a b && rm -rf ~/.dsh')
  // 只加了 && 到分段器是不够的：; 与 | 本来就被分段却照样放行 —— 这三条是根因的判据
  neverAllow('A12 分号前无空格（旧实现碰巧拦住）', 'git status; rm -rf ~/.dsh')
  neverAllow('A13 管道两侧无空格', 'git status|rm -rf ~/.dsh')

  // 关键：`git status *` 的 `.*` 再也吞不到别的段
  const a = run('git status && rm -rf ~/.dsh')
  ok('A14 第二段（rm）不是 allow，而是落 destructive 子设置', a.action === 'ask', 'action=' + a.action)
  ok('A15 第二段 code 标为 destructive', a.segments[1].code === 'destructive', JSON.stringify(a.segments[1]))
  ok('A16 第一段仍是 allow（例外只授权它自己那一段）', a.segments[0].action === 'allow', JSON.stringify(a.segments[0]))
  ok('A17 合并 code 为 segment-ask', a.code === 'segment-ask', a.code)

  // 反面：单段仍然免审（不得过度收紧）
  const a2 = run('git status')
  ok('A18 单段 git status 仍走 allow 例外', a2.action === 'allow' && a2.code === 'all-allow', 'action=' + a2.action + ' code=' + a2.code)
}

// ═════════════════════════════════════════════════════════════════════════════
group('B. 重定向（只标注，不拦 —— D-8）')
{
  const b1 = run('git status > ~/.dsh/AGENTS.md')
  ok('B1 命中例外即放行（已知且接受）', b1.action === 'allow', 'action=' + b1.action)
  ok('B2 但 code 标出 write-outside', b1.segments[0].code === 'write-outside', JSON.stringify(b1.segments[0]))
  const b2 = run('git status >> ~/.dsh/AGENTS.md')
  ok('B3 >> 同样标注', b2.action === 'allow' && b2.segments[0].code === 'write-outside')
  const b3 = run('git status 2> ~/.dsh/AGENTS.md')
  ok('B4 2> 同样标注', b3.action === 'allow' && b3.segments[0].code === 'write-outside')
  const b4 = run('git status > out.txt')
  ok('B5 工作区内目标不标注', b4.action === 'allow' && b4.segments[0].code === null, JSON.stringify(b4.segments[0]))
  const b5 = run('git status > /dev/null')
  ok('B6 /dev/null 不算写目标（否则日常命令全部误报）', b5.segments[0].code === null, JSON.stringify(b5.segments[0]))
  const b6 = run('git status > $null', 'pwsh')
  ok('B7 pwsh $null 不算写目标', b6.segments[0].code === null, JSON.stringify(b6.segments[0]))
  const b7 = run('echo "a > b"')
  ok('B8 引号内的 > 不产生 writeTargets', b7.segments[0].code === null, JSON.stringify(b7.segments[0]))
  // 未命中例外的重定向命令仍要按分类走
  neverAllow('B9 未命中例外的重定向命令不静默放行', 'unknown-cmd > ~/.dsh/x')
  const b8 = run('git status > /*')
  ok('B10 `> /*` 归约到根再判（globRootOf）', b8.segments[0].code === 'write-outside', JSON.stringify(b8.segments[0]))
}

// ═════════════════════════════════════════════════════════════════════════════
group('C. 命令替换 / 嵌套（code unparsable，动作落回分类默认值）')
{
  const c1 = neverAllow('C1 $(...)', 'git status $(rm -rf ~/.dsh)')
  // 该段的 code 是 **destructive** 而不是 unparsable：段首 `git status` 可读，
  // 但 opaque 构造里藏着 `rm`（opaque 段会用 rawCommandNames 从原文并集提取名字）。
  // 两者同时成立时报 destructive —— 那是用户更需要看到的信息，也是该段实际走子设置的原因。
  ok('C2 $(...) 段 code=destructive（opaque 里藏着破坏性命令）', c1.segments[0].code === 'destructive', JSON.stringify(c1.segments[0]))
  ok('C3 $(...) 段走 destructive 子设置（不是被 allow 例外授权）', c1.segments[0].source === 'destructive' && c1.segments[0].action === 'ask', JSON.stringify(c1.segments[0]))
  // 对照：opaque 里没有破坏性命令时，该段仍落分类默认值、code 为 unparsable
  const c1b = run('git status $(date)', 'bash', { category: 'ask' })
  ok('C3b opaque 里无破坏性命令时 code=unparsable、落分类默认值',
    c1b.segments[0].code === 'unparsable' && c1b.segments[0].source === 'category', JSON.stringify(c1b.segments[0]))
  neverAllow('C4 反引号', 'git status `rm -rf ~/.dsh`')
  neverAllow('C5 引号内 $(...)', 'git status "$(rm -rf ~/.dsh)"')
  neverAllow('C6 sh -c', 'sh -c "rm -rf ~/.dsh"')
  neverAllow('C7 bash -c', "bash -c 'rm -rf ~/.dsh'")
  neverAllow('C8 pwsh -Command', 'pwsh -Command "Remove-Item ~/.dsh -Recurse"')
  neverAllow('C9 cmd /c', 'cmd /c "del /f /s /q %USERPROFILE%\\.dsh"', 'pwsh')
  neverAllow('C10 node -e', 'node -e "require(\'fs\').rmSync(process.env.HOME+\'/.dsh\',{recursive:true})"')
  neverAllow('C11 python -c', 'python -c "import shutil;shutil.rmtree(\'/tmp/x\')"')
  neverAllow('C12 eval', 'eval "rm -rf x"')

  // 嵌套解释器但不带内联程序：是可读的常规调用，不该被判 unparsable
  const c2 = run('node --check x.js')
  ok('C13 node --check 不算嵌套内联程序（配了例外即免审）', c2.action === 'allow' && c2.segments[0].code === null, JSON.stringify(c2.segments[0]))
  const c3 = run('python script.py')
  ok('C14 python script.py 不算内联程序', c3.segments[0].code !== 'unparsable', JSON.stringify(c3.segments[0]))

  // 读不懂的内容不可被授权：这是 fail-closed 的底线
  const c4 = run('git status $(rm -rf ~/.dsh)', 'bash', { exceptions: ['git status *'] })
  ok('★ C15 读不懂的段跳过例外面（读不懂的内容不可被授权）', c4.action !== 'allow', 'action=' + c4.action)
}

// ═════════════════════════════════════════════════════════════════════════════
group('D. 引号感知（不得误切）')
{
  const d1 = run('git log --format="%h %s"')
  ok('D1 git log --format="%h %s" 单段', d1.segments.length === 1, JSON.stringify(d1.segments.map((s) => s.text)))
  const d2 = run('git log --grep="a|b"')
  ok('D2 引号内的 | 不切段', d2.segments.length === 1)
  const d3 = run('echo "a;b"')
  ok('D3 引号内的 ; 不切段', d3.segments.length === 1)
  const d4 = run("echo 'x && y'")
  ok('D4 单引号内的 && 不切段', d4.segments.length === 1)
  const d5 = run('git commit -m "fix: a; b"')
  ok('D5 提交消息里的 ; 不切段', d5.segments.length === 1)
  const d6 = run('echo "B:\\\\path\\\\to"', 'pwsh')
  ok('D6 引号内的 Windows 路径不误切', d6.segments.length === 1, JSON.stringify(d6.segments.map((s) => s.text)))
  // bash 转义：未加引号的盘符路径
  const d7 = decomposeCommand('cat C:\\Users\\u\\.ssh\\id_rsa', 'bash')
  ok('D7 bash 吃掉 \\ 后仍能靠 RAW_ABSOLUTE_PATH 找回路径', d7.ok === true)
}

// ═════════════════════════════════════════════════════════════════════════════
group('E. 解析失败（落回 command 分类默认值）')
{
  const e1 = run('git status "unclosed')
  ok('E1 未闭合引号 → 动作 = 分类默认值', e1.action === 'ask' && e1.code === 'unparsable', 'action=' + e1.action + ' code=' + e1.code)
  const e2 = run('git status |')
  ok('E2 悬空管道 → 动作 = 分类默认值', e2.action === 'ask' && e2.code === 'unparsable', 'action=' + e2.action + ' code=' + e2.code)
  const e3 = run('(git status)')
  ok('E3 分组 → 段级 unparsable，动作 = 分类默认值', e3.action === 'ask' && e3.segments[0].code === 'unparsable', JSON.stringify({ a: e3.action, c: e3.segments[0].code }))
  const e4 = run('{ git status; }')
  ok('E4 花括号分组 → unparsable', e4.action === 'ask' && e4.segments[0].code === 'unparsable', JSON.stringify({ a: e4.action, s: e4.segments.map((s) => s.code) }))
  // 分类默认值设为 allow 时，读不懂的段跟着 allow（听大分类的，不是听某个独立子设置）
  const e5 = run('(git status)', 'bash', { category: 'allow' })
  ok('E5 分类默认 allow 时，unparsable 段也 allow（无独立子设置 —— D-4）', e5.action === 'allow', 'action=' + e5.action)
  const e6 = run('git status |', 'bash', { category: 'deny' })
  ok('E6 分类默认 deny 时，整行不可解析也 deny', e6.action === 'deny', 'action=' + e6.action)
}

// ═════════════════════════════════════════════════════════════════════════════
group('F. 破坏性命令（落 destructive 子设置）')
{
  const cases = [
    ['F1 rm -rf', 'rm -rf ~/.dsh', 'bash', 'rm'],
    ['F2 路径形态 rm.exe', 'C:\\Windows\\System32\\rm.exe -rf x', 'pwsh', 'rm'],
    ['F3 POSIX 路径 rm', '/usr/bin/rm -rf x', 'bash', 'rm'],
    ['F4 相对路径 rm', './rm -rf x', 'bash', 'rm'],
    ['F5 Remove-Item', 'Remove-Item -Recurse -Force B:\\x', 'pwsh', 'remove-item'],
    ['F6 dd', 'dd if=/dev/zero of=/dev/sda', 'bash', 'dd'],
    ['F7 sudo 前缀', 'sudo rm -rf /x', 'bash', 'sudo'],
    ['F8 chmod', 'chmod 777 /etc/passwd', 'bash', 'chmod'],
    ['F9 chown', 'chown root /etc/passwd', 'bash', 'chown'],
    ['F10 taskkill', 'taskkill /f /im x.exe', 'pwsh', 'taskkill'],
    ['F11 env wrapper', 'env -u FOO rm -rf /x', 'bash', 'rm'],
    ['F12 timeout wrapper', 'timeout -s KILL 5 sudo ls', 'bash', 'sudo'],
    ['F13 前导 NAME=value', 'BLAH=0 rm -rf /x', 'bash', 'rm'],
    ['F14 空值前导赋值', 'FOO= sudo ls', 'bash', 'sudo'],
    ['F15 kill', 'kill -9 1234', 'bash', 'kill'],
    ['F16 shutdown', 'shutdown /s /t 0', 'pwsh', 'shutdown'],
    ['F17 format', 'format D:', 'pwsh', 'format'],
    ['F18 reg delete', 'reg delete HKLM\\Software\\X /f', 'pwsh', 'reg delete'],
    ['F19 icacls', 'icacls B:\\x /grant everyone:F', 'pwsh', 'icacls'],
    ['F20 takeown', 'takeown /f B:\\x /r', 'pwsh', 'takeown'],
  ]
  for (const [label, cmd, shell, wantLabel] of cases) {
    const r = run(cmd, shell)
    ok(label + ' 【' + cmd + '】label = ' + wantLabel, r.segments[0].label === wantLabel, 'got=' + r.segments[0].label)
    ok(label + ' code = destructive', r.segments[0].code === 'destructive', JSON.stringify(r.segments[0]))
    ok(label + ' 落 destructive 子设置（source=destructive）', r.segments[0].source === 'destructive', JSON.stringify(r.segments[0]))
  }

  // ★ 核心：command 大分类 = allow 时，破坏性命令仍按子设置走（修好 DANGEROUS_CMD_RE 的失效）
  for (const [label, cmd, shell] of [['F21 Remove-Item', 'Remove-Item -Recurse -Force B:\\x', 'pwsh'], ['F22 taskkill', 'taskkill /f /im x.exe', 'pwsh'], ['F23 icacls', 'icacls B:\\x /grant everyone:F', 'pwsh'], ['F24 rm', 'rm -rf x', 'bash']]) {
    const r = run(cmd, shell, { category: 'allow' })
    ok('★ ' + label + '：大分类 allow 时破坏性命令仍不静默放行（D-6 核心修复）', r.action !== 'allow', 'action=' + r.action)
  }
  // 反面：大分类 allow 时普通命令确实放行（大分类仍生效）
  const f25 = run('some-unknown-tool --flag', 'bash', { category: 'allow' })
  ok('F25 大分类 allow 时普通命令放行（大分类仍生效）', f25.action === 'allow', 'action=' + f25.action)

  // 项目层 inherit 穿透：destructive 无值时 → 整段无判定 → inherit（调用方落兜底）
  const f26 = run('rm -rf x', 'bash', { category: 'inherit', destructive: 'inherit' })
  ok('F26 子设置与分类都 inherit → 整行 inherit（由调用方落兜底）', f26.action === 'inherit' && f26.code === 'all-inherit', 'action=' + f26.action + ' code=' + f26.code)

  // ★★ F27–F31：**opaque 构造不得关掉破坏性判定**
  // 曾经的写法 `!unparsable && isDestructiveLabel(label)` 让段内任意读不懂的构造
  // （`$()`、反引号、`( )`/`{ }` 分组、`{a,b}` 展开）把已认出的段首命令名丢弃，
  // 于是该段跳过子设置直接落大分类 —— 大分类 allow 时破坏性命令被静默放行。
  // 这里全部用 category=allow + destructive=deny：正确的行为是 **deny**（走子设置），
  // 出问题时是 allow（落大分类），断言写成「必须是 deny」比「不是 allow」更严。
  const opaqueDestructive = [
    ['F27 rm + $()', 'rm -rf ~/.dsh $(true)', 'bash'],
    ['F28 rm + 反引号', 'rm -rf ~/.dsh `true`', 'bash'],
    ['F29 rm + 分组括号', 'rm -rf ~/.dsh (true)', 'bash'],
    ['F30 rm + 花括号展开', 'rm -rf ~/.dsh {a,b}', 'bash'],
    ['F31 Remove-Item + $()', 'Remove-Item -Recurse -Force $(Get-Location)', 'pwsh'],
  ]
  for (const [label, cmd, shell] of opaqueDestructive) {
    const r = run(cmd, shell, { category: 'allow', destructive: 'deny' })
    ok('★★ ' + label + '：段内 opaque 构造不得关掉破坏性子设置（必须是 deny）',
      r.action === 'deny' && r.segments[0].source === 'destructive',
      'action=' + r.action + ' src=' + (r.segments[0] && r.segments[0].source) + ' code=' + (r.segments[0] && r.segments[0].code))
  }
  // 同一机制也曾能绕开用户**显式写的 deny 例外**：例外是显式表态，同样不该被 opaque 让开
  const f32 = run('rm -rf /data $(true)', 'bash', { exceptions: ['rm *'], excAction: 'deny' })
  ok('★★ F32 opaque 构造不得绕开显式 deny 例外', f32.action === 'deny', 'action=' + f32.action)
  // 但「读不懂的内容不可被授权」这条底线必须保住：allow 例外不得因 opaque 而命中。
  // 该段此时走的是 destructive 子设置（opaque 里的 rm 被并集提取出来了）——
  // 关键是**不来自 exception**，即例外确实没被采纳。
  const f33 = run('git status $(rm -rf x)', 'bash', { exceptions: ['git status *'] })
  ok('★ F33 opaque 段仍跳过**例外面**（读不懂的内容不可被授权）',
    f33.action !== 'allow' && f33.segments[0].source !== 'exception', 'action=' + f33.action + ' src=' + f33.segments[0].source)
  // 对照：opaque 里没有可识别的命令名时，同样不得被 allow 例外授权，且落分类默认值
  const f33b = run('git status $(date)', 'bash', { exceptions: ['git status *'], category: 'ask' })
  ok('★ F33b opaque 段（无破坏性命令）同样不被 allow 例外授权',
    f33b.action !== 'allow' && f33b.segments[0].source === 'category', 'action=' + f33b.action + ' src=' + f33b.segments[0].source)

  // ★★ F34–F37：bash 控制关键字不得让后续真实命令逃过判定
  // `;` 是分段符，`if ...; then rm ...; fi` 会切成独立段；`then` 不在关键字表时被当成命令名，
  // 真正的 rm 再也不会被看到。对照 `while ...; do rm ...; done`（`do` 恰好在 PS 表里）是 deny ——
  // 这种「换个关键字就失效」正是遗漏的特征。
  const bashKeywords = [
    ['F34 if/then/fi', 'if true; then rm -rf ~/.dsh; fi'],
    ['F35 if 带测试', 'if [ -d x ]; then rm -rf ~/.dsh; fi'],
    ['F36 time 前缀', 'time rm -rf ~/.dsh'],
    ['F37 ! 取反前缀', '! rm -rf ~/.dsh'],
  ]
  for (const [label, cmd] of bashKeywords) {
    const r = run(cmd, 'bash', { category: 'allow', destructive: 'deny' })
    ok('★★ ' + label + '：控制关键字后的真实命令仍走破坏性子设置（必须是 deny）',
      r.action === 'deny', 'action=' + r.action + ' labels=' + JSON.stringify(r.segments.map((s) => s.label)))
  }

  // ★★ F38–F41：融合短选项必须与精确拼写同等对待（否则可从「不可授权」变成「可被例外放行」）
  // `bash -lc '...'` 与 `bash -c '...'` 完全等价，但只认精确拼写时前者不判 unparsable，
  // 于是例外 `bash *` 能放行它、却放行不了后者。
  const fusedShort = [
    ['F38 bash -lc', 'bash -lc "rm -rf ~/.dsh"', 'bash'],
    ['F39 sh -ec', 'sh -ec "rm -rf ~/.dsh"', 'bash'],
    ['F40 zsh -ic', 'zsh -ic "rm -rf ~/.dsh"', 'bash'],
    ['F41 python -uc', 'python -uc "import os"', 'bash'],
  ]
  for (const [label, cmd, shell] of fusedShort) {
    const r = run(cmd, shell, { exceptions: ['bash *', 'sh *', 'zsh *', 'python *'] })
    ok('★★ ' + label + '：融合短选项同样判 opaque（不得被 allow 例外放行）',
      r.action !== 'allow' && r.segments[0].code === 'unparsable',
      'action=' + r.action + ' code=' + (r.segments[0] && r.segments[0].code))
  }
  // cmd 的 /c 与 /k 大小写不敏感：`cmd /C "..."` 是 Windows 上的标准写法
  const f42 = run('cmd /C "del /f /q x"', 'pwsh', { exceptions: ['cmd *'] })
  ok('★★ F42 cmd /C（大写）同样判 opaque（不得被 allow 例外放行）', f42.action !== 'allow' && f42.segments[0].code === 'unparsable', 'action=' + f42.action + ' code=' + f42.segments[0].code)

  // ★★ F43–F46：find 的 -exec / -delete 所执行的动作必须可见
  // label 恒为 `find` 而 find 不在名单里，于是 `find . -exec rm -rf {} +` 的 rm 从未被看一眼。
  const findExec = [
    ['F43 -exec', 'find . -exec rm -rf {} +'],
    ['F44 -execdir', 'find . -execdir rm -rf {} +'],
    ['F45 -ok', 'find . -ok rm -rf {} +'],
    ['F46 -delete', 'find . -delete'],
  ]
  for (const [label, cmd] of findExec) {
    const r = run(cmd, 'bash', { category: 'allow', destructive: 'deny' })
    ok('★★ ' + label + '：find 执行/触发的破坏性动作必须走子设置（必须是 deny）',
      r.action === 'deny', 'action=' + r.action + ' label=' + r.segments[0].label + ' code=' + r.segments[0].code)
  }
  // 反面：只读的 find 不该被误伤（不得过度收紧）
  const f47 = run('find . -name "*.log"', 'bash', { category: 'allow', destructive: 'deny' })
  ok('F47 只读 find 不被误判破坏性（不得过度收紧）', f47.action === 'allow' && f47.segments[0].code !== 'destructive', 'action=' + f47.action)

  // ★★ F48–F51：opaque 段必须保留 **ask** 例外（它不是授权，是「要求确认」）
  // 曾经的写法只保留 deny、把 ask 与 allow 一起跳过，于是「每次问我」被降级为「静默放行」：
  // 例外 rm=ask 时 `rm -rf /data` 是 ask，而 `rm -rf /data $(true)` 是 allow。
  // 反例：把判据写回 `ex.action === 'deny'`，本组即失败。
  for (const [label, cmd] of [['F48 $()', 'rm -rf /data $(true)'], ['F49 反引号', 'rm -rf /data `true`'], ['F50 分组', 'rm -rf /data (true)'], ['F51 花括号', 'rm -rf /data {a,b}']]) {
    const r = run(cmd, 'bash', { exceptions: ['rm *'], excAction: 'ask', category: 'allow', destructive: 'allow' })
    ok('★★ ' + label + '：opaque 段仍保留 ask 例外（不得降级为放行）',
      r.action === 'ask' && r.segments[0].source === 'exception',
      'action=' + r.action + ' src=' + (r.segments[0] && r.segments[0].source))
  }
  // ask 例外的 note 也要带上（弹窗上给人看的备注）——注意 hooks 默认不产 note，
  // 故这里显式给一条带 note 的 ask 例外，断言它经 opaque 段后仍被下发。
  const f52 = run('rm -rf /data $(true)', 'bash', { exceptions: ['rm *'], excAction: 'ask', category: 'allow', destructive: 'allow', excNote: '删东西前先问我' })
  ok('F52 opaque 段命中 ask 例外时 note 一并下发（弹窗备注不丢）',
    f52.segments[0].note === '删东西前先问我', JSON.stringify(f52.segments[0].note))

  // ★★ F53–F56：整行 ok:false 时 deny 例外仍要生效
  // 合法 heredoc 会真实执行，曾因整行读不懂而绕过用户显式写的 deny 例外。
  for (const [label, cmd] of [
    ['F53 heredoc 带正文', 'rm -rf /data <<EOF\nx\nEOF'],
    ['F54 heredoc 无正文', 'rm -rf /data <<EOF'],
    ['F55 未闭合引号', 'rm -rf /data "unclosed'],
    ['F56 悬空管道', 'rm -rf /data |'],
  ]) {
    const r = run(cmd, 'bash', { exceptions: ['rm *'], excAction: 'deny', category: 'allow', destructive: 'allow' })
    ok('★★ ' + label + '：整行读不懂时 deny 例外仍生效（不得绕过显式拒绝）',
      r.action === 'deny', 'action=' + r.action + ' code=' + r.code)
  }
  // 反面：整行读不懂时 **allow** 例外不得生效（读不懂的内容不可被授权）
  const f57 = run('rm -rf /data <<EOF\nx\nEOF', 'bash', { exceptions: ['rm *'], excAction: 'allow', category: 'ask', destructive: 'ask' })
  ok('★★ F57 整行读不懂时 allow 例外不生效（不可被授权）', f57.action !== 'allow', 'action=' + f57.action)

  // ★★ F58–F60：WRAPPERS 扩充后，各前缀下的破坏性命令都必须被识别
  // 这些不是罕见形态而是日常写法；漏剥的后果与「有效命令名判错」同类。
  for (const [label, cmd] of [
    ['F58 command 前缀', 'command rm -rf /x'],
    ['F59 nohup 前缀', 'nohup rm -rf /x'],
    ['F60 builtin 前缀', 'builtin rm -rf /x'],
  ]) {
    const r = run(cmd, 'bash', { category: 'allow', destructive: 'deny' })
    ok('★★ ' + label + '：破坏性命令必须被识别（必须是 deny）',
      r.action === 'deny' && r.segments[0].label === 'rm', 'action=' + r.action + ' label=' + r.segments[0].label)
  }
  // find 在 time/command 等关键字前缀下也要展开（segmentLabels 用 main 判据而非 w[0]）
  for (const [label, cmd] of [['F61 time + find', 'time find . -delete'], ['F62 command + find', 'command find . -delete']]) {
    const r = run(cmd, 'bash', { category: 'allow', destructive: 'deny' })
    ok('★★ ' + label + '：find 的 -delete 仍被识别（必须是 deny）', r.action === 'deny', 'action=' + r.action)
  }
  // 反面：只读命令经前缀包装后不该被误伤
  const f63 = run('nohup ls -la', 'bash', { category: 'allow', destructive: 'deny' })
  ok('F63 只读命令经 nohup 前缀不误判破坏性', f63.action === 'allow' && f63.segments[0].label === 'ls', 'action=' + f63.action + ' label=' + f63.segments[0].label)

  // ★★ F64–F67：globMatch 的星号必须优先于「字符相等」
  // 曾经的顺序是先判 `pat[p] === hay[h]` 再判 `*`，于是 pattern 的星号一旦撞上 haystack 里的
  // **字面 `*`** 就走字面分支、回退点永不记录 —— 星号丧失「任意长」语义。
  // 这是 AI 可轻易利用的绕过：例外 `rm -rf *`=deny 时 `rm -rf /data` 是 deny，
  // 而 `rm -rf *.log` 曾是 **allow**。与 DP 参考实现对拍 8.3 万组零差异。
  // 反例：把 globMatch 里两个 if 的顺序调回「字符相等在前」，F64/F65 即失败。
  ok('★★ F64 通配符例外能匹配含字面通配符的命令（deny 不被绕过）',
    matchCommand('rm -rf *', 'rm -rf *.log') === true && matchCommand('rm -rf *', 'rm -rf *.tmp') === true,
    JSON.stringify([matchCommand('rm -rf *', 'rm -rf *.log'), matchCommand('rm -rf *', 'rm -rf *.tmp')]))
  ok('★ F65 星号匹配任意 haystack（含前导/内嵌通配符）',
    matchCommand('*', '*x') === true && matchCommand('a*', 'a*b') === true && matchCommand('git *', 'git *.js') === true)
  ok('★ F66 问号恰好匹配一个字符（不因 haystack 含通配符而失效）',
    matchCommand('?', 'a') === true && matchCommand('?', '*a') === false && matchCommand('a?c', 'abc') === true)
  // 端到端：例外 rm -rf *=deny 时，通配形态必须同样被拦
  const f67 = run('rm -rf *.log', 'bash', { exceptions: ['rm -rf *'], excAction: 'deny', category: 'allow', destructive: 'allow' })
  ok('★★ F67 含通配符的删除命令同样命中 deny 例外（端到端）', f67.action === 'deny', 'action=' + f67.action)

  // ★★ F68–F71：find -exec 之后的命令若带前缀包装器，仍要被识别
  // `-exec` 后是一条完整命令行，同样可以有 env/timeout/nice/command/nohup 前缀；
  // 不剥的后果：`find . -exec rm` 是 deny，而 `-exec env rm` → allow。
  for (const [label, cmd] of [
    ['F68 env', 'find . -exec env rm -rf {} \\;'],
    ['F69 timeout', 'find . -exec timeout 5 rm -rf {} \\;'],
    ['F70 command', 'find . -exec command rm -rf {} \\;'],
    ['F71 nohup', 'find . -exec nohup rm -rf {} \\;'],
  ]) {
    const r = run(cmd, 'bash', { category: 'allow', destructive: 'deny' })
    ok('★★ ' + label + '：find -exec 后的 wrapper 前缀不遮蔽破坏性命令（必须是 deny）',
      r.action === 'deny', 'action=' + r.action)
  }

  // ★★ F72–F76：整行 ok:false 时**破坏性子设置**也要生效（不只是 deny 例外）
  // 之前该分支只查 deny 例外、然后落分类默认值，完全没调用 h.destructive()。
  // 于是给破坏性命令套一个 heredoc 就绕过了子设置 —— 而子设置正是
  // 「大分类设为 allow 时保护破坏性命令」的唯一一道闸。
  for (const [label, cmd] of [
    ['F72 heredoc 带正文', 'rm -rf /data <<EOF\nx\nEOF'],
    ['F73 heredoc 后跟命令', 'rm -rf /data; cat <<EOF\nx\nEOF'],
    ['F74 未闭合引号', 'rm -rf /data "'],
    ['F75 重定向无目标', 'rm -rf /data >'],
    ['F76 悬空管道', 'rm -rf /data |'],
  ]) {
    const r = run(cmd, 'bash', { category: 'allow', destructive: 'deny' })
    ok('★★ ' + label + '：整行读不懂时破坏性子设置仍生效（必须是 deny）',
      r.action === 'deny', 'action=' + r.action + ' code=' + r.code)
  }
  // 反面：只读命令配 heredoc 不该被子设置误伤
  const f77 = run('cat file.txt <<EOF\nx\nEOF', 'bash', { category: 'allow', destructive: 'deny' })
  ok('F77 只读命令配 heredoc 不误判破坏性', f77.action === 'allow', 'action=' + f77.action)
  // 反面：整行读不懂时 allow/ask 例外仍不得生效（不可被授权）
  const f78 = run('rm -rf /data <<EOF\nx\nEOF', 'bash', { exceptions: ['rm *'], excAction: 'allow', category: 'ask', destructive: 'ask' })
  ok('★★ F78 整行读不懂时 allow 例外不生效（不可被授权）', f78.action !== 'allow', 'action=' + f78.action)

  // ★★ F79–F82：整行 ok:false 路径必须与段级用**同一套归一化**
  // （rawCommandNames 复用 segmentLabels：剥 wrapper、展开 find -exec）
  // 只用「片段首词」会让 wrapper/find 形态在这条路径上失效：
  // 实测 `env rm -rf /x <<EOF` 与 `find . -delete <<EOF` 曾是 allow（不带 heredoc 时是 deny）。
  for (const [label, cmd] of [
    ['F79 wrapper + heredoc', 'env rm -rf /x <<EOF\nbody\nEOF'],
    ['F80 timeout + heredoc', 'timeout 5 rm -rf /x <<EOF\nbody\nEOF'],
    ['F81 find -delete + heredoc', 'find . -delete <<EOF\nbody\nEOF'],
    ['F82 find -exec + heredoc', 'find . -exec rm -rf {} \\; <<EOF\nbody\nEOF'],
  ]) {
    const r = run(cmd, 'bash', { category: 'allow', destructive: 'deny' })
    ok('★★ ' + label + '：整行读不懂时 wrapper/find 形态仍被识别（必须是 deny）',
      r.action === 'deny', 'action=' + r.action)
  }
  // ★★ F82b：`-exec` 载荷槽位**以占位符开头**时，其后的真命令名必须照样被看见。
  //
  // 这是 F82 的**结构性盲区**：F82 的语料是 `find . -exec rm -rf {} \;`（占位符在**后**），
  // 而占位符在**首**的形态一格都没覆盖，于是「载荷槽位首词元是 `{}` / `;` / `+` 时
  // 破坏性判定整体丢失」这一缺陷在 F82 全绿的情况下照不出来。
  //
  // 根因：`headLabelAt` 在载荷首词元是占位符时**直接 return ''**（旧实现是 `continue`，
  // 继续往后扫）。改成 `headLabelAt` 后，其后的真命令名再也不进 labels ——
  // 实测 `find . -exec {} rm -rf / \;` 的 labels 只剩 `['find','{}']`、`destructive` 由
  // true 变 **false**，端到端由 deny → **allow**；用户例外 `rm *`=deny 同样被绕过；
  // `tiers` 全空（对照 `find . -exec kill 1234 \;` 是 `['proc']`）。
  // 修法是**跳过占位符再取命令名**（保留「不把占位符写进 labels」这条既有口径）。
  //
  // 判据（三条，缺一不可）：
  //   ① **与「占位符在后」的既有正确形态同值** —— 同一个 `-exec` 载荷族不该因
  //      占位符位置不同给出两个结论（`find . -exec {} rm -rf / \;` 与
  //      `find . -exec rm -rf {} \;` 必须逐字同值）；
  //   ② 该格**必须是 deny**（子设置 deny + 大分类 allow）；
  //   ③ 用户例外 `rm *`=deny 也必须命中（收紧方向的证据）。
  // 语料：3 个占位符（`{}` / `';'` / `+`）× 4 个 flag × 4 个载荷。
  {
    const flagsF82b = ['-exec', '-execdir', '-ok', '-okdir']
    // `;` 在词法器里是分段符，故占位符形态写作带引号的 `';'`（与 54 族既有语料同形）
    const phsF82b = [['{}', '{}'], [';', "';'"], ['+', '+']]
    const payF82b = ['rm -rf /', 'kill 1234', 'shutdown /s', 'wmic x']
    const badF82b = []
    for (const f of flagsF82b) for (const [phName, phLit] of phsF82b) for (const p of payF82b) {
      const first = 'find . ' + f + ' ' + phLit + ' ' + p + ' \\;'
      const canon = 'find . ' + f + ' ' + p + ' \\;'
      const aFirst = run(first, 'bash', { category: 'allow', destructive: 'deny' })
      const aCanon = run(canon, 'bash', { category: 'allow', destructive: 'deny' })
      // ① 同值 + ② 必须 deny
      if (aFirst.action !== aCanon.action || aFirst.action !== 'deny') {
        badF82b.push([f + ' ph=' + phName, p, aFirst.action, 'canon=' + aCanon.action])
      }
      // ③ 例外 deny 族同样必须命中（与规范形态同值）
      const eFirst = run(first, 'bash', { exceptions: ['rm *', 'kill *', 'shutdown *', 'wmic *'], excAction: 'deny', category: 'allow', destructive: 'ask' })
      const eCanon = run(canon, 'bash', { exceptions: ['rm *', 'kill *', 'shutdown *', 'wmic *'], excAction: 'deny', category: 'allow', destructive: 'ask' })
      if (eFirst.action !== eCanon.action) badF82b.push(['例外 deny', f + ' ph=' + phName, p, eFirst.action, 'canon=' + eCanon.action])
    }
    // 对照（防空转）：真命令名确实**可见** —— labels 里必须出现该载荷的命令名，
    // 且与「占位符在后」形态的 labels 逐字相同（否则「同值」可能来自两边都判不出）
    const labelsOfF82b = (c) => {
      const d = decomposeCommand(c, 'bash')
      return (d.ok && d.segments.length) ? segmentLabels(d.segments[0].words) : []
    }
    const labelsFirst = labelsOfF82b('find . -exec {} rm -rf / \\;')
    const labelsCanon = labelsOfF82b('find . -exec rm -rf {} \\;')
    // 对照：三个占位符都必须**不进** labels（既有口径：占位符不是命令名）
    const phNotInLabels = [labelsOfF82b("find . -exec ';' rm -rf / \\;"), labelsOfF82b('find . -exec + rm -rf / \\;')]
      .every((ls) => ls.indexOf('{}') === -1 && ls.indexOf(';') === -1 && ls.indexOf('+') === -1)
    // 对照：`tiers` 也不得为空（`find . -exec kill 1234 \;` 是 ['proc']）。
    // ⚠️ 这里**自带**一份最小 opts（`tierOpts` 定义在 T 组的块作用域里，F 组取不到），
    // 口径与 T 组同源：平台 win32 + 工作区内外钩子（本格用不到路径判档，恒 true 即可）。
    const optsF82b = {
      home: HOME, userHome: HOME, platform: 'win32',
      isOutsideWorkspace: () => true, isWorkspaceRoot: () => false,
    }
    const dT = decomposeCommand('find . -exec {} kill 1234 \\;', 'bash')
    const tiersFirst = dT.ok
      ? tierSetOf({ words: dT.segments[0].words, blast: blastRadiusOfSegment(dT.segments[0].words, optsF82b) }, segmentLabels(dT.segments[0].words), optsF82b)
      : []
    ok('★★ F82b `-exec` 载荷槽位**以占位符开头**时真命令名仍可见（3 占位符 × 4 flag × 4 载荷：与「占位符在后」同值且必须 deny）',
      badF82b.length === 0
      && labelsFirst.indexOf('rm') !== -1 && labelsFirst.join('|') === labelsCanon.join('|')
      && phNotInLabels
      && tiersFirst.join(',') === 'proc',
      JSON.stringify({ badF82b: badF82b.slice(0, 8), labelsFirst, labelsCanon, tiersFirst }))
  }

  // ★★ F82c：`-exec` 载荷槽位**以「空 basename 词元」开头**时，其后的真命令名必须照样被看见。
  //
  // 这是 F82b 的**结构性盲区**（与 F82b 对 F82 的关系同型）：F82b 只覆盖三个占位符
  // `{}` / `';'` / `+`，而它们的 `commandNameOf` **恰好非空**（实测 `{}`→`{}`、`;`→`;`、
  // `+`→`+`），故它照不出「首词元的 basename 为**空串**」这一族。
  //
  // 根因：`headLabelAt` 跳过载荷首占位符的循环曾写成 `PH(commandNameOf(w[st]))` ——
  // `commandNameOf` 对空 basename 词元（`/`、`./`、`../`、`bin/`、`C:/`、`~/`、`$X/`、
  // `//`、`.exe`、`x.exe/` …）返回**空串**，`PH('')` 为 **false** → 循环**立即停下** →
  // `pushHeadLabels` 的 `if (!first) return ''` 提前返回 → **整个 `-exec` 载荷族 label
  // 合成被放弃**（fail-open）。HEAD 用的是「`continue` 继续向后扫」，不受影响。
  // 实测（修复前）：`find . -exec / rm -rf / {} +` HEAD labels=`['find','rm']`/
  // `destructive=true` → CUR labels=`['find']`/`destructive=false`；
  // 本语料 10 空 basename × 4 flag × 6 载荷 × 4 tail = **960 格全差异**，
  // 端到端（大分类 allow + 破坏性 deny）由 deny 变 **allow**。
  //
  // 判据（三条，与 F82b 同口径）：
  //   ① **与「无空 basename 的同形态」逐字同值** —— labels / destructive / 端到端 action
  //      三者都必须与 `find . -exec rm -rf … {} +` 相同（同一个载荷族不该因首词元是不是
  //      路径碎片给出两个结论）；
  //   ② 对照自身必须**非空转**：该载荷族在「大分类 allow + 破坏性 deny」下确实 deny、
  //      且 destructive=true（否则「同值」可能来自两边都判不出）。
  //      ⚠️ 这里**不能**用 `action !== 'allow'` 当判据 —— 那会空转（ask 也过）。
  //      `reg delete` 载荷在 win32 下**不是** destructive（`reg` 是组档命令，靠 `reg` 档
  //      拦），故它单独用 labels 同值 + `tiers` 含 `reg` 钉住，不要求 deny。
  //   ③ 空 basename 词元**不进** labels（既有口径：它不是命令名）。
  // 语料：10 个空 basename 词元 × 4 个 flag × 6 个载荷 × 4 个 tail = 960 格。
  {
    const flagsF82c = ['-exec', '-execdir', '-ok', '-okdir']
    // 全部是「basename 为空」的词元（`commandNameOf` 返回空串）——含 `/`、`C:/` 这类
    // 绝对/相对路径碎片，以及 `.exe` 这类 Windows 后缀词元。
    const emptiesF82c = ['/', './', '../', 'bin/', 'C:/', '~/', '$X/', '//', '.exe', 'x.exe/']
    const payF82c = ['rm -rf /', 'kill 1234', 'shutdown /s', 'wmic x', 'reg delete HKLM\\X /f', 'diskpart']
    const tailsF82c = ['{} +', '{} \\;', '{}', "'{}' +"]
    // 需要「必须 deny」的载荷（`reg delete` 走 reg 组档，单独处理）
    const denyPays = ['rm -rf /', 'kill 1234', 'shutdown /s', 'wmic x', 'diskpart']
    const badF82c = []
    let canonNotDeny = 0
    // F82c 用的最小助手（本块内自足：F82b 的 `labelsOfF82b` / `optsF82b` 定义在**它自己的
    // 块作用域**里，本块取不到 —— 这里按同一口径各写一份最小实现，判据与 F82b 同源）：
    //   · labelsOfF82c   —— 段级 labels（与 segmentLabels 同一份实现）
    //   · destructiveOf  —— 段级破坏性判定（与 isDestructiveSegment 同一份 segmentLabels）
    //   · actionOf       —— 端到端动作：大分类 allow + 破坏性 deny（该载荷族的既有判据）
    const labelsOfF82c = (c) => {
      const d = decomposeCommand(c, 'bash')
      return (d.ok && d.segments.length) ? segmentLabels(d.segments[0].words) : []
    }
    const destructiveOf = (c) => {
      const d = decomposeCommand(c, 'bash')
      return (d.ok && d.segments.length) ? isDestructiveSegment(d.segments[0].words) : '<opaque>'
    }
    const actionOf = (c) => run(c, 'bash', { category: 'allow', destructive: 'deny' }).action
    // 本格用不到路径判档（`/` 目标是 drive-root，靠 blast 判档），恒 true / false 即可，
    // 口径与 F82b 的 optsF82b 同源。
    const optsF82c = {
      home: HOME, userHome: HOME, platform: 'win32',
      isOutsideWorkspace: () => true, isWorkspaceRoot: () => false,
    }
    for (const e of emptiesF82c) for (const f of flagsF82c) for (const p of payF82c) for (const t of tailsF82c) {
      const withE = 'find . ' + f + ' ' + e + ' ' + p + ' ' + t
      const canon = 'find . ' + f + ' ' + p + ' ' + t
      // ① labels / destructive 与对照逐字同值
      const lw = labelsOfF82c(withE)
      const lc = labelsOfF82c(canon)
      const dW = destructiveOf(withE)
      const dC = destructiveOf(canon)
      if (lw.join('|') !== lc.join('|') || dW !== dC) {
        badF82c.push(['labels/destructive 分叉', withE, lw.join('|'), 'canon=' + lc.join('|'), dW, dC])
        continue
      }
      // ② 对照自身非空转（deny 载荷）
      if (denyPays.indexOf(p) !== -1 && (dC !== true || actionOf(canon) !== 'deny')) {
        canonNotDeny += 1
        badF82c.push(['对照自身空转', canon, dC, actionOf(canon)])
      }
      // ③ 端到端 action 与对照同值
      const aW = actionOf(withE)
      const aC = actionOf(canon)
      if (aW !== aC) badF82c.push(['action 分叉', withE, aW, 'canon=' + aC])
    }
    // ③ 空 basename 词元不进 labels（既有口径）
    const emptiesNotInLabels = emptiesF82c.every((e) => labelsOfF82c('find . -exec ' + e + ' rm -rf / \\;').indexOf(e) === -1)
    // 对照（防空转）：真命令名确实可见 —— labels 含载荷命令名，且与无空 basename 形态同值
    const labelsC1 = labelsOfF82c('find . -exec / rm -rf / \\;')
    const labelsC2 = labelsOfF82c('find . -exec rm -rf / \\;')
    // 组档（`proc` / `power` / `reg`）也必须看得见：载荷族合成的是**单词** label（54s 口径），
    // 故 `reg delete …` 只给 `reg`（不在 `GROUP_OF_LABEL` 的 `reg delete` 键上），
    // 用 `wmic`（单词 label、`reg` 组成员）钉住组档这一路 —— 与对照同值。
    const dReg = decomposeCommand('find . -exec / wmic x \\;', 'bash')
    const tiersReg = dReg.ok
      ? tierSetOf({ words: dReg.segments[0].words, blast: blastRadiusOfSegment(dReg.segments[0].words, optsF82c) }, segmentLabels(dReg.segments[0].words), optsF82c)
      : []
    const dRegCanon = decomposeCommand('find . -exec wmic x \\;', 'bash')
    const tiersRegCanon = dRegCanon.ok
      ? tierSetOf({ words: dRegCanon.segments[0].words, blast: blastRadiusOfSegment(dRegCanon.segments[0].words, optsF82c) }, segmentLabels(dRegCanon.segments[0].words), optsF82c)
      : []
    ok('★★ F82c `-exec` 载荷槽位**以空 basename 词元开头**时真命令名仍可见（10 词元 × 4 flag × 6 载荷 × 4 tail：与同形态对照逐字同值）',
      badF82c.length === 0
      && canonNotDeny === 0
      && emptiesNotInLabels
      && labelsC1.indexOf('rm') !== -1 && labelsC1.join('|') === labelsC2.join('|')
      && tiersReg.join(',') === 'reg' && tiersReg.join(',') === tiersRegCanon.join(','),
      JSON.stringify({ badF82c: badF82c.slice(0, 8), canonNotDeny, emptiesNotInLabels, labelsC1, labelsC2, tiersReg, tiersRegCanon }))
  }

  // ★★ F82d：`-exec` 载荷首词元含 `BAD_LABEL_CHARS` 时，**畸形名不得被写进 labels**。
  //
  // 这是 F82b / F82c 的**同族盲区**（那两者都在「跳过不是命令名的词元」上做文章，而这一族的
  // 词元**被认成了命令名**，只是名字畸形）：`headLabelAt` 的守卫
  // `if (BAD_LABEL_CHARS.test(head)) return ''` 位于 `pushHeadLabels` 的 `push(first)`
  // **之后** —— 它只阻止**返回** `head`，拦不住已经落进 `out`（= labels）的畸形名。
  //
  // HEAD 的两条 `-exec` 分支都在 push **之前** `break`
  // （`git show HEAD:shell-parse.js` 的 `:605` / `:617`：`const cand = commandNameOf(w[k])`
  // → `if (BAD_LABEL_CHARS.test(cand)) break` → `out.push(cand)`），故 HEAD **从不**把畸形名
  // 写进 labels —— 本条是 HEAD 与实现之间的**新分叉**（不是「`}` 闭合花括号族」那种语法非法
  // 形态，那族三基线同值），方向是 **fail-open**。
  //
  // 实测（修复前）：336 格中 **216 格** labels 分叉
  // （`find . -exec a-b=c rm -rf / {} +` 的 labels 由 HEAD 的 `['find']` 变 `['find','a-b=c']`），
  // 端到端同 216 格由 ask 变 **allow**（例外 `a*`=allow 时 `matchCommand('a*','a-b=c')` 为 true，
  // 整段被这条**宽泛**例外命中）。修法是把守卫**前移到 `push(first)` 之前**，与 HEAD 的
  // `break` 语义对齐 —— 即「畸形名一律不写进 labels」。
  //
  // 判据（五条，缺一不可）：
  //   ① labels 里**没有任何**含 `BAD_LABEL_CHARS` 的项 —— 不依赖 HEAD 的具体取值，
  //      是最本质的不变量（正则从生产源码提取，不手抄第二份字符集）；
  //   ② **与 HEAD 逐字同值** —— 336 格的 labels 取值必须落在 HEAD 逐格实测的集合内
  //      （HEAD 遇畸形名即 `break` ⇒ 载荷族整体放弃合成 ⇒ 只有 5 种取值）；
  //   ③ 畸形名**之后**的合法命令名也**不得**进 labels（HEAD 的语义是 `break` 而不是
  //      `continue`）—— 这一格最容易被「改成继续向后扫」的将来改动破坏；
  //   ④ 端到端：宽泛例外下整段**不得**再被放行；
  //   ⑤ **不误伤**：合法两词 label（`reg delete`，F3 的承重设计）、F82b 的占位符族、
  //      F82c 的空 basename 族、54s 的单词粒度、合法赋值前缀载荷，五者逐字不变。
  // 语料：14 畸形名 × 4 flag × 3 载荷 × 2 tail = 336 格。
  //
  // ⚠️ ④ 的语料**必须排除**含 shell 元字符（`&` `|` `<` `>`）的 4 个名：它们在**词法器**层
  // 就被拆开（`a&b` → 两段、`a<b` → `a` + 重定向），根本走不到载荷族的畸形名守卫 ——
  // 实测这 4 个名的 96 格在 PRE / FIX / HEAD 下**逐格同值**（均 48 格 allow，属既有形态，
  // 不在本次修复范围）。把它们算进 ④ 会让断言去管一件本修法不该管的事。
  {
    const flagsF82d = ['-exec', '-execdir', '-ok', '-okdir']
    // 全部含 `BAD_LABEL_CHARS`（`=`/`*`/`?`/`$`/`%`/`&`/`|`/`<`/`>`）且**不是**合法赋值前缀
    // （`1=2` / `a=b=c` 不是 `[A-Za-z_]` 开头，故 `unwrapWords` 的赋值前缀判据不吃它们）
    const malformedF82d = ['x*y', 'a?b', '$X', 'a%b', '--foo=bar', '1=2', 'a.b=c', 'A-B=C', 'a&b', 'a|b', 'a<b', 'a>b', 'a=b=c', 'a-b=c']
    // ④ 的语料：真正会走到载荷族守卫的那 10 个（不含被词法器切段的 4 个）
    const guardReachF82d = ['x*y', 'a?b', '$X', 'a%b', '--foo=bar', '1=2', 'a.b=c', 'A-B=C', 'a=b=c', 'a-b=c']
    const payF82d = ['rm -rf /', 'kill 1234', 'shutdown /s']
    const tailsF82d = ['{} +', '{} \\;']
    const labelsOfF82d = (c) => {
      const d = decomposeCommand(c, 'bash')
      return (d.ok && d.segments.length) ? segmentLabels(d.segments[0].words) : ['<opaque>']
    }
    // 与生产**同源**的畸形字符判据（从源码提取，不手抄第二份字符集 —— 与 T 组 32b 同法）。
    const spSrcF82d = readFileSync(pathJoin(ROOT, 'shell-parse.js'), 'utf8')
    const badCharsSrcF82d = (spSrcF82d.match(/const BAD_LABEL_CHARS = \/(.+?)\/\s*$/m) || [])[1]
    const badCharsF82d = badCharsSrcF82d ? new RegExp(badCharsSrcF82d) : null
    // HEAD 逐格实测的取值集合（`git show HEAD:shell-parse.js` 跑同一份 336 格语料得出）。
    // HEAD 遇畸形名即 `break` ⇒ 载荷族整体放弃 ⇒ 只剩 `find`，或慢路径剥掉赋值前缀后取到的
    // 那个名字（`a=b=c` → `rm`）；`a&b` / `a|b` / `a<b` / `a>b` 被词法器切段，首段末词元是 `a`。
    const headValuesF82d = ['find', 'find|a', 'find|rm', 'find|kill', 'find|shutdown']
    // ④ 用的宽泛例外：前缀形态覆盖 ④ 语料里的 9 个畸形名（`a*` / `x*` / `$x*` / `--foo*` / `1*`；
    // `a=b=c` 走慢路径、修复前也不被授权）。实测该配置下 ④ 的语料（240 格）：
    // **PRE 216 格 allow、FIX 0 格、HEAD 0 格**（逐名分布：8 个名各 24 格 allow，`a=b=c` 0 格）。
    const wideExcF82d = ['a*', 'x*', '$x*', '--foo*', '1*']
    const badF82d = []
    let nAllowF82d = 0
    for (const m of malformedF82d) for (const f of flagsF82d) for (const p of payF82d) for (const t of tailsF82d) {
      const c = 'find . ' + f + ' ' + m + ' ' + p + ' ' + t
      const lb = labelsOfF82d(c)
      // ① 畸形名不得以**任何形态**出现在 labels 里
      if (badCharsF82d && lb.some((l) => badCharsF82d.test(l))) badF82d.push(['①畸形名进 labels', c, lb.join('|')])
      // ② 与 HEAD 逐字同值
      if (headValuesF82d.indexOf(lb.join('|')) === -1) badF82d.push(['②与 HEAD 取值不同', c, lb.join('|')])
      // ③ 畸形名之后的合法命令名也不得进 labels（HEAD 的语义是 `break` 而不是 `continue`）
      // ⚠️ 不适用于**合法赋值前缀形态**（`a=b=c` 匹配 `^[A-Za-z_][A-Za-z0-9_]*=`）：它走慢路径
      // 被 `unwrapWords` 当 `NAME=value` 剥掉，后面的 `rm` 照常进 labels —— 那是 HEAD 的既有
      // 口径（实测三基线同值 `find|rm`），不在本修法范围内，故这一格只由 ② 守。
      const isAssignPrefixF82d = /^[A-Za-z_][A-Za-z0-9_]*=/.test(m)
      if (!isAssignPrefixF82d && lb.indexOf(p.split(' ')[0]) !== -1) badF82d.push(['③畸形名之后的命令名仍进 labels', c, lb.join('|')])
    }
    // ④ 端到端：宽泛例外下整段不得再被放行（仅 10 个走守卫的形态）
    for (const m of guardReachF82d) for (const f of flagsF82d) for (const p of payF82d) for (const t of tailsF82d) {
      const c = 'find . ' + f + ' ' + m + ' ' + p + ' ' + t
      if (run(c, 'bash', { exceptions: wideExcF82d, excAction: 'allow', category: 'ask', destructive: 'ask' }).action === 'allow') {
        nAllowF82d += 1
        badF82d.push(['④宽泛例外仍放行', c, 'allow'])
      }
    }
    // ④ 的**防空转对照**：证明那批例外本身有效（不是「例外根本没生效」才 0 格 allow）。
    // ⚠️ 对照必须取**主路径上真能被这批例外授权**的形态：`--foo=bar` / `1=2` / `$X` 单段时
    // labels 为空（`segmentLabelFrom` 的同一道守卫），不可被授权，故不能当对照。
    const antiNoopF82d = [
      ['a rm -rf /', 'allow'],   // `a*` 例外有效
      ['x foo', 'allow'],        // `x*` 例外有效
      // 对照：被修的那一格本身（修复前 PRE 是 allow，FIX / HEAD 是 ask）
      ['find . -exec a-b=c rm -rf / {} +', 'ask'],
      // 对照：畸形名的**载荷形态**在慢路径上（`a=b=c` 被当赋值前缀剥掉）仍照常可见 ——
      // 证明新守卫不是「一律放弃载荷族」，而是只挡畸形名。
      ['find . -exec a=b=c rm -rf / {} +', 'ask'],
    ]
    const antiNoopActF82d = (c) => run(c, 'bash', { exceptions: wideExcF82d, excAction: 'allow', category: 'ask', destructive: 'ask' }).action
    const badAntiF82d = antiNoopF82d
      .filter(([c, want]) => antiNoopActF82d(c) !== want)
      .map(([c, want]) => [c, 'want=' + want, 'got=' + antiNoopActF82d(c)])
    // ⑤ 不误伤：五族逐字不变（每格都写死期望 labels，防「顺手改粒度」）
    const noHarmF82d = [
      ['find . -exec "reg delete" HKLM\\X /f {} \\;', 'find|reg delete'],   // F3：两词 label 不得退化成 `reg`
      ['find . -exec reg delete HKLM\\X /f {} \\;', 'find|reg'],            // 54s：单词粒度
      ['find . -exec sudo reg delete HKLM\\X /f {} \\;', 'find|sudo|reg'],
      ['find . -exec {} rm -rf / \\;', 'find|rm'],                          // F82b：占位符族
      ["find . -exec ';' rm -rf / \\;", 'find|rm'],
      ['find . -exec / rm -rf / {} +', 'find|rm'],                          // F82c：空 basename 族
      ['find . -exec / wmic x \\;', 'find|wmic'],
      ['find . -exec FOO=1 rm -rf / {} \\;', 'find|rm'],                    // 慢路径：合法赋值前缀
      ['find . -exec env FOO=1 kill 1234 {} \\;', 'find|kill'],
      ['find . -exec a=b=c rm -rf / {} +', 'find|rm'],                      // 慢路径：畸形赋值前缀（既有口径）
      ['x*y rm -rf /', ''],                                                 // 主路径：畸形名段首（既有口径）
      ['a&b rm -rf /', 'a'],                                                // 主路径：词法器切段（既有口径）
    ]
    const badNoHarmF82d = noHarmF82d
      .filter(([c, want]) => labelsOfF82d(c).join('|') !== want)
      .map(([c, want]) => [c, 'want=' + want, 'got=' + labelsOfF82d(c).join('|')])
    ok('★★ F82d `-exec` 载荷首词元含 `BAD_LABEL_CHARS` 时畸形名不得进 labels（14 畸形名 × 4 flag × 3 载荷 × 2 tail：与 HEAD 逐字同值）',
      badF82d.length === 0
      && nAllowF82d === 0
      && badAntiF82d.length === 0
      && badNoHarmF82d.length === 0
      && badCharsF82d !== null
      && badCharsF82d.test('a-b=c') && badCharsF82d.test('x*y') && badCharsF82d.test('$X')
      && !badCharsF82d.test('rm') && !badCharsF82d.test('reg delete'),
      JSON.stringify({ badF82d: badF82d.slice(0, 8), nAllowF82d, badAntiF82d, badNoHarmF82d, badCharsSrcF82d }))
  }

  // ★★ F83：heredoc 正文是**数据**，其中的命令名不得触发判定
  const f83 = run('cat > notes.txt <<EOF\nremember to rm -rf old files\nEOF', 'bash', { category: 'allow', destructive: 'deny' })
  ok('★★ F83 heredoc 正文里的命令名不触发判定（正文是数据，不是命令）',
    f83.action === 'allow', 'action=' + f83.action)
  // 对照：正文之前有破坏性命令时仍要拦
  const f84 = run('rm -rf /x <<EOF\nbody\nEOF', 'bash', { category: 'allow', destructive: 'deny' })
  ok('★★ F84 heredoc 之前的破坏性命令仍被拦（截断不放过真命令）', f84.action === 'deny', 'action=' + f84.action)

  // ★★ F85~F90：分组/花括号包住的破坏性命令。
  // 这是「段内 opaque 不得关掉子设置」那条修复的**遗漏分支**：
  // `(rm -rf x)` 这类形态里，分组被整块当 opaque 文本吞掉，段的 words 是**空的** ——
  // 于是 label 为空、破坏性判定恒 false，大分类 allow 时全部静默放行（实测 7 条）。
  // 与 `rm -rf x $(true)` 是同一件事（段内有 opaque 构造），必须一起堵。
  const GROUPED = [
    ['F85 括号分组', '(rm -rf ~/.dsh)'],
    ['F86 括号带空格', '( rm -rf ~/.dsh )'],
    ['F87 花括号分组', '{ rm -rf ~/.dsh; }'],
    ['F88 括号内多命令', '(cd /tmp; rm -rf ~/.dsh)'],
    ['F89 前段正常 + 括号段', 'echo a; (rm -rf ~/.dsh)'],
    ['F90 if/then 内嵌括号', 'if true; then (rm -rf ~/.dsh); fi'],
    ['F91 括号内 sudo', '(sudo rm -rf /x)'],
    ['F92 括号内 chmod', '(chmod 777 /etc/passwd)'],
  ]
  for (const [label, cmd] of GROUPED) {
    const r = run(cmd, 'bash', { category: 'allow', destructive: 'deny' })
    ok('★★ ' + label + ' 内的破坏性命令仍被拦【' + cmd + '】', r.action === 'deny', 'action=' + r.action + ' labels=' + JSON.stringify(r.segments.map((s) => s.label)))
  }
  // 反向：括号里的**非破坏性**命令不该被误判（不得因为「括号 = opaque」就一律从严到 deny）
  const f93 = run('(echo hi)', 'bash', { category: 'allow', destructive: 'deny' })
  ok('F93 括号内的普通命令不误判为破坏性', f93.action === 'allow', 'action=' + f93.action)
  // F94：括号包住的命令**不能**被 allow 例外授权 —— 段本身仍是 opaque，
  // 而「读不懂的内容不可被授权」是底线（否则 `(任意代码)` 会被一条 `git status *` 放行）。
  // 回退提取的名字只用于**收紧方向**（破坏性子设置 + deny/ask 例外），不参与 allow。
  const f94 = run('(git status)', 'bash', { exceptions: ['git status *'] })
  ok('★ F94 括号包住的命令不被 allow 例外授权（opaque 段不可被授权）',
    f94.action !== 'allow', 'action=' + f94.action)
  ok('F94b 该段标为 unparsable（读不懂）', f94.segments[0].code === 'unparsable', JSON.stringify(f94.segments[0]))
  // 对照：deny 例外仍要生效（收紧方向）
  const f95 = run('(rm -rf /data)', 'bash', { category: 'allow', destructive: 'allow', exceptions: ['rm *'], excAction: 'deny' })
  ok('★ F95 括号包住的命令仍受 deny 例外约束（收紧方向保留）', f95.action === 'deny', 'action=' + f95.action)
  // 对照：ask 例外也要保留（它要求确认，不是授权）
  const f96 = run('(rm -rf /data)', 'bash', { category: 'allow', destructive: 'allow', exceptions: ['rm *'], excAction: 'ask' })
  ok('★ F96 括号包住的命令仍受 ask 例外约束（确认规则不被规避）', f96.action === 'ask', 'action=' + f96.action)

  // ★★ F96b：**默认配置**（mode=allow、`destructive` 未配置 → 八档默认值
  // inside=allow、其余七档=ask，§6.1）下，opaque 构造包住的破坏性命令必须**非 allow**。
  //
  // 上面 F85~F96 全部只覆盖 `destructive: 'deny'`（或显式 action）的形态 —— 那时
  // 旧契约会把**八档都展开成同一个动作**，inside 档也是 deny，于是「opaque 段被归
  // inside」这条错误路径恰好也被拦住：断言全绿，却漏掉了真正的洞。
  // 洞在默认配置这一侧：词法器把 opaque 构造（`( )` / `$( )` / 反引号 / `{ }`）
  // 整块吞掉 —— `(rm -rf /etc)` 的 words 是**空的**、`rm -rf $(echo /etc)` 的目标
  // 整个在构造里 —— 于是 `blastRadiusOfSegment` 没有目标可判、返回 `null`，
  // 而 §5.1 把 `null` 映射成 `inside`：默认配置下 **allow**（实测八种写法全部静默放行）。
  // 正确档位是 `unknown`（§4「三种 null 必须分开」：读不出 ≠ 在区内）。
  {
    const dsDefault = { inside: 'allow', outside: 'ask', wide: 'ask', unknown: 'ask', proc: 'ask', power: 'ask', priv: 'ask', reg: 'ask' }
    const opaqueDefault = (cmd) => assessCommand(cmd, 'bash', Object.assign(hooks({ category: 'allow' }), { destructive: () => dsDefault }))
    const bad = []
    for (const c of ['(rm -rf /etc)', '{ rm -rf /etc; }', '`rm -rf /etc`', 'rm -rf $(echo /etc)',
      'echo $(rm -rf /etc)', '(rm -rf .)', '(rm -rf ~)', '(rm -rf C:/Windows)']) {
      const r = opaqueDefault(c)
      const t = r.segments[0] ? r.segments[0].tiers : []
      if (r.action === 'allow') bad.push(c + ' → allow')
      else if (t.indexOf('unknown') === -1) bad.push(c + ' → ' + r.action + ' tiers=[' + t.join(',') + ']')
    }
    ok('★★ F96b 默认配置（mode=allow、destructive 未配置）下 opaque 段的破坏性命令不得 allow，且归 unknown 档',
      bad.length === 0, JSON.stringify(bad))
    // 反向：同一配置下**纯区内**目标仍须 allow（预筛/改判不得误伤正常命令）
    const stillAllow = ['rm -rf ./build', 'rm -rf build', 'rm test.txt', 'rm -rf src/tmp']
      .filter((c) => opaqueDefault(c).action !== 'allow')
    ok('★ F96c 同一默认配置下纯区内目标仍 allow（不得误伤正常命令）',
      stillAllow.length === 0, JSON.stringify(stillAllow))
  }

  // ★★ F97：wrapper 表缺条目时**不得抛异常**。
  // 曾经 `WRAPPER_VALUE_FLAGS[name][token]` 对 `command`/`builtin`/`exec`/`nohup`/`setsid`
  // 直接取下标（它们在 WRAPPERS 里但没有带值选项）→ TypeError。
  // 崩溃点在 tools/pre-execute 的判定链上，异常被上层 catch 后返回 deny ——
  // **该次调用被误拒**（可用性损失）。
  ok('★★ F97 wrapper 无带值选项表时不抛异常（否则判定链崩溃 → 误拒）', (() => {
    for (const c of ['command -v rm', 'command -V rm', 'builtin echo x', 'exec echo x', 'nohup echo x', 'setsid echo x', 'stdbuf -o0 echo x', 'ionice -c2 echo x']) {
      try { run(c, 'bash', {}) } catch (e) { return false }
    }
    return true
  })())

  // ★★ F98：`command -v X` 是**查询** X 的位置，不执行它 —— 不得把 X 当命令判。
  // 剥前缀会把 X 当命令，于是 `echo $(command -v rm)` 被判成破坏性命令（实测误报）。
  const f98 = run('echo $(command -v rm)', 'bash', { category: 'allow', destructive: 'deny' })
  ok('★★ F98 command -v 是查询不是执行（不误判 X 为破坏性命令）', f98.action === 'allow', 'action=' + f98.action)
  // 对照：真正的 command 前缀仍要拦
  const f99 = run('command rm -rf /x', 'bash', { category: 'allow', destructive: 'deny' })
  ok('F99 command 前缀的真实破坏性命令仍被拦', f99.action === 'deny', 'action=' + f99.action)

  // ★★ F100~F103：反引号命令替换必须与 `$(...)` 同等待遇。
  // 反引号不是引号而是命令替换定界符，`` `cmd` `` 里的 cmd **会被执行**。
  // 早期 rawCommandNames 没区分它，词法器又把整块当**一个词元**（以反引号开头 → 被
  // BAD_LABEL_CHARS 拒绝），于是段内真命令彻底不可见。实测漏判（大分类 allow + 子设置 deny）：
  //   `echo $(rm -rf ~/.dsh)` → deny（`$()` 的分隔符在切分正则里）
  //   `echo \`rm -rf ~/.dsh\`` → **allow**
  // 修法：把反引号替换成**分隔符**（不是空格 —— 空格会让 `echo \`rm...\`` 变成一个片段，
  // 而每片段只取首词，`rm` 仍被 `echo` 挡住，实测踩过）。
  for (const [label, cmd] of [
    ['F100 反引号在命令后', 'echo `rm -rf ~/.dsh`'],
    ['F101 纯反引号', '`rm -rf ~/.dsh`'],
    ['F102 反引号在管道前', 'echo `rm -rf ~/.dsh` | cat'],
  ]) {
    const r = run(cmd, 'bash', { category: 'allow', destructive: 'deny' })
    ok('★★ ' + label + '：反引号内的破坏性命令仍被拦【' + cmd + '】', r.action === 'deny', 'action=' + r.action)
  }
  // 反引号内的**非破坏性**命令不该被误伤（`node` 不在破坏性名单里，落大分类 = 设计如此 D-4）
  const f103 = run('echo `node -e "x"`', 'bash', { category: 'allow', destructive: 'deny' })
  ok('F103 反引号内的非破坏性命令不误判（node 不在名单，落大分类）',
    f103.action === 'allow' && f103.segments[0].code === 'unparsable', 'action=' + f103.action + ' code=' + f103.segments[0].code)

  // ★★ F104~F107：opaque 段的**例外匹配**必须也试并集提取出的名字。
  // 只试 seg.text 与主 label 会造成不对称：`echo $(rm -rf /x)` 的破坏性子设置能拦
  // （它用 labels 并集），而用户写的 deny 例外 `rm *` 拦不住（例外只看 seg.text 与 `echo`）。
  // 实测漏放：大分类 allow + 子设置 allow + 例外 `rm *`=deny 时，下列形态全部 allow。
  for (const [label, cmd] of [
    ['F104 $() 内', 'echo $(rm -rf /x)'],
    ['F105 反引号内', 'echo `rm -rf /x`'],
    ['F106 case 内', 'case x in a) rm -rf /x;; esac'],
  ]) {
    const r = run(cmd, 'bash', { category: 'allow', destructive: 'allow', exceptions: ['rm *'], excAction: 'deny' })
    ok('★★ ' + label + '：opaque 段仍受 deny 例外约束（例外匹配看得到内层命令）',
      r.action === 'deny', 'action=' + r.action)
  }
  // 反向：ask 例外同样要能看到内层命令（它要求确认，不是授权）
  const f107 = run('echo $(rm -rf /x)', 'bash', { category: 'allow', destructive: 'allow', exceptions: ['rm *'], excAction: 'ask' })
  ok('★ F107 opaque 段仍受 ask 例外约束（确认规则不被规避）', f107.action === 'ask', 'action=' + f107.action)
  // 反向：allow 例外**不得**因并集名字而授权 opaque 段（底线不变）
  const f108 = run('echo $(git status)', 'bash', { category: 'ask', destructive: 'ask', exceptions: ['git status *'], excAction: 'allow' })
  ok('★★ F108 并集名字不得让 allow 例外授权 opaque 段（底线不变）', f108.action !== 'allow', 'action=' + f108.action)

  // ★★ F109~F112：双引号内的命令替换必须被提取。
  // 命令替换（`$(...)` / 反引号）里的内容**会被执行**，而它经常出现在双引号内
  //（`echo "$(rm -rf /x)"` 在 bash 里真的会执行 rm）。
  // 早期实现先剥双引号、再处理命令替换，于是双引号内的内容被连块剥掉 —— 实测漏放。
  // 修法：把命令替换内容**摘出**、剥完引号后再拼回（只换定界符不行：内容仍在引号内，
  // 会被双引号剥离一起吃掉，实测踩过）。
  for (const [label, cmd] of [
    ['F109 双引号内 $()', 'echo "$(rm -rf /x)"'],
    ['F110 双引号内反引号', 'echo "`rm -rf /x`"'],
    ['F111 双引号内带前后缀', 'echo "prefix `rm -rf /x` suffix"'],
    ['F112 双引号内 $() 带后缀', 'echo "$(rm -rf /x)" && true'],
  ]) {
    const r = run(cmd, 'bash', { category: 'allow', destructive: 'deny' })
    ok('★★ ' + label + '：双引号内的命令替换仍被拦【' + cmd + '】', r.action === 'deny', 'action=' + r.action)
  }
  // 反向：单引号内的命令替换**不执行**（纯文本），不得误判
  for (const [label, cmd] of [
    ['F113 单引号内 $()', "echo '$(rm -rf /x)'"],
    ['F114 单引号内反引号', "echo '`rm -rf /x`'"],
    ['F115 双引号内的普通 rm 字样', 'echo "use rm -rf carefully"'],
  ]) {
    const r = run(cmd, 'bash', { category: 'allow', destructive: 'deny' })
    ok('★ ' + label + '：不执行的内容不误判【' + cmd + '】', r.action === 'allow', 'action=' + r.action)
  }

  // ★★ F116~F118：**deny 例外优先于 allow 例外**（allow 命中后不能收工）。
  // 否则「外层命令的 allow 例外」会短路「内层命令的 deny 例外」：
  // 例外 `echo *`=allow + `rm *`=deny 时，`echo $(rm -rf /x)` 曾 allow —— 而用户显式写了 rm 的拒绝。
  // 方向是放宽（fail-open），必须堵。拒绝面取并集、放行面取交集，与段级合并同一原则。
  for (const [label, cmd] of [
    ['F116 $() 内层 deny', 'echo $(rm -rf /x)'],
    ['F117 反引号内层 deny', 'echo `rm -rf /x`'],
    ['F118 双引号内层 deny', 'echo "$(rm -rf /x)"'],
  ]) {
    const r = run(cmd, 'bash', {
      category: 'allow', destructive: 'allow',
      exceptions: ['echo *', 'rm *'], excActions: { 'echo *': 'allow', 'rm *': 'deny' },
    })
    ok('★★ ' + label + '：内层 deny 例外不被外层 allow 短路（必须是 deny）', r.action === 'deny', 'action=' + r.action)
  }
  // 对照：外层命令本身命中 allow 时仍应放行（deny 优先只影响真的命中 deny 的情况）
  const f119 = run('echo hello', 'bash', {
    category: 'allow', destructive: 'allow',
    exceptions: ['echo *', 'rm *'], excActions: { 'echo *': 'allow', 'rm *': 'deny' },
  })
  ok('F119 对照：未命中 deny 的普通命令仍按 allow 例外放行', f119.action === 'allow', 'action=' + f119.action)

  // ★★ F120~F123：**嵌套**命令替换的内层也要可见。
  // 命令替换可以嵌套，每层内容都会被 shell 执行，只展开一层会让内层命令漏掉。
  // 实测（command=allow + destructive=deny）下列形态曾是 allow，而它们在 bash 里合法可执行：
  //   `echo $(echo \`rm -rf /x\`)`        —— $() 内嵌反引号
  //   `echo \`echo \`rm -rf /x\`\``      —— 反引号内用 \` 嵌套
  // 修法：expandSubstitution 先把 `\`` 还原成裸反引号**再**摘取，然后递归。
  for (const [label, cmd] of [
    ['F120 $() 内嵌反引号', 'echo $(echo `rm -rf /x`)'],
    ['F121 反引号内嵌转义反引号', 'echo `echo \\`rm -rf /x\\``'],
    ['F122 $() 嵌套 $()', 'echo $(echo $(rm -rf /x))'],
    ['F123 双引号内嵌套', 'echo "$(echo $(rm -rf /x))"'],
  ]) {
    const r = run(cmd, 'bash', { category: 'allow', destructive: 'deny' })
    ok('★★ ' + label + '：嵌套命令替换的内层仍被拦【' + cmd + '】', r.action === 'deny', 'action=' + r.action)
  }
  // 反向：嵌套但内层是只读命令，不得误伤
  for (const [label, cmd] of [
    ['F124 嵌套只读', 'echo $(echo $(date))'],
    ['F125 嵌套只读反引号', 'echo `echo \\`ls\\``'],
  ]) {
    const r = run(cmd, 'bash', { category: 'allow', destructive: 'deny' })
    ok('★ ' + label + '：嵌套的只读命令不误判【' + cmd + '】', r.action === 'allow', 'action=' + r.action)
  }

  // ★★ F126~F128：**ask 例外同样不被外层 allow 短路**。
  // ask 不是授权而是「要求确认」，被外层 allow 短路等于把「删前问我」降级为静默放行。
  // 与段级合并同原则：拒绝面与确认面取并集，只有放行面取交集
  //（`git status && npm test` 中一段 allow 一段 ask → 整条 ask，已由 I 组钉住）。
  for (const [label, cmd] of [
    ['F126 $() 内层 ask', 'echo $(rm -rf /x)'],
    ['F127 反引号内层 ask', 'echo `rm -rf /x`'],
    ['F128 嵌套内层 ask', 'echo $(echo $(rm -rf /x))'],
  ]) {
    const r = run(cmd, 'bash', {
      category: 'allow', destructive: 'allow',
      exceptions: ['echo *', 'rm *'], excActions: { 'echo *': 'allow', 'rm *': 'ask' },
    })
    ok('★★ ' + label + '：内层 ask 例外不被外层 allow 短路（必须是 ask）', r.action === 'ask', 'action=' + r.action)
  }
  // 对照：deny 仍然压过 ask
  const f129 = run('echo $(rm -rf /x)', 'bash', {
    category: 'allow', destructive: 'allow',
    exceptions: ['echo *', 'rm *'], excActions: { 'echo *': 'ask', 'rm *': 'deny' },
  })
  ok('F129 对照：内层 deny 压过外层 ask（拒绝面优先）', f129.action === 'deny', 'action=' + f129.action)

  // ★★ F130~F135：**可读段**（非 opaque）的例外匹配也必须试全部 label。
  //
  // 上面 F104~F108 只覆盖了 opaque 段。可读段曾经是另一条独立代码路径，且**没试额外 label** ——
  // 于是出现不对称：破坏性子设置用 labels 并集（能看到 `find -exec rm` 里的 rm），
  // 而例外匹配只看「段原文 + 主 label」（主 label 是 `find`）→ 用户的 deny 例外拦不住。
  // 实测（例外 `rm *`=deny + 子设置 allow，即只有例外能拦）：
  //   `rm -rf /x`                → deny（例外命中）
  //   `find . -exec rm -rf {} +` → **allow** ← 用户显式写的「rm 一律拒绝」被绕过
  //   `find . -delete`           → **allow**
  // 修法：例外匹配抽成单一实现 resolveException，opaque 段与可读段共用、都试全部 label。
  // 这正是「单一来源」的又一次应用：两段各写一份实现时，一份修了、另一份没修，行为就分叉。
  for (const [label, cmd] of [
    ['F130 find -exec rm', 'find . -exec rm -rf {} +'],
    ['F131 find -exec rm (;)', 'find . -exec rm -rf {} \\;'],
    ['F132 find -delete', 'find . -delete'],
    ['F133 time find -delete', 'time find . -delete'],
    ['F134 find -exec env rm', 'find . -exec env rm -rf {} \\;'],
  ]) {
    const r = run(cmd, 'bash', { category: 'allow', destructive: 'allow', exceptions: ['rm *'], excAction: 'deny' })
    ok('★★ ' + label + '：可读段也试额外 label，deny 例外拦得住（与子设置视野对称）【' + cmd + '】',
      r.action === 'deny', 'action=' + r.action + ' labels=' + JSON.stringify(r.segments.map((s) => s.label)))
  }
  // 反向：额外 label 不得让**无关**例外命中（不得引入误报）
  for (const [label, cmd] of [
    ['F135 find -name', 'find . -name "*.log"'],
    ['F136 find -exec echo', 'find . -exec echo {} +'],
    ['F137 find -exec ls', 'find . -exec ls {} +'],
  ]) {
    const r = run(cmd, 'bash', { category: 'allow', destructive: 'allow', exceptions: ['rm *'], excAction: 'deny' })
    ok('F-反向 ' + label + '：不被无关的 rm 例外命中【' + cmd + '】', r.action === 'allow', 'action=' + r.action)
  }
}

// ═════════════════════════════════════════════════════════════════════════════
group('G. 误报回归（必须仍然免审 —— 修好 D3）')
{
  const g = [
    ['G1 git log --format=oneline', 'git log --format=oneline', 'git log *'],
    ['G2 git log --pretty=format:%h', 'git log --pretty=format:%h', 'git log *'],
    ['G3 docker ps --format json', 'docker ps --format json', 'docker ps *'],
    ['G4 Get-Process | Format-Table', 'Get-Process | Format-Table', ['Get-Process *', 'Format-Table *']],
    ['G5 npm run format', 'npm run format', 'npm run format *'],
    ['G6 grep -r "attrib" .', 'grep -r "attrib" .', 'grep *'],
    ['G7 echo "takeown"', 'echo "takeown"', null],
  ]
  for (const [label, cmd, exc] of g) {
    const opts = exc ? { exceptions: Array.isArray(exc) ? exc : [exc] } : { exceptions: [], category: 'allow' }
    const r = run(cmd, 'bash', opts)
    ok(label + ' 不再被误判危险', r.segments.every((s) => s.code !== 'destructive'), JSON.stringify(r.segments.map((s) => ({ t: s.text, l: s.label, c: s.code }))))
    ok(label + ' 仍能免审', r.action === 'allow', 'action=' + r.action + ' ' + JSON.stringify(r.segments.map((s) => ({ t: s.text, l: s.label, c: s.code }))))
  }
  // Get-Process | Format-Table 的第二段 label 必须是 format-table（不是 format）
  const g4 = run('Get-Process | Format-Table', 'bash', { exceptions: ['Get-Process *'] })
  ok('G8 Format-Table 的 label 不归一成 format', g4.segments[1].label === 'format-table', JSON.stringify(g4.segments[1]))
  ok('G9 管道第二段未命中例外 → 整行不静默放行', g4.action !== 'allow', 'action=' + g4.action)
}

// ═════════════════════════════════════════════════════════════════════════════
group('H. 正常免审（不得过度收紧）')
{
  const h = [
    ['H1 git status', 'git status', 'git status *'],
    ['H2 git status --short', 'git status --short', 'git status *'],
    ['H3 git status -sb', 'git status -sb', 'git status *'],
    ['H4 Get-ChildItem -Recurse', 'Get-ChildItem -Recurse', 'Get-ChildItem *'],
    ['H5 node --check x.js', 'node --check x.js', 'node --check *'],
    ['H6 git commit -m（无通配符例外）', 'git commit -m "fix bug"', 'git commit -m'],
    ['H7 git status（无通配符例外）', 'git status', 'git status'],
  ]
  for (const [label, cmd, exc] of h) {
    const r = run(cmd, 'bash', { exceptions: [exc] })
    ok(label + ' 仍免审', r.action === 'allow', 'action=' + r.action + ' ' + JSON.stringify(r.segments))
  }
  // 无通配符例外走词边界精确：`git status` 不该匹配 `git statusx`
  const h8 = run('git statusx', 'bash', { exceptions: ['git status'] })
  ok('H8 无通配符例外不匹配更长的命令名（词边界）', h8.action !== 'allow', 'action=' + h8.action)
  // `log` 不再命中 `dialog --msgbox "rm -rf /"`（修好 D5）
  const h9 = run('dialog --msgbox "rm -rf /"', 'bash', { exceptions: ['log'] })
  ok('★ H9 例外 log 不再子串命中 dialog（修好 D5）', h9.action !== 'allow', 'action=' + h9.action)
  const h10 = run('echo hi > /tmp/x; npm publish', 'bash', { exceptions: ['npm'] })
  ok('★ H10 例外 npm 不再子串命中 echo（修好 D5）', h10.action !== 'allow', 'action=' + h10.action)
}

// ═════════════════════════════════════════════════════════════════════════════
group('I. 部分覆盖（不得整条放行）')
{
  const i1 = run('git status && npm publish', 'bash', { exceptions: ['git status *'] })
  ok('I1 git status 有例外、npm 无 → 整行不静默放行', i1.action !== 'allow', 'action=' + i1.action)
  ok('I2 第一段 allow、第二段落分类', i1.segments[0].action === 'allow' && i1.segments[1].source === 'category', JSON.stringify(i1.segments.map((s) => s.source)))
  const i3 = run('cd /tmp && rm -rf ~/.dsh', 'bash', { exceptions: ['cd *'] })
  ok('I3 cd 有例外、rm 无 → 整行不静默放行', i3.action !== 'allow', 'action=' + i3.action)
  const i4 = run('echo x && git push --force', 'bash', { exceptions: ['echo *'] })
  ok('I4 echo 有例外、git push 无 → 整行不静默放行', i4.action !== 'allow', 'action=' + i4.action)
  // 全部段命中例外才 all-allow
  const i5 = run('git status && git log', 'bash', { exceptions: ['git status *', 'git log *'] })
  ok('I5 全部段命中例外 → all-allow', i5.action === 'allow' && i5.code === 'all-allow', 'action=' + i5.action + ' code=' + i5.code)
  // 一段 deny 即整行 deny（fail-closed 合并）
  const i6 = run('git status && rm -rf x', 'bash', { exceptions: ['git status *', 'rm *'], excAction: 'deny' })
  ok('I6 任一段 deny → 整行 deny', i6.action === 'deny' && i6.code === 'segment-deny', 'action=' + i6.action + ' code=' + i6.code)
}

// ═════════════════════════════════════════════════════════════════════════════
group('J. 子设置可配置性')
{
  const j1 = run('rm -rf x', 'bash', { destructive: 'allow' })
  ok('J1 destructive=allow 时 rm 放行（用户知情放开）', j1.action === 'allow', 'action=' + j1.action)
  const j2 = run('rm -rf x', 'bash', { destructive: 'deny', destructiveReason: '不许删' })
  ok('J2 destructive=deny 时 rm 直接拒绝', j2.action === 'deny', 'action=' + j2.action)
  ok('J3 拒绝理由取自子设置 reason', j2.reason === '不许删', JSON.stringify(j2.reason))
  const j4 = run('some-unknown-tool --flag', 'bash', { category: 'deny' })
  ok('J4 大分类 deny 时普通命令也拒绝（大分类仍生效）', j4.action === 'deny', 'action=' + j4.action)
  // 反过来：破坏性命令在大分类 deny 下仍是子设置优先（更细的判定优先于更粗的）
  const j4b = run('rm -rf x', 'bash', { category: 'deny', destructive: 'allow' })
  ok('J4b 子设置（更细）优先于大分类（更粗）—— 即使大分类是 deny', j4b.action === 'allow', 'action=' + j4b.action)
  // 用户例外优先于子设置（D-5）
  const j5 = run('rm -rf /tmp/x', 'bash', { exceptions: ['rm -rf /tmp/*'] })
  ok('★ J5 用户例外优先于 destructive 子设置（D-5）', j5.action === 'allow' && j5.segments[0].source === 'exception', JSON.stringify(j5.segments[0]))
  // 名单固定，不开放用户增删（D-12）
  ok('J6 destructive.labels 不存在（名单固定，只有 action/reason 可配）', !Object.prototype.hasOwnProperty.call(run('rm -rf x'), 'labels'))
  ok('J7 DESTRUCTIVE_LABELS 是内置 Set 且不可被外部改写语义', DESTRUCTIVE_LABELS instanceof Set && DESTRUCTIVE_LABELS.has('rm') && !DESTRUCTIVE_LABELS.has('mv'))
  ok('J8 刻意不列入：mv / cp / Set-Content / git push / npm publish', !['mv', 'cp', 'set-content', 'out-file', 'new-item', 'copy-item', 'tee', 'git push', 'npm publish'].some((l) => DESTRUCTIVE_LABELS.has(l)))
  // 子设置 reason 只在 deny 时下发
  const j9 = run('rm -rf x', 'bash', { destructive: 'ask', destructiveReason: '不该出现' })
  ok('J9 ask 时子设置的 reason 不下发（与分类同口径）', j9.reason === null, JSON.stringify(j9.reason))
  // unparsable 段动作 = 分类默认值（D-4）
  const j10 = run('git status $(x)', 'bash', { category: 'allow', destructive: 'deny' })
  ok('J10 unparsable 段不受 destructive 子设置影响（D-4）', j10.action === 'allow', 'action=' + j10.action)
}

// ═════════════════════════════════════════════════════════════════════════════
group('K. 辅助函数')
{
  ok('K1 matchCommand 词边界精确：相等', matchCommand('git status', 'git status') === true)
  ok('K2 matchCommand 词边界精确：带参数', matchCommand('git commit -m', 'git commit -m "x"') === true)
  ok('K3 matchCommand 词边界精确：更长的命令名不匹配', matchCommand('git status', 'git statusx') === false)
  ok('K4 matchCommand 词边界精确：中间子串不匹配', matchCommand('log', 'dialog --msgbox "rm -rf /"') === false)
  ok('K5 matchCommand 通配：尾随 *', matchCommand('git status *', 'git status --short') === true)
  ok('K6 matchCommand 通配：尾随 * 也覆盖无参数', matchCommand('git status *', 'git status') === true)
  // 这条是**有意的行为记录**，不是缺陷：`cmd *` 的 `.*` 天生能吞掉后面的操作符，
  // 所以防线不在正则里，而在「用它匹配的是单个命令段」（§3.5.3）。
  // 下面 K7b 断言段级调用确实拦住了 —— 两者合起来才是完整论证。
  ok('K7 matchCommand 通配：正则本身仍会吞操作符（防线在段级调用，不在正则）', matchCommand('git status *', 'git status && rm -rf x') === true)
  ok('K7b 但按段调用时它够不到第二段（assessCommand 的实际用法）', (() => {
    const r = run('git status && rm -rf x', 'bash', { exceptions: ['git status *'] })
    return r.segments[0].action === 'allow' && r.segments[1].action !== 'allow'
  })())
  ok('K8 matchCommand 空模式不匹配任何命令', matchCommand('', 'git status') === false)
  ok('K9 matchCommand 大小写不敏感', matchCommand('Git Status', 'git status --short') === true)

  ok('K10 segmentLabel 剥路径与 .exe', segmentLabel(['C:\\Windows\\System32\\rm.exe', '-rf', 'x']) === 'rm')
  ok('K11 segmentLabel 路由器取子命令', segmentLabel(['git', 'status', '--short']) === 'git status')
  ok('K12 segmentLabel 路由器跳过带值选项', segmentLabel(['git', '-c', 'user.name=x', 'commit']) === 'git commit')
  ok('K13 segmentLabel PS 关键字继续向后找', segmentLabel(['foreach', '($x', 'in', '$y)', 'Remove-Item', '$x']) === 'remove-item')
  ok('K14 segmentLabel 变量开头认不出', segmentLabel(['$cmd', '-rf', 'x']) === '')
  ok('K15 segmentLabel 空段', segmentLabel([]) === '')
  ok('K16 segmentLabel 不剥无 wrapper 的普通命令', segmentLabel(['rm', '-rf', 'x']) === 'rm')
  ok('K17 segmentLabel 剥 wrapper 后仍认出 rm', segmentLabel(['env', '-u', 'FOO', 'rm', '-rf', '/x']) === 'rm')
  ok('K18 segmentLabel 剥前导赋值', segmentLabel(['BLAH=0', 'sudo', 'ls']) === 'sudo')
  ok('K19 segmentLabel env -S 判读不懂', segmentLabel(['env', '-S', 'rm -rf x']) === '')

  ok('K20 isDestructiveLabel 空 label 恒 false', isDestructiveLabel('') === false)
  ok('K21 isDestructiveLabel 大小写不敏感', isDestructiveLabel('RM') === true)

  ok('K22 expandTilde 展开 ~', expandTilde('~/x', 'C:/Users/me') === 'C:/Users/me/x')
  ok('K23 expandTilde ~user 返回 null（他人 home）', expandTilde('~bob/x', 'C:/Users/me') === null)
  ok('K24 expandTilde home 未知时 ~/x 返回 null', expandTilde('~/x', null) === null)
  ok('K25 expandTilde 普通路径原样', expandTilde('a/b', 'C:/Users/me') === 'a/b')

  ok('K26 globRootOf 归约到最深不可逃逸目录', globRootOf('/a/b/*') === '/a/b')
  ok('K27 globRootOf 无通配原样返回', globRootOf('/a/b') === '/a/b')
  ok('K28 globRootOf /* 归约到根', globRootOf('/*') === '/')
  ok('K29 globRootOf B:* 归约到盘符', globRootOf('B:*') === 'B:')

  ok('K30 unwrapWords 剥前导赋值（值可为空）', unwrapWords(['FOO=', 'sudo', 'ls']).words.join(' ') === 'sudo ls')
  ok('K31 unwrapWords 剥 timeout 带值 flag 与时长', unwrapWords(['timeout', '-s', 'KILL', '5', 'sudo', 'ls']).words.join(' ') === 'sudo ls')
  ok('K32 unwrapWords env -S 判读不懂', unwrapWords(['env', '-S', 'x']).opaque === true)
  ok('K33 unwrapWords 不剥非 wrapper', unwrapWords(['rm', '-rf', 'x']).words.join(' ') === 'rm -rf x')

  ok('K34 flagEmbeddedPath 长选项 =', flagEmbeddedPath('--output=B:/abs') === 'B:/abs')
  ok('K35 flagEmbeddedPath 融合短选项', flagEmbeddedPath('-oB:/abs') === 'B:/abs')
  ok('K36 flagEmbeddedPath 非路径值不取', flagEmbeddedPath('--pretty=format:%h') === undefined)
  ok('K37 flagEmbeddedPath 数值不取', flagEmbeddedPath('--parallel=2') === undefined)

  ok('K38 looksLikeExplicitPath 点开头', looksLikeExplicitPath('.env') === true)
  ok('K39 looksLikeExplicitPath 中段 ..', looksLikeExplicitPath('b/../../x') === true)
  ok('K40 looksLikeExplicitPath 普通词元 false', looksLikeExplicitPath('status') === false)

  ok('K41 tildeUserTarget ~user 为真', tildeUserTarget('~bob/x') === true && tildeUserTarget('~/x') === false)
  ok('K42 isNullSink 三态', isNullSink('/dev/null', 'bash') === true && isNullSink('$null', 'pwsh') === true && isNullSink('out.txt', 'bash') === false)
  ok('K43 SHELL_OF_TOOL 单一来源', SHELL_OF_TOOL.pwsh === 'pwsh' && SHELL_OF_TOOL.bash === 'bash' && Object.keys(SHELL_OF_TOOL).length === 2)
  ok('K44 assessCommand 不抛异常（畸形输入）', (() => {
    for (const s of [null, undefined, '', '   ', '"', "'", '\\', '$', '`', '(((', '|||', '>>>', '<<<']) {
      try { assessCommand(s, 'bash', hooks()) } catch (e) { return false }
    }
    return true
  })())
}

// ═════════════════════════════════════════════════════════════════════════════
group('L. 爆炸半径（blast radius）：这一下会删掉多大范围')
{
  // 判定链只回答「要不要问」，不回答「这一下有多重」—— 而审批人恰恰只能靠后者决定
  // 点不点。下面两个目标的动作与候选完全相同，面板上看起来毫无区别：
  //     rmdir /s /q B:\                       ← 整个盘
  //     rmdir /s /q B:\demo-app\build    ← 一个构建目录
  // 本组把分档判据钉住。盘符用 B:（本机不存在该盘），示例不会被误当成真实目标。
  const bOpts = { home: HOME, isOutsideWorkspace: (p) => {
    const raw = String(p).replace(/\\/g, '/')
    const abs = (raw.startsWith('/') || /^[a-zA-Z]:/.test(raw)) ? raw : WS + '/' + raw
    const s = abs.toLowerCase()
    return !(s === WS.toLowerCase() || s.startsWith(WS.toLowerCase() + '/'))
  } }
  const lvl = (t) => { const r = blastRadiusOf(t, bOpts); return r ? r.level : null }

  // L1–L6 盘根：三种写法都要认出来（这是最严重的一档，漏一个就等于没做）
  ok('L1 盘根 B:\\ → drive-root', lvl('B:\\') === 'drive-root', String(lvl('B:\\')))
  ok('L2 盘根 B:/ → drive-root', lvl('B:/') === 'drive-root', String(lvl('B:/')))
  ok('L3 POSIX 根 / → drive-root', lvl('/') === 'drive-root', String(lvl('/')))
  ok('L4 双反斜杠 \\\\ → drive-root', lvl('\\\\') === 'drive-root', String(lvl('\\\\')))
  // ★ 关键：`B:\*` 归约后就是盘根 —— 这正是「先归约 glob 再判档」的理由。
  //   若因为「含通配符所以不判」，恰好漏掉最该警告的形态（实测过）。
  ok('★ L5 盘根通配 B:\\* → drive-root（glob 先归约再判，不得因含通配而跳过）',
    lvl('B:\\*') === 'drive-root', String(lvl('B:\\*')))
  // 反面：盘根下的普通目录**不是**盘根（否则这一档会淹没在误报里）
  ok('L6 盘根下的目录不是盘根', lvl('B:\\demo-app') !== 'drive-root', String(lvl('B:\\demo-app')))

  // L7–L11 系统目录
  ok('L7 C:\\Windows → system', lvl('C:\\Windows') === 'system', String(lvl('C:\\Windows')))
  ok('L8 C:\\Windows\\System32 → system', lvl('C:\\Windows\\System32') === 'system', String(lvl('C:\\Windows\\System32')))
  ok('L9 /usr/bin → system', lvl('/usr/bin') === 'system', String(lvl('/usr/bin')))
  ok('L10 /etc → system', lvl('/etc') === 'system', String(lvl('/etc')))
  ok('L11 无盘符形态 Windows\\System32 → system', lvl('Windows\\System32') === 'system', String(lvl('Windows\\System32')))

  // ★★ L12 家目录必须**先于**系统目录判定：SYSTEM_DIR_RE 里有 `users`，
  //    而 C:/Users/me 同时匹配它 —— 顺序写反会把家目录误标成「系统目录」（实测复现）。
  ok('★★ L12 家目录优先于系统目录（users 同时匹配两条，更具体的先判）',
    lvl(HOME) === 'home' && lvl('~') === 'home', JSON.stringify({ abs: lvl(HOME), tilde: lvl('~') }))
  // 家目录下的普通子目录不算家目录本身（否则每个项目文件都会被标成「家目录」）
  ok('L13 家目录下的子目录不是 home', lvl(HOME + '/Documents/x.txt') !== 'home', String(lvl(HOME + '/Documents/x.txt')))

  // L14–L16 工作区外 / 工作区内
  ok('L14 工作区外 → outside', lvl('B:\\demo-app\\build') === 'outside', String(lvl('B:\\demo-app\\build')))
  ok('L15 工作区内 → inside', lvl('X:\\ws\\x') === 'inside', String(lvl('X:\\ws\\x')))
  ok('L16 相对路径按工作区根绝对化后判 inside', lvl('./build') === 'inside', String(lvl('./build')))

  // L17–L19 读不出位置时**不猜**（返回 null，而不是硬套一档）
  ok('L17 变量目标不判档（$env:TEMP）', lvl('$env:TEMP') === null, String(lvl('$env:TEMP')))
  ok('L18 命令替换不判档', lvl('`pwd`') === null, String(lvl('`pwd`')))
  ok('L19 空串不判档', lvl('') === null, String(lvl('')))

  // ── 段级汇总 ──────────────────────────────────────────────────────────────
  // 段级判档只需 **platform** 这一个维度：
  //   · platform —— 决定查哪一套系统目录名单、`/x` 是不是 cmd 开关
  // Linux 上跑 PowerShell Core 时是 pwsh 工具 + posix 路径，故**不能按方言推平台**。
  // 注意 opts 里**不传 shell**：判档函数从不读它（方言只影响词法器那一层的分段，
  // 而这里拿到的是已经分好的词元）。曾经在这里传过 `shell: 'pwsh'|'bash'` 并注释
  // 「必须带方言 + 平台」，但那是只写不读的死键 —— regressions.mjs 还有一条断言
  // 专门禁止 `opts.shell` 复活，两处口径原本互相矛盾。
  const bOptsPwsh = Object.assign({}, bOpts, { platform: 'win32' })
  const bOptsBash = Object.assign({}, bOpts, { platform: 'posix' })
  const seg = (w) => { const r = blastRadiusOfSegment(w, bOptsPwsh); return r ? r.level : null }
  const segBash = (w) => { const r = blastRadiusOfSegment(w, bOptsBash); return r ? r.level : null }
  ok('★ L20 段级：rmdir /s /q B:\\ → drive-root', seg(['rmdir', '/s', '/q', 'B:\\']) === 'drive-root', String(seg(['rmdir', '/s', '/q', 'B:\\'])))
  ok('L21 段级：rm -rf / → drive-root', seg(['rm', '-rf', '/']) === 'drive-root', String(seg(['rm', '-rf', '/'])))
  ok('L22 段级：del /f /s /q B:\\* → drive-root', seg(['del', '/f', '/s', '/q', 'B:\\*']) === 'drive-root', String(seg(['del', '/f', '/s', '/q', 'B:\\*'])))
  ok('L23 段级：Remove-Item -Recurse -Force C:\\Windows → system', seg(['Remove-Item', '-Recurse', '-Force', 'C:\\Windows']) === 'system', String(seg(['Remove-Item', '-Recurse', '-Force', 'C:\\Windows'])))
  ok('L24 段级：工作区内的相对目标 → null（不警告）', seg(['rm', '-rf', './build']) === null, String(seg(['rm', '-rf', './build'])))
  // ★★ L25 **命令名本身不是删除目标**。`rm` 会被 blastRadiusOf 当成一个路径；
  //     而相对路径在工作区外判定下**可能**算「外」—— 于是命令名会被误报成删除目标。
  //     这里必须用**命令名恰好是工作区外形态**的用例才能测出来：
  //     实测 `rm -rf ./build` 在这个钩子下判为 inside（故它与「不跳过」结果相同，
  //     拿它当判据是空转 —— 变异测试证实「不跳过命令名」会漏网）。
  //     故用 `git rm ...`：有效命令名是 `git rm`（含空格），而它的**首词元**是 `git`，
  //     且 w[0] 是 `rmdir` 这类**盘根下的绝对形态**更直接 —— 见下面 L25b 的构造。
  ok('★★ L25 段级：命令名不被当成删除目标（rm -rf ./build 不得误报）',
    seg(['rm', '-rf', './build']) === null && seg(['rm']) === null && seg(['diskpart']) === null,
    JSON.stringify({ build: seg(['rm', '-rf', './build']), bare: seg(['rm']), dp: seg(['diskpart']) }))
  // ★★ L25b 构造一个「命令名本身会被判成危险目标」的用例，否则 L25 是空转：
  //   钩子把**非绝对路径**按工作区根绝对化，但 `C:\Windows` 这类绝对路径直接判「外」。
  //   于是只要命令名长得像绝对路径（`C:\Windows\...\rm`，即从系统目录里调 rm），
  //   不跳过它就会把命令名判成 system —— 这正是「跳过命令名」要防的误报。
  const segAbs = (w) => { const r = blastRadiusOfSegment(w, bOpts); return r ? r.level : null }
  ok('★★ L25b 段级：命令名是绝对路径形态时也不当目标（C:\\Windows\\System32\\rm.exe -rf x）',
    segAbs(['C:\\Windows\\System32\\rm.exe', '-rf', './build']) === null,
    String(segAbs(['C:\\Windows\\System32\\rm.exe', '-rf', './build'])))
  // wrapper 之后的有效命令名同样要跳过（只跳 w[0] 会漏）
  ok('★★ L26 段级：wrapper 后的有效命令名也被跳过（env FOO=1 rm -rf ./build）',
    seg(['env', 'FOO=1', 'rm', '-rf', './build']) === null, String(seg(['env', 'FOO=1', 'rm', '-rf', './build'])))
  ok('L27 段级：多目标取最严重的一档', seg(['rm', '-rf', 'B:\\demo-app\\build', 'C:\\Windows']) === 'system',
    String(seg(['rm', '-rf', 'B:\\demo-app\\build', 'C:\\Windows'])))

  // ── 与 assessCommand 的接线：blast 随段下发 ───────────────────────────────
  const rA = run('rmdir /s /q B:\\', 'pwsh')
  ok('★ L28 assessCommand：段上带 blast（drive-root）',
    !!rA.segments[0].blast && rA.segments[0].blast.level === 'drive-root', JSON.stringify(rA.segments[0].blast))
  ok('L29 assessCommand：普通目录目标不带 blast', run('rmdir /s /q X:\\ws\\x', 'pwsh').segments[0].blast === null,
    JSON.stringify(run('rmdir /s /q X:\\ws\\x', 'pwsh').segments[0].blast))
  // ★ L30 只在**破坏性**段上算：`echo B:\` 不是删除，给它警告就是噪音（狼来了）。
  //     注意方言：bash 下 `echo B:\` 的尾反斜杠是转义符、段会变成读不懂的形态（实测
  //     segments[0] 为 undefined），故用 pwsh 侧 + 一个明确非破坏性的命令来验。
  ok('★ L30 assessCommand：非破坏性段不算 blast（echo 与 git status 都不带警告）',
    run('echo B:\\', 'pwsh').segments[0].blast === null && run('git status', 'bash').segments[0].blast === null,
    JSON.stringify({ echo: run('echo B:\\', 'pwsh').segments[0].blast, git: run('git status', 'bash').segments[0].blast }))
  // ★★ L31 动作**不受** blast 影响：它只提供信息，不改变判定（否则「清空系统临时目录」
  //     这类合法操作会被一并堵死，而盘根判定必然有边界情形 —— 该由人来判断）。
  const rCatAllow = run('rmdir /s /q B:\\', 'pwsh', { category: 'allow', destructive: 'allow' })
  ok('★★ L31 blast 不改变动作（destructive=allow 时盘根删除仍按配置放行，只加警告）',
    rCatAllow.action === 'allow' && rCatAllow.segments[0].blast.level === 'drive-root',
    JSON.stringify({ action: rCatAllow.action, blast: rCatAllow.segments[0].blast }))

  // ── L32–L36 回归：本次修复钉住的四条边界 ────────────────────────────────────
  //
  // ★★ L32 **bash 方言下 POSIX 绝对路径不得被当成 cmd 开关跳过**。
  //    旧判据 `/^[-/][a-z]/i` 把 `/etc`、`/usr`、`/var`、`/home`、`/opt` 全吞掉
  //    （首字母恰好是字母），于是整条 POSIX 侧的段级 blast 恒为 null ——
  //    而 Windows 侧用反斜杠不匹配该正则，故这个洞精确地只漏 Linux/macOS。
  //    必须用**段级**用例：L7/L9/L10 只测 blastRadiusOf 单项，覆盖不到这个分支。
  //    bash 方言是真实场景（`rm -rf /etc` 走 bash 工具，见 SHELL_OF_TOOL）。
  ok('★★ L32 段级(bash)：POSIX 绝对路径仍被判档（/etc → system，不得被当开关跳过）',
    segBash(['rm', '-rf', '/etc']) === 'system' && segBash(['rm', '-rf', '/usr/bin']) === 'system'
    && segBash(['rm', '-rf', '/var']) === 'system' && segBash(['rm', '-rf', '/opt/x']) === 'system',
    JSON.stringify({ etc: segBash(['rm', '-rf', '/etc']), usrbin: segBash(['rm', '-rf', '/usr/bin']),
      var: segBash(['rm', '-rf', '/var']), opt: segBash(['rm', '-rf', '/opt/x']) }))
  // 反面：cmd 开关仍须跳过（否则 `rmdir /s /q` 的 `/s` `/q` 会被当目标判档）
  ok('★ L33 段级(pwsh)：cmd 开关（/s /q /f）仍被跳过，不被当成路径目标',
    seg(['rmdir', '/s', '/q']) === null && seg(['del', '/f', '/s', '/q']) === null,
    JSON.stringify({ rmdir: seg(['rmdir', '/s', '/q']), del: seg(['del', '/f', '/s', '/q']) }))
  // ★★ L33b **cmd 的长开关（3+ 字母）也必须跳过**。
  //    这里曾经按「1–2 个字母算开关、3+ 算路径」猜：`/grant`、`/pid`、`/mir`、`/delete`
  //    被当成路径目标，把「工作区内的一次 icacls/taskkill」错报成
  //    「目标在工作区之外（/grant）」—— 凭空造出假警告。判据必须是方言，不是字母个数。
  ok('★★ L33b 段级(pwsh)：cmd 长开关（/grant /pid /mir /delete）不被当成路径目标',
    seg(['icacls', 'X:\\ws\\x', '/grant', 'Users:F']) === null
    && seg(['taskkill', '/f', '/pid', '1234']) === null
    && seg(['robocopy', 'X:\\ws\\a', 'X:\\ws\\b', '/mir']) === null
    && seg(['net', 'user', 'bob', '/delete']) === null,
    JSON.stringify({ icacls: seg(['icacls', 'X:\\ws\\x', '/grant', 'Users:F']),
      taskkill: seg(['taskkill', '/f', '/pid', '1234']),
      robocopy: seg(['robocopy', 'X:\\ws\\a', 'X:\\ws\\b', '/mir']),
      net: seg(['net', 'user', 'bob', '/delete']) }))

  // ★★ L42 **平台与方言是两个独立维度，不能互相代替**。
  //
  //    Linux/macOS 上跑 PowerShell Core（DSH 的 pwsh 工具在非 win32 平台会回退到 PATH
  //    查找 pwsh，见 dsh-pwsh-local 的 resolvePwshPath）时，组合是 **pwsh + posix**：
  //    方言是 pwsh，但路径是 POSIX 的 `/etc`。
  //
  //    这里曾经按**方言**判「`/x` 是不是 cmd 开关」，于是 pwsh + posix 下
  //    `rm -rf /etc`、`/usr/bin`、`/home/u` 全被当开关跳过、段级 blast 静默 ——
  //    而同一台机器用 bash 工具就正确判 system。反过来，混装一张系统目录名单会让
  //    Linux 上把 `C:\Windows` 判成 system（它只是名字古怪的相对路径）。
  const posixPwsh = Object.assign({}, bOpts, { platform: 'posix' })
  const pSeg = (w) => { const r = blastRadiusOfSegment(w, posixPwsh); return r ? r.level : null }
  ok('★★ L42 pwsh + posix（Linux 上的 PowerShell Core）：POSIX 系统目录仍被判档，不得静默',
    pSeg(['rm', '-rf', '/etc']) === 'system' && pSeg(['rm', '-rf', '/usr/bin']) === 'system'
    && pSeg(['rm', '-rf', '/var']) === 'system' && pSeg(['rm', '-rf', '/boot']) === 'system',
    JSON.stringify({ etc: pSeg(['rm', '-rf', '/etc']), usrbin: pSeg(['rm', '-rf', '/usr/bin']),
      v: pSeg(['rm', '-rf', '/var']), boot: pSeg(['rm', '-rf', '/boot']) }))
  // 反面：Linux 上不得把 Windows 名当系统目录（那只是名字带反斜杠的相对路径）
  ok('★★ L42b posix 平台不认 Windows 系统目录名（C:\\Windows → 非 system）',
    pSeg(['rm', '-rf', 'C:\\Windows']) !== 'system' && pSeg(['rm', '-rf', 'C:\\Windows\\System32']) !== 'system',
    JSON.stringify({ win: pSeg(['rm', '-rf', 'C:\\Windows']), sys32: pSeg(['rm', '-rf', 'C:\\Windows\\System32']) }))
  // 反面：Windows 上不得把 POSIX 名当系统目录（`/etc` 在 Windows 是「当前盘根下的 etc」）
  ok('★★ L42c win32 平台不认 POSIX 系统目录名（/etc 不是 Windows 系统目录）',
    seg(['rm', '-rf', '/etc']) !== 'system' && seg(['rm', '-rf', '/usr/bin']) !== 'system',
    JSON.stringify({ etc: seg(['rm', '-rf', '/etc']), usr: seg(['rm', '-rf', '/usr/bin']) }))
  // 平台未知时 fail-safe：两张表都查（宁可多警告，不可静默漏报）
  const noPlat = Object.assign({}, bOpts)
  const nSeg = (w) => { const r = blastRadiusOfSegment(w, noPlat); return r ? r.level : null }
  ok('★★ L42d 平台未知时 fail-safe（Windows 名与 POSIX 名都判，不漏报）',
    nSeg(['rm', '-rf', 'C:\\Windows']) === 'system' && nSeg(['rm', '-rf', '/etc']) === 'system',
    JSON.stringify({ win: nSeg(['rm', '-rf', 'C:\\Windows']), posix: nSeg(['rm', '-rf', '/etc']) }))
  // ★★ L42e POSIX 名单**不得含 `home`/`Users`**：它们是「用户目录的父目录」，不是系统目录本身。
  //    收进去会让「工作区位于家目录下」这一常态（Linux `/home/<u>/...`、macOS `/Users/<u>/...`）
  //    的所有工作区内绝对路径被判 system —— 实测 `rm -rf /home/u/code/webapp/build` 曾被判
  //    system，而同样目标写成 `./build` 就是 inside（同一件事因写法不同结论相反）。
  //    这与 Windows 侧 `C:\Users` 的收窄是同一个模式（见 USER_ROOT_RE）。
  //    家目录本身仍须判 home（由 userHome 比对负责，不靠系统目录名单兜）。
  const posixHomeOpts = Object.assign({}, bOpts, { platform: 'posix', userHome: '/home/u' })
  const phSeg = (w) => { const r = blastRadiusOfSegment(w, posixHomeOpts); return r ? r.level : null }
  ok('★★ L42e POSIX 家目录下的工作区目标不误报 system（/home/u/code/webapp/build → 非 system）',
    phSeg(['rm', '-rf', '/home/u/code/webapp/build']) !== 'system'
    && phSeg(['rm', '-rf', '/home/u/code/webapp/node_modules']) !== 'system',
    JSON.stringify({ build: phSeg(['rm', '-rf', '/home/u/code/webapp/build']),
      nm: phSeg(['rm', '-rf', '/home/u/code/webapp/node_modules']) }))
  ok('★ L42f POSIX 家目录本身仍判 home（不因名单收窄而漏掉）',
    phSeg(['rm', '-rf', '/home/u']) === 'home',
    String(phSeg(['rm', '-rf', '/home/u'])))

  // ★★ L34 **工作区内的普通相对目录名不得被判成系统目录**。
  //    旧 SYSTEM_DIR_RE 的 `[\\/]*` 可匹配空串，且名单含 bin/lib/etc/var/opt 等短通用名，
  //    于是 `rm -rf lib`、`rm -rf bin`（前端项目的常见目录）被判 system，弹窗写
  //    「目标是系统目录 —— 删除后系统或软件可能无法启动」，正是注释里要避免的狼来了。
  ok('★★ L34 段级：工作区内相对目录名不误报为系统目录（lib/bin/etc/var/opt/dev/sys/boot）',
    ['lib', 'bin', 'etc', 'var', 'opt', 'dev', 'sys', 'boot', 'lib64', 'sbin', 'usr']
      .every((d) => seg(['rm', '-rf', d]) === null),
    JSON.stringify(['lib', 'bin', 'etc', 'var', 'opt', 'dev', 'sys', 'boot'].map((d) => d + '=' + seg(['rm', '-rf', d]))))
  // 反面：**根锚定**的系统目录仍须命中（收紧不能把真系统目录一起放掉）。
  // `/etc` 用 bash 方言：pwsh 下 `/xxx` 是歧义拼写（见 blastRadiusOfSegment 的开关判据），
  // 而真实场景里 `rm -rf /etc` 本来就由 bash 工具执行（SHELL_OF_TOOL）。
  ok('★★ L34b 段级：根锚定的系统目录仍判 system（bash: /etc；pwsh: C:\\Windows、Windows\\System32）',
    segBash(['rm', '-rf', '/etc']) === 'system' && seg(['Remove-Item', '-Recurse', '-Force', 'C:\\Windows']) === 'system'
    && lvl('Windows\\System32') === 'system',
    JSON.stringify({ etc: segBash(['rm', '-rf', '/etc']), win: seg(['Remove-Item', '-Recurse', '-Force', 'C:\\Windows']), bare: lvl('Windows\\System32') }))

  // ★★ L35 **工作区位于 C:/Users/<user>/ 下时，工作区内目标不得判成 system**。
  //    `users` 分支在旧实现里匹配任意深度，于是 Windows 常态布局下工作区内**所有绝对路径**
  //    都被误报（实测 node_modules → system），而同一目标写成相对路径 → inside，
  //    即同一件事因为写法不同结论相反。
  const usersOpts = { home: 'C:/Users/me/.dsh', userHome: 'C:/Users/me', isOutsideWorkspace: (p) => {
    const raw = String(p).replace(/\\/g, '/')
    const abs = (raw.startsWith('/') || /^[a-zA-Z]:/.test(raw)) ? raw : 'C:/Users/me/code/webapp/' + raw
    return abs.toLowerCase().indexOf('c:/users/me/code/webapp') !== 0
  } }
  const uSeg = (w) => { const r = blastRadiusOfSegment(w, usersOpts); return r ? r.level : null }
  ok('★★ L35 段级：工作区在 C:/Users/<user>/ 下时，工作区内绝对目标不误报 system',
    uSeg(['rm', '-rf', 'C:/Users/me/code/webapp/node_modules']) === null
    && uSeg(['rm', '-rf', 'C:/Users/me/code/webapp/dist']) === null
    && uSeg(['rm', '-rf', './node_modules']) === null,
    JSON.stringify({ abs: uSeg(['rm', '-rf', 'C:/Users/me/code/webapp/node_modules']), rel: uSeg(['rm', '-rf', './node_modules']) }))
  // 反面：家目录本身与真系统目录仍须命中
  ok('★★ L35b 段级：家目录与真系统目录仍被标出（C:/Users/me → home，C:/Windows → system）',
    uSeg(['rm', '-rf', 'C:/Users/me']) === 'home' && uSeg(['rm', '-rf', 'C:/Windows']) === 'system',
    JSON.stringify({ home: uSeg(['rm', '-rf', 'C:/Users/me']), win: uSeg(['rm', '-rf', 'C:/Windows']) }))

  // ★★ L36 **home 档用 userHome（用户家目录），不是 DSH home**。
  //    宿主传的 home 是 `<家目录>/.dsh`；混用会让 `rm -rf ~`（真删家目录）显示
  //    `C:/Users/me/.dsh` 这个错误路径，而 `rm -rf C:/Users/me` 落到 system 档。
  const homeOpts = { home: 'C:/Users/me/.dsh', userHome: 'C:/Users/me', isOutsideWorkspace: () => false }
  const hLvl = (t) => { const r = blastRadiusOf(t, homeOpts); return r ? r.level + '|' + r.path : null }
  ok('★★ L36 家目录档用 userHome：~ 展开到用户家目录，且显示的是真实删除目标',
    hLvl('~') === 'home|C:/Users/me' && hLvl('C:/Users/me') === 'home|C:/Users/me',
    JSON.stringify({ tilde: hLvl('~'), abs: hLvl('C:/Users/me') }))
  // 兼容：未提供 userHome 时回落 home（旧调用方不因新增参数而失效）
  ok('★ L36b 未提供 userHome 时回落 home（向后兼容）',
    (() => { const r = blastRadiusOf('~', { home: 'C:/Users/me', isOutsideWorkspace: () => false }); return r && r.level === 'home' })(),
    JSON.stringify(blastRadiusOf('~', { home: 'C:/Users/me', isOutsideWorkspace: () => false })))

  // ★★ L37 **宽泛通配例外必须被标出**：`rm -rf *` 的目标归约后是 `.`（判 inside → null），
  //    但它实测能放行 `rm -rf /`、`rm -rf /etc`、`rm -rf C:/Windows`。
  //    面板的例外列表是「唯一能让人事后发现『我什么时候放行了删盘根』的地方」，
  //    此处返回 null 等于把审计点关掉。
  const cpLvl = (p, o) => { const r = blastRadiusOfCommandPattern(String(p).split(/\s+/), o || bOptsPwsh); return r ? r.level : null }
  const cpLvlBash = (p) => cpLvl(p, bOptsBash)
  ok('★★ L37 宽泛通配例外标为 broad（rm -rf * / rm * / rmdir * / del * / Remove-Item *）',
    ['rm -rf *', 'rm *', 'rmdir *', 'del *', 'Remove-Item *'].every((p) => cpLvl(p) === 'broad'),
    JSON.stringify(['rm -rf *', 'rm *', 'rmdir *', 'del *', 'Remove-Item *'].map((p) => p + '=' + cpLvl(p))))
  // 反面：**具体目标不得被降级成 broad**（`rm -rf /` 是确定的盘根，比 broad 更严重）。
  // POSIX 拼写用 bash 方言（真实场景：`rm -rf /` 由 bash 工具执行）。
  ok('★★ L37b 具体目标不降级为 broad（bash: rm -rf / → drive-root、/etc → system；pwsh: B:\\* → drive-root）',
    cpLvlBash('rm -rf /') === 'drive-root' && cpLvlBash('rm -rf /etc') === 'system' && cpLvl('rm -rf B:\\*') === 'drive-root',
    JSON.stringify({ root: cpLvlBash('rm -rf /'), etc: cpLvlBash('rm -rf /etc'), drive: cpLvl('rm -rf B:\\*') }))
  // ★★ L37d **带 cmd 开关的宽泛通配例外也必须标 broad**。
  //    `rmdir /s /q *` 实测能放行 `rmdir /s /q B:\`（删盘根）与 `rmdir /s /q C:\Windows`，
  //    但它的目标判断里夹着 `/s` `/q` 两个开关 —— 判断「是否限定目标」时必须把开关排除。
  //    注意平台：`rmdir /s /q` 是 **Windows/cmd 风格**的例外，其 `/s` `/q` 只在 win32 平台
  //    才是开关；POSIX 平台上 `/s` 是根目录下的真实路径，不该被当开关（故这里只测 win32，
  //    以及「词法用 bash 分解但平台是 win32」这一组合 —— 后者正是面板不记方言的现实）。
  const bOptsBashWin = Object.assign({}, bOpts, { platform: 'win32' })
  const cpLvlBashWin = (p) => { const r = blastRadiusOfCommandPattern(String(p).split(/\s+/), bOptsBashWin); return r ? r.level : null }
  ok('★★ L37d 带 cmd 开关的宽泛通配仍标 broad（rmdir /s /q *、del /f /s /q *；bash 词法 + win32 平台也要）',
    ['rmdir /s /q *', 'del /f /s /q *'].every((p) => cpLvl(p) === 'broad')
    && ['rmdir /s /q *', 'del /f /s /q *'].every((p) => cpLvlBashWin(p) === 'broad'),
    JSON.stringify({ pwsh: ['rmdir /s /q *', 'del /f /s /q *'].map((p) => p + '=' + cpLvl(p)),
      bashWin: ['rmdir /s /q *', 'del /f /s /q *'].map((p) => p + '=' + cpLvlBashWin(p)) }))
  // 反面：带开关但目标**具体**的例外仍须判具体档，不得因为夹了开关就被归成 broad
  ok('★ L37e 带开关的具体目标不降级为 broad（rmdir /s /q B:\\ → drive-root）',
    cpLvl('rmdir /s /q B:\\') === 'drive-root' && cpLvl('rmdir /s /q C:\\Windows') === 'system',
    JSON.stringify({ drive: cpLvl('rmdir /s /q B:\\'), win: cpLvl('rmdir /s /q C:\\Windows') }))
  // 非破坏性例外的模式**不会进入标注**：调用方（index.js 的 exceptionBlast）先用
  // isDestructiveSegment 过滤，`git status *` 在那里就被拦掉，不会走到本函数。
  // 故这里钉的是「调用方那道过滤确实存在且有效」，而不是本函数的返回值 ——
  // 本函数对 `git status *` 返回 broad 是**无害**的（它只回答「目标是否受限」，
  // 不回答「这条例外该不该标注」，后者由 isDestructiveSegment 决定）。
  ok('★ L37c 非破坏性模式在调用方被拦下（isDestructiveSegment 过滤先于判档）',
    isDestructiveSegment(['git', 'status', '*']) === false && isDestructiveSegment(['git', 'status']) === false,
    JSON.stringify({ star: isDestructiveSegment(['git', 'status', '*']), plain: isDestructiveSegment(['git', 'status']) }))

  // ★★ L38 **同源破坏性判据**：`find -delete` / `find -exec rm` 必须被判为破坏性段。
  //    判定侧走 segmentLabels（会合成 `rm` label），而主 label 恒为 `find`（不在名单里）——
  //    候选侧与例外标注侧若用主 label 判，就会给 `find` 族生成通配候选 `find *`，
  //    用户点一次「允许并记住」即把 destructive=deny 压过（实测 deny → allow）。
  ok('★★ L38 isDestructiveSegment 与判定侧同源（find -delete / find -exec rm 都算破坏性）',
    isDestructiveSegment(['find', '.', '-delete']) === true
    && isDestructiveSegment(['find', '/', '-exec', 'rm', '-rf', '{}', '+']) === true
    && isDestructiveSegment(['rm', '-rf', '/x']) === true
    && isDestructiveSegment(['git', 'status']) === false,
    JSON.stringify({ del: isDestructiveSegment(['find', '.', '-delete']),
      exec: isDestructiveSegment(['find', '/', '-exec', 'rm', '-rf', '{}', '+']),
      rm: isDestructiveSegment(['rm', '-rf', '/x']), git: isDestructiveSegment(['git', 'status']) }))

  // ★★ L39 BLAST_ORDER 是模块级唯一一份，且覆盖全部档位（index.js 直接引用它）
  ok('★★ L39 BLAST_ORDER 导出且覆盖全部档位（含 broad，顺序即严重度）',
    BLAST_ORDER['drive-root'] < BLAST_ORDER.broad && BLAST_ORDER.broad < BLAST_ORDER.system
    && BLAST_ORDER.system < BLAST_ORDER.home && BLAST_ORDER.home < BLAST_ORDER.outside
    && BLAST_ORDER.outside < BLAST_ORDER.inside,
    JSON.stringify(BLAST_ORDER))

  // ★★ L40 长连续斜杠不得让判档退化成平方（旧 `.replace(/\/+$/, '')` 实测 n=40000 时 351 ms）
  const slashTok = '/'.repeat(40000) + 'x'
  const tSlash = Date.now()
  blastRadiusOfSegment(['rm', '-rf', slashTok], bOpts)
  const slashMs = Date.now() - tSlash
  ok('★★ L40 长连续斜杠的判档是线性（40000 个斜杠 < 50 ms，旧实现约 350 ms）',
    slashMs < 50, slashMs + ' ms')

  // ★ L41 纯相对词元被预筛跳过，结果与逐词元判档一致（不得因为预筛漏报）
  ok('★ L41 预筛不改变结论：纯相对词元仍判 inside、带分隔符的词元照常判档',
    seg(['rm', '-rf', 'build', 'dist', 'src']) === null
    && seg(['rm', '-rf', 'build', 'B:\\other']) === 'outside',
    JSON.stringify({ rel: seg(['rm', '-rf', 'build', 'dist', 'src']), mixed: seg(['rm', '-rf', 'build', 'B:\\other']) }))

  // ── L42–L47 判档漏报的回归钉（每一条都对应一个「同一模块两处结论相反」的实测缺口）──
  //
  // ★★ L42 预筛与 WIN_SYSTEM_BARE_RE 不得互相矛盾。
  //    BARE 表刻意收录**不含分隔符**的系统目录名（`Windows`/`System32`/`ProgramData`，
  //    见该表注释与 L11），而预筛按「不含分隔符 ⇒ 恒 inside」跳过 —— 两处直接矛盾，
  //    于是该表唯一的调用点上判档静默。判据必须**逐词元与段级都查**：
  //    只查 blastRadiusOf 单项（L11 就是）覆盖不到预筛这条路径。
  ok('★★ L42 BARE 系统目录名在段级也判 system（预筛不得吞掉 WIN_SYSTEM_BARE_RE）',
    ['Windows', 'System32', 'ProgramData', 'WinNT', 'Recovery', 'PerfLogs'].every((n) => seg(['rm', '-rf', n]) === 'system')
    // 反面：短通用名仍不得误报（预筛放宽不能把 lib/bin 也带成 system）
    && ['lib', 'bin', 'etc', 'var', 'opt'].every((n) => seg(['rm', '-rf', n]) === null),
    JSON.stringify({ win: seg(['rm', '-rf', 'Windows']), sys32: seg(['rm', '-rf', 'System32']), lib: seg(['rm', '-rf', 'lib']) }))

  // ★★ L43 Windows 上 `/Windows` 是**当前盘根的绝对路径**，不是 cmd 开关。
  //    无条件把 `/`+字母 当开关会在出货平台上吃掉最该警告的目标；而真正的短开关
  //    （`/s` `/q` `/grant` `/pid`）必须仍然跳过（否则 L33/L33b 的噪音会回来）。
  ok('★★ L43 win32：`/Windows`、`/ProgramData` 判 system，`/s` `/q` `/grant` 仍当开关跳过',
    seg(['rm', '-rf', '/Windows']) === 'system' && seg(['rm', '-rf', '/ProgramData']) === 'system'
    && seg(['rmdir', '/s', '/q']) === null && seg(['icacls', '/grant']) === null && seg(['rm', '-rf', '/s']) === null,
    JSON.stringify({ win: seg(['rm', '-rf', '/Windows']), prog: seg(['rm', '-rf', '/ProgramData']),
      s: seg(['rmdir', '/s', '/q']), grant: seg(['icacls', '/grant']) }))

  // ★★ L43b：**Windows 平台上的 POSIX 绝对路径**同样是路径，不是 cmd 开关。
  //    L43 只覆盖了「落在 Windows 系统目录名单里的 `/x`」（`/Windows`），而 `isSystemDir`
  //    在 win32 下**只查 Windows 名单** —— 于是 POSIX 系统路径整类被当开关跳过：
  //    `/etc` 不在 WIN_* 名单里 → isCmdStyleSwitch 判 true → 主循环 `continue` 且不置位
  //    `sawUnjudgeable` → 段级 blast 为 null → 档位 `inside` → **默认配置下 allow**。
  //    实测（平台 win32、默认配置）：`rm -rf /etc`、`/tmp/x`、`/usr/bin`、`/var/log`、
  //    `/home/u/data`、`chmod 777 /etc/passwd`、`truncate -s 0 /etc/passwd`、`shred /etc/passwd`
  //    全部 allow，而同义的 `rm -rf C:/Windows` 正确判 wide —— 宿主的 `isOutside('/etc')`
  //    实际返回 true（解析为盘根下的 `\etc`，在工作区外），解析器压根没走到那一步。
  //    **Windows 是出货平台**，这条路径上的静默代价最大。
  //    反面（同一断言里钉住）：真开关（`/s` `/q` `/im` `/pid` `/grant` `/f`）仍须跳过，
  //    否则 L33/L33b 的假警告会回来 —— 判据收窄不能收过头。
  {
    const posixAbs = ['/etc', '/tmp/x', '/usr/bin', '/var/log', '/home/u/data', '/etc/passwd', '/opt/x']
    const badPath = posixAbs.filter((p) => seg(['rm', '-rf', p]) === null)
    const badSwitch = ['/s', '/q', '/f', '/im', '/pid', '/grant', '/mir', '/delete']
      .filter((s) => seg(['rmdir', s]) !== null)
    ok('★★ L43b win32：POSIX 绝对路径（/etc、/tmp/x…）判非 null；真开关（/s /q /im /pid /grant）仍跳过',
      badPath.length === 0 && badSwitch.length === 0,
      JSON.stringify({ badPath, badSwitch, etc: seg(['rm', '-rf', '/etc']), s: seg(['rmdir', '/s']) }))
    // 端到端：默认配置（mode=allow、destructive 未配置）下必须非 allow
    const e2e = ['rm -rf /etc', 'rm -rf /tmp/x', 'rm -rf /usr/bin', 'rm -rf /var/log',
      'rm -rf /home/u/data', 'chmod 777 /etc/passwd', 'truncate -s 0 /etc/passwd', 'shred /etc/passwd']
      .filter((c) => run(c, 'pwsh', { platform: 'win32' }).action === 'allow')
    ok('★★ L43c win32 + 默认配置：POSIX 绝对路径目标不得 allow（出货平台上的静默放行）',
      e2e.length === 0, JSON.stringify(e2e))
    // 反面：真正的 cmd 开关不得被误判成「读不出/越界」而多弹窗
    const noise = ['taskkill /im x.exe', 'taskkill /f /pid 1234', 'shutdown /s', 'dir /b']
      .filter((c) => run(c, 'pwsh', { platform: 'win32' }).action !== 'ask')
    ok('★ L43d win32：真开关命令仍按原档位判定（不被误判成越界而改变动作）',
      noise.length === 0, JSON.stringify(noise))
  }

  // ★★ L43e：**单段 POSIX 绝对路径**（`/tmp` `/home` `/myapp`…）同样是路径，不是 cmd 开关。
  //    L43b 只堵住了「多段」（`/tmp/x`）与「POSIX 系统目录名单里的名字」（`/etc`），
  //    而**任意 `/` + 字母的单段词**仍然命中开关判据 —— 范围比原先认为的大得多：
  //    不是 `/tmp` `/home` 几个名字，而是除两张名单外的**全部**单段词。
  //    实测（修复前，平台 win32、`blastRadiusOfSegment` 返回 null）：
  //        rm -rf /tmp | /home | /data | /app | /backup | /foo | /myapp | /logs | /zzz | /notaswitch
  //    而 `/etc` `/usr` 一族判 outside —— **同一类操作只因名字不同，一个静默一个询问**。
  //    放大形态：13 个破坏性命令对 `/tmp` 全部 null（含 `Remove-Item` / `shred` /
  //    `truncate` / `chmod` / `chown` / `find -delete` / `mkfs.ext4` / `wipefs`）；
  //    引号不救（`rm -rf "/tmp"` 仍 null）、大小写不救（`/TMP` 仍 null），
  //    只有**尾斜杠**会救（`/tmp/` 判 outside）—— 同一目标写 `/tmp` 静默、写 `/tmp/` 弹窗。
  //    `/tmp` 在 Windows 上是**真的会删东西**的：Git Bash 方言下它映射到真实 `%TEMP%`。
  //
  //    **用未在任何名单里的名字**（`/notaswitch` `/wibble`）钉住「这不是枚举名单」：
  //    判据是**命令域**（这条命令吃不吃 `/x`），不是「这个词像不像路径」——
  //    枚举路径名在原理上不可能收敛（`/myapp` `/backup` `/zzz` 永远枚举不完）。
  {
    const openSet = ['/tmp', '/home', '/data', '/app', '/backup', '/foo', '/notaswitch', '/wibble']
    const badOpen = openSet.filter((p) => seg(['rm', '-rf', p]) === null)
    ok('★★ L43e win32：单段 POSIX 路径（/tmp /home /myapp /notaswitch…）判非 null（开放集合，不是枚举名单）',
      badOpen.length === 0,
      JSON.stringify({ badOpen, tmp: seg(['rm', '-rf', '/tmp']), notaswitch: seg(['rm', '-rf', '/notaswitch']) }))
    // ★★ L43e2：**语句关键字前缀**形态同样不得静默。
    //    上面的用例全部以 `rm` 直接起头，于是完全没覆盖「段首是关键字」这一形态 ——
    //    而门控查命令名时若用 `unwrapWords` 兜底（它**不跳** STATEMENT_KEYWORDS，
    //    而 segmentLabel 跳），查到的就是**关键字本身**：`time` 既不是半径组命令、
    //    也不是载荷族 → `/tmp` 被当 cmd 开关 → 段级 blast 归 null → mode=allow 下静默。
    //    实测该形态覆盖 33 个 STATEMENT_KEYWORDS × 12 个破坏性动词 × 6 个单段词
    //    = 1980 条组合**全部** fail-open，而同一目标不带关键字前缀时正确判 outside ——
    //    即「半径判据确实被消费（`segmentLabels(['time','rm','-rf','/tmp'])` = `['rm']`），
    //    门控却把它排除在外」，是判据分叉而非设计取舍。故这组断言必须存在，
    //    否则该形态的回归无人守（本条断言在修复前为红）。
    const kwPrefix = ['time', 'then', '!', 'do', 'return', 'not', 'and', 'or', 'try']
    const kwOpen = kwPrefix.map((k) => [k, 'rm', '-rf', '/tmp'])
    const badKwOpen = kwOpen.filter((c) => seg(c) === null).map((c) => c.join(' '))
    ok('★★ L43e2 win32：语句关键字前缀（time / then / ! / do / return…）不得让单段 POSIX 路径静默',
      badKwOpen.length === 0,
      JSON.stringify({ badKwOpen, time: seg(['time', 'rm', '-rf', '/tmp']), then: seg(['then', 'rm', '-rf', '/home']) }))
    // 大小写与引号都不救（同一目标不因写法不同而分叉）
    ok('★★ L43f win32：单段 POSIX 路径的判定与大小写无关（/TMP 与 /tmp 同判）',
      seg(['rm', '-rf', '/TMP']) !== null && seg(['rm', '-rf', '/TMP']) === seg(['rm', '-rf', '/tmp']),
      JSON.stringify({ upper: seg(['rm', '-rf', '/TMP']), lower: seg(['rm', '-rf', '/tmp']) }))
    // 跨命令：**POSIX 命令**对 `/tmp` 都必须非 null（修复前全部 null）。
    // 只列 POSIX 命令：`rmdir`/`del`/`erase`/`rd` 是 Windows 原生命令、在命令域表里，
    // 它们的 `/x` **就是**开关（`rmdir /tmp` 在 cmd 下报 `Invalid switch - tmp`），
    // 故对它们判 null 是**设计结果**而非漏报 —— 见 L43i 的反面断言。
    const crossCmds = [
      ['rm', '-rf', '/tmp'], ['Remove-Item', '-Recurse', '-Force', '/tmp'], ['shred', '/tmp'],
      ['truncate', '-s', '0', '/tmp'], ['chmod', '777', '/tmp'], ['chown', 'u', '/tmp'],
      ['find', '/tmp', '-delete'], ['wipefs', '/tmp'], ['chgrp', 'u', '/tmp'],
      ['sudo', 'rm', '-rf', '/tmp'], ['sudo', '-u', 'root', 'rm', '-rf', '/tmp'],
      ['env', 'FOO=1', 'rm', '-rf', '/tmp'], ['/usr/bin/rm', '-rf', '/tmp'],
    ]
    const badCross = crossCmds.filter((c) => seg(c) === null).map((c) => c.join(' '))
    ok('★★ L43g win32：POSIX 命令（rm / Remove-Item / shred / truncate / chmod / chown / find -delete…）对 /tmp 全部非 null',
      badCross.length === 0, JSON.stringify({ badCross, rm: seg(['rm', '-rf', '/tmp']) }))
    // ★★ L43g2：**关键字前缀 × 破坏性动词 × 单段词**的交叉覆盖（L43e2 只用了 `rm`）。
    //    命令名解析若在关键字处分叉，受影响的是**全部**消费半径判据的破坏性命令，
    //    不只 `rm` —— 故这里逐个动词 × 逐个关键字 × 逐个项目一起钉住。
    //    同时钉住「关键字之后仍是前缀链」的形态（`time nohup rm …`、`sudo time rm …`）：
    //    `commandHeadEnd` 不认识关键字，会把它当前缀之后的命令名吃掉，
    //    故命令名解析必须跳关键字**再**走一遍命令头。
    const kwVerbs = [
      ['rm', '-rf'], ['Remove-Item', '-Recurse', '-Force'], ['shred'], ['truncate', '-s', '0'],
      ['chmod', '777'], ['chown', 'u'], ['chgrp', 'u'], ['wipefs'],
    ]
    const kwTargets = ['/tmp', '/home', '/data', '/myapp', '/notaswitch', '/wibble']
    const badKwCross = []
    for (const k of ['time', 'then', 'do', '!', 'return', 'not'])
      for (const v of kwVerbs)
        for (const t of kwTargets)
          if (seg([k].concat(v, [t])) === null) badKwCross.push([k].concat(v, [t]).join(' '))
    ok('★★ L43g2 win32：关键字 × 破坏性动词 × 单段词全组合非 null（命令名解析不得在关键字处分叉）',
      badKwCross.length === 0,
      JSON.stringify({ n: badKwCross.length, sample: badKwCross.slice(0, 4),
        timeShred: seg(['time', 'shred', '/tmp']), thenChmod: seg(['then', 'chmod', '777', '/home']) }))
    // 关键字之后仍可能是前缀链（`time nohup rm …`、`time sudo rm …`、`sudo time rm …`）：
    // 命令名要取自**前缀链之后**，而不是关键字之后的第一个词元。
    const kwChain = [
      ['time', 'nohup', 'rm', '-rf', '/tmp'], ['time', 'sudo', 'rm', '-rf', '/tmp'],
      ['sudo', 'time', 'rm', '-rf', '/tmp'], ['then', 'nohup', 'rm', '-rf', '/home'],
      ['time', 'time', 'rm', '-rf', '/data'],
    ]
    const badKwChain = kwChain.filter((c) => seg(c) === null).map((c) => c.join(' '))
    ok('★★ L43g3 win32：关键字之后的前缀链仍须剥掉（time nohup rm…、sudo time rm…）',
      badKwChain.length === 0,
      JSON.stringify({ badKwChain, timeNohup: seg(['time', 'nohup', 'rm', '-rf', '/tmp']), sudoTime: seg(['sudo', 'time', 'rm', '-rf', '/tmp']) }))
    // 端到端：mode=allow 下 `rm -rf /tmp` 必须**非 allow**。
    // 这是本次修复的核心收益 —— 修复前它落 inside 档、被静默放行。
    //
    // **必须显式给出 mode=allow 的档位表**，不能用 `hooks()` 的默认 `destructive: 'ask'`：
    // 后者把八档**全**展开成 ask（旧契约的忠实翻译，见 tierTableOf），于是 inside 也是 ask ——
    // `rm -rf /tmp` 无论修复前后都判 ask，断言恒绿、是**空转**（变异测试实测确认）。
    // 生产语义是 index.js 的 destructiveTiers：配置里没写 destructive 时八档全 ask。
    // 而这张 mode=allow 表是「八档里只有 inside 放行」的档位表 —— 用户显式把 inside 档
    // 设为 allow、其余七档留 ask 时的真实形态，也正是 `rm -rf /tmp` 静默放行的现场。
    const modeAllow = { inside: 'allow', outside: 'ask', wide: 'ask', unknown: 'ask', proc: 'ask', power: 'ask', priv: 'ask', reg: 'ask' }
    const runModeAllow = (c) => {
      const h = hooks({ platform: 'win32' })
      h.destructive = () => modeAllow
      return assessCommand(c, 'pwsh', h)
    }
    const e2eTmp = ['rm -rf /tmp', 'rm -rf /home', 'rm -rf /data', 'rm -rf /myapp', 'rm -rf /notaswitch']
      .filter((c) => runModeAllow(c).action === 'allow')
    ok('★★ L43h win32 + mode=allow：`rm -rf /tmp` 等单段 POSIX 目标不得 allow（出货平台上的静默放行）',
      e2eTmp.length === 0,
      JSON.stringify({ e2eTmp, tmp: runModeAllow('rm -rf /tmp').action }))
    // ★★ L43h3：**同一张 mode=allow 表下的关键字前缀形态**（端到端，而不只是段级）。
    //    这是本次发现的现场：`time rm -rf /tmp` 在修复前判 allow、tiers `['inside']`、blast null，
    //    而对照的 `rm -rf /tmp` 判 ask/outside —— 同一件事只因多了个关键字前缀就被静默放行。
    //    段级断言（L43e2/L43g2）只能证明 blast 非 null；这里钉住**用户实际看到的动作**，
    //    因为「段级有档位」与「动作非 allow」之间还隔着档位表这一层。
    const e2eKw = ['time rm -rf /tmp', 'then rm -rf /home', 'do rm -rf /data',
      '! rm -rf /myapp', 'return rm -rf /notaswitch', 'not rm -rf /wibble',
      'time rm -rf /etc', 'then shred /tmp', 'time nohup rm -rf /tmp', 'sudo time rm -rf /tmp']
      .filter((c) => runModeAllow(c).action === 'allow')
    ok('★★ L43h3 win32 + mode=allow：关键字前缀形态同样不得 allow（`time rm -rf /tmp` 的现场）',
      e2eKw.length === 0,
      JSON.stringify({ e2eKw, time: runModeAllow('time rm -rf /tmp').action }))
    // 对照（证明 L43h3 不空转、且关键字形态未被过度收紧）：
    // 同一张表下关键字前缀 + **区内**目标仍须 allow。
    ok('★★ L43h4 win32 + mode=allow 对照：关键字前缀 + 区内目标仍 allow（L43h3 不空转）',
      runModeAllow('time rm -rf ./build').action === 'allow' && runModeAllow('then rm -rf x').action === 'allow',
      JSON.stringify({ build: runModeAllow('time rm -rf ./build').action, x: runModeAllow('then rm -rf x').action }))
    // 对照（证明断言不空转、且区内正常命令未被收紧）：
    // 同一张 mode=allow 表下 `rm -rf ./build` 仍须 allow（inside 档跟随 mode）。
    ok('★★ L43h2 win32 + mode=allow 对照：工作区内的 `rm -rf ./build` 仍 allow（断言不空转）',
      runModeAllow('rm -rf ./build').action === 'allow' && runModeAllow('rm -rf x').action === 'allow',
      JSON.stringify({ build: runModeAllow('rm -rf ./build').action, x: runModeAllow('rm -rf x').action }))
  }

  // ★★ L43i：**命令域判据的反面** —— 吃 `/x` 形态开关的 Windows 原生命令，其开关仍须判 null。
  //    判据不是「这个词是不是开关」，而是「**这条命令吃不吃 `/x`**」：
  //      · `rm`/`chmod`/`shred`/`find`/`dd` 是 POSIX 命令，没有 `/x` 形态的选项 → `/x` 必是路径；
  //      · `rmdir`/`del`/`icacls`/`format`/`diskpart` 是 Windows 原生命令 → `/x` 是开关。
  //    按「字母数」猜已被实测否决（`/grant` `/pid` 会被当路径、凭空造出假警告，见 L33b）；
  //    按开关名枚举同样无界（短开关 26+、长开关 20+，第三方安装器还在增长），
  //    且按合理规模建表会造出 `schtasks /create`、`compact /c`、`cipher /w` 三条新的假警告。
  //
  //    **必须含带提权前缀的形态**（`sudo icacls … /grant`、`sudo rmdir /s /q`）：
  //    命令名要取自 `commandHeadEnd` 之后的命令、剥掉 `sudo` 这类前缀 —— 只看 `w[0]` 会把
  //    `sudo rmdir` 判成「不吃 /x 的命令」，`/s` `/q` 被当路径、凭空造出假警告。
  //    这是本判据**唯一会静默漏判**的接线点，故单独钉住。
  {
    // 命令域成员**逐个覆盖**（`WIN_SLASH_SWITCH_CMDS` 的全部 10 项）：
    // 每一项都带一个该命令真实存在的 `/x` 开关，都必须判 null。
    const domainSw = [
      ['rmdir', '/s', '/q'], ['rd', '/s', '/q'], ['del', '/f', '/s', '/q'], ['erase', '/f', '/s', '/q'],
      ['format', '/q'], ['diskpart', '/s', 'script.txt'], ['fdisk', '/l'],
      ['icacls', 'X:\\ws\\x', '/grant', 'Users:F'], ['takeown', '/f', 'X:\\ws\\x'],
      ['runas', '/user:admin', 'cmd'],
    ]
    const badDomain = domainSw.filter((c) => seg(c) !== null).map((c) => c.join(' '))
    ok('★★ L43i win32：命令域成员的开关仍判 null（WIN_SLASH_SWITCH_CMDS 全部 10 项逐个覆盖）',
      badDomain.length === 0,
      JSON.stringify({ badDomain, rmdir: seg(['rmdir', '/s', '/q']), icacls: seg(['icacls', 'X:\\ws\\x', '/grant', 'Users:F']) }))
    // 带**提权前缀**的形态：命令名必须取自命令头（剥掉 `sudo`），不能看 `w[0]`。
    // 只看 `w[0]` 会把 `sudo rmdir` 判成「不吃 /x 的命令」→ `/s` `/q` 被当路径 →
    // 凭空造出「目标在工作区外」的假警告。这是本判据唯一会**静默漏判**的接线点。
    // `sudo reg delete … /f` 与 `sudo taskkill /pid` 一并钉住：它们走组档、
    // 同样不能被命令域判据误伤（`reg delete` 是两词 label，`taskkill` 不在域表里）。
    const sudoSw = [
      ['sudo', 'rmdir', '/s', '/q'], ['sudo', 'icacls', 'X:\\ws\\x', '/grant', 'Users:F'],
      ['sudo', 'del', '/f', '/s', '/q'], ['sudo', 'reg', 'delete', 'HKLM\\X', '/f'],
      ['sudo', 'taskkill', '/pid', '1234'],
    ]
    const badSudo = sudoSw.filter((c) => seg(c) !== null).map((c) => c.join(' '))
    ok('★★ L43i2 win32：带提权前缀的命令域开关仍判 null（钉住「剥提权前缀」生效）',
      badSudo.length === 0,
      JSON.stringify({ badSudo, sudoRmdir: seg(['sudo', 'rmdir', '/s', '/q']), sudoIcacls: seg(['sudo', 'icacls', 'X:\\ws\\x', '/grant', 'Users:F']) }))
    // ★★ L43i3：**关键字前缀下的真开关同样不得被当路径** —— 与 L43e2/L43g2 互为反面。
    //    命令名解析跳关键字时，最容易顺手把「关键字之后的第一个词元」当成命令名，
    //    于是 `time rmdir /s /q` 查到 `rmdir`（对）、而 `time taskkill /pid 1234` 若
    //    因为某个中间步骤查不到 `taskkill`，`/pid` 就会被当路径、凭空造出假警告。
    //    这一组与 L33b 的「新增假警告必须为 0」是同一件事在关键字维度上的展开。
    const kwSw = []
    for (const k of ['time', 'then', 'do', '!', 'return'])
      for (const c of [['rmdir', '/s', '/q'], ['del', '/f', '/s', '/q'], ['icacls', 'X:\\ws\\x', '/grant', 'Users:F'],
        ['taskkill', '/f', '/pid', '1234'], ['net', 'user', 'bob', '/delete'], ['robocopy', 'X:\\ws\\a', 'X:\\ws\\b', '/mir'],
        ['schtasks', '/create'], ['compact', '/c'], ['cipher', '/w'], ['xcopy', 'X:\\ws\\a', 'X:\\ws\\b', '/e', '/i'],
        ['attrib', '/s', '/d'], ['dir', '/b']])
        if (seg([k].concat(c)) !== null) kwSw.push([k].concat(c).join(' '))
    ok('★★ L43i3 win32：关键字前缀下的真开关仍判 null（不制造假警告，L43e2 的反面）',
      kwSw.length === 0,
      JSON.stringify({ n: kwSw.length, sample: kwSw.slice(0, 4),
        timeRmdir: seg(['time', 'rmdir', '/s', '/q']), thenTaskkill: seg(['then', 'taskkill', '/f', '/pid', '1234']) }))
    // 反面：非命令域成员的真开关同样不得被当路径（`taskkill`/`robocopy`/`net`/`schtasks` 走组档或非破坏性）
    const swOther = ['taskkill /f /pid 1234', 'robocopy X:\\ws\\a X:\\ws\\b /mir', 'net user bob /delete',
      'schtasks /create', 'compact /c', 'cipher /w', 'xcopy X:\\ws\\a X:\\ws\\b /e /i', 'attrib /s /d']
      .filter((c) => run(c, 'pwsh', { platform: 'win32' }).action === 'allow')
    ok('★ L43j win32：非命令域命令的真开关不制造假警告（不被误判成越界而改变动作）',
      swOther.length === 0, JSON.stringify(swOther))
  }

  // ★★ L43i4 **提权 / wrapper 前缀不得被当成命令名**（门控查到的名字必须落在命令头上）。
  //    根因：`headCommandNameOf` 跳过语句关键字解出 `start` 之后**从不剥 `start` 处的前缀链**，
  //    直接把 `w[start]` 当命令名。于是两条路径都返回**前缀本身**：
  //      · 提权前缀（`sudo`/`doas`/`su`/`pkexec`/`runas`/`gsudo`）本身就在 `DESTRUCTIVE_LABELS`
  //        里 → 命中那处「严格等价」短路 → 返回前缀；
  //      · wrapper 前缀不在破坏性名单里 → 短路不命中 → 落到「关键字之后第一个词元」兜底
  //        → 仍返回前缀。
  //    两者**互为遮蔽**（只删短路会让提权前缀改由兜底接住，只修兜底对提权前缀无效），
  //    故必须一起处理。后果是 `isCmdStyleSwitch` 拿前缀查命令域（`sudo`/`nohup` 都不在
  //    `WIN_SLASH_SWITCH_CMDS` 里）→ `/grant` `/pid` 被当路径 → 段级 blast 由 null 变 outside。
  //
  //    判据写成**与不带关键字的同形命令逐字一致**：那才是「前缀已被剥掉」的可观察形式，
  //    且比钉死某个具体档位更强 —— 它同时覆盖真开关形态（两边都应 null）与真目标形态
  //    （两边都应非 null，防止为了消警告把真目标一起吃掉）。
  //
  //    **关键字名单刻意排除 `{` / `}`**：它们作段首时 `segmentLabels` 返回 `[]`
  //    （既有行为，与本次根因无关），于是 `{ rm -rf /tmp` 与 `rm -rf /tmp` 的档位集合本就
  //    不同 —— 拿它做「与无关键字对照」会把那条既有差异误记成前缀缺陷（度量污染）。
  {
    const kws = ['time', 'then', 'do', '!', 'return', 'not', 'and', 'or', 'try', 'if', 'while', 'foreach', 'switch']
    const privPrefixes = ['sudo', 'doas', 'su', 'pkexec', 'runas', 'gsudo']
    const wrapPrefixes = ['nohup', 'env', 'timeout', 'nice', 'setsid', 'ionice', 'stdbuf', 'command', 'builtin', 'exec', 'xargs']
    // 前缀链：单前缀 + 双前缀（`nohup time icacls …` 这类嵌套正是兜底分支的现场）
    const chains = privPrefixes.map((p) => [p]).concat(wrapPrefixes.map((p) => [p]))
      .concat([['nohup', 'time'], ['env', 'sudo'], ['su', 'runas'], ['sudo', 'nohup'], ['runas', 'env']])
    // 真开关形态（应判 null）与真目标形态（应判非 null）都要覆盖。
    const cores = [
      ['icacls', 'X:\\ws\\x', '/grant', 'Users:F'], ['taskkill', '/f', '/pid', '1234'],
      ['rmdir', '/s', '/q'], ['robocopy', 'X:\\ws\\a', 'X:\\ws\\b', '/mir'],
      ['net', 'user', 'bob', '/delete'], ['schtasks', '/create'],
      ['rm', '-rf', '/tmp'], ['shred', '/tmp'],
    ]
    // 关键字形态：单关键字 / 双关键字 / 「关键字 + 前缀 + 又一关键字」（三段）/
    // 「关键字 + 提权 + 又一关键字」——后两种正是「跳关键字后落到前缀、剥前缀后又遇关键字」的现场。
    const kwForms = (k) => [[k], [k, 'then'], [k, 'nohup', 'then'], [k, 'sudo', 'then']]
    const mismatches = []
    for (const k of kws) for (const kf of kwForms(k)) for (const ch of chains) for (const c of cores) {
      const withKw = seg(kf.concat(ch, c))
      const without = seg(ch.concat(c))
      if (withKw !== without) mismatches.push([kf.join(' '), ch.join(' '), c.join(' '), 'kw=' + withKw, 'nokw=' + without].join(' | '))
    }
    ok('★★ L43i4 win32：提权/wrapper 前缀不得被当命令名（加关键字后的段级 blast 必须与不带关键字同形一致）',
      mismatches.length === 0,
      JSON.stringify({ n: mismatches.length, sample: mismatches.slice(0, 4),
        timeSudoIcacls: seg(['time', 'sudo', 'icacls', 'X:\\ws\\x', '/grant', 'Users:F']),
        sudoIcacls: seg(['sudo', 'icacls', 'X:\\ws\\x', '/grant', 'Users:F']),
        thenSudoTaskkill: seg(['then', 'sudo', 'taskkill', '/f', '/pid', '1234']),
        sudoTaskkill: seg(['sudo', 'taskkill', '/f', '/pid', '1234']) }))
    // ★★ L43i4b：上面那条断言的两个**点名形态**（任务书明确要求的四条）。
    //    单独再钉一遍：段级 blast 的具体值（而不只是「两边相等」），
    //    因为「两边都错得一样」也能让 parity 断言变绿 —— 这条把它堵死。
    ok('★★ L43i4b win32：提权前缀形态判 null（time sudo icacls … /grant、then sudo taskkill … /pid）',
      seg(['time', 'sudo', 'icacls', 'X:\\ws\\x', '/grant', 'Users:F']) === null
      && seg(['then', 'sudo', 'taskkill', '/f', '/pid', '1234']) === null
      && seg(['sudo', 'icacls', 'X:\\ws\\x', '/grant', 'Users:F']) === null
      && seg(['sudo', 'taskkill', '/f', '/pid', '1234']) === null,
      JSON.stringify({ timeSudoIcacls: seg(['time', 'sudo', 'icacls', 'X:\\ws\\x', '/grant', 'Users:F']),
        thenSudoTaskkill: seg(['then', 'sudo', 'taskkill', '/f', '/pid', '1234']),
        sudoIcacls: seg(['sudo', 'icacls', 'X:\\ws\\x', '/grant', 'Users:F']),
        sudoTaskkill: seg(['sudo', 'taskkill', '/f', '/pid', '1234']) }))
    // ★★ L43i4c：**wrapper 族同理**（含「wrapper 套 wrapper」「wrapper 套关键字」两种嵌套）。
    ok('★★ L43i4c win32：wrapper 前缀形态判 null（time nohup time icacls … /grant、time env then taskkill … /pid）',
      seg(['time', 'nohup', 'time', 'icacls', 'X:\\ws\\x', '/grant', 'Users:F']) === null
      && seg(['time', 'env', 'then', 'taskkill', '/f', '/pid', '1234']) === null
      && seg(['nohup', 'time', 'icacls', 'X:\\ws\\x', '/grant', 'Users:F']) === null
      && seg(['env', 'then', 'taskkill', '/f', '/pid', '1234']) === null,
      JSON.stringify({ timeNohupTimeIcacls: seg(['time', 'nohup', 'time', 'icacls', 'X:\\ws\\x', '/grant', 'Users:F']),
        timeEnvThenTaskkill: seg(['time', 'env', 'then', 'taskkill', '/f', '/pid', '1234']),
        nohupTimeIcacls: seg(['nohup', 'time', 'icacls', 'X:\\ws\\x', '/grant', 'Users:F']),
        envThenTaskkill: seg(['env', 'then', 'taskkill', '/f', '/pid', '1234']) }))
    // ★★ L43i4d：**漏警告方向** —— `runas` 在 `WIN_SLASH_SWITCH_CMDS` 里而其余五个提权前缀不在，
    //    于是「剥掉前缀」这件事在 `runas` 上曾经只做了一半：不带关键字的 `runas rm -rf /tmp`
    //    判 outside，加了关键字却仍是 null（真目标被当开关吃掉）。这条钉住两者一致。
    ok('★★ L43i4d win32：`time runas rm -rf /tmp` 必须非 null（与 `runas rm -rf /tmp` 一致）',
      seg(['time', 'runas', 'rm', '-rf', '/tmp']) !== null
      && seg(['time', 'runas', 'rm', '-rf', '/tmp']) === seg(['runas', 'rm', '-rf', '/tmp']),
      JSON.stringify({ timeRunas: seg(['time', 'runas', 'rm', '-rf', '/tmp']),
        runas: seg(['runas', 'rm', '-rf', '/tmp']) }))
    // ★★ L43i4e：**对照（防空转）** —— 证明上面四条不是靠「关键字整体失效」变绿的：
    //    关键字 + 真目标仍须判非 allow。用 mode=allow 的真实档位表（inside=allow、其余 ask），
    //    与 L43h 同一张表：`time rm -rf /tmp` 修复前落 inside 档被静默放行。
    const modeAllowI4 = { inside: 'allow', outside: 'ask', wide: 'ask', unknown: 'ask', proc: 'ask', power: 'ask', priv: 'ask', reg: 'ask' }
    const runAllowI4 = (c) => {
      const h = hooks({ platform: 'win32' })
      h.destructive = () => modeAllowI4
      return assessCommand(c, 'pwsh', h)
    }
    ok('★★ L43i4e win32 + mode=allow 对照：`time rm -rf /tmp` 必须非 allow（关键字修复本身未被破坏）',
      runAllowI4('time rm -rf /tmp').action !== 'allow'
      && runAllowI4('time runas rm -rf /tmp').action !== 'allow'
      && runAllowI4('rm -rf /tmp').action !== 'allow',
      JSON.stringify({ time: runAllowI4('time rm -rf /tmp').action,
        timeRunas: runAllowI4('time runas rm -rf /tmp').action,
        plain: runAllowI4('rm -rf /tmp').action }))
    // ★★ L43i4f：**语句关键字 × BARE_INTERACTIVE**（§5.6①）—— 与 L43e2/L43h3 同一形态族，
    //    但落在**另一条判据**上。`hasNoOperand`（BARE 的形态判据）原先只把 `w[0]` 与
    //    `unwrapWords` 首词元放进 skip 表，而两者都**不跳**语句关键字：`['time','diskpart']`
    //    登记的是 `time`（两次），真命令名 `diskpart` 落进循环被当成**非选项实参**
    //    → 该段不归 unknown → 落半径档 inside → mode=allow 时**静默放行**。
    //    实测（修复前）：42 个 STATEMENT_KEYWORDS × {diskpart, parted, dd} = **129/129 全部 allow**，
    //    而裸跑 `diskpart` 与 `time diskpart` 在 HEAD 下都是 ask/unknown。
    //    即「加一个语句关键字就把 §5.6① 整类关掉」，方向是放宽。
    //    这里用与 L43i4e 同一张 mode=allow 真实档位表钉住**用户看到的动作**，
    //    而不是只断言段级 blast —— 两者之间还隔着档位表这一层。
    const kwBare = ['diskpart', 'parted', 'dd']
    const bareKwPrefixes = ['time', 'then', 'do', '!', 'nohup', 'return']
    const badKwBare = []
    for (const k of bareKwPrefixes) for (const b of kwBare) if (runAllowI4(k + ' ' + b).action === 'allow') badKwBare.push(k + ' ' + b)
    ok('★★ L43i4f win32 + mode=allow：语句关键字 × 裸跑交互（diskpart/parted/dd）不得 allow',
      badKwBare.length === 0
      // 对照（防空转）：裸跑本身必须非 allow，否则上面的过滤恒空
      && kwBare.every((b) => runAllowI4(b).action !== 'allow')
      // 对照（防过度收紧）：BARE 仍是**形态**判据 —— 带真实参时照旧走半径档
      // （`parted /dev/sda` 的 system 警告不得因本条被改成「无法判定」或静默）
      && segBash(['parted', '/dev/sda']) === 'system'
      && segBash(['dd', 'of=/dev/sda']) === 'system'
      && segBash(['parted']) === null,
      JSON.stringify({ badKwBare, bare: kwBare.map((b) => [b, runAllowI4(b).action]), time: runAllowI4('time diskpart').action,
        partedArg: segBash(['parted', '/dev/sda']) }))
    // ★★ L43i4g：**两族扩展**（`hasNoOperand` 的两个正交维度，同一次修复覆盖）─────────────
    // 族 A「语句关键字 × **透明 wrapper** × 裸跑交互命令」：`hasNoOperand` 的命令头跳过量
    //   此前只看 `commandHeadEnd`，而它对 `['time','env','diskpart']` 返回 **0**（首词元是
    //   关键字 → 既非前缀也非破坏性命令）。于是 `i < headEnd` 一个词元都盖不住，
    //   `skip` 表里只有 `time`（两次）与 `diskpart`，中间的 `env` 落进循环被当成
    //   **非选项实参** → 返回 false → 该段不归 `unknown` → 落半径档 `inside`
    //   → mode=allow 时**静默放行**。而 `diskpart` 裸跑会阻塞等 stdin（DSH 非交互环境），
    //   静默放行后该次工具调用直接挂住。
    //   实测（修复前，45 个 STATEMENT_KEYWORDS × 9 个 wrapper × 3 个命令 = 1215 条）：
    //   **1161/1215 allow**；三组对照（仅关键字 / 仅 wrapper / 裸跑）各 **0/1215**
    //   —— 故平方因子确实是「关键字 × wrapper」的交集，不是任一侧单独失效。
    //   生产形态同样命中：`if true; then env diskpart; fi`、`while true; do env parted; done`。
    // 族 B「**首字母大写**命令名」：`headCommandNameOf` 返回的命令名是**已小写**的
    //   （`commandNameOf` 末尾 toLowerCase），而 skip 表里查的是**原始词元** ——
    //   `['time','Diskpart']` 的 skip 里是 `diskpart`、查表查 `Diskpart` → 不命中。
    //   Windows 命令名大小写不敏感，`Diskpart` / `PARTED` 是日常写法。
    //   实测（修复前，45 关键字 × 3 命令 × {小写,首字母大写} = 270 条）：
    //   小写 **0/135** allow、大写 **129/135** allow。
    //
    // 两族的修复判据是正交的（命令头覆盖是超集，但大小写归一仍必须保留：
    // `skip[w[0]]` / `skip[unwrapWords[0]]` 两处写入仍是原始词元），故两族都钉。
    // 关键字取**全部** STATEMENT_KEYWORDS（不是抽样）：`foreach`/`dynamicparam` 这类
    // 冷门关键字与 `time`/`!` 走同一条判据，抽样会让「表里新增关键字时漏改」溜过去。
    const allKw = ['foreach', 'if', 'else', 'elseif', 'for', 'while', 'do', 'until', 'switch', 'return',
      'function', 'filter', 'param', 'begin', 'process', 'end', 'try', 'catch', 'finally', 'throw',
      'break', 'continue', 'trap', 'in', 'not', 'and', 'or', 'class', 'enum', 'using', 'exit',
      'dynamicparam', 'data', 'then', 'elif', 'fi', 'done', 'esac', 'time', '!', 'case', 'select',
      'coproc', '{', '}']
    const allWrappers = ['env', 'nohup', 'nice', 'xargs', 'timeout', 'stdbuf', 'setsid', 'command', 'ionice']
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)
    const badKwWrapper = []
    for (const k of allKw) for (const w of allWrappers) for (const b of kwBare) {
      const c = k + ' ' + w + ' ' + b
      if (runAllowI4(c).action === 'allow') badKwWrapper.push(c)
    }
    const badCap = []
    for (const k of allKw) for (const b of kwBare) {
      const c = k + ' ' + cap(b)
      if (runAllowI4(c).action === 'allow') badCap.push(c)
    }
    // 族 B 的第二形态：关键字 × wrapper × 大写命令（两族交集，单独钉一条防「只修一族」）
    const badCapWrapper = []
    for (const k of allKw) for (const w of allWrappers) for (const b of kwBare) {
      const c = k + ' ' + w + ' ' + cap(b)
      if (runAllowI4(c).action === 'allow') badCapWrapper.push(c)
    }
    // 族 C：**命令名重复且第二个是大写**（`diskpart Diskpart`、`dd DD`）───────────────
    // 这是「skip 表大小写归一」的**独有守卫点**，命令头覆盖盖不住它：
    // 命令头（`commandHeadEndFull`）只吃掉**第一个**命令名，第二个词元落在命令头之外，
    // 只能靠 `skip` 表把它跳掉。而 skip 表里登记的是 `headCommandNameOf` 返回的**小写**名字，
    // 循环里查的却是**原始词元** —— 少了 `skip[token.toLowerCase()]` 这一侧，
    // `Diskpart` 就查不中、被当成**非选项实参** → 判 false → 不归 unknown → 落 inside
    // → mode=allow 时静默放行。实测（变异：只去掉查表侧的大小写归一）：
    //   命令头覆盖保留、大小写归一去掉 → 穷举 6894 形态得 **1295 条分叉**，
    //   全部集中在「命令名重复」与「大写命令名」这两类；本组取前者的代表形态。
    // （「大写命令名」那一类由族 B 覆盖，但它**不是独有守卫**：命令头覆盖也能盖住它，
    //   故单靠族 B 无法让「去掉大小写归一」这个变异红灯 —— 族 C 才是。）
    const badCapRepeat = []
    for (const b of kwBare) {
      for (const c of [b + ' ' + cap(b), cap(b) + ' ' + b, b + ' ' + b.toUpperCase(), b.toUpperCase() + ' ' + b]) {
        if (runAllowI4(c).action === 'allow') badCapRepeat.push(c)
      }
    }
    // 对照（防过度收紧）：大写形态**带真实参**时仍须走半径档 —— 收紧的只是「裸跑」这一形态。
    // `PARTED /dev/sda` 与 `DD of=/dev/sda` 的 system 警告不得被这条修复改成「无法判定」。
    const capArgStillRadius = segBash(['PARTED', '/dev/sda']) === 'system'
      && segBash(['DD', 'of=/dev/sda']) === 'system'
      && segBash(['Diskpart']) === null
    ok('★★ L43i4g win32 + mode=allow：关键字 × 透明 wrapper × 裸跑交互、以及首字母大写命令名，两族都不得 allow',
      badKwWrapper.length === 0 && badCap.length === 0 && badCapWrapper.length === 0 && badCapRepeat.length === 0
      // 对照（防空转）：三族的裸形态本身必须非 allow，否则上面的过滤恒空
      && kwBare.every((b) => runAllowI4(b).action !== 'allow')
      // 对照（防过度收紧）：BARE 仍是形态判据，带真实参照旧判半径档
      && capArgStillRadius,
      JSON.stringify({ nKwWrapper: badKwWrapper.length, nCap: badCap.length, nCapWrapper: badCapWrapper.length,
        nCapRepeat: badCapRepeat.length, sampleKwWrapper: badKwWrapper.slice(0, 4), sampleCap: badCap.slice(0, 4),
        sampleCapRepeat: badCapRepeat.slice(0, 4),
        timeEnvDiskpart: runAllowI4('time env diskpart').action, timeDiskpart: runAllowI4('time Diskpart').action,
        diskpartDiskpart: runAllowI4('diskpart Diskpart').action,
        capArg: [segBash(['PARTED', '/dev/sda']), segBash(['DD', 'of=/dev/sda'])] }))
  }

  // ★★ L43k：**双向一致** —— `WIN_SLASH_SWITCH_CMDS` 的每个键都必须在 `DESTRUCTIVE_LABELS` 里。
  //    这条表是「吃 `/x` 开关的破坏性命令」的名单，而判据只在**破坏性命令**上生效
  //    （`blastRadiusOfSegment` 只在破坏性段上被调用）。往表里塞一个无关命令
  //    （`ls`、`git`、`robocopy`）不会改变任何行为，却会让「表 = 吃 /x 的破坏性命令」
  //    这句话失真 —— 日后有人照它推断覆盖范围就会得出错误结论。
  //    与既有断言 32（`GROUP_MEMBERS` 双向一致）同纪律：漂移必须让断言红灯，不能靠人记得。
  ok('★★ L43k WIN_SLASH_SWITCH_CMDS 的每一项都在 DESTRUCTIVE_LABELS 里（双向一致，防漂移）',
    Object.keys(WIN_SLASH_SWITCH_CMDS).every((k) => DESTRUCTIVE_LABELS.has(k)),
    JSON.stringify({ keys: Object.keys(WIN_SLASH_SWITCH_CMDS), notInList: Object.keys(WIN_SLASH_SWITCH_CMDS).filter((k) => !DESTRUCTIVE_LABELS.has(k)) }))

  // ★★ L44 `NAME=value` 只在**命令名之前**是赋值前缀；命令名之后可能是删除目标
  //    （`dd of=/dev/sda` —— `dd` 本身在破坏性名单里）。无条件跳过会丢掉整个目标。
  ok('★★ L44 dd of=… 的目标参与判档（命令名之后的 NAME=value 不是赋值前缀）',
    segBash(['dd', 'of=/dev/sda']) === 'system' && segBash(['dd', 'if=/dev/zero', 'of=/dev/sda']) === 'system'
    // 反面：真正的 env 赋值前缀仍跳过（`FOO=1 rm -rf /` 判的是 `/`，不是 `FOO=1`）
    && segBash(['FOO=1', 'rm', '-rf', '/']) === 'drive-root',
    JSON.stringify({ of: segBash(['dd', 'of=/dev/sda']), ifof: segBash(['dd', 'if=/dev/zero', 'of=/dev/sda']),
      prefix: segBash(['FOO=1', 'rm', '-rf', '/']) }))

  // ★★ L45 `broad` 档**只在例外模式路径**产出（段级不产出，见下）。
  //    段级若也判 broad，弹窗会对**命令**渲染 broad 的文案 —— 而那条文案是**规则**语境
  //    （「这条规则不限删除目标……它同样放行删除盘根与系统目录」），且对命令并不成立：
  //    `rm -rf *` 由 shell 展开为「当前目录下的全部条目」，删不到盘根。
  //    故段级对顶层通配仍返回 null（命令本身不警告），由「破坏性命令不给通配候选」
  //    在候选侧堵住「一次点击放行所有同类操作」。
  ok('★★ L45 段级不产出 broad（弹窗不渲染规则语境的文案）；模式级才是 broad',
    seg(['rm', '-rf', '*']) === null && seg(['rm', '-rf', '?']) === null
    && seg(['rmdir', '/s', '/q', '*']) === null
    && cpLvl('rm -rf *') === 'broad' && cpLvl('rm -rf ?') === 'broad'
    // 反面：带前缀的通配同样不判（被限定在某目录下）
    && seg(['rm', '-rf', 'build/*']) === null && seg(['rm', '-rf', '*.log']) === null,
    JSON.stringify({ segStar: seg(['rm', '-rf', '*']), patStar: cpLvl('rm -rf *'),
      buildstar: seg(['rm', '-rf', 'build/*']), logstar: seg(['rm', '-rf', '*.log']) }))

  // ★★ L46 提权前缀（`sudo`/`doas`/`pkexec`）的宽泛例外不得丢失标注。
  //    它们在 DESTRUCTIVE_LABELS 里但不在 WRAPPERS 里，故 segmentLabel 返回提权命令本身；
  //    「命令头」若只按 label 词数切，内层命令名 `rm` 会被当成目标实参 → 不走 broad。
  //    实测 `sudo rm -rf *` 能匹配 `sudo rm -rf /`（删盘根），零标注等于把审计点关掉。
  ok('★★ L46 提权前缀的宽泛例外仍判 broad（sudo/doas/pkexec rm -rf *）',
    cpLvl('sudo rm -rf *') === 'broad' && cpLvl('doas rm -rf *') === 'broad' && cpLvl('pkexec rm -rf *') === 'broad'
    && cpLvl('rm -rf *') === 'broad'
    // 盘根形态不被降级
    && cpLvl('sudo rm -rf /') === 'drive-root' && cpLvl('sudo rm -rf /*') === 'drive-root',
    JSON.stringify({ sudo: cpLvl('sudo rm -rf *'), doas: cpLvl('doas rm -rf *'), pk: cpLvl('pkexec rm -rf *'),
      plain: cpLvl('rm -rf *'), root: cpLvl('sudo rm -rf /') }))

  // ★★ L46b **普通命令的通配例外不得标 broad**（假警告）。
  //    这是 L46 原来的「反面」例子（`git status *` 判 broad）—— 那条断言固化的是**错误行为**：
  //    broad 的文案是「这条规则**不限**删除目标 —— 它同样放行删除盘根与系统目录」，
  //    而 `git status *` / `ls *` / `cat *` 放行不了任何删除命令（对 1500 条危险命令命中 0）。
  //    危害是注释里反复警告的「假警告会让真警告被忽略（狼来了）」：用户打开面板看到一片
  //    红标，于是不再看红标。
  //
  //    可达路径：index.js 的 exceptionBlast 入口过滤是 canCarryDestructivePayload，
  //    它对「提权/wrapper 前缀 + 普通命令」返回 true（前缀名本身在 PAYLOAD_CARRIERS 里），
  //    于是 `sudo ls *`、`env ls *`、`nohup ls *`、`timeout 5 ls *` 都会走到判 broad 那一行。
  //    无前缀的 `ls *` / `git status *` 到不了（入口就拦掉了），但直接调本函数仍须正确。
  //
  //    判据：命令头里真正吃目标的命令名必须是危险族（破坏性命令 / 载荷族 / 嵌套 shell）。
  //    注意不能用 `uw[0]` —— 前缀形态下它是 `sudo`/`env` 这类前缀名，而
  //    `sudo`/`doas`/`pkexec`/`su`/`runas`/`gsudo` **本身就在 DESTRUCTIVE_LABELS 里**，
  //    用它们判会把 `sudo ls *` 也标成危险（实测）。
  ok('★★ L46b 普通命令的通配例外不标 broad（sudo ls * / env ls * / ls * / git status * 是假警告）',
    cpLvl('ls *') === null && cpLvl('cat *') === null && cpLvl('echo *') === null
    && cpLvl('git status *') === null && cpLvl('git log *') === null && cpLvl('grep *') === null
    && cpLvl('sudo ls *') === null && cpLvl('doas cat *') === null && cpLvl('pkexec echo *') === null
    && cpLvl('env ls *') === null && cpLvl('nohup ls *') === null && cpLvl('timeout 5 ls *') === null
    && cpLvl('xargs ls *') === null && cpLvl('stdbuf -o0 ls *') === null && cpLvl('sudo -u root ls *') === null,
    JSON.stringify({ ls: cpLvl('ls *'), git: cpLvl('git status *'), sudoLs: cpLvl('sudo ls *'),
      envLs: cpLvl('env ls *'), nohupLs: cpLvl('nohup ls *') }))

  // ★★ L46c 危险族的通配例外**必须**仍标 broad（上面那道过滤不得误伤）。
  //    三类都要覆盖，每一类都是实测出来的：
  //      · 破坏性命令 —— `sudo rm -rf *` 放行 `sudo rm -rf /`；
  //      · 载荷族 —— `xargs *` 放行 `xargs rm -rf /`、`find *` 放行 `find / -delete`；
  //        （`xargs *` 的 `uw` 只剩 `["*"]`（wrapper 被剥），故判据必须扫命令头、
  //          不能只看某一个下标位置 —— 实测只看位置会漏掉这一族 32 个真警告）
  //      · 嵌套 shell —— `sh *` 放行 `sh -c "rm -rf /"`；
  //      · **路径形态的命令名** —— `/usr/bin/rm *` 放行 `/usr/bin/rm -rf /`。
  //        它含分隔符、是路径而非 cmd 开关，不得被 isCmdStyleSwitch 当 `/s` 那样跳过
  //        （实测那样会漏掉 18 个真警告）。
  ok('★★ L46c 危险族的通配例外仍标 broad（含路径形态与裸 wrapper）',
    cpLvl('xargs *') === 'broad' && cpLvl('env *') === 'broad' && cpLvl('find *') === 'broad'
    && cpLvl('sh *') === 'broad' && cpLvl('bash *') === 'broad'
    && cpLvl('sudo xargs *') === 'broad' && cpLvl('nohup xargs *') === 'broad'
    && cpLvl('timeout 5 xargs *') === 'broad' && cpLvl('sudo sh *') === 'broad'
    // 带**时长位置参数**的裸前缀：`timeout 5 *` 的 `5` 不是命令名，判据必须跳过它，
    // 否则 `last` 停在 `5` 上 → 判 null。而 `timeout 5 *` 实测放行 `timeout 5 rm -rf /`。
    // （变异测试发现：不跳过纯数字时长时这条断言是唯一能抓到该回归的）
    && cpLvl('timeout 5 *') === 'broad' && cpLvl('timeout 30s *') === 'broad'
    && cpLvl('timeout 1.5 *') === 'broad'
    // 嵌套 eval 族（`eval` / `iex` / `Invoke-Expression`）：`eval *` 实测放行
    // `eval "rm -rf /"`。判据必须含 NESTED_EVAL —— 去掉它这条会退化成 null。
    && cpLvl('eval *') === 'broad' && cpLvl('iex *') === 'broad'
    && cpLvl('Invoke-Expression *') === 'broad'
    // 路由器命令（headEnd=0 但 label 是多词）：`git rm *` / `docker rm *` 的
    // 第二词 `rm` 才是真命令名，故扫描范围必须回退到 `headLen`。
    // 实测 `git rm *` 放行 `git rm -rf /`（删工作区全部跟踪文件）。
    && cpLvl('git rm *') === 'broad' && cpLvl('git rm -rf *') === 'broad'
    && cpLvl('docker rm *') === 'broad'
    && cpLvl('sudo find *') === 'broad' && cpLvl('gsudo find *') === 'broad'
    && cpLvl('/usr/bin/rm *') === 'broad' && cpLvl('/usr/bin/find *') === 'broad'
    && cpLvl('/usr/bin/sh *') === 'broad' && cpLvl('sudo /usr/bin/rm *') === 'broad',
    JSON.stringify({ xargs: cpLvl('xargs *'), env: cpLvl('env *'), find: cpLvl('find *'), sh: cpLvl('sh *'),
      sudoXargs: cpLvl('sudo xargs *'), binRm: cpLvl('/usr/bin/rm *') }))

  // ★★ L47 wrapper / find 族的宽泛例外必须能被识别为「可能携带破坏性载荷」。
  //    `find *` 是 HEAD 的候选生成器对 `find . -delete` 给出的候选（必然存在的存量配置），
  //    实测能放行 `find / -delete`；而它的主 label 不在破坏性名单里，
  //    isDestructiveSegment 判 false → 例外列表零标注。canCarryDestructivePayload 补这一档。
  ok('★★ L47 find/env/xargs 的通配例外可被识别为携带破坏性载荷（存量 find * 不再零标注）',
    canCarryDestructivePayload(['find', '*']) === true
    && canCarryDestructivePayload(['env', '*']) === true
    && canCarryDestructivePayload(['xargs', '*']) === true
    && canCarryDestructivePayload(['find', '/', '-delete']) === true
    // 反面：普通命令不在此列（否则标注全是噪音，真警告会被忽略）
    && canCarryDestructivePayload(['git', 'status', '*']) === false
    && isPayloadCarrierLabel('git status') === false && isPayloadCarrierLabel('find') === true,
    JSON.stringify({ find: canCarryDestructivePayload(['find', '*']), env: canCarryDestructivePayload(['env', '*']),
      xargs: canCarryDestructivePayload(['xargs', '*']), git: canCarryDestructivePayload(['git', 'status', '*']) }))

  // ★★ L48 **无通配的载荷族例外不得标 broad**（假警告）。
  //    `nohup ./server.sh`、`env FOO=1 ls` 的 rest 为空，而判据曾是「rest 全是通配或为空
  //    ⇒ 不限定目标 ⇒ broad」—— 但它们的字面前缀匹配不到任何删除命令
  //    （实测 matchCommand('nohup ./server.sh','nohup rm -rf /') = false）。
  //    broad 的文案断言「它同样放行删除盘根与系统目录」，对这类例外是**假的**；
  //    假警告会让真警告被忽略（狼来了）。根因是 rest 按 unwrapWords 剥掉 wrapper 后切分，
  //    而 matchCommand 匹配的是含 wrapper 的原始文本，两者基准不同。
  //    判据同时查两侧：不该标的没标、该标的仍在（只查前者时「恒不标注」也会通过）。
  ok('★★ L48 无通配的载荷族例外不标 broad（nohup ./server.sh 放行不了任何删除）',
    cpLvl('nohup ./server.sh') === null && cpLvl('env FOO=1 ls') === null
    && cpLvl('timeout 30 ls') === null && cpLvl('xargs ls') === null && cpLvl('nohup ls') === null
    // 该标的必须仍在（否则「恒 null」这种退化也会通过）
    && cpLvl('env *') === 'broad' && cpLvl('find *') === 'broad'
    && cpLvl('rm -rf') === 'broad' && cpLvl('env FOO=1 *') === 'broad',
    JSON.stringify({ nohup: cpLvl('nohup ./server.sh'), envls: cpLvl('env FOO=1 ls'),
      timeoutls: cpLvl('timeout 30 ls'), xargs: cpLvl('xargs ls'),
      envStar: cpLvl('env *'), findStar: cpLvl('find *'), rmNoArg: cpLvl('rm -rf') }))
}


// ── M. 查找表不得继承 Object.prototype（原型属性名会被当成「表里有这一项」）────────
//
// 表用对象字面量构造时会继承 Object.prototype，于是 `TABLE['constructor']` 是真值
// （`function Object() { [native code] }`）。而本模块的查表处多数用**真值判断**
// （`if (!WRAPPERS[name]) break`、`if (NESTED_EVAL[base])`），于是命令名一旦命中
// 原型属性名，判定链就会走错分支。
//
// 判据不能只看源码文本（`dict(` 拼错了也照样匹配），必须**行为化**：拿原型属性名
// 当命令名跑真实判定链，断言它与同形状的普通未知命令**结论一致**。
//
// `commandNameOf` 会小写化，所以只有 `constructor` 与 `__proto__` 两个原型名逃得掉
// （`toString` → `tostring` 就不撞了）；带扩展名的形态同样要覆盖 ——
// `constructor.cmd` 剥掉后缀后还是 `constructor`。
group('M. 查找表无原型（原型属性名不得被当成表项）')

{
  // 金丝雀：拿原型属性名与同形状的普通名逐一对照，断言两者**同形**。
  //
  // 「同形」的判据：把结果里的**命令名本身**归一化掉再比。因为 label 本来就该是各自的
  // 命令名（`constructor` 的 label 是 `constructor`、`foo` 的是 `foo`），直接比字符串
  // 会把「正确行为」判成失败（实测踩过，21 条假红）。
  // 归一化后仍能抓到全部真实差异：污染造成的是**结构性**差别
  // （label 被吃成后面的词元、code 变成 unparsable、label 拼成两词），
  // 这些都与「名字具体是什么」无关。
  //
  // ⚠️ 必须比**段级**（label + code + action），不能只比顶层 action/code ——
  // 原型污染造成的差异几乎全在段级：`constructor rm -rf /` 与 `foo rm -rf /` 的
  // 顶层在多数配置下**都是同一个合并结果**，而段级一个是 `constructor/unparsable`
  // 一个是 `foo/-`。只比顶层会让断言空转（变异测试实测：5/9 漏网全是这个原因）。
  const shape = (cmd, name) => {
    const r = assessCommand(cmd, 'bash', hooks())
    // 该命令的**有效命令名**：取末段（`env constructor` 的有效名是 `constructor`，
    // 因为 wrapper 会被剥掉）、去扩展名、小写 —— 与 commandNameOf 同口径。
    // 只替换这一个名字，不替换整个 name 串：`sudo constructor` 的 label 是 `sudo`
    // （提权前缀，本来就不该被替换）。
    const last = name.split(/\s+/).pop()
    const base = last.replace(/\.(?:exe|cmd|bat|com|ps1)$/i, '').toLowerCase()
    return r.action + ' :: ' + r.segments.map((s) => {
      const l = s.label || '∅'
      return (l.toLowerCase() === base ? '<CMD>' : l) + '/' + (s.code || '-') + '/' + s.action
    }).join(' | ')
  }
  const cmp = (proto, plain, tail) => {
    const a = shape(proto + tail, proto)
    const b = shape(plain + tail, plain)
    return { same: a === b, proto: a, plain: b }
  }

  const cases = [
    // ① 误报方向：原型名曾被当成「嵌套 shell / 语句关键字」，把后面的真命令吃成内联程序。
    //    普通名 `foo` 的结论才是基准（未知命令，不该被当 shell）。
    ['constructor', 'foo', ' rm -rf /'],
    ['__proto__', 'foo', ' rm -rf /'],
    // ② 候选死结方向：label 被吃成 `x` 后，候选生成器产出 `x *`，匹配不上原命令。
    //    断言 label 必须是命令名本身，不能是它后面的词元。
    ['constructor', 'foo', ' x'],
    ['__proto__', 'foo', ' x'],
    // ③ 裸命令：label 曾成空串 → 判 unparsable → allow 例外被跳过。
    ['constructor', 'foo', ''],
    ['__proto__', 'foo', ''],
    // ④ 带扩展名的脚本（`constructor.cmd` 剥后缀后仍撞原型名）
    ['constructor.cmd', 'foo.cmd', ' x'],
    ['constructor.exe', 'foo.exe', ' rm -rf /'],
    ['constructor.ps1', 'foo.ps1', ' x'],
    // ⑤ 包装器/提权前缀之后的形态（`env constructor …` 曾被剥成透明包装器）
    ['env constructor', 'env foo', ' x'],
    ['sudo constructor', 'sudo foo', ' x'],
    // ⑥ 大小写不敏感：大写形态经 commandNameOf 小写化后同样撞名
    ['CONSTRUCTOR', 'FOO', ' x'],
    // ⑦ 内联程序 flag：原型名曾被 NESTED_SHELLS / NESTED_INTERPRETERS 当成解释器，
    //    于是 `constructor -c "x"` 被判「带内联程序」→ unparsable（而它不是解释器）。
    ['constructor', 'foo', ' -c "x"'],
    ['constructor', 'foo', ' -e x'],
    ['constructor', 'foo', ' -lc "x"'],
    ['__proto__', 'foo', ' --eval x'],
    ['constructor', 'foo', ' -exec rm {} +'],
    ['constructor', 'foo', ' -delete'],
    ['constructor', 'foo', ' -S "x"'],
    // ⑧ 路由器命令：原型名曾被 ROUTER_CMDS 命中，label 被拼成 `constructor x`（两词）
    ['constructor', 'foo', ' status'],
    ['constructor', 'foo', ' -u x'],
  ]
  for (const [proto, plain, tail] of cases) {
    const r = cmp(proto, plain, tail)
    ok('★ 原型属性名与普通名同形：' + JSON.stringify(proto + tail),
      r.same, '原型名=' + r.proto + '  普通名=' + r.plain)
  }

  // 反向控制：**必须**有输入能区分「表里真有这一项」与「没这一项」，
  // 否则上面的断言可能因为「两条路径都恒等」而空转（变异测试会漏掉把表改回字面量的改动）。
  //
  // 用 `eval`（NESTED_EVAL 的真成员，必判 unparsable）对 `zzq`（绝不在任何表里）。
  // 注意不能用 `sh -c "x"` 做控制：它在 category=allow 下与 `zzq -c "x"` 的
  // **段级 code 都是 null**（`sh -c` 的 unparsable 只在 `nestedInlineProgram` 判，
  // 而该判据对 `sh -c` 之外的形态也成立），区分不出来（实测踩过，断言假红）。
  ok('★ 反向控制：表的真成员与普通名结论不同（证明上组断言非空转）',
    shape('eval x', 'eval') !== shape('zzq x', 'zzq'),
    JSON.stringify({ eval: shape('eval x', 'eval'), zzq: shape('zzq x', 'zzq') }))

  // 显式探针：直接确认原型属性名不再是任何表的成员。
  // 这一条覆盖「表被改回字面量」的回归 —— 上面几条行为断言对某些表可能不敏感。
  ok('★★ Object.prototype 的属性名不得命中任何内部表',
    (function () {
      const protos = Object.getOwnPropertyNames(Object.prototype)
      // 经真实链路观察：这些名字若被当成表项，判定结果会与普通名不同。
      // 逐个与普通名 `zzq` 对照（一个绝不可能出现在任何表里的名字）。
      // 覆盖多种后缀 —— 不同表被命中时暴露的后缀不同（解释器 flag / 路由器子命令 / 包装器选项）。
      const tails = ['', ' x', ' -c "x"', ' -e x', ' status', ' -u x', ' -exec rm {} +', ' -delete']
      for (const p of protos) {
        for (const t of tails) {
          if (shape(p + t, p) !== shape('zzq' + t, 'zzq')) return false
        }
      }
      return true
    })())

  // `rawCommandNames` 的去重集合同样无原型：`constructor` 曾被判「已见过」而丢弃。
  ok('★ rawCommandNames 不丢原型属性名（去重集合无原型）',
    rawCommandNames('constructor -rf / && __proto__ x').includes('constructor'),
    JSON.stringify(rawCommandNames('constructor -rf / && __proto__ x')))
}


// ─────────────────────────────────────────────────────────────────────────────
group('T. 破坏性命令八档体系（计划 blast-tier-plan.md）')
{
  // 源码文本（供结构断言用：派生关系、单一来源等）。与 regressions.mjs 同法读取。
  const spSrc = readFileSync(pathJoin(ROOT, 'shell-parse.js'), 'utf8')
  // 探针选项：与宿主 index.js 的 assessCommand 调用点同契约。
  // 关键是 isWorkspaceRoot —— 它是本计划新增的钩子（§5.5），解析器判不了「这是工作区根」。
  //
  // **必须与宿主的 isOutside / isWorkspaceRoot 逐字同口径**（`norm` → 相对路径拼根 →
  // `pathResolve` 归一）。差别会直接改变结论：`globRootOf('.')` 返回 `.`，
  // 而 `.` 经 pathResolve 归一后**就是工作区根** —— 少了这一步，`rm -rf .` 判不出
  // workspace-root，本组断言会假红（实测踩过）。
  // 这与宿主那两处「归一逻辑只有一份」的纪律是同一件事：探针也不该另写一份口径。
  const hostNorm = (p) => {
    const s = String(p).replace(/\\/g, '/')
    return (s.indexOf('/') === 0 || /^[a-zA-Z]:/.test(s)) ? s : WS + '/' + s
  }
  const fixRoot = (v) => pathResolve(/^[a-zA-Z]:$/.test(v) ? v + '/' : v)
  const tierOpts = (platform) => ({
    home: HOME, userHome: HOME, platform: platform || 'win32',
    isOutsideWorkspace: (p) => {
      const a = fixRoot(hostNorm(p)).toLowerCase()
      const r = fixRoot(WS).toLowerCase()
      if (a === r) return false
      const endSep = r.endsWith('/') || r.endsWith('\\')
      if (endSep) return a.indexOf(r) !== 0
      return a.indexOf(r + '/') !== 0 && a.indexOf(r + '\\') !== 0
    },
    isWorkspaceRoot: (p) => fixRoot(hostNorm(p)).toLowerCase() === fixRoot(WS).toLowerCase(),
  })
  // 取一段的 words / blast / labels / tiers（走真实链路，不手工构造词元）
  const segOf = (cmd, shell, platform) => {
    const d = decomposeCommand(cmd, shell || 'bash')
    if (!d.ok || !d.segments.length) return null
    const w = d.segments[0].words
    const o = tierOpts(platform)
    const b = blastRadiusOfSegment(w, o)
    const lb = segmentLabels(w)
    return { w, b, lb, t: tierSetOf({ words: w, blast: b }, lb, o) }
  }
  const tiersOf = (cmd, shell, platform) => { const s = segOf(cmd, shell, platform); return s ? s.t : null }
  const blastOf = (cmd, shell, platform) => { const s = segOf(cmd, shell, platform); return s && s.b ? s.b.level : null }

  // ── 32：分组双向一致 ────────────────────────────────────────────────────────
  // 分组表的注释从一开始就在 DESTRUCTIVE_LABELS 上（6 组），但代码里没有任何一处消费它。
  // 本计划把它变成真表之后，**双向一致**是必须由断言守住的不变量：
  // 新增 label 忘了分组 → 该命令静默落 inside 档（最需要防的漂移，不能靠人记得）。
  ok('★★ 32 分组与名单双向一致（并集 = DESTRUCTIVE_LABELS、无重复、无遗漏）', (function () {
    const all = []
    for (const g of Object.keys(GROUP_MEMBERS)) for (const l of GROUP_MEMBERS[g]) all.push(l)
    const uniq = new Set(all)
    const dup = all.filter((x, i) => all.indexOf(x) !== i)
    const ungrouped = [...DESTRUCTIVE_LABELS].filter((l) => !GROUP_OF_LABEL[l])
    const notInList = all.filter((l) => !DESTRUCTIVE_LABELS.has(l))
    return dup.length === 0 && ungrouped.length === 0 && notInList.length === 0
      && uniq.size === DESTRUCTIVE_LABELS.size
  })(), JSON.stringify((function () {
    const all = []
    for (const g of Object.keys(GROUP_MEMBERS)) for (const l of GROUP_MEMBERS[g]) all.push(l)
    return { dup: all.filter((x, i) => all.indexOf(x) !== i), ungrouped: [...DESTRUCTIVE_LABELS].filter((l) => !GROUP_OF_LABEL[l]), notInList: all.filter((l) => !DESTRUCTIVE_LABELS.has(l)) }
  })()))
  // GROUP_OF_LABEL 必须是 GROUP_MEMBERS 的**派生**（不是第二份手写清单）——
  // 两张手写的表迟早漂移，而漂移的后果是某个命令落进错的组、拿错判据、静默落 inside。
  ok('★★ 32b GROUP_OF_LABEL 由 GROUP_MEMBERS 派生（不是第二份手写清单）',
    (function () {
      const sp2 = spSrc
      // 派生点必须是那个双重循环，且不存在手写的 label→组 字面量
      return /for \(const g of Object\.keys\(GROUP_MEMBERS\)\)[\s\S]{0,120}?for \(const l of GROUP_MEMBERS\[g\]\) m\[l\] = g/.test(sp2)
        && !/GROUP_OF_LABEL = dict\(\{/.test(sp2)
    })())

  // ── 33：段级 unknown（§4 的三种 null 必须分开）──────────────────────────────
  // `rm -rf $TARGET` 与 `rm -rf ./build` 的段级 blast 曾经**都是 null**，
  // 于是两者都落 inside 档（大分类 allow 时不弹窗）—— 而前者的真实目标可能是任意路径。
  ok('★★ 33 段级 unknown：读不出目标归 unknown，判过档的 inside 仍是 null',
    blastOf('rm -rf $TARGET') === 'unknown'
    && blastOf('rm -rf ./build') === null
    && tiersOf('rm -rf $TARGET').indexOf('unknown') !== -1
    && tiersOf('rm -rf ./build').indexOf('inside') !== -1,
    JSON.stringify({ dyn: blastOf('rm -rf $TARGET'), inside: blastOf('rm -rf ./build'), t1: tiersOf('rm -rf $TARGET'), t2: tiersOf('rm -rf ./build') }))

  // ── 34：段级 workspace-root（§5.5）─────────────────────────────────────────
  // 一族五种写法实测全部落 inside 档 —— mode=allow 时删掉整个项目**不弹窗**。
  // 判据必须与 isOutside 同口径，故这里用与宿主 isOutside 同形的钩子。
  {
    const hit = ['rm -rf .', 'rm -rf *', 'rm -rf ./*', 'Remove-Item -Recurse -Force .', 'rmdir /s /q .',
      // ★★ 尾随分隔符 + `..` 归约回根的一族（实测 fail-open，见下方注释）。
      //    `globRootOf` **不剥尾随分隔符**：`'a/../'.split(/[\\/]/)` = `['a','..','']`，
      //    末段是**空串**而非 `..`。预筛曾只认「末段**恰好等于** `.` / `..`」，于是这一族
      //    被判 allDots=false、无纯星号段 → 预筛返 false → **钩子根本不被调用**。
      //    而 `blastRadiusOf('a/../')` 归一后是 `{level:'inside', path:'a/..'}`，
      //    宿主 `isWorkspaceRoot('a/..')` 本会判真 —— 即**整个工作区**。
      //    实测（修复前，mode=allow）：`rm -rf a/../` 静默放行，而 `resolve('a/../')`
      //    就是工作区根 —— 删除后果与 `rm -rf .` 完全一致。
      'rm -rf a/../', 'rm -rf ./build/../', 'rm -rf a/../*',
      //    同源：`..` 弹栈归约后为空或只剩纯星号段（`a/b/../../*` 归约后为 `*`）；
      //    尾随双分隔符（`a/..//` → `['a','..','','']`）同属「末段是空串」那一类。
      'rm -rf a/b/../../*', 'rm -rf a/..//']
    // ★★ 带**锚点**的通配必须落 miss：`globRootOf('*.log')` / `globRootOf('build*')` /
    //    `globRootOf('?')` 与 `globRootOf('*')` 一样都归约成 `.`，故只要预筛按「含不含通配符」
    //    放行，宿主 `isWorkspaceRoot('.')` 就恒真 → 判成「删整个项目」（wide 档）。
    //    实测（修复前）：`rm -rf *.log` / `rm -rf build*` / `rm -rf ?` 全部 blast=workspace-root、
    //    tiers=['wide'] —— 把 wide 设为 deny 的用户会**直接拒绝** `rm -rf *.log`，而
    //    `rm -rf ./build` 仍是 allow/inside。§5.5 覆盖表只列了 `*` / `./*` / `.\*` 这类
    //    **整段纯通配**，带锚点的通配不在表内；文案「整个项目的文件都会被删除」对它们是假话。
    //    注意这三条在 L45 里用**无钩子**的 bOpts 断言段级 null —— 无钩子时两者同值，
    //    故 L45 对该缺陷恒绿、守不住它；必须在这里（带钩子）钉住。
    const miss = ['rm -rf ./build', 'rm -rf src/tmp', 'rm -rf build', 'rm -rf ..', 'rm -rf ../other',
      'rm -rf *.log', 'rm -rf build*', 'rm -rf ?']
    const badHit = hit.filter((c) => blastOf(c, 'bash') !== 'workspace-root')
    const badMiss = miss.filter((c) => blastOf(c, 'bash') === 'workspace-root')
    ok('★★ 34 工作区根：五种写法全命中 workspace-root，普通目标与带锚点通配不误判',
      badHit.length === 0 && badMiss.length === 0, JSON.stringify({ badHit, badMiss }))
    // ★★ `..` 归约**越出根之外**的一族必须仍判 outside —— 不得因新增弹栈归约被误判成根。
    //    判据里的弹栈在栈顶已是 `..` 时**再压一个 `..`**（而不是「一律弹空」），本组就是
    //    钉住那一处的：若写成「一律弹空」，`*.log/../../*` 归约后只剩 `*` → 误判
    //    workspace-root（实测 40 条新误报）。方向虽是 fail-safe 的多警告，但那是判据错误：
    //    用户把 wide 设为 deny 时，`rm -rf *.log/../../*` 会被**直接拒绝**。
    const pastRoot = ['rm -rf ../', 'rm -rf ../other', 'rm -rf ../../', 'rm -rf a/../..',
      'rm -rf *.log/../../*', 'rm -rf build*/../../*', 'rm -rf ?/../../*']
    const badPast = pastRoot.filter((c) => blastOf(c, 'bash') === 'workspace-root')
    ok('★★ 34c 归约越出工作区根之外（`../`、`a/../..`、`*.log/../../*`）不得误判成 workspace-root',
      badPast.length === 0, JSON.stringify(badPast))
    // ★★ 族级守卫：报告族（含同源扩展）逐条必须命中。上面的 hit 是**抽样**，
    //    这里按「尾随分隔符 + `..` 归约」的判据把整族钉住 —— 只修 `a/../` 一条、
    //    或只做「跳过尾随空段」而不做 `..` 弹栈归约（= 修法 A），都会在这里变红。
    const family = ['rm -rf a/../', 'rm -rf build/../', 'rm -rf src/../', 'rm -rf ./build/../',
      'rm -rf node_modules/../', 'rm -rf x/../', 'rm -rf ./a/../', 'rm -rf a/..//',
      'rm -rf a/../*', 'rm -rf src/../*', 'rm -rf a/b/../../*', 'rm -rf ./a/../*',
      'rm -rf **/a/../', 'rm -rf **/build/../*', 'rm -rf *.log/../', 'rm -rf *.log/../*']
    const badFamily = family.filter((c) => blastOf(c, 'bash') !== 'workspace-root')
    ok('★★ 34d 「尾随分隔符 / `..` 弹栈归约回根」整族 16 条全部命中 workspace-root',
      badFamily.length === 0, JSON.stringify(badFamily))
    // ★★ 34e `..` 抵消后**回到工作区根**的一族（`../<rootName>`）必须命中 —— 且**必须带钩子**。
    //    上面 34/34c/34d 三条**都守不住它**：`rm -rf ..` 与 `rm -rf ../other` 恰在 34 的 miss
    //    侧（只断言「不误判成根」，没断言「是不是根」），而这一族的真值**就是**工作区根。
    //    故它此前恒绿 —— 实测漏判（预筛返 false → 钩子 0 次调用 → 落 inside 档）：
    //        root = `X:/ws` 时 `rm -rf ../ws` → allow、tiers=['inside']、钩子 **0 次**，
    //        而 `rm -rf .` 是 ask/wide、`rm -rf ../other` 是 ask/outside。
    //    即「在子目录里用 `../<项目名>` 回删整个项目」**静默删除**，弹窗 0 次。
    //    判据必须**逐条实测钩子调用次数**：只断言 `blastOf(...) === 'workspace-root'` 时，
    //    若把预筛改成「一律 return true」，本条会因宿主的 isWorkspaceRoot 而**假绿**
    //    （见下面的 antiNoop 对照：无钩子时这一族必须与 `./build` 同值）。
    {
      // 根名取 WS 的尾段（`X:/ws` → `ws`），一族写法按 `..` 抵消后**恰好回到 WS**构造。
      const rootName = WS.split('/').filter(Boolean).pop()
      const backToRoot = [
        'rm -rf ../' + rootName, 'rm -rf ./../' + rootName, 'rm -rf sub/../../' + rootName,
        'rm -rf ..//' + rootName, 'rm -rf ../' + rootName + '/', 'rm -rf ../' + rootName + '//',
        'rm -rf .././' + rootName, 'rm -rf a/b/../../../' + rootName,
        'Remove-Item -Recurse -Force ../' + rootName, 'rmdir /s /q ../' + rootName,
      ]
      const badHit = backToRoot.filter((c) => blastOf(c, 'bash') !== 'workspace-root')
      // 防空转对照：**无钩子**时这一族必须**不**是 workspace-root（与 `rm -rf ./build` 同值）。
      // 少了这一条，「预筛一律放行」也能让上面的 badHit 全绿 —— 断言就空转了。
      const noHookOpts = tierOpts('win32'); delete noHookOpts.isWorkspaceRoot
      const noHook = (c) => {
        const d = decomposeCommand(c, 'bash')
        if (!d.ok || !d.segments.length) return null
        const b = blastRadiusOfSegment(d.segments[0].words, noHookOpts)
        return b ? b.level : null
      }
      const badNoHook = backToRoot.filter((c) => noHook(c) === 'workspace-root')
      ok('★★ 34e 「`..` 抵消后回到工作区根」（../<rootName> 一族 10 条）必须命中 workspace-root（带钩子）',
        badHit.length === 0 && badNoHook.length === 0,
        JSON.stringify({ badHit, badNoHook, rootName }))
      // ★★ 34f 同族的**钩子调用次数**必须 > 0 —— 这才是 34e 真正的缺陷面。
      //    `blastOf` 走的是带钩子的 opts，但断言 workspace-root 只能证明「结论对」，
      //    证明不了「预筛放行了」：宿主日后把 isWorkspaceRoot 换成「对任意相对路径都返 true」
      //    的假实现，34e 依旧全绿。故直接数钩子次数（这也是本次缺陷的**唯一**观测面：
      //    修复前该族钩子 0 次、修复后 1 次）。
      let hookCalls = 0
      const countingOpts = tierOpts('win32')
      const inner = countingOpts.isWorkspaceRoot
      countingOpts.isWorkspaceRoot = (p) => { hookCalls += 1; return inner(p) }
      const d = decomposeCommand('rm -rf ../' + rootName, 'bash')
      blastRadiusOfSegment(d.segments[0].words, countingOpts)
      ok('★★ 34f 回到根的一族必须真的**调用** isWorkspaceRoot 钩子（预筛不得静默早退）',
        hookCalls > 0, JSON.stringify({ hookCalls, cmd: 'rm -rf ../' + rootName }))
      // ★ 34g 过度收紧对照：普通区内路径与**越出根之外**的写法不得因本判据被误判成根。
      //    `../other` / `..` / `../../other` 归约后指向根之外（isOutside 判 true），
      //    而 `./build` / `build` / `src/tmp` 是区内普通路径 —— 三者都**不是**根。
      const notRoot = ['rm -rf ./build', 'rm -rf build', 'rm -rf src/tmp', 'rm -rf ../other',
        'rm -rf ..', 'rm -rf ../../other', 'rm -rf ../sibling/build', 'rm -rf a/../b', 'rm -rf ./a/./b']
      const badNotRoot = notRoot.filter((c) => blastOf(c, 'bash') === 'workspace-root')
      ok('★ 34g 过度收紧对照：区内普通路径与根之外写法（9 条）不得被判成 workspace-root',
        badNotRoot.length === 0, JSON.stringify(badNotRoot))
      // ★★ 34h `../<rootName>` 的**通配形态**必须与**非通配形态同值**（本轮修复）。
      //    机制：外层那条「`..` 归约回根」的判据带 `!/[*?]/` 守卫（为保 34c 而设），
      //    于是**含通配的同族**被预筛挡在门外 → `isWorkspaceRoot` 钩子 0 次调用
      //    → 段级 blast 落 inside。实测（修复前，root=`X:/ws`、八档 inside=allow 其余 ask）：
      //        rm -rf ../ws        → ask  tiers=['wide']      blast=workspace-root  hookCalls=1
      //        rm -rf ../ws/*      → **allow** tiers=['inside'] blast=null          hookCalls=**0**
      //    同族（`./../ws/*`、`sub/../../ws/*`、`..//ws/*`、`../ws/*//`、`rmdir /s /q ../ws/*`、
      //    `Remove-Item -Recurse -Force ../ws/*`）全部 allow —— 即「在子目录里用
      //    `../<项目名>/*` 回删整个项目」静默删除，而只少一个 `*` 的写法会 ask。
      //    第二后果：`blastRadiusOfCommandPattern('rmdir /s /q ../ws/*')` 也是 null
      //    （对照 `rm -rf *` = broad、`rm -rf a/../*` = workspace-root），即**例外标注**
      //    （面板事后发现「我放行了删项目根」的唯一入口）对该族零标注。
      //
      //    判据取「**同族非通配形态同值**」而不是硬写 `workspace-root`：后者在宿主钩子
      //    换成假实现时照样绿（见 34f 的教训），而「同值」是根因判据 —— 通配只该影响
      //    展开范围，不该影响「这个目标是不是项目根」。
      const globFam = [
        'rm -rf ../' + rootName + '/*', 'rm -rf ../' + rootName + '/**',
        'rm -rf ../' + rootName + '/*//', 'rm -rf ../' + rootName + '/*/',
        'rm -rf ./../' + rootName + '/*', 'rm -rf sub/../../' + rootName + '/*',
        'rm -rf a/b/../../../' + rootName + '/*', 'rm -rf ..//' + rootName + '/*',
        'rm -rf ../' + rootName + '/./*', 'rm -rf .././' + rootName + '/*',
        'rmdir /s /q ../' + rootName + '/*', 'Remove-Item -Recurse -Force ../' + rootName + '/*',
        'del /f /s /q ../' + rootName + '/*', 'shred ../' + rootName + '/*',
      ]
      // 判据 = 「与同族**非通配**形态逐条同值」（见上面的理由）—— 而不是硬写 `workspace-root`。
      const nonGlobTwin = (c) => c.replace(/\/(?:\*\*?|\.)\/?$/, '')
      const badGlob = globFam.filter((c) => blastOf(c, 'bash') !== blastOf(nonGlobTwin(c), 'bash'))
      // 防空转对照⓪：对照形态本身必须判得出根（否则「同值」可能是「两边都不是根」）
      const badTwin = globFam.filter((c) => blastOf(nonGlobTwin(c), 'bash') !== 'workspace-root')
      // 防空转对照①：**无钩子**时这一族必须**不**是 workspace-root（与 `rm -rf ./build` 同值）
      const badGlobNoHook = globFam.filter((c) => noHook(c) === 'workspace-root')
      // 防空转对照②：带**锚点**的通配（`*.log` / `build*` / `?`）在同位置**不得**判成根 ——
      // 它们展开后只覆盖部分条目（`../<root>/*.log` 删不掉整个项目），若判据写成
      // 「含 `..` 且末段含 `*` 就放行」，这三条会立刻变红。
      const anchored = ['rm -rf ../' + rootName + '/*.log', 'rm -rf ../' + rootName + '/build*',
        'rm -rf ../' + rootName + '/?', 'rm -rf ../' + rootName + '/a?.txt']
      const badAnchored = anchored.filter((c) => blastOf(c, 'bash') === 'workspace-root')
      // 防空转对照③：该族必须**真的调用钩子**（修复前是 0 次 —— 这是本缺陷唯一的观测面）
      let globHookCalls = 0
      const gOpts = tierOpts('win32')
      const gInner = gOpts.isWorkspaceRoot
      gOpts.isWorkspaceRoot = (p) => { globHookCalls += 1; return gInner(p) }
      const gd = decomposeCommand('rm -rf ../' + rootName + '/*', 'bash')
      blastRadiusOfSegment(gd.segments[0].words, gOpts)
      ok('★★ 34h 「`..` 归约回根」的**通配形态**（../<rootName>/* 一族 14 条）必须与同族非通配形态同值，且真的调用钩子',
        badGlob.length === 0 && badTwin.length === 0 && badGlobNoHook.length === 0
        && badAnchored.length === 0 && globHookCalls > 0,
        JSON.stringify({ badGlob, badTwin, badGlobNoHook, badAnchored, globHookCalls, rootName }))
      // ★★ 34i 例外模式（`blastRadiusOfCommandPattern`）同族必须与段级一致 ——
      //    面板的例外标注是「事后发现我放行了删项目根」的唯一入口，该族此前零标注。
      //    判据同样取「同族非通配形态同值」（对照 `rm -rf *` = broad）。
      const patOf = (c) => {
        const d = decomposeCommand(c, 'bash')
        if (!d.ok || !d.segments.length) return null
        const r = blastRadiusOfCommandPattern(d.segments[0].words, tierOpts('win32'))
        return r ? r.level + '|' + r.path : 'null'
      }
      const patPairs = [
        ['rmdir /s /q ../' + rootName + '/*', 'rmdir /s /q ../' + rootName],
        ['rm -rf ../' + rootName + '/*', 'rm -rf ../' + rootName],
        ['Remove-Item -Recurse -Force ../' + rootName + '/*', 'Remove-Item -Recurse -Force ../' + rootName],
      ]
      const badPat = patPairs.filter(([a, b]) => patOf(a) !== patOf(b)).map(([a, b]) => [a, patOf(a), b, patOf(b)])
      ok('★★ 34i 例外标注：`../<rootName>/*` 一族的 blastRadiusOfCommandPattern 必须与同族非通配形态同值',
        badPat.length === 0, JSON.stringify({ badPat, sample: patOf('rmdir /s /q ../' + rootName + '/*') }))
      // ★★ 34j 端到端：八档默认（inside=allow 其余 ask）下，该族必须与同族非通配形态
      //    **逐条同值**（ask / wide / workspace-root）—— 这是用户可见的后果面：
      //    修复前 `rm -rf ../ws/*` 是 **allow**（弹窗 0 次、日志无记录），
      //    而 `rm -rf ../ws` 是 ask —— 只差一个 `*`。
      const e2eTwin = (c) => {
        const h = tierOpts('win32')
        h.destructive = () => ({ inside: 'allow', outside: 'ask', wide: 'ask', unknown: 'ask', proc: 'ask', power: 'ask', priv: 'ask', reg: 'ask' })
        h.category = () => ({ action: 'allow' })
        const r = assessCommand(c, 'bash', h)
        const s0 = r.segments[0] || {}
        return r.action + '|' + (s0.tiers || []).join(',') + '|' + (s0.blast ? s0.blast.level : 'null')
      }
      const badE2e = globFam.filter((c) => e2eTwin(c) !== e2eTwin(nonGlobTwin(c)))
        .map((c) => [c, e2eTwin(c), nonGlobTwin(c), e2eTwin(nonGlobTwin(c))])
      ok('★★ 34j 端到端：八档默认下 `../<rootName>/*` 一族必须与同族非通配形态同值（ask/wide/workspace-root）',
        badE2e.length === 0 && e2eTwin('rm -rf ../' + rootName + '/*') === 'ask|wide|workspace-root',
        JSON.stringify({ badE2e, sample: e2eTwin('rm -rf ../' + rootName + '/*') }))
    }
    // 归 wide 档（§5.1 的映射表），且**不是** inside
    ok('★ 34b workspace-root 归 wide 档（删整个项目不再静默）',
      tiersOf('rm -rf .').indexOf('wide') !== -1 && tiersOf('rm -rf .').indexOf('inside') === -1,
      JSON.stringify(tiersOf('rm -rf .')))
  }

  // ── 35：BLAST_ORDER 含新 level 且序正确 ────────────────────────────────────
  ok('★ 35 BLAST_ORDER 含 workspace-root 与 unknown，且序为「盘根 > 项目根 > broad > unknown > system」',
    BLAST_ORDER['drive-root'] < BLAST_ORDER['workspace-root']
    && BLAST_ORDER['workspace-root'] < BLAST_ORDER.broad
    && BLAST_ORDER.broad < BLAST_ORDER.unknown
    && BLAST_ORDER.unknown < BLAST_ORDER.system
    && BLAST_ORDER.system < BLAST_ORDER.home && BLAST_ORDER.home < BLAST_ORDER.outside
    && BLAST_ORDER.outside < BLAST_ORDER.inside,
    JSON.stringify(BLAST_ORDER))

  // ── 36：组档 ────────────────────────────────────────────────────────────────
  ok('★ 36 组档：kill/taskkill → proc；shutdown/reboot → power；reg delete/wmic → reg',
    tiersOf('kill 1234', 'bash', 'posix').indexOf('proc') !== -1
    && tiersOf('taskkill /im x.exe', 'pwsh', 'win32').indexOf('proc') !== -1
    && tiersOf('shutdown /s', 'pwsh', 'win32').indexOf('power') !== -1
    && tiersOf('reboot', 'bash', 'posix').indexOf('power') !== -1
    && tiersOf('reg delete HKLM\\Software\\X /f', 'pwsh', 'win32').indexOf('reg') !== -1
    && tiersOf('wmic process delete', 'pwsh', 'win32').indexOf('reg') !== -1,
    JSON.stringify({ kill: tiersOf('kill 1234', 'bash', 'posix'), shutdown: tiersOf('shutdown /s', 'pwsh', 'win32'), reg: tiersOf('reg delete HKLM\\Software\\X /f', 'pwsh', 'win32') }))
  // 组档**不看 blast**（proc/power/reg 的 blast 结构性恒 null）——
  // 判据是 label，故带不带参数都归同一档。
  //
  // 注意对照组的选择：`kill -9 /tmp/x` 的 blast **不是** null（实测 outside —— 硬塞路径
  // 进去就有输出，但那正是计划 §9.2 说的「无意义输入」）。所以这里不能用它证明
  // 「blast 恒 null」，而应当证明**判据与 blast 无关**：两条 blast 不同的命令归同一档。
  ok('★ 36b 组档判据与目标无关：kill 的两种形态（blast 一个 null 一个 outside）同归 proc',
    blastOf('kill 1234', 'bash', 'posix') === null
    && blastOf('kill -9 /tmp/x', 'bash', 'posix') === 'outside'
    && tiersOf('kill 1234', 'bash', 'posix').join(',') === 'proc'
    && tiersOf('kill -9 /tmp/x', 'bash', 'posix').join(',') === 'proc'
    && tiersOf('shutdown', 'bash', 'posix').join(',') === 'power'
    && tiersOf('shutdown -h now', 'bash', 'posix').join(',') === 'power',
    JSON.stringify({ k1: blastOf('kill 1234', 'bash', 'posix'), k2: blastOf('kill -9 /tmp/x', 'bash', 'posix'), t1: tiersOf('kill 1234', 'bash', 'posix'), t2: tiersOf('kill -9 /tmp/x', 'bash', 'posix') }))

  // ── 37/38：segmentPrivilege 正反例（§9.3 的 31 条）─────────────────────────
  {
    // 路径形态的提权命令名（`C:\Windows\System32\runas.exe`）**只在 pwsh 方言下**能识别 ——
    // bash 词法器把反斜杠当转义符吃掉，整个路径并成一个词元 `C:WindowsSystem32runas.exe`
    // （那是**词法器**的边界，不是本判据的缺陷）。故这一条显式用 pwsh 方言，
    // 与它同形的 `/usr/bin/sudo ls` 用 bash 方言 —— 两者各测各自方言下的路径形态。
    const pos = ['sudo rm -rf /', 'sudo ls', 'doas ls', 'env FOO=1 sudo rm -rf /',
      'timeout 5 sudo rm -rf /', 'nice sudo rm -rf /', 'xargs sudo rm',
      'find . -exec sudo rm {} ;', 'find . -exec env sudo rm {} ;',
      'su -c "rm -rf /"', 'runas /user:admin cmd', 'sudo -u root rm -rf /x',
      'su -c rm -rf /', 'su root', 'su -c C:/Windows', 'sudo su -c "rm -rf /"',
      'sudo doas pkexec ls', '/usr/bin/sudo ls', 'sudo.exe ls']
    const bad = []
    for (const c of pos) {
      const d = decomposeCommand(c, 'bash')
      if (!d.ok || !d.segments.length) { bad.push(c + '(ok:false)'); continue }
      if (!segmentPrivilege(d.segments[0].words)) bad.push(c)
    }
    // pwsh 方言的路径形态单独一条（`C:\Windows\System32\runas.exe`）
    const dw = decomposeCommand('C:\\Windows\\System32\\runas.exe /user:a cmd', 'pwsh')
    if (!dw.ok || !segmentPrivilege(dw.segments[0].words)) bad.push('C:\\Windows\\System32\\runas.exe(pwsh)')
    ok('★ 37 segmentPrivilege 正例 21 条全部命中（含 find -exec 递归与路径形态命令名）',
      bad.length === 0, JSON.stringify(bad))
  }
  {
    // 反例是**防误报**的：两种朴素判据（扫段内全部词元 / 扫 unwrapWords 后全部词元）
    // 都在 `rm sudo` 上误报 —— 只有「命令头位置链」判据正确（§9.3 的关键结论）。
    const neg = ['rm sudo', 'rm sudo.txt', 'rm -rf ./sudo', 'del sudo.log', 'rm -rf build',
      'shutdown /s', 'rm -rf sudo/backup', 'mv sudo /tmp', 'find . -name sudo -delete']
    const bad = []
    for (const c of neg) {
      const d = decomposeCommand(c, 'bash')
      if (!d.ok || !d.segments.length) continue
      if (segmentPrivilege(d.segments[0].words)) bad.push(c)
    }
    ok('★ 38 segmentPrivilege 反例 9 条全部为假（rm sudo 不得被当成提权）',
      bad.length === 0, JSON.stringify(bad))
  }
  // ── 38b：`-exec` 后的**带空白赋值前缀**不得吃掉整条命令头链 ────────────────────
  // 词法器把 `FOO="a b"` 输出成**含空白的单个词元** `FOO=a b`。`segmentPrivilege`
  // 的 `-exec` 递归里，判据的顺序必须是**先剥 `NAME=value`、再查空白**（与 `byHeadChain`
  // 的 while、`unwrapWords` 同口径）：顺序颠倒时链就停在赋值前缀上，其后的 wrapper 链
  // 与提权名整个看不见 —— 实测（priv=deny、wide=allow、其余 allow）：
  //     find . -delete -exec FOO="a b" env env env env env sudo rm -rf / {} +
  // 顺序颠倒 → segmentPrivilege=false、tiers=['wide'] → **allow**，用户显式设的
  // 「提权=拒绝」被绕过；同族的 `-exec A="x y" command -v sudo rm {} +` 由 ask 变 allow。
  // 本组断言同时钉住两个方向：带提权名的一律 deny，且**决定性档是 priv**（不是靠 wide
  // 侥幸变严）；不带提权名的对照组不得凭空多出 priv（防「一律判真」的假绿灯）。
  {
    const ds = { inside: 'allow', outside: 'allow', wide: 'allow', unknown: 'allow', proc: 'allow', power: 'allow', priv: 'deny', reg: 'allow' }
    const hit = [
      'find . -delete -exec FOO="a b" env env env env env sudo rm -rf / {} +',
      'find . -delete -exec A="x y" command -v sudo rm {} +',
      'find . -delete -exec FOO="a b" env sudo rm -rf / {} +',
    ]
    const badHit = []
    for (const c of hit) {
      for (const plat of ['posix', 'win32']) {
        const s = segOf(c, 'bash', plat)
        if (!s) { badHit.push(c + '(' + plat + ':no-seg)'); continue }
        if (!segmentPrivilege(s.w)) { badHit.push(c + '(' + plat + ':priv=false)'); continue }
        if (strictestTierAction(ds, s.t) !== 'deny' || decisiveTierOf(ds, s.t) !== 'priv') {
          badHit.push(c + '(' + plat + ':' + JSON.stringify(s.t) + ')')
        }
      }
    }
    // 对照组：同形但不含提权名 —— 必须**没有** priv 档（否则上面的 deny 不说明顺序问题）
    const badMiss = ['find . -delete -exec FOO="a b" env env ls {} +', 'find . -delete -exec FOO="a b" env rm -rf ./build {} +']
      .filter((c) => { const s = segOf(c, 'bash', 'posix'); return !s || s.t.indexOf('priv') !== -1 })
    ok('★★ 38b 带空白赋值前缀后的提权名不得漏判（priv=deny 时 find -exec FOO="a b" env…sudo rm 必须 deny，决定性档 priv）',
      badHit.length === 0 && badMiss.length === 0,
      JSON.stringify({ badHit, badMiss }))
  }

  // ── 39：radiusTierOf 全档映射表 ────────────────────────────────────────────
  ok('★ 39 radiusTierOf 全档映射（含 workspace-root → wide；null → inside）',
    radiusTierOf({ level: 'inside' }) === 'inside'
    && radiusTierOf({ level: 'outside' }) === 'outside'
    && radiusTierOf({ level: 'unknown' }) === 'unknown'
    && radiusTierOf({ level: 'home' }) === 'wide'
    && radiusTierOf({ level: 'system' }) === 'wide'
    && radiusTierOf({ level: 'drive-root' }) === 'wide'
    && radiusTierOf({ level: 'workspace-root' }) === 'wide'
    && radiusTierOf({ level: 'broad' }) === 'wide'
    && radiusTierOf(null) === 'inside',
    JSON.stringify(['inside', 'outside', 'unknown', 'home', 'system', 'drive-root', 'workspace-root', 'broad'].map((l) => l + '=' + radiusTierOf({ level: l }))))

  // ── 40：取最严 ──────────────────────────────────────────────────────────────
  // 档位集合 = 半径档 ∪ 组档，动作 = 集合内取最严（deny > ask > allow）。
  {
    const ds = { inside: 'allow', outside: 'ask', wide: 'ask', unknown: 'ask', proc: 'ask', power: 'ask', priv: 'ask', reg: 'ask' }
    const act = (c, shell, plat) => { const s = segOf(c, shell, plat); return s ? strictestTierAction(ds, s.t) : null }
    ok('★ 40 取最严：sudo rm -rf /etc 命中 wide+priv 两档，动作取严者（wide=ask 压过 inside=allow）',
      act('sudo rm -rf /etc', 'bash', 'posix') === 'ask'
      && act('rm -rf ./build', 'bash', 'win32') === 'allow'
      && tiersOf('sudo rm -rf /etc', 'bash', 'posix').join(',') === 'wide,priv',
      JSON.stringify({ sudoRm: act('sudo rm -rf /etc', 'bash', 'posix'), build: act('rm -rf ./build', 'bash', 'win32'), t: tiersOf('sudo rm -rf /etc', 'bash', 'posix') }))
    // `sudo ls` **只命中 priv**（没有内部目标 → 半径判据弃权，不凭空并一个 inside）。
    // 这个区分有可观察的行为差异：inside=deny + priv=allow 时 `sudo ls` 应当是 allow。
    const ds2 = Object.assign({}, ds, { inside: 'deny', priv: 'allow' })
    const s2 = segOf('sudo ls', 'bash', 'posix')
    ok('★ 40b sudo ls 只命中 priv（半径判据弃权，不凭空并 inside）',
      s2.t.join(',') === 'priv' && strictestTierAction(ds2, s2.t) === 'allow',
      JSON.stringify({ tiers: s2.t, action: strictestTierAction(ds2, s2.t) }))
    // 反向：priv=deny 压过 wide=ask
    const ds3 = Object.assign({}, ds, { priv: 'deny' })
    const s3 = segOf('sudo rm -rf /etc', 'bash', 'posix')
    ok('★ 40c priv=deny 压过 wide=ask（取最严，且决定性档是 priv）',
      strictestTierAction(ds3, s3.t) === 'deny' && decisiveTierOf(ds3, s3.t) === 'priv',
      JSON.stringify({ action: strictestTierAction(ds3, s3.t), decisive: decisiveTierOf(ds3, s3.t) }))
  }

  // ── 41：裸跑三类（§5.6）───────────────────────────────────────────────────
  ok('★ 41 裸跑三类：shutdown → power（组档已覆盖）；rm → inside（无害）；diskpart → unknown（进交互）',
    tiersOf('shutdown', 'bash', 'posix').join(',') === 'power'
    && tiersOf('rm', 'bash', 'posix').join(',') === 'inside'
    && tiersOf('diskpart', 'pwsh', 'win32').join(',') === 'unknown',
    JSON.stringify({ shutdown: tiersOf('shutdown', 'bash', 'posix'), rm: tiersOf('rm', 'bash', 'posix'), diskpart: tiersOf('diskpart', 'pwsh', 'win32') }))
  // ── 41b：BARE_INTERACTIVE 是**形态**判据 ───────────────────────────────────
  // 有实参则走半径档 —— 若按 label 判（只要叫 parted 就归 unknown），
  // `parted /dev/sda` 那条**真实的 system 警告会被降级成「无法判定」**，方向错了。
  ok('★ 41b BARE_INTERACTIVE 是形态判据：parted /dev/sda → wide（有实参走半径）；parted → unknown',
    tiersOf('parted /dev/sda', 'bash', 'posix').join(',') === 'wide'
    && tiersOf('parted', 'bash', 'posix').join(',') === 'unknown'
    && tiersOf('dd of=/dev/sda', 'bash', 'posix').join(',') === 'wide'
    && tiersOf('dd', 'bash', 'posix').join(',') === 'unknown',
    JSON.stringify({ p1: tiersOf('parted /dev/sda', 'bash', 'posix'), p2: tiersOf('parted', 'bash', 'posix'), d1: tiersOf('dd of=/dev/sda', 'bash', 'posix'), d2: tiersOf('dd', 'bash', 'posix') }))
  // ── 41c：NON_PATH_ARG 是 **label** 判据 ────────────────────────────────────
  // 四种形态 blast 全 null（实参是策略名，永不是路径）→ 只能按 label 判。
  {
    const forms = ['set-executionpolicy', 'set-executionpolicy unrestricted',
      'set-executionpolicy -scope localmachine unrestricted', 'set-executionpolicy RemoteSigned']
    const bad = forms.filter((c) => tiersOf(c, 'pwsh', 'win32').join(',') !== 'unknown')
    ok('★ 41c NON_PATH_ARG 是 label 判据：set-executionpolicy 四种形态全部 → unknown',
      bad.length === 0, JSON.stringify(bad))
  }
  // ── 41d：DISKPART_SCRIPT_FLAGS ─────────────────────────────────────────────
  // `diskpart /s script.txt` **有**实参（故不命中 BARE 的形态判据），而那个实参是
  // **脚本文件**而非操作目标 —— 半径判据判不出脚本内容的影响，而它比裸跑危险得多
  // （裸跑只进交互、读到 EOF 就退出；`/s` 会真的执行分区操作）。
  ok('★ 41d DISKPART_SCRIPT_FLAGS：diskpart /s script.txt → unknown（/s 是脚本不是目标）',
    tiersOf('diskpart /s script.txt', 'pwsh', 'win32').join(',') === 'unknown'
    && tiersOf('diskpart /s', 'pwsh', 'win32').join(',') === 'unknown',
    JSON.stringify({ a: tiersOf('diskpart /s script.txt', 'pwsh', 'win32'), b: tiersOf('diskpart /s', 'pwsh', 'win32') }))

  // ── 51：半径组覆盖不变量（§5.6③）──────────────────────────────────────────
  // 半径组（del/disk/perm）的每个成员，要么能判出非 null 的 blast，要么显式列在两张表之一。
  // 价值：日后给半径组**新增 label** 时，若它属于「参数非路径」那一类，断言立刻红灯 ——
  // 否则它会静默落 inside。
  //
  // ── 遍历的组**必须来自生产导出**，不能就地手抄一份三元组（发现 3）──────────────────
  // 这里曾经写 `const RADIUS_GROUPS = ['del','disk','perm']` —— 那是生产语义表
  // `shell-parse.js` 的 `RADIUS_GROUPS`（`{del,disk,perm,priv}`）与 `GROUP_TIER`
  // 的成员在测试侧的第二份拷贝，而两张生产表当时都没导出。后果：日后新增一个半径组时，
  // 本断言仍按旧三元组遍历 → 新组里「参数非路径」的 label 静默落 `inside`（fail-open）
  // 而断言照样全绿。改引 `PURE_RADIUS_GROUPS`（生产侧派生：`RADIUS_GROUPS` 键 −
  // `GROUP_TIER` 键）后，新增半径组会自动进入遍历、新增纯半径组会因「无探针」立刻红灯。
  //
  // 为什么是「**纯**半径组」而不是 `RADIUS_GROUPS` 的全部键：`priv` 虽然在半径组里，
  // 但它**不是**纯半径组 —— `tierSetOf` 的 ① 分支只在 `seg.blast` 非 null 时才为它并
  // 半径档（`sudo ls` 只命中 `priv`、没有 `inside`），且它的 6 个成员 blast 恒 `null`、
  // 探针表里一个都没有，直接遍历会立刻报「无探针」。口径见 `PURE_RADIUS_GROUPS` 的注释
  // 与设计文档 §2.2 / §5.6③（priv 的判据是「提权档 + 内部半径档两者并存」）。
  {
    const bad = []
    for (const g of PURE_RADIUS_GROUPS) {
      for (const label of GROUP_MEMBERS[g]) {
        // 用「带系统路径的典型用法」探 —— 与 §9.8 的探针同形。
        // **每个 label 用自己那门方言的写法**：Windows 命令给 Windows 路径与 win32 平台，
        // POSIX 命令给 POSIX 路径。混用会得到假阴性 —— 实测 `icacls C:\Windows` 在 posix 下
        // 的 blast 是 outside（`C:Windows` 被当绝对路径），那是**平台选错**而不是判据缺失。
        const probes = {
          rm: ['rm -rf /etc', 'posix'], rmdir: ['rmdir /etc/x', 'posix'],
          del: ['del C:/Windows/x.dll', 'win32'], erase: ['erase C:/Windows/x.dll', 'win32'],
          rd: ['rd C:/Windows', 'win32'], 'remove-item': ['Remove-Item C:/Windows', 'win32'],
          ri: ['Remove-Item C:/Windows', 'win32'],
          dd: ['dd of=/dev/sda', 'posix'], mkfs: ['mkfs /dev/sda1', 'posix'],
          shred: ['shred /dev/sda', 'posix'], truncate: ['truncate /etc/passwd', 'posix'],
          wipefs: ['wipefs /dev/sda', 'posix'],
          format: ['format B:', 'win32'], diskpart: ['diskpart', 'win32'],
          fdisk: ['fdisk /dev/sda', 'posix'], parted: ['parted /dev/sda', 'posix'],
          icacls: ['icacls C:/Windows', 'win32'], takeown: ['takeown /f C:/Windows', 'win32'],
          chmod: ['chmod 777 /etc/passwd', 'posix'], chown: ['chown u /etc', 'posix'],
          chgrp: ['chgrp u /etc/passwd', 'posix'], 'set-executionpolicy': ['set-executionpolicy', 'win32'],
        }
        const p = probes[label]
        if (!p) { bad.push(label + '(无探针)'); continue }
        const b = blastOf(p[0], 'bash', p[1])
        if (b !== null) continue
        // blast 为 null：必须显式列在两张补充表之一
        if (BARE_INTERACTIVE[label] || NON_PATH_ARG[label]) continue
        bad.push(label + '(' + p[0] + '→null)')
      }
    }
    ok('★★ 51 半径组覆盖不变量：纯半径组（PURE_RADIUS_GROUPS）每个成员要么 blast 可判、要么在两张补充表里',
      bad.length === 0, JSON.stringify(bad))
    // 对照（防空转）：遍历的组确实来自生产派生，且恰好是 del/disk/perm 三组 ——
    // 少了这条，把 `PURE_RADIUS_GROUPS` 写成空数组也能让上面全绿（遍历 0 组 = 0 个坏项）。
    ok('★★ 51c PURE_RADIUS_GROUPS 是生产派生（RADIUS_GROUPS 键 − GROUP_TIER 键），且非空',
      Array.isArray(PURE_RADIUS_GROUPS)
      && PURE_RADIUS_GROUPS.slice().sort().join(',') === 'del,disk,perm'
      && PURE_RADIUS_GROUPS.indexOf('priv') === -1
      && PURE_RADIUS_GROUPS.every((g) => Array.isArray(GROUP_MEMBERS[g]) && GROUP_MEMBERS[g].length > 0),
      JSON.stringify({ pure: PURE_RADIUS_GROUPS }))
  }
  ok('★ 51b 两张补充表都是 DESTRUCTIVE_LABELS 的子集',
    Object.keys(BARE_INTERACTIVE).every((l) => DESTRUCTIVE_LABELS.has(l))
    && Object.keys(NON_PATH_ARG).every((l) => DESTRUCTIVE_LABELS.has(l)),
    JSON.stringify({ bare: Object.keys(BARE_INTERACTIVE).filter((l) => !DESTRUCTIVE_LABELS.has(l)), nonPath: Object.keys(NON_PATH_ARG).filter((l) => !DESTRUCTIVE_LABELS.has(l)) }))

  // ── 52：tiers 是集合 ────────────────────────────────────────────────────────
  ok('★ 52 tiers 是集合：sudo rm -rf /etc → [wide,priv]；sudo ls → [priv]；非破坏性段 → []',
    tiersOf('sudo rm -rf /etc', 'bash', 'posix').join(',') === 'wide,priv'
    && tiersOf('sudo ls', 'bash', 'posix').join(',') === 'priv'
    && tiersOf('git status', 'bash', 'win32').length === 0
    && tiersOf('echo hi', 'bash', 'win32').length === 0,
    JSON.stringify({ a: tiersOf('sudo rm -rf /etc', 'bash', 'posix'), b: tiersOf('sudo ls', 'bash', 'posix'), c: tiersOf('git status', 'bash', 'win32') }))
  // ── 52b：tierLabel ─────────────────────────────────────────────────────────
  ok('★ 52b tierLabel：inside 返回 null（不标注）；其余七档都有双语标签',
    tierLabel('inside') === null
    && ['wide', 'outside', 'unknown', 'proc', 'power', 'priv', 'reg'].every((t) => {
      const v = tierLabel(t)
      return v && typeof v.zh === 'string' && typeof v.en === 'string' && v.zh && v.en
    }),
    JSON.stringify(['inside', 'wide', 'outside', 'unknown', 'proc', 'power', 'priv', 'reg'].map((t) => t + '=' + JSON.stringify(tierLabel(t)))))
  // ── 52c：code 语义未变（§7.2b 决定不扩 code）────────────────────────────────
  // 这是「不扩 code」的直接验证：八档拆开了，但 code 仍是那三个值。
  {
    const codeOf = (cmd, shell, plat) => {
      const r = run(cmd, shell || 'bash', { platform: plat || 'win32', destructive: 'ask', category: 'ask' })
      return r.segments && r.segments[0] ? r.segments[0].code : null
    }
    ok('★ 52c code 语义未变：sudo ls / kill / shutdown / diskpart / set-executionpolicy 仍全是 destructive',
      codeOf('sudo ls', 'bash', 'posix') === 'destructive'
      && codeOf('kill 1234', 'bash', 'posix') === 'destructive'
      && codeOf('shutdown', 'bash', 'posix') === 'destructive'
      && codeOf('diskpart', 'pwsh', 'win32') === 'destructive'
      && codeOf('set-executionpolicy unrestricted', 'pwsh', 'win32') === 'destructive'
      && codeOf('rm -rf ./build') === 'destructive',
      JSON.stringify({ sudo: codeOf('sudo ls', 'bash', 'posix'), kill: codeOf('kill 1234', 'bash', 'posix'), diskpart: codeOf('diskpart', 'pwsh', 'win32') }))
  }

  // ── 54：segmentLabels 前缀扩展 ─────────────────────────────────────────────
  // 根因：`segmentLabels` 只在 `main === 'find'` 时合成额外 label，对提权前缀不做。
  // 后果不只是组档漏判，还有**既有漏洞**：例外匹配用同一份 labels，
  // 于是用户写的 `kill *`=deny 拦不住 `sudo kill 1234`（§9.11 实测）。
  ok('★ 54 segmentLabels 前缀扩展：sudo kill 1234 的 labels 含 kill（含带值选项被跳过）',
    segmentLabels(decomposeCommand('sudo kill 1234', 'bash').segments[0].words).indexOf('kill') !== -1
    && segmentLabels(decomposeCommand('sudo -u root kill 1234', 'bash').segments[0].words).indexOf('kill') !== -1
    && segmentLabels(decomposeCommand('sudo --user root kill 1234', 'bash').segments[0].words).indexOf('kill') !== -1
    && segmentLabels(decomposeCommand('sudo -u root -g wheel kill 1234', 'bash').segments[0].words).indexOf('kill') !== -1
    && segmentLabels(decomposeCommand('sudo -H kill 1234', 'bash').segments[0].words).indexOf('kill') !== -1,
    JSON.stringify(['sudo kill 1234', 'sudo -u root kill 1234', 'sudo -u root -g wheel kill 1234', 'sudo -H kill 1234'].map((c) => segmentLabels(decomposeCommand(c, 'bash').segments[0].words))))
  // 路由器命令要细化到子命令粒度，否则 `sudo reg delete …` 只会得到 `reg`，
  // 而 GROUP_OF_LABEL 的键是 `reg delete` —— 组档漏判，例外同样命中不了。
  ok('★ 54a 前缀扩展取的是**完整 label**（路由器命令含子命令）：sudo reg delete → reg delete',
    segmentLabels(decomposeCommand('sudo reg delete HKLM\\X /f', 'pwsh').segments[0].words).indexOf('reg delete') !== -1,
    JSON.stringify(segmentLabels(decomposeCommand('sudo reg delete HKLM\\X /f', 'pwsh').segments[0].words)))
  // ── 54b：su / runas **不扩展**（反例）──────────────────────────────────────
  // 它们的 PRIV_VALUE_FLAGS 刻意留空（值本身可能是命令或目标）。照搬扩展会取到
  // `root`、`user:admin` 这类**非命令名**，让例外误命中 —— 方向是放宽，比不扩展更糟。
  ok('★ 54b su/runas 不扩展：su root 的 labels 不含 root；su -c 不含引号内容',
    segmentLabels(decomposeCommand('su root', 'bash').segments[0].words).indexOf('root') === -1
    && segmentLabels(decomposeCommand('runas /user:admin cmd', 'bash').segments[0].words).indexOf('user:admin') === -1
    && segmentLabels(decomposeCommand('su -c "rm -rf /"', 'bash').segments[0].words).indexOf('rm') === -1,
    JSON.stringify({ su: segmentLabels(decomposeCommand('su root', 'bash').segments[0].words), runas: segmentLabels(decomposeCommand('runas /user:admin cmd', 'bash').segments[0].words), suc: segmentLabels(decomposeCommand('su -c "rm -rf /"', 'bash').segments[0].words) }))
  // ── 54d：su / runas 的**操作数**不得被当成命令名（命令头推进与门控同源）──────────
  // 54b 只钉住「labels 不扩展到操作数」，而**命令头位置**本身也曾停错：
  // `skipPrefixArgs` 对 su / runas 的带值选项表刻意留空，于是命令头停在前缀后那个词元上
  // —— 而那是**操作数**（`su root` 的 `root`、`runas /user:admin` 的 `user:admin`），
  // 真命令名还在它之后。门控侧（`headCommandNameOf`）随即把操作数当命令名交去查命令域，
  // `isCmdStyleSwitch` 认不出它 → 走「认不出命令名 ⇒ 不消费半径 ⇒ 当开关」的兜底
  // → `/data` 被当开关跳过 → 段级 blast 归 null → 档位 inside。
  // 实测（修复前、win32、priv=allow）：`su root rm -rf /data`、`runas /user:admin rm -rf /data`
  // 全部 **allow**，而对照 `sudo -u root rm -rf /data` 是 ask —— 同一件事只因前缀不同就分叉。
  // 影响面**不含盘根**（`/` 的 charAt(1) 为空、不命中 `/[a-z]/i` 那条开关判据，故仍走判档
  // → drive-root → wide）；失效的是**多字母单段路径**（`/data`）这一类。
  // 故这里同时钉住「非 allow」与「blast 与不带前缀时同值」——后者才是根因判据。
  {
    const dsPrivAllow = { inside: 'allow', outside: 'ask', wide: 'ask', unknown: 'ask', proc: 'ask', power: 'ask', priv: 'allow', reg: 'ask' }
    const runPriv = (c) => {
      const h = tierOpts('win32')
      h.destructive = () => dsPrivAllow
      return assessCommand(c, 'bash', h)
    }
    const bad = ['su root rm -rf /data', 'runas /user:admin rm -rf /data',
      // 操作数与真命令名之间夹一层（wrapper / 提权前缀 / 语句关键字）——同一根因的另一半：
      // 跨到关键字就停（`commandHeadEnd` 刻意不认识关键字），`headCommandNameOf` 取
      // `w[headEnd-1]` 又拿回操作数。实测（修复前、priv=allow）这三类同样全部 allow。
      'su root time rm -rf /data', 'su root env FOO=1 rm -rf /data', 'su root nohup rm -rf /data',
      'su root ! rm -rf /data', 'su root sudo rm -rf /data', 'runas /user:admin time rm -rf /data',
      // 操作数不止一个：`/noprofile` 与 `/user:admin` 都是操作数，真命令名在第三个词元
      'runas /noprofile /user:admin rm -rf /data']
      .filter((c) => runPriv(c).action === 'allow')
    ok('★★ 54d win32 + priv=allow：`su root rm -rf /data` / `runas /user:admin rm -rf /data` 不得 allow（操作数不是命令名）',
      bad.length === 0
      // 根因判据：带前缀与不带前缀必须同值（分叉才是缺陷，allow 只是它的表现）
      && blastOf('su root rm -rf /data', 'bash', 'win32') === blastOf('rm -rf /data', 'bash', 'win32')
      && blastOf('runas /user:admin rm -rf /data', 'bash', 'win32') === blastOf('rm -rf /data', 'bash', 'win32')
      // 夹层形态同样要与不带前缀时同值
      && blastOf('su root time rm -rf /data', 'bash', 'win32') === blastOf('time rm -rf /data', 'bash', 'win32')
      && blastOf('su root env FOO=1 rm -rf /data', 'bash', 'win32') === blastOf('env FOO=1 rm -rf /data', 'bash', 'win32')
      && blastOf('runas /noprofile /user:admin rm -rf /data', 'bash', 'win32') === blastOf('rm -rf /data', 'bash', 'win32')
      // 盘根形态本就未被破坏，一并钉住（防日后按「无条件跨过操作数」修法把它改坏）
      && blastOf('su root rm -rf /', 'bash', 'win32') === 'drive-root'
      && blastOf('runas /user:admin rm -rf /', 'bash', 'win32') === 'drive-root'
      // 对照（防过度收紧）：无真命令可判时仍走原行为 —— `su root` / `runas /user:admin cmd`
      // 的 blast 必须仍是 null（若把操作数后的任意词元都当命令名，这里会变成非 null 假警告）
      && blastOf('su root', 'bash', 'win32') === null
      && blastOf('runas /user:admin cmd', 'bash', 'win32') === null
      && blastOf('su root ls', 'bash', 'win32') === null
      && blastOf('su root x', 'bash', 'win32') === null
      // 对照（`-c` 的值是命令或目标，不得被跨过 —— 见 commandHeadEnd 里 7 种形态的实测）
      && blastOf('su -c C:/Windows', 'bash', 'win32') === 'system'
      && blastOf('su root -c "rm -rf /data"', 'bash', 'win32') === 'outside',
      JSON.stringify({ bad, suData: blastOf('su root rm -rf /data', 'bash', 'win32'),
        plainData: blastOf('rm -rf /data', 'bash', 'win32'),
        runasData: blastOf('runas /user:admin rm -rf /data', 'bash', 'win32'),
        suRoot: blastOf('su root', 'bash', 'win32'),
        runasCmd: blastOf('runas /user:admin cmd', 'bash', 'win32'),
        suCWin: blastOf('su -c C:/Windows', 'bash', 'win32'),
        action: runPriv('su root rm -rf /data').action }))
  }
  // ── 54d2：`privOperandSkip` **不得过度跨过**操作数（发现 4 的反方向）──────────────
  // 54d 修的是「该跨没跨」（`su root rm -rf /data` 的操作数 `root` 挡住了真命令名），
  // 而同一函数曾有的另一支是「**不该跨却跨了**」：`isDestructiveLabel(afterName)` 之后
  // 紧跟一条 `if (WRAPPERS[afterName] === 1 || PRIV_PREFIXES[afterName] === 1) return k`
  // —— 于是「操作数 + wrapper/前缀 + **纯路径目标**」（`su root env /etc`、
  // `su root sudo C:/Windows`）也把操作数跨过去了。而 wrapper 之后并没有命令名，
  // `commandHeadEnd` 的循环落进 ① 分支、`prevPrefix` 被改写成那个 wrapper，
  // `!PRIV_VALUE_IS_COMMAND[prevPrefix]` 成立（该表只登记 su/runas）
  // → **真目标被当命令名吃掉** → 段级 blast 归 null → 档位 inside → `priv=allow` 时静默放行。
  //
  // 实测（修复前、win32、priv=allow）：`su root sudo C:/Windows` 由 HEAD 的 **ask** 变成
  // **allow**，而同目标的 `su root C:/Windows` 仍是 ask —— 同一件事只因多一个 wrapper
  // 就分叉；穷举 528 形态得 HEAD 判 system/home/drive-root 的 **130 条**（posix **247 条**）
  // 全部失去警告。故这里的判据是「**与不带 wrapper 的同目标形态同值**」，
  // 而不只是「非 null」—— 后者会漏掉「判成了更轻的档」。
  //
  // ⚠️ **本组同时钉住那个易踩的修法**：链推进里若把 `isDestructiveLabel` 排在
  // 「前缀/关键字推进」之前，`su root sudo X` 会在链首 `sudo`（提权名**本身就在
  // `DESTRUCTIVE_LABELS` 里**，见 §9.4）上就 return，等于又变回无条件跨过 —— 实测
  // 先判破坏性时该形态仍判 null。故 `su root sudo C:/Windows` 这条是那处顺序的守卫。
  {
    const cross = [
      // [带 wrapper/前缀的形态, 同目标不带 wrapper 的对照]
      ['su root env /etc', 'su root /etc'],
      ['su root nice /etc', 'su root /etc'],
      ['su root nohup /var/www/deploy.sh', 'su root /var/www/deploy.sh'],
      ['su root sudo C:/Windows', 'su root C:/Windows'],
      ['su root sudo B:', 'su root B:'],
      ['su root sudo ~', 'su root ~'],
      ['su root env C:/Windows', 'su root C:/Windows'],
      ['su root env B:', 'su root B:'],
      ['su root env ~', 'su root ~'],
    ]
    const badCross = []
    for (const [a, b] of cross) {
      const va = blastOf(a, 'bash', 'win32'), vb = blastOf(b, 'bash', 'win32')
      // 对照本身必须判得出来（否则这条是空转：两边同为 null 时「同值」恒真）
      if (vb === null || va !== vb) badCross.push([a, va, b, vb])
    }
    ok('★★ 54d2 win32：操作数 + wrapper/前缀 + 纯路径目标不得被吃进命令头（与不带 wrapper 时同值）',
      badCross.length === 0
      // 对照（防空转）：上面每条对照形态本身必须非 null —— 逐条列出，避免整组退化
      && ['su root /etc', 'su root /var/www/deploy.sh', 'su root C:/Windows', 'su root B:', 'su root ~']
        .every((c) => blastOf(c, 'bash', 'win32') !== null)
      // 端到端：priv=allow 时 `su root sudo C:/Windows` 必须非 allow（修复前是 allow）
      && (function () {
        const ds = { inside: 'allow', outside: 'ask', wide: 'ask', unknown: 'ask', proc: 'ask', power: 'ask', priv: 'allow', reg: 'ask' }
        const h = tierOpts('win32')
        h.destructive = () => ds
        return assessCommand('su root sudo C:/Windows', 'bash', h).action !== 'allow'
          && assessCommand('su root env /etc', 'bash', h).action !== 'allow'
      })()
      // 方向检验：**真删除形态不受影响** —— 操作数之后是破坏性命令名时仍须跨过它，
      // 否则 54d 修好的那一族会退回（`su root env rm -rf /data` 必须与 `rm -rf /data` 同值）。
      && blastOf('su root env rm -rf /data', 'bash', 'win32') === blastOf('rm -rf /data', 'bash', 'win32')
      && blastOf('su root sudo rm -rf /data', 'bash', 'win32') === blastOf('rm -rf /data', 'bash', 'win32')
      && blastOf('su root env find /data -delete', 'bash', 'win32') !== null,
      JSON.stringify({ badCross, suSudoWin: blastOf('su root sudo C:/Windows', 'bash', 'win32'),
        suWin: blastOf('su root C:/Windows', 'bash', 'win32'),
        suSudoB: blastOf('su root sudo B:', 'bash', 'win32'), suB: blastOf('su root B:', 'bash', 'win32'),
        suSudoHome: blastOf('su root sudo ~', 'bash', 'win32'), suHome: blastOf('su root ~', 'bash', 'win32'),
        envRm: blastOf('su root env rm -rf /data', 'bash', 'win32') }))
  }
  // ── 54d3：提权前缀之后的 `NAME=value` **赋值词元**不是命令名 ──────────────────────
  // `commandHeadEnd` 的 ② 里 `sawPrefix && !PRIV_VALUE_IS_COMMAND[prevPrefix]` 对
  // `sudo` / `doas` / `pkexec` / `gsudo` **恒真**且**先于** `isTargetEatingNameIn` 命中，
  // 于是它把前缀之后的**第一个**词元无条件当命令名吃掉 —— 而那个词元可能正是 `FOO=1`。
  // `headCommandNameOf` 的早退只拒收「关键字 / 前缀 / wrapper」，赋值词元一概放行
  // → 返回 `foo=1` → 下游 `isCmdStyleSwitch` 查 `GROUP_OF_LABEL['foo=1']` 不中
  // → 走「认不出命令名 ⇒ 不消费半径」兜底 → `/tmp` 被当 cmd 开关跳过 → 段级 blast 归 null。
  //
  // 插桩实测：`commandHeadEnd(['sudo','FOO=1','rm','-rf','/tmp'])` = **2**、
  // `headCommandNameOf(…)` = `"foo=1"`（正确值 `"rm"`）。
  // 端到端（win32、真实档位表）：
  //     | 配置                        | `sudo rm -rf /tmp` | `sudo FOO=1 rm -rf /tmp` |
  //     | §6.1 默认（priv=ask）       | ask                | ask（缺陷被掩盖）        |
  //     | **priv=allow**（§3.3 预期） | ask                | **allow** ❌             |
  //     | outside=deny + unknown=deny | deny               | **ask** ❌               |
  // 即用户按计划把 `priv` 设为 allow 后，`sudo FOO=1 rm -rf /tmp`（**多写一个环境变量
  // 赋值**）静默 allow、`blast=null`、弹窗 0 次，`outside` 档被整档绕过。
  //
  // 故判据是「与**不带赋值**的同形态**同值**」——那才是根因判据（只看「非 allow」会漏掉
  // 「判成了更轻的档」）。同时含防空转对照：区内 `sudo FOO=1 rm -rf ./build` 必须仍 allow
  // （若把整条闸开成「提权一律 ask」，那条会假红）。
  {
    const dsPrivAllow = { inside: 'allow', outside: 'ask', wide: 'ask', unknown: 'ask', proc: 'ask', power: 'ask', priv: 'allow', reg: 'ask' }
    const dsDeny = { inside: 'allow', outside: 'deny', wide: 'ask', unknown: 'deny', proc: 'ask', power: 'ask', priv: 'ask', reg: 'ask' }
    // 54d3c 的 ⑤⑥ 两族专用：命中档是 `wide`，故必须把 `wide` 也设为 deny 才证明它在场
    const dsDenyWide = { inside: 'allow', outside: 'deny', wide: 'deny', unknown: 'deny', proc: 'ask', power: 'ask', priv: 'ask', reg: 'ask' }
    const run = (c, ds) => {
      const h = tierOpts('win32')
      h.destructive = () => ds
      return assessCommand(c, 'bash', h)
    }
    // 每条 = [带赋值形态, 不带赋值的对照]；对照本身必须判得出来（否则「同值」是空转）
    const cross = [
      ['sudo FOO=1 rm -rf /tmp', 'sudo rm -rf /tmp'],
      ['sudo FOO=1 diskpart', 'sudo diskpart'],
      ['sudo FOO=1 ls /tmp', 'sudo ls /tmp'],
      ['sudo -u root FOO=1 rm -rf /tmp', 'sudo -u root rm -rf /tmp'],
      ['doas FOO=1 rm -rf /tmp', 'doas rm -rf /tmp'],
      ['gsudo FOO=1 rm -rf /tmp', 'gsudo rm -rf /tmp'],
      ['pkexec FOO=1 rm -rf /tmp', 'pkexec rm -rf /tmp'],
    ]
    const badCross = []
    for (const [a, b] of cross) {
      const ba = blastOf(a, 'bash', 'win32'), bb = blastOf(b, 'bash', 'win32')
      if (ba !== bb) badCross.push([a, ba, b, bb])
      // 对照必须**带信号**（blast 非 null，或档位非空），否则两边的 null 会让「同值」恒真
      // —— 该条退化成空转。`sudo diskpart` 的 blast 结构性为 null（裸跑交互类），
      // 它的信号在 `tiers=['unknown','priv']` 上，故判据取「两者至少有一个有值」。
      if (bb === null && tiersOf(b, 'bash', 'win32').length === 0) badCross.push([b + '(对照无信号)', bb])
    }
    // 档位集合也必须同值（blast 同值而 tiers 不同 = 仍在档位上分叉）
    const badTiers = cross.filter(([a, b]) => tiersOf(a, 'bash', 'win32').join(',') !== tiersOf(b, 'bash', 'win32').join(','))
    // ── 54d3b：`-c` / `--command` / `--command=<值>` **值选项族**（上一轮的单点收敛盲区）──
    // 54d3 只钉了「提权前缀后的 `NAME=value` 赋值」这一支，对**值选项路径零断言** ——
    // 于是 `isPrivCommandValueFlag` 的单点收敛把「`--command=` 前缀匹配」这一支
    // 带进了 `isPrivOperandWord`（那是**操作数侧**，命中即返 false），
    // `privOperandSkip` 的贪婪扫描在第二个词元就收束、`commandHeadEnd` 停在 **1**，
    // 真命令与真目标一起被排除在命令头之外，段级 blast 归 `null` → 半径档落 `inside`。
    // 三套件当时**全绿**：这就是纯测试盲区（不是断言失效）。
    //
    // 判据与 54d3 同口径：**与不带该选项的同形态同值**（blast + tiers 双口径），
    // 而不是断言某个具体动作 —— 只看「非 allow」会漏掉「判成了更轻的档」。
    // 形态覆盖三支前缀（`su` / `sudo su` / `runas`）与连写的四种值（空 / `x` / `rm` / `=`）。
    // 实测（对拍基线 = `shell-parse.js` 仅把该行改回窄判据的副本）：本族
    // `commandHeadEnd` 由 **4 停在 1**、段级 blast 归 `null`；端到端 8 组配置 × 915 条语料
    // 共 7320 格里 **放宽 540 格、收紧 0 格**，全部落在本判据覆盖的形态上。
    // 对照（防空转）：`-c` / `--command` **精确形态**（无 `=`）本就走另一条路径，
    // 命令头停在 `1`、tiers 只剩 `priv` —— 那是**既有设计**（值就是目标，见
    // `commandHeadEnd` ② 的说明），不得被本判据改坏，故一并钉住。
    const cross2 = [
      ['su root --command=x rm -rf /tmp', 'su root rm -rf /tmp'],
      ['su root --command= rm -rf /tmp', 'su root rm -rf /tmp'],
      ['su root --command=rm rm -rf /tmp', 'su root rm -rf /tmp'],
      ['su root --command== rm -rf /tmp', 'su root rm -rf /tmp'],
      ['su root --command=diskpart diskpart', 'su root diskpart'],
      ['sudo su root --command=x rm -rf /tmp', 'sudo su root rm -rf /tmp'],
      ['runas /user:a --command= diskpart', 'runas /user:a diskpart'],
      ['runas /user:a --command=x diskpart', 'runas /user:a diskpart'],
      ['runas /user:a /noprofile --command= rm -rf /tmp', 'runas /user:a /noprofile rm -rf /tmp'],
      // 形近干扰项：`--commandx=` / `-command=` 都不是值选项，本就不该被认出
      ['su root --commandx=1 rm -rf /tmp', 'su root rm -rf /tmp'],
    ]
    const badCross2 = []
    for (const [a, b] of cross2) {
      const ba = blastOf(a, 'bash', 'win32'), bb = blastOf(b, 'bash', 'win32')
      if (ba !== bb) badCross2.push([a, ba, b, bb])
      // 对照必须带信号（与 54d3 同一条防空转守卫）
      if (bb === null && tiersOf(b, 'bash', 'win32').length === 0) badCross2.push([b + '(对照无信号)', bb])
    }
    const badTiers2 = cross2.filter(([a, b]) => tiersOf(a, 'bash', 'win32').join(',') !== tiersOf(b, 'bash', 'win32').join(','))
    ok('★★ 54d3b win32：提权前缀后的 `--command=<值>` 连写值选项不得让命令头收束（与不带该选项时 blast/tiers 同值）',
      badCross2.length === 0 && badTiers2.length === 0
      // 端到端 priv=allow：修复前这三条是 **allow**（半径档被整档绕过）
      && run('su root --command=x rm -rf /tmp', dsPrivAllow).action === 'ask'
      && run('su root --command= diskpart', dsPrivAllow).action === 'ask'
      && run('runas /user:a --command= diskpart', dsPrivAllow).action === 'ask'
      && run('sudo su root --command=x rm -rf /tmp', dsPrivAllow).action === 'ask'
      // 端到端 outside=deny + unknown=deny：修复前这三条退成 **ask**
      && run('su root --command=x rm -rf /tmp', dsDeny).action === 'deny'
      && run('su root --command= diskpart', dsDeny).action === 'deny'
      && run('runas /user:a --command= diskpart', dsDeny).action === 'deny'
      // 对照（防空转）：区内目标**仍必须 allow** —— 若把整条闸开成「提权一律 ask」这条会红
      && run('su root --command=x rm -rf ./build', dsPrivAllow).action === 'allow'
      // ── 对照（防空转）：**真正的「值即目标」形态** —— 值含分隔符 / 含空白 / 解不出
      //    吃目标的命令名时，命令头照旧停在值选项处、tiers 只剩 `priv`（值本身是目标时
      //    半径档由那个目标给出）。既有设计，本判据不得改坏它。
      //
      //    ⚠️ 这里**不得**再写 `su root -c rm -rf /tmp` 的 `tiers === 'priv'`（本轮更正）：
      //    那个期望值把「值即目标」的结论**错套到了「值是命令」的形态**上 —— 该形态里
      //    `rm` 明明是**裸命令名**、`-rf /tmp` 是它的参数，命令头理应从 `rm` 开始。
      //    按此钉住会让 `su root -c rm -rf /tmp` 与**同义**的 `su -c rm -rf /tmp` 分叉
      //    （后者是 `['outside','priv']`），而 `su root -c <cmd>`（GNU getopt 参数置换）
      //    正是 `su` 指定用户后执行命令的**常规写法** —— 分叉方向是 fail-open：
      //    组档（proc/power/reg）整体丢失、用户写的 deny 例外被绕过（实测
      //    `su root -c kill 1234` 在默认八档下是 ask、例外 `kill *`=deny 也不命中，
      //    而三条对照 `su -c kill 1234` / `su root kill 1234` / `sudo kill 1234` 全是 deny）。
      //    判据改钉「与**不带操作数**的同形态**同值**」—— 那才是这条断言原本要守的东西
      //    （值选项不得让命令头收束）。
      && tiersOf('su root -c C:/Windows', 'bash', 'win32').join(',') === 'wide,priv'
      && blastOf('su root -c C:/Windows', 'bash', 'win32') === 'system'
      && tiersOf('su root -c /etc', 'bash', 'win32').join(',') === 'outside,priv'
      && tiersOf('su root -c of=/dev/sda', 'bash', 'win32').join(',') === 'outside,priv'
      && tiersOf('su root -c ~', 'bash', 'win32').join(',') === 'wide,priv'
      && tiersOf('su root -c "rm -rf /"', 'bash', 'win32').join(',') === 'wide,priv'
      && tiersOf('su root -c /usr/bin/rm', 'bash', 'win32').join(',') === 'outside,priv'
      // 同义形态必须同值（`su root -c <cmd>` ≡ `su -c <cmd>`，`--command` 同）：
      // 这才是「值选项不得让命令头收束」的根因判据。
      && tiersOf('su root -c rm -rf /tmp', 'bash', 'win32').join(',') === tiersOf('su -c rm -rf /tmp', 'bash', 'win32').join(',')
      && blastOf('su root -c rm -rf /tmp', 'bash', 'win32') === blastOf('su -c rm -rf /tmp', 'bash', 'win32')
      && tiersOf('su root --command rm -rf /tmp', 'bash', 'win32').join(',') === tiersOf('su --command rm -rf /tmp', 'bash', 'win32').join(','),
      JSON.stringify({ badCross2, badTiers2,
        f1: blastOf('su root --command=x rm -rf /tmp', 'bash', 'win32'),
        c1: blastOf('su root rm -rf /tmp', 'bash', 'win32'),
        t1: tiersOf('su root --command=x rm -rf /tmp', 'bash', 'win32'),
        t2: tiersOf('su root rm -rf /tmp', 'bash', 'win32'),
        privAllow: run('su root --command=x rm -rf /tmp', dsPrivAllow).action,
        deny: run('su root --command=x rm -rf /tmp', dsDeny).action,
        buildStillAllow: run('su root --command=x rm -rf ./build', dsPrivAllow).action,
        dashC: tiersOf('su root -c rm -rf /tmp', 'bash', 'win32'),
        longExact: tiersOf('su root --command rm -rf /tmp', 'bash', 'win32'),
        dashCNoOperand: tiersOf('su -c rm -rf /tmp', 'bash', 'win32') }))
    // ── 54d3c：**值选项写在操作数之前**的畸形形态（上一轮的对称盲区）────────────────────
    // 54d3b 钉的是「值选项在**操作数之后**」（`su root --command=x …`）那一支 —— 它修好了
    // 操作数侧的 `joined=false`。而**门控侧**（`privValueFlagBetween`）当时仍传
    // `joined = true`，于是同一个 `--command=` 前缀在**另一个位置**上成了放宽源：
    //
    //   `privValueFlagBetween` 的扫描区间是「前缀名之后、`skipPrefixArgs` 返回值之前」的
    //   **全部**词元；区间里一旦出现任何 `--command=` **前缀**词元就返 `true`
    //   → `isPrivOperandToken` 返 `false` → `privOperandSkip` **立即返回 `at`、不再跨过
    //   操作数** → 真命令与真目标一起被排除在命令头之外 → 段级 blast 归 `null`
    //   → 半径档落 `inside`。
    //
    // 插桩实测（`commandHeadEnd` / `privValueFlagBetween` 直接调用，修复前）：
    //     `su --command=x root rm -rf /tmp`   flag=**true**  headEnd=**2** headName=`--command=x`
    //                                         blast=`null`/tiers=`["priv"]`（priv=allow → **allow**）
    //     对照 `su root rm -rf /tmp`           flag=false headEnd=3  headName=`rm`
    //                                         blast=`outside|/tmp`/tiers=`["outside","priv"]`（**ask**）
    // 同族（全部命中，`--command=` / `=x` / `=rm` / `==` 四种值写法一致）：
    //     `sudo su --command=x root rm -rf /tmp`   headEnd **2 vs 4**、blast null vs outside
    //     `su --command=x root diskpart`           tiers `["priv"]` vs `["unknown","priv"]`
    //                                              （unknown=deny 下 **allow vs deny**）
    //     `su --command=x root kill 1234`          **proc 档整个丢失**
    //     `su --command=x root reg delete …`       **reg 档整个丢失**
    //
    // ── 为什么**不能**简单改回 `joined = false`（那是把闸开过头，实测有放宽）──────────────
    // 直接不认连写形态 ⇒ 操作数**无条件**被跨过 ⇒ 而那个位置可能正是**真路径目标**：
    //     `su --command=x C:/Windows rm` 由 `system|C:/Windows`（wide=ask → **ask**）
    //     变成 `null|inside`（priv=allow → **allow**）—— 方向 fail-open。
    // 实测（语料 95,640 条 × 31 档位配置 × 2 平台 = **3,347,400 格/变体**，逐格比
    // blast / tiers / 端到端 action）：无条件不认连写形态 ⇒ **放宽 21,018 格**、收紧 45,966 格。
    // 同族的放宽形态还有 `su --command=x /etc rm`、`su --command=x ~ rm -rf /tmp`、
    // `su --command=x C:/Windows diskpart`、`sudo su --command=x …` 全套。
    //
    // 故修法是**收窄而非删除**：连写支只在「`upto` 位置本来会被判档」时才认，判据取
    // `mayYieldRadiusTier(w[upto], undefined)` —— 它是 `blastRadiusOfSegment` 判档循环
    // **三条产档路径**（引号命令行递归 / `NAME=value` 取右侧值 / 廉价预筛）合并成的
    // **上界**判据，故「为假 ⇒ 该词元在判档循环里本来就不产半径档 ⇒ 跨不跨都不产生任何
    // 半径档」⇒ 本支只可能**收紧**，不可能放宽（见 `privValueFlagBetween` 的注释）。
    //
    // ⚠️ 该判据**不能**只取 `mayNeedBlastCheck`（上一版如此，是**真实放宽**，已实测推翻）：
    // 那条预筛在循环里**不是第一条产档路径**，它前面还有两条对「纯词元」形态照样产档的
    // 分支（`:4922-4963` 的引号递归支、`:4975-4986` 的 `NAME=value` 支），而
    // `mayNeedBlastCheck` 对它们返假。实测（win32、priv=allow）：
    //     `su --command=x "rm -rf Windows" rm`  PRE=`system|Windows`/ask → CUR=`null`/allow
    //     `su --command=x FOO=Windows rm`       同上
    // 故下面 ⑤ 引号命令行族与 ⑥ `NAME=value` 族是**必需的**（上一版语料的盲区）。
    //
    // 本断言钉四件事：
    //   ① 畸形族与**不带该选项**的同形态 **blast + tiers 双口径同值**（根因判据，
    //      只看「非 allow」会漏掉「判成了更轻的档」）；
    //   ② 端到端 priv=allow 下**非 allow**（修复前是 allow）；
    //   ③ **放宽族**（`upto` 位置是真目标：路径 / `~` / 变量 / 通配 / BARE 系统目录名 /
    //      **含空格的引号命令行** / **`NAME=value`**）必须**逐字保持修复前行为** —— 这是
    //      「放宽 = 0」的**结构性**守卫：若有人把这条支改回无条件 `joined = false`、
    //      或把守卫改回只用 `mayNeedBlastCheck`，③ 会立刻变红（实测该变异下
    //      `su --command=x C:/Windows rm` 由 ask 变 allow、
    //      `su --command=x "rm -rf Windows" rm` 由 ask 变 allow）；
    //   ④ 防空转：区内目标 `./build` 仍 allow、`su --command=x root`（后面没有命令）
    //      仍与 `su root` 同值。
    const cross3 = [
      ['su --command=x root rm -rf /tmp', 'su root rm -rf /tmp'],
      ['su --command= root rm -rf /tmp', 'su root rm -rf /tmp'],
      ['su --command=rm root rm -rf /tmp', 'su root rm -rf /tmp'],
      ['su --command== root rm -rf /tmp', 'su root rm -rf /tmp'],
      ['su --command=x root diskpart', 'su root diskpart'],
      ['su --command=x root kill 1234', 'su root kill 1234'],
      ['su --command=x root reg delete HKLM\\X /f', 'su root reg delete HKLM\\X /f'],
      ['su --command=x root find /data -delete', 'su root find /data -delete'],
      ['su --command=x root rm -rf ./build', 'su root rm -rf ./build'],
      ['su --command=x root time rm -rf /tmp', 'su root time rm -rf /tmp'],
      ['su --command=x root env find /data -delete', 'su root env find /data -delete'],
      ['su --command=x root', 'su root'],
      ['sudo su --command=x root rm -rf /tmp', 'sudo su root rm -rf /tmp'],
      ['sudo su --command=x root diskpart', 'sudo su root diskpart'],
      ['sudo su --command=x root kill 1234', 'sudo su root kill 1234'],
      ['runas /user:a --command=x rm -rf /tmp', 'runas /user:a rm -rf /tmp'],
    ]
    const badCross3 = []
    for (const [a, b] of cross3) {
      const ba = blastOf(a, 'bash', 'win32'), bb = blastOf(b, 'bash', 'win32')
      if (ba !== bb) badCross3.push([a, ba, b, bb])
      // 对照必须带信号（与 54d3 / 54d3b 同一条防空转守卫）
      if (bb === null && tiersOf(b, 'bash', 'win32').length === 0) badCross3.push([b + '(对照无信号)', bb])
    }
    const badTiers3 = cross3.filter(([a, b]) => tiersOf(a, 'bash', 'win32').join(',') !== tiersOf(b, 'bash', 'win32').join(','))
    // ③ 放宽族：`upto` 位置是**真目标**形态 → 本判据必须原样保留（逐条钉死 blast + tiers）
    //
    // 后四条（`-c` / `--command` **精确形态**的值本身是目标、且后面还跟着词元）钉的是
    // **另一条**承重支：`isPrivCommandValueFlag(t)`（精确形态那一支）。
    // ⚠️ 该函数已是**单形参**（`shell-parse.js:1753`，`joined` 形参正是本次 diff 删掉的）；
    // **连写形态**（`--command=<值>`）由**门控侧**自行判（见 `privValueFlagBetween` 的
    // 连写支守卫），不在这里表达。
    // 少了它 `su -c C:/Windows rm` 的 `C:/Windows` 会被当操作数跨过 → 不再判档
    // → blast 由 `system|C:/Windows`（ask）变 `null|inside`（priv=allow → **allow**）。
    // 实测该变异（把精确支也删掉）在**旧断言下全绿** —— 即这是一个真实的测试盲区，
    // 故这四条必须留在本断言里（见 `privValueFlagBetween` 的注释）。
    const widenGuard = [
      ['su --command=x C:/Windows rm', 'system|C:/Windows', 'wide,priv'],
      ['su --command=x C:/Windows', 'system|C:/Windows', 'wide,priv'],
      ['su --command=x /etc rm', 'outside|/etc', 'outside,priv'],
      ['su --command=x /etc', 'outside|/etc', 'outside,priv'],
      ['su --command=x ~ rm -rf /tmp', 'home|' + HOME, 'wide,priv'],
      ['su --command=x D:/data rm', 'outside|D:/data', 'outside,priv'],
      ['su --command=x $TARGET rm', 'unknown|', 'unknown,priv'],
      ['su --command=x %TEMP% rm', 'unknown|', 'unknown,priv'],
      ['su --command=x Windows rm', 'system|Windows', 'wide,priv'],
      ['sudo su --command=x C:/Windows rm', 'system|C:/Windows', 'wide,priv'],
      ['sudo su --command=x /etc rm', 'outside|/etc', 'outside,priv'],
      ['runas /user:a --command=x C:/Windows rm', 'system|C:/Windows', 'wide,priv'],
      // ── ⑤ 引号命令行词元族：`upto` 位置是**含空格的词元** ────────────────────────────
      //
      // ⚠️ 这一族与下面 ⑥ 是**上一版守卫的盲区**（发现 1）：守卫当时只取
      // `mayNeedBlastCheck(w[upto], undefined)`，而 `blastRadiusOfSegment` 的判档循环在
      // 那条预筛**之前**还有两条产档路径，它们对「纯词元」形态照样成立、`mayNeedBlastCheck`
      // 却返假 —— 故「返假 ⇒ 跨过它不丢半径档」的论证不成立。
      //   ① 含空格词元的**引号命令行递归支**（`shell-parse.js:4922-4963`）——
      //      `token.indexOf(' ') !== -1` 且切分后首词是破坏性命令名或解释器（NESTED_SHELLS）；
      //   ② `NAME=value` 支（`:4975-4986`）—— 取 `=` **右侧值**再判档。
      // 缺这两族时实测（win32、priv=allow）：
      //     su --command=x "rm -rf Windows" rm   PRE=`system|Windows`+`wide,priv`（**ask**）
      //                                          → CUR=`null`+`inside,priv`（**allow**）
      //     su --command=x FOO=Windows rm        同上（`system|Windows`/ask → `null`/allow）
      // 修法是 `mayYieldRadiusTier` 单点判据（把三条产档路径合并成一条**上界**判据）。
      // 下面这些条目就是该判据的**结构性守卫**：把守卫改回只用 `mayNeedBlastCheck`
      // 会让它们全部变红（见本组末尾的防空转判据与报告里的变异实测）。
      ['su --command=x "rm -rf Windows" rm', 'system|Windows', 'wide,priv'],
      ['su --command=x "cmd System32" rm', 'system|System32', 'wide,priv'],
      ['su --command=x "rm -rf ProgramData" rm', 'system|ProgramData', 'wide,priv'],
      ['su --command=x "rm -rf Winnt" rm', 'system|Winnt', 'wide,priv'],
      ['su --command=x "rm -rf SysWOW64" rm', 'system|SysWOW64', 'wide,priv'],
      ['su --command=x "rm -rf Applications" rm', 'system|Applications', 'wide,priv'],
      ['su --command=x "rm -rf Recovery" rm', 'system|Recovery', 'wide,priv'],
      ['su --command=x "rm -rf PerfLogs" rm', 'system|PerfLogs', 'wide,priv'],
      ['su --command=x "del Winnt" rm', 'system|Winnt', 'wide,priv'],
      ['sudo su --command=x "rm -rf Windows" rm', 'system|Windows', 'wide,priv'],
      ['doas su --command=x "rm -rf Windows" rm', 'system|Windows', 'wide,priv'],
      ['pkexec su --command=x "rm -rf Windows" rm', 'system|Windows', 'wide,priv'],
      // ── ⑥ `NAME=value` 词元族：`upto` 位置是**赋值形态** ─────────────────────────────
      // 判据取 `=` 右侧值再问预筛（与判档循环的 `:4912` 同源）——故右侧是 BARE 系统
      // 目录名 / 路径 / `~` / 变量时都必须产档，而右侧为空（`FOO=`）不是目标。
      ['su --command=x FOO=Windows rm', 'system|Windows', 'wide,priv'],
      ['su --command=x FOO=System32 rm', 'system|System32', 'wide,priv'],
      ['su --command=x FOO=ProgramData rm', 'system|ProgramData', 'wide,priv'],
      ['su --command=x FOO=Winnt rm', 'system|Winnt', 'wide,priv'],
      ['su --command=x FOO=SysWOW64 rm', 'system|SysWOW64', 'wide,priv'],
      ['su --command=x FOO=Applications rm', 'system|Applications', 'wide,priv'],
      ['su --command=x FOO=Recovery rm', 'system|Recovery', 'wide,priv'],
      ['su --command=x FOO=PerfLogs rm', 'system|PerfLogs', 'wide,priv'],
      ['sudo su --command=x FOO=Windows rm', 'system|Windows', 'wide,priv'],
      ['su --command=x FOO=C:/Windows rm', 'system|C:/Windows', 'wide,priv'],
      ['su --command=x FOO=/etc rm', 'outside|/etc', 'outside,priv'],
      ['su --command=x FOO=~ rm', 'home|' + HOME, 'wide,priv'],
      ['su --command=x FOO=$T rm', 'unknown|', 'unknown,priv'],
      ['su --command=x FOO=%TEMP% rm', 'unknown|', 'unknown,priv'],
      // **精确形态**支（`isPrivCommandValueFlag(t)`；连写形态由门控侧自行判）同样承重，一并钉住
      ['su -c C:/Windows rm', 'system|C:/Windows', 'wide,priv'],
      ['su --command C:/Windows rm', 'system|C:/Windows', 'wide,priv'],
      ['su -c /etc rm', 'outside|/etc', 'outside,priv'],
      ['su --command /etc rm', 'outside|/etc', 'outside,priv'],
      ['sudo su -c C:/Windows rm', 'system|C:/Windows', 'wide,priv'],
    ]
    const badWiden = widenGuard.filter(([c, bl, ti]) => {
      const s = segOf(c, 'bash', 'win32')
      const got = s && s.b ? s.b.level + '|' + s.b.path : 'null'
      return got !== bl || (s ? s.t.join(',') : 'null') !== ti
    }).map(([c, bl, ti]) => {
      const s = segOf(c, 'bash', 'win32')
      return [c, (s && s.b ? s.b.level + '|' + s.b.path : 'null') + ' want ' + bl, (s ? s.t.join(',') : 'null') + ' want ' + ti]
    })
    ok('★★ 54d3c win32：**值选项写在操作数之前**的畸形形态不得让命令头收束（与不带该选项时 blast/tiers 同值），且值选项后是真目标时不得放宽',
      badCross3.length === 0 && badTiers3.length === 0 && badWiden.length === 0
      // ② 端到端 priv=allow：修复前这三条是 **allow**（半径档被整档绕过）
      && run('su --command=x root rm -rf /tmp', dsPrivAllow).action === 'ask'
      && run('su --command= root rm -rf /tmp', dsPrivAllow).action === 'ask'
      && run('su --command=x root diskpart', dsPrivAllow).action === 'ask'
      && run('sudo su --command=x root rm -rf /tmp', dsPrivAllow).action === 'ask'
      && run('runas /user:a --command=x rm -rf /tmp', dsPrivAllow).action === 'ask'
      // 端到端 outside=deny + unknown=deny：修复前这两条退成 **ask**
      && run('su --command=x root rm -rf /tmp', dsDeny).action === 'deny'
      && run('su --command=x root diskpart', dsDeny).action === 'deny'
      // ④ 防空转：区内目标**仍必须 allow**（若把整条闸开成「提权一律 ask」这条会红）
      && run('su --command=x root rm -rf ./build', dsPrivAllow).action === 'allow'
      // ⑤⑥ 端到端（发现 1 的用户可见后果）：两族的 `upto` 位置是**真系统目标**，
      // priv=allow 下修复前是 **allow**（半径档被整档绕过），必须恢复成 **ask**。
      && run('su --command=x "rm -rf Windows" rm', dsPrivAllow).action === 'ask'
      && run('su --command=x "cmd System32" rm', dsPrivAllow).action === 'ask'
      && run('su --command=x FOO=Windows rm', dsPrivAllow).action === 'ask'
      && run('su --command=x FOO=System32 rm', dsPrivAllow).action === 'ask'
      // outside=deny + unknown=deny：同上两条必须 deny
      //
      // ⚠️ 这里**不能**用 `dsDeny`：两族命中的半径档是 `wide`（`system` → wide），
      // 而 `dsDeny` 的 `wide` 是 `ask` —— 它会压过 `unknown=deny`，结论是 `ask`。
      // 故另取一张把 `wide` 也设为 deny 的表：**这才证明 `wide` 档真的在场并决定动作**
      // （修复前两族的 tiers 只有 `inside,priv`，本行会得到 allow 而非 deny）。
      && run('su --command=x "rm -rf Windows" rm', dsDenyWide).action === 'deny'
      && run('su --command=x FOO=Windows rm', dsDenyWide).action === 'deny'
      && run('su --command=x "cmd System32" rm', dsDenyWide).action === 'deny'
      // ⑤⑥ **防空转**：两族的判据必须真的在守卫里被求值 —— 断言源码里的调用点形状
      // （守卫只用 `mayNeedBlastCheck` 时本行会红，是「守卫被改窄」的最直接信号）。
      && spSrc.includes('mayYieldRadiusTier(String(w[upto])')
      // ⑤⑥ **防空转**：`FOO=`（右侧为空）不是目标 → 与 `su --command=x rm` 同值（不该被新判据改坏）
      && blastOf('su --command=x FOO= rm', 'bash', 'win32') === blastOf('su --command=x rm', 'bash', 'win32')
      && tiersOf('su --command=x FOO= rm', 'bash', 'win32').join(',') === tiersOf('su --command=x rm', 'bash', 'win32').join(',')
      // ⑤⑥ 防空转：区内目标（`FOO=./build`）仍 allow
      && run('su --command=x FOO=./build rm', dsPrivAllow).action === 'allow'
      // ④ 防空转：`su --command=x root`（后面没有命令）本就判不出半径，与 `su root` 同值即可
      && blastOf('su --command=x root', 'bash', 'win32') === blastOf('su root', 'bash', 'win32')
      && tiersOf('su --command=x root', 'bash', 'win32').join(',') === tiersOf('su root', 'bash', 'win32').join(','),
      JSON.stringify({ badCross3, badTiers3, badWiden,
        f1: blastOf('su --command=x root rm -rf /tmp', 'bash', 'win32'),
        c1: blastOf('su root rm -rf /tmp', 'bash', 'win32'),
        t1: tiersOf('su --command=x root rm -rf /tmp', 'bash', 'win32'),
        t2: tiersOf('su root rm -rf /tmp', 'bash', 'win32'),
        privAllow: run('su --command=x root rm -rf /tmp', dsPrivAllow).action,
        deny: run('su --command=x root rm -rf /tmp', dsDeny).action,
        buildStillAllow: run('su --command=x root rm -rf ./build', dsPrivAllow).action,
        widenSample: blastOf('su --command=x C:/Windows rm', 'bash', 'win32'),
        quoteSample: blastOf('su --command=x "rm -rf Windows" rm', 'bash', 'win32'),
        quoteTiers: tiersOf('su --command=x "rm -rf Windows" rm', 'bash', 'win32'),
        quotePrivAllow: run('su --command=x "rm -rf Windows" rm', dsPrivAllow).action,
        namevalSample: blastOf('su --command=x FOO=Windows rm', 'bash', 'win32'),
        namevalTiers: tiersOf('su --command=x FOO=Windows rm', 'bash', 'win32'),
        namevalPrivAllow: run('su --command=x FOO=Windows rm', dsPrivAllow).action,
        diskpart: tiersOf('su --command=x root diskpart', 'bash', 'win32'),
        proc: tiersOf('su --command=x root kill 1234', 'bash', 'win32'),
        reg: tiersOf('su --command=x root reg delete HKLM\\X /f', 'bash', 'win32') }))
    ok('★★ 54d3 win32：提权前缀后的 `NAME=value` 赋值不得被当成命令名（与不带赋值时 blast/tiers 同值）',
      badCross.length === 0 && badTiers.length === 0
      // 端到端 priv=allow：`sudo FOO=1 rm -rf /tmp` 必须非 allow（修复前是 allow）
      && run('sudo FOO=1 rm -rf /tmp', dsPrivAllow).action !== 'allow'
      && run('sudo FOO=1 diskpart', dsPrivAllow).action !== 'allow'
      // 端到端 outside=deny + unknown=deny：`sudo FOO=1 rm -rf /tmp` 必须 deny（修复前退成 ask）
      && run('sudo FOO=1 rm -rf /tmp', dsDeny).action === 'deny'
      && run('sudo FOO=1 diskpart', dsDeny).action === 'deny'
      // 对照（防空转）：区内目标**仍必须 allow** —— 若把整条闸开成「提权一律 ask」这条会红
      && run('sudo FOO=1 rm -rf ./build', dsPrivAllow).action === 'allow'
      && run('sudo rm -rf ./build', dsPrivAllow).action === 'allow'
      // 对照（防空转）：真正的前导赋值（段首、无前缀）本就正确，不得被本判据改坏
      && blastOf('FOO=1 rm -rf /tmp', 'bash', 'win32') === blastOf('rm -rf /tmp', 'bash', 'win32')
      // 对照（防空转）：`sudo ls /tmp` 只命中 priv（半径判据弃权），不得凭空多出档位
      && tiersOf('sudo FOO=1 ls /tmp', 'bash', 'win32').join(',') === 'priv',
      JSON.stringify({ badCross, badTiers,
        a1: blastOf('sudo FOO=1 rm -rf /tmp', 'bash', 'win32'), b1: blastOf('sudo rm -rf /tmp', 'bash', 'win32'),
        a2: blastOf('sudo FOO=1 diskpart', 'bash', 'win32'), b2: blastOf('sudo diskpart', 'bash', 'win32'),
        t1: tiersOf('sudo FOO=1 rm -rf /tmp', 'bash', 'win32'), t2: tiersOf('sudo rm -rf /tmp', 'bash', 'win32'),
        privAllow: run('sudo FOO=1 rm -rf /tmp', dsPrivAllow).action,
        deny: run('sudo FOO=1 rm -rf /tmp', dsDeny).action,
        buildStillAllow: run('sudo FOO=1 rm -rf ./build', dsPrivAllow).action,
        lsTiers: tiersOf('sudo FOO=1 ls /tmp', 'bash', 'win32') }))
  }
  // ── 54d6：**半径档**那一半 —— `<提权前缀> FOO=1 <关键字> <破坏性命令> <目标> ──────────
  // 54d3 只钉了「`sudo FOO=1 <命令>`（**无关键字夹层**）」与 `sudo FOO=1 ls /tmp`，
  // 对「赋值 + **关键字夹层**」这一格的**半径档**（blast/tiers）**零覆盖** ——
  // 而 60h 的 `PRE60h`（`'LANG=C LC_ALL=C '` / `'A=1 B=2 '`）只喂 `BARE60h`/`MID60h`
  // （即 `unknown` 档那一半），也照不到半径档。
  //
  // 机制（与 54d3 同一处代码、**同一条缺陷的第二半**）：`headCommandNameOf` 的交替推进
  // 循环（`:4051` 起）只在「关键字 / wrapper / 提权前缀」三类上推进，赋值词元落到
  // `if (WRAPPERS[head] !== 1 && PRIV_PREFIXES[head] !== 1) break` → `start` 停在赋值词元
  // → `tailEnd` 那一支取到 `'foo=1'`。下游 `blastRadiusOfSegment:5245` 把它当 `cmdName`
  // 交给 `isCmdStyleSwitch:5279`，`'foo=1'` 查不到组 → 走「认不出命令名 ⇒ 不消费半径」
  // 兜底 → `/tmp` 被当 cmd 开关跳过 → 段级 blast 归 **null** → 档落 `inside`。
  //
  // ⚠️ **不要**声称这是「BARE 硬故障」：BARE 那一半（`unknown` 档）由 `commandHeadEndFull`
  // 的 `headFull` 位置跳过**已经兜住** —— 实测基线 `sudo FOO=1 time diskpart` =
  // `ask|null|unknown,priv`（**闸门有效**），`unknown=deny` 下 = `deny`。硬故障论证
  // 只对 `rm -rf` 族（半径档）成立。本条钉的就是那一半。
  //
  // 判据与 54d3 同口径：**与同形无赋值 / 无夹层逐字同值**（blast + tiers 双口径），
  // 而不是断言某个具体动作 —— 只看「非 allow」会漏掉「判成了更轻的档」。
  // 语料含 `time` / `then` / `!` **三种关键字各一条** + **双赋值无前缀**（`LANG=C LC_ALL=C
  // time rm -rf /tmp`，`headCommandEnd` 的 `:2897` 前导剥离分支）+ **`diskpart` 一条**。
  {
    const dsPrivAllow6 = { inside: 'allow', outside: 'ask', wide: 'ask', unknown: 'ask', proc: 'ask', power: 'ask', priv: 'allow', reg: 'ask' }
    const dsDeny6 = { inside: 'allow', outside: 'deny', wide: 'ask', unknown: 'deny', proc: 'ask', power: 'ask', priv: 'ask', reg: 'ask' }
    const run6 = (c, ds) => {
      const h = tierOpts('win32')
      h.destructive = () => ds
      return assessCommand(c, 'bash', h)
    }
    // 每条 = [带赋值形态, 无赋值的同形对照, 无夹层的同形对照]
    // ⚠️ 三个形态**必须三者同值** —— 只比前两个会漏掉「夹层也被赋值吃掉」那一支。
    const cross6 = [
      ['sudo FOO=1 time rm -rf /tmp', 'sudo time rm -rf /tmp', 'sudo FOO=1 rm -rf /tmp'],
      ['sudo FOO=1 then rm -rf /tmp', 'sudo then rm -rf /tmp', 'sudo FOO=1 rm -rf /tmp'],
      ['sudo FOO=1 ! rm -rf /tmp', 'sudo ! rm -rf /tmp', 'sudo FOO=1 rm -rf /tmp'],
      ['doas FOO=1 time rm -rf /tmp', 'doas time rm -rf /tmp', 'doas FOO=1 rm -rf /tmp'],
      ['gsudo FOO=1 time rm -rf /tmp', 'gsudo time rm -rf /tmp', 'gsudo FOO=1 rm -rf /tmp'],
      ['pkexec FOO=1 time rm -rf /tmp', 'pkexec time rm -rf /tmp', 'pkexec FOO=1 rm -rf /tmp'],
      // 【2】主形态：**双赋值无前缀**
      ['LANG=C LC_ALL=C time rm -rf /tmp', 'time rm -rf /tmp', 'LANG=C LC_ALL=C rm -rf /tmp'],
      ['A=1 B=2 time rm -rf /tmp', 'time rm -rf /tmp', 'A=1 B=2 rm -rf /tmp'],
      ['LANG=C LC_ALL=C then rm -rf /tmp', 'then rm -rf /tmp', 'LANG=C LC_ALL=C rm -rf /tmp'],
      ['LANG=C LC_ALL=C ! rm -rf /tmp', '! rm -rf /tmp', 'LANG=C LC_ALL=C rm -rf /tmp'],
      // `diskpart` 一条（半径档为 null，信号在 tiers 的 `unknown` 上）
      ['sudo FOO=1 time diskpart', 'sudo time diskpart', 'sudo FOO=1 diskpart'],
    ]
    const bad6 = []
    let pair6 = 0
    for (const [a, b, c] of cross6) {
      const ba = blastOf(a, 'bash', 'win32'), bb = blastOf(b, 'bash', 'win32'), bc = blastOf(c, 'bash', 'win32')
      const ta = tiersOf(a, 'bash', 'win32').join(','), tb = tiersOf(b, 'bash', 'win32').join(','), tc = tiersOf(c, 'bash', 'win32').join(',')
      pair6 += 1
      if (ba !== bb || ba !== bc) bad6.push([a, 'blast', ba, b, bb, c, bc])
      if (ta !== tb || ta !== tc) bad6.push([a, 'tiers', ta, b, tb, c, tc])
      // 对照必须**带信号**（blast 非 null，或 tiers 非空），否则三边的 null/空会让「同值」恒真
      if (bb === null && tb === '') bad6.push([b + '(对照无信号)', bb, tb])
      if (bc === null && tc === '') bad6.push([c + '(对照无信号)', bc, tc])
    }
    // 防空转：对照形态本身必须是**半径档**（`outside`），否则本条退化成空转
    const ctrl6 = ['sudo time rm -rf /tmp', 'sudo FOO=1 rm -rf /tmp', 'time rm -rf /tmp',
      'LANG=C LC_ALL=C rm -rf /tmp', 'A=1 B=2 rm -rf /tmp']
    const ctrlBad6 = ctrl6.filter((c) => blastOf(c, 'bash', 'win32') !== 'outside')
    ok('★★ 54d6 win32：`<提权前缀> FOO=1 <关键字> <破坏性命令> <目标>` 的**半径档**必须与同形无赋值/无夹层逐字同值（含 `time`/`then`/`!` 各一条 + 双赋值无前缀 + `diskpart`）',
      bad6.length === 0 && ctrlBad6.length === 0
      // 端到端 priv=allow：`sudo FOO=1 time rm -rf /tmp` 必须非 allow（修复前是 allow）
      && run6('sudo FOO=1 time rm -rf /tmp', dsPrivAllow6).action !== 'allow'
      // 端到端 outside=deny：必须 deny（修复前退成 ask）
      && run6('sudo FOO=1 time rm -rf /tmp', dsDeny6).action === 'deny'
      && run6('LANG=C LC_ALL=C time rm -rf /tmp', dsDeny6).action === 'deny'
      // 对照（防空转）：区内目标**仍必须 allow**
      && run6('sudo FOO=1 time rm -rf ./build', dsPrivAllow6).action === 'allow'
      && run6('LANG=C LC_ALL=C time rm -rf ./build', dsPrivAllow6).action === 'allow'
      // 防空转：语料长度自洽式判据**不得**取代绝对值（防「清空 cross6 即恒真」）
      && pair6 === 11 && cross6.length === 11
      // ⚠️ 这一族**必须显式钉住**：`sudo FOO=1 time diskpart` 的 BARE 那一半由 headFull
      // 兜住（**不是硬故障**），本条钉的是半径档 —— 用 `unknown=deny` 证明 `unknown` 档在场
      && run6('sudo FOO=1 time diskpart', dsDeny6).action === 'deny',
      JSON.stringify({ bad6: bad6.slice(0, 8), ctrlBad6, pair6,
        a1: blastOf('sudo FOO=1 time rm -rf /tmp', 'bash', 'win32'),
        b1: blastOf('sudo time rm -rf /tmp', 'bash', 'win32'),
        c1: blastOf('sudo FOO=1 rm -rf /tmp', 'bash', 'win32'),
        t1: tiersOf('sudo FOO=1 time rm -rf /tmp', 'bash', 'win32'),
        a2: blastOf('LANG=C LC_ALL=C time rm -rf /tmp', 'bash', 'win32'),
        t2: tiersOf('LANG=C LC_ALL=C time rm -rf /tmp', 'bash', 'win32'),
        privAllow: run6('sudo FOO=1 time rm -rf /tmp', dsPrivAllow6).action,
        deny: run6('sudo FOO=1 time rm -rf /tmp', dsDeny6).action,
        bareDeny: run6('sudo FOO=1 time diskpart', dsDeny6).action,
        buildStillAllow: run6('sudo FOO=1 time rm -rf ./build', dsPrivAllow6).action }))
  }
  // ── 54d4：`su root -c <cmd>` —— **操作数之后的值选项**形态（本轮修复）──────────────
  // 54d3 / 54d3b / 54d3c 覆盖了「赋值词元」「连写值选项」「值选项在操作数之前」三支，
  // 唯独漏了最常规的一支：`su root -c <cmd>`（GNU getopt 参数置换下 `su` 指定用户后执行
  // 命令的标准写法）。`privOperandSkip` 在**操作数** `root` 上收束后，`at` 指向的是值选项
  // `-c` 本身 —— 它既不是关键字也不是前缀，快速路径判「不是吃目标的命令名」→ **不跨**，
  // 于是链停在 `su` 上、真命令名永不进 labels（判档侧与 label 侧共用这一个推进步，同时失效）。
  //
  // 实测（win32、真实宿主钩子口径）：
  //     su -c kill 1234        labels=["su","kill"]  T=[proc,priv]   ✅
  //     su root kill 1234      labels=["su","kill"]  T=[proc,priv]   ✅
  //     su root -c kill 1234   labels=["su"]         T=[**priv**]    ❌ proc 档整个丢失
  // 端到端（默认八档 inside=allow 其余 ask）：
  //     su -c kill 1234 / su root kill 1234 / sudo kill 1234 → ask（proc 档在管）
  //     su root -c kill 1234                                → 同形态却只剩 priv 档
  // 用户显式写的 deny 例外同样被绕过：例外 `kill *`=deny 时三条对照全 **deny**，
  // 而 `su root -c kill 1234` 是 **ask**（source=destructive）——**默认配置下即触发**。
  // 组档三族（proc / power / reg）全部如此。
  //
  // 判据 = 「与**不带操作数**的同形态同值」（根因判据：值选项不该让命令头收束）。
  // 归属：HEAD 上同样是 ask，**不是本批回归**。
  {
    const dsProcDeny = { inside: 'allow', outside: 'ask', wide: 'ask', unknown: 'ask', proc: 'deny', power: 'deny', priv: 'allow', reg: 'deny' }
    const dsDefault54d4 = { inside: 'allow', outside: 'ask', wide: 'ask', unknown: 'ask', proc: 'ask', power: 'ask', priv: 'ask', reg: 'ask' }
    const dsPrivAllow54d4 = { inside: 'allow', outside: 'ask', wide: 'ask', unknown: 'ask', proc: 'ask', power: 'ask', priv: 'allow', reg: 'ask' }
    const run54d4 = (c, ds, exc) => {
      const h = tierOpts('win32')
      h.destructive = () => ds
      h.category = () => ({ action: 'allow' })
      h.matchException = (segText, label) => {
        for (const pat of (exc || [])) {
          if (matchCommand(pat, segText) || (label && matchCommand(pat, label))) return { action: 'deny', ruleId: 'e1' }
        }
        return null
      }
      return assessCommand(c, 'bash', h)
    }
    // ① 与「不带操作数」的同形态 blast + tiers 双口径同值（覆盖四个组档族与半径族）
    const same = [
      ['su root -c kill 1234', 'su -c kill 1234'],
      ['su root --command kill 1234', 'su --command kill 1234'],
      ['su root -c shutdown -h now', 'su -c shutdown -h now'],
      ['su root -c reg delete HKLM\\X /f', 'su -c reg delete HKLM\\X /f'],
      ['su root -c taskkill /im x.exe', 'su -c taskkill /im x.exe'],
      ['su root -c diskpart', 'su -c diskpart'],
      ['su root -c find /data -delete', 'su -c find /data -delete'],
      ['su root -c rm -rf /tmp', 'su -c rm -rf /tmp'],
      ['su root -c rm -rf ./build', 'su -c rm -rf ./build'],
      ['su root -c kill', 'su -c kill'],
      ['su -l root -c kill 1234', 'su -l root kill 1234'],
      ['sudo su root -c kill 1234', 'sudo su -c kill 1234'],
      ['runas /user:a -c kill 1234', 'runas /user:a kill 1234'],
      // ── 三条守卫各自的观测面（缺一条都会在下面的显式判据里变红）──────────────
      // ① 含**空白**的值是引号包起来的命令行/多词 label，不得当命令名：
      //    跨过它会把 `reg delete` 拆成单词 `reg`，`reg` 档随之丢失（实测标签由
      //    `['su','reg delete']` 退化成 `['su','reg']` —— 而 `reg` 不在组表里）。
      //    ⚠️ 这一条**不能**写成「与 `su -c "reg delete" …` 同值」：不带操作数的那一侧
      //    本来就跨不过含空白词元（`privOperandSkip` 的 `after` 分支），两者本就不同值 ——
      //    同值判据只对**无空白值**的形态成立。它的观测面在下面的 `quotedLabels` 上。
      ['su root -c x diskpart', 'su -c x diskpart'],
      ['su root -c x kill 1234', 'su -c x kill 1234'],
      ['su root -c x rm -rf /tmp', 'su -c x rm -rf /tmp'],
      ['su root -c x', 'su -c x'],
      // ── 值即**语句关键字**（本轮修复；缺这一族会让整个子形态静默回归）──────────────
      // `isTargetEatingNameIn` 的三个来源（破坏性名单 ∪ `PAYLOAD_CARRIERS` ∪ 两词 label）
      // 与 `STATEMENT_KEYWORDS` **交集为空**（`isPrivOperandWord` 显式把关键字排除在操作数
      // 之外），故关键字**结构性**不在原判据的覆盖范围内：`vn='time'` 判假 → 落到快速路径
      // （`afterName` 是 `-c`）→ 返回 `at`（不跨）→ 链停在 `su` 上、真命令名永不进 labels。
      // 实测（修复前）：`su -c time kill 1234` = T[proc,priv]、`su root -c time kill 1234`
      // = T[**priv**]（proc 档整个丢失）；端到端 例外 `kill *`=deny 时前者 deny、后者 **ask**。
      // ⚠️ 这一族**必须显式钉住**：程序化核对过 54d4 的 `same` 列表在本轮之前**不含任何
      // 关键字**，故原断言对该子形态零覆盖（下面 `badKw` 那一段按**全表**穷举补上）。
      ['su root -c time kill 1234', 'su -c time kill 1234'],
      ['su root -c ! kill 1234', 'su -c ! kill 1234'],
      ['su root -c then kill 1234', 'su -c then kill 1234'],
      ['su root -c if kill 1234', 'su -c if kill 1234'],
      ['su root -c foreach kill 1234', 'su -c foreach kill 1234'],
      ['runas /user:a -c time kill 1234', 'runas /user:a time kill 1234'],
      ['sudo su root -c time kill 1234', 'sudo su -c time kill 1234'],
      ['su root -c time reg delete HKLM\\X /f', 'su -c time reg delete HKLM\\X /f'],
      ['su root -c time rm -rf /tmp', 'su -c time rm -rf /tmp'],
      // 路径形态关键字（值含分隔符）：两侧**同为**不跨，判据仍是「同值」而非「跨过」
      ['su root -c /time kill 1234', 'su -c /time kill 1234'],
      ['su root -c C:/if kill 1234', 'su -c C:/if kill 1234'],
    ]
    const bad54d4 = []
    for (const [a, b] of same) {
      const ta = tiersOf(a, 'bash', 'win32').join(','), tb = tiersOf(b, 'bash', 'win32').join(',')
      const ba = blastOf(a, 'bash', 'win32'), bb = blastOf(b, 'bash', 'win32')
      if (ta !== tb || ba !== bb) bad54d4.push([a, ta + '|' + ba, b, tb + '|' + bb])
      // 对照必须带信号（防空转）：`su -c kill` 的 blast 结构性为 null，信号在 tiers 上
      if (bb === null && tiersOf(b, 'bash', 'win32').length === 0) bad54d4.push([b + '(对照无信号)', bb])
    }
    // ── 关键字族按**全表穷举**（与 54p 同纪律：抽样会让「日后往表里新增关键字」多出一条
    //    静默漏报）。**唯一例外是 `{`** —— 词法器把它当**未闭合花括号**，`-c { …` 整段解不出
    //    （两侧同为 `DECOMP-FAIL`，不是分叉），故只跳过它一条，其余 **44 条每一条**都必须在
    //    `same` 判据下同值。
    //    `}` **不跳过**：它被词法器当**闭合花括号**处理 —— **不进 words**（只留在段原文里并置
    //    opaque），整段照常解得出，两侧 words 都少了那个 `}`、**本就同值** ——
    //    实测 `su root -c } kill 1234` → words `["su","root","-c","kill","1234"]`、
    //    `su -c } kill 1234` → words `["su","-c","kill","1234"]`，tiers 两侧同为 `[proc,priv]`、
    //    blast 两侧同为 null。纳入循环**照样通过**（实测 `wouldPass=true`），故**没有理由为它留
    //    一处例外** —— 且它**并非可有可无**：理由不止「少一处例外」，见下面的 ⚠️（`}` 在 parity
    //    与防空转守卫**两半上都有**实打实的鉴别力）。覆盖因此是「全表除 `{` 外全部 44 条」，
    //    `kwChecked` 实测 44。
    //    ⚠️ 纳入 `}` 的额外鉴别力**两半都有**，只是**对称漂移上 parity 那一半为零**：
    //    · parity 那一半：在「`}` **不进 words**」这一前提下两侧恒同值（`}` 在不在 words 里
    //      都会被 `isPrivOperandWord` 同样跳过）—— 实测把词法器改成**保留** `}`（words 为
    //      `["su","root","-c","}","kill","1234"]`）时 parity 断言**不变红**（Keep）。
    //    · 但**非对称**的 `}` 漂移（只扰动一侧 words）**仍由 parity 独立接住**，红灯**只**来自
    //      parity：实测三个变异（`}` 使 words **多一个词元** / **少两个词元** / 依
    //      `words.length` **触发切段**）→ 新循环 **exit=1 红**（`badKw` 落 parity 分支、**不是**
    //      「无信号」）、旧循环 **exit=0 绿**。
    //    · 结构性依据（不依赖任何特定变异）：旧循环 `if (kw === '{' || kw === '}') continue`
    //      **在任何比较之前就跳过**，故 kw=`}` 的 parity 比较在旧循环下**根本不执行** ——
    //      把 `}` 纳入循环**必然**给 parity 这一半新增检测面，「额外鉴别力不在 parity 那一半」
    //      这一二分**不成立**。
    //    · 防空转守卫那一半：D1「孤立 `}` 让整行解不出」、E1「`}` 走配对检查、孤立 `}` 判未
    //      配对」—— 二者在旧循环（`'{'` 与 `'}'` 都跳过、`kwChecked=43`）下**绿**，在当前
    //      循环下**红**（`badKw=[["}","无信号","null","null"]]`，红灯来自**防空转守卫**）。
    //    ⚠️ 故**不要**把 `}` 退回 `continue`：旧循环下上面两个 `}` 专有漂移实测为**绿**，
    //    退回即让它们重新变成静默漏报。
    //    ⚠️ 两条不分叉的**原因不同**，不可混为一谈：`{` 是「两侧都解不出」，`}` 是「两侧都解得出
    //    且同值」。
    //    实测：修复前 45 条里 43 条分叉（不分叉的正是 `{` 与 `}`）；修复后 **0 条**。
    const badKw = []
    let kwChecked = 0
    for (const kw of Object.keys(STATEMENT_KEYWORDS)) {
      if (kw === '{') continue
      kwChecked += 1
      const a = 'su root -c ' + kw + ' kill 1234', b = 'su -c ' + kw + ' kill 1234'
      const ta = tiersOf(a, 'bash', 'win32'), tb = tiersOf(b, 'bash', 'win32')
      const ba = blastOf(a, 'bash', 'win32'), bb = blastOf(b, 'bash', 'win32')
      // 两侧都必须解出信号（防空转：若整族退化成空 tiers，同值判据会恒真）
      if (!ta || !tb || ta.length === 0 || tb.length === 0) badKw.push([kw, '无信号', String(ta), String(tb)])
      else if (ta.join(',') !== tb.join(',') || ba !== bb) badKw.push([kw, ta.join(',') + '|' + ba, tb.join(',') + '|' + bb])
    }
    // ② 端到端：组档必须真的在场并决定动作
    const killExc = run54d4('su root -c kill 1234', dsDefault54d4, ['kill *']).action
    const killExcCtrl = [
      run54d4('su -c kill 1234', dsDefault54d4, ['kill *']).action,
      run54d4('su root kill 1234', dsDefault54d4, ['kill *']).action,
      run54d4('sudo kill 1234', dsDefault54d4, ['kill *']).action,
    ]
    const procAllow = run54d4('su root -c kill 1234', dsPrivAllow54d4, []).action
    const procDeny = run54d4('su root -c kill 1234', dsProcDeny, []).action
    const powerDeny = run54d4('su root -c shutdown -h now', dsProcDeny, []).action
    const regDeny = run54d4('su root -c reg delete HKLM\\X /f', dsProcDeny, []).action
    // ③ 「值即目标」族必须逐字不变（值含分隔符 / 含空白 / 解不出吃目标的命令名）
    const valueIsTarget = [
      ['su -c C:/Windows', 'system|C:/Windows', 'wide,priv'],
      ['su root -c C:/Windows', 'system|C:/Windows', 'wide,priv'],
      ['su root -c /etc', 'outside|/etc', 'outside,priv'],
      ['su root -c ~', 'home|' + HOME, 'wide,priv'],
      ['su root -c of=/dev/sda', 'outside|/dev/sda', 'outside,priv'],
      ['su root -c "rm -rf /"', 'drive-root|/', 'wide,priv'],
      ['su root -c /usr/bin/rm', 'outside|/usr/bin/rm', 'outside,priv'],
      ['su root -c ./kill 1234', 'null', 'priv'],
    ]
    const badValue = valueIsTarget.filter(([c, bl, ti]) => {
      const s = segOf(c, 'bash', 'win32')
      const got = s && s.b ? s.b.level + '|' + s.b.path : 'null'
      return got !== bl || (s ? s.t.join(',') : 'null') !== ti
    }).map(([c, bl, ti]) => {
      const s = segOf(c, 'bash', 'win32')
      return [c, (s && s.b ? s.b.level + '|' + s.b.path : 'null') + ' want ' + bl, (s ? s.t.join(',') : 'null') + ' want ' + ti]
    })
    // ④ 防空转：区内目标仍必须 allow（若把整条闸开成「提权一律 ask」这条会红）
    const buildAllow = run54d4('su root -c rm -rf ./build', dsPrivAllow54d4, []).action
    // ⑤ 三条守卫的**显式观测面**（防空转的关键 —— 上面那些「同值」判据在守卫被去掉后
    //    仍可能因为两边同时退化而恒真，故这里直接钉住 labels 与档位集合）：
    //    · 含空白守卫：`su root -c "reg delete" …` 的 labels 必须**不含**被拆开的单词 `reg`。
    //      跨过含空白词元后，`segmentLabelFrom` 会把 `reg delete` 截成首词 `reg` 进 labels ——
    //      而 `reg` 不在 `GROUP_OF_LABEL` 里，`reg` 档随之丢失（实测 labels 由
    //      `['su']`（正确：不跨）变成 `['su','reg']`）。
    //      对照取 `su root reg delete HKLM\X /f`（**不带值选项**，本来就必须看见 `reg delete`），
    //      证明「`reg delete` 能被认出」这件事本身成立，上面那条不是空转。
    //    · 「吃目标的命令名」守卫：`su root -c x …` 不得凭空多出假 label `x`
    //      （无条件跨过值 → labels 由 `['su']` 变 `['su','x']`）。
    //    · 「裸」守卫（含分隔符的值不当命令名）：`su root -c /usr/bin/rm` 必须与
    //      `su -c /usr/bin/rm` **同值**（值含分隔符 → 不跨，目标照常判档）。
    const quotedLabels = segmentLabels(decomposeCommand('su root -c "reg delete" HKLM\\X /f', 'bash').segments[0].words)
    const xLabels = segmentLabels(decomposeCommand('su root -c x diskpart', 'bash').segments[0].words)
    const ctrlQuoted = segmentLabels(decomposeCommand('su root reg delete HKLM\\X /f', 'bash').segments[0].words)
    const pathValue = ['su root -c /usr/bin/rm']
    const badPathValue = pathValue.filter((c) => tiersOf(c, 'bash', 'win32').join(',') !== 'outside,priv')
    ok('★★ 54d4 win32：`su root -c <cmd>`（操作数**之后**的值选项）不得让命令头收束 —— 与 `su -c <cmd>` 同值，组档与 deny 例外都必须看得见',
      bad54d4.length === 0 && badValue.length === 0
      // 默认八档 + 例外 `kill *`=deny：必须 deny，且与三条对照同值
      && killExc === 'deny' && killExcCtrl.every((x) => x === 'deny')
      // priv=allow + proc/power/reg=deny：三条组档必须各自 deny
      && procDeny === 'deny' && powerDeny === 'deny' && regDeny === 'deny'
      // 防空转：priv=allow 且组档全 ask 时该形态不得被过度收紧成 deny
      && procAllow !== 'deny'
      && buildAllow === 'allow'
      // ⑤ 三条守卫的观测面
      && quotedLabels.indexOf('reg') === -1
      && quotedLabels.indexOf('reg delete') === -1
      && ctrlQuoted.indexOf('reg delete') !== -1
      && xLabels.join(',') === 'su'
      && badPathValue.length === 0
      // ⑥ 关键字族**全表穷举**（修复前 43/45 分叉；唯一的例外是 `{` —— 词法器当未闭合花括号，
      //    两侧同为解不出。`}` **不跳过**：词法器当闭合花括号（不进 words，只置 opaque），
      //    两侧可解且同值；它的鉴别力 parity 与防空转守卫**两半都有**，见上面 `badKw` 前的 ⚠️）
      && badKw.length === 0 && kwChecked === 44,
      JSON.stringify({ bad54d4, badValue, badKw, kwChecked, killExc, killExcCtrl, procAllow, procDeny, powerDeny, regDeny, buildAllow,
        quotedLabels, ctrlQuoted, xLabels, badPathValue,
        t: tiersOf('su root -c kill 1234', 'bash', 'win32'),
        tCtrl: tiersOf('su -c kill 1234', 'bash', 'win32'),
        tKw: tiersOf('su root -c time kill 1234', 'bash', 'win32'),
        tKwCtrl: tiersOf('su -c time kill 1234', 'bash', 'win32'),
        shutdownT: tiersOf('su root -c shutdown -h now', 'bash', 'win32'),
        regT: tiersOf('su root -c reg delete HKLM\\X /f', 'bash', 'win32'),
        diskT: tiersOf('su root -c diskpart', 'bash', 'win32'),
        findB: blastOf('su root -c find /data -delete', 'bash', 'win32') }))
  }
  // ── 54d5：`<值选项> + <语句关键字> + <BARE>` —— 早退守卫缺「值选项词元」一项 ──────────
  // 54d4 的 `same` 列表与上面的全表循环**都只用 `kill 1234`（有实参）**，于是
  // `<关键字> + <BARE>`（diskpart/parted/dd **裸跑**）这一格在 54d4 上 **0 覆盖** ——
  // 套件在缺陷版本与修复版本上**都全绿**（实测：把 54d5 整块移除后，变异体上三套件全绿）。
  // 本组补的就是那一格。
  //
  // 根因：`privOperandSkip` 的 ④ 支在「值选项的值是语句关键字」时返回 `k + 1`
  // （**值选项自身**的下标），而这个返回值**同时是 `commandHeadEnd` 的推进结果**
  // ⇒ `commandHeadEnd` 停在 `-c` 上、`w[end - 1]` 就是值选项词元。
  // `commandHeadEndFull` 的早退判据此前只拒收「关键字 / wrapper / 提权前缀 / `LEAD_ASSIGN`」
  // 四类、**不含值选项** ⇒ 命中早退 `return end` ⇒ 推进循环拿不到机会 ⇒ 真命令名
  // （`diskpart`）落进 `hasNoOperand` 的实参循环被当成**非选项实参** ⇒ 该段不归 `unknown`
  // ⇒ 落半径档 `inside` ⇒ `priv=allow` 时**静默放行**（`diskpart` 裸跑阻塞等 stdin，
  // DSH 非交互环境下该次工具调用直接挂住 —— 硬故障，不是「少一次弹窗」）。
  // 插桩（修复前）：`commandHeadEnd(['su','-c','time','diskpart'])` = **2**、
  // `commandHeadEndFull` = **2**、`headCommandNameOf` = **`'-c'`**、`hasNoOperand` = false；
  // 正确值 **4** / `'diskpart'` / true。
  //
  // 判据选「**与不带值选项的同形态同值**」（根因判据：值选项不该让命令头收束），
  // 而不是「某个具体档位值」—— 后者会随档位表演进而失效，前者不会。
  // ⚠️ **不得**写成 `su root -c <kw> <BARE>` vs `su -c <kw> <BARE>`：两侧**同坏**
  // （实测 CUR 红 0 / FIX 红 0，鉴别力为 0 —— 那正是 54d4 漏掉本格的机制）。
  {
    const dsPrivAllow54d5 = { inside: 'allow', outside: 'ask', wide: 'ask', unknown: 'ask', proc: 'ask', power: 'ask', priv: 'allow', reg: 'ask' }
    const dsUnknownDeny54d5 = { inside: 'allow', outside: 'ask', wide: 'ask', unknown: 'deny', proc: 'ask', power: 'ask', priv: 'allow', reg: 'ask' }
    const run54d5 = (c, ds) => {
      const h = tierOpts('win32')
      h.destructive = () => ds
      h.category = () => ({ action: 'allow' })
      h.matchException = () => null
      return assessCommand(c, 'bash', h)
    }
    const BARES = ['diskpart', 'parted', 'dd']
    // ① tiers + blast 双口径：`su -c <kw> <BARE>` 必须与「不带值选项」的同形态同值。
    //    对照组取 `su <kw> <BARE>`（关键字在 `su` 之后、**没有值选项**）—— 它与裸跑
    //    `diskpart` 同值是本文件既有行为（54p 一族钉过），故这里是纯粹的同值判据。
    const samePairs = [
      ['su -c <kw> <BARE>', 'su <kw> <BARE>', (k, b) => ['su -c ' + k + ' ' + b, 'su ' + k + ' ' + b]],
      ['su -c <kw> <BARE>', 'su -c <BARE>', (k, b) => ['su -c ' + k + ' ' + b, 'su -c ' + b]],
      ['su root -c <kw> <BARE>', 'su root <kw> <BARE>', (k, b) => ['su root -c ' + k + ' ' + b, 'su root ' + k + ' ' + b]],
      ['su root -c <kw> <BARE>', 'su root -c <BARE>', (k, b) => ['su root -c ' + k + ' ' + b, 'su root -c ' + b]],
      ['sudo su -c <kw> <BARE>', 'sudo su <kw> <BARE>', (k, b) => ['sudo su -c ' + k + ' ' + b, 'sudo su ' + k + ' ' + b]],
      ['runas /user:a -c <kw> <BARE>', 'runas /user:a <kw> <BARE>', (k, b) => ['runas /user:a -c ' + k + ' ' + b, 'runas /user:a ' + k + ' ' + b]],
      ['su --command <kw> <BARE>', 'su <kw> <BARE>', (k, b) => ['su --command ' + k + ' ' + b, 'su ' + k + ' ' + b]],
    ]
    const bad54d5 = []
    let pairChecked = 0
    // `{` 与 54d4 同因跳过：词法器把它当**未闭合花括号**，`-c { …` 整段解不出
    // （两侧同为 `DECOMP-FAIL`，不是分叉）。`}` 不跳过（同 54d4 的理由）。
    for (const [la, lb, mk] of samePairs) {
      for (const kw of Object.keys(STATEMENT_KEYWORDS)) {
        if (kw === '{') continue
        for (const b of BARES) {
          const [a, c] = mk(kw, b)
          const ta = tiersOf(a, 'bash', 'win32'), tc = tiersOf(c, 'bash', 'win32')
          const ba = blastOf(a, 'bash', 'win32'), bc = blastOf(c, 'bash', 'win32')
          // 两侧都必须解出信号（防空转：若整族退化成空 tiers，同值判据会恒真）
          if (!ta || !tc || ta.length === 0 || tc.length === 0) {
            bad54d5.push([la + ' vs ' + lb, a, '无信号', String(ta), String(tc)])
            continue
          }
          pairChecked += 1
          if (ta.join(',') !== tc.join(',') || ba !== bc) {
            bad54d5.push([la + ' vs ' + lb, a, ta.join(',') + '|' + ba, c, tc.join(',') + '|' + bc])
          }
        }
      }
    }
    // ② 端到端「不得 allow」（**这一条是硬故障面的守卫**）：`priv=allow` 下
    //    `<值选项> + <关键字> + <BARE>` 静默 allow 会让裸跑交互命令阻塞等 stdin。
    const allowLeak = []
    for (const kw of Object.keys(STATEMENT_KEYWORDS)) {
      if (kw === '{') continue
      for (const b of BARES) {
        for (const [lbl, c] of [
          ['su -c', 'su -c ' + kw + ' ' + b],
          ['su root -c', 'su root -c ' + kw + ' ' + b],
          ['sudo su -c', 'sudo su -c ' + kw + ' ' + b],
          ['runas /user:a -c', 'runas /user:a -c ' + kw + ' ' + b],
          ['su --command', 'su --command ' + kw + ' ' + b],
        ]) {
          const r = run54d5(c, dsPrivAllow54d5)
          if (r.action === 'allow') allowLeak.push([lbl, c, r.action, JSON.stringify(tiersOf(c, 'bash', 'win32'))])
        }
      }
    }
    // ③ `unknown=deny + priv=allow`（§3.3 明文设想）下必须 deny —— 用户显式写的
    //    「读不出就拒绝」不得被绕过（§7.2 的 fail-closed 语义）。
    const unknownDenyFail = []
    for (const c of ['su -c time diskpart', 'su -c if diskpart', 'su root -c foreach parted',
      'sudo su -c else dd', 'su --command then diskpart']) {
      const r = run54d5(c, dsUnknownDeny54d5)
      if (r.action !== 'deny') unknownDenyFail.push([c, r.action, JSON.stringify(tiersOf(c, 'bash', 'win32'))])
    }
    // ④ 对照（防空转 / 防过度收紧）：**不带值选项**的同形态本就含 `unknown`，
    //    且三条**必须仍含 `unknown`** 的经典形态逐字不变。
    const ctrlMustHaveUnknown = ['su -c diskpart', 'su time diskpart', 'time diskpart',
      'sudo time diskpart', 'su --command diskpart', 'sudo time env diskpart', 'time env diskpart']
    const ctrlBad = ctrlMustHaveUnknown.filter((c) => {
      const t = tiersOf(c, 'bash', 'win32')
      return !t || t.indexOf('unknown') === -1
    })
    // ⑤ 防过度收紧：「值即目标」族（`-c` 的值含分隔符 / 空白）必须逐字不变，
    //    且区内裸跑在 priv=allow 下仍 allow（否则整条闸被开成「提权一律 ask」）。
    //    ⚠️ 期望值按**实测**填（win32 口径），不是按直觉 —— 两处直觉初值已被实测推翻：
    //      · `su -c /usr/bin/rm` 是 **null|inside,priv**（不是 outside）—— 与
    //        `su root -c /usr/bin/rm`（outside|/usr/bin/rm）不同：前者 `k` 停在 `-c` 上、
    //        值含分隔符 → 三条守卫各自拦住 → 不跨，目标不参与判档（HEAD 即如此）。
    //      · `su -c dd of=/dev/sda` 是 **outside|/dev/sda**（不是 system）——
    //        `of=/dev/sda` 不含路径分隔符前缀、判的是 outside；`dd /dev/sda` 同。
    const valueIsTarget54d5 = [
      ['su -c C:/Windows', 'system|C:/Windows', 'wide,priv'],
      ['su -c /etc', 'outside|/etc', 'outside,priv'],
      ['su -c of=/dev/sda', 'outside|/dev/sda', 'outside,priv'],
      ['su -c "rm -rf /"', 'drive-root|/', 'wide,priv'],
      ['su -c /usr/bin/rm', 'null', 'inside,priv'],
      ['su root -c /usr/bin/rm', 'outside|/usr/bin/rm', 'outside,priv'],
      // ⚠️ 有实参形态（`<BARE> <单段路径>`）：目标判得出来时**必须仍走半径档**
      ['su -c parted /tmp', 'outside|/tmp', 'outside,priv'],
      ['su -c dd /dev/sda', 'outside|/dev/sda', 'outside,priv'],
      ['su -c dd of=/dev/sda', 'outside|/dev/sda', 'outside,priv'],
      ['su -c time parted /dev/sda', 'outside|/dev/sda', 'outside,priv'],
      // 仲裁实测「逐字不变」的两条（本组复核，防本次修法波及）
      ['parted /dev/sda', 'outside|/dev/sda', 'outside'],
    ]
    const badValue54d5 = valueIsTarget54d5.filter(([c, bl, ti]) => {
      const s = segOf(c, 'bash', 'win32')
      const got = s && s.b ? s.b.level + '|' + s.b.path : 'null'
      return got !== bl || (s ? s.t.join(',') : 'null') !== ti
    }).map(([c]) => {
      const s = segOf(c, 'bash', 'win32')
      return [c, (s && s.b ? s.b.level + '|' + s.b.path : 'null') + ' want ' + c]
    })
    const buildAllow54d5 = run54d5('su -c rm -rf ./build', dsPrivAllow54d5).action
    ok('★★ 54d5 win32：`<值选项> + <语句关键字> + <BARE>` 不得让命令头收束 —— 与不带值选项的同形态同值，且 `priv=allow` 下不得 allow',
      bad54d5.length === 0 && allowLeak.length === 0 && unknownDenyFail.length === 0
      && ctrlBad.length === 0 && badValue54d5.length === 0
      && buildAllow54d5 === 'allow'
      // 覆盖面：7 组对照 × 44 关键字 × 3 BARE
      && pairChecked === 7 * 44 * 3,
      JSON.stringify({ bad54d5: bad54d5.slice(0, 8), allowLeak: allowLeak.slice(0, 8), unknownDenyFail,
        ctrlBad, badValue54d5, buildAllow54d5, pairChecked,
        tSuC: tiersOf('su -c time diskpart', 'bash', 'win32'),
        tSu: tiersOf('su time diskpart', 'bash', 'win32'),
        bSuC: blastOf('su -c time diskpart', 'bash', 'win32'),
        bSu: blastOf('su time diskpart', 'bash', 'win32'),
        tParted: tiersOf('su -c time parted /dev/sda', 'bash', 'win32'),
        bParted: blastOf('su -c time parted /dev/sda', 'bash', 'win32') }))

    // ── 54d5⑥：`<普通选项> + <语句关键字> + <BARE>` —— 早退守卫缺「普通选项词元」一项 ────
    // ⚠️ 上面整块 54d5 的语料**全是「值选项」形态**（`-c` / `--command`），故
    // **结构性照不出普通选项**（`-l` / `-` / `--login` / `-i` / `--help` …）。
    // 两者是**不同形态**、走**不同成因**：
    //   · 值选项（`-c`）：`privOperandSkip` 的 ④ 支返回值**就是** `commandHeadEnd` 的推进
    //     结果 ⇒ 停在值选项上 ⇒ 守卫缺「值选项」一项（已在 `:2796` 补上）；
    //   · 普通选项（`-l`）：`commandHeadEnd` 的 ① 分支经 `skipPrefixArgs` 把选项**吃掉**
    //     并**停在其上** ⇒ 守卫缺「普通选项」一项（本次在 `:2798` 补上）。
    // `-l` **确不在**原五类判据内：`STATEMENT_KEYWORDS` false、非 `WRAPPERS`、
    // 非 `PRIV_PREFIXES`、`isPrivCommandValueFlag('-l')` = **false**（表里只有 `-c`/`--command`）、
    // 不匹配 `LEAD_ASSIGN`。
    // 插桩（修复前）：`commandHeadEndFull(['su','-l','time','diskpart'])` = **2**、
    // `headCommandNameOf` = `'-l'`、`hasNoOperand` = **false**；正确值 hf=**4** / `'diskpart'` / true。
    // 后果：该段不归 `unknown` ⇒ 落半径档 `inside` ⇒ `priv=allow` 下**静默 allow**；
    // `diskpart` 裸跑阻塞 stdin ⇒ 硬故障（DSH 非交互环境下工具调用直接挂住）。
    //
    // 判据同 54d5 的根因口径：「**与不带该选项的同形态同值**」（不是某个具体档位值 ——
    // 后者会随档位表演进而失效）。参考形态取 `su <关键字> <BARE>`，它含 `unknown` 是本文件
    // 既有行为（54p 一族钉过），故这是纯粹的同值判据。
    {
      const runOrd54d5 = (c, ds, pl) => {
        const h = tierOpts(pl)
        h.destructive = () => ds
        h.category = () => ({ action: 'allow' })
        h.matchException = () => null
        return assessCommand(c, 'bash', h)
      }
      // 普通选项（**不含**值选项 `-c`/`--command` —— 那两个走 54d5 本块已覆盖的形态）
      const PLAIN_OPTS54d5 = ['-l', '-', '--login', '-i', '--help', '--version', '--pty',
        '-s', '-m', '-p', '-u', '-e', '-g', '-G', '-V', '-h', '-f', '-n', '-r', '-t']
      const badOrd54d5 = []
      let ordChecked54d5 = 0
      for (const o of PLAIN_OPTS54d5) {
        for (const kw of Object.keys(STATEMENT_KEYWORDS)) {
          if (kw === '{') continue
          for (const b of BARES) {
            const wa = 'su ' + o + ' ' + kw + ' ' + b
            const na = 'su ' + kw + ' ' + b
            for (const pl of ['win32', 'posix']) {
              const ta = tiersOf(wa, 'bash', pl), tn = tiersOf(na, 'bash', pl)
              const ba = blastOf(wa, 'bash', pl), bn = blastOf(na, 'bash', pl)
              // 防空转：两侧都必须解出信号（否则同值判据恒真）
              if (!ta || !tn || ta.length === 0 || tn.length === 0) {
                badOrd54d5.push(['无信号', wa, pl, String(ta), String(tn)])
                continue
              }
              ordChecked54d5 += 1
              if (ta.join(',') !== tn.join(',') || ba !== bn) {
                badOrd54d5.push(['与无选项不同值', wa, pl, ta.join(',') + '|' + ba, tn.join(',') + '|' + bn])
              }
            }
          }
        }
      }
      // ② 端到端硬故障守卫：`priv=allow` 下 `<普通选项> + <关键字> + <BARE>` 不得 allow
      const dsPrivAllowOrd = { inside: 'allow', outside: 'ask', wide: 'ask', unknown: 'ask', proc: 'ask', power: 'ask', priv: 'allow', reg: 'ask' }
      const allowLeakOrd = []
      for (const o of PLAIN_OPTS54d5) {
        for (const kw of Object.keys(STATEMENT_KEYWORDS)) {
          if (kw === '{') continue
          for (const b of BARES) {
            const c = 'su ' + o + ' ' + kw + ' ' + b
            const r = runOrd54d5(c, dsPrivAllowOrd, 'win32')
            if (r.action === 'allow') allowLeakOrd.push([c, r.action, JSON.stringify(tiersOf(c, 'bash', 'win32'))])
          }
        }
      }
      // ③ `unknown=deny + priv=allow`（§3.3 明文设想）下必须 deny —— fail-closed 不得被绕过
      const dsUnknownDenyOrd = { inside: 'allow', outside: 'ask', wide: 'ask', unknown: 'deny', proc: 'ask', power: 'ask', priv: 'allow', reg: 'ask' }
      const unknownDenyFailOrd = []
      for (const c of ['su -l time diskpart', 'su - time parted', 'su --login if dd',
        'su -i foreach diskpart', 'su --help then parted', 'su -l diskpart']) {
        const r = runOrd54d5(c, dsUnknownDenyOrd, 'win32')
        if (r.action !== 'deny') unknownDenyFailOrd.push([c, r.action, JSON.stringify(tiersOf(c, 'bash', 'win32'))])
      }
      // ④ 防过度收紧：普通选项**不该**改变「本就有值」的形态，也不得把值选项形态带偏。
      //    ⚠️ 期望值按**实测**填（win32 口径），两处直觉初值已被实测推翻：
      //      · `su -l diskpart` 是 `unknown,priv`（选项后直接跟命令名，两侧本就同值）；
      //      · `su -l diskpart /s a.txt` 是 `unknown,priv`（`/s` 是命令自己的开关，
      //        不在前缀选项表里，故仍归 unknown —— 与无选项形态同值）。
      const ctrlOrd54d5 = [
        ['su -l diskpart', 'unknown,priv'],
        ['su -l diskpart /s a.txt', 'unknown,priv'],
        ['su -l kill 1234', 'proc,priv'],
        ['su -l rm -rf /tmp', 'outside,priv'],
        ['su -l C:/Windows', 'wide,priv'],
        ['su -c time diskpart', 'unknown,priv'],
        ['su --command time diskpart', 'unknown,priv'],
        ['diskpart /s a.txt', 'unknown'],
        ['su time diskpart', 'unknown,priv'],
        ['su -l time parted', 'unknown,priv'],
      ]
      const ctrlBadOrd = ctrlOrd54d5.filter(([c, want]) => {
        const t = tiersOf(c, 'bash', 'win32')
        return !t || t.join(',') !== want
      }).map(([c, want]) => [c, (tiersOf(c, 'bash', 'win32') || []).join(','), want])
      // ⑤ 防空转：确有一条形态在**修复前**是分叉的（否则整族恒真）
      //    —— 用「对照形态必须含 unknown 档」证明语料确实打在该路径上
      const hasUnknownSignal = ['su time diskpart', 'su if parted', 'su then dd'].every((c) => {
        const t = tiersOf(c, 'bash', 'win32')
        return t && t.indexOf('unknown') !== -1
      })
      ok('★★ 54d5⑥ win32/posix：`<普通选项> + <语句关键字> + <BARE>` 不得让命令头收束'
        + ' —— 与不带该选项的同形态同值，且 `priv=allow` 下不得 allow',
        badOrd54d5.length === 0 && allowLeakOrd.length === 0 && unknownDenyFailOrd.length === 0
        && ctrlBadOrd.length === 0 && hasUnknownSignal
        // 覆盖面：20 个普通选项 × 44 关键字 × 3 BARE × 2 平台
        && ordChecked54d5 === PLAIN_OPTS54d5.length * 44 * 3 * 2,
        JSON.stringify({ badOrd54d5: badOrd54d5.slice(0, 8), allowLeakOrd: allowLeakOrd.slice(0, 8),
          unknownDenyFailOrd, ctrlBadOrd, ordChecked54d5, hasUnknownSignal,
          tSuL: tiersOf('su -l time diskpart', 'bash', 'win32'),
          tSuRef: tiersOf('su time diskpart', 'bash', 'win32'),
          actSuL: runOrd54d5('su -l time diskpart', dsPrivAllowOrd, 'win32').action,
          actSuRef: runOrd54d5('su time diskpart', dsPrivAllowOrd, 'win32').action }))
    }

    // ── 54d5⑦：`<普通选项> + <操作数> + <命令> + <目标>` —— 54d5⑥ 的**操作数维度**盲区 ──────
    // ⚠️ 上面 54d5 与 54d5⑥ 的语料**都没有「操作数」这一维**（`su <opt> <kw> <BARE>`），
    // 故结构性照不出本族：实测 54d5⑥ 语料对本族覆盖 **0/1440**。
    //
    // 根因（**不在 `:2898` 那一行**，那里只是**触发器**）：`:2898`（普通选项守卫）把
    // `headFull` 由 2 推进到 4 是**正确**的一半；真正的成因是 `cmdName` 的**取值口径** ——
    // `headCommandNameOf(w, 2)` = `'-l'` ⇒ `isCmdStyleSwitch('/data', opts, '-l')` 因
    // `GROUP_OF_LABEL['-l']` 查不到而走「认不出命令名 ⇒ 不消费半径」兜底 ⇒ `/data` 被当
    // cmd 开关跳过。
    // ⇒ **任何只改 ③ 分支的修法结构上不可能修好本族**（方案 S 与方案 R 实测均无效）。
    //
    // ⚠️ 这个「取值口径」在文件里有**两个消费点**，必须同批修（否则同一段两处对
    // 「命令名是谁」给出不同答案）：
    //   · `hasNoOperand`（`shell-parse.js:4871-4874`）—— 拿 `'-l'` ⇒ `hasNoOperand`
    //     由 false→true ⇒ **`outside,priv` 被 `unknown,priv` 替换**；
    //   · `blastRadiusOfSegment`（`shell-parse.js:5478-5485`，原 `:5435` 那一行）—— 拿 `'-l'`
    //     ⇒ 目标实参被当 cmd 开关跳过 ⇒ **段级 blast 归 `null`** ⇒ `radiusTierOf(null)` = `inside`。
    // 本组 ① 的四形态语料**同时**照这两个消费点：盘符形态 `C:/<kw>` 打在 `hasNoOperand`
    // 上（`unknown,priv` vs `outside,priv`），`/<kw>` / `<kw>` 形态打在 `:5435` 上
    // （`inside,priv#null` vs `outside,priv#outside|…`）。
    //
    // 触发条件**比「22 个普通选项 × 任意操作数」窄得多**：唯一成因是
    // 「`su`/`runas` 的**操作数** basename 恰好命中 `STATEMENT_KEYWORDS`」——
    // `su` 的操作数由 `privOperandSkip`/`isPrivOperandWord` 判，该判据对「basename 在
    // 关键字表里」的词元返回 false（不跨）⇒ 段首 `su` 走 ② 只推 1 个词元，
    // 下一轮 `C:/data` 的 basename `data` **命中 ① 关键字支** ⇒ 命令头越过操作数、
    // 把 `parted` 当命令名吃掉（`headFull=4`，段长 5），而 `headEnd` 仍停在 2 的 `-l`。
    // 实测 8,220 格扫描：分叉 4,816 格、涉及 86 个操作数，**「分叉但 basename 不命中
    // 关键字表」= 0**；`C:/etc` / `/etc` / `C:/tmp` / `/tmp` / `C:/Windows` / `C:/users` /
    // `root` / `x` / `A=/etc` / `A=/bin/rm` / `of=/dev/sda` / `A=C:/Windows` / `A=../other`
    // 全部**逐字同值**（故语料**必须**用命中关键字表的词，用 `C:/etc` 照不出本族）。
    //
    // 判据（三条，缺一不可）：
    //   ① **同值**：`su <普通选项> <操作数> <命令> <目标>` 与**同形无选项**的
    //      `su <操作数> <命令> <目标>` 的 **tiers + blast 逐字同值** ——
    //      语料取**四种操作数形态** `C:/<kw>` / `D:/<kw>` / `/<kw>` / `<kw>`：
    //      · 前两种打 `hasNoOperand`（`:4871`）那个消费点 —— 实测 PRE 违反 **0**、
    //        CUR 违反 1548（`unknown,priv` vs `outside,priv`）、FINAL 违反 **0**；
    //      · 后两种打 `blastRadiusOfSegment`（`:5478`）那个消费点 —— 实测 PRE 违反
    //        **1512 / 1548**、CUR 违反 **1512 / 1548**、FINAL 违反 **0**
    //        （CUR 上是 `inside,priv#null` vs `outside,priv#outside|…`：blast 整个丢失）。
    //      ⚠️ 曾经把后两种**排除在「同值」之外**、改钉「分叉格数 == PRE 基线 1512/1548」
    //      —— 那等于**把缺陷钉成了基线**（CUR 恰好等于该基线故当时是绿的）。修好 `:5435`
    //      后两形态与无选项**逐字同值**（drift 0），故并入同值语料：判据从「钉 PRE 基线」
    //      升级为「钉同值」，**比 PRE 更强**，且不会再钉住缺陷。
    //      ⚠️ 原先记的归因（「`/data` 是绝对路径、`data` 是裸词元，`su` 的操作数判据对二者
    //      结论不同」）**不准确**：实测成因就是本缺陷本身 —— 同一个
    //      `isCmdStyleSwitch(token, opts, cmdName)` 在 `cmdName` 为 `-l` 时把 `/data` 当
    //      开关、为 `dd` 时不当开关；`/data` 与 `data` 在**同一命令**上的 `cmdName` 不同
    //      （`headFull` 是否越过操作数），才是两者分叉格数不同（1512 / 1548）的原因。
    //   ② **端到端**：`outside=deny` 单档下本族必须 **deny**（CUR 是 ask）；
    //      再加 `outside=deny + unknown=allow + priv=allow` 不得退成 **allow**
    //      —— 实测该配置下 `su -l C:/data parted /data` 是 **PRE=deny / CUR=allow / FINAL=deny**
    //      （本族的 fail-open 极限，语料里唯一能同时满足「PRE 为 deny 且 CUR 为 allow」的一族）；
    //   ③ **防空转**：同形无选项的对照形态必须判出 `outside`（证明语料确实打在该路径上）。
    {
      const DS54d5_7_OUT = { inside: 'allow', outside: 'deny', wide: 'deny', unknown: 'ask', proc: 'ask', power: 'ask', priv: 'ask', reg: 'ask' }
      const DS54d5_7_LEAK = { inside: 'ask', outside: 'deny', wide: 'deny', unknown: 'allow', proc: 'ask', power: 'ask', priv: 'allow', reg: 'ask' }
      const run54d5_7 = (c, ds, pl) => {
        const h = tierOpts(pl || 'win32')
        h.destructive = () => ds
        h.category = () => ({ action: 'allow' })
        h.matchException = () => null
        return assessCommand(c, 'bash', h)
      }
      const key54d5_7 = (c, pl) => {
        const s = segOf(c, 'bash', pl)
        if (!s) return 'ERR'
        return JSON.stringify(s.t) + '#' + (s.b ? s.b.level + '|' + s.b.path : 'null')
      }
      const OPT54d5_7 = ['-l', '-', '--login', '-i', '--help', '--pty', '-s', '-p', '-u']
      const CMD54d5_7 = [['parted', '/data'], ['dd', '/myapp'], ['diskpart', '/s a.txt'], ['kill', '1234']]
      // ① 四种操作数形态：**全部**必须与同形无选项逐字同值（有鉴别力：CUR 上 3060 格红）
      const badSame54d5_7 = []
      let chk54d5_7 = 0
      for (const pfx of ['su', 'runas']) {
        for (const o of OPT54d5_7) {
          for (const kw of Object.keys(STATEMENT_KEYWORDS)) {
            if (kw === '{') continue
            for (const op of ['C:/' + kw, 'D:/' + kw, '/' + kw, kw]) {
              for (const [c, tg] of CMD54d5_7) {
                const wa = pfx + ' ' + o + ' ' + op + ' ' + c + ' ' + tg
                const wn = pfx + ' ' + op + ' ' + c + ' ' + tg
                for (const pl of ['win32', 'posix']) {
                  chk54d5_7 += 1
                  const ka = key54d5_7(wa, pl), kn = key54d5_7(wn, pl)
                  // 防空转：两侧都必须解出档位信号（`[]#null` 视为无信号）
                  if (ka === 'ERR' || kn === 'ERR' || ka.indexOf('[]') === 0) {
                    badSame54d5_7.push(['无信号', wa, pl, ka, kn])
                    continue
                  }
                  if (ka !== kn) badSame54d5_7.push(['与无选项不同值', wa, pl, ka, kn])
                }
              }
            }
          }
        }
      }
      // ① 的四形态已把 `/<kw>` / `<kw>` 一并纳入「必须逐字同值」的语料（见上面的实测表），
      // 故这里**不再另设 PRE 基线**：曾经那个 `DRIFT_BASE_54d5_7 = { '/<kw>': 1512,
      // '<kw>': 1548 }` 是把**缺陷**钉成了基线（CUR 恰好等于该基线，于是套件在缺陷上仍是绿的）。
      // 修好 `shell-parse.js:5478` 后两形态 drift 归 0 ⇒ 判据从「钉 PRE 基线」升级为「钉同值」。
      // ② 端到端：`outside=deny` 下本族必须 deny（CUR 是 ask）
      const leak54d5_7 = []
      const KNOWN54d5_7 = ['su -l C:/data parted /data', 'su -l D:/data parted /data',
        'su -l C:/do parted /data', 'su -l C:/if parted /data', 'su -l C:/then parted /data',
        'su -l C:/data dd /myapp', 'runas -l C:/data parted /data']
      for (const c of KNOWN54d5_7) {
        const r = run54d5_7(c, DS54d5_7_OUT, 'win32')
        if (r.action !== 'deny') leak54d5_7.push(['outside=deny 未 deny', c, r.action, key54d5_7(c, 'win32')])
      }
      // ② 端到端：`outside=deny + unknown=allow + priv=allow` 下不得 allow
      //    （实测该配置下本族是 PRE=deny / CUR=**allow** / FINAL=deny）
      const leak2_54d5_7 = []
      for (const c of KNOWN54d5_7) {
        const r = run54d5_7(c, DS54d5_7_LEAK, 'win32')
        if (r.action !== 'deny') leak2_54d5_7.push(['unknown=allow+priv=allow 下未 deny', c, r.action, key54d5_7(c, 'win32')])
      }
      // ③ 对照（防空转）：同形无选项必须判出 `outside`（证明语料确实打在该路径上）
      const sig54d5_7 = ['su C:/data parted /data', 'su D:/data parted /data',
        'su C:/data dd /myapp', 'runas C:/data parted /data']
        .every((c) => key54d5_7(c, 'win32').indexOf('outside') !== -1)
      // ④ 防过度收紧 / 防带偏：值选项形态（`-c`/`--command`，本修法**刻意不碰**）、
      //    命中关键字表**但带子路径**的操作数（`headFull` 不推进，两侧本就同值）、
      //    以及不命中关键字表的操作数 —— 期望值按**实测**填（测试文件口径）
      const ctrl54d5_7 = [
        ['su -c C:/data parted /data', 'unknown,priv'],
        ['su -c /data parted /data', 'unknown,priv'],
        ['su --command time diskpart', 'unknown,priv'],
        ['su -l C:/data/sub parted /data', 'outside,priv'],
        ['su -l C:/etc parted /data', 'outside,priv'],
        ['su -l /etc parted /data', 'outside,priv'],
        ['su -l root parted /data', 'outside,priv'],
        ['su -l C:/Windows parted /data', 'outside,priv'],
        ['su -l time diskpart', 'unknown,priv'],
        ['su -l diskpart', 'unknown,priv'],
        ['su -l kill 1234', 'proc,priv'],
        ['su -l rm -rf /tmp', 'outside,priv'],
      ]
      const ctrlBad54d5_7 = ctrl54d5_7.filter(([c, want]) => {
        const t = tiersOf(c, 'bash', 'win32')
        return !t || t.join(',') !== want
      }).map(([c, want]) => [c, (tiersOf(c, 'bash', 'win32') || []).join(','), want])
      ok('★★ 54d5⑦ win32/posix：`<普通选项> + <操作数> + <命令> + <目标>` 不得让命令头收束'
        + ' —— 四种操作数形态（`C:/<kw>` `D:/<kw>` `/<kw>` `<kw>`）与**同形无选项**逐字同值'
        + '（操作数 basename 须命中 STATEMENT_KEYWORDS），'
        + ' 且 `outside=deny`（含 `+unknown=allow+priv=allow`）下必须 deny',
        badSame54d5_7.length === 0 && leak54d5_7.length === 0 && leak2_54d5_7.length === 0
        && ctrlBad54d5_7.length === 0 && sig54d5_7
        // 覆盖面：2 前缀 × 9 普通选项 × 44 关键字 × **4 操作数形态** × 4 命令 × 2 平台
        && chk54d5_7 === 2 * OPT54d5_7.length * 44 * 4 * 4 * 2,
        JSON.stringify({ badSame54d5_7: badSame54d5_7.slice(0, 6),
          leak54d5_7, leak2_54d5_7, ctrlBad54d5_7, chk54d5_7, sig54d5_7,
          kCdata: key54d5_7('su -l C:/data parted /data', 'win32'),
          kCdataNoOpt: key54d5_7('su C:/data parted /data', 'win32'),
          kSlashData: key54d5_7('su -l /data parted /data', 'win32'),
          kSlashDataNoOpt: key54d5_7('su /data parted /data', 'win32'),
          kData: key54d5_7('su -l data parted /data', 'win32'),
          kDataNoOpt: key54d5_7('su data parted /data', 'win32'),
          actOut: run54d5_7('su -l C:/data parted /data', DS54d5_7_OUT, 'win32').action,
          actLeak: run54d5_7('su -l C:/data parted /data', DS54d5_7_LEAK, 'win32').action }))
    }
  }
  // ── 54e：`find` 族 —— **真删除形态一条都不能漏**（54d2 的方向守卫）────────────────────
  // 54d2 删掉「后跟 wrapper/前缀就无条件跨过操作数」之后，「操作数 + wrapper + 目标」
  // 这一族要重新分类，而 `find` 族是最容易**改出新漏报**的一处：
  //   · `find` **不在** `DESTRUCTIVE_LABELS` 里（它的破坏性来自后续 `-delete` / `-exec`），
  //     故若把「跨越理由」写成只认 `isDestructiveLabel`，`su root env find /data -delete`
  //     的操作数就不会被跨过 → `headCommandNameOf` 取回 `root` →
  //     `isCmdStyleSwitch('/data', …, 'root')` 认不出命令域 → **`/data` 被当 cmd 开关跳过**
  //     → 段级 blast 归 null → 档位 inside → 真删除命令静默。
  //     实测（该写法下、端到端、win32、priv=allow）：`su root env find /data -delete` 与
  //     `su root sudo find /data -delete` 由 **ask** 变成 **allow**，
  //     而对照的 `env find /data -delete` 仍是 ask —— 同一件事只因多一个 `su` 操作数就分叉。
  //   故实现里跨越理由取「破坏性名单 ∪ 载荷族」（`isTargetEatingName`，复用 PAYLOAD_CARRIERS
  //   单点），本组就是钉住那一处的：**真删除形态必须非 null 且端到端非 allow**。
  {
    const findDelete = [
      'su root env find /data -delete', 'su root sudo find /data -delete',
      'su -u root env find /data -delete', 'su root env find /data -exec rm -rf {} +',
      'su root env find / -delete', 'su root env find / -exec rm -rf {} +',
      'su root env find /data -exec rm -rf {} ;', 'su root sudo find / -delete',
    ]
    const badFindDelete = findDelete.filter((c) => blastOf(c, 'bash', 'win32') === null)
    const dsPrivAllow54e = { inside: 'allow', outside: 'ask', wide: 'ask', unknown: 'ask', proc: 'ask', power: 'ask', priv: 'allow', reg: 'ask' }
    const h54e = tierOpts('win32')
    h54e.destructive = () => dsPrivAllow54e
    const allowFindDelete = findDelete.filter((c) => assessCommand(c, 'bash', h54e).action === 'allow')
    ok('★★ 54e win32：`su` 操作数 + wrapper/前缀 + `find -delete`/`-exec` 不得漏判（真删除形态必须非 null 且非 allow）',
      badFindDelete.length === 0 && allowFindDelete.length === 0
      // 对照（防空转）：不带 `su` 操作数的同样形态本就判得出来，且与带操作数时同值
      && blastOf('env find /data -delete', 'bash', 'win32') !== null
      && blastOf('find /data -delete', 'bash', 'win32') !== null
      && blastOf('su root env find /data -delete', 'bash', 'win32') === blastOf('env find /data -delete', 'bash', 'win32')
      && blastOf('su root env find / -delete', 'bash', 'win32') === 'drive-root'
      // 对照（防过度收紧）：纯路径目标仍与不带 wrapper 时同值（54d2 的收益不得被本条吃掉）
      && blastOf('su root env /etc', 'bash', 'win32') === blastOf('su root /etc', 'bash', 'win32')
      && blastOf('su root sudo C:/Windows', 'bash', 'win32') === blastOf('su root C:/Windows', 'bash', 'win32')
      // 方向检验：`find` **搜索路径**（无 -delete/-exec）仍判 outside —— 这是**已知的假警告**，
      // 方向 fail-safe（多问一次），且它换来的是上面「真删除不漏」。
      // 为什么不把这条假警告也消掉：那需要让 `find` 不被跨过，而 `find` 一旦不被跨过，
      // 紧随其后的 `-delete` / `-exec` 也一并丢失。实测（变异：跨越理由只认
      // `isDestructiveLabel`、不覆盖载荷族）：穷举 4 个提权前缀 × 11 个中间层 × 7 个目标
      // = 308 形态，**96 条**由非 null 变 null，其中 **64 条是真删除**（含 `-delete`/`-exec`）、
      // 32 条是纯搜索路径 —— 拿 32 条假警告换 64 条真漏报，方向错了。
      // 故这里**钉住它不得变成 allow**：`su root env find /data` 在 priv=allow 下必须仍是 ask
      // （outside 档），不是 allow。
      && assessCommand('su root env find /data', 'bash', h54e).action !== 'allow'
      && assessCommand('su root sudo find /data', 'bash', h54e).action !== 'allow',
      JSON.stringify({ badFindDelete, allowFindDelete,
        suEnvFindDelete: blastOf('su root env find /data -delete', 'bash', 'win32'),
        envFindDelete: blastOf('env find /data -delete', 'bash', 'win32'),
        suEnvFindRootDelete: blastOf('su root env find / -delete', 'bash', 'win32'),
        suEnvFind: blastOf('su root env find /data', 'bash', 'win32'),
        suEnvFindAction: assessCommand('su root env find /data', 'bash', h54e).action,
        suEnvEtc: blastOf('su root env /etc', 'bash', 'win32'), suEtc: blastOf('su root /etc', 'bash', 'win32') }))
  }
  // ── 54h：`su` / `runas` 的操作数之后必须**看得见真命令 label**（本次修复的守卫）──────
  // 根因：`pushHeadLabels` 曾用 `PRIV_PREFIXES[first] !== 1 || PRIV_VALUE_IS_COMMAND[first]`
  // 把 `su` / `runas` **整体排除**在「前缀后取真命令名」之外，没有复用同一批修复里
  // 为它们专门写好的 `privOperandSkip`（54d / 54d2 / 54e 论证的正是「操作数不是命令名」）。
  // 于是同一个提权语义**因前缀不同而分叉**：`sudo kill 1234` 扩展出 `kill`，
  // `su root kill 1234` 不能 —— 方向是 **fail-open**。
  // 实测（八档、proc/power/reg=deny、priv=allow，修复前）：
  //     kill 1234                    → deny    tiers=['proc']
  //     sudo kill 1234               → deny    tiers=['proc','priv']
  //     su root kill 1234            → **allow** tiers=['priv']  ← proc 档整个丢失
  //     runas /user:admin kill 1234  → **allow** tiers=['priv']
  // 三个组档（proc / power / reg）全部如此。
  {
    const dsGroupDeny = { inside: 'allow', outside: 'ask', wide: 'ask', unknown: 'ask', proc: 'deny', power: 'deny', priv: 'allow', reg: 'deny' }
    const h54h = tierOpts('win32')
    h54h.destructive = () => dsGroupDeny
    h54h.category = () => ({ action: 'allow' })
    // [组档名, 组档命令] —— 覆盖三个组档（proc / power / reg）
    const groupCmds = [
      ['proc', 'kill 1234'], ['proc', 'pkill x'], ['proc', 'taskkill /im a.exe'], ['proc', 'stop-process 1'],
      ['power', 'shutdown /s'], ['power', 'reboot'], ['power', 'stop-computer'],
      ['reg', 'wmic x'], ['reg', 'reg delete HKLM\\X /f'],
    ]
    // 操作数形态：单操作数、`su - root` 的 `-`、`runas` 的两个选项（多操作数）
    const operandPrefixes = ['su root ', 'su - root ', 'runas /user:admin ', 'runas /noprofile /user:admin ']
    const badTier = [], badAllow = []
    for (const [g, c] of groupCmds) {
      // 根因判据：带操作数的形态必须与 `sudo` 对照**同档集**（分叉才是缺陷，allow 只是表现）
      const ref = tiersOf('sudo ' + c, 'bash', 'win32').join(',')
      for (const p of operandPrefixes) {
        const got = tiersOf(p + c, 'bash', 'win32').join(',')
        if (got !== ref) badTier.push([g, p + c, got, 'sudo=' + ref])
        if (assessCommand(p + c, 'bash', h54h).action === 'allow') badAllow.push([g, p + c])
      }
    }
    ok('★★ 54h win32：`su` / `runas` 的操作数之后真命令名必须可见（tiers 与 `sudo` 对照同值，组档 deny 时不得 allow）',
      badTier.length === 0 && badAllow.length === 0
      // 对照（防空转）：`sudo` 对照本身必须真的命中该组档，且在该配置下是 deny ——
      // 否则「同值」可能两边都缺这一档、`badAllow` 也可能因配置没生效而恒空。
      && groupCmds.every(([g, c]) => tiersOf('sudo ' + c, 'bash', 'win32').indexOf(g) !== -1
        && assessCommand('sudo ' + c, 'bash', h54h).action === 'deny')
      // 且组档命令本身（不带任何前缀）也必须命中该档（证明组档判据本身在工作）
      && groupCmds.every(([g, c]) => tiersOf(c, 'bash', 'win32').indexOf(g) !== -1),
      JSON.stringify({ badTier, badAllow,
        suKill: tiersOf('su root kill 1234', 'bash', 'win32'),
        sudoKill: tiersOf('sudo kill 1234', 'bash', 'win32'),
        suKillAction: assessCommand('su root kill 1234', 'bash', h54h).action,
        suRegDelete: tiersOf('su root reg delete HKLM\\X /f', 'bash', 'win32'),
        runasShutdown: tiersOf('runas /user:admin shutdown /s', 'bash', 'win32') }))
  }
  // ── 54h2：同一根因的**用户例外**方向 —— deny 例外不得被 `su` / `runas` 绕过 ──────────
  // 例外匹配消费的正是同一份 `segmentLabels`（见 54c 的说明）。操作数之后的真命令名
  // 不可见时，用户显式写下的 `kill *`=deny 拦不住 `su root kill 1234` —— 与 54c 的
  // `sudo` 形态**同源**，只是前缀不同。实测（修复前）：`kill 1234` 与 `sudo kill 1234`
  // 都是 deny，而 `su root kill 1234` 是 **allow**（`shutdown *` / `reg *` / `rm *` /
  // `pkill *` 同样）。
  {
    // destructive 与 category 都设 allow：例外是**唯一**可能给出 deny 的来源，
    // 故一旦例外被绕过，动作就会由 deny 变 allow（差异可观察）。
    const excHooks = (pat) => {
      const h = tierOpts('win32')
      h.destructive = () => ({ action: 'allow' })
      h.category = () => ({ action: 'allow' })
      h.matchException = (segText, label) => (matchCommand(pat, segText) || (label && matchCommand(pat, label)))
        ? { action: 'deny', ruleId: 'e1' } : null
      return h
    }
    const excCases = [['kill *', 'kill 1234'], ['pkill *', 'pkill x'], ['shutdown *', 'shutdown /s'],
      ['reg *', 'reg delete HKLM\\X /f'], ['rm *', 'rm -rf /data']]
    const bypassed = []
    for (const [pat, c] of excCases) {
      for (const p of ['', 'sudo ', 'su root ', 'runas /user:admin ']) {
        if (assessCommand(p + c, 'bash', excHooks(pat)).action !== 'deny') bypassed.push([pat, p + c])
      }
    }
    ok('★★ 54h2 用户 deny 例外不得被 `su` / `runas` 的操作数绕过（destructive/category 全 allow，例外是唯一 deny 来源）',
      bypassed.length === 0
      // 对照（防空转）：不带前缀的形态确实被该例外拦住（否则本组测不到例外本身），
      // 且 `sudo` 对照同样被拦住（证明「带操作数」才是分叉点，不是例外语法写错）。
      && excCases.every(([pat, c]) => assessCommand(c, 'bash', excHooks(pat)).action === 'deny')
      && excCases.every(([pat, c]) => assessCommand('sudo ' + c, 'bash', excHooks(pat)).action === 'deny'),
      JSON.stringify({ bypassed,
        suKill: assessCommand('su root kill 1234', 'bash', excHooks('kill *')).action,
        kill: assessCommand('kill 1234', 'bash', excHooks('kill *')).action }))
  }
  // ── 54h3：**不得过度扩展** —— 操作数本身、`-c` 的值、纯路径目标都不得变成 label ──────
  // 54h 的推进步只在「操作数之后确实是命令头元素」时才跨（`privOperandSkip` 的判据），
  // 故下面这些形态必须与修复前逐字一致。它们是 54b / 54d / 54d2 的**交叉守卫**：
  // 若有人把修法写成「无条件跨过操作数」，`su root` 的 label 会多出 `root`、
  // `su -c C:/Windows` 的 system 警告会消失 —— 两者都是放宽方向。
  //
  // 同时钉住**两词 label** 的口径：`su root reg delete HKLM\X /f` 的 label 必须是
  // `reg delete`（不是 `reg`），否则 reg 组档漏判、`reg *`=deny 例外同样被绕过。
  // 这是同一根因的另一半：`isPrivOperandWord` 的贪婪扫描若把 `reg` / `find` 当成操作数
  // **吃掉**，推进步就根本停不到它们上面，跨越理由再对也无效 —— 实测只改跨越理由时
  // `su root reg delete …` 仍是 allow、`su root find /data -delete` 的 `find` 仍不可见。
  {
    const labelsOf54h3 = (c) => segmentLabels(decomposeCommand(c, 'bash').segments[0].words)
    const overWidened = []
    // 操作数本身 / 非命令目标不得进 label（`su root x` 的 `x` 是最容易漏的一个：
    // 它既不是关键字也不是前缀，若「跨过操作数后无条件取下一个词元」就会变成 label）
    for (const c of ['su root', 'su root ls', 'su root x', 'runas /user:admin cmd', 'su -c "rm -rf /"']) {
      const lb = labelsOf54h3(c)
      if (lb.indexOf('root') !== -1 || lb.indexOf('user:admin') !== -1
        || lb.indexOf('rm') !== -1 || lb.indexOf('cmd') !== -1 || lb.indexOf('x') !== -1) {
        overWidened.push([c, lb])
      }
    }
    ok('★★ 54h3 防过度扩展：操作数 / `-c` 的值 / 非命令词元不得变成 label，且两词 label 与载荷族必须完整',
      overWidened.length === 0
      // 两词 label 口径（与 segmentLabel 的 router 分支同源）
      && labelsOf54h3('su root reg delete HKLM\\X /f').indexOf('reg delete') !== -1
      && labelsOf54h3('runas /user:admin reg delete HKLM\\X /f').indexOf('reg delete') !== -1
      // 载荷族（`find`）同样必须可见 —— 它的破坏性来自后续 `-delete` / `-exec`，
      // 名字本身不在 `DESTRUCTIVE_LABELS` 里
      && labelsOf54h3('su root find /data -delete').indexOf('find') !== -1
      // 对照（防空转）：不带前缀时这些 label 本就取得到（证明上面测的是「前缀后的可见性」）
      && labelsOf54h3('reg delete HKLM\\X /f').indexOf('reg delete') !== -1
      && labelsOf54h3('find /data -delete').indexOf('find') !== -1
      // 端到端：`-c` 的值是**目标**，system 警告不得消失（见 PRIV_VALUE_IS_COMMAND）
      && blastOf('su -c C:/Windows', 'bash', 'win32') === 'system'
      // 操作数之后没有命令时不得凭空判出半径（`su root` / `su root ls` / `runas … cmd`）
      && blastOf('su root', 'bash', 'win32') === null
      && blastOf('su root ls', 'bash', 'win32') === null
      && blastOf('runas /user:admin cmd', 'bash', 'win32') === null
      // 纯路径目标仍参与判档（54d2 的收益不得被本修法吃掉）
      && blastOf('su root env /etc', 'bash', 'win32') === blastOf('su root /etc', 'bash', 'win32')
      && blastOf('su root sudo C:/Windows', 'bash', 'win32') === blastOf('su root C:/Windows', 'bash', 'win32'),
      JSON.stringify({ overWidened,
        suRegDelete: labelsOf54h3('su root reg delete HKLM\\X /f'),
        suFind: labelsOf54h3('su root find /data -delete'),
        suRoot: labelsOf54h3('su root'),
        suCWin: blastOf('su -c C:/Windows', 'bash', 'win32') }))
  }
  // ── 54i：带值选项的**值恰是路由器名**时不得拼出假两词 label（发现 2）──────────────
  // `su` 的贪婪扫描一度**无上界**，于是 `kubectl` 与 `--namespace` 都被当成「操作数」
  // 跨了过去，扫描停在 `--namespace` 的**值** `reg` 上 —— 而 `reg` 恰好是路由器名，
  // `isTargetEatingNameIn(w, idx_of_reg)` 随即用 `routerSubLabelOf` 拼出 **`reg delete`**：
  // 一个**该命令里根本不存在**的 label（真路由器是 `kubectl`，真子命令是 `delete`）。
  //   su root kubectl --namespace reg delete pod x → labels ["su","reg delete"]（假）
  //   sudo kubectl --namespace reg delete pod x   → labels ["sudo","kubectl delete"]（真）
  //   裸 kubectl --namespace reg delete pod x     → labels ["kubectl delete"]（真）
  // 同一段命令只因多一个 `su` 操作数就分叉，且假 label 让「`reg *`=deny 例外」与 reg 组档
  // 在一条**根本没碰注册表**的命令上命中（方向 fail-closed，但仍是缺陷）。
  //
  // 判据分三条，缺一不可：
  //   ① **任何形态都不得出现 `reg delete`**（假 label）；
  //   ② `sudo` / 裸跑对照必须取到**真子命令** `kubectl delete`（`--namespace` 的值被正确
  //      跳过）—— 这是「值不是子命令」的正向证据；
  //   ③ 端到端：`reg=deny` 时 `su` 形态的动作必须与 `sudo` 对照**同值**（分叉才是缺陷）。
  // 反面守卫：真子命令 `delete`（值换成非路由器名 `prod`）时 `sudo`/裸跑仍须取到
  // `kubectl delete` —— 若有人把修法写成「跳过带值选项后一律不取子命令」，这条会红。
  {
    const labelsOf54i = (c) => segmentLabels(decomposeCommand(c, 'bash').segments[0].words)
    // [带 `su` 操作数的形态, 同命令的 `sudo` 对照, 同命令的裸跑对照, 期望真子命令]
    const pairs = [
      ['su root kubectl --namespace reg delete pod x', 'sudo kubectl --namespace reg delete pod x', 'kubectl --namespace reg delete pod x', 'kubectl delete'],
      ['su root git --config reg delete x', 'sudo git --config reg delete x', 'git --config reg delete x', 'git delete'],
      ['su root npm --prefix reg delete x', 'sudo npm --prefix reg delete x', 'npm --prefix reg delete x', 'npm delete'],
      ['su root docker --namespace reg delete x', 'sudo docker --namespace reg delete x', 'docker --namespace reg delete x', 'docker delete'],
      // 值**不是**路由器名（`prod`）—— 真子命令 `delete` 必须取到（反面守卫）
      ['su root kubectl --namespace prod delete pod x', 'sudo kubectl --namespace prod delete pod x', 'kubectl --namespace prod delete pod x', 'kubectl delete'],
    ]
    const bad = []
    for (const [a, b, c, want] of pairs) {
      const la = labelsOf54i(a), lb = labelsOf54i(b), lc = labelsOf54i(c)
      // ① 假 label 一个都不许有
      for (const [cmd, lb2] of [[a, la], [b, lb], [c, lc]]) {
        if (lb2.indexOf('reg delete') !== -1) bad.push([cmd, lb2, '假 reg delete'])
      }
      // ② `sudo` / 裸跑必须取到真子命令（`--namespace` 的值被跳过）
      if (lb.indexOf(want) === -1) bad.push([b, lb, '缺 ' + want])
      if (lc.indexOf(want) === -1) bad.push([c, lc, '缺 ' + want])
      // ③ `su` 形态不得把那个值当成路由器（即不得含 `reg delete`）—— 已在 ① 覆盖；
      //    这里额外钉住「`su` 的 labels 是 `sudo` 对照的子集去掉前缀名」
      const laRest = la.slice(1), lbRest = lb.slice(1)
      for (const x of laRest) if (lbRest.indexOf(x) === -1) bad.push([a, la, '多出 sudo 对照没有的 ' + x])
    }
    // ③ 端到端：reg=deny 下 `su` 形态不得被假 label 判成 deny（与 `sudo` 对照同值）
    const dsRegDeny54i = { inside: 'allow', outside: 'ask', wide: 'ask', unknown: 'ask', proc: 'ask', power: 'ask', priv: 'allow', reg: 'deny' }
    const h54i = tierOpts('win32')
    h54i.destructive = () => dsRegDeny54i
    const actDiverged = []
    for (const [a, b] of pairs) {
      const aa = assessCommand(a, 'bash', h54i).action
      const ab = assessCommand(b, 'bash', h54i).action
      if (aa !== ab) actDiverged.push([a, aa, b, ab])
    }
    ok('★★ 54i 带值选项的值恰是路由器名时不得拼出假两词 label（与 sudo/裸跑对照同值）',
      bad.length === 0 && actDiverged.length === 0
      // 对照（防空转）：**真**两词 label 本身仍必须工作（54a/54h3 的收益不得被本条吃掉）
      && labelsOf54i('su root reg delete HKLM\\X /f').indexOf('reg delete') !== -1
      && labelsOf54i('sudo reg delete HKLM\\X /f').indexOf('reg delete') !== -1
      && labelsOf54i('reg delete HKLM\\X /f').indexOf('reg delete') !== -1
      // 对照（防空转）：reg=deny 配置确实生效（否则「同值」可能两边都 allow 而恒真）
      && assessCommand('reg delete HKLM\\X /f', 'bash', h54i).action === 'deny'
      && assessCommand('sudo reg delete HKLM\\X /f', 'bash', h54i).action === 'deny',
      JSON.stringify({ bad, actDiverged,
        suKubectlNs: labelsOf54i('su root kubectl --namespace reg delete pod x'),
        sudoKubectlNs: labelsOf54i('sudo kubectl --namespace reg delete pod x'),
        bareKubectlNs: labelsOf54i('kubectl --namespace reg delete pod x'),
        suKubectlProd: labelsOf54i('su root kubectl --namespace prod delete pod x'),
        sudoKubectlProd: labelsOf54i('sudo kubectl --namespace prod delete pod x'),
        suRegDelete: labelsOf54i('su root reg delete HKLM\\X /f') }))
  }
  // ── 54j：`su` / `runas` 操作数之后的**路径目标**不得被当命令名吃掉（发现 1 的回归）────
  // `privOperandSkip` 的扫描与跨越判据一度**只看 `commandNameOf` 的结果**，而它按 basename
  // 取尾段 —— 于是 `/usr/bin/rm`、`C:/Windows/System32/taskkill.exe` 这类**路径目标**
  // 解出 `rm` / `taskkill`（都在破坏性名单里）而被当成「操作数之后的命令名」：
  // 扫描跨过去、命令头把整段跳空 → 段级 blast 归 **null** → 半径档 `inside` → 静默放行。
  //
  // 与 `git show HEAD:shell-parse.js` 三方差分（136412 条叉乘、逐条比段级 blast）：
  // 这类形态 **1080 条**由 HEAD 的 system/outside 变 null，方向是 **fail-open**
  // （`runas /user:a /usr/bin/rm`、`su root /usr/bin/find`、`su -c /usr/bin/find`…）。
  //
  // ⚠️ **归因更正（本节一度把上面那 1080 条整体归因为 `runas` 的操作数）** ────────────────
  // 逐条打印 `blast.path` 复核后，那 1080 条（以及本轮复核语料的残余）必须按
  // `HEAD blast.path` 一分为二，**不能只看计数**：
  //   · `head.path` 是 **操作数自身**（`/user:a`、`/noprofile`）—— HEAD 的**假警告**：
  //     HEAD 把 `runas` 的操作数当成了目标路径，警告指错对象。修复后仍有 18 条此类。
  //   · `head.path` 是 **真实路径目标**（`/etc` `/tmp` `/root` `/opt` `/home` `/usr` `/var`
  //     `/etc/hosts` `/data` `C:/data` `D:/data` `C:/Windows` `C:/Users/me`）—— **真漏报**，
  //     方向 fail-open。修复后仍有 88 条此类。
  // 上一轮修复者自述「残余 LOST 全部是 HEAD 的假警告」即由此误归因而来 —— 真实目标那一半
  // 被计数掩盖。单段 POSIX 路径形态（`/etc`、`/tmp`）恰是其中一类，故由 54n 单独钉住
  // （它们落在 54j/54k/54l 的用例之外：那三组的路径都含**第二个 `/`** 或 `:`）。
  //
  // 判据取「**与 HEAD 同值**」（HEAD 侧本就是 system/outside），而不只是「非 null」——
  // 后者会漏掉「判成了更轻的档」。故这里逐条钉住具体的 level。
  //
  // ⚠️ **`want` 列此前从不被读取**（循环只解构 `c`，只判「非 null」）：上面那句「逐条钉住
  // 具体的 level」与**实际覆盖不符** —— 13 条里只有下面手写的 5 条钉了 level，另 8 条只判
  // 「非 null」，于是某条从 `system` 降为 `outside`（**更轻档**）时测试**不红**，而注释让人
  // 相信有覆盖。
  //
  // ⚠️⚠️ **中途那一版 `got !== want && gotW !== want` 只补了一半，循环仍是空转**（本轮实测
  // 复核）：`want` 列 13 条**恒为 `system`**，而每条**至少有一侧实测等于 `system`**
  // （posix 10/13、win32 3/13，两侧都不等于的实测 **0/13**）。于是 `got !== want &&
  // gotW !== want` **恒为 false** —— 13/13 条的**第二支 `push` 是结构性死分支**；第一支
  // （`got === null || gotW === null`）实测同样从不触发（双侧 null 数 0/13）。**整个循环体
  // 从不 push、`badPath` 恒空**，断言实际只由后面手写的对照撑着。
  // 结论：**「未匹配的那一侧」完全未被钉住** —— 前 10 条的 win32 侧、后 3 条的 posix 侧从
  // `outside` 降到 `inside`（`BLAST_ORDER` 6 → 7，**真实放宽**：工作区外 → 工作区内不警告）
  // 时，测试**仍然全绿**。上一轮「把某条 `want` 改成 `'wide'` → FAIL(1)」只证明「`want` 被
  // 读到」，**不证明「两侧都被钉住」**：那是「至少一侧相等」的语义。
  //
  // 判据形态：**两侧各自带自己的期望值**（`wantP` / `wantW`），逐侧独立严格相等。
  // 为什么不能写单值 `want`：**单值无法同时表达两侧** —— 实测 posix 侧 `system` 10/13、
  // win32 侧 `system` 3/13（`win32EqWant` 只有 3），写 `gotW === want` 会立刻假红 10 条
  // （上一轮那条建议即因此被实测否决）；而 `&&` / `||` 任一形态都必然放掉一侧。
  //
  // 期望值**逐条实测**得到（不照抄旧的 `want` 列，也不凭猜测）：
  //   · 前 10 条，目标 `/usr/bin/*`：posix 判 `system`（`/usr` 在系统目录名单内），
  //     win32 判 `outside`（`/usr/bin/rm` 只是普通相对路径，落在工作区外）
  //   · 后 3 条，目标 `C:/Windows/System32/*`：posix 判 `outside`（`C:/…` 在 posix 下是普通
  //     相对路径），win32 判 `system`（`C:/Windows` 在系统目录名单内）
  //   即 `[posix 期望, win32 期望]` 恰好**互为镜像**；双侧均非 null（实测 0/13 为 null），
  //   故「不得归 null」由逐侧相等一并覆盖。双侧实测值见下面 `wantChecks`，
  //   `posixEqWant` / `win32EqWant` 均应等于 13。
  {
    const badPath = []
    // [命令, posix 侧期望 blast level, win32 侧期望 blast level] —— 期望值逐条实测（见上）
    const cases54j = [
      ['su root /usr/bin/rm', 'system', 'outside'],
      ['su root /usr/bin/find', 'system', 'outside'],
      ['su - root /usr/bin/find', 'system', 'outside'],
      ['su -c /usr/bin/find', 'system', 'outside'],
      ['runas /user:a /usr/bin/rm', 'system', 'outside'],
      ['runas /user:a /usr/bin/find', 'system', 'outside'],
      ['runas /noprofile /user:a /usr/bin/find', 'system', 'outside'],
      ['su root sudo /usr/bin/find', 'system', 'outside'],
      ['su root env /usr/bin/find', 'system', 'outside'],
      ['su root time /usr/bin/find', 'system', 'outside'],
      ['su root C:/Windows/System32/taskkill.exe', 'outside', 'system'],
      ['runas /user:a C:/Windows/System32/taskkill.exe', 'outside', 'system'],
      ['su root env C:/Windows/System32/taskkill.exe', 'outside', 'system'],
    ]
    // 两侧**各自独立**严格相等（不是 `&&`/`||` 的合并判据）：任一侧降档到别的 level 都会红。
    // `wantP`/`wantW` 均非 null，故「不得归 null」由逐侧相等一并覆盖（null 必然不等）。
    for (const [c, wantP, wantW] of cases54j) {
      const gotP = blastOf(c, 'bash', 'posix')
      const gotW = blastOf(c, 'bash', 'win32')
      if (gotP !== wantP) badPath.push([c, 'posix', 'want=' + wantP, 'got=' + gotP])
      if (gotW !== wantW) badPath.push([c, 'win32', 'want=' + wantW, 'got=' + gotW])
    }
    ok('★★ 54j `su`/`runas` 操作数之后的路径目标不得被当命令名吃掉（段级 blast 不得归 null，且**两侧各自**钉住 level）',
      badPath.length === 0
      // 对照（防空转）：上面每条在 HEAD 下都判得出来，故这里逐条钉住**具体 level**（不是
      // 「非 null」）—— `/usr/bin/*` 在 posix 下判 system、`C:/Windows/System32/*` 在 win32
      // 下判 system；与表里的期望值同源，任一侧降档都会与表里那一行一起红。
      && blastOf('su root /usr/bin/rm', 'bash', 'posix') === 'system'
      && blastOf('su root /usr/bin/find', 'bash', 'posix') === 'system'
      && blastOf('runas /user:a /usr/bin/rm', 'bash', 'posix') === 'system'
      && blastOf('su root C:/Windows/System32/taskkill.exe', 'bash', 'win32') === 'system'
      && blastOf('runas /user:a C:/Windows/System32/taskkill.exe', 'bash', 'win32') === 'system'
      // 对照（防空转）：**裸命令名**仍必须被当命令名吃掉（54d/54e 的收益不得被本条吃掉）——
      // 若有人把修法写成「`su`/`runas` 之后一律不吃下一个词元」，这两条会红
      && blastOf('su root rm -rf /data', 'bash', 'win32') === blastOf('rm -rf /data', 'bash', 'win32')
      && blastOf('su root find /data -delete', 'bash', 'win32') !== null
      && blastOf('su root reg delete HKLM\\X /f', 'bash', 'win32') === null,
      JSON.stringify({ badPath,
        // 防空转：**逐侧**实测值与期望的比对（两条计数都必须等于 13 —— 只要有一侧降档，
        // 对应的计数立刻小于 13，且 `badPath` 非空；不再有「任一侧相等即通过」的死分支）
        wantChecks: cases54j.map(([c, wp, ww]) => [c, 'posix:' + wp, blastOf(c, 'bash', 'posix'), 'win32:' + ww, blastOf(c, 'bash', 'win32')]),
        posixEqWant: cases54j.filter(([c, wp]) => blastOf(c, 'bash', 'posix') === wp).length,
        win32EqWant: cases54j.filter(([c, , ww]) => blastOf(c, 'bash', 'win32') === ww).length,
        suUsrBinRm: blastOf('su root /usr/bin/rm', 'bash', 'posix'),
        runasUsrBinRm: blastOf('runas /user:a /usr/bin/rm', 'bash', 'posix'),
        suTaskkill: blastOf('su root C:/Windows/System32/taskkill.exe', 'bash', 'win32'),
        suRmData: blastOf('su root rm -rf /data', 'bash', 'win32'),
        plainRmData: blastOf('rm -rf /data', 'bash', 'win32') }))
  }
  // ── 54n：**单段**路径目标不得被当 Windows 开关跨过（发现 1 的 fail-open 回归）──────────
  // `privOperandSkip` 的扫描上界 `isOperandShapedWord` 曾把 `/x` 一律当「Windows 风格开关」
  // （`/^\/[a-z]/i.test(t) && t.indexOf('/', 1) === -1`），**不看平台也不看 `:`** ——
  // 于是**单段** POSIX 绝对路径 `/etc`、`/tmp`、`/root`、`/opt`、`/home`、`/usr`、`/var`
  // 与盘符路径 `D:/data` 全部被判成开关，扫描跨过它们、命令头越过真命令与真目标
  // → 段级 blast 归 **null** → 半径档落 `inside` → `priv=allow` 时**静默放行**。
  //
  // 实测（对拍语料 3648 条叉乘、逐条比段级 blast）：该分支的 LOST 里
  // **真实路径目标占绝大多数**（见 54j 的归因更正：修复前 177 条真实目标 / 30 条操作数
  // 自身；修复后残余 88 条真实目标 / 18 条操作数自身），形态是
  // `su [- [root]] <单段路径> <破坏性名>` 与 `runas <开关> <单段路径> <破坏性名>`。
  //
  // ⚠️ 这一族**恰好在 54j/54k/54l 的用例之外**：那三组的路径都含**第二个 `/`**
  // （`/usr/bin/rm`、`C:/Windows/System32/taskkill.exe`）或 `:`（`C:/Windows`），
  // 二次分隔符与冒号使它们不被误判 —— 故三套件全绿也照不出本形态，必须在此单列。
  //
  // ⚠️ **平台取 `posix`**：`/tmp`、`/home`、`/data` 在 win32 下**本就被 `isCmdStyleSwitch`
  // 当 cmd 开关跳过**（那是平台感知的既有行为，HEAD 同样是 null），故 win32 侧测不出本回归。
  // 回归发生在 posix —— 那里 HEAD 侧本就是 system/outside，判据必须是「与 HEAD 同值」。
  //
  // ⚠️ **本组只钉 `/x` 分支修好的形态**（发现 1 点名的四条端到端复现）。同一函数还有
  // 两处**独立于 `/x` 的残余**（`k === at` 无条件认第一个操作数、关键字链按 basename 认
  // 关键字 `data`），它们让 `su - /etc rm`、`su root /data rm`、`su root D:/data rm` 仍判
  // null/allow —— 见 `shell-parse.js` 里 `privOperandSkip` 的「已知残余」段。那两处不在
  // 本次改动面内（要修会改变更多既有结论），故**不写进本组**，避免把 fail-open 固化成期望。
  {
    const dsPrivAllow54n = { inside: 'allow', outside: 'ask', wide: 'ask', unknown: 'ask', proc: 'ask', power: 'ask', priv: 'allow', reg: 'ask' }
    const h54n = tierOpts('posix')
    h54n.destructive = () => dsPrivAllow54n
    // inside=allow + priv=allow：修复前这些形态全部 allow（HEAD 判 ask —— blast 有值）
    const bad54n = [
      'su root /etc rm', 'su - cat /etc rm', 'su - ls /tmp rm',
      'su root /tmp rm', 'su root /root rm', 'su root /opt rm', 'su root /home rm',
      'su root /usr rm', 'su root /var rm',
      // `find` 载荷族同样落在这一族里（`-exec rm` 的目标是单段路径）
      'su - ls /etc -exec rm -rf {} +',
    ].filter((c) => assessCommand(c, 'bash', h54n).action === 'allow')
    ok('★★ 54n 单段路径目标不得被当 Windows 开关跨过（`su root /etc rm` / `su - cat /etc rm` 不得 allow）',
      bad54n.length === 0
      // 根因判据：与 HEAD 同值（分叉才是缺陷）。HEAD 侧这几条分别是 system/outside/home。
      && blastOf('su root /etc rm', 'bash', 'posix') === 'system'
      && blastOf('su - cat /etc rm', 'bash', 'posix') === 'system'
      && blastOf('su - ls /tmp rm', 'bash', 'posix') === 'outside'
      && blastOf('su root /home rm', 'bash', 'posix') === 'outside'
      && blastOf('su root /root rm', 'bash', 'posix') === 'system'
      && blastOf('su - ls /etc -exec rm -rf {} +', 'bash', 'posix') === 'system'
      // 对照（防空转）：`/x` 判据**不得收得过紧** —— 真 Windows 开关仍必须被跨过，
      // 否则 54d 修好的那一族会退回（`runas /noprofile /user:admin rm -rf /data`）。
      // 两个开关都含 `:`：`/user:admin` 靠含 `:` 认，`/noprofile` 靠 `k === at` 那一支认。
      && blastOf('runas /noprofile /user:admin rm -rf /data', 'bash', 'win32') === blastOf('rm -rf /data', 'bash', 'win32')
      && assessCommand('runas /noprofile /user:admin rm -rf /data', 'bash', h54n).action !== 'allow'
      // 对照（防空转）：裸命令名仍必须被吃掉（54d/54e/54h 的收益不得被本条吃掉）
      && blastOf('su root rm -rf /data', 'bash', 'win32') === blastOf('rm -rf /data', 'bash', 'win32')
      && blastOf('su root find /data -delete', 'bash', 'win32') !== null
      && segmentLabels(decomposeCommand('su root reg delete HKLM\\X /f', 'bash').segments[0].words).indexOf('reg delete') !== -1,
      JSON.stringify({ bad54n,
        suRootEtc: blastOf('su root /etc rm', 'bash', 'posix'),
        suCatEtc: blastOf('su - cat /etc rm', 'bash', 'posix'),
        suLsTmp: blastOf('su - ls /tmp rm', 'bash', 'posix'),
        suHome: blastOf('su root /home rm', 'bash', 'posix'),
        suRoot: blastOf('su root /root rm', 'bash', 'posix'),
        suFindExec: blastOf('su - ls /etc -exec rm -rf {} +', 'bash', 'posix'),
        runasNoprofile: blastOf('runas /noprofile /user:admin rm -rf /data', 'bash', 'win32'),
        plainRmData: blastOf('rm -rf /data', 'bash', 'win32') }))
  }
  // ── 54o：`runas` **非首位**的不含 `:` 开关不得被当扫描终点（本轮修复的收窄倒退）──────────
  // 54n 给 `isOperandShapedWord` 加的「含 `:`」守卫是**为 `su` 立的**：`su` 是 POSIX 命令，
  // 其后的单段路径（`/etc`、`/tmp`）必须留在命令头之外。而该判据被**全局**套到了 `runas` 上，
  // 于是 `runas` 的开关里**除 `/user:` 之外全部不含 `:`**（`/noprofile` `/savecred` `/netonly`
  // `/profile` `/env` `/smartcard` `/showtrustlevels`）→ 扫描停在**第二个**开关上
  // → 命令头停在下标 1 → 真命令与真目标都留在命令头之外 → 段级 blast 归 null
  // → 半径档落 `inside`。方向是 **fail-open**，且触发形态**符合 `runas` 官方语法顺序**
  // （`/user:` 写在最后）。
  //
  // ⚠️ **54n 照不出它**：54n 钉的 `runas /noprofile /user:admin …` 是**首位**不含 `:` 开关，
  // 那一支靠 `privOperandSkip` 的 `k === at`（无条件认第一个操作数）通过 —— 只有**第二个及
  // 以后**的不含 `:` 开关才落在 `isOperandShapedWord` 上。这正是本组必须单列的理由。
  //
  // 实测（win32，A = 去掉该守卫、B = 有该守卫，`blast.level|blast.path`）：
  //     `runas /noprofile /user:admin rm -rf /tmp`          A=`outside|/tmp` B=`outside|/tmp`
  //     `runas /profile /savecred /user:admin rm -rf /tmp`  A=`outside|/tmp` B=**`null`**
  //     `runas /profile /netonly /user:admin rm -rf /tmp`   A=`outside|/tmp` B=**`null`**
  //     `runas /netonly /savecred /user:admin rm -rf /tmp`  A=`outside|/tmp` B=**`null`**
  // 因果钉死：把 `/savecred` 改成 `/savecred:x`（**只加一个冒号**）即恢复 `outside|/tmp` ——
  // 故下面同时钉住「含 `:` 的对照形态」，用来证明本组测的确实是那条 `:` 判据。
  //
  // 端到端（用户可见后果，B 相对 A）：显式 deny 例外 `rm *` 由 **deny 变 ask**（用户写的
  // 拒绝失效）、组档 `reg=deny` 由 deny 变 **inherit**、`proc=deny` 由 deny 变 **inherit**、
  // `outside=deny` 由 deny 变 **inherit**、`outside=ask + priv=allow` 由 ask 变 **allow**。
  {
    const runasMulti = [
      // 非首位不含 `:` 开关（≥2 个开关，第二个不在首位）—— 本组的主角
      'runas /profile /savecred /user:admin rm -rf /tmp',
      'runas /profile /netonly /user:admin rm -rf /tmp',
      'runas /netonly /savecred /user:admin rm -rf /tmp',
      'runas /profile /savecred /netonly /user:admin rm -rf /tmp',
      'runas /user:admin /profile /savecred rm -rf /tmp',
      // 同一形态的其他破坏性命令（组档方向）
      'runas /profile /savecred /user:admin kill 1234',
      'runas /profile /savecred /user:admin reg delete HKLM\\X /f',
      'runas /profile /savecred /user:admin taskkill /im x.exe',
    ]
    // 判据 = **与不带前缀的同目标形态等价**：真命令与真目标必须重新进入命令头，
    // 故「前缀侧的 tiers / labels 必须是纯形态的超集」+「blast.level 必须与纯形态同值」。
    //
    // ⚠️ 为什么不能只判 `blastOf(prefixed) !== null`：`kill` / `reg delete` / `taskkill`
    // 的 blast **恒为 null**（§2.2：proc/power/reg 三组结构性判不出半径）—— 只判非 null
    // 会让这三条**恒假**，是本组最容易踩的空转（实测：只判非 null 时 mut-m1 只报 5 条，
    // 换成 tiers/labels 判据后报 16 条，三条组档形态才真正被钉住）。
    // 组档形态的正确判据是 **tiers 超集**（`kill` 必须让 `proc` 出现在前缀侧的 tiers 里）。
    const badTier = []
    const badBlast = []
    // **实际比较条数**（防空转的计数断言，见下面 ok() 里的 `n54o`）：
    // badTier / badBlast 都由 `runasMulti` 驱动，语料为空时两者**恒空**、本组恒过。
    // 实测（变异）：把 `runasMulti` 置空后 `node test/shell-parse.mjs` 仍 exit=0 全绿
    // —— `badTier/badBlast/e2e54o` 全空即全过，本组此前**没有任何东西**要求语料非空。
    // 对照 54p 的 `posixOk + posixBad.length + … === kwNames.length` 是有效计数断言
    // （把 `data` 关键字 `continue` 掉不记录时 54p 立刻报红），本组缺的正是它。
    let n54o = 0
    // 与**不带前缀**的同目标形态同值（分叉才是缺陷）
    const sameAsPlain = (c, plain) => blastOf(c, 'bash', 'win32') === blastOf(plain, 'bash', 'win32')
    for (const c of runasMulti) {
      const plain = c.replace(/^runas(?:\s+\/[A-Za-z][^\s]*)*\s+/, '')
      const sc = segOf(c, 'bash', 'win32'), sp = segOf(plain, 'bash', 'win32')
      if (!sc || !sp) { badTier.push([c, 'NO-SEG']); continue }
      n54o += 1
      // 组档 / 半径档：纯形态命中的档必须都在前缀侧命中
      if (!sp.t.every((t) => sc.t.indexOf(t) !== -1)) badTier.push([c, sc.t, sp.t])
      // label：真命令名必须重新可见（`kill` / `reg delete` / `rm` / `taskkill`）
      if (!sp.lb.every((l) => sc.lb.indexOf(l) !== -1)) badTier.push([c, 'labels', sc.lb, sp.lb])
      // 半径档：纯形态判得出 blast 时，前缀侧必须同值（不得归 null、不得判轻档）
      const vc = sc.b ? sc.b.level : null, vp = sp.b ? sp.b.level : null
      if (vp !== null && vc !== vp) badBlast.push([c, vc, vp])
    }
    // 端到端：五档配置下逐条不得比不带前缀时更松
    const e2e54o = []
    const mkH = (ds, exc) => {
      const h = tierOpts('win32')
      h.destructive = () => ds
      h.category = () => ({ action: 'allow' })
      h.matchException = (segText, label) => {
        for (const pat of exc || []) {
          const m = (hay) => matchCommand(pat, hay)
          if (m(segText) || (label && m(label))) return { action: 'deny', ruleId: 'e1', reason: null }
        }
        return null
      }
      return h
    }
    const allAsk = { inside: 'ask', outside: 'ask', wide: 'ask', unknown: 'ask', proc: 'ask', power: 'ask', priv: 'ask', reg: 'ask' }
    const combos = [
      // [档位表, 例外, 命令, 不带前缀的对照]
      [allAsk, ['rm *'], 'runas /profile /savecred /user:admin rm -rf /tmp', 'rm -rf /tmp'],
      [Object.assign({}, allAsk, { reg: 'deny' }), [], 'runas /profile /savecred /user:admin reg delete HKLM\\X /f', 'reg delete HKLM\\X /f'],
      [Object.assign({}, allAsk, { proc: 'deny' }), [], 'runas /profile /savecred /user:admin kill 1234', 'kill 1234'],
      [Object.assign({}, allAsk, { outside: 'deny' }), [], 'runas /profile /savecred /user:admin rm -rf /tmp', 'rm -rf /tmp'],
      [Object.assign({}, allAsk, { outside: 'ask', priv: 'allow' }), [], 'runas /profile /savecred /user:admin rm -rf /tmp', 'rm -rf /tmp'],
    ]
    const RANK = { allow: 0, ask: 1, deny: 2, inherit: 0 }
    for (const [ds, exc, c, plain] of combos) {
      const a = assessCommand(c, 'bash', mkH(ds, exc)).action
      const b = assessCommand(plain, 'bash', mkH(ds, exc)).action
      // 带前缀**不得比不带前缀更松**（提权只会更严，绝不会更宽）
      if (RANK[a] < RANK[b]) e2e54o.push([c, plain, a, b])
    }
    ok('★★ 54o `runas` 非首位的不含 `:` 开关不得被当扫描终点（`runas /profile /savecred /user:admin …` 的 tiers/labels/blast 必须与不带前缀时等价）',
      badTier.length === 0 && badBlast.length === 0 && e2e54o.length === 0
      // 对照（防空转）：**实际比较条数**必须等于语料条数 —— 少了它，语料被置空（或
      // `for` 循环被整段 `continue` 掉）时 badTier/badBlast 恒空、本组**恒过**。
      // 实测：语料置空后（`[].slice(0,0) || [...]`）本组旧判据下 exit=0 全绿。
      && n54o === runasMulti.length && n54o >= 8
      // 对照（防空转）：**不带前缀**的同目标形态本身必须判得出来（否则「同值」恒真）。
      // 组档三条的判据是 tiers（它们的 blast 恒 null），半径那条的判据是 blast —— 两者都要。
      && blastOf('rm -rf /tmp', 'bash', 'win32') === 'outside'
      && ['kill 1234', 'reg delete HKLM\\X /f', 'taskkill /im x.exe']
        .every((c) => (tiersOf(c, 'bash', 'win32') || []).length > 0)
      // 对照（防空转）：三条组档形态在前缀侧的 tiers 必须真的含组档 —— 否则 badTier 恒空
      && ['proc', 'reg', 'proc'].every((t, i) => {
        const c = ['runas /profile /savecred /user:admin kill 1234',
          'runas /profile /savecred /user:admin reg delete HKLM\\X /f',
          'runas /profile /savecred /user:admin taskkill /im x.exe'][i]
        return (tiersOf(c, 'bash', 'win32') || []).indexOf(t) !== -1
      })
      // 因果钉死：**只加一个冒号**的对照形态必须与不带前缀时同值（证明本组测的就是 `:` 判据）
      && sameAsPlain('runas /profile /savecred:x /user:admin rm -rf /tmp', 'rm -rf /tmp')
      && sameAsPlain('runas /profile /netonly:x /user:admin rm -rf /tmp', 'rm -rf /tmp')
      // 首位形态（54n 钉的那一支）必须同值 —— 本组不得把它改坏
      && sameAsPlain('runas /noprofile /user:admin rm -rf /tmp', 'rm -rf /tmp')
      && sameAsPlain('runas /user:admin /noprofile rm -rf /tmp', 'rm -rf /tmp')
      // 对照（防过度收紧）：`runas` 的操作数/开关本身**不得**凭空判出半径之外的东西 ——
      // 无真命令可判时仍是 null（若把开关之后的任意词元都当命令名，这里会变非 null 假警告）
      && blastOf('runas /profile /savecred /user:admin cmd', 'bash', 'win32') === null
      && blastOf('runas /profile /savecred', 'bash', 'win32') === null
      && blastOf('runas /user:admin cmd', 'bash', 'win32') === null
      // 对照（防过度收紧）：`su` 支的 `:` 守卫**不得**被本修法削掉（54n 的收益不得被本条吃掉）
      && blastOf('su root /etc rm', 'bash', 'posix') === 'system'
      && blastOf('su - cat /etc rm', 'bash', 'posix') === 'system'
      && blastOf('su - ls /tmp rm', 'bash', 'posix') === 'outside',
      JSON.stringify({ badTier: badTier.slice(0, 6), badBlast, e2e54o,
        savecred: blastOf('runas /profile /savecred /user:admin rm -rf /tmp', 'bash', 'win32'),
        netonly: blastOf('runas /profile /netonly /user:admin rm -rf /tmp', 'bash', 'win32'),
        plain: blastOf('rm -rf /tmp', 'bash', 'win32'),
        colonCtl: blastOf('runas /profile /savecred:x /user:admin rm -rf /tmp', 'bash', 'win32'),
        killTiers: tiersOf('runas /profile /savecred /user:admin kill 1234', 'bash', 'win32'),
        killLabels: (segOf('runas /profile /savecred /user:admin kill 1234', 'bash', 'win32') || {}).lb,
        regTiers: tiersOf('runas /profile /savecred /user:admin reg delete HKLM\\X /f', 'bash', 'win32'),
        n54o, corpus: runasMulti.length,
        suEtc: blastOf('su root /etc rm', 'bash', 'posix') }))
  }
  // ── 54q：`runas` 开关之后的**单段路径目标**不得被当开关跨过（发现 1 的守卫）─────────────
  // `isRunasSwitchShapedWord` 一度**放宽到「单段 `/x` 一律算开关候选」**，理由是「`runas` 的
  // 位置参数就是命令，`runas /profile /etc rm` 本就不是合法调用，且 blast 仍由真命令与真目标
  // 决定」。**实测该理由不成立 —— 真目标恰恰被跨过了**：单段 `/x` 这个形态里同时住着
  // `runas` 的开关（`/noprofile`）与**单段 POSIX 路径目标**（`/etc`），两者词法完全同形。
  //
  // 后果（插桩 `commandHeadEnd`，`runas /noprofile /etc rm`）：HEAD 与修复前 `headEnd=1`
  // （`/etc` 留在命令头外当目标），放宽版 `headEnd=4`（`/etc` 与 `rm` 全被吃进命令头）
  // → 段级 blast 归 `null` → 半径档落 `inside`（方向 fail-open）。逐条比段级 blast：
  //   · **posix 侧相对 HEAD 是硬回归**：`runas /noprofile /etc rm`、`runas /user:a /etc rm`、
  //     `runas /profile /etc rm` 由 HEAD 的 `system|/etc` 变 `null`；触发面覆盖
  //     `/etc` `/tmp` `/usr` `/var` `/opt` `/root` `/srv` `/etc/hosts` 等单段路径。
  //   · win32 侧由修复前的 `outside|/etc` 变 `null`（HEAD 本就是 null）—— 中间态回归。
  //   · 端到端（`category=allow`、`priv=allow`）：`runas /user:a /etc rm`、
  //     `runas /noprofile /etc rm`、`runas /profile /etc rm` 在八档默认下 **ask→allow**、
  //     `outside=deny` 下 **deny→allow**。
  //
  // ⚠️ **54o 照不出它**：54o 的语料只含「开关 + 真命令」形态（`runas /profile /savecred
  // /user:admin rm -rf /tmp`），**不含路径词元** —— 本组补的正是那一族。两个平台都要钉：
  // posix 侧是相对 HEAD 的硬回归，win32 侧是相对修复前的中间态回归。
  //
  // 判据 = **与「不带 `runas` 前缀」的同命令同目标同值**（分叉才是缺陷），且
  // tiers / labels 必须是纯形态的超集 —— 只看 `blast !== null` 会漏掉组档方向。
  //
  // ── ⚠️ `PATHS` 池**必须排除** `RUNAS_SWITCHES` 的成员（曾经以为该补进去，实测是错的）──────
  // 本组形态是 `runas <SW> <P> <CMD>`，`<P>` 位于**命令名之前**。按 `runas` 官方语法
  // （`runas [开关…] /user:<名> <程序>`），命令名之前的位置是**开关位** ——
  //   · `<P>` 是非开关单段路径（`/etc`）→ 它不是 `runas` 开关 → 当目标正确（本组的立意）；
  //   · `<P>` 是白名单开关（`/noprofile`）→ 它**就是** `runas` 开关 → 该跨（54o/54r 的立意）。
  // 两者对同一位置给出**相反**要求，故把开关名塞进本池会让判据自相矛盾：实测池里放 3 个
  // 开关名即产生 **84 条**假红、放全 8 个产生 **224 条**（全部是「要求真开关被当目标」）。
  // 更直接的是与 54o 冲突：`runas /profile /savecred /user:admin rm -rf /tmp` 要判
  // `outside|/tmp`（依赖 `/savecred` **被跨**），而本池若含 `/savecred` 就要求
  // `runas /profile /savecred rm -rf` 判 `outside|/savecred`（依赖它**不被跨**）。
  // **目标位**（命令名之后）那一族由 **54r Pass 3 / ⑤** 钉 —— 那里同一词元必须判出该词元本身，
  // 且与开关位**分叉**。故本池只放「非开关的单段路径」，池子大小由下面的防空转断言钉死。
  {
    const SWITCHES = ['/noprofile', '/profile', '/savecred', '/netonly', '/smartcard', '/showtrustlevels', '/user:a']
    const PATHS = ['/etc', '/usr', '/var', '/opt', '/root', '/srv', '/bin', '/lib', '/boot', '/dev', '/etc/hosts', '/etc/passwd']
    const CMDS = ['rm -rf', 'rmdir']
    const badBlast = []
    const badTier = []
    let compared = 0
    let ctlNonNull = 0
    for (const platform of ['win32', 'posix']) {
      for (const p of PATHS) {
        for (const cmd of CMDS) {
          // 对照 = 同命令同目标、**不带 `runas` 前缀**
          const ctl = cmd + ' ' + p
          const sp = segOf(ctl, 'bash', platform)
          if (!sp) { badBlast.push([platform, ctl, 'NO-SEG']); continue }
          const vp = sp.b ? sp.b.level + '|' + sp.b.path : 'null'
          for (const sw of SWITCHES) {
            const c = 'runas ' + sw + ' ' + p + ' ' + cmd
            const sc = segOf(c, 'bash', platform)
            compared += 1
            if (!sc) { badBlast.push([platform, c, 'NO-SEG']); continue }
            const vc = sc.b ? sc.b.level + '|' + sc.b.path : 'null'
            // 对照本身必须判得出来（否则「同值」恒真、本组空转）
            if (vp !== 'null') ctlNonNull += 1
            if (vp === 'null' || vc !== vp) badBlast.push([platform, c, ctl, vc, vp])
            if (!sp.t.every((t) => sc.t.indexOf(t) !== -1)) badTier.push([platform, c, sc.t, sp.t])
          }
        }
      }
    }
    // 端到端：`priv=allow` / `outside=deny` 下不得比不带前缀的对照更松（提权只会更严）
    const e2e54q = []
    const mkH54q = (platform, ds) => {
      const h = tierOpts(platform)
      h.destructive = () => ds
      h.category = () => ({ action: 'allow' })
      h.matchException = () => null
      return h
    }
    const allAsk54q = { inside: 'ask', outside: 'ask', wide: 'ask', unknown: 'ask', proc: 'ask', power: 'ask', priv: 'ask', reg: 'ask' }
    const RANK54q = { allow: 0, ask: 1, deny: 2, inherit: 0 }
    for (const platform of ['win32', 'posix']) {
      for (const p of PATHS) {
        for (const cmd of CMDS) {
          const ctl = cmd + ' ' + p
          for (const ds of [Object.assign({}, allAsk54q, { priv: 'allow' }), Object.assign({}, allAsk54q, { outside: 'deny' })]) {
            const b = assessCommand(ctl, 'bash', mkH54q(platform, ds)).action
            for (const sw of SWITCHES) {
              const c = 'runas ' + sw + ' ' + p + ' ' + cmd
              const a = assessCommand(c, 'bash', mkH54q(platform, ds)).action
              if (RANK54q[a] < RANK54q[b]) e2e54q.push([platform, c, ctl, a, b])
            }
          }
        }
      }
    }
    // 因果钉死：**只加一个冒号**（把路径变成 cmd 风格开关）时，`/etc:x` 不再是路径 ——
    // 该形态本来就该被当开关跨过。反向对照证明本组钉的确实是「路径 vs 开关」的判据，
    // 而不是「runas 之后一律不跨」（后者会让 54o 的收益整个退回）。
    const keep54o = blastOf('runas /profile /savecred /user:admin rm -rf /tmp', 'bash', 'win32')
    ok('★★ 54q `runas` 开关之后的单段路径目标不得被当开关跨过（`runas /noprofile /etc rm` 一族，两平台 × 全开关穷举）',
      badBlast.length === 0 && badTier.length === 0 && e2e54q.length === 0
      // 对照（防空转）：**实际比较条数**必须等于语料叉乘大小，且对照侧真的判出了值 ——
      // 少了它，循环被 `continue` 掉或语料被置空时上面三个数组恒空、本组恒过（发现 2 同源）。
      && compared === SWITCHES.length * PATHS.length * CMDS.length * 2
      && ctlNonNull === compared
      && SWITCHES.length >= 7 && PATHS.length >= 12 && CMDS.length >= 2
      // 收益不得被本修法吃掉：54o 的主角形态仍须 `outside|/tmp`
      && keep54o === 'outside'
      // 两个平台的代表形态逐条钉死（与 HEAD / 修复前逐条对拍过的值一致）
      && blastOf('runas /noprofile /etc rm', 'bash', 'posix') === 'system'
      && blastOf('runas /user:a /etc rm', 'bash', 'posix') === 'system'
      && blastOf('runas /profile /etc rm', 'bash', 'posix') === 'system'
      && blastOf('runas /noprofile /etc rm', 'bash', 'win32') === 'outside'
      && blastOf('runas /noprofile /etc/hosts rm', 'bash', 'win32') === 'outside'
      // 对照（防过度收紧）：`runas` 的开关本身仍须被跨过（不是「一律不跨」）——
      // 无真命令可判时仍是 null，且 `su` 支的 `:` 守卫不受影响
      && blastOf('runas /profile /savecred /user:admin cmd', 'bash', 'win32') === null
      && blastOf('su root /etc rm', 'bash', 'posix') === 'system',
      JSON.stringify({ badBlast: badBlast.slice(0, 8), badTier: badTier.slice(0, 6),
        e2e54q: e2e54q.slice(0, 6), compared, ctlNonNull, keep54o,
        posixEtc: blastOf('runas /noprofile /etc rm', 'bash', 'posix'),
        win32Etc: blastOf('runas /noprofile /etc rm', 'bash', 'win32'),
        posixEtcCtl: blastOf('rm /etc', 'bash', 'posix') }))
  }
  // ── 54r：`runas` 官方开关全表 × 非首位 —— 漏加一项是 **fail-open**（发现 1 的守护）─────────
  // `RUNAS_SWITCHES` 是**枚举表**，而它漏项的方向此前被注释写反了（写成「漏加 = 该跨没跨 =
  // 偏保守，不会静默放行」）。**实测该归因不成立**：本表成员在命令头推进里是**必跨**项，
  // 漏掉一项**不是**「停在开关上」，而是让 `privOperandSkip` 的扫描在那一项上提前收束、
  // `commandHeadEnd` 停在 **1** —— 真命令与真目标**一起**被排除在命令头之外，段级 blast
  // 归 `null` → 半径档落 `inside`。插桩实测（win32）：
  //     `runas /noprofile /savecred /user:a rm -rf /tmp`
  //       现状 `headEnd=5`、`blast=outside|/tmp`；
  //       删掉 `/savecred` 一项 → `headEnd=1`、`blast=null`。
  // 端到端后果（`priv=allow`）：由 `ask` 变 **allow**；`outside=deny` 下由 `deny` 退成 `ask`。
  //
  // ⚠️ **54o 照不出非首位的漏项**：它只钉「首位开关」形态（`runas /noprofile /user:admin …`），
  // 而首位那一支靠 `privOperandSkip` 的 `k === at` **无条件**通过、**不经本表**。
  // 故 8 项里只有 4 项被旧语料间接覆盖 —— 实测（逐项从表里删掉后跑本文件）：
  //     删 `/env` `/smartcard` `/showtrustlevels` `/trustlevel` → 旧测试 **exit=0 全绿**；
  //     删 `/noprofile` `/profile` `/savecred` `/netonly` → 才变红。
  // 本组按**官方全表 × 非首位**穷举补上这个缺口。
  //
  // ── 两个语法位置必须分开钉（本组与 54q 的分工）──────────────────────────────────
  // `runas` 官方语法：`runas [开关…] /user:<名> <程序> [程序参数…]`
  //     · **开关位**（命令名之前）：`runas /profile /noprofile rm -rf /tmp`
  //       这里 `/noprofile` 是**开关**（该跨），`/tmp` 才是 `rm` 的目标；
  //     · **目标位**（命令名之后）：`runas /profile rm -rf /noprofile`
  //       这里 `/noprofile` 是**真目标**（不该跨）—— 同一个词元、相反结论。
  // 54q 钉的是「命令名之前的**路径**不得被当开关」（`runas /noprofile /etc rm` 的 `/etc`），
  // 其 `PATHS` 池**刻意不含**本表成员：命令名之前的本表词元**是开关**，若把它放进 `PATHS`
  // 池，54q 的「与不带前缀同值」判据会反过来要求「**真开关**被当目标」——与 54o 的收益
  // 直接冲突（实测：池里放 3 个开关名即产生 84 条假红）。目标位那一族由本组 Pass 3 覆盖。
  //
  // 判据（全部为「与正确对照同值」，不钉具体动作；两个平台都跑）：
  //   ① **结构**：表必须包含官方全表 8 项 —— 这是 `/env` 的**唯一**守护（见下）；
  //   ② Pass 1：非首位开关（命令名之前）≡ **去掉该词**的同前缀形态；
  //   ③ Pass 2：同上，但带 `/user:a`（官方语法的标准顺序）；
  //   ④ Pass 3：**目标位**（命令名之后）的白名单词元 ≡ 裸命令，且 `blast.path` **就是该词元**；
  //   ⑤ 二义性分叉：同一个词元在开关位判 `null`、在目标位判 `outside|该词` —— 必须分叉；
  //   ⑥ 端到端：`priv=allow` / `outside=deny` 下不得比不带前缀更松。
  //
  // `/env` 为什么单列：它与 `WRAPPERS` **同名**，`runas` 支在它上面本就走 wrapper 分支
  // （HEAD 即如此，属既有行为）—— 故**行为变异对它不敏感**（删掉后本组行为断言仍绿，实测）。
  // 它的守护只能靠 ①（结构）与逐字面量，不能靠「删一项看变不变红」。
  {
    // `runas /?` 官方语法里**不含 `:`** 的开关，共 8 个。
    const RUNAS_OFFICIAL = ['/noprofile', '/profile', '/savecred', '/netonly',
      '/env', '/smartcard', '/showtrustlevels', '/trustlevel']
    // ① 结构断言：表内容必须**包含**官方全表。解析失败时 `runasTblKeys` 为空 →
    //    `runasMissing` 为全表 → 红灯（不会静默通过）。
    const runasTbl = spSrc.match(/const RUNAS_SWITCHES = dict\(\{([\s\S]*?)\n\}\)/)
    const runasTblKeys = runasTbl ? [...runasTbl[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : []
    const runasMissing = RUNAS_OFFICIAL.filter((s) => runasTblKeys.indexOf(s) === -1)
    const TAILS54r = ['rm -rf /tmp', 'kill 1234', 'reg delete HKLM\\X /f', 'taskkill /im x.exe']
    const PLATS54r = ['win32', 'posix']
    const badBlast54r = []
    const badTier54r = []
    let n54rSw = 0      // Pass 1 比较条数
    let n54rCtl = 0     // 对照侧真的判出了值（防空转）
    let n54rSw2 = 0     // Pass 2
    let n54rTgt = 0     // Pass 3
    let n54rFork = 0    // ⑤
    // ② Pass 1：非首位开关（命令名之前）—— 加不加该词必须同值
    for (const platform of PLATS54r) {
      for (const sw of RUNAS_OFFICIAL) {
        const other = RUNAS_OFFICIAL.find((x) => x !== sw)
        for (const tail of TAILS54r) {
          const c = 'runas ' + other + ' ' + sw + ' ' + tail
          const ctl = 'runas ' + other + ' ' + tail
          const sc = segOf(c, 'bash', platform)
          const sp = segOf(ctl, 'bash', platform)
          n54rSw += 1
          if (!sc || !sp) { badBlast54r.push([platform, c, 'NO-SEG']); continue }
          const vc = sc.b ? sc.b.level + '|' + sc.b.path : 'null'
          const vp = sp.b ? sp.b.level + '|' + sp.b.path : 'null'
          if (vp !== 'null') n54rCtl += 1
          if (vc !== vp) badBlast54r.push([platform, c, ctl, vc, vp])
          if (!sp.t.every((t) => sc.t.indexOf(t) !== -1)) badTier54r.push([platform, c, sc.t, sp.t])
        }
      }
    }
    // ③ Pass 2：非首位开关 + `/user:a`（`/env` 排除 —— 它与 `WRAPPERS` 同名，见上）
    for (const platform of PLATS54r) {
      for (const sw of RUNAS_OFFICIAL.filter((x) => x !== '/env')) {
        const other = RUNAS_OFFICIAL.find((x) => x !== sw && x !== '/env')
        for (const tail of TAILS54r) {
          const c = 'runas ' + other + ' ' + sw + ' /user:a ' + tail
          const ctl = 'runas ' + other + ' /user:a ' + tail
          const sc = segOf(c, 'bash', platform)
          const sp = segOf(ctl, 'bash', platform)
          n54rSw2 += 1
          if (!sc || !sp) { badBlast54r.push([platform, c, 'NO-SEG']); continue }
          const vc = sc.b ? sc.b.level + '|' + sc.b.path : 'null'
          const vp = sp.b ? sp.b.level + '|' + sp.b.path : 'null'
          if (vc !== vp) badBlast54r.push([platform, c, ctl, vc, vp])
          if (!sp.t.every((t) => sc.t.indexOf(t) !== -1)) badTier54r.push([platform, c, sc.t, sp.t])
        }
      }
    }
    // ④ Pass 3：**目标位**（命令名之后）—— 白名单词元当**真目标**时必须判出，
    //    且 `blast.path` **就是那个词元**（防「判出别的路径」的假绿）。
    //    `path` 那一条只对 `rm -rf` 断言：`rmdir` 在 win32 下把单段 `/x` 当 cmd 风格开关
    //    跳过是**既有平台行为**（`isCmdStyleSwitch`），与本表无关。
    for (const platform of PLATS54r) {
      for (const sw of RUNAS_OFFICIAL) {
        const other = RUNAS_OFFICIAL.find((x) => x !== sw)
        for (const cmd of ['rm -rf', 'rmdir']) {
          const c = 'runas ' + other + ' ' + cmd + ' ' + sw
          const ctl = cmd + ' ' + sw
          const sc = segOf(c, 'bash', platform)
          const sp = segOf(ctl, 'bash', platform)
          n54rTgt += 1
          if (!sc || !sp) { badBlast54r.push([platform, c, 'NO-SEG']); continue }
          const vc = sc.b ? sc.b.level + '|' + sc.b.path : 'null'
          const vp = sp.b ? sp.b.level + '|' + sp.b.path : 'null'
          if (vc !== vp) badBlast54r.push([platform, c, ctl, vc, vp])
          if (cmd === 'rm -rf' && vp !== 'outside|' + sw) {
            badBlast54r.push([platform, ctl, 'CTL-PATH', vp, 'outside|' + sw])
          }
        }
      }
    }
    // ⑤ 二义性分叉：同一个词元在**开关位**判 null、在**目标位**判 `outside|该词`。
    //    这一条钉住「按位置区分」这个判据本身：若有人把 `isRunasSwitchShapedWord` 改成
    //    「单段 `/x` 一律算开关」（目标位会判 null）或「一律算路径」（开关位会判出该词），
    //    本支立刻红 —— 而只比较「与对照同值」的 Pass 1/3 在两种改法下都可能蒙混过关。
    for (const sw of RUNAS_OFFICIAL.filter((x) => x !== '/env')) {
      const other = RUNAS_OFFICIAL.find((x) => x !== sw && x !== '/env')
      const atSwitch = blastOf('runas ' + other + ' ' + sw + ' rm -rf', 'bash', 'posix')
      const atTarget = blastOf('rm -rf ' + sw, 'bash', 'posix')
      if (atSwitch === null && atTarget === 'outside') n54rFork += 1
      else badBlast54r.push(['FORK', sw, atSwitch, atTarget])
    }
    // ⑥ 端到端：提权只会更严，绝不会更宽 —— 带开关链的形态不得比**去掉该开关**更松。
    //    对照取「同前缀、只差被测开关」（不是裸命令）：`runas /env …` 走 wrapper 分支
    //    是既有行为，与裸命令比会引入无关差异。
    const e2e54r = []
    const allAsk54r = { inside: 'ask', outside: 'ask', wide: 'ask', unknown: 'ask', proc: 'ask', power: 'ask', priv: 'ask', reg: 'ask' }
    const RANK54r = { allow: 0, ask: 1, deny: 2, inherit: 0 }
    const mkH54r = (platform, ds) => {
      const h = tierOpts(platform)
      h.destructive = () => ds
      h.category = () => ({ action: 'allow' })
      h.matchException = () => null
      return h
    }
    for (const platform of PLATS54r) {
      for (const sw of RUNAS_OFFICIAL.filter((x) => x !== '/env')) {
        const other = RUNAS_OFFICIAL.find((x) => x !== sw && x !== '/env')
        for (const ds of [Object.assign({}, allAsk54r, { priv: 'allow' }), Object.assign({}, allAsk54r, { outside: 'deny' })]) {
          for (const tail of ['rm -rf /tmp', 'rm -rf']) {
            const c = 'runas ' + other + ' ' + sw + ' /user:a ' + tail
            const ctl = 'runas ' + other + ' /user:a ' + tail
            const a = assessCommand(c, 'bash', mkH54r(platform, ds)).action
            const b = assessCommand(ctl, 'bash', mkH54r(platform, ds)).action
            if (RANK54r[a] < RANK54r[b]) e2e54r.push([platform, c, ctl, a, b])
          }
        }
      }
    }
    ok('★★ 54r `runas` 官方开关全表 × 非首位：漏加一项即 fail-open（开关位该跨、目标位不该跨，两平台穷举）',
      runasMissing.length === 0 && runasTblKeys.length >= 8
      && badBlast54r.length === 0 && badTier54r.length === 0 && e2e54r.length === 0
      // 防空转：比较条数必须等于语料叉乘大小，且对照侧真的判出了值
      && n54rSw === RUNAS_OFFICIAL.length * TAILS54r.length * PLATS54r.length
      && n54rCtl > 0
      && n54rSw2 === 7 * TAILS54r.length * PLATS54r.length
      && n54rTgt === RUNAS_OFFICIAL.length * 2 * PLATS54r.length
      && n54rFork === 7
      // 收益不得被本组吃掉：54o 的主角形态仍须 `outside|/tmp`
      && blastOf('runas /profile /savecred /user:admin rm -rf /tmp', 'bash', 'win32') === 'outside'
      // 逐字面量：4 个此前**无任何断言守护**的开关（删掉后旧测试仍全绿）钉死
      && blastOf('runas /noprofile /smartcard rm -rf /tmp', 'bash', 'win32') === 'outside'
      && blastOf('runas /noprofile /showtrustlevels rm -rf /tmp', 'bash', 'win32') === 'outside'
      && blastOf('runas /noprofile /trustlevel rm -rf /tmp', 'bash', 'win32') === 'outside'
      && blastOf('runas /noprofile /env rm -rf /tmp', 'bash', 'win32') === 'outside'
      && blastOf('runas /noprofile /smartcard rm -rf /tmp', 'bash', 'posix') === 'outside'
      // 对照（防过度收紧）：目标位的白名单词元必须判出**该词元本身**；
      // 同名词元在开关位仍判 null（两个位置必须分叉）
      && blastOf('runas /noprofile rm -rf /smartcard', 'bash', 'posix') === 'outside'
      && blastOf('runas /profile /smartcard rm -rf', 'bash', 'posix') === null,
      JSON.stringify({ runasMissing, tblKeys: runasTblKeys.length, n54rSw, n54rCtl, n54rSw2, n54rTgt, n54rFork,
        badBlast54r: badBlast54r.slice(0, 8), badTier54r: badTier54r.slice(0, 6), e2e54r: e2e54r.slice(0, 6),
        smartcard: blastOf('runas /noprofile /smartcard rm -rf /tmp', 'bash', 'win32'),
        tgtPos: blastOf('runas /noprofile rm -rf /smartcard', 'bash', 'posix'),
        swPos: blastOf('runas /profile /smartcard rm -rf', 'bash', 'posix') }))
  }
  // ── 54p：关键字链的**路径形态守卫**（残余 ② 的修法）────────────────────────────────
  // `privOperandSkip` 的 ③ 分支按 `commandNameOf` 的 **basename** 认语句关键字，而
  // `commandNameOf` 取尾段 —— 于是 `/data`、`C:/data`、`D:/data` 的 basename 恰好是
  // PowerShell 关键字 `data`，**目标词元**被当关键字跳过、链一路推进到末尾的破坏性名
  // → 跨过操作数 → 命令头把整段跳空 → 段级 blast 归 null → 档位 `inside`。
  //
  // ⚠️ **范围远大于 `data` 一族**：`STATEMENT_KEYWORDS` 的 **33/33** 个名字全部可被路径形态
  // 触发（`/in` `/for` `/do` `/end` `/try` `/switch` `/class` `/begin` `/process` `/not`
  // `/if` `/else` `/then` `/exit` `/return` `/function` `/catch` `/finally` `/and` `/or`
  // `/while` `/foreach` …），不止注释最初举的 `data`。故本组**按名单穷举**而不是只钉三条 ——
  // 否则日后往 `STATEMENT_KEYWORDS` 加一个名字就多一条静默漏报，而测试照不出来。
  //
  // ⚠️ 原注释给的修法方向「给 `k === at` 加『路径形态』守卫」**不可行**：按此变异后
  // 54d/54h/54h2/54h3/54n/54l **6 条断言变红**（`runas` 的**首位**开关 `/noprofile`
  // 本身就是路径形态）。可行修法是**只给关键字链加守卫**（本组钉的就是它）。
  {
    const kwNames = Object.keys(STATEMENT_KEYWORDS)
    // ── ⚠️ 平台分派（实测，两者判据**不同**）────────────────────────────────────────
    // · **posix 侧** `/<关键字>`：`isCmdStyleSwitch` 是平台感知的（posix 恒 false），
    //   故 `/data` 不会被当 cmd 开关跳过 → 修好后必须判 `outside|/data`（**path 就是那个词元**）。
    // · **win32 侧** `/<关键字>`：`/data` **本就被 `isCmdStyleSwitch` 当 cmd 开关跳过**
    //   （既有行为，与本次无关）→ 恒 `null`。故 **win32 侧不能用 `su root /<kw> rm` 判**。
    // · 盘符形态（`C:/<关键字>`）两侧都必须判出 —— 它含第二个 `/` 与 `:`，不是 cmd 开关。
    // 只钉 win32 的 `/kw` 形态会得到「修复前后都是 null」的**空转断言**（实测踩过）。
    const posixBad = []
    const posixPathWrong = []
    const noSeg = []
    let posixOk = 0
    // `{` / `}` 是 bash 的**分组符**，词法器把它们当分隔符，于是 `su root /} rm` 拆成
    // `['su','root','/','rm']`（`/}` 这个词元**根本不存在**）、`su root /{ rm` 直接无段。
    // 那是词法层的既有行为，不是本判据能管的事 —— 显式排除并断言「排除数 ≤ 2」，
    // 免得日后有人往 `STATEMENT_KEYWORDS` 里加一个同样拆不出段的名字却以为是本组放过了。
    const LEXICAL_EXCLUDE = ['{', '}']
    for (const kw of kwNames) {
      if (LEXICAL_EXCLUDE.indexOf(kw) !== -1) { noSeg.push(kw); continue }
      const c = 'su root /' + kw + ' rm'
      const s = segOf(c, 'bash', 'posix')
      if (!s) { noSeg.push(kw); continue }
      if (!s.b) { posixBad.push([kw, 'null']); continue }
      // 逐条核实 `blast.path` **就是那个路径词元**（前两轮都有过「只看计数导致误归因」
      // 的教训）：若判成了 `su` 的操作数或别的词元，说明命令头仍停错位置。
      if (s.b.path !== '/' + kw) posixPathWrong.push([kw, s.b.path])
      else posixOk += 1
    }
    // 盘符形态（`C:/<关键字>`、`D:/<关键字>`）两侧都必须判出，且 path 就是那个词元
    const driveBad = []
    for (const kw of kwNames) {
      if (LEXICAL_EXCLUDE.indexOf(kw) !== -1) continue
      for (const drv of ['C:', 'D:']) {
        const c = 'su root ' + drv + '/' + kw + ' rm'
        for (const p of ['win32', 'posix']) {
          const s = segOf(c, 'bash', p)
          if (!s) continue
          if (!s.b || s.b.path !== drv + '/' + kw) driveBad.push([drv, kw, p, s.b ? s.b.path : 'null'])
        }
      }
    }
    // 对照（防空转）：不带前缀的对照本身必须判得出来（否则「非 null」判据会退化成恒真）
    const plainSuRm = blastOf('su root rm -rf /tmp', 'bash', 'win32')
    // 对照（防空转）：**裸关键字**仍必须被当关键字跳过 —— 否则本修法把关键字链整个关掉了，
    // `su root time rm -rf /tmp` 这一族（54d 钉的）会退回。
    const bareKw = ['time', '!'].filter((kw) => blastOf('su root ' + kw + ' rm -rf /tmp', 'bash', 'win32') !== plainSuRm)
    // 对照（防空转）：真关键字链的**跨越能力**必须仍在（跨到关键字之后的破坏性命令名）
    const kwChain = blastOf('su root time rm -rf /tmp', 'bash', 'win32')
    // 对照（防过度收紧）：纯路径目标（非关键字 basename）行为不变（54d2 的收益不得被吃掉）
    const pathTargets = ['su root /etc', 'su root /var/www/deploy.sh', 'su root C:/Windows']
      .map((c) => [c, blastOf(c, 'bash', 'win32')])
    // 端到端：`priv=allow` 时盘符形态不得 allow（修复前是 allow）
    const dsPrivAllow54p = { inside: 'allow', outside: 'ask', wide: 'ask', unknown: 'ask', proc: 'ask', power: 'ask', priv: 'allow', reg: 'ask' }
    const h54p = tierOpts('win32')
    h54p.destructive = () => dsPrivAllow54p
    const allowKw = ['su root C:/data rm', 'su root D:/data rm', 'su root C:/in rm', 'su root D:/for rm']
      .filter((c) => assessCommand(c, 'bash', h54p).action === 'allow')
    const h54pPosix = tierOpts('posix')
    h54pPosix.destructive = () => dsPrivAllow54p
    const allowKwPosix = ['su root /data rm', 'su root /in rm', 'su root /for rm', 'su root /try rm',
      'su root /process rm']
      .filter((c) => assessCommand(c, 'bash', h54pPosix).action === 'allow')
    ok('★★ 54p 路径 basename 不得被当语句关键字（`su root /data rm` 一族，全部关键字穷举 × 两平台）',
      posixBad.length === 0 && posixPathWrong.length === 0 && driveBad.length === 0
      && bareKw.length === 0 && allowKw.length === 0 && allowKwPosix.length === 0
      // 对照（防空转）：不带前缀的对照本身必须判得出来
      && plainSuRm !== null
      && kwNames.length >= 30
      // 对照（防空转）：本组确实覆盖了全表（只有 `{` / `}` 两个词法分组符被排除）——
      // 四类计数之和必须等于全表大小，否则「穷举」是假的
      && posixOk + posixBad.length + posixPathWrong.length + noSeg.length === kwNames.length
      && posixOk >= kwNames.length - LEXICAL_EXCLUDE.length
      && noSeg.length === LEXICAL_EXCLUDE.length
      // 对照（防空转）：**裸关键字**链的跨越能力必须仍在（54d 的收益不得被本条吃掉）
      && kwChain === plainSuRm
      && blastOf('su root ! rm -rf /tmp', 'bash', 'win32') === plainSuRm
      // 对照（防过度收紧）：纯路径目标仍留在命令头之外参与判档（54d2 的收益不得被本条吃掉）。
      // `/etc` 走 **posix**（win32 下它是 `outside` —— 系统目录名单是平台感知的，
      // 用 win32 断言 `system` 会假红，实测踩过），`C:/Windows` 走 win32。
      && pathTargets.every(([, v]) => v !== null)
      && blastOf('su root /etc', 'bash', 'posix') === 'system'
      && blastOf('su root C:/Windows', 'bash', 'win32') === 'system',
      JSON.stringify({ posixBad: posixBad.slice(0, 8), posixPathWrong: posixPathWrong.slice(0, 8),
        driveBad: driveBad.slice(0, 8), noSeg, bareKw, allowKw, allowKwPosix,
        kwCount: kwNames.length, plainSuRm,
        data: blastOf('su root /data rm', 'bash', 'posix'),
        inKw: blastOf('su root /in rm', 'bash', 'posix'),
        cData: blastOf('su root C:/data rm', 'bash', 'win32'),
        kwChain,
        pathTargets }))
  }
  // ── 54k：**操作数之后的非破坏性命令不得被吞**（发现 1 的核心回归，方向 fail-open）────
  // `privOperandSkip` 的扫描一度**无上界**（`while (k < w.length && isPrivOperandWord(…)) k += 1`），
  // 而 `isPrivOperandWord` 对**任何不是「吃目标的命令名」的词元**都返回 true —— 于是扫描
  // 一路吞到段内那个恰好叫破坏性命令名的词元，把**真命令与真目标**一起吞进命令头：
  //     su root ls C:/Windows kill
  //       → 扫描跨过 `ls`、`C:/Windows`，停在末尾的 `kill`
  //       → `commandHeadEnd` 返回 **5**（HEAD 返回 **1**，停在 `ls`）
  //       → `blastRadiusOfSegment` 的 `i < headEnd` 把整段跳空 → 段级 blast 归 **null**
  //       → 半径档落 `inside` → HEAD 判 `system`/ask，回归版判 **null/allow**。
  // 三方差分实测：HEAD 有值而回归版为 null 的形态 **88 条**（`su root ls /usr/bin/rm`、
  // `su root cat C:/Windows/System32/taskkill.exe`…），全部是「操作数 + 非破坏性命令 +
  // 系统路径 + 末尾破坏性名」—— HEAD 侧本就正确，故这是本批引入的 fail-open 回归。
  //
  // 判据取「**与 HEAD 同值**」（= 与不带 `su` 操作数的同命令同值），而不只是「非 null」。
  {
    const badSwallow = []
    // [带操作数的形态, 同命令不带操作数的对照]
    const pairs54k = [
      ['su root ls C:/Windows', 'ls C:/Windows'],
      ['su root ls C:/Windows kill', 'ls C:/Windows'],
      ['su root ls /usr/bin/rm', 'ls /usr/bin/rm'],
      ['su root ls -l /usr/bin/rm', 'ls -l /usr/bin/rm'],
      ['su root ls /usr/bin/chmod', 'ls /usr/bin/chmod'],
      ['su root cat /etc/hosts rm', 'cat /etc/hosts'],
      ['su root cat /etc/hosts /usr/bin/rm', 'cat /etc/hosts'],
      ['su root wc -l /etc/hosts kill', 'wc -l /etc/hosts'],
      ['su root du -sh /etc kill', 'du -sh /etc'],
      ['su root stat /etc/shadow kill', 'stat /etc/shadow'],
      ['su root ls C:/Windows/System32/taskkill.exe', 'ls C:/Windows/System32/taskkill.exe'],
    ]
    for (const [a, b] of pairs54k) {
      const va = blastOf(a, 'bash', 'win32'), vb = blastOf(b, 'bash', 'win32')
      // 对照本身必须判得出来（否则「同值」恒真、本组空转）
      if (vb === null || va !== vb) badSwallow.push([a, va, b, vb])
    }
    // 端到端：`priv=allow` 时不得静默放行（HEAD 下是 ask）
    const dsPrivAllow54k = { inside: 'allow', outside: 'ask', wide: 'ask', unknown: 'ask', proc: 'ask', power: 'ask', priv: 'allow', reg: 'ask' }
    const h54k = tierOpts('win32')
    h54k.destructive = () => dsPrivAllow54k
    const allowed = ['su root ls C:/Windows kill', 'su root cat /etc/hosts rm', 'su root ls /usr/bin/rm']
      .filter((c) => assessCommand(c, 'bash', h54k).action === 'allow')
    ok('★★ 54k `su`/`runas` 操作数之后的非破坏性命令与目标不得被贪婪扫描吞掉（与不带操作数同值）',
      badSwallow.length === 0 && allowed.length === 0
      // 对照（防空转）：上面每条对照本身必须非 null —— 逐条列出，避免整组退化
      && pairs54k.every(([, b]) => blastOf(b, 'bash', 'win32') !== null)
      // 方向检验：**真删除形态不受影响** —— 操作数之后是破坏性命令名时仍须跨过它，
      // 否则 54d/54d2/54e 修好的那一族会退回。
      && blastOf('su root rm -rf /data', 'bash', 'win32') === blastOf('rm -rf /data', 'bash', 'win32')
      && blastOf('su root find /data -delete', 'bash', 'win32') !== null
      && blastOf('su root env find /data -delete', 'bash', 'win32') === blastOf('env find /data -delete', 'bash', 'win32')
      // 对照（防过度收紧）：`su root` / `su root ls` 仍不得凭空判出半径（54b/54h3 的收益）
      && blastOf('su root', 'bash', 'win32') === null
      && blastOf('su root ls', 'bash', 'win32') === null
      && blastOf('su root x', 'bash', 'win32') === null,
      JSON.stringify({ badSwallow, allowed,
        suLsWinKill: blastOf('su root ls C:/Windows kill', 'bash', 'win32'),
        lsWin: blastOf('ls C:/Windows', 'bash', 'win32'),
        suCatHostsRm: blastOf('su root cat /etc/hosts rm', 'bash', 'win32'),
        catHosts: blastOf('cat /etc/hosts', 'bash', 'win32'),
        suRoot: blastOf('su root', 'bash', 'win32'),
        suRootLs: blastOf('su root ls', 'bash', 'win32') }))
  }
  // ── 54l：`su` / `runas` 操作数 + 载荷族（`find`）必须可见（发现 1 同根的另一半）─────────
  // `commandHeadEnd` 的 ② 分支只认 `isDestructiveLabel` 时，`find` **不在**名单里
  // （它的破坏性来自后续 `-delete` / `-exec`），于是命令头停在操作数 `root` 上、
  // `headCommandNameOf` 取回 `root` → `isCmdStyleSwitch('/data', …, 'root')` 认不出命令域
  // → `/data` 被当 cmd 开关跳过 → 段级 blast 归 null → 半径档 `inside` → `priv=allow`
  // 时静默放行。实测：`su root find /data -delete` 的段级 blast 是 **null**，而同目标的
  // `su root env find /data -delete`（wrapper 分支把它推进过去了）是 outside
  // —— 同一件事只因少一个 wrapper 就分叉。
  //
  // 判据取「**与带 wrapper 的同目标形态同值**」—— 这是根因判据（分叉才是缺陷）。
  {
    const badFind = []
    const pairs54l = [
      ['su root find /data -delete', 'su root env find /data -delete'],
      ['su root find /data -exec rm -rf {} +', 'su root env find /data -exec rm -rf {} +'],
      ['su root find / -delete', 'su root env find / -delete'],
      ['runas /user:a find /data -delete', 'runas /user:a env find /data -delete'],
    ]
    for (const [a, b] of pairs54l) {
      const va = blastOf(a, 'bash', 'win32'), vb = blastOf(b, 'bash', 'win32')
      if (vb === null || va !== vb) badFind.push([a, va, b, vb])
    }
    const dsPrivAllow54l = { inside: 'allow', outside: 'ask', wide: 'ask', unknown: 'ask', proc: 'ask', power: 'ask', priv: 'allow', reg: 'ask' }
    const h54l = tierOpts('win32')
    h54l.destructive = () => dsPrivAllow54l
    const allowFind = ['su root find /data -delete', 'su root find /data -exec rm -rf {} +', 'runas /user:a find /data -delete']
      .filter((c) => assessCommand(c, 'bash', h54l).action === 'allow')
    ok('★★ 54l `su`/`runas` 操作数之后的载荷族（`find`）必须可见（与带 wrapper 同目标同值）',
      badFind.length === 0 && allowFind.length === 0
      // 对照（防空转）：带 wrapper 的对照本身必须判得出来
      && pairs54l.every(([, b]) => blastOf(b, 'bash', 'win32') !== null)
      // 载荷族 label 仍必须可见（54h3 的收益不得被本条吃掉）
      && segmentLabels(decomposeCommand('su root find /data -delete', 'bash').segments[0].words).indexOf('find') !== -1
      // 对照（防过度收紧）：`su root find`（无动作 flag）不因此凭空判出半径之外的东西 ——
      // 它的 `find` 仍可见，但纯搜索路径的 outside 是**已知的假警告**（方向 fail-safe，
      // 54e 已论证：拿 32 条假警告换 64 条真漏报），故这里只钉「不得归 null」
      && blastOf('su root find /data -delete', 'bash', 'win32') !== null,
      JSON.stringify({ badFind, allowFind,
        suFindDelete: blastOf('su root find /data -delete', 'bash', 'win32'),
        suEnvFindDelete: blastOf('su root env find /data -delete', 'bash', 'win32'),
        suFindRootDelete: blastOf('su root find / -delete', 'bash', 'win32'),
        suEnvFindRootDelete: blastOf('su root env find / -delete', 'bash', 'win32') }))
  }
  // ── 54m：发现 3 的性能守卫 —— `su (reg --config)*n` 必须**线性**（照搬 54f 的范式）──────
  // `isPrivOperandWord` 每个词元都调一次 `isTargetEatingNameIn` → `routerSubLabelOf`，
  // 而后者从该下标**向后扫到段尾**；贪婪扫描本身 O(n)，两者相乘即 **O(n²)**。
  // 触发形态是「`su`/`runas` 后出现『路由器名 + `ROUTER_OPT_VALUE` 带值选项』的重复序列」，
  // 12 个带值选项键全部命中（`--config`/`-C`/`--git-dir`/`--namespace`/`--prefix`…）。
  //
  // 实测（`su (reg --config)*n`、词元数 = 1+2n、修复前）：
  //   n=1000 → 8.7 ms、2000 → 34.4、4000 → 138.4、8000 → **538.6 ms**（`segmentLabels`），
  //   倍率稳定 **3.89–4.03**（标准平方）；`blastRadiusOfSegment` 同步平方（8000 → 1079 ms），
  //   端到端 `assessCommand` 8000 → **1651 ms**。而 HEAD 与修复后**全部线性**
  //   （n=8000 → 0.6 ms，倍率 ≈2.0）。
  //
  // **判据用倍率而不是绝对耗时**（绝对阈值会被机器速度带偏）：n 翻倍时线性实现约 ×2、
  // 平方实现约 ×4。取 ×3.0 作分界，留足噪声余量；N 取 4000/8000。
  // **同时**钉住绝对上限 300 ms —— 单看倍率会被「两边都很慢」骗过。
  {
    const buildPerf = (n) => {
      const w = ['su']
      for (let i = 0; i < n; i += 1) w.push('reg', '--config')
      return w
    }
    const timeSegLabels = (n) => {
      const w = buildPerf(n)
      return timeBest(() => segmentLabels(w))
    }
    const p4000 = timeSegLabels(4000)
    const p8000 = timeSegLabels(8000)
    const perfRatio = p8000 / Math.max(p4000, 0.001)
    // 对照（防空转）：`su reg reg reg…`（**不带**带值选项）在修复前后都是线性 ——
    // 它在这里的作用是证明「本组测的确实是『带值选项 + 路由器名』那条判据」：
    // 若它也测出平方，说明平方来自别处（本组的归因就错了）。
    const buildPlain = (n) => {
      const w = ['su']
      for (let i = 0; i < n; i += 1) w.push('reg')
      return w
    }
    const timePlain = (n) => {
      const w = buildPlain(n)
      return timeBest(() => segmentLabels(w))
    }
    const q8000 = timePlain(8000)
    // ── 同族的**路径形态**路由器名（`/reg`）也必须是线性 ────────────────────────────
    // 裸名 `reg` 会被操作数扫描的上界（`isOperandShapedWord`）提前挡住，故只有
    // **路径形态**的路由器名（`/reg`、`/uv`）能一路走到 `routerSubLabelOf` 的向后扫描里。
    // 这一支是实测发现的**残余平方**：给 `routerSubLabelOf` 加常数上限前，
    // `su (/reg --config)*8000` 的 `segmentLabels` 是 **556.8 ms**、`blastRadiusOfSegment`
    // **1120.5 ms**（倍率均 ≈4.0，标准平方）；加 `ROUTER_SUB_SCAN_MAX` 后降到 0.6 ms（线性）。
    // 少了这条，上面那个「裸名形态」的守卫会漏掉真正的平方触发路径。
    const buildSlash = (n) => {
      const w = ['su']
      for (let i = 0; i < n; i += 1) w.push('/reg', '--config')
      return w
    }
    const timeSlash = (n) => {
      const w = buildSlash(n)
      return timeBest(() => segmentLabels(w))
    }
    const s4000 = timeSlash(4000)
    const s8000 = timeSlash(8000)
    const slashRatio = s8000 / Math.max(s4000, 0.001)
    ok('★★ 54m `su (reg --config)*8000` 的 label 判定必须线性（发现 3：`routerSubLabelOf` 的向后全扫导致 O(n²)）',
      p8000 < 300 && perfRatio < 3.0 && q8000 < 300
      // 路径形态路由器名（残余平方的真正触发路径）同样必须线性 + 绝对上限
      && s8000 < 300 && slashRatio < 3.0
      // 对照（防空转）：N 太小时本组无意义 —— 断言 4000 也真的做了工作（不是 0 词元）
      && buildPerf(4000).length === 1 + 4000 * 2
      && buildSlash(4000).length === 1 + 4000 * 2,
      JSON.stringify({ p4000: +p4000.toFixed(3), p8000: +p8000.toFixed(3),
        ratio: +perfRatio.toFixed(2), plain8000: +q8000.toFixed(3),
        slash4000: +s4000.toFixed(3), slash8000: +s8000.toFixed(3), slashRatio: +slashRatio.toFixed(2),
        tokens8000: buildPerf(8000).length }))
  }
  // ── 54m2：扫描上限的**计数口径**必须覆盖「同键重复」（发现 2）────────────────────────
  // `routerSubLabelOf` 的向后扫描上限一度**只按词元数**计（`idx + 1 + 64`），而原注释用
  // 「13 个带值选项键 × 2 词元 = 26，64 留一倍余量」论证它不会误伤 —— 该论证**漏了
  // 同一个键重复出现**：13 是**去重后**的键数，重复不受它约束。
  // 触发形态：`su root reg (-c v)*n delete HKLM\X /f`，每对占 2 词元，n≥32 即越过 64 →
  // `delete` 扫不到 → `reg delete` label 丢失 → `headEnd` 由 3 掉回 1。
  //
  // 修法给「跳过的带值选项**次数**」补了独立上限（见 `ROUTER_SUB_SCAN_MAX` 的注释）。
  // 判据取「**label 与 headEnd 都恢复**」，而不是只看耗时 —— 那是本组的**功能**判据；
  // 耗时判据在 54m 里（两处上限都必须在，去掉任一个都会有形态退化）。
  //
  // ⚠️ 对照必须保留：**上限本身不能拆**。实测去掉词元维度上限后
  // `su root (-/reg --config)*8000` 的 `segmentLabels` 由 8.1 ms 涨到 **551 ms**
  // （倍率 3.89）—— 故下面同时钉住「极大 n 仍快速返回空 label」。
  {
    const mkRepeat = (n) => ['su', 'root', 'reg'].concat(...Array.from({ length: n }, () => ['-c', 'v'])).concat(['delete', 'HKLM\\X', '/f'])
    const lbOf = (w) => segmentLabels(w)
    const bad = []
    for (const n of [1, 16, 31, 32, 33, 64]) {
      const lb = lbOf(mkRepeat(n))
      if (lb.indexOf('reg delete') === -1) bad.push([n, lb])
    }
    // 性能：`-/reg`（唯一能同时走进贪婪扫描与向后扫描的形态）仍必须线性
    const buildDashSlash = (n) => {
      const w = ['su', 'root']
      for (let i = 0; i < n; i += 1) w.push('-/reg', '--config')
      return w
    }
    const timeDashSlash = (n) => {
      const w = buildDashSlash(n)
      return timeBest(() => segmentLabels(w))
    }
    const d4000 = timeDashSlash(4000)
    const d8000 = timeDashSlash(8000)
    const dashRatio = d8000 / Math.max(d4000, 0.001)
    ok('★★ 54m2 扫描上限必须按「带值选项次数」计（同键重复 32 次时 `reg delete` label 不得丢失）',
      bad.length === 0
      // 对照（防空转）：真实形态（无重复选项）本来就必须拼出两词 label
      && lbOf(['su', 'root', 'reg', 'delete', 'HKLM\\X', '/f']).indexOf('reg delete') !== -1
      && lbOf(['su', 'root', 'reg', '-c', 'v', 'delete', 'HKLM\\X', '/f']).indexOf('reg delete') !== -1
      // 对照（防过度收紧）：上限本身仍必须在 —— `-/reg` 形态（去掉词元上限后 O(n²)）
      // 必须线性且绝对耗时受控，否则「补次数维度」会顺带把词元维度拆掉。
      && d8000 < 300 && dashRatio < 3.0
      // 对照（防空转）：构造的确实是「每对占 2 词元」的形态
      && mkRepeat(32).length === 3 + 32 * 2 + 3,
      JSON.stringify({ bad, repeat32: lbOf(mkRepeat(32)), repeat64: lbOf(mkRepeat(64)),
        real: lbOf(['su', 'root', 'reg', 'delete', 'HKLM\\X', '/f']),
        dashSlash4000: +d4000.toFixed(3), dashSlash8000: +d8000.toFixed(3), dashRatio: +dashRatio.toFixed(2),
        tokens32: mkRepeat(32).length }))
  }
  // ── 54v：多层前缀链的推进必须**线性**（发现 2 修法的性能守卫）────────────────────
  // `pushHeadLabels` 的循环推进每轮只做 O(1) 的 `commandNameOf(w[i])` 查表，命令头 label
  // 只在链尾取**一次** `segmentLabel`。曾经写成「每轮取一次 `segmentLabel(w.slice(next))`」，
  // 于是 `sudo sudo … sudo kill 1234`（n 个前缀）退化成 **O(n²)** —— 实测 `segmentLabels`：
  // n=4000 → 4.69 ms、8000 → **16.91 ms**（倍率 3.6，标准平方），而修复前是 0.01 ms。
  // 触发形态是「提权前缀重复」这一族，且它在 `segmentLabels` 热路径上
  // （`isDestructiveSegment` 由 index.js 对每一段调用一次，同步早于弹窗）。
  // 判据用倍率（n 翻倍时线性 ≈×2、平方 ≈×4，取 ×3.0 分界）+ 绝对上限，与 54m/54f 同范式。
  {
    const buildChain = (n) => {
      const w = []
      for (let i = 0; i < n; i += 1) w.push('sudo')
      w.push('kill', '1234')
      return w
    }
    const timeChain = (n) => {
      const w = buildChain(n)
      return timeBest(() => segmentLabels(w))
    }
    const c4000 = timeChain(4000)
    const c8000 = timeChain(8000)
    const chainRatio = c8000 / Math.max(c4000, 0.001)
    ok('★★ 54v 多层提权前缀链（`sudo`×n + `kill`）的 label 判定必须线性（发现 2 修法：每轮不得调 segmentLabel）',
      c8000 < 300 && chainRatio < 3.0
      // 对照（防空转）：链再长，真命令名也必须看得见（否则「线性」可能来自提前放弃）
      && segmentLabels(buildChain(8000)).indexOf('kill') !== -1
      && segmentLabels(buildChain(8)).join(',') === 'sudo,kill'
      // 对照（防空转）：构造的确实是 n+2 词元
      && buildChain(4000).length === 4002,
      JSON.stringify({ c4000: +c4000.toFixed(3), c8000: +c8000.toFixed(3), chainRatio: +chainRatio.toFixed(2),
        labels8000: segmentLabels(buildChain(8000)), tokens: buildChain(4000).length }))
  }
  // ── 54F：pwsh 反引号续行守卫的**下标支**必须是线性（本轮修复：`\[[^\]]*\]$` 无左锚定）──
  // 判据本体是 `PWSH_ACCESSOR_TAIL` 里那条「下标访问」支（`(?<!\.)\[[^\]]*\]$`）。它**没有
  // 左锚定**，失配时对每个起始位置各回溯一遍 ⇒ O(n²)。触发形态是「长未闭合 `[` 词元 +
  // 反引号 + 换行」——`'"x"' + '['*n + '`\n'`。实测（本机 Node v24.19，取多次最小值）：
  //   端到端 `decomposeCommand` n=8k/16k/32k/64k → 15.0/58.0/231.2/922.1 ms（倍率 ≈4.0）；
  //   HEAD 同形态 0.3/0.4/0.9/1.2 ms（HEAD 走 bash 命令替换分支、根本不做词元判据，
  //   故这是第十轮引入的**真回归**）。放大器 `find . -exec … ' ; '` 连接 n 段病态词元时
  //   n=100（800 KB）→ 1548 ms，而 HEAD 28.3 ms。判定卡死则 `tools/pre-execute` 不返回、
  //   审批弹窗不出现 —— 与 `globMatch` / `flagEmbeddedPath` / `trailingDashRunAt` 同族。
  // 修法是手写线性判定（`bracketAccessorTailAt`），**必须与原正则等价**（不是近似）。
  //
  // 判据用倍率（n 翻倍时线性 ≈×2、平方 ≈×4，取 ×3.0 分界）+ 绝对上限，与 54m/54v 同范式。
  // ⚠️ n 取 16000/32000 而不是 4000/8000：平方实现在 4000 档只有 ~3.7 ms，
  //    与线性的绝对值差得不够开，倍率噪声占比大；16k/32k 档平方实现是 231 ms 量级，
  //    与线性（1 ms 量级）差两个数量级，判据稳。
  {
    const buildBracket = (n) => '"x"' + '['.repeat(n) + BT + '\n'
    const timeBracket = (n) => timeBest(() => decomposeCommand(buildBracket(n), 'pwsh'))
    const b16000 = timeBracket(16000)
    const b32000 = timeBracket(32000)
    const bracketRatio = b32000 / Math.max(b16000, 0.001)
    // 对照（防空转）：构造的确实是「引号串 + n 个 `[` + 反引号 + 换行」的 n+3 长度形态
    // 对照（防过度收紧）：同一判据在**正常**下标访问形态上仍必须命中（不得为线性而丢功能）
    const normal = decomposeCommand('Remove-Item -Force $arr[0]' + BT + '\n-Confirm:$false', 'pwsh')
    ok('★★ 54F 长未闭合 `[` 词元的续行判定必须线性（本轮：`\\[[^\\]]*\\]$` 无左锚定致 O(n²)）',
      b32000 < 300 && bracketRatio < 3.0
      // 对照（防空转）：长度真的是 n+5（`"x"` + n 个 `[` + 反引号 + 换行），
      // 且该形态不返回 ok:false（走了判据才可能平方）
      && buildBracket(32000).length === 32000 + 5
      && decomposeCommand(buildBracket(32000), 'pwsh').ok === true
      // 对照（防过度收紧）：正常下标访问族仍按词元边界切开
      && normal.ok === true && normal.segments.length === 1
      && normal.segments[0].words.indexOf('-Confirm:$false') !== -1,
      JSON.stringify({ b16000: +b16000.toFixed(3), b32000: +b32000.toFixed(3),
        ratio: +bracketRatio.toFixed(2), len: buildBracket(32000).length,
        normal: normal.ok ? normal.segments[0].words : normal.reason }))
  }
  // ── 54G：`PWSH_QUOTED_TAIL` 的判定**不得读 `segText`**（本轮修复：rope 反复扁平化）──
  // 判据本体是续行守卫里的「词元尾部是不是闭合引号」。它一度写成
  // `PWSH_QUOTED_TAIL.test(segText)`，而 `segText += s` 在 V8 里**只建 rope（O(1)）**，
  // 任何内容读取（含正则）都必须先把 rope 扁平化成连续串（**O(n) 拷贝**）——
  // 于是每个「反引号 + 换行」都触发一次全长拷贝，整段分解退化为 O(n²)。
  // 这正是本文件 `segEndsWithSpace` 那条注释里写明的坑（那是第一处，这是第二处）。
  // 实测形态 `'New-Item -Path $base' + ('`\n  -Name $n<i>')*N`（AI 生成多行 pwsh 的常见写法）：
  //   端到端 `decomposeCommand` N=8k/16k/32k → 20.0/381.7/1766.0 ms（HEAD 2.2/3.5/7.2 ms）；
  //   真实入口 `assessCommand` N=32000（520 KB）→ **1752 ms**（HEAD 59 ms）。
  // 修法是与 `segEndsWithSpace` **同一手法**的 O(1) 增量标记 `segLastIsQuote`
  // （在 `pushText` 里判刚追加的 `s`，并在 `pushSpace` / `flushSegment` 复位）。
  //
  // ⚠️ 这条修法**不改变任何判定结果**（穷举 111 万格 + 语料对拍分歧 0），故**只有性能断言
  //    能守住它** —— 实测把该处改回 `PWSH_QUOTED_TAIL.test(segText)`，本文件其余断言
  //    与 regressions/smoke **全绿**。没有本组时这个 O(n²) 会静默回来（第十轮已发生过一次）。
  {
    const buildLines = (n) => {
      let c = 'New-Item -Path $base'
      for (let i = 0; i < n; i += 1) c += BT + '\n  -Name $n' + i
      return c
    }
    const timeLines = (n) => timeBest(() => decomposeCommand(buildLines(n), 'pwsh'))
    const l16000 = timeLines(16000)
    const l32000 = timeLines(32000)
    const linesRatio = l32000 / Math.max(l16000, 0.001)
    // 对照（防过度收紧）：该形态的判定结果必须仍然正确 —— 行尾是**变量**（裸词族）⇒ 粘住，
    // 故只应有 1 段、且最后那个 `-Name $nN` 与下一行同属一个词元。为线性而丢判定即失败。
    const dLines = decomposeCommand(buildLines(200), 'pwsh')
    ok('★★ 54G `PWSH_QUOTED_TAIL` 判定不得读 `segText`（本轮：rope 扁平化致 O(n²)）',
      l32000 < 300 && linesRatio < 3.0
      // 对照（防空转）：长度真的是 `20 + Σ(12 + i 的位数)`（`New-Item -Path $base` 20 字符 +
      // 每轮 12 字符固定开销 + 行号位数），N=32000 时为 532910（约 520 KB），
      // 且不返回 ok:false
      && buildLines(32000).length === 532910
      && decomposeCommand(buildLines(32000), 'pwsh').ok === true
      // 对照（防过度收紧）：行尾变量是**粘住族** ⇒ 1 段（判定结果不得为性能让路）
      && dLines.ok === true && dLines.segments.length === 1
      && dLines.segments[0].words.indexOf('-Name') !== -1,
      JSON.stringify({ l16000: +l16000.toFixed(3), l32000: +l32000.toFixed(3),
        ratio: +linesRatio.toFixed(2), len: buildLines(32000).length,
        segs: dLines.ok ? dLines.segments.length : dLines.reason }))
  }
  // ── 54H：pwsh 词元形态判定**不得读 `wordText`**（本轮修复：rope 反复扁平化致 O(n²)）──
  // 判据本体是 `pwshEscapeBoundaryAt` 的第一句 `PWSH_PARAMETER_TOKEN.test(word)`（含 `*`
  // 量词 + `$` 锚，命中时需扫完整个词元）。它此前对 `wordText` **直接跑正则**，而
  // `wordText += s` 在 V8 里只建 rope（O(1)），**任何内容读取**（正则、下标、`slice`）
  // 都必须先把 rope 扁平化成连续串（O(n) 拷贝）—— 于是每个「落在 Parameter 词元内的
  // 反引号」都触发一次全长拷贝，整段分解退化为 O(n²)。
  //
  // 这与 `segEndsWithSpace`（第一处）、`segLastIsQuote`（第二处，见 54G）、
  // `bracketAccessorTailAt`（第三处，见 54F）是**同族**，本处是第四处。
  //
  // 触发形态**不需要畸形输入**：`-x` + (`` ` `` + `a`)×n —— `a` 是参数名字符 ⇒ 反引号被
  // 并进参数名、词元一路增长。`-Path` / `-Recurse` / `-LiteralPath` 等**任何** Parameter
  // 前缀同样成立。实测（本机 Node v24.19，取多次最小值）：
  //   端到端 `decomposeCommand` n=4k/8k/16k/32k/64k → **14.5/56.7/220/867/3451 ms**
  //   （倍率 3.92/3.88/3.94/3.98，**严格平方**）；HEAD 同形态 0.20/0.28/0.55/1.13/2.29 ms
  //   （倍率 ≈2，线性）—— 放大 **1500 倍**。真实入口 `assessCommand` 同形态 n=16k → 221 ms。
  //   判定卡死则 `tools/pre-execute` 不返回、审批弹窗不出现。
  // 修法是与前两处**同一手法**的 O(1) 增量标记（`wordShape` / `pushWordShape`）：
  // 随每次追加增量更新词元形态，判据不再读 `wordText`。
  //
  // ⚠️ 这条修法**不改变任何判定结果**（影子与那几个正则穷举 419330 格分歧 0，
  //    随机语料 12 万格分歧 0），故**只有性能断言能守住它** —— 实测把判据改回读
  //    `wordText`（变异 M2）本文件其余断言与 regressions/smoke **全绿**。
  //    没有本组时这个 O(n²) 会静默回来。
  //
  // 判据用倍率（n 翻倍时线性 ≈×2、平方 ≈×4，取 ×3.0 分界）+ 绝对上限，与 54F/54G 同范式。
  // ⚠️ n 取 16000/32000 而不是 4000/8000：平方实现在 4000 档只有 ~14 ms，
  //    与线性的绝对值差得不够开，倍率噪声占比大；16k/32k 档平方实现是 220/867 ms 量级，
  //    与线性（1 ms 量级）差两个数量级，判据稳。
  {
    const buildParam = (n, prefix) => prefix + (BT + 'a').repeat(n)
    const timeParam = (n, prefix) => timeBest(() => decomposeCommand(buildParam(n, prefix), 'pwsh'))
    const p16000 = timeParam(16000, '-x')
    const p32000 = timeParam(32000, '-x')
    const paramRatio = p32000 / Math.max(p16000, 0.001)
    // 真实前缀形态同样必须线性（`-Path` 是 AI 生成 pwsh 里最常见的写法之一）
    const p16000Path = timeParam(16000, '-Path')
    const p32000Path = timeParam(32000, '-Path')
    const pathRatio = p32000Path / Math.max(p16000Path, 0.001)
    // 对照（防空转）：构造的确实是「前缀 + n 个 `` `a ``」的 n*2+len(prefix) 长度形态，
    // 且该形态不返回 ok:false（走了判据才可能平方）
    const dParam = decomposeCommand(buildParam(32000, '-x'), 'pwsh')
    // 对照（防过度收紧）：同一判据在**正常**形态上仍必须正确 —— Parameter 词元内的反引号
    // 仍是字面字符（`;` 不吞、`a` 并进参数名），不得为线性而丢判定
    const dSem = decomposeCommand('cmd /c ver -x' + BT + 'a' + BT + ';' + BT + '\n' + 'RemoveXyz', 'pwsh')
    ok('★★ 54H pwsh 词元形态判定不得读 `wordText`（本轮：rope 扁平化致 O(n²)）',
      p32000 < 300 && paramRatio < 3.0 && p32000Path < 300 && pathRatio < 3.0
      // 对照（防空转）：长度真的是 `2 + 2n`，且不返回 ok:false
      && buildParam(32000, '-x').length === 32000 * 2 + 2
      && dParam.ok === true
      // 对照（防过度收紧）：Parameter 词元内的反引号语义不变 —— 反引号与 `a` **都**并进
      // 参数名（`-x`a`），且后面的 `;` 仍是真的语句分隔符（不得为线性而吞掉）
      && dSem.ok === true && dSem.segments.length === 2
      && dSem.segments[0].words.indexOf('-x' + BT + 'a' + BT) !== -1,
      JSON.stringify({ p16000: +p16000.toFixed(3), p32000: +p32000.toFixed(3),
        ratio: +paramRatio.toFixed(2), pathRatio: +pathRatio.toFixed(2),
        len: buildParam(32000, '-x').length,
        sem: dSem.ok ? dSem.segments.map((s) => s.words) : dSem.reason }))
  }
  // ── 54f：`find -exec` 一族的判定必须是**线性**的（发现 2 的性能守卫）──────────────
  // `isUnknownTierSegment` 曾在 **label 循环内**调 `hasNoOperand(w, opts)` 与 diskpart 的
  // `/s` 扫描 —— 而两者都只依赖 `(w, opts)`、与 label 完全无关；同时 `segmentLabels`
  // 对每个 `find -exec <cmd>` 各 push 一个 label 且**不去重**（去重只在 seg.opaque 分支做），
  // 于是 `labels.length` 随 `-exec` 个数线性增长 → 两趟 O(词元数) 扫描 × O(labels) = **O(n²)**。
  // 触发形态是常规写法（AI 生成的 `find . -exec diskpart {} +` 重复），不是构造输入。
  // 实测（`tierSetOf` 单次调用、posix 钩子、修复前）：
  //   diskpart N=1000 → 49 ms、2000 → 179、4000 → 698、8000 → **3577 ms**（每翻倍 ×4.0）；
  //   `-exec dd` × 8000 → 864 ms；而对照 `-exec rm {} +`（`rm` 不在 BARE_INTERACTIVE）
  //   N=8000 仅 **4 ms**（线性）—— 平方因子就是「每个 BARE label 一次 hasNoOperand」。
  //
  // **判据用倍率而不是绝对耗时**（绝对阈值会被机器速度带偏）：n 翻倍时线性实现约 ×2、
  // 平方实现约 ×4。取 ×3.0 作分界，留足噪声余量；N 取 4000/8000（修复前 698/3577 ms，
  // 倍率 5.1；修复后 3/4 ms，倍率 1.3）。**同时**钉住绝对上限 300 ms ——
  // 单看倍率会被「两边都很慢」骗过（n 小时计时噪声也会放大倍率）。
  {
    const build = (n, cmd) => {
      const w = ['find', '.']
      for (let i = 0; i < n; i += 1) w.push('-exec', cmd, '{}', '+')
      return w
    }
    const timeTierSet = (n, cmd) => {
      const w = build(n, cmd)
      const o = tierOpts('posix')
      const b = blastRadiusOfSegment(w, o)
      const lb = segmentLabels(w)
      return timeBest(() => tierSetOf({ words: w, blast: b }, lb, o))
    }
    const t4000 = timeTierSet(4000, 'diskpart')
    const t8000 = timeTierSet(8000, 'diskpart')
    const ratio = t8000 / Math.max(t4000, 0.001)
    // 对照（防空转）：`rm` 不在 BARE_INTERACTIVE，故它**从不**走 hasNoOperand ——
    // 修复前后都应是线性。它在这里的作用是证明「本组测的确实是那条判据」：
    // 若把 `rm` 也测出平方，说明平方来自别处（本组的归因就错了）。
    const r8000 = timeTierSet(8000, 'rm')
    ok('★★ 54f `find -exec diskpart` 重复 8000 次的档位判定必须线性（发现 2：每个 label 一次 hasNoOperand 导致 O(n²)）',
      t8000 < 300 && ratio < 3.0 && r8000 < 300
      // 对照（防空转）：N 太小时本组无意义 —— 断言 4000 也真的做了工作（不是 0 词元）
      && build(4000, 'diskpart').length === 2 + 4000 * 4,
      JSON.stringify({ t4000: +t4000.toFixed(2), t8000: +t8000.toFixed(2), ratio: +ratio.toFixed(2),
        rm8000: +r8000.toFixed(2), labels: segmentLabels(build(8000, 'diskpart')).length }))
  }
  // ── 54g：「哪些命令算提权前缀」只有**一份**（发现 3：两份表漂移方向 fail-open）─────
  // `GROUP_MEMBERS.priv` 与 `PRIV_PREFIXES` 是同一语义规则。分组那份被测试 32 的
  // 「并集 = DESTRUCTIVE_LABELS」双向一致断言盯着，而 `PRIV_PREFIXES` 此前**没有任何断言
  // 要求两者相等** —— 于是「新增提权命令时只改了分组表」会静默漂移。漂移方向是 **fail-open**，
  // 实测（以新增 `dzdo` 为例、只改分组表 + GROUP_OF_LABEL）：
  //   `sudo kill 1234` → labels ['sudo','kill'] → tiers ['proc','priv'] → proc=deny 时 **deny**
  //   `dzdo kill 1234` → labels ['dzdo']        → tiers ['priv']       → 同一配置下 **allow**
  // 即 proc 档整个不命中、用户写的 `kill *`=deny 例外也被绕过。
  // 计划 §5.3 原话是「**复用既有的 `PRIV_PREFIXES`，不新造表**」，故实现按该口径收敛：
  // 分组表由 `PRIV_PREFIXES` 的键**派生**，本组同时钉住「值相等」与「派生（不是手抄）」。
  {
    // 两边的**形态不同**：`PRIV_PREFIXES` 是 `{ name: 1 }` 字典，`GROUP_MEMBERS.priv` 是
    // 名字数组（`Object.keys` 的结果）。归一成「排序后的名字列表」再比 ——
    // 直接 `Object.keys(GROUP_MEMBERS.priv)` 会取到数组下标（`0,1,2…`），那是空转。
    const listOf = (v) => (Array.isArray(v) ? v.slice() : Object.keys(v)).map(String).sort().join(',')
    ok('★★ 54g 提权前缀只有一份：GROUP_MEMBERS.priv 由 PRIV_PREFIXES 的键派生（不得手抄第二份）',
      Array.isArray(GROUP_MEMBERS.priv) && listOf(GROUP_MEMBERS.priv) === listOf(PRIV_PREFIXES)
      // 派生（而非碰巧相等）：源码里 priv 那一项必须写成 Object.keys(PRIV_PREFIXES)，
      // 且不得出现手写的提权名字面量清单（那正是「第二份表」的形态）。
      && /priv:\s*Object\.keys\(PRIV_PREFIXES\)/.test(spSrc)
      && !/priv:\s*\[\s*'sudo'/.test(spSrc)
      // 对照组：每个提权名都真的在破坏性名单与 priv 组里（测试 32 的双向一致不得被本收敛破坏）
      && Object.keys(PRIV_PREFIXES).every((n) => DESTRUCTIVE_LABELS.has(n) && GROUP_OF_LABEL[n] === 'priv')
      // 且成员数非零（防空转：两张空表也「相等」）
      && Object.keys(PRIV_PREFIXES).length >= 6,
      JSON.stringify({ privKeys: Object.keys(PRIV_PREFIXES), group: GROUP_MEMBERS.priv,
        derived: /priv:\s*Object\.keys\(PRIV_PREFIXES\)/.test(spSrc) }))
  }
  // ── 54c：既有漏洞回归（例外 `kill *`=deny 时 `sudo kill 1234` 必须 deny）────
  {
    const r = run('sudo kill 1234', 'bash', {
      exceptions: ['kill *'], excAction: 'deny',
      destructive: 'allow', category: 'allow', platform: 'posix',
    })
    ok('★★ 54c 既有漏洞回归：例外 kill *=deny 时 sudo kill 1234 → deny（改前是 allow）',
      r.action === 'deny' && r.segments[0].source === 'exception',
      JSON.stringify({ action: r.action, source: r.segments[0].source }))
  }
  // ── 54c2：**授权方向不得认前缀扩展出的 label**（方向不变量，行为断言）──────────
  // 54 的扩展只论证了**收紧**方向（让破坏性名单与 deny 例外看得见 `sudo` 之后的真命令），
  // 而 `segmentLabels` 的并集同时被**例外匹配**消费，例外有 **allow** 动作 ——
  // 同一份 labels 若也用于授权，用户为普通 `rm` 写下的 `rm *`=allow 就会命中
  // `sudo rm -rf /`：「允许删工作区内的文件」被静默提升成「允许经 sudo 删任意路径」。
  // 修法是 `resolveException` 按**方向**取 label：收紧方向（deny/ask）用全部并集，
  // 授权方向（allow）只用滤掉 `widened` 的 `allowLabels`。
  //
  // **这条不变量此前零测试守护**（变异实测确认）：把授权方向改回「用全部 label（含 widened）」
  // 后，三个套件**全部 exit 0 漏网**，而行为差异真实存在（下面这条断言就是那个差异）。
  // 三套件里没有任何 `allowLabels` / `widened` 相关断言，故必须在这里补上。
  {
    // 两侧子设置都是默认 ask、大分类 ask：例外是**唯一**可能给出 allow 的来源，
    // 故一旦授权方向认了扩展名，动作就会由 ask 变 allow（差异可观察）。
    const allowOf = (cmd) => run(cmd, 'bash', {
      exceptions: ['rm *'], excAction: 'allow', platform: 'posix',
    })
    // ① 授权方向不认前缀扩展：`sudo rm …` 不得被 `rm *`=allow 授权
    const widened = ['sudo rm -rf /etc', 'sudo rm -rf /', 'sudo -u root rm -rf /etc']
      .filter((c) => allowOf(c).action === 'allow')
    ok('★★ 54c2 授权方向不认前缀扩展：例外 rm *=allow 时 sudo rm … 必须非 allow（改前是 allow）',
      widened.length === 0,
      JSON.stringify({ widened, sudoEtc: allowOf('sudo rm -rf /etc').action }))
    // 对照：**不带**提权前缀的同一条命令仍应 allow —— 证明例外本身生效、上面那条不是空转。
    // 少了这条对照，把例外匹配整个改坏（永远返回 null）也能让上面变绿。
    ok('★★ 54c3 对照：同一例外下不带前缀的 rm -rf /etc 仍 allow（证明 54c2 不空转）',
      allowOf('rm -rf /etc').action === 'allow'
      && allowOf('rm -rf /etc').segments[0].source === 'exception',
      JSON.stringify({ action: allowOf('rm -rf /etc').action, source: allowOf('rm -rf /etc').segments[0].source }))
    // ② 收紧方向**仍须**认前缀扩展（防止修复把收紧方向一起削掉）：
    //    例外 `rm *`=deny 时 `sudo rm -rf /etc` 必须 deny —— 这正是 54 那条既有漏洞的修法，
    //    与 54c（`kill *`=deny 拦 `sudo kill`）同一条纪律，只是换成半径组的命令。
    const denyOf = (cmd) => run(cmd, 'bash', {
      exceptions: ['rm *'], excAction: 'deny', destructive: 'allow', category: 'allow', platform: 'posix',
    })
    ok('★★ 54c4 收紧方向仍认前缀扩展：例外 rm *=deny 时 sudo rm -rf /etc 必须 deny',
      denyOf('sudo rm -rf /etc').action === 'deny' && denyOf('sudo rm -rf /etc').segments[0].source === 'exception',
      JSON.stringify({ action: denyOf('sudo rm -rf /etc').action, source: denyOf('sudo rm -rf /etc').segments[0].source }))
    // ③ 两个方向都必须与**无前缀**形态一致地分叉（同一例外、同一目标，只差前缀）：
    //    allow 例外：有前缀 ask、无前缀 allow；deny 例外：两者都 deny。
    //    这条把「按方向取 label」这句话写成可观察的形式，而不是只钉两个孤立结果。
    const pair = {
      allowPrefixed: allowOf('sudo rm -rf /etc').action, allowPlain: allowOf('rm -rf /etc').action,
      denyPrefixed: denyOf('sudo rm -rf /etc').action, denyPlain: denyOf('rm -rf /etc').action,
    }
    ok('★★ 54c5 按方向取 label：allow 例外下有/无前缀必须分叉，deny 例外下两者一致',
      pair.allowPrefixed !== 'allow' && pair.allowPlain === 'allow'
      && pair.denyPrefixed === 'deny' && pair.denyPlain === 'deny',
      JSON.stringify(pair))
  }
  // ── 54d：isDestructiveSegment 结论未变（扩展不引入新误判）──────────────────
  // 方向检验：新加的 label 是**前缀之后**的命令名，它们本来就在 DESTRUCTIVE_LABELS 里，
  // 故「非破坏性 → 破坏性」的翻转不可能发生。
  ok('★ 54d 前缀扩展不改变 isDestructiveSegment 的结论（方向检验）',
    isDestructiveSegment(decomposeCommand('sudo ls', 'bash').segments[0].words) === true
    && isDestructiveSegment(decomposeCommand('sudo kill 1234', 'bash').segments[0].words) === true
    && isDestructiveSegment(decomposeCommand('git status', 'bash').segments[0].words) === false
    && isDestructiveSegment(decomposeCommand('ls', 'bash').segments[0].words) === false)

  // ── 54s：带提权前缀时 `find -exec` / `-delete` 的**组档**不得丢失（发现 1，修法 A'）────
  // 根因：`segmentLabelsCore` 的 find 分支闸门原先写 `main !== 'find'`，而 `main` 是
  // `segmentLabel` 的结果 —— 段首是提权前缀时它就是**前缀名**，闸门随即早退，
  // `find -exec` / `-delete` 的载荷族 label 合成**整段被跳过** → `tierSetOf` 的组档
  // （proc / power / reg）判据完全依赖这份 label，于是三档**静默消失**（fail-open）。
  //
  // **判据是「与 sudo 对照同值」，不是 `action !== 'allow'`** —— 后者太弱：
  // 组档整个丢失时该命令仍会命中 `priv` 档，在 `priv=allow` 下确实会 allow，
  // 但只要配置里 priv 不是 allow 就恒真、写成空转也照样绿。同值判据才能照出「组档丢了」。
  // 对照取 `sudo <c>`（而不是裸 `<c>`）：两者都带提权前缀，档集**逐项**应当相同；
  // 拿裸形态当对照会把「priv 档」这个合法差异算成不一致（tiers 顺序也随档位而变）。
  // 覆盖三个组档 × 五个提权前缀，`-delete` 与 `-exec` 两种载荷族各一份。
  // ⚠️ `reg delete` 不在语料里：`find -exec` 分支合成的是**单词** label，故
  // `find . -exec reg delete …` 只得 `reg`（非 `reg delete`）、reg 组档不命中 ——
  // 那是既有口径（见 `segmentLabelsCore` 的说明），不是本修法要修的；reg 档用 `wmic`（单词 label）。
  {
    // `inside` 也设 deny：`-delete` 那一档的对照形态（`find ./build -delete`）判的就是 inside，
    // 若 inside=allow，组档丢失时「带前缀」与「裸跑」都会 allow，断言就照不出差别。
    const ds54s = { inside: 'deny', outside: 'ask', wide: 'ask', unknown: 'ask', proc: 'deny', power: 'deny', priv: 'allow', reg: 'deny' }
    const h54s = tierOpts('win32')
    h54s.destructive = () => ds54s
    h54s.category = () => ({ action: 'allow' })
    const prefixes54s = ['sudo ', 'su root ', 'runas /user:a ', 'doas ', 'pkexec ']
    const payloads54s = [
      ['proc', 'find . -exec kill {} ;'], ['proc', 'find . -exec pkill x {} ;'],
      ['power', 'find . -exec shutdown /s {} ;'], ['power', 'find . -exec poweroff {} ;'],
      ['reg', 'find . -exec wmic x {} ;'], ['inside', 'find ./build -delete'],
    ]
    const bad54s = []
    for (const [g, c] of payloads54s) {
      // 对照：`sudo` 形态**必须真的命中该组档**（否则「同值」可能是两边都缺这一档）
      const ref = tiersOf('sudo ' + c, 'bash', 'win32').join(',')
      if (ref.indexOf(g) === -1) bad54s.push(['对照本身未命中 ' + g, c, ref])
      for (const p of prefixes54s) {
        const got = tiersOf(p + c, 'bash', 'win32').join(',')
        if (got !== ref) bad54s.push([g, p + c, got, 'sudo=' + ref])
        if (assessCommand(p + c, 'bash', h54s).action === 'allow') bad54s.push([g, p + c, 'allow'])
      }
    }
    ok('★★ 54s 带提权前缀的 `find -exec` / `-delete` 必须与 `sudo` 对照**同值**（组档不得丢失：proc/power/reg × 5 前缀）',
      bad54s.length === 0
      // 对照（防空转）：不带前缀时组档真的在管这一段，且该配置下是 deny
      && payloads54s.every(([g, c]) => tiersOf(c, 'bash', 'win32').indexOf(g) !== -1
        && assessCommand(c, 'bash', h54s).action === 'deny')
      // 对照：组档确实**因修法而出现**（裸形态本来就有，带前缀后必须仍在）
      && tiersOf('sudo find ./build -delete', 'bash', 'win32').join(',') === 'inside,priv'
      && tiersOf('find ./build -delete', 'bash', 'win32').join(',') === 'inside',
      JSON.stringify({ bad54s,
        sudoFindExec: tiersOf('sudo find . -exec kill {} ;', 'bash', 'win32'),
        findExec: tiersOf('find . -exec kill {} ;', 'bash', 'win32'),
        sudoFindDelete: tiersOf('sudo find . -delete', 'bash', 'win32'),
        suFindExec: tiersOf('su root find . -exec kill {} ;', 'bash', 'win32'),
        runasFindExec: tiersOf('runas /user:a find . -exec kill {} ;', 'bash', 'win32'),
        doasFindExec: tiersOf('doas find . -exec kill {} ;', 'bash', 'win32'),
        sudoFindWmic: tiersOf('sudo find . -exec wmic x {} ;', 'bash', 'win32') }))
  }

  // ── 54t：多层提权前缀链的组档不得丢失（发现 2，修法 B）──────────────────────────
  // 根因：`pushHeadLabels` 的前缀扩展只做**一层**。第一个提权前缀之后跟的又是提权前缀时，
  // `privOperandSkip` 停在第二个前缀名上、`segmentLabel` 返回该前缀名 → labels 收束成
  // 前缀名 → 组档整体丢失 + deny 例外被绕过。判档侧本来是对的
  // （`commandHeadEnd(['sudo','su','root','kill','1234'])` 正确推进到 `kill`），
  // 分叉只出在 label 侧 —— 故判据同样取「与 `sudo` 对照同值」。
  {
    const ds54t = { inside: 'allow', outside: 'ask', wide: 'ask', unknown: 'ask', proc: 'deny', power: 'deny', priv: 'allow', reg: 'deny' }
    const h54t = tierOpts('win32')
    h54t.destructive = () => ds54t
    h54t.category = () => ({ action: 'allow' })
    // 链的第二层用**全部 6 个提权前缀**（含同名的 `sudo sudo` —— 那一支若把「已见过」
    // 当停止条件就会停在第一个 `sudo` 上，是本修法最容易写错的地方）。
    //
    // ── ⚠️ 必须含**裸** `su ` / `runas `（发现 2：这一格此前是缺口）──────────────────
    // 原先只列了**带操作数**的 `'su root '` / `'runas /user:a '`，而 `su` / `runas` 的
    // 截断**恰好只发生在第二层不带操作数时**：
    //     sudo su root kill 1234   → 操作数 `root` 之后是命令头元素 → privOperandSkip 跨过 → 链继续 ✅
    //     sudo su kill 1234        → `kill` **不是操作数**（isPrivOperandWord 对吃目标的命令名返回 false）
    //                                → 旧判据把「没跨过」读成「链到此为止」→ 链被截断 ❌
    // 故带操作数的语料**结构性照不出**这个缺陷（补进裸形态后 54t 立刻红 24 项）。
    const chain54t = ['sudo ', 'doas ', 'pkexec ', 'gsudo ', 'su root ', 'runas /user:a ', 'su ', 'runas ']
    const cmds54t = [
      ['proc', 'kill 1234'], ['proc', 'taskkill /im a.exe'],
      ['power', 'shutdown /s'], ['power', 'reboot'],
      ['reg', 'reg delete HKLM\\X /f'], ['reg', 'wmic x'],
    ]
    const bad54t = [], badLabels54t = []
    for (const [g, c] of cmds54t) {
      const ref = tiersOf('sudo ' + c, 'bash', 'win32').join(',')
      if (ref.indexOf(g) === -1) bad54t.push(['对照本身未命中 ' + g, c, ref])
      for (const p of chain54t) {
        const got = tiersOf('sudo ' + p + c, 'bash', 'win32').join(',')
        if (got !== ref) bad54t.push([g, 'sudo ' + p + c, got, 'sudo=' + ref])
        if (assessCommand('sudo ' + p + c, 'bash', h54t).action === 'allow') bad54t.push([g, 'sudo ' + p + c, 'allow'])
      }
      // label 侧的直接判据：链上每一层的名字都必须可见（第二层前缀名 + 真命令名）
      const lb = segmentLabels(decomposeCommand('sudo su root ' + c, 'bash').segments[0].words)
      if (lb.indexOf('su') === -1) badLabels54t.push(['su 不可见', c, lb])
      if (lb.indexOf(segmentLabels(decomposeCommand(c, 'bash').segments[0].words)[0]) === -1) badLabels54t.push(['真命令名不可见', c, lb])
    }
    // 端到端：例外是唯一 deny 来源时，多层链不得绕过用户显式写的 deny
    const excHooks54t = (pat) => {
      const h = tierOpts('win32')
      h.destructive = () => ({ action: 'allow' })
      h.category = () => ({ action: 'allow' })
      h.matchException = (segText, label) => (matchCommand(pat, segText) || (label && matchCommand(pat, label)))
        ? { action: 'deny', ruleId: 'e1' } : null
      return h
    }
    const bypassed54t = []
    for (const [pat, c] of [['kill *', 'kill 1234'], ['shutdown *', 'shutdown /s'], ['reg *', 'reg delete HKLM\\X /f']]) {
      for (const p of ['sudo ', 'sudo su root ', 'sudo doas ', 'doas su root ']) {
        if (assessCommand(p + c, 'bash', excHooks54t(pat)).action !== 'deny') bypassed54t.push([pat, p + c])
      }
    }
    ok('★★ 54t 多层提权前缀链必须与 `sudo` 对照同值（组档不得丢失：proc/power/reg × 6 个第二层前缀 × 2 个链长）',
      bad54t.length === 0 && badLabels54t.length === 0 && bypassed54t.length === 0
      // 对照（防空转）：`sudo` 对照本身命中该组档、且该配置下是 deny
      && cmds54t.every(([g, c]) => tiersOf('sudo ' + c, 'bash', 'win32').indexOf(g) !== -1
        && assessCommand('sudo ' + c, 'bash', h54t).action === 'deny')
      // 对照（防空转）：例外本身在**不带前缀**时确实生效
      && assessCommand('kill 1234', 'bash', excHooks54t('kill *')).action === 'deny',
      JSON.stringify({ bad54t, badLabels54t, bypassed54t,
        sudoSuKill: tiersOf('sudo su root kill 1234', 'bash', 'win32'),
        sudoKill: tiersOf('sudo kill 1234', 'bash', 'win32'),
        sudoSuKillAction: assessCommand('sudo su root kill 1234', 'bash', h54t).action,
        sudoSudoKill: tiersOf('sudo sudo kill 1234', 'bash', 'win32'),
        labels: segmentLabels(decomposeCommand('sudo su root kill 1234', 'bash').segments[0].words),
        sudoSuReg: tiersOf('sudo su root reg delete HKLM\\X /f', 'bash', 'win32') }))
  }

  // ── 54t2：`su` / `runas` 之后**首个词元非操作数**时链不得被截断（发现 1 的另一半）──
  // 根因：`pushHeadLabels` 的 `su` / `runas` 分支把「`privOperandSkip` 没跨过」当成
  // 「链到此为止」（`if (next <= at) return first`），而 `at` 位置**不是操作数**时它
  // 往往就是**命令头元素**本身（`su kill 1234` 的 `kill`、`su sudo kill 1234` 的 `sudo`、
  // `su env kill 1234` 的 `env`）—— `isPrivOperandWord` 对前缀 / wrapper / 语句关键字 /
  // 吃目标的命令名一律返回 false，正是这一支。误读的后果是**真命令名永不进 labels**，
  // 组档（proc / power / reg）整体丢失，方向 **fail-open**。
  //
  // 判据取「与 `sudo` 对照**同值**」，不是 `action !== 'allow'`（后者太弱：组档丢失时
  // 该命令仍命中 `priv` 档，只要配置里 priv 不是 allow 就恒真 —— 写成空转也照样绿）。
  // 对照取 `sudo <c>`：两者都带提权前缀，档集**逐项**应当相同。
  //
  // 覆盖第二层形态 = **全部 6 个提权前缀**（裸形态）+ **4 个 wrapper** + **1 个语句关键字**，
  // 且**每一个都同时覆盖「链首 `sudo`」与「链首裸 `su`」**——两种链首都走同一条
  // `PRIV_VALUE_IS_COMMAND` 分支，只钉一侧会漏掉另一侧的调用方。
  {
    const ds54t2 = { inside: 'allow', outside: 'ask', wide: 'ask', unknown: 'ask', proc: 'deny', power: 'deny', priv: 'allow', reg: 'deny' }
    const h54t2 = tierOpts('win32')
    h54t2.destructive = () => ds54t2
    h54t2.category = () => ({ action: 'allow' })
    // 第二层：`at` 位置上**不是操作数**的那些形态。刻意不含 `su root ` / `runas /user:a `
    // —— 那两种是**操作数**形态，走的是另一条分支（54t 已覆盖），混进来会掩盖本缺陷。
    // 每项 = [形态类别, 第二层写法, 该组的基准命令, 期望命中的组档]。
    // **组档必须由「基准命令」单独判**（而不是从第二层字符串猜）：`sudo kill 1234` 的
    // 首词是 `sudo`，按字符串前缀猜会把 proc 猜成 reg（本断言第一版正是这么写错的）。
    const second54t2 = [
      ['裸命令名', 'kill 1234', 'kill 1234', 'proc'],
      ['裸命令名', 'taskkill /im a.exe', 'taskkill /im a.exe', 'proc'],
      ['裸命令名', 'shutdown /s', 'shutdown /s', 'power'],
      ['裸命令名', 'reboot', 'reboot', 'power'],
      ['裸命令名', 'reg delete HKLM\\X /f', 'reg delete HKLM\\X /f', 'reg'],
      ['裸命令名', 'wmic x', 'wmic x', 'reg'],
      ['提权前缀', 'sudo kill 1234', 'kill 1234', 'proc'],
      ['提权前缀', 'doas kill 1234', 'kill 1234', 'proc'],
      ['提权前缀', 'pkexec kill 1234', 'kill 1234', 'proc'],
      ['提权前缀', 'gsudo kill 1234', 'kill 1234', 'proc'],
      ['提权前缀', 'su kill 1234', 'kill 1234', 'proc'],
      ['提权前缀', 'runas kill 1234', 'kill 1234', 'proc'],
      ['wrapper', 'env kill 1234', 'kill 1234', 'proc'],
      ['wrapper', 'nice kill 1234', 'kill 1234', 'proc'],
      ['wrapper', 'timeout 5 kill 1234', 'kill 1234', 'proc'],
      ['wrapper', 'nohup kill 1234', 'kill 1234', 'proc'],
      ['语句关键字', 'time kill 1234', 'kill 1234', 'proc'],
      ['语句关键字', '! kill 1234', 'kill 1234', 'proc'],
    ]
    // 链首：`sudo`（对照侧）与裸 `su` / 裸 `runas`（被测侧）。三者都落在
    // `PRIV_VALUE_IS_COMMAND[cur] === 1` 那一支里，只是 `cur` 不同。
    const heads54t2 = ['sudo ', 'su ', 'runas ']
    const bad54t2 = [], badLabels54t2 = []
    for (const [kind, c, base, group] of second54t2) {
      // 对照：链首 `sudo` + 同样的第二层。它必须真的命中组档（否则「同值」可能是两边都缺）
      const ref = tiersOf('sudo ' + c, 'bash', 'win32').join(',')
      if (ref.indexOf(group) === -1) bad54t2.push(['对照本身未命中 ' + group, 'sudo ' + c, ref])
      for (const h of heads54t2) {
        const got = tiersOf(h + c, 'bash', 'win32').join(',')
        if (got !== ref) bad54t2.push([kind, h + c, got, 'sudo=' + ref])
      }
      // label 侧的直接判据：真命令名必须在 labels 里可见（tiers 同值可能是巧合）
      const headName = segmentLabels(decomposeCommand(base, 'bash').segments[0].words)[0]
      for (const h of ['su ', 'runas ']) {
        const lb = segmentLabels(decomposeCommand(h + c, 'bash').segments[0].words)
        if (lb.indexOf(headName) === -1) badLabels54t2.push([kind, h + c, headName, lb])
      }
    }
    // 端到端：deny 例外是唯一 deny 来源时，本形态不得绕过用户显式写的 deny
    const excHooks54t2 = (pat) => {
      const h = tierOpts('win32')
      h.destructive = () => ({ action: 'allow' })
      h.category = () => ({ action: 'allow' })
      h.matchException = (segText, label) => (matchCommand(pat, segText) || (label && matchCommand(pat, label)))
        ? { action: 'deny', ruleId: 'e1' } : null
      return h
    }
    const bypassed54t2 = []
    for (const [pat, c] of [['kill *', 'kill 1234'], ['shutdown *', 'shutdown /s'], ['reg *', 'reg delete HKLM\\X /f']]) {
      for (const h of ['sudo ', 'su ', 'runas ', 'sudo su ', 'su sudo ', 'su env ']) {
        if (assessCommand(h + c, 'bash', excHooks54t2(pat)).action !== 'deny') bypassed54t2.push([pat, h + c])
      }
    }
    ok('★★ 54t2 `su`/`runas` 之后首个词元非操作数时链不得截断（组档不得丢失：3 链首 × 18 形态；tiers 与 sudo 对照同值 + 真命令名进 labels）',
      bad54t2.length === 0 && badLabels54t2.length === 0 && bypassed54t2.length === 0
      // 对照（防空转）：`sudo` 对照本身命中该组档、且该配置下是 deny
      && second54t2.every(([, c, , group]) => tiersOf('sudo ' + c, 'bash', 'win32').indexOf(group) !== -1
        && assessCommand('sudo ' + c, 'bash', h54t2).action === 'deny')
      // 对照（防空转）：例外本身在**不带前缀**时确实生效
      && assessCommand('kill 1234', 'bash', excHooks54t2('kill *')).action === 'deny'
      // 对照（**反向**，钉住「修法没有把操作数形态一起放宽」）：54b 的反例必须仍然成立 ——
      // `su root` 的 labels **不含** `root`、`su -c C:/Windows` 不含 `windows`
      && segmentLabels(decomposeCommand('su root', 'bash').segments[0].words).join(',') === 'su'
      && segmentLabels(decomposeCommand('su -c C:/Windows', 'bash').segments[0].words).join(',') === 'su'
      && segmentLabels(decomposeCommand('runas /user:admin cmd', 'bash').segments[0].words).join(',') === 'runas',
      JSON.stringify({ bad54t2, badLabels54t2, bypassed54t2,
        suKill: tiersOf('su kill 1234', 'bash', 'win32'),
        sudoKill: tiersOf('sudo kill 1234', 'bash', 'win32'),
        suSudoKill: tiersOf('su sudo kill 1234', 'bash', 'win32'),
        suEnvKill: tiersOf('su env kill 1234', 'bash', 'win32'),
        runasSudoKill: tiersOf('runas sudo kill 1234', 'bash', 'win32'),
        suTimeKill: tiersOf('su time kill 1234', 'bash', 'win32'),
        sudoSuKill: tiersOf('sudo su kill 1234', 'bash', 'win32'),
        suKillAction: assessCommand('su kill 1234', 'bash', h54t2).action,
        labelsSuSudoKill: segmentLabels(decomposeCommand('su sudo kill 1234', 'bash').segments[0].words),
        labelsSuRoot: segmentLabels(decomposeCommand('su root', 'bash').segments[0].words) }))
  }

  // ── 54u：授权方向不认**前缀之后合成**的载荷族 label（发现 1 的修法 3，方向不变量）──
  // 只放宽 find 闸门（不改 `widened`）会让 `sudo find / -delete` 得到
  // `['sudo','find','rm']`，而那个 `rm` 是**载荷族合成**的、不在 `widened` 里 →
  // 授权方向看得见它 → 用户为普通 `rm` 写下的 `rm *`=allow 被**提升**成
  // 「允许经 sudo 删盘根 / 系统目录」。这与 54c2 钉住的方向不变量是同一件事。
  // 实测（例外 `rm *`=allow、其余全 ask）：修法 3 缺失时 `sudo find / -delete` 与
  // `sudo find C:/Windows -delete` 由 **ask → allow**。
  {
    const allowOf54u = (cmd, platform) => run(cmd, 'bash', {
      exceptions: ['rm *'], excAction: 'allow', platform: platform || 'posix',
    })
    const bad54u = ['sudo find / -delete', 'sudo find C:/Windows -delete', 'su root find / -delete',
      'doas find /etc -delete', 'sudo find / -exec rm -rf {} +']
      .filter((c) => allowOf54u(c).action === 'allow')
    ok('★★ 54u 授权方向不认前缀之后合成的载荷族 label：例外 rm *=allow 时 sudo find … -delete 必须非 allow',
      bad54u.length === 0
      // 对照（防空转）：**不带**前缀的 `find -delete` 仍可被 `rm *`=allow 授权 ——
      // 那个 `rm` 是用户写下这条例外的真实意图（HEAD 亦然），证明上面不是「整条判据被关掉」
      && allowOf54u('find / -delete').action === 'allow'
      && allowOf54u('find / -delete').segments[0].source === 'exception'
      // 对照：收紧方向**仍须**认它（deny 例外照常命中合成 label，54c4 的同一条纪律）
      && run('sudo find / -delete', 'bash', { exceptions: ['rm *'], excAction: 'deny', platform: 'posix' }).action === 'deny'
      && run('sudo find / -exec rm -rf {} +', 'bash', { exceptions: ['rm *'], excAction: 'deny', platform: 'posix' }).action === 'deny',
      JSON.stringify({ bad54u,
        sudoFindRoot: allowOf54u('sudo find / -delete').action,
        findRoot: allowOf54u('find / -delete').action,
        sudoFindWin: allowOf54u('sudo find C:/Windows -delete').action }))
  }

  // ── 54w：`su`/`runas` 链上的 `diskpart /s <脚本>` 必须与 sudo/裸形态**同值** ─────────
  // 本批的 label 修复（`pushHeadLabels` 的「`at` 位置确实是操作数才终止」）让 `diskpart`
  // 这类**真命令名首次进入 labels**，于是 `isUnknownTierSegment` 的 `diskpart` + `/s` 支
  // **首次命中** —— posix 侧 74 条由 `outside` 改判 `unknown`（验证者语料 10560 段比较）。
  //
  // ⚠️ **该变化本身是「与 sudo / 裸形态对齐」，不是新分叉**（三方差分实测）：
  //     CUR `su diskpart /s script.txt` == PRE `sudo diskpart /s script.txt`
  //                                     == CUR `sudo diskpart /s script.txt` == `[unknown,priv]`
  //     裸形态 `diskpart /s script.txt` 的 PRE/CUR 均为 `[unknown]`
  // 即修掉的是 PRE 侧的**异类**（PRE 下只有 `su`/`runas` 链首把 `/s` 当路径目标判 outside）。
  // 本组钉的正是这条**对齐性质**：将来若有人把该族改回异类（或改得与 sudo 分叉），断言红灯。
  //
  // ── 为什么判据取「与 sudo 对照**同值**」而不是「不等于 outside」──────────────────────
  // 后者是**空转**判据：`unknown` 与 `outside` 是并列档，写「≠ outside」在把该族改成
  // `inside`（更松）时照样绿。同值判据还顺带钉住「半径档被 `unknown` **替换**而不是叠加」
  // （§5.6① 的「替换而非叠加」口径：`[outside,priv]` 与 `[unknown,priv]` 都是两档，
  //  只看档数照不出区别）。故逐字比较**整个 tiers 串**。
  //
  // ── ⚠️ 两平台都实测过，且**两个平台的既有值不同**（不得照抄平台假设）────────────────
  //     posix：PRE `[outside,priv]` → CUR `[unknown,priv]`（blast 仍是 `outside|/s`）
  //     win32：PRE `[priv]`         → CUR `[unknown,priv]`（blast 两侧恒 null）
  // 两侧**都**变成了 `[unknown,priv]`，故「与 sudo 同值」这条判据两平台同形；
  // 但 win32 侧没有 `outside→unknown` 这一步（那里本就判不出半径档），成因是
  // 「`diskpart` label 首次可见」这同一件事 —— 故下面按平台分别钉住 PRE 的旧值做**因果对照**。
  //
  // ── 方向随配置而变（**只记录现状，不做设计判断**）──────────────────────────────────
  // 该变化在 `outside=deny + unknown=ask` 下是 posix **deny→ask（放宽方向）**、
  // win32 侧**视 `priv` 档**（`priv=ask` 无变化、`priv=allow` 时 allow→ask）；
  // 在 `unknown=deny` 下 win32 是 allow→deny（收紧），posix 需**同时** `outside=allow`
  // 才是 allow→deny、否则 ask→deny；**八档缺省下无任何变化**。
  // （措辞按 27 配置 × 2 平台的穷举实测写，逐格见 54w2b 的方向表；此处曾省略条件而写成
  //  「win32 allow→ask」「两侧都是 allow→deny」—— 那两格在 54w2 的配置下实测不成立。）
  // ⚠️ 上面每句都**带条件**，不得再省：`priv=deny` 时 posix 那一格实测是 **deny→deny**
  // （`priv` 反超 `outside` 与 `unknown`），故「posix 恒 deny→ask」同样是过度概括。
  // 「`outside=deny + unknown=ask` 下是否接受这个 deny→ask」属**设计侧决策**
  // （记在项目外的设计笔记里）—— 本组只把现状**如实钉住**，不表态。
  {
    // 链首覆盖：裸 `su`/`runas`、带操作数、带选项值、多层链、wrapper、语句关键字。
    // 判据是「与 sudo 对照同值」，故对照侧统一取 `sudo diskpart /s script.txt`。
    const chain54w = [
      'su diskpart /s script.txt', 'runas diskpart /s script.txt',
      'su - diskpart /s script.txt', 'su -c diskpart /s script.txt', 'su --command diskpart /s script.txt',
      'runas -c diskpart /s script.txt', 'runas /user:a diskpart /s script.txt',
      'su root diskpart /s script.txt', 'su - root diskpart /s script.txt',
      'sudo su diskpart /s script.txt', 'sudo runas diskpart /s script.txt',
      'doas su diskpart /s script.txt', 'pkexec runas diskpart /s script.txt',
      'su sudo diskpart /s script.txt', 'su env diskpart /s script.txt',
      'su time diskpart /s script.txt', 'su ! diskpart /s script.txt',
      'su runas -c diskpart /s script.txt', 'runas su root diskpart /s script.txt',
      // 开关大小写：`/S` 走 `hasScriptFlag` 的 `toLowerCase()`，必须与 `/s` 同结论
      'su diskpart /S script.txt', 'runas diskpart -s script.txt',
    ]
    const bad54w = [], badBlast54w = []
    for (const platform of ['posix', 'win32']) {
      const ref = tiersOf('sudo diskpart /s script.txt', 'bash', platform).join(',')
      const bare = tiersOf('diskpart /s script.txt', 'bash', platform).join(',')
      // 对照（防空转）：对照侧本身必须真的命中 `unknown`，否则「同值」可能两边都缺这一档
      if (ref.indexOf('unknown') === -1) bad54w.push(['对照本身未命中 unknown', platform, ref])
      for (const c of chain54w) {
        const got = tiersOf(c, 'bash', platform).join(',')
        if (got !== ref) bad54w.push([platform, c, got, 'sudo=' + ref])
      }
      // 对齐的另一半：**裸形态 = sudo 对照去掉 `priv`**（不是「裸形态也带 priv」）
      const refSet = ref.split(',').filter(Boolean)
      const bareSet = bare.split(',').filter(Boolean)
      const extra = refSet.filter((x) => bareSet.indexOf(x) === -1)
      if (extra.length !== 1 || extra[0] !== 'priv') bad54w.push(['裸形态 ≠ sudo 去掉 priv', platform, bare, ref])
      // 半径档被 **替换** 而非叠加：`outside` 与 `unknown` 不得同时出现（§5.6① 口径）
      for (const c of ['diskpart /s script.txt', 'sudo diskpart /s script.txt', 'su diskpart /s script.txt']) {
        const t = tiersOf(c, 'bash', platform)
        if (t.indexOf('unknown') !== -1 && t.indexOf('outside') !== -1) bad54w.push(['unknown 与 outside 同时出现', platform, c, t.join(',')])
      }
      // 因果对照：`diskpart` 的 label 必须真的**可见**（这正是本批修复的收益）
      const lb = segmentLabels(decomposeCommand('su diskpart /s script.txt', 'bash').segments[0].words)
      if (lb.indexOf('diskpart') === -1) bad54w.push(['diskpart 未进 labels', platform, lb.join(',')])
      // 对照（防空转）：**不带** `/s` 的 `diskpart` 走的是另一条支（BARE 形态判据），
      // 不得被本组顺手改掉 —— `diskpart /?` 有实参 → 走半径档（不是 unknown）
      const q = tiersOf('diskpart /?', 'bash', platform).join(',')
      if (q.indexOf('unknown') !== -1) bad54w.push(['diskpart /? 被误判 unknown', platform, q])
      // blast 侧不得因本修法而丢：`/s` 那一条的 blast 与修法前同值（posix `outside|/s`、win32 null）
      const b = blastOf('su diskpart /s script.txt', 'bash', platform)
      const bRef = blastOf('sudo diskpart /s script.txt', 'bash', platform)
      if (b !== bRef) badBlast54w.push([platform, b, 'sudo=' + bRef])
    }
    ok('★★ 54w `su`/`runas` 链上的 `diskpart /s <脚本>` 的 tiers 必须与 sudo 对照**同值**（对齐性质；posix 74 条 outside→unknown 的钉桩）',
      bad54w.length === 0 && badBlast54w.length === 0
      // 对照（防空转）：逐条钉住**实测值**，两平台不同（不得照抄平台假设）——
      // 这是 54w 的核心：`[unknown,priv]` 这个值本身必须被钉死，
      // 否则把该族整体改成别的档（如 `[inside,priv]`）时「与 sudo 同值」可能仍然成立
      && tiersOf('su diskpart /s script.txt', 'bash', 'posix').join(',') === 'unknown,priv'
      && tiersOf('sudo diskpart /s script.txt', 'bash', 'posix').join(',') === 'unknown,priv'
      && tiersOf('diskpart /s script.txt', 'bash', 'posix').join(',') === 'unknown'
      && tiersOf('su diskpart /s script.txt', 'bash', 'win32').join(',') === 'unknown,priv'
      && tiersOf('sudo diskpart /s script.txt', 'bash', 'win32').join(',') === 'unknown,priv'
      && tiersOf('diskpart /s script.txt', 'bash', 'win32').join(',') === 'unknown'
      // 对照（防空转）：**两平台的既有值确实不同** —— posix 侧 blast 判得出（`outside|/s`）、
      // win32 侧恒 null。少了这条，「两平台同形」可能被误当成「两平台本来就一样」而掩盖平台差异
      && blastOf('su diskpart /s script.txt', 'bash', 'posix') === 'outside'
      && blastOf('su diskpart /s script.txt', 'bash', 'win32') === null
      // 对照（防空转）：`/s` 支的闸门确实由**脚本开关**开（不是「只要叫 diskpart 就 unknown」）——
      // `diskpart /?` 与 `parted /dev/sda` 有真目标 → 仍走半径档
      && tiersOf('diskpart /?', 'bash', 'posix').join(',') === 'wide'
      && tiersOf('parted /dev/sda', 'bash', 'posix').join(',') === 'wide'
      && tiersOf('su parted /dev/sda', 'bash', 'posix').join(',') === 'wide,priv',
      JSON.stringify({ bad54w, badBlast54w,
        posixSu: tiersOf('su diskpart /s script.txt', 'bash', 'posix'),
        posixSudo: tiersOf('sudo diskpart /s script.txt', 'bash', 'posix'),
        posixBare: tiersOf('diskpart /s script.txt', 'bash', 'posix'),
        win32Su: tiersOf('su diskpart /s script.txt', 'bash', 'win32'),
        win32Sudo: tiersOf('sudo diskpart /s script.txt', 'bash', 'win32'),
        win32Bare: tiersOf('diskpart /s script.txt', 'bash', 'win32'),
        posixBlast: blastOf('su diskpart /s script.txt', 'bash', 'posix'),
        win32Blast: blastOf('su diskpart /s script.txt', 'bash', 'win32'),
        labelsSu: segmentLabels(decomposeCommand('su diskpart /s script.txt', 'bash').segments[0].words) }))
    // ── 54w2：方向随配置而变 —— **如实钉住现状**（不是「应当如此」）────────────────────
    // `outside=deny + unknown=ask` 下该族是 posix **deny→ask（放宽方向）**、
    // win32 侧**视 `priv` 档**（`priv=ask` 无变化、`priv=allow` 时 allow→ask）；
    // `unknown=deny` 下 win32 是 allow→deny（收紧），posix 需**同时** `outside=allow`
    // 才是 allow→deny、否则 ask→deny；八档缺省下**无任何变化**。
    //
    // ⚠️ **上面每一格都带条件，不能把条件省掉** —— 此处曾写成「win32 allow→ask」与
    // 「两侧都是 allow→deny」，而 54w2 的 `outsideDeny` 用的是 `priv:'ask'`、
    // `unknownDeny` 用的是 `outside:'ask'`：那两格实测分别是 **ask→ask（无变化）** 与
    // **ask→deny**，即旧措辞隐含了「win32 需 priv=allow」「posix 还需 outside=allow」
    // 这两个注释里没写的额外条件。穷举实测（27 配置 × 2 平台）见下面 54w2b 的方向表。
    // 同理「posix 恒 deny→ask」也是过度概括：`priv=deny` 那一格实测是 **deny→deny**。
    //
    // 这是**设计侧决策项**（记在项目外的设计笔记里），本组只记录现状，
    // 以便将来设计侧拍板时「改了没有」一眼可见 —— 故不写成「必须 deny」这类期望值。
    const mkH54w = (platform, ds) => {
      const h = tierOpts(platform)
      h.destructive = () => ds
      h.category = () => ({ action: 'allow' })
      h.matchException = () => null
      return h
    }
    const outsideDeny = { inside: 'allow', outside: 'deny', wide: 'ask', unknown: 'ask', proc: 'ask', power: 'ask', priv: 'ask', reg: 'ask' }
    const unknownDeny = { inside: 'allow', outside: 'ask', wide: 'ask', unknown: 'deny', proc: 'ask', power: 'ask', priv: 'allow', reg: 'ask' }
    const def8 = { inside: 'allow', outside: 'ask', wide: 'ask', unknown: 'ask', proc: 'ask', power: 'ask', priv: 'ask', reg: 'ask' }
    const act54w = (c, platform, ds) => assessCommand(c, 'bash', mkH54w(platform, ds)).action
    ok('★ 54w2 `diskpart /s` 族的方向随配置而变（记录现状）：outside=deny+unknown=ask → ask；unknown=deny → deny；八档缺省无变化',
      // outside=deny + unknown=ask：posix 侧 PRE 是 deny（outside 命中）、CUR 是 ask（unknown 命中）
      act54w('su diskpart /s script.txt', 'posix', outsideDeny) === 'ask'
      && act54w('sudo diskpart /s script.txt', 'posix', outsideDeny) === 'ask'
      && act54w('diskpart /s script.txt', 'posix', outsideDeny) === 'ask'
      // unknown=deny：收紧方向 —— 该族全部 deny（且与 sudo/裸一致）
      && act54w('su diskpart /s script.txt', 'posix', unknownDeny) === 'deny'
      && act54w('sudo diskpart /s script.txt', 'posix', unknownDeny) === 'deny'
      && act54w('diskpart /s script.txt', 'posix', unknownDeny) === 'deny'
      // 八档缺省：无变化（PRE/CUR 同为 ask）—— 这条钉住「不是所有配置都被这次对齐影响」
      && act54w('su diskpart /s script.txt', 'posix', def8) === 'ask'
      && act54w('sudo diskpart /s script.txt', 'posix', def8) === 'ask'
      && act54w('diskpart /s script.txt', 'posix', def8) === 'ask'
      // win32 侧同判据（既有值不同，故同样逐条钉）
      && act54w('su diskpart /s script.txt', 'win32', outsideDeny) === 'ask'
      && act54w('su diskpart /s script.txt', 'win32', unknownDeny) === 'deny'
      && act54w('su diskpart /s script.txt', 'win32', def8) === 'ask'
      // 对照（防空转）：**不带** `/s` 的 `diskpart /?` 在 outside=deny 下仍是 deny
      // （它走半径档 wide/… 而非 unknown）—— 证明上面测的确实是 `/s` 那一支
      && act54w('diskpart /?', 'posix', outsideDeny) !== 'allow',
      JSON.stringify({
        posixOutsideDeny: act54w('su diskpart /s script.txt', 'posix', outsideDeny),
        posixUnknownDeny: act54w('su diskpart /s script.txt', 'posix', unknownDeny),
        posixDefault: act54w('su diskpart /s script.txt', 'posix', def8),
        win32OutsideDeny: act54w('su diskpart /s script.txt', 'win32', outsideDeny),
        win32UnknownDeny: act54w('su diskpart /s script.txt', 'win32', unknownDeny),
        win32Default: act54w('su diskpart /s script.txt', 'win32', def8),
        dpQuestion: act54w('diskpart /?', 'posix', outsideDeny) }))

    // ── 54w2b：方向表**逐格**钉住（PRE→CUR，每格带条件）──────────────────────────────
    // 上面那条注释一度把方向写成「win32 allow→ask」与「`unknown=deny` 下两侧都是
    // allow→deny」—— 两句都**省略了条件**：54w2 的 `outsideDeny` 用的是 `priv:'ask'`、
    // `unknownDeny` 用的是 `outside:'ask'`，故那两格实测分别是 **ask→ask（无变化）**
    // 与 **ask→deny**。旧措辞隐含了「win32 需 `priv=allow`」「posix 还需 `outside=allow`」
    // 这两个注释里没写的额外条件，方向被误读成「win32 侧也在收紧」。
    //
    // 根因：PRE 的档位集合**两平台不同**（posix `[outside,priv]`、win32 `[priv]`），
    // 于是「被替换掉的半径档原来有没有在管这一段」不同 —— posix 侧动作由
    // `outside` vs `unknown` 的相对严格度决定，win32 侧则**由 `priv` 顶上来决定**
    // （`priv` 比 `unknown` 松才看得出收紧）。
    //
    // PRE 侧**不手抄动作表**：用 PRE 的档位集合字面量 + `strictestTierAction` 推导。
    // 它与真实 PRE 模块（把 `pushHeadLabels` 的「`at` 位置确实是操作数才终止」那一圈
    // 修复回退掉）在 27 配置 × 2 平台 = **54 格**上逐格对拍、**零不一致**，故是忠实的
    // PRE 复现。这样钉住的是「PRE 档位集合 + 取最严」这条**机制**，而不是一张会腐烂的
    // 动作表：日后有人把 CUR 的档位集合改掉（例如 `unknown` 不再**替换** `outside`
    // 而是与之**叠加**），下面的 CUR 列立刻红灯。
    const PRE_TIERS_54w2 = { posix: ['outside', 'priv'], win32: ['priv'] }
    const pre54w = (platform, ds) => strictestTierAction(ds, PRE_TIERS_54w2[platform])
    const RANK_54w2 = { allow: 0, ask: 1, deny: 2 }
    const outsideDenyPrivAllow = Object.assign({}, outsideDeny, { priv: 'allow' })
    const outsideDenyPrivDeny = Object.assign({}, outsideDeny, { priv: 'deny' })
    const unknownDenyPrivAsk = Object.assign({}, unknownDeny, { priv: 'ask' })
    const unknownDenyOutsideAllow = Object.assign({}, unknownDeny, { outside: 'allow' })
    const unknownDenyOutsideDeny = Object.assign({}, unknownDeny, { outside: 'deny' })
    // [平台, 配置, 配置名, PRE 期望, CUR 期望] —— 每一格都是**带条件**的实测值
    const dirTable54w2 = [
      // `outside=deny + unknown=ask`：posix 放宽（deny 来自 outside、ask 来自 unknown）
      ['posix', outsideDeny, 'outside=deny+unknown=ask+priv=ask', 'deny', 'ask'],
      ['posix', outsideDenyPrivAllow, 'outside=deny+unknown=ask+priv=allow', 'deny', 'ask'],
      // `priv=deny` 反超 → 无变化（这一格是「posix 恒 deny→ask」这条**过度概括**的反例）
      ['posix', outsideDenyPrivDeny, 'outside=deny+unknown=ask+priv=deny', 'deny', 'deny'],
      // win32：PRE 只有 priv，故动作由 priv 决定 —— `priv=ask` 无变化、`priv=allow` 才收紧
      ['win32', outsideDeny, 'outside=deny+unknown=ask+priv=ask', 'ask', 'ask'],
      ['win32', outsideDenyPrivAllow, 'outside=deny+unknown=ask+priv=allow', 'allow', 'ask'],
      // `unknown=deny`：win32 侧它比 priv 的任一档都严 → 一律收紧
      ['win32', unknownDeny, 'unknown=deny+priv=allow', 'allow', 'deny'],
      ['win32', unknownDenyPrivAsk, 'unknown=deny+priv=ask', 'ask', 'deny'],
      // posix：还要看 `outside` —— **只有** `outside=allow` 才是 allow→deny
      ['posix', unknownDenyOutsideAllow, 'unknown=deny+outside=allow', 'allow', 'deny'],
      ['posix', unknownDeny, 'unknown=deny+outside=ask', 'ask', 'deny'],
      ['posix', unknownDenyOutsideDeny, 'unknown=deny+outside=deny', 'deny', 'deny'],
      // 八档缺省：两平台均无变化（钉住「不是所有配置都被这次对齐影响」）
      ['posix', def8, '八档缺省', 'ask', 'ask'],
      ['win32', def8, '八档缺省', 'ask', 'ask'],
    ]
    const pair54w2 = ([plat, ds]) => [pre54w(plat, ds), act54w('su diskpart /s script.txt', plat, ds)]
    const badDir54w2 = dirTable54w2
      .filter(([plat, ds, , pre, cur]) => { const [p, c] = pair54w2([plat, ds]); return p !== pre || c !== cur })
      // ⚠️ 解构**必须**把 `ds` 取出来（第二个位置）—— 这里曾经写成 `([plat, , name])`，
      // 而回调体里用的是 `pair54w2([plat, ds])`：`ds` 在该作用域根本不存在，于是**失败路径**
      // 抛 `ReferenceError: ds is not defined`，而不是把断言标红。`badDir54w2` 为空（绿路径）
      // 时 `.map` 回调不执行，故三套件全绿照不出；一旦 54w2b 检测到任何一格不符，
      // 测试进程在 `ok(...)` 之前**崩溃** → `FAIL (…)` 汇总不打印、**54w2b 之后的全部断言
      // （55 / 55b / 56a / 56b / 56c）整体不执行**（验证者实测变异 M3：`crashed:true`、
      // `reportedFails:0`、`summaryPrinted:false`）。与 4488 行同形即为修法。
      .map(([plat, ds, name]) => plat + ' ' + name + ' ' + pair54w2([plat, ds]).join('→'))
    const forms54w2 = dirTable54w2.map(pair54w2)
    ok('★★ 54w2b 方向表逐格钉住（PRE→CUR，每格带条件）：posix `outside=deny+unknown=ask` 放宽、win32 视 `priv`；`unknown=deny` 两侧收紧但 posix 需 `outside=allow` 才是 allow→deny',
      badDir54w2.length === 0
      // 对照（防空转）：表里必须**同时**含「放宽」「收紧」「无变化」三种形态 ——
      // 少了这条，「逐格相等」在整表退化成同一个值时仍会绿（旧措辞正是那样错的）
      && forms54w2.some(([a, b]) => RANK_54w2[a] > RANK_54w2[b])
      && forms54w2.some(([a, b]) => RANK_54w2[a] < RANK_54w2[b])
      && forms54w2.some(([a, b]) => a === b)
      // 对照（防空转）：PRE 档位集合两平台**不同** —— 这是「变化形态随平台变」的根因；
      // 两平台若相同，上面「win32 视 priv / posix 看 outside」这层措辞就没有依据
      && PRE_TIERS_54w2.posix.join(',') !== PRE_TIERS_54w2.win32.join(','),
      JSON.stringify({ badDir54w2,
        table: dirTable54w2.map(([plat, ds, name]) => plat + ' ' + name + ' ' + pair54w2([plat, ds]).join('→')) }))
  }


  // ── 55：tiers 固定顺序 ─────────────────────────────────────────────────────
  // 「按严格度排序」是错的：严格度取决于用户配置，而配置是变的 ——
  // 同一份代码在三个用户那里给出三种顺序，测试无法写稳定断言。
  ok('★ 55 tiers 固定顺序（与用户配置无关）：sudo kill 1234 → [proc,priv]',
    tiersOf('sudo kill 1234', 'bash', 'posix').join(',') === 'proc,priv'
    && tiersOf('sudo shutdown -h now', 'bash', 'posix').join(',') === 'power,priv'
    && tiersOf('sudo reg delete HKLM\\X /f', 'pwsh', 'win32').join(',') === 'priv,reg',
    JSON.stringify({ kill: tiersOf('sudo kill 1234', 'bash', 'posix'), shutdown: tiersOf('sudo shutdown -h now', 'bash', 'posix'), reg: tiersOf('sudo reg delete HKLM\\X /f', 'pwsh', 'win32') }))
  // ── 55b：TIER_ORDER 覆盖全部 8 档 ──────────────────────────────────────────
  // 新增档位忘了加排序键 → 排序结果不确定（undefined 参与减法得 NaN）。
  ok('★ 55b TIER_ORDER 覆盖全部 8 档（新增档位忘了加排序键 → 断言红灯）',
    TIERS.length === 8 && TIERS.every((t) => TIER_ORDER.indexOf(t) !== -1),
    JSON.stringify({ tiers: TIERS, order: TIER_ORDER }))

  // ── 56：cmd 风格变量短路 + 平台门控（两条相关修复的回归护栏）───────────────
  // 这三条钉的是**同一处判据的三个变异方向**，每一条都实测过「只有对应变异会让它变红」
  // （变异在仓库外副本上做，真实源码未动）：
  //   ① 删掉平台门控 `o.platform !== 'posix' &&`      → 56b 变红（posix 文件名被误判读不出）
  //   ② 门控反转成 `o.platform === 'win32' &&`        → 56c 变红（平台未知时 fail-open）
  //   ③ 整条短路换成 `if (false) return null`         → 56a 变红（%USERPROFILE% 回到 inside）
  // ①③ 都属可用性/安全性回归，② 最隐蔽：它只在「平台未知」这一条路径上反转失败方向。
  // 命令统一用 `bash` 方言 + 显式平台：段级判档只看 `opts.platform`（方言只影响分段，
  // 而 `%USERPROFILE%` 在两种方言下都是单个词元）。
  {
    const tWin = tiersOf('rm -rf %USERPROFILE%', 'bash', 'win32')
    // ★★ 被堵掉的洞：`%USERPROFILE%` 展开后是**用户家目录**，而本模块不做求值，
    //    拿字面量去判「工作区内还是外」会得 inside（=宣称无害）→ 默认配置下静默放行。
    //    正确行为是返回 null 由段级汇总改判 unknown（与 `$TARGET` 同一条契约）。
    ok('★★ 56a win32：cmd 变量 %USERPROFILE% → unknown 而非 inside（钉住安全修复不被回退）',
      tWin && tWin.indexOf('unknown') !== -1 && tWin.indexOf('inside') === -1
      && blastOf('rm -rf %USERPROFILE%', 'bash', 'win32') === 'unknown',
      JSON.stringify({ t: tWin, b: blastOf('rm -rf %USERPROFILE%', 'bash', 'win32') }))
    // ★★ 平台门控的反面：`%` 在 POSIX 上不是变量语法，`a%b%c` 就是普通文件名。
    //    漏掉门控会让这一族工作区内文件名由 inside 改判 unknown（allow → ask），
    //    是「把合法路径误判成读不出」的可用性回归。
    ok('★★ 56b posix：普通文件名 a%b%c 仍判 inside（钉住平台门控不被回退，防可用性回归）',
      tiersOf('rm -rf a%b%c', 'bash', 'posix').join(',') === 'inside'
      && blastOf('rm -rf a%b%c', 'bash', 'posix') === null,
      JSON.stringify({ t: tiersOf('rm -rf a%b%c', 'bash', 'posix'), b: blastOf('rm -rf a%b%c', 'bash', 'posix') }))
    // ★★ 平台未知时必须**保留**短路（与 isSystemDir「未知时两张表都查」同向的 fail-safe）：
    //    宁可多问一次，不可把 `%USERPROFILE%` 放回 inside 档。门控若写成
    //    `o.platform === 'win32'`，平台未知就落回 inside —— fail-safe 反转成 fail-open。
    //
    //    这里**不能**走上面的 tiersOf：它的 tierOpts 是 `platform: platform || 'win32'`，
    //    传 undefined 会被兜成 win32，于是那个变异照样命中短路、断言恒绿（空转）。
    //    故直接调真实链路，且 opts **不带 platform 键** —— 与宿主 shellPlatform() 抛错时
    //    返回 undefined 的形态一致（index.js 的 `catch { return undefined }`）。
    const d56 = decomposeCommand('rm -rf %USERPROFILE%', 'bash')
    const w56 = d56.ok && d56.segments.length ? d56.segments[0].words : null
    const o56 = tierOpts()
    delete o56.platform
    const b56 = w56 ? blastRadiusOfSegment(w56, o56) : null
    const t56 = w56 ? tierSetOf({ words: w56, blast: b56 }, segmentLabels(w56), o56) : []
    ok('★★ 56c 平台未知：%USERPROFILE% 仍非 inside（钉住 fail-safe 方向，不得反转成 fail-open）',
      w56 !== null && b56 !== null && b56.level === 'unknown'
      && t56.indexOf('inside') === -1 && t56.indexOf('unknown') !== -1,
      JSON.stringify({ hasPlatformKey: Object.prototype.hasOwnProperty.call(o56, 'platform'), w: w56, b: b56 && b56.level, t: t56 }))
  }

  // ── 57：组档映射（GROUP_OF_LABEL / groupTiersOf）────────────────────────────
  // 为什么直接断言 groupTiersOf 而**不是**删掉它的导入：它是 `tierSetOf` 的第 ② 步
  // （`for (const t of groupTiersOf(list)) add(t)`），此前只经由 `tierSetOf` 被**间接**
  // 覆盖 —— 那给出「组档映射已被直接覆盖」的假信号，而它的两处行为（多组命中 + 去重 +
  // 未知 label 忽略）在间接路径上看不出来：`tierSetOf` 里组档与半径档、priv 位置判据
  // 混在一起，任一处出错都可能被另一处掩盖（例如组档去重失效时，`add()` 的去重会兜住）。
  // 删除导入则等于把这条判据的唯一直接观测点也去掉。
  //
  // 返回顺序按**命中次序**（不是 TIER_ORDER）—— 排序是 `tierSetOf` 的职责（它按
  // TIER_RANK 排），本函数只负责「选出哪些档」，故这里断言的是集合与顺序保持。
  ok('★ 57 groupTiersOf：多组命中、去重、未知 label 忽略（组档映射的直接观测点）',
    groupTiersOf(['kill', 'taskkill']).join(',') === 'proc'
    && groupTiersOf(['sudo', 'kill']).join(',') === 'priv,proc'
    && groupTiersOf(['kill', 'kill', 'shutdown']).join(',') === 'proc,power'
    && groupTiersOf(['rm', 'reg delete', 'wmic']).join(',') === 'reg'
    && groupTiersOf(['ls', 'git status', '']).length === 0
    && groupTiersOf(null).length === 0
    && groupTiersOf(['KILL ']).join(',') === 'proc',
    JSON.stringify({
      multi: groupTiersOf(['sudo', 'kill']), dup: groupTiersOf(['kill', 'kill', 'shutdown']),
      none: groupTiersOf(['ls', '']), nul: groupTiersOf(null), case: groupTiersOf(['KILL ']),
    }))

  // ── 58：整行读不懂时的半径侧档位（`wide` ∪ `unknown`，§7.2）─────────────────
  // 这条路径**没有词元**，半径档判不出来 —— 但「判不出来」不等于「不存在」。
  // 曾经回落成单元素 `['unknown']`，理由是 BLAST_ORDER 里 unknown 比 wide 严重；
  // 那是**严重度序**，而用户配置的是**动作**，两者不同构（本文件 TIER_ORDER 的注释
  // 自己就写着「顺序不代表严重度，真正决定动作的是用户配置 + 取最严」）。
  //
  // 三条断言各钉一个方向（每条都实测过：去掉对应的并入就会变红）：
  //   ① wide=deny + unknown=allow → heredoc 形态必须仍是 deny
  //   ② 半径侧在**组档命中**时也必须参与 —— 否则「命中组档」反而比不命中更松：
  //      priv=allow 时 `sudo rm -rf /` 是 ask（段级 wide+priv），而加个 heredoc 曾变 allow
  //   ③ 不得回落到 `inside`（那是唯一跟随大分类的档，大分类常态 allow）
  {
    const mkDs = (over) => Object.assign(
      { inside: 'allow', outside: 'ask', wide: 'ask', unknown: 'ask', proc: 'ask', power: 'ask', priv: 'ask', reg: 'ask' }, over)
    const dOf = (cmd, ds) => assessCommand(cmd, 'bash', Object.assign(hooks({ category: 'allow' }), { destructive: () => ds }))
    const wideDeny = mkDs({ wide: 'deny', unknown: 'allow' })
    const unreadable = ['rm -rf C:/Windows <<EOF\nbody\nEOF', 'rm -rf C:/Windows >', 'rm -rf /etc "unclosed', 'rm -rf /etc &&']
    const bad1 = unreadable.filter((c) => dOf(c, wideDeny).action !== 'deny')
    ok('★★ 58a wide=deny+unknown=allow：整行读不懂的破坏性命令仍是 deny（wide 不得被单取 unknown 绕过）',
      bad1.length === 0, JSON.stringify(bad1.map((c) => c.replace(/\n/g, '\\n') + '=' + dOf(c, wideDeny).action)))
    // 对照组：不带读不懂构造时本来就是 deny（说明 58a 的差异确实来自那条路径）
    ok('★ 58a2 对照：同一命令不带读不懂构造时也是 deny',
      dOf('rm -rf C:/Windows', wideDeny).action === 'deny', dOf('rm -rf C:/Windows', wideDeny).action)
    // ② 的判据要**只**由半径侧决定，故把四个组档全设为 allow、半径侧保持 ask：
    //    这样 `kill 1234`（不带读不懂构造）走段级 proc 档 → allow，
    //    而加了 heredoc 后若半径侧不参与，就会**保持 allow** —— 正是要拦的那个回归。
    const groupAllow = mkDs({ proc: 'allow', power: 'allow', priv: 'allow', reg: 'allow' })
    const grp = ['sudo rm -rf / <<EOF\nbody\nEOF', 'sudo rm -rf / >', 'sudo rm -rf / "unclosed',
      'kill 1234 <<EOF\nbody\nEOF', 'shutdown <<EOF\nbody\nEOF', 'reg delete HKLM\\X /f <<EOF\nbody\nEOF']
    const bad2 = grp.filter((c) => dOf(c, groupAllow).action === 'allow')
    ok('★★ 58b 组档全 allow + 半径侧 ask：命中组档的破坏性命令加读不懂构造后必须收紧（半径侧一并参与取最严）',
      bad2.length === 0, JSON.stringify(bad2.map((c) => c.replace(/\n/g, '\\n') + '=' + dOf(c, groupAllow).action)))
    // 对照组：不带读不懂构造时**就是** allow（说明 58b 的差异确实来自那条路径，不是断言写错）
    ok('★ 58b2 对照：同一批命令不带读不懂构造时是 allow（组档 allow 生效）',
      ['sudo ls', 'kill 1234', 'shutdown', 'reg delete HKLM\\X /f'].every((c) => dOf(c, groupAllow).action === 'allow'),
      JSON.stringify(['sudo ls', 'kill 1234', 'shutdown', 'reg delete HKLM\\X /f'].map((c) => c + '=' + dOf(c, groupAllow).action)))
    // ★ 设计文档 §3.3 的不变量：提权设为 allow 后 `sudo rm -rf /` 仍 ask（被 wide 压过）
    ok('★ 58c §3.3 不变量：priv=allow 时 sudo rm -rf / 仍非 allow（段级 wide 压过 priv）',
      dOf('sudo rm -rf /', mkDs({ priv: 'allow' })).action === 'ask',
      dOf('sudo rm -rf /', mkDs({ priv: 'allow' })).action)
    // ★ 对称性：并入不得**凭空多出更严的档** —— 八档全 allow 的用户仍应 allow
    const allAllow = mkDs({ wide: 'allow', unknown: 'allow' })
    ok('★ 58d 八档全 allow 时整行读不懂仍是 allow（并入 wide/unknown 只是「取最严」，不是无条件收紧）',
      dOf('rm -rf C:/Windows <<EOF\nbody\nEOF', allAllow).action === 'allow',
      dOf('rm -rf C:/Windows <<EOF\nbody\nEOF', allAllow).action)
    // ── ★★ 58e：`inside` 档也必须并入整行读不懂分支的档位集合 ──────────────────────
    // 该分支此前只并入 `wide` + `unknown`，**漏了 `inside`** —— 而 `inside` 正是八档里
    // 管「区内破坏性操作」的那一档。后果：用户把「工作区内」显式设为「拒绝」后，
    // 同一命令**加一个 heredoc / 未闭合引号 / 悬空重定向即降级**：
    //     `rm -rf ./build`            → deny（段级 inside 档）
    //     `rm -rf ./build <<EOF…EOF`  → ask（wide=unknown=ask）/ **allow**（wide=unknown=allow）
    // 该分支自己的注释写着「一个读不出目标的破坏性命令**既可能落在区内**、也可能落在大范围，
    // 两档都该参与取最严」—— 实现只并了后两档，与自己的论证不一致。
    //
    // ⚠️ **只补 `inside`，不得顺手补 `outside`**：`outside` 是「工作区外」这一**具体**档，
    // 而这条路径上「读不出目标」的语义是「可能区内、可能大范围」，不是「确定在区外」。
    // 实测补 outside 会让 58d（八档全 allow）变红 —— 那正是「凭空多出一个更严的档」。
    const insideDeny = mkDs({ inside: 'deny', wide: 'ask', unknown: 'ask' })
    const insideDeny2 = mkDs({ inside: 'deny', wide: 'allow', unknown: 'allow' })
    const unreadableForms = ['rm -rf ./build <<EOF\nbody\nEOF', 'rm -rf ./build >', 'rm -rf ./build "unclosed', 'rm -rf ./build &&']
    const plainInside = 'rm -rf ./build'
    ok('★★ 58e inside=deny 时整行读不懂的**区内**破坏性命令不得降级（wide/unknown 两档为 ask 与 allow 两种配置下都必须是 deny）',
      // ① wide=unknown=ask：读不懂形态必须与不带构造的形态同值（都是 deny）
      unreadableForms.every((c) => dOf(c, insideDeny).action === 'deny'
        && dOf(c, insideDeny).action === dOf(plainInside, insideDeny).action)
      // ② wide=unknown=allow：这正是原缺陷最严重的一格（deny → allow）
      && unreadableForms.every((c) => dOf(c, insideDeny2).action === 'deny'
        && dOf(c, insideDeny2).action === dOf(plainInside, insideDeny2).action),
      JSON.stringify({ ask: unreadableForms.map((c) => dOf(c, insideDeny).action), allow: unreadableForms.map((c) => dOf(c, insideDeny2).action), plain: dOf(plainInside, insideDeny).action }))
    // 对照（防空转）：`wide` / `unknown` 侧本来就是 deny 的格仍必须 deny（证明这条路径在起作用）
    ok('★ 58e2 对照：wide=deny 时读不懂形态仍是 deny（这条路径的既有行为未被本次改动削弱）',
      dOf('rm -rf ./build <<EOF\nbody\nEOF', mkDs({ wide: 'deny', unknown: 'allow' })).action === 'deny',
      dOf('rm -rf ./build <<EOF\nbody\nEOF', mkDs({ wide: 'deny', unknown: 'allow' })).action)
    // 对照（防空转）：`outside` **不得**被并入 —— 八档全 allow 的用户仍应 allow（58d 的加强版：
    // 只补 inside 时该格是 allow；补了 outside 就会红）
    ok('★ 58e3 对照：inside=allow + wide/unknown=allow 时读不懂形态仍是 allow（补 inside 不得变成无条件收紧，也不得并入 outside）',
      dOf('rm -rf ./build <<EOF\nbody\nEOF', mkDs({ inside: 'allow', wide: 'allow', unknown: 'allow' })).action === 'allow',
      dOf('rm -rf ./build <<EOF\nbody\nEOF', mkDs({ inside: 'allow', wide: 'allow', unknown: 'allow' })).action)
  }
  // ── 54x：`commandHeadEndFull` 的早退判据必须是「**确实吃到命令名**」（发现 5）──────────
  // 根因：早退原写 `if (end > 0) return end`，假设「`commandHeadEnd` 返回 >0 ⇒ 它已吃掉
  // 前缀链 + 命令名」。该假设对 `su` / `runas`（`PRIV_VALUE_IS_COMMAND`）**不成立** ——
  // 它们只吃前缀名就停（`commandHeadEnd(['su','time','diskpart'])` = **1**，关键字 `time`
  // 既不是前缀也不是破坏性命令，② 分支被 `PRIV_VALUE_IS_COMMAND` 挡住）；
  // 对 `sudo` 也不成立 —— 它会把**语句关键字**当命令名吃掉
  // （`commandHeadEnd(['sudo','time','diskpart'])` = **2**）。
  // 于是 `<前缀><关键字><BARE>` 与 `<前缀><关键字><wrapper><BARE>` 两族里，
  // 关键字之后的真命令名落进 `hasNoOperand` 的词元循环被当成**非选项实参** →
  // 该段不归 `unknown` → 落半径档 `inside` → 大分类 mode=allow 时**静默放行**
  // （`diskpart` / `parted` 裸跑会阻塞等 stdin，DSH 非交互环境下该次调用直接挂住）。
  //
  // 判据取「与**裸跑形态同值**」而不是 `action !== 'allow'`：后者太弱 ——
  // `priv=allow` 时带前缀形态本来就命中 `priv` 档，写成空转也照样绿。
  // 对照取**去掉前缀与关键字之后**的裸跑形态（`diskpart`），那是本档唯一的权威值。
  //
  // 覆盖：**全表** `STATEMENT_KEYWORDS`（33 个）× 5 个提权前缀 × 11 个 wrapper/关键字夹层
  // × 3 个 `BARE_INTERACTIVE`，且**两族都测**（`<前缀><关键字><BARE>` 与
  // `<前缀><关键字><wrapper><BARE>`）。按全表穷举而不是抽样：日后往关键字表里加一个名字
  // 就多一条静默漏报，而抽样照不出来（与 54p 同纪律）。
  //
  // ⚠️ 本组只断言 `tiers`（形态判据的产物），**不断言 blast** —— `commandHeadEndFull`
  // 只被 `hasNoOperand` 消费，它不参与 `blastRadiusOfSegment` 的位置跳过（那里用的是
  // `commandHeadEnd`）。实测 29382 条「段 × 平台」差分：`blast` 变化 **0** 条。
  {
    const kwNames54x = Object.keys(STATEMENT_KEYWORDS)
    // `{` / `}` 是 bash 的**分组符**，词法器把它们当分隔符（`su time { diskpart` 直接无段），
    // 与 54p 同一处词法限制。排除它们并断言排除数 ≤ 2（防日后新增同类名字被误当放过）。
    const LEX54x = ['{', '}']
    const WR54x = ['env', 'timeout 5', 'nice', 'nohup', 'setsid', 'stdbuf', 'ionice', 'command', 'exec', 'xargs']
    const PRE54x = ['sudo ', 'su root ', 'runas /user:a ', 'doas ', 'pkexec ']
    const BARE54x = Object.keys(BARE_INTERACTIVE)
    // 对照（防空转）：裸跑形态本身必须归 `unknown`（否则「同值」可能是两边都缺这一档）
    const bareTiers54x = {}
    for (const b of BARE54x) bareTiers54x[b] = tiersOf(b, 'bash', 'win32').join(',')
    // ⚠️ 比对的对照取 `sudo <BARE>` 而**不是**裸 `<BARE>`：带前缀的形态合法地多出 `priv` 档
    // （提权名本身就在 `DESTRUCTIVE_LABELS` 里，§9.4），拿裸形态当对照会把这一档合法差异
    // 算成不一致 —— 与 54s 里「对照取 `sudo <c>` 而不是裸 `<c>`」是同一条纪律。
    const refTiers54x = {}
    for (const b of BARE54x) refTiers54x[b] = tiersOf('sudo ' + b, 'bash', 'win32').join(',')
    const bad54x = [], badBare54x = [], badRef54x = []
    let n54x = 0
    for (const b of BARE54x) {
      if (bareTiers54x[b].indexOf('unknown') === -1) badBare54x.push([b, bareTiers54x[b]])
      // 对照本身必须真的带上 `priv` 与 `unknown` 两档（否则「同值」可能是两边都缺）
      if (refTiers54x[b].indexOf('unknown') === -1 || refTiers54x[b].indexOf('priv') === -1) badRef54x.push([b, refTiers54x[b]])
    }
    for (const kw of kwNames54x) {
      if (LEX54x.indexOf(kw) !== -1) continue
      for (const p of PRE54x) {
        for (const b of BARE54x) {
          // 族 ①：<前缀><关键字><BARE>
          const c1 = p + kw + ' ' + b
          const t1 = tiersOf(c1, 'bash', 'win32')
          n54x += 1
          if (!t1 || t1.join(',') !== refTiers54x[b]) bad54x.push([c1, t1 ? t1.join(',') : 'null', refTiers54x[b]])
          // 族 ②：<前缀><关键字><wrapper><BARE>
          for (const wr of WR54x) {
            const c2 = p + kw + ' ' + wr + ' ' + b
            const t2 = tiersOf(c2, 'bash', 'win32')
            n54x += 1
            if (!t2 || t2.join(',') !== refTiers54x[b]) bad54x.push([c2, t2 ? t2.join(',') : 'null', refTiers54x[b]])
          }
        }
      }
    }
    // 端到端：`unknown=deny` 下这些形态必须**非 allow**（其余档全 allow —— 这样「非 allow」
    // 只可能来自 `unknown`，即本档的闸门确实生效）。对照：裸跑形态同样是 deny。
    const ds54x = { inside: 'allow', outside: 'allow', wide: 'allow', unknown: 'deny', proc: 'allow', power: 'allow', priv: 'allow', reg: 'allow' }
    const h54x = tierOpts('win32')
    h54x.destructive = () => ds54x
    h54x.category = () => ({ action: 'allow' })
    h54x.matchException = () => null
    const e2e54x = []
    for (const kw of ['time', '!', 'then', 'do']) {
      for (const p of PRE54x) {
        for (const b of BARE54x) {
          const c1 = p + kw + ' ' + b
          if (assessCommand(c1, 'bash', h54x).action === 'allow') e2e54x.push(c1)
          for (const wr of ['env', 'nohup', 'timeout 5']) {
            const c2 = p + kw + ' ' + wr + ' ' + b
            if (assessCommand(c2, 'bash', h54x).action === 'allow') e2e54x.push(c2)
          }
        }
      }
    }
    ok('★★ 54x `<前缀><关键字><BARE>` 与 `<前缀><关键字><wrapper><BARE>` 必须与 `sudo <BARE>` 同值（发现 5：早退判据「返回 >0」不等于「吃到命令名」）',
      bad54x.length === 0 && badBare54x.length === 0 && badRef54x.length === 0 && e2e54x.length === 0
      // 对照（防空转）：三档语料真的被遍历到了（族 ① + 族 ② 的叉乘）
      && n54x === (kwNames54x.length - LEX54x.length) * PRE54x.length * BARE54x.length * (1 + WR54x.length)
      // 对照（防空转）：**被修的那一族确实只有带前缀时才出问题** ——
      // 裸 `<关键字><wrapper><BARE>`（无前缀）本来就判对，故本组的差异全部来自前缀侧
      && tiersOf('time env diskpart', 'bash', 'win32').join(',') === bareTiers54x.diskpart
      && tiersOf('env diskpart', 'bash', 'win32').join(',') === bareTiers54x.diskpart
      // 对照（防过度收紧）：**有实参**的形态不得被降级成 unknown（`parted /dev/sda` 一族，
      // 那是把已知的更严重结论换成更模糊的结论）—— 早退若被误改成「一律不早退」的贪婪版
      // 会在这里变红。
      && tiersOf('parted /dev/sda', 'bash', 'win32').join(',') === 'outside'
      && tiersOf('dd of=/dev/sda', 'bash', 'win32').join(',') === 'outside'
      && tiersOf('diskpart /s script.txt', 'bash', 'win32').join(',') === 'unknown'
      && tiersOf('sudo time parted /dev/sda', 'bash', 'win32').join(',') === 'outside,priv',
      JSON.stringify({ bad: bad54x.slice(0, 10), badBare: badBare54x, badRef: badRef54x, e2e: e2e54x.slice(0, 10), n54x,
        kwCount: kwNames54x.length, bare: bareTiers54x, ref: refTiers54x,
        sample: ['sudo time env diskpart', 'su time diskpart', 'doas ! env parted'].map((c) => [c, tiersOf(c, 'bash', 'win32')]),
        target: [tiersOf('parted /dev/sda', 'bash', 'win32'), tiersOf('sudo time parted /dev/sda', 'bash', 'win32')] }))
  }

  // ── 54z2：语句关键字**自身的选项**必须跨过再取命令名（发现 4）────────────────────
  // 根因：`segmentLabelFrom` 的关键字循环里，跳过关键字后**就地取下一个有效词元**当命令名，
  // 而没有先跨过**关键字自己的选项**（`time -p` 的 `-p`）。于是 `time -p rm -rf /tmp` 的
  // label 变成 `-p`（既不是命令名、也不在破坏性名单里）→ 半径档与组档**全丢**、
  // 破坏性子设置整个跳过。方向 **fail-open**：
  //     例外 `rm *`=deny 时，`rm -rf /data` → deny，而 `time -p rm -rf /data` → **allow**
  // 而 `sudo time -p kill 1234` 却正确（链尾走的是 `pushHeadLabels` 的推进循环，那里
  // 关键字分支已经用了 `skipPrefixArgs`）—— **同一语义两个结论**（不变量分叉）。
  //
  // ⚠️ 落点**必须**在关键字循环**内部、找命令名之前**：两种「在链尾重算」的写法都会让
  // F34–F37 与 L43h4 共 5 条断言变红（`if true; then rm -rf ~/.dsh; fi` 的 label 退化成 `-rf`）。
  //
  // 判据（三条，缺一不可）：
  //   ① **label 与无关键字形态逐字同值**（`time -p X` 与 `X` 不得分叉）——
  //      这正是本修法的作用面（`segmentLabelFrom`）；
  //   ② **组档（proc / power / reg / priv）与无关键字形态同值** —— 组档只由 label 决定，
  //      故它必须一并复原；用户例外 `rm *`=deny 也必须命中；
  //   ③ 回归对照：`if true; then …` / `case x in …` 一族的关键字推进**不得**被改坏 ——
  //      判据取「label 不得退化成 `-rf` 这类开关」+「动作仍是 deny」
  //      （F34–F37 已单独钉住动作，这里钉住退化信号本身）。
  //
  // ⚠️ **半径档（inside / outside / wide / unknown）不在判据内**，这是**刻意**的：
  //   它已由 **54z3** 覆盖 —— 本轮 M1/M2/M3 修复后 `time -p X` 的 `blast` 已与 `X` 同值
  //   （实测 POST `time -p rm -rf /tmp` = `outside|/tmp`，win32 与 posix 均非 null 且与
  //   `rm -rf /tmp` 逐字相同；修复前 win32 该格为 `null`），故本处只钉 label / 组档 /
  //   例外命中三项，半径档交给 54z3。
  {
    const kwOf54z2 = (c) => {
      const d = decomposeCommand(c, 'bash')
      if (!d.ok || !d.segments.length) return { labels: [], label: '', tiers: [] }
      const w = d.segments[0].words
      const o = tierOpts('win32')
      return {
        labels: segmentLabels(w),
        label: segmentLabel(w),
        tiers: tierSetOf({ words: w, blast: blastRadiusOfSegment(w, o) }, segmentLabels(w), o),
      }
    }
    // `time -p <cmd>` 与 `<cmd>` 的对照（`-p` 是 `time` 的选项，不是命令名）
    const pairs54z2 = [
      ['rm -rf /tmp', 'rm -rf /tmp'],
      ['rm -rf /data', 'rm -rf /data'],
      ['kill 1234', 'kill 1234'],
      ['shutdown /s', 'shutdown /s'],
      ['wmic x', 'wmic x'],
      ['reg delete HKLM\\X /f', 'reg delete HKLM\\X /f'],
      ['sudo rm -rf /tmp', 'sudo rm -rf /tmp'],
    ]
    const bad54z2 = []
    for (const [pfx, plain] of pairs54z2) {
      const a = kwOf54z2('time -p ' + pfx)
      const b = kwOf54z2(plain)
      // ① label 同值
      if (a.label !== b.label) bad54z2.push(['label', 'time -p ' + pfx, a.label, 'plain=' + b.label])
      // ② 组档同值（只比组档：半径档不在本判据内、由 54z3 覆盖，见上面的说明）
      const grpOf = (ts) => ts.filter((t) => ['proc', 'power', 'priv', 'reg'].indexOf(t) !== -1).join(',')
      if (grpOf(a.tiers) !== grpOf(b.tiers)) bad54z2.push(['组档', 'time -p ' + pfx, grpOf(a.tiers), 'plain=' + grpOf(b.tiers)])
      // ② 例外 deny 族必须命中（与无关键字形态同值）
      const eA = run('time -p ' + pfx, 'bash', { exceptions: ['rm *', 'kill *', 'shutdown *', 'wmic *', 'reg *'], excAction: 'deny', category: 'allow', destructive: 'ask' })
      const eB = run(plain, 'bash', { exceptions: ['rm *', 'kill *', 'shutdown *', 'wmic *', 'reg *'], excAction: 'deny', category: 'allow', destructive: 'ask' })
      if (eA.action !== eB.action) bad54z2.push(['例外 deny', 'time -p ' + pfx, eA.action, 'plain=' + eB.action])
    }
    // ③ 回归对照：关键字之后**直接**是命令名的一族不得被改坏。
    // 退化信号是 label 变成 `-rf` / `-p` 这类**开关**（两种「在链尾重算」的错误落点都会这样）
    // —— 故判据取「任一段的 label 不得以 `-` 开头」+「动作仍是 deny」。
    //
    // ⚠️ **不要求每个命令的 labels 里都出现 `rm`**：`case x in a) rm …;; esac` 的 `rm` 落在
    // **另一段**（`case x in a` 与 `rm -rf ~/.dsh` 是两段），只有 `if/for/while` 那一族才
    // 与 `rm` 同段。按「任一段」判会把合法的分段结构误判成退化（实测假红过）。
    const regress54z2 = [
      'if true; then rm -rf ~/.dsh; fi',
      'if [ -d x ]; then rm -rf ~/.dsh; fi',
      'case x in a) rm -rf ~/.dsh;; esac',
      'for i in a b; do rm -rf ~/.dsh; done',
      'while true; do rm -rf ~/.dsh; done',
      'time rm -rf ~/.dsh',
      'time -p rm -rf ~/.dsh',
      '! rm -rf ~/.dsh',
    ]
    const badRegress = regress54z2.filter((c) => {
      const r = run(c, 'bash', { category: 'allow', destructive: 'deny' })
      const d = decomposeCommand(c, 'bash')
      // 退化判据：任一段的**命令头 label** 以 `-` 开头（`-rf` / `-p`）即视为被改坏
      // ⚠️ 观测点是 `segmentLabel(s.words)`，不是 `s.label` —— `decomposeCommand` 的段
      //    只有 `op/text/words/writeTargets/readTargets/dynamic/opaque` 七键，**没有 `label`**
      //    （`label` 由 `assessCommand` 段级另算后挂上）。写 `s.label` 时该式恒为 `''`、
      //    恒 false ⇒ 判据空转（实测 CUR 基线 0/8，改用本观测点后仍 0/8、FINAL 亦 0/8）。
      const degraded = d.ok && d.segments.some((s) => segmentLabel(s.words).startsWith('-'))
      return r.action !== 'deny' || degraded
    })
    ok('★★ 54z2 语句关键字**自身的选项**必须跨过再取命令名（`time -p <cmd>` 的 label / 组档 / 例外命中与 `<cmd>` 逐字同值）',
      bad54z2.length === 0 && badRegress.length === 0
      // 对照（防空转）：`-p` 确实**不再**是 label，且真命令名可见
      && kwOf54z2('time -p rm -rf /tmp').label === 'rm'
      && kwOf54z2('time -p rm -rf /tmp').labels.indexOf('rm') !== -1
      && kwOf54z2('time -p kill 1234').tiers.indexOf('proc') !== -1
      // 对照（防空转）：不带关键字时本来就是对的（说明差异确实来自 `-p` 那一支）
      && kwOf54z2('rm -rf /tmp').label === 'rm',
      JSON.stringify({ bad54z2: bad54z2.slice(0, 8), badRegress, labelP: kwOf54z2('time -p rm -rf /tmp').label, tiersKill: kwOf54z2('time -p kill 1234').tiers }))
  }

  // ── 54z2B：**第 2 轮起**的关键字也必须跨过自身选项（`<语句关键字> <关键字选项> <命令>`）──
  // 54z2 的语料**只有 `time -p <cmd>`**，而它走的是 `segmentLabelFrom` **段首那一轮**
  // （`:775` 已修）⇒ 结构性照不出本族。真正的缺口在 `:781` 的「关键字继续跳过」分支：
  // 它此前只写 `idx = j`，**第 2 轮起** `head` 由内层 `found` 循环重新赋值时**不再**跨过
  // 新关键字的选项 —— `! time -p rm -rf ~/.dsh` 的 `-p` 占掉下一轮的位置，
  // `segmentLabelFrom` 返回 **`'-p'`** ⇒ `isDestructiveSegment = false` ⇒ 破坏性子设置
  // 整个跳过、半径档与组档全丢。
  //
  // 判据族其余成员对同形态**都正确**（实测 `['!','time','-p','rm','-rf','/tmp']`：
  // `headFull=4`、`headCommandNameOf='rm'`、`hasNoOperand=false`）⇒ **只有本函数未对齐**。
  //
  // ⚠️ **四种写法都必须进语料**（不能只用 `time -p` —— 它走段首那一轮、本来就对）：
  //    `!` / `then` / `if…then` / `while…do`，外加 `until…do` / `for…do` 两个同族对照。
  // ⚠️ 判据取**端到端动作**（`category=allow` + destructive 八档全 deny，等价存量
  //    `{action:'deny'}`）：「同一段文本只因前面多一个语句关键字就绕过用户显式写的『全拒』」
  //    正是本缺陷的可见面。实测修复前 `! time -p …` = **allow**（对照 `rm -rf ~/.dsh` = deny）。
  {
    const DSD54z2B = { inside: 'deny', outside: 'deny', wide: 'deny', unknown: 'deny', proc: 'deny', power: 'deny', priv: 'deny', reg: 'deny' }
    const run54z2B = (c, pl) => {
      const h = tierOpts(pl || 'win32')
      h.destructive = () => DSD54z2B
      h.category = () => ({ action: 'allow' })
      h.matchException = () => null
      return assessCommand(c, 'bash', h)
    }
    const KOPT54z2B = ['-p', '--pretty', '-a', '-v', '-x', '-n']
    const INNER54z2B = ['rm -rf /tmp', 'rm -rf ~/.dsh', 'kill 1234', 'parted /data', 'diskpart', 'shutdown /s', 'reg delete HKLM\\X /f']
    // 四种（+2 同族）写法：`[名字, (opt, inner) => [带关键字形态, 去关键字对照]]`
    const SHAPES54z2B = [
      ['!', (o, i) => ['! time ' + o + ' ' + i, i]],
      ['then', (o, i) => ['then time ' + o + ' ' + i, i]],
      ['if…then', (o, i) => ['if true; then time ' + o + ' ' + i + '; fi', i]],
      ['while…do', (o, i) => ['while true; do time ' + o + ' ' + i + '; done', i]],
      ['until…do', (o, i) => ['until true; do time ' + o + ' ' + i + '; done', i]],
      ['for…do', (o, i) => ['for x in a; do time ' + o + ' ' + i + '; done', i]],
    ]
    const bad54z2B = []
    let n54z2B = 0
    for (const [sn, fn] of SHAPES54z2B) {
      for (const o of KOPT54z2B) {
        for (const i of INNER54z2B) {
          const [a, b] = fn(o, i)
          for (const pl of ['win32', 'posix']) {
            n54z2B += 1
            const ra = run54z2B(a, pl), rb = run54z2B(b, pl)
            if (ra.action !== rb.action) {
              bad54z2B.push([sn, pl, a, ra.action, b, rb.action])
            }
          }
        }
      }
    }
    // ② label 退化信号：任一段的**命令头 label** 不得以 `-` 开头（`-p` / `-rf` 都是退化）
    //    ⚠️ 观测点**必须**是 `segmentLabel(s.words)`，不能写 `String(s.label || '')`：
    //    `decomposeCommand` 产出的段只有 `op/text/words/writeTargets/readTargets/dynamic/opaque`
    //    七个键，**没有 `label`** —— `label` 是 `assessCommand` 在段级另算后挂上去的。
    //    写成 `s.label` 时该式恒为 `''`、`.startsWith('-')` 恒 false，整条判据空转
    //    （实测 CUR 基线 0/252，改用本观测点 252/252；FINAL 上两者都是 0）。
    const degr54z2B = []
    for (const [sn, fn] of SHAPES54z2B) {
      for (const o of KOPT54z2B) {
        for (const i of INNER54z2B) {
          const [a] = fn(o, i)
          const d = decomposeCommand(a, 'bash')
          if (d.ok && d.segments.some((s) => segmentLabel(s.words).startsWith('-'))) {
            degr54z2B.push([sn, a, d.segments.map((s) => segmentLabel(s.words))])
          }
        }
      }
    }
    // ③ 对照（防空转）：去关键字形态本来就 deny（说明差异确实来自关键字那一轮）
    const sig54z2B = ['rm -rf ~/.dsh', 'kill 1234', 'parted /data', 'diskpart']
      .every((c) => run54z2B(c, 'win32').action === 'deny')
    // ④ 回归对照：`time -p <cmd>`（**段首那一轮**，54z2 已覆盖）不得被本修法改坏
    const label54z2B = (c) => {
      const d = decomposeCommand(c, 'bash')
      if (!d.ok || !d.segments.length) return ''
      return segmentLabel(d.segments[0].words)
    }
    const keep54z2B = ['time -p rm -rf ~/.dsh', 'time -p kill 1234', 'time -p diskpart']
      .every((c) => run54z2B(c, 'win32').action === 'deny')
      && label54z2B('time -p rm -rf /tmp') === 'rm'
    ok('★★ 54z2B `<语句关键字> <关键字选项> <命令>`（`!` / `then` / `if…then` / `while…do` / '
      + '`until…do` / `for…do` 六种写法）的动作必须与**去掉该关键字**的对照逐格同值'
      + ' —— 第 2 轮起的关键字同样要跨过自身选项',
      bad54z2B.length === 0 && degr54z2B.length === 0 && sig54z2B && keep54z2B
      // 覆盖面：6 写法 × 6 关键字选项 × 7 命令 × 2 平台
      && n54z2B === SHAPES54z2B.length * KOPT54z2B.length * INNER54z2B.length * 2,
      JSON.stringify({ bad54z2B: bad54z2B.slice(0, 8), degr54z2B: degr54z2B.slice(0, 4), n54z2B,
        sig54z2B, keep54z2B,
        labelBang: label54z2B('! time -p rm -rf /tmp'),
        labelThen: label54z2B('then time -p rm -rf /tmp'),
        actBang: run54z2B('! time -p rm -rf ~/.dsh', 'win32').action,
        actRef: run54z2B('rm -rf ~/.dsh', 'win32').action }))
  }

  // ── 54z3：`time -p <cmd>` 的**动作**必须与 `<cmd>` 逐格同值（含**半径档**）────────────
  // 54z2 明确把半径档排除在判据之外（其注释写着「半径档不在判据内，这是刻意的」），
  // 于是这条盲区无人覆盖：`time -p` 的 label 修好之后，破坏性段**首次进入档位判定**，
  // 而该形态的半径档恒为 `null` —— `null` 被 `radiusTierOf` 映射成 `inside`，
  // 即「**读不出目标**」被当成「**目标在区内**」。
  //
  // 根因在 `commandHeadEnd` 侧（不是 label 侧）：`headCommandNameOf` 的关键字分支
  // 只推一个词元，`-p` 于是当上「命令名」→ `isCmdStyleSwitch('/tmp', …, '-p')` 认不出
  // 命令域 → `/tmp` 被当 cmd 开关跳过 → 段级 blast 归 `null`。三处同源分支
  // （`headCommandNameOf` / `commandHeadEndFull` / `privOperandSkip`）都已按
  // `skipPrefixArgs` 跨过「关键字自身的选项」。
  //
  // 方向是 **fail-open**，且**加一个 `-p` 就把 ask 降成 allow** —— 与「畸形形态必须与
  // 规范形态同值」这条修复目标**直接冲突**。宿主可达配置（`command mode=ask` 默认 +
  // 破坏性子设置「区内」档显式 `allow`，其余七档按 `index.js:2041` 推导为 `ask`）下：
  //     rm -rf /tmp        → ask   （blast=outside|/tmp）
  //     time rm -rf /tmp   → ask   （同上）
  //     time -p rm -rf /tmp→ **allow**（blast=null → inside → 命中用户显式 allow 的 inside 档）
  // 同样放宽的还有 `time -p diskpart` / `time -p parted`（win32 + posix 均放宽）、
  // `time -p rm -rf /data`（win32）。
  //
  // 判据（三条，缺一不可）：
  //   ① **action 与无关键字形态逐字同值** —— 直接钉住用户可见后果，不是钉中间量；
  //   ② **tiers 全档同值**（含半径档 inside / outside / wide / unknown）——
  //      这是 54z2 刻意不覆盖的那一半；
  //   ③ 回归对照：`if true; then …` 一族的关键字推进不得被改坏。
  //
  // ⚠️ 语料必须**跨平台**（win32 + posix）且含 `diskpart` / `parted` 这类
  // **半径判据覆盖不到**的成员 —— 只测 `rm -rf /tmp` 会漏掉「unknown 档丢失」那一半。
  {
    const ds54z3 = { inside: 'allow', outside: 'ask', wide: 'ask', unknown: 'ask', proc: 'ask', power: 'ask', priv: 'ask', reg: 'ask' }
    const mkH54z3 = (platform, ds) => {
      const o = tierOpts(platform)
      return Object.assign(o, {
        destructive: () => ds, category: () => ({ action: 'ask' }), matchException: () => null,
      })
    }
    // 关键字自身的选项形态：**布尔型**（`skipPrefixArgs` 能跨）—— 带值型（`time -o <文件>`）
    // 需要额外的「关键字带值选项」表，属**另一处独立缺陷**，不在本断言范围内（如实记录）。
    const kwOpts54z3 = ['-p', '-p -a', '--', '-v', '-x']
    const kws54z3 = ['time', '!', 'then', 'if', 'for', 'while', 'do', 'foreach', 'switch']
    // ⚠️ 关键字选项之后**再跟一层 wrapper / 前缀**的形态必须单独覆盖（`time -p env diskpart`）：
    // 它走的是 `commandHeadEndFull` 的推进循环（`hasNoOperand` 的「按位置跳过命令头」），
    // 与 `time -p <cmd>` 直连形态**不是同一个落点** —— 实测只回退 `commandHeadEndFull`
    // 那一处时，直连形态仍全绿，只有这一族变红（`unknown` 丢失 → `inside` → allow）。
    const kws54z3Mid = ['env ', 'nohup ', 'timeout 5 ', 'xargs ', 'stdbuf -o0 ', 'sudo ', 'nice ']
    const wrappers54z3 = ['', 'sudo ', 'sudo -u root ', 'doas ', 'env FOO=1 ', 'nice ', 'timeout 5 ', 'nohup ', 'command ']
    const priv54z3 = ['su root ', 'runas /user:a ', 'su ', 'runas ']
    // 载荷：覆盖四种半径档（outside / wide / inside / unknown）+ 组档
    const payloads54z3 = [
      ['outside', 'rm -rf /tmp'], ['outside', 'rm -rf /data'],
      ['wide', 'rm -rf /'], ['wide', 'rm -rf C:/Windows'],
      ['inside', 'rm -rf ./build'],
      ['unknown', 'diskpart'], ['unknown', 'parted'], ['unknown', 'dd'],
      ['unknown', 'set-executionpolicy unrestricted'],
      ['proc', 'kill 1234'], ['power', 'shutdown /s'], ['reg', 'reg delete HKLM\\X /f'],
      ['radius', 'chmod 777 /etc/passwd'], ['radius', 'find / -delete'],
    ]
    const bad54z3 = []
    let n54z3 = 0
    for (const platform of ['win32', 'posix']) {
      for (const [g, pl] of payloads54z3) {
        for (const kw of kws54z3) {
          for (const o of kwOpts54z3) {
            for (const pf of wrappers54z3.concat(priv54z3)) {
              // ① action 同值：`<pf><kw> <opts> <载荷>` vs `<pf><载荷>`
              const h = mkH54z3(platform, ds54z3)
              const mal = pf + kw + ' ' + o + ' ' + pl
              const ref = pf + pl
              n54z3 += 1
              const aMal = assessCommand(mal, 'bash', h).action
              const aRef = assessCommand(ref, 'bash', h).action
              if (aMal !== aRef) bad54z3.push(['action', platform, g, mal, aMal, 'plain=' + aRef])
              // ② tiers 全档同值（含半径档）
              const tMal = tiersOf(mal, 'bash', platform)
              const tRef = tiersOf(ref, 'bash', platform)
              const kMal = tMal ? tMal.join(',') : 'null'
              const kRef = tRef ? tRef.join(',') : 'null'
              if (kMal !== kRef) bad54z3.push(['tiers', platform, g, mal, kMal, 'plain=' + kRef])
              // ③ 关键字选项之后**再跟一层 wrapper**（`time -p env <载荷>`）——
              //    与直连形态同判据（必须与 `<pf><载荷>` 同值）。对照口径：中间那层 wrapper
              //    是透明的，故规范形态取 `<pf><wrapper><载荷>`。
              for (const mid of kws54z3Mid) {
                const mal2 = pf + kw + ' ' + o + ' ' + mid + pl
                const ref2 = pf + mid + pl
                n54z3 += 1
                const aMal2 = assessCommand(mal2, 'bash', h).action
                const aRef2 = assessCommand(ref2, 'bash', h).action
                if (aMal2 !== aRef2) bad54z3.push(['action+mid', platform, g, mal2, aMal2, 'plain=' + aRef2])
                const tMal2 = tiersOf(mal2, 'bash', platform)
                const tRef2 = tiersOf(ref2, 'bash', platform)
                const kMal2 = tMal2 ? tMal2.join(',') : 'null'
                const kRef2 = tRef2 ? tRef2.join(',') : 'null'
                if (kMal2 !== kRef2) bad54z3.push(['tiers+mid', platform, g, mal2, kMal2, 'plain=' + kRef2])
              }
            }
          }
        }
      }
    }
    // ③ 回归对照：关键字之后**直接**是命令名的一族不得被改坏（label 不得退化成开关，动作仍是 deny）
    const regress54z3 = [
      'if true; then rm -rf ~/.dsh; fi', 'case x in a) rm -rf ~/.dsh;; esac',
      'for i in a b; do rm -rf ~/.dsh; done', 'while true; do rm -rf ~/.dsh; done',
      'time rm -rf ~/.dsh', 'time -p rm -rf ~/.dsh', '! rm -rf ~/.dsh',
    ]
    const badRegress54z3 = regress54z3.filter((c) => {
      const r = run(c, 'bash', { category: 'allow', destructive: 'deny' })
      const d = decomposeCommand(c, 'bash')
      // 退化判据同上：观测点是 `segmentLabel(s.words)`（段对象没有 `label` 键）
      const degraded = d.ok && d.segments.some((s) => segmentLabel(s.words).startsWith('-'))
      return r.action !== 'deny' || degraded
    })
    ok('★★ 54z3 `time -p <cmd>` 的 action 与 tiers（**含半径档**）必须与 `<cmd>` 逐格同值'
      + '（54z2 刻意排除了半径档，这条补上：`-p` 不得把 ask 降成 allow）',
      bad54z3.length === 0 && badRegress54z3.length === 0
      // 对照（防空转）：本断言钉的那一格确实**曾经**是放宽的（修复前 allow，规范形态 ask）
      && n54z3 === payloads54z3.length * kws54z3.length * kwOpts54z3.length
        * (wrappers54z3.length + priv54z3.length) * (1 + kws54z3Mid.length) * 2
      // 对照（防空转）：三个平台的半径档确实判得出来（不是「两边都是 null」的空比）
      && tiersOf('time -p rm -rf /tmp', 'bash', 'win32').join(',') === 'outside'
      && tiersOf('rm -rf /tmp', 'bash', 'win32').join(',') === 'outside'
      && tiersOf('time -p diskpart', 'bash', 'win32').join(',') === 'unknown'
      && tiersOf('diskpart', 'bash', 'win32').join(',') === 'unknown'
      && tiersOf('time -p rm -rf /', 'bash', 'win32').join(',') === 'wide'
      && tiersOf('time -p rm -rf ./build', 'bash', 'win32').join(',') === 'inside'
      // 对照（防空转）：**中间夹一层 wrapper** 那一族确实被判到（M2 落点的唯一观测点）——
      // `time -p env diskpart` 若退回 `inside` 说明 `commandHeadEndFull` 那一处没跨过 `-p`
      && tiersOf('time -p env diskpart', 'bash', 'win32').join(',') === 'unknown'
      && tiersOf('env diskpart', 'bash', 'win32').join(',') === 'unknown'
      && tiersOf('time -p nohup parted', 'bash', 'win32').join(',') === 'unknown'
      && tiersOf('time -p env diskpart', 'bash', 'posix').join(',') === 'unknown'
      // 对照（防空转）：**用户可见后果**那一格 —— 修复前 `time -p rm -rf /tmp` 是 allow
      && assessCommand('time -p rm -rf /tmp', 'bash', mkH54z3('win32', ds54z3)).action === 'ask'
      && assessCommand('rm -rf /tmp', 'bash', mkH54z3('win32', ds54z3)).action === 'ask'
      && assessCommand('time -p env diskpart', 'bash', mkH54z3('win32', ds54z3)).action === 'ask'
      && assessCommand('env diskpart', 'bash', mkH54z3('win32', ds54z3)).action === 'ask'
      // 对照（防过度收紧）：`time -p rm -rf ./build` 仍是 allow（区内，不得被误升成 ask）
      && assessCommand('time -p rm -rf ./build', 'bash', mkH54z3('win32', ds54z3)).action === 'allow',
      JSON.stringify({ bad54z3: bad54z3.slice(0, 10), badRegress54z3, n54z3,
        sample: ['time -p rm -rf /tmp', 'time -p diskpart', 'su root time -p rm -rf /tmp'].map((c) => [c, tiersOf(c, 'bash', 'win32')]) }))
  }

  // ── 54y：wrapper / 语句关键字夹在两层提权前缀之间时链不得截断（发现 6）─────────────
  // 根因：`pushHeadLabels` 的推进循环**只按 `PRIV_PREFIXES` 判「还要不要继续」**，
  // 遇到夹在两层提权前缀之间的 **wrapper** 直接 `break` —— 链被提前截断、真命令名永不进
  // labels → 组档（proc / power / reg）整体丢失、用户写的 deny 例外同样被绕过。
  // 方向 **fail-open**。判档侧（`commandHeadEnd` 的 ① 分支）本来就把 wrapper 与提权前缀
  // **同处置**、照常推进，故这是「label 侧与判档侧各持一份口径」的分叉。
  //
  // 设计文档 §5.3 的 `byHeadChain` 伪码（`blast-tier-plan.md:403-411`）原文即
  // 「是 `WRAPPERS` → 跳过它与其选项，**继续**」—— 实现只在 `commandHeadEnd` 一侧落实。
  //
  // ⚠️ 与 54t / 54t2 **不重复**（结构性照不出，实测）：54t 的语料 48 组合里含 wrapper 者
  // **0**、54t2 的 54 组合里「wrapper 之后又是提权前缀」者 **0** —— 两族都只覆盖
  // 「第二层直接是前缀」，夹一层 wrapper 的形态无人覆盖。覆盖面：8 链首 × 12 夹层
  // × 5 第二层前缀 = 480 组合中修复前 **360~420 条**丢失真命令名。
  //
  // ⚠️ 边界（**必须同时覆盖两类夹层**）：`timeout` 的**时长位置参数**由 `skipPrefixArgs`
  // 自己处理（`timeout 5 sudo kill`）、而 `time` 是**语句关键字**（不在 `WRAPPERS` 里，
  // 必须单独跨）—— 两者若只做一侧，另一侧仍会截断（实测：只扩 `WRAPPERS` 时
  // `sudo time sudo kill 1234` 仍是 `['sudo']`/`priv`/allow）。
  //
  // 判据取「与 `sudo <命令>` 对照**同值**」，不是 `action !== 'allow'`（后者太弱：
  // 组档丢失时该命令仍命中 `priv` 档，只要配置里 priv 不是 allow 就恒真 —— 空转也照样绿）。
  {
    const ds54y = { inside: 'allow', outside: 'ask', wide: 'ask', unknown: 'ask', proc: 'deny', power: 'deny', priv: 'allow', reg: 'deny' }
    const h54y = tierOpts('win32')
    h54y.destructive = () => ds54y
    h54y.category = () => ({ action: 'allow' })
    // 链首（第一层）与第二层前缀：都用**全部 6 个提权前缀**里的代表 + 同名重复。
    const head54y = ['sudo ', 'doas ', 'pkexec ', 'gsudo ', 'su root ', 'runas /user:a ', 'su ', 'runas ']
    // 夹层：wrapper 全部 11 个（含带值选项与 `timeout` 的时长位置参数）+ **语句关键字** 2 个。
    // `timeout 5` / `timeout -s KILL 5` 各一份：后者钉住「带值选项 + 时长参数」两层都要跳过。
    const mid54y = ['env ', 'env FOO=1 ', 'timeout 5 ', 'timeout -s KILL 5 ', 'nice ', 'nice -n 5 ',
      'nohup ', 'setsid ', 'stdbuf -o0 ', 'ionice ', 'command ', 'exec ', 'xargs ', 'time ', '! ']
    const cmds54y = [
      ['proc', 'kill 1234'], ['proc', 'taskkill /im a.exe'],
      ['power', 'shutdown /s'], ['power', 'reboot'],
      ['reg', 'reg delete HKLM\\X /f'], ['reg', 'wmic x'],
    ]
    const bad54y = [], badLabels54y = []
    let n54y = 0
    for (const [g, c] of cmds54y) {
      // 对照：`sudo <命令>`（不带夹层、不带第二层前缀）必须真的命中该组档
      const ref = tiersOf('sudo ' + c, 'bash', 'win32').join(',')
      if (ref.indexOf(g) === -1) bad54y.push(['对照本身未命中 ' + g, 'sudo ' + c, ref])
      const headName = segmentLabels(decomposeCommand(c, 'bash').segments[0].words)[0]
      for (const h1 of head54y) {
        for (const mid of mid54y) {
          for (const h2 of ['sudo ', 'doas ', 'pkexec ', 'su ', 'runas ']) {
            const cmd = h1 + mid + h2 + c
            n54y += 1
            const got = tiersOf(cmd, 'bash', 'win32').join(',')
            if (got !== ref) bad54y.push([g, cmd, got, 'sudo=' + ref])
            // label 侧的直接判据：真命令名必须在 labels 里可见（tiers 同值可能是巧合）
            const lb = segmentLabels(decomposeCommand(cmd, 'bash').segments[0].words)
            if (lb.indexOf(headName) === -1) badLabels54y.push([g, cmd, headName, lb.join(',')])
          }
        }
      }
    }
    // 端到端：deny 例外是唯一 deny 来源时，夹层链不得绕过用户显式写的 deny
    const excHooks54y = (pat) => {
      const h = tierOpts('win32')
      h.destructive = () => ({ action: 'allow' })
      h.category = () => ({ action: 'allow' })
      h.matchException = (segText, label) => (matchCommand(pat, segText) || (label && matchCommand(pat, label)))
        ? { action: 'deny', ruleId: 'e1' } : null
      return h
    }
    const bypassed54y = []
    for (const [pat, c] of [['kill *', 'kill 1234'], ['shutdown *', 'shutdown /s'], ['reg *', 'reg delete HKLM\\X /f']]) {
      for (const cmd of ['sudo time sudo ' + c, 'sudo nohup sudo ' + c, 'sudo env FOO=1 doas ' + c,
        'sudo timeout 5 sudo ' + c, 'sudo nice doas ' + c, 'sudo ! sudo ' + c]) {
        if (assessCommand(cmd, 'bash', excHooks54y(pat)).action !== 'deny') bypassed54y.push([pat, cmd])
      }
    }
    ok('★★ 54y wrapper / 语句关键字夹在两层提权前缀之间时链不得截断（发现 6：组档不得丢失；8 链首 × 15 夹层 × 5 第二层前缀 × 6 命令）',
      bad54y.length === 0 && badLabels54y.length === 0 && bypassed54y.length === 0
      // 对照（防空转）：语料真的被遍历到了
      && n54y === head54y.length * mid54y.length * 5 * cmds54y.length
      // 对照（防空转）：`sudo` 对照本身命中该组档、且该配置下是 deny
      && cmds54y.every(([g, c]) => tiersOf('sudo ' + c, 'bash', 'win32').indexOf(g) !== -1
        && assessCommand('sudo ' + c, 'bash', h54y).action === 'deny')
      // 对照（防空转）：例外本身在**不带前缀**时确实生效
      && assessCommand('kill 1234', 'bash', excHooks54y('kill *')).action === 'deny'
      // 对照（**反向**，钉住「修法没有把 54b / 54t2 的反例一起放宽」）：
      // 操作数本身仍不得变成 label（`su root` / `su -c C:/Windows` / `runas /user:admin cmd`）
      && segmentLabels(decomposeCommand('su root', 'bash').segments[0].words).join(',') === 'su'
      && segmentLabels(decomposeCommand('su -c C:/Windows', 'bash').segments[0].words).join(',') === 'su'
      && segmentLabels(decomposeCommand('runas /user:admin cmd', 'bash').segments[0].words).join(',') === 'runas'
      // 对照（防空转）：**夹层两侧的形态确实分叉过** —— 只扩 wrapper 而不跨关键字时，
      // `sudo time sudo kill 1234` 收束成 `['sudo']`（本组的主反例，见上面边界那段）
      && segmentLabels(decomposeCommand('sudo time sudo kill 1234', 'bash').segments[0].words).indexOf('kill') !== -1
      && segmentLabels(decomposeCommand('sudo timeout 5 sudo kill 1234', 'bash').segments[0].words).indexOf('kill') !== -1
      && segmentLabels(decomposeCommand('sudo nohup sudo kill 1234', 'bash').segments[0].words).indexOf('kill') !== -1
      && tiersOf('sudo time sudo kill 1234', 'bash', 'win32').join(',') === tiersOf('sudo kill 1234', 'bash', 'win32').join(','),
      JSON.stringify({ bad54y: bad54y.slice(0, 8), badLabels54y: badLabels54y.slice(0, 8), bypassed54y: bypassed54y.slice(0, 8), n54y,
        sudoKill: tiersOf('sudo kill 1234', 'bash', 'win32'),
        timeSudo: tiersOf('sudo time sudo kill 1234', 'bash', 'win32'),
        nohupSudo: tiersOf('sudo nohup sudo kill 1234', 'bash', 'win32'),
        timeoutSudo: tiersOf('sudo timeout 5 sudo kill 1234', 'bash', 'win32'),
        envDoasReg: tiersOf('sudo env FOO=1 doas reg delete HKLM\\X /f', 'bash', 'win32'),
        timeDoas: tiersOf('sudo time doas kill 1234', 'bash', 'win32') }))
  }
  // ── 54z：`find -exec` 载荷族里的**提权前缀链**必须推进（发现 1）────────────────────
  // 根因：`segmentLabelsCore` 的 `-exec` 载荷族**只取 `-exec` 之后的第一个词元**，
  // 不做前缀链推进 → 载荷里的**提权前缀**被当成命令名收下、真命令名永不进 labels：
  //     find . -exec kill {} ;          labels=['find','kill']  tiers=['proc']        → deny
  //     find . -exec sudo kill {} ;     labels=['find','sudo']  tiers=['priv']        → **allow**
  //     find . -exec env sudo kill {} ; labels=['find','sudo']  tiers=['priv']        → **allow**
  //     find . -execdir doas kill {} ;  labels=['find','doas']  tiers=['priv']        → **allow**
  //     find . -exec su root kill {} ;  labels=['find','su']    tiers=['priv']        → **allow**
  // 对照 `sudo find . -exec kill {} ;` 是 `['proc','priv']`/deny（54s 已修）。power / reg 同样。
  // **用户写的 deny 例外同样被绕过**（例外 `kill *`=deny 时 `find . -exec kill {} ;` 是 deny、
  // `find . -exec sudo kill {} ;` 是 allow）。方向 **fail-open**，触发需 §3.3 单独把 priv 设 allow。
  //
  // 判据取「与 `sudo <对照>` **同值**」（不是 `action !== 'allow'`：后者太弱 ——
  // 组档丢失时该命令仍命中 `priv` 档，只要配置里 priv 不是 allow 就恒真，写成空转也照样绿）。
  // 对照取 `sudo find . <flag> <载荷>`：两者都带提权前缀，档集**逐项**应当相同。
  //
  // 覆盖：4 个 `-exec` 族 flag × 三组档 × 5 个提权前缀 × {裸, 带 wrapper} × 6 载荷。
  // ⚠️ 对照的基准载荷取 `sudo <命令>`（不带 find）：那才是「同一个提权语义」的权威值。
  {
    const ds54z = { inside: 'deny', outside: 'ask', wide: 'ask', unknown: 'ask', proc: 'deny', power: 'deny', priv: 'allow', reg: 'deny' }
    const h54z = tierOpts('win32')
    h54z.destructive = () => ds54z
    h54z.category = () => ({ action: 'allow' })
    const flags54z = ['-exec', '-execdir', '-ok', '-okdir']
    const prefixes54z = ['sudo ', 'doas ', 'pkexec ', 'gsudo ', 'su root ', 'runas /user:a ', 'su ', 'runas ']
    const payloads54z = [
      ['proc', 'kill {} ;'], ['proc', 'pkill x {} ;'], ['proc', 'taskkill /im a.exe {} ;'],
      ['power', 'shutdown /s {} ;'], ['power', 'poweroff {} ;'], ['power', 'reboot {} ;'],
      ['reg', 'wmic x {} ;'],
      ['inside', 'rm -rf {} +'],
    ]
    const bad54z = [], badLabels54z = []
    let n54z = 0
    for (const [g, pl] of payloads54z) {
      // 基准命令（去掉 find 与 `-exec` 壳）——**label 侧**的权威值取自它。
      // ── ⚠️ 权威值 = **主路径 label 的最后一个单词**，不是首词、也不是整个 label ─────────
      // 载荷族合成的是**单个单词** label（54s 的既有口径），而主路径的 label 是
      // 「前缀链 + 真命令名」。故权威值 = 主路径 labels 的**最后一个**（取首词去路由器子命令）：
      //     `sudo kill 1234`      → `kill`   ✅（前缀链之后的真命令名）
      //     `su root git status`  → `su`     ✅（`privOperandSkip` 对**非吃目标**的命令名不跨，
      //                                        故主路径本身也收束成 `su` —— 54b/54d 的既有口径）
      //     `reg delete HKLM\X /f`→ `reg`    ✅（载荷族取**单词** label，不取路由器子命令）
      const base = pl.replace(/\s*\{\}\s*[;+]$/, '')
      const baseLabels = segmentLabels(decomposeCommand(base, 'bash').segments[0].words)
      const baseLabel = baseLabels.length ? String(baseLabels[baseLabels.length - 1]).split(' ')[0] : ''
      for (const fl of flags54z) {
        for (const p of prefixes54z) {
          for (const wr of ['', 'env ', 'timeout 5 ']) {
            // ── 对照取**同族的最小形态**（`sudo find . <flag> <载荷>`），不是 `sudo <载荷>` ──
            // 为什么不是 `sudo <载荷>`：`find` 自身的载荷族合成会额外带出档位
            // （实测 `sudo find . -exec kill {} ;` = `[wide,proc,priv]`，而 `sudo kill 1234`
            // = `[proc,priv]` —— `wide` 来自 find 的目标 `.` 被当作删除目标判档），
            // 那是 `find` 的既有行为、与本修法无关，混进对照会把合法差异算成不一致。
            // 本组的判据是「**载荷里的前缀**不影响档集」：对照侧把前缀留在最外层（`sudo find …`）、
            // 被测侧把前缀放进载荷（`find … -exec sudo …`），两者档集**逐项**应当相同。
            const ref = tiersOf('sudo find . ' + fl + ' ' + pl, 'bash', 'win32').join(',')
            if (g !== 'inside' && ref.indexOf(g) === -1) bad54z.push(['对照本身未命中 ' + g, 'sudo find . ' + fl + ' ' + pl, ref])
            const cmd = 'find . ' + fl + ' ' + wr + p + pl
            n54z += 1
            const got = tiersOf(cmd, 'bash', 'win32').join(',')
            if (got !== ref) bad54z.push([g, cmd, got, 'sudo=' + ref])
            // 反向对照（防空转）：**只把前缀从载荷挪到最外层**之外，本组还必须能区分
            // 「载荷里到底有没有那个真命令名」。判据取 labels 而不是 tiers —— tiers 会因为
            // 外层 `sudo` 之外的其他档位而掩盖差异（`find . -exec kill {} ;` 本来就命中 proc，
            // 与 find 无关）。故这里钉的是：**载荷里带前缀时，真命令名必须仍进 labels**。
            const lb0 = segmentLabels(decomposeCommand(cmd, 'bash').segments[0].words)
            if (lb0.indexOf(baseLabel) === -1) badLabels54z.push([g, cmd, baseLabel, lb0.join(',')])
          }
        }
      }
    }
    // 端到端：deny 例外是唯一 deny 来源时，本形态不得绕过用户显式写的 deny
    const excHooks54z = (pat) => {
      const h = tierOpts('win32')
      h.destructive = () => ({ action: 'allow' })
      h.category = () => ({ action: 'allow' })
      h.matchException = (segText, label) => (matchCommand(pat, segText) || (label && matchCommand(pat, label)))
        ? { action: 'deny', ruleId: 'e1' } : null
      return h
    }
    const bypassed54z = []
    // ⚠️ 例外模式与命令必须**配对**：`reg *` 只匹配 `reg …` 形态，而载荷族合成的是**单词**
    // label（`reg query HKLM\X` 的 label 是 `reg`）——`matchCommand('reg *', 'reg')` 为 false。
    // 故 reg 那一格用 `wmic *`（载荷 `wmic x` 的 label 就是 `wmic`），与 payloads54z 一致。
    for (const [pat, c] of [['kill *', 'kill {} ;'], ['shutdown *', 'shutdown /s {} ;'], ['wmic *', 'wmic x {} ;']]) {
      for (const cmd of ['find . -exec sudo ' + c, 'find . -exec env sudo ' + c, 'find . -execdir doas ' + c,
        'find . -exec su root ' + c, 'find . -exec timeout 5 sudo ' + c]) {
        if (assessCommand(cmd, 'bash', excHooks54z(pat)).action !== 'deny') bypassed54z.push([pat, cmd])
      }
    }
    // ⚠️ 授权方向不变量（发现 1 的修法 3，与 54u 同一件事）：载荷里**合成出的** label
    // 若因「载荷内部有前缀」才可见，就**不得**进授权面 —— 否则用户为普通 `rm` 写下的
    // `rm *`=allow 被提升成「允许经 find -exec sudo 删任意路径」。
    // 实测（例外 `rm *`=allow、其余全 ask）：漏掉这一条时 `find . -exec sudo rm -rf {} +`
    // 由 **ask → allow**（`sudo rm -rf /x` 是 ask，而它却 allow）。
    const allowOf54z = (cmd) => run(cmd, 'bash', { exceptions: ['rm *'], excAction: 'allow', platform: 'win32' })
    const badAllow54z = ['find . -exec sudo rm -rf {} +', 'find . -exec env sudo rm -rf {} +',
      'find . -execdir doas rm -rf {} +', 'find . -exec su root rm -rf {} +',
      'find . -exec timeout 5 sudo rm -rf {} +', 'find . -exec sudo rm -rf /etc {} +']
      .filter((c) => allowOf54z(c).action === 'allow')
    ok('★★ 54z `find -exec` 载荷族里的提权前缀链必须推进（发现 1：组档不得丢失 + 授权方向不得认合成 label）',
      bad54z.length === 0 && badLabels54z.length === 0 && bypassed54z.length === 0 && badAllow54z.length === 0
      // 对照（防空转）：语料真的被遍历到了
      && n54z === flags54z.length * prefixes54z.length * 3 * payloads54z.length
      // 对照（防空转）：`sudo find . -exec kill {} ;` 真的命中 proc 档、且该配置下是 deny
      && tiersOf('sudo find . -exec kill {} ;', 'bash', 'win32').indexOf('proc') !== -1
      && assessCommand('sudo find . -exec kill {} ;', 'bash', h54z).action === 'deny'
      // 对照（防空转）：例外本身在**不带前缀**时确实生效
      && assessCommand('kill 1234', 'bash', excHooks54z('kill *')).action === 'deny'
      // 对照（防空转）：**不带前缀**的 `find -exec rm` 仍可被 `rm *`=allow 授权 ——
      // 那个 `rm` 是用户写下这条例外的真实意图（HEAD 亦然），证明上面不是「整条判据被关掉」
      && allowOf54z('find . -exec rm -rf {} +').action === 'allow'
      && allowOf54z('find . -exec rm -rf {} +').segments[0].source === 'exception'
      // 对照：收紧方向**仍须**认它（deny 例外照常命中合成 label）
      && run('find . -exec sudo rm -rf {} +', 'bash', { exceptions: ['rm *'], excAction: 'deny', platform: 'win32' }).action === 'deny'
      // 对照（**反向**，钉住「操作数不得被当 label」—— 54b 的反例在载荷族里同样成立）：
      // `su root git status` 的载荷 label 是 `su`（前缀名），**不是** `root`
      && segmentLabels(decomposeCommand('find . -exec su root git status {} ;', 'bash').segments[0].words).indexOf('root') === -1
      && segmentLabels(decomposeCommand('find . -exec runas /user:a git status {} ;', 'bash').segments[0].words).indexOf('user:a') === -1
      // 对照（**既有口径**，54s 原文：该分支合成的是**单词** label，不是路由器子命令）——
      // 本修法只修「前缀链不推进」，不得顺手把 `reg delete` 的粒度也改了
      && segmentLabels(decomposeCommand('find . -exec reg delete HKLM\\X /f {} ;', 'bash').segments[0].words).join(',') === 'find,reg'
      && segmentLabels(decomposeCommand('sudo find . -exec reg delete HKLM\\X /f {} ;', 'bash').segments[0].words).join(',') === 'sudo,find,reg',
      JSON.stringify({ bad54z: bad54z.slice(0, 8), badLabels54z: badLabels54z.slice(0, 8), bypassed54z: bypassed54z.slice(0, 8),
        badAllow54z, n54z,
        sudoFindExecKill: tiersOf('sudo find . -exec kill {} ;', 'bash', 'win32'),
        findExecSudoKill: tiersOf('find . -exec sudo kill {} ;', 'bash', 'win32'),
        findExecSudoRm: tiersOf('find . -exec sudo rm -rf {} +', 'bash', 'win32'),
        allowSudoRm: allowOf54z('find . -exec sudo rm -rf {} +').action,
        allowPlainRm: allowOf54z('find . -exec rm -rf {} +').action,
        suRootGit: segmentLabels(decomposeCommand('find . -exec su root git status {} ;', 'bash').segments[0].words) }))
  }

  // ── 54D：**引号包住的多词词元**作为 `-exec` 族载荷首词元（F3）─────────────────────
  // 根因：`headLabelAt` 的 `widened` 登记写的是链尾 label 的**首词**（`String(head).split(' ')[0]`），
  // 而 `pushHeadLabels` 的 `push(first)`（`:954`）写进 `out` 的是 `commandNameOf(w[start])`
  // 的**原值**；且 `:955` 的 `PRIV_PREFIXES[first] !== 1` 早退让链尾那一支的截断根本走不到。
  // 当 `w[start]` **本身含空格**（词法器把引号内容并成一个词元：`-exec "reg delete" HKLM\X /f`）
  // 时，两个集合的形态分叉：
  //     labels  = ['sudo','find','reg delete']    ← out 拿原值
  //     widened = ['find','reg']                  ← 只登记了首词
  // 授权面（`assessCommand` 的 `labels.filter(l => !widenedSet.has(l))`）里两词项
  // `reg delete` **不在** `widenedSet` 中、存活下来 → 被用户为普通 `reg` 写下的
  // `reg *`=allow 命中。实测（例外 `<首词> *`=allow、其余 ask，修复前）：
  //     sudo find . -exec "reg delete" HKLM\X /f {} ;  → **allow**（主路径 ask）
  //     sudo find . -exec "git status" {} ;            → **allow**（主路径 ask）
  //     doas find . -exec "docker rm -f x" {} ;        → **allow**（主路径 ask）
  //     sudo find . -execdir "rm -rf" {} ;             → **allow**（主路径 ask）
  //     pkexec find . -ok "kill -9" {} ;               → **allow**（主路径 ask）
  // 而**同一条命令**的两个对照都是 ask —— 纯粹的不变量分叉：
  //     无引号载荷 `sudo find . -exec reg delete HKLM\X /f {} ;` → labels=['sudo','find','reg'] → ask ✅
  //     主路径     `sudo reg delete HKLM\X /f`               → labels=['sudo','reg delete']  → ask ✅
  //
  // ⚠️ 为什么 54B 结构性照不出这一格：它的语料是**无空格**的两词路由器
  // （`reg delete HKLM\X /f` 作为三个独立词元），`first` 因此恒为单词、
  // `String(head).split(' ')[0]` 是恒等变换 —— 那条不一致根本不存在。
  // 只有**词法器把多词内容并成一个词元**（引号包住）时 `first` 才含空格，故本组必须用引号语料。
  //
  // ── 判据（三条，缺一不可）──────────────────────────────────────────────────────
  // ① 「放宽」的判据**不是**「载荷族 allow」：`find . -exec "reg delete" …`（**无提权前缀**）
  //    在 PRE / HEAD / CUR **三态都是 allow** —— 那是既有口径（`reg delete` 在授权面里、
  //    是用户写下 `reg *` 的真实意图），不是本缺陷。放宽只指
  //    「**带前缀**时主路径非 allow、载荷族却 allow」这一格。
  // ② 主路径同值：`sudo find … -exec "reg delete" …` 与 `sudo "reg delete" …` 必须同值。
  // ③ 授权面**直接**探测：用载荷族**合成出的那个两词 label** 加 ` *` 作 allow 例外 ——
  //    它命中 allow 当且仅当该两词项在授权面里（= 形态分叉存在）。
  //    实测三态：PRE 60/60 放宽、CUR 0/60、HEAD 0/60（HEAD 不合成载荷族 label，模式命中不了）。
  //    这条比②更直接：它不依赖「主路径」这个对照量的口径。
  {
    const allowQ = (cmd, pat) => run(cmd, 'bash', {
      exceptions: [pat], excAction: 'allow', platform: 'win32',
    })
    // 6 条点名形态（缺陷报告原文）—— 例外是**载荷首词元的第一词**（用户为普通该命令写下的）
    const named54D = [
      ['reg *', 'sudo find . -exec "reg delete" HKLM\\X /f {} ;', 'sudo reg delete HKLM\\X /f'],
      ['git *', 'sudo find . -exec "git status" {} ;', 'sudo git status'],
      ['docker *', 'doas find . -exec "docker rm -f x" {} ;', 'doas docker rm -f x'],
      ['rm *', 'sudo find . -execdir "rm -rf" {} ;', 'sudo rm -rf'],
      ['kill *', 'pkexec find . -ok "kill -9" {} ;', 'pkexec kill -9'],
      ['my *', 'sudo find . -exec "C:/Program Files/My Tool.exe" -rf {} ;', 'sudo C:/Program Files/My Tool.exe -rf'],
    ]
    // 点名形态的放宽：**主路径非 allow 时**载荷族不得 allow（判据①）
    const leaked54D = named54D
      .filter(([pat, , main]) => allowQ(main, pat).action !== 'allow')
      .filter(([pat, c]) => allowQ(c, pat).action === 'allow')
    // 全量叉乘：17 个引号多词载荷 × 4 个 `-exec` 族 flag × 12 种**提权**前缀
    const payloads54D = [
      ['reg', '"reg delete" HKLM\\X /f'], ['git', '"git status"'],
      ['git', '"git push --force"'], ['docker', '"docker rm -f x"'],
      ['rm', '"rm -rf"'], ['kill', '"kill -9"'], ['shutdown', '"shutdown -h now"'],
      ['taskkill', '"taskkill /im x.exe"'], ['wmic', '"wmic process delete"'],
      ['chmod', '"chmod 777"'], ['format', '"format c:"'],
      ['set-executionpolicy', '"set-executionpolicy unrestricted"'],
      ['diskpart', '"diskpart /s script.txt"'],
      ['my', '"C:/Program Files/My Tool.exe" -rf'],
      ['rm', '"/usr/bin/rm" -rf'],
      ['rm', '"C:\\Windows\\System32\\rm.exe" -rf'],
      ['reg delete', '"reg delete"'],
    ]
    const flags54D = ['-exec', '-execdir', '-ok', '-okdir']
    const prefixes54D = ['sudo ', 'doas ', 'pkexec ', 'gsudo ', 'su root ', 'runas /user:a ',
      'env sudo ', 'timeout 5 sudo ', 'sudo su root ', 'sudo -u root ', 'su ', 'runas ']
    const bad54D = []
    let n54D = 0
    for (const [head, q] of payloads54D) {
      const pat = head + ' *'
      for (const fl of flags54D) {
        for (const p of prefixes54D) {
          const cmd = p + 'find . ' + fl + ' ' + q + ' {} ;'
          n54D += 1
          const got = allowQ(cmd, pat).action
          // 主路径对照：把载荷词元提到命令头（`sudo "reg delete" HKLM\X /f`）——
          // 同一条提权语义，动作必须逐字相同（这正是 F1/F3 修复前被击穿的不变量）
          const ref = allowQ(p + q, pat).action
          if (got !== ref) bad54D.push([pat, cmd, got, '主路径(' + p + q + ')=' + ref])
          // 判据①：**主路径非 allow 时**载荷族 allow 就是放宽。
          // ⚠️ 判据**不能**写成 `got === 'allow'`：`! find . -exec "reg delete" …` 这类
          // 无提权前缀的形态在主路径与载荷族两侧都是 allow（既有口径），
          // 那样写会把它们全算成放宽（实测 1152 格中 336 格误报）。
          if (ref !== 'allow' && got === 'allow') bad54D.push(['★放宽', pat, cmd, got, '主路径=' + ref])
        }
      }
    }
    // 判据③：授权面**直接**探测 —— 例外取载荷族合成出的 label。
    // 它命中 allow 当且仅当该项存活在授权面里（形态分叉的直接观测，不经过主路径对照）。
    //
    // ⚠️ **不得**再按「含不含空格」过滤（本轮 F4 的修法）：上一版写的是
    //     `if (String(ls[i]).indexOf(' ') === -1) continue`
    // 于是只探测**两词** label，而 F4 那一族的授权面项恰恰是**单词**提权前缀名
    // （`sudo find . -exec doas rm …` 的 `doas`）—— 被这一行**整类跳过**，54D 因此全绿
    // 却照不出 F4（实测：含过滤 60 格，去掉后 136 格，多出的 76 格正是单词那一族）。
    // 单词 label 的「无前缀对照」必须用 `plain`（不带提权前缀）那一侧：
    // `sudo find . -exec doas rm …` 的 `doas` 在无前缀时是**载荷首词**，被 `doas *`=allow
    // 授权是既有口径（用户写下 `doas *` 的真实意图）—— 正是「模式本身生效」的证明。
    let n54D2 = 0
    const leaked54D2 = [], ctrl54D2 = []
    for (const [, q] of payloads54D) {
      for (const fl of flags54D) {
        const prefixed = 'sudo find . ' + fl + ' ' + q + ' {} ;'
        const plain = 'find . ' + fl + ' ' + q + ' {} ;'
        const d = decomposeCommand(prefixed, 'bash')
        if (!d.ok || !d.segments.length) continue
        const ls = segmentLabels(d.segments[0].words)
        // 下标 > 0 = 载荷族**合成**的 label（下标 0 是段首主 label 的既有口径，不算）
        for (let i = 1; i < ls.length; i += 1) {
          n54D2 += 1
          const pat2 = ls[i] + ' *'
          if (allowQ(prefixed, pat2).action === 'allow') leaked54D2.push([pat2, prefixed, ls])
          // 对照（防空转）：**无前缀**时同一模式必须授权成功 —— 证明模式本身生效、
          // 那个 label 真实存在（否则「带前缀不放宽」可能只是因为模式压根匹配不上）
          if (allowQ(plain, pat2).action !== 'allow') ctrl54D2.push([pat2, plain, ls])
        }
      }
    }
    // ── 判据④：**载荷首层前缀名 × 外层前缀**叉乘（F4 的主角形态，含两者**不同名**）──────
    // 判据③的语料里「外层前缀」恒是 `sudo`、「载荷前缀」恒缺席，故它**结构性照不出**
    // 「外层前缀 ≠ 载荷首层前缀」这一格（两者同名时该名字在链首与链尾重合，掩盖了分叉）。
    // 本组把 6 个载荷前缀名 × 6 个外层前缀（含 `''` 与 wrapper 形态）全叉乘，
    // 并同时钉三条：
    //   ① **主路径非 allow 时载荷族不得 allow**（放宽方向，逐格）；
    //   ② 载荷族与主路径**同值**（同一条提权语义不得两个结论）；
    //   ③ 授权面**直接**探测：例外取载荷首层前缀名 `inner *`，它命中 allow 当且仅当该名字
    //      存活在授权面里（= F4 的分叉存在，不经过主路径对照）。
    //      ⚠️ **只在两者不同名时探**（`inner !== 命令头前缀名`）：同名时授权面里那个名字
    //      **就是命令头前缀本身**（`sudo find . -exec sudo rm …` 的 `sudo`），用户写
    //      `sudo *`=allow 授权它正是既有行为 —— HEAD / PRE / CUR 三态都是 allow，
    //      那不是 F4（`widened` 按**名字**判定，同名时两个来源不可区分）。
    //      F4 的放宽**只**发生在「载荷首层前缀名 ≠ 命令头前缀名」这一格（发现原文即如此）。
    //      对照（防空转）：**不带外层前缀**的同一形态必须被该例外授权 —— 证明模式本身生效、
    //      那个名字真实存在（`find . -exec doas rm …` 的 `doas` 是载荷首词，用户写下
    //      `doas *`=allow 正是要授权它，HEAD / PRE / CUR 三态都是 allow）。
    let n54D4 = 0
    let n54D4inv = 0
    let n54D4wid = 0
    let n54D4widLen = 0
    const leaked54D4 = [], fork54D4 = [], ctrl54D4 = [], inv54D4 = []
    const innerPriv54D4 = ['sudo', 'doas', 'pkexec', 'gsudo', 'su', 'runas']
    const outerPriv54D4 = ['', 'sudo ', 'doas ', 'pkexec ', 'gsudo ', 'su root ',
      'runas /user:a ', 'sudo su root ', 'env sudo ', 'timeout 5 sudo ']
    // 命令头前缀名：`segmentLabel(words)` 在五种命令头形态下都恰好给出提权前缀名
    // （`sudo` / `env sudo` / `timeout 5 sudo` / `sudo su root` / `su root` / `runas /user:a`），
    // 无前缀时给出真命令名 `find`（查表不中 → 视作无前缀）。
    const headNameOf54D4 = (cmd) => {
      const d = decomposeCommand(cmd, 'bash')
      if (!d.ok || !d.segments.length) return ''
      const m = segmentLabel(d.segments[0].words)
      return PRIV_PREFIXES[m] === 1 ? m : ''
    }
    for (const inner of innerPriv54D4) {
      const pat4 = inner + ' *'
      for (const outer of outerPriv54D4) {
        const headName4 = headNameOf54D4(outer + 'find . -exec ' + inner + ' rm -rf /etc {} ;')
        const sameName4 = !!headName4 && headName4 === inner
        for (const fl of flags54D) {
          const cmd4 = outer + 'find . ' + fl + ' ' + inner + ' rm -rf /etc {} ;'
          const main4 = outer + inner + ' rm -rf /etc'
          n54D4 += 1
          const got4 = allowQ(cmd4, pat4).action
          const ref4 = allowQ(main4, pat4).action
          // ① 放宽：主路径非 allow 时载荷族不得 allow
          if (ref4 !== 'allow' && got4 === 'allow') leaked54D4.push([pat4, cmd4, got4, '主路径=' + ref4])
          // ② 与主路径同值（同一条提权语义不得两个结论）
          if (got4 !== ref4) fork54D4.push([pat4, cmd4, got4, '主路径(' + main4 + ')=' + ref4])
          // ③ 授权面直接探测（**异名**时带外层前缀不得被授权）+ 无外层对照（必须被授权）
          if (!outer) {
            if (allowQ(cmd4, pat4).action !== 'allow') ctrl54D4.push([pat4, cmd4, '无外层前缀时也未被授权'])
          } else if (!sameName4 && got4 === 'allow') {
            leaked54D4.push(['★授权面', pat4, cmd4, got4, 'headName=' + headName4])
          }
          // ④ `widened ⊆ labels` 不变量（授权面的**充要前提**，见 `segmentLabelsCore` 的导出说明）：
          // 两个集合由 `segmentLabelsCore` 单点产出，叉乘语料是本轮 F4 的现场，必须专门覆盖。
          // 违反有两种方向，两个方向都是缺陷：
          //   · `widened` 里有 `labels` 没有的名字 → 该名字从判档与 deny 例外面**同时消失**；
          //   · `labels` 里有 `widened` 没有的**扩展名** → 它留在授权面里（正是 F1/F3/F4 那一族）。
          const core4 = segmentLabelsCore(decomposeCommand(cmd4, 'bash').segments[0].words)
          const miss4 = core4.widened.filter((x) => core4.labels.indexOf(x) === -1)
          if (miss4.length) inv54D4.push([cmd4, miss4, core4.labels, core4.widened])
          // 对照（防空转）：`widened` 真的**非空**（否则「⊆」在空集上恒真，本检查空转）——
          // 叉乘语料每一格都至少有一个扩展名（载荷前缀名 / 链尾名 / 命令头前缀名），
          // 实测 240 格全部非空、总长 656、最大 4。
          if (core4.widened.length) n54D4wid += 1
          n54D4widLen += core4.widened.length
          n54D4inv += 1
        }
      }
    }
    ok('★★ 54D 引号多词词元 / 载荷首层前缀的授权方向不变量（F3 + F4：载荷族 `find -exec "reg delete" …` 不得被 `reg *`=allow 授权；`find -exec doas rm …` 不得被 `doas *`=allow 授权）',
      leaked54D.length === 0 && bad54D.length === 0
      && leaked54D2.length === 0 && ctrl54D2.length === 0
      // ── 判据④（F4 的主角形态：载荷首层前缀名 × 外层前缀，含两者**不同名**）──────────
      && leaked54D4.length === 0 && fork54D4.length === 0
      && ctrl54D4.length === 0 && inv54D4.length === 0
      // 对照（防空转）：叉乘语料真的被遍历到了（6 载荷前缀 × 10 外层前缀 × 4 flag = 240）
      // ⚠️ 判据**不得**写成 `n54D4 === innerPriv54D4.length * outerPriv54D4.length * flags54D.length`
      // 那样的「语料长度自洽式」—— 把 `innerPriv54D4` 清空时两边同时变 0，**恒真**（实测该变异
      // 曾未被捕获）。故用**与语料长度无关**的绝对值下界钉住「语料非空且真的跑了」。
      && n54D4 === 240 && n54D4inv === 240
      // 对照（防空转）：`widened` 在叉乘语料上**逐格非空**（否则 `⊆` 在空集上恒真、判据④空转）
      && n54D4wid === 240 && n54D4widLen === 656
      // 对照（防空转）：语料变量本身非空（防「清空 innerPriv54D4」这类变异）
      && innerPriv54D4.length === 6 && outerPriv54D4.length === 10
      && flags54D.length === 4 && payloads54D.length === 17
      // 对照（防空转）：两组语料真的被遍历到了
      && n54D === payloads54D.length * flags54D.length * prefixes54D.length
      // 判据③ 的探测面**计数守卫**（防空转的关键）：
      // ⚠️ 判据③**去掉空格过滤**后，每格的 `labels` 恰好是 `['sudo', 载荷族合成项]` ——
      // 即每格 2 个（下标 > 0）探测项，实测 17 × 4 = 68 格 → **136** 个探测。
      // 两个**路径形态**的载荷（`"/usr/bin/rm"`、`"C:\Windows\System32\rm.exe"`）经
      // `commandNameOf` 剥掉路径后合成的是**单词** `rm`，故它们的第 2 个探测项是单词
      // —— 上一版正是被空格过滤整类跳过的那些（旧计数 60 = 136 − 76）。
      // ⚠️ 这里用**绝对值 136** 而不是 `payloads54D.length * flags54D.length * 2`：
      // 后者是「语料长度自洽式」，清空语料时两边同时变 0 而**恒真**（实测该变异未被捕获）。
      && n54D2 === 136
      // 对照（防空转）：**不带提权前缀**的载荷族仍可被该例外授权 —— 证明例外本身生效、
      // 上面不是「整条判据被关掉」（`find . -exec "reg delete" …` 的 `reg delete` 是
      // 用户写下这条例外的真实意图，PRE / HEAD / CUR 三态都是 allow）。
      && allowQ('find . -exec "reg delete" HKLM\\X /f {} ;', 'reg *').action === 'allow'
      && allowQ('find . -exec "reg delete" HKLM\\X /f {} ;', 'reg *').segments[0].source === 'exception'
      // 对照（防空转）：主路径本身在**无前缀**时确实是 allow（否则同值判据恒真）
      && allowQ('"reg delete" HKLM\\X /f', 'reg *').action === 'allow'
      // 对照（防空转）：**带前缀**时主路径确实是 ask —— 若它也是 allow，判据①恒假、整条断言空转
      && allowQ('sudo "reg delete" HKLM\\X /f', 'reg *').action === 'ask'
      && allowQ('sudo reg delete HKLM\\X /f', 'reg *').action === 'ask'
      // ── 主路径既有行为**不变**（F4 的修法只在载荷族生效，主路径不得被牵连）────────────
      // `sudo rm -rf /etc` 被 `sudo *`=allow 授权是 HEAD 的既有行为，54c2 的对照钉在同一点上；
      // F4 的修法靠「主路径调用点**不传** `headPrefix`」保住它 —— 若有人顺手给主路径也传了，
      // 这四格会立刻变红。
      && allowQ('sudo rm -rf /etc', 'sudo *').action === 'allow'
      && allowQ('sudo kill 1234', 'sudo *').action === 'allow'
      && allowQ('sudo sudo rm -rf /etc', 'sudo *').action === 'allow'
      && allowQ('sudo doas rm -rf /etc', 'doas *').action === 'ask'
      // 对照（**目标格**：载荷首层前缀名 ≠ 外层前缀名，F4 修法前是 allow）
      && allowQ('sudo find . -exec doas rm -rf /etc {} ;', 'doas *').action === 'ask'
      && allowQ('doas find . -exec sudo rm -rf /etc {} ;', 'sudo *').action === 'ask'
      // 对照（**同名格必须保持既有行为**，F4 的修法不得把它连带收紧）：
      // 这三格的授权面里那个名字**就是命令头前缀本身**，HEAD / PRE / CUR 三态都是 allow。
      // 若把 `widened` 的登记判据写成「命令头带提权前缀」（而不比名字），它们会全部变 ask
      // —— 那是过度收紧，且与主路径分叉（`env sudo sudo rm -rf /etc` 仍是 allow）。
      && allowQ('sudo find . -exec sudo rm -rf /etc {} ;', 'sudo *').action === 'allow'
      && allowQ('env sudo find . -exec sudo rm -rf /etc {} ;', 'sudo *').action === 'allow'
      && allowQ('timeout 5 sudo find . -exec sudo rm -rf /etc {} ;', 'sudo *').action === 'allow'
      && allowQ('env sudo sudo rm -rf /etc', 'sudo *').action === 'allow'
      // 对照（**收紧方向仍须认它**）：deny 例外照常命中载荷族里的**前缀名**与链尾名
      && run('sudo find . -exec doas rm -rf /etc {} ;', 'bash', { exceptions: ['doas *'], excAction: 'deny', platform: 'win32' }).action === 'deny'
      // 对照（收紧方向仍须认它）：deny 例外照常命中载荷族里的引号多词 label
      && run('sudo find . -exec "reg delete" HKLM\\X /f {} ;', 'bash', { exceptions: ['reg *'], excAction: 'deny', platform: 'win32' }).action === 'deny'
      // 对照（**既有口径**：`out` 里载荷族合成的 label 是 `commandNameOf` 的**原值**，
      // 引号多词时就是两词 —— 本修法只该修「两个集合形态不一致」，
      // 不得顺手把 `out` 的粒度也改成首词，那会让 `reg delete` 从 DESTRUCTIVE_LABELS 里掉出去）
      && segmentLabels(decomposeCommand('sudo find . -exec "reg delete" HKLM\\X /f {} ;', 'bash').segments[0].words).indexOf('reg delete') !== -1
      // 对照（**反向**，钉住「不得把首词化下沉到 `out` 的写入点」）：`out` 若退化成首词
      // `reg`，`reg delete` 这个 DESTRUCTIVE_LABELS 成员与 GROUP_OF_LABEL 的键就丢了 ——
      // `reg`=deny + 大分类 allow 时该命令会由 ask 变 **allow**（放宽，比本缺陷更糟）。
      && (function () {
        const h = tierOpts('win32')
        h.destructive = () => ({ inside: 'ask', outside: 'ask', wide: 'ask', unknown: 'ask', proc: 'ask', power: 'ask', priv: 'ask', reg: 'deny' })
        h.category = () => ({ action: 'allow' })
        return assessCommand('find . -exec "reg delete" HKLM\\X /f {} ;', 'bash', h).action === 'deny'
      })(),
      JSON.stringify({ leaked54D, bad54D: bad54D.slice(0, 8), n54D,
        leaked54D2: leaked54D2.slice(0, 4), ctrl54D2: ctrl54D2.slice(0, 4), n54D2,
        leaked54D4: leaked54D4.slice(0, 6), fork54D4: fork54D4.slice(0, 6),
        ctrl54D4: ctrl54D4.slice(0, 6), inv54D4: inv54D4.slice(0, 6), n54D4, n54D4inv,
        allowQuoted: allowQ('sudo find . -exec "reg delete" HKLM\\X /f {} ;', 'reg *').action,
        allowMainQuoted: allowQ('sudo "reg delete" HKLM\\X /f', 'reg *').action,
        allowMainPlain: allowQ('sudo reg delete HKLM\\X /f', 'reg *').action,
        allowPlainExec: allowQ('find . -exec "reg delete" HKLM\\X /f {} ;', 'reg *').action,
        labelsQuoted: segmentLabels(decomposeCommand('sudo find . -exec "reg delete" HKLM\\X /f {} ;', 'bash').segments[0].words) }))
  }

  // ── 54E：**链尾认不出**时的同名格 —— `-exec <前缀名> {} ;` / `;` / `+` 一族（F5）──────
  // 根因：`:992`（修复后行号）的链尾登记是**纯布尔** `headPrefix`，未同步链首那一支
  // （`:1063` 的 `first !== headPrefix`）刚确立的「**同名时必须比名字**」原则。
  //
  // 链尾**认不出**时（载荷里只有前缀名、没有命令名）`pushHeadLabels` 会
  // `if (!head || head === first) return first`，于是 `headLabelAt` 拿到的 `head`
  // **恒等于载荷首层那个前缀名**。当它与命令头前缀**同名**时
  // （`env sudo find . -exec sudo {} ;`），`addWidened(head)` 挪出授权面的其实是
  // **命令头那个名字** —— 正是 `:1054-1062` 注释断言「必须排除、否则过度收紧」的那一格，
  // 而该断言当时只落到了 `:1063` 这一支（链首），链尾这一支漏了。
  //
  // 实测（例外 `<前缀名> *`=allow、其余 ask，修复前 CUR）：
  //     env sudo find . -exec sudo {} ;        HEAD=allow  **ask**   widened=['find','sudo']
  //     env sudo find . -exec sudo ;           HEAD=allow  **ask**
  //     env sudo find . -exec sudo {} +        HEAD=allow  **ask**
  //     timeout 5 sudo find . -exec sudo {} ;  HEAD=allow  **ask**
  //     time sudo find . -exec sudo {} ;       HEAD=allow  **ask**
  //     env doas find . -exec doas {} ;        HEAD=allow  **ask**
  // 而**同一条前缀语义**的主路径 `env sudo sudo rm -rf /etc` / `env sudo sudo` 是 allow
  // —— 同一条前缀语义两个结论（不变量分叉），方向是**过度收紧**（非 fail-open）。
  // 归属：这些格在 PRE 上**同为 ask**，故**不是本批新引入的行为变化**，而是本批修复的判据
  // （必须比名字）**未同步到 `:992`** —— 修复不完整，且 `:1054-1062` 的断言在这一支上不成立。
  //
  // ⚠️ 与 54D 判据④（同名格**只探异名**那一支）的区别：54D 的同名格语料是
  // `-exec sudo rm -rf /etc {} ;`（**链尾认得出**，`head === 'rm'`），那时 `head !== headPrefix`
  // 天然成立、该格与本缺陷无关；本组的语料是**链尾认不出**的 `-exec sudo {} ;` 一族 ——
  // 54D 结构性照不出（它的 6 个载荷前缀后面恒跟着真命令名）。
  //
  // 判据（三条，缺一不可）：
  //   ① **与主路径同值**：`<外层前缀>find … -exec <同名前缀> <tail>` 与
  //      `<外层前缀><同名前缀> rm -rf /etc` 必须逐字同值（同一条提权语义不得两个结论）；
  //   ② **不得过度收紧**：这些格必须 `allow`（= HEAD 原值）—— 授权面里那个名字就是
  //      命令头前缀本身，用户写 `<前缀名> *`=allow 正是要授权它；
  //   ③ **异名对照仍须 ask**（防空转）：把载荷换成**另一个**前缀名时该名字确实该被挪出
  //      授权面（`env sudo find . -exec doas {} ;` 例外 `doas *` 必须 ask）——
  //      否则「同名格 allow」可能只是「整条判据被关掉」。
  {
    const allowQ54E = (cmd, pat) => run(cmd, 'bash', {
      exceptions: [pat], excAction: 'allow', platform: 'win32',
    })
    // 命令头前缀名（与 54D 判据④的 `headNameOf54D4` 同判据：主 label 是提权前缀名）
    const headNameOf54E = (cmd) => {
      const d = decomposeCommand(cmd, 'bash')
      if (!d.ok || !d.segments.length) return ''
      const m = segmentLabel(d.segments[0].words)
      return PRIV_PREFIXES[m] === 1 ? m : ''
    }
    // 4 flag × 4 tail × 2 同名前缀（sudo / doas）× 4 外层前缀 = 128 格
    const flags54E = ['-exec', '-execdir', '-ok', '-okdir']
    // tail 覆盖报告点名的三种（`{} ;` / `;` / `+`）与 `{} +`
    const tails54E = ['{} ;', ';', '+', '{} +']
    // 外层前缀：**同名**那一族（命令头前缀名与载荷前缀名相同），含 54D 判据④的 wrapper 形态
    const outerOf54E = (inner) => [inner + ' ', 'env ' + inner + ' ', 'timeout 5 ' + inner + ' ', 'time ' + inner + ' ']
    const fork54E = [], tightened54E = [], notAsk54E = [], ctrl54E = [], headMismatch54E = []
    let n54E = 0
    for (const inner of ['sudo', 'doas']) {
      const pat = inner + ' *'
      for (const outer of outerOf54E(inner)) {
        for (const fl of flags54E) {
          for (const tail of tails54E) {
            const cmd = outer + 'find . ' + fl + ' ' + inner + ' ' + tail
            const main = outer + inner + ' rm -rf /etc'
            n54E += 1
            // 判据③的前置：本格确实落在「命令头前缀名 === 载荷前缀名」上
            // （否则本组测的不是同名格，断言会假绿）
            if (headNameOf54E(cmd) !== inner) headMismatch54E.push([cmd, headNameOf54E(cmd)])
            const got = allowQ54E(cmd, pat).action
            const ref = allowQ54E(main, pat).action
            // ① 与主路径同值
            if (got !== ref) fork54E.push([cmd, got, '主路径(' + main + ')=' + ref])
            // ② 不得过度收紧（HEAD 原值 = allow）
            if (got !== 'allow') tightened54E.push([cmd, got, '主路径=' + ref])
          }
        }
        // ③ 异名对照：同一形态换成**另一个**前缀名 —— 该名字确实该被挪出授权面（必须 ask）
        for (const fl of flags54E) {
          const other = inner === 'sudo' ? 'doas' : 'sudo'
          const cmdOther = outer + 'find . ' + fl + ' ' + other + ' {} ;'
          notAsk54E.push([cmdOther, other + ' *', allowQ54E(cmdOther, other + ' *').action])
        }
      }
    }
    // ③ 的对照（防空转）：**不带外层前缀**时同一形态必须被该例外授权
    // —— 证明模式本身生效、那个名字真实存在（否则「同名格 allow」可能只是因为模式匹配不上）
    for (const inner of ['sudo', 'doas']) {
      for (const fl of flags54E) {
        ctrl54E.push(['find . ' + fl + ' ' + inner + ' {} ;', inner + ' *',
          allowQ54E('find . ' + fl + ' ' + inner + ' {} ;', inner + ' *').action])
      }
    }
    ok('★★ 54E 链尾认不出时的**同名**格：`-exec <前缀名> {} ;` 一族不得被过度收紧（F5：与主路径同值、保持 HEAD 的 allow）',
      fork54E.length === 0 && tightened54E.length === 0
      && headMismatch54E.length === 0
      // ③ 异名对照必须全部 ask（防空转：证明「同名 allow」不是「整条判据被关掉」）
      && notAsk54E.every((r) => r[2] === 'ask')
      // ③ 的无外层对照必须全部 allow（防空转：证明例外本身生效）
      && ctrl54E.every((r) => r[2] === 'allow')
      // 语料计数（绝对值，不用「语料长度自洽式」—— 清空语料时两边同时变 0 而恒真）
      && n54E === 128
      && notAsk54E.length === 32 && ctrl54E.length === 8
      && flags54E.length === 4 && tails54E.length === 4
      && outerOf54E('sudo').length === 4
      // 收紧方向**仍须**认它（修法只该撤掉「同名」那一格的收紧，不得把 deny 方向一起放宽）
      && run('env sudo find . -exec sudo {} ;', 'bash', { exceptions: ['sudo *'], excAction: 'deny', platform: 'win32' }).action === 'deny'
      && run('env doas find . -exec doas {} ;', 'bash', { exceptions: ['doas *'], excAction: 'deny', platform: 'win32' }).action === 'deny'
      // 主路径既有行为不变（同名格的对照量本身确实是 allow，否则判据①恒真）
      && allowQ54E('env sudo sudo rm -rf /etc', 'sudo *').action === 'allow'
      && allowQ54E('env sudo sudo', 'sudo *').action === 'allow'
      && allowQ54E('doas doas rm -rf /etc', 'doas *').action === 'allow'
      // 54u 方向不变量（本修法不得把它们一起放宽）
      && allowQ54E('sudo find / -exec rm -rf {} +', 'rm *').action === 'ask'
      && allowQ54E('find / -exec rm -rf {} +', 'rm *').action === 'allow'
      && allowQ54E('sudo find / -delete', 'rm *').action === 'ask'
      // `widened ⊆ labels` 不变量：本组语料（链尾认不出）也必须恒成立
      && (function () {
        for (const inner of ['sudo', 'doas']) {
          for (const outer of outerOf54E(inner)) {
            for (const fl of flags54E) {
              for (const tail of tails54E) {
                const d = decomposeCommand(outer + 'find . ' + fl + ' ' + inner + ' ' + tail, 'bash')
                if (!d.ok || !d.segments.length) return false
                const c = segmentLabelsCore(d.segments[0].words)
                if (c.widened.some((x) => c.labels.indexOf(x) === -1)) return false
              }
            }
          }
        }
        return true
      })(),
      JSON.stringify({ fork54E: fork54E.slice(0, 6), tightened54E: tightened54E.slice(0, 6),
        headMismatch54E: headMismatch54E.slice(0, 4), n54E,
        notAsk54E: notAsk54E.filter((r) => r[2] !== 'ask').slice(0, 4),
        ctrl54E: ctrl54E.filter((r) => r[2] !== 'allow').slice(0, 4),
        allowSameName: allowQ54E('env sudo find . -exec sudo {} ;', 'sudo *').action,
        allowMainSameName: allowQ54E('env sudo sudo rm -rf /etc', 'sudo *').action,
        allowOtherName: allowQ54E('env sudo find . -exec doas {} ;', 'doas *').action,
        coreSameName: (function () {
          const c = segmentLabelsCore(decomposeCommand('env sudo find . -exec sudo {} ;', 'bash').segments[0].words)
          return { labels: c.labels, widened: c.widened }
        })() }))

    // ── 54E2：链**中层**同名格 —— `-exec <前缀A> <同名前缀> {} ;` 一族（F5 的补完）────
    // 根因：`:1152` 的链中层 `if (cur !== first) { push(cur); widen(cur) }` 是**纯位置**判据
    // —— 它只排除链首那一层，链中层**一律 `widen`**。于是当链中层的名字与**命令头前缀
    // 同名**时，`widen` 挪出授权面的其实是**命令头那个名字本身**，正是 `:992`（链尾）与
    // `:1063`（链首）已经排除、并在注释里断言「同名时必须比名字，否则过度收紧」的那一格。
    // 方向是**过度收紧**（非 fail-open），但与主路径分叉 —— F5 只落到链首与链尾，链中层漏了。
    //
    // ⚠️ 与上面 54E 的**结构差异**（这是 54E 照不出本缺陷的原因）：54E 的语料是
    // `-exec <前缀名> {} ;` —— 链尾**认不出**（载荷里只有前缀名、没有命令名），走的是
    // `:1238` 的 `head === first → return first` 早退；本组的语料是
    // `-exec <前缀A> <同名前缀> {} ;` —— 链尾**认得出**（`head === first` 那一支在 `:1152`
    // 先把链中层 `widen` 掉）。两族的代码路径不同，故 54E 全绿也可能漏掉本组。
    //
    // 实测（例外 `<命令头前缀名> *`=allow、其余 ask，修复前 CUR）：
    //     env sudo find . -exec doas sudo {} ;              HEAD=allow **ask** widened=['find','doas','sudo']
    //     env sudo find . -exec doas sudo rm -rf /etc {} ;  HEAD=allow **ask**
    //     timeout 5 sudo find . -exec doas sudo {} ;        HEAD=allow **ask**
    //     time sudo find . -exec doas sudo {} ;             HEAD=allow **ask**
    //     env doas find . -exec sudo doas {} ;              HEAD=allow **ask** widened=['find','sudo','doas']
    // 而**同一条提权链**的主路径 `env sudo doas sudo rm -rf /etc` 是 allow
    // —— 同一条语义两个结论（不变量分叉），方向是**过度收紧**。
    // 覆盖面：4 flag × 6 链首 × 6 链中 × 4 外层 × 4 tail = 2304 格中 1440 格分叉。
    //
    // 判据（五条，缺一不可）：
    //   ① **与主路径同值**：`<外层>find . <flag> <链首> <同名前缀> <tail>` 与
    //      `<外层><链首> <同名前缀> rm -rf /etc` 必须逐字同值（同一条提权链不得两个结论）；
    //   ② **不得过度收紧**：这些格必须 `allow`（= HEAD 原值）—— 授权面里那个名字就是
    //      命令头前缀本身，用户写 `<前缀名> *`=allow 正是要授权它；
    //   ③ **授权面里命令头前缀名必须存活**：`widened` 不得含它（`labels` 仍须含它）——
    //      这是最直接钉住本缺陷的观测点（比动作值更靠近根因）；
    //   ④ **异名对照仍须 ask**（防空转）：链中层换成**另一个**前缀名时该名字确实该被挪出
    //      授权面，否则「同名格 allow」可能只是「整条判据被关掉」；
    //   ⑤ **deny 方向仍须命中**（防空转 + 不得放宽）：同名格用 deny 例外必须 deny ——
    //      本修法只该撤掉「同名」那一格的 `widen`，`push(cur)` 一个字都不动。
    {
      const names54E2 = ['sudo', 'doas', 'pkexec', 'su', 'runas', 'gsudo']
      const fork54E2 = [], tightened54E2 = [], notAsk54E2 = [], headMismatch54E2 = [], widened54E2 = []
      const deny54E2 = [], ctrl54E2 = []
      let n54E2 = 0
      for (const mid of ['sudo', 'doas']) {
        const pat = mid + ' *'
        for (const outer of outerOf54E(mid)) {
          for (const first of names54E2) {
            if (first === mid) continue
            const main = outer + first + ' ' + mid + ' rm -rf /etc'
            const ref = allowQ54E(main, pat).action
            for (const fl of flags54E) {
              for (const tail of tails54E) {
                const cmd = outer + 'find . ' + fl + ' ' + first + ' ' + mid + ' ' + tail
                n54E2 += 1
                // 前置：本格确实落在「命令头前缀名 === 链中层名」上（否则断言会假绿）
                if (headNameOf54E(cmd) !== mid) headMismatch54E2.push([cmd, headNameOf54E(cmd)])
                const got = allowQ54E(cmd, pat).action
                // ① 与主路径同值
                if (got !== ref) fork54E2.push([cmd, got, '主路径(' + main + ')=' + ref])
                // ② 不得过度收紧（HEAD 原值 = allow）
                if (got !== 'allow') tightened54E2.push([cmd, got, '主路径=' + ref])
                // ③ 授权面：命令头前缀名（mid）必须**存活**（不得进 widened）
                const c = segmentLabelsCore(decomposeCommand(cmd, 'bash').segments[0].words)
                if (c.widened.indexOf(mid) !== -1 || c.labels.indexOf(mid) === -1) {
                  widened54E2.push([cmd, c.labels, c.widened])
                }
              }
            }
            // ⑤ deny 方向：同名格用 deny 例外必须仍然 deny（本修法不得放宽收紧方向）
            // ⚠️ 主路径与载荷族**都**要探：`run(..., { excAction: 'deny' })` 才是真 deny 调用
            // （`allowQ54E` 恒传 allow，用它探 deny 会得到 allow 而假红）。
            deny54E2.push([main, pat,
              run(main, 'bash', { exceptions: [pat], excAction: 'deny', platform: 'win32' }).action])
            deny54E2.push([outer + 'find . -exec ' + first + ' ' + mid + ' {} ;', pat,
              run(outer + 'find . -exec ' + first + ' ' + mid + ' {} ;', 'bash',
                { exceptions: [pat], excAction: 'deny', platform: 'win32' }).action])
          }
          // ④ 异名对照：链中层换成**另一个**前缀名 —— 该名字确实该被挪出授权面（必须 ask）
          for (const other of ['sudo', 'doas', 'pkexec']) {
            if (other === mid) continue
            const cmdOther = outer + 'find . -exec ' + (other === 'sudo' ? 'doas' : 'sudo') + ' ' + other + ' {} ;'
            notAsk54E2.push([cmdOther, other + ' *', allowQ54E(cmdOther, other + ' *').action])
          }
        }
      }
      // ④ 的对照（防空转）：**不带外层前缀**时载荷链首那个名字必须被该例外授权
      // —— 证明模式本身生效、那个名字真实存在于授权面（否则「同名格 allow」可能只是匹配不上）。
      // ⚠️ 授权的名字必须是**载荷链首**（`first`）而不是链中层（`mid`）：无命令头前缀时
      // 链中层是**真的**「因前缀之后才可见」的名字，它**就该**在 `widened` 里（实测
      // `find . -exec doas sudo {} ;` 的 `sudo` 在 `widened` 中、`doas` 在授权面）——
      // 拿 `mid` 当对照会得到 ask，那是**正确**行为而非空转。
      for (const mid of ['sudo', 'doas']) {
        const first = mid === 'sudo' ? 'doas' : 'sudo'
        for (const fl of flags54E) {
          ctrl54E2.push(['find . ' + fl + ' ' + first + ' ' + mid + ' {} ;', first + ' *',
            allowQ54E('find . ' + fl + ' ' + first + ' ' + mid + ' {} ;', first + ' *').action])
        }
      }
      ok('★★ 54E2 链**中层**同名格：`-exec <前缀A> <同名前缀> {} ;` 一族不得被过度收紧（F5 补完：与主路径同值、授权面里命令头前缀名存活）',
        fork54E2.length === 0 && tightened54E2.length === 0
        && headMismatch54E2.length === 0 && widened54E2.length === 0
        // ④ 异名对照必须全部 ask（防空转：证明「同名 allow」不是「整条判据被关掉」）
        && notAsk54E2.every((r) => r[2] === 'ask')
        // ④ 的无外层对照必须全部 allow（防空转：证明例外本身生效）
        && ctrl54E2.every((r) => r[2] === 'allow')
        // ⑤ deny 方向必须全部命中（收紧方向不得被本修法放宽）
        && deny54E2.every((r) => r[2] === 'deny')
        // 语料计数（绝对值，不用「语料长度自洽式」—— 清空语料时两边同时变 0 而恒真）
        && n54E2 === 640
        && notAsk54E2.length === 16 && ctrl54E2.length === 8 && deny54E2.length === 80
        // 覆盖多个 flag 与至少 2 个同名前缀（任务要求）
        && flags54E.length === 4 && tails54E.length === 4
        && names54E2.length === 6 && outerOf54E('sudo').length === 4
        // 主路径既有行为不变（同名格的对照量本身确实是 allow，否则判据①恒真）
        && allowQ54E('env sudo doas sudo rm -rf /etc', 'sudo *').action === 'allow'
        && allowQ54E('env doas sudo doas rm -rf /etc', 'doas *').action === 'allow'
        && allowQ54E('env sudo doas sudo', 'sudo *').action === 'allow'
        // 点名格（报告原文的 6 格，逐条钉住）
        && allowQ54E('env sudo find . -exec doas sudo {} ;', 'sudo *').action === 'allow'
        && allowQ54E('env sudo find . -exec pkexec sudo {} ;', 'sudo *').action === 'allow'
        && allowQ54E('env sudo find . -exec doas sudo rm -rf /etc {} ;', 'sudo *').action === 'allow'
        && allowQ54E('timeout 5 sudo find . -exec doas sudo {} ;', 'sudo *').action === 'allow'
        && allowQ54E('env doas find . -exec sudo doas {} ;', 'doas *').action === 'allow'
        && allowQ54E('env doas find . -exec sudo doas rm -rf /etc {} ;', 'doas *').action === 'allow'
        // 54u 方向不变量（本修法不得把它们一起放宽）
        && allowQ54E('sudo find / -exec rm -rf {} +', 'rm *').action === 'ask'
        && allowQ54E('find / -exec rm -rf {} +', 'rm *').action === 'allow'
        && allowQ54E('sudo find / -delete', 'rm *').action === 'ask'
        // 54E（链尾同名）与 54D 的收益不得被本修法吃掉
        && allowQ54E('env sudo find . -exec sudo {} ;', 'sudo *').action === 'allow'
        && run('env sudo find . -exec sudo {} ;', 'bash', { exceptions: ['sudo *'], excAction: 'deny', platform: 'win32' }).action === 'deny'
        // `widened ⊆ labels` 不变量：本组语料也必须恒成立
        && (function () {
          for (const mid of ['sudo', 'doas']) {
            for (const outer of outerOf54E(mid)) {
              for (const first of names54E2) {
                if (first === mid) continue
                for (const fl of flags54E) {
                  for (const tail of tails54E) {
                    const d = decomposeCommand(outer + 'find . ' + fl + ' ' + first + ' ' + mid + ' ' + tail, 'bash')
                    if (!d.ok || !d.segments.length) return false
                    const c = segmentLabelsCore(d.segments[0].words)
                    if (c.widened.some((x) => c.labels.indexOf(x) === -1)) return false
                  }
                }
              }
            }
          }
          return true
        })(),
        JSON.stringify({ n54E2, fork54E2: fork54E2.slice(0, 6), tightened54E2: tightened54E2.slice(0, 6),
          widened54E2: widened54E2.slice(0, 4), headMismatch54E2: headMismatch54E2.slice(0, 4),
          notAsk54E2: notAsk54E2.filter((r) => r[2] !== 'ask').slice(0, 4),
          ctrl54E2: ctrl54E2.filter((r) => r[2] !== 'allow').slice(0, 4),
          deny54E2: deny54E2.filter((r) => r[2] !== 'deny').slice(0, 4),
          coreMidSame: (function () {
            const c = segmentLabelsCore(decomposeCommand('env sudo find . -exec doas sudo {} ;', 'bash').segments[0].words)
            return { labels: c.labels, widened: c.widened }
          })(),
          allowMidSame: allowQ54E('env sudo find . -exec doas sudo {} ;', 'sudo *').action,
          allowMidOther: allowQ54E('env sudo find . -exec doas sudo {} ;', 'doas *').action }))
    }
  }

  // ── 54A：`widened` 的**逐条不同名**形态必须线性（发现 2 的性能守卫）──────────────────
  // `segmentLabelsCore` 的 `widened` 数组用 `indexOf` 查重，而 `find -exec` 载荷族会为
  // **每个** `-exec` 各推一个名字 —— 逐条**不同名**时就是 O(n²)。本批改动**新引入**
  // `widened` 概念（HEAD 无它），故这是本批的退化。
  // 实测（`sudo find . (-exec c_i {} +)×n`、`segmentLabels` 单次、修复前）：
  //   n=1000 → 0.52 ms、2000 → 1.62、4000 → 5.50、**8000 → 21.04 ms**（倍率 4.91，标准平方）；
  //   而**同一个** payload 名时 `widened` 长度恒 1、`indexOf` 退化成 O(1)，n=8000 仅
  //   **1.42 ms**（线性）—— 平方因子就是 `indexOf` 本身。
  //
  // ⚠️ 为什么现有 54f 照不出它：54f 用**同一个** payload 名（`diskpart`）重复，`widened`
  // 长度恒 1 —— 结构性照不出。故本组必须用**逐条不同名**的语料，并**同时**钉住同名对照
  // （证明本组测的确实是那条判据：若同名形态也测出平方，说明平方来自别处）。
  //
  // 判据用倍率（n 翻倍时线性 ≈×2、平方 ≈×4，取 ×3.0 分界）+ 绝对上限，与 54m/54f/54v 同范式。
  {
    // 逐条不同名：`cmd0` / `cmd1` / …（**全部不同**，故 `widened` 会线性增长）
    const buildDistinct = (n) => {
      const w = ['sudo', 'find', '.']
      for (let i = 0; i < n; i += 1) w.push('-exec', 'cmd' + i, '{}', '+')
      return w
    }
    // 对照：**同一个** payload 名（`widened` 长度恒 1）
    const buildSame = (n) => {
      const w = ['sudo', 'find', '.']
      for (let i = 0; i < n; i += 1) w.push('-exec', 'echo', '{}', '+')
      return w
    }
    const timeLabels = (w) => timeBest(() => segmentLabels(w))
    const d4000 = timeLabels(buildDistinct(4000))
    const d8000 = timeLabels(buildDistinct(8000))
    const ratioD = d8000 / Math.max(d4000, 0.001)
    const s8000 = timeLabels(buildSame(8000))
    ok('★★ 54A `-exec c_i` 逐条不同名时 `segmentLabels` 必须线性（发现 2：`widened.indexOf` 的 O(n²)）',
      d8000 < 300 && ratioD < 3.0 && s8000 < 300
      // 对照（防空转）：构造的确实是 n 组 `-exec`（4 词元一组 + 3 个前缀词元）
      && buildDistinct(4000).length === 3 + 4000 * 4
      // 对照（防空转）：逐条不同名时 `widened` 真的线性增长（否则本组退化成「测了个空」）——
      // 这是**平方因子存在的充要前提**：名字全不同 ⇒ 每次 `indexOf` 都要扫完整个数组。
      && (() => {
        const w = buildDistinct(2000)
        const lb = segmentLabels(w)
        const uniq = new Set(lb)
        return uniq.size === lb.length && lb.length >= 2000
      })()
      // 对照（防空转）：**同名**形态下 `widened` 长度恒 1（`indexOf` 退化成 O(1)）——
      // 这正是「54f 用同名语料结构性照不出本缺陷」的证明。
      // 判据用 labels **去重后**的大小：同名时 `out` 会重复 push 同一个名字（该分支刻意不去重，
      // 见 54f 注释），故不能看 `labels.length`，要看**唯一名个数**。
      && new Set(segmentLabels(buildSame(8000))).size < new Set(segmentLabels(buildDistinct(8000))).size,
      JSON.stringify({ d4000: +d4000.toFixed(2), d8000: +d8000.toFixed(2), ratioD: +ratioD.toFixed(2),
        same8000: +s8000.toFixed(2),
        distinctUniq: new Set(segmentLabels(buildDistinct(8000))).size,
        sameUniq: new Set(segmentLabels(buildSame(8000))).size,
        distinctLabels: segmentLabels(buildDistinct(8000)).length,
        sameLabels: segmentLabels(buildSame(8000)).length }))
  }

  // ── 54B：**两词路由器 label** 的授权方向不变量（F1；54z 只覆盖单词 label）─────────
  // 根因：`headLabelAt` 把链尾 label **首词化**后写进 `out`（`addLabel(name.split(' ')[0])`），
  // 而对 `widened` 调用的是**未截断的两词** label。于是同一个链尾名字在两个集合里形态不一致：
  //     labels = ['find','sudo','git']   widened = ['git status']
  // 授权面（`assessCommand` 的 `labels.filter(l => !widenedSet.has(l))`）里 `git` **不在**
  // `widenedSet` 中 → 存活下来 → 被用户为普通 `git` 写下的 `git *`=allow 命中。
  // 实测（例外 `<router> *`=allow、其余 ask，修复前）：
  //     find . -exec sudo git status {} ;            → **allow**
  //     find . -exec sudo git push --force {} ;      → **allow**
  //     find . -exec sudo reg delete HKLM\X /f {} ;  → **allow**
  //     find . -execdir sudo reg delete HKLM\X /f {};→ **allow**
  //     find . -exec sudo docker rm -f x {} ;        → **allow**
  //     find . -exec sudo su root reg delete … {} ;  → **allow**
  // 而主路径 `sudo git status` 是 ask —— **同一条前缀语义两个结论**（不变量分叉）。
  //
  // ⚠️ 为什么 54z 结构性照不出这一格：它的语料是 `kill` / `shutdown` / `wmic` / `rm`，
  // 全是**单词** label —— 首词化对单词是恒等变换，两个集合天然一致，那条不一致根本不存在。
  // 只有**路由器命令**（`ROUTER_CMDS`：git / npm / docker / kubectl / reg …）的链尾才会
  // 产生两词 label，故本组必须用路由器语料。
  //
  // 判据取「载荷族与**主路径**同值」而不是「非 allow」：后者太弱 —— 组档（reg）仍会让
  // `reg delete` 命中 `reg` 档，只要该档不是 allow 就恒真，写成空转也照样绿。
  // 主路径 `sudo <router> …` 与载荷族 `find … -exec sudo <router> …` 是**同一个提权语义**，
  // 动作必须逐字相同（这正是 F1 修复前被击穿的那条不变量）。
  {
    // 例外 = `<router 首词> *`=allow、其余 ask：授权面一旦认了那个名字就会变 allow。
    const allowRouterOf = (cmd, pat) => run(cmd, 'bash', {
      exceptions: [pat], excAction: 'allow', platform: 'win32',
    })
    // 6 条点名形态（缺陷报告原文）—— 每条的例外都是它自己的路由器首词
    const named54B = [
      ['git *', 'find . -exec sudo git status {} ;'],
      ['git *', 'find . -exec sudo git push --force {} ;'],
      ['reg *', 'find . -exec sudo reg delete HKLM\\X /f {} ;'],
      ['reg *', 'find . -execdir sudo reg delete HKLM\\X /f {} ;'],
      ['docker *', 'find . -exec sudo docker rm -f x {} ;'],
      ['reg *', 'find . -exec sudo su root reg delete HKLM\\X /f {} ;'],
    ]
    const leaked54B = named54B.filter(([pat, c]) => allowRouterOf(c, pat).action === 'allow')
    // 全量叉乘：6 个路由器命令 × 4 个 `-exec` 族 flag × 7 种前缀形态
    const routers54B = ['git status', 'git push --force', 'reg delete HKLM\\X /f',
      'docker rm -f x', 'npm publish', 'kubectl delete pod x']
    const flags54B = ['-exec', '-execdir', '-ok', '-okdir']
    const prefixes54B = ['sudo ', 'doas ', 'pkexec ', 'su root ', 'env sudo ', 'timeout 5 sudo ', 'sudo su root ']
    const bad54B = []
    let n54B = 0
    for (const rc of routers54B) {
      const pat = String(rc).split(' ')[0] + ' *'
      for (const fl of flags54B) {
        for (const p of prefixes54B) {
          const cmd = 'find . ' + fl + ' ' + p + rc + ' {} ;'
          n54B += 1
          const got = allowRouterOf(cmd, pat).action
          const ref = allowRouterOf(p + rc, pat).action
          if (got !== ref) bad54B.push([pat, cmd, got, '主路径(' + p + rc + ')=' + ref])
          // 载荷族一旦 allow 就是**放宽**：它与主路径必须同为非 allow
          if (got === 'allow') bad54B.push(['★放宽', pat, cmd, got])
        }
      }
    }
    ok('★★ 54B 两词路由器 label 的授权方向不变量（F1：载荷族 `find -exec sudo <router> …` 不得被 `<router> *`=allow 授权）',
      leaked54B.length === 0 && bad54B.length === 0
      // 对照（防空转）：语料真的被遍历到了
      && n54B === routers54B.length * flags54B.length * prefixes54B.length
      // 对照（防空转）：**不带前缀**的载荷族仍可被该例外授权 —— 证明例外本身生效、
      // 上面不是「整条判据被关掉」（`find . -exec git status {} ;` 的 `git` 是用户写下
      // 这条例外的真实意图，HEAD 亦然）。
      && allowRouterOf('find . -exec git status {} ;', 'git *').action === 'allow'
      && allowRouterOf('find . -exec git status {} ;', 'git *').segments[0].source === 'exception'
      // 对照（防空转）：主路径本身在**无前缀**时确实是 allow（否则同值判据恒真）
      && allowRouterOf('git status', 'git *').action === 'allow'
      // 对照（收紧方向仍须认它）：deny 例外照常命中载荷族里的路由器 label
      && run('find . -exec sudo git status {} ;', 'bash', { exceptions: ['git *'], excAction: 'deny', platform: 'win32' }).action === 'deny'
      // 对照（**既有口径**：载荷族合成的是**单词** label，54s/54z 原文）——
      // 本修法只该修「两个集合形态不一致」，不得顺手把路由器子命令的粒度也改了
      && segmentLabels(decomposeCommand('find . -exec sudo reg delete HKLM\\X /f {} ;', 'bash').segments[0].words).join(',') === 'find,sudo,reg',
      JSON.stringify({ leaked54B, bad54B: bad54B.slice(0, 8), n54B,
        allowGitStatus: allowRouterOf('find . -exec sudo git status {} ;', 'git *').action,
        allowMainGit: allowRouterOf('sudo git status', 'git *').action,
        allowPlainFindExec: allowRouterOf('find . -exec git status {} ;', 'git *').action,
        labelsRegExecSudo: segmentLabels(decomposeCommand('find . -exec sudo reg delete HKLM\\X /f {} ;', 'bash').segments[0].words) }))
  }

  // ── 54C：**带前缀**的 `-exec` 载荷族必须线性（F2 的性能守卫）─────────────────────
  // `pushHeadLabels` 的链尾此前写 `segmentLabel(w.slice(i))`，而 `segmentLabelsCore` 对
  // **每个** `-exec` 都调一次 `headLabelAt` → `pushHeadLabels` —— 切片量随剩余词元数计费，
  // 段内 n 个 `-exec sudo cmd_i {} +` 累计 Σ(n−j) = **O(n²)**。
  // 实测 `isDestructiveSegment`（index.js 的 buildCandidates 对每段调一次、同步早于弹窗）：
  //   n=1000 → 2.3 ms、2000 → 6.9、4000 → 84.7、**8000 → 599 ms**（倍率 2.9/12.4/7.1）；
  //   对照**无前缀**的 `-exec cmd_i {} +`（`headLabelAt` 立即 return、根本不切片）同规模
  //   0.6/0.9/1.8/3.7 ms（倍率 1.5/2.0/2.1，线性）—— 平方因子就是那次 `w.slice(i)`。
  // 修法后同规模 0.8/1.6/3.2/6.3 ms（倍率 ≈2.0）。
  //
  // ⚠️ 为什么现有断言照不出：54A 的语料是 `-exec cmd_i`（**无前缀**，快路径立即 return，
  // 仍线性）；54f 用同一个 payload 名；54v 测的是**段内**前缀链（`sudo`×n）而不是
  // `-exec` 载荷族。三者都结构性照不出这一格，故必须单列本组。
  // 触发形态 `find . -exec sudo … {} +` 是 AI 常写的常规写法，不是构造输入。
  //
  // 判据用倍率（n 翻倍时线性 ≈×2、平方 ≈×4，取 ×3.0 分界）+ 绝对上限，与 54A/54f/54m/54v 同范式。
  {
    // 带前缀、逐条**不同名**（`widened` 与 `out` 都会线性增长，故同时钉住两个集合的写入）
    const buildPrefixed = (n) => {
      const w = ['find', '.']
      for (let i = 0; i < n; i += 1) w.push('-exec', 'sudo', 'cmd' + i, '{}', '+')
      return w
    }
    // 对照 ①：**无前缀**（`headLabelAt` 立即 return，不切片）
    const buildPlain = (n) => {
      const w = ['find', '.']
      for (let i = 0; i < n; i += 1) w.push('-exec', 'cmd' + i, '{}', '+')
      return w
    }
    // 对照 ②：带前缀但**同名**（`widened` 长度恒 1，只测切片本身）
    const buildSame = (n) => {
      const w = ['find', '.']
      for (let i = 0; i < n; i += 1) w.push('-exec', 'sudo', 'kill', '{}', '+')
      return w
    }
    // 对照 ③：**慢路径**（`-exec` 之后先是 wrapper，剥掉后才见提权前缀）。
    // 它此前走 `w.slice(j + 1)` + `unwrapWords(...)`，两处切片同样是 O(剩余词元数) ——
    // 与本组的主形态同族、同一条修法（都改走 `unwrapWordsFrom` 的下标内核）。
    // 实测修复前 `-exec env sudo cmd_i {} +`：n=1000 → 8.5 ms、2000 → 31.3、4000 → 350.2、
    // **8000 → 1925 ms**（倍率 3.7/11.2/5.5）；修复后 0.9/1.9/3.8/7.7 ms（倍率 ≈2.0）。
    const buildWrapper = (n) => {
      const w = ['find', '.']
      for (let i = 0; i < n; i += 1) w.push('-exec', 'env', 'sudo', 'cmd' + i, '{}', '+')
      return w
    }
    const timeDestructive = (w) => timeBest(() => isDestructiveSegment(w))
    const p4000 = timeDestructive(buildPrefixed(4000))
    const p8000 = timeDestructive(buildPrefixed(8000))
    const ratioP = p8000 / Math.max(p4000, 0.001)
    const pl8000 = timeDestructive(buildPlain(8000))
    const sm8000 = timeDestructive(buildSame(8000))
    const w4000 = timeDestructive(buildWrapper(4000))
    const w8000 = timeDestructive(buildWrapper(8000))
    const ratioW = w8000 / Math.max(w4000, 0.001)
    ok('★★ 54C 带前缀的 `-exec sudo cmd_i` 载荷族必须线性（F2：链尾 `w.slice(i)` 的 O(n²)）',
      p8000 < 300 && ratioP < 3.0 && pl8000 < 300 && sm8000 < 300
      // 慢路径（`-exec env sudo cmd_i`）同判据：它此前有两处同族切片
      && w8000 < 300 && ratioW < 3.0
      // 对照（防空转）：构造的确实是 n 组 `-exec sudo cmd_i {} +`（5 词元一组 + 2 个前缀词元）
      && buildPrefixed(4000).length === 2 + 4000 * 5
      // 对照（防空转）：慢路径构造的确实是 n 组 6 词元
      && buildWrapper(4000).length === 2 + 4000 * 6
      // 对照（防空转）：真命令名确实**可见**（否则「线性」可能来自提前放弃解析）——
      // 载荷族合成的是单词 label，`cmd0` 不在破坏性名单里，故用 `kill` 语料钉这一条
      && segmentLabels(buildSame(8)).indexOf('kill') !== -1
      // 对照（防空转）：**无前缀**对照确实走的是另一条路径（不切片），且两者量级可比 ——
      // 若把无前缀也测成平方，说明平方来自别处（本组的归因就错了）
      && timeDestructive(buildPlain(4000)) > 0,
      JSON.stringify({ p4000: +p4000.toFixed(2), p8000: +p8000.toFixed(2), ratioP: +ratioP.toFixed(2),
        plain8000: +pl8000.toFixed(2), same8000: +sm8000.toFixed(2),
        wrapper4000: +w4000.toFixed(2), wrapper8000: +w8000.toFixed(2), ratioW: +ratioW.toFixed(2),
        tokens: buildPrefixed(4000).length,
        labelsSame: segmentLabels(buildSame(8)) }))
  }

  // ── 54C2：**载荷无命令名**的 `-exec` 族必须线性（发现 3 的守卫）───────────────────
  // 54C 的语料全是**良构载荷**（`-exec sudo cmd_i {} +`：链立即终止在 `cmd_i` 上），
  // 结构上照不出本缺陷 —— 触发形态是**载荷里没有命令名**（`-exec sudo` 之后直接是
  // 下一个 `-exec`）：
  //     find . (-exec sudo)*n
  // 平方因子**不在**本批新增的关键字/wrapper 分支，而在 `skipPrefixArgs`：
  // 它把下一个 `-exec` 当成 `sudo` 的**选项**吃掉了（`w[4]='-exec'` 首字符码 45 → 走选项分支），
  // 于是推进循环每轮只前进一个词元、却把整条剩余链重扫一遍。
  // 消融证据：禁用关键字分支后三套件仍全绿、性能不变（该分支对本形态无贡献）；
  // 在循环入口加 `FIND_EXEC_FLAGS` 守卫**完全无效**（`-exec` 是在 `skipPrefixArgs`
  // **内部**被吃掉的）—— 故修法只能落在 `skipPrefixArgs` 内（`if (FIND_EXEC_FLAGS[token] === 1) break`）。
  //
  // ⚠️ 触发形态 `find . (-exec sudo)*n` 是**语法非法**的 find 命令（真实执行会报错），
  // 故严重度是 medium；但它是判定热路径上的平方退化（`isDestructiveSegment` 由 index.js
  // 对每段同步调用、早于弹窗），修法零风险，故仍单列本组守卫。
  //
  // 判据与 54C 同范式：倍率（线性 ≈×2、平方 ≈×4，取 ×3.0 分界）+ 绝对上限。
  {
    // 主形态：载荷**无命令名**（`-exec sudo` 后直接跟下一个 `-exec`）
    const buildNoName = (n, inner) => {
      const w = ['find', '.']
      for (let i = 0; i < n; i += 1) w.push('-exec', inner)
      return w
    }
    const timeSeg54C2 = (w) => timeBest(() => isDestructiveSegment(w))
    // 三种点名形态：`sudo` / `sudo time`（wrapper+关键字） / `su -`（提权前缀带选项）
    const n4000 = timeSeg54C2(buildNoName(4000, 'sudo'))
    const n8000 = timeSeg54C2(buildNoName(8000, 'sudo'))
    const ratioN = n8000 / Math.max(n4000, 0.001)
    const t4000 = timeSeg54C2(buildNoName(4000, 'sudo time'))
    const t8000 = timeSeg54C2(buildNoName(8000, 'sudo time'))
    const ratioT = t8000 / Math.max(t4000, 0.001)
    const s4000 = timeSeg54C2(buildNoName(4000, 'su -'))
    const s8000 = timeSeg54C2(buildNoName(8000, 'su -'))
    const ratioS = s8000 / Math.max(s4000, 0.001)
    ok('★★ 54C2 **载荷无命令名**的 `-exec` 族必须线性（发现 3：`skipPrefixArgs` 把下一个 `-exec` 当选项吃掉）',
      // 主形态：`find . (-exec sudo)*n`
      n8000 < 300 && ratioN < 3.0
      // 变体 ①：`find . (-exec sudo time)*n`（wrapper/关键字夹层）
      && t8000 < 300 && ratioT < 3.0
      // 变体 ②：`find . (-exec su -)*n`（提权前缀带选项）
      && s8000 < 300 && ratioS < 3.0
      // 对照（防空转）：构造的确实是 n 组 2 词元
      && buildNoName(4000, 'sudo').length === 2 + 4000 * 2
      // 对照（防空转）：该形态确实**判不出破坏性命令**（否则「线性」可能来自提前终止）——
      // 载荷里没有命令名，labels 只剩 `find`
      && segmentLabels(buildNoName(8, 'sudo')).indexOf('find') !== -1
      // 对照（防空转）：同规模下 54C 的良构形态仍是线性的（说明本组测的确实是另一条路径）
      && timeSeg54C2((() => { const w = ['find', '.']; for (let i = 0; i < 4000; i += 1) w.push('-exec', 'sudo', 'cmd' + i, '{}', '+'); return w })()) > 0,
      JSON.stringify({ noName4000: +n4000.toFixed(2), noName8000: +n8000.toFixed(2), ratioN: +ratioN.toFixed(2),
        sudoTime4000: +t4000.toFixed(2), sudoTime8000: +t8000.toFixed(2), ratioT: +ratioT.toFixed(2),
        su4000: +s4000.toFixed(2), su8000: +s8000.toFixed(2), ratioS: +ratioS.toFixed(2),
        tokens: buildNoName(4000, 'sudo').length, labels: segmentLabels(buildNoName(8, 'sudo')) }))
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // ── 60：本轮审查修复的回归守卫（发现 1 / 2 / 3）──────────────────────────────
  // 三条各自钉住一个方向的**行为**差异（不是源码文本断言），且都带防空转对照。
  // ═════════════════════════════════════════════════════════════════════════════

  // ── 60a：`unknown` 与已知档**并列**取最严（发现 1，方向 = 修 fail-open）──────────
  // 根因：`blastRadiusOfSegment` 的段级汇总里，`sawUnjudgeable` 只在「**没有任何**可判
  // 目标」时兜底成 `unknown`（`return sawUnjudgeable ? {level:'unknown', path:''} : null`）；
  // 一旦同段里还有一个**读得出**的目标，`unknown` 结论就被**整条丢弃**（`return worst`）。
  // 于是「读不出」与「已知目标」被当成了二选一，而它们是**并列**的两个事实：
  //     `rm -rf /etc $TARGET` 既确定会删 `/etc`（outside），又可能删任意路径（unknown）。
  //
  // 可观察差异只在「用户把 unknown 设得比胜出的已知档更严」时出现 —— 而 `unknown=deny`
  // 正是自然加固配置（读不懂的一律拒）。实测（修复前 → 修复后，unknown=deny、
  // outside=allow、wide=allow、其余 allow）：
  //     rm -rf $TARGET            deny/['unknown']           → deny/['unknown']            （不变）
  //     rm -rf /etc $TARGET       **allow**/['outside']      → **deny**/['unknown','outside']
  //     rm -rf $TARGET /etc       **allow**/['outside']      → **deny**/['unknown','outside']
  //     rm -rf /etc %USERPROFILE% **allow**/['outside']      → **deny**/['unknown','outside']
  //     dd of=$DEV of=/dev/sda    **allow**/['outside']      → **deny**/['unknown','outside']
  //     rm -rf C:/Windows $TARGET **allow**/['wide']         → **deny**/['wide','unknown']
  // 即「同一条命令里**多**一个读不出的目标，反而把 deny 放宽成 allow」—— 顺序无关。
  //
  // ⚠️ 判据必须**同时**钉两件事，缺一即为空转或过度收紧：
  //   ① `tiers` **同时**含 `unknown` 与胜出的已知档（证明是**并列**而不是「替换成 unknown」）；
  //   ② `blast` **仍显示**那个已知最严重的档（证明 `worst` 没被降级成模糊的 `unknown` ——
  //      弹窗文案不变，`blast.path` 仍是用户看得懂的 `/etc`）。
  // 反面：`rm -rf ./build $TARGET`（已知档是 inside）必须与 `rm -rf $TARGET` **同值** ——
  // `inside` 是唯一跟随大分类的档，不得因为并列 `unknown` 就凭空多出更严的档。
  {
    const mkDs60a = (over) => Object.assign(
      { inside: 'allow', outside: 'allow', wide: 'allow', unknown: 'deny', proc: 'allow', power: 'allow', priv: 'allow', reg: 'allow' }, over)
    // `unknown=deny` 是自然加固配置；其余七档全 allow —— 于是「非 allow」只可能来自 unknown
    // 档（防「靠别的档侥幸变严」的假绿灯）。
    const unkDeny = mkDs60a()
    const dOf60a = (cmd, ds) => assessCommand(cmd, 'bash', Object.assign(tierOpts('win32'), {
      destructive: () => ds, category: () => ({ action: 'allow' }), matchException: () => null,
    }))
    // 「已知目标 + 读不出目标」共存的形态：两者都在同一段里
    const mixed60a = [
      ['outside', 'rm -rf /etc $TARGET'],
      ['outside', 'rm -rf $TARGET /etc'],
      ['outside', 'rm -rf /etc %USERPROFILE%'],
      ['outside', 'dd of=$DEV of=/dev/sda'],
      ['wide', 'rm -rf C:/Windows $TARGET'],
      ['wide', 'rm -rf $TARGET C:/Windows'],
    ]
    const bad60a = []
    for (const [known, c] of mixed60a) {
      const r = dOf60a(c, unkDeny)
      const t = tiersOf(c, 'bash', 'win32')
      const b = blastOf(c, 'bash', 'win32')
      // ① 并列：tiers 同时含 unknown 与已知档；② blast 仍是已知那个（不被降级成 unknown）
      if (r.action !== 'deny') bad60a.push(['action', c, r.action])
      if (!t || t.indexOf('unknown') === -1) bad60a.push(['tiers-missing-unknown', c, t && t.join(',')])
      if (!t || t.indexOf(known) === -1) bad60a.push(['tiers-missing-known', c, t && t.join(',')])
      if (b === 'unknown') bad60a.push(['blast-downgraded', c, b])
    }
    ok('★★ 60a 段内「读不出的目标」与「已知目标」必须**并列**取最严（发现 1：unknown=deny 下 rm -rf /etc $TARGET 必须 deny，且 tiers 同时含 unknown 与 outside）',
      bad60a.length === 0
      // 对照（防空转）：**只有**读不出目标时本来就是 deny —— 说明上面那些格确实由本修法改动
      && dOf60a('rm -rf $TARGET', unkDeny).action === 'deny'
      && tiersOf('rm -rf $TARGET', 'bash', 'win32').join(',') === 'unknown'
      // 对照（防空转）：**只有**已知目标时是 allow（unknown 档根本没参与）——
      // 否则「加了 $TARGET 才变 deny」这句话无从谈起
      && dOf60a('rm -rf /etc', unkDeny).action === 'allow'
      && tiersOf('rm -rf /etc', 'bash', 'win32').join(',') === 'outside'
      && dOf60a('rm -rf C:/Windows', unkDeny).action === 'allow'
      // 对照（防过度收紧）：已知档是 `inside` 时**不得**凭空多出更严的档 ——
      // `rm -rf ./build $TARGET` 的 `blast` 是 `unknown`（半径侧整条归 unknown，`inside`
      // 不再并），故它的 `tiers` 与 `rm -rf $TARGET` 同值即可（两者都是 deny）
      && dOf60a('rm -rf ./build $TARGET', unkDeny).action === 'deny'
      && tiersOf('rm -rf ./build $TARGET', 'bash', 'win32').join(',') === 'unknown'
      // 对照（防过度收紧）：八档全 allow 时混合形态仍是 allow（并列只是「取最严」，
      // 不是无条件收紧）—— 与 58d 同一条纪律
      && dOf60a('rm -rf /etc $TARGET', mkDs60a({ unknown: 'allow' })).action === 'allow',
      JSON.stringify({ bad60a: bad60a.slice(0, 8),
        mixed: mixed60a.map(([k, c]) => [c, dOf60a(c, unkDeny).action, tiersOf(c, 'bash', 'win32'), blastOf(c, 'bash', 'win32')]),
        onlyUnknown: [dOf60a('rm -rf $TARGET', unkDeny).action, tiersOf('rm -rf $TARGET', 'bash', 'win32'), blastOf('rm -rf $TARGET', 'bash', 'win32')],
        onlyKnown: [dOf60a('rm -rf /etc', unkDeny).action, tiersOf('rm -rf /etc', 'bash', 'win32')],
        insideMix: [dOf60a('rm -rf ./build $TARGET', unkDeny).action, tiersOf('rm -rf ./build $TARGET', 'bash', 'win32')],
        allAllow: dOf60a('rm -rf /etc $TARGET', mkDs60a({ unknown: 'allow' })).action }))
  }

  // ── 60b：递归引号分支也必须把内层的「读不出」带上来（发现 1 的同一族）──────────────
  // `su -c "rm -rf $T" /` 的词元是 `['su','-c','rm -rf $T','/']`：含空格的词元走
  // `blastRadiusOfSegment` 的**递归引号分支**（`:4678`），内层得 `unknown`、外层 `/` 得
  // `drive-root`。修复前内层的 `unknown` 被外层更严重的已知档**整个顶替**（`worst = rs`
  // 只是换掉对象，那个事实随之丢失）—— 于是「在内层加一个读不出的目标」把结论从 deny
  // 放宽成 allow。实测（unknown=deny、其余 allow）：
  //     su -c "rm -rf $T"       deny/['unknown','priv']        → deny（不变）
  //     su -c "rm -rf $T" /     **allow**/['wide','priv']      → **deny**/['wide','unknown','priv']
  //     su -c "rm -rf $T" C:/Windows **allow**/['wide','priv'] → **deny**/['wide','unknown','priv']
  {
    const mkDs60b = (over) => Object.assign(
      { inside: 'allow', outside: 'allow', wide: 'allow', unknown: 'deny', proc: 'allow', power: 'allow', priv: 'allow', reg: 'allow' }, over)
    const dOf60b = (cmd, ds, sh) => assessCommand(cmd, sh || 'bash', Object.assign(tierOpts('win32'), {
      destructive: () => ds, category: () => ({ action: 'allow' }), matchException: () => null,
    }))
    const unkDeny60b = mkDs60b()
    // ⚠️ 语料只用**外层得已知档**的形态（那才是「顶替」的现场）：
    //   · `su -c "rm -rf $T" /`     → 外层 `/` 得 `drive-root`（内层 unknown 曾被它顶替）
    //   · `sudo su -c "rm -rf $T" /` → 同上，多一层提权前缀
    //   · `runas /user:a "rm -rf $T" C:\`（pwsh 词法）→ 外层 `C:\` 得 `drive-root`
    // ⚠️ `cmd /c "del $F" C:\` **不能用**：`del` 不在 DESTRUCTIVE_LABELS 里，故该段
    // `destructive=false`、`tiers` 为空（本修法根本不参与），与递归分支无关。
    // ⚠️ `cmd /c "…" C:\` 在 **bash 词法**下 `ok:false`（the command line ends inside an
    // escape，实测）—— 那是词法器对反斜杠转义的边界，也不是本修法的现场。
    const rec60b = [['bash', 'su -c "rm -rf $T" /'], ['bash', 'sudo su -c "rm -rf $T" /'],
      ['pwsh', 'runas /user:a "rm -rf $T" C:\\'], ['pwsh', 'runas /user:a "del $F" C:\\']]
    const bad60b = rec60b.filter(([sh, c]) => {
      const t = tiersOf(c, sh, 'win32')
      return !t || t.indexOf('unknown') === -1
    })
    ok('★★ 60b 递归引号分支：内层「读不出」不得被外层更严重的已知档顶替（发现 1 同族：su -c "rm -rf $T" / 必须非 allow）',
      bad60b.length === 0
      // 端到端：`unknown=deny` 下这四条都必须 deny（修复前前两条是 allow）
      && rec60b.every(([sh, c]) => dOf60b(c, unkDeny60b, sh).action === 'deny')
      // 对照（防空转）：这些形态的 `blast` **确实**是外层那个已知档（不是 unknown）——
      // 即「顶替」的现场真的存在，`unknown` 只能来自本修法的并列置位
      && rec60b.every(([sh, c]) => blastOf(c, sh, 'win32') && blastOf(c, sh, 'win32') !== 'unknown')
      // 对照（防空转）：内层**没有**读不出目标时不得凭空多出 unknown 档
      && tiersOf('su -c "rm -rf /etc" /', 'bash', 'win32').indexOf('unknown') === -1
      && tiersOf('su -c "rm -rf ./build"', 'bash', 'win32').indexOf('unknown') === -1
      // 对照（防过度收紧）：八档全 allow 时仍是 allow
      && dOf60b('su -c "rm -rf $T" /', mkDs60b({ unknown: 'allow' })).action === 'allow',
      JSON.stringify({ bad60b, rec: rec60b.map(([sh, c]) => [sh, c, dOf60b(c, unkDeny60b, sh).action, tiersOf(c, sh, 'win32'), blastOf(c, sh, 'win32')]),
        noUnk: [tiersOf('su -c "rm -rf /etc" /', 'bash', 'win32'), tiersOf('su -c "rm -rf ./build"', 'bash', 'win32')],
        allAllow: dOf60b('su -c "rm -rf $T" /', mkDs60b({ unknown: 'allow' })).action }))
  }

  // ── 60c：普通命令的 allow 例外标注**恒为 null**（发现 2，方向 = 去假警告）──────────
  // 根因：`blastRadiusOfCommandPattern` 的兜底原写 `return blastRadiusOfSegment(w, opts)`，
  // 而那条路会把 §5.5 新加的 `isWorkspaceRoot` 钩子接进来 —— `sudo ls *` / `env ls *` /
  // `nohup ls *` 的 `*` 经 `globRootOf` 归约为 `.`，宿主 `isWorkspaceRoot('.')` 恒真，
  // 于是得到 `{level:'workspace-root', path:'.'}`（HEAD 下这些形态全是 `null`）。
  // 后果是**面板假警告**：一条**放行不了任何删除命令**的 allow 例外被标成「目标是本项目根
  // 目录 —— 整个项目的文件都会被删除」，而 client.js 的文案对 `sudo ls *` 就是假话。
  //
  // ⚠️ 判据用**带 isWorkspaceRoot 钩子**的 opts（`tierOpts`）—— 这正是宿主生产路径的形态，
  // 也是唯一能照出本缺陷的形态：L46b 用的 `bOpts` **没有**这个钩子，故它在修复前照样绿
  // （实测：本组是 `sudo ls *` 那一族假警告的唯一观测点）。
  //
  // ⚠️ 必须同时钉「破坏性命令仍正常标注」的正向对照，否则「恒返回 null」这种退化也会通过。
  {
    const cpLvl60c = (p) => {
      const r = blastRadiusOfCommandPattern(String(p).split(/\s+/), tierOpts('win32'))
      return r ? r.level : null
    }
    // 「放行不了任何删除命令」的普通命令 + 前缀（前缀名本身在 PAYLOAD_CARRIERS 里，
    // 故它们能走到这条兜底 —— 见函数里那段注释）
    const normal60c = ['sudo ls *', 'env ls *', 'nohup ls *', 'timeout 5 ls *', 'xargs ls *',
      'stdbuf -o0 ls *', 'sudo -u root ls *', 'doas cat *', 'pkexec echo *', 'git status *',
      'reg add *', 'reg query *', 'sc *', 'net *', 'schtasks *']
    const falseWarn60c = normal60c.filter((p) => cpLvl60c(p) !== null)
    ok('★★ 60c 普通命令的 allow 例外标注**恒为 null**（发现 2：sudo ls * / env ls * / nohup ls * 不得被标成「删整个项目」）',
      falseWarn60c.length === 0
      // 正向对照：**破坏性 / 载荷 / 嵌套 shell 三类仍必须正常标注**（本修法不得误伤）
      && cpLvl60c('rm -rf *') === 'broad' && cpLvl60c('sudo rm -rf *') === 'broad'
      && cpLvl60c('find *') === 'broad' && cpLvl60c('env *') === 'broad' && cpLvl60c('xargs *') === 'broad'
      && cpLvl60c('sh *') === 'broad' && cpLvl60c('sudo sh *') === 'broad'
      && cpLvl60c('/usr/bin/rm *') === 'broad' && cpLvl60c('rmdir /s /q *') === 'broad'
      && cpLvl60c('timeout 5 *') === 'broad' && cpLvl60c('git rm *') === 'broad'
      // 正向对照：带**具体**目标的一族（走 `rest.some(非通配)` 早退、不经过本兜底）
      // 仍必须给出具体档 —— 钉住「本修法只影响『只剩通配』那一支」
      && cpLvl60c('rm -rf /*') === 'drive-root' && cpLvl60c('rmdir /s /q C:\\Windows') === 'system'
      // 对照（防空转）：同一批普通命令在**无钩子**时本来也是 null（说明差异确实来自钩子接线）
      && normal60c.every((p) => {
        const o = tierOpts('win32')
        delete o.isWorkspaceRoot
        const r = blastRadiusOfCommandPattern(String(p).split(/\s+/), o)
        return (r ? r.level : null) === null
      }),
      JSON.stringify({ falseWarn60c,
        normal: normal60c.map((p) => [p, cpLvl60c(p)]),
        danger: ['rm -rf *', 'find *', 'env *', 'sh *', '/usr/bin/rm *', 'timeout 5 *', 'git rm *'].map((p) => [p, cpLvl60c(p)]),
        concrete: ['rm -rf /*', 'rmdir /s /q C:\\Windows', 'sudo cat /etc', 'sudo ls /etc'].map((p) => [p, cpLvl60c(p)]) }))
    // 同一条纪律的**宿主口径**复核：`sudo cat /etc` 一族（带具体目标）必须仍有 `outside` 标注
    // —— 本修法**不得**把它们一起抹成 null（那是漏报，方向相反）。
    ok('★ 60c2 对照：带具体目标的例外仍正常标注（sudo cat /etc → outside；本修法只影响「只剩通配」那一支）',
      cpLvl60c('sudo cat /etc') === 'outside' && cpLvl60c('sudo ls /etc') === 'outside'
      && cpLvl60c('sudo ls /*') === 'drive-root' && cpLvl60c('sudo ls C:\\Windows\\*') === 'system',
      JSON.stringify(['sudo cat /etc', 'sudo ls /etc', 'sudo ls /*', 'sudo ls C:\\Windows\\*'].map((p) => [p, cpLvl60c(p)])))
  }

  // ── 60d：整行读不懂分支的 `tiers` 必须与 `TIER_ORDER` 同序（发现 3）──────────────
  // 根因：`assessCommand` 整行读不懂分支的 `tiers` 是**手工拼接**的
  // （`groupTiersOf(names)` → `push('priv')` → `push('wide')` → `push('unknown')` →
  // `push('inside')`），**未经 `TIER_ORDER` 排序**；而 `decisiveTierOf` 的注释声称
  // 「并列时取 `tiers` 里**靠前**的那个（`tiers` 已是固定顺序，故结论稳定）」——
  // 那条稳定性论证只对 `tierSetOf` 的产物成立（它在返回前按 `TIER_RANK` 排过）。
  //
  // 可观察差异是**动作不变、拒绝理由随书写形态漂移**。实测（wide=deny + priv=deny +
  // proc=deny，三档各带不同 `reasons`）：
  //     sudo kill 1234            → deny，理由取 `proc`（段级：tiers 已排序 → proc 在 priv 前）
  //     sudo kill 1234 <<EOF…EOF  → deny，理由取 **`priv`** ← 同一动作，只因多了个 heredoc
  //
  // 判据（三条，缺一即为空转或误报）：
  //   ① **同一命令的各种读不懂写法之间** `action`/`reason` 必须**逐字一致**
  //      （同一裁决不得因书写形态而漂移 —— 这是「稳定」的直接可观察形式）；
  //   ② 且它们必须与**不带构造**的同一命令一致（该分支的既有语义：读不懂构造不改变
  //      哪些档参与，只改变「半径侧读不出」这件事 —— 半径档全 ask 时两者同值）；
  //   ③ 理由必须取自**手工拼接集合里 `TIER_ORDER` 最前**的那个 deny 档 ——
  //      这是「已按 `TIER_RANK` 排序」的等价观测点（排序的下游就是 `decisiveTierOf`）。
  //
  // ⚠️ 判据 ③ 用**复刻的档位集合**（`groupTiersOf` + `segmentPrivilege` + 三档 push）
  // 算出期望值，而不是断言某个写死的档名 —— 后者会把「集合本身拼错了」也算成通过。
  //
  // ⚠️ 配置取**半径档全 ask**（只留组档 deny）：此时 ① / ② 才成立 —— 若 `wide` 也是 deny，
  // 那么读不懂写法会**合法地**多命中一个 `wide` 档（§7.2 的 `wide ∪ unknown` 并入是有意设计），
  // 于是它与 plain 形态本就不同值。把 `wide` 设为 deny 的格留给 ③（用 oracle 算期望）。
  {
    const mkDs60d = (over) => Object.assign(
      { inside: 'ask', outside: 'ask', wide: 'ask', unknown: 'ask', proc: 'ask', power: 'ask', priv: 'ask', reg: 'ask' }, over)
    const R60d = { wide: 'WIDE-REASON', unknown: 'UNKNOWN-REASON', outside: 'OUTSIDE-REASON', inside: 'INSIDE-REASON', proc: 'PROC-REASON', power: 'POWER-REASON', priv: 'PRIV-REASON', reg: 'REG-REASON' }
    const h60dOf = (ds) => Object.assign(tierOpts('win32'), {
      destructive: () => Object.assign({}, ds, { reasons: R60d }), category: () => ({ action: 'allow' }), matchException: () => null,
    })
    // 整行读不懂的六种构造（heredoc 完整 / 悬空重定向 / 未闭合引号 / 悬空 && / 悬空 heredoc 头）
    const unreadable60d = (c) => [c + ' <<EOF\nbody\nEOF', c + ' >', c + ' "unclosed', c + ' &&', c + ' <<EOF', c + ' <<']
    const bases60d = ['sudo kill 1234', 'kill 1234', 'sudo reg delete HKLM\\X /f', 'sudo rm -rf /data',
      'sudo taskkill /im x.exe', 'sudo shutdown /s', 'sudo wmic process delete', 'sudo find / -delete']
    // ① / ②：半径档全 ask、组档多档 deny 的几种配置
    const cfgs60d = [
      ['priv+proc', mkDs60d({ priv: 'deny', proc: 'deny' })],
      ['proc only', mkDs60d({ proc: 'deny' })],
      ['priv only', mkDs60d({ priv: 'deny' })],
      ['reg+priv', mkDs60d({ reg: 'deny', priv: 'deny' })],
      ['power+priv', mkDs60d({ power: 'deny', priv: 'deny' })],
    ]
    const bad60d = []
    let n60d = 0
    for (const [name, ds] of cfgs60d) {
      const h = h60dOf(ds)
      for (const c of bases60d) {
        const plain = assessCommand(c, 'bash', h)
        for (const f of unreadable60d(c)) {
          n60d += 1
          const got = assessCommand(f, 'bash', h)
          if (got.action !== plain.action || got.reason !== plain.reason) {
            bad60d.push([name, f.replace(/\n/g, '\\n'), got.action + '/' + got.reason, plain.action + '/' + plain.reason])
          }
        }
      }
    }
    // ③：oracle —— 复刻手工拼接集合 + 按 `TIER_ORDER` 排序后取最严档的理由
    const rankOf60d = (t) => { const i = TIER_ORDER.indexOf(t); return i === -1 ? 99 : i }
    const oracle60d = (ds, src) => {
      const names = rawCommandNames(String(src))
      const tiers = groupTiersOf(names)
      if (segmentPrivilege(names)) tiers.push('priv')
      tiers.push('wide'); tiers.push('unknown'); tiers.push('inside')
      const sorted = tiers.slice().sort((a, b) => rankOf60d(a) - rankOf60d(b))
      const t = decisiveTierOf(ds, sorted)
      const act = strictestTierAction(ds, sorted)
      return { action: act, reason: (act === 'deny' && t && R60d[t]) ? R60d[t] : null, tier: t, sorted }
    }
    const bad60dOracle = []
    let n60dOracle = 0
    for (const [, ds] of cfgs60d.concat([['all deny', mkDs60d({ wide: 'deny', unknown: 'deny', proc: 'deny', priv: 'deny', reg: 'deny', power: 'deny' })]])) {
      const h = h60dOf(ds)
      for (const c of bases60d) for (const f of unreadable60d(c)) {
        n60dOracle += 1
        const exp = oracle60d(ds, f)
        const got = assessCommand(f, 'bash', h)
        if (got.action !== exp.action || got.reason !== exp.reason) {
          bad60dOracle.push([f.replace(/\n/g, '\\n'), exp.action + '/' + exp.reason, got.action + '/' + got.reason, exp.tier])
        }
      }
    }
    ok('★★ 60d 整行读不懂分支的 tiers 必须与 TIER_ORDER 同序（发现 3：sudo kill 1234 <<EOF 与 sudo kill 1234 在 wide=deny+priv=deny 下理由必须一致）',
      bad60d.length === 0 && bad60dOracle.length === 0
      // 对照（防空转）：语料真的被遍历到了
      && n60d === cfgs60d.length * bases60d.length * 6 && n60dOracle === 6 * bases60d.length * 6
      // 对照（防空转）：**排序真的会改变 `decisiveTierOf` 的选择** ——
      // 未排序的 `['priv','proc']` 取 priv，排序后（proc 在 TIER_ORDER 里靠前）取 proc；
      // 两者都是 deny 但理由不同。少了这条，本断言对「排序是恒等变换」也会绿。
      && TIER_ORDER.indexOf('proc') < TIER_ORDER.indexOf('priv')
      && decisiveTierOf({ proc: 'deny', priv: 'deny' }, ['priv', 'proc']) === 'priv'
      && decisiveTierOf({ proc: 'deny', priv: 'deny' }, ['proc', 'priv']) === 'proc'
      // 对照（防空转）：该配置下**确实**有多档并列 deny（否则「理由一致」可能是只有一个档）
      && cfgs60d[0][1].proc === 'deny' && cfgs60d[0][1].priv === 'deny'
      // 对照（防空转）：报告里那条具体案例 —— 修复前读不懂形态取 `priv`、排序后取 `proc`
      // （`wide` 也 deny 时取 `wide`，见下面那条）。这里用**只有组档 deny** 的配置，
      // 使差异完全由排序决定（没有 wide 参与）。
      && assessCommand('sudo kill 1234', 'bash', h60dOf(cfgs60d[0][1])).reason === 'PROC-REASON'
      && assessCommand('sudo kill 1234 <<EOF\nbody\nEOF', 'bash', h60dOf(cfgs60d[0][1])).reason === 'PROC-REASON'
      // 对照（防空转）：**wide 也 deny** 时读不懂形态取 `wide`（§7.2 的 wide 并入是有意设计，
      // 与 plain 形态合法地不同值）—— 钉住「本修法没有把 wide 档挤掉」
      && assessCommand('sudo kill 1234', 'bash', h60dOf(mkDs60d({ wide: 'deny', priv: 'deny' }))).reason === 'PRIV-REASON'
      && assessCommand('sudo kill 1234 <<EOF\nbody\nEOF', 'bash', h60dOf(mkDs60d({ wide: 'deny', priv: 'deny' }))).reason === 'WIDE-REASON'
      // 对照（防过度收紧）：**单档 deny** 配置下两者理由也必须一致（本修法对单档无副作用）。
      // 取**组档**单档（`proc`）而不是 `wide` 单档 —— 后者下 plain 形态走段级路径、
      // `tiers` 里根本没有 `wide`（`sudo kill 1234` 是 ask/null），而读不懂形态按 §7.2
      // **合法地**并入 `wide` 从而 deny：两者本就不同值，那不是本修法的作用面。
      && (() => {
        const hOne = h60dOf(mkDs60d({ proc: 'deny' }))
        const a = assessCommand('sudo kill 1234', 'bash', hOne)
        const b = assessCommand('sudo kill 1234 <<EOF\nbody\nEOF', 'bash', hOne)
        return a.action === b.action && a.reason === b.reason && a.reason === 'PROC-REASON'
      })(),
      JSON.stringify({ bad60d: bad60d.slice(0, 6), bad60dOracle: bad60dOracle.slice(0, 6), n60d, n60dOracle,
        sample: bases60d.map((c) => [c, assessCommand(c, 'bash', h60dOf(cfgs60d[0][1])).reason,
          unreadable60d(c).map((f) => assessCommand(f, 'bash', h60dOf(cfgs60d[0][1])).reason)]),
        wideDeny: ['sudo kill 1234', 'sudo kill 1234 <<EOF\nbody\nEOF'].map((c) => assessCommand(c, 'bash', h60dOf(mkDs60d({ wide: 'deny', priv: 'deny' }))).reason),
        order: TIER_ORDER }))
  }

  // ── 60e：decisive 档无理由时，理由回落到**并列在最严档**的命中档（发现 6）─────────
  // 根因：`tierSetOf` 在 `unjudgeable` 时**恒并** `unknown`（发现 1 的修法），而
  // `TIER_ORDER` 里 `unknown` 排第 1、`outside` 排第 3 —— 并列时 `decisiveTierOf` 取
  // **靠前者**，于是 decisive 档从 `outside` 变成 `unknown`。而 `unknown` 档常常
  // **没有**用户写下的理由（用户为 `outside` 写过、没为它写过）——
  // 于是**动作仍是 deny、用户写的那句拒绝理由整句丢失**：
  //     rm -rf /etc          → deny，理由「删工作区外文件」✅
  //     rm -rf /etc $TARGET  → deny，理由 **null** ❌（tiers = ['unknown','outside']）
  // 这不是 fail-open（动作始终 deny），但 AI 收到的拒绝指令是空的，而面板上那句理由
  // 仍显示在 outside 档（`explicitReasonsOf` 的口径）—— 「看得见理由、AI 收不到理由」，
  // 与「面板说谎」同族。
  //
  // 判据（缺一即为空转 / 过度 / 跨严格度取档）：
  //   ① 主现场：unknown 无理由 + outside 有理由 → 理由必须回落到 `OUTSIDE-REASON`；
  //   ② **动作不变**：同一格 action 必须仍是 `deny`，且与「unknown 也有理由」那格同值；
  //   ③ **面板口径不变**：`tiers` 仍**同时**含 `unknown` 与 `outside`（并列没被消掉，
  //      顺序仍是 `TIER_ORDER`），`blast` 仍是 `outside`（弹窗文案不变）；
  //   ④ 防空转：断言「decisive 档**确实**是 `unknown`，且它**确实没有**理由」——
  //      少了这条，一个「decisive 档本来就有理由」的语料也能让 ① 变绿；
  //   ⑤ 防空转（回落不越权）：unknown **也**有理由时必须取 `UNKNOWN-REASON`；
  //   ⑥ 防空转（不凭空造理由）：**没有任何**命中档写过理由时仍必须是 `null`；
  //   ⑦ **防跨严格度**：unknown=deny + outside=**ask** 且只有 outside 有理由时必须是
  //      `null` —— 更松的档本来就不是这次裁决的一票，它的理由不属于本次拒绝；
  //   ⑧ 同族的**组档**：`sudo rm -rf /etc $TARGET`（tiers 含 unknown/outside/priv）
  //      在只有 `priv` 有理由时取 `PRIV-REASON`（回落不限于半径档）；
  //   ⑨ 对照（无副作用）：`unknown=allow` 时并列但不参与 deny，理由本来就来自 outside
  //      —— 必须与修复后同值（本修法只补回落，不改这种格的结论）。
  //
  // ⚠️ 配置取**八档全 deny**（用户逐档显式设成 deny 的形态；`unknown` 档因此是
  // **用户设过动作、但没为它写过理由**的那一档 —— 这正是复现现场的真实形态）。
  {
    const mkDs60e = (over) => Object.assign(
      { inside: 'deny', outside: 'deny', wide: 'deny', unknown: 'deny', proc: 'deny', power: 'deny', priv: 'deny', reg: 'deny' }, over)
    const h60eOf = (ds, reasons) => Object.assign(tierOpts('win32'), {
      destructive: () => (reasons ? Object.assign({}, ds, { reasons }) : ds),
      category: () => ({ action: 'allow' }), matchException: () => null,
    })
    const OUT60e = 'OUTSIDE-REASON'
    const UNK60e = 'UNKNOWN-REASON'
    const PRIV60e = 'PRIV-REASON'
    const v60e = (c, ds, reasons) => assessCommand(c, 'bash', h60eOf(ds, reasons))
    const allDeny60e = mkDs60e()
    // 「已知目标 + 读不出目标」同段共存的形态（tiers 里 unknown 与已知档**并列**）
    const mixed60e = ['rm -rf /etc $TARGET', 'rm -rf $TARGET /etc', 'dd of=$DEV of=/dev/sda']
    const bad60e = []
    for (const c of mixed60e) {
      const t = tiersOf(c, 'bash', 'win32')
      const r = v60e(c, allDeny60e, { outside: OUT60e })
      const b = blastOf(c, 'bash', 'win32')
      // ④ 前提成立：decisive 档是 unknown，且它**没有**理由（否则本判据是空转）
      if (decisiveTierOf(allDeny60e, t) !== 'unknown') bad60e.push(['decisive-not-unknown', c, decisiveTierOf(allDeny60e, t)])
      if (allDeny60e.reasons !== undefined) bad60e.push(['ds-has-reasons', c, 'unexpected'])
      // ① 理由回落到带理由的命中档
      if (r.reason !== OUT60e) bad60e.push(['reason-not-fallen-back', c, String(r.reason)])
      // ② 动作不变
      if (r.action !== 'deny') bad60e.push(['action', c, r.action])
      if (r.action !== v60e(c, allDeny60e, { outside: OUT60e, unknown: UNK60e }).action) bad60e.push(['action-drift', c, r.action])
      // ③ 面板口径不变：tiers 并列仍在（顺序即 TIER_ORDER）、blast 仍是已知那个
      if (!t || t.indexOf('unknown') === -1 || t.indexOf('outside') === -1) bad60e.push(['tiers', c, t && t.join(',')])
      if (t && t.join(',') !== 'unknown,outside') bad60e.push(['tiers-order', c, t.join(',')])
      if (b !== 'outside') bad60e.push(['blast', c, String(b)])
      // ⑤ 回落不越权：unknown 也有理由时取 unknown（decisive 档优先）
      if (v60e(c, allDeny60e, { outside: OUT60e, unknown: UNK60e }).reason !== UNK60e) {
        bad60e.push(['unknown-reason-not-preferred', c, String(v60e(c, allDeny60e, { outside: OUT60e, unknown: UNK60e }).reason)])
      }
    }
    const sudo60e = 'sudo rm -rf /etc $TARGET'
    const tSudo60e = tiersOf(sudo60e, 'bash', 'win32')
    ok('★★ 60e decisive 档（unknown）无理由时，拒绝理由必须回落到**并列在最严档**的命中档（发现 6：rm -rf /etc $TARGET 必须带回 outside 档写下的理由）',
      bad60e.length === 0
      // ⑥ 不凭空造理由：一个命中档都没写过理由 → 仍是 null
      && mixed60e.every((c) => v60e(c, allDeny60e, undefined).reason === null
        && v60e(c, allDeny60e, {}).reason === null
        && v60e(c, allDeny60e, { inside: 'INSIDE-REASON' }).reason === null)
      // ⑦ 防跨严格度：outside 是 **ask**（不是这次 deny 裁决的一票）→ 不得拿它的理由
      && mixed60e.every((c) => v60e(c, mkDs60e({ outside: 'ask' }), { outside: OUT60e }).reason === null
        && v60e(c, mkDs60e({ outside: 'ask' }), { outside: OUT60e }).action === 'deny')
      // ⑧ 同族的组档：unknown/outside 都没理由、只有 priv 有 → 取 priv 的理由
      && tSudo60e.indexOf('priv') !== -1
      && v60e(sudo60e, allDeny60e, { priv: PRIV60e }).reason === PRIV60e
      && v60e(sudo60e, allDeny60e, { outside: OUT60e, priv: PRIV60e }).reason === OUT60e
      // ⑨ 对照（无副作用）：unknown=allow 时并列但不参与 deny，理由本来就来自 outside
      && mixed60e.every((c) => v60e(c, mkDs60e({ unknown: 'allow' }), { outside: OUT60e }).reason === OUT60e)
      // 对照（防空转）：语料真的走到了「decisive 档无理由」这条路上
      && mixed60e.every((c) => decisiveTierOf(allDeny60e, tiersOf(c, 'bash', 'win32')) === 'unknown')
      // 对照（防空转）：`outside` 档**确实**是 `TIER_ORDER` 里 unknown 之后的那个命中档
      // —— 少了这条，一个「tiers 里根本没有 outside」的语料也能让 ① 变绿
      && TIER_ORDER.indexOf('unknown') < TIER_ORDER.indexOf('outside')
      && mixed60e.every((c) => tiersOf(c, 'bash', 'win32').indexOf('outside') !== -1),
      JSON.stringify({ bad60e: bad60e.slice(0, 8),
        mixed: mixed60e.map((c) => [c, v60e(c, allDeny60e, { outside: OUT60e }).action,
          v60e(c, allDeny60e, { outside: OUT60e }).reason, tiersOf(c, 'bash', 'win32'), blastOf(c, 'bash', 'win32')]),
        noReason: mixed60e.map((c) => v60e(c, allDeny60e, undefined).reason),
        looser: mixed60e.map((c) => [v60e(c, mkDs60e({ outside: 'ask' }), { outside: OUT60e }).action,
          v60e(c, mkDs60e({ outside: 'ask' }), { outside: OUT60e }).reason]),
        sudo: [tSudo60e, v60e(sudo60e, allDeny60e, { priv: PRIV60e }).reason,
          v60e(sudo60e, allDeny60e, { outside: OUT60e, priv: PRIV60e }).reason],
        unknownAllow: mixed60e.map((c) => v60e(c, mkDs60e({ unknown: 'allow' }), { outside: OUT60e }).reason),
        order: [TIER_ORDER.indexOf('unknown'), TIER_ORDER.indexOf('outside')] }))
  }

  // ── 60f：`unknown` 的三条产出判据**不得被半径档门控挡住**（纯组档段的 fail-open）─────
  //
  // 根因：`tierSetOf` 的 ① 分支把 `unknown` 的产出判据写在**半径档门控之内**
  // （`if (hasPureRadius || (hasPrivGroup && seg.blast))`），而门控对**纯组档段**
  // （proc / power / reg，段内无 del/disk/perm/priv 组 label）整段跳过 —— 于是
  // `blastRadiusOfSegment` 给出的 `{level:'unknown'}` 被丢弃、不参与取最严。
  //
  // 门控存在的**唯一**正当理由是「不给 `kill 1234` 白送 inside 档」
  // （`radiusTierOf(null)` 把「没判过」当成「判过且在区内」），它不该连带挡住 `unknown`。
  // 实测（`unknown=deny`、其余七档 allow，修复前）：
  //     kill $T / shutdown $T / reg delete $T /f / taskkill /pid $T
  //         → 全部 **allow**（tiers 只有组档）
  //     对照 sudo kill $T → deny（tiers=['unknown','proc','priv']）
  //          rm -rf $T    → deny（tiers=['unknown']）
  // 即**同一条「目标读不出」的结论**，只因命令属组档就静默 allow；加 `sudo` 前缀立刻
  // deny —— 同一语义两个结论的不变量分叉，方向 fail-open。
  //
  // 判据（四条，缺一即为「只修一支」）：
  //   ① 组档段族（带读不出的目标）必须 `deny` 且 `tiers` 含 `unknown`；
  //   ② **`sudo` 形态同值对照**（同一语义不得两个结论）；
  //   ③ **opaque 组档段族**（`(kill 1234)` / `kill $(cat p)` / `shutdown $(date)`）——
  //      这一族走的是**第三条**判据（`seg.opaque && !seg.blast`：`words` 里一个目标词元
  //      都没留下，`sawUnjudgeable` 与 `isUnknownTierSegment` 双双够不到）。只补前两条时
  //      它仍是 allow，故必须单列；
  //   ④ 防空转：`kill 1234`（**无**目标、blast=null）必须仍 `allow` 且 `tiers` 不含
  //      `unknown` —— 少了这条，一个「见组档就并 unknown」的过度修法也能让 ① 变绿。
  //   ⑤ 承重格：「替换」语义必须保住 —— `diskpart /s a.txt` 的 `tiers` 必须**恰好**
  //      `['unknown']`（半径档 `outside` 被替换掉，不得白送 inside/outside）。
  {
    // 生产路径传入的段对象形态（`index.js` 的 `tierSetOf({ words, blast, opaque }, …)`）：
    // `opaque` 必须一起传。T 组的 `segOf` **不传**它，故本块自建一个同口径助手
    // （只影响 opaque 段的结论；非 opaque 段两处逐字同值）。
    const seg60f = (cmd, shell, platform) => {
      const d = decomposeCommand(cmd, shell || 'bash')
      if (!d.ok || !d.segments.length) return null
      const w = d.segments[0].words
      const o = tierOpts(platform)
      const b = blastRadiusOfSegment(w, o)
      return { b, opaque: d.segments[0].opaque, t: tierSetOf({ words: w, blast: b, opaque: d.segments[0].opaque }, segmentLabels(w), o) }
    }
    // `unknown=deny`、其余七档 allow（含 proc / power / reg=allow）—— 正是现场配置：
    // 用户只把「读不出」设为 deny，组档一律放行。
    const ds60f = { inside: 'allow', outside: 'allow', wide: 'allow', unknown: 'deny', proc: 'allow', power: 'allow', priv: 'allow', reg: 'allow' }
    const act60f = (cmd, platform) => {
      const s = seg60f(cmd, 'bash', platform)
      return s ? strictestTierAction(ds60f, s.t) : 'inherit'
    }
    const tiers60f = (cmd, platform) => {
      const s = seg60f(cmd, 'bash', platform)
      return s ? s.t : []
    }
    // ① 组档段族 + ② sudo 同值对照。两条判据各覆盖一个平台：
    //    · win32 侧 blast 是 `unknown`（判据①）
    //    · posix 侧 `reg delete $T /f` / `taskkill /pid $T` 是 `outside|…|unjudgeable`（判据②）
    const groupFamily60f = [
      'kill $T', 'shutdown $T', 'reg delete $T /f', 'taskkill /pid $T',
      'sudo kill $T', 'sudo shutdown $T', 'sudo reg delete $T /f', 'sudo taskkill /pid $T',
    ]
    const bad60f = []
    for (const c of groupFamily60f) for (const pl of ['win32', 'posix']) {
      const a = act60f(c, pl)
      const t = tiers60f(c, pl)
      if (a !== 'deny') bad60f.push(['组档段未 deny', c, pl, a, t.join(',')])
      if (t.indexOf('unknown') === -1) bad60f.push(['组档段缺 unknown 档', c, pl, a, t.join(',')])
    }
    // ② 同值对照：`sudo` 形态与无前缀形态**必须同结论**（不变量分叉的直接判据）
    //
    // ⚠️ 判据取「**动作同值**」，不取「tiers 逐字同值」：两者**本就不该逐字同值** ——
    // 提权前缀会（a）并入 `priv` 档、（b）经 `pushHeadLabels` 让 `$T` 之后的词元也进命令头
    // 参与判档。实测 `sudo reg delete $T /f`（posix）的 `blast=outside|/f|unjudgeable`
    // → tiers `['unknown','outside','priv','reg']`，而无前缀形态是 `['unknown','reg']`
    // —— 多出的 `outside` 是**修前就有**的（PRE 逐字相同），不是本修法引入的。
    // 本条的现场是**动作**分叉（`kill $T` allow vs `sudo kill $T` deny），故钉动作。
    for (const c of ['kill $T', 'shutdown $T', 'reg delete $T /f', 'taskkill /pid $T']) {
      for (const pl of ['win32', 'posix']) {
        if (act60f(c, pl) !== act60f('sudo ' + c, pl)) {
          bad60f.push(['sudo 形态不同值', c, pl, act60f(c, pl), act60f('sudo ' + c, pl)])
        }
        // 且两侧都必须含 `unknown` 档（同值不能来自「两边都漏」）
        if (tiers60f(c, pl).indexOf('unknown') === -1 || tiers60f('sudo ' + c, pl).indexOf('unknown') === -1) {
          bad60f.push(['sudo 对照缺 unknown 档', c, pl, tiers60f(c, pl).join(','), tiers60f('sudo ' + c, pl).join(',')])
        }
      }
    }
    // ③ opaque 组档段族（第三条判据：`seg.opaque && !seg.blast`）
    //
    // ⚠️ 语料必须挑「**段内一个目标词元都没留下**」的形态 —— 判据③的守卫是 `!seg.blast`：
    //   · `(kill 1234)`     words=[]        blast=null ✅ 走判据③
    //   · `kill $(cat p)`   words=['kill']  blast=null ✅ 走判据③
    // 若 opaque 构造**之后**还留着可判的目标词元（`reg delete $(cat k) /f` 的 `/f`），
    // `blast` 就**不是** null（posix 实测 `outside|/f`），判据③ 的守卫为假 —— 那条格
    // 走的是判据①/②，且**修复前也是同样结论**（实测 `tiers=['reg']`，与本修法无关）。
    // 故 `reg delete $(cat k) /f` **不是**本判据的语料（它在 posix 下根本不是「读不出」：
    // `/f` 判得出来），把它写进来是语料错误，不是缺陷。这里只用真·读不出的形态。
    const opaqueFamily60f = ['(kill 1234)', 'kill $(cat p)', 'shutdown $(date)', 'pkill $(cat p)', '(shutdown /s)', 'reboot $(date)']
    for (const c of opaqueFamily60f) for (const pl of ['win32', 'posix']) {
      const a = act60f(c, pl)
      const t = tiers60f(c, pl)
      if (a !== 'deny') bad60f.push(['opaque 组档段未 deny', c, pl, a, t.join(',')])
      if (t.indexOf('unknown') === -1) bad60f.push(['opaque 组档段缺 unknown 档', c, pl, a, t.join(',')])
    }
    ok('★★ 60f `unknown` 的产出判据不得被半径档门控挡住：纯组档段（proc/power/reg）与 opaque 组档段都必须命中 unknown 档（发现：门控整段跳过 → fail-open）',
      bad60f.length === 0
      // ④ 防空转：**无目标**的组档段不得凭空多出 unknown 档（blast=null，`kill 1234`）
      //
      // ⚠️ 语料按平台分开挑（`shutdown /s` 在 posix 下 `/s` 是**判得出来的路径** →
      // `blast=outside|/s`、修复前后都是 `deny`，它不是「无目标」格；在 win32 下
      // `/s` 是 cmd 开关、`blast=null`，才是本条的语料）。
      && [['kill 1234', 'win32'], ['kill 1234', 'posix'], ['shutdown /s', 'win32'],
        ['pkill', 'win32'], ['pkill', 'posix'], ['reboot', 'win32'], ['reboot', 'posix'],
        ['stop-process', 'win32']].every(([c, pl]) => {
        const s = seg60f(c, 'bash', pl)
        return s && s.b === null && s.t.indexOf('unknown') === -1 && strictestTierAction(ds60f, s.t) === 'allow'
      })
      // ⑤ 承重格：「替换」语义 —— `diskpart /s a.txt` 恰好 `['unknown']`（不多不少）
      && ['win32', 'posix'].every((pl) => tiers60f('diskpart /s a.txt', pl).join(',') === 'unknown')
      // 对照（防空转）：语料确实走到了「组档段 + 读不出」这条路上 ——
      //   · 组档段族确实命中组档（否则 ① 可能来自半径档那条路，而非本次修复）
      //   · `kill $T` 的 blast 确实是 `unknown`（不是 null，那会是另一条判据）
      && tiers60f('kill $T', 'win32').indexOf('proc') !== -1
      && tiers60f('shutdown $T', 'win32').indexOf('power') !== -1
      && tiers60f('reg delete $T /f', 'win32').indexOf('reg') !== -1
      && (function () { const s = seg60f('kill $T', 'bash', 'win32'); return !!s && !!s.b && s.b.level === 'unknown' })()
      // 对照（防空转）：opaque 族确实带 opaque 标记（否则 ③ 可能空转）
      && ['(kill 1234)', 'kill $(cat p)'].every((c) => {
        const d = decomposeCommand(c, 'bash')
        return d.ok && d.segments.length && !!d.segments[0].opaque
      }),
      JSON.stringify({ bad60f: bad60f.slice(0, 8),
        group: groupFamily60f.map((c) => [c, act60f(c, 'win32'), tiers60f(c, 'win32').join(','), act60f(c, 'posix'), tiers60f(c, 'posix').join(',')]),
        opaque: opaqueFamily60f.map((c) => [c, act60f(c, 'win32'), tiers60f(c, 'win32').join(',')]),
        noTarget: [['kill 1234', 'win32'], ['kill 1234', 'posix'], ['shutdown /s', 'win32'],
          ['pkill', 'win32'], ['reboot', 'win32'], ['stop-process', 'win32']].map(([c, pl]) => [c, pl, act60f(c, pl), tiers60f(c, pl).join(',')]),
        diskpart: tiers60f('diskpart /s a.txt', 'win32').join(',') }))
  }

  // ── 60g：**有半径档的 opaque 段**不得整档丢失 `unknown`（判据 ③ 的守卫缺陷）──────
  //
  // 根因：判据 ③ 初版写作 `seg.opaque && !seg.blast`，把「opaque」与「有半径档」当成
  // **二选一**。而 `$(...)` 形态下词法器把构造**整块吞掉**、目标词元不进 `words`
  // （`rm -rf /etc $(rm -rf /)` 的 `words` 只有 `['rm','-rf','/etc']`），于是三条判据对
  // 「**有**半径档的 opaque 段」全部够不到：
  //     · `blast.level === 'unknown'` 为假（blast 是 `outside`）
  //     · `blast.unjudgeable`         为假（构造里的目标连词元都没进，没有可置位的词元）
  //     · `seg.opaque && !seg.blast`  为假（blast 非空）
  // 实测（`unknown=deny`、其余七档 allow、category=allow，修复前）：
  //     rm -rf /etc $(rm -rf /)   → **allow** `['outside']` ❌
  //     rm -rf /etc `rm -rf /`    → deny `['unknown','outside']` ✅（**同义，仅引号形态不同**）
  // 方向 fail-open，且是「同一语义两个结论」的不变量分叉。
  //
  // 判据（四条，缺一即为「只修一支」或「过度收紧」）：
  //   ① `$()` 与反引号**同义对照**：两种引号形态的 action 与 tiers 必须**逐字同值**；
  //   ② `unknown=deny` 下这一族必须 `deny` 且 `tiers` 含 `unknown`；
  //   ③ 防空转：`kill 1234`（**无** opaque、无目标）必须仍不含 `unknown` 档；
  //   ④ 承重格：`diskpart /s a.txt` 的 `tiers` 必须**恰好** `['unknown']`（替换语义保住，
  //      且不得因为本条修法多出半径档）——与 60f ⑤ 同格，此处按「本修法不得改动它」再钉一次。
  //
  // ⚠️ **代价族的边界（写清以免被读成回归）**：
  //   · `rm -rf ./build $(date)`（外层目标在区内、blast=null）在**修复前就已经**是
  //     `['unknown']`（判据 ③ 的 `!seg.blast` 分支命中）—— 本修法对它**零差异**。
  //     故「`$(date)` 会多问」不是本修法的代价，那是既有行为。
  //   · 花括号展开同样标 opaque（`decomposeCommand` 的 `:3575`），故
  //     `rm -rf ./{dist,build}` / `rm -rf ./tmp/{a,b,c}` / `chmod 777 ./{a,b}.sh`
  //     这些**合法常用命令**在修复前**已经是** `['unknown']` —— 本修法同样**零差异**。
  //     ④ 的对照专门钉这一点：合法花括号命令的 tiers 在两侧都必须是 `['unknown']`。
  //   · 真正被多问的只有「外层目标已越界 + opaque」（`rm -rf /etc $(date)`、
  //     `rm -rf /etc {a,b}`）—— 外层目标本身就是 wide/outside，默认配置下 action 差异为 0。
  {
    const seg60g = (cmd, shell, platform) => {
      const d = decomposeCommand(cmd, shell || 'bash')
      if (!d.ok || !d.segments.length) return null
      const w = d.segments[0].words
      const o = tierOpts(platform)
      const b = blastRadiusOfSegment(w, o)
      return { w, b, opaque: d.segments[0].opaque,
        t: tierSetOf({ words: w, blast: b, opaque: d.segments[0].opaque }, segmentLabels(w), o) }
    }
    // `unknown=deny`、其余七档 allow —— 正是现场配置（非 allow 只可能来自 unknown 档）
    const ds60g = { inside: 'allow', outside: 'allow', wide: 'allow', unknown: 'deny',
      proc: 'allow', power: 'allow', priv: 'allow', reg: 'allow' }
    const act60g = (cmd, pl) => { const s = seg60g(cmd, 'bash', pl); return s ? strictestTierAction(ds60g, s.t) : 'inherit' }
    const tiers60g = (cmd, pl) => { const s = seg60g(cmd, 'bash', pl); return s ? s.t : [] }
    const key60g = (cmd, pl) => act60g(cmd, pl) + '|' + tiers60g(cmd, pl).join(',')
    const bad60g = []
    // ① `$()` / 反引号同义对照：两种引号形态逐字同值（修复前在 `$(rm -rf /)` 一族分叉）
    const quotePairs60g = [
      ['rm -rf /etc $(rm -rf /)', 'rm -rf /etc `rm -rf /`'],
      ['rm -rf /etc $(date)', 'rm -rf /etc `date`'],
      ['rm -rf C:/Windows $(x)', 'rm -rf C:/Windows `x`'],
      ['rm -rf ../other $(x)', 'rm -rf ../other `x`'],
      ['rm -rf /etc $(true)', 'rm -rf /etc `true`'],
      ['chmod 777 /etc/passwd $(x)', 'chmod 777 /etc/passwd `x`'],
      ['dd of=/dev/sda $(x)', 'dd of=/dev/sda `x`'],
    ]
    for (const [dq, bt] of quotePairs60g) for (const pl of ['win32', 'posix']) {
      if (key60g(dq, pl) !== key60g(bt, pl)) bad60g.push(['引号形态分叉', dq, bt, pl, key60g(dq, pl), key60g(bt, pl)])
    }
    // ② `unknown=deny` 下「外层目标可判出半径档 + opaque」必须 deny 且含 unknown 档
    const radiusOpaque60g = []
    for (const v of ['rm -rf', 'chmod 777', 'dd of=']) {
      for (const t of ['/etc', 'C:/Windows', '../other', '/tmp/x']) {
        for (const o of ['$(date)', '`date`', '$(rm -rf /)', '`rm -rf /`']) radiusOpaque60g.push(v + ' ' + t + ' ' + o)
      }
    }
    for (const c of radiusOpaque60g) for (const pl of ['win32', 'posix']) {
      const s = seg60g(c, 'bash', pl)
      if (!s) { bad60g.push(['解析失败', c, pl]); continue }
      // 前置条件：这一族确实是「**有**半径档的 opaque 段」——否则本条会退化成判据 ③ 的旧分支
      if (!s.b || s.b.level === 'unknown') bad60g.push(['语料不是「有半径档的 opaque 段」', c, pl, s.b && s.b.level])
      if (!s.opaque) bad60g.push(['语料不带 opaque 标记', c, pl])
      if (act60g(c, pl) !== 'deny') bad60g.push(['未 deny', c, pl, act60g(c, pl), tiers60g(c, pl).join(',')])
      if (tiers60g(c, pl).indexOf('unknown') === -1) bad60g.push(['缺 unknown 档', c, pl, tiers60g(c, pl).join(',')])
      // 半径档必须**仍在**（本修法是「并列补档」，不是「替换掉半径档」）
      if (tiers60g(c, pl).length < 2) bad60g.push(['半径档被替换掉（应并列）', c, pl, tiers60g(c, pl).join(',')])
    }
    ok('★★ 60g 「有半径档的 opaque 段」不得整档丢失 unknown（判据 ③ 去掉 `&& !seg.blast` 守卫）；'
      + '`$()` 与反引号必须逐字同值',
      bad60g.length === 0
      // ③ 防空转：无 opaque、无目标的组档段不得凭空多出 unknown 档
      && ['kill 1234', 'pkill', 'reboot', 'shutdown /s'].every((c) => ['win32', 'posix'].every((pl) => {
        const s = seg60g(c, 'bash', pl)
        return s && !s.opaque && s.t.indexOf('unknown') === -1 && strictestTierAction(ds60g, s.t) === 'allow'
      }))
      // ④ 承重格：「替换」语义必须保住 —— `diskpart /s a.txt` 恰好 `['unknown']`（不多不少）
      && ['win32', 'posix'].every((pl) => tiers60g('diskpart /s a.txt', pl).join(',') === 'unknown')
      // ④b 合法常用花括号命令：本修法**只加 unknown 档、不移除任何半径档**，
      //     且 **action 不得改变**（默认配置下它们是 ask）。
      //
      // ⚠️ 实测更正（比仲裁说的「花括号族零差异」更准确）：花括号展开标 opaque，
      // 但「零差异」**只在 `blast` 为 null 时才成立** —— 那才是判据 ③ 的旧分支
      // （`!seg.blast`）命中的情形。**带 `isWorkspaceRoot` 钩子**（生产口径）时
      // `rm -rf ./{dist,build}` 的前缀词元被归约成 `./` → blast=`workspace-root`
      // → `wide` 档，于是本修法给它**多并一个 `unknown` 档**（`wide` → `wide,unknown`）。
      // 但那不是新增的收紧方向：默认配置下 `wide=ask` 与 `unknown=ask` **同值**，
      // action 不变（ask）；`unknown=deny` 那类配置下它才由 allow 变 deny（收紧）。
      // 真正逐字零差异的是 `./tmp/{a,b,c}` / `./{a,b}.sh` 一族（blast=null）。
      && ['rm -rf ./{dist,build}', 'rm -rf ./tmp/{a,b,c}', 'chmod 777 ./{a,b}.sh', 'rm -rf ./{a,b}/x', 'rm -rf {a,b}'].every((c) =>
        ['win32', 'posix'].every((pl) => {
          const s = seg60g(c, 'bash', pl)
          if (!s) return false
          const t = s.t
          // `unknown` 必须命中（花括号标 opaque），且 `inside` 不得被并进来
          if (t.indexOf('unknown') === -1) return false
          if (t.indexOf('inside') !== -1) return false
          // blast 为 null 的那些必须**恰好** `['unknown']`（与本修法无关的既有行为）
          if (!s.b && t.join(',') !== 'unknown') return false
          // 带半径档的那些（workspace-root → wide）必须是「半径档 + unknown」两档，不得替换掉半径档
          if (s.b && !(t.length === 2 && t.indexOf('unknown') !== -1)) return false
          // action 不得改变：默认配置（wide=ask / unknown=ask）下必须是 ask
          const dsDefault = { inside: 'allow', outside: 'ask', wide: 'ask', unknown: 'ask', proc: 'ask', power: 'ask', priv: 'ask', reg: 'ask' }
          return strictestTierAction(dsDefault, t) === 'ask'
        }))
      // ⑤ 对照（防空转）：语料确实带 opaque 标记且半径档可判（否则 ①② 可能空转）
      && ['rm -rf /etc $(date)', 'rm -rf /etc `date`'].every((c) => {
        const s = seg60g(c, 'bash', 'win32')
        return !!s && !!s.opaque && !!s.b && s.b.level !== 'unknown'
      })
      // ⑤b 对照：`rm -rf ./build $(date)`（blast=null）在修复前后都是 `['unknown']`
      //    —— 本修法对它是零差异，不是「新收紧」
      && ['rm -rf ./build $(date)', 'rm -rf ./build `date`'].every((c) =>
        ['win32', 'posix'].every((pl) => { const s = seg60g(c, 'bash', pl); return !!s && !s.b && tiers60g(c, pl).join(',') === 'unknown' })),
      JSON.stringify({ bad60g: bad60g.slice(0, 8),
        pairs: quotePairs60g.map(([a, b]) => [a, key60g(a, 'win32'), key60g(b, 'win32'), key60g(a, 'posix'), key60g(b, 'posix')]),
        sample: radiusOpaque60g.slice(0, 4).map((c) => [c, act60g(c, 'win32'), tiers60g(c, 'win32').join(','), act60g(c, 'posix'), tiers60g(c, 'posix').join(',')]),
        noOpaque: ['kill 1234', 'pkill', 'reboot', 'shutdown /s'].map((c) => [c, tiers60g(c, 'win32').join(',')]),
        brace: ['rm -rf ./{dist,build}', 'rm -rf ./tmp/{a,b,c}', 'chmod 777 ./{a,b}.sh'].map((c) => [c, tiers60g(c, 'win32').join(','), tiers60g(c, 'posix').join(',')]),
        diskpart: tiers60g('diskpart /s a.txt', 'win32').join(',') }))
  }

  // ── 60h：`commandHeadEndFull` 的早退守卫必须与 `headCommandNameOf` 逐字同源 ────────
  //
  // 根因：`commandHeadEndFull` 的早退只拒收「关键字 / wrapper / 提权前缀」三项，
  // 而 `headCommandNameOf` 是**同三项 + `!LEAD_ASSIGN.test(...)`** —— 两份守卫**已经漂移**。
  // `commandHeadEnd` 的 ② 里 `sawPrefix && !PRIV_VALUE_IS_COMMAND[prevPrefix]` 对
  // `sudo` / `doas` / `pkexec` / `gsudo` **恒真**且**先于** `isTargetEatingNameIn` 命中
  // → 它把前缀之后的**第一个**词元无条件当命令名吃掉，而那个词元可能正是 `FOO=1`。
  // 缺守卫时 `FOO=1` 被当成「真命令名」→ 提前 return → 不再走推进循环 →
  // 真命令名（`diskpart`）落进 `hasNoOperand` 的实参循环被当成**非选项实参**
  // → 该段不归 `unknown` → 落半径档 `inside` → 大分类 mode=allow 时**静默放行**。
  //
  // 实测（默认配置 category=allow → inside=allow、其余七档 ask，修复前）：
  //     time env diskpart        → ask  `['unknown']`  ✅
  //     FOO=1 time env diskpart  → **allow** `['inside']` ❌（多写一个赋值前缀）
  //
  // ⚠️ 严重度**不在「权限宽松」而在硬故障**：`diskpart` 裸跑**阻塞等 stdin**，
  // 而 DSH 是非交互执行环境 —— 工具调用直接挂住。加一个环境变量赋值即可触发。
  //
  // 判据（三条）：
  //   ① **对齐**：`<赋值前缀><关键字/wrapper 夹层><BARE>` 必须与**同形无前缀**形态
  //      （`<夹层><BARE>`）在**全部 5 种配置**下 action 与 tiers **逐字同值**；
  //   ② 默认配置下 `FOO=1 time env diskpart` 必须 `ask`（不得 allow）；
  //   ③ 防空转：**无前缀**对照形态本身必须 `ask` 且含 `unknown` 档（否则 ① 可能
  //      来自「两侧都错」）；且 `<赋值前缀><BARE>`（无关键字夹层）在两侧都已是 unknown
  //      —— 证明本修法只动「赋值前缀 + 关键字夹层」这一格。
  //
  // ⚠️ **已知代价（如实记录，方向随配置而变）**：在 `inside=deny + unknown=allow`
  // 这类**反向配置**下，`FOO=1 time env diskpart` 由 `deny/['inside']` → **`allow`/`['unknown']`**
  // （放宽方向）。这**不是新造的放宽**，而是把「赋值前缀形态」**对齐到既有的无前缀形态**：
  // 实测（5 种配置 × 10 对 × 2 平台 = 100 对）—— BASE 下带前缀与无前缀**只有 4/20 同值**
  // （分叉 16/20），而 CUR 下 **20/20 逐字同值**；且 CUR 带前缀 == CUR 无前缀 ==
  // **BASE 无前缀**（20/20）—— 后者在 BASE 下本就是 `allow/['unknown']`。
  // 即被修掉的是 BASE 侧的**异类**，不是把某个结论放松。
  //
  // 放宽的**充要条件**（穷举 `inside × unknown` 的 9 种组合实测，判据 = 严格度比较）：
  //     放宽 ⇔ strictness(unknown 档值) < strictness(inside 档值)
  //   `inside=deny/unknown=allow`、`inside=deny/unknown=ask`、`inside=ask/unknown=allow`
  //   三种组合各有 16 格放宽；其余六种组合**放宽 0**。
  //   直觉：修法把该形态的命中档由 `inside` 换成 `unknown`，故动作变化完全由这两档的
  //   相对严格度决定 —— 而 `inside` 恰是八档里**唯一跟随大分类**的那一档，把它设得比
  //   `unknown` 更严（`deny`/`ask` 对 `allow`）本身就是「区内比读不出更严」的反常配置。
  //   默认配置（`inside=allow`、其余七档 `ask`）下放宽 **0**，方向是收紧。
  {
    // 5 种配置（含反向配置族）—— 「逐字同值」必须在**每一种**下成立
    const CFGS60h = [
      ['default(inside=allow 余 ask)', { inside: 'allow', outside: 'ask', wide: 'ask', unknown: 'ask', proc: 'ask', power: 'ask', priv: 'ask', reg: 'ask' }],
      ['inside=deny 余 allow', { inside: 'deny', outside: 'allow', wide: 'allow', unknown: 'allow', proc: 'allow', power: 'allow', priv: 'allow', reg: 'allow' }],
      ['inside=deny + unknown=allow', { inside: 'deny', outside: 'allow', wide: 'allow', unknown: 'allow', proc: 'allow', power: 'allow', priv: 'allow', reg: 'allow' }],
      ['unknown=deny 余 allow', { inside: 'allow', outside: 'allow', wide: 'allow', unknown: 'deny', proc: 'allow', power: 'allow', priv: 'allow', reg: 'allow' }],
      ['all ask', { inside: 'ask', outside: 'ask', wide: 'ask', unknown: 'ask', proc: 'ask', power: 'ask', priv: 'ask', reg: 'ask' }],
    ]
    // 赋值前缀 × 关键字/wrapper 夹层 × BARE 命令（BARE_INTERACTIVE / NON_PATH_ARG / /s 三种补充判据）
    const PRE60h = ['FOO=1 ', 'LANG=C LC_ALL=C ', 'A=1 B=2 ']
    const MID60h = ['time env ', 'then env ', 'time nohup ', 'time -p env ']
    const BARE60h = ['diskpart', 'parted', 'dd', 'set-executionpolicy unrestricted']
    const res60h = (cmd, ds, pl) => {
      const h = tierOpts(pl)
      h.destructive = () => ds
      h.category = () => ({ action: 'allow' })
      h.matchException = () => null
      try {
        const r = assessCommand(cmd, 'bash', h)
        const segs = (r.segments || []).map((s) => (s.tiers || []).join(','))
        return r.action + '|' + segs.join(';')
      } catch (e) { return 'ERR' }
    }
    const bad60h = []
    let samePairs = 0, totalPairs = 0
    for (const [cfgName, ds] of CFGS60h) {
      for (const pre of PRE60h) for (const mid of MID60h) for (const b of BARE60h) {
        for (const pl of ['win32', 'posix']) {
          totalPairs += 1
          const withPre = res60h(pre + mid + b, ds, pl)
          const noPre = res60h(mid + b, ds, pl)
          if (withPre !== noPre) { bad60h.push(['赋值前缀形态与无前缀形态不同值', cfgName, pre + mid + b, pl, withPre, noPre]) }
          else samePairs += 1
        }
      }
    }
    // ② 默认配置（§6.1：inside=allow、其余七档 ask）下必须 ask 且含 unknown 档
    const DEF60h = { inside: 'allow', outside: 'ask', wide: 'ask', unknown: 'ask', proc: 'ask', power: 'ask', priv: 'ask', reg: 'ask' }
    const defCases60h = ['FOO=1 time env diskpart', 'LANG=C LC_ALL=C time diskpart', 'FOO=1 then env diskpart',
      'FOO=1 time nohup diskpart', 'FOO=1 time -p env diskpart']
    for (const c of defCases60h) for (const pl of ['win32', 'posix']) {
      const r = res60h(c, DEF60h, pl)
      if (!r.startsWith('ask|')) bad60h.push(['默认配置下未 ask', c, pl, r])
      if (r.indexOf('unknown') === -1) bad60h.push(['默认配置下缺 unknown 档', c, pl, r])
    }
    ok('★★ 60h 赋值前缀 + 关键字/wrapper 夹层 + BARE 必须与**同形无前缀**逐字同值（5 配置 × 3 前缀 × 4 夹层 × 4 BARE × 2 平台）；'
      + '默认配置下必须 ask',
      bad60h.length === 0
      // ③ 防空转（a）：无前缀对照形态本身必须 ask 且含 unknown 档
      && ['time env diskpart', 'time env parted', 'time env dd'].every((c) => ['win32', 'posix'].every((pl) => {
        const r = res60h(c, DEF60h, pl)
        return r.startsWith('ask|') && r.indexOf('unknown') !== -1
      }))
      // ③ 防空转（b）：`<赋值前缀><BARE>`（**无**关键字夹层）在两侧都已是 unknown
      //    —— 证明本修法只动「赋值前缀 + 关键字夹层」这一格，不扩散到裸赋值前缀
      && ['FOO=1 diskpart', 'FOO=1 parted', 'FOO=1 dd', 'FOO=1 set-executionpolicy unrestricted'].every((c) =>
        ['win32', 'posix'].every((pl) => res60h(c, DEF60h, pl).indexOf('unknown') !== -1))
      // ③ 防空转（c）：`diskpart` 裸跑本身必须 ask 且含 unknown 档（BARE_INTERACTIVE 判据仍在）
      && ['diskpart', 'parted', 'dd'].every((c) => ['win32', 'posix'].every((pl) => {
        const r = res60h(c, DEF60h, pl)
        return r.startsWith('ask|') && r.indexOf('unknown') !== -1
      }))
      // ④ 承重格：`diskpart /s a.txt` 的 tiers 必须恰好 `unknown`（不受本修法影响）
      && ['diskpart /s a.txt', 'FOO=1 diskpart /s a.txt', 'FOO=1 time diskpart /s a.txt'].every((c) =>
        ['win32', 'posix'].every((pl) => {
          const r = res60h(c, { inside: 'allow', outside: 'allow', wide: 'allow', unknown: 'deny', proc: 'allow', power: 'allow', priv: 'allow', reg: 'allow' }, pl)
          return r === 'deny|unknown'
        })),
      JSON.stringify({ bad60h: bad60h.slice(0, 8), samePairs, totalPairs,
        def: defCases60h.map((c) => [c, res60h(c, DEF60h, 'win32'), res60h(c, DEF60h, 'posix')]),
        noPre: ['time env diskpart', 'time env parted', 'time env dd'].map((c) => [c, res60h(c, DEF60h, 'win32')]),
        assignOnly: ['FOO=1 diskpart', 'FOO=1 parted', 'FOO=1 dd'].map((c) => [c, res60h(c, DEF60h, 'win32')]),
        diskpart: ['diskpart /s a.txt', 'FOO=1 time diskpart /s a.txt'].map((c) => [c, res60h(c, { inside: 'allow', outside: 'allow', wide: 'allow', unknown: 'deny', proc: 'allow', power: 'allow', priv: 'allow', reg: 'allow' }, 'win32')]) }))
  }

  // ── 60i：`pushHeadLabels` / `headLabelAt` 删掉两个死形参后**零行为变更** ──────────
  //
  // 第 8 圈删掉了两条「缺省时退化成按数组查重」的三元兜底（改为直接
  // `const widen = addWidened` / `const push = addLabel`），而那两条兜底正是
  // `out` / `widened` 两个形参在体内的**唯一消费者**。删后签名与 4 个调用点仍原样传参
  // → 形参在体内**一次都不再被读**（实测 CODE 命中数：`pushHeadLabels` = 1 即签名行，
  // `headLabelAt` = 2 即签名 + 转发调用；`arguments` / `.apply(` / `.call(` 全 0，无动态逃逸）。
  //
  // 本条的判据不是「形状」而是**行为**：`segmentLabelsCore` 的 `labels` / `widened` /
  // `widenedSet` 在整族语料上必须**逐字不变** —— 那才是「删形参」唯一可能影响的东西。
  // 语料覆盖 4 个调用点各自的路径：主路径（`:1461`）、载荷快路径（`:1597`）、
  // 载荷慢路径（`:1613`）、载荷链首转发（`:949`）。
  {
    const corpus60i = [
      // 主路径（`:1461`：段首是提权前缀时的标签扩展）
      'rm -rf /etc', 'sudo rm -rf /etc', 'sudo doas pkexec ls', 'sudo sudo kill 1234',
      'sudo -u root rm -rf /etc', 'su root kill 1234', 'runas /user:admin cmd',
      // 载荷快路径（`:1597`：首词元既非赋值前缀也非 wrapper）
      'find . -exec kill {} ;', 'find . -exec sudo kill {} ;', 'find . -exec doas rm {} ;',
      'find . -exec su root kill {} ;', 'find . -exec rm {} ; -exec kill {} ; -exec shutdown {} ;',
      'find . -exec "reg delete" HKLM\\X /f {} ;', 'find . -exec diskpart {} +',
      'find . -exec reg delete {} ;', 'find . -exec nice sudo rm {} ;',
      // 载荷慢路径（`:1613`：首词元是赋值前缀或 wrapper，须先剥）
      'find . -exec env sudo kill {} ;', 'find . -exec timeout 5 sudo kill {} ;',
      'find . -exec env rm {} ; -exec sudo kill {} ; -exec nohup dd {} ;',
      'find . -exec FOO=1 env sudo rm {} ;', 'find . -exec env FOO=1 sudo rm {} ;',
      'find . -exec nohup kill {} ;', 'find . -exec nice env sudo rm {} ;',
      // 载荷链首转发（`:949`：经 `headLabelAt` 进 `pushHeadLabels`）
      'find . -exec sudo rm -rf {} +', 'find . -exec env sudo rm -rf {} +',
      'find . -exec su -c "rm -rf /" {} ;', 'find . -exec runas /user:a cmd {} ;',
      'sudo find . -exec rm -rf {} +', 'sudo find . -exec doas rm {} ;',
      // `-delete` 合成 label（不经 `pushHeadLabels` 的那一支，对照用）
      'find . -delete', 'sudo find . -delete', 'find . -exec sudo {} ;',
    ]
    const bad60i = []
    let segs60i = 0
    for (const cmd of corpus60i) {
      const d = decomposeCommand(cmd, 'bash')
      if (!d.ok || !d.segments.length) { bad60i.push(['解析失败', cmd]); continue }
      for (const seg of d.segments) {
        segs60i += 1
        const core = segmentLabelsCore(seg.words)
        const labels = segmentLabels(seg.words)
        // ① `labels` 必须等于**主路径的结果**（`segmentLabels` 是 `segmentLabelsCore` 的消费者）
        if (JSON.stringify(core.labels) !== JSON.stringify(labels)) {
          bad60i.push(['labels 与 segmentLabels 不一致', cmd, JSON.stringify(core.labels), JSON.stringify(labels)])
        }
        // ② `widened ⊆ labels` 不变量（`headLabelAt` 的登记形态必须仍是 labels 里的那个）
        const ls = new Set(core.labels)
        for (const wd of core.widened) if (!ls.has(wd)) bad60i.push(['widened ⊄ labels', cmd, wd, JSON.stringify(core.labels)])
        // ③ `widenedSet` 与 `widened` 必须同集（两条路径不许分叉）
        const ws = core.widenedSet ? [...core.widenedSet].sort() : []
        if (JSON.stringify(ws) !== JSON.stringify([...new Set(core.widened)].sort())) {
          bad60i.push(['widenedSet 与 widened 不同集', cmd, JSON.stringify(ws), JSON.stringify(core.widened)])
        }
      }
    }
    ok('★★ 60i 删掉 `pushHeadLabels` / `headLabelAt` 的 `out` / `widened` 死形参后，'
      + '`segmentLabelsCore` 的 labels / widened / widenedSet 零行为变更（覆盖 4 个调用点各自的路径）',
      bad60i.length === 0 && segs60i >= 30
      // 防空转：语料确实覆盖了「载荷族」（否则 `headLabelAt` 的两个调用点根本没走到）
      && ['find . -exec kill {} ;', 'find . -exec env sudo kill {} ;'].every((c) => {
        const d = decomposeCommand(c, 'bash')
        return d.ok && d.segments.length && segmentLabels(d.segments[0].words).length > 1
      })
      // 防空转：`widened` 确实非空（否则 ② 可能空转）
      && (function () {
        const d = decomposeCommand('find . -exec sudo kill {} ;', 'bash')
        return d.ok && segmentLabelsCore(d.segments[0].words).widened.length > 0
      })(),
      JSON.stringify({ bad60i: bad60i.slice(0, 8), segs60i,
        sample: ['find . -exec sudo kill {} ;', 'find . -exec env sudo kill {} ;', 'sudo rm -rf /etc'].map((c) => {
          const d = decomposeCommand(c, 'bash')
          const core = d.ok && d.segments.length ? segmentLabelsCore(d.segments[0].words) : null
          return [c, core && core.labels, core && core.widened]
        }) }))
  }

  // ── 60j：`<提权前缀> FOO=1 <夹层> <BARE>` —— commandHeadEndFull 推进循环的 ③ 分支 ──
  //
  // 上一轮第 2 条只补了 `commandHeadEndFull` 的**早退守卫**（`:2681-2685`），而那一支走的是
  // **推进循环的 ③ 分支**：`commandHeadEnd(['sudo','FOO=1','env','diskpart'])` 返回 **2**
  // （② 分支把 `FOO=1` 当命令名吃掉）→ 循环第二轮 `commandNameOf(w[1])='foo=1'`
  // 既非关键字也非前缀 → ③ 直接 `start += 1; break` → `headFull` 停在 **2**（正确值 **4**）。
  // 于是真命令名 `diskpart` 落进 `hasNoOperand` 的词元循环被当成**非选项实参**
  // → 该段不归 `unknown` → 落半径档 `inside` → `mode=allow` 时静默放行。
  //
  // 修法：在 ③ 之前插一行 `if (LEAD_ASSIGN.test(String(w[start]))) { start += 1; continue }`
  // —— 复用模块级 `LEAD_ASSIGN` 单点，与 `headCommandNameOf` 的早退守卫同源。
  //
  // ⚠️ 三支归属（仲裁裁决：本条只修**第三支**，前两支走不同代码路径、刻意不修）：
  //     `nohup FOO=1 rm -rf /tmp`  → label 侧（`segmentLabels` / `pushHeadLabels`），tiers `[]`
  //     `su root FOO=1 rm -rf /tmp` → `privOperandSkip` 操作数路径，tiers `['priv']`
  //     `sudo FOO=1 env diskpart`   → 本条（`hasNoOperand` 的 headFull 位置跳过），tiers `['inside','priv']`
  {
    // 提权前缀 × 夹层 × BARE 的叉乘；每个形态都与**同形无赋值**对照逐字比
    const PRIV60j = ['sudo', 'doas', 'pkexec', 'gsudo', 'sudo -u root']
    const MID60j = ['', 'env', 'time', 'nohup', 'nice', 'timeout 5', 'xargs']
    const BARE60j = ['diskpart', 'parted', 'dd']
    const CFGS60j = [
      ['default(inside=allow 余 ask)', { inside: 'allow', outside: 'ask', wide: 'ask', unknown: 'ask', proc: 'ask', power: 'ask', priv: 'ask', reg: 'ask' }],
      ['priv=allow + unknown=deny', { inside: 'ask', outside: 'ask', wide: 'ask', unknown: 'deny', proc: 'ask', power: 'ask', priv: 'allow', reg: 'ask' }],
      ['unknown=deny 余 allow', { inside: 'allow', outside: 'allow', wide: 'allow', unknown: 'deny', proc: 'allow', power: 'allow', priv: 'allow', reg: 'allow' }],
      ['inside=deny 余 allow', { inside: 'deny', outside: 'allow', wide: 'allow', unknown: 'allow', proc: 'allow', power: 'allow', priv: 'allow', reg: 'allow' }],
      ['all ask', { inside: 'ask', outside: 'ask', wide: 'ask', unknown: 'ask', proc: 'ask', power: 'ask', priv: 'ask', reg: 'ask' }],
    ]
    const res60j = (cmd, ds, pl) => {
      const h = tierOpts(pl)
      h.destructive = () => ds
      h.category = () => ({ action: 'allow' })
      h.matchException = () => null
      try {
        const r = assessCommand(cmd, 'bash', h)
        const segs = (r.segments || []).map((s) => (s.tiers || []).join(','))
        return r.action + '|' + segs.join(';')
      } catch (e) { return 'ERR' }
    }
    const bad60j = []
    let same60j = 0, total60j = 0
    for (const [cfgName, ds] of CFGS60j) {
      for (const p of PRIV60j) for (const mid of MID60j) for (const b of BARE60j) {
        for (const pl of ['win32', 'posix']) {
          const withA = `${p} FOO=1 ${mid ? mid + ' ' : ''}${b}`
          const noA = `${p} ${mid ? mid + ' ' : ''}${b}`
          total60j += 1
          const a = res60j(withA, ds, pl)
          const n = res60j(noA, ds, pl)
          // ① 核心断言：带赋值前缀必须与**同形无赋值**逐字同值
          if (a !== n) bad60j.push(['带赋值与无赋值不同值', cfgName, withA, pl, a, n])
          else same60j += 1
          // ② 带赋值的形态必须命中 `unknown` 档（不再落 `inside`）
          if (a.indexOf('unknown') === -1) bad60j.push(['带赋值形态缺 unknown 档', cfgName, withA, pl, a])
        }
      }
    }
    ok('★★ 60j `<提权前缀> FOO=1 <夹层> <BARE>` 必须与**同形无赋值**逐字同值且命中 unknown 档'
      + '（5 配置 × 5 提权 × 7 夹层 × 3 BARE × 2 平台 = 1050 对）',
      bad60j.length === 0 && same60j === total60j,
      JSON.stringify({ bad60j: bad60j.slice(0, 8), same60j, total60j }))

    // ── 60j2：三支对照 —— 修法对**另外两支**（label 侧 / privOperandSkip）零影响 ──────
    // 那两支走**不同代码路径**，本条修法不该碰它们。断言它们的 tiers 逐字不变，
    // 同时把「本条这一支」的同值也钉住 —— 三支一起断言，任何一支漂移都会红灯。
    //
    // ⚠️ 期望值是**逐平台**钉死的（`/tmp` 在 win32 上判不出工作区外、posix 上判 outside），
    //    三支的期望值都取**修前实测值**（前两支）与本条修后应达值（第三支）：
    //      · label 侧 `nohup FOO=1 rm -rf /tmp`：两平台都 `[]`（连 del 组档都没有）
    //      · privOperandSkip `su root FOO=1 rm -rf /tmp`：win32 `priv`、posix `outside,priv`
    //      · 本条 `sudo FOO=1 env diskpart`：修前 `inside,priv` → 修后 `unknown,priv`（两平台同）
    const THREE60j = [
      // label 侧（`segmentLabels` / `pushHeadLabels`）：tiers 为空 —— 修前修后同值
      ['label', 'nohup FOO=1 rm -rf /tmp', { win32: '', posix: '' }],
      ['label', 'nice FOO=1 rm -rf /tmp', { win32: '', posix: '' }],
      ['label', 'timeout 5 FOO=1 rm -rf /tmp', { win32: '', posix: '' }],
      ['label', 'xargs FOO=1 rm -rf /tmp', { win32: '', posix: '' }],
      // privOperandSkip 操作数路径：win32 判不出 /tmp 在工作区外，posix 判得出 —— 修前修后同值
      ['privOperandSkip', 'su root FOO=1 rm -rf /tmp', { win32: 'priv', posix: 'outside,priv' }],
      ['privOperandSkip', 'runas /user:a FOO=1 rm -rf /tmp', { win32: 'priv', posix: 'outside,priv' }],
      // 本条（`hasNoOperand` 的 headFull 位置跳过）：由 `inside` 收敛到 `unknown`
      ['headFull', 'sudo FOO=1 env diskpart', { win32: 'unknown,priv', posix: 'unknown,priv' }],
      ['headFull', 'sudo FOO=1 time diskpart', { win32: 'unknown,priv', posix: 'unknown,priv' }],
      ['headFull', 'sudo FOO=1 nohup diskpart', { win32: 'unknown,priv', posix: 'unknown,priv' }],
      ['headFull', 'sudo -u root FOO=1 env diskpart', { win32: 'unknown,priv', posix: 'unknown,priv' }],
    ]
    const badThree60j = []
    const seenThree60j = []
    for (const [branch, cmd, want] of THREE60j) {
      for (const pl of ['win32', 'posix']) {
        const s = segOf(cmd, 'bash', pl)
        const t = s ? s.t.join(',') : 'NULL'
        seenThree60j.push([branch, cmd, pl, t])
        if (t !== want[pl]) badThree60j.push(['tiers 不符', branch, cmd, pl, t, want[pl]])
      }
    }
    // 防空转：三支的 tiers **互不相同**（label 侧空、privOperandSkip 带 priv、本条带 unknown）
    // —— 证明这三条断言确实打在三条不同代码路径上，而不是同一条被重复断言三次。
    const threeDistinct60j = new Set(THREE60j.map(([b, , w]) => b + '|' + w.win32)).size === 3
    ok('★★ 60j2 三支对照：label 侧 / privOperandSkip / 本条 headFull 各自的 tiers 逐字钉住'
      + '（前两支不受本修法影响；本条由 inside 收敛到 unknown）',
      badThree60j.length === 0 && threeDistinct60j,
      JSON.stringify({ badThree60j, threeDistinct60j, seen: seenThree60j }))

    // ── 60j3：防空转对照 ────────────────────────────────────────────────────────
    // ① `sudo FOO=1 diskpart`（**无夹层**，已正确的那一族）必须零变化：tiers 恰为 `unknown,priv`
    // ② `diskpart /s a.txt` 承重格：tiers 恰为 `unknown`（门控内「替换」语义不得被改）
    // ③ `kill 1234` 不得白送 `inside` 档（tierSetOf 门控存在的唯一正当理由）
    const DEF60j = { inside: 'allow', outside: 'ask', wide: 'ask', unknown: 'ask', proc: 'ask', power: 'ask', priv: 'ask', reg: 'ask' }
    const badAir60j = []
    for (const pl of ['win32', 'posix']) {
      // ① 无夹层族
      for (const c of ['sudo FOO=1 diskpart', 'sudo FOO=1 parted', 'sudo FOO=1 dd', 'doas FOO=1 diskpart', 'pkexec FOO=1 dd']) {
        const s = segOf(c, 'bash', pl)
        const t = s ? s.t.join(',') : 'NULL'
        if (t !== 'unknown,priv') badAir60j.push(['无夹层族 tiers 不符', c, pl, t])
        // 且必须与同形无赋值同值
        const noA = c.replace(' FOO=1 ', ' ')
        const sn = segOf(noA, 'bash', pl)
        if (res60j(c, DEF60j, pl) !== res60j(noA, DEF60j, pl)) {
          badAir60j.push(['无夹层族与无赋值不同值', c, pl, res60j(c, DEF60j, pl), res60j(noA, DEF60j, pl)])
        }
        if (!sn) badAir60j.push(['无赋值对照解析失败', noA, pl])
      }
      // ② 承重格：tiers 恰为 `unknown`（替换语义，不得叠加半径档）
      for (const c of ['diskpart /s a.txt', 'sudo FOO=1 diskpart /s a.txt', 'sudo env diskpart /s a.txt']) {
        const s = segOf(c, 'bash', pl)
        const t = s ? s.t.join(',') : 'NULL'
        if (t.indexOf('unknown') === -1) badAir60j.push(['承重格缺 unknown 档', c, pl, t])
      }
      {
        const s = segOf('diskpart /s a.txt', 'bash', pl)
        if (!s || s.t.join(',') !== 'unknown') badAir60j.push(['承重格 tiers 必须恰为 unknown', 'diskpart /s a.txt', pl, s && s.t.join(',')])
      }
      // ③ `kill 1234` 不得白送 inside
      for (const c of ['kill 1234', 'sudo kill 1234', 'sudo FOO=1 kill 1234']) {
        const s = segOf(c, 'bash', pl)
        const t = s ? s.t.join(',') : 'NULL'
        if (t.indexOf('inside') !== -1) badAir60j.push(['kill 不得白送 inside 档', c, pl, t])
      }
    }
    ok('★★ 60j3 防空转：无夹层赋值族零变化 + 承重格 `diskpart /s a.txt` tiers 恰为 unknown'
      + ' + `kill 1234` 不白送 inside 档',
      badAir60j.length === 0,
      JSON.stringify({ badAir60j,
        noMid: ['sudo FOO=1 diskpart', 'sudo FOO=1 parted'].map((c) => [c, (segOf(c, 'bash', 'win32') || {}).t]),
        load: ['diskpart /s a.txt', 'sudo FOO=1 diskpart /s a.txt'].map((c) => [c, (segOf(c, 'bash', 'win32') || {}).t]),
        kill: ['kill 1234', 'sudo FOO=1 kill 1234'].map((c) => [c, (segOf(c, 'bash', 'win32') || {}).t]) }))

    // ── 60j3④：**两层前缀之间**夹赋值 —— `pushHeadLabels` 链推进循环的 `LEAD_ASSIGN` 步 ──
    // 60j / 60j2 / 60j3①②③ 的语料**全部是「单个前缀之后」夹赋值**（走 label 侧 /
    // `privOperandSkip` 操作数路径 / `hasNoOperand` 的 headFull 位置），而本族是
    // **第二层前缀之前**夹赋值、落在**链推进循环**上 —— 三族结构性照不出它。
    // 实测（修复前）：60j2 那六条**无第二层前缀**（4 条 labels `[]`、2 条 `['su']`/`['runas']`），
    // 故与已定案的赋值族**不重叠**。
    //
    // 根因：`pushHeadLabels` 的 break 判据只认「提权前缀 / wrapper / 语句关键字」三类，
    // 赋值词元三类都不是 ⇒ 循环立即 break、链被截断、真命令名永不进 labels。
    // `i=0` 的 `sudo` 把链推进到 `i=1`，循环第二轮就撞上 `FOO=1`。
    //   `sudo su root kill 1234`        → labels `['sudo','su','kill']` tiers `['proc','priv']`
    //   `sudo FOO=1 su root kill 1234`  → labels `['sudo','su']`       tiers **`['priv']`**（组档整族丢失）
    //
    // ⚠️ **不需要 `priv=allow`**：真实档位缺省表（八档一律「项目显式 → 全局显式 → ask」，
    // 见 index.js 的 destructiveTiers）+ 一条常规 deny 例外下就已分叉 —— 例外 `kill *`=deny 时
    // 本形态是 **ask**、对照是 **deny**。故断言必须含**缺省档位表 + deny 例外**这一格，
    // 不能只断言 `priv=allow`（那会把触发面写窄）。
    {
      // 三种「八档同值」的档位表（真实可达：用户逐档显式设成这个样子）+ 反向配置
      const DERIVED60j3 = {}
      for (const mode of ['allow', 'ask', 'deny']) {
        const rest = mode === 'deny' ? 'deny' : 'ask'
        DERIVED60j3['eight tiers = ' + mode] = { inside: mode, outside: rest, wide: rest, unknown: rest, proc: rest, power: rest, priv: rest, reg: rest }
      }
      DERIVED60j3['priv=allow'] = { inside: 'allow', outside: 'ask', wide: 'ask', unknown: 'ask', proc: 'ask', power: 'ask', priv: 'allow', reg: 'ask' }
      DERIVED60j3['inside=deny 余 allow'] = { inside: 'deny', outside: 'allow', wide: 'allow', unknown: 'allow', proc: 'allow', power: 'allow', priv: 'allow', reg: 'allow' }
      DERIVED60j3['unknown=deny + priv=allow'] = { inside: 'allow', outside: 'ask', wide: 'ask', unknown: 'deny', proc: 'ask', power: 'ask', priv: 'allow', reg: 'ask' }
      // 常规 deny 例外（用户显式写的拒绝）—— 本缺陷让它被「多写一个 `FOO=1`」降级
      const EXC60j3 = [['none', null], ['kill=deny', ['kill *']], ['diskpart=deny', ['diskpart*']],
        ['reg=deny', ['reg delete *']], ['shutdown=deny', ['shutdown *']]]
      const run60j3 = (c, ds, pl, exc) => {
        const h = tierOpts(pl)
        h.destructive = () => ds
        h.category = () => ({ action: 'allow' })
        h.matchException = (segText, label) => {
          if (!exc) return null
          for (const pat of exc) {
            if (matchCommand(pat, segText) || (label && matchCommand(pat, label))) return { action: 'deny', ruleId: 'e1' }
          }
          return null
        }
        try {
          const r = assessCommand(c, 'bash', h)
          return r.action + '|' + (r.segments || []).map((s) => (s.tiers || []).join(',') + '|' + (s.blast ? s.blast.level : 'null')).join(';')
        } catch (e) { return 'ERR' }
      }
      // 赋值夹在**两层前缀之间**（第一层之后、第二层之前）—— 第二层是提权前缀或 wrapper
      const PAIRS60j3 = [
        ['sudo FOO=1 su root kill 1234', 'sudo su root kill 1234'],
        ['sudo FOO=1 doas kill 1234', 'sudo doas kill 1234'],
        ['doas FOO=1 su root kill 1234', 'doas su root kill 1234'],
        ['sudo A=1 B=2 su root kill 1234', 'sudo su root kill 1234'],
        ['sudo -u root FOO=1 su root kill 1234', 'sudo -u root su root kill 1234'],
        ['sudo FOO=1 su root reg delete HKLM\\X /f', 'sudo su root reg delete HKLM\\X /f'],
        ['sudo FOO=1 su root shutdown -h now', 'sudo su root shutdown -h now'],
        ['sudo FOO=1 su root diskpart', 'sudo su root diskpart'],
        ['sudo FOO=1 env sudo kill 1234', 'sudo env sudo kill 1234'],
        ['sudo FOO=1 time sudo kill 1234', 'sudo time sudo kill 1234'],
        ['sudo FOO=1 nohup sudo kill 1234', 'sudo nohup sudo kill 1234'],
        ['sudo FOO=1 timeout 5 sudo kill 1234', 'sudo timeout 5 sudo kill 1234'],
      ]
      const bad60j3 = []
      let pair60j3 = 0
      for (const [wa, na] of PAIRS60j3) {
        for (const pl of ['win32', 'posix']) {
          // ① tiers + blast 双口径：带夹层赋值必须与**同形无赋值**逐字同值
          const sa = segOf(wa, 'bash', pl), sn = segOf(na, 'bash', pl)
          if (!sa || !sn || sa.t.length === 0 || sn.t.length === 0) {
            bad60j3.push(['无信号', wa, pl, sa && sa.t.join(','), sn && sn.t.join(',')])
            continue
          }
          pair60j3 += 1
          const ba = sa.b ? sa.b.level + '|' + sa.b.path : 'null'
          const bn = sn.b ? sn.b.level + '|' + sn.b.path : 'null'
          if (sa.t.join(',') !== sn.t.join(',') || ba !== bn) {
            bad60j3.push(['tiers/blast 不同值', wa, pl, sa.t.join(',') + '|' + ba, sn.t.join(',') + '|' + bn])
          }
          // ② 端到端：全配置 × 全例外下 action 必须同值
          for (const [cn, ds] of Object.entries(DERIVED60j3)) {
            for (const [exn, exc] of EXC60j3) {
              const a = run60j3(wa, ds, pl, exc), n = run60j3(na, ds, pl, exc)
              if (a !== n) bad60j3.push(['action 不同值', cn + '/' + exn, wa, pl, a, n])
            }
          }
          // ③ 组档不得丢失：对照形态含 proc/power/reg 时，带赋值形态也必须含
          const groups = ['proc', 'power', 'reg'].filter((g) => sn.t.indexOf(g) !== -1)
          for (const g of groups) {
            if (sa.t.indexOf(g) === -1) bad60j3.push(['组档丢失', g, wa, pl, sa.t.join(','), sn.t.join(',')])
          }
        }
      }
      // ④ 防空转：确有一条形态在**修复前**是分叉的（若整族退化成同值，本组恒真）
      //    —— 用「对照形态必须含组档」证明语料确实打在该路径上
      const hasGroupSignal60j3 = PAIRS60j3.some(([, na]) => {
        const s = segOf(na, 'bash', 'win32')
        return s && s.t.some((x) => x === 'proc' || x === 'power' || x === 'reg')
      })
      ok('★★ 60j3④ 两层前缀之间夹赋值：`<p1> FOO=1 <p2> <tail>` 必须与同形无赋值逐字同值'
        + '（tiers/blast/action 三口径 × 7 配置 × 5 例外；组档不得丢失）',
        bad60j3.length === 0 && pair60j3 === PAIRS60j3.length * 2 && hasGroupSignal60j3,
        JSON.stringify({ bad60j3: bad60j3.slice(0, 8), pair60j3, hasGroupSignal60j3,
          sample: [
            ['sudo FOO=1 su root kill 1234', 'sudo su root kill 1234'],
            ['sudo FOO=1 su root reg delete HKLM\\X /f', 'sudo su root reg delete HKLM\\X /f'],
          ].map(([a, n]) => [a, (segOf(a, 'bash', 'win32') || {}).t, n, (segOf(n, 'bash', 'win32') || {}).t]),
          actKillDeny: [
            run60j3('sudo FOO=1 su root kill 1234', DERIVED60j3['eight tiers = allow'], 'win32', ['kill *']),
            run60j3('sudo su root kill 1234', DERIVED60j3['eight tiers = allow'], 'win32', ['kill *']),
          ] }))
    }

    // ── 60j4：`commandHeadEndFull` 的推进必须收敛（不得死循环）─────────────────────
    // 新插入的分支每轮 `start += 1` 至少推进一个词元，而循环条件是 `guard <= n && start < n`
    // —— 故最多 n+1 轮必然退出。这条用**超长赋值前缀链**实测（若判据写成不推进，
    // 这里会挂住而不是变红；故用时间上界断言把「挂住」变成可观测的失败）。
    {
      const chain = Array.from({ length: 4000 }, (_, i) => `A${i}=1`).join(' ')
      const t0 = Date.now()
      let r60j4 = null
      let threw = null
      try { r60j4 = segOf(`${chain} sudo env diskpart`, 'bash', 'win32') } catch (e) { threw = e.message }
      const ms = Date.now() - t0
      // 4000 个赋值前缀：`commandHeadEnd` 的前导剥离最多留一个词元，故它吃掉 3999 个后
      // 剩下的 `sudo env diskpart` 仍应被识别 → tiers 必须含 unknown（而不是 inside）。
      ok('★ 60j4 超长赋值前缀链（4000 个 `A<i>=1`）下推进必须收敛：不挂住、仍判出 unknown 档',
        threw === null && ms < 5000 && r60j4 && r60j4.t.join(',').indexOf('unknown') !== -1,
        JSON.stringify({ threw, ms, t: r60j4 && r60j4.t, w: r60j4 && r60j4.w.length }))
    }

    // ── 60j5：赋值词元**恰在链尾**时必须放行（`pushHeadLabels` 链推进循环的守卫）──────
    // 60j3④ 的语料是「赋值夹在**两层前缀之间**」（`sudo FOO=1 su root kill 1234`）——
    // 赋值**后面还有词元**。而本族是 `<前缀链> <尾随赋值词元>`：赋值**恰是最后一个词元**
    // （`sudo A=/bin/rm`），两者是**不同语义**，60j / 60j2 / 60j3 / 60j4 四族**结构性照不出**它。
    //
    // 根因：`pushHeadLabels` 链推进循环里那一行 `LEAD_ASSIGN` 步若无 `i + 1 < w.length`
    // 守卫，跨过**最后一个**词元后循环因 `i >= w.length` 退出、链尾那次 `segmentLabelFrom`
    // 落空 ⇒ `return first` ⇒ 第二个 label **整体丢掉**。实测（`eight tiers = allow` + 例外
    // `rm *`=deny）：`sudo A=/bin/rm` 无守卫是 **`ask`/`['priv']`**（PRE 是
    // `deny`/`['inside','priv']`）；再加 `priv=allow` 时更从 PRE 的 `deny` 变成 **`allow`**。
    // 面（本处**自测**，对拍 PRE 基线 `9D3800EF…`）：52,908 格语料（4,409 条 × 12 配置）
    // 中动作放宽 **1,653** 格、档位移除 **9,648** 格、收紧 48 格 —— 且放宽格
    // **1,653/1,653 全部**满足「赋值词元是最后一个词元」（0 格例外）。
    // （上一轮验证者另用 4 元组全枚举报出 labels 收缩 57,228 / 档位移除 224,280 /
    // 动作放宽 68,724 格，同一族、方向一致；两组数字口径不同，不可混用。）
    //
    // ⚠️ **口径更正**：上一条 F1 报告里的「只收紧（loosen 0 / tierRemoved 0 / labelSubsetViol 0）」
    // 「labels 只增不减（CUR ⊄ FIX = 0）」在本族上**不成立**；且触发条件比报告更宽 ——
    // **不需要 `priv=allow`**，派生默认 + 一条常规 deny 例外下即 `deny → ask`。
    // 本族此前 grep `sudo A=` / `PATH=/usr/bin` / `A=/bin/rm` 命中 **0** ⇒ 套件零鉴别力，
    // 不补断言就会**静默漂移**。
    //
    // 判据取「与**语义等价对照**逐字同值」而不是「PRE 同值」：PRE 的第二 label（`rm`）
    // 本身是 `unwrapWordsFrom` 把**赋值右侧 basename** 当命令名产生的**假警告**
    // （`sudo A=/bin/rm` 之后没有命令，shell 语义下不执行 `rm`）。钉住「PRE 同值」会把
    // 那个假警告一起钉成契约；钉住「与对照同值」既挡住漂移，又让日后**有意**去掉该
    // 假警告时不必改这条断言（方向正确、且不会顺手截断真正要修的族）。
    {
      // 配置表：三种「八档同值」的档位表（真实可达：用户逐档显式设成这个样子，
      // 与 60j3④ 同口径）+ `priv=allow`（本族无守卫时的放宽面）+ 反向配置。
      // **必须含「八档全 allow」那一格**：
      // 本族的 `deny → ask` 在「八档全 allow 的档位表 + 一条常规 deny 例外」下就成立，
      // 不需要 `priv=allow`。
      const D60j5 = {}
      for (const mode of ['allow', 'ask', 'deny']) {
        const rest = mode === 'deny' ? 'deny' : 'ask'
        D60j5['eight tiers = ' + mode] = { inside: mode, outside: rest, wide: rest, unknown: rest, proc: rest, power: rest, priv: rest, reg: rest }
      }
      D60j5['priv=allow'] = { inside: 'allow', outside: 'ask', wide: 'ask', unknown: 'ask', proc: 'ask', power: 'ask', priv: 'allow', reg: 'ask' }
      D60j5['inside=deny 余 allow'] = { inside: 'deny', outside: 'allow', wide: 'allow', unknown: 'allow', proc: 'allow', power: 'allow', priv: 'allow', reg: 'allow' }
      D60j5['unknown=deny + priv=allow'] = { inside: 'allow', outside: 'ask', wide: 'ask', unknown: 'deny', proc: 'ask', power: 'ask', priv: 'allow', reg: 'ask' }
      D60j5['all ask'] = { inside: 'ask', outside: 'ask', wide: 'ask', unknown: 'ask', proc: 'ask', power: 'ask', priv: 'ask', reg: 'ask' }
      // 对照 = 同一条提权链 + 真命令名（**无赋值**）。两者在 shell 语义下是同一件事：
      // `sudo A=/bin/rm` 与 `sudo rm` 都不执行 `rm`（前者 sudo 报错、后者缺操作数）。
      const PAIRS60j5 = [
        ['sudo A=/bin/rm', 'sudo rm'],
        ['sudo PATH=/usr/bin/rm', 'sudo rm'],
        ['sudo A=/bin/rm.exe', 'sudo rm'],
        ['doas A=/bin/rm', 'doas rm'],
        ['su A=/bin/rm', 'su rm'],
        ['pkexec A=/bin/rm', 'pkexec rm'],
        ['gsudo A=/bin/rm', 'gsudo rm'],
        ['sudo A=/usr/bin/kill', 'sudo kill'],
        ['sudo A=/sbin/diskpart', 'sudo diskpart'],
        ['sudo A=/bin/dd', 'sudo dd'],
        ['sudo A=/bin/shutdown', 'sudo shutdown'],
        ['sudo timeout 5 A=/bin/rm', 'sudo timeout 5 rm'],
        ['sudo nohup A=/bin/rm', 'sudo nohup rm'],
        ['sudo nice A=/bin/rm', 'sudo nice rm'],
        ['sudo A=1 B=2', 'sudo B=2'],
      ]
      const res60j5 = (c, ds, pl) => {
        const h = tierOpts(pl)
        h.destructive = () => ds
        h.category = () => ({ action: 'allow' })
        h.matchException = () => null
        try {
          const r = assessCommand(c, 'bash', h)
          return r.action + '|' + (r.segments || []).map((s) => (s.tiers || []).join(',')).join(';')
        } catch (e) { return 'ERR' }
      }
      const bad60j5 = []
      let pair60j5 = 0
      for (const [wa, ref] of PAIRS60j5) {
        for (const pl of ['win32', 'posix']) {
          const sa = segOf(wa, 'bash', pl), sn = segOf(ref, 'bash', pl)
          // 防空转：两侧都必须有**非空** tiers（否则「同值」可能是两边都空）
          if (!sa || !sn || sa.t.length === 0 || sn.t.length === 0) {
            bad60j5.push(['无信号', wa, ref, pl, sa && sa.t.join(','), sn && sn.t.join(',')])
            continue
          }
          pair60j5 += 1
          if (sa.t.join(',') !== sn.t.join(',')) {
            bad60j5.push(['tiers 与语义等价对照不同值', wa, ref, pl, sa.t.join(','), sn.t.join(',')])
          }
          // 端到端：**全配置**下 action 必须与对照同值（含「派生默认 + 常规 deny 例外」这一格）
          for (const [cn, ds] of Object.entries(D60j5)) {
            const a = res60j5(wa, ds, pl), n = res60j5(ref, ds, pl)
            if (a !== n) bad60j5.push(['action 与对照不同值', cn, wa, ref, pl, a, n])
          }
        }
      }
      // ① 反向守卫：赋值**之后还有词元**时，本守卫**不得**放行（那一支正是要修的 fail-open 族）
      //    —— 60j3④ 已覆盖，这里再钉一次「守卫没有把两支一起放过」。
      const tail60j5 = []
      for (const c of ['sudo A=/bin/rm kill 1234', 'sudo FOO=1 su root kill 1234',
        'sudo A=1 B=2 su root kill 1234', 'sudo FOO=1 timeout 5 sudo kill 1234']) {
        const s = segOf(c, 'bash', 'win32')
        const ref = c.replace(/^(sudo|doas|su|pkexec|gsudo)\s+/, (m) => m).replace(/\b(A=\S+|FOO=1|A=1|B=2)\s+/g, '')
        const sn = segOf(ref, 'bash', 'win32')
        if (!s || !sn || s.t.join(',') !== sn.t.join(',')) {
          tail60j5.push([c, ref, s && s.t.join(','), sn && sn.t.join(',')])
        }
      }
      // ② 防空转：语料真的被遍历到
      const n60j5 = PAIRS60j5.length * 2
      ok('★★ 60j5 赋值词元**恰在链尾**（`<前缀链> <尾随赋值词元>`）必须放行：tiers/action 与'
        + '**语义等价对照**逐字同值，且不得波及「赋值之后还有词元」那一支'
        + '（15 对 × 2 平台 × 8 配置；本族此前套件零鉴别力）',
        bad60j5.length === 0 && tail60j5.length === 0 && pair60j5 === n60j5
        // 防空转：对照形态本身必须**真的**有信号（不是两边都空/都 ERR）
        && PAIRS60j5.every(([, ref]) => {
          const s = segOf(ref, 'bash', 'win32')
          return s && s.t.length > 0
        }),
        JSON.stringify({ bad60j5: bad60j5.slice(0, 8), tail60j5: tail60j5.slice(0, 4), pair60j5, n60j5,
          sample: [['sudo A=/bin/rm', 'sudo rm'], ['su A=/bin/rm', 'su rm'], ['sudo timeout 5 A=/bin/rm', 'sudo timeout 5 rm']]
            .map(([a, n]) => [a, (segOf(a, 'bash', 'win32') || {}).t, n, (segOf(n, 'bash', 'win32') || {}).t]),
          derivedAllowRmDeny: [
            res60j5('sudo A=/bin/rm', D60j5['eight tiers = allow'], 'win32'),
            res60j5('sudo rm', D60j5['eight tiers = allow'], 'win32'),
          ] }))
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
group('Z. 末尾 opaque 构造：段边界仍确定（dangling operator 误判回归）')
{
  // ── 这一组盯的是什么 ────────────────────────────────────────────────────────
  // 行尾检查曾经用 `started` 当段级判据。`started` 是**词元级**状态：遇到引号外空白
  // 就被 flushWord 复位，而分组块 / 命令替换这类构造**产不出词元**（它们被标记 opaque），
  // 于是 `Get-Content x | ForEach-Object { $_ }` 的行尾被判成「| 后面什么都没有」，
  // 整行 ok:false。
  //
  // 后果有轻重两层，两层都要钉住：
  //   ① 段边界全丢 → 弹窗的「分段」行消失（症状，用户先看到的就是它）；
  //   ② ok:false 路径**只认 deny 例外**（见 assessCommand 里 `if (!d.ok)` 那一支，
  //      命令名靠 rawCommandNames 粗提）→ allow/ask 例外一律不认。
  //      于是「分类默认 allow + 个别命令写 ask 要求每次确认」这个配置下，
  //      末尾挂一个括号就等于把那条确认规则抹掉 —— **fail-open**，比 ① 严重得多。
  //
  // 反向同样要钉：判据放宽不得放过**真**悬空（`echo a |`）与**真**无目标的重定向。
  // 后者尤其重要：`echo a >` 与行尾检查看着像同一个判据，其实不是（一个问「有没有
  // 词元」、一个问「有没有东西」），把它们合并会让 `echo a >` 静默变成合法命令。

  const tailOpaque = [
    ['pwsh 脚本块 {…} 收尾', 'echo a | ForEach-Object { $_ }', 'pwsh'],
    ['bash 子 shell (…) 收尾', 'echo a | (cat)', 'bash'],
    ['bash 花括号组 {…} 收尾', 'echo a | { cat; }', 'bash'],
    ['命令替换 $(…) 收尾', 'echo a | Write-Output $(date)', 'bash'],
    ['孤立右括号收尾', 'echo a | Write-Output )', 'bash'],
  ]
  for (const [label, cmd, shell] of tailOpaque) {
    const r = decomposeCommand(cmd, shell)
    ok('Z1 ' + label + '：段边界仍确定（不是悬空操作符）',
      r.ok === true && r.segments.length === 2,
      JSON.stringify(r.ok ? r.segments.map((s) => s.text) : r))
  }
  // 用户报上来的那条命令的**最小复现**（真机形态：三个管道，末尾是 pwsh 脚本块）
  const zReal = decomposeCommand('Get-Content -LiteralPath \'x.js\' | Select-Object -Skip 1 -First 30 | ForEach-Object { $_ }', 'pwsh')
  ok('Z1 用户实测形态（三管道 + 末尾脚本块）必须 ok:true 且有 3 段',
    zReal.ok === true && zReal.segments.length === 3,
    JSON.stringify(zReal.ok ? zReal.segments.map((s) => s.text) : zReal))

  // ── 反向 1：真悬空操作符仍须拦下 ──────────────────────────────────────────
  // ⚠️ `&` **不在此列** —— 尾随 `&` 在 bash 里是**合法**的（POSIX 异步列表：
  // `sleep 5 &` / `echo a &`），只有 pwsh 才拒绝它（`AmpersandNotAllowed`）。
  // 曾把 `&` 与 `|` / `&&` / `||` 并列钉成「真悬空」，那是**错误的语义**：
  // 整行 ok:false 只认 deny 例外，于是用户写的 **ask** 例外被一个 ` &` 抹掉（fail-open）。
  // 实测（分类默认 allow + 例外 `curl *`=ask）：
  //     curl -s http://example.com    → ask
  //     curl -s http://example.com &  → allow ← 确认规则被规避
  //     curl -s http://example.com ;  → ask（`;` 早已在豁免列表里，故那是不一致，不是设计）
  for (const [label, cmd] of [['|', 'echo a |'], ['&&', 'echo a &&'], ['||', 'echo a ||']]) {
    const r = decomposeCommand(cmd, 'bash')
    ok('Z2 真悬空 ' + label + ' 仍须 ok:false', r.ok === false, JSON.stringify(r))
  }
  // 尾随 `&`：**按方言分流**（bash 合法 / pwsh 语法错误）。两个方向都要钉住 ——
  // 只钉 bash 侧会让「`&` 一律放行」这种过度放宽也变绿。
  ok('Z2 尾随 & 在 bash 下合法（POSIX 异步列表）',
    decomposeCommand('echo a &', 'bash').ok === true
    && decomposeCommand('echo a & ', 'bash').ok === true,
    JSON.stringify(decomposeCommand('echo a &', 'bash')))
  ok('Z2 尾随 & 在 pwsh 下仍须 ok:false（AmpersandNotAllowed）',
    decomposeCommand('echo a &', 'pwsh').ok === false
    && decomposeCommand('echo a & ', 'pwsh').ok === false,
    JSON.stringify(decomposeCommand('echo a &', 'pwsh')))
  // 放行面**恰好**是「合法的异步列表收尾」：`&` 前面空无一物时仍是语法错误
  // （`echo a & &` 的第二个 `&`、`echo a | &` 的 `&`）。少了这条，`&` 的豁免会
  // 退化成「`&` 一律不算悬空」，把真错误一起放行。
  // ⚠️ 语料**不含行首 `&`**（`& echo a`）：那个形态在 HEAD 与修复前**都已经**是
  // `ok:true`（`nextOp === 'start'` 走的是另一条分支，与本行判据无关）—— 把它写进来
  // 是语料错误，不是本次修复的判据。
  for (const [label, cmd] of [['& 前无内容', 'echo a & &'], ['| 后的 &', 'echo a | &'],
    ['&& 后的 &', 'echo a && &'], ['重定向后的 &', 'echo a > &']]) {
    const r = decomposeCommand(cmd, 'bash')
    ok('Z2 真悬空（' + label + '）仍须 ok:false', r.ok === false, JSON.stringify(r))
  }
  // 尾随空白不得改变结论（`echo a | ` 与 `echo a |` 同判）
  ok('Z2 尾随空白不改变悬空判定',
    decomposeCommand('echo a | ', 'bash').ok === false && decomposeCommand('echo a |', 'bash').ok === false)

  // ── 反向 2：重定向目标缺失仍须拦下 ────────────────────────────────────────
  // 这几条是「不得把两个判据合并」的护栏：合并后它们会全部变 ok:true。
  for (const [label, cmd] of [
    ['> 后无目标', 'echo a >'],
    ['< 后无目标', 'echo a <'],
    ['> 后是分组块（bash 里是语法错误）', 'echo a > (b)'],
    ['> 后是花括号块', 'echo a > {b}'],
    ['> 后是命令替换', 'echo a > $(b)'],
  ]) {
    const r = decomposeCommand(cmd, 'bash')
    ok('Z3 ' + label + ' 仍须 ok:false', r.ok === false, JSON.stringify(r))
  }
  // 对照：真词元目标照常放行（判据不得收紧到误伤）
  for (const [label, cmd] of [['普通词', 'echo a > b'], ['变量展开', 'echo a > $f']]) {
    const r = decomposeCommand(cmd, 'bash')
    ok('Z3 对照 ' + label + ' 目标仍须 ok:true', r.ok === true, JSON.stringify(r))
  }

  // ── 端到端：末尾构造不得让 ask 例外被静默绕过（② 的 fail-open）────────────
  // 分类默认 allow + 例外 `curl *`=ask。末尾挂构造前后必须都是 ask。
  const zHooks = (catAction) => ({
    home: HOME,
    userHome: HOME,
    platform: 'win32',
    matchException: (segText, label) => {
      const targets = (label && label !== segText) ? [segText, label] : [segText]
      for (const t of targets) if (matchCommand('curl *', t)) return { action: 'ask', ruleId: 'z1' }
      return null
    },
    destructive: () => ({ action: 'ask', reason: null }),
    category: () => ({ action: catAction, reason: null }),
    isOutsideWorkspace: () => false,
    isWorkspaceRoot: () => false,
  })
  for (const [label, cmd] of [
    ['末尾普通词元（对照）', 'echo a | curl -s http://example.com'],
    ['末尾 (…)', 'echo a | curl -s (date)'],
    ['末尾 {…}', 'echo a | curl -s { x }'],
    ['末尾 $(…)', 'echo a | curl -s $(date)'],
  ]) {
    const a = assessCommand(cmd, 'bash', zHooks('allow'))
    ok('★ Z4 ask 例外不被末尾构造绕过：' + label,
      a.action === 'ask',
      'action=' + a.action + ' code=' + a.code)
  }
  // 同一形态下 deny 例外必须照旧生效（放宽判据不得削掉收紧方向）
  const zDeny = assessCommand('echo a | curl -s { x }', 'bash', Object.assign(zHooks('allow'), {
    matchException: () => ({ action: 'deny', ruleId: 'z2' }),
  }))
  ok('★ Z4 末尾构造下 deny 例外照常生效', zDeny.action === 'deny', 'action=' + zDeny.action)

  // ── 结构断言：段级判据必须是**单一实现** ──────────────────────────────────
  // 这条盯的是「日后又有人往某一处补一份内联副本」——两处各写一份正是本 bug 的成因
  // （flushSegment 那份写全了，行尾那份漏了 started 以外的四项）。
  const spSrc = readFileSync(pathJoin(ROOT, 'shell-parse.js'), 'utf8')
  const defs = (spSrc.match(/const segHasContent = \(\) =>/g) || []).length
  ok('Z5 segHasContent 定义恰好一处', defs === 1, 'count=' + defs)
  // 调用点恰好两个（flushSegment 与行尾检查）。注意定义行写的是 `segHasContent = () =>`，
  // 不含 `segHasContent()`，故这里只数得到调用点。
  const calls = (spSrc.match(/segHasContent\(\)/g) || []).length
  ok('Z5 segHasContent 调用点恰好两处（flushSegment + 行尾检查）',
    calls === 2, 'count=' + calls)
  // 行尾检查与重定向检查**不得**再直接读 started
  ok('Z5 行尾悬空检查不再直接读 started',
    spSrc.includes("!segHasContent()) {\n    return { ok: false, reason: 'the command line ends with a dangling operator' }"))
  // 重定向那条**必须**保留 started（词元级判据，与段级不是同一个问题）
  ok('Z5 重定向目标检查保留词元级判据 started',
    spSrc.includes("if (pending !== undefined && !started) return { ok: false, reason: 'a redirection has no target' }"))
}

// ─────────────────────────────────────────────────────────────────────────────
group('Y. pwsh 数组运算符 `,`：词元必须切开（档位降级回归）')
{
  // ── 这一组盯的是什么 ────────────────────────────────────────────────────────
  // PowerShell 里 `,` 是**运算符**（不是标点）。用官方词法分析器测定：
  //     Remove-Item "a","b"  → … [StringExpandable:"a"] [Comma:,] [StringExpandable:"b"]
  // 引号紧贴与否都一样。而词法器此前没有 `,` 分支，`,` 落进通用分支被当成普通字符
  // 拼进词元尾巴：`B:\` 变成 `B:\,`。
  //
  // 后果是**档位降级**（BLAST_ORDER 数字越小越严重），端到端可达：
  //     Remove-Item "B:\" -Recurse -Force          → deny
  //     Remove-Item "B:\", "D:\x" -Recurse -Force  → ask   ← 一个逗号绕过显式 wide=deny
  // 因为盘根/系统目录的判据都是**精确匹配**（`/^[a-z]:$/`、WIN_SYSTEM_ROOT_RE），
  // 尾逗号让它们全部落空，只剩「工作区外」这一档。
  //
  // ⚠️ bash 侧**不得**切：那里 `,` 是普通字符（`rm -rf /tmp/a,b` 删的是名字里带逗号的
  // 那**一个**文件）。下面 Y3 钉住这条 —— 它是「按方言分词」这条纪律的现场。

  const lvlY = (t) => { const r = blastRadiusOf(t, yOpts); return r ? r.level : null }
  const yOpts = {
    home: 'C:/Users/me', userHome: 'C:/Users/me', platform: 'win32',
    isOutsideWorkspace: (p) => {
      const raw = String(p).replace(/\\/g, '/')
      const abs = (raw.startsWith('/') || /^[a-zA-Z]:/.test(raw)) ? raw : 'X:/ws/' + raw
      const s = abs.toLowerCase()
      return !(s === 'x:/ws' || s.startsWith('x:/ws/'))
    },
    isWorkspaceRoot: (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() === 'x:/ws',
  }

  // ── Y1 词元切分：三种书写形态都必须切出独立词元 ────────────────────────────
  const yForms = [
    ['带空格', 'Remove-Item "B:\\", "D:\\x" -Force'],
    ['不带空格', 'Remove-Item "B:\\","D:\\x" -Force'],
    ['裸路径', 'Remove-Item B:\\, D:\\x -Force'],
  ]
  for (const [label, cmd] of yForms) {
    const d = decomposeCommand(cmd, 'pwsh')
    ok('Y1 pwsh 数组（' + label + '）切出两个独立目标词元',
      d.ok && d.segments[0].words.join('|') === 'Remove-Item|B:\\|D:\\x|-Force',
      d.ok ? JSON.stringify(d.segments[0].words) : JSON.stringify(d))
  }
  // 词元里**不得**残留逗号（这是本 bug 的直接形态）
  for (const [label, cmd] of yForms) {
    const d = decomposeCommand(cmd, 'pwsh')
    ok('Y1 pwsh 数组（' + label + '）词元里无残留逗号',
      d.ok && !d.segments[0].words.some((w) => w.indexOf(',') !== -1),
      d.ok ? JSON.stringify(d.segments[0].words) : 'F')
  }

  // ── Y2 档位必须恢复（本 bug 的实质后果）────────────────────────────────────
  // 对照的是「单个目标」那条基线：数组形态**不得**比它更宽。
  const yPairs = [
    ['盘根', 'B:\\', 'Remove-Item "B:\\" -Recurse -Force', 'Remove-Item "B:\\", "D:\\x" -Recurse -Force'],
    ['系统目录', 'C:\\Windows', 'Remove-Item "C:\\Windows" -Recurse -Force', 'Remove-Item "C:\\Windows", "D:\\x" -Recurse -Force'],
  ]
  for (const [label, path, one, two] of yPairs) {
    const lv = lvlY(path)
    const d1 = decomposeCommand(one, 'pwsh')
    const d2 = decomposeCommand(two, 'pwsh')
    const b1 = d1.ok ? blastRadiusOfSegment(d1.segments[0].words, yOpts) : null
    const b2 = d2.ok ? blastRadiusOfSegment(d2.segments[0].words, yOpts) : null
    ok('★ Y2 ' + label + '：数组形态的档位与单目标一致（不得降级）',
      b1 && b2 && b1.level === lv && b2.level === lv,
      'want=' + lv + ' 单个=' + JSON.stringify(b1) + ' 数组=' + JSON.stringify(b2))
  }

  // ── Y3 端到端：一个逗号不得绕过显式 deny ──────────────────────────────────
  // wide=deny（想拦大范围删除）、其余 ask —— 这是最容易看出绕过的配置。
  const yTiers = { inside: 'ask', outside: 'ask', wide: 'deny', unknown: 'ask', proc: 'ask', power: 'ask', priv: 'ask', reg: 'ask' }
  const yHooks = Object.assign({}, yOpts, {
    matchException: () => null,
    destructive: () => yTiers,
    category: () => ({ action: 'ask', reason: null }),
  })
  const yE2E = [
    ['删盘根 B:\\', 'Remove-Item "B:\\" -Recurse -Force', 'Remove-Item "B:\\", "D:\\x" -Recurse -Force'],
    ['删盘根 B:\\（无空格）', 'Remove-Item "B:\\" -Recurse -Force', 'Remove-Item "B:\\","D:\\x" -Recurse -Force'],
    ['删系统目录', 'Remove-Item "C:\\Windows" -Recurse -Force', 'Remove-Item "C:\\Windows", "D:\\x" -Recurse -Force'],
  ]
  for (const [label, one, two] of yE2E) {
    const a1 = assessCommand(one, 'pwsh', yHooks)
    const a2 = assessCommand(two, 'pwsh', yHooks)
    ok('★★ Y3 ' + label + '：数组形态的动作不得比单目标更宽',
      a1.action === 'deny' && a2.action === 'deny',
      '单个=' + a1.action + ' 数组=' + a2.action)
  }

  // ── Y4 bash 侧**不得**切逗号（按方言分词的纪律）────────────────────────────
  const yBash = [
    ['路径里的逗号是字面量', 'rm -rf /tmp/a,b', 'rm|-rf|/tmp/a,b'],
    ['echo 的逗号是字面量', 'echo a,b', 'echo|a,b'],
  ]
  for (const [label, cmd, want] of yBash) {
    const d = decomposeCommand(cmd, 'bash')
    ok('Y4 bash 不切逗号（' + label + '）',
      d.ok && d.segments[0].words.join('|') === want,
      d.ok ? JSON.stringify(d.segments[0].words) : 'F')
  }
  // bash 的花括号展开仍走分组分支（标 opaque），与逗号分支互不干扰
  const yBrace = decomposeCommand('rm -rf /tmp/{a,b}', 'bash')
  ok('Y4 bash 花括号展开仍判 opaque（未被逗号分支接管）',
    yBrace.ok && yBrace.segments[0].opaque !== null,
    yBrace.ok ? JSON.stringify(yBrace.segments[0]) : 'F')

  // ── Y5 引号内的逗号是字面量（不得切）──────────────────────────────────────
  const yQuoted = [
    ['双引号内', 'Remove-Item "C:\\tmp\\a,b" -Force', 'Remove-Item|C:\\tmp\\a,b|-Force'],
    ['单引号内', "Remove-Item 'C:\\tmp\\a,b' -Force", 'Remove-Item|C:\\tmp\\a,b|-Force'],
  ]
  for (const [label, cmd, want] of yQuoted) {
    const d = decomposeCommand(cmd, 'pwsh')
    ok('Y5 ' + label + '逗号是字面量（不切）',
      d.ok && d.segments[0].words.join('|') === want,
      d.ok ? JSON.stringify(d.segments[0].words) : 'F')
  }

  // ── Y6 segText 必须保留原文（例外匹配的对象）──────────────────────────────
  // 切的是**词元**，不是段原文：`Remove-Item "a", "b"` 仍须命中 `Remove-Item *`。
  const ySeg = decomposeCommand('Remove-Item "B:\\", "D:\\x" -Force', 'pwsh')
  ok('Y6 段原文保留逗号（例外匹配对象不受影响）',
    ySeg.ok && ySeg.segments[0].text === 'Remove-Item "B:\\", "D:\\x" -Force',
    ySeg.ok ? JSON.stringify(ySeg.segments[0].text) : 'F')
  ok('Y6 例外 `Remove-Item *` 仍命中数组形态',
    ySeg.ok && matchCommand('Remove-Item *', ySeg.segments[0].text),
    ySeg.ok ? JSON.stringify(ySeg.segments[0].text) : 'F')

  // ── Y7 结构断言：逗号分支必须按方言门控 ──────────────────────────────────
  // 盯「日后有人把 sh === 'pwsh' 这个门控删掉」——那会让 bash 侧凭空多出目标。
  const ySrc = readFileSync(pathJoin(ROOT, 'shell-parse.js'), 'utf8')
  ok('Y7 逗号分支按 pwsh 方言门控',
    ySrc.includes("if (sh === 'pwsh' && char === ',')"))
}

// ═════════════════════════════════════════════════════════════════════════════
group('AA. opaque 段的两条路径必须同口径（发现 1 / 发现 2 的修法）')
{
  // ── 背景：本批新增的 `RADIUS_TIERS_WHEN_UNREADABLE` 声称让**段级 opaque 路径**与
  // 「整行读不懂」分支对「目标读不出」取同一口径。核实后它当时并**不**同口径，两处 fail-open：
  //
  //   发现 1 —— 整行分支另外还并 `inside`（那处 `tiers.push('inside')` 是本批**未改动**的
  //   上下文，注释明写「丢掉它就等于丢掉一条显式表态」），而段级 opaque 支只并
  //   `wide ∪ unknown`。于是用户显式配的 `inside=deny` 在段级路径上被静默丢弃：
  //       rm -rf ./build              → deny（tiers=['inside']）
  //       echo a | rm -rf ./build     → deny（tiers=['inside']）  ← 非 opaque，走半径档
  //       echo a | (rm -rf ./build)   → **allow**（tiers=['wide','unknown']）❌ inside 档丢失
  //   且这一格是**本批改动新打开**的：HEAD 上它因行尾悬空检查返回 ok:false、走整行分支 → deny。
  //
  //   发现 2 —— 新守卫的门控是 `seg.opaque && !seg.blast`。反引号命令替换**不被词法器吞掉**，
  //   而是作为字面词元留在 `words` 里，于是 `blastRadiusOfSegment` 返回 `{level:'unknown'}`
  //   而非 `null`，门控**恒假**、守卫根本不被求值，落到 `else` 支只并 `unknown`：
  //       echo a | Write-Output $(rm -rf C:/Windows)   → deny  tiers=['wide','unknown']
  //       echo a | Write-Output (rm -rf C:/Windows)    → deny  tiers=['wide','unknown']
  //       echo a | Write-Output {rm -rf C:/Windows}    → deny  tiers=['wide','unknown']
  //       echo a | Write-Output `rm -rf C:/Windows`    → **allow** tiers=['unknown'] ❌
  //
  // 判据（六条，缺一即为「只修一支」或「过度收紧」）：
  //   ① 发现 1：`inside=deny` 下 opaque 段必须 deny，且 `tiers` 含 `inside`；
  //   ② 发现 2：`wide=deny` 下**四种构造写法**必须逐字同值（同一构造不得因写法不同而分叉）；
  //   ③ 两路径同口径：段级 opaque 段的档位集合必须**含**整行分支并的那三档
  //      （`wide` / `unknown` / `inside` 一个不少）；
  //   ④ 反向核查（不得误伤）：`rm -rf ./tmp/{a,b,c}` / `rm -rf ./build $(date)` 这类
  //      **合法常用命令**必须仍恰好 `['unknown']`，不得凭空多出 `wide`/`inside`；
  //   ⑤ 承重格：`diskpart /s a.txt` 恰好 `['unknown']`（「替换」语义保住）；
  //   ⑥ 不变量：`tiers` 不得出现重复项（整行分支去重 push 的形态断言）。
  {
    const dsOnly = (tier, rest) => {
      const t = {}
      for (const k of TIERS) t[k] = k === tier ? 'deny' : (rest || 'allow')
      return t
    }
    // 逐档配置的钩子（与 F96b 的 `opaqueDefault` 同形：覆盖 destructive 返回档位表）
    const withDs = (ds, opts) => Object.assign(hooks(Object.assign({ category: 'allow' }, opts || {})),
      { destructive: () => ds })
    const judge = (cmd, shell, platform, ds) => assessCommand(cmd, shell || 'bash', withDs(ds, { platform: platform || 'win32' }))
    const tiersOf2 = (cmd, shell, platform, ds) => {
      const r = judge(cmd, shell, platform, ds)
      return (r.segments || []).map((s) => s.tiers || [])
    }
    const flatTiers = (cmd, shell, platform, ds) => [].concat(...tiersOf2(cmd, shell, platform, ds))
    const bad = []
    const SHP = [['bash', 'win32'], ['bash', 'posix'], ['pwsh', 'win32'], ['pwsh', 'posix']]

    // ① 发现 1：`inside=deny` + 其余七档 allow —— opaque 段里的破坏性命令必须 deny 且含 inside
    //    ⚠️ 构造集**按方言取**（`OPAQUE_FORMS`，见文件头）：pwsh 的第四种构造是 `@( )`，
    //       不是反引号 —— 反引号在 pwsh 里是转义符，`` `rm `` 求值为 `<CR>m`、**不执行 rm**。
    //       另加一个方言中立的分组写法 `ForEach-Object { … }`（两侧都真会执行）。
    const dsInside = dsOnly('inside')
    const insideFormsOf = (sh) => {
      const out = []
      for (const [, mk] of OPAQUE_FORMS[sh]) for (const sep of SEPS) out.push(sep + mk('rm -rf ./build'))
      for (const sep of SEPS) out.push(sep + 'ForEach-Object { rm -rf ./build }')
      return out
    }
    const insideForms = SHP.flatMap(([sh]) => insideFormsOf(sh))
    for (const [sh, pl] of SHP) for (const c of insideFormsOf(sh)) {
      const r = judge(c, sh, pl, dsInside)
      const t = flatTiers(c, sh, pl, dsInside)
      if (r.action !== 'deny') bad.push(['发现1 未 deny', c, sh, pl, r.action, t.join('+')])
      if (t.indexOf('inside') === -1) bad.push(['发现1 缺 inside 档', c, sh, pl, t.join('+')])
      // ③ 两路径同口径：整行分支并的三档必须都在
      for (const want of ['wide', 'unknown', 'inside']) {
        if (t.indexOf(want) === -1) bad.push(['发现1 口径不全，缺 ' + want, c, sh, pl, t.join('+')])
      }
    }

    // ② 发现 2：`wide=deny` + 其余七档 allow —— 同一构造的四种写法必须逐字同值
    //    ⚠️ 四种写法**按方言取**（`OPAQUE_FORMS`）：bash 的第四种是反引号命令替换，
    //       pwsh 的第四种是 `@( )` —— 拿反引号去测 pwsh 会因「`` `rm `` 不执行 rm」而假红。
    const dsWide = dsOnly('wide')
    const keyOf = (c, sh, pl) => {
      const r = judge(c, sh, pl, dsWide)
      return r.action + '|' + flatTiers(c, sh, pl, dsWide).join('+')
    }
    for (const c of ['rm -rf C:/Windows', 'rm -rf ./build', 'rm -rf /', 'rm -rf ../other', 'rm -rf $TARGET']) {
      for (const [sh, pl] of SHP) {
        const ks = OPAQUE_FORMS[sh].map(([, mk]) => keyOf('Write-Output ' + mk(c), sh, pl))
        if (new Set(ks).size !== 1) bad.push(['发现2 四写法分叉', c, sh, pl, ks.join('  vs  ')])
      }
    }
    // 反引号在管道/包装位置同样不得漏网 —— **bash 侧**（那里的反引号是真命令替换）
    for (const c of ['echo a | Write-Output ' + BT + 'rm -rf C:/Windows' + BT,
      'echo a | ' + BT + 'rm -rf C:/Windows' + BT,
      'Write-Output ' + BT + 'rm -rf C:/Windows' + BT]) {
      for (const [sh, pl] of SHP.filter(([s]) => s === 'bash')) {
        if (judge(c, sh, pl, dsWide).action !== 'deny') bad.push(['发现2 反引号位置形态未 deny', c, sh, pl])
      }
    }
    // ── pwsh 侧的真危险形态：反引号 + **未知转义**（名字被保留、真会执行）──────────────
    // 只在**命令位**成立：`Write-Output `` `Remove-Item `` 只是把名字当参数打印，不执行。
    // 故这里用命令位语料（行首 / 管道后），判据取**平台中立**的那条不变量：
    //     未知转义 ⇒ 反引号被丢掉 ⇒ 判定必须与**不带反引号的同名命令**逐字相同
    // （实测 64/64 同值）。不写死「必须 deny 且含 wide」—— `C:/Windows` 在 posix 下
    // 本就是 `outside` 而非 `wide`（系统目录名单按平台分列），写死会把平台差异误报成缺陷。
    for (const esc of PWSH_ESCAPED_NAMES) {
      const plain = esc.slice(1)   // 去掉开头的反引号 = 同一个命令名
      for (const c of [esc, 'echo a | ' + esc]) {
        const p = c.replace(esc, plain)
        for (const pl of ['win32', 'posix']) {
          for (const tier of TIERS) {
            const ds = dsOnly(tier)
            const a = judge(c, 'pwsh', pl, ds), b = judge(p, 'pwsh', pl, ds)
            if (a.action !== b.action || flatTiers(c, 'pwsh', pl, ds).join('+') !== flatTiers(p, 'pwsh', pl, ds).join('+')) {
              bad.push(['发现2 pwsh 未知转义与同名裸命令判定分叉（' + tier + '=deny）', c, 'vs', p, pl,
                a.action + '|' + flatTiers(c, 'pwsh', pl, ds).join('+'), b.action + '|' + flatTiers(p, 'pwsh', pl, ds).join('+')])
            }
          }
          // 防空转：这条**转义形态**必须真的被判成破坏性 —— 至少存在某一档 deny 能拦住它。
          // 不写死「wide」：`C:/Windows` 在 win32 是 wide、在 posix 是 outside（系统目录
          // 名单按平台分列），`kill` 走的是 proc。逐档扫一遍即可覆盖三者且与平台无关。
          // 缺了这条，「与裸命令同值」在**两侧同时认不出**时也会通过（等价但空转）。
          if (!TIERS.some((tier) => judge(c, 'pwsh', pl, dsOnly(tier)).action === 'deny')) {
            bad.push(['发现2 pwsh 未知转义形态没有任何档能拦住（空转）', c, pl])
          }
        }
      }
    }

    // ④ 反向核查（必须 0 误伤）：合法常用命令仍恰好 `['unknown']`
    //    ⚠️ 反引号那格**按方言分列**：bash 的反引号是**命令替换**（opaque → 替换语义 → unknown），
    //       pwsh 的反引号是**转义**（`` `date` `` 就是字面参数 `date`` `` ` ``，不构成构造），
    //       故它必须与**裸命令**同值（`./build` 的半径 = inside），而不是 unknown。
    const dsAny = dsOnly('wide')  // 最严的「只 wide deny」配置，最容易被误伤
    for (const c of ['rm -rf ./tmp/{a,b,c}', 'rm -rf ./build $(date)',
      'chmod 777 ./{a,b}.sh', 'rm -rf ./{a,b}/x', 'rm -rf {a,b}', 'rm -rf $TARGET']) {
      for (const [sh, pl] of SHP) {
        const t = flatTiers(c, sh, pl, dsAny)
        if (t.indexOf('inside') !== -1) bad.push(['误伤：合法命令被并 inside', c, sh, pl, t.join('+')])
        if (t.indexOf('wide') !== -1) bad.push(['误伤：合法命令被并 wide', c, sh, pl, t.join('+')])
        if (t.join('+') !== 'unknown') bad.push(['合法命令档位变化（应为恰好 unknown）', c, sh, pl, t.join('+')])
      }
    }
    // bash：反引号命令替换 → opaque → 恰好 unknown（与 `$( )` 同口径）
    for (const [sh, pl] of SHP.filter(([s]) => s === 'bash')) {
      const c = 'rm -rf ./build ' + BT + 'date' + BT
      const t = flatTiers(c, sh, pl, dsAny)
      if (t.join('+') !== 'unknown') bad.push(['bash 反引号命令替换档位变化', c, sh, pl, t.join('+')])
    }
    // pwsh：反引号转义 → **与裸命令同值**（多一个字面参数不得改变档位）
    for (const [sh, pl] of SHP.filter(([s]) => s === 'pwsh')) {
      const withEsc = flatTiers('rm -rf ./build ' + BT + 'date' + BT, sh, pl, dsAny).join('+')
      const bare = flatTiers('rm -rf ./build', sh, pl, dsAny).join('+')
      if (withEsc !== bare) {
        bad.push(['pwsh 转义参数改变了档位（应与裸命令同值）', 'rm -rf ./build `date`', sh, pl, 'esc=' + withEsc, 'bare=' + bare])
      }
    }

    // ⑤ 承重格：「替换」语义 —— `diskpart /s a.txt` 恰好 `['unknown']`
    for (const [sh, pl] of SHP) {
      if (flatTiers('diskpart /s a.txt', sh, pl, dsAny).join('+') !== 'unknown') {
        bad.push(['承重格 diskpart 替换语义破坏', sh, pl, flatTiers('diskpart /s a.txt', sh, pl, dsAny).join('+')])
      }
    }

    // ⑥ 不变量：`tiers` 不得有重复项（整行分支与段级路径都要守）
    for (const c of insideForms.concat(['rm -rf ./build <<EOF\nx\nEOF', 'rm -rf C:/Windows <<EOF\nx\nEOF'])) {
      for (const [sh, pl] of SHP) {
        for (const arr of tiersOf2(c, sh, pl, dsInside)) {
          if (new Set(arr).size !== arr.length) bad.push(['tiers 出现重复项', c, sh, pl, arr.join('+')])
        }
      }
    }

    // ⑦ 防空转：无 opaque 的组档段不得凭空多出 wide/inside
    for (const c of ['kill 1234', 'pkill', 'reboot', 'shutdown /s']) {
      for (const [sh, pl] of SHP) {
        const t = flatTiers(c, sh, pl, dsAny)
        if (t.indexOf('inside') !== -1 || t.indexOf('wide') !== -1) bad.push(['防空转：无 opaque 却多档', c, sh, pl, t.join('+')])
      }
    }

    ok('★★ AA opaque 段两条路径同口径（发现 1：段级须并 inside；发现 2：反引号须并 wide）',
      bad.length === 0, JSON.stringify(bad.slice(0, 8)))
  }
}

// ─────────────────────────────────────────────────────────────────────────────
group('AB. 提权前缀 + opaque 构造：`wide`/`inside` 不得被静默丢弃（发现 1 的修法）')
{
  // ── 为什么单开一组：AA 组语料**不含任何提权前缀**，故发现 1 的回归网有缺口 ──────
  // `destructiveHeadReadable` 的判据是「段首主 label 是否在 `DESTRUCTIVE_LABELS` 里」，
  // 而 6 个提权前缀（sudo / doas / su / pkexec / runas / gsudo）**全部**在那个名单里
  // （`:96` 的「提权」一行，且 `:6767-6768` 明文要求不要把它们移出名单）。于是
  // 「提权前缀 + 真命令藏在 opaque 构造里」被判成「命令可读」→ 走 `else` 支只并
  // `unknown` → 用户显式配的 `wide=deny` / `inside=deny` 被静默丢弃（fail-open）。
  //
  // 修法：`destructiveHeadReadable` 增加 `if (!head) return false;` 与
  // `if (PRIV_PREFIXES[head] === 1) return false;`（提权前缀不是命令头 —— 段首读出
  // `sudo` 恰恰说明真命令在别处，与 `commandHeadEnd` 穿过提权前缀取真命令头同口径）。
  //
  // 实测（`wide=deny` + 其余七档 allow）：修复前 `echo a | sudo $(rm -rf C:/Windows)`
  // → **allow**（tiers=`['unknown','priv']`）；修复后 → deny
  // （tiers=`['wide','unknown','inside','priv']`）。
  {
    const dsOnly = (tier) => {
      const t = {}
      for (const k of TIERS) t[k] = k === tier ? 'deny' : 'allow'
      return t
    }
    const withDs = (ds, opts) => Object.assign(hooks(Object.assign({ category: 'allow' }, opts || {})), { destructive: () => ds })
    const judge = (cmd, sh, pl, ds) => assessCommand(cmd, sh, withDs(ds, { platform: pl }))
    const flat = (cmd, sh, pl, ds) => [].concat(...(judge(cmd, sh, pl, ds).segments || []).map((s) => s.tiers || []))
    const bad = []
    const SHP = [['bash', 'win32'], ['bash', 'posix'], ['pwsh', 'win32'], ['pwsh', 'posix']]
    const PRIVS = ['sudo', 'doas', 'su', 'pkexec', 'runas', 'gsudo']

    // ① 6 提权前缀 × 4 构造 × 7 分隔符 × 4 (shell,platform) —— `wide=deny` 下必须 deny
    //    且含 `wide`；`inside=deny` 下必须 deny 且含 `inside`。
    //    ⚠️ 构造集**按方言取**（`OPAQUE_FORMS`，与 AA 组同源）：pwsh 的第四种是 `@( )`，
    //       不是反引号 —— 反引号在 pwsh 里是转义符，`` sudo `rm -rf X `` 的命令名是
    //       `<CR>m`，**sudo 不会执行 rm**（实测），拿它断言 deny 是假红。
    const dsWide = dsOnly('wide'), dsInside = dsOnly('inside')
    let n1 = 0
    for (const [sh, pl] of SHP) for (const p of PRIVS) for (const [, mk] of OPAQUE_FORMS[sh]) for (const sep of SEPS) {
      const c = sep + p + ' ' + mk('rm -rf C:/Windows')
      n1 += 1
      const tw = flat(c, sh, pl, dsWide)
      if (judge(c, sh, pl, dsWide).action !== 'deny') bad.push(['提权+opaque 未 deny（wide=deny）', c, sh, pl, tw.join('+')])
      if (tw.indexOf('wide') === -1) bad.push(['提权+opaque 缺 wide 档', c, sh, pl, tw.join('+')])
      const ti = flat(c, sh, pl, dsInside)
      if (judge(c, sh, pl, dsInside).action !== 'deny') bad.push(['提权+opaque 未 deny（inside=deny）', c, sh, pl, ti.join('+')])
      if (ti.indexOf('inside') === -1) bad.push(['提权+opaque 缺 inside 档', c, sh, pl, ti.join('+')])
    }
    // ①′ pwsh 侧「提权前缀 + 反引号未知转义」—— 名字被保留、真会执行，必须拦得住。
    //     判据取**平台中立**的那条：与「提权前缀 + 同名裸命令」逐字同值
    //     （不写死「必须含 wide」—— `C:/Windows` 在 posix 下本就是 outside）。
    for (const p of PRIVS) for (const esc of PWSH_ESCAPED_NAMES) {
      const plain = esc.slice(1)
      for (const pl of ['win32', 'posix']) {
        for (const tier of TIERS) {
          const ds = dsOnly(tier)
          const full = p + ' ' + esc, bare = p + ' ' + plain
          if (judge(full, 'pwsh', pl, ds).action !== judge(bare, 'pwsh', pl, ds).action ||
            flat(full, 'pwsh', pl, ds).join('+') !== flat(bare, 'pwsh', pl, ds).join('+')) {
            bad.push(['提权+pwsh 未知转义与同名裸命令分叉（' + tier + '=deny）', full, 'vs', bare, pl,
              flat(full, 'pwsh', pl, ds).join('+'), flat(bare, 'pwsh', pl, ds).join('+')])
          }
        }
        // 防空转：提权 + 转义形态必须真的被判成破坏性（至少一档能拦），否则上面的
        // 「同值」在两侧同时认不出时也会通过。
        if (!TIERS.some((tier) => judge(p + ' ' + esc, 'pwsh', pl, dsOnly(tier)).action === 'deny')) {
          bad.push(['提权+pwsh 未知转义形态没有任何档能拦住（空转）', p + ' ' + esc, pl])
        }
      }
    }

    // ② 与**无前缀**的同形命令逐字同值（提权前缀不得让判定分叉）
    //    ⚠️ 构造集按方言取（`OPAQUE_FORMS`），理由同 ①。
    for (const [sh, pl] of SHP) for (const [, mk] of OPAQUE_FORMS[sh]) for (const sep of SEPS) {
      const bare = sep + mk('rm -rf C:/Windows')
      const kb = judge(bare, sh, pl, dsWide).action + '|' + flat(bare, sh, pl, dsWide).join('+')
      for (const p of PRIVS) {
        const c = sep + p + ' ' + mk('rm -rf C:/Windows')
        const k = judge(c, sh, pl, dsWide).action + '|' + flat(c, sh, pl, dsWide).join('+')
        // 提权形态**另含** priv 档，故只要求动作一致 + 半径三档一个不少
        if (judge(c, sh, pl, dsWide).action !== judge(bare, sh, pl, dsWide).action) {
          bad.push(['提权形态与无前缀形态动作分叉', c, 'vs', bare, sh, pl, k, kb])
        }
        for (const want of ['wide', 'unknown', 'inside']) {
          if (flat(c, sh, pl, dsWide).indexOf(want) === -1) bad.push(['提权形态缺 ' + want + ' 档', c, sh, pl, flat(c, sh, pl, dsWide).join('+')])
        }
      }
    }

    // ③ 反向核查（必须 0 误伤）：**无 opaque 构造**的提权命令行为逐字不变 ——
    //    修法只应影响「真命令藏在构造里」那一族。
    // ⚠️ 期望值**按平台分列**：`/etc` 与 `C:/Windows` 的系统目录名单本来就是
    //    win32/posix 各一套（posix 下 `/etc` 是 system → wide、`C:/Windows` 是普通
    //    相对路径 → outside；win32 下反过来），这不是本修法引入的差异。
    const noOpaque = [
      ['sudo ls', 'allow', 'allow'], ['doas ls', 'allow', 'allow'], ['su -c ls', 'allow', 'allow'],
      ['pkexec ls', 'allow', 'allow'], ['runas /user:x ls', 'allow', 'allow'], ['gsudo ls', 'allow', 'allow'],
      ['sudo rm -rf /etc', 'allow', 'deny'], ['sudo rm -rf C:/Windows', 'deny', 'allow'],
      ['sudo rm -rf /', 'deny', 'deny'],
    ]
    for (const [c, wantWin, wantPosix] of noOpaque) {
      for (const [sh, pl] of SHP) {
        const want = pl === 'win32' ? wantWin : wantPosix
        const r = judge(c, sh, pl, dsWide)
        if (r.action !== want) bad.push(['误伤：无 opaque 的提权命令行为改变', c, sh, pl, 'want=' + want + ' got=' + r.action, flat(c, sh, pl, dsWide).join('+')])
      }
    }
    // ④ 反向核查：合法常用命令仍恰好 `['unknown']`（与 AA 组 ④ 同判据）
    //    ⚠️ 反引号那格按方言分列，理由同 AA 组 ④（bash 是命令替换、pwsh 是转义）。
    for (const c of ['rm -rf ./tmp/{a,b,c}', 'rm -rf ./build $(date)',
      'chmod 777 ./{a,b}.sh', 'rm -rf $TARGET']) {
      for (const [sh, pl] of SHP) {
        const t = flat(c, sh, pl, dsWide)
        if (t.join('+') !== 'unknown') bad.push(['误伤：合法命令档位变化（应为恰好 unknown）', c, sh, pl, t.join('+')])
      }
    }
    for (const [sh, pl] of SHP.filter(([s]) => s === 'bash')) {
      const c = 'rm -rf ./build ' + BT + 'date' + BT
      if (flat(c, sh, pl, dsWide).join('+') !== 'unknown') {
        bad.push(['误伤：bash 反引号命令替换档位变化', c, sh, pl, flat(c, sh, pl, dsWide).join('+')])
      }
    }
    for (const [sh, pl] of SHP.filter(([s]) => s === 'pwsh')) {
      const withEsc = flat('rm -rf ./build ' + BT + 'date' + BT, sh, pl, dsWide).join('+')
      const bare = flat('rm -rf ./build', sh, pl, dsWide).join('+')
      if (withEsc !== bare) bad.push(['pwsh 转义参数改变了档位（应与裸命令同值）', sh, pl, 'esc=' + withEsc, 'bare=' + bare])
    }
    // ⑤ 防空转：`destructiveHeadReadable` 的提权排除**不得**影响段级 blast 判据 ——
    //    `sudo rm -rf /` 的半径仍须是 drive-root（`:6763-6766` 的现值依赖）。
    for (const [sh, pl] of SHP) {
      const r = judge('sudo rm -rf /', sh, pl, dsWide)
      const lvl = (r.segments || []).map((s) => (s.blast ? s.blast.level : 'null')).join('/')
      if (lvl.indexOf('drive-root') === -1) bad.push(['提权命令的半径判据被削弱', sh, pl, lvl])
    }

    ok('★★ AB 提权前缀 + opaque 构造：wide/inside 档不得被静默丢弃（' + n1 + ' 格 × 2 配置）',
      bad.length === 0, JSON.stringify(bad.slice(0, 8)))
  }
}

// ─────────────────────────────────────────────────────────────────────────────
group('AC. 诱饵目标 + 纯组档段：门控的两个缺口（发现 2 / 发现 3 的修法）')
{
  // ── 发现 2：**诱饵目标**使 `wide`/`inside` 静默消失 ──────────────────────────────
  // 半径门控内那条守卫的判据是「`blast` 空**或**为 `unknown`」。当 opaque 段里另有一个
  // **可读**目标、且其 blast 恰为 `outside`（`home` 同）时该式为假 → 落 `else` 支 →
  // 只并 `outside`，`wide` 与 `inside` 从 tiers **静默消失**。
  // 实测（`wide=deny` + 其余七档 allow，修复前）：
  //     cat /etc/hosts $(rm -rf C:/Windows)  → **allow** tiers=['unknown','outside']
  //     echo $(rm -rf C:/Windows)            → deny      tiers=['wide','unknown','inside'] ✅
  // 修法：把 `opaqueHiddenPayload` 并进守卫判据，并在三档之后**显式保留**诱饵已判出的
  // 半径档（只并三档会丢掉用户可能显式配过的 `outside=deny`）。
  //
  // ── 发现 3：**纯组档段**整段不进半径门控 ────────────────────────────────────────
  // 门控 `hasPureRadius || (hasPrivGroup && seg.blast)` 只覆盖半径组 label，而
  // `kill` / `pkill` / `reboot` / `shutdown` / `taskkill` / `stop-computer` /
  // `reg delete` / `stop-process` 的组是 `proc`/`power`/`reg` —— 既非 pureRadius 也非
  // privGroup，于是新守卫**从不被求值**。
  // 实测（`wide=deny` + 其余七档 allow，修复前）：
  //     echo a | (rm -rf ./build)  → deny tiers=['wide','unknown','inside'] ✅
  //     echo a | (kill 1234)       → **allow** tiers=['unknown','proc']      ❌
  // 修法：门控增加第三项 `opaqueHiddenPayload`（= `seg.opaque && !destructiveHeadReadable(seg)`）。
  {
    const dsOnly = (tier) => { const t = {}; for (const k of TIERS) t[k] = k === tier ? 'deny' : 'allow'; return t }
    const withDs = (ds, opts) => Object.assign(hooks(Object.assign({ category: 'allow' }, opts || {})), { destructive: () => ds })
    const judge = (cmd, sh, pl, ds) => assessCommand(cmd, sh, withDs(ds, { platform: pl }))
    const flat = (cmd, sh, pl, ds) => [].concat(...(judge(cmd, sh, pl, ds).segments || []).map((s) => s.tiers || []))
    const bad = []
    const SHP = [['bash', 'win32'], ['bash', 'posix'], ['pwsh', 'win32'], ['pwsh', 'posix']]
    const dsWide = dsOnly('wide'), dsInside = dsOnly('inside'), dsOutside = dsOnly('outside')

    // ① 发现 2：诱饵目标（可读、且其自身半径档为 outside / wide） × 4 构造 × 7 分隔符
    // ⚠️ 诱饵档位**按平台实测取值**，不写死：`/etc/hosts` 在 win32 下是普通外部路径
    //    （outside），在 posix 下是**系统目录**（system → wide）；`~/notes.txt` 两侧都是
    //    outside。断言「诱饵那一档必须保留」时要用实测值，否则会把平台差异误报成缺陷。
    // ⚠️ 构造集**按方言取**（`OPAQUE_FORMS`，与 AA/AB 同源）：pwsh 的第四种是 `@( )`。
    let n2 = 0
    for (const [sh, pl] of SHP) for (const bait of ['/etc/hosts', '~/notes.txt']) for (const [, mk] of OPAQUE_FORMS[sh]) for (const sep of SEPS) {
      const c = sep + 'cat ' + bait + ' ' + mk('rm -rf C:/Windows')
      n2 += 1
      {
        const tw = flat(c, sh, pl, dsWide)
        if (judge(c, sh, pl, dsWide).action !== 'deny') bad.push(['诱饵形态未 deny', c, sh, pl, tw.join('+')])
        for (const want of ['wide', 'unknown', 'inside']) {
          if (tw.indexOf(want) === -1) bad.push(['诱饵形态缺 ' + want + ' 档', c, sh, pl, tw.join('+')])
        }
        // 诱饵**已判出的半径档**必须保留（不得因并三档而丢掉用户可能显式配过的档）。
        // ⚠️ 诱饵档从**段级 blast** 推导，不能从「`cat <诱饵>` 单独成命令」推导 ——
        //    `cat` 不是破坏性命令，那种探针返回的 blast 恒为 null，会推出恒真的 `inside`
        //    而使断言空转（实测过）。这里直接读本段 blast 的 level 再经 `radiusTierOf` 归并。
        const segBlast = (judge(c, sh, pl, dsWide).segments || [])
          .map((s) => s.blast).filter((b) => b && b.level)[0]
        if (!segBlast) bad.push(['诱饵形态读不到段级 blast（语料失效）', c, sh, pl])
        else {
          const baitTier = radiusTierOf({ level: segBlast.level })
          if (tw.indexOf(baitTier) === -1) bad.push(['诱饵形态丢了诱饵档 ' + baitTier, c, sh, pl, tw.join('+')])
          // 诱饵档若恰好是 `outside`（win32 下的 `/etc/hosts`），`outside=deny` 必须 deny
          if (baitTier === 'outside' && judge(c, sh, pl, dsOutside).action !== 'deny') {
            bad.push(['诱饵形态未 deny（outside=deny）', c, sh, pl])
          }
        }
        const ti = flat(c, sh, pl, dsInside)
        if (judge(c, sh, pl, dsInside).action !== 'deny') bad.push(['诱饵形态未 deny（inside=deny）', c, sh, pl, ti.join('+')])
      }
    }
    // ② 诱饵档位**不触发**的四种目标：不得凭空多档（它们自身已归 wide/unknown，
    //    或 blast 为 null 时走 `!seg.blast` 那条既有判据）—— 只断言「不得比修复前更松」
    for (const [sh, pl] of SHP) for (const bait of ['C:/Windows/x', 'B:/', '$T', './build']) for (const [, mk] of OPAQUE_FORMS[sh]) for (const sep of SEPS) {
      const c = sep + 'cat ' + bait + ' ' + mk('rm -rf C:/Windows')
      {
        const tw = flat(c, sh, pl, dsWide)
        if (judge(c, sh, pl, dsWide).action !== 'deny') bad.push(['诱饵（不触发档）形态未 deny', c, sh, pl, tw.join('+')])
        for (const want of ['wide', 'unknown', 'inside']) {
          if (tw.indexOf(want) === -1) bad.push(['诱饵（不触发档）缺 ' + want, c, sh, pl, tw.join('+')])
        }
      }
    }

    // ③ 发现 3：8 个纯组档命令 × 4 构造 × 7 分隔符 —— `wide=deny` 下必须 deny 且含 wide
    //    ⚠️ 构造集按方言取（`OPAQUE_FORMS`），理由同 ①。
    const GROUP_CMDS = ['kill 1234', 'pkill', 'reboot', 'shutdown /s', 'taskkill /im x.exe',
      'stop-computer', 'reg delete HKCU\\X /f', 'stop-process -Id 1']
    let n3 = 0
    for (const [sh, pl] of SHP) for (const g of GROUP_CMDS) for (const [, mk] of OPAQUE_FORMS[sh]) for (const sep of SEPS) {
      const c = sep + mk(g)
      n3 += 1
      const tw = flat(c, sh, pl, dsWide)
      if (judge(c, sh, pl, dsWide).action !== 'deny') bad.push(['组档+opaque 未 deny', c, sh, pl, tw.join('+')])
      for (const want of ['wide', 'unknown', 'inside']) {
        if (tw.indexOf(want) === -1) bad.push(['组档+opaque 缺 ' + want + ' 档', c, sh, pl, tw.join('+')])
      }
    }
    // ④ 反向核查（必须 0 误伤）：**无 opaque** 的纯组档命令不得凭空多出 wide/inside
    //    （门控第三项带 `seg.opaque`，这一族必须逐字不变）
    for (const g of GROUP_CMDS) for (const [sh, pl] of SHP) {
      const t = flat(g, sh, pl, dsWide)
      if (t.indexOf('inside') !== -1 || t.indexOf('wide') !== -1) bad.push(['误伤：无 opaque 的组档命令多档', g, sh, pl, t.join('+')])
    }
    // ⑤ 承重格：`diskpart /s a.txt`（opaque 为空）必须仍恰好 `['unknown']`（「替换」语义）
    for (const [sh, pl] of SHP) {
      if (flat('diskpart /s a.txt', sh, pl, dsWide).join('+') !== 'unknown') {
        bad.push(['承重格 diskpart 替换语义破坏', sh, pl, flat('diskpart /s a.txt', sh, pl, dsWide).join('+')])
      }
    }
    // ⑥ 承重格：`echo a | (rm -rf ./build)` 仍须 deny 且三档齐全（del 族进门控的既有路径）
    for (const [sh, pl] of SHP) {
      const t = flat('echo a | (rm -rf ./build)', sh, pl, dsWide)
      if (judge('echo a | (rm -rf ./build)', sh, pl, dsWide).action !== 'deny') bad.push(['承重格 del 族未 deny', sh, pl, t.join('+')])
      for (const want of ['wide', 'unknown', 'inside']) {
        if (t.indexOf(want) === -1) bad.push(['承重格 del 族缺 ' + want, sh, pl, t.join('+')])
      }
    }
    // ⑦ 合法常用命令仍恰好 `['unknown']`（发现 2/3 都不得误伤这一族）
    //    ⚠️ 反引号那格按方言分列，理由同 AA 组 ④（bash 是命令替换、pwsh 是转义）。
    for (const c of ['rm -rf ./tmp/{a,b,c}', 'rm -rf ./build $(date)', 'chmod 777 ./{a,b}.sh',
      'rm -rf $TARGET']) {
      for (const [sh, pl] of SHP) {
        const t = flat(c, sh, pl, dsWide)
        if (t.join('+') !== 'unknown') bad.push(['误伤：合法命令档位变化（应为恰好 unknown）', c, sh, pl, t.join('+')])
      }
    }
    for (const [sh, pl] of SHP.filter(([s]) => s === 'bash')) {
      const c = 'rm -rf ./build ' + BT + 'date' + BT
      if (flat(c, sh, pl, dsWide).join('+') !== 'unknown') {
        bad.push(['误伤：bash 反引号命令替换档位变化', c, sh, pl, flat(c, sh, pl, dsWide).join('+')])
      }
    }
    for (const [sh, pl] of SHP.filter(([s]) => s === 'pwsh')) {
      const withEsc = flat('rm -rf ./build ' + BT + 'date' + BT, sh, pl, dsWide).join('+')
      const bare = flat('rm -rf ./build', sh, pl, dsWide).join('+')
      if (withEsc !== bare) bad.push(['pwsh 转义参数改变了档位（应与裸命令同值）', sh, pl, 'esc=' + withEsc, 'bare=' + bare])
    }

    ok('★★ AC 诱饵目标（' + n2 + ' 格）与纯组档段（' + n3 + ' 格）不得丢失 wide/inside',
      bad.length === 0, JSON.stringify(bad.slice(0, 8)))
  }
}

// ─────────────────────────────────────────────────────────────────────────────
group('AD. `&` 之前的重定向无目标：不得被 `&` 的豁免放行（发现 4 的修法）')
{
  // ── 问题 ────────────────────────────────────────────────────────────────────
  // `ampNoTarget = pending !== undefined && !started` 只写进 `ampOk`，而 `ampOk` 仅在
  // 「段无内容」时才决定是否报错：`&` 后面还有内容时 `segHasContent` 为真 → 短路 →
  // 整行照旧 `ok:true`。根因是 `&` 分支的 `flushSegment()` 把 `pending` 复位了，
  // 行尾那条保留的词元级判据 `pending !== undefined && !started` 看不到 `&` **之前**的 `>`。
  //
  // 修法：新增只在最后一个 `&` 写入的 `ampTargetMissing` 标记并接到行尾检查。
  //
  // 实测（修复前 → 修复后）：`echo a > & (b)` / `> & $(b)` / `> & { b; }` / `> & )`
  // 由 ok:true 变 ok:false；Git bash 实测这四种与 `echo a > & b` 都是
  // `syntax error near unexpected token '&'`（exit=2），而 `echo a > b &` 合法（exit=0）。
  {
    const bad = []
    // ① 必须拦下：`&` 之前有等着目标的重定向
    for (const c of ['echo a > & (b)', '> & $(b)', '> & { b; }', '> & )', 'echo a > & b',
      'echo a > & ' + String.fromCharCode(96) + 'b' + String.fromCharCode(96),
      'echo a < & (b)', 'echo a >> & (b)', 'echo a > > & (b)',
      'echo a > & | cat', 'echo a > & && cat', 'echo a > &;', 'echo a > & (b) &', 'a > & (b) | c']) {
      for (const sh of ['bash', 'pwsh']) {
        const r = decomposeCommand(c, sh)
        if (r.ok !== false) bad.push(['`&` 前的无目标重定向被放行', c, sh, JSON.stringify(r.ok ? r.segments.map((s) => s.text) : r)])
      }
    }
    // ② 反向核查（必须 0 误伤）：合法的异步列表收尾仍须 ok:true
    for (const c of ['echo a > b &', 'echo a 2>&1 &', 'echo a > $f &', 'echo a > b', 'echo a > $f']) {
      const r = decomposeCommand(c, 'bash')
      if (r.ok !== true) bad.push(['误伤：合法重定向形态被拦下', c, 'bash', JSON.stringify(r)])
    }
    // ③ 既有的 `echo a > &`（`&` 在行尾）仍须 ok:false（不得因新标记而变成 ok:true）
    for (const sh of ['bash', 'pwsh']) {
      if (decomposeCommand('echo a > &', sh).ok !== false) bad.push(['echo a > & 被放行', sh])
      if (decomposeCommand('echo a > & ', sh).ok !== false) bad.push(['echo a > & （尾随空白）被放行', sh])
    }
    // ④ 既有的尾随 `&` 豁免不得被削掉（`ampTargetMissing` 必须只在「有 pending」时为真）
    if (decomposeCommand('echo a &', 'bash').ok !== true) bad.push(['误伤：echo a & 被拦下'])
    if (decomposeCommand('echo a & &', 'bash').ok !== false) bad.push(['echo a & & 被放行'])
    if (decomposeCommand('echo a | &', 'bash').ok !== false) bad.push(['echo a | & 被放行'])

    ok('★ AD `&` 之前的重定向无目标必须 ok:false，合法异步列表收尾不得误伤',
      bad.length === 0, JSON.stringify(bad.slice(0, 8)))
  }
}

// ─────────────────────────────────────────────────────────────────────────────
group('AE. 排序键与整行分支的形态不变量（发现 5 / 发现 6 的修法）')
{
  // ── 发现 5：`TIER_RANK` 的比较实现必须**只有一处** ──────────────────────────────
  // `tierVerdict` 里曾经手抄一份逐字相同的比较函数，而它直接决定**用户可见的拒绝理由**。
  // 修法：换成 `sortTiersByRank(same)`（`same` 是局部新数组，原地排序无副作用）。
  // 结构断言：源码里不得再出现手抄的那两行。
  {
    const spSrc = readFileSync(pathJoin(ROOT, 'shell-parse.js'), 'utf8')
    const bad = []
    const handCopy = (spSrc.match(/ra === undefined \? 99 : ra/g) || []).length
    if (handCopy !== 1) bad.push(['`TIER_RANK` 比较实现不是恰好一处（发现 5 回退）', 'count=' + handCopy])
    const consumers = (spSrc.match(/TIER_RANK\[/g) || []).length
    if (consumers !== 2) bad.push(['`TIER_RANK[...]` 消费点不是恰好两处（应只在 sortTiersByRank 内）', 'count=' + consumers])
    if (!spSrc.includes('sortTiersByRank(same)')) bad.push(['tierVerdict 未复用 sortTiersByRank'])
    // `tierSetOf` 与整行分支仍须共用同一个排序函数
    const uses = (spSrc.match(/sortTiersByRank\(/g) || []).length
    if (uses !== 4) bad.push(['sortTiersByRank 的调用点不是 3 处 + 定义 1 处', 'count=' + uses])
    ok('★ AE 排序键单一实现（发现 5）：TIER_RANK 比较只有一处、三处调用共用',
      bad.length === 0, JSON.stringify(bad.slice(0, 8)))
  }
  // ── 发现 6：整行分支的三档并入不得退化成「条件恒真」的死守卫 ─────────────────────
  // 修法：简化为裸 push，并订正与实测相反的注释。
  {
    const spSrc = readFileSync(pathJoin(ROOT, 'shell-parse.js'), 'utf8')
    const bad = []
    // 该处不得再出现 `indexOf(t) === -1` 形态的守卫（条件恒真 = 死代码）
    if (/for \(const t of RADIUS_TIERS_WHEN_UNREADABLE\) \{\s*\n\s*if \(tiers\.indexOf\(t\) === -1\)/.test(spSrc)) {
      bad.push(['发现 6 回退：去重守卫条件恒真'])
    }
    if (!spSrc.includes('for (const t of RADIUS_TIERS_WHEN_UNREADABLE) tiers.push(t)')) {
      bad.push(['整行分支未简化为裸 push'])
    }
    ok('★ AE 整行分支三档并入：死守卫已移除（发现 6）', bad.length === 0, JSON.stringify(bad.slice(0, 8)))
  }
  // ── 行为核查：整行读不懂分支的 `tiers` 不得重复，且三档齐全（行为不得回退）─────
  {
    const dsOnly = (tier) => { const t = {}; for (const k of TIERS) t[k] = k === tier ? 'deny' : 'allow'; return t }
    const withDs = (ds) => Object.assign(hooks({ category: 'allow' }), { destructive: () => ds })
    const bad = []
    for (const c of ['rm -rf C:/Windows <<EOF\nx\nEOF', 'rm -rf ./build <<EOF\nx\nEOF',
      'sudo kill 1234 <<EOF\nx\nEOF', 'kill 1234 <<EOF\nx\nEOF']) {
      for (const [sh, pl] of [['bash', 'win32'], ['bash', 'posix'], ['pwsh', 'win32'], ['pwsh', 'posix']]) {
        const r = assessCommand(c, sh, withDs(dsOnly('wide'), { platform: pl }))
        // 整行分支返回对象**没有** `tiers` 键（`segments` 恒为 `[]`）—— 记录形态契约
        if (r.segments && r.segments.length !== 0) bad.push(['整行分支 segments 非空（契约变化）', c, sh, pl])
        if (r.action !== 'deny') bad.push(['整行分支未 deny（wide=deny）', c, sh, pl, r.action])
      }
    }
    ok('★ AE 整行读不懂分支：形态契约与动作不回退（发现 6）', bad.length === 0, JSON.stringify(bad.slice(0, 8)))
  }
}

// ─────────────────────────────────────────────────────────────────────────────
group('AF. opaque 构造作重定向目标：不得被粘性标记误判为「无目标」（发现 4 粘性的回归）')
{
  // ── 问题 ────────────────────────────────────────────────────────────────────
  // 发现 4 的修法把 `ampNoTarget` 改成**粘性**（`ampTargetMissing = ampTargetMissing || ampNoTarget`），
  // 而 `ampNoTarget` 的判据 `pending !== undefined && !started` 对「重定向目标是 **opaque 构造**」
  // 是**误判**：`$( )` / `( )` / `{ }` / 反引号四条分支都不设 `started`（只 markOpaque + pushText
  // + 跳过配对），而其中一部分在 bash 里是**合法**的重定向目标。
  //
  // HEAD 上这个误判被 `&` 分支的 `flushSegment()` 清掉，故不显形；粘性把它保留到行尾后，
  // **合法命令被推进 `ok:false`** —— 而 `ok:false` 路径（assessCommand 的 `if (!d.ok)` 支）
  // 只认 deny 例外，档位集合是 `groupTiersOf + priv + RADIUS_TIERS_WHEN_UNREADABLE`、
  // **不含 `outside`**，于是用户显式配的 `outside=deny` 与**全部 ask 例外**在这条路径上整个失明。
  // 实测（outside=deny、其余七档 allow）：
  //     rm -rf /tmp/x                          → deny
  //     rm -rf /tmp/x > $(mktemp) & echo done  → 仅加粘性 **allow** ❌（HEAD 是 deny）
  //
  // 修法：`ampNoTarget` 补上「这个待读重定向的目标是不是一个**可作词**的 opaque 构造」，
  // 由 `redirectOpaqueTarget`（三态 'none' / 'word' / 'not-word'）精确判 —— 逐重定向记录，
  // 故 `echo a $(b) > & c` 这类「opaque 在 `>` **之前**」的形态不会被误放行。
  {
    const dsOnly = (tier) => { const t = {}; for (const k of TIERS) t[k] = k === tier ? 'deny' : 'allow'; return t }
    const withDs = (ds, opts) => Object.assign(hooks(Object.assign({ category: 'allow' }, opts || {})), { destructive: () => ds })
    const bad = []

    // ① bash 合法（`bash -n` 实测 OK）：必须 ok:true —— 误判回归的主判据
    const legal = [
      'echo a > $(mktemp) & echo done', 'echo a > {mktemp} & echo done', 'echo a > { b } & echo done',
      'echo a > {a,b} & echo done', 'echo a > } & echo done', 'echo a > ' + BT + 'mktemp' + BT + ' & echo done',
      'echo a > "$(mktemp)" & echo done', 'echo a 2> $(mktemp) & echo done',
      'echo a >> $(mktemp) & echo done', 'echo a < $(mktemp) & echo done',
      'echo a > $(b) > $(c) & d', 'echo a $(b) > $(c) & d',
      'echo z ; echo a > $(mktemp) & echo done', 'echo z && echo a > $(mktemp) & echo done',
      'rm -rf /etc > $(mktemp) & echo done', 'rm -rf /etc > {mktemp} & echo done',
      'rm -rf /etc 2> $(mktemp) & echo done', 'rm -rf /etc >> $(mktemp) & echo done',
      'rm -rf /etc < $(mktemp) & echo done',
    ]
    for (const c of legal) {
      const r = decomposeCommand(c, 'bash')
      if (r.ok !== true) bad.push(['误判回归：bash 合法的 opaque 重定向目标被拦下', c, JSON.stringify(r)])
    }

    // ② bash 语法错误（`bash -n` 实测 SYNTAX-ERR）：必须仍 ok:false —— 不得因本修法被放行
    const illegal = [
      'echo a > (mktemp) & echo done', 'echo a > { b; } & echo done', 'echo a > {b;} & echo done',
      'echo a > {;} & echo done', 'echo a > { a;b; } & echo done', 'echo a > ) & echo done',
      'echo a > (c) $(b) & d', 'echo a > $(b) (c) & d',
      // ⚠️ 这一族是**本修法最易开出的新洞**：opaque 构造在 `>` **之前**（是命令参数），
      // 与「重定向目标」无关 —— 逐重定向的判据必须能区分它们，按 `segOpaque` 口径会误放行。
      'echo a $(b) > & c', 'echo a > $(b) > & c', 'echo a > $(b) c > & d',
      'echo a > $(b) && c > & d', 'echo a > $(b) ; c > & d', 'echo a > $(b) & c > & d',
      // 发现 4 原目标族（粘性的收益）不得回退
      'echo a > & (b)', '> & $(b)', '> & { b; }', '> & )', 'echo a > & b', 'echo a > &',
      'echo a > & (b) &', 'echo a > & $(b) &',
      // 真悬空 / 真无目标
      'echo a >', 'echo a |', 'echo a &&', 'echo a ||', 'echo a & &', 'echo a | &',
    ]
    for (const c of illegal) {
      for (const sh of ['bash', 'pwsh']) {
        const r = decomposeCommand(c, sh)
        if (r.ok !== false) bad.push(['语法错误形态被放行', c, sh, JSON.stringify(r.ok ? r.segments.map((s) => s.text) : r)])
      }
    }

    ok('★ AF opaque 重定向目标：合法形态不得误判、语法错误形态不得放行', bad.length === 0, JSON.stringify(bad.slice(0, 8)))

    // ③ 端到端：`outside=deny` 不得因「末尾挂 opaque 目标」而失明（本发现的 fail-open 本体）
    {
      const bad2 = []
      const ds = dsOnly('outside')
      for (const c of ['rm -rf /tmp/x > $(mktemp) & echo done', 'rm -rf /tmp/x 2> $(mktemp) & echo done',
        'rm -rf /tmp/x >> $(mktemp) & echo done', 'rm -rf /tmp/x < $(mktemp) & echo done',
        'rm -rf /tmp/x > {mktemp} & echo done',
        'echo z ; rm -rf /tmp/x > $(mktemp) & echo done',
        'echo z && rm -rf /tmp/x > $(mktemp) & echo done']) {
        for (const [sh, pl] of [['bash', 'win32'], ['bash', 'posix'], ['pwsh', 'win32'], ['pwsh', 'posix']]) {
          const r = assessCommand(c, sh, withDs(ds, { platform: pl }))
          if (r.action !== 'deny') bad2.push(['outside=deny 被绕过', c, sh, pl, r.action, r.code])
        }
      }
      ok('★ AF outside=deny 不得被 opaque 重定向目标绕过（fail-open 回归）', bad2.length === 0, JSON.stringify(bad2.slice(0, 8)))
    }

    // ④ 端到端：ask 例外不得被绕过（ok:false 路径只认 deny 例外，故 ask 会整个失明）
    {
      const bad3 = []
      const h = withDs(null, { excAction: 'ask', exceptions: ['curl *'] })
      for (const c of ['curl -s http://example.com > $(mktemp) & echo done',
        'curl -s http://example.com > {mktemp} & echo done',
        'curl -s http://example.com 2> $(mktemp) & echo done']) {
        const r = assessCommand(c, 'bash', h)
        if (r.action !== 'ask') bad3.push(['ask 例外被绕过', c, r.action, r.code])
      }
      ok('★ AF ask 例外不得被 opaque 重定向目标绕过（fail-open 回归）', bad3.length === 0, JSON.stringify(bad3.slice(0, 8)))
    }

    // ⑤ 关键一格：粘性的**唯一增量收益**必须仍被堵住（本修法不得把收益一起削掉）
    for (const sh of ['bash', 'pwsh']) {
      ok('★ AF 粘性的增量收益仍保住：`echo a > & (b) &` 仍须 ok:false（' + sh + '）',
        decomposeCommand('echo a > & (b) &', sh).ok === false)
    }
  }
}

group('AG. 进程替换作重定向目标：`>( )` / `<( )` 是可作词的目标（AF 的同族漏网）')
{
  // ── 问题 ────────────────────────────────────────────────────────────────────
  // AF 把「opaque 构造作重定向目标」按三态 `redirectOpaqueTarget` 精确判了，但 `(` 分支
  // 的判据是 `char === '{' && !braceIsCommandGroup(...)` —— 只有 `{` 能记成可作词，
  // **`(` 一律 `false`（not-word）**。而 bash 的**进程替换** `>( )` / `<( )` 与**子 shell**
  // `( )` 在词法器里走的是同一条 `(` 分支（`>` 先被 `REDIRECT_OPERATOR` 吃掉，`(` 单独进分支），
  // 于是 `>(tee log)` 被记成「不可作词」→ `ampNoTarget` 置位 → 整行 `ok:false`。
  // 这正是 AF 要消灭的那条 fail-open 路径（`ok:false` 只认 deny 例外、档位集合不含 `outside`）。
  //
  // bash 真值（`bash -n` 实测）—— `>( )` / `<( )` 合法，`( )` 非法：
  //     OK   `echo a > >(cat)` / `echo a > <(cat x)` / `echo a >(cat)` / `echo a 2>(cat)`
  //     ERR  `echo a > (cat)` / `echo a >>(cat)` / `echo a >|(cat)` / `echo a >&(cat)`
  //     ERR  `echo a &>(cat)` / `echo a <>(cat)` / `echo a <<(cat)`
  //
  // ⚠️ 判据**不能**只看「`(` 的前一个字符是 `>` 或 `<`」（初版，实测过宽）：
  // `>>(cat)` / `>|(cat)` / `>&(cat)` / `&>(cat)` / `<>(cat)` 的 `(` 同样紧贴 `>`，
  // 但那个 `>` 是**别的操作符的一部分**，bash 全是语法错误。故本修法再加一条：
  // 那个 `>` / `<` 的再前一个字符不得是 `<` `>` `|` `&`（即它必须是独立的单字符操作符）。
  {
    const dsOnly = (tier) => { const t = {}; for (const k of TIERS) t[k] = k === tier ? 'deny' : 'allow'; return t }
    const withDs = (ds, opts) => Object.assign(hooks(Object.assign({ category: 'allow' }, opts || {})), { destructive: () => ds })
    const bad = []

    // ① bash 合法（`bash -n` 实测 OK）：必须 ok:true —— 误判回归的主判据
    //    ⚠️ 只列**带 `&`** 的形态：不带 `&` 的 `echo a > >(cat)` 在 HEAD 上同样是 ok:false
    //    （那条路径的缺口与 `echo a > $(mktemp)` **同源**、由 `pending && !started` 那条
    //    行尾判据拦下，不是本次 `&` 粘性引入的），故不在本组范围内、也不得在此断言 ok:true
    //    —— 否则会逼着把修法扩张到另一个未报告的问题上。
    const legal = [
      'echo a > >(cat) & echo b', 'echo a < <(cat x) & echo b', 'echo a > >(tee log) & echo done',
      'echo a >(cat) & echo b', 'echo a 2>(cat) & echo b', 'echo x>(cat) & echo b',
      'echo a >> >(cat) & echo b', 'echo a 2> >(cat) & echo b',
      'echo z ; echo a > >(cat) & echo b', 'echo z && echo a > >(cat) & echo b',
      'echo a > >(cat) ; echo b', 'echo a > >(cat) && echo b', 'echo a > >(cat) | cat',
      'echo a > >(cat) $(b) & d', 'echo a > >(cat) > >(tee y) & d',
      'echo a > >(cat) 2> >(tee e) & echo b', 'echo a > >(cat) 2>&1 & b',
      '> >(cat) & echo a', 'echo a <(cat) & echo b',
      'echo a > >(cat) &', 'echo a > >(cat) & (b)', 'echo a > >(cat) & $(b)',
      // ⚠️ 这几格钉住判据的**精确性**：`(` 前是一串操作符字符时，只有最后一个词元恰为
      // 裸 `>` / `<` 才算进程替换。这些（`bash -n` 实测 OK）曾被「只看前 1~2 个字符」
      // 的保守判据漏认，从而在 HEAD 上由 deny 落回 allow。
      'echo a >|>(cat) & echo b', 'echo a >&>(cat) & echo b', 'echo a &&>(cat) & echo b',
      'echo a >><(cat) & echo b', 'echo a >>>(cat) & echo b', 'echo a <>>(cat) & echo b',
      'echo a ><(cat) & echo b', 'echo a >| >(cat) & echo b', 'echo a >& >(cat) & echo b',
      'rm -rf /etc > >(tee log) & echo done', 'rm -rf /etc > <(cat x) & echo done',
      'rm -rf /etc 2> >(tee log) & echo done', 'rm -rf /etc >> >(tee log) & echo done',
      'rm -rf /etc < <(cat x) & echo done',
    ]
    for (const c of legal) {
      const r = decomposeCommand(c, 'bash')
      if (r.ok !== true) bad.push(['误判回归：bash 合法的进程替换目标被拦下', c, JSON.stringify(r)])
    }

    // ② bash 语法错误（`bash -n` 实测 SYNTAXERR）：必须仍 ok:false —— 不得因本修法被放行
    //    ⚠️ 前三格是**本修法最易开出的新洞**（验证者建议的「`(` 紧贴 `>` / `<` 即算词」
    //       判据会把它们放行）：`>>(cat)` / `>|(cat)` / `>&(cat)` / `&>(cat)` / `<>(cat)` /
    //       `2>>(cat)` / `<&(cat)` / `>>>(cat)` 的 `(` 也紧贴 `>`，但那个 `>` 属于更长的
    //       操作符，bash 判语法错误。
    const illegal = [
      // 进程替换的「假兄弟」：紧贴但 `>` 属于别的操作符
      'echo a >>(cat)', 'echo a >>(cat) & echo b', 'echo a >|(cat) & echo b',
      'echo a >&(cat) & echo b', 'echo a &>(cat) & echo b', 'echo a &>>(cat) & echo b',
      'echo a <>(cat)', 'echo a <>(cat) & echo b', 'echo a 2>>(cat) & echo b',
      'echo a <&(cat) & echo b', 'echo a >><>(cat) & echo b', 'echo a <<(cat) & echo b',
      'echo a <<<(cat) & echo b', 'echo a >|(cat) & echo b',
      // ⚠️ 刻意**不**列入 `echo a &|<(cat) & echo b` / `echo a <>><(cat) & echo b` /
      // `echo a <><(cat) & echo b` 三格：前两者在 HEAD 上就是 ok:true（**既有缺口**，
      // 与本修法无关，修它们要动「重定向无目标」的另一条判据，超出本次范围）；
      // 第三格 `bash -n` 实测 **OK**（`<>` 被切成 `<>`+`<(cat)`？实测合法），不得当非法形态。
      // 子 shell / 分组 / 孤立右括号：不可作词
      'echo a > (cat)', 'echo a > (cat) & echo b', 'echo a > (mktemp) & echo done',
      'echo a > { b; } & echo done', 'echo a > ) & echo done',
      'echo a > >(cat) (b) & d',
      // 本次发现的两个关键对照格（必须仍是 ok:false）
      'echo a > & >(cat)', 'echo a > >(cat) > & b',
      // AF 族与发现 4 族的既有收益不得回退
      'echo a > & b', 'echo a >', 'echo a > &',
      'echo a > & (b) &', 'echo a > & (b)', '> & $(b)', 'echo $(a) > & b',
      'echo a $(b) > & c', 'echo a > $(b) > & c',
    ]
    for (const c of illegal) {
      for (const sh of ['bash', 'pwsh']) {
        const r = decomposeCommand(c, sh)
        if (r.ok !== false) bad.push(['语法错误形态被放行', c, sh, JSON.stringify(r.ok ? r.segments.map((s) => s.text) : r)])
      }
    }

    ok('★ AG 进程替换目标：合法形态不得误判、语法错误形态不得放行', bad.length === 0, JSON.stringify(bad.slice(0, 8)))

    // ③ 端到端：`outside=deny` 不得因「重定向目标是进程替换」而失明（本发现的 fail-open 本体）
    //    ⚠️ 目标用 `/tmp/x` 而非 `/etc`：`/etc` 在 posix 平台上的档位判定与 win32 不同
    //    （HEAD 上 `rm -rf /etc` 在 posix 就是 allow），那属于另一条既有路径，与本修法无关。
    {
      const bad2 = []
      const ds = dsOnly('outside')
      for (const c of ['rm -rf /tmp/x > >(tee log) & echo done', 'rm -rf /tmp/x > <(cat x) & echo done',
        'rm -rf /tmp/x 2> >(tee log) & echo done', 'rm -rf /tmp/x >> >(tee log) & echo done',
        'rm -rf /tmp/x < <(cat x) & echo done', 'rm -rf /tmp/x > $(mktemp) & echo done',
        'echo z ; rm -rf /tmp/x > >(tee log) & echo done',
        'echo z && rm -rf /tmp/x > >(tee log) & echo done']) {
        for (const [sh, pl] of [['bash', 'win32'], ['bash', 'posix'], ['pwsh', 'win32'], ['pwsh', 'posix']]) {
          const r = assessCommand(c, sh, withDs(ds, { platform: pl }))
          if (r.action !== 'deny') bad2.push(['outside=deny 被绕过', c, sh, pl, r.action, r.code])
        }
      }
      ok('★ AG outside=deny 不得被进程替换目标绕过（fail-open 回归）', bad2.length === 0, JSON.stringify(bad2.slice(0, 8)))
    }

    // ④ 端到端：ask 例外不得被绕过（ok:false 路径只认 deny 例外，故 ask 会整个失明）
    {
      const bad3 = []
      const h = withDs(null, { excAction: 'ask', exceptions: ['curl *'] })
      for (const c of ['curl -s http://example.com > >(tee log) & echo done',
        'curl -s http://example.com < <(cat x) & echo done',
        'curl -s http://example.com 2> >(tee log) & echo done',
        'curl -s http://example.com > $(mktemp) & echo done']) {
        const r = assessCommand(c, 'bash', h)
        if (r.action !== 'ask') bad3.push(['ask 例外被绕过', c, r.action, r.code])
      }
      ok('★ AG ask 例外不得被进程替换目标绕过（fail-open 回归）', bad3.length === 0, JSON.stringify(bad3.slice(0, 8)))
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
group('AH. 本批修复的钉桩：发现 1/7/8（VX2）、发现 9（`|&`）、发现 3（续行符）、发现 4（花括号词法）')
{
  // 逐档配置：只把某一档设为 deny，其余七档 allow —— 与 final-verify 探针同形。
  const ONLY = (tier) => {
    const t = {}
    for (const x of ['inside', 'outside', 'wide', 'unknown', 'priv', 'proc', 'power', 'reg']) t[x] = x === tier ? 'deny' : 'allow'
    return t
  }
  const withDs2 = (ds, opts) => Object.assign(hooks(Object.assign({ category: 'allow' }, opts || {})), { destructive: () => ds })
  const at = (cmd, ds, sh, opts) => assessCommand(cmd, sh || 'bash', withDs2(ds, opts))
  // §6.1 默认八档（`inside` 跟随大分类 = allow，其余 ask）—— 与生产默认同形
  const DEFAULT8 = { inside: 'allow', outside: 'ask', wide: 'ask', unknown: 'ask', priv: 'ask', proc: 'ask', power: 'ask', reg: 'ask' }

  // ── ① 发现 1：段首**本身**是破坏性命令、而构造里**另藏**一个真破坏性命令 ──────
  // 判据必须问「构造**里**有没有第二个破坏性命令」，而不是「段首是不是破坏性命令」。
  // 靶格在 bash 里 `-n` = OK、可执行（`$(rm -rf /)` 真会跑），故这是真 fail-open。
  {
    const bad = []
    for (const c of [
      'echo a | rm -rf /tmp/x $(rm -rf /)',
      'echo a && rm -rf /tmp/x $(rm -rf /)',
      'echo a || rm -rf /tmp/x $(rm -rf /)',
      'echo a & rm -rf /tmp/x $(rm -rf /)',
    ]) {
      const r = at(c, ONLY('wide'))
      if (r.action === 'allow') bad.push([c, r.action, r.code])
    }
    ok('★ AH1 段首可读 + 构造内另藏破坏性命令：不得静默放行（发现 1）', bad.length === 0, JSON.stringify(bad))
  }

  // ── ② 发现 7 / 8：段首是提权前缀、紧跟**可读**的破坏性命令 → 命令**读得出** ────
  // 这是**有意的放宽**（旧判据只看段首词元，把 `sudo rm …` 一律判成「命令读不出」→ 误拦）。
  // 判据换成 `headCommandNameOf`（穿过提权前缀取真命令头）后，构造只是**参数**。
  {
    const bad = []
    for (const c of [
      'sudo rm -rf ./build $(date)',
      'sudo rm -rf ./tmp/{a,b,c}',
      'doas rm -rf ./build $(date)',
      'pkexec rm -rf ./build `date`',
      'sudo rm -rf ./build {a,b}',
    ]) {
      // `wide=deny` / `inside=deny` 下必须是 allow（构造只是参数，不凭空收紧）
      for (const tier of ['wide', 'inside']) {
        const r = at(c, ONLY(tier))
        if (r.action !== 'allow') bad.push([tier, c, r.action, r.code])
      }
    }
    ok('★ AH2 提权前缀 + 可读破坏性命令 + opaque 参数：不得凭空收紧（发现 7/8 的有意放宽）',
      bad.length === 0, JSON.stringify(bad))
  }

  // ── ③ 保护格：提权前缀后面**没有**可读命令（真命令在构造里）→ 必须仍判读不出 ──
  // `:4910` 的提权兜底承重，删掉它这一族会变 allow（发现 8 报告者的建议实测不可用）。
  // 档位逐格按实测填：`C:/Windows` 是**系统目录** → 命中 `wide`（不是 `outside`）；
  // 只有诱饵格 `cat /etc/hosts …` 才额外带 `outside`（`/etc/hosts` 是工作区外路径）。
  {
    const bad = []
    for (const [c, tiers] of [
      ['echo a | sudo $(rm -rf C:/Windows)', ['wide', 'inside']],
      ['echo a | (rm -rf C:/Windows)', ['wide', 'inside']],
      ['ForEach-Object { Remove-Item C:/Windows -Recurse -Force }', ['wide', 'inside']],
      ['echo a | Write-Output `rm -rf C:/Windows`', ['wide', 'inside']],
      ['cat /etc/hosts $(rm -rf C:/Windows)', ['wide', 'inside', 'outside']],
    ]) {
      for (const tier of tiers) {
        const r = at(c, ONLY(tier))
        if (r.action !== 'deny') bad.push([tier, c, r.action, r.code])
      }
    }
    ok('★ AH3 保护格：真命令藏在 opaque 构造里 → 命中档的 deny 不得失明', bad.length === 0, JSON.stringify(bad))
  }

  // ── ④ 承重格：命令可读、构造只是参数 → 必须**恰好** `['unknown']`（60g ④b/⑤b 同口径）
  {
    const bad = []
    for (const c of ['rm -rf ./tmp/{a,b,c}', 'rm -rf ./build $(date)', 'chmod 777 ./{a,b}.sh', 'diskpart /s a.txt']) {
      const r = at(c, { inside: 'allow', outside: 'ask', wide: 'ask', unknown: 'ask', priv: 'ask', proc: 'ask', power: 'ask', reg: 'ask' })
      const t = (r.segments[0] && r.segments[0].tiers) || []
      if (t.join(',') !== 'unknown') bad.push([c, t.join(',')])
    }
    ok('★ AH4 承重格：命令可读、构造只是参数 → 恰好 `[\'unknown\']`', bad.length === 0, JSON.stringify(bad))
  }

  // ── ⑤ 发现 9：`|&` 必须被 `|` 分支整体消费 ──────────────────────────────────
  // 靶格在 bash 里 `-n` = OK、真实执行会写出 `log` 文件。此前 `|&` 的 `&` 落进后台分支
  // → 整行 `ok:false` → 只认 deny 例外 → 用户写的 **ask 例外整个失明**（fail-open）。
  {
    const bad = []
    const h = withDs2(null, { excAction: 'ask', exceptions: ['curl *'] })
    for (const c of [
      'echo a |&>& log & echo b',
      'curl -s http://example.com |&>& log & echo done',
    ]) {
      const d = decomposeCommand(c, 'bash')
      if (!d.ok) bad.push(['ok:false', c, d.reason])
    }
    // 整行读得懂之后，**用户写的 ask 例外**才生效（此前 `ok:false` 路径只认 deny 例外）
    const rc = assessCommand('curl -s http://example.com |&>& log & echo done', 'bash', h)
    if (rc.action !== 'ask') bad.push(['ask 失明', 'curl …', rc.action, rc.code])
    // 对照：没有例外命中的那条仍按大分类 allow（不得凭空收紧）
    const re = assessCommand('echo a |&>& log & echo b', 'bash', h)
    if (re.action !== 'allow') bad.push(['凭空收紧', 'echo a …', re.action, re.code])
    ok('★ AH5 `|&` 不得把整行推进 ok:false（发现 9：ask 例外失明）', bad.length === 0, JSON.stringify(bad))
  }
  // `|&` 是**一个**管道操作符，不得凭空多切一段（`&` 不得再被当后台分隔符）
  {
    const d = decomposeCommand('echo a |& log & echo b', 'bash')
    ok('★ AH5b `|&` 后不得凭空多出段边界', d.ok && d.segments.length === 3,
      d.ok ? ('segments=' + d.segments.length + ' ops=' + d.segments.map((s) => s.op).join(',')) : d.reason)
  }

  // ── ⑥ 发现 3：续行符劈开多字符操作符 → 必须与「不写续行符」的对照同结论 ──────
  // ⚠️ 判据是「**与对照格同结论**」，不是「任何配置下都 deny」：靶格的目标 `/tmp/pgx`
  // 在工作区**外**，故 `inside=deny` / `wide=deny` / `unknown=deny` 下对照格本就是 allow
  // （用户没把 `outside` 设为 deny）。旧代码在这里 deny，是因为整行被推进 `ok:false`、
  // 走了那条保守回退 —— 那是**解析失败的假象**，不是保护。修复消除的是这个分歧。
  // 真正体现保护的是 `outside=deny`：对照格 deny，靶格此前 allow（fail-open），修复后 deny。
  {
    const bad = []
    for (const [cmd, ctrl] of [
      ['rm -rf /tmp/pgx >\\\n&2', 'rm -rf /tmp/pgx >&2'],
      ['rm -rf /tmp/pgx >\\\n& /tmp/log', 'rm -rf /tmp/pgx >& /tmp/log'],
      ['rm -rf /tmp/pgx >\\\n& out.txt', 'rm -rf /tmp/pgx >& out.txt'],
      ['rm -rf /tmp/pgx <\\\n&2', 'rm -rf /tmp/pgx <&2'],
    ]) {
      for (const tier of ['inside', 'outside', 'wide', 'unknown', 'default']) {
        const ds = tier === 'default' ? DEFAULT8 : ONLY(tier)
        const a = at(cmd, ds), b = at(ctrl, ds)
        if (a.action !== b.action) bad.push(['与对照分歧', tier, cmd, a.action, b.action])
      }
      // `outside=deny` 下必须是 deny（保护本身）
      const r = at(cmd, ONLY('outside'))
      if (r.action !== 'deny') bad.push(['outside=deny 未 deny', cmd, r.action, r.code])
    }
    ok('★ AH6 续行符劈开 `>&`：与对照同结论，且 `outside=deny` 下 deny（发现 3）',
      bad.length === 0, JSON.stringify(bad))
  }
  // ⚠️ 反向：**注释内**的 `\`+换行**不是**续行符（bash 把下一行当新命令执行）——
  // 无条件剥离会把 `rm` 藏进注释里，是修法自己会引入的 fail-open。必须钉住。
  {
    const bad = []
    for (const c of ['echo hi # c\\\nrm -rf /tmp/victim', '# c\\\nrm -rf /tmp/victim']) {
      const r = at(c, ONLY('outside'))
      if (r.action !== 'deny') bad.push([c, r.action, r.code])
    }
    // 单引号内的 `\`+换行是字面量，同样不得被剥离（不得因此改变段文本）
    const dq = decomposeCommand("echo 'a\\\nb'", 'bash')
    if (!dq.ok || dq.segments[0].text.indexOf('\\\n') < 0) bad.push(['单引号内被误剥离', dq.ok ? dq.segments[0].text : dq.reason])
    ok('★ AH6b 注释内 / 单引号内的 `\\`+换行**不得**被当续行符剥离', bad.length === 0, JSON.stringify(bad))
  }
  // ⚠️ 反向之二：夹在**两个 `<`** 之间的 `\`+换行**不得**被剥离（本批修复新开的放宽面）。
  //
  // bash 的词法真值确实是 `<\<NL><` ≡ `<<`（heredoc 操作符），但本文件的词法器**认出 heredoc
  // 就整行 `ok:false`**，而 `ok:false` 路径的档位集合**不含 `outside`**、且**只认 deny 例外**
  // ⇒ 剥离这一步会把一条 HEAD 上 `ok:true` 且判 deny 的命令推进 `ok:false`，`outside=deny`
  // 整个失明。实测（`outside=deny`、其余七档 allow，真 bash 下 `bash -n` = OK 且**真的删掉**
  // 目标目录）：
  //     rm -rf /tmp/x <\<NL>< EOF + NL + x + NL + EOF
  //       不剥离（= HEAD）：**deny** ✅   剥离：**allow** ❌（ok:false / unparsable）
  // 故判据是「**与不剥离的同形格同结论**」+「`outside=deny` 下 deny」—— 与 AH6 同一口径。
  // 只排除**两侧都是 `<`** 的那一种：其余形态（`>\<NL>&` / `>\<NL>>` / `<\<NL>&` …）的剥离
  // 是 AH6 要保的东西，一格都不能退（下面同时钉住）。
  {
    const bad = []
    const HD = [
      'rm -rf /tmp/x <\\\n<EOF',
      'rm -rf /tmp/x <\\\n< EOF',
      'rm -rf /tmp/x <\\\n<-EOF',
      'rm -rf /tmp/x 2<\\\n<EOF',
      "rm -rf /tmp/x <\\\n<'EOF'",
      'rm -rf /tmp/x <\\\n<\\\n< EOF',
      'rm -rf /tmp/x <\\\n< /dev/null',
      'echo a && rm -rf /tmp/x <\\\n<EOF',
      'echo a; rm -rf /tmp/x <\\\n<EOF',
      'echo a\nrm -rf /tmp/x <\\\n<EOF',
    ]
    for (const c of HD) {
      for (const tier of ['inside', 'outside', 'wide', 'unknown', 'default']) {
        const ds = tier === 'default' ? DEFAULT8 : ONLY(tier)
        // 对照 = 把 `\`+换行 换成**裸换行**（即「续行符不生效」时词法器看到的形态）
        const ctrl = c.replace(/<\\\n</, '<\n<')
        const a = at(c, ds), b = at(ctrl, ds)
        if (a.action !== b.action) bad.push(['与对照分歧', tier, c, a.action, b.action])
      }
      const r = at(c, ONLY('outside'))
      if (r.action !== 'deny') bad.push(['outside=deny 未 deny', c, r.action, r.code])
    }
    // 真·heredoc 仍必须整行读不懂（本修复不得把它一起放宽）
    for (const c of ['rm -rf /tmp/x <<EOF\nx\nEOF', 'rm -rf /tmp/x <<EOF']) {
      if (decomposeCommand(c, 'bash').ok !== false) bad.push(['真 heredoc 被放宽成 ok:true', c])
    }
    // 反向：AH6 那一族（`>\<NL>&` 等）的续行符**必须照旧剥离**
    for (const c of ['rm -rf /tmp/pgx >\\\n&2', 'rm -rf /tmp/pgx <\\\n&2', 'rm -rf /tmp/pgx >\\\n> out.txt']) {
      const d = decomposeCommand(c, 'bash')
      if (!d.ok || d.segments[0].text.indexOf('\\\n') >= 0) {
        bad.push(['AH6 族的续行符未剥离（回退）', c, d.ok ? d.segments[0].text : d.reason])
      }
    }
    ok('★ AH6c 夹在两个 `<` 之间的续行符不得被剥离（不得粘成 heredoc → 不得丢 `outside` 档）',
      bad.length === 0, JSON.stringify(bad))
  }

  // ── ⑦ 发现 4：花括号组的判据必须在**词法层面**做 ────────────────────────────
  // 引号内的换行、转义分号 `\;` 都是**字面字符**，`{…}` 只是一个词 → 可作重定向目标。
  {
    const bad = []
    for (const [cmd, ctrl] of [
      ['rm -rf /tmp/pgx > { a\nb } & echo done', 'rm -rf /tmp/pgx > { a b } & echo done'],
      ['rm -rf /tmp/pgx > { "a\nb" } & echo done', 'rm -rf /tmp/pgx > { "ab" } & echo done'],
      ['rm -rf /tmp/pgx > { a\\; } & echo done', 'rm -rf /tmp/pgx > { a } & echo done'],
      ["rm -rf /tmp/pgx > { 'a\nb' } & echo done", "rm -rf /tmp/pgx > { 'ab' } & echo done"],
    ]) {
      for (const tier of ['inside', 'outside', 'wide', 'unknown', 'default']) {
        const ds = tier === 'default' ? DEFAULT8 : ONLY(tier)
        const a = at(cmd, ds), b = at(ctrl, ds)
        if (a.action !== b.action) bad.push(['与对照分歧', tier, cmd, a.action, b.action])
      }
      // `outside=deny` 下必须是 deny（靶格目标 `/tmp/pgx` 在工作区外）
      const r = at(cmd, ONLY('outside'))
      if (r.action !== 'deny') bad.push(['outside=deny 未 deny', cmd, r.action, r.code])
    }
    ok('★ AH7 花括号内「引号内换行 / 转义分号」是字面词：与对照同结论，且 `outside=deny` 下 deny（发现 4）',
      bad.length === 0, JSON.stringify(bad))
  }
  // ⚠️ 反向：真·命令组（末尾顶层 `;`）**必须仍然**判分组 → 整行 ok:false（不得放宽）
  {
    const bad = []
    for (const c of [
      'rm -rf /tmp/pgx > { a; } & echo done',
      'rm -rf /tmp/pgx > { a;b; } & echo done',
      'rm -rf /tmp/pgx > { a\nb; } & echo done',
      'rm -rf /tmp/pgx > { "a\nb"; } & echo done',
    ]) {
      const d = decomposeCommand(c, 'bash')
      if (d.ok) bad.push([c, 'ok:true（应 ok:false）'])
    }
    ok('★ AH7b 真·命令组（末尾顶层 `;`）仍须判 ok:false（不得放宽）', bad.length === 0, JSON.stringify(bad))
  }
  // ⚠️ 反向：字面词形态**不得**被误判成分组（否则合法命令被推进 ok:false）
  {
    const bad = []
    for (const c of [
      'rm -rf /tmp/pgx > { a b } & echo done',
      'rm -rf /tmp/pgx > {mktemp} & echo done',
      'rm -rf /tmp/pgx > } & echo done',
      'rm -rf /tmp/pgx > { "a;b" } & echo done',
      'rm -rf /tmp/pgx > {a,b} & echo done',
    ]) {
      const d = decomposeCommand(c, 'bash')
      if (!d.ok) bad.push([c, d.reason])
    }
    ok('★ AH7c 字面词 / 花括号展开仍须 ok:true（不得误收紧）', bad.length === 0, JSON.stringify(bad))
  }

  // ── ⑧ 接线点：`opaqueTexts` 必须由词法器记录并传到判定侧 ─────────────────────
  // 少了这条接线，AH1 的判据**恒不生效**（靶格照旧 allow）—— 这是本批最容易漏的一环。
  {
    const d = decomposeCommand('echo a | rm -rf /tmp/x $(rm -rf /)', 'bash')
    const seg = d.ok ? d.segments[1] : null
    ok('★ AH8 词法器须记录 opaque 构造原文（`opaqueTexts`）',
      !!seg && Array.isArray(seg.opaqueTexts) && seg.opaqueTexts.length === 1
      && seg.opaqueTexts[0] === '$(rm -rf /)',
      seg ? JSON.stringify(seg.opaqueTexts) : 'no seg')
    // 多个构造必须**全部**记下（漏记任何一个都可能漏掉真载荷）
    const d2 = decomposeCommand('rm -rf ./x $(a) $(rm -rf /)', 'bash')
    ok('★ AH8b 段内多个 opaque 构造须逐个记录',
      d2.ok && d2.segments[0].opaqueTexts.length === 2, d2.ok ? JSON.stringify(d2.segments[0].opaqueTexts) : d2.reason)
  }

  // ── ⑨ 提权兜底（`destructiveHeadReadable` 里 `PRIV_PREFIXES[head] === 1` 那一行）──
  // 这一行**承重、不可删**（发现 8 的报告者建议删掉它，实测不可用）：构造里那个命令
  // **不是**破坏性命令时（`sudo $(date)` / `su $(id)`），新的「构造内载荷」判据够不到它，
  // 只有这一行能判「命令读不出」。删掉它 ⇒ 用户显式配的 `wide=deny` / `inside=deny`
  // 被静默丢弃（实测 `wide=deny` 下由 deny 变 **allow**）。
  // ⚠️ 它与「构造里藏破坏性命令」那一支**互补**：后者覆盖 `sudo $(rm -rf …)`，
  // 前者覆盖 `sudo $(无害命令)` —— 两条都要有，缺一即 fail-open。
  {
    const bad = []
    for (const c of ['echo a | sudo $(date)', 'echo a | su $(id)', 'echo a | sudo $(cat p)',
      'echo a | sudo `date`', 'echo a | pkexec $(date)', 'echo a | doas $(date)']) {
      for (const tier of ['wide', 'inside']) {
        const r = at(c, ONLY(tier))
        if (r.action !== 'deny') bad.push([tier, c, r.action, r.code])
      }
    }
    ok('★ AH9 提权前缀 + 构造内**非**破坏性命令：仍须判「读不出」（提权兜底承重）',
      bad.length === 0, JSON.stringify(bad))
  }

  // ── ⑩ 发现 1（本批）：整行 `ok:false` 路径的档位集合**不含 `outside`** ──────────────
  // 该路径的档位集合由 `groupTiersOf(names) + priv + RADIUS_TIERS_WHEN_UNREADABLE` 拼成，
  // 而 `RADIUS_TIERS_WHEN_UNREADABLE` 是 `wide ∪ unknown ∪ inside` —— 于是用户显式配的
  // `outside=deny` 在这条路径上**整个失明**。真 bash 实测（`bash -n` = OK 且**真的执行**、
  // 真的删掉目标）：`rm -rf <目标> <<EOF … EOF` / `<<-EOF` / `<<"EOF"` / `<<'EOF'` / `<<<x`
  // 五种写法全部删除成功；而 `cat <<EOF` + `rm` 正文**不执行** `rm`（正文是数据）。
  //     rm -rf /etc              → deny（段级 outside 档）
  //     rm -rf /etc <<EOF…EOF    → 修复前 **allow** ← 同一命令，只因多了个 heredoc
  //
  // 判据（四条，缺一即「只修一支」或「过度收紧」）：
  //   ① `outside=deny` 下，带读不懂构造的形态必须与**裸命令同结论**（不变量，不是硬编码 deny）；
  //   ② 反向核查：`./build` / `$TARGET` / `../other` / `~` 这类裸命令在 `outside=deny` 下
  //      本是 allow，加了构造**不得**被收紧（`outside` 是**具体**档，不得无条件并入）；
  //   ③ 58d / 58e3 的加强版：**八档全 allow** 时读不懂形态仍必须 allow（不得凭空多档）；
  //   ④ heredoc **正文**是数据、不是命令：正文里写 `/etc` 不得让它多出一个 `outside` 档。
  {
    const bad = []
    const dsOutside = ONLY('outside')
    const dsAllAllow = ONLY('none')
    const SH = ['bash', 'pwsh'], PL = ['win32', 'posix']
    // ① 与裸命令同结论（`outside=deny`）——真 bash 会执行的形态
    //
    // 基座**必须含一个「带空格 + 引号」的目标**：粗分词元按空白切分，
    // `rm -rf "/data/my project"` 被切成两片而两片都不匹配整块引号正则 ⇒ 判不出目标。
    // 仲裁实测：把基座换成含空格目标后，**原断言立刻产生 48 处 mismatch** ——
    // 即原基座（全是无空格目标）对该族的采样过窄，修复 2 正是补这一族。
    for (const base of ['rm -rf /etc', 'rm -rf /etc/x', 'chmod 777 /etc', 'rm -rf C:/Windows', 'rm -rf ./build',
      'rm -rf "/data/my project"', 'rm -rf "C:/Users/me/My Docs"']) {
      // opener 补 `<<\EOF`（反斜杠转义分隔符是**合法 heredoc**，见下面 AH10 ⑤）
      for (const red of ['<<EOF\nbody\nEOF', '<<-EOF\nbody\nEOF', '<<"EOF"\nbody\nEOF', "<<'EOF'\nbody\nEOF", '<<<x', '<<EOF\nEOF', '<<\\EOF\nbody\nEOF']) {
        for (const sh of SH) for (const pl of PL) {
          const plain = at(base, dsOutside, sh, { platform: pl }).action
          const withRed = at(base + ' ' + red, dsOutside, sh, { platform: pl }).action
          if (plain !== withRed) bad.push(['① 与裸命令分歧', base, red.replace(/\n/g, '\\n'), sh, pl, plain, withRed])
        }
      }
    }
    // ② 不得凭空收紧：裸命令本是 allow 的那一族
    for (const base of ['rm -rf ./build', 'rm -rf $TARGET', 'rm -rf ../other', 'rm -rf ~']) {
      for (const red of ['<<EOF\nbody\nEOF', '<<<x']) {
        for (const pl of PL) {
          if (at(base + ' ' + red, dsOutside, 'bash', { platform: pl }).action !== 'allow') {
            bad.push(['② 凭空收紧', base, red, pl, at(base + ' ' + red, dsOutside, 'bash', { platform: pl }).action])
          }
        }
      }
    }
    // ③ 八档全 allow（58d / 58e3 的加强版）
    for (const c of ['rm -rf /etc <<EOF\nbody\nEOF', 'rm -rf /etc <<<x', 'rm -rf /etc "unclosed', 'rm -rf /etc &&']) {
      for (const pl of PL) {
        if (at(c, dsAllAllow, 'bash', { platform: pl }).action !== 'allow') {
          bad.push(['③ 全 allow 被收紧', c, pl, at(c, dsAllAllow, 'bash', { platform: pl }).action])
        }
      }
    }
    // ④ 正文是数据：`cat > doc.txt <<EOF\n/etc\nEOF` 不得因为正文里的 `/etc` 多出 outside 档
    for (const c of ['cat > doc.txt <<EOF\n/etc\nEOF', 'cat <<EOF\n/etc\nEOF', 'echo hi <<EOF\n/etc\nEOF']) {
      for (const pl of PL) {
        if (at(c, dsOutside, 'bash', { platform: pl }).action !== 'allow') {
          bad.push(['④ 正文被当成命令', c, pl, at(c, dsOutside, 'bash', { platform: pl }).action])
        }
      }
    }
    ok('★★ AH10 整行读不懂分支必须并入 `outside` 档（且**仅当**原文读得出区外目标时）——发现 1',
      bad.length === 0, JSON.stringify(bad.slice(0, 10)))
  }

  // ── ⑪ 本批修复：`stripHeredocBody` 的**边界**（修复 1 / 4）+ 引号内空白（修复 2）──────
  // 根因是同一处：`stripHeredocBody` 只保留到 `<<TAG` 的**结束**位置，
  // 于是 ① `<<TAG` **同一行**上操作符之后的内容、② **终止符之后**的整段，全被当正文丢掉。
  // 真 bash 实测（隔离目录内 `eval`，victim 是否被删即判据）：
  //     rm -rf ./build <<EOF\nbody\nEOF\nrm -rf v          → v **被删**
  //     rm -rf ./build <<EOF ; rm -rf v\nbody\nEOF         → v **被删**（`&&` / `|` / `&` 同）
  //     cat <<<x\nrm -rf v                                  → v **被删**（here-string 不吞后续行）
  // 反向对照（**不**执行，修法不得误伤）：终止符行有尾随 `EOF ; rm -rf v` → 不执行；
  // 无终止符时正文里的 `rm` → 不执行。
  {
    const bad = []
    const dsOutside = ONLY('outside')
    const dsAllDeny = { inside: 'deny', outside: 'deny', wide: 'deny', unknown: 'deny', priv: 'deny', proc: 'deny', power: 'deny', reg: 'deny' }
    const dsAllAllow = ONLY('none')
    const SH = ['bash', 'pwsh'], PL = ['win32', 'posix']
    // 裸命令作**不变量**基准（不硬编码 deny —— 与 AH10 ① 同一条纪律）。
    // 基准目标取**两平台都判 `outside`** 的形态：`/etc` 在 posix 下不属于 outside 档
    // （`/var/lib/my app` 与 `"/data/my project"` 两平台一致），拿 `/etc` 当基准会得到
    // 「posix 上裸命令与带构造形态同结论」的假分歧。
    const NAKED = 'rm -rf /var/lib/my app'
    const danger = [
      // ① `<<TAG` 同一行、操作符之后
      'rm -rf ./build <<EOF ; rm -rf /var/lib/my app\nbody\nEOF',
      'rm -rf ./build <<EOF && rm -rf /var/lib/my app\nbody\nEOF',
      'rm -rf ./build <<EOF | rm -rf /var/lib/my app\nbody\nEOF',
      'rm -rf ./build <<EOF & rm -rf /var/lib/my app\nbody\nEOF',
      'rm -rf ./build <<EOF || rm -rf /var/lib/my app\nbody\nEOF',
      // ② 终止符之后（`<<-` / 引号分隔符同）
      'rm -rf ./build <<EOF\nbody\nEOF\nrm -rf /var/lib/my app',
      'rm -rf ./build <<-EOF\nbody\nEOF\nrm -rf /var/lib/my app',
      'rm -rf ./build <<"EOF"\nbody\nEOF\nrm -rf /var/lib/my app',
      // ③ here-string 之后（`<<<` 不是 heredoc，不吞后续行）
      'cat <<<x\nrm -rf /var/lib/my app',
      'cat <<<x ; rm -rf /var/lib/my app',
    ]
    for (const c of danger) {
      for (const sh of SH) for (const pl of PL) {
        const plain = at(NAKED, dsOutside, sh, { platform: pl }).action
        const got = at(c, dsOutside, sh, { platform: pl }).action
        if (got !== plain) bad.push(['⑤ 与裸命令分歧', c, sh, pl, plain, got])
        // 真 bash 会执行 ⇒ 八档全 deny 下**绝不**能 allow
        if (at(c, dsAllDeny, sh, { platform: pl }).action === 'allow') {
          bad.push(['⑤ 全 deny 下放行（真 bash 会执行）', c, sh, pl])
        }
      }
    }
    // 命令替换 / 反引号内：**只钉「全 deny 下不得 allow」**，不钉「与裸命令同结论」——
    // 这两条走 opaque 段路径，而 `outside` 档在该路径上**本就不参与**（HEAD 上亦然：
    // 实测 `echo $(rm -rf /etc)` 在 `outside=deny` 下 HEAD/pre/post 三版都是 allow）。
    // 那是一条既有的、与本批 4 条缺陷无关的路径行为，不在本次修复范围（不越界改动）。
    // 本批修的是 strip 边界：HEAD/pre 上这两条连**全 deny** 都放行，修复后判 deny
    //（真 bash 实测 victim 被删）。
    for (const c of ['echo $(cat <<EOF ; rm -rf /var/lib/my app\nbody\nEOF)',
      'echo `cat <<EOF ; rm -rf /var/lib/my app\nbody\nEOF`',
      'echo $(cat <<EOF\nbody\nEOF\nrm -rf /var/lib/my app)']) {
      for (const sh of SH) for (const pl of PL) {
        if (at(c, dsAllDeny, sh, { platform: pl }).action === 'allow') {
          bad.push(['⑤ 命令替换内全 deny 下放行（真 bash 会执行）', c, sh, pl])
        }
      }
    }
    // 反向核查：这些形态真 bash **不**执行，不得被收紧
    // ⚠️ 终止符**之后**的 `rm` 不在这一族 —— 它会执行（见上 ②），别误分类。
    for (const c of ['cat <<EOF\n/etc\nEOF', 'cat > doc.txt <<EOF\nrm -rf /etc\nEOF',
      'cat <<EOF\nbody\nrm -rf /etc', 'cat <<-EOF\n\trm -rf /etc\n\tEOF']) {
      for (const pl of PL) {
        if (at(c, dsAllAllow, 'bash', { platform: pl }).action !== 'allow') {
          bad.push(['⑤ 反向：正文被当命令', c, pl, at(c, dsAllAllow, 'bash', { platform: pl }).action])
        }
      }
    }
    ok('★★ AH10b `stripHeredocBody` 必须保留「同行操作符之后」与「终止符之后」的命令（修复 1）',
      bad.length === 0, JSON.stringify(bad.slice(0, 10)))
  }

  // ── ⑪-2 修复 1：**分隔符里夹引号**的 opener（opener 正则的靶心）────────────────────
  // 原正则 `(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1` 只允许引号**整体包住**分隔符。引号夹在
  // 分隔符**中间**时匹配 `<<E`、标签读成 `E` ⇒ 找不到终止符 `EOF` ⇒ 走 `!end` 分支把
  // 终止符**之后**的真命令整段丢掉 ⇒ `rawCommandNames` 只看到 `cat`。
  // 真 bash 实测（隔离目录，victim 是否被删即判据）：这 10 个形态**全部执行**。
  {
    const bad = []
    const dsOutside = ONLY('outside')
    const dsAllDeny = { inside: 'deny', outside: 'deny', wide: 'deny', unknown: 'deny', priv: 'deny', proc: 'deny', power: 'deny', reg: 'deny' }
    const SH = ['bash', 'pwsh'], PL = ['win32', 'posix']
    const NAKED = 'rm -rf /var/lib/my app'
    // [opener 写法, 终止符] —— 分隔符取 `EOF`（引号剥掉后的值）
    const FORMS = [
      ['<<E"OF"', 'EOF'], ["<<E'OF'", 'EOF'], ['<<EO"F"', 'EOF'], ['<<"E"OF', 'EOF'],
      ['<<E"O"F', 'EOF'], ['<<\\E"OF"', 'EOF'], ['<<END-OF', 'END-OF'], ['<<END.OF', 'END.OF'],
      ['<<""', ''], ['<< E"OF"', 'EOF'],
    ]
    for (const [form, tag] of FORMS) {
      // 三种构造：终止符之后 / 同行操作符之后 / 不带正文
      const forms = [
        'cat ' + form + '\nbody\n' + tag + '\n' + NAKED,
        'cat ' + form + ' ; ' + NAKED + '\nbody\n' + tag,
        'cat ' + form + '\n' + tag + '\n' + NAKED,
      ]
      for (const c of forms) {
        for (const sh of SH) for (const pl of PL) {
          const plain = at(NAKED, dsOutside, sh, { platform: pl }).action
          const got = at(c, dsOutside, sh, { platform: pl }).action
          if (got !== plain) bad.push(['⑤b 夹引号分隔符与裸命令分歧', form, c, sh, pl, plain, got])
          // 真 bash 会执行 ⇒ 八档全 deny 下**绝不**能 allow
          if (at(c, dsAllDeny, sh, { platform: pl }).action === 'allow') {
            bad.push(['⑤b 全 deny 下放行（真 bash 会执行）', form, c, sh, pl])
          }
        }
      }
    }
    ok('★★ AH10b-2 分隔符里夹引号的 heredoc（`<<E"OF"` 等 10 形态）不得吞掉终止符之后的命令（修复 1）',
      bad.length === 0, JSON.stringify(bad.slice(0, 10)))
  }

  // ── ⑪-3 修复 2：**循环剥离**必须带方向守卫 ────────────────────────────────────────
  // 只剥离第一个 heredoc 时，第二个 heredoc 的正文被「顺带」丢掉（错误理由下的正确结果）；
  // 循环剥离后第二个 heredoc 的头与正文重新进入被扫文本，正文里的 `rm` 会被判成命令。
  // 真 bash 实测：双 heredoc 的**第二个正文是数据**（victim 存活）⇒ 不得被收紧。
  {
    const bad = []
    const dsAllAllow = ONLY('none')
    for (const c of [
      'cat <<A\nbody\nA\ncat <<B\nrm -rf /var/lib/my app\nB',
      'cat <<A\nbody\nA\ncat <<B\n/etc\nB',
      'cat <<A\nbody\nA\ncat <<B\nbody2\nB\ncat <<C\nrm -rf /var/lib/my app\nC',
      'cat <<A ; echo hi\nbody\nA\ncat <<B\nrm -rf /var/lib/my app\nB',
      'cat <<rm\nbody\nrm',
      'cat <<sudo\nbody\nsudo',
      'cat <<A\nbody\nA\ncat <<rm\nx\nrm',
      'cat <<A\nbody\nA\ncat <<shutdown\nx\nshutdown',
    ]) {
      for (const pl of ['win32', 'posix']) {
        if (at(c, dsAllAllow, 'bash', { platform: pl }).action !== 'allow') {
          bad.push(['⑨ 正文是数据却被当命令', c, pl, at(c, dsAllAllow, 'bash', { platform: pl }).action])
        }
      }
      // 标签 / 终止符与真命令同名时不得被当命令名（`rm *`=deny 例外因此误命中）
      const names = rawCommandNames(c)
      for (const n of ['rm', 'sudo', 'shutdown']) {
        if (names.includes(n)) bad.push(['⑨ 标签/终止符被当命令名', c, n, JSON.stringify(names)])
      }
    }
    ok('★★ AH10b-3 第二个 heredoc 的正文是**数据**；标签/终止符与命令同名时不得被当命令（修复 2）',
      bad.length === 0, JSON.stringify(bad.slice(0, 10)))
  }

  // ── ⑪-4 修复 2 的**方向守卫**：假 opener 不得吞掉后续真命令（⚠️ 反例钉桩）──────────
  // 这是报告者建议的「无条件循环剥离」修法的**反例**：真 heredoc 剥离后，下一个「opener」
  // 可能是引号 / 注释 / 算术里的**假 opener**，它的 `!end` 分支会把其后整段真命令截掉
  // ⇒ fail-open。真 bash 实测下列 6 个形态**全部执行**（victim 被删），故必须仍判 deny。
  {
    const bad = []
    const dsOutside = ONLY('outside')
    const dsAllDeny = { inside: 'deny', outside: 'deny', wide: 'deny', unknown: 'deny', priv: 'deny', proc: 'deny', power: 'deny', reg: 'deny' }
    const SH = ['bash', 'pwsh'], PL = ['win32', 'posix']
    const NAKED = 'rm -rf /var/lib/my app'
    const FAKE = [
      // ① 双引号内的假 opener
      'cat <<A\nbody\nA\necho "x<<y"\n' + NAKED,
      // ② 注释里的假 opener
      'cat <<A\nbody\nA\n# a<<b\n' + NAKED,
      // ③ 算术展开里的假 opener
      'cat <<A\nbody\nA\n$((x<<y))\n' + NAKED,
      // ④ 重定向 + 引号里的假 opener
      'cat <<EOF > o.txt\nbody\nEOF\necho "a<<b"\n' + NAKED,
      // ⑤ 同行注释里的假 opener
      'cat <<A\nbody\nA\necho hi # a<<b\n' + NAKED,
      // ⑥ 双 heredoc（第二个是**真** heredoc，其正文是数据，但后续命令仍会执行）
      'cat <<A\nbody\nA\ncat <<B\nrm -rf /var/lib/my app\nB',
    ]
    // ⚠️ ⑥ 与 ①–⑤ 的期望不同：⑥ 的 `rm` 在**第二个 heredoc 的正文里**（真 bash 实测**不**执行），
    // 故它归 AH10b-3 的「正文是数据」族，这里只钉 ①–⑤ 这 5 个真执行形态 + ⑥ 的裸命令不变量。
    for (let i = 0; i < FAKE.length; i += 1) {
      const c = FAKE[i]
      for (const sh of SH) for (const pl of PL) {
        if (i < 5) {
          // 真 bash 会执行 ⇒ 必须与裸命令同结论，且八档全 deny 下绝不 allow
          const plain = at(NAKED, dsOutside, sh, { platform: pl }).action
          const got = at(c, dsOutside, sh, { platform: pl }).action
          if (got !== plain) bad.push(['⑩ 假 opener 吞掉后续真命令', c, sh, pl, plain, got])
          if (at(c, dsAllDeny, sh, { platform: pl }).action === 'allow') {
            bad.push(['⑩ 全 deny 下放行（真 bash 会执行）', c, sh, pl])
          }
        }
        // ⑥ 的正文是数据 ⇒ 八档全 deny 下必须 allow（与 `cat` 同结论）
        if (i === 5 && at(c, dsAllDeny, sh, { platform: pl }).action !== 'allow') {
          bad.push(['⑩ 双 heredoc 正文被当命令', c, sh, pl])
        }
      }
    }
    ok('★★ AH10b-4 假 opener（引号/注释/算术里的 `<<`）不得吞掉后续真命令（修复 2 的方向守卫）',
      bad.length === 0, JSON.stringify(bad.slice(0, 10)))
  }

  // ── ⑫ 修复 2：`outsideTargetInUnparsable` 的粗分词元**不认引号内的空白** ────────────
  // `rm -rf "/data/my project"` 被按空白切成 `["rm","-rf","\"/data/my","project\""]`，
  // 两片都不匹配整块引号正则 ⇒ 判不出目标 ⇒ `outside` 档失明。
  // 仲裁实测（`outside=deny`、其余七档 allow）：`rm -rf "C:/Users/me/My Docs"` → **deny**；
  // 加 `<<EOF` / `<<<x` / `&&` / `"unclosed` / `>` 五种构造后**全部 allow**。
  // 修法把切分与合并**合并成一份引号感知分词器** `splitQuotedTokens`（引号内空白与操作符
  // 都不切、token 内引号按 bash 语义剥掉），删掉「先原切分、判不出再合并」的第二候选。
  //
  // ── 修复 3 追加的基座：引号**内**的操作符字符 ──────────────────────────────────────
  // 原 `body.split(/[\n\r;|&(){}<>]+/)` **对引号无感知** —— 引号内的 `& | ; ( ) { } < >`
  // 同样被切开，切碎后两片各自都不含完整引号对，而 `mergeQuotedWords` 只在**引号内的
  // 空白**上合并，无从恢复 ⇒ 判不出目标 ⇒ `outside` 档失明。
  // 仲裁实测（`outside=deny`、其余七档 allow）：`rm -rf "D:/R&D"`、
  // `"D:/my project (old)"`、`"D:/a|b"`、`"D:/a;b"`、`"D:/a&b"`、`"D:/my project"/sub`、
  // `"D:/data;backup"`、`"D:/Project {old}"` 全部**裸=deny → 带构造=allow**；
  // 对照 `"/data/my project"`（无操作符字符）→ deny→deny ✅。真 bash 实测这些目标**真的被删**。
  // `R&D`、`(x86)` 是**真实存在的目录名**。该族在 HEAD 上也是 allow（**不是回归**），
  // 但恰好落在本轮修复的靶心（AH10c 原基座全部是不含操作符字符的目标）。
  {
    const bad = []
    const dsOutside = ONLY('outside')
    const SH = ['bash', 'pwsh'], PL = ['win32', 'posix']
    const CONSTRUCTS = ['<<EOF\nbody\nEOF', '<<<x', '&&', '"unclosed', '>']
    // 含空格 + 引号的区外目标（含 `chmod 777` 那一族 —— posix 下合并后判 `system` 归 `wide`，
    // 故它只保证「与裸命令同结论」，不保证走 `outside` 档；win32 下才判 `outside`）
    //
    // 后 8 条是修复 3 的基座：引号**内**含 `& ( ) | ; { }` 的目标（两平台四方言下裸命令均判
    // `outside` ⇒ deny，见 AH10c 的「与裸命令同结论」判据）。
    for (const base of ['rm -rf "/data/my project"', 'rm -rf "/var/lib/my app"',
      'rm -rf "C:/Users/me/My Docs"', 'chmod 777 "/var/www/my site"',
      'rm -rf "D:/R&D"', 'rm -rf "D:/my project (old)"', 'rm -rf "D:/a|b"',
      'rm -rf "D:/a;b"', 'rm -rf "D:/a&b"', 'rm -rf "D:/my project"/sub',
      'rm -rf "D:/data;backup"', 'rm -rf "D:/Project {old}"']) {
      for (const red of CONSTRUCTS) {
        for (const sh of SH) for (const pl of PL) {
          const plain = at(base, dsOutside, sh, { platform: pl }).action
          const got = at(base + ' ' + red, dsOutside, sh, { platform: pl }).action
          if (got !== plain) bad.push(['⑥ 含空格/操作符目标与裸命令分歧', base, red, sh, pl, plain, got])
        }
      }
    }
    // 不含空格的引号目标：既有行为不得回退。判据用「与裸命令同结论」而**不是**硬编码 deny ——
    // `"/etc"` 在 **posix** 下本就不是 `outside` 档（实测裸命令 `rm -rf "/etc"` 在
    // `outside=deny` / posix 下就是 allow，HEAD/pre/post 三版一致），硬编码 deny 会把
    // 「posix 的平台名单差异」误报成修复 2 的回退。win32 下它是 deny，两者都钉住。
    for (const base of ['rm -rf "/etc"', "rm -rf '/etc'"]) {
      for (const red of CONSTRUCTS) {
        for (const pl of PL) {
          const plain = at(base, dsOutside, 'bash', { platform: pl }).action
          const got = at(base + ' ' + red, dsOutside, 'bash', { platform: pl }).action
          if (got !== plain) bad.push(['⑥ 无空格引号目标回退', base, red, pl, plain, got])
        }
      }
      // win32 下该形态**必须**是 deny（`/etc` 属于 win32 的 outside 名单）
      if (at(base, dsOutside, 'bash', { platform: 'win32' }).action !== 'deny') {
        bad.push(['⑥ win32 无空格引号目标判不出 outside', base])
      }
    }
    ok('★★ AH10c 含空格 + 引号（及引号内含操作符字符）的区外目标在整行读不懂时**同样**读得出（修复 2/3）',
      bad.length === 0, JSON.stringify(bad.slice(0, 10)))
  }

  // ── ⑬ 修复 4：`<<\EOF` 是**合法 heredoc**，正文是数据（修的是**误拦**方向）─────────
  // 原正则 `(['"]?)` 不认反斜杠转义分隔符 ⇒ 不剥离正文 ⇒ 正文被当命令 ⇒ 八档全 deny 的误拦。
  // 真 bash 实测：`cat <<\EOF\nrm -rf v\nEOF` → v **不被删**（正文是数据）；
  // 报告者建议的 `(['"\\]?)` **无效**（反向引用 `\1` 被 `\` 占掉，`<<\EOF` 上 NO-MATCH）——
  // 正确写法是把转义放到捕获组**外**（`\\?(['"]?)`）。
  {
    const bad = []
    const dsAllAllow = ONLY('none')
    const dsAllDeny = { inside: 'deny', outside: 'deny', wide: 'deny', unknown: 'deny', priv: 'deny', proc: 'deny', power: 'deny', reg: 'deny' }
    const SH = ['bash', 'pwsh'], PL = ['win32', 'posix']
    // 正文是数据 ⇒ 与裸 `cat` 同结论（不变量），且八档全 deny 下也必须 allow
    for (const c of ['cat <<\\EOF\nrm -rf /etc\nEOF', 'cat <<\\EOF\n/etc\nEOF',
      'cat <<-\\EOF\nrm -rf /etc\nEOF', 'cat <<-\\EOF\n/etc\nEOF',
      'cat <<\\EOF\nrm -rf /var/lib/my app\nEOF']) {
      for (const sh of SH) for (const pl of PL) {
        const plain = at('cat', dsAllDeny, sh, { platform: pl }).action
        const got = at(c, dsAllDeny, sh, { platform: pl }).action
        if (got !== plain) bad.push(['⑦ `<<\\EOF` 正文被当命令', c, sh, pl, plain, got])
        if (at(c, dsAllAllow, sh, { platform: pl }).action !== 'allow') {
          bad.push(['⑦ 全 allow 下被拦', c, sh, pl, at(c, dsAllAllow, sh, { platform: pl }).action])
        }
      }
    }
    // 但 `<<\EOF` **同行操作符之后**与**终止符之后**仍是真的命令（真 bash 实测 v 被删）
    for (const c of ['cat <<\\EOF ; rm -rf /var/lib/my app\ndata\nEOF',
      'cat <<\\EOF\ndata\nEOF\nrm -rf /var/lib/my app']) {
      for (const pl of PL) {
        const plain = at('rm -rf /var/lib/my app', ONLY('outside'), 'bash', { platform: pl }).action
        const got = at(c, ONLY('outside'), 'bash', { platform: pl }).action
        if (got !== plain) bad.push(['⑦ `<<\\EOF` 之后被漏', c, pl, plain, got])
      }
    }
    ok('★★ AH10d `<<\\EOF` 是合法 heredoc：正文是数据（修误拦），其后命令照常判（修复 4）',
      bad.length === 0, JSON.stringify(bad.slice(0, 10)))
  }

  // ── ⑭ 消误报方向：heredoc **标签 / 终止符**与真命令同名时不得被当命令名 ────────────
  // HEAD 上 `cat <<rm\nbody\nrm` 的 `rawCommandNames` 是 `["cat","rm"]` —— 标签 `rm` 与
  // 终止符 `rm` 都被当成了命令名，`rm *`=deny 例外因此误命中。真 bash 实测这两处都不是
  // 命令（victim 存活）。修复后是 `["cat"]`。这是**消除误报**，方向正确。
  {
    const bad = []
    const dsAllDeny = { inside: 'deny', outside: 'deny', wide: 'deny', unknown: 'deny', priv: 'deny', proc: 'deny', power: 'deny', reg: 'deny' }
    for (const c of ['cat <<rm\nbody\nrm', 'cat <<sudo\nbody\nsudo', 'cat <<shutdown\nbody\nshutdown']) {
      const names = rawCommandNames(c)
      if (names.includes('rm') || names.includes('sudo') || names.includes('shutdown')) {
        bad.push(['⑧ 标签/终止符被当命令名', c, JSON.stringify(names)])
      }
      for (const pl of ['win32', 'posix']) {
        if (at(c, dsAllDeny, 'bash', { platform: pl }).action !== 'allow') {
          bad.push(['⑧ 全 deny 下仍被拦', c, pl, at(c, dsAllDeny, 'bash', { platform: pl }).action])
        }
      }
    }
    ok('★★ AH10e heredoc 标签/终止符与命令同名时不得被当成命令（消误报方向）',
      bad.length === 0, JSON.stringify(bad.slice(0, 10)))
  }
  // ── ⑮ 源码钉桩：`stripHeredocBody` 的正则必须同时满足五条（修复 1 / 4 的写法约束）──
  // 每一条都是**实测**逼出来的，写成源码正则是因为它们各自有一个方向的反例：
  //   · `(?<!<)` 必须在 —— 否则 here-string `<<<x` 会被误当 heredoc 标签（吞掉后续真命令）；
  //   · 转义必须放在捕获组**外**（`\\?(`）—— 放进组内（`(['"\\]?)`）会让反向引用
  //     `\1` 去匹配那个反斜杠，`<<\EOF` 上直接 NO-MATCH（报告者建议的写法实测无效）；
  //   · **不得**用反向引用配对引号（`(['"]?)…\1`）—— 那种写法只允许引号**整体包住**
  //     分隔符，引号夹在中间（`<<E"OF"`）时标签被读成 `E` ⇒ 找不到终止符 `EOF`
  //     ⇒ 走 `!end` 分支把终止符**之后**的真命令整段丢掉。真 bash 实测
  //     `cat <<E"OF"\nbody\nEOF\nrm -rf v` → v **被删**（八档全 deny 下被放行）。
  //   · 分隔符类必须**接受引号内的字符**（`'…'` 与 `"…"` 两个分支）—— 否则 `<<E"OF"`
  //     与同族的 `<<END-OF` / `<<END.OF` / `<<""` 全部判不出（实测仍有 4 类漏网）。
  {
    const spSrc = readFileSync(pathJoin(ROOT, 'shell-parse.js'), 'utf8')
    const m = /function stripHeredocBody\(source\) \{\n([\s\S]*?)\n\}/.exec(spSrc)
    const fnBody = m ? m[1] : ''
    // 只扫**正则声明那一行**：函数体注释里为解释反例也会出现同样的字面量，
    // 扫整个函数体会把注释误判成代码（实测踩过）。
    const declLine = (fnBody.split('\n').find((l) => l.includes('const heredoc =')) || '').trim()
    const bad = []
    if (!declLine) bad.push('未找到 stripHeredocBody 里的 heredoc 正则声明行')
    // ① here-string 排除
    if (!declLine.includes('(?<!<)<<-?')) bad.push('缺 (?<!<) —— here-string `<<<x` 会被误当 heredoc')
    // ② 转义在捕获组**外**（源码形态 `\\?(` —— 反斜杠转义紧跟捕获组开括号）
    if (!declLine.includes('\\\\?(')) bad.push('转义未放在捕获组外 —— `<<\\EOF` 会 NO-MATCH')
    // ③ 捕获组内不得含反斜杠（否则反向引用被占掉）
    if (declLine.includes('([\'"\\\\]?)')) bad.push('捕获组内含反斜杠 —— 反向引用会被占掉')
    // ④ 不得用反向引用配对引号（`<<E"OF"` 的根因）
    if (declLine.includes('\\1')) bad.push('用反向引用配对引号 —— `<<E"OF"` 的标签会被读成 `E`（吞掉后续真命令）')
    // ⑤ 分隔符类必须接受引号内的字符（单引号与双引号两个分支都在）
    if (!declLine.includes("(?:'") || !declLine.includes('|"')) {
      bad.push('分隔符类不接受引号内的字符 —— `<<E"OF"` / `<<END-OF` / `<<END.OF` 判不出')
    }
    ok('★ AH10f `stripHeredocBody` 的 opener 正则必须含 `(?<!<)`、转义在捕获组外、且不用反向引用配对引号（修复 1/4 写法约束）',
      bad.length === 0, JSON.stringify(bad))
  }
}

// ─────────────────────────────────────────────────────────────────────────────
group('AI. `RADIUS_TIERS_WHEN_UNREADABLE` 三档逐档承重（发现：`unknown` 档无断言守护）')
{
  // ── 这一组盯的是什么 ────────────────────────────────────────────────────────
  // `RADIUS_TIERS_WHEN_UNREADABLE = ['wide','unknown','inside']` 是**单点常量**，
  // 被两条路径共用：整行 `ok:false` 分支与段级 `opaqueHiddenPayload` 支。
  // 三档是**并联**关系（任一档为 deny → 结论 deny），故删掉任一个只有在该档
  // **独自**为 deny 时才显形 —— 这正是它此前逃过全部断言的原因：
  // 上一批的变异测试（把 `unknown` 从数组里删掉）**测试全绿**，
  // 而独立进程差分显示「只有 `unknown=deny`」这一族配置下结论由 deny 变 allow。
  //
  // ── 为什么值得钉 ────────────────────────────────────────────────────────────
  // 风险不在「现在」而在「日后」：`wide` 与 `unknown` 在「半径读不出」这个场景下
  // 语义重叠（`wide` 管「范围可能很大」、`unknown` 管「读不出」），
  // 后来者很容易认为「反正 wide 已经并了，unknown 多余」而删掉它 ——
  // 而面板上 `unknown` 档的标签就是「无法判定」，把它设成拒绝是很自然的配置。
  // 删掉它 = 那一档静默失效（fail-open），且没有任何断言会红。
  //
  // ── 判据的三条约束（缺一不可）──────────────────────────────────────────────
  //   ① 三档**逐档**测：只测「三档全 deny」是抓不住单档缺失的（并联关系）；
  //   ② 两条**路径**都测：常量被两处消费，只测一条会漏掉另一条的接线；
  //   ③ 必须带**全 allow 对照**：否则「把三档都改成无条件 deny」也能过 ——
  //      那是凭空收紧，与 60g ④b/⑤b 的承重格（合法常用命令恰好 `['unknown']`）冲突。
  const TIERS_AI = ['inside', 'outside', 'wide', 'unknown', 'priv', 'proc', 'power', 'reg']
  const ONLY_AI = (tier) => { const t = {}; for (const x of TIERS_AI) t[x] = x === tier ? 'deny' : 'allow'; return t }
  const ALLOW_AI = {}; for (const x of TIERS_AI) ALLOW_AI[x] = 'allow'
  const mkAI = (t) => ({
    home: HOME, userHome: HOME, platform: 'win32',
    matchException: () => null,
    destructive: () => t,
    category: () => ({ action: 'allow', reason: null }),
    isOutsideWorkspace: () => true,
    isWorkspaceRoot: () => false,
  })
  const atAI = (c, t, sh) => assessCommand(c, sh || 'bash', mkAI(t))

  // ── ① 整行读不懂路径（`ok:false` 分支）──────────────────────────────────────
  // 靶格都是**真能执行**的破坏性命令，只是多带一个读不懂的构造 —— 命令名由
  // `rawCommandNames` 从原文粗提（这是该路径唯一的命令名来源）。
  const UNP_AI = [
    ['heredoc', 'rm -rf /data <<EOF\nbody\nEOF'],
    ['未闭合引号', 'rm -rf /data "unclosed'],
    ['悬空重定向', 'rm -rf /data >'],
    ['悬空管道', 'rm -rf /data |'],
    ['未闭合 $()', 'rm -rf /data $(unclosed'],
    ['taskkill + heredoc', 'taskkill /f /im x.exe <<EOF\nx\nEOF'],
    ['kill + heredoc', 'kill 1234 <<EOF\nx\nEOF'],
  ]
  for (const tier of ['wide', 'unknown', 'inside']) {
    const bad = []
    for (const [n, c] of UNP_AI) {
      const r = atAI(c, ONLY_AI(tier))
      if (r.action !== 'deny') bad.push([n, r.action, r.code])
    }
    ok('★ AI1 整行读不懂：`' + tier + '=deny` 独自承重（其余七档 allow）',
      bad.length === 0, JSON.stringify(bad))
  }

  // ── ② 段级 opaqueHiddenPayload 路径（`tierSetOf` 的守卫支）─────────────────
  // 真命令藏在构造里、段首读不出破坏性命令 —— 与 ① 是**两条独立接线**，
  // 常量被两处消费，必须分别钉。
  //
  // ⚠️ **`unknown` 这一格在段级路径上是「双来源」，测不出常量的缺失**（实测）：
  // 段级还有一个补档行 `if (seg && (… || seg.opaque)) add('unknown')`（`tierSetOf` 判据③），
  // 于是把 `unknown` 从常量里删掉时，本组**只有 `wide` / `inside` 两格会红**，
  // `unknown` 那一格被补档行兜住、照旧 deny。这不是缺陷 —— 两条来源是**有意的冗余**
  // （常量管「半径读不出」的通用口径，补档行管「段是 opaque」这一具体判据）。
  // 真正能测出「段级 unknown 整体失守」的是**同时**拆掉两处（实测那样才由 deny 变 allow）。
  // 故本格的断言名写「段级路径承重」，不写「常量承重」—— 后者是 AI1 与 AI5 的职责。
  const SEG_AI = [
    ['子 shell', 'echo a | (rm -rf C:/Windows)'],
    ['反引号', 'echo a | Write-Output `rm -rf C:/Windows`'],
    ['pwsh 脚本块', 'echo a | ForEach-Object { Remove-Item C:/Windows -Recurse -Force }'],
    ['提权 + 子 shell', 'echo a | sudo $(rm -rf C:/Windows)'],
  ]
  for (const tier of ['wide', 'unknown', 'inside']) {
    const bad = []
    for (const [n, c] of SEG_AI) {
      const r = atAI(c, ONLY_AI(tier))
      if (r.action !== 'deny') bad.push([n, r.action, r.code])
    }
    ok('★ AI2 段级 opaqueHiddenPayload：`' + tier + '=deny` 独自承重（其余七档 allow）',
      bad.length === 0, JSON.stringify(bad))
  }

  // ── ③ 全 allow 对照：三档并入**不得**变成「无条件 deny」────────────────────
  // 没有这一条，「把三档改成硬 deny」也能通过 ①② —— 而那是凭空收紧：
  // 靶格的目标在工作区内（`/data`、`C:/Windows` 由 `isOutsideWorkspace` 桩判为区内），
  // 用户八档全 allow 时这些命令本就该放行（AH2 同口径：构造只是参数/读不出半径 ≠ 危险）。
  {
    const bad = []
    for (const [n, c] of UNP_AI.concat(SEG_AI)) {
      const r = atAI(c, ALLOW_AI)
      if (r.action !== 'allow') bad.push([n, r.action, r.code])
    }
    ok('★ AI3 对照：八档全 allow 时两条路径都不得凭空收紧（并入 ≠ 无条件 deny）',
      bad.length === 0, JSON.stringify(bad))
  }

  // ── ④ 单档承重的**互斥性**：只有该档 deny 时，另两档必须是 allow ──────────────
  // 上一条 `ONLY_AI` 已保证这一点；这里显式断言一次，防止日后有人把 ONLY_AI
  // 改成「该档 deny + 其余也 deny」而让 ①② 变成恒真（那会让整组失去意义）。
  {
    const bad = []
    for (const tier of ['wide', 'unknown', 'inside']) {
      const t = ONLY_AI(tier)
      for (const x of TIERS_AI) {
        if (x === tier) { if (t[x] !== 'deny') bad.push([tier, x, '应为 deny', t[x]]) }
        else if (t[x] !== 'allow') bad.push([tier, x, '应为 allow', t[x]])
      }
    }
    ok('★ AI4 逐档探针必须互斥（只该档 deny、其余七档 allow）—— 否则 ①② 恒真',
      bad.length === 0, JSON.stringify(bad))
  }

  // ── ⑤ 源码钉桩：常量内容恰好三档且含 `unknown` ──────────────────────────────
  // 行为断言（①②）已能抓住「删 unknown」，但只在**两条路径都接线正确**时成立。
  // 这一条直接钉常量本身：日后有人重构掉消费点、或把常量改成别的集合时，
  // 它会在断言名里直接指出是哪个常量变了。
  {
    const spSrc = readFileSync(pathJoin(ROOT, 'shell-parse.js'), 'utf8')
    const m = /const RADIUS_TIERS_WHEN_UNREADABLE = \[([^\]]*)\]/.exec(spSrc)
    const list = m ? m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean) : null
    const want = ['wide', 'unknown', 'inside']
    ok('★ AI5 `RADIUS_TIERS_WHEN_UNREADABLE` 恰好 `[\'wide\',\'unknown\',\'inside\']`',
      list !== null && list.length === want.length && want.every((x, i) => list[i] === x),
      'got=' + JSON.stringify(list))
  }

  // ── ⑥ 段级 `unknown` 的**双来源**必须都在（判据③ 与常量各一份）──────────────
  // 段级 opaqueHiddenPayload 支的 `unknown` 有两个产出点：
  //   · `RADIUS_TIERS_WHEN_UNREADABLE`（本常量，支内 `for … add(t)`）；
  //   · 支外的补档行 `if (seg && (… || seg.opaque)) add('unknown')`（`tierSetOf` 判据③）。
  // 二者是**有意的冗余**，删掉任一个都还有另一个兜住（实测：只删常量时 AI2 的
  // `unknown` 格仍 deny）。故这里断言**两个产出点都存在** —— 只删一个不该让行为
  // 变红，但源码里少一个就是接线退化，必须显式看见。
  // 真正需要防的是「**两个都被删**」：那时 `unknown=deny` 对段级 opaque 段完全失效
  // （实测 `echo a | (rm -rf C:/Windows)` 由 deny 变 allow）。
  {
    const spSrc = readFileSync(pathJoin(ROOT, 'shell-parse.js'), 'utf8')
    const hasConst = /const RADIUS_TIERS_WHEN_UNREADABLE = \[[^\]]*'unknown'[^\]]*\]/.test(spSrc)
    // 补档行：`|| seg.opaque)) add('unknown')`（写法可换行，故按两段子串判）
    const hasPatch = spSrc.includes('|| seg.opaque)) add(\'unknown\')')
    ok('★ AI6 段级 `unknown` 的两个产出点都在（常量 + 判据③ 补档行）',
      hasConst && hasPatch,
      'const=' + hasConst + ' patchLine=' + hasPatch)
  }
}




// ─────────────────────────────────────────────────────────────────────────────
group('AJ. 用户实测两个缺陷的钉桩：pwsh 反引号方言矩阵 + 假候选 label')
{
  // 本组钉的是**用户真实弹窗里看到的两件事**（截图为证），二者此前都没有任何断言守护：
  //
  // ① **反引号让整行 `ok:false`** —— 用户两条命令各含一个 `` `n ``（`"`n--- … ---"`），
  //    弹窗因此**完全不分段**。根因：词法器里 `\` 转义有 bash 方言守卫，而反引号分支
  //    **没有**，于是 PowerShell 的转义符被无条件当成 bash 的命令替换定界符去**找配对**。
  //    后果由反引号**个数的奇偶**决定 —— 这正是本组 ① 要钉死的指纹。
  // ② **假候选 label** —— `$d='…'` / `FOO=/…` / `"--- 编码/换行校验 ---"` 三条都被
  //    当成命令名给出「允许此项」按钮，而写下的例外**永不命中**。根因：`commandNameOf`
  //    的路径剥离是**无条件**的，而 `BAD_LABEL_CHARS` 检查的是**切完的结果**，
  //    坏字符只要在最后一个分隔符之前就被连前缀一起切掉了。
  {
    const BT = String.fromCharCode(96)
    const bad = []
    const NL = '\n'
    // 用户两条命令（**已脱敏**：真实个人目录换成合成路径 `X:/ws/demo`，结构逐字保留）
    const D = "'X:/ws/demo/_tmp/file-test'"
    const U1 = 'Write-Output "' + BT + 'n--- 编码/换行校验 ---' + BT + 'n"' + NL +
      '$d=' + D + NL +
      'New-Item -ItemType Directory -Force -Path $d | Out-Null'
    const U2 = 'Write-Output "' + BT + 'n--- 编码/换行校验 ---' + BT + 'n"' + NL +
      '$d=' + D + NL +
      'Set-Content -LiteralPath (Join-Path $d ' + "'a.txt'" + ') -Value "hi"' + NL +
      'Get-Content -LiteralPath (Join-Path $d ' + "'a.txt'" + ') | Format-Table'

    // ── ① 反引号不得让整行失败；分段必须正常 ──────────────────────────────────
    for (const [n, c, wantSegs] of [['命令1', U1, 4], ['命令2', U2, 5]]) {
      const d = decomposeCommand(c, 'pwsh')
      if (d.ok !== true) bad.push(['反引号致整行 ok:false（缺陷①未修）', n, JSON.stringify(d.reason)])
      else if (d.segments.length !== wantSegs) {
        bad.push(['分段数不符', n, 'want=' + wantSegs, 'got=' + d.segments.length,
          JSON.stringify(d.segments.map((s) => s.text))])
      }
    }
    // 奇偶性指纹：0…6 个反引号**一律** ok:true（旧缺陷下奇数是 false）
    for (let k = 0; k <= 6; k += 1) {
      const c = 'Write-Output "x' + (BT + 'n').repeat(k) + '"'
      const d = decomposeCommand(c, 'pwsh')
      if (d.ok !== true) bad.push(['反引号个数的奇偶性未消除', k + ' 个', JSON.stringify(d.reason)])
    }
    // 反向：bash 侧反引号**仍是**命令替换（方言矩阵的另一格不得被误伤）
    for (const c of ['echo ' + BT + 'date' + BT, 'rm -rf ./build ' + BT + 'date' + BT]) {
      const d = decomposeCommand(c, 'bash')
      if (d.ok !== true) bad.push(['bash 反引号命令替换被误伤', c, JSON.stringify(d.reason)])
      const seg = d.ok ? d.segments[0] : null
      if (!seg || !seg.opaque) bad.push(['bash 反引号未标 opaque', c, JSON.stringify(seg && seg.opaque)])
    }
    // 反向：pwsh 侧**真语法错误**仍须 ok:false（fail-closed 不得被放宽）
    //   实测官方解析器：空白后的孤立反引号 / 引号内未闭合 → `IncompleteString`
    for (const c of ['Get-ChildItem ' + BT, 'Write-Output "abc' + BT, 'echo a ; ' + BT]) {
      const d = decomposeCommand(c, 'pwsh')
      if (d.ok !== false) bad.push(['pwsh 真语法错误被放宽（应 ok:false）', c, JSON.stringify(d)])
    }
    // 反向：pwsh 侧**合法**的行尾紧贴反引号仍须 ok:true（`` `date` `` 收尾那个是字面反引号）
    for (const c of ['Write-Output abc' + BT, BT + 'date' + BT]) {
      const d = decomposeCommand(c, 'pwsh')
      if (d.ok !== true) bad.push(['pwsh 行尾字面反引号被误判为错误', c, JSON.stringify(d.reason)])
    }

    // ── ①′ 引号外的 `` ` `` + 换行：切不切，判据是「**前一个词元**是否已完结」──────────
    // ⚠️ 旧判据取错了维度：用「反引号**前一个字符**是不是词元分隔符」（`PWSH_TOKEN_BREAK`，
    //    只含 `\s;|&(){},'"`），于是字母 / 数字 / `]` / `.` 收尾的词元全部漏判。官方解析器
    //    `[Parser]::ParseInput` + 实参绑定逐格实测（无 CR，逐条看过 token 表）：
    //
    //      ── A. 已完结的完整词元 ⇒ 必须切（旧判据全部漏判 = 真 fail-open）──
    //      · **Parameter 词元**（`-NoNewline` / `-Recurse` / `-NoEnumerate` / `-Verbose` /
    //        `-Force` / `-WhatIf`）：token 是 `Parameter[-NoNewline`]`（反引号**并进参数名**）、
    //        **没有** LineContinuation，但 `[Parser]` 报 **2 条 PipelineAst** = **语句边界**。
    //        实参绑定是决定性证据：`& probe.ps1 -NoNewline` + `` ` `` + NL + `C:/Windows2`
    //        → `N=1`、`A[0]=[-NoNewline`]`，随后 `C:/Windows2` 被当作**新命令**执行
    //        （`The term 'C:/Windows2' is not recognized…`）。⇒ 必须 `flushSegment()`。
    //        ⚠️ 改用 `flushWord()` 实测端到端**仍然 `allow`**（两行同段），等于没修。
    //      · **成员 / 下标 / 静态成员访问**（`$x.Name` / `$a[0]` / `$h["k"]` /
    //        `$env:TEMP.Length` / `"abc".Length` / `(Get-Item x).Name`）：官方解析器实测是
    //        `LineContinuation`，与空格形**逐字同值**（同一条语句）⇒ `flushWord()`。
    //      · `-Confirm:` 这类**带冒号收尾**的 Parameter：同样是 `LineContinuation`、
    //        **同一条语句** ⇒ `flushWord()`。它与整词 Parameter 的差别正是修法的核心：
    //        **Parameter 族是语句边界，`-Confirm:` 是词元边界**，两者不同级。
    //
    //      ── B. 首字符是普通字符 ⇒ 必须粘住（旧判据此处本就正确，不得改动）──
    //      裸词 `C:/Windows`、简单变量 `$TARGET` / `$x` / `${x}` / `$env:TEMP`、`abc]`、
    //      `a.b`、`x$y.y`：官方解析器实测都是**一个** `Generic` 词元（反引号是**字面**字符）。
    //      ⚠️ 不得把 `$TARGET` 这类简单变量切开 —— 那是把方向从 fail-open 翻成误报。
    //
    // 缺 A 族时两行被粘成一个词元 `C:/Windows-Confirm:$false` / `-NoNewlineC:/Windows2`，
    // `blast` 由 `system` 掉成 `unknown`、档位由 `wide` 掉成 `unknown` ⇒ 破坏性子设置与
    // deny 例外双双失明：
    //   大分类 allow + `wide`=deny                 → HEAD `deny` → 无守卫时 **`ask`**（降级）
    //   大分类 allow + `wide`=deny + `unknown`=allow → HEAD `deny` → 无守卫时 **`allow`**（静默放行）
    //   对照（无反引号）：HEAD / PRE / NOW 均 `deny`。
    // ⚠️ 没有本组时，把守卫那行删掉（= 回退本轮修法）本组**仍全绿**（实测变异 M1）——
    //    故这是**必需**语料。A 族与 B 族**都必须钉**：只钉 A 会让「切过头」无声通过，
    //    只钉 B 会让 fail-open 无声通过。
    {
      const NL = '\n'
      // 引号串之后 —— 换行是**词元边界**（`-Confirm:` 单独成词元）
      for (const c of ['Remove-Item -Recurse -Force "C:/Windows"' + BT + NL + '-Confirm:$false',
        'Remove-Item -Recurse -Force "C:/Windows"' + BT + '\r\n-Confirm:$false']) {
        const d = decomposeCommand(c, 'pwsh')
        const w = d.ok ? d.segments[0].words : null
        if (!w || w.indexOf('-Confirm:$false') === -1) {
          bad.push(['反引号+换行未切词元（引号外，紧贴引号串）', c, JSON.stringify(w)])
        }
      }
      // 成员 / 下标访问族之后 —— 同一条语句内的**词元边界**（`-Confirm:` 单独成词元）。
      //   官方解析器实测这一族与引号串同为 `LineContinuation`（逐字同值），旧判据全部漏判。
      for (const c of ['Remove-Item -Force $item.FullName' + BT + NL + '-Confirm:$false',
        'Remove-Item -Force $arr[0]' + BT + NL + '-Confirm:$false',
        'Remove-Item -Force "C:/Windows".Length' + BT + NL + '-Confirm:$false',
        'Remove-Item -Force (Get-Item C:/Windows).FullName' + BT + NL + '-Confirm:$false',
        // ⚠️ 本轮的**下标支**改成了手写线性判定（`bracketAccessorTailAt`，见该函数说明）——
        //    它若写错会**改语义**（不是只改性能）。这两格钉的正是「不得图省事改成
        //    `[^\[\]]*`」那一族：官方解析器实测 `$v_.xx][xx.[x]` / `$vx[a0.[.]` 的方括号
        //    内容是**嵌套/含 `[`** 的，`[^\[\]]*` 口径会让这一族由「切开」退回「粘住」
        //    （实测词元由 `[…,'$v_.xx][xx.[x]','-Confirm:$false']` 变成
        //    `[…,'$v_.xx][xx.[x]-Confirm:$false']`）。
        //    ⚠️ 实测这两个**词元级**差异在全部八档 × 多种配置下 action 均不翻转
        //    （粘住后目标仍是动态词元 ⇒ blast 两侧同为 unknown），故它不是 fail-open 面，
        //    但它是**判据等价性**面：改法只有这一种写法能同时满足「线性」与「与原正则等价」。
        'Remove-Item -Force $v_.xx][xx.[x]' + BT + NL + '-Confirm:$false',
        'Remove-Item -Force $vx[a0.[.]' + BT + NL + '-Confirm:$false']) {
        const d = decomposeCommand(c, 'pwsh')
        const w = d.ok ? d.segments[0].words : null
        if (!w || w.indexOf('-Confirm:$false') === -1) {
          bad.push(['反引号+换行未切词元（成员/下标访问族）', c, JSON.stringify(w)])
        }
      }
      // **Parameter 词元**之后 —— 换行是**语句边界**（`[Parser]` 报 2 条 PipelineAst，
      //   第二行的裸词成为**新命令**）。⚠️ 判据是**段数**（`flushSegment`），不是词元数：
      //   写成「`-Confirm:$false` 是否单独成词元」会漏掉本族（本族第二行是裸词、不是参数）。
      for (const c of ['Write-Host -NoNewline' + BT + NL + 'Remove-Item -Recurse -Force C:/Windows',
        'Get-ChildItem -Recurse' + BT + NL + 'Remove-Item -Recurse -Force C:/Windows']) {
        const d = decomposeCommand(c, 'pwsh')
        if (!d.ok || d.segments.length !== 2) {
          bad.push(['反引号+换行未切语句（Parameter 族）', c,
            JSON.stringify(d.ok ? d.segments.map((s) => s.words) : d.reason)])
        }
      }
      // **带冒号收尾的 Parameter**（`-WhatIf:` / `-Confirm:` / `-ErrorAction:`）—— 与整词
      //   Parameter **不同级**：官方解析器实测 `Parameter[-WhatIf:]` + **`LineContinuation`**
      //   = **词元边界、同一条语句**（`stmts=1`）。这一格正是本修法的核心区分所在，
      //   且**与上面的 Parameter 族互为反向**：把两者合并成同一条判据，必然错一族。
      for (const c of ['Remove-Item -Recurse -Force -WhatIf:' + BT + NL + '-Confirm:$false',
        'Remove-Item -Recurse -Force -Confirm:' + BT + NL + '-Confirm:$false']) {
        const d = decomposeCommand(c, 'pwsh')
        const w = d.ok ? d.segments[0].words : null
        if (!d.ok || d.segments.length !== 1 || !w || w.indexOf('-Confirm:$false') === -1) {
          bad.push(['冒号收尾 Parameter 未按词元边界切开', c,
            JSON.stringify(d.ok ? d.segments.map((s) => s.words) : d.reason)])
        }
      }
      // ── Parameter 词元的**字符类宽度**（本轮修复：旧字符类窄 17 格）─────────────────
      // 判据「`-x<c>y` + 反引号 + 换行 是**语句边界**（`stmts=2`、第二行独立执行）」，由
      // `PWSH_PARAMETER_TOKEN` 的字符类决定。旧字符类 `[A-Za-z_]` / `[A-Za-z0-9_/-]`
      // 实测漏判 16 格词身 + 1 格首字符（`?`）、误判 0 格 —— 端到端是**真 fail-open**：
      // 实测 `cmd /c ver -Path$p` + 反引号 + NL + `Remove-Item -Recurse -Force C:/Windows`
      // 在大分类 allow 下旧字符类给 **`allow`**（第二行被吞成第一行的参数、不再单独判档），
      // 用户显式配的 deny 例外 `remove-item *` 下同样 `allow`。
      // ⚠️ 没有本组时，把字符类改回 `[A-Za-z_][A-Za-z0-9_/-]*` 本组**不红**
      // （实测变异：该形态全库零覆盖）—— 故这是**必需**语料。
      // 逐格真值由官方解析器 33..126 两轮扫描得到（token 表 + `PipelineAst` 语句数），
      // 故这里按**字符类**钉而不是抽样：漏掉任意一格都说明字符类又窄了。
      for (const w of ['-Path$p', '-Filter*', '-Name$n', '-Include*',   // AI 生成 pwsh 的常见写法
        '-x!y', '-x~y', '-x\\y', '-x]y', '-x^y', '-x=y', '-x+y', '-x@y', '-x`y', '-x0y',
        '-?y']) {                                                       // 首字符 `?`（PS 实测 STMT）
        const c = 'cmd /c ver ' + w + BT + NL + 'Remove-Item -Recurse -Force C:/Windows'
        const d = decomposeCommand(c, 'pwsh')
        if (!d.ok || d.segments.length !== 2) {
          bad.push(['Parameter 词元字符类过窄（未判成语句边界）', w,
            JSON.stringify(d.ok ? d.segments.map((s) => s.words) : d.reason)])
        }
      }
      // 反向：**粘住族**必须仍是一段（PS 实测 `Parameter[-x`]` + `Generic[y`+NL+`…]` 粘成一个
      //   词元；`-1` / `-` / `--force` 根本不是 Parameter）。
      //   ⚠️ 这一半与上面同等重要：字符类「扩宽」时最容易连带把粘住族一起吞进来
      //   （实测把 `[` `.` `:` `,` 加进去即误判）。
      for (const w of ['-x[y', '-x.y', '-x:y', '-x,y', '-1', '-', '--force']) {
        const c = 'cmd /c ver ' + w + BT + NL + 'Remove-Item -Recurse -Force C:/Windows'
        const d = decomposeCommand(c, 'pwsh')
        if (!d.ok || d.segments.length !== 1) {
          bad.push(['Parameter 词元字符类过宽（粘住族被误切）', w,
            JSON.stringify(d.ok ? d.segments.map((s) => s.words) : d.reason)])
        }
      }
      // ⚠️ 这里**不**钉 COLON 族（`-x!y:` / `-x$y:`）：实测本次修复前后**同值**（两个常量都
      //   不命中 ⇒ 都走真续行），钉了只是把「本实现与 PS 有别」这一**既有**反向误差焊进测试
      //   （PS 实测那两格是 `Parameter[-x!y:]` + `LineContinuation`，本实现判成一个词元）。
      //   本次的约束「不要顺手扩 COLON 族」由代码里两个常量**分开**来保证 ——
      //   要钉也该钉那条常量的**行为**，而它现在的行为本身就不等于 PS 真值，没有可钉的判据。
      // 端到端授权方向：这一族不得让 deny 失明（判据取「不得为 allow」，与上文同风格）
      {
        const dsWideDeny = Object.assign({}, hooks({ category: 'allow' }), { destructive: () => ({ wide: 'deny' }) })
        const dsWideDenyUnknownAllow = Object.assign({}, hooks({ category: 'allow' }),
          { destructive: () => ({ wide: 'deny', unknown: 'allow' }) })
        const excDeny = Object.assign({}, hooks({ category: 'allow', exceptions: ['remove-item *'], excAction: 'deny' }))
        for (const [cn, h] of [['wide=deny', dsWideDeny], ['wide=deny+unknown=allow', dsWideDenyUnknownAllow],
          ['例外 remove-item * = deny', excDeny]]) {
          for (const w of ['-Path$p', '-Filter*', '-Name$n', '-Include*']) {
            const c = 'cmd /c ver ' + w + BT + NL + 'Remove-Item -Recurse -Force C:/Windows'
            const a = assessCommand(c, 'pwsh', h).action
            if (a === 'allow') bad.push(['Parameter 字符类过窄致 deny 被静默绕过（fail-open）', cn, w, a])
          }
        }
      }
      // 反向：**裸词**后是字面反引号 —— 两行仍属**同一个**词元（官方解析器实测 `Generic`，
      //   即不得把 `-Confirm:$false` 切成独立词元）
      for (const c of ['Remove-Item -Recurse -Force C:/Windows' + BT + NL + '-Confirm:$false',
        // ⚠️ 简单变量 / `${x}` / `abc]` / `a.b` / `x$y.y` 与裸词同族（PS 真值**粘住**）：
        //    切开它们是把方向从 fail-open 翻成误报，故一并钉住。
        'Remove-Item -Force $TARGET' + BT + NL + '-Confirm:$false',
        'Remove-Item -Force ${x}' + BT + NL + '-Confirm:$false',
        'Remove-Item -Force abc]' + BT + NL + '-Confirm:$false',
        'Remove-Item -Force a.b' + BT + NL + '-Confirm:$false',
        'Remove-Item -Force x$y.y' + BT + NL + '-Confirm:$false',
        // ⚠️ **opaque 构造 + 空白 + 访问器后缀**（`(Get-Item x) .Name`）：官方解析器实测
        //    `Generic[(Get-Item x) .Name`+NL+`-Confirm:$false]` —— 空白已把词元**终结**，
        //    下一段 `.Name` 是**新的普通词元**（首字符是 `.`，不是 typed 构造）⇒ 仍**粘住**。
        //    这一格钉的是「`tokenTyped` 必须在 `flushWord` 的**早退**路径也复位」：
        //    opaque 构造不设 `started`，只在正常路径复位会让标记跨过空白泄漏到 `.Name` 上，
        //    于是 `.Name` 被误判成 typed 词元而多切一刀（实测变异 M10：误切）。
        'Remove-Item -Force (Get-Item x) .Name' + BT + NL + '-Confirm:$false',
        'Remove-Item -Force (Get-Item x) [0]' + BT + NL + '-Confirm:$false']) {
        const d = decomposeCommand(c, 'pwsh')
        const w = d.ok ? d.segments[0].words : null
        if (!w || w.indexOf('-Confirm:$false') !== -1) {
          bad.push(['裸词后的字面反引号被误当边界', c, JSON.stringify(w)])
        }
      }
      // 反向：**真续行**（反引号前面是词元分隔符）不得被切成两个词元
      {
        const c = 'Get-ChildItem ' + BT + NL + '-LiteralPath .'
        const d = decomposeCommand(c, 'pwsh')
        const w = d.ok ? d.segments[0].words : null
        if (!w || w.indexOf('-LiteralPath') === -1) {
          bad.push(['真续行被误切词元', c, JSON.stringify(w)])
        }
      }
      // **分组块族 / 孤立闭合符族**之后 —— 同属 `LineContinuation`（词元边界、同一条语句）。
      //   官方解析器实测：`… RParen[)] LineContinuation[`+NL+`] Generic[C:/Windows]`、`stmts=1`；
      //   实参绑定 `& probe @(1)` + `` ` `` + NL + `ZZZ` → **N=2**（与空格形 `@(1) ZZZ` 同值）。
      //   ⚠️ 这一族是**第十轮修复新引入的回退**：判据由「反引号前一**字符**是不是
      //   `PWSH_TOKEN_BREAK`」换成「前一**词元**是否已完结」后，分组块**只写 `segText`、
      //   不写 `wordText`**，于是两个尾部判据都看不到它 ⇒ 回退成「粘住」（第十轮前是切开的，
      //   因为 `)` / `}` 恰在 `PWSH_TOKEN_BREAK` 里）。
      //   实测（`@(x)` + 反引号 + NL + `C:/Windows`）：词元由
      //   `[…,'@','C:/Windows']`（PRE）变成 `[…,'@C:/Windows']`（回退后），
      //   `blast` 由 `system` 掉成 `unknown` ⇒ 破坏性子设置与 deny 例外双双失明。
      //   ⚠️ 没有本组时，把 `lastGroupClose === index - 1` 那一项删掉（= 回退本次修复）
      //   本组**不红**（该格在别处无覆盖）——故这是**必需**语料。
      for (const c of ['Remove-Item -Recurse -Force @(x)' + BT + NL + 'C:/Windows',
        'Remove-Item -Recurse -Force @("C:/Windows")' + BT + NL + 'C:/Windows',
        'Remove-Item -Recurse -Force @{a=1}' + BT + NL + 'C:/Windows',
        'Remove-Item -Recurse -Force a(x)' + BT + NL + 'C:/Windows',
        'Remove-Item -Recurse -Force x{y}' + BT + NL + 'C:/Windows',
        'Remove-Item -Recurse -Force Get-Item(x)' + BT + NL + 'C:/Windows',
        'Remove-Item -Recurse -Force a(b(c))' + BT + NL + 'C:/Windows',
        'Remove-Item -Recurse -Force @{}' + BT + NL + 'C:/Windows',
        // 孤立闭合符族（同一条根因：`abc)` / `a}` 同样只在 `PWSH_TOKEN_BREAK` 里）
        'Remove-Item -Recurse -Force abc)' + BT + NL + 'C:/Windows',
        'Remove-Item -Recurse -Force a}' + BT + NL + 'C:/Windows']) {
        const d = decomposeCommand(c, 'pwsh')
        const w = d.ok ? d.segments[0].words : null
        if (!w || w[w.length - 1] !== 'C:/Windows') {
          bad.push(['反引号+换行未切词元（分组块 / 孤立闭合符族）', c, JSON.stringify(w)])
        }
      }
      // 反向：分组块的**粘住子族**（收尾符之后还有字符）不得被误切。
      //   官方解析器实测 `a(x)y` / `@(x)z` / `(x)$y` 都是**一个** `Generic[y`+NL+`…]`
      //   （反引号是字面字符）。位置判据（`lastGroupClose === index - 1`）天然排除它们；
      //   若改成对 `segText` 裸判 `/[)}]$/`，这一族会被误切（且 `${x}` 同样中招）。
      for (const c of ['Remove-Item -Recurse -Force a(x)y' + BT + NL + 'C:/Windows',
        'Remove-Item -Recurse -Force @(x)z' + BT + NL + 'C:/Windows',
        'Remove-Item -Recurse -Force ' + '$' + '{x}' + BT + NL + 'C:/Windows']) {
        const d = decomposeCommand(c, 'pwsh')
        const w = d.ok ? d.segments[0].words : null
        if (!w || w[w.length - 1] === 'C:/Windows') {
          bad.push(['分组块粘住族被误切', c, JSON.stringify(w)])
        }
      }
      // **fd 号重定向**（`"5">out.txt`）—— `tokenTyped` 必须跨过重定向复位。
      //   fd 号分支**绕过 `flushWord()`**（它只清 `wordText` / `started`），故漏了 `tokenTyped`
      //   的复位会让标记泄漏到**目标**上：`out.txt` 被 `PWSH_ACCESSOR_TAIL` 的
      //   `\.[A-Za-z_]\w*$` 误判成成员访问 ⇒ 多切一刀。
      //   实测（`"5">out.txt` + 反引号 + NL + `Remove-Item …`）：`writeTargets` 由
      //   `['out.txtRemove-Item']` 变成 `['out.txt']`，第二行另起一段。
      //   ⚠️ 官方解析器实测该行是**一个** `Generic[out.txt`+NL+`Remove-Item]`（**粘住**）
      //   ⇒ 那一刀是**误切**，方向是放宽（`category=deny` + `destructive={wide:allow}`
      //   实测由 `deny` 变 `allow`）。故本组钉的是「目标**粘住**」（与第十轮前同值；
      //   重定向目标处的续行语义本实现仍与 PS 有别，那是**既有**反向误差，非本次引入）。
      //   ⚠️ 没有本组时，把那行 `tokenTyped = false` 删掉本组**不红**（该形态全库无覆盖）。
      for (const c of ['"5">out.txt' + BT + NL + 'Remove-Item -Recurse -Force C:/Windows',
        '2>a.txt' + BT + NL + 'Remove-Item -Recurse -Force C:/Windows']) {
        const d = decomposeCommand(c, 'pwsh')
        const wt = d.ok ? d.segments[0].writeTargets : null
        if (!wt || wt.length !== 1 || wt[0] !== 'out.txtRemove-Item' && wt[0] !== 'a.txtRemove-Item') {
          bad.push(['fd 号重定向后的 tokenTyped 泄漏（目标被误切）', c, JSON.stringify(wt)])
        }
      }
      // 端到端授权方向：破坏性子设置与 deny 例外都不得因「粘成一个词元」而失明
      //
      // ⚠️ 端到端**只钉 Parameter 语句边界族**，理由是实测出来的（本机三态对拍）：
      //    · Parameter 族是**真 fail-open** —— 回退守卫时 `wide=deny` 下由 `deny` 变
      //      **`allow`（all-allow）**，因为第二行 `Remove-Item …` 被当成第一行 `Write-Host`
      //      的参数、不再单独判档。修好后回到 `deny`（segment-deny）。
      //    · 下标/成员访问族的修正是**语义级**的（与 PS 真值一致、与空格形逐字同值），
      //      **端到端 action 不翻转**：那一族的目标本身是动态词元（`$x.Name` / `$arr[0]`），
      //      粘住后 `$x.Name-Confirm:$false` **同样是**动态 ⇒ `blast` 两侧都是 `unknown`。
      //      故这里不钉它的 action（钉了也只是把配置语义钉死，不是承重面）——
      //      它的守护在上一段的**词元级**断言（回退守卫即红）。
      //    判据取「不得为 allow」而非「=== deny」（动作落点由配置决定，与本文件既有风格一致）。
      {
        const dsWideDeny = Object.assign({}, hooks({ category: 'allow' }), { destructive: () => ({ wide: 'deny' }) })
        const dsWideDenyUnknownAllow = Object.assign({}, hooks({ category: 'allow' }),
          { destructive: () => ({ wide: 'deny', unknown: 'allow' }) })
        for (const [cn, h] of [['wide=deny', dsWideDeny], ['wide=deny+unknown=allow', dsWideDenyUnknownAllow]]) {
          for (const c of ['Remove-Item -Recurse -Force "C:/Windows"' + BT + NL + '-Confirm:$false',
            'Remove-Item -Recurse -Force "C:/Windows"' + BT + '\r\n-Confirm:$false',
            // Parameter 语句边界族（第二行是**新命令**，必须自己走到档位判定）
            'Write-Host -NoNewline' + BT + NL + 'Remove-Item -Recurse -Force C:/Windows',
            'Get-ChildItem -Recurse' + BT + NL + 'Remove-Item -Recurse -Force C:/Windows',
            // 分组块族（同上：粘住时第二行的破坏性命令不再单独判档）
            'Remove-Item -Recurse -Force @(x)' + BT + NL + 'Remove-Item -Recurse -Force C:/Windows']) {
            const a = assessCommand(c, 'pwsh', h).action
            if (a === 'allow') bad.push(['续行判据缺失致 deny 被静默绕过（fail-open）', cn, JSON.stringify(c), a])
          }
        }
      }
    }

    // ── ② 假候选 label：**按方言分列**（方言维度即本轮修法的核心）────────────────────
    // ⚠️ 这一组此前把三条**混在同一门方言（pwsh）下**判「label 必须为空」，而其中
    //    `FOO=/usr/local/bin/myapp` 在 pwsh 里**根本不是赋值** —— 它是**真命令**：
    //    本机 PS 5.1 实测 `[Parser]::ParseInput('FOO=/usr/local/bin/myapp')` →
    //    `PipelineAst`、**cmdAst=1**、assignAst=0；建好 `FOO=\usr\local\bin\myapp.cmd`
    //    后 `& 'FOO=/usr/local/bin/myapp'` **RAN=True、rc=0**（无害替代目标，临时目录内）。
    //    故旧断言「它必须认不出」**建立在错误真值上**：pwsh 侧它必须产出 `myapp`，
    //    否则段级 `unparsable` ⇒ `destructive=false` ⇒ 破坏性子设置与**全部例外匹配**
    //    双双跳过 ⇒ 落大分类（**fail-open**）。bash 侧它**确实**是赋值（`NAME=value`），
    //    保持为空 —— 两门方言要求相反，故语料必须按方言分列，不能一刀切。
    //    判据归属见 shell-parse.js 的 `LEAD_ASSIGN`（bash）/ `LABEL_ASSIGN_PWSH`（pwsh）。
    //    ⚠️ **`$d=…` 这一格两门方言语义也相反**（本处此前建立在错误真值上）：Git Bash 5.3.15
    //    实测（`mktemp -d` 内建 `=X:/ws/demo/_tmp/file-test` 可执行文件，整行写进文件再
    //    source，RAN 证据写进独立日志）—— `$d='X:/ws/demo/_tmp/file-test'` 在 bash 下
    //    `$d` 先展开成**空串**，词成了 `='X:/ws/demo/_tmp/file-test'`，是一次**真命令**执行
    //    （RAN 命中），故 label 是 `file-test`；只有 **pwsh** 下它才是真赋值（右侧带引号）。
    //    旧期望把 pwsh 侧的真值套到了 bash 上，两门方言都写成空串。
    for (const [c, wantBash, wantPwsh] of [
      // ⚠️ 只此一条**两门方言语义相反**：bash 真命令（`$d` 展开成空） / pwsh 真赋值
      ['$d=' + D, 'file-test', ''],
      // 两门方言下**都是**「没有命令要执行」→ label 必须为空
      ['"--- 编码/换行校验 ---"', '', ''],
      // ⚠️ 同样**两门方言语义相反**：bash 赋值 / pwsh 真命令（见上实测）
      ['FOO=/usr/local/bin/myapp', '', 'myapp'],
    ]) {
      for (const [sh, want] of [['bash', wantBash], ['pwsh', wantPwsh]]) {
        const d = decomposeCommand(c, sh)
        const labels = d.ok ? d.segments.map((s) => segmentLabel(s.words)) : []
        if (labels.some((x) => x !== want)) {
          bad.push(['假候选 label 未消除 / 方言维度不符（缺陷②未修）', sh, c, 'want=' + JSON.stringify(want), JSON.stringify(labels)])
        }
      }
    }
    // 反向：真命令名**一个都不能**被这条守卫误伤（含 `$`/`=` 落在路径前缀里的形态）
    //   ⚠️ 这一族是最容易修过头的地方：坏字符判据若落在**原始词元**上，
    //      `$x/rm` / `C:/my=dir/rm.exe` 会被一起拒掉 → 八档全 deny 下由 deny 变 **allow**。
    for (const c of ['/usr/bin/rm -rf x', 'C:\\Windows\\System32\\rm.exe -rf x', 'a/b/c',
      '$x/rm -rf /etc', '$env:TEMP/rm.exe -rf /etc', 'C:/my=dir/rm.exe -rf /etc',
      '"reg delete" HKLM\\X /f', '"C:/Program Files/My Tool.exe" -rf', 'Format-Table -AutoSize',
      // ⚠️ 本轮新增：**含空格的相对路径 + 两词命令名**。`DESTRUCTIVE_LABELS` 里有合法的
      //    两词命令名（`reg delete`），含空白是**正常形态**而不是「引号串」的特征 ——
      //    只按「剥路径后 basename 含空白」判会把这一族判成字符串字面量 ⇒ label 变空
      //    ⇒ 同一条 `unparsable → destructive=false → 落大分类` 失效链。
      //    实测（大分类 allow + reg 档 deny）：三格 bash/pwsh **deny → allow**（共 8 格）。
      //    该形态真实可执行：bash 实测 `"a b/reg delete" HKLM/X /f` 真的执行了
      //    `a b/reg delete`（无害替代目标，rc=0）。没有这一格时，把判据放宽回
      //    「含空白即引号串」会让本组**全绿**。
      '"a b/reg delete" HKLM\\X /f', '-x/reg delete HKLM\\X /f', '"-x/reg delete" HKLM\\X /f',
      // ⚠️ 本轮新增：**含空格的相对路径 + basename 既非破坏性命令名、也非两词命令名**。
      //    这一族是本守卫最容易整族误伤的形态（`looksLikeExplicitPath` 不认相对路径开头）：
      //    `"Program Files/My Tool.exe"` 剥路径后是 `my tool` —— 含空白、不在
      //    `DESTRUCTIVE_LABELS` 里 ⇒ 判成字符串字面量 ⇒ label 变空 ⇒ 同一条
      //    `unparsable → destructive=false → 落大分类` 失效链（危害**双向**：大分类 ask +
      //    allow 例外时由 allow 变 ask、例外失明；大分类 allow + deny 例外时由 deny 变
      //    **allow**，用户显式写的拒绝被静默绕过）。
      //    实测（无害替代目标）：`"Program Files/My Tool.exe" -rf ./x` HEAD=`my tool` /
      //    无本行守卫时 **`` 空串**；`"my tools/My App"` 在本机 pwsh 下真能执行
      //    （PATHEXT 解析到 `My App.cmd`，rc=0），故不能用「带可执行扩展名即放行」代替。
      //    ⚠️ 没有这三格时，把守卫整行删掉（= 回退本次修复）本组**仍全绿**（实测）。
      '"Program Files/My Tool.exe" -rf ./x', '"build tools/my script.ps1"', '"my tools/My App"',
      // ⚠️ 本轮新增（第四轮）：**`-` 开头的目录 + 含空格的 basename**。上一轮把守卫的适用
      //    范围收窄到「trim 后以 `-` 开头」时漏了这一族 —— 它**确实**以 `-` 开头，于是
      //    `/\s/.test(head)` 照样判真、label 变空，与 `"Program Files/My Tool.exe"` 是
      //    **同一个缺陷**（HEAD 都给得出 `my tool`），只是目录名以 `-` 开头才漏网。
      //    本机 pwsh 实测这一族**真实可执行**（rc=0）：`-x/rm.cmd`、`-x/My Tool.cmd`、
      //    `.\-x\My Tool.cmd`、`-x y/rm`、`.\-x y\rm.cmd` 都真的跑起来了
      //    （`"-x/My Tool.exe"` 形态由 PATHEXT 解析到 `-x\My Tool.cmd`）。
      //    实测（大分类 allow + 八档全 deny，无用户例外）：该族 HEAD/PRE 由 `my tool` 变
      //    `` 空串；大分类 ask + allow 例外 `my tool *` 时 HEAD allow(source=exception) →
      //    PRE ask(source=category)；大分类 allow + deny 例外 `my tool *` 时 HEAD
      //    deny(source=exception) → PRE **allow(source=category)**（fail-open，bash/pwsh 各一格）。
      //    ⚠️ 最后一格 `"-x y/My App"`（目录段与 basename **都**含空格）是中间那版修法
      //    （「第一个分隔符之前就有空白」）唯一漏掉的形态，实测它 HEAD=deny(exception) →
      //    该版 **allow(category)**；现版判据（`/^-+\s/`）已覆盖。
      //    ⚠️ 没有这两格时，把本轮的适用范围那一格删掉（= 回退本次修复）本组**仍全绿**（实测）。
      '"-x/My Tool.exe"', '"-x/My App"', '"-x y/My App"']) {
      const d = decomposeCommand(c, 'pwsh')
      const seg = d.ok ? d.segments[0] : null
      const lab = seg ? segmentLabel(seg.words) : ''
      if (!lab) bad.push(['真命令名被守卫误伤（认不出）', c, JSON.stringify(seg && seg.words)])
    }
    // ⚠️ 本轮新增（第四轮）：上一条只判「label 非空」，而**端到端授权方向**才是承重面 ——
    //    该族的危害是「用户为该命令写下的 deny 例外被静默绕过」。故必须把这一向也钉住：
    //    大分类 allow + 八档全 deny + 例外 `my tool *`=deny 时，两门方言都必须是 deny
    //    （PRE 实测 allow）。对照组取 `"Program Files/My Tool.exe" -rf ./x`（同族、目录名
    //    不以 `-` 开头）—— 它三态同值，证明本格测的是目录名那一维、不是别的分叉。
    //    ⚠️ 断言方向取「不得为 allow」而不是「=== deny」：动作落点由配置决定，测试不该把
    //    某个具体档位钉成语义（与本文件既有风格一致）；`=== 'deny'` 会随档位默认值漂移。
    {
      const dsAllDeny = { inside: 'deny', outside: 'deny', wide: 'deny', unknown: 'deny', proc: 'deny', power: 'deny', priv: 'deny', reg: 'deny' }
      // 例外模式**按命令的 basename 取**（`my tool *` / `my app *`）—— 写死单一模式会让
      // 语料里另一条命令匹配不上，断言随之空转（实测：`"-x y/My App"` 配 `my tool *` 时
      // 例外本就不该命中，那条断言测的不是本缺陷）。
      for (const [c, pat] of [['"-x/My Tool.exe" -rf ./x', 'my tool *'],
        ['"Program Files/My Tool.exe" -rf ./x', 'my tool *'],
        // 目录段与 basename 都含空格：中间那版修法唯一漏掉的形态（见上）
        ['"-x y/My App"', 'my app *'],
        // ⚠️ 本轮新增（第六轮）：**2+ 连字符开头的真实目录 + 收栏 basename** 的端到端授权方向。
        //    危害与上面 A 族同形（label 变空 ⇒ 段级 `unparsable` ⇒ `destructive=false` ⇒
        //    落大分类 ⇒ 用户显式写的 `rm *`=deny 被静默绕过），只是触发子族是 `--x` 族。
        //    实测三态（大分类 allow + `rm *`=deny，bash/pwsh 各一格）：
        //      HEAD=deny → PRE=**allow**（fail-open）→ 本轮修复后=deny。
        //    上一条只判「label 非空」是**不够**的：端到端授权方向才是承重面（同 A 族注释）。
        ['"--x/rm ---" -rf /data', 'rm *'],
        // ⚠️ 本轮新增（第九轮）：**单连字符收栏**子族（`"--- x/rm -"`）的端到端授权方向。
        //    与上一行 `"--x/rm ---"` 同族、同一条 fail-open 链，只差收栏的连字符数 ——
        //    成因是**同一个条件的两半用了两把尺子**：①的收栏判据用 `trailingDashRunAt(s, 1)`
        //    （min=1），而残名取自 `trailingDashRunAt(head, 2)`（min=2）；单连字符收栏时后者
        //    返回 -1 ⇒ 残名恒为 `''` ⇒ 「残名不是破坏性命令名」那一格成为**重言式**（恒真、
        //    等于没补）⇒ 整族被判成引号串 ⇒ label 变空 ⇒ 段级 `unparsable` ⇒
        //    `destructive=false` ⇒ 落大分类 ⇒ 用户显式写的 `rm *`=deny 被静默绕过。
        //    实测三态（大分类 allow + 八档全 deny + `rm *`=deny，bash/pwsh 各一格）：
        //      HEAD=deny → PRE=**allow**（fail-open）→ 第九轮修复后=deny（label 由 `""` 回到 `rm -`）。
        //    ⚠️ 该子族是**守卫第一版引入、第八轮未覆盖、相对 HEAD 的真回归**，且**已因缺语料
        //    回归过一次**；label 侧的同一格见下面「单连字符收栏」那段说明。
        ['"--- x/rm -" -rf /data', 'rm *'],
        ['"--tools/Remove-Item ---" -Recurse -Force C:/Windows', 'remove-item *'],
        // ⚠️ 本轮新增（第七轮）：**目录名本身就是「连字符串 + 空格」**那一族的端到端授权方向。
        //    与上面 A 族同形（label 变空 ⇒ 段级 `unparsable` ⇒ `destructive=false` ⇒ 落大分类
        //    ⇒ 用户显式写的 deny 例外被静默绕过），只是触发子族是「`-` + 空格」作目录名。
        //    实测三态（大分类 allow + `my app *`=deny，bash/pwsh 各一格）：
        //      HEAD=deny → PRE=**allow**（fail-open）→ 本轮修复后=deny。
        //    ⚠️ 与上行两格**路径分离**：那两格 `tailAt >= 0` 走 `fenced`，本格 `tailAt < 0`
        //    只被适用范围①拦下（见上「真实命令名一个都不能被误伤」那组语料的说明）。
        //    ⚠️ 没有本格时，把①的收栏那半格删掉本组**仍全绿**（实测变异 M3）。
        ['& \'--- x/My App\' -rf ./x', 'my app *']]) {
        const hExc = Object.assign(hooks({ category: 'allow', exceptions: [pat], excAction: 'deny' }),
          { destructive: () => dsAllDeny })
        for (const sh of ['bash', 'pwsh']) {
          const a = assessCommand(c, sh, hExc).action
          if (a === 'allow') bad.push(['deny 例外被空 label 静默绕过（fail-open）', c, sh, a])
        }
      }
    }
    // 反向：60j5 钉住的契约 —— `sudo A=/bin/rm` 的**档位**必须与 `sudo rm` 同值
    //   ⚠️ 契约的对象是 **tiers**，不是 label：赋值词元不是命令头（命令头是 `sudo`），
    //      故它**不得**按词元被拒。`segmentLabel(['sudo','A=/bin/rm'])` 本就是 `'sudo'`。
    //   ⚠️ 而 `A=/bin/rm` **单独成段**时确实没有命令要执行 → 认不出是对的（这正是缺陷②）。
    for (const [a, b] of [['sudo A=/bin/rm', 'sudo rm']]) {
      for (const sh of ['bash', 'pwsh']) {
        const ra = assessCommand(a, sh, hooks({ category: 'ask' }))
        const rb = assessCommand(b, sh, hooks({ category: 'ask' }))
        const ta = (ra.segments || []).flatMap((s) => s.tiers || []).join('+')
        const tb = (rb.segments || []).flatMap((s) => s.tiers || []).join('+')
        if (ta !== tb || ra.action !== rb.action) {
          bad.push(['赋值词元后的真命令档位分叉（60j5 契约）', a, 'vs', b, sh, ra.action + '|' + ta, rb.action + '|' + tb])
        }
      }
    }
    // 反向：纯赋值段**必须**认不出（没有命令要执行）—— 与上面那条是同一判据的两侧
    // ⚠️ **但「纯赋值」本身是方言相对的**（本批修法的核心）：只有**带 `$`** 的形态
    //    在两门方言下都是赋值；**不带 `$`** 的 `A=/bin/rm` 只在 **bash** 下是赋值，
    //    在 **pwsh** 下是**真命令** —— 本机 PS 5.1 实测
    //    `[Parser]::ParseInput('A=/bin/rm')` → `PipelineAst`、**cmdAst=1**、assignAst=0，
    //    且建好 `A=\bin\rm.cmd` 后 `& 'A=/bin/rm'` **RAN=True、rc=0**（无害替代目标）。
    //    故旧断言「pwsh 下 `A=/bin/rm` 必须认不出」**建立在错误真值上**，已按方言订正：
    //    pwsh 侧必须产出 `rm`，否则段级 `unparsable` ⇒ `destructive=false` ⇒
    //    破坏性子设置与全部例外匹配双双跳过 ⇒ 落大分类（fail-open）。
    for (const [c, wantBash, wantPwsh] of [
      ['A=/bin/rm', '', 'rm'],
      // ⚠️ `$d=…` 是**带 `$` 前缀**的形态：bash 下 `$d` 先展开成空串 ⇒ 词成了 `=…`，
      //    是一次**真命令**（Git Bash 实测 RAN，见上第 ② 组语料的说明）⇒ label 非空；
      //    pwsh 下它才是真赋值 ⇒ label 空。旧期望（两门方言都空）建立在错误真值上。
      ['$d=' + D, 'file-test', ''],
    ]) {
      for (const [sh, want] of [['bash', wantBash], ['pwsh', wantPwsh]]) {
        const d = decomposeCommand(c, sh)
        const lab = d.ok ? segmentLabel(d.segments[0].words) : ''
        if (lab !== want) {
          bad.push(['纯赋值段仍产出命令名 / 方言维度不符', sh, c, 'want=' + JSON.stringify(want), JSON.stringify(lab)])
        }
      }
    }

    // ── ②′ 前导 `-` 的原始词元不是命令名（选项），但 `./-foo` 这类**路径形态**要保住 ──
    // `"--- encoding check ---"` 不含路径分隔符，故引号判据（要求含分隔符）拦不住它，
    // 整串会成 label、弹窗给出永不命中的「允许此项」按钮。前导 `-` 是它的判别特征。
    // ⚠️ 判据必须落在**原始词元**：`./-foo` 剥路径后是 `-foo`，那是合法可执行文件。
    for (const c of ['"--- encoding check ---"', '"--- 编码/换行校验 ---"', '-rf', '--help', '-',
      // ⚠️ **首尾带空白**的同族串（引号**内**的空白被词法器逐字保留，实测
      //    `"  --- 编码/换行校验 ---"` → 词元 `  --- 编码/换行校验 ---`）。守卫适用范围
      //    第一格是 `/^-+\s/.test(t.trim())`，不 trim 时前导空白让它失配、这一格 label
      //    变 `换行校验 ---`（假候选复活）。
      //    ⚠️ 没有这一格时，把 `.trim()` 去掉本组**仍全绿**（实测）。
      '"  --- 编码/换行校验 ---"',
      // ⚠️ 本轮新增：适用范围**第二格**（装饰性开栏 + 装饰性收栏）钉住的形态 ——
      //    连字符串后面**不是空白**而是字母/汉字，空白落在 basename 里。
      //    第一格 `/^-+\s/` 对它们整族失配（`---编码` 后面紧跟的是汉字，不是空白），
      //    故此前整族漏回假候选：label 非空 ⇒ 弹窗产出永不命中的「允许此项」按钮。
      //    ⚠️ 没有这几格时，把第二格整条删掉本组**仍全绿**（实测，本轮变异测试）。
      '"---编码/换行校验 ---"', '"---encoding/my check ---"',
      '"--note/my check ---"', '"-编码/换行校验 ---"']) {
      const d = decomposeCommand(c, 'bash')
      const lab = d.ok ? segmentLabel(d.segments[0].words) : null
      if (lab !== '') bad.push(['前导 - 的词元仍产出命令名', c, JSON.stringify(lab)])
    }
    // ⚠️ 同上，但**方言是 pwsh**：用户真实命令里的 `` `n `` 变体正是此形态
    //    （`"` + 反引号 n + `--- 编码/换行校验 ---` + 反引号 n + `"`，pwsh 实测词元为
    //    `\n--- 编码/换行校验 ---\n` —— 前导换行让 `/^-/` 失配，故 `.trim()` 在这里承重；
    //    bash 侧反引号是字面量、词元不含换行，同一格不承重，故必须单独按 pwsh 钉）。
    //    ⚠️ 这里**只放含路径分隔符**的形态：`"  --- encoding check ---"` 不含分隔符，
    //    根本走不到本守卫（第一格 `/[\\/]/` 就早退），它的 label 由 `segmentLabelFrom`
    //    那条**不 trim** 的前导 `-` 守卫决定 —— 那是既有的另一处口径，与本轮修法无关，
    //    不要在这里钉它（实测该格在 HEAD / PRE / NOW 三态同值）。
    //    ⚠️ 第二条（`---编码…`，连字符串后**不跟空白**）钉的是适用范围**第二格**：
    //    它在 HEAD 本为空、在本次修法**之前**变 `换行校验 ---`（本轮缺陷），故它同时是
    //    「第二格没被回退」与「没有把 PRE 拦下的假候选放回来」两件事的承重语料。
    for (const c of ['"' + String.fromCharCode(96) + 'n--- 编码/换行校验 ---'
      + String.fromCharCode(96) + 'n"',
    '"' + String.fromCharCode(96) + 'n---编码/换行校验 ---' + String.fromCharCode(96) + 'n"']) {
      const d = decomposeCommand(c, 'pwsh')
      const lab = d.ok ? segmentLabel(d.segments[0].words) : null
      if (lab !== '') bad.push(['前导 - 的词元仍产出命令名（pwsh）', c, JSON.stringify(lab)])
    }
    for (const [c, want] of [['./-foo', '-foo'], ['X:/-foo', '-foo'], ['/usr/bin/-foo', '-foo'],
      // ⚠️ 本轮新增：`-` 开头**且含路径分隔符**的是**真实可执行的相对路径命令**（目录名以 `-`
      //    开头），不是选项。只按「以 `-` 开头」判会让它们 label 变空 ⇒ 段级 `unparsable`
      //    ⇒ `segmentLabelsCore` 的 labels 为空 ⇒ `destructive=false` ⇒ 破坏性子设置与全部
      //    例外匹配双双跳过 ⇒ 落大分类。实测（无害替代目标，临时目录内）：
      //      pwsh：`-x/Remove-Item -Recurse -Force C:/Windows` 真的执行了 `-x\Remove-Item.cmd`
      //      bash：`"a b/reg" delete HKLM/X /f` 真的执行了 `a b/reg`（rc=0）
      //    这两格钉的是**根因**（label 提取），而危害链的端到端形态由既有 54 系列覆盖。
      //    没有它们时：把判据放宽回「只判 `-` 开头」会让本组**全绿**（实测 44 格 deny→allow）。
      ['-x/rm -rf /etc', 'rm'], ['-rf/rm -rf /', 'rm'],
      // ⚠️ 本轮新增：`"-x/rm ---"` —— 本轮适用范围第二格的**反例**（承重）。
      //    它的 basename 同样以连字符串收尾，故只按「收栏」判会把它误当引号串；
      //    而它剥路径后是**真实可执行文件**：实测（无害替代目标，本机 pwsh、临时目录内）
      //    `-x/rm ---.cmd` 真的跑起来了（rc=0，PATHEXT 解析），即它与上面 A 族同族。
      //    ⚠️ 没有这一格时，把开栏条件去掉本组**仍全绿**（实测，本轮变异测试），
      //    而危害是 fail-open：label 变空 ⇒ 段级 `unparsable` ⇒ `destructive=false` ⇒
      //    落大分类，用户显式写的 `rm *`=deny 例外随之失明（大分类 allow + `rm *`=deny 时
      //    HEAD/PRE 均为 deny → 去掉开栏条件变 **allow**）。
      //    同族再补两格开栏是「真实目录名」的形态（`-` 与 `--` 作目录名）：
      ['"-x/rm ---"', 'rm ---'], ['"-/rm ---"', 'rm ---'], ['"--/rm ---"', 'rm ---'],
      // ⚠️ 本轮新增（第六轮）：**2+ 连字符开头的真实目录 + 收栏 basename**。
      //    上一版适用范围第二格写作 `dash > 1 || !/[A-Za-z0-9]/.test(next)` —— `dash > 1`
      //    时整格**恒真**，把「连字符串后是不是字母/数字」这条判据整体短路掉，于是
      //    `--x`、`--tools`、`--bin`、`--9`、`--x y` 这些**真实目录**开头的词元整族被
      //    判成引号串 ⇒ label 变空 ⇒ 段级 `unparsable` ⇒ `destructive=false` ⇒ 落大分类
      //    ⇒ 用户显式写的 `rm *`=deny 例外失明（fail-open）。三态实测（无害替代目标，
      //    大分类 allow + `rm *`=deny，bash/pwsh 各一格）：HEAD=deny → PRE=**allow** →
      //    本轮修复后=deny（label 由 `""` 回到 `rm ---`）。
      //    真实可执行性实测（本机 pwsh、TEMP 内、PATHEXT 解析，rc=0）：
      //      `& "--x/rm ---"`、`& "--x y/rm ---"`、`& "--x/tool ---"` 都真的跑起来了
      //      （解析到 `--x\rm ---.cmd` 等），故这一族与 `"-x/rm ---"` 同族、是**真命令**。
      //    ⚠️ 没有这五格时，本轮修法**整条回退**（恢复 `dash > 1 ||` 短路）本组**仍全绿**
      //    （实测变异 R1：shell-parse / regressions 双双 ALL PASS）—— 上面那三格反例
      //    对本轮新口子**零覆盖**（把 `dash > 1` 改成 `dash > 5` 时它们也全绿）。故这五格
      //    是**必需**语料，不是「为钉而钉」。
      //    ⚠️ `--x/reg delete ---` 单独承重：它剥掉收栏后是**两词命令名** `reg delete`，
      //    而「残名是单个可打印 ASCII 词」那半格判不出它（含空白）—— 少了
      //    `DESTRUCTIVE_LABELS` 那半格，这一格 label 会变空（实测：只留词形判据时
      //    `--x/reg delete ---` label=`""`，而 HEAD=`reg delete ---`）。
      ['"--x/rm ---"', 'rm ---'], ['"--tools/Remove-Item ---"', 'remove-item ---'],
      ['"--bin/del ---"', 'del ---'], ['"--x y/rm ---"', 'rm ---'], ['"--9/rm ---"', 'rm ---'],
      ['"--x/reg delete ---"', 'reg delete ---'],
      // ⚠️ 非破坏性的真实命令，承重的是「残名判据取**词形**」那一半：
      //    只留 `DESTRUCTIVE_LABELS` 那半格时这一格 label 变空（实测：残名判据退化成
      //    只查名单时，本族 96 格由非空变空，`--x/tool ---`、`--x/git ---`、`--x/node ---`
      //    全在内）。而它是**真命令**：实测（TEMP 内、PATHEXT 解析）`& "--x/tool ---"`
      //    rc=0，解析到 `--x\tool ---.cmd`。危害同族：用户写的 `tool --- *`=deny 例外失明。
      //    没有这一格时，把残名判据简化成「只查 `DESTRUCTIVE_LABELS`」本组**仍全绿**（实测 R4）。
      ['"--x/tool ---"', 'tool ---'],
      // ⚠️ 承重的是「**真实目录名开栏**」那一半（`dash === 1 && 字母/数字`）：
      //    `-x/my tool ---` 的残名是**含空白的非破坏性命令名** `my tool`，过不了「单个词」
      //    那格、也不在名单里 —— 少了开栏那半格它会被判成引号串（实测：`plainDirLead`
      //    恒假时本族 70 格由非空变空）。而它是**真命令**：`-x/my tool ---` 与既有语料
      //    `"-x/My Tool.exe"`（label `my tool`）同族，只是尾巴多几个连字符。
      //    没有这一格时，删掉开栏那半格本组**仍全绿**（实测 R3）。
      ['"-x/my tool ---"', 'my tool ---'],
      // ⚠️ 本轮新增（第七轮）：**目录名本身就是「连字符串 + 空格」**的真实命令。
      //    它们 `tailAt < 0`（basename 不以连字符串收尾）、`fenced === false`，
      //    **只**被适用范围①拦下 —— 而①此前只要求「连字符串 + 空白开头」，比②**宽半格**，
      //    于是整族被判成引号串 ⇒ label 变空 ⇒ 段级 `unparsable` ⇒ `destructive=false`
      //    ⇒ 落大分类。危害**双向**（本机 pwsh，`& '--- x/My App'` 等经 PATHEXT 解析 rc=0）：
      //      大分类 allow + `my app *`=deny  → HEAD **deny** → ①未加收栏时 **allow**（fail-open）
      //      大分类 ask  + `my app *`=allow → HEAD **allow** → ①未加收栏时 **ask**（例外失明）
      //    ⚠️ 本族与 `--x/my tool ---`（上行那族）**路径分离**：那族 `tailAt >= 0`，走
      //    `fenced` / `bareIsCommand`，不在本轮修法范围内。
      //    ⚠️ 没有这六格时，把①的收栏那半格删掉（= 回退本轮修法）本组**仍全绿**（实测变异 M3）。
      ['"--- x/My App"', 'my app'], ['"- x/My App"', 'my app'], ['"-- x/My App"', 'my app'],
      ['"---- x/My App"', 'my app'], ['"--- x/My Tool.exe"', 'my tool'],
      ['"--- tools/My App"', 'my app'],
      // ⚠️ 本轮新增（第九轮）：**单连字符收栏**子族（basename 以**单个**连字符收尾、剥掉后
      //    残名 ∈ `DESTRUCTIVE_LABELS`）。它与上行 `"--- x/My App"` 是**同一个适用范围①**、
      //    同一条 fail-open 链（label 变空 ⇒ 段级 `unparsable` ⇒ `destructive=false` ⇒
      //    落大分类 ⇒ 用户写的 deny 例外失明），只差收栏的连字符数。成因是**同一个条件的
      //    两半用了两把尺子**：①的收栏判据用 `trailingDashRunAt(s, 1)`（min=1），而残名取自
      //    `trailingDashRunAt(head, 2)`（min=2）；单连字符收栏时后者返回 -1 ⇒ 残名恒为 `''`
      //    ⇒ 「残名不是破坏性命令名」那一格在该子族是**重言式**（恒真、等于没补）。
      //    实测三态（bash/pwsh 同值）：HEAD=`rm -` → PRE=**`""`** → 第九轮修复后=`rm -`。
      //    ⚠️ 本格与上行那六格**路径分离**：本格 `tailAt < 0`（basename 不以 **2+** 连字符
      //    收尾），只被①拦下，不走 `fenced` / `bareIsCommand`。端到端授权方向由 AJ 组
      //    `["--- x/rm -" -rf /data, 'rm *']` 单独钉（两处合起来才覆盖「label 恢复」+「例外生效」）。
      ['"--- x/rm -"', 'rm -']]) {
      // ── ⚠️ 未覆盖的残余范围是**两类**（不要读成「只限非 ASCII 残名」—— 含空格的**纯 ASCII**
      //    残名同样中招；本条**不加断言**，只如实记录边界，见下）──────────────────────────────
      //    剥掉收栏后的**残名**含空白**或**含非 ASCII，都过不了「是命令名」那一格，于是被判成
      //    装饰性收栏 ⇒ label 变空（上面这组语料只覆盖「残名是命令名」那一侧，两类残余都**没有**
      //    语料守护）：
      //      · 残名**含空白**（纯 ASCII）：`"--x/my tool ---"`、`"--x/a b ---"`、`"--x/My Tool ---"`
      //      · 残名**含非 ASCII**：`"--x/换行校验 ---"`、`"--x/工具 ---"`
      //    两类都是**真实可执行文件**（与上面 `"--x/rm ---"` 同族，TEMP 内 PATHEXT 解析实测 rc=0），
      //    危害同族：label 变空 ⇒ 段级 `unparsable` ⇒ `destructive=false` ⇒ 落大分类，用户为该
      //    命令写的 deny 例外随之失明。实测（最坏配置：大分类 allow + 八档全 allow + 该命令
      //    deny 例外）：上面五个形态 × bash/pwsh 两门方言共 10 格，**全部** HEAD=deny →
      //    NOW=allow（真 fail-open）。
      //    ⚠️ 含空格的**纯 ASCII** 残名比非 ASCII 名**常见得多**（`"--x/my tool ---"` 与上面刚修好的
      //    `"-x/my tool ---"` 只差一个连字符），故不要把残余读窄成「只限非 ASCII 名」。
      //    ⚠️ 该残余**不是第六轮引入**：第五轮（`dash > 1` 短路那版）下残余族同样为空，第六轮
      //    既未引入也未修复；但**相对 HEAD 属本次未提交改动引入**（HEAD 该格非空，
      //    `"--x/my tool ---"` HEAD=`my tool ---`）。
      //    ⚠️ **无任何词法判据能分开两族**：残余族与守卫要防的装饰串族在词元粒度上**逐字同形** ——
      //    `dash` 数、`next` 字符、残名含空白三维全同（`"--x/my tool ---"` 真命令
      //    vs `"--x/my check ---"` 装饰串，判据读到的每一维取值都相同）。六轮所加的每一格判据都在
      //    这个**不含区分信息**的空间里搬动分界线 —— 故这里判定为「**不值得继续修补**」，
      //    **不是「待修」、不是 TODO**，也**不要为它补断言**（补了只能钉住「两族同判」这个已知事实）。
      //    触发面**四重叠加**：`--` 开头目录 + 含空格或非 ASCII 名 + basename 以 `---` 收尾
      //    + 用户为该命令写了 deny 例外。
      const d = decomposeCommand(c, 'bash')
      const lab = d.ok ? segmentLabel(d.segments[0].words) : null
      if (lab !== want) bad.push(['路径形态的 - 开头命令名被误伤', c, 'want=' + JSON.stringify(want), 'got=' + JSON.stringify(lab)])
    }

    // ── ③ 洞① 的**危害**（fail-open）必须钉住：ok:false 路径只认 deny 例外 ──────
    // 用户配置是「command 默认 allow + 若干 ask/deny 例外」，故整行 ok:false 会让
    // **全部 allow/ask 例外集体失明**。实测（例外 `Remove-Item *` = ask）：
    //     带 1 个反引号 → 旧实现 **allow**（静默绕过确认），新实现 ask
    {
      const mkHooks = (excAction) => ({
        home: HOME, userHome: HOME, platform: 'win32',
        matchException: (segText) => (String(segText).indexOf('Remove-Item') !== -1
          ? { action: excAction, ruleId: 'e1' } : null),
        destructive: () => ({ action: 'ask', reason: null }),
        category: () => ({ action: 'allow', reason: null }),
        isOutsideWorkspace: () => false,
      })
      const withBt = 'Remove-Item -Recurse -Force C:/Windows ' + BT + 'n'
      const plain = 'Remove-Item -Recurse -Force C:/Windows'
      const rw = assessCommand(withBt, 'pwsh', mkHooks('ask'))
      const rp = assessCommand(plain, 'pwsh', mkHooks('ask'))
      if (rw.action !== 'ask') bad.push(['带反引号时 ask 例外仍失明（fail-open 未修）', withBt, rw.action])
      if (rw.action !== rp.action) bad.push(['带/不带反引号的判定分叉', 'with=' + rw.action, 'plain=' + rp.action])
    }

    // ── ④ 转义表逐格核对：`PWSH_ESCAPES` 的 9 个映射值必须与官方转义表一致 ─────────
    // 为什么必须逐格钉：这张表是本轮**新增**的，而它的值是「官方解析器实测」得来的
    // （见 `shell-parse.js` 里 `PWSH_ESCAPES` 的注释）。没有断言时，表里任何一个值写错
    // （例如把 `` `t `` 写成空格、`` `0 `` 写成字符 `0`）都不会有任何测试变红 ——
    // 实测：把**双引号内**那条 pwsh 转义分支删掉（反引号退化成字面字符），
    // 全部既有断言**存活**，只有本格能发现（`"a`nb"` 的值应是 `a<LF>b` 而不是 `a`nb`）。
    // 两个上下文都要核：引号内（`inQuote=true`）与裸词元（`inQuote=false`）走的是
    // 同一条 `readPwshEscape`，但调用分支不同，值都该一致。
    //
    // ⚠️ `` `e `` 这一格是**版本相关**的，本机宿主（PS 5.1，实测 5.1.19041.5965）真值是
    //    **字面 `e`**：`$ExecutionContext.InvokeCommand.ExpandString('"a`eb"')` → `aeb`
    //    （ESC 0x1B 是 PowerShell 6.0 才加入的）。此处曾把期望值抄成 `'\x1b'`，
    //    与 5.1 真值不符 —— 那是**测试抄错**，不是实现错，故修正的是期望值本身。
    //    错值若留着，`shell-parse.js` 把该格改对反而会假红。
    {
      const WANT = { n: '\n', r: '\r', t: '\t', 0: '\0', a: '\x07', b: '\b', e: 'e', f: '\f', v: '\v' }
      for (const [k, v] of Object.entries(WANT)) {
        for (const [label, src, idx] of [
          ['双引号内', 'Write-Output "a' + BT + k + 'b"', 1],
          ['裸词元', 'echo a' + BT + k + 'b', 1],
        ]) {
          const d = decomposeCommand(src, 'pwsh')
          const got = d.ok ? d.segments[0].words[idx] : null
          if (got !== 'a' + v + 'b') {
            bad.push(['转义表值不符（' + label + '）', BT + k, 'want=' + JSON.stringify('a' + v + 'b'), 'got=' + JSON.stringify(got)])
          }
        }
      }
      // 未知转义 = 丢掉反引号留下字符本身；`` `` `` = 字面反引号（与 bash 的 `\z` → `\z` 不同构）
      for (const [src, want] of [
        ['Write-Output "a' + BT + 'zb"', 'azb'],
        ['Write-Output "a' + BT + BT + 'b"', 'a`b'],
      ]) {
        const d = decomposeCommand(src, 'pwsh')
        const got = d.ok ? d.segments[0].words[1] : null
        if (got !== want) bad.push(['未知/字面转义值不符', src, 'want=' + JSON.stringify(want), 'got=' + JSON.stringify(got)])
      }
    }

    // ── ⑤ 缺陷 A：`` ` `` + **CRLF** 在**未完结词元内**要切开（本轮修复）──────────────
    // PS 真值（官方解析器 token 表 + `PipelineAst` 语句数，逐格实测）：
    //   `Write-Output abc` + `` ` `` + **LF**   → **一个** `Generic[abc`<LF>def]`、`stmts=1`（粘住）
    //   `Write-Output abc` + `` ` `` + **CRLF** → `Generic[abc`<CR>]` + `NewLine[<LF>]` + `…`、`stmts=2`（切开）
    //   `Write-Output abc` + `` ` `` + **CR**   → **一个** `Generic[abc`<CR>def]`、`stmts=1`（粘住）
    // 即 `` ` ``+`\r\n` **不是**整体续行：PS 只把 `` ` ``+`\r` 当转义（字面 CR），`\n` **仍是**换行符。
    // 真实执行实测（`powershell -Command`，无害标记）：CRLF 形态下第二行**真的执行**。
    // ⚠️ 缺这一格时 CRLF 下两行粘成一个词元，第二行的破坏性命令不再单独判档 ——
    //   端到端实测（大分类 allow + 用户显式 deny 例外 `remove-item *`）由 `deny` 变 **`allow`**。
    // ⚠️ 变异实测：把 CR 支的 `open` 判定删掉（= 回退本轮修法）本组 4 格全红。
    {
      const CRLF = '\r\n'
      for (const pre of ['Remove-Item -Recurse -Force C:/Windows', 'Remove-Item -Force $TARGET',
        'Remove-Item -Force a.b', 'Remove-Item -Force abc]']) {
        const d = decomposeCommand(pre + BT + CRLF + 'RemoveXyz', 'pwsh')
        if (!d.ok || d.segments.length !== 2) {
          bad.push(['CRLF 下未完结词元内的反引号未切语句', pre, JSON.stringify(d.ok ? d.segments.map((s) => s.words) : d.reason)])
        }
      }
      // 反向：**词元边界**处（反引号前是空白 / 行首）`` ` ``+CRLF 仍是**整体**续行，不得切开
      for (const c of ['Get-ChildItem ' + BT + CRLF + '-LiteralPath .', BT + CRLF + 'Get-ChildItem']) {
        const d = decomposeCommand(c, 'pwsh')
        if (!d.ok || d.segments.length !== 1) {
          bad.push(['词元边界处的 CRLF 续行被误切', c, JSON.stringify(d.ok ? d.segments.map((s) => s.words) : d.reason)])
        }
      }
      // 反向：LF / CR 的既有行为**不得**被本次修法改动（PS 真值同为「粘住」）
      for (const nl of ['\n', '\r']) {
        const d = decomposeCommand('Remove-Item -Recurse -Force C:/Windows' + BT + nl + 'RemoveXyz', 'pwsh')
        if (!d.ok || d.segments.length !== 1) {
          bad.push(['LF/CR 下的粘住行为被改动', JSON.stringify(nl), JSON.stringify(d.ok ? d.segments.map((s) => s.words) : d.reason)])
        }
      }
      // 反向：词元尾部挂着**转义空白**时（`` $x.Name` `` 的 `value` 是空格 ⇒ `wordText` 以空白收尾）
      //   那个词元**已经完结**，`` ` ``+CRLF 仍是**整体**续行、不得切开。
      //   真实执行实测（无害标记）：`cmd /c ver $x.Name` + `` ` `` + ` ` + `` ` `` + CRLF + `Write-Output MARKER`
      //   的第二行**不执行**（与真续行同结论）。
      //   ⚠️ 这一格是**本轮修法自己**最容易踩的坑：`open` 判据若只看「`wordText` 非空」，
      //   这族会被当成「词元还在写」而多切一刀 —— 实测变异（把 `closedLoose` 删掉）会
      //   新引入 18 格反向误差（穷尽对拍 11520 格，见回报）。故这是**必需**语料。
      for (const pre of ['cmd /c ver $x.Name', 'cmd /c ver -Confirm:', 'cmd /c ver "abc"']) {
        const d = decomposeCommand(pre + BT + ' ' + BT + CRLF + 'RemoveXyz', 'pwsh')
        if (!d.ok || d.segments.length !== 1) {
          bad.push(['词元尾部的转义空白被误判为未完结', pre, JSON.stringify(d.ok ? d.segments.map((s) => s.words) : d.reason)])
        }
      }
    }

    // ── ⑥ 缺陷 B：Parameter 词元内的反引号是**字面字符**，不得吞掉后面的运算符（本轮修复）──
    // PS 真值（官方解析器 + `CommandParameterAst.Argument.Value`，逐格实测）：
    //   `cmd /c ver -x` + `` ` `` + `;` + `` ` `` + LF + `RemoveXyz`
    //     → `Parameter[-x`]` + **`Semi[;]`** + `LineContinuation` + `Identifier[RemoveXyz]`、`stmts=2`
    //   —— 反引号是**字面**字符（并进参数名），而 `;` **仍是真语句分隔符**（`|` / `,` 同理）。
    // 表内字符在 Parameter 词元内**同样不转义**：`Write-Output -xz` + `` ` `` + `n` + `zd`
    // 的参数名是 `-xz`nzd`（反引号与 `n` 都原样保留），而普通词元同形态求值成 `abcz<LF>zd`。
    // 真实执行实测（无害标记）：`` `; `` / `` `| `` / `` `n `` 三种形态下第二行**真的执行**。
    // ⚠️ 缺这一格时 `;` 被吞进词元，第二行的破坏性命令与第一行同判 ——
    //   端到端实测（大分类 allow + 用户显式 deny 例外 `remove-item *`）由 `deny` 变 **`allow`**。
    // ⚠️ 变异实测：把 Parameter 支删掉 / 改回「两个字符都吃」/ 去掉参数名延续判定，本组分别红 4 / 2 / 1 格。
    for (const c of [';', '|', 'n', '<']) {
      const d = decomposeCommand('cmd /c ver -x' + BT + c + BT + '\n' + 'RemoveXyz', 'pwsh')
      if (!d.ok || d.segments.length !== 2) {
        bad.push(['Parameter 词元内的反引号吞掉了运算符', BT + c, JSON.stringify(d.ok ? d.segments.map((s) => s.words) : d.reason)])
      }
    }
    // 反向：Parameter 词元内的反引号**只吃自己**，后面那个字符按正常语义处理 ——
    //   `;` 必须真的切段（上面已钉）；`-x` + `` ` `` + `;` 的**第一段词元**里不得含 `;`
    {
      const d = decomposeCommand('cmd /c ver -x' + BT + ';' + BT + '\n' + 'RemoveXyz', 'pwsh')
      const w = d.ok ? d.segments[0].words : null
      if (!w || w[w.length - 1].includes(';')) {
        bad.push(['Parameter 词元内的反引号未按字面保留', JSON.stringify(w)])
      }
    }
    // 反向：**普通词元**里的反引号仍是转义 —— `` z`; `` 求值成 `z;`（反引号消失、`;` 进词元），
    //   故随后那个 `\n` **是真换行符** ⇒ 两段（PS 实测 `Generic[z`;]` + `NewLine` + `Identifier`、`stmts=2`）。
    //   这一格与 Parameter 族**同结论但不同机制**：把 Parameter 支的判据误扩到普通词元
    //   （= 把反引号当字面）会让 `;` 变成运算符、词元只剩 `zz` —— 词元级就分叉了。
    {
      const d = decomposeCommand('cmd /c ver zz' + BT + ';' + '\n' + 'RemoveXyz', 'pwsh')
      const w = d.ok ? d.segments[0].words : null
      if (!w || w[w.length - 1] !== 'zz;') {
        bad.push(['普通词元内的反引号转义被误当字面', JSON.stringify(w)])
      }
    }
    // ── ①″ Parameter 词元 + **行尾**反引号：不得把字面量 `undefined` 写进词元 ──────────
    // 官方解析器实测：`Remove-Item -Recurse` + `` ` `` → `Generic[Remove-Item]`
    // `Parameter[-Recurse`]`，`stmts=1` —— 反引号是**字面字符**，末词元就是 `` -Recurse` ``。
    //
    // ⚠️ 这里曾有一个由上一批修复自身引入的缺陷：`readPwshEscape` 的 `'segment'` 支条件是
    //    `level === 'segment' && next !== '\n' && next !== '\r'`，**没有排除 `next === undefined`**
    //    （行尾），于是求值的是 `PWSH_PARAMETER_TOKEN.test(word + undefined)` ——
    //    **字符串拼接**把字面量 `undefined` 连同反引号一起写进 `wordText` 与 `segText`：
    //      `Remove-Item -Recurse` + `` ` `` → 词元 `` -Recurse`undefined ``（PS 真值是 `` -Recurse` ``）
    //    实测 34 格中 **32 格**末词元与真值不符。
    //    后果是**用户显式写的精确 deny 例外失配**（例外 = 该命令原文时由 `deny` 变 `allow`），
    //    且面板候选值（用 `seg.text`）落盘为含 `undefined` 的模式，
    //    `matchCommand(真实原文, 污染串)` = **false** ⇒ 该例外**永不命中真实命令**（死规则）。
    //
    // ⚠️ 没有本组时该缺陷**静默通过**（实测变异 M1：全库三套测试全绿）—— 故这是**必需**语料。
    //    钉**末词元与 PS 真值逐字相同**（而不是「不含 `undefined`」）：后者会被
    //    「把行尾反引号整个丢掉」这类错法骗过，而 PS 真值里那个反引号**是在**的。
    for (const [c, want] of [
      ['Remove-Item -Recurse' + BT, '-Recurse' + BT],
      ['rm -rf -Force' + BT, '-Force' + BT],
      ['cmd /c ver -x' + BT, '-x' + BT],
      ['Get-ChildItem -Recurse' + BT, '-Recurse' + BT],
      ['Remove-Item C:/Windows -Recurse -Force' + BT, '-Force' + BT],
      ['Remove-Item -ErrorAction:' + BT, '-ErrorAction:' + BT],
      ['Write-Output abc' + BT, 'abc' + BT],
    ]) {
      const d = decomposeCommand(c, 'pwsh')
      const w = d.ok ? d.segments[d.segments.length - 1].words : null
      const got = w && w.length ? w[w.length - 1] : null
      if (got !== want) {
        bad.push(['Parameter 词元 + 行尾反引号：末词元与 PS 真值不符', c, 'want=' + JSON.stringify(want), 'got=' + JSON.stringify(got)])
      }
    }
    // 端到端：例外 = **命令原文**时不得被污染串绕成 allow（判据取「不得为 allow」，与上文同风格）
    {
      for (const c of ['Remove-Item -Recurse' + BT, 'rm -rf /tmp/pgx -Force' + BT,
        'Get-ChildItem -Recurse' + BT, 'cmd /c ver -x' + BT]) {
        const hExcExact = hooks({ category: 'allow', destructive: 'deny', exceptions: [c], excAction: 'deny' })
        const a = assessCommand(c, 'pwsh', hExcExact).action
        if (a === 'allow') bad.push(['行尾反引号污染致精确 deny 例外失配（fail-open）', JSON.stringify(c), a])
      }
    }

    // 端到端：两处缺陷都不得让用户显式配的 deny 例外失明
    {
      const excDeny = Object.assign({}, hooks({ category: 'allow' }),
        { exceptions: ['remove-item *'], excAction: 'deny' })
      const wideDeny = Object.assign({}, hooks({ category: 'allow' }), { destructive: () => ({ wide: 'deny' }) })
      for (const [cn, h] of [['例外 remove-item * = deny', excDeny], ['wide=deny', wideDeny]]) {
        for (const c of ['Remove-Item -Recurse -Force C:/Windows' + BT + '\r\n' + 'Remove-Item -Recurse -Force C:/Windows',
          'cmd /c ver -x' + BT + ';' + BT + '\n' + 'Remove-Item -Recurse -Force C:/Windows',
          'cmd /c ver -x' + BT + '|' + BT + '\n' + 'Remove-Item -Recurse -Force C:/Windows']) {
          const a = assessCommand(c, 'pwsh', h).action
          if (a === 'allow') bad.push(['CRLF / Parameter 反引号致 deny 被静默绕过（fail-open）', cn, JSON.stringify(c), a])
        }
      }
    }

    ok('★★ AJ 用户实测两缺陷：反引号方言矩阵（含奇偶指纹）+ 假候选 label（含 0 误伤反向核查）',
      bad.length === 0, JSON.stringify(bad.slice(0, 8)))
  }
}

// ─────────────────────────────────────────────────────────────────────────────
group('AJ2. pwsh `$NAME=` 赋值守卫的右半判据 + `rawCommandNames` 的方言维度（本轮两处缺陷的钉桩）')
{
  // 本组钉的是**同一条失效链**的两处入口（均由独立验证发现，PRE 引入）：
  //   label 变空 ⇒ 段级 `unparsable` ⇒ `destructive=false` ⇒ 破坏性子设置与**全部例外匹配**
  //   双双跳过 ⇒ 落大分类（**fail-open**）。
  //
  // ⚠️ 为什么必须有本组（变异测试实测，6 个变异**全部**在既有断言下保持全绿）：
  //   M1 守卫回退成「只认左半」、M6 右半判据放宽成「一律判赋值」、
  //   M2/M3/M4/M5 `rawCommandNames` 四处方言透传各自回退 —— 既有的
  //   `['A=/bin/rm', '', 'rm']`（**不带 `$`**）与 `['$d=' + D, '', '']`（**引号串**）
  //   两格都覆盖不到**带 `$` 且右侧是裸词/路径**这一半，故整个修复面此前无守护。
  //
  // 真值来源：本机 PS 5.1 官方解析器 `[Parser]::ParseInput` + **实执行**（无害替代目标，
  //   临时目录内建 `A=\bin\rm.cmd`，绝不碰真实 rm），逐条跑过：
  //     `$A=/bin/rm` / `$A=./rm` / `$A=C:\Windows\System32\rm.exe` / `$A=/bin/dd`
  //       → `PipelineAst`、**cmdAst=1**、命令名就是那个路径 → `& '<原文>'` **RAN=True**
  //     `$A=1` / `$A=$OTHER` / `$A=(1)` / `$A=@(1,2)` / `$A=[int]1` / `$A=.5` / `$A=-1`
  //       → `CommandExpressionAst`、**cmdAst=0**（真赋值，无命令）
  //     `$A='X:/ws/x'` → cmdAst=0（**引号**是关键：裸写 `$A=X:/ws/x` 是 cmdAst=1 的真命令）
  {
    const bad = []
    // ① 靶形态：pwsh 侧必须**认出命令名**，且端到端不得 allow。
    //    判据取「不得为 allow」而非「=== deny」：动作落点由配置决定（与本文件既有风格一致）。
    //    档位取八档全 deny + 大分类 allow —— 这正是失效链暴露的那一格。
    const dsAllDeny = { inside: 'deny', outside: 'deny', wide: 'deny', unknown: 'deny', proc: 'deny', power: 'deny', priv: 'deny', reg: 'deny' }
    const hDeny = () => Object.assign({}, hooks({ category: 'allow' }), { destructive: () => dsAllDeny })
    // 例外方向同样承重：用户显式写的 `rm *`=deny 曾被整段跳过（实测 HEAD=deny → PRE=allow）
    const hExcDeny = () => Object.assign({}, hooks({ category: 'allow' }),
      { destructive: () => dsAllDeny, exceptions: ['rm *', 'dd *'], excAction: 'deny' })
    for (const [c, want] of [
      ['$A=/bin/rm', 'rm'], ['$A=/usr/bin/rm', 'rm'], ['$A=./rm', 'rm'],
      ['$A=C:\\Windows\\System32\\rm.exe', 'rm'], ['$A=/bin/rm.exe', 'rm'],
      ['$A=/bin/dd', 'dd'],
    ]) {
      const d = decomposeCommand(c, 'pwsh')
      const lab = d.ok ? segmentLabel(d.segments[0].words) : null
      if (lab !== want) bad.push(['pwsh `$NAME=<命令>` 的 label 必须认出（缺陷 1 未修）', c, 'want=' + want, JSON.stringify(lab)])
      for (const [cn, h] of [['八档全 deny', hDeny()], ['例外 deny', hExcDeny()]]) {
        const a = assessCommand(c, 'pwsh', h).action
        if (a === 'allow') bad.push(['pwsh `$NAME=<命令>` 落大分类（fail-open）', cn, c, a])
      }
    }
    // ② 反向：真赋值形态**仍须**判「没有命令要执行」（label 空）—— 防止修过头
    //    （把守卫整行删掉是最省事的错修，会让这些形态重新产出假候选按钮）。
    for (const c of ["$A='X:/ws/x'", '$A="X:/ws/x"', '$A=1', '$A=$OTHER', '$A=(1)', '$A=(Get-Item x)',
      '$A=@(1,2)', '$A=@{a=1}', '$A=[int]1', '$A=.5', '$A=-1', '$A=1..5', '$A=${env:TEMP}', '$A=$null', '$A=']) {
      const d = decomposeCommand(c, 'pwsh')
      const lab = d.ok ? segmentLabel(d.segments[0].words) : null
      if (lab !== '') bad.push(['真赋值形态被误判成命令（修过头）', c, JSON.stringify(lab)])
    }
    // ③ bash 侧零回退：`A=/bin/rm` 在 bash 里**确实是赋值**（不执行命令），label 必须仍为空。
    //    ⚠️ 这一格与 ① 是**同一判据的两侧**：少了它，把守卫改成「两门方言都不拦」也能全绿。
    //    ⚠️ 语料里**不得**再放 `$d=/bin/rm`（本处此前建立在错误真值上）：带 `$` 前缀的形态
    //    在 bash 下 `$d` 先展开成空串、词成了 `=/bin/rm`，是一次**真命令**（Git Bash 5.3.15
    //    实测 RAN[=/bin/rm]），label 应为 `rm` —— 它属下面 ④ 的靶形态族，不是赋值语料。
    for (const c of ['A=/bin/rm', 'my=dir/rm']) {
      const d = decomposeCommand(c, 'bash')
      const lab = d.ok ? segmentLabel(d.segments[0].words) : null
      if (lab !== '') bad.push(['bash 侧赋值守卫回退', c, JSON.stringify(lab)])
    }
    // ③′ 同一格的**订正真值**：`$d=/bin/rm` 此前被放在 ③ 的赋值语料里（**错误真值** ——
    //     那是把 pwsh 侧的语义套到了 bash 上）。带 `$` 前缀的形态在 bash 下 `$d` 先展开成
    //     空串、词成了 `=/bin/rm`，是一次**真命令**（Git Bash 5.3.15 实测 RAN[=/bin/rm]，
    //     整行写进文件再 source，RAN 证据写进独立日志），label 应为 `rm`。
    //     这一格与 shell-parse.js 的缺陷 3 同源：判据对象必须是 `LEAD_ASSIGN`（不认 `$` 前缀）。
    for (const [c, want] of [['$d=/bin/rm', 'rm']]) {
      const d = decomposeCommand(c, 'bash')
      const lab = d.ok ? segmentLabel(d.segments[0].words) : null
      if (lab !== want) bad.push(['bash 侧 `$NAME=` 被误判成赋值（缺陷 3）', c, 'want=' + want, JSON.stringify(lab)])
    }
    // ④ 缺陷 2：pwsh 侧**藏在 opaque 构造里**的靶形态必须恢复 deny。
    //    根因：`rawCommandNames` 走文本、内部 `tokens` 是自建数组（无 `SEG_SHELL` 戳），
    //    不传方言就退回 bash 判据 ⇒ `$A=/bin/rm` 被当赋值 ⇒ 认不出命令名。
    //    实测三态（大分类 allow + 八档全 deny）：HEAD=deny → PRE=**allow** → 本轮=deny。
    //    ⚠️ 只钉 pwsh 侧：bash 侧这几条**本来就没有命令要执行**（`$(A=/bin/rm)` 是赋值），
    //       label 为空是对的，钉它会与 ③ 的语义冲突。
    for (const c of ['echo $(A=/bin/rm)', '(A=/bin/rm)', '{ A=/bin/rm; }', 'echo $(A=/bin/dd)',
      'echo a | (A=/bin/rm)']) {
      const a = assessCommand(c, 'pwsh', hDeny()).action
      if (a === 'allow') bad.push(['pwsh opaque 构造内的 `$NAME=<命令>` 未认出（缺陷 2 未修）', c, a])
    }
    // ⑤ 缺陷 2 的**另两条入口**（同一处方言透传，各自独立承重 —— 变异测试实测：
    //    回退任一处，本组下面两格分别由 deny 变 **allow**）。
    //    ① `assessCommand` 的整行 `ok:false` 分支：整行读不懂时命令名只从原文粗提，
    //       该路径**只认 deny**（收紧方向），故 pwsh 侧必须带方言。
    //    ② `destructiveHeadReadable` 的 `opaqueTexts` 逐块判据：段首是**可读的**破坏性命令、
    //       构造里另藏一个 pwsh `$NAME=<命令>` 时，只有带方言才认得出「构造里还有载荷」，
    //       从而把 `wide`/`inside` 两档并进来。实测（**只有 `inside=deny`**、其余七档 allow）：
    //       回退后 `rm -rf C:/Windows $(A=/bin/dd)` 由 deny 变 **allow**（真 fail-open）。
    {
      const only = (tier) => {
        const t = {}
        for (const x of ['inside', 'outside', 'wide', 'unknown', 'proc', 'power', 'priv', 'reg']) t[x] = x === tier ? 'deny' : 'allow'
        return t
      }
      for (const [cn, h, c] of [
        ['整行 ok:false', hDeny(), 'echo $(A=/bin/rm) "unclosed'],
        ['opaqueTexts 逐块判据', Object.assign({}, hooks({ category: 'allow' }), { destructive: () => only('inside') }),
          'rm -rf C:/Windows $(A=/bin/dd)'],
      ]) {
        const a = assessCommand(c, 'pwsh', h).action
        if (a === 'allow') bad.push(['缺陷 2 的方言透传缺一处（fail-open）', cn, c, a])
      }
    }
    ok('★★ AJ2 pwsh `$NAME=` 守卫右半判据（`$A=/bin/rm` 必须认出且不落大分类）+ 真赋值/bash 反向 + opaque 内靶形态（两处缺陷的钉桩）',
      bad.length === 0, JSON.stringify(bad.slice(0, 8)))
  }
}


// ─────────────────────────────────────────────────────────────────────────────
group('AK. 语句边界处续行标记的归属 + 词元形态影子默认表的单一来源（本批三处缺陷的钉桩）')

// ── 缺陷 1：语句边界（`level === 'segment'`）处**不得**把续行标记写进任何段 ────────────
//
// 实测缺陷（PRE，`cmd /c ver -x` + `` ` `` + LF + `Remove-Item …`）：
//   `` ` ``+LF   段 2 的 op 是 **`start`**、text 是 `` `\nRemove-Item … ``（标记污染了下一段）
//   `` ` ``+CRLF 段 2 的 op 是 `newline`、text 是 `Remove-Item …`（干净）
// 两者是**同一条命令**（`[Parser]` 对 LF / CRLF 都给 `Parameter[-x`]` + 2 条 PipelineAst），
// 判定的段文本却不同 ⇒ 用户手写的**干净精确 deny 例外失明**：
//   大分类 allow + 八档全 allow + 例外 `Remove-Item -Recurse -Force C:/Windows`=deny
//     `` ` ``+LF → PRE **allow**、`` ` ``+CRLF / 裸 NL / `;` / `&&` → deny。
//
// ⚠️ 本组是**必需**语料：把该分支退回「先 `flushSegment()` 再无条件 `pushText(esc.raw)`」
// （= 本批修复的靶）时，**现有全部断言仍全绿**（实测变异 M1）；
// 只去掉 `nextOp = 'newline'`（M1-b）同样全绿。即这两格此前**无任何守护**。
// 判据取**两种换行的段 op / text 逐字相同**（而不是钉死 `'newline'` 这个字面值）：
// 前者是缺陷本身，后者只是实现细节。
{
  const NL = '\n'
  const CMD2 = 'Remove-Item -Recurse -Force C:/Windows'
  const paramToks1 = ['-x', '-Recurse', '-NoNewline', '-Verbose', '-Path$p', '-Filter*', '-?y']
  const bad = []
  for (const t of paramToks1) {
    const head = 'cmd /c ver ' + t
    const lf = decomposeCommand(head + BT + NL + CMD2, 'pwsh')
    const crlf = decomposeCommand(head + BT + '\r\n' + CMD2, 'pwsh')
    const bare = decomposeCommand(head + NL + CMD2, 'pwsh')
    // 对照（防空转）：CRLF 支本来就是对的 —— 若它也判不出 2 段，本组测不到任何东西
    if (!crlf.ok || crlf.segments.length !== 2) {
      bad.push(['对照失效：CRLF 支未判成 2 段', t, JSON.stringify(crlf.ok ? crlf.segments : crlf.reason)])
      continue
    }
    if (!lf.ok || lf.segments.length !== 2) {
      bad.push(['LF 支未判成 2 段', t, JSON.stringify(lf.ok ? lf.segments : lf.reason)])
      continue
    }
    // ① 段 2 的 op 必须与 CRLF 支、裸 NL 支**同值**（缺陷时是 `start`）
    if (lf.segments[1].op !== crlf.segments[1].op || lf.segments[1].op !== bare.segments[1].op) {
      bad.push(['LF 段 2 的 op 与 CRLF / 裸 NL 不一致', t,
        lf.segments[1].op + ' vs ' + crlf.segments[1].op + ' / ' + bare.segments[1].op])
    }
    // ② 段 2 的 text 必须干净（缺陷时带着 `` ` ``+换行 前缀），且与 CRLF 支逐字相同
    if (lf.segments[1].text !== crlf.segments[1].text || lf.segments[1].text !== CMD2) {
      bad.push(['LF 段 2 的 text 与 CRLF 不一致 / 被续行标记污染', t, JSON.stringify(lf.segments[1].text)])
    }
    // ③ 续行标记**不得**留在段 1 上（「先 pushText 再 flush」那个变体的特征）
    if (lf.segments[0].text !== head) bad.push(['段 1 文本被续行标记污染', t, JSON.stringify(lf.segments[0].text)])
    // ④ 词元也不得被污染
    if (JSON.stringify(lf.segments[1].words) !== JSON.stringify(crlf.segments[1].words)) {
      bad.push(['LF 段 2 的 words 与 CRLF 不一致', t, JSON.stringify(lf.segments[1].words)])
    }
  }
  // ⑤ 端到端：干净精确 deny 例外 + 八档全 allow 下，LF 形态必须与 CRLF / 裸 NL / `;` / `&&` 同判
  {
    const dsAll = {}; for (const t of TIERS) dsAll[t] = 'allow'
    const h = Object.assign({}, hooks({ category: 'allow' }), {
      destructive: () => dsAll,
      matchException: (segText, label) => (matchCommand(CMD2, segText) || (label && matchCommand(CMD2, label)))
        ? { action: 'deny', ruleId: 'e1' } : null,
    })
    const forms = [['`+LF', BT + NL], ['`+CRLF', BT + '\r\n'], ['裸 NL', NL], ['分号', ';'], ['&&', ' && ']]
    for (const t of paramToks1) {
      const acts = forms.map(([n, sep]) => [n, assessCommand('cmd /c ver ' + t + sep + CMD2, 'pwsh', h).action])
      const lfAct = acts[0][1]
      if (lfAct !== 'deny') bad.push(['干净精确 deny 例外在 LF 形态下失明（fail-open）', t, JSON.stringify(acts)])
      // 对照（防空转）：其余四种写法必须都真的是 deny，否则「同判」可能两边都不是 deny
      if (acts.slice(1).some(([, a]) => a !== 'deny')) bad.push(['对照失效：CRLF/裸 NL/分号/&& 未判 deny', t, JSON.stringify(acts)])
    }
  }
  ok('★★ AK1 语句边界处续行标记不得写进任何段（LF 的 op/text 必须与 CRLF 逐字一致；端到端 deny 不得失明）',
    bad.length === 0, JSON.stringify(bad.slice(0, 6)))
}

// ── 缺陷 2：同一分支内 `pwshEscapeBoundaryAt` 不得重复求值 ──────────────────────────
// 纯函数、五个输入在两次调用之间一个都没被修改 ⇒ 重复调用只是白付一次判定 + 一次对象分配。
// 判据取**调用点计数**（与 Z5 的 `segHasContent` 同手法）：
// 定义恰好一处，且「出现次数 - 定义次数」= 1 —— 即调用点恰好**一处**（本分支开头那次，
// 续行支直接复用它的结果）。缺陷时该差值为 2（同一分支内重复求值）。
{
  const spSrc = readFileSync(pathJoin(ROOT, 'shell-parse.js'), 'utf8')
  const defs = (spSrc.match(/function pwshEscapeBoundaryAt\s*\(/g) || []).length
  // 注意 `pwshEscapeBoundaryAt(` 也命中定义行本身，故调用点数 = 总数 - 定义数
  const total = (spSrc.match(/pwshEscapeBoundaryAt\(/g) || []).length
  const calls = total - defs
  const bad = []
  if (defs !== 1) bad.push(['定义不是恰好一处', 'count=' + defs])
  if (calls !== 1) bad.push(['调用点不是恰好一处（重复求值残留）', 'count=' + calls])
  ok('★ AK2 `pwshEscapeBoundaryAt` 单一实现、单一调用点（无重复求值残留）',
    bad.length === 0, JSON.stringify(bad))
}

// ── 缺陷 3：词元形态影子的默认值表必须**只有一份**（构造侧与复位侧共用）──────────────
//
// 两份逐字段抄写时，加字段必然漏一处 —— 漏**复位侧**的后果不是「少复位一个标量」，
// 而是**上一词元的残值跨词元泄漏**，直接改变 `pwshEscapeBoundaryAt` 的续行切分结论。
// ⚠️ 实测：退回两份手抄（字段齐全，M3-a）、复位侧漏 `lastOpenIdx`（M3-b）、
// 漏 `cLast`（M3-c）三种变异下**测试套件全部 exit 0 全绿** —— 此前无任何守护。
// 判据取**机制**（两张表不得同时存在）而不是「字段值对不对」：后者在字段齐全时恒真。
{
  const spSrc = readFileSync(pathJoin(ROOT, 'shell-parse.js'), 'utf8')
  const bad = []
  const emptyTables = (spSrc.match(/const EMPTY_WORD_SHAPE = \{/g) || []).length
  if (emptyTables !== 1) bad.push(['`EMPTY_WORD_SHAPE` 不是恰好一处', 'count=' + emptyTables])
  // 两份手抄的特征：`c0: -1` 这类默认值字面量出现两次以上（表里一次 + 另一份抄写里一次）
  const literal = (spSrc.match(/c0:\s*-1,\s*c1:\s*-1/g) || []).length
  if (literal !== 1) bad.push(['默认值字面量出现多次（两份逐字段抄写）', 'count=' + literal])
  // 复位侧必须走整体覆盖，不得逐字段赋值
  if (!/function resetWordShape \(s\) \{\s*\n\s*Object\.assign\(s, EMPTY_WORD_SHAPE\)/.test(spSrc)) {
    bad.push(['resetWordShape 未用 Object.assign 整体覆盖'])
  }
  if (!/function newWordShape \(\) \{\s*\n\s*return Object\.assign\(\{\}, EMPTY_WORD_SHAPE\)/.test(spSrc)) {
    bad.push(['newWordShape 未从同一张表构造'])
  }
  // 字段数固定为 15（加字段时本断言会红灯，提示同步核对 `pushWordShape` 的更新点）
  const m = /const EMPTY_WORD_SHAPE = \{([\s\S]*?)\n\}/.exec(spSrc)
  const fields = m ? (m[1].match(/[A-Za-z_]\w*:/g) || []).length : -1
  if (fields !== 15) bad.push(['字段数不是 15', 'count=' + fields])
  ok('★ AK3 词元形态影子默认表单一来源（构造侧 / 复位侧共用 `EMPTY_WORD_SHAPE`）',
    bad.length === 0, JSON.stringify(bad))
}

// ─────────────────────────────────────────────────────────────────────────────
// ── 缺陷：bash 侧赋值守卫只看**词元**，把「整体引号包裹的 `NAME=path`」误判成赋值 ──────
//
// 失效链与 AJ2 同一条：label 变空 ⇒ 段级 `unparsable` ⇒ `destructive=false` ⇒
// 破坏性子设置与**全部例外匹配**双双跳过 ⇒ 落大分类（**fail-open**）。
//
// 词法器**剥引号**后，`'A=/bin/rm'`（整体引号）与 `A=/bin/rm`（无引号）的词元**逐字相同**
// （实测都是 `A=/bin/rm`）—— 词元粒度上不可区分，只有段原文还留着那对引号。
//
// 真值来源：Git Bash 5.3.15 实测（无害替代目标，`mktemp -d` 内建 `A=/bin/rm` 可执行文件，
// 每条都在**同一个 shell 内**跑完并回显变量，绝不碰真实 rm）：
//     `A=/bin/rm`    → 不执行任何命令，`A` 被设为 `/bin/rm`        ⇒ **真赋值**
//     `'A=/bin/rm'`  → **真的执行了**该路径文件（rc=0），`A` 仍 unset ⇒ **真命令**
//     `"A=/bin/rm"`  → 同上（引号改变语义：`NAME=` 不再被识别为赋值前缀）
//     `A='/bin/rm'`  → 真赋值（引号只包住**值**，名字与 `=` 仍是字面量）
//     `'A'=/bin/rm` / `A'='/bin/rm` / `A''=/bin/rm` / `''A=/bin/rm`
//     / `\A=/bin/rm` / `A\=/bin/rm` / `'A='/bin/rm` / `'A=''/bin/rm'` → **全是真命令**
//   即：`NAME=` 整段必须是**字面量**（未加引号、未转义）才算 bash 的赋值前缀。
//
// ⚠️ 为什么必须有本组（变异测试实测）：把 bash 分支退回
//   `LABEL_ASSIGN.test(String(w[0]))`（= 本缺陷的靶）后，**三个套件全部 ALL PASS** ——
//   既有断言的 bash 赋值语料只有 `A=/bin/rm` / `my=dir/rm`（**无引号**），
//   **没有一格**带引号，故整个修复面此前无守护。
//   （原先这里还把 `$d=/bin/rm` 列为「bash 赋值语料」—— 那是**错误真值**，已按 Git Bash
//   实测订正：带 `$` 前缀的形态在 bash 下是真命令，归 AJ2 的 ③′ 靶形态组。）
// ⚠️ 语料刻意**最小**：只放「整体引号」与「无引号」的对照，不顺手扩充其他形态 ——
//   引号/转义插入名字或 `=` 的那一族与本次是**同一条判据**，由下面第 ② 组顺带覆盖即可。
group('AL. bash 赋值守卫必须区分「整体引号」与「无引号」（本轮缺陷的钉桩）')
{
  // 档位取八档全 deny + 大分类 allow —— 这正是失效链暴露的那一格。
  const dsAllDeny = { inside: 'deny', outside: 'deny', wide: 'deny', unknown: 'deny', proc: 'deny', power: 'deny', priv: 'deny', reg: 'deny' }
  const hDeny = () => Object.assign({}, hooks({ category: 'allow' }), { destructive: () => dsAllDeny })
  const bad = []
  // ① 靶形态：整体引号（单/双）⇒ bash 真值是**真命令**，必须认出命令名且端到端不得 allow。
  //    判据取「不得为 allow」而非「=== deny」：动作落点由配置决定（与本文件既有风格一致）。
  for (const [c, want] of [
    ["'A=/bin/rm'", 'rm'], ['"A=/bin/rm"', 'rm'],
    ["'my=dir/rm'", 'rm'], ["'x=1/diskpart'", 'diskpart'],
  ]) {
    const d = decomposeCommand(c, 'bash')
    const lab = d.ok ? segmentLabel(d.segments[0].words, 'bash') : null
    if (lab !== want) bad.push(['整体引号的 `NAME=path` 被误判成赋值（label 变空）', c, 'want=' + want, JSON.stringify(lab)])
    const a = assessCommand(c, 'bash', hDeny()).action
    if (a === 'allow') bad.push(['整体引号的 `NAME=path` 落大分类（fail-open）', c, a])
  }
  // ② 反向：**无引号**的真赋值必须**仍判赋值**（label 空）—— 防止修过头
  //    （把守卫整行删掉是最省事的错修，会让这些形态重新产出假候选按钮）。
  for (const c of ['A=/bin/rm', 'my=dir/rm', 'x=1/diskpart', "A='/bin/rm'", 'A=/bin/rm > /tmp/z']) {
    const d = decomposeCommand(c, 'bash')
    const lab = d.ok ? segmentLabel(d.segments[0].words, 'bash') : null
    if (lab !== '') bad.push(['bash 侧真赋值被误判成命令（修过头）', c, JSON.stringify(lab)])
  }
  // ③ 同族（同一判据、`NAME=` 被引号/转义打断）：bash 真值**全是真命令**，必须一并认出。
  //    ⚠️ 这一组是①的**判据边界**而非新语料：判据一旦退回「只看词元」，它们与①同时失效；
  //    只钉①不钉这里，改「只在段原文以引号开头时放行」这类半吊子修法也能全绿。
  for (const [c, want] of [
    ["'A'=/bin/rm", 'rm'], ["A'='/bin/rm", 'rm'], ["A''=/bin/rm", 'rm'],
    ["''A=/bin/rm", 'rm'], ['\\A=/bin/rm', 'rm'], ['A\\=/bin/rm', 'rm'],
    ["'A='/bin/rm", 'rm'], ["'A=''/bin/rm'", 'rm'],
  ]) {
    const d = decomposeCommand(c, 'bash')
    const lab = d.ok ? segmentLabel(d.segments[0].words, 'bash') : null
    if (lab !== want) bad.push(['引号/转义打断 `NAME=` 的形态被误判成赋值', c, 'want=' + want, JSON.stringify(lab)])
  }
  // ④ pwsh 侧零变化：本次只动 bash 分支，pwsh 的赋值判据（含 `$d='X:/ws/x'` 这一格，
  //    它的引号在原文里、是「真赋值 vs 真命令」的唯一判据）必须逐字不变。
  for (const [c, want] of [['$A=/bin/rm', 'rm'], ["$d='X:/ws/x'", ''], ["'$A=/bin/rm'", 'rm']]) {
    const d = decomposeCommand(c, 'pwsh')
    const lab = d.ok ? segmentLabel(d.segments[0].words, 'pwsh') : null
    if (lab !== want) bad.push(['pwsh 侧赋值判据被本次改动影响（应为零变化）', c, 'want=' + JSON.stringify(want), JSON.stringify(lab)])
  }
  // ⑤ 同一判据的**操作符位**那一半（缺陷 1：重定向目标位 / 操作符之后的 `NAME=` 不是赋值前缀）——
  //    `'A=/bin/rm' >| A=x` 里的 `A=x` 是**重定向目标**、其前一个非空白字符是操作符，故它不是
  //    赋值前缀；`$( A=x )` 里的 `A=x` 同理（前一字符是 `(`）。这些形态的命令词都是真命令。
  //
  // ⚠️ 为什么必须有这 6 格（变异测试实测）：判据里的**操作符字符类**必须是完整集
  //   `[\n\r;|&(){}<>]`，把它退回修复者注释里那个「简化版」`[<>]` 后，下面各格由 deny 变
  //   **allow**（真 fail-open），而**两套件连同本组 ①~④ 一律全绿** ——
  //   即整个操作符位修复面此前无语料守护。
  //
  // bash 真值（Git Bash 5.3.15 实测；`mktemp -d` 内建 `A=/bin/rm` 可执行文件（内容只往
  //   独立日志追加），整行写进文件再 source，故赋值语义与真跑一致、RAN 证据不受该行自身
  //   重定向影响）：
  //     `'A=/bin/rm' >| A=x`   → **RAN[A=/bin/rm]** ⇒ 真命令
  //     `'A=/bin/rm' >& A=x`   → **RAN[A=/bin/rm]** ⇒ 真命令
  //     `'A=/bin/rm' > A=x`    → **RAN[A=/bin/rm]** ⇒ 真命令
  //     `>| A=x 'A=/bin/rm'`   → **RAN[A=/bin/rm]** ⇒ 真命令
  //     `$( A=x ) 'A=/bin/rm'` → **RAN[A=/bin/rm]** ⇒ 真命令
  //
  // ⚠️ 为什么是 6 格而不是 3 格（本机把字符类逐个成员删掉 + 半修法变异，逐项实测）：
  //   · 承重成员各占一格 —— 删 `|` 会让第 1 格与第 4 格都变 allow、删 `&` 只让第 2 格、删 `>` 只让
  //     第 3 格、删 `(` 只让第 5 格、删 `)` 只让第 6 格；五者**各自独立承重**，少一格就漏一个成员。
  //     （第 3 格不可省：第 1/2 格的判据字符是 `|` / `&`，`>` 只是它们的一部分，
  //     故「把 `<>` 从字符类里去掉」这类回退只有第 3 格抓得到。）
  //   · 第 4 格（**前置**形态）不可省：只钉后置形态时，「只处理重定向目标位、不管词首
  //     操作符位」这类**半修法**会让第 1/2/5 格全绿、而前置形态由 deny 变 allow
  //     （本机实测），故必须有一条前置语料与后置形态互为边界。
  //   · 另有四类形态**刻意不入册**（真值有问题，钉住就是把反向误差焊进测试）：
  //     `{ A=x; } 'A=/bin/rm'` / `( A=x ) 'A=/bin/rm'` 在 bash 下是**语法错误**（rc=2，
  //     命令**未启动**，实测 RAN=<none>）；`'A=/bin/rm' < A=x` 只在目标文件**已存在**时
  //     才执行（目标不存在时 rc=1、**命令不启动**，实测 RAN=<none>），真值随环境而变；
  //     `'A=/bin/rm' 2>& A=x` 是 `ambiguous redirect`（rc=1，命令未启动）。
  //     即 `{` / `)` / `<` 三个成员**没有**「无条件真命令」的形态可钉，故不为它们造语料。
  //     ⚠️ 这句里的 `)` **已被实测推翻**，见紧接的订正段。
  //
  //   · ⚠️ **订正**：上面「`{` / `)` / `<` 都没有无条件形态」这句，对 `)` 是**错的** ——
  //     已按 Git Bash 5.3.15 实测推翻，故补第 6 格。实测（同上手法，命令词侧取**裸词**
  //     `NAME=path`）：
  //         `$(true) A=/bin/rm 2>/dev/null` / `$(true) A=/bin/rm 2>&1`
  //         / `$(echo) A=/bin/rm 2>/dev/null` / `$( :) A=/bin/rm 2>&1`
  //         / `$(true; ) A=/bin/rm 2>/dev/null` / `$(exit 0) A=/bin/rm 2>&1`
  //           → **6/6 全部 RAN[A=/bin/rm]、rc=0、A 仍 unset** ⇒ 真命令、**无条件成立**
  //             （不依赖任何已存在文件；`$( )` 已闭合，故不落入上面「语法错误」那类）。
  //     ⚠️ 该成员此前**完全无语料守护**（本格是它唯一一格，同族形态判据相同、多钉无益）：
  //        只把 `shell-parse.js` 里 `bashLeftIsAssign` 那条操作符字符类中的 `)` 一个成员删掉，上面那 6 格形态即由 deny
  //        变 **allow**（覆盖八档全 deny / 逐档单 deny / 大分类 allow + 用户写下的
  //        `rm *`=deny 例外三族配置），而**本文件与 regressions.mjs 双双 ALL PASS**。
  //     ⚠️ 本格形态不可替换成**无后缀**的 `$(true) A=/bin/rm`：同一变异下那一格 label 虽
  //        同样变空，端到端却**仍是 deny**（实测），钉不住该成员；带重定向后缀才是
  //        该成员 fail-open 的触发形态。
  //     `{` 那半（`{ A=x; } 'A=/bin/rm'` 是语法错误 rc=2、命令未启动）与 `<` 那半
  //     （目标文件不存在时 rc=1、命令不启动）**实测均成立**；但 `<` 是否存在别的
  //     **无条件**形态**未确证**，本处不作断言。
  for (const [c, want] of [
    ["'A=/bin/rm' >| A=x", 'rm'],
    ["'A=/bin/rm' >& A=x", 'rm'],
    ["'A=/bin/rm' > A=x", 'rm'],
    [">| A=x 'A=/bin/rm'", 'rm'],
    ["$( A=x ) 'A=/bin/rm'", 'rm'],
    //   · 第 6 格（`)` 成员）同样独立承重 —— 见上方订正段。
    ["$(true) A=/bin/rm 2>/dev/null", 'rm'],
  ]) {
    const d = decomposeCommand(c, 'bash')
    const lab = d.ok ? segmentLabel(d.segments[0].words, 'bash') : null
    if (lab !== want) bad.push(['操作符位的 `NAME=` 被误判成赋值前缀（label 变空）', c, 'want=' + want, JSON.stringify(lab)])
    const a = assessCommand(c, 'bash', hDeny()).action
    if (a === 'allow') bad.push(['操作符位的 `NAME=` 落大分类（fail-open）', c, a])
  }
  // ⑥ 命令词位被 opaque 构造占据 + 重定向带**具名目标** ⇒ `NAME=path` 是真命令。
  //
  // ⚠️ 这一格与 ⑤ 的六格是**不同判据**：⑤ 判「命中处前一非空白字符是操作符」，
  //    本族的前一非空白字符是**目标词的末字符**（`> out A=x` 里是 `t`），故 ⑤ 全绿时
  //    本族照旧 fail-open。失效链与 ⑤ 同：label 空 ⇒ 段级 `unparsable` ⇒ `destructive=false`
  //    ⇒ 破坏性子设置与全部例外失配 ⇒ 落大分类。
  // bash 真值（Git Bash 5.3.15 实测；`mktemp -d` 内建 `A=/bin/rm` 可执行文件，内容只往
  //    独立日志追加，整行写进文件再 source，故赋值语义与真跑一致、RAN 证据不受该行自身
  //    重定向影响）：
  //      `$(true) > out A=/bin/rm` → **RAN**、`A` 仍 unset ⇒ 真命令
  //      `> out A=/bin/rm`         → **无 RAN**、`A=/bin/rm` ⇒ 真赋值
  //    （`> out` / `>out` / `2>` / `>>` / `>|` / `&>` / `<` / 带引号目标 / 多级重定向
  //      同族共 13 格实测**全部 RAN**；无 opaque 的 `> out A=…` 实测**全部赋值**。）
  //
  // ⚠️ 为什么是 3 格而不是 2 格（另有本轮补的「只钉动作」那格，来由见下方 ④ 那条）：本判据依赖**两个不同来源的位置关系**（词法器戳下的
  //    opaque 起点 vs `NAME=` 命中位置），日后最容易漂移的正是这一处 —— 若有人给词法器
  //    加新的 opaque 标记点而漏调 `noteOpaqueHead`，或改了空白归一化，定位会**静默失效**，
  //    而失效方向恰好是 fail-open（回到 NOW 的错误行为），两套件仍然全绿。
  //    第 3 格是**反向**钉桩，且三格合起来把判据**夹在中间**（本机变异实测）：
  //      · 把前提放宽成「隔一个词也判非赋值」→ 多格变红；
  //      · 把 `noteOpaqueHead` 的 `pending === undefined` 守卫去掉（改成「段里任何位置的
  //        opaque 都记」）→ **只有反向那格**变红（正向格仍绿）。
  //    即只钉第 1 格抓不住这两个方向。
  //    ⚠️ 第 1 格只走 `$()` 那**一个** opaque 标记点，而词法器共**六处**调用
  //    `noteOpaqueHead`（`$()` 两处、反引号两处、分组/花括号两处）。实测（本机变异：每次
  //    只删一处调用，跑本套件 + `test/regressions.mjs`）：删 `group` 分支（`shell-parse.js`
  //    里 `(` / `{` 那次）那**一处**时，两套件**双双全绿**，而端到端由 `deny` 掉成
  //    `allow`（fail-open）—— 故第 2 格补的正是这条**当时无语料守护**的路径。
  //    第 2 格取**花括号展开**（`{,}` 展开成**零个词**、不产出词元 ⇒ 该段词元只剩
  //    `A=/bin/rm` 一个 ⇒ 它直接成为命令名；⚠️ 与 `''` 的**一个空词**不同族 —— 后者真值
  //    是 `command not found`、命令**不**执行），因为 `(` / `{`
  //    走的是**同一个**分支：`(true) > out A=/bin/rm` 与 `{ true; } > out A=/bin/rm` 在
  //    bash 里都是**语法错误**（Git Bash 5.3.15 实测 `bash -n` rc=2、`syntax error near
  //    unexpected token 'A=/bin/rm'`，`--posix` 同样报错），钉它们等于把**反向误差**写进
  //    语料；而 `{,} > out A=/bin/rm` 实测是**真命令**（RAN、`A` 仍 unset）。
  //    ⚠️ 其余四处调用点**不能一概而论**，实测分三类（本机逐点变异：每次只删那一处调用，
  //    多轮形态枚举合计约 5.9k 格；**下面一律用锚点、不写行号** —— 本文件的行号引用
  //    已被证明系统性不可维护，改动 `shell-parse.js` 后必然陈旧）：
  //      · 漏调**零可观测差异**（旁路兜住，故不补）—— **引号内反引号分支**与**词首反引号
  //        分支**（各自 `markOpaque` 之后那处 `noteOpaqueHead()`）：逐格 label 与动作**全同**。
  //        旁路有二：反引号分支 `addWord(raw)` 把构造记成**独立词元**（段内多一个词元 ⇒
  //        那条 `w.length === 1` 守卫根本不被咨询）；而构造与 `NAME=` **紧贴**时，定界符
  //        紧邻 `NAME=`，又不满足「命中处在词首、或前一字符为空白」这一**前置**条件。
  //      · 漏调**确有**真 fail-open，且**此前完全无语料守护**（**故本轮补一格**）——
  //        **引号内 `$()` 的 `noteOpaqueHead()` 调用**（`markOpaque` 之后那处）：
  //        差异只出现在「fd 号紧贴」族（`"$(true)"2> out A=/bin/rm`，删后 `"rm"/deny`
  //        → `""/allow`）。该族 bash 真值确如旧注所述是 `CMD=[2]`（`A=/bin/rm` 只是 `2` 的
  //        **参数**；词内含引号部分 ⇒ 该数字**不**算 fd 号，故命令名是 `2`；把它造成可执行文件
  //        后确实跑的是 `2`）—— 但**「命令名是 `2`」不等于「没有危害」**：引号内 `$()` 的
  //        **载荷本身会真的执行**（Git Bash 5.3.15 实测，用 stub 顶替 `rm`：`"$(sh -c 'rm …')"
  //        2> out A=/bin/rm` 的载荷确实跑到了 `rm`）。删**那处 `noteOpaqueHead()` 调用**后
  //        这一族由 `deny` 掉成 `allow`，放宽的形态里包含 `sh -c '…'` / `base64 -d | sh` / `${CMD}` / `r''m`
  //        这些**载荷命令名不可静态读取**的写法 —— 恰恰是 `opaque`（`command substitution
  //        cannot be read statically`）要防的东西：**读不出来时应当 fail-closed，删掉这处却变
  //        allow** ⇒ 这是**真 fail-open**（放宽方向本身就是 fail-open，不能按「判据与真值
  //        不符但方向无害」来接受）。
  //        差异的成因是词法器把紧贴的数字**当 fd 号吞掉**（引号分支只 `pushText`、不 `addWord`
  //        ⇒ `started` 仍假）⇒ 段内只剩 `A=/bin/rm` 一个词元 ⇒ 那条 `w.length === 1` 守卫被
  //        咨询 ⇒ 赋值守卫两态给出不同答案。
  //        ⚠️ **label 两态都与真值不符**（HEAD 给 `"rm"`、删后给 `""`，而真值是 `2`）⇒ 本路径
  //        **仍无真值正确的 label 可钉**（钉 `label==="rm"` 等于把误报写进语料，旧注这句是对的）。
  //        但**动作层面**有真值正确的守护可补：该载荷**确实执行**（见上），故「不得静默放行」是
  //        真值正确的安全属性 —— 本轮因此补一格，**只钉动作、不钉 label**（见下方独立断言块）。
  //        ⚠️ 但该守护**当前并不存在**：本格之所以 deny，靠的是那句 label 误报 `"rm"` 命中
  //        `DESTRUCTIVE_LABELS`，而非任何「载荷读不出 ⇒ fail-closed」机制 —— 详见下方 ④ 的订正。
  //      · 漏调**确有** fail-open，**但已被第 1 格语料守护**（故不补）—— **命令词位 `$()`
  //        的 `noteOpaqueHead()` 调用**（词法器主循环里 `char === '$'` 那条分支的
  //        `markOpaque` 之后）：该分支只 `pushText`、**不** `addWord`，故 `$(true) > out
  //        A=/bin/rm` 里 `A=` 前是**真空白**、前驱非空白字符是目标词 `out` 的末字符（不是
  //        操作符）⇒ 前置条件**满足** ⇒ 判据真的会误判成赋值。实测删那处调用后该格由
  //        `"rm"/deny` 掉成 `""/allow`（真值确是 COMMAND：实测 `CMD=[A=/bin/rm]`），本套件
  //        `FAIL(1)`、明细正是第 1 格 —— **故第 1 格是这条路径的唯一守护，不可删**。
  //        ⚠️ 本类与上一类**同属真 fail-open**（都不可当作「可接受差异」），区别只在**守护
  //        归属**：本类已被第 1 格钉住，上一类此前无格、由本轮新补的那格钉住。
  //    `close` 分支（孤立 `}` / `)`）
  //    漏调**确有** fail-open，该分支可触发的形态穷举后真值**分两类**（Git Bash 5.3.15 实测）：
  //      · **带空格或操作符**的接法 —— `} > out A=/bin/rm` / `} ; A=…` / `} && A=…` /
  //        `} | A=…`（以及 `}>> out` / `}&> out` / `}>| out` / `}< out` / `} 2>out` …）
  //        → **SYNTAX-ERR**（rc=2，`syntax error near unexpected token '}'`）；
  //      · **紧贴数字**的接法 —— `}2>out` / `}2> out` / `}2>>out` / `}2>/dev/null` /
  //        `}2>&1` / `}2>|out` / `}2<out` / `}22>out` / `}3>out` / `}12>out`
  //        → **真命令**（rc=0；命令名实测是 `}2` / `}22` / `}3` / `}12`，`A=/bin/rm`
  //        是它的**参数**）；`}A=/bin/rm` / `}rm` 同样是真命令（命令名 `}A=/bin/rm` / `}rm`）。
  //      ⚠️ 而 `)` 那半**全部**是 SYNTAX-ERR（连 `)2>out` 也报错）—— 「紧贴数字即真命令」
  //        只对 `}` 成立。
  //    ⇒ 并非「全部是 SYNTAX-ERR」。但真命令的命令名**一律带 `}` 前缀**（`}2` / `}rm` /
  //    `}A=/bin/rm` …），实测这些名字**无一在 `DESTRUCTIVE_LABELS` 里** ⇒ **不存在真破坏性
  //    命令被放行** ⇒ **无真值正确的承重格可补**，这是**已知且可接受的守护缺口**（结论句仍成立）。
  //    ⚠️ 第 3 格**不能**换成 `> out A=1`：实测该形态的 label 在 HEAD/NOW/FIX 三态
  //    恒为空（`A=1` 剥路径后仍含 `=`，被 `BAD_LABEL_CHARS` 提前拦下，与赋值守卫无关），
  //    对任何变异都无鉴别力 —— 钉住它等于没钉。
  //    ⚠️ 不按「重定向操作符 × opaque 构造类型」铺开成矩阵：同族形态判据相同、多钉无益。
  for (const [c, want] of [
    ['$(true) > out A=/bin/rm', 'rm'],
    ['{,} > out A=/bin/rm', 'rm'],
    ['> "$(true)" A=/bin/rm', ''],
    // ⑦ opaque 占**重定向目标位** ⇒ 命令词被吞进 `writeTargets`、`words` 只剩 `NAME=path`
    //    ⇒ 与上面三格（opaque 占**命令词位**）走的是**不同**的判据分支，故必须另钉。
    //    ⚠️ 本族此前**完全无语料守护**（AL 组未覆盖）：失效链与上面同（label 空 ⇒ 段级
    //    `unparsable` ⇒ `destructive=false` ⇒ 破坏性子设置与全部例外失配 ⇒ 落大分类）。
    //    bash 真值（Git Bash 5.3.15 实测，**真** `mktemp`、只 stub `rm`/`marker` 且写独立日志；
    //    整行在子 shell 里 `eval`，故赋值语义与真跑一致）：
    //      `> $(mktemp) r"m" A=/bin/rm > out2` → **RAN[rm] args=[A=/bin/rm]**、`A` unset ⇒ 真命令
    //      `> $(true) X=/bin/marker`           → **无 RAN**、`X=/bin/marker`            ⇒ 真赋值
    //    ⚠️ 两格的**承重项各不同**（本机变异实测：逐个改 `shell-parse.js` 再跑本套件 + regressions）：
    //      · 第 1 格承**粘性**：把「已定案」的目标位戳改成「遇新重定向即复位」⇒ 本格由 `rm`
    //        掉成 `''`（`allow`），套件 **FAIL**。⚠️ **尾部那个 `> out2` 是承重的一半**：
    //        去掉它（只留 `> $(mktemp) r"m" A=/bin/rm`）时，同一变异下本格**仍是 `rm`**、
    //        套件**全绿** ⇒ 该形态**抓不到非粘性回退**，故本格取带尾写法。
    //      · 第 2 格承**过收**：`noteOpaqueTarget` 里无条件复位 `pending`（即本缺陷两个
    //        被否掉的候选修法之一）⇒ 本格由 `''` 变 **`marker`**（把真赋值判成真命令）。
    //    ⚠️ 另有**两处判据当前无语料守护**（同批变异实测：两处各自单独去掉后**两套件仍双双
    //    PASS**，故只在本注释里记下、不为它们再造语料 —— 「不为钉住而钉住」）：
    //      · 目标位戳的**定案条件**（被吞的第一个词**不是赋值词**才算顶掉命令词位）：
    //        去掉后 `> $(mktemp) A=/bin/rm B=/bin/rm` 由 `''` 变 `rm`（真值 ASSIGN，实测
    //        `A`/`B` 都被设上、无 RAN）—— 该形态与上面第 2 格是**不同族**（词元数组非空）。
    //      · 新重定向**作废未定案的候选**：去掉后 `> $(true) > out A=/bin/rm` 由 `''` 变
    //        `rm`（真值 ASSIGN，实测 `A=/bin/rm`、rc=1）。
    //      改动这两处判据时必须手工复核上面两格（它们**不会**变红）。
    ['> $(mktemp) r"m" A=/bin/rm > out2', 'rm'],
    ['> $(true) X=/bin/marker', ''],
    // ⑧ `NAME=path` 在**段首** + 重定向 + opaque 目标（本轮修法 Z 的靶，AL 组此前无语料守护）。
    //    与 ⑦ 是**同一判据**（`SEG_OPAQUE_TARGET`）但走**不同分支**：⑦ 里 `NAME=` 在段首
    //    **之后**（`at > 0`，前一非空白字符是操作符）；本格里 `NAME=` 就在段首（`at === 0`）
    //    ⇒ 上一批那个「位置比较」收窄在这里**恒假**（`oT < 0` 不可能成立）⇒ 判据**根本没被
    //    咨询** ⇒ 落到 `k < 0` 那条（`at === 0` 时 `k === -1`）⇒ 无条件 `return true`（判赋值）。
    //    bash 真值（Git Bash 5.3.15 实测，**真** `mktemp`/`true`、只 stub `rm`/`marker`/
    //    `diskpart` 且写独立日志；整行在子 shell 里 eval）：
    //      `FOO=/usr/bin/rm 2> $(mktemp) marker` → **RAN[marker]**、`FOO` unset ⇒ 真命令
    //      `> $(mktemp) r"m" A=/bin/rm`         → **RAN[rm]**、`A` unset      ⇒ 真命令
    //    ⚠️ 第 1 格是本轮靶（真值 COMMAND、label `rm`）；第 2 格是**第 7 圈靶族的回归守卫** ——
    //    仲裁的变体 X（在 `OT` 判据内部加「该 opaque 之后没有产出真词元」这类收窄）会把
    //    第 2 格由 `rm` 误伤成 `''`；钉住它可防日后又加收窄打掉第 7 圈的修复面。
    //    ⚠️ 不按「重定向操作符 × opaque 类型 × 命令词形态」铺开成矩阵：同族判据相同、多钉无益。
    ['FOO=/usr/bin/rm 2> $(mktemp) marker', 'rm'],
    ['> $(mktemp) r"m" A=/bin/rm', 'rm'],
    // ⑨ 占目标位的 opaque 构造**带内联程序**（本轮批次 A 的靶，AL 组此前无语料守护）。
    //    与 ⑦/⑧ 是**同一族形态**（opaque 占重定向目标位）但**判据不同**：⑦/⑧ 判「有没有
    //    占过目标位」（`SEG_OPAQUE_TARGET`），本族还要求判「那个构造里**装了什么**」——
    //    上面两条判据都**不过问构造内容**，故 `> $(sh -c "…") > out A=/bin/rm` 这一族
    //    在仅靠前两条时仍 fail-open（真值 COMMAND，却判赋值）。
    //    bash 真值（Git Bash 5.3.15 实测，**真** `mktemp`/`true`、只 stub `marker` 且写独立
    //    日志；载荷已无害化 —— 用的是 stub `marker`，**不是** `rm -rf /tmp/zzz`）：
    //      `> $(sh -c 'marker') > out A=/bin/rm` → **RAN[marker]**、`A` unset ⇒ 真命令
    //      `> $(true) > out A=/bin/rm`           → **无 RAN**、`A=/bin/rm`   ⇒ 真赋值
    //    ⚠️ 第 2 格是**真赋值对照**：它防的是「日后把判据放宽成『段里任何 opaque 构造带内联
    //    程序』」——那样会把这一格打成 COMMAND（新过收）。两格的词元数组**逐字相同**
    //    （`words=["A=/bin/rm"]`、`writeTargets=["out"]`），差别**只在构造里装了什么**。
    //    ⚠️ 判据必须落在 `noteOpaqueText` 里（那一刻构造仍占着目标位）：`> $(sh -c …) > out …`
    //    里构造后紧跟 `>`，**新重定向作废未定案候选**那处（`>` 分支里
    //    `opaqueTargetSwallow = false` 那一行）会让 `flushWord` 的**定案分支根本不会执行** ——
    //    任何「在定案处加一问」的修法在本族上一行都不跑。
    //    ⚠️ 不按「重定向操作符 × 载荷类型 × 命令词形态」铺开成矩阵：同族判据相同、多钉无益。
    //    ⚠️ **已知残余（本批刻意不扩，勿为它叠第二层判据）**：管道形态
    //    `> $(base64 -d x | sh) > out A=/bin/rm` 本判据**不覆盖**（剥定界符后首词是
    //    `base64`，`nestedInlineProgram('base64', …)` = false），而真值实测该形态**载荷确实
    //    执行**。扩它要动 `nestedInlineProgram` 的语义（承重函数，`assessCommand` 与 index.js
    //    的候选守卫都在用）⇒ 记为已知残余，不为它再造语料。
    ["> $(sh -c 'marker') > out A=/bin/rm", 'rm'],
    ['> $(true) > out A=/bin/rm', ''],
    // ⑩ 带内联程序的 opaque 构造，三个**入参构造维度**（第 10 圈修法 U 的靶，AL 组此前
    //    无语料守护）。⑨ 钉的是「构造里装了什么」，本组钉的是**判据的入参怎么构造** ——
    //    三处曾与既有调用点（`assessCommand` / index.js 候选守卫，拿到的是**词法器产出 +
    //    已剥引号 + 已归一化**的形态）**不同源**，各自漏掉一族：
    //      · 第 1 格 —— 守卫多了 `!started`（引号分支读到引号即置 `started = true`）
    //        ⇒ 引号内的站点**永远进不了判据**；
    //      · 第 2 格 —— 朴素 `split(/\s+/)` **不剥引号** ⇒ 当**标志词元自身**被引号包裹
    //        （`sh "-c" x` / `"sh" -c x`）时 `INLINE_PROGRAM_FLAG` 不命中。
    //        ⚠️ **只有那一族失效**：朴素切分对 `sh -c x`（标志不带引号）**同样命中**，
    //        且它的首词仍是 `sh`（带引号的是**第二**个词元）⇒ 不是「首词错」。
    //      · 第 3 格 —— 首词未归一化 ⇒ `/bin/sh` / `env sh` / `nohup sh` 恒不命中
    //        （**承重的是 `headCommandNameOf`**；实测只留 `commandNameOf(rawHead)`
    //        会让 244 格定向语料里 28 格 label 由 `rm` 掉成 `""`）。
    //    bash 真值（Git Bash 5.3.15 实测，**真** `mktemp`/`true`、只 stub `marker` 且写独立
    //    日志；载荷已无害化 —— 用 stub `marker`，**不是** `rm -rf /tmp/zzz`）：
    //      第 1/2/3 格 → **RAN[marker]**、`A` 仍 unset ⇒ 真命令
    //      第 4 格     → **无 RAN**、`A=/bin/rm`              ⇒ 真赋值
    //    ⚠️ 第 4 格是**真赋值对照**（`> "$(true)" > out A=/bin/rm`，真值 ASSIGN）：它防的是
    //    日后把判据再收窄成「引号内的 opaque 一律算载荷」——那样会把这格打成 COMMAND。
    //    ⚠️ 它同时是「本批没把 HEAD 的过收带回来」的证据：该格 HEAD=deny（过收）、
    //    NOW/FIX=allow（正确）。
    //    ⚠️ 三个维度**判据相同**，故各只钉一格；不按「载荷写法 × 引号 × 归一化拼写 ×
    //    重定向」铺开成矩阵（那是「为了钉住而钉住」）。
    ['> "$(sh -c \'marker\')" > out A=/bin/rm', 'rm'],
    ['> $(sh "-c" "marker") > out A=/bin/rm', 'rm'],
    ['> $(/bin/sh -c "marker") > out A=/bin/rm', 'rm'],
    ['> "$(true)" > out A=/bin/rm', ''],
    // ⑪ **遍历全部分段**（第 11 圈修法 W 的靶，AL 组此前无语料守护）。⑩ 钉的是「入参怎么
    //    构造」的前三维（守卫 / 切分 / 归一化），本组钉的是**第四维**：`segs[0]` 只取第一个
    //    操作符分段，而本文件既有的 opaque 载荷机制（`rawCommandNames`）扫的是**所有**分片
    //    —— 实测 `rawCommandNames('$(true; sh -c "x")')` = `["true","sh"]`，即**既有机制本来
    //    就看得到 `sh`** ⇒ 只取首段是**同源没做全**，不是「不可区分边界」。
    //    bash 真值（Git Bash 5.3.15 实测，**真** `mktemp`/`true`、只 stub `marker` 且写独立
    //    日志；载荷已无害化 —— 用 stub `marker`，**不是** `rm -rf /tmp/zzz`）：
    //      第 1/2 格 → **RAN[marker]**、`A` 仍 unset ⇒ 真命令
    //      第 3 格   → **无 RAN**、`A=/bin/rm`              ⇒ 真赋值
    //    ⚠️ 第 3 格是**真赋值对照**（`> $(true; true) > out A=/bin/rm`，真值 ASSIGN）：它防的是
    //    日后把「分段里出现任何命令」当成载荷 —— 那样会把这格打成 COMMAND。
    //    ⚠️ **不为短路族（`||` / `&&`）补格**：`$(true || sh -c …)` / `$(false && sh -c …)`
    //    真值是 ASSIGN（短路）却被判 deny，但 **HEAD 也是 deny**（逐格同值）⇒ 那是
    //    **HEAD 既有行为、方向 fail-closed**，钉它等于把「已知过收」写成期望值。
    //    ⚠️ 两格分别承 `;`（顺序）与 `|`（管道）两种连接符；同族判据相同，不铺开成矩阵。
    ['> $(true; sh -c \'marker\') > out A=/bin/rm', 'rm'],
    ['> $(true | sh -c \'marker\') > out A=/bin/rm', 'rm'],
    ['> $(true; true) > out A=/bin/rm', ''],
  ]) {
    const d = decomposeCommand(c, 'bash')
    const lab = d.ok ? segmentLabel(d.segments[0].words, 'bash') : null
    if (lab !== want) bad.push(['opaque 占命令词位时 `NAME=` 被误判成赋值前缀', c, 'want=' + JSON.stringify(want), JSON.stringify(lab)])
    const a = assessCommand(c, 'bash', hDeny()).action
    if (want === 'rm' && a === 'allow') bad.push(['opaque 占命令词位时落大分类（fail-open）', c, a])
  }
  // ④ 引号内 `$()`（**引号内 `$()` 的 `noteOpaqueHead()` 调用**那条路径）：**只钉动作，不钉 label**（本轮补）。
  //    ⚠️ 这一格刻意**不进**上面那个 `[c, want]` 循环：该族 label 的 HEAD 值 `"rm"` 是**误报**
  //    （bash 真值命令名是 `2`，见上方订正段），把它写成 `want` 等于**把误报钉进语料**；而
  //    `""` 又是 fail-open 的那一态。两态都不可钉 ⇒ 只能钉**动作**（钉的是哪一下，见下）。
  //    ⚠️ **本格 deny 的真实来源就是上面那句 label 误报**：`"rm"` 命中 `DESTRUCTIVE_LABELS`
  //    ⇒ 该段被判破坏性 ⇒ 走破坏性子设置（本组配置 = 八档全 deny）⇒ `deny`。**并不存在**
  //    独立的「载荷不可读 ⇒ fail-closed」机制 —— 载荷根本没有谁去读。
  //    判别性实测（NOW + 本组 `hDeny()`）：
  //      · **只换载荷、不换 basename**：`"$(true)"2> out A=/bin/rm`（载荷完全无害）**照旧
  //        `deny`** ⇒ 动作与载荷内容无关；
  //      · **只换 basename、不换载荷**：`A=` 换成 `echo` / `ls` / `true` / `2` / `printf` /
  //        `cat` / `x` 这 7 个**非名单**名 ⇒ HEAD 与 NOW **双双 `allow`，7/7 无一例外**
  //        （「label 在名单外却仍非 allow」的形态：**0 个**）。
  //        Git Bash 5.3.15 无害 stub 实测：同一行**确实执行了载荷**（`rm -rf /tmp/zzz` 落到 stub），
  //        `A` 仍 unset ⇒ 确是真命令、确有危害，而判据照样放行。
  //    ⇒ 「载荷不可静态读取时不得静默放行」是**真值正确的安全属性，但当前没有任何机制实现它**；
  //      本格只是被那句 label 误报**顺带**拦下。**修正该 label 误报会让本格变红 —— 那是正确
  //      信号**（届时确无任何机制拦该命令），届时应**补上真正的载荷守卫**（让 opaque 载荷本身
  //      参与判定），**不要删本格**：删掉它等于连「误报顺带拦住的那一下」也一并失去，还会掩盖
  //      「引号内 `$()` 的 `noteOpaqueHead()` 调用」自此无人守护这一事实。
  //    守护对象：`shell-parse.js` 里**引号内 `$()` 的 `noteOpaqueHead()` 调用**（即引号分支内
  //    `char === '$'` 那条的 `markOpaque` 之后那一处；逐点变异实测：删其余五处时本格恒绿；
  //    反向实测：先删本格、再删那处调用，则套件 ALL PASS —— 即本格确是它**唯一**的守护）。
  //    ⚠️ 本行原先写的是 `:5857`，而**该行号在 `shell-parse.js` 里是一行注释**（删它对
  //    7580 格语料零差异）⇒ 原「唯一守护对象」的断言**为假**。真实守护对象是上面那处调用
  //    （逐点变异实测：删它 ⇒ 本格 `deny`→`allow`、套件 FAIL）。行号已全部换成锚点。
  //    ⚠️ 只放**带 `A=path` 后缀**的形态：同族无后缀的 `"$(sh -c '…')"2> out` 在 HEAD 就是
  //    `allow`（`A=` 缺席 ⇒ 那条赋值守卫不被咨询），钉它等于把既存 fail-open 写成期望值。
  for (const c of [
    "\"$(sh -c 'rm -rf /tmp/zzz')\"2> out A=/bin/rm",
  ]) {
    const a = assessCommand(c, 'bash', hDeny()).action
    if (a === 'allow') bad.push(['引号内 `$()` 载荷不可静态读取时被静默放行（fail-open）', c, a])
  }
  ok('★★ AL bash 侧赋值守卫区分「整体引号」（真命令）与「无引号」（真赋值）+ 引号/转义插入族 + 操作符位六格（`>|` / `>&` / `>` / 前置 `>|` / `$( )` / `$( )`+重定向后缀）+ opaque 占命令词位三格（具名目标后 `NAME=path` 的 `$()` 与花括号展开两条路径 / 无 opaque 反向对照）+ opaque 占**重定向目标位**六格（靶 `> $(mktemp) r"m" A=/bin/rm > out2` 与真赋值对照 `> $(true) X=/bin/marker` + 段首 `NAME=` 靶 `FOO=/usr/bin/rm 2> $(mktemp) marker` 与其回归守卫 `> $(mktemp) r"m" A=/bin/rm` + 带内联程序靶 `> $(sh -c \'marker\') > out A=/bin/rm` 与其真赋值对照 `> $(true) > out A=/bin/rm` + 带内联程序**入参构造三维度**四格（引号内站点 / 带引号标志 / 未归一化首词 各一靶 + 真赋值对照 `> "$(true)" > out A=/bin/rm`）+ **遍历全部分段**三格（`;` 靶 / `|` 靶 / 真赋值对照 `> $(true; true) > out A=/bin/rm`））+ 引号内 `$()` 载荷不可静态读取时不得静默放行（只钉动作，引号内 `$()` 的 `noteOpaqueHead()` 调用那条路径）+ pwsh 零变化',
    bad.length === 0, JSON.stringify(bad.slice(0, 8)))
}


// ─────────────────────────────────────────────────────────────────────────────
if (fail.length) {
  console.log('\nFAIL (' + fail.length + ')：')
  for (const f of fail) console.log('  ✗ ' + f)
  process.exit(1)
}
console.log('\nSHELL-PARSE ALL PASS')
