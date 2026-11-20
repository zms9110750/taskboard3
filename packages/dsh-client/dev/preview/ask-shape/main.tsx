/**
 * ask 的**三相位形状** —— 用户 2026-11-20：
 *
 * > 「svg 我看不了。也做成组件吧。」
 *
 * 所以这一页把 `ask-shape.svg` 那三栏用真 HTML 画出来，并且**尽量可交互**：
 * create 能改题目/选项/多选/灰字，active 能点选项和自填，ended 是纯只读。
 *
 * ⚠ 这是**形状预览**，不是产品实现 —— `askCompose`（编辑问卷）在产品里还不存在，
 *   `askEditable` 已有（`src/renderers/AskSection.tsx`）。契约见
 *   `taskboard2/docs/02-action.md` §2.9 / §2.9b / §2.9d。
 */

import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { injectStyles } from '../../../src/styles.ts';
import { AskGroupCard } from '../../../src/renderers/AskSection.tsx';
import { applyAskAction, sectionViewOf } from '../../../src/pure/section.ts';

/* ══════════════════════════════════════════════════════════
   夹具：一份 ask payload（create 阶段写下的东西）
   ══════════════════════════════════════════════════════════ */

interface AskOption {
	readonly label: string;
	readonly description?: string;
}

interface AskItem {
	readonly header: string;
	readonly question: string;
	readonly options: readonly AskOption[];
	readonly multiSelect: boolean;
	readonly placeholder: string;
	readonly picked: readonly string[];
	readonly custom: readonly string[];
}

const INITIAL_ITEMS: readonly AskItem[] = [
	{
		header: '选一个就行（单选）',
		question: '这个卡的目的是什么？',
		options: [
			{ label: '方案 A：先做详情页', description: '详情页是入口，先有壳' },
			{ label: '方案 B：先做科技树', description: '科技树是视图，先有骨架' },
			{ label: '方案 C：两条并行', description: '同时推进，风险是都做不深' },
		],
		multiSelect: false,
		placeholder: '如果都不合适，写下你的想法',
		picked: ['方案 B：先做科技树'],
		custom: [],
	},
	{
		header: '可以多选',
		question: '哪些东西必须一起改？',
		options: [
			{ label: '筛选行', description: 'FilterRow / FilterBox' },
			{ label: '空间条', description: 'SpaceBar / SpacePicker' },
			{ label: '详情头部', description: 'DetailHead' },
		],
		multiSelect: true,
		placeholder: '补充说明',
		picked: ['筛选行'],
		custom: ['还有配色'],
	},
];

/* ══════════════════════════════════════════════════════════
   栏 1：create —— askCompose（编辑问卷本身）
   ══════════════════════════════════════════════════════════ */

