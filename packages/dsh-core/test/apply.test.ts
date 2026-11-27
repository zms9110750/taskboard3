/**
 * `apply()` 的行为测试 —— 本包此前零测试（TODO(审查) 记录过）。
 *
 * 覆盖四件事：provide 四个服务名、③ 模板贡献面含三个注册表、
 * effect 注册清理（AGENTS 规则 6：import 源码 `.ts`）。
 */

import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

import { createSqliteStore } from '@taskboard/io';

import {
	apply,
	type ApplyContext,
	BUS_SERVICE,
	CORE_SERVICE,
	DEFAULT_WORKSPACE_SERVICE,
	TEMPLATES_SERVICE,
} from '../src/index.ts';

/** 每个用例打开的 store（afterEach 里关掉，避免句柄泄漏）。 */
const opened: { close?: () => Promise<void> }[] = [];

afterEach(() => {
	for (const store of opened.splice(0)) {
		void store.close?.();
	}
});

/** 一次用例的夹具：真 store + 假 provide/effect + 回读表。 */
interface Fixture {
	readonly ctx: ApplyContext;
	readonly provided: Map<string, unknown>;
	readonly effects: (() => () => void)[];
}

/** 造一个最小但真实的 ctx（真 store + 假 provide/effect）。 */
function contextOf(): Fixture {
	const store = createSqliteStore(mkdtempSync(join(tmpdir(), 'tb3-dsh-core-apply-')));
	opened.push(store as { close?: () => Promise<void> });
	const provided = new Map<string, unknown>();
	const effects: (() => () => void)[] = [];
	const ctx: ApplyContext = {
		taskboard3Store: store as never,
		provide: (name, api) => {
			provided.set(name, api);
		},
		effect: (fn) => {
			effects.push(fn);
		},
	};
	return { ctx, provided, effects };
}

test('provide 四个服务名：core / bus / templates / 默认空间', () => {
	const { ctx, provided } = contextOf();
	apply(ctx);

	assert.deepEqual(
		[...provided.keys()].sort(),
		[BUS_SERVICE, CORE_SERVICE, DEFAULT_WORKSPACE_SERVICE, TEMPLATES_SERVICE].map(String).sort(),
		'服务名集合必须一致（多 provide / 少 provide 都是静默故障源）',
	);
});

test('③ 模板贡献面：templates / kinds / domains 三个注册表都有内置内容', () => {
	const { ctx, provided } = contextOf();
	apply(ctx);

	const face = provided.get(TEMPLATES_SERVICE) as {
		templates: { list(): readonly { ref: string }[] };
		kinds: { list(): readonly { id: string }[] };
		domains: { list(): readonly { id: string }[] };
	};
	assert.ok(face !== undefined, '③ 必须提供');
	/* 内置模板在建实例时进表。 */
	assert.ok(face.templates.list().length > 0, '内置模板应在注册表里');
	/* 内置类别（G/D/W/R）与领域同理。 */
	assert.ok(face.kinds.list().length >= 4, '内置类别（G/D/W/R）应在');
	assert.ok(face.domains.list().length >= 1, '内置领域应在');
});

test('effect 注册清理函数（apply 返回后由 Cordis 在卸载时调）', () => {
	const { ctx, effects } = contextOf();
	apply(ctx);

	assert.equal(effects.length, 1, 'apply 应注册恰好一个 effect');
	const disposer = effects[0]!();
	assert.equal(typeof disposer, 'function', 'effect 的返回值是清理函数');
});
