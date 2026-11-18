/**
 * 设计展厅 —— **给用户挑的，不是最终版**。
 *
 * ## 用户原话（`2026-11-18`）
 *
 * > 「你连一个新建页面都没给我我怎么提出意见。
 * >   新建页面要是一个占满的屏幕。不是模态框。
 * >   ……总而言之，给我看的只要是独立的组件就可以了。
 * >   可以一次性写多个组件。我会调整和选择。」
 *
 * ⇒ 5 个变体，不纠结「哪个最好」：
 *
 * | 编号 | 是什么 | 关键差别 |
 * |---|---|---|
 * | **A** | 新建页 · 左右分栏 | 左栏标题/模板，右栏章节独立滚动 |
 * | **B** | 新建页 · 单栏居中 | 760px 一列，整页滚动，最像文档编辑器 |
 * | **C** | 新建页 · 三段式 | 顶栏固定 / 章节两列网格 / 底栏固定 |
 * | **①** | ask 编辑器 · 旧版式 | **故意照抄旧版毛病**，作对照 |
 * | **②** | ask 编辑器 · 设计稿 B | 问题/选项分两层 + 块级单选多选 + 序号把手 |
 *
 * ## 为什么满屏布局没法并排
 *
 * 满屏（`inset: 0`）的东西放进一列的 1/3 宽里会挤成一团，看不出布局。
 * ⇒ 三个布局**各占一屏高度，顺序排列**，顶部有索引可以跳。
 *
 * ## A/B/C 的差别只在摆放
 *
 * 表单状态用同一个 `useCreateForm()` —— 否则用户对比时会发现
 * 「A 能改选项说明、B 不能」这种假差异，那是实现差异不是设计差异。
 */

import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StrictMode } from 'react';

import { CardPicker } from '../../components/create/CardPicker.tsx';
import { CreateLayoutA } from '../../components/create/CreateLayoutA.tsx';
import { CreateLayoutB } from '../../components/create/CreateLayoutB.tsx';
import { CreateLayoutC } from '../../components/create/CreateLayoutC.tsx';
import { CreateLayoutFinal } from '../../components/create/CreateLayoutFinal.tsx';
import { CreateMeta } from '../../components/create/CreateMeta.tsx';
import { SectionBody } from '../../components/create/SectionBody.tsx';
import { useCreateForm } from '../../components/create/useCreateForm.ts';
import { ASK_OPTIONS, ASK_PICKED, TEMPLATES } from '../../components/create/data.ts';
import type { PickableCard } from '../../components/create/CardPicker.tsx';
import type { AskVariant } from '../../components/create/SectionBody.tsx';
import type { AskOptionDraft } from '../../components/create/SectionEditorAskV2.tsx';

/**
 * 父任务 / 关系目标的候选卡（假数据）。
 *
 * ⚠ 故意混入两类**应该被滤掉**的：
 * - `GU-01` 是草稿（`TASK_STATE_UNSPECIFIED`）⇒ 不能当父任务/关系目标
 * - `RB-99` 已删除（`deleted: true`）⇒ 不列
 *
 * 这样截图里能直接看出过滤生效了。
 */
