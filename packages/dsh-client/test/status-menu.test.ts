/**
 * `pure/status-menu.ts` 的测试 —— **纯函数，零 DOM、零 mock**。
 *
 * 三块：
 *
 * ① **分组**（本组件唯一的新语义判决）：`ButtonAction` 没有 `group` 字段，
 *    用 `groupOf(to)` 自己算。逐条断言顺序、空段过滤、每个按钮落在哪一段。
 * ② **装饰派生**：图标 / 灰字 / 危险色。这些错了只是难看，但灰字撞文案是
 *    旧版明确修过的（「取消」按钮右边再写「取消」），所以也断言。
 * ③ **真实按钮表**：直接拿 `@taskboard/protocol` 的 `buttonsOf()` 跑，
 *    断言「菜单渲染出来的标签**就是**按钮表的标签，一个字不改」——
 *    这是旧版最硬的一条规矩（视图永远不自己写按钮文案）。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buttonsOf, type ButtonAction } from '@taskboard/protocol';

import {
	GROUP_ORDER,
	ICON_CANCEL,
	ICON_CLAIM,
	ICON_COMPLETE,
	ICON_FAIL,
	ICON_RELEASE,
	ICON_REOPEN,
	ICON_REJECT,
	ICON_UNKNOWN,
	MENU_EMPTY,
	MENU_FOOTER,
	MENU_GAP_ABOVE,
	MENU_GAP_BELOW,
	MENU_MARGIN,
	MENU_MIN_HEIGHT,
	MENU_TITLE,
	MENU_WIDTH,
	PILL_CARET,
	hintOf,
	iconOf,
	isOutsideClick,
	keyIntentOf,
	menuModelOf,
	nextIndex,
	placeMenu,
	sectionsOf,
	toneOf,
	type Rect,
} from '../src/pure/status-menu.ts';

/* ── 夹具：手写按钮，不依赖按钮表的当前内容 ── */

const S = {
	draft: 'TASK_STATE_UNSPECIFIED',
	submitted: 'TASK_STATE_SUBMITTED',
	working: 'TASK_STATE_WORKING',
	inputRequired: 'TASK_STATE_INPUT_REQUIRED',
	authRequired: 'TASK_STATE_AUTH_REQUIRED',
	completed: 'TASK_STATE_COMPLETED',
	failed: 'TASK_STATE_FAILED',
	canceled: 'TASK_STATE_CANCELED',
	rejected: 'TASK_STATE_REJECTED',
} as const;

/** 造一个按钮（`kind` / `actors` 与本文件无关，给固定值）。 */
function btn(
	label: string,
	from: ButtonAction['from'],
	to: ButtonAction['to'],
	method: ButtonAction['method'] = 'transition',
): ButtonAction {
	return { kind: 'work', from, to, label, actors: ['user'], method };
}

