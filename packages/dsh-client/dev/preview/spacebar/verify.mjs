/**
 * 验证 SpaceBar（空间 chip 行）。
 *
 * `node dev/preview/spacebar/verify.mjs`
 *
 * ## 断言分三块
 *
 * ① **那张表**：6 个固定场景，逐个读左侧那个按钮的 `textContent` / `disabled` /
 *    `data-action-kind` / `is-on`，再**真点一下**看派发了哪个回调
 *    （`data-event` 日志）。这不只是「画得对不对」，是「点下去做了什么」。
 * ② **点 chip 只改 viewing、不改 current** —— 这是用户 2026-11-09 的原话
 *    「查看和激活是要分离的」。断言 current 的 DOM 值和状态码**都没变**。
 * ③ **只有一个操作按钮**（用户：「不是两个独立按钮，是一个独立按钮」）+
 *    chip 的 `intent` 恒为 view + 「+」/「显示已归档」能点。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as nodePath from 'node:path';

const EDGE = [
	'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
	'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((one) => existsSync(one));
const HERE = import.meta.dirname;
/** 截图放本组件自己的子目录 ⇒ 不跟别的组件的 `dev/shots/` 抢文件名。 */
const OUT = nodePath.join(HERE, 'shots');
mkdirSync(OUT, { recursive: true });
const PAGE = nodePath.join(HERE, 'index.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const port = 9310;
const ud = mkdtempSync(nodePath.join(tmpdir(), 'sb-'));
const proc = spawn(
	EDGE,
	[
		'--headless=new',
		`--remote-debugging-port=${port}`,
		`--user-data-dir=${ud}`,
		'--no-first-run',
		'--no-default-browser-check',
		'--disable-gpu',
		'about:blank',
	],
	{ stdio: 'ignore' },
);

const wait = async (u, ms = 20000) => {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		try {
			const r = await fetch(u);
			if (r.ok) return;
		} catch {}
		await sleep(200);
	}
	throw new Error('timeout');
};
await wait(`http://127.0.0.1:${port}/json/version`);

const url = new URL(`file:///${PAGE.replace(/\\/g, '/')}`).href;
const t = await (
	await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })
).json();
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((o, n) => {
	ws.onopen = o;
	ws.onerror = n;
});

let i = 0;
const p = new Map();
const errors = [];
const failures = [];
ws.onmessage = (e) => {
	const m = JSON.parse(e.data);
	if (m.id && p.has(m.id)) {
		const q = p.get(m.id);
		p.delete(m.id);
		m.error ? q.reject(new Error(JSON.stringify(m.error))) : q.resolve(m.result);
		return;
	}
	if (m.method === 'Runtime.exceptionThrown') {
		errors.push(
			(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split(
				'\n',
			)[0],
		);
	}
};
const send = (method, params = {}) =>
	new Promise((res, rej) => {
		const id = ++i;
		p.set(id, { resolve: res, reject: rej });
		ws.send(JSON.stringify({ id, method, params }));
	});
await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', {
	width: 1300,
	height: 1600,
	deviceScaleFactor: 1,
	mobile: false,
});
await sleep(2200);

const shot = async (name) => {
	const { data } = await send('Page.captureScreenshot', { format: 'png' });
	writeFileSync(nodePath.join(OUT, name), Buffer.from(data, 'base64'));
};
const ev = async (x) => {
	const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true });
	if (r.exceptionDetails)
		console.log('  ERR', (r.exceptionDetails.exception?.description || '').slice(0, 300));
	return r.result?.value;
};
const click = async (sel) => {
	const b = await ev(`(() => { const el = ${sel}; if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }; })()`);
	if (b === null || b === undefined) return false;
	await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: b.x, y: b.y });
	await send('Input.dispatchMouseEvent', {
		type: 'mousePressed',
		x: b.x,
		y: b.y,
		button: 'left',
		buttons: 1,
		clickCount: 1,
	});
	await send('Input.dispatchMouseEvent', {
		type: 'mouseReleased',
		x: b.x,
		y: b.y,
		button: 'left',
		buttons: 0,
		clickCount: 1,
	});
	return true;
};

