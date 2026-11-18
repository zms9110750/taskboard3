/**
 * 设计展厅 · **左栏变体** —— 给用户挑的，不是最终版。
 *
 * ## 用户 `2026-11-19`（这一版全部围绕它重写）
 *
 * > 「你给我的预览怎么还是 `dev/preview/gallery/index.html`。
 * >  我已经决定了用左右分栏的。这个什么居中和三段没用啊。
 * >  **你应该给我演示他左栏的各种样子啊。**
 * >  比如 svg 里面的父任务和模板在一行。
 * >  和我要求的父任务和模板分行。
 * >  和你说的模板选择是分 3 列递进选择还是怎么样。
 * >  **你应该把这些东西的组件演示给我看啊。**
 * >  而且**这个模板选择的点开窗口就应该另外做一个组件了**。」
 *
 * ⇒ **布局已定（左右分栏），这里不再演示布局。** 只演示**左栏内部**的排法：
 *
 * | 编号 | 变体 | 一句话 |
 * |---|---|---|
 * | ① | 模板 + 父任务 **同一行** | 旧 SVG 建议的排法：省高度，但两列都变窄 |
 * | ② | 模板 + 父任务 **分行** | 用户 2026-11-18 要的：一列到底，窄栏里更好读 |
 * | ③ | 模板选择：**普通下拉** | 原生 `<select>`，零 JS，选项带「领域 · 名称」 |
 * | ④ | 模板选择：**三级联选弹层** | 点开是「领域 → 类别 → 模板」三列（旧版做法），**独立组件** |
 * | ⑤ | 关系·高级设置：**按钮 + 折叠区** | 两个按钮互斥，内容在下面一块共用折叠区 |
 * | ⑥ | 关系·高级设置：**手风琴** | 内容贴在自己标题下面，从属关系靠位置表达 |
 *
 * ## 每个变体都在 320px 固定宽里
 *
 * 真产品左栏 340px。展厅给 320px —— 用户要看的正是**窄栏里长什么样**，
 * 给宽了怎么排都好看，对比就失效了。① ② 可以并排看，因为它们只差排法。
 *
 * ## 数据都是假的
 *
 * 假模板（3 条带章节）在 `dev/components/create/data.ts` 的 `TEMPLATES`；
 * 三级联选用的是 `TEMPLATE_CATALOG`（18 条，名字/领域/前缀/段数抄自
 * `packages/core/templates/*.yaml`）。不接 API。
 */

import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StrictMode } from 'react';

import { CreateLeftColumn } from '../../components/create/CreateLeftColumn.tsx';
import { CreateLayoutFinal } from '../../components/create/CreateLayoutFinal.tsx';
import { MetaAccordion } from '../../components/create/MetaAccordion.tsx';
import { MetaTabs } from '../../components/create/MetaTabs.tsx';
import { TemplateField } from '../../components/create/TemplateField.tsx';
import { TemplatePickerPopover } from '../../components/create/TemplatePickerPopover.tsx';
import { useCreateForm } from '../../components/create/useCreateForm.ts';
import { DEFAULT_CATALOG_REF, TEMPLATE_CATALOG } from '../../components/create/data.ts';
import type { PickableCard } from '../../components/create/CardPicker.tsx';

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

/* ══════════════════════════════════════════════════════════
   展厅外壳
   ══════════════════════════════════════════════════════════ */

/** 一个变体卡片：大标题 + 一句话说明 + 固定宽演示位。 */
function Variant(props: {
	readonly id: string;
	readonly tag: string;
	readonly title: string;
	readonly note: string;
	/** 演示位宽度（内容宽，不含内边距）。 */
	readonly wide?: boolean;
	readonly children: React.ReactNode;
}): React.ReactNode {
	return (
		<section className={`g-card${props.wide === true ? ' g-card--wide' : ''}`} id={props.id}>
			<div className="g-head">
				<span className="g-tag">{props.tag}</span>
				<h2 className="g-title">{props.title}</h2>
				<p className="g-note">{props.note}</p>
			</div>
			<div className="g-stage">{props.children}</div>
		</section>
	);
}

/* ══════════════════════════════════════════════════════════
   ① / ② · 完整左栏（只差模板与父任务的排法）
   ══════════════════════════════════════════════════════════ */

/** 完整左栏 —— `layout` 是这一对唯一的差别。 */
function LeftColumnDemo(props: { readonly layout: 'inline' | 'stacked' }): React.ReactNode {
	const handle = useCreateForm();

	return (
		<CreateLeftColumn
			template={handle.form.template}
			onChangeTemplate={handle.actions.setTemplate}
			title={handle.form.title}
			onChangeTitle={handle.actions.setTitle}
			cards={PICKABLE_CARDS}
			layout={props.layout}
			control="select"
			shell="tabs"
		/>
	);
}

