/**
 * 权限框的**浮层** —— 贴在入口按钮旁边弹出，不铺满视口。
 *
 * ## 用户裁决（`2026-11-23`）
 *
 * > 「他还是全屏的。」
 *
 * 之前这里是 `PermissionBoxPage`：portal 到 `document.body`、`position:fixed;inset:0`
 * 铺满整个视口。用户的参照物是 **DSH 自己的 `仅可查看 ▾`** —— 贴在按钮旁边的小面板。
 *
 * ## 为什么不放在 `conversation.input.overlay` 槽里
 *
 * 「贴按钮」要求**锚点就是按钮自己**。overlay 槽是另一个独立槽条目，渲染在别的
 * DOM 位置，拿不到按钮的几何。
 *
 * ⇒ 改成**渲染在入口按钮的兄弟位置**（`.tb3pbox-anchor` 内，`position:relative`），
 *   浮层用 `position:absolute;bottom:calc(100% + 8px)` 从按钮**上方**弹出
 *   （composer 在视口底部，向下弹会出界）。
 *
 * ⇒ 于是 `conversation.input.overlay` 那条注册、以及 `PERMISSION_PAGE_*` 常量全部删除。
 *
 * ## 内容复用
 *
 * 直接复用 `PermissionPanel`（395 行定稿、441 行纯逻辑测试），**不复制选项渲染**。
 * 浮层只负责：外壳 + 关闭按钮 + 点外面 / Esc 关闭。
 *
 * ⚠ 面板自带 `<h2>任务板权限</h2>`，所以浮层**不再渲染第二个标题** ——
 *   只放一个绝对定位的关闭按钮，压在面板标题右侧。
 */

import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';

import {
	closePermissionBox,
	dismissPermissionSaveError,
	loadPermission,
	selectPermissionLevel,
	usePermissionBox,
} from '../pure/permission-box-state.ts';
import { PermissionPanel } from './PermissionPanel.tsx';

/**
 * 权限浮层。
 *
 * @returns 未打开时 `null`（不占 DOM）
 */
export function PermissionBoxPopover(): ReactNode {
	const { open, state } = usePermissionBox();
	const ref = useRef<HTMLDivElement | null>(null);
	const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined);

	/*
	 * 高度上限 = **按钮上方真实剩余空间**。
	 *
	 * ⚠ 不能只用 CSS `max-height: min(70vh, 520px)`：浮层是从按钮**上方**弹的，
	 *   按钮本身离视口顶部多远，CSS 算不出来。实测 1200×800 窗口（视口 1176×708）
	 *   里 423px 高的浮层 bottom=416 ⇒ **top=-7，顶边被切掉 7px**。
	 *
	 * ⇒ 打开时量一次「按钮 top − 16px」，作为 `maxHeight`（超出就内部滚动）。
	 *   窗口尺寸变化时重量一次。
	 */
	useEffect(() => {
		if (!open) {
			setMaxHeight(undefined);
			return undefined;
		}
		const measure = (): void => {
			const anchor = ref.current?.parentElement ?? null;
			const button = anchor?.querySelector('[data-permission-entry]') ?? anchor;
			if (button === null) return;
			const top = button.getBoundingClientRect().top;
			/* 留 16px 空隙，且不低于 240px（再小就没法用，宁可让它压一点点也不要截断档位）。 */
			setMaxHeight(Math.max(240, Math.round(top - 16)));
		};
		measure();
		window.addEventListener('resize', measure);
		return () => {
			window.removeEventListener('resize', measure);
		};
	}, [open]);

	/*
	 * Esc 关闭 + 点外面关闭。
	 *
	 * `mousedown` 而不是 `click`：`click` 要等鼠标松开，拖到外面再松开也会触发，
	 * 手感上比「一按下就关」迟钝。
	 *
	 * ⚠ **点在入口按钮上时不关** —— 按钮自己走 `togglePermissionBox()`。
	 *   否则 mousedown 先把它关了、click 又把它开回来，表现为「点按钮关不掉」。
	 */
	useEffect(() => {
		if (!open) return undefined;

		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key === 'Escape') closePermissionBox();
		};

		const onPointerDown = (event: MouseEvent): void => {
			const target = event.target;
			if (!(target instanceof Node)) return;
			const box = ref.current;
			if (box !== null && box.contains(target)) return;
			/* 锚点容器（含入口按钮）整体跳过，交给按钮自己的 toggle。 */
			const anchor = box?.parentElement ?? null;
			if (anchor !== null && anchor.contains(target)) return;
			closePermissionBox();
		};

		document.addEventListener('keydown', onKeyDown);
		/* 捕获阶段：宿主若有 `stopPropagation` 也不会漏掉关闭。 */
		document.addEventListener('mousedown', onPointerDown, true);
		return () => {
			document.removeEventListener('keydown', onKeyDown);
			document.removeEventListener('mousedown', onPointerDown, true);
		};
	}, [open]);

	if (!open) return null;

	return (
		<div
			ref={ref}
			className="tb3pbox-pop"
			data-permission-popover="1"
			role="dialog"
			aria-label="任务板权限"
			style={maxHeight === undefined ? undefined : { maxHeight }}
		>
			<button
				type="button"
				className="tb3pbox-pop__close"
				data-permission-close="1"
				title="关闭"
				aria-label="关闭"
				onClick={closePermissionBox}
			>
				×
			</button>
			{/*
			 * ⚠ **必须传 `axes={['tool']}`**：
			 *   省略 = 两轴都画 ⇒ 会把已经搬到任务板工具栏的 card 轴画回来。
			 *   点哪一档立刻保存，没有「保存」按钮 —— 那是面板自己的约定。
			 */}
			<PermissionPanel
				axes={['tool']}
				state={state}
				onSelect={(axis, value) => {
					void selectPermissionLevel(axis, value);
				}}
				onRetry={() => {
					void loadPermission();
				}}
				onDismissSaveError={dismissPermissionSaveError}
			/>
		</div>
	);
}

