/**
 * 三 action × 三态 —— **按「态」分组给候选**（用户 2026-11-21）：
 *
 * > 「应该是每一个态里面给多个候选。你做一个候选，结果某个态里面跟别人的候选是一样的。没意义。
 * >   而我要选的时候会说哪个态选哪一个候选的。」
 *
 * ⇒ 结构：action 标签页 → 三个态分区 → 每个态里若干候选（编号 1/2/3）。
 *   每个候选**只描述一个态**，互不重复。
 *
 * 契约来源：`taskboard2/docs/02-action.md:259-266`（四态语义表）。
 */

import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { injectStyles } from '../../../src/styles.ts';
import { AskColumns, injectAskStyles } from '../ask-shape/main.tsx';

/* ══════════════════════════════════════════════════════════
   夹具
   ══════════════════════════════════════════════════════════ */

const TEXT_VALUE = '旧版新建页左栏是「模板 + 父任务」同一行；用户 2026-11-18 明确要求改成分行。';
const TEXT_HINT = '这一章写什么由你定，比如「为什么改」「改成什么样」。';
const MD_SOURCE = [
	'## 三个决定',
	'',
	'1. **pure 出表**，组件只 `map`',
	'2. `Section` 按 payload 的 `$type` **自己分派**',
	'3. 未知动作降级成可展开的原始 JSON',
	'',
	'```ts',
	'const view = sectionViewOf(payload);',
	'```',
].join('\n');

/* ══════════════════════════════════════════════════════════
   壳
   ══════════════════════════════════════════════════════════ */

/** 一个态的分区（标题 + 若干候选横排）。 */
function StateSection(props: {
	readonly action: string;
	readonly state: string;
	readonly contract: string;
	/** 单列全宽（ask 的三栏/纵向需要整行，不能被 300px 网格压窄）。 */
	readonly wide?: boolean;
	readonly children: React.ReactNode;
}): React.ReactNode {
	return (
		<section className="sp-section" data-state={props.state}>
			<header className="sp-section__head">
				<span className="sp-section__title">
					{props.action} · <code>{props.state}</code>
				</span>
				<span className="sp-section__contract">{props.contract}</span>
			</header>
			<div className={props.wide === true ? 'sp-cands sp-cands--wide' : 'sp-cands'}>
				{props.children}
			</div>
		</section>
	);
}

/** 一个候选（编号 + 说明 + 内容）。 */
function Cand(props: {
	readonly id: string;
	readonly note: string;
	readonly children: React.ReactNode;
}): React.ReactNode {
	return (
		<div className="sp-cand" data-cand-id={props.id}>
			<div className="sp-cand__head">
				<span className="sp-cand__id">候选 {props.id}</span>
				<span className="sp-cand__note">{props.note}</span>
			</div>
			<div className="sp-cand__body">{props.children}</div>
		</div>
	);
}

/* ══════════════════════════════════════════════════════════
   text · create
   ══════════════════════════════════════════════════════════ */

function TextCreateCands(): React.ReactNode {
	return (
		<>
			<Cand id="1" note="单框 + 「编辑声明」按钮（灰字按需展开）">
				<textarea className="sp-textarea" defaultValue={TEXT_VALUE} rows={3} />
				<div className="sp-actions">
					<button type="button" className="ghost-btn">
						编辑声明（灰字）
					</button>
				</div>
			</Cand>
			<Cand id="2" note="双框：正文 textarea + 声明 input，一眼看到两个字段">
				<div className="sp-label">正文</div>
				<textarea className="sp-textarea" defaultValue={TEXT_VALUE} rows={2} />
				<div className="sp-label">声明（灰字）</div>
				<input className="sp-input" defaultValue={TEXT_HINT} />
			</Cand>
			<Cand id="3" note="灰字做成可折叠区（默认只显示一行灰字，点开才编辑）">
				<textarea className="sp-textarea" defaultValue={TEXT_VALUE} rows={3} />
				<details className="sp-details">
					<summary>声明（灰字）：{TEXT_HINT.slice(0, 14)}…</summary>
					<input className="sp-input" defaultValue={TEXT_HINT} />
				</details>
			</Cand>
		</>
	);
}

/* ══════════════════════════════════════════════════════════
   text · active
   ══════════════════════════════════════════════════════════ */

function TextActiveCands(): React.ReactNode {
	return (
		<>
			<Cand id="1" note="单框：可编辑正文，灰字 = HTML placeholder">
				<textarea
					className="sp-textarea"
					defaultValue={TEXT_VALUE}
					placeholder={TEXT_HINT}
					rows={3}
				/>
			</Cand>
			<Cand id="2" note="正文 + 下面一行灰字说明（声明不占输入框）">
				<textarea className="sp-textarea" defaultValue={TEXT_VALUE} rows={2} />
				<div className="sp-decl">
					<span className="sp-decl__tag">声明</span>
					{TEXT_HINT}
				</div>
			</Cand>
		</>
	);
}

/* ══════════════════════════════════════════════════════════
   text · ended
   ══════════════════════════════════════════════════════════ */

