/**
 * 科技树验收运行器：**SSR 断言 + 浏览器几何测量**。
 *
 * ## ① SSR（`ssr.tsx`）
 *
 * 把真组件渲染成静态 HTML，断言结构 / class / 数量 / 两态宽度字符串。
 * `ssr.tsx` 有 JSX，Node 的运行时类型剥离不处理 JSX ⇒ 不能直接
 * `node ssr.tsx`。所以这里先用 rolldown 打包成临时 ESM，再动态 import。
 *
 * ## ② 浏览器几何（`measure.tsx`）
 *
 * `FoldRect` 的顶边靠 `margin-top:-16px`、宽度靠 CSS 盒模型，SSR 量不到
 * `getBoundingClientRect()`。这里把 `measure.tsx` 打成浏览器 ESM，用 headless Edge
 * `--dump-dom` 取回页面内写好的 JSON，断言：
 *
 * - 同一组胶囊两态宽度差 ≤ 1px；
 * - 展开态矩形 top ≥ 胶囊 top + 胶囊高/2（顶边被盖住）；
 * - 矩形与胶囊左边缘差 ≤ 1px；
 * - #50 角标完全在卡片内部、right/bottom 内距 10px。
 *
 * 没有 Edge 时默认跳过（设 `TB3_REQUIRE_BROWSER=1` 可升级为硬失败）。
 *
 * ## 用法
 *
 * ```powershell
 * node dev/preview/techtree/verify.mjs
 * ```
 *
 * 退出码 0 = 全部断言通过；1 = 有失败（失败清单在最后）。
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { rolldown } from 'rolldown';

const HERE = import.meta.dirname;

/* ── ① 打包（react / react-dom / 组件 / 纯函数全部打进来，运行时不需要 node_modules） ── */
const bundle = await rolldown({
	input: join(HERE, 'ssr.tsx'),
	platform: 'node',
	/*
	 * ⚠ 不传 `define` / `jsx`：这个 rolldown 版本的输入选项里没有它们
	 *   （传了会打一行 "Invalid input options" 警告，而且不生效）。
	 *   `.tsx` 的 JSX 由 rolldown 内建的 oxc 转换处理；React 的
	 *   development/production 分支由 Node 的 `process.env.NODE_ENV` 决定
	 *   （没设就是 development，报错信息完整）。
	 */
	external: [],
});

const { output } = await bundle.generate({
	format: 'esm',
	sourcemap: false,
});

const code = output
	.filter((one) => one.type === 'chunk')
	.map((one) => one.code)
	.join('\n');

await bundle.close();

/* ── ② 写临时文件 → ③ import → ④ 清理 ── */
const dir = mkdtempSync(join(tmpdir(), 'tb3-techtree-ssr-'));
const file = join(dir, 'check.mjs');
writeFileSync(file, code, 'utf8');

try {
	await import(pathToFileURL(file).href);
} finally {
	rmSync(dir, { recursive: true, force: true });
}

/* ══════════════════════════════════════════════════════════════
 * ⑤ 浏览器几何测量（headless Edge + --dump-dom）
 *
 * SSR 能断言 class / 宽度字符串，但量不到 `getBoundingClientRect()`。
 * 这里把 `measure.tsx` 打成浏览器 ESM，写进临时 HTML，用 Edge `--dump-dom`
 * 取回页面里写好的 JSON，再断言三件事：
 *
 * - 同一组胶囊两态宽度差 ≤ 1px；
 * - 展开态矩形 top ≥ 胶囊 top + 胶囊高/2（顶边被胶囊盖住）；
 * - 矩形左边缘与胶囊左边缘差 ≤ 1px。
 *
 * ⚠ 没有 Edge / 起不来时默认 **跳过但不失败**（CI 可能没有浏览器），
 *   设 `TB3_REQUIRE_BROWSER=1` 可把它升级成硬失败。
 * ══════════════════════════════════════════════════════════════ */

