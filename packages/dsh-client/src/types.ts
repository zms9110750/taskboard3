/**
 * 这个包自己的数据形状（**不依赖 core**）。
 *
 * ## 为什么不 import `@taskboard/core`
 *
 * `core` 会 `import 'node:sqlite'` —— 那是 Node 内置模块，浏览器里不存在。
 * 一旦本包 import core，bundler 会尝试解析 `node:sqlite`，客户端 bundle 直接炸。
 *
 * ⇒ 这里只声明**浏览器需要读的那些字段**，是 core 的 `Card` 的**结构子集**。
 * 服务端多给的字段本包忽略即可（JSON 传输，不校验额外字段）。
 *
 * ⚠ 字段名必须与 core 的 `Card` 一致。不一致时**编译不报错、运行静默空白** ——
 *   `test/schema-parity.test.ts` 用一份固定的样例 JSON 钉住这一点。
 */

/** 工作空间（容器）。 */
export interface Workspace {
	readonly id: string;
	readonly displayName: string;
	readonly archived: boolean;
	readonly createdAt: number;
}

/** 卡上的模板快照。 */
export interface TemplateRef {
	readonly ref: string;
	readonly kind: string;
	readonly domain: string;
}

/** 一条关系边。 */
export interface RelationEntry {
	readonly label: string;
	readonly to: string;
}

/** 关系集合：`parent` 是派生树，`links` 是其余五种边。 */
export interface Relations {
	readonly parent: string | null;
	readonly links: readonly RelationEntry[];
}

/** 卡上的一个章节。 */
export interface CardSection {
	/** 章节名的副本（模板卸载后仍能显示）。 */
	readonly label: string;
	/** action 的 payload，结构由 action 决定。 */
	readonly payload: unknown;
}

/** 历史条目。`action` 是机器标识，不是文案。 */
export interface HistoryEntry {
	readonly at: number;
	readonly action: string;
	readonly detail?: unknown;
}

/** 一个持有者。同一张卡可以有多个。 */
export interface CardHolder {
	/** AI 的消息循环 id / 会话 id。 */
	readonly holder: string;
	/** 开始持有的时间（毫秒）。 */
	readonly at: number;
}

/**
 * 未读标记 —— 「对方改过，我还没读」。
 *
 * 用户 `2026-11-13`：「不能再用胶水代码了」⇒ 这是**卡的字段**，
 * 不是从 `history` + 外部游标算出来的。维护点唯一：core 的 `withHistory`。
 */
export interface CardUnread {
	/** AI 改过、用户还没读。 */
	readonly ai: boolean;
	/** 用户改过、AI 还没读。 */
	readonly user: boolean;
}

// TODO(审查): 本文件与 core 的 Card/Workspace/StateData 逐字段复制，注释两处（:13、:83）声称由 `test/schema-parity.test.ts` 钉住，但该测试文件不存在（全包 grep 只有引用文本）⇒ 漂移完全静默。可补真正的 parity 测试（test 里 `import type` core 做双向 assignability），或把 wire DTO 收进 protocol；选哪条需用户定架构。
/**
 * 一张任务卡。
 *
 * ⚠ **与 core 的 `Card` 逐字段一一对应** —— 缺一个字段就是界面上一块空白，
 *   而且不报错。`test/schema-parity.test.ts` 钉住这一点。
 *
 * ⚠ **旧字段 `claimedBy` / `claimedAt` 已删**：core 把它们换成了 `holders` 列表
 *   （允许多人协作，用户 `2026-11-13`）。留着会让类型和服务端对不上，
 *   而 TypeScript **不会报错**（JSON 多字段/少字段都不检查）。
 */