function TextEndedCands(): React.ReactNode {
	return (
		<>
			<Cand id="1" note="两段显式：正文一块 + 声明一块（带标签、灰斜体）">
				<div className="sp-value">{TEXT_VALUE}</div>
				<div className="sp-decl">
					<span className="sp-decl__tag">声明</span>
					{TEXT_HINT}
				</div>
			</Cand>
			<Cand id="2" note="只读 textarea（保留框形状，内容和灰字都还在框里）">
				<textarea
					className="sp-textarea sp-textarea--ro"
					defaultValue={TEXT_VALUE}
					placeholder={TEXT_HINT}
					rows={3}
					readOnly
				/>
				<div className="sp-hint">⚠ 这一版就是你否掉的：框里分不清哪句是填的、哪句是声明</div>
			</Cand>
			<Cand id="3" note="正文 + 灰色小字声明（单行，不抢视线）">
				<div className="sp-value">{TEXT_VALUE}</div>
				<div className="sp-decl-inline">声明：{TEXT_HINT}</div>
			</Cand>
		</>
	);
}

/* ══════════════════════════════════════════════════════════
   markdown · create
   ══════════════════════════════════════════════════════════ */

function MarkdownCreateCands(): React.ReactNode {
	const [preview, setPreview] = useState(false);

	return (
		<>
			<Cand id="1" note="源码框 + 「查看预览」按钮（点开整块切换）">
				{preview ? (
					<div className="sp-md">
						<strong>三个决定</strong>
						<ol>
							<li>pure 出表，组件只 map</li>
							<li>Section 按 payload 的 $type 自己分派</li>
							<li>未知动作降级成可展开的原始 JSON</li>
						</ol>
					</div>
				) : (
					<textarea className="sp-textarea sp-textarea--mono" defaultValue={MD_SOURCE} rows={6} />
				)}
				<div className="sp-actions">
					<button
						type="button"
						className="ghost-btn"
						onClick={() => {
							setPreview(!preview);
						}}
					>
						{preview ? '← 回源码' : '查看预览'}
					</button>
				</div>
			</Cand>
			<Cand id="2" note="上下分栏：源码 + 预览同时可见（边写边看）">
				<textarea className="sp-textarea sp-textarea--mono" defaultValue={MD_SOURCE} rows={4} />
				<div className="sp-md">
					<strong>三个决定</strong>
					<ol>
						<li>pure 出表，组件只 map</li>
						<li>Section 按 payload 的 $type 自己分派</li>
					</ol>
				</div>
			</Cand>
		</>
	);
}

/* ══════════════════════════════════════════════════════════
   markdown · active / ended（同一份只读渲染，两个态各自列一次）
   ══════════════════════════════════════════════════════════ */

function MarkdownReadonlyCand(props: { readonly note: string }): React.ReactNode {
	return (
		<Cand id="1" note={props.note}>
			<div className="sp-md">
				<strong>三个决定</strong>
				<ol>
					<li>pure 出表，组件只 map</li>
					<li>Section 按 payload 的 $type 自己分派</li>
					<li>未知动作降级成可展开的原始 JSON</li>
				</ol>
				<pre className="sp-code">const view = sectionViewOf(payload);</pre>
			</div>
		</Cand>
	);
}

/* ══════════════════════════════════════════════════════════
   页面
   ══════════════════════════════════════════════════════════ */

function App(): React.ReactNode {
	const [tab, setTab] = useState<'text' | 'markdown' | 'ask'>('text');

	return (
		<div className="sp tb3w-root">
			<h1 className="sp-title">三 action × 三态 —— 按态给候选</h1>
			<div className="sp-sub">
				每个 <code>态</code> 下给若干候选，互不重复。你要选的时候说「text 的 create 选 2、active 选 1」这种。
			</div>

			<div className="sp-tabs" role="tablist">
				{([
					['text', 'text'],
					['markdown', 'markdown'],
					['ask', 'ask'],
				] as const).map(([id, label]) => (
					<button
						key={id}
						type="button"
						role="tab"
						aria-selected={tab === id}
						className={`sp-tab${tab === id ? ' is-on' : ''}`}
						onClick={() => {
							setTab(id);
						}}
					>
						{label}
					</button>
				))}
			</div>

			{tab === 'text' ? (
				<>
					<StateSection action="text" state="create" contract="草稿：编辑正文 + 灰字（声明）">
						<TextCreateCands />
					</StateSection>
					<StateSection action="text" state="active" contract="进行：内容可编辑，灰字 = placeholder">
						<TextActiveCands />
					</StateSection>
					<StateSection action="text" state="ended" contract="完成：只读，且要能分清填写字 / 灰字">
						<TextEndedCands />
					</StateSection>
				</>
			) : null}

			{tab === 'markdown' ? (
				<>
					<StateSection action="markdown" state="create" contract="草稿：源码框 + 查看预览">
						<MarkdownCreateCands />
					</StateSection>
					<StateSection action="markdown" state="active" contract="进行：只读渲染">
						<MarkdownReadonlyCand note="只读渲染（同时用于 active 和 ended，这里各列一次方便你指着选）" />
					</StateSection>
					<StateSection action="markdown" state="ended" contract="完成：只读渲染">
						<MarkdownReadonlyCand note="只读渲染（与 active 相同 —— 契约就没要求两态不同）" />
					</StateSection>
				</>
			) : null}

			{tab === 'ask' ? (
				<>
					<StateSection
						action="ask"
						state="create / active / ended"
						contract="三态同屏；点 active 栏的选项会真的切换"
						wide
					>
						<Cand id="1" note="三栏并排：create / active / ended 同屏（改 create 右边跟着变，点 active 选项会切换）">
							<AskColumns layout="grid" />
						</Cand>
					</StateSection>
				</>
			) : null}
		</div>
	);
}

