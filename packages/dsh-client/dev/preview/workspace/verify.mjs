/**
 * 工作区预览的 CDP 验证 + 截图 —— **两个真实尺寸各验一次**。
 *
 * `node packages/dsh-client/dev/preview/workspace/verify.mjs`
 *
 * ## 为什么按尺寸验
 *
 * 用户给的两个容器尺寸是**两种不同的结构**，不是同一张图缩放：
 *
 * | 舞台 | 尺寸 | 该发生什么 |
 * |---|---|---|
 * | 全屏 | 1600 × 1000 | 两栏**横排**（`.tb3w-main` 的 `flex-direction: row`），列表 flex 2 / 详情 flex 1.2 |
 * | 工作区 tab | 570 × 920 | **上下堆叠**（`column`），列表 52% / 分隔条 20px / 详情吃剩余 |
 *
 * ⇒ 判据是**宽**（结构），不是面积：570×920 窄而高 ⇒ 堆叠。
 *   同一条理由在 `CREATE_CSS` 的 `@container tb3cc` 注释里（那边已经踩过）。
 *
 * ## 每个尺寸验什么
 *
 * 1. 舞台拿到真实尺寸；`.tb3w-root` 撑满「舞台 − mock tab 头」
 * 2. `.tb3w-main` 的 `flex-direction` 对
 * 3. 页面本体（`.tb3w-root` / `.tb3w-page`）**自己不产生滚动条**
 * 4. **SpaceBar 没有横向溢出**（`scrollWidth <= clientWidth`）
 * 5. 列表 / 详情都在容器内；窄版还量「列表在详情上方 + 52% 占比」
 * 6. 交互：点卡 ⇒ 详情出现；点 × ⇒ 详情消失且列表占满；
 *    点详情里的状态 ⇒ 状态菜单弹出（能选项、点外面能关）；筛选框互斥
 * 7. 窄版：SpaceBar 折行 ≥ 2、工具栏图例掉第二行、搜索框单独一行、AI chip 收起
 * 8. 窄版分隔条**真的能拖**（拖完列表变高）
 *
 * ## 截图
 *
 * `X:\temp\ws-1-full.png`（1600×1000）/ `X:\temp\ws-2-narrow.png`（570×920）。
 * 用「视口 = 舞台尺寸 + 舞台贴原点 + 截整个视口」——不用 `clip`：
 * 元素比视口大时 `clip` + `captureBeyondViewport` 只渲染到视口宽度
 * （cardcreate 预览实测：右边一截是灰的）。
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as nodePath from 'node:path';

const EDGE = [
	'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
	'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((one) => existsSync(one));
if (EDGE === undefined) {
	console.error('找不到 Edge —— 无法跑 CDP 验证');
	process.exit(1);
}

const HERE = import.meta.dirname;
const SHOTS = 'X:\\temp';
const PAGE = nodePath.join(HERE, 'index.html');
if (!existsSync(PAGE)) {
	console.error(`找不到 ${PAGE} —— 先跑 node dev/preview/build.mjs workspace`);
	process.exit(1);
}
if (!existsSync(SHOTS)) mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ══════════════════════════════════════════════════════════
   起 Edge + 连 CDP
   ══════════════════════════════════════════════════════════ */

const port = 9372;
const userDataDir = mkdtempSync(nodePath.join(tmpdir(), 'wsv-'));
const proc = spawn(
	EDGE,
	[
		'--headless=new',
		`--remote-debugging-port=${port}`,
		`--user-data-dir=${userDataDir}`,
		'--no-first-run',
		'--no-default-browser-check',
		'--disable-gpu',
		'about:blank',
	],
	{ stdio: 'ignore' },
);

const wait = async (url, ms = 20000) => {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		try {
			const response = await fetch(url);
			if (response.ok) return;
		} catch {
			/* Edge 还没起来 */
		}
		await sleep(200);
	}
	throw new Error(`timeout: ${url}`);
};
await wait(`http://127.0.0.1:${port}/json/version`);

const url = new URL(`file:///${PAGE.replace(/\\/g, '/')}`).href;
const target = await (
	await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })
).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
	ws.onopen = resolve;
	ws.onerror = reject;
});

