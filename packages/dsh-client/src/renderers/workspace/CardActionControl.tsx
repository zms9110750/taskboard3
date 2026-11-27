/**
 * 「是否允许领卡」控件 —— 任务板工具栏里那颗，放在「工作空间 ▾」左边。
 *
 * ## 用户裁决（`2026-11-23`）
 *
 * > 「是否允许领卡的那个权限。放在工作空间这个按钮的左边。
 * >   他是一般ui提供的权限。影响的工具是通用tool的。所以放在一般ui里面。」
 *
 * 拆成三句：
 *
 * | 用户的话 | 落点 |
 * |---|---|
 * | 「放在工作空间这个按钮的左边」 | 本组件渲染在 `WorkspaceToolbar` 的右列里、`space` 之前 |
 * | 「一般 ui 提供的权限」 | 归任务板自己的工具栏（三处入口同一套 DOM ⇒ 三处都有）|
 * | 「影响的工具是通用 tool 的」 | 就是 `CardActionLevel`：`no-claim` / `claim` / `adopt` —— 管 AI 能不能领卡、能不能采纳草稿 |
 *
 * ## 它和 composer 那个权限框的分工
 *
 * ```
 * 本控件（任务板工具栏）      → cardActionLevel  ← 一般 UI 的权限
 * composer 权限框（盾牌按钮） → toolGuardLevel   ← agent 侧的权限
 * ```
 *
 * ⇒ 自建的单轴 store（`pure/card-permission-state.ts`），只显示 card 轴。
 *   ⚠ 2026-11-27 拆分后与 composer 权限框（`@taskboard/dsh-permissions`）
 *   **不再共享 store** —— 打开本控件的下拉会强制重拉一次（`refreshCardPermission`）。
 *
 * ## 为什么不自己拉数据
 *
 * 状态在模块级 store 里（三个入口共用一份）。本组件只做三件事：
 * `useCardPermission()` 读、`ensureCardPermissionLoaded()` 确保拉过一次、
 * `refreshCardPermission()` 打开下拉时重拉。
 *
 * ## 文案从哪来
 *
 * **档位 label / description 全部来自接口返回的 `cardActionOptions`** ——
 * `pure/card-permission.ts` 的 `labelOf()`。本文件**不硬编码任何档位文案**
 * （第二份文案漂移时不会报错，只会静默显示一个存不进去的档）。
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { labelOf } from '../../pure/card-permission.ts';
import {
	ensureCardPermissionLoaded,
	refreshCardPermission,
	selectCardPermissionLevel,
	useCardPermission,
} from '../../pure/card-permission-state.ts';

/** 下拉里一项。 */
interface Option {
	readonly value: string;
	readonly label: string;
	readonly description: string;
}

/**
 * 「是否允许领卡」控件。
 *
 * @returns 紧凑 pill + 点击展开的三档单选；数据没准备好时渲染一个禁用壳
 */
export function CardActionControl(): ReactNode {
	const state = useCardPermission();
	const [open, setOpen] = useState(false);
	const rootRef = useRef<HTMLSpanElement | null>(null);

	/* 挂载就确保拉过一次（不开页面）。三个入口各挂一个，store 里有 in-flight 闸。 */
	useEffect(() => {
		void ensureCardPermissionLoaded();
	}, []);

	/* 打开下拉就强制重拉一次 —— 拆分后 composer 面板（另一个包）改了 card 轴
	 * 不会通知本 store；打开那一刻重拉，保证显示的是「现在」的值。 */
	useEffect(() => {
		if (!open) return;
		void refreshCardPermission();
	}, [open]);

	/* 点外面关掉下拉 —— 工具栏很窄，下拉必须能一键消失。 */
	useEffect(() => {
		if (!open) return;
		const onDown = (event: MouseEvent): void => {
			if (rootRef.current?.contains(event.target as Node) === true) return;
			setOpen(false);
		};
		document.addEventListener('mousedown', onDown);
		return () => {
			document.removeEventListener('mousedown', onDown);
		};
	}, [open]);

	const ready = state.phase === 'ready';
	const options: readonly Option[] = ready ? state.options : [];
	const current = ready ? state.level : '';
	const pending = ready && state.pending !== null;

	/*
	 * ⚠ 数据没就绪时**不编造档位**（同 `PermissionBoxEntry` 的理由）：
	 *   显示一个假的「不允许领卡」比显示占位更坏 —— 用户会以为那就是当前设置。
	 */
	const label = ready ? labelOf(options, current) : '领卡';
	/* 「非默认」= 有人改过档位，边框转蓝（同 composer 那颗盾牌按钮的约定）。 */
	const nonDefault = ready && current !== 'no-claim';
	const title = ready
		? `任务板权限（一般 UI）：${label} —— ${
				options.find((one) => one.value === current)?.description ?? ''
			}（点击修改）`
		: '任务板权限（一般 UI）：还没读到当前档位';

	return (
		<span className="tb3w-cardact" data-card-action-control ref={rootRef}>
			<button
				type="button"
				className="tb3w-cardact__btn"
				data-card-action-btn="1"
				data-phase={state.phase}
				data-pending={String(pending)}
				data-non-default={String(nonDefault)}
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-label={`是否允许领卡：${label}`}
				title={title}
				onClick={() => {
					setOpen((now) => !now);
				}}
			>
				{/*
				 * ⚠ **不写「领卡」前缀**：档位 label 本身已经含「领卡」二字
				 *   （`不允许领卡` / `允许领卡` / `允许采纳草稿`），
				 *   再加前缀会读成「领卡 不允许领卡」—— 又长又绕。
				 *   少这 28px 宽也直接帮到 952 宽抽屉那一档。
				 */}
				<span className="tb3w-cardact__value" data-card-action-value="1">
					{label}
				</span>
				<span className="tb3w-cardact__caret" aria-hidden="true">
					▾
				</span>
			</button>

			{open && ready ? (
				<span className="tb3w-cardact__menu" role="listbox" aria-label="是否允许领卡" data-card-action-menu="1">
					{options.map((option) => {
						const selected = option.value === current;
						return (
							<button
								key={option.value}
								type="button"
								role="option"
								aria-selected={selected}
								className={selected ? 'tb3w-cardact__opt is-on' : 'tb3w-cardact__opt'}
								data-card-action-opt={option.value}
								title={option.description}
								onClick={() => {
									setOpen(false);
									void selectCardPermissionLevel(option.value);
								}}
							>
								<span className="tb3w-cardact__opt-label">{option.label}</span>
								<span className="tb3w-cardact__opt-desc">{option.description}</span>
							</button>
						);
					})}
				</span>
			) : null}
		</span>
	);
}
