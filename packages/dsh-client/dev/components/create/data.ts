/**
 * @deprecated 展厅副本 —— 冻结保存，**不要在这里改行为**。
 *
 * `dev/` 的这一批文件是 `dev/README.md` 明示的冻结展厅副本：产品版在
 * `src/renderers/create/` / `src/pure/`，两边不共享代码。改行为只改 `src/` 那份；
 * 本文件存在只为展厅还能构建、还能回看当时挑的是什么。
 */
/**
 * 展厅用的假数据 —— **不接真 API**。
 *
 * ## 为什么单独一个文件
 *
 * 三个布局共用同一份模板和同一批章节。数据散在三个组件里的话，
 * 用户对比布局时会发现「A 有三章、B 只有两章」，那就没法比了。
 *
 * ⚠ 这里的形状抄自 core 的 `TemplateDef` / `SectionDef`，字段名一致，
 *   将来接真 API 时把这个文件换成 `state.templates` 就行。
 */

/** 内容类型 —— 与 core 的 `action` 词表一致。 */
export type SectionKind = 'text' | 'markdown' | 'ask';

/** 章节定义。 */
export interface FakeSection {
	/** 稳定 id（`Card.sections` 的 key）。 */
	readonly id: string;
	/** 章节名。**用模板给的，不要编「正文」** —— 用户 2026-11-15 已否定过。 */
	readonly label: string;
	/** 这一章用哪种内容类型。 */
	readonly kind: SectionKind;
	/** 填写提示（灰字）。 */
	readonly hint: string;
}

/** 模板定义（窄版）。 */
export interface FakeTemplate {
	readonly ref: string;
	readonly displayName: string;
	readonly kind: string;
	readonly domain: string;
	/** 编号前缀。 */
	readonly codePrefix: string;
	/** 使用说明（选中模板后显示在下方）。 */
	readonly usage: string;
	readonly sections: readonly FakeSection[];
}

/**
 * 内容类型的中文名 —— **这是「产品词」，不是字段名**。
 *
 * `action-picker-inside-dialog.png` 左半的建议：
 * 不要出现 `action: text`，要用「内容类型：纯文本（text）」这种。
 */
export const KIND_LABEL: Readonly<Record<SectionKind, string>> = Object.freeze({
	text: '纯文本',
	markdown: 'Markdown',
	ask: '选项',
});

/** 内容类型的英文小字（放在中文名后面的括号里）。 */
export const KIND_TAG: Readonly<Record<SectionKind, string>> = Object.freeze({
	text: 'text',
	markdown: 'markdown',
	ask: 'ask',
});

/** 三个模板（下拉里能选）。 */
export const TEMPLATES: readonly FakeTemplate[] = Object.freeze([
	{
		ref: 'expectedMismatch',
		displayName: '预期不符',
		kind: 'record',
		domain: '核心',
		codePrefix: 'E',
		usage:
			'反馈 bug，不过在查明之前不能确认真的是 bug。' +
			'写清「期望是什么」和「实际看到什么」，两者都要能复核。',
		sections: [
			{
				id: 'summary',
				label: '一句话描述',
				kind: 'text',
				hint: '一句话说清，别写背景',
			},
			{
				id: 'expected',
				label: '期望发生什么',
				kind: 'markdown',
				hint: '正常应该是什么样，可写多行',
			},
			{
				id: 'basis',
				label: '为什么这么想',
				kind: 'ask',
				hint: '这个预期的依据',
			},
		],
	},
	{
		ref: 'architecture',
		displayName: '技术架构',
		kind: 'design',
		domain: '代码',
		codePrefix: 'R',
		usage: '用户要新建项目，或要换掉整个技术底座 —— 此时还没有框架。',
		sections: [
			{ id: 'arch', label: '选择什么架构', kind: 'text', hint: '选什么架构，为什么' },
			{ id: 'pkgs', label: '可能采用的包', kind: 'markdown', hint: '候选的包 / 库 / 服务' },
			{ id: 'nogool', label: '明确不采用', kind: 'ask', hint: '这次明确不采用什么' },
		],
	},
	{
		ref: 'blocker',
		displayName: '阻碍',
		kind: 'record',
		domain: '核心',
		codePrefix: 'B',
		usage: '卡住了。写清「卡在哪」「试过什么」「谁能解」。',
		sections: [
			{ id: 'what', label: '卡在哪', kind: 'text', hint: '一句话说清卡点' },
			{ id: 'tried', label: '试过什么', kind: 'markdown', hint: '列已排除的路径' },
			{ id: 'who', label: '需要谁', kind: 'ask', hint: '谁能解这个卡点' },
		],
	},
]);

