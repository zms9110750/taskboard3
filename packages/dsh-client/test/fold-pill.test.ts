/**
 * 折叠组件（`FoldPill` / `FoldRect`）的**渲染模型**测试。
 *
 * 为什么测模型而不是直接 import `.tsx`：Node 的运行时类型剥离不处理 JSX
 * （`ERR_UNKNOWN_FILE_EXTENSION`），本仓库所有组件级验收都走
 * `dev/preview/<组件>/verify.mjs` 的 SSR 打包器。这里把「态 → class / caret /
 * 是否渲染」的判决抽在 `fold-pill-model.ts` 里，让最关键的契约能被普通单测钉住：
 *
 * - 两态 class **逐字符相同**（只差 caret）；
 * - `FoldRect` 收起时模型就是 `null`（不是透明 / 高度 0）。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	foldPillModelOf,
	foldRectModelOf,
} from '../src/renderers/fold-pill-model.ts';

describe('FoldPill 渲染模型', () => {
	it('两态 class 完全相同（只差 caret 字符）', () => {
		const closed = foldPillModelOf(false, undefined);
		const open = foldPillModelOf(true, undefined);
		assert.equal(closed.className, open.className);
		assert.equal(closed.className, 'tb3-fold-pill');
		assert.equal(closed.caret, '▸');
		assert.equal(open.caret, '▾');
	});

	it('折叠/展开只改 aria-expanded，不改 tone', () => {
		const closed = foldPillModelOf(false, 'candidate');
		const open = foldPillModelOf(true, 'candidate');
		assert.equal(closed.ariaExpanded, 'false');
		assert.equal(open.ariaExpanded, 'true');
		assert.equal(closed.tone, 'candidate');
		assert.equal(open.tone, 'candidate');
	});

	it('tone 省略 ⇒ plain（不编业务语义）', () => {
		assert.equal(foldPillModelOf(false, undefined).tone, 'plain');
		assert.equal(foldPillModelOf(false, 'selected').tone, 'selected');
	});
});

describe('FoldRect 渲染模型', () => {
	it('open = false ⇒ 返回 null（折叠时矩形根本不存在）', () => {
		assert.equal(foldRectModelOf(false), null);
	});

	it('open = true ⇒ 渲染 .tb3-fold-rect', () => {
		const model = foldRectModelOf(true);
		assert.ok(model !== null);
		assert.equal(model.className, 'tb3-fold-rect');
	});
});