let total = 0;
const expect = (label, actual, want) => {
	total += 1;
	const ok = JSON.stringify(actual) === JSON.stringify(want);
	if (!ok)
		failures.push(`${label}\n      期望 ${JSON.stringify(want)}\n      实际 ${JSON.stringify(actual)}`);
	console.log(`  ${ok ? '✓' : '✗'} ${label}`);
};

/** 读某个场景的左侧按钮 + chip 全貌。 */
const readScenario = (key) => ev(`(() => {
  const box = document.querySelector('[data-scenario="${key}"] .space-bar');
  if (!box) return null;
  const a = box.querySelector('[data-space-action="1"]');
  const btns = box.querySelectorAll('[data-space-action="1"]');
  const chips = [...box.querySelectorAll('[data-chip-id]')];
  const acs = getComputedStyle(a);
  return {
    actionCount: btns.length,
    label: a.textContent.trim(),
    disabled: a.disabled,
    kind: a.dataset.actionKind,
    checked: a.dataset.checked === 'true',
    emphasis: a.dataset.emphasis,
    actionBg: acs.backgroundColor,
    actionColor: acs.color,
    actionBorder: acs.borderTopColor,
    title: a.title,
    barCurrent: box.dataset.current,
    barViewing: box.dataset.viewing,
    barShowArchived: box.dataset.showArchived,
    chips: chips.map(c => ({
      id: c.dataset.chipId,
      label: c.querySelector('.space-chip__name').textContent,
      current: c.dataset.chipCurrent === 'true',
      archived: c.dataset.chipArchived === 'true',
      viewing: c.dataset.chipViewing === 'true',
      intent: c.dataset.chipIntent,
      count: c.querySelector('.space-chip__count') ? c.querySelector('.space-chip__count').textContent : null,
      boxShadow: getComputedStyle(c).boxShadow,
      outlineWidth: getComputedStyle(c).outlineWidth,
      outlineStyle: getComputedStyle(c).outlineStyle,
    })),
    hasAdd: box.querySelector('[data-create="1"]') !== null,
    toggleLabel: box.querySelector('[data-archived-toggle="1"]').textContent.trim(),
    toggleActive: box.querySelector('[data-archived-toggle="1"]').classList.contains('is-active'),
  };
})()`);

/** 读回调日志（`data-event` 列表）。 */
const readEvents = () =>
	ev(`[...document.querySelectorAll('[data-event]')].map(li => li.dataset.event)`);
const clearEvents = () => ev(`document.querySelector('[data-clear-log]').click()`);
/** 读活的一行那三个状态码。 */
const readLive = () =>
	ev(`(() => ({
    current: document.querySelector('[data-live-current]').textContent,
    viewing: document.querySelector('[data-live-viewing]').textContent,
    show: document.querySelector('[data-live-show]').textContent,
  }))()`);

/* ══════════════════════════════════════════════════════════ */
	console.log('\n═══ ① 只有一个操作按钮（不是两个独立按钮）═══');
	{
		const boxes = await ev(`document.querySelectorAll('.space-bar').length`);
		/* 1 个布局对比 + 1 个活的一行 + 6 个固定场景 = 8 行 */
		expect('八个 SpaceBar 都渲染了（1 布局 + 1 活 + 6 场景）', boxes, 8);
	const off = await readScenario('off-other');
	expect('⭐ 左侧只有 1 个操作按钮', off.actionCount, 1);
	expect('⭐ chip 的 intent 恒为 view', off.chips.map((c) => c.intent), ['view', 'view', 'view']);
	const on = await readScenario('on-other');
	expect('开态下仍有「+」新建', on.hasAdd, true);
	expect('关态下也有「+」新建', off.hasAdd, true);
	await shot('01-overview.png');
}

