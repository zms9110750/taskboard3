/**
 * `Taskboard.requiredActions()` + 模板加载期 `action === default.$type` 断言。
 *
 * ## 为什么这两件事要一起测
 *
 * 它们是同一个问题的两端（用户 `2026-11-18` 的渲染注册表设计要求）：
 *
 *   · `requiredActions()` 算「模板需要哪些渲染器」—— ① 的**输入**
 *   · `action === default.$type` 保证「模板说的」和「卡上存的一样」—— ① 和 ③
 *     用的是同一个字符串
 *
 * 少了后者，① 会算出 `text`、③ 却按 `markdown` 查 ⇒ ① 通过而 ③ 必然报错，
 * 而且**永远修不好**（因为那是模板写错了，不是 UI 漏注册）。
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { createTaskboard, type Taskboard } from '../src/index.ts';
import { fromRaw } from '../src/template/loader.ts';
import { TemplateRegistry } from '../src/template/registry.ts';
import type { TemplateDef } from '../src/template/types.ts';

/** 造一个最小模板；`sections` 可覆写。 */
function makeTemplate(ref: string, sections: TemplateDef['sections']): TemplateDef {
	return {
		ref,
		displayName: ref,
		kind: 'work',
		domain: '核心',
		codePrefix: 'X',
		usage: '',
		description: '',
		sections,
		derives: [],
	};
}

/* ══════════════════════════════════════════════════════════
   requiredActions
   ══════════════════════════════════════════════════════════ */

describe('Taskboard.requiredActions —— 模板实际用到的 action', () => {
	let dir: string;
	let tb: Taskboard;

	before(() => {
		dir = mkdtempSync(join(tmpdir(), 'tb3-ra-'));
		tb = createTaskboard({ dataDir: dir, now: () => 1_000, builtinTemplates: false });
	});

	after(async () => {
		await tb.close();
		rmSync(dir, { recursive: true, force: true });
	});

	it('没有模板 ⇒ 空数组（不该报警）', () => {
		assert.deepEqual(tb.requiredActions(), []);
	});

	it('从一个模板收集', () => {
		const off = tb.templates().register(
			makeTemplate('t1', [
				{ id: 'a', label: 'A', hint: '', action: 'text', defaultPayload: { $type: 'text' } },
			]),
		);
		assert.deepEqual(tb.requiredActions(), ['text']);
		off();
	});

	it('⚠ 去重：两个模板用同一个 action 只出现一次', () => {
		const off1 = tb.templates().register(
			makeTemplate('d1', [
				{ id: 'a', label: 'A', hint: '', action: 'markdown', defaultPayload: { $type: 'markdown' } },
			]),
		);
		const off2 = tb.templates().register(
			makeTemplate('d2', [
				{ id: 'b', label: 'B', hint: '', action: 'markdown', defaultPayload: { $type: 'markdown' } },
				{ id: 'c', label: 'C', hint: '', action: 'ask', defaultPayload: { $type: 'ask' } },
			]),
		);
		assert.deepEqual(tb.requiredActions(), ['ask', 'markdown']);
		off1();
		off2();
	});

	it('⚠ 排序稳定（便于和 UI 注册清单逐行 diff）', () => {
		const off = tb.templates().register(
			makeTemplate('s1', [
				{ id: 'z', label: 'Z', hint: '', action: 'zeta', defaultPayload: null },
				{ id: 'a', label: 'A', hint: '', action: 'alpha', defaultPayload: null },
				{ id: 'm', label: 'M', hint: '', action: 'mu', defaultPayload: null },
			]),
		);
		assert.deepEqual(tb.requiredActions(), ['alpha', 'mu', 'zeta']);
		off();
	});

	it('注册模板后立刻反映（通知 → 重算，不缓存旧值）', () => {
		const off = tb.templates().register(
			makeTemplate('n1', [
				{ id: 'a', label: 'A', hint: '', action: 'brand-new', defaultPayload: null },
			]),
		);
		assert.deepEqual(tb.requiredActions().includes('brand-new'), true);
		off();
		assert.deepEqual(tb.requiredActions().includes('brand-new'), false);
	});
});

