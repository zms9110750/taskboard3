/**
 * 任务板标签页的 body —— **新 UI 的产品入口**。
 *
 * ## 它是什么
 *
 * 把「数据层」和「界面」焊在一起的那一层：
 *
 * ```
 * useBoardState()                    ← store.ts：调 API、存结果、loading/error/pending
 *        ↓
 * <Workspace ... />                  ← renderers/Workspace.tsx：全部视觉与交互
 * ```
 *
 * 用户 `2026-11-22`：
 * > 「我看不懂。产品在哪？有入口吗？我一直在改 UI。你写了入口吗？如果写了，那就接。」
 *
 * ⇒ 本文件就是那个「接」。它**不含任何视觉**（一个 className 都不新增），
 *   只做三件事：取数据、管本地 UI 状态、把回调接到 `BoardActions`。
 *
 * ## 为什么 `currentId` 和 `viewingId` 是同一个值
 *
 * 用户 `2026-11-22` 取消了「激活空间」这个设定（工具层的 `workspaceId` 必须显式给，
 * 不再有默认空间）。所以「正在看哪个空间」和「当前空间」在产品里**是同一件事** ——
 * 点一个空间 chip 就是切过去（`switchWorkspace` 会重新拉那个空间的卡）。
 *
 * ⇒ 不保留第二个 state。两个 prop 都传 `state.workspaceId`。
 *
 * ## 本地 UI 状态只有两个
 *
 * | 状态 | 为什么不在 store 里 |
 * |---|---|
 * | `showArchived` | 「显示已归档」是纯视图开关，不写服务端、不影响任何数据 |
 * | `selectedId` | 选中哪张卡看详情，是纯视图状态 |
 *
 * ⚠ 筛选 / 搜索**不在这里** —— `Workspace` 自己按 `pure/card-filter.ts` 就地过滤，
 *   只通过 `onFilterChange` / `onSearchChange` 上报。产品里没人监听，所以不传。
 *
 * ## ⚠ 缺口（`BoardActions` 里没有对应动作 / 入口还没接）
 *
 * 下面这些回调里，有的**没有服务端接口**，有的接口在但入口还没接；
 * 没接的只能显式告诉用户「这个入口还没接」，不能静默失败（用户会以为是 bug）：
 *
 * | 回调 | 状态 |
 * |---|---|
 * | `onToggleArchived` | ✅ 已接（`api.archiveWorkspace` + `POST /workspaces/:id/archive`）|
 * | `onCreateCard` | ✅ 已接（本文件挂 `CreateFlow`，全屏建卡页 + 提交走 core）|
 * | `onNoteChange` | `api.patchCard` 线格式已修（`fix/patch-wire`），但入口还没接 |
 * | `onSectionChange` | ✅ 已接（ask 作答 / text 失焦 → `actions.patchSection` → `api.patchCard` 整份 content）|
 * | `onAddRelation` / `onDerive` | 关系编辑、派生子任务都还没做 |
 *
 * ⇒ 没接的一律走 `notWired()`：**alert 一句人话**。这是 MVP 的诚实做法 ——
 *   等接口补齐再把对应那一行换掉。
 *
 * ## ✅ `onCreateCard`（用户 `2026-11-22`）
 *
 * > 「我记得，新建是做了 ui，有组件的吧。那应该接进去啊。」
 * > 「点击新建以后不是模态框，而是**新建要占满视口**。」
 * > 「他是内存操作……都要进 core，也要过架构校验。而且是跟 ai tool 一样的校验入口。」
 *
 * ⇒ 点「新建」时**整个替换成 `CreateFlow`**（不是浮层、不是模态框）。
 *   提交成功 ⇒ 关闭建卡页 + `reload()` 让新卡进列表。
 */

