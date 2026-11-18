/**
 * 模板三级联选弹层的**纯逻辑**测试（`src/pure/template-picker.ts`）。
 *
 * ## 为什么这 23 条值得存在
 *
 * 这一块的失效方式**全是「点了没反应」**，而它们全都不报错：
 *
 * | 失效方式 | 症状 |
 * |---|---|
 * | 浏览位置放在重画函数的局部变量里 | 点领域，另外两列还是原来的（第一次点不生效）|
 * | 换领域不重置类别 | 新领域里没有旧类别 ⇒ 模板列空 ⇒ 看起来像坏了 |
 * | 打开时用「已选模板」盖掉用户刚点的浏览位置 | 用户点了代码，重开又跳回核心 |
 * | `resolveBrowse` 不校验位置是否还存在 | 模板清单换了之后领域列全暗、另两列全空 |
 * | `domain` 为空被丢弃 | 某个模板**选不到**（最坏的静默故障）|
 *
 * ⇒ 逐条钉住。这是从展厅版 `dev/test/template-picker.test.ts` 迁过来的，
 *   数据换成「和 `GET /api/templates` 同形状的假清单」（`ref` 而不是 `name`）。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	DOMAIN_ORDER,
	EMPTY_BROWSE,
	browseAfterClick,
	buildPickerGroups,
	columnsOf,
	defaultKindLabel,
	defaultKindLetter,
	resolveBrowse,
	type PickerTemplate,
} from '../src/pure/template-picker.ts';

/**
 * 假模板清单 —— **形状与 core 的 `TemplateSummary` 一致**
 * （`packages/core/src/template/types.ts:93`：`ref` / `displayName` / `kind` / `domain` / `codePrefix`）。
 *
 * 名字和领域抄自 `packages/core/templates/*.yaml`，但这里**只关心分组**，
 * 不关心每个模板的段数。
 */
const TEMPLATES: readonly PickerTemplate[] = Object.freeze([
	/* ── 核心 ── */
	{ ref: 'userNeed', displayName: '用户任务', kind: 'goal', domain: '核心', codePrefix: 'U' },
	{ ref: 'decision', displayName: '决策', kind: 'design', domain: '核心', codePrefix: 'C' },
	{ ref: 'question', displayName: '提问', kind: 'design', domain: '核心', codePrefix: 'Q' },
	{ ref: 'research', displayName: '调研', kind: 'work', domain: '核心', codePrefix: 'S' },
	{ ref: 'demo', displayName: '演示', kind: 'work', domain: '核心', codePrefix: 'D' },
	{ ref: 'verify', displayName: '校验', kind: 'work', domain: '核心', codePrefix: 'V' },
	{ ref: 'delivery', displayName: '交付', kind: 'record', domain: '核心', codePrefix: 'L' },
	{ ref: 'archive', displayName: '留档', kind: 'record', domain: '核心', codePrefix: 'A' },
	{ ref: 'blocker', displayName: '阻碍', kind: 'record', domain: '核心', codePrefix: 'B' },
	{ ref: 'retro', displayName: '复盘', kind: 'record', domain: '核心', codePrefix: 'P' },
	/* ── 代码 ── */
	{ ref: 'expectedMismatch', displayName: '预期不符', kind: 'goal', domain: '代码', codePrefix: 'E' },
	{ ref: 'newFeature', displayName: '新增功能', kind: 'goal', domain: '代码', codePrefix: 'F' },
	{ ref: 'optimize', displayName: '项目优化', kind: 'goal', domain: '代码', codePrefix: 'O' },
	{ ref: 'writeTests', displayName: '编写测试', kind: 'goal', domain: '代码', codePrefix: 'T' },
	{ ref: 'architecture', displayName: '技术架构', kind: 'design', domain: '代码', codePrefix: 'R' },
	{ ref: 'interfaceUi', displayName: '接口界面', kind: 'design', domain: '代码', codePrefix: 'I' },
	{ ref: 'lowLevel', displayName: '底层实现', kind: 'design', domain: '代码', codePrefix: 'M' },
	{ ref: 'writeCode', displayName: '编写代码', kind: 'work', domain: '代码', codePrefix: 'W' },
]);

/**
 * 测试用的中文名 / 字母表 —— **产品里由调用方注入**（本包不编中文）。
 *
 * 这里用真名（和 core 的 `BUILTIN_KINDS` 一致）只是为了让断言读起来清楚。
 */
