/**
 * 验证 StatusPill + StatusMenu。
 *
 * `node packages/dsh-client/dev/preview/statusmenu/verify.mjs`
 *
 * ## 十块
 *
 * ① 打开：点胶囊 ⇒ 菜单出现（portal 挂 body）、标题 / 页脚 / 五项 / 两段 / 图标 / 灰字 / 危险色。
 * ② 选一项：状态真变、菜单关、先关后派发。
 * ③ **再点一次胶囊能关**（旧版修过的真 bug：捕获阶段监听把菜单先删了）。
 * ④ 点外面收起。⑤ 键盘：↓↑Home 高亮 + Escape 关。⑥ Enter 选中。
 * ⑦ 静态矩阵：菜单项 = `buttonsOf()` 一一对应。⑧ 定位：左对齐 / 翻上方 / 不出右界。
 * ⑨ 空按钮表。⑩ DOM 契约。
 *
 * ⚠ **顺序有讲究**：点「清空日志」按钮本身是一次 document 点击 ⇒ 会把菜单关掉。
 *   所以所有 `clearLog()` 都只在菜单**关着**的时候调用，开菜单之后改用
 *   「记录事件长度再取切片」来断言，不中途清日志。
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
const OUT = nodePath.join(HERE, 'shots');
mkdirSync(OUT, { recursive: true });
const PAGE = nodePath.join(HERE, 'index.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const port = 9333;
const ud = mkdtempSync(nodePath.join(tmpdir(), 'sm-'));
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
	width: 1280,
	height: 900,
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
const clickAt = async (x, y) => {
	await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
	await send('Input.dispatchMouseEvent', {
		type: 'mousePressed',
		x,
		y,
		button: 'left',
		buttons: 1,
		clickCount: 1,
	});
	await send('Input.dispatchMouseEvent', {
		type: 'mouseReleased',
		x,
		y,
		button: 'left',
		buttons: 0,
		clickCount: 1,
	});
};
const centerOf = async (sel) =>
	ev(`(() => { const el = ${sel}; if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }; })()`);
const click = async (sel) => {
	const b = await centerOf(sel);
	if (b === null || b === undefined) return false;
	await clickAt(b.x, b.y);
	return true;
};
const key = async (k, code) => {
	await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: 0 });
	await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: 0 });
};

let total = 0;
const expect = (label, actual, want) => {
	total += 1;
	const ok = JSON.stringify(actual) === JSON.stringify(want);
	if (!ok)
		failures.push(`${label}\n      期望 ${JSON.stringify(want)}\n      实际 ${JSON.stringify(actual)}`);
	console.log(`  ${ok ? '✓' : '✗'} ${label}`);
};

const MENU = `document.querySelector('[data-menu="status"]')`;
const LIVE_PILL = `document.querySelector('[data-live-anchor] .status-pill')`;
const menuInfo = () =>
	ev(`(() => {
    const m = ${MENU};
    if (!m) return null;
    return {
      parent: m.parentElement === document.body ? 'body' : (m.parentElement && m.parentElement.className),
      title: m.querySelector('.menu__title')?.textContent ?? null,
      footer: m.querySelector('.menu__footer')?.textContent ?? null,
      groups: [...m.querySelectorAll('[data-menu-group]')].map(g => g.dataset.menuGroup),
      items: [...m.querySelectorAll('[data-menu-item]')].map(b => ({
        label: b.querySelector('.menu__label').textContent,
        icon: b.querySelector('.menu__icon').textContent,
        hint: b.querySelector('.menu__hint')?.textContent ?? '',
        to: b.dataset.menuTo,
        danger: b.dataset.menuDanger === 'true',
      })),
      empty: m.querySelector('[data-menu-empty]')?.textContent ?? null,
    };
  })()`);
const events = () => ev(`[...document.querySelectorAll('[data-event]')].map(li => li.dataset.event)`);
const clearLog = () => ev(`document.querySelector('[data-clear-log]').click()`);
const openCount = () => ev(`${MENU} !== null`);
const liveStatus = () => ev(`document.querySelector('[data-live-status]').textContent`);

/** 关掉菜单（点左上角空白 —— 那里没有可点元素，只会触发「点外面」）。 */
const closeMenu = async () => {
	await clickAt(6, 6);
	await sleep(200);
};
/** 打开活的那张菜单（先确保关着、且活的那行在视口里）。 */
const openLive = async () => {
	await closeMenu();
	/* ⚠ 前面的场景会把页面滚到底部 ⇒ 先把活的那行滚回视口，否则点不到胶囊。 */
	await ev(`document.querySelector('[data-live-row]').scrollIntoView({ block: 'center' })`);
	await sleep(250);
	await click(LIVE_PILL);
	await sleep(300);
};
/** 记录当前日志长度，返回一个「只看新增」的读取器。 */
const mark = async () => (await events()).length;
const since = async (n) => (await events()).slice(n);

