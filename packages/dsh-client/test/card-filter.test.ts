/**
 * `pure/card-filter.ts` 的测试 —— **纯函数，零 DOM、零 mock**。
 *
 * ## 这些断言钉住的是用户 `2026-11-19` 的那句话
 *
 * > 「筛选/搜索后，不匹配的卡要**隐藏**（不是变淡）。」
 *
 * 「隐藏」在本层就是**不在返回数组里**。所以下面每条过滤 / 搜索断言，
 * 判据都是「结果数组里到底有哪几张卡」，而不是 class、不是 opacity。
 *
 * ## 编号与标题是两条不同的规则
 *
 * - 编号：**完整匹配**（用户：「输入完整编号后回车 ⇒ 打开那张卡的详情」）
 * - 标题：子串
 *
 * 这两个规则的区别在 `searchCards` 的「半截编号不命中」那条测试里钉死 ——
 * 那是最容易被后人「顺手改成 includes」的地方。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	EMPTY_FILTER,
	applyCardQuery,
	emptyReasonOf,
	filterCards,
	filterOfPicked,
	findCardByQuery,
	isCardInFilter,
	isCardMatched,
	isFilterActive,
	isPathPrefixOf,
	isQueryActive,
	searchCards,
} from '../src/pure/card-filter.ts';
import type { CardFilter } from '../src/pure/card-filter.ts';
import type { Card } from '../src/types.ts';

/* ── 状态全名（省得每处写长串；与 `protocol` 的 `TaskState` 同值） ── */

const S = {
	draft: 'TASK_STATE_UNSPECIFIED',
	submitted: 'TASK_STATE_SUBMITTED',
	working: 'TASK_STATE_WORKING',
	authRequired: 'TASK_STATE_AUTH_REQUIRED',
	completed: 'TASK_STATE_COMPLETED',
	canceled: 'TASK_STATE_CANCELED',
} as const;

/* ══════════════════════════════════════════════════════════
   夹具：9 张卡

   编号 / 标题 / 状态 / 类别 / 领域 / 模板 都是**各不相同**的组合，
   这样每条断言都能用「结果里有哪几张」说清楚。
   ══════════════════════════════════════════════════════════ */

/** 造卡的简写（只写测试关心的字段，其余给合法默认值）。 */
interface CardSpec {
	readonly id: string;
	readonly title: string;
	readonly status?: string;
	readonly kind?: string;
	readonly domain?: string;
	readonly ref?: string;
}

/**
 * 造一张合法卡。
 *
 * @param spec 测试关心的字段
 */
