/**
 * markdown 组件预览 —— 展示 + 断言（CDP）。
 *
 * 页面里放两块：
 *
 * 1. **正常语法**（GFM 全家桶）—— 人眼确认渲染对不对；
 * 2. **XSS 样本** —— 页面上必须**看不到**任何注入产物。
 *
 * 断言由 `verify.mjs` 跑（CDP），它读的是**真实 DOM**，
 * 单测读的是虚拟节点树 —— 两条路都要绿，因为中间那一层（`CreateElement`）
 * 单测覆盖不到。
 */

import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

import { Markdown } from '../../../src/renderers/Markdown.tsx';

/** 正常语法样本（GFM 特性逐条点名）。 */
const NORMAL = `# 一级标题

二级
---

段落里的 **粗体**、*斜体*、~~删除线~~、\`行内代码\`，
以及 [站内链接](/x/y)、[外链](https://example.com)、裸链接 https://auto.link/a。

- 无序项一
- 无序项二
  - 嵌套项

1. 有序一
2. 有序二

- [ ] 未完成任务
- [x] 已完成任务

> 引用块里也有 **强调**。

\`\`\`ts
const answer: number = 42; // 代码块带 data-lang
\`\`\`

| 左对齐 | 居中 | 右对齐 |
|:--|:-:|--:|
| a | b | c |

---

实体：a &amp; b &lt;i&gt; &copy;

硬换行：第一行  
第二行
`;

/** XSS 样本 —— 每行一条，页面上都不该出现。 */
const XSS = [
	'<script>window.__xss_script = 1; alert("script")</script>',
	'<img src=x onerror="window.__xss_img = 1">',
	'[点我](javascript:window.__xss_link=1)',
	'<iframe src="https://example.com"></iframe>',
	'<svg onload="window.__xss_svg = 1"><circle r="1"/></svg>',
	'<style>body { --xss-style: 1 }</style>',
	'<a href="javascript:window.__xss_a=1">原始 html 的坏链接</a>',
	'<p onclick="window.__xss_click = 1">带 onclick 的段落</p>',
	'<input onfocus="window.__xss_input=1" autofocus>',
	'![图片](https://example.com/x.png)',
	'<textarea><script>window.__xss_ta = 1</script></textarea>',
].join('\n\n');

/** 应用根。 */
function App(): ReactNode {
	return (
		<StrictMode>
			<div className="preview">
				<div className="pv-head">
					<h1>Markdown</h1>
					<p>marked 18.2.1（GFM）+ 白名单建树 · 零 innerHTML / 零 DOMParser</p>
				</div>

				<h2 className="pv-title">GFM 语法</h2>
				<div className="pv-block" id="normal">
					<Markdown source={NORMAL} />
				</div>

				<h2 className="pv-title">XSS 样本（下面应当什么都没有）</h2>
				<div className="pv-block" id="xss">
					<Markdown source={XSS} />
				</div>

				<h2 className="pv-title">边角输入</h2>
				<div className="pv-block" id="edge">
					<Markdown source="" />
					<Markdown source={'   \n\n  '} />
					<Markdown source={'<span>未闭合的 span'} />
				</div>
			</div>
		</StrictMode>
	);
}

const holder = document.getElementById('root');
if (holder === null) throw new Error('找不到 #root');

createRoot(holder).render(<App />);