import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { toCardAction } from './actions.ts';
import { createApi, type TaskboardApi, type TemplateDerive } from './api.ts';
import { CreateFlow, type CreateInitial } from './CreateFlow.tsx';
import { deriveMenuItemsOf, derivePrefillOf, deriveSourceOf, type DeriveMenuItem } from './pure/derive-menu.ts';
import { kindLabelsOf } from './pure/kind-labels.ts';
import { DeriveMenu } from './renderers/DeriveMenu.tsx';
import { useBoardState } from './store.ts';
import type { Card, CardAction } from './types.ts';
import { Workspace } from './renderers/Workspace.tsx';

/** 组件属性。 */
export interface WorkspaceBodyProps {
	/**
	 * 注入 API 实现（**只给预览 / 测试**）。省略 = `createApi()` 走真 `fetch`。
	 *
	 * ⚠ 产品里必须省略 —— 浏览器里没有服务端可达的其他入口。
	 *   存在的理由：`useBoardState(apiImpl)` 本来就支持注入（见 `store.ts` 文件头），
	 *   但产品入口一旦写死 `createApi()`，就**没有任何办法在不启服务端的情况下
	 *   验证这个 body 真的画得出来**（预览页是 `file://`，fetch 必失败）。
	 */
	readonly api?: TaskboardApi;

}

// TODO(审查): `notWired()` 用浏览器原生 `alert`，而「新建空间」用原生 `prompt`（:245-249）；DSH 宿主有自己的对话框/输入组件，原生弹窗在 WebView/桌面壳里阻塞行为、观感、可样式化都不一致。可直接换成宿主 UI，需用户决定交互形态（原生弹窗是否可接受）。
/**
 * 一个「入口还没接」的提示。
 *
 * ⚠ 用 `alert` 而不是静默 return：用户点了一个按钮却没反应，
 *   他会以为界面坏了。说清楚「没接」比装作无事发生好。
 *
 * @param what 缺的是什么入口
 */
function notWired(what: string): void {
	globalThis.alert(`${what}：这个入口还没接（数据层还没有对应的接口）。\n\n不是界面坏了。`);
}

/** 一个整页提示（加载 / 错误 / 没有空间）。零新样式，复用现有的虚线空态框。 */
function PageMessage(props: {
	readonly text: string;
	readonly action?: { readonly label: string; readonly onClick: () => void };
}): ReactNode {
	return (
		<div className="tb3w-root">
			<div className="tb3w-page">
				<div className="tb3w-detail__empty">
					<span>{props.text}</span>
					{props.action === undefined ? null : (
						<button type="button" className="ghost-btn" onClick={props.action.onClick}>
							{props.action.label}
						</button>
					)}
				</div>
			</div>
		</div>
	);
}

/**
 * 任务板 body（产品入口）。
 *
 * @param props 见 `WorkspaceBodyProps`（产品里不传）
 */
