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

/**
 * 一张任务卡。
 *
 * 与 core 的 `Card` 逐字段对应，没有多余没有遗漏 —— 缺一个字段就是
 * 界面上一块空白，而且不报错。
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
	readonly history: readonly HistoryEntry[];
	readonly deleted: boolean;
	readonly claimedBy: string | null;
	readonly claimedAt: number | null;
}

/** 模板摘要（模板选择器用）。 */
export interface TemplateSummary {
	readonly ref: string;
	readonly displayName: string;
	readonly kind: string;
	readonly domain: string;
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
