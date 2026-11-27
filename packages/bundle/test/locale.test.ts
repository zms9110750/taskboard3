/**
 * 四个包的 **locale 契约** —— 设置页里给用户看的名字和描述。
 *
 * ## 这个测试为什么存在（用户 `2026-11-23`）
 *
 * > 「这个包介绍和本地化名字有点糊弄」
 * > 「你要仔细描述他们的功能和职责啊。还有，怎么接入dsh的那几个包没了？
 * >   ui也是一个包也可以关掉的啊。」
 *
 * 之前实际的样子（用户对着截图骂的）：
 *
 * | 包 | title | description |
 * |---|---|---|
 * | `bundle` | 任务板 | 「有状态机和关系的任务卡……三个可独立开关的组件」|
 * | `store` | 任务板存储 | 「**存储与搜索**默认实现：SQLite 持久化 + 纯函数筛选」← 搜索早就不归它了 |
 * | `dsh` | **任务板** | 「有状态机和关系的任务卡……」← 和 bundle 第一句一字不差 |
 * | `dsh-client` | **任务板** | 「……显示为右侧工作区的一个标签页」← 只说了一处入口，实际三处 |
 *
 * ⇒ 三个 title 和父级同名，设置页里分不清层级；两条描述是同一句话说两遍；
 *   一条描述在讲早就不归它管的职责。
 *
 * ## 下面钉住什么
 *
 * 1. **四份 zh + 四份 en 都能解析，`meta.title` / `meta.description` 非空**
 * 2. **三个子包的 title 不和 `bundle` 相同**（防回退成「都叫任务板」）
 * 3. **title 互不相同**（四个 title 两两不等）
 * 4. **description 有实质内容**（中文 ≥ 150 字符 / 英文 ≥ 400 字符 ——
 *    用户要的是「仔细描述功能和职责」，一句话糊弄过不了这一关）
 * 5. **zh 和 en 的 title 不同**（防中文版没翻，或英文版没写）
 * 6. **`store` 的描述不许把「搜索」写成自己的职责**
 *    （它自己的源码注释就写着「不要因为本包曾经也 provide 搜索就以为它还管搜索」）
 * 7. **`dsh-client` 的描述必须提到三处入口**（左侧栏 / 抽屉 / 右侧工作区），
 *    否则就是回到「只说一处」那个错误
 *
 * ## 为什么直接读 JSON，不 import
 *
 * 这些是**给 DSH 读的资源文件**，不是源码模块 —— 用 `readFileSync` 读它们，
 * 才是 DSH 真正的读法（`exports["./locale/*.json"]`）。
 * import 一份 JSON 会绕过打包路径，测的就不是发布形态。
 */

// TODO(审查): 文件头与 describe 里仍写「四个包」，但参与装配的是 6 行 + 壳（7 个包）。
//   dsh-core / dsh-tools / dsh-agent-guard 未纳入（lead 答复：core/guard 没有 locale，系推断、未逐一验证 ⇒
//   设置页只有包名/默认图回退）；可直接改注释与 PACKAGES。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

// TODO(审查): 本测试替 store / dsh / dsh-client 立 locale 契约（跨包耦合）：那三个包改文案或搬目录
//   会让 bundle 的测试变红，而 bundle 自己没坏。建议 bundle 只测自己的 locale，跨包标题唯一性等规则
//   移到仓库根 test/。可直接改，属测试归属调整。
/** 仓库根 —— 从本测试文件位置反推（`packages/bundle/test/` → 根）。 */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// TODO(审查): PACKAGES 只列 4 个，实际 6 行里的 dsh-core / dsh-tools / dsh-agent-guard 未覆盖。
//   建议改成从 bundle 的 cordis.patch.yml 读取行（用 yaml 解析），只对有 locale 的包断言 —— 单一事实源。
//   直接改测试即可，但「无 locale 的包是否该有 locale」需产品决定。
/** 带 locale 的包（dsh-permissions 2026-11-27 加入，同受本契约约束）。 */
const PACKAGES = ['bundle', 'store', 'dsh', 'dsh-client', 'dsh-permissions'] as const;

/** 语言。 */
const LANGS = ['zh', 'en'] as const;

type Pkg = (typeof PACKAGES)[number];
type Lang = (typeof LANGS)[number];

/**
 * 读一个包的 locale。
 *
 * @param pkg 包目录名
 * @param lang 语言
 * @returns 解析后的 JSON
 */
function localeOf(pkg: Pkg, lang: Lang): { meta?: { title?: string; description?: string } } {
	const path = join(REPO_ROOT, 'packages', pkg, 'locale', `${lang}.json`);
	return JSON.parse(readFileSync(path, 'utf8')) as { meta?: { title?: string; description?: string } };
}

/** 某个包的标题（中文）。 */
function titleOf(pkg: Pkg, lang: Lang = 'zh'): string {
	return localeOf(pkg, lang).meta?.title ?? '';
}

/** 某个包的描述（中文）。 */
function descriptionOf(pkg: Pkg, lang: Lang = 'zh'): string {
	return localeOf(pkg, lang).meta?.description ?? '';
}

