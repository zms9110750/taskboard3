/**
 * Section 预览入口 —— **只在 `dev/preview/section/` 里，不碰根 `main.tsx`**。
 *
 * 四块：
 *
 * ① **活的一章**（受控）—— 用来验「点选项真的会回调、父层改了 payload 界面跟着变」。
 * ② **静态矩阵** —— 每一种 payload 形状 / 边界各一格，断言直接读 DOM。
 * ③ **回调日志** —— 点了什么就是什么（`data-event`）。
 * ④ **语法表** —— markdown 现在支持什么、不支持什么（给用户看）。
 *
 * 静态矩阵存在的原因：想验「只读时点了什么都不发」「label 为空不画标题行」
 * 这种**否定**断言，用活的一章得点好几步才能进入那个状态。
 */

import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

/* 注册表初始化 —— Section 的内容分发查的是运行时注册表（2026-11-22）。 */
import { initRenderers } from '../../../src/init-renderers.ts';

import { Section } from '../../../src/renderers/Section.tsx';
import { applyAskAction, type AskAction } from '../../../src/pure/section.ts';
/*
 * 产品样式由 `injectStyles()` 在运行时注入 —— **预览和产品是同一份 CSS**
 * （`SECTION_CSS` + 降级块的 `FALLBACK_CSS`）。不调用它就是裸 HTML；
 * 调用之后 `style.css` 只留预览外壳。
 */
import { injectStyles } from '../../../src/styles.ts';
import type { CardSection } from '../../../src/types.ts';

/* ── 夹具：payload 逐字抄自 packages/core/templates/*.yaml ── */

const TEXT_EMPTY: CardSection = {
	label: '选择什么架构',
	payload: { $type: 'text', placeholder: '选什么架构，为什么' },
};

const TEXT_FILLED: CardSection = {
	label: '选择什么架构',
	payload: {
		$type: 'text',
		value: '服务器 + 客户端，消息走异步流。\n第二行（text 保留换行与缩进）。\n\t缩进也保留。',
		placeholder: '选什么架构，为什么',
	},
};

const MARKDOWN_FILLED: CardSection = {
	label: '留档内容',
	payload: {
		$type: 'markdown',
		value: [
			'这行是普通文字。',
			'',
			'这行有 **粗体**、`内联代码`，还有 **多个 粗体**。',
			'未闭合的 ** 保持字面：2 ** 3 = 8。',
			/* 只有一个反引号 ⇒ 不闭合，保持字面（写两个就会变成正常代码段）。 */
			'单个反引号 ` 也保持字面。',
			'HTML 标签原样当文字：<b>不该变粗</b> <img src=x onerror=alert(1)>',
			'标题 # 不支持，会原样显示。',
		].join('\n'),
		placeholder: '把要保留的资料放在这里',
	},
};

const MARKDOWN_EMPTY: CardSection = {
	label: '留档内容',
	payload: { $type: 'markdown', placeholder: '把要保留的资料放在这里' },
};

/** 真实 ask（expectedMismatch.yaml 的「为什么这么想」，6 个选项）。 */
const ASK_OPTIONS = [
	{ label: '望文生义', description: '从语义说，这个东西在这里长这样就应该这样做才有道理' },
	{ label: '同类产品', description: '具有类似功能的项目实现，具有这样的行为' },
	{ label: '附随文档', description: '这个项目自己表示会这样说，包括更新说明和readme' },
	{ label: '社区传阅', description: '有wiki，或视频平台，论坛，有记录的表明很多人这样认为' },
	{ label: '历史惯性', description: '曾经是这样的行为，更新没说会变，但变了' },
	{ label: '官方暗示', description: '开发者访谈，笔记，博客。或是维护者在社区宣称，支持，某个功能在现版本发布' },
];

/** 造一个 ask 章节（`picked` / `multi_select` 可变）。 */
function askSection(picked?: readonly string[], multi = false): CardSection {
	const item: Record<string, unknown> = {
		question: '这个预期的依据',
		multi_select: multi,
		options: ASK_OPTIONS,
	};
	if (picked !== undefined) item['picked'] = [...picked];
	return { label: '为什么这么想', payload: { $type: 'ask', items: [item] } };
}