/** 默认选中的模板。 */
export const DEFAULT_TEMPLATE_REF = 'expectedMismatch';

/** 章节的初始内容（三章分别是 text / markdown / ask）。 */
export const INITIAL_VALUES: Readonly<Record<string, string>> = Object.freeze({
	summary: '任务板分组为空时，卡片列表整片空白。',
	expected:
		'## 期望\n\n分组为空应该显示 **空状态提示**，而不是空白：\n\n- 说明这个分组还没有卡\n- 给一个「新建」入口\n\n```\n当前：<div class="group"></div>\n期望：<div class="group">暂无任务</div>\n```',
	basis: '',
});

/** 为什么这么想的预设选项（`detail-ask-editor.png` 里的那六条）。 */
export const ASK_OPTIONS: readonly { readonly label: string; readonly description: string }[] =
	Object.freeze([
		{ label: '望文生义', description: '从语义说，这个东西在这里长这样就应该这样做才有道理' },
		{ label: '同类产品', description: '具有类似功能的项目实现，具有这样的行为' },
		{ label: '附带文档', description: '这个项目自己表示会这样说，包括更新说明和 readme' },
		{ label: '社区传闻', description: '有 wiki，或视频平台，论坛，有记录的表明显很多人这样认为' },
		{ label: '历史惯性', description: '曾经是这样的行为，更新没说会变，但变了' },
		{ label: '官方暗示', description: '开发者访谈，笔记，博客，或者维护者在社区宣称' },
	]);

/** 默认选中的依据（第 1 条）。 */
export const ASK_PICKED: readonly string[] = Object.freeze(['望文生义']);

/* ══════════════════════════════════════════════════════════
   模板目录 —— **三级联选弹层用的完整清单**
   ══════════════════════════════════════════════════════════ */

/*
 * ## 为什么这里有两份模板数据
 *
 * - `TEMPLATES`（上面）：3 条**带章节的假模板**，给右侧章节表单用。
 *   章节内容（text / markdown / ask 各一条）是手写的，用来演示编辑器。
 * - `TEMPLATE_CATALOG`（下面）：**18 条真模板**，名字 / 领域 / 类别 / 编号前缀 /
 *   段数**全部抄自 `packages/core/templates/*.yaml`**，用来演示「模板多起来之后，
 *   下拉 vs 三级联选」的差别。
 *
 * ⚠ 两份都要，因为它们的用途不同：前者要章节内容（假），后者要完整的目录规模（真）。
 *   接真 API 之后 `TEMPLATE_CATALOG` 换成 `state.templates`，`TEMPLATES` 直接删掉。
 */

/** 分类的四个值 —— 与 `protocol` 的 `KIND_ORDER` 同序。 */
export type TemplateKind = 'goal' | 'design' | 'work' | 'record';

/**
 * 分类 → 中文名 + 编号字母。
 *
 * ⚠ 字母是 `core` 的 `kindLetter` 知识（类别前缀），模板自己的前缀在
 *   `CatalogTemplate.codePrefix`，**两者不是一回事**。
 */
export const KIND_META: Readonly<
	Record<TemplateKind, { readonly label: string; readonly letter: string }>
> = Object.freeze({
	goal: { label: '目标', letter: 'G' },
	design: { label: '设计', letter: 'D' },
	work: { label: '工作', letter: 'W' },
	record: { label: '记录', letter: 'R' },
});

/** 三级联选里的一条模板（字段取自 `packages/core/templates/*.yaml`）。 */
export interface CatalogTemplate {
	/** 稳定 ref（YAML 的 `name`）。 */
	readonly name: string;
	readonly displayName: string;
	readonly kind: TemplateKind;
	/** 领域（`核心` / `代码`）。 */
	readonly domain: string;
	/** 编号前缀字母（`E` / `U` …）；空串 = 该模板不提供字母段。 */
	readonly codePrefix: string;
	/** 一句话说明（YAML 的 `usage` 首句）。 */
	readonly usage: string;
	/** 段数（YAML 的 `sections` 条数）。 */
	readonly sectionCount: number;
}