export function CreateColumn(props: {
	readonly items: readonly AskItem[];
	readonly setItems: React.Dispatch<React.SetStateAction<readonly AskItem[]>>;
}): React.ReactNode {
	const items = props.items;
	const setItems = props.setItems;

	/**
	 * 改一项。
	 *
	 * @param index 问题组下标
	 * @param patch 要改的字段
	 */
	const patchItem = (index: number, patch: Partial<AskItem>): void => {
		setItems((prev) => prev.map((one, i) => (i === index ? { ...one, ...patch } : one)));
	};

	/**
	 * 改一个选项的文字。
	 *
	 * @param itemIndex 问题组下标
	 * @param optionIndex 选项下标
	 * @param label 新文字
	 */
	const patchOptionLabel = (itemIndex: number, optionIndex: number, label: string): void => {
		setItems((prev) =>
			prev.map((one, i) =>
				i === itemIndex
					? {
							...one,
							options: one.options.map((opt, j) => (j === optionIndex ? { ...opt, label } : opt)),
						}
					: one,
			),
		);
	};

	/**
	 * 改一个选项的说明（`description` —— JSON 里本来就有这一项）。
	 *
	 * @param itemIndex 问题组下标
	 * @param optionIndex 选项下标
	 * @param description 新说明
	 */
	const patchOptionDescription = (
		itemIndex: number,
		optionIndex: number,
		description: string,
	): void => {
		setItems((prev) =>
			prev.map((one, i) =>
				i === itemIndex
					? {
							...one,
							options: one.options.map((opt, j) =>
								j === optionIndex ? { ...opt, description } : opt,
							),
						}
					: one,
			),
		);
	};

	return (
		<div className="as-col">
			<div className="as-col__head">
				<span className="as-col__name">create · askCompose</span>
				<span className="as-col__note">编辑问卷本身 —— 题目 / 选项 / 多选 / 灰字</span>
			</div>

			{items.map((item, itemIndex) => (
				<div className="as-group" key={itemIndex}>
					<div className="as-group__bar">
						<span className="as-role">问题组 {itemIndex + 1} / {items.length}</span>
						{/*
						 * 用户 2026-11-21：「把多选作为按钮放在这个问题页的 × 的左边。」
						 * ⇒ 单选/多选不再是正文里的一个 checkbox，而是组头的一个按钮。
						 */}
						<button
							type="button"
							className={`as-multibtn${item.multiSelect ? ' is-on' : ''}`}
							data-ask-multibtn
							title="切换单选 / 多选"
							onClick={() => {
								patchItem(itemIndex, { multiSelect: !item.multiSelect });
							}}
						>
							{item.multiSelect ? '多选' : '单选'}
						</button>
						<button
							type="button"
							className="as-icon"
							title="删除问题组（只剩 1 个时禁用）"
							disabled={items.length <= 1}
							onClick={() => {
								setItems((prev) => prev.filter((_, i) => i !== itemIndex));
							}}
						>
							✕
						</button>
					</div>

					{/* question：主标题（大字） */}
					<input
						className="as-input as-input--question"
						value={item.question}
						placeholder="问题（大字）"
						onChange={(e) => {
							patchItem(itemIndex, { question: e.target.value });
						}}
					/>

					{/* header：副标题（灰小字）—— 和 question 连续两个框，中间不插 label */}
					<input
						className="as-input as-input--header"
						value={item.header}
						placeholder="副标题（灰小字）"
						onChange={(e) => {
							patchItem(itemIndex, { header: e.target.value });
						}}
					/>

					{/* options：可增删改（label + description 两个字段） */}
					<div className="as-options">
						{item.options.map((option, optionIndex) => (
							<div className="as-option as-option--two" key={optionIndex}>
								<div className="as-option__fields">
									<input
										className="as-input"
										value={option.label}
										placeholder="选项文字"
										onChange={(e) => {
											patchOptionLabel(itemIndex, optionIndex, e.target.value);
										}}
									/>
									<input
										className="as-input as-input--desc"
										value={option.description ?? ''}
										placeholder="选项说明（可选）"
										onChange={(e) => {
											patchOptionDescription(itemIndex, optionIndex, e.target.value);
										}}
									/>
								</div>
								<button
									type="button"
									className="as-icon"
									title="删除选项"
									onClick={() => {
										patchItem(itemIndex, {
											options: item.options.filter((_, j) => j !== optionIndex),
										});
									}}
								>
									✕
								</button>
							</div>
						))}
						<button
							type="button"
							className="as-add"
							onClick={() => {
								patchItem(itemIndex, {
									options: [...item.options, { label: '新选项', description: '' }],
								});
							}}
						>
							＋ 添加选项 <span className="as-role">option-add</span>
						</button>
					</div>

					{/* 多选开关 */}
					{/* 多选开关已挪到组头（× 左边），正文里不再有这一行。 */}

					{/*
					 * 用户 2026-11-21：「创建期不要展示『如果都不合适，写下你的想法』的自填框。」
					 * ⇒ create 相位**不画** placeholder（自填灰字）的编辑框 —— 它是运行时固定行为，
					 *   不是题目的一部分。
					 */}
				</div>
			))}

			<button
				type="button"
				className="as-add as-add--block"
				onClick={() => {
					setItems((prev) => [
						...prev,
						{
							header: '',
							question: '',
							options: [{ label: '新选项' }],
							multiSelect: false,
							placeholder: '',
							picked: [],
							custom: [],
						},
					]);
				}}
			>
				＋ 添加问题组 <span className="as-role">item-add</span>
			</button>

			<div className="as-note">⚠ create 相位是「编辑题目」，不是「回答问题」</div>
		</div>
	);
}

/* ══════════════════════════════════════════════════════════
   栏 2：active —— askEditable（填答案，用真组件）
   ══════════════════════════════════════════════════════════ */

