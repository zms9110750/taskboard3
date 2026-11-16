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
  return {
    actionCount: btns.length,
    label: a.textContent.trim(),
    disabled: a.disabled,
    kind: a.dataset.actionKind,
    checked: a.dataset.checked === 'true',
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
	/* 1 个活的一行 + 6 个固定场景 = 7 行 */
	expect('七个 SpaceBar 都渲染了（1 活 + 6 场景）', boxes, 7);
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
	expect('⭐ 文案 = 激活此为当前空间', s.label, '激活此为当前空间');
	expect('⭐ 可点', s.disabled, false);
	expect('kind = activate', s.kind, 'activate');
	expect('checked = false', s.checked, false);
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

	await clearEvents();
	await click(`document.querySelector('[data-scenario="off-other"] [data-space-action="1"]')`);
	await sleep(350);
	expect('⭐ 点它 = 派发 activate:ws-code', await readEvents(), ['off-other/activate:ws-code']);
	await shot('02-off-other.png');
}

console.log('\n═══ ③ 表第 1 行后半：关 + 查看的就是当前 ═══');
{
	const s = await readScenario('off-current');
	expect('⭐ 文案 = 当前空间（不是「激活…」）', s.label, '当前空间');
	expect('⭐ 禁用', s.disabled, true);
	expect('kind 仍是 activate（同一个按钮）', s.kind, 'activate');
	await clearEvents();
	await click(`document.querySelector('[data-scenario="off-current"] [data-space-action="1"]')`);
	await sleep(300);
	expect('⭐ 禁用 ⇒ 点它什么都不派发', await readEvents(), []);
	await shot('03-off-current.png');
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
		s.chips.find((c) => c.id === 'ws-old'),
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

	/* 点 chip 后活的那行的按钮文案应该从「当前空间」变成「激活此为当前空间」 */
	const liveAction = await ev(`(() => {
    const a = document.querySelector('[data-live] [data-space-action="1"]');
    return { label: a.textContent.trim(), disabled: a.disabled };
  })()`);
	expect('⭐ 查看非当前 ⇒ 按钮变「激活此为当前空间」且可点', liveAction, {
		label: '激活此为当前空间',
		disabled: false,
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

console.log('\n═══ ⑫ DOM 契约（其他组件/测试要依赖的钩子）═══');
{
	const hooks = await ev(`(() => {
    const box = document.querySelector('[data-live] .space-bar');
    return {
      spaceBar: box.classList.contains('space-bar'),
      hasActions: box.querySelector('.space-bar__actions') !== null,
      hasScroll: box.querySelector('.space-bar__scroll') !== null,
      actionCount: box.querySelectorAll('.space-bar__actions button').length,
    };
  })()`);
	expect('根 class = space-bar', hooks.spaceBar, true);
	expect('左侧 actions 容器存在', hooks.hasActions, true);
	expect('chip 滚动容器存在', hooks.hasScroll, true);
	expect('⭐ 左侧恰好 2 个按钮：那**一个**操作按钮 + 「显示已归档」', hooks.actionCount, 2);
}

console.log('\n═══ JS 错误 ═══');
console.log(errors.length ? errors.join('\n') : '  没有');
console.log('\n═══ 断言结果 ═══');
console.log(failures.length ? failures.join('\n') : '  全部通过');
console.log(`  断言数 ${total}（失败 ${failures.length}）`);

proc.kill();
process.exit(failures.length > 0 || errors.length > 0 ? 1 : 0);