/* ══════════════════════════════════════════════════════════ */
console.log('\n═══ ① 打开：点胶囊 ⇒ 菜单出现 ═══');
{
	await closeMenu();
	await clearLog();
	expect('起点：没有菜单', await openCount(), false);
	expect(
		'胶囊渲染成 button 且三段齐',
		await ev(`(() => {
      const p = ${LIVE_PILL};
      return {
        tag: p.tagName,
        caret: p.querySelector('.status-pill__caret').textContent,
        label: p.querySelector('.status-pill__label').textContent,
        dot: p.querySelector('.dot').className,
      };
    })()`),
		{ tag: 'BUTTON', caret: '⌄', label: '提交', dot: 'dot dot--active' },
	);

	await click(LIVE_PILL);
	await sleep(300);
	const m = await menuInfo();
	expect('⭐ 菜单挂 document.body（浮层，不被详情面板裁）', m?.parent, 'body');
	expect('标题 = 变更状态', m?.title, '变更状态');
	expect('页脚 = 旧版原文', /状态变更会影响 AI 能否继续这张单/.test(m?.footer ?? ''), true);
	expect('⭐ 五项：领取 / 成功 / 失败 / 取消 / 否绝', m?.items.map((x) => x.label), [
		'领取',
		'成功',
		'失败',
		'取消',
		'否绝',
	]);
	expect('⭐ 两段：进行 + 完成（v3 用 groupOf(to) 算）', m?.groups, ['active', 'ended']);
	expect('图标照旧版表', m?.items.map((x) => x.icon), ['▶', '✓', '✕', '⊘', '✕']);
	expect('灰字：处理中 / 空 / 空 / 空（取消撞名）/ 拒绝', m?.items.map((x) => x.hint), [
		'处理中',
		'',
		'',
		'',
		'拒绝',
	]);
	expect('⭐ 危险色：只有失败 / 取消 / 否绝', m?.items.map((x) => x.danger), [
		false,
		false,
		true,
		true,
		true,
	]);
	expect(
		'胶囊 aria-expanded = true',
		await ev(`${LIVE_PILL}.getAttribute('aria-expanded')`),
		'true',
	);
	expect('胶囊 caret 翻成 ⌃', await ev(`${LIVE_PILL}.querySelector('.status-pill__caret').textContent`), '⌃');
	await shot('01-open.png');
}

/* ══════════════════════════════════════════════════════════ */
console.log('\n═══ ② 选一项：状态真变、菜单关 ═══');
{
	const n = await mark();
	await click(
		`document.querySelector('[data-menu="status"] [data-menu-item][data-menu-to="TASK_STATE_WORKING"]')`,
	);
	await sleep(350);
	expect('⭐ 菜单关了', await openCount(), false);
	expect('⭐ 状态变成 WORKING', await liveStatus(), 'TASK_STATE_WORKING');
	expect('⭐ 派发顺序：先 close 再 pick', await since(n), [
		'close',
		'pick:领取:TASK_STATE_WORKING',
	]);
	await shot('02-picked.png');
}

/* ══════════════════════════════════════════════════════════ */
console.log('\n═══ ③ 再点一次胶囊能关（旧版修过的真 bug）═══');
{
	/* WORKING → 提交：菜单里「搁置」那项。 */
	await openLive();
	await click(`document.querySelector('[data-menu="status"] [data-menu-item][data-menu-to="TASK_STATE_SUBMITTED"]')`);
	await sleep(350);
	expect('起点：用「搁置」回到提交态', await liveStatus(), 'TASK_STATE_SUBMITTED');

	await closeMenu();
	const n = await mark();
	await click(LIVE_PILL);
	await sleep(300);
	expect('第一次点：菜单开了', await openCount(), true);
	await click(LIVE_PILL);
	await sleep(350);
	expect('⭐ 第二次点同一个胶囊：菜单关了（不是「关了又弹一个」）', await openCount(), false);
	expect('⭐ 日志只有 toggle open + toggle close（没被「点外面」抢跑）', await since(n), [
		'pill-toggle:open',
		'pill-toggle:close',
	]);
}

