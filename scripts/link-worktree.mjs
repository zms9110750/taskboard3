/**
 * 给新建的 git worktree 接上 `node_modules`（junction 方案）—— **一条命令**。
 *
 * ⚠ 它**不是**「worktree 唯一的装依赖方式」：`corepack pnpm install`（v12+）也能装，
 * 见下面对比。
 *
 * ## 为什么需要它
 *
 * 本仓 pnpm workspace 的依赖分三层：
 *
 * ```
 * <worktree>/node_modules                                 ← 顶层（typescript / @types/node）
 * <worktree>/packages/<pkg>/node_modules                 ← 包级（@taskboard/* + 第三方）
 * <主仓>/node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg> ← 真实物理目录
 * ```
 *
 * **新 worktree 的第一层是空的**（没有 `node_modules`）。
 *
 * ⚠ **`2026-11-28` 翻案**：AGENTS.md §规则8 已改 —— 新建 worktree 里
 * `corepack pnpm install`（pnpm 12.23）实测**成功**（3 秒级）。旧禁令
 * 「worktree 里 `pnpm install` 装不上（ERR_PNPM_SYMLINK_FAILED）」是 pnpm 10 时代的事实，
 * **已不再成立**。
 *
 * ⇒ 本脚本的真实用途不是「让 worktree 能装依赖」，而是**另一条取舍**：
 * 给新 worktree 接一套指向主仓的 `node_modules` junction（不重新下载、不占磁盘；
 * 代价是共享物理目录，见下方「隐患」）。
 *
 * ### 两个选项（二选一，别混用）
 *
 * | 选项 | 做法 | 取舍 |
 * |---|---|---|
 * | **真实安装**（默认推荐） | `corepack pnpm install`（v12+） | 独立 `node_modules`、不写穿主仓；要下载/占磁盘（秒级） |
 * | **本脚本（junction）** | `node scripts/link-worktree.mjs <worktree>` | 复用主仓 `.pnpm` 的物理目录，省下载与磁盘；共享目录要按只读对待，且主仓重装后 junction 会悬空（重跑本脚本） |
 *
 * ## 三条路（junction 内部的三种做法，实测只有第 3 条对）
 *
 * | 做法 | 结果 |
 * |---|---|
 * | 只建顶层 junction | ❌ `tsc -b` exit 2，112 条诊断（58×TS2307 + 2×TS2688 + 连锁 TS7006）|
 * | 包级目录**整目录** junction | ⚠️ `tsc` exit 0，但**静默借主仓的 `@taskboard/*`** ⇒ 跨 worktree 假绿 |
 * | 包级**真实目录 + 每叶子 junction** | ✅ 第三方走 `.pnpm` 真实绝对路径，`@taskboard/*` 指本 worktree |
 *
 * ### 为什么「整目录 junction」是假绿
 *
 * 主仓 `packages/<pkg>/node_modules/@taskboard/<name>` 是**混合形态**：
 *
 * ```
 * core/node_modules/@taskboard/protocol      → 绝对 junction（指主仓）
 * store/node_modules/@taskboard/core         → ..\..\..\core（相对软链）
 * dsh-client/node_modules/@taskboard/tools   → 绝对 junction（指主仓）
 * ```
 *
 * 整目录 junction 后：相对软链**碰巧**落回 worktree（目录深度相同），
 * 绝对 junction **静默指向主仓**。主仓与 worktree 同 commit 时 `tsc` 照样绿 ——
 * 但编译用的是主仓的 `.d.ts`。
 *
 * **判定方法**（30 秒可复现）：给本 worktree 的 `protocol/src/index.ts` 加一个导出，
 * 让 `core/src/index.ts` import 它，`tsc -b packages/protocol packages/core`：
 *
 * - 报 `TS2305 has no exported member` ⇒ **假绿**（编的是主仓 d.ts）
 * - 不报 ⇒ 解析正确
 *
 * ## 用法
 *
 * ```powershell
 * # 从主仓跑，参数 = 目标 worktree 绝对路径
 * node scripts/link-worktree.mjs X:\temp\dsh\开发\tb3-css-e
 *
 * # 默认参数 = 当前目录（在 worktree 里直接跑）
 * node scripts/link-worktree.mjs
 *
 * # 只验证，不建链接
 * node scripts/link-worktree.mjs --verify
 * ```
 *
 * ## 隐患（会悄悄失效的地方）
 *
 * 1. **`.pnpm` 目录名带版本 + peer 后缀 + 哈希**（`tsdown@0.23.7_@tsdown+css@0.23.7_typescript@5.9.3`）。
 *    主仓 `pnpm install` 后路径就变了 ⇒ junction 变悬空 ⇒ 症状是「昨天还绿，今天 TS2307」。
 *    **对策：重跑本脚本。**
 * 2. **写穿风险**：`packages/<pkg>/node_modules/<第三方>` 是主仓 `.pnpm` 的**同一份物理目录**。
 *    任何往里写文件的操作会污染所有 worktree ⇒ **按只读对待**。
 * 3. **清理一律用 `cmd /c rmdir`**（只删链接）。绝不能用 `rm -rf` / `rsync --delete`，
 *    那会顺着 junction 删到主仓内容。
 * 4. **接了 junction 的 worktree 不要再跑 `pnpm install`**：那属于上面的「真实安装」选项，
 *    两者混用会留下 junction 与 `.pnpm` 安装结果并存的目录（后果未实测）。
 *    要换成真实安装：先用 `cmd /c rmdir` 删掉本脚本建的 junction，再 `corepack pnpm install`。
 * 5. **必须先 `tsc -b` 再跑全仓测试**：`@taskboard/*` 指本 worktree 的包目录 ⇒
 *    Node 走 `package.json` 的 `exports` → `lib/`。忘了构建 = 测上一次的 lib（假绿）。
 * 6. **Windows only**（`mklink /J`）。换平台要改成 `symlinkSync(target, link, 'dir')`。
 */