console.log('\n═══ ② 表第 1 行：显示已归档=关 ═══');
{
	const s = await readScenario('off-other');
	/*
	 * ⚠ 文案**已合并**（用户 2026-11-18：「那个 6 个字的占用文档流太宽了」）。
	 *   原来这里是「激活此为当前空间」，现在是「当前空间」——
	 *   靠 `emphasis=action` 表示「可以切过去」。
	 */
	expect('⭐ 文案 = 当前空间（6 字已合并成 4 字）', s.label, '当前空间');
	expect('⭐ 可点', s.disabled, false);
	expect('kind = activate', s.kind, 'activate');
	expect('checked = false', s.checked, false);
	expect('⭐ emphasis = action（描边，像按钮）', s.emphasis, 'action');
	expect('开关文案 = 显示已归档', s.toggleLabel, '显示已归档');
	expect(
		'归档 chip 不显示（关态过滤掉了）',
		s.chips.map((c) => c.id),
		['ws-core', 'ws-code', 'ws-write'],
	);
	expect(
		'查看的是 ws-code ⇒ 只有它 is-viewing',
		s.chips.map((c) => c.viewing),
		[false, true, false],
	);
	expect(
		'当前是 ws-core ⇒ 只有它 is-current',
		s.chips.map((c) => c.current),
		[true, false, false],
	);
	expect(
		'计数只出现在正在查看的 chip 上',
		s.chips.map((c) => c.count),
		[null, '7', null],
	);
	/*
	 * ⚠ 「上下边框被遮挡」的回归断言：
	 *   选中环**必须是 inset box-shadow**，不能是 outline ——
	 *   outline 画在 border-box 外面、不计入 rect、会被 overflow 裁掉。
	 *
	 * ⚠ 不能用 `outlineWidth === '0px'` 判断：Chrome 的默认 `outline-width` 是
	 *   `medium`（= 3px），即使 `outline-style: none` 也报 3px。
	 *   **真正的判据是 `outline-style === 'none'`** —— 这里踩过一次，写下来。
	 */
	expect('⚠ 选中 chip 用 inset 阴影（不是 outline）', s.chips[1].boxShadow.includes('inset'), true);
	expect('⚠ 选中 chip 不画 outline（会被 overflow 裁掉）', s.chips[1].outlineStyle, 'none');

	await clearEvents();
	await click(`document.querySelector('[data-scenario="off-other"] [data-space-action="1"]')`);
	await sleep(350);
	expect('⭐ 点它 = 派发 activate:ws-code', await readEvents(), ['off-other/activate:ws-code']);
	await shot('02-off-other.png');
}

console.log('\n═══ ③ 表第 1 行后半：关 + 查看的就是当前 ═══');
{
	const s = await readScenario('off-current');
	expect('⭐ 文案 = 当前空间', s.label, '当前空间');
	expect('⭐ 禁用', s.disabled, true);
	expect('kind 仍是 activate（同一个按钮）', s.kind, 'activate');
	expect('⭐ emphasis = current（实心，像徽章）', s.emphasis, 'current');
	await clearEvents();
	await click(`document.querySelector('[data-scenario="off-current"] [data-space-action="1"]')`);
	await sleep(300);
	expect('⭐ 禁用 ⇒ 点它什么都不派发', await readEvents(), []);
	await shot('03-off-current.png');
}

console.log('\n═══ ③b ⭐ 文案合并后：两格都是「当前空间」，必须靠 emphasis + 颜色区分 ═══');
{
	const can = await readScenario('off-other');
	const is = await readScenario('off-current');
	expect('两格文案相同', [can.label, is.label], ['当前空间', '当前空间']);
	expect('⚠ emphasis 必须不同', [can.emphasis, is.emphasis], ['action', 'current']);
	expect('⚠ 背景色必须不同（着色区分）', can.actionBg !== is.actionBg, true);
	expect('⚠ 文字色必须不同', can.actionColor !== is.actionColor, true);
	expect('⚠ title 必须不同（说清点了会怎样）', can.title === is.title, false);
	expect('可点那个的 title 说「点一下」', /点一下/.test(can.title), true);
	expect('不可点那个的 title 说「这就是当前空间」', /这就是当前空间/.test(is.title), true);
	console.log(`     可点: bg=${can.actionBg} color=${can.actionColor}`);
	console.log(`     当前: bg=${is.actionBg} color=${is.actionColor}`);
}