let messageId = 0;
const pending = new Map();
const errors = [];
const failures = [];
ws.onmessage = (event) => {
	const message = JSON.parse(event.data);
	if (message.id !== undefined && pending.has(message.id)) {
		const entry = pending.get(message.id);
		pending.delete(message.id);
		if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
		else entry.resolve(message.result);
		return;
	}
	if (message.method === 'Runtime.exceptionThrown') {
		const detail = message.params.exceptionDetails;
		errors.push((detail.exception?.description ?? detail.text).split('\n')[0]);
	}
	if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
		errors.push(
			`console.error: ${message.params.args
				.map((arg) => arg.value ?? arg.description ?? '')
				.join(' ')}`,
		);
	}
};
const send = (method, params = {}) =>
	new Promise((resolve, reject) => {
		const id = ++messageId;
		pending.set(id, { resolve, reject });
		ws.send(JSON.stringify({ id, method, params }));
	});

await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', {
	width: 1400,
	height: 900,
	deviceScaleFactor: 2,
	mobile: false,
});
await sleep(2400);

/** 运行一段表达式，返回值。 */
const ev = async (expression) => {
	const result = await send('Runtime.evaluate', {
		expression,
		awaitPromise: true,
		returnByValue: true,
	});
	if (result.exceptionDetails) {
		console.log('  ERR', (result.exceptionDetails.exception?.description ?? '').slice(0, 300));
	}
	return result.result?.value;
};

/**
 * DOM 点击（走真实 click 事件，React 的 onClick 照常触发）。
 *
 * 为什么不用鼠标坐标点：舞台比视口大（1600 > 1400）时大量元素在视口外，
 * 按 rect 算坐标点下去会打空。DOM click 仍然**走同一条 React 回调**。
 * （分隔条拖动必须用真鼠标事件 —— 那条单独处理。）
 */
const clickDom = async (selector) => {
	const ok = await ev(`(() => {
		const el = document.querySelector(${JSON.stringify(selector)});
		if (!(el instanceof HTMLElement)) return false;
		el.click();
		return true;
	})()`);
	if (!ok) console.log(`  ⚠ clickDom 找不到 ${selector}`);
	await sleep(140);
	return ok;
};

/** 真鼠标拖动（给分隔条用）。 */
const drag = async (selector, dx, dy) => {
	const box = await ev(`(() => {
		const el = document.querySelector(${JSON.stringify(selector)});
		if (!(el instanceof HTMLElement)) return null;
		el.scrollIntoView({ block: 'center', inline: 'center' });
		const r = el.getBoundingClientRect();
		return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
	})()`);
	if (box === null) return false;
	const steps = 6;
	await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
	await send('Input.dispatchMouseEvent', {
		type: 'mousePressed',
		x: box.x,
		y: box.y,
		button: 'left',
		buttons: 1,
		clickCount: 1,
	});
	for (let step = 1; step <= steps; step += 1) {
		await send('Input.dispatchMouseEvent', {
			type: 'mouseMoved',
			x: box.x + Math.round((dx * step) / steps),
			y: box.y + Math.round((dy * step) / steps),
			button: 'left',
			buttons: 1,
		});
		await sleep(30);
	}
	await send('Input.dispatchMouseEvent', {
		type: 'mouseReleased',
		x: box.x + dx,
		y: box.y + dy,
		button: 'left',
		buttons: 0,
		clickCount: 1,
	});
	await sleep(200);
	return true;
};

let total = 0;
const expect = (label, actual, want) => {
	total += 1;
	const ok = JSON.stringify(actual) === JSON.stringify(want);
	if (!ok) {
		failures.push(`${label}\n      期望 ${JSON.stringify(want)}\n      实际 ${JSON.stringify(actual)}`);
	}
	console.log(`  ${ok ? '✓' : '✗'} ${label}`);
};

/** 切到某个舞台（`[data-stage-btn=…]`）。 */
const switchStage = async (id) => {
	await clickDom(`[data-stage-btn="${id}"]`);
	await sleep(400);
};

/**
 * 截**舞台那一块**：加 `is-solo`（藏切换条、舞台贴原点）+ 把视口设成舞台尺寸
 * + 截整个视口。这样 PNG 的像素尺寸本身就是「真实尺寸」的证据。
 *
 * @param name 文件名
 * @param width 舞台宽
 * @param height 舞台高
 */