/* ══════════════════════════════════════════════════════════
   action === default.$type
   ══════════════════════════════════════════════════════════ */

describe('模板加载：action 与 default.$type 必须一致', () => {
	it('两者一致 ⇒ 加载成功', () => {
		const result = fromRaw('ok', {
			sections: { what: { label: '做什么', action: 'text', default: { $type: 'text' } } },
		});
		assert.equal('template' in result, true);
		if ('template' in result) {
			assert.equal(result.template.sections[0]?.action, 'text');
		}
	});

	it('⚠ 两者不一致 ⇒ 加载失败，错误信息说清两边各是什么', () => {
		const result = fromRaw('bad', {
			sections: { what: { label: '做什么', action: 'text', default: { $type: 'markdown' } } },
		});
		assert.equal('error' in result, true);
		if ('error' in result) {
			assert.match(result.error, /action/);
			assert.match(result.error, /default\.\$type/);
			assert.match(result.error, /text/);
			assert.match(result.error, /markdown/);
		}
	});

	it('只写 action、没有 default ⇒ 通过（没有另一侧可比）', () => {
		const result = fromRaw('only-action', {
			sections: { what: { label: '做什么', action: 'text' } },
		});
		assert.equal('template' in result, true);
	});

	it('只写 default、没有 action ⇒ 通过，且 action 从 $type 推出来', () => {
		const result = fromRaw('only-default', {
			sections: { what: { label: '做什么', default: { $type: 'markdown' } } },
		});
		assert.equal('template' in result, true);
		if ('template' in result) {
			assert.equal(result.template.sections[0]?.action, 'markdown');
		}
	});

	it('两者都空 ⇒ action 回落 text（这是既有行为，不变）', () => {
		const result = fromRaw('neither', { sections: { what: { label: '做什么' } } });
		assert.equal('template' in result, true);
		if ('template' in result) {
			assert.equal(result.template.sections[0]?.action, 'text');
		}
	});

	it('⚠ 加载错误进 errors()，注册表照样可用（一个坏文件不该拖垮整体）', () => {
		/*
		 * 用户： 「如果他出错了，core 可以继续开。」
		 *
		 * ## 为什么不再写盘
		 *
		 * 原来这条测试往临时目录里写 good.yaml + bad.yaml 再 `loadDirectory`。
		 * `loadDirectory` 已删（用户 2026-11-23：「外来的包原则上不该挤进去这个放配置的地方」）
		 * ⇒ 外部无法再塞文件。但**语义没变**：错误和注册是两条独立的通路。
		 *
		 * 现在钉的是注册表这一层的契约：`setErrors` 存下失败、`registerAll` 照常成功，
		 * 两者互不影响。
		 */
		const registry = new TemplateRegistry();

		const good = fromRaw('good', {
			sections: { a: { label: 'A', action: 'text', default: { $type: 'text' } } },
		});
		assert.equal('template' in good, true, '构造好的模板应该解析成功');
		if (!('template' in good)) return;

		registry.registerAll([good.template]);
		registry.setErrors([{ file: '/fake/bad.yaml', message: 'YAML 解析失败：故意的' }]);

		/* 错误被记下，形状是 `{ file, message }` —— 不新造一套。 */
		const errors = registry.errors();
		assert.equal(errors.length, 1);
		const error = errors[0];
		assert.equal(typeof error?.file, 'string');
		assert.match(error?.file ?? '', /bad\.yaml/);
		assert.match(error?.message ?? '', /故意的/);
		assert.deepEqual(Object.keys(error ?? {}).sort(), ['file', 'message']);

		/* 好模板仍然可用 ⇒ 「一个坏文件不该让整个注册表不可用」。 */
		assert.deepEqual(
			registry.list().map((one) => one.ref),
			['good'],
		);
	});
});
