/**
 * 验证 CardRow / StatusCell / StatusDot。
 *
 * node dev/preview/verify.mjs
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as nodePath from 'node:path';

const EDGE = [
	'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
	'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((one) => existsSync(one));
const HERE = import.meta.dirname;
const DEV = nodePath.join(HERE, '..');
const OUT = nodePath.join(DEV, 'shots');
mkdirSync(OUT, { recursive: true });
const PAGE = nodePath.join(HERE, 'index.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const port = 9300;
const ud = mkdtempSync(nodePath.join(tmpdir(), 'cr-'));
const proc = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${ud}`,
	'--no-first-run', '--no-default-browser-check', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });

const wait = async (u, ms = 20000) => {
	const end = Date.now() + ms;
	while (Date.now() < end) { try { const r = await fetch(u); if (r.ok) return; } catch {} await sleep(200); }
	throw new Error('timeout');
};
await wait(`http://127.0.0.1:${port}/json/version`);

const url = new URL(`file:///${PAGE.replace(/\\/g, '/')}`).href;
const t = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((o, n) => { ws.onopen = o; ws.onerror = n; });

let i = 0; const p = new Map();
const errors = [];
const failures = [];
ws.onmessage = (e) => {
	const m = JSON.parse(e.data);
	if (m.id && p.has(m.id)) {
		const q = p.get(m.id); p.delete(m.id);
		m.error ? q.reject(new Error(JSON.stringify(m.error))) : q.resolve(m.result);
		return;
	}
	if (m.method === 'Runtime.exceptionThrown') {
		errors.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0]);
	}
};
const send = (method, params = {}) => new Promise((res, rej) => {
	const id = ++i; p.set(id, { resolve: res, reject: rej });
	ws.send(JSON.stringify({ id, method, params }));
});
await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1300, height: 1500, deviceScaleFactor: 1, mobile: false });
await sleep(2200);

const shot = async (name) => {
	const { data } = await send('Page.captureScreenshot', { format: 'png' });
	writeFileSync(nodePath.join(OUT, name), Buffer.from(data, 'base64'));
};
const ev = async (x) => {
	const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true });
	if (r.exceptionDetails) console.log('  ERR', (r.exceptionDetails.exception?.description || '').slice(0, 200));
	return r.result?.value;
};
const click = async (sel) => {
	const b = await ev(`(() => { const el = ${sel}; if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }; })()`);
	if (b === null || b === undefined) return false;
	await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: b.x, y: b.y });
	await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: b.x, y: b.y, button: 'left', buttons: 1, clickCount: 1 });
	await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', buttons: 0, clickCount: 1 });
	return true;
};

const expect = (label, actual, want) => {
	const ok = JSON.stringify(actual) === JSON.stringify(want);
	if (!ok) failures.push(`${label}\n      期望 ${JSON.stringify(want)}\n      实际 ${JSON.stringify(actual)}`);
	console.log(`  ${ok ? '✓' : '✗'} ${label}`);
};

const readRows = () => ev(`(() => {
    const scope = document.querySelectorAll('.pv-block')[0];
  const rows = [...scope.querySelectorAll('.task-card')];
  return rows.map(r => {
    const id = r.querySelector('.card-id');
    const status = r.querySelector('.task-card__status-label');
    const dot = r.querySelector('.dot');
    const when = r.querySelector('.task-card__when');
    return {
      id: id?.textContent,
      idWeight: id ? getComputedStyle(id).fontWeight : null,
      idColor: id ? getComputedStyle(id).color : null,
      kind: r.querySelector('.badge:not(.badge--domain)')?.textContent,
      domain: r.querySelector('.badge--domain')?.textContent,
      title: r.querySelector('.task-card__title')?.textContent,
      whenLabel: when?.querySelector('.task-card__when-label')?.textContent,
      whenValue: when ? when.textContent.replace('最后动过','').trim() : null,
      status: status?.textContent,
      dotColor: dot ? getComputedStyle(dot).backgroundColor : null,
      selected: r.classList.contains('is-selected'),
      unread: r.classList.contains('is-unread'),
      draft: r.classList.contains('is-draft'),
      borderColor: getComputedStyle(r).borderTopColor,
      borderWidth: getComputedStyle(r).borderTopWidth,
    };
  });
})()`);

/* ══════════════════════════════════════════════════════════ */
console.log('\n═══ ① 九行都渲染出来 ═══');
const rows = await readRows();
expect('九行', rows.length, 9);
expect('编号顺序', rows.map((r) => r.id), ['GU-01','DM-01','WW-01','WF-01','WS-01','RB-01','GT-01','GT-02','GT-03']);
await shot('01-list.png');

