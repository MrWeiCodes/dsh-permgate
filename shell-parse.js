// dsh-permgate — 命令结构化分解与段级判定（纯函数，不依赖 DSH 运行时）
//
// 为什么独立成文件：命令解析是自成一体的纯函数，不依赖 permgate 的任何闭包状态，
// 可独立单元测试；index.js 已近 4800 行 / 310 KB，逼近可维护上限。
//
// 本文件存在的理由（核心安全属性）：
//   allow 例外是「对某个命令形态的授权」，它的作用范围必须精确等于用户写下的那一条命令 ——
//   不能因为命令里还串了别的段，就顺带放行那些段。
//   旧实现用【整条命令串】匹配例外，于是 `git status *` 编译出的 `^git status( .*)?$` 里的 `.*`
//   吞掉了 `;` `|` `&&` `` ` `` `$()` 之后的一切，实测 11 条命令被静默执行（含 `rm -rf ~/.dsh`）。
//   本文件把匹配对象从「整条命令串」改为「单个命令段」，这是唯一的根因修复点。
//
// 失败方向一律 fail-closed：读不懂的构造标段级 opaque，整行读不懂则返回 ok:false，
// 由调用方落回分类默认值 —— 绝不猜测 shell 语义（那是参考工程 3600 行的深度，不在本次范围）。

// 命令工具 → shell 方言：index.js 的 COMMAND_TOOLS 由它派生，保证「工具属于哪个 shell」只有一份定义
export const SHELL_OF_TOOL = { pwsh: 'pwsh', bash: 'bash' }

/**
 * 破坏性命令名单 —— `command` 分类下「破坏性命令」子设置（destructive）的内置内容。
 *
 * 名单**固定，不开放用户增删**：用户能改的只有子设置的 action（询问/允许/拒绝）与 reason。
 * 理由：判定内容一旦可编辑，就会出现「名单被清空后用户以为还有保护」的假象；
 * 而名单本身是内置知识，不是用户策略。
 *
 * 匹配对象是**段首 label**（由 segmentLabel 归一化：去路径前缀、去 .exe、小写），
 * 不是整条命令串的子串 —— 旧实现用整串正则匹配，于是 `format` 这个词出现在任何位置都算危险：
 * `git log --format=oneline`、`docker ps --format json`、`npm run format`、`echo "takeown"`
 * 全被判危险，用户配的 `git log *`、`Get-Process *` allow 例外永远走不到免审通道。
 *
 * 刻意**不列入**默认名单（避免误伤日常操作）：
 *   mv / cp / Set-Content / Out-File / New-Item / Copy-Item / tee / git push / npm publish
 * 它们都能造成破坏，但都是高频日常操作，列入会让默认体验变成「每两步一弹窗」。
 */
export const DESTRUCTIVE_LABELS = new Set([
  // 删除 / 销毁
  'rm', 'rmdir', 'del', 'erase', 'rd', 'remove-item', 'ri',
  'dd', 'mkfs', 'shred', 'truncate', 'wipefs',
  // 磁盘 / 分区
  'format', 'diskpart', 'fdisk', 'parted',
  // 进程 / 电源
  'taskkill', 'kill', 'pkill', 'killall', 'stop-process', 'stop-computer',
  'shutdown', 'reboot', 'halt', 'poweroff',
  // 提权
  'sudo', 'doas', 'su', 'pkexec', 'runas', 'gsudo',
  // 权限 / 属主
  'icacls', 'takeown', 'chmod', 'chown', 'chgrp', 'set-executionpolicy',
  // 注册表 / WMI
  'reg delete', 'wmic',
])

// 语句关键字：段首是它们时，真正的命令还在后面（`foreach ($x in $y) { Remove-Item $x }`）。
//
// 两张表分开维护，判定时**任一张命中**就继续向后找 —— 因为本模块不知道这段属于哪个 shell
// （`segmentLabel` 只拿词元列表，方言在词法器那一层才用得上）。合表的代价是极小的：
// 这些词在任何一门语言里都不是可执行命令名，多跳过一个是无害的。
//
// bash 侧曾经完全缺失（本表只有 PowerShell 词汇），后果是 `;` 分段之后
// `if true; then rm -rf ~/.dsh; fi` 的 `then rm -rf ~/.dsh` 这一段把 `then` 当成命令名，
// 真正的 `rm` 再也不会被看到 —— 破坏性子设置整个跳过（实测：大分类 allow + 子设置 deny 时，
// `rm -rf ~/.dsh` 是 deny，而包在 if/then/fi 里就是 allow）。`do` 恰好在 PS 表里，
// 所以 `while ...; do rm ...; done` 反而是 deny —— 这种「同一构造换个关键字就失效」正是遗漏的特征。
const PS_KEYWORDS = { foreach: 1, if: 1, else: 1, elseif: 1, for: 1, while: 1, do: 1, until: 1, switch: 1, return: 1, function: 1, filter: 1, param: 1, begin: 1, process: 1, end: 1, try: 1, catch: 1, finally: 1, throw: 1, break: 1, continue: 1, trap: 1, in: 1, not: 1, and: 1, or: 1, class: 1, enum: 1, using: 1, exit: 1, dynamicparam: 1, data: 1 }
// bash 语句关键字与保留字：then/elif/fi/done/esac 是 if/for/while/case 的分段结果，
// time 与 ! 是命令前缀，case/select/coproc 开启新语句。
const BASH_KEYWORDS = { then: 1, elif: 1, fi: 1, done: 1, esac: 1, time: 1, '!': 1, case: 1, select: 1, coproc: 1, '{': 1, '}': 1 }
const STATEMENT_KEYWORDS = Object.assign({}, PS_KEYWORDS, BASH_KEYWORDS)

// 子命令路由器命令族：label 细化到「git status」这一粒度，而不是一放全放「git *」。
// reg 也在此列：`reg delete` 是破坏性的而 `reg query` 不是，不细分就无法区分。
const ROUTER_CMDS = { git: 1, npm: 1, pnpm: 1, yarn: 1, docker: 1, kubectl: 1, dotnet: 1, cargo: 1, go: 1, gh: 1, pip: 1, uv: 1, conda: 1, reg: 1 }

// 路由器命令的「带值选项」：跳过选项本身后还要跳过它的值（git -c key=val / npm --prefix ./x）
const ROUTER_OPT_VALUE = { '-c': 1, '-C': 1, '--config': 1, '--config-env': 1, '--git-dir': 1, '--work-tree': 1, '--namespace': 1, '--exec-path': 1, '-H': 1, '--prefix': 1, '--cwd': 1, '--project': 1, '--registry': 1 }

// 前缀包装器：它们不改变后面命令的语义，但会占住「命令名」的位置，
// 使有效命令名判错 —— `env -u FOO rm -rf /` 剥之前有效命令名是 `FOO`，破坏性判定整个跳过。
//
// 除计划 §2.2 裁剪版列的 4 个之外，这里补了 4 个**同样常见且不改语义**的前缀：
//   command / builtin / exec —— shell 内建的前缀，后面跟的才是真命令
//   nohup / setsid            —— 只改信号与会话，不改命令
//   stdbuf / ionice           —— 只改缓冲与 IO 优先级
// 不加它们的后果与「wrapper 漏剥」完全同类：实测（子设置 deny、大分类 allow）
//   `find . -delete` → deny，而 `nohup find . -delete` / `command find . -delete` → allow，
//   `nohup rm -rf /x` 同样绕过破坏性判定。它们不是「罕见形态」，是日常写法。
// 代价：这些名字若真被当作命令调用（例如某个叫 `time` 的可执行文件），会被跳过一层 ——
// 但它们都是 shell 保留字或系统自带工具名，不存在同名用户命令的正常用法。
const WRAPPERS = { env: 1, timeout: 1, nice: 1, xargs: 1, command: 1, builtin: 1, exec: 1, nohup: 1, setsid: 1, stdbuf: 1, ionice: 1 }
// 各 wrapper 的「带值 flag」：`-u FOO` 里的 FOO 是值不是命令。
// 只认精确拼写（`--unset=FOO` 自带值，不消耗下一个词元）。
const WRAPPER_VALUE_FLAGS = {
  env: { '-u': 1, '-C': 1, '-S': 1, '--unset': 1, '--chdir': 1, '--split-string': 1, '--argv0': 1 },
  timeout: { '-s': 1, '-k': 1, '--signal': 1, '--kill-after': 1 },
  nice: { '-n': 1, '--adjustment': 1 },
  xargs: { '-n': 1, '-I': 1, '-i': 1, '-P': 1, '-L': 1, '-s': 1, '-d': 1, '-E': 1, '-a': 1, '--max-args': 1, '--replace': 1, '--max-procs': 1, '--max-lines': 1, '--max-chars': 1, '--delimiter': 1, '--eof': 1, '--arg-file': 1 },
  stdbuf: { '-i': 1, '-o': 1, '-e': 1, '--input': 1, '--output': 1, '--error': 1 },
  ionice: { '-c': 1, '-n': 1, '-p': 1, '-P': 1, '-u': 1, '--class': 1, '--classdata': 1, '--pid': 1, '--pgid': 1, '--uid': 1 },
}

// 嵌套解释器：带内联程序时整段不可静态解析（程序正文是我们读不懂的另一门语言）。
// 不带内联程序的不算（`node --check x.js`、`python script.py` 都是可读的常规调用）。
const NESTED_INTERPRETERS = { node: 1, deno: 1, bun: 1, python: 1, python3: 1, perl: 1, ruby: 1, php: 1, lua: 1, osascript: 1 }
const NESTED_SHELLS = { sh: 1, bash: 1, zsh: 1, fish: 1, ksh: 1, dash: 1, cmd: 1, powershell: 1, pwsh: 1 }
// eval 族必然执行字符串，没有「不带程序」的形态
const NESTED_EVAL = { eval: 1, iex: 1, 'invoke-expression': 1 }
// 解释器的内联程序 flag：`-e` / `-c` / `--eval` …，以及融合短选项（`node -pe` / `bash -lc`）。
//
// 融合形态必须覆盖：`bash -lc 'rm -rf x'` 与 `bash -c 'rm -rf x'` 完全等价（实测 Git Bash 两者
// 都执行字符串），但旧实现只认精确拼写与「以 e 结尾」，于是 `-lc` / `-ec` / `-ic` / `-uc` 全被
// 判成「可读的普通调用」—— 既不标 unparsable，也就**可以被 allow 例外授权**，
// 直接推翻「读不懂的内容不可被授权」这条底线（实测：例外 `bash *` 能放行 `bash -lc "rm -rf ~/.dsh"`，
// 却放行不了 `bash -c "..."`，只因后者被判 unparsable）。
//
// 判据放宽为「短选项串里含 c 或 e」：`c` 覆盖 shell 的 -c 与 python 的 -c，`e` 覆盖
// perl/ruby/node 的 -e。宁可多判 opaque（方向是收紧、只多弹一次窗），也不能漏判（方向是静默放行）。
const INLINE_PROGRAM_FLAG = /^(?:-c|-e|-E|--eval|--exec|--command|--print|-[A-Za-z]*[ceE])$/

