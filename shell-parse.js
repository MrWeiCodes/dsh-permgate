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
 * 查找表构造单点：**必须**产出不继承 `Object.prototype` 的字典。
 *
 * 本文件所有 `NAME: 1` 形式的表都经此构造。理由：表的键来自**命令文本**（命令名、
 * 选项、子命令），而查表处多数用真值判断（`if (!WRAPPERS[name]) break`、
 * `if (NESTED_EVAL[base])`、`PRIV_VALUE_IS_COMMAND[prevPrefix]`）。用对象字面量时
 * 表会继承 `Object.prototype`，于是下面这些**恒为真值**：
 *
 *     WRAPPERS['constructor']              = function Object() { [native code] }
 *     NESTED_SHELLS['constructor']         = 同上
 *     STATEMENT_KEYWORDS['constructor']    = 同上
 *     PRIV_VALUE_IS_COMMAND['constructor'] = 同上
 *
 * 这不是理论问题，三条路径都已实测复现（`commandNameOf` 会小写化，故只有
 * `constructor` 与 `__proto__` 两个名字逃得掉 —— 其余原型名如 `toString` 变成
 * `tostring` 就安全了）：
 *
 *   ① **误报**：`constructor rm -rf /` 被当成「`constructor` 是嵌套 shell，`rm` 是它的
 *      内联程序」→ 判 deny。而 `constructor` 不是 shell，`rm` 只是它的参数。
 *      对照同形状的普通命令名 `foo rm -rf /` 是 allow —— 两者结论不同才是问题。
 *      带扩展名的脚本同样触发：`constructor.cmd rm -rf /` / `.exe` / `.bat` / `.ps1`。
 *   ② **候选死结**：`constructor x` 的 label 被吃成 `x`，候选生成器产出 `x *`，
 *      而它**匹配不上原命令**（`matchCommand('x *', 'constructor x')` = false）——
 *      用户点「允许并记住」写入的例外永不生效，命令照旧弹窗，判重又让该候选下次消失。
 *   ③ **例外被吞**：裸 `constructor` 的 label 成了空串 → 判 `unparsable` →
 *      按设计跳过 allow 例外，用户写的 `constructor`=allow 静默失效。
 *
 * 为什么改**表的构造**而不是逐处加 `=== 1`：一处改动覆盖该表全部查表点，日后新增
 * 查表处不会漏；而本文件已有 11 处真值判断，逐处改既易漏又会被后人写回真值形式。
 * 这与 `blastRadiusOfSegment` 里 `skip` 用 `Object.create(null)` 是同一条纪律
 * （那里早已写明「不能用 `{}`」），现在统一到同一个单点上。
 *
 * 代价：无原型对象没有 `hasOwnProperty` 等方法。本文件对这些表只做 `t[k]` 取值与
 * `for...in` 之外的遍历，不用其原型方法，故无影响。
 *
 * @param {object} src 字面量表
 * @returns {object} 同内容、原型为 null 的字典
 */
const dict = (src) => Object.assign(Object.create(null), src)

/**
 * 共享的**只读**空字典，用于「表里没有这一项」的兜底。
 *
 * 为什么不用 `|| {}`：本文件已确立「查表用的对象不得继承 `Object.prototype`」这条纪律，
 * 而 `|| {}` 会在兜底路径上悄悄退回有原型的对象 —— 当前那两处的键必以 `-` 开头
 * （见 `unwrapWords` 里的 `token.startsWith('-')`），原型属性名无一以 `-` 开头，
 * 故今天不可达；但留着它就是给后人一个「`{}` 也能用」的错误示范。
 * 冻结是为了让误写立刻抛错（ESM 默认严格模式），而不是静默污染共享对象。
 */
const EMPTY_DICT = Object.freeze(dict({}))

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
const PS_KEYWORDS = dict({ foreach: 1, if: 1, else: 1, elseif: 1, for: 1, while: 1, do: 1, until: 1, switch: 1, return: 1, function: 1, filter: 1, param: 1, begin: 1, process: 1, end: 1, try: 1, catch: 1, finally: 1, throw: 1, break: 1, continue: 1, trap: 1, in: 1, not: 1, and: 1, or: 1, class: 1, enum: 1, using: 1, exit: 1, dynamicparam: 1, data: 1 })
// bash 语句关键字与保留字：then/elif/fi/done/esac 是 if/for/while/case 的分段结果，
// time 与 ! 是命令前缀，case/select/coproc 开启新语句。
const BASH_KEYWORDS = dict({ then: 1, elif: 1, fi: 1, done: 1, esac: 1, time: 1, '!': 1, case: 1, select: 1, coproc: 1, '{': 1, '}': 1 })
const STATEMENT_KEYWORDS = dict(Object.assign({}, PS_KEYWORDS, BASH_KEYWORDS))

// 子命令路由器命令族：label 细化到「git status」这一粒度，而不是一放全放「git *」。
// reg 也在此列：`reg delete` 是破坏性的而 `reg query` 不是，不细分就无法区分。
const ROUTER_CMDS = dict({ git: 1, npm: 1, pnpm: 1, yarn: 1, docker: 1, kubectl: 1, dotnet: 1, cargo: 1, go: 1, gh: 1, pip: 1, uv: 1, conda: 1, reg: 1 })

// 路由器命令的「带值选项」：跳过选项本身后还要跳过它的值（git -c key=val / npm --prefix ./x）
const ROUTER_OPT_VALUE = dict({ '-c': 1, '-C': 1, '--config': 1, '--config-env': 1, '--git-dir': 1, '--work-tree': 1, '--namespace': 1, '--exec-path': 1, '-H': 1, '--prefix': 1, '--cwd': 1, '--project': 1, '--registry': 1 })

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
const WRAPPERS = dict({ env: 1, timeout: 1, nice: 1, xargs: 1, command: 1, builtin: 1, exec: 1, nohup: 1, setsid: 1, stdbuf: 1, ionice: 1 })
// 各 wrapper 的「带值 flag」：`-u FOO` 里的 FOO 是值不是命令。
// 只认精确拼写（`--unset=FOO` 自带值，不消耗下一个词元）。
const WRAPPER_VALUE_FLAGS = dict({
  env: dict({ '-u': 1, '-C': 1, '-S': 1, '--unset': 1, '--chdir': 1, '--split-string': 1, '--argv0': 1 }),
  timeout: dict({ '-s': 1, '-k': 1, '--signal': 1, '--kill-after': 1 }),
  nice: dict({ '-n': 1, '--adjustment': 1 }),
  xargs: dict({ '-n': 1, '-I': 1, '-i': 1, '-P': 1, '-L': 1, '-s': 1, '-d': 1, '-E': 1, '-a': 1, '--max-args': 1, '--replace': 1, '--max-procs': 1, '--max-lines': 1, '--max-chars': 1, '--delimiter': 1, '--eof': 1, '--arg-file': 1 }),
  stdbuf: dict({ '-i': 1, '-o': 1, '-e': 1, '--input': 1, '--output': 1, '--error': 1 }),
  ionice: dict({ '-c': 1, '-n': 1, '-p': 1, '-P': 1, '-u': 1, '--class': 1, '--classdata': 1, '--pid': 1, '--pgid': 1, '--uid': 1 }),
})

