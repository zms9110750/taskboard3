/**
 * 状态菜单 —— 点状态胶囊弹出的那层浮层。
 *
 * 旧版 `views/card-detail/status-menu.js`（125 行，结构 / 图标 / 页脚文案）
 * + `lib/menu.js`（247 行，定位 / 点外面收起 / 滚动关闭）。
 *
 * ## 这个组件只做三件事
 *
 * 1. **画**：`menuModelOf(actions)`（`dev/pure/status-menu.ts`）给出的分段 + 每项装饰，原样渲染。
 * 2. **量**：挂进 DOM 后量真实高度，交给 `placeMenu()` 算坐标（**先在 hidden 状态下量**）。
 * 3. **派发**：点项 → `onPick(action)`；点外面 / Escape / 滚动 → `onClose()`。
 *
 * 没有第四件。**分组、图标、灰字、危险色、文案全在 pure 里**，改一处不用改两遍。
 *
 * ## ⚠ 三个必须守住的坑（都是旧版注释里的真事故）
 *
 * ### ① 挂 `document.body` + `position: fixed`
 *
 * 旧版把菜单挂在 `document.body` 上、用 `fixed` —— 因为要 `getBoundingClientRect()`
 * 的**视口坐标**。挂在详情面板里会被 `overflow: hidden` 裁掉。
 *
 * ### ② 量高度必须在**挂上去之后**
 *
 * 旧版注释：元素在 `appendChild` 之前 `offsetHeight` 恒为 0（实测脱离时 0、挂上后 71）。
 * 若在挂之前读，永远拿 0、「上方放不放得下」用的是假高度。
 * ⇒ 顺序固定：**挂（先 hidden）→ 量 → 写 left/top → 显示**，在同一个 `useLayoutEffect` 里。
 *
 * ### ③ 点外面必须用 `composedPath()`，不能用 `contains()`
 *
 * 旧版用 `contains()`，那是因为旧代码是命令式、节点不换。
 * React 里点菜单项会重渲染换节点，捕获阶段的 `contains()` 可能判成「外面」
 * ⇒ 菜单先关、菜单项 onClick 再跑就晚了。
 * ⇒ `isOutsideClick(event.composedPath(), menu, anchor)`，判定逻辑本身在 pure 里（有单测）。
 *
 * 另外**监听要延后一拍再挂**（旧版 `setTimeout(…, 0)`）：否则「打开菜单的那一次点击」
 * 自己就会把菜单关掉。
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';

import type { ButtonAction } from '@taskboard/protocol';

import {
	MENU_EMPTY,
	isOutsideClick,
	keyIntentOf,
	menuModelOf,
	nextIndex,
	placeMenu,
} from '../pure/status-menu.ts';

/** 组件属性。 */
export interface StatusMenuProps {
	/** 可用按钮（`buttonsOf(kind, from, 'user')` 的结果）。 */
	readonly actions: readonly ButtonAction[];
	/** 触发按钮（定位基准 + 「点它不关」的排除项）。 */
	readonly anchor: HTMLElement | null;
	/** 点了某一项。 */
	readonly onPick: (action: ButtonAction) => void;
	/** 请求关闭（点外面 / Escape / 滚动）。 */
	readonly onClose: () => void;
}

/**
 * 状态菜单。
 *
 * @param props 见 `StatusMenuProps`
 */