export function ActiveColumn(props: {
	readonly items: readonly AskItem[];
}): React.ReactNode {
	const items = props.items;

	/*
	 * 预期答案（预览夹具）—— 直接写 **payload 形状**，和产品里存的一模一样。
	 * 这里没有 `picked` / `custom` 三个平行 state，只有一个 payload。
	 */
	const [payload, setPayload] = useState<Record<string, unknown>>(() => ({
		$type: 'ask',
		items: items.map((item, i) => ({
			header: item.header,
			question: item.question,
			options: item.options,
			multi_select: item.multiSelect,
			placeholder: item.placeholder,
			...(i === 0 ? { picked: ['方案 B：先做科技树'] } : {}),
			...(i === 1 ? { picked: ['筛选行'], custom: ['还有配色'] } : {}),
		})),
	}));

	const view = sectionViewOf(payload);

	return (
		<div className="as-col">
			<div className="as-col__head">
				<span className="as-col__name">active · askEditable</span>
				<span className="as-col__note">填答案 —— 每组独立渲染（真 AskGroupCard）</span>
			</div>

			{/*
			 * 用户 2026-11-21：「不要写胶水代码。他们的逻辑应该是很一致的。」
			 * ⇒ 动作**直接交给产品的 pure 函数 `applyAskAction`**：
			 *   单选互斥 / 自填文字进 picked / 删 picked 全在一处，预览没有第二套逻辑。
			 */}
			{view.kind === 'ask' ? (
				view.groups.map((group, index) => (
					<AskGroupCard
						key={index}
						sectionId={`preview-ask-${String(index)}`}
						group={group}
						readonly={false}
						onAsk={(_sectionId, action) => {
							setPayload((current) => applyAskAction(current, index, action) as Record<string, unknown>);
						}}
					/>
				))
			) : (
				<div className="as-note">夹具不是 ask 形态（预览数据写错了）</div>
			)}

			<div className="as-note">⚠ 这里不改题目 —— 只改答案（picked / custom）</div>
		</div>
	);
}

/* ══════════════════════════════════════════════════════════
   栏 3：ended —— 只读结果
   ══════════════════════════════════════════════════════════ */

export function EndedColumn(props: {
	readonly items: readonly AskItem[];
}): React.ReactNode {
	const items = props.items;

	/*
	 * ⚠ 这里原来是一套**手写的假组件**（`as-readonly__option` 之类），
	 * 跟产品完全脱钩 —— 所以冻结态的「选中项左边框」在它身上根本不生效。
	 *
	 * 现在直接喂真 `AskGroupCard` + `readonly`：冻结态长什么样由产品决定，
	 * 预览不再画第二套。
	 */
	const payload = {
		$type: 'ask',
		items: items.map((item) => ({
			header: item.header,
			question: item.question,
			options: item.options,
			multi_select: item.multiSelect,
			placeholder: item.placeholder,
			...(item.picked === undefined ? {} : { picked: item.picked }),
			...(item.custom === undefined ? {} : { custom: item.custom }),
		})),
	};

	const view = sectionViewOf(payload);

	return (
		<div className="as-col">
			<div className="as-col__head">
				<span className="as-col__name">ended</span>
				<span className="as-col__note">只读展示结果 —— 可刮取复制（真 AskGroupCard readonly）</span>
			</div>

			{view.kind === 'ask' ? (
				view.groups.map((group, index) => (
					<AskGroupCard key={index} sectionId={`preview-ended-${String(index)}`} group={group} readonly />
				))
			) : (
				<div className="as-note">夹具不是 ask 形态（预览数据写错了）</div>
			)}

			<div className="as-note">⚠ 没有输入框、没有按钮 —— 只有文本（user-select: text）</div>
		</div>
	);
}

/* ══════════════════════════════════════════════════════════
   三栏组合：**共享同一份 items 状态**（用户 2026-11-21：
   「ask 的编辑状态，我要他是可以交互的」—— 改了 create 的题目/选项，
   active 和 ended 必须跟着变，否则看起来像三份互不相干的残片）。
   ══════════════════════════════════════════════════════════ */

/**
 * 三栏（或单栏纵向）组合。
 *
 * @param props layout：`grid` 三栏并排 / `stack` 单栏纵向
 */
export function AskColumns(props: {
	readonly layout: 'grid' | 'stack';
}): React.ReactNode {
	const [items, setItems] = useState<readonly AskItem[]>(INITIAL_ITEMS);
	const columns = (
		<>
			<CreateColumn items={items} setItems={setItems} />
			<ActiveColumn items={items} />
			<EndedColumn items={items} />
		</>
	);

	return props.layout === 'grid' ? <div className="as-grid">{columns}</div> : <div className="as-stack">{columns}</div>;
}

/* ══════════════════════════════════════════════════════════
   页面
   ══════════════════════════════════════════════════════════ */

function App(): React.ReactNode {
	return (
		<div className="as tb3w-root">
			{/*
			 * tb3w-root 是产品样式的唯一作用域 —— 所有规则都是 .tb3w-root .ask-option …。
			 * 不加这个类，圆点 / 边框 / 左边框一条都不生效（真实踩过）。
			 */}
			<h1 className="as-title">ask · 三相位形状</h1>
			<div className="as-sub">
				契约来源 <code>taskboard2/docs/02-action.md</code> §2.9（四态语义）/
				§2.9b（askCompose 的 7 件能力）/ §2.9d（灰字三相位）
			</div>
			<div className="as-note">
				⚠ create 改了题目/选项，active 和 ended 会**跟着变**（共享同一份 items）
			</div>
			<AskColumns layout="grid" />
		</div>
	);
}