function card(spec: CardSpec): Card {
	return {
		id: spec.id,
		title: spec.title,
		status: spec.status ?? S.submitted,
		template: {
			ref: spec.ref ?? 'research',
			kind: spec.kind ?? 'work',
			domain: spec.domain ?? '核心',
		},
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

const CARDS: readonly Card[] = Object.freeze([
	card({ id: 'U-01', title: '把任务板的语义定清楚', status: S.submitted, kind: 'goal', domain: '核心', ref: 'userNeed' }),
	card({ id: 'F-02', title: '列表行改成正方形', status: S.working, kind: 'goal', domain: '代码', ref: 'newFeature' }),
	card({ id: 'C-03', title: '详情面板：关系按钮要显眼', status: S.authRequired, kind: 'design', domain: '核心', ref: 'decision' }),
	card({ id: 'W-04', title: '未读用加粗边框表达', status: S.completed, kind: 'work', domain: '代码', ref: 'writeCode' }),
	card({ id: 'Q-07', title: 'Narrow Tab Question', status: S.draft, kind: 'design', domain: '核心', ref: 'question' }),
	card({ id: 'S-05', title: '旧版工作区那 4 块', status: S.working, kind: 'work', domain: '核心', ref: 'research' }),
	card({ id: 'T-06', title: 'SpaceBar 六行表', status: S.submitted, kind: 'goal', domain: '代码', ref: 'writeTests' }),
	card({ id: 'D-09', title: '详情面板的章节', status: S.working, kind: 'work', domain: '核心', ref: 'demo' }),
	card({ id: 'A-11', title: '旧版 views 记录', status: S.canceled, kind: 'record', domain: '核心', ref: 'archive' }),
]);

/** 从结果里取编号（断言只看「有哪几张」）。 */
const ids = (cards: readonly Card[]): string[] => cards.map((one) => one.id);

/** 造一个只筛某一维的 filter。 */
const filterOf = (patch: Partial<CardFilter>): CardFilter => ({ ...EMPTY_FILTER, ...patch });

/* ══════════════════════════════════════════════════════════ */
describe('filterOfPicked —— FilterRow 的 picked 记录 → 筛选条件', () => {
	it('空记录 ⇒ 三个维度都是空路径', () => {
		assert.deepEqual(filterOfPicked({}), EMPTY_FILTER);
	});

	it('只 seed 一个框 ⇒ 另外两个保持空路径（预览的 defaultPicked 只有一部分键）', () => {
		const filter = filterOfPicked({ domain: ['核心', 'design'] });
		assert.deepEqual(filter.status, []);
		assert.deepEqual(filter.kind, []);
		assert.deepEqual(filter.domain, ['核心', 'design']);
	});

	it('三个键都读（键名 = boxId：status / kind / domain）', () => {
		const filter = filterOfPicked({
			status: [S.submitted],
			kind: ['design'],
			domain: ['核心'],
		});
		assert.deepEqual(filter.status, [S.submitted]);
		assert.deepEqual(filter.kind, ['design']);
		assert.deepEqual(filter.domain, ['核心']);
	});

	it('不认识的 boxId 不影响结果', () => {
		const filter = filterOfPicked({ ghost: ['x'] });
		assert.deepEqual(filter, EMPTY_FILTER);
	});
});

/* ══════════════════════════════════════════════════════════ */
describe('isFilterActive / isPathPrefixOf', () => {
	it('三个都空 ⇒ 没在筛', () => {
		assert.equal(isFilterActive(EMPTY_FILTER), false);
	});

	it('任意一维非空 ⇒ 在筛', () => {
		assert.equal(isFilterActive(filterOf({ status: [S.working] })), true);
		assert.equal(isFilterActive(filterOf({ kind: ['work'] })), true);
		assert.equal(isFilterActive(filterOf({ domain: ['核心'] })), true);
	});

	it('空前缀恒真（没选 = 不约束）', () => {
		assert.equal(isPathPrefixOf([], ['x']), true);
		assert.equal(isPathPrefixOf([], []), true);
	});

	it('真前缀匹配 / 等长匹配', () => {
		assert.equal(isPathPrefixOf(['a'], ['a', 'b']), true);
		assert.equal(isPathPrefixOf(['a', 'b'], ['a', 'b', 'c']), true);
		assert.equal(isPathPrefixOf(['a', 'b'], ['a', 'b']), true);
	});

	it('比卡路径长 ⇒ 不匹配', () => {
		assert.equal(isPathPrefixOf(['a', 'b'], ['a']), false);
	});

	it('某一段不同 ⇒ 不匹配', () => {
		assert.equal(isPathPrefixOf(['a', 'c'], ['a', 'b']), false);
		assert.equal(isPathPrefixOf(['b'], ['a']), false);
	});
});

/* ══════════════════════════════════════════════════════════ */
describe('filterCards —— 筛选（不匹配的卡直接不在结果里）', () => {
	it('空 filter ⇒ **原样返回**（同一个数组引用）', () => {
		assert.equal(filterCards(CARDS, EMPTY_FILTER), CARDS);
	});

	it('只看状态 ⇒ 只留该状态的两张', () => {
		assert.deepEqual(ids(filterCards(CARDS, filterOf({ status: [S.submitted] }))), ['U-01', 'T-06']);
	});

	it('只看类别 ⇒ 只留 design 两张', () => {
		assert.deepEqual(ids(filterCards(CARDS, filterOf({ kind: ['design'] }))), ['C-03', 'Q-07']);
	});

	it('只看领域（第 1 层）⇒ 领域为「核心」的 6 张', () => {
		assert.deepEqual(ids(filterCards(CARDS, filterOf({ domain: ['核心'] }))), [
			'U-01',
			'C-03',
			'Q-07',
			'S-05',
			'D-09',
			'A-11',
		]);
	});

	it('领域第 2 层（领域 › 类别）⇒ 交集', () => {
		assert.deepEqual(ids(filterCards(CARDS, filterOf({ domain: ['核心', 'design'] }))), ['C-03', 'Q-07']);
	});

	it('领域第 3 层（领域 › 类别 › 模板）⇒ 精确到模板', () => {
		assert.deepEqual(
			ids(filterCards(CARDS, filterOf({ domain: ['核心', 'design', 'decision'] }))),
			['C-03'],
		);
	});

	it('三个框叠加 ⇒ 交集（状态 AND 类别 AND 领域）', () => {
		assert.deepEqual(
			ids(
				filterCards(
					CARDS,
					filterOf({ status: [S.submitted], kind: ['goal'], domain: ['代码'] }),
				),
			),
			['T-06'],
		);
	});

	it('筛选结果为空 ⇒ 空数组（不是全部）', () => {
		assert.deepEqual(filterCards(CARDS, filterOf({ status: [S.completed], kind: ['goal'] })), []);
	});

	it('脏路径（不存在的状态）⇒ 空数组，不炸、不回落成全部', () => {
		assert.deepEqual(filterCards(CARDS, filterOf({ status: ['TASK_STATE_GHOST'] })), []);
	});

	it('⭐ 保持原顺序（不按编号 / 标题重排）', () => {
		assert.deepEqual(ids(filterCards(CARDS, filterOf({ kind: ['work'] }))), [
			'W-04',
			'S-05',
			'D-09',
		]);
	});

	it('不修改入参数组', () => {
		const before = ids(CARDS);
		filterCards(CARDS, filterOf({ kind: ['work'] }));
		assert.deepEqual(ids(CARDS), before);
	});
});

/* ══════════════════════════════════════════════════════════ */
describe('searchCards —— 标题子串 / 编号完整', () => {
	it('空词 ⇒ **原样返回**（同一个数组引用，不过滤）', () => {
		assert.equal(searchCards(CARDS, ''), CARDS);
	});

	it('纯空格 ⇒ 原样返回（trim 后为空不算搜索）', () => {
		assert.equal(searchCards(CARDS, '   '), CARDS);
		assert.equal(isQueryActive('   '), false);
	});

	it('标题子串匹配', () => {
		assert.deepEqual(ids(searchCards(CARDS, '面板')), ['C-03', 'D-09']);
	});

	it('标题大小写不敏感（英文标题）', () => {
		assert.deepEqual(ids(searchCards(CARDS, 'narrow')), ['Q-07']);
		assert.deepEqual(ids(searchCards(CARDS, 'NARROW')), ['Q-07']);
	});

	it('⭐ 编号精确匹配：输入完整编号命中所属那张卡', () => {
		assert.deepEqual(ids(searchCards(CARDS, 'C-03')), ['C-03']);
	});

	it('编号大小写不敏感 + 前后空格都能命中', () => {
		assert.deepEqual(ids(searchCards(CARDS, 'c-03')), ['C-03']);
		assert.deepEqual(ids(searchCards(CARDS, '  C-03  ')), ['C-03']);
	});

	it('⚠ 半截编号**不**命中（编号只认完整，避免指认不唯一）', () => {
		/*
		 * ⚠ 用「带连字符的半截编号」而不是单个字母 `C`：
		 *   标题是**子串**匹配，`C` 会正当命中英文标题 `SpaceBar`（`spacebar` 里有 `c`）
		 *   —— 那不是 bug，是标题规则。要钉的是「编号这一路必须完整」，
		 *   所以取一个**任何标题里都不出现**的半截编号。
		 */
		assert.deepEqual(searchCards(CARDS, 'C-0'), []);
		assert.deepEqual(searchCards(CARDS, 'Q-0'), []);
	});

	it('搜不到 ⇒ 空数组（不是返回全部）', () => {
		assert.deepEqual(searchCards(CARDS, '这个词不存在'), []);
	});

	it('保持原顺序', () => {
		assert.deepEqual(ids(searchCards(CARDS, '旧版')), ['S-05', 'A-11']);
	});
});

/* ══════════════════════════════════════════════════════════ */
describe('applyCardQuery —— 先筛选后搜索', () => {
	it('空 filter + 空 query ⇒ 原样返回（同一个数组引用）', () => {
		assert.equal(applyCardQuery(CARDS, EMPTY_FILTER, ''), CARDS);
	});

	it('两者叠加 ⇒ 交集', () => {
		assert.deepEqual(
			ids(applyCardQuery(CARDS, filterOf({ kind: ['work'] }), '详情')),
			['D-09'],
		);
	});

	it('⭐ 搜索只在筛选结果里跑（被筛掉的卡即使标题命中也不出现）', () => {
		/* 「详情面板的章节」是 work，会被 kind=design 筛掉。 */
		assert.deepEqual(
			ids(applyCardQuery(CARDS, filterOf({ kind: ['design'] }), '详情')),
			['C-03'],
		);
	});

	it('筛选有结果但搜索没命中 ⇒ 空数组', () => {
		assert.deepEqual(applyCardQuery(CARDS, filterOf({ kind: ['work'] }), '不存在的词'), []);
	});

	it('先筛选后搜索仍保持原顺序', () => {
		assert.deepEqual(
			ids(applyCardQuery(CARDS, filterOf({ domain: ['核心'] }), '旧版')),
			['S-05', 'A-11'],
		);
	});
});

/* ══════════════════════════════════════════════════════════ */
describe('findCardByQuery —— 回车「前往」用（完整编号 ⇒ 那张卡）', () => {
	it('完整编号 ⇒ 那张卡', () => {
		assert.equal(findCardByQuery(CARDS, 'C-03')?.id, 'C-03');
	});

	it('trim + 大小写不敏感', () => {
		assert.equal(findCardByQuery(CARDS, '  c-03  ')?.id, 'C-03');
	});

	it('空词 ⇒ null（不选中任何卡）', () => {
		assert.equal(findCardByQuery(CARDS, ''), null);
		assert.equal(findCardByQuery(CARDS, '   '), null);
	});

	it('半截编号 ⇒ null', () => {
		assert.equal(findCardByQuery(CARDS, 'C'), null);
		assert.equal(findCardByQuery(CARDS, 'C-0'), null);
	});

	it('标题命中也 **不** 算（前往只认编号，不猜标题）', () => {
		assert.equal(findCardByQuery(CARDS, '详情面板'), null);
	});

	it('编号不存在 ⇒ null', () => {
		assert.equal(findCardByQuery(CARDS, 'ZZ-99'), null);
	});
});

/* ══════════════════════════════════════════════════════════ */
describe('isCardInFilter / isCardMatched —— 单卡判决（filterCards 的原子）', () => {
	it('状态 / 类别 / 领域 三层都要满足', () => {
		const target = CARDS[2] as Card; /* C-03：authRequired / design / 核心 / decision */
		assert.equal(isCardInFilter(target, EMPTY_FILTER), true);
		assert.equal(isCardInFilter(target, filterOf({ status: [S.authRequired] })), true);
		assert.equal(isCardInFilter(target, filterOf({ status: [S.submitted] })), false);
		assert.equal(isCardInFilter(target, filterOf({ domain: ['核心', 'design'] })), true);
		assert.equal(isCardInFilter(target, filterOf({ domain: ['代码'] })), false);
	});

	it('标题子串命中 / 编号完整命中 / 空词恒真', () => {
		const target = CARDS[2] as Card;
		assert.equal(isCardMatched(target, ''), true);
		assert.equal(isCardMatched(target, '关系按钮'), true);
		assert.equal(isCardMatched(target, 'c-03'), true);
		assert.equal(isCardMatched(target, '不存在的词'), false);
	});
});

/* ══════════════════════════════════════════════════════════ */
describe('emptyReasonOf —— 空态文案的原因', () => {
	it('空间本身没卡 ⇒ space-empty（优先于筛选/搜索）', () => {
		assert.equal(emptyReasonOf(0, EMPTY_FILTER, ''), 'space-empty');
		assert.equal(emptyReasonOf(0, filterOf({ kind: ['work'] }), 'abc'), 'space-empty');
	});

	it('有卡、只有筛选 ⇒ filter', () => {
		assert.equal(emptyReasonOf(9, filterOf({ kind: ['work'] }), ''), 'filter');
	});

	it('有卡、只有搜索 ⇒ search', () => {
		assert.equal(emptyReasonOf(9, EMPTY_FILTER, 'abc'), 'search');
	});

	it('两者都有 ⇒ both', () => {
		assert.equal(emptyReasonOf(9, filterOf({ kind: ['work'] }), 'abc'), 'both');
	});

	it('有卡、没条件（调用方不该问）⇒ 回落 space-empty', () => {
		assert.equal(emptyReasonOf(9, EMPTY_FILTER, ''), 'space-empty');
	});
});
