/**
 * `TreeCard` 的 **SSR 断言** —— 本机没有可用的浏览器（headless Edge 在沙箱里起不来），
 * 所以「组件长什么样」用 `renderToStaticMarkup` 渲染成静态 HTML 来断言。
 *
 * 断的是**契约**，不是像素：
 * - 类名 / DOM 层级（`techtree-css.ts` 和 `dev/preview/techtree/ssr.tsx` 依赖它们）；
 * - 各种形态（普通 / 选中 / 草稿 / 警告 / label 缺值 / 长标题）；
 * - 状态圆点 + 中文名都在（不只靠颜色）；
 * - 位置尺寸**原样来自传入的 `style`**（组件不自己算坐标）。
 *
 * 运行：`node dev/preview/treecard/verify.mjs`（它负责把本文件打包成临时 `.mjs`）。
 */

import { renderToStaticMarkup } from 'react-dom/server';

import { STATE_LABELS, TASK_STATES } from '@taskboard/protocol';

import { TreeCard } from '../../../src/renderers/TreeCard.tsx';
import type { TreeCardProps } from '../../../src/renderers/TreeCard.tsx';
import { TECHTREE_CSS } from '../../../src/pure/techtree-css.ts';
import type { Card } from '../../../src/types.ts';

/* ══════════════════════════════════════════════════════════════
 * 断言工具
 * ══════════════════════════════════════════════════════════════ */

interface Result {
	readonly name: string;
	readonly ok: boolean;
	readonly detail: string;
}

const results: Result[] = [];

/**
 * 记一条断言。
 *
 * @param name 断言名
 * @param ok 是否通过
 * @param detail 实测值
 */
function check(name: string, ok: boolean, detail = ''): void {
	results.push({ name, ok, detail });
}

/**
 * 包含断言。
 *
 * @param name 断言名
 * @param haystack HTML
 * @param needle 必须出现的片段
 */
function contains(name: string, haystack: string, needle: string): void {
	const ok = haystack.includes(needle);
	check(name, ok, ok ? `含 ${JSON.stringify(needle)}` : `缺 ${JSON.stringify(needle)}`);
}

/**
 * 不包含断言。
 *
 * @param name 断言名
 * @param haystack HTML
 * @param needle 不许出现的片段
 */
function notContains(name: string, haystack: string, needle: string): void {
	const ok = !haystack.includes(needle);
	check(name, ok, ok ? `不含 ${JSON.stringify(needle)}` : `仍然含 ${JSON.stringify(needle)}`);
}

/**
 * 相等断言。
 *
 * @param name 断言名
 * @param actual 实测
 * @param expected 期望
 */
function eq(name: string, actual: unknown, expected: unknown): void {
	const ok = actual === expected;
	check(name, ok, ok ? String(actual) : `实测 ${String(actual)} ≠ 期望 ${String(expected)}`);
}

/** 数片段出现次数。 */
function countOf(haystack: string, needle: string): number {
	return haystack.split(needle).length - 1;
}

/* ══════════════════════════════════════════════════════════════
 * 夹具
 * ══════════════════════════════════════════════════════════════ */

const T0 = 1_762_000_000_000;

/**
 * 造一张卡。
 *
 * @param over 覆盖字段
 */
function card(over: Partial<Card> = {}): Card {
	return {
		id: 'DC01',
		title: '分层：拓扑排序 + 排行',
		status: 'TASK_STATE_WORKING',
		template: { ref: 'decision', kind: 'design', domain: '核心' },
		relations: { parent: null, links: [] },
		sections: {},
		note: '',
		createdAt: T0,
		adoptedAt: null,
		history: [{ at: T0, action: 'create' }],
		deleted: false,
		holders: [],
		unread: { ai: false, user: false },
		...over,
	};
}

/** 固定的位置尺寸（模拟 `TechTree` 传进来的 `style`）。 */
const STYLE = { left: 12, top: 34, width: 180, height: 78 } as const;

/**
 * 渲染一张卡。
 *
 * @param over 覆盖 props
 */
function render(over: Partial<TreeCardProps> = {}): string {
	return renderToStaticMarkup(
		<TreeCard
			card={card()}
			kindLabel="设计"
			templateLabel="决策"
			selected={false}
			onSelect={() => undefined}
			style={STYLE}
			layer={2}
			{...over}
		/>,
	);
}

/* ══════════════════════════════════════════════════════════════
 * ① DOM / 类名契约
 * ══════════════════════════════════════════════════════════════ */

const normal = render();

contains('根是 button.tb3t-card', normal, '<button type="button" class="tb3t-card"');
contains('带 data-card-id', normal, 'data-card-id="DC01"');
contains('带 data-layer', normal, 'data-layer="2"');
contains('普通卡 data-selected="false"', normal, 'data-selected="false"');
contains('普通卡 data-warning=""', normal, 'data-warning=""');
contains('有 .tb3t-card__top', normal, '<span class="tb3t-card__top">');
contains('有 .tb3t-card__title', normal, '<span class="tb3t-card__title">');
check(
	'__top 在 __title 之前（层级契约）',
	normal.indexOf('tb3t-card__top') < normal.indexOf('tb3t-card__title'),
);
contains('有编号 .card-id + 类别色', normal, 'class="card-id card-id--design"');
/*
 * 用户 `2026-11-20`：「label 只显示模板的 label」⇒ 类别 / 领域两个 badge 不再画。
 * （这两条断言是那次裁定之前留下的，已过时 —— 底线上就是红的，本次一并改正。）
 */
