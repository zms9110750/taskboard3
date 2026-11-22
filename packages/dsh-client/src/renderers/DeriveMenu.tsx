/**
 * 「+ 派生子任务」的**浮窗菜单**。
 *
 * ## 用户裁决（`2026-11-22`）
 *
 * > 「派生子任务，这个按钮点了以后应该有一个浮窗菜单。这个菜单要是一个组件。要做。」
 * > 「你去看看模板定义。他有说自己快捷派生的内容。如果没有定义，就留一个保留的按钮，
 * >   派生空模板。」
 * > 「派生的模板定义是为 ui 服务的快捷入口。从这里点击的派生就是走新建。
 * >   自动设置父任务和标题和模板。只有这个效果。」
 *
 * ⇒ 本组件只做两件事：
 *
 * 1. **画** 菜单（`deriveMenuItemsOf()` 算出来的项）
 * 2. **上报** 用户点了哪一项（`onPick`）
 *
 * 预填值怎么算在 `pure/derive-menu.ts` 的 `derivePrefillOf()` —— 那是判决，
 * 本组件不参与。**AI tool 不走这条路**：它直接调 `taskboard_create`。
 *
 * ## 为什么照抄 `StatusMenu` 的形态
 *
 * 那个是已经过了验收的浮层菜单（portal 到 `document.body` + `position: fixed` +
 * `placeMenu()` 定位 + `isOutsideClick()` 关闭 + 键盘导航）。**照抄不是偷懒** ——
 * 两个菜单在同一屏里出现，交互必须一致：
 *
 * | 行为 | 两个菜单 |
 * |---|---|
 * | 挂在哪 | `document.body`（会被 `overflow:hidden` 裁掉的地方不能留）|
 * | 定位 | 按钮下方，放不下翻到上方 |
 * | 关闭 | 点外面 / 滚动 / Escape |
 * | 键盘 | ↑↓ 移动、Enter 选、Esc 关 |
 *
 * ⇒ 差异只在内容（那边的项来自状态转移表，这边的项来自模板 `derives`）。
 *
 * ## 空 `derives` 的兜底
 *
 * 用户：「如果没有定义，就留一个保留的按钮，派生空模板。」
 * ⇒ `deriveMenuItemsOf([])` 返回**恰好一项**（不是空数组）——
 *   见那个函数的注释（空菜单框会让用户以为界面坏了）。
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';

import {
	isOutsideClick,
	keyIntentOf,
	nextIndex,
	placeMenu,
} from '../pure/status-menu.ts';
import {
	DERIVE_MENU_FOOTER,
	DERIVE_MENU_TITLE,
	type DeriveMenuItem,
} from '../pure/derive-menu.ts';

/** 组件属性。 */
export interface DeriveMenuProps {
	/** 菜单项（`deriveMenuItemsOf()` 的产物，**非空**）。 */
	readonly items: readonly DeriveMenuItem[];
	/** 触发按钮（定位基准 + 「点它不关」的排除项）。 */
	readonly anchor: HTMLElement | null;
	/** 点了某一项。 */
	readonly onPick: (item: DeriveMenuItem) => void;
	/** 请求关闭（点外面 / Escape / 滚动）。 */
	readonly onClose: () => void;
}

/**
 * 派生子任务菜单。
 *
 * @param props 见 `DeriveMenuProps`
 */
export function DeriveMenu(props: DeriveMenuProps): ReactNode {
	const menuRef = useRef<HTMLDivElement>(null);
	const items = props.items;
	/** 键盘高亮下标（`-1` = 没有）。鼠标移入也会改它。 */
	const [active, setActive] = useState<number>(-1);

	/*
	 * ── 定位 ──
	 *
	 * 照 `StatusMenu` 的三步：先写「能量到但看不见」的初值 → 量真实高度算位置
	 * → 写真实坐标。`useLayoutEffect` 保证在绘制前完成，不会先闪在 (0,0)。
	 */
	useLayoutEffect(() => {
		const menu = menuRef.current;
		const anchor = props.anchor;
		if (menu === null || anchor === null) return;

		menu.style.visibility = 'hidden';
		menu.style.left = '0px';
		menu.style.top = '0px';
		menu.style.maxHeight = 'none';

		const naturalHeight = menu.offsetHeight;
		const box = anchor.getBoundingClientRect();
		const placement = placeMenu(
			{ left: box.left, top: box.top, right: box.right, bottom: box.bottom },
			naturalHeight,
			{ width: globalThis.innerWidth, height: globalThis.innerHeight },
		);

		menu.style.maxHeight = `${placement.maxHeight}px`;
		menu.style.left = `${placement.left}px`;
		menu.style.top = `${placement.top}px`;
		menu.style.visibility = '';
	}, [props.anchor, items.length]);

	/*
	 * ── 关闭：点外面 / 滚动 / Escape ──
	 *
	 * `latest` ref 读最新 props：依赖空数组，否则每次高亮变化（`setActive`）
	 * 都会重挂监听 —— 中间 `setTimeout` 的空窗里点一下就不响应了（`StatusMenu` 踩过）。
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

		/*
		 * 延后一拍再挂：否则**打开菜单的那一次点击**会立刻把它关掉
		 * （菜单是在 click 里挂上去的，监听同一次 click 就已经在 document 上了）。
		 */
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

	/** 选一项：先关再派发。 */
	const pick = useCallback((item: DeriveMenuItem): void => {
		props.onClose();
		props.onPick(item);
	}, [props]);

	/*
	 * ── 键盘 ──
	 *
	 * 挂在菜单根上（不挂 document）：菜单开着时焦点应该在它里面，
	 * 挂 document 会抢详情页正文的 `textarea`。
	 */
	const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
		const intent = keyIntentOf(event.key);
		if (intent === 'none') return;

		event.preventDefault();
		event.stopPropagation();

		if (intent === 'close') {
			props.onClose();
			return;
		}

		if (intent === 'pick') {
			const target = active >= 0 ? items[active] : undefined;
			if (target !== undefined) pick(target);
			return;
		}

		setActive(nextIndex(active, intent, items.length));
	};

	const root = (
		<div
			ref={menuRef}
			className="menu"
			role="menu"
			aria-label={DERIVE_MENU_TITLE}
			data-menu="derive"
			tabIndex={-1}
			onKeyDown={onKeyDown}
			onClick={(event) => event.stopPropagation()}
		>
			<div className="menu__title">{DERIVE_MENU_TITLE}</div>

			{items.map((item, index) => {
				const cls = ['menu__item'];
				if (index === active) cls.push('is-active');

				return (
					<button
						key={item.key}
						type="button"
						role="menuitem"
						className={cls.join(' ')}
						data-derive-item="1"
						data-derive-template={item.template ?? ''}
						onMouseEnter={() => setActive(index)}
						onClick={() => pick(item)}
					>
						<span className="menu__icon" aria-hidden="true">
							＋
						</span>
						<span className="menu__label">{item.label}</span>
						{item.description === undefined ? null : (
							<span className="menu__hint">{item.description}</span>
						)}
					</button>
				);
			})}

			<div className="menu__footer">{DERIVE_MENU_FOOTER}</div>
		</div>
	);

	/* ⚠ 挂 `document.body`：`fixed` 浮层留在详情面板里会被 `overflow:hidden` 裁掉。 */
	return createPortal(root, document.body);
}
