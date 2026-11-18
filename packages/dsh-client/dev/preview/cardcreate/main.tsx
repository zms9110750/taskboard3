/**
 * 建卡页预览 —— **完整可用的新建页**（左栏已定稿，不再是假插槽）。
 *
 * ## 这次换掉了什么
 *
 * 上一版预览用 `FakeLeftPane` 证明「插槽接得上」。用户 `2026-11-19` 在展厅里选完
 * 左栏排法（「用 245」= ② 分行 + ④ 三级联选 + ⑤ 按钮折叠区），左栏成了真组件
 * `CreateLeftColumn` ⇒ 这个预览现在就是**产品页面本身**：
 *
 * ```
 * ┌────────────────────────────────────────────────┐
 * │ 新建事项                                   ×   │
 * ├──────────────┬─────────────────────────────────┤
 * │ 标题 *       │ 章节表单（按模板生成）           │
 * │ 模板 ▾三列   │                                 │
 * │ 父任务 ▾     │                                 │
 * │ [关系][高级] │                                 │
 * ├──────────────┴─────────────────────────────────┤
 * │                        [取消] [提交]           │
 * └────────────────────────────────────────────────┘
 * ```
 *
 * ⚠ **没有演示条。** 上一层浮动的演示条会盖住产品自己的顶栏，截图里看到的就不是
 *   产品页面了。这个预览里的一切都是产品的样子。
 *
 * ## 样式用**真的**
 *
 * `injectStyles()` 注入 `src/styles.ts` 的 `CREATE_CSS` —— 预览和产品是同一份 CSS。
 * `style.css` 只留预览特有的一点点（页面底色、丢内容提示条）。
 * 上一版在 `style.css` 里抄了一整套 `tb3cc-*` 规则 ⇒ 改产品样式时预览不跟着变，
 * 看起来「预览是对的、产品是坏的」。
 *
 * ## 假数据从哪来（以及为什么这么假）
 *
 * 没有服务端，所以：
 *
 * - **模板清单**：18 个模板的 `ref` / `displayName` / `kind` / `domain` / `codePrefix` /
 *   `usage` / 章节名，全部抄自 `packages/core/templates/*.yaml`。章节的 hint 和默认值
 *   不抄（那要解析 YAML），用 `emptyPayloadOf()` 生成空 payload —— 和真实新建时的
 *   「模板给了默认值就填、没给就空」的最终形状一致。
 * - **类别中文名**：抄自 `packages/core/src/template/kinds.ts` 的 `BUILTIN_KINDS`。
 *   ⚠ 客户端**没有** `/api/kinds` 路由 ⇒ 产品里这四个中文名要由调用方注入
 *   （`CreateLeftColumn` 的 `kindLabelOf` 是可选 prop，不传就显示英文 id）。
 *   预览里直接写死，是因为它就是一份 core 数据的镜像，不是产品代码。
 * - **卡**：8 张正常 + 2 张该被过滤的（草稿 `GU-01` / 墓碑 `RB-99`），
 *   用来验证 `CardPicker` 的过滤还在。
 */

import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StrictMode } from 'react';

import type { CreateDraft, SectionKind } from '../../../src/pure/create-types.ts';
import type { PickerTemplate } from '../../../src/pure/template-picker.ts';
import { CardCreate } from '../../../src/renderers/create/CardCreate.tsx';
import type { PickableCard } from '../../../src/renderers/create/CardPicker.tsx';
import { CreateLeftColumn } from '../../../src/renderers/create/CreateLeftColumn.tsx';
import {
	sectionsOfTemplate,
	useCreateForm,
	type FormTemplate,
} from '../../../src/renderers/create/useCreateForm.ts';
import { injectStyles } from '../../../src/styles.ts';

/* ══════════════════════════════════════════════════════════
   模板数据（抄自 core 的 YAML）
   ══════════════════════════════════════════════════════════ */

/** 一节：`[id, label, action]`。hint / 默认值不抄，用空 payload。 */
type SecTuple = readonly [string, string, SectionKind];

/** 目录里的一条（`PickerTemplate` + 章节清单）。 */
interface CatalogEntry extends PickerTemplate {
	/** 预览里每个模板都写了说明 ⇒ 这里收紧成必填（`PickerTemplate` 上它是可选的）。 */
	readonly usage: string;
	readonly codePrefix: string;
	readonly sections: readonly SecTuple[];
}