/* ══════════════════════════════════════════════════════════ */
console.log('\n═══ ④ 点外面收起 ═══');
{
	await openLive();
	expect('菜单开着', await openCount(), true);
	const n = await mark();
	await clickAt(640, 890);
	await sleep(300);
	expect('⭐ 点页面空白处 ⇒ 菜单关了', await openCount(), false);
	expect('派发了 close', (await since(n)).includes('close'), true);
}

/* ══════════════════════════════════════════════════════════ */
console.log('\n═══ ⑤ 键盘：↓↑Home 高亮 + Escape 关 ═══');
{
	const active = () =>
		ev(`${MENU} ? (${MENU}.querySelector('.menu__item.is-active')?.querySelector('.menu__label')?.textContent ?? null) : null`);

	await openLive();
	await ev(`${MENU}.focus()`);
	await sleep(100);
	await key('ArrowDown', 'ArrowDown');
	await sleep(120);
	expect('⭐ ↓ 高亮第一项', await active(), '领取');
	await key('ArrowDown', 'ArrowDown');
	await sleep(120);
	expect('↓ 再按一次 ⇒ 第二项', await active(), '成功');
	await key('ArrowUp', 'ArrowUp');
	await key('ArrowUp', 'ArrowUp');
	await sleep(150);
	expect('⭐ ↑ 从第一项循环到末尾', await active(), '否绝');
	await key('Home', 'Home');
	await sleep(120);
	expect('Home ⇒ 第一项', await active(), '领取');
	await key('End', 'End');
	await sleep(120);
	expect('End ⇒ 最后一项', await active(), '否绝');
	await shot('03-keyboard.png');
	await key('Escape', 'Escape');
	await sleep(300);
	expect('⭐ Escape ⇒ 菜单关了', await openCount(), false);
}

/* ══════════════════════════════════════════════════════════ */
console.log('\n═══ ⑥ 定位：左边缘对齐 / 翻上方 / 不出右界 ═══');
{
	const box = async (sel) =>
		ev(`(() => { const el = ${sel}; if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right),
               bottom: Math.round(r.bottom), height: Math.round(r.height), position: getComputedStyle(el).position }; })()`);

	/* ⑥-a 常规位置 */
	await openLive();
	const m = await box(MENU);
	const pill = await box(LIVE_PILL);
	expect('⭐ 菜单 position = fixed', m?.position, 'fixed');
	expect('⭐ 水平：左边缘对齐触发按钮左边缘', m?.left, pill?.left);
	expect('⭐ 垂直：向下（菜单顶 ≥ 按钮底）', (m?.top ?? 0) >= (pill?.bottom ?? 0), true);
	await shot('04-place-down.png');

	/* ⑥-b 贴底 ⇒ 翻到上方 */
	await closeMenu();
	await ev(`document.querySelector('[data-edge="bottom"]').scrollIntoView({ block: 'end', inline: 'nearest' })`);
	await sleep(350);
	await click(`document.querySelector('[data-edge="bottom"] .status-pill')`);
	await sleep(400);
	const m2 = await box(MENU);
	const pill2 = await box(`document.querySelector('[data-edge="bottom"] .status-pill')`);
	expect('⭐ 贴底时菜单在按钮**上方**（菜单底 ≤ 按钮顶）', (m2?.bottom ?? 99999) <= (pill2?.top ?? 0), true);
	expect('贴底时菜单没出视口上边（top ≥ 8）', (m2?.top ?? -1) >= 8, true);
	await shot('05-flip-up.png');

	/* ⑥-c 贴右 ⇒ 不出右窗口 */
	await closeMenu();
	await ev(`document.querySelector('[data-edge="right"]').scrollIntoView({ block: 'center' })`);
	await sleep(350);
	await click(`document.querySelector('[data-edge="right"] .status-pill')`);
	await sleep(400);
	const m3 = await box(MENU);
	const vw = await ev('innerWidth');
	expect('⭐ 贴右时菜单右边缘不出窗口', (m3?.right ?? 99999) <= vw, true);
	expect('⭐ 贴右时菜单仍在按钮那一侧（left > 窗口一半）', (m3?.left ?? 0) > vw / 2, true);
	await shot('06-right-edge.png');
	await closeMenu();
}

