window.__ModuleLoader__.load({
	id: "@mrweicodes/dsh-permgate",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let React = require("react");
		// react-dom 与 ui-primitives 是 Web 前端的静态模块（`__ModuleLoader__` 的 staticModules
		// 表，见 dsh-web-frontend 的 OZ()），任何插件都能 require，不需要写进 dsh.client.inject
		// （inject 是 Cordis 服务依赖，与模块解析是两回事）。
		//
		// 仍然 try/catch：静态模块表是运行时注入的，万一某个部署裁掉了（例如纯 CLI 无前端），
		// 拿不到就降级成内联样式，而不是整个客户端插件加载失败。
		let ReactDOM = null;
		try { ReactDOM = require("react-dom"); } catch (e) { ReactDOM = null; }
		let Primitives = null;
		try { Primitives = require("@deepseek-ai/dsh-client-ui-primitives"); } catch (e) { Primitives = null; }

		const CSS = ".pg-modal { position: fixed; top: 16px; right: 16px; z-index: 9999; width: 420px; max-width: 92vw; max-height: 82vh; overflow-y: auto; background: var(--dsw-alias-bg-overlay, #ffffff); color: var(--dsw-alias-label-primary, #24292f); border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.4)); border-radius: 10px; box-shadow: 0 10px 36px rgba(0,0,0,0.32); padding: 14px 16px; font-family: system-ui, -apple-system, \"Segoe UI\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif; } .pg-modal-title { font-size: 14px; font-weight: 600; margin-bottom: 2px; } .pg-modal-sub { font-size: 11px; color: var(--dsw-alias-label-tertiary, #8b949e); margin-bottom: 8px; word-break: break-all; line-height: 1.4; } .pg-modal-req { font-size: 12px; margin-bottom: 4px; } .pg-modal-body { font-size: 12px; color: var(--dsw-alias-label-secondary, #57606a); margin-bottom: 8px; } .pg-intent { font-size: 12px; background: var(--dsw-alias-bg-layer-1, #f6f8fa); border: 1px solid var(--dsw-alias-border-l1, #d0d7de); border-left: 3px solid var(--dsw-alias-brand-primary, #1f6feb); border-radius: 6px; padding: 6px 8px; color: var(--dsw-alias-label-secondary, #57606a); margin-bottom: 6px; line-height: 1.5; word-break: break-word; } .pg-intent-tag { display: inline-block; font-weight: 700; color: var(--dsw-alias-brand-primary, #1f6feb); margin-right: 6px; font-size: 11px; } .pg-args { font-size: 11px; background: var(--dsw-alias-bg-layer-1, #f6f8fa); border: 1px solid var(--dsw-alias-border-l1, #d0d7de); border-left: 3px solid rgba(128,128,128,0.65); border-radius: 6px; padding: 5px 8px; color: var(--dsw-alias-label-secondary, #57606a); margin-bottom: 8px; line-height: 1.5; word-break: break-all; font-family: ui-monospace, Consolas, monospace; } .pg-args-tag { display: inline-block; font-weight: 700; color: rgba(128,128,128,0.95); margin-right: 6px; font-size: 11px; font-family: system-ui, -apple-system, \"Segoe UI\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif; } .pg-args-row { display: flex; gap: 6px; padding: 1px 0; } .pg-args-label { font-weight: 600; flex: 0 0 auto; } .pg-args-val { word-break: break-all; flex: 1; } .pg-args-note { color: #bf8700; white-space: nowrap; margin-left: 6px; } .pg-cand-head { font-size: 12px; font-weight: 600; margin: 6px 0 4px; } .pg-cand-hint { font-size: 11px; color: var(--dsw-alias-label-secondary, #8c959f); margin-bottom: 4px; } .pg-cand { display: flex; align-items: center; gap: 6px; padding: 4px 0; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.2)); } .pg-cand-label { flex: 1; font-family: ui-monospace, Consolas, monospace; font-size: 11px; word-break: break-all; } .pg-radio { display: inline-flex; align-items: center; gap: 3px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.4)); background: transparent; color: var(--dsw-alias-label-secondary, #57606a); font-size: 11px; font-family: inherit; cursor: pointer; transition: all 0.15s ease; } .pg-radio:hover { border-color: var(--dsw-alias-brand-primary, #1f6feb); } .pg-radio-allow { border-color: var(--dsw-alias-state-success-primary, #1a7f37); color: var(--dsw-alias-state-success-primary, #1a7f37); background: rgba(26, 127, 55, 0.12); font-weight: 600; } .pg-radio-deny { border-color: var(--dsw-alias-state-error-primary, #cf222e); color: var(--dsw-alias-state-error-primary, #cf222e); background: rgba(207, 34, 46, 0.12); font-weight: 600; } .pg-footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; } .pg-action { display: inline-flex; align-items: center; padding: 5px 16px; border-radius: 6px; border: 1px solid; font-size: 12px; font-family: inherit; font-weight: 600; cursor: pointer; transition: filter 0.15s ease, box-shadow 0.15s ease, transform 0.05s ease; } .pg-action:hover { filter: brightness(1.07); box-shadow: 0 2px 8px rgba(0,0,0,0.18); } .pg-action:active { transform: translateY(1px); box-shadow: none; } .pg-action:disabled { opacity: 0.5; cursor: not-allowed; filter: none; box-shadow: none; } .pg-action-allow { border-color: rgba(26, 127, 55, 0.45); color: #1a7f37; background: rgba(26, 127, 55, 0.12); } @supports (color: color-mix(in srgb, red 10%, blue)) { .pg-action-allow { border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary, #1a7f37) 45%, transparent); color: var(--dsw-alias-state-success-primary, #1a7f37); background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #1a7f37) 12%, transparent); } } .pg-action-deny { border-color: rgba(207, 34, 46, 0.45); color: #cf222e; background: rgba(207, 34, 46, 0.12); } @supports (color: color-mix(in srgb, red 10%, blue)) { .pg-action-deny { border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #cf222e) 45%, transparent); color: var(--dsw-alias-state-error-primary, #cf222e); background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #cf222e) 12%, transparent); } } .pg-btn { padding: 4px 10px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.4)); background: transparent; color: var(--dsw-alias-label-primary, #24292f); cursor: pointer; font-size: 13px; font-family: inherit; transition: border-color 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease, transform 0.05s ease; } .pg-btn:hover { border-color: var(--dsw-alias-brand-primary, #1f6feb); background: rgba(31, 111, 235, 0.08); } .pg-btn:active { transform: translateY(1px); } .pg-btn:disabled { opacity: 0.5; cursor: not-allowed; } .pg-btn-danger:hover { border-color: var(--dsw-alias-state-error-primary, #cf222e); color: var(--dsw-alias-state-error-primary, #cf222e); background: rgba(207, 34, 46, 0.08); } .pg-btn-on { border-color: var(--dsw-alias-state-success-primary, #1a7f37); color: var(--dsw-alias-state-success-primary, #1a7f37); background: rgba(26, 127, 55, 0.12); font-weight: 600; } .pg-btn-on:hover { border-color: var(--dsw-alias-state-success-primary, #1a7f37); color: var(--dsw-alias-state-success-primary, #1a7f37); background: rgba(26, 127, 55, 0.2); } .pg-btn-off { border-color: var(--dsw-alias-state-error-primary, #cf222e); color: var(--dsw-alias-state-error-primary, #cf222e); background: rgba(207, 34, 46, 0.1); font-weight: 600; } .pg-btn-off:hover { border-color: var(--dsw-alias-state-error-primary, #cf222e); color: var(--dsw-alias-state-error-primary, #cf222e); background: rgba(207, 34, 46, 0.16); } .pg-btn-confirm { border-color: var(--dsw-alias-state-error-primary, #cf222e); color: #ffffff; background: var(--dsw-alias-state-error-primary, #cf222e); } .pg-btn-confirm:hover { border-color: var(--dsw-alias-state-error-primary, #cf222e); color: #ffffff; background: var(--dsw-alias-state-error-primary, #cf222e); filter: brightness(1.12); } .pg-field { padding: 4px 8px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.4)); background: var(--dsw-alias-bg-layer-1, #f6f8fa); color: var(--dsw-alias-label-primary, #24292f); color-scheme: light dark; font-size: 13px; font-family: inherit; transition: border-color 0.15s ease, box-shadow 0.15s ease; } .pg-field:hover { border-color: var(--dsw-alias-brand-primary, #1f6feb); } .pg-field:focus { outline: none; border-color: var(--dsw-alias-brand-primary, #1f6feb); box-shadow: 0 0 0 2px rgba(31, 111, 235, 0.22); } .pg-field:disabled { opacity: 0.5; cursor: not-allowed; } .pg-field option { color: var(--dsw-alias-label-primary, #24292f); background: var(--dsw-alias-bg-overlay, #ffffff); } .pg-tab { padding: 6px 16px; border-radius: 6px 6px 0 0; border: none; border-bottom: 2px solid transparent; background: transparent; color: var(--dsw-alias-label-primary, #24292f); cursor: pointer; font-size: 13px; font-family: inherit; margin-right: 4px; transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease; } .pg-tab:hover { background: rgba(128, 128, 128, 0.12); } .pg-tab-on { border-bottom-color: var(--dsw-alias-brand-primary, #1f6feb); color: var(--dsw-alias-brand-primary, #1f6feb); font-weight: 600; } .pg-seg { display: inline-flex; padding: 2px; border-radius: 8px; background: var(--dsw-alias-bg-layer-1, #f6f8fa); border: 1px solid var(--dsw-alias-border-l1, #d0d7de); } .pg-seg-btn { padding: 3px 14px; border-radius: 6px; border: none; background: transparent; color: var(--dsw-alias-label-secondary, #57606a); cursor: pointer; font-size: 12px; font-family: inherit; transition: background-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease; } .pg-seg-btn:hover { color: var(--dsw-alias-label-primary, #24292f); } .pg-seg-btn-on { background: var(--dsw-alias-bg-overlay, #ffffff); color: var(--dsw-alias-label-primary, #24292f); font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,0.14); }";

		// ── 审批卡片：拖动柄 + 缩略按钮 + 缩小方块 ─────────────────────────────
		// 标题栏整条是拖动柄（cursor:move 给出可拖暗示）；缩略按钮在柄内，需自身拦掉
		// 指针事件。方块与弹窗同一坐标系（shell.overlay 是 fixed 层，不受父容器裁剪），
		// 默认位置由 CSS 给（右上角），拖动后改用显式 left/top。
		// 脉动只动 opacity：跑在合成线程，不触发 layout/paint，多个方块同时闪也不卡。
		//
		// 尺寸常量必须声明在 PG_CARD_CSS **之前**：下面这个数组在模块顶层立即求值，
		// 数组项里直接拼接了这些常量。若把它们放在后面的「卡片外壳」区块（原先的位置），
		// 顶层求值会命中 const 的暂时性死区（TDZ）抛 ReferenceError，整个客户端插件
		// 加载失败 —— 不是样式错乱，是 factory 一进去就崩。
		const PG_MIN_W = 132;   // 缩小方块宽（图标 16 + 间距 + 文字）
		const PG_MIN_H = 30;    // 缩小方块高（图标 16 + 上下内边距）
		const PG_MIN_GAP = 8;
		const PG_MIN_EDGE = 16;
		const PG_CARD_CSS = [
			'.pg-modal-head { display: flex; align-items: center; gap: 8px; margin-bottom: 2px; cursor: move; touch-action: none; user-select: none; }',
			'.pg-modal-head .pg-modal-title { flex: 1; min-width: 0; margin-bottom: 0; }',
			'.pg-modal-min { flex: none; width: 22px; height: 22px; padding: 0; line-height: 1; font-size: 14px; cursor: pointer; color: var(--dsw-alias-label-secondary, #57606a); background: transparent; border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.4)); border-radius: 5px; }',
			// hover 底色用 solid 版：`--dsw-alias-interactive-bg-hover` 只有 6% alpha，
			// 而卡片背景不透明（--dsw-alias-bg-overlay），6% 的灰几乎看不出变化。
			// 理由详见 PG_HOVER_CSS 处的说明。
			'.pg-modal-min:hover { background: var(--dsw-alias-interactive-bg-hover-solid, rgba(128,128,128,0.14)); }',
			'.pg-min { position: fixed; z-index: 9999; display: flex; align-items: center; gap: 6px; box-sizing: border-box; width: ' + PG_MIN_W + 'px; height: ' + PG_MIN_H + 'px; padding: 0 9px; cursor: move; touch-action: none; user-select: none; background: var(--dsw-alias-bg-overlay, #ffffff); color: var(--dsw-alias-label-primary, #24292f); border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.4)); border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,0.28); font-family: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; font-size: 13px; animation: pgMinPulse 2.2s ease-in-out infinite; }',
			'.pg-min-icon { flex: none; width: 16px; height: 16px; background-color: currentColor; -webkit-mask-position: center; mask-position: center; -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat; -webkit-mask-size: contain; mask-size: contain; }',
			'.pg-min-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
			'@keyframes pgMinPulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.55 } }',
			// 倒计时条：与弹窗同色系，用警告色区分「这条会自己结案」。
			'.pg-count { display: flex; align-items: center; gap: 8px; margin: 6px 0 8px; padding: 5px 8px; border-radius: 6px; font-size: 12px; background: var(--dsw-alias-bg-layer-1, #f6f8fa); border: 1px solid var(--dsw-alias-state-warning-primary, #e65100); color: var(--dsw-alias-state-warning-primary, #e65100); }',
			'.pg-count-text { flex: 1; min-width: 0; font-variant-numeric: tabular-nums; }',
			'.pg-count-stop { flex: none; padding: 2px 8px; font-size: 11px; cursor: pointer; color: inherit; background: transparent; border: 1px solid currentColor; border-radius: 5px; }',
			'.pg-count-stop:hover { background: rgba(230,81,0,0.1); }',
			// 取消失败提示：与倒计时条同色系，紧跟在按钮后
			'.pg-count-err { flex: none; font-size: 11px; }',
			// 异常原因（auto 专用）：灰色小字，只作说明不抢视线
			'.pg-note { font-size: 11px; color: var(--dsw-alias-label-tertiary, #8b949e); margin-bottom: 8px; line-height: 1.5; word-break: break-word; }',
			// 模型原话（auto 专用）：与 .pg-note 同为灰色小字，但加左侧竖线 + 斜体，
			// 让用户一眼看出「这是模型说的」而不是「系统判定的」。
			// 为什么必须区分：模型在 reason 里可能写「用户已授权删除」这类**臆断**，
			// 若与 permgate 自己的说明同形渲染，用户会把它读成系统的结论。
			// 竖线用 border-left 而不是 ::before 伪元素：这里只拼字符串，没有额外的节点。
			'.pg-model-reason { font-size: 11px; color: var(--dsw-alias-label-tertiary, #8b949e); margin-bottom: 8px; padding-left: 8px; border-left: 2px solid var(--dsw-alias-border-secondary, #30363d); font-style: italic; line-height: 1.5; word-break: break-word; }',
			// 无障碍：系统偏好「减少动态效果」时关掉脉动，改用静态强调色边框 ——
			// 该偏好针对的是「动态」，不是「不要提示」，故仍保留可见的存在感。
			'@media (prefers-reduced-motion: reduce) { .pg-min { animation: none; border-color: var(--dsw-alias-state-warning-primary, #e65100); box-shadow: 0 0 0 1px var(--dsw-alias-state-warning-primary, #e65100), 0 6px 20px rgba(0,0,0,0.28); } }',
		].join(' ');

		// radio 禁用态的视觉提示：主 CSS 里 .pg-radio 没有 :disabled 规则，
		// 原先靠内联 style 兜底，去掉后禁用按钮看起来仍可点。
		const RADIO_DISABLED_CSS = '.pg-radio:disabled { opacity: 0.5; cursor: not-allowed; }';

		// 列表排序（规则 / 例外）的样式：↑↓ 按钮比普通按钮窄一圈，两行列表里一行要放
		// 动作徽标 + 内容 + 备注 + 两个箭头 + 删除，按钮按默认 4px/10px 内边距会把内容挤到换行。
		// 拖动中的行给 grab/grabbing 光标：这是「这行能拖」唯一的视觉暗示（HTML5 拖放不会
		// 自己画任何东西），没有它用户根本不会去试。
		const PG_SORT_CSS = '.pg-btn-move { padding: 1px 5px; font-size: 12px; line-height: 1.4; } .pg-row-drag { cursor: grab; } .pg-row-drag:active { cursor: grabbing; }';

		// 爆炸半径警告条（审批弹窗）。配色由内联 style 给（按档位不同），这里只定形状：
		// 左边一条粗色边 + 浅底，视觉权重高于普通说明、低于按钮 —— 它是「看这里」而不是「点这里」。
		// 不做成可关闭：它只在真的危险时出现（盘根/系统目录/家目录/工作区外），
		// 能关掉就等于允许用户把唯一的安全提示永久藏起来。
		const PG_BLAST_CSS = '.pg-blast { display: flex; align-items: flex-start; gap: 6px; font-size: 12px; font-weight: 600; line-height: 1.45; padding: 6px 8px; margin-bottom: 8px; border: 1px solid; border-left-width: 3px; border-radius: 6px; background: rgba(198,40,40,0.07); word-break: break-word; } .pg-blast-icon { flex: none; }';

		// 「破坏性命令」八档列表的样式。**必须走 CSS 类**，不能继续用内联 style：
		// 行需要 hover 高亮、分组头要画真分隔线，这两件事内联 style 都做不到
		// （内联表达不了 :hover / ::after）。
		//
		// 折叠态给**按动作分组的计数**（`拒绝 2 · 询问 4`）：它精确、无颜色依赖、
		// 不依赖逐档识别，回答的正是折叠态该回答的问题 ——「有没有哪档被设成了
		// 意外的值」。要看具体是哪一档就展开，展开后逐行有状态点。
		const PG_TIER_CSS = [
			// 标题行：只有标题（摘要挪进下方那个展开链接里 —— 见 .pg-tier-link）。
			'.pg-tier-head { margin-bottom: 2px; }',
			'.pg-tier-title { font-size: 12px; font-weight: 600; }',
			// 说明行：独立一行，不与标题挤在一起。
			'.pg-tier-hint { font-size: 11px; color: rgba(128,128,128,0.9); margin-bottom: 2px; }',
			// 展开/折叠入口：**与上方例外列表同一套交互**（左对齐蓝字链接，▸/▾ 前缀）。
			// 折叠/展开的语义在两处完全相同，长得就该一样。
			//
			// 摘要（`询问 3 · 拒绝 3 · 继承全局 1`）**放进这个链接里**而不是留在标题行：
			// 与例外列表的 `▸ 例外列表（18 条）` 同构，且展开后摘要自然消失
			// （那时八行都看得见，摘要就是多余的 —— 例外列表同样在展开后不再显示条数）。
			'.pg-tier-link { display: inline-block; font-size: 12px; color: #1f6feb; cursor: pointer; user-select: none; padding: 2px 0; }',
			'.pg-tier-link:hover { text-decoration: underline; }',
			// 分组头：不用 `── 按命令类别 ──` 那串 ASCII 线 —— 它在任何字体下都与真分隔线
			// 对不齐（全角/半角混排），且占满一行只传达一个分组名。改成小号字 + ::after 画的线。
			'.pg-tier-group { display: flex; align-items: center; gap: 6px; margin: 7px 0 2px; font-size: 11px; color: rgba(128,128,128,0.9); }',
			'.pg-tier-group::after { content: ""; flex: 1; height: 1px; background: rgba(128,128,128,0.28); }',
			// 八行的容器：左侧一条细竖线把它们圈成一个整体（它们是一组设置，不是八条独立的）。
			//
			// **右侧不留内边距**（`padding: … 0`）—— 这是对齐的关键：容器右边缘与上方
			// 分类标题行等宽，行内又无右内边距，于是档位下拉框的右边缘与分类下拉框
			// 严格齐平。行若带右内边距，档位下拉框会比分类下拉框短一截。
			'.pg-tier-box { margin: 1px 0 0 2px; padding-left: 8px; border-left: 2px solid rgba(128,128,128,0.25); }',
			// 单行：三列网格 = 状态点 / 标签 / 控件。第三列 auto，配合上面的「无右内边距」
			// 使八个下拉框右边缘落在同一条线上（即使某档多出一个拒绝原因框，
			// 它也只是把第三列向左撑开，右边缘不动）。
			// minmax(0, 1fr) 而不是 1fr：后者的最小尺寸是 auto，长标签会把列撑开而不是省略。
			'.pg-tier { display: grid; grid-template-columns: 10px minmax(0, 1fr) auto; align-items: center; gap: 8px; padding: 3px 0; border-radius: 5px; }',
			'.pg-tier:hover { background: rgba(128,128,128,0.1); }',
			// 状态点：颜色 = 该档当前动作（沿用 MODE_COLORS 那套语义）。它替代了「每行旁边
			// 再写一遍当前值」—— 八档里哪一档是拒绝，扫一眼左边的点就知道。
			'.pg-tier-dot { width: 8px; height: 8px; border-radius: 50%; justify-self: center; box-shadow: inset 0 0 0 1px rgba(0,0,0,0.18); }',
			// 标签：单行截断 + title 悬浮看完整判据（短标签让人扫得快，完整解释不丢）。
			'.pg-tier-label { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
		].join(' ');

		// 例外行的样式：与上面「破坏性命令」的档位行**同一套视觉**（状态点 / 内容 / 右侧控件）。
		//
		// 统一的意义不只是好看：两处表达的是同一个概念（一个动作 + 它作用的对象），
		// 却一个用彩色文字徽标、一个用彩色圆点 —— 同一个东西在相邻两处长得不一样。
		// 现在两处都是「点 + 内容 + 动作下拉框」，且**动作都能直接改**。
		//
		// ── 为什么这里不用 grid（与 .pg-tier 不同）──────────────────────────────
		// 例外行由 sortRowProps 给出**内联** style（rowStyle：flex + wrap + 拖动落点样式），
		// 而内联样式优先级高于类，故 `.pg-exc { display: grid }` 会被它压掉 ——
		// 写了也不生效（实测：类名合并对了、grid 仍不生效）。
		// 改成与 flex 基座配合：右侧控件用 margin-left:auto 顶到右边。
		// 视觉结果与档位行的 grid 一致（各行的控件**右边缘**对齐），且拖动的
		// 落点线/半透明等既有样式全部保留。
		// ── 模型/推理强度选择行：样式**内联**写在组件里，不在这里 ──────────────────
		// 官方 @deepseek-ai/dsh-client-ui-model-selection 的 CSS Module 取值
		// （.cell / .cellLabel / .cellValue / .cellChevron / .option / .check）已逐项
		// 抄进 pickerRowEl 的 style 对象里。
		//
		// ⚠️ 为什么不用 <style> 注入的 class：本文件的样式注入有去重守卫
		// （`querySelector('style[data-plugin-css="dsh-permgate"]')`），那个 <style> 在插件
		// 首次加载时就已存在，于是**后续新增的 CSS 常量不会被写进去** —— HMR 重载后
		// class 找不到任何规则，实测表现为「标签被压成竖排、整块布局崩掉」。
		// 本文件其它组件（row / numInput / sel）一律用内联 style，正是同一个原因。
		//
		// 唯一的例外是 `PG_HOVER_CSS`：内联 style **表达不了 :hover / :focus-visible**，
		// 而官方 .cell:hover / .option:hover 有底色反馈（没有它用户不知道那一行可点）。
		//
		// ⚠️ 坑①：**内联 style 的优先级高于类选择器**。如果元素上同时写了
		// `style={{ background: 'transparent' }}`，这条 :hover 永远不生效。
		// 所以凡是要 hover 反馈的元素，background **只能由这里给**。
		//
		// ⚠️ 坑②（这次）：官方那条令牌 `--dsw-alias-interactive-bg-hover` 是
		// `#2631480f` —— **alpha 只有 6%**（浅色）/ `#ffffff14`（8%，深色）。
		// 在官方自己的 UI 里它够用，因为官方菜单背景是**不透明**的；
		// 而 permgate 的浮层用了 MenuSurface 的 `--dsw-menu-surface-fill: #f8f9fa94`
		// （alpha 148/255，**半透明**），底色再被 6% 的灰叠一层，
		// 实际差异只有 1~2 个色阶 —— 肉眼就是「鼠标指上去颜色不变」（实测反馈）。
		//
		// 故这里改用 **solid 版**：`--dsw-alias-interactive-bg-hover-solid`
		// = `--dsw-static-neutral-bluish-75` = `#f1f3f5`，不透明实色。
		// 深浅两套主题各有一份定义（浅色 #f1f3f5 / 深色由 dark 段覆盖），
		// 且不依赖浮层背景的透明度 —— 这才是「看得见」的 hover。
		//
		// ⚠️ 坑③（这次「不同厂商 hover 效果不一样」）：`:hover` 与 `.pg-active`
		// 原本用**同一个底色**，于是**已经是高亮项的那一行，鼠标移上去颜色不变**
		// —— 而高亮项默认就是「当前选中的那一项」（activeIndex 回退到
		// currentVisibleIndex）。用户看到的是「有一行划过没反应」，
		// 由于选中项恰好在某个服务商分组里，看起来就像「某个厂商不一样」。
		//
		// 修法：两者用**可区分的强度**——
		//   · :hover   = 瞬时反馈，浅一档；
		//   · pg-active = 持久高亮（键盘/鼠标当前项），深一档。
		// 这样「已经高亮的行」被划过时仍会再加深一点，反馈始终存在。
		//
		// 强度用**不透明**色阶叠出来（不能混 transparent —— 那会得到半透明色，
		// 半透明色叠在半透明浮层上，下方文字会透出来，观感是「越往下越浅」）。
		//   hover   = solid 底色与浮层底色各半（比满档浅，但不透明）
		//   active  = solid 底色 100%
		//   active+hover = solid 底色向「更深一阶」偏 18%（保证划过必有变化）
		const PG_OVERLAY_BG = 'var(--dsw-alias-bg-overlay, #ffffff)';
		const PG_HOVER_BG = 'var(--dsw-alias-interactive-bg-hover-solid, rgba(128,128,128,0.14))';
		// ⚠️ 注意 color-mix 的两个颜色都必须**不透明**。混 transparent 得到的是
		// alpha < 1 的颜色 —— 在浮层里会被下面的面板内容透上来（实测反馈「越往下越浅」）。
		const PG_HOVER_BG_SOFT = 'color-mix(in srgb, ' + PG_HOVER_BG + ' 55%, ' + PG_OVERLAY_BG + ')';
		const PG_HOVER_CSS = [
			// 基础透明：让 hover 规则有东西可覆盖（也保证未 hover 时无底色）。
			'.pg-hoverable { background: transparent; }',
			// 鼠标划过 / 键盘聚焦：**浅一档**的瞬时反馈（不透明）。
			'.pg-hoverable:hover:not(:disabled), .pg-hoverable:focus-visible:not(:disabled) { background: ' + PG_HOVER_BG_SOFT + '; }',
			// 键盘/鼠标高亮项（官方 optionActive）：**满档**的持久高亮（不透明）。
			// 由 JS 的 activeModelIndex 驱动（↑↓ 与 mousemove 都改它），不是 :hover。
			// 它比 :hover 深，故「已高亮的行」被划过时仍能看出变化（见坑③）。
			'.pg-hoverable.pg-active:not(:disabled) { background: ' + PG_HOVER_BG + '; }',
			// 已高亮项被划过：再深一档，保证「划过必有变化」。
			// 混的是「文字弱化色」（不透明），不是 transparent —— 理由同上。
			'.pg-hoverable.pg-active:hover:not(:disabled) { background: color-mix(in srgb, ' + PG_HOVER_BG + ' 84%, var(--dsw-alias-label-tertiary, #8b949e)); }',
			// 选中项**不**加底色（官方 .selected { background: 0 0 }）：选中态由右侧的 ✓ 表达，
			// 再加底色会与 hover 混淆。基础透明规则已经覆盖它，**不要**再加一条
			// `.pg-selected:not(:hover):not(.pg-active)` 的兜底 —— 那条的特异性 (0,4,0)
			// 高于 `:focus-visible` 的 (0,3,0)，会把键盘聚焦到选中行时的焦点底色抹成透明，
			// 而 optionStyle 的 outline:'none' 不提供焦点环，焦点行因此没有任何视觉指示。
		].join(' ')
		const PG_EXC_CSS = [
			// 内容区：允许收缩，否则长模式会把右侧控件挤出容器（flex 项默认 min-width:auto）。
			// **允许换行**（wrap）：内容区里有「模式 + 原因/备注」两样，窄屏下让它们各占一行
			// 比把模式截断好 —— 截断的 glob 是读不出含义的（实测反馈「例外过长就看不到了」）。
			'.pg-exc-main { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1 1 auto; flex-wrap: wrap; }',
			// 模式：**不伸展**（`flex: 0 1 auto`），于是紧跟其后的原因/备注就贴在它右边 ——
			// 与快捷工具行「工具名 + 说明紧挨着」同一个排法（`quickRow` 里那对 span）。
			//
			// 曾经写 `flex: 1 1 auto`：模式会**吃掉整行剩余宽度**，把原因推到最右边，
			// 中间留一大片空白（实测反馈「多出一大片空间」）。伸展在这里没有任何好处 ——
			// 模式不需要占满，它只需要完整显示。
			//
			// `min-width: 180px` 保留：拿不到这个宽度时它会连同原因一起换到下一行，
			// 这是「长例外要看得见」的保证（宁可多占一行，也不能把
			// `git rev-parse HEAD` 显示成 `git rev-p...`）。
			// word-break: break-all 让超长无空格的 glob（路径）也能断行而不是撑破容器。
			'.pg-exc-pat { font-family: ui-monospace, Consolas, monospace; font-size: 12px; flex: 0 1 auto; min-width: 180px; word-break: break-all; }',
			// 控件区：margin-left:auto 把它顶到行尾（等价于 grid 的 auto 第三列）
			'.pg-exc-ctl { display: flex; align-items: center; gap: 6px; margin-left: auto; flex: 0 0 auto; }',
			'.pg-exc-dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; box-shadow: inset 0 0 0 1px rgba(0,0,0,0.18); }',
			// 编辑态（只改模式）：输入框吃掉剩余宽度。
			'.pg-exc-edit { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1 1 auto; }',
			'.pg-exc-edit > input:first-child { flex: 1 1 auto; min-width: 90px; font-family: ui-monospace, Consolas, monospace; font-size: 12px; }',
		].join(' ');


		// 爆炸半径的档位 → 图标 / 配色 / 文案键。**模块级单点**：审批弹窗的警告条与设置面板的
		// 例外列表标注共用同一份 —— 各写一份的话，两处的配色与措辞迟早分叉，而用户看到的
		// 是「同一个东西在两个地方长得不一样」。
		// 配色分两级：盘根与系统目录是「删了就没了」用错误红，家目录与工作区外是「不该动」用警告橙。
		// 全用红色等于没有分级，而这两档的后果确实差一个量级。
		const BLAST_LEVELS = {
			'drive-root': { icon: '⛔', color: '#c62828', key: 'app.blast.driveRoot' },
			// broad：例外的目标是不限定的顶层通配（`rm -rf *`）—— 它匹配得到盘根，
			// 但匹配范围由用户写的模式决定，说不清是哪一个具体路径。与 drive-root 同级配色：
			// 一条 `rm -rf *`=allow 实测能放行 `rm -rf /`，后果不比删盘根轻。
			broad: { icon: '⛔', color: '#c62828', key: 'app.blast.broad' },
			system: { icon: '⛔', color: '#c62828', key: 'app.blast.system' },
			// workspace-root：目标就是**本项目根目录**（`rm -rf .` / `rm -rf *`）。
			// 用错误红而不是警告橙：删掉的是整个项目，与「系统目录」同量级的不可逆损失。
			// 它与 drive-root 必须分开显示 —— 用户看到「目标是一整个盘」会以为命令写错了，
			// 而实际是 `rm -rf .` 在当前目录跑偏；两者后果差一个量级，文案不能混。
			'workspace-root': { icon: '⛔', color: '#c62828', key: 'app.blast.workspaceRoot' },
			// unknown：目标**读不出**（`rm -rf $TARGET`、`diskpart` 裸跑、`set-executionpolicy`）。
			// 用错误红：读不出后果的操作与「已知是盘根」在决策上是同一类 —— 都不能默认放行。
			// 它排在这里而不是「按最轻处理」，正是 fail-closed 的体现。
			unknown: { icon: '⛔', color: '#c62828', key: 'app.blast.unknown' },
			home: { icon: '⚠', color: '#e65100', key: 'app.blast.home' },
			outside: { icon: '⚠', color: '#e65100', key: 'app.blast.outside' },
		};

		const DIFF_CSS = '.pg-link { display: inline-flex; align-items: center; gap: 4px; background: var(--dsw-alias-bg-layer-1, #f0f2f5); color: var(--dsw-alias-label-primary, #24292f); border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.45)); border-radius: 6px; padding: 3px 12px; cursor: pointer; font-size: 12px; font-weight: 500; margin-bottom: 6px; } .pg-link:hover { border-color: #1f6feb; color: #1f6feb; }';

		// dsh-file-review 风格 unified diff + 右侧对比抽屉（浅/深色主题 token 跟随）
		const DIFF2_CSS = '.pg2-block { position: relative; margin-top: 6px; margin-bottom: 8px; border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.3)); border-radius: 8px; overflow: hidden; background: var(--dsw-alias-bg-layer-1, rgba(0,0,0,0.03)); } .pg2-header { display: flex; align-items: center; gap: 8px; min-height: 32px; padding: 0 8px; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.2)); font-family: ui-monospace, Consolas, monospace; font-size: 11px; } .pg2-status { color: var(--dsw-alias-state-success-primary, #1a7f37); font-weight: 700; } .pg2-status-read { color: var(--dsw-alias-brand-primary, #1f6feb); font-weight: 700; } .pg2-path { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; color: inherit; } .pg2-path:hover { color: var(--dsw-alias-brand-primary, #1f6feb); text-decoration: underline; } .pg2-added { margin-left: auto; color: var(--dsw-alias-state-success-primary, #1a7f37); } .pg2-enc { margin-left: 6px; padding: 0 5px; border-radius: 3px; font-size: 11px; color: var(--dsw-alias-label-secondary, #57606a); border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.4)); white-space: nowrap; } .pg2-removed { color: var(--dsw-alias-state-error-primary, #cf222e); } .pg2-copy { border: 0; background: transparent; color: var(--dsw-alias-label-secondary, #57606a); cursor: pointer; font-size: 11px; font-family: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; padding: 0 2px; margin-left: 6px; flex: 0 0 auto; } .pg2-copy:hover { color: var(--dsw-alias-brand-primary, #1f6feb); } .pg2-body { overflow: auto; max-height: 240px; font-family: ui-monospace, Consolas, monospace; font-size: 11px; line-height: 1.5; } .pg2-row { display: grid; grid-template-columns: 40px 40px 22px minmax(max-content, 1fr); min-width: max-content; white-space: pre; } .pg2-old, .pg2-new { padding: 0 6px; border-right: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.2)); color: var(--dsw-alias-label-tertiary, #8c959f); text-align: right; user-select: none; } .pg2-sign { text-align: center; user-select: none; } .pg2-text { padding-right: 12px; } .pg2-del { color: var(--dsw-alias-state-error-primary, #cf222e); background: rgba(207, 34, 46, 0.10); } .pg2-add { color: var(--dsw-alias-state-success-primary, #1a7f37); background: rgba(26, 127, 55, 0.10); } .pg2-ctx { color: var(--dsw-alias-label-primary, #24292f); } .pg2-gap { display: block; width: 100%; border: 0; border-top: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.2)); border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.2)); background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.07)); color: var(--dsw-alias-label-secondary, #57606a); cursor: pointer; font-size: 11px; font-family: ui-monospace, Consolas, monospace; text-align: left; padding: 4px 8px 4px 104px; } .pg2-gap:hover { color: var(--dsw-alias-label-primary, #24292f); } .pg2-gap-more { padding: 4px 8px 4px 104px; color: var(--dsw-alias-label-secondary, #57606a); font-size: 11px; font-family: ui-monospace, Consolas, monospace; } .pg2-fadd { color: #2e7d32; } .pg2-fdel { color: #c62828; } .pg2-fctx { color: rgba(128,128,128,0.7); } .pg2-foot { padding: 4px 8px; border-top: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.2)); font-size: 11px; color: rgba(128,128,128,0.8); } .pg2-rrow { display: grid; grid-template-columns: 40px minmax(max-content, 1fr); min-width: max-content; white-space: pre; } .pg2-rnum { padding: 0 6px; border-right: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.2)); color: var(--dsw-alias-label-tertiary, #8c959f); text-align: right; user-select: none; } .pg2-load { padding: 10px 12px; font-size: 12px; color: var(--dsw-alias-label-secondary, #57606a); } .pg2-err { padding: 10px 12px; font-size: 12px; color: var(--dsw-alias-state-error-primary, #cf222e); } .pg-path-link { color: var(--dsw-alias-brand-primary, #1f6feb); cursor: pointer; word-break: break-all; flex: 1; } .pg-path-link:hover { text-decoration: underline; } .pg2-drawer { position: fixed; top: 0; right: 0; bottom: 0; left: auto; width: 42vw; min-width: 480px; max-width: 96vw; z-index: 10000; background: var(--dsw-alias-bg-overlay, #ffffff); color: var(--dsw-alias-label-primary, #24292f); border-left: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.4)); box-shadow: -8px 0 28px rgba(0,0,0,0.25); display: flex; flex-direction: column; } .pg2-drawer-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.25)); min-height: 44px; } .pg2-drawer-file { font-family: ui-monospace, Consolas, monospace; font-size: 12px; word-break: break-all; flex: 1; min-width: 0; } .pg2-drawer-close { border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.4)); background: transparent; color: var(--dsw-alias-label-secondary, #57606a); border-radius: 6px; width: 26px; height: 26px; cursor: pointer; font-size: 13px; line-height: 1; flex: 0 0 auto; } .pg2-drawer-close:hover { color: var(--dsw-alias-brand-primary, #1f6feb); border-color: var(--dsw-alias-brand-primary, #1f6feb); } .pg2-drawer-body { flex: 1; overflow: hidden; padding: 10px 12px; display: flex; flex-direction: column; min-height: 0; } .pg2-drawer-body .pg2-block { margin: 0; flex: 1; display: flex; flex-direction: column; min-height: 0; } .pg2-drawer-body .pg2-body { flex: 1; overflow: auto; max-height: none; min-height: 0; } .pg2-drawer-body .pg2-load, .pg2-drawer-body .pg2-err { flex: 1; display: flex; align-items: center; justify-content: center; } .pg2-drawer-resize { position: absolute; top: 0; bottom: 0; left: -4px; width: 8px; cursor: col-resize; z-index: 2; } .pg2-drawer-resize:hover, .pg2-drawer-resize.drag { background: rgba(31, 111, 235, 0.18); } .pg2-drawer-open { border: 1px solid var(--dsw-alias-brand-primary, #1f6feb); background: transparent; color: var(--dsw-alias-brand-primary, #1f6feb); border-radius: 6px; padding: 2px 10px; height: 26px; cursor: pointer; font-size: 12px; flex: 0 0 auto; } .pg2-drawer-open:hover { background: rgba(31, 111, 235, 0.10); } .pg2-edit-msg { font-size: 12px; color: var(--dsw-alias-label-secondary, #57606a); margin-right: 6px; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .pg2-edit-msg.err { color: var(--dsw-alias-state-error-primary, #cf222e); } .pg2-expand { border: 0; background: transparent; color: var(--dsw-alias-brand-primary, #1f6feb); cursor: pointer; font-size: 11px; font-family: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; padding: 0 2px; margin-left: 6px; flex: 0 0 auto; } .pg2-expand:hover { text-decoration: underline; } .pg2-romit { padding: 3px 8px 3px 48px; color: var(--dsw-alias-label-secondary, #57606a); font-size: 11px; font-family: ui-monospace, Consolas, monospace; font-style: italic; } .pg2-text .token.comment, .pg2-text .token.prolog, .pg2-text .token.doctype, .pg2-text .token.cdata { color: #8c959f; font-style: italic; } .pg2-text .token.punctuation { color: #57606a; } .pg2-text .token.property, .pg2-text .token.tag, .pg2-text .token.constant, .pg2-text .token.symbol, .pg2-text .token.deleted { color: #cf222e; } .pg2-text .token.boolean, .pg2-text .token.number { color: #9a6700; } .pg2-text .token.selector, .pg2-text .token.attr-name, .pg2-text .token.string, .pg2-text .token.char, .pg2-text .token.builtin, .pg2-text .token.inserted { color: #1a7f37; } .pg2-text .token.operator, .pg2-text .token.entity, .pg2-text .token.url { color: #8250df; } .pg2-text .token.atrule, .pg2-text .token.attr-value, .pg2-text .token.keyword { color: #1f6feb; } .pg2-text .token.function, .pg2-text .token.class-name { color: #8250df; } .pg2-text .token.regex, .pg2-text .token.important, .pg2-text .token.variable { color: #953800; }';

		// ── Prism 语法高亮（vendored，prismjs 1.29.0，MIT © Lea Verou，https://prismjs.com）──
		// PRISM_SRC 为 prism-core + 常用语言语法（components/prism-*.min.js）的拼接源码，
		// 由构建脚本 JSON 转义后填入下方占位符。运行时代码经过 new Function 执行（非严格模式），
		// 语言文件引用的 Prism 变量解析到同一函数作用域；CSP 等场景禁用时 PG_PRISM 为 null，
		// 高亮静默降级为纯文本，不影响其余功能。
		const PRISM_SRC = "var _self=\"undefined\"!=typeof window?window:\"undefined\"!=typeof WorkerGlobalScope\u0026\u0026self instanceof WorkerGlobalScope?self:{},Prism=function(e){var n=/(?:^|\\s)lang(?:uage)?-([\\w-]+)(?=\\s|$)/i,t=0,r={},a={manual:e.Prism\u0026\u0026e.Prism.manual,disableWorkerMessageHandler:e.Prism\u0026\u0026e.Prism.disableWorkerMessageHandler,util:{encode:function e(n){return n instanceof i?new i(n.type,e(n.content),n.alias):Array.isArray(n)?n.map(e):n.replace(/\u0026/g,\"\u0026amp;\").replace(/\u003c/g,\"\u0026lt;\").replace(/\\u00a0/g,\" \")},type:function(e){return Object.prototype.toString.call(e).slice(8,-1)},objId:function(e){return e.__id||Object.defineProperty(e,\"__id\",{value:++t}),e.__id},clone:function e(n,t){var r,i;switch(t=t||{},a.util.type(n)){case\"Object\":if(i=a.util.objId(n),t[i])return t[i];for(var l in r={},t[i]=r,n)n.hasOwnProperty(l)\u0026\u0026(r[l]=e(n[l],t));return r;case\"Array\":return i=a.util.objId(n),t[i]?t[i]:(r=[],t[i]=r,n.forEach((function(n,a){r[a]=e(n,t)})),r);default:return n}},getLanguage:function(e){for(;e;){var t=n.exec(e.className);if(t)return t[1].toLowerCase();e=e.parentElement}return\"none\"},setLanguage:function(e,t){e.className=e.className.replace(RegExp(n,\"gi\"),\"\"),e.classList.add(\"language-\"+t)},currentScript:function(){if(\"undefined\"==typeof document)return null;if(\"currentScript\"in document)return document.currentScript;try{throw new Error}catch(r){var e=(/at [^(\\r\\n]*\\((.*):[^:]+:[^:]+\\)$/i.exec(r.stack)||[])[1];if(e){var n=document.getElementsByTagName(\"script\");for(var t in n)if(n[t].src==e)return n[t]}return null}},isActive:function(e,n,t){for(var r=\"no-\"+n;e;){var a=e.classList;if(a.contains(n))return!0;if(a.contains(r))return!1;e=e.parentElement}return!!t}},languages:{plain:r,plaintext:r,text:r,txt:r,extend:function(e,n){var t=a.util.clone(a.languages[e]);for(var r in n)t[r]=n[r];return t},insertBefore:function(e,n,t,r){var i=(r=r||a.languages)[e],l={};for(var o in i)if(i.hasOwnProperty(o)){if(o==n)for(var s in t)t.hasOwnProperty(s)\u0026\u0026(l[s]=t[s]);t.hasOwnProperty(o)||(l[o]=i[o])}var u=r[e];return r[e]=l,a.languages.DFS(a.languages,(function(n,t){t===u\u0026\u0026n!=e\u0026\u0026(this[n]=l)})),l},DFS:function e(n,t,r,i){i=i||{};var l=a.util.objId;for(var o in n)if(n.hasOwnProperty(o)){t.call(n,o,n[o],r||o);var s=n[o],u=a.util.type(s);\"Object\"!==u||i[l(s)]?\"Array\"!==u||i[l(s)]||(i[l(s)]=!0,e(s,t,o,i)):(i[l(s)]=!0,e(s,t,null,i))}}},plugins:{},highlightAll:function(e,n){a.highlightAllUnder(document,e,n)},highlightAllUnder:function(e,n,t){var r={callback:t,container:e,selector:\u0027code[class*=\"language-\"], [class*=\"language-\"] code, code[class*=\"lang-\"], [class*=\"lang-\"] code\u0027};a.hooks.run(\"before-highlightall\",r),r.elements=Array.prototype.slice.apply(r.container.querySelectorAll(r.selector)),a.hooks.run(\"before-all-elements-highlight\",r);for(var i,l=0;i=r.elements[l++];)a.highlightElement(i,!0===n,r.callback)},highlightElement:function(n,t,r){var i=a.util.getLanguage(n),l=a.languages[i];a.util.setLanguage(n,i);var o=n.parentElement;o\u0026\u0026\"pre\"===o.nodeName.toLowerCase()\u0026\u0026a.util.setLanguage(o,i);var s={element:n,language:i,grammar:l,code:n.textContent};function u(e){s.highlightedCode=e,a.hooks.run(\"before-insert\",s),s.element.innerHTML=s.highlightedCode,a.hooks.run(\"after-highlight\",s),a.hooks.run(\"complete\",s),r\u0026\u0026r.call(s.element)}if(a.hooks.run(\"before-sanity-check\",s),(o=s.element.parentElement)\u0026\u0026\"pre\"===o.nodeName.toLowerCase()\u0026\u0026!o.hasAttribute(\"tabindex\")\u0026\u0026o.setAttribute(\"tabindex\",\"0\"),!s.code)return a.hooks.run(\"complete\",s),void(r\u0026\u0026r.call(s.element));if(a.hooks.run(\"before-highlight\",s),s.grammar)if(t\u0026\u0026e.Worker){var c=new Worker(a.filename);c.onmessage=function(e){u(e.data)},c.postMessage(JSON.stringify({language:s.language,code:s.code,immediateClose:!0}))}else u(a.highlight(s.code,s.grammar,s.language));else u(a.util.encode(s.code))},highlight:function(e,n,t){var r={code:e,grammar:n,language:t};if(a.hooks.run(\"before-tokenize\",r),!r.grammar)throw new Error(\u0027The language \"\u0027+r.language+\u0027\" has no grammar.\u0027);return r.tokens=a.tokenize(r.code,r.grammar),a.hooks.run(\"after-tokenize\",r),i.stringify(a.util.encode(r.tokens),r.language)},tokenize:function(e,n){var t=n.rest;if(t){for(var r in t)n[r]=t[r];delete n.rest}var a=new s;return u(a,a.head,e),o(e,a,n,a.head,0),function(e){for(var n=[],t=e.head.next;t!==e.tail;)n.push(t.value),t=t.next;return n}(a)},hooks:{all:{},add:function(e,n){var t=a.hooks.all;t[e]=t[e]||[],t[e].push(n)},run:function(e,n){var t=a.hooks.all[e];if(t\u0026\u0026t.length)for(var r,i=0;r=t[i++];)r(n)}},Token:i};function i(e,n,t,r){this.type=e,this.content=n,this.alias=t,this.length=0|(r||\"\").length}function l(e,n,t,r){e.lastIndex=n;var a=e.exec(t);if(a\u0026\u0026r\u0026\u0026a[1]){var i=a[1].length;a.index+=i,a[0]=a[0].slice(i)}return a}function o(e,n,t,r,s,g){for(var f in t)if(t.hasOwnProperty(f)\u0026\u0026t[f]){var h=t[f];h=Array.isArray(h)?h:[h];for(var d=0;d\u003ch.length;++d){if(g\u0026\u0026g.cause==f+\",\"+d)return;var v=h[d],p=v.inside,m=!!v.lookbehind,y=!!v.greedy,k=v.alias;if(y\u0026\u0026!v.pattern.global){var x=v.pattern.toString().match(/[imsuy]*$/)[0];v.pattern=RegExp(v.pattern.source,x+\"g\")}for(var b=v.pattern||v,w=r.next,A=s;w!==n.tail\u0026\u0026!(g\u0026\u0026A\u003e=g.reach);A+=w.value.length,w=w.next){var E=w.value;if(n.length\u003ee.length)return;if(!(E instanceof i)){var P,L=1;if(y){if(!(P=l(b,A,e,m))||P.index\u003e=e.length)break;var S=P.index,O=P.index+P[0].length,j=A;for(j+=w.value.length;S\u003e=j;)j+=(w=w.next).value.length;if(A=j-=w.value.length,w.value instanceof i)continue;for(var C=w;C!==n.tail\u0026\u0026(j\u003cO||\"string\"==typeof C.value);C=C.next)L++,j+=C.value.length;L--,E=e.slice(A,j),P.index-=A}else if(!(P=l(b,0,E,m)))continue;S=P.index;var N=P[0],_=E.slice(0,S),M=E.slice(S+N.length),W=A+E.length;g\u0026\u0026W\u003eg.reach\u0026\u0026(g.reach=W);var z=w.prev;if(_\u0026\u0026(z=u(n,z,_),A+=_.length),c(n,z,L),w=u(n,z,new i(f,p?a.tokenize(N,p):N,k,N)),M\u0026\u0026u(n,w,M),L\u003e1){var I={cause:f+\",\"+d,reach:W};o(e,n,t,w.prev,A,I),g\u0026\u0026I.reach\u003eg.reach\u0026\u0026(g.reach=I.reach)}}}}}}function s(){var e={value:null,prev:null,next:null},n={value:null,prev:e,next:null};e.next=n,this.head=e,this.tail=n,this.length=0}function u(e,n,t){var r=n.next,a={value:t,prev:n,next:r};return n.next=a,r.prev=a,e.length++,a}function c(e,n,t){for(var r=n.next,a=0;a\u003ct\u0026\u0026r!==e.tail;a++)r=r.next;n.next=r,r.prev=n,e.length-=a}if(e.Prism=a,i.stringify=function e(n,t){if(\"string\"==typeof n)return n;if(Array.isArray(n)){var r=\"\";return n.forEach((function(n){r+=e(n,t)})),r}var i={type:n.type,content:e(n.content,t),tag:\"span\",classes:[\"token\",n.type],attributes:{},language:t},l=n.alias;l\u0026\u0026(Array.isArray(l)?Array.prototype.push.apply(i.classes,l):i.classes.push(l)),a.hooks.run(\"wrap\",i);var o=\"\";for(var s in i.attributes)o+=\" \"+s+\u0027=\"\u0027+(i.attributes[s]||\"\").replace(/\"/g,\"\u0026quot;\")+\u0027\"\u0027;return\"\u003c\"+i.tag+\u0027 class=\"\u0027+i.classes.join(\" \")+\u0027\"\u0027+o+\"\u003e\"+i.content+\"\u003c/\"+i.tag+\"\u003e\"},!e.document)return e.addEventListener?(a.disableWorkerMessageHandler||e.addEventListener(\"message\",(function(n){var t=JSON.parse(n.data),r=t.language,i=t.code,l=t.immediateClose;e.postMessage(a.highlight(i,a.languages[r],r)),l\u0026\u0026e.close()}),!1),a):a;var g=a.util.currentScript();function f(){a.manual||a.highlightAll()}if(g\u0026\u0026(a.filename=g.src,g.hasAttribute(\"data-manual\")\u0026\u0026(a.manual=!0)),!a.manual){var h=document.readyState;\"loading\"===h||\"interactive\"===h\u0026\u0026g\u0026\u0026g.defer?document.addEventListener(\"DOMContentLoaded\",f):window.requestAnimationFrame?window.requestAnimationFrame(f):window.setTimeout(f,16)}return a}(_self);\"undefined\"!=typeof module\u0026\u0026module.exports\u0026\u0026(module.exports=Prism),\"undefined\"!=typeof global\u0026\u0026(global.Prism=Prism);\nPrism.languages.markup={comment:{pattern:/\u003c!--(?:(?!\u003c!--)[\\s\\S])*?--\u003e/,greedy:!0},prolog:{pattern:/\u003c\\?[\\s\\S]+?\\?\u003e/,greedy:!0},doctype:{pattern:/\u003c!DOCTYPE(?:[^\u003e\"\u0027[\\]]|\"[^\"]*\"|\u0027[^\u0027]*\u0027)+(?:\\[(?:[^\u003c\"\u0027\\]]|\"[^\"]*\"|\u0027[^\u0027]*\u0027|\u003c(?!!--)|\u003c!--(?:[^-]|-(?!-\u003e))*--\u003e)*\\]\\s*)?\u003e/i,greedy:!0,inside:{\"internal-subset\":{pattern:/(^[^\\[]*\\[)[\\s\\S]+(?=\\]\u003e$)/,lookbehind:!0,greedy:!0,inside:null},string:{pattern:/\"[^\"]*\"|\u0027[^\u0027]*\u0027/,greedy:!0},punctuation:/^\u003c!|\u003e$|[[\\]]/,\"doctype-tag\":/^DOCTYPE/i,name:/[^\\s\u003c\u003e\u0027\"]+/}},cdata:{pattern:/\u003c!\\[CDATA\\[[\\s\\S]*?\\]\\]\u003e/i,greedy:!0},tag:{pattern:/\u003c\\/?(?!\\d)[^\\s\u003e\\/=$\u003c%]+(?:\\s(?:\\s*[^\\s\u003e\\/=]+(?:\\s*=\\s*(?:\"[^\"]*\"|\u0027[^\u0027]*\u0027|[^\\s\u0027\"\u003e=]+(?=[\\s\u003e]))|(?=[\\s/\u003e])))+)?\\s*\\/?\u003e/,greedy:!0,inside:{tag:{pattern:/^\u003c\\/?[^\\s\u003e\\/]+/,inside:{punctuation:/^\u003c\\/?/,namespace:/^[^\\s\u003e\\/:]+:/}},\"special-attr\":[],\"attr-value\":{pattern:/=\\s*(?:\"[^\"]*\"|\u0027[^\u0027]*\u0027|[^\\s\u0027\"\u003e=]+)/,inside:{punctuation:[{pattern:/^=/,alias:\"attr-equals\"},{pattern:/^(\\s*)[\"\u0027]|[\"\u0027]$/,lookbehind:!0}]}},punctuation:/\\/?\u003e/,\"attr-name\":{pattern:/[^\\s\u003e\\/]+/,inside:{namespace:/^[^\\s\u003e\\/:]+:/}}}},entity:[{pattern:/\u0026[\\da-z]{1,8};/i,alias:\"named-entity\"},/\u0026#x?[\\da-f]{1,8};/i]},Prism.languages.markup.tag.inside[\"attr-value\"].inside.entity=Prism.languages.markup.entity,Prism.languages.markup.doctype.inside[\"internal-subset\"].inside=Prism.languages.markup,Prism.hooks.add(\"wrap\",(function(a){\"entity\"===a.type\u0026\u0026(a.attributes.title=a.content.replace(/\u0026amp;/,\"\u0026\"))})),Object.defineProperty(Prism.languages.markup.tag,\"addInlined\",{value:function(a,e){var s={};s[\"language-\"+e]={pattern:/(^\u003c!\\[CDATA\\[)[\\s\\S]+?(?=\\]\\]\u003e$)/i,lookbehind:!0,inside:Prism.languages[e]},s.cdata=/^\u003c!\\[CDATA\\[|\\]\\]\u003e$/i;var t={\"included-cdata\":{pattern:/\u003c!\\[CDATA\\[[\\s\\S]*?\\]\\]\u003e/i,inside:s}};t[\"language-\"+e]={pattern:/[\\s\\S]+/,inside:Prism.languages[e]};var n={};n[a]={pattern:RegExp(\"(\u003c__[^\u003e]*\u003e)(?:\u003c!\\\\[CDATA\\\\[(?:[^\\\\]]|\\\\](?!\\\\]\u003e))*\\\\]\\\\]\u003e|(?!\u003c!\\\\[CDATA\\\\[)[^])*?(?=\u003c/__\u003e)\".replace(/__/g,(function(){return a})),\"i\"),lookbehind:!0,greedy:!0,inside:t},Prism.languages.insertBefore(\"markup\",\"cdata\",n)}}),Object.defineProperty(Prism.languages.markup.tag,\"addAttribute\",{value:function(a,e){Prism.languages.markup.tag.inside[\"special-attr\"].push({pattern:RegExp(\"(^|[\\\"\u0027\\\\s])(?:\"+a+\")\\\\s*=\\\\s*(?:\\\"[^\\\"]*\\\"|\u0027[^\u0027]*\u0027|[^\\\\s\u0027\\\"\u003e=]+(?=[\\\\s\u003e]))\",\"i\"),lookbehind:!0,inside:{\"attr-name\":/^[^\\s=]+/,\"attr-value\":{pattern:/=[\\s\\S]+/,inside:{value:{pattern:/(^=\\s*([\"\u0027]|(?![\"\u0027])))\\S[\\s\\S]*(?=\\2$)/,lookbehind:!0,alias:[e,\"language-\"+e],inside:Prism.languages[e]},punctuation:[{pattern:/^=/,alias:\"attr-equals\"},/\"|\u0027/]}}}})}}),Prism.languages.html=Prism.languages.markup,Prism.languages.mathml=Prism.languages.markup,Prism.languages.svg=Prism.languages.markup,Prism.languages.xml=Prism.languages.extend(\"markup\",{}),Prism.languages.ssml=Prism.languages.xml,Prism.languages.atom=Prism.languages.xml,Prism.languages.rss=Prism.languages.xml;\n!function(s){var e=/(?:\"(?:\\\\(?:\\r\\n|[\\s\\S])|[^\"\\\\\\r\\n])*\"|\u0027(?:\\\\(?:\\r\\n|[\\s\\S])|[^\u0027\\\\\\r\\n])*\u0027)/;s.languages.css={comment:/\\/\\*[\\s\\S]*?\\*\\//,atrule:{pattern:RegExp(\"@[\\\\w-](?:[^;{\\\\s\\\"\u0027]|\\\\s+(?!\\\\s)|\"+e.source+\")*?(?:;|(?=\\\\s*\\\\{))\"),inside:{rule:/^@[\\w-]+/,\"selector-function-argument\":{pattern:/(\\bselector\\s*\\(\\s*(?![\\s)]))(?:[^()\\s]|\\s+(?![\\s)])|\\((?:[^()]|\\([^()]*\\))*\\))+(?=\\s*\\))/,lookbehind:!0,alias:\"selector\"},keyword:{pattern:/(^|[^\\w-])(?:and|not|only|or)(?![\\w-])/,lookbehind:!0}}},url:{pattern:RegExp(\"\\\\burl\\\\((?:\"+e.source+\"|(?:[^\\\\\\\\\\r\\n()\\\"\u0027]|\\\\\\\\[^])*)\\\\)\",\"i\"),greedy:!0,inside:{function:/^url/i,punctuation:/^\\(|\\)$/,string:{pattern:RegExp(\"^\"+e.source+\"$\"),alias:\"url\"}}},selector:{pattern:RegExp(\"(^|[{}\\\\s])[^{}\\\\s](?:[^{};\\\"\u0027\\\\s]|\\\\s+(?![\\\\s{])|\"+e.source+\")*(?=\\\\s*\\\\{)\"),lookbehind:!0},string:{pattern:e,greedy:!0},property:{pattern:/(^|[^-\\w\\xA0-\\uFFFF])(?!\\s)[-_a-z\\xA0-\\uFFFF](?:(?!\\s)[-\\w\\xA0-\\uFFFF])*(?=\\s*:)/i,lookbehind:!0},important:/!important\\b/i,function:{pattern:/(^|[^-a-z0-9])[-a-z0-9]+(?=\\()/i,lookbehind:!0},punctuation:/[(){};:,]/},s.languages.css.atrule.inside.rest=s.languages.css;var t=s.languages.markup;t\u0026\u0026(t.tag.addInlined(\"style\",\"css\"),t.tag.addAttribute(\"style\",\"css\"))}(Prism);\nPrism.languages.clike={comment:[{pattern:/(^|[^\\\\])\\/\\*[\\s\\S]*?(?:\\*\\/|$)/,lookbehind:!0,greedy:!0},{pattern:/(^|[^\\\\:])\\/\\/.*/,lookbehind:!0,greedy:!0}],string:{pattern:/([\"\u0027])(?:\\\\(?:\\r\\n|[\\s\\S])|(?!\\1)[^\\\\\\r\\n])*\\1/,greedy:!0},\"class-name\":{pattern:/(\\b(?:class|extends|implements|instanceof|interface|new|trait)\\s+|\\bcatch\\s+\\()[\\w.\\\\]+/i,lookbehind:!0,inside:{punctuation:/[.\\\\]/}},keyword:/\\b(?:break|catch|continue|do|else|finally|for|function|if|in|instanceof|new|null|return|throw|try|while)\\b/,boolean:/\\b(?:false|true)\\b/,function:/\\b\\w+(?=\\()/,number:/\\b0x[\\da-f]+\\b|(?:\\b\\d+(?:\\.\\d*)?|\\B\\.\\d+)(?:e[+-]?\\d+)?/i,operator:/[\u003c\u003e]=?|[!=]=?=?|--?|\\+\\+?|\u0026\u0026?|\\|\\|?|[?*/~^%]/,punctuation:/[{}[\\];(),.:]/};\nPrism.languages.javascript=Prism.languages.extend(\"clike\",{\"class-name\":[Prism.languages.clike[\"class-name\"],{pattern:/(^|[^$\\w\\xA0-\\uFFFF])(?!\\s)[_$A-Z\\xA0-\\uFFFF](?:(?!\\s)[$\\w\\xA0-\\uFFFF])*(?=\\.(?:constructor|prototype))/,lookbehind:!0}],keyword:[{pattern:/((?:^|\\})\\s*)catch\\b/,lookbehind:!0},{pattern:/(^|[^.]|\\.\\.\\.\\s*)\\b(?:as|assert(?=\\s*\\{)|async(?=\\s*(?:function\\b|\\(|[$\\w\\xA0-\\uFFFF]|$))|await|break|case|class|const|continue|debugger|default|delete|do|else|enum|export|extends|finally(?=\\s*(?:\\{|$))|for|from(?=\\s*(?:[\u0027\"]|$))|function|(?:get|set)(?=\\s*(?:[#\\[$\\w\\xA0-\\uFFFF]|$))|if|implements|import|in|instanceof|interface|let|new|null|of|package|private|protected|public|return|static|super|switch|this|throw|try|typeof|undefined|var|void|while|with|yield)\\b/,lookbehind:!0}],function:/#?(?!\\s)[_$a-zA-Z\\xA0-\\uFFFF](?:(?!\\s)[$\\w\\xA0-\\uFFFF])*(?=\\s*(?:\\.\\s*(?:apply|bind|call)\\s*)?\\()/,number:{pattern:RegExp(\"(^|[^\\\\w$])(?:NaN|Infinity|0[bB][01]+(?:_[01]+)*n?|0[oO][0-7]+(?:_[0-7]+)*n?|0[xX][\\\\dA-Fa-f]+(?:_[\\\\dA-Fa-f]+)*n?|\\\\d+(?:_\\\\d+)*n|(?:\\\\d+(?:_\\\\d+)*(?:\\\\.(?:\\\\d+(?:_\\\\d+)*)?)?|\\\\.\\\\d+(?:_\\\\d+)*)(?:[Ee][+-]?\\\\d+(?:_\\\\d+)*)?)(?![\\\\w$])\"),lookbehind:!0},operator:/--|\\+\\+|\\*\\*=?|=\u003e|\u0026\u0026=?|\\|\\|=?|[!=]==|\u003c\u003c=?|\u003e\u003e\u003e?=?|[-+*/%\u0026|^!=\u003c\u003e]=?|\\.{3}|\\?\\?=?|\\?\\.?|[~:]/}),Prism.languages.javascript[\"class-name\"][0].pattern=/(\\b(?:class|extends|implements|instanceof|interface|new)\\s+)[\\w.\\\\]+/,Prism.languages.insertBefore(\"javascript\",\"keyword\",{regex:{pattern:RegExp(\"((?:^|[^$\\\\w\\\\xA0-\\\\uFFFF.\\\"\u0027\\\\])\\\\s]|\\\\b(?:return|yield))\\\\s*)/(?:(?:\\\\[(?:[^\\\\]\\\\\\\\\\r\\n]|\\\\\\\\.)*\\\\]|\\\\\\\\.|[^/\\\\\\\\\\\\[\\r\\n])+/[dgimyus]{0,7}|(?:\\\\[(?:[^[\\\\]\\\\\\\\\\r\\n]|\\\\\\\\.|\\\\[(?:[^[\\\\]\\\\\\\\\\r\\n]|\\\\\\\\.|\\\\[(?:[^[\\\\]\\\\\\\\\\r\\n]|\\\\\\\\.)*\\\\])*\\\\])*\\\\]|\\\\\\\\.|[^/\\\\\\\\\\\\[\\r\\n])+/[dgimyus]{0,7}v[dgimyus]{0,7})(?=(?:\\\\s|/\\\\*(?:[^*]|\\\\*(?!/))*\\\\*/)*(?:$|[\\r\\n,.;:})\\\\]]|//))\"),lookbehind:!0,greedy:!0,inside:{\"regex-source\":{pattern:/^(\\/)[\\s\\S]+(?=\\/[a-z]*$)/,lookbehind:!0,alias:\"language-regex\",inside:Prism.languages.regex},\"regex-delimiter\":/^\\/|\\/$/,\"regex-flags\":/^[a-z]+$/}},\"function-variable\":{pattern:/#?(?!\\s)[_$a-zA-Z\\xA0-\\uFFFF](?:(?!\\s)[$\\w\\xA0-\\uFFFF])*(?=\\s*[=:]\\s*(?:async\\s*)?(?:\\bfunction\\b|(?:\\((?:[^()]|\\([^()]*\\))*\\)|(?!\\s)[_$a-zA-Z\\xA0-\\uFFFF](?:(?!\\s)[$\\w\\xA0-\\uFFFF])*)\\s*=\u003e))/,alias:\"function\"},parameter:[{pattern:/(function(?:\\s+(?!\\s)[_$a-zA-Z\\xA0-\\uFFFF](?:(?!\\s)[$\\w\\xA0-\\uFFFF])*)?\\s*\\(\\s*)(?!\\s)(?:[^()\\s]|\\s+(?![\\s)])|\\([^()]*\\))+(?=\\s*\\))/,lookbehind:!0,inside:Prism.languages.javascript},{pattern:/(^|[^$\\w\\xA0-\\uFFFF])(?!\\s)[_$a-z\\xA0-\\uFFFF](?:(?!\\s)[$\\w\\xA0-\\uFFFF])*(?=\\s*=\u003e)/i,lookbehind:!0,inside:Prism.languages.javascript},{pattern:/(\\(\\s*)(?!\\s)(?:[^()\\s]|\\s+(?![\\s)])|\\([^()]*\\))+(?=\\s*\\)\\s*=\u003e)/,lookbehind:!0,inside:Prism.languages.javascript},{pattern:/((?:\\b|\\s|^)(?!(?:as|async|await|break|case|catch|class|const|continue|debugger|default|delete|do|else|enum|export|extends|finally|for|from|function|get|if|implements|import|in|instanceof|interface|let|new|null|of|package|private|protected|public|return|set|static|super|switch|this|throw|try|typeof|undefined|var|void|while|with|yield)(?![$\\w\\xA0-\\uFFFF]))(?:(?!\\s)[_$a-zA-Z\\xA0-\\uFFFF](?:(?!\\s)[$\\w\\xA0-\\uFFFF])*\\s*)\\(\\s*|\\]\\s*\\(\\s*)(?!\\s)(?:[^()\\s]|\\s+(?![\\s)])|\\([^()]*\\))+(?=\\s*\\)\\s*\\{)/,lookbehind:!0,inside:Prism.languages.javascript}],constant:/\\b[A-Z](?:[A-Z_]|\\dx?)*\\b/}),Prism.languages.insertBefore(\"javascript\",\"string\",{hashbang:{pattern:/^#!.*/,greedy:!0,alias:\"comment\"},\"template-string\":{pattern:/`(?:\\\\[\\s\\S]|\\$\\{(?:[^{}]|\\{(?:[^{}]|\\{[^}]*\\})*\\})+\\}|(?!\\$\\{)[^\\\\`])*`/,greedy:!0,inside:{\"template-punctuation\":{pattern:/^`|`$/,alias:\"string\"},interpolation:{pattern:/((?:^|[^\\\\])(?:\\\\{2})*)\\$\\{(?:[^{}]|\\{(?:[^{}]|\\{[^}]*\\})*\\})+\\}/,lookbehind:!0,inside:{\"interpolation-punctuation\":{pattern:/^\\$\\{|\\}$/,alias:\"punctuation\"},rest:Prism.languages.javascript}},string:/[\\s\\S]+/}},\"string-property\":{pattern:/((?:^|[,{])[ \\t]*)([\"\u0027])(?:\\\\(?:\\r\\n|[\\s\\S])|(?!\\2)[^\\\\\\r\\n])*\\2(?=\\s*:)/m,lookbehind:!0,greedy:!0,alias:\"property\"}}),Prism.languages.insertBefore(\"javascript\",\"operator\",{\"literal-property\":{pattern:/((?:^|[,{])[ \\t]*)(?!\\s)[_$a-zA-Z\\xA0-\\uFFFF](?:(?!\\s)[$\\w\\xA0-\\uFFFF])*(?=\\s*:)/m,lookbehind:!0,alias:\"property\"}}),Prism.languages.markup\u0026\u0026(Prism.languages.markup.tag.addInlined(\"script\",\"javascript\"),Prism.languages.markup.tag.addAttribute(\"on(?:abort|blur|change|click|composition(?:end|start|update)|dblclick|error|focus(?:in|out)?|key(?:down|up)|load|mouse(?:down|enter|leave|move|out|over|up)|reset|resize|scroll|select|slotchange|submit|unload|wheel)\",\"javascript\")),Prism.languages.js=Prism.languages.javascript;\n!function(e){e.languages.typescript=e.languages.extend(\"javascript\",{\"class-name\":{pattern:/(\\b(?:class|extends|implements|instanceof|interface|new|type)\\s+)(?!keyof\\b)(?!\\s)[_$a-zA-Z\\xA0-\\uFFFF](?:(?!\\s)[$\\w\\xA0-\\uFFFF])*(?:\\s*\u003c(?:[^\u003c\u003e]|\u003c(?:[^\u003c\u003e]|\u003c[^\u003c\u003e]*\u003e)*\u003e)*\u003e)?/,lookbehind:!0,greedy:!0,inside:null},builtin:/\\b(?:Array|Function|Promise|any|boolean|console|never|number|string|symbol|unknown)\\b/}),e.languages.typescript.keyword.push(/\\b(?:abstract|declare|is|keyof|readonly|require)\\b/,/\\b(?:asserts|infer|interface|module|namespace|type)\\b(?=\\s*(?:[{_$a-zA-Z\\xA0-\\uFFFF]|$))/,/\\btype\\b(?=\\s*(?:[\\{*]|$))/),delete e.languages.typescript.parameter,delete e.languages.typescript[\"literal-property\"];var s=e.languages.extend(\"typescript\",{});delete s[\"class-name\"],e.languages.typescript[\"class-name\"].inside=s,e.languages.insertBefore(\"typescript\",\"function\",{decorator:{pattern:/@[$\\w\\xA0-\\uFFFF]+/,inside:{at:{pattern:/^@/,alias:\"operator\"},function:/^[\\s\\S]+/}},\"generic-function\":{pattern:/#?(?!\\s)[_$a-zA-Z\\xA0-\\uFFFF](?:(?!\\s)[$\\w\\xA0-\\uFFFF])*\\s*\u003c(?:[^\u003c\u003e]|\u003c(?:[^\u003c\u003e]|\u003c[^\u003c\u003e]*\u003e)*\u003e)*\u003e(?=\\s*\\()/,greedy:!0,inside:{function:/^#?(?!\\s)[_$a-zA-Z\\xA0-\\uFFFF](?:(?!\\s)[$\\w\\xA0-\\uFFFF])*/,generic:{pattern:/\u003c[\\s\\S]+/,alias:\"class-name\",inside:s}}}}),e.languages.ts=e.languages.typescript}(Prism);\nPrism.languages.json={property:{pattern:/(^|[^\\\\])\"(?:\\\\.|[^\\\\\"\\r\\n])*\"(?=\\s*:)/,lookbehind:!0,greedy:!0},string:{pattern:/(^|[^\\\\])\"(?:\\\\.|[^\\\\\"\\r\\n])*\"(?!\\s*:)/,lookbehind:!0,greedy:!0},comment:{pattern:/\\/\\/.*|\\/\\*[\\s\\S]*?(?:\\*\\/|$)/,greedy:!0},number:/-?\\b\\d+(?:\\.\\d+)?(?:e[+-]?\\d+)?\\b/i,punctuation:/[{}[\\],]/,operator:/:/,boolean:/\\b(?:false|true)\\b/,null:{pattern:/\\bnull\\b/,alias:\"keyword\"}},Prism.languages.webmanifest=Prism.languages.json;\n!function(e){var n=/[*\u0026][^\\s[\\]{},]+/,r=/!(?:\u003c[\\w\\-%#;/?:@\u0026=+$,.!~*\u0027()[\\]]+\u003e|(?:[a-zA-Z\\d-]*!)?[\\w\\-%#;/?:@\u0026=+$.~*\u0027()]+)?/,t=\"(?:\"+r.source+\"(?:[ \\t]+\"+n.source+\")?|\"+n.source+\"(?:[ \\t]+\"+r.source+\")?)\",a=\"(?:[^\\\\s\\\\x00-\\\\x08\\\\x0e-\\\\x1f!\\\"#%\u0026\u0027*,\\\\-:\u003e?@[\\\\]`{|}\\\\x7f-\\\\x84\\\\x86-\\\\x9f\\\\ud800-\\\\udfff\\\\ufffe\\\\uffff]|[?:-]\u003cPLAIN\u003e)(?:[ \\t]*(?:(?![#:])\u003cPLAIN\u003e|:\u003cPLAIN\u003e))*\".replace(/\u003cPLAIN\u003e/g,(function(){return\"[^\\\\s\\\\x00-\\\\x08\\\\x0e-\\\\x1f,[\\\\]{}\\\\x7f-\\\\x84\\\\x86-\\\\x9f\\\\ud800-\\\\udfff\\\\ufffe\\\\uffff]\"})),d=\"\\\"(?:[^\\\"\\\\\\\\\\r\\n]|\\\\\\\\.)*\\\"|\u0027(?:[^\u0027\\\\\\\\\\r\\n]|\\\\\\\\.)*\u0027\";function o(e,n){n=(n||\"\").replace(/m/g,\"\")+\"m\";var r=\"([:\\\\-,[{]\\\\s*(?:\\\\s\u003c\u003cprop\u003e\u003e[ \\t]+)?)(?:\u003c\u003cvalue\u003e\u003e)(?=[ \\t]*(?:$|,|\\\\]|\\\\}|(?:[\\r\\n]\\\\s*)?#))\".replace(/\u003c\u003cprop\u003e\u003e/g,(function(){return t})).replace(/\u003c\u003cvalue\u003e\u003e/g,(function(){return e}));return RegExp(r,n)}e.languages.yaml={scalar:{pattern:RegExp(\"([\\\\-:]\\\\s*(?:\\\\s\u003c\u003cprop\u003e\u003e[ \\t]+)?[|\u003e])[ \\t]*(?:((?:\\r?\\n|\\r)[ \\t]+)\\\\S[^\\r\\n]*(?:\\\\2[^\\r\\n]+)*)\".replace(/\u003c\u003cprop\u003e\u003e/g,(function(){return t}))),lookbehind:!0,alias:\"string\"},comment:/#.*/,key:{pattern:RegExp(\"((?:^|[:\\\\-,[{\\r\\n?])[ \\t]*(?:\u003c\u003cprop\u003e\u003e[ \\t]+)?)\u003c\u003ckey\u003e\u003e(?=\\\\s*:\\\\s)\".replace(/\u003c\u003cprop\u003e\u003e/g,(function(){return t})).replace(/\u003c\u003ckey\u003e\u003e/g,(function(){return\"(?:\"+a+\"|\"+d+\")\"}))),lookbehind:!0,greedy:!0,alias:\"atrule\"},directive:{pattern:/(^[ \\t]*)%.+/m,lookbehind:!0,alias:\"important\"},datetime:{pattern:o(\"\\\\d{4}-\\\\d\\\\d?-\\\\d\\\\d?(?:[tT]|[ \\t]+)\\\\d\\\\d?:\\\\d{2}:\\\\d{2}(?:\\\\.\\\\d*)?(?:[ \\t]*(?:Z|[-+]\\\\d\\\\d?(?::\\\\d{2})?))?|\\\\d{4}-\\\\d{2}-\\\\d{2}|\\\\d\\\\d?:\\\\d{2}(?::\\\\d{2}(?:\\\\.\\\\d*)?)?\"),lookbehind:!0,alias:\"number\"},boolean:{pattern:o(\"false|true\",\"i\"),lookbehind:!0,alias:\"important\"},null:{pattern:o(\"null|~\",\"i\"),lookbehind:!0,alias:\"important\"},string:{pattern:o(d),lookbehind:!0,greedy:!0},number:{pattern:o(\"[+-]?(?:0x[\\\\da-f]+|0o[0-7]+|(?:\\\\d+(?:\\\\.\\\\d*)?|\\\\.\\\\d+)(?:e[+-]?\\\\d+)?|\\\\.inf|\\\\.nan)\",\"i\"),lookbehind:!0},tag:r,important:n,punctuation:/---|[:[\\]{}\\-,|\u003e?]|\\.\\.\\./},e.languages.yml=e.languages.yaml}(Prism);\n!function(n){function e(n){return n=n.replace(/\u003cinner\u003e/g,(function(){return\"(?:\\\\\\\\.|[^\\\\\\\\\\n\\r]|(?:\\n|\\r\\n?)(?![\\r\\n]))\"})),RegExp(\"((?:^|[^\\\\\\\\])(?:\\\\\\\\{2})*)(?:\"+n+\")\")}var t=\"(?:\\\\\\\\.|``(?:[^`\\r\\n]|`(?!`))+``|`[^`\\r\\n]+`|[^\\\\\\\\|\\r\\n`])+\",a=\"\\\\|?__(?:\\\\|__)+\\\\|?(?:(?:\\n|\\r\\n?)|(?![^]))\".replace(/__/g,(function(){return t})),i=\"\\\\|?[ \\t]*:?-{3,}:?[ \\t]*(?:\\\\|[ \\t]*:?-{3,}:?[ \\t]*)+\\\\|?(?:\\n|\\r\\n?)\";n.languages.markdown=n.languages.extend(\"markup\",{}),n.languages.insertBefore(\"markdown\",\"prolog\",{\"front-matter-block\":{pattern:/(^(?:\\s*[\\r\\n])?)---(?!.)[\\s\\S]*?[\\r\\n]---(?!.)/,lookbehind:!0,greedy:!0,inside:{punctuation:/^---|---$/,\"front-matter\":{pattern:/\\S+(?:\\s+\\S+)*/,alias:[\"yaml\",\"language-yaml\"],inside:n.languages.yaml}}},blockquote:{pattern:/^\u003e(?:[\\t ]*\u003e)*/m,alias:\"punctuation\"},table:{pattern:RegExp(\"^\"+a+i+\"(?:\"+a+\")*\",\"m\"),inside:{\"table-data-rows\":{pattern:RegExp(\"^(\"+a+i+\")(?:\"+a+\")*$\"),lookbehind:!0,inside:{\"table-data\":{pattern:RegExp(t),inside:n.languages.markdown},punctuation:/\\|/}},\"table-line\":{pattern:RegExp(\"^(\"+a+\")\"+i+\"$\"),lookbehind:!0,inside:{punctuation:/\\||:?-{3,}:?/}},\"table-header-row\":{pattern:RegExp(\"^\"+a+\"$\"),inside:{\"table-header\":{pattern:RegExp(t),alias:\"important\",inside:n.languages.markdown},punctuation:/\\|/}}}},code:[{pattern:/((?:^|\\n)[ \\t]*\\n|(?:^|\\r\\n?)[ \\t]*\\r\\n?)(?: {4}|\\t).+(?:(?:\\n|\\r\\n?)(?: {4}|\\t).+)*/,lookbehind:!0,alias:\"keyword\"},{pattern:/^```[\\s\\S]*?^```$/m,greedy:!0,inside:{\"code-block\":{pattern:/^(```.*(?:\\n|\\r\\n?))[\\s\\S]+?(?=(?:\\n|\\r\\n?)^```$)/m,lookbehind:!0},\"code-language\":{pattern:/^(```).+/,lookbehind:!0},punctuation:/```/}}],title:[{pattern:/\\S.*(?:\\n|\\r\\n?)(?:==+|--+)(?=[ \\t]*$)/m,alias:\"important\",inside:{punctuation:/==+$|--+$/}},{pattern:/(^\\s*)#.+/m,lookbehind:!0,alias:\"important\",inside:{punctuation:/^#+|#+$/}}],hr:{pattern:/(^\\s*)([*-])(?:[\\t ]*\\2){2,}(?=\\s*$)/m,lookbehind:!0,alias:\"punctuation\"},list:{pattern:/(^\\s*)(?:[*+-]|\\d+\\.)(?=[\\t ].)/m,lookbehind:!0,alias:\"punctuation\"},\"url-reference\":{pattern:/!?\\[[^\\]]+\\]:[\\t ]+(?:\\S+|\u003c(?:\\\\.|[^\u003e\\\\])+\u003e)(?:[\\t ]+(?:\"(?:\\\\.|[^\"\\\\])*\"|\u0027(?:\\\\.|[^\u0027\\\\])*\u0027|\\((?:\\\\.|[^)\\\\])*\\)))?/,inside:{variable:{pattern:/^(!?\\[)[^\\]]+/,lookbehind:!0},string:/(?:\"(?:\\\\.|[^\"\\\\])*\"|\u0027(?:\\\\.|[^\u0027\\\\])*\u0027|\\((?:\\\\.|[^)\\\\])*\\))$/,punctuation:/^[\\[\\]!:]|[\u003c\u003e]/},alias:\"url\"},bold:{pattern:e(\"\\\\b__(?:(?!_)\u003cinner\u003e|_(?:(?!_)\u003cinner\u003e)+_)+__\\\\b|\\\\*\\\\*(?:(?!\\\\*)\u003cinner\u003e|\\\\*(?:(?!\\\\*)\u003cinner\u003e)+\\\\*)+\\\\*\\\\*\"),lookbehind:!0,greedy:!0,inside:{content:{pattern:/(^..)[\\s\\S]+(?=..$)/,lookbehind:!0,inside:{}},punctuation:/\\*\\*|__/}},italic:{pattern:e(\"\\\\b_(?:(?!_)\u003cinner\u003e|__(?:(?!_)\u003cinner\u003e)+__)+_\\\\b|\\\\*(?:(?!\\\\*)\u003cinner\u003e|\\\\*\\\\*(?:(?!\\\\*)\u003cinner\u003e)+\\\\*\\\\*)+\\\\*\"),lookbehind:!0,greedy:!0,inside:{content:{pattern:/(^.)[\\s\\S]+(?=.$)/,lookbehind:!0,inside:{}},punctuation:/[*_]/}},strike:{pattern:e(\"(~~?)(?:(?!~)\u003cinner\u003e)+\\\\2\"),lookbehind:!0,greedy:!0,inside:{content:{pattern:/(^~~?)[\\s\\S]+(?=\\1$)/,lookbehind:!0,inside:{}},punctuation:/~~?/}},\"code-snippet\":{pattern:/(^|[^\\\\`])(?:``[^`\\r\\n]+(?:`[^`\\r\\n]+)*``(?!`)|`[^`\\r\\n]+`(?!`))/,lookbehind:!0,greedy:!0,alias:[\"code\",\"keyword\"]},url:{pattern:e(\u0027!?\\\\[(?:(?!\\\\])\u003cinner\u003e)+\\\\](?:\\\\([^\\\\s)]+(?:[\\t ]+\"(?:\\\\\\\\.|[^\"\\\\\\\\])*\")?\\\\)|[ \\t]?\\\\[(?:(?!\\\\])\u003cinner\u003e)+\\\\])\u0027),lookbehind:!0,greedy:!0,inside:{operator:/^!/,content:{pattern:/(^\\[)[^\\]]+(?=\\])/,lookbehind:!0,inside:{}},variable:{pattern:/(^\\][ \\t]?\\[)[^\\]]+(?=\\]$)/,lookbehind:!0},url:{pattern:/(^\\]\\()[^\\s)]+/,lookbehind:!0},string:{pattern:/(^[ \\t]+)\"(?:\\\\.|[^\"\\\\])*\"(?=\\)$)/,lookbehind:!0}}}}),[\"url\",\"bold\",\"italic\",\"strike\"].forEach((function(e){[\"url\",\"bold\",\"italic\",\"strike\",\"code-snippet\"].forEach((function(t){e!==t\u0026\u0026(n.languages.markdown[e].inside.content.inside[t]=n.languages.markdown[t])}))})),n.hooks.add(\"after-tokenize\",(function(n){\"markdown\"!==n.language\u0026\u0026\"md\"!==n.language||function n(e){if(e\u0026\u0026\"string\"!=typeof e)for(var t=0,a=e.length;t\u003ca;t++){var i=e[t];if(\"code\"===i.type){var r=i.content[1],o=i.content[3];if(r\u0026\u0026o\u0026\u0026\"code-language\"===r.type\u0026\u0026\"code-block\"===o.type\u0026\u0026\"string\"==typeof r.content){var l=r.content.replace(/\\b#/g,\"sharp\").replace(/\\b\\+\\+/g,\"pp\"),s=\"language-\"+(l=(/[a-z][\\w-]*/i.exec(l)||[\"\"])[0].toLowerCase());o.alias?\"string\"==typeof o.alias?o.alias=[o.alias,s]:o.alias.push(s):o.alias=[s]}}else n(i.content)}}(n.tokens)})),n.hooks.add(\"wrap\",(function(e){if(\"code-block\"===e.type){for(var t=\"\",a=0,i=e.classes.length;a\u003ci;a++){var s=e.classes[a],d=/language-(.+)/.exec(s);if(d){t=d[1];break}}var p=n.languages[t];if(p)e.content=n.highlight(e.content.replace(r,\"\").replace(/\u0026(\\w{1,8}|#x?[\\da-f]{1,8});/gi,(function(n,e){var t;return\"#\"===(e=e.toLowerCase())[0]?(t=\"x\"===e[1]?parseInt(e.slice(2),16):Number(e.slice(1)),l(t)):o[e]||n})),p,t);else if(t\u0026\u0026\"none\"!==t\u0026\u0026n.plugins.autoloader){var u=\"md-\"+(new Date).valueOf()+\"-\"+Math.floor(1e16*Math.random());e.attributes.id=u,n.plugins.autoloader.loadLanguages(t,(function(){var e=document.getElementById(u);e\u0026\u0026(e.innerHTML=n.highlight(e.textContent,n.languages[t],t))}))}}}));var r=RegExp(n.languages.markup.tag.pattern.source,\"gi\"),o={amp:\"\u0026\",lt:\"\u003c\",gt:\"\u003e\",quot:\u0027\"\u0027},l=String.fromCodePoint||String.fromCharCode;n.languages.md=n.languages.markdown}(Prism);\n!function(e){var t=\"\\\\b(?:BASH|BASHOPTS|BASH_ALIASES|BASH_ARGC|BASH_ARGV|BASH_CMDS|BASH_COMPLETION_COMPAT_DIR|BASH_LINENO|BASH_REMATCH|BASH_SOURCE|BASH_VERSINFO|BASH_VERSION|COLORTERM|COLUMNS|COMP_WORDBREAKS|DBUS_SESSION_BUS_ADDRESS|DEFAULTS_PATH|DESKTOP_SESSION|DIRSTACK|DISPLAY|EUID|GDMSESSION|GDM_LANG|GNOME_KEYRING_CONTROL|GNOME_KEYRING_PID|GPG_AGENT_INFO|GROUPS|HISTCONTROL|HISTFILE|HISTFILESIZE|HISTSIZE|HOME|HOSTNAME|HOSTTYPE|IFS|INSTANCE|JOB|LANG|LANGUAGE|LC_ADDRESS|LC_ALL|LC_IDENTIFICATION|LC_MEASUREMENT|LC_MONETARY|LC_NAME|LC_NUMERIC|LC_PAPER|LC_TELEPHONE|LC_TIME|LESSCLOSE|LESSOPEN|LINES|LOGNAME|LS_COLORS|MACHTYPE|MAILCHECK|MANDATORY_PATH|NO_AT_BRIDGE|OLDPWD|OPTERR|OPTIND|ORBIT_SOCKETDIR|OSTYPE|PAPERSIZE|PATH|PIPESTATUS|PPID|PS1|PS2|PS3|PS4|PWD|RANDOM|REPLY|SECONDS|SELINUX_INIT|SESSION|SESSIONTYPE|SESSION_MANAGER|SHELL|SHELLOPTS|SHLVL|SSH_AUTH_SOCK|TERM|UID|UPSTART_EVENTS|UPSTART_INSTANCE|UPSTART_JOB|UPSTART_SESSION|USER|WINDOWID|XAUTHORITY|XDG_CONFIG_DIRS|XDG_CURRENT_DESKTOP|XDG_DATA_DIRS|XDG_GREETER_DATA_DIR|XDG_MENU_PREFIX|XDG_RUNTIME_DIR|XDG_SEAT|XDG_SEAT_PATH|XDG_SESSION_DESKTOP|XDG_SESSION_ID|XDG_SESSION_PATH|XDG_SESSION_TYPE|XDG_VTNR|XMODIFIERS)\\\\b\",a={pattern:/(^([\"\u0027]?)\\w+\\2)[ \\t]+\\S.*/,lookbehind:!0,alias:\"punctuation\",inside:null},n={bash:a,environment:{pattern:RegExp(\"\\\\$\"+t),alias:\"constant\"},variable:[{pattern:/\\$?\\(\\([\\s\\S]+?\\)\\)/,greedy:!0,inside:{variable:[{pattern:/(^\\$\\(\\([\\s\\S]+)\\)\\)/,lookbehind:!0},/^\\$\\(\\(/],number:/\\b0x[\\dA-Fa-f]+\\b|(?:\\b\\d+(?:\\.\\d*)?|\\B\\.\\d+)(?:[Ee]-?\\d+)?/,operator:/--|\\+\\+|\\*\\*=?|\u003c\u003c=?|\u003e\u003e=?|\u0026\u0026|\\|\\||[=!+\\-*/%\u003c\u003e^\u0026|]=?|[?~:]/,punctuation:/\\(\\(?|\\)\\)?|,|;/}},{pattern:/\\$\\((?:\\([^)]+\\)|[^()])+\\)|`[^`]+`/,greedy:!0,inside:{variable:/^\\$\\(|^`|\\)$|`$/}},{pattern:/\\$\\{[^}]+\\}/,greedy:!0,inside:{operator:/:[-=?+]?|[!\\/]|##?|%%?|\\^\\^?|,,?/,punctuation:/[\\[\\]]/,environment:{pattern:RegExp(\"(\\\\{)\"+t),lookbehind:!0,alias:\"constant\"}}},/\\$(?:\\w+|[#?*!@$])/],entity:/\\\\(?:[abceEfnrtv\\\\\"]|O?[0-7]{1,3}|U[0-9a-fA-F]{8}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{1,2})/};e.languages.bash={shebang:{pattern:/^#!\\s*\\/.*/,alias:\"important\"},comment:{pattern:/(^|[^\"{\\\\$])#.*/,lookbehind:!0},\"function-name\":[{pattern:/(\\bfunction\\s+)[\\w-]+(?=(?:\\s*\\(?:\\s*\\))?\\s*\\{)/,lookbehind:!0,alias:\"function\"},{pattern:/\\b[\\w-]+(?=\\s*\\(\\s*\\)\\s*\\{)/,alias:\"function\"}],\"for-or-select\":{pattern:/(\\b(?:for|select)\\s+)\\w+(?=\\s+in\\s)/,alias:\"variable\",lookbehind:!0},\"assign-left\":{pattern:/(^|[\\s;|\u0026]|[\u003c\u003e]\\()\\w+(?:\\.\\w+)*(?=\\+?=)/,inside:{environment:{pattern:RegExp(\"(^|[\\\\s;|\u0026]|[\u003c\u003e]\\\\()\"+t),lookbehind:!0,alias:\"constant\"}},alias:\"variable\",lookbehind:!0},parameter:{pattern:/(^|\\s)-{1,2}(?:\\w+:[+-]?)?\\w+(?:\\.\\w+)*(?=[=\\s]|$)/,alias:\"variable\",lookbehind:!0},string:[{pattern:/((?:^|[^\u003c])\u003c\u003c-?\\s*)(\\w+)\\s[\\s\\S]*?(?:\\r?\\n|\\r)\\2/,lookbehind:!0,greedy:!0,inside:n},{pattern:/((?:^|[^\u003c])\u003c\u003c-?\\s*)([\"\u0027])(\\w+)\\2\\s[\\s\\S]*?(?:\\r?\\n|\\r)\\3/,lookbehind:!0,greedy:!0,inside:{bash:a}},{pattern:/(^|[^\\\\](?:\\\\\\\\)*)\"(?:\\\\[\\s\\S]|\\$\\([^)]+\\)|\\$(?!\\()|`[^`]+`|[^\"\\\\`$])*\"/,lookbehind:!0,greedy:!0,inside:n},{pattern:/(^|[^$\\\\])\u0027[^\u0027]*\u0027/,lookbehind:!0,greedy:!0},{pattern:/\\$\u0027(?:[^\u0027\\\\]|\\\\[\\s\\S])*\u0027/,greedy:!0,inside:{entity:n.entity}}],environment:{pattern:RegExp(\"\\\\$?\"+t),alias:\"constant\"},variable:n.variable,function:{pattern:/(^|[\\s;|\u0026]|[\u003c\u003e]\\()(?:add|apropos|apt|apt-cache|apt-get|aptitude|aspell|automysqlbackup|awk|basename|bash|bc|bconsole|bg|bzip2|cal|cargo|cat|cfdisk|chgrp|chkconfig|chmod|chown|chroot|cksum|clear|cmp|column|comm|composer|cp|cron|crontab|csplit|curl|cut|date|dc|dd|ddrescue|debootstrap|df|diff|diff3|dig|dir|dircolors|dirname|dirs|dmesg|docker|docker-compose|du|egrep|eject|env|ethtool|expand|expect|expr|fdformat|fdisk|fg|fgrep|file|find|fmt|fold|format|free|fsck|ftp|fuser|gawk|git|gparted|grep|groupadd|groupdel|groupmod|groups|grub-mkconfig|gzip|halt|head|hg|history|host|hostname|htop|iconv|id|ifconfig|ifdown|ifup|import|install|ip|java|jobs|join|kill|killall|less|link|ln|locate|logname|logrotate|look|lpc|lpr|lprint|lprintd|lprintq|lprm|ls|lsof|lynx|make|man|mc|mdadm|mkconfig|mkdir|mke2fs|mkfifo|mkfs|mkisofs|mknod|mkswap|mmv|more|most|mount|mtools|mtr|mutt|mv|nano|nc|netstat|nice|nl|node|nohup|notify-send|npm|nslookup|op|open|parted|passwd|paste|pathchk|ping|pkill|pnpm|podman|podman-compose|popd|pr|printcap|printenv|ps|pushd|pv|quota|quotacheck|quotactl|ram|rar|rcp|reboot|remsync|rename|renice|rev|rm|rmdir|rpm|rsync|scp|screen|sdiff|sed|sendmail|seq|service|sftp|sh|shellcheck|shuf|shutdown|sleep|slocate|sort|split|ssh|stat|strace|su|sudo|sum|suspend|swapon|sync|sysctl|tac|tail|tar|tee|time|timeout|top|touch|tr|traceroute|tsort|tty|umount|uname|unexpand|uniq|units|unrar|unshar|unzip|update-grub|uptime|useradd|userdel|usermod|users|uudecode|uuencode|v|vcpkg|vdir|vi|vim|virsh|vmstat|wait|watch|wc|wget|whereis|which|who|whoami|write|xargs|xdg-open|yarn|yes|zenity|zip|zsh|zypper)(?=$|[)\\s;|\u0026])/,lookbehind:!0},keyword:{pattern:/(^|[\\s;|\u0026]|[\u003c\u003e]\\()(?:case|do|done|elif|else|esac|fi|for|function|if|in|select|then|until|while)(?=$|[)\\s;|\u0026])/,lookbehind:!0},builtin:{pattern:/(^|[\\s;|\u0026]|[\u003c\u003e]\\()(?:\\.|:|alias|bind|break|builtin|caller|cd|command|continue|declare|echo|enable|eval|exec|exit|export|getopts|hash|help|let|local|logout|mapfile|printf|pwd|read|readarray|readonly|return|set|shift|shopt|source|test|times|trap|type|typeset|ulimit|umask|unalias|unset)(?=$|[)\\s;|\u0026])/,lookbehind:!0,alias:\"class-name\"},boolean:{pattern:/(^|[\\s;|\u0026]|[\u003c\u003e]\\()(?:false|true)(?=$|[)\\s;|\u0026])/,lookbehind:!0},\"file-descriptor\":{pattern:/\\B\u0026\\d\\b/,alias:\"important\"},operator:{pattern:/\\d?\u003c\u003e|\u003e\\||\\+=|=[=~]?|!=?|\u003c\u003c[\u003c-]?|[\u0026\\d]?\u003e\u003e|\\d[\u003c\u003e]\u0026?|[\u003c\u003e][\u0026=]?|\u0026[\u003e\u0026]?|\\|[\u0026|]?/,inside:{\"file-descriptor\":{pattern:/^\\d/,alias:\"important\"}}},punctuation:/\\$?\\(\\(?|\\)\\)?|\\.\\.|[{}[\\];\\\\]/,number:{pattern:/(^|\\s)(?:[1-9]\\d*|0)(?:[.,]\\d+)?\\b/,lookbehind:!0}},a.inside=e.languages.bash;for(var s=[\"comment\",\"function-name\",\"for-or-select\",\"assign-left\",\"parameter\",\"string\",\"environment\",\"function\",\"keyword\",\"builtin\",\"boolean\",\"file-descriptor\",\"operator\",\"punctuation\",\"number\"],o=n.variable[1].inside,i=0;i\u003cs.length;i++)o[s[i]]=e.languages.bash[s[i]];e.languages.sh=e.languages.bash,e.languages.shell=e.languages.bash}(Prism);\n!function(e){var r=/%%?[~:\\w]+%?|!\\S+!/,t={pattern:/\\/[a-z?]+(?=[ :]|$):?|-[a-z]\\b|--[a-z-]+\\b/im,alias:\"attr-name\",inside:{punctuation:/:/}},n=/\"(?:[\\\\\"]\"|[^\"])*\"(?!\")/,i=/(?:\\b|-)\\d+\\b/;e.languages.batch={comment:[/^::.*/m,{pattern:/((?:^|[\u0026(])[ \\t]*)rem\\b(?:[^^\u0026)\\r\\n]|\\^(?:\\r\\n|[\\s\\S]))*/im,lookbehind:!0}],label:{pattern:/^:.*/m,alias:\"property\"},command:[{pattern:/((?:^|[\u0026(])[ \\t]*)for(?: \\/[a-z?](?:[ :](?:\"[^\"]*\"|[^\\s\"/]\\S*))?)* \\S+ in \\([^)]+\\) do/im,lookbehind:!0,inside:{keyword:/\\b(?:do|in)\\b|^for\\b/i,string:n,parameter:t,variable:r,number:i,punctuation:/[()\u0027,]/}},{pattern:/((?:^|[\u0026(])[ \\t]*)if(?: \\/[a-z?](?:[ :](?:\"[^\"]*\"|[^\\s\"/]\\S*))?)* (?:not )?(?:cmdextversion \\d+|defined \\w+|errorlevel \\d+|exist \\S+|(?:\"[^\"]*\"|(?!\")(?:(?!==)\\S)+)?(?:==| (?:equ|geq|gtr|leq|lss|neq) )(?:\"[^\"]*\"|[^\\s\"]\\S*))/im,lookbehind:!0,inside:{keyword:/\\b(?:cmdextversion|defined|errorlevel|exist|not)\\b|^if\\b/i,string:n,parameter:t,variable:r,number:i,operator:/\\^|==|\\b(?:equ|geq|gtr|leq|lss|neq)\\b/i}},{pattern:/((?:^|[\u0026()])[ \\t]*)else\\b/im,lookbehind:!0,inside:{keyword:/^else\\b/i}},{pattern:/((?:^|[\u0026(])[ \\t]*)set(?: \\/[a-z](?:[ :](?:\"[^\"]*\"|[^\\s\"/]\\S*))?)* (?:[^^\u0026)\\r\\n]|\\^(?:\\r\\n|[\\s\\S]))*/im,lookbehind:!0,inside:{keyword:/^set\\b/i,string:n,parameter:t,variable:[r,/\\w+(?=(?:[*\\/%+\\-\u0026^|]|\u003c\u003c|\u003e\u003e)?=)/],number:i,operator:/[*\\/%+\\-\u0026^|]=?|\u003c\u003c=?|\u003e\u003e=?|[!~_=]/,punctuation:/[()\u0027,]/}},{pattern:/((?:^|[\u0026(])[ \\t]*@?)\\w+\\b(?:\"(?:[\\\\\"]\"|[^\"])*\"(?!\")|[^\"^\u0026)\\r\\n]|\\^(?:\\r\\n|[\\s\\S]))*/m,lookbehind:!0,inside:{keyword:/^\\w+\\b/,string:n,parameter:t,label:{pattern:/(^\\s*):\\S+/m,lookbehind:!0,alias:\"property\"},variable:r,number:i,operator:/\\^/}}],operator:/[\u0026@]/,punctuation:/[()\u0027]/}}(Prism);\n!function(e){var i=e.languages.powershell={comment:[{pattern:/(^|[^`])\u003c#[\\s\\S]*?#\u003e/,lookbehind:!0},{pattern:/(^|[^`])#.*/,lookbehind:!0}],string:[{pattern:/\"(?:`[\\s\\S]|[^`\"])*\"/,greedy:!0,inside:null},{pattern:/\u0027(?:[^\u0027]|\u0027\u0027)*\u0027/,greedy:!0}],namespace:/\\[[a-z](?:\\[(?:\\[[^\\]]*\\]|[^\\[\\]])*\\]|[^\\[\\]])*\\]/i,boolean:/\\$(?:false|true)\\b/i,variable:/\\$\\w+\\b/,function:[/\\b(?:Add|Approve|Assert|Backup|Block|Checkpoint|Clear|Close|Compare|Complete|Compress|Confirm|Connect|Convert|ConvertFrom|ConvertTo|Copy|Debug|Deny|Disable|Disconnect|Dismount|Edit|Enable|Enter|Exit|Expand|Export|Find|ForEach|Format|Get|Grant|Group|Hide|Import|Initialize|Install|Invoke|Join|Limit|Lock|Measure|Merge|Move|New|Open|Optimize|Out|Ping|Pop|Protect|Publish|Push|Read|Receive|Redo|Register|Remove|Rename|Repair|Request|Reset|Resize|Resolve|Restart|Restore|Resume|Revoke|Save|Search|Select|Send|Set|Show|Skip|Sort|Split|Start|Step|Stop|Submit|Suspend|Switch|Sync|Tee|Test|Trace|Unblock|Undo|Uninstall|Unlock|Unprotect|Unpublish|Unregister|Update|Use|Wait|Watch|Where|Write)-[a-z]+\\b/i,/\\b(?:ac|cat|chdir|clc|cli|clp|clv|compare|copy|cp|cpi|cpp|cvpa|dbp|del|diff|dir|ebp|echo|epal|epcsv|epsn|erase|fc|fl|ft|fw|gal|gbp|gc|gci|gcs|gdr|gi|gl|gm|gp|gps|group|gsv|gu|gv|gwmi|iex|ii|ipal|ipcsv|ipsn|irm|iwmi|iwr|kill|lp|ls|measure|mi|mount|move|mp|mv|nal|ndr|ni|nv|ogv|popd|ps|pushd|pwd|rbp|rd|rdr|ren|ri|rm|rmdir|rni|rnp|rp|rv|rvpa|rwmi|sal|saps|sasv|sbp|sc|select|set|shcm|si|sl|sleep|sls|sort|sp|spps|spsv|start|sv|swmi|tee|trcm|type|write)\\b/i],keyword:/\\b(?:Begin|Break|Catch|Class|Continue|Data|Define|Do|DynamicParam|Else|ElseIf|End|Exit|Filter|Finally|For|ForEach|From|Function|If|InlineScript|Parallel|Param|Process|Return|Sequence|Switch|Throw|Trap|Try|Until|Using|Var|While|Workflow)\\b/i,operator:{pattern:/(^|\\W)(?:!|-(?:b?(?:and|x?or)|as|(?:Not)?(?:Contains|In|Like|Match)|eq|ge|gt|is(?:Not)?|Join|le|lt|ne|not|Replace|sh[lr])\\b|-[-=]?|\\+[+=]?|[*\\/%]=?)/i,lookbehind:!0},punctuation:/[|{}[\\];(),.]/};i.string[0].inside={function:{pattern:/(^|[^`])\\$\\((?:\\$\\([^\\r\\n()]*\\)|(?!\\$\\()[^\\r\\n)])*\\)/,lookbehind:!0,inside:i},boolean:i.boolean,variable:i.variable}}(Prism);\nPrism.languages.c=Prism.languages.extend(\"clike\",{comment:{pattern:/\\/\\/(?:[^\\r\\n\\\\]|\\\\(?:\\r\\n?|\\n|(?![\\r\\n])))*|\\/\\*[\\s\\S]*?(?:\\*\\/|$)/,greedy:!0},string:{pattern:/\"(?:\\\\(?:\\r\\n|[\\s\\S])|[^\"\\\\\\r\\n])*\"/,greedy:!0},\"class-name\":{pattern:/(\\b(?:enum|struct)\\s+(?:__attribute__\\s*\\(\\([\\s\\S]*?\\)\\)\\s*)?)\\w+|\\b[a-z]\\w*_t\\b/,lookbehind:!0},keyword:/\\b(?:_Alignas|_Alignof|_Atomic|_Bool|_Complex|_Generic|_Imaginary|_Noreturn|_Static_assert|_Thread_local|__attribute__|asm|auto|break|case|char|const|continue|default|do|double|else|enum|extern|float|for|goto|if|inline|int|long|register|return|short|signed|sizeof|static|struct|switch|typedef|typeof|union|unsigned|void|volatile|while)\\b/,function:/\\b[a-z_]\\w*(?=\\s*\\()/i,number:/(?:\\b0x(?:[\\da-f]+(?:\\.[\\da-f]*)?|\\.[\\da-f]+)(?:p[+-]?\\d+)?|(?:\\b\\d+(?:\\.\\d*)?|\\B\\.\\d+)(?:e[+-]?\\d+)?)[ful]{0,4}/i,operator:/\u003e\u003e=?|\u003c\u003c=?|-\u003e|([-+\u0026|:])\\1|[?:~]|[-+*/%\u0026|^!=\u003c\u003e]=?/}),Prism.languages.insertBefore(\"c\",\"string\",{char:{pattern:/\u0027(?:\\\\(?:\\r\\n|[\\s\\S])|[^\u0027\\\\\\r\\n]){0,32}\u0027/,greedy:!0}}),Prism.languages.insertBefore(\"c\",\"string\",{macro:{pattern:/(^[\\t ]*)#\\s*[a-z](?:[^\\r\\n\\\\/]|\\/(?!\\*)|\\/\\*(?:[^*]|\\*(?!\\/))*\\*\\/|\\\\(?:\\r\\n|[\\s\\S]))*/im,lookbehind:!0,greedy:!0,alias:\"property\",inside:{string:[{pattern:/^(#\\s*include\\s*)\u003c[^\u003e]+\u003e/,lookbehind:!0},Prism.languages.c.string],char:Prism.languages.c.char,comment:Prism.languages.c.comment,\"macro-name\":[{pattern:/(^#\\s*define\\s+)\\w+\\b(?!\\()/i,lookbehind:!0},{pattern:/(^#\\s*define\\s+)\\w+\\b(?=\\()/i,lookbehind:!0,alias:\"function\"}],directive:{pattern:/^(#\\s*)[a-z]+/,lookbehind:!0,alias:\"keyword\"},\"directive-hash\":/^#/,punctuation:/##|\\\\(?=[\\r\\n])/,expression:{pattern:/\\S[\\s\\S]*/,inside:Prism.languages.c}}}}),Prism.languages.insertBefore(\"c\",\"function\",{constant:/\\b(?:EOF|NULL|SEEK_CUR|SEEK_END|SEEK_SET|__DATE__|__FILE__|__LINE__|__TIMESTAMP__|__TIME__|__func__|stderr|stdin|stdout)\\b/}),delete Prism.languages.c.boolean;\n!function(e){var t=/\\b(?:alignas|alignof|asm|auto|bool|break|case|catch|char|char16_t|char32_t|char8_t|class|co_await|co_return|co_yield|compl|concept|const|const_cast|consteval|constexpr|constinit|continue|decltype|default|delete|do|double|dynamic_cast|else|enum|explicit|export|extern|final|float|for|friend|goto|if|import|inline|int|int16_t|int32_t|int64_t|int8_t|long|module|mutable|namespace|new|noexcept|nullptr|operator|override|private|protected|public|register|reinterpret_cast|requires|return|short|signed|sizeof|static|static_assert|static_cast|struct|switch|template|this|thread_local|throw|try|typedef|typeid|typename|uint16_t|uint32_t|uint64_t|uint8_t|union|unsigned|using|virtual|void|volatile|wchar_t|while)\\b/,n=\"\\\\b(?!\u003ckeyword\u003e)\\\\w+(?:\\\\s*\\\\.\\\\s*\\\\w+)*\\\\b\".replace(/\u003ckeyword\u003e/g,(function(){return t.source}));e.languages.cpp=e.languages.extend(\"c\",{\"class-name\":[{pattern:RegExp(\"(\\\\b(?:class|concept|enum|struct|typename)\\\\s+)(?!\u003ckeyword\u003e)\\\\w+\".replace(/\u003ckeyword\u003e/g,(function(){return t.source}))),lookbehind:!0},/\\b[A-Z]\\w*(?=\\s*::\\s*\\w+\\s*\\()/,/\\b[A-Z_]\\w*(?=\\s*::\\s*~\\w+\\s*\\()/i,/\\b\\w+(?=\\s*\u003c(?:[^\u003c\u003e]|\u003c(?:[^\u003c\u003e]|\u003c[^\u003c\u003e]*\u003e)*\u003e)*\u003e\\s*::\\s*\\w+\\s*\\()/],keyword:t,number:{pattern:/(?:\\b0b[01\u0027]+|\\b0x(?:[\\da-f\u0027]+(?:\\.[\\da-f\u0027]*)?|\\.[\\da-f\u0027]+)(?:p[+-]?[\\d\u0027]+)?|(?:\\b[\\d\u0027]+(?:\\.[\\d\u0027]*)?|\\B\\.[\\d\u0027]+)(?:e[+-]?[\\d\u0027]+)?)[ful]{0,4}/i,greedy:!0},operator:/\u003e\u003e=?|\u003c\u003c=?|-\u003e|--|\\+\\+|\u0026\u0026|\\|\\||[?:~]|\u003c=\u003e|[-+*/%\u0026|^!=\u003c\u003e]=?|\\b(?:and|and_eq|bitand|bitor|not|not_eq|or|or_eq|xor|xor_eq)\\b/,boolean:/\\b(?:false|true)\\b/}),e.languages.insertBefore(\"cpp\",\"string\",{module:{pattern:RegExp(\u0027(\\\\b(?:import|module)\\\\s+)(?:\"(?:\\\\\\\\(?:\\r\\n|[^])|[^\"\\\\\\\\\\r\\n])*\"|\u003c[^\u003c\u003e\\r\\n]*\u003e|\u0027+\"\u003cmod-name\u003e(?:\\\\s*:\\\\s*\u003cmod-name\u003e)?|:\\\\s*\u003cmod-name\u003e\".replace(/\u003cmod-name\u003e/g,(function(){return n}))+\")\"),lookbehind:!0,greedy:!0,inside:{string:/^[\u003c\"][\\s\\S]+/,operator:/:/,punctuation:/\\./}},\"raw-string\":{pattern:/R\"([^()\\\\ ]{0,16})\\([\\s\\S]*?\\)\\1\"/,alias:\"string\",greedy:!0}}),e.languages.insertBefore(\"cpp\",\"keyword\",{\"generic-function\":{pattern:/\\b(?!operator\\b)[a-z_]\\w*\\s*\u003c(?:[^\u003c\u003e]|\u003c[^\u003c\u003e]*\u003e)*\u003e(?=\\s*\\()/i,inside:{function:/^\\w+/,generic:{pattern:/\u003c[\\s\\S]+/,alias:\"class-name\",inside:e.languages.cpp}}}}),e.languages.insertBefore(\"cpp\",\"operator\",{\"double-colon\":{pattern:/::/,alias:\"punctuation\"}}),e.languages.insertBefore(\"cpp\",\"class-name\",{\"base-clause\":{pattern:/(\\b(?:class|struct)\\s+\\w+\\s*:\\s*)[^;{}\"\u0027\\s]+(?:\\s+[^;{}\"\u0027\\s]+)*(?=\\s*[;{])/,lookbehind:!0,greedy:!0,inside:e.languages.extend(\"cpp\",{})}}),e.languages.insertBefore(\"inside\",\"double-colon\",{\"class-name\":/\\b[a-z_]\\w*\\b(?!\\s*::)/i},e.languages.cpp[\"base-clause\"])}(Prism);\n!function(e){function n(e,n){return e.replace(/\u003c\u003c(\\d+)\u003e\u003e/g,(function(e,s){return\"(?:\"+n[+s]+\")\"}))}function s(e,s,a){return RegExp(n(e,s),a||\"\")}function a(e,n){for(var s=0;s\u003cn;s++)e=e.replace(/\u003c\u003cself\u003e\u003e/g,(function(){return\"(?:\"+e+\")\"}));return e.replace(/\u003c\u003cself\u003e\u003e/g,\"[^\\\\s\\\\S]\")}var t=\"bool byte char decimal double dynamic float int long object sbyte short string uint ulong ushort var void\",r=\"class enum interface record struct\",i=\"add alias and ascending async await by descending from(?=\\\\s*(?:\\\\w|$)) get global group into init(?=\\\\s*;) join let nameof not notnull on or orderby partial remove select set unmanaged value when where with(?=\\\\s*{)\",o=\"abstract as base break case catch checked const continue default delegate do else event explicit extern finally fixed for foreach goto if implicit in internal is lock namespace new null operator out override params private protected public readonly ref return sealed sizeof stackalloc static switch this throw try typeof unchecked unsafe using virtual volatile while yield\";function l(e){return\"\\\\b(?:\"+e.trim().replace(/ /g,\"|\")+\")\\\\b\"}var d=l(r),p=RegExp(l(t+\" \"+r+\" \"+i+\" \"+o)),c=l(r+\" \"+i+\" \"+o),u=l(t+\" \"+r+\" \"+o),g=a(\"\u003c(?:[^\u003c\u003e;=+\\\\-*/%\u0026|^]|\u003c\u003cself\u003e\u003e)*\u003e\",2),b=a(\"\\\\((?:[^()]|\u003c\u003cself\u003e\u003e)*\\\\)\",2),h=\"@?\\\\b[A-Za-z_]\\\\w*\\\\b\",f=n(\"\u003c\u003c0\u003e\u003e(?:\\\\s*\u003c\u003c1\u003e\u003e)?\",[h,g]),m=n(\"(?!\u003c\u003c0\u003e\u003e)\u003c\u003c1\u003e\u003e(?:\\\\s*\\\\.\\\\s*\u003c\u003c1\u003e\u003e)*\",[c,f]),k=\"\\\\[\\\\s*(?:,\\\\s*)*\\\\]\",y=n(\"\u003c\u003c0\u003e\u003e(?:\\\\s*(?:\\\\?\\\\s*)?\u003c\u003c1\u003e\u003e)*(?:\\\\s*\\\\?)?\",[m,k]),w=n(\"[^,()\u003c\u003e[\\\\];=+\\\\-*/%\u0026|^]|\u003c\u003c0\u003e\u003e|\u003c\u003c1\u003e\u003e|\u003c\u003c2\u003e\u003e\",[g,b,k]),v=n(\"\\\\(\u003c\u003c0\u003e\u003e+(?:,\u003c\u003c0\u003e\u003e+)+\\\\)\",[w]),x=n(\"(?:\u003c\u003c0\u003e\u003e|\u003c\u003c1\u003e\u003e)(?:\\\\s*(?:\\\\?\\\\s*)?\u003c\u003c2\u003e\u003e)*(?:\\\\s*\\\\?)?\",[v,m,k]),$={keyword:p,punctuation:/[\u003c\u003e()?,.:[\\]]/},_=\"\u0027(?:[^\\r\\n\u0027\\\\\\\\]|\\\\\\\\.|\\\\\\\\[Uux][\\\\da-fA-F]{1,8})\u0027\",B=\u0027\"(?:\\\\\\\\.|[^\\\\\\\\\"\\r\\n])*\"\u0027;e.languages.csharp=e.languages.extend(\"clike\",{string:[{pattern:s(\"(^|[^$\\\\\\\\])\u003c\u003c0\u003e\u003e\",[\u0027@\"(?:\"\"|\\\\\\\\[^]|[^\\\\\\\\\"])*\"(?!\")\u0027]),lookbehind:!0,greedy:!0},{pattern:s(\"(^|[^@$\\\\\\\\])\u003c\u003c0\u003e\u003e\",[B]),lookbehind:!0,greedy:!0}],\"class-name\":[{pattern:s(\"(\\\\busing\\\\s+static\\\\s+)\u003c\u003c0\u003e\u003e(?=\\\\s*;)\",[m]),lookbehind:!0,inside:$},{pattern:s(\"(\\\\busing\\\\s+\u003c\u003c0\u003e\u003e\\\\s*=\\\\s*)\u003c\u003c1\u003e\u003e(?=\\\\s*;)\",[h,x]),lookbehind:!0,inside:$},{pattern:s(\"(\\\\busing\\\\s+)\u003c\u003c0\u003e\u003e(?=\\\\s*=)\",[h]),lookbehind:!0},{pattern:s(\"(\\\\b\u003c\u003c0\u003e\u003e\\\\s+)\u003c\u003c1\u003e\u003e\",[d,f]),lookbehind:!0,inside:$},{pattern:s(\"(\\\\bcatch\\\\s*\\\\(\\\\s*)\u003c\u003c0\u003e\u003e\",[m]),lookbehind:!0,inside:$},{pattern:s(\"(\\\\bwhere\\\\s+)\u003c\u003c0\u003e\u003e\",[h]),lookbehind:!0},{pattern:s(\"(\\\\b(?:is(?:\\\\s+not)?|as)\\\\s+)\u003c\u003c0\u003e\u003e\",[y]),lookbehind:!0,inside:$},{pattern:s(\"\\\\b\u003c\u003c0\u003e\u003e(?=\\\\s+(?!\u003c\u003c1\u003e\u003e|with\\\\s*\\\\{)\u003c\u003c2\u003e\u003e(?:\\\\s*[=,;:{)\\\\]]|\\\\s+(?:in|when)\\\\b))\",[x,u,h]),inside:$}],keyword:p,number:/(?:\\b0(?:x[\\da-f_]*[\\da-f]|b[01_]*[01])|(?:\\B\\.\\d+(?:_+\\d+)*|\\b\\d+(?:_+\\d+)*(?:\\.\\d+(?:_+\\d+)*)?)(?:e[-+]?\\d+(?:_+\\d+)*)?)(?:[dflmu]|lu|ul)?\\b/i,operator:/\u003e\u003e=?|\u003c\u003c=?|[-=]\u003e|([-+\u0026|])\\1|~|\\?\\?=?|[-+*/%\u0026|^!=\u003c\u003e]=?/,punctuation:/\\?\\.?|::|[{}[\\];(),.:]/}),e.languages.insertBefore(\"csharp\",\"number\",{range:{pattern:/\\.\\./,alias:\"operator\"}}),e.languages.insertBefore(\"csharp\",\"punctuation\",{\"named-parameter\":{pattern:s(\"([(,]\\\\s*)\u003c\u003c0\u003e\u003e(?=\\\\s*:)\",[h]),lookbehind:!0,alias:\"punctuation\"}}),e.languages.insertBefore(\"csharp\",\"class-name\",{namespace:{pattern:s(\"(\\\\b(?:namespace|using)\\\\s+)\u003c\u003c0\u003e\u003e(?:\\\\s*\\\\.\\\\s*\u003c\u003c0\u003e\u003e)*(?=\\\\s*[;{])\",[h]),lookbehind:!0,inside:{punctuation:/\\./}},\"type-expression\":{pattern:s(\"(\\\\b(?:default|sizeof|typeof)\\\\s*\\\\(\\\\s*(?!\\\\s))(?:[^()\\\\s]|\\\\s(?!\\\\s)|\u003c\u003c0\u003e\u003e)*(?=\\\\s*\\\\))\",[b]),lookbehind:!0,alias:\"class-name\",inside:$},\"return-type\":{pattern:s(\"\u003c\u003c0\u003e\u003e(?=\\\\s+(?:\u003c\u003c1\u003e\u003e\\\\s*(?:=\u003e|[({]|\\\\.\\\\s*this\\\\s*\\\\[)|this\\\\s*\\\\[))\",[x,m]),inside:$,alias:\"class-name\"},\"constructor-invocation\":{pattern:s(\"(\\\\bnew\\\\s+)\u003c\u003c0\u003e\u003e(?=\\\\s*[[({])\",[x]),lookbehind:!0,inside:$,alias:\"class-name\"},\"generic-method\":{pattern:s(\"\u003c\u003c0\u003e\u003e\\\\s*\u003c\u003c1\u003e\u003e(?=\\\\s*\\\\()\",[h,g]),inside:{function:s(\"^\u003c\u003c0\u003e\u003e\",[h]),generic:{pattern:RegExp(g),alias:\"class-name\",inside:$}}},\"type-list\":{pattern:s(\"\\\\b((?:\u003c\u003c0\u003e\u003e\\\\s+\u003c\u003c1\u003e\u003e|record\\\\s+\u003c\u003c1\u003e\u003e\\\\s*\u003c\u003c5\u003e\u003e|where\\\\s+\u003c\u003c2\u003e\u003e)\\\\s*:\\\\s*)(?:\u003c\u003c3\u003e\u003e|\u003c\u003c4\u003e\u003e|\u003c\u003c1\u003e\u003e\\\\s*\u003c\u003c5\u003e\u003e|\u003c\u003c6\u003e\u003e)(?:\\\\s*,\\\\s*(?:\u003c\u003c3\u003e\u003e|\u003c\u003c4\u003e\u003e|\u003c\u003c6\u003e\u003e))*(?=\\\\s*(?:where|[{;]|=\u003e|$))\",[d,f,h,x,p.source,b,\"\\\\bnew\\\\s*\\\\(\\\\s*\\\\)\"]),lookbehind:!0,inside:{\"record-arguments\":{pattern:s(\"(^(?!new\\\\s*\\\\()\u003c\u003c0\u003e\u003e\\\\s*)\u003c\u003c1\u003e\u003e\",[f,b]),lookbehind:!0,greedy:!0,inside:e.languages.csharp},keyword:p,\"class-name\":{pattern:RegExp(x),greedy:!0,inside:$},punctuation:/[,()]/}},preprocessor:{pattern:/(^[\\t ]*)#.*/m,lookbehind:!0,alias:\"property\",inside:{directive:{pattern:/(#)\\b(?:define|elif|else|endif|endregion|error|if|line|nullable|pragma|region|undef|warning)\\b/,lookbehind:!0,alias:\"keyword\"}}}});var E=B+\"|\"+_,R=n(\"/(?![*/])|//[^\\r\\n]*[\\r\\n]|/\\\\*(?:[^*]|\\\\*(?!/))*\\\\*/|\u003c\u003c0\u003e\u003e\",[E]),z=a(n(\"[^\\\"\u0027/()]|\u003c\u003c0\u003e\u003e|\\\\(\u003c\u003cself\u003e\u003e*\\\\)\",[R]),2),S=\"\\\\b(?:assembly|event|field|method|module|param|property|return|type)\\\\b\",j=n(\"\u003c\u003c0\u003e\u003e(?:\\\\s*\\\\(\u003c\u003c1\u003e\u003e*\\\\))?\",[m,z]);e.languages.insertBefore(\"csharp\",\"class-name\",{attribute:{pattern:s(\"((?:^|[^\\\\s\\\\w\u003e)?])\\\\s*\\\\[\\\\s*)(?:\u003c\u003c0\u003e\u003e\\\\s*:\\\\s*)?\u003c\u003c1\u003e\u003e(?:\\\\s*,\\\\s*\u003c\u003c1\u003e\u003e)*(?=\\\\s*\\\\])\",[S,j]),lookbehind:!0,greedy:!0,inside:{target:{pattern:s(\"^\u003c\u003c0\u003e\u003e(?=\\\\s*:)\",[S]),alias:\"keyword\"},\"attribute-arguments\":{pattern:s(\"\\\\(\u003c\u003c0\u003e\u003e*\\\\)\",[z]),inside:e.languages.csharp},\"class-name\":{pattern:RegExp(m),inside:{punctuation:/\\./}},punctuation:/[:,]/}}});var A=\":[^}\\r\\n]+\",F=a(n(\"[^\\\"\u0027/()]|\u003c\u003c0\u003e\u003e|\\\\(\u003c\u003cself\u003e\u003e*\\\\)\",[R]),2),P=n(\"\\\\{(?!\\\\{)(?:(?![}:])\u003c\u003c0\u003e\u003e)*\u003c\u003c1\u003e\u003e?\\\\}\",[F,A]),U=a(n(\"[^\\\"\u0027/()]|/(?!\\\\*)|/\\\\*(?:[^*]|\\\\*(?!/))*\\\\*/|\u003c\u003c0\u003e\u003e|\\\\(\u003c\u003cself\u003e\u003e*\\\\)\",[E]),2),Z=n(\"\\\\{(?!\\\\{)(?:(?![}:])\u003c\u003c0\u003e\u003e)*\u003c\u003c1\u003e\u003e?\\\\}\",[U,A]);function q(n,a){return{interpolation:{pattern:s(\"((?:^|[^{])(?:\\\\{\\\\{)*)\u003c\u003c0\u003e\u003e\",[n]),lookbehind:!0,inside:{\"format-string\":{pattern:s(\"(^\\\\{(?:(?![}:])\u003c\u003c0\u003e\u003e)*)\u003c\u003c1\u003e\u003e(?=\\\\}$)\",[a,A]),lookbehind:!0,inside:{punctuation:/^:/}},punctuation:/^\\{|\\}$/,expression:{pattern:/[\\s\\S]+/,alias:\"language-csharp\",inside:e.languages.csharp}}},string:/[\\s\\S]+/}}e.languages.insertBefore(\"csharp\",\"string\",{\"interpolation-string\":[{pattern:s(\u0027(^|[^\\\\\\\\])(?:\\\\$@|@\\\\$)\"(?:\"\"|\\\\\\\\[^]|\\\\{\\\\{|\u003c\u003c0\u003e\u003e|[^\\\\\\\\{\"])*\"\u0027,[P]),lookbehind:!0,greedy:!0,inside:q(P,F)},{pattern:s(\u0027(^|[^@\\\\\\\\])\\\\$\"(?:\\\\\\\\.|\\\\{\\\\{|\u003c\u003c0\u003e\u003e|[^\\\\\\\\\"{])*\"\u0027,[Z]),lookbehind:!0,greedy:!0,inside:q(Z,U)}],char:{pattern:RegExp(_),greedy:!0}}),e.languages.dotnet=e.languages.cs=e.languages.csharp}(Prism);\n!function(e){var n=/\\b(?:abstract|assert|boolean|break|byte|case|catch|char|class|const|continue|default|do|double|else|enum|exports|extends|final|finally|float|for|goto|if|implements|import|instanceof|int|interface|long|module|native|new|non-sealed|null|open|opens|package|permits|private|protected|provides|public|record(?!\\s*[(){}[\\]\u003c\u003e=%~.:,;?+\\-*/\u0026|^])|requires|return|sealed|short|static|strictfp|super|switch|synchronized|this|throw|throws|to|transient|transitive|try|uses|var|void|volatile|while|with|yield)\\b/,t=\"(?:[a-z]\\\\w*\\\\s*\\\\.\\\\s*)*(?:[A-Z]\\\\w*\\\\s*\\\\.\\\\s*)*\",s={pattern:RegExp(\"(^|[^\\\\w.])\"+t+\"[A-Z](?:[\\\\d_A-Z]*[a-z]\\\\w*)?\\\\b\"),lookbehind:!0,inside:{namespace:{pattern:/^[a-z]\\w*(?:\\s*\\.\\s*[a-z]\\w*)*(?:\\s*\\.)?/,inside:{punctuation:/\\./}},punctuation:/\\./}};e.languages.java=e.languages.extend(\"clike\",{string:{pattern:/(^|[^\\\\])\"(?:\\\\.|[^\"\\\\\\r\\n])*\"/,lookbehind:!0,greedy:!0},\"class-name\":[s,{pattern:RegExp(\"(^|[^\\\\w.])\"+t+\"[A-Z]\\\\w*(?=\\\\s+\\\\w+\\\\s*[;,=()]|\\\\s*(?:\\\\[[\\\\s,]*\\\\]\\\\s*)?::\\\\s*new\\\\b)\"),lookbehind:!0,inside:s.inside},{pattern:RegExp(\"(\\\\b(?:class|enum|extends|implements|instanceof|interface|new|record|throws)\\\\s+)\"+t+\"[A-Z]\\\\w*\\\\b\"),lookbehind:!0,inside:s.inside}],keyword:n,function:[e.languages.clike.function,{pattern:/(::\\s*)[a-z_]\\w*/,lookbehind:!0}],number:/\\b0b[01][01_]*L?\\b|\\b0x(?:\\.[\\da-f_p+-]+|[\\da-f_]+(?:\\.[\\da-f_p+-]+)?)\\b|(?:\\b\\d[\\d_]*(?:\\.[\\d_]*)?|\\B\\.\\d[\\d_]*)(?:e[+-]?\\d[\\d_]*)?[dfl]?/i,operator:{pattern:/(^|[^.])(?:\u003c\u003c=?|\u003e\u003e\u003e?=?|-\u003e|--|\\+\\+|\u0026\u0026|\\|\\||::|[?:~]|[-+*/%\u0026|^!=\u003c\u003e]=?)/m,lookbehind:!0},constant:/\\b[A-Z][A-Z_\\d]+\\b/}),e.languages.insertBefore(\"java\",\"string\",{\"triple-quoted-string\":{pattern:/\"\"\"[ \\t]*[\\r\\n](?:(?:\"|\"\")?(?:\\\\.|[^\"\\\\]))*\"\"\"/,greedy:!0,alias:\"string\"},char:{pattern:/\u0027(?:\\\\.|[^\u0027\\\\\\r\\n]){1,6}\u0027/,greedy:!0}}),e.languages.insertBefore(\"java\",\"class-name\",{annotation:{pattern:/(^|[^.])@\\w+(?:\\s*\\.\\s*\\w+)*/,lookbehind:!0,alias:\"punctuation\"},generics:{pattern:/\u003c(?:[\\w\\s,.?]|\u0026(?!\u0026)|\u003c(?:[\\w\\s,.?]|\u0026(?!\u0026)|\u003c(?:[\\w\\s,.?]|\u0026(?!\u0026)|\u003c(?:[\\w\\s,.?]|\u0026(?!\u0026))*\u003e)*\u003e)*\u003e)*\u003e/,inside:{\"class-name\":s,keyword:n,punctuation:/[\u003c\u003e(),.:]/,operator:/[?\u0026|]/}},import:[{pattern:RegExp(\"(\\\\bimport\\\\s+)\"+t+\"(?:[A-Z]\\\\w*|\\\\*)(?=\\\\s*;)\"),lookbehind:!0,inside:{namespace:s.inside.namespace,punctuation:/\\./,operator:/\\*/,\"class-name\":/\\w+/}},{pattern:RegExp(\"(\\\\bimport\\\\s+static\\\\s+)\"+t+\"(?:\\\\w+|\\\\*)(?=\\\\s*;)\"),lookbehind:!0,alias:\"static\",inside:{namespace:s.inside.namespace,static:/\\b\\w+$/,punctuation:/\\./,operator:/\\*/,\"class-name\":/\\w+/}}],namespace:{pattern:RegExp(\"(\\\\b(?:exports|import(?:\\\\s+static)?|module|open|opens|package|provides|requires|to|transitive|uses|with)\\\\s+)(?!\u003ckeyword\u003e)[a-z]\\\\w*(?:\\\\.[a-z]\\\\w*)*\\\\.?\".replace(/\u003ckeyword\u003e/g,(function(){return n.source}))),lookbehind:!0,inside:{punctuation:/\\./}}})}(Prism);\nPrism.languages.go=Prism.languages.extend(\"clike\",{string:{pattern:/(^|[^\\\\])\"(?:\\\\.|[^\"\\\\\\r\\n])*\"|`[^`]*`/,lookbehind:!0,greedy:!0},keyword:/\\b(?:break|case|chan|const|continue|default|defer|else|fallthrough|for|func|go(?:to)?|if|import|interface|map|package|range|return|select|struct|switch|type|var)\\b/,boolean:/\\b(?:_|false|iota|nil|true)\\b/,number:[/\\b0(?:b[01_]+|o[0-7_]+)i?\\b/i,/\\b0x(?:[a-f\\d_]+(?:\\.[a-f\\d_]*)?|\\.[a-f\\d_]+)(?:p[+-]?\\d+(?:_\\d+)*)?i?(?!\\w)/i,/(?:\\b\\d[\\d_]*(?:\\.[\\d_]*)?|\\B\\.\\d[\\d_]*)(?:e[+-]?[\\d_]+)?i?(?!\\w)/i],operator:/[*\\/%^!=]=?|\\+[=+]?|-[=-]?|\\|[=|]?|\u0026(?:=|\u0026|\\^=?)?|\u003e(?:\u003e=?|=)?|\u003c(?:\u003c=?|=|-)?|:=|\\.\\.\\./,builtin:/\\b(?:append|bool|byte|cap|close|complex|complex(?:64|128)|copy|delete|error|float(?:32|64)|u?int(?:8|16|32|64)?|imag|len|make|new|panic|print(?:ln)?|real|recover|rune|string|uintptr)\\b/}),Prism.languages.insertBefore(\"go\",\"string\",{char:{pattern:/\u0027(?:\\\\.|[^\u0027\\\\\\r\\n]){0,10}\u0027/,greedy:!0}}),delete Prism.languages.go[\"class-name\"];\n!function(e){for(var a=\"/\\\\*(?:[^*/]|\\\\*(?!/)|/(?!\\\\*)|\u003cself\u003e)*\\\\*/\",t=0;t\u003c2;t++)a=a.replace(/\u003cself\u003e/g,(function(){return a}));a=a.replace(/\u003cself\u003e/g,(function(){return\"[^\\\\s\\\\S]\"})),e.languages.rust={comment:[{pattern:RegExp(\"(^|[^\\\\\\\\])\"+a),lookbehind:!0,greedy:!0},{pattern:/(^|[^\\\\:])\\/\\/.*/,lookbehind:!0,greedy:!0}],string:{pattern:/b?\"(?:\\\\[\\s\\S]|[^\\\\\"])*\"|b?r(#*)\"(?:[^\"]|\"(?!\\1))*\"\\1/,greedy:!0},char:{pattern:/b?\u0027(?:\\\\(?:x[0-7][\\da-fA-F]|u\\{(?:[\\da-fA-F]_*){1,6}\\}|.)|[^\\\\\\r\\n\\t\u0027])\u0027/,greedy:!0},attribute:{pattern:/#!?\\[(?:[^\\[\\]\"]|\"(?:\\\\[\\s\\S]|[^\\\\\"])*\")*\\]/,greedy:!0,alias:\"attr-name\",inside:{string:null}},\"closure-params\":{pattern:/([=(,:]\\s*|\\bmove\\s*)\\|[^|]*\\||\\|[^|]*\\|(?=\\s*(?:\\{|-\u003e))/,lookbehind:!0,greedy:!0,inside:{\"closure-punctuation\":{pattern:/^\\||\\|$/,alias:\"punctuation\"},rest:null}},\"lifetime-annotation\":{pattern:/\u0027\\w+/,alias:\"symbol\"},\"fragment-specifier\":{pattern:/(\\$\\w+:)[a-z]+/,lookbehind:!0,alias:\"punctuation\"},variable:/\\$\\w+/,\"function-definition\":{pattern:/(\\bfn\\s+)\\w+/,lookbehind:!0,alias:\"function\"},\"type-definition\":{pattern:/(\\b(?:enum|struct|trait|type|union)\\s+)\\w+/,lookbehind:!0,alias:\"class-name\"},\"module-declaration\":[{pattern:/(\\b(?:crate|mod)\\s+)[a-z][a-z_\\d]*/,lookbehind:!0,alias:\"namespace\"},{pattern:/(\\b(?:crate|self|super)\\s*)::\\s*[a-z][a-z_\\d]*\\b(?:\\s*::(?:\\s*[a-z][a-z_\\d]*\\s*::)*)?/,lookbehind:!0,alias:\"namespace\",inside:{punctuation:/::/}}],keyword:[/\\b(?:Self|abstract|as|async|await|become|box|break|const|continue|crate|do|dyn|else|enum|extern|final|fn|for|if|impl|in|let|loop|macro|match|mod|move|mut|override|priv|pub|ref|return|self|static|struct|super|trait|try|type|typeof|union|unsafe|unsized|use|virtual|where|while|yield)\\b/,/\\b(?:bool|char|f(?:32|64)|[ui](?:8|16|32|64|128|size)|str)\\b/],function:/\\b[a-z_]\\w*(?=\\s*(?:::\\s*\u003c|\\())/,macro:{pattern:/\\b\\w+!/,alias:\"property\"},constant:/\\b[A-Z_][A-Z_\\d]+\\b/,\"class-name\":/\\b[A-Z]\\w*\\b/,namespace:{pattern:/(?:\\b[a-z][a-z_\\d]*\\s*::\\s*)*\\b[a-z][a-z_\\d]*\\s*::(?!\\s*\u003c)/,inside:{punctuation:/::/}},number:/\\b(?:0x[\\dA-Fa-f](?:_?[\\dA-Fa-f])*|0o[0-7](?:_?[0-7])*|0b[01](?:_?[01])*|(?:(?:\\d(?:_?\\d)*)?\\.)?\\d(?:_?\\d)*(?:[Ee][+-]?\\d+)?)(?:_?(?:f32|f64|[iu](?:8|16|32|64|size)?))?\\b/,boolean:/\\b(?:false|true)\\b/,punctuation:/-\u003e|\\.\\.=|\\.{1,3}|::|[{}[\\];(),:]/,operator:/[-+*\\/%!^]=?|=[=\u003e]?|\u0026[\u0026=]?|\\|[|=]?|\u003c\u003c?=?|\u003e\u003e?=?|[@?]/},e.languages.rust[\"closure-params\"].inside.rest=e.languages.rust,e.languages.rust.attribute.inside.string=e.languages.rust.string}(Prism);\nPrism.languages.python={comment:{pattern:/(^|[^\\\\])#.*/,lookbehind:!0,greedy:!0},\"string-interpolation\":{pattern:/(?:f|fr|rf)(?:(\"\"\"|\u0027\u0027\u0027)[\\s\\S]*?\\1|(\"|\u0027)(?:\\\\.|(?!\\2)[^\\\\\\r\\n])*\\2)/i,greedy:!0,inside:{interpolation:{pattern:/((?:^|[^{])(?:\\{\\{)*)\\{(?!\\{)(?:[^{}]|\\{(?!\\{)(?:[^{}]|\\{(?!\\{)(?:[^{}])+\\})+\\})+\\}/,lookbehind:!0,inside:{\"format-spec\":{pattern:/(:)[^:(){}]+(?=\\}$)/,lookbehind:!0},\"conversion-option\":{pattern:/![sra](?=[:}]$)/,alias:\"punctuation\"},rest:null}},string:/[\\s\\S]+/}},\"triple-quoted-string\":{pattern:/(?:[rub]|br|rb)?(\"\"\"|\u0027\u0027\u0027)[\\s\\S]*?\\1/i,greedy:!0,alias:\"string\"},string:{pattern:/(?:[rub]|br|rb)?(\"|\u0027)(?:\\\\.|(?!\\1)[^\\\\\\r\\n])*\\1/i,greedy:!0},function:{pattern:/((?:^|\\s)def[ \\t]+)[a-zA-Z_]\\w*(?=\\s*\\()/g,lookbehind:!0},\"class-name\":{pattern:/(\\bclass\\s+)\\w+/i,lookbehind:!0},decorator:{pattern:/(^[\\t ]*)@\\w+(?:\\.\\w+)*/m,lookbehind:!0,alias:[\"annotation\",\"punctuation\"],inside:{punctuation:/\\./}},keyword:/\\b(?:_(?=\\s*:)|and|as|assert|async|await|break|case|class|continue|def|del|elif|else|except|exec|finally|for|from|global|if|import|in|is|lambda|match|nonlocal|not|or|pass|print|raise|return|try|while|with|yield)\\b/,builtin:/\\b(?:__import__|abs|all|any|apply|ascii|basestring|bin|bool|buffer|bytearray|bytes|callable|chr|classmethod|cmp|coerce|compile|complex|delattr|dict|dir|divmod|enumerate|eval|execfile|file|filter|float|format|frozenset|getattr|globals|hasattr|hash|help|hex|id|input|int|intern|isinstance|issubclass|iter|len|list|locals|long|map|max|memoryview|min|next|object|oct|open|ord|pow|property|range|raw_input|reduce|reload|repr|reversed|round|set|setattr|slice|sorted|staticmethod|str|sum|super|tuple|type|unichr|unicode|vars|xrange|zip)\\b/,boolean:/\\b(?:False|None|True)\\b/,number:/\\b0(?:b(?:_?[01])+|o(?:_?[0-7])+|x(?:_?[a-f0-9])+)\\b|(?:\\b\\d+(?:_\\d+)*(?:\\.(?:\\d+(?:_\\d+)*)?)?|\\B\\.\\d+(?:_\\d+)*)(?:e[+-]?\\d+(?:_\\d+)*)?j?(?!\\w)/i,operator:/[-+%=]=?|!=|:=|\\*\\*?=?|\\/\\/?=?|\u003c[\u003c=\u003e]?|\u003e[=\u003e]?|[\u0026|^~]/,punctuation:/[{}[\\];(),.:]/},Prism.languages.python[\"string-interpolation\"].inside.interpolation.inside.rest=Prism.languages.python,Prism.languages.py=Prism.languages.python;\nPrism.languages.sql={comment:{pattern:/(^|[^\\\\])(?:\\/\\*[\\s\\S]*?\\*\\/|(?:--|\\/\\/|#).*)/,lookbehind:!0},variable:[{pattern:/@([\"\u0027`])(?:\\\\[\\s\\S]|(?!\\1)[^\\\\])+\\1/,greedy:!0},/@[\\w.$]+/],string:{pattern:/(^|[^@\\\\])(\"|\u0027)(?:\\\\[\\s\\S]|(?!\\2)[^\\\\]|\\2\\2)*\\2/,greedy:!0,lookbehind:!0},identifier:{pattern:/(^|[^@\\\\])`(?:\\\\[\\s\\S]|[^`\\\\]|``)*`/,greedy:!0,lookbehind:!0,inside:{punctuation:/^`|`$/}},function:/\\b(?:AVG|COUNT|FIRST|FORMAT|LAST|LCASE|LEN|MAX|MID|MIN|MOD|NOW|ROUND|SUM|UCASE)(?=\\s*\\()/i,keyword:/\\b(?:ACTION|ADD|AFTER|ALGORITHM|ALL|ALTER|ANALYZE|ANY|APPLY|AS|ASC|AUTHORIZATION|AUTO_INCREMENT|BACKUP|BDB|BEGIN|BERKELEYDB|BIGINT|BINARY|BIT|BLOB|BOOL|BOOLEAN|BREAK|BROWSE|BTREE|BULK|BY|CALL|CASCADED?|CASE|CHAIN|CHAR(?:ACTER|SET)?|CHECK(?:POINT)?|CLOSE|CLUSTERED|COALESCE|COLLATE|COLUMNS?|COMMENT|COMMIT(?:TED)?|COMPUTE|CONNECT|CONSISTENT|CONSTRAINT|CONTAINS(?:TABLE)?|CONTINUE|CONVERT|CREATE|CROSS|CURRENT(?:_DATE|_TIME|_TIMESTAMP|_USER)?|CURSOR|CYCLE|DATA(?:BASES?)?|DATE(?:TIME)?|DAY|DBCC|DEALLOCATE|DEC|DECIMAL|DECLARE|DEFAULT|DEFINER|DELAYED|DELETE|DELIMITERS?|DENY|DESC|DESCRIBE|DETERMINISTIC|DISABLE|DISCARD|DISK|DISTINCT|DISTINCTROW|DISTRIBUTED|DO|DOUBLE|DROP|DUMMY|DUMP(?:FILE)?|DUPLICATE|ELSE(?:IF)?|ENABLE|ENCLOSED|END|ENGINE|ENUM|ERRLVL|ERRORS|ESCAPED?|EXCEPT|EXEC(?:UTE)?|EXISTS|EXIT|EXPLAIN|EXTENDED|FETCH|FIELDS|FILE|FILLFACTOR|FIRST|FIXED|FLOAT|FOLLOWING|FOR(?: EACH ROW)?|FORCE|FOREIGN|FREETEXT(?:TABLE)?|FROM|FULL|FUNCTION|GEOMETRY(?:COLLECTION)?|GLOBAL|GOTO|GRANT|GROUP|HANDLER|HASH|HAVING|HOLDLOCK|HOUR|IDENTITY(?:COL|_INSERT)?|IF|IGNORE|IMPORT|INDEX|INFILE|INNER|INNODB|INOUT|INSERT|INT|INTEGER|INTERSECT|INTERVAL|INTO|INVOKER|ISOLATION|ITERATE|JOIN|KEYS?|KILL|LANGUAGE|LAST|LEAVE|LEFT|LEVEL|LIMIT|LINENO|LINES|LINESTRING|LOAD|LOCAL|LOCK|LONG(?:BLOB|TEXT)|LOOP|MATCH(?:ED)?|MEDIUM(?:BLOB|INT|TEXT)|MERGE|MIDDLEINT|MINUTE|MODE|MODIFIES|MODIFY|MONTH|MULTI(?:LINESTRING|POINT|POLYGON)|NATIONAL|NATURAL|NCHAR|NEXT|NO|NONCLUSTERED|NULLIF|NUMERIC|OFF?|OFFSETS?|ON|OPEN(?:DATASOURCE|QUERY|ROWSET)?|OPTIMIZE|OPTION(?:ALLY)?|ORDER|OUT(?:ER|FILE)?|OVER|PARTIAL|PARTITION|PERCENT|PIVOT|PLAN|POINT|POLYGON|PRECEDING|PRECISION|PREPARE|PREV|PRIMARY|PRINT|PRIVILEGES|PROC(?:EDURE)?|PUBLIC|PURGE|QUICK|RAISERROR|READS?|REAL|RECONFIGURE|REFERENCES|RELEASE|RENAME|REPEAT(?:ABLE)?|REPLACE|REPLICATION|REQUIRE|RESIGNAL|RESTORE|RESTRICT|RETURN(?:ING|S)?|REVOKE|RIGHT|ROLLBACK|ROUTINE|ROW(?:COUNT|GUIDCOL|S)?|RTREE|RULE|SAVE(?:POINT)?|SCHEMA|SECOND|SELECT|SERIAL(?:IZABLE)?|SESSION(?:_USER)?|SET(?:USER)?|SHARE|SHOW|SHUTDOWN|SIMPLE|SMALLINT|SNAPSHOT|SOME|SONAME|SQL|START(?:ING)?|STATISTICS|STATUS|STRIPED|SYSTEM_USER|TABLES?|TABLESPACE|TEMP(?:ORARY|TABLE)?|TERMINATED|TEXT(?:SIZE)?|THEN|TIME(?:STAMP)?|TINY(?:BLOB|INT|TEXT)|TOP?|TRAN(?:SACTIONS?)?|TRIGGER|TRUNCATE|TSEQUAL|TYPES?|UNBOUNDED|UNCOMMITTED|UNDEFINED|UNION|UNIQUE|UNLOCK|UNPIVOT|UNSIGNED|UPDATE(?:TEXT)?|USAGE|USE|USER|USING|VALUES?|VAR(?:BINARY|CHAR|CHARACTER|YING)|VIEW|WAITFOR|WARNINGS|WHEN|WHERE|WHILE|WITH(?: ROLLUP|IN)?|WORK|WRITE(?:TEXT)?|YEAR)\\b/i,boolean:/\\b(?:FALSE|NULL|TRUE)\\b/i,number:/\\b0x[\\da-f]+\\b|\\b\\d+(?:\\.\\d*)?|\\B\\.\\d+\\b/i,operator:/[-+*\\/=%^~]|\u0026\u0026?|\\|\\|?|!=?|\u003c(?:=\u003e?|\u003c|\u003e)?|\u003e[\u003e=]?|\\b(?:AND|BETWEEN|DIV|ILIKE|IN|IS|LIKE|NOT|OR|REGEXP|RLIKE|SOUNDS LIKE|XOR)\\b/i,punctuation:/[;[\\]()`,.]/};\nPrism.languages.ini={comment:{pattern:/(^[ \\f\\t\\v]*)[#;][^\\n\\r]*/m,lookbehind:!0},section:{pattern:/(^[ \\f\\t\\v]*)\\[[^\\n\\r\\]]*\\]?/m,lookbehind:!0,inside:{\"section-name\":{pattern:/(^\\[[ \\f\\t\\v]*)[^ \\f\\t\\v\\]]+(?:[ \\f\\t\\v]+[^ \\f\\t\\v\\]]+)*/,lookbehind:!0,alias:\"selector\"},punctuation:/\\[|\\]/}},key:{pattern:/(^[ \\f\\t\\v]*)[^ \\f\\n\\r\\t\\v=]+(?:[ \\f\\t\\v]+[^ \\f\\n\\r\\t\\v=]+)*(?=[ \\f\\t\\v]*=)/m,lookbehind:!0,alias:\"attr-name\"},value:{pattern:/(=[ \\f\\t\\v]*)[^ \\f\\n\\r\\t\\v]+(?:[ \\f\\t\\v]+[^ \\f\\n\\r\\t\\v]+)*/,lookbehind:!0,alias:\"attr-value\",inside:{\"inner-value\":{pattern:/^(\"|\u0027).+(?=\\1$)/,lookbehind:!0}}},punctuation:/=/};\nPrism.languages.properties={comment:/^[ \\t]*[#!].*$/m,value:{pattern:/(^[ \\t]*(?:\\\\(?:\\r\\n|[\\s\\S])|[^\\\\\\s:=])+(?: *[=:] *(?! )| ))(?:\\\\(?:\\r\\n|[\\s\\S])|[^\\\\\\r\\n])+/m,lookbehind:!0,alias:\"attr-value\"},key:{pattern:/^[ \\t]*(?:\\\\(?:\\r\\n|[\\s\\S])|[^\\\\\\s:=])+(?= *[=:]| )/m,alias:\"attr-name\"},punctuation:/[=:]/};\n!function(e){function n(e){return e.replace(/__/g,(function(){return\"(?:[\\\\w-]+|\u0027[^\u0027\\n\\r]*\u0027|\\\"(?:\\\\\\\\.|[^\\\\\\\\\\\"\\r\\n])*\\\")\"}))}e.languages.toml={comment:{pattern:/#.*/,greedy:!0},table:{pattern:RegExp(n(\"(^[\\t ]*\\\\[\\\\s*(?:\\\\[\\\\s*)?)__(?:\\\\s*\\\\.\\\\s*__)*(?=\\\\s*\\\\])\"),\"m\"),lookbehind:!0,greedy:!0,alias:\"class-name\"},key:{pattern:RegExp(n(\"(^[\\t ]*|[{,]\\\\s*)__(?:\\\\s*\\\\.\\\\s*__)*(?=\\\\s*=)\"),\"m\"),lookbehind:!0,greedy:!0,alias:\"property\"},string:{pattern:/\"\"\"(?:\\\\[\\s\\S]|[^\\\\])*?\"\"\"|\u0027\u0027\u0027[\\s\\S]*?\u0027\u0027\u0027|\u0027[^\u0027\\n\\r]*\u0027|\"(?:\\\\.|[^\\\\\"\\r\\n])*\"/,greedy:!0},date:[{pattern:/\\b\\d{4}-\\d{2}-\\d{2}(?:[T\\s]\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})?)?\\b/i,alias:\"number\"},{pattern:/\\b\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?\\b/,alias:\"number\"}],number:/(?:\\b0(?:x[\\da-zA-Z]+(?:_[\\da-zA-Z]+)*|o[0-7]+(?:_[0-7]+)*|b[10]+(?:_[10]+)*))\\b|[-+]?\\b\\d+(?:_\\d+)*(?:\\.\\d+(?:_\\d+)*)?(?:[eE][+-]?\\d+(?:_\\d+)*)?\\b|[-+]?\\b(?:inf|nan)\\b/,boolean:/\\b(?:false|true)\\b/,punctuation:/[.,=[\\]{}]/}}(Prism);\n!function(e){var n={pattern:/((?:^|[^\\\\$])(?:\\\\{2})*)\\$(?:\\w+|\\{[^{}]*\\})/,lookbehind:!0,inside:{\"interpolation-punctuation\":{pattern:/^\\$\\{?|\\}$/,alias:\"punctuation\"},expression:{pattern:/[\\s\\S]+/,inside:null}}};e.languages.groovy=e.languages.extend(\"clike\",{string:{pattern:/\u0027\u0027\u0027(?:[^\\\\]|\\\\[\\s\\S])*?\u0027\u0027\u0027|\u0027(?:\\\\.|[^\\\\\u0027\\r\\n])*\u0027/,greedy:!0},keyword:/\\b(?:abstract|as|assert|boolean|break|byte|case|catch|char|class|const|continue|def|default|do|double|else|enum|extends|final|finally|float|for|goto|if|implements|import|in|instanceof|int|interface|long|native|new|package|private|protected|public|return|short|static|strictfp|super|switch|synchronized|this|throw|throws|trait|transient|try|void|volatile|while)\\b/,number:/\\b(?:0b[01_]+|0x[\\da-f_]+(?:\\.[\\da-f_p\\-]+)?|[\\d_]+(?:\\.[\\d_]+)?(?:e[+-]?\\d+)?)[glidf]?\\b/i,operator:{pattern:/(^|[^.])(?:~|==?~?|\\?[.:]?|\\*(?:[.=]|\\*=?)?|\\.[@\u0026]|\\.\\.\u003c|\\.\\.(?!\\.)|-[-=\u003e]?|\\+[+=]?|!=?|\u003c(?:\u003c=?|=\u003e?)?|\u003e(?:\u003e\u003e?=?|=)?|\u0026[\u0026=]?|\\|[|=]?|\\/=?|\\^=?|%=?)/,lookbehind:!0},punctuation:/\\.+|[{}[\\];(),:$]/}),e.languages.insertBefore(\"groovy\",\"string\",{shebang:{pattern:/#!.+/,alias:\"comment\",greedy:!0},\"interpolation-string\":{pattern:/\"\"\"(?:[^\\\\]|\\\\[\\s\\S])*?\"\"\"|([\"/])(?:\\\\.|(?!\\1)[^\\\\\\r\\n])*\\1|\\$\\/(?:[^/$]|\\$(?:[/$]|(?![/$]))|\\/(?!\\$))*\\/\\$/,greedy:!0,inside:{interpolation:n,string:/[\\s\\S]+/}}}),e.languages.insertBefore(\"groovy\",\"punctuation\",{\"spock-block\":/\\b(?:and|cleanup|expect|given|setup|then|when|where):/}),e.languages.insertBefore(\"groovy\",\"function\",{annotation:{pattern:/(^|[^.])@\\w+/,lookbehind:!0,alias:\"punctuation\"}}),n.inside.expression.inside=e.languages.groovy}(Prism);\n!function(t){var n=t.util.clone(t.languages.javascript),e=\"(?:\\\\{\u003cS\u003e*\\\\.{3}(?:[^{}]|\u003cBRACES\u003e)*\\\\})\";function a(t,n){return t=t.replace(/\u003cS\u003e/g,(function(){return\"(?:\\\\s|//.*(?!.)|/\\\\*(?:[^*]|\\\\*(?!/))\\\\*/)\"})).replace(/\u003cBRACES\u003e/g,(function(){return\"(?:\\\\{(?:\\\\{(?:\\\\{[^{}]*\\\\}|[^{}])*\\\\}|[^{}])*\\\\})\"})).replace(/\u003cSPREAD\u003e/g,(function(){return e})),RegExp(t,n)}e=a(e).source,t.languages.jsx=t.languages.extend(\"markup\",n),t.languages.jsx.tag.pattern=a(\"\u003c/?(?:[\\\\w.:-]+(?:\u003cS\u003e+(?:[\\\\w.:$-]+(?:=(?:\\\"(?:\\\\\\\\[^]|[^\\\\\\\\\\\"])*\\\"|\u0027(?:\\\\\\\\[^]|[^\\\\\\\\\u0027])*\u0027|[^\\\\s{\u0027\\\"/\u003e=]+|\u003cBRACES\u003e))?|\u003cSPREAD\u003e))*\u003cS\u003e*/?)?\u003e\"),t.languages.jsx.tag.inside.tag.pattern=/^\u003c\\/?[^\\s\u003e\\/]*/,t.languages.jsx.tag.inside[\"attr-value\"].pattern=/=(?!\\{)(?:\"(?:\\\\[\\s\\S]|[^\\\\\"])*\"|\u0027(?:\\\\[\\s\\S]|[^\\\\\u0027])*\u0027|[^\\s\u0027\"\u003e]+)/,t.languages.jsx.tag.inside.tag.inside[\"class-name\"]=/^[A-Z]\\w*(?:\\.[A-Z]\\w*)*$/,t.languages.jsx.tag.inside.comment=n.comment,t.languages.insertBefore(\"inside\",\"attr-name\",{spread:{pattern:a(\"\u003cSPREAD\u003e\"),inside:t.languages.jsx}},t.languages.jsx.tag),t.languages.insertBefore(\"inside\",\"special-attr\",{script:{pattern:a(\"=\u003cBRACES\u003e\"),alias:\"language-javascript\",inside:{\"script-punctuation\":{pattern:/^=(?=\\{)/,alias:\"punctuation\"},rest:t.languages.jsx}}},t.languages.jsx.tag);var s=function(t){return t?\"string\"==typeof t?t:\"string\"==typeof t.content?t.content:t.content.map(s).join(\"\"):\"\"},g=function(n){for(var e=[],a=0;a\u003cn.length;a++){var o=n[a],i=!1;if(\"string\"!=typeof o\u0026\u0026(\"tag\"===o.type\u0026\u0026o.content[0]\u0026\u0026\"tag\"===o.content[0].type?\"\u003c/\"===o.content[0].content[0].content?e.length\u003e0\u0026\u0026e[e.length-1].tagName===s(o.content[0].content[1])\u0026\u0026e.pop():\"/\u003e\"===o.content[o.content.length-1].content||e.push({tagName:s(o.content[0].content[1]),openedBraces:0}):e.length\u003e0\u0026\u0026\"punctuation\"===o.type\u0026\u0026\"{\"===o.content?e[e.length-1].openedBraces++:e.length\u003e0\u0026\u0026e[e.length-1].openedBraces\u003e0\u0026\u0026\"punctuation\"===o.type\u0026\u0026\"}\"===o.content?e[e.length-1].openedBraces--:i=!0),(i||\"string\"==typeof o)\u0026\u0026e.length\u003e0\u0026\u00260===e[e.length-1].openedBraces){var r=s(o);a\u003cn.length-1\u0026\u0026(\"string\"==typeof n[a+1]||\"plain-text\"===n[a+1].type)\u0026\u0026(r+=s(n[a+1]),n.splice(a+1,1)),a\u003e0\u0026\u0026(\"string\"==typeof n[a-1]||\"plain-text\"===n[a-1].type)\u0026\u0026(r=s(n[a-1])+r,n.splice(a-1,1),a--),n[a]=new t.Token(\"plain-text\",r,null,r)}o.content\u0026\u0026\"string\"!=typeof o.content\u0026\u0026g(o.content)}};t.hooks.add(\"after-tokenize\",(function(t){\"jsx\"!==t.language\u0026\u0026\"tsx\"!==t.language||g(t.tokens)}))}(Prism);\n!function(e){var a=e.util.clone(e.languages.typescript);e.languages.tsx=e.languages.extend(\"jsx\",a),delete e.languages.tsx.parameter,delete e.languages.tsx[\"literal-property\"];var t=e.languages.tsx.tag;t.pattern=RegExp(\"(^|[^\\\\w$]|(?=\u003c/))(?:\"+t.pattern.source+\")\",t.pattern.flags),t.lookbehind=!0}(Prism);\n!function(e){e.languages.diff={coord:[/^(?:\\*{3}|-{3}|\\+{3}).*$/m,/^@@.*@@$/m,/^\\d.*$/m]};var n={\"deleted-sign\":\"-\",\"deleted-arrow\":\"\u003c\",\"inserted-sign\":\"+\",\"inserted-arrow\":\"\u003e\",unchanged:\" \",diff:\"!\"};Object.keys(n).forEach((function(a){var i=n[a],r=[];/^\\w+$/.test(a)||r.push(/\\w+/.exec(a)[0]),\"diff\"===a\u0026\u0026r.push(\"bold\"),e.languages.diff[a]={pattern:RegExp(\"^(?:[\"+i+\"].*(?:\\r\\n?|\\n|(?![\\\\s\\\\S])))+\",\"m\"),alias:r,inside:{line:{pattern:/(.)(?=[\\s\\S]).*(?:\\r\\n?|\\n)?/,lookbehind:!0},prefix:{pattern:/[\\s\\S]/,alias:/\\w+/.exec(a)[0]}}}})),Object.defineProperty(e.languages.diff,\"PREFIXES\",{value:n})}(Prism);";
		// Prism 惰性初始化：~75KB 源码的解析（正则编译）从模块加载的同步路径移走，
		// 且仅在首个 diff/read payload 实际解析后才安排空闲期执行（schedulePrismIdle），
		// 避免每次页面加载都无条件付出解析成本；首次实际使用时也会同步 ensurePrism()。
		// Prism core 是 UMD 构建：内部自注册 _self.Prism（_self 解析为 window），尾部还
		// 直接写 global.Prism（浏览器中 global === window）——直接在全局作用域执行会把
		// vendored Prism 写入/覆盖宿主页面已有的 window.Prism。用局部空对象同时遮蔽
		// window 与 global 两个参数（typeof 检查仍通过），写不到真全局。
		let PG_PRISM = null;
		let prismInitDone = false;
		let prismIdleScheduled = false;
		// 首个 diff/read payload 解析后安排空闲期初始化（无 requestIdleCallback 时
		// setTimeout 兜底）；幂等，仅调度一次。
		function schedulePrismIdle() {
			if (prismIdleScheduled) return;
			prismIdleScheduled = true;
			scheduleIdle(ensurePrism, 3000);
		}
		function ensurePrism() {
			if (prismInitDone) return;
			prismInitDone = true;
			let prism = null;
			try {
				prism = new Function('window', 'global', PRISM_SRC + '\n;return typeof Prism !== "undefined" ? Prism : null;')({}, {});
			} catch (e) { console.warn('[permgate] prism init via eval failed:', e); }
			if (!prism && typeof document !== 'undefined') {
				// CSP 禁 eval 时回退：内联 script 标签（宿主允许内联脚本时生效）。
				// 内联脚本在全局作用域执行，Prism 会自注册 window.Prism——注入前保存宿主原值，
				// 读取结果后立即恢复，避免覆盖其它模块已加载的 window.Prism；
				// 结果经 window.__PG_PRISM__ 传出，读取后立即清理。
				// data-manual 使 Prism core 尾部跳过自动高亮调度（highlightAll），
				// 防止其改写宿主页面中 .language-* 元素（该调度持有闭包、事后恢复
				// window.Prism 无法取消）。
				let prevPrism;
				try {
					const sc = document.createElement('script');
					prevPrism = (typeof window !== 'undefined' && 'Prism' in window) ? window.Prism : undefined;
					sc.setAttribute('data-manual', '');
					sc.textContent = '(function(){' + PRISM_SRC + '\nwindow.__PG_PRISM__ = typeof Prism !== "undefined" ? Prism : null;})();';
					document.head.appendChild(sc);
					prism = (typeof window !== 'undefined' && window.__PG_PRISM__) || null;
				} catch (e2) { console.warn('[permgate] prism init via script failed:', e2); }
				finally {
					// 恢复宿主 window.Prism 与清理 __PG_PRISM__ 放在 finally：执行段内任一步抛错
					// （如 document.head 为 null 时 appendChild 失败）也不会跳过恢复，
					// 避免宿主 Prism 被 vendored 实例静默替换（global 存在的宿主环境）。
					if (typeof window !== 'undefined') {
						if ('__PG_PRISM__' in window) {
							try { delete window.__PG_PRISM__ } catch (e3) { try { window.__PG_PRISM__ = null } catch (e5) {} }
						}
						try {
							if (prevPrism === undefined) delete window.Prism;
							else window.Prism = prevPrism;
						} catch (e4) {}
					}
				}
			}
			PG_PRISM = prism;
		}
		// 扩展名 → Prism 语言
		const PRISM_LANG_BY_EXT = {
			js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx',
			ts: 'typescript', tsx: 'tsx',
			json: 'json', jsonc: 'json', yml: 'yaml', yaml: 'yaml',
			md: 'markdown', markdown: 'markdown',
			css: 'css', html: 'markup', htm: 'markup', xml: 'markup', svg: 'markup',
			sh: 'bash', bash: 'bash', cmd: 'batch', bat: 'batch', ps1: 'powershell',
			py: 'python', c: 'c', h: 'cpp', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
			cs: 'csharp', java: 'java', go: 'go', rs: 'rust', sql: 'sql',
			ini: 'ini', cfg: 'ini', conf: 'ini', toml: 'toml', properties: 'properties',
			gradle: 'groovy', diff: 'diff', patch: 'diff',
		};
		function prismLangFor(file) {
			const base = String(file || '').split(/[\\/]/).pop() || '';
			const idx = base.lastIndexOf('.');
			if (idx <= 0) return null;
			const lang = PRISM_LANG_BY_EXT[base.slice(idx + 1).toLowerCase()];
			return lang && PG_PRISM && PG_PRISM.languages[lang] ? lang : null;
		}
		// 语法高亮单侧文本上限（128KB）：整段 tokenize 在 UI 主线程同步执行，超大文件降级纯文本
		const HIGHLIGHT_MAX_CHARS = 131072
		// 从 ops 重建完整 old/new 文本（gap 携带隐藏行；缺失时返回 null 放弃高亮），
		// 并同步收集每行在文本中的位置对应的真实文件行号（oldNums/newNums），供客户端
		// 按行号 Map 取高亮（changesOnly 过滤后文本非连续，不能再用「行号-首行」偏移索引）。
		// 拼接过程中累计长度，任一侧一旦超过 HIGHLIGHT_MAX_CHARS 立即中止返回 null——
		// 避免对超大 payload（gap 最多携带 10 万行隐藏行，见 index.js pushCtxRun）先整段
		// 拼接再丢弃，白白付出主线程内存与拷贝成本。
		function prismTextsFromOps(ops) {
			const oldParts = [];
			const newParts = [];
			const oldNums = [];
			const newNums = [];
			let oldLen = 0;
			let newLen = 0;
			const over = () => oldLen > HIGHLIGHT_MAX_CHARS || newLen > HIGHLIGHT_MAX_CHARS
			for (const op of ops || []) {
				if (op.t === 'g') {
					if (!op.lines) return null;
					for (const l of op.lines) {
						oldParts.push(l.s); newParts.push(l.s);
						oldNums.push(l.o); newNums.push(l.n);
						oldLen += l.s.length + 1; newLen += l.s.length + 1;
						if (over()) return null;
					}
				} else if (op.t === 'a') { newParts.push(op.s); newNums.push(op.n); newLen += op.s.length + 1; if (over()) return null }
				else if (op.t === 'd') { oldParts.push(op.s); oldNums.push(op.o); oldLen += op.s.length + 1; if (over()) return null }
				else { oldParts.push(op.s); newParts.push(op.s); oldNums.push(op.o); newNums.push(op.n); oldLen += op.s.length + 1; newLen += op.s.length + 1; if (over()) return null }
			}
			return { oldText: oldParts.join('\n'), newText: newParts.join('\n'), oldNums, newNums };
		}
		// HTML 转义（高亮行与纯文本降级行共用同一规则，避免两处漂移导致转义不一致）
		const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
		// 整段 tokenize 后按行切分：跨行 token（字符串/块注释）在换行处关闭并在下一行重开 span，
		// 每行得到独立完整的 HTML。返回行数组（行 i 对应文本第 i+1 行），失败返回 null。
		function prismHighlightLines(text, lang) {
			if (!PG_PRISM || !lang || !PG_PRISM.languages[lang]) return null;
			try {
				const tokens = PG_PRISM.tokenize(text, PG_PRISM.languages[lang]);
				const lines = [];
				let cur = [];
				const open = [];
				const nl = () => {
					for (let i = 0; i < open.length; i++) cur.push('</span>');
					lines.push(cur.join(''));
					cur = [];
					for (let i = 0; i < open.length; i++) cur.push('<span class="token ' + open[i] + '">');
				};
				const emitText = (s) => {
					const parts = s.split('\n');
					cur.push(escapeHtml(parts[0]));
					for (let i = 1; i < parts.length; i++) { nl(); cur.push(escapeHtml(parts[i])) }
				};
				const walk = (toks) => {
					for (const t of toks) {
						if (typeof t === 'string') { emitText(t); continue }
						const type = String(t.type);
						cur.push('<span class="token ' + type + '">');
						open.push(type);
						if (typeof t.content === 'string') emitText(t.content);
						else walk(t.content);
						open.pop();
						cur.push('</span>');
					}
				};
				walk(tokens);
				for (let i = 0; i < open.length; i++) cur.push('</span>');
				lines.push(cur.join(''));
				return lines;
			} catch (e) { return null }
		}
		// 分块高亮：按行数与字符预算分块 tokenize，块间跨行 token 断开（与 changesOnly 相同
		// 取舍）；配合 idle 调度逐块让出主线程，避免整段文本一次 tokenize 长时间占用主线程。
		// 返回逐步执行器：step() 处理下一块并返回是否还有剩余块，result 为累计的行 HTML。
		const CHUNK_LINES = 400
		const CHUNK_CHARS = 16384
		function chunkHighlighter(text, lang) {
			const lines = text.split('\n');
			const out = [];
			let pos = 0;
			let failed = false;
			// 任一行超过字符预算（length >= CHUNK_CHARS，与下方首行守卫同一阈值）：
			// 行首则整行按纯文本转义输出；位于块中段则提前断开块、把该行留给下一轮首行
			// 守卫处理——保证任何一次 tokenize 的输入都不含超长行，避免同步阻塞主线程。
			const step = () => {
				if (failed || pos >= lines.length) return false;
				let end = pos;
				let bytes = 0;
				while (end < lines.length && (end - pos) < CHUNK_LINES && bytes < CHUNK_CHARS) {
					if (end > pos && lines[end].length >= CHUNK_CHARS) break;
					bytes += lines[end].length + 1;
					end++;
				}
				if (end === pos + 1 && bytes > CHUNK_CHARS) {
					out.push(escapeHtml(lines[pos]));
					pos = end;
					return pos < lines.length;
				}
				const chunk = lines.slice(pos, end).join('\n');
				const html = prismHighlightLines(chunk, lang);
				if (html === null) { failed = true; return false }
				for (const h of html) out.push(h);
				pos = end;
				return pos < lines.length;
			};
			return { step, result: out, failed: () => failed };
		}
		// idle 调度封装：优先 requestIdleCallback（带兜底超时），无则 setTimeout；返回取消函数。
		function scheduleIdle(fn, timeout) {
			if (typeof requestIdleCallback === 'function') {
				const id = requestIdleCallback(fn, { timeout });
				return () => { try { cancelIdleCallback(id) } catch (e) {} };
			}
			const id = setTimeout(fn, 0);
			return () => clearTimeout(id);
		}
		// 高亮结果缓存：key 为 diffCache 数据对象（引用稳定）。同一数据在抽屉重开/
		// 详情重展开（组件重挂载）时直接复用已完成的行 HTML，避免重复分块 tokenize。
		const diffHlCache = new WeakMap();
		const readHlCache = new WeakMap();
		// 分块渐进高亮 hook（DiffBlock old/new 双侧与 ReadBlock 单侧共用同一实现，
		// 避免两份状态机漂移）：首次使用时同步 ensurePrism（惰性初始化），idle 调度
		// 逐块 tokenize，完成前返回 null（首渲染纯文本、渐进补高亮）；结果写入 cache
		// （按 data 引用缓存），重挂载直接复用。
		function useProgressiveHighlight(text, file, cache) {
			const [lineHtml, setLineHtml] = React.useState(() => (cache && cache.text === text) ? cache.html : null);
			React.useEffect(() => {
				ensurePrism();
				const lang = prismLangFor(file);
				if (text == null || text.length > HIGHLIGHT_MAX_CHARS || !lang) { setLineHtml(null); return undefined }
				if (cache && cache.text === text && cache.html) return undefined
				let alive = true;
				const H = chunkHighlighter(text, lang);
				let cancel = null;
				const work = () => {
					if (!alive) return;
					const more = H.step();
					if (H.failed()) { setLineHtml(null); return }
					if (more) { cancel = scheduleIdle(work, 2000); return }
					if (cache) { cache.text = text; cache.html = H.result }
					setLineHtml(H.result);
				};
				cancel = scheduleIdle(work, 2000);
				return () => { alive = false; if (cancel) cancel() };
			}, [text, file]);
			return lineHtml;
		}

		const ROUTES = {
			'permgate:status': ['GET', '/permgate/status'],
			// 模型目录（provider / 模型 / 推理强度）：只读、按 provider+model 查询。
			// 不放进 status：那条视图被面板反复取，而本路由可能走网络（见宿主侧注释）。
			'permgate:llm-models': ['GET', '/permgate/llm-models'],
			// 决策记录的展开通道：statusView 只带首屏 10 条，展开时按需取全量。
			'permgate:decisions': ['GET', '/permgate/decisions'],
			'permgate:pending': ['GET', '/permgate/pending'],
			'permgate:file-diff': ['POST', '/permgate/file-diff'],
			'permgate:decide': ['POST', '/permgate/decide'],
			// 取消本条审批的自动结案倒计时（宿主清定时器 → 转永不超时）。
			// 「停止倒计时」必须走这条通道：超时的权威作者是宿主，只改本地 state
			// 拦不住到点自动结案（onTimeout === 'allow' 时即自动放行）。
			'permgate:cancel-timeout': ['POST', '/permgate/cancel-timeout'],
			'permgate:set-sandbox': ['POST', '/permgate/set-sandbox'],
			'permgate:set-categories': ['POST', '/permgate/set-categories'],
			'permgate:set-category': ['POST', '/permgate/set-category'],
			'permgate:set-command-sub': ['POST', '/permgate/set-command-sub'],
			'permgate:set-doomloop': ['POST', '/permgate/set-doomloop'],
			// 自动审批的工程参数（超时/熔断/缓存/模型覆盖）：**只有全局层**，
			// 故不传 target（理由见宿主路由处注释：这些参数不该跟着项目变）。
			'permgate:set-auto-review': ['POST', '/permgate/set-auto-review'],
			// 额外审批策略 + 高风险处置的两维。与上面那条分开：这条**两层都能写**
			// （项目层可以有一套与全局不同的规则），故 target 由调用方显式给。
			'permgate:set-auto-policy': ['POST', '/permgate/set-auto-policy'],
			'permgate:set-quick': ['POST', '/permgate/set-quick'],
			'permgate:add-exception': ['POST', '/permgate/add-exception'],
			// 就地修改一条例外（保 id、保下标）。**不是** add/remove 的组合：
			// 那个组合会把这条例外挪到数组末尾，而顺序即优先级（见宿主 setExceptionEntry）。
			'permgate:set-exception': ['POST', '/permgate/set-exception'],
			'permgate:remove-exception': ['POST', '/permgate/remove-exception'],
			'permgate:add-rule': ['POST', '/permgate/add-rule'],
			'permgate:remove-rule': ['POST', '/permgate/remove-rule'],
			// 排序：规则与例外共用（kind 区分），顺序即优先级。
			'permgate:reorder': ['POST', '/permgate/reorder'],
			'permgate:reload': ['POST', '/permgate/reload'],
			'permgate:open-config': ['POST', '/permgate/open-config'],
			// permgate:open-file 通道已移除：打开文件改走客户端 ctx.sidebarRight，不再回宿主跑 cmd /c start
			'permgate:set-fallback': ['POST', '/permgate/set-fallback'],
		};
		function call(method, args) {
			const entry = ROUTES[method] || ['GET', '/permgate/status'];
			const m = entry[0];
			let path = entry[1];
			// 附带当前 dsh 语言（zh/en），宿主按语言返回 reason 等文案；缺失/非法由宿主回退中文
			const lang = (LC && LC.locale && typeof LC.locale.getLocale === 'function') ? LC.locale.getLocale().active : 'zh';
			const opts = { method: m, headers: { accept: 'application/json' } };
			const extra = args || {};
			if (m === 'POST') {
				opts.headers['content-type'] = 'application/json';
				opts.body = JSON.stringify(Object.assign({}, extra, { lang }));
			} else {
				const q = ['lang=' + encodeURIComponent(lang)];
				for (const k of Object.keys(extra)) {
					const v = extra[k];
					if (v !== undefined && v !== null && v !== '') q.push(k + '=' + encodeURIComponent(String(v)));
				}
				path = path + (path.indexOf('?') === -1 ? '?' : '&') + q.join('&');
			}
			// 信任栅栏拒绝（403/401）不是业务数据：宿主在这条路径上只回 { error, code }，没有 status 视图。
			// 若照旧把它当普通响应交给调用方，/permgate/status 的 403 body 会被 applyStatus 当成一份
			// 「全 ask/inherit」的假配置渲染（它只判 if(!s) return），/permgate/pending 的 403 body 经
			// Array.isArray 兜底变成空数组 —— 审批卡片凭空消失、用户点不到任何按钮，而这类审批按设计
			// 会一直等下去。故统一在此转成可识别的错误，让各调用方已有的 catch / r.error 分支去报。
			function fenceErrorOf(r) {
				if (!r || typeof r !== 'object') return null;
				if (r.code === 'untrusted-origin') return T('panel.fenceUntrusted');
				if (r.code === 'unauthenticated') return T('panel.fenceUnauthenticated');
				return null;
			}
			// 非 2xx 一律 reject：调用方走各自已有的错误分支（报错、不误渲染），
			// 而不是把一个错误体当成合法 status/pending 数据消化掉。
			// 消息优先取宿主给的文案：宿主有若干非 2xx 是带真实原因的
			// （decide 失败 500、未知路由 404、路由异常 500），只回 'HTTP 500'
			// 会把这些原因吞掉，用户看到的信息量比改动前还少。
			return fetch(path, opts).then((r) => {
				if (!r.ok) {
					return r.json().catch(() => null).then((body) => {
						const err = new Error(fenceErrorOf(body) || (body && body.error) || ('HTTP ' + r.status));
						err.status = r.status;
						err.code = (body && body.code) || null;
						throw err;
					});
				}
				return r.json();
			});
		}

		// SSE 事件订阅：/permgate/events 长连接推送（状态/待审批变化即时刷新，替代轮询）
		let eventSource = null;
		const eventListeners = new Set();
		// 栅栏拒绝的会话级标记：置位后不再反复建连（EventSource 对 403 会一直自动重连，
		// 而每次重连都被拒 —— 既是日志噪音，也让面板永远停在「没有待审批」的假象里）。
		let fenceBlocked = null;
		function notifyEvents(data) {
			for (const fn of Array.from(eventListeners)) { try { fn(data); } catch (e) {} }
		}
		function ensureEventSource() {
			if (eventSource || fenceBlocked) return;
			eventSource = new EventSource('/permgate/events');
			eventSource.onmessage = (ev) => {
				let data = null;
				try { data = JSON.parse(ev.data); } catch (e) {}
				if (data) notifyEvents(data);
			};
			// 首连与断线重连成功都会触发：全量刷新兜底，收敛重连期间丢失的事件
			eventSource.onopen = () => { fenceBlocked = null; notifyEvents({ type: 'refresh' }); };
			// EventSource 不暴露状态码，无法直接区分「普通断线」与「被栅栏拒绝」。
			// 用一次轻量探测判定：只有确实是栅栏错误才停掉重连并上报，
			// 普通断线仍交给 EventSource 自动重连（否则会把网络抖动当成权限问题）。
			eventSource.onerror = () => {
				if (fenceBlocked) return;
				call('permgate:status', {}).catch((e) => {
					if (!e || (e.code !== 'untrusted-origin' && e.code !== 'unauthenticated')) return;
					fenceBlocked = e.code;
					if (eventSource) { try { eventSource.close(); } catch (err) {} eventSource = null; }
					notifyEvents({ type: 'fence', code: e.code, message: String((e && e.message) || '') });
				});
			};
		}
		// 供面板读取当前栅栏状态（面板据此报错而不是渲染一份空配置）
		//
		// ⚠️ 这两个函数目前**没有调用方**（eslint 因此报 no-unused-vars，是本文件仅有的两条
		// 该类警告）。**刻意保留，不是死代码**：`fenceBlocked` 是栅栏机制的实际状态
		// （:511 阻止无谓重连、:524 抑制重复上报、:527 置位），而它是**只写不读**的 ——
		// 面板侧要按栅栏状态报错（而不是渲染一份空配置）时，唯一的读入口就是这两个。
		// 删掉它们会让状态彻底不可读，将来接线时还得原样加回来。
		// 若确要清理：请在面板侧接线**之后**连同消费点一起删，而不是现在单独删这两个。
		function fenceState() { return fenceBlocked; } // eslint-disable-line no-unused-vars
		function retryEvents() { fenceBlocked = null; ensureEventSource(); } // eslint-disable-line no-unused-vars
		function subscribeEvents(fn) {
			eventListeners.add(fn);
			ensureEventSource();
			return () => {
				eventListeners.delete(fn);
				if (eventListeners.size === 0 && eventSource) {
					try { eventSource.close(); } catch (e) {}
					eventSource = null;
				}
			};
		}

		// ── 权限选择器图标兼容层（参照 dsh-auto-approve 的 DOM best-effort 方案）──
		// rc.6 的权限选择器不提供自定义 preset 图标 API（glyph 为内置三个 key 硬编码）。
		// 这里用 MutationObserver 识别「自定义审查」的触发器与菜单项，注入盾牌+放大镜
		// svg 徽标（-webkit-mask 跟随 currentColor）。依赖 DOM 结构与无障碍文案，
		// dsh 升级后可能失效——仅影响图标显示，不影响审查功能。
		const PG_STYLE = 'data-dsh-permgate-style';
		const PG_CUSTOM_LABEL = '自定义审查';
		const PG_NAME_ZH = '自定义审查';
		const PG_NAME_EN = 'Custom Review';
		const PG_DESC_ZH = '按分类逐项审查工具调用；被底层沙箱拒绝时弹出升级审批';
		const PG_DESC_EN = 'Per-category tool review; sandbox denials trigger an upgrade approval';
		const PG_PERMISSION_LABELS = new Set(['Read Only', 'Workspace Write', '自定义审查', 'Custom Review', 'Full access', '仅可查看', '工作区内修改', '完全权限']);
		const PG_TRIGGER_PREFIXES = ['访问模式，当前：', 'Access mode, current: '];
		const PG_TRIGGER_SELECTOR = ['button[aria-label^="访问模式，当前："]', 'button[aria-label^="Access mode, current: "]'].join(',');
		// 设置页导航行：平台把每个 settings.section 渲染成对话框内 <nav> 里的 <button>
		// （SettingsPanel）。用语义结构而非 CSS Module 类名（那串 VOzbGW_ 前缀是构建期
		// 哈希，DSH 升级会变），与 dshmarket 的 NAV_ROW_SELECTOR 同口径。
		const PG_NAV_ICON_ATTR = 'data-pg-nav-icon';
		const PG_NAV_ROW_SELECTOR = '[role="dialog"] nav button';
		// 图标绘制语言对齐平台内置图标（dsh-client-ui-conversation 的 permissionGlyphs）：
		// 盾牌轮廓用 stroke-width 1.31831，内部符号一律用「实心 fill」——
		// 仅可查看是对勾、工作区内修改是线条、完全权限是两根 1.5 宽的实心条。
		// 早先放大镜用细描边（1.2/1.4），在菜单里与那三个实心图标并列时显得细弱发灰。
		const PG_SVG_OPEN = 'url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22 fill=%22none%22%3E';
		const PG_SVG_CLOSE = '%3C/svg%3E")';
		const PG_SHIELD = '%3Cpath d=%22M8.20554%200.899994L14.7901%203.36857V7.01026C14.7901%2012%2011.0466%2014.2103%208.20554%2015.3C5.36446%2014.2103%201.62012%2012%201.62012%207.01026V3.36857L8.20554%200.899994Z%22 stroke=%22black%22 stroke-width=%221.31831%22 stroke-linejoin=%22round%22/%3E';
		// 放大镜：圆环做成「实心圆环」（evenodd 双圆相减，环宽 1.3 ≈ 盾牌描边宽度），
		// 手柄为实心斜条。平台三个内置图标的内部符号一律是实心 fill（对勾/线条/感叹号），
		// 若这里用描边圆环，在同一列里会比它们明显偏重。
		const PG_MASK = PG_SVG_OPEN + PG_SHIELD +
			'%3Cpath d=%22M3.8%206.85a3.35%203.35%200%201%200%206.7%200a3.35%203.35%200%201%200-6.7%200Z%20M5.1%206.85a2.05%202.05%200%201%200%204.1%200a2.05%202.05%200%201%200-4.1%200Z%22 fill=%22black%22 fill-rule=%22evenodd%22/%3E' +
			'%3Cpath d=%22M9.73%208.37L11.85%2010.49L10.79%2011.55L8.67%209.43Z%22 fill=%22black%22/%3E' +
			PG_SVG_CLOSE;
		// 锁孔（受限沙箱 workspace-write）：实心圆 + 实心梯形柄，同为实心画法
		const PG_MASK_LOCK = PG_SVG_OPEN + PG_SHIELD +
			'%3Ccircle cx=%228%22 cy=%226.6%22 r=%221.55%22 fill=%22black%22/%3E' +
			'%3Cpath d=%22M7.32%207.65L8.68%207.65L8.48%2010.7L7.52%2010.7Z%22 fill=%22black%22/%3E' +
			PG_SVG_CLOSE;
		// 设置页导航图标（盾牌 + 闸门）：盾牌轮廓已被上面两个图标占用
		// （放大镜=审查、锁孔=受限沙箱），导航再用同款内部符号会三者难辨，
		// 故改用「顶梁 + 三根栅条」的闸门/栅栏形——呼应「权限网关」与插件名
		// permgate 的 gate。绘制语言同上：内部符号一律实心 fill + 小圆角。
		// 形状是逐个渲染比对后定的（16px 实际尺寸下）：单柱+斜杆读成「7」、
		// 双柱+斜杆读成「H」、两立柱+顶梁的门框读成「门牙」、三横杠读成「≡」
		// （与汉堡菜单撞义）、单横杠读成「−」；只有「顶梁+三栅」稳定读作闸门。
		const PG_NAV_MASK = PG_SVG_OPEN + PG_SHIELD +
			'%3Crect x=%224.6%22 y=%225.3%22 width=%226.8%22 height=%221.3%22 rx=%220.4%22 fill=%22black%22/%3E' +
			'%3Crect x=%225.2%22 y=%226.6%22 width=%221.1%22 height=%224.6%22 rx=%220.3%22 fill=%22black%22/%3E' +
			'%3Crect x=%227.45%22 y=%226.6%22 width=%221.1%22 height=%224.6%22 rx=%220.3%22 fill=%22black%22/%3E' +
			'%3Crect x=%229.7%22 y=%226.6%22 width=%221.1%22 height=%224.6%22 rx=%220.3%22 fill=%22black%22/%3E' +
			PG_SVG_CLOSE;
		// 同一枚道闸的**内联 SVG** 版本，给 `settings.section.icon` 槽用。
		// 上面那个 data: URI 只能喂 CSS mask；槽位要的是 React 组件，两者不能共用字符串。
		// 几何与 PG_NAV_MASK 逐字一致 —— 分叉会让「新版走槽位、旧版走 CSS」两种显示不同，
		// 而那种差异只在特定 DSH 版本上出现，极难对照排查。
		const PG_NAV_SVG = (props) => {
			const size = props && typeof props.size === 'number' ? props.size : 16;
			return React.createElement('svg', {
				width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
				'aria-hidden': 'true', style: { display: 'block' },
			},
				React.createElement('path', {
					d: 'M8.20554 0.899994L14.7901 3.36857V7.01026C14.7901 12 11.0466 14.2103 8.20554 15.3C5.36446 14.2103 1.62012 12 1.62012 7.01026V3.36857L8.20554 0.899994Z',
					stroke: 'currentColor', strokeWidth: 1.31831, strokeLinejoin: 'round',
				}),
				React.createElement('rect', { x: 4.6, y: 5.3, width: 6.8, height: 1.3, rx: 0.4, fill: 'currentColor' }),
				React.createElement('rect', { x: 5.2, y: 6.6, width: 1.1, height: 4.6, rx: 0.3, fill: 'currentColor' }),
				React.createElement('rect', { x: 7.45, y: 6.6, width: 1.1, height: 4.6, rx: 0.3, fill: 'currentColor' }),
				React.createElement('rect', { x: 9.7, y: 6.6, width: 1.1, height: 4.6, rx: 0.3, fill: 'currentColor' }),
			);
		};
		// 平台内置的「未匹配态」显示名：预设表按 (sandbox, approval) 反查不到任何表项时，
		// 客户端（dsh-client-connection 的 fixture 预设表）兜底渲染这个字符串。
		const PG_CUSTOM_BUILTIN = 'Custom';
		// ── 审批方块（缩小态）的分类图标 ─────────────────────────────────────
		// decide() 的 cat 不只 8 个分类，还有 custom/quick/fallback 三个特殊值
		// 与 null（未选审查 / 命令全命中例外 / 兜底 allow），共 11 种，全部要图标。
		// 自绘内联 mask（不 require 平台 ui-primitives）：平台图标集没有图片类图标，
		// 混用会两套绘制语言并存；且新增 require 会引入「平台改导出名即崩」的风险。
		// 绘制语言：16×16 视口、圆角 rx。**外框**沿用盾牌的描边画法（stroke 1.3 ≈ 盾牌的
		// 1.31831），**内部符号**尽量用实心 fill —— 但注意本表并非全部合规：
		// command 的提示符、undo 的双箭头、doomloop 的圆环、custom 的对勾仍是描边
		// （1.2/1.3/1.4）。上面 380-385 行的约定（「内部符号一律实心 fill」）记录了
		// 「细描边在菜单里与实心图标并列会显得细弱发灰」，故这几处属于**已知偏离**：
		// 线状字形（折线/箭头/圆环）改成实心需重绘几何，未在无视觉验证的情况下改动。
		// 若后续统一，优先按 PG_MASK 放大镜的做法（evenodd 双圆相减）处理圆环。
		const PG_CAT_ICON = (function () {
			// 每条是「内部符号」的 SVG 片段，外层共用 PG_SVG_OPEN/CLOSE
			const shapes = {
				// 编辑：铅笔（斜杆 + 笔尖三角）
				edit: '%3Cpath d=%22M10.9 2.6l2.5 2.5-7.4 7.4-3.1.6.6-3.1z%22 fill=%22black%22/%3E',
				// 读取：文档（外框 + 三行文本）
				read: '%3Cpath d=%22M4.4 2.2h5l3.2 3.2v8.4H4.4z%22 fill=%22none%22 stroke=%22black%22 stroke-width=%221.3%22 stroke-linejoin=%22round%22/%3E' +
					'%3Cpath d=%22M6.2 7.4h4.6v1.1H6.2zM6.2 9.6h4.6v1.1H6.2z%22 fill=%22black%22/%3E',
				// 命令：终端（外框 + 提示符折线）
				command: '%3Crect x=%222.2%22 y=%223.2%22 width=%2211.6%22 height=%229.6%22 rx=%221.6%22 fill=%22none%22 stroke=%22black%22 stroke-width=%221.3%22/%3E' +
					'%3Cpath d=%22M4.8 6.4l1.9 1.7-1.9 1.7%22 fill=%22none%22 stroke=%22black%22 stroke-width=%221.3%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22/%3E' +
					'%3Cpath d=%22M8.4 10.2h3.1v1.1H8.4z%22 fill=%22black%22/%3E',
				// 目录（区外写闸）：文件夹（实心）
				directory: '%3Cpath d=%22M2.2 4.6c0-.7.6-1.3 1.3-1.3h2.6l1.3 1.4h5.1c.7 0 1.3.6 1.3 1.3v5.7c0 .7-.6 1.3-1.3 1.3H3.5c-.7 0-1.3-.6-1.3-1.3z%22 fill=%22black%22/%3E',
				// 区外读取：同一个文件夹的**线框**形态 + 向外的箭头。
				// 与 directory（实心文件夹）成对：两道区外闸在面板上相邻，同族不同形态便于一眼配对；
				// 箭头朝外表示「这个闸管的是往工作区外看」，与实心那个（管往外写）区分开。
				// 不能沿用 read 的文档图标：那会让「区外读取」与「读取文件」在弹窗缩小方块里撞脸。
				outsideRead: '%3Cpath d=%22M2.2 4.6c0-.7.6-1.3 1.3-1.3h2.6l1.3 1.4h5.1c.7 0 1.3.6 1.3 1.3v5.7c0 .7-.6 1.3-1.3 1.3H3.5c-.7 0-1.3-.6-1.3-1.3z%22 fill=%22none%22 stroke=%22black%22 stroke-width=%221.3%22 stroke-linejoin=%22round%22/%3E' +
					'%3Cpath d=%22M5.9 8.5h3.7M8.1 6.9l1.6 1.6-1.6 1.6%22 fill=%22none%22 stroke=%22black%22 stroke-width=%221.3%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22/%3E',
				// 图片：山峦 + 太阳（平台图标集没有图片类图标，必须自绘）
				image: '%3Crect x=%222.2%22 y=%223.2%22 width=%2211.6%22 height=%229.6%22 rx=%221.6%22 fill=%22none%22 stroke=%22black%22 stroke-width=%221.3%22/%3E' +
					'%3Ccircle cx=%225.6%22 cy=%226.4%22 r=%221.1%22 fill=%22black%22/%3E' +
					'%3Cpath d=%22M3.4 11.6l3.2-3.4 2.3 2.4 1.7-1.8 2 2.1z%22 fill=%22black%22/%3E',
				// 撤销：逆时针回转箭头
				undo: '%3Cpath d=%22M6.2 4.2H3.1V1.1%22 fill=%22none%22 stroke=%22black%22 stroke-width=%221.3%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22/%3E' +
					'%3Cpath d=%22M3.4 4.6a5.2 5.2 0 1 1-1.1 3.4%22 fill=%22none%22 stroke=%22black%22 stroke-width=%221.3%22 stroke-linecap=%22round%22/%3E',
				// 子代理：两个人形
				subagent: '%3Ccircle cx=%226.1%22 cy=%225.9%22 r=%221.9%22 fill=%22black%22/%3E' +
					'%3Cpath d=%22M2.3 12.6c0-2.1 1.7-3.4 3.8-3.4s3.8 1.3 3.8 3.4z%22 fill=%22black%22/%3E' +
					'%3Ccircle cx=%2211.4%22 cy=%226.6%22 r=%221.4%22 fill=%22black%22/%3E' +
					'%3Cpath d=%22M10.1 12.6c0-1.5.6-2.5 1.5-2.9 1.3.2 2.2 1.3 2.2 2.9z%22 fill=%22black%22/%3E',
				// 重复操作：环形箭头（doom loop）
				doomloop: '%3Cpath d=%22M13 8a5 5 0 1 1-1.6-3.7%22 fill=%22none%22 stroke=%22black%22 stroke-width=%221.4%22 stroke-linecap=%22round%22/%3E' +
					'%3Cpath d=%22M12.9 2.1l.3 3.1-3.1.3z%22 fill=%22black%22/%3E',
				// 自定义规则命中：清单 + 对勾
				custom: '%3Cpath d=%22M3 2.4h7.2v11.2H3z%22 fill=%22none%22 stroke=%22black%22 stroke-width=%221.3%22 stroke-linejoin=%22round%22/%3E' +
					'%3Cpath d=%22M4.7 5.6l1 1 1.8-1.9%22 fill=%22none%22 stroke=%22black%22 stroke-width=%221.2%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22/%3E' +
					'%3Cpath d=%22M8.4 5.2h1.3v1.1H8.4zM4.7 9.1h5v1.1h-5z%22 fill=%22black%22/%3E',
				// 快捷工具：闪电
				quick: '%3Cpath d=%22M9.1 1.4L3.6 8.6h3.2l-1 6 5.6-7.3H8.2z%22 fill=%22black%22/%3E',
				// 兜底策略：问号
				fallback: '%3Cpath d=%22M8 2.2a3.5 3.5 0 0 1 1.5 6.6c-.6.3-.9.7-.9 1.3v.5H7.1v-.7c0-1.2.6-1.9 1.5-2.4A2.1 2.1 0 1 0 5.9 5.6H4.4A3.5 3.5 0 0 1 8 2.2z%22 fill=%22black%22/%3E' +
					'%3Ccircle cx=%228%22 cy=%2213%22 r=%221.1%22 fill=%22black%22/%3E',
				// 通用（cat 为 null 时用；文字改显示工具名）：扳手
				generic: '%3Cpath d=%22M10.9 1.9a3.9 3.9 0 0 0-3.4 5.8L2.2 13l1.4 1.4 5.3-5.3a3.9 3.9 0 0 0 4.9-5l-2.2 2.2-1.9-.4-.4-1.9z%22 fill=%22black%22/%3E',
			};
			const out = {};
			for (const k of Object.keys(shapes)) out[k] = PG_SVG_OPEN + shapes[k] + PG_SVG_CLOSE;
			return out;
		})();
		// 分类短名不在这里另存一份：它们是 UI 文案，统一放 I18N 的 catS.* 键、经 T() 取用
		// （见 pgCatText）。此前这里有一份 PG_CAT_LABEL 平行表 + 一个零引用的
		// PG_CAT_ICON_KEYS，与 I18N 的 cat.* 长名三份清单各自维护 —— 改名或新增分类时
		// 必然漂移，且漂移不报错（只静默换文案或回落工具名）。
		const PG_CSS = '\n' +
			// 触发器徽标：纯 CSS 按 aria-label 选择（平台 t() 本地化前缀 + 两种语言的
			// 预设名，四个变体全覆盖）。无需 JS 打标，跟随语言/预设自动显示，重渲染不丢失。
			'button[aria-label^="访问模式，当前：自定义审查"]::before,' +
			'button[aria-label^="Access mode, current: 自定义审查"]::before,' +
			'button[aria-label^="访问模式，当前：Custom Review"]::before,' +
			'button[aria-label^="Access mode, current: Custom Review"]::before' +
			' { content: ""; display: inline-block; flex: 0 0 auto; width: 14px; height: 14px; margin-right: 4px; background-color: currentColor; -webkit-mask: ' + PG_MASK + ' center / contain no-repeat; mask: ' + PG_MASK + ' center / contain no-repeat; }\n' +
			// 受限沙箱变体：JS 仅在「本会话确实选中自定义审查且沙箱受限」时给触发器打
			// data-pg-sandbox，换用锁孔图标（与默认的盾牌+放大镜成对）。workspace-write
			// 与 read-only 都是受限，两者共用锁孔（都表示「写盘受限」）。
			'button[data-pg-sandbox][aria-label^="访问模式，当前：自定义审查"]::before,' +
			'button[data-pg-sandbox][aria-label^="Access mode, current: 自定义审查"]::before,' +
			'button[data-pg-sandbox][aria-label^="访问模式，当前：Custom Review"]::before,' +
			'button[data-pg-sandbox][aria-label^="Access mode, current: Custom Review"]::before' +
			' { -webkit-mask: ' + PG_MASK_LOCK + ' center / contain no-repeat; mask: ' + PG_MASK_LOCK + ' center / contain no-repeat; }\n' +
			// 设置页导航图标：平台按 section id 从**闭集**里挑 glyph（models / agent-presets /
			// plugins），其余 id 一律回落到它自己的齿轮；settings.section 只投影
			// id/order/label，注册方**没有 icon 可传** —— 所以每个第三方 section 都是齿轮
			// （「权限网关」与「网络代理」都如此）。这里用 JS 给自己的那一行打标记，
			// 再用 CSS 藏掉齿轮、画上道闸。dshmarket / dsh-better-sidebar 用同一手法。
			// 只按 `> svg` 隐藏（不删节点）：那是 React 管理的元素，删了重渲染会出错。
			'[' + PG_NAV_ICON_ATTR + '] > svg { display: none; }\n' +
			'[' + PG_NAV_ICON_ATTR + ']::before' +
			' { content: ""; flex: 0 0 auto; width: 16px; height: 16px; background-color: currentColor; -webkit-mask: ' + PG_NAV_MASK + ' center / contain no-repeat; mask: ' + PG_NAV_MASK + ' center / contain no-repeat; }\n';
		const pgNoop = () => {};
		// ── 会话审查态缓存：DOM 兼容层要知道「当前会话是否真的选了自定义审查」以及
		//    「其底层沙箱是什么」。不能靠猜显示名——实测 315 个显示 Custom 的会话里
		//    有 48 个 preset=null（从没选过审查），无条件改写会让用户误以为审查开着。
		//    权威来源是宿主的 permgate:status（activeForSession 走 permission/preset
		//    事件，是按会话的）。写入方是 OverlayRoot（挂在 root 作用域、始终挂载）；
		//    早先还有作曲区下方的 DockBar 也写同一份缓存，该组件已整体删除。
		//    仅缓存「审查是否生效」与「沙箱」两个标量，按会话 id 分键，避免跨会话串。 ──
		let pgReviewActive = false;
		let pgReviewSandbox = null;
		// 缓存归属会话（= 当前正在显示的会话）：写入方 OverlayRoot 是按会话查询的，消费者
		// pgScanCustom 却作用于全文档触发器 —— 不校验归属就会在切会话的窗口期（或查询
		// 失败时）把上一个会话的审查态套到当前会话上。下面两个标量只对 pgReviewSid 有效。
		let pgReviewSid = null;
		// 查询序号：同一会话内只接受最新一次查询的结果，乱序到达的旧响应直接丢弃
		let pgReviewSeq = 0;
		let pgReviewSeqApplied = 0;
		// 状态更新后触发一次重扫（由 pgInstallCompat 填充；未安装时为 null）
		let pgRescan = null;
		// 进入/切换会话：登记当前会话，并清空上一个会话的缓存后立即重扫。
		// 宁可退回平台原生显示（Custom），也不把别的会话的审查态显示成当前会话的。
		// 平台选择器此刻原生显示哪个预设（'custom' = 内置未匹配态，即原生渲染 "Custom"）。
		// 与 pgReviewActive（审查是否生效）是两个独立事实，必须分开记：
		//   审查生效 + 平台渲染 Custom  → 需要我们改写
		//   审查生效 + 平台渲染审查名    → 平台自己就对，我们的改写标记已过期
		// 早先只用 pgReviewActive 判断，导致「沙箱从 fa 改到 ww」后平台已原生显示审查名、
		// 我们却仍留着改写标记，一旦状态查询失败就把平台原生文案误还原成 Custom。
		let pgPlatformPreset = null;
		// ── 新会话（hero）兜底槽位 ────────────────────────────────────────────────
		// 平台把「新会话界面」判为 hero 有两种成因（dsh-client-ui-conversation:14868）：
		//   const hero = sessionId === void 0 || shellPhase === "blank" && (openState === "open" || summaryBlank === true)
		// ① sessionId 为 undefined（刚启动、还没会话）
		// ② sessionId 有值但界面为 blank —— 点侧边栏「新对话」就是这一种
		// 成因②背后是一个真实存在的会话，必须按该会话查询其真实权限态（见 OverlayRoot），
		// 绝不能拿本槽位（全局新会话默认）冒充 —— 两者在「恢复的空白会话」「在 hero 里
		// 改过预设」等情形下会分叉。
		// 因此本槽位的读取还额外要求「确实没有当前会话」（pgCurrentSid 为空）。
		let pgDefaultActive = false;
		let pgDefaultSandbox = null;
		let pgDefaultPlatform = null;
		let pgDefaultSet = false;
		// 当前正在显示的会话 id（由 OverlayRoot 维护；它挂在 root 作用域，始终存在）。
		// 用途：区分「会话态为空」的两种成因 —— ① 确实没有会话（刚启动）② 会话仍存在
		// 但界面处于 hero（此时 OverlayRoot 仍会登记该会话，故 ② 下 pgReviewSid 非空）。
		// 只有 ① 才允许回落到新会话默认槽位；② 若回落，就是把「全局新会话默认」冒充成
		// 该会话的真实权限态（误报审查开着）。
		// 保留本标记而不复用 pgReviewSid 判断：pgReviewSid 是「缓存归属」，会随查询
		// 失败/清空而变，而 pgCurrentSid 是「界面当前显示哪个会话」这一独立事实，
		// 两者在查询未返回的窗口期并不一致。
		// 注意：本标记只在「会话 id 确实取得到」时才有意义。root 作用域槽拿不到平台注入的
		// props.sessionId，只能经 pgCurrentSessionId 自取；一旦该函数返回 undefined（快照
		// 形状不认识），这里就是 null，回落守卫会失效 —— 故 pgCurrentSessionId 必须覆盖
		// 平台实际使用的口径（见其定义处的两版兼容说明）。
		let pgCurrentSid = null;
		function pgSetCurrentSession(sid) {
			try {
				const key = sid || null;
				if (key === pgCurrentSid) return;
				pgCurrentSid = key;
				if (typeof pgRescan === 'function') pgRescan();
			} catch (e) {}
		}
		// 从会话列表快照派生「当前主视图会话」id：root 作用域槽（shell.overlay /
		// settings.section）拿不到平台注入的 props.sessionId，只能自取，这是唯一来源。
		// 两种权威口径，按平台版本兼容：
		//   ① 0.1.5：SessionListState 直接带 current 字段；
		//   ② 0.1.7 起：该字段被移除（只剩 ids/byId/phase/projectionsBySession），平台
		//      自身改用「retainedBy.mainView > 0」的行作为当前主视图会话 —— 见
		//      dsh-client-ui-layout 的 DocumentTitle 与 dsh-client-ui-workspace 的
		//      containsCurrent，三处同款表达式。
		// 只认这两种口径：都取不到就返回 undefined，由调用方按「无会话」保守处理
		// （宁可不显示，也不把别的会话的权限态冒充成当前会话的）。
		function pgCurrentSessionId(st) {
			try {
				if (!st) return undefined;
				if (typeof st.current === 'string' && st.current) return st.current;
				if (!st.byId) return undefined;
				const rows = Object.values(st.byId);
				for (const row of rows) {
					if (!row || !row.retainedBy) continue;
					if ((row.retainedBy.mainView || 0) > 0) return row.id || undefined;
				}
				return undefined;
			} catch (e) {
				return undefined;
			}
		}
		// 读取合并视图：会话态优先（OverlayRoot 按会话写入），确实无会话时才用新会话默认值。
		// pgScanCustom / pgEnsureMenuIcon 一律经此读取，避免各处各自判断而漏掉回落。
		function pgView() {
			if (pgReviewSid !== null) {
				return { active: pgReviewActive, sandbox: pgReviewSandbox, platform: pgPlatformPreset };
			}
			// 会话态为空：仅「确实没有当前会话」时才用新会话默认槽位。有会话却取不到它的
			// 状态（查询未返回/失败）时保守不动 —— 平台态未知的代价（退回显示 Custom）
			// 远小于误报（把没开审查的会话显示成开着）。
			if (pgCurrentSid === null && pgDefaultSet) {
				return { active: pgDefaultActive, sandbox: pgDefaultSandbox, platform: pgDefaultPlatform };
			}
			return { active: false, sandbox: null, platform: null };
		}
		function pgSetDefaultView(s) {
			try {
				const dv = s && s.defaultView;
				const nextSet = !!dv;
				const nextActive = !!(dv && dv.activeForSession === true);
				const nextSandbox = (dv && dv.sandbox) || null;
				const nextPlatform = (dv && typeof dv.platformPreset === 'string' && dv.platformPreset) || null;
				if (nextSet === pgDefaultSet && nextActive === pgDefaultActive && nextSandbox === pgDefaultSandbox && nextPlatform === pgDefaultPlatform) return;
				pgDefaultSet = nextSet;
				pgDefaultActive = nextActive;
				pgDefaultSandbox = nextSandbox;
				pgDefaultPlatform = nextPlatform;
				if (typeof pgRescan === 'function') pgRescan();
			} catch (e) {}
		}
		// 清空缓存时不做「立即还原」：切会话瞬间 DOM 的内容无法区分两种来源——
		//   (a) React 未写回（新旧会话 vdom 同字面量）→ DOM 是我们上次的改写，应还原；
		//   (b) React 已写回（新会话 vdom 不同）→ DOM 是新会话的平台权威值，绝不能动。
		// 两者 DOM 完全相同（都是「访问模式，当前：自定义审查」），无法区分；按 (a) 处理
		// 会在命中 (b) 时把「已开审查的新会话」误改成未匹配态 Custom，且清标记后不自愈。
		// 故这里只清空缓存，还原交给「新会话查询成功且平台仍渲染 Custom」这条唯一
		// 可靠的路径（canRestore）；平台态未知时保持不动是面对不可知情况的正确保守取舍。
		function pgBeginReviewSession(sid) {
			try {
				const key = sid || null;
				if (key === pgReviewSid) return; // 同一会话：保留已有缓存，等 refresh 收敛
				pgReviewSid = key;
				pgReviewActive = false;
				pgReviewSandbox = null;
				pgPlatformPreset = null;
				if (typeof pgRescan === 'function') pgRescan();
			} catch (e) {}
		}
		function pgSetReviewState(sid, s, seq) {
			try {
				// 只接受「当前会话」的结果：切走后到达的旧响应、以及查询失败时的
				// 兜底调用都不写入，避免跨会话串状态
				if ((sid || null) !== pgReviewSid) return;
				const n = typeof seq === 'number' ? seq : ++pgReviewSeq;
				if (n < pgReviewSeqApplied) return; // 过期响应（乱序到达），丢弃
				pgReviewSeqApplied = n;
				const nextActive = !!(s && s.activeForSession === true);
				const nextSandbox = (s && s.sandbox && s.sandbox.session) || null;
				const nextPlatform = (s && typeof s.platformPreset === 'string' && s.platformPreset) || null;
				if (nextActive === pgReviewActive && nextSandbox === pgReviewSandbox && nextPlatform === pgPlatformPreset) return;
				pgReviewActive = nextActive;
				pgReviewSandbox = nextSandbox;
				pgPlatformPreset = nextPlatform;
				if (typeof pgRescan === 'function') pgRescan();
			} catch (e) {
				pgReviewActive = false;
				pgReviewSandbox = null;
				pgPlatformPreset = null;
				if (typeof pgRescan === 'function') pgRescan();
			}
		}
		// 会话视图卸载：仅当它仍是「当前会话」时清空缓存。同样不做立即还原——卸载时
		// 触发器可能已属于下一个会话（DOM 复用），理由见 pgBeginReviewSession 上方注释。
		function pgEndReviewSession(sid) {
			try {
				if ((sid || null) !== pgReviewSid) return;
				pgReviewSid = null;
				pgReviewActive = false;
				pgReviewSandbox = null;
				pgPlatformPreset = null;
				if (typeof pgRescan === 'function') pgRescan();
			} catch (e) {}
		}
		function pgTriggerLabel(value) {
			return typeof value === 'string' && PG_TRIGGER_PREFIXES.some((p) => value.startsWith(p));
		}
		// 预设名/描述文本的语言化交换（best-effort DOM 层）：平台权限选择器对
		// preset name/description 无 i18n 钩子（内置项在两种语言下均为英文），
		// 这里在 en 语言下把「自定义审查」替换为 Custom Review（含触发器
		// aria-label），在 zh 语言下把残留的英文替换回中文。仅限定权限选择器
		// 相关表面（触发器/按钮/菜单/列表项），绝不触碰聊天内容等任意文本。
		function pgActiveLang() {
			// 三级回退：locale 服务 → <html lang> → 平台触发器 aria-label 前缀
			// （前缀是平台 t() 本地化渲染的，直接反映界面实际语言）
			try {
				const l = LC && LC.locale && typeof LC.locale.getLocale === 'function' ? LC.locale.getLocale().active : '';
				if (l === 'en' || l === 'zh') return l;
			} catch (e) {}
			try {
				const htmlLang = document.documentElement && document.documentElement.getAttribute && document.documentElement.getAttribute('lang');
				if (htmlLang === 'en' || htmlLang === 'zh') return htmlLang;
			} catch (e) {}
			try {
				const el = document.querySelector && document.querySelector(PG_TRIGGER_SELECTOR);
				const label = el && el.getAttribute && el.getAttribute('aria-label');
				if (typeof label === 'string') {
					if (label.indexOf('Access mode') !== -1) return 'en';
					if (label.indexOf('访问模式') !== -1) return 'zh';
				}
			} catch (e) {}
			return 'zh';
		}
		function pgSwapText(el, from, to) {
			try {
				if (!el || typeof el.textContent !== 'string') return;
				// 只原位修改直接文本子节点的值（nodeValue），绝不 textContent 赋值或
				// 替换节点：React 持有元素/文本节点引用，整体替换会破坏其子树结构
				// 导致渲染崩溃（曾因此打不开下拉框）。React 重渲染只会把同一文本
				// 节点的值改回，观察器再换回来，结构始终完好。
				for (const node of Array.from(el.childNodes || [])) {
					if (node.nodeType !== 3) continue;
					const v = node.nodeValue || '';
					if (v.indexOf(from) === -1) continue;
					const next = v.split(from).join(to);
					if (next !== v) node.nodeValue = next;
				}
			} catch (e) {}
		}
		function pgSwapAttr(el, attr, from, to) {
			try {
				const v = el.getAttribute && el.getAttribute(attr);
				if (typeof v !== 'string' || v.indexOf(from) === -1) return;
				const next = v.split(from).join(to);
				if (next !== v) el.setAttribute(attr, next);
			} catch (e) {}
		}
		const PG_SWAP_SELECTOR = 'button,[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"],[role="option"],[role="menu"],[role="listbox"]';
		// 就地替换某元素首个文本子节点的值（仅当其为唯一的直接文本子节点）
		function pgSwapSingleText(el, value) {
			try {
				if (!el || typeof el.textContent !== 'string') return false;
				let hit = null;
				for (const node of Array.from(el.childNodes || [])) {
					if (node.nodeType !== 3) continue;
					const v = node.nodeValue || '';
					if (v.trim() === '') continue;
					if (hit !== null) return false; // 多个文本子节点，不整段替换
					hit = node;
				}
				if (hit === null) return false;
				if (hit.nodeValue !== value) { hit.nodeValue = value; return true; }
			} catch (e) {}
			return false;
		}
		// 受限沙箱集合：workspace-write 与 read-only 都是「写盘受限」，都必须用受限图标。
		// 只认 workspace-write 会让 read-only 会话落到默认的非受限图标，与实际最受限相反。
		const PG_CONFINED = new Set(['workspace-write', 'read-only']);
		// 标记「这个触发器被我们改写成了审查名」：还原只针对自己改写过的元素，
		// 平台原生渲染的「自定义审查」不能被误改回 Custom。
		const PG_REWRITTEN_ATTR = 'data-pg-rewritten';
		// 触发器沙箱打标 + Custom 改写。
		// 平台对「自定义审查 + full access 沙箱」这种组合反查不到表项，兜底渲染
		// "Custom"；此时把它改写成与 workspace-write 下一致的「自定义审查」，并用
		// 图标区分沙箱（受限用锁孔、full access 用放大镜）。仅在宿主确认本会话审查
		// 生效（activeForSession）时改写——没选过审查的会话保持 Custom，不做误导。
		function pgScanCustom(document, lang) {
			try {
				const triggers = Array.from(document.querySelectorAll(PG_TRIGGER_SELECTOR));
				if (triggers.length === 0) return;
				const want = lang === 'en' ? PG_NAME_EN : PG_NAME_ZH;
				const builtin = PG_CUSTOM_BUILTIN;
				// 改写/还原的共同前提：平台此刻「原生渲染 Custom」（内置未匹配态）。
				// 只有平台确实渲染 Custom 时，DOM 里的审查名才可能是我们改写的产物；
				// 平台原生渲染审查名（沙箱从 fa 改到 ww 就会发生）或渲染别的预设名时，
				// 平台自己就是权威，我们的标记必然过期 —— 清标记，且不改写也不还原。
				// 平台状态未知（宿主未下发，或状态查询失败被清空）时一律不动 DOM：
				// 改错的代价（把没开审查的会话显示成开着）比不改的代价大得多。
				// 取值走 pgView()：会话态为空时自动回落到新会话默认值（hero 界面）。
				const view = pgView();
				const platformKnown = view.platform !== null;
				const nativeCustom = platformKnown && view.platform === 'custom';
				for (const el of triggers) {
					// 1) 沙箱打标：无条件按当前会话的真实沙箱标记，供 CSS 选图标
					try {
						const cur = el.getAttribute('data-pg-sandbox');
						if (view.active && PG_CONFINED.has(view.sandbox)) {
							if (cur !== view.sandbox) el.setAttribute('data-pg-sandbox', view.sandbox);
						} else if (cur !== null) {
							el.removeAttribute('data-pg-sandbox');
						}
					} catch (e) {}
					// 2) 名称：审查生效且平台渲染 Custom 时改写；平台仍渲染 Custom 而审查
					//    已不生效时，把「我们改写过的」还原回 Custom（React 的 vdom 新旧值
					//    相等都是 Custom 时不会写回 DOM，不还原就会永久残留）。
					//    还原只针对自己改写过的触发器（data-pg-rewritten）：平台预设表里
					//    custom-review 表项原生就渲染审查名，无条件按名称反推会把平台原生
					//    文案误改成 Custom。
					//    标记过期判定：平台已不再渲染 Custom 时，DOM 里的审查名来自平台而非
					//    我们 —— 必须清掉标记，否则状态查询失败会拿过期标记把平台原生文案
					//    误还原成 Custom（沙箱 fa→ww 后即会命中这条）。
					const rewritten = el.getAttribute && el.getAttribute(PG_REWRITTEN_ATTR) !== null;
					if (rewritten && platformKnown && !nativeCustom) {
						try { el.removeAttribute(PG_REWRITTEN_ATTR); } catch (e) {}
					}
					const canRewrite = view.active && nativeCustom;
					const canRestore = rewritten && !view.active && nativeCustom;
					const label = el.getAttribute && el.getAttribute('aria-label');
					if (typeof label === 'string') {
						for (const p of PG_TRIGGER_PREFIXES) {
							if (label.length <= p.length || !label.startsWith(p)) continue;
							const name = label.slice(p.length);
							if (name === builtin && canRewrite) {
								try { el.setAttribute('aria-label', p + want); } catch (e) {}
								try { el.setAttribute(PG_REWRITTEN_ATTR, '1'); } catch (e) {}
							} else if (canRestore && (name === PG_NAME_ZH || name === PG_NAME_EN)) {
								try { el.setAttribute('aria-label', p + builtin); } catch (e) {}
								try { el.removeAttribute(PG_REWRITTEN_ATTR); } catch (e) {}
							}
							break;
						}
					}
					// 可见文本：触发器自身及叶子中恰为 Custom / 审查名 的整段替换
					const nodes = [el];
					try { nodes.push.apply(nodes, Array.from(el.querySelectorAll('*'))); } catch (e) {}
					for (const n of nodes) {
						if (n.children && n.children.length) continue;
						const t = (n.textContent || '').trim();
						if (t === builtin && canRewrite) pgSwapSingleText(n, want);
						else if (canRestore && (t === PG_NAME_ZH || t === PG_NAME_EN)) pgSwapSingleText(n, builtin);
					}
					// title 同步（平台对 custom 不设 description，通常为 null）
					if (canRewrite) pgSwapAttr(el, 'title', builtin, want);
					else if (canRestore) {
						pgSwapAttr(el, 'title', PG_NAME_ZH, builtin);
						pgSwapAttr(el, 'title', PG_NAME_EN, builtin);
					}
				}
			} catch (e) {}
		}
		function pgScanText(document) {
			try {
				const lang = pgActiveLang();
				// 审查态专属处理（Custom 改写 + 沙箱图标打标）：必须独立于下面按
				// 「自定义审查」做的早退——审查生效但沙箱为 full access 时，页面里
				// 恰恰只有 Custom 而没有「自定义审查」字样，早退会把这一支整个跳过。
				try { pgScanCustom(document, lang); } catch (e) {}
				const from = lang === 'en' ? PG_NAME_ZH : PG_NAME_EN;
				const to = lang === 'en' ? PG_NAME_EN : PG_NAME_ZH;
				const fromDesc = lang === 'en' ? PG_DESC_ZH : PG_DESC_EN;
				const toDesc = lang === 'en' ? PG_DESC_EN : PG_DESC_ZH;
				const body = document.body;
				if (!body) return;
				// 轻量早退：目标名不在页面中就跳过（交换完成后通常立即命中此处，
				// 使流式渲染期间的扫描成本≈一次 textContent 读取）
				const bodyText = body.textContent || '';
				if (bodyText.indexOf(from) === -1) return;
				// 1) 触发器按钮：aria-label 按前缀切出名称段，仅当名称恰为 zh/en 名时
				//    替换（绝不误改 Read Only 等其他预设名）；可见文本整段就地替换
				for (const el of Array.from(document.querySelectorAll(PG_TRIGGER_SELECTOR))) {
					const label = el.getAttribute && el.getAttribute('aria-label');
					if (typeof label === 'string') {
						for (const p of PG_TRIGGER_PREFIXES) {
							if (label.length > p.length && label.startsWith(p)) {
								const name = label.slice(p.length);
								if (name === PG_NAME_ZH && lang === 'en') {
									try { el.setAttribute('aria-label', p + PG_NAME_EN); } catch (e) {}
								} else if (name === PG_NAME_EN && lang === 'zh') {
									try { el.setAttribute('aria-label', p + PG_NAME_ZH); } catch (e) {}
								}
								break;
							}
						}
					}
					pgSwapAttr(el, 'title', from, to);
					pgSwapAttr(el, 'title', fromDesc, toDesc);
					// 可见文本：触发器自身及后代叶子中，文本恰为「非当前语言名」的整段替换
					const nodes = [el];
					try { nodes.push.apply(nodes, Array.from(el.querySelectorAll('*'))); } catch (e) {}
					for (const n of nodes) {
						if (n.children && n.children.length) continue;
						const t = (n.textContent || '').trim();
						if (t !== from) continue;
						pgSwapSingleText(n, to);
					}
				}
				// 2) 按钮/菜单/列表项：子串交换（名称与描述）+ title 交换
				for (const el of Array.from(document.querySelectorAll(PG_SWAP_SELECTOR))) {
					pgSwapText(el, from, to);
					pgSwapText(el, fromDesc, toDesc);
					pgSwapAttr(el, 'title', from, to);
					pgSwapAttr(el, 'title', fromDesc, toDesc);
				}
				// 3) 按钮/菜单表面的叶子后代：子串交换（菜单项 label/detail 可能
				//    是独立叶子元素）
				for (const el of Array.from(document.querySelectorAll('button *,[role="menu"] *,[role="listbox"] *,[role="combobox"] *'))) {
					if (el.children && el.children.length) continue;
					pgSwapText(el, from, to);
					pgSwapText(el, fromDesc, toDesc);
				}
			} catch (e) {}
		}
		function pgTouchesSurface(node) {
			try {
				if (!node || node.nodeType !== 1) return false;
				if (node.getAttribute && node.getAttribute('data-composer-seat') !== null) return true;
				if (node.getAttribute && node.getAttribute('role') === 'menu') return true;
				if (pgTriggerLabel(node.getAttribute && node.getAttribute('aria-label'))) return true;
				if (typeof node.querySelector === 'function') {
					if (node.querySelector('[data-composer-seat]') !== null) return true;
					if (node.querySelector('[role="menu"]') !== null) return true;
					if (node.querySelector(PG_TRIGGER_SELECTOR) !== null) return true;
				}
				return typeof node.closest === 'function' && node.closest('[data-composer-seat]') !== null;
			} catch (e) { return false; }
		}
		function pgInsideComposer(node) {
			try {
				if (!node || node.nodeType !== 1) return false;
				if (node.getAttribute && node.getAttribute('data-composer-seat') !== null) return true;
				return typeof node.closest === 'function' && node.closest('[data-composer-seat]') !== null;
			} catch (e) { return false; }
		}
		// characterData 突变的 target 是 Text 节点（nodeType 3），且必须收窄到
		// 「触发器内部」而不是整个 composer 区域：data-composer-seat 里同时住着
		// Lexical 的 contenteditable 输入框（data-composer-input），用户在输入框
		// 打字时每条 characterData 都会命中 composer —— 用 pgInsideComposer 会让
		// 每次按键都触发一次全量扫描（全文 textContent + 多次全文档
		// querySelectorAll），长对话里是可感知的输入卡顿。这里只覆盖真正需要重扫
		// 的那条路径：React 把触发器里的 Custom 文本改回时，就地再改写一次。
		function pgInsideTrigger(node) {
			try {
				if (!node) return false;
				if (node.nodeType === 3) node = node.parentElement || node.parentNode;
				if (!node || node.nodeType !== 1) return false;
				return typeof node.closest === 'function' && node.closest(PG_TRIGGER_SELECTOR) !== null;
			} catch (e) { return false; }
		}
		// 设置页导航行内部：语言切换时 React 走 nodeValue 更新 label 文本
		// （characterData 突变）。zh 下若不认这一支，重扫不会发生，导航图标就会
		// 停在切换前的行上（与 dshmarket 的「label 与 glyph 永不失配」同一考虑）。
		function pgInsideNavRow(node) {
			try {
				if (!node) return false;
				if (node.nodeType === 3) node = node.parentElement || node.parentNode;
				if (!node || node.nodeType !== 1) return false;
				return typeof node.closest === 'function' && node.closest(PG_NAV_ROW_SELECTOR) !== null;
			} catch (e) { return false; }
		}
		// 用户输入区（Lexical 的 contenteditable / 原生输入框）：打字时每条 characterData
		// 突变都落在这里，必须单独排除。en 语言下 characterData 需要全局扫描（设置页行、
		// 弹层菜单等不位于触发器内），但若把输入区也算进去，用户每按一个键就会触发一次
		// 全量扫描（全文 textContent + 多次全文档 querySelectorAll），长对话里是可感知的卡顿。
		function pgInsideInput(node) {
			try {
				if (!node) return false;
				if (node.nodeType === 3) node = node.parentElement || node.parentNode;
				if (!node || node.nodeType !== 1) return false;
				if (typeof node.closest !== 'function') return false;
				return node.closest('[contenteditable="true"], [contenteditable=""], textarea, input, [data-composer-input]') !== null;
			} catch (e) { return false; }
		}
		function pgRelevant(records) {
			try {
				for (const record of records) {
					if (record.type === 'attributes') {
						if (record.attributeName === 'aria-label') {
							if (pgTriggerLabel(record.target && record.target.getAttribute && record.target.getAttribute('aria-label'))) return true;
						}
						if (record.attributeName === 'role' && pgTouchesSurface(record.target)) return true;
						continue;
					}
					// React 更新既有文本节点走 nodeValue（characterData 突变），
					// 不产生 childList 记录 —— en 下必须监听它才能把被改回的中文换回来；
					// zh 下同理：把 Custom 改写成「自定义审查」后，React 重渲染会把同一
					// 文本节点的值改回 Custom，不重扫就等于改写被撤销。
					// 判定用 pgInsideTrigger（而非 pgInsideComposer）：composer 区域还
					// 住着 contenteditable 输入框，用它会让每次按键都触发全量扫描。
					// en 下仍保留全局扫描（设置页行/弹层菜单不在触发器内，需要换回中文），
					// 但显式排除输入区：否则 en 界面里打字同样会每键触发全量扫描 ——
					// 这一支排在 pgInsideTrigger 之前，若不排除，收窄对 en 完全失效。
					if (record.type === 'characterData') {
						if (pgInsideInput(record.target)) continue;
						if (pgActiveLang() === 'en') return true;
						if (pgInsideTrigger(record.target)) return true;
						if (pgInsideNavRow(record.target)) return true;
						continue;
					}
					if (record.type !== 'childList') continue;
					// en 语言下需要全局扫描（设置页行、弹层菜单等不位于 composer seat）
					if (pgActiveLang() === 'en') return true;
					if (pgInsideComposer(record.target)) return true;
					// 设置对话框不在 composer seat 内、也不含权限触发器，zh 下打开它
					// 不会命中上面任何一支 —— 不补这条，导航图标要等到下一次无关突变
					// 才被画上（表现为「打开设置页仍是齿轮」）。
					if (record.target && typeof record.target.closest === 'function'
						&& record.target.closest('[role="dialog"]') !== null) return true;
					for (const node of record.addedNodes || []) { if (pgTouchesSurface(node)) return true; }
					for (const node of record.removedNodes || []) { if (pgTouchesSurface(node)) return true; }
				}
			} catch (e) {}
			return false;
		}
		function pgCustomItem(container) {
			try {
				const labels = new Set();
				let custom = undefined;
				// 兼容各代权限选择器结构：旧 Menu（menuitem*）、0.1.2 popupSelect
				// （div[role="option"]）。label 一律优先取首个非空 SPAN 子元素，
				// 排除 detail/check 兄弟节点，避免文本并入误判；无 SPAN 时回退整项文本。
				const items = Array.from(container.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="option"]'));
				for (const item of items) {
					let label = '';
					// 优先取第一个非空 SPAN 子元素（label），排除 detail/check 兄弟，
					// 避免文本并入误判；无 SPAN 时回退整项文本（旧 Menu 按钮结构）
					for (const child of Array.from(item.children || [])) {
						if (child.tagName !== 'SPAN') continue;
						const t = (child.textContent || '').trim();
						if (t) { label = t; break; }
					}
					if (!label) label = item.textContent ? item.textContent.trim() : '';
					if (!label || labels.has(label)) continue;
					labels.add(label);
					if (label === PG_CUSTOM_LABEL || label === PG_NAME_EN || label.indexOf(PG_CUSTOM_LABEL) !== -1 || label.indexOf(PG_NAME_EN) !== -1) custom = item;
				}
				if (!custom) return undefined;
				let hits = 0;
				for (const want of PG_PERMISSION_LABELS) {
					if (labels.has(want)) hits++;
				}
				// 至少命中 3 项预设标签才认定是权限选择器（宽容标签变体；其他菜单
				// 不可能同时含有自定义审查/多项预设名，误伤概率为零）
				return hits >= 3 ? custom : undefined;
			} catch (e) { return undefined; }
		}
		// ── 菜单项徽标：与平台 Menu 同构注入（平台用 React 渲染 span.itemIcon，
		//    这里注入等价的内联样式元素，React 不管理未知子元素，重渲染不丢失）。
		//    平台真实结构与尺寸（dsh-web-frontend 的 ._item_/_itemIcon_ 规则）：
		//      button._item { display:flex; align-items:center; gap:8px }   ← 间距来自父级 gap
		//        ├─ span._itemIcon { inline-flex; 16x16; 居中; color: label-tertiary }
		//        └─ span._itemLabel { flex:1; ... }
		//    因此图标必须插到 item 层级（与 label 平级），间距由父级 gap 自动给出；
		//    插在 label 内部则 gap 够不着，只能拿 margin 硬凑，紧凑模式（gap:6px）下还会错。
		//    16x16 容器内居中 + 14px 内容，与另三个内置图标逐像素一致。──
		const pgMenuIcons = new Set();
		const PG_MENU_ICON_ATTR = 'data-pg-menu-icon';
		function pgMenuIconCss(mask) {
			return 'display:inline-flex;flex:none;width:16px;height:16px;align-items:center;justify-content:center;'
				+ 'color:var(--dsw-alias-label-tertiary);background-color:currentColor;'
				+ '-webkit-mask:' + mask + ' center/contain no-repeat;mask:' + mask + ' center/contain no-repeat;';
		}
		function pgEnsureMenuIcon(document, item) {
			try {
				// label span：菜单项内承载预设名的那个 span（排除 check 等兄弟节点）
				let label = null;
				for (const child of Array.from(item.children || [])) {
					if (child.tagName !== 'SPAN') continue;
					const t = (child.textContent || '').trim();
					if (t === PG_CUSTOM_LABEL || t === PG_NAME_EN || t.indexOf(PG_CUSTOM_LABEL) !== -1 || t.indexOf(PG_NAME_EN) !== -1) { label = child; break; }
				}
				if (!label) return;
				// 受限沙箱用锁孔，否则放大镜：与触发器同一判据（pgView 合并视图）
				const mv = pgView();
				const confined = mv.active && PG_CONFINED.has(mv.sandbox);
				const mask = confined ? PG_MASK_LOCK : PG_MASK;
				// 变体标记写进属性值，用它判断要不要重写样式：style 串不能拿来比较 ——
				// CSSOM 会补空格、展开简写（flex:none → flex:0 0 auto）、丢掉 -webkit- 长写，
				// getAttribute('style') 返回的是序列化结果，与拼出的串恒不相等；
				// 拿它当守卫会退化成每次扫描都白写一遍（比改动前的「已存在就 return」更重）。
				const variant = confined ? 'lock' : 'open';
				const existing = item.querySelector('[' + PG_MENU_ICON_ATTR + ']');
				if (existing) {
					// 已注入则按变体更新：沙箱/审查态变化后菜单可能保持挂载（不重建），
					// 早先「已存在就 return」会让图标永远停在首次注入的放大镜上。
					if (existing.getAttribute(PG_MENU_ICON_ATTR) !== variant) {
						existing.setAttribute(PG_MENU_ICON_ATTR, variant);
						existing.style.cssText = pgMenuIconCss(mask);
					}
					return;
				}
				const icon = document.createElement('span');
				icon.setAttribute(PG_MENU_ICON_ATTR, variant);
				icon.setAttribute('aria-hidden', 'true');
				icon.style.cssText = pgMenuIconCss(mask);
				// 插到 item 层级、label 之前：与平台 itemIcon/itemLabel 的兄弟关系一致，
				// 间距交给父级 flex gap（常规 8px / 紧凑 6px），不写 margin
				item.insertBefore(icon, label);
				pgMenuIcons.add(icon);
			} catch (e) {}
		}
		function pgScanIcons(document) {
			try {
				// 菜单/选择器是 portal 渲染（不位于触发器旁边），全文档扫描所有
				// role=menu（旧 Menu 组件）与 role=listbox（0.1.2 popupSelect）；
				// pgCustomItem 要求多项预设齐全才认，误伤其他菜单的概率为零
				for (const menu of Array.from(document.querySelectorAll('[role="menu"], [role="listbox"]'))) {
					const customItem = pgCustomItem(menu);
					if (customItem !== undefined) pgEnsureMenuIcon(document, customItem);
				}
			} catch (e) {}
		}
		// 平台是否已提供 `settings.section.icon` 槽（DSH 0.2.2+）。
		// 由 apply 期的探测置位；置位后下面的 DOM 兼容层必须**完全停手**，
		// 否则同一行会出现两个图标：槽位画一个（平台 flex 行里的正常子元素），
		// CSS ::before 再画一个（劫持层给整行打的伪元素），两者并排显示。
		// 这不是「多画一次」那么轻 —— 用户看到的是盾牌+道闸连着出现两次。
		let pgNavIconViaSlot = false;
		// 设置页导航图标：只认「可见文本 === 本插件 section label」的那一行。
		// label 用与 slots.register 同一个 thunk（T('settings.title')），所以语言切换后
		// 重扫会自动改认新文本的行，并把旧标记摘掉 —— 文字与图标永不失配。
		// 空 label 直接返回：语言尚未解析时不能把整个 nav 都标记上。
		function pgScanNavIcon(document) {
			try {
				// 槽位已接管：不清洗也不打标。已存在的旧标记必须主动摘掉 ——
				// 探测发生在首帧之后时，兼容层可能已经给这一行打过标记了，
				// 光「不再新增」会留下那一枚残留的伪元素图标。
				if (pgNavIconViaSlot) {
					for (const row of Array.from(document.querySelectorAll('[' + PG_NAV_ICON_ATTR + ']'))) {
						row.removeAttribute(PG_NAV_ICON_ATTR);
					}
					return;
				}
				const wanted = String(T('settings.title') || '').trim();
				if (!wanted) return;
				const rows = document.querySelectorAll(PG_NAV_ROW_SELECTOR);
				for (const row of Array.from(rows)) {
					const text = row.textContent ? row.textContent.trim() : '';
					if (text === wanted) row.setAttribute(PG_NAV_ICON_ATTR, '');
					else if (row.getAttribute(PG_NAV_ICON_ATTR) !== null) row.removeAttribute(PG_NAV_ICON_ATTR);
				}
			} catch (e) {}
		}
		function pgScanAll(document) {
			try { pgScanText(document); } catch (e) {}
			try { pgScanIcons(document); } catch (e) {}
			try { pgScanNavIcon(document); } catch (e) {}
		}
		function pgInstallCompat() {
			const document = window.document;
			const Observer = window.MutationObserver;
			const requestFrame = window.requestAnimationFrame;
			const cancelFrame = window.cancelAnimationFrame;
			if (!document || typeof Observer !== 'function' || typeof requestFrame !== 'function') return pgNoop;
			let stopped = false;
			let frame;
			let styleNode = null;
			try {
				styleNode = document.createElement('style');
				styleNode.setAttribute(PG_STYLE, 'client');
				styleNode.textContent = PG_CSS;
				(document.head || document.documentElement).appendChild(styleNode);
			} catch (e) { styleNode = null; }
			const scan = () => {
				try { pgScanAll(document); } catch (e) {}
			};
			const runScan = () => {
				frame = undefined;
				if (stopped) return;
				try { scan(); } catch (e) {}
			};
			const schedule = () => {
				if (stopped || frame !== undefined) return;
				try { frame = requestFrame.call(window, runScan); } catch (e) {}
			};
			// 暴露给状态刷新路径：宿主状态变化后立即重扫一次，不等 DOM 突变
			pgRescan = () => { if (!stopped) schedule(); };
			let observer;
			try {
				observer = new Observer((records) => {
					try { if (pgRelevant(records)) schedule(); } catch (e) {}
				});
				observer.observe(document.documentElement, {
					subtree: true,
					childList: true,
					attributes: true,
					characterData: true,
					attributeFilter: ['aria-label', 'role'],
				});
				schedule();
			} catch (e) {
				try { if (observer) observer.disconnect(); } catch (e2) {}
				if (styleNode && styleNode.parentElement) { try { styleNode.remove(); } catch (e2) {} }
				return pgNoop;
			}
			// 事件驱动的兜底调度：点击/键盘聚焦任何元素后，下一帧扫描一次。
			// 菜单由 portal 挂载，点击触发器的下一帧菜单必然已在 DOM 中 ——
			// 即使 MutationObserver 失效，菜单项图标注入与文本交换仍然可靠。
			const onInteraction = () => { schedule(); };
			try {
				document.addEventListener('click', onInteraction, true);
				document.addEventListener('focusin', onInteraction, true);
			} catch (e) {}
			let offLocale = null;
			try {
				if (LC && LC.locale && typeof LC.locale.subscribe === 'function') {
					offLocale = LC.locale.subscribe(() => schedule());
				}
			} catch (e) {}
			return () => {
				if (stopped) return;
				stopped = true;
				pgRescan = null;
				try { observer.disconnect(); } catch (e) {}
				try { document.removeEventListener('click', onInteraction, true); } catch (e) {}
				try { document.removeEventListener('focusin', onInteraction, true); } catch (e) {}
				if (offLocale) { try { offLocale(); } catch (e) {} }
				if (frame !== undefined && typeof cancelFrame === 'function') {
					try { cancelFrame.call(window, frame); } catch (e) {}
				}
				frame = undefined;
				for (const icon of Array.from(pgMenuIcons)) { try { icon.remove(); } catch (e) {} }
				pgMenuIcons.clear();
				if (styleNode && styleNode.parentElement) { try { styleNode.remove(); } catch (e) {} }
			};
		}

		// 分类清单默认值：以宿主下发为准（见 applyStatusLists），避免双端各存一份而漂移。
		// 顺序与宿主 CATS 一致：执行命令最前，其后按操作配对（区外闸紧邻它所管的操作类型）。
		let CATS = ['command', 'outsideRead', 'directory', 'read', 'edit', 'image', 'undo', 'subagent', 'doomloop'];
		let EXC_CATS = ['command', 'outsideRead', 'directory', 'read', 'image', 'edit', 'undo'];
		// 例外的爆炸半径（宿主下发 { global: { [例外id]: {level,path} }, project: {...} }，
		// 只含 allow 例外）。
		//
		// **按层分开**而不是一张平表：全局块与项目块的例外 id 空间不共享（手写/存量配置可相同），
		// 平表会让后写入的一层覆盖另一层 —— 无害的例外被标成「目标是一整个盘」，或危险那条
		// 丢掉警告。列表按 tab 渲染，故取值时必须带上当前 tab 对应的层。
		//
		// 与 CATS/EXC_CATS 同口径放在模块级：它是**只读派生视图**，不是用户配置，
		// 故不进 React state —— 每份 status 都是完整替换，没有需要局部更新的场景。
		// 默认空对象（不是 null）：渲染处直接下标取值，null 会让每次渲染都要判空。
		let EXCEPTION_BLAST = {};
		// 例外遮蔽关系（宿主下发 { global: { [例外id]: {byId, byAction} }, project: {...} }）。
		//
		// 含义：该条目**被上方更早的一条反向例外遮蔽，当前不生效**（判定只取首个匹配）。
		// 与 EXCEPTION_BLAST 同样是**读侧派生视图**，同样按层分开（理由见上）。
		//
		// 为什么必须由宿主现算、不能在客户端推：判据是「前面那条的模式能否命中这一条的目标」，
		// 命令侧要跑 matchCommand（词边界前缀语义）、路径侧要跑 glob + 路径规范化 ——
		// 客户端重写一份必然与裁决用的那份漂移，标注就会说谎。
		//
		// **顺序变了标注必须跟着变**：它在每次 status 里整体替换，而排序（↑↓ / 拖动）
		// 落盘后宿主会回带新 status，故「调整顺序后重新处理标注」是自动的 ——
		// 前提是这里不能像缓存那样只在首次赋值。
		let EXCEPTION_SHADOW = {};
		// 取某层某条例外的爆炸半径。层名非法或缺失时返回 undefined（渲染处据此不标注）。
		function exceptionBlastOf(layer, id) {
			const t = layer === 'project' ? 'project' : 'global';
			const m = EXCEPTION_BLAST && EXCEPTION_BLAST[t];
			return m && id ? m[id] : undefined;
		}
		// 取某层某条例外的遮蔽信息。返回 { byId, byAction } 或 undefined。
		function exceptionShadowOf(layer, id) {
			const t = layer === 'project' ? 'project' : 'global';
			const m = EXCEPTION_SHADOW && EXCEPTION_SHADOW[t];
			return m && id ? m[id] : undefined;
		}
		function applyStatusLists(s) {
			if (s && Array.isArray(s.cats) && s.cats.length) CATS = s.cats;
			if (s && Array.isArray(s.excCats) && s.excCats.length) EXC_CATS = s.excCats;
			if (s && Array.isArray(s.modes) && s.modes.length) MODES = s.modes;
			if (s && Array.isArray(s.allModes) && s.allModes.length) ALL_MODES = s.allModes;
			if (s && Array.isArray(s.quickPreset) && s.quickPreset.length) QUICK_PRESET = s.quickPreset;
			if (s && s.quickDefaults && typeof s.quickDefaults === 'object') QUICK_DEFAULTS = s.quickDefaults;
			// 爆炸半径：**每次 status 都整体替换**（含清空）。不能写成「只在有值时赋值」——
			// 用户删掉那条例外后，旧标注会留在界面上，指向一个已经不存在的 id（看似还在生效）。
			EXCEPTION_BLAST = (s && s.exceptionBlast && typeof s.exceptionBlast === 'object') ? s.exceptionBlast : {};
			// 遮蔽关系：与上面同理**每次 status 都整体替换**（含清空）—— 用户把条目拖到前面
			// 或删掉遮蔽者之后，旧标注必须立刻消失，否则界面会继续说「未生效」而实际已生效。
			EXCEPTION_SHADOW = (s && s.exceptionShadow && typeof s.exceptionShadow === 'object') ? s.exceptionShadow : {};
		}
		// 例外列表超过该数量默认折叠（展开/折叠按钮在标题行右侧）
		const EXC_COLLAPSE_THRESHOLD = 6;
		// 长列表的滚动区高度上限（px）。三处列表（快捷工具 / 例外 / 规则）共用同一个值：
		// 它们在同一次滚动里上下相邻，高度不一致会让面板看起来一段一段的。
		// 选 260 的理由：约 6-7 行（单行 ~36px），与 EXC_COLLAPSE_THRESHOLD=6 的折叠阈值
		// 量级一致 —— 折叠与滚动两个机制在「多长算长」这件事上口径一致，不会一个说长、一个说短。
		// 超过则出纵向滚动条；不超过时容器按内容高度收缩（不出现空白区）。
		const LIST_SCROLL_MAX_H = 260;
		// 文件对比缓存：按审批 id 缓存 /permgate/file-diff 结果（弹窗详情与右侧抽屉共用）
		const diffCache = new Map();
		const diffFetching = new Set();
		let ALL_MODES = ['ask', 'allow', 'deny', 'inherit'];
		let MODES = ['ask', 'allow', 'deny'];
		// 颜色键集必须覆盖 decisions 里所有可能的 action（含宿主无人在环结案的
		// timeout-allow/timeout-deny/fallback-allow/fallback-deny），否则「最近决策」
		// 会回落灰色 #888，与人工决策无从区分。
		// 颜色语义：橙=要过一道关（问人）、绿=放行、红=拒绝、灰=继承。
		// timeout-* 用橙：虽然结果是放行/拒绝，但**没人拍板**，用户该一眼看出「这条要复核」。
		// fallback-* 同理用橙：它是用户预设的兜底，不是本次判断的结果。
		// `auto` 取**紫色**而不是复用 ask 的橙：它和 ask 一样「要过一道关」，但过关的是
		// **模型**不是人 —— 用户在状态点/徽标上一眼要能分清「这次谁在看」。
		// 复用橙色会让 auto 与 ask 在面板上完全同色，那正是「同一概念两种编码」的反面：
		// 两个不同概念被编成了同一个颜色。
		// 取 `#6a1b9a`（深紫）而不是浅紫：状态点是 12px 小圆点，浅色在白底上几乎看不见。
		const MODE_COLORS = { ask: '#e65100', allow: '#2e7d32', deny: '#c62828', inherit: '#888', auto: '#6a1b9a', 'timeout-allow': '#e65100', 'timeout-deny': '#c62828', 'fallback-allow': '#e65100', 'fallback-deny': '#e65100' };
		// auto 的回落值域：**不含 inherit**。回落是「这次调用最后怎么办」的最终答案，
		// 必须是一个能直接执行的动作；inherit 是层级继承语义，把它当回落值等于让回落
		// 本身又要再解析一次层级（理由见宿主 normalizeAutoFallback 的注释）。
		// 与宿主的值域**同源**（宿主只接受 ask/allow/deny），不是各写一份。
		const AUTO_FALLBACK_MODES = ['ask', 'allow', 'deny'];
		// 快捷工具预设清单与默认动作都由宿主下发（permgate:status 的 quickPreset/quickDefaults），
		// 与 CATS/MODES 同口径，避免宿主与浏览器各存一份清单、新增工具时漂移；
		// 未显式配置的工具按「项目键 → 全局键 → 预设默认 → 会话兜底」显示，与服务端 quickAction 同链。
		let QUICK_PRESET = [];
		let QUICK_DEFAULTS = {};
		let QUICK_FALLBACK = 'ask';

		// ── 打开文件/图片到 DSH 右侧栏 ──────────────────────────────────────
		// ctx.sidebarRight.openResource 是 DSH 右侧栏的导航入口（会话的文件链接、文件树行都走它）。
		// 地址形如 dsh-resource://file/session/<sessionId>/<path>，文本与图片共用同一个 file 地址，
		// DSH 自己按 media type 选渲染器（文档预览 / 图片）。地址口径与上游 fileAddressFor 一致：
		// 工作区内的绝对路径折算成相对路径，工作区外的绝对路径原样放进地址段。
		const FILE_ADDR_PREFIX = 'dsh-resource://file/session/';
		const encSeg = (s) => encodeURIComponent(String(s)).replace(/%3A/gi, ':'); // 盘符冒号保持字面量
		const localFileAddress = (sid, cwd, path) => {
			// 上游 sessionFileAddress 会剥掉前导 ./（JSDoc: "leading ./ prefixes are dropped"），
			// DSH parseFileAddress 不解析 . 段，fallback 必须同口径，否则 ./ 开头的路径打不开
			const n = String(path || '').replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
			const root = cwd ? String(cwd).replace(/\\/g, '/').replace(/\/+$/, '') : '';
			const rel = root && n.indexOf(root + '/') === 0 ? n.slice(root.length + 1) : n;
			return FILE_ADDR_PREFIX + encSeg(sid) + '/' + rel.split('/').map(encSeg).join('/');
		};
		// 优先用上游 helper（口径唯一）；取不到就退回上面的等价实现，避免多一条 client 依赖。
		let fileAddrHelper;
		const fileAddressOf = (sid, cwd, path) => {
			try {
				if (fileAddrHelper === undefined) fileAddrHelper = require('@deepseek-ai/dsh-util-workspace-path');
				if (fileAddrHelper && typeof fileAddrHelper.fileAddressFor === 'function') return fileAddrHelper.fileAddressFor(sid, cwd, path);
			} catch (e) { fileAddrHelper = null; }
			return localFileAddress(sid, cwd, path);
		};
		// 打开一个文件/图片到右侧栏；不可用时返回 false（调用方据此提示或维持原行为）
		const openInSidebar = (file, sid, cwd) => {
			try {
				const sr = LC && typeof LC.get === 'function' ? LC.get('sidebarRight') : null;
				if (!sr || typeof sr.openResource !== 'function' || !file) return false;
				sr.openResource(fileAddressOf(sid, cwd, file));
				return true;
			} catch (e) {
				console.error('[permgate] open in sidebar failed:', e);
				return false;
			}
		};

		// ── 中英文适配：字典 + locale 绑定（跟随 dsh 语言设置自动切换）──────────
		let LC = null; // apply 时注入的 ctx
		const I18N = {
			zh: {
				'app.title': '权限审批',
				'app.collapse': '收起为小方块',
				'app.resetPos': '复位到默认位置（右上角）',
				'app.timeoutIn': '⏳ {n} 秒后自动{act}',
				'app.timeoutStop': '停止倒计时',
				// 模型原话的前缀。为什么需要前缀而不是只靠样式：灰色斜体在缩小方块与深色
				// 主题下区分度不足，而模型可能在 reason 里写「用户已授权删除」这类臆断 ——
				// 必须让用户一眼看出这是模型说的，不是系统判定的。
				'app.modelReasonPrefix': '模型判断：',
				'app.timeoutStopHint': '停止后本审批不再自动结案，一直等你决定',
				'app.timeoutStopFailed': '取消失败：倒计时仍在运行',
				'app.fromSession': '来自对话：',
				'app.request': '{tool} 请求执行',
				'app.intent': '意图说明',
				'app.args': '参数',
				// ── 爆炸半径警告（审批弹窗）─────────────────────────────────────
				// 文案必须说清「多大范围」而不是只喊危险：审批人要判断的是「这是不是我要的」，
				// 只写「危险！」他无从判断，只能一律拒绝（那会让这个功能变成噪音）。
				// {p} 是宿主算出的目标路径。
				'app.blast.driveRoot': '目标是一整个盘（{p}）—— 该盘上的全部内容都会被永久删除，不进回收站',
				// broad 的 {p} 是 `.`（目标不限定），故文案不写具体路径：说清「这条规则不限目标」即可。
				'app.blast.broad': '这条规则不限删除目标（{p}）—— 它同样放行删除盘根与系统目录',
				'app.blast.system': '目标是系统目录（{p}）—— 删除后系统或软件可能无法启动',
				// workspace-root 的 {p} 是工作区根（通常是 `.`）。文案必须说清「删的是整个项目」
				// 而不是「删了一个目录」—— 后者听上去像日常操作，而它不可逆且影响全部代码。
				'app.blast.workspaceRoot': '目标是**本项目根目录**（{p}）—— 整个项目的文件都会被删除，不进回收站',
				// unknown 的 {p} 通常为空（目标读不出，没有具体路径可显示），故文案不依赖它。
				'app.blast.unknown': '无法判定这条命令的目标范围（{p}）—— 命令里含变量或读不懂的构造，实际影响可能超出工作区',
				'app.blast.home': '目标是你的用户目录（{p}）—— 其中的配置与文档都会丢失',
				'app.blast.outside': '目标在工作区之外（{p}）—— 不在本项目范围内',
				'app.cand.head': '添加项目规则（当前项目）',
				'app.cand.hint': '点亮条目后点「允许 / 拒绝」即写入当前项目例外。',
				'app.allow': '允许',
				'app.deny': '拒绝',
				'app.allowOne': '√ 允许',
				'app.denyOne': '× 拒绝',
				'app.denyReason': '拒绝意见',
				'app.denyReasonPh': '选填：填写后作为拒绝理由告知 agent（默认为「用户拒绝」）',
				'app.confirmDeny': '确认拒绝',
				'app.detail': '详情',
				'app.diffNew': '新增',
				'app.diffMod': '修改',
				'app.diffMore': '其余 {n} 行',
				'app.diffLoading': '加载中…',
				'app.diffErr': '无法生成对比',
				'app.imageTag': '图片',
				'app.imageTooLarge': '图片过大，未生成缩略图',
				'app.imageSizeUnknown': '无法确认图片尺寸，未生成缩略图',
				'app.imageNoPreview': '暂无可用的缩略图',
				'app.uiErr': '界面渲染出错',
				'app.eolNote': '行尾已按 LF 归一化匹配（磁盘为 CRLF/CR 而参数为 LF）：预览仅为意图展示，实际编辑可能因行尾不一致失败',
				'app.diffGapShow': '显示 {n} 行未更改',
				'app.diffGapHide': '隐藏 {n} 行',
				'app.diffGapMore': '… {n} 行未更改',
				'app.diffCopy': '复制',
				'app.diffCopied': '已复制',
				'app.diffExpand': '展开',
				'app.diffCollapse': '收缩',
				'app.diffRead': '读取',
				'app.diffLines': '{n} 行',
				'app.encHint': '该文件不是 UTF-8，内容已按此编码解码显示',
				'app.encGuessedHint': '该文件不是 UTF-8；编码是按内容猜测的（可能不准），请留意',
				'app.undoVerdictSkipped': '当前预览的解码方式与工具实际使用的编码不同源，无法判断撤销是否会执行；此处只展示将被恢复的内容，不代表撤销一定会执行。',
				'app.diffTopMore': '… 上方还有 {n} 行',
				'app.diffBottomMore': '… 下方还有更多行',
				'app.diffClose': '关闭',
				'app.openFile': '在侧栏打开',
				'app.openFileFailed': '无法在侧栏打开（当前 DSH 未提供右侧栏服务）',
				'app.diffResize': '拖动调整宽度',
				'settings.title': '权限网关',
				// 键名 `directory` 与显示名不一致是**有意的**（写闸复用老键才能继承存量 mode 与例外
				// 列表，且该键参与宿主配置格式判别，改名会让整份配置被判成旧格式而重建）。
				'cat.directory': '工作区外写入',
				'cat.outsideRead': '工作区外读取',
				'cat.command': '执行命令',
				'cat.read': '读取文件',
				'cat.image': '读取图片',
				'cat.edit': '编辑文件',
				'cat.undo': '撤销操作（恢复上次编辑前的内容）',
				'cat.subagent': '启动子代理',
				'cat.doomloop': '重复操作(Doom Loop)',
				// 缩小方块的短名（cat.* 是设置页的长名，两者用途不同故分开；
				// 但都放 I18N 走 T()，不再另存平行表）。custom/quick/fallback 是
				// decide() 的三个特殊 cat 值，也要有短名。
				'catS.directory': '区外写',
				'catS.outsideRead': '区外读',
				'catS.command': '命令',
				'catS.read': '读取',
				'catS.image': '图片',
				'catS.edit': '编辑',
				'catS.undo': '撤销',
				'catS.subagent': '子代理',
				'catS.doomloop': '重复',
				'catS.custom': '规则',
				'catS.quick': '快捷',
				'catS.fallback': '兜底',
				'mode.ask': '询问',
				'mode.allow': '允许',
				'mode.deny': '拒绝',
				'mode.inherit': '继承全局',
				// 第四档：交给模型判断。文案取「自动审批」而不是「自动」——
				// 「自动」一词在本插件历史上有别的含义（编辑器内核的自动判别），
				// 面板上必须能一眼区分，故用四字全称。
				'mode.auto': '自动审批',
				// 未知动作的降级文案（见 modeLabel 的注释）：`{a}` 是原值。
				// 不能退化成 key 本身 —— 那会让面板显示「mode.bogus」。
				'mode.unknown': '未知动作：{a}',
				// 「模型失败后执行什么」的标签（仅在动作是 auto 时出现在下拉框左侧）
				'panel.autoFallbackLabel': '失败后：',
				// 新增行（「添加例外」「添加快捷工具」那两排）的回落值只读提示：
				// 那里还没有已存在的条目可写，故不给下拉，但必须显示「失败后会怎样」——
				// 否则用户选了自动审批却看不到落点，而提交时用的正是那个隐含值。
				'panel.autoFallbackReadonlyHint': '新增条目暂不可设回落值，将按缺省「询问」处理；添加后可在列表中修改',
				// ── 自动审批的工程参数卡片 ──────────────────────────────────────
				'panel.autoReview': '自动审批',
				'panel.autoReviewHint': '把某个分类设成「自动审批」后，每次调用先问模型，模型说行就直接过。下面这些是它的运行参数，全局生效。',
				'panel.autoNoLlm': '没检测到可用的模型服务。现在所有「自动审批」都会退回你设的兜底动作。',
				'panel.autoTimeout': '等待人工的时限',
				// ── 这段文案为什么长这样 ────────────────────────────────────────────
				// 它要给一个**同时服务两处**的数字写说明，而那两处对 `0` 的语义正好相反：
				// 异常回落那条「0 = 不弹窗、直接执行」，高风险放行那条「0 = 一直等」。
				// 早先按「两个用途 ①②」并列，读起来像在解一道有两个未知数的题。
				//
				// 改成**先说这个数字本身干什么**，再分两行说各自的特例。用户读第一句
				// 就知道「这是弹窗等多久」，后面两行只是例外清单，不必先理解两套流程。
				//
				// 两行都写「当 X 选成 A/B 时」，**不用否定式**（原先写「不是『一直等』时」）：
				// 否定式要求读者先在脑中排除一个选项，而且「没人应答时」是下拉标签、
				// 「一直等」是它的选项 —— 两个层级的东西并排在一个否定句里，很难读。
				// 正面列举该维度真正会用到本项的取值，读者不必做减法。
				//
				// 不受本项影响的情形必须单独写，否则会被读成「询问也受这个数字管」。
				// 但两条路径的判据不同：模型失败那条看「失败后」是不是 ask，
				// 高风险那条看「没人应答时」是不是 wait —— 后者没有「询问」这个选项
				//（见 HIGH_RISK_TIMEOUTS），把两者并成一句「选『询问』时不起作用」
				// 会让用户去一个不存在的位置找它；且只设了「失败后」= 询问 时，
				// 高风险那条其实仍由本项倒计时。
				// 故保持一条 bullet，但两个分句各带路径名与各自的取值。
				'panel.autoTimeoutHint': '弹窗弹出后等你多久，超时就不等了。'
					+ '\n· 模型判断失败、而「失败后」选成允许或拒绝：到点按那个动作执行。填 0 = 不弹窗，直接执行。'
					+ '\n· 高风险放行、而「没人应答时」选成拒绝或允许：到点按那个选择执行。填 0 = 一直等。'
					+ '\n· 模型判断失败、而「失败后」选成「询问」，或高风险放行、而「没人应答时」选成「一直等」：这两种情形不受本项影响，弹窗照常弹，一直等你决定。',
				'panel.autoBreaker': '连续拒绝上限',
				'panel.autoBreakerHint': '模型连着拒绝这么多次，就暂停问模型，改按「失败后」的设置处理。填 0 = 不暂停，一直问模型',
				'panel.autoHistory': '工具调用历史',
				'panel.autoHistoryHint': '左边是带几条最近的工具调用，右边是这些文字的总长上限（超了从最早的开始丢）。你本人说过的话不受这里限制，总是发给模型',
				// 标签：推理等级照抄官方 locale（ui-model-selection 的 menu.effort）；
				// **模型这一行刻意偏离**（实测要求「这里的[模型]改成[审批模型]」）：
				// 官方那套是作曲区的「当前对话用哪个模型」，而这里是**自动审批**用哪个模型
				// 去评审工具调用 —— 同一个词在两处指的是两个不同的模型，叫法必须区分开，
				// 否则用户会以为改这里等于改自己对话用的模型。
				'panel.autoModel': '审批模型',
				'panel.autoEffort': '推理等级',
				'panel.autoModelFollow': '跟随会话',
				'panel.autoPickerAria': '审批模型与推理等级',
				// 搜索框（官方 search.placeholder / search.clear / search.empty）
				'panel.autoSearchPh': '搜索模型…',
				'panel.autoSearchClear': '清除搜索',
				'panel.autoSearchEmpty': '没有匹配的模型。',
				// 目录为空时模型 pane 里的说明（官方 empty.models 同位置）。
				'panel.autoModelEmpty': '暂无可用模型',
				'panel.autoEffortHint': '「跟随会话」用当前对话的设置；「模型最高」「模型最低」按所选模型公布的档位取；模型不公布档位时跟随它自己的默认',
				'panel.autoEffortSession': '跟随会话',
				'panel.autoEffortDefault': '模型默认',
				'panel.autoEffortMax': '模型最高',
				'panel.autoEffortMin': '模型最低',
				// 推理等级 pane 的两个分组（与模型 pane 的服务商分组同一套标题样式）：
				//   通用 = 相对于任何模型都成立的相对档（含「跟随会话」）；
				//   指定 = 该模型**自己公布**的具体档位（Low / High / Max …）。
				'panel.autoEffortGroupCommon': '通用',
				'panel.autoEffortGroupSpecific': '指定',
				'panel.autoEffortNone': '该模型不公布推理强度档位',
				'panel.autoModelLoading': '读取中…',
				// ── 会话流里的自动审批行 ────────────────────────────────────────
				'flow.viaAllow': '自动审批：模型放行 {tool} → {action}',
				'flow.viaDeny': '自动审批：模型拒绝 {tool} → {action}',
				'flow.viaEscalate': '自动审批：模型拿不准 {tool} → {action}',
				'flow.viaFallback': '自动审批未能使用模型 {tool} → {action}{direct}',
				'flow.directTag': '（按你的设置直接执行）',
				'flow.action.allow': '放行',
				'flow.action.ask': '询问',
				'flow.action.deny': '拒绝',
				'flow.why': '原因：',
				'flow.modelReason': '模型说明：',
				'flow.risk': '模型判定风险：',
				// 推理强度。`flow.effort` 后面跟的是**模型自己的档位 id**（low/high/max…），
				// 不翻译：档位 id 由模型自定义、无法穷举，且与模型名同属外部标识符。
				// 需要解释的只有「配置值解析成了什么」，故括号里有「设置：」这个主语
				// —— 少了它，「模型最低」会被读成模型的属性，与后半句
				// 「该模型不公布档位」自相矛盾。
				'flow.effort': '推理强度：',
				'flow.effortWithWant': '{effort}（设置：{want}）',
				// 未派发分四句，不能合成一句：`config-error`（模型公布了档位但不支持
				// 你选的那个）与「模型压根不公布档位」是两种情况，后者的原因由
				// `flow.why` 那行说明，此处再断言「不公布档位」就是假话。
				// 「模型默认」「跟随会话」同样会在**不报错**的情况下落空（前者是适配器
				// 没给 defaultEffort，后者是会话没选档位或该档位不在目标模型表里），
				// 那时说「不公布档位」同样是假话 —— 判据见 effortFlowLabel。
				'flow.effortNone': '未派发（设置：{want}）',
				'flow.effortNoneNoTable': '未派发（设置：{want}；该模型不公布推理档位）',
				'flow.effortNoneDefault': '未派发（设置：{want}；该模型没有默认推理档位）',
				'flow.effortNoneSession': '未派发（设置：{want}；会话未选推理档位，或该档位不在目标模型的档位表里）',
				'flow.rule': '命中规则：',
				'flow.raw': '模型原始输出：',
				// 风险等级：模型给的是 `low` / `medium` / `high` 三个英文原值，
				// 面板上必须翻成界面语言 —— 直接显示 `low` 与整行中文的措辞不搭，
				// 用户还得自己判断它在这套分级里算高还是低。
				//
				// 与 `modeLabel` 同一条纪律：**未知值不得退化成 key 本身**。
				// 模型偶尔会吐出分级表外的词（`critical`），那时降级成「未知等级：X」
				// 而不是把 `flow.riskValue.critical` 这种 key 画到界面上。
				'flow.riskValue.low': '低',
				'flow.riskValue.medium': '中',
				'flow.riskValue.high': '高',
				'flow.riskValue.unknown': '未知等级：{r}',
				'panel.autoSaved': '已保存',
				// 四个数字框共用这一句，而秒框（timeoutMs，scale=1000）接受小数：
				// 2500ms 显示 2.5 并原样提交，故措辞不得限定为「整数」—— 用户会据此
				// 放弃本可用的 2.5 秒，或把超上限的整数值当成「格式不对」反复重试。
				'panel.autoBadNumber': '请输入该范围内的数字',
				'panel.autoSecUnit': '秒',
				'panel.autoTimesUnit': '次',
				'panel.autoCharsUnit': '字符',
				'panel.autoReset': '全部恢复默认',
				'panel.autoResetConfirm': '确认全部恢复？',
				'panel.autoResetWarn': '会清掉全局的全部显式设置，且无法撤销',
				'panel.autoResetDone': '已恢复默认',
				// ── 额外审批策略卡片 ────────────────────────────────────────────
				'panel.autoPolicy': '额外审批策略',
				'panel.autoPolicyHint': '写给审批模型的补充规则，会接在内置策略之后一起发过去。它不改变风险等级，只影响判定。',
				'panel.autoPolicyGlobal': '全局',
				'panel.autoPolicyProject': '本项目',
				// 标签说的是「本项目这段与全局那段是什么关系」，三个选项正是三种关系。
				// 早先写「用法」—— 它没说和**谁**的关系，而这段文本的三种取值的差别
				// 全在作用域上（发不发、发哪一份），不是「怎么用」。
				'panel.autoPolicyMode': '与全局的关系',
				'panel.autoPolicyModeInherit': '继承全局',
				'panel.autoPolicyModeAppend': '追加到全局',
				'panel.autoPolicyModeReplace': '替换全局',
				'panel.autoPolicyInheritHint': '当前为「继承全局」，这段不会发送',
				'panel.autoPolicyReplaceHint': '当前为「替换全局」，全局那段不会发送',
				// 占位示例必须**两个方向都给**（一条拒绝 + 一条放行），且不写作用域词
				// （「本项目」在全局那格里是错的，两格共用同一份文案）。
				//
				// 示例本身必须**照着写也安全**：早先写的是「npm / git status 这类只读命令
				// 可以直接放行」，而 `npm` 包含 install / publish / run，照字面落地等于
				// 把写盘与外发一起放行。改用只读查询的具体命令，并配一条硬拒绝 ——
				// 拒绝那一条是内置策略无从得知的（它不知道哪个项目有 .env 或私钥），
				// 这正是本卡片存在的理由。
				'panel.autoPolicyPh': '例如：.env、*.pem 一律拒绝；git status、ls 这类只读查询直接放行',
				'panel.autoPolicyCount': '{n} / {max}',
				// 两档提示分开：warn 是建议（照常能存），TooLong 是真上限（按钮禁用）。
				// 合成一句会让用户以为「超过建议值就存不了」。
				//
				// 超上限那句把**真上限**也写进文案：计数器的分母恒为建议线，
				// 不在这里给出真上限的话，用户看到「20001 / 4000」只会以为
				// 「超了 5 倍」，而不知道 20000 才是存不进去的那条线。
				'panel.autoPolicyTooLongWarn': '策略偏长，模型注意力可能被稀释',
				'panel.autoPolicyTooLong': '策略超出长度上限（{max} 字符）',
				'panel.autoPolicySaved': '已保存',
				'panel.autoPolicySave': '保存',
				'panel.autoHighRisk': '模型判定高风险、却给出放行时',
				'panel.autoHighRiskTitle': '高风险放行怎么办',
				'panel.autoHighRiskHint': '模型可能既标了高风险、又给出放行。这里决定这种情况怎么办。它会先重新问一次模型，仍是高风险放行才按这里处置',
				'panel.autoHighRiskTimeout': '没人应答时',
				'panel.autoHighRiskTimeoutHint': '选「询问」时才生效。一直等 = 弹窗不超时；拒绝/允许 = 到「等待人工的时限」后照做',
				'panel.autoHighRisk.deny': '拒绝',
				'panel.autoHighRisk.ask': '询问',
				'panel.autoHighRisk.allow': '允许',
				'panel.autoHighRiskTimeout.wait': '一直等',
				'panel.autoHighRiskTimeout.deny': '拒绝',
				'panel.autoHighRiskTimeout.allow': '允许',
				'panel.autoPolicyInherit': '继承全局',
				'panel.autoDenyReasonTitle': '拒绝时告诉模型什么',
				'panel.autoDenyReason': '回给模型的话',
				'panel.autoDenyReasonHint': '模型被拒后收到的那句说明由这里决定，句尾还会附上「哪一段、哪一档」的摘要 —— 模型据此决定下一步改什么',
				'panel.autoDenyReason.default': '自动审批的判定理由',
				'panel.autoDenyReasonDesc.default': '模型自己写了什么理由，原样回给它，不用靠猜',
				'panel.autoDenyReason.custom': '固定句子',
				'panel.autoDenyReasonDesc.custom': '不回模型自己的理由，免得它顺着理由换个方式绕过去',
				'panel.autoDenyReason.both': '两者叠加',
				'panel.autoDenyReasonDesc.both': '模型的理由照发，再加一句你希望它怎么做',
				'panel.autoDenyReasonPh': '留空则按情形返回下面某句子',
				'panel.autoDenyReasonPhInherit': '留空则沿用全局那句',
				'panel.autoDenyReasonInherit': '留空：将沿用全局的自定义原因 —— {text}',
				'panel.autoDenyReasonDefaultsLabel': '按情形分别是：',
				'flow.viaAllowHigh': '自动审批：模型判定高风险仍放行 {tool} → {action}',
				'flow.viaDenyHigh': '自动审批：模型判定高风险并放行，被你的设置拒绝 {tool} → {action}',
				'flow.viaAskHigh': '自动审批：模型判定高风险却放行，等你决定 {tool} → {action}',
				// 审计专用动作值（宿主无人在环结案）：不在设置页下拉里，只出现在「最近决策」。
				// 必须与宿主写入的 action 字面量一一对应，否则 T 会原样显示 mode.timeout-allow。
				'mode.timeout-allow': '超时自动允许',
				'mode.timeout-deny': '超时自动拒绝',
				'mode.fallback-allow': '按设置直接放行',
				'mode.fallback-deny': '按设置直接拒绝',
				'panel.status': '配置与统计',
				'panel.config': '配置文件：',
				'panel.stats': '最近统计：拦截 {d} · 审批 {a}',
				'panel.loadErr': '加载错误：',
				'panel.saveErr': '保存错误：',
				'panel.fenceUntrusted': '请求来源不受信任，已被权限网关拒绝（403）。请从 dsh web 打印的本机地址重新打开本页面。',
				'panel.fenceUnauthenticated': '浏览器凭据缺失或已过期（401）。请从 dsh web 打印的地址重新打开本页面以完成认证。',
				'panel.tabGlobal': '全局',
				'panel.tabProject': '项目',
				'panel.tabAuto': '自动审批',
				'panel.autoScope': '设置范围',
				'panel.editGlobal': '正在编辑全局设置（所有项目的默认）。',
				'panel.editProject': '正在编辑当前项目（{p}），项目设置优先于全局。',
				'panel.sandbox': '底层沙箱',
				'sandbox.ww': 'Workspace Write',
				'sandbox.fa': 'Full access',
				'sandbox.inherit': '继承全局',
				'sandbox.desc.ww': '文件操作限制在工作区内',
				'sandbox.desc.fa': '文件操作不受工作区限制',
				'sandbox.desc.inherit': '跟随全局设置（当前全局：{g}）',
				'panel.quick': '快捷工具（其他工具快速设置）',
				'panel.quickHint': '无文件/命令语义的工具，按工具名设定默认动作；不在清单里的工具走兜底策略，改动即时生效。',
				'panel.quickAdd': '新增工具名（如 todo_write，支持通配）',
				'panel.quickAddBtn': '添加',
				'panel.rules': '自定义规则（通用匹配）',
				'panel.actionDeny': 'deny 拒绝',
				'panel.actionAsk': 'ask 审批',
				'panel.actionAllow': 'allow 放行',
				'panel.toolPh': 'tool 通配（如 cordis_*）',
				'panel.pathPh': 'path glob',
				'panel.argsPh': 'args 子串',
				'panel.reasonPh': '原因（可选）',
				'panel.addToGlobal': '添加到全局',
				'panel.addToProject': '添加到项目',
				'panel.ruleList': '{t}规则（{n}）',
				'panel.noRules': '暂无规则',
				'panel.decisions': '最近决策',
				'panel.noDecisions': '暂无决策记录',
				// 展开/收起决策记录。{n} 是展开后能看到的条数，{m} 是首屏条数。
				'panel.decisionsExpand': '展开全部（{n} 条）',
				'panel.decisionsCollapse': '收起（只显示最近 {m} 条）',
				'panel.decisionsLoading': '加载中…',
				'panel.decisionsFailed': '加载失败',
				'panel.reload': '重新加载配置文件',
				'panel.openConfig': '打开',
				'panel.openConfigDone': '已用默认编辑器打开配置文件',
				'panel.saved': '已保存',
				'panel.savedToGlobal': '已保存到全局',
				'panel.savedToProject': '已保存到当前项目',
				'panel.all': '(全部)',
				'panel.sandboxSaved': '底层沙箱已保存（{t}）：{v}',
				'panel.fallbackSaved': '兜底策略已保存（{t}）：{v}',
				'panel.fallback': '兜底策略（未匹配任何规则）',
				'panel.fallbackHint': '以上各分类之外、且不在快捷工具清单里的调用（如 mcp__*、插件注册的工具）如何处理。',
				'panel.needValue': '请先输入例外匹配',
				'panel.excRemaining': '该路径仍有 {n} 条同值例外，可继续逐条删除',
				'panel.delFailed': '删除失败',
				'panel.needTool': '请输入工具名',
				'panel.excCount': '例外（{n}）',
				// 例外匹配的对象是**单个命令段**（不是整条命令串）—— 提示文案必须说清这一点，
				// 否则用户会以为写 `git status *` 就能放行 `git status && 任意命令`（旧实现确实如此）。
				'panel.excCmdHint': '：匹配单个命令段（glob），优先于子设置与分类默认',
				'panel.excPathHint': '：路径 glob，优先于分类默认',
				'panel.excNone': '无例外',
				// ── 长列表的过滤器与空态（快捷工具 / 例外 / 规则三处共用）──────────
				'panel.listFilterPh': '过滤…',
				'panel.listNoMatch': '没有匹配的条目',
				'panel.listMatchCount': '{n} / {m}',
				// ── 列表排序（规则 / 例外）────────────────────────────────────────
				// 只给按钮写 title，不给列表加说明文字：排序的语义（「上面的先生效」）在
				// 这两处列表的标题行已经交代过，再写一段说明就是重复。
				'panel.moveUp': '上移（更先生效）',
				'panel.moveDown': '下移（更晚生效）',
				'panel.subDestructive': '破坏性命令',
				// 一行说清作用即可，不列具体名单：这里曾展开「段首命令命中内置名单时按此动作
				// （更细的判定，优先于上方默认动作）」——括号里那句与当时下方那行「当前生效」
				// 说的是同一件事（那行已删），不必再用文字复述判定优先级。
				// 也不列名单内容：它只读、不可编辑，逐条列出占四行却给不出可操作信息；
				// 这里只举几个典型例子让人一眼认出「这类命令」，权威定义在 shell-parse.js
				// 的 DESTRUCTIVE_LABELS（删除/磁盘/进程电源/提权/权限属主/注册表六类）。
				// 说明行**独立成行**，故文案不再以「：」开头（上一版它是拼在标题后面的后缀）。
				// 也不再说「按此动作」—— 八档各有各的动作，那句话现在不成立了。
				'panel.subDestructiveHint': '删除文件、格式化磁盘、关机重启、提权等危险操作，按各自档位的动作处理（例外优先）',
				// 免责说明：内置名单靠命令名与参数形态识别，不可能穷尽所有写法
				// （脚本文件、编码混淆、间接调用都读不出来）。不写这句的话，用户会把
				// 「没弹窗」当成「这条命令被检查过且安全」，而实际可能是根本没识别出来。
				// 措辞只陈述能力边界，不解释原理 —— 用户要的是「别把没拦住当成拦住了」。
				'panel.subDestructiveNote': '注：基于命令文本识别，不能保证覆盖所有破坏性命令。',
				// ── 「其余情况」= 命令分类的**最后一道闸门** ──────────────────────
				// 它就是这个分类的「默认动作」，但**只在 command 上**叫这个名字、也只在这里
				// 被画到块底部：命令分类有三层（例外 → 破坏性命令 → 其余情况），
				// 把默认动作留在标题行会让界面自上而下的次序与判定链完全颠倒。
				//
				// 名字必须与「例外」「破坏性命令」并列读得通 —— 三者是同一个分类下
				// 依次兜底的三层，不是「分类 + 两个附加项」。
				// 不叫「默认动作」：那个词在这个位置会被读成「分类的总开关」，
				// 而它恰恰是**最后**才生效的一个（例外与破坏性命令都比它优先）。
				// 其余五个分类仍叫默认动作（留在标题行）—— 见 catBlock 处的说明。
				'panel.subRest': '其余情况',
				// ── 破坏性命令的八档（默认折叠）──────────────────────────────
				// 标签必须**说清它管什么**，而不是照抄内部标识符：用户要判断的是
				// 「我这条命令会不会被它拦」，看不懂名字就只能一律设成允许（那等于关掉保护）。
				//
				// ── 为什么标签短、判据长（两套文案）────────────────────────────────
				// 上一版把完整判据当标签用（`目标是盘根/系统/用户目录`、
				// `目标无法判定（含变量或读不懂）`），结果是八行参差不齐：
				// 有的占满一行、有的只占四个字，右侧下拉框被推得左一列右一列。
				// 现在行内只放**名词短语**（`工作区内` / `盘根与系统目录`），
				// 完整判据（怎么算、举例、边界）挪到 title 悬浮 ——
				// 扫的时候快，想深究时一个字都不少。
				//
				// 前四档按**目标范围**判（判据是路径），后四档按**命令类别**判
				// （这些命令没有路径目标 —— 伤害对象是进程/电源/注册表）。
				// 分组标题就是为这个区别存在的。
				'panel.tierInside': '工作区内',
				'panel.tierOutside': '工作区外',
				'panel.tierWide': '盘根与系统目录',
				'panel.tierUnknown': '目标无法判定',
				'panel.tierProc': '结束进程',
				'panel.tierPower': '关机 / 重启',
				'panel.tierPriv': '提权',
				'panel.tierReg': '注册表 / WMI',
				// 悬浮全文：行内标签被截断或过于简短时，这里给出完整判据。
				'panel.tierInsideHint': '目标路径在工作区内（含相对路径解析后的结果）',
				'panel.tierOutsideHint': '目标路径在工作区外，但不在盘根/系统/用户目录之下',
				'panel.tierWideHint': '目标是盘根、系统目录或用户目录 —— 删了不可逆',
				'panel.tierUnknownHint': '目标读不出来：含变量、命令替换，或参数形态无法解析',
				'panel.tierProcHint': '结束进程（kill / taskkill / pkill 等）—— 没有路径目标',
				'panel.tierPowerHint': '关机、重启、休眠（shutdown / reboot 等）—— 没有路径目标',
				'panel.tierPrivHint': '提权（sudo / su / runas / doas 等）—— 没有路径目标',
				'panel.tierRegHint': '注册表 / WMI（reg / wmic 等）—— 没有路径目标',
				// 分组标题（画在 ::after 分隔线左侧）。只给下四档加、上四档不加：
				// 上四档是本列表的主体，给它们也加一个标题只会多占一行；
				// 分隔线画在**判据切换处**才有信息量。
				'panel.tierGroupName': '按命令类别',
				// 展开/折叠链接的文案。与例外列表的 `▸ 例外列表（18 条）` 同构：
				// 折叠态 = 「展开 + 摘要」，展开态 = 「收起」（不带摘要 —— 那时八行都看得见）。
				'panel.tierExpand': '展开',
				'panel.tierExpandAll': '展开（{s}）',
				'panel.tierCollapse': '收起',
				// 说明行**独立成行**，故文案不再以「：」开头（上一版它是拼在标题后面的后缀）。
				// 也不再说「按此动作」—— 八档各有各的动作，那句话现在不成立了。
				// 折叠摘要：**由实际生效值生成**（不能写死「均为询问」，否则面板说谎）。
				// 形状是「按动作分组的计数」：`拒绝 2 · 询问 5` / `均为「询问」`。
				// 它回答的是折叠态该回答的问题 ——「有没有哪档被设成了意外的值」。
				//
				// 文案不再说「其余档位」：那个「其余」是旧设计里「inside 留在外面、
				// 只有其余七档被折叠」的残留措辞。现在八档全收起、计数也覆盖八档，
				// 「其余」既无所指，又会让用户去找「那个没被算进去的档」。
				'panel.tierRestAll': '均为「{v}」',
				'panel.tierRestMixed': '{list}',
				// 计数摘要里的一项：`拒绝 2`（动作 + 该动作的档数）
				'panel.tierCount': '{v} {n}',
				// 单档状态点的悬浮文案：「档位名：动作」
				'panel.tierDotTitle': '{t}：{v}',
				// 「其余情况」而不是「默认动作」：那个控件在 command 块里就叫这个名字
				// （见 panel.subRest 与 commandRestRow）。提示里说「默认动作」而面板上
				// 找不到同名标签，用户读完提示不知道该去改哪个下拉框。
				// 末句的选项名必须与面板上的**实际标签逐字一致**（`mode.inherit` = 「继承全局」，
				// 经 sel → modeLabel → T('mode.inherit') 渲染）。写「跟随全局」时用户按提示去改
				// 档位会发现下拉里没有这一项 —— 与本次把「默认动作」改成「其余情况」同一个理由：
				// 提示里点名的控件必须是面板上找得到的那个名字。
				'panel.subMismatch': '注意：「命令」的「其余情况」是「{cat}」，但「破坏性命令」里「{tier}」这一档是「{sub}」—— 判定链上破坏性命令优先，命中该档的破坏性命令会按「{sub}」处理（不会按「{cat}」）。若想让「其余情况」生效，请把该档也改成「{cat}」或「继承全局」。',
				// 命令类工具的管辖边界。这条提示存在的理由是一个**真实的语义缺口**：命令工具
				// （pwsh/bash）的判定链是 例外 → 破坏性八档 → 本分类默认值，与 read/image/edit/
				// undo/outsideRead/directory 六道闸**完全无关**（区外写闸=deny、编辑=deny 时，
				// `Set-Content G:/outside/x.txt` 与 `Get-Content G:/outside/secret.txt` 仍判 allow）。
				// 九个分类平铺展示会让人读成「九个维度都生效」，而命令块又排在最前，于是
				// 「我把区外写设成拒绝就安全了」是一个很容易形成的错误结论。
				//
				// 主体必须是「AI」（做决策、发工具调用的是模型，不是命令工具也不是 DSH），
				// 措辞用「绕过」而不是「不受…限制」—— 前者点出这是 AI 主动走的旁路。
				// 只陈述边界事实、不给出路：真正能定向拦的是命令例外，但那是例外列表的用法。
				'panel.cmdScopeNote': '注意：AI 可通过执行命令直接读写文件（Set-Content、echo > 等），绕过「读取文件 / 编辑文件 / 工作区外读写」等文件分类限制。',
				// ── 循环检测（doomloop）阈值 ────────────────────────────────────────
				// 文案只留「管什么」+「留空什么语义」：不解释计数口径（弹窗批准不算、被拒清零…
				// 那是实现细节，用户改不了也用不上），也不写 Markdown 语法 —— 这里是纯文本，
				// `**x**` 会原样显示成星号（实测过）。
				// 也不说「静默放行」这类术语：那是实现内部的叫法，界面上只说「相同调用」。
				'panel.loopThreshold': '触发阈值',
				'panel.loopThresholdHint': '：连续多少次相同调用后触发。留空 = 用默认值。',
				'panel.loopThresholdPh': '默认 {n}',
				'panel.loopThresholdPhEff': '实际生效 {n}',
				'panel.loopThresholdUnit': '次',
				'panel.loopThresholdSave': '保存',
				'panel.loopThresholdBad': '阈值需为正整数',
				'panel.loopThresholdSaved': '循环检测阈值已保存（{t}）：连续 {n} 次后触发',
				'panel.loopThresholdCleared': '循环检测阈值已恢复为默认（{t}）',
				'panel.loopOff': '⚠ 「重复操作」的动作是「允许」—— 循环检测已关闭，AI 连续重复相同调用时不会有任何提醒。',
				'panel.loopDenyWarn': '⚠ 动作是「拒绝」：命中时直接中断 AI、不弹窗，你不会有确认机会。判据是「连续 N 次逐字节相同」的调用，误判概率极低但并非零。',
				'panel.excTooBroad': '匹配范围过宽',
				'panel.excTooBroadHint': '这条例外匹配任意单个命令段，等于不再审查任何命令。建议改成具体命令（如 git status *）。',
				// 与上面那条是**两个不同的失效模式**：过宽说的是「覆盖了太多命令」，
				// 这条说的是「例外本身很具体，但指向的目标删了就没」。悬停 title 给出完整路径与后果。
				'panel.excBlast': '目标范围过大',
				// 遮蔽标注（宿主下发 exceptionShadow）：写入侧 push 到末尾、读侧首条命中即生效，
				// 故新加的例外若与前面某条同目标且方向相反就**不会生效**。不标出来的话，
				// 用户只看到列表里多了一行、面板还提示「已保存」，会以为决定已生效。
				// {a} 是遮蔽它的那条的动作（allow / deny / ask），{id} 是那条的 id。
				'panel.excShadowed': '未生效',
				'panel.excShadowedHint': '被上方更早的例外（{a}，id={id}）遮蔽：判定只取首个匹配，故这一条当前不起作用。用 ↑ 把它移到那条之前即可生效。',
				'quick.web_search': '网页搜索',
				'quick.skill': '加载技能',
				'quick.grep': '内容检索',
				'quick.glob': '按名查找文件',
				'quick.web_fetch': '抓取网页内容',
				'quick.ask_user_question': '向你提问',
				'quick.todo_write': '任务清单',
				'quick.list_agents': '列出子代理',
				// 只读枚举「子代理可以路由到哪些 provider / model」——不发起委派、不改配置。
				'quick.list_subagent_models': '列出子代理可用的模型（只读，不发起委派）',
				'quick.job_list': '后台任务列表',
				'quick.job_output': '读取任务输出',
				'quick.job_kill': '终止后台任务',
				'quick.get_goal': '查看当前目标',
				'quick.create_goal': '创建目标',
				'quick.update_goal': '更新目标状态',
				'quick.send_message': '给子代理发消息',
				'quick.interrupt_agent': '打断子代理',
				// wait_agent 等的是「自己的下一步收件箱」，不消费输入也不启动 agent —— 文案要说清
				// 它等什么，否则用户会以为放行它等于允许 AI 无限期卡住。
				'quick.wait_agent': '等子代理的消息或完成通知（只等自己那一步，不启动任何子代理）',
				// team_task_* 四条共用一句前提：改的是共享任务板，不是文件也不是别的 agent 的状态。
				'quick.team_task_create': '在共享任务板上建一条任务',
				'quick.team_task_list': '列出共享任务',
				'quick.team_task_get': '按 id 读一条共享任务',
				'quick.team_task_update': '认领、编辑、完成或删除共享任务（不唤醒空闲的子代理）',
				'quick.present': '声明交付文件',
				'quick.exit_plan_mode': '退出计划模式',
				'quick.cordis_inspect_list': '检视能力清单',
				'quick.cordis_inspect_query': '执行只读检视',
				'quick.perm_status': '查看权限状态',
				'quick.plugin_manager': '管理插件与插件包',
				// plugin_market 只列市场里有什么、版本号多少，真正的安装走 plugin_manager。
				'quick.plugin_market': '浏览插件市场（只读；安装仍走「管理插件与插件包」）',
				// 工具自身没有文件/命令语义，说明文字要让用户看懂「放行/拒绝它意味着什么」。
				// working_directory 的关键不是读写（它不写盘），而是**换基准**：改完 cwd，
				// 后续相对路径全部落到新目录下，故文案点出「后续相对路径」而不是只说「切换目录」。
				'quick.working_directory': '读取或切换工作目录（改变后续相对路径的基准）',
				// schedule_* 四条的共同前提：到期是**无人值守自动触发**（会话内提醒到点把一条 prompt
				// 投回本会话、让模型接着跑一轮）。只说「创建提醒」会让人以为是桌面闹钟，
				// 看不出「AI 会在没有你操作的时候自己动起来」这层含义，故 create/update 两条明写。
				'quick.schedule_create': '创建定时提醒（到点自动唤醒 AI 跑一轮，无需你在场）',
				'quick.schedule_list': '列出本会话的定时提醒',
				'quick.schedule_edit': '修改定时提醒（含触发时间；改完仍会到点自动唤醒 AI），也能删除',
				'quick.schedule_view': '按 id 查看一条定时提醒',
				// 旧名：DSH 0.2.2-alpha.3 起不再注册（改名不是等价的，见 index.js 的
				// QUICK_DEFAULTS 注释），两代键都留在清单里以兼容回退到旧 DSH 的部署。
				// 标签必须写明「仅旧版 DSH 生效」：新版下这两行改不动任何东西，
				// 真正的删除权限在 schedule_edit 那一行，不写清楚就是面板说谎。
				'quick.schedule_update': '修改定时提醒（仅旧版 DSH 生效；新版请改 schedule_edit）',
				'quick.schedule_delete': '删除定时提醒（仅旧版 DSH 生效；新版请改 schedule_edit）',
				// run_code 的关键不是「执行代码」这件事本身，而是
				// **执行面有一半在本插件视野之外**：程序内对 tools.* 的调用会逐条过闸，
				// 但直接调 Node API 的部分只有 DSH 原生沙箱管得住。文案点出这层区别，
				// 避免用户把它读成「和 pwsh 一样的命令审查」而放心设成 allow。
				'quick.run_code': '执行模型写的 TypeScript 程序（程序内直接调用 Node API 的部分不经过本审查）',
				'panel.excExpand': '展开',
				'panel.excCollapse': '折叠',
				'panel.excListLink': '例外列表',
				'panel.excUnit': '条',
				'panel.excPh': '命令段 / glob',
				'panel.excPathPh': '路径 glob',
				'panel.excReason': '拒绝原因',
				'panel.excReasonPh': '选填：会告知 AI 为什么被拒',
				'panel.excNote': '备注',
				'panel.excNotePh': '选填：命中时显示在弹窗上，勿写敏感信息',
				// 例外行编辑态：模式输入框的悬浮说明 + 两个失败提示。
				// `excEditPat` 要说清「这里改的是匹配什么」，而不是只写「模式」两个字。
				'panel.excEditPat': '这一条例外匹配的命令段 / 路径',
				// 行内那个「改匹配」按钮：与原因格的「编辑」区分（同一行两个可编辑对象，
				// 都叫「编辑」时用户不知道点哪个改哪个）。
				'panel.excEditPatBtn': '改匹配',
				'panel.excEmpty': '匹配内容不能为空',
				'panel.denyReason': '拒绝原因',
				'panel.denyReasonPh': '选填：拒绝时告知 AI 原因',
				'panel.denyReasonHint': '填写后按回车或点「保存」生效',
				'panel.denyReasonNone': '未设置拒绝原因，将用默认原因',
				'panel.reasonEdit': '编辑',
				'panel.reasonSave': '保存',
				'panel.reasonSaved': '已保存',
				'panel.addExc': '添加例外',
				'panel.confirmDel': '确认删除？',
				'panel.cancel': '取消',
				'panel.del': '删除',
			},
			en: {
				'app.title': 'Permission Review',
				'app.collapse': 'Collapse to a small block',
				'app.resetPos': 'Reset to default position (top right)',
				'app.timeoutIn': '⏳ auto-{act} in {n}s',
				'app.timeoutStop': 'Stop countdown',
				'app.modelReasonPrefix': 'Model says: ',
				'app.timeoutStopHint': 'After stopping, this request waits for you indefinitely',
				'app.timeoutStopFailed': 'Could not stop: the countdown is still running',
				'app.fromSession': 'From conversation: ',
				'app.request': '{tool} requests to run',
				'app.intent': 'Intent',
				'app.args': 'Arguments',
				// ── blast-radius warnings (approval popup) ──
				'app.blast.driveRoot': 'Target is an entire drive ({p}) — everything on it will be permanently deleted, not sent to the Recycle Bin',
				'app.blast.broad': 'This rule does not limit the deletion target ({p}) — it also allows deleting a drive root or a system directory',
				'app.blast.system': 'Target is a system directory ({p}) — deleting it may leave the system or installed software unable to start',
				'app.blast.workspaceRoot': 'Target is **this project root** ({p}) — every file in the project will be deleted, not sent to the Recycle Bin',
				'app.blast.unknown': 'Cannot determine what this command targets ({p}) — it contains variables or constructs that cannot be read, so the real impact may reach outside the workspace',
				'app.blast.home': 'Target is your user directory ({p}) — configuration and documents in it will be lost',
				'app.blast.outside': 'Target is outside the workspace ({p}) — not part of this project',
				'app.cand.head': 'Add project rule (current project)',
				'app.cand.hint': 'Toggle items then click Allow / Deny to write them into the current project exceptions.',
				'app.allow': 'Allow',
				'app.deny': 'Deny',
				'app.allowOne': '√ Allow',
				'app.denyOne': '× Deny',
				'app.denyReason': 'Rejection reason',
				'app.denyReasonPh': 'Optional: sent to the agent as the denial reason (default: User denied)',
				'app.confirmDeny': 'Confirm deny',
				'app.detail': 'Details',
				'app.diffNew': 'New file',
				'app.diffMod': 'Modified',
				'app.diffMore': '{n} more lines',
				'app.diffLoading': 'Loading…',
				'app.diffErr': 'Cannot build comparison',
				'app.imageTag': 'Image',
				'app.imageTooLarge': 'Image too large; thumbnail not generated',
				'app.imageSizeUnknown': 'Image size could not be determined; thumbnail not generated',
				'app.imageNoPreview': 'No thumbnail available',
				'app.uiErr': 'UI render error',
				'app.eolNote': 'Line endings normalized to LF for matching (CRLF/CR file with LF args): preview is indicative only; the actual edit may fail on line-ending mismatch',
				'app.diffGapShow': 'Show {n} unchanged lines',
				'app.diffGapHide': 'Hide {n} lines',
				'app.diffGapMore': '… {n} unchanged lines',
				'app.diffCopy': 'Copy',
				'app.diffCopied': 'Copied',
				'app.diffExpand': 'Expand',
				'app.diffCollapse': 'Collapse',
				'app.diffRead': 'Read',
				'app.diffLines': '{n} lines',
				'app.encHint': 'Not UTF-8; content decoded with this encoding',
				'app.encGuessedHint': 'Not UTF-8; the encoding was guessed from the content and may be wrong',
				'app.undoVerdictSkipped': 'This preview is decoded differently from the encoding the tool actually uses, so whether the undo will run cannot be determined here. Only the content to be restored is shown; this does not mean the undo will definitely run.',
				'app.diffTopMore': '… {n} more lines above',
				'app.diffBottomMore': '… more lines below',
				'app.diffClose': 'Close',
				'app.openFile': 'Open in sidebar',
				'app.openFileFailed': 'Cannot open in the sidebar (this DSH build has no right-sidebar service)',
				'app.diffResize': 'Drag to resize',
				'settings.title': 'Permissions',
				'cat.directory': 'Write outside workspace',
				'cat.outsideRead': 'Read outside workspace',
				'cat.command': 'Run command',
				'cat.read': 'Read file',
				'cat.image': 'Read image',
				'cat.edit': 'Edit file',
				'cat.undo': 'Undo edit (revert last edit)',
				'cat.subagent': 'Spawn subagent',
				'cat.doomloop': 'Doom Loop',
				'catS.directory': 'Outside write',
				'catS.outsideRead': 'Outside read',
				'catS.command': 'Command',
				'catS.read': 'Read',
				'catS.image': 'Image',
				'catS.edit': 'Edit',
				'catS.undo': 'Undo',
				'catS.subagent': 'Subagent',
				'catS.doomloop': 'Repeat',
				'catS.custom': 'Rule',
				'catS.quick': 'Quick',
				'catS.fallback': 'Fallback',
				'mode.ask': 'Ask',
				'mode.allow': 'Allow',
				'mode.deny': 'Deny',
				'mode.inherit': 'Inherit global',
				'mode.auto': 'Auto review',
				'mode.unknown': 'Unknown action: {a}',
				'panel.autoFallbackLabel': 'if it fails: ',
				'panel.autoFallbackReadonlyHint': 'Fallback cannot be set for a new entry yet; it defaults to Ask. You can change it in the list after adding.',
				'panel.autoReview': 'Auto review',
				'panel.autoReviewHint': 'When a category is set to Auto review, each call is checked by a model first. These are its runtime settings, global to all projects.',
				'panel.autoNoLlm': 'No model service is available. Every Auto review call will fall back to the action you chose.',
				'panel.autoTimeout': 'Wait for a human',
				'panel.autoTimeoutHint': 'how long the dialog waits after it appears; when it runs out, waiting stops.'
					+ '\n· model failed and "if it fails" is Allow or Deny: run that action when it runs out. 0 = no dialog, run it right away.'
					+ '\n· high-risk allow and "When unanswered" is Deny or Allow: follow that choice when it runs out. 0 = wait forever.'
					+ '\n· "if it fails" is Ask, or high-risk allow and "When unanswered" is Wait: this setting does nothing; the dialog still appears and waits for you.',
				'panel.autoBreaker': 'Consecutive denials',
				'panel.autoBreakerHint': 'after this many denials in a row, stop asking the model and use the "if it fails" setting instead. 0 = never stop',
				'panel.autoHistory': 'Tool call history',
				'panel.autoHistoryHint': 'how many recent tool calls to include on the left, and the total length cap for that text on the right (oldest dropped first). What you typed yourself is not limited here and is always sent',
				// 标签：推理等级照抄官方（menu.effort）；「审批模型」是本卡片专用的叫法
				// —— 它指的是**自动审批**去评审工具调用的模型，不是作曲区那个对话模型。
				'panel.autoModel': 'Approval model',
				'panel.autoModelFollow': 'Follow session',
				'panel.autoPickerAria': 'Approval model and effort',
				'panel.autoSearchPh': 'Search models…',
				'panel.autoSearchClear': 'Clear search',
				'panel.autoSearchEmpty': 'No matching models.',
				'panel.autoModelEmpty': 'No models available.',
				'panel.autoEffort': 'Effort',
				'panel.autoEffortHint': '"Follow session" uses this conversation\'s setting; "Model highest"/"Model lowest" pick from the effort levels the chosen model publishes; a model that publishes none uses its own default',
				'panel.autoEffortSession': 'Follow session',
				'panel.autoEffortDefault': 'Model default',
				'panel.autoEffortMax': 'Model highest',
				'panel.autoEffortMin': 'Model lowest',
				'panel.autoEffortGroupCommon': 'Generic',
				'panel.autoEffortGroupSpecific': 'Specific',
				'panel.autoEffortNone': 'This model publishes no reasoning levels',
				'panel.autoModelLoading': 'Loading…',
				'flow.viaAllow': 'Auto review: model allowed {tool} → {action}',
				'flow.viaDeny': 'Auto review: model denied {tool} → {action}',
				'flow.viaEscalate': 'Auto review: model was unsure about {tool} → {action}',
				'flow.viaFallback': 'Auto review could not use the model for {tool} → {action}{direct}',
				'flow.directTag': ' (ran directly per your setting)',
				'flow.action.allow': 'allow',
				'flow.action.ask': 'ask',
				'flow.action.deny': 'deny',
				'flow.why': 'Reason: ',
				'flow.modelReason': 'Model note: ',
				'flow.risk': 'Model risk: ',
				'flow.effort': 'Effort: ',
				'flow.effortWithWant': '{effort} (setting: {want})',
				'flow.effortNone': 'not dispatched (setting: {want})',
				'flow.effortNoneNoTable': 'not dispatched (setting: {want}; this model publishes no reasoning levels)',
				'flow.effortNoneDefault': 'not dispatched (setting: {want}; this model has no default reasoning level)',
				'flow.effortNoneSession': 'not dispatched (setting: {want}; the session selected no reasoning level, or its level is not one this model publishes)',
				'flow.rule': 'Matched rule: ',
				'flow.raw': 'Model raw output: ',
				'flow.riskValue.low': 'low',
				'flow.riskValue.medium': 'medium',
				'flow.riskValue.high': 'high',
				'flow.riskValue.unknown': 'unknown level: {r}',
				'panel.autoSaved': 'Saved',
				'panel.autoBadNumber': 'enter a number in range',
				'panel.autoSecUnit': 's',
				'panel.autoTimesUnit': 'times',
				'panel.autoCharsUnit': 'chars',
				'panel.autoReset': 'Reset all to defaults',
				'panel.autoResetConfirm': 'Reset everything?',
				'panel.autoResetWarn': 'clears every explicit global setting; cannot be undone',
				'panel.autoResetDone': 'Reset to defaults',
				'panel.autoPolicy': 'Extra review rules',
				'panel.autoPolicyHint': 'Extra rules for the approval model, appended after the built-in policy. They do not change the risk level, only the decision.',
				'panel.autoPolicyGlobal': 'Global',
				'panel.autoPolicyProject': 'This project',
				// 与中文同义：三个选项描述的是本项目这段文本与全局那段的关系。
				'panel.autoPolicyMode': 'Relation to global',
				'panel.autoPolicyModeInherit': 'Inherit global',
				'panel.autoPolicyModeAppend': 'Append to global',
				'panel.autoPolicyModeReplace': 'Replace global',
				'panel.autoPolicyInheritHint': 'Set to "Inherit global"; this text is not sent',
				'panel.autoPolicyReplaceHint': 'Set to "Replace global"; the global text is not sent',
				// 与中文同一份示例的两个方向，理由见中文那处的说明。
				'panel.autoPolicyPh': 'e.g. always deny .env and *.pem; allow read-only queries like git status and ls',
				'panel.autoPolicyCount': '{n} / {max}',
				// 两档提示分开，理由见中文那处（超上限那句带真上限）。
				'panel.autoPolicyTooLongWarn': 'policy is long; model attention may be diluted',
				'panel.autoPolicyTooLong': 'the policy is over the length limit ({max} chars)',
				'panel.autoPolicySaved': 'Saved',
				'panel.autoPolicySave': 'Save',
				'panel.autoHighRisk': 'Model rates it high risk but allows it',
				'panel.autoHighRiskTitle': 'When a high-risk call is allowed',
				'panel.autoHighRiskHint': 'The model may mark a call high risk and still allow it. This decides what happens then. It asks the model once more first; only a second high-risk allow is handled here',
				'panel.autoHighRiskTimeout': 'When unanswered',
				'panel.autoHighRiskTimeoutHint': 'only used when the setting above is Ask. Wait = the dialog never times out; Deny/Allow = follow that once "Wait for a human" elapses',
				'panel.autoHighRisk.deny': 'Deny',
				'panel.autoHighRisk.ask': 'Ask',
				'panel.autoHighRisk.allow': 'Allow',
				'panel.autoHighRiskTimeout.wait': 'Wait',
				'panel.autoHighRiskTimeout.deny': 'Deny',
				'panel.autoHighRiskTimeout.allow': 'Allow',
				'panel.autoPolicyInherit': 'Inherit global',
				'panel.autoDenyReasonTitle': 'What the model is told on denial',
				'panel.autoDenyReason': 'What goes back to the model',
				'panel.autoDenyReasonHint': 'On denial the model gets the line chosen here, plus a "which segment, which tier" summary appended; it steers by that',
				'panel.autoDenyReason.default': 'Auto review\'s verdict reason',
				'panel.autoDenyReasonDesc.default': 'Pass its own reason straight back, so it never has to guess',
				'panel.autoDenyReason.custom': 'Fixed line',
				'panel.autoDenyReasonDesc.custom': 'Withhold the model\'s own reason so it cannot pick a way around',
				'panel.autoDenyReason.both': 'Both combined',
				'panel.autoDenyReasonDesc.both': 'Passes the model\'s own reason, plus a line of guidance from you',
				'panel.autoDenyReasonPh': 'Leave empty to get one of these, depending on the situation',
				'panel.autoDenyReasonPhInherit': 'Leave empty to reuse the global wording',
				'panel.autoDenyReasonInherit': 'Left empty: the global custom wording is sent — {text}',
				'panel.autoDenyReasonDefaultsLabel': 'By situation:',
				'flow.viaAllowHigh': 'Auto review: model rated {tool} high risk and allowed it → {action}',
				'flow.viaDenyHigh': 'Auto review: model rated {tool} high risk and allowed it; denied by your setting → {action}',
				'flow.viaAskHigh': 'Auto review: model rated {tool} high risk but allowed it; waiting for you → {action}',
				'mode.timeout-allow': 'Auto-allowed (timeout)',
				'mode.timeout-deny': 'Auto-denied (timeout)',
				'mode.fallback-allow': 'Allowed by setting',
				'mode.fallback-deny': 'Denied by setting',
				'panel.status': 'Config & stats',
				'panel.config': 'Config: ',
				'panel.stats': 'Recent: {d} denied · {a} asked',
				'panel.loadErr': 'Load error: ',
				'panel.saveErr': 'Save error: ',
				'panel.fenceUntrusted': 'Request origin is not trusted; rejected by the permission gateway (403). Reopen this page from the local URL printed by dsh web.',
				'panel.fenceUnauthenticated': 'Browser credentials are missing or expired (401). Reopen this page from the URL printed by dsh web to authenticate.',
				'panel.tabGlobal': 'Global',
				'panel.tabProject': 'Project',
				'panel.tabAuto': 'Auto review',
				'panel.autoScope': 'Scope',
				'panel.editGlobal': 'Editing global settings (default for all projects).',
				'panel.editProject': 'Editing current project ({p}); project settings override global.',
				'panel.sandbox': 'Sandbox',
				'sandbox.ww': 'Workspace Write',
				'sandbox.fa': 'Full access',
				'sandbox.inherit': 'Inherit global',
				'sandbox.desc.ww': 'File operations are restricted to the workspace',
				'sandbox.desc.fa': 'File operations are not workspace-restricted',
				'sandbox.desc.inherit': 'Follows global (currently: {g})',
				'panel.quick': 'Quick tools (other tools)',
				'panel.quickHint': 'Tools without file/command semantics: set a default per tool name; anything outside this list follows the fallback policy. Changes apply immediately.',
				'panel.quickAdd': 'New tool name (e.g. todo_write, wildcards allowed)',
				'panel.quickAddBtn': 'Add',
				'panel.rules': 'Custom rules (generic matching)',
				'panel.actionDeny': 'deny Deny',
				'panel.actionAsk': 'ask Ask',
				'panel.actionAllow': 'allow Allow',
				'panel.toolPh': 'tool wildcard (e.g. cordis_*)',
				'panel.pathPh': 'path glob',
				'panel.argsPh': 'args substring',
				'panel.reasonPh': 'reason (optional)',
				'panel.addToGlobal': 'Add to Global',
				'panel.addToProject': 'Add to Project',
				'panel.ruleList': '{t} rules ({n})',
				'panel.noRules': 'No rules',
				'panel.decisions': 'Recent decisions',
				'panel.noDecisions': 'No decisions yet',
				// 展开/收起决策记录。{n} 是展开后能看到的条数，{m} 是首屏条数。
				'panel.decisionsExpand': 'Show all ({n})',
				'panel.decisionsCollapse': 'Collapse (show last {m})',
				'panel.decisionsLoading': 'Loading…',
				'panel.decisionsFailed': 'Load failed',
				'panel.reload': 'Reload config file',
				'panel.openConfig': 'Open',
				'panel.openConfigDone': 'Opened with default editor',
				'panel.saved': 'Saved',
				'panel.savedToGlobal': 'Saved to global',
				'panel.savedToProject': 'Saved to this project',
				'panel.all': '(all)',
				'panel.sandboxSaved': 'Sandbox saved ({t}): {v}',
				'panel.fallbackSaved': 'Fallback policy saved ({t}): {v}',
				'panel.fallback': 'Fallback policy (no rule matched)',
				'panel.fallbackHint': 'How calls outside the categories above and not listed as quick tools (e.g. mcp__*, plugin-registered tools) are handled.',
				'panel.needValue': 'Enter a match value first',
				'panel.excRemaining': '{n} exception(s) with the same value remain on this path; delete them individually if not wanted',
				'panel.delFailed': 'Delete failed',
				'panel.needTool': 'Enter a tool name',
				'panel.excCount': 'Exceptions ({n})',
				'panel.excCmdHint': ': matches a single command segment (glob); overrides sub-setting and category default',
				'panel.excPathHint': ': path glob, overrides category default',
				'panel.excNone': 'No exceptions',
				// ── filter and empty state for long lists (quick tools / exceptions / rules) ──
				'panel.listFilterPh': 'Filter…',
				'panel.listNoMatch': 'No matching entries',
				'panel.listMatchCount': '{n} / {m}',
				// ── list ordering (rules / exceptions) ──
				'panel.moveUp': 'Move up (takes effect earlier)',
				'panel.moveDown': 'Move down (takes effect later)',
				'panel.subDestructive': 'Destructive commands',
				'panel.subDestructiveHint': 'risky operations such as deleting files, formatting disks, shutting down or escalating privileges follow their own tier action (exceptions first)',
				'panel.subDestructiveNote': 'Note: detection is text-based and cannot cover every destructive command.',
				// "everything else" — the last gate of the command category (see the zh comment).
				'panel.subRest': 'Everything else',
				// ── the eight tiers of "Destructive commands" (collapsed by default) ──
				'panel.tierInside': 'Inside workspace',
				'panel.tierOutside': 'Outside workspace',
				'panel.tierWide': 'Drive root / system',
				'panel.tierUnknown': 'Target unknown',
				'panel.tierProc': 'Kill process',
				'panel.tierPower': 'Shutdown / restart',
				'panel.tierPriv': 'Privilege',
				'panel.tierReg': 'Registry / WMI',
				'panel.tierInsideHint': 'Target path is inside the workspace (after resolving relative paths)',
				'panel.tierOutsideHint': 'Target path is outside the workspace, but not under a drive root / system / user directory',
				'panel.tierWideHint': 'Target is a drive root, system directory or user directory — deletion is irreversible',
				'panel.tierUnknownHint': 'Target cannot be read: variables, command substitution, or an unparsable argument shape',
				'panel.tierProcHint': 'Kill a process (kill / taskkill / pkill etc.) — no path target',
				'panel.tierPowerHint': 'Shutdown, restart, hibernate (shutdown / reboot etc.) — no path target',
				'panel.tierPrivHint': 'Privilege escalation (sudo / su / runas / doas etc.) — no path target',
				'panel.tierRegHint': 'Registry / WMI (reg / wmic etc.) — no path target',
				'panel.tierGroupName': 'by command category',
				'panel.tierExpand': 'Expand',
				'panel.tierExpandAll': 'Expand ({s})',
				'panel.tierCollapse': 'Collapse',
				'panel.tierRestAll': 'all "{v}"',
				'panel.tierRestMixed': '{list}',
				'panel.tierCount': '{v} {n}',
				'panel.tierDotTitle': '{t}: {v}',
				// "Everything else" rather than "default action": that is the label on the panel
				// (see panel.subRest and commandRestRow); naming a control the user cannot find.
				// "Inherit global" (the label of `mode.inherit`) rather than "inherit": the option
				// the sentence tells the user to pick must read exactly like the one in the dropdown.
				'panel.subMismatch': 'Note: for "command", "Everything else" is "{cat}", but the "{tier}" tier under "Destructive commands" is "{sub}". Destructive commands take precedence in the verdict chain, so ones matching that tier follow "{sub}" (not "{cat}"). To make "Everything else" apply, set that tier to "{cat}" or "Inherit global".',
				// Scope boundary of command tools — mirrors panel.cmdScopeNote. The subject is the AI
				// (see the Chinese entry: neither "command tools" nor "DSH" is right — the tool does
				// not run commands by itself, and DSH is the host, not the actor). The English panel
				// already says "the AI" elsewhere ("tells the AI why it was denied", "aborts the AI").
				'panel.cmdScopeNote': 'Note: the AI can read and write files directly by running commands (Set-Content, echo > and the like), bypassing the file categories (file read / file edit / outside-workspace read and write).',
				// ── doom loop threshold ────────────────────────────────────────────
				'panel.loopThreshold': 'Trigger threshold',
				'panel.loopThresholdHint': ': how many identical calls in a row before it triggers. Leave empty to use the default.',
				'panel.loopThresholdPh': 'default {n}',
				'panel.loopThresholdPhEff': 'in effect {n}',
				'panel.loopThresholdUnit': 'calls',
				'panel.loopThresholdSave': 'Save',
				'panel.loopThresholdBad': 'The threshold must be a positive integer',
				'panel.loopThresholdSaved': 'Doom loop threshold saved ({t}): triggers after {n} calls in a row',
				'panel.loopThresholdCleared': 'Doom loop threshold reset to default ({t})',
				'panel.loopOff': '⚠ The "repeat" action is "allow" — doom loop detection is OFF; repeated identical calls by the AI will produce no reminder at all.',
				'panel.loopDenyWarn': '⚠ The action is "deny": a hit aborts the AI immediately without a dialog, so you get no chance to confirm. The criterion is N byte-identical consecutive calls, so false positives are very unlikely but not impossible.',
				'panel.excTooBroad': 'Very broad',
				'panel.excTooBroadHint': 'This exception matches any single command segment — effectively no command review at all. Prefer a concrete command such as git status *.',
				'panel.excBlast': 'Target too broad',
				// Shadowed marker (host sends exceptionShadow): writes append to the tail while the
				// reader takes the first match, so an exception whose opposite-direction twin comes
				// first never takes effect. Without this marker the user only sees a new row plus a
				// "saved" notice and assumes the decision is live.
				'panel.excShadowed': 'Not in effect',
				'panel.excShadowedHint': 'Shadowed by an earlier exception above ({a}, id={id}): the decision uses the first match only, so this row currently has no effect. Move it above that row with ↑ to make it take effect.',
				'quick.web_search': 'web search',
				'quick.skill': 'load skill',
				'quick.grep': 'content search',
				'quick.glob': 'find files by name',
				'quick.web_fetch': 'fetch page content',
				'quick.ask_user_question': 'ask you a question',
				'quick.todo_write': 'todo list',
				'quick.list_agents': 'list subagents',
				// Read-only enumeration of the routes a subagent may use; spawns nothing.
				'quick.list_subagent_models': 'list models available to subagents (read-only, spawns nothing)',
				'quick.job_list': 'list background jobs',
				'quick.job_output': 'read job output',
				'quick.job_kill': 'kill a background job',
				'quick.get_goal': 'view current goal',
				'quick.create_goal': 'create a goal',
				'quick.update_goal': 'update goal state',
				'quick.send_message': 'message a subagent',
				'quick.interrupt_agent': 'interrupt a subagent',
				'quick.wait_agent': 'wait for subagent messages or completion (waits its own step only; starts nothing)',
				'quick.team_task_create': 'create a task on the shared board',
				'quick.team_task_list': 'list shared tasks',
				'quick.team_task_get': 'read one shared task by id',
				'quick.team_task_update': 'claim, edit, complete, or delete a shared task (wakes no idle subagent)',
				'quick.present': 'present deliverable files',
				'quick.exit_plan_mode': 'exit plan mode',
				'quick.cordis_inspect_list': 'list inspect capabilities',
				'quick.cordis_inspect_query': 'run a read-only inspect query',
				'quick.perm_status': 'view permission status',
				'quick.plugin_manager': 'manage plugins and bundles',
				'quick.plugin_market': 'browse the plugin market (read-only; installing still goes through plugin_manager)',
				// See the Chinese entries for the reasoning. The point of working_directory is not
				// reading or writing (it touches no files) but the baseline: after a cd, every
				// later relative path resolves against the new directory.
				'quick.working_directory': 'read or change the working directory (moves the base for later relative paths)',
				// schedule_* share one premise: a due reminder fires unattended — it feeds a prompt
				// back into this session and the model runs another turn without anyone present.
				// "create a reminder" alone reads like a desktop alarm clock, so create/update say it.
				'quick.schedule_create': 'create a timed reminder (wakes the AI for another turn when due, with nobody present)',
				'quick.schedule_list': 'list this session\'s timed reminders',
				'quick.schedule_edit': 'change a timed reminder (including when it fires; it still wakes the AI unattended), or delete it',
				'quick.schedule_view': 'read one timed reminder by id',
				// Legacy names: no longer registered as of DSH 0.2.2-alpha.3 (the rename was not
				// equivalent — see QUICK_DEFAULTS in index.js). Both generations stay in the list
				// so a rollback to an older DSH still resolves. The label must say "older DSH only":
				// on a current DSH these rows change nothing, and delete lives on schedule_edit.
				'quick.schedule_update': 'change a timed reminder (older DSH only; use schedule_edit on current DSH)',
				'quick.schedule_delete': 'delete a timed reminder (older DSH only; use schedule_edit on current DSH)',
				// The point is not "it runs code" but that half its
				// execution surface is outside this review: tools.* sub-calls pass through
				// the gate one by one, while direct Node API use is bounded only by the
				// platform sandbox. Saying so keeps it from reading like command review.
				'quick.run_code': 'run a model-written TypeScript program (direct Node API use inside it bypasses this review)',
				'panel.excExpand': 'Expand',
				'panel.excCollapse': 'Collapse',
				'panel.excListLink': 'Exception list',
				'panel.excUnit': 'items',
				'panel.excPh': 'command segment / glob',
				'panel.excPathPh': 'path glob',
				'panel.excReason': 'Deny reason',
				'panel.excReasonPh': 'optional: tells the AI why it was denied',
				'panel.excNote': 'Note',
				'panel.excNotePh': 'optional: shown in the dialog; no secrets',
				'panel.excEditPat': 'the command segment / path this exception matches',
				'panel.excEditPatBtn': 'Match',
				'panel.excEmpty': 'match text cannot be empty',
				'panel.denyReason': 'Deny reason',
				'panel.denyReasonPh': 'optional: tells the AI why',
				'panel.denyReasonHint': 'press Enter or click Save to apply',
				'panel.denyReasonNone': 'no reason set; default is used',
				'panel.reasonEdit': 'Edit',
				'panel.reasonSave': 'Save',
				'panel.reasonSaved': 'saved',
				'panel.addExc': 'Add exception',
				'panel.confirmDel': 'Confirm delete?',
				'panel.cancel': 'Cancel',
				'panel.del': 'Delete',
			},
		};
		let T = (key) => (I18N.zh[key] !== undefined ? I18N.zh[key] : key);
		function useLocaleTick() {
			const [, setTick] = React.useState(0);
			React.useEffect(() => {
				if (!LC || !LC.locale || typeof LC.locale.subscribe !== 'function') return undefined;
				return LC.locale.subscribe(() => setTick((v) => v + 1));
			}, []);
			return T;
		}
		function catLabel(c) { return T('cat.' + c); }
		// catShort（'catS.*' 短名）随 DockBar 一并删除：它是那条徽标专用的紧凑标签，
		// 设置面板一律用完整名 catLabel，删除后已无调用者。
		//
		// 动作标签。**未知动作不得退化成 key 本身**：归一化侧为了让「更高版本写入的动作」
		// 不被丢弃而保留了原值（actionAllowed），于是面板真会拿到 `bogus` 这种值，
		// 而 `T()` 查不到 `mode.bogus` 时返回的就是那个 key —— 用户看到「mode.bogus」，
		// 要么以为界面坏了，要么以为是他自己填错了某个叫 mode.bogus 的东西。
		// 降级成「未知动作：bogus」同时说明两件事：本版不认识它（执行侧会折成询问），
		// 以及原值是什么（排查/手改配置时要能对上）。
		// 这个兜底只在这里做一次 —— 所有渲染动作名的位置（下拉框、徽标、决策记录）
		// 都经 modeLabel，逐处判空就是 N 个漏改点。
		function modeLabel(m) {
			const k = 'mode.' + m;
			const s = T(k);
			return s === k ? T('mode.unknown').replace('{a}', String(m)) : s;
		}
		// 风险等级的显示名。与 modeLabel 同一个降级口径：查不到就明说「未知等级：X」，
		// 绝不把 `flow.riskValue.critical` 这种 key 画到界面上 —— 用户会以为界面坏了，
		// 或者以为 `critical` 是他自己填错的某个东西。
		//
		// 为什么必须翻：`d.risk` 是模型输出里的原始英文值（见 index.js 的
		// parseReviewDecision：值域是 low/medium/high），而它出现在一句中文
		// （「模型判定风险：」）后面。中英混排既难读，也让用户无法把
		// `low` 对应到这套分级里的「低」。
		function riskLabel(r) {
			const k = 'flow.riskValue.' + String(r);
			const s = T(k);
			return s === k ? T('flow.riskValue.unknown').replace('{r}', String(r)) : s;
		}
		// 快捷工具的用途说明：仅当 i18n 有对应文案时显示（用户自加的工具名不显示说明）
		function quickDesc(t) {
			const k = 'quick.' + t;
			const d = T(k);
			return d && d !== k ? d : '';
		}

		// 只认「配置里自己写入的键」：不能用 o[k] !== undefined 判断，那会把 Object.prototype 的成员
		// （constructor/toString 等）当成「该层已配置」，与服务端 hasOwnProperty 的口径分叉。
		function hasOwnKey(o, k) { return !!(o && Object.prototype.hasOwnProperty.call(o, k)); }

		// 快捷工具配置项的取值：宿主下发的恒为 { action, reason? } 对象——老配置的裸字符串在宿主
		// normalizeQuickEntry 里就已收敛成对象，预设默认值则由 quickGlobalValue 以裸字符串直接返回、
		// 不经过这两个函数。所以下面的字符串分支当前不可达，它是纯防御：万一拿到非对象形态，
		// 按裸动作字符串取值，而不是返回 undefined 把面板显示成空。
		// 名字带 Of 后缀：组件内的 quickReason 状态变量会遮蔽同名标识符，不能重名。
		function quickMode(v) { return v && typeof v === 'object' ? v.action : v; }
		function quickReasonOf(v) { return v && typeof v === 'object' ? v.reason : undefined; }

		// 未显式配置工具的全局列显示值：与服务端 quickAction 同一条链（全局键 → 预设默认 → 会话兜底）
		function quickGlobalValue(t, gq) {
			// 与服务端同径：全局层的 inherit 视为「该键不生效」，继续下落。宿主 setQuickAction 对
			// global+inherit 走 delete，但手工编辑 config.json 可以塞进来，服务端 quickAction 会跳过它——
			// 面板只有同样跳过，显示值才等于实际裁决结果（否则 select 会拿到不在选项内的 'inherit'）。
			if (hasOwnKey(gq, t) && quickMode(gq[t]) !== 'inherit') return quickMode(gq[t]);
			if (hasOwnKey(QUICK_DEFAULTS, t)) return QUICK_DEFAULTS[t];
			return QUICK_FALLBACK;
		}
		const FONT = 'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
		const card = { border: '1px solid rgba(128,128,128,0.35)', borderRadius: 8, padding: 12, marginBottom: 12 };
		const rowStyle = { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid rgba(128,128,128,0.15)', flexWrap: 'wrap' };
		const small = { fontSize: 12, color: 'rgba(128,128,128,0.95)', marginRight: 6 };
		const h = () => ({ fontSize: 13, fontWeight: 600, margin: '0 0 8px' });

		// ── 审批卡片外壳：拖动 + 缩小 ─────────────────────────────────────────
		// 位置与缩小态是**每个卡片各自的视图状态**，只活在前端（宿主只认审批内容），
		// 且刻意不持久化（不记忆，每次回默认位置）。
		// 拖动用 Pointer Events 统一鼠标/触摸/笔；shell.overlay 是 click-through 层，
		// 只有卡片本体接收指针事件，故不会挡住下层 UI。
		// 注：PG_MIN_W/PG_MIN_H/PG_MIN_GAP/PG_MIN_EDGE 已在文件顶部（PG_CARD_CSS 之前）
		// 声明 —— 那里是唯一一份，勿在此重复声明。
		// 槽位登记：只决定「新方块放哪」，永不重排。
		// 条目随卡片卸载删除，于是空出的槽位会被下一个新方块自然复用。
		const pgMinSlots = new Map();   // id -> { col, row }
		function pgTakeMinSlot(id) {
			const prev = pgMinSlots.get(id);
			if (prev) return prev;
			const vh = (typeof window !== 'undefined' && window.innerHeight) || 800;
			const perCol = Math.max(1, Math.floor((vh - PG_MIN_EDGE * 2 + PG_MIN_GAP) / (PG_MIN_H + PG_MIN_GAP)));
			const taken = new Set();
			for (const s of pgMinSlots.values()) taken.add(s.col + ':' + s.row);
			for (let col = 0; col < 8; col++) {
				for (let row = 0; row < perCol; row++) {
					if (!taken.has(col + ':' + row)) {
						const slot = { col: col, row: row };
						pgMinSlots.set(id, slot);
						return slot;
					}
				}
			}
			// 槽位用尽（现实中到不了）：退回右上角叠放，仍可拖开
			const slot = { col: 0, row: 0 };
			pgMinSlots.set(id, slot);
			return slot;
		}
		function pgSlotXY(slot) {
			const vw = (typeof window !== 'undefined' && window.innerWidth) || 1200;
			return {
				x: vw - PG_MIN_EDGE - PG_MIN_W - slot.col * (PG_MIN_W + PG_MIN_GAP),
				y: PG_MIN_EDGE + slot.row * (PG_MIN_H + PG_MIN_GAP),
			};
		}
		// 夹取：保证**可抓取区**至少露出 PG_GRAB_MIN 像素，避免「拖丢」找不回来。
		// 注意：保留的必须是可抓取区，不是「元素边缘」—— 卡片的拖动柄只有标题栏，
		// 而标题栏右端是「⌖ / —」两个按钮（onPointerDown 里 stopPropagation，不启动拖动）。
		// 早先按元素边缘保留固定像素，拖到左侧时露出的正好是这一串按钮：可拖动标题可见 0px，
		// 卡片卡死拿不回来。故改为按 pgGrabBox() 量出的可抓取区做夹取。
		const PG_GRAB_MIN = 40;   // 可抓取区至少露出这么多像素
		// 量出「可抓取区」相对元素左上角的局部范围 { gl, gt, gr, gb }（右/下为边界）。
		// 卡片 = 标题栏里「第一个按钮之前」的那段（按钮不可拖）；方块 = 整块（无标题栏）。
		function pgGrabBox(el) {
			if (!el || typeof el.getBoundingClientRect !== 'function') return null;
			const r = el.getBoundingClientRect();
			const full = { gl: 0, gt: 0, gr: r.width, gb: r.height };
			if (typeof el.querySelector !== 'function') return full;
			const head = el.querySelector('.pg-modal-head');
			if (!head || typeof head.getBoundingClientRect !== 'function') return full;
			const hr = head.getBoundingClientRect();
			const btn = head.querySelector ? head.querySelector('.pg-modal-min') : null;
			// 有按钮时以按钮左边缘为界，没有则以标题栏右边缘为界
			const right = btn && typeof btn.getBoundingClientRect === 'function' ? btn.getBoundingClientRect().left : hr.right;
			return { gl: hr.left - r.left, gt: hr.top - r.top, gr: Math.max(hr.left - r.left, right - r.left), gb: hr.bottom - r.top };
		}
		function pgClampXY(x, y, w, h, grab) {
			const vw = (typeof window !== 'undefined' && window.innerWidth) || 1200;
			const vh = (typeof window !== 'undefined' && window.innerHeight) || 800;
			// 未传可抓取区时退化为「整块都可抓」（缩小方块就是这种情况）
			const g = grab || { gl: 0, gt: 0, gr: w, gb: h };
			// 局部坐标钳进元素范围，避免调用方传入越界值
			const gl = Math.max(0, Math.min(g.gl, w));
			const gr = Math.max(gl, Math.min(g.gr, w));
			const gt = Math.max(0, Math.min(g.gt, h));
			const gb = Math.max(gt, Math.min(g.gb, h));
			// 需要的可见量不得超过可抓取区自身尺寸（矮元素否则会算出反向区间）
			const needX = Math.max(1, Math.min(PG_GRAB_MIN, gr - gl));
			const needY = Math.max(1, Math.min(PG_GRAB_MIN, gb - gt));
			// 水平：往左拖时保留可抓取区的右端，往右拖时保留左端
			const minX = needX - gr;
			const maxX = vw - needX - gl;
			// 垂直：让可抓取区（标题栏）始终完整可见 —— 卡片上边界因此可为负
			// （顶部内边距被切掉一点，但标题栏整条仍在视口内，随时可抓）。
			const minY = needY - gb;
			const maxY = vh - needY - gt;
			return { x: Math.min(Math.max(x, minX), Math.max(minX, maxX)), y: Math.min(Math.max(y, minY), Math.max(minY, maxY)) };
		}
		// 缩小方块要显示的图标与文字：cat 为 null 时改用工具名（此时「分类」本就不存在，
		// 工具名是唯一有意义的标识）。
		function pgCatIcon(cat) {
			return PG_CAT_ICON[cat] || PG_CAT_ICON.generic;
		}
		function pgCatText(cat, tool) {
			// 短名走 I18N（catS.*）与 T()，与弹窗其余部分同一语言来源；
			// T 对未知键返回键名本身，故用 catS.<cat> 是否存在来判定「这是已知分类」。
			if (!cat) return String(tool || '');
			const key = 'catS.' + cat;
			const label = T(key);
			return label === key ? String(tool || '') : label;
		}
		// 倒计时（仅在宿主下发了 deadline 时启用）。
		// 剩余秒数由**绝对截止时间戳**算出，不用递减计数器：后台标签被浏览器节流时
		// 定时器会延迟，但每次跑起来算出的都是正确值，因此不会累计漂移。
		// 超时的权威作者是宿主（Node 进程不受浏览器节流影响），这里只负责显示。
		function useCountdown(deadline, enabled) {
			const [left, setLeft] = React.useState(() => (deadline ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : null));
			React.useEffect(() => {
				if (!deadline || !enabled) { setLeft(null); return undefined; }
				const tick = () => setLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
				tick();
				const h = setInterval(tick, 500);
				return () => clearInterval(h);
			}, [deadline, enabled]);
			return left;
		}
		function PgApprovalCard(props) {
			const p = props.p;
			// null = 用 CSS 默认位置（右上角）；拖动后变成显式坐标
			const [pos, setPos] = React.useState(null);
			const [min, setMin] = React.useState(false);
			const [minPos, setMinPos] = React.useState(null);
			// 用户点「停止倒计时」后转为永不超时（等同普通 ask 的等待语义）。
			// 注意：只有在**宿主确认已清掉定时器**后才置 true（见按钮 onClick），
			// 否则会出现「界面说已停止、宿主照常自动结案」的分叉。
			const [stopped, setStopped] = React.useState(false);
			// 取消请求失败（宿主未确认）：保持倒计时条可见并给出提示，而不是假装已停止
			const [stopFailed, setStopFailed] = React.useState(false);
			const drag = React.useRef(null);
			// 「本次按下是否真的拖动过」：用于区分单击（还原方块）与拖动（只挪位置）。
			// 不能用 drag.current 判断 —— onUp 在 pointerup 时已把它置 null，
			// 而 click 是在 pointerup **之后**才派发的，届时 drag.current 恒为 null，
			// 结果「拖一下就自动展开」。
			const moved = React.useRef(false);
			// 卡片/方块根节点：resize 时要用它量实际尺寸重新夹取（位置是固定像素坐标，
			// 窗口一缩小，原本贴边的卡片就会整块跑到视口外，见下面的 effect）。
			const rootRef = React.useRef(null);
			const left = useCountdown(p.deadline, !stopped);
			// 卸载时释放槽位（空槽由下一个新方块复用）。语言切换要重算方块文字，
			// 故订阅 locale tick（与弹窗其余部分同一机制）。
			React.useEffect(() => () => { pgMinSlots.delete(p.id); }, [p.id]);
			useLocaleTick();
			const slot = min ? pgTakeMinSlot(p.id) : null;
			const base = min ? (minPos || (slot ? pgSlotXY(slot) : null)) : pos;
			// 视口变小后重新夹取：位置是拖出来的绝对像素坐标，窗口一缩小就可能整块
			// 落到视口外（实测 1200×800 拖到右下角、缩到 800×600 时可见区域为 0×0，
			// 卡片彻底拿不回来）。这里在 resize 时按新视口与元素实际尺寸再夹一次；
			// 未被拖动过（base 为 null，走 CSS 默认右上角）的卡片不参与，避免平白改变布局。
			React.useEffect(() => {
				if (typeof window === 'undefined' || !window.addEventListener) return undefined;
				const reclamp = () => {
					const el = rootRef.current;
					if (!el || !base) return;
					const rect = el.getBoundingClientRect();
					const next = pgClampXY(rect.left, rect.top, rect.width, rect.height, pgGrabBox(el));
					if (next.x === rect.left && next.y === rect.top) return;
					if (min) setMinPos(next); else setPos(next);
				};
				window.addEventListener('resize', reclamp);
				return () => { try { window.removeEventListener('resize', reclamp) } catch (e) {} };
			}, [min, base && base.x, base && base.y]);
			const onDown = (kind) => (e) => {
				// 只响应主键：鼠标左键 / 触摸 / 笔。右键与中键留给浏览器。
				if (e.button !== undefined && e.button !== 0) return;
				// 拖动柄只覆盖标题栏/方块本体：若指针落在交互控件（按钮/输入框/下拉/链接）
				// 上，直接放行，不启动拖动。否则根节点上的 setPointerCapture 会把后续
				// pointer 事件重定向到捕获元素，使 click 的最近公共祖先变成卡片本身 ——
				// 子按钮的 onClick 不在事件路径上，允许/拒绝等按钮将全部点不动。
				const t = e.target;
				if (t && typeof t.closest === 'function' && t.closest('button, input, select, textarea, a, [role="button"]')) return;
				const el = e.currentTarget;
				// 手柄是标题栏，但拖动的是整张卡片：位置基准必须取卡片本身的 rect。
				// 标题栏在卡片内边距（14px）之内，直接用它的 rect.top 会让卡片在
				// 起拖瞬间向下跳 14px，且夹取用的宽度会少算左右内边距。
				const box = kind === 'card' && typeof el.closest === 'function' ? (el.closest('.pg-modal') || el) : el;
				const rect = box.getBoundingClientRect();
				moved.current = false;
				drag.current = {
					kind: kind, pointerId: e.pointerId,
					startX: e.clientX, startY: e.clientY,
					origX: rect.left, origY: rect.top,
					w: rect.width, h: rect.height,
					// 可抓取区在起拖时量一次并随拖动沿用：夹取必须保证「能抓的那一段」
					// 留在视口内，否则拖到左侧只剩按钮区时卡片会卡死（见 pgClampXY 注释）。
					grab: pgGrabBox(box),
				};
				// 捕获指针：拖出元素范围后仍能收到 move/up（否则快速拖动会「掉线」）
				try { el.setPointerCapture(e.pointerId) } catch (err) {}
				// 取消 pointerdown 的默认动作以抑制拖拽选中；但输入类控件的聚焦依赖
				// mousedown 的默认动作，故对它们不 preventDefault（上面已提前 return，
				// 此处只处理非交互区域）。
				try { e.preventDefault() } catch (err) {}
			};
			const onMove = (e) => {
				const d = drag.current;
				if (!d || d.pointerId !== e.pointerId) return;
				const dx = e.clientX - d.startX;
				const dy = e.clientY - d.startY;
				// 超过阈值才算拖动（触屏轻点常有几像素抖动，否则会被误判成拖动而无法还原）
				if (!moved.current && Math.abs(dx) + Math.abs(dy) > 3) moved.current = true;
				const next = pgClampXY(d.origX + dx, d.origY + dy, d.w, d.h, d.grab);
				if (d.kind === 'min') setMinPos(next); else setPos(next);
			};
			const onUp = (e) => {
				const d = drag.current;
				if (!d || d.pointerId !== e.pointerId) return;
				drag.current = null;
				try { e.currentTarget.releasePointerCapture(e.pointerId) } catch (err) {}
			};
			const dragHandlers = (kind) => ({
				onPointerDown: onDown(kind),
				onPointerMove: onMove,
				onPointerUp: onUp,
				onPointerCancel: onUp,
			});
			if (min) {
				const label = pgCatText(p.cat, p.tool);
				const icon = pgCatIcon(p.cat);
				return React.createElement('div', Object.assign({
					ref: rootRef,
					className: 'pg-min',
					title: (label ? label + ' · ' : '') + String(p.tool || ''),
					style: base ? { left: base.x + 'px', top: base.y + 'px' } : undefined,
					// 拖动整块；单击（未移动）还原。用 click 而非 pointerup：拖动后
					// 浏览器仍会派发 click，故必须靠 moved 区分「拖动」与「单击」。
					onClick: () => { if (!moved.current) setMin(false) },
				}, dragHandlers('min')),
					React.createElement('span', { className: 'pg-min-icon', style: { WebkitMaskImage: icon, maskImage: icon } }),
					React.createElement('span', { className: 'pg-min-label' }, label),
				);
			}
			return React.createElement('div', {
				ref: rootRef,
				className: 'pg-modal',
				style: pos ? { left: pos.x + 'px', top: pos.y + 'px', right: 'auto' } : undefined,
			},
				// 标题栏 = 拖动柄（手柄限定在标题栏这个非交互区域）。
				// 拖动事件**只绑在这一条上**，不能绑卡片根节点：根节点捕获指针会让
				// 卡内所有按钮的 click 目标变成卡片本身（见 onDown 注释）。
				React.createElement('div', Object.assign({ className: 'pg-modal-head' }, dragHandlers('card')),
					React.createElement('span', { className: 'pg-modal-title' }, T('app.title')),
					// 复位位置：拖到只剩一条边（或拖动中被意外卡住）时的兜底出口。
					// 只在用户拖过（pos 非空）后**可见**，默认位置的卡片看不到这个按钮。
					//
					// 但它必须**始终占位**（未拖动时只是 visibility: hidden），不能条件渲染成 null：
					// pgGrabBox 以「标题栏里第一个 .pg-modal-min 的左边缘」为可抓取区右界，
					// 而本按钮在 DOM 里排在「—」之前。若首次拖动时它还不存在，量到的右界会
					// 偏右 32px（按钮 24 + 间距 8）；拖动一开始 pos 非空、它随即出现，
					// 真实可抓取区就只剩 8px —— 与「至少留 40px 可抓」的承诺不符（实测复现）。
					// 恒定占位让起拖时量到的基准在整个拖动过程中始终有效，顺带避免标题宽度跳变。
					React.createElement('button', {
						className: 'pg-modal-min', title: T('app.resetPos'),
						// visibility: hidden 仍保留布局盒（故可被量到），且不接收指针事件、不进无障碍树
						style: pos ? undefined : { visibility: 'hidden' },
						onPointerDown: (e) => { e.stopPropagation() },
						onClick: (e) => { e.stopPropagation(); if (pos) setPos(null) },
					}, '⌖'),
					React.createElement('button', {
						className: 'pg-modal-min', title: T('app.collapse'),
						onPointerDown: (e) => { e.stopPropagation() },
						onClick: (e) => { e.stopPropagation(); setMin(true) },
					}, '—'),
				),
				// 倒计时条：只在宿主下发了 deadline 且用户未点「停止倒计时」时出现。
				// 显示剩余秒数与超时后的落点（allow/deny），让人能判断「要不要现在处理」。
				(left !== null) ? React.createElement('div', { className: 'pg-count' },
					React.createElement('span', { className: 'pg-count-text' },
						T('app.timeoutIn').replace('{n}', String(left)).replace('{act}', p.onTimeout === 'allow' ? T('app.allow') : T('app.deny'))),
					React.createElement('button', {
						className: 'pg-count-stop', title: T('app.timeoutStopHint'),
						onPointerDown: (e) => { e.stopPropagation() },
						// 必须先拿到宿主回执再隐藏倒计时条：超时的权威作者是宿主，
						// 只改本地 state 拦不住到点自动结案（onTimeout === 'allow' 时即自动放行）。
						// 三种回执分别处理（不能只看「请求没抛错」——call 不校验 HTTP 状态，
						// 宿主返回 4xx/5xx 且 body 合法时 promise 依然 resolve）：
						//   cancelled:true  → 已清定时器，收起倒计时条
						//   cancelled:false → 审批已结案（卡片即将随 poll 消失），无需报错
						//   其它/失败       → 保持倒计时条可见并提示，避免「界面说已停止、宿主照常结案」
						onClick: (e) => {
							e.stopPropagation();
							call('permgate:cancel-timeout', { id: p.id }).then((r) => {
								if (r && r.ok === true) { if (r.cancelled === true) setStopped(true) }
								else setStopFailed(true);
							}).catch(() => { setStopFailed(true) });
						},
					}, T('app.timeoutStop')),
					stopFailed ? React.createElement('span', { className: 'pg-count-err' }, T('app.timeoutStopFailed')) : null,
				) : null,
				// note 展示位，两个来源共用：① 命中的 ask 例外备注（「当初为什么特意拦它」）；
				// ② auto 异常回落的附加说明。二者都经 entry.note 独立下发，**不拼进 reason** ——
				// reason 会被记入决策记录并随 perm_status 回给 AI，备注只该在这里给人看。
				p.note ? React.createElement('div', { className: 'pg-note' }, p.note) : null,
				// 模型原话（auto 专有）：escalate 与各类失败是弹窗的主要来源，模型在那条路径上
				// 说的「拿不准，因为 X」正是用户判断的依据，此前只有机械码（escalate:
				// model escalated），那句话被丢掉了。
				//
				// 单独一个块而不是拼进 note：这是**第三方文本**，必须与 permgate 自己的说明
				// 视觉可区分（.pg-model-reason 有左侧竖线 + 斜体）。模型可能在 reason 里写
				// 「用户已授权删除」这类臆断，同形渲染会让用户把它读成系统结论。
				//
				// 前缀「模型判断：」是必要的：单靠样式（灰色斜体）在缩小方块/深色主题下
				// 区分度不够，文字前缀是唯一在任何配色下都成立的标识。
				p.modelReason ? React.createElement('div', { className: 'pg-model-reason' }, T('app.modelReasonPrefix') + p.modelReason) : null,
				props.children,
			);
		}

		function ApprovalOverlay(props) {
			const [pending, setPending] = React.useState([]);
			const [busyId, setBusyId] = React.useState(null);
			const [sel, setSel] = React.useState({});
			const [openDetail, setOpenDetail] = React.useState({});
			const [openArgs, setOpenArgs] = React.useState({});
			const [denyText, setDenyText] = React.useState({});
			const [denyMode, setDenyMode] = React.useState({});
			// 进入拒绝态时被临时收起的「允许此项」勾选（按审批 id 存），点「取消」时原样恢复
			const [denySaved, setDenySaved] = React.useState({});
			const [, setTick] = React.useState(0);
			useLocaleTick();
			const poll = () => {
				call('permgate:pending', {}).then((r) => setPending(Array.isArray(r) ? r : [])).catch(() => {});
			};
			React.useEffect(() => {
				poll();
				const off = subscribeEvents((ev) => {
					if (ev.type === 'pending' || ev.type === 'refresh') poll();
				});
				return () => off();
			}, []);
			// 懒加载对比数据：详情默认展开的编辑/写入审批按需拉取（缓存按审批 id 复用）。
			// 注意：必须在 `if (!pending.length) return null` 提前返回之前声明（hooks 顺序约束）。
			React.useEffect(() => {
				// 缓存随待审批池淘汰：已结算/已消失的审批 id 立即清理，避免长期会话无界增长
				const aliveIds = new Set(pending.map((p) => p.id));
				for (const key of diffCache.keys()) if (!aliveIds.has(key)) diffCache.delete(key);
				for (const key of diffFetching) if (!aliveIds.has(key)) diffFetching.delete(key);
				for (const p of pending) {
					if (!p.hasDiff || diffCache.has(p.id) || diffFetching.has(p.id)) continue
					// 详情默认展开（含图片：读图时用户最想看的就是那张图），展开即预取
					const open = openDetail[p.id] === undefined ? true : openDetail[p.id] === true
					if (!open) continue
					diffFetching.add(p.id)
					schedulePrismIdle()
					call('permgate:file-diff', { id: p.id }).then((r) => {
						diffCache.set(p.id, (r && typeof r === 'object') ? r : { ok: false, error: '' })
						diffFetching.delete(p.id)
						setTick((v) => v + 1)
					}).catch(() => {
						diffCache.set(p.id, { ok: false, error: '' })
						diffFetching.delete(p.id)
						setTick((v) => v + 1)
					})
				}
			});
			const decide = (id, action, rules, reason) => {
				setBusyId(id);
				call('permgate:decide', { id, action, rules, reason: reason || undefined }).then(poll).catch(() => {}).then(() => setBusyId(null));
			};
			// 编码基准只由宿主按**工具自己透传**的 encoding 决定，客户端不提供切换入口
			// （预览换一页就会与工具实际写入的那一页脱钩），故这里没有任何切换回调。
			if (!pending.length) return null;
			const pick = (candId, v) => {
				const next = Object.assign({}, sel);
				if (next[candId] === v) delete next[candId];
				else next[candId] = v;
				setSel(next);
			};
			const pickedRules = (p) => (p.candidates || []).filter((c) => sel[c.id]).map((c) => ({ id: c.id, value: c.value, kind: c.kind, decision: sel[c.id] }));
			// 拒绝语义下只接受 deny 方向的规则：候选行残留的「允许此项」勾选绝不能变成持久 allow
			const pickedDenyRules = (p) => pickedRules(p).filter((r) => r.decision === 'deny');
			const submit = (p, action) => {
				decide(p.id, action, pickedRules(p));
			};
			// 两段式拒绝：确认阶段提交（携带意见）或取消返回
			const confirmDeny = (p) => {
				const reason = (denyText[p.id] || '').trim();
				setDenyMode(Object.assign({}, denyMode, { [p.id]: false }));
				const rest = Object.assign({}, denySaved);
				delete rest[p.id];
				setDenySaved(rest);
				decide(p.id, 'deny', pickedDenyRules(p), reason || undefined);
			};
			// 取消拒绝：把进入前收起的「允许此项」勾选原样放回去
			const cancelDeny = (p) => {
				const snap = denySaved[p.id];
				if (snap && Object.keys(snap).length) setSel(Object.assign({}, sel, snap));
				const rest = Object.assign({}, denySaved);
				delete rest[p.id];
				setDenySaved(rest);
				setDenyMode(Object.assign({}, denyMode, { [p.id]: false }));
			};
			// 进入拒绝态：立刻把「允许此项」的勾选收起来（视觉上就是取消了），并记下原选择供「取消」恢复。
			// 之前是「保留勾选 + 置灰变浅」，看起来仍像选中了允许，容易误读成「一边选允许一边提交拒绝」。
			const enterDeny = (p) => {
				const snap = {};
				for (const c of (p.candidates || [])) if (sel[c.id] === 'allow') snap[c.id] = 'allow';
				const next = Object.assign({}, sel);
				for (const id of Object.keys(snap)) delete next[id];
				setDenySaved(Object.assign({}, denySaved, { [p.id]: snap }));
				setSel(next);
				setDenyMode(Object.assign({}, denyMode, { [p.id]: true }));
			};
			const radio = (p, c, v, label, cls) => {
				// 拒绝态下「允许此项」已被收起，这里只做禁止再点（避免又勾回来和拒绝态自相矛盾）
				const blocked = v === 'allow' && !!denyMode[p.id];
				return React.createElement('button', {
					className: 'pg-radio' + (sel[c.id] === v ? ' ' + cls : ''),
					disabled: busyId === p.id || blocked,
					onClick: () => pick(c.id, v),
				}, label);
			};
			// 编辑/写入审批（有 diff）：详情默认展开、参数默认收起；无 diff 时参数照常显示
			// 有 diff 的审批（含图片）详情默认展开：读图时那张缩略图就是用户最想看的东西
			const detailOpen = (p) => (openDetail[p.id] === undefined ? !!p.hasDiff : openDetail[p.id]);
			const argsOpen = (p) => (openArgs[p.id] === undefined ? !p.hasDiff : openArgs[p.id]);
			const toggle = (map, setMap, p, v) => setMap(Object.assign({}, map, { [p.id]: v }));
			// 点文件名 → 打开 permgate 的对比抽屉（父组件 OverlayRoot 持有 pin 状态）；「展开」按钮仍走这里
			const openFile = (p, file) => {
				if (props && typeof props.onOpenFile === 'function') props.onOpenFile(p, file);
			};
			// 点路径/文件名 → 交给 DSH 右侧栏的 file tab（文本与图片同一地址，DSH 按 media type 选渲染器）。
			// 服务不可用（旧版 DSH 没有 sidebarRight）时返回 false，调用方保持原样不误导用户。
			// 会话身份优先用宿主注入的「当前 GUI 会话 id」（props.sessionId，OverlayRoot 从 useSessions 取），
			// 回退才是 entry 自带的 exec.session.id —— 后者不是 DSH 侧边栏认的身份，会导致 workspaceFileScope 解析失败
			const openSidebarFor = (p, file) => openInSidebar(file, (props && props.sessionId) || (p && p.sessionId), p && p.projRoot);
			// 爆炸半径警告条：把「这一下会删掉多大范围」显式写出来。
			//
			// 为什么要单独一条而不是并进 reason：reason 是判定链的产物（「为什么问这一次」），
			// 而爆炸半径与判定无关 —— 两个目标的动作可能完全相同，区别只在**范围**。
			// `rmdir /s /q B:\` 与 `rmdir /s /q <构建目录>` 的 reason 一模一样，
			// 审批人没有任何信息能把它们区分开，只能靠肉眼读命令串。
			//
			// 分级配色：盘根/系统目录用错误红（删了就没了），家目录/工作区外用警告橙。
			// 不用同一个颜色：全是红的等于没有分级，而这两档的后果确实差一个量级。
			//
			// BLAST_LEVELS 定义在**模块级**（不在这里）：设置面板的例外列表也要用同一份配色与文案
			// —— 定义在组件内的话面板取不到，只能各写一份，两边迟早漂移。
			const blastBanner = (b) => {
				if (!b || !b.level) return null;
				const meta = BLAST_LEVELS[b.level];
				if (!meta) return null;
				return React.createElement('div', {
					className: 'pg-blast',
					style: { borderColor: meta.color, color: meta.color },
					// 完整路径放 title：条内文字要保持一眼能读完，长路径会把它撑成两行
					title: b.path || '',
				},
					React.createElement('span', { className: 'pg-blast-icon' }, meta.icon),
					React.createElement('span', null, T(meta.key).replace('{p}', b.path || '')),
				);
			};
			const argsBox = (p) => React.createElement('div', { className: 'pg-args' },
				React.createElement('span', { className: 'pg-args-tag' }, T('app.args')),
				(p.argLines && p.argLines.length)
					? p.argLines.map((l, i) => React.createElement('div', { key: i, className: 'pg-args-row' },
						React.createElement('span', { className: 'pg-args-label' }, l.label + '：'),
						l.path ? React.createElement('span', { className: 'pg-path-link', title: l.path, onClick: () => openSidebarFor(p, l.path) }, l.value)
							: React.createElement('span', { className: 'pg-args-val' }, l.value),
						// 段级标注（破坏性命令 / 无法解析 / 重定向到工作区外）：宿主在 argLine 的
						// note 里下发。此前这个字段没有任何渲染方 —— 下发通道是断的，
						// 用户看不到「这一行为什么被单独标出来」。与 reason 里的分段摘要互补：
						// reason 是整条命令的概览，这里是**逐段**就地标注。
						l.note ? React.createElement('span', { className: 'pg-args-note' }, '（' + l.note + '）') : null,
					))
					: React.createElement('span', null, p.args),
			);
			return React.createElement('div', null,
				pending.map((p) => React.createElement(PgApprovalCard, { key: p.id, p: p },
					// 标题下的小字：这条审批来自哪个对话。多个会话同时开着时，弹窗样式一模一样，
					// 只有这里能区分「是哪个对话在要权限」。
					// 标题取不到就回落到会话 id 前 8 位；两者都没有（拿不到会话）时整行不渲染，
					// 而不是显示「来自对话：未知」——那只会占地方且误导。
					(() => {
						const label = p.sessionTitle || (p.sessionId ? String(p.sessionId).slice(0, 8) : '');
						if (!label) return null;
						return React.createElement('div', {
							className: 'pg-modal-sub',
							title: p.sessionId ? T('app.fromSession') + label + '  (' + p.sessionId + ')' : T('app.fromSession') + label,
						}, T('app.fromSession') + label);
					})(),
					React.createElement('div', { className: 'pg-modal-req' }, React.createElement('b', null, p.tool), ' ', T('app.request').replace('{tool}', '')),
					// 爆炸半径警告（只有破坏性命令的目标落在盘根/系统目录/家目录/工作区外时才有）。
					// 位置刻意排在**参数框之前**：审批人是自上而下读的，警告必须在看到命令原文之前
					// 就进入视野 —— 排在后面等于让人先读完命令、形成判断，再看到警告，那时已经晚了。
					//
					// 它回答的是判定链**没有**回答的那个问题：「这一下有多重」。
					// `rmdir /s /q B:\` 与 `rmdir /s /q <某构建目录>` 在判定链上完全一样
					// （都只是 ask），审批人只能靠肉眼从命令串里看出 B:\ 不对。
					blastBanner(p.blast),
					p.reason ? React.createElement('div', { className: 'pg-modal-body' }, p.reason) : null,
					p.intent ? React.createElement('div', { className: 'pg-intent' },
						React.createElement('span', { className: 'pg-intent-tag' }, p.intentLabel || T('app.intent')),
						React.createElement('span', null, p.intent),
					) : null,
					(p.args || (p.argLines && p.argLines.length)) ? (p.hasDiff
						? React.createElement('div', null,
							React.createElement('button', { className: 'pg-link', onClick: () => toggle(openArgs, setOpenArgs, p, !argsOpen(p)) },
								(argsOpen(p) ? '▾ ' : '▸ ') + T('app.args'),
							),
							argsOpen(p) ? argsBox(p) : null,
						)
						: argsBox(p)) : null,
					p.hasDiff ? React.createElement('div', null,
						React.createElement('button', { className: 'pg-link', onClick: () => toggle(openDetail, setOpenDetail, p, !detailOpen(p)) },
							(detailOpen(p) ? '▾ ' : '▸ ') + T('app.detail'),
						),
						detailOpen(p) ? (() => {
							const c = diffCache.get(p.id)
							if (!c) return React.createElement('div', { className: 'pg2-load' }, T('app.diffLoading'))
							if (!c.ok) return React.createElement('div', { className: 'pg2-err' }, (c.error || T('app.diffErr')))
							return React.createElement('div', null,
								detailBody(c, { onOpenFile: (f) => openFile(p, f), onOpenSidebar: (f) => openSidebarFor(p, f), changesOnly: true, resetKey: payloadKey(c) }),
							)
						})() : null,
					) : null,
					(p.candidates || []).length ? React.createElement('div', null,
						React.createElement('div', { className: 'pg-cand-head' }, T('app.cand.head')),
						React.createElement('div', { className: 'pg-cand-hint' }, T('app.cand.hint')),
						(p.candidates || []).map((c) => React.createElement('div', { key: c.id, className: 'pg-cand', style: { alignItems: 'flex-start' } },
							// 主行是路径本身，范围说明降级成下面的灰色小字（按钮与主行对齐）
							React.createElement('div', { style: { flex: 1, minWidth: 0 } },
								React.createElement('div', { className: 'pg-cand-label' }, c.label),
								c.hint ? React.createElement('div', { style: { fontSize: 11, color: 'rgba(128,128,128,0.85)', marginTop: 2, lineHeight: 1.4 } }, c.hint) : null,
							),
							radio(p, c, 'allow', T('app.allowOne'), 'pg-radio-allow'),
							radio(p, c, 'deny', T('app.denyOne'), 'pg-radio-deny'),
						)),
					) : null,
					// 两段式拒绝：平时只显示 拒绝/允许 两个按钮；点「拒绝」后展开
					// 意见输入框 + 「确认拒绝/取消」（Enter 确认、Esc 取消），
					// 输入框只在真要拒绝时出现，允许仍是一键。
					denyMode[p.id] ? React.createElement('div', null,
						React.createElement('div', { style: { margin: '8px 0 4px' } },
							React.createElement('div', { style: { fontSize: 12, fontWeight: 600, color: 'var(--dsw-alias-label-primary, #24292f)', marginBottom: 4 } }, T('app.denyReason')),
							React.createElement('input', { className: 'pg-field', autoFocus: true, style: { width: '100%', boxSizing: 'border-box' }, placeholder: T('app.denyReasonPh'), value: denyText[p.id] || '', onChange: (e) => setDenyText(Object.assign({}, denyText, { [p.id]: e.target.value })), onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); confirmDeny(p); } else if (e.key === 'Escape') { e.preventDefault(); cancelDeny(p); } } }),
						),
						React.createElement('div', { className: 'pg-footer' },
							React.createElement('button', { className: 'pg-action pg-action-deny', disabled: busyId === p.id, onClick: () => confirmDeny(p) }, T('app.confirmDeny')),
							React.createElement('button', { className: 'pg-action', disabled: busyId === p.id, onClick: () => cancelDeny(p) }, T('panel.cancel')),
						),
					) : React.createElement('div', { className: 'pg-footer' },
						React.createElement('button', { className: 'pg-action pg-action-deny', disabled: busyId === p.id, onClick: () => enterDeny(p) }, T('app.deny')),
						React.createElement('button', { className: 'pg-action pg-action-allow', disabled: busyId === p.id, onClick: () => submit(p, 'allow') }, T('app.allow')),
					),
				)),
			);
		}

		// ── 文件对比（dsh-file-review 风格 unified diff + 右侧抽屉）─────────
		// 弹窗内联「详情」与右侧抽屉共用 DiffBlock/ReadBlock；数据来自
		// /permgate/file-diff（按审批 id 取，diffCache 缓存复用）。
		function diffOpsText(file, ops) {
			const out = [file];
			for (const op of ops || []) {
				if (op.t === 'g') {
					if (op.lines) { for (const l of op.lines) out.push(' ' + l.s) }
					else out.push('…');
				} else if (op.t === 'a') out.push('+ ' + op.s);
				else if (op.t === 'd') out.push('- ' + op.s);
				else out.push(' ' + op.s);
			}
			return out.join('\n');
		}
		// 编码标注徽标（ReadBlock 与 DiffBlock 共用）：文件不是 UTF-8、内容由宿主经
		// dsh-fs-encoding 解出时显示。decided='guessed' 必须显式区分——那是概率性选择，
		// 用户会照着这段内容判断是否放行编辑，不能让他以为这就是文件的真实编码。
		// 写在单点：两条渲染路径各自复制一份必漏改（对比面板曾整块缺失该标注）。
		//
		// **纯展示，没有任何交互**：不列候选、不下拉、不可点。编码基准由工具自己透传
		// （read 的 encoding 参数），客户端不提供第二种选择——预览换一页编码就会与工具
		// 实际写入的那一页脱钩，而审批者正是照这段预览判断是否放行。故这里只把
		// 「按哪个编码解的、是怎么定的」如实标出来。
		function encBadge(data) {
			if (!data.encoding || !data.decided || data.decided === 'utf8') return null;
			const label = data.encoding + (data.decided === 'guessed' ? ' ?' : '');
			const hint = data.decided === 'guessed' ? T('app.encGuessedHint') : T('app.encHint');
			return React.createElement('span', { className: 'pg2-enc', title: hint }, label);
		}
		function DiffBlock({ data, onOpenFile, onOpenSidebar, onCollapse, changesOnly }) {
			const [copied, setCopied] = React.useState(false);
			const [gaps, setGaps] = React.useState({});
			useLocaleTick();
			// 语法高亮：从 ops 重建 old/new 文本后分块 tokenize，按真实文件行号 Map 取
			// 对应行的 HTML（edit 窗口化 diff 的 ops 行号是真实文件行号，窗口 base 可能 >1；
			// changesOnly 过滤后文本非连续，不能再用「行号-首行」偏移索引）。
			// 重建结果按 data 对象引用 + 视图模式缓存（diffHlCache：抽屉/弹窗共用同一
			// payload，但重建内容不同——changesOnly 只含改动行，full 含全部 gap/ctx 行）。
			const hlMode = changesOnly ? 'co' : 'full';
			const [hl, setHl] = React.useState(() => {
				const c = data ? diffHlCache.get(data) : null;
				return (c && c[hlMode]) || null;
			});
			React.useEffect(() => {
				ensurePrism();
				const lang = prismLangFor(data.file);
				if (data.fallback || !lang) { setHl(null); return undefined }
				const cached = data ? diffHlCache.get(data) : null;
				if (cached && cached[hlMode]) { setHl(cached[hlMode]); return undefined }
				// changesOnly（弹窗内联）只渲染改动行：重建文本仅含 a/d 行，不把 gap 携带的
				// 隐藏行（最多 10 万行）拼进文本，避免对永不展示的内容做拼接与分块 tokenize。
				const ops = changesOnly
					? (data.ops || []).filter((op) => op.t === 'a' || op.t === 'd')
					: (data.ops || []);
				const texts = prismTextsFromOps(ops);
				if (!texts) { setHl(null); return undefined }
				const hl = {
					old: { text: texts.oldText, html: null },
					new: { text: texts.newText, html: null },
					// 行号 → 重建文本行序号的索引（行号来自 ops，为真实文件行号）
					oldByNum: new Map(texts.oldNums.map((n, i) => [n, i])),
					newByNum: new Map(texts.newNums.map((n, i) => [n, i])),
				};
				if (data) {
					const entry = diffHlCache.get(data) || {};
					entry[hlMode] = hl;
					diffHlCache.set(data, entry);
				}
				setHl(hl);
			}, [data, hlMode]);
			// 双侧分块渐进高亮（idle 调度）：首渲染纯文本、分块完成后补高亮。
			const oldHtml = useProgressiveHighlight(hl ? hl.old.text : null, data.file, hl ? hl.old : null);
			const newHtml = useProgressiveHighlight(hl ? hl.new.text : null, data.file, hl ? hl.new : null);
			// changesOnly 与抽屉统一走渐进高亮：首渲染纯文本、idle 分块完成后补高亮，
			// 避免弹窗打开时同步逐行 tokenize 阻塞主线程（maps 就绪前行数按纯文本渲染）。
			const rowText = (num, side, plain) => {
				const byNum = hl ? (side === 'old' ? hl.oldByNum : hl.newByNum) : null;
				const htmlArr = side === 'old' ? oldHtml : newHtml;
				const idx = (byNum && num !== null && num !== undefined) ? byNum.get(num) : undefined;
				const html = htmlArr && idx !== undefined ? htmlArr[idx] : undefined;
				if (html === undefined) return React.createElement('span', { className: 'pg2-text' }, plain);
				return React.createElement('span', { className: 'pg2-text', dangerouslySetInnerHTML: { __html: html } });
			};
			const onCopy = () => {
				if (copied) return;
				const text = data.fallback ? (data.lines || []).join('\n') : diffOpsText(data.file, data.ops || []);
				if (typeof navigator !== 'undefined' && navigator.clipboard) {
					navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1000) }).catch(() => {});
				}
			};
			const kindLabel = data.kind === 'new' ? T('app.diffNew') : T('app.diffMod');
			const badge = data.kind === 'new' ? '+' : 'M';
			const copyBtn = React.createElement('button', { className: 'pg2-copy', onClick: onCopy }, copied ? T('app.diffCopied') : T('app.diffCopy'));
			// 「展开」按钮：仅弹窗内联上下文显示（onOpenFile 存在时），点击打开右侧栏面板
			const expandBtn = (typeof onOpenFile === 'function')
				? React.createElement('button', { className: 'pg2-expand', onClick: () => onOpenFile(data.file), title: T('app.diffExpand') }, T('app.diffExpand'))
				: null;
			// 「收缩」按钮：仅在侧边栏面板内显示（onCollapse 存在时），放在复制按钮旁边，点击回到权限弹窗
			const collapseBtn = (typeof onCollapse === 'function')
				? React.createElement('button', { className: 'pg2-expand', onClick: onCollapse, title: T('app.diffCollapse') }, T('app.diffCollapse'))
				: null;
			// 行尾归一化提示条：fallback 降级视图同样渲染（该视图下实际 edit 的原始字节
			// 字面匹配同样可能因 CRLF/CR 失败，提示不应随降级丢失）
			const eolNote = data.eolNormalized ? React.createElement('div', { className: 'pg2-eolnote', style: { padding: '4px 8px', fontSize: 11, color: 'var(--dsw-alias-state-warning-primary, #9a6700)' } }, T('app.eolNote')) : null;
			// 撤销预览在「预览解码与工具编码不同源」时跳过 stale 判定：必须显式说明，
			// 否则审批者会把「没报无变化」读成「撤销一定会执行」（那正是要防的误判放行）
			const undoVerdictNote = data.undoVerdictSkipped ? React.createElement('div', { className: 'pg2-verdictnote', style: { padding: '4px 8px', fontSize: 11, color: 'var(--dsw-alias-state-warning-primary, #9a6700)' } }, T('app.undoVerdictSkipped')) : null;
			if (data.fallback) {
				return React.createElement('div', { className: 'pg2-block' },
					React.createElement('div', { className: 'pg2-header' },
						React.createElement('span', { className: 'pg2-status', title: kindLabel }, badge),
						React.createElement('span', { className: 'pg2-path', title: data.file, onClick: () => onOpenSidebar && onOpenSidebar(data.file) }, data.file),
						React.createElement('span', { className: 'pg2-added' }, '+' + data.added),
						React.createElement('span', { className: 'pg2-removed' }, '-' + data.removed),
						encBadge(data),
						copyBtn,
						expandBtn,
						collapseBtn,
					),
					eolNote,
					undoVerdictNote,
					React.createElement('div', { className: 'pg2-body' },
						(data.lines || []).map((l, i) => React.createElement('div', { key: i, className: l[0] === '+' ? 'pg2-fadd' : l[0] === '-' ? 'pg2-fdel' : 'pg2-fctx' }, l)),
					),
					data.truncated > 0 ? React.createElement('div', { className: 'pg2-foot' }, '… ' + T('app.diffMore').replace('{n}', String(data.truncated))) : null,
				);
			}
			const rows = [];
			let gi = 0;
			let ri = 0;
			for (const op of data.ops || []) {
				// 权限弹窗内联视图（changesOnly）：只显示修改行，不渲染上下文/gap
				if (changesOnly && op.t !== 'a' && op.t !== 'd') continue
				if (op.t === 'g') {
					const id = 'g' + (gi++);
					const expanded = !!gaps[id];
					if (op.lines) {
						rows.push(React.createElement('button', { key: 'r' + (ri++), className: 'pg2-gap', onClick: () => setGaps(Object.assign({}, gaps, { [id]: !expanded })) },
							(expanded ? '▾ ' : '↕ ') + (expanded ? T('app.diffGapHide') : T('app.diffGapShow')).replace('{n}', String(op.c)),
						));
						if (expanded) {
							for (const l of op.lines) {
								rows.push(React.createElement('div', { key: 'r' + (ri++), className: 'pg2-row pg2-ctx' },
									React.createElement('span', { className: 'pg2-old' }, String(l.o)),
									React.createElement('span', { className: 'pg2-new' }, String(l.n)),
									React.createElement('span', { className: 'pg2-sign' }, ' '),
									rowText(l.o, 'old', l.s),
								));
							}
						}
					} else {
						rows.push(React.createElement('div', { key: 'r' + (ri++), className: 'pg2-gap-more' }, T('app.diffGapMore').replace('{n}', String(op.c))));
					}
				} else {
					const cls = op.t === 'a' ? 'pg2-add' : op.t === 'd' ? 'pg2-del' : 'pg2-ctx';
					const sign = op.t === 'a' ? '+' : op.t === 'd' ? '-' : ' ';
					rows.push(React.createElement('div', { key: 'r' + (ri++), className: 'pg2-row ' + cls },
						React.createElement('span', { className: 'pg2-old' }, op.o === null ? '' : String(op.o)),
						React.createElement('span', { className: 'pg2-new' }, op.n === null ? '' : String(op.n)),
						React.createElement('span', { className: 'pg2-sign' }, sign),
						rowText(op.t === 'a' ? op.n : op.o, op.t === 'a' ? 'new' : 'old', op.s),
					));
				}
			}
			return React.createElement('div', { className: 'pg2-block' },
				React.createElement('div', { className: 'pg2-header' },
					React.createElement('span', { className: 'pg2-status', title: kindLabel }, badge),
					React.createElement('span', { className: 'pg2-path', title: data.file, onClick: () => onOpenSidebar && onOpenSidebar(data.file) }, data.file),
					React.createElement('span', { className: 'pg2-added' }, '+' + data.added),
					React.createElement('span', { className: 'pg2-removed' }, '-' + data.removed),
					encBadge(data),
					copyBtn,
					expandBtn,
					collapseBtn,
				),
				eolNote,
				undoVerdictNote,
				React.createElement('div', { className: 'pg2-body' }, rows),
			);
		}
		function ReadBlock({ data, onOpenFile, onOpenSidebar, onCollapse }) {
			const [copied, setCopied] = React.useState(false);
			useLocaleTick();
			const text = data.text || '';
			// 窗口化读取：行号从 startLine 起算，上下省略时显示灰色提示行
			const startLine = data.startLine || 1;
			const topOmitted = data.topOmitted === true;
			const bottomOmitted = data.bottomOmitted === true;
			const body = text.endsWith('\n') ? text.slice(0, -1) : text;
			const lines = body === '' ? [] : body.split('\n');
			const onCopy = () => {
				if (copied) return;
				if (typeof navigator !== 'undefined' && navigator.clipboard) {
					navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1000) }).catch(() => {});
				}
			};
			const rows = [];
			let ri = 0;
			// 语法高亮：分块 tokenize 后按行取 HTML（超大文本降级纯文本，防主线程卡顿）。
			// 高亮结果按 data 引用缓存（readHlCache）：抽屉重开/详情重展开（重挂载）
			// 直接复用已完成的行 HTML，不重复分块 tokenize。
			const [readHl] = React.useState(() => {
				if (!data) return null;
				let c = readHlCache.get(data);
				if (!c) { c = { text: null, html: null }; readHlCache.set(data, c) }
				return c;
			});
			// 分块渐进高亮（idle 调度，Prism 惰性初始化）：首渲染纯文本、分块完成后补高亮。
			const lineHtml = useProgressiveHighlight(text, data.file, readHl);
			if (topOmitted) {
				rows.push(React.createElement('div', { key: 'r' + (ri++), className: 'pg2-romit' }, T('app.diffTopMore').replace('{n}', String(startLine - 1))));
			}
			for (let i = 0; i < lines.length; i++) {
				rows.push(React.createElement('div', { key: 'r' + (ri++), className: 'pg2-rrow' },
					React.createElement('span', { className: 'pg2-rnum' }, String(startLine + i)),
					lineHtml && lineHtml[i] !== undefined
						? React.createElement('span', { className: 'pg2-text', dangerouslySetInnerHTML: { __html: lineHtml[i] } })
						: React.createElement('span', { className: 'pg2-text' }, lines[i]),
				));
			}
			if (bottomOmitted) {
				rows.push(React.createElement('div', { key: 'r' + (ri++), className: 'pg2-romit' }, T('app.diffBottomMore')));
			}
			return React.createElement('div', { className: 'pg2-block' },
				React.createElement('div', { className: 'pg2-header' },
					React.createElement('span', { className: 'pg2-status-read', title: T('app.diffRead') }, 'R'),
					React.createElement('span', { className: 'pg2-path', title: data.file, onClick: () => onOpenSidebar && onOpenSidebar(data.file) }, data.file),
					React.createElement('span', { className: 'pg2-added' }, T('app.diffLines').replace('{n}', String(lines.length) + (topOmitted || bottomOmitted ? '+' : ''))),
					encBadge(data),
					React.createElement('button', { className: 'pg2-copy', onClick: onCopy }, copied ? T('app.diffCopied') : T('app.diffCopy')),
					(typeof onOpenFile === 'function')
						? React.createElement('button', { className: 'pg2-expand', onClick: () => onOpenFile(data.file), title: T('app.diffExpand') }, T('app.diffExpand'))
						: null,
					(typeof onCollapse === 'function')
						? React.createElement('button', { className: 'pg2-expand', onClick: onCollapse, title: T('app.diffCollapse') }, T('app.diffCollapse'))
						: null,
				),
				React.createElement('div', { className: 'pg2-body' }, rows),
			);
		}
		// 记忆化：ApprovalOverlay 的状态变化（如拒绝理由输入框每次按键）不应重渲染 diff 区域。
		// 回调 props 每次渲染都是新引用，比较时忽略，仅按数据与模式比较（diffCache 对象引用稳定）。
		const diffPropsEqual = (a, b) => a.data === b.data && a.changesOnly === b.changesOnly;
		const DiffBlockMemo = React.memo(DiffBlock, diffPropsEqual);
		const ReadBlockMemo = React.memo(ReadBlock, diffPropsEqual);

		// kind → 详情组件 分派单点：待审批内联详情与右侧对比抽屉共用，新增 kind（如 image）只改这一处，
		// 避免两处漏改导致某处把数据落到 DiffBlock，被错误边界兜成「无法生成对比」。
		function detailBody(data, opts) {
			const o = opts || {};
			const fb = T('app.diffErr');
			const boundaryProps = o.resetKey !== undefined ? { resetKey: o.resetKey, fallback: fb } : { fallback: fb };
			// onOpenFile → permgate 的对比抽屉（「展开」用）；onOpenSidebar → DSH 右侧栏的 file tab（点路径/文件名用）
			if (data.kind === 'image') return React.createElement(PGErrorBoundary, boundaryProps, React.createElement(ImageBlock, { data, onOpenSidebar: o.onOpenSidebar || null }));
			if (data.kind === 'read') return React.createElement(PGErrorBoundary, boundaryProps, React.createElement(ReadBlockMemo, { data, onOpenFile: o.onOpenFile || null, onOpenSidebar: o.onOpenSidebar || null, onCollapse: o.onCollapse }));
			return React.createElement(PGErrorBoundary, boundaryProps, React.createElement(DiffBlockMemo, { data, onOpenFile: o.onOpenFile || null, onOpenSidebar: o.onOpenSidebar || null, onCollapse: o.onCollapse, changesOnly: o.changesOnly }));
		}

		// 图片详情块：头部显示 格式 · 像素尺寸 · 体积，下面给缩略图；
		// 超过上限或读取失败时不给图片本体，改显示说明文本（宿主下发的 error 由外层按 .pg2-err 渲染）。
		function ImageBlock({ data, onOpenSidebar }) {
			const fmtBytes = (n) => {
				const v = Number(n) || 0;
				if (v < 1024) return v + ' B';
				if (v < 1024 * 1024) return (v / 1024).toFixed(1) + ' KB';
				return (v / (1024 * 1024)).toFixed(2) + ' MB';
			};
			const meta = [
				String(data.format || '').toUpperCase(),
				data.width && data.height ? data.width + '×' + data.height : '',
				data.size ? fmtBytes(data.size) : '',
			].filter(Boolean).join(' · ');
			const note = data.sizeUnknown
				? T('app.imageSizeUnknown')
				: data.tooLarge
					? T('app.imageTooLarge') + (data.limit ? '（' + fmtBytes(data.limit) + '）' : '')
					: T('app.imageNoPreview');
			return React.createElement('div', { className: 'pg2-block' },
				React.createElement('div', { className: 'pg2-header' },
					React.createElement('span', { className: 'pg2-status pg2-status-read' }, T('app.imageTag')),
					// 图片标题也可点：同一个 file 地址交给 DSH 右侧栏，由它按 media type 渲染图片
					React.createElement('span', { className: 'pg2-path', title: data.file, onClick: () => onOpenSidebar && onOpenSidebar(data.file) }, data.file),
					meta ? React.createElement('span', { style: { marginLeft: 'auto', color: 'rgba(128,128,128,0.9)' } }, meta) : null,
				),
				data.dataUrl
					? React.createElement('div', { style: { padding: 10, display: 'flex', justifyContent: 'center', alignItems: 'center', overflow: 'auto', background: 'rgba(128,128,128,0.06)' } },
						React.createElement('img', { src: data.dataUrl, alt: data.file, style: { maxWidth: '100%', maxHeight: 320, objectFit: 'contain', borderRadius: 4, display: 'block' } }))
					: React.createElement('div', { className: 'pg2-foot' }, note),
			);
		}
		function CompareDrawer({ pin, onClose }) {
			const [data, setData] = React.useState(null);
			const [err, setErr] = React.useState('');
			const [editMsg, setEditMsg] = React.useState(null);
			const [width, setWidth] = React.useState(null);
			useLocaleTick();
			React.useEffect(() => {
				setData(null);
				setErr('');
				// 与弹窗内联详情共用 diffCache：命中直接渲染（含失败态），未命中才请求并回写
				const cached = diffCache.get(pin.id);
				if (cached) {
					if (cached.ok) setData(cached);
					else setErr((cached.error) ? cached.error : T('app.diffErr'));
					return;
				}
				let alive = true;
				schedulePrismIdle()
				call('permgate:file-diff', { id: pin.id }).then((r) => {
					if (!alive) return;
					const norm = (r && typeof r === 'object') ? r : { ok: false, error: '' };
					diffCache.set(pin.id, norm);
					if (norm.ok) setData(norm);
					else setErr((norm.error) ? norm.error : T('app.diffErr'));
				}).catch(() => { if (alive) setErr(T('app.diffErr')) });
				return () => { alive = false };
			}, [pin.id]);
			// 抽屉与弹窗内联详情共用同一份 payload 与同一条编码基准（由宿主按工具透传的
			// encoding 决定），故这里同样没有切换入口。
			// 左边缘拖动调整侧边栏宽度（面板固定在右侧，向左拖变宽）
			const onResizeStart = (e) => {
				if (e && e.preventDefault) e.preventDefault();
				const startX = e.clientX;
				const el = e.currentTarget ? e.currentTarget.parentElement : null;
				const startW = el ? el.getBoundingClientRect().width : (width || 600);
				let active = true;
				const onMove = (ev) => {
					if (!active) return;
					const maxW = (typeof window !== 'undefined' ? window.innerWidth : 1200) - 80;
					setWidth(Math.round(Math.min(Math.max(startW + (startX - ev.clientX), 480), maxW)));
				};
				const onUp = () => {
					active = false;
					if (typeof document !== 'undefined') {
						document.removeEventListener('mousemove', onMove);
						document.removeEventListener('mouseup', onUp);
						document.body.style.cursor = '';
					}
				};
				if (typeof document !== 'undefined') {
					document.body.style.cursor = 'col-resize';
					document.addEventListener('mousemove', onMove);
					document.addEventListener('mouseup', onUp);
				}
			};
			// 「打开文件」→ DSH 右侧栏的 file tab（不再唤起系统关联程序；图片同一入口）
			const onEdit = () => {
				setEditMsg(null);
				if (openInSidebar(pin.file, pin.sid, pin.projRoot)) return;
				setEditMsg({ ok: false, text: T('app.openFileFailed') });
				setTimeout(() => setEditMsg(null), 2500);
			};
			let body;
			if (data) {
				// 抽屉里也要能点文件名/图片标题去开侧栏（pin 里带着会话 id 与项目根）
				body = detailBody(data, { onCollapse: onClose, onOpenSidebar: (f) => openInSidebar(f, pin.sid, pin.projRoot) })
			} else if (err) {
				body = React.createElement('div', { className: 'pg2-err' }, err);
			} else {
				body = React.createElement('div', { className: 'pg2-load' }, T('app.diffLoading'));
			}
			return React.createElement('div', { className: 'pg2-drawer', style: width ? { width: width + 'px' } : undefined },
				React.createElement('div', { className: 'pg2-drawer-resize', onMouseDown: onResizeStart, title: T('app.diffResize') }),
				React.createElement('div', { className: 'pg2-drawer-head' },
					React.createElement('span', { className: 'pg2-drawer-file', title: pin.file }, pin.file),
					editMsg ? React.createElement('span', { className: 'pg2-edit-msg' + (editMsg.ok ? '' : ' err') }, editMsg.text) : null,
					React.createElement('button', { className: 'pg2-drawer-open', onClick: onEdit, title: T('app.openFile') }, T('app.openFile')),
					React.createElement('button', { className: 'pg2-drawer-close', onClick: onClose, title: T('app.diffClose') }, '✕'),
				),
				React.createElement('div', { className: 'pg2-drawer-body' }, body),
			);
		}
		// shell.overlay 入口：审批弹窗 + 右侧对比抽屉共享 pin 状态
		// 错误边界：任一子组件 render 崩溃只降级该区域，不影响审批弹窗/抽屉存活
		// 按 payload 对象引用生成稳定 resetKey（WeakMap：对象被回收后条目随之消失）
		const payloadKeys = new WeakMap();
		let payloadKeySeq = 0;
		function payloadKey(o) {
			let k = payloadKeys.get(o);
			if (k === undefined) { k = 'd' + (++payloadKeySeq); payloadKeys.set(o, k) }
			return k;
		}
		class PGErrorBoundary extends React.Component {
			constructor(props) {
				super(props);
				this.state = { err: null };
			}
			static getDerivedStateFromError(err) {
				return { err };
			}
			componentDidCatch(err) {
				console.error('[permgate] ui error:', err);
			}
			componentDidUpdate(prevProps) {
				// resetKey 变化（新 pin/新 payload 数据）时解除错误锁死：
				// 一次渲染崩溃不应让该子树对后续有效数据永久显示兜底错误。
				if (this.state.err && this.props.resetKey !== prevProps.resetKey) {
					this.setState({ err: null });
				}
			}
			render() {
				if (this.state.err) {
					// 只显示通用 fallback，不把原始异常消息（可能含内部路径/文件片段）渲染进界面；
					// 完整错误已由 componentDidCatch 写入 console。
					return React.createElement('div', { className: 'pg2-err' }, this.props.fallback || T('app.diffErr'));
				}
				return this.props.children;
			}
		}
		function OverlayRoot(props) {
			const [pin, setPin] = React.useState(null);
			// shell.overlay 是 root 作用域槽：不直接给 sessionId，但注入 useSessions（与 settings.section 同款）。
			// 打开 DSH 右侧栏必须用「当前 GUI 会话」身份 —— 宿主下发的 exec.session.id 不是它，
			// 用它会让 DSH 的 workspaceFileScope 解析不到工作区（readAll 报 did not resolve identity）。
			// 取会话 id 走 pgCurrentSessionId（兼容 0.1.5 的 current 与 0.1.7 的 retainedBy.mainView）。
			const sessionId = (props && typeof props.useSessions === 'function')
				? props.useSessions(pgCurrentSessionId)
				: undefined;
			// 审查态缓存的唯一写入路径。挂 shell.overlay（root 作用域、始终挂载），
			// 按平台 hero 判定的两种成因分开处理（平台 client.js:14868）：
			//   ① sessionId 为空（刚启动、确实没有会话）→ 无会话可查，用宿主下发的
			//      defaultView（由「新会话默认预设」推出）填新会话槽位；
			//   ② sessionId 有值但界面 blank（点侧边栏「新对话」）→ 会话真实存在，它的
			//      权限态才是权威值，必须按该会话查询并登记会话态。绝不能拿「全局新会话
			//      默认」冒充它的真实值：两者在「恢复的空白会话」「在 hero 里改过预设」
			//      等情形下会分叉。
			// 本组件始终挂载，故其覆盖范围是完备的：早先挂在 conversation.composer.dock
			// 的 DockBar 也写过同一份缓存，但那个槽位仅在 composer 界面渲染（hero 下
			// 拿不到值），已随徽标一并删除。
			// 但它是否**真的**能写到会话态，取决于 sessionId 能否取到：DockBar 当年是靠
			// 平台给 session 作用域槽注入的 props.sessionId，而本组件挂在 root 作用域、
			// 只能经 pgCurrentSessionId 自取。故该函数的版本兼容（0.1.5 的 current /
			// 0.1.7 的 retainedBy.mainView）是本缓存能否工作的前提，不是可选优化。
			React.useEffect(() => {
				let cancelled = false;
				if (sessionId) {
					// 成因②：本 effect 是会话态的唯一写入路径，先登记本会话。纪律是
					// 「先登记再查询」：登记即把判据清为「平台态未知」，响应到达前
					// pgScanCustom 保守不动，不会把上一个会话的判据套到本会话的触发器上。
					pgBeginReviewSession(sessionId);
				} else {
					// 成因①：确实没有会话。清掉可能残留的会话登记（否则 pgView 会继续用
					// 上一个会话的缓存），再写新会话默认视图。
					pgEndReviewSession(pgReviewSid);
				}
				const apply = (s, seq) => {
					if (cancelled) return;
					if (sessionId) {
						// 写入前确保已登记（幂等：同会话时保留已有缓存）。本 effect 依赖
						// sessionId，同一会话内的 SSE 刷新不会重跑 effect，故这里不能假定
						// 登记一定还在；不补登记的话，后续刷新会被 pgSetReviewState 的
						// 归属校验挡掉（pgReviewSid 为 null），界面就再也收敛不回来。
						pgBeginReviewSession(sessionId);
						pgSetReviewState(sessionId, s, seq);
					} else pgSetDefaultView(s);
				};
				// 带 sessionId 查询：宿主据它按会话解析项目根（index.js 的 ensureTarget），
				// 不带会让宿主回退到 agentRef/末位会话并就地改写全局 root，使 defaultView
				// 的沙箱取自别的项目。
				// 序号在「发起查询时」领取，是全局乱序保护（pgReviewSeq 与
				// pgSetReviewState 共用）：晚发起的查询号更大，乱序返回的旧响应才会被
				// 丢弃。若等响应到达才领号（pgSetReviewState 的 seq 缺省分支），
				// 后发起的查询可能领到较小的号，把自己更新的响应误判为过期而丢弃 ——
				// 与「只接受最新一次」的意图正好相反。
				const refresh = () => {
					const seq = ++pgReviewSeq;
					call('permgate:status', sessionId ? { sessionId } : {})
						.then((s) => apply(s, seq))
						.catch(() => apply(null, seq));
				};
				refresh();
				const off = subscribeEvents((ev) => {
					if (ev.type === 'status' || ev.type === 'refresh') refresh();
				});
				return () => { cancelled = true; off(); };
				// sessionId 变化必须重查：成因②的会话就是「当前会话」，切换/新建会话后
				// 沿用上一个会话的判据会让选择器张冠李戴。
			}, [sessionId]);
			// 每次渲染同步「当前显示的会话」（渲染期赋值，不受 effect 依赖数组限制）：
			// 界面在 composer/hero 之间切换（如点「新对话」）时 sessionId 可能不变，
			// 而会话态缓存的收敛有窗口期；pgView() 靠本标记区分「确实无会话」与
			// 「有会话但状态还没到」，从而不会把全局新会话默认冒充成该会话的真实权限态。
			pgSetCurrentSession(sessionId);
			const sidOf = (p) => sessionId || (p && p.sessionId) || null;
			return React.createElement('div', null,
				React.createElement(PGErrorBoundary, { fallback: T('app.uiErr') },
					// pin 里带齐打开侧栏所需的三样：文件路径、会话 id、项目根（构造 file 地址要用后两者）
					React.createElement(ApprovalOverlay, { sessionId, onOpenFile: (p, file) => setPin({ id: p.id, file, sid: sidOf(p), projRoot: p.projRoot || null }) }),
				),
				pin ? React.createElement(PGErrorBoundary, { resetKey: pin.id, fallback: T('app.uiErr') },
					React.createElement(CompareDrawer, { pin, onClose: () => setPin(null) }),
				) : null,
			);
		}

		// DockBar（作曲区下方的「● 权限网关 …」分类徽标）已整体删除。
		// 删除理由：DSH 0.1.7 把 conversation.composer.dock 槽位与原生 ContextMeter
		// （上下文占用圆环）一起放进了同一个横向 flex 行（InputBar 的 .dock），徽标因此
		// 与圆环并排显示，不再是独占一行；而该槽位同时还有原生 stats 占用，无论怎么调整
		// 都躲不开并排。徽标本身只是只读展示，删掉不损失功能。
		//
		// 关键：DockBar 曾经是「审查态缓存」的写入方之一，但**不是唯一**写入方 ——
		// OverlayRoot（挂在 shell.overlay，root 作用域、始终挂载）用同一个
		// permgate:status 接口、同一套 seq 乱序保护写了同样的两个标量，且覆盖范围是
		// DockBar 的超集（DockBar 只在 variant === "composer" && sessionId !== undefined
		// 时挂载，OverlayRoot 还额外覆盖 hero 界面与「确实无会话」的 defaultView 分支）。
		// 故删除后 pgScanCustom 拿到的数据不降级。

		// ════════════════════════════════════════════════════════════════════════════
		// ModelEffortPicker —— 复刻官方 `ui-model-selection` 的 ModelSelect
		// ════════════════════════════════════════════════════════════════════════════
		//
		// 官方：一个 trigger + **portal 到 document.body 的浮层菜单**；根面板恰好两行
		// （模型 / 推理等级），点一行 **drill 进该行的 pane**；模型 pane 按服务商分组。
		// 内联展开（在行下方铺开列表）在设置面板里行不通：面板是窄栏 + 可滚动容器，
		// 列表一展开就把下面的内容顶下去，且没有浮层的边框/阴影/背景。
		//
		// 官方实现依赖的 react-dom createPortal、ui-primitives 图标、useAnchoredPosition
		// 都是 Web 前端的静态模块（见文件顶部 require 处的说明），permgate 可直接 require。
		//
		// 与官方**刻意保留**的差异只有两处，都是为了 permgate 的语义：
		//   ① 模型 pane 第一项是「跟随会话」（官方没有这个概念，它总是绑一个确切模型）；
		//   ② 推理等级分成**两组**：
		//        · 通用（跟随会话 / 模型默认 / 模型最低 / 模型最高）—— 相对值，
		//          对任何模型都成立，无需知道模型公布了什么；
		//        · 指定（模型自己公布的档位 Low / High / Max …）—— 绝对值。
		//      官方在模型不公布档位时整行不渲染，而用户明确要求
		//      「即使模型列表是空的，也要有这几个默认选项」。
		//
		// 「指定」里的档位 id 可能与通用档**重名**（最典型：模型公布的末档就叫 `max`，
		// 而「模型最高」的符号值也是 `max`）。二者派发出去是同一个档位，但配置语义不同：
		// 「模型最高」跟着模型走（换模型仍是最高），「指定 Max」钉住这个 id（换到没有
		// `max` 的模型就该重新选）。故「指定」组的值统一存成 **`@` + 档位 id**，
		// 与同名的符号档在配置里可区分；宿主 `resolveEffort` 剥前缀后按具体档位校验。
		// 「指定」组选项值的前缀。放在这里而不是拼字面量：宿主与客户端必须**同源**，
		// 否则一边存 `@max` 一边按 `max` 查档位表，永远查不到（表现为「选了不生效」）。
		const PG_EFFORT_PIN = '@';
		// 通用档的符号值 → 文案键。**这份映射就是「哪些值是符号档」的唯一声明**：
		//   · 显示（effortNameOf）据此判断「这是相对档，要显示固定文案而不是档位名」；
		//   · 卡片里换模型时据此判断「这是相对档，保留不动」。
		//
		// ⚠️ 不要再另写一个 `PG_EFFORT_SYMBOLS = ['default','max','min']` 数组 ——
		// 那是同一份知识的第二份字面量，加一个符号档时只改一处、另一处静默按具体档位
		// 处理（显示成原始 id，或换模型时被当成钉住档位清掉）。下面从映射派生即可。
		//
		// `session`（跟随会话）也是符号档，且**必须显式写进配置**：宿主 resolveEffort
		// 一直认这个值并走 follow()，缺的只是客户端这一侧 —— 不写它、也不显示它，
		// 那一项就只能靠「删掉配置键」来表达，而删键现在的语义是「回到默认档 `min`」，
		// 于是菜单里还列着这一项、却永远选不中（选中后宿主回落 min，面板当场改显示）。
		const PG_EFFORT_SESSION = 'session';
		const PG_EFFORT_SYMBOL_LABELS = {
			session: 'panel.autoEffortSession',
			default: 'panel.autoEffortDefault',
			max: 'panel.autoEffortMax',
			min: 'panel.autoEffortMin',
		};
		// 派生：符号档值的清单（顺序无关，只用于 indexOf 判成员）。
		const PG_EFFORT_SYMBOLS = Object.keys(PG_EFFORT_SYMBOL_LABELS);

		// ── 推理强度的显示名 ────────────────────────────────────────────────────────
		// 输入是**配置值**（`session` / `default` / `max` / `min` / `@high` / `high`），
		// 输出该给用户看的字符串。四种形态的处理必须与宿主 `resolveEffort` 同口径，
		// 否则配置页写的和决策记录里说的会是两回事。
		//
		// `@` 前缀先剥、且**不查符号表**：`@max` 指的是名叫 `max` 的那个档位，
		// 不是「模型最高」。查了符号表就会把钉住意图悄悄变成相对意图 ——
		// 换模型后行为随之改变，而配置里明明写着 `@max`。
		function effortWantLabel(v) {
			const s = String(v || '');
			if (!s) return '';
			if (s.charAt(0) === PG_EFFORT_PIN) return s.slice(1);
			if (Object.prototype.hasOwnProperty.call(PG_EFFORT_SYMBOL_LABELS, s)) return T(PG_EFFORT_SYMBOL_LABELS[s]);
			return s;
		}

		// 决策记录里「推理强度」那一行的右半部分（不含前置的 `flow.effort`）。
		// 会话流与会话轨迹是**同一条记录的两个视图**，措辞必须来自这一个函数 ——
		// 各拼一遍就是同一份数据在两处显示不同（risk 那条守卫记着同一类问题）。
		//
		// 输入是记录里的 `effort`（实际派发的档位）与 `effortWant`（配置原值）。
		function effortFlowLabel(d) {
			const effort = d && d.effort ? String(d.effort) : '';
			const want = d && d.effortWant ? String(d.effortWant) : '';
			if (!effort) {
				// 没派发。**不能用 fallbackReason 反推原因**：它只能回答「有没有失败」，
				// 而空派发还有三种不报错的来源，各有各的原因 ——
				//   · 「模型默认」：平台只在适配器给了 defaultEffort 时才物化档位，
				//     公布了 efforts 却没有默认档的模型（pi-ai 未配 profile.reasoning）
				//     照样落空，此时它明明公布了档位；
				//   · 「跟随会话」：会话没主动选档位，或那个档位不在目标模型表里，
				//     resolveEffort 的 follow() 都返回空且不报错；
				//   · 「模型最低/最高」与具体档位：只有模型不公布档位表时才会落空。
				// 故判据是**配置值的语义**（它决定 resolveEffort 走哪条分支），不是失败字段。
				if (!want) return '';
				if (d.fallbackReason) {
					// 有失败原因（config-error / 超时 / 线路）：不断言原因，
					// 否则会把「模型公布了档位但不支持你选的那个」说成「不公布档位」。
					return T('flow.effortNone').replace('{want}', effortWantLabel(want));
				}
				// 判据必须区分 `@` 前缀：`@session` 指的是**名叫 session 的那个具体档位**
				// （resolveEffort 的 pinned 分支去查档位表，查不到就不派发），
				// 与「跟随会话」毫无关系。先剥前缀再比对符号值，会把用户钉住的档位
				// 解释成「会话没选档位」—— 假话。
				//
				// 例外是 `@` 单独一个字符：resolveEffort 的 `if (!v) return follow()`
				// 在 pinned 分支之前，剥完为空确实走跟随会话，那时与 `session` 同义。
				const pinned = want.charAt(0) === PG_EFFORT_PIN;
				const sym = pinned ? want.slice(1) : want;
				const followsSession = sym === '' || (!pinned && sym === 'session');
				const key = followsSession ? 'flow.effortNoneSession'
					: (!pinned && sym === 'default') ? 'flow.effortNoneDefault'
						: 'flow.effortNoneNoTable';
				return T(key).replace('{want}', effortWantLabel(want));
			}
			// 括号只在需要对照时出现：符号值要解释「解析成了什么」，
			// 而 `@high` 与裸 `high` 本身已经是答案，再加「设置：High」是冗余。
			if (!Object.prototype.hasOwnProperty.call(PG_EFFORT_SYMBOL_LABELS, want)) return effort;
			return T('flow.effortWithWant')
				.replace('{effort}', effort)
				.replace('{want}', effortWantLabel(want));
		}

		// ── 按名字模糊匹配并排序（照抄官方 ui-primitives 的 rankByName）────────────
		// 官方 `rankByName` 不是「子串包含」，而是**大小写不敏感的有序子序列**匹配
		// 加打分：前缀命中优先，其次按匹配的紧凑程度（连续字符、词边界 `-`/`_` 加分）。
		// 所以 `v41` 能匹配 `deepseek-v4.1-f`，`gpt6sol` 能匹配 `GPT-6.1 Sol`。
		//
		// 为什么照抄而不写个简单的 includes：官方搜索框就是这个行为，用户按 `v41`
		// 能搜到 `V4.1`，换成 includes 就搜不到 —— 同一个 UI 里两套匹配规则。
		//
		// 参数与官方一致：items 是 [{ name, label? }]，返回**过滤并重排后**的数组。
		function pgRankByName(items, query) {
			const q = String(query || '').toLowerCase();
			if (q === '') return items;
			// 词边界加分：位置 0、或前一个字符是 `-` / `_`
			const boundary = (s, i) => (i === 0 || s.charAt(i - 1) === '-' || s.charAt(i - 1) === '_' ? 8 : 0);
			// 有序子序列打分。返回 undefined = 不匹配。
			const score = (s, needle) => {
				if (needle.length > s.length) return undefined;
				const NEG = Number.NEGATIVE_INFINITY;
				let prev = new Array(s.length).fill(NEG);
				for (let i = 0; i < s.length; i++) {
					if (s.charAt(i) === needle.charAt(0)) prev[i] = 1 + boundary(s, i) - i;
				}
				for (let k = 1; k < needle.length; k++) {
					const cur = new Array(s.length).fill(NEG);
					let prevPrev = NEG;   // prev[i-1]（官方的 h）
					let prevSame = NEG;   // prev[i]（官方的 u）
					let gapBest = NEG;    // 官方的 p
					for (let i = 0; i < s.length; i++) {
						// ⚠️ 官方是 `p = max(p, h + g - 2)`，其中 **g 是下标**，
						// 不是 `prev[i]`。写成 `prevPrev + prev[i] - 2` 会让打分完全跑偏：
						// 实测 `v41` 一个都匹配不上（`deepseek` 这类纯前缀恰好还能过，
						// 因为它靠 prefix 标志排序、不依赖分数）。
						if (prevPrev !== NEG) gapBest = Math.max(gapBest, prevPrev + i - 2);
						if (s.charAt(i) === needle.charAt(k)) {
							const bonus = 1 + boundary(s, i);
							let best = NEG;
							if (prevSame !== NEG) best = prevSame + bonus + 4;                  // 连续
							if (gapBest !== NEG) best = Math.max(best, gapBest + bonus + 1 - i); // 跳跃
							cur[i] = best;
						}
						prevPrev = prevSame;
						prevSame = prev[i];
					}
					prev = cur;
				}
				let out = NEG;
				for (const v of prev) out = Math.max(out, v);
				return out === NEG ? undefined : out;
			};
			const hits = [];
			items.forEach((item, index) => {
				const fields = item.label === undefined ? [item.name] : [item.name, item.label];
				let prefix = false;
				let best;
				for (const raw of fields) {
					const s = String(raw || '').toLowerCase();
					const sc = score(s, q);
					if (sc === undefined) continue;
					if (s.startsWith(q)) prefix = true;
					best = best === undefined ? sc : Math.max(best, sc);
				}
				if (best !== undefined) hits.push({ item, index, prefix, score: best });
			});
			// 排序：前缀命中优先 → 分数高优先 → 保持原顺序（稳定）
			hits.sort((a, b) => (Number(b.prefix) - Number(a.prefix)) || (b.score - a.score) || (a.index - b.index));
			return hits.map((h) => h.item);
		}

		function ModelEffortPicker(props) {
			// props: {
			//   model, provider, effort    —— 用户**配置**的值（effort 为空 = 未配置，生效的是宿主默认档）
			//   effective                  —— 宿主下发的**实际生效** {model, provider, effort}
			//   groups                     —— [{ id, name, models: [{ id, name, reasoning? }] }]
			//   efforts                    —— 扁平档位表（模型自己的 reasoning 取不到时兜底）
			//   disabled, onPick(patch)    —— patch 形如 {model, provider} 或 {reasoningEffort}
			// }
			const groups = Array.isArray(props.groups) ? props.groups : [];
			const flatEfforts = Array.isArray(props.efforts) ? props.efforts : [];
			const effective = props.effective && typeof props.effective === 'object' ? props.effective : {};
			// `pane` 同时承担两件事：**哪一行被点开**、以及浮层显示哪一级内容。
			// 'root' = 没打开；'model' / 'effort' = 那一行 drill 进了自己的列表。
			// 官方是 `open` + `pane` 两个状态（根面板本身就在浮层里）；
			// permgate 的两行直接长在设置面板上（常显），所以「没打开」与
			// 「停在根面板」是同一件事，一个状态就够 —— 两个状态会允许
			// 「open=true 但 pane=root」这种无意义组合，还得额外兜。
			const [pane, setPane] = React.useState('root');
			const [pos, setPos] = React.useState(null);
			// 搜索词：官方 `query` 状态，只在模型 pane 生效（推理等级 pane 没有搜索框）。
			const [query, setQuery] = React.useState('');
			// 键盘/鼠标高亮项的下标（官方 `highlightedIndex`）。
			// 官方把「当前选中项」与「高亮项」分开：前者是 ✓，后者是底色。
			// 打开时置 null = 跟随当前选中项（官方 activeModelIndex 的默认值）。
			const [highlighted, setHighlighted] = React.useState(null);
			// 浮层里的行节点，下标与 visibleRows / effortList 一致（两个 pane 的下标空间
			// 不同，故各存一份）。打开浮层时把焦点送到当前项、↑↓ 时跟着搬，都按它取节点。
			const rowRefs = React.useRef({ model: [], effort: [] });
			// 上一次渲染时的 pane：浮层打开/收起时据此把焦点搬进/搬出。
			const prevPaneRef = React.useRef('root');
			// 点浮层外面关掉时不要把焦点抢回 trigger —— 用户已经点去别处了。
			const skipRestoreRef = React.useRef(false);
			const pickerRootRef = React.useRef(null);
			const menuRef = React.useRef(null);
			const listRef = React.useRef(null);
			const searchRef = React.useRef(null);
			// 每一行各一个锚点：浮层必须贴在被点的那一行下面。
			// 共用一个 ref 的话，后渲染的那行会覆盖前者，点「模型」却锚在「推理等级」下方。
			const anchorRefs = React.useRef({ model: null, effort: null });
			const open = pane !== 'root';

			// ── 当前选中项 ────────────────────────────────────────────────────────────
			// 官方 `currentChoice` 由 (provider, model) 在 choices 里查出来；查不到就
			// 说明当前模型不在目录里（被删了、或目录没取到）。此时**显示配置值本身**
			// 而不是「未知」——用户至少能看到自己配的是哪个 id。
			const choices = [];
			for (const g of groups) for (const m of (Array.isArray(g.models) ? g.models : [])) choices.push({ group: g, model: m });
			const cur = props.model
				? (choices.find((c) => c.model.id === props.model && c.group.id === props.provider) || null)
				: null;
			// 这一行回答「**我配了什么**」，不是「现在跑的是哪个模型」：未配置时显示「跟随会话」，
			// 不回退到 `effective.model` —— 那是会话当前模型，切一个对话就变，写进全局设置项会让人
			// 以为「设置跟着对话漂」。
			//
			// 取值链：目录里查得到 → 模型名（配置值）；查不到但配置了 → 配置的 id；没配置 → 「跟随会话」。
			const modelLabel = cur
				? String(cur.model.name || cur.model.id)
				: (props.model ? String(props.model) : T('panel.autoModelFollow'));

			// ── 推理等级的显示名 ──────────────────────────────────────────────────────
			// 档位表必须按**当前显示的那个模型**查：只看配置值时，「跟随会话」下 cur 为 null、
			// 档位表为空，显示会回落成原始 id（`max` 而不是 `Max`）。
			// 取值：配置了就用配置的模型；**没配置**（跟随会话）才用会话当前的模型
			// —— 它只决定「展开后能选哪些档位」，不决定这一行显示什么（见下）。
			//
			// ⚠️ fallback 必须带 `!props.model` 这个前置条件：配置了模型 A、但目录里查不到 A
			// （模型被删 / 目录没取到）时，若不判就直接 fallback 到会话模型 B，
			// 档位列表会列成 **B 的**档位 —— 而那是一个这里根本没在用的模型。
			const shownSel = cur
				? { provider: cur.group.id, model: cur.model }
				: ((!props.model && effective.model)
					? (choices.find((c) => c.model.id === effective.model && (!effective.provider || c.group.id === effective.provider)) || null)
					: null);
			const reasoning = shownSel && shownSel.model.reasoning && typeof shownSel.model.reasoning === 'object'
				? shownSel.model.reasoning : null;
			const modelEfforts = reasoning && Array.isArray(reasoning.efforts) ? reasoning.efforts : [];
			const effortNameOf = (v) => {
				if (!v) return '';
				const s = String(v);
				// 「指定」组的值带 `@` 前缀（见 PG_EFFORT_PIN），查档位表前必须剥掉，
				// 否则永远查不到（表里是 `max`，配置里是 `@max`）。
				const pinned = s.charAt(0) === PG_EFFORT_PIN;
				const id = pinned ? s.slice(1) : s;
				// 符号档（相对值）**不进档位表**：模型公布的末档常常就叫 `max`，
				// 查表会把「模型最高」显示成那个模型的具体档位名 —— 两者在本模型上
				// 恰好同档，换到档位表不同的模型就分道扬镳（相对 vs 钉住），
				// 而配置里写的是前者。
				if (!pinned && Object.prototype.hasOwnProperty.call(PG_EFFORT_SYMBOL_LABELS, s)) return effortWantLabel(s);
				const hit = modelEfforts.find((e) => e.id === id) || flatEfforts.find((e) => e.id === id);
				// 查不到才回落 —— 那时 effortWantLabel 负责剥 `@` 与给出通用文案。
				return hit && hit.name ? String(hit.name) : effortWantLabel(s);
			};
			// 与模型那一行同一条纪律：这一行回答「**我配了什么**」。
			//
			// 不能取 `props.effort || effective.effort`：`effective.effort` 是宿主下发的
			// 会话当前档位，未配置时显示它，同一个全局设置项就会随对话漂移 ——
			// 换个对话，它显示成另一个档位。没配置就写「跟随会话」，不写具体值。
			//
			// 「跟随会话」有两种来源，显示同一句话：显式配的 `session`（走
			// PG_EFFORT_SYMBOL_LABELS 查文案），以及配置层真的为空（手改 config.json）。
			const effortLabel = props.effort
				? effortNameOf(props.effort)
				: T('panel.autoEffortSession');

			// ── 图标：官方 primitives 优先，缺失时退回内联 SVG ─────────────────────────
			// 官方 .cellChevron = IconChevronRightOutlineRegular（12×12）；
			//      .check 里 = IconCheckOutlineRegular（14×14）。
			const IconChevronRight = Primitives && Primitives.IconChevronRightOutlineRegular;
			const IconCheck = Primitives && Primitives.IconCheckOutlineRegular;
			const chevronRight = () => (IconChevronRight
				? React.createElement(IconChevronRight, { style: { width: 12, height: 12, flex: 'none', color: 'var(--dsw-alias-menu-icon, rgba(128,128,128,0.9))' } })
				: React.createElement('svg', {
					viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true', focusable: 'false',
					style: { width: 12, height: 12, flex: 'none', color: 'var(--dsw-alias-menu-icon, rgba(128,128,128,0.9))' },
				}, React.createElement('path', {
					d: 'M6 3.5L10.5 8L6 12.5', stroke: 'currentColor', strokeWidth: 1.5,
					strokeLinecap: 'round', strokeLinejoin: 'round',
				})));
			const checkMark = () => (IconCheck
				? React.createElement(IconCheck, { style: { width: 14, height: 14 } })
				: React.createElement('span', { 'aria-hidden': 'true' }, '\u2713'));

			// ── 浮层定位 ──────────────────────────────────────────────────────────────
			// 官方 useAnchoredPosition：锚点左对齐、下边缘 +4px、四边留 8px、随滚动/resize 重算。
			// 用 useLayoutEffect 是为了「先量后画」——否则浮层会先在 (0,0) 闪一帧。
			React.useLayoutEffect(() => {
				if (!open) return;
				if (typeof window === 'undefined') return;
				const place = () => {
					const el = anchorRefs.current[pane];
					const menu = menuRef.current;
					if (!el || !menu) return;
					const r = el.getBoundingClientRect();
					const w = menu.offsetWidth;
					const h = menu.offsetHeight;
					const margin = 8;
					const left = Math.min(Math.max(r.left, margin), Math.max(margin, window.innerWidth - w - margin));
					const top = Math.min(Math.max(r.bottom + 4, margin), Math.max(margin, window.innerHeight - h - margin));
					setPos({ left, top });
				};
				place();
				window.addEventListener('scroll', place, true);
				window.addEventListener('resize', place);
				return () => {
					window.removeEventListener('scroll', place, true);
					window.removeEventListener('resize', place);
				};
			}, [open, pane]);

			// ── 键盘导航要把高亮项滚进视野 ────────────────────────────────────────────
			// 列表本身会滚动（见 listStyle），高亮项若落在视口外，屏幕上就没有任何反馈 ——
			// 官方同样在 activeModelIndex 变化时 scrollIntoView({ block: 'nearest' })。
			// 两个 pane 的高亮都落在 `.pg-active` 上，故不必各写一套。
			React.useLayoutEffect(() => {
				if (!open) return;
				const list = listRef.current;
				if (!list || typeof list.querySelector !== 'function') return;
				const row = list.querySelector('.pg-active');
				if (row && typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' });
			}, [open, pane, highlighted]);

			// ── 关闭：点外面 / Escape ─────────────────────────────────────────────────
			// 官方 Escape 是「先退出已 drill 的 pane，再关菜单」。这里 pane='root' 就是
			// 「已关」，故 Escape 直接关（没有更上一级可退）。
			React.useEffect(() => {
				if (!open) return;
				const onDown = (ev) => {
					const t = ev.target;
					if (pickerRootRef.current && pickerRootRef.current.contains(t)) return;
					if (menuRef.current && menuRef.current.contains(t)) return;
					skipRestoreRef.current = true;
					setPane('root');
				};
				const onKey = (ev) => {
					// 组合态里的 Esc 属于输入法（取消候选词），不是「关闭浮层」。
					// 这个监听器挂在 document 上、浮层里任何输入框的按键都会冒泡到这里，
					// 故判据必须在这一层 —— 各输入框自己的 onKeyDown 提前 return 拦不住它。
					if (ev.isComposing || ev.keyCode === 229) return;
					if (ev.key === 'Escape') setPane('root');
				};
				document.addEventListener('mousedown', onDown);
				document.addEventListener('keydown', onKey);
				return () => {
					document.removeEventListener('mousedown', onDown);
					document.removeEventListener('keydown', onKey);
				};
			}, [open]);

			const close = () => { setPane('root'); setQuery(''); setHighlighted(null); };
			const choose = (patch) => { close(); props.onPick(patch); };
			// 点同一行再点一次 = 收起；点另一行 = 直接切过去（不用先关再开）。
			// 切换 pane 时**清空搜索词与高亮**（官方 drill() 里同样 `setQuery("")`）：
			// 留着上一个 pane 的搜索词，切到推理等级会看到「搜索框没了但列表被过滤了」
			// 那种无从解释的状态。
			const toggle = (key) => {
				if (pane === key) { close(); return; }
				setQuery('');
				setHighlighted(null);
				setPane(key);
			};

			// ── 样式：行排版与同卡片其它行**逐项同值** ─────────────────────────────────
			// 参照 `row()`（本卡片里「等待人工的时限 / 连续拒绝上限 / 工具调用历史」三行）：
			//   { display:'flex', alignItems:'center', gap:8, marginTop:6, flexWrap:'wrap' }
			//   标签 { fontSize:12, minWidth:130 }
			// 这里只把「行」换成可点的 button，其余数值全部对齐 —— 否则两套排版并排出现，
			// 观感就是「这一块和别处不是一个东西」（实测反馈）。
			//
			// 与官方 .cell 的差异是**刻意的**：官方那套是给作曲区浮层用的（字号 13、
			// 值靠右、行内左右 8px 内边距），放进设置卡片就会与相邻行错位。
			// 视觉一致性优先于「逐像素照抄另一个界面的组件」。
			const cellStyle = {
				boxSizing: 'border-box', borderRadius: 6, width: '100%', minWidth: 0,
				height: 26, color: 'var(--dsw-alias-label-primary, inherit)',
				cursor: props.disabled ? 'default' : 'pointer',
				textAlign: 'left', border: 'none', outline: 'none',
				alignItems: 'center', gap: 8, padding: 0, marginTop: 6,
				fontSize: 12, lineHeight: '20px',
				display: 'flex', fontFamily: 'inherit',
			};
			// 标签：与 row() 的 `fontSize:12, minWidth:130` 同值（保证左边缘对齐）。
			const cellLabelStyle = { whiteSpace: 'nowrap', flex: 'none', fontSize: 12, minWidth: 130 };
			// 值：**紧跟标签**（不 flex:auto 推到最右）。官方 cellValue 是右对齐的，
			// 但那在设置卡片里会让值孤零零地贴到右边缘，与旁边行完全脱节。
			// 这里只做截断，不伸展。
			const cellValueStyle = {
				textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left', minWidth: 0,
				color: 'var(--dsw-alias-label-tertiary, rgba(128,128,128,0.95))', flex: '0 1 auto', overflow: 'hidden',
			};
			// .option { box-sizing:border-box; border-radius:md; width:auto; min-width:100%;
			//           min-height:34px; text-align:left; cursor:pointer;
			//           align-items:center; gap:6px; padding:5px 7px; display:flex }
			//
			// ⚠️ **background 不能写在这里**。官方 .option 的 `background:0 0` 在 CSS 里，
			// 而 hover / optionActive 的底色来自**类**（`.pg-hoverable:hover`）。
			// 内联 style 的优先级永远高于类选择器 —— 只要这里写 `background:'transparent'`，
			// 那个 :hover 规则就永远不会生效（实测：鼠标划过没有任何反馈）。
			// 所以底色交给注入的样式表，这里只放布局。
			const optionStyle = {
				boxSizing: 'border-box', borderRadius: 8, width: 'auto', minWidth: '100%',
				minHeight: 34, color: 'inherit', textAlign: 'left', cursor: 'pointer',
				border: 'none', outline: 'none',
				alignItems: 'center', gap: 6, padding: '5px 7px', display: 'flex', fontFamily: 'inherit',
			};
			// .optionCopy { flex-direction:column; flex:1; min-width:0; display:flex }
			const optionCopyStyle = { flexDirection: 'column', flex: 1, minWidth: 0, display: 'flex' };
			// .modelName { text-overflow:ellipsis; white-space:nowrap; font-size:13px;
			//              font-weight:400; line-height:18px; overflow:hidden }
			const modelNameStyle = { textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, fontWeight: 400, lineHeight: '18px', overflow: 'hidden' };
			// .check { color:label-primary; flex:0 0 14px; place-items:center; display:grid }
			const checkStyle = { color: 'var(--dsw-alias-label-primary, inherit)', flex: '0 0 14px', placeItems: 'center', display: 'grid' };
			// .menu { width:max-content; min-width:min(240px,100vw - 32px);
			//         max-width:min(420px,100vw - 32px); max-height:min(360px,100vh - 96px);
			//         padding:4px; flex-direction:column; display:flex; overflow:hidden;
			//         border-radius:lg; box-shadow:elevation-prominent }
			//
			// ⚠️ 背景**必须是完全不透明**的（这次「越往下越浅」的真凶）。
			// 官方 MenuSurface 的材质是 `--dsw-menu-surface-fill: #f8f9fa94`（alpha 148/255）
			// **加上** `backdrop-filter: blur(40px) saturate(150%)` 才有那个磨砂效果。
			// 而那个 filter 的取值定义在 `[data-menu-material]` 选择器下
			// （`body[data-ds-dark-theme] [data-menu-material]{--dsw-menu-backdrop-filter:...}`）——
			// 我这个 div 没有 `data-menu-material` 属性，`var()` 解析失败退回 `none`。
			//
			// 结果：**半透明背景 + 没有模糊** = 下发设置面板的文字直接透上来。
			// 面板内容是深浅不一的（有输入框、有灰字），叠在不同位置上明暗不同，
			// 看起来就是「越到下面的项越浅」——其实是下面透上来的东西不一样。
			//
			// 故改用**不透明**的 `--dsw-alias-bg-overlay`（浅色 bluish-150 / 深色有对应值）。
			// 不追求官方那种磨砂玻璃质感：那需要 MenuSurface 的完整材质层，
			// 而设置在窄栏里、浮层贴着面板，不透明反而更清晰。
			const menuStyle = {
				position: 'fixed', zIndex: 1100, boxSizing: 'border-box',
				width: 'max-content', minWidth: 'min(240px, 100vw - 32px)', maxWidth: 'min(420px, 100vw - 32px)',
				maxHeight: 'min(360px, 100vh - 96px)',
				borderRadius: 'var(--dsw-radius-lg, 12px)',
				boxShadow: 'var(--dsw-elevation-prominent, 0 8px 28px rgba(0,0,0,0.28))',
				background: 'var(--dsw-alias-bg-overlay, #ffffff)',
				color: 'var(--dsw-alias-label-primary, inherit)',
				border: '0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.3))',
				padding: 4, display: 'flex', flexDirection: 'column', overflow: 'hidden',
				fontFamily: 'inherit',
				left: pos ? pos.left : 0, top: pos ? pos.top : 0,
				visibility: pos ? 'visible' : 'hidden',
			};
			// ── 列表滚动容器 ──────────────────────────────────────────────────────────
			// 浮层要两层：外层是 `overflow:hidden` 的裁剪盒（圆角 + maxHeight），
			// 列表自己在一个 `min-height:0; overflow-y:auto` 的容器里滚动。
			// 只有外层时，超出 maxHeight 的行既看不到也滚不到 —— 目录里的模型越多，
			// 界面越像「目录里只有前几个」。
			//
			// `minHeight: 0` 不能省：flex 子项的默认 min-height 是内容高度，
			// 不置 0 会被内容撑开，永远触发不了滚动。
			const listStyle = { minHeight: 0, overflowY: 'auto' };

			// ── trigger：与同卡片其它行**同一套排版** ─────────────────────────────────
			// 官方 trigger 是作曲区的按钮（模型名 · 档位 + 下箭头）；但这里不是作曲区，
			// 而是 permgate 的设置卡片 —— 它必须和上面的「等待人工的时限 / 连续拒绝上限 /
			// 工具调用历史」那几行长得一样。
			//
			// 踩过的真实问题：照抄官方 .cell 的排版（fontSize 13、padding 0 8px、cellValue
			// `flex:auto` + `textAlign:right`）放进设置卡片会有三处问题：标签字号与旁边行不同；行内左右
			// 内边距让标签整体右移、与旁边行对不齐；值被推到最右边，而旁边行的值紧跟标签。
			//
			// 故改为与 `row()` 逐项同值：字号 12、无水平内边距、标签 minWidth 130、
			// gap 8。值**紧跟在标签后面**（不推右），与旁边行完全同一条竖线。
			//
			// 仍然保留 chevron：它表明「点这行会展开」，是官方语义的一部分。
			const trigger = (label, value, key) => React.createElement('button', {
				ref: (el) => { anchorRefs.current[key] = el; },
				type: 'button', role: 'menuitem', 'aria-haspopup': 'menu',
				'aria-expanded': pane === key, disabled: props.disabled === true,
				className: 'pg-hoverable', style: cellStyle, onClick: () => toggle(key), 'data-picker': key,
			},
				React.createElement('span', { style: cellLabelStyle }, label),
				React.createElement('span', { style: cellValueStyle }, value),
				chevronRight(),
			);

			// ── 根面板：恰好两行（模型 / 推理等级）────────────────────────────────────
			const rootPane = React.createElement(React.Fragment, null,
				trigger(T('panel.autoModel'), modelLabel, 'model'),
				trigger(T('panel.autoEffort'), effortLabel, 'effort'),
			);

			// ── 模型 pane：按服务商分组（官方 MenuGroup）+ 搜索 + 高亮 ─────────────────
			//
			// 三件事都是官方有而这里需要的：
			//   ① 搜索框：官方 `choices.length > 4` 时出现，按 rankByName 过滤 + 重排；
			//   ② 高亮：官方 `activeModelIndex`，由 mousemove 与 ↑↓ 共同驱动，
			//      底色来自 `.pg-active` 类（**不是** :hover —— 见 optionStyle 处的说明）；
			//   ③ 空结果说明：官方 `search.empty`（有目录但没匹配）与
			//      `empty.models`（目录为空）是**两句不同的话**。
			//
			// 官方把「跟随会话」这类项也放进同一个 visibleModels 列表里编号，
			// 故高亮下标与「可选项」一一对应。这里同样先拼一个扁平的可选项列表，
			// 再按它渲染分组 —— 否则分组结构里的下标与高亮下标对不上。
			const allChoices = [];
			for (const g of groups) for (const m of (Array.isArray(g.models) ? g.models : [])) {
				allChoices.push({ provider: g.id, group: g, model: m, name: String(m.name || m.id) });
			}
			// 「跟随会话」项就写「跟随会话」四个字：它表达的是**配置意图**（不覆盖），
			// 不是「实际在用谁」。后者属于**当前对话**，切个对话就变，写进全局设置项
			// 只会让人以为「设置跟着对话漂」；想知道某个对话用的是谁，看会话本身。
			const followModelLabel = T('panel.autoModelFollow');
			// 搜索只在模型数 > 4 时出现（官方 `showSearch = choices.length > 4`）：
			// 两三个模型时搜索框只是噪音，还占掉浮层高度。
			const showSearch = allChoices.length > 4;
			const activeQuery = showSearch ? query : '';
			// 过滤 + 重排。官方对**每个分组**各跑一次 rankByName（不是整表重排），
			// 所以分组顺序不变、组内顺序按匹配度。这里照做。
			//
			// 写成函数是因为搜索框要在 onChange 里**按新词**求默认高亮项（见
			// highlightForQuery）：那一刻列表还是旧词的，用它算出来的是上一个词的结论。
			const rankGroups = (q) => {
				// 匹配前统一裁剪：搜索框给的是**原始输入**，前导/尾随空格（误触空格键、
				// 输入法上屏带空格、粘贴模型名）会让 pgRankByName 拿空格去匹配模型名 ——
				// 明明有匹配却显示「没有匹配的模型」。官方同样在调用点 query.trim()
				// （pgRankByName 本身照抄官方，不做裁剪）。
				const needle = String(q || '').trim();
				const out = [];
				for (const g of groups) {
					const models = Array.isArray(g.models) ? g.models : [];
					if (!models.length) continue;
					const ranked = pgRankByName(models.map((m) => ({ name: String(m.name || m.id), model: m })), needle);
					if (ranked.length) out.push({ group: g, items: ranked });
				}
				return out;
			};
			const filteredGroups = rankGroups(activeQuery);
			// 高亮的可选项目录：先「跟随会话」，再按分组展开 —— 与渲染顺序一致。
			// 搜索时「跟随会话」不参与匹配（它不是模型），但仍留在第一位：
			// 用户搜 `gpt` 时不该把「跟随会话」过滤掉（那是退出覆盖的唯一入口）。
			//
			// ⚠️ 由此有一条纪律：**下标 0 恒为「跟随会话」**，第一个模型行恒为 1。
			// 官方的 `setHighlightedIndex(0)` 之所以安全，是因为它的 visibleModels 里
			// 没有这一项；这里的 0 是个会把 model/provider 从配置里删掉的破坏性动作。
			const visibleRows = [{ kind: 'follow', __key: '\u0000follow', __idx: 0 }];
			for (const fg of filteredGroups) for (const it of fg.items) {
				visibleRows.push({
					kind: 'model', provider: fg.group.id, group: fg.group, model: it.model,
					__key: fg.group.id + '/' + it.model.id, __idx: visibleRows.length,
				});
			}
			// 当前选中项在 visibleRows 里的下标（官方 currentVisibleIndex）。
			const currentVisibleIndex = visibleRows.findIndex((r) => (r.kind === 'follow'
				? !props.model
				: (props.model === r.model.id && props.provider === r.provider)));
			// 搜索框改词后的默认高亮项。**按新词现算**，不能用当前渲染的列表：
			// onChange 里 setQuery 之后列表还是旧词的，用旧列表算出来的是上一个
			// 搜索词的结论（词改到无匹配时第一个模型不存在，下标会落回 0 —— 而 0 恒为
			// 「跟随会话」，回车就把 model/provider 从配置里删了）。
			//
			// 规则与官方一致：落在**第一个匹配的模型**上；一个都没匹配到则为 -1，
			// 此时回车不动作（官方同样在 visibleModels 为空时什么都不做）。
			// 下标从 1 起算，与 visibleRows 同构（第 0 项恒为「跟随会话」）。
			const highlightForQuery = (q) => (rankGroups(q).length ? 1 : -1);
			// ── 高亮与选中是**两个独立信号** ──────────────────────────────────────────
			//   · 「现在选中谁」= 右侧 ✓（持久、由 props.model 决定）
			//   · 「鼠标/键盘在哪」= 底色（瞬时、由 highlighted 决定）
			// 底色**只**表示后者：highlighted === null → **没有任何行有底色**（不回退到选中项）。
			// 选中项的可辨识性由 ✓ 单独承担。
			//
			// `navIndex` 仍保留回退（选中项优先），它只服务键盘导航的「起点」——
			// 那是行为而非视觉，回退是必要的（按 ↓ 应该从选中项往下走）。
			//
			// ⚠️ 回退目标**不能是 0**。官方的 `Math.max(0, currentVisibleIndex)` 依赖
			// 「0 永远是一个模型」这个前提（它的 visibleModels 不含「跟随会话」）；
			// 这里第 0 项恒为「跟随会话」，于是「配置的模型不在当前列表里」时
			// （被删 / 改名 / 目录还没加载完 / 取失败）`currentVisibleIndex` 为 -1，
			// 钳到 0 就把**回车**的落点指向了那个会把 model/provider 从配置里删掉的
			// 破坏性动作 —— 用户什么都没选，只是打开面板按了个回车。
			//
			// 故回退到**第一个模型行**（官方那里 0 就是第一个模型，语义等价）；
			// 一个模型都没有时是 -1 = 没有目标：取项落空，回车不动作。
			const firstModelIndex = visibleRows.findIndex((r) => r.kind === 'model');
			const navIndex = Math.min(
				highlighted === null
					? (currentVisibleIndex >= 0 ? currentVisibleIndex : firstModelIndex)
					: highlighted,
				visibleRows.length - 1,
			);
			// 视觉高亮：只认 highlighted（null = 无）。
			const activeIndex = highlighted === null ? -1 : highlighted;

			// ── 鼠标离开时的处理：把高亮交还 ──────────────────────────────────────────
			// `activeModelIndex` 表达「当前指针/键盘所在项」；指针离开列表后应回到「当前选中项」。
			// 故每一行的 onMouseLeave 都 setHighlighted(null)：行与行之间移动也会触发前一行的
			// mouseleave —— 先清空再由下一行的 mousemove 设上，指针始终只有一个高亮项。
			// 只挂容器的 onMouseLeave 时行间移动不触发，指针停在分组标题/菜单内边距上时
			// 仍会留着上一行的高亮。
			const onRowLeave = () => { setHighlighted(null); };

			const optionRow = (key, rowIndex, label, selected, onClick) => React.createElement('button', {
				key, type: 'button', role: 'menuitemradio',
				// rowIndex 就是 visibleRows 的下标：焦点导航按它取节点。
				ref: rowIndex >= 0 ? (el) => { rowRefs.current.model[rowIndex] = el; } : undefined,
				'aria-checked': selected, title: label,
				className: 'pg-hoverable'
					+ (rowIndex >= 0 && rowIndex === activeIndex ? ' pg-active' : '')
					+ (selected ? ' pg-selected' : ''),
				'data-highlighted': rowIndex >= 0 && rowIndex === activeIndex ? '' : undefined,
				style: optionStyle,
				// 鼠标划过即高亮（官方 onMouseMove → setHighlightedIndex）。
				// 用 mousemove 而不是 mouseover：后者在子元素之间移动时会反复触发。
				onMouseMove: rowIndex >= 0 ? () => { if (highlighted !== rowIndex) setHighlighted(rowIndex); } : undefined,
				// 鼠标**离开这一项**就把高亮交还出去（见下方 onMouseLeave 的说明）。
				onMouseLeave: rowIndex >= 0 ? onRowLeave : undefined,
				onClick,
			},
				React.createElement('span', { style: optionCopyStyle },
					React.createElement('span', { style: modelNameStyle }, label)),
				React.createElement('span', { style: checkStyle }, selected ? checkMark() : null),
			);
			// 给 visibleRows 补上 key，供上面的 onMouseMove 查下标。
			// （直接在构造时写入，比在渲染里再算一次更不容易漂。）
			visibleRows.forEach((r, i) => {
				r.__key = r.kind === 'follow' ? '\u0000follow' : (r.provider + '/' + r.model.id);
				r.__idx = i;
			});


			const modelRows = [];
			// 搜索框（官方 .searchRow / .search）：放在滚动容器**外面**，不随列表滚走。
			let searchRow = null;
			if (showSearch) {
				searchRow = React.createElement('div', {
					key: '\u0000search', style: { flexShrink: 0, margin: '2px 0 3px', position: 'relative' },
				},
					React.createElement('input', {
						ref: searchRef, type: 'text', role: 'searchbox',
						'aria-label': T('panel.autoSearchPh'),
						placeholder: T('panel.autoSearchPh'),
						value: query,
						// 官方 searchRow .search: border-radius:md; background:0 0; border:0;
						//   height:auto; padding:5px 7px; display:flex；输入框 font-size:12px
						style: {
							boxSizing: 'border-box', width: '100%', borderRadius: 8,
							background: 'var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.08))',
							border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.25))',
							color: 'inherit', outline: 'none',
							padding: '5px 7px', fontSize: 12, lineHeight: 'normal', fontFamily: 'inherit',
						},
						// 默认项必须是**第一个匹配模型**，不是下标 0：0 恒为「跟随会话」，
						// 把它设为默认等于让「输入搜索词 → 回车」默认清空配置。
						// 必须按**新词**算（见 highlightForQuery）：按当前渲染的列表算，
						// 拿到的是上一个搜索词的结论 —— 词改到没有匹配时下标会落回 0。
						onChange: (e) => {
							setQuery(e.target.value);
							setHighlighted(highlightForQuery(e.target.value));
						},
						// 搜索框里的 ↑↓ / Enter 交给浮层处理（官方在 root 的 onKeyDown 里统一处理）
						onKeyDown: (e) => {
							// 组合态里的按键属于输入法：中文用户按回车确认候选词、按 ↑↓ 翻候选页
							// 时同样会派发这些键。不排除就会拿还没上屏的拼音串去选中模型，
							// 而用户从未打算选它。
							// ⚠️ 这里只挡得住输入框自己那几支；Escape 的关闭动作在 document 级
							// 监听器里，那里的组合态判据是独立的（见「关闭：点外面 / Escape」）。
							if (e.nativeEvent && (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229)) return;
							if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
								e.preventDefault();
								if (!visibleRows.length) return;
								// navIndex 为 -1 = **没有导航目标**（搜索词无匹配 / 目录为空 /
								// 配置的模型不在列表里且没有任何模型行）。取模运算会把 -1 绕成
								// 0，而 0 恒为「跟随会话」—— 再回车就把 model/provider 从配置里
								// 删了。没有目标就不导航。
								if (navIndex < 0) return;
								// 键盘导航用 navIndex（有回退到选中项），不是视觉高亮 activeIndex
								const next = (navIndex + (e.key === 'ArrowDown' ? 1 : -1) + visibleRows.length) % visibleRows.length;
								setHighlighted(next);
								return;
							}
							if (e.key === 'Enter') {
								e.preventDefault();
								const row = visibleRows[navIndex];
								if (!row) return;
								if (row.kind === 'follow') choose({ model: null, provider: null });
								else choose({ model: row.model.id, provider: row.provider });
								return;
							}
							if (e.key === 'Escape') { e.preventDefault(); close(); }
						},
					}),
					// 清除按钮（官方 search.clear）：有词才出现。
					query !== '' ? React.createElement('button', {
						type: 'button', 'aria-label': T('panel.autoSearchClear'), title: T('panel.autoSearchClear'),
						onClick: () => { setQuery(''); setHighlighted(null); if (searchRef.current) searchRef.current.focus(); },
						style: {
							position: 'absolute', top: '50%', right: 4, transform: 'translateY(-50%)',
							width: 24, height: 24, padding: 0, border: 'none', borderRadius: '50%',
							background: 'transparent', color: 'var(--dsw-alias-label-secondary, inherit)',
							cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
							fontSize: 14, lineHeight: 1,
						},
					}, '\u00d7') : null,
				);
			}

			// 「跟随会话」项。搜索时仍保留（见 visibleRows 的说明）。
			modelRows.push(optionRow(
				'\u0000follow', 0, followModelLabel, !props.model,
				() => choose({ model: null, provider: null }),
			));
			// 分组。标题照抄官方 .heading 的 padding / 字色 / 字号 / 字重
			// （sticky 只在浮层自己滚动时有意义，这里保留其余，去掉 position）。
			for (const fg of filteredGroups) {
				const rows = fg.items.map((it) => {
					const row = visibleRows.find((r) => r.kind === 'model' && r.model === it.model && r.provider === fg.group.id);
					const selected = props.model === it.model.id && props.provider === fg.group.id;
					return optionRow(
						fg.group.id + '/' + it.model.id, row ? row.__idx : -1,
						String(it.model.name || it.model.id), selected,
						() => choose({ model: it.model.id, provider: fg.group.id }),
					);
				});
				modelRows.push(React.createElement('section', {
					key: 'g:' + fg.group.id, role: 'group', 'aria-label': String(fg.group.name || fg.group.id),
					style: { position: 'relative', marginTop: 3 },
				},
					React.createElement('div', {
						style: {
							padding: '4px 7px 2px', color: 'var(--dsw-alias-label-tertiary, rgba(128,128,128,0.95))',
							fontSize: 11, lineHeight: '16px', fontWeight: 500,
						},
					}, String(fg.group.name || fg.group.id)),
					rows,
				));
			}
			// 空状态。官方区分两句（`empty.models` / `search.empty`）：
			//   · 目录为空 → 「暂无可用模型」（去配置服务商）
			//   · 有目录但没匹配 → 「没有匹配的模型」（改搜索词）
			// 混成一句会让用户看着满屏模型却被告知「暂无可用模型」，无从处置。
			if (!filteredGroups.length) {
				modelRows.push(React.createElement('div', {
					key: '\u0000empty', role: 'status',
					style: {
						color: 'var(--dsw-alias-label-tertiary, rgba(128,128,128,0.95))',
						padding: 8, fontSize: 12, lineHeight: '18px',
					},
				}, activeQuery ? T('panel.autoSearchEmpty') : T('panel.autoModelEmpty')));
			}

			// ── 推理等级 pane ─────────────────────────────────────────────────────────
			// 两组，中间用分组标题隔开（与模型 pane 的服务商分组同一套标题样式）：
			//   通用：跟随会话 / 模型默认 / 模型最低 / 模型最高 —— 相对值，任何模型都成立；
			//   指定：该模型**公布**的具体档位（Low / High / Max …）。
			//
			// 为什么不再「遇到重名就跳过模型档位」：那正是「怎么只有 low 和 high」的成因
			// —— 模型公布的 `max` 被内置的「最高」吞掉，用户看不到 Max 这个名字。
			// 现在两者都列，值用 `@` 前缀区分（见 PG_EFFORT_PIN 处说明）。
			const effortRows = [];
			// 推理等级 pane 没有搜索框，故高亮按「pane 内序号」算（与模型 pane 分开）。
			// ⚠️ 序号必须按**渲染顺序**连续递增 —— 分组标题不占序号（它不可选中），
			// 否则高亮下标与行对不上，键盘 ↑↓ 会跳项。
			const effortList = [];
			const effortOption = (v, label) => {
				const idx = effortList.length;
				effortList.push(v);
				const selected = (props.effort || '') === v;
				return React.createElement('button', {
					key: 'e:' + (v || '\u0000'), type: 'button', role: 'menuitemradio',
					// idx 就是 effortList 的下标：焦点导航按它取节点。
					ref: (el) => { rowRefs.current.effort[idx] = el; },
					'aria-checked': selected,
					// 值本身不显示在界面上，但它是**配置里真正写下去的字符串**。
					// 落在 data 属性上：调试时能直接看到「这一行会存什么」，
					// 也避免测试只能靠标签文字反推值（`模型最高` 与 `Max` 的标签不同、
					// 值也不同，光看标签会以为它们一样）。
					'data-value': v,
					className: 'pg-hoverable'
						+ (highlighted === idx ? ' pg-active' : '')
						+ (selected ? ' pg-selected' : ''),
					style: optionStyle,
					onMouseMove: () => { if (highlighted !== idx) setHighlighted(idx); },
					// 与模型 pane 同：鼠标离开就交还高亮（否则留下「白色印子」）。
					onMouseLeave: onRowLeave,
					onClick: () => choose({ reasoningEffort: v }),
				},
					React.createElement('span', { style: optionCopyStyle },
						React.createElement('span', { style: modelNameStyle }, label)),
					React.createElement('span', { style: checkStyle }, selected ? checkMark() : null),
				);
			};
			// 分组标题：与模型 pane 的 `.heading` 逐项同值（padding / 字号 / 字重 / 颜色），
			// 否则两个 pane 的标题看起来是两种东西。
			const effortGroupHeading = (key, label) => React.createElement('div', {
				key,
				style: {
					padding: '4px 7px 2px', color: 'var(--dsw-alias-label-tertiary, rgba(128,128,128,0.95))',
					fontSize: 11, lineHeight: '16px', fontWeight: 500,
				},
			}, label);
			// 第一组：通用（相对值）。
			// 顺序按**档位强弱由低到高**（最低 → 最高），与「指定」组（模型公布的档位表
			// 本身就是升序：low → high → max）保持同一方向。
			effortRows.push(effortGroupHeading('\u0000gh-common', T('panel.autoEffortGroupCommon')));
			effortRows.push(effortOption(PG_EFFORT_SESSION, T('panel.autoEffortSession')));
			effortRows.push(effortOption('default', T('panel.autoEffortDefault')));
			effortRows.push(effortOption('min', T('panel.autoEffortMin')));
			effortRows.push(effortOption('max', T('panel.autoEffortMax')));
			// 第二组：指定（该模型公布的档位）。
			//
			// ⚠️ **只在配置了具体审批模型时才渲染**（实测反馈「审批模型选择跟随会话的时候，
			// 为啥下面会有选择？」）：跟随会话时模型未定，`shownSel` 用的是**当前这个对话**
			// 正在跑的模型（见上方 fallback），于是「指定」组列出来的是那个模型的档位 ——
			// 换个对话，模型变了、档位表也变了。而「指定」的语义是**钉住一个具体档位 id**
			// （值带 `@` 前缀），钉在一个随对话漂移的模型上没有意义：换到不支持该档位的对话
			// 时，宿主 resolveEffort 会直接报 config-error，表现为「自动审批莫名一直弹窗」。
			//
			// 跟随会话时功能上也没有损失：「模型最高 / 模型最低」是相对值，已经能表达
			// 「要当前模型的最高档 / 最低档」，换任何对话都成立。
			//
			// 模型不公布档位时不渲染这一组 —— 一个只有标题、下面什么都没有的分组
			// 比没有它更让人困惑（用户会以为「加载失败」）。此时提示文案
			// `panel.autoEffortNone` 已经说明了原因。
			if (cur && modelEfforts.length) {
				effortRows.push(effortGroupHeading('\u0000gh-specific', T('panel.autoEffortGroupSpecific')));
				for (const e of modelEfforts) {
					// 值加 `@` 前缀：与通用的符号档（尤其 `max`）在配置里可区分。
					// 不做「重名就跳过」—— 那会让用户看不到模型真实公布的档位名。
					effortRows.push(effortOption(PG_EFFORT_PIN + e.id, String(e.name || e.id)));
				}
			}

			// ── 焦点进出浮层 ─────────────────────────────────────────────────────────
			// 浮层是 portal 到 body 末尾的，trigger 在设置面板里。不搬焦点的话，键盘用户
			// 点开之后焦点仍在 trigger 上：↑↓ 没有反应、Enter 又把菜单收起来，要 Tab 穿过
			// 整块设置面板才够得到列表。官方在 drill/close 时同样搬（见 ModelSelect）。
			//
			// 判据只看「pane 变了」：打开 → 搜索框（有搜索时）或当前选中项；
			// 收起 → 还给被点的那一行（点浮层外面关掉的除外，那时用户已点去别处）。
			React.useEffect(() => {
				const prev = prevPaneRef.current;
				prevPaneRef.current = pane;
				if (prev === pane) return;
				if (pane === 'root') {
					if (skipRestoreRef.current) { skipRestoreRef.current = false; return; }
					const back = anchorRefs.current[prev];
					if (back && typeof back.focus === 'function') back.focus();
					return;
				}
				// 两个 pane 的下标空间不同：模型 pane 用 navIndex（已回退到选中项或
				// 第一个模型行；一个模型都没有时是 -1，此时退到浮层容器），推理等级
				// pane 用「当前档位在 effortList 里的下标」。
				let target = null;
				if (pane === 'model') {
					if (showSearch) target = searchRef.current;
					else target = rowRefs.current.model[navIndex];
				} else {
					// 配置的档位不在当前列表里（换了模型 / 指定档位失效）时**不**回退到 0 号：
					// 焦点自动停上去再按回车就替用户改了配置。与模型 pane 的 navIndex
					// 同一条纪律：没有对应项就把焦点交给浮层容器，由 ↑↓ 进入列表。
					const at = effortList.indexOf(props.effort || '');
					if (at >= 0) target = rowRefs.current.effort[at];
				}
				if (!target) target = menuRef.current;
				if (target && typeof target.focus === 'function') target.focus();
			}, [pane]);
			// ── 浮层内的键盘导航（列表行）─────────────────────────────────────────────
			// 搜索框有自己的 onKeyDown（它还要处理输入）；这里管的是焦点落在某个
			// menuitemradio 上的情况 —— 打开浮层时焦点就被送进去，之后 ↑↓ 要能在
			// 列表里走、Enter 要能选中。推理等级 pane 没有搜索框，它的键盘操作
			// **只有**这一条。
			//
			// 高亮与焦点是同一件事：按键改高亮后把焦点一起搬过去，否则读屏器读的
			// 仍是旧行（高亮只是底色，不是可访问性状态）。
			const menuKeyDown = (e) => {
				// 浮层没打开时这里只是冒泡路径上的普通容器（trigger 的按键也经过它），
				// 不接管任何键 —— 否则「Escape 关浮层」会在浮层没开时把设置页的
				// Escape 一起吃掉。
				if (!open) return;
				// 搜索框的按键由它自己处理，事件会冒泡到这里 —— 不排除就会选两次。
				if (e.target === searchRef.current) return;
				// ── Escape 必须在这里先消费，且判据**不看焦点落在哪一行** ──────────────
				// 浮层是 portal 到 body 的，设置面板的模态层（useModalLayer）在 document 上
				// 同样监听 Escape，判据只有 `ev.defaultPrevented` —— 这里不拦下，按 Escape
				// 关浮层会连着把整个设置页关掉，面板里未提交的数字输入、例外编辑态、原因草稿
				// 随 Panel 卸载一起丢。焦点可能落在行上、搜索框的清除按钮上，或（目录为空时）
				// 浮层容器本身（见「焦点进出浮层」），三条路都必须能只关浮层。
				if (e.key === 'Escape') { e.preventDefault(); close(); return; }
				const rows = pane === 'model' ? visibleRows : effortList;
				if (!rows.length) return;
				// 焦点不在任何一行上（例如搜索框的清除按钮）时，↑↓ 不接管。
				const at = rowRefs.current[pane].indexOf(e.target);
				if (at < 0) {
					// 例外：焦点落在浮层容器本身（见「焦点进出浮层」——目录为空或选中项
					// 不在列表里时 navIndex 为 -1，没有可聚焦的行）。此时 ↑↓ 从这里进入
					// 列表，否则焦点进得来却动不了，键盘用户仍只能用鼠标。
					// Enter 仍不接管：焦点还没落在任何一行上，选中必须由用户先走到那一行。
					if (e.target !== menuRef.current) return;
					if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
					e.preventDefault();
					// 进入列表的落点必须跳过「跟随会话」（模型 pane 的 0 号、推理等级 pane 的
					// `PG_EFFORT_SESSION`）：那是一个**改变现有配置**的动作，不能作为焦点自动
					// 进入列表的第一站 —— 用户只是想把键盘挪进列表，不该在第一下按键后就把
					// 配置交出去。与 navIndex 的回退目标同一条纪律（见「高亮与选中是两个独立信号」）。
					const entry = pane === 'model'
						? rows.findIndex((r) => r.kind === 'model')
						: rows.findIndex((v) => v !== PG_EFFORT_SESSION);
					if (entry < 0) return;
					const next = e.key === 'ArrowDown' ? entry : rows.length - 1;
					setHighlighted(next);
					const el = rowRefs.current[pane][next];
					if (el && typeof el.focus === 'function') el.focus();
					return;
				}
				if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
					e.preventDefault();
					const next = (at + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
					setHighlighted(next);
					const el = rowRefs.current[pane][next];
					if (el && typeof el.focus === 'function') el.focus();
					return;
				}
				if (e.key !== 'Enter') return;
				const row = rows[at];
				if (!row) return;
				e.preventDefault();
				if (pane === 'model') {
					if (row.kind === 'follow') choose({ model: null, provider: null });
					else choose({ model: row.model.id, provider: row.provider });
				} else {
					choose({ reasoningEffort: row });
				}
			};

			// ── 键盘与失焦的作用域 = 整个 picker（trigger + 浮层）─────────────────────
			// 这两件事必须覆盖同一棵树。只挂 menu 时，焦点退到 trigger（它在 pickerRoot
			// 里、不在 menu 的 React 子树里）就出现缺口：onBlur 判「内部」时认 pickerRoot
			// 不关浮层，而键盘处理不在事件路径上。此时按 Escape，document 级监听只
			// setPane('root') 且不 preventDefault —— 设置页模态层（判据只有
			// ev.defaultPrevented）随即把整个设置页关掉，未提交的数字输入、例外编辑态、
			// 原因草稿随 Panel 卸载一起丢。
			//
			// 故两者都挂 pickerRoot：menu 是它的 React 子节点（portal 到 body，事件仍按
			// React 树冒泡上来），覆盖范围与 onBlur 判「内部」的范围一致。官方的
			// onKeyDown 同样挂在包含 trigger 的 root 上（ModelSelect）。
			const onPickerBlur = (ev) => {
				// 浮层没开时不接管失焦：否则焦点在 trigger 与背景之间移动会把
				// skipRestoreRef 置脏，下一次关闭浮层就不再还焦点。
				if (!open) return;
				const t = ev.relatedTarget;
				const inside = (el) => !!(el && typeof el.contains === 'function' && t && el.contains(t));
				if (inside(menuRef.current) || inside(pickerRootRef.current)) return;
				skipRestoreRef.current = true;
				setPane('root');
			};

			// ── 浮层本体 ──────────────────────────────────────────────────────────────
			// portal 到 document.body：设置面板是 overflow:auto 的窄栏，
			// 浮层留在里面会被裁掉（也压不出阴影）。这与官方 createPortal 的理由相同。
			//
			// 搜索框留在滚动容器外（官方 .searchRow 是 .menu 的直接子项、flex-shrink:0），
			// 列表单独包一层：`menuStyle` 的 overflow:hidden 只负责圆角裁剪，
			// 滚动的责任在 listStyle 那一层。
			// menuitemradio 的 required context 是 menu（或 menu 里的 group）。
			// 这个 role 只能落在**列表**上：外层容器还装着搜索框，把搜索框塞进
			// menu 会让读屏器把它当成一个无法归类的菜单子项。官方的层级同样是
			// menuSurface[role=group] > [searchRow, groups[role=menu]]。
			const list = React.createElement('div', {
				ref: listRef, role: 'menu',
				'aria-label': pane === 'model' ? T('panel.autoModel') : T('panel.autoEffort'),
				style: listStyle,
			}, pane === 'model' ? modelRows : effortRows);
			const menu = React.createElement('div', {
				ref: menuRef, role: 'group',
				'aria-label': T('panel.autoPickerAria'), 'aria-busy': false,
				// 兜底焦点目标（见上方「焦点进出浮层」）：目录为空时 navIndex 为 -1、
				// 取不到任何行，焦点要落在这个容器上。没有 tabIndex 的 div 不可聚焦，
				// `focus()` 静默无效 —— 焦点留在 trigger 上，而浮层是 portal 到 body 的
				// 独立树，Tab 永远进不去，键盘用户只能在「打开—关闭」之间循环。
				// tabIndex: -1 = 可编程聚焦但**不**进入 Tab 序列。
				tabIndex: -1,
				style: menuStyle,
				// 键盘不挂在这里：menu 是 pickerRoot 的 React 子节点（portal 到 body，事件
				// 仍按 React 树冒泡），两处都挂会让每个键跑两遍 —— Enter 提交两次、
				// ↑↓ 走两格。只挂 pickerRoot 一处，见下方 onKeyDown。
				// 兜底：鼠标移出**整个浮层**时也清空高亮。
				// 行级的 onMouseLeave 已经覆盖了「行 → 行」与「行 → 空白」，
				// 但万一某个子元素没挂（例如将来加的分隔线），这里保证不会残留。
				onMouseLeave: () => { setHighlighted(null); },
			}, pane === 'model' ? searchRow : null, list);

			return React.createElement('div', {
				// 撑满一行：两行 trigger 各自 width:100%，左边缘才能与卡片里其它行的
				// 标签落在同一条竖线上（父级是卡片，没有 flex 收缩问题）。
				ref: pickerRootRef, style: { position: 'relative', width: '100%', minWidth: 0 },
				// 键盘与失焦都挂在这一层：它是 trigger 与浮层（React 子节点，portal 到 body）
				// 的公共祖先，覆盖范围与 onBlur 判「内部」的范围一致。见 onPickerBlur。
				onKeyDown: menuKeyDown,
				onBlur: onPickerBlur,
			},
				// 两行常显（它们就是官方浮层里的根菜单，只是这里长在面板上）。
				rootPane,
				// 点开哪一行，浮层就锚在哪一行下方 —— anchorRefs 按 key 分开存。
				open
					? (ReactDOM && typeof ReactDOM.createPortal === 'function' && typeof document !== 'undefined'
						? ReactDOM.createPortal(menu, document.body)
						: menu)
					: null,
			);
		}


		function Panel(props) {
			// settings.section 是 root 作用域槽：不直接给 sessionId，但注入 useSessions
			// 标准 hook。用它订阅当前活动会话，会话切换时选择器变化触发重渲染 + 重新查询，
			// 面板始终显示当前会话的项目配置。取会话 id 走 pgCurrentSessionId（兼容 0.1.5
			// 的 SessionListState.current 与 0.1.7 的 retainedBy.mainView）。
			const sessionId = (props && typeof props.useSessions === 'function') ? props.useSessions(pgCurrentSessionId) : undefined;
			const [status, setStatus] = React.useState(null);
			const [busy, setBusy] = React.useState(false);
			const [msg, setMsg] = React.useState('');
			const [tab, setTab] = React.useState('global');
			// auto tab 内部的**层子 Tab**：'global' | 'project'。
			//
			// 为什么需要它：外层 tab 栏的前两个是「层」（全局 / 项目），第三个是「主题」
			// （自动审批）—— 两个轴并排。于是 auto tab 里又得按层分块，用户要配
			// 「本项目的拒绝原因」得先点「自动审批」、再在卡片里找「本项目」，两层定位。
			// 现在 auto tab 内也有一条层切换，每张卡片只服务一个层，卡内不再分块。
			//
			// 与外层 `tab` **完全独立**：它不参与任何 `tab === 'global'` 判断，
			// 也不发给宿主（所有路由的 target 仍由各自的层参数决定）。
			const [autoTab, setAutoTab] = React.useState('global');
			const [cats, setCats] = React.useState({ global: {}, project: {} });
			const [quickSel, setQuickSel] = React.useState({});
			// 快捷工具的拒绝原因：{ [tool]: { g, p } }，与 quickSel 平行但独立编辑
			const [quickReason, setQuickReason] = React.useState({});
			// 分类默认值与兜底的拒绝原因输入框：{ [tab]: { [cat]: '' } } / { [tab]: '' }
			const [catReasons, setCatReasons] = React.useState({ global: {}, project: {} });
			// command 分类的子设置「破坏性命令」：**每层八档**。
			// 形状 { global: { inside: 'allow', wide: 'ask', … }, project: {…} }。
			//
			// 为什么必须逐档而不是一个值：宿主把八档拆开供用户分别配置
			// （`rm -rf ./build` 与 `rm -rf /` 除了都叫 rm 之外没有任何共同点），
			// 面板上就是一个档一个下拉框。用一个值存八档会让「改 A 档」连带改掉 B 档。
			const [subDestructive, setSubDestructive] = React.useState({ global: {}, project: {} });
			// 子设置的拒绝原因草稿：**每层每档一个**（`{ global: { wide: '' }, project: {} }`）。
			// 逐档理由：「删系统目录」与「别提权」是给 AI 的两种不同指令，
			// 合成一句会让 AI 收到无关信息。
			const [subReasons, setSubReasons] = React.useState({ global: {}, project: {} });
			// 「破坏性命令」八档的展开态（默认折叠）。
			//
			// 折叠时**八档全收起**（不是只收起七档）：八个档在判定链上是**平级**的，
			// 单留一档会让它看起来像「主设置 + 七个附属」，而它其实只是八分之一。
			// 折叠态的信息由展开链接文字里的摘要承载（`> 展开（询问 3 · 拒绝 3）`），
			// 要看具体哪一档就展开 —— 与例外列表的取舍完全一致（详见 commandSubRow）。
			// 折叠状态**不持久化**（组件内 state）：它是临时视图状态，不是配置。
			const [subExpanded, setSubExpanded] = React.useState(false);
			// 循环检测（doomloop）的阈值输入框：{ global: '', project: '' }，值为**字符串**
			// （输入框的中间态，如用户清空准备重打）。空串表示「本层未配置」，
			// 由宿主下发的 defaultThreshold 在界面上以 placeholder 呈现 —— 不预填数字，
			// 否则用户分不清「我设过 6」还是「默认就是 6」。
			const [loopTh, setLoopTh] = React.useState({ global: '', project: '' });
			// 阈值草稿的「未保存」标记：{ global: false, project: false }。
			//
			// 为什么需要它：applyStatus 会整表重建 loopTh，而 applyStatus 不只由本面板的 invoke
			// 回调触发，还由 SSE 的 status/refresh 推送触发（宿主在 persist 成功、init、
			// session/event 时都 broadcast）。动作与阈值按设计**分两处提交**（见 doomloopRow 的
			// 注释①），于是「先填阈值 → 再改动作」这个自然顺序必然踩坑：改动作那次 invoke 落盘后
			// 回填 status → 阈值框被重置成服务端值（未配置时为 ''）→ 用户再点「保存」走的是空串
			// 分支，把阈值清成 inherit 并提示「已恢复为默认」，而不是保存他刚填的数字。
			//
			// 判据是「本层有未保存的草稿」而不是「本格正在聚焦」：点「保存」按钮前必然先 blur，
			// 用焦点判据会在 blur 那一刻就失效（reason 那套 reasonFocus 之所以能用焦点判据，
			// 是因为它的输入框靠回车/blur 提交，而这里的提交按钮独立于输入框）。
			const loopThDirty = React.useRef({ global: false, project: false });
			const [fbReason, setFbReason] = React.useState({ global: '', project: '' });
			// 拒绝原因刚保存成功的那一格：{ key: 'kind:tab:key', seq }，显示短暂的对勾反馈。
			const [reasonSaved, setReasonSaved] = React.useState(null);
			React.useEffect(() => {
				if (!reasonSaved) return undefined;
				const id = setTimeout(() => setReasonSaved(null), 1800);
				return () => clearTimeout(id);
			}, [reasonSaved]);
			// 正在编辑中的拒绝原因格（'kind:tab:key'）：非编辑态一律只读展示，避免「看起来能打字、
			// 但不知道什么时候生效」——只读值 + 明确的「编辑 / 保存」按钮才是可预期的交互。
			const [reasonEditing, setReasonEditing] = React.useState(null);
			// 焦点描述 → 稳定字符串键，用于比对「这一格是否在编辑 / 是否刚保存」。
			//
			// ── `sub` 的 key 必须带档位 ───────────────────────────────────────────
			// 八档各占一个编辑态：`focus.key` 就是**档位名**（`inside` / `wide` / `priv`…），
			// 于是 key 天然唯一；调用方负责把档位传进 focus.key（见 commandSubRow）。
			const reasonKeyOf = (f) => (f ? f.kind + ':' + f.tab + ':' + (f.key === null || f.key === undefined ? '' : f.key) : '');
			// 对勾的写入单点。刻意定义在 reasonKeyOf 之后：它体内要调 reasonKeyOf，
			// 若写在前面就只能靠「箭头函数体延迟求值」侥幸不报 TDZ，属隐性顺序依赖。
			// 带 seq 是为了「同一格连续保存两次」也能产生新的 state 身份：若只存稳定字符串键，
			// 第二次 setState 与当前值相同，React 会 bail out、不重跑上面的 effect，
			// 旧定时器既不清理也不重新计时，对勾会按第一次保存的时间点提前消失。
			const reasonSavedSeq = React.useRef(0);
			const markReasonSaved = (f) => { reasonSavedSeq.current += 1; setReasonSaved({ key: reasonKeyOf(f), seq: reasonSavedSeq.current }); };
			const [exVals, setExVals] = React.useState({ command: '', outsideRead: '', directory: '', read: '', edit: '' });
			// 例外添加行的动作与文字也必须**按分类**存，不能是全局单值：
			// 每个分类各有一行添加控件，共用一份状态时在任一分类选「拒绝」或输入原因，
			// 其余分类的添加行会一起联动（值被同步改写），用户看到的就是「一改全变」。
			// 键为分类名，取值 { action, reason, note }：
			//   reason —— deny 例外用，拒绝时回给 AI；
			//   note   —— ask 例外用，命中时显示在审批弹窗上供日后回看。
			// 两者不可互换（详见 addException 处的说明）。
			const [exForm, setExForm] = React.useState({});
			// 默认值单点：exOf 与 setExField 各写一份同样的字面量时，两处一旦漂移（例如只把
			// setExField 那份的 action 改成 ask），点「添加」会先按 exOf 的 allow 落盘、紧接着
			// 下拉跳成 ask，界面显示与刚写入的权限动作分叉，且回归断言覆盖不到该分支。
			// 用工厂函数而非共享常量：未设置过的分类必须各拿到**独立对象**，共享引用会让改一处连带改另一处。
			// #region ex-form-state —— 例外添加行的取值/写入单点。test/regressions.mjs 按这对标记
			// 抠出下面三行做行为复算（按分类改一处、别处不得被连带改写；两处默认值必须同源）。
			// 改动请保持在区块内：标记被删或代码移出区块，该测试会直接报出可读的失败。
			const exDefault = () => ({ action: 'allow', reason: '', note: '', autoFallback: 'ask' });
			const exOf = (c) => exForm[c] || exDefault();
			const setExField = (c, patch) => setExForm((prev) => Object.assign({}, prev, { [c]: Object.assign({}, prev[c] || exDefault(), patch) }));
			// #endregion ex-form-state

			// ── 例外行的就地编辑态 ──────────────────────────────────────────────
			//
			// `exEdit` 是**正在编辑的那一条的 id**（null = 没有），`exDraft` 是它的草稿。
			// 一次只允许编辑一条：例外行的编辑态是「整行变成输入框」，同时开两条会让
			// 列表里出现两行高矮不一的输入框，且「保存」按钮属于哪一行变得含糊。
			//
			// 草稿**只装模式**（`value`）：原因/备注走 reasonInput（与其余四处同一个组件），
			// 由 exReason 那份草稿承载，不进这个编辑态（见 commitExReason 的说明）。
			//
			// **value 是 match/path 的统称**：命令分类存 `match`、其余分类存 `path`，
			// 面板不该让用户知道这个区别（他在哪一栏里打字是一样的），故草稿与请求都用
			// 中性名 `value`，由宿主按分类落到正确的键上（见 setExceptionEntry）。
			const [exEdit, setExEdit] = React.useState(null);
			const [exDraft, setExDraft] = React.useState({ value: '' });
			// 例外行的原因/备注草稿：`{ [例外 id]: '文字' }`。
			//
			// 与 catReasons / subReasons / quickReason / fbReason 同一个角色（各格一份草稿），
			// 键用例外 id 而不是「分类+id」：id 在一层内唯一，且 reasonInput 的 focus.key
			// 就是它（见 reasonKeyOf）。
			const [exReason, setExReason] = React.useState({});
			const [newTool, setNewTool] = React.useState('');
			const [newToolAction, setNewToolAction] = React.useState('allow');
			// 新增快捷工具行的拒绝原因：与例外的新增行同构（选「拒绝」才出现输入框），
			// 否则用户为新增行选了拒绝却无处填写原因，只能先添加、再到该行上补填。
			const [newToolReason, setNewToolReason] = React.useState('');
			// 新增快捷工具行的回落值：与已存在行同构（仅动作是 auto 时出现）。
			const [newToolAutoFallback, setNewToolAutoFallback] = React.useState('ask');
			const [form, setForm] = React.useState({ action: 'deny', tool: '', path: '', args: '', reason: '' });
			// 新增规则行的回落值：规则动作现在也能选 auto（与快捷工具新增行同构）。
			const [newRuleAutoFallback, setNewRuleAutoFallback] = React.useState('ask');
			const [confirm, setConfirm] = React.useState(null);
			// 一次性提示（非阻塞）：目前用于「大分类与破坏性子设置的严格度不一致」。
			// 存纯字符串而非对象：原先带过 { key, text }，但 key 全仓无人读取
			// （自动消失靠 effect 的对象身份，去重逻辑从未实现），属只写不读的死字段，故删掉。
			// 与 msg（保存结果，蓝色）分开，提示用橙色以示「需要注意但不是错误」。
			const [notice, setNotice] = React.useState(null);
			// 模型目录（模型 / 推理等级选择器的数据源）。
			//
			// 形状见宿主 `/permgate/llm-models`：{ groups: [{id,name,models[]}], failures[] }。
			// 只在面板打开时取一次 —— 目录与「用户配了什么」无关（见下面 effect 处的说明）。
			// 不放进 statusView：那条路由会走网络（每个 provider 一次 listModels + 每个
			// 模型一次 resolveModelInfo），不能挂在每次状态刷新上。
			const [llmCat, setLlmCat] = React.useState({ data: null, loading: false });
			// ── 额外审批策略的编辑态（**必须在组件层，不能写进卡片里**）────────────
			//
			// hook 写在 `autoReviewCard` 里会随 tab 切换改变 hook 数量，React 抛 #310
			// （Rendered more hooks than during the previous render）→ 整页白屏。
			// 卡片是普通函数、不是组件，它每次渲染都被调用一次，而它只在 auto tab 被调用。
			//
			// 两个 textarea 是**受控**的（长文本靠 key 重挂载会丢焦点，而编辑策略时
			// 中途失焦极常见）；四个下拉的值即提交值。
			const [policyGlobal, setPolicyGlobal] = React.useState('');
			const [policyProject, setPolicyProject] = React.useState('');
			const [policyMode, setPolicyMode] = React.useState('inherit');
			// 两个维度 × 两层，四个下拉各自一份状态（**不能合成一个**：卡片上下排，
			// 全局与项目同时可见，合成一份会让改全局时把项目的选择一起改掉）。
			//
			// 全局层的取值是**全局层单独的生效值**（本层显式值 → 宿主下发的默认值）：面板直接
			// 显示「这种情况现在会怎样」，不额外标注「默认」。**不得**用 effectiveHighRisk*
			// ——那是项目优先的，会把项目层的值显示成全局的（见 applyStatus 处的说明）。
			// 项目层的取值是**本层显式值**，缺键显示「继承全局」。
			const [policyHighRisk, setPolicyHighRisk] = React.useState('ask');
			const [policyHighRiskTimeout, setPolicyHighRiskTimeout] = React.useState('deny');
			const [policyProjectHighRisk, setPolicyProjectHighRisk] = React.useState('inherit');
			const [policyProjectHighRiskTimeout, setPolicyProjectHighRiskTimeout] = React.useState('inherit');
			// 拒绝时回给模型的那句话：两层各一对（模式 + 自定义文本）。
			//
			// 文本与模式分开存：切到 `default` 时**不清空**文本框里的内容 —— 用户切回来
			// 时那句话应该还在（宿主侧同样不删键，见 normalizeAutoReview 的注释）。
			// 把两者合成一个对象会让「草稿」与「已保存的模式」混在同一个 state 里，
			// 每次提交都得整体重建，而中间态（模式已改、文本未提交）无法表达。
			const [policyDenyMode, setPolicyDenyMode] = React.useState('default');
			const [policyDenyText, setPolicyDenyText] = React.useState('');
			const [policyProjectDenyMode, setPolicyProjectDenyMode] = React.useState('inherit');
			const [policyProjectDenyText, setPolicyProjectDenyText] = React.useState('');
			// 未保存草稿标记：`{ global: false, project: false }`，与 loopThDirty 同构。
			//
			// 为什么是「脏标记」而不是「焦点标记」：这一格用**保存按钮**而非 onBlur 提交
			// （长文本编辑中途失焦极常见），故失焦不代表放弃草稿。用焦点标记的话，
			// 用户点一下别处再回来，一次 SSE status 推送就会把他正在写的文字冲掉。
			//
			// 为什么按层各一格而不是一个单值：两个 textarea 同屏常显（项目层 mode 为
			// append/replace 时都可见），单值标记只能保住最后编辑的那一格 —— 先编全局
			// 再编项目、点项目「保存」时，全局草稿会在那次 applyStatus 里被服务端值覆盖。
			// 每格由 savePolicy 在**保存本层策略文本**后单独清空，此后服务端值才会回填。
			const policyDirty = React.useRef({ global: false, project: false });
			// 自定义拒绝原因的草稿标记，与 policyDirty **分成两份**：
			// 两者的清除时机不同（policyDirty 由「保存策略文本」清，这份由「提交自定义原因」清），
			// 合成一份会让一次策略保存顺手把另一格的草稿标记也清掉 —— 紧接着的那次
			// status 推送就会覆盖掉用户还没提交的原因文字。
			const denyDirty = React.useRef({ global: false, project: false });
			const [excCollapsed, setExcCollapsed] = React.useState({});
			// 长列表的过滤词，三处各一份、**按 tab 分开**（与 excCollapsed 同构）：
			//   quick  —— 快捷工具（一份，不分 tab：它是同一份列表，只是取值按层）
			//   exc    —— 例外，按分类分（{ [分类]: '词' }），因为 6 个分类各有一份列表
			//   rule   —— 自定义规则，按 tab 分（全局/项目各一份列表）
			// 按 tab 分开的理由与 excCollapsed 一致：换层后列表内容不同，沿用上一层的过滤词
			// 会让新层看起来「空了一块」，而用户并没有输入过任何东西。
			const [quickFilter, setQuickFilter] = React.useState('');
			const [excFilter, setExcFilter] = React.useState({});
			// 「滚到列表末尾」的标记：每次添加成功后 +1，对应的 effect 依赖它。
			// 用计数器而不是布尔：连续添加两次时布尔值不变（true→true），effect 不会重跑，
			// 第二次添加就不会滚 —— 而那正是用户最需要看到新条目的时候。
			//
			// 快捷工具的计数器不按分类分（它只有一个列表）；例外那个按分类分，
			// 理由见 excScrollRefs 处的说明（多个分类默认同时展开，共用一个 ref 会滚错列表）。
			const [quickScrollEnd, setQuickScrollEnd] = React.useState(0);
			// 「最近决策」的展开态：null = 未展开（显示 statusView 带来的首屏 10 条）；
			// { list } = 已展开（list 是 /permgate/decisions 取回的全量**快照**）；
			// 'loading' / { error } 是两个中间/失败态，都仍显示首屏那 10 条，不把面板清空。
			//
			// 为什么展开要**另取一份**而不是让 statusView 直接发全量：statusView 会被面板
			// 反复取（SSE 通知后重查、各写盘路由回带、perm_status 每次调用），把 100 条记录
			// 塞进去等于给每一次都加约 30KB。展开是低频的用户动作，按需取一次即可。
			//
			// ⚠️ 展开后**不自动刷新**：list 是点击那一刻的快照，展开期间新发生的决策不在其中
			// （面板其余部分照常随 SSE 更新，只有这块不动）。刷新方式就是**收起再展开** ——
			// 收起丢弃快照、下次展开重新取。不做「按 decisionCount 变化自动重拉」：宿主没有
			// 定向通知，那样等于 AI 连续调工具时持续拉取数十 KB 全量，代价大于收益。
			const [decisionsExpanded, setDecisionsExpanded] = React.useState(null);
			const [ruleFilter, setRuleFilter] = React.useState({ global: '', project: '' });
			// 拖动排序的当前状态：{ id, overId, pos } 或 null（没在拖）。
			// **只存这一份、两个列表共用**：同一时刻只可能拖着一行，而规则与例外的 id 前缀
			// 不同（r… / e…），跨列表相撞的概率可忽略；即便真撞上，效果也只是另一列表里
			// 恰好同 id 的那行跟着半透明一下，不会写错盘（落盘的 id 来自被拖的那一行）。
			// 分开存两份的代价更大：得在两处各写一遍 onDrag 的取值逻辑，且拖动结束的清理
			// 要写两遍 —— 漏一处就是「落点指示永远留在屏幕上」。
			//
			// 状态放在组件里而不是 listBox 内部，原因见 listBox 的参数说明（例外列表在条件
			// 分支里，hook 数量不能随折叠状态变化）。
			const [sortDrag, setSortDrag] = React.useState(null);
			// 当前正在编辑（尚未保存）的拒绝原因格：{ kind: 'cat'|'quick'|'fb', tab, key }。
			// applyStatus 每次都会用服务端值整表重建上面三份 reason state，而 applyStatus 不只由
			// 面板自身的 invoke 回调触发，还由 SSE 的 status/refresh 事件触发——宿主在 init()、
			// 配置重载、会话事件时都会 broadcast status（原先 AI 侧的 perm_* 写工具也是一路触发源，
			// 那批工具已整体移除）。若不保留草稿，
			// 用户「已输入但还没点保存」的文字会被后台推送静默清空。
			const reasonFocus = React.useRef(null);

			React.useEffect(() => {
				if (confirm === null) return undefined;
				const id = setTimeout(() => setConfirm(null), 4000);
				return () => clearTimeout(id);
			}, [confirm]);

			// 提示自动消失：给足阅读时间（比删除确认长），换 tab 时也清掉 —— 提示说的是
			// 「某一层的大分类与子设置不一致」，换层后它指向的对象已不在渲染中。
			React.useEffect(() => {
				if (notice === null) return undefined;
				const id = setTimeout(() => setNotice(null), 8000);
				return () => clearTimeout(id);
			}, [notice]);

			// 「添加成功后滚到列表末尾」的 ref 与 effect。
			//
			// **必须放在组件这一层，不能放进 listBox 或 catBlock**：那两个都是普通函数，
			// 而例外列表的 listBox 调用位于「展开/折叠」的条件分支里 —— 在分支内调 hook
			// 会让 hook 数量随折叠状态变化，React 抛「Rendered more hooks than during the
			// previous render」。组件层的 hook 数量恒定，与任何条件分支无关。
			//
			// 两个 ref 分别对应「快捷工具」与「例外列表」。快捷工具只有一个列表，故一个 ref 够；
			// 例外必须**按分类各持一个**（见下）。
			//
			// ── 为什么例外不能只用一个 ref ─────────────────────────────────────────
			// 这里曾经断言「同一时刻只有一个分类的列表被展开（折叠状态下 listBox 根本不渲染），
			// 故一个 ref 就够」—— 该前提**不成立**：折叠状态按分类独立存（excCollapsed[c]），
			// 默认折叠判据是 `excList.length > EXC_COLLAPSE_THRESHOLD`（=6），而例外分类有 7 个，
			// 于是「多个分类同时展开」是**默认态**而不是边缘情况。
			//
			// 后果（实测复现）：CATS.map(catBlock) 会同时渲染多个 listBox，它们把**同一个** ref
			// 挂到各自的滚动容器上；React 中同一 ref 被多元素共用时按挂载顺序依次赋值，
			// current 最终只指向**最后挂载**的那个。于是用户在靠前的分类（outsideRead/command）
			// 添加例外后，effect 滚的是**别的分类**的列表 —— 自己刚加的那条仍在视口外，
			// 而另一个无关列表被莫名拽到底部。这正是本次改动（push 到末尾 + 滚到底）要消除的症状。
			//
			// 用「按分类存 DOM 元素的 map」而不是「每个分类一个 useRef」：后者要按分类数调 hook，
			// 而分类清单由宿主下发、长度不固定，hook 数量不能依赖它。
			const quickScrollRef = React.useRef(null);
			const excScrollRefs = React.useRef({});
			// 本次添加的分类：计数器与分类一起存（{ c, n }），effect 才知道该滚哪一个列表。
			// 只存计数器的话，effect 无从得知「这次是哪个分类加的」，仍会退回「滚最后一个」。
			const [excScrollEnd, setExcScrollEnd] = React.useState({ c: null, n: 0 });
			// 滚到底：依赖是计数器 —— 只在「添加成功」时 +1，故只有那时才滚。
			// 不依赖条目数：删除条目也会改变条目数，而那时用户正在看被删的位置，
			// 把他拽到底部是反效果。
			React.useEffect(() => {
				const el = quickScrollRef.current;
				if (el && typeof el.scrollTop === 'number') el.scrollTop = el.scrollHeight;
			}, [quickScrollEnd]);
			React.useEffect(() => {
				// 只滚**本次添加的那个分类**的列表（按分类存 ref 的理由见上）。
				// 分类已折叠 / 尚未渲染时取到 undefined，直接空转（不报错、不误滚别的列表）。
				const el = excScrollEnd.c ? excScrollRefs.current[excScrollEnd.c] : null;
				if (el && typeof el.scrollTop === 'number') el.scrollTop = el.scrollHeight;
			}, [excScrollEnd]);

			// 切换全局/项目 tab 时清掉未完成的二次确认：确认的对象是「某一层的某个键」，换层后不能沿用
			// 同一确认态，否则再点会删掉另一层。同时丢弃草稿焦点与编辑态（换层后它们指向的行已不在渲染中，
			// 编辑态若残留，切回来时同一格会莫名其妙还处于可输入状态）。
			// 换层时也清掉规则过滤词（例外/快捷工具的过滤词另有处理：例外按分类存、与层无关，
			// 快捷工具列表内容不分层，故两者都不需要在这里清）。
			// 切层（全局 ↔ 项目）时清掉所有「属于某一层」的临时态：确认框、提示、
			// 编辑态、未保存草稿标记、过滤词。例外行的编辑态（exEdit）也在此列 ——
			// 它按 id 定位，而 id 只在它所属的那一层里有意义，切层后必须丢弃
			// （否则切到项目层时会看到一个 id 相同、内容却是另一条例外的行处于编辑态）。
			React.useEffect(() => { setConfirm(null); setNotice(null); reasonFocus.current = null; setReasonEditing(null); setExEdit(null); loopThDirty.current = { global: false, project: false }; setRuleFilter({ global: '', project: '' }); }, [tab]);

			// ── 模型目录的拉取（**必须在组件这一层**）──────────────────────────────────
			// hook 不能出现在条件分支或按需调用的函数里：组件层的位置与 tab 无关，
			// 否则切 tab 会改变 hook 数量，React 抛 #310，整个设置页白屏。
			//
			// 目录与「用户配了什么」无关：宿主一次拉全部 provider、失败按 provider 隔离，
			// 故这里不传查询键、没有依赖项，只在面板打开时取一次。空配置恰恰是最需要目录的时候。
			React.useEffect(() => {
				let alive = true;
				setLlmCat({ data: null, loading: true });
				// 失败一律**按空目录处理**（宿主侧也这么降级）：面板于是只显示「跟随会话」，
				// 不会出现「加载失败」这种用户无从处置的提示 —— 他能做的只有等或去改配置，
				// 而两者都不需要这条错误信息。故这里**不保留 error 字段**（留一个只写不读的
				// 字段，下一个人会以为它有用）。
				call('permgate:llm-models', {})
					.then((r) => {
						if (!alive) return;
						setLlmCat({ data: r || null, loading: false });
					})
					.catch(() => {
						if (!alive) return;
						setLlmCat({ data: null, loading: false });
					});
				return () => { alive = false; };
			}, []);

			const applyStatus = (s) => {
				if (!s) return;
				applyStatusLists(s);
				setStatus(s);
				const cs = { global: {}, project: {} };
				const crs = { global: {}, project: {} };
				// 每层**全部**例外 id → 动作 的映射（跨分类）：只用于收敛例外行的编辑态
				// （见下面 setExEdit 处的说明）。取全集而不是当前分类的，
				// 是因为编辑态不知道自己属于哪个分类 —— 它只记一个 id。
				// 存**最终动作**而不只是「存在」：stillEditable 要判的是「该格此刻是否仍渲染出
				// 输入框」，而原因/备注格只在最终动作是 deny/ask 时才渲染（allow 两格都没有）。
				// 必须走 finalActionOf 而不是 raw `action`：`auto + 回落 deny` 的原因格同样在渲染，
				// 只存 raw 动作时 auto 一律判 false，编辑态会被一次 status 推送清掉。
				const excActs = { global: {}, project: {} };
				for (const t of ['global', 'project']) {
					const block = s.categories && s.categories[t] ? s.categories[t] : null;
					for (const c of CATS) {
						cs[t][c] = block && block[c] ? block[c].mode : (t === 'project' ? 'inherit' : 'ask');
						crs[t][c] = (block && block[c] && block[c].reason) || '';
					}
					if (block) {
						for (const c of EXC_CATS) {
							const list = block[c] && Array.isArray(block[c].exceptions) ? block[c].exceptions : [];
							for (const r of list) if (r && r.id) excActs[t][r.id] = finalActionOf(r.action, r.autoFallback);
						}
					}
				}
				setCats(cs);
				// 聚焦中的那一行保留本地草稿（见 reasonFocus 注释），但仅限「本行此刻仍渲染出输入框」
				// （即新数据里 mode 仍为 deny）：输入框被卸载时浏览器不保证派发 blur，焦点会残留；
				// 若继续兜住旧值，该行再变回 deny 时会显示、并可能写回陈旧草稿。
				// focusNow 在此快照：updater 由 React 在渲染阶段执行，届时 reasonFocus.current 可能已变。
				// 注意它必须在**下面所有**用到草稿保护的 setState 之前声明（子设置那块也不例外）。
				const focusNow = reasonFocus.current;
				// 子设置「破坏性命令」：**逐档**回填八档的动作与 reason。
				//
				// ── 未配置的档取**宿主下发的生效值**，客户端不得重算推导 ─────────────────
				// 显示值 = 本层**显式配置**（有则用它 —— 用户要看得见自己设过什么）→ 否则
				// 宿主下发的生效值：宿主已把推导算完，其注释明确说「面板直接显示」。
				// **取哪一份生效值按 tab 分派**（项目 → effective、全局 → globalEffectiveProbe），
				// 理由见下方 effOf 处 —— 一句话：effective 是按**当前项目**算的。
				//
				// 客户端**不得**自己算一遍档位缺省值 —— 档位取值只有**一份**实现，在宿主的
				// `destructiveTiers` 里（「项目显式 → 全局显式 → ask」），客户端无从复算：
				// 它既看不到另一层的显式配置全貌，也无法保证与裁决同源。
				// 这里曾经据此写过一段「*Default 是按**本层 mode** 算的、与宿主的两遍解析
				// 是两套规则」的警示（引 `globalDefault` / `projectDefault`）—— 那两个字段
				// 与「按本层 mode 推导」的规则**都已整体删除**（理由见 index.js statusView
				// 的 *Default 段），故现在不存在「第二套规则」可供回落，也不存在分叉。
				//
				// 未配置的档显示的可能是**另一层**的值 —— 那正是「这一档现在归谁管」的答案，
				// 归哪一层可由 `commandSub.effective.source[tier]` 读出（宿主已按档下发 source）。
				// ⚠️ 但**显示值不能由 source 反推**：source 只说是哪一层，值本身仍要按 tab
				// 取该层自己那份生效值 —— 否则就退回下面 effOf 处修掉的那个坑。
				//
				// 档位清单以**宿主下发**为准（`s.commandSub.tiers`），不在这里写死八个名字 ——
				// 日后新增一档时客户端自动跟上，不会因为漏改这里而静默少渲染一个下拉框。
				const SUB_TIERS = (s.commandSub && Array.isArray(s.commandSub.tiers) && s.commandSub.tiers.length)
					? s.commandSub.tiers
					: ['inside', 'outside', 'wide', 'unknown', 'proc', 'power', 'priv', 'reg'];
				// 档位键：`inside` 由老键 `action` 承载（老键义不变），其余七档各有一个同名键。
				// 两个来源的键形状不同（都由宿主决定，不在这里换算）：
				//   · `effective` / `source` 按**档位名**给键（含 `inside`，见 destructiveTiers）
				//   · 本层显式配置里，inside 的键是 `action`
				const tierKeyOf = (t) => (t === 'inside' ? 'action' : t);
				// 未配置档的取值来源**按 tab 分派** —— 与下方 doomloop 阈值行的 `defN`
				// 是同一条纪律（那里写着「全局 tab 不能用 effective」）：
				//   · 项目 tab → `effective`：它按**当前项目**算，项目层下面没有别的层，
				//     这正是「本层未配置时实际会用的值」；
				//   · 全局 tab → `globalEffectiveProbe`：全局层单独解析的生效值（宿主下发）。
				//
				// ── 全局 tab 为什么不能用 effective（修一条实打实的缺陷）──────────────────
				// `effective` 是 `destructiveTiers(root)`，其 `explicitOf` **项目优先** ——
				// 拿它回填全局 tab，就会把**项目层显式配置的值**显示成全局层的值。
				// 实测（全局层从未配置、当前项目只设了 `wide:'deny'`）：全局 tab 的 wide
				// 显示成「拒绝」，而全局层真实值是 ask/未表态。两条后果：
				//   ① **面板说谎**：用户在项目 tab 设 wide=拒绝、切到全局 tab 看到 wide=拒绝，
				//      会以为「全局已保护」；删掉项目配置或换个项目后保护**静默消失**。
				//      折叠摘要 subCollapsedSummary（读 subDestructive[tab]）也按被污染的值
				//      统计，于是全局 tab 会显示「拒绝 1 · 询问 7」。
				//   ② **可写错层（更严重）**：该行既然显示 deny 就渲染出「编辑原因」按钮
				//      （showReason = action === 'deny'），用户补一句理由时 `cur` 是空串，
				//      commitSubReason 便以 target:'global' + action:'deny' 提交 ——
				//      在全局层**凭空写入 wide=deny**、影响所有项目，而用户只是在一个
				//      看起来「本来就是拒绝」的行上补了句理由。
				//
				// 探针值必须由宿主用**同一个** destructiveTiers 求（即 globalEffectiveProbe）——
				// 这正是 `commandSub` 下发该字段的全部理由。这里曾经写过一个**看似可回落**的
				// 替代品 `globalDefault`（按本层 mode 推导的档位缺省表）：它与裁决是两套规则，
				// 存量 `{action:'deny'}` + mode=allow 时它给出 inside=allow、其余七档=ask，
				// 而全局层单独生效值是 inside=deny、其余七档=ask —— 拿它回填等于把「面板说谎」
				// 换个形态复制一遍（方向还相反：显示 allow、实际 deny）。
				// ⚠️ 那个字段已随那套规则一起**删除**（理由见 index.js statusView 的 *Default 段），
				// 故此处**没有**可回落的第二来源：探针缺失时只能按下面的兜底走。
				const effOf = {
					global: (s.commandSub && s.commandSub.globalEffectiveProbe) || null,
					project: (s.commandSub && s.commandSub.effective) || null,
				};
				const subNext = { global: {}, project: {} };
				const subReasonNext = { global: {}, project: {} };
				for (const t of ['global', 'project']) {
					const cs = (s.commandSub && s.commandSub[t]) || null;
					// 老配置的 `reason` 字符串（语义 = 整个破坏性类别）由**宿主**在读取侧
					// 归入 `reasons.inside`（explicitReasonsOf）—— 客户端不重做这件事：
					// 归一逻辑只有一份，两处各写一遍必然漂移，而漂移的后果是面板显示的理由
					// 与实际裁决带着的理由不一致。
					const cReasons = (s.commandSub && s.commandSub[t === 'global' ? 'globalReasons' : 'projectReasons']) || null;
					const eff = effOf[t];
					for (const tier of SUB_TIERS) {
						const k = tierKeyOf(tier);
						// ── 本层未显式设置的档显示什么：两个 tab **有意不同** ──────────────
						//
						// 项目 tab → `inherit`（继承全局）。
						// 全局 tab → 该档的**生效值**（宿主下发，未设置时是 ask）。
						//
						// 依据是判定链本身：`destructiveTiers` 的 `explicitOf` 是
						// 「项目显式 → 全局显式 → ask」，项目层下面还有全局层可继承，全局层
						// 下面没有了。故项目 tab 的「继承全局」是**字面属实**的陈述
						// （显示它 = 裁决确实会去取全局那一档），而全局 tab 显示 inherit
						// 则无处可继承 —— 那里必须显示一个具体动作。
						//
						// 这与面板其余各处（分类默认值、快捷工具、兜底）**完全同构**：
						// 项目 tab 未表态即 `inherit`，全局 tab 未表态即具体默认值。
						// 八档曾经是唯一的例外 —— 它们由宿主按本层 mode 推导后下发，于是
						// 项目 tab 显示的是推导值而不是 `inherit`，而 `inside` 档又因为走
						// 另一条取值路径显示 `inherit`，同一状态两种画法（实测反馈的错位）。
						// 宿主改为八档一律「项目显式 → 全局显式 → ask」后，这里随之统一。
						//
						// ⚠️ 项目 tab 不再回落到 `eff`（生效值）：那会把「继承全局」显示成
						// 全局的当前值，用户改全局时本 tab 跟着变，看起来像项目自己设过。
						subNext[t][tier] = (cs && cs[k]) || (t === 'project' ? 'inherit' : ((eff && eff[tier]) || 'ask'));
						subReasonNext[t][tier] = (cReasons && cReasons[tier]) || '';
					}
				}
				setSubDestructive(subNext);
				// doomloop 阈值：只回填**本层显式配置**（null → 空串 = 未配置，界面显示 placeholder）。
				// 不回填 effective/defaultThreshold —— 那会让「未配置」看起来像「已设为默认值」，
				// 与上面 subNext 的口径一致（生效值只在阈值行的 placeholder 里给，
				// 不混进本层输入框的值 —— 那会让「未配置」看起来像「已设为该值」）。
				// 有**未保存草稿**的那一层保留本地值（见 loopThDirty 的说明）：否则后台 status
				// 推送会清空用户刚填的数字，再点保存就变成「清除阈值」。
				const thNext = {
					global: (s.doomloop && typeof s.doomloop.global === 'number') ? String(s.doomloop.global) : '',
					project: (s.doomloop && typeof s.doomloop.project === 'number') ? String(s.doomloop.project) : '',
				};
				setLoopTh((prev) => {
					if (!prev) return thNext;
					const keep = {};
					for (const t of ['global', 'project']) {
						if (loopThDirty.current[t]) keep[t] = prev[t];
					}
					return Object.assign({}, thNext, keep);
				});
				setSubReasons((prev) => {
					// 聚焦中的那一格保留本地草稿（见 reasonFocus 注释），但仅限「该档此刻仍渲染出输入框」
					// （即新数据里**该档**最终仍会拒绝）。八档各自独立 —— 用整层的值判会让
					// 「wide 是 deny、inside 是 ask」时 inside 的框也进入编辑态。
					//
					// 判据必须是 finalActionOf（与 subTierRow 的 showReason 逐字同源）：
					// 写 `=== 'deny'` 时 `auto + 回落 deny` 那一档的草稿会被这次回填**丢掉**，
					// 而它的框明明还渲染着（用户正在打字，字却消失了）。
					const keepOk = (tb, tier) => {
						const a = (subNext[tb] || {})[tier]
						return finalActionOf(a, subAutoFallbackOf(tier, s, tb)) === 'deny'
					}
					if (focusNow && focusNow.kind === 'sub' && prev && prev[focusNow.tab]
						&& subNext[focusNow.tab] && keepOk(focusNow.tab, focusNow.key)) {
						return Object.assign({}, subReasonNext, {
							[focusNow.tab]: Object.assign({}, subReasonNext[focusNow.tab], { [focusNow.key]: prev[focusNow.tab][focusNow.key] }),
						});
					}
					return subReasonNext;
				});
				setCatReasons((prev) => {
					// 判据同 keepOk：必须按**最终动作**（与 catBlock 的 showReason 同源）——
					// `auto + 回落 deny` 那一格的理由框仍在渲染，按 raw `=== 'deny'` 判会把它
					// 正在打的草稿丢掉。
					if (focusNow && focusNow.kind === 'cat' && prev && prev[focusNow.tab]
						&& cs[focusNow.tab] && finalActionOf(cs[focusNow.tab][focusNow.key], catAutoFallbackOf(focusNow.key, s, focusNow.tab)) === 'deny') {
						return Object.assign({}, crs, { [focusNow.tab]: Object.assign({}, crs[focusNow.tab], { [focusNow.key]: prev[focusNow.tab][focusNow.key] }) });
					}
					return crs;
				});
				const fbNext = {
					global: (s.fallback && s.fallback.globalReason) || '',
					project: (s.fallback && s.fallback.projectReason) || '',
				};
				// 兜底输入框的可见性取决于该层 fallbackMode 是否为 deny（与渲染处的 fbVal 同源）；
				// 注意不能用 fbNext（那是原因文本）与 'deny' 比较。
				const fbShow = {
					global: (s.fallback && s.fallback.global) || 'ask',
					project: (s.fallback && s.fallback.project) || 'inherit',
				};
				setFbReason((prev) => {
					// 同 keepOk：按**最终动作**判（与 fbShowReason 同源），`auto + 回落 deny`
					// 那一格的草稿同样要保住。
					if (focusNow && focusNow.kind === 'fb' && prev && finalActionOf(fbShow[focusNow.tab], fbAutoFallbackOf(s, focusNow.tab)) === 'deny') {
						return Object.assign({}, fbNext, { [focusNow.tab]: prev[focusNow.tab] });
					}
					return fbNext;
				});
				const qs = {};
				const gq = s.quickTools ? s.quickTools.global : {};
				const pq = s.quickTools ? s.quickTools.project : {};
				// 会话兜底只作最后一级（预设之外、且未配置的工具）；宿主 statusView 恒下发合法的
				// fallback.effective，下面的 `|| 'ask'` 只是协议异常兜底，不是决策链的一环。
				QUICK_FALLBACK = (s.fallback && s.fallback.effective) || 'ask';
				const names = {};
				for (const t of QUICK_PRESET) names[t] = 1;
				for (const k of Object.keys(gq)) names[k] = 1;
				for (const k of Object.keys(pq)) names[k] = 1;
				for (const t of Object.keys(names)) {
					qs[t] = { g: quickGlobalValue(t, gq), p: hasOwnKey(pq, t) && quickMode(pq[t]) !== 'inherit' ? quickMode(pq[t]) : 'inherit' };
				}
				setQuickSel(qs);
				// 快捷工具的拒绝原因（仅 deny 行用）：与动作分开存，输入框才能在「改了还没保存」时
				// 独立编辑——聚焦期间由 reasonFocus 兜住，不被服务端值覆盖回去（见上方 ref 注释）。
				const qr = {};
				for (const t of Object.keys(names)) {
					qr[t] = { g: quickReasonOf(gq[t]) || '', p: quickReasonOf(pq[t]) || '' };
				}
				// 快捷工具拒绝原因：同样只保留「仍为 deny（输入框可见）」的聚焦行草稿
				setQuickReason((prev) => {
					if (focusNow && focusNow.kind === 'quick' && prev && prev[focusNow.key]) {
						const sub = focusNow.tab === 'global' ? 'g' : 'p';
						if (qs[focusNow.key] && finalActionOf(qs[focusNow.key][sub], quickAutoFallbackOf(focusNow.key, s, focusNow.tab)) === 'deny') {
							return Object.assign({}, qr, { [focusNow.key]: Object.assign({}, qr[focusNow.key], { [sub]: prev[focusNow.key][sub] }) });
						}
					}
					return qr;
				});
				// 编辑态收敛：上面三条清理路径（endEdit / exitEditOf / 切 tab）都只在「用户主动操作」
				// 时触发，而配置重载、删行、换会话都是服务端驱动的，不经过它们——（AI 侧 perm_* 写入
				// 也曾是一路服务端驱动源，那批写工具已整体移除）
				// 编辑态字符串会残留，格子重新出现时就成了「没点编辑却可输入」。故在整表重建后按
				// **新的** mode 收敛一次：本格若不再渲染输入框（mode 不再是 deny，或键已不存在），
				// 就一并丢弃编辑态与焦点标记。
				const stillEditable = (fk) => {
					if (!fk) return false;
					// 键只可能含 kind / tab / key 三段，其中 key（分类名或工具名）本身可能含冒号，
					// 故按前两个冒号切分，剩余整体作为 key。
					const i = fk.indexOf(':');
					const j = fk.indexOf(':', i + 1);
					if (i < 0 || j < 0) return false;
					const kind = fk.slice(0, i);
					const t = fk.slice(i + 1, j);
					const key = fk.slice(j + 1);
					// 四支判据都走 finalActionOf（与各自渲染处的 showReason 同源）：
					// `auto + 回落 deny` 那一格的理由框仍在渲染，按 raw `=== 'deny'` 判会把
					// 编辑态清掉，而草稿保护也依赖同一判据 —— 两处一起改才保得住。
					if (kind === 'cat') return !!(cs[t] && finalActionOf(cs[t][key], catAutoFallbackOf(key, s, t)) === 'deny');
					if (kind === 'sub') return !!(subNext[t] && finalActionOf(subNext[t][key], subAutoFallbackOf(key, s, t)) === 'deny');
					// 例外行：该条仍在（未被别处删掉）**且动作仍是 deny/ask** 时，原因/备注格
					// 才继续可编辑。用 excActs 同时回答两件事：该条在不在、它的动作是什么。
					//
					// 为什么必须判动作（与另外三支同构）：原因格只在 deny 时渲染、备注格只在 ask 时，
					// 而动作下拉框是**即时生效**的（setExAction），它的调用点不在 exitEditOf 的
					// 覆盖范围内。只判存在性时，「把某条例外改成 allow 再改回 deny」会让编辑态
					// 一直挂着 —— 格子回来时用户没点「编辑」却已处于输入态（autoFocus 抢焦点）。
					if (kind === 'exc') return !!(excActs[t] && (excActs[t][key] === 'deny' || excActs[t][key] === 'ask'));
					if (kind === 'quick') {
						const sub = t === 'global' ? 'g' : 'p';
						return !!(qs[key] && finalActionOf(qs[key][sub], quickAutoFallbackOf(key, s, t)) === 'deny');
					}
					return finalActionOf(fbShow[t], fbAutoFallbackOf(s, t)) === 'deny';
				};
				setReasonEditing((cur) => (stillEditable(cur) ? cur : null));
				if (reasonFocus.current && !stillEditable(reasonKeyOf(reasonFocus.current))) reasonFocus.current = null;
				// 例外行的编辑态同样要收敛：它按 **id** 定位，而 id 在新 status 里可能已经不存在
				// （别处删掉了、或 reload 换了配置）。不收敛的话编辑态会挂在空气上 ——
				// 列表里没有任何一行处于编辑态，而 exEdit 仍非 null，用户点「编辑」另一条时
				// 会先被这个陈旧值干扰。
				//
				// **草稿内容不在这里被覆盖**：编辑中的那一格保留用户已输入的值，
				// 否则每次 SSE status 推送（宿主在 persist 成功、session/event 时都会广播）
				// 都会把用户正在打的字冲掉 —— 那是 loopThDirty 那段注释记录的同一类坑。
				setExEdit((cur) => (cur === null ? null : (excActs[tab] && excActs[tab][cur] ? cur : null)));
				// ── 额外审批策略的草稿回填 ───────────────────────────────────────────
				// 有未保存草稿的那一格 **不覆盖**：applyStatus 不只由面板自身的 invoke
				// 回调触发，还由 SSE 的 status/refresh 事件触发（宿主在 init、配置重载、
				// 会话事件时都会广播）。不保住草稿，用户「已输入但还没点保存」的文字
				// 会被一次后台推送静默清空 —— 与 reasonEditing 那条同一个坑。
				//
				// 判据用 `policyDirty`（保存成功才清）而不是焦点：这一格用保存按钮提交，
				// 失焦不表示放弃草稿（见 policyDirty 处的说明）。
				const pol = (s.autoReview && s.autoReview.policy) || null;
				if (pol) {
					if (!policyDirty.current.global) setPolicyGlobal(String(pol.global || ''));
					if (!policyDirty.current.project) setPolicyProject(String(pol.project || ''));
					setPolicyMode(pol.projectMode === 'append' || pol.projectMode === 'replace' ? pol.projectMode : 'inherit');
					// 四个下拉各自回填：
					//   全局层 → **全局层单独**的生效值：本层显式值，缺键用宿主下发的默认值；
					//   项目层 → **本层显式值**，缺键显示「继承全局」。
					//
					// ⚠️ 全局层**不能**用 `effectiveHighRisk*`：那是 highRiskActionOf /
					// highRiskTimeoutOf 按**当前项目**求出的（项目显式 → 全局显式 → 缺省）。
					// 拿它回填全局行，项目层设了 deny 而全局缺键时，全局行会显示「拒绝」——
					// 实际全局是默认的 ask，换个项目就变一次（与 commandSub.globalEffectiveProbe
					// 同一类「面板说谎」）。全局行的取值链只有「全局显式 → 默认」两级。
					const defs = (s.autoReview && s.autoReview.defaults) || {};
					setPolicyHighRisk(pol.highRiskAction || defs.highRiskAction || 'ask');
					setPolicyHighRiskTimeout(pol.highRiskTimeout || defs.highRiskTimeout || 'deny');
					setPolicyProjectHighRisk(pol.projectHighRiskAction || 'inherit');
					setPolicyProjectHighRiskTimeout(pol.projectHighRiskTimeout || 'inherit');
					// 拒绝原因的模式与文本同样按层回填：全局行缺键用宿主下发的默认模式，
					// 项目行缺键显示「继承全局」。文本有草稿时不覆盖（见 denyDirty 的说明）。
					//
					// 三个生效值原样回填：缺键（null）才走「宿主默认 → default」两级回落。
					// 不按值逐个判 —— 那样每加一档都要在这里补一条，漏了就会把新档显示成别的。
					setPolicyDenyMode(pol.denyReasonMode || defs.denyReasonMode || 'default');
					setPolicyProjectDenyMode(pol.projectDenyReasonMode || 'inherit');
					if (!denyDirty.current.global) setPolicyDenyText(String(pol.denyReason || ''));
					if (!denyDirty.current.project) setPolicyProjectDenyText(String(pol.projectDenyReason || ''));
				}
			};

			const refresh = () => {
				call('permgate:status', { sessionId: sessionId || undefined }).then(applyStatus).catch((e) => setMsg(String((e && e.message) || e)));
			};
			// 会话切换（useSessions 选择器变化）与 SSE 联动都会触发重查，
			// 保证切换会话后面板立即显示当前会话的项目配置
			React.useEffect(() => {
				refresh();
				const off = subscribeEvents((ev) => {
					if (ev.type === 'status' || ev.type === 'refresh') refresh();
				});
				return () => off();
			}, [sessionId]);

			// 会写盘的端点：只有它们的 saveError 才代表「这次操作没落盘」。
			// 不能对所有调用一视同仁：status.saveError 是**宿主侧的粘滞状态**（上一次写盘失败后
			// 一直保留，直到某次 persist 成功或 load 重置），而 reload / open-config 这类只读调用
			// 也会回带 status。若不加区分，用户成功打开配置文件后，面板反而会显示上一次的写盘错误、
			// 并吞掉「已打开」提示（已实测复现）。
			// 清单须与面板真正会调用的写盘端点一致（不多不少）：少一个则该端点的假成功漏网，
			// 多一个则只读调用被误拦。regressions 里有一条断言会现场比对两边集合，防止各自漂移。
			// 注意：面板已移除编辑器内核入口（有一条断言钉住 client 不得出现该残留），故此处也不列它。
			const WRITE_METHODS = [
				'permgate:set-category', 'permgate:set-categories', 'permgate:set-quick',
				'permgate:set-fallback', 'permgate:set-sandbox', 'permgate:set-command-sub',
				'permgate:set-doomloop', 'permgate:set-auto-review', 'permgate:set-auto-policy',
				'permgate:add-exception', 'permgate:set-exception', 'permgate:remove-exception',
				'permgate:add-rule', 'permgate:remove-rule',
				'permgate:reorder',
			];
			const invoke = (method, args, done) => {
				setBusy(true);
				setMsg('');
				call(method, Object.assign({}, args || {}, { sessionId: sessionId || undefined })).then((r) => {
					if (r && r.error) { setMsg(String(r.error)); return; }
					// 写盘失败不会回 error：宿主 persist() 的各个失败分支（配置被外部修改、home 未就绪、
					// 目标不在 home 下、文件读不出、写入抛错）都只设 status.saveError 并 return false，
					// 路由层又忽略返回值、照常回 200。若只看 r.error，就会出现「磁盘没写、界面却显示
					// 已保存」的假成功。故对写盘端点，saveError 与 error 同等对待：报错、照常回填
					// status（让面板显示磁盘上的真实值），且**不调用 done**（不点亮对勾、不做后续动作）。
					// 注意 status 的位置不统一：多数路由平铺返回 statusView，而例外/规则的增删返回
					// `{ added|removed, status: statusView }` —— 两处都要取，否则后者的假成功仍会漏网。
					const st = r && r.status ? r.status : r;
					const saveErr = (r && r.saveError) || (st && st.saveError);
					if (saveErr && WRITE_METHODS.indexOf(method) !== -1) { setMsg(String(saveErr)); applyStatus(st); return; }
					setMsg(T('panel.saved'));
					applyStatus(r && r.status ? r.status : r);
					if (done) done(r);
				}).catch((e) => setMsg(String((e && e.message) || e))).then(() => setBusy(false));
			};

			const confirmDelete = (key, fn) => {
				if (busy) return;
				if (confirm === key) { setConfirm(null); fn(); }
				else setConfirm(key);
			};

			// 把某一格的草稿还原成服务端当前值（取消编辑、以及编辑态被外部关闭时用）。
			// 四处（分类 / 快捷工具 / 兜底 / 命令子设置）取值口径必须与各自 commit 的去重基准同源。
			const revertReason = (kind, key) => {
				if (kind === 'cat') {
					const block = status && status.categories && status.categories[tab] ? status.categories[tab] : null;
					const cur = (block && block[key] && block[key].reason) || '';
					setCatReasons((prev) => Object.assign({}, prev, { [tab]: Object.assign({}, prev[tab], { [key]: cur }) }));
					return;
				}
				if (kind === 'sub') {
					// 逐档取值，**只读宿主下发的 globalReasons/projectReasons** ——
					// 存量裸 `reason` 的归位（→ inside 档）由宿主 explicitReasonsOf 统一做，
					// 客户端不重做：归一逻辑只有一份，两处各写一遍必然漂移。
					const cr = (status && status.commandSub && status.commandSub[tab === 'global' ? 'globalReasons' : 'projectReasons']) || null;
					const cur = (cr && cr[key]) || '';
					setSubReasons((prev) => Object.assign({}, prev, { [tab]: Object.assign({}, prev[tab], { [key]: cur }) }));
					return;
				}
				if (kind === 'exc') {
					// 例外行的原因/备注。key 是例外 id；**取哪个字段由该条的最终动作决定**
					// （deny → reason、ask → note，判据 finalActionOf）—— 与渲染处逐字同源，
					// 故不需要额外的字段参数：同一时刻只有一个是可见的，那个就是正在编辑的那个。
					// 不能用原始 `row.action`：`auto + 回落 ask` 在渲染侧走的是 note 槽位，
					// 而该形状下 normalizeException 不存 reason —— 按 action 取会恒取到空串，
					// 点「取消」就把用户写的备注清掉（面板显示与磁盘分叉）。
					//
					// 按 id 在**本层全部分类**里找（例外 id 在一层内唯一，但不带分类信息）：
					// 遍历分类比让调用方多传一个 category 更省事，也不会因为漏传而静默取空。
					const blk = (status && status.categories && status.categories[tab]) || null;
					let row = null;
					if (blk) {
						for (const k of Object.keys(blk)) {
							const arr = blk[k] && Array.isArray(blk[k].exceptions) ? blk[k].exceptions : null;
							if (!arr) continue;
							const hit = arr.filter((x) => x.id === key)[0];
							if (hit) { row = hit; break; }
						}
					}
					const field = row && finalActionOf(row.action, row.autoFallback) === 'ask' ? 'note' : 'reason';
					setExReason((prev) => Object.assign({}, prev, { [key]: (row && row[field]) || '' }));
					return;
				}
				if (kind === 'quick') {
					const map = tab === 'global' ? (status && status.quickTools && status.quickTools.global) : (status && status.quickTools && status.quickTools.project);
					const cur = map && map[key] && typeof map[key] === 'object' ? (map[key].reason || '') : '';
					const sub = tab === 'global' ? 'g' : 'p';
					setQuickReason((prev) => Object.assign({}, prev, { [key]: Object.assign({}, prev[key], { [sub]: cur }) }));
					return;
				}
				const cur = (status && status.fallback && (tab === 'global' ? status.fallback.globalReason : status.fallback.projectReason)) || '';
				setFbReason((prev) => Object.assign({}, prev, { [tab]: cur }));
			};

			// 退出某一格的编辑态：**只作废这一格**，并在它正是当前编辑格时清掉焦点标记。
			// 早先三处 change* 内联写的是 setReasonEditing(null)（不分格地清掉全部格），
			// 且不清 reasonFocus.current——用户改 A 行的下拉会把 B 行的编辑态一并关掉，
			// B 行退回只读态却仍被 applyStatus 的草稿保护兜住，于是长期显示一份没落盘的草稿。
			const exitEditOf = (kind, key) => {
				const fk = reasonKeyOf({ kind: kind, tab: tab, key: key });
				setReasonEditing((cur) => (cur === fk ? null : cur));
				if (reasonKeyOf(reasonFocus.current) === fk) {
					reasonFocus.current = null;
					// 焦点标记一撤，applyStatus 就不会再用草稿覆盖服务端值；此处主动还原，
					// 避免只读态在下一次 status 推送前继续显示未保存的草稿。
					revertReason(kind, key);
				}
			};

			// 该层子设置的**显式配置**动作（用户没设过则 undefined）。
			// 与面板显示值（subDestructive，含推导默认值）区分：提示判据只能用显式值 ——
			// 档位缺省值恒为 ask 或继承全局的同名档，拿它比较只会产生假警告。
			//
			// `tier` 省略时取 `inside`（老键 `action`）。**现在有真实的按档调用点**
			// （warnSubMismatchTiers 逐档调用它）：八档之后「子设置的动作」不再是一个值 ——
			// 只判 inside 会把另外七档的松紧漏判，而某一档被显式设得更松时，
			// 命中该档的破坏性命令确实会被放行（正是这条提示存在的理由）。
			// 键名映射与 applyStatus 的 tierKeyOf 同口径：inside 走老键 `action`，其余同名。
			const explicitSubOf = (t, tier) => {
				const e = status && status.commandSub && status.commandSub[t];
				if (!e) return undefined;
				const k = (tier || 'inside') === 'inside' ? 'action' : tier;
				return e[k] || undefined;
			};

			// 分类默认值的动作切换：只改 mode。拒绝原因由下方 commitCatReason 走单数端点
			// （permgate:set-category）单独提交；宿主在 mode 切离 deny 时会清掉 reason。
			//
			// command 分类切换后，子设置可能与新 mode 不协调 —— 只**提示**，不改写：
			//   · 判定链是 例外 → 子设置 → 大分类，子设置优先。所以大分类设为 deny 时，
			//     子设置若是 ask/allow，破坏性命令仍按子设置走（用户会以为「一律拒绝」没生效）；
			//     大分类设为 ask 时，子设置若是 allow，破坏性命令直接放行（比大分类更松）。
			//   · 为什么不在宿主里联动改写：写入侧无法区分「子设置是默认值」与「用户显式设成了它」
			//     —— 两者值完全相同。联动会静默覆盖用户的显式表态，还会造成「先设 A 后设 B」
			//     与「先设 B 后设 A」结果不同（顺序依赖）。所以这里只把事实讲清楚，
			//     要不要一并改由用户决定（下方子设置行与例外行的排列次序即判定次序）。
			const changeCat = (c) => (e) => {
				const mode = e.target.value;
				setCats(Object.assign({}, cats, { [tab]: Object.assign({}, cats[tab], { [c]: mode }) }));
				// 切离「最终会拒绝」时作废该格的编辑态：控件会被卸载，若留着，切回时同一格会
				// 莫名其妙又处于可输入状态（用户并没有点「编辑」）。
				// 判据用 finalActionOf：`auto + 回落 deny` 时理由框仍在，不该被这里关掉。
				if (finalActionOf(mode, catAutoFallbackOf(c)) !== 'deny') exitEditOf('cat', c);
				// 切**进** auto 时必须同时把回落值写下去：宿主侧 `normalizeAutoFallback` 对
				// 「action=auto 但没写回落」会补 'ask'（安全方向），但那是一次**静默补值** ——
				// 用户看不到自己"选了 auto 但回落是 ask"。这里显式带上当前显示值，
				// 使「面板上看到的回落」与「实际落盘的回落」始终一致。
				const patch = { [c]: mode };
				if (mode === 'auto') patch[c + 'AutoFallback'] = catAutoFallbackOf(c);
				invoke('permgate:set-categories', { [tab]: patch }, () => setMsg(tab === 'global' ? T('panel.savedToGlobal') : T('panel.savedToProject')));
				// 大分类刚变（mode 是新值）；子设置取**该层的显式配置**（未配置则传 undefined）。
				// 不能传 subDestructive[tab] —— 它是面板**显示值**（未配置的档取的是宿主下发的
				// 生效值，见 applyStatus），而拿显示值去比较会产生**假警告**：
				// 实测 global command 由 ask 改为 deny、用户从未设过子设置时，会弹出
				// 「破坏性命令会按『询问』处理」—— 而读取侧按新 mode 推导出的实际动作是 deny。
				if (c === 'command') warnSubMismatchTiers(mode);
			};

			// auto 的回落值：显示值取自宿主下发的分类块（catAutoFallback 字段），
			// 缺省 'ask'（与宿主 normalizeAutoFallback 的缺省**同源**，不是各写一份）。
			const catAutoFallbackOf = (c, st, t) => {
				const src = st || status;
				const tb = t || tab;
				const block = src && src.categories && src.categories[tb] ? src.categories[tb] : null;
				const v = block && block[c] ? block[c].autoFallback : undefined;
				return v === 'allow' || v === 'deny' ? v : 'ask';
			};
			// 改回落值：只改这一个字段，不动 mode。单独一个端点参数（autoFallback），
			// 与 mode 一起走 set-categories 的批量补丁通道。
			const changeCatAutoFallback = (c) => (e) => {
				const v = e.target.value;
				invoke('permgate:set-categories', { [tab]: { [c + 'AutoFallback']: v } }, () => setMsg(tab === 'global' ? T('panel.savedToGlobal') : T('panel.savedToProject')));
			};

			// 大分类 mode 与子设置动作不协调时的提示（只提示，不改写 —— 理由见 changeCat）。
			// 判据是「子设置比大分类**更松**」：MODE_RANK 越大越严（allow < ask < deny），
			// 故更松即 MODE_RANK[sub] < MODE_RANK[catMode]。
			//   · 大分类 deny + 子设置 ask/allow → 提示（用户会以为「一律拒绝」没生效）
			//   · 大分类 ask  + 子设置 allow    → 提示（破坏性命令直接放行，比大分类更松）
			// 更紧（子设置比大分类严）不提示 —— 那正是子设置的用途（D-6：大分类 allow 时
			// 破坏性命令仍按子设置走），提示它只会造成噪音。
			//
			// sub 必须由调用方**显式传入**，不能从 subDestructive[tab] 读：
			// 那是 React state，setSubDestructive 之后同一函数体内读到的仍是**本次渲染的旧值**，
			// 于是判据拿旧值比较 —— 实测（cat=ask）子设置由 deny 改 allow（该提示的放松方向）
			// 反而不提示，由 allow 改 deny（不该提示）反而误报且文案与实际动作矛盾。
			// changeSubDestructive 一侧传的就是新值（action），两侧口径现在一致。
			//
			// ── `auto` 必须在这张表里（曾经缺，导致提示静默失效）─────────────────────
			// 缺 `auto` 时 `MODE_RANK['auto']` 是 `undefined`，而 warnSubMismatch 开头就是
			// `if (rank === undefined || MODE_RANK[sub] === undefined) return` ——
			// 于是**只要大分类或该档子设置任一侧是 auto，整条提示直接静默跳过**：
			//   · 大分类 deny + 子设置 auto → 不提示，而 auto 明显比 deny 松（该提示的正是它）
			//   · 大分类 auto + 子设置 allow → 不提示，同上
			// 这与「面板说谎」同族：不协调真实存在，面板一声不吭。
			//
			// 取 1 与 `ask` 同档，理由与 index.js 的 `MODE_STRICTNESS` 同源：auto 与 ask
			// 一样是「要过一道关」的档位（ask 过关的是人，auto 过关的是模型）。
			// 并列时两边都不提示 —— 方向安全（auto 与 ask 谁更松本就没有客观答案，
			// 编一个顺序去提示只会造成噪音）。
			const MODE_RANK = { allow: 0, ask: 1, deny: 2, auto: 1 };

			// 「这一格最终会执行哪个动作」的判据 —— 宿主 index.js 的 `finalActionOf` 的
			// 客户端副本（分处宿主闭包与浏览器 bundle，无法共用函数；改一处必须同步改另一处）。
			//
			// 四档里 `auto` 是**两层**的：第一层 `action: 'auto'`（交给模型），第二层
			// `autoFallback`（模型失败时执行什么）。于是「这一格最终会不会拒绝」不能只看
			// 第一层 —— `auto + 回落 deny` 在执行侧与裸 `deny` 完全同形（同一条 kind:'deny'
			// 通道回给 AI），它的理由框当然该出现。
			//
			// 面板的**显示判据**必须与宿主的**存留判据**同源：宿主只在
			// `finalActionOf(...) === 'deny'` 时存 reason，面板若仍按 `action === 'deny'`
			// 决定要不要渲染理由框，就会出现两个方向的谎：
			//   · `auto + 回落 deny` → 宿主能存，面板却不给框（用户写不了）；
			//   · `auto + 回落 ask/allow` → 宿主不存，面板却给了框（用户写了不生效）。
			// 回落值缺省 ask（与宿主 normalizeAutoFallback 同源）。
			const finalActionOf = (action, autoFallback) => {
				if (action !== 'auto') return action;
				return autoFallback === 'allow' || autoFallback === 'deny' ? autoFallback : 'ask';
			};

			// `tierLabel` 是**已本地化**的档位名（由调用方给出）：文案必须点名是哪一档 ——
			// 八档之后「子设置是「允许」」会被读成整个子设置都放行，而实际可能只有 `wide` 一档。
			// 点名之后文案与判据同粒度（判的是哪一档，说的就是哪一档）。
			const warnSubMismatch = (catMode, sub, tierLabel) => {
				// inherit 表示「穿透到全局」，本层没有独立表态，无从比较 —— 不提示。
				if (!sub || sub === 'inherit') return;
				const rank = MODE_RANK[catMode];
				if (rank === undefined || MODE_RANK[sub] === undefined) return;
				if (MODE_RANK[sub] >= rank) return;
				setNotice(T('panel.subMismatch')
					.replace('{cat}', modeLabel(catMode))
					.replace('{sub}', modeLabel(sub))
					.replace('{tier}', tierLabel || ''));
			};
			// 档位名（本地化）：与 subTierRow 同一口径 —— 宿主新增档位而 SUB_TIER_META 里
			// 没有对应文案时回落成档位名本身（不显示裸键名、也不显示 undefined）。
			const subTierLabelOf = (tier) => {
				const m = subTierList().filter((x) => x.t === tier)[0];
				return m && m.label ? T(m.label) : tier;
			};
			// 改**大分类**时的判据：八档**逐档**各判一次，不是只判 inside。
			//
			// 为什么不能只判 inside：八档之后「子设置的动作」不再是一个值 —— inside 只是八分之一，
			// 而判定链上每一档都独立生效。用户显式把 `wide` 设成 allow 再改大分类为 deny 时，
			// 只判 inside 会**一声不吭**，而命中 wide 档的破坏性命令确实被放行 ——
			// 那正是这条提示存在的理由（折叠状态下也要提示：不协调是配置错误，
			// 不该因为控件被收起就不告诉用户）。
			//
			// 逐档比的是**该档的显式配置**（explicitSubOf(tab, tier)，未配置即 undefined 不提示）——
			// 不能用面板显示值，那含宿主下发的推导默认值，会产生假警告（见 changeCat 的说明）。
			// 多档同时不协调时提示文案相同，后判的那一档覆盖前者，结果一致。
			const warnSubMismatchTiers = (catMode) => {
				for (const m of subTierList()) warnSubMismatch(catMode, explicitSubOf(tab, m.t), subTierLabelOf(m.t));
			};

			// 子设置动作切换：只改**该档**的 action（reason 由 reasonInput 那套编辑态单独提交）。
			// inherit 是项目层专属的「穿透全局」语义，宿主对 global+inherit 会拒绝 —— 故
			// 下拉选项按 tab 取 ALL_MODES / MODES，与分类默认值的选择器同口径。
			//
			// `tier` 由渲染处传入（八档各自一个下拉框）；`inside` 走老键 `action`（老键义不变）。
			const changeSubDestructive = (tier) => (e) => {
				const action = e.target.value;
				setSubDestructive(Object.assign({}, subDestructive, {
					[tab]: Object.assign({}, subDestructive[tab], { [tier]: action }),
				}));
				// 与 changeCat 同：切离「最终会拒绝」时作废**该档**的编辑态（控件会被卸载）。
				// 判据用 finalActionOf：`auto + 回落 deny` 时理由框仍在，不该被这里关掉。
				if (finalActionOf(action, subAutoFallbackOf(tier)) !== 'deny') exitEditOf('sub', tier);
				invoke('permgate:set-command-sub', { target: tab, tier: tier, action }, () => setMsg(tab === 'global' ? T('panel.savedToGlobal') : T('panel.savedToProject')));
				// 反向也要提示：用户刚把子设置放松到大分类之下（同一个不协调，两个方向都会出现）。
				// 传 action（本次新值），不读 state —— 见 warnSubMismatch 的说明。
				// 档位名一并传：文案要点名是哪一档（八档之后「子设置是「允许」」会被误读成整层）。
				warnSubMismatch(cats[tab] ? cats[tab].command : undefined, action, subTierLabelOf(tier));
			};

			// 子设置的**回落值**写入单点见下方 changeSubAutoFallback（紧邻 subActionOf /
			// subAutoFallbackOf —— 它要用这两个取值函数，放在一起才能一眼看出同源）。

			// 子设置拒绝原因的保存单点。空串必须原样下发（宿主把空串定义为显式清除、
			// undefined 定义为保留原值），与 commitCatReason 完全同口径。
			//
			// ── `tier` 必加 ───────────────────────────────────────────────────────────
			// 不带 tier 会写到**缺省档**（`inside`）——「用户改 `wide` 的理由，把 `inside` 的动作
			// 改成了 deny」。
			//
			// ── `action` 必须取该档**当前**动作，不能硬编码 'deny' ─────────────────────
			// 理由框在 `auto + 回落 deny` 时也会渲染（判据 finalActionOf）。硬编码会把该档的动作
			// 从 auto **静默改成 deny** —— 模型判断那一步被一次改理由抹掉。
			const commitSubReason = (focus) => {
				const tier = (focus && focus.key) || 'inside';
				const v = (subReasons[tab] || {})[tier];
				const cr = (status && status.commandSub && status.commandSub[tab === 'global' ? 'globalReasons' : 'projectReasons']) || null;
				const cur = (cr && cr[tier]) || '';
				if ((v || '') === cur) return;
				invoke('permgate:set-command-sub', { target: tab, tier: tier, action: subActionOf(tier), reason: v }, () => markReasonSaved(focus));
			};

			// 拒绝原因保存单点：只在**最终会拒绝**时才写（其它动作下控件根本不显示）。
			// 空串必须原样下发：宿主把「空串」定义为显式清除、「undefined」定义为保留原值，
			// 若这里用 `|| undefined` 把清空折叠成 undefined，用户就再也删不掉写错的原因
			// （旧文字会被 applyStatus 回填）。仅当该键确实缺失时才传 undefined。
			//
			// ⚠️ `mode` 必须取该分类**当前**动作（不是硬编码 'deny'）：理由框在
			// `auto + 回落 deny` 时也会渲染，硬编码会把用户的 auto 静默改成 deny。
			const commitCatReason = (c) => (focus) => {
				const curMode = cats[tab] ? cats[tab][c] : null;
				if (finalActionOf(curMode, catAutoFallbackOf(c)) !== 'deny') return;
				const v = catReasons[tab] ? catReasons[tab][c] : undefined;
				const cur = (status && status.categories && status.categories[tab] && status.categories[tab][c] && status.categories[tab][c].reason) || '';
				// 与已落盘值相同就不写盘：回车与按钮可能各触发一次，避免无谓的重复请求
				if ((v || '') === cur) return;
				// 对勾只在**写盘成功**后才亮：invoke 在 r.error / catch 分支只 setMsg 报错、
				// 不回滚标记，若在这里先亮，失败时界面会同时显示「✓ 已保存」和错误信息。
				invoke('permgate:set-category', { target: tab, category: c, mode: curMode, reason: v }, () => markReasonSaved(focus));
			};

			// 某行快捷工具的**当前**回落值（只有 auto 时可能非空）。与 quickRow 里那段
			// 内联取法同源 —— 抽成函数是因为 changeQuick 也要用它判编辑态，
			// 而 qAf 是 quickRow 的局部变量，在 changeQuick 的作用域里拿不到。
			const quickAutoFallbackOf = (tool, st, t) => {
				const key = (t || tab) === 'global' ? 'g' : 'p';
				const src = st || status;
				const m = src && src.quickTools ? (key === 'g' ? src.quickTools.global : src.quickTools.project) : null;
				const e = m && m[tool];
				return e && typeof e === 'object' ? e.autoFallback : null;
			};
			const changeQuick = (tool) => (e) => {
				const mode = e.target.value;
				const key = tab === 'global' ? 'g' : 'p';
				setQuickSel(Object.assign({}, quickSel, { [tool]: Object.assign({}, quickSel[tool], { [key]: mode }) }));
				// 同 changeCat：切离「最终会拒绝」时作废该格的编辑态（只作废这一格，不动别的行）。
				// 判据用 finalActionOf：`auto + 回落 deny` 时理由框仍在，不该被这里关掉。
				if (finalActionOf(mode, quickAutoFallbackOf(tool)) !== 'deny') exitEditOf('quick', tool);
				invoke('permgate:set-quick', { target: tab, tool, action: mode });
			};

			// 快捷工具的**回落值**写入（/permgate/set-quick 的 autoFallback 参数）。
			// 必须带上 action（取该行当前动作）：宿主的 setQuickAction 用它决定该行是不是
			// auto，非 auto 时回落值会被丢弃 —— 只传回落值会静默失效。
			const changeQuickAutoFallback = (tool) => (e) => {
				const v = e.target.value;
				const key = tab === 'global' ? 'g' : 'p';
				const mode = quickSel[tool] && quickSel[tool][key] ? quickSel[tool][key] : (tab === 'project' ? 'inherit' : quickGlobalValue(tool, status && status.quickTools ? status.quickTools.global : null));
				invoke('permgate:set-quick', { target: tab, tool, action: mode, autoFallback: v },
					() => setMsg(tab === 'global' ? T('panel.savedToGlobal') : T('panel.savedToProject')));
			};

			// 快捷工具拒绝原因保存（同上：仅在**最终会拒绝**的行可见）
			//
			// ⚠️ `action` 必须取该行**当前**动作（不是硬编码 'deny'）：理由框在
			// `auto + 回落 deny` 时也会渲染，硬编码会把用户的 auto 静默改成 deny。
			const commitQuickReason = (tool) => (focus) => {
				const key = tab === 'global' ? 'g' : 'p';
				const cur = quickSel[tool] ? quickSel[tool][key] : null;
				if (finalActionOf(cur, quickAutoFallbackOf(tool)) !== 'deny') return;
				const v = quickReason[tool] ? quickReason[tool][key] : undefined;
				// 同 commitCatReason：与已落盘值相同就不写盘
				const map = tab === 'global' ? (status && status.quickTools && status.quickTools.global) : (status && status.quickTools && status.quickTools.project);
				const prev = map && map[tool] && typeof map[tool] === 'object' ? map[tool].reason : undefined;
				if ((v || '') === (prev || '')) return;
				// 同 commitCatReason：对勾只在写盘成功后亮
				invoke('permgate:set-quick', { target: tab, tool, action: cur, reason: v }, () => markReasonSaved(focus));
			};

			const addQuick = () => {
				if (!newTool || !String(newTool).trim()) { setMsg(T('panel.needTool')); return; }
				// reason 只在选「拒绝」时下发（与面板其余入口同口径），且空值必须折叠成 undefined：
				// 新增行允许输入本层已存在的工具名，而宿主把「空串」定义为显式清除——用户没填原因
				// 就点「添加」，会静默删掉该键已保存的拒绝原因（旧文字再也回不来）。
				// 此处不存在「用户想清空既有原因」的诉求，那是已存在行编辑/保存路径才有的语义。
				invoke('permgate:set-quick', {
					target: tab,
					tool: String(newTool).trim(),
					action: newToolAction,
					// 回落值：只在动作是 auto 时下发（与新增例外行同口径）
					autoFallback: newToolAction === 'auto' ? newToolAutoFallback : undefined,
					reason: finalActionOf(newToolAction, newToolAutoFallback) === 'deny' ? (String(newToolReason || '').trim() || undefined) : undefined,
				}, () => {
					setNewTool(''); setNewToolReason(''); setNewToolAutoFallback('ask');
					// 清过滤器 + 滚到底部（用户定）：新加的条目排在最末，而过滤器可能正遮着它
					// —— 不清掉用户就看不到自己刚加的那条，会以为没加上而重复添加。
					// 两者必须同时做：只滚不清 = 新条目被过滤掉、列表看起来没变；只清不滚 = 它在最底下看不见。
					setQuickFilter('');
					setQuickScrollEnd((n) => n + 1);
				});
			};

			// 删除该行在当前 tab 的快捷工具设置（服务端收到 action=inherit 即删除该键）；
			// 只发请求、不做本地乐观删除：quickSel 完全由服务端返回的 status 收敛，请求失败时
			// 不会留下「面板已删、服务端仍生效」的漂移（与例外/规则的删除入口一致）。
			const removeQuick = (tool) => {
				invoke('permgate:set-quick', { target: tab, tool, action: 'inherit' });
			};

			const addException = (c) => {
				const v = String(exVals[c] || '').trim();
				if (!v) { setMsg(T('panel.needValue')); return; }
				const f = exOf(c);
				// 只清本分类那一行：清全部会把用户在别的分类填了一半的内容一并抹掉
				setExVals(Object.assign({}, exVals, { [c]: '' }));
				setExField(c, { reason: '', note: '', autoFallback: 'ask' });
				invoke('permgate:add-exception', {
					target: tab,
					category: c,
					match: v,
					action: f.action,
					// 回落值：只在动作是 auto 时下发（宿主 normalizeAutoFallback 对非 auto 返回
					// undefined，多传也无害，但少传会让「新增时选的回落值」被静默丢弃）。
					autoFallback: f.action === 'auto' ? (f.autoFallback || 'ask') : undefined,
					// 只有**最终会拒绝**才带拒绝原因（回给 AI），只有**最终会询问**才带备注
					// （显示在弹窗上供日后回看）。判据是 finalActionOf，与宿主的存留判据同源。
					reason: finalActionOf(f.action, f.autoFallback) === 'deny' ? (String(f.reason || '').trim() || undefined) : undefined,
					note: finalActionOf(f.action, f.autoFallback) === 'ask' ? (String(f.note || '').trim() || undefined) : undefined,
				}, () => {
					// 清过滤器 + 滚到底部（同 addQuick 的理由）。都**只作用于本分类**：
					// 清全部会把用户在别的分类输的过滤词一并抹掉（他可能正靠着那个词找东西）；
					// 计数器带上分类名，effect 才知道该滚哪一个列表（见 excScrollRefs 的说明）。
					setExcFilter((prev) => Object.assign({}, prev, { [c]: '' }));
					setExcScrollEnd((prev) => ({ c: c, n: prev.n + 1 }));
				});
			};

			const removeException = (c, id) => {
				setBusy(true);
				setMsg('');
				// 注意：这里必须用返回 promise 的 call（invoke 是无返回值的回调式封装），
				// 但它同样会写盘，所以必须自己判 saveError —— 否则删除例外的写盘失败会被当成成功，
				// 界面提示「已删除」而磁盘仍是旧配置，下次 reload 该例外会「复活」（已实测复现）。
				call('permgate:remove-exception', { target: tab, category: c, id }).then((r) => {
					if (r && r.error) { setMsg(String(r.error)); return; }
					const st = r && r.status ? r.status : r;
					const saveErr = (r && r.saveError) || (st && st.saveError);
					if (saveErr) { setMsg(String(saveErr)); applyStatus(st); return; }
					applyStatus(r && r.status ? r.status : r);
					// 删除只作用于选中行：明确反馈结果；同路径若仍有例外则提示剩余条数，否则清掉旧提示
					if (r && r.removed === false) setMsg(r.reason ? String(r.reason) : T('panel.delFailed'));
					else setMsg(r && r.remaining > 0 ? T('panel.excRemaining').replace('{n}', String(r.remaining)) : '');
				}).catch((e) => setMsg(String((e && e.message) || e))).then(() => setBusy(false));
			};

			// 进入某条例外的编辑态：把当前服务端值灌进草稿。
			// 只允许同时编辑一条（见 exEdit 的说明）；已在编辑另一条时**先丢弃那条的草稿**
			// —— 不提交、不弹确认（与 reasonInput 的 beginEdit 同语义：切格即还原，
			// 「保存」是唯一的提交动作，没点过就不算数）。
			//
			// 编辑态**只管模式**（match / path）。原因与备注不在这里 ——
			// 它们走 reasonInput（与分类默认值/档位/快捷工具/兜底同一个组件），
			// 见 commitExReason 的说明。
			const beginExEdit = (r) => {
				setExDraft({ value: r.path || r.match || '' });
				setExEdit(r.id);
			};
			const cancelExEdit = () => { setExEdit(null); };
			// 例外**模式**的提交点（编辑态专用）。
			//
			// 与 removeException 同：用返回 promise 的 call 而不是 invoke，且必须自己判
			// saveError —— 写盘失败时若当成成功，界面会显示新值而磁盘仍是旧值，
			// 下次 reload 改动「消失」（那正是删除路径踩过的坑）。
			const saveExEdit = (c, row) => {
				const v = String(exDraft.value || '').trim();
				// 空模式本地先拦：宿主也会拒，但那时错误信息要绕一圈才回到界面上，
				// 而「匹配内容不能为空」是用户此刻就能自己修的问题。
				if (!v) { setMsg(T('panel.excEmpty')); return; }
				setBusy(true);
				setMsg('');
				call('permgate:set-exception', { target: tab, category: c, id: row.id, value: v }).then((r) => {
					if (r && r.error) { setMsg(String(r.error)); return; }
					const st = r && r.status ? r.status : r;
					const saveErr = (r && r.saveError) || (st && st.saveError);
					if (saveErr) { setMsg(String(saveErr)); applyStatus(st); return; }
					applyStatus(r && r.status ? r.status : r);
					// **退出编辑态必须在确认写盘成功之后**：放在最前面时，写盘失败也照样
					// 退出编辑态，用户输入的内容直接消失、只看到一句报错，得从头再打一遍。
					// 这是本函数最容易写错的一处（regressions 里那条「写盘端点逐字自查」
					// 就是专门守它的 —— 它要求 applyStatus 与 saveError 拦截的顺序不能颠倒）。
					setExEdit(null);
					setMsg(T('panel.saved'));
				}).catch((e) => setMsg(String((e && e.message) || e))).then(() => setBusy(false));
			};

			// 例外**原因 / 备注**的提交点（reasonInput 的回调）。
			//
			// 走的是与分类默认值 / 档位 / 快捷工具 / 兜底**同一个** reasonInput 组件，
			// 于是外观与交互（只读文字 + 编辑 / 保存 / 取消）与那四处逐字一致 ——
			// 这是「风格统一」的结构性保证：不是照着别处手抄一份样式，而是同一个组件。
			//
			// ── 字段名由**调用方传入**，不在这里从 status 反查 ──────────────────────
			// 渲染处已经知道 `act`（它正是决定渲染哪个槽位的东西），把它一并传进来最可靠。
			// 曾经在这里扫 status 反查该条的动作：那要依赖「status 已刷新到最新动作」，
			// 而改动作与改原因是两个独立请求 —— 前者刚提交、status 还没回来的窗口里，
			// 反查会拿到**旧动作**，把备注写进 reason（实测复现：动作改成 ask 后，
			// 备注仍被写进 reason 字段）。
			//
			// **只传改动的那一个字段**：宿主 `undefined` = 保留原值、空串 = 显式清除，
			// 两个一起传会在另一个恰好为空时把它误清。
			// 空串必须原样下发（不折叠成 undefined）：否则用户再也删不掉写错的原因。
			const commitExReason = (focus) => {
				const id = focus && focus.key;
				if (!id) return;
				const field = focus.field === 'note' ? 'note' : 'reason';
				// 草稿**可能还没被播种**：`exReason` 只由 revertReason / onChange 写入，
				// 而「面板首次打开 → 直接点编辑 → 保存」这条路径两者都没跑过。
				// 此时缺省值必须是 `focus.cur`（渲染处 :4737 用的就是这个兜底），
				// 不能用 `''` —— 那会把「没改过」当成「用户清空了」提交上去，
				// 而宿主 normalizeException 对空串是 `if (t)` 不赋值，于是
				// setExceptionEntry 就地替换后该例外的 reason 键被整条删除：
				// 界面保存前一直显示服务端原文，用户看不出会丢（静默删除既有拒绝理由）。
				// 判据用 `!== undefined` 而非 `||`：onChange 写入的 `''` 是**真实的清空意图**，
				// 必须原样保留（见上方「空串必须原样下发」）。
				const v = exReason[id] !== undefined ? exReason[id] : (focus.cur || '');
				// 未改动就不发请求（reasonInput 的「保存」按钮在值没变时也会被点到）
				if (v === (focus.cur || '')) return;
				const payload = { target: tab, category: focus.category, id: id };
				payload[field] = v;
				setBusy(true);
				setMsg('');
				call('permgate:set-exception', payload).then((r) => {
					if (r && r.error) { setMsg(String(r.error)); return; }
					const st = r && r.status ? r.status : r;
					const saveErr = (r && r.saveError) || (st && st.saveError);
					if (saveErr) { setMsg(String(saveErr)); applyStatus(st); return; }
					applyStatus(r && r.status ? r.status : r);
					markReasonSaved(focus);
				}).catch((e) => setMsg(String((e && e.message) || e))).then(() => setBusy(false));
			};

			// 例外的**动作**单独改（下拉框即时生效，不走编辑态）——与档位行的动作下拉框同构。
			// reason/note 不在这里提交：它们的可见性由动作决定（deny 才显示 reason、
			// ask 才显示 note），此时那两格可能根本没渲染出来，读草稿会提交一份
			// 用户没看过的文本。宿主侧 normalizeException 会按新动作丢弃不属于它的字段，
			// 故这里只传 action 是安全的。
			const setExAction = (c, row) => (e) => {
				const action = e.target.value;
				setBusy(true);
				setMsg('');
				call('permgate:set-exception', { target: tab, category: c, id: row.id, action: action }).then((r) => {
					if (r && r.error) { setMsg(String(r.error)); return; }
					const st = r && r.status ? r.status : r;
					const saveErr = (r && r.saveError) || (st && st.saveError);
					if (saveErr) { setMsg(String(saveErr)); applyStatus(st); return; }
					applyStatus(r && r.status ? r.status : r);
					setMsg(T('panel.saved'));
				}).catch((err) => setMsg(String((err && err.message) || err))).then(() => setBusy(false));
			};


			// 某条例外的**当前**回落值（只有该条动作是 auto 时才可能非空）。
			// 直接读宿主下发的原始例外对象 —— 它是 config 的投影，字段名与存储同形
			// （`autoFallback`），不需要在客户端再做一次映射。
			// 缺省返回 null 而不是 'ask'：由 actionFallbackCtl 统一按 ask 渲染，
			// 免得「这里补 ask、那里补 ask」两处各写一份缺省。
			const exAutoFallbackOf = (row) => (row && typeof row === 'object' ? row.autoFallback : null) || null;

			// 例外的**回落值**写入（/permgate/set-exception 的 autoFallback 字段）。
			// 与 setExAction 完全同一条错误链（error → saveError → applyStatus），
			// 不新造一种失败形状：多一条分支就多一处会绕过「写盘失败要回填」的纪律。
			//
			// 不传 action：宿主的 setExceptionEntry 里 action 缺席 = 保留原值，
			// 故这次写入不会碰动作（与 commitSubReason 必须传 action 的情形不同 ——
			// 那里宿主用 action 决定「该不该存回落值」，这里没有那个判断）。
			const setExAutoFallback = (c, row) => (e) => {
				const v = e.target.value;
				setBusy(true);
				setMsg('');
				call('permgate:set-exception', { target: tab, category: c, id: row.id, autoFallback: v }).then((r) => {
					if (r && r.error) { setMsg(String(r.error)); return; }
					const st = r && r.status ? r.status : r;
					const saveErr = (r && r.saveError) || (st && st.saveError);
					if (saveErr) { setMsg(String(saveErr)); applyStatus(st); return; }
					applyStatus(r && r.status ? r.status : r);
					setMsg(T('panel.saved'));
				}).catch((err) => setMsg(String((err && err.message) || err))).then(() => setBusy(false));
			};

			const setFormKey = (key) => (e) => setForm(Object.assign({}, form, { [key]: e.target.value }));
			const addRule = () => invoke('permgate:add-rule', { target: tab, action: form.action, tool: form.tool || undefined, path: form.path || undefined, args: form.args || undefined, reason: form.reason || undefined,
				// 回落值：只在动作是 auto 时下发（与新增快捷工具行同口径；宿主 normalizeRule 走
				// normalizeAutoFallback，非 auto 时本就丢弃，少传则会静默丢掉用户刚选的回落值）。
				autoFallback: form.action === 'auto' ? newRuleAutoFallback : undefined });
			const removeRule = (id) => invoke('permgate:remove-rule', { target: tab, id });
			// 排序单点：面板只报「把 id 放到 anchor 之前/之后」，怎么落位由宿主决定
			// （reorderEntries 是唯一实现）。↑↓ 与拖动都走这里 —— 两条入口共用一个原语，
			// 才不会出现「按钮的顺序对、拖动的顺序差一位」这类只在某一条路径上出现的偏差。
			//
			// 不做本地乐观重排：顺序就是优先级，界面先动、写盘失败时用户已经按新顺序
			// 理解了一遍权限 —— 那种「看起来生效了」比卡一下糟得多。请求返回后由 status 收敛。
			const moveEntry = (kind, category) => (id, anchor, position) => {
				setSortDrag(null);
				invoke('permgate:reorder', { target: tab, kind, category, id, anchor, position });
			};
			// 排序状态的三件套（两个列表共用一份 state，见 sortDrag 的声明处）
			const sortOf = (kind, category) => ({
				drag: sortDrag,
				onDrag: setSortDrag,
				onMove: moveEntry(kind, category),
			});
			const reload = () => invoke('permgate:reload', {});
			const openConfig = () => invoke('permgate:open-config', {}, () => setMsg(T('panel.openConfigDone')));

			// 动作徽标（规则 / 最近决策**两处**共用）。
			//
			// **fontSize 必须显式给**：这里曾经只设 color 与 fontWeight，于是它继承了
			// 浏览器默认的 16px，而同一行里所有兄弟节点都显式写着 12px ——
			// 表现为「一行 12px 小字里孤零零一个特别大的『拒绝』」。
			// 面板根节点没有设 fontSize（只有 fontFamily），所以没有可继承的小字号，
			// 漏写就等于要 16px。两处调用点都受影响，不是某一处的局部问题。
			//
			// 例外行**不再是**调用点之一：它已改用状态点 `pg-exc-dot`，与档位行统一，
			// 动作文字由下拉框显示。于是调用点从三处降为两处。
			const badge = (action) => React.createElement('span', { style: { color: MODE_COLORS[action] || '#888', fontWeight: 600, marginRight: 6, fontSize: 12, whiteSpace: 'nowrap' } }, modeLabel(action));

			// ── 值域外的当前值必须能显示出来 ───────────────────────────────────────
			// 归一化侧刻意**保留**本版读不懂的动作（index.js 的 actionAllowed ②：丢弃等于
			// 规则消失 = 继续往下走 = 可能静默放行），于是 categories / 例外 / 快捷工具里
			// 真的可能存着 `denny` 这种值。而 `<select>` 选不中不存在的 option：浏览器会
			// 显示空白或回落到首个选项 —— 面板于是说「询问」，宿主实际按 deny 拒绝，
			// 用户既看不出配置写错了，也没法在这个下拉里改回来。
			//
			// 故把值域外的当前值补成一个 option，标签走 modeLabel 的「未知动作：X」降级。
			// 处理放在 sel 这个**唯一渲染单点**：分类 / 例外 / 八档 / 快捷工具 / 兜底
			// 六处调用点都经它，逐处补 option 就是六份副本、日后必漏。
			const sel = (v, onChange, options, disabled) => React.createElement('select', { value: v, onChange, className: 'pg-field', style: { padding: '2px 6px' }, disabled: !!disabled },
				(v && options.indexOf(v) === -1 ? options.concat([v]) : options).map((m) => React.createElement('option', { key: m, value: m }, modeLabel(m))),
			);

			// ── 「动作 + 失败后」控件组：**六处共用**的唯一实现 ─────────────────────────
			//
			// 六处：分类标题行 / command 的「其余情况」/ 八档子设置 / 例外行 / 快捷工具行 / 兜底。
			// 每一处都是「选一个动作；若选了自动审批，紧跟着选它失败后怎么办」这两件**同一组**控件。
			//
			// ── 为什么必须收敛成一个组件（这不是「少写几行」的问题）────────────────────
			// 收敛前这组控件是**手抄**的：分类块两处各写一遍 `sel(...)` + 一个三元 span +
			// 一个三元 sel(...)，逐字相同。后果是加 `auto` 那一档时**必须记住改六处**，
			// 而实测漏过两次：
			//   · command 的「其余情况」漏掉（那一处把动作下拉放在块底部，与标题行是两套渲染）
			//     → 「执行命令」设为自动审批后回落值无处可设，面板上根本看不到那个下拉框；
			//   · 例外行 / 快捷工具行 / 兜底 / 八档子设置**从来没有**回落值选择器
			//     → 那四处能选 auto，但回落值只能用隐含默认 ask，用户在面板上改不了，
			//       而面板却要按 `finalActionOf(action, autoFallback)` 决定理由框显不显示
			//       —— 显示判据依赖一个用户看不见也改不了的值，是典型的「面板说谎」。
			//
			// 收敛后**漏改不再可能**：新增一档、改回落值语义、改标签位置，都只改这里一处。
			//
			// ── 参数 ──────────────────────────────────────────────────────────────────
			//   action     当前动作（'inherit' 等非 auto 值时回落值不渲染）
			//   onAction   动作变更回调（收到 event）
			//   options    动作下拉的值域（全局层 MODES / 项目层 ALL_MODES）
			//   fallback   当前回落值（'ask' | 'allow' | 'deny'）
			//   onFallback 回落值变更回调（收到 event）；**传 null = 该处不支持改回落值**
			//   disabled   busy
			//
			// `onFallback === null` 这条分支不是给未来的：新增行（「添加例外」「添加快捷工具」
			// 那两排输入框）确实**没有**可编辑的回落值 —— 它们还没有对应的已存在条目。
			// 那两处仍要显示一个**只读**的回落值提示，否则用户选了 auto 却看不到
			// 「失败后会怎样」，而提交时用的正是那个隐含值。只读比不给更能说明事实。
			const actionFallbackCtl = (action, onAction, options, fallback, onFallback, disabled) => {
				const isAuto = action === 'auto';
				// 回落值缺省 ask：与宿主 normalizeAutoFallback 的缺省**同源**（不是各写一份）
				const fbVal = fallback === 'allow' || fallback === 'deny' ? fallback : 'ask';
				return React.createElement(React.Fragment, null,
					sel(action, onAction, options, disabled),
					isAuto ? React.createElement('span', { style: { fontSize: 12, color: 'rgba(128,128,128,0.95)', whiteSpace: 'nowrap' } }, T('panel.autoFallbackLabel')) : null,
					isAuto
						? (onFallback
							? sel(fbVal, onFallback, AUTO_FALLBACK_MODES, disabled)
							// 只读态：文案与下拉一致（同一个 modeLabel），不给交互。
							// title 说明为什么不能改 —— 否则用户会去点它、以为界面坏了。
							: React.createElement('span', {
								style: { fontSize: 12, color: 'rgba(128,128,128,0.95)', whiteSpace: 'nowrap' },
								title: T('panel.autoFallbackReadonlyHint'),
							}, modeLabel(fbVal)))
						: null,
				);
			};

			// ── 长列表容器：过滤器 + 定高滚动区（快捷工具 / 例外 / 规则三处共用）──────────
			//
			// 三处的共同问题：条目数**无上界**（用户可无限添加），而面板把它们全部平铺 ——
			// 列表一长，后面的卡片被顶到很远，滚动条要拉很久才够得着。两个机制各管一件事：
			//   · 过滤器 —— 按内容快速定位到某一条（用户知道要找什么时最快）；
			//   · 定高滚动 —— 无论多少条都只占一块固定高度（用户不知道要找什么时靠翻）。
			//
			// **过滤只作用于展示**：不过滤掉的是渲染出来的行，底层数据、增删改、保存一律照旧。
			// 否则「输入过滤词 → 删除某行 → 过滤词还留着」这类状态会让用户以为删错了东西。
			//
			// 参数：
			//   items    —— 全部条目（数组）
			//   filter   —— 当前过滤词（字符串；空串 = 不过滤）
			//   onFilter —— 过滤词变更回调
			//   match    —— (item) => string，返回该条目用于匹配的文本（调用方决定搜哪些字段）
			//   render   —— (item) => ReactNode，渲染单行
			//   empty    —— 底层没有条目时显示的节点（与「过滤后无匹配」区分开）
			//
			// 曾有第 7 个参数 hint（渲染在过滤框右侧的说明行），三处调用点一个都没传，
			// 属只写不读的死参数 —— 三处列表的说明行都在各自的卡片标题下，位置比这里更合适。
			//
			// 参数（续）：
			//   sort —— 可选，排序能力。**只有「顺序即优先级」的列表才传**（规则 / 例外）：
			//           判定链是「首条命中即返回」，数组顺序就是优先级。
			//           快捷工具不传 —— 它按名字查表，顺序与判定无关，给排序按钮反而是误导。
			//           形状 { drag, onDrag, onMove }：
			//             drag   —— 当前拖动状态 { id, overId, pos } 或 null；
			//             onDrag —— 更新该状态（null = 拖动结束）；
			//             onMove —— (id, anchorId, position) => void，position 为 'before' | 'after'。
			//           拖动状态**由调用方持有**，不能存在 listBox 内部：listBox 是普通函数，
			//           而三处调用中有一处（例外）位于「展开/折叠」的条件分支里 —— 在里面调
			//           useState 会让 hook 数量随折叠状态变化，React 直接抛
			//           「Rendered more hooks than during the previous render」。
			//           listBox 只负责**算**（谁还能上移/下移、落点画在哪一行），按钮与事件
			//           由调用方插进自己的行里 —— 行内布局归调用方，容器不替它决定。
			//           故 render 多收一个参数：render(item, sortUi)。sortUi 为 null = 本列表无排序。
			//   scrollRef —— 可选，挂到滚动区容器上的 ref（可以是 ref 对象或 callback ref）。
			//           **滚动动作由调用方在自己的 effect 里做**，listBox 只负责把 ref 挂上去。
			//           例外列表那处传的是 callback ref（按分类各存一个元素）：它的调用点位于
			//           「展开/折叠」的条件分支里，且多个分类默认同时展开 —— 共用一个 ref 对象
			//           会让 current 只指向最后挂载的那个，滚动落到别的分类的列表上。
			//
			//           为什么不在 listBox 内部 useRef + useEffect 自己滚：listBox 是普通函数，
			//           而例外列表那处调用位于「展开/折叠」的**条件分支**里（见 catBlock）。
			//           在里面调 hook 会让 hook 数量随折叠状态变化，React 直接抛
			//           「Rendered more hooks than during the previous render」。
			//           这不是理论风险：本轮就是这么写的，regressions 的渲染断言当场崩了
			//           （React.useRef is not a function —— 桩里没有，但真 React 会抛上面那条）。
			const listBox = (o) => {
				const all = Array.isArray(o.items) ? o.items : [];
				const q = String(o.filter || '').trim().toLowerCase();
				// 匹配是**不区分大小写**的纯子串：用户输 `job` 要能命中 job_list / job_output。
				// 不做 glob / 正则：那是给「按模式筛」的场景用的，而这里用户只想快速缩范围；
				// 引入正则还会让 `*`、`(` 这类字符变成语法，用户输进去反而匹配不到东西。
				const shown = q ? all.filter((it) => String(o.match ? o.match(it) : '').toLowerCase().indexOf(q) !== -1) : all;
				// 排序：只在调用方传了 sort 时启用（见上方参数说明）。
				//
				// **↑↓ 与拖动都以「可见序列」（shown）为准**，不是底层数组：过滤态下用户看不见
				// 被滤掉的行，若按底层相邻项移动，按一次 ↑ 可能视觉上毫无变化（交换了一个看不见的
				// 条目）—— 那看起来就是按钮坏了。按可见序列移动则每次都必定跨过一条看得见的行。
				// 代价：被滤掉的行会被「跳过」，即它们的相对位置不变、但与被移动项的距离变了。
				// 这是有意的 —— 用户对看不见的东西无法有意图。
				const sort = o.sort || null;
				const drag = sort && sort.drag ? sort.drag : null;
				const sortUiOf = (it, i) => {
					if (!sort || !it || it.id === undefined || it.id === null) return null;
					const id = it.id;
					const prev = i > 0 ? shown[i - 1] : null;
					const next = i < shown.length - 1 ? shown[i + 1] : null;
					return {
						// 本行是否正被拖动（画半透明，让用户看清「东西被拿起来了」）
						dragging: !!(drag && drag.id === id),
						// 落点：'before' / 'after' / null。只画在**别人**身上（自己身上没有落点）
						over: (drag && drag.id !== id && drag.overId === id) ? drag.pos : null,
						canUp: !!(prev && prev.id !== undefined),
						canDown: !!(next && next.id !== undefined),
						// 上移 = 放到上一个可见条目之前；下移 = 放到下一个可见条目之后。
						// 两个方向都归约到同一个原语（anchor + position），宿主侧只有一份实现。
						onUp: () => sort.onMove(id, prev.id, 'before'),
						onDown: () => sort.onMove(id, next.id, 'after'),
						// HTML5 拖放（不用 Pointer Events 手算坐标）：列表项是等高的普通块，
						// 浏览器自带「按住移动 → 目标元素持续派发 dragover」这套机制，比自己
						// 追踪指针位置再命中测试简单得多，也不会与滚动区抢指针事件。
						// 代价是触屏不支持 —— 那由 ↑↓ 按钮兜住（两者都归约到同一个 onMove）。
						dragProps: {
							draggable: true,
							onDragStart: (e) => {
								// 必须写 dataTransfer：Firefox 下不写则后续 dragover/drop 根本不派发。
								// 内容本身不参与判定（判定用的是 state 里的 drag.id），只为让拖动成立。
								try { e.dataTransfer.setData('text/plain', String(id)) } catch (err) {}
								try { e.dataTransfer.effectAllowed = 'move' } catch (err) {}
								sort.onDrag({ id: id, overId: null, pos: null });
							},
							onDragOver: (e) => {
								if (!drag || !drag.id || drag.id === id) return;
								// 不 preventDefault 就等于「这里不接受放置」，浏览器不会派发 drop
								try { e.preventDefault() } catch (err) {}
								try { e.dataTransfer.dropEffect = 'move' } catch (err) {}
								const r = e.currentTarget.getBoundingClientRect();
								// 落点按行的**中线**分上下半：这是拖动排序的通用手感（拖到上半 = 插到它前面）
								const pos = (e.clientY - r.top) < r.height / 2 ? 'before' : 'after';
								// 去重：dragover 每秒派发几十次，每次都 setState 会把面板整体重渲染
								if (drag.overId !== id || drag.pos !== pos) sort.onDrag({ id: drag.id, overId: id, pos: pos });
							},
							onDrop: (e) => {
								try { e.preventDefault() } catch (err) {}
								if (drag && drag.id && drag.overId === id && drag.pos) sort.onMove(drag.id, id, drag.pos);
								sort.onDrag(null);
							},
							// 拖到列表外松手 / 按 Esc 取消：清掉拖动态，否则落点指示会一直留着
							onDragEnd: () => sort.onDrag(null),
						},
					};
				};
				// 过滤框的显示判据：条目够多（>3，两三条还要先过滤是负担）**或**当前有过滤词。
				// 两个条件缺一不可，且都不能换成「过滤后的数量」：
				//   ① 只按 all.length 判断 —— 用户可在过滤状态下删条目，把列表降到 ≤3 条，
				//      输入框随之消失，而 state 里的过滤词还在，列表只剩「没有匹配的条目」。
				//      此后新加的每一条都被这个看不见的词挡掉，用户只能刷新页面（实测复现：
				//      4 条时输 `alpha` → 删到 2 条 → 过滤框消失、过滤词仍在）。
				//   ② 只按 shown.length 判断 —— 输入一个字把结果缩到 1 条时输入框自己消失，
				//      用户同样清不掉过滤词（这是原注释已经记下的坑）。
				// 故「有过滤词就一定要留着输入框」是硬要求：它是用户清空过滤词的**唯一**入口。
				return React.createElement('div', null,
					(all.length > 3 || q) ? React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 } },
					React.createElement('input', {
						className: 'pg-field',
						style: { maxWidth: 200, fontSize: 12 },
						placeholder: T('panel.listFilterPh'),
						value: o.filter || '',
						onChange: (e) => o.onFilter(e.target.value),
						disabled: busy,
					}),
					q ? React.createElement('span', { style: { fontSize: 11, color: 'rgba(128,128,128,0.85)' } },
						T('panel.listMatchCount').replace('{n}', String(shown.length)).replace('{m}', String(all.length))) : null,
				) : null,
					all.length === 0
						? o.empty
						: (shown.length === 0
							? React.createElement('div', { style: { fontSize: 12, color: 'rgba(128,128,128,0.7)' } }, T('panel.listNoMatch'))
							// 滚动区：maxHeight + overflowY:auto。用 maxHeight 而非 height ——
							// 条目少时容器按内容收缩，不出现一块空白（那样看起来像加载失败）。
							// 显式传下标（而不是 `shown.map(o.render)`）：render 的第二个参数是
							// 排序上下文，靠 map 的隐式下标传参虽然等价，但读代码的人看不出
							// 「render 还能收第二个参数」，改动时容易把它当无用参数删掉。
							: React.createElement('div', { ref: o.scrollRef, style: { maxHeight: LIST_SCROLL_MAX_H, overflowY: 'auto', overflowX: 'hidden' } }, shown.map((it, i) => o.render(it, sortUiOf(it, i))))),
				);
			};

			// 排序行的两个共用件（规则 / 例外两处列表都用，避免各写一份而手感分叉）。
			//
			// 为什么是**两个**函数而不是一个包装组件：落点指示要画在行自己身上（那行的
			// 上/下边缘），而 ↑↓ 按钮要排在行的按钮区里（与「删除」并排）。前者是行根节点的
			// props，后者是行内部的子节点，位置不同、没法由一个组件同时提供。
			//
			// 行根节点的排序 props：拖动手柄 + 落点指示 + 拖动中半透明。
			// 没有 sortUi（无排序能力 / 该项没有 id）时返回**空对象**，调用方照样 spread —— 
			// 于是「这行不支持拖动」表现为 draggable 缺席，而不是一个 draggable=false 的行。
			//
			// **style 必须无条件给出**（先铺 rowStyle 再叠加排序态）：只在拖动/落点两个分支里
			// 设 style 的话，正常态的规则行与例外行会**丢掉整个 rowStyle** —— 行退化成没有
			// flex 布局、没有内边距、没有分隔线的裸块，多个条目的文字会挤成一团。
			// 这个 bug 不报错、不影响任何行为断言（只有渲染出来才看得见），故在注释里点明。
			// `extraClass` 会**追加**到 'pg-row-drag' 后面，而不是被它覆盖。
			//
			// 为什么需要这个参数：调用方常写成 `Object.assign({ className: 'x' }, sortRowProps(ui))`，
			// 但 Object.assign 是**后者覆盖前者** —— sortRowProps 里那句
			// `st.className = 'pg-row-drag'` 会把调用方给的类名整个抹掉，
			// 于是 .pg-exc 那套网格布局根本没生效（实测：例外行渲染出的是
			// pg-exc-dot/pg-exc-edit 这些子元素，但父节点没有 .pg-exc，
			// 表现为「行还是老样子、只有内容换了」）。
			// 调用方也可以把 className 写在 Object.assign 之后，但那要求每个调用点都记住
			// 这个顺序陷阱；由本函数合并类名更稳。
			const sortRowProps = (ui, extraClass) => {
				if (!ui) return extraClass ? { className: extraClass } : {};
				const st = Object.assign({}, ui.dragProps);
				st.className = extraClass ? 'pg-row-drag ' + extraClass : 'pg-row-drag';
				st.style = rowStyle;
				if (ui.dragging) st.style = Object.assign({}, rowStyle, { opacity: 0.45 });
				else if (ui.over) {
					// 落点线画在行的哪条边：'before' = 上边、'after' = 下边。
					// 用 boxShadow 的 inset 而不是 border —— 加 border 会把行撑高 2px，
					// 拖动经过时整列会跟着抖（相邻行的位置在拖动过程中反复变化）。
					st.style = Object.assign({}, rowStyle, { boxShadow: 'inset 0 ' + (ui.over === 'before' ? '2px' : '-2px') + ' 0 0 ' + MODE_COLORS.ask });
				}
				return st;
			};
			// ↑↓ 按钮。触屏没有 HTML5 拖放，这两个按钮是**唯一**的排序入口，故不能只当辅助。
			// 首/末行分别禁用对应方向（而不是隐藏）：隐藏会让同一位置的按钮在相邻行之间跳，
			// 用户点到一半会点错行；禁用则位置恒定，且「到顶了」这件事一眼可见。
			const moveButtons = (ui) => {
				if (!ui) return null;
				const mk = (dir, can, fn, label) => React.createElement('button', {
					className: 'pg-btn pg-btn-move',
					disabled: busy || !can,
					title: label,
					'aria-label': label,
					onClick: fn,
				}, dir);
				return React.createElement('span', { style: { display: 'inline-flex', gap: 2 } },
					mk('↑', ui.canUp, ui.onUp, T('panel.moveUp')),
					mk('↓', ui.canDown, ui.onDown, T('panel.moveDown')),
				);
			};

			// command 分类的子设置行「破坏性命令」。
			// 两个要点体现在界面上：
			//   ① 它**独立于**上方「默认动作」—— 默认动作设为「允许」时它仍生效（更细优先于更粗），
			//      所以它不随 mode 隐藏；
			//   ② 一行说清它管什么（删除/格式化/关机/提权这类命令）。
			//
			// 名单（chgrp/chmod/rm/… 那份内置清单）**不在界面上列出**：它只读、不可编辑，
			// 逐个列出来占掉四行却给不出可操作的信息，而「哪些命令算破坏性」的权威定义在
			// shell-parse.js 的 DESTRUCTIVE_LABELS。宿主仍照旧下发 labels（statusView），
			// 需要时可在别处展示；这里只留一行说明它管哪类命令。
			//
			// 第三行是**能力边界说明**（subDestructiveNote）：名单靠命令文本识别，不可能
			// 穷尽所有写法（脚本文件、编码混淆、间接调用都读不出来）。必须写出来，否则
			// 用户会把「没弹窗」当成「这条命令被检查过且安全」—— 而实际可能是根本没识别出来。
			// 这与「名单不列出」不冲突：那句是「不列内容」，这句是「说清它拦不住什么」。
			//
			// 这里曾有一行「当前生效：询问（全局设置）」。删掉的理由：它与上方那个下拉框
			// 显示的是**同一个值**（下拉框本来就按本层渲染，项目层未配置时显示 inherit），
			// 于是它只在复述用户刚看到的东西。它当初想回答的「这个值来自哪一层」，现在
			// 由本行在分类内的位置间接表达（排在例外之后 = 判定链上晚于例外）。
			// 代价是「生效值到底取自全局还是本项目」在项目 tab 上不再直说 —— 那一点改由
			// 下拉框自身的取值表达（显示 inherit = 本层未表态、穿透全局）。
			// 八档的**默认折叠**：用户明确偏好简洁，而八行下拉框会把面板撑长。
			// 折叠态的信息由展开链接文字里的**动作计数摘要**承载（`拒绝 2 · 询问 5`），
			// 展开才出现下拉框与逐档状态点。折叠时八档全收起 —— 不留 inside 特例。
			//
			// 分两组展示（按目标范围 / 按命令类别）是因为**判据不同** —— 用户需要知道
			// 「这一档是按目标范围判的，还是按命令名判的」。这决定了它什么时候会生效。
			//
			// `hint` 是**行内标签之外**的完整判据，渲染成 title 悬浮：行内标签要短（八行对齐、
			// 扫得快），而判据要完整（用户得知道「怎么算盘根」）。
			const SUB_TIER_META = [
				// 半径组：按目标范围判
				{ t: 'inside', g: 'radius', label: 'panel.tierInside', hint: 'panel.tierInsideHint' },
				{ t: 'outside', g: 'radius', label: 'panel.tierOutside', hint: 'panel.tierOutsideHint' },
				{ t: 'wide', g: 'radius', label: 'panel.tierWide', hint: 'panel.tierWideHint' },
				{ t: 'unknown', g: 'radius', label: 'panel.tierUnknown', hint: 'panel.tierUnknownHint' },
				// 组档：按命令名判（半径判据对它们恒 null —— 伤害对象是进程/电源/注册表）
				{ t: 'proc', g: 'group', label: 'panel.tierProc', hint: 'panel.tierProcHint' },
				{ t: 'power', g: 'group', label: 'panel.tierPower', hint: 'panel.tierPowerHint' },
				{ t: 'priv', g: 'group', label: 'panel.tierPriv', hint: 'panel.tierPrivHint' },
				{ t: 'reg', g: 'group', label: 'panel.tierReg', hint: 'panel.tierRegHint' },
			];
			// 档位清单以宿主下发为准（`status.commandSub.tiers`），不写死八个名字：
			// 日后新增一档时客户端自动跟上，不会因为漏改这里而静默少渲染一个下拉框。
			// 宿主没下发时回落到 SUB_TIER_META 的顺序（协议异常兜底，不是决策链的一环）。
			const subTierList = () => {
				const fromHost = status && status.commandSub && Array.isArray(status.commandSub.tiers) ? status.commandSub.tiers : null;
				if (!fromHost || !fromHost.length) return SUB_TIER_META;
				// 宿主清单为准，但保留 SUB_TIER_META 里的分组与文案（它们只在客户端用）
				const meta = {}
				for (const m of SUB_TIER_META) meta[m.t] = m
				return fromHost.map((t) => meta[t] || { t: t, g: 'group', label: null, hint: null })
			};
			// 该层某档当前的**动作**（含未配置时的推导默认值）。状态点与下拉框共用，
			// 两处取值必须同源 —— 各算一次的话，点的颜色可能与下拉框里的字不一致。
			const subActionOf = (tier) => (subDestructive[tab] || {})[tier] || (tab === 'project' ? 'inherit' : 'ask');
			// 该档的**生效回落值**（宿主下发，只有该档是 auto 时才可能非空）。
			// 项目 tab 取 `effective.autoFallbacks`（按当前项目算，含穿透全局的结果），
			// 全局 tab 取 `globalAutoFallbacks`（全局层单独解析）—— 与 `effOf` 的分派
			// 完全同源，理由同 globalEffectiveProbe：全局 tab 不能用按当前项目算的值。
			//
			// 项目 tab 显示的是 `inherit` 时（本层未表态），回落值必须取**穿透后**的生效值
			// —— 因为裁决确实会用全局那一档的回落值，面板的判据也得跟着走。
			const subAutoFallbackOf = (tier, st, t) => {
				const src = st || status;
				const cs = src && src.commandSub;
				if (!cs) return null;
				const m = (t || tab) === 'global' ? cs.globalAutoFallbacks : cs.autoFallbacks;
				const v = m ? m[tier] : null;
				return v === 'allow' || v === 'deny' ? v : 'ask';
			};
			// 子设置的**回落值**写入单点（/permgate/set-command-sub 的 autoFallback 参数）。
			// 只改这一个字段、不动动作：与分类的 changeCatAutoFallback 同构。
			//
			// 必须把 action 一起带上（值取该档**当前**动作）：宿主的 setCommandSub 用
			// `action` 决定该档是不是 auto，非 auto 时回落值会被直接丢掉 —— 只传
			// autoFallback 而不传 action 会让这次写入**静默失效**（面板显示改了、磁盘没变）。
			const changeSubAutoFallback = (tier) => (e) => {
				const v = e.target.value;
				invoke('permgate:set-command-sub', { target: tab, tier: tier, action: subActionOf(tier), autoFallback: v },
					() => setMsg(tab === 'global' ? T('panel.savedToGlobal') : T('panel.savedToProject')));
			};
			// 折叠摘要**由实际生效值生成**，不能写死「均为询问」。
			//
			// | 情形 | 摘要 |
			// |---|---|
			// | 八档全部相同 | `均为「拒绝」` / `均为「询问」` |
			// | 有差异 | `拒绝 2 · 询问 5 · 穿透 1`（按动作分组计数） |
			//
			// **写死摘要等于让面板说谎** —— 与 statusView 那段注释记录的教训同构
			// （曾经写死 `|| 'ask'`，导致 global command=deny 的用户看到面板显示「询问」
			// 而实际裁决是拒绝）。
			//
			// 有差异时给**计数**而不是逐档罗列（`工作区外 询问 / 大范围 拒绝 / …`）：
			// 罗列在八档各不相同时会超过一行（实测被截断），而折叠态要回答的只是
			// 「有没有哪档被设成了意外的值」—— 计数就能回答（看到「拒绝 2」说明有两档在拒）。
			// 具体是哪两档，展开看行左侧的状态点。
			//
			// ── 计数覆盖**全部八档**（含 inside）──────────────────────────────────
			// 曾经排除 inside，理由是「它在折叠态本来就有一行可见可改，算进去会与那行
			// 的下拉框重复表达同一件事」。**那个理由随折叠态改成「八档全收起」而失效了** ——
			// 现在折叠态一行档位都看不见，摘要成了唯一的信息出口。
			//
			// 而且排除它会造成一个实打实的错位：摘要里的数字加起来是 7，
			// 展开后却是 8 行 —— 用户会以为漏渲染了一档。摘要描述的就是「展开后你将看到
			// 的那八行」，两边必须对得上。
			const subCollapsedSummary = () => {
				const tiers = subTierList()
				const cur = subDestructive[tab] || {}
				// 按出现顺序分组计数（顺序稳定 → 摘要不会因为对象键序变化而抖动）
				const order = []
				const count = {}
				for (const m of tiers) {
					const v = cur[m.t]
					if (v === undefined) continue
					if (count[v] === undefined) { count[v] = 0; order.push(v) }
					count[v] += 1
				}
				if (order.length === 1) {
					return T('panel.tierRestAll').replace('{v}', modeLabel(order[0]))
				}
				const parts = order.map((v) => T('panel.tierCount').replace('{v}', modeLabel(v)).replace('{n}', String(count[v])))
				return T('panel.tierRestMixed').replace('{list}', parts.join(' · '))
			};
			// 单档一行：状态点 + 标签 + [理由框?] + 下拉框。八档共用，避免八份重复代码漂移。
			//
			// 布局走 `.pg-tier` 那个三列网格（不是 flex + space-between）：
			// 网格保证八行的第三列右边缘落在同一条线上，于是八个下拉框**严格对齐**。
			// 用 flex 时每行各自算宽度，标签长短不一会让下拉框左右参差（上一版的样子）。
			//
			// `dim`：按命令名判的四档（proc/power/priv/reg）标签降一档灰度 ——
			// 它们的判据与上面四档不同（没有路径目标），分组标题之外再给一个弱提示。
			const subTierRow = (m, dim) => {
				const tier = m.t
				const action = subActionOf(tier)
				// 理由框的显示条件是**该档最终会拒绝**（不是 `action === 'deny'`）——
				// `auto + 回落 deny` 在执行侧就是一次拒绝，宿主也会存它的理由，
				// 面板必须给框（否则用户根本写不了）。判据见 finalActionOf 的注释。
				// 实际不会同时出现 8 个框（只有会拒绝的档才有），通常 1~3 个。
				const showReason = finalActionOf(action, subAutoFallbackOf(tier)) === 'deny'
				const label = m.label ? T(m.label) : tier
				// 悬浮给**完整判据**（行内标签是短的，判据是长的 —— 见 i18n 处的说明）。
				const hint = m.hint ? T(m.hint) : label
				return React.createElement('div', {
					key: tier,
					className: 'pg-tier',
				},
					// 状态点：颜色 = 该档当前动作。悬停给「档位名：动作」。
					// 它是**展开态**识别「哪一档在拒」的主要手段（摘要只给计数）。
					React.createElement('span', {
						className: 'pg-tier-dot',
						style: { background: MODE_COLORS[action] || '#888' },
						title: T('panel.tierDotTitle').replace('{t}', label).replace('{v}', modeLabel(action)),
					}),
					React.createElement('span', {
						className: 'pg-tier-label',
						style: dim ? { color: 'rgba(128,128,128,0.95)' } : null,
						title: hint,
					}, label),
					React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
						reasonInput(
							(subReasons[tab] || {})[tier],
							(e) => setSubReasons(Object.assign({}, subReasons, {
								[tab]: Object.assign({}, subReasons[tab], { [tier]: e.target.value }),
							})),
							commitSubReason,
							showReason,
							// key 就是**档位名** —— 八档各占一个编辑态，不会互相串（见 reasonKeyOf）
							{ kind: 'sub', tab: tab, key: tier },
							() => revertReason('sub', tier),
						),
						// 动作 + 失败后：走共用组件。这一处**此前没有**回落值选择器 ——
						// 八档能选 auto，回落值却只能用隐含默认 ask，用户在面板上改不了；
						// 而 showReason 又按 finalActionOf 依赖那个值（看不见也改不了）。
						actionFallbackCtl(action, changeSubDestructive(tier), tab === 'project' ? ALL_MODES : MODES,
							subAutoFallbackOf(tier), changeSubAutoFallback(tier), busy),
					),
				)
			};
			// 某分类在本 tab 的**显示值**：本层未配置时，项目层回落 `inherit`（它下面还有
			// 全局层可穿透），全局层回落 `ask`（它下面没有别的层，`inherit` 在宿主侧非法）。
			//
			// 单一实现：catBlock 的标题行与 commandRestRow（「其余情况」）都调它。曾经两处
			// 各写一份逐字相同的表达式，那让「同一概念两个修改点」—— 日后只调一处（例如改
			// 回落语义）就会让 command 的默认动作在界面两处显示成两个值，且不报错、无断言拦。
			const catModeOf = (c) => {
				const layer = cats[tab];
				return (layer && layer[c]) || (tab === 'project' ? 'inherit' : 'ask');
			};
			const commandSubRow = () => {
				const tiers = subTierList()
				const radius = tiers.filter((m) => m.g === 'radius')
				const groups = tiers.filter((m) => m.g === 'group')
				const summary = subCollapsedSummary();
				return React.createElement('div', { style: { borderTop: '1px dashed rgba(128,128,128,0.35)', marginTop: 6, paddingTop: 6 } },
					React.createElement('div', { className: 'pg-tier-head' },
						React.createElement('span', { className: 'pg-tier-title' }, T('panel.subDestructive')),
					),
					// 说明行独立成行：与标题同排时说明文字会折行，并与摘要串在一起。
					React.createElement('div', { className: 'pg-tier-hint' }, T('panel.subDestructiveHint')),
					// 展开/折叠入口：**与上方例外列表同一套交互**（左对齐蓝字链接 + ▸/▾ 前缀）。
					// 摘要放进链接文字里，与 `▸ 例外列表（18 条）` 同构 ——
					// 展开后摘要自然消失（那时八行都看得见，摘要就是多余的，
					// 例外列表同样在展开后不再显示条数）。
					//
					// 曾经是标题行最右端的一个按钮：隔着整行空白，用户的视线扫过标题、
					// 说明、档位行之后根本注意不到（实测反馈「展开在右边也注意不到」）；
					// 而且同一个面板里两套交互并存，用户得学两遍。
					React.createElement('div', {
						className: 'pg-tier-link',
						onClick: () => { if (!busy) setSubExpanded(!subExpanded) },
						title: subExpanded ? T('panel.tierCollapse') : T('panel.tierExpand'),
					}, subExpanded
						? '▾ ' + T('panel.tierCollapse')
						: '> ' + T('panel.tierExpandAll').replace('{s}', summary)),
					// **折叠时八档全收起**（不是只收起七档）：八个档在判定链上是**平级**的，
					// 单留一档会让它看起来像「主设置 + 七个附属」，而它其实只是八分之一。
					// 折叠态的信息由链接文字里的摘要承载（`▸ 展开（询问 3 · 拒绝 3）`），
					// 要看具体哪一档就展开 —— 与例外列表的取舍完全一致。
					subExpanded ? React.createElement('div', { className: 'pg-tier-box' },
						radius.map((m) => subTierRow(m, false)),
						// 分两组展示是因为**判据不同**：上四档按目标范围判，下四档按命令名判。
						// 用户需要知道「这一档是按目标范围判的，还是按命令名判的」——
						// 那决定了它什么时候会生效（`kill 1234` 没有路径目标，半径判据对它恒 null）。
						//
						// 只给下四档加分组标题、上四档不加：上四档是本列表的主体，
						// 标题只会多占一行；分隔线画在**判据切换处**才有信息量。
						React.createElement('div', { className: 'pg-tier-group' }, T('panel.tierGroupName')),
						groups.map((m) => subTierRow(m, true)),
					) : null,
					// 能力边界说明：独立一行、灰小字。不放进上面那个 span（与标题同行会被挤成
					// 一长串，而它要传达的是「别高估这道闸」，值得单独一行让人读到）。
					React.createElement('div', { style: { fontSize: 11, color: 'rgba(128,128,128,0.85)', marginTop: 5 } }, T('panel.subDestructiveNote')),
				);
			};

			// command 分类的第三层，也是**最后一道闸门**：「其余情况」。
			//
			// 它承载的就是这个分类的**默认动作** —— 走 set-categories、同一份状态
			// `cats[tab].command`、同一个 changeCat / commitCatReason。只是被画到了块底部、
			// 换了个名字。**不新增任何落盘形状，宿主侧一个字不改。**
			//
			// ── 为什么独立成函数而不是内联进 catBlock ────────────────────────────
			// 与 commandSubRow 对称：两者都是「只在 command 上渲染的一行」、都排在例外块
			// 之后。放在一起也让 regressions 那条位置断言有个稳定锚点可切。
			//
			// ── 视觉沿用「破坏性命令」那一套（.pg-tier-title）────────────────────
			// 小节名 12px/600，比分类名的 13px/600 低半级；外层同样是 borderTop 虚线。
			// 于是三块之间的分隔与层级读法完全一致：分类名 > 小节名（破坏性命令 /
			// 其余情况）> 说明字。
			//
			// **不给它加 hint 行**：破坏性命令有 hint 是因为「哪些命令算破坏性」必须说清；
			// 「其余情况」四个字已经自解释（例外没命中、破坏性命令没命中 → 就剩它），
			// 再加一句「以上都不匹配时」是废话。
			//
			// 也不弱化成灰小字：它是这个分类里最常改的控件，弱化后用户可能压根没发现
			// 那里有个下拉框（面板上「展开在右边也注意不到」那类实测反馈就是这么来的）。
			const commandRestRow = () => {
				// 取值走 catModeOf 单一实现（与 catBlock 标题行**同一个函数**，不是抄一份
				// 逐字相同的表达式）：两处若各自维护，日后只调一处（例如改 project 层
				// 未配置时的回落语义）就会让同一个值在界面两处显示成两个样子。
				const mode = catModeOf('command');
				return React.createElement('div', { style: { borderTop: '1px dashed rgba(128,128,128,0.35)', marginTop: 6, paddingTop: 6 } },
					React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
						React.createElement('span', { className: 'pg-tier-title' }, T('panel.subRest')),
						React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
							// 与标题行那套**同一个组件、同一个 focus key**：拒绝原因仍按
							// `{ kind: 'cat', tab, key: 'command' }` 定位 —— 移到块底部不改变它的
							// 身份，否则同一格会出现两个编辑态，或点「编辑」找不到草稿。
							reasonInput(
								catReasons[tab] ? catReasons[tab].command : '',
								(e) => setCatReasons(Object.assign({}, catReasons, { [tab]: Object.assign({}, catReasons[tab], { command: e.target.value }) })),
								commitCatReason('command'),
								// 分类默认值最终会拒绝时才有拒绝原因（`auto + 回落 deny` 也算，
								// 判据见 finalActionOf 的注释）。
								finalActionOf(mode, catAutoFallbackOf('command')) === 'deny',
								{ kind: 'cat', tab: tab, key: 'command' },
								// 取消：把草稿还原成服务端当前值（不是清空 —— 用户可能只是改错了想放弃）
								() => revertReason('cat', 'command'),
							),
							// 动作 + 失败后：走**共用组件** actionFallbackCtl（六处同一实现）。
							// 这一处曾经因为 command 把动作下拉放在块底部而**漏掉回落值选择器**
							// ——「执行命令」设为自动审批后回落值无处可设，面板上看不到那个下拉框。
							// 收敛成组件后这种「某处漏掉」在结构上不再可能。
							actionFallbackCtl(mode, changeCat('command'), tab === 'project' ? ALL_MODES : MODES,
								catAutoFallbackOf('command'), changeCatAutoFallback('command'), busy),
						),
					),
				);
			};

			// 命令类工具的**管辖边界**说明。它**不属于任何一个分类块**，而是排在
			// 「执行命令」块与其余分类之间的**独立分隔说明** —— 因为它讲的正是
			// 「命令这一类与下面那些文件类分类之间的边界」这件事，两边都不归属。
			//
			// 为什么不放在 command 块内部：放进去后它会被读成「命令块的脚注」，
			// 而它要提醒的恰恰是「下面那些分类管不到命令」—— 信息方向是**朝下**的。
			// 放在两块之间，用户从命令块往下一路读过去时正好撞上它。
			//
			// 为什么必须有这一行：命令工具的判定链与六道文件/路径分类闸**毫无交集**
			// （实测：区外写闸=deny、编辑=deny 时，`Set-Content G:/outside/x.txt` 与
			// `Get-Content G:/outside/secret.txt` 仍判 allow）。而面板把九个分类平铺，
			// 命令块又排在最前，很容易让人得出「区外写设成拒绝就安全了」这个错误结论。
			//
			// 只出现一次（不挂到每个文件类分类上）：同一句话重复五遍会让面板更长，
			// 而它讲的是同一条边界，说一遍就够。
			const commandScopeNote = () => {
				return React.createElement('div', { style: { fontSize: 12, color: 'rgba(128,128,128,0.9)', lineHeight: 1.5, margin: '0 0 12px 2px' } },
					T('panel.cmdScopeNote'),
				);
			};


			// 循环检测（doomloop）阈值行 + 状态提示。
			// 与「破坏性命令」子设置的区别：那个是**动作**（三态），这个是**数字**，故不复用 sel()。
			// 三个要点：
			//   ① 阈值与动作分两处写：动作走 set-categories，阈值走 set-doomloop。两处的空值语义
			//      不同（阈值空串 = 清除回落默认，动作没有「空」这一态），混在一起会出现
			//      「只想改阈值却把动作也重写了一遍」的副作用。
			//   ② 校验与宿主同口径（正整数、**无上限**）：不做上限钳制，否则会出现
			//      「面板显示 999、实际按 100 跑」那类双份钳制。非法值只提示、不提交。
			//   ③ 关闭提示与 deny 误判警告都在这里给：动作本身在别的行，但那两种状态下用户最需要
			//      知道的信息就在这一行旁边。
			const doomloopRow = () => {
				const dl = (status && status.doomloop) || {};
				// placeholder 显示「本层未配置时实际会用的值」，故按 tab 取不同的来源：
				//   · 项目 tab → 生效值（effective.threshold）：可能来自全局，正是要显示的那个；
				//   · 全局 tab → 内置默认值：全局层下面没有别的层，未配置时用的就是它。
				// 全局 tab 不能用 effective —— 它是按**当前项目**算的（doomloopSetting(root)
				// 项目优先），于是「全局未配置 + 当前项目设了 10」时会显示 10，那是项目的值，
				// 不是全局的值（反向的面板说谎）。
				const effN = dl.effective && typeof dl.effective.threshold === 'number' ? dl.effective.threshold : null;
				const dfltN = typeof dl.defaultThreshold === 'number' ? dl.defaultThreshold : 6;
				const defN = tab === 'global' ? dfltN : (effN !== null ? effN : dfltN);
				// 下限由宿主下发（doomloop.min）—— 不在客户端写死字面量：那会让下限出现第二份来源，
				// 宿主把 MIN_REPEAT_STREAK 调大后面板仍按旧下限归一，提交值与落盘值分叉
				// （面板显示 1、实际按 2 裁决）。缺字段时回退 1 只是协议异常兜底，不是决策链一环。
				const minN = typeof dl.min === 'number' && dl.min > 0 ? dl.min : 1;
				// 本层动作：取 cats 的当前值（与上方下拉同源），项目层 inherit 时穿透全局
				const catMode = tab === 'global'
					? ((cats.global && cats.global.doomloop) || 'ask')
					: ((cats.project && cats.project.doomloop && cats.project.doomloop !== 'inherit') ? cats.project.doomloop : ((cats.global && cats.global.doomloop) || 'ask'));
				const commitTh = () => {
					const raw = String(loopTh[tab] || '').trim();
					// 空串 = 显式恢复默认。全局层没有 inherit（宿主对 global+inherit 会拒绝），
					// 故全局层的「空」也走同一条路径：删除该键 → 读取侧回落默认值。
					if (raw === '') {
						loopThDirty.current[tab] = false;
						invoke('permgate:set-doomloop', { target: tab, threshold: 'inherit' }, () => setMsg(T('panel.loopThresholdCleared').replace('{t}', T(tab === 'global' ? 'panel.tabGlobal' : 'panel.tabProject'))));
						return;
					}
					const n = Number(raw);
					// 与宿主 normalizeThreshold 同口径：非数字 / 非有限 / ≤0 → 拒绝（不静默回落默认）。
					// 小数向下取整后钳到**宿主下发的下限** —— 与宿主一致，避免「面板显示 1.5、实际按 1 跑」。
					if (!Number.isFinite(n) || n <= 0) { setNotice(T('panel.loopThresholdBad')); return; }
					const v = Math.max(minN, Math.floor(n));
					// 提交成功才清 dirty：invoke 失败（回 error / saveError）时保留草稿，
					// 否则用户填的值会在他还没成功保存时就被下一次 status 回填冲掉。
					invoke('permgate:set-doomloop', { target: tab, threshold: v }, () => {
						loopThDirty.current[tab] = false;
						setLoopTh((prev) => Object.assign({}, prev, { [tab]: String(v) }));
						setMsg(T('panel.loopThresholdSaved').replace('{t}', T(tab === 'global' ? 'panel.tabGlobal' : 'panel.tabProject')).replace('{n}', String(v)));
					});
				};
				return React.createElement('div', { style: { borderTop: '1px dashed rgba(128,128,128,0.35)', marginTop: 6, paddingTop: 6 } },
					React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 } },
						React.createElement('span', { style: { fontSize: 12, fontWeight: 600 } },
							T('panel.loopThreshold'),
							React.createElement('span', { style: { fontWeight: 400, color: 'rgba(128,128,128,0.85)' } }, T('panel.loopThresholdHint')),
						),
						React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
							React.createElement('input', {
								className: 'pg-field',
								style: { maxWidth: 80 },
								type: 'number',
								// min 用宿主下发的下限、**不设 max**：与宿主一致（无上限）。设了 max 会变成双份钳制。
								min: minN,
								// 文案按 tab 区分：全局 tab 显示的是内置默认值，写「实际生效」会与语义不符
								// （那里未配置时用的就是默认值）；项目 tab 显示的才是跨层生效值。
								placeholder: (tab === 'global' ? T('panel.loopThresholdPh') : T('panel.loopThresholdPhEff')).replace('{n}', String(defN)),
								title: T('panel.loopThresholdHint'),
								value: loopTh[tab] || '',
								onChange: (e) => {
									loopThDirty.current[tab] = true;
									setLoopTh(Object.assign({}, loopTh, { [tab]: e.target.value }));
								},
								onKeyDown: (e) => {
									if (e.nativeEvent && (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229)) return;
									if (e.key === 'Enter') { e.preventDefault(); commitTh(); }
								},
								disabled: busy,
							}),
							React.createElement('span', { style: { fontSize: 12, color: 'rgba(128,128,128,0.85)' } }, T('panel.loopThresholdUnit')),
							React.createElement('button', { className: 'pg-btn', style: { padding: '2px 8px', fontSize: 12 }, disabled: busy, onClick: commitTh }, T('panel.loopThresholdSave')),
						),
					),
					// 动作设为 allow = 知情关闭，但必须**说出来** —— 否则用户不知道检测已经没了
					// （面板上那一行看起来和别的分类没区别）。
					catMode === 'allow' ? React.createElement('div', { style: { fontSize: 11, color: '#bf8700', marginTop: 2 } }, T('panel.loopOff')) : null,
					// deny 不弹窗、直接中断 AI，用户不容易察觉，故用面板提示补上这个信息缺口
					catMode === 'deny' ? React.createElement('div', { style: { fontSize: 11, color: '#bf8700', marginTop: 2 } }, T('panel.loopDenyWarn')) : null,
				);
			};

			// ═══════════════════════════════════════════════════════════════════════
			// 自动审批（auto）的工程参数卡片
			// ═══════════════════════════════════════════════════════════════════════
			//
			// **只出现在全局 tab**：这些是「评审机制怎么跑」的参数（超时、熔断、缓存、
			// 模型覆盖），不是「某个项目的权限怎么定」。按项目配超时会带来荒唐的场景：
			// 同一份模型调用在不同项目里超时不同，而评审结论本身全局一致。
			// 宿主路由同样不接受 target（见 /permgate/set-auto-review 的注释）。
			//
			// 与其它设置项一致的写法：每个控件改完立刻提交（无「保存」按钮），
			// 因为这里全是单值参数，批量保存反而让用户不确定「改了没生效的是哪一项」。
			const autoReviewCard = () => {
				// 只在 auto tab 渲染 —— 但**判据不在这里**：调用点是 tab 栏之后的分流
				// （`tab === 'auto' ? autoReviewCard() : null`），此处若再判一次就是两份判据。
				// 这里只负责「拿到数据、画出卡片」，不判断「该不该画」。
				const ar = (status && status.autoReview) || {};
				const eff = ar.effective || {};
				const dflt = ar.defaults || {};
				const explicit = Array.isArray(ar.explicit) ? ar.explicit : [];
				// 数字项的值域（宿主下发，见 AUTO_REVIEW_RANGES）：缺字段时按空表处理 ——
				// 回退到写死的上下限就等于在客户端造第二份口径，正是本条要消掉的东西。
				const ranges = ar.ranges && typeof ar.ranges === 'object' ? ar.ranges : {};
				// ── 模型目录的形状 ────────────────────────────────────────────────────────
				// 宿主 `/permgate/llm-models` 照抄官方 `buildModelCatalog` 的形状：
				//   { groups: [{ id, name, models: [{ id, name, reasoning? }] }], failures }
				// 每个模型自带它公布的推理档位（`reasoning.efforts`），故推理等级那一行
				// 能显示**名称**（`Max`）而不是原始 id（`max`）。
				// 扁平 `{ providers, models, efforts }` 的形状不能要：客户端得拿「已配置的
				// provider」当查询键，而用户恰恰是在还没配过的时候打开面板 —— 于是永远空列表、
				// 下拉里只剩「跟随会话」一项。按服务商分组下发则与「配没配过」无关。
				const cat = llmCat.data || {};
				const groups = Array.isArray(cat.groups) ? cat.groups : [];
				// 扁平档位表：各模型公布档位的并集，仅作 `effortNameOf` 的兜底
				// （模型不在目录里时仍能显示档位名）。
				const efforts = [];
				{
					const seen = {};
					for (const g of groups) for (const m of (Array.isArray(g.models) ? g.models : [])) {
						const rs = m.reasoning && Array.isArray(m.reasoning.efforts) ? m.reasoning.efforts : [];
						for (const e of rs) {
							if (!e || seen[e.id]) continue;
							seen[e.id] = true;
							efforts.push({ id: String(e.id), name: String(e.name || e.id) });
						}
					}
				}
				// 实际生效的模型 / 档位（宿主下发的 target，绝不自己推）。
				const tgt = ar.target && typeof ar.target === 'object' ? ar.target : null;
				const tgtMod = tgt && tgt.model ? String(tgt.model) : '';
				const tgtProv = tgt && tgt.provider ? String(tgt.provider) : '';
				const tgtEffort = tgt && tgt.effort ? String(tgt.effort) : '';
				// ── 「这个模型有没有公布档位」必须按**当前生效的那个模型**判 ──────────────
				//
				// 不能用上面那张 `efforts` 并集：它是**全部 provider 全部模型**档位的并集，只要目录里
				// 有任意一个模型公布了档位就非空，于是「该模型不公布推理强度档位」这句提示几乎永远
				// 不会出现，用户看到一个没有「指定」组的推理等级列表却没有任何解释。
				//
				// 判据：按「这次推理等级要作用的那个模型」去目录里查它自己的 efforts。哪个模型？
				// 与组件内 `shownSel` 同一口径：配置了用配置的，没配置用生效的（跟随会话时就是
				// 会话当前模型）。这里重算一次而不是从组件里取 —— 组件是纯展示件，不该为提示文案
				// 反向暴露内部中间量。
				const effortOwner = (function () {
					const wantProv = eff.provider ? String(eff.provider) : '';
					const wantMod = eff.model ? String(eff.model) : '';
					if (wantMod) {
						for (const g of groups) {
							if (String(g.id) !== wantProv) continue;
							return (Array.isArray(g.models) ? g.models : []).find((x) => String(x.id) === wantMod) || null;
						}
						return null;   // 配了但目录里没有 → 无依据，不提示（见下）
					}
					for (const g of groups) {
						if (!tgtProv || String(g.id) !== tgtProv) continue;
						return (Array.isArray(g.models) ? g.models : []).find((x) => String(x.id) === tgtMod) || null;
					}
					return null;
				})();
				// 三种情形要分开，不能混成一个布尔：
				//   · 模型查不到（目录没取到 / 模型被删）→ **不提示**：没有依据时断言
				//     「不公布档位」是编造，何况目录失败的面更大；
				//   · 查得到且 reasoning.efforts 为空/缺省 → 提示「该模型不公布档位」；
				//   · 查得到且有档位 → 提示常规说明。
				const ownerEfforts = effortOwner && effortOwner.reasoning && Array.isArray(effortOwner.reasoning.efforts)
					? effortOwner.reasoning.efforts : null;
				const effortHintText = llmCat.loading
					? T('panel.autoModelLoading')
					: (effortOwner && (!ownerEfforts || ownerEfforts.length === 0)
						? T('panel.autoEffortNone')
						: T('panel.autoEffortHint'));
				// 提交单个字段。null = 恢复默认（宿主 delete 该键）。
				const setField = (key, value) => {
					const args = value === null ? { clear: [key] } : { patch: { [key]: value } };
					invoke('permgate:set-auto-review', args, () => setMsg(T('panel.autoSaved')));
				};
				// ── 一次提交**多个**字段（必须是一次请求，不能连着调 setField）──────────────
				//
				// 连着调 setField 会**一次用户操作发出 3 个并发 POST**：宿主每条路由都回整份 statusView，
				// invoke 收到就 applyStatus —— 三次响应互相覆盖面板状态；invoke 内部的 setBusy 会被先返回
				// 的那个提前置回 false，按钮提前可点；若其中一条落盘失败，配置停在半改状态。
				// 宿主路由同时接受 `patch` 与 `clear`（见 /permgate/set-auto-review），故这里合成一次调用。
				const setFields = (patch, clearKeys) => {
					const args = {};
					if (patch && Object.keys(patch).length) args.patch = patch;
					if (Array.isArray(clearKeys) && clearKeys.length) args.clear = clearKeys;
					if (!args.patch && !args.clear) return;
					invoke('permgate:set-auto-review', args, () => setMsg(T('panel.autoSaved')));
				};
				// ── 「全部恢复默认」按钮（含二次确认）──────────────────────────────────
				//
				// 这是本卡片里唯一会**批量删除**用户配置的入口，且没有撤销，故必须有二次确认。
				// 复用面板里已有的 confirmDelete（同一个 confirm 状态 + 4 秒自动取消）：另写一套
				// 会让「两个确认同时亮着」成为可能，且超时逻辑要写两遍。
				const resetAllButton = () => {
					if (!explicit.length) return null;
					const armed = confirm === 'auto-reset';
					return React.createElement('div', { style: { marginTop: 8, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } },
						React.createElement('button', {
							className: 'pg-btn pg-btn-danger' + (armed ? ' pg-btn-confirm' : ''),
							disabled: busy,
							onClick: () => confirmDelete('auto-reset', () => invoke('permgate:set-auto-review', { clear: explicit }, () => setMsg(T('panel.autoResetDone')))),
						}, armed ? T('panel.autoResetConfirm') : T('panel.autoReset')),
						armed
							? React.createElement('button', { className: 'pg-btn', disabled: busy, onClick: () => setConfirm(null) }, T('panel.cancel'))
							: null,
						armed
							? React.createElement('span', { style: { fontSize: 11, color: 'rgba(128,128,128,0.9)' } }, T('panel.autoResetWarn'))
							: null,
					);
				};
				// 数字输入：与宿主 normalizeAutoReview 同口径（非数字/超范围 → 拒绝，不静默回落）
				//
				// 值域取宿主下发的 `ar.ranges`（与 normalizeAutoReview 同一份常量）：客户端**不写死**
				// 上下限。写死会让宿主调范围后面板仍按旧范围归一，而宿主对超范围的值会自行**钳制**
				// （负数则丢弃不落键）—— 用户看到「已保存」，落盘值却与他填的不同。
				//
				// 处置也刻意与宿主**不同**：宿主钳制（它要容忍手改配置），面板拒绝并提示（用户在
				// 环里，能当场改）。同一份值域、两种处置不是双份真相 —— 真相是那份表，「拒绝」
				// 与「钳制」只是两个调用方对同一个越界值的不同应对，且都不会静默改用户填的数。
				//
				// unit 是**单位后缀**：光秃秃的数字没人看得出是什么单位，而单位恰恰是
				// 最容易搞错的地方。单位写在下拉框右边而不是塞进 placeholder ——
				// placeholder 在有值时看不见。
				const numInput = (key, width, unit, scale) => {
					const cur = eff[key];
					const isDefault = explicit.indexOf(key) === -1;
					// 显示单位与存储单位的换算比：`scale` 个存储单位 = 1 个显示单位。
					// 只有 timeoutMs 用得上（面板填秒、存储仍是毫秒 —— 那个数字直接进
					// setTimeout 与 askUser，换单位会波及整条判定链）。
					//
					// 秒必须**允许小数**：整秒显示会把手改出来的 2500ms 显示成 2，
					// 用户点一下输入框再离开就提交 2000 —— 一次没有意图的静默改值。
					// 允许小数时 2500 显示 2.5，原样提交回 2500，失焦不产生写入。
					const s = typeof scale === 'number' && scale > 0 ? scale : 1;
					const toShown = (v) => (typeof v === 'number' ? (s === 1 ? v : v / s) : '');
					// 非受控 + key 重挂载：给了 value 却没有 onChange 的框会被 React 判成只读，
					// 每次 input 事件后把 DOM 值还原回 props.value —— 用户敲进去的字符当场被撤销。
					// key 取生效值：值一变（提交成功 / 点「恢复默认」/ 外部改动）就重挂载，
					// 让 defaultValue 重新生效，否则非受控框会一直显示旧值（另一种面板说谎）。
					const curText = String(cur === undefined ? '' : toShown(cur));
					const input = React.createElement('input', {
						className: 'pg-field',
						// 用 text 而不是 number：number 的 value sanitization 会把 "-" / "1e" / "1."
						// 这类中间态吞成空串，与「用户清空」在 DOM 上不可区分 —— 那样一次误输入 +
						// 失焦就会走下面的 clear 分支，把显式配置（如 timeoutMs=0）静默删掉、
						// 回落默认值，面板却照常弹「已保存」。text 下文本原样保留，非法输入
						// 走「拒绝 + 归位」，清空仍是唯一的 clear 入口。inputMode 保住数字键盘。
						type: 'text',
						inputMode: 'numeric',
						style: Object.assign({ width: width || 90 }, isDefault ? { color: 'rgba(128,128,128,0.95)' } : null),
						// 非受控（defaultValue + key 重挂载），见上方 curText 的说明。
						// 用 key 而不是受控 value：本框按设计只在 onBlur 提交，
						// 受控形态下每次按键都会被还原成 props 值，等于打不进字。
						key: key + ':' + curText,
						defaultValue: curText,
						// placeholder 显示默认值：用户清空后知道会回到哪
						placeholder: String(toShown(dflt[key])),
						// 用 onBlur 而不是 onChange：数字框每敲一个字符就提交会写入
						// 一堆中间值（"2" → "20" → "200"），而每次都要走一遍 persist 写盘。
						onBlur: (e) => {
							const raw = String(e.target.value || '').trim();
							if (raw === '') { setField(key, null); return; }
							// 只接受**纯十进制**文本（可带小数）：`Number()` 还认十六进制、
							// 二进制、八进制与科学计数法（`0x10`→16、`0b11`→3、`1e3`→1000）。
							// `type: 'number'` 时代浏览器挡住了 `x`/`b`/`e`，改成 text 之后
							// 这些写法就进得来 —— 用户填 `0x10` 却落成 16 是一次**静默改值**，
							// 而这条输入路径的全部意义就是「不静默改用户填的东西」。
							// 负数/`.5`/`1.`/`+3` 也一并不匹配（前两者原本分别被 `n < 0` 与
							// 「floor 成 0」拦下，结果同样是拒绝，这里统一由格式判据负责）。
							const n = /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : NaN;
							if (!Number.isFinite(n)) { setNotice(T('panel.autoBadNumber')); e.target.value = curText; return; }
							// 换算到存储单位。两条路径的取整方式不同，各有理由：
							//   · s === 1 —— 显示值就是存储值，小数无意义，向下取整（既有语义）；
							//   · s !== 1 —— 显示单位比存储单位大，换算后要保留精度。**不能**用
							//     floor：二进制浮点下 `1.001 * 1000` 是 1000.9999999999999，
							//     floor 会落成 1000（比用户填的少 1 毫秒，且与面板显示分叉）。
							const v = s === 1 ? Math.floor(n) : Math.round(n * s);
							// 换算后落成 0 但用户填的不是 0：min=0 的项（timeoutMs / breakerThreshold）
							// 的 0 是「不弹窗直接按回落值执行」/「永不熔断」这种**禁用**语义。
							// 用户填 0.5 次不是要禁用，而是单位写错 —— 拒绝并归位。
							// 秒单位下本判据几乎不可达（0.5 秒 = 500 毫秒），保留它是为了
							// 「输入小于半个存储单位」这种真正的无意义值。
							if (v === 0 && n > 0) { setNotice(T('panel.autoBadNumber')); e.target.value = curText; return; }
							// 超范围**不提交**：宿主对超范围值会自行钳制（负数则丢弃不落键），
							// 不报错，面板照常弹「已保存」。故在这里按宿主下发的
							// 值域先拦下并提示，而不是让用户看到一个假的成功。
							const rg = ranges[key];
							if (rg && ((typeof rg.min === 'number' && v < rg.min) || (typeof rg.max === 'number' && v > rg.max))) {
								setNotice(T('panel.autoBadNumber'));
								// 非受控框不会自动还原：把文本归位成生效值，否则框里留着那个没被采纳的值。
								e.target.value = curText;
								return;
							}
							// 生效值没变就不写盘：只是聚焦再离开不该把默认值物化成显式配置
							// 但要把框里的文本归位成生效值：非受控框不会再被 React 自动还原，
							// 否则「20000.7 / 020000」这类输入会留在框里、看起来与落盘值不一致。
							if (v === cur) { e.target.value = curText; return; }
							setField(key, v);
						},
						disabled: busy,
					});
					if (!unit) return input;
					return React.createElement('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 4 } },
						input,
						React.createElement('span', { style: { fontSize: 11, color: 'rgba(128,128,128,0.9)' } }, unit),
					);
				};
				const row = (labelKey, ...children) => React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' } },
					React.createElement('span', { style: { fontSize: 12, minWidth: 130 } }, T(labelKey)),
					...children,
				);
				// ── 第二张卡片：额外审批策略 ──────────────────────────────────────────────
				//
				// 与上面那张**并列**（见上面 return 处的说明）：那张配「评审机制怎么跑」，
				// 这张配「给模型的规则」。策略文本**两层可写**（项目层可继承 / 追加 / 替换）。
				//
				// 定义在 `autoReviewCard` **内部**：它要读 `ar.policy` 与 `dflt`，而那两个
				// 由本函数从 status 取出。为此传参进去只会多一层接口，没有别的收益。
				// auto tab 的分流（`tab === 'auto' ? autoReviewCard() : null`）因此不用改 ——
				// `tab='auto'` 不会流进下面 100+ 处 `tab === 'global' ? A : B`。
				//
				// ⚠️ 这里**不得有任何 hook**：hook 数量会随 tab 变化，React 抛 #310
				// 整页白屏。状态全部在组件层（见 policyGlobal / policyDirty 那一批）。
				//
				// ── 为什么按「设置项」分卡片，而不是按「层」分 ────────────────────────────
				// 早先这里只有一张卡片，装了三件事（策略文本 / 高风险处置 / 拒绝时说什么），
				// 内部再按「全局 / 本项目」分块。两个后果都已实测：
				//   · 标题只覆盖第一件，用户找不到另外两件（「拒绝时说什么」尤其不可能
				//     想到去「额外审批策略」里找）；
				//   · 同一件事的两层被整块策略文本隔开，想对比「全局与本项目对高风险怎么处置」
				//     要跨过中间几十行，且两层用的是不同的提交方式（textarea 要按钮、
				//     下拉即时生效）—— 同一个设置项不该有两种交互。
				// 现在每张卡片只装一件事，卡内两层紧挨着、交互一致。
				const policyCard = () => {
					const pol = ar.policy || {};
					// 值域与上限都由宿主下发（见 statusView 的 policy 子对象）：
					// 客户端不写死第二份 —— 否则「宿主加一档」与「面板能选什么」会分叉。
					const modes = Array.isArray(pol.policyModes) ? pol.policyModes : ['append', 'replace'];
					// 两个长度阈值，语义不同（见 statusView 的 policy 子对象）：
					//   · `warnLen` 是**建议线**：超过只标红提示，照常保存、照常生效；
					//   · `maxLen` 是**真上限**：超过才禁用保存（宿主也会回 error）。
					// 早先只有一个 `maxLength = 4000`，既当提示又当禁令，于是「策略写长了
					// 就不让存」——而长度本来就是用户自己的判断。
					const warnLen = typeof pol.warnLength === 'number' && pol.warnLength > 0 ? pol.warnLength : 4000;
					const maxLen = typeof pol.maxLength === 'number' && pol.maxLength > 0 ? pol.maxLength : 20000;
					// 提交单点。三个下拉与本卡片的策略文本共用它，清脏标记的分支按 key 分。
					const savePolicy = (target, key, value) => {
						invoke('permgate:set-auto-policy', { target: target, [key]: value }, () => {
							// 保存成功才清脏标记：失败时草稿必须留着，否则用户输入的文字
							// 会被一次「没保存成功」的响应顺手清掉。
							//
							// **只清这次真正保存的那一格**：本卡片的 `policyMode` 下拉保存的
							// 不是输入框里的文字，清掉标记会让下一次 status 推送（宿主 persist
							// 成功必 broadcast）把 textarea 里未保存的草稿覆盖掉。
							// 自定义拒绝原因的草稿标记由 `denyReasonCard` 自己清（那是另一张卡片）。
							if (key === 'policy') policyDirty.current[target] = false;
							setMsg(T('panel.autoPolicySaved'));
						});
					};
					// 文本域：**受控**（与上面数字框的非受控不同）。长文本靠 key 重挂载
					// 会丢焦点，而编辑策略时中途失焦极常见 —— 那正是本条用保存按钮的理由。
					//
					// 长度提示分两档，颜色与措辞都不同：
					//   · 超过 `warnLen` —— 橙色 + 「注意力可能被稀释」：**不影响保存**，
					//     这是建议。写成红色或禁用按钮等于把建议变成禁令。
					//   · 超过 `maxLen` —— 红色 + 「超出上限」：保存按钮禁用。
					const area = (which, value, onChange, disabled) => {
						const overWarn = value.length > warnLen;
						const overMax = value.length > maxLen;
						const color = overMax ? '#c62828' : (overWarn ? '#bf8700' : 'rgba(128,128,128,0.9)');
						const notice = overMax
							? T('panel.autoPolicyTooLong').replace('{max}', String(maxLen)) + ' · '
							: (overWarn ? T('panel.autoPolicyTooLongWarn') + ' · ' : '');
						return React.createElement('div', null,
							React.createElement('textarea', {
								className: 'pg-field',
								// `boxSizing` 不能省：`.pg-field` 自带 padding 与 border，而默认的
								// content-box 下 `width:'100%'` 只约束内容区，加上那 18px 会比卡片还宽
								// —— textarea 从卡片右边伸出去。仓库里其它 `width:'100%'` 都配了它。
								style: { width: '100%', boxSizing: 'border-box', minHeight: 96, fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12, resize: 'vertical', opacity: disabled ? 0.5 : 1 },
								rows: 6,
								value: value,
								placeholder: T('panel.autoPolicyPh'),
								disabled: disabled || busy,
								onChange: (e) => { policyDirty.current[which] = true; onChange(e.target.value); },
							}),
							// 分母**恒为建议线**，不随超上限切换 —— 切换会让用户在 20000
							// 附近敲一个字就看到「20000 / 4000」突变「20001 / 20000」，
							// 像是上限被临时放宽。真上限由上面那句提示单独给出。
							React.createElement('div', {
								style: { fontSize: 11, textAlign: 'right', color: color },
							}, notice + T('panel.autoPolicyCount').replace('{n}', String(value.length)).replace('{max}', String(warnLen))),
							// 保存按钮紧跟 textarea：它只管这一格。与数字框的失焦提交不同，
							// 长文本编辑中途失焦极常见，所以这一格必须显式提交。
							React.createElement('div', { style: { marginTop: 4 } },
								React.createElement('button', {
									className: 'pg-btn',
									disabled: busy || disabled || value.length > maxLen,
									onClick: () => savePolicy(which, 'policy', value),
								}, T('panel.autoPolicySave')),
							),
						);
					};
					const modeLabel = (m) => T(m === 'append' ? 'panel.autoPolicyModeAppend' : (m === 'replace' ? 'panel.autoPolicyModeReplace' : 'panel.autoPolicyModeInherit'));
					const projectRoot = status ? String(status.projectKey || '') : '';
					// 只渲染**当前子 Tab 那一层**：全局子 Tab 没有「与全局的关系」这个下拉
					// （没有可继承的对象），项目子 Tab 才有。
					return React.createElement('div', { style: card },
						React.createElement('div', { style: h() }, T('panel.autoPolicy')),
						React.createElement('div', { style: { fontSize: 12, color: 'rgba(128,128,128,0.85)', marginBottom: 6 } }, T('panel.autoPolicyHint')),
						autoTab === 'project'
							? React.createElement(React.Fragment, null,
								React.createElement('div', { style: { fontSize: 11, color: 'rgba(128,128,128,0.9)', marginBottom: 6 } },
									T('panel.autoPolicyProject') + (projectRoot ? '  ' + projectRoot : '')),
								React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' } },
									React.createElement('span', { style: { fontSize: 12, minWidth: 130 } }, T('panel.autoPolicyMode')),
									React.createElement('select', {
										className: 'pg-field',
										style: { padding: '2px 6px' },
										value: policyMode,
										disabled: busy,
										onChange: (e) => {
											setPolicyMode(e.target.value);
											savePolicy('project', 'policyMode', e.target.value);
										},
									}, ['inherit'].concat(modes).map((m) => React.createElement('option', { key: m, value: m }, modeLabel(m)))),
								),
								// 两行提示互斥：「继承全局」说这段不发送，「替换全局」说全局那段不发送，
								// 「追加到全局」两者都发送 → 都不显示。
								policyMode === 'inherit'
									? React.createElement('div', { style: { fontSize: 11, color: 'rgba(128,128,128,0.9)', marginTop: 2 } }, T('panel.autoPolicyInheritHint'))
									: (policyMode === 'replace'
										? React.createElement('div', { style: { fontSize: 11, color: '#bf8700', marginTop: 2 } }, T('panel.autoPolicyReplaceHint'))
										: null),
								// 继承态下 textarea 禁用并置灰：这时它写什么都不发送，可编辑会让用户
								// 以为自己在改什么（面板说谎的另一种形态）。
								area('project', policyProject, setPolicyProject, policyMode === 'inherit'),
							)
							: area('global', policyGlobal, setPolicyGlobal, false),
					);
				};
				// ── 第三张卡片：模型判定高风险却放行时怎么办 ─────────────────────────────
				//
				// 独立成卡而不是塞进策略卡：它回答的是「结论已经出来了，但那个结论危险，
				// 你信不信」——与「给模型什么规则」是两个问题。混在一起时标题只能覆盖前者。
				//
				// 卡内按**层**分行，两层紧挨着：这正是上一版按层分块丢掉的对照能力 ——
				// 想知道「本项目是不是比全局更严」，现在一眼就能比。
				const highRiskCard = () => {
					const pol = ar.policy || {};
					const actions = Array.isArray(pol.highRiskActions) ? pol.highRiskActions : ['deny', 'ask', 'allow'];
					const timeouts = Array.isArray(pol.highRiskTimeouts) ? pol.highRiskTimeouts : ['wait', 'deny', 'allow'];
					// 第二维的显示条件看**生效**的第一维，不看本层原值：本层选「继承全局」
					// 而全局是「询问」时，第二维仍然生效 —— 用本层原值判会把它藏起来。
					//
					// 但两层各自的「生效值」不同源，必须分开算：
					//   · 项目行 → `effectiveHighRiskAction`（项目显式 → 全局显式 → 缺省），
					//     这正是项目层实际会怎么处置；
					//   · 全局行 → 全局显式值或宿主下发的默认值（`dflt`）。
					//     用项目优先的 effective 判，会在「项目设 deny、全局缺键」时把**全局**的
					//     第二维整行藏起来 —— 用户无法配置全局的等待时长，且切个会话控件就
					//     出现/消失。
					const globalAction = pol.highRiskAction || dflt.highRiskAction || 'ask';
					const effAction = pol.effectiveHighRiskAction || 'ask';
					const save = (target, key, value) => invoke('permgate:set-auto-policy', { target: target, [key]: value }, () => setMsg(T('panel.autoPolicySaved')));
					// 三/四态下拉。`inherit` 只在项目层出现（全局层没有可继承的对象）。
					//
					// `keyPrefix` 是 i18n 键前缀（`panel.autoHighRisk` / `panel.autoHighRiskTimeout`），
					// 选项文案由它拼出 `.<取值>` —— 两个维度的取值集合不同（第二维多一个 `wait`），
					// 故不能共用一套标签。
					const picker = (keyPrefix, hintKey, value, onChange, values, withInherit) => React.createElement('div', { style: { marginTop: 8 } },
						React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
							React.createElement('span', { style: { fontSize: 12, minWidth: 130 } }, T(keyPrefix)),
							React.createElement('select', {
								className: 'pg-field',
								style: { padding: '2px 6px' },
								value: value,
								disabled: busy,
								onChange: (e) => onChange(e.target.value),
							}, (withInherit ? ['inherit'] : []).concat(values).map((m) => React.createElement('option', { key: m, value: m },
								m === 'inherit' ? T('panel.autoPolicyInherit') : T(keyPrefix + '.' + m)))),
						),
						hintKey ? React.createElement('div', { style: { fontSize: 11, color: 'rgba(128,128,128,0.9)', marginTop: 2 } }, T(hintKey)) : null,
					);
					return React.createElement('div', { style: card },
						React.createElement('div', { style: h() }, T('panel.autoHighRiskTitle')),
						React.createElement('div', { style: { fontSize: 12, color: 'rgba(128,128,128,0.85)', marginBottom: 6 } }, T('panel.autoHighRiskHint')),
						// 只渲染当前子 Tab 那一层。两层的「生效值」不同源，故两个分支各自取自己的：
						//   · 全局层 → 全局显式值或宿主下发的默认值（`dflt`）；
						//   · 项目层 → `effectiveHighRiskAction`（项目显式 → 全局显式 → 缺省）。
						autoTab === 'project'
							? React.createElement(React.Fragment, null,
								picker('panel.autoHighRisk', null, policyProjectHighRisk, (v) => {
									setPolicyProjectHighRisk(v);
									save('project', 'highRiskAction', v);
								}, actions, true),
								effAction === 'ask'
									? picker('panel.autoHighRiskTimeout', 'panel.autoHighRiskTimeoutHint', policyProjectHighRiskTimeout, (v) => {
										setPolicyProjectHighRiskTimeout(v);
										save('project', 'highRiskTimeout', v);
									}, timeouts, true)
									: null,
							)
							: React.createElement(React.Fragment, null,
								picker('panel.autoHighRisk', null, policyHighRisk, (v) => {
									setPolicyHighRisk(v);
									save('global', 'highRiskAction', v);
								}, actions, false),
								globalAction === 'ask'
									? picker('panel.autoHighRiskTimeout', 'panel.autoHighRiskTimeoutHint', policyHighRiskTimeout, (v) => {
										setPolicyHighRiskTimeout(v);
										save('global', 'highRiskTimeout', v);
									}, timeouts, false)
									: null,
							),
					);
				};
				// ── 第四张卡片：拒绝时回给模型哪句话 ─────────────────────────────────────
				//
				// 也独立成卡：它管的是**判定输出**（模型被拒后收到什么），前两张管判定输入
				// 与处置。塞进策略卡时，标题「额外审批策略」完全覆盖不到它 —— 用户想改
				// 「拒绝时说什么」不会想到去点「额外审批策略」。
				//
				// 卡内两层紧挨着，且都用同一个控件形状（左标签 + 右下拉），便于对照。
				const denyReasonCard = () => {
					const pol = ar.policy || {};
					const modes = Array.isArray(pol.denyReasonModes) ? pol.denyReasonModes : ['default', 'custom', 'both'];
					const maxLenText = typeof pol.denyReasonMaxLength === 'number' && pol.denyReasonMaxLength > 0
						? pol.denyReasonMaxLength : 500;
					const save = (target, key, value) => invoke('permgate:set-auto-policy', { target: target, [key]: value }, () => {
						if (key === 'denyReason') denyDirty.current[target] = false;
						setMsg(T('panel.autoPolicySaved'));
					});
					// 一层一块：下拉（改完即时生效）+ 仅在 custom 时出现的输入框（失焦提交）。
					//
					// 输入框**非受控**（defaultValue + key 重挂载），与 numInput 同构：
					// 受控形态下每次按键都会被还原成 props 值，等于打不进字。
					//
					// 可见性看**本层**的模式而不是生效模式：项目层选「继承全局」时，
					// 本层这段文本不发送，可编辑会让用户以为自己在改什么（面板说谎的另一种形态）。
					const block = (which, mode, setMode, text, setText, withInherit) => {
						// `custom` 与 `both` 都要用户写那句；`default` 用不到输入框。
						const shown = mode === 'custom' || mode === 'both';
						// 空值时显示**真实默认文案**（灰字），而不是一句示例。
						//
						// 为什么不能用占位符示例：用户要判断「要不要自定义」，前提是看得到
						// 不自定义时到底发什么。示例既不是真实文案，也覆盖不了三种来源的差别
						// （模型自己拒 / 模型放行被设置推翻 / 评审失败按设置拒绝）——
						// 用户会以为默认只有一句话，而实际发出去的是三句里对应的那句。
						//
						// 三种并列显示：它们是同一设置在不同情形下的取值，只显示一种会让
						// 用户在另外两种情形下以为「默认文案跟我看到的不一样」。
						const defaults = (pol.denyReasonDefaults && typeof pol.denyReasonDefaults === 'object') ? pol.denyReasonDefaults : null;
						const defaultLines = defaults
							? [defaults.deny, defaults.denyHigh, defaults.fallback].filter((x) => typeof x === 'string' && x)
							: [];
						// ── 项目层留空时，实际发的是**全局那句**（不是默认文案）────────────
						//
						// 宿主的 denyReasonTextOf 在项目层 mode=custom 且无文本时穿透全局，
						// 判据是「全局 mode=custom 且有文本」。这里用同两个字段复算同一条判据：
						// 两个值都由 statusView 下发（本层显式值），客户端不另造继承链。
						//
						// 不显示这条提示时，面板会列出三句默认文案，而模型实际收到的是全局那句
						// —— 面板说的与真实行为相反，用户按它理解「本项目留空 = 默认」。
						//
						// 存的是**文本**而不是布尔：提示里要原样引用那句，判据与文案在这里分开算
						// 会让两处各判一次，而条件写两遍必然漂移。空串即「不穿透」。
						const empty = !String(text || '').trim();
						// 与宿主 denyReasonTextOf 同一条判据：全局层的 mode 会用到文本
						// （`custom` / `both`）且文本非空时，项目层留空才穿透。
						const globalUses = pol.denyReasonMode === 'custom' || pol.denyReasonMode === 'both';
						const globalText = withInherit && shown && empty
							&& globalUses
							&& typeof pol.denyReason === 'string' && pol.denyReason.trim()
							? pol.denyReason : '';
						return React.createElement('div', { style: { marginTop: 6 } },
							React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
								React.createElement('span', { style: { fontSize: 12, minWidth: 130 } }, T('panel.autoDenyReason')),
								React.createElement('select', {
									className: 'pg-field',
									style: { padding: '2px 6px' },
									value: mode,
									disabled: busy,
									onChange: (e) => {
										const v = e.target.value;
										setMode(v);
										save(which, 'denyReasonMode', v);
									},
								}, (withInherit ? ['inherit'] : []).concat(modes).map((m) => React.createElement('option', { key: m, value: m },
									m === 'inherit' ? T('panel.autoPolicyInherit') : T('panel.autoDenyReason.' + m)))),
							),
							// 说明只显示当前选中那一条：`<option>` 装不下第二行，三句一起列又会让
							// 卡片比旁边两张高一截。选中后紧跟着说清「这样选会怎样」，读到的永远
							// 是正在生效的那句。
							//
							// `inherit` 不显示：下拉本身已经写着「继承全局」，再补一句只是把同一个
							// 事实说两遍；而全局层此刻选的是哪一档，这行字也说不出来 —— 写「跟随
							// 全局层选的那句」时，全局选「自动审批的判定理由」就根本没有「那句」。
							mode === 'inherit'
								? null
								: React.createElement('div', { style: { fontSize: 11, color: 'rgba(128,128,128,0.95)', lineHeight: 1.5, marginTop: 2 } },
									T('panel.autoDenyReasonDesc.' + mode)),
							shown
								? React.createElement('div', { style: { marginTop: 4 } },
									React.createElement('input', {
										className: 'pg-field',
										// `boxSizing` 与策略 textarea 同一条理由：`.pg-field` 自带 padding 与
										// border，content-box 下 `width:'100%'` 会让控件伸出卡片右边。
										style: { width: '100%', boxSizing: 'border-box' },
										type: 'text',
										key: 'denyReason:' + which + ':' + text,
										defaultValue: text,
										// 占位符只说「留空会怎样」，不再拿示例冒充默认值 ——
										// 真实默认文案在下面那块灰字里逐条列出。
										//
										// 会穿透全局时换成另一句：那时下面列的不是默认文案，
										// 再写「用下面的默认文案」就指向了不存在的内容。
										placeholder: globalText ? T('panel.autoDenyReasonPhInherit') : T('panel.autoDenyReasonPh'),
										maxLength: maxLenText,
										disabled: busy,
										// 失焦即提交：与数字框同一条纪律 —— 值没变就不写盘，
										// 只是聚焦再离开不该把默认值物化成显式配置。
										onBlur: (e) => {
											const v = String(e.target.value || '').trim();
											if (v === String(text || '').trim()) return;
											denyDirty.current[which] = true;
											setText(v);
											save(which, 'denyReason', v);
										},
										onChange: () => { denyDirty.current[which] = true; },
									}),
									// 留空时逐条列出真实默认文案。有自定义文本时**不显示** ——
									// 那时发出去的就是用户写的那句，再列出默认值只会让人以为两者会合并。
									//
									// 但项目层会穿透全局时**不列默认文案**：那时实际发的是全局那句，
									// 列出默认值等于告诉用户一句不会发出的文本。改为明说沿用的是哪句。
									//
									// `replace` 的替换串走**函数**而不是字符串：用户写的那句可能含
									// `$&` / `` $` `` / `$$`，字符串形态下它们会被当作替换模式展开
									// （`a$'b` 直接变成 `a` + 模板尾部）。函数形态不做模式解析。
									empty
										? (globalText
											? React.createElement('div', { style: { marginTop: 4, fontSize: 11, color: 'rgba(128,128,128,0.95)', lineHeight: 1.6 } },
												T('panel.autoDenyReasonInherit').replace('{text}', () => globalText))
											: (defaultLines.length
												? React.createElement('div', { style: { marginTop: 4, fontSize: 11, color: 'rgba(128,128,128,0.95)', lineHeight: 1.6 } },
													React.createElement('div', { style: { marginBottom: 2 } }, T('panel.autoDenyReasonDefaultsLabel')),
													defaultLines.map((s, i) => React.createElement('div', { key: i, style: { paddingLeft: 8 } }, '· ' + s)))
												: null))
										: null,
								)
								: null,
						);
					};
					return React.createElement('div', { style: card },
						React.createElement('div', { style: h() }, T('panel.autoDenyReasonTitle')),
						React.createElement('div', { style: { fontSize: 12, color: 'rgba(128,128,128,0.85)', marginBottom: 6 } }, T('panel.autoDenyReasonHint')),
						// 只渲染当前子 Tab 那一层。
						autoTab === 'project'
							? block('project', policyProjectDenyMode, setPolicyProjectDenyMode, policyProjectDenyText, setPolicyProjectDenyText, true)
							: block('global', policyDenyMode, setPolicyDenyMode, policyDenyText, setPolicyDenyText, false),
					);
				};
				// auto tab 内的**层切换**：胶囊分段控件 + 前置标签，而不是第二条下划线 Tab 栏。
				//
				// 为什么不用 `pg-tab`（外层那套下划线）：两层下划线并排时，视觉上就是
				// 「两条一模一样的导航」，只靠字号差一档区分 —— 用户第一眼会读成
				// 「这里有两层 Tab，我到底在哪一层」。分段控件（segment）在原生设置界面里
				// 表达的是「同一件事的两个取值」，与「切换页面」是两种语义，形状也完全不同
				// （圆角填充 vs 下划线），不会与上面那条栏混为一谈。
				//
				// 前置标签「设置范围」是**必须的**：只有两个胶囊时用户仍要靠上下文猜
				// 「全局 / 项目」指的是什么范围 —— 外层 tab 也叫这两个名字，但外层那份
				// 是整个面板的范围，这份是自动审批内部的。
				const autoTabBtn = (t, label) => React.createElement('button', {
					className: 'pg-seg-btn' + (autoTab === t ? ' pg-seg-btn-on' : ''),
					onClick: () => setAutoTab(t),
				}, label);
				return React.createElement(React.Fragment, null,
				React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 } },
					React.createElement('span', { style: { fontSize: 12, color: 'rgba(128,128,128,0.95)' } }, T('panel.autoScope')),
					React.createElement('div', { className: 'pg-seg' },
						autoTabBtn('global', T('panel.tabGlobal')),
						autoTabBtn('project', T('panel.tabProject')),
					),
				),
				// 「评审机制怎么跑」这四项**只有全局一份**（宿主侧 set-auto-review 明确拒绝
				// target !== 'global'）。项目子 Tab 下整张卡片不渲染 —— 显示成置灰会让
				// 用户以为「本项目暂时不能改」，而真相是它根本不按项目配置。
				autoTab === 'global'
					? React.createElement('div', { style: card },
					React.createElement('div', { style: h() }, T('panel.autoReview')),
					React.createElement('div', { style: { fontSize: 12, color: 'rgba(128,128,128,0.85)', marginBottom: 4 } }, T('panel.autoReviewHint')),
					// 评审能力不可用时的醒目提示：用户看到「auto 一直在弹窗」时，
					// 这里是唯一能解释原因的地方（否则只能去翻日志）。
					ar.llmAvailable === false
						? React.createElement('div', { style: { fontSize: 12, color: '#c62828', marginTop: 4 } }, T('panel.autoNoLlm'))
						: null,
					row('panel.autoTimeout', numInput('timeoutMs', 90, T('panel.autoSecUnit'), 1000),
						// `whiteSpace: 'pre-line'` 是**必须的**：这条文案按行分点（见 i18n 处），
						// 而默认的 `normal` 会把换行折叠成空格，三条并成一大段 ——
						// 那正是它原本难读的原因。`pre-line` 保留换行、其余空白仍折叠。
						React.createElement('span', { style: { fontSize: 11, color: 'rgba(128,128,128,0.9)', whiteSpace: 'pre-line' } }, T('panel.autoTimeoutHint'))),
					row('panel.autoBreaker', numInput('breakerThreshold', 90, T('panel.autoTimesUnit')),
						React.createElement('span', { style: { fontSize: 11, color: 'rgba(128,128,128,0.9)' } }, T('panel.autoBreakerHint'))),
					row('panel.autoHistory', numInput('historyN', 70, T('panel.autoTimesUnit')), numInput('historyBudget', 90, T('panel.autoCharsUnit')),
						React.createElement('span', { style: { fontSize: 11, color: 'rgba(128,128,128,0.9)' } }, T('panel.autoHistoryHint'))),
					// 模型覆盖：留空 = 跟随会话当前模型（三级回落的第 ② 级）。
					// 两个下拉必须**成对**才生效（reviewTarget 要求 provider 与 model 都在）——
					// 只填一个等于没填，故提示里写明。
					//
					// ── 模型 / 推理等级：交给 ModelEffortPicker（复刻官方 ModelSelect）──────
					// 为什么不是输入框、不是 <select>、也不是内联展开（三者都做过，都不对）：
					//   · **输入框**：手填要求用户知道 provider 路由键与模型 id 的确切拼写，
					//     写错后静默失效 —— reviewTarget 拿到不存在的 provider/model 只会在
					//     llm.stream 里抛，用户看到的是「自动审批一直弹窗」，没有线索指向
					//     「你名字打错了」。
					//   · **<select>**：把「标签 + 当前值 + 进入下一级」挤成一个控件，当前值
					//     只能塞进选项文字，且原生 select 表达不了「drill 进下一级」。
					//   · **内联展开**：设置面板是窄栏 + 可滚动容器，列表一展开就把下面内容
					//     顶下去，也没有浮层的边框/阴影 —— 观感与官方完全不同（用户说的「丑」）。
					// 现在是官方那套：两行 cell（标签 …… 当前值 ›），点开是 **portal 到 body
					// 的浮层菜单**，模型按服务商分组、推理等级显示档位名。
					//
					// 「当前值」是**你配了什么**：配置了就是配置的模型名与档位名，
					// 没配置就写「跟随会话」。绝不显示会话当前用的是哪个模型/档位 ——
					// 那些属于具体对话，切个对话就变，写进全局设置项里只会让人
					// 以为「设置跟着对话漂」（见 ModelEffortPicker 里两行的说明）。
					React.createElement(ModelEffortPicker, {
						model: eff.model || '',
						provider: eff.provider || '',
						effort: eff.reasoningEffort || '',
						// effective 仍然要传：跟着会话时，推理等级浮层要列**真正会用**的
						// 那个模型公布的档位（列错模型的档位 → 选完派发给目标模型 → config-error）。
						effective: { model: tgtMod, provider: tgtProv, effort: tgtEffort },
						groups: groups,
						efforts: efforts,
						disabled: busy,
						onPick: (patch) => {
							// ── 推理等级单独一档 ──────────────────────────────────────────────
							if (Object.prototype.hasOwnProperty.call(patch, 'reasoningEffort')) {
								setField('reasoningEffort', patch.reasoningEffort || null);
								return;
							}
							if (!Object.prototype.hasOwnProperty.call(patch, 'model')) return;
							// ── 换模型：model / provider / reasoningEffort 必须**一次提交** ──────
							//
							// 为什么不能连着调三次 setField：那会发出 3 个并发 POST，而每条响应
							// 都带整份 statusView、invoke 收到就 applyStatus 覆盖面板 —— 互相覆盖
							// 会露出一帧不一致，busy 也会被先返回的那个提前置回 false。详见
							// setFields 处的说明。
							const nextModel = patch.model || '';
							const nextProvider = patch.provider || '';
							const wantPatch = {};
							const wantClear = [];
							// 模型与服务商**成对**提交（reviewTarget 要求两者都在）。
							// 选「跟随会话」时两个都清掉，否则会留下「新 model + 旧 provider」。
							if (nextModel) wantPatch.model = nextModel; else if (eff.model) wantClear.push('model');
							if (nextProvider) wantPatch.provider = nextProvider; else if (eff.provider) wantClear.push('provider');
							// 只改了 provider 的情况（不常见，但选择器允许）：不碰推理等级。
							if (nextModel !== (eff.model || '')) {
								// ── 换模型后的推理等级：符号档不动，钉住的档位要看新模型支不支持 ──
								//
								// 三种设置的处置**不一样**，不能一律清空：
								//   · 未配置 / 跟随会话（'' 或符号值 `session`）→ 跟着走，不用动；
								//   · 通用相对档（default / max / min）→ 相对值，换任何模型都成立，
								//     **保留**。清空它等于替用户改成「跟随会话」，是没让他做的决定；
								//   · 指定档（`@` + id）→ 钉住的是具体档位。新模型没这一档就必须处理，
								//     否则宿主 resolveEffort 会报 config-error（表现为「自动审批一直弹窗，
								//     面板上却看不出任何问题」）。回退目标是 **default**（模型默认），
								//     不是「最高」或「最低」：后两者会替用户做「更慢更贵」或「判断更弱」
								//     的选择，而「模型默认」是唯一不表态的选项。
								const curEffort = String(eff.reasoningEffort || '');
								// 相对档（'' / session / default / max / min）一律保留：它们对任何模型都成立。
								// 判据用 PG_EFFORT_SYMBOLS（从 PG_EFFORT_SYMBOL_LABELS 派生），
								// 与显示侧同源 —— 加符号档时不会漏掉这里。
								const isRel = !curEffort || PG_EFFORT_SYMBOLS.indexOf(curEffort) !== -1;
								if (!isRel && curEffort.charAt(0) === '@') {
									if (!nextModel) {
										// ── 切回「跟随会话」：钉住的档位必须处理掉 ────────────────────
										// 跟随会话意味着「模型由每个对话各自决定」，而定住的 `@max` 只对
										// **某一个**模型有意义。留在配置里，用户换到任何不公布 max 的对话
										// 都会让宿主 resolveEffort 报 config-error —— 而那时面板显示的是
										// 「跟随会话」，看不出任何异常（又一次面板说谎）。
										// 写成**显式的** `session` 而不是删键：模型已经跟着对话走了，档位也
										// 应当跟着对话走，这才是「跟随会话」的完整语义；而删键现在的含义是
										// 「用户没表态」，生效的是默认档（`min`），那会把档位钉死在最低档。
										wantPatch.reasoningEffort = PG_EFFORT_SESSION;
									} else {
										// 新模型的档位表：从目录里按 (provider, model) 精确查 —— 查不到
										// （目录没取到 / 模型不在目录里）就**不动**：没有依据时清空同样是
										// 替用户做决定，而宿主那边会给出明确的 config-error。
										const want = curEffort.slice(1);
										let nextEfforts = null;
										for (const g of groups) {
											if (String(g.id) !== String(nextProvider)) continue;
											const m = (Array.isArray(g.models) ? g.models : []).find((x) => String(x.id) === String(nextModel));
											if (m && m.reasoning && Array.isArray(m.reasoning.efforts)) nextEfforts = m.reasoning.efforts;
											break;
										}
										if (nextEfforts && !nextEfforts.some((x) => String(x.id) === want)) {
											wantPatch.reasoningEffort = 'default';
										}
									}
								}
							}
							setFields(wantPatch, wantClear);
						},
					}),
					React.createElement('div', { style: { fontSize: 11, color: 'rgba(128,128,128,0.9)', marginTop: 2 } },
						effortHintText),
					// 恢复默认：一次性清掉**全局层**的全部显式配置（等价于「全局这块我没设过」）。
					// 范围是 `config.global.autoReview` 的键；项目层那份落在
					// `projects[root].autoReview`，按项目单独裁决，清掉它会波及一个只属于
					// 当前项目的设置，故不在本按钮里。
					// 只在确实有显式配置时出现 —— 没有可恢复的东西时给个按钮是误导。
					// 会清掉全部显式配置且不可撤销，故必须有二次确认（复用 confirmDelete）。
					resetAllButton(),
					)
					: null,
				policyCard(),
				highRiskCard(),
				denyReasonCard(),
				);
			};

			const tabBtn = (t, label) => React.createElement('button', { className: 'pg-tab' + (tab === t ? ' pg-tab-on' : ''), onClick: () => setTab(t) }, label);
			// 拒绝原因控件：四处（分类默认值 / 快捷工具 / 兜底 / 快捷工具新增行）共用一个渲染函数，
			// 保证文案、宽度与交互一致；只有当前动作是 deny 时才显示。
			// 已存在的行：默认只读展示当前原因（未填时灰色占位），点「编辑」才可输入、按钮变「保存」，
			// 保存或取消后回到只读 —— 这样「当前值是什么」「改了算不算数」都有确定答案。
			// 新增行（focus 为 null）：它就是「新增工具」表单的一部分，始终可直接输入，
			// 由旁边的「添加」按钮连同工具名一起提交，不套编辑/保存两态。
			// focus 描述「本控件属于哪一行」，键形如 {kind, tab, key}；onCancel 把草稿还原成服务端值。
			const reasonInput = (value, onChange, onCommit, show, focus, onCancel) => {
				if (!show) return null;
				const txt = String(value || '');
				// 新增行没有「既有值」概念，不进入两态；它随「添加」按钮一起提交，
				// 没有回车/保存动作，故 title 用字段名（panel.denyReason），
				// 而不是已存在行那种「按回车或点保存生效」的提示。
				if (focus === null) {
					return React.createElement('input', {
						className: 'pg-field',
						style: { maxWidth: 220 },
						placeholder: T('panel.denyReasonPh'),
						title: T('panel.denyReason'),
						value: txt,
						onChange,
						disabled: busy,
					});
				}
				const fk = reasonKeyOf(focus);
				const editing = reasonEditing === fk;
				const saved = !!reasonSaved && reasonSaved.key === fk;
				const btn = (label, onClick) => React.createElement('button', {
					className: 'pg-btn',
					style: { padding: '2px 8px', fontSize: 12 },
					disabled: busy,
					onClick,
				}, label);
				const endEdit = () => { reasonFocus.current = null; setReasonEditing(null); };
				// 点「编辑」进入本格：若上一格还在编辑中，它的草稿既不提交也不该被静默丢弃，
				// 先按「取消」口径还原成服务端值，再切到本格（与点「取消」按钮同语义）。
				const beginEdit = () => {
					const prevF = reasonFocus.current;
					if (prevF && reasonKeyOf(prevF) !== fk) revertReason(prevF.kind, prevF.key);
					reasonFocus.current = focus;
					setReasonEditing(fk);
				};
				return React.createElement('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 4 } },
					editing
						? React.createElement('input', {
							className: 'pg-field',
							style: { maxWidth: 220 },
							placeholder: T('panel.denyReasonPh'),
							title: T('panel.denyReasonHint'),
							value: txt,
							onChange,
							autoFocus: true,
							// 回车 = 保存。不接管 Esc：取消走按钮，语义明确（Esc 不保存）。
							// 必须排除输入法组合态：中文用户按回车确认候选词时同样会派发 Enter，
							// 若直接提交，会把尚未上屏的拼音串当原因写盘并强制退出编辑态。
							onKeyDown: (e) => {
								if (e.nativeEvent && (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229)) return;
								if (e.key === 'Enter') { e.preventDefault(); onCommit(focus); endEdit(); }
							},
							disabled: busy,
						})
						// 只读态：有值显示原因本身，无值显示灰色占位（点明「未设置拒绝原因」而不是留空）。
						// 占位文案较长，故给比输入框更宽的 240px；仍超长时靠 title 悬浮看全文。
						: React.createElement('span', {
							style: { maxWidth: 240, fontSize: 12, color: txt ? 'inherit' : 'rgba(128,128,128,0.8)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
							title: txt || T('panel.denyReasonNone'),
						}, txt || T('panel.denyReasonNone')),
					editing
						? React.createElement(React.Fragment, null,
							btn(T('panel.reasonSave'), () => { onCommit(focus); endEdit(); }),
							btn(T('panel.cancel'), () => { onCancel(); endEdit(); }),
						)
						// 进入编辑态时登记焦点：编辑期间的 SSE status 推送不会用服务端值覆盖草稿
						: btn(T('panel.reasonEdit'), beginEdit),
					saved ? React.createElement('span', { style: { fontSize: 12, color: '#2e7d32', whiteSpace: 'nowrap' } }, '✓ ' + T('panel.reasonSaved')) : null,
				);
			};

			const catBlock = (c) => {
				const mode = catModeOf(c);
				const block = status && status.categories && status.categories[tab] ? status.categories[tab] : null;
				const excList = block && block[c] && Array.isArray(block[c].exceptions) ? block[c].exceptions : [];
				// 例外折叠：列表超过阈值默认收起（长列表不再撑爆面板），添加行始终可见
				const excCollapsedState = excCollapsed[c] === undefined ? excList.length > EXC_COLLAPSE_THRESHOLD : excCollapsed[c];
				const toggleExc = () => setExcCollapsed(Object.assign({}, excCollapsed, { [c]: !excCollapsedState }));
				return React.createElement('div', { key: c, style: { border: '1px solid rgba(128,128,128,0.3)', borderRadius: 8, padding: 10, marginBottom: 10 } },
					// ── 标题行：分类名 +（**仅非 command**）该分类的默认动作 ─────────────
					//
					// command 是唯一把默认动作挪到块底部的分类，因为它是唯一有**三层**的
					// 分类：例外 → 破坏性命令 → 其余情况。默认动作留在标题行时，界面自上而下
					// 读到的次序（默认动作 → 例外 → 破坏性命令）与判定链**完全颠倒** ——
					// 而中间那层还挂着 panel.subMismatch「判定链上子设置优先」的提示，
					// 等于用文字承认了顺序是反的。
					//
					// 其余分类只有两层（例外 → 默认动作），标题行放「分类名 + 该分类的
					// 默认值」是卡片布局的惯例，且整块被分类边框包着、例外列表紧贴其下，
					// 不会被读成「管全局」。所以**不动它们** —— 面板里因此只有一处特殊布局，
					// 而这个特殊性是真实的（只有 command 有三层），不是为了统一而统一。
					//
					// 反例：把 command 的默认动作改回这里。regressions 有一条断言钉住
					// 「command 的默认动作下拉必须排在 commandSubRow() 之后」，即为此设。
					c === 'command' ? React.createElement('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 4 } }, catLabel(c))
						: React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 } },
							React.createElement('span', { style: { fontSize: 13, fontWeight: 600 } }, catLabel(c)),
							React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
								// 分类默认值**最终会拒绝**时才有拒绝原因：该分类被拒时它会回给 AI。
								// 判据是 finalActionOf（`auto + 回落 deny` 同样会拒绝），见其注释。
								reasonInput(
									catReasons[tab] ? catReasons[tab][c] : '',
									(e) => setCatReasons(Object.assign({}, catReasons, { [tab]: Object.assign({}, catReasons[tab], { [c]: e.target.value }) })),
									commitCatReason(c),
									finalActionOf(mode, catAutoFallbackOf(c)) === 'deny',
									{ kind: 'cat', tab: tab, key: c },
									// 取消：把草稿还原成服务端当前值（不是清空——用户可能只是改错了想放弃）
									() => revertReason('cat', c),
								),
								// ── 动作在前，回落值在后（由共用组件保证）──────────────────────
								// 读序必须是「**先选动作，再看它失败后怎么办**」：
								//   读取文件   [自动审批 ▾]  失败后：[询问 ▾]
								// 「失败后」是从句，必须跟在它所修饰的主句之后，否则用户会把它读成独立设置项。
								actionFallbackCtl(mode, changeCat(c), tab === 'project' ? ALL_MODES : MODES,
									catAutoFallbackOf(c), changeCatAutoFallback(c), busy),
							),
						),
					// 循环检测（doomloop）的阈值与状态提示。该分类**不挂例外**（EXC_CATS 不含它），
					// 故不放进下面的 EXC_CATS 分支，否则这一行永远不会渲染。
					c === 'doomloop' ? doomloopRow() : null,
					EXC_CATS.indexOf(c) !== -1 ? React.createElement('div', { style: { marginTop: 2 } },
						React.createElement('div', { style: { fontSize: 12, color: 'rgba(128,128,128,0.85)', marginBottom: 4 } },
							T('panel.excCount').replace('{n}', String(excList.length)) + (c === 'command' ? T('panel.excCmdHint') : T('panel.excPathHint')),
						),
						excCollapsedState
							? React.createElement('div', { style: { fontSize: 12, color: '#1f6feb', cursor: 'pointer', userSelect: 'none', padding: '2px 0' }, onClick: toggleExc, title: T('panel.excExpand') },
								'> ' + T('panel.excListLink') + '（' + String(excList.length) + ' ' + T('panel.excUnit') + '）',
							)
							: (excList.length ? React.createElement('div', null,
								// 展开/折叠开关固定在占位行位置：展开后原地变为「▾ 折叠」，条目列在下方
								React.createElement('div', { style: { fontSize: 12, color: '#1f6feb', cursor: 'pointer', userSelect: 'none', padding: '2px 0', marginBottom: 2 }, onClick: toggleExc, title: T('panel.excCollapse') },
									'▾ ' + T('panel.excCollapse'),
								),
								// 展开后加过滤器 + 定高滚动：折叠管「默认不占地方」，滚动管
								// 「展开后不撑爆面板」。两者不冲突，故都保留。
								// 过滤词按分类存（6 个分类各有一份列表，共用一份会互相干扰）。
								listBox({
									items: excList,
									filter: excFilter[c] || '',
									onFilter: (v) => setExcFilter(Object.assign({}, excFilter, { [c]: v })),
									// 添加成功后滚到底（宿主把新例外追加到末尾，见 addProjectException）。
									// **按分类各存一个 DOM 元素**：多个分类默认同时展开（见 excScrollRefs
									// 处的说明），共用一个 ref 会让滚动落到别的分类的列表上。
									// 用 callback ref 而不是 ref 对象：后者没法按分类区分。
									// 卸载时 React 以 null 调用它，故要判空再写，否则会把 null 存进去、
									// 之后 effect 拿到 null（表现为「有时不滚」）。
									scrollRef: (el) => { if (el) excScrollRefs.current[c] = el; else delete excScrollRefs.current[c]; },
									// 匹配字段与用户看到的行一致：匹配内容（path/match）+ 拒绝原因 + 备注。
									// 只搜 path/match 的话，「按原因找那条例外」就做不到。
									match: (r) => [r.path, r.match, r.reason, r.note].filter(Boolean).join(' '),
									// 例外同样是「首条命中即生效」（resolveCategory / matchSegmentException
									// 都只取首个匹配），故顺序即优先级，给排序能力。
									sort: sortOf('exception', c),
									render: (r, ui) => {
										// 编辑态与只读态是**两套结构**，故在 render 内分叉，而不是在同一棵树上
										// 靠条件切换子节点：两态的列数不同（只读是「点/内容/控件」，
										// 编辑是「点/输入框/控件」），共用一棵树只会写出层层嵌套的三元。
										const editing = exEdit === r.id;
										const pat = r.path || r.match || '';
										const act = r.action;
										// 原因 / 备注：**与分类默认值、档位、快捷工具、兜底同一个组件**
										// （reasonInput：只读文字 + 编辑 / 保存 / 取消），样式由构造保证一致。
										//
										// 按**最终动作**二选一：会拒绝的显示「拒绝原因」、会询问的显示「备注」、
										// 其余都不显示（放行的调用不再弹窗，写了也读不到，宿主会丢弃）。
										// 判据是 finalActionOf（`auto + 回落 deny` 在执行侧就是拒绝）。
										//
										// focus 里带 category / field / cur：category 提交时定位分类；field 由渲染处
										// 的 act 决定写 reason 还是 note；cur 是「未改动不发请求」的比较基准。
										const reasonSlot = (field) => reasonInput(
											exReason[r.id] !== undefined ? exReason[r.id] : (r[field] || ''),
											(e) => setExReason(Object.assign({}, exReason, { [r.id]: e.target.value })),
											commitExReason,
											true,
											{ kind: 'exc', tab: tab, key: r.id, category: c, field: field, cur: r[field] || '' },
											() => revertReason('exc', r.id),
										);
										// 编辑态：只改**模式**（原因/备注在上面那排，始终可见可改）。
										if (editing) {
											return React.createElement('div', Object.assign({ key: r.id }, sortRowProps(ui, 'pg-exc')),
												React.createElement('span', {
													className: 'pg-exc-dot',
													style: { background: MODE_COLORS[act] || '#888' },
													title: modeLabel(act),
												}),
												React.createElement('div', { className: 'pg-exc-edit' },
													React.createElement('input', {
														className: 'pg-field',
														placeholder: c === 'command' ? T('panel.excPh') : T('panel.excPathPh'),
														title: T('panel.excEditPat'),
														value: exDraft.value,
														onChange: (e) => setExDraft(Object.assign({}, exDraft, { value: e.target.value })),
														autoFocus: true,
														disabled: busy,
														// 回车 = 保存。与 reasonInput 同：排除输入法组合态，
														// 否则中文用户按回车确认候选词会直接把拼音串写盘。
														onKeyDown: (e) => {
															if (e.nativeEvent && (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229)) return;
															if (e.key === 'Enter') { e.preventDefault(); saveExEdit(c, r); }
															else if (e.key === 'Escape') { e.preventDefault(); cancelExEdit(); }
														},
													}),
												),
												React.createElement('div', { className: 'pg-exc-ctl' },
													actionFallbackCtl(act, setExAction(c, r), MODES,
														exAutoFallbackOf(r), setExAutoFallback(c, r), busy),
													React.createElement('button', { className: 'pg-btn', style: { padding: '2px 8px', fontSize: 12 }, disabled: busy, onClick: () => saveExEdit(c, r) }, T('panel.reasonSave')),
													React.createElement('button', { className: 'pg-btn', style: { padding: '2px 8px', fontSize: 12 }, disabled: busy, onClick: cancelExEdit }, T('panel.cancel')),
												),
											);
										}
										return React.createElement('div', Object.assign({ key: r.id }, sortRowProps(ui, 'pg-exc')),
											// 状态点：与档位行同一个视觉元素，颜色 = 该例外的动作。
											// 取代了原来的彩色文字徽标（「允许」/「拒绝」）—— 同一概念在相邻两处
											// 用两种编码，是这次统一要消掉的东西。动作文字仍在下拉框里可见。
											React.createElement('span', {
												className: 'pg-exc-dot',
												style: { background: MODE_COLORS[act] || '#888' },
												title: modeLabel(act),
											}),
											React.createElement('div', { className: 'pg-exc-main' },
												React.createElement('span', { className: 'pg-exc-pat', title: pat }, pat),
											// 「匹配任意单段」的判据：命令例外里这几乎等于「不再审查任何命令」。
											// 不拦（那是用户的权利），但必须给出黄色提示，否则它看起来和普通例外没区别。
											// 只对命令分类提示：路径侧的 `*` 在 glob 语义下范围受限（不跨分隔符），不属同一问题。
											//
											// 判据必须与**匹配器同构**，不能写 `=== '*'`：命令侧的 globMatch 里
											// `*` 与 `?` 之外没有特殊含义，故 `**`、`***` 与裸 `*` 完全等价
											// （都匹配任意段），字面量比较会让它们漏报。
											// `**` 尤其容易被踩：本仓库路径侧注释与 placeholder 都把 `**` 当惯用写法
											// （「`**` 会匹配整个子树」），用户照搬进命令例外极自然 —— 面板却不给警告。
											//
											// 同构判据：模式**只由 `*` 与空格组成**时匹配任意段。
											//   · 纯 `*` 序列（`*` / `**` / `***`）→ 匹配任意段 ✓
											//   · `* *` 也匹配任意段（实测：对含空格的段两个 `*` 各吞一半；
											//     对无空格段由「尾随 ` *`」分支覆盖）→ 同样提示
											//   · 含 `?` 的不算：`?` 要求恰好一个字符，`?*` / `??` 并不匹配任意段
											//     （写成 `/^[*?]+$/` 会把它们误报，实测过）
											//   · 含其他字符的不算（`a*` / `git *` 都限定了前缀）
											c === 'command' && /^[*\s]+$/.test(String(r.match || '')) && String(r.match || '').indexOf('*') !== -1
												? React.createElement('span', { style: { fontSize: 11, color: '#bf8700', whiteSpace: 'nowrap' }, title: T('panel.excTooBroadHint') }, '⚠ ' + T('panel.excTooBroad'))
												: null,
											// 爆炸半径标注（宿主下发 exceptionBlast，只对 **allow** 例外且目标落在
											// 盘根/系统目录/家目录/工作区外时才有）。
											//
											// 与上面那条「匹配范围过宽」是**两个不同的失效模式**，必须分开显示：
											//   · 过宽  —— 一条例外覆盖了太多**命令**（`*` 匹配任意段）；
											//   · 爆炸半径 —— 一条例外本身很具体，但它指向的目标删了就没（`rmdir /s /q B:\`）。
											// 后者正是最难自己发现的形态：例外写得很精确，精确地指向了整个盘。
											//
											// 为什么列表里也要标：这是唯一能让人**事后**发现「我什么时候放行了删盘根」的地方
											// （弹窗是一次性的，列表是长期可见的）。落盘值本身不存这个结论（读侧现算）。
											//
											// ── 只标**命令**例外（与上面 excTooBroad 同一个门）────────────────────
											// 路径例外上这个标注不成立，两类原因：
											//
											// ① `outside` 档在路径侧是同义反复。区外闸的分类名（「工作区外读取」
											//    /「工作区外写入」）已经写明了适用范围，而一条区外闸例外**只可能
											//    在工作区外被命中** —— resolveCategory 对区外闸的调用点只有
											//    outsideMatrix 一处，而 outsideMatrix 的 4 个调用点全在
											//    `if (fp && isOutside(fp, root))` 内
											//    —— 于是「存在一条区外闸例外」⟺「它被标 outside」。
											//    用户为了跨项目协作写的每一条路径例外，都必然收到一次「目标范围过大」，
											//    而它本身毫无问题。实测：工作区 proj-a、例外指向同级 proj-b
											//    → 区外写闸与 read 两条例外都被标 outside。
											//
											// ② 标签与档位含义在路径侧对不上。`panel.excBlast` 是「目标范围过大」，
											//    而 outside 档的 title 是「目标在工作区之外——不在本项目范围内」：
											//    对命令例外这两句是一回事（模式能删到工作区外 = 管得宽），
											//    对路径例外不是 —— 一条指向隔壁项目的具体目录的例外并没有「过大」，
											//    它只是不在本项目里，而那正是用户写它的理由。
											//
											// 路径侧剩下的三档（drive-root / system / home）说的确实是「目标本身有多大」，
											// 与「在不在工作区里」无关，但它们在**命令**例外上同样能表达
											// （`rm -rf C:/*` 这种模式），故这一门收在分类上、不按档位分：
											// 命令例外照旧八档全标，路径例外一律不标。
											//
											// 宿主侧一个字不改：exceptionBlast 照算、照下发，面板只是不画。
											// 判定（blastRadiusOf）与下发形状都不受影响，将来若要在别处用这份数据仍然有。
											(() => {
												if (c !== 'command') return null;
												const b = exceptionBlastOf(tab, r.id);
												const meta = b && BLAST_LEVELS[b.level];
												if (!meta) return null;
												return React.createElement('span', {
													style: { fontSize: 11, color: meta.color, whiteSpace: 'nowrap' },
													title: T(meta.key).replace('{p}', b.path || ''),
												}, meta.icon + ' ' + T('panel.excBlast'));
											})(),
											// 遮蔽标注（宿主下发 exceptionShadow）：这条例外被上方更早的一条反向例外
											// 遮蔽，**当前不生效**。
											//
											// 与上面两条是**第三种**失效模式，必须分开显示：
											//   · 过宽    —— 覆盖了太多命令；
											//   · 爆炸半径 —— 本身很具体，但目标删了就没；
											//   · 被遮蔽  —— 完全没生效（顺序问题，用户拖一下就能修）。
											// 第三条最隐蔽：面板提示「已保存」、列表里也看得见那一行，用户会以为
											// 决定已生效 —— 而实际裁决仍按上面那条走。
											//
											// 配色用**错误红**（不是警告橙）：前两条是「范围不理想」，这一条是
											// 「你设的东西根本没起作用」，严重程度与它们不同级。
											//
											// 与上面 explosionBlast 同样用 IIFE：都要「先取值、无则返回 null」，
											// 用三元表达式写会多一次取值或引入重复判空。
											(() => {
												const sh = exceptionShadowOf(tab, r.id);
												if (!sh) return null;
												return React.createElement('span', {
													style: { fontSize: 11, color: MODE_COLORS.deny, whiteSpace: 'nowrap', fontWeight: 600 },
													title: T('panel.excShadowedHint').replace('{a}', sh.byAction || '').replace('{id}', sh.byId || ''),
												}, '⛔ ' + T('panel.excShadowed'));
											})(),
											),
											React.createElement('div', { className: 'pg-exc-ctl' },
												// 动作 + 失败后：走共用组件（这一处**此前没有**回落值选择器）。
												// 「即时生效」的性质不变 —— 两个下拉都是 onchange 即写盘。
												actionFallbackCtl(act, setExAction(c, r), MODES,
													exAutoFallbackOf(r), setExAutoFallback(c, r), busy),
												// 原因 / 备注排在**下拉之后**，与快捷工具行（quickRow）同序：
												// 那里是 `[工具名+说明] [动作▾] [原因] [删除]`，这里就是
												// `[模式] [动作▾] [原因] [↑↓] [改匹配] [删除]`。
												//
												// 曾经排在下拉**之前**（紧跟模式）：那样换行时会把下拉挤到下一行，
												// 而原因留在上一行 —— 与快捷工具「名字和下拉同行、原因另起一行」
												// 的观感完全不同（实测反馈「？」）。
												// quickRow 里那条注释讲的是同一件事的反面：原因插在下拉前面会把
												// 下拉整体右推，只有选「拒绝」的行会漂，看起来就是位置漂移。
												//
												// 判据是**最终动作**（finalActionOf）：`auto + 回落 deny` 在执行侧
												// 就是拒绝，宿主会存它的 reason，面板必须给框；`auto + 回落 ask` 反之。
												finalActionOf(act, r.autoFallback) === 'deny' ? reasonSlot('reason') : null,
												finalActionOf(act, r.autoFallback) === 'ask' ? reasonSlot('note') : null,
												moveButtons(ui),
												// 编辑：进入整行编辑态（模式 / 原因 / 备注）
												// 按钮文案**必须与原因格的「编辑」区分开**：同一行里现在有两个可编辑的
												// 东西（匹配模式、原因/备注），两个都叫「编辑」时用户不知道点哪个改哪个。
												// 原因格那个沿用 reasonInput 的通用「编辑」（与其余四处一致），
												// 这个改叫「改匹配」——它只改模式。
												React.createElement('button', { className: 'pg-btn', style: { padding: '2px 8px', fontSize: 12 }, disabled: busy, onClick: () => beginExEdit(r) }, T('panel.excEditPatBtn')),
												React.createElement('button', { className: 'pg-btn pg-btn-danger' + (confirm === 'exc:' + c + ':' + r.id ? ' pg-btn-confirm' : ''), disabled: busy, onClick: () => confirmDelete('exc:' + c + ':' + r.id, () => removeException(c, r.id)) }, confirm === 'exc:' + c + ':' + r.id ? T('panel.confirmDel') : T('panel.del')),
												confirm === 'exc:' + c + ':' + r.id ? React.createElement('button', { className: 'pg-btn', disabled: busy, onClick: () => setConfirm(null) }, T('panel.cancel')) : null,
											),
										);
									},
								}),
							) : React.createElement('div', { style: { fontSize: 12, color: 'rgba(128,128,128,0.7)' } }, T('panel.excNone'))),
						React.createElement('div', { style: { display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' } },
							React.createElement('input', { className: 'pg-field', placeholder: c === 'command' ? T('panel.excPh') : T('panel.excPathPh'), value: exVals[c] || '', onChange: (e) => setExVals(Object.assign({}, exVals, { [c]: e.target.value })), disabled: busy }),
							// 动作 + 失败后：走共用组件（新增行现在也能设回落值了 ——
							// 之前那两排只有动作下拉，选了 auto 却看不到也改不了落点）。
							actionFallbackCtl(exOf(c).action, (e) => setExField(c, { action: e.target.value }), MODES,
								exOf(c).autoFallback, (e) => setExField(c, { autoFallback: e.target.value }), busy),
							// 两个输入框按**最终动作**二选一：会拒绝时填「拒绝原因」（回给 AI），
							// 会询问时填「备注」（方便日后回看）。判据与宿主的存留判据同源。
							finalActionOf(exOf(c).action, exOf(c).autoFallback) === 'deny' ? React.createElement('input', { className: 'pg-field', style: { maxWidth: 220 }, placeholder: T('panel.excReasonPh'), title: T('panel.excReason'), value: exOf(c).reason || '', onChange: (e) => setExField(c, { reason: e.target.value }), disabled: busy }) : null,
							finalActionOf(exOf(c).action, exOf(c).autoFallback) === 'ask' ? React.createElement('input', { className: 'pg-field', style: { maxWidth: 220 }, placeholder: T('panel.excNotePh'), title: T('panel.excNote'), value: exOf(c).note || '', onChange: (e) => setExField(c, { note: e.target.value }), disabled: busy }) : null,
							React.createElement('button', { className: 'pg-btn', disabled: busy, onClick: () => addException(c) }, T('panel.addExc')),
						),
						// command 分类的子设置「破坏性命令」排在**例外之后**，与判定链的
						// 「例外 → 子设置」两段一致（例外优先于子设置，故例外画在上面）。
						// 子设置比大分类知道得更多，故它**独立于下方默认动作**生效 —— 默认动作设成
						// 「允许」时，破坏性命令仍按这里的动作走（这是修复一个失效的原有意图，
						// 不是新增一层）。
						c === 'command' ? commandSubRow() : null,
					) : null,
					// 「其余情况」= 命令分类的**最后一道闸门**（判定链的第三段）。
					//
					// 它排在子设置之后，于是 command 块自上而下读一遍就是判定链本身
					// （例外 → 破坏性命令 → 其余情况），用户不需要知道「优先级」这个词。
					// 这是本次改动的**核心不变式**：regressions 有一条断言钉住
					// 「command 的默认动作下拉必须出现在 commandSubRow() 之后」，
					// 把它挪回标题行即失败。
					//
					// 只 command 有这一行：其余五个分类只有两层，默认动作留在标题行
					// （理由见上方标题行处的说明）。
					//
					// **刻意排在 EXC_CATS 分支之外**（与 doomloopRow 同处，不是与
					// commandSubRow 同处）：那一行回答的是「哪些分类挂例外列表」，而这里
					// 画的是分类的**默认动作** —— 它与「有没有例外」无关。留在分支里会让
					// command **唯一**的默认动作入口随宿主下发的 excCats 一起出现或消失
					// （宿主当前恒含 command，故现在不可达；但那是宿主清单的巧合，不是
					// 这里的约束 —— 与 doomloopRow 处「不放进 EXC_CATS 分支，否则这一行
					// 永远不会渲染」是同一条纪律）。子设置 commandSubRow 依附例外体系，
					// 故留在分支内。
					c === 'command' ? commandRestRow() : null,
				);
			};

			// 行集合按 tab 区分：项目 tab 显示全集（预设 + 全局键 + 项目键），便于在项目里覆盖全局；
			// 全局 tab 只显示「预设 + 全局配置里确实存在的键」，避免项目层专有的键在这里冒充全局设置。
			const quickGq = status && status.quickTools ? status.quickTools.global : null;
			const quickTools = Object.keys(quickSel).filter((t) => {
				if (tab === 'project') return true;
				if (QUICK_PRESET.indexOf(t) !== -1) return true;
				return hasOwnKey(quickGq, t);
			});
			const quickRow = (t) => {
				const key = tab === 'global' ? 'g' : 'p';
				const gqMap = status && status.quickTools ? status.quickTools.global : null;
				const pqMap = status && status.quickTools ? status.quickTools.project : null;
				const mode = quickSel[t] && quickSel[t][key] ? quickSel[t][key] : (tab === 'project' ? 'inherit' : quickGlobalValue(t, gqMap));
				// 删除按钮只给「用户自己添加的名字」（不在预设清单 QUICK_PRESET 里的行），且本行在当前 tab 的配置里
				// 确实存在该键时才显示：预设行始终会列出，删掉配置键也只是回退默认值，容易被误读成「收紧」。
				const isPreset = QUICK_PRESET.indexOf(t) !== -1;
				const hasKey = key === 'g' ? hasOwnKey(gqMap, t) : hasOwnKey(pqMap, t);
				const desc = quickDesc(t);
				// 该行的回落值（快捷工具面板**没有**回落值选择器，故它只可能来自手改配置）。
				// 取法收敛在 quickAutoFallbackOf（changeQuick 判编辑态时也要用同一份）。
				const qAf = quickAutoFallbackOf(t);
				return React.createElement('div', { key: t, style: rowStyle },
					React.createElement('span', { style: { display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 260 } },
						React.createElement('span', { style: { fontFamily: 'monospace', fontSize: 13 } }, t),
						desc ? React.createElement('span', { style: { fontSize: 12, color: 'rgba(128,128,128,0.9)' } }, desc) : null,
					),
					// 动作 + 失败后：走共用组件（这一处**此前没有**回落值选择器）。
					actionFallbackCtl(mode, changeQuick(t), tab === 'project' ? ALL_MODES : MODES,
						qAf, changeQuickAutoFallback(t), busy),
					// 拒绝原因排在动作下拉**之后**：工具名 span 的 minWidth 撑出了固定的下拉列宽，
					// 输入框插在它前面会把该行的下拉整体右推（窄面板下直接换行到下一行），
					// 看起来就是「位置漂移」——只有选「拒绝」的行会漂，其它行不动。
					reasonInput(
						quickReason[t] ? quickReason[t][key] : '',
						(e) => setQuickReason(Object.assign({}, quickReason, { [t]: Object.assign({}, quickReason[t], { [key]: e.target.value }) })),
						commitQuickReason(t),
						// 判据是**最终动作**（finalActionOf）：`auto + 回落 deny` 在执行侧就是拒绝，
						// 宿主会存它的 reason，面板必须给框；`auto + 回落 ask/allow` 反之。
						finalActionOf(mode, qAf) === 'deny',
						{ kind: 'quick', tab: tab, key: t },
						// 取消：还原成服务端当前值
						() => revertReason('quick', t),
					),
					(!isPreset && hasKey) ? React.createElement('button', { className: 'pg-btn pg-btn-danger' + (confirm === 'quick:' + tab + ':' + t ? ' pg-btn-confirm' : ''), disabled: busy, onClick: () => confirmDelete('quick:' + tab + ':' + t, () => removeQuick(t)) }, confirm === 'quick:' + tab + ':' + t ? T('panel.confirmDel') : T('panel.del')) : null,
				);
			};

			const ruleRow = (r, ui) => {
				const matchers = [];
				if (r.tool) matchers.push('tool=' + r.tool);
				if (r.path) matchers.push('path=' + r.path);
				if (r.args) matchers.push('args="' + r.args + '"');
				return React.createElement('div', Object.assign({ key: r.id }, sortRowProps(ui)),
					badge(r.action),
					// auto 的回落值必须显示：它在执行侧决定模型失败后放行还是拒绝（见 finalActionOf），
					// 只显示「自动审批」而不显示回落值，等于把这条规则的实际效果藏起来。
					// 规则列表是只读的（宿主没有 set-rule 路由），故这里只给文本，与快捷工具行的只读态同形。
					r.action === 'auto' ? React.createElement('span', { style: { fontSize: 12, color: 'rgba(128,128,128,0.95)', whiteSpace: 'nowrap' } }, T('panel.autoFallbackLabel') + modeLabel(r.autoFallback === 'allow' || r.autoFallback === 'deny' ? r.autoFallback : 'ask')) : null,
					React.createElement('span', { style: { fontFamily: 'monospace', fontSize: 12 } }, matchers.join('  ') || T('panel.all')),
					r.reason ? React.createElement('span', { style: { fontSize: 12, color: 'rgba(128,128,128,0.9)' } }, '(' + r.reason + ')') : null,
					React.createElement('div', { style: { display: 'flex', gap: 6, marginLeft: 'auto' } },
						moveButtons(ui),
						React.createElement('button', { className: 'pg-btn pg-btn-danger' + (confirm === 'rule:' + r.id ? ' pg-btn-confirm' : ''), disabled: busy, onClick: () => confirmDelete('rule:' + r.id, () => removeRule(r.id)) }, confirm === 'rule:' + r.id ? T('panel.confirmDel') : T('panel.del')),
						confirm === 'rule:' + r.id ? React.createElement('button', { className: 'pg-btn', disabled: busy, onClick: () => setConfirm(null) }, T('panel.cancel')) : null,
					),
				);
			};

			const customList = status && status.custom ? status.custom[tab] : null;
			const decisions = status && status.recentDecisions ? status.recentDecisions : [];
			// 「最近决策」的展开：首屏用 statusView 带来的 decisions，展开后用按需取回的全量。
			// decisionTotal 是宿主下发的计数（O(1)），首屏条数由它自己那份列表长度得出 ——
			// 不在客户端硬编码 10，否则宿主改 DECISIONS_PREVIEW 时按钮会出现/消失错判。
			const decisionTotal = status && typeof status.decisionCount === 'number' ? status.decisionCount : decisions.length;
			// 「是否真的展开了」的**唯一判据**：只有取回列表（{ list }）才算展开。
			// 'loading' 与 { error } 都不算 —— 它们仍显示首屏那 10 条，故既不该出滚动条
			// （10 条不值得），也不该把按钮换成「收起」（失败后用户要能再点一次重试）。
			// 取值、限高样式、按钮三处都消费这一个值，不再各写一遍判据：各写一遍时分叉过 ——
			// 限高那处只判 `!== 'loading'`，于是失败态给首屏 10 条套上了滚动条，与
			// 「未展开不限高」的约定相反。
			const expandedList = Array.isArray(decisionsExpanded && decisionsExpanded.list) ? decisionsExpanded.list : null;
			const decisionsShown = expandedList || decisions;
			const toggleDecisions = () => {
				// 收起：丢掉取回的那份，回到首屏（下次展开重新取 —— 快照没有失效通知，
				// 重取是它唯一的刷新方式，见 state 处的说明）。
				if (expandedList) { setDecisionsExpanded(null); return; }
				setDecisionsExpanded('loading');
				call('permgate:decisions').then((r) => {
					if (r && r.error) { setDecisionsExpanded({ error: String(r.error) }); return; }
					setDecisionsExpanded({ list: (r && r.decisions) || [] });
				}).catch((e) => setDecisionsExpanded({ error: String((e && e.message) || e) }));
			};
			const stats = status && status.stats ? status.stats : { deny: 0, ask: 0 };
			const sandbox = status && status.sandbox ? status.sandbox : { global: 'workspace-write', project: 'inherit', effective: 'workspace-write' };

			const sandboxLabel = (m) => (m === 'workspace-write' ? T('sandbox.ww') : m === 'danger-full-access' ? T('sandbox.fa') : T('sandbox.inherit'));
			const sandboxVal = tab === 'global' ? sandbox.global : sandbox.project;
			const fbVal = status && status.fallback ? (tab === 'global' ? status.fallback.global : status.fallback.project) : (tab === 'global' ? 'ask' : 'inherit');
			// 兜底的回落值（兜底面板**没有**回落值选择器，故它只可能来自手改配置）。
			// 项目层 `inherit` 时取全局值（裁决确实会穿透），与 fallbackSetting 同源。
			const fbAutoFallbackOf = (st, t) => {
				const src = st || status;
				const fb = src && src.fallback;
				if (!fb) return null;
				const v = (t || tab) === 'global' ? fb.globalAutoFallback : (fb.projectAutoFallback || fb.globalAutoFallback);
				return v === 'allow' || v === 'deny' ? v : 'ask';
			};
			// 兜底**最终会拒绝** → 才显示拒绝原因框（`auto + 回落 deny` 也算，判据见 finalActionOf）
			const fbShowReason = finalActionOf(fbVal, fbAutoFallbackOf()) === 'deny';
			// 兜底**回落值**写入（/permgate/set-fallback 的 autoFallback 参数）。
			// 必须带 mode（取当前兜底动作）：宿主的 setFallbackMode 用它决定要不要存回落值。
			// ⚠️ 传的 mode 是**当前**值而不是 'auto' —— 用户改回落值时动作没变，
			// 传 'auto' 会在当前不是 auto 时凭空把动作改成 auto。
			const changeFallbackAutoFallback = (e) => {
				const v = e.target.value;
				invoke('permgate:set-fallback', { target: tab, mode: fbVal, autoFallback: v },
					() => setMsg(T('panel.fallbackSaved').replace('{t}', T(tab === 'global' ? 'panel.tabGlobal' : 'panel.tabProject')).replace('{v}', modeLabel(fbVal))));
			};
			const changeFallback = (e) => {
				const mode = e.target.value;
				// 同 changeCat：切离「最终会拒绝」时作废该格的编辑态（兜底每层只有一个键，按格等价于按 tab）
				if (finalActionOf(mode, fbAutoFallbackOf()) !== 'deny') exitEditOf('fb', null);
				invoke('permgate:set-fallback', { target: tab, mode }, () => setMsg(T('panel.fallbackSaved').replace('{t}', T(tab === 'global' ? 'panel.tabGlobal' : 'panel.tabProject')).replace('{v}', modeLabel(mode))));
			};
			// 兜底拒绝原因保存（仅兜底最终会拒绝时该控件可见）
			// 同 commitCatReason：空串是「显式清除」，不可折叠成 undefined（那会变成「保留原值」）
			const commitFbReason = (focus) => {
				if (!fbShowReason) return;
				const v = fbReason[tab];
				const prev = tab === 'global' ? (status && status.fallback && status.fallback.globalReason) : (status && status.fallback && status.fallback.projectReason);
				if ((v || '') === (prev || '')) return;
				// 同 commitCatReason：对勾只在写盘成功后亮。
				//
				// ⚠️ mode 必须传**当前兜底动作**而不是硬编码 'deny'：兜底是 `auto + 回落 deny`
				// 时该框同样可见，若这里写 'deny' 就会把用户的 auto 设置**静默改成 deny**
				// —— 模型判断那一步被一次「改原因」抹掉。
				invoke('permgate:set-fallback', { target: tab, mode: fbVal, reason: v }, () => markReasonSaved(focus));
			};
			const sandboxOptions = tab === 'global' ? ['workspace-write', 'danger-full-access'] : ['workspace-write', 'danger-full-access', 'inherit'];
			const changeSandbox = (e) => {
				const mode = e.target.value;
				invoke('permgate:set-sandbox', { target: tab, mode }, () => setMsg(T('panel.sandboxSaved').replace('{t}', T(tab === 'global' ? 'panel.tabGlobal' : 'panel.tabProject')).replace('{v}', sandboxLabel(mode))));
			};

			return React.createElement('div', { style: { maxWidth: 760, fontFamily: FONT, color: 'var(--dsw-alias-label-primary, #24292f)' } },
				React.createElement('div', { style: card },
					React.createElement('div', { style: h() }, T('panel.status')),
					React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
						React.createElement('span', { style: small }, T('panel.config') + (status ? status.configPath : '…')),
						React.createElement('button', { className: 'pg-btn', disabled: busy, onClick: openConfig }, T('panel.openConfig')),
						React.createElement('button', { className: 'pg-btn', disabled: busy, onClick: reload }, T('panel.reload')),
					),
					React.createElement('div', { style: small }, T('panel.stats').replace('{d}', String(stats.deny)).replace('{a}', String(stats.ask))),
					status && status.loadError ? React.createElement('div', { style: { color: '#c62828', fontSize: 12 } }, T('panel.loadErr') + status.loadError) : null,
					status && status.saveError ? React.createElement('div', { style: { color: '#c62828', fontSize: 12 } }, T('panel.saveErr') + status.saveError) : null,
				),
				React.createElement('div', { style: { display: 'flex', marginBottom: 12, borderBottom: '1px solid rgba(128,128,128,0.35)' } },
					tabBtn('global', T('panel.tabGlobal')),
					tabBtn('project', T('panel.tabProject')),
					// ── 第三个 tab：自动审批（auto）的工程参数 ────────────────────────
					// 它**不是**「第三个配置层」，而是与前两个 tab 不同的东西：
					// 前两个回答「某个项目的权限怎么定」，这一个回答「评审机制怎么跑」。
					// 放在 tab 栏而不是下面某张卡片，理由：
					//   · 它是**全局专属**的，塞进 global tab 会让人以为项目层也能配；
					//   · 它和「分类/例外/快捷工具/兜底」是并列的两类设置，不该挂在其中某一类下面
					//     （原先放在兜底卡片之后，读起来像「兜底的一部分」）。
					//
					// ⚠️ 这个 tab **不参与** `tab === 'global' / 'project'` 的任何判断：
					// 下面在 tab 栏之后立刻分流（`tab === 'auto'` 时直接渲染这张卡片并返回），
					// 故 100+ 处依赖 tab 的代码一行都不用改、也不会被误触。
					tabBtn('auto', T('panel.tabAuto')),
				),
				// ── auto tab：只渲染自动审批的设置，**不渲染任何项目层设置** ──────────
				// 分流必须在这里（tab 栏之后、所有设置卡片之前）：下面的卡片全部按
				// `tab === 'global' ? 全局 : 项目` 取数，若让 `tab='auto'` 流下去，
				// 它们会集体走「项目层」分支 —— 那是 100+ 处同时出错，且会向宿主发
				// `{ target: 'auto' }` 这种它不认识的值。
				// 用一个三元的 Fragment 把它们整体挡住，那一片代码对 auto tab **完全不可达**。
				//
				// 为什么不用 `if (tab === 'auto') return ...`：那样会提前返回、连带把下面
				// 的 `notice` / `msg` 状态提示也跳过（用户在 auto tab 里改设置就看不到「已保存」）。
				// 用三元挡板可以把提示留在外面，让任何 tab 都能看到。
				tab === 'auto' ? autoReviewCard() : null,
				tab === 'auto' ? null : React.createElement(React.Fragment, null,
				React.createElement('div', { style: { fontSize: 12, color: 'rgba(128,128,128,0.85)', marginBottom: 8 } },
					tab === 'global' ? T('panel.editGlobal') : T('panel.editProject').replace('{p}', status ? status.projectKey : ''),
				),
				React.createElement('div', { style: card },
					React.createElement('div', { style: h() }, T('panel.sandbox')),
					React.createElement('div', { style: { fontSize: 12, color: 'rgba(128,128,128,0.85)', marginBottom: 6 } },
						sandboxVal === 'inherit' ? T('sandbox.desc.inherit').replace('{g}', sandboxLabel(sandbox.global)) : (sandboxVal === 'workspace-write' ? T('sandbox.desc.ww') : T('sandbox.desc.fa')),
					),
					React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
						React.createElement('select', { className: 'pg-field', style: { padding: '2px 6px' }, value: sandboxVal, onChange: changeSandbox, disabled: busy },
							sandboxOptions.map((m) => React.createElement('option', { key: m, value: m }, sandboxLabel(m))),
						),
					),
				),
				// 分类块之间插入「命令管辖边界」说明：紧跟第一个分类（执行命令）之后、
				// 其余分类之前。第一个分类恒为 command（CATS[0] 由宿主下发顺序决定，
				// 见 index.js 的 CATS 常量 —— 那里把它排在首位是为了「唯一三层布局」，
				// 本行依附于同一前提）。
				//
				// 判据取 `CATS[0] === 'command'` 而不是写死「在第一个块后」：宿主若调整
				// 顺序、command 不再居首，这里会**静默错位**（说明挂到别的分类后面）。
				// 故显式判一次 —— 前提不成立时不渲染，而不是画错位置。
				CATS.map((c, i) => React.createElement(React.Fragment, { key: c },
					catBlock(c),
					(c === 'command' && i === 0) ? commandScopeNote() : null,
				)),
				React.createElement('div', { style: card },
					React.createElement('div', { style: h() }, T('panel.quick')),
					React.createElement('div', { style: { fontSize: 12, color: 'rgba(128,128,128,0.8)', marginBottom: 6 } }, T('panel.quickHint')),
					// 预设清单（QUICK_PRESET，数量随宿主下发，不在这里写死）+ 用户自定义（无上界）
					// → 过滤器 + 定高滚动。
					// 匹配工具名与描述两栏：用户可能记得中文描述（「任务清单」）而不记得工具名（todo_write）。
					listBox({
						items: quickTools,
						filter: quickFilter,
						onFilter: setQuickFilter,
						// 添加成功后滚到底（新行追加在末尾，见 addQuick）
						scrollRef: quickScrollRef,
						match: (t) => t + ' ' + (quickDesc(t) || ''),
						render: quickRow,
					}),
					React.createElement('div', { style: { display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' } },
						React.createElement('input', { className: 'pg-field', placeholder: T('panel.quickAdd'), value: newTool, onChange: (e) => setNewTool(e.target.value), disabled: busy }),
						// 动作 + 失败后：走共用组件（新增行现在也能设回落值了）。
						actionFallbackCtl(newToolAction, (e) => setNewToolAction(e.target.value), MODES,
							newToolAutoFallback, (e) => setNewToolAutoFallback(e.target.value), busy),
						// 新增行**最终会拒绝**时同样给原因输入框，与已存在的行保持一致。
						// 提交回调传 null：新增行没有独立的保存动作，原因随「添加」按钮一并下发。
						reasonInput(
							newToolReason,
							(e) => setNewToolReason(e.target.value),
							null,
							finalActionOf(newToolAction, newToolAutoFallback) === 'deny',
							null,
						),
						React.createElement('button', { className: 'pg-btn', disabled: busy, onClick: addQuick }, T('panel.quickAddBtn')),
					),
				),
				React.createElement('div', { style: card },
					React.createElement('div', { style: h() }, T('panel.rules')),
					React.createElement('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 } },
						// 动作 + 失败后：走共用组件（规则是六处里最后一处手写 option 的，auto 一直选不了）
						actionFallbackCtl(form.action, setFormKey('action'), MODES,
							newRuleAutoFallback, (e) => setNewRuleAutoFallback(e.target.value), busy),
						React.createElement('input', { placeholder: T('panel.toolPh'), value: form.tool, onChange: setFormKey('tool'), className: 'pg-field', disabled: busy }),
						React.createElement('input', { placeholder: T('panel.pathPh'), value: form.path, onChange: setFormKey('path'), className: 'pg-field', disabled: busy }),
						React.createElement('input', { placeholder: T('panel.argsPh'), value: form.args, onChange: setFormKey('args'), className: 'pg-field', disabled: busy }),
						React.createElement('input', { placeholder: T('panel.reasonPh'), value: form.reason, onChange: setFormKey('reason'), className: 'pg-field', disabled: busy }),
						React.createElement('button', { className: 'pg-btn', disabled: busy, onClick: addRule }, tab === 'global' ? T('panel.addToGlobal') : T('panel.addToProject')),
					),
					React.createElement('div', { style: { marginTop: 8 } },
						React.createElement('div', { style: { fontSize: 12, fontWeight: 600, marginBottom: 4 } }, T('panel.ruleList').replace('{t}', T(tab === 'global' ? 'panel.tabGlobal' : 'panel.tabProject')).replace('{n}', String(customList ? customList.length : 0))),
						// 规则条目数无上界，且单行比快捷工具长（tool= / path= / args="…" 三段拼接）
						// → 同样加过滤器 + 定高滚动。过滤词按 tab 分（全局/项目各一份列表）。
						listBox({
							items: customList || [],
							filter: ruleFilter[tab] || '',
							onFilter: (v) => setRuleFilter(Object.assign({}, ruleFilter, { [tab]: v })),
							// 四个字段都可搜：用户可能按原因找规则（「那条不许删的规则」）。
							match: (r) => [r.tool, r.path, r.args, r.reason].filter(Boolean).join(' '),
							// 规则**最需要**排序：新规则 push 到尾部，而 decide() 首条命中即返回 ——
							// 被前面某条遮蔽的新规则会静默不生效，用户必须能把它提到前面。
							sort: sortOf('rule', null),
							render: ruleRow,
							empty: React.createElement('div', { style: { fontSize: 12, color: 'rgba(128,128,128,0.8)' } }, T('panel.noRules')),
						}),
					),
				),
				React.createElement('div', { style: card },
					React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 } },
						React.createElement('span', { style: { fontSize: 13, fontWeight: 600 } }, T('panel.fallback')),
						React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
							// 兜底**最终会拒绝**时才有拒绝原因：未匹配任何规则的调用被拒时回给 AI。
							// 判据是 finalActionOf（`auto + 回落 deny` 同样会拒绝），见其注释。
							reasonInput(
								fbReason[tab],
								(e) => setFbReason(Object.assign({}, fbReason, { [tab]: e.target.value })),
								commitFbReason,
								fbShowReason,
								{ kind: 'fb', tab: tab, key: null },
								// 取消：还原成服务端当前值
								() => revertReason('fb', null),
							),
							// 动作 + 失败后：走共用组件（这一处**此前没有**回落值选择器）。
							actionFallbackCtl(fbVal, changeFallback, tab === 'global' ? MODES : ALL_MODES,
								fbAutoFallbackOf(), changeFallbackAutoFallback, busy),
						),
					),
					React.createElement('div', { style: { fontSize: 12, color: 'rgba(128,128,128,0.85)' } }, T('panel.fallbackHint')),
				),
				React.createElement('div', { style: card },
					React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '0 0 8px' } },
						React.createElement('div', { style: h() }, T('panel.decisions')),
						// 展开/收起按钮：两种情形出现 —— ①后端确实有更多条（decisionCount 由 statusView
						// 下发，是 O(1) 的计数而非内容）；②**已展开**（复用上面那个单一判据）。
						// ②不能省：decisions 只增不减仅在**单次插件生命周期内**成立 —— 插件重载后
						// 宿主侧数组清空、decisionCount 归 0，①的判据变假，而 decisionsShown 仍在
						// 渲染展开时取回的那份快照。按钮一消失，用户就被锁在陈旧展开态里，只能刷新整页。
						// 判据里比的是**首屏那份列表**（decisions）而不是当前显示的列表 ——
						// 用后者时展开后两者相等、按钮会消失，用户就再也收不回去。
						(expandedList || decisionTotal > decisions.length) ? React.createElement('button', {
							className: 'pg-btn',
							disabled: decisionsExpanded === 'loading',
							onClick: toggleDecisions,
						}, decisionsExpanded === 'loading' ? T('panel.decisionsLoading')
							// 收起文案里的 {m} 是**首屏条数**（收起后会剩几条），不是当前显示的条数。
							: expandedList ? T('panel.decisionsCollapse').replace('{m}', String(decisions.length))
							: T('panel.decisionsExpand').replace('{n}', String(decisionTotal))) : null,
					),
					decisionsShown.length ? React.createElement('div', {
						// 展开后限高 + 滚动：100 条记录全铺开会把整个设置页撑成一条长滚动条，
						// 用户反而找不到下面的分类设置。未展开（含 loading / 失败态）时不限高 ——
						// 那两种态显示的就是首屏 10 条，不值得出滚动条。
						style: expandedList
							? { maxHeight: 360, overflowY: 'auto', overscrollBehavior: 'contain' }
							: null,
					}, decisionsShown.map((d, i) => React.createElement('div', { key: i, style: rowStyle },
						badge(d.action),
						React.createElement('span', { style: { fontFamily: 'monospace', fontSize: 12 } }, d.tool),
						// reason 可能很长（段摘要上限 300 字符）且不换行会把行撑出面板，
						// 故给这一格 minWidth:0 + 允许换行，让它在剩余宽度内折行。
						React.createElement('span', { style: { fontSize: 12, color: 'rgba(128,128,128,0.9)', minWidth: 0, flex: '1 1 100%', wordBreak: 'break-word', whiteSpace: 'pre-wrap' } }, d.reason || ''),
						// 模型原话（auto 专有）：auto-deny 是**不弹窗**的路径，reason 只剩
						// 「自动审批：模型拒绝」+ 段摘要，工具侧又已把 modelReason 剥掉，
						// 于是这里是它唯一的展示位。
						// 与弹窗同款样式类 + 前缀「模型判断：」：第三方文本必须与 permgate
						// 自己的结论视觉可区分（单靠灰色斜体在深色主题下区分度不够）。
						// 行内覆盖 marginBottom（决策行高紧凑）、flex 独占一行与 reason 同格折行。
						// rawOutput（2000 字符原始 JSON）会撑爆面板、fallbackReason 已由 note 承载，
						// 两者都不在这里画。
						d.modelReason ? React.createElement('div', { className: 'pg-model-reason', style: { marginBottom: 0, flex: '1 1 100%' } }, T('app.modelReasonPrefix') + d.modelReason) : null,
					))) : React.createElement('div', { style: { fontSize: 12, color: 'rgba(128,128,128,0.8)' } }, T('panel.noDecisions')),
					// 失败提示：只在 { error } 态出现（'loading' 是字符串、没有 .error，天然不命中）。
					// 与 expandedList 的判据一致 —— 该态**不算展开**，故按钮仍是可重试的「展开」。
					(decisionsExpanded && decisionsExpanded.error) ? React.createElement('div', { style: { fontSize: 12, color: '#c62828', marginTop: 6 } }, T('panel.decisionsFailed') + '：' + decisionsExpanded.error) : null,
				),
				// 闭合上面 `tab === 'auto' ? null : <Fragment>` 的 Fragment（global/project 的全部设置卡片）
				),
				// ── 状态提示：**在所有 tab 之外**（不在上面那个 Fragment 里）────────────
				// `notice` 与 `msg` 是「上一次操作的结果」，任何 tab 都要能看到 ——
				// 尤其 auto tab：那张卡片的每个控件都靠 setMsg 反馈「已保存」，
				// 若把它留在 Fragment 内，用户在 auto tab 里改设置会**看不到任何反馈**
				// （点了没反应 = 以为没生效，然后重复点）。
				notice ? React.createElement('div', { style: { fontSize: 12, color: '#bf8700', background: 'rgba(191,135,0,0.08)', border: '1px solid rgba(191,135,0,0.35)', borderRadius: 6, padding: '6px 8px', marginBottom: 8, lineHeight: 1.5 } }, '⚠ ' + notice) : null,
				msg ? React.createElement('div', { style: { fontSize: 12, color: '#1e88e5', marginBottom: 8 } }, msg) : null,
			);
		}

		// ═══════════════════════════════════════════════════════════════════════════
		// 会话流里的自动审批记录
		// ═══════════════════════════════════════════════════════════════════════════
		//
		// 宿主把每次 auto 决策写成一条 `plugin:permgate/decision` 会话记录（不进模型上下文，
		// 见 index.js 的 appendDecisionLog）。这里把它渲染成会话流里的一行。
		//
		// 为什么**四种 via 全都显示**（模型放行 / 模型拒绝 / 模型弃权 / 模型失败）：
		// 用户对「AI 自己决定放行了一个删除操作」是有知情权的 —— 那一行就是唯一的知情渠道
		// （审批弹窗根本不会出现）。只显示失败类会让「模型放行」变成一条**静默**路径。
		// 代价是行数会变多，故默认**折叠成一行灰字**，点开才看详情。
		//
		// 为什么不复用「最近决策」面板：那是全局的、按时间倒序、且只在设置页里；
		// 会话流里这一行要与**具体哪一步**对齐，才能回答「这次 AI 为什么这么干」。
		const DECISION_KIND = 'permgate-auto';
		// 轨迹页那一份必须用**不同的 kind**：`uc.events.register` 以 kind 为注册键，
		// 同名会直接抛「already registered」。两份 Definition 认领同一个事件是合法的
		// （match 不带 exclusive 时互不排斥），它们只是落到不同的 target。
		const DECISION_TRAJECTORY_KIND = 'permgate-auto-traj';
		const DECISION_RECORD = 'plugin:permgate/decision';
		// via → 展示档位。**颜色只表达结果方向，字重表达危险度**：
		//   · 放行（auto-allow）—— 橙：这是放宽，用户要知道，但不必当成错误；
		//   · 拒绝与异常（auto-deny / auto-escalate / auto-fallback）—— 红：三者的
		//     共同点是**自动审批没能给出可用结论**（模型否决 / 模型拿不准 / 模型没答
		//     上来），需要人接手或按回落值执行。与紧邻其上的工具报错同源，扫一眼就能
		//     认出这一行不是「模型判断通过」。拒绝尤其不能比报错更淡 —— 它同样让这次
		//     调用什么都没做成。
		//   · 明知高风险的三档在红的基础上加粗：模型与设置相互冲突的地方，也是事后
		//     复查策略的唯一线索，与普通结论同权重会被划过去。
		//
		// 红色取自主题变量而不是写死：该变量在深浅两套主题下取值不同
		//（`state-error-primary` 分别是 red-600 与 red-400），写死其中任一个都会让
		// 另一种主题下的错误色糊进背景。橙色没有这个问题 —— 它对应的变量在明暗下
		// 同值，换成变量既无收益、对比度还略低于这里的字面量。
		const VIA_ERR = 'var(--dsw-alias-state-error-primary, #c62828)';
		function viaMeta(via) {
			if (via === 'auto-allow-high') return { k: 'allowHigh', color: VIA_ERR, weight: 600, key: 'flow.viaAllowHigh' };
			if (via === 'auto-deny-high') return { k: 'denyHigh', color: VIA_ERR, weight: 600, key: 'flow.viaDenyHigh' };
			if (via === 'auto-ask-high') return { k: 'askHigh', color: VIA_ERR, weight: 600, key: 'flow.viaAskHigh' };
			if (via === 'auto-allow') return { k: 'allow', color: '#bf8700', weight: 400, key: 'flow.viaAllow' };
			if (via === 'auto-deny') return { k: 'deny', color: VIA_ERR, weight: 400, key: 'flow.viaDeny' };
			if (via === 'auto-escalate') return { k: 'escalate', color: VIA_ERR, weight: 400, key: 'flow.viaEscalate' };
			return { k: 'fallback', color: VIA_ERR, weight: 400, key: 'flow.viaFallback' };
		}
		// 折叠态一句话讲清「谁、对什么、做了什么」。
		// chat 行与轨迹行共用这一份：同一件事在两个视图里措辞不一致，排查时就得先
		// 判断「是两回事还是同一个记录」，而它们本来就是同一条记录。
		function decisionFlowHead(d) {
			const meta = viaMeta(d.via);
			return T(meta.key)
				.replace('{tool}', String(d.tool || '?'))
				.replace('{action}', T('flow.action.' + String(d.action || 'ask')))
				.replace('{direct}', d.direct === true ? T('flow.directTag') : '');
		}
		function DecisionFlowRow(props) {
			const node = (props && props.node) || {};
			const d = node.data || {};
			const meta = viaMeta(d.via);
			const [open, setOpen] = React.useState(false);
			const head = decisionFlowHead(d);
			return React.createElement('div', { style: { fontSize: 12, lineHeight: 1.6, margin: '2px 0' } },
				React.createElement('div', {
					style: { display: 'flex', alignItems: 'baseline', gap: 6, cursor: 'pointer', color: meta.color },
					onClick: () => setOpen(!open),
				},
					React.createElement('span', { style: { flex: '0 0 auto', opacity: 0.7 } }, open ? '▾' : '▸'),
					// 字重来自 `viaMeta`：高风险三档加粗。颜色已经表达「放行/否决」，
					// 危险度只能靠字重 —— 再靠色阶分档时，浅色底上分得出的两个红
					// 在深色底上会一起糊成背景色。
					React.createElement('span', { style: { fontWeight: meta.weight } }, head),
					d.model ? React.createElement('span', { style: { color: 'rgba(128,128,128,0.85)', fontSize: 11 } }, d.model) : null,
					// 实际派发的档位（模型自己的 id，如 low/high/max），样式与模型名同档。
					// 只在实际派发过时显示：没派发是**异常**（降级或失败），
					// 那种情况下展开态会说明原因，折叠态留空比画一个空的档位更好。
					d.effort ? React.createElement('span', { style: { color: 'rgba(128,128,128,0.85)', fontSize: 11 } }, String(d.effort)) : null,
				),
				open ? React.createElement('div', {
					style: { marginLeft: 16, marginTop: 4, padding: '6px 8px', borderRadius: 6, background: 'rgba(128,128,128,0.08)', border: '1px solid rgba(128,128,128,0.2)', color: 'rgba(128,128,128,0.95)' },
				},
					d.fallbackReason ? React.createElement('div', null, T('flow.why') + d.fallbackReason) : null,
					d.modelReason ? React.createElement('div', null, T('flow.modelReason') + d.modelReason) : null,
					d.risk ? React.createElement('div', null, T('flow.risk') + riskLabel(d.risk)) : null,
					// 推理强度：与「模型判定风险」并列，回答「这次评审用哪个档位想」。
					// 为空时整行不渲染（旧记录没有这两个字段，不能显示空行）。
					effortFlowLabel(d) ? React.createElement('div', null, T('flow.effort') + effortFlowLabel(d)) : null,
					d.ruleId ? React.createElement('div', null, T('flow.rule') + d.ruleId) : null,
					d.rawOutput ? React.createElement('pre', { style: { whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 11, margin: '4px 0 0', opacity: 0.85 } }, d.rawOutput) : null,
				) : null,
			);
		}
		// 注册 Definition + 渲染器。任何一个环节不可用都**静默跳过**（只是不显示，不影响审批）。
		function pgRegisterDecisionFlow(ctx) {
			try {
				const uc = ctx && typeof ctx.get === 'function' ? ctx.get('uiConversation') : null;
				const slots = ctx && ctx.slots;
				if (!uc || !uc.events || typeof uc.events.register !== 'function') return;
				if (!slots || typeof slots.inject !== 'function') return;
				// ① Definition：认领记录事件。
				//    `match` 只认这一个类型；`id` 用 seq —— 每条记录是独立的一行（不聚合），
				//    因为「哪一步被自动放行」必须与步骤对齐，聚合就丢了这层信息。
				//
				//    `target: 'chat'` 是 Chat 视图的 target 名（见 chatNode 的 target 字段）。
				//    `start` 保存原始 data；没有 `update`（记录是 append-only，不会被改写）。
				uc.events.register({
					kind: DECISION_KIND,
					target: 'chat',
					match: (event) => {
						if (!event || event.type !== DECISION_RECORD) return null;
						return { id: String(event.seq), role: 'start' };
					},
					start: (_context, match) => ({ data: (match && match.event && match.event.data) || {} }),
					buildViewNode: (context) => {
						const st = context.state;
						if (!st || !st.data) return null;
						const start = context.start;
						const anchorSeq = start && start.event ? start.event.seq : 0;
						return {
							key: context.key,
							kind: DECISION_KIND,
							id: context.id,
							target: 'chat',
							anchorSeq,
							// location 必须给：Chat 用它决定这一行落在哪个 turn/step 里。
							// 取 start 的 location（记录是在 pre-execute 里写的，落在当前 step 内）。
							location: (start && start.location) || { kind: 'unresolved' },
							visibility: 'visible',
							data: st.data,
						};
					},
				});
				// ② 渲染器：keyed slot，key 必须与上面 buildViewNode 的 kind 完全一致。
				slots.inject('conversation.chat.node', () => slots.register(
					{ name: 'conversation.chat.node', key: DECISION_KIND },
					DecisionFlowRow,
				));
				// ③ 轨迹页：同一批记录在 `trajectory` target 上再认领一次。
				//
				// 为什么必须单独注册而不是「平台会自动兜底」：Definition 的 `target` 决定它
				// 进哪张 Context 表（`contextsByTarget`），`buildNode` 第一行就按 target 过滤，
				// 两个视图互相看不见。`ignorable` 记录又不在 session 的 surface 白名单
				// （SURFACE_EVENT_TYPES）里，没有任何通用渲染器接住它 —— 会话流里能看到，
				// 纯粹是因为上面 ① 自己认领了。
				//
				// 轨迹页唯一的 fallback 也指望不上：`dsh-client-ui-chat` 已经用
				// `registerFallback` 占了那一个名额（target 还是 chat），而且 fallback 只在
				// 「没有任何 Definition 匹配」时才触发，① 已经匹配上了，轮不到它。
				registerDecisionTrajectory(uc);
			} catch (e) {
				// 注册失败不影响审批：这一行只是展示。
				try { console.warn('[permgate] decision flow registration failed:', e && e.message ? e.message : e) } catch (e2) {}
			}
		}
		// 轨迹页那一份 Definition。与 chat 的差别只在 target 和节点形状：
		// 轨迹的 Builder 只认它自己那套 `data.kind`（`context` / `node` / `tool` / …），
		// 把决策记录投影成 `context` 节点 —— 它会落在「输入」泳道（laneFor 把 context 归 0），
		// 按 `location` 对齐到发生决策的那个 step，与它要回答的「这一步为什么被自动放行」一致。
		//
		// 为什么用 `context` 而不是造一个新 kind：轨迹页没有 per-row 的 slot 扩展点
		// （`conversation.trajectory.images` 只给图片用），新增 kind 没有任何渲染器会认，
		// 结果是这一行**静默消失**且无报错。复用 `context` 至少能保证它可见、可搜、可展开。
		//
		// 代价是它会被当成「上下文」类记录：标签显示「上下文」、详情走 markdown 渲染。
		// 后者通过把正文包进代码块规避（模型原始输出里的 `*`/`#`/反引号不该被解析）。
		function registerDecisionTrajectory(uc) {
			if (typeof uc.events.register !== 'function') return;
			uc.events.register({
				kind: DECISION_TRAJECTORY_KIND,
				target: 'trajectory',
				match: (event) => {
					if (!event || event.type !== DECISION_RECORD) return null;
					return { id: String(event.seq), role: 'start' };
				},
				start: (_context, match) => {
					const ev = match && match.event;
					const d = (ev && ev.data) || {};
					return {
						// `kind: 'context'` 是**轨迹布局的分派键**，不是描述：layout() 里
						// `node.kind === 'context'` 那一支才把它放进输入泳道，其余分支都不匹配
						// 时节点会被静默丢弃（无报错、无日志）。缺这个字段整行就消失了。
						kind: 'context',
						seq: ev ? ev.seq : 0,
						time: ev ? ev.time : 0,
						// `source` 决定 producer 标签（contextProducer 按 kind 分支）。
						// 这里给一个自造 kind：落到 default 分支显示该 kind 原文，
						// 比冒充 `agent-instructions`（会显示成指令变更）诚实。
						source: { kind: 'permgate-auto' },
						// `form` 必须在 KNOWN_FORMS 里才会被 contextForm 采纳；`notice` 是
						// 「宿主告知」那一档，与这条记录的性质相符。不在白名单时返回 null，
						// 渲染退化成不透明的 JSON 折叠块 —— 那等于没显示。
						form: 'notice',
						content: decisionTrajectoryBlocks(d),
						data: d,
					};
				},
				update: (context) => context.state,
				buildViewNode: (context) => {
					const st = context.state;
					if (!st) return null;
					return {
						key: context.key,
						kind: DECISION_TRAJECTORY_KIND,
						id: context.id,
						target: 'trajectory',
						anchorSeq: st.seq,
						location: (context.start && context.start.location) || { kind: 'unresolved' },
						data: { kind: 'node', node: st },
					};
				},
			});
		}
		// 轨迹行的正文：拆成**两个 block** —— 首行一句话 + 明细。
		//
		// 为什么拆开：轨迹的折叠态只取第一个 text block（previewContent 取首段），
		// 合成一段的话折叠行会把整份明细都摊出来，一屏就被审批记录占满。
		// 拆开后折叠态只显示那句话，展开才看得到明细，与 chat 行的交互一致。
		//
		// 模型可控的文本（modelReason / rawOutput）一律进围栏：`isMarkdownRecord` 把
		// context 判为 markdown 记录，详情面板会按 markdown 渲染 inputDetail，模型输出里
		// 的 `#`/`*`/反引号不围起来就会把这条记录显示成格式错乱的正文。
		// 宿主生成的那几行（model / ruleId / risk / fallbackReason）保持纯文本 ——
		// 它们不含 markdown，包进代码块只会让中文按代码字体渲染，更难读。
		function decisionTrajectoryBlocks(d) {
			const head = { type: 'text', text: decisionFlowHead(d) }
			const meta = []
			if (d.model) meta.push(String(d.model))
			if (d.ruleId) meta.push(T('flow.rule') + d.ruleId)
			if (d.risk) meta.push(T('flow.risk') + riskLabel(d.risk))
			// 与 chat 视图同一句（见 effortFlowLabel）：同一条记录在两个视图里
			// 措辞不一致，排查时就得先判断「是两回事还是同一个记录」。
			if (effortFlowLabel(d)) meta.push(T('flow.effort') + effortFlowLabel(d))
			if (d.fallbackReason) meta.push(T('flow.why') + d.fallbackReason)
			const fenced = []
			if (d.modelReason) fenced.push(T('flow.modelReason') + d.modelReason)
			if (d.rawOutput) fenced.push(T('flow.raw') + String(d.rawOutput))
			const detail = []
			if (meta.length > 0) detail.push(meta.join('\n'))
			if (fenced.length > 0) detail.push(fenceCode(fenced.join('\n')))
			if (detail.length === 0) return [head]
			return [head, { type: 'text', text: detail.join('\n\n') }]
		}
		// 围栏长度必须**超过内容里最长的一段反引号**：固定写三个反引号时，
		// 模型输出里自带一行 ``` 就会提前闭合代码块，后半段重新变成 markdown。
		// CommonMark 的规则是「至少 3 个、且多于内容中最长的反引号串」，照此实现。
		function fenceCode(text) {
			let longest = 0
			const runs = String(text).match(/`+/g)
			if (runs) for (const run of runs) if (run.length > longest) longest = run.length
			const mark = '`'.repeat(Math.max(3, longest + 1))
			return mark + '\n' + text + '\n' + mark
		}

		function apply(ctx) {
			LC = ctx;
			// 中英文适配：注册 permgate 字典并绑定翻译函数（t 调用时读取当前语言）。
			// register 与 bind 分开容错：register 失败（如重复激活）时 bind 仍要生效，
			// 否则 T 会退化为纯中文回退函数，整个插件界面卡在中文。
			try {
				if (ctx.locale && typeof ctx.locale.register === 'function') {
					ctx.locale.register('permgate', { zh: I18N.zh, en: I18N.en });
				}
			} catch (e) {}
			try {
				if (ctx.locale && typeof ctx.locale.bind === 'function') {
					T = ctx.locale.bind('permgate');
				}
			} catch (e) {}
			// ── 样式注入：**存在就更新，不存在才新建** ─────────────────────────────────
			// 只在「没有标签」时写入的话，插件热重载（HMR）时旧的 <style> 还在，新增/修改过的
			// CSS 永远进不了 DOM，表现为「改了 CSS 却毫无变化」。故无论标签在不在都重写
			// textContent：HMR 后新 CSS 立刻生效，且不会叠加出多个 <style>。
			//
			// 抽成一个局部函数给三份样式表共用：逻辑完全一样，抄三遍迟早会漏改一处。
			const injectCss = (pluginCss, text) => {
				if (typeof document === 'undefined') return;
				let tag = document.querySelector('style[data-plugin-css="' + pluginCss + '"]');
				if (tag === null) {
					tag = document.createElement('style');
					tag.dataset.plugin = 'dsh-permgate';
					tag.dataset.pluginCss = pluginCss;
					document.head.appendChild(tag);
					ctx.effect(() => () => { try { tag.remove(); } catch (e) {} });
				}
				tag.textContent = text;
			};
			injectCss('dsh-permgate', CSS + RADIO_DISABLED_CSS + PG_CARD_CSS + PG_SORT_CSS + PG_BLAST_CSS + PG_TIER_CSS + PG_EXC_CSS + PG_HOVER_CSS);
			// 另外两份样式表同理（存在就更新，理由见上）。
			injectCss('dsh-permgate-diff', DIFF_CSS);
			injectCss('dsh-permgate-diff2', DIFF2_CSS);
			// 权限选择器兼容层：图标徽标为纯 CSS（按 aria-label 选择器，零 JS 依赖，
			// 跟随语言自动显示）；预设名文本交换由 MutationObserver 驱动（childList +
			// characterData + attributes 全覆盖）+ locale 订阅，无定时器。安装仅在
			// documentElement 就绪时进行，最多重试 10 次后放弃（有界，非常驻定时器）。
			ctx.effect(() => {
				let install = null;
				let tries = 0;
				let tid = null;
				const attempt = () => {
					if (install) return;
					if (typeof document !== 'undefined' && document.documentElement) {
						try { install = pgInstallCompat(); } catch (e) {}
						return;
					}
					tries += 1;
					if (tries < 10) {
						try { tid = setTimeout(attempt, 500); } catch (e) {}
					}
				};
				attempt();
				return () => {
					if (tid !== null) { try { clearTimeout(tid); } catch (e) {} }
					if (install) { try { install(); } catch (e) {} }
				};
			}, 'permgate: permission selector compat');
			const slots = ctx.slots;
			// 注意：槽注册必须直接传组件（不能包一层 () => createElement(X, null) 工厂 —
			// 那样会丢弃槽系统注入的 props，组件就拿不到 sessionId，状态无法按会话区分）
			slots.inject('settings.section', () => slots.register(
				// label 用 thunk：每次投影时重新求值，跟随当前语言（locale.bind 读取活动语言）
				{ name: 'settings.section', id: 'permgate', order: 30, label: () => T('settings.title') },
				Panel,
			));
			// 导航图标：DSH 0.2.2 起平台开了 `settings.section.icon` 槽（list 型，按 id 匹配
			// 到对应的 section；未注册时平台回落到它自己的齿轮）。
			//
			// `slots.inject(key, cb)` 的语义是「槽声明后才执行 cb」，槽不存在时**静默等待**
			// 而非抛错 —— 所以旧版平台上 cb 永不执行，pgNavIconViaSlot 保持 false，
			// 下面的 DOM 兼容层照常接管。新版上 cb 执行，兼容层随即停手。
			//
			// 两者并存不是冗余：兼容层靠 MutationObserver 认文本、打标记、CSS 换图标，
			// 在 0.2.2 上虽然也能工作，但依赖 `[role="dialog"] nav button` 这种结构选择器，
			// 平台一改版就静默失效。槽位是稳定契约，能走就走。
			try {
				slots.inject('settings.section.icon', () => {
					// 回调被调用 === 槽位存在。在这里置位，让 DOM 兼容层从下一次扫描起停手；
					// 扫描是 MutationObserver + rAF 驱动的，置位后最多晚一帧就清干净。
					pgNavIconViaSlot = true;
					try { if (typeof pgRescan === 'function') pgRescan(); } catch (e) {}
					return slots.register(
						{ name: 'settings.section.icon', id: 'permgate' },
						PG_NAV_SVG,
					);
				});
			} catch (e) {
				// register 失败（例如 id 冲突）只丢图标，不影响设置页本身。
			}
			// conversation.composer.dock 不再注册：那里的分类徽标（DockBar）已删除，
			// 理由见其原位置留下的注释（DSH 0.1.7 起该槽位与原生 ContextMeter 同处一个
			// 横向 flex 行，徽标无法独占一行；且徽标只是只读展示，删除不损失功能）。
			slots.inject('shell.overlay', () => slots.register(
				{ name: 'shell.overlay', id: 'permgate-approval', order: 100 },
				OverlayRoot,
			));
			// ── 会话流里的自动审批记录（plugin:permgate/decision）────────────────────
			// 这条链路分两半，缺一不可：
			//   ① `uiConversation.events.register` 注册一个 Definition，认领 `plugin:permgate/decision`
			//      事件并产出 `kind: 'permgate-auto'` 的 chat 节点；
			//   ② 在 `conversation.chat.node` 这个 keyed slot 上注册同名 key 的渲染器。
			// 只做 ② 不会有任何东西被渲染（节点根本不存在），只做 ① 会落到 Chat 的
			// `unknown` fallback（一个 JSON 折叠块）—— 两者都必须做。
			//
			// 为什么用 `ctx.inject` 而不是 apply 期一次性 `ctx.get('uiConversation')`：
			// 它是**可选**能力 —— 没有它时自动审批照常工作，只是会话流里不显示这一行，
			// 故不能写进插件级 `inject`（那会让整个 UI 半边等这个服务出现，与本插件既有的
			// 「可选依赖 + 能力探测」纪律冲突）。但「一次性探测」也不行：本插件的依赖集
			// （slots + locale）是 ui-conversation 依赖集的**子集**，fiber 天然更早激活，
			// 于是 apply 期 `ctx.get` 常常拿到 undefined，早退之后即使服务就绪也再无第二次
			// 机会 —— 这条记录一条都不会出现在会话流里，且没有任何日志，与「压根没有 auto
			// 决策」外部完全同形。`ctx.inject` 起的子 fiber 等到服务出现才执行，不阻塞主
			// apply，服务消失时随子 fiber 一并清理。
			if (ctx && typeof ctx.inject === 'function') ctx.inject(['uiConversation'], (c) => pgRegisterDecisionFlow(c));
		}

		exports.apply = apply;
		exports.inject = ['slots', 'locale'];
		return module.exports;
	}
});