console.log('\n═══ ② 六档颜色 ═══');
/* 按状态取 dot 颜色，检查六个档位互不相同、且符合预期 */
const dotByStatus = {};
for (const row of rows) dotByStatus[row.status] = row.dotColor;
console.log('  ', JSON.stringify(dotByStatus));
expect('未指定 = 灰 #9ca3af', dotByStatus['未指定'], 'rgb(156, 163, 175)');
expect('提交 = 蓝 #2563eb', dotByStatus['提交'], 'rgb(37, 99, 235)');
expect('处理中 = 蓝（同提交）', dotByStatus['处理中'], 'rgb(37, 99, 235)');
expect('需要信息 = 橙 #f59e0b', dotByStatus['需要信息'], 'rgb(245, 158, 11)');
expect('需要授权 = 橙（同需要信息）', dotByStatus['需要授权'], 'rgb(245, 158, 11)');
expect('成功 = 绿 #10b981', dotByStatus['成功'], 'rgb(16, 185, 129)');
expect('失败 = 红 #ef4444', dotByStatus['失败'], 'rgb(239, 68, 68)');
expect('取消 = 灰 #6b7280', dotByStatus['取消'], 'rgb(107, 114, 128)');
expect('拒绝 = 红（同失败）', dotByStatus['拒绝'], 'rgb(239, 68, 68)');
console.log('  → 成功绿 / 失败拒绝红 / 取消灰 —— 「完成」组内部三种色 ✅');

console.log('\n═══ ③ 列结构：固定宽度 ═══');
const geo = await ev(`(() => {
  const r = document.querySelectorAll('.task-card')[1];
  const get = (sel) => {
    const el = r.querySelector(sel);
    return el ? Math.round(el.getBoundingClientRect().width) : null;
  };
  return {
    rowW: Math.round(r.getBoundingClientRect().width),
    whenW: get('.task-card__when'),
    statusW: get('.task-card__status'),
    titleW: get('.task-card__title'),
  };
})()`);
console.log('  ', JSON.stringify(geo));
expect('最后动过 = 90px', geo.whenW, 90);
expect('状态列 = 96px', geo.statusW, 96);
expect('标题是弹性列（> 200px）', geo.titleW > 200, true);

console.log('\n═══ ④ 草稿无边框（但占 2px 不跳）═══');
const gu = rows[0];
expect('GU-01 是草稿', gu.draft, true);
expect('草稿边框透明', gu.borderColor, 'rgba(0, 0, 0, 0)');
expect('⚠ 但边框宽度仍是 2px（不跳）', gu.borderWidth, '2px');
const dm = rows[1];
expect('非草稿有边框', dm.draft, false);
expect('非草稿边框是灰', dm.borderColor, 'rgb(231, 233, 238)');

console.log('\n═══ ⑤ 未读 = 编号加粗 800（不是装饰）═══');
const ww = rows[2];
expect('WW-01 未读', ww.unread, true);
expect('⚠ 编号字重 800', ww.idWeight, '800');
const wf = rows[3];
expect('WF-01 非未读', wf.unread, false);
expect('编号字重 700', wf.idWeight, '700');

console.log('\n═══ ⑥ 点一行选中 ═══');
await click(`document.querySelectorAll('.task-card')[5]`);
await sleep(400);
const after = await readRows();
expect('RB-01 被选中', after[5].selected, true);
expect('其它没选中', after.filter((r) => r.selected).length, 1);
await shot('02-selected.png');

const selState = await ev(`(document.querySelector('.pv-state code')||{}).textContent`);
expect('selected 状态同步', selState, '"RB-01"');

console.log('\n═══ ⑦ 最后动过：列名 + 值 ═══');
const first = rows[0];
expect('列名常显「最后动过」', first.whenLabel, '最后动过');
expect('值格式 MM-DD HH:mm', /^\d{2}-\d{2} \d{2}:\d{2}$/.test(first.whenValue), true);

console.log('\n═══ ⑧ 九个状态的圆点区块 ═══');
const dotBlock = await ev(`(() => {
  const block = [...document.querySelectorAll('.pv-block')][1];
    const dots = [...block.querySelectorAll('.task-card__status .dot')];
  return { count: dots.length, colors: dots.map(d => getComputedStyle(d).backgroundColor) };
})()`);
console.log('  ', JSON.stringify(dotBlock));
expect('九个圆点', dotBlock.count, 9);
expect('颜色种类恰好 6 档', new Set(dotBlock.colors).size, 6);

console.log('\n═══ JS 错误 ═══');
console.log(errors.length ? errors.join('\n') : '  没有');
console.log('\n═══ 断言结果 ═══');
console.log(failures.length ? failures.join('\n') : '  全部通过');

proc.kill();
process.exit(failures.length > 0 || errors.length > 0 ? 1 : 0);

