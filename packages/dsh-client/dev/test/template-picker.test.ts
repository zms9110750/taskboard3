/**
 * 三级联选弹层的纯逻辑测试。
 *
 * ## 为什么值得测
 *
 * 这一块的失效方式**全是「点了没反应」**，读代码看不出来：
 *
 * | 失效方式 | 症状 |
 * |---|---|
 * | 浏览位置放在渲染函数的局部变量里 | 点领域，另外两列还是原来的（第一次点不生效）|
 * | 换领域不重置类别 | 新领域里没有旧类别 ⇒ 模板列空 ⇒ 看起来像坏了 |
 * | 打开弹层时用「已选模板」盖掉用户刚点的浏览位置 | 用户点了代码，重开又跳回核心 |
 * | `resolveBrowse` 不校验位置是否还存在 | 模板清单换了之后，领域列空了但状态还指着它 |
 *
 * 四种都不报错。⇒ 逐条钉住。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	EMPTY_BROWSE,
	browseAfterClick,
	buildPickerGroups,
	columnsOf,
	resolveBrowse,
} from '../pure/template-picker.ts';
import { KIND_META, TEMPLATE_CATALOG, type TemplateKind } from '../components/create/data.ts';

const labelOf = (kind: TemplateKind): string => KIND_META[kind].label;
const letterOf = (kind: TemplateKind): string => KIND_META[kind].letter;
const GROUPS = buildPickerGroups(TEMPLATE_CATALOG, labelOf, letterOf);

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
		const core = GROUPS.find((one) => one.domain === '核心');
		assert.deepEqual(
			core?.kinds.map((one) => one.kind),
			['goal', 'design', 'work', 'record'],
		);
	});

	it('类别字母来自 KIND_META（G/D/W/R），不在渲染里硬编码', () => {
		const core = GROUPS.find((one) => one.domain === '核心');
		assert.deepEqual(
			core?.kinds.map((one) => one.letter),
			['G', 'D', 'W', 'R'],
		);
	});

	it('代码领域没有 record 类别（不是补一个空的）', () => {
		const code = GROUPS.find((one) => one.domain === '代码');
		assert.equal(
			code?.kinds.some((one) => one.kind === 'record'),
			false,
		);
	});

	it('18 个模板一个都没丢', () => {
		const total = GROUPS.reduce(
			(sum, group) => sum + group.kinds.reduce((n, one) => n + one.items.length, 0),
			0,
		);
		assert.equal(total, TEMPLATE_CATALOG.length);
		assert.equal(TEMPLATE_CATALOG.length, 18);
	});

	it('领域为空 ⇒ 归「通用」，**不是丢弃**（丢模板是静默故障）', () => {
		const groups = buildPickerGroups(
			[
				{
					name: 'x',
					displayName: 'X',
					kind: 'goal',
					domain: '',
					codePrefix: 'X',
					usage: '',
					sectionCount: 0,
				},
			],
			labelOf,
			letterOf,
		);
		assert.deepEqual(
			groups.map((one) => one.domain),
			['通用'],
		);
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

	it('⚠ 用户上次浏览的位置优先于「已选模板」', () => {
		/*
		 * 若反过来（已选模板盖掉浏览位置），用户点了「代码」再关掉重开，
		 * 会跳回「核心」—— 表现就是「点了没反应」。
		 */
		assert.deepEqual(resolveBrowse({ domain: '代码', kind: 'design' }, 'userNeed', GROUPS), {
			domain: '代码',
			kind: 'design',
		});
	});

	it('⚠ 位置失效（领域不存在）⇒ 回落到第一组，不留一个指向空领域的值', () => {
		const got = resolveBrowse({ domain: '不存在', kind: 'goal' }, '', GROUPS);
		assert.deepEqual(got, { domain: '核心', kind: 'goal' });
	});

	it('⚠ 类别在新领域里不存在 ⇒ 回落到该领域的第一个类别', () => {
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
		const got = browseAfterClick(GROUPS, { domain: '核心', kind: 'record' }, 'domain', '代码');
		assert.equal(got.kind, 'goal');
	});

	it('点类别 ⇒ 领域不动（只改类别）', () => {
		assert.deepEqual(browseAfterClick(GROUPS, { domain: '核心', kind: 'goal' }, 'kind', 'work'), {
			domain: '核心',
			kind: 'work',
		});
	});

	it('点不存在的领域 ⇒ 类别变空串（模板列会是空，但状态自洽）', () => {
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

	it('⭐ 空串位置 ⇒ 三列都空，但**不抛**（弹层没打开时的初始态）', () => {
		const cols = columnsOf(GROUPS, EMPTY_BROWSE);
		assert.deepEqual(
			[cols.domains.length, cols.kinds.length, cols.templates.length],
			[2, 0, 0],
		);
	});
});
