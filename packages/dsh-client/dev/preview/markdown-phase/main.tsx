/**
 * `markdown` action 的三相位预览 —— **真组件 + 真 state**。
 *
 * ```
 * node dev/preview/build.mjs markdown-phase
 * node dev/preview/markdown-phase/verify.mjs
 * ```
 *
 * ⚠ 和隔壁 `dev/preview/markdown/` 不是一回事：
 *   - `markdown/` 测的是 **Markdown 渲染器本身**（GFM 语法 + XSS 净化）
 *   - 这里测的是 **markdown action 的三相位**（create 源码框 / active+ended 只读渲染）
 *
 * 已采纳的形态：
 *   create ⇒ 源码框 + 「查看预览」按钮（点开整块切换）
 *   active / ended ⇒ 只读渲染
 *
 * 三栏共享同一份 payload —— 改 create 的源码，active / ended 立刻跟着变。
 */

import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

/* 注册表初始化 —— Section 的内容分发查的是运行时注册表（2026-11-22）。 */
import { initRenderers } from '../../../src/init-renderers.ts';

import { Section, type SectionPhase } from '../../../src/renderers/Section.tsx';
import { injectStyles } from '../../../src/styles.ts';

const LABEL = '改了什么';
const INITIAL: Record<string, unknown> = {
	$type: 'markdown',
	value: [
		'## 三个决定',
		'',
		'1. **pure 出表**，组件只 `map`',
		'2. `Section` 按 payload 的 `$type` **自己分派**',
		'3. 未知动作降级成可展开的原始 JSON',
		'',
		'```ts',
		'const view = sectionViewOf(payload);',
		'```',
	].join('\n'),
	placeholder: '用 markdown 写，比如「为什么改」「改成什么样」。',
};

/**
 * 一栏 = 一个相位。
 *
 * @param props phase / payload / onPatch
 */
function Phase(props: {
	readonly phase: SectionPhase;
	readonly payload: Record<string, unknown>;
	readonly onPatch: (patch: Record<string, unknown>) => void;
}): React.ReactNode {
	const editable = props.phase === 'create';

	return (
		<section className="mdp-col" data-phase={props.phase}>
			<header className="mdp-col__head">
				<span className="mdp-col__name">{props.phase}</span>
				<span className="mdp-col__note">
					{props.phase === 'create'
						? '可编辑：源码框 + 「查看预览」'
						: '只读渲染（和 active 一样，契约没要求不同）'}
				</span>
			</header>
			<div className="mdp-stage">
				<Section
					sectionId={`${props.phase}-markdown`}
					section={{ label: LABEL, payload: props.payload }}
					phase={props.phase}
					readonly={!editable}
					{...(editable ? { onChange: (_id: string, patch: Record<string, unknown>) => props.onPatch(patch) } : {})}
				/>
			</div>
		</section>
	);
}

function App(): React.ReactNode {
	const [payload, setPayload] = useState<Record<string, unknown>>(INITIAL);

	return (
		<div className="mdp tb3w-root">
			<h1 className="mdp-title">markdown · 三相位</h1>
			<div className="mdp-sub">
				用的是产品组件 <code>Section</code>（内部 <code>MarkdownBlock</code>）。三栏共享同一份 payload
				—— create 里改源码，active / ended 立刻跟着变。
			</div>

			<div className="mdp-grid">
				<Phase
					phase="create"
					payload={payload}
					onPatch={(patch) => {
						setPayload((current) => ({ ...current, ...patch }));
					}}
				/>
				<Phase phase="active" payload={payload} onPatch={() => undefined} />
				<Phase phase="ended" payload={payload} onPatch={() => undefined} />
			</div>

			<div className="mdp-json">
				<div className="mdp-json__label">当前 payload（实时）</div>
				<pre className="mdp-json__body">{JSON.stringify(payload, null, 2)}</pre>
			</div>
		</div>
	);
}

injectStyles();
injectPageStyles();

initRenderers();
const root = document.getElementById('root');
if (root !== null) {
	createRoot(root).render(
		<StrictMode>
			<App />
		</StrictMode>,
	);
}

function injectPageStyles(): void {
	if (document.getElementById('mdp-style') !== null) return;
	const STYLE = [
		'.mdp{padding:20px 24px 60px;font:13px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#16181d;background:#fff;min-height:100%}',
		'.mdp-title{font-size:18px;margin:0 0 4px}',
		'.mdp-sub{color:#5f6673;font-size:12.5px;margin-bottom:20px}',
		'.mdp-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;align-items:start}',
		'.mdp-col{border:1px solid #e7e9ee;border-radius:9px;overflow:hidden;min-width:0}',
		'.mdp-col__head{display:flex;flex-direction:column;gap:1px;padding:8px 10px;background:#f7f8fa;border-bottom:1px solid #eef0f3}',
		'.mdp-col__name{font-weight:700;font-size:12px}',
		'.mdp-col__note{color:#5f6673;font-size:10.5px}',
		'.mdp-stage{padding:10px;min-height:200px}',
		'.mdp-json{margin-top:20px;border:1px solid #e7e9ee;border-radius:9px;overflow:hidden}',
		'.mdp-json__label{padding:6px 10px;background:#f7f8fa;border-bottom:1px solid #eef0f3;font-size:11px;color:#5f6673}',
		'.mdp-json__body{margin:0;padding:10px;font-family:ui-monospace,Consolas,monospace;font-size:11px;line-height:1.6;overflow:auto;max-height:220px}',
	].join('\n');
	const style = document.createElement('style');
	style.id = 'mdp-style';
	style.textContent = STYLE;
	document.head.appendChild(style);
}
