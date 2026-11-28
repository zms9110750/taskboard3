/**
 * 建卡页预览的 CDP 验证 + 截图 —— **三个真实尺寸各验一次**。
 *
 * `node packages/dsh-client/dev/preview/cardcreate/verify.mjs`
 *
 * ## 为什么要按尺寸验，而不是只验一次
 *
 * 用户 `2026-11-19` 给了产品里 CardCreate 会遇到的三个容器：
 *
 * | 场景 | 尺寸 | 该发生什么 |
 * |---|---|---|
 * | 工作区 | 570 × 920 | 左右分栏挤不下 ⇒ **堆叠**（`flex-direction: column`）|
 * | 抽屉 | 1200 × 400 | **宽**得能横排 ⇒ **不堆叠**（`row`）+ 收紧纵向间距 |
 * | 全屏 | 1600 × 1000 | 常规（`row`）|
 *
 * ⚠ **抽屉那条最重要**：它面积只有全屏的 30%，但**宽**。
 *   如果响应式的判据是「面积小 / 尺寸小就堆叠」，1200×400 会被误判成堆叠 ——
 *   400 高里竖着塞左栏 + 右栏必然溢出。这条断言就是为了钉住「按宽判，不按面积判」。
 *
 * ## 每个尺寸验五件事
 *
 * 1. `container-type: size` 生效（页有真实尺寸，没塌成 0）
 * 2. `.tb3cc-page__body` 的 `flex-direction` 是预期的 `row` / `column`
 * 3. 顶栏、底栏的矩形都在**容器内**（没被挤出去）
 * 4. 页面本体**自己不产生滚动条**（`scrollHeight === clientHeight`）——
 *    滚动只发生在左右两栏
 * 5. 左栏 / 右栏在有实质尺寸（不是被挤成 0 宽）
 *
 * ## 截图
 *
 * 三张存 `X:\temp\resp-{1,2,3}-*.png`，每张只截**舞台那一块**（真实尺寸），
 * 不是整页 —— 整页里有一半是预览自己的切换条和留白。
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
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
	console.error(`找不到 ${PAGE} —— 先跑 node dev/preview/build.mjs cardcreate`);
	process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const port = 9371;
const ud = mkdtempSync(nodePath.join(tmpdir(), 'ccr-'));
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
	if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
		errors.push(
			`console.error: ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`,
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
/*
 * 视口给 1280×900 —— 比它大的舞台（1600×1000 / 570×920）会超出视口，
 * 截图用 `captureBeyondViewport: true` + 页面坐标 clip。
 */
await send('Emulation.setDeviceMetricsOverride', {
	width: 1280,
	height: 900,
	deviceScaleFactor: 2,
	mobile: false,
});
await sleep(2200);