injectStyles();
injectAskStyles();
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
	if (document.getElementById('sp-style') !== null) return;
	const STYLE = [
		'.sp{padding:20px 24px 60px;font:13px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#16181d;background:#fff;min-height:100%}',
		'.sp-title{font-size:18px;margin:0 0 4px}',
		'.sp-sub{color:#5f6673;font-size:12.5px;margin-bottom:22px}',
		'.sp-tabs{display:flex;gap:6px;margin-bottom:22px;padding-bottom:10px;border-bottom:1px solid #eef0f3}',
		'.sp-tab{padding:6px 16px;border:1px solid #d7dbe2;border-radius:7px;background:#fff;color:#5f6673;font:12px/1 inherit;cursor:pointer}',
		'.sp-tab.is-on{background:#16181d;border-color:#16181d;color:#fff;font-weight:600}',
		'.sp-section{margin-bottom:26px}',
		'.sp-section__head{display:flex;align-items:baseline;gap:12px;padding:8px 0 10px;border-bottom:2px solid #e0e4ea;margin-bottom:12px}',
		'.sp-section__title{font-size:13px;font-weight:700}',
		'.sp-section__contract{color:#5f6673;font-size:11.5px}',
		'.sp-cands{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px;align-items:start}',
		'.sp-cands--wide{grid-template-columns:1fr}',
		'.sp-cand{border:1px solid #e7e9ee;border-radius:9px;overflow:hidden;min-width:0;background:#fff}',
		'.sp-cand__head{display:flex;align-items:baseline;gap:8px;padding:7px 10px;background:#f7f8fa;border-bottom:1px solid #eef0f3}',
		'.sp-cand__id{font-weight:700;font-size:11.5px;color:#2563eb;white-space:nowrap}',
		'.sp-cand__note{color:#5f6673;font-size:11px}',
		'.sp-cand__body{padding:10px;display:flex;flex-direction:column;gap:6px}',
		'.sp-label{font-size:10.5px;color:#9aa1ad}',
		'.sp-textarea{width:100%;box-sizing:border-box;padding:7px 9px;border:1px solid #d7dbe2;border-radius:6px;font:12px/1.5 inherit;resize:vertical;background:#fff}',
		'.sp-textarea--mono{font-family:ui-monospace,Consolas,monospace;font-size:11px}',
		'.sp-textarea--ro{background:#fafbfc;color:#5f6673}',
		'.sp-input{width:100%;box-sizing:border-box;padding:6px 9px;border:1px dashed #c7cdd6;border-radius:6px;font:12px/1.5 inherit;background:#fafbfc}',
		'.sp-hint{font-size:10.5px;color:#b45309}',
		'.sp-actions{display:flex;gap:6px;margin-top:2px}',
		'.sp-value{padding:8px 10px;border:1px solid #e7e9ee;border-radius:6px;background:#fff;font-size:12px;line-height:1.6}',
		'.sp-decl{padding:6px 9px;border:1px dashed #d7dbe2;border-radius:6px;background:#fafbfc;color:#9aa1ad;font-size:11px;font-style:italic}',
		'.sp-decl__tag{display:inline-block;margin-right:5px;padding:0 5px;border-radius:3px;background:#f3f4f6;color:#5f6673;font-size:10px;font-style:normal}',
		'.sp-decl-inline{font-size:10.5px;color:#9aa1ad}',
		'.sp-details{border:1px dashed #c7cdd6;border-radius:6px;padding:5px 8px;background:#fafbfc}',
		'.sp-details summary{cursor:pointer;font-size:11px;color:#5f6673}',
		'.sp-md{border:1px solid #eef0f3;border-radius:6px;padding:9px 11px;background:#fcfcfd;font-size:12px}',
		'.sp-md ol{margin:5px 0 0;padding-left:20px}',
		'.sp-code{margin:7px 0 0;padding:7px;border-radius:5px;background:#f3f4f6;font-family:ui-monospace,Consolas,monospace;font-size:10.5px;overflow:auto}',
	].join('\n');
	const style = document.createElement('style');
	style.id = 'sp-style';
	style.textContent = STYLE;
	document.head.appendChild(style);
}