/* ══════════════════════════════════════════════════════════ */
describe('① 分组：v3 没有 group 字段，用 groupOf(目标状态) 自己算', () => {
	it('组顺序固定：草稿 → 进行 → 搁置 → 完成', () => {
		assert.deepEqual(GROUP_ORDER, ['draft', 'active', 'shelved', 'ended']);
	});

	it('⭐ 按目标状态的组落段：一个按钮只出现在一段里', () => {
		const sections = sectionsOf([
			btn('领取', S.submitted, S.working), // → active
			btn('成功', S.submitted, S.completed), // → ended
			btn('失败', S.submitted, S.failed), // → ended
		]);
		assert.deepEqual(
			sections.map((one) => one.group),
			['active', 'ended'],
		);
		assert.deepEqual(
			sections.map((one) => one.items.map((item) => item.action.label)),
			[['领取'], ['成功', '失败']],
		);
	});

	it('⭐ 空段不返回（视图不用再判 items.length === 0）', () => {
		const sections = sectionsOf([btn('成功', S.submitted, S.completed)]);
		assert.equal(sections.length, 1);
		assert.equal(sections[0]?.group, 'ended');
	});

	it('⭐ 没有任何按钮指向草稿 ⇒ 草稿段恒空、被过滤掉', () => {
		const sections = sectionsOf([
			btn('采纳', S.draft, S.submitted),
			btn('取消', S.submitted, S.canceled),
		]);
		assert.equal(
			sections.some((one) => one.group === 'draft'),
			false,
		);
	});

	it('空输入 ⇒ 空数组（不是「一段空的 ended」）', () => {
		assert.deepEqual(sectionsOf([]), []);
	});

	it('段内顺序 = 按钮表给的顺序（不重排、不排序）', () => {
		const sections = sectionsOf([
			btn('成功', S.submitted, S.completed),
			btn('失败', S.submitted, S.failed),
			btn('取消', S.submitted, S.canceled),
		]);
		assert.deepEqual(
			sections[0]?.items.map((one) => one.action.label),
			['成功', '失败', '取消'],
		);
	});

	it('组的中文名来自 GROUP_LABELS（不在这里抄一份）', () => {
		const sections = sectionsOf([btn('领取', S.submitted, S.working)]);
		assert.equal(sections[0]?.label, '进行');
	});

	it('⭐ 搁置（release，目标 = 提交）落在「进行」段，不是「搁置」段', () => {
		const sections = sectionsOf([btn('搁置', S.working, S.submitted, 'release')]);
		assert.equal(sections[0]?.group, 'active');
	});

	it('⭐ 进「需要授权」的采纳落在「搁置」段（v3 口径，旧版手写为 active）', () => {
		const sections = sectionsOf([btn('采纳', S.draft, S.authRequired, 'adopt')]);
		assert.equal(sections[0]?.group, 'shelved');
	});
});

/* ══════════════════════════════════════════════════════════ */
describe('② 图标：装饰，查不到给 ·', () => {
	it('采纳 ⇒ ✓', () => assert.equal(iconOf(btn('采纳', S.draft, S.submitted, 'adopt')), '✓'));

	it('领取 ⇒ ▶', () => assert.equal(iconOf(btn('领取', S.submitted, S.working, 'claim')), '▶'));

	it('搁置 ⇒ ‖', () => assert.equal(iconOf(btn('搁置', S.working, S.submitted, 'release')), '‖'));

	it('成功 ⇒ ✓', () => assert.equal(iconOf(btn('成功', S.submitted, S.completed)), '✓'));

	it('失败 ⇒ ✕', () => assert.equal(iconOf(btn('失败', S.submitted, S.failed)), '✕'));

	it('取消 ⇒ ⊘', () => assert.equal(iconOf(btn('取消', S.submitted, S.canceled)), '⊘'));

	it('否决 / 否认（都进拒绝态）⇒ ✕', () => {
		for (const label of ['否决', '否认']) {
			assert.equal(iconOf(btn(label, S.submitted, S.rejected)), '✕');
		}
	});

	it('⭐ 重开（from = 取消态）⇒ ↺，即使目标不是提交（design 的 需要授权）', () => {
		assert.equal(iconOf(btn('重开', S.canceled, S.submitted)), '↺');
		assert.equal(iconOf(btn('重开', S.canceled, S.authRequired)), '↺');
	});

	it('查不到 ⇒ ·（有意的默认值：图标错了不影响行为）', () => {
		/* 目标不是任何已知图标位（例如将来指向「需要信息」的按钮）。 */
		assert.equal(iconOf(btn('待定', S.submitted, S.inputRequired)), ICON_UNKNOWN);
	});

	it('图标常量与旧版 `status-menu.js:114-124` 逐字一致', () => {
		assert.deepEqual(
			[ICON_CLAIM, ICON_RELEASE, ICON_COMPLETE, ICON_FAIL, ICON_CANCEL, ICON_REJECT, ICON_REOPEN],
			['▶', '‖', '✓', '✕', '⊘', '✕', '↺'],
		);
	});
});