/**
 * 造一条目录项。
 *
 * @param ref 模板 ref
 * @param displayName 显示名
 * @param kind 类别 id
 * @param domain 领域
 * @param codePrefix 编号字母段
 * @param usage 一句话说明
 * @param secs 章节 `[id, label, action]`
 */
function tpl(
	ref: string,
	displayName: string,
	kind: string,
	domain: string,
	codePrefix: string,
	usage: string,
	secs: readonly SecTuple[],
): CatalogEntry {
	return { ref, displayName, kind, domain, codePrefix, usage, sectionCount: secs.length, sections: secs };
}

/** 18 个模板 —— 名字 / 类别 / 领域 / 前缀 / 章节名全部照抄 `packages/core/templates/*.yaml`。 */
const CATALOG: readonly CatalogEntry[] = Object.freeze([
	/* ── 核心 ── */
	tpl('userNeed', '用户任务', 'goal', '核心', 'U', '用户向 ai 发布任务。只有一个自由章节，可以把需求一股脑写下来。', [
		['core-userNeed', '我想要什么', 'text'],
	]),
	tpl('decision', '决策', 'design', '核心', 'C', '方向还没定，先把它摆出来。要等目标或调研回来才能定。', [
		['directions', '可能的方向', 'text'],
		['helpful', '知道什么信息后对决策有帮助', 'text'],
		['lookAt', '我可以看什么来得到方向', 'text'],
	]),
	tpl('question', '提问', 'design', '核心', 'Q', '需要使用 ask 工具时用这个模板，防止消息循环阻塞。', [
		['question', '需要回答的问题', 'ask'],
		['blocked', '不回答的话，这些将无法继续', 'markdown'],
	]),
	tpl('research', '调研', 'work', '核心', 'S', '不知道该怎么做之前，先查清楚。', [
		['question', '要查什么', 'text'],
		['method', '怎么查', 'text'],
		['noInfo', '没有信息时，怎么知道怎么查', 'text'],
		['costLimit', '最高收益是什么；查询成本多大时无法接受', 'text'],
	]),
	tpl('demo', '演示', 'work', '核心', 'D', '为设计的方向提供一个极小实现以验证想法。', [
		['idea', '要验证的想法', 'text'],
		['demo', '极小实现', 'text'],
		['boundary', '不能进项目的东西', 'text'],
		['confirm', '请用户确认什么', 'text'],
	]),
	tpl('verify', '校验', 'work', '核心', 'V', '执行一个动作看实际结果：编译、跑测试、跑一遍看行为。', [
		['target', '校验什么', 'text'],
		['expected', '预期的结果鉴别', 'text'],
		['method', '怎么校验', 'text'],
	]),
	tpl('delivery', '交付', 'record', '核心', 'L', '工作结果需要一个交付子任务汇报，才能把工作通过。', [
		['what', '交付了什么', 'markdown'],
		['where', '在哪里', 'markdown'],
		['howToLook', '怎么查看 / 怎么使用', 'markdown'],
	]),
	tpl('archive', '留档', 'record', '核心', 'A', '有东西要留着，记下来。并且不需要用户介入的事情。', [
		['what', '留档内容', 'markdown'],
		['why', '留档适用性', 'markdown'],
	]),
	tpl('blocker', '阻碍', 'record', '核心', 'B', '遇到阻碍，需要用户授意是否解决、怎么解决。', [
		['situation', '现在是什么情况', 'markdown'],
		['stuck', '这个情况下，什么无法进一步', 'markdown'],
	]),
	tpl('retro', '复盘', 'record', '核心', 'P', '一批失败之后，写清楚缺什么信息、以及凭什么相信下一次。', [
		['needed', '为了完成任务我需要知道什么', 'markdown'],
		['missing', '我失败是因为不知道什么', 'markdown'],
		['next', '我为什么相信下一次可能成功', 'markdown'],
	]),
	/* ── 代码 ── */
	tpl('expectedMismatch', '预期不符', 'goal', '代码', 'E', '用户认为某处不对，但还没确认是不是缺陷。先定性，再定下一步。', [
		['summary', '一句话描述', 'text'],
		['expect', '希望发生什么', 'text'],
		['expectSource', '为什么这么想', 'ask'],
		['actual', '实际发生什么', 'text'],
		['locate', '怎么定位', 'text'],
		['note', '补充说明', 'text'],
	]),
	tpl('newFeature', '新增功能', 'goal', '代码', 'F', '用户要一个现在没有的东西，目标能说清，但怎么做要先拆开分别定。', [
		['behavior', '需要有什么行为', 'text'],
		['motivation', '动机', 'text'],
		['concerns', '应当考虑的问题', 'text'],
		['nonGoal', '非目标', 'text'],
	]),
	tpl('optimize', '项目优化', 'goal', '代码', 'O', '已有项目在不改对外行为的前提下改内部：更快、更清楚、更好扩展。', [
		['aspect', '优化类型', 'ask'],
		['where', '优化哪', 'text'],
	]),
	tpl('writeTests', '编写测试', 'goal', '代码', 'T', '用户要一套能留在项目里、以后能反复跑的测试代码。', [
		['testType', '测试类型', 'ask'],
		['coverage', '测什么', 'text'],
		['expected', '预期行为', 'text'],
		['nonGoal', '非目标', 'text'],
	]),
	tpl('architecture', '技术架构', 'design', '代码', 'R', '用户要新建项目，或要换掉整个技术底座 —— 此时还没有框架。', [
		['architecture', '选择什么架构', 'text'],
		['packages', '可能采用的包', 'text'],
		['nonGoal', '明确不采用', 'text'],
		['check', '怎么判断选型成立', 'text'],
	]),
	tpl('interfaceUi', '接口界面', 'design', '代码', 'I', '决定对外暴露几个入口、每个入口长什么样。', [
		['behavior', '需要有什么行为', 'text'],
		['exposed', '暴露什么东西', 'text'],
		['mapping', '接口和行为的条件映射', 'text'],
		['undecided', '还没决定的行为和接口', 'text'],
	]),
	tpl('lowLevel', '底层实现', 'design', '代码', 'M', '把接口界面的承诺补到能兑现：内部怎么拆、用哪个库、边界与报错形式。', [
		['interface', '接口，参数', 'text'],
		['deps', '用什么', 'text'],
		['edgeCases', '边缘情况边界', 'text'],
	]),
	tpl('writeCode', '编写代码', 'work', '代码', 'W', '真正动手改代码 —— 实现类路径的最后一站。', [
		['what', '要写什么', 'text'],
		['magic', '现在拍脑袋决定的东西', 'text'],
	]),
]);

