/**
 * 模拟真 composer 的壳 —— **两个预览页共用**（候选对比页 / 单栏模拟页）。
 *
 * ## 为什么必须「照真结构」而不是随便画个输入框
 *
 * 用户要判断的是**位置关系**：入口正方形相对输入框在哪、面板底边贴在哪。
 * 所以这里的 DOM / 布局尽量照 DSH `InputBar`（`2026-11-20` 从 app.asar 里读的原文）：
 *
 * ```html
 * <div class="root">                       <!-- 对话列底部 -->
 *   <div class="card" style="position:relative">   <!-- 输入框卡片 -->
 *     <div class="overlayAnchor" style="position:absolute;inset:0 0 auto;height:0">
 *       <!-- conversation.input.overlay 槽：抽屉面板挂这里 -->
 *     </div>
 *     <div class="scroll"><div class="input">发消息或创建任务…</div></div>
 *     <div class="row" style="padding:2px 8px 6px">
 *       <div class="tools" style="gap:12px">
 *         <button class="add">＋</button>   <!-- 28px -->
 *         <span class="modes">完全权限 ▾</span>
 *         <!-- conversation.input.left 槽：🏠 正方形入口挂这里 -->
 *       </div>
 *       <div class="trailing"><span>DeepSeek V4.1 Flash</span><button class="primary">↑</button></div>
 *     </div>
 *   </div>
 * </div>
 * ```
 *
 * **真组件**：`DrawerEntry` / `Drawer`（`src/renderers/Drawer.tsx`）与面板里的
 * `<Workspace />` 都是产品同一份；样式来自 `injectStyles()`（产品同一份 CSS）。
 * **假**：没有服务端，对话内容是死的；`+` / 发送 / 权限只是画出来的。
 *
 * ## CSS 为什么在 TS 里而不是 style.css
 *
 * 两个预览目录各有一份 `style.css`，但**这段 mock 结构必须两边完全一致** ——
 * 复制两份迟早漂。⇒ 以 `MOCK_CSS` 常量导出，两个页面各自 `injectMockStyles()` 注入。
 */

import type { CSSProperties, ReactNode } from 'react';

import type { DrawerVariant } from '../../../src/pure/drawer-view.ts';
import { Drawer, DrawerEntry } from '../../../src/renderers/Drawer.tsx';
import type { WorkspaceProps } from '../../../src/renderers/Workspace.tsx';

/** `MockComposer` 的属性。 */
export interface MockComposerProps {
	/** 当前候选形态（入口图标 + 面板外观）。 */
	readonly variant: DrawerVariant;
	/** 抽屉是否打开。 */
	readonly open: boolean;
	/** 点入口 / 预览按钮：开合。 */
	readonly onToggle: () => void;
	/** 关闭（Esc / 点外部 / ×）。 */
	readonly onClose: () => void;
	/** 面板里那个 `<Workspace />` 的数据。 */
	readonly workspace: WorkspaceProps;
	/** 面板标题（默认「任务板」）。 */
	readonly title?: string;
	/** 刷新回调（省略 = 不画刷新按钮）。 */
	readonly onRefresh?: () => void;
	/** 对话区是否画几条假消息（候选对比页的窄列可关掉，省空间）。 */
	readonly showConversation?: boolean;
}

/**
 * 一条假消息。
 *
 * @param props.role 谁说的
 * @param props.text 内容
 */
function MockMessage(props: { readonly role: 'user' | 'ai'; readonly text: string }): ReactNode {
	return (
		<div className={`pvm-msg pvm-msg--${props.role}`} data-mock-message={props.role}>
			<span className="pvm-msg__who">{props.role === 'user' ? '你' : 'DeepSeek'}</span>
			<span className="pvm-msg__text">{props.text}</span>
		</div>
	);
}

/**
 * 模拟的 composer + 上方抽屉面板。
 *
 * @param props 见 `MockComposerProps`
 */