console.log('\n═══ ④ 表第 2 行：开 + 非当前（未归档）═══');
{
	const s = await readScenario('on-other');
	expect('⭐ 文案 = 已归档', s.label, '已归档');
	expect('⭐ 可点', s.disabled, false);
	expect('kind = toggle-archived', s.kind, 'toggle-archived');
	expect('未归档 ⇒ checked = false（未选中）', s.checked, false);
	expect('开关文案翻面 = 隐藏已归档', s.toggleLabel, '隐藏已归档');
	expect('开关渲染成 is-active', s.toggleActive, true);
	expect(
		'开态 ⇒ 归档空间也出现在列表里',
		s.chips.map((c) => c.id),
		['ws-core', 'ws-code', 'ws-write', 'ws-old'],
	);
	expect(
		'归档 chip 的 is-archived = true',
		s.chips.map((c) => c.archived),
		[false, false, false, true],
	);
	await clearEvents();
	await click(`document.querySelector('[data-scenario="on-other"] [data-space-action="1"]')`);
	await sleep(350);
	expect('⭐ 点它 = 派发 toggle-archived:ws-code（归档）', await readEvents(), [
		'on-other/toggle-archived:ws-code',
	]);
	await shot('04-on-other.png');
}

console.log('\n═══ ⑤ 表第 2 行后半：开 + 非当前（已归档）═══');
{
	const s = await readScenario('on-other-archived');
	expect('⭐ 文案 = 已归档', s.label, '已归档');
	expect('⭐ 可点（取消归档）', s.disabled, false);
	expect('⭐ 选中态 is-on', s.checked, true);
	expect('title 说「取消归档」', /取消归档/.test(s.title), true);
	await clearEvents();
	await click(
		`document.querySelector('[data-scenario="on-other-archived"] [data-space-action="1"]')`,
	);
	await sleep(350);
	expect('⭐ 点它 = 派发 toggle-archived:ws-old（取消归档）', await readEvents(), [
		'on-other-archived/toggle-archived:ws-old',
	]);
}

console.log('\n═══ ⑥ 表第 3 行：开 + 当前空间（未归档）═══');
{
	const s = await readScenario('on-current');
	expect('⭐ 文案 = 当前空间（**不是**「已归档」）', s.label, '当前空间');
	expect('⭐ 文案不含「已归档」', /已归档/.test(s.label), false);
	expect('⭐ 禁用', s.disabled, true);
	expect('未归档 ⇒ checked = false（不能画成选中）', s.checked, false);
	expect('kind 仍是 toggle-archived（同一张表、同一个按钮）', s.kind, 'toggle-archived');
	expect('title 说「不能归档」', /不能归档/.test(s.title), true);
	await clearEvents();
	await click(`document.querySelector('[data-scenario="on-current"] [data-space-action="1"]')`);
	await sleep(300);
	expect('⭐ 禁用 ⇒ 点它什么都不派发', await readEvents(), []);
	await shot('05-on-current.png');
}

console.log('\n═══ ⑦ 表第 4 行：开 + 当前空间（已归档，异常态）═══');
{
	const s = await readScenario('on-current-archived');
	expect('⭐ 文案 = 已归档', s.label, '已归档');
	expect('⭐ 异常态必须**可点**（否则没法取消归档）', s.disabled, false);
	expect('⭐ 选中态 is-on', s.checked, true);
	expect('title 说「取消归档」而不是「不能归档」', /取消归档/.test(s.title), true);
	expect('这一格不能是「当前空间」（那是未归档时的防误导文案）', s.label === '当前空间', false);
	expect(
		'该 chip 同时 is-current + is-archived（异常态的视觉依据）',
		(() => {
			const one = s.chips.find((c) => c.id === 'ws-old');
			return one === undefined ? null : { id: one.id, label: one.label, current: one.current, archived: one.archived, viewing: one.viewing, intent: one.intent, count: one.count };
		})(),
		{
			id: 'ws-old',
			label: '旧空间',
			current: true,
			archived: true,
			viewing: true,
			intent: 'view',
			count: '0',
		},
	);
	await clearEvents();
	await click(
		`document.querySelector('[data-scenario="on-current-archived"] [data-space-action="1"]')`,
	);
	await sleep(350);
	expect('⭐ 点它 = 派发 toggle-archived:ws-old（取消归档，修回正常）', await readEvents(), [
		'on-current-archived/toggle-archived:ws-old',
	]);
	await shot('06-anomaly.png');
}