// 嵌套解释器：带内联程序时整段不可静态解析（程序正文是我们读不懂的另一门语言）。
// 不带内联程序的不算（`node --check x.js`、`python script.py` 都是可读的常规调用）。
const NESTED_INTERPRETERS = dict({ node: 1, deno: 1, bun: 1, python: 1, python3: 1, perl: 1, ruby: 1, php: 1, lua: 1, osascript: 1 })
const NESTED_SHELLS = dict({ sh: 1, bash: 1, zsh: 1, fish: 1, ksh: 1, dash: 1, cmd: 1, powershell: 1, pwsh: 1 })
// eval 族必然执行字符串，没有「不带程序」的形态
const NESTED_EVAL = dict({ eval: 1, iex: 1, 'invoke-expression': 1 })
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
// `cat C:\Users\u\.ssh\id_rsa` 到达词元列表时已变成 `B:Usersu.sshid_rsa` ——
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
 * 从 flag 词元里撬出路径值：长选项在 `=` 后（`--output=B:/abs`），
 * 融合短选项把值接在选项字母后（`-oB:/abs`，GNU sort/tree 风格）。
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
    // 盘符段自身含通配（`B:*`）仍指盘根：交回盘符，而不是塌成当前目录
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
      // （异常被上层 catch 后走 next()），比漏判更糟。用 EMPTY_DICT 兜住
      //（不用 `{}` —— 那会退回有原型对象，见 EMPTY_DICT 的说明）。
      const valueFlags = WRAPPER_VALUE_FLAGS[name] || EMPTY_DICT
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
const FIND_EXEC_FLAGS = dict({ '-exec': 1, '-execdir': 1, '-ok': 1, '-okdir': 1 })
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
  // ── 廉价预筛：整段里没有任何 `-exec` 族或 `-delete` 时直接返回 ────────────────
  // 下面的循环对**每个** `-exec` 都做一次 `w.slice(j + 1)`（O(n) 拷贝）再 unwrapWords，
  // 于是段内有 n 个 `-exec` 时整体 O(n²)。它在判定侧早就存在，但本次改动把
  // `isDestructiveSegment` 加进了候选生成循环（index.js 对每个段调一次），于是
  // **弹窗出现前**也要付这笔钱。实测直接构造词元（`-exec echo i ;` 重复 n 组）：
  //   n=500 → 1.53 ms、1000 → 2.20、2000 → 5.91、4000 → 20.60、8000 → **406.72 ms**
  // 而 buildCandidates 是同步执行、早于 pendingApprovals.set，直接推迟弹窗。
  // 预筛本身是 O(n) 的单次扫描（无切片、无分配），实测 20000 词元约 0.0002 ms ——
  // 只有真正含这些 flag 的段才会走下面的循环。判据与下面循环读取的常量同源，
  // 不会因为新增 flag 而漏（FIND_EXEC_FLAGS / FIND_DELETE_FLAG 是唯二判据）。
  let hasFindAction = false
  for (let j = start + 1; j < w.length; j += 1) {
    const tk = String(w[j])
    if (tk === FIND_DELETE_FLAG || FIND_EXEC_FLAGS[tk]) { hasFindAction = true; break }
  }
  if (!hasFindAction) return out
  for (let j = start + 1; j < w.length; j += 1) {
    const token = String(w[j])
    if (token === FIND_DELETE_FLAG) { out.push('rm'); continue }
    if (!FIND_EXEC_FLAGS[token]) continue
    // `-exec` 之后跟的是**一条完整命令行**，同样可以有前缀包装器 —— 必须复用 unwrapWords，
    // 否则 `find . -exec env rm -rf {} \;` 的 label 会取到 `env`，真正的 rm 不可见
    // （实测：`find . -exec rm` 是 deny，而 `-exec env rm` / `timeout 5 rm` / `nice rm` → allow）。
    // 这与主 label 路径（segmentLabel 靠 unwrapWords 剥前缀）口径一致。
    //
    // ── 只在**可能剥掉前缀**时才复制后缀 ────────────────────────────────────────
    // `w.slice(j + 1)` 是 O(剩余词元数)，而段里有 n 个 `-exec` 时整体退化成 O(n²)。
    // 实测（`-exec echo i ;` 重复 n 组）：n=2000 → 6.8 ms、4000 → 17.1 ms、8000 → **469 ms**、
    // 16000 → 2041 ms。它在**候选生成**路径上（本次改动把 isDestructiveSegment 加进了
    // index.js 的候选循环），而 buildCandidates 同步执行、早于 pendingApprovals.set ——
    // 直接推迟弹窗，而命令文本由 AI 生成、长度无上界。
    //
    // 快路径的**等价性**：unwrapWords 只在两种情况下剥词元（或判 opaque）——
    // ① 前导 `NAME=value`；② 首词元是 WRAPPERS 里的名字。两者都不成立时它原样返回，
    // 于是「从 j+1 起找第一个有效命令名」与「先 slice 再 unwrapWords 再找」结论完全相同。
    // 用词元**本身**判断（不看后面），故不存在窗口截断导致漏判的可能。
    const firstTok = String(w[j + 1] == null ? '' : w[j + 1])
    if (!/^[A-Za-z_][A-Za-z0-9_]*=/.test(firstTok) && WRAPPERS[commandNameOf(firstTok)] !== 1) {
      for (let k = j + 1; k < w.length; k += 1) {
        const cand = commandNameOf(w[k])
        if (!cand || cand === '{}' || cand === ';' || cand === '+') continue
        if (BAD_LABEL_CHARS.test(cand)) break
        out.push(cand)
        break
      }
      continue
    }
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
 * 该段是否为「破坏性命令段」—— 判据与 assessCommand **完全同源**（同一份 segmentLabels）。
 *
 * 导出给 index.js 复用（候选生成、例外列表标注）：那两处都必须用这一份，不能各自取
 * `segmentLabel` 的主 label 再判名单 —— 两者对 `find` 族结论**相反**：
 * `segmentLabels` 会为 `find -delete` / `find -exec rm` 合成一个 `rm` label（见该函数注释），
 * 而主 label 恒为 `find`（不在 DESTRUCTIVE_LABELS 里）。
 *
 * 分叉的后果（实测）：`find . -delete` 在判定侧是 destructive（落破坏性子设置），
 * 候选侧却按非破坏性生成通配候选 `find *`；用户点一次「允许并记住」写入该例外后，
 * `find . -delete` 在 destructive=deny 下由 **deny 变 allow** —— 正是候选侧收紧
 * 通配（index.js 的「破坏性命令不给通配候选」）要堵的那个洞，只是换了个命令族。
 *
 * @param {string[]} words 段词元（与 assessCommand 的 seg.words 同源）
 */
export function isDestructiveSegment(words) {
  return segmentLabels(words).some((l) => isDestructiveLabel(l))
}

// 提权前缀：在 DESTRUCTIVE_LABELS 里、但**不在 WRAPPERS 里**（它们改变权限，不是透明包装）。
// 命令头解析必须能穿过它们，否则「提权 + 真命令」的组合会被当成「提权命令 + 目标实参」。
const PRIV_PREFIXES = dict({ sudo: 1, doas: 1, su: 1, pkexec: 1, runas: 1, gsudo: 1 })

// 提权命令的「带值选项」：`-u FOO` 里的 FOO 是值不是命令。
// 与 WRAPPER_VALUE_FLAGS 同性质，但按提权命令单独维护（两族的选项集不同）。
// 只认精确拼写（`--user=FOO` 自带值，不消耗下一个词元）。
//
// **`su -c` / `--command` 刻意不在表里**：它的值**本身就是一条命令**
// （`su -c "rm -rf /"`、`su -c rm -rf /` 都会真的执行 rm），跳过值等于把真正的
// 命令名一起吃掉。实测（A/B 对拍）：把它当带值选项时 `su -c rm -rf /` 的爆炸半径
// 从 drive-root 退化成 null —— 删盘根的警告被静默吃掉，是本文件反复警告的那类漏报。
// 不跳则 `-c` 之后的值被当作「命令名」继续吃（`rm` 在破坏性名单里，正确判档）。
const PRIV_VALUE_FLAGS = dict({
  sudo: dict({ '-u': 1, '-g': 1, '-p': 1, '-C': 1, '-U': 1, '-h': 1, '-r': 1, '-t': 1, '--user': 1, '--group': 1, '--prompt': 1, '--close-from': 1, '--other-user': 1, '--host': 1, '--role': 1, '--type': 1 }),
  doas: dict({ '-u': 1, '-C': 1 }),
  pkexec: dict({ '--user': 1 }),
  gsudo: dict({ '-u': 1, '--user': 1 }),
  runas: dict({}),
  su: dict({}),
})

// 前缀命令里「**值本身就是命令或目标**」的那几个 —— 上面两张表刻意留空（`su: {}` / `runas: {}`）
// 正是这个意思，此处给它一个名字供 commandHeadEnd 查询。
//
// 为什么单列：`su -c <值>` 的值是一条命令行（`su -c "rm -rf /"`），也可能是**目标**
// （`su -c C:/Windows`、`su -c of=/dev/sda`、`su -c ~`）。命令头解析若「因为前面有前缀，
// 就把下一个词元一律当命令名吃掉」，这些目标会被整段吞掉、段级 blast 归 null ——
// 实测 7 种形态（system / home 档）的警告消失，是把闸开过头造成的新漏报。
// 故这几个前缀**不吃**其后的词元，退回「只有命中破坏性名单才吃」的判据
// （`su -c rm -rf /` 的值是 `rm`，在名单里，照吃；`su -c C:/Windows` 不在名单里，留给目标判档）。
const PRIV_VALUE_IS_COMMAND = dict({ su: 1, runas: 1 })

/**
 * 跳过某个前缀命令（提权 / wrapper）自己的选项与带值选项，返回下一个「可能是命令」的下标。
 *
 * 存在的理由：`sudo -u root rm -rf *` 的命令头里夹着 `-u root`，而「遇到 `-` 就停」的判据
 * 会让命令头停在 `sudo` 上，真正的 `rm` 被当成**目标实参** —— 实测该例外的爆炸半径
 * 返回 null（`sudo rm -rf *` 则正确判 broad），而 `matchCommand('sudo -u root rm -rf *',
 * 'sudo -u root rm -rf /')` 为 true：一条能放行删盘根的 allow 例外在面板上零标注。
 *
 * 只吃「选项 + 它的值」，遇到第一个非选项词元就停（那就是下一个命令名或目标）。
 *
 * @param {string[]} w 词元列表
 * @param {number} start 前缀命令名之后的下标
 * @param {string} name 前缀命令名（小写，已过 commandNameOf）
 */
function skipPrefixArgs(w, start, name) {
  let j = start
  const valueFlags = PRIV_VALUE_FLAGS[name] || WRAPPER_VALUE_FLAGS[name] || EMPTY_DICT
  while (j < w.length) {
    const token = String(w[j])
    // env 的 `NAME=value` 赋值前缀不是选项，但同样不是命令
    if (name === 'env' && /^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) { j += 1; continue }
    // **只有 `-` 开头才是前缀命令的选项**。
    //
    // 这里曾经把 `/` 开头也一并当选项（`!== 45 && !== 47`），而 POSIX 上 `/` 开头是**路径**：
    // `nice /usr/bin/find / -delete` 的前缀循环会把 `/usr/bin/find`、`/`、`-delete` 一路吃光
    // 直到词元耗尽，`commandHeadEnd` 返回词元总数，`i < headEnd` 于是把**整段**跳空 ——
    // 实测 `blastRadiusOfSegment(['nice','/usr/bin/find','/','-delete'], posix)` = null，
    // 而把命令名写成裸名 `['nice','find','/','-delete']` = drive-root|/。
    // 覆盖全部 6 个 wrapper + 6 个提权前缀：`sudo /usr/bin/find /etc -delete`、
    // `sudo /usr/bin/find / -exec rm -rf {} +` 这些真删盘根/系统目录的命令
    // `code=destructive` 而弹窗零警告。用绝对路径调用 `find`/`xargs` 是脚本常规写法，
    // 不是构造输入。注意 `sudo /bin/rm -rf /` 侥幸正确只是因为 basename 在破坏性名单里
    // （见下面那行 break），`find`/`xargs` 族的破坏性来自后续 flag 而非命令名，没有这层保护。
    //
    // `/s` 这类 cmd 风格开关不属于此处：它们是 `rmdir`/`del` 这类**破坏性命令自己**的选项，
    // 而本函数只跳过 wrapper/提权命令的参数（那些命令没有 `/x` 形态的选项），
    // 且段级判档侧另有 isCmdStyleSwitch 负责它们。
    if (token.charCodeAt(0) !== 45) break
    if (valueFlags[token]) j += 1
    j += 1
  }
  // timeout 的时长位置参数（`timeout 5 sudo rm -rf /`）
  if (name === 'timeout' && /^[0-9]+(?:\.[0-9]+)?[smhd]?$/.test(String(w[j] == null ? '' : w[j]))) j += 1
  return j
}

/**
 * 命令头在词元列表里的**结束下标**（不含）：提权前缀链 + wrapper 链 + 最终的命令名。
 *
 * 与 `segmentLabel` 的分工：那个回答「这段叫什么」（路由器命令 `git status` 是**一个** label，
 * 词数是 2），这个回答「命令头到哪儿为止」（哪些词元不是目标实参）。两者不可互相替代 ——
 * `sudo` 的 label 是 `sudo`（词数 1），而它的命令头到 `rm` 为止（`sudo -u root rm` 是 4 个词元）。
 *
 * 判据：从段首开始**连续**吃掉前缀（提权命令与 wrapper，含各自的选项与带值选项），
 * 直到遇到一个「不是前缀、但在破坏性名单里」的命令名 —— 那就是真正吃目标的那个，吃掉它后停。
 * 首词元就不是前缀也不是破坏性命令时返回 0（`git status *` 走这条，调用方保持 label 词数）。
 *
 * @param {string[]} words 段词元
 * @returns {number} 结束下标（0 表示没吃到任何命令名）
 */
function commandHeadEnd(words) {
  const w = Array.isArray(words) ? words : []
  const n = w.length
  let j = 0
  // 是否已经吃掉过至少一个前缀（wrapper / 提权命令）。决定「命令名」要不要一并吃掉 ——
  // 见下面 ② 的说明。
  let sawPrefix = false
  // 最后吃掉的**前缀命令名**（小写）：`su` / `runas` 的值本身即命令或目标，
  // 其后词元不能一律当命令名吃掉（见 PRIV_VALUE_IS_COMMAND 与 ② 的说明）。
  let prevPrefix = ''
  // 前导 NAME=value（`FOO=1 rm -rf /`）：与 unwrapWords 同判据（至少留一个词元）。
  while (n - j > 1 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(String(w[j]))) j += 1
  // **纯下标推进，不复制数组**：这里曾经每轮 `unwrapWords(w.slice(j))` —— slice 是 O(n)，
  // 而轮数也是 O(n)，于是整条链退化成 O(n²)。实测 16000 个 `sudo` 前缀：n=8000 → 20 ms、
  // n=16000 → 79 ms（倍率≈4.0，标准平方），而它在破坏性段的判档路径上、词元由 AI 生成、
  // 长度无上界 —— 与本文件其他几处平方退化是同一类问题，故一并按线性写。
  //
  // 每轮至少吃掉一个词元（前缀吃掉自己、命令名吃掉自己），故 guard 取词元数即不可能漏判。
  for (let guard = 0; guard <= n && j < n; guard += 1) {
    const raw = String(w[j])
    // **含空白的词元不是命令名**，命令头到此为止。
    //
    // 词法器把引号内容并成一个词元，于是 `su -c "rm -rf /etc"` 的第三个词元是
    // `rm -rf /etc` —— 它是一条**被引号包起来的命令行**，不是命令名。若照常交给
    // commandNameOf（内部按路径 basename 取尾段），会得出荒谬的结果：`rm -rf /etc`
    // 的 basename 是 `etc`、`rm -rf /` 的 basename 是空串，于是同一构造只因目标不同
    // 就分叉 —— 实测 `su -c "rm -rf /"` 的 headEnd=2（侥幸正确），而
    // `su -c "rm -rf /etc"` 的 headEnd=**3**，把整个引号词元当命令名吃掉，
    // 段级判档最终返回 null（删系统目录零警告）。
    // 交回给调用方：blastRadiusOfSegment 会识别「含空白的词元」并按子命令行递归判档。
    if (/\s/.test(raw)) break
    const base = commandNameOf(w[j])
    if (!base) break
    // ① 前缀：wrapper 与提权命令**同处置** —— skipPrefixArgs 已按名字查两张带值选项表，
    //    故不需要再调 unwrapWords（那条路径有 depth<4 的层数上限，深链本就会漏）。
    if (WRAPPERS[base] === 1 || PRIV_PREFIXES[base] === 1) {
      const next = skipPrefixArgs(w, j + 1, base)
      j = next > j ? next : j + 1
      sawPrefix = true
      prevPrefix = base
      continue
    }
    // ② 命令名：吃掉它后停。这就是吃目标的那个。
    //
    // 判据含 `sawPrefix`：**前缀之后的那一个词元通常是命令名**，不管它在不在破坏性名单里。
    // 只认破坏性名单会让 `sudo /usr/bin/find /etc -delete` 的 `/usr/bin/find`（命令名，
    // 只是 `find` 本身不在名单里 —— 它的破坏性来自后续 `-delete`）留在 rest 里被当成
    // **目标实参**判档：实测弹窗写「目标是系统目录（/usr/bin/find）」，而真目标 `/etc`
    // 被遮蔽；`sudo /usr/bin/find /tmp/x -delete` 更糟 —— 命令名判 system 盖过真目标的
    // outside，变成一条指错对象的警告。
    //
    // ── 但 `su` / `runas` 不适用：它们的值**本身就是命令或目标** ──────────────────
    // `su -c <值>` 的值是一条命令行（`su -c "rm -rf /"`），而 `su -c C:/Windows` 里
    // 它就是**目标**。无条件吃掉下一个词元会把目标当命令名吞掉 —— 实测（与加 sawPrefix
    // 的版本对拍）`su -c C:/Windows` 的 system 警告、`su -c C:/Users/me` 与 `su -c ~`
    // 的 home 警告、`su -c of=/dev/sda` 与 `su -c C:/$Recycle.Bin` 的 system 警告
    // 全部消失（7 种形态 × 两个平台）—— 那是把这条闸开过头造成的**新漏报**。
    //
    // 故 `su` / `runas` 退回纯 `isDestructiveLabel` 判据（`su -c rm -rf /` 的值是 `rm`，
    // 在名单里，照吃；`su -c C:/Windows` 的值不在名单里，留给目标判档）。
    // 判据复用 PRIV_VALUE_IS_COMMAND（就是 PRIV_VALUE_FLAGS 里刻意留空的那两个 —— 见其注释）。
    if ((sawPrefix && !PRIV_VALUE_IS_COMMAND[prevPrefix]) || isDestructiveLabel(base)) j += 1
    break
  }
  return j
}

// 「可携带破坏性载荷」的命令族：**自身**不是破坏性命令，但后面接的东西可能让整段变成删除。
//   · 前缀包装器（`env` / `xargs` / `nohup` / `timeout` …）—— `env FOO=1 rm -rf /`、
//     `xargs rm -rf /`、`nohup rm -rf /`；
//   · `find` —— `find / -delete`、`find / -exec rm -rf {} +`（`-delete` / `-exec` 由
//     segmentLabels 合成 `rm` label，故**展开后**的段是 destructive，但例外模式
//     `find *` 本身不含这些选项，`isDestructiveSegment(['find','*'])` 为 false）。
//
// 存在的理由：例外列表的标注判据若只认 `isDestructiveSegment`，则存量里由**旧候选生成器**
// 写下的 `find *` / `env *` / `xargs *` 全部零标注 —— 而它们实测能放行
// `find / -delete`、`env FOO=1 rm -rf /`、`xargs rm -rf /`（在 destructive=deny 下由 deny 变
// allow）。`find *` 正是 HEAD 对 `find . -delete` 弹窗给出的候选，属必然存在的存量配置，
// 而例外列表自陈是「唯一能让人事后发现『我什么时候放行了删盘根』的地方」。
//
// 判据只收「载荷可能变成破坏性」的族，不含普通命令：`git status *` 不在此列 ——
// 标注它只会制造噪音，而噪音会让真正的警告被忽略（狼来了）。
const PAYLOAD_CARRIERS = dict(Object.assign({ find: 1 }, WRAPPERS))

/**
 * 该 **label** 的命令族是否可能携带破坏性载荷（`find` / `env` / `xargs` …，见 PAYLOAD_CARRIERS）。
 *
 * 与 canCarryDestructivePayload 的区别：那个看**段的词元**（含 wrapper 与选项），
 * 这个只看**归约后的 label**（`git status`、`find`、`rm`）—— 候选生成需要后者，
 * 因为它决定「`label + ' *'` 这条通配候选会放开多大范围」：
 *   · label `find` → `find *` 实测匹配 `find / -delete`，是能放行删盘根的通配候选；
 *   · label `git status` → `git status *` 匹配不到任何删除动作，通配候选安全。
 * 注意 `env FOO=1 git status` 的 label 是 `git status`（wrapper 已被剥掉），
 * 其通配候选 `git status *` 同样安全 —— 故这里判 label 而不是判段首词元。
 *
 * @param {string} label segmentLabel 的返回值
 */
export function isPayloadCarrierLabel(label) {
  const l = String(label == null ? '' : label).trim().toLowerCase()
  if (!l) return false
  return l.split(/\s+/).some((n) => PAYLOAD_CARRIERS[n] === 1)
}

/**
 * 该段的**命令族**是否可能携带破坏性载荷（见 PAYLOAD_CARRIERS）。
 *
 * 与 isDestructiveSegment 的分工：后者问「这一段**就是**破坏性的吗」（判定侧用），
 * 本函数问「这一段**可能变成**破坏性的吗」（例外列表的审计标注用，模式里的 `*`
 * 可能被真实命令的 `-delete` / `rm -rf` 填上）。
 *
 * @param {string[]} words 段词元
 */
export function canCarryDestructivePayload(words) {
  const w = Array.isArray(words) ? words : []
  if (!w.length) return false
  // ① 段首命令名（**未剥 wrapper**）：`env *`、`xargs *`、`find *` 的载荷族正是段首那个名字。
  //    不能只看 segmentLabels —— 它剥掉 wrapper 后剩下 `*`，认不出命令名而返回空。
  let head = ''
  try { head = String(commandNameOf(w[0]) || '').trim().toLowerCase() } catch (e) { head = '' }
  if (PAYLOAD_CARRIERS[head] === 1) return true
  // ② 剥掉 wrapper/赋值后的全部 label：覆盖 `FOO=1 find *`、语句关键字之后等形态，
  //    以及 `find / -delete` 这类合成 label（`-delete` 合成 `rm`，命中破坏性名单）。
  let names = []
  try { names = segmentLabels(w) } catch (e) { return false }
  return names.some((l) => {
    const n = String(l || '').trim().toLowerCase()
    return PAYLOAD_CARRIERS[n] === 1 || isDestructiveLabel(n)
  })
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
  // 去重集合无原型：键是 label（来自命令文本）。用 `{}` 时 `constructor` / `__proto__`
  // 这类名字恒判「已见过」而被丢弃 —— 它们恰是本函数要抓出来的命令名。
  const seen = Object.create(null)
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

// ── 爆炸半径（blast radius）：这一段的删除/销毁目标有多大 ─────────────────────
//
// 问题：判定链只回答「要不要问」，不回答「这一下有多重」—— 而审批人恰恰只能靠后者
// 决定点不点。下面两个目标的动作与候选完全相同，面板上看起来毫无区别：
//     rmdir /s /q B:\                      ← 整个盘
//     rmdir /s /q B:\demo-app\build   ← 一个构建目录
// 本函数把目标分档，供弹窗与例外列表显示警告。
//
// 本函数只做**分类**，不改动作（动作仍由判定链决定）：把目标归到一档，供弹窗与列表
// 显示警告。分档的依据是「一次误操作会造成多大范围不可逆损失」，故顺序即严重度。
//
// 为什么不做成「危险目标 → 强制 deny」：那会把「用户确实想清空某个系统临时目录」
// 这类合法操作一并堵死，且盘根判定必然有边界情形（junction/挂载点）。显示警告让**人**
// 来判断，与「审批」这件事的定位一致：机器负责把信息摆全，人负责决定。
//
// 系统目录名单刻意只收「删了必然出大事且几乎不可能是本意」的路径，不追求穷尽：
// 名单越长，误报越多，而误报会让真正的警告被忽略（狼来了）。
//
// **必须锚定到根**（盘符 `C:` 或前导分隔符），不能匹配相对路径：`lib`、`bin`、`etc`、
// `var`、`opt`、`dev`、`sys` 在工作区里是极常见的目录名（前端项目几乎必有 `lib`/`bin`），
// 而按本函数契约工作区内的相对目标应判 `inside`、不警告 —— 旧判据（`[\\/]*` 可匹配空串）
// 把 `rm -rf lib` 判成 system，弹窗写「目标是系统目录（lib）—— 删除后系统或软件可能无法启动」，
// 正是注释里说的狼来了。实测旧判据下 `lib`/`bin`/`etc`/`var`/`opt`/`dev`/`sys`/`boot`/
// `lib64`/`sbin`/`usr` 全部误报为 system，而 `src`/`build`/`dist` 正常。
//
// 名单拆两张表，差别只在「要不要前导分隔符」：
//   · 根锚定表 —— 含 `etc`/`usr`/`bin` 这类短通用名。它们**只有落在根下**
//     才是系统目录（`/etc`、`C:\Windows`），作为相对路径则是普通项目目录。
//   · BARE 表 —— 只收「在项目里几乎不可能出现的独特名」。
//     既有测试 L11 要求 `Windows\System32` 判 system，而 `Windows` 不会是一个项目目录名，
//     故这类名字不必要求前导分隔符；`lib`/`etc` 则必须要求。
//
// ── 名单必须按**操作系统**分开，不能混在一张表里 ──────────────────────────────
//
// 曾经把两套系统的名字混装在一张表里，于是两个方向都错：
//   · Linux/macOS 上 `C:\Windows`、`C:\Program Files` 被判 system ——
//     它们在 POSIX 上只是「名字里带反斜杠和冒号」的普通相对路径，根本不是系统目录（误报）。
//   · Windows 上 `/etc`、`/usr` 被判 system —— 它们在 Windows 上是「当前盘根下的 etc」，
//     同样不是系统目录（误报）。
// 混装的代价是双向误报，而误报会让真正的警告被忽略（狼来了）。
//
// 平台由调用方通过 `opts.platform` 传入（'win32' | 'posix'）。**这是必须显式传的信息**：
// 本模块是纯解析器（不访问 process），且**方言不等于平台** —— Linux 上跑 PowerShell Core
// （pwsh 工具）时路径仍是 POSIX 的 `/etc`，把方言当平台会让 `/etc` 被当成 cmd 开关而静默。
// 平台未知（旧调用方/测试）时**两张表都查**：宁可多警告，不可漏警告（方向 fail-safe）。
const WIN_SYSTEM_ROOT_RE = /^(?:[a-z]:)?[\\/]+(?:windows|winnt|program files(?: \(x86\))?|programdata|system32|syswow64|applications|recovery|perflogs|\$recycle\.bin)(?:[\\/]|$)/i
const WIN_SYSTEM_BARE_RE = /^(?:windows|winnt|program files(?: \(x86\))?|programdata|system32|syswow64|applications|recovery|perflogs|\$recycle\.bin)(?:[\\/]|$)/i
// POSIX 系统目录：只收「删了必然出大事」的根级目录。
// **不含 `home` / `Users`** —— 它们不是系统目录本身，而是「用户目录的父目录」，
// 与 Windows 的 `C:\Users` 同理：删 `C:\Users` 是大事，但 `C:\Users\me\code\proj\build`
// 只是工作区内的一个目录。把它们整片收进名单会让「工作区位于家目录下」这一常态
// （Linux 的 `/home/<user>/...`、macOS 的 `/Users/<user>/...`）**所有工作区内绝对路径**
// 都被误报成 system —— 实测 `rm -rf /home/u/code/webapp/build` 曾被判 system，
// 而同样目标写成 `./build` 就是 inside，即同一件事因写法不同结论相反。
// 家目录**本身**由 home 档负责（`~` / userHome 比对），不需要系统目录名单来兜。
const POSIX_SYSTEM_ROOT_RE = /^\/(?:etc|usr|bin|sbin|lib|lib64|lib32|boot|dev|proc|sys|var|opt|root|srv|mnt|media|run|private)(?:[\\/]|$)/i

// `users` / `documents and settings` 单独收窄到「根 + 至多一层」：
//   `C:\Users`、`C:\Users\me` 是删用户配置，算系统级；
//   但 `C:\Users\me\code\proj\node_modules` 只是工作区内的一个目录 —— 旧判据把它判成
//   system，而「工作区放在 `C:/Users/<user>/` 下」是 Windows 上的常态，于是工作区内
//   **所有绝对路径**都被误报（实测 `rm -rf C:/Users/x/code/webapp/node_modules` → system，
//   而同样目标写成 `./node_modules` → inside，即同一件事因为写法不同结论相反）。
const USER_ROOT_RE = /^(?:[a-z]:)?[\\/]+(?:users|documents and settings)(?:[\\/][^\\/]+)?[\\/]?$/i

/**
 * 该路径是否落在**当前操作系统**的系统目录名单里。
 *
 * @param {string} p 已归一为 `/` 分隔、去掉尾部分隔符的路径
 * @param {string|undefined} platform 'win32' | 'posix'；未知时两张表都查（fail-safe）
 */
function isSystemDir(p, platform) {
  const bare = p.replace(/^[a-z]:/i, '').replace(/^\/+/, '')
  if (platform === 'win32') return WIN_SYSTEM_ROOT_RE.test(p) || WIN_SYSTEM_BARE_RE.test(bare) || USER_ROOT_RE.test(p)
  if (platform === 'posix') return POSIX_SYSTEM_ROOT_RE.test(p)
  // 未知：两张表都查 + Windows 的 users 收窄表，最大化警告覆盖
  return WIN_SYSTEM_ROOT_RE.test(p) || WIN_SYSTEM_BARE_RE.test(bare)
    || POSIX_SYSTEM_ROOT_RE.test(p) || USER_ROOT_RE.test(p)
}

/**
 * 该词元是否为 cmd 风格的 `/x` 开关（`/s` `/q` `/grant` `/pid`）。
 *
 * **只在 Windows 上成立**：POSIX 上 `/etc`、`/usr/bin` 是路径，不是开关。
 * 这一条是 Linux 上 pwsh 工具漏报系统目录的根因 —— 当时按方言（pwsh）判开关，
 * 而 Linux 上跑 PowerShell Core 时方言是 pwsh、路径却是 POSIX 的，于是 `/etc`
 * 被当开关跳过、段级 blast 静默（实测 `rm -rf /etc` 在 Linux+pwsh 下为 null，
 * 而同机 bash 下正确判 system）。
 *
 * 平台未知时**不跳**（返回 false）：方向必须 fail-safe —— 把路径当开关会**漏掉**警告
 * （静默），把开关当路径最多多一条警告。两者代价不对称，故未知时选后者。
 * 代价：旧调用方（不传 platform）在 Windows 上会为 `/s` `/q` 这类开关多出一条假警告，
 * 但那只影响尚未接线 platform 的调用方，且是可见的噪音而非静默的漏报。
 *
 * ── 但「Windows 上 `/` + 字母 ⇒ 开关」这条推论**本身也是错的** ──────────────────
 * Windows 上 `/Windows`、`/ProgramData`、`/Users` 是**当前盘根的绝对路径**
 * （`C:\Windows` 的另一种合法拼写），与 cmd 开关在语法上完全同形 —— 唯一的区别是名字。
 * 无条件按开关跳过，就在**出货平台**上把最该警告的目标整个吃掉：实测
 * `blastRadiusOf('/Windows', win32)` = system，而 `blastRadiusOfSegment(['rm','-rf','/Windows'], win32)`
 * = null；`/ProgramData` 同样（`Remove-Item -Recurse -Force /Windows` 零警告）。
 *
 * 判据因此收窄为：**只有不落在系统目录名单里的 `/x` 才是开关**。
 * 方向仍是 fail-safe —— 停跳的恰好是「漏掉它代价最大」的那一批（系统目录），
 * 其余（`/s` `/q` `/grant` `/pid`）照旧跳过，不制造噪音。
 */
function isCmdStyleSwitch(token, opts) {
  if (token.charCodeAt(0) !== 47) return false
  if (!/[a-z]/i.test(token.charAt(1))) return false      // `/` 与 `/*` 是路径，不是开关
  if (!(opts && opts.platform === 'win32')) return false // 只在明确是 Windows 时才当开关
  // `/Windows`、`/ProgramData` 是当前盘根下的系统目录，不是开关：交回判档。
  return !isSystemDir(token.replace(/\\/g, '/'), 'win32')
}

// 爆炸半径档位的**严重度顺序**（越小越严重）—— 全模块唯一一份，index.js 直接引用
// （曾经在 index.js 里手抄一份，键集合已经不同，且消费方式是「未知档静默跳过」）。
// broad = 例外模式的目标是不可判定的顶层通配（`rm -rf *`），它能匹配到盘根，
// 故排在 system 之前、drive-root 之后。
export const BLAST_ORDER = { 'drive-root': 0, broad: 1, system: 2, home: 3, outside: 4, inside: 5 }

// 「可能逃出工作区」的词元形态：分隔符、盘符、家目录、变量、通配符，或以 `.` 开头
// （`.`、`..`、`.git`）。纯词元（`build`、`lib`、`file.js`）在工作区内判档恒为 inside，
// 用于判档前的廉价预筛 —— 见 blastRadiusOfSegment 的循环。
const MAY_ESCAPE_RE = /[\\/:~$*?]|^\./

// 预筛**不能**只看 MAY_ESCAPE_RE：BARE 系统目录名（`Windows`、`System32`、`ProgramData`…）
// 刻意不含分隔符（那正是该表存在的理由，见 WIN_SYSTEM_BARE_RE 的注释与测试 L11），
// 于是它们会被预筛跳过、判档静默 —— 实测 `blastRadiusOf('Windows')` = system，而
// `blastRadiusOfSegment(['rm','-rf','Windows'])` = null，即该表唯一的调用点上被预筛抵消。
// 预筛是**纯性能优化**，绝不能改变结论：凡可能被任何判据判出非 inside 的词元都必须走完整判档。
//
// ── 预筛**不得**自带一份名单 ────────────────────────────────────────────────────
// 这里曾手抄一份 BARE 名单（`/^(?:windows|winnt|program files|programdata|…)/`），
// 与 WIN_SYSTEM_BARE_RE 漂移了一项：判档表写的是 `program files(?: \(x86\))?`，
// 手抄时写成裸 `program files`，于是 `Program Files (x86)` 被判档表判 system、
// 却被预筛跳过 —— 该表唯一的段级调用点上判档静默。实测（平台 win32）：
//   blastRadiusOf('Program Files (x86)')                  = system
//   blastRadiusOfSegment(['rm','-rf','Program Files (x86)']) = null
// 端到端 `rm -rf "Program Files (x86)"`（pwsh/bash 两个词法器都把它并成单个词元）
// 段 code=destructive 而 blast=null：删 Windows 最典型的系统目录之一，弹窗零警告；
// 仅差一个词的 `"Program Files"` 却有 system 警告。
//
// 两份名单必然再次漂移，故判据改为**直接问判档表**：复用 isSystemDir，预筛不再持有名单。
// 代价是每词元多一次正则（原预筛那一次正则同样要跑），量级不变。

/** 该词元是否必须先走完整判档（预筛为「可能危险/可能非 inside」时返回 true）。 */
function mayNeedBlastCheck(token, platform) {
  if (MAY_ESCAPE_RE.test(token)) return true
  // 非 Windows 平台不会命中 BARE 表（isSystemDir 在 posix 下只查 POSIX 表），无需放行
  if (platform === 'posix') return false
  // 平台未知时两张表都查（与 isSystemDir 的 fail-safe 方向一致）：宁可多判一次档，
  // 不可把一条系统目录警告静默吃掉。
  if (platform !== 'win32') {
    return WIN_SYSTEM_BARE_RE.test(token.replace(/^[a-z]:/i, '').replace(/^\/+/, ''))
      || POSIX_SYSTEM_ROOT_RE.test(token.replace(/\\/g, '/'))
  }
  // 判据与 isSystemDir 完全同源：不再各写一份名单。
  return isSystemDir(token.replace(/\\/g, '/'), 'win32')
}

/**
 * 判定一个路径目标的爆炸半径档位。
 *
 * @param {string} raw 目标路径原文（未展开；本函数内部做 `~` 展开与 glob 归约）
 * @param {{ home?: string, userHome?: string, platform?: 'win32'|'posix', isOutsideWorkspace?: (p:string)=>boolean }} opts
 *   home     —— DSH home，仅供 expandTilde 展开 `~` 用；
 *   userHome —— **用户家目录**（`~` 的真实落点），`home` 档的判据用它；缺省时回落 home；
 *   platform —— 决定查哪一套系统目录名单、以及 `/x` 是不是 cmd 开关（**方言不能代替它**）；
 *   isOutsideWorkspace —— 宿主注入的「工作区外」判据（口径唯一，本模块不自己算）。
 * @returns {{ level: 'drive-root'|'system'|'home'|'outside'|'inside', path: string }|null}
 *   null = 该目标不是路径形态（如 `*`、变量），无从判断 —— 此时**不猜**，返回 null。
 *   level 含义：drive-root（整盘）> system（系统目录）> home（家目录）> outside（工作区外）
 *   > inside（工作区内，无警告）。
 */
export function blastRadiusOf(raw, opts) {
  const o = opts || {}
  const t = String(raw == null ? '' : raw).trim()
  if (!t) return null
  // 变量 / 命令替换 / 未展开的 glob 顶层：读不出具体位置，不猜（返回 null 而不是硬套一档）。
  // 注意 glob 要**先归约再判**：`B:\*` 的归约结果是盘根 B:，正是最危险的那一档，
  // 若因为「含通配符所以不判」跳过它，恰好漏掉最该警告的形态。
  //
  // ── 但 `$` 短路**不得吞掉系统目录名单里的项** ─────────────────────────────────
  // 名单里明确收了 `$Recycle.Bin`（WIN_SYSTEM_ROOT_RE / WIN_SYSTEM_BARE_RE 的
  // `\$recycle\.bin`），而它在 cmd/PowerShell 里是**字面目录名**、不是变量 ——
  // 短路写在系统目录判定之前，那个名单条目就永远判不出来（实测修复前
  // `blastRadiusOf('C:/$Recycle.Bin')`、`blastRadiusOfSegment(['rm','-rf','C:/$Recycle.Bin'])`
  // 全为 null，删回收站零警告）。故先给系统目录一次机会，再走变量短路。
  //
  // 只对「整串就是系统目录形态」放行（与 isSystemDir 同源），故 `$env:TEMP`、`${x}`、
  // `` `pwd` `` 这些真变量照旧返回 null —— 它们的形态不可能命中系统目录名单。
  //
  // **判据必须直接问 isSystemDir，不能在这里手抄一份平台分派**：这里曾写着
  //   `o.platform === 'posix' ? POSIX_SYSTEM_ROOT_RE.test(...) : (WIN_ROOT || WIN_BARE)`
  // 与 isSystemDir 已经不是同一个判据，两个方向都漏：
  //   · 非 posix 分支漏掉 win32 下还会查的 `USER_ROOT_RE` —— 实测
  //     `blastRadiusOf('C:/Users/$env:USERNAME')` = null，而 `blastRadiusOf('C:/Users/me')`
  //     = system；`rm -rf C:/Users/$env:USERNAME`（pwsh 里正是「删自己的用户配置目录」）
  //     零警告，而同义的字面写法有警告。
  //   · 漏掉「平台未知时查 POSIX 表」这条 fail-safe —— 实测平台未知时
  //     `blastRadiusOf('/etc/x')` = system 而 `blastRadiusOf('/etc/$x')` = null。
  // 这与本文件 1477-1489 行「预筛不得自带一份名单…判据改为直接问判档表：复用 isSystemDir」
  // 是同一种漂移，只是当时漏改了这一处。isSystemDir 内部已处理 bare 与前缀剥离，
  // 故这里直接传 dollarFree 即可。
  const dollarFree = t.replace(/\\/g, '/')
  if (/[$`]/.test(t)) {
    if (!isSystemDir(dollarFree, o.platform)) return null
  }
  // `~` 展开必须用**用户家目录**（`userHome`）：`rm -rf ~` 删的是 `C:/Users/me`，
  // 不是 DSH home `C:/Users/me/.dsh`。旧实现直接用 `o.home`，而宿主传的是 DSH home
  // （`homeFromEnv()` 返回 `<家目录>/.dsh`），于是警告条把删除目标显示成
  // `C:/Users/me/.dsh`、`~/Documents` 显示成不存在的 `C:/Users/me/.dsh/Documents` ——
  // 审批人看到的是一个与实际删除目标不符的路径。未提供 userHome 时回落 home（兼容）。
  const expanded = expandTilde(t, o.userHome || o.home)
  if (expanded === null) return { level: 'outside', path: t }   // `~user/...` 必然是他人 home
  const g = globRootOf(expanded)
  // 统一成 `/` 分隔并去掉尾部分隔符（保留盘根形态 `c:`）。
  //
  // 尾部剥离**必须用线性 while**，不能写 `.replace(/\/+$/, '')`：V8 对该正则在
  // 「一段连续斜杠 + 非斜杠结尾」的输入上呈平方增长（`\/+$` 在每个起点回退后重新扫描
  // 整段连续斜杠）。实测单次 replace：n=5000 → 5.6 ms、10000 → 21.6 ms、20000 → 87.3 ms、
  // 40000 → 350.9 ms（倍率≈4.0，标准平方），而本函数在破坏性段的**每个词元**上都会被调用，
  // 词元内容由 AI 生成、长度无上界 —— 端到端 `rm -rf <40000 个斜杠>x`（仅 39 KB）
  // 单次判定 354 ms，同规模在本次改动前约 5 ms。这是判定热路径（tools/pre-execute），
  // 挂起即该次调用不返回。while 版本实测等价且 n=80000 时 0.005 ms。
  let p = String(g).replace(/\\/g, '/')
  let end = p.length
  while (end > 0 && p.charCodeAt(end - 1) === 47) end -= 1
  if (end !== p.length) p = p.slice(0, end)
  if (p === '') p = '/'   // `//`、`\` 归约后为空 → POSIX 根
  // ① 盘根：`B:` / `B:/` / `/`。这是最严重的一档，必须先判。
  //    注意判据是「归一后只剩盘符或为空」——`B:/EZUI` 不是盘根，但 `B:` 是。
  if (/^[a-z]:$/i.test(p)) return { level: 'drive-root', path: p }
  if (p === '/') return { level: 'drive-root', path: p }
  // ② 家目录本身（`~` 或它的绝对展开形态）—— 删家目录等于删用户所有配置与文档。
  //    **必须排在系统目录之前**：USER_ROOT_RE 里有 `users`，而 `C:/Users/user`（我自己的
  //    家目录）同时匹配 `users` 那一条，先判系统目录会把家目录误标成「系统目录」——
  //    实测复现（want=home got=system）。更具体的判据必须先跑，这与 glob 归约的取向一致。
  //
  //    home 的语义是**用户家目录**（`~` 展开的落点），不是 DSH home（`<家目录>/.dsh`）。
  //    调用方传错会让这一档整个失效并显示错误路径：实测传 DSH home 时 `rm -rf ~`
  //    （真删 `C:/Users/me`）显示 `C:/Users/me/.dsh`，而 `rm -rf C:/Users/me`（真删家目录）
  //    落到 system 档。`o.userHome` 优先，未提供时才回落 `o.home`（兼容旧调用方）。
  const homeAbs = String(o.userHome || o.home || '').replace(/\\/g, '/').replace(/\/+$/, '')
  if (homeAbs && p.toLowerCase() === homeAbs.toLowerCase()) return { level: 'home', path: p }
  // ③ 系统目录 —— **按操作系统查对应的名单**（见 isSystemDir 的注释：
  //    混装两套系统的名字会在两个方向上误报）。
  if (isSystemDir(p, o.platform)) return { level: 'system', path: p }
  // ④ 工作区外（复用宿主的 isOutsideWorkspace，口径唯一）
  try {
    if (o.isOutsideWorkspace && o.isOutsideWorkspace(g)) return { level: 'outside', path: p }
  } catch (e) {}
  return { level: 'inside', path: p }
}

/**
 * 一段命令里所有「删除/销毁类」目标的爆炸半径汇总。
 *
 * 只在**该段命中破坏性名单**时才调用（调用方保证）：`echo B:\` 不是删除，不该警告。
 * 目标来源是该段词元里所有像路径的实参，与 collectWritePaths 的取向一致：
 * 宁可多提几个候选去判档 —— 多判一个只会多显示一条警告，方向 fail-safe。
 *
 * **必须跳过命令名本身**（`w[0]`，以及 wrapper 之后的有效命令名）：`rm` 这个字符串
 * 会被 blastRadiusOf 当成一个相对路径，而 `isOutsideWorkspace('rm')` 对相对路径通常
 * 返回 true（它不在工作区的绝对前缀下）—— 于是 `rm -rf ./build` 会被误报成
 * 「工作区外」（实测：want=null got=outside）。命令名不是目标，这是本函数唯一容易
 * 搞错的地方，故单独用 unwrapWords 求出有效命令名并跳过。
 *
 * @returns {{ level: string, path: string }|null} 最严重的那一档（无路径目标时 null）
 */
export function blastRadiusOfSegment(words, opts) {
  const w = Array.isArray(words) ? words : []
  // 有效命令名（剥掉 wrapper 与前导赋值）：它自己不是删除目标。
  // 取整个词元集合里出现过的命令名，而不是只取 w[0] —— `env FOO=1 rm -rf /` 的有效
  // 命令名是 `rm`（第 3 个词元），只跳 w[0] 仍会把 `rm` 当成路径。
  //
  // skip 用 **Object.create(null)**，不能用 `{}`：后者继承 Object.prototype，于是
  // `skip['constructor']`、`skip['toString']`、`skip['valueOf']`、`skip['__proto__']`
  // 全部真值 —— 命令 `rm -rf constructor` 的目标会被当成「命令名」跳过，判档静默丢失。
  const skip = Object.create(null)
  // 命令头在 w 里的**结束下标**（不含）：这些位置一律不是目标。
  //
  // 为什么必须按**位置**跳而不是只按**词元值**跳：提权前缀（`sudo`/`doas`/…）不在 WRAPPERS 里，
  // 于是 `sudo /bin/rm -rf /tmp/x` 的 un.words[0] 是 `sudo`，真正的命令名 `/bin/rm`
  // 不在 skip 里 —— 它会被当成一个路径目标判档，实测得到
  // `{level:'system', path:'/bin/rm'}`：弹窗写「目标是系统目录（/bin/rm）」，
  // 而真目标 `/tmp/x` 被遮蔽（Windows 侧 `C:/Windows/System32/rm.exe` 同样误报）。
  // commandHeadEnd 已覆盖「提权前缀链 + wrapper 链 + 最终命令名」全部位置，故用它。
  let headEnd = 0
  try { headEnd = commandHeadEnd(w) } catch (e) { headEnd = 0 }
  // 有效命令名（剥掉 wrapper 与前导赋值）也登记进 skip：`env FOO=1 rm -rf /` 的有效
  // 命令名是 `rm`（第 3 个词元），只跳 w[0] 仍会把 `rm` 当成路径。
  //
  // **不再另算「命令名下标」**：这里曾经有一个 cmdNameEnd（= w.length - uw.length），
  // 配合循环里的 `if (i < cmdNameEnd) continue` 用来区分「命令名之前的 NAME=value 前缀」
  // 与「之后的 NAME=value 实参」（`dd of=/dev/sda`）。但 `headEnd > 0` 时它被赋成
  // `headEnd - 1`，而循环开头的 `if (i < headEnd) continue` 已经先吃掉了全部 i < headEnd
  // —— 那个分支恒为假，是死代码（插桩实测：62 次循环进入、命中 0 次；追踪 headEnd 与
  // cmdNameEnd 的取值，`headEnd === 0` 时 cmdNameEnd 恒为 0，故不存在「headEnd 为 0
  // 但 cmdNameEnd > 0」的可达情形）。NAME=value 的处置由下面循环里那一处判据负责，
  // 位置判据统一走 headEnd。
  try {
    const un = unwrapWords(w)
    if (un && Array.isArray(un.words) && un.words.length) skip[String(un.words[0])] = 1
  } catch (e) {}
  if (w.length) skip[String(w[0])] = 1
  let worst = null
  for (let i = 0; i < w.length; i += 1) {
    const token = String(w[i])
    // 命令头（提权前缀 / wrapper / 命令名自身）都不是删除目标 —— 按位置跳，
    // 不依赖词元值相等（见 headEnd 的注释）。
    if (i < headEnd) continue
    if (skip[token]) continue
    // 跳过选项开关（`/s` `/q` `-Recurse` `-Force` …）：它们不是目标。
    //
    // 判据是**平台**（opts.platform），不是方言 —— 两者不是一回事：
    //   · `-` 开头 —— 两门方言、两个平台都是开关（POSIX `-rf`、PowerShell `-Recurse`），无条件跳过。
    //   · `/` + 字母 —— **只在 Windows 上**才是 cmd 风格开关（`/s` `/q` `/grant` `/pid`）。
    //     POSIX 上 `/` 是路径分隔符，`/etc`、`/usr/bin` 都是目标。
    //
    // 这里曾经按**方言**判（pwsh 就跳 `/xxx`），根因是把方言当成了平台的替身：
    // Linux/macOS 上跑 PowerShell Core（pwsh 工具）时方言是 pwsh、路径却是 POSIX 的，
    // 于是 `rm -rf /etc`、`/usr/bin`、`/home/u` 全部被当开关跳过、段级 blast 静默 ——
    // 而同一台机器用 bash 工具就正确判 system。判据现在只看 `opts.platform`，
    // 平台未知时 isCmdStyleSwitch 返回 false（**不跳**，方向 fail-safe：把路径当开关会漏警告）。
    if (token.charCodeAt(0) === 45) continue                       // `-x` / `--long`：无条件开关
    if (isCmdStyleSwitch(token, opts)) continue                    // Windows 的 `/s` `/grant`；POSIX 上恒 false
    if (/^[<>]/.test(token)) continue
    // ── 引号包裹的**整条命令** ────────────────────────────────────────────────────
    // `su -c "rm -rf /"`、`runas /user:X "Remove-Item -Recurse -Force C:/Windows"`：
    // 词法器把引号内容并成**一个**词元，而它本身是一条完整的命令行。
    //
    // 直接把它当路径判档会得出错误结论。实测（真实 isOutside 语义）：
    //   `su -c "rm -rf /"`、`su -c "rm -rf /etc"`、`su --command "rm -rf /"`、
    //   `sudo su -c "rm -rf /"` 全部 `destructive=true` 而 blast=**null**（弹窗零警告）；
    //   而**未加引号**的 `su -c rm -rf /` 正确给 `drive-root|/`。加引号才是日常写法，
    //   于是最该警告的形态恰好静默。Windows 侧 `runas … "Remove-Item …"` 同理。
    //
    // 判据刻意收得很紧，**两条同时满足**才递归：
    //   ① 按空白切分后首词是「一条命令的开头」—— 破坏性命令名（`rm` / `Remove-Item` / `rd`…）
    //      或命令解释器（`cmd` / `powershell` / `sh`…，即 `cmd /c rd /s /q C:\` 这种，
    //      判据复用 NESTED_SHELLS —— 那份表就是「哪些名字是 shell」的既有单点）；
    //   ② 递归判档得出了结论（否则回退到原样判档，不丢警告）。
    // 收紧的理由：无条件递归会**制造新的漏报** —— `rm -rf "C:/Program Files/app"` 的词元
    // 也含空格，切分后成了 `C:/Program` + `Files/app`，两个都不是系统目录，system 警告
    // 会被抹掉；而原样判档本来是对的（WIN_SYSTEM_ROOT_RE 认 `program files`）。
    // 条件 ① 恰好排除这种情形：首词 `C:/Program` 既不是破坏性命令名也不是解释器。
    // 递归深度有界：split 出的子词元不含空格，故最多一层。
    if (token.indexOf(' ') !== -1) {
      const sub = token.split(/\s+/).filter(Boolean)
      const head = sub.length > 1 ? commandNameOf(sub[0]) : ''
      if (head && (isDestructiveLabel(head) || NESTED_SHELLS[head] === 1)) {
        // 递归结果**优先**（它才是「这条被引号包起来的命令行」的真实目标）；
        // 递归读不出结论时**不 continue**，落回下面的原样判档 —— 保证任何情况下都不比改动前少警告。
        const rs = blastRadiusOfSegment(sub, opts)
        if (rs) {
          const ssev = BLAST_ORDER[rs.level]
          if (ssev !== undefined) {
            if (!worst || ssev < BLAST_ORDER[worst.level]) worst = rs
            continue
          }
        }
      }
    }
    // `NAME=value` 只在**命令名之前**是「env 赋值前缀」（`FOO=1 rm -rf /` 里的 `FOO=1`），
    // 在命令名之后它就是普通实参 —— 而删除类命令恰恰用这种形态表达目标：
    // `dd of=/dev/sda`、`dd if=/dev/zero of=/dev/sda`（`dd` 本身在 DESTRUCTIVE_LABELS 里）。
    // 无条件跳过会把承载破坏性目标的操作数整个丢掉：实测 `['dd','of=/dev/sda']` 判 null，
    // 而对照组 `['shred','/dev/sda']` 正确判 system。
    //
    // 「命令名之前」这一条件**已由循环开头的 `i < headEnd` 满足**：赋值前缀（含前导的
    // `FOO=1`）都在命令头范围内，走不到这里；能走到这里的 NAME=value 必然在命令名之后，
    // 故取 `=` 右侧的值继续判档（左侧是参数名，不是路径）。
    // 这里曾另有一个 `if (i < cmdNameEnd) continue`，但它是死分支（见 headEnd 处的说明）。
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
      const rhs = token.slice(token.indexOf('=') + 1)
      if (!rhs) continue
      if (!mayNeedBlastCheck(rhs, opts && opts.platform)) continue
      const rv = blastRadiusOf(rhs, opts)
      if (!rv) continue
      const rsev = BLAST_ORDER[rv.level]
      if (rsev === undefined) continue
      if (!worst || rsev < BLAST_ORDER[worst.level]) worst = rv
      continue
    }
    // 廉价预筛：不含分隔符/盘符/家目录/变量/通配符、也不以 `.` 开头、且不是 BARE 系统目录名
    // 的**纯词元**，在工作区内判档恒为 inside。跳过它们省掉每词元一次的 expandTilde +
    // globRootOf + 正则 + 宿主回调 —— 实测破坏性段带 20000 个相对路径参数时，判定从 38.2 ms
    // 涨到 73.8 ms，而这些词元全部判为 inside、最终 worst 为 null、不产生任何警告：
    // 付出 100% 判档代价换来零信息。含上述字符的词元照常走完整判档（不漏报）。
    //
    // 判据走 mayNeedBlastCheck：预筛是纯优化，**不得改变结论** —— 它必须把 BARE 系统目录名
    // （`Windows`/`System32`…）也放行去判档，否则会与紧邻它定义的 WIN_SYSTEM_BARE_RE 矛盾。
    if (!mayNeedBlastCheck(token, opts && opts.platform)) continue
    const r = blastRadiusOf(token, opts)
    if (!r) continue
    // 只保留「有警告意义」的档位：inside 不需要警告，但它可以作为兜底（全 inside → null）。
    // 顺序取自模块级的 BLAST_ORDER（唯一一份）—— 曾在函数内手抄一份、index.js 再抄一份，
    // 三份漂移时消费侧是「静默跳过未知档」，只会让警告整体失效而不报错。
    const sev = BLAST_ORDER[r.level]
    if (sev === undefined) continue
    if (!worst || sev < BLAST_ORDER[worst.level]) worst = r
  }
  if (!worst || worst.level === 'inside') return null
  return worst
}

/**
 * 例外模式（`match`）的爆炸半径：宽泛顶层通配返回 `broad` 档，其余交给 blastRadiusOfSegment。
 *
 * 为什么需要 `broad` 这一档：`rm -rf *`、`rm *`、`rmdir *`、`del *`、`Remove-Item *`
 * 这类例外的目标经 globRootOf 归约为 `.`（相对当前目录）→ isOutsideWorkspace 判 inside
 * → 返回 null → **完全不标注**。但它们实测能放行 `rm -rf /`、`rm -rf /etc`、
 * `rm -rf C:/Windows`（matchCommand('rm -rf *', …) 三者均为 true），
 * 即一条「看起来只是放行某类操作」的例外实际覆盖到盘根。面板的例外列表按设计是
 * 「唯一能让人**事后**发现『我什么时候放行了删盘根』的地方」，此处静默等于把审计点关掉。
 *
 * 判据：match 去掉命令前缀后若**只剩通配符**（`*`/`?`/空白），即该例外不限定任何目标。
 *
 * @param {string[]} words 段词元
 * @param {{ home?: string, userHome?: string, platform?: 'win32'|'posix', isOutsideWorkspace?: (p:string)=>boolean }} opts
 * @returns {{ level: string, path: string }|null}
 */
export function blastRadiusOfCommandPattern(words, opts) {
  const w = Array.isArray(words) ? words : []
  const un = (() => { try { return unwrapWords(w) } catch (e) { return null } })()
  const uw = (un && Array.isArray(un.words) && un.words.length) ? un.words : w
  // 跳过**命令名本身**，而不是只跳一个词元：命令名可能是多词的（`git status`、
  // `reg delete` —— 路由器命令的 label 细化到这一粒度）。只 slice(1) 会把 `status`
  // 当成目标实参，于是 `git status *` 被判成「目标被限定」而走常规判档，
  // 结果随宿主 isOutsideWorkspace 对 `.` 的口径漂移（实测 inside-host 下 null、
  // outside-host 下 outside，同一份配置两种结论）。
  //
  // ── 提权前缀：命令头要一路吃到**真正吃目标的那个命令名** ──────────────────────
  // `sudo`/`doas`/`pkexec`/`runas`/`gsudo` 在 DESTRUCTIVE_LABELS 里、却**不在 WRAPPERS 里**
  // （它们改变权限，不是透明包装），于是 `segmentLabel(['sudo','rm','-rf','*'])` 返回 `sudo`
  // —— 词数是 1，而真正吃目标的 `rm` 留在 rest 里被当成**目标实参**：
  // `rest.some(非通配)` 为真 → 不走 broad → 转交 blastRadiusOfSegment → 那里按词元值
  // 跳过所有命令名 → 最终 null。实测 `sudo rm -rf *` 零标注，而
  // `matchCommand('sudo rm -rf *', 'sudo rm -rf /')` 为 true —— 正是 broad 档要堵的
  // 「一条例外静默放行删盘根」，只是加了个提权前缀。`doas`/`pkexec` 同样。
  //
  // 判据统一走 commandHeadEnd（与 blastRadiusOfSegment 的 skip 同源，见该函数注释）。
  // 它同时覆盖了这里曾经漏掉的两种形态：
  //   · 提权命令**带选项** —— `sudo -u root rm -rf *`：旧判据「遇到 `-` 就 break」把命令头
  //     停在 `sudo` 上，`rm` 被当成目标实参 → 不走 broad → 零标注（实测）；
  //   · 提权命令**后接 wrapper** —— `sudo env rm -rf *` / `sudo nohup rm -rf *`：同上。
  // 两者 `matchCommand` 均实测为 true，即「一条能放行删盘根的例外」在面板上零标注。
  const label = (() => { try { return segmentLabel(w) } catch (e) { return '' } })()
  const headEnd = (() => { try { return commandHeadEnd(w) } catch (e) { return 0 } })()
  // ── 两个下标空间：`headEnd` 是 **w** 的，`rest` 却要切 **uw** ──────────────────
  // commandHeadEnd 返回的是**原始词元数组 w** 的下标，而下面的 rest 从 uw 切 ——
  // 而 uw 是 unwrapWords(w).words，**已经剥掉了 wrapper 与前导 NAME=value**，比 w 短。
  // 直接 `uw.slice(headEnd)` 会多吃掉 (w.length - uw.length) 个真实实参，于是「目标是否
  // 被限定」判错，两个方向都错（实测 win32，13 个候选形态中 9 个与段级结论不一致）：
  //   · 少警告：`env FOO=1 rm -rf C:/Windows`、`timeout 5 rm -rf C:/Windows`、
  //     `nice -n 5 rm -rf C:/Windows`、`stdbuf -o0 …`、`xargs -0 …`、`env -i …` 的 rest
  //     被切空 → 落到 broad，而真实档位是 system；`timeout 5 rm -rf C:/`、`nice -5 rm -rf C:/`
  //     真实是 drive-root 也被标成 broad。broad 的文案是「这条规则**不限**删除目标」，
  //     与事实相反；且 BLAST_ORDER 里 broad=1 比 system=2 更严重，会把真实目标整个盖掉。
  //   · 多警告：`env FOO=1 rm -rf ./build`（工作区内，真实档位 null）被判 broad 假警告。
  // 换算：w 比 uw 多出的前缀数 = w.length - uw.length，减掉它才是 uw 空间的下标。
  const prefixLen = Math.max(0, w.length - uw.length)
  // 只在确实吃到了命令名时才用 commandHeadEnd 的结果：`0` 表示首词元既不是前缀也不是
  // 破坏性命令，此时保持 label 词数（路由器命令 `git status` 走这条）。
  const headLen = Math.max(0,
    (headEnd > 0 ? headEnd : (label ? label.split(/\s+/).length : 1)) - prefixLen)
  // 判断「这条例外是否限定了目标」时**必须把开关排除掉**，判据与 blastRadiusOfSegment
  // **同一份**（isCmdStyleSwitch / `-` 前缀）：
  //   · `-` 开头 —— 无条件开关。
  //   · `/` + 字母 —— 只在 Windows 上是 cmd 风格开关。**这一条不能按方言门控**：
  //     `rmdir /s /q *` 是 cmd 风格例外，其 `/s` `/q` 在 Windows 上就是开关；若按方言滤，
  //     POSIX 侧会把 `/s` `/q` 当成目标实参 → 「全是通配」判断失败 → 这条**能放行
  //     `rmdir /s /q B:\`（删盘根）** 的例外在面板上零标注。
  //   · 其余 `/` 开头（`/etc`、`/`、`/*`）—— POSIX 上是目标，交给 blastRadiusOfSegment 判档。
  //
  // 两个判断曾经耦合在同一个数组上，于是「滤开关」与「判目标是否受限」互相干扰：
  // 按方言滤 → 限定目标的例外（`rmdir /s /q /`）被滤空而误标成 broad；
  // 不滤 → 带开关的宽泛例外（`rmdir /s /q *`）判不出 broad 而静默。
  // 拆开后两者各自正确：开关一律不算目标，`/` 的路径歧义才交给平台。
  const rest = uw.slice(headLen).filter((t) => String(t).charCodeAt(0) !== 45 && !isCmdStyleSwitch(String(t), opts))
  // 还有非通配的实参 → 目标被限定了，按常规逐词元判档
  if (rest.some((t) => !/^[*?\s]+$/.test(String(t)))) return blastRadiusOfSegment(w, opts)
  // 剩下的实参全是通配（或一个都没有）→ 目标不被限定，归宽泛档。
  //
  // ── 但「没有实参」不等于「不限定目标」────────────────────────────────────────
  // `nohup ./server.sh`、`env FOO=1 ls` 的 rest 都为空，可它们的**字面前缀**是
  // `nohup ./server.sh ` / `env FOO=1 ls `，匹配不到任何删除命令
  // （实测 `matchCommand('nohup ./server.sh', 'nohup rm -rf /')` = false）。
  // 判 broad 就是**假警告**：broad 的文案说「这条规则不限删除目标 —— 它同样放行
  // 删除盘根与系统目录」，而这些例外一个删除都放行不了。假警告会让真警告被忽略（狼来了）。
  // 根因是这里的比较基准：`rest` 按 unwrapWords **剥掉 wrapper 之后**的词元切分，
  // 而 matchCommand 匹配的是**原始文本**（wrapper 还在里面），两者不是同一个东西。
  //
  // 故还要求二者之一，才判 broad：
  //   · 模式里**确实有通配符**（目标位就是通配，如 `env *`、`find *`、`rmdir /s /q *`）；
  //   · 或命令头本身就是删除类（`rm -rf` 没有目标实参，却按前缀匹配到 `rm -rf /` ——
  //     实测 `matchCommand('rm -rf', 'rm -rf /')` 为 true，这一档必须留着）；
  //   · 或命令头是**载荷族**（`find` / `env` / `xargs` …）且**没有任何实参** ——
  //     此时它就是一条裸前缀，后面接什么由真实命令决定。
  // 第三条是必须的：`find`（裸，无实参）实测 `matchCommand('find','find / -delete')` = true，
  // 而它**正是候选生成器写下的值**（index.js 的 useExactText 分支对载荷族用整段原文，
  // 而 `find` 段的 seg.text 就是 `find`）。只认前两条时该例外标注 null：用户对「找一下文件」
  // 点一次「允许并记住」，`find / -delete` 在 destructive=deny 下由 deny 变 allow，
  // 而面板例外列表零标注 —— 那正是本功能声称要守住的「唯一能事后发现我什么时候放行了
  // 删盘根的地方」。`env` / `xargs` 同理（实测分别放行 `env FOO=1 rm -rf /`、`xargs rm -rf /`）。
  //
  // 只对「裸」（无实参）成立：`find . -name x` 有实参，目标被限定，走常规判档。
  // 判据用 isPayloadCarrierLabel(headName)（与 index.js 候选侧同一份表），
  // 不另抄一份名单。
  const hasWildcard = /[*?]/.test(w.join(' '))
  const headName = (() => { try { return String(commandNameOf(uw[0]) || '').toLowerCase() } catch (e) { return '' } })()
  if (!hasWildcard && !isDestructiveLabel(headName)) {
    // rest 为空 = 命令名之后**没有任何非开关实参**（`find`、`env`、`find -delete`）→ 不限目标。
    //
    // rest 是**滤掉开关之后**的数组，故 `find -delete`、`xargs -delete`、`env of=/dev/sda`
    // 的 rest 也是空的 —— 这是**正确**的，不是误判：这些模式都不限定目标，实测分别放行
    // `find -delete /`、`xargs -delete rm -rf /`、`env of=/dev/sda rm -rf /`
    // （matchCommand 是词边界前缀匹配，追加实参即命中）。
    //
    // 曾经想改成「按未滤开关的原始实参判空」来消除所谓的假警告，但那是**误判** ——
    // 当时用的危险命令集不含「模式 + 追加实参」的形态（如 `xargs -delete rm -rf /`），
    // 于是把真警告当成了假警告；改完 `find -delete` 反而由 broad 退化成 null（漏报）。
    // 判据保持「rest 为空」。
    if (isPayloadCarrierLabel(headName) && !rest.length) {
      const gb = globRootOf('*')
      return { level: 'broad', path: String(gb) }
    }
    return blastRadiusOfSegment(w, opts)
  }
  // ── broad 必须再加一道「命令族是否危险」的过滤 ──────────────────────────────
  // 本函数在 index.js 的 exceptionBlast 里被调用，而那条路径的入口过滤是
  // canCarryDestructivePayload —— 它对「提权/wrapper 前缀 + 普通命令」返回 **true**
  // （前缀名 `sudo`/`env`/`nohup`… 本身就在 PAYLOAD_CARRIERS 里），于是这些模式
  // 会走到这里被判 broad：
  //     sudo ls *   doas cat *   pkexec echo *   env ls *   nohup ls *
  //     timeout 5 ls *   xargs ls *   stdbuf -o0 ls *   sudo -u root ls *
  // 而 broad 的文案是「这条规则**不限**删除目标 —— 它同样放行删除盘根与系统目录」。
  // 实测这类形态**放行不了任何一条**删除命令（对 240 条危险命令的命中数为 0）：
  // `matchCommand('sudo ls *', 'sudo rm -rf /')` = false，它只匹配 `sudo ls ...`。
  // 这正是本文件反复警告的「假警告会让真警告被忽略（狼来了）」。
  //
  // 无前缀的形态（`ls *`、`git status *`）到不了这里 —— canCarryDestructivePayload
  // 对它们返回 false（`ls`/`git` 既不在破坏性名单也不在 PAYLOAD_CARRIERS 里）。
  // 所以漏的恰好是「前缀 + 普通命令」这一类。
  //
  // 判据用**真实命令名**，不能用 `headName`（= `uw[0]`）：前缀形态下它是前缀名本身
  // —— 实测 `sudo ls *` 与 `sudo rm -rf *` 的 headName 都是 `sudo`（在破坏性名单里），
  // 于是前者被误判成危险。真实命令名 = **命令头最后一个词元** `uw[headLen - 1]`
  // （headLen 是命令头词数，已含「前缀链 + 命令名」全部位置）：
  //   `sudo ls *` → `ls`（普通）  `sudo rm -rf *` → `rm`（危险）  `find *` → `find`（载荷族）
  // 路由器命令（`git status *`）取到的是子命令 `status`，同样不是危险族 —— 结论一致。
  //
  // 两条都不是时交回 blastRadiusOfSegment：普通命令一律得 null（不标注）。
  // 危险族三类，缺一不可（每一类都是实测出来的）：
  //   · 破坏性命令（`rm` / `rmdir` / `del` / `format` …）—— `rm -rf *` 能放行 `rm -rf /`；
  //   · 载荷族（`find` / `env` / `xargs` …）—— `find *` 能放行 `find / -delete`；
  //   · **嵌套解释器 / shell**（`sh` / `bash` / `cmd` / `pwsh` / `eval` …）——
  //     `sh *` 能放行 `sh -c "rm -rf /"`。这一类**最初漏了**，实测造成 32 个真漏报
  //     （`sh *`、`bash *`、`sudo sh *`、`nohup bash *` … 由 broad 退化成 null）。
  //
  // 判据：在命令头范围内找**真正吃目标的命令名** —— 即命令头里**最后一个
  // 「既不是 wrapper、也不是提权前缀」**的词元。不能简单扫全部词元，因为
  // `sudo` / `doas` / `su` / `pkexec` / `runas` / `gsudo` **本身就在
  // DESTRUCTIVE_LABELS 里**（它们确实是危险动作），扫全表会把 `sudo ls *` 里的
  // `sudo` 当成危险族 → 假警告依旧（实测）。
  //
  // 也不能只看 `uw[headLen - 1]`：unwrapWords 会把 wrapper 剥掉，`xargs *` 的 `uw`
  // 只剩 `["*"]`，那个位置是 `*`（认不出），而 `xargs` 本身是载荷族 ——
  // 实测只看单个位置会漏掉 `xargs *` / `env *` / `nohup xargs *` 等 32 个真警告。
  //
  // 故：扫命令头，**跳过纯前缀名**，取最后一个非前缀词元。若全部都是前缀
  // （`env *` / `xargs *` / `sudo *`），则**回退到这些前缀名本身**判 —— 因为
  // 「裸前缀 + 通配」正是 `xargs *`（能放行 `xargs rm -rf /`）这类形态。
  //
  // 危险族三类，缺一不可（每一类都是实测出来的）：
  //   · 破坏性命令（`rm` / `rmdir` / `del` / `format` …）—— `rm -rf *` 能放行 `rm -rf /`；
  //   · 载荷族（`find` / `env` / `xargs` …）—— `find *` 能放行 `find / -delete`；
  //   · 嵌套 shell / 解释器（`sh` / `bash` / `cmd` / `pwsh` / `eval` …）——
  //     `sh *` 能放行 `sh -c "rm -rf /"`（这一类最初漏了，实测 32 个真漏报）。
  // 后两类的名单复用既有单点（isPayloadCarrierLabel / NESTED_SHELLS / NESTED_EVAL），
  // 不另抄一份。
  const headIsDangerous = (() => {
    const isDanger = (n) => isDestructiveLabel(n) || isPayloadCarrierLabel(n)
      || NESTED_SHELLS[n] === 1 || NESTED_EVAL[n] === 1
    // `last` 收敛到「命令头里最后一个**像命令名**的词元」：
    //   `sudo rm *`  → `rm`（判危险 → broad）
    //   `sudo ls *`  → `ls`（判普通 → 交回判档 → null）
    //   `env *`      → `env`（`*` 不算命令名，故 last 保持前缀名 → 载荷族 → broad）
    //   `xargs *`    → `xargs`（同上，这一族是**真警告**：`xargs *` 放行 `xargs rm -rf /`）
    //
    // 扫描范围用 `Math.max(headEnd, headLen)`：
    //   · `headEnd > 0`（有前缀链）时两者一致，取到命令名；
    //   · `headEnd === 0`（首词元既非前缀也非破坏性命令）时 headEnd 不表示命令头，
    //     必须回退到 `headLen`（label 词数）—— 否则 span 只含第一个词元。
    //     实测该回退是必需的：`/usr/bin/rm *` 的 headEnd=0、headLen=1，只取 `w[0]`
    //     本应够用，但 `isCmdStyleSwitch('/usr/bin/rm', win32)` 为 **true**
    //     （`/` + 字母，且 basename 不在系统目录名单里），于是它被当开关跳过 →
    //     last 为空 → 判 null。而 `/usr/bin/rm *` 实测能放行 `/usr/bin/rm -rf /`
    //     （18 个真漏报：`/usr/bin/rm *`、`/usr/bin/find *`、`/usr/bin/sh *` …）。
    //     故**路径形态的命令名不能被 isCmdStyleSwitch 吃掉**：它含分隔符，
    //     是路径而不是 `/s` 那样的 cmd 开关。
    const span = w.slice(0, Math.max(1, headEnd, headLen))
    let last = ''
    for (const t of span) {
      const s = String(t)
      if (!s) continue
      // 通配 / 开关 / 重定向 / NAME=value 都不是命令名
      if (/^[*?\s]+$/.test(s)) continue
      if (s.charCodeAt(0) === 45 || s.charCodeAt(0) === 60 || s.charCodeAt(0) === 62) continue
      // 纯数字时长参数也不是命令名：`timeout 5 *` 的 `5` 若被当成命令名，
      // `last` 就停在 `5` 上，而 `timeout` 是载荷族（`timeout 5 *` 实测能放行
      // `timeout 5 rm -rf /`）—— 实测那是 1 个真漏报。
      if (/^[0-9]+(?:\.[0-9]+)?[smhd]?$/.test(s)) continue
      // 路径形态（含分隔符）是命令名的一种写法，不能按 cmd 开关跳过
      const isPathForm = s.indexOf('/') !== -1 || s.indexOf('\\') !== -1
      if (!isPathForm && isCmdStyleSwitch(s, opts)) continue
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(s)) continue
      const n = String(commandNameOf(s) || '').toLowerCase()
      if (n) last = n
    }
    return isDanger(last)
  })()
  if (!headIsDangerous) return blastRadiusOfSegment(w, opts)
  // `rm -rf /`、`rm -rf /*`、`rm -rf B:\*` 这类**绝对/盘根形态的通配**不在此列：
  // 它们的目标是确定的盘根（最严重的一档），不能因为「只剩通配」被归到 broad 而降级。
  // 它们不会被 isCmdStyleSwitch 滤掉（`/` 与 `/*` 都不是 1–2 字母开关），故上面那行会走常规判档。
  const g = globRootOf('*')
  return { level: 'broad', path: String(g) }
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
        // 无原型：键是 label（来自命令文本），`{}` 会让原型属性名恒判「已见过」而漏合并。
        const seen = Object.create(null)
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

    // 爆炸半径：**只在破坏性段上算**（`echo B:\` 不是删除，警告它就是噪音）。
    // 与 code 分开下发、不参与动作选择 —— 它只回答「这一下有多重」，供弹窗与列表展示。
    //
    // 开关判据（cmd 的 `/s` 是开关、POSIX 的 `/etc` 是路径）只看 `opts.platform`，
    // **不看方言**：方言不等于平台（Linux 上跑 PowerShell Core 时方言是 pwsh、路径是 POSIX 的），
    // 故这里不再传 `shell`（曾经传了但全模块无人读取，是死参数）。
    const blast = destructive ? blastRadiusOfSegment(seg.words, h) : null

    if (action === 'deny') anyDeny = true
    else if (action === 'ask') anyAsk = true
    else if (action === 'inherit') anyInherit = true

    out.push({ op: seg.op, text: seg.text, label, action, source, code, ruleId, reason, note, dynamic: seg.dynamic, blast })
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
