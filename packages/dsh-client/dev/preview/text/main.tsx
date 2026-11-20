/**
 * `text` 组件的独立预览 —— **真组件 + 真 state**。
 *
 * ```
 * node dev/preview/build.mjs text
 * node dev/preview/text/verify.mjs
 * ```
 *
 * ⚠ 这里不画「候选」：三相位用的都是产品里那个 `Section`（内部 `TextBlock`），
 * 每一栏都能真的编辑，改了立刻回写同一份 payload ——
 * 所以「折叠栏的灰字」和「正文框」是**同一份数据**，不会各写各的。
 *
 * 用户 2026-11-21：
 * > 「我要看到正确的行为而不是写死的不可交互的文字的演示。
 * >   例如 text · create 候选 3，那个折叠栏上面是有字的，但是没有跟下面的输入框同步文字。
 * >   这个肯定不是预期行为。」
 */

import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { Section, type SectionPhase } from '../../../src/renderers/Section.tsx';
import { injectStyles } from '../../../src/styles.ts';

/* ══════════════════════════════════════════════════════════
   夹具（模板里这一章的默认 payload）
   ══════════════════════════════════════════════════════════ */

const LABEL = '一句话描述';
const INITIAL: Record<string, unknown> = {
	$type: 'text',
	value: '旧版新建页左栏是「模板 + 父任务」同一行；用户 2026-11-18 明确要求改成分行。',
	placeholder: '这一章写什么由你定，比如「为什么改」「改成什么样」。',
};

/* ══════════════════════════════════════════════════════════
   一栏
   ══════════════════════════════════════════════════════════ */

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
	const editable = props.phase !== 'ended';

	return (
		<section className="tx-col" data-phase={props.phase}>
			<header className="tx-col__head">
				<span className="tx-col__name">{props.phase}</span>
				<span className="tx-col__note">
					{props.phase === 'create'
						? '可编辑：正文 + 折叠区里的灰字（声明）'
						: props.phase === 'active'
							? '可编辑：正文；灰字 = 空框时的 placeholder'
							: '只读：正文 + 灰字都在框里'}
				</span>
			</header>
			<div className="tx-stage">
				<Section
					sectionId={`${props.phase}-text`}
					section={{ label: LABEL, payload: props.payload }}
					phase={props.phase}
					readonly={!editable}
					{...(editable ? { onChange: (_id: string, patch: Record<string, unknown>) => props.onPatch(patch) } : {})}
				/>
			</div>
		</section>
	);
}

/* ══════════════════════════════════════════════════════════
   页面
   ══════════════════════════════════════════════════════════ */

function App(): React.ReactNode {
	/* **一份** payload 喂三栏 —— 改任何一栏，另外两栏跟着变。 */
	const [payload, setPayload] = useState<Record<string, unknown>>(INITIAL);

	return (
		<div className="tx tb3w-root">
			<h1 className="tx-title">text · 三相位</h1>
			<div className="tx-sub">
				用的是产品组件 <code>Section</code>（内部 <code>TextBlock</code>）。三栏共享同一份 payload
				—— create 里改正文或折叠区的灰字，active / ended 立刻跟着变。
			</div>

			<div className="tx-grid">
				<Phase
					phase="create"
					payload={payload}
					onPatch={(patch) => {
						setPayload((current) => ({ ...current, ...patch }));
					}}
				/>
				<Phase
					phase="active"
					payload={payload}
					onPatch={(patch) => {
						setPayload((current) => ({ ...current, ...patch }));
					}}
				/>
				<Phase phase="ended" payload={payload} onPatch={() => undefined} />
			</div>

			<div className="tx-json">
				<div className="tx-json__label">当前 payload（实时）</div>
				<pre className="tx-json__body">{JSON.stringify(payload, null, 2)}</pre>
			</div>
		</div>
	);
}

injectStyles();
injectPageStyles();

const root = document.getElementById('root');
if (root !== null) {
	createRoot(root).render(
		<StrictMode>
			<App />
		</StrictMode>,
	);
}

/** 本页骨架样式。 */
function injectPageStyles(): void {
	if (document.getElementById('tx-style') !== null) return;
	const STYLE = [
		'.tx{padding:20px 24px 60px;font:13px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#16181d;background:#fff;min-height:100%}',
		'.tx-title{font-size:18px;margin:0 0 4px}',
		'.tx-sub{color:#5f6673;font-size:12.5px;margin-bottom:20px}',
		'.tx-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;align-items:start}',
		'.tx-col{border:1px solid #e7e9ee;border-radius:9px;overflow:hidden;min-width:0}',
		'.tx-col__head{display:flex;flex-direction:column;gap:1px;padding:8px 10px;background:#f7f8fa;border-bottom:1px solid #eef0f3}',
		'.tx-col__name{font-weight:700;font-size:12px}',
		'.tx-col__note{color:#5f6673;font-size:10.5px}',
		'.tx-stage{padding:10px;min-height:180px}',
		'.tx-json{margin-top:20px;border:1px solid #e7e9ee;border-radius:9px;overflow:hidden}',
		'.tx-json__label{padding:6px 10px;background:#f7f8fa;border-bottom:1px solid #eef0f3;font-size:11px;color:#5f6673}',
		'.tx-json__body{margin:0;padding:10px;font-family:ui-monospace,Consolas,monospace;font-size:11px;line-height:1.6;overflow:auto}',
	].join('\n');
	const style = document.createElement('style');
	style.id = 'tx-style';
	style.textContent = STYLE;
	document.head.appendChild(style);
}
