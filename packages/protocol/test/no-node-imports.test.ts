/**
 * `@taskboard/protocol` 的**零运行时依赖**守卫。
 *
 * ## 守什么
 *
 * 本包的文件头承诺：「不 import 任何东西，包括 `node:` 内置模块
 * ⇒ 既能进 Node 也能进浏览器」。这条承诺以前没有测试守 —— 有人悄悄
 * `import { readFileSync } from 'node:fs'` 的话，浏览器侧才会炸。
 *
 * ## 不依赖 cwd（AGENTS 规则 4）
 *
 * 目录从 `import.meta.url` 反推，不从 `process.cwd()` 拼相对路径 ⇒
 * 从 `C:\` 这种无关目录跑也一样。
 *
 * ## 三档断言
 *
 * 1. 不许 `node:` 内置模块；
 * 2. 不许裸包名（`zod` / `@taskboard/core` …）—— 本包没有 dependencies；
 * 3. 相对导入必须写 `.ts`（AGENTS 规则 1；`node --test` 直接跑源码的前提）。
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/** `src/` 的绝对路径（从本测试文件反推，不依赖 cwd）。 */
const SRC = fileURLToPath(new URL('../src/', import.meta.url));

/** 一条 import 里的说明符（`from '…'` / 副作用 `import '…'` / 动态 `import('…')`）。 */
const SPECIFIER_PATTERNS = [
	/\bfrom\s+['"]([^'"]+)['"]/g,
	/\bimport\s+['"]([^'"]+)['"]/g,
	/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

/** 一个源文件里出现的全部说明符。 */
function specifiersOf(file: string): string[] {
	const text = readFileSync(file, 'utf8');
	return SPECIFIER_PATTERNS.flatMap((pattern) =>
		[...text.matchAll(pattern)].map((match) => match[1] ?? ''),
	);
}

/** `src/**` 下全部 `.ts`（递归，排序只为报错稳定）。 */
function sourceFiles(): string[] {
	return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
		.filter((name) => name.endsWith('.ts'))
		.sort()
		.map((name) => join(SRC, name));
}

describe('protocol 零运行时依赖', () => {
	it('src/** 至少扫到一个文件（防止目录推错导致假绿）', () => {
		const files = sourceFiles();
		assert.ok(files.length > 0, `在 ${SRC} 没扫到任何 .ts —— 目录反推可能错了`);
	});

	it('不 import 任何 node: 内置模块', () => {
		const offenders: string[] = [];
		for (const file of sourceFiles()) {
			for (const specifier of specifiersOf(file)) {
				if (specifier.startsWith('node:')) offenders.push(`${file} → ${specifier}`);
			}
		}
		assert.deepEqual(offenders, [], `protocol 不能有 node: 依赖：\n${offenders.join('\n')}`);
	});

	it('不 import 裸包名（本包没有 dependencies）', () => {
		const offenders: string[] = [];
		for (const file of sourceFiles()) {
			for (const specifier of specifiersOf(file)) {
				if (specifier.startsWith('node:')) continue;
				if (specifier.startsWith('./') || specifier.startsWith('../')) continue;
				offenders.push(`${file} → ${specifier}`);
			}
		}
		assert.deepEqual(offenders, [], `protocol 不能有第三方依赖：\n${offenders.join('\n')}`);
	});

	it('相对导入一律写 .ts（AGENTS 规则 1）', () => {
		const offenders: string[] = [];
		for (const file of sourceFiles()) {
			for (const specifier of specifiersOf(file)) {
				if (!specifier.startsWith('./') && !specifier.startsWith('../')) continue;
				if (!specifier.endsWith('.ts')) offenders.push(`${file} → ${specifier}`);
			}
		}
		assert.deepEqual(offenders, [], `相对导入要写 .ts：\n${offenders.join('\n')}`);
	});
});