/* ══════════════════════════════════════════════════════════
   ③ · 普通下拉
   ══════════════════════════════════════════════════════════ */

/**
 * 单独一块模板选择（普通下拉 + 常驻说明）。
 *
 * 不复用 `CreateLeftColumn`：那样截图里会混进标题、父任务、折叠区三块无关的东西，
 * 用户看不出「下拉」这一件事。
 */
function SelectDemo(): React.ReactNode {
	const handle = useCreateForm();

	return (
		<div className="g-focus">
			<TemplateField value={handle.form.template} onChange={handle.actions.setTemplate} />
			<p className="g-hint">
				原生 <code>&lt;select&gt;</code>，选项是「领域 · 名称」。
				模板多起来（现在有 <b>{TEMPLATE_CATALOG.length}</b> 个）之后，
				一个下拉里混着 2 个领域的 4 个类别，找起来要滚。
			</p>
		</div>
	);
}

/* ══════════════════════════════════════════════════════════
   ④ · 三级联选弹层
   ══════════════════════════════════════════════════════════ */

/**
 * 三级联选弹层演示（**弹层独立组件** `TemplatePickerPopover.tsx`）。
 *
 * 默认展开（`defaultOpen`）—— 不展开就只看到一个触发器和普通下拉没差别，
 * 用户要看的正是「点开之后那三列」。
 *
 * ⚠ 说明文字放在**触发器上方**：弹层是 `absolute`，会盖住它下面的任何东西 ——
 *   写在下面的话截图里就只剩半句话（实测踩过）。
 */
function PopoverDemo(): React.ReactNode {
	const [pickedRef, setPickedRef] = useState(DEFAULT_CATALOG_REF);

	return (
		<div className="g-focus g-focus--popover">
			<p className="g-hint">
				点触发器展开三列：<b>领域 → 类别 → 模板</b>。
				类别列前面是<b>字母</b>（G/D/W/R），模板列前面是<b>编号前缀</b>（U/F/E…）。
				选中模板后弹层<b>不关</b>（要看说明），点外面才关。
			</p>
			<div className="tv__cell">
				<span className="a__label">模板</span>
				<TemplatePickerPopover
					pickedRef={pickedRef}
					onPick={(one) => {
						setPickedRef(one.name);
					}}
					defaultOpen
				/>
			</div>
		</div>
	);
}

/* ══════════════════════════════════════════════════════════
   ⑤ / ⑥ · 关系 | 高级设置 的两种折叠外壳
   ══════════════════════════════════════════════════════════ */

/**
 * 折叠区演示 —— `shell` 是这一对唯一的差别，面板内容**完全同一套**
 * （`MetaPanelContent.tsx`），不然并排对比会混进假差异。
 *
 * 预先塞一条关系（`DM-01`）—— 空列表的话「关系 1」这个计数和删除键都看不出来。
 */
function MetaDemo(props: { readonly shell: 'tabs' | 'acc' }): React.ReactNode {
	const [relations, setRelations] = useState<readonly { kind: string; to: string }[]>([
		{ kind: 'dependsOn', to: 'DM-01' },
	]);

	const body = {
		relations,
		onRelationsChange: setRelations,
		cards: PICKABLE_CARDS,
		initial: 'rel' as const,
	};

	return (
		<div className="g-focus">
			{props.shell === 'acc' ? <MetaAccordion {...body} /> : <MetaTabs {...body} />}
			<p className="g-hint">
				{props.shell === 'acc'
					? '手风琴：内容贴在自己标题下面，「▾ 关系 1」本身就说明了这块属于谁。'
					: '按钮 + 折叠区：两个按钮互斥，内容在按钮下方一块共用区域。再点已开的收起。'}
			</p>
		</div>
	);
}

/* ══════════════════════════════════════════════════════════
   完整对照（布局已定，留一份在这里以便对未来齐）
   ══════════════════════════════════════════════════════════ */

/** 完整左右分栏（左栏 + 右栏章节）。不是变体，是对照。 */
function FinalDemo(): React.ReactNode {
	const handle = useCreateForm();
	return (
		<div className="g-final">
			<CreateLayoutFinal handle={handle} askVariant="v2" cards={PICKABLE_CARDS} />
		</div>
	);
}

/* ══════════════════════════════════════════════════════════
   页面
   ══════════════════════════════════════════════════════════ */

