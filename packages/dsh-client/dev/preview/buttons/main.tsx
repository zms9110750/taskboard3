/**
 * 按钮组件候选预览 —— **两套配色并排**，让用户选。
 *
 * 左：深色（设计图 `view-3-workspace` + taskboard2 截图一致的体系）
 * 右：蓝色（当前 `Workspace.tsx` 内联按钮用的体系）
 *
 * ⚠ 这不是「视口」，是**组件对比**。三类按钮 × 各种状态都摊开。
 */

import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { ActionButton, CountChip, SegmentedControl } from '../../components/buttons.tsx';
import type { BtnTheme } from '../../components/buttons.tsx';

/** 一套按钮的全部形态。 */
function Specimen(props: { readonly theme: BtnTheme }): React.ReactNode {
	const [view, setView] = useState<'tree' | 'list'>('tree');

	return (
		<div className="spec" data-theme={props.theme}>
			<div className="spec__row">
				<span className="spec__k">分段</span>
				<SegmentedControl
					theme={props.theme}
					value={view}
					onChange={setView}
					options={[
						{ value: 'tree', label: '科技树' },
						{ value: 'list', label: '列表' },
					]}
				/>
				<SegmentedControl
					theme={props.theme}
					value={'grid'}
					onChange={() => undefined}
					options={[
						{ value: 'grid', label: '网格' },
						{ value: 'board', label: '画布' },
						{ value: 'time', label: '时间' },
					]}
				/>
			</div>

			<div className="spec__row">
				<span className="spec__k">动作</span>
				<ActionButton theme={props.theme} variant="primary">
					新建
				</ActionButton>
				<ActionButton theme={props.theme} variant="secondary">
					权限与约定
				</ActionButton>
				<ActionButton theme={props.theme} variant="secondary">
					显示已归档
				</ActionButton>
				<ActionButton theme={props.theme} variant="accent-outline">
					当前空间
				</ActionButton>
				<ActionButton theme={props.theme} variant="primary" disabled>
					禁用
				</ActionButton>
			</div>

			<div className="spec__row">
				<span className="spec__k">计数</span>
				<CountChip theme={props.theme} label="核心" count={12} />
				<CountChip theme={props.theme} label="未读" count={3} />
				<CountChip theme={props.theme} label="归档区" count={0} />
			</div>

			<div className="spec__row">
				<span className="spec__k">组合</span>
				<span className="spec__combo">
					<ActionButton theme={props.theme} variant="secondary">
						权限与约定
					</ActionButton>
					<SegmentedControl
						theme={props.theme}
						value={view}
						onChange={setView}
						options={[
							{ value: 'tree', label: '科技树' },
							{ value: 'list', label: '列表' },
						]}
					/>
					<ActionButton theme={props.theme} variant="primary">
						新建
					</ActionButton>
				</span>
			</div>
		</div>
	);
}

function App(): React.ReactNode {
	return (
		<div className="page">
			<header className="page__head">
				<h1>按钮组件 · 两套配色候选</h1>
				<p>
					左 = 深色（设计图与 taskboard2 截图一致：核心12 / 新建 都是深色实心）
					· 右 = 蓝色（当前实现）。<b>选定后迁到 src/renderers/。</b>
				</p>
			</header>

			<div className="cols">
				<section className="col">
					<h2>
						A · 深色 <span className="tag">设计图 / taskboard2</span>
					</h2>
					<Specimen theme="dark" />
				</section>
				<section className="col">
					<h2>
						B · 蓝色 <span className="tag tag--alt">当前实现</span>
					</h2>
					<Specimen theme="blue" />
				</section>
			</div>
		</div>
	);
}

const root = document.getElementById('root');
if (root !== null) {
	createRoot(root).render(
		<StrictMode>
			<App />
		</StrictMode>,
	);
}