const shotStage = async (name, width, height) => {
	await ev(`document.body.classList.add('is-solo')`);
	await sleep(150);
	await send('Emulation.setDeviceMetricsOverride', {
		width,
		height,
		deviceScaleFactor: 1,
		mobile: false,
	});
	await ev(`window.scrollTo(0, 0)`);
	await sleep(500);
	const { data } = await send('Page.captureScreenshot', { format: 'png' });
	writeFileSync(nodePath.join(SHOTS, name), Buffer.from(data, 'base64'));
	console.log(`  📷 ${name}  ${String(width)}×${String(height)}`);
	await send('Emulation.setDeviceMetricsOverride', {
		width: 1400,
		height: 900,
		deviceScaleFactor: 2,
		mobile: false,
	});
	await ev(`document.body.classList.remove('is-solo')`);
	await sleep(350);
};

/* ══════════════════════════════════════════════════════════
   量一档舞台的全部关键几何
   ══════════════════════════════════════════════════════════ */

const measure = () =>
	ev(`(() => {
		const stage = document.querySelector('.pv-stage');
		const root = document.querySelector('.tb3w-root');
		const page = document.querySelector('.tb3w-page');
		const main = document.querySelector('.tb3w-main');
		const list = document.querySelector('.tb3w-list');
		const detail = document.querySelector('.tb3w-detail');
		const split = document.querySelector('.tb3w-split');
		const spaceBar = document.querySelector('.space-bar');
		const filterRow = document.querySelector('.filter-row');
		const tabbar = document.querySelector('.pv-tabbar');
		if (!stage || !root || !page || !main) return null;
		const rect = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) }; };
		const inside = (inner, outer) =>
			inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1 &&
			inner.left >= outer.left - 1 && inner.right <= outer.right + 1;
		const rows = (box) => {
			const tops = new Set();
			for (const child of box.children) {
				const r = child.getBoundingClientRect();
				if (r.width > 0 && r.height > 0) tops.add(Math.round(r.top));
			}
			return tops.size;
		};
		const sr = rect(stage);
		const pr = rect(page);
		const mr = rect(main);
		const lr = list ? rect(list) : null;
		const dr = detail ? rect(detail) : null;
		return {
			stage: sr,
			tabbarH: tabbar ? Math.round(tabbar.getBoundingClientRect().height) : 0,
			root: rect(root),
			page: pr,
			main: mr,
			list: lr,
			detail: dr,
			split: split ? rect(split) : null,
			mainFlexDirection: getComputedStyle(main).flexDirection,
			view: root.getAttribute('data-view'),
			detailState: root.getAttribute('data-detail'),
			/* 页面本体自己不滚 */
			rootScrollY: root.scrollHeight > root.clientHeight + 1,
			rootScrollX: root.scrollWidth > root.clientWidth + 1,
			pageScrollY: page.scrollHeight > page.clientHeight + 1,
			pageScrollX: page.scrollWidth > page.clientWidth + 1,
			/* SpaceBar 没有横向溢出 */
			spaceBarOverflowX: spaceBar ? spaceBar.scrollWidth > spaceBar.clientWidth + 1 : null,
			spaceBarRows: spaceBar ? rows(spaceBar) : 0,
			filterRowOverflowX: filterRow ? filterRow.scrollWidth > filterRow.clientWidth + 1 : null,
			insideMainList: lr === null ? null : inside(lr, mr),
			insideMainDetail: dr === null ? null : inside(dr, mr),
			/* 筛选框：开到哪个、几段竖线 */
			openBoxes: [...document.querySelectorAll('.filter-box.is-open')].map((el) => el.getAttribute('data-box-id')).join(','),
			openBoxVlines: document.querySelectorAll('.filter-box.is-open .filter-box__vline').length,
			/* 工具栏折行 */
			legendTop: (() => { const el = document.querySelector('[data-legend]'); return el ? Math.round(el.getBoundingClientRect().top) : null; })(),
			toolbarTop: (() => { const el = document.querySelector('.tb3w-toolbar__title'); return el ? Math.round(el.getBoundingClientRect().top) : null; })(),
			/* 搜索框是否单独一行 */
			searchTop: (() => { const el = document.querySelector('.tb3w-search'); return el ? Math.round(el.getBoundingClientRect().top) : null; })(),
			searchW: (() => { const el = document.querySelector('.tb3w-search'); return el ? Math.round(el.getBoundingClientRect().width) : null; })(),
			filtersBottom: (() => { const rows = [...document.querySelectorAll('.filter-box')]; let max = 0; for (const el of rows) { const r = el.getBoundingClientRect(); if (r.bottom > max) max = r.bottom; } return Math.round(max); })(),
			aiChipVisible: (() => { const el = document.querySelector('.tb3w-ai-chip'); if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })(),
		};
	})()`);

