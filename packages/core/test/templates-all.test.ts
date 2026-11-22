/**
 * 全部模板的加载测试 —— 18 个 YAML 必须**全部**过新 loader。
 *
 * ## 为什么这个测试重要
 *
 * 模板是**用户定的文字 + 数据**。一个 YAML 加载失败不会让 core 崩
 * （`builtin.ts` 逐文件容错），但会让用户在选择器里**看不到那个模板** ——
 * 而且没有任何报错。⇒ 必须有一条测试守着「一个都没漏」。
 *
 * ## 断言什么
 *
 * 1. `loaded === 18`、`errors` 为空 —— 文件数与解析结果对得上
 * 2. 每个模板：`kind` / `domain` / `displayName` 非空
 * 3. 每个模板至少一章（否则建卡时没有东西可填）
 * 4. 每个章节的 `action` 都在 action 注册表里（否则该模板的 schema 建不出来）
 * 5. 章节 label 在同一模板内唯一（loader 会报，但这里再确认一次不重复）
 * 6. 模板之间 `ref` 唯一（文件名唯一性）
 *
 * ## ⚠ 这个测试**不校验模板文字**
 *
 * `label` / `hint` / `usage` / `description` 的中文是用户定的措辞。
 * 测试只断言「非空」，不断言具体内容 —— 否则用户改一个字就要改测试，
 * 那是拿测试反向锁死用户的措辞。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ActionRegistry, BUILTIN_ACTIONS } from '../src/template/actions.ts';
import { builtinTemplateErrors, builtinTemplates } from '../src/template/builtin.ts';
import { TemplateRegistry } from '../src/template/registry.ts';

/** 期望的模板数量。改模板就改这个数字 —— 让「少了一个」变成测试失败。 */
const EXPECTED_COUNT = 18;

describe('全部模板', () => {
	const registry = new TemplateRegistry();
	const actions = new ActionRegistry();
	for (const action of BUILTIN_ACTIONS) actions.register(action);

	/*
	 * 加载入口 = `builtinTemplates()`（用户 2026-11-23：
	 * 「模板的读取不是 io。而是配置。跟随包的。只在包里面。」）。
	 *
	 * 它**在包初始化时就读完**（模块求值），这里只是取那份常量。
	 * `loadDirectory(dir)` 已删 —— 外部不能给目录，只能以**包**的形式注册。
	 */
	const builtin = builtinTemplates();
	const builtinErrors = builtinTemplateErrors();
	registry.registerAll(builtin);
	registry.setErrors(builtinErrors);
	const templates = registry.list();

	it(`${EXPECTED_COUNT} 个模板全部加载，零错误`, () => {
		assert.deepEqual(
			builtinErrors.map((one) => `${one.file}: ${one.message}`),
			[],
			'有模板加载失败',
		);
		assert.equal(builtin.length, EXPECTED_COUNT, '加载数量与期望不符');
		assert.equal(templates.length, EXPECTED_COUNT);
	});

	it('ref（文件名）互不重复', () => {
		const refs = templates.map((one) => one.ref);
		assert.equal(new Set(refs).size, refs.length);
	});

	it('每个模板的 kind / domain / displayName 非空', () => {
		for (const template of templates) {
			assert.notEqual(template.displayName, '', `模板「${template.ref}」缺 displayName`);
			assert.notEqual(template.kind, '', `模板「${template.ref}」缺 kind`);
			assert.notEqual(template.domain, '', `模板「${template.ref}」缺 domain`);
		}
	});

	it('每个模板至少一章', () => {
		for (const template of templates) {
			assert.ok(
				template.sections.length >= 1,
				`模板「${template.ref}」一章都没有（建卡时无处可填）`,
			);
		}
	});

	it('每章的 label 唯一，且 action 已注册', () => {
		for (const template of templates) {
			const labels = template.sections.map((section) => section.label);
			assert.equal(
				new Set(labels).size,
				labels.length,
				`模板「${template.ref}」有重复章节名：${labels.join(' / ')}`,
			);

			for (const section of template.sections) {
				assert.notEqual(section.label, '', `模板「${template.ref}」的「${section.id}」缺 label`);
				assert.ok(
					actions.has(section.action),
					`模板「${template.ref}」的「${section.label}」用了未注册的 action「${section.action}」`,
				);
			}
		}
	});

	it('每个 derive 指向的模板都存在', () => {
		const refs = new Set(templates.map((one) => one.ref));
		for (const template of templates) {
			for (const derive of template.derives) {
				assert.ok(
					refs.has(derive.template),
					`模板「${template.ref}」声明派生到「${derive.template}」，但那个模板不存在`,
				);
			}
		}
	});

	it('模板用到的 action 都在三个内置 action 之内', () => {
		const used = new Set<string>();
		for (const template of templates) {
			for (const section of template.sections) used.add(section.action);
		}
		assert.deepEqual(
			[...used].sort(),
			['ask', 'markdown', 'text'],
			`模板用到了意料之外的 action：${[...used].join(' / ')}`,
		);
	});
});


