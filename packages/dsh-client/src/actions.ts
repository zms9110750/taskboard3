/**
 * 把「点一个按钮」翻译成 `CardAction`（纯函数）。
 *
 * ## 为什么需要这一层
 *
 * `protocol` 的 `ButtonAction` 带 `method: 'adopt' | 'claim' | 'release' | 'transition'`
 * —— 那是**语义**。API 要的是**动作对象**。两者之间的映射只应该有一处，
 * 否则 UI 和 AI 工具会各写一份、漂了不报错。
 *
 * 本模块零 React、零网络、零 DOM ⇒ 纯单测覆盖。
 */

import type { ButtonAction } from '@taskboard/protocol';
import { isEndedState } from '@taskboard/protocol';

import type { CardAction } from './types.ts';

/**
 * 把一个按钮翻译成 API 动作。
 *
 * @param button `protocol` 的按钮定义
 * @returns 可以直接交给 `api.act()` 的动作
 */
export function toCardAction(button: ButtonAction): CardAction {
	switch (button.method) {
		case 'adopt':
			return { kind: 'adopt' };
		case 'claim':
			return { kind: 'claim' };
		case 'release':
			return { kind: 'release' };
		case 'transition':
			return { kind: 'transition', to: button.to };
	}
}

/**
 * 这个按钮点下去是不是「收尾」（进终结态）。
 *
 * UI 用它决定是否二次确认 —— 用户 `2026-11-13` 裁定「人通过按钮进终结态」，
 * 那意味着这类按钮一旦误点就不可逆（除了取消态的「重开」）。
 *
 * @param button 按钮定义
 * @returns 目标状态是否属于 `ended` 组
 */
export function isFinishingButton(button: ButtonAction): boolean {
	return isEndedState(button.to);
}
