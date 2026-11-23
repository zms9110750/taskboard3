/**
 * UI 状态（科技树的「组」+ 折叠态）—— **只给浏览器 UI 用的数据**。
 *
 * ## 为什么它在这里，而不在 core
 *
 * 用户 `2026-11-24`：
 *
 * > 「不用官方自己的存储设施。他用的是 jsonl。不能用这个。要用可改的比如 sqlite 格式写」
 * > 「io 的那个包不是暴露了接口吗？不能直接和他用接口通信吗？」
 * > 「三出入口用同一的。内存都是一份数据。」
 *
 * ⇒ 这些组**不是卡**：AI 交互不了，也不该出现在 `/api/state` 那种「模型也会看」的通道里。
 *   所以它不进 core 的数据模型，只借用 `taskboard3Store` 已经暴露的 kv（SQLite，可改、可删单键）。
 *
 * ## 为什么键按工作空间分
 *
 * 用户 `2026-11-24` 拿 VS 的 `.vs` 打比方：
 *
 * > 「vs 从项目 a.sln 里面加入了 b/c.cs。然后折叠了 c。
 * >  然后去 b.sln 开 c.cs。是不一样的。」
 *
 * ⇒ **状态属于容器，不属于文件**：卡是文件，任务板空间是容器。
 *   一个空间一份，换空间就是另一套组与折叠态。
 *
 * ## 本文件是纯函数
 *
 * 解析 / 校验 / 序列化都在这里，不含 HTTP、不含 Cordis ⇒ 能被 `node --test` 直接覆盖。
 * 特别是**读路径必须容错**：kv 里可能是上一个版本写的坏 JSON，那也是「空状态」，不是 500。
 */

/**
 * 一个「组」。
 *
 * ⚠ `name` **可空** —— 用户 `2026-11-24`：「组名可以不填。」
 *   省略和空串都按「没名字」处理，读回来不许被塞成 `''`。
 */
export interface UiGroup {
	/** 调用方给的稳定 id（前端生成，服务端只存不造）。 */
	readonly id: string;
	/** 组名；可省略。 */
	readonly name?: string;
	/** 成员卡 id（同一父节点的兄弟；那条约束由前端保证，服务端只做结构校验）。 */
	readonly memberIds: readonly string[];
}

/** 一个工作空间的完整 UI 状态。 */
export interface UiState {
	readonly groups: readonly UiGroup[];
	/** 折叠的卡 id + 组 id（两者共用这一个集合，id 不会撞）。 */
	readonly folded: readonly string[];
}

/** 空状态（读不到 / 坏数据时返回它）。 */
export const EMPTY_UI_STATE: UiState = Object.freeze({
	groups: Object.freeze([]),
	folded: Object.freeze([]),
});

/** kv 键前缀：组定义。 */
const GROUPS_KEY_PREFIX = 'ui.groups.';

/** kv 键前缀：折叠态。 */
const FOLDED_KEY_PREFIX = 'ui.folded.';

/** `ui.groups.<workspaceId>`。 */
export function uiGroupsKeyOf(workspaceId: string): string {
	return `${GROUPS_KEY_PREFIX}${workspaceId}`;
}

/** `ui.folded.<workspaceId>`。 */
export function uiFoldedKeyOf(workspaceId: string): string {
	return `${FOLDED_KEY_PREFIX}${workspaceId}`;
}

/** 是否是非空字符串（去空白后）。 */
function isFilledString(value: unknown): value is string {
	return typeof value === 'string' && value.trim() !== '';
}

/**
 * 解析一个组的原始值。
 *
 * @returns 干净的组；结构不对 ⇒ `undefined`（调用方跳过这一条，不整份作废）
 */
function parseGroup(value: unknown): UiGroup | undefined {
	if (typeof value !== 'object' || value === null) return undefined;
	const record = value as Record<string, unknown>;
	if (!isFilledString(record['id'])) return undefined;
	const rawMembers = record['memberIds'];
	if (!Array.isArray(rawMembers)) return undefined;

	const memberIds: string[] = [];
	for (const one of rawMembers) {
		if (!isFilledString(one)) continue;
		if (memberIds.includes(one)) continue;
		memberIds.push(one);
	}

	const group: { id: string; name?: string; memberIds: readonly string[] } = {
		id: record['id'].trim(),
		memberIds,
	};
	/* ⚠ 名字为空 ⇒ **整个键不出现**，不是 `name: ''`。 */
	if (isFilledString(record['name'])) group['name'] = record['name'].trim();
	return group;
}

/**
 * 读路径：解析 kv 里的组定义。
 *
 * **坏数据 ⇒ 空数组**（不是抛、不是 500）。理由：这是 UI 状态，丢了顶多重新分组，
 * 但抛出去会让整个面板打不开 —— 代价不对等。
 */