// 命令名里出现这些字符即视为「认不出」（变量、通配符、shell 元字符）
const BAD_LABEL_CHARS = /[$%{}()'"`*?<>|;&=]/

// `decomposeCommand` 对「整行没有任何命令」返回的 reason。单独抽成常量是因为
// `assessCommand` 要按它把 code 分成 'empty' 与 'unparsable' 两种 —— 这两者排查方向不同
// （前者是调用方发了空串，后者是解析器覆盖不足），不该混成一个标注。
const EMPTY_COMMAND_REASON = 'the command line contains no command'

// 绝对路径直扫（绕过词法器）：bash 词法器把 `\` 当转义符，未加引号的
// `cat C:\Users\u\.ssh\id_rsa` 到达词元列表时已变成 `C:Usersu.sshid_rsa` ——
// 正好是这条规则要拦的那次读取的盘符形态。Windows 上的轻量实现必然复现同一个 bug，
// 1 行正则 + 5 行循环即可补上。这不是第二套词法器：只扫字面量绝对路径拼写，
// 加进候选后由同一套解析判定。
export const RAW_ABSOLUTE_PATH = /(?:^|[^A-Za-z0-9_])((?:[A-Za-z]:[\\/]|\\\\[^\s"'|&;<>()]+)[^\s"'|&;<>()]*)/g

// 双语文案（与 index.js 的 bi 同形；本文件不依赖宿主，自带一份 3 行实现）
const bi = (zh, en) => ({ zh, en })

function matchAt(re, input, index) {
  re.lastIndex = index
  const m = re.exec(input)
  return m === null ? undefined : m[0]
}

/**
 * 从一个词元取出「命令名」：剥路径前缀（两种分隔符都算）与可执行后缀，转小写。
 * 这是修好「命令名提取器认不出路径形态」的关键 —— 旧实现显式丢弃任何含 `:` `\` `/` 的词元，
 * 于是 `C:\Windows\System32\rm.exe -rf x`、`/usr/bin/rm -rf x`、`./rm -rf x` 全部提取为空，
 * 破坏性判定对它们完全不设防。
 */
function commandNameOf(text) {
  let t = String(text == null ? '' : text).trim()
  if (!t) return ''
  const idx = Math.max(t.lastIndexOf('/'), t.lastIndexOf('\\'))
  if (idx >= 0) t = t.slice(idx + 1)
  t = t.replace(/\.(?:exe|cmd|bat|com|ps1)$/i, '')
  return t.toLowerCase()
}

/**
 * 通配匹配的**线性**实现（`*` 任意长、`?` 恰好一个字符），两边都必须已转小写。
 *
 * 为什么不用正则：旧实现把用户写的 glob 逐字符翻成 `^…$` 正则，每个 `*` 变成 `.*`。
 * 多个 `.*` 夹在固定字面量之间、且整体**不匹配**时，回溯是组合爆炸 ——
 * 实测 `matchCommand('*a*a*a*a*a*a*a*a*a*a*b', 'a'.repeat(40))` 耗时 25 秒，
 * 长度 200 时直接挂死进程（探针跑满 180 秒未结束）。而段文本由 AI 完全控制、
 * 每条例外每个段都要匹配一次，判定挂起意味着 `tools/pre-execute` 不返回。
 *
 * 这里是经典的「记住最后一个星号」单趟扫描：最坏 O(n·m)，但**没有指数项**，
 * 且真实输入下基本是线性的。语义与旧正则一致（`*` 可匹配空串、`?` 匹配任意单字符）。
 *
 * ⚠️ **星号必须判在「字符相等」之前**（下面的顺序不能调换）：
 * 曾经的写法是先 `pat[p] === hay[h]` 再判 `*`，于是 pattern 里的 `*` 一旦撞上
 * haystack 里的**字面 `*`**，就走「字符相等」分支 —— `p`/`h` 同步前进、`star` 回退点
 * 从未记录，模式的 `*` 彻底丧失「任意长」语义。这是 AI 可轻易利用的绕过：
 *   例外 `rm -rf *` = deny 时，`rm -rf /data` 是 deny，而 `rm -rf *.log` 是 **allow**
 *   （haystack 里的字面 `*` 把模式的星号「吃掉」了）。
 * 随机对拍（字母表 `a*?`）下与旧正则实现的不一致率高达 21%，全部集中在
 * 「haystack 含 `*`/`?`」这一类 —— 而 AI 写的命令里带通配符是极常见的形态。
 * 让星号优先即可：先记录回退点，再让字符相等/`?` 走正常前进。
 */
function globMatch(pat, hay) {
  let p = 0
  let h = 0
  let star = -1
  let mark = 0
  while (h < hay.length) {
    // 星号优先：必须先于字符相等判断，否则会与 haystack 里的字面 `*` 相撞而失效
    if (p < pat.length && pat[p] === '*') { star = p; p += 1; mark = h; continue }
    if (p < pat.length && (pat[p] === '?' || pat[p] === hay[h])) { p += 1; h += 1; continue }
    // 失配：回退到最后一个星号，让它多吞一个字符（只有这一处回退，故不爆炸）
    if (star !== -1) { p = star + 1; mark += 1; h = mark; continue }
    return false
  }
  while (p < pat.length && pat[p] === '*') p += 1
  return p === pat.length
}

/**
 * 命令例外的模式匹配（单一来源：index.js 的例外判定与本文件的测试共用这一份）。
 *
 * 无通配符 → **词边界精确**（段 === pat，或段以 `pat ` 开头）。
 *   旧实现是 `indexOf !== -1`（非锚定子串），于是例外 `log` 会命中 `dialog --msgbox "rm -rf /"`，
 *   例外 `npm` 会命中 `echo hi > /tmp/x; npm publish`。
 *   不用「整串相等」是因为 `git commit -m` 这类例外必须能匹配带参数的实际命令
 *   （`git commit -m "fix bug"`）—— 词边界精确两者兼得。
 *
 * 有通配符 → 锚定整段的通配匹配（线性算法，见 globMatch）。
 *   `cmd *` 尾随通配保留「也匹配无参数原命令」的语义：`git status *` 同时覆盖 `git status`。
 *   这个通配现在安全了：匹配对象已经是单个命令段，它再也吞不到别的段。
 */
// 小写化的单条目 memo：段级判定里同一段文本会被**每条例外**各匹配一次
// （`resolveCategory` 遍历例外列表 → 每条例外一次 `matchCommand`），
// 而 `toLowerCase` 必须遍历整个 hay —— 段长 × 例外数就是纯重复劳动。
// 实测 399 KB 段上 toLowerCase 占单次匹配的 97.2%；200 条例外时真实链路
// 从 16.0 ms 涨到 34.1 ms（+44.7%），而 HEAD 的 `/i` 正则不做小写化、无此增长。
// 单条目足够：调用方总是拿同一段文本连续匹配多条例外，命中率接近 100%。
// 只缓存 hay（调用方的 pattern 每次都在变，缓存它没有收益）。
let memoHay = null
let memoLow = ''

export function matchCommand(pat, hay) {
  const p = String(pat == null ? '' : pat)
  const h = String(hay == null ? '' : hay)
  // 空 pattern 不匹配任何命令（否则空串恒真，等于放行所有命令）
  if (!p) return false
  if (h !== memoHay) { memoHay = h; memoLow = h.toLowerCase() }
  const lh = memoLow
  if (p.indexOf('*') === -1 && p.indexOf('?') === -1) {
    const lp = p.toLowerCase()
    return lh === lp || lh.startsWith(lp + ' ')
  }
  const lp = p.toLowerCase()
  // 「cmd *」尾随通配：`git status *` 既要匹配 `git status --short`，也要匹配 `git status`
  // （正则时代是 `( .*)?` 那个可选组）。两种形态取并集，语义等价。
  if (lp.endsWith(' *')) {
    const body = lp.slice(0, -2)
    return globMatch(body, lh) || globMatch(body + ' *', lh)
  }
  return globMatch(lp, lh)
}

/** 是否为丢弃输出的空汇（`> /dev/null`、pwsh `> $null` / `> NUL`）。不排除会让日常命令全部误报。 */
export function isNullSink(text, shell) {
  const t = String(text == null ? '' : text).trim().toLowerCase()
  return t === '/dev/null' || (shell === 'pwsh' && (t === '$null' || t === 'nul'))
}

/** `~user/…` 是**他人**家目录，任何已配置 root 都包含不了（普通 `~` 与 `~/` 不在此列）。 */
export function tildeUserTarget(text) {
  const t = String(text == null ? '' : text)
  return t.length > 1 && t.startsWith('~') && !t.startsWith('~/') && !t.startsWith('~\\')
}

/**
 * 裸词元是否显式路径。两个易漏项：点开头（`.git/config`、`.env`）与中段 `..`
 * （`b/../../../../Users/…` 只以普通名字开头，却能爬出工作区，与开头的 `../` 等价）。
 */
export function looksLikeExplicitPath(token) {
  const t = String(token == null ? '' : token)
  if (!t) return false
  if (t.startsWith('/') || t.startsWith('.') || t.startsWith('~')
    || /^[A-Za-z]:[\\/]/.test(t) || /^\\\\/.test(t)) return true
  // 中段 `..` 判定：单趟扫描，不分配数组。
  // 曾用 `t.split(/[\\/]/).includes('..')` —— 它每次调用都要切分并建一个数组，
  // 而这个函数在 flagEmbeddedPath 的循环里被反复调用（热路径）。语义完全等价：
  // 存在某个被分隔符（或串首/串尾）包住的、内容恰为 `..` 的片段即为真。
  //   `b/../x`、`a\..\b`、`x/..`、`..` → true；`..x`、`x..`、`x..y` → false
  for (let i = 0; i + 1 < t.length; i += 1) {
    if (t.charCodeAt(i) !== 46 || t.charCodeAt(i + 1) !== 46) continue  // 两个 '.'
    const before = i === 0 || t.charCodeAt(i - 1) === 47 || t.charCodeAt(i - 1) === 92
    if (!before) continue
    const after = i + 2 === t.length || t.charCodeAt(i + 2) === 47 || t.charCodeAt(i + 2) === 92
    if (after) return true
  }
  return false
}

/**
 * 从 flag 词元里撬出路径值：长选项在 `=` 后（`--output=C:/abs`），
 * 融合短选项把值接在选项字母后（`-oC:/abs`，GNU sort/tree 风格）。
 * 只取「显式路径拼写」的值，所以 `--pretty=format:%h`、`--parallel=2` 不会被误取。
 */
export function flagEmbeddedPath(text) {
  const t = String(text == null ? '' : text)
  const eq = t.indexOf('=')
  if (eq > 1) {
    const value = t.slice(eq + 1)
    return value !== '' && looksLikeExplicitPath(value) ? value : undefined
  }
  // 融合短选项：从每个可能的切点向后扫，贪婪匹配选项字母会吞掉盘符而藏起值。
  //
  // 性能：曾无条件 `t.slice(cut)` 再交给 looksLikeExplicitPath，切片拷贝量累加为
  // Σ(L−cut) = **O(L²)** —— 实测 L=128000 时 264 ms、L=256000 时 1034 ms（倍率趋近 4.0）；
  // 端到端 `'echo -' + 'a'.repeat(399000)` 单次判定 2551 ms，而等长的带 `=` 形态仅 18.2 ms。
  // 这段代码在 collectWritePaths 里对**每一段**都跑，段文本由 AI 控制且无长度上界。
  //
  // 优化：切片前先做 O(1) 的必要条件预筛，只在可能命中时才切片。
  // looksLikeExplicitPath(tail) 为真的必要条件有两条（任一成立即可）：
  //   ① tail 首字符 ∈ { '/', '.', '~', '\' }，或构成盘符 `X:` + 分隔符；
  //   ② tail 含 `..`（它的 `split(/[\\/]/).includes('..')` 分支）。
  // ② 与首字符无关（`a\..` 的 tail 首字符是字母也能命中），故不能只按首字符预筛 ——
  // 对拍时踩过：漏掉 ② 会让 `baa\..\~` 这类输入在更晚的切点才命中、返回值随之改变。
  // 「tail 从 cut 起是否含 `..`」等价于「**最后一次** `..` 出现的位置 ≥ cut」，
  // 所以只需从串尾反向扫一次求出该位置，之后每个 cut 都是 O(1) 判断。
  // 预筛只跳过必然为假的切点，不改变任何切点的判定结果与顺序，返回值与原实现逐字等价。
  let lastDotDot = -1
  for (let i = t.length - 2; i >= 0; i -= 1) {
    if (t.charCodeAt(i) === 46 && t.charCodeAt(i + 1) === 46) { lastDotDot = i; break }
  }
  for (let cut = 2; cut < t.length; cut += 1) {
    const c = t.charCodeAt(cut)
    let couldBePath = c === 47 || c === 46 || c === 126 || c === 92
    if (!couldBePath && lastDotDot >= cut) couldBePath = true
    if (!couldBePath) {
      // 盘符分支 `/^[A-Za-z]:[\\/]/`：字母 + ':' + 分隔符
      if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) {
        if (t.charCodeAt(cut + 1) === 58) {
          const d = t.charCodeAt(cut + 2)
          couldBePath = d === 47 || d === 92
        }
      }
    }
    if (!couldBePath) continue
    const tail = t.slice(cut)
    if (looksLikeExplicitPath(tail)) return tail
  }
  return undefined
}

/**
 * 展开 `~` / `~/x` 为 home。返回：
 *   · 展开后的路径 —— 普通形态；
 *   · `null` —— 无法判定为「在已配置根之内」（`~user/…` 是他人 home；home 解析不出时 `~/x` 也无从展开）。
 *     调用方据此按「工作区外」处理，方向 fail-closed。
 */
export function expandTilde(target, home) {
  const t = String(target == null ? '' : target)
  if (tildeUserTarget(t)) return null
  if (t === '~' || t.startsWith('~/') || t.startsWith('~\\')) {
    const h = String(home == null ? '' : home)
    if (!h) return null
    return h + t.slice(1).replace(/\\/g, '/')
  }
  return t
}

/** 把 glob 目标归约到「它逃不出去的最深目录」，使 `/*` 按 `/` 判而不是按相对路径判。 */
export function globRootOf(target) {
  const t = String(target == null ? '' : target)
  const parts = t.split(/[\\/]/)
  const index = parts.findIndex((part) => /[*?]/.test(part))
  if (index < 0) return t
  const kept = parts.slice(0, index)
  if (kept.length === 0) {
    // 盘符段自身含通配（`C:*`）仍指盘根：交回盘符，而不是塌成当前目录
    const drive = /^([A-Za-z]):/.exec(parts[0] || '')
    return drive !== null ? drive[1].toUpperCase() + ':' : '.'
  }
  if (kept.length === 1 && kept[0] === '') return t.startsWith('\\') ? '\\' : '/'
  return kept.join(t.includes('\\') && !t.includes('/') ? '\\' : '/')
}

/**
 * 剥离前缀包装器与前导 `NAME=value`，使有效命令名归位。
 *
 * 不剥的后果（参考工程记录的三个真实绕过）：
 *   `env -u FOO rm -rf /`       → 有效命令名成了 flag 的值 `FOO`
 *   `timeout -s KILL 5 sudo ls` → 成了 `KILL`
 *   `BLAH=0 sudo ls`            → 成了 `blah=0`
 * 三者的提权/破坏性判定都会整个跳过。空值形态 `FOO= sudo ls` 同样要剥
 * （要求值非空会漏掉它），故 `=` 后的值部分是可选的。
 *
 * @returns {{ words: string[], opaque: boolean }} opaque 为真表示剥出来的形态读不懂
 *   （目前只有 `env -S/--split-string VALUE`：它的值是一整条命令行）。
 */
export function unwrapWords(words) {
  let current = Array.isArray(words) ? words.slice() : []
  // 前导 NAME=value（值可为空）。用游标推进而不是 `current = current.slice(1)`：
  // 后者每剥一个词元就复制一次整个数组，前缀多时是 O(k²)。
  // 实测 32000 个 `A=1` 前缀：逐次 slice 946 ms，游标写法 ~1 ms —— 而它在 segmentLabel 里
  // 被逐段调用、segmentLabel 又在 assessCommand 的每段循环里跑，是判定热路径。
  let lead = 0
  while (current.length - lead > 1 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(String(current[lead]))) lead += 1
  if (lead > 0) current = current.slice(lead)
  for (let depth = 0; depth < 4; depth += 1) {
    const name = commandNameOf(current[0])
    if (!WRAPPERS[name]) break
    let index = 1
    while (index < current.length) {
      const token = String(current[index])
      // env 自身也接受 NAME=value 形态的赋值前缀
      if (name === 'env' && /^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) { index += 1; continue }
      if (!token.startsWith('-')) break
      // `-S/--split-string` 的值是一整条命令行：本裁剪版不做拼接，直接判不可解析
      if (name === 'env' && (token === '-S' || token === '--split-string')) return { words: current, opaque: true }
      // `command -v X` / `command -V X` 是**查询** X 的位置，不执行它 ——
      // 剥掉前缀会把 X 当成命令，于是 `echo $(command -v rm)` 被判成破坏性命令（实测误报）。
      // 这不是 wrapper 语义，直接判「读不懂」：调用方会落回大分类，而不是拿 X 去做判定。
      if (name === 'command' && (token === '-v' || token === '-V')) return { words: current, opaque: true }
      // 表里没有该 wrapper 的条目时不能直接取属性 —— 会抛 TypeError。
      // 这里曾漏掉：`command`/`builtin`/`exec`/`nohup`/`setsid` 没有带值选项，
      // 于是 `WRAPPER_VALUE_FLAGS[name][token]` 对 `undefined` 取下标而崩溃。
      // 崩溃点在 tools/pre-execute 的判定链上，后果是**该次调用直接 fail-open**
      // （异常被上层 catch 后走 next()），比漏判更糟。用 `|| {}` 兜住。
      const valueFlags = WRAPPER_VALUE_FLAGS[name] || {}
      if (valueFlags[token]) index += 1
      index += 1
    }
    // timeout 的时长位置参数（`timeout 5 sudo ls`）
    if (name === 'timeout' && /^[0-9]+(?:\.[0-9]+)?[smhd]?$/.test(String(current[index] == null ? '' : current[index]))) index += 1
    const next = current.slice(index)
    if (next.length === 0) return { words: current, opaque: false }
    current = next
  }
  return { words: current, opaque: false }
}

/**
 * 从段的词元提取「命令 label」（小写，路由器命令含子命令如 `git status`）：
 *   · 剥掉路径前缀与 .exe（`C:\Windows\System32\rm.exe` → `rm`；`/usr/bin/rm` → `rm`）
 *   · 剥掉前导 NAME=value 与 wrapper（见 unwrapWords）
 *   · 是 router 时继续取子命令（跳过选项与带值选项）
 *   · PowerShell 关键字（foreach/if/…）继续向后找真正的命令
 *   · 认不出（变量开头、纯表达式、空段、wrapper 形态读不懂）→ 返回 ''
 */
export function segmentLabel(words) {
  const u = unwrapWords(words)
  if (u.opaque || !u.words.length) return ''
  const w = u.words
  let idx = 0
  let head = commandNameOf(w[0])
  if (!head || BAD_LABEL_CHARS.test(head)) return ''
  // 语句关键字：向后找真正的命令。**必须循环**，因为跳过一个关键字后遇到的可能是
  //   ① 又一个关键字（`case x in a) rm …` 的 `in` 也是关键字）；
  //   ② 一个 wrapper（`then nohup rm …` 的 `nohup` —— 它在关键字之后，unwrapWords 没机会剥它，
  //      因为 unwrapWords 只看词元序列的**开头**，而开头是 `then`）。
  // 曾经这里只扫一趟、取第一个非关键字词元就收工，于是上面两种形态的 label 分别是
  // `x` / `nohup` —— 破坏性子设置整个跳过（实测：`rm -rf ~/.dsh` 是 deny，
  // 而 `case x in a) rm -rf ~/.dsh;; esac` 与 `if true; then nohup rm -rf ~/.dsh; fi` 是 allow）。
  // 循环上限 8：关键字与 wrapper 不会嵌套那么深，纯粹防病态输入下打转。
  for (let guard = 0; guard < 8; guard += 1) {
    if (!STATEMENT_KEYWORDS[head]) break
    let found = -1
    for (let j = idx + 1; j < w.length; j++) {
      const t = commandNameOf(w[j])
      if (!t || BAD_LABEL_CHARS.test(t)) continue
      // 关键字继续跳过（`case x in` 的 `in`、`for i in` 的 `in`）
      if (STATEMENT_KEYWORDS[t]) { idx = j; continue }
      found = j
      break
    }
    if (found < 0) return ''
    idx = found
    head = commandNameOf(w[idx])
    // 关键字之后可能是 wrapper（`then nohup rm …`）：就地剥掉它及其选项/带值选项，
    // 否则 label 会停在 wrapper 上。复用 unwrapWords 保证与主路径同一份剥法。
    const rest = unwrapWords(w.slice(idx))
    if (!rest.opaque && rest.words.length && commandNameOf(rest.words[0]) !== head) {
      const advance = w.length - idx - rest.words.length
      idx += advance
      head = commandNameOf(w[idx])
    }
  }
  if (!ROUTER_CMDS[head]) return head
  // 路由器命令：跳过选项（含带值选项的值），取第一个非选项词元作子命令。
  // 子命令位不做关键字过滤 —— 子命令属于路由器自己的词汇表（`git switch` 是真子命令）。
  for (let j = idx + 1; j < w.length; j++) {
    const raw = String(w[j])
    if (raw.startsWith('-')) {
      if (ROUTER_OPT_VALUE[raw]) j++
      continue
    }
    const sub = commandNameOf(raw)
    if (!sub || BAD_LABEL_CHARS.test(sub)) continue
    return head + ' ' + sub
  }
  return head
}

// find 的「执行动作」选项：其后的词元才是真正被执行的命令，而 label 恒为 `find`。
// 不展开它们的后果与「前缀包装器」完全同类（§ 见 WRAPPERS 的注释）：有效命令名判错，
// 破坏性判定整个跳过。实测（大分类 allow + 子设置 deny）：
//   `rm -rf ~/.dsh` → deny，而 `find . -exec rm -rf {} +` / `find . -delete` → allow。
const FIND_EXEC_FLAGS = { '-exec': 1, '-execdir': 1, '-ok': 1, '-okdir': 1 }
// `-delete` 本身就是破坏性动作，没有后续命令可看，直接给一个命中名单的合成 label。
const FIND_DELETE_FLAG = '-delete'

/**
 * 从一个段里提取**全部**参与破坏性判定的 label（主 label 在前）。
 *
 * 绝大多数段只返回一个（就是 segmentLabel 的结果）；只有 `find` 这类
 * 「选项携带命令」的形态会多返回。判定侧按「任一 label 命中即算命中」处理。
 *
 * 不导出：唯一调用点是本模块的 `assessCommand`，index.js 与测试都不直接用它
 * （对外只暴露 `segmentLabel` 与 `assessCommand` 两个层次，少一个公开面就少一份漂移）。
 */
function segmentLabels(words) {
  const main = segmentLabel(words)
  const out = main ? [main] : []
  const u = unwrapWords(words)
  if (u.opaque || !u.words.length) return out
  const w = u.words
  // 判据用 `main`（segmentLabel 已解析出的命令名），**不是** `w[0]`。
  // segmentLabel 会跳过 STATEMENT_KEYWORDS（`time`/`!`/`then`…）与 ROUTER 选项找到真正的命令，
  // 而 unwrapWords 只剥 WRAPPERS（env/timeout/nice/xargs）。若这里看 w[0]，
  // `time find . -delete` 的 w[0] 是 `time` → find 分支不进入 → -delete 不被识别 →
  // 大分类 allow 时静默放行（实测：`find . -delete` 是 deny，`time find . -delete` 是 allow）。
  if (main !== 'find') return out
  // 从 main 对应的位置开始扫（跳过被剥掉的关键字前缀），避免把 `time` 之前的词元当成 find 的参数
  let start = 0
  for (let i = 0; i < w.length; i += 1) {
    if (commandNameOf(w[i]) === 'find') { start = i; break }
  }
  for (let j = start + 1; j < w.length; j += 1) {
    const token = String(w[j])
    if (token === FIND_DELETE_FLAG) { out.push('rm'); continue }
    if (!FIND_EXEC_FLAGS[token]) continue
    // `-exec` 之后跟的是**一条完整命令行**，同样可以有前缀包装器 —— 必须复用 unwrapWords，
    // 否则 `find . -exec env rm -rf {} \;` 的 label 会取到 `env`，真正的 rm 不可见
    // （实测：`find . -exec rm` 是 deny，而 `-exec env rm` / `timeout 5 rm` / `nice rm` → allow）。
    // 这与主 label 路径（segmentLabel 靠 unwrapWords 剥前缀）口径一致。
    const rest = w.slice(j + 1)
    const u2 = unwrapWords(rest)
    if (u2.opaque || !u2.words.length) continue
    for (let k = 0; k < u2.words.length; k += 1) {
      const cand = commandNameOf(u2.words[k])
      if (!cand || cand === '{}' || cand === ';' || cand === '+') continue
      if (BAD_LABEL_CHARS.test(cand)) break
      out.push(cand)
      break
    }
  }
  return out
}

/** 该 label 是否命中破坏性名单（空 label 恒 false —— 认不出就不下判断）。 */
export function isDestructiveLabel(label) {
  const l = String(label == null ? '' : label).trim().toLowerCase()
  return !!l && DESTRUCTIVE_LABELS.has(l)
}

/**
 * 递归展开一段文本里的命令替换，返回「自身 + 所有内层内容」的扁平列表。
 *
 * 命令替换可以嵌套：`$(echo \`rm -rf /x\`)`、`` `echo \`rm -rf /x\`` ``、
 * `$(echo $(rm -rf /x))` —— 每一层的内容都会被 shell 执行，所以每层都要展开。
 * 只展开一层会让内层命令不可见（实测那两条曾是 allow，而 rm 真的会跑）。
 *
 * @param {string} text 待展开文本
 * @param {number} depth 剩余递归深度（防病态输入下打转）
 * @returns {string[]} 文本自身 + 逐层摘出的内容
 */
function expandSubstitution(text, depth) {
  const out = [text]
  if (depth <= 0) return out
  // 先把 `\`` 还原成裸反引号**再**摘取：反引号内的 `\`` 是「嵌套一层」的定界符，
  // 还原后它才是可被识别的定界符。不还原的话，`echo \`rm -rf /x\`` 里
  // 全是 `\``、没有裸反引号，replaceCommandSubstitution 找不到配对 → 内层永远摘不出来
  // （实测 `` `echo \`rm -rf /x\`` `` 曾是 allow，而 rm 真的会跑）。
  const normalized = text.replace(/\\`/g, '`')
  const inner = []
  replaceCommandSubstitution(normalized, inner)
  for (const item of inner) {
    for (const sub of expandSubstitution(item, depth - 1)) out.push(sub)
  }
  return out
}

/**
 * 把命令替换（`$(...)` / 反引号）的**内容摘出来**，原位置留一个空格。
 *
 * 命令替换里的内容会被 shell 真正执行，所以提取命令名时必须看到它；
 * 但摘出的内容要交给调用方在**剥完双引号之后**再拼回 —— 否则它会被双引号剥离一起吃掉
 *（`echo "\`rm -rf /x\`"` 里的内容在双引号内部，实测只换定界符会丢）。
 *
 * 只处理**成对**的定界符：找不到配对的 `)` 或反引号时原样保留
 *（那种输入本身语法不完整，交给「整行 ok:false」那条路径处理，不在这里猜）。
 * `$(` 的配对按括号深度算，且跳过其中的引号内容（`$(echo ")")` 不该在第一个 `)` 处截断）。
 *
 * @param {string} text 待处理文本（单引号内容应已剥离）
 * @param {string[]} extracted 摘出的命令替换内容追加到此数组
 * @returns {string} 摘掉命令替换后的文本（原位置留空）
 */
function replaceCommandSubstitution(text, extracted) {
  let rest = ''
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]
    // 反引号：找配对的收尾反引号。
    // `\``（反斜杠 + 反引号）在反引号**内部**表示「嵌套一层」——`` `echo \`rm -rf /x\`` ``
    // 里内层的 `rm` 会被执行。所以扫描时**不能**把 `\`` 当普通转义直接跳过：
    // 那样 `\`` 会被当成「转义的反引号」（字面量），永远找不到收尾定界符，
    // 于是整段被原样留下、内层内容摘不出来（实测该形态曾是 allow）。
    // 这里的处理是：把 `\`` 当作**内层定界符**，只跳到它后面继续找收尾反引号，
    // 内容原样收进 extracted（其中的 `\`` 由 expandSubstitution 还原后再递归展开）。
    if (c === '`') {
      let end = -1
      for (let j = i + 1; j < text.length; j += 1) {
        if (text[j] === '\\' && text[j + 1] === '`') { j += 1; continue }
        if (text[j] === '`') { end = j; break }
      }
      if (end < 0) { rest += c; continue }
      extracted.push(text.slice(i + 1, end))
      i = end
      continue
    }
    // `$(`：按括号深度找配对的 `)`，跳过引号内的内容
    if (c === '$' && text[i + 1] === '(') {
      let depth = 0
      let end = -1
      for (let j = i + 1; j < text.length; j += 1) {
        const d = text[j]
        if (d === '\\') { j += 1; continue }
        if (d === "'") {
          const e = text.indexOf("'", j + 1)
          if (e < 0) break
          j = e
          continue
        }
        if (d === '"') {
          let e = -1
          for (let k = j + 1; k < text.length; k += 1) {
            if (text[k] === '\\') { k += 1; continue }
            if (text[k] === '"') { e = k; break }
          }
          if (e < 0) break
          j = e
          continue
        }
        if (d === '(') depth += 1
        else if (d === ')') { depth -= 1; if (depth === 0) { end = j; break } }
      }
      if (end < 0) { rest += c; continue }
      extracted.push(text.slice(i + 2, end))
      i = end
      continue
    }
    rest += c
  }
  return rest
}

/**
 * 从**读不懂的原文**里粗提「可能是命令名」的候选，仅供整行 ok:false 时查 deny 例外。
 *
 * 为什么需要它：整行 ok:false（heredoc / 未闭合引号 / 悬空操作符）时没有段可判，
 * 而用户显式写的 deny 例外不该因为「命令换了个语法形态」就失效 ——
 * 实测 `rm -rf /data <<EOF\nx\nEOF`（合法 heredoc，会真实执行）绕过了 `rm *`=deny 例外。
 *
 * 这是**粗提**，不是第二次解析：按空白与操作符切分，取每个片段的首词并归一化。
 * 多提几个名字是安全的（调用方只用它查 deny，方向只会收紧），
 * 但绝不能反过来用它授权 —— 所以 allow/ask 例外在这条路径上一律不认。
 *
 * **必须丢掉 heredoc 正文**：`<<EOF` 之后到终止符之间的内容是**数据**，不是命令。
 * 不丢的后果是误判 —— 实测 `cat > doc.txt <<EOF\nrm -rf is dangerous\nEOF`
 * 会因为正文里出现 `rm` 而被判成破坏性命令（正文只是要写进文件的文本）。
 * 终止符取 `<<` 后紧跟的那个词（`<<EOF` / `<<'EOF'` / `<<-EOF` 都算），
 * 从它首次单独成行的位置截断；找不到终止符就只保留 `<<` 之前的部分
 * （正文范围不确定时宁可少扫，方向仍是「命令部分照常查」，不会因此放行真命令）。
 */
export function rawCommandNames(text) {
  const out = []
  const seen = {}
  // 丢掉 heredoc 正文（`<<TAG` 之后到终止符之间的内容是数据，不是命令 —— 见函数注释）
  const source = String(text == null ? '' : text)
  const heredoc = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(source)
  let body = source
  if (heredoc) {
    const tag = heredoc[2]
    // 保留 `<<TAG` 本身（它属于命令行），丢掉其后到终止符之间的正文。
    // 从 `<<TAG` 之后找首次「单独成行」的 TAG（允许前置制表符，兼容 `<<-`）。
    const afterTag = heredoc.index + heredoc[0].length
    const rest = source.slice(afterTag)
    const end = new RegExp('^[ \\t]*' + tag + '[ \\t]*$', 'm').exec(rest)
    // 终止符位置之前的正文全部丢弃；找不到终止符时只保留 `<<TAG` 之前的部分
    //（正文范围不确定时宁可少扫 —— 命令部分照常查，不会因此放行真命令）
    body = end ? source.slice(0, afterTag) : source.slice(0, heredoc.index)
  }
  // 命令替换（`$(...)` 与反引号）**必须先于引号剥离**处理。
  //
  // 为什么：命令替换里的内容**会被执行**，而它经常出现在双引号内
  //（`echo "$(rm -rf /x)"` 在 bash 里真的会执行 `rm`）。
  // 早期实现先剥双引号、再处理反引号，于是双引号内的命令替换被连内容一起剥掉：
  //   `echo "$(rm -rf /x)"`   → raw=["echo"]，rm 不可见
  //   `echo "\`rm -rf /x\`"`  → raw=["echo"]，同上
  //   `echo $(rm -rf /x)`     → raw=["echo","rm"]（无引号时才对）
  // 而单引号内的命令替换**不会执行**（`'$(rm -rf /x)'` 是纯文本），必须保持被剥掉。
  //
  // 处理顺序（每步都只把「会被执行的内容」留下）：
  //   ① 剥单引号（整块丢弃 —— 单引号内一切都不执行）
  //   ② **摘出**命令替换的内容（`$(` … `)` 与 `` ` `` … `` ` ``），从原位置移走
  //   ③ 剥双引号（此时双引号里已不含命令替换，剥掉是安全的）
  //   ④ 把 ② 摘出的内容拼回来参与切分
  //
  // 为什么 ② 必须「摘出」而不是「换定界符」：`echo "\`rm -rf /x\`"` 若只把反引号换成 `;`，
  // 得到 `echo ";rm -rf /x;"` —— 内容仍在双引号**内部**，③ 剥双引号时整块被替换成空格，
  // 内容照样丢失（实测踩过）。摘出来放到末尾才不受 ③ 影响。
  const noSingle = body.replace(/'(?:[^']*)'/g, ' ')
  const extracted = []
  const withoutSubst = replaceCommandSubstitution(noSingle, extracted)
  // 摘出的内容里可能还有**内层**命令替换，必须递归展开：
  //   `echo $(echo \`rm -rf /x\`)`   → 外层摘出 `echo \`rm -rf /x\``，内层反引号还要再摘一次
  //   `echo \`echo \`rm -rf /x\`\``  → 反引号内的转义反引号同理
  // 不递归的后果是内层命令不可见（实测这两条在 command=allow + destructive=deny 下曾是 allow，
  // 而它们在 bash 里是**合法可执行**的，rm 真的会跑）。
  // 深度上限 8：命令替换不会嵌那么深，纯粹防病态输入下打转。
  const expanded = []
  for (const item of extracted) expanded.push(...expandSubstitution(item, 8))
  const stripped = withoutSubst.replace(/"(?:[^"\\]|\\.)*"/g, ' ') + ' ; ' + expanded.join(' ; ')
  for (const piece of stripped.split(/[\n\r;|&(){}<>]+/)) {
    const tokens = piece.trim().split(/\s+/).filter(Boolean)
    if (!tokens.length) continue
    // 用 segmentLabels 而非 commandNameOf(首词) 取名字：前者会剥掉前缀包装器
    // （env/timeout/nice/command/nohup…）、展开 find -exec/-delete、跳过语句关键字。
    // 只用首词会让这些形态在这条路径上失效 —— 实测 `env rm -rf /x <<EOF` 与
    // `find . -delete <<EOF` 都因为首词是 env/find 而被判成非破坏性（allow），
    // 而同样两条命令不带 heredoc 时是 deny。
    // 这是「单一来源」的又一次应用：归一化只该有一份实现。
    //
    // 注意**不要**按 heredoc 标签过滤名字：标签与真命令同名是合法的
    //（`rm -rf /x <<rm` 的标签就叫 rm），过滤会把真命令一起丢掉（漏判方向是放行）。
    // 正文与终止符已经在上面按位置切掉了，标签本身不会作为片段出现。
    const labels = segmentLabels(tokens)
    for (const name of labels) {
      if (!name || seen[name]) continue
      seen[name] = 1
      out.push(name)
    }
  }
  return out
}

