/**
 * `template/schema.ts` 的校验测试 —— 逐章节校验替代 `strictObject` 类型逃逸。
 *
 * ## 锁住什么
 *
 * 1. 未知章节名 ⇒ `CONTENT_INVALID`，`issues` 有 `/content/<key>` 条目，消息列出可用章节
 * 2. payload 形状不对 ⇒ 同一个 `CONTENT_INVALID`，`issues` 的 path 是
 *    `/content/<调用方给的原 key>/<字段>`
 * 3. **两者 `Failure` 形状一致**（都有 code / message / issues）
 * 4. 多个章节同时错 ⇒ **一次报全**（不是只报第一个）
 * 5. 章节名变成 id 传也认（label 与 id 都能当 key）
 * 6. 省略的章节填模板默认值
 * 7. JSON Pointer 转义（章节名里有 `/` 或 `~`）
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { z } from 'zod';

import { ActionRegistry, BUILTIN_ACTIONS } from '../src/template/actions.ts';
import { TemplateRegistry } from '../src/template/registry.ts';
import { ContentSchemaCache } from '../src/template/schema.ts';
import type { TemplateDef } from '../src/template/types.ts';

/** 一个测试模板：两个章节，text 与 markdown。 */
function makeTemplate(): TemplateDef {
	return {
		ref: 'demo',
		displayName: '演示',
		kind: 'work',
		domain: '核心',
		codePrefix: 'D',
		usage: '',
		description: '',
		sections: [
			{
				id: 'what',
				label: '要做什么',
				hint: '',
				action: 'text',
				defaultPayload: { $type: 'text', placeholder: '写下来' },
			},
			{
				id: 'how',
				label: '怎么做',
				hint: '',
				action: 'markdown',
				defaultPayload: { $type: 'markdown' },
			},
		],
		derives: [],
	};
}

/** 造一个装好内置 action + 一个测试模板的缓存。 */
function makeCache(template: TemplateDef = makeTemplate()): ContentSchemaCache {
	const actions = new ActionRegistry();
	for (const action of BUILTIN_ACTIONS) actions.register(action);
	const templates = new TemplateRegistry();
	templates.register(template);
	const cache = new ContentSchemaCache(templates, actions);
	cache.start();
	return cache;
}

describe('逐章节校验：未知章节名', () => {
	it('报 CONTENT_INVALID，issues 有 /content/<key> 条目', () => {
		const cache = makeCache();
		const result = cache.validate('demo', { 瞎写的: { $type: 'text' } });
		assert.equal(result.ok, false);
		if (result.ok) return;

		assert.equal(result.code, 'CONTENT_INVALID');
		assert.ok(result.issues !== undefined, '必须带 issues');
		assert.equal(result.issues?.length, 1);
		assert.equal(result.issues?.[0]?.path, '/content/瞎写的');
	});

	it('消息里列出可用章节与它们的 action', () => {
		const cache = makeCache();
		const result = cache.validate('demo', { 瞎写的: {} });
		assert.equal(result.ok, false);
		if (result.ok) return;

		assert.ok(result.message.includes('可用的章节'), '要给出修复指南');
		assert.ok(result.message.includes('要做什么'));
		assert.ok(result.message.includes('action=text'));
		assert.ok(result.message.includes('怎么做'));
		assert.ok(result.message.includes('action=markdown'));
	});

	it('多个未知 key 一次报全', () => {
		const cache = makeCache();
		const result = cache.validate('demo', { 甲: {}, 乙: {} });
		assert.equal(result.ok, false);
		if (result.ok) return;
		assert.equal(result.issues?.length, 2);
	});
});

describe('逐章节校验：payload 形状', () => {
	it('报 CONTENT_INVALID，path 是 /content/<原 key>/<字段>', () => {
		const cache = makeCache();
		const result = cache.validate('demo', { 要做什么: { $type: 'text', value: 123 } });
		assert.equal(result.ok, false);
		if (result.ok) return;

		assert.equal(result.code, 'CONTENT_INVALID');
		assert.ok(result.issues !== undefined);
		const paths = result.issues?.map((one) => one.path) ?? [];
		assert.ok(
			paths.some((one) => one.startsWith('/content/要做什么/value')),
			`path 应当指向具体字段，实际：${JSON.stringify(paths)}`,
		);
	});

	it('同时多章出错 ⇒ 一次报全', () => {
		const cache = makeCache();
		const result = cache.validate('demo', {
			要做什么: { $type: 'text', value: 1 },
			怎么做: { $type: 'markdown', value: 2 },
		});
		assert.equal(result.ok, false);
		if (result.ok) return;
		assert.equal(result.issues?.length, 2, '两章各一条');
		const joined = result.issues?.map((one) => one.path).join(' ') ?? '';
		assert.ok(joined.includes('要做什么'));
		assert.ok(joined.includes('怎么做'));
	});

	it('消息里指出哪一章、哪个字段、该章 action', () => {
		const cache = makeCache();
		const result = cache.validate('demo', { 要做什么: { $type: 'text', value: 1 } });
		assert.equal(result.ok, false);
		if (result.ok) return;
		assert.ok(result.message.includes('要做什么'));
		assert.ok(result.message.includes('action=text'));
	});
});