import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 从本脚本位置反推主仓根（脚本在 <主仓>/scripts/ 下）。 */
const MAIN = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* ── 参数 ── */

const argv = process.argv.slice(2);
const VERIFY_ONLY = argv.includes('--verify');
const WT_ARG = argv.find((one) => !one.startsWith('--'));
const WT = resolve(WT_ARG ?? process.cwd());

/* ══════════════════════════════════════════════════════════
   Windows junction 原语
   ══════════════════════════════════════════════════════════ */

/**
 * 判断路径上「有东西」（**包括悬空 junction**）。
 *
 * ⚠ **不能用 `existsSync`**：它顺着链接看目标，目标没了就返回 false，
 *   但链接本身真实占了路径位置。用 `lstatSync` 只看链接本身。
 *
 * @param path 要检查的路径
 */
function present(path) {
	try {
		lstatSync(path);
		return true;
	} catch {
		return false;
	}
}

/**
 * 拆掉一个 junction（**只删链接，不删目标**）。
 *
 * @param path junction 路径
 */
function unlinkJunction(path) {
	if (!present(path)) return;
	/* rmdir 对 junction 只移除链接本身。绝不用 rmSync —— 会穿透到目标。 */
	execFileSync('cmd', ['/c', 'rmdir', path], { stdio: 'ignore' });
}

/**
 * 建一个 junction。
 *
 * ⚠ 目标必须是 `realpathSync` 解析后的**绝对真实路径** ——
 *   主仓里的第三方包是相对软链（`..\..\..\node_modules\.pnpm\...`），
 *   直接把那个相对路径当目标，解析基准会变成 worktree 路径 ⇒ 找不到。
 *
 * @param link 链接路径
 * @param target 目标（绝对真实路径）
 */
function junction(link, target) {
	mkdirSync(dirname(link), { recursive: true });
	execFileSync('cmd', ['/c', 'mklink', '/J', link, target], { stdio: 'ignore' });
}

/* ══════════════════════════════════════════════════════════
   枚举
   ══════════════════════════════════════════════════════════ */

/**
 * 本仓有哪些包（不硬编码 —— 以后加包自动跟上）。
 *
 * @returns 包目录名数组
 */
