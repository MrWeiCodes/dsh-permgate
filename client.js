window.__ModuleLoader__.load({
	id: "dsh-permgate",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let React = require("react");

		const CSS = ".pg-modal { position: fixed; top: 16px; right: 16px; z-index: 9999; width: 420px; max-width: 92vw; max-height: 82vh; overflow-y: auto; background: var(--dsw-alias-bg-overlay, #ffffff); color: var(--dsw-alias-label-primary, #24292f); border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.4)); border-radius: 10px; box-shadow: 0 10px 36px rgba(0,0,0,0.32); padding: 14px 16px; font-family: system-ui, -apple-system, \"Segoe UI\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif; } .pg-modal-title { font-size: 14px; font-weight: 600; margin-bottom: 6px; } .pg-modal-req { font-size: 12px; margin-bottom: 4px; } .pg-modal-body { font-size: 12px; color: var(--dsw-alias-label-secondary, #57606a); margin-bottom: 8px; } .pg-intent { font-size: 12px; background: var(--dsw-alias-bg-layer-1, #f6f8fa); border: 1px solid var(--dsw-alias-border-l1, #d0d7de); border-left: 3px solid var(--dsw-alias-brand-primary, #1f6feb); border-radius: 6px; padding: 6px 8px; color: var(--dsw-alias-label-secondary, #57606a); margin-bottom: 6px; line-height: 1.5; word-break: break-word; } .pg-intent-tag { display: inline-block; font-weight: 700; color: var(--dsw-alias-brand-primary, #1f6feb); margin-right: 6px; font-size: 11px; } .pg-args { font-size: 11px; background: var(--dsw-alias-bg-layer-1, #f6f8fa); border: 1px solid var(--dsw-alias-border-l1, #d0d7de); border-left: 3px solid rgba(128,128,128,0.65); border-radius: 6px; padding: 5px 8px; color: var(--dsw-alias-label-secondary, #57606a); margin-bottom: 8px; line-height: 1.5; word-break: break-all; font-family: ui-monospace, Consolas, monospace; } .pg-args-tag { display: inline-block; font-weight: 700; color: rgba(128,128,128,0.95); margin-right: 6px; font-size: 11px; font-family: system-ui, -apple-system, \"Segoe UI\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif; } .pg-args-row { display: flex; gap: 6px; padding: 1px 0; } .pg-args-label { font-weight: 600; flex: 0 0 auto; } .pg-args-val { word-break: break-all; flex: 1; } .pg-cand-head { font-size: 12px; font-weight: 600; margin: 6px 0 4px; } .pg-cand-hint { font-size: 11px; color: var(--dsw-alias-label-secondary, #8c959f); margin-bottom: 4px; } .pg-cand { display: flex; align-items: center; gap: 6px; padding: 4px 0; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.2)); } .pg-cand-label { flex: 1; font-family: ui-monospace, Consolas, monospace; font-size: 11px; word-break: break-all; } .pg-radio { display: inline-flex; align-items: center; gap: 3px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.4)); background: transparent; color: var(--dsw-alias-label-secondary, #57606a); font-size: 11px; font-family: inherit; cursor: pointer; transition: all 0.15s ease; } .pg-radio:hover { border-color: var(--dsw-alias-brand-primary, #1f6feb); } .pg-radio-allow { border-color: var(--dsw-alias-state-success-primary, #1a7f37); color: var(--dsw-alias-state-success-primary, #1a7f37); background: rgba(26, 127, 55, 0.12); font-weight: 600; } .pg-radio-deny { border-color: var(--dsw-alias-state-error-primary, #cf222e); color: var(--dsw-alias-state-error-primary, #cf222e); background: rgba(207, 34, 46, 0.12); font-weight: 600; } .pg-footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; } .pg-action { display: inline-flex; align-items: center; padding: 5px 16px; border-radius: 6px; border: 1px solid; font-size: 12px; font-family: inherit; font-weight: 600; cursor: pointer; transition: filter 0.15s ease, box-shadow 0.15s ease, transform 0.05s ease; } .pg-action:hover { filter: brightness(1.07); box-shadow: 0 2px 8px rgba(0,0,0,0.18); } .pg-action:active { transform: translateY(1px); box-shadow: none; } .pg-action:disabled { opacity: 0.5; cursor: not-allowed; filter: none; box-shadow: none; } .pg-action-allow { border-color: rgba(26, 127, 55, 0.45); color: #1a7f37; background: rgba(26, 127, 55, 0.12); } @supports (color: color-mix(in srgb, red 10%, blue)) { .pg-action-allow { border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary, #1a7f37) 45%, transparent); color: var(--dsw-alias-state-success-primary, #1a7f37); background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #1a7f37) 12%, transparent); } } .pg-action-deny { border-color: rgba(207, 34, 46, 0.45); color: #cf222e; background: rgba(207, 34, 46, 0.12); } @supports (color: color-mix(in srgb, red 10%, blue)) { .pg-action-deny { border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #cf222e) 45%, transparent); color: var(--dsw-alias-state-error-primary, #cf222e); background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #cf222e) 12%, transparent); } } .pg-btn { padding: 4px 10px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.4)); background: transparent; color: var(--dsw-alias-label-primary, #24292f); cursor: pointer; font-size: 13px; font-family: inherit; transition: border-color 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease, transform 0.05s ease; } .pg-btn:hover { border-color: var(--dsw-alias-brand-primary, #1f6feb); background: rgba(31, 111, 235, 0.08); } .pg-btn:active { transform: translateY(1px); } .pg-btn:disabled { opacity: 0.5; cursor: not-allowed; } .pg-btn-danger:hover { border-color: var(--dsw-alias-state-error-primary, #cf222e); color: var(--dsw-alias-state-error-primary, #cf222e); background: rgba(207, 34, 46, 0.08); } .pg-btn-on { border-color: var(--dsw-alias-state-success-primary, #1a7f37); color: var(--dsw-alias-state-success-primary, #1a7f37); background: rgba(26, 127, 55, 0.12); font-weight: 600; } .pg-btn-on:hover { border-color: var(--dsw-alias-state-success-primary, #1a7f37); color: var(--dsw-alias-state-success-primary, #1a7f37); background: rgba(26, 127, 55, 0.2); } .pg-btn-off { border-color: var(--dsw-alias-state-error-primary, #cf222e); color: var(--dsw-alias-state-error-primary, #cf222e); background: rgba(207, 34, 46, 0.1); font-weight: 600; } .pg-btn-off:hover { border-color: var(--dsw-alias-state-error-primary, #cf222e); color: var(--dsw-alias-state-error-primary, #cf222e); background: rgba(207, 34, 46, 0.16); } .pg-btn-confirm { border-color: var(--dsw-alias-state-error-primary, #cf222e); color: #ffffff; background: var(--dsw-alias-state-error-primary, #cf222e); } .pg-btn-confirm:hover { border-color: var(--dsw-alias-state-error-primary, #cf222e); color: #ffffff; background: var(--dsw-alias-state-error-primary, #cf222e); filter: brightness(1.12); } .pg-field { padding: 4px 8px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.4)); background: var(--dsw-alias-bg-layer-1, #f6f8fa); color: var(--dsw-alias-label-primary, #24292f); color-scheme: light dark; font-size: 13px; font-family: inherit; transition: border-color 0.15s ease, box-shadow 0.15s ease; } .pg-field:hover { border-color: var(--dsw-alias-brand-primary, #1f6feb); } .pg-field:focus { outline: none; border-color: var(--dsw-alias-brand-primary, #1f6feb); box-shadow: 0 0 0 2px rgba(31, 111, 235, 0.22); } .pg-field:disabled { opacity: 0.5; cursor: not-allowed; } .pg-field option { color: var(--dsw-alias-label-primary, #24292f); background: var(--dsw-alias-bg-overlay, #ffffff); } .pg-tab { padding: 6px 16px; border-radius: 6px 6px 0 0; border: none; border-bottom: 2px solid transparent; background: transparent; color: var(--dsw-alias-label-primary, #24292f); cursor: pointer; font-size: 13px; font-family: inherit; margin-right: 4px; transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease; } .pg-tab:hover { background: rgba(128, 128, 128, 0.12); } .pg-tab-on { border-bottom-color: var(--dsw-alias-brand-primary, #1f6feb); color: var(--dsw-alias-brand-primary, #1f6feb); font-weight: 600; }";

		const DIFF_CSS = '.pg-link { display: inline-flex; align-items: center; gap: 4px; background: var(--dsw-alias-bg-layer-1, #f0f2f5); color: var(--dsw-alias-label-primary, #24292f); border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.45)); border-radius: 6px; padding: 3px 12px; cursor: pointer; font-size: 12px; font-weight: 500; margin-bottom: 6px; } .pg-link:hover { border-color: #1f6feb; color: #1f6feb; }';

		// dsh-file-review 风格 unified diff + 右侧对比抽屉（浅/深色主题 token 跟随）
		const DIFF2_CSS = '.pg2-block { position: relative; margin-top: 6px; margin-bottom: 8px; border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.3)); border-radius: 8px; overflow: hidden; background: var(--dsw-alias-bg-layer-1, rgba(0,0,0,0.03)); } .pg2-header { display: flex; align-items: center; gap: 8px; min-height: 32px; padding: 0 8px; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.2)); font-family: ui-monospace, Consolas, monospace; font-size: 11px; } .pg2-status { color: var(--dsw-alias-state-success-primary, #1a7f37); font-weight: 700; } .pg2-status-read { color: var(--dsw-alias-brand-primary, #1f6feb); font-weight: 700; } .pg2-path { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; color: inherit; } .pg2-path:hover { color: var(--dsw-alias-brand-primary, #1f6feb); text-decoration: underline; } .pg2-added { margin-left: auto; color: var(--dsw-alias-state-success-primary, #1a7f37); } .pg2-removed { color: var(--dsw-alias-state-error-primary, #cf222e); } .pg2-copy { border: 0; background: transparent; color: var(--dsw-alias-label-secondary, #57606a); cursor: pointer; font-size: 11px; font-family: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; padding: 0 2px; margin-left: 6px; flex: 0 0 auto; } .pg2-copy:hover { color: var(--dsw-alias-brand-primary, #1f6feb); } .pg2-body { overflow: auto; max-height: 240px; font-family: ui-monospace, Consolas, monospace; font-size: 11px; line-height: 1.5; } .pg2-row { display: grid; grid-template-columns: 40px 40px 22px minmax(max-content, 1fr); min-width: max-content; white-space: pre; } .pg2-old, .pg2-new { padding: 0 6px; border-right: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.2)); color: var(--dsw-alias-label-tertiary, #8c959f); text-align: right; user-select: none; } .pg2-sign { text-align: center; user-select: none; } .pg2-text { padding-right: 12px; } .pg2-del { color: var(--dsw-alias-state-error-primary, #cf222e); background: rgba(207, 34, 46, 0.10); } .pg2-add { color: var(--dsw-alias-state-success-primary, #1a7f37); background: rgba(26, 127, 55, 0.10); } .pg2-ctx { color: var(--dsw-alias-label-primary, #24292f); } .pg2-gap { display: block; width: 100%; border: 0; border-top: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.2)); border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.2)); background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.07)); color: var(--dsw-alias-label-secondary, #57606a); cursor: pointer; font-size: 11px; font-family: ui-monospace, Consolas, monospace; text-align: left; padding: 4px 8px 4px 104px; } .pg2-gap:hover { color: var(--dsw-alias-label-primary, #24292f); } .pg2-gap-more { padding: 4px 8px 4px 104px; color: var(--dsw-alias-label-secondary, #57606a); font-size: 11px; font-family: ui-monospace, Consolas, monospace; } .pg2-fadd { color: #2e7d32; } .pg2-fdel { color: #c62828; } .pg2-fctx { color: rgba(128,128,128,0.7); } .pg2-foot { padding: 4px 8px; border-top: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.2)); font-size: 11px; color: rgba(128,128,128,0.8); } .pg2-rrow { display: grid; grid-template-columns: 40px minmax(max-content, 1fr); min-width: max-content; white-space: pre; } .pg2-rnum { padding: 0 6px; border-right: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.2)); color: var(--dsw-alias-label-tertiary, #8c959f); text-align: right; user-select: none; } .pg2-load { padding: 10px 12px; font-size: 12px; color: var(--dsw-alias-label-secondary, #57606a); } .pg2-err { padding: 10px 12px; font-size: 12px; color: var(--dsw-alias-state-error-primary, #cf222e); } .pg-path-link { color: var(--dsw-alias-brand-primary, #1f6feb); cursor: pointer; word-break: break-all; flex: 1; } .pg-path-link:hover { text-decoration: underline; } .pg2-drawer { position: fixed; top: 0; right: 0; bottom: 0; left: auto; width: 42vw; min-width: 480px; max-width: 96vw; z-index: 10000; background: var(--dsw-alias-bg-overlay, #ffffff); color: var(--dsw-alias-label-primary, #24292f); border-left: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.4)); box-shadow: -8px 0 28px rgba(0,0,0,0.25); display: flex; flex-direction: column; } .pg2-drawer-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.25)); min-height: 44px; } .pg2-drawer-file { font-family: ui-monospace, Consolas, monospace; font-size: 12px; word-break: break-all; flex: 1; min-width: 0; } .pg2-drawer-close { border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.4)); background: transparent; color: var(--dsw-alias-label-secondary, #57606a); border-radius: 6px; width: 26px; height: 26px; cursor: pointer; font-size: 13px; line-height: 1; flex: 0 0 auto; } .pg2-drawer-close:hover { color: var(--dsw-alias-brand-primary, #1f6feb); border-color: var(--dsw-alias-brand-primary, #1f6feb); } .pg2-drawer-body { flex: 1; overflow: hidden; padding: 10px 12px; display: flex; flex-direction: column; min-height: 0; } .pg2-drawer-body .pg2-block { margin: 0; flex: 1; display: flex; flex-direction: column; min-height: 0; } .pg2-drawer-body .pg2-body { flex: 1; overflow: auto; max-height: none; min-height: 0; } .pg2-drawer-body .pg2-load, .pg2-drawer-body .pg2-err { flex: 1; display: flex; align-items: center; justify-content: center; } .pg2-drawer-resize { position: absolute; top: 0; bottom: 0; left: -4px; width: 8px; cursor: col-resize; z-index: 2; } .pg2-drawer-resize:hover, .pg2-drawer-resize.drag { background: rgba(31, 111, 235, 0.18); } .pg2-drawer-open { border: 1px solid var(--dsw-alias-brand-primary, #1f6feb); background: transparent; color: var(--dsw-alias-brand-primary, #1f6feb); border-radius: 6px; padding: 2px 10px; height: 26px; cursor: pointer; font-size: 12px; flex: 0 0 auto; } .pg2-drawer-open:hover { background: rgba(31, 111, 235, 0.10); } .pg2-edit-msg { font-size: 12px; color: var(--dsw-alias-label-secondary, #57606a); margin-right: 6px; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .pg2-edit-msg.err { color: var(--dsw-alias-state-error-primary, #cf222e); } .pg2-expand { border: 0; background: transparent; color: var(--dsw-alias-brand-primary, #1f6feb); cursor: pointer; font-size: 11px; font-family: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; padding: 0 2px; margin-left: 6px; flex: 0 0 auto; } .pg2-expand:hover { text-decoration: underline; } .pg2-romit { padding: 3px 8px 3px 48px; color: var(--dsw-alias-label-secondary, #57606a); font-size: 11px; font-family: ui-monospace, Consolas, monospace; font-style: italic; } .pg2-text .token.comment, .pg2-text .token.prolog, .pg2-text .token.doctype, .pg2-text .token.cdata { color: #8c959f; font-style: italic; } .pg2-text .token.punctuation { color: #57606a; } .pg2-text .token.property, .pg2-text .token.tag, .pg2-text .token.constant, .pg2-text .token.symbol, .pg2-text .token.deleted { color: #cf222e; } .pg2-text .token.boolean, .pg2-text .token.number { color: #9a6700; } .pg2-text .token.selector, .pg2-text .token.attr-name, .pg2-text .token.string, .pg2-text .token.char, .pg2-text .token.builtin, .pg2-text .token.inserted { color: #1a7f37; } .pg2-text .token.operator, .pg2-text .token.entity, .pg2-text .token.url { color: #8250df; } .pg2-text .token.atrule, .pg2-text .token.attr-value, .pg2-text .token.keyword { color: #1f6feb; } .pg2-text .token.function, .pg2-text .token.class-name { color: #8250df; } .pg2-text .token.regex, .pg2-text .token.important, .pg2-text .token.variable { color: #953800; }';

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
			'permgate:pending': ['GET', '/permgate/pending'],
			'permgate:file-diff': ['POST', '/permgate/file-diff'],
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
			'permgate:open-file': ['POST', '/permgate/open-file'],
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
		// 文件对比缓存：按审批 id 缓存 /permgate/file-diff 结果（弹窗详情与右侧抽屉共用）
		const diffCache = new Map();
		const diffFetching = new Set();
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
				'app.diffLoading': '加载中…',
				'app.diffErr': '无法生成对比',
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
				'app.diffTopMore': '… 上方还有 {n} 行',
				'app.diffBottomMore': '… 下方还有更多行',
				'app.diffClose': '关闭',
				'app.openFile': '打开文件',
				'app.editOpened': '已用默认编辑器打开',
				'app.diffResize': '拖动调整宽度',
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
				'panel.excReason': '拒绝原因',
				'panel.excReasonPh': '选填：拒绝时显示的提示',
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
				'app.diffLoading': 'Loading…',
				'app.diffErr': 'Cannot build comparison',
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
				'app.diffTopMore': '… {n} more lines above',
				'app.diffBottomMore': '… more lines below',
				'app.diffClose': 'Close',
				'app.openFile': 'Open File',
				'app.editOpened': 'Opened with default editor',
				'app.diffResize': 'Drag to resize',
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
				'panel.excReason': 'Deny reason',
				'panel.excReasonPh': 'optional: shown when denied',
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

		function ApprovalOverlay(props) {
			const [pending, setPending] = React.useState([]);
			const [busyId, setBusyId] = React.useState(null);
			const [sel, setSel] = React.useState({});
			const [openDetail, setOpenDetail] = React.useState({});
			const [openArgs, setOpenArgs] = React.useState({});
			const [denyText, setDenyText] = React.useState({});
			const [denyMode, setDenyMode] = React.useState({});
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
			const detailOpen = (p) => (openDetail[p.id] === undefined ? !!p.hasDiff : openDetail[p.id]);
			const argsOpen = (p) => (openArgs[p.id] === undefined ? !p.hasDiff : openArgs[p.id]);
			const toggle = (map, setMap, p, v) => setMap(Object.assign({}, map, { [p.id]: v }));
			// 点击文件名 → 打开右侧对比抽屉（父组件 OverlayRoot 持有 pin 状态）
			const openFile = (p, file) => {
				if (props && typeof props.onOpenFile === 'function') props.onOpenFile(p.id, file);
			};
			const argsBox = (p) => React.createElement('div', { className: 'pg-args' },
				React.createElement('span', { className: 'pg-args-tag' }, T('app.args')),
				(p.argLines && p.argLines.length)
					? p.argLines.map((l, i) => React.createElement('div', { key: i, className: 'pg-args-row' },
						React.createElement('span', { className: 'pg-args-label' }, l.label + '：'),
						l.path ? React.createElement('span', { className: 'pg-path-link', title: l.path, onClick: () => openFile(p, l.path) }, l.value)
							: React.createElement('span', { className: 'pg-args-val' }, l.value),
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
							return c.kind === 'read'
								? React.createElement(PGErrorBoundary, { resetKey: payloadKey(c), fallback: T('app.diffErr') }, React.createElement(ReadBlockMemo, { data: c, onOpenFile: (f) => openFile(p, f) }))
								: React.createElement(PGErrorBoundary, { resetKey: payloadKey(c), fallback: T('app.diffErr') }, React.createElement(DiffBlockMemo, { data: c, onOpenFile: (f) => openFile(p, f), changesOnly: true }))
						})() : null,
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
		function DiffBlock({ data, onOpenFile, onCollapse, changesOnly }) {
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
			if (data.fallback) {
				return React.createElement('div', { className: 'pg2-block' },
					React.createElement('div', { className: 'pg2-header' },
						React.createElement('span', { className: 'pg2-status', title: kindLabel }, badge),
						React.createElement('span', { className: 'pg2-path', title: data.file, onClick: () => onOpenFile && onOpenFile(data.file) }, data.file),
						React.createElement('span', { className: 'pg2-added' }, '+' + data.added),
						React.createElement('span', { className: 'pg2-removed' }, '-' + data.removed),
						copyBtn,
						expandBtn,
						collapseBtn,
					),
					eolNote,
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
					React.createElement('span', { className: 'pg2-path', title: data.file, onClick: () => onOpenFile && onOpenFile(data.file) }, data.file),
					React.createElement('span', { className: 'pg2-added' }, '+' + data.added),
					React.createElement('span', { className: 'pg2-removed' }, '-' + data.removed),
					copyBtn,
					expandBtn,
					collapseBtn,
				),
				eolNote,
				React.createElement('div', { className: 'pg2-body' }, rows),
			);
		}
		function ReadBlock({ data, onOpenFile, onCollapse }) {
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
					React.createElement('span', { className: 'pg2-path', title: data.file, onClick: () => onOpenFile && onOpenFile(data.file) }, data.file),
					React.createElement('span', { className: 'pg2-added' }, T('app.diffLines').replace('{n}', String(lines.length) + (topOmitted || bottomOmitted ? '+' : ''))),
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
			const onEdit = () => {
				setEditMsg(null);
				call('permgate:open-file', { id: pin.id }).then((r) => {
					setEditMsg(r && r.ok ? { ok: true, text: T('app.editOpened') } : { ok: false, text: (r && r.error) || T('app.diffErr') });
					setTimeout(() => setEditMsg(null), 2500);
				}).catch(() => {
					setEditMsg({ ok: false, text: T('app.diffErr') });
					setTimeout(() => setEditMsg(null), 2500);
				});
			};
			let body;
			if (data) {
				body = data.kind === 'read'
					? React.createElement(PGErrorBoundary, { fallback: T('app.diffErr') }, React.createElement(ReadBlockMemo, { data, onOpenFile: null, onCollapse: onClose }))
					: React.createElement(PGErrorBoundary, { fallback: T('app.diffErr') }, React.createElement(DiffBlockMemo, { data, onOpenFile: null, onCollapse: onClose }));
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
		function OverlayRoot() {
			const [pin, setPin] = React.useState(null);
			return React.createElement('div', null,
				React.createElement(PGErrorBoundary, { fallback: T('app.uiErr') },
					React.createElement(ApprovalOverlay, { onOpenFile: (id, file) => setPin({ id, file }) }),
				),
				pin ? React.createElement(PGErrorBoundary, { resetKey: pin.id, fallback: T('app.uiErr') },
					React.createElement(CompareDrawer, { pin, onClose: () => setPin(null) }),
				) : null,
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
			const [exReasonVal, setExReasonVal] = React.useState('');
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
				setExReasonVal('');
				invoke('permgate:add-exception', { target: tab, category: c, match: v, action: exAction, reason: exAction === 'deny' ? (String(exReasonVal || '').trim() || undefined) : undefined });
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
									r.action === 'deny' && r.reason ? React.createElement('span', { style: { fontSize: 12, color: '#c62828', marginLeft: 6 } }, '「' + r.reason + '」') : null,
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
							exAction === 'deny' ? React.createElement('input', { className: 'pg-field', style: { maxWidth: 220 }, placeholder: T('panel.excReasonPh'), title: T('panel.excReason'), value: exReasonVal, onChange: (e) => setExReasonVal(e.target.value), disabled: busy }) : null,
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
			if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="dsh-permgate-diff2"]') === null) {
				const tag = document.createElement('style');
				tag.dataset.plugin = 'dsh-permgate';
				tag.dataset.pluginCss = 'dsh-permgate-diff2';
				tag.textContent = DIFF2_CSS;
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
				OverlayRoot,
			));
		}

		exports.apply = apply;
		exports.inject = ['slots', 'locale'];
		return module.exports;
	}
});
