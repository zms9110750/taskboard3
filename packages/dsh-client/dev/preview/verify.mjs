/**
 * 验证 CardRow / StatusButton / StatusDot。
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
    const square = r.querySelector('.task-card__square');
    const id = r.querySelector('.task-card__square-id');
    const status = r.querySelector('.status-button__label');
    const dot = r.querySelector('.status-button .dot');
    const when = r.querySelector('.task-card__when');
    const cs = getComputedStyle(r);
    return {
      id: id?.textContent,
      idWeight: id ? getComputedStyle(id).fontWeight : null,
      kind: r.querySelector('.badge:not(.badge--domain):not(.badge--template)')?.textContent,
      domain: r.querySelector('.badge--domain')?.textContent,
      template: r.querySelector('.badge--template')?.textContent,
      title: r.querySelector('.task-card__title')?.textContent,
      whenLabel: when?.querySelector('.task-card__when-label')?.textContent,
      whenValue: when ? when.textContent.replace('最后动过','').trim() : null,
      status: status?.textContent,
      dotColor: dot ? getComputedStyle(dot).backgroundColor : null,
      squareW: square ? Math.round(square.getBoundingClientRect().width) : null,
      squareH: square ? Math.round(square.getBoundingClientRect().height) : null,
      selected: r.classList.contains('is-selected'),
      draft: r.classList.contains('is-draft'),
      unreadAi: r.classList.contains('is-unread-ai'),
      unreadUser: r.classList.contains('is-unread-user'),
      borderLeftW: cs.borderLeftWidth,
      borderRightW: cs.borderRightWidth,
      borderLeftColor: cs.borderLeftColor,
      borderRightColor: cs.borderRightColor,
      borderTopColor: cs.borderTopColor,
    };
  });
})()`);

/* ══════════════════════════════════════════════════════════ */
console.log('\n═══ ① 九行都渲染出来 ═══');
const rows = await readRows();
expect('九行', rows.length, 9);
expect('编号顺序', rows.map((r) => r.id), ['GU-01','DM-01','WW-01','WF-01','WS-01','RB-01','GT-01','GT-02','GT-03']);
await shot('01-list.png');

console.log('\n═══ ② 九色（一个状态一个色）═══');
/* 按状态取 dot 颜色，检查九个状态九种颜色（用户 2026-11-18 定） */
const dotByStatus = {};
for (const row of rows) dotByStatus[row.status] = row.dotColor;
console.log('  ', JSON.stringify(dotByStatus));
expect('未指定 = 灰 #9ca3af', dotByStatus['未指定'], 'rgb(156, 163, 175)');
expect('提交 = 黑 #111827', dotByStatus['提交'], 'rgb(17, 24, 39)');
expect('处理中 = 青 #06b6d4', dotByStatus['处理中'], 'rgb(6, 182, 212)');
expect('需要信息 = 黄 #eab308', dotByStatus['需要信息'], 'rgb(234, 179, 8)');
expect('需要授权 = 紫 #a855f7（色相 271°，不是蓝紫）', dotByStatus['需要授权'], 'rgb(168, 85, 247)');
expect('成功 = 绿 #10b981', dotByStatus['成功'], 'rgb(16, 185, 129)');
expect('失败 = 红 #ef4444', dotByStatus['失败'], 'rgb(239, 68, 68)');
expect('取消 = 褐 #92400e', dotByStatus['取消'], 'rgb(146, 64, 14)');
expect('拒绝 = 橙 #f97316', dotByStatus['拒绝'], 'rgb(249, 115, 22)');
expect('⚠ 九种颜色两两不同', new Set(Object.values(dotByStatus)).size, 9);

console.log('\n═══ ③ 左侧正方形：编号在上、状态在下 ═══');
const geo = await ev(`(() => {
  const r = document.querySelectorAll('.task-card')[1];
  const sq = r.querySelector('.task-card__square');
  const id = r.querySelector('.task-card__square-id');
  const st = r.querySelector('.status-button');
  const idR = id.getBoundingClientRect();
  const stR = st.getBoundingClientRect();
  return {
    squareW: Math.round(sq.getBoundingClientRect().width),
    idTop: Math.round(idR.top),
    statusTop: Math.round(stR.top),
    sameLeft: Math.abs(idR.left - stR.left) < 2,
    whenW: Math.round(r.querySelector('.task-card__when').getBoundingClientRect().width),
    gapToBadge: Math.round(r.querySelector('.task-card__square').getBoundingClientRect().right) === 0 ? 0 : Math.round(r.querySelector('.badge').getBoundingClientRect().left - r.querySelector('.task-card__square').getBoundingClientRect().right),
  };
})()`);
console.log('  ', JSON.stringify(geo));
expect('正方形至少 46px（状态按钮撑宽，不再钉死）', geo.squareW >= 46, true);
expect('⚠ 状态在编号下面（top 更大）', geo.statusTop > geo.idTop, true);
expect('⚠ 两者左对齐（同一竖列）', geo.sameLeft, true);
expect('最后动过 90px', geo.whenW, 90);
expect('⚠ 正方形到 label 的间距 ≤ 10px', geo.gapToBadge <= 10, true);

