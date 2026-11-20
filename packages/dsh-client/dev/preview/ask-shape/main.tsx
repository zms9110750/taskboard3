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
import { AskSection } from '../../../src/renderers/AskSection.tsx';
import { sectionViewOf } from '../../../src/pure/section.ts';

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
			{ label: '方案 A：先做详情页' },
			{ label: '方案 B：先做科技树' },
			{ label: '方案 C：两条并行' },
		],
		multiSelect: false,
		placeholder: '如果都不合适，写下你的想法',
		picked: [],
		custom: [],
	},
	{
		header: '可以多选',
		question: '哪些东西必须一起改？',
		options: [{ label: '筛选行' }, { label: '空间条' }, { label: '详情头部' }],
		multiSelect: true,
		placeholder: '补充说明',
		picked: [],
		custom: [],
	},
];

/* ══════════════════════════════════════════════════════════
   栏 1：create —— askCompose（编辑问卷本身）
   ══════════════════════════════════════════════════════════ */

function CreateColumn(): React.ReactNode {
	const [items, setItems] = useState<readonly AskItem[]>(INITIAL_ITEMS);

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
	const patchOption = (itemIndex: number, optionIndex: number, label: string): void => {
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
					<span className="as-role">question</span>

					{/* header：副标题（灰小字） */}
					<input
						className="as-input as-input--header"
						value={item.header}
						placeholder="副标题（灰小字）"
						onChange={(e) => {
							patchItem(itemIndex, { header: e.target.value });
						}}
					/>
					<span className="as-role">header</span>

					{/* options：可增删改 */}
					<div className="as-options">
						{item.options.map((option, optionIndex) => (
							<div className="as-option" key={optionIndex}>
								<input
									className="as-input"
									value={option.label}
									onChange={(e) => {
										patchOption(itemIndex, optionIndex, e.target.value);
									}}
								/>
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
								patchItem(itemIndex, { options: [...item.options, { label: '新选项' }] });
							}}
						>
							＋ 添加选项
						</button>
					</div>

					{/* 多选开关 */}
					<label className="as-check">
						<input
							type="checkbox"
							checked={item.multiSelect}
							onChange={(e) => {
								patchItem(itemIndex, { multiSelect: e.target.checked });
							}}
						/>
						允许多选
						<span className="as-role">multi-select</span>
					</label>

					{/* 自填灰字 */}
					<input
						className="as-input as-input--dashed"
						value={item.placeholder}
						placeholder="自填框灰字"
						onChange={(e) => {
							patchItem(itemIndex, { placeholder: e.target.value });
						}}
					/>
					<span className="as-role">placeholder</span>
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

function ActiveColumn(): React.ReactNode {
	const [picked, setPicked] = useState<Readonly<Record<string, readonly string[]>>>({});
	const [custom, setCustom] = useState<Readonly<Record<string, string>>>({});

	/** payload 里带上当前选择，让真组件按真实数据渲染。 */
	const payload = {
		$type: 'taskboard.ask',
		items: INITIAL_ITEMS.map((item, i) => ({
			header: item.header,
			question: item.question,
			options: item.options,
			multi_select: item.multiSelect,
			placeholder: item.placeholder,
			picked: picked[String(i)] ?? [],
			custom: (custom[String(i)] ?? '') === '' ? [] : [custom[String(i)]],
		})),
	};

	const view = sectionViewOf(payload);

	return (
		<div className="as-col">
			<div className="as-col__head">
				<span className="as-col__name">active · askEditable</span>
				<span className="as-col__note">填答案 —— 选项 / 未选择 / 自填框（真 AskSection）</span>
			</div>

			{/*
			 * 真组件：`AskSection` + `readonly={false}` + `onAnswer`。
			 * 它自己管点击互斥 / 多选 / 自填，预览只负责把值记下来再喂回去。
			 */}
			{view.kind === 'ask' ? (
				<AskSection
					sectionId="preview-ask"
					view={view}
					readonly={false}
					onAnswer={(sectionId, value) => {
						void sectionId;
						setCustom((prev) => ({ ...prev, '0': value }));
					}}
				/>
			) : (
				<div className="as-note">夹具不是 ask 形态（预览数据写错了）</div>
			)}

			<div className="as-note">⚠ 这里不改题目 —— 只填 items[].picked / custom</div>
		</div>
	);
}

/* ══════════════════════════════════════════════════════════
   栏 3：ended —— 只读结果
   ══════════════════════════════════════════════════════════ */

function EndedColumn(): React.ReactNode {
	return (
		<div className="as-col">
			<div className="as-col__head">
				<span className="as-col__name">ended</span>
				<span className="as-col__note">只读展示结果 —— 可刮取复制</span>
			</div>

			<div className="as-readonly">
				<div className="as-readonly__header">选一个就行（单选）</div>
				<div className="as-readonly__question">这个卡的目的是什么？</div>

				<div className="as-readonly__option">方案 A：先做详情页</div>
				<div className="as-readonly__option as-readonly__option--picked">
					方案 B：先做科技树 <span className="as-readonly__check">✓</span>
				</div>
				<div className="as-readonly__option">方案 C：两条并行</div>

				<div className="as-pill">单选 · 已选 1</div>

				<div className="as-readonly__custom">自填：先做详情页，科技树下一轮</div>
			</div>

			<div className="as-note">⚠ 没有输入框、没有按钮 —— 只有文本（user-select: text）</div>
		</div>
	);
}

/* ══════════════════════════════════════════════════════════
   页面
   ══════════════════════════════════════════════════════════ */

function App(): React.ReactNode {
	return (
		<div className="as">
			<h1 className="as-title">ask · 三相位形状</h1>
			<div className="as-sub">
				契约来源 <code>taskboard2/docs/02-action.md</code> §2.9（四态语义）/
				§2.9b（askCompose 的 7 件能力）/ §2.9d（灰字三相位）
			</div>

			<div className="as-grid">
				<CreateColumn />
				<ActiveColumn />
				<EndedColumn />
			</div>
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
function injectAskStyles(): void {
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
		'.as-input{width:100%;box-sizing:border-box;padding:6px 9px;border:1px solid #d7dbe2;border-radius:6px;font:12px/1.5 inherit;background:#fff}',
		'.as-input--question{font-size:13px;font-weight:600}',
		'.as-input--header{font-size:11.5px;color:#9aa1ad}',
		'.as-input--dashed{border-style:dashed;background:#fafbfc;color:#9aa1ad}',
		'.as-options{display:flex;flex-direction:column;gap:5px}',
		'.as-option{display:flex;gap:5px;align-items:center}',
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
	].join('\n');
	const style = document.createElement('style');
	style.id = 'as-style';
	style.textContent = STYLE;
	document.head.appendChild(style);
}
