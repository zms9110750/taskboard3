/**
 * 派生子任务菜单的**纯逻辑**测试。
 *
 * 用户裁决（`2026-11-22`）：
 * > 「你去看看模板定义。他有说自己快捷派生的内容。如果没有定义，
 * >   就留一个保留的按钮，派生空模板。」
 * > 「点进去了以后模板可以换标题可以换父任务也可以换。」
 *
 * ## 真实数据（2026-11-22 实测）
 *
 * | 模板 | `derive` 项数 |
 * |---|---|
 * | `writeTests` | 11 |
 * | `expectedMismatch` | 10 |
 * | `optimize` | 9 |
 * | `newFeature` | 7 |
 * | `interfaceUi` | 5 |
 * | `architecture` / `lowLevel` | 4 |
 * | `userNeed` | 3 |
 * | `research` / `retro` / `verify` / `writeCode` | 2 |
 * | `blocker` / `decision` / `question` | 1 |
 * | **`archive` / `delivery` / `demo`** | **0** ⇒ 走兜底 |
 *
 * ⇒ 三档都要验：**多项**（排得下）、**1 项**、**0 项**（兜底）。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { TemplateDerive } from '../src/api.ts';
import {
	DERIVE_MENU_FOOTER,
	DERIVE_MENU_TITLE,
	EMPTY_DERIVE_KEY,
	EMPTY_DERIVE_LABEL,
	deriveMenuItemsOf,
	derivePrefillOf,
	deriveSourceOf,
	templateLabelOf,
} from '../src/pure/derive-menu.ts';
import type { Card, TemplateSummary } from '../src/types.ts';

/** 造一条派生声明。 */
function derive(label: string, template: string, description?: string): TemplateDerive {
	return { label, template, ...(description === undefined ? {} : { description }) };
}

/** 造一张最小卡（只填本文件用到的字段）。 */
function card(id: string, title: string, templateRef: string): Card {
	return {
		id,
		title,
		status: 'TASK_STATE_UNSPECIFIED',
		template: { ref: templateRef, kind: 'work', domain: '核心' },
		relations: { parent: null, links: [] },
		sections: {},
		note: '',
		createdAt: 0,
		adoptedAt: null,
		history: [],
		deleted: false,
		holders: [],
		unread: { ai: false, user: false },
	};
}

describe('deriveMenuItemsOf —— 真实数据的三档', () => {
	it('⭐ 多项（7 项，newFeature 的真实形状）⇒ 每项一条，顺序不变', () => {
		const derives = [
			derive('写码', 'writeCode', '把方案落成代码'),
			derive('写测试', 'writeTests'),
			derive('验证', 'verify'),
			derive('调研', 'research'),
			derive('决策', 'decision'),
			derive('设计', 'interfaceUi'),
			derive('演示', 'demo'),
		];
		const items = deriveMenuItemsOf(derives);
		assert.equal(items.length, 7);
		assert.deepEqual(
			items.map((one) => one.label),
			['写码', '写测试', '验证', '调研', '决策', '设计', '演示'],
			'顺序 = 模板里的书写顺序（用户：菜单顺序就是声明顺序）',
		);
		assert.equal(items[0]?.template, 'writeCode');
		assert.equal(items[0]?.description, '把方案落成代码');
		assert.equal(items[1]?.description, undefined, '没写 description 就不给键');
	});

	it('1 项（blocker 的真实形状）⇒ 一条', () => {
		const items = deriveMenuItemsOf([derive('问一句', 'question')]);
		assert.equal(items.length, 1);
		assert.equal(items[0]?.label, '问一句');
		assert.equal(items[0]?.template, 'question');
	});

	it('⭐ 0 项（archive / delivery / demo 的真实形状）⇒ **恰好一个**「派生空模板」', () => {
		const items = deriveMenuItemsOf([]);
		assert.equal(items.length, 1, '⚠ 不是空数组 —— 空菜单框会让用户以为界面坏了');
		assert.equal(items[0]?.key, EMPTY_DERIVE_KEY);
		assert.equal(items[0]?.label, EMPTY_DERIVE_LABEL);
		assert.equal(items[0]?.template, null, 'null = 空模板（不是「还没选」的空串）');
		assert.notEqual(items[0]?.description, '');
	});

	it('key 唯一（两条指向同一模板时也不能撞）', () => {
		const items = deriveMenuItemsOf([
			derive('调研 A', 'research'),
			derive('调研 B', 'research'),
		]);
		assert.equal(items.length, 2);
		assert.notEqual(items[0]?.key, items[1]?.key, 'React 列表会因重复 key 报警');
	});
});

describe('derivePrefillOf —— 三样预填', () => {
	const parent = card('WF12', '重构搜索', 'newFeature');

	it('⭐ 有模板的项 ⇒ 父任务 / 标题 / 模板 三样都填', () => {
		const prefill = derivePrefillOf(parent, {
			key: '0:writeCode',
			label: '写码',
			template: 'writeCode',
		});
		assert.equal(prefill.parentId, 'WF12', '父任务 = 当前卡');
		assert.equal(prefill.templateRef, 'writeCode', '模板 = 菜单项的 template');
		assert.equal(prefill.title, '重构搜索 的子任务', '标题 = 父卡标题 + 的 子任务');
	});

	it('⭐ 空模板项 ⇒ templateRef 是空串（= 让用户选），父任务照样填', () => {
		const [empty] = deriveMenuItemsOf([]);
		assert.ok(empty !== undefined);
		const prefill = derivePrefillOf(parent, empty);
		assert.equal(prefill.templateRef, '', '空串 = 建卡页让用户选模板');
		assert.equal(prefill.parentId, 'WF12', '父任务仍然预填（用户只说不填模板）');
		assert.equal(prefill.title, '重构搜索 的子任务');
	});

	it('标题非空 ⇒ 建卡页不会一打开就报「必填」', () => {
		const prefill = derivePrefillOf(parent, {
			key: 'k',
			label: 'x',
			template: 'research',
		});
		assert.notEqual(prefill.title.trim(), '', '空标题会让界面第一眼就是红字');
	});
});

describe('deriveSourceOf —— 该读哪个模板的 derives', () => {
	it('正常卡 ⇒ 卡上记的模板 ref', () => {
		assert.equal(deriveSourceOf(card('A1', 't', 'architecture')), 'architecture');
	});

	it('模板 ref 是空串（数据坏了）⇒ undefined（调用方走兜底）', () => {
		assert.equal(deriveSourceOf(card('A1', 't', '')), undefined);
	});
});

describe('templateLabelOf —— 菜单项的目标模板显示名', () => {
	const templates: readonly TemplateSummary[] = [
		{ ref: 'writeCode', displayName: '写代码', kind: 'work', domain: '核心' },
		{ ref: 'research', displayName: '调研', kind: 'work', domain: '核心' },
	];

	it('找得到 ⇒ 显示名', () => {
		assert.equal(templateLabelOf(templates, 'writeCode'), '写代码');
	});

	it('找不到 ⇒ undefined（调用方降级显示 ref 或什么都不显示）', () => {
		assert.equal(templateLabelOf(templates, 'nope'), undefined);
	});
});

describe('文案常量', () => {
	it('标题 / 脚注都非空（空字符串会让浮窗看起来缺一块）', () => {
		assert.notEqual(DERIVE_MENU_TITLE.trim(), '');
		assert.notEqual(DERIVE_MENU_FOOTER.trim(), '');
	});

	it('脚注说清「进去还能改」（用户裁决的第 5 条）', () => {
		assert.match(DERIVE_MENU_FOOTER, /改/);
	});
});