// ── 词法器 ────────────────────────────────────────────────────────────────────

const BASH_EXPANSION = /\$[A-Za-z_][A-Za-z0-9_]*/y
const PWSH_EXPANSION = /\$(?:env:)?[A-Za-z_][A-Za-z0-9_]*/y
const CMD_VARIABLE = /%[A-Za-z_][A-Za-z0-9_()]*%/y
const DESCRIPTOR_DUPLICATION = /[<>]&\s*(?:[0-9]+|-)/y
const REDIRECT_OPERATOR = /(?:>>|>\||>&|<&|>|<)/y

/**
 * 读一个 `$` 展开并返回它的书写形态；返回 undefined 表示这个构造**执行嵌套命令**而不是命名变量。
 * 只做「是不是可静态读懂的变量」这一个判断，不求值 —— 变量展开后的值一律不解析。
 */
function readExpansion(input, index, shell) {
  const next = input[index + 1]
  if (next === '(' || next === "'" || next === '"') return undefined
  if (next === '{') {
    const end = input.indexOf('}', index + 2)
    if (end < 0) return undefined
    const body = input.slice(index + 2, end)
    if (/[($`]/.test(body)) return undefined
    return input.slice(index, end + 1)
  }
  const m = matchAt(shell === 'pwsh' ? PWSH_EXPANSION : BASH_EXPANSION, input, index)
  return m === undefined ? '$' : m
}

/** 从 start（指向 open 字符）跳到配对的 close，返回 close 的下标；找不到返回 -1。 */
function skipBalanced(input, start, open, close) {
  let depth = 0
  for (let i = start; i < input.length; i += 1) {
    const c = input[i]
    if (c === '\\') { i += 1; continue }
    if (c === "'") {
      const e = input.indexOf("'", i + 1)
      if (e < 0) return -1
      i = e
      continue
    }
    if (c === '"') {
      let e = -1
      for (let j = i + 1; j < input.length; j += 1) {
        if (input[j] === '\\') { j += 1; continue }
        if (input[j] === '"') { e = j; break }
      }
      if (e < 0) return -1
      i = e
      continue
    }
    if (c === open) depth += 1
    else if (c === close) {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

/**
 * 把一个命令行分解为段、重定向与词元元数据。
 *
 * 与旧实现的根本区别：操作符必须【在引号外】才生效，且解析不了的构造一律标 opaque，
 * 由调用方失败关闭 —— 绝不猜测 shell 语义。
 *
 * 段的边界由 `;` `|` `||` `&&` `&` 与换行决定（换行也是分隔符：pwsh -Command 与 bash -c
 * 都接受多行脚本，实测 `git status\nrm -rf ~/.dsh` 当前被静默放行）。
 * 重定向（`>` `>>` `<` `2>` `2>&1` `&>`）记入 writeTargets/readTargets，**不作为段**。
 *
 * 段级 opaque 用于「这一段里有读不懂的构造，但段边界仍可确定」：
 * `$(...)`、反引号、heredoc、括号/花括号分组、`env -S`。
 * 整行 ok:false 用于「连段边界都定不了」：未闭合引号、重定向无目标、空命令、悬空操作符。
 *
 * @param {string} source 命令原文
 * @param {'pwsh'|'bash'} shell 决定转义、注释与变量规则
 * @returns {{ ok: true, segments: object[] } | { ok: false, reason: string }}
 */
export function decomposeCommand(source, shell) {
  const input = String(source == null ? '' : source)
  const sh = shell === 'pwsh' ? 'pwsh' : 'bash'
  const segments = []
  let words = []
  let writeTargets = []
  let readTargets = []
  let segText = ''
  let wordText = ''
  let started = false
  let dynamic = false
  let segDynamic = false
  let segOpaque = null
  let pending
  let nextOp = 'start'
  let quote
  // 段文本末尾是否已是空格。**不能用 segText.endsWith(' ')**：`segText += s` 在 V8 里
  // 只建 rope（O(1)），而 endsWith / 下标读取都必须先把 rope 扁平化成连续串（O(n) 拷贝），
  // 于是每遇到一个引号外空白就触发一次全长拷贝，整个分解退化为 O(n²)。
  // 实测真实命令形态：`git add` 带 20000 个文件参数（399 KB）→ 1049 ms（改标记后 ~20 ms）。
  // 这是每次工具调用都要跑的判定热路径，词元数由 AI 生成的命令决定，不是理论问题。
  let segEndsWithSpace = true

  const pushText = (s) => { segText += s; segEndsWithSpace = false }
  // 引号外的空白归一化为单个空格：例外匹配用的是段全文，`git  status`（双空格）
  // 不该因为排版差异匹配不上用户写的 `git status`。引号内的空白原样保留。
  const pushSpace = () => {
    if (segText && !segEndsWithSpace) { segText += ' '; segEndsWithSpace = true }
  }

  const flushWord = () => {
    if (!started) return
    const w = wordText
    if (pending === 'write') writeTargets.push(w)
    else if (pending === 'read') readTargets.push(w)
    else words.push(w)
    pending = undefined
    wordText = ''
    started = false
    dynamic = false
  }

  const flushSegment = () => {
    flushWord()
    // 保留条件含 segOpaque：`(git status)` 这类分组段有文本但提取不出词元，
    // 它必须成为一个「读不懂的段」（code: unparsable）而不是被静默丢弃 ——
    // 丢弃会让整行变成 ok:false，虽然同样落分类默认值，但段级展示与 code 就没了。
    // 但**不**按 segText 保留：`printf x >\n~/.ssh/keys` 的换行处文本是 `printf x >`，
    // 按文本保留会凭空多出一个「只有重定向操作符」的段。
    const text = segText.trim()
    if (words.length > 0 || writeTargets.length > 0 || readTargets.length > 0 || segOpaque !== null) {
      segments.push({
        op: nextOp,
        text,
        words,
        writeTargets,
        readTargets,
        dynamic: segDynamic,
        opaque: segOpaque,
      })
    }
    words = []
    writeTargets = []
    readTargets = []
    segText = ''
    // 与 segText 同步重置：新段还没有任何内容，pushSpace 的「已有内容才补空格」判据靠它
    segEndsWithSpace = true
    segDynamic = false
    segOpaque = null
    pending = undefined
    nextOp = 'start'
  }

  const markOpaque = (reason) => { if (segOpaque === null) segOpaque = reason }

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]

    // ── 单引号内：原样，无转义（两种 shell 一致）──
    if (quote === 'single') {
      pushText(char)
      if (char === "'") { quote = undefined; continue }
      wordText += char
      continue
    }

    // ── 双引号内：bash 用 `\` 转义，pwsh 用反引号 ──
    if (quote === 'double') {
      if (sh === 'bash' && char === '\\') {
        const next = input[index + 1]
        if (next === undefined) return { ok: false, reason: 'the command line ends inside an escape' }
        if ('\\"$`\n'.includes(next)) {
          pushText(char + next)
          wordText += next
          index += 1
          continue
        }
        pushText(char)
        wordText += char
        continue
      }
      if (char === '`') {
        const end = input.indexOf('`', index + 1)
        if (end < 0) return { ok: false, reason: 'the command line ends inside an unbalanced quote' }
        markOpaque(sh === 'bash' ? 'command substitution cannot be read statically' : 'PowerShell escape sequences cannot be read statically')
        // 原文同时进 wordText：若替换式就是段首词，label 会因含反引号而被判「认不出」
        // （BAD_LABEL_CHARS），方向 fail-closed；不写 wordText 则会产出一个空词元。
        const raw = input.slice(index, end + 1)
        pushText(raw)
        wordText += raw
        index = end
        continue
      }
      if (char === '"') { pushText(char); quote = undefined; continue }
      if (char === '$') {
        const expansion = readExpansion(input, index, sh)
        if (expansion === undefined) {
          const end = skipBalanced(input, index + 1, '(', ')')
          if (end < 0) return { ok: false, reason: 'the command line ends inside an unbalanced quote' }
          markOpaque('command substitution cannot be read statically')
          pushText(input.slice(index, end + 1))
          index = end
          continue
        }
        pushText(expansion)
        wordText += expansion
        segDynamic = true
        // 当前词元含变量展开 → 标记为「动态」。这个标记供下面 `2>` 的 fd 号判定使用：
        // `echo $N> f` 里的 `$N` 是**词元**（值为 N 的展开），不是 fd 号，不能当 `2>` 那样丢掉。
        // 曾经这里只置 segDynamic（段级）而漏了 dynamic（词元级），于是 746 行的 `!dynamic`
        // 恒为真、注释声称的这层保护从未生效 —— 虽然实测各形态结果恰好正确
        // （变量展开后 wordText 含 `$`，本就不匹配 /^[0-9]+$/），但那是巧合而非设计。
        dynamic = true
        index += expansion.length - 1
        continue
      }
      pushText(char)
      wordText += char
      continue
    }

    // ── 换行：段分隔符（CRLF 只算一次）──
    if (char === '\n' || char === '\r') {
      if (char === '\r' && input[index + 1] === '\n') continue
      // 待读的重定向目标可跨换行：bash 接受 `printf x >\n~/.ssh/keys` 为**一条**命令。
      // 此时不能分段 —— 分段会把目标甩进下一段，凭空造出一个「只有重定向、没有命令」的段。
      if (pending !== undefined && !started) { pushSpace(); continue }
      flushSegment()
      nextOp = 'newline'
      continue
    }

    // ── 引号外空白 ──
    if (/\s/.test(char)) {
      flushWord()
      pushSpace()
      continue
    }

    if (char === "'") { pushText(char); quote = 'single'; started = true; continue }
    if (char === '"') { pushText(char); quote = 'double'; started = true; continue }

    // ── 转义：bash 用 `\`，pwsh 用反引号 ──
    if (sh === 'bash' && char === '\\') {
      const next = input[index + 1]
      if (next === undefined) return { ok: false, reason: 'the command line ends inside an escape' }
      index += 1
      if (next === '\n') continue
      pushText('\\' + next)
      wordText += next
      started = true
      continue
    }
    if (char === '`') {
      const end = input.indexOf('`', index + 1)
      if (end < 0) return { ok: false, reason: 'the command line ends inside an unbalanced quote' }
      markOpaque(sh === 'bash' ? 'command substitution cannot be read statically' : 'PowerShell escape sequences cannot be read statically')
      const raw = input.slice(index, end + 1)
      pushText(raw)
      wordText += raw
      started = true
      index = end
      continue
    }

    // ── 变量展开：只标记，不求值 ──
    if (char === '$') {
      const expansion = readExpansion(input, index, sh)
      if (expansion === undefined) {
        const end = skipBalanced(input, index + 1, '(', ')')
        if (end < 0) return { ok: false, reason: 'the command line ends inside an unbalanced quote' }
        markOpaque('command substitution cannot be read statically')
        pushText(input.slice(index, end + 1))
        index = end
        continue
      }
      pushText(expansion)
      wordText += expansion
      started = true
      segDynamic = true
      dynamic = true
      index += expansion.length - 1
      continue
    }
    if (sh === 'pwsh' && char === '%') {
      const m = matchAt(CMD_VARIABLE, input, index)
      if (m !== undefined) {
        pushText(m)
        wordText += m
        started = true
        segDynamic = true
        dynamic = true
        index += m.length - 1
        continue
      }
    }

    // ── 注释：仅词首（bash 与 pwsh 同规则）──
    if (char === '#' && !started) {
      while (index + 1 < input.length && input[index + 1] !== '\n') index += 1
      continue
    }

    // ── 操作符 ──
    if (char === '&') {
      if (input[index + 1] === '&') {
        flushSegment()
        nextOp = '&&'
        index += 1
        continue
      }
      // `&>` / `&>>` 是合并重定向，不是后台执行
      if (input[index + 1] === '>') {
        flushWord()
        pushText(input[index + 2] === '>' ? '&>>' : '&>')
        pending = 'write'
        index += input[index + 2] === '>' ? 2 : 1
        continue
      }
      flushSegment()
      nextOp = '&'
      continue
    }
    if (char === '|') {
      const isOr = input[index + 1] === '|'
      flushSegment()
      nextOp = isOr ? '||' : '|'
      if (isOr) index += 1
      continue
    }
    if (char === ';') {
      flushSegment()
      nextOp = ';'
      continue
    }
    if (char === '>' || char === '<') {
      // heredoc：正文在后续行，段边界因此不可信（正文里可以出现任何东西，
      // 包括看起来像命令的行）。找不到终止符就无法确定正文范围 —— 不猜，整行判读不懂。
      if (input.startsWith('<<', index)) {
        return { ok: false, reason: 'here-document input cannot be read statically' }
      }
      // `2>` 里的 `2` 是 fd 号不是词元；但引号/变量/通配形态的 `2` 是真词元
      if (started && !dynamic && /^[0-9]+$/.test(wordText)) {
        wordText = ''
        started = false
      } else {
        flushWord()
      }
      // `2>&1` / `>&2` 是描述符复制，不是文件目标
      const dup = matchAt(DESCRIPTOR_DUPLICATION, input, index)
      if (dup !== undefined) {
        pushText(dup)
        index += dup.length - 1
        continue
      }
      const op = matchAt(REDIRECT_OPERATOR, input, index)
      pushText(op)
      pending = char === '>' ? 'write' : 'read'
      index += op.length - 1
      continue
    }

    // ── 分组与花括号展开：读不懂，标 opaque 并跳过配对 ──
    // 例外：`find -exec … {} \;` 的 `{}` 是精确字面量占位符，不是花括号展开 ——
    // 把它当展开会让常规只读巡检无法进行。
    if (char === '{' && input[index + 1] === '}' && !started && (input[index + 2] === undefined || /\s/.test(input[index + 2]))) {
      pushText('{}')
      wordText = '{}'
      started = true
      index += 1
      continue
    }
    if (char === '(' || char === '{') {
      const close = char === '(' ? ')' : '}'
      const end = skipBalanced(input, index, char, close)
      if (end < 0) return { ok: false, reason: 'the command line ends inside an unbalanced group' }
      markOpaque('shell grouping or brace expansion cannot be read statically')
      pushText(input.slice(index, end + 1))
      index = end
      continue
    }
    if (char === ')' || char === '}') {
      markOpaque('shell grouping or brace expansion cannot be read statically')
      pushText(char)
      continue
    }

    pushText(char)
    wordText += char
    started = true
  }

  if (quote !== undefined) return { ok: false, reason: 'the command line ends inside an unbalanced quote' }
  if (pending !== undefined && !started) return { ok: false, reason: 'a redirection has no target' }
  // 悬空操作符：`git status |` / `a &&` 在 shell 里是语法错误，段边界不可信。
  // `;` 与换行允许尾随（shell 接受 `echo a;`），故不在此列。
  if (nextOp !== 'start' && nextOp !== ';' && nextOp !== 'newline' && !started) {
    return { ok: false, reason: 'the command line ends with a dangling operator' }
  }
  flushSegment()
  if (segments.length === 0) return { ok: false, reason: EMPTY_COMMAND_REASON }
  return { ok: true, segments }
}

