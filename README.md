# dsh-permgate — DSH 权限网关

> 为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）提供的细粒度权限控制插件

**🌏 中文 | [English](README_EN.md)**

`dsh` · `dsh-plugin` · `plugin` · `permission control` · `approval` · `sandbox` · `security` · `AI agent` · `权限控制` · `审批` · `沙箱` · `权限网关`

<!-- keywords: dsh, dsh-plugin, deepseek harness, plugin, permission control, approval, sandbox, security, ai agent, 权限控制, 审批, 沙箱, 权限网关, 自定义审查 -->

## 简介

当前 DSH 仅有 [Read only]、[Workspace Write]、[Full access] 三档权限，权限粒度较粗。本插件新增 **「自定义审查」(Custom Review)** 权限网关，对工具调用进行逐项审查。

权限按分类（目录访问 / 执行命令 / 读取文件 / 编辑文件 / 启动子代理 / 重复操作）逐项审查工具调用，支持全局/项目双级配置、例外（白/黑名单）、快捷工具默认值、自定义规则，以及中英文双语审批弹窗与沙箱升级流程。

## 功能特性

- **六大权限分类**：工作区外目录、执行命令、读写文件、子代理、重复操作六类分开管控，每一类都能独立设置「询问 / 允许 / 拒绝」——敏感操作从严、日常操作从宽，按你的习惯划定 AI 的边界。
- **全局 / 项目双级配置**：一份全局规则管所有项目，再按项目单独微调；项目里没设置的项目自动跟随全局，不用重复配置。
- **例外（白/黑名单）**：把「经常要放行」或「绝对不允许」的路径、命令加进例外，命中后直接放行或直接拒绝，不再每次弹窗打扰你。
- **快捷工具**：`web_search`、`skill` 等没法按文件或命令分类的工具，也能单独设定默认是询问、直接允许还是直接拒绝。
- **自定义规则**：按工具名、文件路径、参数内容任意组合出规则（例如「任何工具都不得执行 `rm -rf`」），比分类例外更灵活；优先级 规则 > 例外 > 默认值，用最少的规则管住最多的情况。
- **审批弹窗**：一次弹窗看全所有信息——AI 想做什么、为什么、具体参数；编辑/写入文件还会直接展示改动前后的 diff（+N/-N 行），不用再点开文件比对。觉得某类操作以后都不用问了，还能一键把它加进项目白/黑名单。
- **自定义拒绝意见**：拒绝时可以直接告诉 AI「为什么不行、应该怎么做」，AI 收到明确的理由后会立即调整方案，而不是对着一个冰冷的「用户拒绝」反复试错。
- **底层沙箱升级**：即使你放行了，文件操作仍被 DSH 底层沙箱拦下（比如写工作区外的文件）时，会再次弹窗询问是否临时放开——一次授权、执行完自动收回，多一层保险。
- **中英文双语**：界面跟随 DSH 语言自动切换，中英文用户都能顺畅使用。
- **持久化**：所有设置保存在用户目录，重启不丢失。

## 使用

- **会话权限选择器**：在输入框下方的权限选择器中选择「自定义审查」，即由权限网关按分类逐项审查工具调用。

  ![会话权限选择器](assets/permission-picker.jpg)

- **新会话默认权限设置**：在设置里把「自定义审查」设为新对话的默认权限，之后每次新建对话自动启用，不用手动重复选择。

  ![默认权限设置](assets/default-permission.jpg)

- **审批弹窗**：编辑/写入类审批可以看到 diff 详情，快速判断改动是否合理；命令类审批展示命令与参数——命中例外直接放行、未命中则询问，并给出可一键添加的规则候选（如 `git status *`），常放行的命令顺手就加进例外。

  ![审批弹窗](assets/approval-modal.png)

  ![命令执行审批（Pwsh）](assets/pwsh-approval.png)

- **自定义拒绝意见**：拒绝时填写意见，AI 会收到「为什么不行、应该怎么做」的明确理由，立即调整方案。

  ![拒绝意见](assets/reject-reason.png)