function packageNames() {
	const dir = join(WT, 'packages');
	if (!existsSync(dir)) throw new Error(`包目录不存在：${dir}`);
	return readdirSync(dir).filter((name) => existsSync(join(dir, name, 'package.json')));
}

/**
 * 主仓某包 `node_modules` 里的每一项，解析成**真实绝对路径**。
 *
 * @param pkg 包目录名
 * @returns `{ rel, real }` 数组；`rel` 是相对路径（如 `@taskboard/core`）
 */
function realEntries(pkg) {
	const dir = join(MAIN, 'packages', pkg, 'node_modules');
	if (!existsSync(dir)) return [];

	const out = [];
	for (const entry of readdirSync(dir)) {
		/* `.bin` 里的 shim 是相对软链，跳过（测试不 spawn bin） */
		if (entry === '.bin') continue;

		if (entry.startsWith('@')) {
			const scopeDir = join(dir, entry);
			if (!lstatSync(scopeDir).isDirectory()) continue;
			for (const leaf of readdirSync(scopeDir)) {
				out.push({ rel: `${entry}/${leaf}`, real: realpathSync(join(scopeDir, leaf)) });
			}
			continue;
		}
		out.push({ rel: entry, real: realpathSync(join(dir, entry)) });
	}
	return out;
}

/* ══════════════════════════════════════════════════════════
   建链接
   ══════════════════════════════════════════════════════════ */

/** 建了多少个 junction。 */
let linked = 0;

/**
 * 处理一个包的 `node_modules`。
 *
 * @param pkg 包目录名
 */
function linkPackage(pkg) {
	const dstDir = join(WT, 'packages', pkg, 'node_modules');
	const entries = realEntries(pkg);

	/*
	 * ⚠ 整目录 junction 的残留要先拆。
	 *
	 * 若上一次用了「整目录 junction」方案，`node_modules` 本身就是一个 junction
	 * ⇒ 往里 `mkdir` 会失败。先 rmdir（只删链接）再建真实目录。
	 */
	if (present(dstDir) && lstatSync(dstDir).isSymbolicLink()) {
		unlinkJunction(dstDir);
	}
	/* 真实目录：逐条目清掉旧链接（幂等重跑），留下的普通文件不动。 */
	mkdirSync(dstDir, { recursive: true });

	for (const { rel, real } of entries) {
		const linkPath = join(dstDir, rel);

		if (rel.startsWith('@taskboard/')) {
			/*
			 * ⚠⚠ 必须指向**本 worktree** 的兄弟包，不能指主仓 ——
			 *     否则会解析到主仓的 lib/，跨 worktree 假绿。
			 */
			const name = rel.slice('@taskboard/'.length);
			const sibling = join(WT, 'packages', name);
			if (!existsSync(join(sibling, 'package.json'))) {
				console.warn(`  ⚠ 跳过 ${pkg} -> ${rel}：本 worktree 没有 packages/${name}`);
				continue;
			}
			unlinkJunction(linkPath);
			junction(linkPath, sibling);
			linked += 1;
			continue;
		}

		/* 第三方包：指向主仓 .pnpm 的真实绝对路径（只读共享）。 */
		unlinkJunction(linkPath);
		junction(linkPath, real);
		linked += 1;
	}
}

/* ══════════════════════════════════════════════════════════
   验证
   ══════════════════════════════════════════════════════════ */

/**
 * 读一个 junction 指向哪里。
 *
 * @param path junction 路径
 * @returns 目标绝对路径；不是链接时返回 `undefined`
 */
function readLink(path) {
	try {
		if (!lstatSync(path).isSymbolicLink()) return undefined;
		return realpathSync(path);
	} catch {
		return undefined;
	}
}

/**
 * 验证依赖是否真的解析到本 worktree。
 *
 * ## 两条独立的判据（缺一不可）
 *
 * 1. **链接目标**：`@taskboard/*` 的 junction 必须直接指向 `<本worktree>/packages/<name>`。
 *    这条**不依赖 `lib/` 是否存在**，所以刚建完就能验。
 * 2. **模块解析**：`createRequire().resolve()` 的 realpath 必须落在 `<本worktree>/packages/<name>`
 *    下 —— 能解析也可能是解析到主仓，那是假绿。这条**要求先 `tsc -b`**（`lib/` 要存在）。
 *
 * @returns 失败项（空 = 全过）
 */