console.log('\n═══ ④ 三个 label 横排（不换行不堆叠）═══');
const labelGeo = await ev(`(() => {
  const r = document.querySelectorAll('.task-card')[3];
  const bs = [...r.querySelectorAll('.task-card__line > .badge')];
  const tops = bs.map(b => Math.round(b.getBoundingClientRect().top));
  const heights = bs.map(b => Math.round(b.getBoundingClientRect().height));
  return {
    count: bs.length,
    texts: bs.map(b => b.textContent),
    tops,
    allSameTop: new Set(tops).size === 1,
    oneRow: new Set(heights).size === 1,
    maxW: Math.max(...bs.map(b => Math.round(b.getBoundingClientRect().width))),
  };
})()`);
console.log('  ', JSON.stringify(labelGeo));
expect('三个 label', labelGeo.count, 3);
expect('是 分类/领域/模板名', labelGeo.texts.length === 3, true);
expect('⚠ 同一行（top 相同）', labelGeo.allSameTop, true);
expect('⚠ 单行高度（没有堆叠）', labelGeo.oneRow, true);
expect('模板名显示了', labelGeo.texts[2], '写代码');

console.log('\n═══ ⑤ 未读：边框加厚 + 上色 ═══');
const gu = rows[0];
expect('GU-01 = AI 改过', gu.unreadAi, true);
expect('⚠ 左边框加厚到 4px', gu.borderLeftW, '4px');
expect('⚠ 左边框变蓝', gu.borderLeftColor, 'rgb(37, 99, 235)');
expect('右边框保持 2px', gu.borderRightW, '2px');

const ww = rows[2];
expect('WW-01 = 我改过', ww.unreadUser, true);
expect('⚠ 右边框加厚到 4px', ww.borderRightW, '4px');
expect('⚠ 右边框变橙', ww.borderRightColor, 'rgb(217, 119, 6)');
expect('左边框保持 2px', ww.borderLeftW, '2px');

const wsCard = rows[4];
expect('⚠ WS-01 数据两边都真，但 UI 只亮左边', [wsCard.unreadAi, wsCard.unreadUser], [true, false]);
expect('左 4px、右 2px（只亮一边）', [wsCard.borderLeftW, wsCard.borderRightW], ['4px', '2px']);

const dm = rows[1];
expect('DM-01 = 没改过', [dm.unreadAi, dm.unreadUser], [false, false]);
expect('左右都 2px', [dm.borderLeftW, dm.borderRightW], ['2px', '2px']);

console.log('\n═══ ⑥ 草稿无边框（但占 2px 不跳）═══');
expect('GU-01 是草稿', gu.draft, true);
expect('草稿边框透明', gu.borderTopColor, 'rgba(0, 0, 0, 0)');

console.log('\n═══ ⑦ 点一行选中 ═══');
await click(`document.querySelectorAll('.task-card')[5]`);
await sleep(400);
const after = await readRows();
expect('RB-01 被选中', after[5].selected, true);
expect('其它没选中', after.filter((r) => r.selected).length, 1);
await shot('02-selected.png');

const selState = await ev(`(document.querySelector('.pv-state code')||{}).textContent`);
expect('selected 状态同步', selState, '"RB-01"');

console.log('\n═══ ⑧ 最后动过：列名 + 值 ═══');
expect('列名常显「最后动过」', rows[0].whenLabel, '最后动过');
expect('值格式 MM-DD HH:mm', /^\d{2}-\d{2} \d{2}:\d{2}$/.test(rows[0].whenValue), true);

console.log('\n═══ JS 错误 ═══');
console.log(errors.length ? errors.join('\n') : '  没有');
console.log('\n═══ 断言结果 ═══');
console.log(failures.length ? failures.join('\n') : '  全部通过');

proc.kill();
process.exit(failures.length > 0 || errors.length > 0 ? 1 : 0);







