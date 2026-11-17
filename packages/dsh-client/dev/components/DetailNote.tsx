/**
 * 详情**备注** —— 常驻的输入框。
 *
 * ## 用户 `2026-11-15`：
 * > 「备注常驻」（不要折叠成 `+ 备注`）
 *
 * 「常驻」是**类型级**保证，不是这里才决定：`DetailNoteView.visible` 的类型是
 * 字面量 `true`（见 `dev/pure/card-detail.ts`）⇒ 上游不可能给出 `false`。
 * 本组件因此**没有** `if (!note.visible) return null` 这种分支 ——
 * 写了就是给一个不可达分支写分支。
 *
 * ## 为什么不是受控组件
 *
 * 备注是「随时写」的**草稿式输入**：每敲一个字就往上抛一次会让上层重渲染整张详情
 * （章节、历史都跟着重算）。旧版 `index.js:68-71` 是 `onBlur` 才 `saveNote()`。
 *
 * ⇒ 这里用 `defaultValue`（非受控）+ **失焦提交**：
 *
 * ```tsx
 * <textarea defaultValue={note.value} onBlur={(e) => … onNoteChange(e.target.value)} />
 * ```
 *
 * ⚠ `key={note.value}` 不是笔误：卡被 AI 改了（SSE 推来新 note）时，
 *   非受控 textarea 不会自己更新，得靠换 key 重建。**只在我没在编辑时**才该重建
 *   —— 但「我在不在编辑」是上层的事；这里用 `key` 的代价是「AI 改备注会吃掉我的
 *   未提交输入」，比反过来（界面显示旧备注、用户以为保存了）轻。
 *
 * ## 保存判重
 *
 * 旧版 `saveNote()` 先比 `value === card.note`，相同就不发请求
 * （失焦一次就发一次 PATCH 是纯粹的浪费）。这个判断**留在组件调用点**
 * —— 它需要「原值」和「新值」两个值，都是组件手里的东西。
 */

import type { ReactNode } from 'react';

import type { DetailNoteView } from '../pure/card-detail.ts';

/** 组件属性。 */
export interface DetailNoteProps {
	/** `noteOf()` 的产物。 */
	readonly note: DetailNoteView;
	/** 失焦提交（值没变时组件不调）。 */
	readonly onNoteChange: (text: string) => void;
}

/**
 * 备注区块。**永远渲染**（见文件头）。
 *
 * @param props 见 `DetailNoteProps`
 */
export function DetailNote(props: DetailNoteProps): ReactNode {
	const note = props.note;

	/** 失焦：值没变就什么都不做（见文件头「保存判重」）。 */
	const commit = (event: { readonly target: HTMLTextAreaElement }): void => {
		const next = event.target.value;
		if (next === note.value) return;
		props.onNoteChange(next);
	};

	return (
		<div className="detail-note" data-detail-note>
			<div className="detail-note__label">{note.label}</div>
			<textarea
				className="detail-note__input"
				data-note-input
				/*
				 * `key` 让「卡值变了」⇒ 换节点 ⇒ 非受控框显示新值。
				 * 值没变时 key 稳定，输入焦点不会被抢。
				 */
				key={note.value}
				defaultValue={note.value}
				placeholder={note.placeholder}
				disabled={!note.editable}
				rows={3}
				onBlur={commit}
			/>
			{note.editable ? null : (
				<div className="detail-note__readonly" data-note-readonly>
					这张卡已删除，备注只读。
				</div>
			)}
		</div>
	);
}