// ── 段级判定 ──────────────────────────────────────────────────────────────────

/**
 * 从段的词元与重定向目标收集「可能被写入的路径」候选。
 * 用途只有两个：弹窗展示、`code: 'write-outside'` 标注 —— **不参与动作选择**。
 * 所以这里宁可多收（flag 内嵌路径、原始行直扫的绝对路径），不做选项语义解析。
 */
function collectWritePaths(seg, shell) {
  const out = []
  for (const w of seg.writeTargets) out.push(w)
  for (const w of seg.words) {
    if (String(w).startsWith('-')) {
      const p = flagEmbeddedPath(w)
      if (p) out.push(p)
    }
  }
  // 绝对路径直扫：bash 词法器会吃掉 `\`，盘符形态的路径到不了词元列表
  const re = new RegExp(RAW_ABSOLUTE_PATH.source, 'g')
  let m
  while ((m = re.exec(seg.text)) !== null) {
    if (m[1]) out.push(m[1])
  }
  return [...new Set(out)].filter((p) => p && !isNullSink(p, shell))
}

/** 该段是否有重定向目标落在工作区之外（含 `~user` 这类必然在外的形态）。 */
function writeOutsideOf(seg, shell, h) {
  const paths = collectWritePaths(seg, shell)
  if (!paths.length) return false
  for (const raw of paths) {
    const expanded = expandTilde(globRootOf(raw), h.home)
    if (expanded === null) return true
    try { if (h.isOutsideWorkspace && h.isOutsideWorkspace(expanded)) return true } catch (e) {}
  }
  return false
}

