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

// 提权前缀：在 DESTRUCTIVE_LABELS 里、但**不在 WRAPPERS 里**（它们改变权限，不是透明包装）。
// 命令头解析必须能穿过它们，否则「提权 + 真命令」的组合会被当成「提权命令 + 目标实参」。
//
// ── 本表是「哪些命令算提权前缀」的**唯一来源**（计划 §5.3：「复用既有的 PRIV_PREFIXES，
//    不新造表」）────────────────────────────────────────────────────────────────
// `GROUP_MEMBERS.priv` 由它的键**派生**（见下），不再手写第二份。两份手写表的看守强度
// 天然不对称：分组那份被测试 32 的「并集 = DESTRUCTIVE_LABELS」双向一致断言盯着，
// 而第二份此前没有任何断言要求两者相等 —— 于是「新增提权命令时只改了分组表」会静默漂移。
// 漂移方向是 **fail-open**，实测（以 `dzdo` 为例，只改分组表）：
//     sudo kill 1234 → labels ['sudo','kill'] → tiers ['proc','priv'] → proc=deny 时 deny
//     dzdo kill 1234 → labels ['dzdo']        → tiers ['priv']       → 同一配置下 **allow**
// 即 proc 档整个不命中、`kill *`=deny 这类例外也被绕过。
//
// 位置在 GROUP_MEMBERS **之前**是必须的：后者要用 `Object.keys(PRIV_PREFIXES)` 派生 priv 组。
const PRIV_PREFIXES = dict({ sudo: 1, doas: 1, su: 1, pkexec: 1, runas: 1, gsudo: 1 })

// 导出本表供测试断言「分组表由它派生」。**用 `export {}` 列表而不是 `export const`**：
// regressions.mjs 有一条结构断言按 `^const PRIV_PREFIXES = ` 取定义行（要求以 `dict(` 开头），
// 加上 `export ` 前缀会让那条断言找不到定义而红灯。
export { PRIV_PREFIXES }

/**
 * 破坏性名单的**分组** —— 组决定「伤害落在哪」，因而决定该用哪套判据。
 *
 * 分组本身不是新知识：上面 `DESTRUCTIVE_LABELS` 的注释从一开始就分了六组，
 * 但**代码里没有任何一处消费它**，于是下面四条走的是同一条路（同一个布尔值 → 同一个动作）：
 *
 *     rm test.txt          目标在工作区内
 *     sudo ls              无目标
 *     taskkill /im x.exe   无路径目标
 *     rm -rf B:\           目标是一整个盘
 *
 * 后果不是「少一条警告」，而是设置会被关掉：大分类设 allow 后 `rm test.txt` / `sudo ls`
 * 每次弹窗，用户被吵到就把子设置也设成 allow —— `rm -rf B:\` 从此静默放行。
 * 意图（D-6「大分类 allow 时破坏性命令仍按子设置走」）没错，**错的是粒度**：
 * 它假设「破坏性命令」是同质类别，而实际上「删工作区内一个构建目录」与「删盘根」
 * 除了都叫 rm 之外没有任何共同点。
 *
 * 组的第二个作用：`proc` / `power` / `reg` 三组**结构性地判不出爆炸半径** ——
 * 它们的伤害对象是进程 / 电源状态 / 注册表，而半径判据找的是**文件系统路径**，找错了东西。
 * 无论怎么带参数都是 null（`kill 1234` / `kill -9 /tmp/x` / `shutdown /s` 全部 null；
 * 硬塞 `kill -9 C:/Windows` 才有输出，但那是无意义输入）。故这三组走**组档**，
 * 判据是「label 属不属于这一组」，不看目标。
 *
 * 双向一致（并集 = `DESTRUCTIVE_LABELS`、无重复、无遗漏）由测试断言守住：
 * 新增 label 忘了分组时该命令会静默落 `inside` 档 —— 这正是最需要防的漂移，
 * 不能靠人记得，必须让断言红灯。
 */
export const GROUP_MEMBERS = dict({
  // 删除 / 销毁 —— 走半径档
  del: ['rm', 'rmdir', 'del', 'erase', 'rd', 'remove-item', 'ri', 'dd', 'mkfs', 'shred', 'truncate', 'wipefs'],
  // 磁盘 / 分区 —— 走半径档
  disk: ['format', 'diskpart', 'fdisk', 'parted'],
  // 进程 / 电源 —— 走组档（半径判据恒 null）
  proc: ['taskkill', 'kill', 'pkill', 'killall', 'stop-process'],
  power: ['stop-computer', 'shutdown', 'reboot', 'halt', 'poweroff'],
  // 提权 —— **两套都走**（见 RADIUS_GROUPS 的注释）。
  // 成员由 `PRIV_PREFIXES` 的键派生（顺序即该表的声明顺序，稳定）：本组与那张表是
  // 同一语义规则，手写两份必然漂移，而漂移方向 fail-open（见 PRIV_PREFIXES 的注释）。
  priv: Object.keys(PRIV_PREFIXES),
  // 权限 / 属主 —— 走半径档。注意它与 priv 是**两件事**（用户 2026-09-28 澄清）：
  //   提权改的是「当前进程以什么权限运行」（`sudo rm -rf /` 提升的是自己），
  //   权限变更改的是「目标文件的权限位」（`chmod 777 x.sh` 改的是 x.sh）。
  //   故 perm 不归 priv 档 —— 它天然适配半径判据（带系统目标判 system、带区内目标判 null）。
  perm: ['icacls', 'takeown', 'chmod', 'chown', 'chgrp', 'set-executionpolicy'],
  // 注册表 / WMI —— 走组档
  reg: ['reg delete', 'wmic'],
})

/**
 * label → 组 的反向表，由 `GROUP_MEMBERS` **派生**（不是第二份手写清单）。
 *
 * 为什么必须是派生：两张手写的表迟早漂移，而漂移的后果是某个命令落进错的组、
 * 拿错判据、静默落 `inside`。这与 `BLAST_ORDER` 那条纪律同源
 * （`:1614` 注释：曾在三处手抄，漂移时消费侧静默跳过）。
 */
export const GROUP_OF_LABEL = (() => {
  const m = Object.create(null)
  for (const g of Object.keys(GROUP_MEMBERS)) {
    for (const l of GROUP_MEMBERS[g]) m[l] = g
  }
  return m
})()

// 组 → 档 的映射单点（**不在多处 if/else 里重复**，理由同 GROUP_OF_LABEL）。
// 只有「半径判据不适用」的组才需要自己的档；del / disk / perm 三组的差异**恰恰是半径**，
// 给它们各自一个档就等于让用户配六个「删除类」开关才能表达「区内静默、区外拦」——
// 而半径档一个开关就表达了，且跨组一致（删文件与改权限在工作区内同样无害）。
const GROUP_TIER = dict({ proc: 'proc', power: 'power', priv: 'priv', reg: 'reg' })

// 走**半径档**的组。`priv` 两套都走：提权命令的 blast 反映的是**内部命令**的半径
// （`sudo rm -rf /etc` 的 system 来自 /etc，不是来自 sudo 本身），而提权这件事本身
// 也需要一个档 —— 故两者并存、取最严：
//     sudo ls          → 只命中 priv（无内部目标）
//     sudo rm -rf /etc → 命中 priv + wide，取 wide
// 副作用必须写进面板：把「提权」设为 allow 后 `sudo rm -rf /` 仍然 ask（被 wide 压过），
// 不说明白会被当成 bug。
const RADIUS_GROUPS = dict({ del: 1, disk: 1, perm: 1, priv: 1 })

/**
 * `PURE_RADIUS_GROUPS` —— **纯半径组**：走半径档、且**没有**自己的组档的那些组。
 *
 * 定义 = `RADIUS_GROUPS` 的键 − `GROUP_TIER` 的键（= `del` / `disk` / `perm`）。
 *
 * ── 为什么必须是**派生**而不是第三份手写清单 ────────────────────────────────────
 * 「哪些组是纯半径组」这件事此前只以**字面量数组**的形式活在 `test/shell-parse.mjs` 的
 * 测试 51 里（`const RADIUS_GROUPS = ['del','disk','perm']`），而生产侧那两张表
 * （`RADIUS_GROUPS` / `GROUP_TIER`）都没导出 —— 于是「哪几个组走半径档」在生产与守卫
 * 各有一份，日后新增一个半径组时测试 51 仍按旧三元组遍历，新组里「参数非路径」的 label
 * 会静默落 `inside`（fail-open）而断言照样全绿。这与 `GROUP_OF_LABEL` 由 `GROUP_MEMBERS`
 * 派生（测试 32b）、`GROUP_MEMBERS.priv` 由 `PRIV_PREFIXES` 派生（测试 54g）是同一条纪律：
 * **判据表只有一份，消费方引用它**。
 *
 * ── 为什么 `priv` 被排除（这是本常量存在的另一半理由）────────────────────────────
 * `priv` 虽然在 `RADIUS_GROUPS` 里，但它**不是**纯半径组，两处判据都体现了这一点：
 *   · `tierSetOf` 的 ① 分支：`priv` 只在 `seg.blast` **非 null** 时才并半径档
 *     （`hasPrivGroup && seg.blast`），而纯半径组的 `null` 按 §5.1 归 `inside`；
 *     故 `sudo ls` 只命中 `priv`、**没有** `inside` 档 —— 若把 `priv` 当纯半径组遍历，
 *     它的 6 个成员（`sudo` / `doas` / `su` / `pkexec` / `runas` / `gsudo`）blast 恒 `null`
 *     （提权命令自己没有目标），探针表里一个都没有，测试 51 会立刻报「无探针」。
 *   · 设计文档 §2.2 / §5.6③ 的口径一致：`priv` 的判据是「提权档 + 内部命令半径档**两者并存**」，
 *     §9.8 的探针表也只按 20 + 2（纯半径组 + priv）计数。
 * 故「纯半径组」= `RADIUS_GROUPS` 键 − `GROUP_TIER` 键，正是下面这个派生式。
 */
export const PURE_RADIUS_GROUPS = Object.keys(RADIUS_GROUPS).filter((g) => GROUP_TIER[g] === undefined)

/**
 * `BARE_INTERACTIVE` —— 无实参时会进入自己的交互 shell 或阻塞等 stdin 的命令。
 *
 * 为什么归 `unknown` 而不是 `inside`：在 DSH 的非交互执行环境下它们要么挂住调用、
 * 要么读到 EOF 后退出，**不会真的动磁盘** —— 但后果**读不出**，与「目标读不出」
 * 同性质（都是「无法判定实际会发生什么」）。fail-closed 方向是问一次。
 *
 * 注意这是**形态**判据（看有没有非选项实参），不是 label 判据：
 *     parted /dev/sda    有实参 → 走半径档 → system|/dev/sda   ✅
 *     parted             无实参 → 归 unknown                    ✅
 *     dd of=/dev/sda     有实参 → 走半径档 → system|/dev/sda   ✅
 *     dd                 无实参 → 归 unknown                    ✅
 * 若按 label 判（只要叫 parted 就归 unknown），`parted /dev/sda` 那条**真实的 system
 * 警告会被降级成「无法判定」** —— 那是把已知的更严重结论换成更模糊的结论，方向错了。
 *
 * `shutdown` / `reboot` 这类「裸跑 = 真的会执行」（shutdown 裸跑即一分钟后关机，
 * man shutdown(8)：`If no time argument is specified, "+1" is implied`）**不在此表**：
 * 它们属 power 组，组档判据不看有没有目标，已被完整覆盖 —— 不需要第二条规则。
 */
export const BARE_INTERACTIVE = dict({ diskpart: 1, parted: 1, dd: 1 })

/**
 * `NON_PATH_ARG` —— 实参是**策略名**而非路径，故 `blastRadiusOf` 恒返回 null 的命令。
 *
 * 与 `BARE_INTERACTIVE` 的区别是判据类型：那个看「有没有实参」，这个看「是谁」——
 * `set-executionpolicy` 无论带不带实参，blast 恒 null（裸跑 / 带策略名 / 带 -scope 四种
 * 形态实测全 null），因为它根本没有路径参数可判。
 *
 * 为什么必须单独处理：它在 `perm` 组（走半径档），实参不是路径 → blast 恒 null
 * → 落 `inside` → 大分类 allow 时**静默**。而它的真实效果是
 * `Set-ExecutionPolicy unrestricted` 让任何脚本无签名运行 —— **降低整机安全限制**，
 * 与 `rm -rf ./build`（区内删个构建目录）完全是两回事。
 *
 * 这是「无参数 = 默认动作」那条论证的延伸：判据不该按**组**划，
 * 该按「**该组的判据能否处理它的所有成员**」划。`perm` 是唯一半径判据覆盖不全的组。
 */
export const NON_PATH_ARG = dict({ 'set-executionpolicy': 1 })

/**
 * `diskpart` 的 `/s <脚本>` 形态。
 *
 * 它**有**实参，故不命中 `BARE_INTERACTIVE` 的形态判据；而那个实参是**脚本文件**
 * 而非操作目标 —— 半径判据判不出脚本内容的影响（实测 `diskpart /s script.txt` 的 blast
 * 是 null：`script.txt` 被当成路径判为「区内」）→ 落 inside 档 → 大分类 allow 时静默。
 *
 * 而它比裸跑**危险得多**：裸跑只进交互、读到 EOF 就退出，`/s` 会真的执行脚本里的分区操作。
 * 故按「后果读不出」归 `unknown`，与 `NON_PATH_ARG` 同性质。
 */
export const DISKPART_SCRIPT_FLAGS = dict({ '/s': 1, '-s': 1 })

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

// 导出仅供测试穷举（§残余 ② 的守卫：路径 basename 不得被当关键字，测试按**全表**逐条钉，
// 抽样会让「日后往表里新增关键字」多出一条静默漏报 —— 与测试 34 里那条「关键字取全部而不是
// 抽样」的纪律同源）。**判定逻辑不消费本导出**，模块内部照旧直接用上面的常量。
export { STATEMENT_KEYWORDS }

// 子命令路由器命令族：label 细化到「git status」这一粒度，而不是一放全放「git *」。
// reg 也在此列：`reg delete` 是破坏性的而 `reg query` 不是，不细分就无法区分。
const ROUTER_CMDS = dict({ git: 1, npm: 1, pnpm: 1, yarn: 1, docker: 1, kubectl: 1, dotnet: 1, cargo: 1, go: 1, gh: 1, pip: 1, uv: 1, conda: 1, reg: 1 })

// 路由器命令的「带值选项」：跳过选项本身后还要跳过它的值（git -c key=val / npm --prefix ./x）
const ROUTER_OPT_VALUE = dict({ '-c': 1, '-C': 1, '--config': 1, '--config-env': 1, '--git-dir': 1, '--work-tree': 1, '--namespace': 1, '--exec-path': 1, '-H': 1, '--prefix': 1, '--cwd': 1, '--project': 1, '--registry': 1 })

// `routerSubLabelOf` 向后扫描的**上限**（见该函数注释里那段平方退化实测）。
//
// 为什么需要它：该函数的调用方 `isTargetEatingNameIn` 是**逐词元**调用的
// （`isPrivOperandWord` 在贪婪扫描里每个词元各问一次），而无上界的向后扫描与它相乘
// 即 O(n²)。实测 `su (/reg --config)*n`（路径形态的路由器名）n=8000 时
// `segmentLabels` 556.8 ms、`blastRadiusOfSegment` 1120.5 ms（倍率均 ≈4.0）。
//
// ⚠️ **上限是 load-bearing 的，不能按「改用无上限的 router 分支」修**：实测把本上限
// 去掉后，`su root (-/reg --config)*8000` 的 `segmentLabels` 由 8.1 ms 涨到 **551 ms**
// （倍率 3.89，标准平方）—— 那个词元既是「操作数形态」（`-` 开头）又按 basename 命中
// `ROUTER_CMDS` 的 `reg`，是唯一能同时走进贪婪扫描与向后扫描的形态。
//
// 计数口径：**两个维度各一个上限**，不是二选一。
//   · 词元维度 `ROUTER_SUB_SCAN_MAX * 2 + 8` —— 纯词元数的硬上界（防病态输入打转）；
//   · 带值选项维度 `ROUTER_SUB_SCAN_MAX` —— 跳过的**带值选项次数**上限。
// 为什么必须补第二个维度：只按词元计数时，**同一个键重复出现**会击穿上限 ——
// `su root reg (-c v)*n delete …` 每对占 2 个词元，n≥32 就越过 64，`delete` 扫不到、
// `reg delete` label 丢失、`headEnd` 由 3 掉回 1。原注释用「13 个键全用上也才 26 个词元」
// 论证上限不会误伤，那个论证**漏了同键重复**（13 是**去重后**的键数，重复出现不受它约束）。
// 补上次数维度后：13 个不同键仍远在 64 次之内，而同键重复到 64 次也能扫到子命令。
//
// 两个上限都只对**病态输入**生效：真实调用里带值选项从不超过个位数。
const ROUTER_SUB_SCAN_MAX = 64

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

// 前导 `NAME=value` 赋值前缀的判据（**单一来源**）。两处读它：`unwrapWordsFrom` 的游标推进、
// 以及同一个循环里 `env` 自己的赋值前缀（`unwrapWords` 是 `unwrapWordsFrom` + 一次 slice，
// 故也走这一份）。两处若各写一份正则，漂移会让「命令头到哪儿」与「label 是什么」分叉，
// 方向 fail-open（与 `PRIV_PREFIXES` / `GROUP_OF_LABEL` 那几处「单一来源」是同一条纪律）。
const LEAD_ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/

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
  const arr = Array.isArray(words) ? words : []
  const r = unwrapWordsFrom(arr, 0)
  // 两个出口的契约不同，故分开处理：
  //   · opaque 出口 —— 内核已把 `words` 物化成「**剥到本层**」的视图（与逐层 slice 的原实现
  //     逐字同契约），直接交回，**不能再切**（它已经不含 `base`）。
  //   · 正常出口 —— 内核只回游标 `base`，在这里切一次。`base === 0` 时切出等长拷贝，
  //     复现原实现「开头就 `words.slice()`」的契约（返回值不与入参共享引用）。
  if (r.opaque) return { words: r.words, opaque: true }
  return { words: arr.slice(r.base), opaque: false }
}

/**
 * `unwrapWords` 的**纯下标**内核（本轮 F2 的修法）—— 全程按下标推进，不复制任何数组。
 *
 * 存在的理由：`pushHeadLabels` 的链尾要问「从下标 `i` 起这条链的命令头 label 是什么」，
 * 而它此前写 `segmentLabel(w.slice(i))` —— 切片是 O(剩余词元数)，而 `segmentLabelsCore`
 * 对**每个** `-exec` 都调一次 `headLabelAt` → `pushHeadLabels`，段内 n 个
 * `-exec sudo cmd_i {} +` 于是累计 Σ(n−j) = **O(n²)**。
 * 实测 `isDestructiveSegment`（index.js 的 buildCandidates 对每段调一次、同步早于弹窗）：
 *   n=1000 → 2.3 ms、2000 → 6.9、4000 → 84.7、**8000 → 599 ms**（倍率 2.9/12.4/7.1）；
 *   对照**无前缀**的 `-exec cmd_i {} +`（`headLabelAt` 立即 return、不切片）同规模
 *   0.6/0.9/1.8/3.7 ms（倍率 1.5/2.0/2.1，线性）—— 平方因子就是那次 `w.slice(i)`。
 * 触发形态 `find . -exec sudo … {} +` 是 AI 常写的常规写法，不是构造输入。
 *
 * ⚠️ **不是第二份剥法**：`unwrapWords` 就是本函数 + 一次 `slice`，两者共用同一份判据
 * （`LEAD_ASSIGN` / `WRAPPERS` / `WRAPPER_VALUE_FLAGS`，同一批表）。两处若各写一份
 * 「什么算前缀」，命令头与 label 必然分叉 —— 那正是本文件反复要修的那类缺陷。
 *
 * ⚠️ **本函数内不得出现任何 `slice`**（否则调用方一多就又是 O(n²)，见上）：推进一律用
 * 游标 `base`，opaque 出口直接回入参（那一支的 `words` 是死值，见 `unwrapWords`）。
 *
 * @param {string[]} current 词元列表（参数名保持 `current`：opaque 出口的返回字面形态
 *   被 `test/regressions.mjs` 的结构断言按名锁定，改名会让该断言变红）
 * @param {number} start 起点下标（`0` 时与 `unwrapWords(current)` 的剥法逐字等价）
 * @returns {{ words: string[], base: number, opaque: boolean }} `current[base …]` 才是剥完的词元；
 *   `opaque` 为真时调用方按原契约整个放弃解析（此时 `base` 无意义、`words` 是入参本身）。
 */
function unwrapWordsFrom(current, start) {
  const w = current
  let base = start > 0 ? start : 0
  // 前导 NAME=value（值可为空）。用游标推进而不是逐次 slice：后者每剥一个词元就复制一次
  // 整个数组，前缀多时是 O(k²)。实测 32000 个 `A=1` 前缀：逐次 slice 946 ms，游标写法 ~1 ms
  // —— 而它在 segmentLabel 里被逐段调用、segmentLabel 又在 assessCommand 的每段循环里跑。
  while (w.length - base > 1 && LEAD_ASSIGN.test(String(w[base]))) base += 1
  for (let depth = 0; depth < 4; depth += 1) {
    const name = commandNameOf(w[base])
    if (!WRAPPERS[name]) break
    let index = base + 1
    while (index < w.length) {
      const token = String(w[index])
      // env 自身也接受 NAME=value 形态的赋值前缀
      if (name === 'env' && LEAD_ASSIGN.test(token)) { index += 1; continue }
      if (!token.startsWith('-')) break
      // ── 两个 opaque 出口 ─────────────────────────────────────────────────────────
      // 返回的是「**剥到本层**」的词元（`current`），与原实现逐字同契约。
      // 游标版把「本层」表达为 `base`，故这里**只在确实要 opaque 返回时**把它物化一次
      // （`w.slice(base)`）——正常路径（`-exec sudo cmd` 的链尾）`w[base]` 不是 wrapper、
      // 循环直接 break，一次都不切。这是本函数不引入 O(n²) 的前提（见上面的说明）。
      // 判据 `base > 0`：`base === 0` 时 `current` 已经就是本层视图，不必复制。
      //
      // ⚠️ 下面两个 `if` 的**字面形态**被 `test/regressions.mjs:2235` 的结构断言锁定
      // （`/…return \{ words: current, opaque: true \}/`），故不能把它们合并成一个
      // `if (isOpaqueHere) return …` —— 那会让该断言变红。物化动作因此单列在上面一行。
      if (base > 0 && ((name === 'env' && (token === '-S' || token === '--split-string'))
        || (name === 'command' && (token === '-v' || token === '-V')))) current = w.slice(base)
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
    if (name === 'timeout' && /^[0-9]+(?:\.[0-9]+)?[smhd]?$/.test(String(w[index] == null ? '' : w[index]))) index += 1
    // 剥到空（`env` 单独成段）→ **保留当前游标**：原实现在这里返回的是**剥之前**那一层，
    // 故不能把 `base` 推到 `index`。判据 `index >= w.length` 与原来的 `next.length === 0`
    // 逐字等价（`next` 的长度就是 `w.length - index`）。
    if (index >= w.length) break
    base = index
  }
  return { words: current, base, opaque: false }
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
  return segmentLabelFrom(words, 0)
}

/**
 * `segmentLabel` 的**唯一下标入口**（`segmentLabel(words)` 就是 `segmentLabelFrom(words, 0)`）。
 *
 * 存在的理由（本轮 F2）：`pushHeadLabels` 的链尾要问「从下标 `i` 起这条链的命令头 label 是
 * 什么」，而它此前写 `segmentLabel(w.slice(i))`。改成下标入口后**一次拷贝都不做** ——
 * 语义与 `segmentLabel(words.slice(start))` **逐字等价**（本函数体就是原 `segmentLabel` 的
 * 函数体，只是把内部的相对下标 `w[k]` 一律换成绝对下标 `w[base + k]`，把内部的
 * `unwrapWords(w.slice(k))` 换成 `unwrapWordsFrom(words, k)` —— 后者本来就只回游标）。
 *
 * ⚠️ 不要用 `segmentLabel(words.slice(start))` 代替它：那正是本轮要消除的那次 O(n) 拷贝。
 * ⚠️ `start` 必须落在**词元边界**上（`pushHeadLabels` 的推进步保证这一点）。
 *
 * @param {string[]} words 段词元
 * @param {number} start 命令头起点下标（0 = 与 `segmentLabel` 逐字同值）
 * @returns {string} label（认不出时为空串）
 */
function segmentLabelFrom(words, start) {
  const u = unwrapWordsFrom(Array.isArray(words) ? words : [], start)
  if (u.opaque) return ''
  const w = u.words
  let idx = u.base
  if (idx >= w.length) return ''
  let head = commandNameOf(w[idx])
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
    { let nx = idx + 1; try { const s = skipPrefixArgs(w, idx + 1, head); if (s > nx) nx = s } catch (e) {} if (nx > idx + 1) { idx = nx - 1; head = commandNameOf(w[idx]) } }
    let found = -1
    for (let j = idx + 1; j < w.length; j++) {
      const t = commandNameOf(w[j])
      if (!t || BAD_LABEL_CHARS.test(t)) continue
      // 关键字继续跳过（`case x in` 的 `in`、`for i in` 的 `in`）
      //
      // ── ⚠️ 但「继续跳过」**必须同时跨过该关键字自身的选项**（本轮 F5 的修法）──────────
      // 上面 `:775` 那一轮已经用 `skipPrefixArgs` 跨过**段首关键字**的选项，而本分支此前
      // 只写 `idx = j` —— 于是**第 2 轮起** `head` 由内层 `found` 循环重新赋值时**不再**跨过
      // 新关键字的选项：`! time -p rm -rf ~/.dsh` 的 `-p` 占掉下一轮的位置，
      // `segmentLabelFrom` 返回 **`'-p'`**（既不是命令名、也不在破坏性名单里）
      // ⇒ `isDestructiveSegment = false` ⇒ 破坏性子设置整个跳过、半径档与组档全丢。
      //
      // 方向 **fail-open**，且是「只修了段首那一轮」造成的**同族分叉**：实测
      // （`category=allow` + destructive 八档全 deny）：
      //     time -p rm -rf ~/.dsh                 → **deny** ✅（走段首那一轮）
      //     ! time -p rm -rf ~/.dsh               → **allow** ❌
      //     then time -p … / if true; then … / while … do … / until … / for …  → **allow** ❌
      // 判据族其余成员对同形态**都正确**（`['!','time','-p','rm','-rf','/tmp']`：
      // `headFull=4`、`headCommandNameOf='rm'`、`hasNoOperand=false`）⇒ 只有本函数未对齐。
      //
      // ⚠️ 落点**必须是内层 `j`**（不是 `idx`）：本循环的推进量由 `j` 决定，
      // 写 `idx = nx - 1` 只改一个马上会被 `found` 覆盖的变量，**实测无效**。
      // 判据复用 `skipPrefixArgs` **单点** —— 与 `:775`（段首那一轮）、
      // `commandHeadEndFull` 的关键字分支、`pushHeadLabels` 同源，四处不各写一份
      // 「什么算关键字自己的选项」。O(1)、无正则、无分配。
      if (STATEMENT_KEYWORDS[t]) {
        let nx = j + 1
        try { const s = skipPrefixArgs(w, j + 1, t); if (s > nx) nx = s } catch (e) {}
        j = nx - 1
        continue
      }
      found = j
      break
    }
    if (found < 0) return ''
    idx = found
    head = commandNameOf(w[idx])
    // 关键字之后可能是 wrapper（`then nohup rm …`）：就地剥掉它及其选项/带值选项，
    // 否则 label 会停在 wrapper 上。复用同一份剥法（`unwrapWordsFrom`）保证与主路径一致。
    //
    // 下标版：原写法 `unwrapWords(w.slice(idx))` 的返回值长度是 `w.length - rest.base`，
    // 故原来的 `advance = w.length - idx - rest.words.length` 恰好等于 `rest.base - idx` ——
    // 直接取 `rest.base` 即可，省掉那次 O(剩余词元数) 的切片。
    const rest = unwrapWordsFrom(w, idx)
    if (!rest.opaque && rest.base < w.length && commandNameOf(w[rest.base]) !== head) {
      idx = rest.base
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
 * 从下标 `start` 起，**跳过整条前缀链**，取出命令头位置上的命令名（单个 label）。
 *
 * 判据与 `pushHeadLabels` 的推进循环**逐字同源**（同一张转移表：语句关键字 → wrapper →
 * 提权前缀，各自用 `skipPrefixArgs` / `privOperandSkip` 跳过选项与操作数），
 * 只做**纯下标推进 + 链尾一次 `segmentLabel`**，故是 O(链长) 而不是 O(剩余词元数)²。
 *
 * 存在的理由（发现 1）：`segmentLabelsCore` 的 `find -exec` 载荷族此前**只取 `-exec` 之后
 * 的第一个词元**，于是载荷里的提权前缀被当成命令名收下、真命令名永不进 labels ——
 * `find . -exec sudo kill {} ;` 的 tiers 只剩 `['priv']`、动作 **allow**
 * （对照 `sudo find . -exec kill {} ;` 是 `['proc','priv']`/deny，54s 已修）。
 * 修法就是复用主路径那套推进，而不是在这里另写一份「什么算前缀」。
 *
 * ⚠️ 与 `pushHeadLabels` 的分工：那个负责**链上每一层的名字**都进 labels（收紧方向），
 * 这个只回答「链尾的命令名是谁」—— `-exec` 载荷族的既有口径就是**单个单词** label
 * （见 `test/shell-parse.mjs` 的 54s：「`reg delete` 不在语料里，该分支合成的是单词 label」）。
 * 故本函数在把链尾 label 追加进 `out` 时**取首词**（`reg delete` → `reg`），与修复前的
 * 「取第一个词元」在粒度上逐字一致 —— 本修法只该修「前缀链不推进」，不得顺手改粒度。
 *
 * @param {string[]} w 词元列表（完整段词元，下标以它为基准）
 * @param {number} start 载荷起点（`-exec` 之后、已剥掉 wrapper 与赋值前缀的位置）
 * @param {Function} addWidened `widened` 的 O(1) 写入单点
 * @param {Function} addLabel `out` 的 O(1) 写入单点
 * @param {string} headPrefix **本段命令头的提权前缀名**（空串 = 命令头不带提权前缀）。
 *   只用于「载荷链首那一层是否该进 `widened`」—— 同名时不进，见 `pushHeadLabels` 的说明。
 * @returns {void} 无返回值（此前声明 `{string}` 并返回「命令头位置上的**单词** label」，
 *   但**两个调用点都是语句位置裸调用、结果被丢弃**，且该函数**未导出** —— 全文件没有任何
 *   消费方，属死返回值。删除它同时去掉了 `:918` 那次 `String(head).split(' ')[0]` 的分配。）
 *   ⚠️ `widened` 的登记是**本函数内部的副作用**（`pushHeadLabels` 对链上每一层扩展名
 *   都会调 `widen`）—— 调用方**不需要**再补一遍，实测补的那一遍是死代码（见
 *   `segmentLabelsCore` 里 `-exec` 分支的说明）。
 *   ⚠️ 形参 `out` / `widened` 已删（第 8 圈删掉两条兜底后，它们在本函数体内**只剩签名行
 *   一处**——`out` / `widened` 的写入全部经 `addLabel` / `addWidened` 单点）。详见
 *   `pushHeadLabels` 的说明。
 */
function headLabelAt(w, start, addWidened, addLabel, headPrefix) {
  // ── 复用 `pushHeadLabels`（**不另写一份前缀链推进**）────────────────────────────────
  // 这正是发现 1 的修法：载荷族的命令名提取必须与主路径**同源**，否则「命令头到哪儿」
  // 与「labels 有哪些」必然再次分叉。`pushHeadLabels` 的语义恰好两件事都做：
  //   · 把 `w[start]` 的名字 push 进 `out`（与修复前「取第一个词元」逐字一致）；
  //   · 若是提权前缀则**循环推进**，链上每一层的名字都进 `out` / `widened`，
  //     最后返回命令头 label。
  //
  // ⚠️ 前缀名**必须也进 labels**（不是只取链尾那个名字）：`priv` 组是**半径组**，
  // `tierSetOf` 的 ① 分支靠 `GROUP_OF_LABEL` 里有没有 priv 组成员来决定「要不要并半径档」
  // （`hasPrivGroup && seg.blast`）。只取链尾名字时 `find . -exec sudo kill {} ;` 的 labels
  // 是 `['find','kill']`（无 priv 组成员）→ **不并半径档** → 档集 `['proc','priv']`，
  // 而对照 `sudo find . -exec kill {} ;` 是 `['sudo','find','kill']` → 并半径档
  // → `['outside','proc','priv']`。实测两者**不同值**，正是本函数要避免的分叉。
  // ── 链尾 label 的**单词化**由 `pushHeadLabels` 单点完成（本轮 F1 的修法）──────────────
  // `pushHeadLabels` 的链尾走 `segmentLabel`，对路由器命令会给**两词** label
  // （`sudo reg delete …` → `reg delete`），而载荷族的既有口径是**单词** label
  // （54s 原文：`find . -exec reg delete …` 只得 `reg`）。故写入时统一取**首词**：
  // 链上**前缀名**（`sudo` / `su`）本来就是单词，取首词对它们无影响；两词 label 只有
  // 路由器命令会产生，取首词正是修复前的粒度。判据用词法（有没有空格）而非名单。
  // ⚠️ 首词化由 `pushHeadLabels` 的第 7 个形参 `headWordOnly` 在**返回之前**完成
  // （见那里的 `:1265`）—— 本函数**不再**参与首词化，也**不把结果交回调用方**（无返回值）。
  //
  // ⚠️ **首词化必须发生在 `out` 与 `widened` 的同一个写入点上**（本轮 F1）：此前只有
  // `addLabel` 被包了一层首词化、`addWidened` 没有，于是 `labels=['find','sudo','git']`
  // 而 `widened=['git status']` —— 授权面（`assessCommand` 的
  // `labels.filter(l => !widenedSet.has(l))`）里 `git` **不在** `widenedSet` 中，存活下来
  // 被用户为普通 `git` 写下的 `git *`=allow 命中。实测（例外 `<router> *`=allow、其余 ask）：
  //     find . -exec sudo git status {} ;           → **allow**
  //     find . -exec sudo git push --force {} ;     → **allow**
  //     find . -exec sudo reg delete HKLM\X /f {} ; → **allow**
  //     find . -execdir sudo reg delete … ;         → **allow**
  //     find . -exec sudo docker rm -f x {} ;       → **allow**
  //     find . -exec sudo su root reg delete … ;    → **allow**
  // 而主路径 `sudo git status` 是 ask —— 同一条前缀语义两个结论（不变量分叉）。
  // 对照：单词 label（`rm` / `kill` / `shutdown` / `wmic`）两处形态天然一致，故 54z 的语料
  // **结构性照不出**这一格（这正是它漏网的原因）。
  // 修法是让 `widened` 与 `labels` 走**同一份首词化** —— 即由 `pushHeadLabels` 的
  // `headWordOnly` 在**返回之前**截断，两个写入点拿到的就是同一个已截断的值。
  // 第 7 个参数 `headWordOnly = true`：载荷族只要链尾 label 的**首词**；它同时使链尾走
  // 纯下标版（不复制后缀），那是本轮 F2 的 O(n²) 修法。
  // 第 8 个参数 `headPrefix`：**本段命令头的提权前缀名**（`sudo` / `doas` / …；段首无提权
  // 前缀时为空串）。它只影响**载荷链首那一层**是否进 `widened` —— 见 `pushHeadLabels` 里的说明。
  const PH = (t) => t === '{}' || t === ';' || t === '+'
  // ── 跳过载荷首部的**占位符**，但判据必须按**词元原文**而非「是不是占位符」──────────────
  // 原写法 `while (st < w.length && PH(commandNameOf(w[st]))) st += 1` 只在**认出占位符**时
  // 前进；而 `commandNameOf` 对**空 basename 词元**（`/`、`./`、`../`、`bin/`、`C:/`、`~/`、
  // `$X/`、`//`、`.exe`、`x.exe/` …）返回**空串**，`PH('')` 为假 → 循环**立即停下** →
  // `pushHeadLabels` 的 `if (!first) return ''` 提前返回 → **整个 `-exec` 载荷族 label 合成
  // 被放弃**（fail-open）。实测（HEAD 用 `continue` 继续向后扫，不受影响）：
  //     `find . -exec / rm -rf / {} +`  HEAD labels=['find','rm']/destructive=true
  //                                     CUR  labels=['find']/destructive=false
  // 语料 = 10 个空 basename 词元 × 4 flag × 6 载荷 × 4 tail = 960 格，**960 格全差异**。
  // 修法 = 按词元原文跳过：「空 basename」与「占位符」都**不是命令名**，都该继续向后扫；
  // 只有「认得出且不是占位符」才停。空串与占位符都进不了 `labels`（既有口径不变），
  // 而 54s 的单词粒度（`-exec reg delete …` → `['find','reg']`）与 F82b 的「占位符不进
  // labels」两条口径也都保住（占位符仍走 `st += 1` 跳过，不会被 `pushHeadLabels` 写进 `out`）。
  // 收敛性：每轮至少前进一个下标，`st >= w.length` 时照旧返回 ''（整段都是占位符/空 basename）。
  let st = start
  // `cn` 顺带留住在**有效命令名**上的那次取值，供下面的畸形名守卫复用（零额外调用）。
  let cn = ''
  while (st < w.length) { cn = commandNameOf(w[st]); if (!PH(cn) && cn) break; st += 1 }
  if (st >= w.length) return ''
  // ── ⚠️ 畸形命令名的守卫**必须前移到写入之前**（HEAD 的 `break` 语义）────────────────────
  // 下面 `:952` 那句 `if (BAD_LABEL_CHARS.test(head)) return ''` **拦不住写入**：它只阻止
  // **返回** `head`，而 `pushHeadLabels` 的 `push(first)`（`:1064`）早于它执行 —— 畸形名已经
  // 落进 `out`（= labels），回滚不了。于是载荷首词元含 `=`/`*`/`?`/`$`/`%`/`&` 等字符时，
  // **畸形名被当成命令名写进 labels**，方向是 **fail-open**。
  //
  // HEAD 的两条 `-exec` 分支都在 push **之前** `break`（`git show HEAD:shell-parse.js` 的
  // `:605` / `:617`：`const cand = commandNameOf(w[k])` → `if (BAD_LABEL_CHARS.test(cand)) break`
  // → `out.push(cand)`），故 HEAD **从不**把畸形名写进 labels。本条是 HEAD 与实现之间的
  // 新分叉（不是「`}` 闭合花括号族」那种语法非法形态，那族三基线同值）。
  //
  // 实测（14 畸形名 × 4 flag × 3 载荷 × 2 tail = 336 格，与 HEAD 逐字对拍）：
  //     `find . -exec a-b=c rm -rf / {} +`   HEAD labels=['find']  分叉前 labels=['find','a-b=c']
  //     `find . -exec x*y kill 1234 {} +`    HEAD labels=['find']  分叉前 labels=['find','x*y']
  // 336 格中 **216 格 labels 分叉**（9 个走快路径的畸形名 × 4 × 3 × 2；`a&b`/`a|b`/`a<b`/`a>b`
  // 被词法器分段、`a=b=c` 走慢路径被 `unwrapWordsFrom` 当赋值前缀剥掉，这 5 个本就与 HEAD 同值）。
  // 端到端同 216 格由 HEAD=ask 变 allow（例外 `a*`=allow 时 `matchCommand('a*','a-b=c')` 为 true，
  // 整段被这条**宽泛**例外命中）。
  //
  // ⚠️ 判据必须是**写进 `out` 的那个名字**（即 `commandNameOf(w[st])`，与 `pushHeadLabels` 的
  // `first` 逐字同值），且必须落在 `pushHeadLabels` **之前** —— 放在它之后（无论判 `head` 还是
  // 判 `cn`）都只能阻止返回值，堵不住已经写进 `out` 的畸形名。
  // ⚠️ 用循环里已算出的 `cn`，不重算 `commandNameOf`：判据仍是「查表 + `indexOf`」形态，
  // 复用既有正则常量 `BAD_LABEL_CHARS`，无新分配、无正则构造（O(1) 性能纪律）。
  // ⚠️ 方向是**收紧**：只让载荷族少写一个畸形名，主路径（`segmentLabelsCore` 的调用点）不经
  // 本函数，故 `segmentLabel` / `commandHeadEnd` 的既有行为逐字不变。
  if (BAD_LABEL_CHARS.test(cn)) return ''
  const head = pushHeadLabels(w, st, addWidened, addLabel, true, headPrefix)
  if (!head || PH(head)) return ''
  // 兜底：链尾 label（可能被 `headWordOnly` 截断，也可能是 `pushHeadLabels` 推进后才认出的名字）
  // 同样不得是畸形名 —— 与 HEAD 的 `break` 语义对齐，也与上面那道前置守卫同源。
  if (BAD_LABEL_CHARS.test(head)) return ''
  // ── 链尾那个名字**必须补登记进 `widened`**（判据 = **本段命令头带提权前缀**）──────────
  // `pushHeadLabels` 的 `widen` 只覆盖**链上每一层前缀名**（`sudo` / `su`），**不含链尾**：
  // 它的写法是「推进到链尾后返回 label」，链尾 label 由调用方 `segmentLabelsCore` 的主路径
  // 那一支单独 `widen(head)`。载荷族此前没有这一步 —— 实测：
  //     `sudo find / -exec rm -rf {} +`  → widened=['find']（`rm` 缺席）❌
  //     `find . -exec sudo rm -rf {} +`  → widened=['rm'] ✅（起点是前缀，链尾 `rm` 被补上）
  // 缺了它的后果是**授权方向被放宽**：例外 `rm *`=allow 时 `sudo find / -exec rm -rf {} +`
  // 由 **ask → allow**（54u 正钉这条，实测本修法第一版把它弄红了）。
  //
  // ⚠️ 判据**不是**「链尾名字与载荷首层那个名字是否相同」（那样 `sudo find / -exec rm`
  // 的起点 `rm` 就不补了，而它恰恰是被放宽的那一格）。正确判据是**本段命令头带提权前缀**
  // （`synthWidened`，即段首/命令头是提权前缀）—— 与 `-delete` 那一支**同一条判据**，
  // 两处口径一致：
  //     `find . -exec rm -rf {} +`      → 无前缀 → 不补（`rm` 可被 `rm *`=allow 授权，HEAD 亦然）✅
  //     `sudo find / -exec rm -rf {} +` → 有前缀 → 补（不得被 `rm *`=allow 授权）✅
  //
  // ── ⚠️ 登记的值必须是**实际写进 `out` 的那个形态**，不是它的首词（本轮 F3）────────────
  // 上一轮 F1 的修法把首词化放在**链尾返回值**上（`pushHeadLabels` 的 `:1127`），而那只覆盖
  // 「链尾」这一个写点。`pushHeadLabels` 的 `:954` `push(first)` 早于它，且 `:955` 的
  // `PRIV_PREFIXES[first] !== 1` 早退让链尾截断**根本走不到** —— 于是当载荷首词元**本身含空格**
  // （引号包住的多词词元）时，两个集合的形态再次分叉：
  //     `out` 拿到 `push(first)` 的**原值** `reg delete`
  //     而这里登记的 `word` 是它的**首词** `reg`
  // → 授权面（`assessCommand` 的 `labels.filter(l => !widenedSet.has(l))`）里两词项 `reg delete`
  // **不在** `widenedSet` 中、存活下来，被用户为普通 `reg` 写下的 `reg *`=allow 命中。
  // 实测（例外 `<首词> *`=allow、其余 ask，修复前）：
  //     sudo find . -exec "reg delete" HKLM\X /f {} ;  labels=['sudo','find','reg delete']
  //                                                    widened=['find','reg'] → 授权面=['sudo','reg delete'] → **allow**
  //     sudo find . -exec "git status" {} ;            → **allow**
  //     doas find . -exec "docker rm -f x" {} ;        → **allow**
  //     sudo find . -execdir "rm -rf" {} ;             → **allow**
  //     pkexec find . -ok "kill -9" {} ;               → **allow**
  // 而**同一条命令**的两个对照都是 ask，即这一格是纯粹的不变量分叉：
  //     无引号载荷 `sudo find . -exec reg delete …` → labels=['sudo','find','reg'] → ask ✅
  //     主路径     `sudo reg delete …`             → labels=['sudo','reg delete']  → ask ✅
  // 触发条件：载荷首词元含空格 + 该段命令头带提权前缀 + 用户写过 `<首词> *`=allow。
  // ⚠️ 54B 的语料结构性照不出这一格 —— 它用的是**无空格**的两词路由器（`reg delete HKLM\X /f`
  // 作为三个独立词元），`first` 因此恒为单词、首词化是恒等变换。
  //
  // 修法：**登记 `head` 本身**（`pushHeadLabels` 的返回值恒等于它写进 `out` 的那个形态 ——
  // 早退三处返回的都是 `push` 过的 `first`，链尾那一支返回的是已按 `headWordOnly` 截断、
  // 且同样 `push` 过的 `head`），于是两个集合不可能再分叉，`widened ⊆ labels` 恒成立。
  // ⚠️ **不得**改成「把首词化下沉到 `:954` 的写点」（即让 `out` 也拿首词）—— 那样
  // `out` 里的 `reg delete` 会退化成 `reg`，而 `reg delete`（不是 `reg`）才是
  // `DESTRUCTIVE_LABELS` 的成员与 `GROUP_OF_LABEL` 的键：实测 `find . -exec "reg delete" HKLM\X /f {} ;`
  // 的 `destructive` 由 true 变 **false**、`reg` 档整体丢失，`reg`=deny + 大分类 allow 时
  // 由 ask 变 **allow**（方向是放宽，比本缺陷更糟）。
  //
  // ── ⚠️ 还必须排除「**同名**」那一格（与链首那一支 `:1063` 同一条判据，本轮 F5）───────────
  // 上面那段判据「本段命令头带提权前缀」对**链尾**来说**不够**：链尾**认不出**时
  // （`head === first`，即 `-exec <前缀名> {} ;` / `;` / `+` 这一族 —— 载荷里只有前缀名、
  // 没有命令名）`pushHeadLabels` 的 `:1238` 会 `return first`，于是这里拿到的 `head`
  // **恒等于载荷首层那个前缀名**。当它与命令头前缀**同名**时（`env sudo find . -exec sudo {} ;`），
  // `addWidened(head)` 挪出授权面的其实是**命令头那个名字** —— 正是 `:1054-1062` 断言
  // 「必须排除、否则过度收紧」的那一格，而该断言当时只落到了 `:1063` 这一支。
  // 实测（例外 `sudo *`=allow、其余 ask，修复前）：
  //     env sudo find . -exec sudo {} ;          HEAD=allow  **ask**   widened=['find','sudo']
  //     env sudo find . -exec sudo ;             HEAD=allow  **ask**
  //     env sudo find . -exec sudo {} +          HEAD=allow  **ask**
  //     timeout 5 sudo find . -exec sudo {} ;    HEAD=allow  **ask**
  //     time sudo find . -exec sudo {} ;         HEAD=allow  **ask**
  //     env doas find . -exec doas {} ;          HEAD=allow  **ask**
  // 而**同一条前缀语义**的主路径 `env sudo sudo rm -rf /etc` / `env sudo sudo` 是 allow
  // —— 同一条前缀语义两个结论（不变量分叉），方向是**过度收紧**（非 fail-open）。
  // 覆盖面：4 flag × 6 载荷前缀 × 10 外层前缀 × 7 tail = 240 格中 144 格过度收紧
  // （按 inner：sudo 72 / doas 48 / pkexec 24；按 tail 均匀分布 24×6；与主路径分叉 144 格）。
  //
  // 同名时**保持既有行为**：授权面里那个名字是命令头前缀本身，用户写 `sudo *`=allow
  // 正是要授权它（HEAD / PRE 亦然）。`widened` 按**名字**判定，同名时两个来源不可区分，
  // 故这一格不能收紧 —— 与 `:1063` 对链首那一层的处置**逐字同源**。
  // 判据因此与 `:1063` 对齐：「命令头**有**提权前缀」且「链尾名字与它**不同名**」。
  if (head && headPrefix && head !== headPrefix) addWidened(head)
  // ⚠️ 此处**没有返回值**：链尾 label 的**首词化**由 `pushHeadLabels` 的 `headWordOnly`
  // 在它返回之前单点完成（两个写入点拿到的就是同一个已截断的值，见上面的说明）。
  // 曾经这里 `return String(head).split(' ')[0]`，而两个调用点都是语句位置裸调用、
  // 结果被丢弃 —— 死返回值，已删。
}

/**
 * @param {string[]} w 词元列表（完整段词元，下标以它为基准）
 * @param {number} start 载荷起点（`-exec` 之后、已剥掉 wrapper 与赋值前缀的位置）
 * @param {Function} addWidened `widened` 的 O(1) 写入单点
 * @param {Function} addLabel `out` 的 O(1) 写入单点
 * @param {boolean} [headWordOnly] 载荷族才传 `true`（链尾 label 取首词），见函数体说明。
 * @param {string} [headPrefix] **本段命令头的提权前缀名**（`sudo` / `doas` / …；命令头不带提权
 *   前缀时为空串）。载荷族由 `headLabelAt` 透传；主路径 `segmentLabelsCore` 的调用点**不传**，
 *   故为 `undefined`。它只放宽一件事：载荷链首那一层名字是否也进 `widened` ——
 *   见函数体内发现 1 的说明。
 *   ⚠️ 主路径不传是**刻意**的：`sudo rm -rf /etc` 必须继续被 `sudo *`=allow 授权
 *   （既有行为，54c2 的对照就钉在这一点上）。
 *
 * ⚠️ 形参 `out` / `widened` 已删（第 8 圈删掉两条兜底后的收尾）────────────────────────
 * 那两个形参在本函数体内**唯一的消费者**是「缺省时退化成按数组查重」的三元兜底
 * （`out.indexOf(x)` / `widened.indexOf(x)`）。第 8 圈把两条兜底都删了（改为直接
 * `const widen = addWidened` / `const push = addLabel`），而签名与 4 个调用点仍原样传参 ——
 * 属「第 8 圈修了一半」：删掉兜底却没删形参，于是 `out` / `widened` 在本函数体内
 * **一次都不再被读**（实测 CODE 命中数 = 1，就是签名行本身；`headLabelAt` 是 2 = 签名 +
 * 转发调用），而调用点仍在计算并传入它们。
 * 删掉是**零行为变更**：本函数未导出、无 `arguments` / `.apply(` / `.call(`（全 0，
 * 无动态逃逸），4 个调用点的实参恒为 function（见下），故形参位与实参位的对应关系不变。
 */
function pushHeadLabels(w, start, addWidened, addLabel, headWordOnly, headPrefix) {
  // `addWidened` = `segmentLabelsCore` 的 O(1) 写入单点（同时维护 `widened` 数组与其并行
  // `Set`，见那里的发现 2 说明）。**直接当函数用**：本函数未导出、独立调用方为零，
  // 四个调用点（`:948` / `:1445` / `:1581` / `:1597`）的实参恒为 function。
  // 曾经这里有一条「缺省时退化成按数组查重」的三元兜底，而它**在全部三套件里一次都没
  // 执行过**（V8 coverage：`pushHeadLabels` 本体 count=844445、兜底函数体 count=0）——
  // 删掉它反而 **fail-fast**：漏传实参时立刻 `TypeError`，而不是静默退化到本批刚消除的
  // O(len) `indexOf` 路径。
  const widen = addWidened
  // `out` 的写入同样必须走 O(1) 单点（发现 2 的同类退化）—— 理由同上，同样是删兜底。
  // `out.indexOf(x)` 是 O(len)，而**载荷族对每个 `-exec` 都调一次本函数**
  // （`find . (-exec sudo c_i {} +)×n`）—— 逐条不同名时就是 O(n²)。
  // 实测（`sudo find . (-exec sudo cmd_i {} +)×n`、`segmentLabels` 单次）：
  // n=4000 → 6.64 ms、**8000 → 23.83 ms**（倍率 3.59，标准平方），
  // 而同名形态 n=8000 仅 2.26 ms（线性）。故与 `widened` 同处置：由调用方传 O(1) 写入单点。
  const push = addLabel
  const first = commandNameOf(w[start])
  if (!first) return ''
  // ⚠️ `push(first)` 写的是**未截断**的 `commandNameOf(w[start])`（本轮 F3 的现场）——
  // 当 `w[start]` 本身含空格（引号包住的多词词元，如 `-exec "reg delete" …`）时它是两词。
  // **不得**在这里补一层首词化：`out` 是破坏性判定与组档的判据（`reg delete` 在
  // `DESTRUCTIVE_LABELS` 里、是 `GROUP_OF_LABEL` 的键），截成 `reg` 会让
  // `find . -exec "reg delete" HKLM\X /f {} ;` 的 `destructive` 由 true 变 **false**
  // （实测：`reg=deny` + 大分类 allow 时由 ask 变 **allow**）—— 那是把漏判换成放宽。
  // 两个集合的**形态一致**由 `headLabelAt` 在 `widened` 那一侧对齐（见那里的说明）。
  push(first)
  // ── ⚠️ **链首那一层也必须进 `widened`**（发现 1 的修法，本轮 F4）────────────────────────
  // 下面 `:1101` 的 `if (cur !== first) { push(cur); widen(cur) }` 把**链上第一层**排除在
  // `widen` 之外 —— 那对**主路径**是对的（`sudo rm -rf /etc` 的 `sudo` 就是段首那个前缀，
  // 用户写 `sudo *`=allow 正是要授权它，54c2 的对照钉在这一点上），但**载荷族不是**：
  // 载荷族的 `w[start]` 是 `-exec` 之后的**载荷首词元**，不是段首。
  // 于是当载荷首词元恰是一个提权前缀名、而段首是**另一个**提权前缀时，该名字只进 `out`
  // 不进 `widened` → 留在授权面 → 被用户为**普通**该前缀写下的 `<前缀名> *`=allow 命中。
  // 实测（例外 `doas *`=allow、其余 ask，修复前）：
  //     sudo find . -exec doas rm -rf /etc {} ;      HEAD=ask  **allow**  labels=['sudo','find','doas','rm']
  //     sudo find . -execdir doas rm -rf / {} ;      HEAD=ask  **allow**
  //     sudo find . -ok doas kill -9 {} ;            HEAD=ask  **allow**
  //     sudo find . -exec pkexec rm -rf /etc {} ;（例外 `pkexec *`）  HEAD=ask  **allow**
  //     doas find . -exec sudo rm -rf /etc {} ;（例外 `sudo *`）      HEAD=ask  **allow**
  // 而**同一条提权语义**的主路径 `sudo doas rm -rf /etc` 是 ask（`doas` 在 `widened` 里）
  // —— 不变量分叉。`:992` 的 `addWidened(head)` 只对齐了**链尾**，堵不住这一层。
  // 覆盖面：`-exec/-execdir/-ok/-okdir` × 6 载荷前缀名 × 6 外层前缀，CUR 相对 HEAD 放宽 1696 格。
  //
  // ⚠️ 判据必须是**显式的 `headPrefix`**（=「本段命令头那个提权前缀**叫什么名字**」，由载荷族经
  // `headLabelAt` 透传），**不能**用「`w[start]` 是不是段首」之类的局部条件 —— 载荷族的
  // `start` 恒不是段首，而主路径的 `start` 恒是段首，两者只能由调用方区分。
  // ⚠️ 主路径的调用点（`segmentLabelsCore` 的 `:1310`）**刻意不传**这个参数，故
  // `sudo rm -rf /etc` 被 `sudo *`=allow 授权的**既有行为逐字不变**。
  // 带引号的多词形态（`-exec "doas kill -9"`）不受影响：`first` 含空格、查表不中。
  //
  // ── ⚠️ 还必须排除「**同名**」那一格（`first === headPrefix`）─────────────────────────
  // `widened` 是**按名字**判定的集合，而命令头的那个前缀名**本来就该留在授权面里**
  // （`env sudo find . -exec sudo rm …` 的 `sudo` 就是命令头前缀，用户写 `sudo *`=allow
  // 正是要授权它）。当载荷首层与命令头前缀**同名**时，`widen(first)` 会把**命令头那个名字**
  // 一并挪出授权面 —— 那是**过度收紧**，且与主路径分叉（实测 `env sudo find . -exec sudo rm -rf /etc {} ;`
  // 由 **allow → ask**，而主路径 `env sudo sudo rm -rf /etc` 仍是 allow；HEAD 亦为 allow）。
  // 同名时 F4 的放宽**本来就不存在**：授权面里的 `sudo` 是命令头前缀，不是载荷首层 ——
  // 两者在 `widened` 里是同一个字符串，无法区分，故这一格**保持既有行为**。
  // 判据因此是「命令头**有**提权前缀」且「载荷首层名字与它**不同名**」。
  if (headPrefix && first !== headPrefix && PRIV_PREFIXES[first] === 1) widen(first)
  if (PRIV_PREFIXES[first] !== 1) return first
  // 命令头推进下标：从段首（或语句关键字之后）的提权前缀开始。
  let i = start
  // ── 推进必须**循环**，不能只做一层（发现 2）────────────────────────────────────
  // 一层提权前缀之后**可能又是一层提权前缀**：`sudo su root kill 1234`、`sudo doas kill 1234`、
  // `sudo sudo kill 1234`。单步推进时 `privOperandSkip` 停在第二个前缀名上、`segmentLabel`
  // 随即把它当作命令头 label 返回，于是 labels 收束成前缀名 —— 组档（proc / power / reg）
  // **整体丢失**、用户显式写的 `kill *`=deny 例外同样被绕过。方向是 **fail-open**。
  // 实测（八档、proc/power/reg=deny、priv=allow，修复前）：
  //     kill 1234 / sudo kill 1234 / su root kill 1234   → deny（tiers 含 proc）
  //     sudo su root kill 1234                           → **allow** tiers=['priv']
  //     sudo doas kill 1234 / sudo pkexec kill 1234 / sudo sudo kill 1234 /
  //     doas su root kill 1234                           → 同上
  //     sudo su root reg delete HKLM\X /f（reg=deny）     → **ask**（组档丢失）
  // 判档侧本来是**对的**（`commandHeadEnd(['sudo','su','root','kill','1234'])` 正确推进到
  // `kill`），分叉只出在 label 侧 —— 故修法就是复用同一批推进步（`skipPrefixArgs` +
  // `privOperandSkip`，与 `headCommandNameOf` 交替推进同源）**循环**推进到真命令名。
  //
  // 收敛性：每轮至少推进一个词元（`skipPrefixArgs` 的返回值恒 ≥ `i + 1`，`privOperandSkip`
  // 只在前进时才被采纳），故 `guard <= w.length` 不可能漏判。
  //
  // ── ⚠️ 每轮**不得**调 `segmentLabel`（性能：那是 O(剩余词元数) 的切片，链长 n 时整体 O(n²)）──
  // 上一版在这里每轮取一次 `segmentLabel(w.slice(next))` 只为判断「这个名字是不是提权前缀」，
  // 于是 `sudo sudo … sudo kill 1234`（n 个 `sudo`）退化成平方 —— 实测 `segmentLabel`：
  // n=4000 → 4.69 ms、8000 → **16.91 ms**（倍率 3.6，标准平方），而修复前是 0.01 ms。
  // 触发形态是「提权前缀重复」这一族（AI 生成的命令里并非构造输入），且它在 `segmentLabels`
  // 热路径上（`isDestructiveSegment` 由 index.js 对每一段调用一次，同步早于弹窗）。
  // 故循环内只做 **O(1)** 的判据：`commandNameOf(w[i])` 查 `PRIV_PREFIXES`（与
  // `headCommandNameOf` 的前缀分支同表同判据）—— 它回答的正是「还要不要继续推进」，
  // 而命令头 label 只在链尾取**一次** `segmentLabel`（与修复前同一次数）。
  for (let guard = 0; guard <= w.length && i < w.length; guard += 1) {
    const cur = commandNameOf(w[i])
    // ── 推进判据：**提权前缀与 wrapper 都要继续**（发现 6 的修法）──────────────────────
    // 此前这里只认 `PRIV_PREFIXES`，遇到夹在两层提权前缀之间的 **wrapper** 直接 break，
    // 链被提前截断 → 真命令名永不进 labels → 组档（proc / power / reg）整体丢失、
    // 用户写的 deny 例外同样被绕过。方向是 **fail-open**。
    //
    // 判档侧（`commandHeadEnd` 的 ① 分支）本来就把 wrapper 与提权前缀**同处置**、照常推进
    // （`:2032` 的 `WRAPPERS[base] === 1 || PRIV_PREFIXES[base] === 1`），故这是
    // 「label 侧与判档侧各持一份口径」的分叉 —— 与发现 1/2 同族，修法就是让两侧同源。
    //
    // ⚠️ 这是设计文档 §5.3 的 `byHeadChain` 伪码原文（`blast-tier-plan.md:403-411`）：
    //     「是 WRAPPERS → 跳过它与其选项，**继续**」—— 实现只在 `commandHeadEnd` 一侧落实了。
    //
    // 实测（win32、`proc/power/reg=deny` + `priv=allow`，修复前）：
    //     sudo kill 1234                    → deny   labels=['sudo','kill']
    //     sudo time kill 1234               → deny   labels=['sudo','kill']
    //     sudo time sudo kill 1234          → **allow** labels=['sudo']       ← 链被截断
    //     sudo nohup sudo kill 1234         → **allow** labels=['sudo']
    //     sudo timeout 5 sudo kill 1234     → **allow** labels=['sudo']
    //     sudo env FOO=1 doas reg delete HKLM\X /f → **allow** labels=['sudo','doas']
    //     sudo time doas kill 1234          → **allow** labels=['sudo','doas']
    // 且 deny 例外同样被绕过：例外 `kill *`=deny 时 `sudo time sudo kill 1234` 是 allow。
    // 覆盖面：8 链首 × 12 夹层 × 5 第二层前缀 = 480 组合中 **360~420 条**丢失真命令名。
    //
    // ⚠️ 与 54t / 54t2 不重复（结构性照不出）：54t 的语料 48 组合里含 wrapper 者 **0**、
    // 54t2 的 54 组合里「wrapper 之后又是提权前缀」者 **0** —— 两族都只覆盖「第二层直接
    // 是前缀」，夹一层 wrapper 的形态无人覆盖。故本修法同时补 54y 那组断言。
    //
    // ⚠️ 边界：`time` 是**语句关键字**（不在 WRAPPERS 里）、`timeout` 的**时长位置参数**
    // 由 `skipPrefixArgs` 自己处理（`:1184`），两者都要覆盖 —— 见 54y 的语料。
    //
    // ⚠️ 性能纪律：**不得**在循环内调 `segmentLabel`（`:789-797` 的 O(n²) 教训）。
    // 本判据只有 `commandNameOf` + 两次查表，全是 O(1)，命令头 label 仍只在链尾取一次。
    // ── 前导 `NAME=value`：**不是**命令名，跳过后继续（E2 判据族第 7 个成员）────────────
    // 上面那个 break 判据只认三类（提权前缀 / wrapper / 语句关键字），而赋值词元三类都
    // 不是 ⇒ 循环**立即 break**、前缀链被截断、真命令名永不进 labels。
    // 触发形态是「**两层前缀之间**夹赋值」：`i=0` 的 `sudo` 把链推进到 `i=1`，循环第二轮
    // 就在 break 判据上撞到 `FOO=1`。两个兄弟函数的同源推进循环**都有这一支**
    // （`commandHeadEndFull:2874`、`headCommandNameOf:4124`）—— 本处是漏掉的第三个。
    // 实测（win32，八档同动作、proc/power/reg=deny、priv=allow，修复前）：
    //     sudo su root kill 1234        → deny  labels=['sudo','su','kill'] tiers=['proc','priv']
    //     sudo FOO=1 su root kill 1234  → **allow** labels=['sudo','su']  tiers=['priv'] ← 组档整族丢失
    // 且**不需要 `priv=allow`**：`index.js` 的真实档位缺省值
    // （八档一律「项目显式 → 全局显式 → ask」，见 destructiveTiers）+ 一条常规 deny 例外下
    // 就已分叉 —— 例外 `kill *`=deny 时
    // 本形态是 **ask**、对照是 **deny**；`diskpart*`=deny 同理 ⇒ 用户写的 deny 例外
    // 被「多写一个 `FOO=1`」降级。方向是 **fail-open**。
    //
    // ⚠️ 与已定案的赋值族**不重叠**：`ignored.md:122` / `design-issues.md` I4 / 测试 60j2
    // 记的是**单个前缀之后**夹赋值（走 label 侧 / `privOperandSkip` 操作数路径）；本条是
    // **第二层前缀之前**夹赋值、落在**链推进循环**上。实测 60j2 那六条**无第二层前缀**
    // （4 条 labels `[]`、2 条 `['su']`/`['runas']`）⇒ 两族不同源。
    //
    // ⚠️ 本行**必须放在 break 判据之前**：放在之后完全无效（labels 仍 `['sudo','su']`）——
    // 那时 `cur` 已经是赋值词元、break 先命中。
    //
    // ── ⚠️ 守卫 `i + 1 < w.length`：赋值词元**恰在链尾**时必须放行（本轮补）─────────────
    // 少了这个守卫，`<前缀链> <尾随赋值词元>`（`sudo A=/bin/rm`、`su A=/bin/rm`、
    // `sudo timeout 5 PATH=/usr/bin/rm` …）会跨过**最后一个**词元：循环因 `i >= w.length`
    // 退出、链尾那次 `segmentLabelFrom` 落空 ⇒ `return first` ⇒ 第二个 label **整体丢掉**。
    // 实测（`derived allow` + 例外 `rm *`=deny）：`sudo A=/bin/rm` 无守卫是
    // **`ask`/`['priv']`**（PRE 是 `deny`/`['inside','priv']`）；再加 `priv=allow` 时
    // 更从 PRE 的 `deny` 变成 **`allow`**。
    // 面（本处**自测**，对拍 PRE 基线 `9D3800EF…`）：52,908 格语料（4,409 条 × 12 配置）
    // 中动作放宽 **1,653** 格、档位移除 **9,648** 格、收紧 48 格 —— 且放宽格
    // **1,653/1,653 全部**满足「赋值词元是最后一个词元」（0 格例外）。
    // （上一轮验证者另用 4 元组全枚举报出 labels 收缩 57,228 / 档位移除 224,280 /
    // 动作放宽 68,724 格，同一族、方向一致；两组数字口径不同，不可混用。）
    //
    // ⚠️ **口径更正（不得再写「只收紧」）**：上一条 F1 报告里的
    // 「loosen 0 / tierRemoved 0 / labels 只增不减（CUR ⊄ FIX = 0）」在**该族上不成立**；
    // 且触发条件比报告更宽 —— **不需要 `priv=allow`**，派生默认 + 一条常规 deny 例外下
    // 就是 `deny → ask`。本守卫补上后该族回到 PRE **逐字同值**。
    //
    // ⚠️ PRE 那个第二 label（`rm`）本身是 `unwrapWordsFrom` 把**赋值右侧的 basename**
    // 当命令名产生的**假警告**（`sudo A=/bin/rm` 之后没有命令，shell 语义下不执行 `rm`）——
    // 但**不该由本行顺手消除**：赋值**恰在链尾**（`sudo A=/bin/rm`）与**不在链尾**
    // （`sudo A=/bin/rm kill 1234`、`sudo FOO=1 su root kill 1234`）是两种不同语义，
    // 无守卫的版本把前者**也**当成「链已到尾」而截断，属误伤（后者是本行要修的 fail-open 族）。
    // 「链尾赋值」族由 `test/shell-parse.mjs` 的 60j5 钉住（此前该族 grep `sudo A=` 命中 0、
    // 套件零鉴别力 ⇒ 会静默漂移）。
    //
    // 判据复用模块级 `LEAD_ASSIGN` **单点**（`:621`），与 `commandHeadEndFull` /
    // `headCommandNameOf` 两个兄弟推进循环里那一行**同形**（跨文件/跨版本引用一律用
    // 函数名而不是行号 —— 行号随实现漂移，函数名才是稳定锚点，与
    // `test/regressions.mjs:6927` 记的纪律同源）：
    // 无新正则、无分配、O(1)；`i + 1 < w.length` 只是一次整数比较，同为 O(1)。
    if (i + 1 < w.length && LEAD_ASSIGN.test(String(w[i]))) { i += 1; continue }
    if (!cur || (PRIV_PREFIXES[cur] !== 1 && WRAPPERS[cur] !== 1 && STATEMENT_KEYWORDS[cur] !== 1)) break
    // ── 语句关键字：跳过它继续（`time` / `!` / `then` …）──────────────────────────────
    // 任务点名 `time` 这一夹层：`sudo time sudo kill 1234` 与 `sudo timeout 5 sudo kill 1234`
    // **两类都要覆盖**。前者是关键字（`BASH_KEYWORDS.time`，**不在** `WRAPPERS` 里）、
    // 后者是 wrapper（`timeout` 的**时长位置参数**由 `skipPrefixArgs` 自己处理，见 `:1184`）。
    //
    // 为什么不能只靠链尾 `segmentLabel` 跳关键字：链尾只取**一次** label，
    // `segmentLabel(['time','sudo','kill','1234'])` 跳掉 `time` 后落在**第二个 `sudo`** 上，
    // 于是 `head === first` → `return first` → 链被截断（实测 labels=['sudo']、
    // tiers=['priv']、`sudo time sudo kill 1234` 在 proc=deny 下 **allow**）。
    // 故关键字必须在**推进阶段**就跨过去，与 wrapper 同一处置。
    //
    // 关键字**不进 labels**（它不是命令名）—— 这正是与上面「链上每层前缀名都进 labels」
    // 那一支分开写的原因：前缀名是收紧方向的证据（`su *`=deny 要能命中），
    // 而关键字是纯语法噪声（`time *`=deny 没有语义）。
    // 推进方式复用 `skipPrefixArgs`（处理 `time -p cmd` 的 `-p`），与 wrapper 分支同源。
    if (STATEMENT_KEYWORDS[cur] === 1) {
      let nx = i + 1
      try { const s = skipPrefixArgs(w, i + 1, cur); if (s > nx) nx = s } catch (e) {}
      i = nx > i ? nx : i + 1
      continue
    }
    // 链上**每一层**前缀名都进 labels（不只是第一层）：这是**收紧**方向 ——
    // 用户写的 `su *`=deny 在 `sudo su root kill 1234` 上照旧命中。第一层已由上面推过。
    //
    // ── ⚠️ 但**同名**那一层**不得**进 `widened`（本轮 F5 的补完）────────────────────────
    // `push(cur)` **不动**：链上每一层名字都进 labels 是**收紧**方向（deny 例外要看得见
    // `su` / `doas`），本修法一个字都不改它。
    //
    // `widen(cur)` 则必须与 `:992`（链尾）和 `:1063`（链首）**同一条判据**：`widened` 是
    // **按名字**判定的集合，而命令头那个前缀名**本来就该留在授权面里**（用户写 `sudo *`=allow
    // 正是要授权它）。当链上某一层的名字与命令头前缀**同名**时，`widen` 挪出授权面的其实是
    // **命令头那个名字** —— 过度收紧，且与主路径分叉。
    //
    // ⚠️ 上一版这里写的是**纯位置**判据 `cur !== first`，它只排除链首那一层，且方向是**反**的：
    // `cur === first` 时跳过 `widen`（该层是链首、恰是命令头前缀），而 `cur !== first` 的
    // **链中层**一律 `widen` —— 于是同名链中层（`env sudo find . -exec doas sudo {} ;` 的
    // 第二个 `sudo`）被挪出授权面，而它**就是**命令头前缀本身。实测（例外 `sudo *`=allow）：
    //     env sudo find . -exec doas sudo {} ;   HEAD=allow  **ask**  widened=['find','doas','sudo']
    //     env sudo find . -exec doas sudo rm -rf /etc {} ;     HEAD=allow  **ask**
    //     timeout 5 sudo find . -exec doas sudo {} ;           HEAD=allow  **ask**
    //     env doas find . -exec sudo doas {} ;   HEAD=allow  **ask**  widened=['find','sudo','doas']
    // 而**同一条提权链**的主路径 `env sudo doas sudo rm -rf /etc` 是 allow（授权面里 `sudo` 存活）
    // —— 同一条语义两个结论（不变量分叉），方向是**过度收紧**（非 fail-open）。
    // 覆盖面：4 flag × 6 链首 × 6 链中 × 4 外层 × 4 tail = 2304 格中 1440 格分叉
    // （本轮 F1 族语料实测：1920 格中 1440 格）。
    //
    // 判据是**名字比较**（`cur !== headPrefix`），与 `:992` / `:1063` 逐字同源 ——
    // 「同名时必须比名字，否则过度收紧」那条原则此前只落到了链首与链尾，链中层漏了。
    // ⚠️ 主路径的调用点（`segmentLabelsCore`）**刻意不传** `headPrefix`，故为 `undefined`，
    // `cur !== undefined` 恒真 → `sudo rm -rf /etc` 的既有行为**逐字不变**（54c2 的对照）。
    if (cur !== first) {
      push(cur)
      if (cur !== headPrefix) widen(cur)
    }
    const at = skipPrefixArgs(w, i + 1, cur)
    let next = at
  // ── `su` / `runas`：**操作数不是命令名**，推进步必须与命令头解析同源 ────────────────
  // 这两个前缀的带值选项表刻意留空（值本身可能是命令也可能是目标），故 `skipPrefixArgs`
  // 停在**操作数**上（`su root kill 1234` 的 `root`、`runas /user:admin kill 1234` 的
  // `/user:admin`），而真命令名还在它之后。此前这里只调 `skipPrefixArgs`，于是同一件
  // 提权语义**因前缀不同而分叉**：`sudo kill 1234` 能扩展出 `kill`，`su root kill 1234`
  // 不能 —— 方向是 **fail-open**。实测（八档、proc/power/reg=deny、priv=allow）：
  //     kill 1234               → deny   tiers=['proc']
  //     sudo kill 1234          → deny   tiers=['proc','priv']
  //     su root kill 1234       → **allow** tiers=['priv']  ← proc 档整个丢失
  //     runas /user:admin kill 1234 → **allow** tiers=['priv']
  // 三个组档（proc/power/reg）全部如此，且用户写的 deny 例外同样被绕过：
  // 例外 `kill *`=deny 时 `kill 1234`/`sudo kill 1234` 是 deny，`su root kill 1234` 是 allow。
  // 修法是复用 `commandHeadEnd` / `headCommandNameOf` 共用的那个推进步 `privOperandSkip`
  // —— 两处若各写一份，「命令头到哪儿」与「labels 有哪些」必然再次分叉（见该函数注释）。
  //
  // **只在确实跨过操作数时才扩展**：`privOperandSkip` 仅在「操作数之后确实是命令头元素」
  // 时才跨（`su root` / `su root ls` / `su -c C:/Windows` 一律不跨），故未跨过时保持原行为
  // —— 否则 `segmentLabel(['root'])` 会把操作数本身当成 label 加进来，正是 54b 钉住的反例。
  //
  // ── ⚠️ 但「没跨过」**不等于**「链到此为止」（发现 1 的另一半）────────────────────────
  // `privOperandSkip` 返回 `at` 有两种成因，此前被当成了同一种：
  //   ① `at` 位置**确实是操作数**，只是它后面没有命令头元素（`su root` / `su root ls` /
  //      `su -c C:/Windows`）→ 链到此为止，不把操作数/值当 label（54b 钉的反例）；
  //   ② `at` 位置**根本不是操作数**，它本身就是**命令头元素**（`su kill 1234` 的 `kill`、
  //      `su sudo kill 1234` 的 `sudo`、`su env kill 1234` 的 `env`、`su doas kill 1234`、
  //      `su time kill 1234`、`sudo su kill 1234`、`runas sudo kill 1234`）—— `isPrivOperandWord`
  //      对前缀 / wrapper / 语句关键字 / 吃目标的命令名一律返回 false，正是这一支。
  // ② 被误读成 ① 的后果是**整条链被提前截断、真命令名永不进 labels → 组档整体丢失**。
  // 方向是 **fail-open**。实测（八档、proc/power/reg=deny、priv=allow）：
  //     sudo kill 1234        → deny  tiers=['proc','priv']   labels=['sudo','kill']
  //     sudo su root kill 1234→ deny  tiers=['proc','priv']   labels=['sudo','su','kill']
  //     sudo su kill 1234     → **allow** tiers=['priv']      labels=['sudo','su']   ← proc 档整个丢失
  //     su sudo kill 1234 / su env kill 1234 / runas sudo kill 1234 → 同上
  // 且用户显式写的 deny 例外同样被绕过：例外 `kill *`=deny 时 `sudo kill 1234` 是 deny，
  // `sudo su kill 1234` 是 **allow**。
  //
  // 判档侧在同形态下本来是对的（`commandHeadEnd(['su','sudo','kill','1234'])` = 3、
  // `headCommandNameOf` = `kill`），分叉只出在 label 侧 —— 故修法是**继续推进**：
  // 只有「`at` 位置确实是操作数」才终止。
  //
  // 判据复用 `isPrivOperandWord` 单点（与 `privOperandSkip` 的入口判据同源，故两处不可能
  // 再分叉），且它是 **O(1)**（内部只做一次 `commandNameOf` + 常数上界的
  // `isTargetEatingNameIn`），不在循环内按剩余词元数计费 —— 见上面那段性能纪律。
  // **必须用 `isPrivOperandWord` 而不是 `isPrivOperandToken`**：后者会因 `-c` 而返回 false，
  // 于是 `su -c C:/Windows` 的值会被当成命令名加进 labels（`windows`）—— 那是 54b 防的误命中。
  // 推进的收敛性不变：`at >= i + 1 > i`，故 `i` 每轮至少推进一个词元。
    if (PRIV_VALUE_IS_COMMAND[cur] === 1) {
      if (next < w.length) { try { const s = privOperandSkip(w, cur, i + 1, next); if (s > next) next = s } catch (e) {} }
      if (next <= at) {
        let operand = false
        try { operand = isPrivOperandWord(w, cur, at) } catch (e) {}
        // ① 操作数 → 链到此为止，保持原行为（不把操作数/值当成 label）
        if (operand) return first
        // ② 命令头元素 → 继续推进（`i = at`），交给循环按前缀/wrapper 继续剥或到链尾取 label
        next = at
      }
    }
    if (next >= w.length) return first
    i = next
  }
  // ── 链尾取**一次**命令头 label（`i` 已推进到「不再是提权前缀」的位置）───────────────
  //
  // ── ⚠️ 必须走**下标入口**，不得写 `segmentLabel(w.slice(i))`（本轮 F2 的修法）──────────
  // 切片是 O(剩余词元数)，而 `segmentLabelsCore` 对**每个** `-exec` 都调一次本函数 ——
  // 段内 n 个 `-exec sudo cmd_i {} +` 累计 Σ(n−j) = **O(n²)**。实测 `isDestructiveSegment`
  // （index.js 的 buildCandidates 对每段调一次、同步早于弹窗）：
  //   n=1000 → 2.3 ms、2000 → 6.9、4000 → 84.7、**8000 → 599 ms**（倍率 2.9/12.4/7.1）；
  //   而**无前缀**的 `-exec cmd_i {} +`（本函数立刻 `return first`、根本不走这里）同规模
  //   0.6/0.9/1.8/3.7 ms（倍率 1.5/2.0/2.1，线性）—— 平方因子就是这次 `w.slice(i)`。
  // 触发形态 `find . -exec sudo … {} +` 是 AI 常写的常规写法，不是构造输入。
  // `segmentLabelFrom` 是 `segmentLabel` 的**唯一下标入口**（`segmentLabel(w)` 就是
  // `segmentLabelFrom(w, 0)`），语义与 `segmentLabel(w.slice(i))` 逐字等价 —— 同一份剥法
  // （`unwrapWordsFrom`），只是全程按下标推进、一次拷贝都不做。
  //
  // ⚠️ `headWordOnly` 是**载荷族**（`headLabelAt`）才传的：那条路径的既有口径是**单词**
  // label（54s），首词化在本函数内**只发生一次**（下面 `:1265` 的
  // `headWordOnly ? String(headRaw).split(' ')[0] : headRaw`）—— `out` 与 `widened`
  // 两个写入点拿到的都是这个已截断的值（**不是**由调用方的 `addLabel` 包装取首词：
  // 那个描述已失效，且 `addLabel` 是 `out` 的单点写入器，不该再叠一层语义）。
  // 主路径（`segmentLabelsCore` 那一支）不传，故 `reg delete` 的粒度照旧。
  const headRaw = segmentLabelFrom(w, i)
  const head = headWordOnly ? String(headRaw).split(' ')[0] : headRaw
  // 认不出（`su root` 只有操作数、`su -c C:/Windows` 的值是目标）→ 保持原行为，不扩展。
  if (!head || head === first) return first
  // **不把「已见过」当停止条件** —— `sudo sudo kill 1234` 的第二个 `sudo` 与第一个同名，
  // 但它**不是**命令头（真命令名 `kill` 还在后面）；在那里停下等于把发现 2 的缺陷换个
  // 形态留下（该形态实测正是 allow）。去重交给 `out` / `widened` 各自判。
  push(head)
  // **同时**进 `out`（并集：破坏性判定与组档照旧看得见它）与 `widened`（授权方向不认它）。
  // 链上的每一层扩展名都算 `widened`：`sudo su root kill 1234` 里 `su` 与 `kill` 都是
  // 「前缀之后才看得见的名字」，用户为普通 `kill` / `su` 写下的 allow 不得因此被放大。
  widen(head)
  return head
}

/**
 * 从一个段里提取**全部**参与破坏性判定的 label（主 label 在前）。
 *
 * 绝大多数段只返回一个（就是 segmentLabel 的结果）；只有 `find` 这类
 * 「选项携带命令」的形态会多返回。判定侧按「任一 label 命中即算命中」处理。
 *
 * **导出的理由**（原本刻意不导出）：档位判据 `tierSetOf` 的第二个参数就是它 ——
 * 「哪一档在管这一段」完全由 label 集合决定（组档看 label 属于哪一组），
 * 而调用方（宿主与测试）必须能拿到**与判定侧同一份** label 才能验证这一点。
 * 让调用方各自取 `segmentLabel` 的主 label 会漏掉合成 label（`find -delete` → `rm`）
 * 与提权前缀扩展（`sudo kill` → 额外一个 `kill`），正是本函数存在的意义。
 */
export function segmentLabels(words) {
  return segmentLabelsCore(words).labels
}

/**
 * `segmentLabels` 的**单一实现**，并把「前缀扩展出的 label」单独交回给调用方。
 *
 * 为什么要分开（安全）：前缀扩展（`sudo kill 1234` → 额外一个 `kill`）只论证了**收紧**方向
 * ——让破坏性名单与 deny 例外看得见 `sudo` 之后的真命令。但这份 labels 同时被**例外匹配**
 * 消费，而例外有 **allow** 动作：`resolveException` 拿扩展出的 label 去问宿主，用户为普通
 * `rm` 写下的 `rm *`=allow 就会命中 `sudo rm -rf /` —— 一条「允许删工作区内的文件」被静默
 * 提升成「允许经 sudo 删任意路径」。实测（两侧子设置动作完全等价，只有 label 扩展不同）：
 *
 *     sudo rm -rf /etc   → 改前 ask，改后 **allow**（source=exception，命中用户的 `rm *`=allow）
 *     sudo rm -rf /      → 同上
 *     sudo -u root rm …  → 同上
 *
 * 故**前缀扩展出的名字不得用于 allow 方向的授权**：调用方拿到 `widened` 后按方向取用
 * （deny/ask 可以用，allow 不可以）——`assessCommand` 的 `resolveException` 就是这么做的。
 * 破坏性判定（`isDestructiveSegment` / `tierSetOf` 的组档）与 `rawCommandNames` 用的是
 * 并集，两者都只往**收紧**方向走，故照旧用 `labels`。
 *
 * @returns {{ labels: string[], widened: string[], widenedSet: Set<string> }} `labels` = 主 label +
 *   全部扩展名（并集，去重）；`widened` = 其中**仅由提权前缀扩展**得来的那些（是 `labels` 的
 *   子集）；`widenedSet` = 同一集合的 `Set` 视图（**发现 2 的 O(1) 查询面**，见函数体内说明）——
 *   调用方一律用它判「某名字是不是扩展来的」，不得再对 `widened` 数组做 `indexOf`。
 *
 * ⚠️ **导出的理由**（原本刻意不导出，与 `segmentLabels` 同处置）：`widened ⊆ labels` 是授权方向
 * 的**安全不变量** —— `assessCommand` 的授权面是 `labels.filter(l => !widenedSet.has(l))`，
 * 若某个名字只进了 `widened` 而没进 `labels`，它就从两个集合里**同时消失**（判档与 deny 例外
 * 都看不见它）；反之若某个**扩展来的**名字漏进 `labels` 而没进 `widened`，它就会留在授权面里
 * 被用户为普通命令写下的 allow 命中（那正是本轮 F1 / F3 / F4 反复修的同一族缺陷）。
 * 两个集合由本函数**单点产出**，故这条不变量只能在这里被观测 —— 测试必须能同时拿到
 * `labels` 与 `widened`，`segmentLabels` 只交回前者。
 */
export function segmentLabelsCore(words) {
  const main = segmentLabel(words)
  const out = main ? [main] : []
  // 仅由「提权前缀之后」得来的名字。**与 out 分开维护**：见上面那段 allow 方向的安全说明。
  const widened = []
  // ── `widened` 的**并行 Set**（发现 2 的修法）────────────────────────────────────
  // `widened.indexOf(x)` 是 O(len)，而 `find -exec` 载荷族会为**每个** `-exec` 各推一个
  // 名字 —— 逐条**不同名**时段内 n 个 `-exec` 就是 O(n²)。实测（`sudo find . (-exec c_i {} +)×n`、
  // 逐条不同名、`segmentLabels` 单次）：n=1000 → 0.52 ms、2000 → 1.62、4000 → 5.50、
  // **8000 → 21.04 ms**（倍率 4.91，标准平方）；而同一个 payload 名时 `widened` 长度恒 1、
  // `indexOf` 退化成 O(1)，n=8000 仅 **1.42 ms**（线性）—— 平方因子就是 `indexOf`。
  // 本批改动**新引入** `widened` 概念（HEAD 无它），故这是本批的退化，不是既有问题。
  // 触发需 n ≥ 1000 个逐条不同名的 `-exec`（真实命令几乎不达），但修法**零行为变更**、
  // 且 `isDestructiveSegment` 在 index.js 的候选生成循环里对每段调一次、同步早于弹窗。
  // 维护纪律：**只经 `addWidened` 写入**（两处并行结构不可能漂移），读取一律用 `widenedSet.has`。
  const widenedSet = new Set()
  const addWidened = (name) => { if (name && !widenedSet.has(name)) { widenedSet.add(name); widened.push(name) } }
  // `out` 的 O(1) 写入单点（与 `addWidened` 同处置，见 `pushHeadLabels` 里发现 2 的说明）：
  // `out` 会随 `-exec` 个数线性增长，故查重**不得**用 `indexOf`。
  const outSet = new Set(main ? [main] : [])
  const addLabel = (name) => { if (name && !outSet.has(name)) { outSet.add(name); out.push(name) } }
  const u = unwrapWords(words)
  if (u.opaque || !u.words.length) return { labels: out, widened, widenedSet }
  const w = u.words
  // 判据用 `main`（segmentLabel 已解析出的命令名），**不是** `w[0]`。
  // segmentLabel 会跳过 STATEMENT_KEYWORDS（`time`/`!`/`then`…）与 ROUTER 选项找到真正的命令，
  // 而 unwrapWords 只剥 WRAPPERS（env/timeout/nice/xargs）。若这里看 w[0]，
  // `time find . -delete` 的 w[0] 是 `time` → find 分支不进入 → -delete 不被识别 →
  // 大分类 allow 时静默放行（实测：`find . -delete` 是 deny，`time find . -delete` 是 allow）。
  // ── 提权前缀之后的真命令名（§5.2）───────────────────────────────────────────
  //
  // `segmentLabel` 遇到提权前缀就**停在前缀上**，其后的真命令名进不了 labels：
  //     sudo kill 1234   → labels 只有 ['sudo']，kill 不可见   ❌
  //     nice kill 1234   → labels ['kill']                     ✅（unwrapWords 剥了 wrapper）
  //     env FOO=1 kill 1234 → labels ['kill']                  ✅（剥了赋值前缀）
  // 差别在于：wrapper 是**透明包装**（unwrapWords 会剥），而提权前缀不是（它改变权限）。
  //
  // 后果不只是组档漏判（`sudo kill 1234` 只命中 priv、漏掉 proc），还有一个**既有漏洞**：
  // 例外匹配用的是同一份 labels，于是用户写的 `kill *`=deny 拦不住 `sudo kill 1234`
  // （实测：大分类与子设置都设 allow、只靠例外拦时，`kill 1234` 是 deny 而
  //  `sudo kill 1234` 是 allow —— 用户显式写的拒绝被绕过）。这不是本计划引入的。
  //
  // `su` / `runas` 由 `pushHeadLabels` 内部经 `privOperandSkip` 跨过**操作数**后照常扩展
  // （54h / 54t2）—— 它们**不再被排除**。该排除曾经存在，理由是「值本身可能是命令或目标，
  // 照搬会取到 `root`、`user:admin` 这类非命令名，让例外误命中（方向是放宽）」；本次修复把
  // 「操作数」与「命令头元素」分开处理（`isPrivOperandWord` 单点判据），操作数照旧不进 labels、
  // 而操作数之后的真命令名**必须**进 —— 否则组档整体丢失、deny 例外被绕过（fail-open）。
  // 实测：`segmentLabels(['su','root','kill','1234'])` = `['su','kill']`、
  // `segmentLabels(['runas','/user:a','kill','1234'])` = `['runas','kill']`；
  // 而 54b 的反例仍然成立（`su root` → `['su']`、`su -c C:/Windows` → `['su']`）。
  //
  // **扫描位置是命令头**，不是段首固定下标：`time sudo kill 1234` 的 `w[0]` 是
  // 语句关键字 `time`，而 `main` 是 `sudo`（segmentLabel 已跳过关键字）。
  // 故按 `main` 的实际下标定位 —— 段首与语句关键字之后各试一次。
  //
  // `headLabel` = `pushHeadLabels` 交回的**命令头 label**（无扩展时为空串，下面回退到 `main`）。
  // 它只在上面那一支里被赋值，故「不新增调用」—— 见 find 闸门处的说明。
  let headLabel = ''
  {
    // ── 廉价预筛：**只有提权前缀才可能扩展出 label** ──────────────────────────────
    // `pushHeadLabels` 的第一步是 `commandNameOf(w[start])`，第二步是
    // `if (PRIV_PREFIXES[first] !== 1) return first`（现实现，见 `:841`）——
    // 即非提权前缀时它什么都不做。
    //
    // ⚠️ 这里曾经把判据引作 `if (PRIV_PREFIXES[first] !== 1 || PRIV_VALUE_IS_COMMAND[first]) return`
    // —— `|| PRIV_VALUE_IS_COMMAND[first]` 那一半已被本批修复**删除**（`su` / `runas` 现在
    // 照常扩展，见上面那段说明），引文已按现实现更正。结论「非提权前缀不会扩展」仍然正确
    // （`PRIV_VALUE_IS_COMMAND` 的两个键 `su` / `runas` 本身就在 `PRIV_PREFIXES` 里）。
    //
    // 而下面的 `findIndex` 是**对整段的全量扫描**，且对路由器命令**恒返回 -1**：
    // 它的判据是 `commandNameOf(词元) === main`，而路由器命令的 `main` 是**两词** label
    // （`git add`、`npm run`、`git commit`），`commandNameOf(任一词元)` 永远不等于它。
    // 于是这趟扫描是纯浪费，且每次 `segmentLabels` 都要重付一遍 —— 而
    // `isDestructiveSegment`（index.js 的 buildCandidates 对**每一段**调用一次）
    // 同步执行在 `pendingApprovals.set` 之前，直接推迟弹窗。
    // 实测 `isDestructiveSegment`（纯词元构造，200 次取均值）：
    //     git add + 200/1000/4000/10000 个文件 → 33.7 / 82.6 / 257.4 / 616.5 µs
    // 加守卫后这趟扫描完全不发生（`main` 不在表里即跳过），26 条判定对拍逐字一致。
    //
    // 判据用 `PRIV_PREFIXES[main]`（与 `pushHeadLabels` 内部第一步同表同判据），
    // 故守卫**不可能**跳过本会扩展的段；`su` / `runas` 的排除仍在函数内部（单一来源）。
    if (PRIV_PREFIXES[main] === 1) {
      const at = w.findIndex((t) => commandNameOf(t) === main)
      if (at >= 0) headLabel = pushHeadLabels(w, at, addWidened, addLabel)
    }
  }
  // ── find 分支的闸门必须看**命令头 label**，不是段首 label（发现 1）────────────────
  // 闸门原先写 `main !== 'find'`，而 `main` 是 `segmentLabel` 的结果 —— 段首是提权前缀时
  // 它就是**前缀名**（`sudo` / `su` / `runas` / `doas` / `pkexec` / `gsudo`），于是这里立刻
  // 早退，下面 `find -exec` / `-delete` 的**载荷族 label 合成整段被跳过**。
  // 而 `tierSetOf` 的组档（proc / power / reg）判据完全依赖这份 label（`GROUP_OF_LABEL`
  // 查表），于是这三档在带前缀时**静默消失**。方向是 **fail-open**。
  // 实测（八档钩子、win32、proc=deny + priv=allow，修复前）：
  //     find . -exec kill {} ;          labels=['find','kill']  tiers=['proc']         → deny
  //     sudo find . -exec kill {} ;     labels=['sudo','find']  tiers=['priv']         → **allow**
  //     su root find . -exec kill {} ;  labels=['su','find']    tiers=['priv']         → **allow**
  //     runas /user:a find . -exec …    labels=['runas','find'] tiers=['priv']         → **allow**
  //     doas find . -exec kill {} ;     labels=['doas','find']  tiers=['priv']         → **allow**
  // 同一份丢失还绕过 `inside=deny`（`sudo find ./build -delete` 在 `priv=allow` 下 allow）
  // 与用户显式 deny 例外（例外 `kill *`=deny 时无前缀是 deny、带前缀变 ask）。
  // 故闸门改用 `headLabel`（`pushHeadLabels` 的返回值）—— **不新增调用**，不额外遍历
  // （曾经试过「无条件先调 `headCommandNameOf(w)` 判闸门」，那会给每个段加一次前缀链遍历，
  // 54m 的线性断言随即抖动）。
  //
  // ⚠️ 放宽闸门**必须**同时把下面合成的 label 计入 `widened`（见那里的说明），否则
  // `sudo find / -delete` 会拿到 `['sudo','find','rm']` 而 `rm` 不在 `widened` 里 ——
  // 授权方向可见，用户为普通 `rm` 写的 `rm *`=allow 被提升成「允许经 sudo 删盘根」。
  const findHead = headLabel || main
  if (findHead !== 'find') return { labels: out, widened, widenedSet }
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
  if (!hasFindAction) return { labels: out, widened, widenedSet }
  // ── 前缀之后合成的载荷族 label 必须计入 `widened`（发现 1 的修法 3）──────────────
  // 上面那一段把闸门放宽到「命令头 label 是 find」之后，`sudo find / -delete` 会得到
  // `['sudo','find','rm']`，而这个 `rm` 是**载荷族合成**出来的（原词元里根本没有 `rm`）。
  // 若它不进 `widened`，授权方向（`resolveException` 的 allow 分支用 `labels` 滤掉 `widened`）
  // 就会看见它 —— 用户为普通 `rm` 写下的 `rm *`=allow 被**提升**成「允许经 sudo 删盘根/系统
  // 目录」。实测（例外 `rm *`=allow、其余全 ask）：`sudo find / -delete` 与
  // `sudo find C:/Windows -delete` 由 **ask → allow**，与 54c2 钉住的方向不变量直接冲突。
  // 判据是「这段确实带提权前缀」（`headLabel` 非空即说明扩展发生过），**不是**「find 之前
  // 有词元」：不带前缀时 `find . -delete` 的 `rm` 与 HEAD 逐字一致，不该被挪出授权面。
  // 不带前缀时 `find -delete` 的 `rm` 本来就该可被 `rm *`=allow 授权 —— 那是用户写下的
  // 真实意图（HEAD 亦然）。
  const synthWidened = !!headLabel
  // ── 命令头那个提权前缀**叫什么名字**（F4 的判据，空串 = 命令头不带提权前缀）────────────
  // 载荷族链首那一层是否进 `widened` 要按**名字**判：只有当它与命令头前缀**不同名**时，
  // 那个名字才是「因前缀之后才可见」的（= 该进 `widened`）。同名时授权面里那个名字
  // **就是命令头前缀本身**，`widen` 会把用户正当的授权一并挪走（过度收紧，见 `pushHeadLabels`）。
  //
  // 取值用 `main`（= `segmentLabel(words)`，段首主 label）：它在**五种**命令头形态下都恰好
  // 给出提权前缀名，且与 `headLabel` 的推进同源（实测）：
  //     `sudo find …`             → sudo      `env sudo find …`       → sudo
  //     `timeout 5 sudo find …`   → sudo      `sudo su root find …`   → sudo
  //     `su root find …`          → su        `runas /user:a find …`  → runas
  //     `time sudo find …`        → sudo（`time` 是语句关键字，segmentLabel 会跳过）
  //     `find …`（无前缀）        → find      → 查表不中 → 空串
  // 用 `PRIV_PREFIXES[main] === 1` 判据（与 `:1300` 的闸门同表同判据），故不会引入第二份口径。
  const headPrefixOf = PRIV_PREFIXES[main] === 1 ? main : ''
  for (let j = start + 1; j < w.length; j += 1) {
    const token = String(w[j])
    if (token === FIND_DELETE_FLAG) {
      addLabel('rm')
      if (synthWidened) addWidened('rm')
      continue
    }
    if (!FIND_EXEC_FLAGS[token]) continue
    // `-exec` 之后跟的是**一条完整命令行**，同样可以有前缀包装器 —— 必须复用 unwrapWords，
    // 否则 `find . -exec env rm -rf {} \;` 的 label 会取到 `env`，真正的 rm 不可见
    // （实测：`find . -exec rm` 是 deny，而 `-exec env rm` / `timeout 5 rm` / `nice rm` → allow）。
    // 这与主 label 路径（segmentLabel 靠 unwrapWords 剥前缀）口径一致。
    //
    // ── ⚠️ 但只剥 wrapper 是**不够**的：提权前缀链也必须推进（发现 1）─────────────────
    // 原实现只取「`-exec` 之后的第一个命令名」，于是 `-exec` 载荷里的**提权前缀**被当成
    // 命令名收下、真命令名永不进 labels：
    //     find . -exec kill {} ;          labels=['find','kill']  tiers=['proc']        → deny
    //     find . -exec sudo kill {} ;     labels=['find','sudo']  tiers=['priv']        → **allow**
    //     find . -exec env sudo kill {} ; labels=['find','sudo']  tiers=['priv']        → **allow**
    //     find . -execdir doas kill {} ;  labels=['find','doas']  tiers=['priv']        → **allow**
    //     find . -exec su root kill {} ;  labels=['find','su']    tiers=['priv']        → **allow**
    // 对照 `sudo find . -exec kill {} ;` 是 `['proc','priv']`/deny（54s 已修）。
    // power / reg 两组同样，且**用户写的 deny 例外同样被绕过**（例外 `kill *`=deny 时
    // `find . -exec kill {} ;` 是 deny、`find . -exec sudo kill {} ;` 是 allow）。
    // 方向是 **fail-open**。触发需用户按 §3.3 单独把 `priv` 设 allow（与 54s/54t 同前提）。
    //
    // 修法：**复用主路径的前缀链推进**（`skipPrefixArgs` + `privOperandSkip`，与
    // `commandHeadEnd` 的 ① 分支 / `pushHeadLabels` 同源）—— 五处若各写一份，
    // 「命令头到哪儿」与「labels 有哪些」必然再次分叉（那正是本文件反复要修的那类缺陷）。
    // 从 `j + 1` 起推进到链尾，再取命令头 label。
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
    //
    // ⚠️ 前缀链推进**必须也走快路径之外**（下面两条分支共用同一个「取命令头 label」的
    // 推进步 `headLabelAt`）：否则 `-exec sudo kill` 这类**无 wrapper 但带提权前缀**的
    // 形态（正是发现 1 的主角）会落回「只取第一个词元」。
    const firstTok = String(w[j + 1] == null ? '' : w[j + 1])
    // ── `widened` 的登记**全部由 `pushHeadLabels` 内部完成**（这里不再补一遍）────────────
    // 曾经的写法是「这里再判一次『载荷链是否发生了前缀扩展』并 `addWidened(cand)`」，
    // 而那是**冗余**的：`pushHeadLabels` 对链上每一层扩展名都会调 `widen(...)`
    // （`find . -exec sudo rm -rf {} +` 的 `rm` 在推进到链尾时已进 `widened`）。
    // 实测（变异消融：把那一行改成 `if (cand && synthWidened) …`）**0 断言失败** ——
    // 正说明它是死代码。故删掉，让授权方向只有一个守卫点（`pushHeadLabels` 的 `widen`），
    // 避免「两处判据看似都在守、实则只有一处生效」的假守卫。
    // ⚠️ 被删掉的那个判据当时写作「`headLabelAt` 的返回值 `advanced`」—— 而 `headLabelAt`
    // 的 `@returns` 是 `{string}`、**从未**返回过 `advanced`（该标识符全文件仅此一处，
    // HEAD 为 0 处）：那是对一个不存在的返回值的引用。`pushHeadLabels` 内部既已按
    // 「链上每一层扩展名」逐个 `widen`，这里也就不再需要那个标志位。
    // ⚠️ 唯一**不**经 `pushHeadLabels` 的是 `-delete` 合成的 `rm`（原词元里根本没有 `rm`），
    // 它由上面 `synthWidened` 那一支单独登记 —— 那条是必需的（54u 钉住的方向不变量）。
    if (!/^[A-Za-z_][A-Za-z0-9_]*=/.test(firstTok) && WRAPPERS[commandNameOf(firstTok)] !== 1) {
      // 快路径：首个词元不是赋值前缀、也不是 wrapper。仍然要推进**提权前缀链**
      // （`-exec sudo kill` / `-exec su root kill`）—— 判据与主路径同源，且是纯下标推进。
      headLabelAt(w, j + 1, addWidened, addLabel, headPrefixOf)
    } else {
      // 慢路径：首个词元是赋值前缀或 wrapper，必须先剥掉它们（`-exec env sudo kill`、
      // `-exec timeout 5 sudo kill`）再推进前缀链。
      //
      // ── ⚠️ 走**下标内核**，不得写 `w.slice(j + 1)` 再 `unwrapWords(...)`（本轮 F2 的修法）──
      // 那两处切片各是 O(剩余词元数)，段内 n 个 `-exec env sudo cmd_i {} +` 累计 **O(n²)**。
      // 实测 `isDestructiveSegment`（`-exec env sudo cmd_i {} +`×n）：
      //   n=1000 → 8.5 ms、2000 → 31.3、4000 → 350.2、**8000 → 1925 ms**（倍率 3.7/11.2/5.5）；
      //   改成下标版后同规模 2.4/8.9/142.4/764.6 ms —— 剩下的平方来自别处（见下），
      //   而这两处切片本身已归零。
      // `unwrapWordsFrom(w, j + 1).base` 与原来 `j + 1 + (rest.length - u2.words.length)`
      // **逐字同值**：被剥掉的词元数就是游标相对 `j + 1` 的位移（两者共用同一份剥法，
      // 见该函数的说明）。opaque 与「剥到空」两种出口照旧 `continue`。
      const u2 = unwrapWordsFrom(w, j + 1)
      if (u2.opaque || u2.base >= w.length) continue
      headLabelAt(w, u2.base, addWidened, addLabel, headPrefixOf)
    }
  }
  return { labels: out, widened, widenedSet }
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
    if (FIND_EXEC_FLAGS[token] === 1) break
    if (valueFlags[token]) j += 1
    j += 1
  }
  // timeout 的时长位置参数（`timeout 5 sudo rm -rf /`）
  if (name === 'timeout' && /^[0-9]+(?:\.[0-9]+)?[smhd]?$/.test(String(w[j] == null ? '' : w[j]))) j += 1
  return j
}

// `su` / `runas` 的选项里，**值本身可能是命令或目标**的那几个（见 PRIV_VALUE_IS_COMMAND 与
// PRIV_VALUE_FLAGS 里刻意留空的 `su: {}` / `runas: {}`）。`skipPrefixArgs` 因此**不会**吃掉
// 它们的值，于是那个值会停在「前缀之后」的位置上 —— 判据必须能认出「这是值，不是操作数」。
const PRIV_COMMAND_VALUE_FLAGS = dict({ '-c': 1, '--command': 1 })

/**
 * `t` 是否是这个「值本身即命令或目标」的选项（`-c` / `--command` / `--command=…`）。
 *
 * 两处调用点的**极性相反**（`privValueFlagBetween` 命中即返 true，`isPrivOperandWord`
 * 命中即返 false），那是**两个不同问题共用一条判据**的正常结果 —— 但判据本身只有一份，
 * 故抽成单点：往 `PRIV_COMMAND_VALUE_FLAGS` 里加一项（如 `-C`）时两处自动同时生效。
 *
 * ── ⚠️ 但「一份判据」**不等于「两个极性收同样宽窄」**（此处一度按后者收敛，是 fail-open）──
 * `--command=<值>` 这种**等号连写**形态只对 `privValueFlagBetween`（门控侧）成立：
 *   · 门控侧问的是「前缀的选项里有没有『值即命令』的那一项」—— 连写形态的**值就在词元里**，
 *     是同一件事的另一种写法，故**必须**认（`su --command=x C:/Windows` 的值是 `x`）。
 *   · 操作数侧问的是「这个词元是不是**值选项自身**」—— 判据的用途是让贪婪扫描**停下**。
 *     连写形态在这里停下是**错的**：它后面那个词元才是真命令，扫描一停 `privOperandSkip`
 *     就收束、`commandHeadEnd` 停在 **1**，真命令与真目标**一起**被排除在命令头之外，
 *     段级 blast 归 `null` → 半径档落 `inside`。
 *
 * 实测（win32，语料 = `-c`/`--command`/`--command=<值>` 全族 × {`su` / `sudo su` / `runas` /
 * `runas … /noprofile`} × 8 目标 + 同形态对照，共 915 条 × 8 组档位配置 = **7320 格**；
 * 对拍基线 = 本文件**仅把本行改回窄判据**的副本，SHA256 `C4B30241…`，逐格比 blast/tiers/动作）：
 * 把连写形态带进操作数侧后，**放宽方向 540 格、收紧方向 0 格** —— 全部是
 * `su root --command=<任意值> …` 一族：`priv=allow` 下由 ask 变 **allow**、
 * `outside=deny` 下由 deny 变 **ask**、`outside=deny+unknown=deny` 下由 deny 变 **allow**。
 * 触发形态**不限于空值**：`--command=x`、`--command=rm`、`--command==`、`--command=rm ` 全部命中
 * （实测 `commandHeadEnd`：`su root --command=x rm -rf /tmp` 窄判据 **4** → 宽判据 **1**）。
 * 同族还有 `sudo su root --command=…`（`headEnd` 5→2）与 `runas /user:a --command=…`（4→1）。
 *
 * ⚠️ **「两个极性收不同宽窄」现在由调用点各自判连写形态承担，本函数只留窄判据** ──────────────
 * 曾经本函数带一个**布尔形参 `joined`** 来区分调用点，而**两个真实调用点全传 `false`**
 * （唯一一处 `true` 在注释里，描述「原实现」）—— 于是 `joined && t.indexOf('--command=') === 0`
 * **恒不可达**，形参与 `@param` 的「仅门控侧为真」都与实现不符（死形参）。
 * 门控侧的连写支现在由 `privValueFlagBetween` **自己**判（它另有 `mayYieldRadiusTier` 守卫，
 * 见那里的说明），操作数侧照旧只认精确的 `-c` / `--command`。
 * ⚠️ **不得**改成「操作数侧也传 `true`」（即恢复无条件认连写形态）：实测三套件 FAIL(1)，
 * `badTiers3` 14 条 + `badCross3` 8 条由 ask 变 **allow**（`su --command=x root kill 1234` 一族），
 * 是**重新引入 fail-open**。
 *
 * **必须保持「查表 + 一次 `indexOf`」的 O(1) 形态**：`isPrivOperandWord` 在
 * `privOperandSkip` 的贪婪扫描里**逐词元**调用（见那里的性能注释），故此处
 * **不得引正则、不得分配**（`String(t)` 由调用方各做一次，本函数只收字符串）。
 * 去掉死形参后两处调用点各少一次实参求值，形态比收敛前更窄。
 *
 * @param {string} t 已 `String()` 过的词元
 * @returns {boolean}
 */
const isPrivCommandValueFlag = (t) => PRIV_COMMAND_VALUE_FLAGS[t] === 1

/**
 * `runas` 的**不含 `:` 开关**白名单（`isRunasSwitchShapedWord` 的第二条判据）。
 *
 * ── 为什么需要一张白名单 ─────────────────────────────────────────────────────
 * `runas` 的开关里只有 `/user:`（与 `/trustlevel:`）带 `:`，其余 8 个**不含 `:`**
 * —— 于是它们与**单段 POSIX 路径**（`/etc`、`/tmp`）**词法完全同形**，词法层面无法区分：
 *     runas /profile /savecred /user:admin rm -rf /tmp   ← `/savecred` 是开关，该跨
 *     runas /noprofile /etc rm                           ← `/etc` 是目标，**不该跨**
 * 上一版按「单段 `/x` 一律算开关」处理，把后者也跨了 → 真目标被跨过 → 段级 blast 归 null
 * → 档位落 `inside`（fail-open，实测见 `isRunasSwitchShapedWord`）。
 *
 * 故只能**枚举**：本表就是 `runas` 官方语法里全部不含 `:` 的开关
 * （`runas [/noprofile | /profile] [/env] [/netonly | /savecred] [/showtrustlevels]
 * [/trustlevel:<n>] /user:<名> <程序>`）。
 *
 * ── ⚠️ 漏加一项的方向是 **fail-open**（此处注释一度写成「偏保守」，实测为误）──────────
 * 本表的成员在命令头推进里是**必跨**项：漏掉一项**不会**「停在开关上」（那不是偏保守），
 * 而是让 `privOperandSkip` 的扫描在那一项上提前收束、`commandHeadEnd` 停在 **1** ——
 * 真命令与真目标**一起**被排除在命令头之外，段级 blast 归 `null` → 半径档落 `inside`。
 * 实测（win32，插桩 `commandHeadEnd`）：
 *     `runas /noprofile /savecred /user:a rm -rf /tmp`
 *       现状 `headEnd=5`、`blast=outside|/tmp`；
 *       删掉 `/savecred` 一项后 `headEnd=1`、`blast=null`（与「整段判不出」同值）。
 * 逐项删除本表 8 个成员实测：**7 项**（`/noprofile` `/profile` `/savecred` `/netonly`
 * `/smartcard` `/showtrustlevels` `/trustlevel`）删掉后都产生**新的静默放行** ——
 * 端到端 `priv=allow` 时由 `ask` 变 `allow`、`outside=deny` 时由 `deny` 退成 `ask`；
 * 只有 `/env` 无影响：它与 `WRAPPERS` 同名，`runas` 支在它上面本就走 wrapper 路径
 * （HEAD 即如此，属既有行为，不是本表的功劳）。
 * `/trustlevel` 在官方语法里写作 `/trustlevel:<n>`（带 `:`，由 `:` 支覆盖），
 * 但不带 `:` 的写法只有本表能覆盖 —— 实测删掉它同样 fail-open，故**不是**冗余项。
 *
 * 故「新增开关必须同步本表」是**硬约束**，且必须由测试守护：
 * `test/shell-parse.mjs` 的 **54r** 按**官方开关全表 × 非首位**穷举断言
 * （54o 只覆盖首位形态，靠 `privOperandSkip` 的 `k === at` 那一支通过，**照不出非首位的漏项** ——
 * 实测删掉 `/env` `/smartcard` `/showtrustlevels` `/trustlevel` 四项时旧语料仍全绿）。
 *
 * ⚠️ **不能改成「凡是不在已知路径名单里的单段 `/x` 都算开关」**：那是把本表的语义反过来。
 * 本表是**有限枚举**（漏一项 = 漏一个开关，且可由 54r 穷举守护），
 * 而路径空间**无上界**（`/zzz`、`/myapp`）—— 名单永远补不全，漏一个就是把**真目标**
 * 当开关跨过。该替代方案实测是本批引入的硬回归（见 `isRunasSwitchShapedWord` 里
 * 「上一版按单段 `/x` 一律算开关」那组：posix 侧 `runas /noprofile /etc rm` 由 HEAD 的
 * `system|/etc` 变 `null`）。两个方向**都是 fail-open**，取舍依据是「可枚举、可穷举守护」
 * 对「不可枚举」—— 不是「一个保守、一个不保守」。
 *
 * 大小写：`runas` 开关本身大小写不敏感（`/NOPROFILE` 同样合法），故查表前统一 `toLowerCase()`。
 */
const RUNAS_SWITCHES = dict({
  '/noprofile': 1, '/profile': 1, '/savecred': 1, '/netonly': 1,
  '/env': 1, '/smartcard': 1, '/showtrustlevels': 1, '/trustlevel': 1,
})

/**
 * `su` / `runas` 之后那个词元是不是**操作数**（用户名 / cmd 风格开关）而不是命令名？
 *
 * ── 为什么必须单独判 ──────────────────────────────────────────────────────────
 * `PRIV_VALUE_IS_COMMAND` 把这两个前缀标成「值本身可能是命令或目标」，故 `commandHeadEnd`
 * 对它们只在值命中 `isDestructiveLabel` 时才吃掉。那条判据对**判档**是对的，而命令名解析
 * （`headCommandNameOf`）若停在同一位置，就会把**操作数**当成命令名返回：
 *     su root rm -rf /data      → 查到 `root`
 *     runas /user:admin rm -rf /data → 查到 `user:admin`
 * 下游 `isCmdStyleSwitch` 认不出这个名字 → 走「认不出命令名 ⇒ 不消费半径 ⇒ 当开关」的兜底
 * → `/data` 被当开关跳过 → 段级 blast 归 null → 档位 `inside` → 提权档设为 allow 时
 * **静默放行**。实测（win32、priv=allow）：上面两条与 `runas /user:admin del /data` 全部
 * allow，而对照 `sudo -u root rm -rf /data` 是 ask —— 同一件事只因前缀不同就分叉。
 *
 * 影响面**不含盘根**：`su root rm -rf /` 仍是 ask（`/` 的 `charAt(1)` 为空，不命中
 * `/[a-z]/i` 那条开关判据，交回判档 → drive-root → wide）。失效的是**多字母单段路径**
 * （`/data`、`/zzz`）这一类。
 *
 * 判据（四条同时成立才算操作数）：
 *   · 前缀是 `su` / `runas`（`PRIV_VALUE_IS_COMMAND` 的成员）；
 *   · `skipPrefixArgs` 停在 `next`，且途中**没有**吃掉 `-c` / `--command` ——
 *     那些选项的值本身就是命令或目标（`su -c C:/Windows` 的值就是目标），跳掉它会把
 *     system 警告整个吃掉（该函数的注释里记着 7 种形态的实测）；
 *   · `w[next]` 不是命令头元素（wrapper / 提权前缀 / 语句关键字）—— 那些由各自的判据处理
 *     （`su env FOO=1 rm -rf /data` 的 `env` 必须继续走 wrapper 分支）；
 *   · `w[next]` 不是破坏性命令名（`su rm -rf /data` 的 `rm` 就是命令，必须留在命令头里）。
 *
 * **本判据由 `commandHeadEnd` 与 `headCommandNameOf` 共用**：两处若各写一份，
 * 「命令头到哪儿」与「命令名是谁」必然再次分叉 —— 那正是本次缺陷的成因。
 *
 * @param {string[]} w 词元列表
 * @param {number} from `skipPrefixArgs` 的起点（前缀命令名之后的下标）
 * @param {number} upto `skipPrefixArgs` 的返回值（停在哪儿）
 */
function privValueFlagBetween(w, from, upto) {
  // ── 连写支（`--command=<值>`）的**守卫**：只在「确有目标可保护」时才认它 ──────────────
  //
  // 本函数返 `true` ⇒ `isPrivOperandToken` 返 `false` ⇒ `privOperandSkip` **不跨**操作数
  // ⇒ 命令头停在 `at` ⇒ `at` 及其后词元留在命令头**之外**参与判档。
  //
  // 原实现无条件认连写形态（那时 `isPrivCommandValueFlag` 还有一个 `joined` 形参、这里传
  // `true`），于是**值选项写在操作数
  // 之前**的畸形形态把操作数一起挡在命令头外，而 `commandHeadEnd` 停在 `2`、
  // `headCommandNameOf` 取回那个**值选项词元本身**（`--command=x`）→ 下游
  // `isCmdStyleSwitch` 认不出这个命令名 ⇒ 走「不消费半径」兜底 ⇒ 真目标（`/tmp`）
  // 被当 cmd 开关跳过 ⇒ 段级 blast 归 `null` ⇒ 半径档落 `inside` ⇒ `priv=allow` 时
  // **静默放行**。实测（win32、插桩 `commandHeadEnd` / `privValueFlagBetween`）：
  //     `su --command=x root rm -rf /tmp`   flag=true  headEnd=**2** headName=`--command=x`
  //                                        blast=null|priv（priv=allow → **allow**）
  //     对照 `su root rm -rf /tmp`           flag=false headEnd=3  headName=`rm`
  //                                        blast=outside|/tmp（**ask**）
  // 同族：`sudo su --command=x root rm -rf /tmp`（headEnd 2 vs 4）、
  //       `su --command=x root diskpart`（tiers `priv` vs `unknown,priv`，unknown=deny 下
  //       **allow vs deny**）、`su --command=x root kill 1234`（**proc 档整个丢失**）、
  //       `su --command=x root reg delete …`（**reg 档整个丢失**）；
  //       `--command=` / `=x` / `=rm` / `==` 全部同样命中。
  //
  // ── 但**不能**简单地改回 `joined = false`（那是把这条闸开过头，实测有放宽）────────────
  // 直接不认连写形态 ⇒ 操作数无条件被跨过 ⇒ 而 `upto` 位置可能正是**真路径目标**：
  //     `su --command=x C:/Windows rm`  连写不认 ⇒ 跨过 `C:/Windows` ⇒ 它落进命令头、
  //     不再判档 ⇒ blast 由 `system|C:/Windows`（wide=ask → **ask**）变 `null|inside`
  //     （priv=allow → **allow**）—— 方向 fail-open，正是本文件反复要堵的那类漏报。
  //     同族：`su --command=x /etc rm`、`su --command=x ~ rm -rf /tmp`、
  //     `su --command=x C:/Windows diskpart`、`sudo su --command=x …` 全套。
  // 实测（语料 95,640 条 × 31 档位配置 × 2 平台 = **3,347,400 格/变体**，逐格比
  // blast / tiers / 端到端 action）：无条件不认连写形态 ⇒ **放宽 21,018 格**、收紧 45,966 格。
  //
  // ── 故判据是「**该位置本来会不会被判档**」——它给出「放宽 = 0」的**结构性**保证 ─────────
  // 守卫取 `mayYieldRadiusTier(w[upto], undefined)`（判据本身在 `mayNeedBlastCheck` 旁边，
  // 与判档循环的三条产档路径同源）。
  //
  // ── ⚠️ 本守卫**不能**只取 `mayNeedBlastCheck`（曾如此，是**真实放宽**，实测已推翻）──────
  // 上一版守卫只问 `mayNeedBlastCheck(w[upto], undefined)`，理由是「它是判档循环的
  // **必要条件**（`if (!mayNeedBlastCheck(token, opts && opts.platform)) continue`），
  // 故返假 ⇒ `upto` 本来就被 `continue` 跳过 ⇒ 跨不跨都不产生半径档」。
  // **该论证不成立**：那条 `continue` 在循环里**不是第一条产档路径**，它前面还有两条
  // 同样会产出半径档的分支，而它们对「纯词元」形态照样成立、`mayNeedBlastCheck` 却返假：
  //   · 含空格词元的**引号命令行递归支**（`:4922-4963`）——`token.indexOf(' ') !== -1`
  //     且切分后首词是破坏性命令名或解释器（`NESTED_SHELLS`）时，递归判档并 `continue`；
  //   · **`NAME=value` 支**（`:4975-4986`）—— 取 `=` **右侧值**再判档并 `continue`。
  // 于是「`mayNeedBlastCheck` 返假」**推不出**「跨过它不丢半径档」，守卫返假 ⇒
  // `privOperandSkip` 跨过 `upto` ⇒ 该词元落进命令头、**不再判档**。
  //
  // 实测（win32、priv=allow，CUR = 本文件，PRE = `mayNeedBlastCheck` 版守卫）：
  //     su --command=x "rm -rf Windows" rm   PRE=`system|Windows`+`wide,priv`（**ask**）
  //                                          CUR=`null`+`inside,priv`（**allow**）
  //     su --command=x FOO=Windows rm        同上（`system|Windows`/ask → `null`/allow）
  //     su --command=x "cmd System32" rm     同上（`system|System32`/ask → `null`/allow）
  // 插桩：`mayNeedBlastCheck('rm -rf Windows', undefined)` = **false**、
  //       `mayNeedBlastCheck('FOO=Windows', undefined)` = **false**，
  //       而 `blastRadiusOfSegment(['su','--command=x','rm -rf Windows','rm'])` PRE 有值、
  //       CUR 为 null。覆盖全部 BARE 系统目录名 × {引号命令行、`cmd <BARE>`、`NAME=<BARE>`}
  //       × 前缀链（`su`/`sudo su`/`doas su`/`pkexec su`）。
  //
  // 修法是**补上那两条产档路径**（而不是把守卫改回无条件 `joined = false`，那条已实测
  // 放宽 21,018 格）：`mayYieldRadiusTier` 把三条路径合并成一条**上界**判据 ——
  // 含空格词元一律视为「会判档」（引号支的收窄需要 split + 逐词查表，与 O(1) 纪律冲突，
  // 且收窄方向是放宽）、`NAME=value` 形态取右侧值再问同一个预筛、其余照旧走预筛。
  // 上界判据返真 ⇒ 更少跨越 ⇒ 只会收紧。
  //
  // `platform` 传 `undefined` 是**有意的 fail-safe 方向**：`privValueFlagBetween` 拿不到
  // `opts`（签名与调用链 `privOperandSkip` ← `commandHeadEnd` ← `blastRadiusOfSegment`
  // 都不传平台，与 `isOperandShapedWord` 同一处境），而平台未知时 `mayNeedBlastCheck`
  // **两张表都查** ⇒ 判据比 win32 / posix 任一分支都**更宽** ⇒ 更多词元走「确有目标」支
  // ⇒ 更少跨越 ⇒ 更接近现状（放宽方向的错误恰是「该守的没守」，故这里宁宽勿窄）。
  //
  // ⚠️ 这一支**不得**带到 `isPrivOperandWord` —— 见 `isPrivCommandValueFlag` 的说明。
  //
  // ── ⚠️ 如实记录：本口径与**真实 `su` 语义**不一致（本实现**故意**取保守侧）──────────────
  // 真实 `su` 里 `--command=<值>` 的值**就是**要执行的命令，故
  //     su --command=x root rm -rf /tmp
  // 的真实语义是「以 `root` 身份执行 `x`，把 `rm -rf /tmp` 当作 `x` 的**参数**」——
  // `rm` **不会**被执行，因此「CUR 判 `null`」按真实语义读**并非漏报**。
  // 本实现仍按「连写形态后面那个词元才是真命令」的口径处理（即 finding 的口径），
  // 理由是**同一文件里另一处已经这样承诺**：操作数侧（`isPrivOperandWord`，见
  // `isPrivCommandValueFlag` 的注释）只认精确的 `-c` / `--command`，且写着「连写形态在这里
  // 停下是**错的**：它后面那个词元才是真命令」。两处口径相反会比本缺陷更糟 ——
  // 「命令头到哪儿」与「命令名是谁」必然分叉，那正是本文件反复要修的那类缺陷。
  // 故本支的方向是**故意偏保守**：真实语义下该形态会被**多问一次**（收紧方向，
  // 永不违反策略）；代价是畸形写法会弹窗，收益是「同一文件只有一份口径」。
  // 若日后决定改用真实 `su` 语义，需要动的是**这一处**与操作数侧那一处（两处必须同时改，
  // 否则又回到分叉状态）。
  //
  // 成本：`mayYieldRadiusTier` 在一次调用里**至多算一次**（`joinedProtects` 记忆化），
  // 且只在真的遇到连写词元时才求值；无正则新增、无分配 —— 与 `isPrivOperandWord` 的
  // 「查表 + 一次 `indexOf`」同一条 O(1) 纪律（见 `isPrivCommandValueFlag` 的性能段）。
  let joinedProtects = -1
  for (let k = from; k < upto; k += 1) {
    const t = String(w[k])
    if (isPrivCommandValueFlag(t)) return true
    if (t.indexOf('--command=') === 0) {
      if (joinedProtects < 0) {
        joinedProtects = upto < w.length && mayYieldRadiusTier(String(w[upto]), undefined) ? 1 : 0
      }
      if (joinedProtects === 1) return true
    }
  }
  return false
}

/**
 * 路由器命令的**两词 label**（`reg` + `delete` → `reg delete`）—— 与 `segmentLabel`
 * 的 router 分支同口径：跳过选项与带值选项，取第一个非选项词元作子命令。
 *
 * 为什么单独抽出来（而不是留在 `privOperandSkip` 里当闭包）：`isPrivOperandWord`
 * 也要用它 —— 见 `isTargetEatingNameIn` 的说明。两处若各写一份「什么算两词 label」，
 * 「操作数跨到哪儿」与「label 有哪些」必然分叉，那正是本次缺陷的成因。
 *
 * 与 `segmentLabel` 的 router 分支的**唯一**差别：那里只看选项**形态**
 * （`raw.startsWith('-')`），这里额外滤掉含空白的词元与认不出的词元（与
 * `commandHeadEnd` / `segmentLabel` 对「引号包起来的整条命令行」的判据一致），
 * 故 `su root reg "a b"` 不会拼出假 label。
 *
 * 成本：首行即有 `ROUTER_CMDS` 守卫（非路由器命令立即返回空串），
 * 且下面的扫描有**常数上限**（见 `ROUTER_SUB_SCAN_MAX`）—— 故调用方在任何输入下都是 O(1)。
 *
 * ── 为什么必须加上限：调用方是**逐词元**的贪婪扫描（发现 3）────────────────────────
 * `isTargetEatingNameIn` 由 `isPrivOperandWord` 对**每一个**词元各调一次，而本函数此前
 * 从该下标**向后扫到段尾**（`for (let t = idx + 1; t < w.length; …)`）—— 两者相乘即 O(n²)。
 * 触发形态是「`su` 后跟『路由器名 + `ROUTER_OPT_VALUE` 带值选项』的重复序列」，
 * 且**路由器名必须写成路径形态**（`/reg --config /reg --config …`）：裸名 `reg` 会被
 * 操作数扫描的上界（`isOperandShapedWord`）提前挡住，故只有路径形态能一路走到这里。
 * 实测（`segmentLabels` 单次调用、修复前）：
 *   `su (/reg --config)*n` → n=4000 **138.5 ms**、n=8000 **556.8 ms**（倍率 4.02，标准平方），
 *   同形态的 `blastRadiusOfSegment` n=8000 → **1120.5 ms**（倍率 3.95）。
 *   对照裸名 `su (reg --config)*n` 修复后 n=8000 仅 **0.6 ms**（线性）。
 * 该路径在 `index.js` 的 buildCandidates 里**同步**执行、早于 `pendingApprovals.set`，
 * 词元由 AI 生成、长度无上界 —— 直接推迟弹窗。
 *
 * @param {string[]} w 词元列表
 * @param {number} idx `w[idx]` 是路由器命令名（小写，已过 `commandNameOf`）
 * @returns {string} 两词 label（拼不出时为空串）
 */
function routerSubLabelOf(w, idx) {
  const n = commandNameOf(w[idx])
  if (!ROUTER_CMDS[n]) return ''
  // 扫描上限：**两个维度各一个**（见 `ROUTER_SUB_SCAN_MAX` 的注释）。
  //   · 词元维度 —— 纯词元数的硬上界，防病态输入下打转（与 `segmentLabel` 里
  //     `guard < 8` 那条是同一类纪律）；
  //   · 带值选项维度 —— 跳过的带值选项**次数**上限。少了它，**同一个键重复出现**
  //     会击穿词元上界（`su root reg (-c v)*32 delete …` 有 70 个词元，`delete` 扫不到，
  //     `reg delete` label 丢失、`headEnd` 由 3 掉回 1）。
  const stop = Math.min(w.length, idx + 1 + ROUTER_SUB_SCAN_MAX * 2 + 8)
  let valueOpts = 0
  for (let t = idx + 1; t < stop; t += 1) {
    const rawTok = String(w[t])
    if (/\s/.test(rawTok)) return ''
    if (rawTok.charAt(0) === '-') {
      if (ROUTER_OPT_VALUE[rawTok]) {
        valueOpts += 1
        if (valueOpts > ROUTER_SUB_SCAN_MAX) return ''
        t += 1
      }
      continue
    }
    const sub = commandNameOf(rawTok)
    if (!sub || BAD_LABEL_CHARS.test(sub)) continue
    return n + ' ' + sub
  }
  return ''
}

/**
 * `w[idx]` 是不是「**吃目标的命令名**」—— 破坏性名单 ∪ 载荷族 ∪ **两词 label**。
 *
 * ── 为什么必须单列成模块级函数（单一来源）─────────────────────────────────────
 * 这个判据同时被两处消费，而两处**必须**逐字同源：
 *   · `privOperandSkip` —— 决定「`su` / `runas` 的操作数该不该跨过」；
 *   · `isPrivOperandWord` —— 决定「某个词元算不算操作数」。
 * 后者是前者的**入口判据与贪婪扫描判据**，两者分叉的后果是**结构性漏判**：
 * 贪婪扫描把真命令名本身当成操作数吃掉，于是推进步根本停不到它上面 ——
 * 只修 `privOperandSkip` 的跨越理由救不回来（它压根没机会被问到）。
 *
 * ── 实测（八档、proc/power/reg=deny、priv=allow，修复前）─────────────────────────
 * 只认 `isDestructiveLabel`（不认载荷族与两词 label）时：
 *     su root reg delete HKLM\X /f   → **allow**（labels 只有 ['su']，reg delete 不可见）
 *     su root find /data -delete     → **allow**（labels 只有 ['su']，find 不可见）
 * 而对照 `sudo reg delete …` 是 deny、`sudo find /data -delete` 是 ask ——
 * 同一件事只因前缀不同就分叉，方向是 **fail-open**。这两条覆盖的正是 `segmentLabel`
 * 里**既有**的两条识别口径（router 两词 label、`find -exec`/`-delete` 载荷族），
 * 故本判据与 `segmentLabel` 同源，不新造分类。
 *
 * @param {string[]} w 词元列表
 * @param {number} idx 待判词元的下标
 * @param {string} name `commandNameOf(w[idx])`（调用方已算出，避免重复解析）
 */
function isTargetEatingNameIn(w, idx, name) {
  if (isDestructiveLabel(name)) return true
  if (PAYLOAD_CARRIERS[name] === 1) return true
  return isDestructiveLabel(routerSubLabelOf(w, idx))
}

/**
 * 单个词元 `w[next]` 本身是不是操作数（**O(1)**，不做区间扫描）。
 *
 * 与 `isPrivOperandToken` 的分工：那个额外检查「前缀的选项里有没有 `-c`」（要看一整段），
 * 这个只看一个词元。拆开是**性能要求**：`privOperandSkip` 要连续扫完一整段操作数，
 * 若每轮都重扫区间，`su u1 u2 … un`（n 个操作数）就是 O(n²) —— 实测 n=16000 时
 * 单次判定 3028 ms（倍率≈4.0/倍，标准平方）。本文件其他几处平方退化（`unwrapWords(w.slice(j))`、
 * 尾部斜杠的 `replace(/\/+$/)`）都是同一类问题：词元由 AI 生成、长度无上界，
 * 而这是判定热路径。拆开后整段扫描是 O(n)。
 *
 * ── 「吃目标的命令名」**不算操作数**（否则贪婪扫描会把它自己吃掉）─────────────────
 * 判据复用 `isTargetEatingNameIn` 单点。缺了这一条的后果实测（修复前）：
 *     su root find /data -delete     → allow（`find` 被当操作数吃掉；`/data` 又因 `data`
 *                                      是语句关键字而停下；链推进看到 `-delete` 不是
 *                                      吃目标的命令名 → 不跨 → `find` 整个不可见）
 *     su root reg delete HKLM\X /f   → allow（`reg` 单名不在名单里，连 `delete` 一起被吃光）
 * 两者都与 `sudo` 对照分叉，方向 fail-open。这条判据同时也让 `su find …`（无操作数）
 * 保持原行为：入口即判「不是操作数」→ 不跨 → 命令头照旧停在 `su` 之后，
 * 与修复前逐字一致（`privOperandSkip` 在那里本来也返回 `at`）。
 */
function isPrivOperandWord(w, prefix, next) {
  if (PRIV_VALUE_IS_COMMAND[prefix] !== 1) return false
  if (next >= w.length) return false
  // 值选项自身（`-c` / `--command`）不是操作数：它的值才是命令或目标。
  //
  // ⚠️ 此处**只认精确的 `-c` / `--command`**（窄判据；`isPrivCommandValueFlag` 已无
  // `joined` 形参，连写形态由门控侧 `privValueFlagBetween` 自己判）：
  // `--command=<值>` 连写形态**不是**「值选项自身」—— 它的值已经在词元里，
  // 它后面那个词元才是真命令。若在此把它也算命中，贪婪扫描会在第二个词元就收束
  // （`su root --command=x rm -rf /tmp` 的 `commandHeadEnd` 由 **4 停在 1**），
  // 真命令与真目标一起被排除在命令头之外 → 段级 blast 归 `null` → 半径档落 `inside`
  // → `priv=allow` 时**静默放行**（实测放宽 540 格 / 收紧 0 格，见
  // `isPrivCommandValueFlag` 的实测段）。窄判据即本行修复前的行为，此处恢复它。
  const t = String(w[next])
  if (isPrivCommandValueFlag(t)) return false
  const name = commandNameOf(w[next])
  if (!name) return false
  if (WRAPPERS[name] === 1 || PRIV_PREFIXES[name] === 1 || STATEMENT_KEYWORDS[name]) return false
  return !isTargetEatingNameIn(w, next, name)
}

/**
 * `w[i]` 是否**长得像操作数的一部分**（`privOperandSkip` 的扫描上界，见那里的说明）。
 *
 * 判据只有一条：**选项形态** —— `-x`（`-` 开头）或 `/x:y`（`/` 开头、第二个字符是字母、
 * **含 `:`**，即 Windows 风格开关的实际词法特征）。
 *
 * 为什么是「选项形态」而不是「是不是用户名」：`su` / `runas` 的操作数**没有**统一词法形态
 * （`su root` 的 `root` 是用户名、`runas /user:admin` 的 `/user:admin` 是开关），
 * 而 `skipPrefixArgs` 刻意**不吃 `/` 开头**（POSIX 上 `/` 是路径分隔符，见其注释里
 * `nice /usr/bin/find / -delete` 那组实测）—— 于是 `/user:admin` 之类会停在「操作数」位置上。
 * 故扫描只能跨「第一个词元」+「选项形态的词元」，其余一律停：
 * `su root ls C:/Windows` 的 `ls`、`su root cat /etc/hosts` 的 `cat` 都不是选项形态，
 * 扫描停在那里，真命令与真目标留在命令头之外参与判档。
 *
 * ⚠️ **`/x` 形态是必需的**：`runas /noprofile /user:admin rm -rf /data` 的第二个操作数
 * 是 `/user:admin`，少了这一支就跨不过去 —— 而该形态实测在 HEAD 下判 null（漏报），
 * 54d 钉的正是它。注意第一个操作数（`/noprofile`）**不靠本判据**：`privOperandSkip`
 * 的 `k === at` 那一支无条件认它（见那里的说明），故「含 `:`」不会把 54d 弄丢。
 *
 * ── ⚠️ 本判据**只对 `su` 成立**：`runas` 的开关恒为**不含 `:`** 的单段 `/x` ────────────
 * 见 `isRunasSwitchShapedWord`（`privOperandSkip` 按前缀分派到它）。本函数要求 `/x` 含 `:`，
 * 是因为 `su` 是 POSIX 命令，`/etc`、`/tmp` 这类**单段 POSIX 路径**必须留在外面（下面的
 * 113 条实测）；而 `runas` 是 Windows 命令，其开关（`/noprofile` `/savecred` `/netonly`
 * `/profile` `/env` `/smartcard` `/showtrustlevels`）**全部不含 `:`**，`/user:admin` 反而是
 * 唯一带 `:` 的那个 —— 把本判据套到 `runas` 上会让扫描停在第二个开关上、真命令与真目标
 * 留在命令头之外（方向同样是 fail-open，实测见 `isRunasSwitchShapedWord`）。
 *
 * ── ⚠️ 本判据**不是** `isCmdStyleSwitch` 的同口径副本（曾如此自称，已分叉）──────────
 * 两者形似而**判据不同**，`isCmdStyleSwitch` 是**平台感知**的：
 *     `if (!(opts && opts.platform === 'win32')) return false`   // posix 恒 false
 * 而本函数**拿不到 opts**（签名只有 `token`，调用链 `privOperandSkip` ← `commandHeadEnd`
 * ← `blastRadiusOfSegment` 都不传平台），故改用**词法**判据替代平台判据：Windows 的
 * cmd 风格开关几乎都带 `:`（`/user:admin`、`/grant:r`、`/pid:1234`），而 POSIX 绝对路径
 * 的**单段**形态（`/etc`、`/tmp`、`/root`、`/data`、`/opt`、`/home`）与 Windows 盘符路径
 * （`D:/data`）都不含 `:`。
 *
 * 少了这条 `:` 判据的后果（**本批新引入的 fail-open 回归**，实测）：
 *     `su root /etc rm`、`su - cat /etc rm`、`su - ls /tmp rm`、`su - ls /etc -exec rm -rf {} +`
 * 的单段路径被当成「Windows 开关」跨过 → 命令头越过真命令与真目标 → 段级 blast 归 null
 * → 半径档落 `inside` → `priv=allow` 时由 HEAD 的 **ask** 变 **allow**。
 * 三方差分（本文件对拍语料 3772 条叉乘、逐条比段级 blast）：无 `:` 判据时
 * HEAD 有值而本版为 null 的 **113 条**里，**95 条 `blast.path` 是真实路径目标**
 * （`/etc` `/tmp` `/root` `/opt` `/home` `/usr` `/var` `/etc/hosts` `/data` `C:/data`
 * `D:/data` `C:/Windows` `C:/Users/me`），其余 18 条才是 `runas` 操作数自身的假警告。
 * 该形态**恰好落在「多段/含冒号」的缝外**（`C:/Windows`、`/usr/bin/rm` 有第二个 `/`
 * 而不被误判），故 54j/54k/54l 三套断言全绿也照不出它 —— 见 54n 的守卫。
 *
 * @param {string} token 待判词元
 */
function isOperandShapedWord(token) {
  const t = String(token == null ? '' : token)
  if (!t) return false
  if (t.charCodeAt(0) === 45) return true          // `-x` / `--long`
  // `/x:y`（Windows 风格开关）。单字符 `/`、多段路径（`/usr/bin`）与**单段 POSIX 路径**
  // （`/etc`、`/tmp`）都不算：前者第二个字符不是字母，中者含分隔符，后者不含 `:`。
  return t.charCodeAt(0) === 47 && /^\/[a-z]/i.test(t) && t.indexOf('/', 1) === -1
    && t.indexOf(':') !== -1
}

/**
 * `w[i]` 是不是 `runas` 的**开关**（`privOperandSkip` 扫描上界的 `runas` 支）。
 *
 * ── 为什么必须与 `isOperandShapedWord` 分开：两个前缀的操作数**词法不同** ────────────
 * `isOperandShapedWord` 那条「含 `:`」的守卫是为 `su` 立的 —— `su` 是 POSIX 命令，其后
 * 的单段路径（`/etc`、`/tmp`、`/root`、`/data`）必须**留在命令头之外**参与判档（少了这条
 * 守卫的实测：HEAD 有值而本版为 null 的 113 条里 95 条 `blast.path` 是真实路径目标）。
 *
 * 而 `runas` 是 **Windows** 命令，它的开关与 POSIX 路径的**词法恰好相反**：
 *     · 开关 —— `/noprofile` `/savecred` `/netonly` `/profile` `/env` `/smartcard`
 *       `/showtrustlevels`：**单段、不含 `:`**（官方语法里 `/user:` 是唯一带 `:` 的）；
 *     · 操作数 —— `/user:<名>`：单段、**含 `:`**。
 * 把「含 `:`」的守卫套到 `runas` 上，于是**第二个及以后的不含 `:` 开关**被判成「不是开关」
 * → 扫描停在那里 → 命令头停在下标 1 → 真命令与真目标全留在命令头之外 → 段级 blast 归 null
 * → 半径档落 `inside`。方向是 **fail-open**，且触发形态**符合 `runas` 官方语法顺序**
 * （`/user:` 写在最后）：`runas /profile /savecred /user:admin rm -rf /tmp`。
 * 实测（win32，A = 去掉该守卫、B = 加守卫后；`blast.level|blast.path`）：
 *     `runas /noprofile /user:admin rm -rf /tmp`   A=`outside|/tmp`  B=`outside|/tmp`（首位靠 `k === at`）
 *     `runas /profile /savecred /user:admin rm -rf /tmp`   A=`outside|/tmp`  B=**`null`**
 *     `runas /profile /netonly /user:admin rm -rf /tmp`    A=`outside|/tmp`  B=**`null`**
 * 因果钉死：把 `/savecred` 改成 `/savecred:x`（**只加一个冒号**）即恢复 `outside|/tmp`。
 * 端到端（用户可见后果，B 相对 A）：显式 deny 例外 `rm *` 由 **deny 变 ask**（用户写的拒绝
 * 失效）、组档 `reg=deny` 的 `… reg delete HKLM\X /f` 由 deny 变 **inherit**、`proc=deny` 的
 * `… kill 1234` 由 deny 变 **inherit**、`outside=deny` 由 deny 变 **inherit**、
 * `outside=ask+priv=allow` 由 ask 变 **allow**。
 * 覆盖面：win32「非首位不含 `:` 开关」形态里 **45 条动作相对修复前改变**。
 *
 * ── ⚠️ 判据**不能**放宽到「单段 `/x` 一律算开关候选」（曾经如此，是 fail-open 回归）──────
 * 上一版把 `runas` 支写成「单段 `/x` 一律算开关」，理由是「`runas` 的位置参数就是命令，
 * `runas /profile /etc rm` 本就不是合法调用，且 blast 仍由真命令与真目标决定」。
 * **实测该理由不成立 —— 真目标恰恰被跨过了**（`runas /noprofile /etc rm` 的 `/etc`）：
 * 单段 `/x` 这个形态里**同时**住着两类词元，而它们**必须分开**：
 *     · `runas` 的开关 —— `/noprofile` `/profile` `/savecred` …（该跨）；
 *     · **单段 POSIX 路径目标** —— `/etc` `/tmp` `/usr` `/var` `/opt` `/root` `/srv`（不该跨）。
 * 两者词法完全同形（单段、`/` 开头、第二个字符是字母、不含第二个 `/`），故「一律算开关」
 * 等于把**真目标**当开关跨过 → `privOperandSkip` 越过真目标、`commandHeadEnd` 把整段跳空
 * → 段级 blast 归 `null` → 半径档落 `inside`（方向 fail-open）。
 *
 * 实测（插桩 `commandHeadEnd` 的返回值，`runas /noprofile /etc rm`）：
 *     HEAD 与修复前 `headEnd=1`（`/etc` 留在命令头外当目标）；**放宽版 `headEnd=4`**
 *     （`/etc` 与 `rm` 全被吃进命令头）。逐条比段级 `blast.level|blast.path`：
 *     · **posix 侧相对 HEAD 是硬回归**：`runas /noprofile /etc rm`、`runas /user:a /etc rm`、
 *       `runas /profile /etc rm` 由 HEAD 的 `system|/etc` 变 `null`；触发面覆盖
 *       `/etc` `/tmp` `/usr` `/var` `/opt` `/root` `/srv` `/etc/hosts` 等单段路径。
 *     · win32 侧由修复前的 `outside|/etc` 变 `null`（HEAD 本就是 null）—— 中间态回归。
 *     · 端到端（`category=allow`、`priv=allow`）：`runas /user:a /etc rm`、
 *       `runas /noprofile /etc rm`、`runas /profile /etc rm` 在八档默认下 **ask→allow**、
 *       `outside=deny` 下 **deny→allow**；`runas /user:a /etc rmdir /data` 在
 *       `outside=deny` 下 **deny→ask**。
 *
 * ── 收窄后的判据：**含 `:` 的 cmd 风格开关** ∪ **`runas` 已知开关白名单** ──────────────
 * 两类合起来正好覆盖 `runas` 官方语法的**全部**开关与操作数，而单段 POSIX 路径两条都不满足：
 *     · 含 `:` —— `/user:<名>`、`/trustlevel:<n>`（cmd 风格开关的实际词法特征）；
 *     · 白名单 —— `RUNAS_SWITCHES` 里那 8 个**不含 `:`** 的开关（`/noprofile` `/savecred` …）。
 * 该收窄**不需要牺牲 54o 的收益**（实测：`runas /profile /savecred /user:admin rm -rf /tmp`
 * 仍是 `outside|/tmp` —— 第 2 个开关走白名单、`/user:admin` 走 `:` 支）。
 * **收窄只对本函数（`runas` 支）生效** —— `su` 支仍是 `isOperandShapedWord` 的 `:` 判据
 * （它连白名单都不需要：`su` 的操作数是**裸用户名**，本来就靠 `k === at` 那一支通过）。
 *
 * 上界仍是**两条**（与 `isOperandShapedWord` 支同构，只是判据换成下面这一条）：
 *   · `k === at` —— `skipPrefixArgs` 停下的第一个操作数，无条件算候选；
 *   · 其后**只有** `runas` 开关形态（cmd 风格开关或 `-x`）才可能是操作数的一部分。
 *
 * @param {string} token 待判词元
 */
function isRunasSwitchShapedWord(token) {
  const t = String(token == null ? '' : token)
  if (!t) return false
  if (t.charCodeAt(0) === 45) return true          // `-x` / `--long`
  // 单段 `/x`。多段路径（`/usr/bin/find`）与单字符 `/` 不算 —— 这一条与 `isOperandShapedWord` 同。
  if (t.charCodeAt(0) !== 47 || !/^\/[a-z]/i.test(t) || t.indexOf('/', 1) !== -1) return false
  // 含 `:`（`/user:admin`、`/trustlevel:2`）或在已知开关白名单里（`/noprofile`）。
  // **单段 POSIX 路径（`/etc`、`/tmp`）两条都不满足** → 留在命令头之外当目标参与判档。
  return t.indexOf(':') !== -1 || RUNAS_SWITCHES[t.toLowerCase()] === 1
}

function isPrivOperandToken(w, prefix, from, next) {
  if (PRIV_VALUE_IS_COMMAND[prefix] !== 1) return false
  if (next < from || next >= w.length) return false
  if (privValueFlagBetween(w, from, next)) return false
  return isPrivOperandWord(w, prefix, next)
}

/**
 * `su` / `runas` 的**操作数**该不该被跨过 —— 命令头推进的单点。
 *
 * `skipPrefixArgs` 对这两个前缀的带值选项表刻意留空（值可能是命令也可能是目标，
 * 见 `PRIV_VALUE_FLAGS`），于是它停在**操作数**上：`su root rm -rf /data` 停在 `root`、
 * `runas /user:admin rm -rf /data` 停在 `/user:admin`。命令头若到此为止，真命令名
 * 就留在外面被当成**目标实参**，而门控侧（`headCommandNameOf`）还会把操作数当命令名
 * 交去查命令域 → `/data` 被当开关跳过 → 段级 blast 归 null → 档位 `inside`
 * → 提权档设为 allow 时**静默放行**。实测（win32、priv=allow）：`su root rm -rf /data`、
 * `runas /user:admin rm -rf /data`、`runas /user:admin del /data` 全部 allow，
 * 而对照 `sudo -u root rm -rf /data` 是 ask —— 同一件事只因前缀不同就分叉。
 *
 * **只在「操作数之后确实是命令名」时才跨过它**，判据与 `commandHeadEnd` 的 ② 分支逐字同源
 * （对 `su` / `runas`，② 只在 `isDestructiveLabel(base)` 成立时吃掉那个词元）。少了这条限制，
 * `su root`（后面没有命令）会停在 `root` 上、`headCommandNameOf` 随即把操作数当命令名返回
 * —— 正是要修的那个形态。`su -c C:/Windows` 一族（值就是目标）同样靠它保住既有行为：
 * `-c` 之后那个词元不是破坏性命令名，命令头照旧停在前缀处。
 *
 * **本函数是 `commandHeadEnd` 与 `headCommandNameOf` 的共用推进步**：两处若各写一份，
 * 「命令头到哪儿」与「命令名是谁」必然再次分叉 —— 那正是本次缺陷的成因。
 *
 * @param {string[]} w 词元列表
 * @param {string} prefix 前缀命令名（小写，已过 commandNameOf）
 * @param {number} from 前缀命令名之后的下标（`skipPrefixArgs` 的起点）
 * @param {number} at `skipPrefixArgs` 的返回值（停在哪儿）
 * @returns {number} 推进后的下标（未跨过时与 `at` 相同）
 */
function privOperandSkip(w, prefix, from, at) {
  if (at >= w.length || !isPrivOperandToken(w, prefix, from, at)) return at
  // 操作数**可能不止一个**：`runas /noprofile /user:admin rm -rf /data` 里
  // `/noprofile` 与 `/user:admin` 都是操作数，真命令名在第三个词元上。只跨一个词元
  // 仍会漏（实测该形态段级 blast = null、priv=allow 时 allow）—— 故连续扫完操作数，
  // 再判断它后面跟的是不是命令头元素。
  //
  // 这一段用 **O(1)** 的 `isPrivOperandWord`（而不是 `isPrivOperandToken`）：后者要扫
  // 「前缀选项里有没有 `-c`」，若每轮都重扫区间，`su u1 u2 … un` 就是 O(n²) ——
  // 实测 n=16000 时单次判定 3028 ms（倍率≈4.0/倍）。`-c` 那件事在进入本循环前
  // 已由上面那次 `isPrivOperandToken` 判过，且循环内的词元都不是值选项
  // （`isPrivOperandWord` 对 `-c` 本身返回 false，循环即停），故无需每轮重扫。
  //
  // ── 扫描**必须有上界**：只有「第一个词元」与「选项形态的词元」才可能是操作数 ────────
  // 这里曾经是无条件贪婪（`while (k < w.length && isPrivOperandWord(w, prefix, k)) k += 1`），
  // 而 `isPrivOperandWord` 对**任何不是「吃目标的命令名」的词元**都返回 true —— 于是扫描会
  // 一路吞到段内那个恰好叫破坏性命令名的词元，把**真命令与真目标**一起吞进命令头：
  //     su root ls C:/Windows kill
  //       → 扫描跨过 `ls`、`C:/Windows`，停在末尾的 `kill` → `commandHeadEnd` 返回 **5**
  //       → `blastRadiusOfSegment` 的 `i < headEnd` 把整段跳空 → 段级 blast 归 **null**
  //       → 半径档落 `inside` → 实测 HEAD 判 `system`/ask，贪婪扫描下判 **null/allow**。
  // 与 `git show HEAD:shell-parse.js` 对拍（1320 条叉乘、逐条比段级 blast）：HEAD 有值而
  // 贪婪扫描下为 null 的形态 **88 条**，全部是 `su`/`runas` 操作数 + **非破坏性命令** +
  // 系统路径 + 末尾破坏性名（`su root ls /usr/bin/rm`、`su root cat C:/Windows/System32/taskkill.exe`
  // …）—— 方向是 **fail-open**，且 HEAD 侧本就正确，故这是本批改动引入的回归。
  //
  // 上界的两条判据都是「操作数**形态**」，与 `skipPrefixArgs` 停在哪儿同源：
  //   ① `k === at` —— `skipPrefixArgs` 停下的那个词元就是第一个操作数
  //      （`su root` 的 `root`、`runas /user:admin` 的 `/user:admin`），无条件算候选；
  //   ② 其后**只有选项形态**（`/x` / `-x`）才可能是操作数的一部分 ——
  //      `runas /noprofile /user:admin rm -rf /data` 的两个 `/x` 都在这一支里（54d 依赖它），
  //      而 `su root ls …` 的 `ls`、`su root cat …` 的 `cat` 都不是，扫描就此停住，
  //      真命令与真目标留在命令头之外参与判档（这正是本函数要恢复的行为）。
  //
  // ── ⚠️ ② 的判据**必须按前缀分派**（曾经全局共用一条，是本批修复内部的收窄倒退）──────
  // `su` 与 `runas` 的操作数**词法不同**：`su` 是 POSIX 命令，其后单段路径（`/etc`、`/tmp`）
  // 必须留在外面，故要「含 `:`」的守卫；`runas` 是 Windows 命令，开关恒为**不含 `:`** 的
  // 单段 `/x`（`/noprofile` `/savecred` `/netonly` `/profile` `/env` `/smartcard`
  // `/showtrustlevels`），而操作数 `/user:<名>` 才是唯一带 `:` 的那个 —— 全局套用「含 `:`」
  // 会把**第二个及以后的不含 `:` 开关**判成扫描终点。
  // 实测（win32，A = 无该守卫、B = 有该守卫，`blast.level|blast.path`）：
  //     `runas /noprofile /user:admin rm -rf /tmp`          A=`outside|/tmp` B=`outside|/tmp`
  //       （首位那支靠 `k === at` 通过，故 54n 只钉首位形态时照不出这个倒退）
  //     `runas /profile /savecred /user:admin rm -rf /tmp`  A=`outside|/tmp` B=**`null`**
  //     `runas /profile /netonly /user:admin rm -rf /tmp`   A=`outside|/tmp` B=**`null`**
  //     `runas /netonly /savecred /user:admin rm -rf /tmp`  A=`outside|/tmp` B=**`null`**
  // 因果钉死：`/savecred` → `/savecred:x`（**只加一个冒号**）即恢复 `outside|/tmp`。
  // 触发形态符合 `runas` **官方语法顺序**（`/user:` 写在最后）。
  // 端到端（B 相对 A，用户可见后果）：显式 deny 例外 `rm *` 由 **deny 变 ask**（用户写的
  // 拒绝失效）、组档 `reg=deny` + `… reg delete HKLM\X /f` 由 deny 变 **inherit**、
  // `proc=deny` + `… kill 1234` 由 deny 变 **inherit**、`outside=deny` 由 deny 变
  // **inherit**、`outside=ask+priv=allow` 由 ask 变 **allow**。
  // 覆盖面：win32「非首位不含 `:` 开关」形态里 **45 条动作相对修复前改变**。
  // 故 ② 分派到 `isRunasSwitchShapedWord`（`runas`）与 `isOperandShapedWord`（其余）。
  //
  // ── ⚠️ 已知残余（**不是「与 HEAD 逐字一致」** —— 此处注释一度如此自称，实测为误）──────
  // `su root <路径> <破坏性名>`（`su root /data kill`）仍会跨过那个路径词元。此处注释
  // 一度写「它在 HEAD 下同样是 null」，逐条比段级 blast 后**不成立**：HEAD 判
  // `outside|/data`（有值），本版为 null —— 方向是 fail-open，属**本批改动引入**的残余。
  // 触发它的**不是** `isOperandShapedWord` 的 `/x` 分支（`/data` 不含 `:`，已不被当开关），
  // 而是本函数下面另两处判据，两者都独立于 `/x`：
  //   ① `k === at` 那一支**无条件**认第一个操作数 —— `su - /etc rm` 的 `skipPrefixArgs`
  //      已把 `-` 吃掉，`at` 指向的是**目标** `/etc`，却被当操作数跨过；
  //   ② 关键字链（③ 分支）按 `commandNameOf` 的 **basename** 认关键字 —— **33/33** 个
  //      `STATEMENT_KEYWORDS` 名全部可被路径形态触发（`/data` `/in` `/for` `/do` `/end`
  //      `/try` `/switch` `/class` `/begin` `/process` `/not` `/if` `/else` `/then`
  //      `/exit` `/return` `/function` `/catch` `/finally` `/and` `/or` `/while` `/foreach`
  //      … 每一个 `/<关键字>` 与 `C:/<关键字>`、`D:/<关键字>` 都命中），不止注释最初举的
  //      `data` 一族 —— 于是**目标词元被当关键字跳过**，链一直推进到末尾的破坏性名。
  // 本批修复只覆盖 `/x` 分支（发现 1 点名的四条端到端复现已全部修好）。
  // ── 残余 ② 的修法与范围（原注释给的方向**不可行**，已更正）────────────────────────
  // 原注释写「要修需给 `k === at` 加『路径形态』守卫」—— 实测按此变异**6 条断言变红**
  // （54d / 54h / 54h2 / 54h3 / 54n / 54l）：`runas` 的**首位**开关 `/noprofile` 本身就是
  // 路径形态，加守卫会把它挡在门外、退回「该跨没跨」。
  // **可行修法是只给关键字链（③ 分支）加「路径形态不当关键字」守卫**（单独变异实测
  // **0 断言失败**；全语料 273420 条**段级 blast** **LOST=0、GAIN=290**，290 条全部与
  // HEAD 同值，即纯回归基线、不引入新结论）。见下面 `isKeywordWord` 那一处。
  //
  // ── ⚠️ 上面那个「LOST=0」只是 **blast 口径**；**tiers 口径并非 0**（措辞已按实测更正）──
  // 本批的 label 修复（`pushHeadLabels` 的「`at` 位置确实是操作数才终止」，它复用了本函数
  // 的推进步）让 `diskpart` 这类**真命令名首次进入 labels**，于是 `isUnknownTierSegment`
  // 的 `diskpart` + `/s` 支**首次命中**，posix 侧多出 **74 条 `outside → unknown`**
  // （验证者语料 10560 段比较、逐条打印 `tiers` 复核）：
  //     posix  `su diskpart /s script.txt`   PRE=`[outside,priv]` → CUR=`[unknown,priv]`
  //     win32  同形态                        PRE=`[priv]`         → CUR=`[unknown,priv]`
  // **该变化确属「与 sudo / 裸形态对齐」，不是新分叉**（实测三方差分：
  // CUR 的 `su …` == PRE 的 `sudo …` == CUR 的 `sudo …` == `[unknown,priv]`；
  // 裸形态 `diskpart /s script.txt` 的 PRE/CUR 均为 `[unknown]`）—— 即修掉的是 PRE 侧的
  // **异类**。win32 侧在这一形态下没有 `outside→unknown`（`/s script.txt` 的 blast 恒 null、
  // 本就没有半径档），只是由 `priv` 变成 `unknown,priv` —— 但**「win32 侧 blast 恒 null」
  // 只对这一形态成立**：`/s` 之后换成 win32 判得出半径的目标时，win32 侧同样有
  // `outside→unknown`（见下面的方向表，勿把它读成平台属性）。
  //
  // ⚠️ **方向随配置而变，不能只记「对齐」** —— 且**每一格都带条件**（见下表；此处曾把
  // 条件省略成「win32 allow→ask」「两侧都是 allow→deny」，实测那两格在 54w2 的配置下
  // 分别是 **ask→ask**、**ask→deny**，措辞已按 27 配置 × 2 平台的穷举实测更正）。
  //
  // 判据是「该形态**替换掉的半径档**是否原本在管它」：**在 `su diskpart /s script.txt`
  // 这一形态下**，PRE 的 tiers 为 posix `[outside,priv]` / win32 `[priv]`，CUR 一律
  // `[unknown,priv]`。故变化形态由 **`outside` 与 `unknown` 的相对严格度**决定，而 `priv`
  // 只在「PRE 侧根本没有半径档」时才会**顶上来决定动作**：
  //
  //   `outside=deny + unknown=ask`（54w2#1）：
  //     · posix —— `priv` 取 `ask` / `allow` 时都是 **deny→ask**（放宽方向：
  //       deny 来自 `outside`、ask 来自替换它的 `unknown`）；`priv=deny` 时 deny **反超**
  //       二者 → **deny→deny**（无变化）。故「posix 恒 deny→ask」是**过度概括**。
  //     · win32（仅 `script.txt` 形态）—— **视 `priv` 档**：`priv=ask` **无变化**
  //       （ask→ask，PRE 的动作本来就由 `priv` 决定）、`priv=allow` 时 **allow→ask**（收紧）、
  //       `priv=deny` 时 deny→deny。
  //   `unknown=deny`：
  //     · win32（仅 `script.txt` 形态）—— `priv=allow` 时 **allow→deny**、`priv=ask` 时
  //       **ask→deny**（都收紧，`unknown=deny` 比 `priv` 的任一档都严，故 `priv` 不改变结论）。
  //     · posix —— 需**同时** `outside=allow` 才是 **allow→deny**；`outside=ask` 时是
  //       **ask→deny**；`outside=deny` 时 **无变化**（deny→deny，两侧都严）。
  //   **八档缺省（`inside=allow`、其余 `ask`）下两平台均无任何变化**。
  //
  // ── 穷举实测（`su diskpart /s script.txt`，`(outside,unknown,priv) ∈ {allow,ask,deny}³` ──
  // = 27 配置 × 2 平台）：posix 变化 **10/27**、win32 变化 **9/27**，且**在这一形态下**
  // win32 侧的变化形态只有 `allow→ask`×3 / `allow→deny`×3 / `ask→deny`×3
  // （**无任何放宽方向**），posix 侧才有 `deny→ask`×3 与 `deny→allow`×1 这类放宽格。
  //
  // ⚠️ **「win32 侧无任何放宽方向」只是这一形态的结论，不是平台属性**（此处曾经那样写，
  // 属**过度概括**）。win32 的 PRE 档位集合**随 `/s` 之后的目标而变**，并不恒为 `[priv]`：
  // PRE 的档位集合是「半径档（仅当 blast 判得出时）∪ priv」，而 win32 的 blast **只在
  // `/s` 的目标判不出半径时为 null** —— 换成 win32 判得出半径的路径，PRE 就带上半径档，
  // 于是与 posix 同形，win32 侧**同样出现放宽**。实测（PRE = 把本函数「`at` 位置确实是
  // 操作数才终止」那一圈修复回退掉的副本，CUR = 本文件；27 配置逐格）：
  //
  //   `/s` 之后的目标        | win32 PRE.blast        | win32 PRE.tiers  | CUR.tiers      | 变化/27 | 收紧 | 放宽
  //   ----------------------|------------------------|------------------|----------------|--------|-----|----
  //   `script.txt`（锚点）    | null                   | `[priv]`         | `[unknown,priv]`|  9     |  9  | **0**
  //   `build/out.txt`        | null                   | `[priv]`         | `[unknown,priv]`|  9     |  9  | **0**
  //   `C:/scripts/d.txt`     | outside|C:/scripts/d.txt| `[outside,priv]` | `[unknown,priv]`| 10     |  5  | **5**
  //   `D:/scripts/d.txt`     | outside|D:/scripts/d.txt| `[outside,priv]` | `[unknown,priv]`| 10     |  5  | **5**
  //   `C:/Windows/Temp/d.txt`| system|…                | `[wide,priv]`    | `[unknown,priv]`|  9     |  6  | **3**
  //   `/etc/hosts`           | outside|/etc/hosts      | `[outside,priv]` | `[unknown,priv]`| 10     |  5  | **5**
  //   `/tmp/x`               | outside|/tmp/x          | `[outside,priv]` | `[unknown,priv]`| 10     |  5  | **5**
  //   `~/x`                  | outside|C:/Users/me/x  | `[outside,priv]` | `[unknown,priv]`| 10     |  5  | **5**
  //   `/`                    | drive-root|/           | `[wide,priv]`    | `[unknown,priv]`|  9     |  6  | **3**
  //   `C:/data` / `D:/data`  | outside|…              | `[outside,priv]` | `[unknown,priv]`| 10     |  5  | **5**
  //
  // **最小反例（自然形态）**：win32、`su diskpart /s C:/scripts/d.txt`、
  // `outside=deny, unknown=allow, priv=allow` → **PRE=deny、CUR=allow**
  // （PRE tiers `[outside,priv]` → CUR `[unknown,priv]`，blast 两侧同为
  // `outside|C:/scripts/d.txt`，即变化**不来自 blast**）。同类放宽格还有
  // `o=ask,u=allow,p=allow: ask→allow` 与 `o=deny,u=ask,p=allow: deny→ask` 等（共 5/27）。
  //
  // ⚠️ **「`wide` 恒 ask 不影响本族」同样不成立**（此处曾经那样写）：`wide` 是不是 ask
  // 由用户配置决定，而 win32 的 PRE **确实会带上 `wide` 档** ——
  // `su diskpart /s C:/Windows/Temp/d.txt` 的 win32 PRE 就是 `[wide,priv]`（blast=system）。
  // 实测（win32、`outside=ask,unknown=ask,priv=allow`、目标 `C:/Windows/Temp/d.txt`）：
  // `wide=ask` → PRE=ask；`wide=deny` → PRE=**deny**；`wide=allow` → PRE=**allow**，
  // 而 CUR 三种配置下恒为 ask（`[unknown,priv]` 不含 wide）。故 `wide` 在反例形态上
  // **确实参与决定 PRE 的动作**。
  //
  // **这不是新的根因**（与 F2 同源）：CUR 侧 `su` 与 `sudo` 在所有反例形态上**仍然同值**
  // （实测逐格 `su.tiers == sudo.tiers == [unknown,priv]`），对齐性质成立。
  // 但「win32 侧无需决策」的读法会**低估放宽面** —— 该族在 win32 上的放宽格数与 posix 同级
  // （`C:/scripts/d.txt` 一族 5/27、`wide` 一族 3/27），不是「只有 posix 才放宽」。
  // 「`outside=deny + unknown=ask` 下是否接受这个 deny→ask」属**设计侧决策**（记在
  // 项目外的设计笔记里），本函数不表态 —— 现状由 `test/shell-parse.mjs`
  // 的 **54w** 钉住（钉的是「与 sudo / 裸形态**同值**」这条对齐性质，不是某个动作值）。
  // 残余 ①（`k === at` 无条件认第一个操作数）**不在本次改动面内**：按「路径形态」守卫
  // 它同样会让上面 6 条断言变红，故如实记录、不掩盖残余。
  let k = at
  const operandShaped = prefix === 'runas' ? isRunasSwitchShapedWord : isOperandShapedWord
  while (k < w.length && isPrivOperandWord(w, prefix, k)
    && (k === at || operandShaped(w[k]))) k += 1
  if (k >= w.length) return at
  const after = String(w[k])
  // 含空白的词元是引号包起来的整条命令行（`su root -c "rm -rf /"`），不是命令名 ——
  // 与 commandHeadEnd / headCommandNameOf 同判据，留给子命令行递归。
  const afterName = after && !/\s/.test(after) ? commandNameOf(after) : ''
  if (!afterName) return at
  // ── 跨过操作数的条件是「它后面确实是**命令头的一部分**」────────────────────────
  // 三种形态都算，缺一不可：
  //   ① 破坏性命令名 —— `su root rm -rf /data`（判档要看的就是它后面的目标）；
  //   ② 另一个命令头元素（wrapper / 提权前缀）—— `su root env FOO=1 rm -rf /data`、
  //      `su root sudo rm -rf /data`：跨过操作数后由循环自己的 ① 分支接着往下剥；
  //   ③ **语句关键字** —— `su root time rm -rf /data`、`su root ! rm -rf /data`：
  //      `commandHeadEnd` 刻意**不认识**关键字（见其注释），跨到关键字就会**停在那里**
  //      （`sawPrefix` 分支被 PRIV_VALUE_IS_COMMAND 挡住、关键字也不在破坏性名单里），
  //      于是 `headEnd` 指向关键字、`headCommandNameOf` 取 `w[headEnd-1]` 拿回**操作数**。
  //      故这一支必须把「操作数 → 关键字/wrapper/前缀 链 → 破坏性命令名」整段走完，
  //      返回**破坏性命令名本身的下标**（而不是关键字的下标）—— 循环落在它上面即命中 ②
  //      并吃掉它，`headEnd - 1` 正是那个命令名。
  //      实测（win32、priv=allow）：①②③ 三种形态此前段级 blast 全是 null、动作 allow，
  //      而同目标的 `time rm -rf /data` 是 outside/ask —— 与本函数要修的 ① 是同一根因，
  //      只是操作数与真命令名之间多夹了一层。
  // 都不是时**不跨**：`su root`（后面没有命令）、`su root ls`、`su root x` 保持原状，
  // 否则 `headCommandNameOf` 会把操作数后面的任意词元当命令名返回（`su root x` 的 `x`）。
  //
  // ── 这里**不能**再写「后跟 wrapper / 提权前缀就跨」的无条件分支（曾经有，是个漏报）────
  // 曾经是：`if (isDestructiveLabel(afterName)) return k` 之后紧跟
  // `if (WRAPPERS[afterName] === 1 || PRIV_PREFIXES[afterName] === 1) return k` ——
  // 于是「操作数 + wrapper + **纯路径目标**」（`su root env /etc`、`su root sudo C:/Windows`）
  // 也把操作数跨过去了。而 wrapper/前缀之后并没有命令名，`commandHeadEnd` 的循环于是
  // 落进 ① 分支、`prevPrefix` 被改写成那个 wrapper，`!PRIV_VALUE_IS_COMMAND[prevPrefix]`
  // 成立（该表只登记 su/runas）→ **真目标被当命令名吃掉** → 段级 blast 归 null
  // → 档位 inside → `priv=allow` 时**静默放行**。实测（win32、priv=allow）：
  //     `su root sudo C:/Windows` 由 HEAD 的 ask 变成 allow，
  //     而同目标的 `su root C:/Windows` 仍是 ask —— 同一件事只因多一个 wrapper 就分叉；
  //     HEAD 判 system/home/drive-root 的 130 条形态（posix 247 条）全部失去警告。
  // 方向与本函数的 ①（该跨没跨）相反：这里是**不该跨却跨了**。
  //
  // 判据收敛为一条：**只有链上真的出现「吃目标的命令名」才跨**（①②③ 合并成下面
  // 那个循环）。注意 `isDestructiveLabel(afterName)` **也不能**单独提前返回 ——
  // 提权名本身就在 `DESTRUCTIVE_LABELS` 里（§9.4），`su root sudo C:/Windows` 的
  // `afterName` 正是 `sudo`，提前返回等于又变回无条件跨过（实测该形态仍判 null）。
  //
  // ── 「吃目标的命令名」= 破坏性名单 ∪ 载荷族（不只是 `isDestructiveLabel`）──────────
  // 只认破坏性名单会**漏掉载荷族**（`find` / `env` / `xargs` …，见 PAYLOAD_CARRIERS）：
  // `su root env find /data -delete` 的操作数之后是 `env`（wrapper，链推进里处理）再是
  // `find` —— `find` **不在** `DESTRUCTIVE_LABELS` 里（它的破坏性来自后续 `-delete` /
  // `-exec`），于是判成「不跨」→ 命令头停在操作数上 → `headCommandNameOf` 取回 `root`
  // → `isCmdStyleSwitch('/data', …, 'root')` 认不出命令域 → **`/data` 被当 cmd 开关跳过**
  // → 段级 blast 归 null → 档位 `inside` → 真删除命令静默。
  // 实测（端到端、win32、priv=allow）：`su root env find /data -delete` 与
  // `su root sudo find /data -delete` 由 **ask** 变成 **allow**，而对照的
  // `env find /data -delete` 仍是 ask —— 同一件事只因多一个 `su` 操作数就分叉，
  // 正是本文件反复要修的那类分叉（方向是**漏报**，比假警告严重）。
  // 故跨越理由必须与 `commandHeadEnd` 的 ② 同口径地覆盖载荷族：那里是
  // `sawPrefix && !PRIV_VALUE_IS_COMMAND[prevPrefix]`（前缀之后一律当命令名），
  // 本处更保守 —— 只有确认「是命令域成员」才跨，故 `su root /etc`（纯路径）仍不跨。
  // 复用 `PAYLOAD_CARRIERS` 单点（与 `isPayloadCarrierLabel` / `canCarryDestructivePayload`
  // 同一份表），不另抄一份「什么算载荷族」。链推进里 wrapper 已由上一支处理，
  // 故这一支实际贡献的是 `find` 这类**非 wrapper 的载荷族**。
  //
  // ── 判据必须与 `segmentLabel` 的**两词 label** 口径对齐（`reg delete`）─────────────
  // 这里一度只看**单个**词元（`isDestructiveLabel(n)`），而 `DESTRUCTIVE_LABELS` 里有
  // **两词**成员（`reg delete`，见注册表组），路由器命令的子命令正是靠 `segmentLabel`
  // 的 router 分支拼成两词的。于是 `su root reg delete HKLM\X /f` 判成「操作数之后不是
  // 吃目标的命令名」（`reg` 单独不在名单里）→ 不跨 → 命令头停在 `root` 上 → `reg delete`
  // 整个不可见：实测（八档、reg=deny、priv=allow）该形态 **allow**，而对照
  // `reg delete HKLM\X /f` 与 `sudo reg delete HKLM\X /f` 都是 deny —— 与上面那条
  // 前缀分叉同源，只是分叉点在「两词 label」上。
  //
  // 判据收敛到 `isTargetEatingNameIn` **单点**（与 `isPrivOperandWord` 共用同一份）：
  // 两处若各写一份，贪婪扫描仍会把 `reg` / `find` 当操作数吃掉、推进步根本停不到它们
  // 上面，本处的跨越理由再对也没机会被问到 —— 实测那正是 `su root reg delete …` 与
  // `su root find /data -delete` 在只改本处时**仍然 allow** 的原因。
  // ── 跨越判据同样只认**裸命令名**（与 commandHeadEnd 的 ② 分支同一份判据）──────────
  // `commandNameOf` 按 basename 取尾段，于是**路径目标**也会解出命令名：
  // `runas /user:a C:/Windows/System32/taskkill.exe` 的 `taskkill`、`su -c /usr/bin/rm`
  // 的 `rm` 都在破坏性名单里 —— 跨过操作数去「吃」一个**目标**，命令头随即把整段跳空
  // → 段级 blast 归 null → 半径档 `inside`。
  //
  // ── ⚠️ 归因更正：这一族**不全是** `runas` 操作数自身的假警告 ──────────────────────
  // 本处注释与 `test/shell-parse.mjs` 的 54j 曾把「HEAD 有值 → 变 null」的残余 LOST
  // **整体**归因为「`runas` 的操作数被当成目标」（`head.path` 是 `/user:a` / `/noprofile`）。
  // 逐条打印 `blast.path` 复核后该归因**不成立**，必须按 `head.path` 一分为二
  // （对拍语料 3648 条叉乘 × 逐条比段级 blast；数字为**本次修复前 / 后**）：
  //   · **操作数自身**（`/user:a`、`/noprofile`）—— HEAD 的**假警告**：HEAD 把 `runas`
  //     的操作数当成了目标路径，警告指错对象。修复前 30 条、修复后 18 条。
  //   · **真实路径目标** —— **真漏报**（方向 fail-open）：`head.path` 是 `/etc`、`/tmp`、
  //     `/root`、`/opt`、`/home`、`/usr`、`/var`、`/etc/hosts`、`/data`、`C:/data`、
  //     `D:/data`、`C:/Windows`、`C:/Users/me`。修复前 177 条、修复后 88 条。
  // 两类混在一起时只看计数会把真漏报当成假警告抹掉 —— 故 54n 按**形态**逐条钉住
  // 「单段 POSIX 路径」那一族（`su root /etc rm`、`su - cat /etc rm`），而不是只数总数。
  // 残余的 88 条**不是** `/x` 分支造成的（见本函数「已知残余」段：`k === at` 支与
  // 关键字链），故 54n 只钉 `/x` 分支修好的那些形态。
  // 判据用词法（有没有路径分隔符），不依赖任何名单 —— 故不会与名单漂移。
  const isTargetEatingName = (n, idx) => !/[/\\]/.test(String(w[idx])) && isTargetEatingNameIn(w, idx, n)
  // ── ④ `at` 之后的第一个词元是**值选项**（`-c` / `--command`），其值是**裸命令名** ──────
  // 前三支（①`k === at` 操作数、②选项形态、③关键字链）都停在**操作数**上，而 `su` 的
  // 操作数之后紧跟的第一个词元可能正是值选项 `-c`（`su root -c <cmd>`，GNU getopt 参数
  // 置换下的**常规写法**）。此时 `k` 停在 `-c` 上，`afterName` 是 `-c` 本身 —— 既不是
  // 关键字也不是前缀，快速路径判「不是吃目标的命令名」→ 返回 `at`（**不跨**）。
  //
  // 后果是**整条链停在 `su` 上、真命令名永不进 labels**（判档侧与 label 侧同时失效，
  // 因为两处共用本函数这一推进步）：
  //     段级（win32、真实宿主钩子口径）：
  //         su -c kill 1234        → labels=["su","kill"] blast=null T=[proc,priv]  ✅
  //         su root kill 1234      → labels=["su","kill"] blast=null T=[proc,priv]  ✅
  //         su root -c kill 1234   → labels=["su"]        blast=null T=[**priv**]   ❌ proc 档整个丢失
  //     端到端（八档默认 inside=allow 其余 ask）：
  //         su -c kill 1234 / su root kill 1234 / sudo kill 1234 → ask（proc 档在管）
  //         su root -c kill 1234                                → 同上形态却只剩 priv 档
  //     用户显式写的 deny 例外同样被绕过（例外 `kill *`=deny）：
  //         三条对照全 **deny**，`su root -c kill 1234` 是 **ask**（`source=destructive`）。
  //     组档三族（proc / power / reg）全部如此，且**默认配置下即触发**（不需要用户放宽任何档）。
  //
  // 归属：HEAD 上同样是 ask（非本批回归）——`su root -c <cmd>` 是 `su` 指定用户后执行命令
  // 的常规写法，与 `ignored.md:115` 记的 `NAME=value` 赋值词元**形态不同**（那是赋值词元，
  // 这是值选项词元），但同属「`privOperandSkip` 在操作数之后收束、链停在 `su`」这一根因家族。
  //
  // 判据 = **值选项自身** ∪ **值是裸的吃目标命令名**（复用 `isPrivCommandValueFlag` 与
  // `isTargetEatingName` 两个既有单点，不新造判据）：
  //   · 「值选项自身」用**窄**判据（精确 `-c` / `--command`）—— 与 `isPrivOperandWord` 同源。
  //     连写形态（`--command=<值>`）在本位置**不可达**（此时 `w[k]` 就是操作数本身，
  //     走上面 `k === at` 那一支），故本处不判它。
  //   · 「裸」= **不含路径分隔符**：`commandNameOf` 按 basename 取尾段，于是 `/usr/bin/rm`、
  //     `C:/Windows/System32/taskkill.exe` 这类**路径目标**也会解出命令名，跨过它们等于把
  //     真目标排除在命令头之外。**这一条不在这里重写一遍** —— `isTargetEatingName` 内部
  //     已有 `!/[/\\]/.test(w[idx])` 这半（与 `privOperandSkip` 的 ③ 链共用同一份），
  //     两处各写一份必然漂移。实测：把该条件在这里再写一遍与不写，输出**逐字相同**（冗余）。
  //   · 含**空白**的值是引号包起来的整条命令行 / 多词 label（`su root -c "reg delete" …`），
  //     跨过它会让 `segmentLabelFrom` 把 `reg delete` 截成首词 `reg` —— 而 `reg` 不在
  //     `GROUP_OF_LABEL` 里，`reg` 档随之丢失。故这一条**必须**在这里判（`isTargetEatingName`
  //     不含它）。
  //   · 值本身是**语句关键字**（`su root -c time kill 1234`）时必须跨过它，理由见下。
  //
  // ── ⚠️ 值即**语句关键字**是一整个独立子形态（本轮修复）────────────────────────────
  // `isTargetEatingNameIn` 的三个来源 = 破坏性名单 ∪ `PAYLOAD_CARRIERS` ∪ 两词 label，
  // 而 `isPrivOperandWord`（`:2091`）**显式把关键字排除在操作数之外** —— 于是
  // `STATEMENT_KEYWORDS` 与 `isTargetEatingNameIn` 的**交集结构性为空**：关键字既不是
  // 「吃目标的命令名」（本支判假）、也不是操作数（`k` 停不到它上面），两侧都接不住它。
  // 后果：`su root -c time kill 1234` 的 `k` 停在 `-c` 上、`vn='time'` 判假 → 落到下面那条
  // 快速路径（`afterName` 是 `-c`，既非关键字也非前缀）→ `return at`（**不跨**）→ 链停在
  // `su` 上、**真命令名 `kill` 永不进 labels**（判档侧与 label 侧共用本函数这一推进步，
  // 同时失效）。实测（win32、真实宿主钩子口径）：
  //     su -c time kill 1234        labels=["su","kill"] T=[proc,priv]   ✅
  //     su root -c time kill 1234   labels=["su"]        T=[**priv**]    ❌ proc 档整个丢失
  //     su root time kill 1234      labels=["su","kill"] T=[proc,priv]   ✅（无值选项那一路正常）
  // 端到端（**纯出厂默认**下两侧 action 都是 ask，差异只在 tiers/labels；要在 action 层显现
  // 需用户写了 deny 例外或把 `proc`/`power`/`reg` 设成非 ask —— 两者都是常规配置）：
  //     例外 `kill *`=deny：`su -c time kill 1234` = **deny**、`su root -c time kill 1234` = **ask** ❌
  //     `proc/power/reg=deny` + `priv=allow`：前者 **deny**、后者 **allow** ❌（静默放行）
  // 触发面：`STATEMENT_KEYWORDS` **45** 条里 **43** 条分叉；两条不分叉的**原因并不相同**，
  // 不可混为一谈 ——
  //   · `{`：被词法器当**未闭合花括号**，`-c { …` 整段解不出（两侧同为 `DECOMP-FAIL`）。
  //   · `}`：被词法器当**闭合花括号**处理 —— **不进 words**（只留在段原文里并置 opaque），
  //     整段照常解得出，两侧 words 都少了那个 `}`、**本就同值**：
  //     `su root -c } kill 1234` → words `["su","root","-c","kill","1234"]`、
  //     `su -c } kill 1234` → words `["su","-c","kill","1234"]`，tiers 两侧同为
  //     `[proc,priv]`、blast 两侧同为 null；**不构成分叉**。
  // 判据 parity（`su root -c <kw> <tail>` vs `su -c <kw> <tail>`，43 关键字 × 24 tail）
  // 由 **1032 → 0**。
  //
  // 判据**复用既有 `STATEMENT_KEYWORDS` 导出**（不新造表、O(1) 查表 + 既有 `isTargetEatingName`）：
  // 关键字**永远不是可执行命令名**（见 `STATEMENT_KEYWORDS` 的注释），故它出现在「值」位置上
  // 时唯一合理的解释就是「真命令还在它后面」—— 与下面 ③ 分支对关键字链的处置**同源**。
  //
  // **只可能收紧**：`w[k]` 是值选项时，原路径必然走到下面那条快速路径并返回 `at`
  // （`afterName` 是 `-c` / `--command`，既不是关键字也不是前缀，`isTargetEatingName` 恒假），
  // 故本支只把「必然不跨」换成「跨到那个裸命令名」—— 不存在任何「原本跨、现在不跨」的格。
  //
  // **「值即目标」族逐字保住**（`su -c C:/Windows`、`su root -c /etc`、`su root -c ~`、
  // `su root -c of=/dev/sda`、`su root -c "rm -rf /"`、`su root -c /usr/bin/rm`）：它们的值
  // 要么含分隔符（由 `isTargetEatingName` 拦）、要么含空白、要么解不出吃目标的命令名
  // （`~`、`of=/dev/sda`），三条守卫各自拦住，`k` 照旧停在值选项上、返回 `at`。
  // **「值即关键字」与 `isTargetEatingName` 不重复不冲突**（两集合交集为空，见上），故这里是
  // `||` 而不是替换。**⚠️ 不要给关键字加「路径形态」守卫**：实测加了之后 parity 反而留下
  // **2580** 个残余失败（`/time`、`C:/if` 这类路径值被挡在门外，退回「该跨没跨」那一族）。
  if (isPrivCommandValueFlag(String(w[k])) && k + 1 < w.length) {
    const vt = String(w[k + 1])
    if (!/\s/.test(vt)) {
      const vn = commandNameOf(w[k + 1])
      if (vn && (isTargetEatingName(vn, k + 1) || STATEMENT_KEYWORDS[vn])) return k + 1
    }
  }
  // ── 关键字判据同样要「**路径形态不当关键字**」守卫（残余 ② 的修法）────────────────
  // `commandNameOf` 按 basename 取尾段，于是**路径目标**也会解出关键字名：`/data`、`C:/data`、
  // `D:/data` 的 basename 恰是 PowerShell 关键字 `data`，目标词元被当关键字跳过、链一路推进到
  // 末尾的破坏性名 → 跨过操作数 → 命令头把整段跳空 → 段级 blast 归 null → 档位 `inside`。
  //
  // **范围远大于原注释所举的 `data` 一族**：`STATEMENT_KEYWORDS` 的 **33/33** 个名字全部可被
  // 路径形态触发 —— `/in` `/for` `/do` `/end` `/try` `/switch` `/class` `/begin` `/process`
  // `/not` `/if` `/else` `/then` `/exit` `/return` `/function` `/catch` `/finally` `/and`
  // `/or` `/while` `/foreach` … 每一个 `/<关键字>`（以及 `C:/<关键字>`、`D:/<关键字>`）都命中。
  //
  // ── ⚠️ 原注释给的修法方向**不可行**（已实测否决）────────────────────────────────
  // 原注释写「要修需给 `k === at` 加『路径形态』守卫」—— 按此变异后仓库测试 **6 条断言变红**
  // （54d / 54h / 54h2 / 54h3 / 54n / 54l）：`runas` 的**首位**开关 `/noprofile` 本身就是路径
  // 形态，加守卫会把它挡在门外，退回「该跨没跨」那一族。
  // **可行修法就是本处这一条**（只给关键字链加守卫，不动 `k === at`）：单独变异实测
  // **0 断言失败**；全语料 273420 条**段级 blast** **LOST=0、GAIN=290**，290 条**全部与
  // HEAD 同值**（即纯回归基线 —— 把 HEAD 本来判对、本批改动弄丢的结论收回来，不引入新结论）。
  // ⚠️ 同 `:1665` 那处的更正：这只是 **blast 口径**；**tiers 口径另有 posix 74 条
  // `outside → unknown`**（成因与方向见上文「已知残余」段末尾的更正段，性质是与 sudo/裸对齐）。
  const isKeywordWord = (n, idx) => STATEMENT_KEYWORDS[n] && !/[/\\]/.test(String(w[idx]))
  // 快速路径：afterName 既不是关键字也不是任何前缀时，结论只取决于它是不是吃目标的命令名。
  if (!isKeywordWord(afterName, k) && WRAPPERS[afterName] !== 1 && PRIV_PREFIXES[afterName] !== 1) {
    return isTargetEatingName(afterName, k) ? k : at
  }
  // ③：跳过关键字/wrapper/前缀链，找那个吃目标的命令名。
  // 每轮至少推进一个词元，guard 取词元数即不可能漏判（与 commandHeadEnd 同纪律）。
  //
  // ⚠️ **「前缀 / 关键字推进」必须排在 `isTargetEatingName` 之前**，否则本修复整个失效：
  //    `su root sudo X` 的链首 `sudo` **本身就在 `DESTRUCTIVE_LABELS` 里**（提权名全在名单里，
  //    见 §9.4），先判破坏性就会在链首 return k —— 那正是被删掉的那条无条件跨过，
  //    于是 `su root sudo C:/Windows` 依旧判 null。实测（win32、priv=allow）：
  //    先判破坏性 → 该形态 allow（漏报）；先判前缀 → 不跨、目标正常参与判档（与 HEAD 一致）。
  let m = k
  for (let guard = 0; guard <= w.length && m < w.length; guard += 1) {
    const t = String(w[m])
    const tn = /\s/.test(t) ? '' : commandNameOf(t)
    if (!tn) return at
    if (isKeywordWord(tn, m)) {
      // 关键字**自身的选项**必须一并跨过（`su root time -p <cmd>` 的 `-p`）—— 判据与
      // `headCommandNameOf` / `commandHeadEndFull` / `pushHeadLabels` / `segmentLabelFrom`
      // 的同名分支**同源**（复用 `skipPrefixArgs`）。只推一个词元时 `-p` 会停在链上，
      // 于是 `isTargetEatingName` 问到的是 `-p`（既非命令名也不在名单里）→ 判「不跨」
      // → 命令头停在操作数上 → 真命令与真目标一起被排除 → 段级 blast 归 null
      // → 半径档落 `inside` → `priv=allow` 时**静默放行**。
      // 实测（win32、priv=allow、其余档 ask）：`su root rm -rf /tmp` = ask、
      // `su root time rm -rf /tmp` = ask、`su root time -p rm -rf /tmp` = **allow**。
      let nx = m + 1
      try { const s = skipPrefixArgs(w, m + 1, tn); if (s > nx) nx = s } catch (e) {}
      m = nx > m ? nx : m + 1
      continue
    }
    if (WRAPPERS[tn] === 1 || PRIV_PREFIXES[tn] === 1) {
      // 前缀链交给 `skipPrefixArgs`（与 commandHeadEnd 的 ① 分支同源，不另写一份剥法）
      let nx = m + 1
      try { const s = skipPrefixArgs(w, m + 1, tn); if (s > nx) nx = s } catch (e) {}
      m = nx > m ? nx : m + 1
      continue
    }
    // 走到这里说明它不是关键字也不是前缀 —— 此时才问「是不是吃目标的命令名」。
    // 是（`rm` / `dd` / `find` / `xargs`…）→ 跨过操作数，命令头从它开始继续
    // （判档要看的就是它后面的目标）；
    // 否（纯路径目标 `su root env /etc`、`su root sudo C:/Windows`）→ **不跨**，
    // 让那个词元留在命令头之外参与判档（这正是本函数要恢复的行为）。
    if (isTargetEatingName(tn, m)) return m
    return at
  }
  return at
}

/**
 * 命令头的**完整**结束下标：在 `commandHeadEnd` 之上补上「语句关键字」这一层。
 *
 * ── 为什么必须单列一个函数（而不是改 `commandHeadEnd`）──────────────────────────
 * `commandHeadEnd` **刻意不认识语句关键字**（见其注释：关键字既不是前缀也不是破坏性命令，
 * 走 ② 时会被当成命令名一并吃掉）。它的消费方 `blastRadiusOfSegment` 靠另一条预筛
 * （`mayNeedBlastCheck`）处理关键字，两者不是同一个判据 —— 故不能就地改它，
 * 否则 `time diskpart` 一类的段级 blast 结论会跟着变（那是既有断言钉住的）。
 *
 * ── 为什么必须有它：语句关键字 × 透明 wrapper × 裸跑交互命令 ─────────────────────
 * `hasNoOperand` 的「按命令头位置跳过命令名」此前只看 `commandHeadEnd`，而后者对
 * `['time','env','diskpart']` 返回 **0**（首词元 `time` 是关键字 → 既非前缀也非破坏性命令）。
 * 于是 `i < headEnd` 一个词元都盖不住，`skip` 里又只登记了 `w[0]`(`time`)、
 * `unwrapWords[0]`(`time`)、`cmdName`(`diskpart`) 三项 —— 中间的 `env` 落进循环被当成
 * **非选项实参** → `hasNoOperand` 返回 false → 该段不归 `unknown` → 落半径档 `inside`
 * → 大分类 mode=allow 时**静默放行**。而 `diskpart` 裸跑会阻塞等 stdin（DSH 非交互环境），
 * 静默放行后该次工具调用直接挂住。
 *
 * 实测（45 个 STATEMENT_KEYWORDS × 9 个 wrapper × 3 个命令，真实档位表、mode=allow）：
 * 修复前 **1161/1215 allow**，而三组对照（仅关键字 / 仅 wrapper / 裸跑）各 **0/1215**。
 * 生产形态同样命中：`if true; then env diskpart; fi`、`while true; do env parted; done`。
 *
 * ── 判据：只在 `commandHeadEnd` **确实吃到命令名**时早退（发现 5 的修法）──────────────
 * 此前早退写的是 `if (end > 0) return end`，理由（已实测推翻）是「返回 >0 ⇒ 它已吃掉前缀链
 * + 命令名，关键字不可能出现在那个位置之前」。反例有两族（`PRIV_VALUE_IS_COMMAND` 的前缀
 * 只吃前缀名就停、`sudo` 会把关键字当命令名吃掉），详见函数体内那段注释。
 *
 * ⚠️ 注释曾称「不早退时 `parted /dev/sda` 的 `/dev/sda` 会被当成关键字之后的前缀链吃进
 * 命令头、tiers 由 `outside` 变 `unknown`」—— 该反例**实测不成立**：按修法放开早退后，
 * 12012 条语料 **0 放宽、0 半径档降级**（387 条全为 `inside→unknown` 收紧），
 * `parted /dev/sda`、`dd of=/dev/sda`、`diskpart /s script.txt` 的 tiers **逐字不变**。
 * 原因是下面那个循环的 ③ 分支只吃**一个**词元就 break（`/dev/sda` 进不了命令头），
 * 而 `hasNoOperand` 取 `max(headEnd, headFull)` 只影响「按位置跳过」的范围。
 *
 * 推进方式与 `headCommandNameOf` 的交替循环**同源**（复用 `skipPrefixArgs` /
 * `privOperandSkip`，不另写一份剥法）：关键字 → 前缀链 → 关键字 …… 交替前进，
 * 每轮至少推进一个词元，故 `guard <= n` 不可能漏判。
 *
 * @param {string[]} words 段词元
 * @returns {number} 结束下标（0 表示命令头没吃到任何命令名）
 */
function commandHeadEndFull(words) {
  const w = Array.isArray(words) ? words : []
  const n = w.length
  let end = 0
  try { end = commandHeadEnd(w) } catch (e) { end = 0 }
  // ── 早退：只在 `commandHeadEnd` **确实吃到了命令名**时（发现 5 的修法）──────────────
  // ⚠️ 「返回 >0」**不等于**「吃到了命令名」，此前把两者当成同一件事是 fail-open 的根因：
  //   · `su` / `runas`（`PRIV_VALUE_IS_COMMAND`）**只吃前缀名就停** ——
  //     `commandHeadEnd(['su','time','diskpart'])` = **1**（`privOperandSkip` 在关键字
  //     `time` 上收束，② 分支又因 `PRIV_VALUE_IS_COMMAND['su']` 不吃那个词元）；
  //   · `sudo time X` 走 ② 的 `sawPrefix && !PRIV_VALUE_IS_COMMAND['sudo']`，把**语句
  //     关键字** `time` 当命令名吃掉 —— `commandHeadEnd(['sudo','time','diskpart'])` = **2**。
  // 两种情形下真命令名都还在 `end` 之后，早退让下面的循环拿不到机会，于是
  // `<前缀><关键字><BARE>`（`su time diskpart`）与 `<前缀><关键字><wrapper><BARE>`
  // （`sudo time env diskpart`）里的关键字/wrapper/真命令名全部落进 `hasNoOperand`
  // 的词元循环被当成**非选项实参** → 该段不归 `unknown` → 落半径档 `inside`
  // → 大分类 mode=allow 时**静默放行**（而 `diskpart` 裸跑会阻塞等 stdin）。
  // 实测（真实档位表、`unknown=deny`、其余 allow）：`diskpart` / `time diskpart` /
  // `sudo time diskpart` 是 deny，`sudo time env diskpart` 是 **allow**；
  // `hasNoOperand` 差异 **4788/7920** 条（发现 5 的语料叉乘）。
  // 判据与 `headCommandNameOf`（:3750）**同源**：末个被吃掉的词元既不是语句关键字、  // 也不是前缀时，它才是命令名。两个否分支都落回下面的循环，由它按同一张转移表续判。
  //
  // ── ⚠️ 判据必须与 `headCommandNameOf` **逐字同源**（发现 8 的修法）────────────────
  // 此前这里少一项 `!LEAD_ASSIGN.test(...)`，而 `headCommandNameOf` 有它 ——
  // 两份守卫**已经漂移**，于是同一个 `NAME=value` 词元在两侧结论相反：
  //   · `commandHeadEnd` 的 ② 里 `sawPrefix && !PRIV_VALUE_IS_COMMAND[prevPrefix]` 对
  //     `sudo` / `doas` / `pkexec` / `gsudo` **恒真**且**先于** `isTargetEatingNameIn` 命中
  //     → 它把前缀之后的**第一个**词元无条件当命令名吃掉，而那个词元可能正是 `FOO=1`；
  //   · 这里缺守卫 → 把 `FOO=1` 当「真命令名」→ **提前 return**，不再走下面的推进循环。
  // 后果：真命令名（`diskpart`）落进 `hasNoOperand` 的实参循环被当成**非选项实参**
  // → 该段不归 `unknown` → 落半径档 `inside` → 大分类 mode=allow 时**静默放行**。
  // 实测（默认配置 category=allow → inside=allow、其余七档 ask）：
  //     time env diskpart        → ask  `['unknown']`  ✅
  //     FOO=1 time env diskpart  → **allow** `['inside']` ❌（多写一个赋值前缀）
  //     LANG=C LC_ALL=C time diskpart / FOO=1 then env diskpart / FOO=1 time nohup diskpart 同 ❌
  // 插桩：`commandHeadEndFull(['A=1','B=2','time','diskpart'])` = **2**、`w[1]="B=2"`
  // → 三项全过 → 早退；正确值是 4（吃到 `diskpart`）。
  //
  // ⚠️ 严重度**不在「权限宽松」而在硬故障**：`diskpart` 裸跑会**阻塞等 stdin**，
  // 而 DSH 是非交互执行环境 —— 工具调用直接挂住。加一个环境变量赋值即可触发。
  //
  // ⚠️ 判据复用模块级 `LEAD_ASSIGN` **单点**（与 `headCommandNameOf`、`unwrapWordsFrom`、
  // `commandHeadEnd` 的前导赋值剥离同源），**不新造正则** —— 四处若各写一份「什么算赋值」
  // 必然漂移，而漂移方向正是本条缺陷。
  //
  // ── ⚠️ 同一漂移的**第二项**：值选项词元（发现 11 的修法）──────────────────────────
  // 与 `LEAD_ASSIGN` 那次是同一族：`privOperandSkip` 的 ④ 支在「值选项的值是语句关键字」
  // 时返回 `k + 1`（**值选项自身**的下标），而这个返回值**同时是 `commandHeadEnd` 的推进
  // 结果** ⇒ `commandHeadEnd` 停在值选项上、`w[end - 1]` 就是 `-c` / `--command`。
  // 早退判据此前只拒收「关键字 / wrapper / 提权前缀 / `LEAD_ASSIGN`」四类，**不含值选项**
  // ⇒ 命中早退 `return end` ⇒ 下面的推进循环拿不到机会 ⇒ 真命令名（`diskpart`）落进
  // `hasNoOperand` 的实参循环被当成**非选项实参** ⇒ 该段不归 `unknown` ⇒ 落半径档 `inside`
  // ⇒ `priv=allow` 时**静默放行**（`diskpart` 裸跑会阻塞等 stdin，DSH 非交互环境下该次
  // 工具调用直接挂住 —— 是硬故障，不是「少一次弹窗」）。
  // 插桩（修复前）：`commandHeadEnd(['su','-c','time','diskpart'])` = **2**、
  // `commandHeadEndFull` = **2**、`headCommandNameOf` = **`'-c'`**、`hasNoOperand` = false；
  // 正确值 **4** / `'diskpart'` / true。`su --command time diskpart` 同（headName `'--command'`）。
  // ⚠️ 本项**是本处新增的**，`headCommandNameOf`（`:3931`）**尚未**有它 —— 不要读成
  // 「两处已同源」。实测：`headCommandNameOf(['su','-c','time','diskpart'])` = **`'-c'`**、
  // `['su','root','-c','time','diskpart']` = `'-c'`、`['su','--command','time','diskpart']`
  // = `'--command'`、`['runas','/user:a','-c','time','diskpart']` = `'-c'`
  // —— 它的早退（`:3981`）仍只拒收「关键字 / wrapper / 提权前缀 / `LEAD_ASSIGN`」**四类**，
  // 值选项词元一概放行。两处问的是同一件事（`w[end-1]` 是不是真命令名），
  // 若确实要求逐字同源，应作为**独立动作**去补 `headCommandNameOf` 那一项
  // （实测补上后 698 条 × 三函数 **0 差异** —— 行为上冗余：守卫命中后 `headEnd -= 1`，
  // 下面的推进循环最终仍返回同一个 `'-c'`。故**不为让注释成真而加死代码**），
  // 而不是在注释里宣告已完成。
  // 复用 `isPrivCommandValueFlag` **单点**（`:1769`，O(1) 查表，在 `:2725` 之前，无 TDZ）。
  if (end > 0) {
    const last = commandNameOf(w[end - 1])
    // ── ⚠️ 同一漂移的**第三项**：前缀自身的**普通选项**词元（发现 12 的修法）────────────
    // 与上面「值选项」那一项同族，但**不是同一个形态**：`commandHeadEnd` 的 ① 分支经
    // `skipPrefixArgs` 会把 `-l` 这类普通选项吃掉并**停在其上** ⇒ `w[end - 1]` 是 `-l`
    // 而非命令名 ⇒ 下面五项全过 ⇒ 提前 `return end` ⇒ 推进循环拿不到机会。
    // `-l` **确不在**上面任何一类判据内：`STATEMENT_KEYWORDS` false、非 `WRAPPERS`、
    // 非 `PRIV_PREFIXES`、`isPrivCommandValueFlag('-l')` false（表里只有 `-c`/`--command`）、
    // 不匹配 `LEAD_ASSIGN`。
    // 插桩（修复前）：`commandHeadEndFull(['su','-l','time','diskpart'])` = **2**、
    // he=2、hn=`'-l'`、`hasNoOperand`=false；正确值 hf=**4** / hn=`'diskpart'` / ho=true。
    // 对照 `su time diskpart` = he1/hf3/true。
    // 后果：该段不归 `unknown` ⇒ 落半径档 `inside` ⇒ `priv=allow` 下静默 allow；
    // `diskpart` 裸跑阻塞 stdin ⇒ **硬故障**（DSH 非交互环境下工具调用直接挂住）。
    // 触发条件：**需 `priv=allow`** —— 三种真实派生默认（mode=allow/ask/deny）下两侧
    // action **loosen=0 / tighten=0**（本行的可见面只在 `priv=allow` 一族）。
    //
    // ⚠️ **只补这一处，不要同步补 `headCommandNameOf`**：实测两处都补会让它在
    // 335,340 格中 **420 格**由 `'--command=x'` 退成 `'su'`，且引入 **77 格新 blast 假警告**
    // （`su --command=x /user:a …` 的 `/user:a` 被判 outside —— 正是 `:2511-2524` 自己
    // 记为「HEAD 的假警告」那一族）。判据同源，但**后果不同**，故不同步。
    //
    // 判据复用 `skipPrefixArgs:1710` 的同一判据（`token.charCodeAt(0) !== 45`）：
    // O(1)、无正则、无分配。
    if (last && !STATEMENT_KEYWORDS[last] && WRAPPERS[last] !== 1 && PRIV_PREFIXES[last] !== 1
      && !isPrivCommandValueFlag(String(w[end - 1]))
      && !(String(w[end - 1]).charCodeAt(0) === 45)
      && !LEAD_ASSIGN.test(String(w[end - 1]))) return end
  }
  let start = 0
  // 前导 NAME=value（与 commandHeadEnd / unwrapWords 同判据：至少留一个词元）
  while (n - start > 1 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(String(w[start]))) start += 1
  for (let guard = 0; guard <= n && start < n; guard += 1) {
    // 含空白的词元是引号包起来的整条命令行，不是命令名 —— 与 commandHeadEnd 同判据。
    if (/\s/.test(String(w[start]))) break
    const name = commandNameOf(w[start])
    if (!name) break
    // ① 语句关键字：关键字**永远不是可执行命令名**，跳过后继续（`time` → `env` → `diskpart`）。
    if (STATEMENT_KEYWORDS[name]) {
      // 跳关键字后**不能**就地取下一个词元：它可能又是一个关键字或前缀（`time ! env diskpart`）。
      // 故只推进一个词元，交给下一轮按同一张转移表继续判。
      //
      // ── 但关键字**自身的选项**必须先跨过（`time -p <cmd>` 的 `-p`）────────────────────
      // 只推一个词元时 `-p` 会占掉下一轮的位置，于是 `headFull` **少覆盖一个词元**：
      // `time -p env diskpart` 的 `headFull` 由 4 掉到 2，中间的 `env` 落进
      // `hasNoOperand` 的实参循环被当成**非选项实参** → 该段不归 `unknown` → 落半径档
      // `inside` → 大分类 mode=allow 时**静默放行**（而 `time env diskpart` 是 unknown）。
      // 推进方式复用 `skipPrefixArgs` —— 与 `segmentLabelFrom` 的关键字分支（`:775`）和
      // `pushHeadLabels`（`:1149`）**同源**，三处不各写一份「什么算关键字自己的选项」。
      //
      // 影响面**只在「关键字紧跟 `-` 开头词元」时**：`skipPrefixArgs` 遇到第一个非选项
      // 词元即停，故 `time rm …` / `then nohup rm …` 一族逐字不变（`nx === start + 1`）。
      let nx = start + 1
      try { const s = skipPrefixArgs(w, start + 1, name); if (s > nx) nx = s } catch (e) {}
      start = nx > start ? nx : start + 1
      continue
    }
    // ② 前缀（wrapper / 提权命令）：与 commandHeadEnd 的 ① 分支同源，复用 skipPrefixArgs
    //    与 privOperandSkip（后者处理 `su` / `runas` 的操作数）。
    if (WRAPPERS[name] === 1 || PRIV_PREFIXES[name] === 1) {
      let next = start + 1
      try { const nx = skipPrefixArgs(w, start + 1, name); if (nx > next) next = nx } catch (e) {}
      if (next <= start) break
      if (next < n) { try { next = privOperandSkip(w, name, start + 1, next) } catch (e) {} }
      start = next
      continue
    }
    // ── 进入 ③ 之前：前导 `NAME=value` **不是命令名**，跳过后继续（发现 9 的修法）──────
    // 上面那个早退守卫（`:2681`）只盖住「`commandHeadEnd` 已把赋值当命令名吃掉」的形态；
    // 这一支走的是**推进循环**，守卫够不到 —— 同一个 `NAME=value` 词元在两处结论相反：
    //   · `commandHeadEnd(['sudo','FOO=1','env','diskpart'])` = **2**：② 分支的
    //     `sawPrefix && !PRIV_VALUE_IS_COMMAND['sudo']` 对 `sudo` 恒真且**先于**
    //     `isTargetEatingNameIn` 命中，于是把前缀之后的第一个词元 `FOO=1` 当命令名吃掉；
    //   · 这里若把 `FOO=1` 当「命令头位置上的命令名」→ ③ 直接 `break`，`headFull` 停在 2。
    // 后果：真命令名（`diskpart`）与中间的 wrapper（`env`）落进 `hasNoOperand` 的词元循环
    // 被当成**非选项实参** → 该段不归 `unknown` → 落半径档 `inside` → 大分类 mode=allow 时
    // **静默放行**（而 `diskpart` 裸跑会阻塞等 stdin，DSH 非交互环境下工具调用直接挂住）。
    // 实测（`priv=allow` + `unknown=deny`、其余 ask）：
    //     sudo env diskpart        → deny `['unknown','priv']` ✅
    //     sudo FOO=1 env diskpart  → **ask** `['inside','priv']` ❌（多写一个赋值前缀）
    //     sudo FOO=1 time env diskpart / sudo FOO=1 nohup diskpart / sudo -u root FOO=1 env diskpart 同 ❌
    // 插桩：`commandHeadEndFull(['sudo','FOO=1','env','diskpart'])` = **2**（正确值 4）、
    // `w[1]="FOO=1"` → 三项全过 → 早退；而 `headCommandNameOf(同)` = `'diskpart'`
    // —— `:2659` 那句「与 `headCommandNameOf` 逐字同源」在该形态上此前**并未成立**。
    //
    // 判据复用模块级 `LEAD_ASSIGN` **单点**（`:621`，与 `headCommandNameOf:3868` 的早退守卫、
    // `commandHeadEnd:2785` 的前导赋值剥离同源），**不新造正则** —— 四处若各写一份「什么算
    // 赋值」必然漂移，而漂移方向正是本条缺陷。
    //
    // ⚠️ 只修这一支，**不动 `commandHeadEnd` 本体**：它的消费方 `blastRadiusOfSegment`
    // 靠 skip 判据处理赋值（改它会波及段级 blast 结论）。另外两支同族缺陷
    // （`nohup FOO=1 …`、`su root FOO=1 …`）走**不同代码路径**，本轮刻意不修 ——
    // 实测本行（`commandHeadEndFull` 的推进循环）对那两支**零影响**（前后逐字同值：
    // 10 个 wrapper 族 + `su`/`runas` 两族 × 45 关键字 × 2 平台，段级 blast / labels /
    // tiers 变化 0；4320 格 action 变化 0）。
    //
    // ⚠️ 但「走不同代码路径」**不等于**「wrapper 族走 label 侧」——此处曾如此归因，是错的：
    // wrapper 族的**半径档**由 `headCommandNameOf` 那一对行（该函数的早退守卫 +
    // 其推进循环的 `LEAD_ASSIGN` 步）修好，属**半径档侧**；真正留在 label 侧的只是它的
    // 另一半（`segmentLabels` 恒空 ⇒ `tiers` 空、`action` 不变，`ignored.md:115` 的缺陷
    // 本身仍在）。归因写错会让后来人去 label 侧找 wrapper 族的半径档问题。
    // 详见 `headCommandNameOf` 里推进循环那一行上方的实测记录。
    //
    // 收敛性：每轮 `start += 1` 至少推进一个词元，`guard <= n` 不可能死循环（与 ①② 同）。
    if (LEAD_ASSIGN.test(String(w[start]))) { start += 1; continue }
    // ③ 既不是关键字也不是前缀 → 这就是命令头位置上的命令名，吃掉它后停。
    start += 1
    break
  }
  return start
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
      const at = next > j ? next : j + 1
      // `su` / `runas` 的操作数不是命令名，跨过它继续推进 —— 判据与门控侧共用
      // `privOperandSkip` 一处（见其注释：`su root rm -rf /data` 的 `root`）。
      j = at < n ? privOperandSkip(w, base, j + 1, at) : at
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
    // 故 `su` / `runas` 退回纯「吃目标的命令名」判据（`su -c rm -rf /` 的值是 `rm`，
    // 在名单里，照吃；`su -c C:/Windows` 的值不在名单里，留给目标判档）。
    //
    // ── 判据必须覆盖**载荷族**与**两词 label**，不能只认 `isDestructiveLabel` ──────────
    // 只认破坏性名单会让 `su root find /data -delete` 的 `find` 不被吃掉（`find` **不在**
    // `DESTRUCTIVE_LABELS` 里 —— 它的破坏性来自后续 `-delete` / `-exec`），于是命令头停在
    // `root` 上、`headCommandNameOf` 取回操作数 `root` → `isCmdStyleSwitch('/data', …, 'root')`
    // 认不出命令域 → `/data` 被当 cmd 开关跳过 → 段级 blast 归 null → 半径档 `inside`
    // → `priv=allow` 时**静默放行**。实测：`su root find /data -delete` 与
    // `su root find /data -exec rm -rf {} +` 的段级 blast 是 null，而同目标的
    // `su root env find /data -delete`（wrapper 分支把它推进过去了）是 outside
    // —— 同一件事只因少一个 wrapper 就分叉。
    // 判据收敛到 `isTargetEatingNameIn` **单点**（与 `privOperandSkip` / `isPrivOperandWord`
    // 共用同一份）：那正是「哪些名字吃目标」的唯一来源（破坏性名单 ∪ 载荷族 ∪ 两词 label），
    // 三处若各写一份必然再次分叉 —— 那正是本文件反复要修的那类缺陷。
    //
    // ── 但载荷族/两词 label 的扩展**只对裸命令名**成立（`su` / `runas` 分支）──────────
    // `su` / `runas` 的值**本身就是命令或目标**（见上），而 `commandNameOf` 会按 basename
    // 取尾段 —— 于是 `/usr/bin/find`、`C:/Windows/System32/taskkill.exe` 这类**路径目标**
    // 也会解出 `find` / `taskkill`，命中载荷族而被当成命令名吃掉。
    // 实测（win32/posix、三方差分 136412 条）：不加守卫时 `su root /usr/bin/find`、
    // `su -c /usr/bin/find`、`runas /user:a /usr/bin/find` 等 **18 条**由 system 变 null
    // —— 那是把这条闸开过头造成的**新漏报**（方向最坏）。
    // 故**扩展部分**（载荷族 ∪ 两词 label）只认**裸名**：含路径分隔符的词元在
    // `su`/`runas` 之后一律当**目标**，留给判档（这正是 HEAD 的行为：
    // `su root /usr/bin/rm` 判 system —— 破坏性名单那一支照旧无条件生效，故不在此列）。
    //
    // 判据用「有没有路径分隔符」而不是再抄一份名单：裸名与路径的区分是**词法**的，
    // 不依赖任何表。`su -c rm -rf /` 的 `rm` 是裸名、照吃（`isDestructiveLabel` 本来就命中）；
    // `su -c C:/Windows` 含 `:`/`/`，不吃 —— 两条都保住。
    const bare = !/[/\\]/.test(String(w[j]))
    if ((sawPrefix && !PRIV_VALUE_IS_COMMAND[prevPrefix])
      || isDestructiveLabel(base)
      || (bare && isTargetEatingNameIn(w, j, base))) j += 1
    break
  }
  return j
}

/**
 * 该段的**命令头位置**上是否出现过提权前缀（`sudo` / `doas` / `su` / `pkexec` / `runas` / `gsudo`）。
 *
 * 判据 = **命令头位置链** + **`find -exec` 族递归**，复用既有的 `PRIV_PREFIXES`（不新造表）：
 *
 *     byHeadChain(words):
 *       剥前导 NAME=value
 *       沿前缀链走：
 *         当前词元是提权名 → true
 *         是 WRAPPERS → 跳过它与其选项，继续
 *         否则 → break（遇到真命令名）
 *     segmentPrivilege(words):
 *       byHeadChain(words) || 任一 -exec/-execdir/-ok/-okdir 之后的子链 byHeadChain
 *
 * ── 为什么必须是「命令头位置」而不是「扫段内全部词元」 ──────────────────────────
 * 两种朴素判据都有误报，且实测都能构造出来：
 *     rm sudo                  删一个名叫 sudo 的文件 → 被当成提权 ❌
 *     rm -rf ./sudo            同上 ❌
 *     mv sudo /tmp             同上 ❌
 *     find . -name sudo -delete 同上 ❌
 * 位置判据把这四种全部正确排除（反例 9 条实测全 false）。判据走的是**下标推进**，
 * 不复制数组 —— 与本文件其他几处一样避开 O(n²)（词元由 AI 生成、长度无上界）。
 *
 * ── 为什么递归 `find -exec` ────────────────────────────────────────────────────
 * `find . -exec sudo rm {} ;` 的提权前缀在 `-exec` **之后**，只看段首会漏。
 * 复用 FIND_EXEC_FLAGS（与 segmentLabels 同一份表），不另抄一份。
 *
 * @param {string[]} words 段词元
 */
export function segmentPrivilege(words) {
  const w = Array.isArray(words) ? words : []
  if (!w.length) return false
  // 命令头位置链：返回 true 当且仅当**在遇到真命令名之前**碰到了提权前缀。
  //
  // 本函数曾经收一个 `from` 起始下标形参 —— 参数化它是为了**不复制数组**：
  // 调用方曾在每个 `-exec` 上做一次 `uw.slice(i + 1)`（O(剩余词元) 拷贝），
  // 段内有 n 个 flag 时整体退化成 O(n²)（实测 n=8000 → 134 ms、16000 → 745 ms，
  // 端到端 `assessCommand` 769 ms）。而本函数在 `tierSetOf` 里对**每个破坏性段**
  // 被调用，属 tools/pre-execute 的判定热路径，且 buildCandidates 同步执行、
  // 早于 pendingApprovals.set —— 直接推迟弹窗，命令文本由 AI 生成、长度无上界。
  // ⚠️ `from` 形参**已删除**：唯一调用点传的是 `0`，故 `from > 0 ? from : 0` 恒取 `0`
  // —— 死形参。`-exec` 载荷族现在走下面 `chainTrue` 的反向 DP 表（读 `chainTrue[i + 1]`），
  // **已不再调用本函数**，因此「不切片」这条纪律由那张表承担，本函数只需从 0 起走。
  // 全程仍按下标推进，一次拷贝都不做（与 commandHeadEnd 同纪律）。
  const byHeadChain = (list) => {
    const a = Array.isArray(list) ? list : []
    const n = a.length
    let j = 0
    // 前导 NAME=value（`FOO=1 sudo rm -rf /`）：与 unwrapWords 同判据（至少留一个词元）
    while (n - j > 1 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(String(a[j]))) j += 1
    // 每轮至少吃掉一个词元，故 guard 取词元数即不可能漏判
    for (let guard = 0; guard <= n && j < n; guard += 1) {
      const raw = String(a[j])
      // 含空白的词元不是命令名（引号并成的整条命令行）：命令头到此为止，
      // 与 commandHeadEnd 同判据 —— 不猜引号里是什么语言写的。
      if (/\s/.test(raw)) return false
      const base = commandNameOf(a[j])
      if (!base) return false
      if (PRIV_PREFIXES[base] === 1) return true
      // wrapper 是透明包装：跳过它与其选项，继续找真命令名（`nohup sudo rm -rf /`）
      if (WRAPPERS[base] === 1) {
        const next = skipPrefixArgs(a, j + 1, base)
        j = next > j ? next : j + 1
        continue
      }
      // 遇到真命令名（既不是提权也不是 wrapper）→ 头链结束，其后的词元都是实参
      return false
    }
    return false
  }
  if (byHeadChain(w)) return true
  // `find` 族：`-exec` / `-execdir` / `-ok` / `-okdir` 之后跟的是**一条完整命令行**，
  // 它的命令头里可能有提权前缀。`-delete` 没有后续命令，不参与。
  const u = (() => { try { return unwrapWords(w) } catch (e) { return null } })()
  const uw = (u && Array.isArray(u.words) && u.words.length) ? u.words : w
  let start = -1
  for (let i = 0; i < uw.length; i += 1) {
    if (commandNameOf(uw[i]) === 'find') { start = i; break }
  }
  if (start < 0) return false
  // 廉价预筛：整段没有任何 `-exec` 族 flag 时不必进入下面的回填循环（与 segmentLabels
  // 同纪律）。它**只决定是否进入循环**，不消除循环内的开销 —— 平方退化曾出在「每个 flag
  // 重走一遍前缀链」上，修法是下面 `chainTrue` 的反向 DP 表（按 `i + 1` 读表，不切片），
  // **不是**这个预筛（本预筛与 `byHeadChain` 的起始下标无关：后者已不收 `from`）。
  let hasExec = false
  for (let i = start + 1; i < uw.length; i += 1) {
    if (FIND_EXEC_FLAGS[String(uw[i])]) { hasExec = true; break }
  }
  if (!hasExec) return false
  // ── 自段尾向前把「从该下标起跳的头链结论」一次算出来，让每个 flag 的判定 O(1) ──────
  //
  // 这里曾经对**每个** `-exec` 都从该处向后重走一遍前缀链（当时的 `byHeadChain` 收起始
  // 下标，写作 `byHeadChain(uw, i + 1)`），
  // 而链在「载荷是 wrapper、其后又没有真命令名」时会一路走到段尾 —— 于是 N 个 flag
  // × O(N) 行走 = O(N²)。触发形态是常规写法，不是构造输入：
  //     find . (-exec env)×N -exec rm {} +
  // `skipPrefixArgs` 会把紧随其后的 `-exec` 当成 env 的选项吃掉，链因此永不终止。
  // 实测 `segmentPrivilege`（纯词元构造）：
  //     N=500 → 13.9 ms、1000 → 54.1、2000 → **217.9 ms**（每翻倍 ×4.00，标准平方，
  //     输入仅 20 KB）；`-exec timeout` 同形（210.3 ms）。
  // 端到端 `assessCommand` N=2000 时 251.07 ms —— 而它在 tools/pre-execute 的判定热路径上，
  // 命令文本由 AI 生成、长度无上界。
  //
  // **等价性**：`byHeadChain` 每轮只按「当前词元」决定去哪个下标（前导 `NAME=value`
  // 前进一步、wrapper 走 `skipPrefixArgs`、提权名返 true、其余返 false），且每轮**至少
  // 前进一个下标** —— 于是它是这张有向无环图上的确定性行走，可以自尾向前按同一张
  // 转移表回填。转移判据与 `byHeadChain` 内部**同源**（同一个 commandNameOf / WRAPPERS /
  // PRIV_PREFIXES / skipPrefixArgs），不另写一份「什么算 wrapper」的名单。
  // 每个下标的 `skipPrefixArgs` 只调用一次，且各次行走的选项段互不重叠，故整体 O(n)。
  const chainTrue = new Uint8Array(uw.length + 1)
  for (let i = uw.length - 1; i >= 0; i -= 1) {
    const raw = String(uw[i])
    // 前导 NAME=value：剥掉它继续（与 byHeadChain 的 while 同判据：至少留一个词元）。
    //
    // **这一条必须排在下面的空白检查之前**：词法器把 `FOO="a b"` 输出成**含空白的单个
    // 词元** `FOO=a b`，若先查空白，这条链就停在赋值前缀上 —— `-exec FOO="a b" env … sudo rm`
    // 的提权前缀整个漏判。实测（priv=deny、wide=allow）：
    //     find . -delete -exec FOO="a b" env env env env env sudo rm -rf / {} +
    // 顺序颠倒时 segmentPrivilege=false → tiers=['wide'] → allow，用户显式设的
    // 「提权=拒绝」被绕过；同族的 `-exec A="x y" command -v sudo rm {} +` 则由 ask 变 allow。
    // byHeadChain 的 while 与 unwrapWords 都是**先剥再判**，这里同序才与它们等价。
    if (uw.length - i > 1 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(raw)) { chainTrue[i] = chainTrue[i + 1]; continue }
    // 含空白的词元不是命令名（引号并成的整条命令行）：命令头到此为止 —— 与 byHeadChain 同判据
    if (/\s/.test(raw)) continue
    const base = commandNameOf(uw[i])
    if (!base) continue
    if (PRIV_PREFIXES[base] === 1) { chainTrue[i] = 1; continue }
    if (WRAPPERS[base] === 1) {
      const next = skipPrefixArgs(uw, i + 1, base)
      chainTrue[i] = next < uw.length ? chainTrue[next] : 0
      continue
    }
    // 遇到真命令名（既不是提权也不是 wrapper）→ 头链结束
  }
  for (let i = start + 1; i < uw.length; i += 1) {
    if (!FIND_EXEC_FLAGS[String(uw[i])]) continue
    // **按下标推进，不复制后缀**：这里曾是 `byHeadChain(uw.slice(i + 1))` ——
    // 每个 flag 一次 O(剩余词元) 拷贝，n 个 flag 即 O(n²)（实测见上面的性能段）。
    if (chainTrue[i + 1]) return true
  }
  return false
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
/**
 * 丢掉 heredoc 正文，只留下**命令行**部分。
 *
 * 终止符取 `<<` 后紧跟的那个词（`<<EOF` / `<<'EOF'` / `<<-EOF` 都算），
 * 从它首次单独成行的位置截断；找不到终止符就只保留 `<<` 之前的部分
 * （正文范围不确定时宁可少扫，方向仍是「命令部分照常查」，不会因此放行真命令）。
 *
 * **提成单点**：`rawCommandNames` 与 `outsideTargetInUnparsable` 都要问「命令部分到哪为止」。
 * 两处各写一份正则必然漂移，而漂移的后果是把 heredoc 正文（**数据**，不是命令）
 * 当成命令扫 —— `cat > doc.txt <<EOF\nrm -rf is dangerous\nEOF` 会因为正文里出现
 * `rm` 而被判成破坏性命令。单点化与 `CMD_VARIABLE` / `TIER_RANK` 是同一条纪律。
 *
 * @param {string} source 原始文本
 * @returns {string} 已丢掉 heredoc 正文的文本
 */
function stripHeredocBody(source) {
  // 正则的三处细节都是**实测**逼出来的（各有一个方向）：
  //
  // ① `(?<!<)` 排除 here-string（`<<<x`）。它不是 heredoc —— 正文就是同一行的那个词，
  //    **不吞后续行**。不排除时 `[A-Za-z_]` 会从 `<<<x` 的第三个 `<` 之后读到标签 `x`，
  //    把其后整段当正文吞掉。真 bash 实测 `cat <<<x\nrm -rf v` → **v 被删**（会被放行）。
  // ② `\\?` 必须放在捕获组**外**。`<<\EOF` 的反斜杠转义分隔符是**合法 heredoc**
  //    （真 bash 实测 `cat <<\EOF\nrm -rf v\nEOF` → v **不被删**，正文是数据），
  //    但把反斜杠放进组内（`(['"\\]?)`）会让反向引用 `\1` 去匹配那个反斜杠：
  //    `<<\EOF` 上直接 NO-MATCH（实测），于是正文被当命令 → 八档全 deny 的**误拦**。
  // ③ 分隔符类必须是 bash **真正的**分隔符集合，且**不靠反向引用**配对引号：
  //    只允许引号**整体包住**分隔符（`(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1`）时，引号夹在
  //    分隔符**中间**的写法（`<<E"OF"`）被读成 `<<E`、标签取 `E` ⇒ 找不到终止符 `EOF`
  //    ⇒ 走 `!end` 分支把终止符**之后**的真命令整段丢掉。真 bash 实测
  //    `cat <<E"OF"\nbody\nEOF\nrm -rf v` → v **被删**（八档全 deny 下被放行）。
  //    同族漏网还有 `<<END-OF` / `<<END.OF` / `<<""` / `<< E"OF"` / `<<\E"OF"`。
  //    引号内的**换行**在真 bash 里是**语法错误**（实测 `cat <<'E` + 换行 + `OF'` →
  //    syntax error），故字符类排除 `\n`：那种形态本就不执行，NO-MATCH 只走 `!end`（收紧）。
  //    标签由 `heredoc[1]` 剥掉引号得到（bash 语义：引号只影响是否做参数展开，不属分隔符本身）。
  let out = ''
  let rest = source
  // ── 循环剥离**每一个** heredoc（发现 2）──────────────────────────────────────
  // 只处理第一个 opener 时，`slice(0, heredoc.index)` 把第一个 opener 之后的**一切**丢掉 ——
  // 第二个 heredoc 的正文被顺带丢掉（错误理由下的正确结果）。新写法把终止符之后的整段接回，
  // 于是第二个 heredoc 的头与正文重新进入被扫文本。
  //
  // ⚠️ 但**不能**无条件循环：真 heredoc 剥离后，下一个「opener」可能是引号/注释里的
  // **假 opener**（`echo "x<<y"`、`# a<<b`、`$((x<<y))`），它的 `!end` 分支会把其后整段
  // 真命令截掉 ⇒ 六处 fail-open（真 bash 实测这些命令**会执行**）。故加**方向守卫**：
  // `!end` 时若 `stripped === 0` 保持既有截断（与 HEAD 同向，不引入新放宽），否则 `break`
  // 返回当前已剥离的文本（**不**截断后续）。
  for (let stripped = 0; ; stripped += 1) {
    const heredoc = /(?<!<)<<-?[ \t]*\\?((?:'[^'\n]*'|"[^"\n]*"|[^\s;|&()<>'"\\])+)/.exec(rest)
    if (!heredoc) break
    const tag = heredoc[1].replace(/['"]/g, '')
    const afterTag = heredoc.index + heredoc[0].length
    // ① `<<TAG` **同一行**的剩余部分是命令行，必须保留 —— 操作符之后照常执行。
    //    真 bash 实测 `rm -rf ./build <<EOF ; rm -rf v\nbody\nEOF` → v **被删**
    //    （`&&` / `|` / `&` 同；`||` 因左侧成功而不执行，保留它只会多扫，方向是收紧）。
    const nl = rest.indexOf('\n', afterTag)
    const lineEnd = nl < 0 ? rest.length : nl
    const sameLine = rest.slice(afterTag, lineEnd)
    const body = rest.slice(lineEnd)
    // 从 `<<TAG` 之后找首次「单独成行」的 TAG（允许前置制表符，兼容 `<<-`）。
    // 标签可能含 `.` / `-` 等正则元字符，必须转义后再拼进终止符正则。
    const tagRe = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const end = new RegExp('^[ \\t]*' + tagRe + '[ \\t]*$', 'm').exec(body)
    if (!end) {
      // 找不到终止符：正文范围不确定，只保留 `<<TAG` 之前的部分 + 同行剩余（宁可少扫）。
      // 只对**第一个** opener 保持这个截断（与既有行为同向）；后续 opener 是假 opener 的
      // 可能性很高，截断它会吞掉真命令，故 break 交回当前文本。
      if (stripped === 0) return out + rest.slice(0, heredoc.index) + sameLine
      break
    }
    // ② **终止符之后**的整段也是命令行。真 bash 实测
    //    `rm -rf ./build <<EOF\nbody\nEOF\nrm -rf v` → v **被删**。
    //    终止符行上的尾随内容（`EOF ; rm -rf v`）不是命令（实测**不**执行），
    //    故从终止符行之后的第一个换行起截取，只丢正文。
    const nl2 = body.indexOf('\n', end.index + end[0].length)
    out += rest.slice(0, heredoc.index) + sameLine
    if (nl2 < 0) { rest = ''; break }
    rest = body.slice(nl2)
  }
  return out + rest
}

/**
 * 引号感知分词器：引号内的**空白与操作符**都不算分隔符，token 内的引号按 bash 语义剥掉。
 *
 * 为什么必须是**一份**实现（而不是「先原切分、判不出再合并」的两份）：原实现先用
 * `body.split(/[\n\r;|&(){}<>]+/)` 切，而这个正则**对引号无感知** —— 引号**内**的
 * `& | ; ( ) { } < >` 同样被切开，切碎后的两片各自都不含完整引号对，而
 * `mergeQuotedWords` 只在**引号内的空白**上合并，无从恢复。于是判不出目标 ⇒
 * `outside` 档失明。真 bash 实测这些形态**会执行**（`outside=deny`、其余七档 allow 下
 * 裸命令 deny、带构造 allow）：`rm -rf "D:/R&D"`、`"D:/my project (old)"`、`"D:/a|b"`、
 * `"D:/a;b"`、`"D:/a&b"`、`"D:/my project"/sub`、`"D:/data;backup"`、
 * `"D:/Project {old}"`；对照 `"/data/my project"`（无操作符字符）本就判 deny ——
 * 同一语义两个结论，正是本文件反复要修的那类漂移。
 *
 * 两份实现合并成一份后**没有第二候选**（调用方只用它）：方向说明见
 * `outsideTargetInUnparsable`（多认目标只会让更多档参与「取最严」，不放宽任何东西）。
 *
 * 返回**段数组**（每个操作符切出一段）而不是拉平成一维：调用方按段调
 * `blastRadiusOfSegment`，拉平会让后一段的命令名被前一段当成目标实参。
 *
 * @param {string} text 已丢掉 heredoc 正文的文本
 * @returns {string[][]} 每段的词元（引号已剥）
 */
function splitQuotedTokens(text) {
  const out = []
  let seg = []
  let cur = ''
  let quote = null
  // `has` 区分「空词元」与「还没有词元」：`cat ""` 的第二个词元是**空串**而不是不存在。
  let has = false
  const flushTok = () => { if (cur || has) { seg.push(cur); cur = ''; has = false } }
  const flushSeg = () => { flushTok(); if (seg.length) { out.push(seg); seg = [] } }
  for (const ch of String(text)) {
    if (quote) {
      // 引号**内**：一切字符都是普通字符（空白与操作符都不切），但引号本身按 bash 语义剥掉
      if (ch === quote) quote = null
      else cur += ch
      has = true
    } else if (ch === '"' || ch === "'") {
      quote = ch
      has = true
    } else if (ch === '\n' || ch === '\r' || ch === ';' || ch === '|' || ch === '&'
      || ch === '(' || ch === ')' || ch === '{' || ch === '}' || ch === '<' || ch === '>') {
      flushSeg()
    } else if (ch === ' ' || ch === '\t' || ch === '\f' || ch === '\v') {
      flushTok()
    } else {
      cur += ch
      has = true
    }
  }
  flushSeg()
  return out
}

/**
 * 整行读不懂时，原文里是否**读得出一个 `outside` 目标**（工作区外）。
 *
 * 为什么需要它：整行 `ok:false`（heredoc / 悬空操作符 / 未闭合引号）时没有词元可判，
 * 那条路径的档位集合由 `groupTiersOf(names) + priv + RADIUS_TIERS_WHEN_UNREADABLE` 拼成，
 * 而 `RADIUS_TIERS_WHEN_UNREADABLE` 是 `wide ∪ unknown ∪ inside` —— **不含 `outside`**。
 * 于是用户显式配的 `outside=deny` 在这条路径上整个失明（fail-open）：
 *     rm -rf /etc              → deny（段级 outside 档）
 *     rm -rf /etc <<EOF…EOF    → **allow** ← 同一命令，只因多了个 heredoc
 *
 * ── 为什么不能「无条件并入 `outside`」──────────────────────────────────────────
 * `outside` 是「工作区**外**」这一**具体**档，而这条路径上「读不出目标」的语义是
 * 「可能区内、可能大范围」—— 不是「确定在区外」。无条件并入会让**八档全 allow** 的
 * 用户也拿到一个 `outside` 档，`test/shell-parse.mjs` 的 58d / 58e3 正是钉这一点
 * （那两条断言用的目标是 `C:/Windows` 与 `./build`，**都不是** `outside`）。
 *
 * 故判据收窄为：**只有原文里真的读得出一个落在工作区外的目标时**才并入 ——
 * 这与段级路径对同一目标给出的结论同源（`blastRadiusOfSegment` + `radiusTierOf`），
 * 不是另造一套「哪里算区外」的知识。
 *
 * ⚠️ 目标**可能属于另一个段**（`rm -rf ./build && echo /etc <<EOF` 的 `/etc` 属于 `echo`）——
 * 那是**假阳性**，方向是收紧（多一个档参与取最严），与 `rawCommandNames` 的粗提同一条
 * 取舍：多认几个只会让更多档参与「取最严」，不会放宽任何东西。
 *
 * ⚠️ 必须丢掉 heredoc 正文（`stripHeredocBody`）：正文是**数据**，不是命令，
 * 拿它判档会让 `cat > doc.txt <<EOF\nrm -rf /etc\nEOF` 凭空多出一个 `outside` 档。
 *
 * @param {string} source 整行原文
 * @param {object} [opts] 判档选项（`home` / `userHome` / `platform` / `isOutsideWorkspace`）
 * @returns {boolean} 原文里读得出工作区外的目标时为真
 */
function outsideTargetInUnparsable(source, opts) {
  const body = stripHeredocBody(String(source == null ? '' : source))
  // 切分与 `rawCommandNames` **同一份判据**（空白与操作符），不另写一套 ——
  // 两条路径对「哪一段是命令」的认识必须一致，否则同一个 heredoc 在
  // 「查 deny 例外」与「判 outside 档」两处看到不同的命令集合。
  //
  // ⚠️ 但切分**必须引号感知**：`body.split(/[\n\r;|&(){}<>]+/)` 对引号无感知，引号**内**的
  // `& | ; ( ) { } < >` 同样被切开，而两片各自都不含完整引号对 ⇒ 判不出目标 ⇒
  // `outside` 档失明（真 bash 实测 `rm -rf "D:/R&D"` 等会执行）。故改用
  // `splitQuotedTokens`（引号内空白与操作符都不切、token 内引号按 bash 语义剥掉）。
  // 词元已剥引号，无需再套一层「剥成对首尾引号」的正则。
  for (const tokens of splitQuotedTokens(body)) {
    let b = null
    try { b = blastRadiusOfSegment(tokens, opts) } catch (e) { b = null }
    // 判据问的是**档**（`radiusTierOf`）而不是 blast level：`outside` 档只由
    // `level === 'outside'` 产出（`system` / `home` 那一族归 `wide`，不归 `outside`）。
    if (b && radiusTierOf(b) === 'outside') return true
  }
  return false
}

export function rawCommandNames(text) {
  const out = []
  // 去重集合无原型：键是 label（来自命令文本）。用 `{}` 时 `constructor` / `__proto__`
  // 这类名字恒判「已见过」而被丢弃 —— 它们恰是本函数要抓出来的命令名。
  const seen = Object.create(null)
  // 丢掉 heredoc 正文（`<<TAG` 之后到终止符之间的内容是数据，不是命令 —— 见函数注释）
  const body = stripHeredocBody(String(text == null ? '' : text))
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
// 同一判据的**非 sticky** 视图（判档侧要的是「这个词元是不是 cmd 风格变量」，
// 不是「从某个下标起能不能读到它」）。从 CMD_VARIABLE 派生，不另写一份正则 ——
// 两份手写必然漂移，而漂移的后果是某类变量重新被判成「工作区内的相对路径」。
const CMD_VARIABLE_RE = new RegExp(CMD_VARIABLE.source)
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
 * 删掉 bash 的**续行符**（`\` + 换行）—— 必须在**分词之前**做（发现 3 的修法）。
 *
 * 为什么必须在分词之前：bash 在词法阶段就删掉续行符，**早于**识别多字符操作符。于是
 * `>\<NL>&2` 在 bash 里就是 `>&2`（描述符复制，不需要目标），而本文件的词法器是**边扫
 * 边匹配**操作符的：它先看到 `>`、把 `REDIRECT_OPERATOR` 匹配成**单字符** `>`（下一个字符
 * 是 `\` 而不是 `&`）→ `pending = 'write'`；随后 `\`+换行 被转义分支吃掉；再随后那个 `&`
 * 落进 `&` 分支 → `ampNoTarget` 置位（重定向无目标）→ 整行 `ok:false`。
 *
 * 后果不是「少分一段」而是**整条命令的判定路径被换掉**：`ok:false` 路径的档位集合不含
 * `outside`、且**只认 deny 例外** —— 用户显式配的 `outside=deny` 与**全部 ask 例外**在这条
 * 路径上整个失明（fail-open，本项目最高风险方向）。实测（`outside=deny`、其余七档 allow，
 * 四条 `bash -n` 全 OK、真实执行会跑）：
 *     rm -rf /tmp/pgx >&2          → deny ✅
 *     rm -rf /tmp/pgx >\<NL>&2     → **allow** ❌
 *     rm -rf /tmp/pgx >\<NL>& /tmp/log → **allow** ❌
 *     rm -rf /tmp/pgx <\<NL>&2     → **allow** ❌
 *
 * 对照实验确认根因是「**续行符把多字符操作符劈开**」，而不是「扫描 `&` 时没跳续行符」：
 *     echo a >& /tmp/log       → 正常（无续行符）
 *     echo a >\<NL>> log       → 正常（`>>` 能拼回来：`>` 分支会把下一个 `>` 再匹配一次）
 *     echo a >\<NL>& /tmp/log  → **失败**（`>` 与 `&` 被劈开，`&` 走了后台分支）
 *
 * ── 为什么不写成「无条件 `input.replace(/\\\n/g, '')`」（3 行版）───────────────────
 * 那个版本**有真实副作用**，会**新开一条 fail-open**（已用真 bash 复核）：bash 的续行符
 * **不是**在任何位置都生效，本函数必须与 bash 的边界一致：
 *   · **注释内不生效** —— 注释在换行处结束，`\` **不延长**它。实测
 *     `echo hi # c\` + NL + `rm -rf victim` 里 **victim 真的被删**（bash 把第二行当新命令
 *     执行）。无条件剥离会把两行粘成**一条注释**、把 `rm` 藏进注释里 ——
 *     实测该形态由 `deny` 变 **`allow`**，是修法自己引入的放宽。
 *   · **单引号内不生效** —— 那里 `\` 是字面量（实测 `'a\<NL>b'` 的输出是 `a\`+NL+`b`）。
 *   · **双引号内生效** —— 实测 `"a\<NL>b"` 输出 `ab`。
 * 故本函数做一次**轻量词法扫描**：单引号块 / 双引号块 / 注释块原样搬运，只删**块外**的
 * 续行符。扫描只认「块」，不解析命令 —— 与 `decomposeCommand` 本体保持同一粒度。
 *
 * ── ⚠️ 唯一一处**不删**的续行符：夹在两个 `<` 之间的那一个 ─────────────────────────
 * bash 的词法真值确实是 `<\<NL><` ≡ `<<`（heredoc 操作符），但**本文件的词法器认出 heredoc
 * 就整行 `ok:false`**（见 `decomposeCommand` 里的 heredoc 检查），而 `ok:false` 路径的档位
 * 集合**不含 `outside`**、且**只认 deny 例外** ⇒ 用户显式配的 `outside=deny` 在这条路径上
 * 整个失明（fail-open）。实测（`outside=deny`、其余七档 allow，真 bash 下 `bash -n` = OK
 * 且**真的执行**）：
 *     rm -rf /tmp/x <\<NL>< EOF + NL + x + NL + EOF
 *       → 不剥离（= HEAD 行为）：**deny** ✅（`ok:true`，`outside` 档命中）
 *       → 剥离：**allow** ❌（`ok:false` / `code=unparsable`，档位集合里没有 `outside`）
 * 即「按 bash 语义把它粘成 heredoc」这一步**本身**就是本轮新开的放宽面 —— 它把一条 HEAD 上
 * `ok:true` 且判 deny 的命令推进了 `ok:false`。故这里取「与 HEAD 相同」：**不删**这个续行符，
 * 词法器的转义分支会原样跳掉 `\`+换行、把两个 `<` 当**独立**重定向 —— 与 HEAD 逐格相同。
 *
 * 为什么不改成「认 heredoc 但保留档位」：那要动 `ok:false` 路径的档位集合，是**另一件事**
 * （忽略清单里既有任务），超出本函数范围；本函数只负责不让自己的剥离**新开**放宽面。
 * 判据只排除**两侧都是 `<`** 的那一种：其余形态（`>\<NL>&` / `>\<NL>>` / `<\<NL>&` …）的
 * 剥离是本函数存在的理由，一格都不能退。
 *
 * ⚠️ 方向：本函数只**删**字符、不新增任何段边界；它把「被劈开的操作符」拼回去，而拼回去
 * 的形态在 bash 里**本来就合法**（`bash -n` = OK）。故它只会让判定从「读不懂」回到
 * 「读得懂」，不会把合法命令判成非法，也不会放宽任何东西。
 *
 * @param {string} src 原始命令行
 * @param {'bash'|'pwsh'} sh 方言（pwsh 的续行是反引号，由词法器自身处理，本函数不介入）
 * @returns {string} 已删掉续行符的命令行
 */
function stripLineContinuations(src, sh) {
  // pwsh 的续行不是 `\`；没有续行符时原样返回（**零分配**，判定热路径）
  if (sh !== 'bash' || src.indexOf('\\\n') < 0) return src
  const isWordBreak = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r'
    || c === ';' || c === '|' || c === '&' || c === '(' || c === ')' || c === '<' || c === '>'
  const out = []
  // `#` 只在**词首**才是注释（与词法器的 `char === '#' && !started` 同判据）。
  // 误判方向的取舍：把「其实不是注释」的位置当成注释 ⇒ **少删** ⇒ 退回改动前的行为
  // （不放宽）；反过来才会把命令藏进注释。故词界判定宁可**偏宽**。
  let wordStart = true
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i]
    // ── 单引号块：原样搬运（`\` 在里面是字面量，**不删**）──
    if (c === "'") {
      out.push(c)
      for (i += 1; i < src.length; i += 1) { out.push(src[i]); if (src[i] === "'") break }
      wordStart = false
      continue
    }
    // ── 双引号块：`\`+换行 **要删**（bash 在双引号内照样续行），其余 `\x` 原样 ──
    if (c === '"') {
      out.push(c)
      for (i += 1; i < src.length; i += 1) {
        const d = src[i]
        if (d === '\\') {
          if (src[i + 1] === '\n') { i += 1; continue }
          out.push(d)
          if (i + 1 < src.length) { i += 1; out.push(src[i]) }
          continue
        }
        out.push(d)
        if (d === '"') break
      }
      wordStart = false
      continue
    }
    // ── 注释块：到换行为止原样搬运（`\` **不延长**注释，见函数头实测）──
    if (c === '#' && wordStart) {
      for (; i < src.length; i += 1) { out.push(src[i]); if (src[i] === '\n') break }
      wordStart = true
      continue
    }
    // ── 续行符：删掉（本函数存在的理由）──
    //
    // ⚠️ **例外**：夹在两个 `<` 之间的续行符**不删** —— 删了会把它粘成 heredoc 操作符 `<<`，
    // 而词法器认出 heredoc 就整行 `ok:false`，于是丢掉 `outside` 档与全部 ask 例外
    // （fail-open，详见函数头「唯一一处不删的续行符」）。判据只看**紧邻的两个字符**：
    // 本分支一次只删一个 `\`+换行，故「粘成 `<<`」当且仅当 `\` 的前一个字符与换行之后的
    // 那个字符**都是** `<`。其余形态（`>\<NL>&` / `>\<NL>>` / `<\<NL>&` / `>\<NL>|` …）
    // 照旧剥离 —— 那正是本函数存在的理由，一格都不退。
    //
    // 不删时**落到下面的转义分支**：它把 `\`+换行 原样搬进结果，于是词法器看到的就是
    // HEAD 看到的那串文本（HEAD 的转义分支同样只跳过这两个字符），逐格回到 HEAD 的行为。
    const splitHeredoc = c === '\\' && src[i + 1] === '\n'
      && out[out.length - 1] === '<' && src[i + 2] === '<'
    if (c === '\\' && src[i + 1] === '\n' && !splitHeredoc) { i += 1; continue }
    out.push(c)
    // 转义字符：连同被转义的那一个一起搬运，且它不构成词界
    if (c === '\\' && i + 1 < src.length) { i += 1; out.push(src[i]); wordStart = false; continue }
    wordStart = isWordBreak(c)
  }
  return out.join('')
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
  const sh = shell === 'pwsh' ? 'pwsh' : 'bash'
  // 续行符必须在**分词之前**删掉（发现 3 的修法，理由与边界见 `stripLineContinuations`）。
  // ⚠️ `assessCommand` 的整行 `ok:false` 分支仍用**原始 source** 粗提命令名（那里不做本
  // 替换），故「读不懂」路径的 deny 例外匹配面不受本行影响。
  const input = stripLineContinuations(String(source == null ? '' : source), sh)
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
  // opaque 构造的**原文**（`$( … )` / 反引号 / `( … )` / `{ … }` 整块，含定界符），按出现次序。
  //
  // 存在的理由（发现 1 的修法）：判定侧要问「**opaque 构造自己有没有藏一个破坏性命令**」，
  // 而 `seg.words` 只包含构造**之外**的可读词元 —— 构造里那个命令名在词元列表里根本不存在。
  // 词法器是**唯一**知道「哪一段文本被判成了 opaque」的地方，故由它把原文记下来交给判定侧：
  // 判定侧再拿别的东西（`seg.text` 前缀切片之类）去反推，就是同一份知识写两遍，
  // 而本文件反复记录的那类缺陷正是「两处各写一份判据必然漂移」。
  //
  // ⚠️ 与 `segOpaque`（只记**第一个**原因）不同，这里是**全部**构造：一段里可以出现多个
  // （`rm -rf ./x $(a) $(rm -rf /)`），漏记任何一个都可能漏掉真正的载荷。
  let segOpaqueTexts = []
  let pending
  let nextOp = 'start'
  // 「最后那个 `&` 前面**有内容**吗」—— 供行尾悬空检查区分「合法的异步列表收尾」与
  // 「真悬空」。**只在 `&` 分支写入**，而 `nextOp = '&'` 也只在那个分支出现，
  // 故 `nextOp === '&'` 时本标记必然描述的是**最后那个** `&`（两者严格配对，不会串台）。
  // 见行尾检查处的说明：`echo a &` 合法而 `echo a & &` / `echo a | &` 不是。
  let ampAfterContent = false
  // 「最后那个 `&` **前面**有一个等着目标的重定向」—— `echo a > & (b)` / `> & $(b)` /
  // `> & { b; }` / `> & )` / `echo a > & b` 在 bash 里都是
  // `syntax error near unexpected token '&'`（`&` 不是 `>` 的目标）。
  //
  // ⚠️ **不能复用 `ampNoTarget`**（发现 4 的修法）：那个是**局部 const**、只在 `&` 分支里
  // 活着，而 `&` 分支的 `flushSegment()` 会把 `pending` 复位 —— 行尾那条保留的词元级判据
  // `pending !== undefined && !started`（约 `:3987`）于是看不到 `&` **之前**的那个 `>`。
  // 且 `ampNoTarget` 只写进 `ampOk`，而 `ampOk` 仅在「段无内容」时才决定是否报错：
  // `&` 后面还有内容时 `segHasContent` 为真 → 短路 → 整行照旧 `ok:true`。
  //
  // 故另立一个**跨段存活**的标记：`nextOp = '&'` 只在 `&` 分支出现，而本标记在该分支内
  // 按「**有任何一个** `&` 满足条件」置位（粘性，见该分支内的说明）—— 故它描述的是
  // 「行内存在一个前面挂着无目标重定向的 `&`」，不限于最后那个。
  // 在 `flushSegment()` **之前**取值（它会把 `pending` / `started` 复位）。
  //
  // 实测（修复前 → 修复后，`echo a > & b` 同形）：
  //     echo a > & (b) / > & $(b) / > & { b; } / > & )   ok:true → **ok:false**
  // 而合法形态**不得误伤**（三格的 `ampNoTarget` 均为 false，故本标记为 false）：
  //     echo a > b & / echo a 2>&1 & / echo a > $f &   → 照旧 ok:true
  let ampTargetMissing = false
  // 「当前这个等着目标的重定向，它的目标是不是一个 **opaque 构造**」—— `'none'` / `'word'`
  // / `'not-word'` 三态，供 `&` 分支的 `ampNoTarget` 排除**误判**（见那里的完整论证）。
  //
  // ── 为什么必须是**逐重定向**的标记，而不是「本段出现过 opaque 构造」（`segOpaque`）──
  // 后者**过宽**：`echo a $(b) > & c` 的 `$(b)` 是**命令参数**、与后面的 `>` 毫无关系，
  // 而该形态在 bash 里仍是 `syntax error`（`bash -n` 实测）。按 `segOpaque` 口径会把它
  // 一并放行 —— 那是**新开的 fail-open**（实测：`echo a $(b) > & c` / `echo a {b} > & c` /
  // `echo a "x$(y)" > & c` / `echo a \`b\` > & c` / `echo $(a) > & b` 五格由 ok:false 变
  // ok:true，`outside=deny` 下同一批命令由 deny 变 allow）。故本标记只在
  // 「**opaque 构造紧跟在待读重定向之后**」时置位，`echo a > $(b) > & c` 里第二个 `>`
  // 会把它复位（那个 `>` 确实没有目标，仍是语法错误）。
  //
  // 三态而非布尔：同一重定向后可能跟**多个** opaque 构造（`echo a > (c) $(b) & d`），
  // bash 只在「全部可作字面词」时才合法，故只要**出现过一个**不可作词的构造，
  // 结论就锁定为 `'not-word'`（`word` 只在仍是 `'none'` 时写入）。
  let redirectOpaqueTarget = 'none'
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

  // 「本段到目前为止有没有内容」—— **单一实现**，两个调用方问的是同一个问题：
  //   · flushSegment      —— 本段值不值得产出一个段；
  //   · 行尾悬空操作符检查 —— 上一个操作符后面到底有没有东西（段边界可不可信）。
  //
  // 曾经两处各写一份：flushSegment 写全了，行尾检查只写 `started` —— 于是同一个概念
  // 有两个修改点，而其中一份是错的。
  //
  // ⚠️ `started` 必须在里面，且不能反过来只写它：
  //   · 不能去掉 —— 行尾 `echo a | cat` 结束时 `cat` 还在 wordText 里没进 words，
  //     只看数组会把这条合法命令判成悬空操作符；
  //   · 不能只有它 —— `started` 是**词元级**状态，遇到引号外空白就被 flushWord 复位，
  //     而分组块 / 命令替换这类构造**产不出词元**（它们被标记 opaque），于是
  //     `Get-Content x | ForEach-Object { $_ }` 的行尾被判成「| 后面什么都没有」，
  //     整行 ok:false → 段边界全部丢失 → **弹窗没有分段**，且 allow/ask 例外一律不认
  //     （ok:false 路径只认 deny 例外），「默认放行 + 个别命令要求确认」这个配置下
  //     末尾挂一个括号就等于把那条确认规则抹掉（fail-open）。
  //
  // 保留条件含 segOpaque：`(git status)` 这类分组段有文本但提取不出词元，
  // 它必须成为一个「读不懂的段」（code: unparsable）而不是被静默丢弃 ——
  // 丢弃会让整行变成 ok:false，虽然同样落分类默认值，但段级展示与 code 就没了。
  // 但**不**按 segText 保留：`printf x >\n~/.ssh/keys` 的换行处文本是 `printf x >`，
  // 按文本保留会凭空多出一个「只有重定向操作符」的段。
  const segHasContent = () => started || words.length > 0 || writeTargets.length > 0 || readTargets.length > 0 || segOpaque !== null

  // 返回值 = 「本段有没有内容」（与 `segHasContent` 同判据，供 `&` 分支在复位**之前**取用）：
  // `&` 的合法性取决于它**前面**有没有内容，而本函数会把状态全部复位，故只能由它带回。
  const flushSegment = () => {
    flushWord()
    const text = segText.trim()
    const hasContent = segHasContent()
    if (hasContent) {
      segments.push({
        op: nextOp,
        text,
        words,
        writeTargets,
        readTargets,
        dynamic: segDynamic,
        opaque: segOpaque,
        opaqueTexts: segOpaqueTexts,
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
    segOpaqueTexts = []
    pending = undefined
    nextOp = 'start'
    return hasContent
  }

  const markOpaque = (reason) => { if (segOpaque === null) segOpaque = reason }
  // 记下 opaque 构造的原文（见 `segOpaqueTexts` 的说明）。与 `markOpaque` **分开**：
  // 前者只认第一个原因（段级语义），本函数每个构造都要记（判定侧要逐块查载荷）。
  const noteOpaqueText = (raw) => { if (raw) segOpaqueTexts.push(String(raw)) }

  // ── opaque 构造是否可以充当**当前待读重定向的目标**（bash 语法真值，`bash -n` 实测）──
  // 判据只在「本段正等着一个重定向目标、且还没产出任何词元」时才有意义 ——
  // 其余情形下这个构造与重定向无关，不得影响 `redirectOpaqueTarget`。
  //
  //   · `$( )` / 反引号 / 双引号内的 `$( )` → **可作词**（`echo a > $(mktemp) & echo done` OK）
  //   · `( )` 子 shell                → **不可作词**（`echo a > (mktemp) & echo done` SYNTAX-ERR）
  //   · `{ }` 花括号组                → 看内容，见 `braceIsCommandGroup`
  //   · 孤立 `}`                      → 可作词（`echo a > } & echo done` OK，是字面词）
  //   · 孤立 `)`                      → **不可作词**（`echo a > ) & echo done` SYNTAX-ERR）
  //
  // 为何 `(` 与 `)` 不同：bash 里 `)` 只可能是**闭合**一个 `(`；既然 `(` 形态非法，
  // 孤立的 `)` 同样非法。而 `{` / `}` 在 bash 里是**保留字**，只有「作为独立词」时才是
  // 分组定界符 —— `}` 单独出现只是一个普通词（实测合法），故两者也不对称。
  //
  // ⚠️ 本函数**只**在 `pending !== undefined && !started` 时写入：`started` 为真意味着
  // 重定向目标已经产出（或该构造是命令参数），与「无目标」无关，不得参与。
  const noteOpaqueTarget = (isWord) => {
    if (pending === undefined || started) return
    if (!isWord) redirectOpaqueTarget = 'not-word'
    else if (redirectOpaqueTarget === 'none') redirectOpaqueTarget = 'word'
  }
  // 花括号是**分组**（不可作重定向目标）还是**字面词 / 花括号展开**（可作）：
  // bash 的分组要求「以 `;` 或换行收尾」，否则整个 `{…}` 只是一个词 —— `bash -n` 实测：
  //     `> {mktemp} & …` OK、`> { b } & …` OK、`> {a,b} & …` OK、`> } & …` OK
  //     `> { b; } & …` SYNTAX-ERR、`> {b;} & …` SYNTAX-ERR、`> {;} & …` SYNTAX-ERR
  //     `> { b; c } & …` OK ← 注意：**只有末尾**的 `;` 才定分组，中间的 `;` 不定
  // 故判据是「**最后一个**分隔符之后只剩空白」，不是「内容里有 `;`」。
  //
  // ── ⚠️ 判据必须在**词法层面**做，不能直接在原始文本上跑正则（发现 4 的修法）──────────
  // 旧实现是 `/;[\s]*$/.test(content) || /[\n\r]/.test(content)` —— 它问的是「**文本里**
  // 有没有换行 / 结尾有没有分号」，而 bash 问的是「**词法上**有没有一个未转义、未被引号
  // 包裹的分隔符」。两者在下面两族上分叉（都实测过：`bash -n` = OK、真实执行会跑）：
  //
  //   ① **引号内的换行**：`{ "a` NL `b" }` 里的换行在双引号内，是**字面字符** ——
  //      整个 `{…}` 只是一个词（bash 会创建字面名为 `{` 的文件、exit=0）。
  //      旧判据看到文本里有 NL → 判成分组 → `noteOpaqueTarget(false)` →
  //      `redirectOpaqueTarget = 'not-word'` → `&` 触发 → 整行 `ok:false` → 丢 `outside` 档。
  //   ② **转义分号 `\;`**：`{ a\; }` 里的 `;` 被转义，是**字面字符**，同样只是一个词。
  //
  // 误判的后果与 `redirectOpaqueTarget` 那条注释同源：整行 `ok:false` 路径的档位集合
  // **不含 `outside`**、且**只认 deny 例外**，于是用户显式配的 `outside=deny` 与全部 ask
  // 例外在这条路径上整个失明（fail-open）。实测（`outside=deny`、其余七档 allow）：
  //     rm -rf /tmp/pgx > { a b } & echo done   → deny ✅（对照格）
  //     rm -rf /tmp/pgx > { a NL b } & echo done    → **allow** ❌
  //     rm -rf /tmp/pgx > { "a NL b" } & echo done  → **allow** ❌
  //     rm -rf /tmp/pgx > { a\; } & echo done       → **allow** ❌
  //
  // ⚠️ 三支都要修：仲裁的 V4 修法修好了靶 1/靶 2，**靶 3（`\;`）仍漏** ——
  // 因为它的扫描没有把 `\` 转义算进「跳过」。故本实现把**引号与转义一并跳过**。
  //
  // ⚠️ 本判据的两半**承重程度不同**（变异测试实测，供日后维护参考）：
  //   · 「**最后一个**顶层分隔符之后只剩空白」是**靶 1/靶 2 的承重项**。旧实现的错在于
  //     它问「文本里**有没有**换行」（`/[\n\r]/.test`）而不是「**末尾**有没有分隔符」，
  //     故引号内的换行被误判成分组。改成「取最后一个分隔符、看其后是否只剩空白」之后，
  //     引号内换行**自然**不再命中（它后面还有收尾引号，非空白）。
  //   · `\` 转义分支是**靶 3 的承重项**：`{ a\; }` 里那个 `;` 正是**最后一个**顶层候选、
  //     其后恰好只剩空白 —— 不跳过它就必然误判分组（实测停用该分支 ⇒ 断言 AH7 红灯）。
  //   · 引号分支（单/双）在现有语料上**不承重**（停用后判别格差异 = 0）：被引号包住的
  //     分隔符后面总跟着收尾引号，永远不可能满足「其后只剩空白」。保留它是为了与上面
  //     「跳过引号内内容」的判据描述一致、并对未来改动留一道防御，**不是**靶 1/靶 2 依赖它。
  //
  // ⚠️ 判据方向是 **fail-closed 优先**：本扫描只在「确实读到一个**顶层**分隔符、且其后
  // 只剩空白」时才判分组。**顶层** = 未被单/双引号包裹、未被 `\` 转义。与 `bash -n` 的
  // 56 格交叉语料对拍：**「bash 判 OK 而本判据判分组」= 0 格**（即不产生新的 fail-open），
  // 另 47/56 逐格一致；余下 9 格是「bash 判 ERR 而本判据说词」（`{a&&}` / `{a|}` 这类
  // 内容自身就非法的形态，命令在 bash 里根本不会执行），且这 9 格在旧判据下**同样是词**，
  // 不构成回归。
  //
  // ⚠️ **不额外要求「`{` 之后必须有空白」**：bash 里 `{ b; }` 与 `{b;}` **都是** SYNTAX-ERR、
  // `{ b }` 与 `{b}` **都是** OK（实测），即「`{` 后有没有空白」在本判据要回答的问题
  // （这个 `{…}` 能不能当重定向目标）上**不构成区分**。反过来加这条要求会把 `{b;}` 判成
  // 词（bash 判 ERR），是往 fail-open 方向走，故不加。
  const braceIsCommandGroup = (content) => {
    let quote
    let last = -1
    for (let i = 0; i < content.length; i += 1) {
      const c = content[i]
      if (quote === 'single') { if (c === "'") quote = undefined; continue }
      if (quote === 'double') {
        // 双引号内 `\` 转义下一个字符（含 `\` 与 `"`），转义目标不参与判据
        if (c === '\\') { i += 1; continue }
        if (c === '"') quote = undefined
        continue
      }
      // 引号外：`\` 转义下一个字符 —— `\;` 的 `;` 是**字面**分号，不得计入
      if (c === '\\') { i += 1; continue }
      if (c === "'") { quote = 'single'; continue }
      if (c === '"') { quote = 'double'; continue }
      if (c === ';' || c === '\n' || c === '\r') last = i
    }
    if (last < 0) return false
    return /^[\s]*$/.test(content.slice(last + 1))
  }

  // ── 进程替换 `>( )` / `<( )` 是**词**（可作重定向目标），与子 shell `( )` 相反 ─────────
  // `bash -n` 实测：
  //     OK   `echo a > >(cat)` / `echo a > <(cat x)` / `echo a >(cat)` / `echo a 2>(cat)`
  //     ERR  `echo a > (cat)` / `echo a >>(cat)` / `echo a >|(cat)` / `echo a >&(cat)`
  //     ERR  `echo a &>(cat)` / `echo a <>(cat)` / `echo a <<(cat)`
  // 词法器里 `>` 先被 `REDIRECT_OPERATOR` 吃掉、`(` 单独进 `(` 分支，故这里只能**回看**
  // 判断这个 `(` 是不是进程替换的开头。
  //
  // ⚠️ **不能只看「`(` 的前一个字符是 `>` 或 `<`」**（本判据的初版，实测过宽）：
  // `>>(cat)` / `>|(cat)` / `>&(cat)` / `&>(cat)` / `&>>(cat)` / `<>(cat)` / `<<(cat)`
  // 的 `(` 同样紧贴 `>` / `<`，但那个字符是**更长操作符的一部分**，bash 实测全是语法错误。
  // 按「紧贴即算词」会把这一族一起放行 —— 那是**新开的 fail-open**
  // （`rm -rf /etc >> >(tee log) & echo done` 由 deny 变 allow）。
  //
  // 故判据 = **把 `(` 之前那串操作符字符按 bash 的规则切成词元，要求最后一个词元恰好是
  // 裸 `>` 或 `<`**（即 `(` 紧跟在一个独立的单字符重定向操作符之后）。这正是 bash 的
  // 判定条件：`>(` / `<( ` 只在 `>` / `<` 是**独立操作符**时才是进程替换的开头。
  // 逐格核对（`bash -n` 真值，本判据与 bash 在 1170 条「`(` 紧贴操作符」样本上**零误收紧**）：
  //     true   `>(cat)` `<(cat)` `2>(cat)` `> >(cat)` `><(cat)` `>|>(cat)` `>&>(cat)`
  //            `&&>(cat)` `>>>(cat)` `>><(cat)` `<>>(cat)`
  //     false  `>>(cat)` `>|(cat)` `>&(cat)` `&>(cat)` `&>>(cat)` `<>(cat)` `<<(cat)`
  //
  // 为什么要**切词**而不是只看「前一个字符」或「前两个字符」：`<>` 是 bash 的操作符
  // （`<>(cat)` 非法），而 `><` **不是**（`><(cat)` 合法）—— 两个字符的先后次序决定结论，
  // 任何「看固定长度前缀」的判据都会把其中一边判错（实测：只看 1 个字符误放行 537 条，
  // 只看 2 个字符仍误放行 296 条且误收紧 207 条）。
  //
  // ⚠️ 操作符表按**最长优先**排列，与 bash 的词法一致（`<<<` / `&>>` 三元，其余二元，
  // 最后是单字符）。`OPERATOR_RUN` 只含重定向与控制操作符字符 —— 空白 / `2` / `;` 都会
  // 终止回看，故 `> (cat)`（有空格）与 `2>(cat)`（fd 号）都落回「单字符操作符」这一支。
  // `;` 不在其中是有意的：`>;<(cat)` 的错在于**前一个 `>` 没有目标**（bash 报错），
  // 与本判据无关，且那条缺口在 HEAD 上同样存在（`echo a > ; echo done` 也是 ok:true）。
  const OPERATOR_RUN = '<>&|'
  const OPERATOR_TOKENS = ['<<<', '&>>', '&&', '||', '<<', '>>', '<&', '>&', '<>', '>|', '&>', '|&', '>', '<', '&', '|']

  const parenIsProcessSub = (text, i) => {
    if (text[i - 1] !== '>' && text[i - 1] !== '<') return false
    let start = i - 1
    while (start > 0 && OPERATOR_RUN.includes(text[start - 1])) start -= 1
    let p = start
    let bare = false
    while (p < i) {
      let hit = null
      for (const op of OPERATOR_TOKENS) { if (text.startsWith(op, p)) { hit = op; break } }
      if (hit === null) { p += 1; bare = false; continue }
      p += hit.length
      bare = hit === '>' || hit === '<'
    }
    return p === i && bare
  }

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
        noteOpaqueText(raw)
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
          const sub = input.slice(index, end + 1)
          noteOpaqueText(sub)
          pushText(sub)
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

    // ── pwsh 数组运算符 `,`：**词分隔符**，不是普通字符 ──────────────────────────
    //
    // PowerShell 里 `,` 是**运算符**，不是标点。用官方词法分析器测定
    // （`[System.Management.Automation.Language.Parser]::ParseInput`，PowerShell 5.1）：
    //     Remove-Item "a", "b"      → … [StringExpandable:"a"] [Comma:,] [StringExpandable:"b"]
    //     Remove-Item "a","b"       → 同上（**引号紧贴也一样**，逗号仍是独立 token）
    //     Remove-Item "C:\tmp\a,b"  → … [StringExpandable:"C:\tmp\a,b"]（引号内是字面量）
    // 即它与空格无关、与引号边界无关（只与「在不在引号内」有关）。
    // 语义验证：`Remove-Item <两个文件>` 的 `-WhatIf` 输出两条 "Remove File"，确认是两个目标。
    //
    // ── 为什么必须在这里切词，而不是在判档侧剥尾逗号 ────────────────────────────
    // 逗号粘在词元尾部会让**精确匹配**的档位判据全部落空：`B:\` 判 `drive-root`、
    // `C:\Windows` 判 `system`，而 `B:\,` / `C:\Windows,` 两个判据都不匹配，只剩「工作区外」。
    // 实测档位**降级**（BLAST_ORDER 数字越小越严重）：
    //     B:\          drive-root → B:\,         outside   ★ 降级
    //     /            drive-root → /,           outside   ★ 降级
    //     C:/Windows   system     → C:/Windows,  outside   ★ 降级
    // 端到端（`wide=deny`、其余 ask）：
    //     Remove-Item "B:\" -Recurse -Force          → deny
    //     Remove-Item "B:\", "D:\x" -Recurse -Force  → **ask**  ← 一个逗号绕过显式 deny
    // 这就是为什么修在词法器：**判据没有错，是喂给它的词元错了**。在判档侧剥逗号属于
    // 给下游补丁，且会与「引号内的逗号是字面量」这条正确行为打架。
    //
    // ⚠️ 只在 pwsh 生效：bash 里 `,` 是**普通字符**（`rm -rf /tmp/a,b` 删的是名字里带
    // 逗号的那**一个**文件），照切会凭空造出一个不存在的目标。花括号展开 `{a,b}` 由下面的
    // 分组分支处理（标 opaque），与本分支无关 —— 两条路径不会同时命中。
    //
    // 逗号**保留在 segText**（例外匹配的对象是用户写的原文，`Remove-Item "a", "b"` 必须
    // 仍能命中 `Remove-Item *`），但**不进 wordText** —— 它是运算符，不是词元的一部分。
    if (sh === 'pwsh' && char === ',') {
      flushWord()
      pushText(char)
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
      noteOpaqueText(raw)
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
        noteOpaqueTarget(true)
        const sub = input.slice(index, end + 1)
        noteOpaqueText(sub)
        pushText(sub)
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
        redirectOpaqueTarget = 'none'
        index += input[index + 2] === '>' ? 2 : 1
        continue
      }
      // ⚠️ 两条都必须在 `flushSegment()` **之前**取 —— 它会把 `pending` / `words` /
      // `started` / `segOpaque` 全部复位，之后再问恒为「空段」。
      //   · `noTarget`：重定向还等着目标（`echo a > &` 的 `&` **不是** `>` 的目标，
      //     bash 判语法错误）。少了这一条，`&` 的豁免会把「重定向无目标」一起放行 ——
      //     判据与下面行尾那条 `pending !== undefined && !started` 同源（都是词元级）。
      //   · `flushSegment()` 的返回值：本段有没有内容（异步列表的 list 部分）。
      //
      // ── ⚠️ 第三个合取项 `redirectOpaqueTarget !== 'word'`：`!started` 的**误判**修正 ──
      // `!started` 对「重定向目标是 **opaque 构造**」是**误判**：`$( )` / `( )` / `{ }` /
      // 反引号四条分支**都不设 `started`**（只 `markOpaque` + `pushText` + 跳过配对），
      // 而其中一部分在 bash 里是**合法**的重定向目标（`bash -n` 实测）：
      //     OK          `echo a > $(mktemp) & echo done` / `2> $(mktemp) & …` / `>> …` / `< …`
      //     OK          `echo a > {mktemp} & …`（字面词） / `echo a > } & …`
      //     SYNTAX-ERR  `echo a > (mktemp) & …` / `echo a > ) & …` / `echo a > { b; } & …`
      // 即 `$( )` / 字面花括号形态**合法**，而 `( )` / `)` / 花括号**分组**形态非法 ——
      // 这个区分本就不该由 `started` 承担，故由 `redirectOpaqueTarget` 精确判（三态见其注释）。
      //
      // 为什么必须在这里修：`&` 分支的 `flushSegment()` 本来会把这个误判随 `pending` 一起
      // 清掉，故 HEAD 上不显形；**粘性**（下面那行）把它保留到行尾后，**合法命令被推进
      // `ok:false`** —— 而 `ok:false` 路径（`assessCommand` 的 `if (!d.ok)` 支，约 `:6600`）
      // 只认 deny 例外，档位集合是 `groupTiersOf + priv + RADIUS_TIERS_WHEN_UNREADABLE`、
      // **不含 `outside`**，于是用户显式配的 `outside=deny` 与**全部 ask 例外**在这条路径上
      // 整个失明（fail-open，本项目最高风险方向）。实测（`outside=deny`、其余七档 allow）：
      //     rm -rf /tmp/x                            → deny
      //     rm -rf /tmp/x > $(mktemp) & echo done    → HEAD **deny** / 仅加粘性 **allow** ❌
      //     rm -rf /tmp/x 2> $(mktemp) & echo done   → HEAD deny / 仅加粘性 allow ❌
      // （例外侧同形：分类 allow + 例外 `curl *`=ask 时 `curl … > $(mktemp) & echo done`
      //   由 ask 变 allow。）
      //
      // ⚠️ 读取位置必须在 `flushSegment()` **之前**（与 `pending` / `started` 同处），
      // 且**粘性的全部收益都保住**：`echo a > & (b) &` 的第一个 `&` 处 `(b)` 尚未被解析、
      // `redirectOpaqueTarget` 仍是 `'none'` ⇒ 照旧置位 ⇒ 照旧 `ok:false`。
      const ampNoTarget = pending !== undefined && !started && redirectOpaqueTarget !== 'word'
      // ⚠️ **粘性**（`||`，不是覆盖）：`echo a > & (b) &` 里第一个 `&` 满足条件、第二个
      // （行尾那个）不满足，覆盖式写入会把结论抹掉。语义上只要**有任何一个** `&` 前面
      // 挂着没目标的重定向，整行在 bash 里就是语法错误，故一旦置位就不再复位。
      ampTargetMissing = ampTargetMissing || ampNoTarget
      ampAfterContent = flushSegment() && !ampNoTarget
      nextOp = '&'
      continue
    }
    if (char === '|') {
      // ── `|&`（管道 + stderr）必须被本分支**整体消费**（发现 9 的修法）────────────────
      // bash 里 `|&` 是**一个**操作符（`cmd 2>&1 | cmd` 的简写），与 `|` 同为管道分隔符。
      // 本分支此前只看 `||`，于是 `|&` 的 `|` 被当分隔符、`&` 落到下面的 `&` 分支 ——
      // 而那个分支按「异步列表的 `&`」处理，于是 `echo a |&>& log & echo b` 走
      // `&` 的悬空检查 → 整行 `ok:false`。
      //
      // ⚠️ 后果不是「少分一段」而是**整条命令的判定路径被换掉**：`ok:false` 路径
      // （`assessCommand` 的 `if (!d.ok)` 支）档位集合不含 `outside`、且**只认 deny 例外**
      // —— 用户显式配的 `outside=deny` 与**全部 ask 例外**在这条路径上整个失明（fail-open）。
      // 实测（分类 allow + 例外 `curl *`=ask）：
      //     curl -s http://example.com |&>& log & echo done   HEAD ask → 当前 **allow** ❌
      // 而这两条在 bash 里 `-n` = OK、真实执行**真的写出 `log` 文件**（已用真 bash 复核）。
      //
      // ⚠️ **报告者建议的修法（删 `OPERATOR_TOKENS` 里的 `|&`）实测无效**：靶格无括号，
      // `parenIsProcessSub` 根本不参与。真正的原因在这里 —— 是**主循环**没消费 `|&`。
      // 且实测删 `|&` 只翻转 4 格，而删 `<>` 会翻转 26 格并使套件 FAIL：`<>` 承重，不能动。
      //
      // `|&` 的 `&` **必须一并跳过**（`index += 1`）：留给下一轮的话，`&` 分支会把它当
      // 异步列表的分隔符 —— 于是 `echo a |& log & echo b` 会**凭空多出一个段边界**。
      // 判据顺序：先判 `||`（`|&` 不以 `|` 开头，两者不可能同时命中）。
      const isOr = input[index + 1] === '|'
      const isPipeErr = !isOr && input[index + 1] === '&'
      flushSegment()
      nextOp = isOr ? '||' : '|'
      if (isOr || isPipeErr) index += 1
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
      // 新开一个待读目标 ⇒ 上一个重定向的 opaque 结论作废（见 `redirectOpaqueTarget` 的注释）
      redirectOpaqueTarget = 'none'
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
      noteOpaqueText(input.slice(index, end + 1))
      // `(` 分支必须再分一次：**进程替换** `>( )` / `<( )` 是可作词的（见 `parenIsProcessSub`），
      // 而**子 shell** `( )` 不可作词。少了这一分，`>(tee log)` 会被记成 `not-word`
      // → `ampNoTarget` 置位 → 整行 `ok:false` → 用户显式配的 `outside=deny` 与全部 ask 例外
      // 在这条路径上失明（fail-open，与 `$( )` / `{ }` / `}` 同族，见 `redirectOpaqueTarget`）。
      noteOpaqueTarget(char === '{'
        ? !braceIsCommandGroup(input.slice(index + 1, end))
        : parenIsProcessSub(input, index))
      pushText(input.slice(index, end + 1))
      index = end
      continue
    }
    if (char === ')' || char === '}') {
      markOpaque('shell grouping or brace expansion cannot be read statically')
      // 孤立 `}` 是普通词（可作目标），孤立 `)` 不可能合法（见 `noteOpaqueTarget` 的注释）
      noteOpaqueTarget(char === '}')
      pushText(char)
      continue
    }

    pushText(char)
    wordText += char
    started = true
  }

  if (quote !== undefined) return { ok: false, reason: 'the command line ends inside an unbalanced quote' }
  // 重定向目标缺失。⚠️ 这里的判据是 `started`（**词元级**），与下面那条段级的
  // segHasContent **不是**同一个问题，不得合并：
  //   · 本行问「`>` 后面有没有**词元**」—— `echo a > (b)` 的分组块不是有效目标
  //     （bash 里这是语法错误），`echo a > $f` 的变量展开才是；
  //   · 下面那条问「上一个操作符后面有没有**东西**」—— 它必须接受 opaque 构造
  //     （`Get-Content x | ForEach-Object { $_ }` 的末尾就是分组块）。
  // 实测合并的后果（把本行改成 segHasContent）：`echo a > (b)` 与 `echo a >`
  // 双双由 ok:false 变 ok:true —— 重定向无目标被静默放行，是 fail-open。
  if (pending !== undefined && !started) return { ok: false, reason: 'a redirection has no target' }
  // 悬空操作符：`git status |` / `a &&` 在 shell 里是语法错误，段边界不可信。
  //
  // ── 允许尾随的操作符，两个判据（缺一即为误判）────────────────────────────────
  //   · `;` 与换行 —— 两种 shell 都接受 `echo a;` / `echo a\n`，与方言无关。
  //   · `&` —— **仅 bash**。POSIX 异步列表（`list &`）的尾随 `&` 是**合法语法**
  //     （`sleep 5 &` / `echo a &`），而 pwsh 的 `&` 是保留的调用运算符、**不接受**
  //     尾随（用官方解析器实测 `echo a &` → `AmpersandNotAllowed`）。故按方言分流。
  //
  // ⚠️ 曾经把 `&` 与 `|` / `&&` / `||` 一同当作语法错误，后果是**fail-open**：
  // 整行 ok:false 只认 **deny** 例外（见 `assessCommand` 的 `if (!d.ok)` 那一支），
  // 于是用户写的 **ask** 例外被一个 ` &` 抹掉。实测（分类默认 allow + 例外 `curl *`=ask）：
  //     curl -s http://example.com    → ask
  //     curl -s http://example.com &  → **allow** ← 用户写的确认规则被规避
  //     curl -s http://example.com ;  → ask（`;` 早已在豁免列表里，故这是不一致，不是设计）
  //
  // ⚠️ 放行 `&` **只放行「合法的异步列表收尾」这一个形态**，不是「`&` 一律不算悬空」：
  //   · **pwsh 恒不放行** —— 它的 `&` 是保留的调用运算符，尾随一律是语法错误。
  //     这一条由 `ampOk` 的 `sh === 'bash'` 项承担（不另写判据）：pwsh 时 `ampOk` 恒假
  //     ⇒ `!ampOk` 恒真 ⇒ 尾随 `&` 照旧落 `ok:false`。
  //   · **bash 下 `&` 前面必须有内容**（`ampAfterContent`）—— `echo a & &` / `echo a | &`
  //     的第二个 `&` 前面空无一物，仍是语法错误；
  //   · 本行整体仍受上面的 `nextOp !== 'start'` 约束（空命令行早由 `EMPTY_COMMAND_REASON` 拦下）。
  // 这三条守卫使 `&` 的豁免面**恰好**等于 bash 真正接受的形态。
  const ampOk = nextOp === '&' && sh === 'bash' && ampAfterContent
  // ── `&` 之前那个 `>` 没有目标：`&` 的豁免**不得**把它一起放行（发现 4 的修法）─────────
  // 上面那条 `pending !== undefined && !started` 是**保留的**词元级判据，但它读的是**当前**
  // 的 `pending` —— `&` 分支的 `flushSegment()` 已经把它复位，故 `&` **之前**的那个 `>`
  // 它看不到。本行补的正是这个盲区，两者**互补而非重复**（去掉上面那条会让 `echo a > &`
  // 由 FAIL 变 ok，测试 Z2 红灯；去掉本行则下面四种形态仍被放行）。
  //
  // 只对 `nextOp === '&'` 生效：其它操作符下 `pending` 不会被 `flushSegment` 吃掉
  // （`|` / `;` / `&&` / `||` 分支同样调 `flushSegment()`，但那些操作符的尾随悬空
  // 已由上面那条 `!ampOk` 的判据拦下，无需本行）。
  //
  // ⚠️ **bash 与 pwsh 都拦**：`echo a > & b` 在 bash 是
  // `syntax error near unexpected token '&'`（exit=2），在 pwsh 里 `&` 是保留的调用
  // 运算符、同样不接受「重定向后紧跟 `&`」。故本行**不带** `sh === 'bash'` 守卫 ——
  // 它与 `ampOk` 的方向相反（`ampOk` 是放行，本行是收紧），收紧方向不按方言分流。
  if (ampTargetMissing) return { ok: false, reason: 'a redirection has no target' }
  if (nextOp !== 'start' && nextOp !== ';' && nextOp !== 'newline' && !ampOk && !segHasContent()) {
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
 * 段首**命令名**（剥掉 wrapper 链与提权前缀链）—— 供 `isCmdStyleSwitch` 的命令域判据用。
 *
 * 为什么不能用 `w[0]`：提权前缀（`sudo`/`doas`/…）不在 WRAPPERS 里，`sudo rmdir /s /q`
 * 的 `w[0]` 是 `sudo` —— 按它查命令域会把这条命令判成「不吃 `/x` 的命令」，
 * 于是 `/s` `/q` 被当成路径、凭空造出「目标在工作区外」的假警告。
 * 实测（只看 `w[0]` 的第一版探针）：`sudo reg delete … /f` 判 outside，既有断言红灯。
 * 这是本判据**唯一会静默漏判**的接线点，故必须按命令头位置取名字。
 *
 * 判据统一走 `commandHeadEnd`（与 `blastRadiusOfSegment` 的 skip 同源，见该函数注释），
 * 它已覆盖「提权前缀链 + wrapper 链 + 最终命令名」全部位置：
 *   · 返回 >0 时，命令名就是它吃掉的最后一个词元（`w[headEnd - 1]`）；
 *   · 返回 0 表示首词元既不是前缀也不是破坏性命令（`robocopy …` / `git status …`）。
 *     此时**不能**拿 `w[0]` 当命令名，也不能拿 `unwrapWords` 的结果当 —— 段首还可能是
 *     **语句关键字**（`time` / `!` / `then`…，见 STATEMENT_KEYWORDS），
 *     而 `unwrapWords` 不跳关键字、`segmentLabel` 跳（两者的判据就此分叉）。
 *     故跳关键字后再问一次 `commandHeadEnd`；仍取不到才退回 `segmentLabel`
 *     —— 那是判定侧**实际消费半径判据**的同一份解析。
 *
 * `headEndHint` 让调用方把**已经算过的** `commandHeadEnd` 结果传进来，避免在判定热路径上
 * 把同一趟 O(n) 扫描做两遍（`blastRadiusOfSegment` 等四处都已各自算过一次）。
 *
 * @param {string[]} words 段词元
 * @param {number} [headEndHint] 调用方已算出的 `commandHeadEnd(words)`
 * @returns {string} 小写命令名（认不出时为空串）
 */
function headCommandNameOf(words, headEndHint) {
  const w = Array.isArray(words) ? words : []
  let headEnd = 0
  if (typeof headEndHint === 'number') headEnd = headEndHint
  else { try { headEnd = commandHeadEnd(w) } catch (e) { headEnd = 0 } }
  if (headEnd > 0) {
    const name = commandNameOf(w[headEnd - 1])
    // `commandHeadEnd` **不认识语句关键字**：`sudo time rm -rf /tmp` 里它吃掉 `sudo` 之后
    // 把 `time` 当成命令名（关键字既不是前缀也不是破坏性命令，走 ② 被一并吃掉），
    // 于是门控又查到了关键字 —— 与段首形态同一处分叉，只是关键字在提权前缀之后。
    // 关键字**永远不是可执行命令名**（见 STATEMENT_KEYWORDS 的注释），取到它即说明
    // 命令头多吃了词元，真命令名在它之后，故落回下面的关键字重解析而不是返回它。
    //
    // **前缀名同样不是命令名**，此处一并拒收：`commandHeadEnd` 在 `su` / `runas` 上会
    // **停在提权名本身**（它们的值可能是命令也可能是目标，见 PRIV_VALUE_IS_COMMAND），
    // 于是 `w[headEnd - 1]` 就是 `su`/`runas`。返回它等于把 `isCmdStyleSwitch` 的命令域
    // 判据钉在前缀上：实测 `su robocopy X:\ws\a X:\ws\b /mir` 查到 `su` → `/mir` 被当路径
    // → 段级 blast 判 outside（假警告），而 `time su robocopy …` 走的是关键字重解析、
    // 判 null —— **同一形态只因多一个关键字就分叉**，正是本次要堵的那类分叉。
    if (!STATEMENT_KEYWORDS[name] && PRIV_PREFIXES[name] !== 1 && WRAPPERS[name] !== 1
      // ── 提权前缀之后的 `NAME=value` **赋值词元**同样不是命令名 ────────────────────
      // `commandHeadEnd` 的 ② 里，`sawPrefix && !PRIV_VALUE_IS_COMMAND[prevPrefix]` 对
      // `sudo` / `doas` / `pkexec` / `gsudo` **恒真**且**先于** `isTargetEatingNameIn` 命中
      // —— 于是它把前缀之后的**第一个**词元无条件当命令名吃掉，而那个词元可能正是
      // `FOO=1` 这样的赋值前缀。本函数的早退只拒收「关键字 / 前缀 / wrapper」，
      // 赋值词元一概放行 → 返回 `foo=1`。
      //
      // 下游 `isCmdStyleSwitch` 查 `GROUP_OF_LABEL['foo=1']` 不中 → 走「认不出命令名
      // ⇒ 不消费半径」兜底 → `/tmp` 被当 cmd 开关跳过 → 段级 blast 归 null → 档落 inside。
      //
      // 插桩实测：`commandHeadEnd(['sudo','FOO=1','rm','-rf','/tmp'])` = **2**、
      // `headCommandNameOf(…)` = `"foo=1"`（正确值 `"rm"`）。
      //
      // ⚠️ 严重度**带配置条件**（默认 priv=ask 时缺陷被掩盖）：
      //     | 配置                          | `sudo rm -rf /tmp` | `sudo FOO=1 rm -rf /tmp` |
      //     | §6.1 默认（priv=ask）         | ask                | ask（掩盖）              |
      //     | **priv=allow**（§3.3 预期）   | ask                | **allow** ❌             |
      //     | outside=deny + unknown=deny   | deny               | **ask** ❌               |
      // 即用户按计划把 `priv` 设为 allow 后，`sudo FOO=1 rm -rf /tmp`（**多写一个环境变量
      // 赋值**）静默 allow、`blast=null`、弹窗 0 次，`outside` 档被整档绕过。
      // 同口径对拍 HEAD（2744 条叉乘）：CUR 放宽 **0** 条 → 不是本批回归，而是「新增的
      // priv 档可独立放宽后暴露出的既有判据分叉」。
      //
      // 判据复用模块级 `LEAD_ASSIGN` **单点**（与 `unwrapWordsFrom`、`commandHeadEnd`
      // 的前导赋值剥离同源），**不新造正则** —— 三处若各写一份「什么算赋值」必然漂移。
      //
      // ⚠️ 只修这一支：`su root FOO=1` / `runas /user:a FOO=1`（走 `privOperandSkip`
      // 操作数路径）在 HEAD 上同样是 allow，属另一支**既有**缺陷，本轮刻意不修
      // （修它会扩散到 `privOperandSkip`）。
      //
      // ⚠️ 而 wrapper 一族（`nohup`/`nice`/`timeout 5`/`xargs FOO=1 …`）**不能记成
      // 「走 label 侧、与本节无关」**：它的**半径档**恰恰由本节这道守卫与推进循环的
      // `LEAD_ASSIGN` 步（本函数内、见下方那行）**共同**修好 —— 二者缺一即回退
      // （实测：只留守卫删推进步 → `null`；只留推进步删守卫 → 同样 `null`；
      // 两道齐备 → `outside`，与同形无赋值 `nohup time rm -rf /tmp` 一致）。
      // 走 label 侧的只是该族**剩下的那一半**：`segmentLabels` 恒空 ⇒ `tierSetOf` ①
      // 的门控不放开 ⇒ `tiers` 仍为空、`action` 不变 ⇒ `ignored.md:115` 记录的
      // 「wrapper 侧 allow」缺陷**本身仍未修**（详见推进循环那行上方的实测记录）。
      && !LEAD_ASSIGN.test(String(w[headEnd - 1]))) return name
    headEnd -= 1
  }
  // ── 段首（或提权前缀之后）是语句关键字时，命令头在关键字**之后** ────────────────
  // `commandHeadEnd` 从段首起扫，而关键字既不是前缀也不是破坏性命令 → 它返回 0，
  // 于是这里若直接看段首（`w[0]` 或 `unwrapWords` 的结果）就会查到**关键字本身**：
  //     time rm -rf /tmp  → 查到 `time` → 门控判「不是半径组命令、也不是载荷族」
  //     → `/tmp` 被当 cmd 开关 → 段级 blast 归 null → 档位 inside → mode=allow 下**静默放行**。
  // 实测（platform win32、真实宿主档位表）：33 个 STATEMENT_KEYWORDS × 12 个破坏性动词
  // × 6 个单段词 = 1980 条组合**全部** fail-open，而同一形态的 `rm -rf /tmp` 正确 ask。
  // 而 `segmentLabels(['time','rm','-rf','/tmp'])` = `['rm']` —— 半径判据**确实被消费**，
  // 只是门控把它排除在外，故这是「消费侧与门控侧判据分叉」而不是「设计取舍」。
  // 跳关键字后**再问一次 `commandHeadEnd`**（而不是就地取第一个非关键字词元）：
  // 关键字之后仍可能是前缀链（`then nohup rm …`、`time sudo rm …`），
  // 只有 `commandHeadEnd` 知道前缀吃到哪儿、哪个词元才是命令名。
  //
  // ── 但只跳关键字不够：跳完落到的可能正是**前缀本身** ──────────────────────────
  // `time sudo rm -rf /tmp` 解出 `start` 指向 `sudo`、`time nohup rm …` 指向 `nohup`，
  // 而前缀**不是命令名** —— 提权前缀本身就在 `DESTRUCTIVE_LABELS` 里（见其「提权」组），
  // wrapper 在 `WRAPPERS` 里。把前缀当命令名交给 `isCmdStyleSwitch` 查命令域，
  // 判据就钉在了前缀上：实测 `time sudo icacls X:\ws\x /grant Users:F` 查到 `sudo`
  // （提权组、不在 `WIN_SLASH_SWITCH_CMDS` 里）→ `/grant` 被当路径 → 段级 blast 由 null
  // 变 **outside**（假警告），而对照的 `sudo icacls … /grant` 正确判 null；
  // `time nohup time icacls … /grant` 查到 `nohup` 同理。
  // 反向也成立：剥完前缀之后可能又是关键字（`time env then taskkill …` 的 `then`）——
  // 故两者必须**交替推进**，直到落在「既不是关键字、也不是前缀」的词元上，
  // 那才是命令头位置上的命令名。
  //
  // 剥前缀复用 `skipPrefixArgs`（与 `commandHeadEnd` 的 ① 分支**同源**，不另写一份剥法）——
  // 否则「门控查到的命令名」与「判档侧剥掉的命令头」会再次分叉，正是本次缺陷的成因。
  //
  // 收敛性：每轮**至少推进一个词元**（关键字分支取 `found > start`，前缀分支取
  // `next >= start + 1`），故 `guard <= w.length` 不可能漏判。
  let start = headEnd
  for (let guard = 0; guard <= w.length && start < w.length; guard += 1) {
    // 含空白的词元是**引号包起来的整条命令行**（`su -c "rm -rf /"`），不是命令名 ——
    // 与 `commandHeadEnd` 同判据，交回下面的兜底（它按子命令行递归判档）。
    if (/\s/.test(String(w[start]))) break
    const head = commandNameOf(w[start])
    if (!head) break
    if (STATEMENT_KEYWORDS[head]) {
      // ── 关键字**自身的选项**必须先跨过（`time -p <cmd>` 的 `-p`）────────────────────
      // 只取「第一个有效词元」时 `-p` 会当上命令名，而它不是命令名 —— 门控于是把命令域
      // 钉在 `-p` 上：`isCmdStyleSwitch` 查不到组、也认不出载荷族 → 走「按不消费半径处理」
      // 的兜底 → `/tmp` 被当 cmd 开关跳过 → 段级 blast 归 null → 半径档落 `inside`
      // → 大分类 mode=allow 时**静默放行**。而对照的 `time rm -rf /tmp` 正确判
      // `outside|/tmp` —— 同一语义只因多一个 `-p` 就分叉，方向是 **fail-open**。
      // 实测（win32、八档、inside=allow 其余 ask）：`rm -rf /tmp` = ask、
      // `time rm -rf /tmp` = ask、`time -p rm -rf /tmp` = **allow**；
      // 同样放宽的还有 `time -p diskpart` / `time -p parted`（win32 + posix 均放宽）。
      //
      // 推进方式复用 `skipPrefixArgs` —— 与 `segmentLabelFrom` 的关键字分支（`:775`）
      // 和 `pushHeadLabels`（`:1149`）**同源**。三处若各写一份「什么算关键字自己的选项」，
      // 「命令头到哪儿」「命令名是谁」「label 是谁」必然再次分叉，那正是本文件反复要修的
      // 那类缺陷（本轮 F2/F4 的根因同此）。
      //
      // 只在「关键字紧跟 `-` 开头词元」时才推进：`skipPrefixArgs` 遇到第一个非选项词元
      // 即停，故 `time rm …` / `then nohup rm …` 一族逐字不变（`nx === start + 1`）。
      let nx = start + 1
      try { const s = skipPrefixArgs(w, start + 1, head); if (s > nx) nx = s } catch (e) {}
      let found = -1
      for (let j = (nx > start ? nx : start + 1); j < w.length; j += 1) {
        const t = commandNameOf(w[j])
        if (!t || BAD_LABEL_CHARS.test(t)) continue
        found = j
        break
      }
      if (found < 0) { start = w.length; break }
      start = found
      continue
    }
    // ── 进入下一轮之前：前导 `NAME=value` **不是命令名**，跳过后继续 ─────────────────
    // 上面那个交替循环只在「关键字 / wrapper / 提权前缀」三类上推进，赋值词元一概落到
    // 本行 —— 而本行此前直接 `break`，于是 `start` 停在赋值词元上，下面 `tailEnd` 那一支
    // 取到的是**赋值**而不是真命令名。
    //
    // 两个入口都命中同一行（故是**一条**缺陷、不是两条）：
    //   · 前缀之后（【1】）：`commandHeadEnd(['sudo','FOO=1','time','rm','-rf','/tmp'])` = **2**
    //     —— ② 分支的 `sawPrefix && !PRIV_VALUE_IS_COMMAND['sudo']` 恒真且先于
    //     `isTargetEatingNameIn` 命中，把 `FOO=1` 当命令名吃掉；早退又被 `:3981` 的
    //     `!LEAD_ASSIGN` 挡住 → `headEnd -= 1` → `start = 1` 正是那个赋值词元；
    //   · 段首前导（【2】）：`['FOO=1','B=2','time','rm','-rf','/tmp']` 同理由 `:2898`
    //     剥掉后 `headEnd = 2`，`start` 落在 `B=2` 上。
    // 实测两条都返回 `'foo=1'` / `'b=2'`（正确值 `'rm'`）。
    //
    // 下游后果按形态分两半，两半都由本行从根归位：
    //   · `hasNoOperand` 的 BARE 那一半 —— `:2865`（`commandHeadEndFull` 推进循环）已修，
    //     但那条路径只服务 `unknown` 档，故 `sudo FOO=1 time diskpart` 此前靠 headFull
    //     位置跳过兜住（**闸门有效**，实测基线 `ask|null|unknown,priv`，不是硬故障）；
    //   · **半径档那一半此前无人修**：`blastRadiusOfSegment:5246` 把
    //     `headCommandNameOf` 的结果当 `cmdName` 交给 `isCmdStyleSwitch:5280`，
    //     而 `'foo=1'` 在 `GROUP_OF_LABEL` 里查不到 → 走「认不出命令名 ⇒ 不消费半径」
    //     兜底 → `/tmp` 被当 cmd 开关跳过 → 段级 blast 归 null → 档落 `inside`。
    //     headFull 兜不住这一半（它只服务 `hasNoOperand`），故这是**同一缺陷的新后果**。
    //
    // 判据复用模块级 `LEAD_ASSIGN` **单点**、与 `commandHeadEndFull:2865` 那行**逐字同源**
    // （查表 + `test`，无正则新建、无分配）：四处若各写一份「什么算赋值」必然漂移，
    // 而漂移方向正是本条缺陷（`commandHeadEndFull` 上一轮刚因同一漂移补过这一项）。
    //
    // ⚠️ 修法范围**按实测分两半**（此处曾写作「两族零影响」，其中 wrapper 那一半不成立）：
    //   · `su root FOO=1 …` / `runas /user:a FOO=1 …` 走 `privOperandSkip` 操作数路径
    //     —— 本行对它们**确实零影响**（45 关键字 × 4 目标 × 2 平台 = 360 格/族，
    //     段级 blast / labels / tiers / action 全 0 变化）。
    //   · **wrapper 一族（`nohup`/`nice`/`timeout 5`/`xargs`/`setsid`/`stdbuf`/`ionice`/
    //     `command`/`builtin`/`exec`）的半径档恰是被本行修好的**，且它**不走 label 侧**
    //     —— 本行所在的 `headCommandNameOf` 正是 `blastRadiusOfSegment` 取 `cmdName`
    //     交给 `isCmdStyleSwitch` 的那一处（**半径档侧**）。插桩实测：
    //     `headCommandNameOf(['nohup','FOO=1','time','rm','-rf','/tmp'])` 由 `"foo=1"` 变
    //     `"rm"`，而同一形态的 `segmentLabels` 两侧**都是 `[]`**。
    //     后果（win32）：`cmdName` 认不出时 `isCmdStyleSwitch` 把 `/tmp` 当 cmd 开关跳过、
    //     段级 blast 归 `null`；修好后**命令文本口径**下 45 个语句关键字里 **43 个**由 `null` 变 `outside`，
    //     另 2 个例外**仅存在于该口径**：`}` 两侧同为 `outside`；`{` 两侧同为**解析失败**（`ok=false`、无段，不是 `null`）
    //     —— 而 `:4105` 的**词元级**口径下 `{` 同其余关键字一样由 `null` 变 `outside`（45/45）；与同形无赋值
    //     对照 `nohup time rm -rf /tmp` 的 `outside` **一致** ⇒ 消除异类判决、方向收紧，非 fail-open（posix 侧同为 outside、0 变化）。
    //   · 但该族 `segmentLabels` 恒空 ⇒ `tierSetOf` ① 的门控（段内无 del/disk/perm/priv
    //     组 label）不放开 ⇒ `tiers` 仍为空、`action` 不变（4320 格 action 变化 0）
    //     ⇒ `ignored.md:115` 记录的「wrapper 侧 allow」缺陷**本身仍未修**。可见面只有
    //     半径档：例外模式面板（`index.js` 的 `blastRadiusOfCommandPattern`）实测
    //     `nohup FOO=1 time rm -rf /tmp` 由 null 变 outside；弹窗侧（`worstBlast`）只在
    //     **该段仍被判破坏性**时才看得到（`assessCommand` 的 `destructive` 门控）——纯形态
    //     `labels` 为空故 `blast` 仍为 `null`，opaque 形态 `nohup FOO=1 time } rm -rf /tmp`
    //     （`label='rm'` ⇒ `destructive` 为真）则 `null → outside` —— 实测 10 族 ×
    //     3 赋值形态（`FOO=1` / `FOO=1 BAR=2` / `A=1`）× 2 目标（`/tmp` `/data`）× 2 方言 = **120 格半径档可见变化**；
    //     `action` 在**八档同动作**配置下不变，而在 **per-tier 配置**（如 `outside=deny`）下**由 `allow` 收紧为 `deny`**（120/120，fail-closed）。
    //
    // 收敛性：每轮 `start += 1` 至少推进一个词元，`guard <= w.length` 不可能死循环（与其余分支同）。
    if (LEAD_ASSIGN.test(String(w[start]))) { start += 1; continue }
    if (WRAPPERS[head] !== 1 && PRIV_PREFIXES[head] !== 1) break
    let next = start + 1
    try { const nx = skipPrefixArgs(w, start + 1, head); if (nx > next) next = nx } catch (e) {}
    if (next <= start) break
    // `su` / `runas` 的操作数不是命令名，跨过它继续推进 —— 与 `commandHeadEnd` 的 ① 分支
    // **共用同一个推进步**（`privOperandSkip`）。两处若各写一份，命令头与命令名必然分叉，
    // 而分叉的后果实测是 `su root rm -rf /data` 在 priv=allow 下静默放行（见该函数注释）。
    if (next < w.length) { try { next = privOperandSkip(w, head, start + 1, next) } catch (e) {} }
    start = next
  }
  if (start > 0 && start < w.length) {
    // 短路（纯优化）：`w[start]` 本身就在破坏性名单里时，`commandHeadEnd(w.slice(start))`
    // 必然 = 1（首词元既不是关键字也不是前缀 → 第一轮就命中 ② 的 `isDestructiveLabel`，
    // 吃掉该词元后停），故结果恒为 `commandNameOf(w[start])` —— 与下面那趟扫描逐字相同。
    //
    // **这条等价性依赖「`w[start]` 绝不是前缀」这个前提**，而上面那个交替推进循环
    // 恰好保证它（循环只在「既不是关键字、也不是前缀」时退出）。原注释声称的
    // 「`isDestructiveLabel(w[start])` ⇒ `commandHeadEnd` 恒为 1」**并不成立**：
    // 提权前缀本身就在破坏性名单里，而 `commandHeadEnd` 对它们走 ① 的 `skipPrefixArgs`
    // 继续吃 —— 实测 `commandHeadEnd(['sudo','rm','-rf','/tmp'])` = **2**（吃掉 `sudo`
    // **和** `rm`）。这正是本次缺陷的成因：短路在提权前缀上恒命中并**返回前缀本身**，
    // 实测 `headCommandNameOf(['time','sudo','rm','-rf','/tmp'])` 返回 `sudo` 而正确值是 `rm`。
    // 故这里**加显式前缀守卫**，让前提从「上游保证」变成「本处自证」——
    // 即使日后有人改坏了上面的循环，本短路也只会失效（落回扫描）而不会返回前缀。
    // 另必须带 `!/\s/` 守卫：`commandHeadEnd` 对**含空白的词元**一律 break 返回 0
    // （那是引号包起来的整条命令行，见该函数里的说明），而 `commandNameOf('rm ')` 经 trim
    // 仍会得到 `rm` —— 少了这个守卫就在该形态上与它分叉。
    // 收益：`time rm -rf /tmp` 这类最常见形态省掉一次 `slice` + 一趟 `commandHeadEnd`。
    const rawStart = String(w[start])
    const startName = commandNameOf(rawStart)
    if (!/\s/.test(rawStart) && PRIV_PREFIXES[startName] !== 1 && WRAPPERS[startName] !== 1
      && isDestructiveLabel(startName)) return startName
    let tailEnd = 0
    try { tailEnd = commandHeadEnd(w.slice(start)) } catch (e) { tailEnd = 0 }
    if (tailEnd > 0) {
      const tailName = commandNameOf(w[start + tailEnd - 1])
      if (!STATEMENT_KEYWORDS[tailName]) return tailName
    }
    // 关键字/前缀链之后既没有前缀链、也没有破坏性命令名（`time robocopy … /mir`）：
    // 真命令名就是那个位置上的词元 —— 与 `segmentLabel`「跳关键字后取第一个
    // 非关键字词元」同判据（上面那个循环已保证它不是关键字、也不含 BAD_LABEL_CHARS）。
    // **前缀过滤不能省**：`commandHeadEnd` 返回 0 也可能是「首词元是前缀、其后没有命令名」
    // （`timeout 5 sudo` 这类词元被前缀吃光的情形），此时 `w[start]` 是 wrapper / 提权名。
    // 返回它等于把命令域判据钉在前缀上：实测 `time nohup time icacls … /grant` 查到 `nohup`
    // → `/grant` 被当路径 → 段级 blast 由 null 变 outside（假警告）。
    // 滤掉后落下面的兜底（`segmentLabel`，与判定侧同源）。
    const first = commandNameOf(w[start])
    if (first && !STATEMENT_KEYWORDS[first] && !BAD_LABEL_CHARS.test(first)
      && PRIV_PREFIXES[first] !== 1 && WRAPPERS[first] !== 1) return first
  }
  // ── 兜底：与判定侧**同源** ────────────────────────────────────────────────────
  // 走到这里说明命令头没吃到任何前缀或破坏性命令（`robocopy … /mir`、`git status …`、
  // `time robocopy … /mir`）。判据取 `segmentLabel` —— 它就是判定侧消费半径判据时
  // 用的那一份解析，故门控查到的命令名与「实际消费半径判据的 label」**不可能再分叉**。
  // （`unwrapWords` 兜底正是不够的那一份：它不跳语句关键字，而 `segmentLabel` 跳。）
  //
  // **短路（纯优化，不改变结论）**：`segmentLabel` 与 `unwrapWords` 的差异只在
  // 「跳不跳关键字」与「router 要不要取子命令」。下面这个条件恰好是
  // `segmentLabel` **原样返回 `head`** 的那一支（见其 `if (!ROUTER_CMDS[head]) return head`），
  // 此时两者的返回值逐字相同，故可直接返回而省掉 `segmentLabel` 那一趟 ——
  // 它是判定热路径，实测非关键字段上 `segmentLabel` 兜底比 `unwrapWords` 慢 42%。
  // 条件不满足（关键字 / router / 认不出 / opaque）时**一律交给 `segmentLabel` 本体**，
  // 那是同源解析，也是本次修复真正依赖的那一支。
  try {
    const u = unwrapWords(w)
    if (u && !u.opaque && u.words.length) {
      const first = commandNameOf(u.words[0])
      if (first && !BAD_LABEL_CHARS.test(first)
        && !STATEMENT_KEYWORDS[first] && !ROUTER_CMDS[first]) return first
    }
  } catch (e) {}
  try {
    const label = segmentLabel(w)
    if (label) return String(label).split(/\s+/)[0]
  } catch (e) {}
  return w.length ? commandNameOf(w[0]) : ''
}

/**
 * 吃 `/x` 形态开关的**命令域** —— 判据不是「这个词是不是开关」，而是「这条命令吃不吃 `/x`」。
 *
 * ── 为什么必须换判据 ──────────────────────────────────────────────────────────
 * `/x` 与 POSIX 绝对路径在语法上完全同形，唯一的区别是**名字**。而按名字枚举
 * POSIX 路径在原理上不可能收敛：实测**任意** `/` + 字母的单段词都命中开关判据
 * （`/myapp` `/backup` `/logs` `/zzz` `/notaswitch` 全部被判开关），
 * 故「POSIX 系统目录名单」只是把漏报从几个名字缩到「除名单外全部」——
 * `rm -rf /tmp` 静默放行，而 `rm -rf /etc` 弹窗：同一类操作只因名字不同，一个静默一个询问。
 * `/tmp` 在 Windows 上是**真的会删东西**的（Git Bash 方言下它映射到真实 `%TEMP%`）。
 *
 * 反过来，按开关名枚举同样无界（短开关 26+、长开关 20+，第三方安装器还在增长），
 * 且按合理规模建表会造出 `schtasks /create`、`compact /c`、`cipher /w` 三条新的假警告。
 *
 * 有界的那一侧是**命令域**：`rm`/`chmod`/`shred`/`find`/`dd` 是 POSIX 命令，
 * **没有** `/x` 形态的选项，其 `/x` 实参必是路径；`rmdir`/`del`/`icacls`/`format`/
 * `diskpart` 是 Windows 原生命令，`/x` 是开关。本表就是后者的名单。
 *
 * ── 为什么这张表是有界的 ──────────────────────────────────────────────────────
 * 本判据只在**半径判据真正被消费**的命令上生效（见 `isCmdStyleSwitch` 的 ④），
 * 而那些命令来自 `DESTRUCTIVE_LABELS`（40 项）与载荷族 —— 两者都是固定的小集合。
 * 实测 `DESTRUCTIVE_LABELS` ∩ 吃 `/x` 的命令恰好就是下面这些，无一遗漏、无一多余。
 *
 * **双向一致由测试断言守住**：本表每一项都必须在 `DESTRUCTIVE_LABELS` 里 ——
 * 往表里塞无关命令会让断言红灯（与 `GROUP_MEMBERS` 那条纪律同源）。
 *
 * 刻意**不在表里**：`taskkill` / `shutdown` / `stop-computer` / `reg delete` / `wmic`。
 * 它们走**组档**（proc/power/reg），`tierSetOf` 里 blast 恒 null、不消费本判据 ——
 * 列进来只会让「表 = 吃 /x 的破坏性命令」这句话失真。
 */
export const WIN_SLASH_SWITCH_CMDS = dict({
  rmdir: 1, rd: 1, del: 1, erase: 1, format: 1, diskpart: 1, fdisk: 1, icacls: 1, takeown: 1, runas: 1,
})

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
 *
 * ── 但「Windows 上 `/` + 字母 + 不是 Windows 系统目录 ⇒ 开关」仍然漏掉一整类 ──────
 * `isSystemDir` 在 win32 下**只查 Windows 名单**，于是 POSIX 系统路径全被判成开关。
 * 实测（真实宿主、`platform: 'win32'`、默认配置 mode=allow）：
 *     rm -rf /etc | rm -rf /tmp/x | rm -rf /usr/bin | rm -rf /var/log | rm -rf /home/u/data
 *     chmod 777 /etc/passwd | truncate -s 0 /etc/passwd | shred /etc/passwd
 * 段级 blast 全部为 null → 档位 `inside` → **allow**；而对照的 `rm -rf C:/Windows`
 * 正确判 `wide`。宿主的 `isOutside('/etc')` 实际返回 true（解析为 `G:\etc`，在工作区外）
 * —— 解析器压根没走到那一步。**Windows 是出货平台**，这条路径上的静默代价最大。
 *
 * 故在「不是 Windows 系统目录」之后再收两道：
 *   ① **POSIX 系统目录名单**里的项同样不是开关（`/etc`、`/usr`、`/var`、`/opt`…）——
 *      这些名字在「当前盘根」下也完全可能是真实目录（`G:\etc`），按开关跳过它们的
 *      代价恰好最大（静默）。判据复用 `POSIX_SYSTEM_ROOT_RE`，不另写一份名单。
 *   ② **含第二段的 `/a/b` 不是开关**：cmd 开关是**单段**词（`/s` `/q` `/f` `/im`
 *      `/pid` `/grant` `/mir` `/delete`），没有 `/a/b` 形态。`/etc/passwd`、`/tmp/x`、
 *      `/home/u/data` 都是路径 —— 它们不在 POSIX 名单里，① 拦不住。
 *      只把 `/` 算作分段符（`\` 不算）：`/user:DOMAIN\admin` 是 runas 的**真开关**，
 *      把 `\` 也算进去会让它被当路径判档、凭空造出一条「目标在工作区外」的假警告。
 *      含 `\` 的 POSIX 写法（`/etc\passwd`）由 ① 兜住（判据前先归一成 `/`）。
 *
 * ── 但 ①② 只堵住了「多段」与「两张名单里的名字」，单段的其余全部仍然漏 ──────────
 * 范围比原先认为的大得多：不是 `/tmp` `/home` 几个名字，而是**任意 `/` + 字母的单段词**。
 * 实测（`platform: 'win32'`、默认配置 mode=allow，`blastRadiusOfSegment` 返回 null）：
 *     rm -rf /tmp | /home | /data | /app | /backup | /foo | /myapp | /logs | /zzz | /notaswitch
 * 而 `/etc` `/usr` 一族（已由 ① 堵住）判 outside。**同一类操作只因名字不同，一个静默一个询问**。
 * 放大形态：`rm` / `Remove-Item` / `del` / `rmdir` / `rd` / `erase` / `shred` / `chmod` /
 * `chown` / `truncate` / `find -delete` / `mkfs.ext4` / `wipefs` 对 `/tmp` **全部** blast=null。
 * 引号不救（`rm -rf "/tmp"` 仍 null）、大小写不救（`/TMP` 仍 null）；
 * **尾斜杠会救**（`/tmp/` 判 outside）—— 同一目标写 `/tmp` 静默、写 `/tmp/` 弹窗。
 *
 * `blastRadiusOfSegment` **只在破坏性段上被调用**，故这里的判据只需要覆盖破坏性命令。
 *
 * 故再收两道：
 *   ③ **1–2 字母的短开关与命令无关**：`/s` `/q` `/f` `/im` 在 `rmdir` 上是开关，在 `rm` 上
 *      虽不是开关，但单个字母的 POSIX 根目录实践中不存在 —— 这条兜底保住既有断言
 *      `seg(['rm','-rf','/s']) === null`（L43），是**有意**的取舍。
 *   ④ **命令域判据**：3+ 字母的 `/x` 是不是开关，取决于**这条命令吃不吃 `/x`** ——
 *      见 `WIN_SLASH_SWITCH_CMDS`。它只在半径判据真正被消费的命令上生效，
 *      故「假警告的宇宙」= 破坏性名单 ∩ 吃 `/x` 的命令，是个固定的小集合（有界）。
 *
 * 已知残余：`/x` 单字母形态（③ 的取舍，见上）。`/tmp` 这类 3+ 字母的单段词已由 ④ 覆盖。
 *
 * @param {string} token 待判词元
 * @param {object} [opts] 判档选项（只读 `platform`）
 * @param {string} [cmdName] 段首命令名（小写，见 `headCommandNameOf`）——
 *   缺省时按「不是命令域成员」处理（多一条可见警告，方向 fail-safe）
 */
function isCmdStyleSwitch(token, opts, cmdName) {
  if (token.charCodeAt(0) !== 47) return false
  if (!/[a-z]/i.test(token.charAt(1))) return false      // `/` 与 `/*` 是路径，不是开关
  if (!(opts && opts.platform === 'win32')) return false // 只在明确是 Windows 时才当开关
  const slashed = token.replace(/\\/g, '/')
  // `/Windows`、`/ProgramData` 是当前盘根下的系统目录，不是开关：交回判档。
  if (isSystemDir(slashed, 'win32')) return false
  // ① POSIX 系统目录名同样不是开关（判据与 isSystemDir 的 posix 分支同源，不手抄名单）
  if (POSIX_SYSTEM_ROOT_RE.test(slashed)) return false
  // ② 含第二段的不是开关：cmd 开关是单段词
  if (token.indexOf('/', 1) !== -1) return false
  // ③ 1–2 字母的短开关与命令无关（保住既有断言 `seg(['rm','-rf','/s']) === null`）——
  //    单个字母的 POSIX 根目录实践中不存在，代价可接受，是**有意**保留的残余。
  if (/^\/[a-z]{1,2}$/i.test(token)) return true
  // ④ 命令域判据：命令名不在表里 → 不是开关 → 交回判档（`rm -rf /tmp` 的 `/tmp` 是路径）。
  //    只对**半径判据真正被消费**的命令生效（半径组的破坏性命令 + 载荷族）：
  //    其余命令（`robocopy` / `net` / `taskkill` / `wmic` …）的 `/x` 一律照旧当开关，
  //    否则 `robocopy … /mir`、`net user … /delete` 会被当路径、凭空造出假警告（实测）。
  //    认不出命令名时按「不消费半径」处理，方向 fail-safe。
  const grp = GROUP_OF_LABEL[cmdName]
  if (!(grp && RADIUS_GROUPS[grp] === 1) && !isPayloadCarrierLabel(cmdName)) return true
  return !!WIN_SLASH_SWITCH_CMDS[cmdName]
}

// 爆炸半径档位的**严重度顺序**（越小越严重）—— 全模块唯一一份，index.js 直接引用
// （曾经在 index.js 里手抄一份，键集合已经不同，且消费方式是「未知档静默跳过」）。
// broad = 例外模式的目标是不可判定的顶层通配（`rm -rf *`），它能匹配到盘根，
// 故排在 system 之前、drive-root 之后。
// 爆炸半径档位的**严重度顺序**（越小越严重）—— 全模块唯一一份，index.js 直接引用
// （曾经在 index.js 里手抄一份，键集合已经不同，且消费方式是「未知档静默跳过」）。
//
// 各档的位置理由：
//   drive-root      最严重：整个盘
//   workspace-root  整个项目 —— 比盘根轻，比其余都重（`rm -rf .` 删掉的是这个仓库）
//   broad           规则可能匹配盘根（覆盖面已知但极宽）—— 一条 `rm -rf *`=allow 实测
//                   能放行 `rm -rf /`
//   unknown         目标**读不出**（覆盖面未知）—— 与 broad 同类，紧随其后。
//                   它排在这里而不是「按最轻处理」：读不出后果的操作必须问，
//                   与 `rm -rf $TARGET` 的真实覆盖面可能是任意路径是同一件事。
//   system/home/outside  明确的越界目标（知道自己在删什么，只是不该删）
//   inside          工作区内，不警告
//
// `unknown` 与 `broad` 的先后只影响 worstBlast 显示取哪一条，两者极少同时出现。
export const BLAST_ORDER = {
  'drive-root': 0, 'workspace-root': 1, broad: 2, unknown: 3,
  system: 4, home: 5, outside: 6, inside: 7,
}

// ── 档位（tier）：把「伤害落在哪」与「命令属于哪一类」合成一张可配置的表 ──────────
//
// 八个档 = **半径档 ∪ 组档**（见 GROUP_MEMBERS 的注释）。两侧判据不同，各用各的：
//   半径档 —— 看目标范围（`rm -rf ./build` 是 inside，`rm -rf /etc` 是 wide）
//   组档   —— 看命令属于哪一组（`kill` 恒 proc，与目标无关，因为半径判据对它恒 null）
//
// **不在多处 if/else 里重复组 → 档的映射**：那是 GROUP_OF_LABEL / GROUP_TIER 两个单点的职责，
// 理由与 BLAST_ORDER 的既有纪律一致（曾在三处手抄，漂移时消费侧静默跳过）。

/** 全部档位名（固定顺序见 TIER_ORDER）。宿主与客户端都按这份清单下发/渲染。 */
export const TIERS = ['inside', 'outside', 'wide', 'unknown', 'proc', 'power', 'priv', 'reg']

/**
 * 档位的**固定顺序**（排序键，**不是严重度**）。
 *
 * 为什么必须固定而不能「按严格度排序」：严格度取决于**用户的配置动作**，而配置是变的：
 *     用户 A: wide=ask,  priv=deny  → 最严是 priv → ['priv','wide']
 *     用户 B: wide=deny, priv=ask   → 最严是 wide → ['wide','priv']
 *     用户 C: wide=ask,  priv=ask   → 同严 → 顺序无定义
 * 同一份代码在三个用户那里给出三种顺序，`assert(tiers[0] === 'wide')` 会随机失败，
 * 而 UI 的渲染顺序会随配置抖动。
 *
 * **排序键是档位名，不是 blast level**：半径侧的五个 level
 * （`drive-root` / `workspace-root` / `broad` / `home` / `system`）经 `radiusTierOf`
 * **合并成同一个 `wide` 档** —— 档位是「用户能分别配置的粒度」，而盘根与系统目录
 * 在配置上是同一个开关（拆开会让面板多出四个用户无从选择的选项）。
 * 严重度的区分留在 `blast` 字段里（弹窗文案按 level 分档显示），不进入 `tiers`。
 *
 * 顺序 = 半径档（按 BLAST_ORDER 严重度降序，合并后去重）+ 组档（固定次序）。
 * **必须写清「顺序不代表严重度」**：`['proc','priv']` 不表示 proc 比 priv 严重，
 * 只是 proc 在排序键里靠前。真正决定动作的是**用户配置 + 取最严**
 * （strictestTierAction），与 tiers 的排列顺序无关。
 */
export const TIER_ORDER = [
  'wide', 'unknown', 'outside', 'inside',      // 半径档
  'proc', 'power', 'priv', 'reg',              // 组档（固定次序）
]

/** 排序键（越小越靠前）。与 TIER_ORDER 同源，不另写一份下标表。 */
const TIER_RANK = (() => {
  const m = Object.create(null)
  for (let i = 0; i < TIER_ORDER.length; i += 1) m[TIER_ORDER[i]] = i
  return m
})()

/**
 * 半径档：blast level → tier。
 *
 * | blast level | tier |
 * |---|---|
 * | `inside` | `inside` |
 * | `outside` | `outside` |
 * | `home` / `system` / `drive-root` / `workspace-root` / `broad` | `wide` |
 * | `unknown` | `unknown` |
 * | `null` | 无目标 → `inside`（见下） |
 *
 * `null` 归 `inside` 的理由：它表示「这一段没有路径目标」（`rm` 裸跑报错、
 * `rm test.txt` 的目标在工作区内），不是「读不出」—— 读不出已经由
 * `blastRadiusOfSegment` 改判成 `unknown` level 了。两者在 §4 之前是同一个 `null`，
 * 分开之后这条映射才是正确的。
 *
 * `broad` 归 `wide` 而不是单列一档：它是**例外模式**的档位（`rm -rf *` 这条规则覆盖到盘根），
 * 而例外不是「一段命令」，没有「这一段该用哪档」的问题。段级永远拿不到 broad。
 */
export function radiusTierOf(blast) {
  if (!blast || !blast.level) return 'inside'
  const l = blast.level
  if (l === 'inside') return 'inside'
  if (l === 'outside') return 'outside'
  if (l === 'unknown') return 'unknown'
  // home / system / drive-root / workspace-root / broad：都是「范围大到不该默认放行」
  return 'wide'
}

/**
 * 组档：label 集合 → 命中的全部组档（已排序、去重）。
 *
 * 判据用 **`segmentLabels`**（不是主 label）—— 与 `isDestructiveSegment` 同源，
 * 于是 `find . -exec kill {} ;` 这类间接形态也能识别。
 *
 * 一个段可以命中多个组档（实测 `sudo kill 1234` → priv + proc、`sudo reg delete` → priv + reg），
 * 故返回集合。
 */
export function groupTiersOf(labels) {
  const list = Array.isArray(labels) ? labels : []
  const out = []
  for (const l of list) {
    const g = GROUP_OF_LABEL[String(l == null ? '' : l).trim().toLowerCase()]
    if (!g) continue
    const t = GROUP_TIER[g]
    if (t && out.indexOf(t) === -1) out.push(t)
  }
  return out
}

/**
 * 「**半径侧读不出**」时该并入的档位集合 —— **单一实现**，两个调用方共用：
 *
 *   · `assessCommand` 的整行读不懂分支 —— 连段边界都定不了、**根本没有词元**；
 *   · `tierSetOf` ① 里「**破坏性命令本身藏在 opaque 构造里**」那一族
 *     （守卫是 `destructiveHeadReadable`）。
 *
 * 两处的处境相同：**半径侧没有任何结论**。而「读不出」既可能落在工作区内、也可能落在
 * 盘根，故 `inside` / `wide` / `unknown` **同时**参与「取最严」—— 读不出半径**不等于**
 * 半径安全（见整行分支处 §7.2 的完整论证）。
 *
 * ⚠️ `inside` **必须在集合里**（发现 1 的修法）：整行分支早已并它（那处 `tiers.push('inside')`
 * 是本批**未改动**的上下文，注释明写「丢掉它就等于丢掉一条显式表态」），而段级 opaque 支
 * 只并 `wide ∪ unknown` —— 于是同一个「目标读不出」在两条路径上给出两个答案：用户显式配的
 * `inside=deny` 在段级路径上被静默丢弃。实测（`inside=deny`、其余七档 allow，
 * win32/posix × bash/pwsh 四格同值）：
 *     rm -rf ./build              → deny（tiers=['inside']）
 *     echo a | rm -rf ./build     → deny（tiers=['inside']）
 *     echo a | (rm -rf ./build)   → **allow**（tiers=['wide','unknown']）← inside 档丢失
 * 且这一格是**本批改动新打开**的：HEAD 上 `echo a | (rm -rf ./build)` 因悬空检查返回
 * ok:false、走整行分支 → deny；本批放宽悬空检查后它走段级路径 → allow。
 *
 * ⚠️ 提成单点是为了消除**同一句「读不出」在两个路径上给出两个答案**的分叉：整行分支并的
 * 是这三档，而段级 opaque 支一度只 `add('unknown')` —— 于是用户显式配的 `wide=deny`
 * 在段级路径上被静默丢弃（fail-open，实测见 `tierSetOf` ① 的说明）。
 *
 * ⚠️ **不是「凡 opaque 段都并这三档」**：命令可读、构造只是**参数**的那一族
 * （`rm -rf ./tmp/{a,b,c}`：段首 label 是 `rm`）半径判据已按可读前缀判过档，
 * 并 `wide` 等于把已知结论抬成「可能很大」，是凭空收紧 —— `test/shell-parse.mjs` 的
 * 60g ④b/⑤b 把这一族（合法常用命令）钉死为「恰好 `['unknown']`」。
 */
const RADIUS_TIERS_WHEN_UNREADABLE = ['wide', 'unknown', 'inside']

/**
 * 段首的**主 label** 是否读得出一个破坏性命令名 —— 「真命令在段内、还是藏在构造里」。
 *
 * 与「目标读不出」是**两个不同的问题**，判据必须分开（见 `tierSetOf` ① 的说明）：
 *   · 读得出（`rm -rf ./tmp/{a,b,c}` 的 label 是 `rm`）—— 命令可读，构造只是**参数**，
 *     半径判据已按可读前缀（`./tmp/`）判过档。并 `wide` 等于把已知结论抬成「可能很大」，
 *     是凭空收紧，60g ④b/⑤b 把这一族（合法常用命令）钉死为「只有 `unknown`」。
 *   · 读不出（`(rm -rf C:/Windows)` / `` `rm -rf C:/Windows` `` /
 *     `{ Remove-Item C:/Windows -Recurse -Force }`：`words` 里连命令名都没留下）——
 *     真命令在构造里，半径侧**没有**任何结论。
 *
 * ⚠️ 判据用 `segmentLabel`（**主 label**）而不是 `segmentLabels`：后者会为
 * `find -exec rm {} +` 合成 `rm` 这种**间接** label，而那一族的词元齐全、半径判据正常
 * 工作（`find` 的路径目标可判），不属于本判据要覆盖的形态。
 *
 * ⚠️ **提权前缀必须单独排除**（发现 1 的修法）：`sudo` / `doas` / `su` / `pkexec` /
 * `runas` / `gsudo` **六个名字全部在 `DESTRUCTIVE_LABELS` 里**（那一行的注释明禁把它们
 * 移出名单，见 `assessCommand` 的 `priv` 分支），于是「提权前缀 + 真命令藏在 opaque 构造里」
 * 会被本判据误判成「命令可读」→ 走 `else` 支只并 `unknown` → 用户显式配的
 * `wide=deny` / `inside=deny` 被静默丢弃。
 *
 * 语义上提权前缀**不是命令头**：它只是权限包装，段首读出 `sudo` 恰恰说明**真命令在别处**
 * （`sudo $(rm -rf C:/Windows)` 的真命令在构造里）。故 `PRIV_PREFIXES[head] === 1` 时必须
 * 返回「读不出」——这与 `commandHeadEnd` 穿过提权前缀取真命令头是同一条口径。
 *
 * 实测（`wide=deny` + 其余七档 allow）：`echo a | sudo $(rm -rf C:/Windows)` 由
 * **allow**（tiers=`['unknown','priv']`）变 **deny**（tiers=`['wide','unknown','inside','priv']`）；
 * 而 `sudo rm -rf /etc` 与 `sudo ls` 逐字不变（它们的 `head` 是 `sudo`，但 `seg.opaque`
 * 为空 / `blast` 已有结论，走不到本守卫）。
 *
 * ⚠️ **`:4932` 那条提权兜底不可删**（发现 8 的报告者建议删掉它，实测会让
 * `sudo $(rm -rf C:/Windows)` 由 deny 变 **allow**）：`sudo` 本身就在 `DESTRUCTIVE_LABELS`
 * 里，故「段首是提权前缀、真命令在构造里」这一格只有它能挡住。它承重，不是冗余。
 *
 * ── 判据问的是「**opaque 构造自己有没有藏一个破坏性命令**」（发现 1 的修法）─────────────
 * 本函数此前问的是「**段首**是不是破坏性命令」，于是「段首本身是破坏性命令、而构造里
 * **另有一个**真破坏性命令」这一族判错：`echo a | rm -rf /tmp/x $(rm -rf /)` 的段首 label
 * 确实是 `rm`，判据说「命令可读」→ 走 `else` 支只并 `unknown` → 用户显式配的 `wide=deny`
 * 与 `inside=deny` 静默消失（实测 tiers=`['unknown','outside']`，**allow**）。
 *
 * ⚠️ 而这一格在 bash 里 `-n` = OK、**可执行**，`$(rm -rf /)` 真会跑。故它不是「构造只是参数」，
 * 而是**两个破坏性命令**：段首那个可读、构造里那个读不出。判据必须把两者**都**问一遍 ——
 * 只问段首就会漏掉后半句，只问构造就会把 `rm -rf ./build $(date)`（构造里是 `date`）
 * 一起误伤（60g ④b/⑤b 把它钉死为「恰好 `['unknown']`」）。
 *
 * ⚠️ **换 label 取法修不好这一格**：靶格的 `headCommandNameOf` 与 `segmentLabel` 同值
 * （都是 `rm`）—— 病因不在「取哪个 label」，而在**问错了问题**。故本判据=「段首可读
 * **且**构造里没有第二个破坏性命令名」。
 *
 * 构造原文由词法器按块记在 `seg.opaqueTexts`（见该字段的说明）：判定侧若拿 `seg.text`
 * 自己反推「哪段是构造」，就是同一份知识写两遍 —— 那正是本文件反复要修的那类分叉。
 *
 * @param {{words?: string[], opaqueTexts?: string[]}} seg 段
 * @returns {boolean} 段首 label 确实是破坏性命令名、且 opaque 构造里没有另一个时为真
 */
function destructiveHeadReadable(seg) {
  const w = seg && Array.isArray(seg.words) ? seg.words : []
  let head = ''
  // 判据用 `headCommandNameOf`（穿过提权前缀 / wrapper / 语句关键字取**真命令头**），
  // 不用 `segmentLabel`（发现 8）：后者不跳提权前缀，`segmentLabel(['sudo','rm',…])` = `'sudo'`
  // —— 于是「段首是 `sudo`」被无条件判成「命令读不出」，**即使紧跟其后的就是可读的 `rm`**：
  // `sudo rm -rf ./build $(date)` 由 allow 变 deny（tiers=`['wide','unknown','inside','priv']`），
  // 形态极常见，属误拦。`headCommandNameOf` 是文件里已有的单一来源（它的注释明写必须穿过
  // 提权前缀取真命令头），本判据与它同源后，`sudo rm …` 的 head 就是 `rm`。
  try { head = headCommandNameOf(w) } catch (e) { head = '' }
  // 空 label = 读不出（`(rm -rf /)` 的 `words` 是 `[]`）。
  // ⚠️ 这一行**是冗余的防御**：`isDestructiveLabel('')` 本身就返回 false（它先 `!!l`），
  //    且 `PRIV_PREFIXES` 是 `Object.create(null)` 的字典，`PRIV_PREFIXES['']` 是
  //    `undefined` 而非 `1`。保留它是为了让「空 label 算读不出」这条语义在**本函数里**
  //    显式可见（不依赖被调函数的内部实现），实测去掉它行为完全不变（变异测试无红灯）。
  if (!head) return false
  // 提权前缀不是命令头 —— 真命令在它后面（可能在 opaque 构造里）。
  if (PRIV_PREFIXES[head] === 1) return false
  // ── 段首那个**不是**真载荷：opaque 构造里另有破坏性命令 ────────────────────────────
  // 逐块问「这一块构造自己有没有藏一个破坏性命令」。命中即返回「读不出」——语义是
  // **段首那个可读的破坏性命令不是全部载荷**，构造里还有一个读不出的。
  //
  // ⚠️ 只对**构造原文**取 `rawCommandNames`，不整段取：整段取会把段首那个命令名本身
  // 也算进来（`rm -rf ./build $(date)` 的原文里就有 `rm`），于是**每一格**都命中、
  // 承重格 `rm -rf ./tmp/{a,b,c}` 被误伤成 `['wide','unknown','inside']`（60g ④b/⑤b 红灯）。
  // 判据必须问「构造**里**」，不能问「段里」—— 这正是发现 1 的病根（问错了范围）。
  //
  // ⚠️ `opaqueTexts` 缺席时（旧调用方 / 手搓的 `seg` 字面量）本判据**整个不生效**，
  // 退化为改动前的行为（只问段首）—— 方向是保守而非放宽。生产调用点已补传（见
  // `assessCommand` 的 `tierSetOf` 调用），故真实路径上恒生效。
  const texts = seg && Array.isArray(seg.opaqueTexts) ? seg.opaqueTexts : null
  if (texts) {
    for (const raw of texts) {
      let names = null
      try { names = rawCommandNames(raw) } catch (e) { names = null }
      if (!names) continue
      for (const n of names) { if (isDestructiveLabel(n)) return false }
    }
  }
  return isDestructiveLabel(head)
}

/**
 * 档位集合的**固定顺序**（`TIER_RANK` 的**唯一**比较实现）。
 *
 * 三个产出点共用它：`tierSetOf`、`assessCommand` 的整行读不懂分支，
 * 以及 `tierVerdict` 里「并列在最严档上的其余命中档」那一次排序。
 * 后两处曾经各自**手抄**了一份逐字相同的比较函数 —— 而 `decisiveTierOf` 的稳定性论证
 * 依赖「`tiers` 已按 `TIER_RANK` 排过」，抄漏一处的后果是**动作不变、拒绝理由随书写
 * 形态漂移**（发现 3）；`tierVerdict` 那一份更直接：它就是用户看到的拒绝理由。
 * 三处现在只剩这一个比较实现（发现 5 的修法：把 `tierVerdict` 的副本也换成本函数）。
 *
 * 原地排序并返回同一数组（调用方都要的就是排好序的那一份）。
 */
function sortTiersByRank(tiers) {
  return tiers.sort((a, b) => {
    const ra = TIER_RANK[a]
    const rb = TIER_RANK[b]
    return (ra === undefined ? 99 : ra) - (rb === undefined ? 99 : rb)
  })
}

/**
 * 该段命中的**全部档位**（半径档 ∪ 组档），按 TIER_ORDER 排序。
 *
 * 组合规则（§3.3）：
 *     档位集合 = 半径档(blast，仅当该组的判据是半径) ∪ 组档(label 所属组) ∪ (priv ? {'priv'} : {})
 *
 * 三处细节：
 *   · **半径档只在需要时算**：`proc`/`power`/`reg` 三组的 blast 恒 null，算出来只会是
 *     `inside` —— 把它并进去等于给 `kill 1234` 白送一个 inside 档，而 `inside` 是
 *     「跟随大分类」的那一档，混进来会让「命中档位」这句话失去意义（每个段都命中 inside）。
 *     判据 = 该段的**任一** label 属于半径组（`RADIUS_GROUPS`）。
 *     ⚠️ **这个门控只管「半径档并还是不并」，不管 `unknown`** —— 两条口径互相独立：
 *     半径档回答「目标在区内/区外」，`unknown` 回答「后果读不出」。此前 `unknown` 的
 *     三条产出判据被写在门控**之内**，于是**纯组档段**（段内无 del/disk/perm/priv 组
 *     label）整段跳过它们 —— 同一条「目标读不出」的结论，只因命令属组档就静默 allow。
 *     实测（`unknown=deny`、其余七档 allow，修复前）：
 *         kill $T / shutdown $T / reg delete $T /f / taskkill /pid $T
 *         pkill / killall / reboot / halt / poweroff / stop-computer / stop-process / wmic
 *         (kill 1234) / kill $(cat p) / shutdown $(date)   → **全部 allow**（tiers 只有组档）
 *         对照 sudo kill $T → deny（tiers=['unknown','proc','priv']）、rm -rf $T → deny
 *     方向 fail-open，且是「同一语义两个结论」的不变量分叉。故门控外**必须**照常
 *     求值那三条判据 —— 见 ① 的 `else` 分支。
 *   · **`priv` 档另算**：提权前缀可能不出现在 labels 里（`su`/`runas` 的 segmentLabels
 *     扩展被刻意排除），故用 `segmentPrivilege` 的**位置判据**兜底。
 *     `sudo ls` 的 labels 是 ['sudo','ls']（扩展后），`sudo` 在 priv 组里，两条路都命中；
 *     而 `su -c "rm -rf /"` 的 label 是 `su`（也在 priv 组里）。两条路互为冗余而非重复 ——
 *     冗余的那一侧（位置判据）覆盖的是 `segmentLabels` 刻意不扩展的形态。
 *   · **`unknown` 覆盖半径档**：`diskpart` 裸跑 / `set-executionpolicy` / `diskpart /s <脚本>`
 *     的半径判据**覆盖不到**（前者进交互、后两者实参不是路径），它们的 `blast` 也是 null，
 *     但含义不是「目标在区内」而是「后果读不出」。故这一支**替换**半径档而不是叠加 ——
 *     叠加会同时给出 `inside`（等于宣称无害）与 `unknown`（宣称读不出），自相矛盾。
 *
 * @param {{words: string[], blast?: object|null, opaque?: string|null}} seg 段（blast 由调用方算好）
 *   `opaque` 是词法器给出的「这一段里有读不懂的构造」标记（`decomposeCommand` 的段字段），
 *   必须一并传入 —— 见 ① 的 opaque 分支：漏传它会让「目标被 opaque 构造吞掉」重新变回 `inside`。
 * @param {string[]} labels segmentLabels(seg.words) 的结果
 * @param {object} [opts] 判档选项（`isCmdStyleSwitch` 判 cmd 开关需要 platform）
 */
export function tierSetOf(seg, labels, opts) {
  const list = Array.isArray(labels) ? labels : []
  const set = []
  const add = (t) => { if (t && set.indexOf(t) === -1) set.push(t) }
  // ① 半径档。**两种「并」法**，取决于段内是哪种半径组：
  //
  //   · 段内有**纯半径组**（del / disk / perm）的 label → **恒并**，`null` 按 §5.1 归 `inside`。
  //     这三种命令的判据**就是**目标范围，`null` 的含义是「判过档、目标在区内」
  //     （`rm -rf ./build` 实测 null），故 `inside` 是对它唯一正确的档。
  //
  //   · 段内**只有提权**（priv 组）→ **仅在 `blast` 非 null 时并**。提权的半径档来自
  //     **内部命令**的目标（`sudo rm -rf /etc` 的 system 来自 /etc，不是来自 sudo），
  //     没有可判目标时半径判据应当**弃权**，而不是并一个 `inside`：
  //     `inside` 是关于**目标位置**的断言，而 `sudo ls` 根本没有目标 ——
  //     断言它「目标在区内」等于把「无从判断」说成了「判断为安全」。
  //     计划 §2.3 的实测结论正是这条：「`sudo ls` 只命中 `priv`」，
  //     而 `sudo rm -rf /` 命中 `priv` + `wide`。
  //
  // 这个区分有可观察的行为差异：用户把 `inside` 设为 deny、`priv` 设为 allow 时，
  // `sudo ls` 应当是 allow（用户显式放行了提权），而不是被一个凭空多出来的 `inside` 档拒绝。
  let hasPureRadius = false
  let hasPrivGroup = false
  for (const l of list) {
    const g = GROUP_OF_LABEL[String(l == null ? '' : l).trim().toLowerCase()]
    if (!g || RADIUS_GROUPS[g] !== 1) continue
    if (g === 'priv') hasPrivGroup = true
    else hasPureRadius = true
  }
  // ── 门控的第三个合取项：**破坏性命令藏在 opaque 构造里**（发现 3 的修法）──────────────
  // 前两项都只覆盖「半径组 label」：`hasPureRadius` 要求段内有 del/disk/perm 组的 label，
  // `hasPrivGroup` 要求有 priv 组。而**纯组档段**（`kill` / `pkill` / `reboot` / `shutdown` /
  // `taskkill` / `stop-computer` / `reg delete` / `stop-process`）的 `GROUP_OF_LABEL` 是
  // `proc` / `power` / `reg` —— **既非 pureRadius 也非 privGroup**，于是整个门控不进入，
  // 下面那个 `opaqueHiddenPayload` 守卫**从不被求值**，同一条「真命令藏在构造里」的结论
  // 只因命令属组档就静默 allow（fail-open）。
  //
  // 实测（`wide=deny` + 其余七档 allow，修复前）：
  //     echo a | (rm -rf ./build)  → deny tiers=['wide','unknown','inside'] ✅（del 族进门控）
  //     echo a | (kill 1234)       → **allow** tiers=['unknown','proc']      ❌（proc 族被跳过）
  //     echo a | (reboot)          → **allow** tiers=['unknown','power']     ❌
  //     echo a | (reg delete HKCU\\X /f) → **allow** tiers=['unknown','reg'] ❌
  // 可达面 = 8 个组档命令 × `|` / `&&` / `||` / `&` 四种分隔符。
  //
  // ⚠️ 第三个合取项**必须**是「opaque 且命令读不出」，不能放宽成 `seg.opaque`：
  // 后者会把「命令可读、构造只是参数」的那一族也拉进门控，改掉 `diskpart /s a.txt`
  // 这类承重格的「替换」语义（`:4244-4245` 明禁）。判据与门控内那两条守卫同源。
  const opaqueHiddenPayload = !!(seg && seg.opaque && !destructiveHeadReadable(seg))
  if (hasPureRadius || (hasPrivGroup && seg && seg.blast) || opaqueHiddenPayload) {
    // ── opaque 段：目标被读不懂的构造吞掉，`null` 的含义**不是**「在区内」────────────
    // 词法器把 opaque 构造（子 shell `( )`、命令替换 `$( )` / 反引号、花括号分组 `{ }`）
    // 整块吞掉，段级词元只剩构造**之外**的部分：
    //     (rm -rf /etc)          → words 是 []（连命令名都没留下）
    //     rm -rf $(echo /etc)    → words 是 ['rm','-rf']（目标整个在构造里）
    // 于是 `blastRadiusOfSegment` 没有任何目标词元可判、返回 `null`，而 §5.1 把 `null`
    // 映射成 `inside` —— 「目标读不出」被当成了「目标在工作区内」。
    //
    // `sawUnjudgeable` 这条保护在这里**结构性失效**：它只在「非空词元被判为读不出」时
    // 置位（见该函数的置位表），而 opaque 段一个目标词元都没留下 —— 前一种形态连词元
    // 都没有，后一种的目标根本不在词元里。实测（默认配置 mode=allow：inside=allow、
    // 其余七档=ask）：
    //     (rm -rf /etc) / { rm -rf /etc; } / `rm -rf /etc` / rm -rf $(echo /etc)
    //     echo $(rm -rf /etc) / (rm -rf .) / (rm -rf ~) / (rm -rf C:/Windows)
    // 八种写法全部 allow。这与「整行读不懂」分支同口径：**读不出就归 `unknown`**，
    // 不归 `inside`（§4「三种 null 必须分开」）。
    //
    // 只在 `blast` 为 null 时替换 —— 已有结论时那个结论更具体，不该被降级成更模糊的
    // 说法：`rm -rf C:/Windows $(x)` 实测 blast=wide（真目标是系统目录，判得出来）。
    // ⚠️ 但「不**替换**」不等于「不并 `unknown`」——`blast` 非空时那条结论照样要并进来，
    // 只是走的是**门控外**的判据 ③（`seg.opaque`，并列补档），故此处守卫保持不变。
    //
    // ⚠️ **门控内保持「替换」语义逐字不变**（本批只把 `unknown` 侧判据移出门控）：
    // `diskpart /s a.txt` 走的就是这一支（`isUnknownTierSegment` 为真 → 只给 `unknown`，
    // 半径档 `outside` 被替换掉），改成叠加会白送一个半径档，而 `:4207-4208` 明禁。
    const opaqueUnjudgeable = !!(seg && seg.opaque && !seg.blast)
    // ── 门控修正（发现 2 的修法）：`!seg.blast` **不是**「半径侧读不出」的完整判据 ──────────
    // `blast` 非空也可能是 `{level:'unknown'}` —— 那同样是「半径侧没有结论」，只是
    // `blastRadiusOfSegment` 走的是**另一条**产出路径：词法器**不吞**反引号，命令替换
    // 作为一个字面词元留在 `words` 里（`Write-Output \`rm -rf C:/Windows\`` 的
    // `words` 是 `['Write-Output','`rm -rf C:/Windows`']`），该词元被判为「读不出」
    // → `sawUnjudgeable` 置位 → 段级 blast 是 `{level:'unknown'}` 而非 `null`。
    //
    // 于是旧门控 `seg.opaque && !seg.blast` 对反引号形态**恒假**，本守卫整个不被求值，
    // 落到 `else` 支的 `radiusTierOf({level:'unknown'})` —— **只**并 `unknown`，
    // `wide` 被静默丢弃。同一构造的四种写法里只有反引号漏网，方向 fail-open：
    //     echo a | Write-Output $(rm -rf C:/Windows)   → deny  tiers=['wide','unknown']
    //     echo a | Write-Output (rm -rf C:/Windows)    → deny  tiers=['wide','unknown']
    //     echo a | Write-Output {rm -rf C:/Windows}    → deny  tiers=['wide','unknown']
    //     echo a | Write-Output `rm -rf C:/Windows`    → **allow** tiers=['unknown'] ❌
    // （实测 `wide=deny` + 其余七档 allow。）
    //
    // ⚠️ 两条守卫**缺一不可**，且都不可放宽：
    //   · `!destructiveHeadReadable(seg)` —— 命令可读、构造只是**参数**的那一族
    //     （`rm -rf ./build $(date)`、`rm -rf ./tmp/{a,b,c}`）**必须**留在 `else` 支，
    //     60g ④b/⑤b 把它们钉死为「恰好 `['unknown']`」。它们的段首 label 是 `rm`，
    //     故被本条排除；`rm -rf $TARGET` 同理（且它 `opaque` 为空，双重排除）。
    //   · `seg.opaque` —— 没有 opaque 构造的段不参与（`kill 1234` 那族不得凭空多档）。
    //
    // ⚠️ 只把「半径侧读不出」的判据补齐，**不动** `else` 支的「替换」语义：
    // `diskpart /s a.txt`（`opaque` 为空、`isUnknownTierSegment` 为真）照旧恰好
    // `['unknown']` —— 它不满足 `seg.opaque`，走不进本支。
    // ── 「半径侧读不出」这个判据**已被下面的守卫完全吸收**，故不再单列变量（发现 10）──────
    // 曾写作 `const opaqueRadiusUnreadable = !!(seg.opaque && (!seg.blast || seg.blast.level === 'unknown'))`
    // 并作为**第一个析取项**参与守卫：`(opaqueRadiusUnreadable || opaqueHiddenPayload) && !destructiveHeadReadable(seg)`。
    // 那个写法里的第一个析取项是**冗余**的，且是**代数上恒等**的冗余（不依赖
    // `destructiveHeadReadable` 怎么定义，故修复 A 改动它不影响本结论）。记 `O = seg.opaque`、
    // `D = destructiveHeadReadable(seg)`、`B = seg.blast`：
    //     opaqueHiddenPayload    = O && !D
    //     opaqueRadiusUnreadable = O && (!B || B.level === 'unknown')
    //     守卫 = (opaqueRadiusUnreadable || opaqueHiddenPayload) && !D
    //          = O && ((!B || …) || !D) && !D
    //          = O && !D && ((!B || …) || !D)      ← 已有 `!D`，故括号内恒真
    //          = O && !D
    //          = opaqueHiddenPayload                ∎
    // 直白地说：`opaqueRadiusUnreadable` 蕴含 `O`，而 `opaqueHiddenPayload` 也蕴含 `O`；
    // 一旦 `!D` 成立，两个析取项**都不可能**提供 `opaqueHiddenPayload` 之外的信息 ——
    // 「半径侧读不出」从来不是与「载荷藏在构造里」并列的第二个结论。
    // 实测（950 条语料 × 11 配置 × 2 方言 = 20900 次判定，守卫被求值 17424 次）：
    // 化简前后**真值不一致 0 次**，两侧同为真 13178 次。
    //
    // ⚠️ 化简**不改变语义**，只去掉冗余；下面 `if` 的判据仍是「opaque 且段首命令读不出」，
    // 故 `!destructiveHeadReadable(seg)` 与 `seg.opaque` **两个条件照旧都在承重**
    // （它们现在由 `opaqueHiddenPayload` 一并表达，见 `:5259` 的门控第三项，同一个布尔）。
    //
    // ⚠️ 只把「半径侧读不出」的判据补齐，**不动** `else` 支的「替换」语义：
    // `diskpart /s a.txt`（`opaque` 为空、`isUnknownTierSegment` 为真）照旧恰好
    // `['unknown']` —— 它不满足 `seg.opaque`，走不进本支。
    // ── 发现 2 的修法：**诱饵目标**使 `wide`/`inside` 静默消失 ────────────────────────
    // 本守卫的判据是「命令读不出」，而**不是**「`blast` 空**或**为 `unknown`」——
    // 后者是初版写法，当 opaque 段里另有一个**可读**目标、且其 blast 恰为 `outside`
    // （`home` 同）时，该式为假 → 落进 `else` 支 → 只并 `outside`，`wide` 与 `inside`
    // 从 `tiers` **静默消失**。
    //
    // 实测（`wide=deny` + 其余七档 allow，修复前）：
    //     cat /etc/hosts $(rm -rf C:/Windows)  → **allow** tiers=['unknown','outside']
    //                                            blast=outside:/etc/hosts ← 诱饵把判据骗开
    //     echo $(rm -rf C:/Windows)            → deny      tiers=['wide','unknown','inside'] ✅
    // 诱饵档位逐条实测：`/etc/hosts`、`~/notes.txt` 触发（outside）；`C:/Windows/x`（system）、
    // `B:/`（drive-root）、`$T`（unknown）、`./build`（null）**都不触发** —— 前三者自身就
    // 归 `wide`/`unknown`（已有更严结论），后者 blast 为 null 时仍走上面那条 `!seg.blast` 判据。
    // 其中**尾随 `&` 一格是本批新引入的 deny→allow**（`&` 的悬空检查放宽后走段级路径），
    // 其余分隔符是既有缺口。
    //
    // 故把 `opaqueHiddenPayload`（= `seg.opaque && !destructiveHeadReadable(seg)`，
    // 与门控第三项**同一个布尔**）作为本守卫的**唯一**判据：真命令藏在构造里这件事与
    // 诱饵目标无关，诱饵档由下面那句 `add(radiusTierOf(seg.blast))` **显式保留**。
    //
    // ⚠️ 两个方向都不能少（这一句指的是**支内**那两条语句，与上面的守卫判据无关）：
    //   · 只并三档、**不**保留诱饵档 —— 会把已判出的 `outside` 丢掉，而用户可能显式配了
    //     `outside=deny`（丢掉它就是丢掉一条显式表态）；
    //   · 只保留诱饵档、**不**并三档 —— 就是修复前那个 fail-open（`wide=deny` 被静默丢弃）。
    // 故下面在三档之后**显式**补 `add(radiusTierOf(seg.blast))`（`add` 自带去重，
    // `blast` 为 `null` / `unknown` 时它落在三档之内，是空操作）。
    if (opaqueHiddenPayload) {
      // ── 「**破坏性命令本身藏在 opaque 构造里**」：与「整行读不懂」分支取同一口径 ──────
      // 判据 = 段首读出来的命令名**不是**破坏性命令（空 label 也算读不出），而这一段却被
      // 判成破坏性段 —— 那只可能是 `rawCommandNames` 在构造里认出了真命令。此时：
      //   · 半径判据**没有**任何可判目标（`blast` 是 null，**或**是 `{level:'unknown'}`，
      //     两者都不是「判过、在区内」）；
      //   · 构造里藏着的既可能是无害命令、也可能是删盘根 —— **读不出半径不等于半径安全**。
      // 故并 `wide ∪ unknown ∪ inside` 三档参与取最严（`inside` 见 `RADIUS_TIERS_WHEN_UNREADABLE`
      // 的注释：整行分支一直并它，丢掉它就等于丢掉用户可能显式配过的 `inside=deny`），
      // 档位集合与整行分支**单点共用**（`RADIUS_TIERS_WHEN_UNREADABLE`），不再两处各写一份。
      //
      // ⚠️ 修的是一个 fail-open：用户**显式配置的 `wide=deny`** 曾在段级路径上被静默丢弃。
      // 实测（`wide=deny` + `unknown=allow` + `category=allow`）：
      //     echo a | (rm -rf C:/Windows)  ← 行尾悬空检查放宽前 ok:false，走整行分支 → deny
      //                                     放宽后 ok:true、末段 opaque → 只命中 unknown → **allow**
      // `|` / `&&` / `||` / `&` 四种分隔符同形（`;` 与换行分隔的同形态在放宽前**已经是**
      // allow，早就走段级路径）—— 即缺陷面正是这次放宽新打开的。
      //     Get-ChildItem | ForEach-Object { Remove-Item C:/Windows -Recurse -Force }
      //     同理：段首 label 是 `foreach-object`，真命令 `remove-item` 只在构造里。
      //
      // ⚠️ **不得放宽成「凡 opaque 且半径侧读不出就并 wide」**（仲裁的初版修法）：
      // 那会连带改掉「命令可读、构造只是**参数**」的一族，而它们是合法常用命令、
      // 半径判据已按可读前缀判过档，并 `wide` 等于把已知结论抬成「可能很大」——
      // `test/shell-parse.mjs` 的 60g ④b/⑤b 把这一族钉死为「恰好 `['unknown']`」
      // （`rm -rf ./tmp/{a,b,c}`、`rm -rf ./build $(date)`：段首 label 是 `rm`，
      // 命中本行的 `destructiveHeadReadable` 守卫 → 不并 `wide`/`inside`，行为逐字不变）。
      for (const t of RADIUS_TIERS_WHEN_UNREADABLE) add(t)
      // 诱饵目标已判出的半径档（`outside` / `home` 那一族）**显式保留**，见本支开头。
      add(radiusTierOf(seg && seg.blast))
    } else {
      add((opaqueUnjudgeable || isUnknownTierSegment(list, seg && seg.words, opts))
        ? 'unknown'
        : radiusTierOf(seg && seg.blast))
    }
  }
  // ── 并列补档行：`unknown` 侧的三条产出判据（**移出门控**，见 `tierSetOf` 的 ① 说明）──
  // 上面那一支是「半径档 / unknown **二选一**」的替换语义，而它整个被门控包着 —— 于是
  // **纯组档段**（proc / power / reg，段内无 del/disk/perm/priv 组 label）整段跳过，
  // 同一条「目标读不出」的结论只因命令属组档就静默 allow（fail-open，实测见函数头注释）。
  //
  // 门控存在的**唯一**正当理由是「不给 `kill 1234` 白送 inside 档」（`radiusTierOf(null)`
  // 会把「没判过」当成「判过且在区内」）。它**不该**连带挡住 `unknown` 的产出判据 ——
  // 三条判据都自带「确实读不出」的守卫，不会凭空产档：
  //   ① `blast.level === 'unknown'`  —— `blastRadiusOfSegment` 判过、结论就是读不出；
  //   ② `blast.unjudgeable`          —— 已知目标 + 读不出目标同段共存（`:5126` 一族）：
  //      `blastRadiusOfSegment` 对「读得出的目标 + 读不出的目标」同段共存的情形会返回
  //      **带 `unjudgeable` 标志的已知档**（`worst` 仍用于 `blast` 显示），两个结论是
  //      **并列**关系而非二选一，故这一支是**补**（`unknown` 与半径档并列进入取最严）。
  //      实测（`unknown=deny`、`outside=allow`、`wide=allow`，修复前 → 修复后）：
  //          rm -rf /etc $TARGET     allow/['outside'] → **deny**/['unknown','outside']
  //          rm -rf $TARGET /etc     allow/['outside'] → **deny**/['unknown','outside']（顺序无关）
  //          dd of=$DEV of=/dev/sda  allow/['outside'] → **deny**/['unknown','outside']
  //      而 `blast` 仍显示 `outside:/etc`（已知最严重的那一档），弹窗文案不变。
  //   ③ `seg.opaque`                  —— 目标被 opaque 构造吞掉（`(kill 1234)` /
  //      `kill $(cat p)` / `shutdown $(date)`：`words` 里一个目标词元都没留下，故
  //      `sawUnjudgeable` 与 `isUnknownTierSegment` 双双够不到）。
  //
  // ── ⚠️ 判据 ③ 是 `seg.opaque`，**不带** `&& !seg.blast` 守卫（发现 7 的修法）──────
  // 初版写作 `seg.opaque && !seg.blast`，把「opaque」与「有半径档」当成**二选一**：
  // 有 `blast` 就不补 `unknown`。但 `$(...)` / 反引号形态下词法器把构造**整块吞掉**、
  // 目标词元不进 `words`（`rm -rf /etc $(rm -rf /)` 的 `words` 只有 `['rm','-rf','/etc']`），
  // 于是三条判据对「**有**半径档的 opaque 段」全部够不到：
  //     · `blast.level === 'unknown'`  为假（blast 是 `outside` —— 判据①够不到）
  //     · `blast.unjudgeable`          为假（构造里那个目标连词元都没进，没有「读不出的词元」
  //                                    可置位 —— 判据②够不到）
  //     · `seg.opaque && !seg.blast`   为假（blast 非空 —— 判据③被守卫挡住）
  // 实测（`unknown=deny`、其余七档 allow、category=allow）：
  //     rm -rf /etc $(rm -rf /)   → **allow** `['outside']` ❌
  //     rm -rf /etc `rm -rf /`    → deny `['unknown','outside']` ✅（**同义，仅引号形态不同**）
  // 方向 fail-open，且是「同一语义两个结论」的不变量分叉 —— 与 ① ② 要堵的是同一类。
  // 反引号形态之所以躲过，只因词法器在那一支保留了字面词元（`\`rm -rf /\`` 进了 `words`）
  // → `sawUnjudgeable` 置位 → 判据②命中。两条路径的差别是词法细节，不是语义差别。
  //
  // ⚠️ **代价只在「外层目标可判出半径档 + opaque」这一族**，且方向是收紧：
  //     rm -rf /etc $(date) / taskkill /im x.exe $(date) → 多并 `unknown` 档（原只有半径/组档）
  // 而 `rm -rf ./build $(date)`（blast=null）在**修复前就已经**是 `['unknown']`（判据③命中），
  // 本修法对它**零差异** —— 故「`$(date)` 会多问」不是本修法的代价（那是既有行为）。
  //
  // ⚠️ **花括号展开族不是「全部零差异」**（此处一度如此自称，实测更正）：
  // 花括号同样标 opaque（`:3575`），但差异与否取决于**前缀词元能否判出半径档**：
  //   · `rm -rf ./tmp/{a,b,c}` / `chmod 777 ./{a,b}.sh` / `rm -rf ./{a,b}/x` / `rm -rf {a,b}`
  //     —— 前缀词元（`./tmp/`、`./.sh`、`.//x`）判 `inside` → blast=null → 修复前已是
  //     `['unknown']`，本修法**零差异** ✅
  //   · `rm -rf ./{dist,build}` —— 前缀词元是 `./`，**带 `isWorkspaceRoot` 钩子**（生产口径）
  //     时 blast=`workspace-root` → `wide` 档，故本修法给它多并一个 `unknown`
  //     （`['wide']` → `['wide','unknown']`）。⚠️ 这一格**不是零差异**，但方向与性质都安全：
  //     默认配置下 `wide=ask` 与 `unknown=ask` **同值**，action 不变（ask）；只有
  //     `unknown=deny` 那类配置下才由 allow 变 deny（收紧）。不带该钩子时它 blast=null，
  //     回到上一档（零差异）—— 即差异**只在该钩子存在时出现**。
  //   · `rm -rf /etc {a,b}` / `rm -rf C:/Windows/{a,b}` —— 外层目标已越界（wide/outside），
  //     多并 `unknown`；默认配置下 action 差异为 0（都是 ask）。
  // 实测（12 配置 × 516 命令 × 2 平台 = 12384 格）：花括号族 936 格中
  // **收紧 90 / 放宽 0 / 中性 558**，中性格全部是「只加 `unknown`、不移除任何半径档」。
  //
  // ⚠️ 三条**缺一不可**：只补 ① ② 时第 ③ 族仍是 allow（实测 `(kill 1234)` →
  // allow/['proc']），即「只修一支」。此处对**已门控**的段是空操作（`add` 去重，
  // 且 ① ③ 在门控内已产出 `unknown`），对**纯组档段**与「有半径档的 opaque 段」才是收益。
  // ⚠️ `isUnknownTierSegment` 对组档段**恒假**（表里只有 del/disk/perm 成员），
  // 故它留在门控内、不随本条移出 —— 移出会改变 `diskpart` 那一族（承重格，见上）。
  if (seg && ((seg.blast && (seg.blast.level === 'unknown' || seg.blast.unjudgeable))
    || seg.opaque)) add('unknown')
  // ② 组档
  for (const t of groupTiersOf(list)) add(t)
  // ③ 提权（位置判据）。与 ② 的 `priv` 组档互为冗余而非重复 ——
  // 冗余的那一侧（位置判据）覆盖的是 `segmentLabels` 刻意不扩展的形态（`su` / `runas`）。
  if (seg && segmentPrivilege(seg.words)) add('priv')
  // 排序：固定顺序，与用户配置无关（见 TIER_ORDER 的注释）。
  // 与整行读不懂分支共用 `sortTiersByRank`（同一条纪律：排序键只有一份）。
  return sortTiersByRank(set)
}

/**
 * 段级动作的严格度序：allow < ask < deny（越大越严）。
 *
 * **与 index.js 的 MODE_STRICTNESS 是同一个序**，但两处不能合并 —— 那个在宿主闭包里、
 * 这个在纯解析器里，解析器不能依赖宿主（它要能独立单元测试）。
 * 两处都只有一行，且都由测试断言钉住，漂移风险低于「把解析器耦合到宿主」的代价。
 */
const TIER_STRICTNESS = { allow: 0, ask: 1, deny: 2 }

/**
 * 命中档位 → 动作：取**最严**（deny > ask > allow）。
 *
 * 与既有设计同构 —— 段之间就是这么合并的（`shell-parse.js` 的 fail-closed 合并注释）：
 * 「段之间是**并列**关系……只能整体从严」。
 *
 * `inherit` 的处理：它表示「该档没有表态」，不参与比较；**若所有命中档都是 inherit**
 * 则返回 `inherit`，让调用方按既有语义落大分类。`undefined`（配置里根本没有这一档，
 * 老配置升级路径）同样跳过 —— 缺档由宿主的 `destructiveTiers` 补齐，补不到才落到这里。
 *
 * ── 「选档」只有一份实现：本函数**必须**基于 `decisiveTierOf` ──────────────────────
 * 这里曾经自己再写一遍「查 TIER_STRICTNESS + `r > bestRank` 循环 + 跳过 undefined」，
 * 与 `decisiveTierOf` 逐行同构、只差返回 `ds[t]` 还是 `t`。两者必须**永远选中同一档**：
 * `decisiveTierOf` 选出的那一档正是调用方取 `reasons[tier]` 用的那一档
 * （见 `assessCommand` 的拒绝理由）。各留一份的后果是「日后只改一处」——动作来自 A 档、
 * 拒绝理由取自 B 档，而两者都不会报错，只会让弹窗解释与实际裁决不一致。
 * 故把选档收敛到 `decisiveTierOf` 一处，本函数只负责把档位翻译成动作。
 *
 * @param {object|null} ds 宿主的档位表（`{inside, outside, wide, …, reasons?}`）
 * @param {string[]} tiers 命中的档位
 * @returns {'allow'|'ask'|'deny'|'inherit'}
 */
export function strictestTierAction(ds, tiers) {
  const t = decisiveTierOf(ds, tiers)
  // 没有任何档给出具体动作（全部未表态 / 表里没有这些键）→ inherit，
  // 由调用方按既有语义落大分类默认值。
  return t === null ? 'inherit' : ds[t]
}

/**
 * 命中档位里**决定动作**的那一个（用于取该档的拒绝理由）。
 *
 * 判据与 `strictestTierAction` 同源（同一个严格度序 + 同一个「取最严」），
 * 且并列时取 `tiers` 里**靠前**的那个。
 *
 * ⚠️ 「靠前」的稳定性**由调用方保证**：本函数不看 `TIER_ORDER`，只认 `tiers` 的**排列**，
 * 故稳定性对**已排序**的 `tiers` 成立 ——
 *   · `tierSetOf` 的产物（返回前按 `TIER_RANK` 排过）；
 *   · `assessCommand` 整行读不懂分支那条**手工拼接**路径（已按**同一个** `TIER_RANK` 排过，
 *     见那里的说明：不排的话动作不变、理由会随书写形态漂移）。
 * 传进未排序的 `tiers` 时本函数仍然正确选出**最严档**，只是并列时取哪个由传入顺序决定。
 * 没有任何档给出具体动作时返回 `null`。
 */
export function decisiveTierOf(ds, tiers) {
  const list = Array.isArray(tiers) ? tiers : []
  let best = null
  let bestRank = -1
  for (const t of list) {
    const r = TIER_STRICTNESS[ds ? ds[t] : null]
    if (r === undefined) continue
    if (r > bestRank) { bestRank = r; best = t }
  }
  return best
}

/**
 * 段级「命令头位置上的命令名」—— **判据单点**，供 `hasNoOperand` 与
 * `blastRadiusOfSegment` 两个消费点共用。
 *
 * ── 为什么必须单点 ──────────────────────────────────────────────────────────
 * `commandHeadEnd` 的 ① 分支经 `skipPrefixArgs` 把 `su -l` 这类**普通选项**吃掉并
 * **停在其上** ⇒ `w[headEnd - 1]` 是 `-l` 而不是命令名 ⇒ 直接把它当 `cmdName` 传给
 * `isCmdStyleSwitch`，会因 `GROUP_OF_LABEL['-l']` 查不到而走「认不出命令名 ⇒ 不消费
 * 半径」兜底 ⇒ 真正的目标实参被当成 cmd 风格开关跳过。
 *
 * 该判据此前在上述两个消费点各存一份**逐字副本**，而这一族**历史上已两次漂移**
 * （两处各自的注释都记录了漂移本身）。抽成单点后两个消费点由**同一个**函数钉住：
 * 改这一处即两处同时生效，结构上不再可能「只改一处」。
 *
 * ── 守卫三项（缺一不可）────────────────────────────────────────────────────
 *   · `headEnd` 是有效下标（`> 0 && < w.length`）—— 否则 `w[headEnd - 1]` 无意义；
 *   · `w[headEnd - 1]` 以 `-` 开头（`charCodeAt(0) === 45`，与 `skipPrefixArgs` 同判据）；
 *   · **不是值选项**（`isPrivCommandValueFlag`，O(1) 查表）—— `-c` / `--command` 的值
 *     **本身就是命令或目标**（`PRIV_VALUE_IS_COMMAND`），`commandHeadEnd` 停在值选项上
 *     是**刻意的**，命令头**不该**继续推进。删掉这一项会在值选项形态上引入新的放宽：
 *     `su -c C:/data parted /data` 由 `unknown,priv` 变 `outside,priv`、
 *     `su -c /data parted /data` 由 `unknown,priv` 变 `inside,priv`。
 *
 * 三项全过 ⇒ 命令名改从 `commandHeadEndFull` 取（它额外认识语句关键字，推进得更远）；
 * **取两者较大者**而非无条件取 `headFull`：两者在少数形态上不同向，取大者与两个消费点
 * 循环里的 `i < headEnd || i < headFull` 并集口径一致。
 *
 * ── 惰性（性能纪律，勿退化成无条件求值）──────────────────────────────────────
 * `commandHeadEndFull` 是 O(n) 推进循环，**只在守卫命中时才调**：第三个形参是调用方
 * 已算好的 `headFull`（`hasNoOperand` 本来就要算它，传进来即可）；**不传**时本函数才
 * 惰性去调（`blastRadiusOfSegment` 走这条，它没有现成的 `headFull`）。无条件先算实测
 * 多花约 0.31 µs/段。守卫本身 O(1)、无正则、无分配。
 *
 * @param {string[]} words 段词元
 * @param {number} headEnd `commandHeadEnd(words)` 的结果
 * @param {number} [headFullHint] 调用方已算好的 `commandHeadEndFull(words)`；缺省时惰性求值
 */
function headCmdNameForSegment(words, headEnd, headFullHint) {
  const w = Array.isArray(words) ? words : []
  // 守卫三项**逐字**取自原先两份副本（`headEnd > 0 && headEnd < w.length` 的写法也一并
  // 保留：`commandHeadEnd` 恒返回 number，但逐字保留可让「非数字 headEnd」这类异常输入
  // 上的行为也与改动前**逐字相同**，不必依赖「不可达」这一论证）。
  if (headEnd > 0 && headEnd < w.length
    && String(w[headEnd - 1]).charCodeAt(0) === 45
    && !isPrivCommandValueFlag(String(w[headEnd - 1]))) {
    let headFull = 0
    // `Number.isNaN` 一并挡掉：`typeof NaN === 'number'` 为真，不挡会把 NaN 当合法提示用
    // （取大式随即得 NaN ⇒ 落回段首解析），而调用方违约时正确的退化是**走惰性**。
    if (typeof headFullHint === 'number' && !Number.isNaN(headFullHint)) headFull = headFullHint
    else { try { headFull = commandHeadEndFull(w) } catch (e) { headFull = 0 } }
    return headCommandNameOf(w, headEnd > headFull ? headEnd : headFull)
  }
  return headCommandNameOf(w, headEnd)
}

/**
 * 裸跑交互类判据（`BARE_INTERACTIVE`）—— **形态**判据：该段没有任何非选项实参。
 *
 * 「非选项实参」= 不是 `-`/`--` 开头、不是 cmd 风格开关（`/s`，仅 Windows）、
 * 不是重定向、不是 `NAME=value` 赋值形态、也不是命令名自身。
 *
 * 判据必须与 blastRadiusOfSegment 的循环同源（那里就是按这几条跳过非目标的），
 * 否则会出现「判档认为没有目标、形态判据认为有目标」的分叉。
 */
function hasNoOperand(words, opts) {
  const w = Array.isArray(words) ? words : []
  let headEnd = 0
  try { headEnd = commandHeadEnd(w) } catch (e) { headEnd = 0 }
  // 命令头的**完整**结束下标（额外认识语句关键字）—— 见 commandHeadEndFull。
  // 为什么两处都要：`headEnd` 是 blastRadiusOfSegment 消费的那一份（它不跳关键字，
  // 靠 mayNeedBlastCheck 预筛处理），`headFull` 是本判据真正需要的「命令头到哪儿为止」。
  // 取两者**较大者**：两个判据都是「这些位置不是操作数」，取并集只会更保守地跳过命令头。
  let headFull = 0
  try { headFull = commandHeadEndFull(w) } catch (e) { headFull = 0 }
  const skip = Object.create(null)
  // ── 三处写入统一**小写**，查表处双侧归一（见下面的 `skip[token] || skip[token.toLowerCase()]`）
  // `headCommandNameOf` 返回的命令名是**已小写**的（`commandNameOf` 末尾 toLowerCase），
  // 而循环里查表用的是**原始词元**。`['time','Diskpart']` 的 skip 里是 `diskpart`、
  // 查表查 `Diskpart` → 不命中 → 判 false（该段不归 unknown）。Windows 命令名大小写不敏感，
  // `Diskpart` / `PARTED` 是日常写法。实测（45 关键字 × 3 命令 × {小写,首字母大写} = 270 条）：
  // 小写 0/135 allow、**大写 129/135 allow**，而 `time diskpart` 是 ask。
  try {
    const un = unwrapWords(w)
    if (un && Array.isArray(un.words) && un.words.length) skip[String(un.words[0]).toLowerCase()] = 1
  } catch (e) {}
  if (w.length) skip[String(w[0]).toLowerCase()] = 1
  // 命令域判据要的是**命令头位置上的命令名**（剥 wrapper 与提权前缀）—— 见 headCommandNameOf。
  // 复用已算出的 headEnd，避免在判定热路径上把同一趟扫描做两遍。
  //
  // ── ⚠️ 但 `headEnd` **不等于**「命令头结束位置」：普通选项词元上必须改用 `headFull` ────
  // `commandHeadEnd` 的 ① 分支经 `skipPrefixArgs` 把 `-l` 这类**普通选项**吃掉并**停在其上**
  // ⇒ `w[headEnd - 1]` 是 `-l` 而不是命令名 ⇒ 本行把 `'-l'` 当 `cmdName` 传给
  // `isCmdStyleSwitch`。而 `GROUP_OF_LABEL['-l']` 查不到 → 走「认不出命令名 ⇒ **不消费半径**」
  // 兜底 ⇒ **目标实参被当成 cmd 风格开关跳过**（`/data` 命中 `/^[/-]/` 那条）⇒ 循环里
  // `i < headFull` 之外再无「非选项实参」⇒ 本函数由 false 变 **true** ⇒ 该段由半径档
  // `outside` 被替换成 `unknown`。
  //
  // ⚠️ 触发条件**比「22 个普通选项 × 任意操作数」窄得多**，唯一成因是
  // 「`su`/`runas` 的**操作数** basename 恰好命中 `STATEMENT_KEYWORDS`」：
  // `su` 的操作数由 `privOperandSkip` 的 `isPrivOperandWord` 判，而该判据对
  // 「basename 在关键字表里」的词元返回 false（不跨）⇒ 段首 `su` 走 ② 只推 1 个词元，
  // 下一轮 `C:/data` 的 basename `data` **命中 ① 关键字支** ⇒ 命令头越过操作数、
  // 把 `parted` 当命令名吃掉，`headFull = 4`（段长 5）—— 而 `headEnd` 仍停在 2 的 `-l`。
  // 实测 8,220 格扫描：分叉 4,816 格、涉及 86 个操作数，**「分叉但 basename 不命中
  // 关键字表」= 0**。同值（不触发）：`C:/etc`、`/etc`、`C:/tmp`、`/tmp`、`C:/Windows`、
  // `C:/users`、`root`、`x`、`A=/etc`、`A=/bin/rm`、`of=/dev/sda`、`A=C:/Windows`、
  // `A=../other` —— 全部逐字同值。**但 `C:/data` / `/data` 是现实中极常见的路径**（数据盘），
  // 且 45 个关键字里 `data`/`do`/`in`/`for`/`end`/`if`/`then`/`else`/`case`/`class`/`return`/
  // `exit`/`while`/`not`/`and`/`or`/`try`/`catch`/`finally`/`begin`/`process`/`switch`/
  // `function`/`until`/`foreach` 一大批「像目录名/用户名」⇒ 严重度仍是 **high**。
  //
  // 实测（win32、`outside=deny` 单档）：PRE `deny` → CUR `ask`（放宽）；加
  // `unknown=allow`+`priv=allow` 则由 `deny` 退化成 **allow**。同口径对拍
  // `su <操作数> <命令> <目标>`（**不带选项**）：PRE/CUR 都是 `deny` ⇒ 纯属新增分叉。
  //
  // ── 判据：`w[headEnd - 1]` 是**普通选项**时，命令名改从 `headFull` 取 ──────────────
  // **判据已抽成单点** `headCmdNameForSegment`（守卫三项、取大式、惰性说明都在那里）——
  // 本处只传已算好的 `headFull`；`blastRadiusOfSegment` 是同一函数的另一个消费点。
  // 该族历史上两次漂移都出在「同一判据两份副本、只改了一处」，故此处**不再内联**。
  const cmdName = headCmdNameForSegment(w, headEnd, headFull)
  // ── 命令名本身**必须**进 skip，否则语句关键字前缀会让整个判据 fail-open ────────────
  // 上面两个 `skip[...] = 1` 只登记 `w[0]` 与 `unwrapWords` 的首词元，而两者都**不跳语句
  // 关键字**：`['time','diskpart']` 登记的是 `time`（两次），真正的命令名 `diskpart`
  // 落进下面的循环被当成**非选项实参** → 本函数返回 false → 该段不归 `unknown`
  // → 落半径档的 `inside` → 大分类 allow 时**静默放行**。而 `diskpart` 裸跑实测是
  // `unknown`（ask）—— 加一个语句关键字就把 §5.6① 整类关掉，方向是**放宽**。
  // 实测（真实档位表、mode=allow）：42 个 STATEMENT_KEYWORDS × {diskpart,parted,dd}
  // = 129/129 全部 allow；`if true; then diskpart; fi`、`while true; do diskpart; done`
  // 整行同样 allow，而 HEAD 下 `time diskpart` 与 `diskpart` 都是 ask。
  //
  // `cmdName` 正是为此存在的：`headCommandNameOf` **会**跳语句关键字与整条前缀链
  // （见其注释），故它给出的就是命令头位置上的命令名。此前它只被传给
  // `isCmdStyleSwitch`（命令域判据），没有用来跳过命令名本身 —— 这一处补上。
  //
  // 为什么不能靠「与 `blastRadiusOfSegment` 同源」来省掉这一步：那里 `time diskpart`
  // 的段级 blast 为 null 是**预筛**（`mayNeedBlastCheck` 对纯词元直接 continue）的功劳，
  // 与「按命令名跳过」不是同一个判据，两者不同源。
  //
  // 误判面：只有「操作数恰好与命令名同名」（`diskpart diskpart`）会被多跳一个词元
  // → 返回 true → 归 `unknown`。方向是**收紧**（多问一次），可接受。
  if (cmdName) skip[cmdName] = 1
  for (let i = 0; i < w.length; i += 1) {
    // 命令头（含语句关键字之后的整条前缀链 + 命令名）按**位置**跳过 —— 见 headFull 的注释。
    // 只按词元值跳过是不够的：`time env diskpart` 里的 `env` 不在 skip 表里，
    // 而它既不是选项也不是赋值，会被当成**非选项实参**（发现 1 的根因）。
    if (i < headEnd || i < headFull) continue
    const token = String(w[i])
    // 双侧查表：写入侧已统一小写，这里再对原始词元做一次小写归一，
    // 故 `Diskpart` / `PARTED` 与 `diskpart` 同结论（Windows 命令名大小写不敏感）。
    if (skip[token] || skip[token.toLowerCase()]) continue
    if (token.charCodeAt(0) === 45) continue
    if (isCmdStyleSwitch(token, opts, cmdName)) continue
    if (/^[<>]/.test(token)) continue
    // ── `NAME=value` 在**命令名之后**是普通实参，不是赋值前缀 ────────────────────
    // 与 `blastRadiusOfSegment` 的循环同判据（那里有对应注释）：删除类命令恰恰用
    // 这种形态表达目标 —— `dd of=/dev/sda` 的 `of=/dev/sda` **就是**操作数。
    // 把它当赋值前缀跳过会让 `dd of=/dev/sda` 判成「没有实参」→ 归 `unknown`，
    // 而它的目标明明判得出来（实测 system|/dev/sda）—— 那是**把已知的更严重结论
    // 换成更模糊的结论**，方向错了（与「parted 有实参时不归 unknown」同一条理由）。
    //
    // 「命令名之前」已由上面的 `i < headEnd` 满足：前导赋值前缀都在命令头范围内。
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
      if (token.slice(token.indexOf('=') + 1)) return false
      continue
    }
    return false
  }
  return true
}

/**
 * 该段是否属于「裸跑交互 / 参数非路径」那一类 —— 归 `unknown` 档的补充判据（§5.6）。
 *
 * 三种形态，各按各的判据：
 *   · `BARE_INTERACTIVE`（diskpart / parted / dd）—— **形态**判据：无非选项实参时归 unknown。
 *     有实参则走半径档（`parted /dev/sda` 正确判 system，不被降级成「无法判定」）。
 *   · `DISKPART_SCRIPT_FLAGS` —— `diskpart /s <脚本>`：有实参，但那个实参是**脚本文件**
 *     而非操作目标，半径判据判不出脚本内容的影响。**label + flag** 判据。
 *   · `NON_PATH_ARG`（set-executionpolicy）—— **label** 判据，不看实参形态
 *     （它四种形态 blast 全 null，因为没有路径参数可判）。
 *
 * **刻意不导出**：唯一的消费方是同文件的 `tierSetOf`（与 `hasNoOperand` 同处置）——
 * 少一个公开面就少一份漂移，导出它只会让「档位判据有几处」这个问题多一个答案。
 *
 * @param {string[]} labels segmentLabels(words) 的结果
 * @param {string[]} words 段词元
 */
function isUnknownTierSegment(labels, words, opts) {
  const list = Array.isArray(labels) ? labels : []
  const w = Array.isArray(words) ? words : []
  // ── 惰性记忆化：下面两件事都**只依赖 (w, opts)**，与 label 完全无关 ──────────────
  // 它们此前写在 label 循环**内部**，于是每个 label 各算一次；而 `segmentLabels` 对
  // 每个 `find -exec <cmd>` 都 push 一个 label 且**不去重**（去重只在 seg.opaque 分支做），
  // 故 `labels.length` 随 `-exec` 个数线性增长 —— 两趟 O(词元数) 的扫描 × O(labels)
  // = **O(n²)**。触发形态是常规写法，不是构造输入：
  //     find . (-exec diskpart {} +) × N
  // 实测（`tierSetOf` 单次调用，posix 钩子）：diskpart N=1000 → 49 ms、2000 → 179、
  // 4000 → 698、8000 → **3577 ms**（每翻倍 ×4.0，标准平方）；`-exec dd` × 8000 → 864 ms。
  // 对照 `-exec rm {} +`（`rm` 不在 BARE_INTERACTIVE）N=8000 仅 **4 ms**（线性）——
  // 确认平方因子就是「每个 BARE label 一次 hasNoOperand」。
  //
  // **提到循环外与「命令头结束下标」完全兼容**：`commandHeadEnd` / `commandHeadEndFull`
  // 同样只吃 (w)，故修复 1 的前缀链登记不需要（也不能）在 label 循环内做 —— 若做在循环内，
  // 就与「提到循环外」直接冲突。两处判据各自内部记忆化，循环内只剩查表。
  let noOperandMemo = null
  const bareHasNoOperand = () => {
    if (noOperandMemo === null) {
      try { noOperandMemo = hasNoOperand(w, opts) } catch (e) { noOperandMemo = false }
    }
    return noOperandMemo
  }
  let scriptFlagMemo = null
  const hasScriptFlag = () => {
    if (scriptFlagMemo === null) {
      scriptFlagMemo = false
      // diskpart /s <脚本>：实参里有 /s。
      // **查表前先小写**：Windows cmd 的开关**大小写不敏感**，而本表只登记了小写形态，
      // 于是同一个「执行分区脚本」的操作只因开关大小写不同就绕过 §5.6① 的闸门。
      // 实测（默认配置）：
      //     diskpart /s script.txt → unknown（ask）
      //     diskpart /S script.txt → inside（**allow**）← 闸门被绕过
      //     diskpart -S script.txt → 同上
      // 口径与同文件的 isCmdStyleSwitch 一致（那里用 `/[a-z]/i` 判开关）。
      for (let i = 1; i < w.length; i += 1) {
        if (DISKPART_SCRIPT_FLAGS[String(w[i]).toLowerCase()]) { scriptFlagMemo = true; break }
      }
    }
    return scriptFlagMemo
  }
  for (const l of list) {
    const n = String(l == null ? '' : l).trim().toLowerCase()
    if (!n) continue
    if (NON_PATH_ARG[n]) return true
    if (BARE_INTERACTIVE[n] && bareHasNoOperand()) return true
    // diskpart /s <脚本>：label 是 diskpart（或路径形态归一后同名），实参里有 /s
    if (n === 'diskpart' && hasScriptFlag()) return true
  }
  return false
}

/**
 * 档位 → 双语短标签（弹窗用）。与 `codeLabel` **并列，语义不同**：
 *   `codeLabel` 回答「为什么被标出来」（破坏性命令 / 无法解析 / 重定向到工作区外）；
 *   `tierLabel` 回答「**哪一档在管它**」（大范围 / 提权 / 结束进程…）。
 *
 * 为什么必须分开（而不是扩 `codeLabel`）——三个冲突：
 *   ① **基数不同构**：`code` 是单值，档位是集合（`sudo rm -rf /etc` 同时命中 wide + priv），
 *      填哪个都会漏掉另一个。
 *   ② **`code` 还承担非档位语义**：`destructive` 是**类别**、`unparsable` 是**解析状态**、
 *      `write-outside` 是**另一维度**。混进档位后消费方必须写成
 *      「若 code 是 unparsable → 按解析状态处理；否则若 code 是 write-outside → 按另一维度处理；
 *        剩下的才当档位」—— 那个 if 链本身就是「字段混了两种东西」的信号。
 *   ③ **改动面**：`test/shell-parse.mjs` 有 37 处 `.code` 断言，它们把 `code` 当作判定结果的
 *      **稳定标识**在做回归。改语义不是改数字，是逐条判断每条断言原本在守什么。
 *
 * 判据用「未来新增一档」衡量维护成本：扩 `code` 要逐条检查所有消费方（37 处断言 + 2 处调用点
 * + 决策日志），独立 `tiers` 只需加一个档位名 + 一句文案。**扩 `code` 的成本随档位数增长，
 * 独立字段不增长** —— 这是选后者的理由。
 */
export function tierLabel(tier) {
  if (tier === 'wide') return bi('大范围', 'Wide')
  if (tier === 'outside') return bi('工作区外', 'Outside')
  if (tier === 'unknown') return bi('无法判定', 'Unknown')
  if (tier === 'proc') return bi('结束进程', 'Kill process')
  if (tier === 'power') return bi('关机/重启', 'Power')
  if (tier === 'priv') return bi('提权', 'Privilege')
  if (tier === 'reg') return bi('注册表', 'Registry')
  // `inside` 返回 null —— 它不该出现在弹窗上：它是唯一跟随大分类的档，
  // 区内无害操作被问了才需要标注，而那种情况本来就不该弹窗。
  return null
}

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

/**
 * 「**可能**是工作区根」的形态判据（`blastRadiusOfSegment` 问 `isWorkspaceRoot` 钩子前的预筛）。
 *
 * 与 `mayNeedBlastCheck` 同性质：纯性能优化，**不得改变结论**，故宁可放行（多问一次钩子）
 * 也不漏判 —— 但放行的形态必须真的**可能**归一到根。判据（逐条都有实测依据）：
 *   · 绝对形态（前导分隔符 / 盘符）—— 可能恰好就是根（§5.5 覆盖表里的绝对路径写法）；
 *   · 末段是点段（`.` / `..`）—— `pathResolve` 会把点段消掉，可能一路抵消回根
 *     （`a/..` 归一后**就是**根，而它此前只在「末段是点段」这条上被放行）；
 *   · 整串只由分隔符与点段组成（`.` / `./` / `.\` / `./.`）—— 归约结果就是 `.`；
 *   · **每一段都是点段/空段或整段纯星号，且至少有一段是纯星号**（`*` / `./*` / `.\*` /
 *     两段纯星号）—— 只有这种形态的展开结果才覆盖到「根下的全部条目」。
 *
 * ── 为什么不能再放行「任意含通配符的词元」（原判据的 `|| /[*?]/.test(token)`）────────
 * `globRootOf` 把 `*.log` / `build*` / `?` / `a?.txt` **一律**归约成 `.`（第一个含通配的
 * 段之前什么都不剩），于是宿主 `isWorkspaceRoot('.')` 恒真 —— 判成 `workspace-root` →
 * `radiusTierOf` 映射到 `wide` 档。实测：`rm -rf *.log` / `rm -rf build*` / `rm -rf ?` /
 * `rm -rf ./*.log` / `del /f /s /q *.tmp` 全部 `action=ask`、`tiers=["wide"]`、
 * `blast={level:'workspace-root',path:'.'}`，而 `rm -rf ./build`、`rm -rf node_modules`
 * 仍是 allow/inside。把 `wide` 设为 deny 的用户，`rm -rf *.log` 会被**直接拒绝**。
 * 这与 §5.5 的覆盖表（命中仅 `.` / `./` / `*` / `./*` / `.\*` 与绝对根；`./build`、`build`、
 * `src/tmp` 明确不命中）以及 client.js 文案 `app.blast.workspaceRoot`（「目标是本项目根目录
 * —— 整个项目的文件都会被删除」）都矛盾 —— `rm -rf *.log` 删不掉整个项目，那条文案对它
 * 就是假话，而假警告会让真警告被忽略。
 *
 * 判据的关键是**看段本身是否纯通配**，而不是「词元里含不含通配符」：带锚点的通配
 * （`*.log`、`build*`、`a?.txt`）归约结果同样是 `.`，但展开结果只覆盖部分条目。
 * 顺带收益：`./x` 一族（`./build`、`./b/f1`…）不再白问一次钩子 —— 宿主那份
 * `isWorkspaceRoot` 要做 norm + pathResolve + 两次 toLowerCase，而归一后它们必然带一个
 * 非空普通段、钩子恒 false。
 *
 * @param {string} token 待判词元
 */
function mayBeWorkspaceRootShape(token) {
  const t = String(token == null ? '' : token)
  if (!t) return false
  // 绝对形态：可能恰好就是根（`<root>`、`/`、`C:\`、`X:/*`）
  if (/^[/\\]/.test(t) || /^[A-Za-z]:/.test(t)) return true
  const segs = t.split(/[\\/]/)
  // ── ① 末段是点段（`a/..`、`x/./..`）→ pathResolve 消掉后可能一路抵消回根 ─────────────
  // **必须先跳过尾随空段再取末段**：`globRootOf` 不剥尾随分隔符，故
  // `'a/../'.split(/[\\/]/)` = `['a','..','']` —— 末段是**空串**。此前只认「末段**恰好等于**」，
  // 于是 `a/../` / `a/..//` 被判 allDots=false、无纯星号段 → 预筛返 false → **钩子根本不被调用**
  // → 段级 blast 落 inside。而 `blastRadiusOf('a/../')` 归一后是 `{level:'inside', path:'a/..'}`，
  // 宿主 `isWorkspaceRoot('a/..')` 本会判真 —— 即**整个工作区**：实测 mode=allow 下
  // `rm -rf a/../` 静默放行，而 `resolve('a/../')` 就是工作区根（后果与 `rm -rf .` 同）。
  // 只跳过**尾随**空段（不是忽略全部空段），故普通尾斜杠路径（`build/`、`./b/f0/`）的末个
  // 非空段仍是普通段 → 不放行，不会白问钩子。
  let end = segs.length - 1
  while (end >= 0 && segs[end] === '') end -= 1
  if (end >= 0 && (segs[end] === '.' || segs[end] === '..')) return true
  // ── ② `..` 弹栈归约：归约后**为空或全是纯星号段**才放行 ───────────────────────────
  // ① 只认「末个非空段是点段」，救不到末段是通配的形态：`a/../*` 的末段是 `*` 而非空串
  // 也非点段，但它归约后就是 `*`（= 根下全部条目），与 `rm -rf *` 同义，必须放行。
  // 判据必须**带 `..` 弹栈**，不能只看「各段自身是不是点段/纯星号」：`a/../*` 里的 `a`
  // 既非点段也非纯星号，只有被 `..` 弹掉之后才看得出栈上只剩 `*`。
  // 带**锚点**的通配（`*.log`、`build*`、`a?.txt`）会留在栈上 → 不满足「全是纯星号段」→
  // 不放行，故本趟不会重蹈「含通配就放行」的误判（`*.log/../*` 是例外：`*.log` 被 `..`
  // 弹掉后栈上确实只剩 `*`，那本来就是根下全部条目）。
  const stack = []
  for (const s of segs) {
    if (s === '' || s === '.') continue
    if (s === '..') {
      // 只在栈顶是普通段时弹；栈顶已是 `..` 时再压一个（`../../` 指向根之外，不是根）
      if (stack.length && stack[stack.length - 1] !== '..') stack.pop()
      else stack.push('..')
      continue
    }
    stack.push(s)
  }
  if (stack.length === 0) return true
  // ── ③ `..` 抵消后**回到根**的一族（`../<rootName>`、`sub/../../<rootName>`）──────────
  // ①② 都救不到这一族：末个非空段是**普通段**（`<rootName>`，不是点段也不是纯星号），
  // 而 `..` 弹栈归约后栈上仍留着那个普通段（`['dsh-permgate']`）—— 于是本函数返 false
  // → **钩子根本不被调用** → 段级 blast 落 inside。
  //
  // 而它**恰恰就是工作区根**：`root = <root>` 时，`../<basename>` 归约后
  // 正是 `<root>` 本身。宿主那两条钩子对同一路径给出的正是那个「既不算外、
  // 也不算根」的组合 —— `isOutside` 判 `a === r` 返 **false**（等于根 → 不算「外」），
  // 于是它落进 inside 静默档，而不是 outside。这是 §5.5 注释里点名要防的那一类分叉。
  //
  // 实测（root = `<root>`、八档 inside=allow 其余 ask、真实宿主钩子口径）：
  //     rm -rf .                → ask  tiers=['wide']            blast=workspace-root  hookCalls=1
  //     rm -rf ../other         → ask  tiers=['outside']         blast=outside         hookCalls=0
  //     rm -rf ../dsh-permgate  → **allow** tiers=['inside']     blast=null            hookCalls=0  ← 缺陷
  // 同族（`./../<root>`、`sub/../../<root>`、`..//<root>`、`../<root>/`）**全部** allow。
  // 后果：mode=allow 下在子目录/兄弟目录里回删项目（`rm -rf ../dsh-permgate` 是自然写法）
  // **静默删除整个项目** —— 弹窗 0 次、日志无记录，而 `rm -rf .` 会 ask。
  //
  // ── 为什么判据必须带 `!/[*?]/` ─────────────────────────────────────────────────
  // 单纯的「含 `..` 段即放行」会**打破既有测试 34c**：`*.log/../../*`、`build*/../../*`、
  // `?/../../*` 归约后栈上只剩 `*`，会被 `allStarStack` 那一支（本行之上）判成 workspace-root
  // —— 而它们是**越出根之外**（`../..` 指向根的上两级），实测 34c 的三条会全部变红。
  // 根因是 `globRootOf` 在**首个通配段**截断（`design-issues.md` B1 的设计张力），
  // 故含通配的子族不在此处放行，交由既有判据处理（34c 保持绿）。
  //
  // 判据用「`segs` 里有没有 `..` 段」而不是「`t` 里含 `..` 子串」：`a..b` 这种**普通名字**
  // 不含 `..` 段，不该被放行（那是白问一次钩子的纯开销）。
  // 过度收紧扫描实测**零变化**：`./build`、`build`、`src/tmp`、`../other`、`..`、`../../other`、
  // `*.log`、`build*`、`a/../b`、`x/../y/z`、`./a/./b`、`a/b/c` 全部与改前逐字同值。
  if (segs.indexOf('..') !== -1 && !/[*?]/.test(t)) return true
  // ── ④ `..` 弹栈后**末段是纯星号**、且末段之前无通配的一族（`../<rootName>/*`）────────
  // ③ 那条 `!/[*?]/` 守卫是为保 34c（`*.log/../../*` 归约后栈上只剩 `*`）而设，而它把
  // **同族的通配形态**也一并挡在门外：`../<rootName>/*` 归约后栈是 `['..','<rootName>','*']`，
  // 其展开结果**就是**根下的全部条目 —— 与 `rm -rf *` 同义。
  //
  // 实测（root = `X:/ws`、八档 inside=allow 其余 ask、win32、真实宿主钩子口径）：
  //     rm -rf ../ws          → ask  tiers=['wide']    blast=workspace-root  hookCalls=1
  //     rm -rf ../ws/*        → **allow** tiers=['inside'] blast=null       hookCalls=**0**  ← 缺陷
  // 同族（`./../ws/*`、`sub/../../ws/*`、`..//ws/*`、`../ws/*//`、`rmdir /s /q ../ws/*`、
  // `Remove-Item -Recurse -Force ../ws/*`）**全部** allow —— 即「在子目录里用 `../<项目名>/*`
  // 回删整个项目」静默删除，而只少一个 `*` 的 `rm -rf ../ws` 会 ask。
  // 第二后果：`blastRadiusOfCommandPattern('rmdir /s /q ../ws/*')` 也是 null（对照
  // `rm -rf *` = broad、`rm -rf a/../*` = workspace-root），即**例外标注**（面板事后发现
  // 「我放行了删项目根」的唯一入口）对该族零标注。
  //
  // 判据的两半**都不可省**（各自有实测依据）：
  //   · **栈顶是纯星号段** —— 与 ③ 的 `allStarStack` 同口径、同一条 `/^\*+$/`；带锚点的
  //     通配（`*.log`、`build*`、`a?.txt`）不满足，故 `rm -rf ../ws/*.log` 仍不判根。
  //   · **末段之前无通配段** —— 少了它，`*.log/../../*` 一族（34c）会被误判成
  //     workspace-root：`*.log` 被两个 `..` 弹掉后栈上同样只剩 `*`（实测按原报告者字面
  //     建议构造的版本让 34c 三条**全部变红**）。34c 是「归约越出根之外」，与「回到根」相反。
  // 末段取**末个非空段**（`end`，上面已算出）：`../ws/*//` 的末个非空段是 `*` 而非空串。
  //
  // 扫描用 `indexOf` 而不是正则：与 ③ 的 `!/[*?]/.test(t)` 同判据（只判「含不含」，
  // 不判位置），且本函数在**逐词元**的判档热路径上，保持「查表 + indexOf」形态。
  if (segs.indexOf('..') !== -1 && end >= 0 && stack.length
    && /^\*+$/.test(stack[stack.length - 1])) {
    let starOnly = true
    for (let k = 0; k < end; k += 1) {
      const s = segs[k]
      if (s.indexOf('*') !== -1 || s.indexOf('?') !== -1) { starOnly = false; break }
    }
    if (starOnly) return true
  }
  let allStarStack = true
  for (const s of stack) {
    if (!/^\*+$/.test(s)) { allStarStack = false; break }
  }
  if (allStarStack) return true
  let sawStar = false
  let allDots = true
  for (const s of segs) {
    if (s === '' || s === '.' || s === '..') continue
    allDots = false
    // 带锚点的通配（`*.log`、`build*`、`a?.txt`、`?`）不是纯通配 → 展开结果到不了根
    if (!/^\*+$/.test(s)) return false
    sawStar = true
  }
  return allDots || sawStar
}

/** 该词元是否必须先走完整判档（预筛为「可能危险/可能非 inside」时返回 true）。 */
function mayNeedBlastCheck(token, platform) {
  if (MAY_ESCAPE_RE.test(token)) return true
  // ── cmd 风格变量（`%TEMP%` / `%USERPROFILE%` / `%SystemRoot%`）────────────────
  // 它既不含 `$`、也不含反引号，故 MAY_ESCAPE_RE 不命中；而它的**形态是纯词元**
  // （字母 + 两个 `%`），于是预筛把它当「工作区内的相对路径」跳过 —— 判档静默。
  // 实测（修复前）`blastRadiusOf('%USERPROFILE%')` = `{level:'inside'}`，
  // 且 win32 分支只查 isSystemDir，两条路都不放行 → 段级 blast 为 null、tier 为 inside
  // → 默认配置下 **allow**。而 `%USERPROFILE%` 展开后正是用户家目录（对应 home 档），
  // 即「删自己的用户配置目录」被判成「工作区内删个文件」。`del %USERPROFILE%` 改前是 ask。
  // 判据与 blastRadiusOf 的短路同源（同一个 CMD_VARIABLE 正则），故不会两处漂移。
  if (CMD_VARIABLE_RE.test(token)) return true
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
 * 该词元在 `blastRadiusOfSegment` 的判档循环里**会不会产出半径档**（预筛 + 两条
 * 「预筛之前」的产档路径合并成一条**上界**判据）。
 *
 * ── 为什么不能只问 `mayNeedBlastCheck` ─────────────────────────────────────────
 * `mayNeedBlastCheck` 是 `:4996` 那条廉价预筛的判据，而那条预筛在循环里**不是第一条
 * 产档路径** —— 它前面还有两条同样会产出半径档、且对「纯词元」形态照样成立的分支：
 *   · 含空格词元的**引号命令行递归支**（`:4922-4963`）：`token.indexOf(' ') !== -1` 且
 *     切分后首词是破坏性命令名或解释器（`NESTED_SHELLS`）时递归判档；
 *   · **`NAME=value` 支**（`:4975-4986`）：取 `=` **右侧值**再判档。
 * 两者都 `continue`，**都在预筛之前**，故「`mayNeedBlastCheck` 返假」**推不出**
 * 「该词元不产半径档」。把它当必要条件用会得到**真实放宽**（实测见 `privValueFlagBetween`）。
 *
 * ── 判据：三条路径的**上界**（返真 ⇒ 更保守 ⇒ 只会收紧）──────────────────────────
 *   · 含空格的词元 —— 一律视为「会判档」。引号支的精确判据需要 `split(/\s+/)` + 逐词
 *     `commandNameOf`/`isDestructiveLabel`/`NESTED_SHELLS` 查表，而本函数的调用点是
 *     **逐词元**的贪婪扫描（`isPrivOperandWord`）与守卫（每次调用至多一次），
 *     O(1) 纪律不允许分配；且**收窄方向是放宽**（少认一次 ⇒ 多跨一次），
 *     而多认的代价只是畸形写法多问一次（收紧方向，永不违反策略）。
 *     注意 `indexOf(' ')` 是既有形态（`:4922` 同一判据），不新造正则。
 *   · `NAME=value` —— 取 `=` 右侧值再问同一个预筛（与 `:4976` 的 `token.slice(indexOf('=') + 1)`
 *     同源）。空值（`FOO=`）不是目标，与 `:4978` 的 `if (!rhs) continue` 同处置。
 *   · 其余 —— 原样交给 `mayNeedBlastCheck`（纯词元）。
 *
 * @param {string} token 已 `String()` 过的词元
 * @param {'win32'|'posix'|undefined} platform 同 `mayNeedBlastCheck`；`undefined` = 两张表都查
 */
function mayYieldRadiusTier(token, platform) {
  if (token.indexOf(' ') !== -1) return true
  const eq = token.indexOf('=')
  if (eq > 0 && LEAD_ASSIGN.test(token)) {
    const rhs = token.slice(eq + 1)
    return !!rhs && mayNeedBlastCheck(rhs, platform)
  }
  return mayNeedBlastCheck(token, platform)
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
  // ── cmd 风格变量（`%TEMP%` / `%USERPROFILE%` / `%SystemRoot%`）────────────────
  // 与 `$` / 反引号**同处置**：它的值在本模块里读不出（本模块不做求值），故不能拿字面量
  // 去判「工作区内还是外」。不放行的后果实测：`blastRadiusOf('%USERPROFILE%')` 返回
  // `{level:'inside'}` —— 而 `%USERPROFILE%` 展开后是**用户家目录**（home 档），
  // `rm -rf %USERPROFILE%` / `del %USERPROFILE%` 于是落 inside 档、默认配置下静默放行。
  // 这是「不猜」（与 `$TARGET` 同一条契约：返回 null，由段级汇总改判 `unknown`）。
  //
  // 与上面 `$` 分支同一形状：**先给系统目录一次机会**（`%SystemRoot%` 这种形态若整串命中
  // 名单则照旧判 system），再走变量短路 —— 否则名单条目会被短路吃掉。
  // 注意正则与词法器共用同一个 `CMD_VARIABLE`（见 CMD_VARIABLE_RE），不手抄一份。
  //
  // ── 但这条短路**只在 cmd 语义下成立**，必须按平台门控 ─────────────────────────
  // `%` 在 POSIX 上根本不是变量语法（bash 里 `%` 是普通字符），`a%b%c`、`x%y%z.txt`、
  // `foo%bar%baz` 就是普通文件名。而 `CMD_VARIABLE_RE` 是**非 sticky 的 `.test()`**：
  // 只要串里**任意位置**有两个 `%` 夹一个字母就命中，与「整串是不是一个变量」无关 ——
  // 于是 posix 下这一族文件名全被判成「读不出」→ 段级 blast 由 inside 改判 unknown
  // （实测 `rm -rf a%b%c` 由 allow 变 ask）。方向虽是收紧，但这是「把合法路径误判为
  // 读不出」的可用性回归，根因是 `o.platform` 就在手边却没参与判据。
  //
  // 门控口径与 mayNeedBlastCheck / isCmdStyleSwitch 一致：**只有明确 posix 才关掉**
  // 这条 Windows 专有判据；平台未知时保留它 —— 与 isSystemDir「未知时两张表都查」
  // 同向（fail-safe）：宁可多问一次，不可把 `%USERPROFILE%` 放回 inside 档。
  if (o.platform !== 'posix' && CMD_VARIABLE_RE.test(t) && !isSystemDir(dollarFree, o.platform)) return null
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
  //    注意判据是「归一后只剩盘符或为空」——`B:/proj` 不是盘根，但 `B:` 是。
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
  // 命令域判据要的是**命令头位置上的命令名**（剥 wrapper 与提权前缀）—— 见 headCommandNameOf。
  // 复用上面已算出的 headEnd，避免在判定热路径上把同一趟 O(n) 扫描做两遍。
  //
  // ── ⚠️ 但 `headEnd` **不等于**「命令头结束位置」：普通选项词元上必须改用 `headFull` ────
  // 判据已抽成**单点** `headCmdNameForSegment`（本处与 `hasNoOperand` 共用同一个函数，
  // 那里详述了根因）；此处补的是同一处
  // 漂移的**第二个消费点**：`commandHeadEnd` 的 ① 分支经 `skipPrefixArgs` 把 `-l` 这类
  // 普通选项吃掉并**停在其上** ⇒ `w[headEnd - 1]` 是 `-l` 而不是命令名 ⇒ 本行把 `'-l'`
  // 传给 `isCmdStyleSwitch` ⇒ `GROUP_OF_LABEL['-l']` 查不到 ⇒ 走 ④ 的「认不出命令名
  // ⇒ 不消费半径」兜底 ⇒ **目标实参被当成 cmd 风格开关跳过**（`/data` 命中
  // `isCmdStyleSwitch:4413` 那条 `/` + 字母；`C:/data` 那种带第二段的词元则由 `:4422`
  // 那条拦下、本就到不了这里）⇒ 循环里再无「有警告意义」的目标 ⇒ 段级 blast 归 **null**
  // ⇒ `radiusTierOf(null)` = `inside`。
  //
  // ⚠️ 后果是**同一段两处给出不同答案**：`su -l data rm -rf /data` 在 `hasNoOperand` 侧
  // 拿到的命令名是 `rm`（`/data` 是目标 ⇒ 判 `outside`），在本函数拿到的是 `-l`
  // （`/data` 是开关 ⇒ 判 `null`）。端到端（§3.3 明文设想的 `inside=allow +
  // outside=deny + priv=allow`）：
  //     su -l data rm -rf /data   → **allow**、blast=null、弹窗 0 次
  //     su    data rm -rf /data   → **deny**（同义、只是没写那个普通选项）
  // 即用户显式写的 `outside=deny` 被一个普通选项绕过（fail-open）。
  // 实测（本文件 54584 格语料、7 配置）：tiers 差异 3084 格、blast 由 `null` 恢复为
  // `outside|…`、**有值→null = 0**；`outside=deny` 系列各 3084 格**全部由放宽转收紧**、
  // 放宽 = 0；默认配置（两侧都 ask）**0 差异**。
  //
  // 触发条件（三重合取、缺一不可）：`su`/`runas` 的**普通选项** × **操作数 basename 命中
  // `STATEMENT_KEYWORDS`** × **单段 POSIX 目标**。第一条成因与 `hasNoOperand` 的实测段
  // 一致（`su` 的操作数由 `privOperandSkip`/`isPrivOperandWord` 判，对「basename 在关键字
  // 表里」的词元返回 false ⇒ 命令头越过操作数、`headFull` 推进到 4，而 `headEnd` 仍停在 2）。
  //
  // 判据的守卫三项（含「非值选项」那一项）与取大式见 `headCmdNameForSegment` 单点，
  // 此处**不复述** —— 复述就是第二份描述，正是本族漂移的形态。
  //
  // ⚠️ **判据已抽成单点**：`headCmdNameForSegment`（守卫三项、取大式、**惰性**说明都在
  // 那里）。本处是第二个消费点，**不传**第三参 ⇒ 惰性求值路径保住：`commandHeadEndFull`
  // 是 O(n) 推进循环，只在守卫命中时才调（无条件先算实测多花 0.31 µs/段；160000 段：
  // 342.0ms → 429.7ms，惰性版 379.9ms），而两者在 24768 格上**逐格同值**。
  // 该族历史上两次漂移都出在「同一判据两份副本、只改了一处」，故此处**不再内联**。
  const cmdName = headCmdNameForSegment(w, headEnd)
  let worst = null
  // ── 三种 `null` 必须分开（§4）──────────────────────────────────────────────────
  // `blastRadiusOf` 对读不出的目标返回 `null` 是「不猜」（合理），但本函数汇总时
  // `if (!r) continue` 把三种语义**折成了一个 null**：
  //     rm -rf ./build     段级 null  ← 判过档，确认 inside —— **安全**
  //     rm -rf $TARGET     段级 null  ← 含变量，**读不出** —— **可能任意目标**
  //     diskpart           段级 null  ← 根本没有路径目标 —— 进交互
  // 前两种都落 `inside` 档（大分类 allow 时不弹窗），第三种也是。
  // **不区分就接线 = 制造新漏报**，故这里维护一个标志：非空词元被判为「读不出」时置位，
  // 最终没有任何 worst 时改判 `unknown`（而不是 null）。
  //
  // 预筛与它不冲突：`mayNeedBlastCheck` 跳过的是纯词元，`blastRadiusOf` 对它们恒返回
  // `inside`，走不到置位分支。
  let sawUnjudgeable = false
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
    if (isCmdStyleSwitch(token, opts, cmdName)) continue           // Windows 的 `/s` `/grant`；POSIX 上恒 false
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
            // ── 内层的「读不出」必须**带上来**（发现 1 的同一族残留）────────────────────
            // 内层结论可能是**并列**的两种（见 blastRadiusOfSegment 尾部的说明）：
            //   · `rs.level === 'unknown'`（空 path）—— 内层只有读不出的目标；
            //   · `rs.unjudgeable === true`          —— 内层既有已知目标、又有读不出的。
            // 两者都表示「这条被引号包起来的命令行里有读不出的目标」，故必须置位 ——
            // 否则下面 `worst = rs` 只是把**对象**换掉，内层那个事实随之丢失。
            //
            // 实测（`unknown=deny`、`wide=allow`、`priv=allow`，修复前 → 修复后）：
            //     su -c "rm -rf $T"        deny/['unknown','priv'] → deny（不变）
            //     su -c "rm -rf $T" /      **allow**/['wide','priv'] → **deny**
            //       ← 内层 unknown 被外层更严重的 `/`（drive-root）整个顶替，
            //         于是「加一个读不出的内层目标」反而把结论从 deny 放宽成 allow
            //     su -c "rm -rf $T" C:/Windows → 同上（外层 system 顶替内层 unknown）
            // 置位方向**只会收紧**：新增的 `unknown` 档参与取最严，不改变 `blast` 的显示
            // （`worst` 仍是外层那个更严重的已知档，弹窗文案不变）。
            if (rs.level === 'unknown' || rs.unjudgeable) sawUnjudgeable = true
            if (!worst || ssev < BLAST_ORDER[worst.level]) worst = rs
            continue
          }
        }
        // 递归返回 `null` 时**不置位**：`null` 的两种含义里，「确认在区内」正是最常见的一种
        // （`blastRadiusOfSegment(['rm','./build'])` === null），而真正「读不出」的内层目标
        // （`['rm','-rf','$T']`）返回的是 `{level:'unknown'}` —— 它在上面 `if (rs)` 里已经
        // `continue`，走不到这里。曾经这里无条件置位，把前一种误标成后一种：实测
        // `sudo rm ./build` 是 inside+priv（正确），而 `su -c "rm ./build"` 是
        // unknown+priv —— 两者目标相同，只因引号写法不同就分了叉（方向虽仍是收紧，
        // 但那是**判据错误**：用户把 unknown 设为 deny 时，`su -c "rm ./build"` 会被拒
        // 而 `sudo rm ./build` 放行）。
        // 这里的原意（`else` 挂在与 `if (rs)` 配对的 `if (ssev !== undefined)` 上）本就是
        // 「rs 非空但 level 不认识」—— 那个集合**恒为空**（rs 的 level 只有 BLAST_ORDER
        // 的八个键，非空 blast 必在其中），故该分支不可达，直接删除。
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
      // `NAME=` 空值不是目标（`FOO= rm -rf x` 的 FOO 没有值可言），**不置位** —— 见 §4.2 置位表
      if (!rhs) continue
      if (!mayNeedBlastCheck(rhs, opts && opts.platform)) continue
      const rv = blastRadiusOf(rhs, opts)
      // 右侧值读不出（`dd of=$DEV`）→ 置位：这是**目标**读不出，不是「没有目标」
      if (!rv) { sawUnjudgeable = true; continue }
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
    // 非空词元返回 null = **读不出**（变量 / 命令替换 / 读不懂的形态）→ 置位。
    // 判据是「返回了 null」，而不是「词元里有没有 $」—— 后者是手抄一份 blastRadiusOf
    // 的短路条件，两处必然漂移（该函数的短路条件改过一次：`$Recycle.Bin` 是字面目录名
    // 却被变量短路吃掉）。这里只认它的返回值，判据天然同源。
    if (!r) { sawUnjudgeable = true; continue }
    // ── 工作区根（§5.5）──────────────────────────────────────────────────────────
    // `blastRadiusOf` 把 `rm -rf .` / `rm -rf *` / `rm -rf ./*` 的目标经 globRootOf
    // 归约为 `.`，再由 isOutsideWorkspace 判为 inside → 段级 blast 为 null →
    // 大分类 allow 时**删掉整个项目不弹窗**（一族五种写法实测全落 inside）。
    //
    // 解析器判不了「这是工作区根」——它不知道根在哪，故由宿主注入钩子。判据必须与宿主的
    // isOutside **同口径**（相对路径先拼根、再 pathResolve 归一），否则两者会在边界上打架：
    // 同一路径可能既不算「外」（isOutside 返 false）又不算「根」（钩子返 false），
    // 落进 inside 静默。这与 blastRadiusOf 里「判据必须直接问 isSystemDir，不能手抄一份
    // 平台分派」是同一类纪律。
    //
    // 钩子收的是 **globRootOf 的结果**（`r.path`），不是原始词元 —— 故 `*`、`./*`、
    // `.\*` 与绝对路径写法都能命中，而 `..`、`./build`、`src/tmp` 不会误判。
    //
    // 为什么用独立 level 名而非直接返回 `wide`：`home`/`system`/`drive-root` 都是
    // 「工作区之外」的概念，而 `workspace-root` 在区内。独立 level 让弹窗文案能区分
    // 「删整个项目」与「删盘根」—— 两者后果差一个量级。
    //
    // ── 钩子调用前的**形态预筛**：宿主每问一次都要把同一个目标重新归一一遍 ──────────
    // 落在这一支的目标都已被 `isOutsideWorkspace` 判为「区内」，而宿主那份
    // `isWorkspaceRoot` 要做 norm + pathResolve + 两次 toLowerCase —— 对**每一个**
    // inside 目标各一次，且与 `blastRadiusOf` 里刚问过的 `isOutsideWorkspace`
    // 是两遍独立归一（同一份 norm/pathResolve 各做一次）。
    //
    // 预筛是纯优化，**不得改变结论**，故判据取「该形态**是否可能**归一到工作区根」，
    // 且**宁可放行**（放行的代价只是多问一次钩子，结论由钩子给）。判据在
    // `mayBeWorkspaceRootShape` 里单点维护（四种形态与实测依据都记在那里）。
    //
    // **`|| /[*?]/.test(token)` 那条已删**：它对**任意**含通配符的词元放行，而
    // `globRootOf('*.log')` = `globRootOf('build*')` = `'.'`，宿主 `isWorkspaceRoot('.')`
    // 恒真 —— 于是 `rm -rf *.log` 被判成「删整个项目」（`wide` 档）。§5.5 的覆盖表只列了
    // `*` / `./*` / `.\*` 这类**整段纯通配**，带锚点的通配不在表内。判据改为看**段本身**。
    if (r.level === 'inside' && opts && typeof opts.isWorkspaceRoot === 'function'
      && mayBeWorkspaceRootShape(token)) {
      let isRoot = false
      try { isRoot = !!opts.isWorkspaceRoot(r.path) } catch (e) { isRoot = false }
      // 钩子抛错时**不置位也不改判**：保持既有的 inside 行为（与 isOutsideWorkspace 的
      // try/catch 同处置）。方向仍是 fail-safe —— 钩子是宿主的纯函数，抛错意味着宿主有 bug，
      // 那种情况下静默保持原判比把每条命令都标成「删整个项目」更可诊断。
      if (isRoot) {
        const wr = { level: 'workspace-root', path: r.path }
        const wsev = BLAST_ORDER[wr.level]
        if (!worst || wsev < BLAST_ORDER[worst.level]) worst = wr
        continue
      }
    }
    // 只保留「有警告意义」的档位：inside 不需要警告，但它可以作为兜底（全 inside → null）。
    // 顺序取自模块级的 BLAST_ORDER（唯一一份）—— 曾在函数内手抄一份、index.js 再抄一份，
    // 三份漂移时消费侧是「静默跳过未知档」，只会让警告整体失效而不报错。
    const sev = BLAST_ORDER[r.level]
    if (sev === undefined) continue
    if (!worst || sev < BLAST_ORDER[worst.level]) worst = r
  }
  if (!worst || worst.level === 'inside') {
    // 没有任何「有警告意义」的目标：若途中见过读不出的目标，后果就是**读不出**，
    // 不能报 null（那等于宣称「确认无害」）。空 path 表示没有具体目标可显示。
    return sawUnjudgeable ? { level: 'unknown', path: '' } : null
  }
  // ── 「读不出」与「已知最严重目标」是**并列**结论，不是二选一（发现 1 的修法）─────────
  // 上面那一支只在**没有任何已知目标**时兜底成 `unknown`；一旦同段里还有一个读得出的目标，
  // `unknown` 就被整条丢掉了（`return worst`）。而两者是**并列**的：
  //     `rm -rf /etc $TARGET`  既确定会删 `/etc`（outside），又可能删任意路径（unknown）
  // 这与 §7.2 整行读不懂分支的 `wide ∪ unknown` 同构 —— 那里正是「两个都并入」。
  //
  // 丢掉的后果是 **fail-open**：用户把 `unknown` 设得比胜出的已知档更严时，整条结论被
  // 已知档顶替。实测（`unknown=deny`、`outside=allow`、`wide=allow`）：
  //     rm -rf $TARGET        → deny  tiers=['unknown']         blast=unknown:
  //     rm -rf /etc $TARGET   → **allow** tiers=['outside']      blast=outside:/etc  ← 顺序无关
  //     rm -rf $TARGET /etc   → **allow** tiers=['outside']      blast=outside:/etc
  //     dd of=$DEV of=/dev/sda → **allow** tiers=['outside']     blast=outside:/dev/sda
  // 即「同一条命令里加一个读不出的目标，反而把 deny 放宽成 allow」。
  //
  // 修法：`worst` **保持原样**（`blast` 仍显示已知最严重的那一档，弹窗文案不变），
  // 只把「本段还有读不出的目标」这个事实挂在返回值上，由 `tierSetOf` ① 恒并上 `unknown` 档。
  // 取最严对**新增**档是单调的，故只会收紧，不会放宽任何东西。
  //
  // ⚠️ 标志挂在**返回对象**上（而不是另设一个并列的布尔出口），故递归引号分支
  // （`:4698` 的 `blastRadiusOfSegment(sub, opts)`）天然把它带上来 —— 那里 `rs` 是
  // **整个对象**被赋给 `worst` 的，标志随之传播，不需要额外处理。
  if (sawUnjudgeable) return { level: worst.level, path: worst.path, unjudgeable: true }
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
  //     与事实相反；且 BLAST_ORDER 里 broad 比 system 更严重，会把真实目标整个盖掉。
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
  // 命令域判据要的是**命令头位置上的命令名**（剥 wrapper 与提权前缀）—— 见 headCommandNameOf。
  // 复用上面已算出的 headEnd（它是 **w** 空间的下标，而命令名取值与下标空间无关）。
  const cmdName = headCommandNameOf(w, headEnd)
  const rest = uw.slice(headLen).filter((t) => String(t).charCodeAt(0) !== 45 && !isCmdStyleSwitch(String(t), opts, cmdName))
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
    // 命令域判据要的是**命令头位置上的命令名**（剥 wrapper 与提权前缀）—— 见 headCommandNameOf。
    // 复用已算出的 headEnd（与 span 的上界同源）。
    const cmdName = headCommandNameOf(w, headEnd)
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
      if (!isPathForm && isCmdStyleSwitch(s, opts, cmdName)) continue
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(s)) continue
      const n = String(commandNameOf(s) || '').toLowerCase()
      if (n) last = n
    }
    return isDanger(last)
  })()
  // ── 普通命令：**不标注**（`return null`，不是交回判档）────────────────────────────
  // `headIsDangerous` 为假 ⟹ 该模式放行不了任何删除命令（实测：640 个「前缀 + 普通命令」
  // 候选形态对 1093 条危险命令的命中数**全为 0**）⟹ 它没有「爆炸半径」可言，标 `null`
  // 才是对的 —— 这正是本函数上面那句「普通命令一律得 `null`（不标注）」的字面实现。
  //
  // 这里曾经写成 `return blastRadiusOfSegment(w, opts)`，而那条路会把 §5.5 新加的
  // `isWorkspaceRoot` 钩子接进来：`sudo ls *` / `env ls *` / `nohup ls *` / `git status *`
  // 的 `*` 经 `globRootOf` 归约为 `.`，宿主 `isWorkspaceRoot('.')` 恒真 → 得到
  // `{level:'workspace-root', path:'.'}`（HEAD 下这些形态全是 `null`，面板零标注）。
  // 后果是**面板假警告**：一条**放行不了任何删除命令**的 allow 例外被标成
  // 「目标是本项目根目录 —— 整个项目的文件都会被删除」，对 `sudo ls *` 就是假话。
  // 这正是本文件反复警告的「假警告会让真警告被忽略（狼来了）」。
  //
  // ⚠️ 归因**不是** `isCmdStyleSwitch` 的命令域判据（`cmdName`）：把那段换回 HEAD 写法后
  // `sudo ls *` 仍然得到 workspace-root（实测）。真因就是这条兜底把钩子接了进来。
  //
  // ⚠️ 带**具体**目标的形态（`sudo cat /etc`、`sudo ls /*`）走的是上面
  // `rest.some(非通配)` 那条早退，**不经过本行** —— 它们的标注不受本行影响。
  if (!headIsDangerous) return null
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
 * `destructiveTiers` 恒返回具体动作、`resolveCategory` 对 command 分类也只会返回具体 mode
 * （项目层 inherit 已在读取时穿透到全局）。调用方 commandDecision 里的 inherit 分支因此不可达，
 * 那里有对应注释；此处保留该语义是为了让本模块不依赖宿主的默认值策略。
 *
 * 重定向只标注不设闸（D-8）：`git status > ~/.dsh/AGENTS.md` 命中例外即放行，code 仅用于展示。
 *
 * @param {string} source 命令原文
 * @param {'pwsh'|'bash'} shell
 * @param {{
 *   home?: string,
 *   userHome?: string,
 *   platform?: 'win32'|'posix',
 *   matchException?: (segmentText: string, label: string) => ({action:string, ruleId?:string, reason?:string, note?:string}|null),
 *   destructive?: () => ({inside:string, outside:string, wide:string, unknown:string,
 *                         proc:string, power:string, priv:string, reg:string,
 *                         reasons?: {[tier:string]: string}}|null),
 *   category?: () => ({action:string, reason?:string}|null),
 *   isOutsideWorkspace?: (path: string) => boolean,
 *   isWorkspaceRoot?: (path: string) => boolean,
 * }} hooks 注入判定回调，使本模块保持纯函数、可独立测试
 *
 * `destructive` 的契约从「给我一个动作」改为「给我**档位表**」——**合并逻辑留在解析器**
 * （单一来源）：解析器按 `tierSetOf` 选出适用档位、按 `strictestTierAction` 取最严、
 * 得出动作与 `source`。宿主只回答「每一档用户配的是什么」，不参与「哪一档更严」的判断。
 * 这样档位语义（哪些档、怎么组合、取严规则）只有一份定义，宿主改配置不会与解析器分叉。
 *
 * 兼容旧契约：钩子返回 `{action, reason}`（无档位键）时**展开成八档全等于该 `action`**
 * （旧契约的忠实翻译：一个动作管住全部破坏性命令）；`null` → 空表（所有档未表态）。
 * 于是所有既有调用方与测试钩子照常工作，且语义与旧行为逐格一致。
 *
 * ⚠️ **不得**把它读成「只取 `inside` 一档、其余档未表态」：那会让其余七档落到大分类，
 * 而大分类常态是 allow —— `sudo ls`（priv 档）/ `kill 1234`（proc 档）当场变成
 * 「大分类说了算」，D-6「大分类设为 allow 时破坏性命令仍按子设置走」随之失效（fail-open）。
 * 生产路径上 `index.js` 的 `destructiveTiers` 恒返回八档表，`{action}` 只出现在旧/测试钩子。
 * 归一化只在 `tierTableOf` 做一次，下游（段级与整行分支）只认档位表。
 *
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
  /**
   * 把钩子返回值归一成**档位表**（§7.2 的契约）。
   *
   * 两条兼容路径，都是「让既有调用方不改也能跑」：
   *   · `{action, reason}`（旧契约 / 测试钩子）→ **展开成八档全等于该 action**。
   *     这不是权宜之计，而是旧契约的**忠实翻译**：旧的 `destructive` 子设置就是
   *     「一个动作管住全部破坏性命令」，而新模型里「全部档位同一个动作」正是它的原义。
   *     若只把它当成 `inside` 一档，其余七档会变成「未表态」→ 落到大分类，
   *     而「大分类 allow 时破坏性命令仍按子设置走」（D-6）当场失效。
   *   · `null` → 空表（所有档未表态）。
   * 归一化在这里做一次，下游（段级与整行分支）只认档位表，不再各自判断形状。
   */
  const tierTableOf = () => {
    const ds = h.destructive ? h.destructive() : null
    if (!ds) return null
    if (typeof ds.action !== 'string') return ds
    const t = {}
    const reasons = {}
    for (const tier of TIERS) t[tier] = ds.action
    // 理由同样展开：旧契约的 `reason` 是「整个破坏性类别」的理由，故每一档都能给出它
    if (ds.reason) for (const tier of TIERS) reasons[tier] = ds.reason
    if (ds.reason) t.reason = ds.reason
    if (ds.reason) t.reasons = reasons
    return t
  }
  /**
   * 命中档位 → `{action, reason}`。
   *
   * `reason` 按档取（§7.1 的 per-tier reason）：由 `decisiveTierOf` 找出决定动作的那一档，
   * 再取该档的理由。老配置的 `reason` 字符串由宿主归入 `inside` 档（读取侧兼容），
   * 故这里只需要认 `reasons[tier]`；`ds.reason`（旧契约）作为 `inside` 档的兜底。
   *
   * ── decisive 档**没有**理由时，回落到**并列在同一严格度上**的其余命中档 ──────────────
   * 根因：`tierSetOf` 对「读得出的目标 + 读不出的目标」同段共存会**并列**并入 `unknown`
   * （见那里的 ③），而 `TIER_ORDER` 里 `unknown` 排第 1、`outside` 排第 3 —— 并列时
   * `decisiveTierOf` 取**靠前者**，于是 decisive 档从 `outside` 变成 `unknown`。
   * 而 `unknown` 档常常**没有**用户写下的理由 —— 它可能是显式设成 deny 却没填理由的档，
   * 也可能是命中「读不出的目标」才并进来的档，而用户只为 `outside` 那档写过理由 ——
   * 于是**动作仍是 deny、用户写的那句拒绝理由整句丢失**：
   *     rm -rf /etc          → deny，理由「删工作区外文件」✅
   *     rm -rf /etc $TARGET  → deny，理由 **null** ❌（tiers = ['unknown','outside']）
   * 这不是 fail-open（动作不变），但 AI 收到的拒绝指令是空的，而面板上那句理由仍显示在
   * `outside` 档（`explicitReasonsOf` 的口径）—— 「看得见理由、AI 收不到理由」，
   * 与「面板说谎」同族。
   *
   * 回落**只在同一严格度内**进行（deny 时即「也投了 deny 票」的那些档），故：
   *   · 动作与 `strictestTierAction` 的选择**永远一致**（绝不跨严格度取档 ——
   *     更松的档本来就不是 deny，它们的理由不属于这次裁决）；
   *   · 理由一定来自一个**用户确实为它写过拒绝理由**的档，不会凭空造出理由
   *     （没有任何命中档写过理由时仍然是 `null`）。
   * 次序与 `decisiveTierOf` 同源（同严格度时按 `TIER_ORDER` 靠前者优先）：`tiers` 已按
   * `TIER_RANK` 排过（`decisiveTierOf` 的注释声明该顺序由调用方保证），故 `decisiveTierOf`
   * 选出的那一档正是并列组里 `TIER_RANK` 最小的那个 —— 本回落是它的**严格续延**
   * （先试它、再按同一 `TIER_RANK` 试其余并列档），不是另一套选档规则。
   */
  const tierVerdict = (ds, tiers) => {
    const action = strictestTierAction(ds, tiers)
    if (action === 'deny' && ds) {
      const reasons = ds.reasons
      const reasonOfTier = (t) => {
        const r = (t && reasons && typeof reasons === 'object') ? reasons[t] : null
        if (r) return r
        // 旧契约的裸 `reason` 字符串 → `inside` 档的兜底（见 tierTableOf 与宿主的读取侧）
        return t === 'inside' ? (ds.reason || null) : null
      }
      // 第一顺位：决定动作的那一档（动作就是它定的，理由理应先取它）
      const t = decisiveTierOf(ds, tiers)
      const r = t ? reasonOfTier(t) : null
      if (r) return { action, reason: r }
      // 第二顺位：与它**并列在最严档**上的其余命中档，按 `TIER_RANK` 的次序逐个试
      const rank = TIER_STRICTNESS[action]
      const same = []
      for (const u of (Array.isArray(tiers) ? tiers : [])) {
        if (u !== t && TIER_STRICTNESS[ds[u]] === rank) same.push(u)
      }
      // 排序键复用 `sortTiersByRank`（与 `tierSetOf` / 整行分支**同一个**函数）。
      // 这里曾经手抄一份逐字相同的比较函数，而「抄漏一处」正是发现 3 的成因：
      // 同一份 `TIER_RANK` 出现在两处时，改一处而漏另一处的后果是**动作不变、
      // 拒绝理由随书写形态漂移**，且这一处直接决定用户可见的拒绝理由。
      // `same` 是本函数内的局部新数组，原地排序无副作用。
      sortTiersByRank(same)
      for (const u of same) {
        const ru = reasonOfTier(u)
        if (ru) return { action, reason: ru }
      }
    }
    return { action, reason: null }
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
        const ds = tierTableOf()
        // ── 整行读不懂时的档位集合（§7.2 的第三个调用点）────────────────────────
        // 这条路径**没有词元**，故 `segmentLabels` 用不上，退化为「原文粗提的名字是否
        // 命中组表」——方向仍是收紧：多认几个名字只会让更多档参与「取最严」，
        // 不会放宽任何东西。
        //
        // 半径档在这条路径上**取不到**（没有词元可判），故半径侧由 `wide` 与 `unknown`
        // **同时**参与「取较严」（设计文档 §7.2 对这条路径的原话就是
        // 「无段可判 → 动作由 wide/unknown 取较严者决定」）；组档是**额外**的收紧来源。
        //
        // **不得回落到 `inside`**：`inside` 是八档里唯一**跟随大分类**的那一档（§6.1），
        // 而大分类常态是 allow —— 回落到它等于「给破坏性命令追加一个读不懂的构造即可
        // 静默放行」。实测（真实宿主配置：mode=allow、destructive 未配置）：
        //     rm -rf C:/Windows                          → ask（段级 wide 档）
        //     rm -rf C:/Windows <<EOF…EOF                → allow ← 同一命令，只因多一个 heredoc
        //     rm -rf C:/Windows >（重定向无目标）          → allow
        //     chmod 777 /etc/passwd <<EOF… / rm -rf . <<EOF… → allow
        //     rm -rf /etc "unclosed / rm -rf /etc &&     → allow
        // 即 wide/unknown 两档被一个 heredoc、一个悬空重定向或一个未闭合引号整体绕过。
        //
        // ── 为什么是「两个都并入」，而不是「只取较严的那一个」或「只在没组档时回落」──
        // ① 不能只取单值：这里曾用 `BLAST_ORDER`（broad 2 < unknown 3 < system 4）论证
        //    「`unknown` 是较严者」，但那是**严重度序**，而用户配置的是**动作**，两者
        //    不同构 —— 本文件 TIER_ORDER 的注释自己就写着「顺序不代表严重度，真正决定
        //    动作的是用户配置 + 取最严」。取单值时两个方向都会错：
        //        wide=deny + unknown=allow → `rm -rf C:/Windows <<EOF` 变 **allow**
        //          （而同一命令不带 heredoc 是 deny —— 用户显式写的 wide=deny 被绕过）
        //        wide=allow + unknown=deny → 又会在另一侧出错
        //    并入两者只会让结果**不松于**现状（取最严对新增档是单调的）。
        // ② 不能只在「一个组档都没命中」时才回落：那样**命中组档的命令反而更松**。
        //    实测 `priv=allow`（其余档 ask）时：
        //        sudo rm -rf /              → ask（段级 wide+priv，wide 压过 priv）
        //        sudo rm -rf / <<EOF…EOF    → **allow** ← 只命中 priv 组档，半径侧整个缺席
        //    即同一命令加个 heredoc 就把「删盘根」从 ask 降成 allow。半径侧在这条路径上
        //    读不出（没有词元），但**读不出不等于不存在** —— 一个读不出目标的破坏性命令
        //    既可能落在区内、也可能落在大范围，两档都该参与「取最严」。
        //
        // 注意这条路径上并 `wide` 并**不是**「凭空多一个档」：能走到这里的前提是
        // `names.some(isDestructiveLabel)`（原文里确实认出了一个破坏性命令名）。
        //
        // ⚠️ 上面的 `push` 顺序**不是** `TIER_ORDER`（组档在前、半径档在后），故拼完之后
        // **必须排一次序**（发现 3 的修法）—— `decisiveTierOf` 的注释写着「并列时取 `tiers`
        // 里**靠前**的那个（`tiers` 已是固定顺序，故结论稳定）」，而那条稳定性论证只对
        // `tierSetOf` 的产物成立（它在返回前按 `TIER_RANK` 排过）。这条手工拼接路径不排的话，
        // **动作不变、拒绝理由随书写形态漂移**。实测（`wide=deny` + `priv=deny` + `proc=deny`，
        // 三档各带不同 `reasons`）：
        //     sudo kill 1234              → deny，理由取 `proc`（段级：tiers 已排序）
        //     sudo kill 1234 <<EOF…EOF    → deny，理由取 **`priv`** ← 同一动作，只因多了个 heredoc
        // 排序键复用 `tierSetOf` 的**同一个** `TIER_RANK`（它就是 `TIER_ORDER` 的派生），
        // 不新造表 —— 与段级路径同源，两条路径的 `tiers` 顺序从此不可能分叉。
        const tiers = groupTiersOf(names)
        if (segmentPrivilege(names)) tiers.push('priv')
        // 半径侧读不出 —— 档位集合与段级 opaque 段**单点共用**
        // （`RADIUS_TIERS_WHEN_UNREADABLE`：`wide ∪ unknown ∪ inside`，见该常量的注释）。
        // ⚠️ `inside` 照旧**并入**（不是「回落到它」）：它跟随大分类，但用户可能显式
        // 配了 `inside=deny`，丢掉它就等于丢掉一条显式表态。
        //
        // ⚠️ **裸 push**（发现 6 的修法）：这里曾经写成
        // `if (tiers.indexOf(t) === -1) tiers.push(t)`，而该条件**恒真** —— 本处的
        // `tiers` 只有两个产出者：`groupTiersOf(names)`（值域实测只有
        // `proc`/`power`/`priv`/`reg`）与上面那行字面量 `'priv'`，与
        // `RADIUS_TIERS_WHEN_UNREADABLE = ['wide','unknown','inside']` **无交集**，
        // 跳过支永不执行（等价于裸 push）。实测 318 条语料 × 2 方言，跳过支执行 0 次。
        // 原先注释给的两条论据与实测相反，故一并订正：
        //   · 「原先裸 push 会得到重复档位」—— 重复档确实存在，但来自上面那行
        //     `tiers.push('priv')`（`groupTiersOf(['sudo','kill'])` 已含 `priv`），
        //     在 HEAD 上完全相同；本守卫既非它的修法，也从未触及它。
        //   · 「该数组是对外字段（决策日志 / 弹窗）」—— 整行分支返回对象的键实测为
        //     `["action","code","segments","matched","reason","note"]`，**没有 `tiers` 键**，
        //     `segments` 恒为 `[]`，故该数组从不外泄。
        // 保留裸 push 而不是删掉整行：三档仍须并入（`inside` 见上，用户可能显式配了
        // `inside=deny`），删掉才是 fail-open。
        for (const t of RADIUS_TIERS_WHEN_UNREADABLE) tiers.push(t)
        // ── `outside` 档：**只在原文里读得出区外目标时**才并入（发现 1 的修法）──────────
        // 上面那三档是「半径侧读不出」的通用口径，而 `outside` 是**具体**档 ——
        // 无条件并入会让 58d / 58e3（八档全 allow 的用户）凭空多出一个档。
        // 判据见 `outsideTargetInUnparsable`：与段级路径对同一目标给出的结论同源。
        if (outsideTargetInUnparsable(source, h)) tiers.push('outside')
        // 排序键与段级路径**同一个**函数（`sortTiersByRank` 复用 `TIER_RANK`）——
        // 这里曾经手抄一份逐字相同的比较函数，而「抄漏一处」正是发现 3 的成因。
        sortTiersByRank(tiers)
        const v = tierVerdict(ds, tiers)
        if (v.action !== 'inherit') {
          action = v.action
          reason = v.reason
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
  //
  // ── 两个方向用**不同的** label 集合（本次修复的安全要点）────────────────────────
  // `allLabels` 是并集，其中可能含**提权前缀扩展出的**名字（`sudo kill 1234` → `kill`）。
  // 那个扩展只论证了**收紧**方向（让破坏性名单与 deny 例外看得见 `sudo` 之后的真命令），
  // 而例外同时有 **allow** 动作 —— 同一份 labels 若也用于授权，用户为普通 `rm` 写的
  // `rm *`=allow 就会命中 `sudo rm -rf /`：「允许删工作区内的文件」被静默提升成
  // 「允许经 sudo 删任意路径」。实测（两侧子设置动作完全等价、只有 label 扩展不同）：
  //     sudo rm -rf /etc / sudo rm -rf / / sudo -u root rm -rf /etc
  //     改前 ask → 改后 allow（source=exception）
  // 故授权方向只查 `allowLabels`（= 并集滤掉前缀扩展出的名字，由每个段在调用前设置）。
  // 收紧方向（deny/ask）照旧查全部 `allLabels` —— 那条既有漏洞的修法不能被削掉。
  let allowLabels = null
  // 授权面的 `Set` 视图（发现 2）：与 `allowLabels` 同源、同一次计算产出，避免在
  // `resolveException` 的 label 循环里对数组做 `indexOf`（那是 O(n²)）。
  let allowLabelSet = null
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
    // 收紧方向：`ask` 不是授权、`deny` 只会收紧，两者用扩展出的 label 都安全 ——
    // 这正是「用户写的 `kill *`=deny 拦不住 `sudo kill 1234`」那条既有漏洞的修法。
    //
    // ── 两个方向合并成**一趟**，不把同一批 label 查两遍宿主匹配器 ──────────────────
    // 拆成两轮时第二轮遍历的是 `allowLabels`，而它（= 并集滤掉前缀扩展名）除极少数
    // `widened` 项外与 `allLabels` **逐项相同** —— 同一批 label 被原样问了第二遍宿主
    // 匹配器，是纯重复工作。实测宿主的 `matchException` 调用次数：
    //     单 label 段（`git status -s`）  3 → 6（+100%）
    //     带提权扩展的段（`sudo rm -rf /etc`）  4 → 8（+100%）
    // 墙钟（60 条例外、命令不命中）：`git status -s` 38.7 → 71.5 µs。
    //
    // 合并后**语义逐字不变**，两处细节：
    //   · 授权候选仍**只**取 `allowed`（= `allowLabels`，并集滤掉前缀扩展出的名字）
    //     —— 这是上一轮的安全修复，不得回退：`rm *`=allow 不得命中 `sudo rm -rf /etc`，
    //     而 `rm *`=deny 仍须命中。判据直接问那个集合（由 `segmentLabelsCore` 单点产出），
    //     不另算一份「哪些 label 是扩展来的」。
    //   · `segText` 那一趟仍在最前（它优先，且 `deny` 立即返回），保持原有优先级。
    //   · 授权面判据用 **`Set`**（`allowSet`）而不是数组 `indexOf`（发现 2）：逐项 `indexOf`
    //     在「labels 多且逐条不同名」时是 O(n²)。语义逐字不变（同一个集合、同样的判据）。
    const allowed = allowLabels || allLabels
    const allowSet = allowLabelSet || new Set(allowed)
    for (let i = 0; i < allLabels.length; i += 1) {
      const r = tryOne(allLabels[i])
      if (!r) continue
      if (r.action === 'deny') return r
      if (r.action === 'ask' && !ask) ask = r
      // 授权方向：前缀扩展出的名字（`sudo kill 1234` → `kill`）在这一轮不可见。
      // 判据按**值**查 `allowed`（= `allowLabels`，即并集滤掉扩展名）：labels 已去重，
      // 故与原先「遍历 allowed 数组」逐项等价，且顺序也一致（filter 保序）。
      if (r.action === 'allow' && !allow && allowSet.has(allLabels[i])) allow = r
    }
    return ask || allow
  }

  for (const seg of d.segments) {
    const labelSet = segmentLabelsCore(seg.words)
    // 前缀扩展出的名字（`sudo kill 1234` → `kill`）。**例外匹配按方向取用**：
    // 收紧方向（deny/ask）可以用，授权方向（allow）不可以 —— 见 segmentLabelsCore 的注释。
    // 读取一律走 `labelSet.widenedSet`（O(1)），不再用数组 `widened`（发现 2 的性能修法）。
    let labels = labelSet.labels
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
    // 授权方向可用的 label 集合 = 并集滤掉**前缀扩展出的**名字（见 resolveException 的注释）。
    // 放在 opaque 并集**之后**算：rawCommandNames 补进来的名字同样可能含扩展名，
    // 而它走的是「收紧方向」（只用于查 deny 例外与破坏性名单），故不该进授权面。
    // 判据用 `labelSet.widenedSet`（**O(1)**）而不是对 `widened` 数组做 `indexOf`（发现 2）：
    // 同一个集合、同一个判据，只是查询复杂度从 O(len) 降到 O(1)。
    allowLabels = labels.filter((l) => !labelSet.widenedSet.has(l))
    allowLabelSet = new Set(allowLabels)
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

    // 爆炸半径：**只在破坏性段上算**（`echo B:\` 不是删除，警告它就是噪音）。
    // 与 code 分开下发、不参与动作选择 —— 它只回答「这一下有多重」，供弹窗与列表展示。
    //
    // 开关判据（cmd 的 `/s` 是开关、POSIX 的 `/etc` 是路径）只看 `opts.platform`，
    // **不看方言**：方言不等于平台（Linux 上跑 PowerShell Core 时方言是 pwsh、路径是 POSIX 的），
    // 故这里不再传 `shell`（曾经传了但全模块无人读取，是死参数）。
    //
    // **位置必须在这里**（而不是原处的 code 之后）：档位集合要读 `seg.blast`
    // （`tierSetOf` 的第一个参数），而档位决定动作 —— 先算档位再算半径就晚了。
    const blast = destructive ? blastRadiusOfSegment(seg.words, h) : null
    // 命中的全部档位（§3.3）。**只在破坏性段上算**，非破坏性段恒为空数组 ——
    // 它们没有档位可言（落大分类），填一个 `inside` 反而会让「命中档位」失去意义。
    //
    // `opaque` 必须一起传：`(rm -rf /etc)` 的 words 是空的（词法器把分组整块吞掉），
    // `blastRadiusOfSegment` 因此返回 `null`，而 `null` 在 §5.1 里映射成 `inside`
    // —— 「目标读不出」会被当成「目标在区内」。`tierSetOf` 靠这个字段把它改判 `unknown`。
    //
    // `opaqueTexts` 同样必须一起传（发现 1 的修法）：`destructiveHeadReadable` 要问
    // 「**opaque 构造自己**有没有藏一个破坏性命令」，而构造里的命令名不在 `words` 里
    // （词法器把构造整块吞掉），只能由词法器记下的构造原文回答。**漏传这一项会让该判据
    // 恒不生效**（`opaqueTexts` 缺席时按旧行为退化），靶格照旧 allow。
    const tiers = destructive
      ? tierSetOf({ words: seg.words, blast: blast, opaque: seg.opaque, opaqueTexts: seg.opaqueTexts }, labels, h)
      : []

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
        // ② destructive 子设置 —— 与可读段**同一份**档位判定（见下面那段注释）
        const v = tierVerdict(tierTableOf(), tiers)
        action = v.action
        source = 'destructive'
        reason = v.reason
      } else {
        const c = catOf()
        action = c.action
        source = 'category'
        reason = c.reason
      }
    } else {
      // ① 用户例外（段级匹配）—— 显式表态，优先于子设置（D-5）。
      // 与 opaque 分支共用 resolveException：试段原文 + 全部 label，deny > ask > allow。
      // **allow 只认 allowLabels**（前缀扩展出的名字不参与授权）——见 resolveException 的注释。
      const ex = resolveException(seg.text, labels)
      if (ex) {
        action = ex.action
        source = 'exception'
        reason = ex.reason || null
        note = ex.note || null
        ruleId = ex.ruleId || null
      } else if (destructive) {
        // ② destructive 子设置 —— 更细的判定，优先于分类默认值（D-6）。
        //
        // ── 从「一个动作」改为「按命中的档位取最严」（§3.3 / §5.4）────────────────
        // 档位集合 = 半径档(blast) ∪ 组档(label 所属组) ∪ (提权 ? {'priv'} : {})，
        // 由 `tierSetOf` 选出、`strictestTierAction` 取最严。
        //
        // **`priv` 判据加在这个既有分支内部，不新开并列分支**：6 个提权名
        // （sudo/doas/su/pkexec/runas/gsudo）**全部在 DESTRUCTIVE_LABELS 里**（实测 19/19），
        // 故 `segmentPrivilege(words) === true` 时 `destructive` 必然也为 true ——
        // 新开分支只会得到一个恒不可达的并列分支，而它看起来像「提权有独立处理」。
        //
        // **不要为了「概念干净」把提权名移出 DESTRUCTIVE_LABELS**：提权名确实属于
        // 「权限」维度，摘掉看起来更干净 —— 但会打断解析器的既有依赖：
        // `commandHeadEnd` 用 `isDestructiveLabel(base)` 决定「吃掉命令名后停」，
        // `blastRadiusOfSegment` 用 `isDestructiveLabel(head)` 决定「引号内容是否递归」。
        // 提权名不在名单里，这些判据全部失效（实测现值依赖它们）：
        //   sudo rm -rf /                 → drive-root|/
        //   su -c rm -rf /                → drive-root|/
        //   sudo /usr/bin/find / -delete  → drive-root|/
        // **结论：名单不动。** 两个维度「正交」指的是**可独立配置**，
        // 不是「要拆到互斥的分支里」。
        const v = tierVerdict(tierTableOf(), tiers)
        action = v.action
        source = 'destructive'
        reason = v.reason
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
    //
    // **`code` 与 `codeLabel` 的语义完全不动**（§7.2b）：档位走独立的 `tiers` 字段。
    // 理由见 tierLabel 的注释（三个冲突 + 维护成本对比）。test/shell-parse.mjs 有 37 处
    // `.code` 断言把它们当作判定结果的稳定标识 —— 改语义不是改数字。
    const code = destructive ? 'destructive' : (unparsable ? 'unparsable' : (writeOutside ? 'write-outside' : null))

    if (action === 'deny') anyDeny = true
    else if (action === 'ask') anyAsk = true
    else if (action === 'inherit') anyInherit = true

    out.push({ op: seg.op, text: seg.text, label, action, source, code, ruleId, reason, note, dynamic: seg.dynamic, blast, tiers })
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