const NAV: readonly { readonly id: string; readonly label: string }[] = [
	{ id: 'v1', label: '① 模板/父任务 同一行' },
	{ id: 'v2', label: '② 模板/父任务 分行' },
	{ id: 'v3', label: '③ 模板选择 · 普通下拉' },
	{ id: 'v4', label: '④ 模板选择 · 三级联选弹层' },
	{ id: 'v5', label: '⑤ 关系/高级 · 按钮+折叠区' },
	{ id: 'v6', label: '⑥ 关系/高级 · 手风琴' },
];

/** 展厅页。 */
function App(): React.ReactNode {
	return (
		<div className="gallery">
			<header className="g-intro">
				<h1>设计展厅 · 左栏变体</h1>
				<p>
					布局已定：<b>左右分栏</b>。这里<b>不</b>再看布局 —— 只看<b>左栏内部</b>的几种排法。
					每个变体固定在 <b>320px</b> 窄栏里演示（真产品左栏 340px）。
				</p>
				<p className="g-intro-sub">
					左栏是窄的，所以①②并排、③④并排、⑤⑥并排 —— 可以直接对着看。
				</p>
			</header>

			<nav className="g-index">
				{NAV.map((one) => (
					<a key={one.id} href={`#${one.id}`}>
						{one.label}
					</a>
				))}
				<a href="#block-final">★ 完整对照</a>
			</nav>

			{/* ── ①② 排法：唯一差别是「同一行 / 分行」 ── */}
			<div className="g-row">
				<Variant
					id="v1"
					tag="①"
					title="模板 + 父任务 同一行"
					note="旧 SVG 建议的排法。省一行高度；代价是模板下拉和父任务各只剩半宽，模板名和卡标题都容易截断。"
				>
					<LeftColumnDemo layout="inline" />
				</Variant>

				<Variant
					id="v2"
					tag="②"
					title="模板 + 父任务 分行"
					note="你 2026-11-18 要的排法。一列到底，每个字段都占满栏宽；代价是左栏长一行（窄栏里这一行不贵）。"
				>
					<LeftColumnDemo layout="stacked" />
				</Variant>
			</div>

			{/* ── ③④ 模板控件：下拉 vs 三级联选弹层 ── */}
			<div className="g-row">
				<Variant
					id="v3"
					tag="③"
					title="模板选择 · 普通下拉"
					note="现在这样：原生 select，选项「领域 · 名称」。简单但模板一多就得在长列表里滚。"
				>
					<SelectDemo />
				</Variant>

				<Variant
					id="v4"
					tag="④"
					title="模板选择 · 三级联选弹层"
					note="独立组件 TemplatePickerPopover.tsx。点开是「领域 → 类别 → 模板」三列，每列 ○/● 或字母 + 名字。"
					wide
				>
					<PopoverDemo />
				</Variant>
			</div>

			{/* ── ⑤⑥ 折叠外壳：按钮+折叠区 vs 手风琴 ── */}
			<div className="g-row">
				<Variant
					id="v5"
					tag="⑤"
					title="关系 | 高级设置 · 按钮 + 折叠区"
					note="旧版做法：两个按钮互斥，点开的那个高亮，内容在按钮下方一块共用区域里。已展开「关系」。"
				>
					<MetaDemo shell="tabs" />
				</Variant>

				<Variant
					id="v6"
					tag="⑥"
					title="关系 | 高级设置 · 手风琴"
					note="内容贴在自己标题下面，标题变成「▾ 关系 1」。从属关系靠位置表达，不用在按钮和内容之间来回看。"
				>
					<MetaDemo shell="acc" />
				</Variant>
			</div>

			{/* ── 完整对照 ── */}
			<section className="g-block" id="block-final">
				<div className="g-head">
					<span className="g-tag">★</span>
					<h2 className="g-title">完整对照 · 左右分栏（左栏 + 右栏章节）</h2>
					<p className="g-note">
						<b>不是变体</b>，是「这些东西装回完整页面之后是什么样」的对照。
						左栏现在是：标题 → 模板 → 父任务 → [关系|高级设置] → 折叠区（= ① 与 ② 里的②排法 + ⑤ 外壳）。
					</p>
				</div>
				<div className="g-final">
					<FinalDemo />
				</div>
			</section>

			<footer className="g-foot">
				<p>
					所有数据都是假的（<code>dev/components/create/data.ts</code>），不接 API。
					① ② ③ ⑤ ⑥ 用 3 条假模板；④ 的目录是 18 条真模板的元数据（抄自{' '}
					<code>packages/core/templates/*.yaml</code>）。
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
