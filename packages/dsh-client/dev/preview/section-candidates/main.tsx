/**
 * text / markdown 的**三相位候选** —— 用户 2026-11-20：
 *
 * > 「其他的两个你写预览组建给我选。有对个想法的就写多个后选组建」
 *
 * `ask` 的形状已经单独出 SVG（`ask-shape.svg`）。这一页只做 `text` / `markdown`，
 * 每个各两个候选实现，每个候选并排展示 create / active / ended 三相位。
 *
 * ## 契约来源
 *
 * `taskboard2/docs/02-action.md:259-266`（四态语义表）：
 *
 * | 相位 | text | markdown |
 * |---|---|---|
 * | create（草稿）| 默认编辑正文（textarea）+ 灰字可切换编辑 | 源码框 + 「查看预览」按钮 |
 * | active（进行）| 灰字 = textarea 的 HTML placeholder + 内容可编辑 | 只读渲染 |
 * | ended（完成）| 只读 textarea + 同样带 placeholder；允许刮取复制 | 只读渲染 |
 *
 * ⚠ 这是**候选**，不是产品实现 —— 全部手写在预览里，为了让你挑形状。
 */

import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { injectStyles } from '../../../src/styles.ts';

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

/** 一个候选块的壳。 */
function Case(props: {
	readonly title: string;
	readonly note: string;
	readonly children: React.ReactNode;
}): React.ReactNode {
	return (
		<section className="sc-case">
			<header className="sc-case__head">
				<span className="sc-case__title">{props.title}</span>
				<span className="sc-case__note">{props.note}</span>
			</header>
			<div className="sc-case__body">{props.children}</div>
		</section>
	);
}

/** 一个相位格。 */
function Phase(props: {
	readonly name: string;
	readonly tag: string;
	readonly children: React.ReactNode;
}): React.ReactNode {
	return (
		<div className="sc-phase" data-phase={props.tag}>
			<div className="sc-phase__name">
				{props.name} <code>{props.tag}</code>
			</div>
			<div className="sc-phase__body">{props.children}</div>
		</div>
	);
}

/* ══════════════════════════════════════════════════════════
   text 候选 A：单一 textarea（三相位只换 readOnly / placeholder）
   ══════════════════════════════════════════════════════════ */

function TextCandidateA(): React.ReactNode {
	return (
		<Case
			title="text · 候选 A —— 单一 textarea"
			note="三相位只有 readOnly / placeholder / 可编辑三处不同，元素类型不变"
		>
			<Phase name="create" tag="create">
				<div className="sc-field">
					<textarea
						className="sc-textarea"
						defaultValue={TEXT_VALUE}
						placeholder={TEXT_HINT}
						rows={3}
					/>
					<div className="sc-hint">正文可编辑 · 灰字是 placeholder（清空后仍在）</div>
				</div>
			</Phase>
			<Phase name="active" tag="active">
				<div className="sc-field">
					<textarea
						className="sc-textarea"
						defaultValue={TEXT_VALUE}
						placeholder={TEXT_HINT}
						rows={3}
					/>
					<div className="sc-hint">可编辑 · 灰字同样是 placeholder</div>
				</div>
			</Phase>
			<Phase name="ended" tag="ended">
				<div className="sc-field">
					<textarea
						className="sc-textarea sc-textarea--readonly"
						defaultValue={TEXT_VALUE}
						placeholder={TEXT_HINT}
						rows={3}
						readOnly
					/>
					<div className="sc-hint">只读 textarea · 灰字仍在 · 可选中复制</div>
				</div>
			</Phase>
		</Case>
	);
}

/* ══════════════════════════════════════════════════════════
   text 候选 B：create 双框（正文 + 灰字分开），active/ended 单框
   ══════════════════════════════════════════════════════════ */

