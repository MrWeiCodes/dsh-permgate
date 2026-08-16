window.__ModuleLoader__.load({
	id: "dsh-permgate",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let React = require("react");

		const CSS = ".pg-modal { position: fixed; top: 16px; right: 16px; z-index: 9999; width: 420px; max-width: 92vw; max-height: 82vh; overflow-y: auto; background: var(--dsw-alias-bg-overlay, #ffffff); color: var(--dsw-alias-label-primary, #24292f); border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.4)); border-radius: 10px; box-shadow: 0 10px 36px rgba(0,0,0,0.32); padding: 14px 16px; font-family: system-ui, -apple-system, \"Segoe UI\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif; } .pg-modal-title { font-size: 14px; font-weight: 600; margin-bottom: 6px; } .pg-modal-req { font-size: 12px; margin-bottom: 4px; } .pg-modal-body { font-size: 12px; color: var(--dsw-alias-label-secondary, #57606a); margin-bottom: 8px; } .pg-intent { font-size: 12px; background: var(--dsw-alias-bg-layer-1, #f6f8fa); border: 1px solid var(--dsw-alias-border-l1, #d0d7de); border-left: 3px solid var(--dsw-alias-brand-primary, #1f6feb); border-radius: 6px; padding: 6px 8px; color: var(--dsw-alias-label-secondary, #57606a); margin-bottom: 6px; line-height: 1.5; word-break: break-word; } .pg-intent-tag { display: inline-block; font-weight: 700; color: var(--dsw-alias-brand-primary, #1f6feb); margin-right: 6px; font-size: 11px; } .pg-args { font-size: 11px; background: var(--dsw-alias-bg-layer-1, #f6f8fa); border: 1px solid var(--dsw-alias-border-l1, #d0d7de); border-left: 3px solid rgba(128,128,128,0.65); border-radius: 6px; padding: 5px 8px; color: var(--dsw-alias-label-secondary, #57606a); margin-bottom: 8px; line-height: 1.5; word-break: break-all; font-family: ui-monospace, Consolas, monospace; } .pg-args-tag { display: inline-block; font-weight: 700; color: rgba(128,128,128,0.95); margin-right: 6px; font-size: 11px; font-family: system-ui, -apple-system, \"Segoe UI\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif; } .pg-args-row { display: flex; gap: 6px; padding: 1px 0; } .pg-args-label { font-weight: 600; flex: 0 0 auto; } .pg-args-val { word-break: break-all; flex: 1; } .pg-cand-head { font-size: 12px; font-weight: 600; margin: 6px 0 4px; } .pg-cand-hint { font-size: 11px; color: var(--dsw-alias-label-secondary, #8c959f); margin-bottom: 4px; } .pg-cand { display: flex; align-items: center; gap: 6px; padding: 4px 0; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.2)); } .pg-cand-label { flex: 1; font-family: ui-monospace, Consolas, monospace; font-size: 11px; word-break: break-all; } .pg-radio { display: inline-flex; align-items: center; gap: 3px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.4)); background: transparent; color: var(--dsw-alias-label-secondary, #57606a); font-size: 11px; font-family: inherit; cursor: pointer; transition: all 0.15s ease; } .pg-radio:hover { border-color: var(--dsw-alias-brand-primary, #1f6feb); } .pg-radio-allow { border-color: var(--dsw-alias-state-success-primary, #1a7f37); color: var(--dsw-alias-state-success-primary, #1a7f37); background: rgba(26, 127, 55, 0.12); font-weight: 600; } .pg-radio-deny { border-color: var(--dsw-alias-state-error-primary, #cf222e); color: var(--dsw-alias-state-error-primary, #cf222e); background: rgba(207, 34, 46, 0.12); font-weight: 600; } .pg-footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; } .pg-action { display: inline-flex; align-items: center; padding: 5px 16px; border-radius: 6px; border: 1px solid; font-size: 12px; font-family: inherit; font-weight: 600; cursor: pointer; transition: filter 0.15s ease, box-shadow 0.15s ease, transform 0.05s ease; } .pg-action:hover { filter: brightness(1.07); box-shadow: 0 2px 8px rgba(0,0,0,0.18); } .pg-action:active { transform: translateY(1px); box-shadow: none; } .pg-action:disabled { opacity: 0.5; cursor: not-allowed; filter: none; box-shadow: none; } .pg-action-allow { border-color: rgba(26, 127, 55, 0.45); color: #1a7f37; background: rgba(26, 127, 55, 0.12); } @supports (color: color-mix(in srgb, red 10%, blue)) { .pg-action-allow { border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary, #1a7f37) 45%, transparent); color: var(--dsw-alias-state-success-primary, #1a7f37); background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #1a7f37) 12%, transparent); } } .pg-action-deny { border-color: rgba(207, 34, 46, 0.45); color: #cf222e; background: rgba(207, 34, 46, 0.12); } @supports (color: color-mix(in srgb, red 10%, blue)) { .pg-action-deny { border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #cf222e) 45%, transparent); color: var(--dsw-alias-state-error-primary, #cf222e); background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #cf222e) 12%, transparent); } } .pg-btn { padding: 4px 10px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.4)); background: transparent; color: var(--dsw-alias-label-primary, #24292f); cursor: pointer; font-size: 13px; font-family: inherit; transition: border-color 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease, transform 0.05s ease; } .pg-btn:hover { border-color: var(--dsw-alias-brand-primary, #1f6feb); background: rgba(31, 111, 235, 0.08); } .pg-btn:active { transform: translateY(1px); } .pg-btn:disabled { opacity: 0.5; cursor: not-allowed; } .pg-btn-danger:hover { border-color: var(--dsw-alias-state-error-primary, #cf222e); color: var(--dsw-alias-state-error-primary, #cf222e); background: rgba(207, 34, 46, 0.08); } .pg-btn-on { border-color: var(--dsw-alias-state-success-primary, #1a7f37); color: var(--dsw-alias-state-success-primary, #1a7f37); background: rgba(26, 127, 55, 0.12); font-weight: 600; } .pg-btn-on:hover { border-color: var(--dsw-alias-state-success-primary, #1a7f37); color: var(--dsw-alias-state-success-primary, #1a7f37); background: rgba(26, 127, 55, 0.2); } .pg-btn-off { border-color: var(--dsw-alias-state-error-primary, #cf222e); color: var(--dsw-alias-state-error-primary, #cf222e); background: rgba(207, 34, 46, 0.1); font-weight: 600; } .pg-btn-off:hover { border-color: var(--dsw-alias-state-error-primary, #cf222e); color: var(--dsw-alias-state-error-primary, #cf222e); background: rgba(207, 34, 46, 0.16); } .pg-btn-confirm { border-color: var(--dsw-alias-state-error-primary, #cf222e); color: #ffffff; background: var(--dsw-alias-state-error-primary, #cf222e); } .pg-btn-confirm:hover { border-color: var(--dsw-alias-state-error-primary, #cf222e); color: #ffffff; background: var(--dsw-alias-state-error-primary, #cf222e); filter: brightness(1.12); } .pg-field { padding: 4px 8px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.4)); background: var(--dsw-alias-bg-layer-1, #f6f8fa); color: var(--dsw-alias-label-primary, #24292f); color-scheme: light dark; font-size: 13px; font-family: inherit; transition: border-color 0.15s ease, box-shadow 0.15s ease; } .pg-field:hover { border-color: var(--dsw-alias-brand-primary, #1f6feb); } .pg-field:focus { outline: none; border-color: var(--dsw-alias-brand-primary, #1f6feb); box-shadow: 0 0 0 2px rgba(31, 111, 235, 0.22); } .pg-field:disabled { opacity: 0.5; cursor: not-allowed; } .pg-field option { color: var(--dsw-alias-label-primary, #24292f); background: var(--dsw-alias-bg-overlay, #ffffff); } .pg-tab { padding: 6px 16px; border-radius: 6px 6px 0 0; border: none; border-bottom: 2px solid transparent; background: transparent; color: var(--dsw-alias-label-primary, #24292f); cursor: pointer; font-size: 13px; font-family: inherit; margin-right: 4px; transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease; } .pg-tab:hover { background: rgba(128, 128, 128, 0.12); } .pg-tab-on { border-bottom-color: var(--dsw-alias-brand-primary, #1f6feb); color: var(--dsw-alias-brand-primary, #1f6feb); font-weight: 600; }";

		const DIFF_CSS = '.pg-link { display: inline-flex; align-items: center; gap: 4px; background: var(--dsw-alias-bg-layer-1, #f0f2f5); color: var(--dsw-alias-label-primary, #24292f); border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.45)); border-radius: 6px; padding: 3px 12px; cursor: pointer; font-size: 12px; font-weight: 500; margin-bottom: 6px; } .pg-link:hover { border-color: #1f6feb; color: #1f6feb; } .pg-diff { margin-top: 6px; margin-bottom: 8px; border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.3)); border-radius: 6px; overflow: hidden; background: var(--dsw-alias-bg-layer-1, rgba(0,0,0,0.03)); } .pg-diff-file { padding: 5px 8px; font-family: ui-monospace, Consolas, monospace; font-size: 11px; color: rgba(128,128,128,0.95); border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.2)); word-break: break-all; } .pg-diff-body { margin: 0; padding: 6px 8px; max-height: 240px; overflow: auto; font-family: ui-monospace, Consolas, monospace; font-size: 11px; line-height: 1.55; white-space: pre-wrap; word-break: break-all; } .pg-diff-add { color: #2e7d32; } .pg-diff-del { color: #c62828; } .pg-diff-ctx { color: rgba(128,128,128,0.7); } .pg-diff-more { color: rgba(128,128,128,0.6); font-style: italic; } .pg-diff-foot { padding: 4px 8px; border-top: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.2)); font-family: ui-monospace, Consolas, monospace; font-size: 11px; color: rgba(128,128,128,0.8); }';

		const ROUTES = {
			'permgate:status': ['GET', '/permgate/status'],
			'permgate:pending': ['GET', '/permgate/pending'],
			'permgate:decide': ['POST', '/permgate/decide'],
			'permgate:set-sandbox': ['POST', '/permgate/set-sandbox'],
			'permgate:set-categories': ['POST', '/permgate/set-categories'],
			'permgate:set-category': ['POST', '/permgate/set-category'],
			'permgate:set-quick': ['POST', '/permgate/set-quick'],
			'permgate:add-exception': ['POST', '/permgate/add-exception'],
			'permgate:remove-exception': ['POST', '/permgate/remove-exception'],
			'permgate:add-rule': ['POST', '/permgate/add-rule'],
			'permgate:remove-rule': ['POST', '/permgate/remove-rule'],
			'permgate:reload': ['POST', '/permgate/reload'],
			'permgate:open-config': ['POST', '/permgate/open-config'],
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
			return fetch(path, opts).then((r) => r.json());
		}

		// SSE 事件订阅：/permgate/events 长连接推送（状态/待审批变化即时刷新，替代轮询）
		let eventSource = null;
		const eventListeners = new Set();
		function notifyEvents(data) {
			for (const fn of Array.from(eventListeners)) { try { fn(data); } catch (e) {} }
		}
		function ensureEventSource() {
			if (eventSource) return;
			eventSource = new EventSource('/permgate/events');
			eventSource.onmessage = (ev) => {
				let data = null;
				try { data = JSON.parse(ev.data); } catch (e) {}
				if (data) notifyEvents(data);
			};
			// 首连与断线重连成功都会触发：全量刷新兜底，收敛重连期间丢失的事件
			eventSource.onopen = () => notifyEvents({ type: 'refresh' });
			eventSource.onerror = () => { /* EventSource 自动重连 */ };
		}
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
		const PG_PERMISSION_LABELS = new Set(['Read Only', 'Workspace Write', '自定义审查', 'Custom Review', 'Full access']);
		const PG_TRIGGER_PREFIXES = ['访问模式，当前：', 'Access mode, current: '];
		const PG_TRIGGER_SELECTOR = ['button[aria-label^="访问模式，当前："]', 'button[aria-label^="Access mode, current: "]'].join(',');
		const PG_MASK = 'url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22 fill=%22none%22%3E%3Cpath d=%22M8.20554%200.899994L14.7901%203.36857V7.01026C14.7901%2012%2011.0466%2014.2103%208.20554%2015.3C5.36446%2014.2103%201.62012%2012%201.62012%207.01026V3.36857L8.20554%200.899994Z%22 stroke=%22black%22 stroke-width=%221.31831%22 stroke-linejoin=%22round%22/%3E%3Ccircle cx=%227%22 cy=%227%22 r=%222.9%22 stroke=%22black%22 stroke-width=%221.2%22/%3E%3Cpath d=%22M9.2%209.2L11.6%2011.6%22 stroke=%22black%22 stroke-width=%221.4%22 stroke-linecap=%22round%22/%3E%3C/svg%3E")';
		const PG_CSS = '\n' +
			// 触发器徽标：纯 CSS 按 aria-label 选择（平台 t() 本地化前缀 + 两种语言的
			// 预设名，四个变体全覆盖）。无需 JS 打标，跟随语言/预设自动显示，重渲染不丢失。
			'button[aria-label^="访问模式，当前：自定义审查"]::before,' +
			'button[aria-label^="Access mode, current: 自定义审查"]::before,' +
			'button[aria-label^="访问模式，当前：Custom Review"]::before,' +
			'button[aria-label^="Access mode, current: Custom Review"]::before' +
			' { content: ""; display: inline-block; flex: 0 0 auto; width: 14px; height: 14px; margin-right: 4px; background-color: currentColor; -webkit-mask: ' + PG_MASK + ' center / contain no-repeat; mask: ' + PG_MASK + ' center / contain no-repeat; }\n';
		const pgNoop = () => {};
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
		function pgScanText(document) {
			try {
				const lang = pgActiveLang();
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
					// 不产生 childList 记录 —— en 下必须监听它才能把被改回的中文换回来
					if (record.type === 'characterData') {
						if (pgActiveLang() === 'en') return true;
						continue;
					}
					if (record.type !== 'childList') continue;
					// en 语言下需要全局扫描（设置页行、弹层菜单等不位于 composer seat）
					if (pgActiveLang() === 'en') return true;
					if (pgInsideComposer(record.target)) return true;
					for (const node of record.addedNodes || []) { if (pgTouchesSurface(node)) return true; }
					for (const node of record.removedNodes || []) { if (pgTouchesSurface(node)) return true; }
				}
			} catch (e) {}
			return false;
		}
		function pgCustomItem(menu) {
			try {
				const labels = new Set();
				let custom = undefined;
				for (const item of Array.from(menu.querySelectorAll('button[role="menuitem"]'))) {
					const label = item.textContent ? item.textContent.trim() : '';
					if (!label || labels.has(label)) continue;
					labels.add(label);
					if (label === PG_CUSTOM_LABEL || label === PG_NAME_EN) custom = item;
				}
				if (!custom) return undefined;
				let hits = 0;
				for (const want of PG_PERMISSION_LABELS) {
					if (labels.has(want)) hits++;
				}
				// 至少命中 3 项预设标签才认定是权限菜单（宽容标签变体；其他菜单
				// 不可能同时含有自定义审查/多项预设名，误伤概率为零）
				return hits >= 3 ? custom : undefined;
			} catch (e) { return undefined; }
		}
		// ── 菜单项徽标：向 label span 注入内联样式图标元素。不依赖平台按钮布局
		//    （::before 在 flex/grid 布局下可能不可见），inline-block 与文本同行；
		//    React 不管理未知子元素，重渲染/切语言不丢失，卸载时统一清理。──
		const pgMenuIcons = new Set();
		const PG_MENU_ICON_ATTR = 'data-pg-menu-icon';
		function pgEnsureMenuIcon(document, item) {
			try {
				let label = null;
				for (const child of Array.from(item.children || [])) {
					if (child.tagName !== 'SPAN') continue;
					const t = (child.textContent || '').trim();
					if (t === PG_CUSTOM_LABEL || t === PG_NAME_EN || t.indexOf(PG_CUSTOM_LABEL) !== -1 || t.indexOf(PG_NAME_EN) !== -1) { label = child; break; }
				}
				if (!label || label.querySelector('[' + PG_MENU_ICON_ATTR + ']')) return;
				const icon = document.createElement('span');
				icon.setAttribute(PG_MENU_ICON_ATTR, '1');
				icon.setAttribute('aria-hidden', 'true');
				icon.style.cssText = 'display:inline-block;flex:none;width:14px;height:14px;margin-right:6px;vertical-align:-2px;background-color:currentColor;-webkit-mask:' + PG_MASK + ' center/contain no-repeat;mask:' + PG_MASK + ' center/contain no-repeat;';
				label.insertBefore(icon, label.firstChild);
				pgMenuIcons.add(icon);
			} catch (e) {}
		}
		function pgScanIcons(document) {
			try {
				// 菜单是 portal 渲染（不位于触发器旁边），全文档扫描所有 role=menu；
				// pgCustomItem 要求四项预设齐全才认，误伤其他菜单的概率为零
				for (const menu of Array.from(document.querySelectorAll('[role="menu"]'))) {
					const customItem = pgCustomItem(menu);
					if (customItem !== undefined) pgEnsureMenuIcon(document, customItem);
				}
			} catch (e) {}
		}
		function pgScanAll(document) {
			try { pgScanText(document); } catch (e) {}
			try { pgScanIcons(document); } catch (e) {}
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

		const CATS = ['directory', 'command', 'read', 'edit', 'subagent', 'doomloop'];
		const EXC_CATS = ['directory', 'command', 'read', 'edit'];
		// 例外列表超过该数量默认折叠（展开/折叠按钮在标题行右侧）
		const EXC_COLLAPSE_THRESHOLD = 6;
		const ALL_MODES = ['ask', 'allow', 'deny', 'inherit'];
		const MODES = ['ask', 'allow', 'deny'];
		const MODE_COLORS = { ask: '#e65100', allow: '#2e7d32', deny: '#c62828', inherit: '#888' };
		const QUICK_PRESET = ['web_search', 'skill', 'grep', 'glob', 'web_fetch'];

		// ── 中英文适配：字典 + locale 绑定（跟随 dsh 语言设置自动切换）──────────
		let LC = null; // apply 时注入的 ctx
		const I18N = {
			zh: {
				'app.title': '权限审批',
				'app.request': '{tool} 请求执行',
				'app.intent': '意图说明',
				'app.args': '参数',
				'app.cand.head': '添加项目规则（当前项目）',
				'app.cand.hint': '点亮条目后点击「允许 / 拒绝」，选中的条目自动加入当前项目例外，之后不再询问。',
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
				'app.diffFile': '文件',
				'dock.title': '● 权限网关',
				'settings.title': '权限网关',
				'dock.refresh': '刷新',
				'dock.loading': '加载中…',
				'cat.directory': '目录访问（工作区外）',
				'cat.command': '执行命令',
				'cat.read': '读取文件',
				'cat.edit': '编辑文件',
				'cat.subagent': '启动子代理',
				'cat.doomloop': '重复操作(Doom Loop)',
				'catS.directory': '目录',
				'catS.command': '命令',
				'catS.read': '读取',
				'catS.edit': '编辑',
				'catS.subagent': '子代理',
				'catS.doomloop': '循环',
				'mode.ask': '询问',
				'mode.allow': '允许',
				'mode.deny': '拒绝',
				'mode.inherit': '继承全局',
				'panel.status': '状态',
				'panel.sessionPerm': '当前会话权限',
				'panel.customReview': '自定义审查',
				'panel.none': '未选择',
				'panel.active': '权限网关审查生效中',
				'panel.inactive': '权限网关未生效：请在会话的权限选择中选择「自定义审查」',
				'panel.sandboxEff': '底层沙箱（生效）',
				'panel.sandboxDesc.ww': '（文件操作限制在工作区内）',
				'panel.sandboxDesc.fa': '（文件操作不受工作区限制）',
				'panel.effCats': '生效分类默认：',
				'panel.config': '配置文件：',
				'panel.project': '项目：',
				'panel.stats': '最近统计：拦截 {d} · 审批 {a}',
				'panel.loadErr': '加载错误：',
				'panel.saveErr': '保存错误：',
				'panel.tabGlobal': '全局',
				'panel.tabProject': '项目',
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
				'panel.quickHint': '适用于网页搜索、技能加载、grep/glob 等未归类的工具；改动即时生效。',
				'panel.quickAdd': '新增工具名（如 todo_write，支持通配）',
				'panel.quickAddBtn': '添加（默认允许）',
				'panel.rules': '自定义规则（通用匹配）',
				'panel.rulesHint': '优先级：自定义规则 > 分类例外 > 分类默认/快捷工具。',
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
				'panel.reload': '重新加载配置文件',
				'panel.openConfig': '打开',
				'panel.openConfigDone': '已用默认编辑器打开配置文件',
				'panel.saved': '已保存',
				'panel.savedToGlobal': '已保存到全局',
				'panel.savedToProject': '已保存到当前项目',
				'panel.all': '(全部)',
				'panel.sandboxSaved': '底层沙箱已保存（{t}）：{v}',
				'panel.needValue': '请先输入例外匹配',
				'panel.needTool': '请输入工具名',
				'panel.excCount': '例外（{n}）',
				'panel.excCmdHint': '：匹配命令子串/glob，优先于分类默认',
				'panel.excPathHint': '：路径 glob，优先于分类默认',
				'panel.excNone': '无例外',
				'panel.excExpand': '展开',
				'panel.excCollapse': '折叠',
				'panel.excListLink': '例外列表',
				'panel.excUnit': '条',
				'panel.excPh': '命令子串/glob',
				'panel.excPathPh': '路径 glob',
				'panel.addExc': '添加例外',
				'panel.confirmDel': '确认删除？',
				'panel.cancel': '取消',
				'panel.del': '删除',
				'panel.allow': '允许',
				'panel.deny': '拒绝',
			},
			en: {
				'app.title': 'Permission Review',
				'app.request': '{tool} requests to run',
				'app.intent': 'Intent',
				'app.args': 'Arguments',
				'app.cand.head': 'Add project rule (current project)',
				'app.cand.hint': 'Toggle items, then click Allow / Deny to add them to the current project exceptions permanently.',
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
				'app.diffFile': 'file',
				'dock.title': '● Permission Gate',
				'settings.title': 'Permissions',
				'dock.refresh': 'Refresh',
				'dock.loading': 'Loading…',
				'cat.directory': 'Directory access (outside workspace)',
				'cat.command': 'Run command',
				'cat.read': 'Read file',
				'cat.edit': 'Edit file',
				'cat.subagent': 'Spawn subagent',
				'cat.doomloop': 'Doom Loop',
				'catS.directory': 'Dir',
				'catS.command': 'Cmd',
				'catS.read': 'Read',
				'catS.edit': 'Edit',
				'catS.subagent': 'Sub',
				'catS.doomloop': 'Loop',
				'mode.ask': 'Ask',
				'mode.allow': 'Allow',
				'mode.deny': 'Deny',
				'mode.inherit': 'Inherit global',
				'panel.status': 'Status',
				'panel.sessionPerm': 'Current session permission',
				'panel.customReview': 'Custom Review',
				'panel.none': 'None',
				'panel.active': 'Permission gate is active',
				'panel.inactive': 'Permission gate inactive: select "Custom Review" in the session permission picker',
				'panel.sandboxEff': 'Sandbox (effective)',
				'panel.sandboxDesc.ww': '（file operations restricted to the workspace）',
				'panel.sandboxDesc.fa': '（file operations are not workspace-restricted）',
				'panel.effCats': 'Effective category defaults: ',
				'panel.config': 'Config: ',
				'panel.project': 'Project: ',
				'panel.stats': 'Recent: {d} denied · {a} asked',
				'panel.loadErr': 'Load error: ',
				'panel.saveErr': 'Save error: ',
				'panel.tabGlobal': 'Global',
				'panel.tabProject': 'Project',
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
				'panel.quickHint': 'For uncategorized tools like web search, skills, grep/glob; changes apply immediately.',
				'panel.quickAdd': 'New tool name (e.g. todo_write, wildcards allowed)',
				'panel.quickAddBtn': 'Add (allow by default)',
				'panel.rules': 'Custom rules (generic matching)',
				'panel.rulesHint': 'Priority: custom rules > category exceptions > category default / quick tools.',
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
				'panel.reload': 'Reload config file',
				'panel.openConfig': 'Open',
				'panel.openConfigDone': 'Opened with default editor',
				'panel.saved': 'Saved',
				'panel.sandboxSaved': 'Sandbox saved ({t}): {v}',
				'panel.needValue': 'Enter a match value first',
				'panel.needTool': 'Enter a tool name',
				'panel.excCount': 'Exceptions ({n})',
				'panel.excCmdHint': ': command substring/glob, overrides category default',
				'panel.excPathHint': ': path glob, overrides category default',
				'panel.excNone': 'No exceptions',
				'panel.excExpand': 'Expand',
				'panel.excCollapse': 'Collapse',
				'panel.excListLink': 'Exception list',
				'panel.excUnit': 'items',
				'panel.excPh': 'command substring/glob',
				'panel.excPathPh': 'path glob',
				'panel.addExc': 'Add exception',
				'panel.confirmDel': 'Confirm delete?',
				'panel.cancel': 'Cancel',
				'panel.del': 'Delete',
				'panel.allow': 'Allow',
				'panel.deny': 'Deny',
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
		function catShort(c) { return T('catS.' + c); }
		function modeLabel(m) { return T('mode.' + m); }
		const FONT = 'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
		const card = { border: '1px solid rgba(128,128,128,0.35)', borderRadius: 8, padding: 12, marginBottom: 12 };
		const rowStyle = { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid rgba(128,128,128,0.15)', flexWrap: 'wrap' };
		const small = { fontSize: 12, color: 'rgba(128,128,128,0.95)', marginRight: 6 };
		const h = () => ({ fontSize: 13, fontWeight: 600, margin: '0 0 8px' });

		function ApprovalOverlay() {
			const [pending, setPending] = React.useState([]);
			const [busyId, setBusyId] = React.useState(null);
			const [sel, setSel] = React.useState({});
			const [openDetail, setOpenDetail] = React.useState({});
			const [openArgs, setOpenArgs] = React.useState({});
			const [denyText, setDenyText] = React.useState({});
			const [denyMode, setDenyMode] = React.useState({});
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
			const decide = (id, action, rules, reason) => {
				setBusyId(id);
				call('permgate:decide', { id, action, rules, reason: reason || undefined }).then(poll).catch(() => {}).then(() => setBusyId(null));
			};
			if (!pending.length) return null;
			const pick = (candId, v) => {
				const next = Object.assign({}, sel);
				if (next[candId] === v) delete next[candId];
				else next[candId] = v;
				setSel(next);
			};
			const submit = (p, action) => {
				const rules = (p.candidates || []).filter((c) => sel[c.id]).map((c) => ({ value: c.value, kind: c.kind, decision: sel[c.id] }));
				decide(p.id, action, rules);
			};
			// 两段式拒绝：确认阶段提交（携带意见）或取消返回
			const confirmDeny = (p) => {
				const reason = (denyText[p.id] || '').trim();
				setDenyMode(Object.assign({}, denyMode, { [p.id]: false }));
				decide(p.id, 'deny', [], reason || undefined);
			};
			const cancelDeny = (p) => setDenyMode(Object.assign({}, denyMode, { [p.id]: false }));
			const radio = (p, c, v, label, cls) => React.createElement('button', {
				className: 'pg-radio' + (sel[c.id] === v ? ' ' + cls : ''),
				disabled: busyId === p.id,
				onClick: () => pick(c.id, v),
			}, label);
			// 编辑/写入审批（有 diff）：详情默认展开、参数默认收起；无 diff 时参数照常显示
			const detailOpen = (p) => (openDetail[p.id] === undefined ? !!p.diff : openDetail[p.id]);
			const argsOpen = (p) => (openArgs[p.id] === undefined ? !p.diff : openArgs[p.id]);
			const toggle = (map, setMap, p, v) => setMap(Object.assign({}, map, { [p.id]: v }));
			const argsBox = (p) => React.createElement('div', { className: 'pg-args' },
				React.createElement('span', { className: 'pg-args-tag' }, T('app.args')),
				(p.argLines && p.argLines.length)
					? p.argLines.map((l, i) => React.createElement('div', { key: i, className: 'pg-args-row' },
						React.createElement('span', { className: 'pg-args-label' }, l.label + '：'),
						React.createElement('span', { className: 'pg-args-val' }, l.value),
					))
					: React.createElement('span', null, p.args),
			);
			return React.createElement('div', null,
				pending.map((p) => React.createElement('div', { key: p.id, className: 'pg-modal' },
					React.createElement('div', { className: 'pg-modal-title' }, T('app.title')),
					React.createElement('div', { className: 'pg-modal-req' }, React.createElement('b', null, p.tool), ' ', T('app.request').replace('{tool}', '')),
					p.reason ? React.createElement('div', { className: 'pg-modal-body' }, p.reason) : null,
					p.intent ? React.createElement('div', { className: 'pg-intent' },
						React.createElement('span', { className: 'pg-intent-tag' }, T('app.intent')),
						React.createElement('span', null, p.intent),
					) : null,
					(p.args || (p.argLines && p.argLines.length)) ? (p.diff
						? React.createElement('div', null,
							React.createElement('button', { className: 'pg-link', onClick: () => toggle(openArgs, setOpenArgs, p, !argsOpen(p)) },
								(argsOpen(p) ? '▾ ' : '▸ ') + T('app.args'),
							),
							argsOpen(p) ? argsBox(p) : null,
						)
						: argsBox(p)) : null,
					p.diff ? React.createElement('div', null,
						React.createElement('button', { className: 'pg-link', onClick: () => toggle(openDetail, setOpenDetail, p, !detailOpen(p)) },
							(detailOpen(p) ? '▾ ' : '▸ ') + T('app.detail'),
						),
						detailOpen(p) ? React.createElement('div', { className: 'pg-diff' },
							React.createElement('div', { className: 'pg-diff-file' }, (p.diff.kind === 'new' ? T('app.diffNew') : T('app.diffMod')) + '：' + p.diff.file),
							React.createElement('div', { className: 'pg-diff-body' },
								p.diff.lines.map((l, i) => React.createElement('div', { key: i, className: l[0] === '+' ? 'pg-diff-add' : l[0] === '-' ? 'pg-diff-del' : 'pg-diff-ctx' }, l)),
								p.diff.truncated > 0 ? React.createElement('div', { className: 'pg-diff-more' }, '… ' + T('app.diffMore').replace('{n}', String(p.diff.truncated))) : null,
							),
							React.createElement('div', { className: 'pg-diff-foot' }, '└ +' + p.diff.added + ' -' + p.diff.removed + ' · 1 ' + T('app.diffFile')),
						) : null,
					) : null,
					(p.candidates || []).length ? React.createElement('div', null,
						React.createElement('div', { className: 'pg-cand-head' }, T('app.cand.head')),
						React.createElement('div', { className: 'pg-cand-hint' }, T('app.cand.hint')),
						(p.candidates || []).map((c) => React.createElement('div', { key: c.id, className: 'pg-cand' },
							React.createElement('span', { className: 'pg-cand-label' }, c.label),
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
						React.createElement('button', { className: 'pg-action pg-action-deny', disabled: busyId === p.id, onClick: () => setDenyMode(Object.assign({}, denyMode, { [p.id]: true })) }, T('app.deny')),
						React.createElement('button', { className: 'pg-action pg-action-allow', disabled: busyId === p.id, onClick: () => submit(p, 'allow') }, T('app.allow')),
					),
				)),
			);
		}

		function DockBar(props) {
			// 槽为 session 作用域：props.sessionId 是当前会话（标准 props），
			// 状态按会话查询，切换对话后各 DockBar 只反映自己的会话
			const sessionId = props && props.sessionId;
			const [status, setStatus] = React.useState(null);
			useLocaleTick();
			const refresh = () => { call('permgate:status', { sessionId: sessionId || undefined }).then(setStatus).catch(() => {}); };
			React.useEffect(() => {
				refresh();
				const off = subscribeEvents((ev) => {
					if (ev.type === 'status' || ev.type === 'refresh') refresh();
				});
				return () => off();
			}, []);
			// 仅当前会话选中「自定义审查」时显示分类徽标（只读展示，无开关）
			if (!status || status.activeForSession !== true) return null;
			const eff = status.effective || {};
			const chip = (label, m) => React.createElement('span', { key: label, style: { color: MODE_COLORS[m] || '#888' } }, label + ':' + modeLabel(m));
			return React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'rgba(128,128,128,0.95)', padding: '2px 0' } },
				React.createElement('span', { style: { fontWeight: 600 } }, T('dock.title')),
				React.createElement('span', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
					chip(catShort('directory'), eff.directory), chip(catShort('command'), eff.command), chip(catShort('read'), eff.read), chip(catShort('edit'), eff.edit), chip(catShort('subagent'), eff.subagent), chip(catShort('doomloop'), eff.doomloop),
				),
				React.createElement('span', { style: { cursor: 'pointer', padding: '0 4px' }, onClick: refresh, title: T('dock.refresh') }, '↻'),
			);
		}

		function Panel(props) {
			// settings.section 是 root 作用域槽：不直接给 sessionId，但注入 useSessions
			// 标准 hook。用它订阅当前活动会话（SessionListState.current），会话切换时
			// 选择器变化触发重渲染 + 重新查询，面板始终显示当前会话的项目配置。
			const sessionId = (props && typeof props.useSessions === 'function') ? props.useSessions((st) => (st ? st.current : undefined)) : undefined;
			const [status, setStatus] = React.useState(null);
			const [busy, setBusy] = React.useState(false);
			const [msg, setMsg] = React.useState('');
			const [tab, setTab] = React.useState('global');
			const [cats, setCats] = React.useState({ global: {}, project: {} });
			const [quickSel, setQuickSel] = React.useState({});
			const [exVals, setExVals] = React.useState({ directory: '', command: '', read: '', edit: '' });
			const [exAction, setExAction] = React.useState('allow');
			const [newTool, setNewTool] = React.useState('');
			const [form, setForm] = React.useState({ action: 'deny', tool: '', path: '', args: '', reason: '' });
			const [confirm, setConfirm] = React.useState(null);
			const [excCollapsed, setExcCollapsed] = React.useState({});

			React.useEffect(() => {
				if (confirm === null) return undefined;
				const id = setTimeout(() => setConfirm(null), 4000);
				return () => clearTimeout(id);
			}, [confirm]);

			const applyStatus = (s) => {
				if (!s) return;
				setStatus(s);
				const cs = { global: {}, project: {} };
				for (const t of ['global', 'project']) {
					const block = s.categories && s.categories[t] ? s.categories[t] : null;
					for (const c of CATS) {
						cs[t][c] = block && block[c] ? block[c].mode : (t === 'project' ? 'inherit' : 'ask');
					}
				}
				setCats(cs);
				const qs = {};
				const gq = s.quickTools ? s.quickTools.global : {};
				const pq = s.quickTools ? s.quickTools.project : {};
				const names = {};
				for (const t of QUICK_PRESET) names[t] = 1;
				for (const k of Object.keys(gq)) names[k] = 1;
				for (const k of Object.keys(pq)) names[k] = 1;
				for (const t of Object.keys(names)) {
					qs[t] = { g: gq[t] || 'allow', p: pq[t] && pq[t] !== 'inherit' ? pq[t] : 'inherit' };
				}
				setQuickSel(qs);
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

			const invoke = (method, args, done) => {
				setBusy(true);
				setMsg('');
				call(method, Object.assign({}, args || {}, { sessionId: sessionId || undefined })).then((r) => {
					if (r && r.error) { setMsg(String(r.error)); return; }
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

			const changeCat = (c) => (e) => {
				const mode = e.target.value;
				setCats(Object.assign({}, cats, { [tab]: Object.assign({}, cats[tab], { [c]: mode }) }));
				invoke('permgate:set-categories', { [tab]: { [c]: mode } }, () => setMsg(tab === 'global' ? T('panel.savedToGlobal') : T('panel.savedToProject')));
			};

			const changeQuick = (tool) => (e) => {
				const mode = e.target.value;
				const key = tab === 'global' ? 'g' : 'p';
				setQuickSel(Object.assign({}, quickSel, { [tool]: Object.assign({}, quickSel[tool], { [key]: mode }) }));
				invoke('permgate:set-quick', { target: tab, tool, action: mode });
			};

			const addQuick = () => {
				if (!newTool || !String(newTool).trim()) { setMsg(T('panel.needTool')); return; }
				invoke('permgate:set-quick', { target: tab, tool: String(newTool).trim(), action: 'allow' }, () => setNewTool(''));
			};

			const addException = (c) => {
				const v = String(exVals[c] || '').trim();
				if (!v) { setMsg(T('panel.needValue')); return; }
				setExVals(Object.assign({}, exVals, { [c]: '' }));
				invoke('permgate:add-exception', { target: tab, category: c, match: v, action: exAction });
			};

			const removeException = (c, id) => invoke('permgate:remove-exception', { target: tab, category: c, id });

			const setFormKey = (key) => (e) => setForm(Object.assign({}, form, { [key]: e.target.value }));
			const addRule = () => invoke('permgate:add-rule', { target: tab, action: form.action, tool: form.tool || undefined, path: form.path || undefined, args: form.args || undefined, reason: form.reason || undefined });
			const removeRule = (id) => invoke('permgate:remove-rule', { target: tab, id });
			const reload = () => invoke('permgate:reload', {});
			const openConfig = () => invoke('permgate:open-config', {}, () => setMsg(T('panel.openConfigDone')));

			const badge = (action) => React.createElement('span', { style: { color: MODE_COLORS[action] || '#888', fontWeight: 600, marginRight: 6 } }, modeLabel(action));

			const sel = (v, onChange, options, disabled) => React.createElement('select', { value: v, onChange, className: 'pg-field', style: { padding: '2px 6px' }, disabled: !!disabled },
				options.map((m) => React.createElement('option', { key: m, value: m }, modeLabel(m))),
			);

			const tabBtn = (t, label) => React.createElement('button', { className: 'pg-tab' + (tab === t ? ' pg-tab-on' : ''), onClick: () => setTab(t) }, label);

			const catBlock = (c) => {
				const mode = cats[tab] ? (cats[tab][c] || (tab === 'project' ? 'inherit' : 'ask')) : (tab === 'project' ? 'inherit' : 'ask');
				const block = status && status.categories && status.categories[tab] ? status.categories[tab] : null;
				const excList = block && block[c] && Array.isArray(block[c].exceptions) ? block[c].exceptions : [];
				// 例外折叠：列表超过阈值默认收起（长列表不再撑爆面板），添加行始终可见
				const excCollapsedState = excCollapsed[c] === undefined ? excList.length > EXC_COLLAPSE_THRESHOLD : excCollapsed[c];
				const toggleExc = () => setExcCollapsed(Object.assign({}, excCollapsed, { [c]: !excCollapsedState }));
				return React.createElement('div', { key: c, style: { border: '1px solid rgba(128,128,128,0.3)', borderRadius: 8, padding: 10, marginBottom: 10 } },
					React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 } },
						React.createElement('span', { style: { fontSize: 13, fontWeight: 600 } }, catLabel(c)),
						sel(mode, changeCat(c), tab === 'project' ? ALL_MODES : MODES, busy),
					),
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
								excList.map((r) => React.createElement('div', { key: r.id, style: rowStyle },
									badge(r.action),
									React.createElement('span', { style: { fontFamily: 'monospace', fontSize: 12 } }, r.path || r.match || ''),
									React.createElement('div', { style: { display: 'flex', gap: 6, marginLeft: 'auto' } },
										React.createElement('button', { className: 'pg-btn pg-btn-danger' + (confirm === 'exc:' + c + ':' + r.id ? ' pg-btn-confirm' : ''), disabled: busy, onClick: () => confirmDelete('exc:' + c + ':' + r.id, () => removeException(c, r.id)) }, confirm === 'exc:' + c + ':' + r.id ? T('panel.confirmDel') : T('panel.del')),
										confirm === 'exc:' + c + ':' + r.id ? React.createElement('button', { className: 'pg-btn', disabled: busy, onClick: () => setConfirm(null) }, T('panel.cancel')) : null,
									),
								)),
							) : React.createElement('div', { style: { fontSize: 12, color: 'rgba(128,128,128,0.7)' } }, T('panel.excNone'))),
						React.createElement('div', { style: { display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' } },
							React.createElement('input', { className: 'pg-field', placeholder: c === 'command' ? T('panel.excPh') : T('panel.excPathPh'), value: exVals[c] || '', onChange: (e) => setExVals(Object.assign({}, exVals, { [c]: e.target.value })), disabled: busy }),
							React.createElement('select', { className: 'pg-field', style: { padding: '2px 6px' }, value: exAction, onChange: (e) => setExAction(e.target.value), disabled: busy },
								React.createElement('option', { value: 'allow' }, T('panel.allow')), React.createElement('option', { value: 'deny' }, T('panel.deny')),
							),
							React.createElement('button', { className: 'pg-btn', disabled: busy, onClick: () => addException(c) }, T('panel.addExc')),
						),
					) : null,
				);
			};

			const quickTools = Object.keys(quickSel);
			const quickRow = (t) => {
				const key = tab === 'global' ? 'g' : 'p';
				const mode = quickSel[t] ? (quickSel[t][key] || (tab === 'project' ? 'inherit' : 'allow')) : (tab === 'project' ? 'inherit' : 'allow');
				return React.createElement('div', { key: t, style: rowStyle },
					React.createElement('span', { style: { fontFamily: 'monospace', fontSize: 13, width: 150 } }, t),
					sel(mode, changeQuick(t), tab === 'project' ? ALL_MODES : MODES, busy),
				);
			};

			const ruleRow = (r) => {
				const matchers = [];
				if (r.tool) matchers.push('tool=' + r.tool);
				if (r.path) matchers.push('path=' + r.path);
				if (r.args) matchers.push('args="' + r.args + '"');
				return React.createElement('div', { key: r.id, style: rowStyle },
					badge(r.action),
					React.createElement('span', { style: { fontFamily: 'monospace', fontSize: 12 } }, matchers.join('  ') || T('panel.all')),
					r.reason ? React.createElement('span', { style: { fontSize: 12, color: 'rgba(128,128,128,0.9)' } }, '(' + r.reason + ')') : null,
					React.createElement('div', { style: { display: 'flex', gap: 6, marginLeft: 'auto' } },
						React.createElement('button', { className: 'pg-btn pg-btn-danger' + (confirm === 'rule:' + r.id ? ' pg-btn-confirm' : ''), disabled: busy, onClick: () => confirmDelete('rule:' + r.id, () => removeRule(r.id)) }, confirm === 'rule:' + r.id ? T('panel.confirmDel') : T('panel.del')),
						confirm === 'rule:' + r.id ? React.createElement('button', { className: 'pg-btn', disabled: busy, onClick: () => setConfirm(null) }, T('panel.cancel')) : null,
					),
				);
			};

			const customList = status && status.custom ? status.custom[tab] : null;
			const eff = status ? status.effective : null;
			const decisions = status && status.recentDecisions ? status.recentDecisions : [];
			const stats = status && status.stats ? status.stats : { deny: 0, ask: 0 };
			const sandbox = status && status.sandbox ? status.sandbox : { global: 'workspace-write', project: 'inherit', effective: 'workspace-write' };
			const presetName = status && status.preset ? status.preset : null;
			const activeForSession = status ? status.activeForSession === true : false;

			const sandboxLabel = (m) => (m === 'workspace-write' ? T('sandbox.ww') : m === 'danger-full-access' ? T('sandbox.fa') : T('sandbox.inherit'));
			const sandboxVal = tab === 'global' ? sandbox.global : sandbox.project;
			const sandboxOptions = tab === 'global' ? ['workspace-write', 'danger-full-access'] : ['workspace-write', 'danger-full-access', 'inherit'];
			const changeSandbox = (e) => {
				const mode = e.target.value;
				invoke('permgate:set-sandbox', { target: tab, mode }, () => setMsg(T('panel.sandboxSaved').replace('{t}', T(tab === 'global' ? 'panel.tabGlobal' : 'panel.tabProject')).replace('{v}', sandboxLabel(mode))));
			};

			return React.createElement('div', { style: { maxWidth: 760, fontFamily: FONT, color: 'var(--dsw-alias-label-primary, #24292f)' } },
				React.createElement('div', { style: card },
					React.createElement('div', { style: h() }, T('panel.status')),
					React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' } },
						React.createElement('span', { style: { fontSize: 13, fontWeight: 600 } }, T('panel.sessionPerm')),
						React.createElement('span', { style: { fontSize: 13, color: activeForSession ? '#2e7d32' : '#888', fontWeight: 600 } }, presetName === 'custom-review' ? T('panel.customReview') : (presetName || T('panel.none'))),
						React.createElement('span', { style: small }, activeForSession ? T('panel.active') : T('panel.inactive')),
					),
					React.createElement('div', { style: { fontSize: 13, marginBottom: 6 } },
						T('panel.sandboxEff') + ' ',
						React.createElement('span', { style: { color: sandbox.effective === 'danger-full-access' ? '#e65100' : '#2e7d32', fontWeight: 600 } }, sandboxLabel(sandbox.effective)),
						React.createElement('span', { style: small }, sandbox.effective === 'workspace-write' ? T('panel.sandboxDesc.ww') : T('panel.sandboxDesc.fa')),
					),
					React.createElement('div', { style: { fontSize: 13, marginBottom: 6 } },
						T('panel.effCats'),
						eff ? CATS.map((c) => React.createElement('span', { key: c, style: { color: MODE_COLORS[eff[c]] || '#888', fontWeight: 600, marginRight: 8 } }, (catLabel(c) + ':' + modeLabel(eff[c])))) : '…',
					),
					React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
						React.createElement('span', { style: small }, T('panel.config') + (status ? status.configPath : '…')),
						React.createElement('button', { className: 'pg-btn', disabled: busy, onClick: openConfig }, T('panel.openConfig')),
						React.createElement('button', { className: 'pg-btn', disabled: busy, onClick: reload }, T('panel.reload')),
					),
					React.createElement('div', { style: small }, T('panel.project') + (status ? status.projectKey : '…')),
					React.createElement('div', { style: small }, T('panel.stats').replace('{d}', String(stats.deny)).replace('{a}', String(stats.ask))),
					status && status.loadError ? React.createElement('div', { style: { color: '#c62828', fontSize: 12 } }, T('panel.loadErr') + status.loadError) : null,
					status && status.saveError ? React.createElement('div', { style: { color: '#c62828', fontSize: 12 } }, T('panel.saveErr') + status.saveError) : null,
				),
				React.createElement('div', { style: { display: 'flex', marginBottom: 12, borderBottom: '1px solid rgba(128,128,128,0.35)' } },
					tabBtn('global', T('panel.tabGlobal')),
					tabBtn('project', T('panel.tabProject')),
				),
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
				CATS.map(catBlock),
				React.createElement('div', { style: card },
					React.createElement('div', { style: h() }, T('panel.quick')),
					React.createElement('div', { style: { fontSize: 12, color: 'rgba(128,128,128,0.8)', marginBottom: 6 } }, T('panel.quickHint')),
					quickTools.map(quickRow),
					React.createElement('div', { style: { display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' } },
						React.createElement('input', { className: 'pg-field', placeholder: T('panel.quickAdd'), value: newTool, onChange: (e) => setNewTool(e.target.value), disabled: busy }),
						React.createElement('button', { className: 'pg-btn', disabled: busy, onClick: addQuick }, T('panel.quickAddBtn')),
					),
				),
				React.createElement('div', { style: card },
					React.createElement('div', { style: h() }, T('panel.rules')),
					React.createElement('div', { style: { fontSize: 12, color: 'rgba(128,128,128,0.8)', marginBottom: 8 } }, T('panel.rulesHint')),
					React.createElement('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 } },
						React.createElement('select', { value: form.action, onChange: setFormKey('action'), className: 'pg-field', disabled: busy },
							React.createElement('option', { value: 'deny' }, T('panel.actionDeny')), React.createElement('option', { value: 'ask' }, T('panel.actionAsk')), React.createElement('option', { value: 'allow' }, T('panel.actionAllow')),
						),
						React.createElement('input', { placeholder: T('panel.toolPh'), value: form.tool, onChange: setFormKey('tool'), className: 'pg-field', disabled: busy }),
						React.createElement('input', { placeholder: T('panel.pathPh'), value: form.path, onChange: setFormKey('path'), className: 'pg-field', disabled: busy }),
						React.createElement('input', { placeholder: T('panel.argsPh'), value: form.args, onChange: setFormKey('args'), className: 'pg-field', disabled: busy }),
						React.createElement('input', { placeholder: T('panel.reasonPh'), value: form.reason, onChange: setFormKey('reason'), className: 'pg-field', disabled: busy }),
						React.createElement('button', { className: 'pg-btn', disabled: busy, onClick: addRule }, tab === 'global' ? T('panel.addToGlobal') : T('panel.addToProject')),
					),
					React.createElement('div', { style: { marginTop: 8 } },
						React.createElement('div', { style: { fontSize: 12, fontWeight: 600, marginBottom: 4 } }, T('panel.ruleList').replace('{t}', T(tab === 'global' ? 'panel.tabGlobal' : 'panel.tabProject')).replace('{n}', String(customList ? customList.length : 0))),
						customList && customList.length ? customList.map(ruleRow) : React.createElement('div', { style: { fontSize: 12, color: 'rgba(128,128,128,0.8)' } }, T('panel.noRules')),
					),
				),
				React.createElement('div', { style: card },
					React.createElement('div', { style: h() }, T('panel.decisions')),
					decisions.length ? decisions.map((d, i) => React.createElement('div', { key: i, style: rowStyle },
						badge(d.action),
						React.createElement('span', { style: { fontFamily: 'monospace', fontSize: 12 } }, d.tool),
						React.createElement('span', { style: { fontSize: 12, color: 'rgba(128,128,128,0.9)' } }, d.reason || ''),
					)) : React.createElement('div', { style: { fontSize: 12, color: 'rgba(128,128,128,0.8)' } }, T('panel.noDecisions')),
				),
				msg ? React.createElement('div', { style: { fontSize: 12, color: '#1e88e5', marginBottom: 8 } }, msg) : null,
			);
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
			if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="dsh-permgate"]') === null) {
				const tag = document.createElement('style');
				tag.dataset.plugin = 'dsh-permgate';
				tag.dataset.pluginCss = 'dsh-permgate';
				tag.textContent = CSS;
				document.head.appendChild(tag);
				ctx.effect(() => () => { try { tag.remove(); } catch (e) {} });
			}
			if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="dsh-permgate-diff"]') === null) {
				const tag = document.createElement('style');
				tag.dataset.plugin = 'dsh-permgate';
				tag.dataset.pluginCss = 'dsh-permgate-diff';
				tag.textContent = DIFF_CSS;
				document.head.appendChild(tag);
				ctx.effect(() => () => { try { tag.remove(); } catch (e) {} });
			}
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
			// 那样会丢弃槽系统注入的 props，DockBar 就拿不到 sessionId，状态无法按会话区分）
			slots.inject('settings.section', () => slots.register(
				// label 用 thunk：每次投影时重新求值，跟随当前语言（locale.bind 读取活动语言）
				{ name: 'settings.section', id: 'permgate', order: 30, label: () => T('settings.title') },
				Panel,
			));
			slots.inject('conversation.composer.dock', () => slots.register(
				{ name: 'conversation.composer.dock', id: 'permgate', order: 10 },
				DockBar,
			));
			slots.inject('shell.overlay', () => slots.register(
				{ name: 'shell.overlay', id: 'permgate-approval', order: 100 },
				ApprovalOverlay,
			));
		}

		exports.apply = apply;
		exports.inject = ['slots', 'locale'];
		return module.exports;
	}
});