/** ref → 目录项。 */
const ENTRY_BY_REF: ReadonlyMap<string, CatalogEntry> = new Map(
	CATALOG.map((one) => [one.ref, one]),
);

/** 预览初始模板（章节多、能撑出右栏滚动）。 */
const INITIAL_REF = 'expectedMismatch';

/**
 * 类别中文名 —— **抄自 `packages/core/src/template/kinds.ts` 的 `BUILTIN_KINDS`**。
 *
 * ⚠ 客户端没有 `/api/kinds` 路由，`TemplateSummary` 也不带类别中文名 ⇒
 *   产品里这四个名字要由调用方注入（`CreateLeftColumn` 的 `kindLabelOf`）。
 *   预览里写死，因为预览是 core 数据的镜像，不是产品代码。
 */
const KIND_LABELS: Readonly<Record<string, string>> = Object.freeze({
	goal: '目标',
	design: '设计',
	work: '工作',
	record: '记录',
});

/** 类别字母（同上，抄自 core 的 `BUILTIN_KINDS[].letter`）。 */
const KIND_LETTERS: Readonly<Record<string, string>> = Object.freeze({
	goal: 'G',
	design: 'D',
	work: 'W',
	record: 'R',
});

/**
 * 目录项 → 表单模板（`FormTemplate`）。
 *
 * 模板的 `hint` / 默认 payload 没抄 YAML（那要解析 YAML），交给
 * `sectionsOfTemplate()` 用 `emptyPayloadOf()` 生成 —— 和真实新建时「模板没给默认值」
 * 的最终形状一致。
 *
 * @param entry 目录项
 */
function formTemplateOf(entry: CatalogEntry): FormTemplate {
	return {
		ref: entry.ref,
		displayName: entry.displayName,
		codePrefix: entry.codePrefix ?? '',
		kind: entry.kind,
		domain: entry.domain,
		usage: entry.usage ?? '',
		sections: entry.sections.map(([id, label, action]) => ({ id, label, hint: '', action })),
	};
}

/* ══════════════════════════════════════════════════════════
   卡（父任务 / 关系目标的候选）
   ══════════════════════════════════════════════════════════ */