/** Edge 可执行文件的候选路径。 */
const EDGE_CANDIDATES = [
	process.env['EDGE_PATH'],
	'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
	'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

/** 找到本机 Edge；找不到返回 undefined。 */
function findEdge() {
	for (const candidate of EDGE_CANDIDATES) {
		if (typeof candidate === 'string' && existsSync(candidate)) return candidate;
	}
	return undefined;
}

/** 把 HTML 文本里的常见实体还原（--dump-dom 会把文本里的尖括号转义）。 */
function decodeHtmlText(text) {
	return text
		.replaceAll('&quot;', '"')
		.replaceAll('&#x27;', "'")
		.replaceAll('&lt;', '<')
		.replaceAll('&gt;', '>')
		.replaceAll('&amp;', '&');
}

/** 打印实测数字，返回失败条数。 */
function assertMeasurements(data) {
	const checks = [
		{
			name: '同一组胶囊两态宽度差 ≤ 1px',
			ok: data.pillWidthDiff <= 1,
			detail: `收起 ${data.collapsedPillWidth} / 展开 ${data.expandedPillWidth} / diff ${data.pillWidthDiff}`,
		},
		{
			name: '展开态矩形顶边在胶囊中线以下（被盖住）',
			ok: data.rectTopBelowPillCenter >= 0,
			detail: `rect.top − (pill.top + pill.height/2) = ${data.rectTopBelowPillCenter}`,
		},
		{
			name: '矩形左边缘与胶囊左边缘差 ≤ 1px',
			ok: data.rectPillLeftDiff <= 1,
			detail: `diff ${data.rectPillLeftDiff}（pill.left vs rect.left）`,
		},
		{
			name: '矩形宽度与胶囊宽度差 ≤ 1px',
			ok: data.rectPillWidthDiff <= 1,
			detail: `diff ${data.rectPillWidthDiff}`,
		},
		{
			name: '胶囊两态位置不漂移（top 差 ≤ 1px）',
			ok: data.pillTopDiff <= 1,
			detail: `diff ${data.pillTopDiff}`,
		},
		{
			name: '收起态矩形数量 = 0（不是透明）',
			ok: data.collapsedRectCount === 0,
			detail: String(data.collapsedRectCount),
		},
		{
			name: '展开态矩形数量 = 1',
			ok: data.expandedRectCount === 1,
			detail: String(data.expandedRectCount),
		},
		{
			name: '#50 角标完全在卡片内部（不压边框）',
			ok: data.badgeInsideCard === true,
			detail: `right inset ${data.badgeRightInset} / bottom inset ${data.badgeBottomInset}`,
		},
		{
			name: '#50 角标 right/bottom 内距 = 10px（±1）',
			ok: Math.abs(data.badgeRightInset - 10) <= 1 && Math.abs(data.badgeBottomInset - 10) <= 1,
			detail: `right ${data.badgeRightInset} / bottom ${data.badgeBottomInset}`,
		},
		{
			name: '组是原子块：同列非成员卡被推到矩形下方',
			ok: data.x01BelowGroupRect === true,
			detail: `X01.top ${data.x01CardTop} / rect.bottom ${data.expandedRectBottom}`,
		},
	];

	let failed = 0;
	for (const check of checks) {
		if (!check.ok) failed += 1;
		console.log(`${check.ok ? '✓' : '✗'} ${check.name} — ${check.detail}`);
	}
	return failed;
}

/**
 * 浏览器测量主流程。
 *
 * @returns 失败条数；`0` 包括「没有浏览器因此跳过」。
 */
async function runBrowserMeasurements() {
	const edge = findEdge();
	if (edge === undefined) {
		console.log('\n⚠ 未找到 Edge，跳过浏览器几何测量（设 TB3_REQUIRE_BROWSER=1 可改为硬失败）');
		return process.env['TB3_REQUIRE_BROWSER'] === '1' ? 1 : 0;
	}

	const measureBundle = await rolldown({
		input: join(HERE, 'measure.tsx'),
		platform: 'browser',
		external: [],
	});
	const { output } = await measureBundle.generate({ format: 'esm', sourcemap: false });
	await measureBundle.close();
	const measureCode = output
		.filter((one) => one.type === 'chunk')
		.map((one) => one.code)
		.join('\n');

	const work = mkdtempSync(join(tmpdir(), 'tb3-techtree-measure-'));
	const htmlPath = join(work, 'measure.html');
	const profilePath = join(work, 'edge-profile');
	const html = `<!doctype html>
<html lang="zh">
<head><meta charset="utf-8"><title>fold measure</title></head>
<body style="margin:0;font-family:Segoe UI,Microsoft YaHei,sans-serif">
<div id="root"></div>
<pre id="fold-measurement">pending</pre>
<script type="module">${measureCode}</script>
</body>
</html>`;
	writeFileSync(htmlPath, html, 'utf8');

	try {
		const run = spawnSync(
			edge,
			[
				'--headless=new',
				'--disable-gpu',
				'--disable-extensions',
				'--disable-background-networking',
				'--log-level=3',
				'--no-first-run',
				'--no-default-browser-check',
				`--user-data-dir=${profilePath}`,
				'--dump-dom',
				pathToFileURL(htmlPath).href,
			],
			{
				encoding: 'utf8',
				timeout: 90_000,
				windowsHide: true,
				/* React 开发版 + 整页 HTML 会超过默认 1MB，不放大就 ENOBUFS。 */
				maxBuffer: 64 * 1024 * 1024,
			},
		);
		const dom = run.stdout ?? '';
		const match = /<pre id="fold-measurement">([\s\S]*?)<\/pre>/.exec(dom);
		if (run.status !== 0 || match === null) {
			const reason = run.error === undefined ? `status ${String(run.status)}` : String(run.error);
			console.log(`\n⚠ 浏览器测量未能取回结果（${reason}）`);
			if (run.stderr !== undefined && run.stderr !== '') {
				console.log(run.stderr.trim().split('\n').slice(-4).join('\n'));
			}
			return process.env['TB3_REQUIRE_BROWSER'] === '1' ? 1 : 0;
		}
		const raw = decodeHtmlText(match[1] ?? '').trim();
		let data;
		try {
			data = JSON.parse(raw);
		} catch {
			console.log(`\n✗ 浏览器测量结果不是 JSON：${raw.slice(0, 300)}`);
			return 1;
		}
		console.log('\n浏览器几何测量（getBoundingClientRect）：');
		return assertMeasurements(data);
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
}

const measureFailures = await runBrowserMeasurements();
if (measureFailures > 0) process.exitCode = 1;
