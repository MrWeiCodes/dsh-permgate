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
import {
  decomposeCommand, segmentLabel, isDestructiveLabel, isDestructiveSegment, canCarryDestructivePayload,
  isPayloadCarrierLabel, assessCommand, matchCommand,
  expandTilde, globRootOf, unwrapWords, flagEmbeddedPath, looksLikeExplicitPath,
  tildeUserTarget, isNullSink, DESTRUCTIVE_LABELS, SHELL_OF_TOOL,
  blastRadiusOf, blastRadiusOfSegment, blastRadiusOfCommandPattern, BLAST_ORDER,
  rawCommandNames,
} from '../shell-parse.js'

const ROOT = pathResolve(pathJoin(fileURLToPath(import.meta.url), '..', '..'))
const fail = []
const ok = (name, cond, extra) => { if (!cond) fail.push(name + (extra ? ' — ' + extra : '')) }
const group = (t) => console.log('\n— ' + t)

const HOME = 'C:/Users/me'
const WS = 'X:/ws'

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

  // ★★ F97：wrapper 表缺条目时**不得抛异常**。
  // 曾经 `WRAPPER_VALUE_FLAGS[name][token]` 对 `command`/`builtin`/`exec`/`nohup`/`setsid`
  // 直接取下标（它们在 WRAPPERS 里但没有带值选项）→ TypeError。
  // 崩溃点在 tools/pre-execute 的判定链上，异常被上层 catch 后走 next() ——
  // **比漏判更糟：该次调用直接 fail-open**。
  ok('★★ F97 wrapper 无带值选项表时不抛异常（否则判定链崩溃 → fail-open）', (() => {
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
if (fail.length) {
  console.log('\nFAIL (' + fail.length + ')：')
  for (const f of fail) console.log('  ✗ ' + f)
  process.exit(1)
}
console.log('\nSHELL-PARSE ALL PASS')