const ev = async (x) => {
	const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true });
	if (r.exceptionDetails)
		console.log('  ERR', (r.exceptionDetails.exception?.description || '').slice(0, 300));
	return r.result?.value;
};
const click = async (sel) => {
	const b = await ev(`(() => { const el = ${sel}; if (!el) return null;
    el.scrollIntoView({block:'center'});
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

/**
 * 截**舞台那一块** —— 用「视口 = 舞台尺寸 + 舞台贴原点 + 截整个视口」。
 *
 * ## ⚠ 为什么不用 `clip` + `captureBeyondViewport`
 *
 * 实测：1600 宽的舞台在 1280 宽的视口里，`clip {width:1600}` + `beyondViewport`
 * 只渲染到视口宽度，**右边 320px 是灰的**（`resp-3-full.png` 第一版就是这样）。
 * `clip` 对超出视口的横向区域不可靠。
 *
 * ⇒ 改成：
 * 1. 加 `body.is-solo`（藏切换条、去掉 padding ⇒ 舞台贴 (0,0)）
 * 2. `Emulation.setDeviceMetricsOverride` 把视口设成**舞台的真实尺寸**
 * 3. 截**整个视口**（不带 clip）
 * 4. 截完复原
 *
 * 这样截出来的 PNG 就是 `570×920` / `1200×400` / `1600×1000`，像素尺寸本身
 * 也是「真实尺寸」的证据。
 *
 * @param name 文件名
 * @param width 舞台宽
 * @param height 舞台高
 */
const shotStage = async (name, width, height) => {
	await ev(`document.body.classList.add('is-solo')`);
	await sleep(120);
	await send('Emulation.setDeviceMetricsOverride', {
		width,
		height,
		deviceScaleFactor: 2,
		mobile: false,
	});
	/*
	 * 视口一变，舞台的 (0,0) 可能还被滚动位置影响（`pv-scroll` 之前滚过）。
	 * 显式滚到原点，确保舞台贴左上角。
	 */
	await ev(`window.scrollTo(0, 0)`);
	await sleep(420);
	const { data } = await send('Page.captureScreenshot', { format: 'png' });
	writeFileSync(nodePath.join(SHOTS, name), Buffer.from(data, 'base64'));
	console.log(`  📷 ${name}  ${String(width)}×${String(height)}`);
	/* 复原：先撤 is-solo，再恢复大视口（顺序反了会先看到一个变形的大页面）。 */
	await send('Emulation.setDeviceMetricsOverride', {
		width: 1280,
		height: 900,
		deviceScaleFactor: 2,
		mobile: false,
	});
	await ev(`document.body.classList.remove('is-solo')`);
	await sleep(320);
};

/** 切到某个舞台。 */
const switchStage = async (id) => {
	await click(`document.querySelector('[data-stage-btn="${id}"]')`);
	await sleep(420);
};

/**
 * 量当前舞台的全部关键几何。
 *
 * @param wantW 期望宽度
 * @param wantH 期望高度
 */
const measure = (wantW, wantH) =>
	ev(`(() => {
    const stage = document.querySelector('.pv-stage');
    const page = document.querySelector('.tb3cc-page');
    const body = document.querySelector('.tb3cc-page__body');
    const top = document.querySelector('.tb3cc-page__top');
    const foot = document.querySelector('.tb3cc-page__foot');
    const left = document.querySelector('.tb3cc-page__left');
    const right = document.querySelector('.tb3cc-page__right');
    if (!stage || !page || !body) return null;
    const sr = stage.getBoundingClientRect();
    const pr = page.getBoundingClientRect();
    const tr = top.getBoundingClientRect();
    const fr = foot.getBoundingClientRect();
    const lr = left.getBoundingClientRect();
    const rr = right.getBoundingClientRect();
    const pageStyle = getComputedStyle(page);
    const bodyStyle = getComputedStyle(body);
    /* 在容器内 = 每条边都不超出容器（容差 1px，避免亚像素误判）。 */
    const inside = (r) =>
      r.top >= sr.top - 1 && r.bottom <= sr.bottom + 1 &&
      r.left >= sr.left - 1 && r.right <= sr.right + 1;
    /*
     * 找**横向**溢出容器的元素（跳过弹层 —— 它故意可以出界）。
     *
     * ⚠ 只查横向，不查纵向：右栏是滚动容器，它的子树天然会向下延伸出可视区
     *   （那是「滚动内容」，不是「布局错」）。第一版连纵向一起查 ⇒ 一堆
     *   tb3cc-sec-list 假失败。
     *   纵向的「顶栏底栏没被挤出去」由上面对 top/foot 的 inside() 单独验。
     *
     * ⚠ 本段是模板字符串里的代码，注释里**不能出现反引号**（会提前结束字符串）。
     */
    const outOfBounds = [];
    for (const el of page.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      if (cs.position === 'absolute' || cs.position === 'fixed') continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      if (r.right > sr.right + 1 || r.left < sr.left - 1) {
        outOfBounds.push((el.className && typeof el.className === 'string' ? el.className : el.tagName) +
          ':' + Math.round(r.left) + '-' + Math.round(r.right));
      }
    }
    return {
      stageW: Math.round(sr.width), stageH: Math.round(sr.height),
      pageW: Math.round(pr.width), pageH: Math.round(pr.height),
      pagePosition: pageStyle.position,
      containerType: pageStyle.containerType,
      flexDirection: bodyStyle.flexDirection,
      topInside: inside(tr), footInside: inside(fr),
      topW: Math.round(tr.width), footW: Math.round(fr.width),
      leftW: Math.round(lr.width), leftH: Math.round(lr.height),
      rightW: Math.round(rr.width), rightH: Math.round(rr.height),
      /* 页面本体自己不滚（滚动只发生在左右两栏）。 */
      pageScrollsVertically: page.scrollHeight > page.clientHeight + 1,
      pageScrollsHorizontally: page.scrollWidth > page.clientWidth + 1,
      outOfBounds: outOfBounds.slice(0, 5),
      outOfBoundsCount: outOfBounds.length,
      wantW: ${String(wantW)}, wantH: ${String(wantH)},
    };
  })()`);

/* ══════════════════════════════════════════════════════════
   三种尺寸
   ══════════════════════════════════════════════════════════ */

/** 三个舞台的定义（和 `main.tsx` 的 `STAGES` 一致 —— 尺寸是用户给的）。 */
const CASES = [
	{
		id: 'workspace',
		file: 'resp-1-workspace.png',
		w: 570,
		h: 920,
		flex: 'column',
		why: '570 宽放不下左右分栏 ⇒ 堆叠',
	},
	{
		id: 'drawer',
		file: 'resp-2-drawer.png',
		w: 1200,
		h: 400,
		flex: 'row',
		why: '1200 **宽** ⇒ 横排；只是矮，绝不能堆叠',
	},
	{
		id: 'full',
		file: 'resp-3-full.png',
		w: 1600,
		h: 1000,
		flex: 'row',
		why: '都够 ⇒ 常规横排',
	},
];

for (const one of CASES) {
	console.log(`\n═══ ${one.id}：${String(one.w)} × ${String(one.h)} —— ${one.why} ═══`);
	await switchStage(one.id);
	const m = await measure(one.w, one.h);
	expect('舞台拿到真实尺寸', m === null ? null : [m.stageW, m.stageH], [one.w, one.h]);
	/*
	 * ⚠ 这一条是「container-type:size 要求父容器给高度」的**实证**：
	 *   页高 = 舞台高 ⇒ 撑满了；页高 0 ⇒ 父层没给高度，页塌了。
	 */
	expect('⭐ 页面撑满舞台（没塌成 0）', m === null ? null : [m.pageW, m.pageH], [one.w, one.h]);
	/*
	 * ⚠ 断言的是**「不是 fixed / absolute」**，不是「等于 relative」。
	 *   现在 `.tb3cc-page` 没有写 position ⇒ 计算值是 `static`，那是对的：
	 *   它留在文档流里、被父容器约束。写死 expected 'relative' 是在替 CSS
	 *   规定实现方式，而不是规定**行为**（行为 = 不出父容器）。
	 */
	expect(
		'⭐ 页面留在文档流里（不脱离父容器）',
		m === null ? null : m.pagePosition === 'fixed' || m.pagePosition === 'absolute',
		false,
	);
	expect('页面是容器查询宿主（container-type:size）', m === null ? null : m.containerType, 'size');
	expect('⭐ body 的 flex-direction', m === null ? null : m.flexDirection, one.flex);
	expect('顶栏在容器内', m === null ? null : m.topInside, true);
	expect('底栏在容器内', m === null ? null : m.footInside, true);
	expect('顶栏 / 底栏满宽', m === null ? null : [m.topW, m.footW], [one.w, one.w]);
	expect('⚠ 页面本体自己不产生纵向滚动条', m === null ? null : m.pageScrollsVertically, false);
	expect('⚠ 页面本体自己不产生横向滚动条', m === null ? null : m.pageScrollsHorizontally, false);
	expect('⚠ 没有元素溢出容器（弹层除外）', m === null ? null : m.outOfBounds, []);

	if (one.flex === 'column') {
		/* 堆叠：左栏在上、右栏在下，两者宽度都等于容器宽。 */
		expect('堆叠后左栏占满宽度', m === null ? null : m.leftW, one.w);
		expect('堆叠后右栏占满宽度', m === null ? null : m.rightW, one.w);
		expect(
			'⭐ 左栏有 max-height 上限（70% ≈ ' + String(Math.round(one.h * 0.7)) + 'px）',
			m === null ? null : m.leftH <= Math.round(one.h * 0.7) + 1,
			true,
		);
		expect('堆叠后右栏还有实质高度', m === null ? null : m.rightH > 200, true);
	} else {
		/* 横排：左栏 320、右栏吃掉剩下的。 */
		expect('横排：左栏 320px', m === null ? null : m.leftW, 320);
		expect('横排：右栏吃掉剩余宽度', m === null ? null : m.rightW, one.w - 320);
	}

	await shotStage(one.file, one.w, one.h);
}

/* ══════════════════════════════════════════════════════════
   ⚠⚠ 工作区 570×920：**左栏任何典型状态都不许出滚动条**
   ══════════════════════════════════════════════════════════ */
console.log('\n═══ ⚠⚠ 工作区 570×920：左栏不许滚（用户明确要求）═══');
{
	/*
	 * 用户 `2026-11-19`：
	 * > 「抽屉打滚动无所谓。**但是工作区打滚动就不行。**」
	 *
	 * 左栏是主输入区 —— 滚起来就看不到自己刚填的字段。
	 *
	 * ⚠ 第一版 max-height 给 46% ⇒ 关系一展开（自然高 457px > 376px）就滚，
	 *   正是用户否掉的行为。现在 70%（≈573px）。
	 *   这条断言逐个状态量：只要有一个状态左栏 `scrollHeight > clientHeight` 就红。
	 */
	await switchStage('workspace');

	const leftScrolls = () =>
		ev(`(() => {
      const el = document.querySelector('.tb3cc-page__left');
      return {
        scrolls: el.scrollHeight > el.clientHeight + 1,
        clientH: el.clientHeight,
        scrollH: el.scrollHeight,
      };
    })()`);

	const closed = await leftScrolls();
	expect('关系收起 ⇒ 左栏不滚', closed.scrolls, false);

	await click(`document.querySelector('[data-meta-tab="rel"]')`);
	await sleep(360);
	const relOpen = await leftScrolls();
	expect('⭐ 关系展开（空）⇒ 左栏不滚', relOpen.scrolls, false);

	/* 加 3 行关联 —— 关系面板典型使用时的高度 */
	for (let n = 0; n < 3; n += 1) {
		await click(`document.querySelector('.tb3cc-meta__rel-add')`);
		await sleep(240);
	}
	const rel3 = await leftScrolls();
	expect('⭐ 关系展开 + 3 行关联 ⇒ 左栏不滚', rel3.scrolls, false);

	/* 说明：给出行数上限的依据，方便以后判断「加更多行要不要收紧」 */
	console.log(`     （左栏可视高 ${String(rel3.clientH)}px / 内容高 ${String(rel3.scrollH)}px）`);

	/* 高级设置面板也要不滚 */
	await click(`document.querySelector('[data-meta-tab="adv"]')`);
	await sleep(320);
	const adv = await leftScrolls();
	expect('⭐ 高级设置展开 ⇒ 左栏不滚', adv.scrolls, false);

	/* 收起来，别影响后面的截图 */
	await click(`document.querySelector('[data-meta-tab="adv"]')`);
	await sleep(220);
	await shotStage('resp-1-workspace.png', 570, 920);
}

/* ══════════════════════════════════════════════════════════
   矮容器（抽屉）的间距确实收紧了
   ══════════════════════════════════════════════════════════ */
console.log('\n═══ 抽屉 400 高：纵向间距真的收紧了（不只是「没堆叠」）═══');
{
	await switchStage('drawer');
	const drawer = await ev(`(() => {
    const pad = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).paddingTop : null; };
    /*
     * ⚠ 这两条必须在**还停在抽屉**时一起读 —— 切回全屏之后 mask 又变回 flex 了。
     *   第一版把它们放到切换之后 ⇒ 断言恒红（不是样式坏）。
     */
    const meta = document.querySelector('.tb3cc-tpl-hint__meta');
    const right = document.querySelector('.tb3cc-page__right');
    const secs = [...right.querySelectorAll('.tb3-sec')];
    const rr = right.getBoundingClientRect();
    return {
      top: pad('.tb3cc-page__top'),
      right: pad('.tb3cc-page__right'),
      metaDisplay: meta === null ? 'no-node' : getComputedStyle(meta).display,
      visibleSecs: secs.filter(s => s.getBoundingClientRect().top < rr.bottom).length,
    };
  })()`);

	await switchStage('full');
	const full = await ev(`(() => {
    const pad = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).paddingTop : null; };
    const meta = document.querySelector('.tb3cc-tpl-hint__meta');
    return {
      top: pad('.tb3cc-page__top'),
      right: pad('.tb3cc-page__right'),
      metaDisplay: meta === null ? 'no-node' : getComputedStyle(meta).display,
    };
  })()`);

	expect('抽屉顶栏 padding 比全屏小（6px vs 12px）', drawer.top, '6px');
	expect('全屏顶栏 padding 是常规的 12px', full.top, '12px');
	expect('抽屉右栏 padding 比全屏小（10px vs 16px）', drawer.right, '10px');
	expect('全屏右栏 padding 是常规的 16px', full.right, '16px');

	/* 高 <560 时说明块那一行收掉 —— 矮容器里它是纯占位 */
	expect('抽屉里模板说明的「编号前缀」那行被收掉（省高度）', drawer.metaDisplay, 'none');
	expect('全屏里那一行还在（响应式只对矮容器生效）', full.metaDisplay, 'flex');
	expect('⭐ 抽屉里右栏能看到至少两章（400 高里塞得下）', drawer.visibleSecs >= 2, true);
}

/* ══════════════════════════════════════════════════════════
   功能没被响应式改坏（在三个尺寸里各验一遍核心交互）
   ══════════════════════════════════════════════════════════ */
console.log('\n═══ 三个尺寸里，左栏功能都还在 ═══');
{
	await switchStage('workspace');
	expect(
		'570 宽里：模板触发器在',
		await ev(`document.querySelector('[data-picker-trigger]') !== null`),
		true,
	);
	await click(`document.querySelector('[data-picker-trigger]')`);
	await sleep(400);
	expect(
		'570 宽里：三级联选弹层还能展开（fixed 定位，不被窄容器裁掉）',
		await ev(`document.querySelector('[data-picker-pop]') !== null`),
		true,
	);
	expect(
		'570 宽里：弹层三列都在',
		await ev(`document.querySelectorAll('[data-col]').length`),
		3,
	);
	await shotStage('resp-1b-workspace-picker.png', 570, 920);
	/* 点外面关 */
	await click(`document.querySelector('.pv-bar__tag')`);
	await sleep(300);

	await switchStage('full');
	expect(
		'1600 宽里：弹层能关掉',
		await ev(`document.querySelector('[data-picker-pop]') === null`),
		true,
	);

	/* 关系面板：三个尺寸都能展开且互斥 */
	for (const id of ['workspace', 'drawer', 'full']) {
		await switchStage(id);
		await click(`document.querySelector('[data-meta-tab="rel"]')`);
		await sleep(320);
		const opened = await ev(`document.querySelector('[data-panel="rel"]') !== null`);
		await click(`document.querySelector('[data-meta-tab="adv"]')`);
		await sleep(320);
		const switched = await ev(`(() => document.querySelector('[data-panel="rel"]') === null &&
      document.querySelector('[data-panel="adv"]') !== null)()`);
		expect(`${id}：关系面板能展开 + 切到高级互斥`, [opened, switched], [true, true]);
		/* 收起来，别影响下一个尺寸 */
		await click(`document.querySelector('[data-meta-tab="adv"]')`);
		await sleep(200);
	}
}

console.log('\n═══ JS 错误 ═══');
console.log(errors.length ? errors.join('\n') : '  没有');
console.log('\n═══ 断言结果 ═══');
console.log(failures.length ? failures.join('\n') : '  全部通过');
console.log(`  断言数 ${total}（失败 ${failures.length}）`);
console.log(`  截图目录 ${SHOTS}`);

proc.kill();
process.exit(failures.length > 0 || errors.length > 0 ? 1 : 0);
