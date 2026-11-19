/**
 * `pure/tree-filter.ts` 的测试 —— **纯函数，零 DOM、零 mock**。
 *
 * ## 最重要的一条
 *
 * > **筛选 / 搜索是「隐藏」，不是「变淡」**
 *
 * 这条是用户 `2026-11-19` 单独强调过的：hover 时无关的边淡到 25%（卡还在），
 * 筛选 / 搜索时不匹配的卡**从渲染树里消失**。本文件把「消失」的判据钉在
 * `visibleCardIds()` / `treeCardsOf()` 上 —— 渲染层拿不到 id 就不可能画出来。
 *
 * ## 第二重要的一条
 *
 * > **被筛掉的父卡不许让子卡变成假孤儿**
 *
 * 否则筛选视图里每张卡都顶个 ▲，树也被打散。`treeCardsOf()` 的分支
 * （真孤儿保留 parent / 假孤儿提到根）各有一条测试。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	NO_TREE_FILTER,
	isFiltering,
	jumpTargetOf,
	matchesFilter,
	matchesSearch,
	normalizeSearch,
	pathMatches,
	treeCardsOf,
	visibleCardIds,
} from '../src/pure/tree-filter.ts';
import type { FilterableCard } from '../src/pure/tree-filter.ts';

/* ══════════════════════════════════════════════════════════════
 * 夹具
 * ══════════════════════════════════════════════════════════════ */

/** 状态全名（和 protocol 一致；纯逻辑只当字符串用）。 */
const S = {
	draft: 'TASK_STATE_UNSPECIFIED',
	submitted: 'TASK_STATE_SUBMITTED',
	working: 'TASK_STATE_WORKING',
	completed: 'TASK_STATE_COMPLETED',
} as const;

/**
 * 造一张卡（只带筛选需要的字段）。
 *
 * @param id 编号
 * @param over 覆盖字段
 */
function mk(id: string, over: Partial<FilterableCard> = {}): FilterableCard {
	return {
		id,
		title: `卡 ${id}`,
		status: S.working,
		template: { ref: 'decision', kind: 'design', domain: '核心' },
		relations: { parent: null },
		...over,
	};
}

/** 一棵小树 + 一个真孤儿 + 一条自环。 */
const TREE: readonly FilterableCard[] = [
	mk('GU01', { title: '把任务板的语义定清楚', status: S.submitted, template: { ref: 'userNeed', kind: 'goal', domain: '核心' } }),
	mk('WR01', {
		title: '派生规则：父卡与子卡横向齐平',
		template: { ref: 'architecture', kind: 'design', domain: '代码' },
		relations: { parent: 'GU01' },
	}),
	mk('DC01', {
		title: '分层：拓扑排序 + 排行',
		relations: { parent: 'WR01' },
	}),
	mk('RB01', {
		title: '现有任务板实现的调研',
		status: S.completed,
		template: { ref: 'research', kind: 'work', domain: '核心' },
	}),
	mk('X01', {
		title: '父卡不存在（孤儿）',
		status: S.draft,
		template: { ref: 'blocker', kind: 'record', domain: '核心' },
		relations: { parent: 'NOPE' },
	}),
	mk('WT01', {
		title: '箭头贴卡边 13 条回归',
		template: { ref: 'writeTests', kind: 'goal', domain: '代码' },
		relations: { parent: 'WR01' },
	}),
];

/** 可见 id 集合的简写。 */
function idsOf(...ids: string[]): ReadonlySet<string> {
	return new Set(ids);
}

/* ══════════════════════════════════════════════════════════════
 * ① 路径匹配
 * ══════════════════════════════════════════════════════════════ */

describe('pathMatches：空路径恒真，路径是前缀', () => {
	it('空路径 ⇒ 恒真（没选不过滤）', () => {
		assert.equal(pathMatches([], []), true);
		assert.equal(pathMatches([], ['核心', 'design', 'decision']), true);
	});

	it('单级路径必须完全相等', () => {
		assert.equal(pathMatches(['design'], ['design']), true);
		assert.equal(pathMatches(['design'], ['work']), false);
	});

	it('多级路径是前缀：核心/设计 命中 核心/设计/decision', () => {
		assert.equal(pathMatches(['核心', 'design'], ['核心', 'design', 'decision']), true);
		assert.equal(pathMatches(['核心'], ['核心', 'work', 'research']), true);
		assert.equal(pathMatches(['核心', 'work'], ['核心', 'design', 'decision']), false);
	});

	it('路径比取值更深 ⇒ 不命中（脏路径不误伤）', () => {
		assert.equal(pathMatches(['核心', 'design', 'decision'], ['核心']), false);
	});
});

/* ══════════════════════════════════════════════════════════════
 * ② 单卡判决
 * ══════════════════════════════════════════════════════════════ */

describe('matchesFilter：三个框 + 搜索词是「与」', () => {
	it('什么都没选 ⇒ 全部命中', () => {
		for (const card of TREE) assert.equal(matchesFilter(card, NO_TREE_FILTER), true);
	});

	it('状态筛选只留该状态', () => {
		const visible = visibleCardIds(TREE, { status: [S.completed] });
		assert.deepEqual([...visible], ['RB01']);
	});

	it('类别筛选只留该类别', () => {
		const visible = visibleCardIds(TREE, { kind: ['goal'] });
		assert.deepEqual([...visible], ['GU01', 'WT01']);
	});

	it('领域筛选按前缀：核心 命中 核心 下所有类别', () => {
		const visible = visibleCardIds(TREE, { domain: ['核心'] });
		/* DC01 用的是 mk() 的默认模板（核心/design/decision）⇒ 也在核心下。 */
		assert.deepEqual([...visible], ['GU01', 'DC01', 'RB01', 'X01']);
	});

	it('领域筛选下探到模板级：核心/design/decision 只命中一张', () => {
		const visible = visibleCardIds(TREE, { domain: ['核心', 'design', 'decision'] });
		assert.deepEqual([...visible], ['DC01']);
	});

	it('多个条件同时生效（与关系）', () => {
		const visible = visibleCardIds(TREE, { status: [S.working], kind: ['design'] });
		assert.deepEqual([...visible], ['WR01', 'DC01']);
	});
});