- **设置 → 权限网关**：一站式管理所有权限——每个分类的默认行为、白/黑名单、快捷工具、自定义规则、底层沙箱，全局与项目分开配置，还能查看最近决策记录。无需再手动编辑配置文件，通过设置界面即可快速调整。

  ![权限网关设置页](assets/settings-page.jpg)

## 安装

### 方式一：让 AI 安装（最简单）

把本仓库地址告诉 DSH 的 AI 助手即可，例如：「安装 https://github.com/MrWeiCodes/dsh-permgate 这个插件」。AI 会替你完成插件装载、依赖与补丁处理；之后重启 `dsh web`，在会话的权限选择器（`/permission`）中选择 **「自定义审查」**（每个对话独立记忆；也可在 设置 → Permission 里设为新会话默认）。

### 方式二：一行命令（自助安装）

宿主侧插件为纯 ESM JavaScript，浏览器注册脚本也作为运行时文件随仓库直接提交。本包没有 build、prepare 或 install 脚本，因此从 Git 安装时不需要授权 pnpm 执行构建。

从 GitHub 安装：

```powershell
dsh plugin --profile web add -w github:MrWeiCodes/dsh-permgate
```

从本地 checkout 安装（仅当 checkout 位于 profile 目录内时依赖才能解析；否则请用方式三）：

```powershell
dsh plugin --profile web add -w ./dsh-permgate
```

重启 `dsh web`，然后在会话的权限选择器（`/permission`）中选择 **「自定义审查」**（每个对话独立记忆）；也可在 设置 → Permission 里把它设为新会话默认。

> 已按「方式三」手动安装过的，请先按「卸载」清掉旧的手动行与依赖，再使用方式二，避免重复注册。

### 方式三：手动安装

无 pnpm 或离线环境时的备选路径：

1. 把本仓库放入你的 DSH profile 插件目录：
   ```powershell
   # 示例：web profile
   $dst = "$HOME\.dsh\profiles\web\packages\dsh-permgate"
   git clone https://github.com/MrWeiCodes/dsh-permgate.git $dst
   ```
2. 在 profile 的 `package.json` 的 `dependencies` 中加入：
   ```json
   "dsh-permgate": "file:./packages/dsh-permgate"
   ```
3. 把 `cordis.patch.yml` 的内容并入 profile 的 `cordis.patch.yml`（在文件末尾追加）。
4. 重新安装依赖并重启：`pnpm install`（或 `npm install`）、`dsh web`。

## 更新

按安装方式对应操作，**配置（`$DSH_HOME/dsh-permgate/config.json`）在更新后都会保留**，无需重新设置。

- **方式一（AI 安装）安装的**：直接告诉 AI「更新 dsh-permgate 插件」即可。
- **方式二（dsh plugin）安装的**：
  ```powershell
  dsh plugin --profile web update dsh-permgate
  ```
  若没有拉到最新提交（git 依赖有缓存），先移除再添加一次：
  ```powershell
  dsh plugin --profile web remove dsh-permgate
  dsh plugin --profile web add -w github:MrWeiCodes/dsh-permgate
  ```
  然后重启 `dsh web`。
- **方式三（手动）安装的**：
  ```powershell
  cd "$HOME\.dsh\profiles\web\packages\dsh-permgate"
  git pull            # 或重新拷贝新版本覆盖
  pnpm install        # 依赖声明有变化时执行
  ```
  然后重启 `dsh web`。

## 卸载

### 方式一（AI 安装）安装的：让 AI 卸载

直接告诉 AI 助手「卸载 dsh-permgate 插件」。AI 按下方「残留位置清单」移除插件、清理补丁与依赖，并删除配置目录（如需保留配置请提前说明）。

### 方式二（dsh plugin）安装的

```powershell
dsh plugin --profile web remove dsh-permgate
```

`dsh plugin remove` 只移除插件本体与补丁层，**不会删除配置目录**——需按下方清单删除 `$DSH_HOME/dsh-permgate/`。

### 方式三（手动）安装的