/* ══════════════════════════════════════════════════════════
   ① 全屏 1600 × 1000
   ══════════════════════════════════════════════════════════ */
console.log('\n═══ 全屏 1600 × 1000 —— 两栏横排 ═══');
await switchStage('full');
const full = await measure();
console.log(
	`     root ${String(full?.root.w)}×${String(full?.root.h)}  main ${String(full?.main.w)}×${String(full?.main.h)}  list ${String(full?.list?.w)}  detail ${String(full?.detail?.w)}  tabbar ${String(full?.tabbarH)}`,
);

expect('舞台拿到真实尺寸', full === null ? null : [full.stage.w, full.stage.h], [1600, 1000]);
expect(
	'⭐ .tb3w-root 撑满「舞台 − mock tab 头」',
	full === null ? null : [full.root.w, full.root.h],
	[1600, 1000 - (full?.tabbarH ?? 0)],
);
expect('⭐ .tb3w-main 的 flex-direction = row', full?.mainFlexDirection, 'row');
expect('详情默认打开（设计图选中 C-03）', full?.detailState, 'open');
expect(
	'详情卡是 C-03',
	await ev(`document.querySelector('[data-detail-pane] [data-card-id]')?.getAttribute('data-card-id')`),
	'C-03',
);
expect('⭐ 列表比详情宽（flex 2 : 1.2）', (full?.list?.w ?? 0) > (full?.detail?.w ?? 0), true);
expect(
	'详情宽度在 min 300 / max 460 之间',
	(full?.detail?.w ?? 0) >= 300 && (full?.detail?.w ?? 0) <= 460,
	true,
);
expect('列表 / 详情都在 .tb3w-main 内', [full?.insideMainList, full?.insideMainDetail], [true, true]);
expect('⚠ 页面本体自己不产生纵向滚动条', [full?.rootScrollY, full?.pageScrollY], [false, false]);
expect('⚠ 页面本体自己不产生横向滚动条', [full?.rootScrollX, full?.pageScrollX], [false, false]);
expect('⚠ SpaceBar 没有横向溢出', full?.spaceBarOverflowX, false);
expect('筛选行没有横向溢出', full?.filterRowOverflowX, false);
expect('SpaceBar 全屏折 2 行（设计图：当前空间/显示已归档/核心/代码/写作/调研 + 设计稿/归档区/+）', full?.spaceBarRows, 2);
expect('领域筛选框默认展开（预览 seed = 设计图那个状态）', full?.openBoxes, 'domain');
expect('展开态是 3 段（核心 ｜ 类别 ｜ 模板）⇒ 2 条竖线', full?.openBoxVlines, 2);

/* ── 交互 ── */
console.log('\n─── 全屏交互 ───');
await clickDom('[data-detail-close]');
const afterClose = await measure();
expect('点 × ⇒ 详情关闭', afterClose?.detailState, 'closed');
expect('详情关闭后列表占满（列表宽 = main 宽）', afterClose?.list?.w, afterClose?.main.w);

await clickDom('[data-card-id="C-03"]');
const afterSelect = await measure();
expect('⭐ 点一张卡 ⇒ 详情面板出现', afterSelect?.detailState, 'open');
expect(
	'详情换成刚点的那张卡',
	await ev(`document.querySelector('[data-detail-pane] [data-card-id]')?.getAttribute('data-card-id')`),
	'C-03',
);