/** 18 个模板 —— 真名 / 真领域 / 真前缀 / 真段数。 */
export const TEMPLATE_CATALOG: readonly CatalogTemplate[] = Object.freeze([
	/* ── 核心 ── */
	{
		name: 'userNeed',
		displayName: '用户任务',
		kind: 'goal',
		domain: '核心',
		codePrefix: 'U',
		usage: '用户向 ai 发布任务。只有一个自由章节，可以把需求一股脑写下来。',
		sectionCount: 1,
	},
	{
		name: 'decision',
		displayName: '决策',
		kind: 'design',
		domain: '核心',
		codePrefix: 'C',
		usage: '方向还没定，先把它摆出来。要等目标或调研回来才能定。',
		sectionCount: 3,
	},
	{
		name: 'question',
		displayName: '提问',
		kind: 'design',
		domain: '核心',
		codePrefix: 'Q',
		usage: '需要使用 ask 工具时用这个模板，防止消息循环阻塞。',
		sectionCount: 2,
	},
	{
		name: 'research',
		displayName: '调研',
		kind: 'work',
		domain: '核心',
		codePrefix: 'S',
		usage: '不知道该怎么做之前，先查清楚。',
		sectionCount: 4,
	},
	{
		name: 'demo',
		displayName: '演示',
		kind: 'work',
		domain: '核心',
		codePrefix: 'D',
		usage: '为设计的方向提供一个极小实现以验证想法。',
		sectionCount: 4,
	},
	{
		name: 'verify',
		displayName: '校验',
		kind: 'work',
		domain: '核心',
		codePrefix: 'V',
		usage: '执行一个动作看实际结果：编译、跑测试、跑一遍看行为。',
		sectionCount: 3,
	},
	{
		name: 'delivery',
		displayName: '交付',
		kind: 'record',
		domain: '核心',
		codePrefix: 'L',
		usage: '工作结果需要一个交付子任务汇报，才能把工作通过。',
		sectionCount: 3,
	},
	{
		name: 'archive',
		displayName: '留档',
		kind: 'record',
		domain: '核心',
		codePrefix: 'A',
		usage: '有东西要留着，记下来。并且不需要用户介入的事情。',
		sectionCount: 2,
	},
	{
		name: 'blocker',
		displayName: '阻碍',
		kind: 'record',
		domain: '核心',
		codePrefix: 'B',
		usage: '遇到阻碍，需要用户授意是否解决、怎么解决。',
		sectionCount: 2,
	},
	{
		name: 'retro',
		displayName: '复盘',
		kind: 'record',
		domain: '核心',
		codePrefix: 'P',
		usage: '一批失败之后，写清楚缺什么信息、以及凭什么相信下一次。',
		sectionCount: 3,
	},
	/* ── 代码 ── */
	{
		name: 'expectedMismatch',
		displayName: '预期不符',
		kind: 'goal',
		domain: '代码',
		codePrefix: 'E',
		usage: '用户认为某处不对，但还没确认是不是缺陷。先定性，再定下一步。',
		sectionCount: 6,
	},
	{
		name: 'newFeature',
		displayName: '新增功能',
		kind: 'goal',
		domain: '代码',
		codePrefix: 'F',
		usage: '用户要一个现在没有的东西，目标能说清，但怎么做要先拆开分别定。',
		sectionCount: 4,
	},
	{
		name: 'optimize',
		displayName: '项目优化',
		kind: 'goal',
		domain: '代码',
		codePrefix: 'O',
		usage: '已有项目在不改对外行为的前提下改内部：更快、更清楚、更好扩展。',
		sectionCount: 2,
	},
	{
		name: 'writeTests',
		displayName: '编写测试',
		kind: 'goal',
		domain: '代码',
		codePrefix: 'T',
		usage: '用户要一套能留在项目里、以后能反复跑的测试代码。',
		sectionCount: 4,
	},
	{
		name: 'architecture',
		displayName: '技术架构',
		kind: 'design',
		domain: '代码',
		codePrefix: 'R',
		usage: '用户要新建项目，或要换掉整个技术底座 —— 此时还没有框架。',
		sectionCount: 4,
	},
	{
		name: 'interfaceUi',
		displayName: '接口界面',
		kind: 'design',
		domain: '代码',
		codePrefix: 'I',
		usage: '决定对外暴露几个入口、每个入口长什么样。',
		sectionCount: 4,
	},
	{
		name: 'lowLevel',
		displayName: '底层实现',
		kind: 'design',
		domain: '代码',
		codePrefix: 'M',
		usage: '把接口界面的承诺补到能兑现：内部怎么拆、用哪个库、边界与报错形式。',
		sectionCount: 3,
	},
	{
		name: 'writeCode',
		displayName: '编写代码',
		kind: 'work',
		domain: '代码',
		codePrefix: 'W',
		usage: '真正动手改代码 —— 实现类路径的最后一站。',
		sectionCount: 2,
	},
]);

/** 三级联选里默认选中的模板（展厅里演示「核心 · 目标 · 用户任务」这一组）。 */
export const DEFAULT_CATALOG_REF = 'userNeed';
