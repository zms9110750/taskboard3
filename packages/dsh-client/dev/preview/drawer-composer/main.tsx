/**
 * 抽屉 **单栏模拟页** —— 一个「像真 DSH 对话页」的完整 composer，可点开合。
 *
 * 和候选对比页的区别：这里**不给模拟屏高**（用真实浏览器 `vh`），
 * 面板高度就是产品里那个 `min(50vh, 480px)` / `50vh`；空间大，位置关系看得最真。
 *
 * ## 看什么
 *
 * - 入口正方形：**右边缘贴输入框左边缘**，和 `+` 同一行、在它左边；
 * - 点入口 ⇒ 面板从输入框上方向外展开，**宽度跟输入框完全一致**；
 * - 面板底边贴输入框上边缘（间距随形态：0 / 6px / 12px）；
 * - 面板遮挡后方对话内容（浮层，不推挤布局）；
 * - 面板里是**压缩版 Workspace**（真组件，不是示意图）。
 *
 * ## 怎么玩
 *
 * 顶部按钮切 A / B / C 三个候选形态（同一份数据，看外观差异）；
 * 点入口 / 「开·合」按钮开合；Esc / 点面板外关闭。
 */

import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { initRenderers } from '../../../src/init-renderers.ts';
import {
	DRAWER_VARIANTS,
	DRAWER_VARIANT_IDS,
	createDrawerStore,
} from '../../../src/pure/drawer-view.ts';
import type { DrawerVariantId } from '../../../src/pure/drawer-view.ts';
import { useDrawerStore } from '../../../src/renderers/Drawer.tsx';
import { injectStyles } from '../../../src/styles.ts';
import { MockComposer, injectMockStyles } from '../drawer/mock-composer.tsx';
import { mockWorkspaceProps } from '../drawer/mock-workspace.ts';

/** 预览页。 */
function App(): React.ReactNode {
	const [variantId, setVariantId] = useState<DrawerVariantId>('b');
	const [selectedId, setSelectedId] = useState<string | null>('GU-02');
	const [notice, setNotice] = useState<string | undefined>(undefined);

	/*
	 * 切形态 ⇒ 换一个 store（形态是 store 的配置）。初始打开，用户一进来就能看到面板。
	 * ⚠ 切形态会重置开合状态 —— 这是预览的选择，不是产品行为。
	 */
	const store = useMemo(() => createDrawerStore(variantId, true), [variantId]);
	const drawer = useDrawerStore(store);

	const workspace = useMemo(
		() =>
			mockWorkspaceProps({
				selectedId,
				onSelect: setSelectedId,
				onSay: setNotice,
			}),
		[selectedId],
	);

	const variant = DRAWER_VARIANTS[variantId];

	return (
		<div className="pv">
			<header className="pv-bar">
				<span className="pv-bar__tag">抽屉 V5 · 单栏模拟（真 composer 布局）</span>
				<span className="pv-bar__note">
					点输入框左下角的正方形入口开合；Esc / 点面板外关闭。
				</span>
				<span className="pv-bar__sep" />
				<span className="pv-bar__label">候选形态</span>
				{DRAWER_VARIANT_IDS.map((id) => (
					<button
						key={id}
						type="button"
						className={`pv-bar__btn${id === variantId ? ' is-on' : ''}`}
						data-variant-btn={id}
						onClick={() => {
							setVariantId(id);
						}}
					>
						{DRAWER_VARIANTS[id].label}
					</button>
				))}
				<span className="pv-bar__sep" />
				<button
					type="button"
					className={`pv-bar__btn${drawer.open ? ' is-on' : ''}`}
					data-drawer-toggle="1"
					onClick={drawer.toggle}
				>
					{drawer.open ? '抽屉：开' : '抽屉：关'}
				</button>
			</header>

			<div className="pv-scroll">
				<div className="pvs-window" data-single-column="1">
					<div className="pvs-head">
						<span className="pvs-head__title">重构 taskboard2 项目代码</span>
						<span className="pvs-head__chip">标准模式</span>
						<span className="pvs-head__muted">28 个子智能体</span>
						<span className="pvs-head__state">{variant.summary}</span>
					</div>
					<MockComposer
						variant={variant}
						open={drawer.open}
						onToggle={drawer.toggle}
						onClose={drawer.close}
						workspace={workspace}
						title="任务板"
						onRefresh={() => {
							setNotice('抽屉：刷新（预览：没有服务端）');
						}}
					/>
				</div>
			</div>

			{notice === undefined ? null : (
				<div className="pv-toast" data-pv-toast="1">
					<span>{notice}</span>
					<button
						type="button"
						onClick={() => {
							setNotice(undefined);
						}}
					>
						知道了
					</button>
				</div>
			)}
		</div>
	);
}

/* 产品样式和预览是同一份。 */
initRenderers();
injectStyles();
injectMockStyles();

const root = document.getElementById('root');
if (root !== null) {
	createRoot(root).render(
		<StrictMode>
			<App />
		</StrictMode>,
	);
}