await clickDom('[data-detail-pane] [data-meta="status"]');
const menuOpen = await ev(`(() => {
	const menu = document.querySelector('[data-menu="status"]');
	if (!(menu instanceof HTMLElement)) return null;
	const r = menu.getBoundingClientRect();
	return {
		items: menu.querySelectorAll('[data-menu-item]').length,
		label: menu.getAttribute('aria-label'),
		insideViewport: r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1,
		position: getComputedStyle(menu).position,
	};
})()`);
expect('⭐ 点详细情里的状态 ⇒ StatusMenu 弹出', menuOpen === null ? null : menuOpen.items > 0, true);
expect('菜单是 fixed 浮层且没出视口', menuOpen === null ? null : [menuOpen.position, menuOpen.insideViewport], ['fixed', true]);
expect(
	'菜单项来自 buttonsOf(kind=design, from=需要授权)',
	await ev(`document.querySelectorAll('[data-menu="status"] [data-menu-to]').length > 0`),
	true,
);
await clickDom('[data-menu="status"] [data-menu-item]');
await sleep(260);
const toast = await ev(`document.querySelector('[data-pv-toast]')?.textContent ?? null`);
expect('选了菜单项 ⇒ 菜单关闭 + 预览回执出现', toast === null ? null : toast.includes('状态转移'), true);
await clickDom('[data-pv-toast] button');
expect(
	'点「知道了」后回执消失',
	await ev(`document.querySelector('[data-pv-toast]') === null`),
	true,
);

/* 菜单点外面关 */
await clickDom('[data-detail-pane] [data-meta="status"]');
await sleep(220);
expect('菜单开着', await ev(`document.querySelector('[data-menu="status"]') !== null`), true);
await clickDom('.tb3w-toolbar__title');
expect(
	'⭐ 点外面 ⇒ 菜单关',
	await ev(`document.querySelector('[data-menu="status"]') === null`),
	true,
);

/* 筛选框互斥 */
await clickDom('[data-box-id="kind"]');
expect('点「类别」框 ⇒ 它展开、领域收起（同时只开一个）', (await measure())?.openBoxes, 'kind');
await clickDom('.tb3w-list__title');
expect('点行内空白 ⇒ 收起', (await measure())?.openBoxes, '');
await clickDom('[data-box-id="domain"]');
expect('再点「领域」框 ⇒ 它展开（回到设计图状态）', (await measure())?.openBoxes, 'domain');

/* 回到设计图状态：C-03 选中 + 领域框展开 */
await clickDom('.tb3w-list__title');
await clickDom('[data-box-id="domain"]');
await clickDom('[data-card-id="C-03"]');
await sleep(420);
await shotStage('ws-1-full.png', 1600, 1000);

/* ══════════════════════════════════════════════════════════
   ② 工作区 570 × 920
   ══════════════════════════════════════════════════════════ */
console.log('\n═══ 工作区 570 × 920 —— 上下堆叠 ═══');
await switchStage('narrow');
const narrow = await measure();
console.log(
	`     root ${String(narrow?.root.w)}×${String(narrow?.root.h)}  main ${String(narrow?.main.w)}×${String(narrow?.main.h)}  list ${String(narrow?.list?.w)}×${String(narrow?.list?.h)}  split ${String(narrow?.split?.h)}  detail ${String(narrow?.detail?.w)}×${String(narrow?.detail?.h)}`,
);
console.log(
	`     SpaceBar ${String(narrow?.spaceBarRows)} 行；图例 top ${String(narrow?.legendTop)}（标题行 top ${String(narrow?.toolbarTop)}）；搜索 top ${String(narrow?.searchTop)} / 筛选框底 ${String(narrow?.filtersBottom)}`,
);