const PICKABLE_CARDS: readonly PickableCard[] = Object.freeze([
	{ id: 'DM-01', title: '卡片的编号前缀怎么拼', status: 'TASK_STATE_SUBMITTED', deleted: false },
	{ id: 'WW-01', title: '查一下分组为空的渲染路径', status: 'TASK_STATE_WORKING', deleted: false },
	{ id: 'WF-01', title: '【验证】编号应带模板前缀', status: 'TASK_STATE_INPUT_REQUIRED', deleted: false },
	{ id: 'WS-01', title: '现有任务板实现的调研', status: 'TASK_STATE_AUTH_REQUIRED', deleted: false },
	{ id: 'RB-01', title: '查一下分组为空的渲染路径-记阻碍', status: 'TASK_STATE_COMPLETED', deleted: false },
	{ id: 'GT-01', title: '补一条空分组的用例', status: 'TASK_STATE_FAILED', deleted: false },
	{ id: 'GT-02', title: 'ask 交互隔离验收', status: 'TASK_STATE_CANCELED', deleted: false },
	{ id: 'GT-03', title: '未选择头部验收', status: 'TASK_STATE_REJECTED', deleted: false },
	/* ⚠ 下面两张应该被 CardPicker 滤掉 —— 用来验证过滤生效 */
	{ id: 'GU-01', title: '把任务板的语义定清楚（草稿，不该出现）', status: 'TASK_STATE_UNSPECIFIED', deleted: false },
	{ id: 'RB-99', title: '已删除的卡（墓碑，不该出现）', status: 'TASK_STATE_COMPLETED', deleted: true },
]);

/** 展厅里的一块。 */
function Panel(props: {
	readonly id: string;
	readonly tag: string;
	readonly title: string;
	readonly note: string;
	readonly height?: string;
	readonly children: React.ReactNode;
}): React.ReactNode {
	return (
		<section className="g-block" id={props.id}>
			<div className="g-head">
				<span className="g-tag">{props.tag}</span>
				<h2 className="g-title">{props.title}</h2>
				<p className="g-note">{props.note}</p>
			</div>
			<div className="g-stage" style={{ minHeight: props.height ?? '620px' }}>
				{props.children}
			</div>
		</section>
	);
}

/**
 * 一个**孤立的 ask 编辑器演示** —— ① 和 ② 单独看。
 *
 * 不复用 `SectionBody`：那个要一整套 `CreateForm`，而这里只要 ask 那一段。
 * 为了让 ① ② 能独立对比，这里用**本地状态**（各自一份，互不干扰）。
 */
function AskStandalone(props: { readonly which: 'v1' | 'v2' }): React.ReactNode {
	const [question, setQuestion] = useState('这个预期的依据');
	const [placeholder, setPlaceholder] = useState('选项，显示在问题下方');
	const [multi, setMulti] = useState(false);
	const [options, setOptions] = useState<readonly AskOptionDraft[]>(
		ASK_OPTIONS.map((one) => ({ label: one.label, description: one.description })),
	);
	const [picked, setPicked] = useState<readonly string[]>([...ASK_PICKED]);
	const [allowCustom, setAllowCustom] = useState(true);

	/*
	 * 用一个假模板 + 单章节走 SectionBody —— 这样 ① ② 和 A/B/C 里
	 * 「章节外壳 + 内容类型入口」是完全一致的，对比才是有效的。
	 */
	const form = useMemo(
		() => ({
			title: '',
			template: TEMPLATES[0] as (typeof TEMPLATES)[number],
			values: {},
			question,
			askPlaceholder: placeholder,
			askMulti: multi,
			askOptions: options,
			askPicked: picked,
			askAllowCustom: allowCustom,
		}),
		[question, placeholder, multi, options, picked, allowCustom],
	);

	const actions = useMemo(
		() => ({
			setTitle: () => undefined,
			setTemplate: () => undefined,
			setValue: () => undefined,
			setQuestion,
			setAskPlaceholder: setPlaceholder,
			setAskMulti: setMulti,
			setAskOptions: setOptions,
			setAskPicked: setPicked,
			setAskAllowCustom: setAllowCustom,
		}),
		[],
	);

	const askSection = form.template.sections.find((one) => one.kind === 'ask');
	if (askSection === undefined) return null;

	return (
		<div className="g-askbox">
			<SectionBody
				section={askSection}
				index={3}
				form={form}
				actions={actions}
				askVariant={props.which}
			/>
		</div>
	);
}