/** question.yaml 的真实默认值：items 1 条、options 空、只有 header。 */
const ASK_HEADER_ONLY: CardSection = {
	label: '需要回答的问题',
	payload: { $type: 'ask', items: [{ header: '要问的问题', options: [] }] },
};

/** core 的 defaultPayload：`{ $type:'ask', items:[{ options: [] }] }`。 */
const ASK_EMPTY_SHELL: CardSection = {
	label: '需要回答的问题',
	payload: { $type: 'ask', items: [{ options: [] }] },
};

const ASK_MULTI_PICKED: CardSection = {
	label: '优化类型',
	payload: {
		$type: 'ask',
		items: [
			{
				question: '优化类型',
				multi_select: true,
				options: [{ label: '性能优化' }, { label: '语义优化' }, { label: '可读性优化' }],
				picked: ['性能优化', '可读性优化'],
			},
		],
	},
};

const UNKNOWN_TYPE: CardSection = {
	label: '第三方组件',
	payload: { $type: 'table', rows: [[1, 2], [3, 4]] },
};

const NO_TYPE: CardSection = {
	label: '没有 $type',
	payload: { 什么: '奇怪的数据', 嵌套: { a: 1 } },
};

const DIRTY_NULL: CardSection = { label: 'payload 是 null', payload: null };
const DIRTY_NUMBER: CardSection = { label: 'payload 是数字', payload: 42 };
const EMPTY_LABEL: CardSection = {
	label: '',
	payload: { $type: 'text', value: '这一章没有名字（label 为空）—— 不该画标题行，也不该编「正文」。' },
};

/* ══════════════════════════════════════════════════════════
   ① 活的一章（受控）
   ══════════════════════════════════════════════════════════ */

interface LiveProps {
	readonly onEvent: (what: string) => void;
}

/** 父层：拿着 payload，按 onAnswer 算出新 payload 再灌回去。 */
/** 父层：拿着 payload，把动作交给 pure 的 `applyAskAction`。 */
function Live(props: LiveProps): React.ReactNode {
	const [section, setSection] = useState<CardSection>(() => askSection());
	const [readonlyState, setReadonlyState] = useState(false);

	/*
	 * ⚠ 这里**不再自己算** `picked` / `custom` —— 交给 pure 的 `applyAskAction`。
	 * 之前这段手写的 30 行胶水跟产品父层是两套逻辑，改一处另一处就错。
	 */
	const ask = (sectionId: string, groupIndex: number, action: AskAction): void => {
		props.onEvent(`${readonlyState ? 'readonly/' : ''}ask:${sectionId}=${JSON.stringify(action)}`);
		setSection((current) => ({
			...current,
			payload: applyAskAction(current.payload, groupIndex, action),
		}));
	};

	return (
		<section className="pv-block">
			<h2>① 活的一章（点选项 → 回调 → 父层改 payload → 界面跟着变）</h2>
			<div className="live-wrap" data-live>
				<Section
					sectionId="whyThis"
					section={section}
					index={1}
					readonly={readonlyState}
					onEdit={(id) => props.onEvent(`edit:${id}`)}
					onAsk={ask}
				/>
			</div>
			<div className="pv-state">
				<div>
					<span className="pv-k">readonly</span>
					<code data-live-readonly>{String(readonlyState)}</code>
				</div>
				<div>
					<span className="pv-k">picked</span>
					<code data-live-picked>
						{JSON.stringify(
							(((section.payload as { items?: { picked?: string[] }[] }).items ?? [])[0] ?? {})
								.picked ?? null,
						)}
					</code>
				</div>
				<div>
					<span className="pv-k">custom</span>
					<code data-live-custom>
						{JSON.stringify(
							(((section.payload as { items?: { custom?: string[] }[] }).items ?? [])[0] ?? {})
								.custom ?? null,
						)}
					</code>
				</div>
			</div>
			<div className="pv-row" style={{ marginTop: 12 }}>
				<button
					type="button"
					className="ghost-btn"
					data-toggle-readonly
					onClick={() => {
						props.onEvent(`toggle-readonly:${String(!readonlyState)}`);
						setReadonlyState((one) => !one);
					}}
				>
					切换只读 / 可编辑
				</button>
				<button
					type="button"
					className="ghost-btn"
					data-reset-live
					onClick={() => {
						props.onEvent('reset-live');
						setSection(askSection());
					}}
				>
					重置这一章（picked 回到「未选择」）
				</button>
			</div>
		</section>
	);
}

