/**
 * 卡的「内容 JSON」路径替换 —— **纯函数**。
 *
 * ## 这里说的「内容 JSON」是什么（用户 `2026-11-21` 裁定）
 *
 * > 「查看 JSON，自然是看模板内的 JSON。模板的架构就是 key，表示章节。
 * >   然后里面就是 action。」
 *
 * ⇒ 卡的原始结构 = `{ [sectionKey]: actionPayload }`：
 *
 * ```
 * {
 *   "what":   { "$type": "text", "value": "要写什么" },
 *   "magic":  { "$type": "text", "value": "拍脑袋决定的东西" }
 * }
 * ```
 *
 * **不含** title / status / history / relations / note —— 那些是卡的元数据，
 * 不是「模板内的 JSON」。所以按路径替换**天然只能改内容**，碰不到状态机、
 * 持有者、历史、未读标记这些不变量。这是本模块只处理 section map 的原因。
 *
 * ## 路径语法：JSON Pointer（RFC 6901）+ 两个便利
 *
 * - 标准写法：`/what/value`；空串 `''` = **整个内容对象**（替换全部章节）；
 * - 便利 1：省略开头的 `/` 也接受（模型经常写成 `what/value`）；
 * - 便利 2：数组末尾的 `-` 表示**追加一个元素**（JSON Patch 的约定），
 *   用来实现需求里的「追加更新」。
 *
 * `~1` = `/`，`~0` = `~`（标准转义）。
 *
 * ## 纯函数的原因
 *
 * 路径解析与替换是最容易写错的一段（转义、数组下标、父级不存在、类型不匹配），
 * 把它做成纯函数就能在没有任何 I/O 的情况下穷举测试；`Taskboard` 只负责
 * 「读卡 → 调本模块 → 交回模板校验 → 落库」。
 */

import type { Card } from './card.ts';

/** JSON Pointer 解析成功。 */
export interface ContentPointerOk {
	readonly ok: true;
	readonly segments: readonly string[];
}

/** JSON Pointer 解析失败。 */
export interface ContentPointerFailure {
	readonly ok: false;
	readonly message: string;
}

/** 解析结果。 */
export type ContentPointer = ContentPointerOk | ContentPointerFailure;

/**
 * 解析一个内容路径。
 *
 * @param raw 用户/模型给的路径（`''` = 根；允许省略开头的 `/`）
 */
export function parseContentPointer(raw: string): ContentPointer {
	// TODO(审查): 整套 JSON Pointer 解析/替换可用 `json-pointer` / `fast-json-patch` 替代，少约 80 行；但本仓多了「省略开头 /」「`-` 追加」两个便利，替换须保语义（或用库解析、保留替换逻辑），需用户决定是否加依赖。
	const normalized = raw === '' || raw.startsWith('/') ? raw : `/${raw}`;
	if (normalized === '') return { ok: true, segments: [] };

	/* 去掉开头的空段（`/` → `['']` 才是「空键」，这里按标准保留）。 */
	const parts = normalized.split('/').slice(1);
	const segments: string[] = [];
	for (const part of parts) {
		const decoded = decodeSegment(part);
		if (decoded === undefined) {
			return { ok: false, message: `路径「${raw}」里有非法的 ~ 转义（标准写法：~0 = ~，~1 = /）。` };
		}
		segments.push(decoded);
	}
	return { ok: true, segments };
}

/** 解一个 JSON Pointer 段；非法返回 `undefined`。 */
function decodeSegment(part: string): string | undefined {
	/* 只允许 `~0` / `~1`；单独一个 `~` 或 `~2` 是非法路径。 */
	let out = '';
	for (let i = 0; i < part.length; i += 1) {
		const char = part[i];
		if (char !== '~') {
			out += char;
			continue;
		}
		const next = part[i + 1];
		if (next === '0') out += '~';
		else if (next === '1') out += '/';
		else return undefined;
		i += 1;
	}
	return out;
}

/**
 * 把卡的内容投影成「内容 JSON」。
 *
 * key = sectionId（与模板定义里的 `sections[].id` 对齐，模板的「架构」就是它）；
 * value = action payload。
 */