expect('舞台拿到真实尺寸', narrow === null ? null : [narrow.stage.w, narrow.stage.h], [570, 920]);
expect(
	'⭐ .tb3w-root 撑满「舞台 − mock tab 头」',
	narrow === null ? null : [narrow.root.w, narrow.root.h],
	[570, 920 - 30],
);
expect('⭐ .tb3w-main 的 flex-direction = column', narrow?.mainFlexDirection, 'column');
expect('列表 / 详情都占满容器宽', [narrow?.list?.w, narrow?.detail?.w], [narrow?.main?.w, narrow?.main?.w]);
expect(
	'⭐ 列表在详情上方，中间是那根分隔条',
	narrow === null
		? null
		: [(narrow.list?.bottom ?? 0) <= (narrow.split?.top ?? 0) + 1, (narrow.split?.bottom ?? 0) <= (narrow.detail?.top ?? 0) + 1],
	[true, true],
);
{
	const ratio = (narrow?.list?.h ?? 0) / (narrow?.main?.h ?? 1);
	console.log(`     列表占 main 的 ${(ratio * 100).toFixed(1)}%（目标 52%）`);
	expect('⭐ 列表占 main 的 52%（±2%）', Math.abs(ratio - 0.52) <= 0.02, true);
}
expect('详情还有实质高度（> 240px）', (narrow?.detail?.h ?? 0) > 240, true);
expect('列表 / 详情都在容器内', [narrow?.insideMainList, narrow?.insideMainDetail], [true, true]);
expect('⚠ 页面本体自己不产生纵向滚动条', [narrow?.rootScrollY, narrow?.pageScrollY], [false, false]);
expect('⚠ 页面本体自己不产生横向滚动条', [narrow?.rootScrollX, narrow?.pageScrollX], [false, false]);
expect('⚠ SpaceBar 没有横向溢出（no 横向滚动条）', narrow?.spaceBarOverflowX, false);
expect(
	'SpaceBar 折 ≥ 2 行（设计图 3 行；这个数随字号浮动，不钉死）',
	(narrow?.spaceBarRows ?? 0) >= 2,
	true,
);
expect('筛选行没有横向溢出', narrow?.filterRowOverflowX, false);
expect('工具栏折行：图例掉到标题行下面', (narrow?.legendTop ?? 0) > (narrow?.toolbarTop ?? 0), true);
expect(
	'搜索框单独一行（顶在筛选框下面）且接近满宽',
	narrow === null
		? null
		: [(narrow.searchTop ?? 0) >= (narrow.filtersBottom ?? 0), (narrow.searchW ?? 0) >= 400],
	[true, true],
);
expect('窄版把 AI chip 收起（设计图窄版没有它们）', narrow?.aiChipVisible, false);
expect('领域筛选框还是展开的（切尺寸不丢 UI 状态）', narrow?.openBoxes, 'domain');
expect('详情默认打开', narrow?.detailState, 'open');

/* 窄版：状态菜单能开（fixed 定位不被窄容器裁掉） */
await clickDom('[data-detail-pane] [data-meta="status"]');
const narrowMenu = await ev(`(() => {
	const menu = document.querySelector('[data-menu="status"]');
	if (!(menu instanceof HTMLElement)) return null;
	const r = menu.getBoundingClientRect();
	return { items: menu.querySelectorAll('[data-menu-item]').length, insideViewport: r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 };
})()`);
expect('⭐ 窄版：状态菜单照样弹出', narrowMenu === null ? null : narrowMenu.items > 0, true);
expect('窄版：菜单没出视口', narrowMenu === null ? null : narrowMenu.insideViewport, true);
await clickDom('.tb3w-toolbar__title');
await sleep(200);

/* 截图 */
await shotStage('ws-2-narrow.png', 570, 920);

/* ══════════════════════════════════════════════════════════
   ③ 窄版分隔条真的能拖
   ══════════════════════════════════════════════════════════ */
console.log('\n═══ 窄版分隔条：拖一下列表应该变高 ═══');
{
	const before = (await measure())?.list?.h ?? 0;
	const dragged = await drag('[data-split]', 0, 70);
	const after = (await measure())?.list?.h ?? 0;
	console.log(`     拖动前 ${String(before)}px / 拖动后 ${String(after)}px`);
	expect('分隔条能拖（列表变高 > 30px）', dragged && after - before > 30, true);
}

console.log('\n═══ JS 错误 ═══');
console.log(errors.length ? errors.join('\n') : '  没有');
console.log('\n═══ 断言结果 ═══');
console.log(failures.length ? failures.join('\n') : '  全部通过');
console.log(`  断言数 ${String(total)}（失败 ${String(failures.length)}）`);
console.log(`  截图目录 ${SHOTS}`);

proc.kill();
process.exit(failures.length > 0 || errors.length > 0 ? 1 : 0);