/* ══════════════════════════════════════════════════════════ */
describe('③ 灰字：目标状态名，与按钮文案撞了留空', () => {
	it('⭐ 成功按钮 ⇒ **留空**（动作名「成功」= 目标状态名「成功」）', () => {
		assert.equal(hintOf(btn('成功', S.submitted, S.completed)), '');
	});

	it('确认 ⇒ 灰字「成功」（动作名 ≠ 目标状态名）', () => {
		assert.equal(hintOf(btn('确认', S.authRequired, S.completed)), '成功');
	});

	it('搁置 ⇒ 灰字「提交」（搁置是动作名，目标状态是提交）', () => {
		assert.equal(hintOf(btn('搁置', S.working, S.submitted, 'release')), '提交');
	});

	it('领取 ⇒ 灰字「处理中」（状态名 ≠ 动作名）', () => {
		assert.equal(hintOf(btn('领取', S.submitted, S.working)), '处理中');
	});

	it('⭐ 取消按钮 ⇒ **留空**（文案与目标状态名都是「取消」）', () => {
		assert.equal(hintOf(btn('取消', S.submitted, S.canceled)), '');
	});

	it('⭐ 否决 ⇒ 灰字「拒绝」（旧版措辞：否决 / 否认）', () => {
		assert.equal(hintOf(btn('否决', S.submitted, S.rejected)), '拒绝');
		assert.equal(hintOf(btn('否认', S.authRequired, S.failed)), '失败');
	});
});

/* ══════════════════════════════════════════════════════════ */
describe('④ 着色：按目标状态的色相，不再「危险/不危险」二分', () => {
	/*
	 * 用户 `2026-11-18`：
	 * > 「他们目前的红色看起来像个错误。可能有不正确的视觉引导」
	 *
	 * 旧版把 失败 / 取消 / 拒绝 都画成红 —— 但取消是**褐**、拒绝是**橙**。
	 * ⇒ `isDangerAction()` 整个删掉，改成一状态一档。
	 */

	it('⭐ 失败 ⇒ failed（红）—— 红色**只**给失败', () => {
		assert.equal(toneOf(btn('失败', S.submitted, S.failed)), 'failed');
	});

	it('⭐ 取消 ⇒ canceled（褐），不是红', () => {
		assert.equal(toneOf(btn('取消', S.submitted, S.canceled)), 'canceled');
	});

	it('⭐ 否决 ⇒ rejected（橙），不是红', () => {
		assert.equal(toneOf(btn('否决', S.submitted, S.rejected)), 'rejected');
	});

	it('成功 ⇒ completed（绿）', () => {
		assert.equal(toneOf(btn('成功', S.submitted, S.completed)), 'completed');
	});

	it('推进类各自按目标状态着色', () => {
		assert.equal(toneOf(btn('采纳', S.draft, S.submitted, 'adopt')), 'submitted');
		assert.equal(toneOf(btn('领取', S.submitted, S.working, 'claim')), 'working');
		assert.equal(toneOf(btn('搁置', S.working, S.submitted, 'release')), 'submitted');
		assert.equal(toneOf(btn('重开', S.canceled, S.submitted)), 'submitted');
	});

	it('⚠ 三个终结按钮的档位**两两不同**（旧版三个都是红）', () => {
		const tones = [
			toneOf(btn('失败', S.submitted, S.failed)),
			toneOf(btn('取消', S.submitted, S.canceled)),
			toneOf(btn('否决', S.submitted, S.rejected)),
		];
		assert.equal(new Set(tones).size, 3);
	});

	it('⚠ 没有 danger 这个概念了（类型里不该再有）', () => {
		const items = menuModelOf(buttonsOf('work', S.submitted, 'user')).sections
			.flatMap((one) => one.items);
		for (const item of items) {
			assert.equal('danger' in item, false);
		}
	});
});

