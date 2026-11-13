/**
 * 状态菜单 —— **按钮的唯一来源是 `protocol` 的 `BUTTON_ACTIONS`**。
 *
 * ## 为什么 UI 不自己判状态
 *
 * `protocol` 的 `buttonsOf(kind, from, actor)` 已经把「这个类别、这个状态、
 * 这个人能点哪些按钮」算完了。UI 再写一遍 `if (status === DRAFT)` 就是
 * 把规则抄一份 —— 改一处不报错。
 *
 * ## 为什么要二次确认「收尾」按钮
 *
 * 用户 `2026-11-13` 裁定「人通过按钮进入终结态」—— 那意味着这类按钮是
 * **唯一**且**不可逆**的路径（除取消态的重开）。误点就没了，所以要确认。
 *
 * ## 关闭监听必须挂冒泡阶段
 *
 * 旧仓库踩过的坑：关闭监听挂在**捕获阶段**，比按钮的 `onClick` 先跑，
 * 导致「点开立刻关」，代码读起来完全正确。见本文件 `useEffect` 的注释。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { buttonsOf, type ButtonAction, type KindId, type TaskState } from '@taskboard/protocol';

import { isFinishingButton, toCardAction } from '../actions.ts';
import { CLS } from '../styles.ts';
import type { CardAction } from '../types.ts';

/** 状态菜单的属性。 */
export interface StatusMenuProps {
	/** 这张卡的类别。 */
	readonly kind: KindId;
	/** 当前状态。 */
	readonly from: string;
	/** 有请求在飞时禁用。 */
	readonly disabled: boolean;
	/** 点了某个按钮。 */
	readonly onPick: (action: CardAction) => void;
}

/**
 * 一个「按钮 → 弹菜单 → 选项」的完整交互。
 */
export function StatusMenu(props: StatusMenuProps): ReactNode {
	const [open, setOpen] = useState(false);
	const wrapRef = useRef<HTMLSpanElement | null>(null);

	useEffect(() => {
		if (!open) return;
		/*
		 * ⚠ 第三个参数是 `false`（冒泡阶段）。挂 `true`（捕获）会比
		 *   触发器自己的 onClick 先跑 —— 菜单永远打不开。
		 */
		const onDocClick = (event: MouseEvent): void => {
			const target = event.target;
			if (wrapRef.current !== null && target instanceof Node && wrapRef.current.contains(target)) return;
			setOpen(false);
		};
		const onKey = (event: KeyboardEvent): void => {
			if (event.key === 'Escape') setOpen(false);
		};
		document.addEventListener('click', onDocClick, false);
		document.addEventListener('keydown', onKey, false);
		return () => {
			document.removeEventListener('click', onDocClick, false);
			document.removeEventListener('keydown', onKey, false);
		};
	}, [open]);

	const pick = useCallback(
		(button: ButtonAction): void => {
			setOpen(false);
			if (isFinishingButton(button)) {
				const ok = globalThis.confirm(`「${button.label}」之后不可撤销（除取消态可重开）。继续？`);
				if (!ok) return;
			}
			props.onPick(toCardAction(button));
		},
		[props],
	);

	const buttons = buttonsOf(props.kind, props.from as TaskState, 'user');

	return (
		<span className={CLS.menuWrap} ref={wrapRef}>
			<button
				type="button"
				className={CLS.btn}
				aria-haspopup="menu"
				aria-expanded={open}
				disabled={props.disabled}
				onClick={() => setOpen((prev) => !prev)}
			>
				状态
			</button>
			{open ? (
				<span className={CLS.menu} role="menu">
					{buttons.length === 0 ? (
						<span className={CLS.menuEmpty}>没有可用操作</span>
					) : (
						buttons.map((button) => (
							<button
								key={`${button.from}->${button.to}-${button.label}`}
								type="button"
								role="menuitem"
								className={CLS.menuItem}
								onClick={() => pick(button)}
							>
								{button.label}
							</button>
						))
					)}
				</span>
			) : null}
		</span>
	);
}