console.log('\n═══ ⑧ ⭐ 点 chip 只改 viewing、不改 current ═══');
{
	await ev(`document.querySelector('[data-clear-log]').click()`);
	const before = await readLive();
	expect('起点：current = viewing = ws-core', [before.current, before.viewing], [
		'ws-core',
		'ws-core',
	]);
	expect('起点 cardCount = 12', await ev(`document.querySelector('[data-live-count]').textContent`), '12');

	/* 点「代码」那个 chip */
	await click(`document.querySelector('[data-live] [data-chip-id="ws-code"]')`);
	await sleep(400);
	const after = await readLive();
	expect('⭐ viewing 变成 ws-code', after.viewing, 'ws-code');
	expect('⭐ current **没变**（还是 ws-core）', after.current, 'ws-core');
	expect('⭐ 回调只有 view:ws-code，**没有** activate', await readEvents(), ['view:ws-code']);
	expect(
		'计数跟着正在查看的空间变（ws-code = 7）',
		await ev(`document.querySelector('[data-live-count]').textContent`),
		'7',
	);

	/* 点 chip 后活的那行的按钮：文案不变，但 emphasis 从 current 变成 action */
	const liveAction = await ev(`(() => {
    const a = document.querySelector('[data-live] [data-space-action="1"]');
    const s = getComputedStyle(a);
    return { label: a.textContent.trim(), disabled: a.disabled, emphasis: a.dataset.emphasis, bg: s.backgroundColor };
  })()`);
	expect('⭐ 查看非当前 ⇒ 按钮变可点（文案仍是「当前空间」）', liveAction, {
		label: '当前空间',
		disabled: false,
		emphasis: 'action',
		bg: 'rgb(255, 255, 255)',
	});

	/* 点当前空间（ws-core）的 chip —— 也是 view，不是 activate */
	await ev(`document.querySelector('[data-clear-log]').click()`);
	await click(`document.querySelector('[data-live] [data-chip-id="ws-core"]')`);
	await sleep(350);
	expect('⭐ 点当前空间的 chip 也只派发 view（不改 current）', await readEvents(), ['view:ws-core']);
	expect('current 仍然没变', (await readLive()).current, 'ws-core');
	await shot('07-chip-view.png');
}

console.log('\n═══ ⑨ 点 chip = 视图跟着变（用户踩过的坑：下面的视图不变）═══');
{
	/*
	 * ⑧ 最后点回了当前空间的 chip ⇒ viewing 又回到 ws-core。
	 * 这里再点一次「代码」把 viewing 挪过去，然后断言**每一格**的 viewing / current。
	 */
	await ev(`document.querySelector('[data-clear-log]').click()`);
	await click(`document.querySelector('[data-live] [data-chip-id="ws-code"]')`);
	await sleep(350);
	const liveChips = await ev(`(() => {
    const box = document.querySelector('[data-live] .space-bar');
    return [...box.querySelectorAll('[data-chip-id]')].map(c => ({
      id: c.dataset.chipId,
      viewing: c.dataset.chipViewing === 'true',
      current: c.dataset.chipCurrent === 'true',
    }));
  })()`);
	expect('⭐ viewing 落在 ws-code 上、current 仍在 ws-core', liveChips, [
		{ id: 'ws-core', viewing: false, current: true },
		{ id: 'ws-code', viewing: true, current: false },
		{ id: 'ws-write', viewing: false, current: false },
	]);
	expect('⭐ 视图跟着切了（下面的状态码同步）', (await readLive()).viewing, 'ws-code');
	expect('current 仍然没动', (await readLive()).current, 'ws-core');
}

console.log('\n═══ ⑩ 「显示已归档」开关：真点一下 ═══');
{
	await ev(`document.querySelector('[data-clear-log]').click()`);
	await click(`document.querySelector('[data-live] [data-archived-toggle="1"]')`);
	await sleep(400);
	const live = await readLive();
	expect('⭐ showArchived 翻成 true', live.show, 'true');
	expect('⭐ 派发 toggle-show-archived', await readEvents(), ['toggle-show-archived']);
	const chips = await ev(`(() => {
    const box = document.querySelector('[data-live] .space-bar');
    return [...box.querySelectorAll('[data-chip-id]')].map(c => c.dataset.chipId);
  })()`);
	expect('⭐ 归档的空间出现（ws-old）', chips, ['ws-core', 'ws-code', 'ws-write', 'ws-old']);
	/* 并且这个组件此刻的按钮语义从「激活」换成了「归档」 */
	const liveAction = await ev(`(() => {
    const a = document.querySelector('[data-live] [data-space-action="1"]');
    return { label: a.textContent.trim(), kind: a.dataset.actionKind, disabled: a.disabled };
  })()`);
	expect('⭐ 开态后同一个按钮换成归档语义（查看的是 ws-code ≠ 当前）', liveAction, {
		label: '已归档',
		kind: 'toggle-archived',
		disabled: false,
	});
	await shot('08-show-archived.png');
}