/* ══════════════════════════════════════════════════════════
   ② 静态矩阵
   ══════════════════════════════════════════════════════════ */

interface Scenario {
	readonly key: string;
	readonly note: string;
	readonly section: CardSection;
	readonly readonly: boolean;
	readonly withCallbacks: boolean;
}

const SCENARIOS: readonly Scenario[] = [
	{ key: 'text-filled-readonly', note: 'text 填写态 + 只读（点击不该发 onEdit）', section: TEXT_FILLED, readonly: true, withCallbacks: true },
	{ key: 'text-empty-readonly', note: 'text 草稿态 + 只读 ⇒ 「（空）」，不提示去点', section: TEXT_EMPTY, readonly: true, withCallbacks: true },
	{ key: 'text-empty-editable', note: 'text 草稿态 + 可编辑 ⇒ 显示模板 placeholder，点击发 onEdit', section: TEXT_EMPTY, readonly: false, withCallbacks: true },
	{ key: 'text-nocb', note: 'text 可编辑但父层没接 onEdit ⇒ 不可点（不假装能编辑）', section: TEXT_EMPTY, readonly: false, withCallbacks: false },
	{ key: 'markdown-filled', note: 'markdown：换行 / **粗体** / `代码`；HTML 标签当文字', section: MARKDOWN_FILLED, readonly: true, withCallbacks: true },
	{ key: 'markdown-empty', note: 'markdown 草稿态 ⇒ placeholder', section: MARKDOWN_EMPTY, readonly: false, withCallbacks: true },
	{ key: 'ask-unset', note: 'ask 真实 6 选项，picked 不存在 ⇒ 未选择', section: askSection(), readonly: false, withCallbacks: true },
	{ key: 'ask-picked', note: 'ask 单选 picked=["望文生义"] ⇒ 徽标「单选·已选 1」', section: askSection(['望文生义']), readonly: false, withCallbacks: true },
	{ key: 'ask-none', note: 'ask picked=[] ⇒ 徽标「都不要」（与未选择不同）', section: askSection([]), readonly: false, withCallbacks: true },
	{ key: 'ask-multi', note: 'ask 多选 picked 两个 ⇒ 徽标「多选·已答 2」', section: ASK_MULTI_PICKED, readonly: false, withCallbacks: true },
	{ key: 'ask-readonly', note: 'ask 只读 ⇒ 选项是 div、没有自填框、没有「都不要」按钮', section: askSection(['历史惯性']), readonly: true, withCallbacks: true },
	{ key: 'ask-header-only', note: 'ask options=[] 但 header 在（question.yaml 默认）', section: ASK_HEADER_ONLY, readonly: false, withCallbacks: true },
	{ key: 'ask-empty-shell', note: 'core 的 defaultPayload（items:[{options:[]}]）⇒ 画「还没有选项」', section: ASK_EMPTY_SHELL, readonly: false, withCallbacks: true },
	{ key: 'unknown-type', note: '未知 $type ⇒ 展开原始 JSON，不白屏', section: UNKNOWN_TYPE, readonly: true, withCallbacks: true },
	{ key: 'unknown-none', note: '没有 $type ⇒ 「无法识别的数据」', section: NO_TYPE, readonly: true, withCallbacks: true },
	{ key: 'dirty-null', note: '脏数据 payload=null 不炸', section: DIRTY_NULL, readonly: true, withCallbacks: true },
	{ key: 'dirty-number', note: '脏数据 payload=42 不炸', section: DIRTY_NUMBER, readonly: true, withCallbacks: true },
	{ key: 'empty-label', note: 'label 为空 ⇒ 不画标题行（不编「正文」）', section: EMPTY_LABEL, readonly: true, withCallbacks: true },
];

