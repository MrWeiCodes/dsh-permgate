#!/usr/bin/env node
// 插件清单元信息的端到端复算：用 DSH 自己的 readPluginMeta 读本包，逐项比对返回值。
// 用法：node test/meta.mjs
//
// 为什么单独一个文件，而不是并进 regressions.mjs：
//   regressions.mjs 是「不依赖 DSH 运行时」的静态/纯函数套件，而这里要动态 import
//   dsh-app-boot 的真实实现（顶层 await）。混进去会让那套件在没装 DSH 的机器上整体失败。
//
// 找不到 dsh-app-boot 时自报 SKIP 并退出 0：本仓库的测试不该因「这台机器没装 DSH」而假红。
// 找到则必须逐项对上——静态断言全绿也可能因为 exports 写法不被 Node 接受而实际解析失败，
// 本文件就是钉死这一点的那道闸。
import { readFileSync, existsSync, realpathSync } from 'node:fs'
import { join as pathJoin, resolve as pathResolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const ROOT = pathResolve(pathJoin(fileURLToPath(import.meta.url), '..', '..'))
const PKG = JSON.parse(readFileSync(pathJoin(ROOT, 'package.json'), 'utf8'))

const fail = []
const ok = (name, cond, extra) => { if (!cond) fail.push(name + (extra ? ' — ' + extra : '')) }

/**
 * 定位 dsh-app-boot 的入口文件。
 *
 * 依次尝试三条真实路径，任何一条命中即可：
 *   ① 本包自己的 node_modules（开发者在本仓装了 DSH 依赖时）；
 *   ② 相邻的 DSH 安装（本仓常见布局：<repo>/../node_modules）；
 *   ③ 环境变量 DSH_BOOT_PATH 显式指定。
 * 刻意**不**扫描 npm 的 _npx 缓存目录：那里的路径含内容哈希，换机器必变，
 * 写死等于给未来埋一条假红。
 * @returns 入口文件的绝对路径，或 null（表示本机没有可用的 DSH，调用方报 SKIP）。
 */
function findBoot() {
  const req = createRequire(pathJoin(ROOT, 'package.json'))
  try { return req.resolve('@deepseek-ai/dsh-app-boot/lib/index.js') } catch { /* 继续 */ }
  try { return req.resolve('@deepseek-ai/dsh-app-boot') } catch { /* 继续 */ }
  const explicit = process.env.DSH_BOOT_PATH
  if (explicit && existsSync(explicit)) return explicit
  return null
}

const bootPath = findBoot()
if (bootPath === null) {
  console.log('SKIP：本机找不到 @deepseek-ai/dsh-app-boot，跳过元信息端到端复算。')
  console.log('      （静态口径已由 test/regressions.mjs 的 ★71 覆盖；如需本项，')
  console.log('        设 DSH_BOOT_PATH=<...>/dsh-app-boot/lib/index.js 后重跑。）')
  process.exit(0)
}

const boot = await import(pathToFileURL(bootPath).href)
console.log('— 28b. 元信息端到端复算（readPluginMeta，生产实现）')
console.log('  实现：' + bootPath)

// 解析基准取本包自己的 package.json：readPluginMeta 的 parentURL 语义与 Loader 的
// 模块解析基准同源。这里用**本包目录**而不是 profile 目录，是为了让断言与安装位置无关。
const parentURL = pathToFileURL(pathJoin(ROOT, 'package.json')).href

// 走 self-reference（包内以自身包名引用自己）解析到本仓，这正是我们要验的对象。
// 注意：这一条只在本仓内成立；真实用户机器上是 profile 的 node_modules 解析到安装副本，
// 但两条路径走的是同一个 package.json 与同一套 exports，故结论等价。
const meta = boot.readPluginMeta(PKG.name, parentURL)

ok('readPluginMeta 返回了对象（未返回 undefined）', meta !== undefined && meta !== null)
if (meta !== undefined && meta !== null) {
  // 元信息读取出错时 DSH 会挂 error 字段并**保留可用文本**；本包不该有任何 error
  ok('readPluginMeta 无 error 字段', meta.error === undefined, String(meta.error))

  // title：必须是 locale 里写的双语对象，而不是退回的包名
  ok('title 是双语对象（不是退回的包名字符串）',
    typeof meta.title === 'object' && meta.title !== null, JSON.stringify(meta.title))
  if (typeof meta.title === 'object' && meta.title !== null) {
    // ⚠️ 期望值必须**写死字面量**，不得从 locale/*.json 读回来比对。
    // 本文件第一版就是读回来比的，实测有两条变异零鉴别力（同源比对：期望与实际
    // 一起被变异改变，两边恒等）：
    //   · 删掉 zh.json 的 meta.title  → meta.title.zh 与期望同时变 undefined，仍相等；
    //   · 把 zh 的 title 换成 en 的值 → 两边同时变英文，仍相等。
    // 改文案时这里要同步改，这正是「钉住显示文案」的本意。
    ok('title.zh 是钉住的中文标题', meta.title.zh === '权限网关', JSON.stringify(meta.title.zh))
    ok('title.en 是钉住的英文标题', meta.title.en === 'Permission Gateway', JSON.stringify(meta.title.en))
    ok('title 未退回包名', meta.title.en !== PKG.name && meta.title.zh !== PKG.name)
    // 中英不得雷同（防张冠李戴：两份 locale 被写成同一份）
    ok('title 中英不雷同', meta.title.zh !== meta.title.en)
  }

  // description：同样取自 locale，且不得退回 package.json 的英文长描述
  ok('description 是双语对象（不是退回的 package.json description）',
    typeof meta.description === 'object' && meta.description !== null,
    JSON.stringify(meta.description))
  if (typeof meta.description === 'object' && meta.description !== null) {
    const zhDesc = '按分类逐项审查工具调用：目录、命令、读写、子代理等八类分开管控，支持例外、自定义规则与中英双语审批弹窗。'
    const enDesc = 'Reviews tool calls per category — directories, commands, reads, writes, subagents — with exceptions, custom rules, and a bilingual approval modal.'
    ok('description.zh 是钉住的中文描述', meta.description.zh === zhDesc,
      JSON.stringify(meta.description.zh))
    ok('description.en 是钉住的英文描述', meta.description.en === enDesc,
      JSON.stringify(meta.description.en))
    ok('description 未退回 package.json 的 description',
      meta.description.en !== PKG.description)
    ok('description 中英不雷同', meta.description.zh !== meta.description.en)
  }

  // icon：DSH 读成 base64 data URL；解回来必须与磁盘上的 icon.svg 逐字节一致
  ok('icon 是 data URL', typeof meta.icon === 'string' && meta.icon.startsWith('data:'),
    typeof meta.icon === 'string' ? meta.icon.slice(0, 40) : String(meta.icon))
  if (typeof meta.icon === 'string' && meta.icon.startsWith('data:')) {
    ok('icon 的 media type 是 SVG（与扩展名一致）', meta.icon.startsWith('data:image/svg+xml;base64,'),
      meta.icon.slice(0, 32))
    const comma = meta.icon.indexOf(',')
    const decoded = Buffer.from(meta.icon.slice(comma + 1), 'base64').toString('utf8')
    const onDisk = readFileSync(realpathSync(pathJoin(ROOT, PKG.icon)), 'utf8')
    ok('icon 解出的字节与磁盘上的 icon.svg 完全一致', decoded === onDisk)
  }
}

console.log()
if (fail.length) {
  console.log('META FAIL (' + fail.length + ')：')
  for (const f of fail) console.log('  ✗ ' + f)
  process.exit(1)
}
console.log('META ALL PASS')