/**
 * 候选卡 —— 故意混入两类**应该被滤掉**的：
 *
 * - `GU-01` 是草稿（`TASK_STATE_UNSPECIFIED`）⇒ 不能当父任务 / 关系目标
 * - `RB-99` 已删除（`deleted: true`）⇒ 不列
 *
 * 这样截图和 CDP 断言里能直接看出过滤生效了。
 */
const CARDS: readonly PickableCard[] = Object.freeze([
	{ id: 'DM-01', title: '卡片的编号前缀怎么拼', status: 'TASK_STATE_SUBMITTED', deleted: false },
	{ id: 'WW-01', title: '查一下分组为空的渲染路径', status: 'TASK_STATE_WORKING', deleted: false },
	{ id: 'WF-01', title: '编号应带模板前缀', status: 'TASK_STATE_INPUT_REQUIRED', deleted: false },
	{ id: 'WS-01', title: '现有任务板实现的调研', status: 'TASK_STATE_AUTH_REQUIRED', deleted: false },
	{ id: 'RB-01', title: '分组为空时记阻碍', status: 'TASK_STATE_COMPLETED', deleted: false },
	{ id: 'GT-01', title: '补一条空分组的用例', status: 'TASK_STATE_FAILED', deleted: false },
	{ id: 'GT-02', title: 'ask 交互隔离验收', status: 'TASK_STATE_CANCELED', deleted: false },
	{ id: 'GT-03', title: '未选择头部验收', status: 'TASK_STATE_REJECTED', deleted: false },
	/* ⚠ 下面两张应该被 CardPicker 滤掉 —— 用来验证过滤生效 */
	{ id: 'GU-01', title: '把任务板的语义定清楚（草稿，不该出现）', status: 'TASK_STATE_UNSPECIFIED', deleted: false },
	{ id: 'RB-99', title: '已删除的卡（墓碑，不该出现）', status: 'TASK_STATE_COMPLETED', deleted: true },
]);

/* ══════════════════════════════════════════════════════════
   三种真实尺寸的舞台
   ══════════════════════════════════════════════════════════ */

/**
 * 用户 `2026-11-19` 给的三个真实尺寸。
 *
 * ⚠ **这不是「三个宽度档」** —— 它是两个独立维度：
 * - 570 **宽** ⇒ 横向放不下左右分栏 ⇒ 堆叠（结构变）
 * - 400 **高** ⇒ 纵向放不下那么多行 ⇒ 收紧间距（结构不变）
 *
 * ⇒ 预览必须能**分别**演出这三档，否则「抽屉 1200×400 不该堆叠」这条约束
 *   在开发时看不出来（全屏里横排，窄屏里堆叠，就它两头不靠）。
 */
interface Stage {
	readonly id: string;
	readonly label: string;
	readonly note: string;
	readonly width: number;
	readonly height: number;
}

const STAGES: readonly Stage[] = Object.freeze([
	{
		id: 'workspace',
		label: '工作区 570 × 920',
		note: '窄、高 ⇒ 左右分栏挤不下 ⇒ 上下堆叠',
		width: 570,
		height: 920,
	},
	{
		id: 'drawer',
		label: '抽屉 1200 × 400',
		note: '宽、矮 ⇒ **横排**（绝不能堆叠，否则 400 高里塞两栏会死）+ 收紧纵向间距',
		width: 1200,
		height: 400,
	},
	{
		id: 'full',
		label: '全屏 1600 × 1000',
		note: '都够 ⇒ 什么都不用改',
		width: 1600,
		height: 1000,
	},
]);

/* ══════════════════════════════════════════════════════════
   页面
   ══════════════════════════════════════════════════════════ */