console.log('\n═══ ⑪ 点「+」新建 ═══');
{
	await ev(`document.querySelector('[data-clear-log]').click()`);
	await click(`document.querySelector('[data-live] [data-create="1"]')`);
	await sleep(350);
	expect('⭐ 派发 create', await readEvents(), ['create']);
}

console.log('\n═══ ⑫ DOM 契约 + ⭐ 开头两按钮也在换行流里 ═══');
{
	/*
	 * 用户 2026-11-18：
	 * > 「最开头的那两个按钮，归档和激活空间，也在视图里，
	 * >  也就是说换行不是从那两个按钮右边才开始换行。」
	 *
	 * ⇒ 四个东西（操作按钮 / 显示已归档 / 第一个 chip / 「+」）必须是
	 *   `.space-bar` 的**直接子元素**，不能有三个在某个 actions 容器里。
	 *   这一条如果红，说明又套回了「左边固定 + 右边换行」的两层结构。
	 */
	const hooks = await ev(`(() => {
    const box = document.querySelector('[data-live] .space-bar');
    const action = box.querySelector('[data-space-action="1"]');
    const toggle = box.querySelector('[data-archived-toggle="1"]');
    const firstChip = box.querySelector('[data-chip-id]');
    const add = box.querySelector('[data-create="1"]');
    const style = getComputedStyle(box);
    const kids = [...box.children];
    return {
      spaceBar: box.classList.contains('space-bar'),
      flexWrap: style.flexWrap,
      overflowX: style.overflowX,
      hasActionsWrapper: box.querySelector('.space-bar__actions') !== null,
      sameParent: [action, toggle, firstChip, add].every(el => el.parentElement === box),
      actionIdx: kids.indexOf(action),
      toggleIdx: kids.indexOf(toggle),
      addIdx: kids.indexOf(add),
      lastIdx: kids.length - 1,
      childCount: kids.length,
      chipCount: box.querySelectorAll('[data-chip-id]').length,
    };
  })()`);

	expect('根 class = space-bar', hooks.spaceBar, true);
	expect('⭐ `.space-bar` 自己就是换行容器（flex-wrap = wrap）', hooks.flexWrap, 'wrap');
	expect('⭐ 没有 `.space-bar__actions` 包裹层了', hooks.hasActionsWrapper, false);
	expect(
		'⭐ 操作按钮 / 显示已归档 / 第一个 chip / 「+」四者的 parentElement 都是 .space-bar',
		hooks.sameParent,
		true,
	);
	expect('⭐ 顺序：操作按钮第 0 个', hooks.actionIdx, 0);
	expect('⭐ 顺序：显示已归档第 1 个', hooks.toggleIdx, 1);
	expect('⭐ 顺序：「+」在 DOM 上排最后', hooks.addIdx, hooks.lastIdx);
	expect('⭐ 子元素数 = 2 个按钮 + chips + 1 个「+」', hooks.childCount, hooks.chipCount + 3);
	expect('⚠ 不横向溢出（换行就是没有滚动条）', hooks.overflowX, 'visible');
}

