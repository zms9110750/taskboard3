/**
 * 内置模板的**加载契约** —— 用户 `2026-11-23` 的裁决落成断言。
 *
 * ## 用户原话（逐字）
 *
 * > 「模板的读取不是 io。而是配置。跟随包的。只在包里面。换句话说这些 yaml 字符串
 * >   相当于启动时就要加载。因为他们还有 json 到 string 的文本渲染器和 ui 渲染器。
 * >   不是一个 yaml 结束就可以了的。所谓的留接口是留注册接口。
 * >   给别人以包的形式接入。不是以文本 yaml 的形式接入。」
 *
 * > 「2 的跟随包，只在包里。意思是。插件肯定能拿到插件路径。然后这个分发出去的
 * >   包里的 yaml，在包里的相对路径是常量。所以用这个路径加载包里的 yaml。
 * >   也就是说，外来的包原则上不该挤进去这个放配置的地方。」
 *
 * ## 这个测试钉住四条
 *
 * 1. **18 个全部加载，零错误** —— 内容一字未改
 * 2. **YAML 文件留在包里** —— `packages/core/templates/` 真的存在且被读
 * 3. **路径由包自己解析** —— `@taskboard/dsh` 不再知道模板目录（独立测）
 * 4. **外部没有「给个目录」的入口** —— `loadDirectory` 已从公开 API 消失
 *
 * ## 为什么不测「读了几次磁盘」
 *
 * 那是在断言**实现手段**。用户要的行为是「启动时就加载」——
 * 表现是「`createTaskboard()` 之后 `listTemplates()` 立刻有 18 个」，
 * 而**不是**「读文件的次数 = 1」。前者是契约，后者是优化。
 */

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { builtinTemplateErrors, builtinTemplates } from '../src/template/builtin.ts';
import { TemplateRegistry } from '../src/template/registry.ts';

/** 本包根目录 —— 从源文件位置推，不走 cwd。 */
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 期望的模板数量。改模板就改这个数字。 */
const EXPECTED_COUNT = 18;

/**
 * 每个模板的 sections 数量 —— 在 main（`d860a94`）上量过的**基线快照**。
 *
 * ⚠ 这是「内容没漂」的守卫。改了模板的章节数是产品决策，
 *   那就要同时改这里 —— 让「不小心改坏」变成测试失败。
 */
const SECTION_COUNTS: Readonly<Record<string, number>> = {
	architecture: 4,
	archive: 2,
	blocker: 2,
	decision: 3,
	delivery: 3,
	demo: 4,
	expectedMismatch: 6,
	interfaceUi: 4,
	lowLevel: 3,
	newFeature: 4,
	optimize: 2,
	question: 2,
	research: 4,
	retro: 3,
	userNeed: 1,
	verify: 3,
	writeCode: 2,
	writeTests: 4,
};

/** 三个模板的 derive 条数（抽样的语义守卫）。 */
const DERIVE_COUNTS: Readonly<Record<string, number>> = {
	architecture: 4,
	demo: 1,
	writeTests: 4,
};

describe('内置模板：随包配置，启动加载', () => {
	const templates = builtinTemplates();
	const errors = builtinTemplateErrors();

	it(`${EXPECTED_COUNT} 个模板全部加载，零错误`, () => {
		assert.deepEqual(
			errors.map((one) => `${one.file}: ${one.message}`),
			[],
			'有模板加载失败',
		);
		assert.equal(templates.length, EXPECTED_COUNT);
	});

	it('⭐ YAML 文件仍在包里（不是嵌进 .ts 常量）', () => {
		/*
		 * 用户：「跟随包的。只在包里面。」
		 *
		 * 这条钉住「YAML 是唯一真值」—— 如果哪天有人把模板挪进 TS 常量，
		 * 这个目录就不存在了，测试会红，逼着重新讨论。
		 */
		assert.equal(
			existsSync(join(PACKAGE_ROOT, 'templates')),
			true,
			`模板目录不存在：${join(PACKAGE_ROOT, 'templates')}`,
		);
		assert.equal(
			existsSync(join(PACKAGE_ROOT, 'templates', 'writeCode.yaml')),
			true,
			'writeCode.yaml 不在 templates/ 里',
		);
	});

	it('⭐ 每个模板的 sections 数量与基线一致（内容没漂）', () => {
		for (const template of templates) {
			const expected = SECTION_COUNTS[template.ref];
			assert.notEqual(expected, undefined, `基线里没有模板「${template.ref}」的记录`);
			assert.equal(
				template.sections.length,
				expected,
				`模板「${template.ref}」的章节数变了：期望 ${String(expected)}，实际 ${String(template.sections.length)}`,
			);
		}
	});

	it('⭐ 抽样模板的 derive 条数与基线一致', () => {
		for (const [ref, expected] of Object.entries(DERIVE_COUNTS)) {
			const found = templates.find((one) => one.ref === ref);
			assert.notEqual(found, undefined, `找不到模板「${ref}」`);
			assert.equal(
				found?.derives.length,
				expected,
				`模板「${ref}」的 derive 条数变了：期望 ${String(expected)}，实际 ${String(found?.derives.length)}`,
			);
		}
	});

	it('⭐ 两个抽样模板的章节 key 与基线一致', () => {
		const architecture = templates.find((one) => one.ref === 'architecture');
		assert.deepEqual(
			architecture?.sections.map((one) => one.id),
			['architecture', 'packages', 'nonGoal', 'check'],
		);

		const demo = templates.find((one) => one.ref === 'demo');
		assert.deepEqual(
			demo?.sections.map((one) => one.id),
			['idea', 'demo', 'boundary', 'confirm'],
		);
	});

	it('⚠ 公开 API 里**没有** loadDirectory（外部不能塞目录）', () => {
		/*
		 * 用户：「外来的包原则上不该挤进去这个放配置的地方。」
		 *
		 * ⇒ 注册表只能「收 TemplateDef」，不能「收一个目录」。
		 *   这条钉住那条路没有被悄悄加回来。
		 */
		const registry = new TemplateRegistry() as unknown as Record<string, unknown>;
		assert.equal(
			'loadDirectory' in registry,
			false,
			'loadDirectory 不该出现在注册表上 —— 用户明确否掉了「以文本 yaml 形式接入」',
		);
	});

	it('⭐ 注册表接着包形式接入（registerAll）', () => {
		const registry = new TemplateRegistry();
		const dispose = registry.register(templates[0]!);
		assert.equal(registry.has(templates[0]!.ref), true);
		dispose();
		assert.equal(registry.has(templates[0]!.ref), false, '注销后应当消失');

		/* 批量注册（包形式接入的主入口）。 */
		const bulk = new TemplateRegistry();
		bulk.registerAll(templates);
		assert.equal(bulk.list().length, EXPECTED_COUNT);
	});
});
