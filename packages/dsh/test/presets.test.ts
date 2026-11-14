/**
 * 三个权限预设的注册 —— **这条与 core 的 `BOARD_PRESETS` 必须严格对齐**。
 *
 * ## 为什么这组测试是安全边界
 *
 * 预设表是用户在下拉栏里选的东西。它和 core 的 `BOARD_PRESETS` 一旦漂移，
 * 后果是**静默的**：
 *
 * | 漂移 | 表现 |
 * |---|---|
 * | dsh 少注册一个 | 用户选不到那个档 ⇒ 那个模式实际上不可用 |
 * | dsh 多注册一个 | guard 的 `boardModeOf` 认不出 ⇒ `mode === undefined` ⇒ **一律放行** —— 一个看得见但**不设防**的档位 |
 * | `mode` 对不上 | 选「计划」实际按「工作」判 ⇒ 权限比预期宽 |
 * | `label` / `name` 写反 | 下拉栏显示 `taskboard-plan` 这种机器名 |
 *
 * ⇒ 每条都要有断言。**多注册一个是最危险的**（不报错、看得见、不设防）。
 *
 * ## ⚠ 这个文件不 import `@deepseek-ai/*`
 *
 * 用假的预设表替身测 `installBoardPresets` 的**行为**（写了哪些键、
 * 卸载还原了什么、事件发了几次），而不是测 DSH 的预设服务。
 * 真正的服务行为由 DSH 自己保证。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BOARD_PRESETS, boardModeOf, type BoardPreset } from '@taskboard/core';

import { installBoardPresets, presetSpecOf, type PresetSpecLike } from '../src/presets.ts';

/* ────────────────────────────── 替身 ────────────────────────────── */

/** 假预设表 + 事件计数器。 */
function fakeTarget(initial: Record<string, PresetSpecLike> = {}): {
	readonly target: { presets: Record<string, PresetSpecLike> };
	readonly events: () => number;
	readonly notify: () => void;
} {
	const presets: Record<string, PresetSpecLike> = { ...initial };
	let events = 0;
	return {
		target: { presets },
		events: () => events,
		notify: () => {
			events += 1;
		},
	};
}

/** 一个测试用的预设（不走 core 的表）。 */
function samplePreset(name: string, mode: 'plan' | 'work' | 'auto'): BoardPreset {
	return {
		name,
		mode,
		label: `${name} 的显示名`,
		description: `${name} 的说明`,
		sandbox: 'read-only',
		approval: 'ask',
	};
}

/* ────────────────────────── 与 core 对齐 ────────────────────────── */

describe('BOARD_PRESETS（core 的契约）', () => {
	it('恰好三个，模式各不相同', () => {
		assert.equal(BOARD_PRESETS.length, 3, '用户裁定：只留三个权限');
		assert.deepEqual(
			BOARD_PRESETS.map((one) => one.mode).sort(),
			['auto', 'plan', 'work'],
			'三个模式必须齐',
		);
	});

	it('预设名唯一，且都能反查回同一个 mode', () => {
		const names = BOARD_PRESETS.map((one) => one.name);
		assert.equal(new Set(names).size, names.length, '预设名不能重复');
		for (const preset of BOARD_PRESETS) {
			assert.equal(boardModeOf(preset.name), preset.mode, `「${preset.name}」反查 mode 应一致`);
		}
	});

	it('不是任务板的预设名 ⇒ undefined（互斥语义）', () => {
		for (const name of ['danger-full-access', 'workspace-write', 'no-tools', 'custom', '']) {
			assert.equal(boardModeOf(name), undefined, `「${name}」不是我们的预设`);
		}
		assert.equal(boardModeOf(undefined), undefined);
	});
});

/* ────────────────────────── 注册行为 ────────────────────────── */