/**
 * 该段是否为「嵌套解释器带内联程序」——程序正文是另一门语言，读不懂。
 *
 * 导出给 index.js 的候选生成复用：候选守卫必须与判定侧同源，否则会产出
 * 「判定侧根本不采纳」的候选（用户点了写入成功、命令仍弹窗，而判重让候选下次消失 —— 死结）。
 */
export function nestedInlineProgram(label, words) {
  const base = String(label || '').split(' ')[0]
  if (!base) return false
  if (NESTED_EVAL[base]) return true
  const w = Array.isArray(words) ? words : []
  if (NESTED_INTERPRETERS[base]) {
    for (let j = 1; j < w.length; j += 1) {
      const t = String(w[j])
      if (INLINE_PROGRAM_FLAG.test(t)) return true
      if (base === 'node' && /^-p(?:e)?$/.test(t)) return true
      if (base === 'php' && t === '-r') return true
      if (base === 'deno' && t === 'eval') return true
    }
    return false
  }
  if (NESTED_SHELLS[base]) {
    for (let j = 1; j < w.length; j += 1) {
      const t = String(w[j])
      // cmd 的 /c 与 /k 大小写不敏感：`cmd /C "..."` 是 Windows 上的标准写法，
      // 只比小写会让大写形态落到「可读的普通调用」，从而可被 `cmd *` 例外静默放行。
      if (base === 'cmd') { if (/^[/-][ck]$/i.test(t)) return true; continue }
      if (base === 'powershell' || base === 'pwsh') {
        // PowerShell 接受 `-Command` 的任意长度≥2 的前缀（`-Com` / `-Co` …），`-c` 单独也算；
        // `-EncodedCommand` 同样携带程序（只是编码过，更读不懂），其任意前缀也在此列。
        const lower = t.toLowerCase()
        if (lower === '/c' || lower === '-c') return true
        if (lower.startsWith('-') && lower.length >= 3
          && ('command'.startsWith(lower.slice(1)) || 'encodedcommand'.startsWith(lower.slice(1)))) return true
        continue
      }
      // 其余 shell 复用与解释器同一份判据（覆盖 `-lc` / `-ec` / `-xc` 等融合短选项）
      if (t === '--command' || INLINE_PROGRAM_FLAG.test(t)) return true
    }
    return false
  }
  return false
}