export interface Card {
	readonly id: string;
	readonly title: string;
	/** A2A 状态全名（`TASK_STATE_*`）。 */
	readonly status: string;
	readonly template: TemplateRef;
	readonly relations: Relations;
	readonly sections: Readonly<Record<string, CardSection>>;
	readonly note: string;
	/** 建卡时间（毫秒）。终身不变，**不是从 history 派生**。 */
	readonly createdAt: number;
	/** 采纳时间；未采纳为 `null`。 */
	readonly adoptedAt: number | null;
	readonly history: readonly HistoryEntry[];
	readonly deleted: boolean;
	/** 当前持有者（可以是多个）。 */
	readonly holders: readonly CardHolder[];
	/** 未读标记。 */
	readonly unread: CardUnread;
}

/** 模板摘要（模板选择器用）。 */
export interface TemplateSummary {
	readonly ref: string;
	readonly displayName: string;
	readonly kind: string;
	readonly domain: string;
}

/**
 * 一个类别（`GET /taskboard3/api/state` 的 `kinds`）。
 *
 * ⚠ **真值在 core**（`KindDef` / `KindRegistry`，第三方可注册更多）。
 *   客户端只是显示：中文名 + 编号字母都从这里来，**不许在前端写一份中文表**。
 */
export interface KindSummary {
	/** 稳定英文标识（卡里存的就是它）。 */
	readonly id: string;
	/** 中文显示名。 */
	readonly displayName: string;
	/** 编号字母（单个大写字母）。 */
	readonly letter: string;
	/** 一句话说明。 */
	readonly description: string;
	/** 取消后能否重开。 */
	readonly reopenable: boolean;
	/** 这类卡是否需要领取（领取即执行权限凭证）。 */
	readonly needsClaim: boolean;
}

/**
 * `GET /taskboard3/api/state` 的 `data` —— **一次拿全量**。
 *
 * 用户裁定：「一旦 ui 查看就是全量加载」。所以没有分页、没有增量。
 */
export interface StateData {
	/** 全部空间（含归档？由服务端决定；UI 自己按 `archived` 过滤）。 */
	readonly workspaces: readonly Workspace[];
	/** 本次要显示的当前空间 id。 */
	readonly workspaceId: string;
	/** 该空间的全部卡（不含墓碑）。 */
	readonly cards: readonly Card[];
	/** 模板清单（建卡面板用；MVP 只用来显示模板名）。 */
	readonly templates: readonly TemplateSummary[];
	/**
	 * 类别注册表（中文名 + 编号字母）。
	 *
	 * ⚠ 老服务端没有这个字段 ⇒ 类型上标成可选，客户端必须能降级
	 *   （降级到英文 id + 首字母大写，见 `pure/template-picker.ts` 的 defaultKindLabel/Letter）。
	 */
	readonly kinds?: readonly KindSummary[];
}

/** 失败信封。 */
export interface FailEnvelope {
	readonly ok: false;
	readonly code: string;
	readonly message: string;
	readonly issues?: readonly { readonly path: string; readonly message: string }[];
}

/** 成功信封。 */
export interface OkEnvelope<T> {
	readonly ok: true;
	readonly data: T;
}

/** 服务端返回的两种信封。 */
export type Envelope<T> = OkEnvelope<T> | FailEnvelope;

// TODO(审查): `transition.to` 是 `string`，导致 pure/card-action.ts:79 只能 `as TaskState`；源头 ButtonAction.to 本就是 TaskState、actions.ts:33 也原样传递。把这里改成 `TaskState` 即可删断言，并让非法状态在编译期进不来（可直接改）。
/** 一次转移请求的动作。 */
export type CardAction =
	/** 采纳草稿。 */
	| { readonly kind: 'adopt' }
	/** 领取：提交 → 处理中。 */
	| { readonly kind: 'claim' }
	/** 搁置：处理中 → 提交。 */
	| { readonly kind: 'release' }
	/** 普通转移。 */
	| { readonly kind: 'transition'; readonly to: string };

/** 点击一个按钮要发的东西。 */
export interface ActionRequest {
	readonly cardId: string;
	readonly action: CardAction;
}

/** 转移成功后的返回。 */
export interface ActionResult {
	readonly card: Card;
	/** 沿树重算后跟着变了的卡（UI 要就地替换）。 */
	readonly recomputed: readonly Card[];
}