const LABELS: Readonly<Record<string, string>> = Object.freeze({
	goal: '目标',
	design: '设计',
	work: '工作',
	record: '记录',
});
const LETTERS: Readonly<Record<string, string>> = Object.freeze({
	goal: 'G',
	design: 'D',
	work: 'W',
	record: 'R',
});
const labelOf = (kind: string): string => LABELS[kind] ?? kind;
const letterOf = (kind: string): string => LETTERS[kind] ?? defaultKindLetter(kind);

const GROUPS = buildPickerGroups(TEMPLATES, labelOf, letterOf);

/* ══════════════════════════════════════════════════════════
   默认表
   ══════════════════════════════════════════════════════════ */

describe('默认实现 —— 不编中文', () => {
	it('⚠ defaultKindLabel 直接返回 id（**不猜中文**）', () => {
		assert.equal(defaultKindLabel('goal'), 'goal');
		assert.equal(defaultKindLabel('第三方类别'), '第三方类别');
	});

	it('defaultKindLetter 用 id 首字母大写（降级，不是权威）', () => {
		assert.equal(defaultKindLetter('goal'), 'G');
		assert.equal(defaultKindLetter('work'), 'W');
	});

	it('空 id 的字母不返回空串（空串会让编号列看起来缺了一块）', () => {
		assert.equal(defaultKindLetter(''), '?');
	});

	it('DOMAIN_ORDER 核心在代码前面', () => {
		assert.equal(DOMAIN_ORDER.indexOf('核心') < DOMAIN_ORDER.indexOf('代码'), true);
	});
});

/* ══════════════════════════════════════════════════════════
   分组
   ══════════════════════════════════════════════════════════ */

describe('buildPickerGroups —— 领域 → 类别 → 模板', () => {
	it('两个领域：核心在前、代码在后', () => {
		assert.deepEqual(
			GROUPS.map((one) => one.domain),
			['核心', '代码'],
		);
	});

	it('类别按 目标 → 设计 → 工作 → 记录 排（不是数据里碰巧的顺序）', () => {
		assert.deepEqual(
			GROUPS.find((one) => one.domain === '核心')?.kinds.map((one) => one.kind),
			['goal', 'design', 'work', 'record'],
		);
	});

	it('类别中文名 / 字母来自调用方的表，不在分组里硬编码', () => {
		const core = GROUPS.find((one) => one.domain === '核心');
		assert.deepEqual(
			core?.kinds.map((one) => one.label),
			['目标', '设计', '工作', '记录'],
		);
		assert.deepEqual(
			core?.kinds.map((one) => one.letter),
			['G', 'D', 'W', 'R'],
		);
	});

	it('代码领域没有 record 类别（**不补一个空的**）', () => {
		assert.equal(
			GROUPS.find((one) => one.domain === '代码')?.kinds.some((one) => one.kind === 'record'),
			false,
		);
	});

	it('18 个模板一个都没丢', () => {
		const total = GROUPS.reduce(
			(sum, group) => sum + group.kinds.reduce((n, one) => n + one.items.length, 0),
			0,
		);
		assert.equal(total, TEMPLATES.length);
		assert.equal(TEMPLATES.length, 18);
	});

	it('⭐ domain 为空 ⇒ 归「通用」，**不是丢弃**', () => {
		const groups = buildPickerGroups(
			[{ ref: 'x', displayName: 'X', kind: 'goal', domain: '' }],
			labelOf,
			letterOf,
		);
		assert.deepEqual(
			groups.map((one) => one.domain),
			['通用'],
		);
	});

	it('⚠ 未注册的类别不丢模板（落在类别列最后，不是被过滤掉）', () => {
		const groups = buildPickerGroups(
			[
				{ ref: 'a', displayName: 'A', kind: 'goal', domain: '核心' },
				{ ref: 'b', displayName: 'B', kind: 'customKind', domain: '核心' },
			],
			labelOf,
			letterOf,
		);
		const kinds = groups[0]?.kinds ?? [];
		assert.equal(kinds.length, 2);
		assert.equal(kinds[1]?.kind, 'customKind');
	});

	it('空清单 ⇒ 空分组（不炸）', () => {
		assert.deepEqual(buildPickerGroups([], labelOf, letterOf), []);
	});
});

/* ══════════════════════════════════════════════════════════
   打开时定位
   ══════════════════════════════════════════════════════════ */