describe('matchesSearch：编号或标题的包含匹配，大小写不敏感', () => {
	it('空搜索词 / 空白 ⇒ 恒真', () => {
		assert.equal(matchesSearch(TREE[0] as FilterableCard, ''), true);
		assert.equal(matchesSearch(TREE[0] as FilterableCard, '   '), true);
		assert.equal(matchesSearch(TREE[0] as FilterableCard, undefined), true);
	});

	it('按编号子串命中，且大小写不敏感', () => {
		assert.equal(matchesSearch(TREE[2] as FilterableCard, 'dc0'), true);
		assert.equal(matchesSearch(TREE[2] as FilterableCard, 'DC01'), true);
		assert.equal(matchesSearch(TREE[2] as FilterableCard, 'ZZ'), false);
	});

	it('按标题子串命中', () => {
		assert.equal(matchesSearch(TREE[3] as FilterableCard, '调研'), true);
		assert.equal(matchesSearch(TREE[3] as FilterableCard, '调研不存在的词'), false);
	});

	it('normalizeSearch：trim + 小写', () => {
		assert.equal(normalizeSearch('  GU01 '), 'gu01');
		assert.equal(normalizeSearch(undefined), '');
	});

	it('搜索 + 筛选同时生效', () => {
		const visible = visibleCardIds(TREE, { search: '箭头', kind: ['goal'] });
		assert.deepEqual([...visible], ['WT01']);
	});
});

/* ══════════════════════════════════════════════════════════════
 * ③ 布局输入：假孤儿 / 真孤儿
 * ══════════════════════════════════════════════════════════════ */

describe('treeCardsOf：只留可见卡，父卡被筛掉时提到根', () => {
	it('全部可见 ⇒ 原样（parent 不变）', () => {
		const all = idsOf(...TREE.map((card) => card.id));
		const out = treeCardsOf(TREE, all);
		assert.equal(out.length, TREE.length);
		assert.equal(out.find((one) => one.id === 'DC01')?.parent, 'WR01');
	});

	it('父卡被筛掉 ⇒ 子卡 parent 变 null（不制造假孤儿）', () => {
		const visible = idsOf('DC01');
		const out = treeCardsOf(TREE, visible);
		assert.deepEqual(out, [{ id: 'DC01', title: '分层：拓扑排序 + 排行', parent: null }]);
	});

	it('父卡在真实数据里就不存在 ⇒ 保留 parent（真孤儿警告照出）', () => {
		const visible = idsOf('X01');
		const out = treeCardsOf(TREE, visible);
		assert.equal(out[0]?.parent, 'NOPE');
	});

	it('被隐藏的卡**不在**布局输入里（隐藏 = 消失，不是变淡）', () => {
		const visible = idsOf('GU01', 'DC01');
		const out = treeCardsOf(TREE, visible);
		assert.deepEqual(out.map((one) => one.id), ['GU01', 'DC01']);
		assert.equal(out.some((one) => one.id === 'RB01'), false);
	});

	it('输入顺序保持（layoutTree 的确定性依赖它）', () => {
		const all = idsOf(...TREE.map((card) => card.id));
		assert.deepEqual(treeCardsOf(TREE, all).map((one) => one.id), TREE.map((card) => card.id));
	});
});

/* ══════════════════════════════════════════════════════════════
 * ④ 搜索跳转：精确编号
 * ══════════════════════════════════════════════════════════════ */

describe('jumpTargetOf：按编号精确跳转', () => {
	it('精确编号 ⇒ 返回卡上的原始 id', () => {
		assert.equal(jumpTargetOf(TREE, 'DC01'), 'DC01');
		assert.equal(jumpTargetOf(TREE, '  dc01 '), 'DC01');
	});

	it('包含匹配**不算**命中（输一半不许跳）', () => {
		assert.equal(jumpTargetOf(TREE, 'DC'), null);
		assert.equal(jumpTargetOf(TREE, '01'), null);
	});

	it('空 / 空白 ⇒ null', () => {
		assert.equal(jumpTargetOf(TREE, ''), null);
		assert.equal(jumpTargetOf(TREE, '   '), null);
	});

	it('不存在的编号 ⇒ null', () => {
		assert.equal(jumpTargetOf(TREE, 'ZZ99'), null);
	});
});

/* ══════════════════════════════════════════════════════════════
 * ⑤ isFiltering：区分两种空态
 * ══════════════════════════════════════════════════════════════ */

describe('isFiltering：有没有在筛选', () => {
	it('什么都没选 ⇒ false', () => {
		assert.equal(isFiltering(NO_TREE_FILTER), false);
		assert.equal(isFiltering({ status: [], kind: [], domain: [], search: '  ' }), false);
	});

	it('任一条件非空 ⇒ true', () => {
		assert.equal(isFiltering({ status: [S.working] }), true);
		assert.equal(isFiltering({ kind: ['design'] }), true);
		assert.equal(isFiltering({ domain: ['核心'] }), true);
		assert.equal(isFiltering({ search: 'GU' }), true);
	});
});
