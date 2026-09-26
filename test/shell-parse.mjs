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
  decomposeCommand, segmentLabel, isDestructiveLabel, assessCommand, matchCommand,
  expandTilde, globRootOf, unwrapWords, flagEmbeddedPath, looksLikeExplicitPath,
  tildeUserTarget, isNullSink, DESTRUCTIVE_LABELS, SHELL_OF_TOOL,
} from '../shell-parse.js'

const ROOT = pathResolve(pathJoin(fileURLToPath(import.meta.url), '..', '..'))
const fail = []
const ok = (name, cond, extra) => { if (!cond) fail.push(name + (extra ? ' — ' + extra : '')) }
const group = (t) => console.log('\n— ' + t)

const HOME = 'C:/Users/me'
const WS = 'G:/MCP'

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
  const d6 = run('echo "C:\\\\path\\\\to"', 'pwsh')
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
    ['F5 Remove-Item', 'Remove-Item -Recurse -Force C:\\x', 'pwsh', 'remove-item'],
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
    ['F19 icacls', 'icacls C:\\x /grant everyone:F', 'pwsh', 'icacls'],
    ['F20 takeown', 'takeown /f C:\\x /r', 'pwsh', 'takeown'],
  ]
  for (const [label, cmd, shell, wantLabel] of cases) {
    const r = run(cmd, shell)
    ok(label + ' 【' + cmd + '】label = ' + wantLabel, r.segments[0].label === wantLabel, 'got=' + r.segments[0].label)
    ok(label + ' code = destructive', r.segments[0].code === 'destructive', JSON.stringify(r.segments[0]))
    ok(label + ' 落 destructive 子设置（source=destructive）', r.segments[0].source === 'destructive', JSON.stringify(r.segments[0]))
  }

  // ★ 核心：command 大分类 = allow 时，破坏性命令仍按子设置走（修好 DANGEROUS_CMD_RE 的失效）
  for (const [label, cmd, shell] of [['F21 Remove-Item', 'Remove-Item -Recurse -Force C:\\x', 'pwsh'], ['F22 taskkill', 'taskkill /f /im x.exe', 'pwsh'], ['F23 icacls', 'icacls C:\\x /grant everyone:F', 'pwsh'], ['F24 rm', 'rm -rf x', 'bash']]) {
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
  ok('K29 globRootOf C:* 归约到盘符', globRootOf('C:*') === 'C:')

  ok('K30 unwrapWords 剥前导赋值（值可为空）', unwrapWords(['FOO=', 'sudo', 'ls']).words.join(' ') === 'sudo ls')
  ok('K31 unwrapWords 剥 timeout 带值 flag 与时长', unwrapWords(['timeout', '-s', 'KILL', '5', 'sudo', 'ls']).words.join(' ') === 'sudo ls')
  ok('K32 unwrapWords env -S 判读不懂', unwrapWords(['env', '-S', 'x']).opaque === true)
  ok('K33 unwrapWords 不剥非 wrapper', unwrapWords(['rm', '-rf', 'x']).words.join(' ') === 'rm -rf x')

  ok('K34 flagEmbeddedPath 长选项 =', flagEmbeddedPath('--output=C:/abs') === 'C:/abs')
  ok('K35 flagEmbeddedPath 融合短选项', flagEmbeddedPath('-oC:/abs') === 'C:/abs')
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

// ─────────────────────────────────────────────────────────────────────────────
if (fail.length) {
  console.log('\nFAIL (' + fail.length + ')：')
  for (const f of fail) console.log('  ✗ ' + f)
  process.exit(1)
}
console.log('\nSHELL-PARSE ALL PASS')