export function WorkspaceBody(props: WorkspaceBodyProps): ReactNode {
	const { state, actions } = useBoardState(props.api);
	const [showArchived, setShowArchived] = useState(false);
	/*
	 * 类别显示：中文名 + 编号字母都来自 core 的注册表（`state.kinds`），
	 * **前端不写第二份中文表**。注册表缺项 / 字段不全时 `kindLabelsOf` 自己降级。
	 *
	 * ⚠ 两种消费方要的形状不同，所以拆两个 prop：
	 *   · `Workspace` 的徽标 = `G 目标`（字母 + 中文，一个字符串）
	 *   · 模板选择器的「类别」列 = 字母、中文**两段分开放**（`letterOf` + `labelOf`）
	 */
	const kindLabels = useMemo(() => kindLabelsOf(state.kinds), [state.kinds]);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	/** 建卡页是否打开（打开时**整个替换** `Workspace`，不是浮层）。 */
	const [creating, setCreating] = useState(false);
	/**
	 * 建卡页的预填值（「+ 派生子任务」那条路带，工具栏「新建」不带）。
	 *
	 * ⚠ 和 `creating` 分开存：`creating === true` 但 `prefill === undefined`
	 *   就是「普通新建」。合并成一个联合状态也可以，但那样每次改都要解构。
	 */
	const [prefill, setPrefill] = useState<CreateInitial | undefined>(undefined);
	/**
	 * 派生菜单的状态。
	 *
	 * `anchor` 是「+ 派生子任务」那个按钮的 DOM（`Workspace` 查好传上来的）。
	 * `cardId` 是**点菜单时那张卡** —— 菜单开着时用户可能切换选择，
	 * 所以不能读 `selectedId`（那个会变），要冻住。
	 */
	const [deriveMenu, setDeriveMenu] = useState<
		| {
				readonly cardId: string;
				readonly anchor: HTMLElement;
				readonly items: readonly DeriveMenuItem[];
		  }
		| undefined
	>(undefined);

	/**
	 * 点「+ 派生子任务」⇒ 取父卡模板的 `derives` ⇒ 弹浮窗。
	 *
	 * ## 为什么要发一次请求（`getTemplate`）
	 *
	 * `TemplateSummary`（`GET /api/state` 给的那份）**不带 `derives`** ——
	 * 它是窄投影，只有 ref / displayName / kind / domain。
	 * 只有 `GET /api/templates?ref=<ref>` 的展开视图带 `derives`（和 sections 一起）。
	 *
	 * ⇒ 为什么不在 `TemplateSummary` 加 `derives`：那样 `GET /api/state` 要为
	 *   18 个模板各带一份派生清单，而它只在「用户点派生」时用得上一次。
	 *   一次点击换一次请求，比每次加载全量多传 18 份数据便宜。
	 *
	 * ## 失败怎么办
	 *
	 * 取详情失败 ⇒ **照样弹菜单**，但只有兜底项（「派生空模板」）。
	 * 不静默不响应 —— 用户点了按钮必须看得到东西。
	 */
	const onDerive = useCallback(
		(cardId: string, anchor: HTMLElement): void => {
			const parent = state.cards.find((one) => one.id === cardId);
			if (parent === undefined) return;

			const sourceRef = deriveSourceOf(parent);
			const open = (derives: readonly TemplateDerive[]): void => {
				setDeriveMenu({ cardId, anchor, items: deriveMenuItemsOf(derives) });
			};

			if (sourceRef === undefined) {
				/* 卡上没有模板 ref（数据坏了 / 旧数据）⇒ 只能走兜底。 */
				open([]);
				return;
			}

			// TODO(审查): 回调里现造 `createApi()`，与 useBoardState(:129) / client.tsx:155,330 的实例互不共享；虽当前无状态、无 bug，但建议收敛为一个模块级 api 单例（可直接改）。另 `props.api` 注入路径只服务预览/测试。
			const api = props.api ?? createApi();
			/*
			 * 只取 `derives`。`getTemplate` 还会带回 sections（建卡页要），
			 * 这里不用 —— 多取的那部分不花钱（同一个请求）。
			 */
			void api.getTemplate(sourceRef).then(
				(detail) => {
					open(detail.derives);
				},
				() => {
					/* 取不到 ⇒ 兜底项。用户还是能派生出空卡。 */
					open([]);
				},
			);
		},
		[props.api, state.cards],
	);

	/** 菜单里选了一项 ⇒ 打开建卡页，带三样预填（用户 2026-11-22）。 */
	const onDerivePick = useCallback(
		(item: DeriveMenuItem): void => {
			const current = deriveMenu;
			if (current === undefined) return;
			const parent = state.cards.find((one) => one.id === current.cardId);
			if (parent === undefined) return;

			setPrefill(derivePrefillOf(parent, item));
			setCreating(true);
		},
		[deriveMenu, state.cards],
	);

	/**
	 * 点一个空间 chip ⇒ 切过去。
	 *
	 * ⚠ 只 `setViewingId` 不拉数据是不行的 —— 卡是**按空间**取的，
	 *   `switchWorkspace` 会重新 `getState(那个空间)`。
	 */
	const onView = useCallback(
		(id: string): void => {
			actions.switchWorkspace(id);
		},
		[actions],
	);

	// TODO(审查): 用原生 `prompt` 让用户输空间名（见 notWired 的 TODO）；宿主有输入组件时原生 prompt 的阻塞/样式/可访问性都不一致。可直接换宿主 UI，具体交互（对话框/内联输入）需用户决定。
	const onCreateWorkspace = useCallback((): void => {
		const name = globalThis.prompt('新任务空间的名称');
		if (name === null || name.trim() === '') return;
		void actions.createWorkspace(name.trim());
	}, [actions]);

	/** 菜单里点了一个转移按钮 ⇒ 翻成 `CardAction` ⇒ 发给服务端。 */
	const onAction = useCallback(
		(cardId: string, button: Parameters<typeof toCardAction>[0]): void => {
			const action: CardAction = toCardAction(button);
			void actions.runAction({ cardId, action });
		},
		[actions],
	);

	/**
	 * 点「已归档」按钮 ⇒ 归档 / 取消归档那个空间。
	 *
	 * ⚠ 按钮的语义是**翻转**（不是「设为已归档」）——
	 *   `SpaceBar` 的 `actionButtonOf()` 只在「显示已归档」打开时给这个按钮，
	 *   此时按钮显示的是目标空间的**当前归档状态**，点一下就是反过来。
	 *   所以这里要按当前状态判断传 `archived` 还是 `!archived`。
	 */
	const onToggleArchived = useCallback(
		(id: string): void => {
			const target = state.workspaces.find((one) => one.id === id);
			const next = target?.archived !== true;
			void actions.setWorkspaceArchived(id, next);
		},
		[actions, state.workspaces],
	);

	const onSelect = useCallback((cardId: string | null): void => {
		setSelectedId(cardId);
	}, []);

	/**
	 * 章节内联编辑（ask 作答 / text 失焦）⇒ 数据层保存。
	 *
	 * 本文件不组装 content、不直接碰 `api.patchCard`：那是 store 的职责
	 * （它持有 `state.cards`，能拿到「当前全部章节」）。这里只把
	 * `cardId + sectionId + patch` 转给 `actions.patchSection`。
	 */
	const onSectionChange = useCallback(
		(cardId: string, sectionId: string, patch: Readonly<Record<string, unknown>>): void => {
			void actions.patchSection(cardId, sectionId, patch);
		},
		[actions],
	);

	/*
	 * **首次加载**才整页提示 —— 那时 `workspaces` 还是空的，连 chips 行都没数据可画，
	 * 只能整页等。
	 *
	 * 用户 `2026-11-23`：
	 * 「切换工作空间的时候整个视口都跳变。给他加一点过度时间。或者跳变也不要全变了。
	 *   显示"正在加载"不应该包含视口上面的菜单部分。应该只有里面的列表或者科技树的视口显示正在加载。」
	 *
	 * ⇒ 已经有数据时切空间**不再**走这里，而是把 `loading` 传给 `Workspace`，
	 *   只让内容区（列表 / 科技树 / 详情）显示加载 —— chrome 保持不动。
	 */
	if (state.loading && state.workspaces.length === 0) {
		return <PageMessage text="正在加载任务板…" />;
	}

	// TODO(审查): 任何 `state.error`（含一次失败的按钮动作）都会把整页替换成错误页，chrome/选中卡/筛选全丢；关闭后回到初始视图。属产品行为，是否改成 toast/页内横幅、动作失败不整页替换，需用户决定。
	if (state.error !== undefined) {
		return (
			<PageMessage
				text={state.error}
				action={{ label: '关闭', onClick: actions.clearError }}
			/>
		);
	}

	if (state.workspaceId === '') {
		return (
			<PageMessage
				text="还没有任务空间。"
				action={{ label: '新建', onClick: onCreateWorkspace }}
			/>
		);
	}

	/*
	 * 选中的卡要从**当前空间的卡列表**里找 —— `selectedId` 只是个 id。
	 * `Workspace` 收的是 `selectedId: string | null` 而不是卡对象，所以这里不用 find，
	 * 直接透传（组件内部自己按 id 匹配）。
	 *
	 * ⚠ 切空间后 `selectedId` 可能指向旧空间的卡 ⇒ `Workspace` 里按 id 找不到就
	 *   当作没选中（它的 `selected` 是 `find(...) ?? null`）。不在这里清，
	 *   是因为「切回去还选中原来那张」是更少的惊讶。
	 */
	const cards: readonly Card[] = state.cards;

	/*
	 * 建卡页打开时**整个替换** `Workspace`（用户 2026-11-22：
	 * 「点击新建以后不是模态框，而是新建要占满视口」）。
	 *
	 * ⚠ 放在这里而不是包一层浮层：`CardCreate` 是 `height:100%` 的整页，
	 *   它的父容器（DSH 的 tab body）给多高就多高。
	 */
	if (creating) {
		return (
			<CreateFlow
				workspaceId={state.workspaceId}
				templates={state.templates}
				cards={cards}
				/*
				 * 类别显示注入：选择器「类别」列要 `G` + `目标` 两段分开画，
				 * 所以这里传「纯中文名」和「纯字母」，不是徽标那个拼好的串。
				 */
				kindLabelOf={kindLabels.labelOf}
				kindLetterOf={kindLabels.letterOf}
				/*
				 * 预填（「+ 派生子任务」那条路带，工具栏「新建」不带）。
				 * ⚠ 只在打开那一刻算一次 —— 用户进去后改的三样以他改的为准。
				 */
				{...(prefill === undefined ? {} : { initial: prefill })}
				{...(props.api === undefined ? {} : { api: props.api })}
				onCreated={(cardId) => {
					setCreating(false);
					setPrefill(undefined);
					/* 数据同步：新卡要出现在列表里 ⇒ 重拉全量（服务端才是真值）。 */
					actions.reload();
					setSelectedId(cardId);
				}}
				onCancel={() => {
					setCreating(false);
					setPrefill(undefined);
				}}
			/>
		);
	}

	return (
		<>
			<Workspace
			workspaces={state.workspaces}
			/* 用户取消了「激活空间」⇒ 当前 = 正在查看，同一个值。 */
			currentId={state.workspaceId}
			viewingId={state.workspaceId}
			showArchived={showArchived}
			cards={cards}
			templates={state.templates}
			selectedId={selectedId}
			/*
			 * 数据在飞 ⇒ 只让**内容区**显示加载（用户 2026-11-23）。
			 * ⚠ 不能在这里整页替换：chrome 是「视口上面的菜单部分」，它不该跟着变。
			 */
			loading={state.loading}
			/*
			 * 类别徽标 = `字母 + 空格 + 中文`（`G 目标`）。数据来自 core 的注册表
			 * （`state.kinds`）；注册表没有的类别降级成 `G goal` —— **不编中文**。
			 */
			kindLabelOf={kindLabels.badgeOf}
			onView={onView}
			onToggleArchived={onToggleArchived}
			onToggleShowArchived={() => {
				setShowArchived((now) => !now);
			}}
			onCreateWorkspace={onCreateWorkspace}
			onSelect={onSelect}
			onCreateCard={() => {
				setCreating(true);
			}}
			onAction={onAction}
			onAddRelation={() => {
				notWired('添加关系');
			}}
			onDerive={onDerive}
			onNoteChange={() => {
				notWired('改备注');
			}}
			onSectionChange={onSectionChange}
			/>

			{/*
			 * 派生子任务浮窗：portal 到 body 的 fixed 浮层。
			 *
			 * 放在 `<Workspace>` 外、同一个 fragment 里 —— 它自己 portal 到
			 * `document.body`，在这里只是为了拿到 `deriveMenu` 状态。
			 */}
			{deriveMenu === undefined ? null : (
				<DeriveMenu
					items={deriveMenu.items}
					anchor={deriveMenu.anchor}
					onPick={onDerivePick}
					onClose={() => {
						setDeriveMenu(undefined);
					}}
				/>
			)}
		</>
	);
}
