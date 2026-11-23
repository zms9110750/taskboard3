/**
 * `pure/tool-policy.ts` 的单测：解析边界 + 按来源分组。
 *
 * ⚠ 重点在「拒绝」方向：端点回坏数据时必须是 `undefined`（页面显示错误），
 *   不许静默当成空列表 —— 空列表会被读成「这个模板一个工具都不能用」。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	effectiveCounts,
	effectiveToolsFor,
	parseToolPolicy,
	sourcesFor,
	unionOfSources,
	type ToolPolicySnapshot,
} from '../src/pure/tool-policy.ts';

/** 一份最小合法响应。 */
function valid(): Record<string, unknown> {
	return {
		baseTools: ['taskboard_cards', 'taskboard_card'],
		unclaimed: ['bash'],
		common: ['read'],
		groups: [{ name: '代码类', tools: ['write'] }],
		groupMembers: [{ group: '代码类', templates: ['architecture'] }],
		templates: [{ templateRef: 'architecture', tools: ['edit'] }],
		effective: [{ templateRef: 'architecture', tools: ['taskboard_cards', 'taskboard_card', 'bash', 'read', 'write', 'edit'] }],
	};
}

describe('parseToolPolicy：合法响应', () => {
	it('各字段都解析出来', () => {
		const parsed = parseToolPolicy(valid());
		assert.ok(parsed !== undefined);
		assert.deepEqual(parsed.baseTools, ['taskboard_cards', 'taskboard_card']);
		assert.deepEqual(parsed.unclaimed, ['bash']);
		assert.deepEqual(parsed.common, ['read']);
		assert.deepEqual(parsed.groups, [{ name: '代码类', tools: ['write'] }]);
		assert.deepEqual(parsed.groupMembers, [{ group: '代码类', templates: ['architecture'] }]);
		assert.deepEqual(parsed.templates, [{ templateRef: 'architecture', tools: ['edit'] }]);
		assert.equal(parsed.effective[0]?.tools.length, 6);
	});

	it('空数组是合法输入（三档都没配）', () => {
		const parsed = parseToolPolicy({
			baseTools: [],
			unclaimed: [],
			common: [],
			groups: [],
			groupMembers: [],
			templates: [],
			effective: [],
		});
		assert.ok(parsed !== undefined);
		assert.deepEqual(parsed.baseTools, []);
	});
});

describe('parseToolPolicy：拒绝方向（坏数据 ⇒ undefined）', () => {
	const cases: readonly { readonly name: string; readonly raw: unknown }[] = [
		{ name: '非对象', raw: 'nope' },
		{ name: 'null', raw: null },
		{ name: '缺 baseTools', raw: { ...valid(), baseTools: undefined } },
		{ name: 'baseTools 不是数组', raw: { ...valid(), baseTools: 'taskboard_cards' } },
		{ name: 'baseTools 里有非字符串', raw: { ...valid(), baseTools: [1, 2] } },
		{ name: 'groups 不是数组', raw: { ...valid(), groups: { 代码类: ['write'] } } },
		{ name: 'effective 缺字段', raw: { ...valid(), effective: undefined } },
	];

	for (const one of cases) {
		it(one.name, () => {
			assert.equal(parseToolPolicy(one.raw), undefined);
		});
	}

	it('groupMembers 条目脏 ⇒ 跳过该条，不整份失败', () => {
		const parsed = parseToolPolicy({ ...valid(), groupMembers: [{ group: 'x' }] });
		assert.ok(parsed !== undefined);
		assert.deepEqual(parsed.groupMembers, []);
	});

	it('脏条目被跳过，不整份失败', () => {
		const parsed = parseToolPolicy({
			...valid(),
			groups: [{ name: 'ok', tools: ['a'] }, { name: 'bad' }, 'junk'],
		});
		assert.ok(parsed !== undefined);
		assert.deepEqual(parsed.groups, [{ name: 'ok', tools: ['a'] }]);
	});
});

describe('sourcesFor：按来源分组', () => {
	const snapshot = parseToolPolicy(valid()) as ToolPolicySnapshot;

	it('顺序 = BASE → 未领卡 → 通用 → 命中的组 → 模板独立', () => {
		const sources = sourcesFor(snapshot, 'architecture');
		assert.deepEqual(
			sources.map((one) => one.key),
			['base', 'unclaimed', 'common', 'group:代码类', 'template'],
		);
	});

	it('BASE 标 locked，其余不标', () => {
		const sources = sourcesFor(snapshot, 'architecture');
		assert.equal(sources.find((one) => one.key === 'base')?.locked, true);
		assert.equal(sources.find((one) => one.key === 'common')?.locked, false);
	});

	it('没命中的模板：BASE + 未领卡档 + 通用档（后两档与模板无关，恒生效）', () => {
		const sources = sourcesFor(snapshot, 'other');
		assert.deepEqual(
			sources.map((one) => one.key),
			['base', 'unclaimed', 'common'],
		);
	});

	it('多个组同时命中 ⇒ 每个组一段', () => {
		const multi = parseToolPolicy({
			...valid(),
			groups: [
				{ name: 'A组', tools: ['a'] },
				{ name: 'B组', tools: ['b'] },
			],
			groupMembers: [
				{ group: 'A组', templates: ['architecture'] },
				{ group: 'B组', templates: ['architecture'] },
			],
		}) as ToolPolicySnapshot;
		assert.deepEqual(
			sourcesFor(multi, 'architecture').map((one) => one.key),
			['base', 'unclaimed', 'common', 'group:A组', 'group:B组', 'template'],
		);
	});

	it('组里有成员但组增量是空的 ⇒ 不列空段', () => {
		const empty = parseToolPolicy({
			...valid(),
			groups: [{ name: '空组', tools: [] }],
			groupMembers: [{ group: '空组', templates: ['architecture'] }],
		}) as ToolPolicySnapshot;
		assert.equal(
			sourcesFor(empty, 'architecture').some((one) => one.key === 'group:空组'),
			false,
		);
	});
});

describe('unionOfSources / effectiveToolsFor / effectiveCounts', () => {
	const snapshot = parseToolPolicy(valid()) as ToolPolicySnapshot;

	it('并集去重且保持首次出现顺序', () => {
		const sources = sourcesFor(snapshot, 'architecture');
		const union = unionOfSources(sources);
		assert.deepEqual(union, ['taskboard_cards', 'taskboard_card', 'bash', 'read', 'write', 'edit']);
		assert.equal(new Set(union).size, union.length);
	});

	it('重叠不会让并集重复', () => {
		const overlap = parseToolPolicy({
			...valid(),
			common: ['read', 'write'],
			groups: [{ name: 'g', tools: ['write'] }],
			groupMembers: [{ group: 'g', templates: ['architecture'] }],
		}) as ToolPolicySnapshot;
		const union = unionOfSources(sourcesFor(overlap, 'architecture'));
		assert.equal(union.filter((one) => one === 'write').length, 1);
	});

	it('effectiveToolsFor 取服务端算的那份（前端不重算）', () => {
		assert.deepEqual(effectiveToolsFor(snapshot, 'architecture'), [
			'taskboard_cards',
			'taskboard_card',
			'bash',
			'read',
			'write',
			'edit',
		]);
		assert.deepEqual(effectiveToolsFor(snapshot, 'missing'), []);
	});

	it('effectiveCounts 给左栏列表用', () => {
		const counts = effectiveCounts(snapshot);
		assert.equal(counts.get('architecture'), 6);
		assert.equal(counts.get('missing'), undefined);
	});
});