injectStyles();
injectAskStyles();

const root = document.getElementById('root');
if (root !== null) {
	createRoot(root).render(
		<StrictMode>
			<App />
		</StrictMode>,
	);
}

/** 本页骨架样式。 */
export function injectAskStyles(): void {
	if (document.getElementById('as-style') !== null) return;
	const STYLE = [
		'.as{padding:20px 24px 60px;font:13px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#16181d;background:#fff;min-height:100%}',
		'.as-title{font-size:18px;margin:0 0 4px}',
		'.as-sub{color:#5f6673;font-size:12.5px;margin-bottom:22px}',
		'.as-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;align-items:start}',
		'.as-col{border:1px solid #e7e9ee;border-radius:10px;padding:12px;min-width:0}',
		'.as-col__head{display:flex;flex-direction:column;gap:2px;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #eef0f3}',
		'.as-col__name{font-weight:600;font-size:12.5px}',
		'.as-col__note{color:#5f6673;font-size:11.5px}',
		'.as-group{border:1px solid #eef0f3;border-radius:8px;padding:10px;margin-bottom:10px;display:flex;flex-direction:column;gap:6px}',
		'.as-group__bar{display:flex;align-items:center;justify-content:space-between}',
		'.as-role{font-size:10.5px;color:#9aa1ad;font-family:ui-monospace,Consolas,monospace}',
		'.as-icon{width:22px;height:22px;border:1px solid #e7e9ee;border-radius:5px;background:#fff;color:#5f6673;cursor:pointer;line-height:1}',
		'.as-icon:disabled{opacity:.4;cursor:default}',
		'.as-multibtn{padding:2px 9px;border:1px solid #d7dbe2;border-radius:5px;background:#fff;color:#5f6673;font:11px/1.4 inherit;cursor:pointer}',
		'.as-multibtn.is-on{background:#16181d;border-color:#16181d;color:#fff;font-weight:600}',
		'.as-input{width:100%;box-sizing:border-box;padding:6px 9px;border:1px solid #d7dbe2;border-radius:6px;font:12px/1.5 inherit;background:#fff}',
		'.as-input--question{font-size:13px;font-weight:600}',
		'.as-input--header{font-size:11.5px;color:#9aa1ad}',
		'.as-input--dashed{border-style:dashed;background:#fafbfc;color:#9aa1ad}',
		'.as-options{display:flex;flex-direction:column;gap:5px}',
		'.as-option{display:flex;gap:5px;align-items:flex-start}',
		'.as-option--two{}',
		'.as-option__fields{display:flex;flex-direction:column;gap:3px;flex:1;min-width:0}',
		'.as-input--desc{font-size:11px;color:#9aa1ad;border-style:dashed}',
		'.as-add{padding:5px 10px;border:1px dashed #c7cdd6;border-radius:6px;background:#fafbfc;color:#2563eb;font-size:11.5px;cursor:pointer}',
		'.as-add--block{width:100%;margin-top:4px}',
		'.as-check{display:flex;align-items:center;gap:6px;font-size:11.5px;color:#5f6673}',
		'.as-note{margin-top:10px;font-size:11px;color:#b45309}',
		'.as-readonly{border:1px solid #eef0f3;border-radius:8px;padding:12px;background:#fafbfc;user-select:text;display:flex;flex-direction:column;gap:7px}',
		'.as-readonly__header{font-size:11.5px;color:#9aa1ad}',
		'.as-readonly__question{font-size:13px;font-weight:600}',
		'.as-readonly__option{padding:7px 10px;border:1px solid #e7e9ee;border-radius:6px;background:#fff;color:#9aa1ad;font-size:12px}',
		'.as-readonly__option--picked{background:#eef4ff;border-color:#2563eb;color:#16181d;display:flex;justify-content:space-between}',
		'.as-readonly__check{color:#2563eb;font-weight:700}',
		'.as-pill{align-self:flex-start;padding:1px 8px;border-radius:99px;background:#f3f4f6;color:#5f6673;font-size:10.5px}',
		'.as-readonly__custom{font-size:12px;color:#16181d}',
		'.as-readonly__desc{font-size:10.5px;color:#9aa1ad}',
		'.as-stack{display:flex;flex-direction:column;gap:16px}',
	].join('\n');
	const style = document.createElement('style');
	style.id = 'as-style';
	style.textContent = STYLE;
	document.head.appendChild(style);
}
