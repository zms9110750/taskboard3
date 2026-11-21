/**
 * AI tool 的预览页 —— **给用户审查 16 个工具的定义**。
 *
 * ```
 * node dev/preview/build.mjs ai-tools
 * ```
 *
 * ⚠ 这一页只展示**定义**（名字 / 描述 / inputSchema），不执行工具。
 * 执行行为要看真实调用，不在这一页。
 *
 * 用户 2026-11-21：「还有刚刚那个写 ai tool 的，我也没有审查行为。」
 */

import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { createTaskboardTools } from '@taskboard/tools';
import type { Taskboard } from '@taskboard/core';

/*
 * 只取工具定义 ⇒ 不需要真的 Taskboard 实例（工厂只把引用存起来，不在这里调用）。
 * 真要用的话由宿主传进来。
 */
const TOOLS = createTaskboardTools({} as Taskboard);

/** 一个工具卡片。 */
function ToolCard(props: { readonly index: number; readonly tool: (typeof TOOLS)[number] }): React.ReactNode {
	const [open, setOpen] = useState(false);
	const tool = props.tool;

	return (
		<div className="at-card" data-tool={tool.name}>
			<button type="button" className="at-card__head" onClick={() => setOpen(!open)}>
				<span className="at-card__idx">{String(props.index + 1).padStart(2, '0')}</span>
				<span className="at-card__name">{tool.name}</span>
				<span className="at-card__toggle">{open ? '收起 schema' : '看 schema'}</span>
			</button>
			<div className="at-card__desc">{tool.description}</div>
			{open ? <pre className="at-card__schema">{JSON.stringify(tool.inputSchema, null, 2)}</pre> : null}
		</div>
	);
}

function App(): React.ReactNode {
	return (
		<div className="at">
			<h1 className="at-title">AI tool · 16 个工具定义</h1>
			<div className="at-sub">
				<code>@taskboard/tools</code> 里每个工具 = 名字 + 描述 + JSON Schema + handler。
				这一页只给看**定义**；执行行为要真实调用，不在预览里。
			</div>

			<div className="at-note">
				<b>要你确认的：</b>
				① 名字对不对（模型靠它选工具）② 描述清不清楚（模型靠它判断该不该用）
				③ 参数 schema 够不够 / 多不多 ④ 返回文案看得懂吗
			</div>

			<div className="at-list">
				{TOOLS.map((tool, i) => (
					<ToolCard key={tool.name} index={i} tool={tool} />
				))}
			</div>
		</div>
	);
}

injectPageStyles();

const root = document.getElementById('root');
if (root !== null) {
	createRoot(root).render(
		<StrictMode>
			<App />
		</StrictMode>,
	);
}

function injectPageStyles(): void {
	if (document.getElementById('at-style') !== null) return;
	const STYLE = [
		'.at{padding:20px 24px 60px;font:13px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#16181d;background:#fff;min-height:100%}',
		'.at-title{font-size:18px;margin:0 0 4px}',
		'.at-sub{color:#5f6673;font-size:12.5px;margin-bottom:14px}',
		'.at-note{padding:9px 12px;border:1px solid #fde68a;border-radius:8px;background:#fffbeb;color:#92400e;font-size:12px;margin-bottom:18px}',
		'.at-list{display:flex;flex-direction:column;gap:8px}',
		'.at-card{border:1px solid #e7e9ee;border-radius:9px;overflow:hidden}',
		'.at-card__head{display:flex;align-items:center;gap:10px;width:100%;padding:8px 12px;border:0;background:#f7f8fa;text-align:left;font:inherit;cursor:pointer}',
		'.at-card__head:hover{background:#eef2f7}',
		'.at-card__idx{color:#9aa1ad;font-family:ui-monospace,Consolas,monospace;font-size:11px}',
		'.at-card__name{flex:1 1 auto;font-weight:600;font-family:ui-monospace,Consolas,monospace;font-size:12.5px;color:#2563eb}',
		'.at-card__toggle{color:#5f6673;font-size:11px}',
		'.at-card__desc{padding:7px 12px;font-size:12px;color:#374151;border-top:1px solid #eef0f3}',
		'.at-card__schema{margin:0;padding:10px 12px;background:#fafbfc;border-top:1px solid #eef0f3;font-family:ui-monospace,Consolas,monospace;font-size:11px;line-height:1.55;overflow:auto;max-height:320px}',
	].join('\n');
	const style = document.createElement('style');
	style.id = 'at-style';
	style.textContent = STYLE;
	document.head.appendChild(style);
}