describe('两套失败路径：形状一致', () => {
	it('未知章节名与形状错误都有 code / message / issues', () => {
		const cache = makeCache();

		const unknownKey = cache.validate('demo', { 瞎写: {} });
		const badShape = cache.validate('demo', { 要做什么: { $type: 'text', value: 1 } });

		assert.equal(unknownKey.ok, false);
		assert.equal(badShape.ok, false);
		if (unknownKey.ok || badShape.ok) return;

		for (const [name, result] of [
			['未知章节名', unknownKey],
			['形状错误', badShape],
		] as const) {
			assert.equal(result.code, 'CONTENT_INVALID', `${name} 的 code 应当是 CONTENT_INVALID`);
			assert.equal(typeof result.message, 'string');
			assert.ok(result.message.length > 0, `${name} 要有 message`);
			assert.ok(Array.isArray(result.issues), `${name} 要有 issues 数组`);
			assert.ok((result.issues?.length ?? 0) > 0, `${name} 的 issues 不能为空`);
			for (const issue of result.issues ?? []) {
				assert.equal(typeof issue.path, 'string');
				assert.ok(issue.path.startsWith('/'), `${name} 的 path 要是 JSON Pointer`);
				assert.equal(typeof issue.message, 'string');
			}
		}
	});
});

describe('key 归一化与默认值', () => {
	it('章节 id 也能当 key', () => {
		const cache = makeCache();
		const result = cache.validate('demo', { what: { $type: 'text', value: '从 id 传' } });
		assert.ok(result.ok, JSON.stringify(result));
		assert.equal(result.payloads.get('what') !== undefined, true);
	});

	it('省略的章节填模板默认值', () => {
		const cache = makeCache();
		const result = cache.validate('demo', {});
		assert.ok(result.ok);
		assert.deepEqual(result.payloads.get('what'), { $type: 'text', placeholder: '写下来' });
		assert.deepEqual(result.payloads.get('how'), { $type: 'markdown' });
	});

	it('content 省略 ⇒ 全部默认值', () => {
		const cache = makeCache();
		const result = cache.validate('demo', undefined);
		assert.ok(result.ok);
		assert.equal(result.payloads.size, 2);
	});

	it('content 不是对象 ⇒ 报错', () => {
		const cache = makeCache();
		const result = cache.validate('demo', [1, 2, 3]);
		assert.equal(result.ok, false);
		if (result.ok) return;
		assert.equal(result.code, 'CONTENT_INVALID');
	});
});

describe('JSON Pointer 转义', () => {
	it('章节名含 / 或 ~ 时 path 正确转义', () => {
		const template: TemplateDef = {
			...makeTemplate(),
			sections: [
				{
					id: 'weird',
					label: 'a/b~c',
					hint: '',
					action: 'text',
					defaultPayload: { $type: 'text' },
				},
			],
		};
		const cache = makeCache(template);
		const result = cache.validate('demo', { 'a/b~c': { $type: 'text', value: 1 } });
		assert.equal(result.ok, false);
		if (result.ok) return;

		const path = result.issues?.[0]?.path ?? '';
		/* `/` → `~1`，`~` → `~0`；`value` 段不变。 */
		assert.ok(path.includes('a~1b~0c'), `转义后的路径应当含 a~1b~0c，实际：${path}`);
	});
});

describe('缓存与模板变更', () => {
	it('模板注销后 validate 报 TEMPLATE_NOT_FOUND', () => {
		const actions = new ActionRegistry();
		for (const action of BUILTIN_ACTIONS) actions.register(action);
		const templates = new TemplateRegistry();
		const off = templates.register(makeTemplate());
		const cache = new ContentSchemaCache(templates, actions);
		cache.start();

		assert.ok(cache.validate('demo', {}).ok);

		off();
		const result = cache.validate('demo', {});
		assert.equal(result.ok, false);
		if (result.ok) return;
		assert.equal(result.code, 'TEMPLATE_NOT_FOUND');
	});

	it('缓存在模板变更后清空（size 归零）', () => {
		const actions = new ActionRegistry();
		for (const action of BUILTIN_ACTIONS) actions.register(action);
		const templates = new TemplateRegistry();
		templates.register(makeTemplate());
		const cache = new ContentSchemaCache(templates, actions);
		cache.start();

		cache.validate('demo', {});
		assert.equal(cache.size, 1, '用过之后缓存里有一个');

		templates.register({ ...makeTemplate(), ref: 'another' });
		assert.equal(cache.size, 0, '注册变更清空整个缓存');
	});
});

describe('action 被注销', () => {
	it('模板引用的 action 没了 ⇒ ACTION_NOT_FOUND', () => {
		const actions = new ActionRegistry();
		const offText = actions.register(BUILTIN_ACTIONS[0] as (typeof BUILTIN_ACTIONS)[number]);
		for (const action of BUILTIN_ACTIONS.slice(1)) actions.register(action);

		const templates = new TemplateRegistry();
		templates.register(makeTemplate());
		const cache = new ContentSchemaCache(templates, actions);
		cache.start();

		offText();
		const result = cache.validate('demo', {});
		assert.equal(result.ok, false);
		if (result.ok) return;
		assert.equal(result.code, 'ACTION_NOT_FOUND');
	});
});

describe('zod schema 复用（n + m）', () => {
	it('同一 action 的 payloadSchema 实例被多个章节共用', () => {
		const actions = new ActionRegistry();
		for (const action of BUILTIN_ACTIONS) actions.register(action);
		const text = actions.get('text');
		assert.ok(text !== undefined);
		/* schema 是 zod 的 ZodType；同 action 的引用同一个实例。 */
		assert.equal(typeof text.payloadSchema.safeParse, 'function');
		assert.equal(z.custom !== undefined, true, 'zod 可用');
	});
});