/** 三个布局各自一个实例（表单状态独立，互不影响）。 */
function LayoutDemo(props: { readonly which: 'A' | 'B' | 'C'; readonly askVariant: AskVariant }): React.ReactNode {
	const handle = useCreateForm();
	if (props.which === 'A') return <CreateLayoutA handle={handle} askVariant={props.askVariant} />;
	if (props.which === 'B') return <CreateLayoutB handle={handle} askVariant={props.askVariant} />;
	return <CreateLayoutC handle={handle} askVariant={props.askVariant} />;
}

/** 最终布局（左右分栏 + 父任务 + 关系/高级设置折叠区）。 */
function FinalDemo(): React.ReactNode {
	const handle = useCreateForm();
	return <CreateLayoutFinal handle={handle} askVariant="v2" cards={PICKABLE_CARDS} />;
}

/** 展厅页。 */
function App(): React.ReactNode {
	return (
		<div className="gallery">
			<header className="g-intro">
				<h1>设计展厅 · 新建页 &amp; ask 编辑器</h1>
				<p>
					5 个变体，<b>不是最终版</b>。挑你想要的，可以说「要 A 的布局 + B 的章节表单」。
				</p>
			</header>

			<nav className="g-index">
				<a href="#block-final">★ · 定稿：左右分栏 + 父任务</a>
				<a href="#block-a">A · 左右分栏</a>
				<a href="#block-b">B · 单栏居中</a>
				<a href="#block-c">C · 三段式</a>
				<a href="#block-ask1">① · ask 旧版式</a>
				<a href="#block-ask2">② · ask 设计稿 B</a>
			</nav>

			<Panel
				id="block-final"
				tag="★"
				title="定稿方向 · 左右分栏（左栏：标题 / 模板 / 父任务 / [关系|高级设置]）"
				note="严格按 2026-11-18 的裁定：左栏竖着四项，关系和高级设置是两个按钮、互斥、共用下面同一块折叠区、可再点收起。父任务是 combobox（输入即筛选），不是 select。"
				height="700px"
			>
				<FinalDemo />
			</Panel>

			<Panel
				id="block-a"
				tag="A"
				title="新建页 · 左右分栏"
				note="左栏窄（标题 / 模板 / 关系 / 高级），右栏章节表单独立滚动。最接近旧版，但满屏、不写死高度。"
			>
				<LayoutDemo which="A" askVariant="v2" />
			</Panel>

			<Panel
				id="block-b"
				tag="B"
				title="新建页 · 单栏居中"
				note="760px 一列，从上到下自然滚动。最像文档编辑器 —— 代价是标题滚出视口后要滚回去改。"
			>
				<LayoutDemo which="B" askVariant="v2" />
			</Panel>

			<Panel
				id="block-c"
				tag="C"
				title="新建页 · 三段式"
				note="顶栏固定（标题/模板永在视野）/ 中间章节两列网格 / 底栏固定提交。代价：章节长短不一时网格参差不齐。"
			>
				<LayoutDemo which="C" askVariant="v2" />
			</Panel>

			<Panel
				id="block-ask1"
				tag="①"
				title="ask 编辑器 · 旧版式"
				note="故意照抄旧版（含四个毛病：问题与选项同网格、「多选」飘右上、删除压输入框边缘、选项没有说明层）。作对照用。"
				height="480px"
			>
				<AskStandalone which="v1" />
			</Panel>

			<Panel
				id="block-ask2"
				tag="②"
				title="ask 编辑器 · 设计稿 B"
				note="问题 / 选项分两层 + 单选多选是块级控件 + 选项有序号/把手/常显删除 + 「其它（自己填）」是开关 + 「删除这组」在区块层。"
				height="820px"
			>
				<AskStandalone which="v2" />
			</Panel>

			<footer className="g-foot">
				<p>
					展厅里所有数据都是假的（<code>dev/components/create/data.ts</code>），不接 API。
					三个布局的状态各自独立，改 A 不影响 B。
				</p>
			</footer>
		</div>
	);
}

const root = document.getElementById('root');
if (root !== null) {
	createRoot(root).render(
		<StrictMode>
			<App />
		</StrictMode>,
	);
}
