/**
 * `CardCreate` 的预览 —— **假 leftPane**，演示整页骨架。
 *
 * ## 为什么左栏是假的
 *
 * `CardCreate` 的左栏是**插槽**（用户还没挑完变体）。这个预览用一个
 * **最简左栏**（标题 + 模板说明 + 一个占位块）证明：
 *
 * 1. 插槽接得上
 * 2. 右栏能独立滚动（顶栏底栏不动）
 * 3. 错误能分别显示在左栏和右栏
 * 4. 丢内容能上报
 *
 * ⚠ **这不是定稿左栏。** 等用户挑完变体，换掉 `leftPane` 就行，`CardCreate` 不用改。
 *
 * ## 为什么右侧做成能滚的
 *
 * 假数据故意有 6 个章节、每章内容都不短 ⇒ 右栏一定超出视口 ⇒
 * 截图里能直接看出「只有右栏在滚，顶栏底栏没动」。
 */

import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StrictMode } from 'react';

import { CardCreate, type LeftPaneContext } from '../../../src/renderers/create/CardCreate.tsx';
import { TemplateHint } from '../../../src/renderers/create/TemplateHint.tsx';
import { useCreateForm, type FormTemplate } from '../../../src/renderers/create/useCreateForm.ts';
import type { CreateDraft } from '../../../src/pure/create-types.ts';

/** 假模板（6 章，足够撑出滚动）。 */
const TEMPLATE: FormTemplate = {
	ref: 'expectedMismatch',
	displayName: '预期不符',
	codePrefix: 'E',
	kind: 'record',
	domain: '核心',
	usage:
		'反馈 bug，不过在查明之前不能确认真的是 bug。' +
		'写清「期望是什么」和「实际看到什么」，两者都要能复核。' +
		'这一行故意写长一点，让左栏的模板说明块占几行，好看出左栏也能滚。',
	sections: [
		{ id: 'summary', label: '一句话描述', hint: '一句话说清，别写背景', action: 'text', defaultPayload: { $type: 'text', value: '任务板分组为空时，卡片列表整片空白。' } },
		{ id: 'expected', label: '期望发生什么', hint: '正常应该是什么样，可写多行', action: 'markdown', defaultPayload: { $type: 'markdown', value: '## 期望\n\n分组为空应该显示**空状态提示**，而不是空白：\n\n- 说明这个分组还没有卡\n- 给一个「新建」入口' } },
		{ id: 'actual', label: '实际看到什么', hint: '实际发生的现象', action: 'text', defaultPayload: { $type: 'text', value: '整片空白，没有任何提示。' } },
		{ id: 'repro', label: '怎么复现', hint: '步骤越具体越好', action: 'markdown', defaultPayload: { $type: 'markdown', value: '1. 新建一个空间\n2. 不建任何卡\n3. 打开任务板\n4. 列表区是空的' } },
		{ id: 'impact', label: '影响范围', hint: '谁会受影响', action: 'text', defaultPayload: { $type: 'text', value: '所有新建空间。' } },
		{ id: 'basis', label: '为什么这么想', hint: '这个预期的依据', action: 'ask', defaultPayload: { $type: 'ask', items: [{ options: [] }] } },
	],
};

/** 假左栏 —— 只用来看「插槽接得上」。 */
function FakeLeftPane(ctx: LeftPaneContext): React.ReactNode {
	const titleErr = ctx.errorOf('/title');
	const tplErr = ctx.errorOf('/templateRef');
	const [title, setTitle] = useState('');

	return (
		<div className="fake-left">
			<label className="fake-left__field">
				<span className="fake-left__label">
					标题 <b className="fake-left__req">*</b>
				</span>
				<input
					className="fake-left__input"
					value={title}
					placeholder="例如：修好任务板分组为空时的提示"
					onChange={(event) => {
						setTitle(event.target.value);
					}}
				/>
				{titleErr === undefined ? null : (
					<div className="fake-left__err">{titleErr.message}</div>
				)}
			</label>

			<div className="fake-left__field">
				<TemplateHint template={TEMPLATE} />
				{tplErr === undefined ? null : <div className="fake-left__err">{tplErr.message}</div>}
			</div>

			<div className="fake-left__slot">
				父任务 / 关系 / 高级设置 —— 等用户挑完左栏变体后放这里。
				<br />
				本块只是占位，证明插槽接得上。
			</div>
		</div>
	);
}

/** 预览页。 */
function App(): React.ReactNode {
	const form = useCreateForm({
		template: TEMPLATE,
		pickableCards: [],
		onSubmit: (submission) => {
			window.alert(`提交成功（假）：\n${JSON.stringify(submission, null, 2).slice(0, 400)}`);
		},
		onCancel: () => {
			window.alert('取消（假）');
		},
	});

	const [errors, setErrors] = useState<readonly { field: string; message: string }[]>([]);
	const [notice, setNotice] = useState<string | undefined>(undefined);

	const draft: CreateDraft = useMemo(
		() => ({ ...form.draft, templateRef: TEMPLATE.ref }),
		[form.draft],
	);

	return (
		<>
			{/*
			 * 预览页自己的说明（不是产品的一部分）——
			 * 放在卡片外面，不能挡住 create-page（它是 fixed inset:0）。
			 */}
			<div className="demo-bar">
				<span className="demo-bar__tag">CardCreate</span>
				<span>满屏整页 · 左栏插槽 · 右栏独立滚动 · 错误分栏显示</span>
			</div>

			<CardCreate
				draft={draft}
				onChange={(next) => {
					/* 本预览里 onChange 只是把改动回灌给 hook —— 真正产品里由调用方持有 draft。 */
					void next;
				}}
				leftPane={FakeLeftPane}
				errors={errors}
				onSubmit={() => {
					const found = validateNow(draft);
					setErrors(found);
					if (found.length === 0) form.actions.submit();
				}}
				onCancel={form.actions.dismissLostNotice}
				onLostContent={(label) => {
					setNotice(`「${label}」原来的内容已清空（新类型的数据结构与它不兼容）。`);
				}}
			/>

			{notice === undefined ? null : (
				<div className="demo-notice">
					<span>{notice}</span>
					<button
						type="button"
						onClick={() => {
							setNotice(undefined);
						}}
					>
						知道了
					</button>
				</div>
			)}
		</>
	);
}

/** 假校验：故意让标题为空时报错（好看左栏错误态）。 */
function validateNow(draft: CreateDraft): readonly { field: string; message: string }[] {
	const errors: { field: string; message: string }[] = [];
	if (draft.title.trim() === '') errors.push({ field: '/title', message: '卡标题不能为空。' });
	return errors;
}

const root = document.getElementById('root');
if (root !== null) {
	createRoot(root).render(
		<StrictMode>
			<App />
		</StrictMode>,
	);
}
