/**
 * `StatusButton` 的 **SSR 断言**（#62 / #63）—— 与 `dev/preview/treecard/ssr.tsx` 同一形态：
 * 本机没有可用浏览器，所以「组件长什么样」用 `renderToStaticMarkup` 渲染成 HTML 再断言。
 *
 * 断的是**契约**，不是像素：
 *
 * 1. 两档尺寸的 class（`--sm` / `--md`）与 `is-interactive` / `is-static`；
 * 2. `interactive=false` ⇒ **`span`**（不是 disabled button）+ `aria-description`；
 * 3. 可点态 ⇒ `button` + `aria-haspopup="menu"` + 后缀 `▾`；
 * 4. 文案来自 protocol 的 `STATE_LABELS`（不复制字符串）；
 * 5. **三处调用点**（CardRow / DetailHead / TreeCard）渲染出的状态按钮
 *    **是同一个组件、同一套 class 命名**，且三处都不再出现旧的
 *    `.task-card__status`（手拼的圆点 + 文案已删）。
 *
 * 运行：`node dev/preview/statusbutton/verify.mjs`（它负责把本文件打包成临时 `.mjs`）。
 */

import { renderToStaticMarkup } from 'react-dom/server';

import { STATE_LABELS, TASK_STATES, TaskState } from '@taskboard/protocol';

import { CardRow } from '../../../src/renderers/CardRow.tsx';
import { DetailHead } from '../../../src/renderers/DetailHead.tsx';
import { StatusButton } from '../../../src/renderers/StatusButton.tsx';
import { TreeCard } from '../../../src/renderers/TreeCard.tsx';
import { detailTableOf } from '../../../src/pure/card-detail.ts';
import { stateTone } from '../../../src/pure/card-view.ts';
import type { Card } from '../../../src/types.ts';

/* ══════════════════════════════════════════════════════════════
 * 断言工具（和三棵树 / TreeCard 的 SSR 脚本同一套）
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

/**
 * 从 HTML 里取状态按钮的 class（没有就返回空串）。
 *
 * @param html 组件的 SSR 输出
 */
function statusButtonClassOf(html: string): string {
	const match = /class="(status-button[^"]*)"/.exec(html);
	return match?.[1] ?? '';
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
		id: 'DQ01',
		title: '卡头状态按钮',
		status: TaskState.AUTH_REQUIRED,
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

/** 什么也不做（预览 / SSR 不真的要开菜单）。 */
function noop(): void {
	/* 故意为空。 */
}

/** 三处调用点共用的状态（需要授权 = issue 截图里那个紫色状态）。 */
const STATUS = TaskState.AUTH_REQUIRED;

/** 卡片位置尺寸（TreeCard 的 `style` 由布局算好传入；这里给固定值）。 */
const TREE_STYLE = { left: 12, top: 34, width: 190, height: 78 } as const;

/* ══════════════════════════════════════════════════════════════
 * ① 组件本身：两档尺寸 / 两种形态
 * ══════════════════════════════════════════════════════════════ */

const smStatic = renderToStaticMarkup(
	<StatusButton status={STATUS} size="sm" interactive={false} disabledReason="在详情里改状态" />,
);
contains('sm 只读：class 带 --sm', smStatic, 'class="status-button status-button--sm status-button--authRequired is-static"');
contains('⭐ 只读态是 span（不是 disabled button）', smStatic, '<span class="status-button');
contains('⭐ 只读态带 aria-description', smStatic, 'aria-description="在详情里改状态"');
contains('只读态 title 也是那个原因', smStatic, 'title="在详情里改状态"');
contains('只读态文案来自 STATE_LABELS', smStatic, `>${STATE_LABELS[STATUS]}<`);
contains('只读态圆点仍按状态色', smStatic, 'class="dot dot--authRequired"');
contains('sm 圆点 6px', smStatic, 'width:6px;height:6px');
notContains('只读态不画 ▾', smStatic, 'status-button__caret');

const mdInteractive = renderToStaticMarkup(
	<StatusButton status={STATUS} size="md" onOpen={noop} />,
);
contains('md 可点：class 带 --md', mdInteractive, 'class="status-button status-button--md status-button--authRequired is-interactive"');
contains('⭐ 可点态是 button', mdInteractive, '<button type="button"');
contains('可点态 aria-haspopup=menu', mdInteractive, 'aria-haspopup="menu"');
contains('可点态后缀 ▾', mdInteractive, 'status-button__caret');
contains('可点态文案来自 STATE_LABELS', mdInteractive, `>${STATE_LABELS[STATUS]}<`);
contains('md 圆点 7px（默认）', mdInteractive, 'class="dot dot--authRequired"');
notContains('可点态没有 aria-description', mdInteractive, 'aria-description');

const mdStatic = renderToStaticMarkup(
	<StatusButton status={STATUS} size="md" interactive={false} disabledReason="当前场景没有接状态菜单" />,
);
contains('md 只读：尺寸类与可点态相同、只换 is-static', mdStatic, 'status-button--md status-button--authRequired is-static');
contains('md 只读也带 aria-description', mdStatic, 'aria-description="当前场景没有接状态菜单"');

const noChevron = renderToStaticMarkup(
	<StatusButton status={STATUS} size="md" showChevron={false} onOpen={noop} />,
);
notContains('showChevron=false ⇒ 不画 ▾', noChevron, 'status-button__caret');