/**
 * 对一整条命令行做段级判定（本计划的核心修复）。
 *
 * 判定流程：
 *   1. 分解；读不懂整行 → 落 command 分类默认值
 *   2. 逐段求动作：用户例外 → destructive 子设置 → command 分类默认值
 *      但**读不懂的段**（opaque / 提取不出 label / 嵌套解释器带内联程序）跳过**例外面**，
 *      破坏性子设置仍照常生效 —— 「读不懂的内容不可被授权」是 fail-closed 的底线，
 *      否则 `git status $(任意代码)` 会因为一条 `git status *` 例外被静默放行；
 *      而「段首已经认出是 rm」这个事实不受同段内 opaque 构造影响，没有理由被关掉。
 *   3. fail-closed 合并：任一段 deny → deny；否则任一段 ask → ask；否则全部 allow → allow
 *      全部段都无判定（inherit）→ 返回 inherit，由调用方落兜底策略
 *
 * 顺序要点：
 *   · **例外先于子设置** —— 用户例外是显式表态，高于子设置（D-5）
 *   · **子设置先于分类默认值** —— 更细的判定优先于更粗的判定（D-6），
 *     所以大分类设为 allow 时，破坏性命令仍按子设置走
 *
 * `unparsable` 不是动作来源，只是 code 标注：解析不出的段没有额外信息可判，
 * 它该做的就是落回大分类（D-4）。为它单列子设置会凭空造一个与大分类重复的概念。
 *
 * `inherit` 是契约上可能的返回值（三层都未配置时），但**当前宿主不会产出它**：
 * `commandSubSetting` 恒返回具体动作、`resolveCategory` 对 command 分类也只会返回具体 mode
 * （项目层 inherit 已在读取时穿透到全局）。调用方 commandDecision 里的 inherit 分支因此不可达，
 * 那里有对应注释；此处保留该语义是为了让本模块不依赖宿主的默认值策略。
 *
 * 重定向只标注不设闸（D-8）：`git status > ~/.dsh/AGENTS.md` 命中例外即放行，code 仅用于展示。
 *
 * @param {string} source 命令原文
 * @param {'pwsh'|'bash'} shell
 * @param {{
 *   home?: string,
 *   matchException?: (segmentText: string, label: string) => ({action:string, ruleId?:string, reason?:string, note?:string}|null),
 *   destructive?: () => ({action:string, reason?:string}|null),
 *   category?: () => ({action:string, reason?:string}|null),
 *   isOutsideWorkspace?: (path: string) => boolean,
 * }} hooks 注入判定回调，使本模块保持纯函数、可独立测试
 * @returns {{ action: 'allow'|'ask'|'deny'|'inherit', code: string, segments: object[],
 *            matched: string|null, reason: string|null, note: string|null }}
 */
