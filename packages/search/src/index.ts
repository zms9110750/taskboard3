/**
 * `@taskboard/search` —— 纯函数搜索。
 *
 * ## 这个包是什么
 *
 * 一个**可整体替换**的实现领域：换上自己的实现，只要满足
 * `SearchStrategy` 的形状，调用方不需要改任何东西。
 *
 * 用户裁定：
 * > search 的职责是你给他全部的卡，他 linq 过滤了再给你。
 * > 所以他也有全量的数据源。因此后端存储做半查是不可能的。
 *
 * ⇒ 输入永远是**全量卡数组**（调用方从存储层一次取出），
 *   本包不碰存储、不碰 I/O、不碰网络、**不 import `node:` 任何东西**、
 *   不 import 任何第三方 —— 因此也能在浏览器里跑。
 *
 * ## 依赖方向
 *
 * ```
 * protocol ──► core ──► dsh
 *                 └──► search（本条由 core 依赖 search，不是反过来）
 * ```
 *
 * 本包**零 import**：`SearchableCard` 是本包自己的最小结构接口，
 * core 的 `Card` 结构上满足它即可传入。理由见 `types.ts` 顶部。
 *
 * ## 零 import 的代价：`groupOf` 必传
 *
 * 状态 → 组名的映射是 protocol 的词汇，本包拿不到 ⇒ 调用方必须注入。
 * **刻意不留默认值**：留一份拷贝就等于留了第二处真值，而它不会漂移报警。
 *
 * ```ts
 * import { STATUS_GROUP_OF } from '@taskboard/protocol';
 * const search = createSearch({ groupOf: (s) => STATUS_GROUP_OF[s] });
 * ```
 */

export type {
	SearchCondition,
	SearchOptions,
	SearchStrategy,
	SearchableCard,
	StatusGroupName,
} from './types.ts';

export {
	createSearch,
	includesDrafts,
	titleMatches,
	isStatusGroup,
	STATUS_GROUPS,
	DEFAULT_DRAFT_STATE,
} from './match.ts';