/* ══════════════════════════════════════════════════════════ */
describe('⑤ menuModelOf：整份渲染决定', () => {
	it('标题 / 页脚 / 胶囊 caret 与旧版原文一致', () => {
		assert.equal(MENU_TITLE, '变更状态');
		assert.equal(PILL_CARET, '⌄');
		assert.match(MENU_FOOTER, /AI 能否继续这张单/);
		assert.match(MENU_EMPTY, /没有可用的操作/);
	});

	it('有按钮 ⇒ empty = false，页脚照常给出', () => {
		const model = menuModelOf([btn('成功', S.submitted, S.completed)]);
		assert.equal(model.empty, false);
		assert.equal(model.footer, MENU_FOOTER);
		assert.equal(model.sections.length, 1);
	});

	it('⭐ 空按钮表 ⇒ empty = true（旧版：toast 后**不显示菜单**）', () => {
		const model = menuModelOf([]);
		assert.equal(model.empty, true);
		assert.deepEqual(model.sections, []);
	});

	it('每一项都带齐 action / icon / hint / tone 四个字段', () => {
		const model = menuModelOf([btn('取消', S.submitted, S.canceled)]);
		const item = model.sections[0]?.items[0];
		assert.ok(item !== undefined);
		assert.deepEqual(item, {
			action: btn('取消', S.submitted, S.canceled),
			icon: '⊘',
			hint: '',
			tone: 'canceled',
		});
	});
});

/* ══════════════════════════════════════════════════════════ */
describe('⑥ 真实按钮表：菜单文案 = protocol 的文案，一个字不改', () => {
	it('⭐ work / 提交 ⇒ 五段项：领取 · 成功 · 失败 · 取消 · 否决', () => {
		const actions = buttonsOf('work', S.submitted, 'user');
		const labels = sectionsOf(actions).flatMap((one) => one.items.map((item) => item.action.label));
		assert.deepEqual(labels, ['领取', '成功', '失败', '取消', '否决']);
	});

	it('⭐ 菜单标签**原样**等于按钮表标签（视图不写第二份文案）', () => {
		const actions = buttonsOf('work', S.submitted, 'user');
		const fromMenu = sectionsOf(actions).flatMap((one) =>
			one.items.map((item) => item.action.label),
		);
		assert.deepEqual(
			fromMenu,
			actions.map((one) => one.label),
		);
	});

	it('⭐ work / 提交 ⇒ 分成「进行」+「完成」两段（领取 / 其余四个）', () => {
		const sections = sectionsOf(buttonsOf('work', S.submitted, 'user'));
		assert.deepEqual(
			sections.map((one) => [one.group, one.items.length]),
			[
				['active', 1],
				['ended', 4],
			],
		);
	});

	it('work / 处理中 ⇒ 五个按钮，其中「搁置」在「进行」段（目标 = 提交）', () => {
		const sections = sectionsOf(buttonsOf('work', S.working, 'user'));
		const active = sections.find((one) => one.group === 'active');
		assert.deepEqual(
			active?.items.map((item) => item.action.label),
			['搁置'],
		);
	});

	it('goal / 草稿 ⇒ 采纳进「进行」、取消进「完成」', () => {
		const sections = sectionsOf(buttonsOf('goal', S.draft, 'user'));
		assert.deepEqual(
			sections.map((one) => [one.group, one.items.map((item) => item.action.label)]),
			[
				['active', ['采纳']],
				['ended', ['取消']],
			],
		);
	});

	it('⭐ goal / 取消 ⇒ 只有「重开」，图标 ↺', () => {
		const items = sectionsOf(buttonsOf('goal', S.canceled, 'user')).flatMap((one) => one.items);
		assert.deepEqual(
			items.map((one) => [one.action.label, one.icon]),
			[['重开', '↺']],
		);
	});

	it('⭐ design / 需要授权 ⇒ 确认进「完成」段（v3 口径，旧版手写为 active）', () => {
		const sections = sectionsOf(buttonsOf('design', S.authRequired, 'user'));
		const ended = sections.find((one) => one.group === 'ended');
		assert.deepEqual(
			ended?.items.map((item) => item.action.label),
			['确认', '取消', '否决'],
		);
	});

	it('⭐ 真实表上：红色只给失败，取消是褐、否决是橙（在真实表上再验一次）', () => {
		const items = sectionsOf(buttonsOf('work', S.submitted, 'user')).flatMap((one) => one.items);
		const byLabel = new Map(items.map((one) => [one.action.label, one.tone]));
		assert.equal(byLabel.get('成功'), 'completed');
		assert.equal(byLabel.get('失败'), 'failed');
		assert.equal(byLabel.get('取消'), 'canceled');
		assert.equal(byLabel.get('否决'), 'rejected');
	});

	it('⭐ 真实表里「取消」的灰字一律留空（三处取消按钮都撞名）', () => {
		const cases: readonly (readonly [string, ButtonAction['from']])[] = [
			['goal', S.draft],
			['goal', S.submitted],
			['work', S.working],
		];
		for (const [kind, from] of cases) {
			const cancel = buttonsOf(kind, from, 'user').filter((one) => one.to === S.canceled);
			assert.ok(cancel.length > 0, `${kind}/${from} 应该有取消按钮`);
			for (const one of cancel) assert.equal(hintOf(one), '');
		}
	});

	it('record / 需要授权 ⇒ 确认（完成）+ 否认（失败）', () => {
		const items = sectionsOf(buttonsOf('record', S.authRequired, 'user')).flatMap(
			(one) => one.items,
		);
		assert.deepEqual(
			items.map((one) => [one.action.label, one.icon, one.tone]),
			[
				['确认', '✓', 'completed'],
				['否认', '✕', 'failed'],
			],
		);
	});
});