export function assessCommand(source, shell, hooks) {
  const h = hooks || {}
  const sh = shell === 'pwsh' ? 'pwsh' : 'bash'
  const catOf = () => {
    const c = h.category ? h.category() : null
    return { action: (c && c.action) || 'inherit', reason: (c && c.reason) || null }
  }
  const base = (action, code, reason, ruleId) => ({
    action,
    code,
    segments: [],
    matched: ruleId || null,
    reason: reason || null,
    note: null,
  })

  const d = decomposeCommand(source, sh)
  // 整行读不懂（未闭合引号 / 重定向无目标 / 悬空操作符 / 空命令）：没有段可判，落分类默认值。
  // 「空命令」与「有构造读不懂」分开标注：排查时的下一步不同 —— 前者要看调用方为什么发了空串，
  // 后者要看解析器覆盖缺了什么。注意 `decomposeCommand` 对「无段可产出」返回的也是 ok:false
  // （reason 见下），所以这里按 reason 分流；下面**不再**需要 segments.length 的兜底分支
  // （ok:true 时 segments 恒非空，那条分支曾经是不可达的死代码）。
  //
  // 但**deny 例外要照常查**：整行读不懂不等于「用户可以拒绝的命令就不算数」。
  // 实测漏洞：例外 `rm *`=deny 时 `rm -rf /data` 是 deny，而合法 heredoc
  // `rm -rf /data <<EOF\nx\nEOF` 因为整行 ok:false 直接落分类默认值 —— 用户显式写的拒绝被绕过。
  // 这里用「原文粗提命令名」查例外：只认 deny（收紧方向，多认几个名字是安全的），
  // allow/ask 一律不认（读不懂的内容不可被授权）。
  // 整行读不懂时同样要走**完整的判定链**：deny 例外 → 破坏性子设置 → 分类默认值。
  // 之前这里只查 deny 例外、然后直接落分类默认值，**完全没调用 h.destructive()** ——
  // 于是给破坏性命令套一个 heredoc 就能绕过子设置（而子设置正是「大分类设为 allow 时
  // 保护破坏性命令」的唯一一道闸）：
  //   `rm -rf /data` → deny，而 `rm -rf /data <<EOF\nx\nEOF`（合法 heredoc，会真实执行）→ allow。
  // 这与段级那条修复（`destructive` 不再依赖 `unparsable`）是同一个道理：
  // 「原文里认得出 rm」这个事实不受「整行还有读不懂的构造」影响。
  //
  // 命令名仍用 rawCommandNames 粗提（只用于**收紧方向**：查 deny 例外与破坏性名单）；
  // allow/ask 例外在这条路径上一律不认（读不懂的内容不可被授权）。
  if (!d.ok) {
    const c = catOf()
    const code = d.reason === EMPTY_COMMAND_REASON ? 'empty' : 'unparsable'
    let action = c.action
    let reason = c.reason
    let ruleId = null
    if (code !== 'empty') {
      const names = rawCommandNames(String(source == null ? '' : source))
      // ① deny 例外（最高优先，用户显式拒绝）
      let denied = false
      if (h.matchException) {
        for (const name of names) {
          let ex = null
          try { ex = h.matchException(name, name) } catch (e) { ex = null }
          if (ex && ex.action === 'deny') {
            action = 'deny'
            reason = ex.reason || null
            ruleId = ex.ruleId || null
            denied = true
            break
          }
        }
      }
      // ② 破坏性子设置（更细的判定，优先于分类默认值）
      if (!denied && names.some((n) => isDestructiveLabel(n))) {
        const ds = h.destructive ? h.destructive() : null
        if (ds && ds.action) {
          action = ds.action
          reason = ds.reason || null
        }
      }
    }
    return base(action, code, reason, ruleId)
  }

  const out = []
  let anyDeny = false
  let anyAsk = false
  let anyInherit = false

  // 例外匹配单点（opaque 段与可读段共用，避免两份实现漂移）。
  //
  // 试哪些对象：段原文 → 全部 label（主 label + 并集提取出的额外名字）。
  // 只试「段原文 + 主 label」会让「子设置能拦、用户的 deny 例外却拦不住」形成不对称 ——
  // 实测（例外 `rm *`=deny + 子设置 allow）：
  //   `rm -rf /x`                → deny（例外命中）
  //   `find . -exec rm -rf {} +` → **allow**（主 label 是 `find`，`rm` 在额外 label 里）
  //   `find . -delete`           → **allow**（同上）
  // 即用户显式写的「rm 一律拒绝」被 find 的间接执行绕过。
  //
  // 优先级：**deny > ask > allow**。allow 命中后不能立即收工，否则
  // 「外层命令的 allow 例外」会短路「内层命令的 deny/ask 例外」——
  // 实测（例外 `echo *`=allow + `rm *`=deny）：`echo $(rm -rf /x)` 曾 allow，
  // 而用户显式写了 rm 的拒绝；`rm *`=ask 时同样被规避。
  // 这与段级合并「拒绝面取并集、放行面取交集」是同一条原则。
  //
  // 每个对象试两次（原文与 label 都传同一个值）是**有意**的：宿主的 matchException 内部
  // 会拿「段原文」与「归一化 label」各匹配一次，这里传什么它就试什么 —— 传原文即让它
  // 用原文口径匹配，传 label 即让它用 label 口径匹配。两个口径都需要。
  const resolveException = (segText, allLabels) => {
    if (!h.matchException) return null
    const tryOne = (t) => {
      try { return h.matchException(t, t) || null } catch (e) { return null }
    }
    let allow = null
    let ask = null
    const first = tryOne(segText)
    if (first && first.action === 'deny') return first
    if (first && first.action === 'ask') ask = first
    else if (first) allow = first
    for (let i = 0; i < allLabels.length; i += 1) {
      const r = tryOne(allLabels[i])
      if (!r) continue
      if (r.action === 'deny') return r
      if (r.action === 'ask' && !ask) ask = r
      else if (r.action === 'allow' && !allow) allow = r
    }
    return ask || allow
  }

  for (const seg of d.segments) {
    let labels = segmentLabels(seg.words)
    // opaque 段（或提取不出词元的段）**额外**用原文粗提命令名，取并集。
    //
    // 为什么是并集而不是「提不出词元时才回退」：opaque 构造会把**段内**的真实命令藏起来，
    // 而词元列表只包含 opaque 构造**之外**的部分 —— 于是两种漏判各有一条路径：
    //   · 提不出词元（`(rm -rf ~/.dsh)` 的 words 是空的）→ label 为空 → 破坏性判定恒 false；
    //   · 提得出词元但真命令在 opaque 构造里（`echo $(rm -rf ~/.dsh)` 的 label 是 `echo`）
    //     → 破坏性判定看的是 `echo`，`rm` 根本不在视野里。
    // 两者是同一件事（读不懂的构造里藏着命令），必须一起堵。实测（command=allow + destructive=deny）：
    //   `(rm -rf ~/.dsh)` / `{ rm -rf ~/.dsh; }` / `(cd /tmp; rm -rf ~/.dsh)` → 曾全部 allow
    //   `echo $(rm -rf ~/.dsh)` / `case x in a) rm -rf ~/.dsh;; esac`     → 曾全部 allow
    //
    // 只对 **opaque 段**做并集，可读的段不加：可读段的词元已经是权威答案，
    // 再拿原文粗提只会引入噪音（`git log --format=...` 之类参数里的词）。
    // 方向始终 fail-closed：多提几个名字只会让 deny 例外与破坏性名单更容易命中，不会放宽。
    if (seg.opaque) {
      const extra = rawCommandNames(seg.text)
      if (extra.length) {
        const seen = {}
        const merged = []
        for (const l of labels.concat(extra)) { if (l && !seen[l]) { seen[l] = 1; merged.push(l) } }
        labels = merged
      }
    }
    const label = labels[0] || ''
    const unparsable = !!seg.opaque || !label || nestedInlineProgram(label, seg.words)
    // 破坏性判定**不依赖** unparsable：段首 label 已经认出来是 rm，这个事实不受
    // 「同一段里还带了个 $(...)」影响。曾经写成 `!unparsable && isDestructiveLabel(label)`，
    // 于是段内任意 opaque 构造（`$()`、反引号、`( )`/`{ }` 分组、`{a,b}` 展开、`env -S`）
    // 都会让该段跳过子设置、直接落大分类 —— 大分类为 allow 时破坏性命令即被静默放行
    // （实测：`rm -rf ~/.dsh` 是 deny，`rm -rf ~/.dsh $(true)` 是 allow；
    //  同一机制还能绕开用户显式写的 deny 例外）。
    // opaque 只该影响「能否被例外授权」，不该影响「是否走子设置」。
    const destructive = labels.some((l) => isDestructiveLabel(l))
    const writeOutside = writeOutsideOf(seg, sh, h)

    let action
    let source
    let reason = null
    let note = null
    let ruleId = null

    if (unparsable) {
      // 读不懂的段：只跳过**授权方向**的例外（allow），其余照常生效。
      //
      // 三条规则，按「会不会放宽」划界：
      //   · **allow 例外跳过** —— 读不懂的内容不可被授权（D-4 / §3.6.1）。
      //     否则 `git status $(任意代码)` 会因为一条 `git status *` 例外被静默放行。
      //   · **deny 例外保留** —— 它只会收紧。跳过它等于让 opaque 构造成为
      //     「绕开用户显式拒绝」的手段（实测：例外 `rm *`=deny 时 `rm -rf /data` 是 deny，
      //     而 `rm -rf /data $(true)` 因为 opaque 跳过了例外面，反而落到大分类）。
      //   · **ask 例外保留** —— 它**不是授权，是「要求确认」**。曾经把它和 allow 一起跳过，
      //     后果是「每次都要问我」被降级为「静默放行」：实测（例外 `rm *`=ask、子设置/大分类均 allow）
      //     `rm -rf /data` 是 ask，而 `rm -rf /data $(true)` 是 allow —— 用户写的确认规则被规避。
      //     保留它不会放宽任何东西（ask 只会让人多确认一次），方向始终 fail-closed。
      //   · 子设置与分类默认值在下面照常生效（子设置比大分类「知道得更多」，见上）。
      //
      // 例外匹配：见 resolveException（与可读段共用同一份实现）。
      const ex = resolveException(seg.text, labels)
      if (ex && ex.action !== 'allow') {
        action = ex.action
        source = 'exception'
        reason = ex.reason || null
        // note 是 ask 例外的备注（弹窗上给人看「当初为什么特意拦它」），opaque 段同样要带上
        note = ex.note || null
        ruleId = ex.ruleId || null
      } else if (destructive) {
        const ds = h.destructive ? h.destructive() : null
        action = (ds && ds.action) || 'inherit'
        source = 'destructive'
        reason = (ds && ds.reason) || null
      } else {
        const c = catOf()
        action = c.action
        source = 'category'
        reason = c.reason
      }
    } else {
      // ① 用户例外（段级匹配）—— 显式表态，优先于子设置（D-5）。
      // 与 opaque 分支共用 resolveException：试段原文 + 全部 label，deny > ask > allow。
      const ex = resolveException(seg.text, labels)
      if (ex) {
        action = ex.action
        source = 'exception'
        reason = ex.reason || null
        note = ex.note || null
        ruleId = ex.ruleId || null
      } else if (destructive) {
        // ② destructive 子设置 —— 更细的判定，优先于分类默认值（D-6）
        const ds = h.destructive ? h.destructive() : null
        action = (ds && ds.action) || 'inherit'
        source = 'destructive'
        reason = (ds && ds.reason) || null
      } else {
        // ③ command 分类默认值
        const c = catOf()
        action = c.action
        source = 'category'
        reason = c.reason
      }
    }
    // 拒绝理由只在 deny 时下发：allow 不弹窗用不上，ask 有自己的备注。
    // 这与 normalizeCategory / normalizeException 的存储侧口径一致（那边只在 deny 时存 reason），
    // 这里是第二道闸 —— 存储侧的口径不该是唯一的保证。
    if (action !== 'deny') reason = null

    // 段级 code 仅供弹窗展示与决策日志（不参与动作选择）。
    // 优先级：确定的危险（label 精确命中名单）> 读不懂 > 写向工作区外。
    // 一个段可能同时是「破坏性」且「读不懂」（`rm -rf $(x)`）：报 destructive —— 那是
    // 用户更需要看到的信息，也是该段实际走子设置的原因。
    const code = destructive ? 'destructive' : (unparsable ? 'unparsable' : (writeOutside ? 'write-outside' : null))

    if (action === 'deny') anyDeny = true
    else if (action === 'ask') anyAsk = true
    else if (action === 'inherit') anyInherit = true

    out.push({ op: seg.op, text: seg.text, label, action, source, code, ruleId, reason, note, dynamic: seg.dynamic })
  }

  // fail-closed 合并：拒绝面取并集、放行面取交集。
  // 注意这与「自定义规则首条命中」**不是**同一条原则，两者也不该统一：
  //   · 段之间是**并列**关系（一条命令里同时存在多个段，必须全部被授权才算授权），
  //     所以这里取并集/交集 —— 段没有「谁更具体」之分，只能整体从严；
  //   · 规则之间是**优先级**关系（用户用列表顺序表达「哪条更具体」），
  //     所以那边按顺序取首条，让「具体覆盖宽泛」可表达（见 decide() 的规则循环）。
  // 曾经把两者统一成「取最严」，结果是规则侧失去了表达力（实测：具体 allow 被宽泛 deny 吃掉）。
  let action
  let code
  if (anyDeny) { action = 'deny'; code = 'segment-deny' }
  else if (anyAsk) { action = 'ask'; code = 'segment-ask' }
  else if (anyInherit) { action = 'inherit'; code = 'all-inherit' }
  else { action = 'allow'; code = 'all-allow' }

  // 决定最终动作的那一段：它的 reason/ruleId/note 随判定一起下发
  const decisive = out.find((s) => s.action === action) || out[0]
  return {
    action,
    code,
    segments: out,
    matched: decisive ? decisive.ruleId : null,
    reason: decisive ? decisive.reason : null,
    note: decisive ? decisive.note : null,
  }
}

/** 段级 code → 双语短标签（弹窗与决策日志共用，避免两处各写一份文案）。 */
export function codeLabel(code) {
  if (code === 'destructive') return bi('破坏性命令', 'Destructive command')
  if (code === 'unparsable') return bi('无法解析', 'Cannot be parsed')
  if (code === 'write-outside') return bi('重定向到工作区外', 'Redirects outside workspace')
  return null
}