describe('installBoardPresets', () => {
	it('⚠ 把 core 的**三个**预设全部注册进去，不多不少', () => {
		const fake = fakeTarget();
		const install = installBoardPresets(fake.target, fake.notify, BOARD_PRESETS);

		const registered = install.names;
		assert.deepEqual([...registered].sort(), BOARD_PRESETS.map((one) => one.name).sort());

		/* 表里必须真的出现这三个键。 */
		for (const preset of BOARD_PRESETS) {
			assert.notEqual(fake.target.presets[preset.name], undefined, `「${preset.name}」该在表里`);
		}

		/* ⚠ 不能多注册：多出来的档位是「看得见但不设防」。 */
		const extra = Object.keys(fake.target.presets).filter(
			(name) => !BOARD_PRESETS.some((one) => one.name === name),
		);
		assert.deepEqual(extra, [], `不该注册 BOARD_PRESETS 以外的档位：${JSON.stringify(extra)}`);
	});

	it('⚠ name / label 不能写反（写反了下拉栏显示机器名）', () => {
		const fake = fakeTarget();
		installBoardPresets(fake.target, fake.notify, BOARD_PRESETS);

		for (const preset of BOARD_PRESETS) {
			const spec = fake.target.presets[preset.name];
			assert.notEqual(spec, undefined);
			if (spec === undefined) continue;
			assert.equal(spec.name, preset.label, '表项的 name 应该是人可读的 label');
			assert.notEqual(spec.name, preset.name, '表项的 name 不该是机器名');
			assert.equal(spec.description, preset.description);
			assert.equal(spec.sandbox, preset.sandbox);
			assert.equal(spec.approval, preset.approval);
		}
	});

	it('注册后发一次 catalog-changed（否则下拉栏看不到）', () => {
		const fake = fakeTarget();
		installBoardPresets(fake.target, fake.notify, BOARD_PRESETS);
		assert.equal(fake.events(), 1, '注册后应恰好发一次目录变更');
	});

	it('不动无关的档位（别的插件注册的）', () => {
		const foreign: PresetSpecLike = {
			sandbox: 'read-only',
			approval: 'never',
			name: '工具全关',
			description: '别的插件的档位',
		};
		const fake = fakeTarget({ 'no-tools': foreign, 'danger-full-access': { ...foreign, name: '完全访问' } });
		installBoardPresets(fake.target, fake.notify, BOARD_PRESETS);

		assert.deepEqual(fake.target.presets['no-tools'], foreign, '别人的档位不该被改');
		assert.equal(fake.target.presets['danger-full-access']?.name, '完全访问');
	});

	/* ── 卸载 ── */

	it('⚠ 卸载只删自己写的键，不留残留', () => {
		const fake = fakeTarget();
		const install = installBoardPresets(fake.target, fake.notify, BOARD_PRESETS);
		install.dispose();

		for (const preset of BOARD_PRESETS) {
			assert.equal(fake.target.presets[preset.name], undefined, `「${preset.name}」该被删掉`);
		}
	});

	it('⚠ 卸载时发第二次 catalog-changed（否则菜单上还挂着）', () => {
		const fake = fakeTarget();
		const install = installBoardPresets(fake.target, fake.notify, BOARD_PRESETS);
		install.dispose();
		assert.equal(fake.events(), 2, '注册 + 卸载各一次');
	});

	it('⚠ 我们挂载前就存在的同名档位 ⇒ 卸载时还原成原值（不是删掉）', () => {
		const previous: PresetSpecLike = {
			sandbox: 'workspace-write',
			approval: 'ask',
			name: '别人先注册的同名档',
			description: '不该被我们吞掉',
		};
		const fake = fakeTarget({ 'taskboard-plan': previous });
		const install = installBoardPresets(fake.target, fake.notify, BOARD_PRESETS);

		/* 挂载期间被我们覆盖。 */
		assert.equal(fake.target.presets['taskboard-plan']?.name, BOARD_PRESETS.find((one) => one.name === 'taskboard-plan')?.label);

		install.dispose();
		assert.deepEqual(fake.target.presets['taskboard-plan'], previous, '卸载应还原原值');
	});

	it('⚠ 卸载不整表替换 —— 挂载期间别的插件加的档位必须还在', () => {
		const fake = fakeTarget();
		const install = installBoardPresets(fake.target, fake.notify, BOARD_PRESETS);

		/* 模拟「我们挂载期间别的插件注册了一个档位」。 */
		const late: PresetSpecLike = {
			sandbox: 'read-only',
			approval: 'never',
			name: '后来者的档',
			description: '',
		};
		fake.target.presets['late-comer'] = late;

		install.dispose();

		assert.deepEqual(fake.target.presets['late-comer'], late, '不该回滚别人的工作');
	});

	it('卸载幂等（调两次不发第二次事件）', () => {
		const fake = fakeTarget();
		const install = installBoardPresets(fake.target, fake.notify, BOARD_PRESETS);
		install.dispose();
		install.dispose();
		assert.equal(fake.events(), 2, '第二次卸载不该再发事件');
	});

	it('可以注入自定义预设（测试用，不依赖 core 的表）', () => {
		const fake = fakeTarget();
		const install = installBoardPresets(fake.target, fake.notify, [samplePreset('my-plan', 'plan')]);
		assert.deepEqual(install.names, ['my-plan']);
		assert.equal(fake.target.presets['my-plan']?.name, 'my-plan 的显示名');
		install.dispose();
		assert.equal(fake.target.presets['my-plan'], undefined);
	});
});

/* ────────────────────────── 单项映射 ────────────────────────── */

describe('presetSpecOf', () => {
	it('core 的 name 是表键、label 是显示名（不能写反）', () => {
		const spec = presetSpecOf(samplePreset('x', 'work'));
		assert.equal(spec.name, 'x 的显示名');
		assert.equal(spec.sandbox, 'read-only');
		assert.equal(spec.approval, 'ask');
	});
});
