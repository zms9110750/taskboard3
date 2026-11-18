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