notContains('不画类别 badge（用户 2026-11-20 裁定）', normal, 'badge badge--design');
notContains('不画领域 badge（用户 2026-11-20 裁定）', normal, 'badge badge--domain');
contains('有模板 badge（传了 templateLabel）', normal, 'badge badge--template');
contains(
	'状态是独立 StatusButton（#63，不再手拼圆点 + 文案）',
	normal,
	'class="status-button status-button--sm status-button--working is-static"',
);
contains('状态按钮带只读原因（title + aria-description）', normal, 'aria-description="在详情里改状态"');
contains('状态中文名在（处理中）', normal, '>处理中<');
contains('状态圆点是 6px', normal, 'width:6px;height:6px');
contains('标题在', normal, '分层：拓扑排序 + 排行');

/* 位置尺寸 = 传入的 style（组件不算坐标） */
contains(
	'位置尺寸原样来自 style prop',
	normal,
	'style="left:12px;top:34px;width:180px;height:78px"',
);

/* ══════════════════════════════════════════════════════════════
 * ② 选中 / 草稿
 * ══════════════════════════════════════════════════════════════ */

const selected = render({ selected: true });
contains('选中卡加 is-selected', selected, 'class="tb3t-card is-selected"');
contains('选中卡 data-selected="true"', selected, 'data-selected="true"');

const draft = render({ card: card({ status: 'TASK_STATE_UNSPECIFIED' }) });
contains('草稿卡加 is-draft', draft, 'class="tb3t-card is-draft"');
contains('草稿卡仍带 2px 边框占位（CSS 契约）', TECHTREE_CSS, '.tb3t-card.is-draft{border-color:transparent');

/* ══════════════════════════════════════════════════════════════
 * ③ 布局警告
 * ══════════════════════════════════════════════════════════════ */

const orphan = render({
	warning: { kind: 'orphan', cardId: 'DC01', detail: 'parent 指向的卡不存在：NOPE，按第 0 层摆放' },
});
contains('孤儿卡画 ▲', orphan, '>▲</span>');
contains('孤儿卡 data-card-warning="orphan"', orphan, 'data-card-warning="orphan"');
contains('孤儿卡 data-warning="orphan"', orphan, 'data-warning="orphan"');
contains('警告原因进 title', orphan, '▲ parent 指向的卡不存在：NOPE，按第 0 层摆放');

const cycle = render({ warning: { kind: 'cycle', cardId: 'DC01', detail: 'parent 链成环' } });
contains('环上的卡 data-card-warning="cycle"', cycle, 'data-card-warning="cycle"');

/* ══════════════════════════════════════════════════════════════
 * ④ label 缺值：缺就不画，不是画空壳
 * ══════════════════════════════════════════════════════════════ */

const noTemplate = render({ templateLabel: '' });
notContains('缺 templateLabel ⇒ 不画模板 badge', noTemplate, 'badge--template');
notContains('缺 templateLabel 也没有类别 / 领域 badge（本组件不画它们）', noTemplate, 'class="badge');

const noKind = render({ kindLabel: '' });
notContains('缺 kindLabel ⇒ 不画类别 badge', noKind, 'badge badge--design');
contains('缺 kindLabel 仍保留模板 badge', noKind, 'badge--template');

const noLabels = render({ kindLabel: '', templateLabel: '' });
eq(
	'两个 label 都缺 ⇒ 一个 badge 都不画',
	countOf(noLabels, 'class="badge'),
	0,
);

/* 领域名压根不进 TreeCard 的 DOM（领域 badge 已按用户 2026-11-20 的裁定删掉） */
const longDomain = render({ card: card({ template: { ref: 'decision', kind: 'design', domain: '一个非常非常长的领域名称' } }) });
notContains('长领域名不进 DOM（领域 badge 不存在）', longDomain, '一个非常非常长的领域名称');

/* ══════════════════════════════════════════════════════════════
 * ⑤ 长标题 / 9 状态
 * ══════════════════════════════════════════════════════════════ */

const longTitle =
	'这是一个非常非常长的标题，用来验证卡片最多显示两行、第三行开始被截断并加省略号，而不是把卡片撑破或者溢出到边框外面';
const longCard = render({ card: card({ title: longTitle }) });
contains('长标题完整在 DOM 里（截断靠 CSS line-clamp）', longCard, longTitle);
contains('长标题进 title 属性', longCard, `title="DC01 ${longTitle}"`);

for (const state of TASK_STATES) {
	const html = render({ card: card({ status: state }) });
	contains(`状态 ${state} 带中文名「${STATE_LABELS[state]}」`, html, `>${STATE_LABELS[state]}<`);
	contains(`状态 ${state} 圆点带颜色类`, html, 'class="dot dot--');
}

/* ══════════════════════════════════════════════════════════════
 * 汇总
 * ══════════════════════════════════════════════════════════════ */

const passed = results.filter((one) => one.ok).length;
for (const one of results) {
	console.log(`${one.ok ? '✓' : '✗'} ${one.name}${one.detail === '' ? '' : ` — ${one.detail}`}`);
}
console.log(`\nTreeCard SSR 断言：${String(passed)}/${String(results.length)} 通过`);

if (passed !== results.length) {
	console.log('\n失败清单：');
	for (const one of results) {
		if (!one.ok) console.log(`  ✗ ${one.name} — ${one.detail}`);
	}
	process.exitCode = 1;
}