function TextCandidateB(): React.ReactNode {
	return (
		<Case
			title="text · 候选 B —— create 拆成「正文 + 灰字」两个框"
			note="草稿时把「答案」和「声明（灰字）」显式分开；进 active 后合并成一个框"
		>
			<Phase name="create" tag="create">
				<div className="sc-field">
					<textarea className="sc-textarea" defaultValue={TEXT_VALUE} rows={2} />
					<div className="sc-hint">↑ 正文（答案）</div>
					<input className="sc-input" defaultValue={TEXT_HINT} />
					<div className="sc-hint">↑ 灰字（声明）—— 清空正文后它会显示在空框里</div>
				</div>
			</Phase>
			<Phase name="active" tag="active">
				<div className="sc-field">
					<textarea
						className="sc-textarea"
						defaultValue={TEXT_VALUE}
						placeholder={TEXT_HINT}
						rows={3}
					/>
					<div className="sc-hint">合成一个框 · 灰字变 placeholder</div>
				</div>
			</Phase>
			<Phase name="ended" tag="ended">
				<div className="sc-field">
					<textarea
						className="sc-textarea sc-textarea--readonly"
						defaultValue={TEXT_VALUE}
						placeholder={TEXT_HINT}
						rows={3}
						readOnly
					/>
					<div className="sc-hint">只读 textarea · 灰字仍在</div>
				</div>
			</Phase>
		</Case>
	);
}

/* ══════════════════════════════════════════════════════════
   markdown 候选 A：源码框 + 「查看预览」按钮（点开整块切换）
   ══════════════════════════════════════════════════════════ */

function MarkdownCandidateA(): React.ReactNode {
	const [preview, setPreview] = useState(false);

	return (
		<Case
			title="markdown · 候选 A —— 源码框 + 「查看预览」按钮"
			note="create 只给源码框，点按钮整块切成预览；active/ended 直接是渲染结果"
		>
			<Phase name="create" tag="create">
				<div className="sc-field">
					{preview ? (
						<div className="sc-md sc-md--rendered">
							<strong>三个决定</strong>
							<ol>
								<li>pure 出表，组件只 map</li>
								<li>Section 按 payload 的 $type 自己分派</li>
								<li>未知动作降级成可展开的原始 JSON</li>
							</ol>
						</div>
					) : (
						<textarea
							className="sc-textarea sc-textarea--mono"
							defaultValue={MD_SOURCE}
							rows={7}
						/>
					)}
					<div className="sc-actions">
						<button type="button" className="ghost-btn" onClick={() => setPreview(!preview)}>
							{preview ? '← 回源码' : '查看预览'}
						</button>
					</div>
				</div>
			</Phase>
			<Phase name="active" tag="active">
				<div className="sc-md sc-md--rendered">
					<strong>三个决定</strong>
					<ol>
						<li>pure 出表，组件只 map</li>
						<li>Section 按 payload 的 $type 自己分派</li>
						<li>未知动作降级成可展开的原始 JSON</li>
					</ol>
					<pre className="sc-code">const view = sectionViewOf(payload);</pre>
				</div>
			</Phase>
			<Phase name="ended" tag="ended">
				<div className="sc-md sc-md--rendered sc-md--readonly">
					<strong>三个决定</strong>
					<ol>
						<li>pure 出表，组件只 map</li>
						<li>Section 按 payload 的 $type 自己分派</li>
						<li>未知动作降级成可展开的原始 JSON</li>
					</ol>
					<pre className="sc-code">const view = sectionViewOf(payload);</pre>
				</div>
			</Phase>
		</Case>
	);
}

/* ══════════════════════════════════════════════════════════
   markdown 候选 B：上下分栏（源码 + 预览同时可见）
   ══════════════════════════════════════════════════════════ */

function MarkdownCandidateB(): React.ReactNode {
	const [split, setSplit] = useState(true);

	return (
		<Case
			title="markdown · 候选 B —— create 上下分栏（源码 + 预览同时可见）"
			note="草稿时边写边看；active/ended 与 A 相同"
		>
			<Phase name="create" tag="create">
				<div className="sc-field">
					{split ? (
						<>
							<textarea
								className="sc-textarea sc-textarea--mono"
								defaultValue={MD_SOURCE}
								rows={5}
							/>
							<div className="sc-md sc-md--rendered sc-md--below">
								<strong>三个决定</strong>
								<ol>
									<li>pure 出表，组件只 map</li>
									<li>Section 按 payload 的 $type 自己分派</li>
									<li>未知动作降级成可展开的原始 JSON</li>
								</ol>
							</div>
						</>
					) : (
						<textarea
							className="sc-textarea sc-textarea--mono"
							defaultValue={MD_SOURCE}
							rows={7}
						/>
					)}
					<div className="sc-actions">
						<button type="button" className="ghost-btn" onClick={() => setSplit(!split)}>
							{split ? '只看源码' : '源码 + 预览'}
						</button>
					</div>
				</div>
			</Phase>
			<Phase name="active" tag="active">
				<div className="sc-md sc-md--rendered">
					<strong>三个决定</strong>
					<ol>
						<li>pure 出表，组件只 map</li>
						<li>Section 按 payload 的 $type 自己分派</li>
						<li>未知动作降级成可展开的原始 JSON</li>
					</ol>
					<pre className="sc-code">const view = sectionViewOf(payload);</pre>
				</div>
			</Phase>
			<Phase name="ended" tag="ended">
				<div className="sc-md sc-md--rendered sc-md--readonly">
					<strong>三个决定</strong>
					<ol>
						<li>pure 出表，组件只 map</li>
						<li>Section 按 payload 的 $type 自己分派</li>
						<li>未知动作降级成可展开的原始 JSON</li>
					</ol>
					<pre className="sc-code">const view = sectionViewOf(payload);</pre>
				</div>
			</Phase>
		</Case>
	);
}