export function parseUiGroups(raw: string | undefined): readonly UiGroup[] {
	if (raw === undefined || raw.trim() === '') return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw) as unknown;
	} catch {
		return [];
	}
	if (!Array.isArray(parsed)) return [];

	const groups: UiGroup[] = [];
	const seenIds = new Set<string>();
	const seenMembers = new Set<string>();
	for (const one of parsed) {
		const group = parseGroup(one);
		if (group === undefined) continue;
		/* id 撞了：先到的赢（后到的丢弃，不覆盖）。 */
		if (seenIds.has(group.id)) continue;
		seenIds.add(group.id);
		/* 一张卡最多在一个组里 —— 跨组重复的成员在这里剔掉。 */
		const members = group.memberIds.filter((id) => !seenMembers.has(id));
		for (const id of members) seenMembers.add(id);
		groups.push(members.length === group.memberIds.length ? group : { ...group, memberIds: members });
	}
	return groups;
}

/** 读路径：解析 kv 里的折叠态。坏数据 ⇒ 空数组。 */
export function parseFolded(raw: string | undefined): readonly string[] {
	if (raw === undefined || raw.trim() === '') return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw) as unknown;
	} catch {
		return [];
	}
	if (!Array.isArray(parsed)) return [];

	const folded: string[] = [];
	for (const one of parsed) {
		if (!isFilledString(one)) continue;
		if (folded.includes(one)) continue;
		folded.push(one.trim());
	}
	return folded;
}

/** 序列化组（**省略 `name` 时不写这个键**）。 */
export function serializeUiGroups(groups: readonly UiGroup[]): string {
	return JSON.stringify(
		groups.map((one) => (one.name === undefined ? { id: one.id, memberIds: one.memberIds } : one)),
	);
}

/** 序列化折叠态。 */
export function serializeFolded(folded: readonly string[]): string {
	return JSON.stringify(folded);
}

/** `PUT` body 的校验结果。 */
export type UiStateBodyCheck =
	| {
			readonly ok: true;
			readonly value: { readonly workspace: string; readonly groups: readonly UiGroup[]; readonly folded: readonly string[] };
	  }
	| { readonly ok: false; readonly path: string; readonly message: string };

/** 从任意对象里取字段。 */
function fieldOf(body: unknown, key: string): unknown {
	if (typeof body !== 'object' || body === null) return undefined;
	return (body as Record<string, unknown>)[key];
}

/**
 * 校验 `PUT /api/ui-state` 的 body。
 *
 * 校验的是**结构**，不是业务规则：
 * · `workspace` 必须非空（要按它选键）
 * · `groups` / `folded` 必须是数组
 * · 每个组要有 `id` 和 `memberIds`（名字可选）
 * · 组 id 不重复、一张卡不进两个组
 *
 * ⚠ **「同一父节点的兄弟才能同组」不在服务端校验** —— 那要读卡的父子关系；
 *   写这份数据的只有浏览器 UI，规则在它那边（`dsh-client/src/pure/ui-state.ts`）。
 *   在服务端再写一遍等于养第二份真值。
 */
export function validateUiStateBody(body: unknown): UiStateBodyCheck {
	const workspace = fieldOf(body, 'workspace');
	if (!isFilledString(workspace)) {
		return { ok: false, path: '/workspace', message: 'workspace 必填，且必须是非空字符串。' };
	}

	const rawGroups = fieldOf(body, 'groups');
	if (!Array.isArray(rawGroups)) {
		return { ok: false, path: '/groups', message: 'groups 必须是数组。' };
	}

	const groups: UiGroup[] = [];
	const seenIds = new Set<string>();
	const seenMembers = new Set<string>();
	for (let index = 0; index < rawGroups.length; index += 1) {
		const parsed = parseGroup(rawGroups[index]);
		if (parsed === undefined) {
			return {
				ok: false,
				path: `/groups/${String(index)}`,
				message: '组必须形如 { id: string, memberIds: string[], name?: string }。',
			};
		}
		if (seenIds.has(parsed.id)) {
			return { ok: false, path: `/groups/${String(index)}/id`, message: `组 id 重复：${parsed.id}。` };
		}
		seenIds.add(parsed.id);
		for (const memberId of parsed.memberIds) {
			if (seenMembers.has(memberId)) {
				return {
					ok: false,
					path: `/groups/${String(index)}/memberIds`,
					message: `卡 ${memberId} 同时出现在多个组里；一张卡最多属于一个组。`,
				};
			}
			seenMembers.add(memberId);
		}
		groups.push(parsed);
	}

	const rawFolded = fieldOf(body, 'folded');
	if (!Array.isArray(rawFolded)) {
		return { ok: false, path: '/folded', message: 'folded 必须是数组。' };
	}
	const folded: string[] = [];
	for (const one of rawFolded) {
		if (!isFilledString(one)) {
			return { ok: false, path: '/folded', message: 'folded 里只能是非空字符串 id。' };
		}
		if (!folded.includes(one.trim())) folded.push(one.trim());
	}

	return { ok: true, value: { workspace: workspace.trim(), groups, folded } };
}