1. 从 profile 的 `cordis.patch.yml` 中删除 `- insert: permgate` 行；`permission` 预设覆盖整行可一并删除（恢复平台默认预设表）。
2. 从 profile 的 `package.json` 的 `dependencies` 中删除 `"dsh-permgate": ...`。
3. 重新安装依赖并重启：`pnpm install`（或 `npm install`）、`dsh web`。
4. 删除插件目录与配置目录（路径见下方清单）。

### 残留位置清单（AI 卸载时按此清理）

- **配置目录**：`$DSH_HOME/dsh-permgate/`——`$DSH_HOME` 默认是 `~/.dsh`（Windows 下 `C:\Users\<用户名>\.dsh`），插件的 `config.json` 保存在这里。卸载不会自动删除，AI 卸载时按此路径删除整个目录。
- **插件目录**（方式三安装时）：`$DSH_HOME/profiles/<profile>/packages/dsh-permgate/`。
- **依赖与补丁**（方式三安装时）：profile 的 `package.json` 中的 `"dsh-permgate": ...` 依赖、`cordis.patch.yml` 中的 `- insert: permgate` 行与 `permission` 预设覆盖。
- **会话日志**：会话中的 `permission/preset: custom-review` 事件是 DSH 自身的记录，**不属于插件残留，不要删除**。

### 卸载残留

- **配置文件**：`$DSH_HOME/dsh-permgate/config.json` 不会被自动删除（这是插件唯一的持久化文件），卸载后手工删除即可。
- **会话历史**：已选「自定义审查」的会话日志保留 `permission/preset` 事件——这是 DSH 自身的会话记录，非本插件写入的数据，不属于插件残留；卸载后该预设不存在，权限选择器会自动回退到匹配当前沙箱/审批设置的内置预设（如 Workspace Write），不会报错。
- **会话级设置**：曾通过设置页把底层沙箱切到 Full access 的会话，其 `sandbox/mode` 会话事件保留，卸载后仍生效（属 DSH 会话状态，非插件残留）。
- **浏览器侧**：徽标、预设名显示等 DOM 注入只存在于页面内存，刷新页面即消失；审批弹窗为内存态，随进程结束消失。
- 无全局注册表、npm 全局包或系统级写入。


## 配置文件路径

`$DSH_HOME/dsh-permgate/config.json`

## 语言与名称显示

- 插件自身的界面文案（弹窗、面板、快捷栏）通过 DSH locale 服务注册，跟随界面语言自动切换；缺失/非法语言参数默认中文。

## 兼容性与冲突

- **零侵入、无痕插拔**：插件仅使用 DSH 的公开接口（插件装载、`webServer` 路由、`tools` pre-execute 审查链、`locale`/`slots` 服务等），**未通过 hook、补丁等手段修改原生 DSH 代码或内部实现**；卸载即从进程中完全移除，刷新页面后浏览器侧不留任何痕迹。
- **HTTP 路由**：接口全部位于 `/permgate/*`（含 SSE `/permgate/events`），与其他插件冲突概率极低。
- **槽位 id**：设置页、快捷栏、弹窗分别使用 `permgate`、`permgate-approval` 等独立 id；若与其他插件撞 id 会直接报错（不会静默破坏）。
- **`permission` 预设表覆盖**：补丁中的 `permission` 整行是**全表覆盖**语义（重述全部预设）。若第三方补丁同时覆盖同一配置会互相覆盖——不要与其它修改 `permission` 配置的补丁并存。
- **同类权限插件**：若同时安装其它 pre-execute 审查插件，两个审查链都会生效、可能重复弹窗——建议只保留一个。
- **原生 approval 服务**：permgate 的前置审查使用自己的弹窗（不经 DSH approval 服务）；沙箱升级审批使用原生 `approval.request`，互不冲突。
- **显示层**：预设名语言化与徽标是 best-effort DOM 层，仅影响显示；与其他操作同一 DOM 的插件可能视觉叠加，不影响审查功能。

## 自定义功能开发

```powershell
# 本仓库文件即插件源码（根目录 index.js = 宿主半，client.js = 浏览器半）
node --check index.js
node --check client.js
```

如需自定义插件功能或修改插件，直接使用 DSH 的 Creator mode 即可快速进行开发修改。

## 许可

[MIT](LICENSE)