export function StatusMenu(props: StatusMenuProps): ReactNode {
	const menuRef = useRef<HTMLDivElement>(null);
	const model = menuModelOf(props.actions);
	/** 键盘高亮下标（`-1` = 没有）。鼠标移入也会改它。 */
	const [active, setActive] = useState<number>(-1);

	/** 拍平成一维 —— 键盘上下要跨段移动（段内顺序 = 表顺序，所以下标就是导航顺序）。 */
	const flat = model.sections.flatMap((one) => one.items);
	/** 每一项到扁平下标的映射（渲染时用；`indexOf` 走引用即可，菜单项是同一批对象）。 */
	const indexOfItem = (item: unknown): number => flat.indexOf(item as (typeof flat)[number]);

	/*
	 * ── 定位 ──
	 *
	 * `useLayoutEffect`：在浏览器绘制前把坐标写下去，避免先出现在 (0,0) 再跳。
	 * 依赖 `flat.length`：按钮数量变了（切了状态）要重新量高度。
	 */
	useLayoutEffect(() => {
		const menu = menuRef.current;
		const anchor = props.anchor;
		if (menu === null || anchor === null) return;

		/* ① 先写「可量到但看不见」的初值。 */
		menu.style.visibility = 'hidden';
		menu.style.left = '0px';
		menu.style.top = '0px';
		menu.style.maxHeight = 'none';

		/* ② 量真实高度（此时已挂载）。 */
		const naturalHeight = menu.offsetHeight;
		const box = anchor.getBoundingClientRect();
		const placement = placeMenu(
			{ left: box.left, top: box.top, right: box.right, bottom: box.bottom },
			naturalHeight,
			{ width: globalThis.innerWidth, height: globalThis.innerHeight },
		);

		/* ③ 写真实坐标 + 截断高度，再显示。 */
		menu.style.maxHeight = `${placement.maxHeight}px`;
		menu.style.left = `${placement.left}px`;
		menu.style.top = `${placement.top}px`;
		menu.style.visibility = '';
	}, [props.anchor, flat.length]);

	/*
	 * ── 关闭：点外面 / 滚动 / Escape ──
	 *
	 * ⚠ 捕获阶段（`true`）：要和旧版一致 —— 滚动容器一滚就关，不等冒泡。
	 *   「点外面」用 `composedPath()`，见文件头 ③。
	 * ⚠ 延后一拍再挂：否则打开菜单的那一次点击会立刻把它关掉（旧版 `setTimeout(…, 0)`）。
	 * ⚠ 依赖**空数组**、通过 ref 读最新 props：否则每次高亮变化（`setActive`）都会
	 *   重挂监听 —— 中间那 `setTimeout` 的空窗里点一下就不响应了。
	 */
	const latest = useRef(props);
	latest.current = props;

	useEffect(() => {
		const onDocumentClick = (event: MouseEvent): void => {
			const outside = isOutsideClick(
				event.composedPath(),
				menuRef.current,
				latest.current.anchor,
			);
			if (outside) latest.current.onClose();
		};
		const onScroll = (): void => latest.current.onClose();

		const timer = globalThis.setTimeout(() => {
			document.addEventListener('click', onDocumentClick, true);
			document.addEventListener('scroll', onScroll, true);
		}, 0);

		return () => {
			globalThis.clearTimeout(timer);
			document.removeEventListener('click', onDocumentClick, true);
			document.removeEventListener('scroll', onScroll, true);
		};
	}, []);

	/** 选一项：先关再派发（旧版的顺序：`menu.remove()` 然后 `execute()`）。 */
	const pick = useCallback(
		(action: ButtonAction): void => {
			props.onClose();
			props.onPick(action);
		},
		[props],
	);

	/*
	 * ── 键盘 ──
	 *
	 * 挂在菜单根上（不挂 document）：菜单开着时焦点应该在它里面，
	 * 挂 document 会抢别的输入框（详情页正文有 textarea）。
	 */
	const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
		const intent = keyIntentOf(event.key);
		if (intent === 'none') return;

		/* 这几键菜单要自己处理 ⇒ 不让它们冒泡到页面（否则空格会滚页面）。 */
		event.preventDefault();
		event.stopPropagation();

		if (intent === 'close') {
			props.onClose();
			return;
		}

		if (intent === 'pick') {
			const target = active >= 0 ? flat[active] : undefined;
			if (target !== undefined) pick(target.action);
			return;
		}

		setActive(nextIndex(active, intent, flat.length));
	};

	const root = (
		<div
			ref={menuRef}
			className="menu"
			role="menu"
			aria-label={model.title}
			data-menu="status"
			tabIndex={-1}
			onKeyDown={onKeyDown}
			/* 点菜单自己身上不该冒泡到 document（否则会被当成「点外面」，虽然路径判定也会放过它）。 */
			onClick={(event) => event.stopPropagation()}
		>
			<div className="menu__title">{model.title}</div>

			{model.empty ? (
				<div className="menu__empty" data-menu-empty="1">
					{MENU_EMPTY}
				</div>
			) : (
				model.sections.map((section, index) => (
					<div className="menu__section" key={section.group} data-menu-group={section.group}>
						{/* 段与段之间画分隔线（旧版：第一段之前不画）。 */}
						{index > 0 ? <div className="menu__divider" /> : null}
						{section.items.map((item) => {
							const index2 = indexOfItem(item);
							const cls = ['menu__item'];
							if (item.danger) cls.push('is-danger');
							if (index2 === active) cls.push('is-active');

							return (
								<button
									key={`${item.action.from}->${item.action.to}-${item.action.label}`}
									type="button"
									role="menuitem"
									className={cls.join(' ')}
									data-menu-item="1"
									data-menu-to={item.action.to}
									data-menu-method={item.action.method}
									data-menu-danger={String(item.danger)}
									onMouseEnter={() => setActive(index2)}
									onClick={() => pick(item.action)}
								>
									<span className="menu__icon" aria-hidden="true">
										{item.icon}
									</span>
									<span className="menu__label">{item.action.label}</span>
									{item.hint === '' ? null : (
										<span className="menu__hint">{item.hint}</span>
									)}
								</button>
							);
						})}
					</div>
				))
			)}

			<div className="menu__footer">{model.footer}</div>
		</div>
	);

	/* ⚠ 挂 `document.body`：菜单是 `fixed` 浮层，留在详情面板里会被 `overflow: hidden` 裁掉。 */
	return createPortal(root, document.body);
}