describe('locale 契约（设置页里给用户看的名字和描述）', () => {
	it('四份 zh + 四份 en 都存在，title / description 非空', () => {
		for (const pkg of PACKAGES) {
			for (const lang of LANGS) {
				const locale = localeOf(pkg, lang);
				assert.ok(
					(locale.meta?.title ?? '').length > 0,
					`${pkg}/${lang}.json 缺 meta.title`,
				);
				assert.ok(
					(locale.meta?.description ?? '').length > 0,
					`${pkg}/${lang}.json 缺 meta.description`,
				);
			}
		}
	});

	it('⭐ 三个子包的 title 不和父级（bundle）相同', () => {
		const parent = titleOf('bundle');
		for (const pkg of ['store', 'dsh', 'dsh-client'] as const) {
			assert.notEqual(
				titleOf(pkg),
				parent,
				`⚠ ${pkg} 的 title 和 bundle 一样都是「${parent}」—— ` +
					'设置页里四张卡片分不清哪个是壳、哪个是组件。' +
					'（用户 2026-11-23 就是对着这个骂的）',
			);
		}
	});

	it('⭐ 四个 title 两两不同（中文）', () => {
		const titles = PACKAGES.map((pkg) => titleOf(pkg));
		assert.equal(
			new Set(titles).size,
			titles.length,
			`四个 title 有重复：${JSON.stringify(titles)}`,
		);
	});

	it('⭐ 四个 title 两两不同（英文）', () => {
		const titles = PACKAGES.map((pkg) => titleOf(pkg, 'en'));
		assert.equal(
			new Set(titles).size,
			titles.length,
			`英文 title 有重复：${JSON.stringify(titles)}`,
		);
	});

	// TODO(审查): 150/400 字符阈值无测量依据（AGENTS 3.8），断言的是「字数」而不是「说清职责」，会逼人灌水；
	//   建议改成必须出现具体事实（入口 / 关掉后果 / 不负责的边界），只保留「不是一句话」的下限。
	//   可直接改测试；改判据属设计决定。
	it('⭐ description 有实质内容（不是一句话糊弄）', () => {
		for (const pkg of PACKAGES) {
			const zh = descriptionOf(pkg).length;
			const en = descriptionOf(pkg, 'en').length;
			assert.ok(
				zh >= 150,
				`${pkg} 的中文描述只有 ${String(zh)} 字符 —— 用户要的「仔细描述功能和职责」一句话做不到`,
			);
			assert.ok(en >= 400, `${pkg} 的英文描述只有 ${String(en)} 字符，太短`);
		}
	});

	// TODO(审查): 强制 zh/en title 不同断言的是手段不是行为：品牌词/专有名词本不该翻译，这条会逼人制造
	//   错误翻译；DSH 只要求英文 sentence case、专有名词保留（host-plugin.md:33）。是否保留需用户决定。
	it('zh 和 en 的 title 不同（防漏翻）', () => {
		for (const pkg of PACKAGES) {
			assert.notEqual(
				titleOf(pkg),
				titleOf(pkg, 'en'),
				`${pkg} 的 zh / en title 相同（「${titleOf(pkg)}」）—— 一边没翻`,
			);
		}
	});

	it('⭐ store 的描述不许把「搜索」写成自己的职责', () => {
		const zh = descriptionOf('store');
		/*
		 * 允许出现「搜索」—— 但要是否定式（「搜索不在这里」）。
		 * 禁止的是「存储与搜索默认实现」这种把搜索算成自己活的说法。
		 */
		// TODO(审查): 该正则在否定句上误报 ——「存储与搜索不在这里」里「存储/与/搜索」间隔 0 字符会命中
		//   claimsSearch，而上面的注释说否定式是允许的。应收窄成只匹配肯定句式（如「提供/负责…搜索」），
		//   或改人工评审；可直接改测试。
		const claimsSearch =
			/(存储|持久化)[^。]{0,12}(与|和|及)[^。]{0,6}搜索/.test(zh) ||
			/搜索[^。]{0,8}(默认实现|由本包|在这里提供)/.test(zh);
		assert.equal(
			claimsSearch,
			false,
			`⚠ store 的描述把「搜索」算成自己的职责了。它自己的源码注释写着：` +
				'「不要因为本包曾经也 provide 搜索就以为它还管搜索 —— 它不管了。」',
		);
	});

	// TODO(审查): 钉死「左侧栏 / 抽屉 / 右侧工作区」三个词：UI 形态会变（AGENTS 记录过折叠/取消折栏等），
	//   届时仍正确的描述会误红。建议改成「至少提到一个真实入口」，或把这条契约交给 dsh-client 自己。
	it('⭐ dsh-client 的描述必须提到三处入口', () => {
		const zh = descriptionOf('dsh-client');
		assert.ok(zh.includes('左侧栏'), '没提左侧栏入口');
		assert.ok(zh.includes('抽屉'), '没提抽屉入口');
		assert.ok(zh.includes('右侧工作区'), '没提右侧工作区入口');
	});

	it('⭐ dsh 的描述要说明它是宿主侧（不是整个任务板）', () => {
		const zh = descriptionOf('dsh');
		assert.ok(
			/宿主|Host|HTTP|AI|工具/.test(zh),
			'dsh 的描述看不出它是「宿主侧」那一半',
		);
	});

	it('⭐ 每个描述都说了「关掉它会怎样」', () => {
		for (const pkg of PACKAGES) {
			const zh = descriptionOf(pkg);
			// TODO(审查): 只认「关掉|卸载|不激活|消失|还在」—— 更标准的「关闭」不命中，正确文案会红；
			//   可直接扩词，或改成对「关掉后果」的语义断言。
			assert.ok(
				/关掉|卸载|不激活|消失|还在/.test(zh),
				`${pkg} 的描述没说关掉它会怎样 —— 四行都是可独立开关的，用户关心这个`,
			);
		}
	});
});
