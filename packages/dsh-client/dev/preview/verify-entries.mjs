// 可复用验收探针：验证**三处入口**都在
// 用法：node dev/preview/verify-entries.mjs "http://127.0.0.1:PORT/?token=..."
//
// 判据：
//   ① 左侧栏有任务板图标（sidebar.panellist）⇒ 点了主区域出现面板
//   ② 输入框附近有抽屉入口（conversation.input.overlay）⇒ 点了抽屉滑出
//   ③ 右侧工作区有任务板标签页（sidebar.right.pane.tab）⇒ 点了面板出现
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as nodePath from 'node:path';

const EDGE = [
	'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
	'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(existsSync);
const PORT = 9541;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ud = mkdtempSync(nodePath.join(tmpdir(), 'entries-'));
const proc = spawn(
	EDGE,
	[
		'--headless=new',
		`--remote-debugging-port=${PORT}`,
		`--user-data-dir=${ud}`,
		'--no-first-run',
		'--no-default-browser-check',
		'--disable-gpu',
		'--window-size=1920,1080',
		'about:blank',
	],
	{ stdio: 'ignore' },
);

const waitFor = async (fn, ms = 25000) => {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		try {
			const v = await fn();
			if (v) return v;
		} catch {}
		await sleep(150);
	}
	throw new Error('timeout');
};
await waitFor(async () => (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok);

let seq = 0;
const pending = new Map();
const logs = [];
const send = (ws, method, params = {}) =>
	new Promise((res, rej) => {
		const id = ++seq;
		pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
		ws.send(JSON.stringify({ id, method, params }));
	});

const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((o, n) => {
	ws.onopen = o;
	ws.onerror = n;
});
ws.onmessage = (e) => {
	const m = JSON.parse(e.data);
	if (m.id !== undefined && pending.has(m.id)) {
		pending.get(m.id)(m);
		pending.delete(m.id);
		return;
	}
	if (m.method === 'Runtime.exceptionThrown') {
		const d = m.params.exceptionDetails;
		logs.push((d.exception?.description ?? d.text ?? '').slice(0, 300));
	}
	if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
		logs.push((m.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
	}
};

await send(ws, 'Runtime.enable');
await send(ws, 'Page.enable');

const ev = async (expr) => {
	const r = await send(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
	if (r.exceptionDetails) return { error: JSON.stringify(r.exceptionDetails).slice(0, 300) };
	return r.result.value;
};
const shot = async (name) => {
	const s = await send(ws, 'Page.captureScreenshot', { format: 'png' });
	if (s.data) writeFileSync(`X:/temp/dsh/${name}.png`, Buffer.from(s.data, 'base64'));
};

const results = [];
const check = (name, ok, detail) => {
	results.push({ name, ok, detail });
	console.log(`${ok ? '✅' : '❌'} ${name}${detail === undefined ? '' : `  —  ${detail}`}`);
};

await send(ws, 'Page.navigate', { url: process.argv[2] });
await sleep(12000);
await ev(`(function(){const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='继续');if(b)b.click()})()`);
await sleep(1500);

/* ═══ ① 左侧栏入口 ═══ */
const leftIcon = await ev(`(function(){
  /* 左侧栏的 panellist 条目：label 是「任务板」的可点元素 */
  const cands=[...document.querySelectorAll('button,[role="button"],[role="tab"],a')].filter(e=>{
    const r=e.getBoundingClientRect();
    const label=(e.getAttribute('aria-label')||e.getAttribute('title')||(e.textContent||'').trim());
    return r.width>0 && r.height>0 && r.x<120 && label.includes('任务板');
  });
  if(!cands.length) return { found:false };
  const el=cands[0]; const r=el.getBoundingClientRect();
  return { found:true, w:Math.round(r.width), h:Math.round(r.height), x:Math.round(r.x), y:Math.round(r.y) };
})()`);
check(
	'① 左侧栏有任务板入口',
	leftIcon?.found === true,
	leftIcon?.found ? `${String(leftIcon.w)}×${String(leftIcon.h)} @ (${String(leftIcon.x)},${String(leftIcon.y)})` : '找不到',
);

/* 点它 */
if (leftIcon?.found === true) {
	const clicked = await ev(`(function(){
    const cands=[...document.querySelectorAll('button,[role="button"],[role="tab"],a')].filter(e=>{
      const r=e.getBoundingClientRect();
      const label=(e.getAttribute('aria-label')||e.getAttribute('title')||(e.textContent||'').trim());
      return r.width>0 && r.height>0 && r.x<120 && label.includes('任务板');
    });
    if(!cands.length) return 'not found';
    cands[0].click(); return 'clicked';
  })()`);
	await sleep(3500);
	const mainPanel = await ev(`(function(){
    const roots=[...document.querySelectorAll('[class*="tb3w-root"]')];
    const st=document.getElementById('taskboard3-styles');
    const r=roots[0]?.getBoundingClientRect();
    return { count:roots.length, styleLen:st?(st.textContent||'').length:0, rect:r?{w:Math.round(r.width),h:Math.round(r.height),x:Math.round(r.x)}:null };
  })()`);
	check(
		'① 点左侧栏后主区域出现面板',
		(mainPanel?.count ?? 0) > 0 && (mainPanel?.styleLen ?? 0) > 1000,
		`roots=${String(mainPanel?.count)} styleLen=${String(mainPanel?.styleLen)} rect=${JSON.stringify(mainPanel?.rect)}`,
	);
	await shot('entries-1-left');
}

/* 刷新回初始（关掉主区域面板） */
await send(ws, 'Page.reload');
await sleep(11000);
await ev(`(function(){const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='继续');if(b)b.click()})()`);
await sleep(1500);

/* ═══ ② 抽屉入口 ═══ */
const drawerBtn = await ev(`(function(){
  /* 抽屉入口在 composer 附近：找 tb3d- 前缀的按钮 */
  const cands=[...document.querySelectorAll('button,[role="button"]')].filter(e=>{
    const r=e.getBoundingClientRect();
    const cls=(e.className||'').toString();
    /* ⚠ 只认抽屉自己的入口：.tb3d-entry。左侧栏的 .wtg9ga_panelRow 也含「任务板」，会误点。 */
    return r.width>0 && r.height>0 && cls.includes('tb3d-entry');
  });
  if(!cands.length) return { found:false };
  return { found:true, items:cands.map(e=>{ const r=e.getBoundingClientRect(); return { cls:(e.className||'').toString().slice(0,40), w:Math.round(r.width), h:Math.round(r.height), x:Math.round(r.x), y:Math.round(r.y) } }) };
})()`);
check('② 输入框附近有抽屉入口', drawerBtn?.found === true, drawerBtn?.found ? `找到 ${String(drawerBtn.items?.length)} 个` : '找不到');

if (drawerBtn?.found === true) {
	const clicked = await ev(`(function(){
    const cands=[...document.querySelectorAll('button,[role="button"]')].filter(e=>{
      const r=e.getBoundingClientRect();
      const cls=(e.className||'').toString();
      return r.width>0 && r.height>0 && cls.includes('tb3d-entry');
    });
    if(!cands.length) return 'not found';
    cands[0].click(); return 'clicked';
  })()`);
	await sleep(3000);
	const drawer = await ev(`(function(){
    const panel=document.getElementById('tb3d-drawer-panel') || [...document.querySelectorAll('[class*="tb3d"][class*="panel"],[id*="tb3d"]')][0];
    const roots=[...document.querySelectorAll('[class*="tb3w-root"]')];
    const r=panel?.getBoundingClientRect();
    return { panelFound:!!panel, roots:roots.length, rect:r?{w:Math.round(r.width),h:Math.round(r.height),x:Math.round(r.x),y:Math.round(r.y)}:null };
  })()`);
	check(
		'② 点抽屉入口后面板滑出',
		drawer?.panelFound === true && (drawer?.roots ?? 0) > 0,
		`panel=${String(drawer?.panelFound)} roots=${String(drawer?.roots)} rect=${JSON.stringify(drawer?.rect)}`,
	);
	await shot('entries-2-drawer');
}

/* ═══ ③ 右侧工作区 ═══ */
await send(ws, 'Page.reload');
await sleep(11000);
await ev(`(function(){const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='继续');if(b)b.click()})()`);
await sleep(1200);
await ev(`(function(){const b=[...document.querySelectorAll('button')].find(x=>(x.getAttribute('aria-label')||'')==='打开右侧边栏');if(b)b.click()})()`);
await sleep(2200);
const tabEntry = await ev(`(function(){
  const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim().startsWith('任务板')&&x.className&&x.className.includes('entry'));
  return { found:!!b };
})()`);
check('③ 右侧工作区有任务板标签页', tabEntry?.found === true);
if (tabEntry?.found === true) {
	await ev(`(function(){ const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim().startsWith('任务板')&&x.className&&x.className.includes('entry')); if(b) b.click() })()`);
	await sleep(4000);
	const panel = await ev(`(function(){
    const roots=[...document.querySelectorAll('[class*="tb3w-root"]')];
    const st=document.getElementById('taskboard3-styles');
    return { roots:roots.length, styleLen:st?(st.textContent||'').length:0 };
  })()`);
	check('③ 点右侧栏后出现面板', (panel?.roots ?? 0) > 0 && (panel?.styleLen ?? 0) > 1000, `roots=${String(panel?.roots)} styleLen=${String(panel?.styleLen)}`);
	await shot('entries-3-right');
}

/* ═══ ④ 抽屉面板几何：不得被视口顶边裁掉、不得压住输入框 ═══
 *
 * 用户 2026-11-23：「这个抽屉视图只占这么点大小不对。」
 * 实测旧实现（`height:min(50vh,480px)`、无 max-height）在**所有**视口下都
 * `panel.top < 0` —— 因为空对话时输入框垂直居中，`min(50vh,480px)` 的上沿
 * 一定越过视口顶边（596 高：top=-15；900 高：top=-15；720 高：top=-15）。
 *
 * ⇒ 这里钉的是**行为**（AGENTS 3.9：断言行为，不要断言数字）：
 *    1. 面板完整在视口内（top >= 0、bottom <= 视口高）
 *    2. 面板底边不压输入框（bottom <= composerTop）
 *    3. 面板宽高都 > 0（渲染出来了）
 *    4. 面板内部主体不溢出（`scrollHeight <= clientHeight`）
 * 三个视口都跑，特别是 **596 高**（用户截图那一档）。
 */
const DRAWER_VIEWPORTS = [
	{ w: 1157, h: 596 },
	{ w: 1280, h: 720 },
	{ w: 1440, h: 900 },
];

for (const vp of DRAWER_VIEWPORTS) {
	await send(ws, 'Emulation.setDeviceMetricsOverride', {
		width: vp.w,
		height: vp.h,
		deviceScaleFactor: 1,
		mobile: false,
	});
	await sleep(700);

	/* 确保抽屉开着（开着就什么都不做；关着就点一次入口） */
	await ev(`(function(){
    if (document.getElementById('tb3d-drawer-panel')) return 'already-open';
    const b=document.querySelector('.tb3d-entry');
    if (b) b.click();
    return b ? 'clicked' : 'no-entry';
  })()`);
	await sleep(900);

	const geo = await ev(`(function(){
    const panel=document.getElementById('tb3d-drawer-panel');
    if (!panel) return { error:'no-panel' };
    const b=panel.getBoundingClientRect();
    const layer=document.querySelector('.tb3d-layer');
    /* composer 卡片 = layer 最近的可定位祖先（position:relative） */
    let card=layer;
    while (card && getComputedStyle(card).position!=='relative') card=card.parentElement;
    const cb=card?card.getBoundingClientRect():null;
    const body=document.querySelector('.tb3d-body');
    return {
      top: Math.round(b.top), bottom: Math.round(b.bottom),
      w: Math.round(b.width), h: Math.round(b.height),
      composerTop: cb?Math.round(cb.top):null,
      vh: innerHeight, vw: innerWidth,
      bodyOverflow: body ? body.scrollHeight > body.clientHeight + 1 : null,
    };
  })()`);

	const ok =
		geo?.error === undefined &&
		(geo?.w ?? 0) > 0 &&
		(geo?.h ?? 0) > 0 &&
		(geo?.top ?? -1) >= 0 &&
		(geo?.bottom ?? 1e9) <= geo.vh &&
		(geo?.composerTop === null || (geo?.bottom ?? 1e9) <= geo.composerTop) &&
		geo?.bodyOverflow === false;

	check(
		`④ ${String(vp.w)}×${String(vp.h)} 抽屉面板完整在视口内、不压输入框、不内部溢出`,
		ok === true,
		`top=${String(geo?.top)} bottom=${String(geo?.bottom)} h=${String(geo?.h)} w=${String(geo?.w)} composerTop=${String(geo?.composerTop)} vh=${String(geo?.vh)} bodyOverflow=${String(geo?.bodyOverflow)}`,
	);
	await shot(`entries-4-drawer-geo-${String(vp.w)}x${String(vp.h)}`);
}

/* 还原视口，别把后面的东西留在小屏状态 */
await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });


/* ═══ ⑤ 切空间：加载态只盖内容区 + 外壳几何不变 ═══
 *
 * 用户 2026-11-23：
 * 「切换工作空间的时候整个视口都跳变。给他加一点过度时间。或者跳变也不要全变了。
 *   显示"正在加载"不应该包含视口上面的菜单部分。应该只有里面的列表或者科技树的视口显示正在加载。」
 *
 * 断言的是**行为**（不是像素值）：
 *   · 加载期间「顶部菜单」（.tb3w-chrome / 工具栏 / 筛选行）必须还在、且可交互
 *   · 「正在加载」节点必须在 .tb3w-main 内部
 *   · 切换前 / 加载中 / 落定后，外壳（.tb3w-chrome）的 rect 必须不变
 *   · 加载层带一个有限的过渡（animation），不是硬切
 */
const stamp = Date.now();
const madeSpaces = await ev(`(async function(){
  const mk=async(n)=>{
    const r=await fetch('taskboard3/api/workspaces',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:n})});
    return r.ok;
  };
  const a=await mk('切空间探针${String(stamp)}A');
  const b=await mk('切空间探针${String(stamp)}B');
  return {a,b};
})()`);

await send(ws, 'Page.reload');
await sleep(12000);
await ev(`(function(){const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='继续');if(b)b.click()})()`);
await sleep(1200);
await ev(`(function(){
  const cands=[...document.querySelectorAll('button,[role="button"],[role="tab"],a')].filter(e=>{
    const r=e.getBoundingClientRect();
    const label=(e.getAttribute('aria-label')||e.getAttribute('title')||(e.textContent||'').trim());
    return r.width>0 && r.height>0 && r.x<120 && label.includes('任务板');
  });
  if(cands.length) cands[0].click();
})()`);
await sleep(4000);

const probeChips = await ev(
	`[...document.querySelectorAll('[data-chip-id]')].map((e)=>({id:e.dataset.chipId,txt:(e.textContent||'').trim()}))`,
);
const chipA = (probeChips ?? []).find((c) => c.txt.includes(`${String(stamp)}A`));
const chipB = (probeChips ?? []).find((c) => c.txt.includes(`${String(stamp)}B`));

if (madeSpaces?.a !== true || chipA === undefined || chipB === undefined) {
	check('⑤ 切空间探针可用', false, `建空间=${JSON.stringify(madeSpaces)} chips=${String((probeChips ?? []).length)}`);
} else {
	/* 先切到 A（空空间）—— 此后 cards=[] ，再切 B 就会进 loading 分支 */
	await ev(`(function(){document.querySelector('[data-chip-id="${String(chipA.id)}"]').click()})()`);
	await sleep(1600);

	/* 把 /api/state 拖慢，让加载态可观察（不靠运气）
	 * ⚠ 必须先 Network.enable，否则 emulateNetworkConditions 被忽略（实测加载态只闪 1 帧）。 */
	await send(ws, 'Network.enable');
	await send(ws, 'Network.emulateNetworkConditions', {
		offline: false,
		latency: 600,
		downloadThroughput: -1,
		uploadThroughput: -1,
	});

	/*
	 * 采样用 **Node 侧轮询**，不用页面里的 setInterval ——
	 * headless 后台标签页会把定时器夹到 1s，抓不到瞬时加载态（实测 0/10 帧）。
	 */
	const readFrame = async () =>
		ev(`(function(){
    const q=(s)=>document.querySelector(s);
    const load=q('.tb3w-main__loading');
    return {
      chrome:!!q('.tb3w-chrome'),
      toolbar:!!q('.tb3w-toolbar'),
      filters:!!q('.tb3w-filters'),
      loading:!!load,
      loadInMain: load ? !!load.closest('.tb3w-main') : false,
      chips:document.querySelectorAll('[data-chip-id]').length
    };
  })()`);

	const geoOf = async () =>
		ev(`(function(){
    const r=(s)=>{const e=document.querySelector(s); if(!e) return null; const b=e.getBoundingClientRect();
      return {x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height)};};
    return {chrome:r('.tb3w-chrome'), toolbar:r('.tb3w-toolbar'), filters:r('.tb3w-filters')};
  })()`);

	const geoBefore = await geoOf();
	await ev(`(function(){document.querySelector('[data-chip-id="${String(chipB.id)}"]').click()})()`);

	const rec = [];
	let geoDuring = null;
	let toolbarStyle = null;
	let loadAnim = null;
	let shotTaken = false;
	const deadline = Date.now() + 2600;
	while (Date.now() < deadline) {
		const frame = await readFrame();
		rec.push(frame);
		if (frame.loading === true) {
			if (geoDuring === null) {
				geoDuring = await geoOf();
				toolbarStyle = await ev(`(function(){
          const e=document.querySelector('.tb3w-toolbar'); if(!e) return null;
          const s=getComputedStyle(e); const b=e.getBoundingClientRect();
          return {opacity:s.opacity, pointerEvents:s.pointerEvents, visibility:s.visibility,
                  inViewport: b.width>0 && b.height>0 && b.top<window.innerHeight && b.bottom>0};
        })()`);
				loadAnim = await ev(`(function(){
          const e=document.querySelector('.tb3w-main__loading'); if(!e) return null;
          const s=getComputedStyle(e); return {name:s.animationName, duration:s.animationDuration};
        })()`);
			}
			if (!shotTaken) {
				shotTaken = true;
				await shot('entries-4-loading');
			}
		}
	}
	if (geoDuring === null) geoDuring = await geoOf();
	await sleep(500);
	await send(ws, 'Network.emulateNetworkConditions', {
		offline: false,
		latency: 0,
		downloadThroughput: -1,
		uploadThroughput: -1,
	});
	await sleep(400);
	const geoAfter = await geoOf();

	const loadingFrames = rec.filter((r) => r.loading === true);
	check(
		'⑤ 抓到加载态（网络拖慢后）',
		loadingFrames.length > 0,
		`${String(loadingFrames.length)}/${String(rec.length)} 帧`,
	);
	check(
		'⑤ 加载期间顶部菜单仍在（chrome/工具栏/筛选行）',
		loadingFrames.length > 0 && loadingFrames.every((r) => r.chrome && r.toolbar && r.filters),
		`${String(loadingFrames.filter((r) => r.chrome && r.toolbar && r.filters).length)}/${String(loadingFrames.length)} 帧齐全`,
	);
	check(
		'⑤ 「正在加载」只在 .tb3w-main 内部',
		loadingFrames.length > 0 && loadingFrames.every((r) => r.loadInMain),
		`${String(loadingFrames.filter((r) => r.loadInMain).length)}/${String(loadingFrames.length)} 帧在内`,
	);
	check(
		'⑤ 加载期间工具栏可交互（opacity=1、pointer-events 未禁用、在视口内）',
		toolbarStyle !== null &&
			toolbarStyle.opacity === '1' &&
			toolbarStyle.pointerEvents !== 'none' &&
			toolbarStyle.visibility !== 'hidden' &&
			toolbarStyle.inViewport === true,
		JSON.stringify(toolbarStyle),
	);
	const sameRect = (a, b) =>
		a !== null &&
		b !== null &&
		a.x === b.x &&
		a.y === b.y &&
		a.w === b.w &&
		a.h === b.h;
	check(
		'⑤ 切空间时外壳 rect 不变（chrome）',
		sameRect(geoBefore?.chrome, geoDuring?.chrome) && sameRect(geoBefore?.chrome, geoAfter?.chrome),
		`前=${JSON.stringify(geoBefore?.chrome)} 中=${JSON.stringify(geoDuring?.chrome)} 后=${JSON.stringify(geoAfter?.chrome)}`,
	);
	check(
		'⑤ 加载层有过渡（animation 有限时长）',
		loadAnim !== null && loadAnim.name !== 'none' && loadAnim.duration !== '0s',
		JSON.stringify(loadAnim),
	);
	await shot('entries-4-after');
}


console.log(`\n${results.every((r) => r.ok) ? '✅ 三处入口全部可用 + 抽屉几何三档全绿 + 切空间加载态全绿' : '❌ 有失败'}`);
if (logs.length > 0) {
	console.log('\n=== 页面异常 ===');
	for (const one of logs.slice(0, 8)) console.log('  ' + one);
}

ws.close();
proc.kill();
process.exit(results.every((r) => r.ok) ? 0 : 1);