describe('resolveBrowse —— 打开弹层时定位到哪', () => {
	it('首次打开 ⇒ 第一组的第一个类别', () => {
		assert.deepEqual(resolveBrowse(EMPTY_BROWSE, '', GROUPS), { domain: '核心', kind: 'goal' });
	});

	it('已选模板 ⇒ 定位到它所在的分组（回看已选项）', () => {
		assert.deepEqual(resolveBrowse(EMPTY_BROWSE, 'writeCode', GROUPS), {
			domain: '代码',
			kind: 'work',
		});
	});

	it('⚠ 用户上次浏览的位置**优先于**「已选模板」', () => {
		/*
		 * 反过来的话，用户点了「代码」再关掉重开会跳回「核心」——
		 * 表现就是「点了没反应」（旧版踩过这个）。
		 */
		assert.deepEqual(resolveBrowse({ domain: '代码', kind: 'design' }, 'userNeed', GROUPS), {
			domain: '代码',
			kind: 'design',
		});
	});

	it('⚠ 位置失效（领域不存在）⇒ 回落第一组，不留一个指向空领域的值', () => {
		assert.deepEqual(resolveBrowse({ domain: '不存在', kind: 'goal' }, '', GROUPS), {
			domain: '核心',
			kind: 'goal',
		});
	});

	it('⚠ 类别在新领域里不存在 ⇒ 回落该领域的第一个类别', () => {
		const got = resolveBrowse({ domain: '代码', kind: 'record' }, '', GROUPS);
		assert.equal(got.domain, '代码');
		assert.equal(got.kind, 'goal');
	});

	it('空分组 ⇒ 回到 EMPTY_BROWSE（不抛）', () => {
		assert.deepEqual(resolveBrowse({ domain: '核心', kind: 'goal' }, '', []), {
			domain: '',
			kind: '',
		});
	});
});

/* ══════════════════════════════════════════════════════════
   点击
   ══════════════════════════════════════════════════════════ */

describe('browseAfterClick —— 点一列之后浏览位置怎么变', () => {
	it('点领域 ⇒ 领域变、类别重置成该领域第一项', () => {
		assert.deepEqual(browseAfterClick(GROUPS, { domain: '核心', kind: 'goal' }, 'domain', '代码'), {
			domain: '代码',
			kind: 'goal',
		});
	});

	it('⭐ 点领域「代码」⇒ 类别**不是**保留原来的 record（代码没有 record）', () => {
		assert.equal(
			browseAfterClick(GROUPS, { domain: '核心', kind: 'record' }, 'domain', '代码').kind,
			'goal',
		);
	});

	it('点类别 ⇒ 领域不动（只改类别）', () => {
		assert.deepEqual(browseAfterClick(GROUPS, { domain: '核心', kind: 'goal' }, 'kind', 'work'), {
			domain: '核心',
			kind: 'work',
		});
	});

	it('点不存在的领域 ⇒ 类别变空串（状态自洽，模板列会是空）', () => {
		assert.deepEqual(browseAfterClick(GROUPS, { domain: '核心', kind: 'goal' }, 'domain', '幽灵'), {
			domain: '幽灵',
			kind: '',
		});
	});
});

/* ══════════════════════════════════════════════════════════
   三列内容
   ══════════════════════════════════════════════════════════ */

describe('columnsOf —— 当前浏览位置对应的三列', () => {
	it('领域列永远是全部领域', () => {
		assert.equal(columnsOf(GROUPS, { domain: '代码', kind: 'work' }).domains.length, 2);
	});

	it('类别列跟着领域走', () => {
		assert.deepEqual(
			columnsOf(GROUPS, { domain: '代码', kind: 'work' }).kinds.map((one) => one.label),
			['目标', '设计', '工作'],
		);
	});

	it('⭐ 模板列 = 该领域该类别下的模板（代码 · 工作 ⇒ 只有「编写代码」）', () => {
		assert.deepEqual(
			columnsOf(GROUPS, { domain: '代码', kind: 'work' }).templates.map((one) => one.displayName),
			['编写代码'],
		);
	});

	it('模板列保留编号前缀（弹层第三列要显示它）', () => {
		assert.deepEqual(
			columnsOf(GROUPS, { domain: '核心', kind: 'goal' }).templates.map((one) => one.codePrefix),
			['U'],
		);
	});

	it('⭐ 空串位置 ⇒ 领域有、另两列空，但**不抛**', () => {
		const cols = columnsOf(GROUPS, EMPTY_BROWSE);
		assert.deepEqual(
			[cols.domains.length, cols.kinds.length, cols.templates.length],
			[2, 0, 0],
		);
	});
});