/* ══════════════════════════════════════════════════════════ */
console.log('\n═══ ⑦ 静态矩阵：菜单项 = buttonsOf() 一一对应 ═══');
{
	const rows = await ev(`[...document.querySelectorAll('[data-scenario]')].map(s => ({
      key: s.dataset.scenario,
      items: [...s.querySelectorAll('[data-menu-item]')].map(b => b.querySelector('.menu__label').textContent),
      groups: [...s.querySelectorAll('[data-menu-group]')].map(g => g.dataset.menuGroup),
      empty: s.querySelector('.menu__empty') !== null,
    }))`);
	const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
	expect('七行静态场景都渲染了', rows.length, 7);
	expect('⭐ work/submitted ⇒ 五项两段', byKey['work-submitted']?.groups, ['active', 'ended']);
	expect('⭐ work/submitted 的标签', byKey['work-submitted']?.items, [
		'领取',
		'成功',
		'失败',
		'取消',
		'否绝',
	]);
	expect('⭐ work/working 的「搁置」在 active 段', byKey['work-working']?.groups, ['active', 'ended']);
	expect('⭐ work/working 五项顺序', byKey['work-working']?.items, [
		'搁置',
		'成功',
		'失败',
		'取消',
		'否绝',
	]);
	expect('⭐ goal/draft ⇒ 采纳（active）+ 取消（ended）', byKey['goal-draft']?.groups, [
		'active',
		'ended',
	]);
	expect(
		'⭐ goal/canceled ⇒ 只有「重开」一项',
		[byKey['goal-canceled']?.groups, byKey['goal-canceled']?.items],
		[['active'], ['重开']],
	);
	expect('⭐ design/auth ⇒ 全在 ended 段（v3 口径）', byKey['design-auth']?.groups, ['ended']);
	expect('⭐ design/auth 三项：确认 / 取消 / 否决', byKey['design-auth']?.items, [
		'确认',
		'取消',
		'否决',
	]);
	expect('record/auth 两项：确认 / 否认', byKey['record-auth']?.items, ['确认', '否认']);
	expect('⭐ work/canceled 没有按钮 ⇒ 空菜单', byKey['work-canceled']?.empty, true);
	await shot('07-matrix.png');
}

/* ══════════════════════════════════════════════════════════ */
console.log('\n═══ ⑧ 空按钮表 ═══');
{
	await closeMenu();
	await ev(`document.querySelector('[data-empty]').scrollIntoView({ block: 'center' })`);
	await sleep(350);
	await click(`document.querySelector('[data-empty] .status-pill')`);
	await sleep(350);
	const m = await menuInfo();
	expect('⭐ 空按钮表 ⇒ 菜单显示「没有可用的操作」', m?.empty, '这张卡现在没有可用的操作。');
	expect('空菜单里没有任何菜单项', m?.items.length, 0);
	expect('标题仍在（不是一块空白）', m?.title, '变更状态');
	await shot('08-empty.png');
	await closeMenu();
}

/* ══════════════════════════════════════════════════════════ */
console.log('\n═══ ⑨ 键盘 Enter 选中 ═══');
{
	/* 当前状态仍是提交态（②③ 绕回来了）。 */
	const n = await mark();
	await openLive();
	await ev(`${MENU}.focus()`);
	await key('End', 'End');
	await sleep(150);
	await key('Enter', 'Enter');
	await sleep(400);
	expect('⭐ Enter ⇒ 选中末尾那项「否绝」', await liveStatus(), 'TASK_STATE_REJECTED');
	expect('菜单关了', await openCount(), false);
	expect('派发了 close + pick:否绝', await since(n), [
		'pill-toggle:open',
		'close',
		'pick:否绝:TASK_STATE_REJECTED',
	]);
}

/* ══════════════════════════════════════════════════════════ */
console.log('\n═══ ⑩ DOM 契约（别的组件要依赖的钩子）═══');
{
	const hooks = await ev(`(() => {
      const p = ${LIVE_PILL};
      return {
        pill: p.classList.contains('status-pill'),
        hasDot: p.querySelector('.dot') !== null,
        hasCaret: p.querySelector('.status-pill__caret') !== null,
        hasLabel: p.querySelector('.status-pill__label') !== null,
        status: p.dataset.status,
        haspopup: p.getAttribute('aria-haspopup'),
      };
    })()`);
	expect('根 class = status-pill', hooks?.pill, true);
	expect(
		'三段：dot / label / caret',
		[hooks?.hasDot, hooks?.hasLabel, hooks?.hasCaret],
		[true, true, true],
	);
	expect('data-status 带协议全名', /^TASK_STATE_/.test(hooks?.status ?? ''), true);
	expect('aria-haspopup = menu', hooks?.haspopup, 'menu');
}

console.log('\n═══ JS 错误 ═══');
console.log(errors.length ? errors.join('\n') : '  没有');
console.log('\n═══ 断言结果 ═══');
console.log(failures.length ? failures.join('\n') : '  全部通过');
console.log(`  断言数 ${total}（失败 ${failures.length}）`);

proc.kill();
process.exit(failures.length > 0 || errors.length > 0 ? 1 : 0);