/** 预览页。 */
function App(): React.ReactNode {
	const [stageId, setStageId] = useState('full');
	const [pickedRef, setPickedRef] = useState(INITIAL_REF);
	const [notice, setNotice] = useState<string | undefined>(undefined);

	const stage = STAGES.find((one) => one.id === stageId) ?? (STAGES[2] as Stage);

	const template = useMemo(() => {
		const entry = ENTRY_BY_REF.get(pickedRef);
		return entry === undefined ? undefined : formTemplateOf(entry);
	}, [pickedRef]);

	const form = useCreateForm({
		template,
		pickableCards: CARDS,
		onSubmit: (submission) => {
			/* 没有服务端：把要提交的东西原样打出来，证明整条链路能走到提交。 */
			globalThis.alert(`提交（假服务端）：\n${JSON.stringify(submission, null, 2)}`);
		},
		onCancel: () => {
			globalThis.alert('取消（假）');
		},
	});

	/**
	 * 草稿变了。
	 *
	 * ⚠ **换模板时要重建章节**，而那要模板详情（本预览里在 `CATALOG` 里）。
	 *   产品里这一步由调用方做（先 `GET /api/templates?ref=` 再
	 *   `sectionsOfTemplate()`）—— `CreateLeftColumn` 不知道有网络，只改 `templateRef`。
	 *   这条边界正是「左栏不持有草稿、不做 I/O」的意思。
	 */
	const onChange = (next: CreateDraft): void => {
		if (next.templateRef === pickedRef) {
			form.actions.applyDraft(next);
			return;
		}
		setPickedRef(next.templateRef);
		const entry = ENTRY_BY_REF.get(next.templateRef);
		const nextTemplate = entry === undefined ? undefined : formTemplateOf(entry);
		form.actions.applyDraft({
			...next,
			sections: sectionsOfTemplate(nextTemplate, next.sections),
		});
	};

	return (
		<div className="pv">
			{/*
			 * 舞台切换条 —— **预览专属**，在产品外面。
			 * ⚠ 它挂在舞台外面，所以产品截图里看不到它（截图只截舞台那块）。
			 */}
			<header className="pv-bar">
				<span className="pv-bar__tag">CardCreate · 三种真实尺寸</span>
				{STAGES.map((one) => (
					<button
						key={one.id}
						type="button"
						className={`pv-bar__btn${one.id === stage.id ? ' is-on' : ''}`}
						data-stage-btn={one.id}
						onClick={() => {
							setStageId(one.id);
						}}
					>
						{one.label}
					</button>
				))}
				<span className="pv-bar__note">{stage.note}</span>
			</header>

			{/*
			 * 舞台 —— 尺寸就是**真实尺寸**（不是缩放、不是近似）。
			 *
			 * ⚠ 用了 `transform: scale()` 缩小的话，`container-type:size` 的容器查询
			 *   仍然按**未缩放**的逻辑尺寸算（CSS 像素），断言也能过；但
			 *   `.tb3cc-tpick__pop` 是 `position:fixed` + 量 `getBoundingClientRect()`，
			 *   而**祖先是 transform 时 fixed 会相对祖先定位**，两套坐标系混起来会错位。
			 *   ⇒ 不用缩放：舞台按真实 px 摆，外层页面自己滚。这也最诚实 ——
			 *   看到的就是产品在那种容器里真实的样子。
			 */}
			<div className="pv-scroll">
				<div
					className="pv-stage"
					data-stage={stage.id}
					style={{ width: `${String(stage.width)}px`, height: `${String(stage.height)}px` }}
				>
					<CardCreate
						draft={form.draft}
						onChange={onChange}
						errors={form.errors}
						/*
						 * 左栏插槽用**函数形态**才拿得到 `errorOf` —— 标题 / 模板的错误要显示在
						 * 各自输入框下面（`/sections/*` 的错误由 `CardCreate` 自己挂在右栏）。
						 */
						leftPane={(ctx) => (
							<CreateLeftColumn
								draft={form.draft}
								onChange={onChange}
								ctx={ctx}
								templates={CATALOG}
								cards={CARDS}
								hintOf={(ref) => {
									const entry = ENTRY_BY_REF.get(ref);
									if (entry === undefined) return undefined;
									return {
										usage: entry.usage,
										codePrefix: entry.codePrefix,
										sectionCount: entry.sections.length,
									};
								}}
								kindLabelOf={(kind) => KIND_LABELS[kind] ?? kind}
								kindLetterOf={(kind) => KIND_LETTERS[kind] ?? kind.slice(0, 1).toUpperCase()}
							/>
						)}
						onSubmit={form.actions.submit}
						onCancel={() => {
							form.actions.dismissLostNotice();
						}}
						onLostContent={(label) => {
							setNotice(`「${label}」原来的内容已清空（新类型的数据结构与它不兼容）。`);
						}}
					/>
				</div>
			</div>

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
		</div>
	);
}

/* 产品样式和预览是同一份 —— 不在预览的 style.css 里抄一份。 */
injectStyles();

const root = document.getElementById('root');
if (root !== null) {
	createRoot(root).render(
		<StrictMode>
			<App />
		</StrictMode>,
	);
}