export function contentOfCard(card: Card): Record<string, unknown> {
	const content: Record<string, unknown> = {};
	for (const [sectionId, section] of Object.entries(card.sections)) {
		content[sectionId] = section.payload;
	}
	return content;
}

/** 替换成功。 */
export interface ContentReplaceOk {
	readonly ok: true;
	readonly next: Record<string, unknown>;
}

/** 替换失败。 */
export interface ContentReplaceFailure {
	readonly ok: false;
	readonly message: string;
}

/** 替换结果。 */
export type ContentReplace = ContentReplaceOk | ContentReplaceFailure;

/**
 * 按路径替换内容（返回**新对象**，不修改入参）。
 *
 * 语义（用户 `2026-11-21`：「覆盖是替换。所以要描述路径。」）：
 * · 路径指向的位置，**整段**换成 value（不是合并）；
 * · 路径中间段必须存在，否则报错（防止「路径写错但静默写进别处」）；
 * · 最后一段：对象里不存在可以新增（新增字段是否合法交给模板校验），
 *   数组里必须是已有下标或 `-`（追加）；
 * · 根路径（`segments = []`）要求 value 是整个 section map（普通对象）。
 *
 * @param content 当前内容（`{ [sectionKey]: actionPayload }`）
 * @param segments `parseContentPointer` 的结果
 * @param value 替换值
 */
export function replaceInContent(
	content: Readonly<Record<string, unknown>>,
	segments: readonly string[],
	value: unknown,
): ContentReplace {
	if (segments.length === 0) {
		if (!isPlainObject(value)) {
			return { ok: false, message: '路径为空 = 替换整个内容对象；value 必须是一个 JSON 对象（key = 章节）。' };
		}
		return { ok: true, next: { ...value } };
	}

	const next = structuredClone(content) as Record<string, unknown>;
	const replaced = replaceAt(next, segments, 0, value);
	if (!replaced.ok) return replaced;
	return { ok: true, next };
}

/** 递归替换（`segments[index]` 是当前要处理的段）。 */
function replaceAt(
	container: Record<string, unknown> | unknown[],
	segments: readonly string[],
	index: number,
	value: unknown,
): { readonly ok: true } | ContentReplaceFailure {
	const key = segments[index];
	/* 结构上走不到（调用方保证 index 合法），保留真实分支不用 `as` 让编译器闭嘴。 */
	if (key === undefined) return { ok: false, message: '内部错误：路径越界。' };
	const last = index === segments.length - 1;

	/* ── 数组 ── */
	if (Array.isArray(container)) {
		if (key === '-') {
			if (!last) {
				return { ok: false, message: '`-`（追加）只能出现在路径最后一段。' };
			}
			container.push(value);
			return { ok: true };
		}
		if (!/^\d+$/u.test(key)) {
			return { ok: false, message: `「${key}」不是数组下标；数组路径要写数字，或在末尾用 \`-\` 追加。` };
		}
		const at = Number(key);
		if (at >= container.length) {
			return {
				ok: false,
				message: `数组下标 ${at} 越界（当前长度 ${container.length}）；追加请用 \`-\`。`,
			};
		}
		if (last) {
			container[at] = value;
			return { ok: true };
		}
		const child = container[at];
		if (!isContainer(child)) {
			return { ok: false, message: `路径「${segments.slice(0, index + 1).join('/')}」不是对象/数组，不能继续往下走。` };
		}
		return replaceAt(child, segments, index + 1, value);
	}

	/* ── 对象 ── */
	const has = Object.hasOwn(container, key);
	if (last) {
		container[key] = value;
		return { ok: true };
	}
	if (!has) {
		const keys = Object.keys(container);
		return {
			ok: false,
			message:
				`路径里的「${key}」不存在（当前可用键：${keys.length === 0 ? '（空）' : keys.join('、')}）；` +
				'替换语义要求中间路径必须存在。',
		};
	}
	const child = container[key];
	if (!isContainer(child)) {
		return { ok: false, message: `路径里的「${key}」不是对象/数组，不能继续往下走。` };
	}
	return replaceAt(child, segments, index + 1, value);
}

/** 是否是普通对象（JSON object，不是数组/`null`）。 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 是否可以继续往下走（对象或数组）。 */
function isContainer(value: unknown): value is Record<string, unknown> | unknown[] {
	return typeof value === 'object' && value !== null;
}