/* ══════════════════════════════════════════════════════════ */
describe('⑦ 定位：照抄旧版 lib/menu.js 的放置策略', () => {
	/** 造一个矩形。 */
	const rect = (left: number, top: number, width: number, height: number): Rect => ({
		left,
		top,
		right: left + width,
		bottom: top + height,
	});
	const VIEW = { width: 1440, height: 900 };

	it('⭐ 水平：菜单左边缘对齐按钮左边缘（用户：他跑出去老远）', () => {
		const p = placeMenu(rect(944, 100, 80, 24), 300, VIEW);
		assert.equal(p.left, 944);
	});

	it('⭐ 垂直：下方放得下 ⇒ 向下，间隙 4px', () => {
		const p = placeMenu(rect(100, 100, 80, 24), 300, VIEW);
		assert.equal(p.top, 128);
		assert.equal(p.above, false);
	});

	it('⭐ 下方放不下、上方放得下 ⇒ 翻到上方，间隙 6px', () => {
		/* 按钮在离底 60px 处，菜单 300 ⇒ 下方只剩 52。 */
		const p = placeMenu(rect(100, 800, 80, 24), 300, VIEW);
		assert.equal(p.above, true);
		assert.equal(p.top, 800 - 300 - 6);
	});

	it('⭐ 两侧都放不下 ⇒ 选空间大的一侧 + 截断（max-height 有下限 140）', () => {
		/* 视口高 400、按钮在 200..224、菜单 300：下 160 / 上 184 ⇒ 选上。 */
		const p = placeMenu(rect(100, 200, 80, 24), 300, { width: 1440, height: 400 });
		assert.equal(p.above, true);
		assert.equal(p.maxHeight, 184);
	});

	it('max-height 不小于 140（旧版 Math.max(140, sideSpace)）', () => {
		/* 视口高 250、按钮在 120..144：下 90 / 上 104，两侧都 < 140。 */
		const p = placeMenu(rect(100, 120, 80, 24), 300, { width: 1440, height: 250 });
		assert.equal(p.maxHeight, 140);
		assert.equal(p.top >= MENU_MARGIN, true);
	});

	it('⭐ 左边缘不出界（按钮贴左边时压到 MARGIN）', () => {
		const p = placeMenu(rect(2, 100, 80, 24), 200, VIEW);
		assert.equal(p.left, MENU_MARGIN);
	});

	it('⭐ 右边缘放不下也不把菜单甩到按钮左边（只是被窗口截）', () => {
		/* 按钮 left 贴右边界：Math.min(rect.left, maxLeft) 取 maxLeft。 */
		const p = placeMenu(rect(1400, 100, 80, 24), 200, VIEW);
		assert.equal(p.left, 1440 - 280 - 8);
	});

	it('⭐ 宽度 / 留白 / 间隙常量与旧版一致', () => {
		assert.equal(MENU_WIDTH, 280);
		assert.equal(MENU_MARGIN, 8);
		assert.equal(MENU_GAP_BELOW, 4);
		assert.equal(MENU_GAP_ABOVE, 6);
		assert.equal(MENU_MIN_HEIGHT, 140);
	});
});

