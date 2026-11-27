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
// TODO(审查): [③] `UiState` 全包零引用，紧随其后的 `EMPTY_UI_STATE` 也零引用（grep 零命中）⇒ 重构残骸。
//   可直接删；若要留，把 `Object.freeze + 类型标注` 换成 `satisfies`（AGENTS 3.7）。
export interface UiState {
	readonly groups: readonly UiGroup[];
	/** 折叠的卡 id + 组 id（两者共用这一个集合，id 不会撞）。 */
	readonly folded: readonly string[];
	/**
	 * 用户**强制展开**的 id。
	 *
	 * ⚠ 为什么不能只存 folded：默认折叠判据（全终结且无未读 ⇒ 自动折）是**算出来的**，
	 *   光看 folded 分不出「用户没动过这个节点」和「用户手动展开了它」。
	 *   没有这个集合，用户手动展开的节点会在下次打开面板时被默认判据又折回去。
	 */
	readonly expanded: readonly string[];
}

/** 空状态（读不到 / 坏数据时返回它）。 */
export const EMPTY_UI_STATE: UiState = Object.freeze({
	groups: Object.freeze([]),
	folded: Object.freeze([]),
	expanded: Object.freeze([]),
});

/** kv 键前缀：组定义。 */
// TODO(审查): [⑦] 一个空间拆三个 kv 键（下面三个前缀）；将来加一个 UI 态就要再加键，且写入非原子（见 http.ts 的 PUT /api/ui-state）。
//   合并成 `ui.state.<ws>` 单键（原子、扩展不加键）更好，但属数据迁移，需用户点头。
const GROUPS_KEY_PREFIX = 'ui.groups.';

/** kv 键前缀：折叠态。 */
const FOLDED_KEY_PREFIX = 'ui.folded.';

/** kv 键前缀：强制展开态。 */
const EXPANDED_KEY_PREFIX = 'ui.expanded.';

/** `ui.groups.<workspaceId>`。 */
export function uiGroupsKeyOf(workspaceId: string): string {
	return `${GROUPS_KEY_PREFIX}${workspaceId}`;
}

/** `ui.folded.<workspaceId>`。 */
export function uiFoldedKeyOf(workspaceId: string): string {
	return `${FOLDED_KEY_PREFIX}${workspaceId}`;
}

/** `ui.expanded.<workspaceId>`。 */
export function uiExpandedKeyOf(workspaceId: string): string {
	return `${EXPANDED_KEY_PREFIX}${workspaceId}`;
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
	// TODO(审查): [②] `memberIds` 只判空、**不 trim**，而组 id 与 folded/expanded 都 trim 过 ⇒ 前端多传一个空格就存进一个永远匹配不上的成员。
	//   可直接改：`one.trim()`（属修正，不是新行为）。
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
		// TODO(审查): [①] 本文件的去重全用 `Array.includes`（组内成员、跨组成员、folded/expanded），UI 态可能有几百个 id ⇒ O(n²)；换 `Set` 一行事。
		groups.push(members.length === group.memberIds.length ? group : { ...group, memberIds: members });
	}
	return groups;
}

/** 读路径：解析 kv 里的折叠态。坏数据 ⇒ 空数组。 */
export function parseFolded(raw: string | undefined): readonly string[] {
	return parseIdList(raw);
}

/** 读路径：解析 kv 里的强制展开态。坏数据 ⇒ 空数组。 */
export function parseExpanded(raw: string | undefined): readonly string[] {
	return parseIdList(raw);
}

/** 解析一个「字符串 id 数组」的 kv 值（坏数据 ⇒ 空数组）。 */
function parseIdList(raw: string | undefined): readonly string[] {
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

/** 序列化强制展开态。 */
export function serializeExpanded(expanded: readonly string[]): string {
	return JSON.stringify(expanded);
}

/** `PUT` body 的校验结果。 */
export type UiStateBodyCheck =
	| {
			readonly ok: true;
			readonly value: {
				readonly workspace: string;
				readonly groups: readonly UiGroup[];
				readonly folded: readonly string[];
				readonly expanded: readonly string[];
			};
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

	/* ⚠ expanded 是**后加的**字段：老客户端没这个键 ⇒ 当空数组，不许 400。 */
	const rawExpanded = fieldOf(body, 'expanded');
	const expanded: string[] = [];
	if (rawExpanded !== undefined) {
		if (!Array.isArray(rawExpanded)) {
			return { ok: false, path: '/expanded', message: 'expanded 必须是数组（省略表示空）。' };
		}
		for (const one of rawExpanded) {
			if (!isFilledString(one)) {
				return { ok: false, path: '/expanded', message: 'expanded 里只能是非空字符串 id。' };
			}
			if (!expanded.includes(one.trim())) expanded.push(one.trim());
		}
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

	return { ok: true, value: { workspace: workspace.trim(), groups, folded, expanded } };
}