function Matrix(props: LiveProps): React.ReactNode {
	return (
		<section className="pv-block">
			<h2>② 静态矩阵（每种 payload 形状一格，直接读 DOM 断言）</h2>
			{SCENARIOS.map((one) => (
				<div className="pv-case" key={one.key} data-scenario={one.key}>
					<div className="pv-case__note">{one.note}</div>
					<Section
						sectionId={one.key}
						section={one.section}
						index={1}
						readonly={one.readonly}
						{...(one.withCallbacks
							? {
									onEdit: (id: string) => props.onEvent(`${one.key}/edit:${id}`),
									onAnswer: (id: string, value: string) =>
										props.onEvent(`${one.key}/answer:${id}=${JSON.stringify(value)}`),
								}
							: {})}
					/>
				</div>
			))}
		</section>
	);
}

/* ══════════════════════════════════════════════════════════
   ③ 日志 + ④ 语法表
   ══════════════════════════════════════════════════════════ */

function App(): React.ReactNode {
	const [events, setEvents] = useState<readonly string[]>([]);
	const push = (what: string): void => setEvents((one) => [...one, what]);

	return (
		/*
		 * 最外层带 `.tb3w-root` —— 产品 CSS 全部挂在这个作用域下
		 * （`SECTION_CSS` 的每条规则都是 `.tb3w-root .section-block…`）。
		 * `.pv-shell` 把产品的「撑满 + 裁切」放开成「按内容撑开」。
		 */
		<div className="preview tb3w-root pv-shell">
			<header className="pv-head">
				<h1>Section / 卡片正文的一章</h1>
				<p>
					章节名用模板给的 · 三种 payload（text / markdown / ask）+ 未知降级 · ask 选项可点 ·
					组件不判「能不能编辑」
				</p>
			</header>

			<Live onEvent={push} />
			<Matrix onEvent={push} />

			<section className="pv-block">
				<h2>③ 回调日志（点了什么就是什么）</h2>
				<ul className="pv-events" data-event-log>
					{events.length === 0 ? <li className="pv-events__empty">（还没有事件）</li> : null}
					{events.map((one, index) => (
						<li key={`${index}-${one}`} data-event={one}>
							{one}
						</li>
					))}
				</ul>
				<button type="button" className="ghost-btn" data-clear-log onClick={() => setEvents([])}>
					清空日志
				</button>
			</section>

			<section className="pv-block">
				<h2>④ markdown 现在支持的语法（临时实现）</h2>
				<table className="pv-table">
					<thead>
						<tr>
							<th>语法</th>
							<th>现在</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td>换行 / 空行</td>
							<td>✅ 一行一段，空行留白</td>
						</tr>
						<tr>
							<td>
								<code>**粗体**</code>
							</td>
							<td>✅ <code>&lt;strong&gt;</code></td>
						</tr>
						<tr>
							<td>
								<code>`代码`</code>
							</td>
							<td>✅ <code>&lt;code&gt;</code></td>
						</tr>
						<tr>
							<td>不闭合的标记</td>
							<td>✅ 保持字面（<code>2 ** 3</code> 不会被切开）</td>
						</tr>
						<tr>
							<td>标题 / 列表 / 引用 / 代码块 / 表格 / 链接 / 删除线</td>
							<td>❌ 原样显示成文字</td>
						</tr>
						<tr>
							<td>HTML 标签</td>
							<td>❌ 原样显示成文字（<b>永不解析</b>）</td>
						</tr>
					</tbody>
				</table>
				<p className="pv-note" style={{ marginTop: 12, marginBottom: 0 }}>
					⚠ 用户 2026-11-10 要求「找正规的 md 渲染器」⇒ 正式版换 marked（GFM）+ 白名单净化。
					换库点只有 <code>dev/pure/section.ts</code> 的 <code>markdownLinesOf()</code> 一个函数。
					全部判决在 <code>dev/pure/section.ts</code>（67 条单测），组件只做渲染决定。
				</p>
			</section>
		</div>
	);
}

initRenderers();
/* 产品样式（含降级块的 .missing-renderer / .json-fallback）。 */
injectStyles();
const root = document.getElementById('root');
if (root !== null) {
	createRoot(root).render(
		<StrictMode>
			<App />
		</StrictMode>,
	);
}