console.log('\n═══ ⑬ ⭐ 窄窗口下真的换行（高度变大、无横向溢出）═══');
{
	const measure = async () => ev(`(() => {
    const box = document.querySelector('[data-wrap-live] .space-bar');
    const kids = [...box.children];
    const tops = new Set(kids.map(el => Math.round(el.getBoundingClientRect().top)));
    return {
      rows: tops.size,
      height: Math.round(box.getBoundingClientRect().height),
      scrollW: box.scrollWidth,
      clientW: box.clientWidth,
      kids: kids.length,
    };
  })()`);

	/*
	 * 三段测量 —— 证明「换行」是真的随窗口宽度变化的，不是横向滚动。
	 *
	 * ⚠ 1160px 时 13 个 chip 恰好能放下一行（h=38, rows=1）—— 那不是 bug，
	 *   是夹具还不够宽。所以真正的换行证据放在 900px 和 320px 两档。
	 */
	const setW = async (width) => {
		await send('Emulation.setDeviceMetricsOverride', {
			width,
			height: 1400,
			deviceScaleFactor: 1,
			mobile: false,
		});
		await sleep(600);
	};

	/* ① 宽屏：能放下一行，且无横向溢出 */
	const wide = await measure();
	console.log(`     1160px: rows=${wide.rows} h=${wide.height} scrollW=${wide.scrollW} clientW=${wide.clientW}`);
	expect('⭐ 宽屏下无横向溢出（scrollWidth === clientWidth）', wide.scrollW, wide.clientW);

	/* ② 900px：必须换行 —— 这是「换行真的发生了」的直接证据 */
	await setW(900);
	const mid = await measure();
	console.log(`      900px: rows=${mid.rows} h=${mid.height} scrollW=${mid.scrollW} clientW=${mid.clientW}`);
	expect('⭐ 900px 时换行成 2 行以上', mid.rows >= 2, true);
	expect('⭐ 900px 时比宽屏高（真的占了多行）', mid.height > wide.height, true);
	expect('⭐ 900px 时仍无横向溢出', mid.scrollW, mid.clientW);

	/* ③ 320px：行数更多、更高 */
	await setW(320);
	const narrow = await measure();
	console.log(`      320px: rows=${narrow.rows} h=${narrow.height} scrollW=${narrow.scrollW} clientW=${narrow.clientW}`);
	expect('⭐ 320px 时行数比 900px 更多', narrow.rows > mid.rows, true);
	expect('⭐ 320px 时整行高度更大', narrow.height > mid.height, true);
	expect('⭐ 320px 时仍然无横向溢出', narrow.scrollW, narrow.clientW);

	/* 恢复宽度 */
	await setW(1160);
	await sleep(300);
	await shot('09-wrap.png');
}

console.log('\n═══ ⑭ ⭐ 几何：按钮上下边框不被裁（用户说「条太窄」）═══');
{
	const g = await ev(`(() => {
    const box = document.querySelector('[data-wrap-live] .space-bar');
    const action = box.querySelector('[data-space-action="1"]');
    const br = box.getBoundingClientRect();
    const ar = action.getBoundingClientRect();
    const chips = [...box.querySelectorAll('[data-chip-id]')];
    /* chip 有没有越出容器（上下左右） */
    const escaped = chips.filter(c => {
      const r = c.getBoundingClientRect();
      return r.top < br.top - 0.5 || r.bottom > br.bottom + 0.5
        || r.left < br.left - 0.5 || r.right > br.right + 0.5;
    }).length;
    const viewing = box.querySelector('.space-chip.is-viewing');
    return {
      barH: Math.round(br.height),
      actionH: Math.round(ar.height),
      topGap: Math.round(ar.top - br.top),
      bottomGap: Math.round(br.bottom - ar.bottom),
      inside: ar.top >= br.top - 0.5 && ar.bottom <= br.bottom + 0.5,
      escaped,
      viewingShadow: viewing ? getComputedStyle(viewing).boxShadow : null,
      viewingOutline: viewing ? getComputedStyle(viewing).outlineStyle : null,
    };
  })()`);
	expect('⭐ 操作按钮完全在容器内（上下边框不被裁）', g.inside, true);
	expect('⚠ 按钮上下都有留白（≥4px，用户说「太窄」）', g.topGap >= 4 && g.bottomGap >= 4, true);
	expect('⚠ 没有 chip 越出容器（选中环不被裁）', g.escaped, 0);
	console.log(`     barH=${g.barH} actionH=${g.actionH} topGap=${g.topGap} bottomGap=${g.bottomGap}`);

	expect('⭐ 环是 inset box-shadow', g.viewingShadow !== null && g.viewingShadow.includes('inset'), true);
	expect('⚠ 不画 outline（画在盒外会被 overflow 裁）', g.viewingOutline, 'none');
}
console.log('\n═══ JS 错误 ═══');
console.log(errors.length ? errors.join('\n') : '  没有');
console.log('\n═══ 断言结果 ═══');
console.log(failures.length ? failures.join('\n') : '  全部通过');
console.log(`  断言数 ${total}（失败 ${failures.length}）`);

proc.kill();
process.exit(failures.length > 0 || errors.length > 0 ? 1 : 0);