/* 九个状态一个不少：文案全部来自 protocol */
for (const state of TASK_STATES) {
	const html = renderToStaticMarkup(
		<StatusButton status={state} interactive={false} disabledReason="演示" />,
	);
	contains(`状态 ${state} 的文案 = STATE_LABELS`, html, `>${STATE_LABELS[state]}<`);
	contains(`状态 ${state} 带自己的档位 class`, html, `status-button--${stateTone(state)}`);
}

/* ══════════════════════════════════════════════════════════════
 * ② 三处调用点：同一个组件、同一套 class
 * ══════════════════════════════════════════════════════════════ */

const cardRowHtml = renderToStaticMarkup(
	<CardRow
		card={card()}
		selected={false}
		kindLabel="设计"
		templateLabel="决策"
		onSelect={noop}
	/>,
);

const head = detailTableOf(card(), { kindLabel: '设计', templateLabel: '决策' }).head;
const detailHeadHtml = renderToStaticMarkup(
	<DetailHead
		head={head}
		onAddRelation={noop}
		onDerive={noop}
		relations={undefined}
		onJumpRelation={undefined}
		onClose={undefined}
		onExpand={undefined}
		siblingGroups={undefined}
		onStatusOpen={noop}
	/>,
);

const treeCardHtml = renderToStaticMarkup(
	<TreeCard
		card={card()}
		kindLabel="设计"
		templateLabel=""
		selected={false}
		onSelect={noop}
		style={TREE_STYLE}
		layer={2}
	/>,
);

const rowClass = statusButtonClassOf(cardRowHtml);
const headClass = statusButtonClassOf(detailHeadHtml);
const treeClass = statusButtonClassOf(treeCardHtml);

check('CardRow 渲染出了状态按钮', rowClass !== '', rowClass);
check('DetailHead 渲染出了状态按钮', headClass !== '', headClass);
check('TreeCard 渲染出了状态按钮', treeClass !== '', treeClass);

/* 三处都必须是**同一个基类 + 同一套尺寸/档位命名**（不是各自拼的第三套 class）。 */
for (const [site, cls] of [
	['CardRow', rowClass],
	['DetailHead', headClass],
	['TreeCard', treeClass],
] as const) {
	check(`${site} 的基类是 status-button`, cls.startsWith('status-button '), cls);
	check(`${site} 带同一套状态档位类`, cls.includes('status-button--authRequired'), cls);
}

/* 列表行 / 树节点都是 sm + 只读（根节点本身是 button）；详情头是 md + 可点。 */
eq('⭐ CardRow 与 TreeCard 的按钮 class 完全相同（同一个 sm 只读形态）', rowClass, treeClass);
check('⭐ DetailHead 是 md + 可点（同一组件的另一档）', headClass.includes('status-button--md') && headClass.includes('is-interactive'), headClass);
check('CardRow 只有 1 个状态按钮', cardRowHtml.split('data-status-button').length - 1 === 1, String(cardRowHtml.split('data-status-button').length - 1));
check('DetailHead 只有 1 个状态按钮', detailHeadHtml.split('data-status-button').length - 1 === 1, String(detailHeadHtml.split('data-status-button').length - 1));
check('TreeCard 只有 1 个状态按钮', treeCardHtml.split('data-status-button').length - 1 === 1, String(treeCardHtml.split('data-status-button').length - 1));

/* 三处都不许再有旧的手拼结构（StatusCell 已退役）。 */
for (const [site, html] of [
	['CardRow', cardRowHtml],
	['DetailHead', detailHeadHtml],
	['TreeCard', treeCardHtml],
] as const) {
	notContains(`${site} 不再有 .task-card__status（手拼圆点 + 文案已删）`, html, 'task-card__status');
}

/* 只读态的原因：列表行说「在详情里改状态」；树节点按是否冻结给说法。 */
contains('CardRow 的只读原因', cardRowHtml, 'aria-description="在详情里改状态"');
contains(
	'TreeCard 的只读原因（需要授权未收尾 ⇒ 在详情里改状态）',
	treeCardHtml,
	'aria-description="在详情里改状态"',
);

const endedHtml = renderToStaticMarkup(
	<TreeCard
		card={card({ status: TaskState.COMPLETED })}
		kindLabel="设计"
		templateLabel=""
		selected={false}
		onSelect={noop}
		style={TREE_STYLE}
		layer={2}
	/>,
);
contains(
	'⭐ TreeCard 对已收尾（冻结）的卡给出不同原因',
	endedHtml,
	'aria-description="卡已收尾（冻结），状态不能再改"',
);

/* ══════════════════════════════════════════════════════════════
 * 汇总
 * ══════════════════════════════════════════════════════════════ */

const passed = results.filter((one) => one.ok).length;
for (const one of results) {
	console.log(`${one.ok ? '✓' : '✗'} ${one.name}${one.detail === '' ? '' : ` — ${one.detail}`}`);
}
console.log(`\nStatusButton SSR 断言：${String(passed)}/${String(results.length)} 通过`);

if (passed !== results.length) {
	console.log('\n失败清单：');
	for (const one of results) {
		if (!one.ok) console.log(`  ✗ ${one.name} — ${one.detail}`);
	}
	process.exitCode = 1;
}