/* ══════════════════════════════════════════════════════════
   页面
   ══════════════════════════════════════════════════════════ */

function App(): React.ReactNode {
	return (
		<div className="sc">
			<h1 className="sc-title">text / markdown · 三相位候选</h1>
			<div className="sc-sub">
				每个 action 两个候选实现，各并排展示 create / active / ended。
				契约来源 <code>taskboard2/docs/02-action.md:259-266</code>。
			</div>
			<TextCandidateA />
			<TextCandidateB />
			<MarkdownCandidateA />
			<MarkdownCandidateB />
		</div>
	);
}

injectStyles();
injectCandidateStyles();

const root = document.getElementById('root');
if (root !== null) {
	createRoot(root).render(
		<StrictMode>
			<App />
		</StrictMode>,
	);
}

/** 本页骨架样式（候选自己的形状，不是产品样式）。 */
function injectCandidateStyles(): void {
	if (document.getElementById('sc-style') !== null) return;
	const STYLE = [
		'.sc{padding:20px 24px 60px;font:13px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#16181d;background:#fff;min-height:100%}',
		'.sc-title{font-size:18px;margin:0 0 4px}',
		'.sc-sub{color:#5f6673;font-size:12.5px;margin-bottom:22px}',
		'.sc-case{border:1px solid #e7e9ee;border-radius:10px;margin-bottom:18px;overflow:hidden}',
		'.sc-case__head{display:flex;align-items:baseline;gap:10px;padding:9px 12px;background:#f7f8fa;border-bottom:1px solid #e7e9ee}',
		'.sc-case__title{font-weight:600;font-size:12.5px}',
		'.sc-case__note{color:#5f6673;font-size:11.5px}',
		'.sc-case__body{display:grid;grid-template-columns:repeat(3,1fr);gap:0}',
		'.sc-phase{border-right:1px solid #eef0f3;padding:12px;min-width:0}',
		'.sc-phase:last-child{border-right:0}',
		'.sc-phase__name{font-size:11px;color:#5f6673;margin-bottom:8px;font-family:ui-monospace,Consolas,monospace}',
		'.sc-phase__name code{background:#f3f4f6;padding:0 4px;border-radius:3px}',
		'.sc-field{display:flex;flex-direction:column;gap:6px}',
		'.sc-textarea{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #d7dbe2;border-radius:7px;font:12px/1.55 inherit;color:#16181d;background:#fff;resize:vertical}',
		'.sc-textarea--mono{font-family:ui-monospace,Consolas,monospace;font-size:11.5px}',
		'.sc-textarea--readonly{background:#fafbfc;color:#5f6673;cursor:default}',
		'.sc-input{width:100%;box-sizing:border-box;padding:6px 10px;border:1px dashed #c7cdd6;border-radius:7px;font:12px/1.55 inherit;background:#fafbfc}',
		'.sc-hint{font-size:11px;color:#9aa1ad}',
		'.sc-actions{display:flex;gap:8px}',
		'.sc-md{border:1px solid #eef0f3;border-radius:7px;padding:10px 12px;background:#fcfcfd;font-size:12px}',
		'.sc-md--below{margin-top:6px}',
		'.sc-md--readonly{background:#fafbfc;color:#5f6673}',
		'.sc-md ol{margin:6px 0 0;padding-left:20px}',
		'.sc-md li{margin:2px 0}',
		'.sc-code{margin:8px 0 0;padding:8px;border-radius:5px;background:#f3f4f6;font-family:ui-monospace,Consolas,monospace;font-size:11px;overflow:auto}',
	].join('\n');
	const style = document.createElement('style');
	style.id = 'sc-style';
	style.textContent = STYLE;
	document.head.appendChild(style);
}