async function verify() {
	const { createRequire } = await import('node:module');

	const problems = [];
	const notes = [];
	const packages = packageNames();

	for (const pkg of packages) {
		const pkgJson = join(WT, 'packages', pkg, 'package.json');
		const req = createRequire(pkgJson);

		for (const { rel } of realEntries(pkg)) {
			if (!rel.startsWith('@taskboard/')) continue;

			const name = rel.slice('@taskboard/'.length);
			const want = join(WT, 'packages', name);
			const linkPath = join(WT, 'packages', pkg, 'node_modules', rel);

			/* ── 判据 1：链接目标（不需要构建） ── */
			const target = readLink(linkPath);
			if (target === undefined) {
				problems.push(`${pkg} -> ${rel}：不是 junction（或不存在）`);
				continue;
			}
			if (target !== realpathSync(want)) {
				problems.push(`${pkg} -> ${rel}：指向 ${target}（应指向 ${want}）`);
				continue;
			}

			/* ── 判据 2：模块解析（需要 lib/） ── */
			let resolved;
			try {
				resolved = realpathSync(req.resolve(rel));
			} catch {
				/* 链接对，但 lib/ 还没构建 —— 不是链接问题，是「还没 tsc -b」。 */
				notes.push(`${pkg} -> ${rel}：链接正确，但 lib/ 未构建（先跑 tsc -b）`);
				continue;
			}
			if (!resolved.startsWith(want)) {
				problems.push(`${pkg} -> ${rel}：解析到 ${resolved}（应在 ${want} 下）`);
			}
		}
	}

	/* 顶层 typescript 必须能解析（tsc 靠它）。 */
	try {
		const req = createRequire(join(WT, 'package.json'));
		realpathSync(req.resolve('typescript'));
	} catch {
		problems.push('顶层 typescript 解析失败（顶层 node_modules junction 没建？）');
	}

	return { problems, notes };
}

/* ══════════════════════════════════════════════════════════
   主流程
   ══════════════════════════════════════════════════════════ */

if (WT === MAIN) {
	console.error('目标就是主仓，不需要接依赖。传一个 worktree 路径。');
	process.exit(1);
}

console.log(`主仓：${MAIN}`);
console.log(`目标：${WT}`);
console.log('');

if (VERIFY_ONLY) {
	const { problems, notes } = await verify();
	for (const one of notes) console.warn(`⚠ ${one}`);
	if (problems.length === 0) {
		console.log('✅ 依赖解析正确（全部指向本 worktree）');
		process.exit(0);
	}
	console.error('❌ 依赖有问题：');
	for (const one of problems) console.error(`   ${one}`);
	process.exit(1);
}

/* 顶层：整目录 junction 到主仓 node_modules（只需 typescript / @types/node）。 */
const topLink = join(WT, 'node_modules');
if (present(topLink) && lstatSync(topLink).isSymbolicLink()) {
	/* 已经是 junction，幂等跳过。 */
} else if (present(topLink)) {
	console.warn(`⚠ ${topLink} 是真实目录（不是 junction），跳过 ${''}`);
} else {
	junction(topLink, join(MAIN, 'node_modules'));
	linked += 1;
	console.log('顶层 node_modules -> 主仓');
}

/* 包级：真实目录 + 每叶子 junction。 */
for (const pkg of packageNames()) {
	const before = linked;
	linkPackage(pkg);
	console.log(`${pkg}: ${String(linked - before)} 个 junction`);
}

console.log('');
console.log(`✅ 共建 ${String(linked)} 个 junction`);

/* 建完立刻验，不信「exit 0 就是成功」。 */
const { problems, notes } = await verify();
for (const one of notes) console.warn(`⚠ ${one}`);
if (problems.length > 0) {
	console.error('❌ 建完了但验证不过：');
	for (const one of problems) console.error(`   ${one}`);
	process.exit(1);
}
console.log('✅ 验证通过（@taskboard/* 全部指向本 worktree）');