export function MockComposer(props: MockComposerProps): ReactNode {
	return (
		<div className="pvm" data-mock-composer="1">
			<div className="pvm-conv" data-mock-conversation="1">
				{props.showConversation === false ? null : (
					<>
						<div className="pvm-conv__head">
							<span className="pvm-conv__title">重构 taskboard2 项目代码</span>
							<span className="pvm-conv__chip">标准模式</span>
						</div>
						<MockMessage role="user" text="抽屉从输入框上方展开，宽度跟输入框一致。" />
						<MockMessage
							role="ai"
							text="好的。入口是正方形，在输入框左外侧，和 + 同一行。"
						/>
					</>
				)}
			</div>

			{/*
			 * composer 的根：真 DSH 里是 InputBar.root。
			 * 卡片 `position:relative` —— 入口按钮的 absolute 以它为包含块（asar 原文）。
			 */}
			<div className="pvm-composer" data-mock-composer-root="1">
				<div className="pvm-card" data-mock-composer-card="1">
					{/*
					 * overlayAnchor：真 DSH 原文 `.overlayAnchor{height:0;position:absolute;inset:0 0 auto}`。
					 * 面板相对这一层 `bottom:100%` ⇒ 底边正好在卡片上边缘。
					 */}
					<div className="pvm-anchor" data-mock-overlay-anchor="1">
						<Drawer
							open={props.open}
							onClose={props.onClose}
							variant={props.variant}
							workspace={props.workspace}
							{...(props.title === undefined ? {} : { title: props.title })}
							{...(props.onRefresh === undefined ? {} : { onRefresh: props.onRefresh })}
						/>
					</div>

					<div className="pvm-editor" data-mock-editor="1">
						<span className="pvm-placeholder">发消息或创建任务…</span>
					</div>

					<div className="pvm-row" data-mock-tool-row="1">
						<div className="pvm-tools" data-mock-tools="1">
							{/* 真 DSH 里 `+` 是 28px 圆钮（.add{width:28px;height:28px}）。 */}
							<button type="button" className="pvm-add" data-mock-add="1" aria-label="添加">
								＋
							</button>
							<span className="pvm-mode">完全权限 ▾</span>
							{/* conversation.input.left 槽：真组件入口挂在这里 */}
							<DrawerEntry open={props.open} onToggle={props.onToggle} variant={props.variant} />
						</div>
						<div className="pvm-trailing" data-mock-trailing="1">
							<span className="pvm-model">DeepSeek V4.1 Flash ▾</span>
							<button type="button" className="pvm-send" data-mock-send="1" aria-label="发送">
								↑
							</button>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

/** 模拟 composer 的结构样式（两个预览页共用同一份）。 */
export const MOCK_CSS = `
.pvm{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;background:#fff}
.pvm-conv{flex:1 1 auto;min-height:0;overflow:hidden;display:flex;flex-direction:column;gap:10px;padding:16px 20px}
.pvm-conv__head{display:flex;align-items:center;gap:8px;padding-bottom:8px;border-bottom:1px solid #f0f2f5}
.pvm-conv__title{color:#1f2328;font-size:13px;font-weight:700}
.pvm-conv__chip{padding:2px 8px;border-radius:10px;background:#f1f3f6;color:#6b7280;font-size:10px}
.pvm-msg{display:flex;flex-direction:column;gap:3px;max-width:86%}
.pvm-msg--user{align-self:flex-end;align-items:flex-end}
.pvm-msg__who{color:#9aa1ad;font-size:10px}
.pvm-msg__text{padding:7px 11px;border-radius:10px;background:#f4f6f8;color:#3f4750;font-size:12px;line-height:1.7}
.pvm-msg--user .pvm-msg__text{background:#eaf1fe;color:#233247}

/*
 * ⚠ 左右 padding 必须 ≥ 入口按钮伸出去的量（32px）+ 一点余量：
 *   入口是 left:-32px，卡片贴边时会被列的 overflow:hidden 裁掉。
 *   真 DSH 用 --dsh-composer-side-clearance 留这条缝（具体值未验证）；
 *   预览里给 44px，保证正方形完整可见。
 */
.pvm-composer{flex:0 0 auto;display:flex;justify-content:center;padding:0 44px 22px}
.pvm-card{
  position:relative;width:100%;max-width:760px;
  display:flex;flex-direction:column;gap:12px;padding-top:8px;
  border-radius:18px;background:#fff;color:#16181d;
  box-shadow:0 0 0 1px rgb(15 23 42 / 8%),0 10px 30px rgb(15 23 42 / 10%);
  font-size:14px;line-height:1.65;
}
.pvm-anchor{position:absolute;left:0;right:0;top:0;height:0}
.pvm-editor{min-height:46px;padding:4px 14px 0;font-size:14px}
.pvm-placeholder{color:#9aa1ad}
.pvm-row{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;min-width:0;padding:2px 8px 6px}
.pvm-tools{display:flex;align-items:center;gap:12px;min-width:0}
.pvm-add{display:grid;place-items:center;width:28px;height:28px;padding:0;border:none;border-radius:999px;background:#eef0f4;color:#3f4750;font-family:inherit;font-size:15px;line-height:1;cursor:pointer;flex:none}
.pvm-mode{color:#4b5563;font-size:12.5px;white-space:nowrap}
.pvm-trailing{display:flex;align-items:center;gap:12px;flex:none;margin-left:auto}
.pvm-model{color:#6b7280;font-size:12.5px;white-space:nowrap}
.pvm-send{display:grid;place-items:center;width:34px;height:34px;padding:0;border:none;border-radius:999px;background:#2563eb;color:#fff;font-family:inherit;font-size:15px;line-height:1;cursor:pointer;transform:translateY(-2px)}
`;

/** 把 mock 结构样式插进页面（幂等）。 */
export function injectMockStyles(): void {
	if (document.getElementById('tb3d-mock-composer-css') !== null) return;
	const element = document.createElement('style');
	element.id = 'tb3d-mock-composer-css';
	element.textContent = MOCK_CSS;
	document.head.appendChild(element);
}

/**
 * 把「模拟屏高」写进舞台的 CSS 变量。
 *
 * 面板高度公式里有 `--tb3d-vh`（默认 `100vh`）：候选对比页三列并排时，
 * 浏览器 vh 对三列是一样的、高度维度看不出差别 ⇒ 每列显式给一个模拟屏高。
 *
 * @param heightPx 模拟屏幕高（px）
 */
export function screenVarStyle(heightPx: number): CSSProperties {
	/*
	 * ⚠ 断言：`CSSProperties` 不收录自定义属性（`--x`）。
	 *   这是 React 外部类型限制，不是我们想绕过检查 —— 变量名与
	 *   `drawerHeightCssOf()` 里的 `var(--tb3d-vh,100vh)` 对应，改一处必须改两处。
	 */
	return { height: `${String(heightPx)}px`, '--tb3d-vh': `${String(heightPx)}px` } as CSSProperties;
}