/* ══════════════════════════════════════════════════════════ */
describe('⑧ 键盘：意图映射 + 循环移动', () => {
	it('方向键 / Home / End / Enter / Escape', () => {
		assert.equal(keyIntentOf('ArrowDown'), 'next');
		assert.equal(keyIntentOf('ArrowUp'), 'prev');
		assert.equal(keyIntentOf('Home'), 'first');
		assert.equal(keyIntentOf('End'), 'last');
		assert.equal(keyIntentOf('Enter'), 'pick');
		assert.equal(keyIntentOf(' '), 'pick');
		assert.equal(keyIntentOf('Escape'), 'close');
	});

	it('其它键不拦截（返回 none，组件不该 preventDefault）', () => {
		assert.equal(keyIntentOf('a'), 'none');
		assert.equal(keyIntentOf('Tab'), 'none');
	});

	it('⭐ 向下循环：末尾回到 0，没有高亮时从 0 开始', () => {
		assert.equal(nextIndex(-1, 'next', 3), 0);
		assert.equal(nextIndex(0, 'next', 3), 1);
		assert.equal(nextIndex(2, 'next', 3), 0);
	});

	it('⭐ 向上循环：0 回到末尾，-1 也回到末尾', () => {
		assert.equal(nextIndex(0, 'prev', 3), 2);
		assert.equal(nextIndex(-1, 'prev', 3), 2);
		assert.equal(nextIndex(2, 'prev', 3), 1);
	});

	it('Home / End', () => {
		assert.equal(nextIndex(1, 'first', 3), 0);
		assert.equal(nextIndex(1, 'last', 3), 2);
	});

	it('空菜单 ⇒ -1（没有可高亮的项）', () => {
		assert.equal(nextIndex(-1, 'next', 0), -1);
		assert.equal(nextIndex(0, 'last', 0), -1);
	});
});

/* ══════════════════════════════════════════════════════════ */
describe('⑨ 点外面：用 composedPath()，不用 contains()', () => {
	const menu = { name: 'menu' } as unknown as EventTarget;
	const anchor = { name: 'anchor' } as unknown as EventTarget;
	const elsewhere = { name: 'elsewhere' } as unknown as EventTarget;
	const label = { name: 'label' } as unknown as EventTarget;

	it('⭐ 路径含菜单根 ⇒ 不关（点在菜单里，包括菜单项的文字节点）', () => {
		assert.equal(isOutsideClick([label, menu], menu, anchor), false);
	});

	it('⭐ 路径含触发按钮 ⇒ 不关（交给按钮 toggle，否则「再点一次」永远不生效）', () => {
		assert.equal(isOutsideClick([anchor], menu, anchor), false);
	});

	it('⭐ 别处 ⇒ 关', () => {
		assert.equal(isOutsideClick([elsewhere], menu, anchor), true);
	});

	it('⭐ 空路径 ⇒ 关（拿不到路径时按「外面」处理，宁可关掉）', () => {
		assert.equal(isOutsideClick([], menu, anchor), true);
	});

	it('⭐ 菜单节点已不在文档里也照样认（路径比对的是引用，不走 DOM 树）', () => {
		/* 这正是 React 换节点后 `contains()` 会误判、而 `composedPath()` 不会的场景。 */
		assert.equal(isOutsideClick([label, menu], menu, anchor), false);
	});

	it('anchor 为 null 时只看菜单路径', () => {
		assert.equal(isOutsideClick([anchor], menu, null), true);
		assert.equal(isOutsideClick([menu], menu, null), false);
	});
});
