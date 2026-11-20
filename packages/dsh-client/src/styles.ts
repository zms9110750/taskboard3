/**
 * 样式 —— **一个 CSS 字符串，运行时注入一次**。
 *
 * ## 为什么不用 `.css` 文件 + CSS Modules
 *
 * DSH 的客户端插件产物必须是**一个** JS 文件（`lib/client.js`）。
 * 用 `.css` 文件会：
 *   · 让 bundler 产出独立的 `style.css`（宿主的模块加载器不会去取它）；
 *   · 需要 `@tsdown/css` 插件 + CSS Modules 类型声明 + 额外的构建复杂度。
 *
 * ⇒ 把 CSS 写成 TS 字符串常量，在 `apply()` 里插一个 `<style>`。
 *   产物仍然是一个 JS，零额外依赖，也顺便满足「纯 TS」的要求。
 *
 * ## 颜色全部走宿主主题 token
 *
 * `--dsw-alias-*` 由宿主主题插件写在 `body` 上；浅色/深色切换自动跟随。
 * **本文件不出现任何字面色值**（除了 `rgb(0 0 0 / 20%)` 的阴影，
 * 它在两套主题下都成立）。
 *
 * ## 类名前缀
 *
 * 全部带 `tb3-` 前缀，避免与宿主或其他插件的类名相撞。
 */

/** 注入用的 `<style>` 元素的 id（重复注入时用它去重）。 */
export const STYLE_ID = 'taskboard3-styles';

/**
 * 抽屉的纵向间距**数值表**从纯逻辑模块 import —— 单一来源。
 *
 * ⚠ 为什么 CSS 不自己写死这些数：`DRAWER_CSS` 用这张表**插值生成**，
 *   于是「间距是多少」只在 `pure/drawer-view.ts` 里有一份；
 *   改了表，CSS 跟着变，单测也能断言。反例：CSS 写死一份、报告里再写一份，
 *   两边漂了没人发现（这个仓库已经踩过「文档写的数和实现漂了」）。
 */
import {
	DRAWER_COMPACT_SPACING,
	DRAWER_VARIANTS,
	DRAWER_VARIANT_IDS,
	drawerEntryCssOf,
	drawerMaskCssOf,
	drawerPanelCssOf,
} from './pure/drawer-view.ts';

/** 数值 → `Npx`（模板字符串里复用）。 */
function px(value: number): string {
	return `${String(value)}px`;
}

/**
 * 建卡页的样式 —— **单独一段，前缀 `tb3cc-`**。
 *
 * ## 为什么不并进下面那张主表
 *
 * 主表的类名是 `tb3-*`，是**任务板面板内部**的（tab 里那套）。建卡页是一整页
 * （顶栏 / 左右两栏 / 底栏）—— 两套样式的作用域不同。
 *
 * ⇒ 分开：出问题时能一眼看出「这条规则属于建卡页还是面板内」。
 *
 * ## ⚠ 建卡页**填满它的父容器**（`height:100%` + `container-type:size`）
 *
 * 早期版本是 `position:fixed; inset:0`（「铺满浏览器」）。用户 `2026-11-19` 给了
 * 三个真实尺寸（工作区 570×920 / 抽屉 1200×400 / 全屏 1600×1000）之后那就不成立了：
 * **fixed 会脱离父容器**，挂在窄 tab 里也按整个窗口铺开。
 * 现在靠 `container-type:size` 做容器查询，父容器给多高就多高。
 *
 * ## ⚠ 关键：`.tb3cc-page__body { min-height: 0 }`
 *
 * flex 子元素默认 `min-height: auto`，会被内容撑高 ⇒ 子元素的
 * `overflow-y: auto` **永远不生效** ⇒ 整页滚动、顶栏底栏跟着滚走。
 * 这是 flex 里最常见的坑，加注释钉住。
 */
export const CREATE_CSS = `
/*
 * ── 页面本体：**填满父容器**，不是铺满浏览器 ──
 *
 * 用户 2026-11-19 给了三个真实尺寸，旧版这里是 position:fixed + inset:0：
 *
 * | 场景 | 尺寸 |
 * |---|---|
 * | 工作区 | 570 × 920（窄、高）|
 * | 抽屉 | 1200 × 400（宽、矮）|
 * | 全屏 | 1600 × 1000（都够）|
 *
 * ⚠ position:fixed 会脱离父容器 —— 挂在 570 宽的 tab 里也按整个浏览器窗口铺开，
 *   左右两栏被挤扁。⇒ 必须改成 height:100% 撑满父容器。
 *
 * ⚠ container-type:size 要求父容器给高度 —— 父层没高度时页会**塌成 0**。
 *   预览里挂载点给了固定尺寸的舞台；产品里 tab body 必须是 height:100%。
 *   这一条由 test/create-layout.test.ts 的反向断言 + 预览的三个尺寸舞台共同守护。
 *
 * ⚠ size 而不是 inline-size：要能同时查**宽**和**高**（两个维度是两件事，
 *   见下面两条 @container）。
 *
 * ⚠ 本文件是模板字符串 —— 注释里**不能出现反引号**（会提前结束字符串）。
 */
.tb3cc-page{container-type:size;container-name:tb3cc;display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-primary,#fff);font-size:13px;line-height:1.5}
.tb3cc-page__top{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;padding:12px 18px;border-bottom:1px solid var(--dsw-alias-border-secondary,#e4e7ec)}
.tb3cc-page__title{font-size:16px;margin:0}
.tb3cc-page__close{border:none;background:transparent;font-size:20px;line-height:1;color:var(--dsw-alias-text-secondary,#8a919c);padding:2px 8px;border-radius:6px;cursor:pointer}
.tb3cc-page__close:hover{background:var(--dsw-alias-bg-secondary,#f1f3f6)}
.tb3cc-page__body{flex:1 1 auto;display:flex;min-height:0}
.tb3cc-page__left{flex:0 0 320px;padding:16px 18px;border-right:1px solid var(--dsw-alias-border-secondary,#e4e7ec);background:var(--dsw-alias-bg-secondary,#fafbfc);overflow-y:auto}
.tb3cc-page__right{flex:1 1 auto;padding:16px 20px;overflow-y:auto;min-width:0}
.tb3cc-page__foot{flex:0 0 auto;border-top:1px solid var(--dsw-alias-border-secondary,#e4e7ec);background:var(--dsw-alias-bg-secondary,#fafbfc)}

.tb3cc-sec-list{display:flex;flex-direction:column;gap:12px}
.tb3cc-sec-list__empty{color:var(--dsw-alias-text-secondary,#8a919c);padding:24px 0}
.tb3cc-sec{border:1px solid var(--dsw-alias-border-secondary,#e4e7ec);border-radius:10px;background:var(--dsw-alias-bg-primary,#fff);overflow:hidden}
.tb3cc-sec.has-error{border-color:var(--dsw-alias-border-danger,#f0a8a8)}
.tb3cc-sec__head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 13px;background:var(--dsw-alias-bg-secondary,#fafbfc);border-bottom:1px solid var(--dsw-alias-border-secondary,#eef1f5)}
.tb3cc-sec__title{display:flex;align-items:center;gap:8px;min-width:0}
.tb3cc-sec__no{flex:0 0 auto;width:19px;height:19px;border-radius:50%;background:var(--dsw-alias-bg-tertiary,#e4e7ec);color:var(--dsw-alias-text-secondary,#4b5563);font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center}
.tb3cc-sec__label{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tb3cc-sec__kind{display:inline-flex;align-items:center;gap:6px;flex:0 0 auto}
.tb3cc-sec__kind-label{color:var(--dsw-alias-text-secondary,#6b7280);font-size:12px;white-space:nowrap}
.tb3cc-sec__kind-select{padding:4px 8px;border:1px solid var(--dsw-alias-border-primary,#d7dbe2);border-radius:7px;background:var(--dsw-alias-bg-primary,#fff);color:var(--dsw-alias-text-primary,#1f2328);font-size:12px;outline:none;font-family:inherit}
.tb3cc-sec__kind-select:focus{border-color:var(--dsw-alias-brand-primary,#2563eb)}
.tb3cc-sec__body{padding:12px 13px}
.tb3cc-sec__error{padding:7px 13px;background:var(--dsw-alias-bg-danger,#fdf2f2);border-top:1px solid var(--dsw-alias-border-danger,#f7d4d4);color:var(--dsw-alias-text-danger,#b91c1c);font-size:12px}
.tb3cc-sec__input{width:100%;padding:9px 11px;border:1px solid var(--dsw-alias-border-primary,#d7dbe2);border-radius:8px;resize:vertical;outline:none;color:var(--dsw-alias-text-primary,#1f2328);line-height:1.6;font-family:inherit;font-size:13px;box-sizing:border-box}
.tb3cc-sec__input:focus{border-color:var(--dsw-alias-brand-primary,#2563eb)}
.tb3cc-sec__input--markdown{font-family:Consolas,"Courier New",monospace;font-size:12px;line-height:1.65}
.tb3cc-sec__pending{padding:12px 13px;border-radius:8px;background:var(--dsw-alias-bg-secondary,#f4f5f7);border:1px dashed var(--dsw-alias-border-primary,#d7dbe2);color:var(--dsw-alias-text-secondary,#6b7280);font-size:12px;line-height:1.55}

.tb3cc-actions{display:flex;align-items:center;justify-content:space-between;padding:10px 18px}
.tb3cc-actions__msg{color:var(--dsw-alias-text-secondary,#6b7280);font-size:12px}
.tb3cc-actions__err{color:var(--dsw-alias-text-danger,#b91c1c)}
.tb3cc-actions__buttons{display:flex;gap:8px}

.tb3cc-btn{padding:6px 16px;border-radius:7px;border:1px solid var(--dsw-alias-border-primary,#d7dbe2);background:var(--dsw-alias-bg-primary,#fff);color:var(--dsw-alias-text-primary,#2b3138);font-weight:500;font-family:inherit;font-size:13px;cursor:pointer}
.tb3cc-btn:hover:not(:disabled){background:var(--dsw-alias-bg-secondary,#f6f7f9)}
.tb3cc-btn:disabled{opacity:.55;cursor:default}
.tb3cc-btn--primary{background:var(--dsw-alias-text-primary,#1f2328);border-color:var(--dsw-alias-text-primary,#1f2328);color:var(--dsw-alias-bg-primary,#fff)}
.tb3cc-btn--primary:hover:not(:disabled){opacity:.88}

.tb3cc-tpl-hint{padding:9px 11px;border-radius:8px;background:var(--dsw-alias-bg-secondary,#f6f8fb);border:1px solid var(--dsw-alias-border-secondary,#e6eaf0)}
.tb3cc-tpl-hint.is-empty{border-style:dashed}
.tb3cc-tpl-hint__empty{color:var(--dsw-alias-text-secondary,#a6adb8)}
.tb3cc-tpl-hint__usage{color:var(--dsw-alias-text-secondary,#4b5563);margin-bottom:6px;font-size:12px;line-height:1.55}
.tb3cc-tpl-hint__meta{display:flex;justify-content:space-between;gap:10px;color:var(--dsw-alias-text-secondary,#6b7280);font-size:11px;flex-wrap:wrap}
.tb3cc-tpl-hint__meta b{color:var(--dsw-alias-text-primary,#1f2328)}
.tb3cc-tpl-hint__meta code{font-family:var(--font-mono,Consolas,"Courier New",monospace);font-size:11px}

/*
 * ── 左栏（定稿排法：标题 → 模板 → 父任务 → 关系|高级设置）──
 *
 * 宽度**不写在这里**：父层 .tb3cc-page__left 是 flex:0 0 320px。
 * 左栏组件撑满即可，写死宽度换个容器就错位。
 * ⚠ 这段在模板字符串里，注释里**不能出现反引号**（会提前结束字符串）。
 */
.tb3cc-leftcol{display:flex;flex-direction:column;gap:16px}
.tb3cc-field{display:flex;flex-direction:column;gap:5px}
.tb3cc-label{font-size:12px;font-weight:600;color:var(--dsw-alias-text-secondary,#3d444d)}
.tb3cc-req{color:var(--dsw-alias-text-danger,#dc2626)}
.tb3cc-input{width:100%;padding:8px 11px;border:1px solid var(--dsw-alias-border-primary,#d7dbe2);border-radius:8px;background:var(--dsw-alias-bg-primary,#fff);color:var(--dsw-alias-text-primary,#1f2328);outline:none;font-family:inherit;font-size:13px;box-sizing:border-box}
.tb3cc-input:focus{border-color:var(--dsw-alias-brand-primary,#2563eb)}
.tb3cc-input.has-error{border-color:var(--dsw-alias-border-danger,#f0a8a8)}
.tb3cc-field-err{color:var(--dsw-alias-text-danger,#b91c1c);font-size:11px;line-height:1.5;margin-top:4px}

/* ── 模板 + 父任务（**分行**） ── */
.tb3cc-tfield{display:flex;flex-direction:column;gap:12px}
.tb3cc-tfield__cell{display:flex;flex-direction:column;gap:5px;min-width:0}

/* ── 卡片选择器（combobox：输入即筛选，不是 select） ── */
.tb3cc-picker{position:relative;width:100%}
.tb3cc-picker__display{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;padding:7px 10px;border:1px solid var(--dsw-alias-border-primary,#d7dbe2);border-radius:8px;background:var(--dsw-alias-bg-primary,#fff);color:var(--dsw-alias-text-primary,#1f2328);text-align:left;font-family:inherit;font-size:13px;cursor:pointer}
.tb3cc-picker__display:hover{border-color:var(--dsw-alias-border-secondary,#b9bfc9)}
.tb3cc-picker__display.is-open{border-color:var(--dsw-alias-brand-primary,#2563eb)}
.tb3cc-picker__display.is-empty .tb3cc-picker__value{color:var(--dsw-alias-text-secondary,#a6adb8)}
.tb3cc-picker__value{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.tb3cc-picker__caret{flex:0 0 auto;color:var(--dsw-alias-text-secondary,#8a919c);font-size:11px}
/*
 * 弹层挂在自己容器里（absolute），**不挂 body** ——
 * 永远在建卡页的叠层语境里，不会被 fixed 的页面裁掉。
 */
.tb3cc-picker__pop{position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:5;background:var(--dsw-alias-bg-primary,#fff);border:1px solid var(--dsw-alias-border-primary,#d7dbe2);border-radius:9px;box-shadow:0 8px 24px rgb(0 0 0 / 14%);overflow:hidden}
.tb3cc-picker__input{width:100%;padding:8px 11px;border:none;border-bottom:1px solid var(--dsw-alias-border-secondary,#eef1f5);outline:none;background:var(--dsw-alias-bg-secondary,#fafbfc);color:var(--dsw-alias-text-primary,#1f2328);font-family:inherit;font-size:13px;box-sizing:border-box}
.tb3cc-picker__list{max-height:220px;overflow-y:auto;padding:4px}
.tb3cc-picker__item{display:flex;align-items:baseline;gap:8px;width:100%;padding:6px 9px;border:none;border-radius:6px;background:transparent;text-align:left;color:var(--dsw-alias-text-primary,#1f2328);font-family:inherit;font-size:13px;cursor:pointer}
.tb3cc-picker__item:hover{background:var(--dsw-alias-bg-secondary,#f1f3f6)}
.tb3cc-picker__item--clear{color:var(--dsw-alias-text-secondary,#6b7280);font-style:italic}
.tb3cc-picker__id{flex:0 0 auto;font-family:var(--font-mono,Consolas,"Courier New",monospace);font-size:11px;color:var(--dsw-alias-text-secondary,#6b7280);font-weight:700}
.tb3cc-picker__title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.tb3cc-picker__empty{padding:10px;color:var(--dsw-alias-text-secondary,#8a919c);text-align:center}

/* ── 模板三级联选弹层（独立组件 TemplatePickerPopover） ── */
.tb3cc-tpick{position:relative;width:100%}
.tb3cc-tpick__trigger{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;padding:7px 10px;border:1px solid var(--dsw-alias-border-primary,#d7dbe2);border-radius:8px;background:var(--dsw-alias-bg-primary,#fff);color:var(--dsw-alias-text-primary,#1f2328);text-align:left;font-family:inherit;font-size:13px;cursor:pointer}
.tb3cc-tpick__trigger:hover{border-color:var(--dsw-alias-border-secondary,#b9bfc9)}
.tb3cc-tpick__trigger.is-open{border-color:var(--dsw-alias-brand-primary,#2563eb)}
.tb3cc-tpick__trigger.is-empty .tb3cc-tpick__value{color:var(--dsw-alias-text-secondary,#a6adb8)}
.tb3cc-tpick__value{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.tb3cc-tpick__caret{flex:0 0 auto;color:var(--dsw-alias-text-secondary,#8a919c);font-size:11px}
/*
 * 三列弹层的宽度**大于 320px 左栏**是故意的：三列在 320 里每列只剩 ~100px，读不了。
 *
 * ⚠ 用 position:fixed + 由组件量触发器坐标（不是 absolute）——
 *   左栏 .tb3cc-page__left 是 overflow-y:auto 的滚动容器，会**裁掉**任何溢出的
 *   子元素。absolute 的后果实测：第三列被切掉一半 + 左栏底部冒出横向滚动条。
 */
.tb3cc-tpick__pop{position:fixed;z-index:6;width:470px;max-width:calc(100vw - 48px);background:var(--dsw-alias-bg-primary,#fff);border:1px solid var(--dsw-alias-border-primary,#d7dbe2);border-radius:10px;box-shadow:0 12px 32px rgb(0 0 0 / 16%);overflow:hidden}
.tb3cc-tpick__cols{display:grid;grid-template-columns:104px 104px 1fr}
.tb3cc-tpick__col{padding:6px;display:flex;flex-direction:column;gap:1px;min-width:0}
.tb3cc-tpick__col + .tb3cc-tpick__col{border-left:1px solid var(--dsw-alias-border-secondary,#eef1f5)}
/* 第三列（模板）占掉剩余宽度 —— 模板名比「领域 / 类别」长得多 */
.tb3cc-tpick__col--wide{flex:1 1 auto}
.tb3cc-tpick__col-head{padding:4px 8px 6px;color:var(--dsw-alias-text-secondary,#8a919c);font-size:11px;font-weight:600;letter-spacing:.04em}
.tb3cc-tpick__opt{display:flex;align-items:center;gap:7px;width:100%;padding:6px 8px;border:none;border-radius:6px;background:transparent;text-align:left;color:var(--dsw-alias-text-primary,#1f2328);font-family:inherit;font-size:12.5px;cursor:pointer}
.tb3cc-tpick__opt:hover{background:var(--dsw-alias-bg-secondary,#f1f3f6)}
.tb3cc-tpick__opt.is-picked{background:var(--dsw-alias-bg-tertiary,#e8eefb);color:var(--dsw-alias-brand-primary,#1d4ed8);font-weight:600}
.tb3cc-tpick__radio{flex:0 0 auto;font-size:9px;color:var(--dsw-alias-text-secondary,#b9bfc9);line-height:1}
.tb3cc-tpick__opt.is-picked .tb3cc-tpick__radio{color:var(--dsw-alias-brand-primary,#2563eb)}
.tb3cc-tpick__prefix{flex:0 0 auto;width:15px;text-align:center;font-family:var(--font-mono,Consolas,"Courier New",monospace);font-size:11px;font-weight:700;color:var(--dsw-alias-text-secondary,#8a919c)}
.tb3cc-tpick__opt.is-picked .tb3cc-tpick__prefix{color:var(--dsw-alias-brand-primary,#1d4ed8)}
.tb3cc-tpick__name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.tb3cc-tpick__empty{padding:8px;color:var(--dsw-alias-text-secondary,#a6adb8);font-size:12px}
/* 底部说明 —— 选中之后才出现（**选完不关弹层**就是为了看这块） */
.tb3cc-tpick__foot{padding:10px 12px;border-top:1px solid var(--dsw-alias-border-secondary,#eef1f5);background:var(--dsw-alias-bg-secondary,#fafbfc);display:flex;flex-direction:column;gap:4px}
.tb3cc-tpick__foot-idle{color:var(--dsw-alias-text-secondary,#a6adb8);font-size:12px}
.tb3cc-tpick__foot-title{font-weight:700;color:var(--dsw-alias-text-primary,#1f2328);font-size:12.5px}
.tb3cc-tpick__foot-domain{margin-left:8px;padding:0 6px;border-radius:4px;background:var(--dsw-alias-bg-tertiary,#eef1f5);color:var(--dsw-alias-text-secondary,#6b7280);font-size:10.5px;font-weight:600}
.tb3cc-tpick__foot-usage{color:var(--dsw-alias-text-secondary,#4b5563);font-size:11.5px;line-height:1.55}
.tb3cc-tpick__foot-meta{display:flex;justify-content:space-between;gap:10px;color:var(--dsw-alias-text-secondary,#6b7280);font-size:11px;flex-wrap:wrap;margin-top:2px}
.tb3cc-tpick__foot-meta b{color:var(--dsw-alias-text-primary,#1f2328)}
.tb3cc-tpick__foot-meta code{font-family:var(--font-mono,Consolas,"Courier New",monospace);font-size:11px}

/* ── 关系 | 高级设置：两个标签按钮 + 共用折叠区 ── */
.tb3cc-meta{display:flex;flex-direction:column;gap:10px}
.tb3cc-meta__tabs{display:flex;gap:8px}
.tb3cc-meta__tab{display:inline-flex;align-items:center;gap:5px;padding:5px 12px;border-radius:7px;border:1px solid var(--dsw-alias-border-primary,#d7dbe2);background:var(--dsw-alias-bg-primary,#fff);color:var(--dsw-alias-text-secondary,#4b5563);font-size:12px;font-weight:600;font-family:inherit;cursor:pointer}
.tb3cc-meta__tab:hover{border-color:var(--dsw-alias-border-secondary,#b9bfc9)}
.tb3cc-meta__tab.is-on{background:var(--dsw-alias-text-primary,#1f2328);border-color:var(--dsw-alias-text-primary,#1f2328);color:var(--dsw-alias-bg-primary,#fff)}
.tb3cc-meta__count{min-width:16px;padding:0 4px;border-radius:9px;background:var(--dsw-alias-bg-tertiary,#eef1f5);color:var(--dsw-alias-text-secondary,#6b7280);font-size:10px;text-align:center;line-height:16px}
.tb3cc-meta__tab.is-on .tb3cc-meta__count{background:rgb(255 255 255 / 24%);color:var(--dsw-alias-bg-primary,#fff)}
/* 折叠区 —— 两个面板共用这一块位置（同一时间只可能有一个存在） */
.tb3cc-meta__panel{padding:11px 12px;border:1px solid var(--dsw-alias-border-secondary,#e4e7ec);border-radius:9px;background:var(--dsw-alias-bg-secondary,#fafbfc);display:flex;flex-direction:column;gap:9px}
.tb3cc-meta__hint{color:var(--dsw-alias-text-secondary,#6b7280);font-size:11px;line-height:1.5}
.tb3cc-meta__empty{color:var(--dsw-alias-text-secondary,#8a919c)}
.tb3cc-meta__empty-hint{color:var(--dsw-alias-text-secondary,#a6adb8);font-size:11px}
.tb3cc-meta__panel--empty{align-items:flex-start}
.tb3cc-meta__rel-list{display:flex;flex-direction:column;gap:6px}
.tb3cc-meta__rel-row{display:grid;grid-template-columns:72px minmax(0,1fr) 20px;gap:6px;align-items:center;min-width:0}
.tb3cc-meta__rel-kind{padding:6px 2px;border:1px solid var(--dsw-alias-border-primary,#d7dbe2);border-radius:7px;background:var(--dsw-alias-bg-primary,#fff);color:var(--dsw-alias-text-primary,#1f2328);font-size:12px;outline:none;min-width:0;font-family:inherit}
.tb3cc-meta__rel-del{border:none;background:transparent;color:var(--dsw-alias-text-secondary,#9aa1ad);font-size:13px;padding:0;border-radius:4px;cursor:pointer}
.tb3cc-meta__rel-del:hover{color:var(--dsw-alias-text-danger,#dc2626)}
.tb3cc-meta__rel-add{align-self:flex-start;padding:5px 11px;border-radius:7px;border:1px dashed var(--dsw-alias-border-primary,#c7ced8);background:transparent;color:var(--dsw-alias-text-secondary,#4b5563);font-size:12px;font-family:inherit;cursor:pointer}
.tb3cc-meta__rel-add:hover{border-color:var(--dsw-alias-brand-primary,#2563eb);color:var(--dsw-alias-brand-primary,#2563eb)}

/*
 * ══════════════════════════════════════════════════════════
 * 响应式：三个真实尺寸 —— **两个维度，不是三个宽度档**
 * ══════════════════════════════════════════════════════════
 *
 * 用户 2026-11-19 给的尺寸（产品里 CardCreate 会挂在三种容器里）：
 *
 * | 场景 | 尺寸 | 问题 |
 * |---|---|---|
 * | 工作区 | 570 × 920 | **横向**放不下左右分栏 ⇒ 堆叠 |
 * | 抽屉 | 1200 × 400 | **纵向**放不下那么多行 ⇒ 收紧间距（**不能堆叠**）|
 * | 全屏 | 1600 × 1000 | 都不用管 |
 *
 * ⚠ **判断依据是宽 / 高两个独立维度，不是面积。**
 *   抽屉 1200 宽 × 400 高 —— 面积只有全屏的 30%，但它**宽**，横排好看得很；
 *   一旦误判成「小 ⇒ 堆叠」，400 高里竖着塞两栏会死。
 *   ⇒ 宽的门槛管**结构**（堆叠），高的门槛管**间距**（收紧），两者互不推断。
 *
 * ⚠ 容器查询只写**有差异的**属性。没列到的属性继承上面的基础规则 ——
 *   否则「响应式」变成第二套样式表，改一处要改两遍。
 */

/*
 * ── A. 窄（小于 700px）⇒ 上下堆叠 ──
 *
 * 门槛 700 的来由：左栏 320 + 右栏最小可用 340 + 边框 ≈ 660。
 * 低于 700 时右栏会被挤到放不下一列章节卡，那比堆叠更难用。
 */
@container tb3cc (max-width: 700px) {
  .tb3cc-page__body{flex-direction:column}
  /*
   * 堆叠后左栏在上、右栏在下。
   *
   * ## ⚠ 左栏上限是 70%，不是 46%（用户 2026-11-19 反馈后改的）
   *
   * 第一版给 46%，理由是「别让左栏把右栏挤没」。实测 570×920 下这是错的：
   *
   * | 左栏状态 | 内容自然高（含 padding）|
   * |---|---|
   * | 关系收起 | 341px |
   * | 关系展开（空） | 457px |
   * | 关系展开 + 1 行关联 | 471px |
   *
   * 46% ≈ 376px ⇒ **关系一展开左栏就出滚动条**。用户原话：
   *
   * > 「抽屉打滚动无所谓。但是工作区打滚动就不行。」
   *
   * ⇒ 左栏是**主输入区**，滚起来就看不到自己刚填的字段，这个代价不可接受。
   *   70%（920 × 70% ≈ 573px）能放下「关系展开 + 5 行关联」，典型状态一律不滚。
   *   右栏剩 30%（≈246px）—— 右栏本来就比视口长（要滚），少 130px 不影响它可用。
   *
   * ⚠ **抽屉（1200×400）走不到这条**：宽 1200 > 700 ⇒ 横排，左栏 400 高里滚是应该的
   *   （高度就那么点，不滚看不完）。「滚不滚」的判据是**宽**（结构），不是高。
   */
  .tb3cc-page__left{flex:0 0 auto;max-height:70%;border-right:none;border-bottom:1px solid var(--dsw-alias-border-secondary,#e4e7ec)}
  .tb3cc-page__right{flex:1 1 auto;min-height:0}

  /*
   * 窄容器里顺带把左栏的纵向间距收一点 —— 和 70% 是同一件事：
   * 让左栏在 570×920 里**装得下**，而不是靠滚动条兜。
   * 只动 gap，不动字号 / 结构（那属于「矮」那一维）。
   */
  .tb3cc-leftcol{gap:12px}
  .tb3cc-tfield{gap:10px}
  .tb3cc-meta{gap:8px}
}

/*
 * ── B. 矮（< 560px）⇒ 收紧纵向间距（**结构不动**）──
 *
 * 门槛 560 的来由：顶栏 ~50 + 底栏 ~50 + 右栏至少要露出两章（~230×2）。
 * 抽屉 400 高 ⇒ 必须把垂直 padding / gap / 行高都压下来，否则一屏只能看半张章节卡。
 */
@container tb3cc (max-height: 560px) {
  .tb3cc-page__top{padding:6px 14px}
  .tb3cc-page__title{font-size:14px}
  .tb3cc-page__left{padding:10px 14px}
  .tb3cc-page__right{padding:10px 14px}
  .tb3cc-actions{padding:6px 14px}
  .tb3cc-btn{padding:4px 12px;font-size:12px}
  .tb3cc-sec-list{gap:8px}
  .tb3cc-sec__head{padding:6px 10px}
  .tb3cc-sec__body{padding:8px 10px}
  .tb3cc-leftcol{gap:10px}
  .tb3cc-tfield{gap:8px}
  /* 模板说明块在矮容器里只留一句话，省掉「编号前缀 / 共 N 段」那行 */
  .tb3cc-tpl-hint{padding:6px 9px}
  .tb3cc-tpl-hint__usage{margin-bottom:0;font-size:11px}
  .tb3cc-tpl-hint__meta{display:none}
}
`;

/**
 * 搜索框的样式 —— 前缀 `.search-box`（SearchBox 组件自带，类名不改）。
 *
 * ## 从哪来
 *
 * SearchBox 的视觉细节原先只存在于 `dev/preview/searchbox/style.css`（那一份
 * 仍给 SearchBox 自己的预览用）。V3 工作区要用它 ⇒ 在这里收口成产品样式，
 * 和上面各组件「preview CSS → WORKSPACE_CSS」同一个做法。
 *
 * ## 和 preview 那份的差别（只有两处，都不是行为）
 *
 * 1. **作用域**：全部包在 `.tb3w-root` 下（类名保持原样，只加前缀 —— 同
 *    `WORKSPACE_CSS` 的约定，避免 `.search-box` 这种通用名撞到宿主）。
 * 2. **颜色**：用宿主 token + 兜底色（`var(--accent, #2563eb)` 这套），
 *    兜底值就是 preview 里写的那个色值。焦点 / hover / disabled 都是**样式**，
 *    判决（能不能提交）在 `src/pure/search-box.ts`，本段不碰。
 *
 * ⚠ 布局宽度由调用方决定（`WORKSPACE_CSS` 的 `.tb3w-filters__tail .search-box`）；
 *   组件本身 `field` 是 `flex:1`，没有固定宽度 —— 这是 SearchBox 的设计，
 *   本文件不改它。
 *
 * ⚠ 本文件是模板字符串 —— 注释里**不能出现反引号**。
 */
export const SEARCHBOX_CSS = `
.tb3w-root .search-box{display:flex;align-items:stretch;min-width:0}
.tb3w-root .search-box__field{position:relative;display:flex;align-items:center;flex:1 1 auto;min-width:0;height:36px;border:1px solid var(--border,#e7e9ee);border-right:0;border-radius:8px 0 0 8px;background:var(--bg-card,#fff);transition:border-color .12s,background .12s}
.tb3w-root .search-box__field:focus-within{border-color:var(--accent,#2563eb)}
.tb3w-root .search-box__icon{position:absolute;left:11px;top:50%;transform:translateY(-50%);display:inline-flex;align-items:center;color:var(--text-weak,#9aa1ad);pointer-events:none}
/* 左内边距 33px = 图标左 11px + 图标 14px + 间距 8px —— 文字不会压到图标 */
.tb3w-root .search-box__input{width:100%;height:100%;padding:0 12px 0 33px;border:0;border-radius:8px 0 0 8px;outline:none;background:transparent;font-family:inherit;font-size:13px;line-height:1.5;color:var(--text,#16181d)}
.tb3w-root .search-box__input::placeholder{color:var(--text-weak,#9aa1ad)}
.tb3w-root .search-box__input:disabled{cursor:not-allowed}
.tb3w-root .search-box__go{flex:0 0 auto;height:36px;padding:0 20px;border:1px solid var(--accent,#2563eb);margin-left:-1px;border-radius:0 8px 8px 0;background:var(--accent,#2563eb);color:#fff;font-family:inherit;font-size:13px;font-weight:600;letter-spacing:.02em;cursor:pointer;transition:background .12s,border-color .12s,color .12s}
.tb3w-root .search-box__go:hover:not(:disabled){background:var(--accent-strong,#1d4ed8);border-color:var(--accent-strong,#1d4ed8)}
.tb3w-root .search-box__go:active:not(:disabled){background:#1e40af;border-color:#1e40af}
/* 空输入 / 禁用 ⇒ 视觉弱化：灰底、灰字、灰边（它是真 disabled，不是只换颜色） */
.tb3w-root .search-box__go:disabled{background:#f1f3f6;border-color:var(--border,#e7e9ee);color:var(--text-weak,#9aa1ad);cursor:default}
.tb3w-root .search-box[data-search-disabled='true'] .search-box__field{background:#f7f8fa;border-color:var(--border,#e7e9ee)}
`;

/**
 * 工作区（V3）的样式 —— 前缀 `tb3w-`。
 *
 * ## 它为什么单独一段
 *
 * 这是**拼装层**：六个已定稿组件（SpaceBar / FilterRow+FilterBox / CardRow /
 * CardDetail / StatusMenu）的 CSS 原本只存在于各自的 `dev/preview/<组件>/style.css`
 * 里。V3 是第一个**产品级**页面，所以在这里收口成一份：
 *
 * | 来源 | 类名 | 作用域 |
 * |---|---|---|
 * | 各组件的 preview CSS | `.space-bar` / `.filter-box` / `.task-card` / `.detail` / `.menu` … | 全部包在 `.tb3w-root` 下 |
 * | StatusMenu 的浮层 | `.menu*` | 它 portal 到 `body` ⇒ 用 `[data-menu="status"]` 作用域 |
 * | 本组件（拼装）| `.tb3w-*` | 新前缀，不跟 `tb3-*` / `tb3cc-*` 混 |
 *
 * ⚠ **组件类名保持原样、只加作用域前缀** —— 已定稿组件的 DOM 是它们的
 *   preview 验收过的，改类名等于让那些 CDP 断言失去意义。
 *
 * ## 颜色全走宿主 token + 兜底色
 *
 * 和 `CREATE_CSS` 同一手法：`var(--dsw-alias-*, 兜底)`。预览里没有宿主
 * token ⇒ 用兜底色，也就是设计图上的那套颜色。
 *
 * ⚠ 本文件是模板字符串 —— 注释里**不能出现反引号**（会提前结束字符串）。
 */
export const WORKSPACE_CSS = `
/* ══════════════════════════════════════════════════════════
   0. 令牌 + 盒模型
   ══════════════════════════════════════════════════════════ */

.tb3w-root, [data-menu="status"] {
  --bg: var(--dsw-alias-bg-secondary, #f5f7fa);
  --bg-card: var(--dsw-alias-bg-primary, #fff);
  --bg-soft: var(--dsw-alias-bg-secondary, #fafbfc);
  --bg-hover: var(--dsw-alias-bg-hover, #f3f4f6);
  --border: var(--dsw-alias-border-secondary, #e7e9ee);
  --border-strong: var(--dsw-alias-border-primary, #d7dbe2);
  --text: var(--dsw-alias-text-primary, #16181d);
  --text-secondary: var(--dsw-alias-text-secondary, #5f6673);
  --text-weak: var(--dsw-alias-text-tertiary, #9aa1ad);
  /*
   * 强调色 = **品牌蓝**。用户 2026-11-20 修正：
   * 「改为用蓝色主题的。我让你用黑色是一些东西黑底白字。
   *   你把面包屑做成黑色加粗字。这哪看的清他是可选的。」
   *
   * 上一版把 accent 改成正文色（黑）是理解错了 —— 结果面包屑选中态成了
   * 黑色加粗字，看不出可点。黑色只用于**开关类**控件的激活态（黑底白字），
   * 见 .space-chip.is-current / .space-action.is-on / .ghost-btn.is-active。
   * 状态色（--state-*）不动，那是九状态语义色。
   */
  --accent: var(--dsw-alias-brand-primary, #2563eb);
  --accent-strong: var(--dsw-alias-brand-hover, #1d4ed8);
  --warn: #d97706;
  --font-mono: ui-monospace, Consolas, "Courier New", monospace;
  --fs-id: 11px;
  --fs-badge: 10px;
  --fs-body: 12.5px;
  --state-unspecified-dot: #9ca3af;
  --state-unspecified-fg: #6b7280;
  --state-submitted-dot: #111827;
  --state-submitted-fg: #111827;
  --state-working-dot: #06b6d4;
  --state-working-fg: #0e7490;
  --state-inputRequired-dot: #eab308;
  --state-inputRequired-fg: #a16207;
  --state-authRequired-dot: #a855f7;
  --state-authRequired-fg: #7e22ce;
  --state-completed-dot: #10b981;
  --state-completed-fg: #047857;
  --state-failed-dot: #ef4444;
  --state-failed-fg: #b91c1c;
  --state-canceled-dot: #92400e;
  --state-canceled-fg: #78350f;
  --state-rejected-dot: #f97316;
  --state-rejected-fg: #c2410c;
  --kind-goal-fg: #7c3aed;
  --kind-goal-bg: #f3e8ff;
  --kind-design-fg: #2563eb;
  --kind-design-bg: #dbeafe;
  --kind-work-fg: #0891b2;
  --kind-work-bg: #cffafe;
  --kind-record-fg: #6b7280;
  --kind-record-bg: #f3f4f6;
}
.tb3w-root, .tb3w-root *, [data-menu="status"], [data-menu="status"] *{box-sizing:border-box}

/* ══════════════════════════════════════════════════════════
   1. 拼装壳
   ══════════════════════════════════════════════════════════ */

.tb3w-root{position:relative;display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;font-size:13px;line-height:1.5}
.tb3w-page{container-type:size;container-name:tb3w;display:flex;flex-direction:column;height:100%;min-height:0;padding:16px 20px;overflow:hidden}
.tb3w-chrome{flex:0 0 auto;display:flex;flex-direction:column;min-width:0}
.tb3w-main{flex:1 1 auto;display:flex;flex-direction:row;min-height:0;min-width:0;margin-top:12px}

/* ── 紧凑密度（data-density="compact"，用户 2026-11-20） ──
   常驻的：任务计数 / 关系图例（只读装饰）、视图切换 / 新建（高频）
   折叠的：空间 chip 行（点开才显示）、权限与约定、AI chip
   目标：chrome 只占两行 —— 第 1 行工具、第 2 行筛选。 */
.tb3w-space-wrap{position:relative;display:inline-flex}
.tb3w-space-toggle{flex:0 0 auto;padding:3px 10px;border-radius:7px}
/* 下拉面板：浮在内容上，不推挤布局（用户 2026-11-20）。40 个空间在面板内部滚动。 */
.tb3w-space-pop{position:absolute;top:calc(100% + 6px);right:0;z-index:40;min-width:min(560px,88vw);max-height:min(320px,60vh);overflow:auto;padding:8px;border:1px solid var(--border,#e5e7eb);border-radius:10px;background:var(--bg-card,#fff);box-shadow:0 12px 32px rgb(15 23 42 / 16%)}
.tb3w-space-pop > .space-bar{flex-wrap:wrap;padding:0}

/* SpaceBar 自己带 6px 上下 padding ⇒ 这里只补左右对齐 */
.tb3w-chrome > .space-bar{padding-left:2px;padding-right:2px}

/*
 * 行 1 的外层：工具栏 + 空间开关按钮并排。
 *
 * 用户 2026-11-20：「工作区组件只要一个工作区组件，不包括折叠工作区用的按钮」
 * ⇒ 开关按钮不进 WorkspaceToolbar，由 Workspace 在外面拼（见 Workspace.tsx）。
 */
.tb3w-chrome__bar{display:flex;align-items:center;gap:8px;min-width:0}
.tb3w-chrome__bar > .tb3w-toolbar{flex:1 1 auto;min-width:0}

/* ── 工具栏：条数 / 图例 / 视图切换 / 新建 ── */
.tb3w-toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:6px 10px;min-width:0;margin-top:10px;padding:0 2px}
.tb3w-toolbar__title{flex:0 0 auto;font-size:12.5px;font-weight:600;color:var(--text);white-space:nowrap}
.tb3w-toolbar__count{margin-left:4px;font-weight:400;color:var(--text-secondary)}
.tb3w-toolbar__legend{display:flex;align-items:center;flex-wrap:wrap;gap:4px 12px;order:2;min-width:0;font-size:11px;color:var(--text-secondary)}
.tb3w-toolbar__legend-label{flex:0 0 auto;white-space:nowrap}
.tb3w-legend__item{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
.tb3w-legend__line{display:inline-block;flex:0 0 auto;width:14px;height:2px;border-radius:1px;background:#5b6472}
.tb3w-legend__line[data-rel="depends"]{background:#a16207}
.tb3w-legend__line[data-rel="supersedes"]{background:#6d28d9}
.tb3w-legend__line[data-rel="constrains"]{background:#b91c1c}
.tb3w-legend__line[data-rel="related"]{height:0;border-top:2px dashed #15803d;background:none}
.tb3w-legend__line[data-rel="references"]{height:0;border-top:2px dashed #6b7280;background:none}
.tb3w-legend__hint{flex:0 0 auto;font-size:10px;color:#b6bec9;white-space:nowrap}
.tb3w-legend__hint--short{display:none}
.tb3w-toolbar__actions{display:flex;align-items:center;gap:8px;order:3;margin-left:auto;min-width:0}
.tb3w-seg{display:inline-flex;align-items:center;padding:2px;border-radius:6px;background:var(--bg-hover)}
.tb3w-seg__btn{padding:3px 10px;border:0;border-radius:5px;background:transparent;color:var(--text-secondary);font-family:inherit;font-size:11.5px;cursor:pointer;white-space:nowrap}
.tb3w-seg__btn.is-on{background:var(--text);color:#fff;font-weight:600}
.tb3w-btn-primary{padding:4px 12px;border:1px solid var(--text);border-radius:6px;background:var(--text);color:#fff;font-family:inherit;font-size:11.5px;font-weight:600;cursor:pointer;white-space:nowrap}
.tb3w-btn-primary:hover{opacity:.88}

/* ── 筛选区：3 个 FilterBox 独占一行；尾部（AI 计数 / 搜索）另起一行 ──
 *
 * 用户 2026-11-20：
 * 「筛选按钮是有弹出的文档流的。把别人挤走了怎么办」
 * 「我要他参与文档流。所以他要独立一行」
 *
 * ⇒ 筛选按钮**参与文档流**（展开是撑宽这一行，不是浮层盖住别人），
 *   所以必须独占一行 —— 行 1 只有筛选按钮，行 2 才是尾部。
 *   这样展开/收起只改行 1 的宽度与高度，不会把搜索框挤走。
 *
 * ⚠ .tb3w-chrome 是 column flex，两行天然各占一行；这里去掉 spacer
 *   （它原来把尾部推到行 1 的右边）并让尾部强制换行。
 */
.tb3w-filters{flex:1 0 100%;min-width:0;margin-top:8px}
.tb3w-filters .filter-row__spacer{display:none}
.tb3w-filters__tail{flex:1 0 100%;display:flex;align-items:center;justify-content:flex-end;gap:8px;min-width:0;margin-top:8px}
.tb3w-ai-chip{display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border:1px solid var(--border);border-radius:6px;background:var(--bg-card);color:var(--text-secondary);font-size:10.5px;white-space:nowrap}
.tb3w-ai-chip b{font-weight:600;color:var(--text)}
/*
 * 尾部搜索框 = 定稿的 SearchBox（类名 .search-box，样式在 SEARCHBOX_CSS）。
 * 这里只管**布局**：宽版固定 250px（和原来的行内输入框同宽），窄版整行。
 */
.tb3w-filters__tail .search-box{flex:0 0 auto;width:250px}

/* ── 左栏：列表 ── */
.tb3w-list{flex:2 1 0;display:flex;flex-direction:column;min-width:0;min-height:0;background:var(--bg-card);border:1px solid var(--border);border-radius:10px;overflow:hidden}
.tb3w-list__head{flex:0 0 auto;display:flex;align-items:baseline;justify-content:space-between;gap:8px;padding:11px 14px 7px}
.tb3w-list__title{font-size:12.5px;font-weight:600;color:var(--text)}
.tb3w-list__title em{font-style:normal;font-weight:400;color:var(--text-secondary)}
.tb3w-list__sort{flex:0 0 auto;font-size:11px;color:var(--text-weak)}
/*
 * 列表的列名行。设计图里只在宽版出现（窄版把纵向空间让给行本身）。
 * 三列与 CardRow 的几何对齐：46px 正方形 + 12px gap ≈ 58（首列给到 190 是为了
 * 把「分类 · 领域 · 模板」对齐到 label 起点），最后一列 90px 对齐「最后动过」。
 */
.tb3w-list__cols{flex:0 0 auto;display:grid;grid-template-columns:190px 150px minmax(0,1fr) 90px;gap:0;padding:0 14px 5px;border-bottom:1px solid #eef1f5;font-size:8.5px;color:#b6bec9}
.tb3w-list__cols span:last-child{text-align:right}
.tb3w-list__body{flex:1 1 auto;min-height:0;overflow-y:auto;padding:8px 14px 12px}
.tb3w-list__empty{padding:28px 8px;text-align:center;font-size:12px;color:var(--text-weak)}

/*
 * 科技树视图 —— 用定稿的 TechTree（类名 tb3t-*，CSS 在 TECHTREE_CSS）。
 * 它的根是 height:100% 的 flex 列（画布自己滚、页脚常驻）⇒ 这里只给一个
 * 「撑满列表栏」的容器。min-height:0 是 flex 里让子元素内部滚动的必要条件
 * （同 .tb3w-list__body 的理由）。
 */
.tb3w-tree{flex:1 1 auto;display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden}
.tb3w-tree > .tb3t-root{flex:1 1 auto;min-height:0}

/* ── 分隔条：可拖（宽版竖 / 窄版横） ── */
.tb3w-split{position:relative;display:flex;flex:0 0 20px;align-items:center;justify-content:center;cursor:col-resize;user-select:none;touch-action:none}
.tb3w-split__line{position:absolute;top:0;bottom:0;left:50%;width:0;border-left:1px dashed #cbd5e1}
.tb3w-split__grip{position:relative;z-index:1;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border:1px solid var(--border);border-radius:6px;background:var(--bg-card);color:var(--text-secondary);font-size:10px}

/* ── 右栏：详情 ── */
.tb3w-detail{flex:1.2 1 0;display:flex;flex-direction:column;min-width:300px;max-width:460px;min-height:0}
.tb3w-detail > .detail{flex:1 1 auto;min-height:0;overflow-y:auto}
.tb3w-detail__empty{flex:1 1 auto;display:flex;align-items:center;justify-content:center;border:1px dashed var(--border);border-radius:10px;background:var(--bg-card);color:var(--text-weak);font-size:12px}
/* 详情里的状态 = 状态菜单的触发器（设计图没画胶囊，见 V3 报告） */
.tb3w-detail [data-meta="status"]{position:relative;cursor:pointer;border-radius:5px}
.tb3w-detail [data-meta="status"]:hover{background:var(--bg-hover)}
.tb3w-detail [data-meta="status"]::after{content:"⌄";position:absolute;top:50%;right:-3px;transform:translateY(-50%);font-size:9px;color:var(--text-weak);opacity:.85}
.tb3w-root[data-detail="closed"] .tb3w-split,.tb3w-root[data-detail="closed"] .tb3w-detail{display:none}

/* ══════════════════════════════════════════════════════════
   2. 已定稿组件的样式（作用域化；值照抄各自 preview 的 style.css）
   ══════════════════════════════════════════════════════════ */

/* ── SpaceBar ── */
.tb3w-root .ghost-btn{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg-card);color:var(--text-secondary);font-family:inherit;font-size:12px;white-space:nowrap;cursor:pointer;transition:border-color .12s,color .12s,background .12s}
.tb3w-root .ghost-btn:hover:not(:disabled){border-color:var(--text-weak);color:var(--text)}
.tb3w-root .ghost-btn:disabled{opacity:.45;cursor:default}
/*
 * 开关类控件的激活态 = **黑底白字**。用户 2026-11-20：
 * 「对于开关性质的。比如当前空间，展示已归档。这些切换开关的，
 *   用黑底白字来表示现在选用/激活。」
 *
 * 这一条只作用于「显示已归档」这个开关（SpaceBar 里的 .space-toggle）。
 * 筛选按钮（状态 / 类别 / 领域）不是开关，用蓝色 —— 见下面的 .filter-box 段。
 */
.tb3w-root .ghost-btn.is-active{border-color:var(--text);background:var(--text);color:#fff}
.tb3w-root .ghost-btn.is-active:hover:not(:disabled){border-color:var(--text);background:var(--text);color:#fff}
.tb3w-root .space-bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-width:0;padding:6px 2px}
.tb3w-root .space-bar > *{flex:0 0 auto}
.tb3w-root .space-action{min-width:84px;justify-content:center}
.tb3w-root .space-action.is-emphasis-current{border-color:var(--accent);background:#eef4ff;color:var(--accent);font-weight:600;cursor:default}
.tb3w-root .space-action.is-emphasis-current:hover{border-color:var(--accent);color:var(--accent)}
.tb3w-root .space-action.is-emphasis-action{border-color:var(--border);background:var(--bg-card);color:var(--text-secondary)}
.tb3w-root .space-action.is-emphasis-action:hover:not(:disabled){border-color:var(--accent);background:#f5f9ff;color:var(--accent)}
.tb3w-root .space-action.is-emphasis-plain{color:var(--text-weak)}
.tb3w-root .space-action.is-on{border-color:var(--text);background:var(--text);color:#fff}
.tb3w-root .space-action.is-on:hover:not(:disabled){border-color:var(--text);background:var(--text);color:#fff}
.tb3w-root .space-chip{display:inline-flex;align-items:center;gap:5px;padding:4px 11px;border:1px solid var(--border);border-radius:999px;background:var(--bg-card);color:var(--text-secondary);font-family:inherit;font-size:12px;white-space:nowrap;cursor:pointer;transition:border-color .12s,background .12s}
.tb3w-root .space-chip:hover{border-color:var(--text-weak)}
.tb3w-root .space-chip.is-current{border-color:var(--text);background:var(--text);color:#fff}
.tb3w-root .space-chip.is-viewing{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent)}
.tb3w-root .space-chip.is-current.is-viewing{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent)}
.tb3w-root .space-chip.is-archived{border-style:dashed;opacity:.65}
.tb3w-root .space-chip.is-archived:hover{opacity:1}
.tb3w-root .space-chip.is-current.is-archived{opacity:1}
.tb3w-root .space-chip__count{font-family:var(--font-mono);font-size:11px;opacity:.75}
.tb3w-root .space-chip--add{padding:4px 9px;color:var(--text-weak)}

/* ── FilterBox / FilterRow ── */
.tb3w-root .filter-row{display:flex;align-items:center;flex-wrap:wrap;gap:8px}
/*
 * 筛选按钮 = **蓝色风格**（不是开关）。用户 2026-11-20：
 * 「对状态筛选按钮这些，突出可交互的，但只是可以点击，不是切换性质的，
 *   用蓝色的风格。」
 *
 * ⇒ 描边淡蓝、标题蓝字（看得出能点）；展开时描边变实蓝。
 *   激活态**不用黑底白字** —— 那是开关类的语言（见上面 .ghost-btn.is-active）。
 */
.tb3w-root .filter-box{position:relative;flex:0 0 auto;height:32px;max-width:100%;border:1px solid #c7d9f7;border-radius:6px;background:var(--bg-card);overflow:hidden;cursor:pointer;user-select:none;transition:width .18s ease,border-color .12s ease}
.tb3w-root .filter-box:hover{border-color:var(--accent)}
.tb3w-root .filter-box.is-open{border-color:var(--accent)}
.tb3w-root .filter-box__face{position:absolute;top:0;bottom:0;left:12px;display:inline-flex;align-items:center;white-space:nowrap;transition:opacity .12s ease}
.tb3w-root .filter-box__face--expanded{opacity:0;pointer-events:none}
.tb3w-root .filter-box.is-open .filter-box__face--collapsed{opacity:0;pointer-events:none}
.tb3w-root .filter-box.is-open .filter-box__face--expanded{opacity:1;pointer-events:auto}
.tb3w-root .filter-box__title{padding:0 2px;border:0;border-radius:4px;background:none;color:var(--accent);font-family:inherit;font-size:12.5px;cursor:pointer}
.tb3w-root .filter-box__title:hover{background:#eff6ff;color:var(--accent-strong)}
.tb3w-root .filter-box__colon{font-size:12.5px;color:var(--text-secondary)}
.tb3w-root .filter-box__crumbs{display:inline-flex;align-items:center}
/* 分隔斜杠要看得见（用过 #cbd5e1，截图里几乎看不见） */
.tb3w-root .filter-box__csep{padding:0 1px;font-size:12px;color:#9aa1ad;user-select:none}
.tb3w-root .filter-box__items{display:inline-flex;align-items:center}
.tb3w-root .filter-box__item{display:inline-flex;align-items:center;gap:2px;padding:2px 4px;border:0;border-radius:4px;background:none;color:var(--text);font-family:inherit;font-size:12.5px;cursor:pointer}
.tb3w-root .filter-box__item:hover{background:#f3f4f6}
/*
 * 面包屑 / 选项的选中态 = **蓝字**（不是黑字加粗）。
 *
 * 用户 2026-11-20 骂的就是这一条：「你把面包屑做成黑色加粗字。
 * 这哪看的清他是可选的。」⇒ accent 已恢复蓝，字重从 700 降到 600
 * （700 看起来像小标题，不像可点的项）。
 */
.tb3w-root .filter-box__item.is-picked{color:var(--accent);font-weight:600}
.tb3w-root .filter-box__item.is-picked:hover{background:#eff6ff}
.tb3w-root .filter-box__item--crumb:not(.is-picked){text-decoration:underline dotted #b6bec9;text-underline-offset:3px}
.tb3w-root .filter-box__item--crumb:not(.is-picked):hover{color:var(--accent);text-decoration-color:var(--accent)}
.tb3w-root .filter-box__more{margin-left:1px;font-size:9px;opacity:.5}
.tb3w-root .filter-box__sep{padding:0 2px;font-size:12px;color:#cbd5e1;user-select:none}
.tb3w-root .filter-box__vline{align-self:stretch;width:1px;margin:0 10px;background:#d1d5db}

/* ── 状态圆点 / 编号 / 徽章（StatusCell 系） ── */
.tb3w-root .dot{display:inline-block;flex:0 0 auto;width:7px;height:7px;border-radius:50%;background:var(--state-unspecified-dot)}
.tb3w-root .dot--unspecified{background:var(--state-unspecified-dot)}
.tb3w-root .dot--submitted{background:var(--state-submitted-dot)}
.tb3w-root .dot--working{background:var(--state-working-dot)}
.tb3w-root .dot--inputRequired{background:var(--state-inputRequired-dot)}
.tb3w-root .dot--authRequired{background:var(--state-authRequired-dot)}
.tb3w-root .dot--completed{background:var(--state-completed-dot)}
.tb3w-root .dot--failed{background:var(--state-failed-dot)}
.tb3w-root .dot--canceled{background:var(--state-canceled-dot)}
.tb3w-root .dot--rejected{background:var(--state-rejected-dot)}
.tb3w-root .card-id{flex:0 0 auto;font-family:var(--font-mono);font-size:var(--fs-id);font-weight:700;letter-spacing:-.2px}
.tb3w-root .card-id--goal{color:var(--kind-goal-fg)}
.tb3w-root .card-id--design{color:var(--kind-design-fg)}
.tb3w-root .card-id--work{color:var(--kind-work-fg)}
.tb3w-root .card-id--record{color:var(--kind-record-fg)}
.tb3w-root .badge{display:inline-block;flex:0 0 auto;padding:0 5px;border-radius:3px;font-size:var(--fs-badge);line-height:1.6;white-space:nowrap}
.tb3w-root .badge--goal{background:var(--kind-goal-bg);color:var(--kind-goal-fg)}
.tb3w-root .badge--design{background:var(--kind-design-bg);color:var(--kind-design-fg)}
.tb3w-root .badge--work{background:var(--kind-work-bg);color:var(--kind-work-fg)}
.tb3w-root .badge--record{background:var(--kind-record-bg);color:var(--kind-record-fg)}
.tb3w-root .badge--domain{background:#f3f4f6;color:var(--text-secondary)}
.tb3w-root .badge--template{background:#eef1f5;color:var(--text-secondary)}
/*
 * ⚠ 非紧凑态的 .task-card__status 原先只存在于旧面板的 CSS（.status-line 那段），
 *   V3 的详情头部用到了它 ⇒ 这里补一条基础规则（**样式钩子，不改组件行为**）。
 */
.tb3w-root .task-card__status{display:inline-flex;align-items:center;gap:4px;min-width:0;font-size:11.5px;color:var(--text-secondary)}
.tb3w-root .task-card__status-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tb3w-root .task-card__status.is-compact{flex:0 0 auto;align-items:center;gap:3px;font-size:9px;color:var(--text-weak)}

/* ── CardRow ── */
.tb3w-root .task-card{display:flex;align-items:stretch;gap:0;width:100%;margin-bottom:6px;padding:8px 12px;border:2px solid var(--border);border-radius:8px;background:var(--bg-card);color:inherit;font-family:inherit;text-align:left;cursor:pointer;transition:border-color .12s,background .12s}
.tb3w-root .task-card:hover{background:#f8f9fb}
.tb3w-root .task-card.is-selected{border-color:var(--accent);background:#f5f9ff}
.tb3w-root .task-card.is-draft{border-color:transparent}
.tb3w-root .task-card.is-draft:hover{border-color:var(--border)}
.tb3w-root .task-card.is-draft.is-selected{border-color:var(--accent)}
.tb3w-root .task-card.is-unread-ai{border-left-width:4px;border-left-color:var(--accent);padding-left:10px}
.tb3w-root .task-card.is-unread-user{border-right-width:4px;border-right-color:var(--warn);padding-right:10px}
.tb3w-root .task-card__square{flex:0 0 46px;display:flex;flex-direction:column;justify-content:center;gap:2px;min-width:0}
.tb3w-root .task-card__square-id{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--font-mono);font-size:var(--fs-id);font-weight:700;letter-spacing:-.2px}
.tb3w-root .task-card__body{flex:1 1 auto;display:flex;flex-direction:column;justify-content:center;min-width:0}
.tb3w-root .task-card__line{display:flex;align-items:center;gap:6px;min-width:0}
.tb3w-root .task-card__line .badge{max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tb3w-root .task-card__title{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--fs-body);font-weight:600}
.tb3w-root .task-card__when{flex:0 0 90px;overflow:hidden;text-align:right;font-size:11px;color:var(--text-weak);white-space:nowrap}
.tb3w-root .task-card__when-label{display:block;font-size:9px;opacity:.7}
.tb3w-root .task-card.is-unread-ai .card-id{font-weight:800}

/* ── CardDetail ── */
.tb3w-root .detail{display:flex;flex-direction:column;gap:14px;min-width:0;padding:16px 18px;border:1px solid var(--border);border-radius:10px;background:var(--bg-card)}
.tb3w-root .detail-head{display:flex;flex-direction:column;gap:8px;min-width:0}
.tb3w-root .detail-title-row{display:flex;align-items:flex-start;gap:8px;min-width:0}
.tb3w-root .detail-title{flex:1 1 auto;min-width:0;margin:0;overflow-wrap:anywhere;color:var(--text);font-size:17px;font-weight:700;line-height:1.4;letter-spacing:-.01em}
.tb3w-root .detail-title-row__spacer{flex:0 0 auto;width:0}
.tb3w-root .icon-btn{display:inline-flex;flex:0 0 auto;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:1px solid transparent;border-radius:5px;background:none;color:var(--text-weak);font-family:inherit;font-size:14px;line-height:1;cursor:pointer}
.tb3w-root .icon-btn:hover{border-color:var(--border);background:#f6f7f9;color:var(--text)}
/* meta 行：状态是**固定 92px 首列**，不随 label 变宽而漂移 */
.tb3w-root .detail-meta{display:flex;align-items:center;gap:8px;flex-wrap:nowrap;min-width:0;font-size:11.5px;color:var(--text-secondary)}
.tb3w-root .detail-meta > *{flex:0 0 auto;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* 用户 2026-11-20：「为什么是固定宽度呢。应该是设计这个东西最小宽度 4em 啊」——
 * 用 min-width 而不是 flex-basis：短状态保持 4em（中文 1em = 1 字，正好容纳「需要信息」这种 4 字状态），
 * 更长的状态自动撑开，不会被截断。 */
.tb3w-root .detail-status-col{display:inline-flex;align-items:center;min-width:4em;margin-left:0;padding:0}
.tb3w-root .detail-actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px}
.tb3w-root .detail-action{display:inline-flex;align-items:center;gap:6px;padding:4px 11px;font-size:12px}
.tb3w-root .detail-action.is-primary{border-color:var(--accent);background:var(--accent);color:#fff;font-weight:600}
.tb3w-root .detail-action.is-primary:hover:not(:disabled){border-color:var(--accent-strong);background:var(--accent-strong);color:#fff}
.tb3w-root .detail-action.is-primary:disabled{opacity:.4;cursor:not-allowed}
.tb3w-root .detail-action__badge{display:inline-flex;align-items:center;justify-content:center;min-width:17px;height:17px;padding:0 4px;border-radius:9px;background:rgb(255 255 255 / 24%);font-family:var(--font-mono);font-size:10px;font-weight:700;line-height:1}
.tb3w-root .detail-action:not(.is-primary) .detail-action__badge{background:#eef1f5;color:var(--text-secondary)}
.tb3w-root .detail-banner{padding:8px 11px;border:1px solid #fde68a;border-radius:7px;background:#fffbeb;color:#92400e;font-size:11.5px;line-height:1.6}
.tb3w-root .detail-sections{display:flex;flex-direction:column;gap:12px;min-width:0}
/*
 * ⚠ 这里曾经有 .detail-section / __label / __body / __empty —— 它们只服务
 *   CardDetail 里的占位组件 SectionStub。2026-11-20 章节改用定稿 Section
 *   （.section-block 那一套在 SECTION_CSS 里）⇒ 这几条已删，别再加回来。
 */
.tb3w-root .detail-empty{font-size:12px;color:var(--text-weak)}
.tb3w-root .detail-note{display:flex;flex-direction:column;gap:5px;min-width:0;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:#fbfcfd}
.tb3w-root .detail-note__label{font-size:11.5px;font-weight:600;color:var(--text-secondary)}
.tb3w-root .detail-note__input{width:100%;padding:7px 9px;border:1px solid transparent;border-radius:5px;background:var(--bg-card);resize:vertical;color:var(--text);font-family:inherit;font-size:12.5px;line-height:1.7}
.tb3w-root .detail-note__input:focus{border-color:#93c5fd;box-shadow:0 0 0 3px rgb(37 99 235 / 10%);outline:none}
.tb3w-root .detail-note__input:disabled{background:#f4f5f7;color:var(--text-weak);cursor:not-allowed}
.tb3w-root .detail-note__readonly{font-size:11px;color:var(--text-weak)}
.tb3w-root .detail-history{display:flex;flex-direction:column;gap:6px;min-width:0}
.tb3w-root .detail-history__head{display:inline-flex;align-self:flex-start;align-items:center;gap:6px;margin-left:-6px;padding:2px 6px;color:var(--text-secondary);font-size:12px;font-weight:600}
.tb3w-root .detail-history__list{display:flex;flex-direction:column;gap:7px;margin:0;padding:0 0 0 2px;list-style:none}
.tb3w-root .detail-history__item{display:flex;align-items:baseline;gap:8px;min-width:0;color:#3f4652;font-size:11.5px;line-height:1.6}
.tb3w-root .detail-history__dot{flex:0 0 auto;width:5px;height:5px;border-radius:50%;background:#cbd5e1;transform:translateY(-2px)}
.tb3w-root .detail-history__item.is-ai .detail-history__dot{background:#2563eb}
.tb3w-root .detail-history__item.is-user .detail-history__dot{background:var(--text)}
.tb3w-root .detail-history__text{flex:1 1 auto;min-width:0;overflow-wrap:anywhere}
.tb3w-root .detail-history__time{flex:0 0 auto;color:var(--text-weak);font-family:var(--font-mono);font-size:10.5px}

/*
 * ── RelationPanel（关系折叠面板） ──
 *
 * 用户 2026-11-20：「关系的折叠面板。你也没有做独立组件给我看给我选。没有接入。」
 *
 * 结构（变体 A，原版形态）：
 *   .rel-head   [折叠头 关系 N] [父任务 chip] [spacer] [+ 派生子任务]
 *   .rel-table
 *     .rel-columns  进行 / 搁置 / 完成 三列表头（带计数）
 *     .rel-group    每个关系类型一条组横条 + 三列（卡按自身 status 落列）
 *
 * 组横条的线色/底色、三列表头的圆点色都是**内联 style** —— 值来自
 * pure/relations-block.ts（原版 relations.js:118-125 的颜色），
 * CSS 里不写第二份（写第二份就会漂）。
 */
.tb3w-root .rel-panel{display:flex;flex-direction:column;gap:8px;min-width:0}
.tb3w-root .rel-head{display:flex;align-items:center;flex-wrap:wrap;gap:8px;min-width:0}
.tb3w-root .rel-head__spacer{flex:1 1 auto}
.tb3w-root .rel-head__total{display:inline-flex;align-items:center;padding:4px 2px;color:var(--text);font-size:12px;font-weight:600;white-space:nowrap}
.tb3w-root .rel-toggle{display:inline-flex;align-items:center;gap:5px;padding:4px 11px;border:1px solid var(--border);border-radius:6px;background:#f3f4f6;color:var(--text);font-family:inherit;font-size:12px;font-weight:600;cursor:pointer;transition:background .12s}
.tb3w-root .rel-toggle:hover{background:#e5e7eb}
.tb3w-root .rel-toggle.is-open{background:#eef1f5}
.tb3w-root .rel-toggle__caret{flex:0 0 auto;color:var(--text-secondary);font-size:10px}
.tb3w-root .rel-toggle__label{flex:0 0 auto;white-space:nowrap}
.tb3w-root .rel-toggle__summary{min-width:0;margin-left:2px;overflow:hidden;text-overflow:ellipsis;color:var(--text-secondary);font-weight:400;white-space:nowrap}
.tb3w-root .rel-parent-chip{display:inline-flex;align-items:center;gap:6px;max-width:260px;min-width:0;padding:3px 8px;border:1px solid var(--border);border-radius:6px;background:var(--bg-card);color:var(--text);font-family:inherit;font-size:12px;text-align:left;cursor:pointer}
.tb3w-root .rel-parent-chip:hover{border-color:var(--text-weak)}
.tb3w-root .rel-parent-chip__arrow{flex:0 0 auto;color:var(--text-weak);font-size:11px;white-space:nowrap}
.tb3w-root .rel-table{border:1px solid var(--border);border-radius:8px;overflow:hidden;background:var(--bg-card)}
.tb3w-root .rel-columns{display:grid;grid-template-columns:repeat(3,1fr);border-bottom:1px solid #f2f4f7;background:#f9fafb}
.tb3w-root .rel-columns__cell{display:flex;align-items:center;gap:5px;padding:7px 10px;border-top:2px solid transparent;border-right:1px solid #f2f4f7;color:var(--text-secondary);font-size:11.5px;font-weight:600}
.tb3w-root .rel-columns__cell:last-child{border-right:none}
.tb3w-root .rel-columns__cell--active{border-top-color:#2563eb}
.tb3w-root .rel-columns__cell--shelved{border-top-color:#f59e0b}
.tb3w-root .rel-columns__cell--ended{border-top-color:#10b981}
.tb3w-root .rel-columns__dot{flex:0 0 auto;width:6px;height:6px;border-radius:50%}
.tb3w-root .rel-columns__count{color:var(--text-weak);font-family:var(--font-mono);font-size:10.5px;font-weight:700}
.tb3w-root .rel-group + .rel-group{border-top:1px solid #f2f4f7}
.tb3w-root .rel-group__head{display:flex;align-items:center;gap:6px;padding:5px 10px 5px 8px;border-left:3px solid transparent;color:var(--text);font-size:11.5px;font-weight:600}
.tb3w-root .rel-group__line{flex:0 0 auto;width:12px;height:2px}
.tb3w-root .rel-group__label{flex:0 0 auto}
.tb3w-root .rel-group__count{color:var(--text-secondary);font-family:var(--font-mono);font-size:10.5px}
.tb3w-root .rel-group__body{display:grid;grid-template-columns:repeat(3,1fr)}
.tb3w-root .rel-group__col{display:flex;flex-direction:column;gap:5px;min-width:0;padding:8px 10px;border-right:1px solid #f2f4f7}
.tb3w-root .rel-group__col:last-child{border-right:none}
.tb3w-root .rel-group__cards{display:flex;flex-wrap:wrap;gap:6px;padding:8px 10px}
.tb3w-root .rel-flat{border:1px solid var(--border);border-radius:8px;overflow:hidden;background:var(--bg-card)}
.tb3w-root .rel-chip{display:flex;align-items:center;gap:5px;width:100%;min-width:0;padding:4px 8px;border:1px solid var(--border);border-radius:6px;background:var(--bg-card);color:var(--text);font-family:inherit;font-size:12px;text-align:left;cursor:pointer}
.tb3w-root .rel-chip:hover{border-color:var(--text-weak);background:#fafafa}
.tb3w-root .rel-chip__arrow{flex:0 0 auto;color:var(--text-weak);font-size:10px}
.tb3w-root .rel-chip__id{flex:0 0 auto;font-family:var(--font-mono);font-size:11px;font-weight:700;letter-spacing:-.2px}
.tb3w-root .rel-chip__title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text)}
.tb3w-root .rel-group__cards .rel-chip{width:auto;max-width:100%}
.tb3w-root .rel-group__cards .rel-chip__title{max-width:200px}
.tb3w-root .rel-empty{padding:16px;border:1px dashed var(--border);border-radius:8px;color:var(--text-weak);font-size:12px;text-align:center}
.tb3w-root .rel-foot{display:flex}
.tb3w-root .rel-add{font-size:11.5px}

/* ── StatusMenu（portal 到 body ⇒ 用 data-menu 作用域） ── */
[data-menu="status"]{position:fixed;z-index:150;width:280px;min-width:250px;padding:8px;border:1px solid var(--border);border-radius:8px;background:var(--bg-card);box-shadow:0 10px 30px rgb(0 0 0 / 14%);overflow-y:auto;color:var(--text);font-size:13px;line-height:1.5}
[data-menu="status"] .menu__title{padding:4px 8px 6px;color:var(--text-weak);font-size:11px;font-weight:600}
[data-menu="status"] .menu__item{display:flex;align-items:center;gap:8px;width:100%;padding:5px 8px;border:0;border-radius:5px;background:none;color:var(--text);font-family:inherit;font-size:12px;text-align:left;cursor:pointer}
[data-menu="status"] .menu__item:hover,[data-menu="status"] .menu__item.is-active{background:#f3f4f6}
[data-menu="status"] .menu__tone--unspecified{color:var(--state-unspecified-fg)}
[data-menu="status"] .menu__tone--submitted{color:var(--state-submitted-fg)}
[data-menu="status"] .menu__tone--working{color:var(--state-working-fg)}
[data-menu="status"] .menu__tone--inputRequired{color:var(--state-inputRequired-fg)}
[data-menu="status"] .menu__tone--authRequired{color:var(--state-authRequired-fg)}
[data-menu="status"] .menu__tone--completed{color:var(--state-completed-fg)}
[data-menu="status"] .menu__tone--failed{color:var(--state-failed-fg)}
[data-menu="status"] .menu__tone--canceled{color:var(--state-canceled-fg)}
[data-menu="status"] .menu__tone--rejected{color:var(--state-rejected-fg)}
[data-menu="status"] .menu__icon{flex:0 0 auto;width:15px;text-align:center;color:var(--text-weak);font-size:11px}
[data-menu="status"] .menu__item[class*="menu__tone--"] .menu__icon{color:inherit}
[data-menu="status"] .menu__label{flex:0 0 auto}
[data-menu="status"] .menu__hint{margin-left:auto;padding-left:14px;color:var(--text-weak);font-size:11px}
[data-menu="status"] .menu__divider{height:1px;margin:4px 0;background:#f2f4f7}
[data-menu="status"] .menu__empty{padding:8px;color:var(--text-weak);font-size:12px}
[data-menu="status"] .menu__footer{margin-top:4px;padding:8px 8px 2px;border-top:1px solid #f2f4f7;color:var(--text-weak);font-size:11px;line-height:1.6}

/* ══════════════════════════════════════════════════════════
   3. 响应式：宽 < 700px ⇒ 上下堆叠（结构变）
   ══════════════════════════════════════════════════════════ */

@container tb3w (max-width: 700px) {
  .tb3w-page{padding:10px 12px}
  .tb3w-main{flex-direction:column;margin-top:6px}
  .tb3w-list{flex:0 0 52%}
  .tb3w-split{flex:0 0 20px;cursor:row-resize}
  .tb3w-split__line{top:50%;bottom:auto;left:8px;right:8px;width:auto;height:0;border-left:0;border-top:3px dashed #c3cad4}
  .tb3w-split__grip{display:none}
  .tb3w-detail{flex:1 1 0;min-width:0;max-width:none;min-height:0}
  /* 列名行在小容器里去掉 —— 8.5px 的列名比行本身还占地方 */
  .tb3w-list__cols{display:none}

  /* 设计图（570×920）里窄版控件小一号：chip 24px、工具栏 10.5px、筛选框 26px */
  .tb3w-chrome > .space-bar{gap:5px;padding:4px 2px}
  .tb3w-root .space-chip{padding:3px 10px;font-size:11px}
  .tb3w-root .space-chip__count{font-size:9.5px}
  .tb3w-root .ghost-btn{padding:3px 9px;font-size:11px}
  .tb3w-root .space-action{min-width:72px}
  .tb3w-toolbar{margin-top:8px;gap:4px 8px}
  .tb3w-toolbar__title{font-size:12px}
  .tb3w-toolbar__legend{order:3;flex:1 0 100%;gap:2px 9px;font-size:9.5px}
  .tb3w-toolbar__actions{order:2}
  .tb3w-toolbar__perm{display:none}
  .tb3w-legend__hint--long{display:none}
  .tb3w-legend__hint--short{display:inline}
  .tb3w-seg__btn{padding:2px 9px;font-size:10.5px}
  .tb3w-btn-primary{padding:3px 10px;font-size:10.5px}
  .tb3w-filters{margin-top:6px}
  .tb3w-filters .filter-row__spacer{display:none}
  .tb3w-filters__tail{flex:1 0 100%;flex-wrap:wrap;gap:6px}
  .tb3w-root .filter-row{gap:6px}
  .tb3w-root .filter-box{height:26px}
  .tb3w-root .filter-box__face{left:10px}
  .tb3w-root .filter-box__title,.tb3w-root .filter-box__colon{font-size:11px}
  .tb3w-root .filter-box__item{font-size:11px;padding:2px 3px}
  .tb3w-root .filter-box__csep,.tb3w-root .filter-box__sep{font-size:11px}
  .tb3w-root .filter-box__vline{margin:0 7px}
  .tb3w-ai-chip{display:none}
  .tb3w-filters__tail .search-box{flex:1 1 100%;width:100%}
  .tb3w-list__head{padding:9px 12px 5px}
  .tb3w-list__title{font-size:12px}
  .tb3w-list__body{padding:6px 12px 10px}
  .tb3w-root .task-card{margin-bottom:5px;padding:6px 10px}
  .tb3w-root .task-card.is-unread-ai{padding-left:8px}
  .tb3w-root .task-card.is-unread-user{padding-right:8px}
  .tb3w-root .detail{padding:12px 14px;gap:11px}
  .tb3w-root .detail-title{font-size:14px}
  .tb3w-root .detail-history__item{font-size:10.5px}
}
`;

/* ══════════════════════════════════════════════════════════
   抽屉（V5 重做）—— 前缀 `tb3d-`

   形状（用户 `2026-11-20` 画图标注）：

   ```
   ┌──────────────────────────────────────┐
   │ 面板：输入框正上方展开，宽度 = 输入框宽 │
   │ 高度 ≈ 屏幕一半；底边贴输入框上边缘     │
   └──────────────────────────────────────┘
   ┌─┐ ┌──────────────────────────────┬───┐
   │▣│ │ 发消息或创建任务…              │ ➤ │
   └─┘ └──────────────────────────────┴───┘
    ↑ 正方形入口：右边缘贴输入框左边缘，和 + 同一行
   ```

   挂载点：入口 `conversation.input.left`、面板 `conversation.input.overlay`
   （asar 原文与几何证据见 `pure/drawer-view.ts` 文件头）。
   **不用 `shell.overlay`** —— 那是整帧浮层，会横跨窗口（V4 因此被用户否了）。

   ## 为什么 CSS 由纯逻辑插值生成

   三个候选形态的间距 / 圆角 / 高度 / 阴影 / 动画都在 `DRAWER_VARIANTS` 表里
   （`pure/drawer-view.ts`），这里只拼 `[data-drawer-variant="…"]` 规则。
   表改了 CSS 跟着变；单测断言「表里的每个值都出现在 CSS 里」⇒ 两份数值不可能漂。

   ## 三条硬约束

   1. **面板不用 `position:fixed`**（用户 `2026-11-19` 否过：fixed 会逃出父容器）。
      只有候选 C 的半透明**遮罩**用 fixed —— 那是「铺满视口」的语义，而且只在
      用户选中 C 时才渲染。
   2. **两栏各自滚，面板自己不滚**（`.tb3d-body{overflow:hidden}`）。
   3. **宽度不写死**：面板 `left:0;right:0` 撑满 overlayAnchor = 输入框卡片宽。

   ⚠ 本文件是模板字符串 —— 注释里**不能出现反引号**（会提前结束字符串）。
   ══════════════════════════════════════════════════════════ */

export const DRAWER_CSS = `
/* ── 0. 令牌（没宿主主题时用兜底色） ── */
.tb3d-layer{
  --tb3d-border:#d5dae1; --tb3d-border-weak:#eceff2; --tb3d-head-bg:#fbfcfd;
  --tb3d-bg:#fff; --tb3d-text:#16181d; --tb3d-text-secondary:#6b7280;
}

/*
 * ── 1. 层：绝对定位、零高度 ──
 *
 * DSH 的 overlayAnchor 原文是 height:0;position:absolute;inset:0 0 auto。
 * 本层贴满它（= 输入框卡片顶部一条零高度线）；面板相对本层 bottom:100% 向上长，
 * 于是「面板底边 = 输入框上边缘 + 形态间距」是**结构保证**，不是调出来的。
 */
.tb3d-layer{position:absolute;left:0;right:0;top:0;height:0;z-index:30;pointer-events:none}

/* ── 2. 面板：底边贴输入框上边缘、宽度 = 输入框宽 ── */
.tb3d-panel{
  position:absolute;left:0;right:0;z-index:1;
  display:flex;flex-direction:column;min-height:0;
  border:1px solid var(--tb3d-border);background:var(--tb3d-bg);
  overflow:hidden;pointer-events:auto;
}
${DRAWER_VARIANT_IDS.map(
	(id) => `.tb3d-panel[data-drawer-variant="${id}"]{${drawerPanelCssOf(DRAWER_VARIANTS[id])}}`,
).join('\n')}
/* 候选 B / C 的上滑动画；prefers-reduced-motion 下一律不动。 */
@keyframes tb3d-rise{
  from{transform:translateY(14px);opacity:.55}
  to{transform:translateY(0);opacity:1}
}
@media (prefers-reduced-motion:reduce){.tb3d-panel{animation:none}}

/* ── 3. 遮罩（只有候选 C 渲染；点它 = 点外部 = 关） ── */
.tb3d-mask{${drawerMaskCssOf()};z-index:0}

/* ── 4. 入口：正方形，右边缘贴输入框左边缘（相对 composer 卡片定位） ── */
.tb3d-entry{
  position:absolute;${drawerEntryCssOf()};
  display:inline-flex;align-items:center;justify-content:center;padding:0;
  border:1px solid var(--tb3d-border);border-radius:8px;
  background:var(--tb3d-bg);color:var(--tb3d-text-secondary);
  font-family:inherit;line-height:1;cursor:pointer;z-index:2;
  transition:border-color .12s,background .12s,color .12s;
}
.tb3d-entry:hover{border-color:#cfd5dd;background:#f8fafc;color:#1f2328}
.tb3d-entry[aria-expanded="true"]{border-color:#2563eb;background:#2563eb;color:#fff}
.tb3d-entry svg{display:block}

/* ── 5. 顶栏：标题 / 刷新 / 关闭 ── */
.tb3d-head{
  flex:0 0 auto;display:flex;align-items:center;gap:8px;height:${px(DRAWER_COMPACT_SPACING.headerHeight)};
  padding:0 10px 0 16px;background:var(--tb3d-head-bg);border-bottom:1px solid var(--tb3d-border-weak);
}
.tb3d-head__title{
  flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  color:var(--tb3d-text);font-size:13.5px;font-weight:700;letter-spacing:.01em;
}
.tb3d-head__actions{flex:0 0 auto;display:flex;align-items:center;gap:6px}
.tb3d-iconbtn{
  display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;
  border:1px solid #e2e5ea;border-radius:6px;background:#fff;color:#6b7280;
  font-family:inherit;line-height:1;cursor:pointer;transition:color .12s,border-color .12s,background .12s;
}
.tb3d-iconbtn:hover{color:#1f2328;border-color:#cfd5dd;background:#f8fafc}

/* ── 6. 主体：装压缩版 Workspace；面板自己不滚（两栏各自滚） ── */
.tb3d-body{flex:1 1 auto;display:flex;min-height:0;overflow:hidden}
.tb3d-body > .tb3w-root{flex:1 1 auto;min-width:0;min-height:0}

/*
 * ── 7. 压缩：**只收纵向间距**（数值全部来自 DRAWER_COMPACT_SPACING）──
 *
 * 面板高约 min(50vh,480px)，内容区比 V4 的 400 还略高；这套间距是照 400 高量的，
 * 只会更宽松。等用户选定形态、能测真实高度后再复量一次。
 */
.tb3d-panel .tb3w-page{padding:${px(DRAWER_COMPACT_SPACING.pagePadY)} ${px(DRAWER_COMPACT_SPACING.pagePadX)}}

/*
 * chrome 固定两行（用户 2026-11-20：「我要的抽屉视图是两行」）。
 *
 * ⚠ 旧版这里把 chrome 改成 flex-direction:row 并 display:none 掉了
 *   title / legend / filters —— 用户看到的「图例弄没了」「挤成一行」就是这 6 条
 *   造成的，**不是 flex-wrap**。
 *   行 1 = 任务条 + 关系图例 + 工具栏；行 2 = 筛选按钮 + 搜索。
 */
.tb3d-panel .tb3w-chrome{flex-direction:column;gap:0}
.tb3d-panel .tb3w-chrome > .space-bar{flex:0 1 auto;min-width:0;padding:2px 2px;gap:5px}
.tb3d-panel .tb3w-toolbar{flex:0 0 auto;justify-content:flex-end;margin-top:${px(DRAWER_COMPACT_SPACING.toolbarGap)};gap:4px 8px}
.tb3d-panel .tb3w-toolbar__perm{display:none}
/* 行 2：筛选 + 搜索。参与文档流（不浮层）—— 展开只撑高这一行。 */
.tb3d-panel .tb3w-filters{flex:0 0 auto;margin-top:${px(DRAWER_COMPACT_SPACING.toolbarGap)}}
.tb3d-panel .tb3w-main{margin-top:${px(DRAWER_COMPACT_SPACING.mainGap)}}

/* 控件小一号（高度不变形，只影响视觉密度） */
.tb3d-panel .tb3w-root .space-chip{padding:2px 9px;font-size:11px}
.tb3d-panel .tb3w-root .space-action{min-width:0;padding:2px 9px;font-size:11px}
.tb3d-panel .tb3w-root .ghost-btn{padding:2px 9px;font-size:11px}
.tb3d-panel .tb3w-seg__btn{padding:2px 9px;font-size:10.5px}
.tb3d-panel .tb3w-btn-primary{padding:3px 10px;font-size:10.5px}

/* 列表 */
.tb3d-panel .tb3w-list__head{padding:${px(DRAWER_COMPACT_SPACING.listHeadPadTop)} 12px ${px(DRAWER_COMPACT_SPACING.listHeadPadBottom)}}
.tb3d-panel .tb3w-list__cols{display:none}
.tb3d-panel .tb3w-list__body{padding:${px(DRAWER_COMPACT_SPACING.listBodyPadTop)} ${px(DRAWER_COMPACT_SPACING.listBodyPadX)} ${px(DRAWER_COMPACT_SPACING.listBodyPadBottom)}}
.tb3d-panel .tb3w-root .task-card{margin-bottom:${px(DRAWER_COMPACT_SPACING.cardGap)};padding:${px(DRAWER_COMPACT_SPACING.cardPadY)} 10px}

/* 详情 */
.tb3d-panel .tb3w-root .detail{padding:${px(DRAWER_COMPACT_SPACING.detailPadY)} ${px(DRAWER_COMPACT_SPACING.detailPadX)};gap:${px(DRAWER_COMPACT_SPACING.detailGap)}}
.tb3d-panel .tb3w-root .detail-sections{gap:${px(DRAWER_COMPACT_SPACING.sectionGap)}}
.tb3d-panel .tb3w-root .detail-title{font-size:14px}
.tb3d-panel .tb3w-root .detail-history{gap:5px}
.tb3d-panel .tb3w-root .detail-history__item{font-size:10.5px}
.tb3d-panel .tb3w-root .detail-action{padding:3px 9px;font-size:11px}

/*
 * ── 8. 宽版：左列固定 320（列表 316px、详情吃剩余）──
 *
 * ⚠ 只在容器宽 ≥ 700 时生效：窄于 700 时 Workspace 自己会切上下堆叠
 *   （@container tb3w (max-width:700px)），这时再钉死 320 宽会把堆叠挤坏。
 */
@container tb3w (min-width: 700px) {
  .tb3d-panel .tb3w-list{flex:0 0 ${px(DRAWER_COMPACT_SPACING.listWidth)}}
  .tb3d-panel .tb3w-detail{flex:1 1 0;min-width:0;max-width:none}
}
`;

/**
 * 章节渲染（`Section` / `Markdown` / `AskSection`）的样式 —— 作用域 `.tb3w-root`。
 *
 * ## 为什么单独一段
 *
 * 这三个组件是 C6 定稿的，但它们的 CSS 一直**只存在于预览**里：
 * `dev/preview/section/style.css` + `dev/preview/markdown/style.css`。
 * 2026-11-20 章节接进 `CardDetail`（详情是产品级页面）⇒ 必须在产品样式里
 * 收口一份，否则详情里的章节是**裸文本**：没有外框、markdown 没有排版、
 * ask 没有选项样式。
 *
 * 规则**逐条照搬**那两个 preview CSS，只加 `.tb3w-root` 前缀，类名一个没改
 * （那些预览验收过的 DOM 仍然对得上）。
 *
 * ## 间距归父容器管
 *
 * `.section-block` 在预览里自带 `margin-bottom:10px`；产品里章节挂在
 * `.detail-sections`（`display:flex;gap:12px`）下 ⇒ 这里**不加 margin**，
 * 否则间距叠加成 22px。
 *
 * ⚠ 本文件是模板字符串 —— 注释里不能出现反引号。
 */
export const SECTION_CSS = `
/* ── 一章的外框 ── */
.tb3w-root .section-block{padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:var(--bg-card)}
/* 可编辑：整章是点击目标 ⇒ 给 hover 反馈；只读时没有 pointer/hover（点不动看得出来） */
.tb3w-root .section-block.is-editable{cursor:pointer;transition:border-color .12s,background .12s}
.tb3w-root .section-block.is-editable:hover{border-color:var(--accent);background:#f8fbff}
.tb3w-root .section-block__label{display:flex;align-items:baseline;gap:8px;margin-bottom:6px;font-size:11.5px;color:var(--text-secondary)}
.tb3w-root .section-block__label-text{font-weight:600}
.tb3w-root .section-block__edit-hint{margin-left:auto;font-size:10.5px;color:var(--accent);opacity:0;transition:opacity .12s}
.tb3w-root .section-block.is-editable:hover .section-block__edit-hint{opacity:1}
/* text 正文：保留换行与缩进（text 与 markdown 的区别就在这里） */
.tb3w-root .section-block__text{font-size:12.5px;line-height:1.75;color:var(--text);white-space:pre-wrap;word-break:break-word}
/* ── 三相位的内联编辑（用户 2026-11-21 采纳） ── */
.tb3w-root .section-block__field{display:flex;flex-direction:column;gap:6px;min-width:0}
.tb3w-root .section-block__textarea{width:100%;box-sizing:border-box;padding:7px 9px;border:1px solid var(--border-strong,#d7dbe2);border-radius:6px;background:#fff;color:var(--text);font:12.5px/1.7 inherit;resize:vertical}
.tb3w-root .section-block__textarea:focus{outline:none;border-color:var(--accent)}
.tb3w-root .section-block__textarea.is-readonly{background:#fafbfc;color:var(--text-secondary);border-color:var(--border,#e7e9ee);cursor:default}
.tb3w-root .section-block__textarea.is-mono{font-family:ui-monospace,Consolas,monospace;font-size:11.5px}
.tb3w-root .section-block__decl{border:1px dashed var(--border-strong,#d7dbe2);border-radius:6px;background:#fafbfc;padding:5px 9px}
.tb3w-root .section-block__decl summary{cursor:pointer;font-size:11px;color:var(--text-secondary)}
.tb3w-root .section-block__decl-input{width:100%;box-sizing:border-box;margin-top:5px;padding:5px 8px;border:1px solid var(--border-strong,#d7dbe2);border-radius:5px;background:#fff;font:11.5px/1.6 inherit;color:var(--text)}
.tb3w-root .section-block__actions{display:flex;gap:6px}
/* 空态 / 模板作者写的灰字 */
.tb3w-root .section-block__placeholder{font-size:12.5px;line-height:1.7;color:var(--text-weak);font-style:italic}

/* ══════════════════════════════════════════════════════════
   markdown（来自 dev/preview/markdown/style.css）
   ══════════════════════════════════════════════════════════ */
.tb3w-root .md{line-height:1.65;color:var(--text);word-break:break-word}
.tb3w-root .md > *:first-child{margin-top:0}
.tb3w-root .md > *:last-child{margin-bottom:0}
.tb3w-root .md p,.tb3w-root .md ul,.tb3w-root .md ol,.tb3w-root .md blockquote,.tb3w-root .md table,.tb3w-root .md pre{margin:.6em 0}
.tb3w-root .md h1,.tb3w-root .md h2,.tb3w-root .md h3,.tb3w-root .md h4,.tb3w-root .md h5,.tb3w-root .md h6{margin:1em 0 .5em;line-height:1.3;font-weight:600;color:var(--text)}
.tb3w-root .md h1{font-size:1.5em}
.tb3w-root .md h2{font-size:1.28em}
.tb3w-root .md h3{font-size:1.12em}
.tb3w-root .md h4,.tb3w-root .md h5,.tb3w-root .md h6{font-size:1em}
.tb3w-root .md ul,.tb3w-root .md ol{padding-left:1.5em}
.tb3w-root .md li + li{margin-top:.2em}
.tb3w-root .md blockquote{padding:.2em 0 .2em .9em;border-left:3px solid var(--border);color:var(--text-secondary)}
.tb3w-root .md hr{margin:1.2em 0;border:0;border-top:1px solid var(--border)}
.tb3w-root .md a{color:var(--accent);text-decoration:none}
.tb3w-root .md a:hover{text-decoration:underline}
.tb3w-root .md code{padding:.15em .35em;border-radius:4px;background:#f1f3f6;font-family:var(--font-mono);font-size:.92em}
/* 代码块：pre.md-code 里再套 code.md-code__body（内层不重复加底色） */
.tb3w-root .md pre.md-code{position:relative;overflow-x:auto;padding:.9em .9em .8em;border:1px solid var(--border);border-radius:7px;background:#f7f8fa}
.tb3w-root .md pre.md-code > code.md-code__body{padding:0;background:none;font-size:.9em;white-space:pre}
/* 语言标签挂右上角（data-lang 只是数据，展示靠伪元素） */
.tb3w-root .md pre.md-code[data-lang]::before{content:attr(data-lang);position:absolute;top:.35em;right:.7em;font-size:.72em;color:#9aa1ad;text-transform:uppercase;letter-spacing:.06em}
.tb3w-root .md table.md-table{border-collapse:collapse;width:100%;font-size:.95em}
.tb3w-root .md table.md-table th,.tb3w-root .md table.md-table td{padding:.35em .7em;border:1px solid var(--border);text-align:left}
.tb3w-root .md table.md-table th{background:#f7f8fa;font-weight:600}
.tb3w-root .md table.md-table th[align='center'],.tb3w-root .md table.md-table td[align='center']{text-align:center}
.tb3w-root .md table.md-table th[align='right'],.tb3w-root .md table.md-table td[align='right']{text-align:right}
/* 任务项：方框由组件产出（span.md-task__box），这里只管排版 */
.tb3w-root .md li.md-task{list-style:none;margin-left:-1.2em}
.tb3w-root .md li.md-task .md-task__box{display:inline-block;width:1.5em;color:var(--text-secondary)}
.tb3w-root .md li.md-task.is-done{color:var(--text-secondary)}

/* ══════════════════════════════════════════════════════════
   ask（来自 dev/preview/section/style.css）
   ══════════════════════════════════════════════════════════ */
.tb3w-root .ask-group + .ask-group{margin-top:14px;padding-top:12px;border-top:1px dashed var(--border)}
.tb3w-root .ask-group__header{margin-bottom:2px;font-size:10.5px;color:var(--text-weak)}
.tb3w-root .ask-group__question{margin-bottom:8px;font-size:12.5px;font-weight:600}
.tb3w-root .ask-group__options{display:flex;flex-direction:column;gap:4px}
.tb3w-root .ask-option{display:flex;align-items:flex-start;gap:7px;width:100%;padding:6px 9px;border:1px solid var(--border);border-radius:7px;background:var(--bg-card);color:var(--text);font-family:inherit;font-size:12.5px;text-align:left;cursor:pointer;transition:border-color .12s,background .12s}
.tb3w-root .ask-option:hover{border-color:#93c5fd;background:#f8fbff}
/* 只读的选项是 div —— 不给指针、不给 hover */
.tb3w-root div.ask-option{cursor:default}
.tb3w-root div.ask-option:hover{border-color:var(--border);background:var(--bg-card)}
/* 已选：accent 描边 + 淡蓝底 + 勾 */
.tb3w-root .ask-option.is-picked{border-color:var(--accent);background:#eff6ff}
.tb3w-root div.ask-option.is-picked:hover{border-color:var(--accent);background:#eff6ff}
/* 勾的位置固定占宽 ⇒ 未选中的文字不会左右跳 */
.tb3w-root .ask-option__mark{flex:0 0 12px;color:var(--accent);font-weight:700;line-height:1.5}
.tb3w-root .ask-option__body{display:flex;flex:1 1 auto;flex-direction:column;gap:1px;min-width:0}
.tb3w-root .ask-option__label{font-weight:500}
.tb3w-root .ask-option__desc{font-size:11px;line-height:1.6;color:var(--text-secondary)}
/* 三态徽标：未选择灰 / 都不要橙 / 已选绿 */
.tb3w-root .ask-group__state{display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin-top:8px;font-size:10.5px;color:var(--text-weak)}
.tb3w-root .ask-group__state-text{padding:0 6px;border-radius:4px;background:#f1f3f6;font-family:var(--font-mono)}
.tb3w-root .ask-group__state[data-ask-state-label='unset'] .ask-group__state-text{color:#6b7280}
.tb3w-root .ask-group__state[data-ask-state-label='none'] .ask-group__state-text{color:#b45309;background:#fef3c7}
.tb3w-root .ask-group__state[data-ask-state-label='picked'] .ask-group__state-text{color:#047857;background:#d1fae5}
/* ── 选项标记：单选圆圈 / 多选方框 / 冻结勾（用户 2026-11-21） ── */
.tb3w-root .ask-option__mark--box{flex:0 0 14px;width:14px;height:14px;box-sizing:border-box;border:1.5px solid var(--border-strong,#c5ccd6);border-radius:50%;background:#fff;margin-top:2px}
.tb3w-root .ask-option__mark--box[data-multi='true']{border-radius:3px}
.tb3w-root .ask-option.is-picked .ask-option__mark--box{position:relative;border-color:var(--accent);background:#fff}
.tb3w-root .ask-option.is-picked .ask-option__mark--box::after{content:"";position:absolute;inset:3px;border-radius:50%;background:var(--accent)}
.tb3w-root .ask-option.is-picked .ask-option__mark--box[data-multi='true']::after{border-radius:1px}

.tb3w-root .ask-option__mark--check{flex:0 0 14px;width:14px;color:var(--accent);font-weight:700;text-align:center;line-height:14px}
/* ── 问题行：问题 + 单选/多选标签 + 状态按钮 ── */
.tb3w-root .ask-group__qrow{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.tb3w-root .ask-group__qrow .ask-group__question{margin:0;flex:1 1 auto;min-width:0}
.tb3w-root .ask-group__multitag{flex:0 0 auto;padding:0 5px;border-radius:3px;background:#f3f4f6;color:var(--text-secondary);font-size:10px}
.tb3w-root .ask-group__state-btn{flex:0 0 auto;padding:1px 8px;font-size:10.5px}
.tb3w-root .ask-group__state-btn[data-ask-state-btn='none']{border-style:dashed;color:#b45309}
.tb3w-root .ask-group__state-btn[data-ask-state-btn='picked']{color:#047857}
/* ── 「激活」的题目：左边竖边框 ── */
.tb3w-root .ask-group[data-ask-active='true']{box-shadow:inset 3px 0 0 var(--accent)}
/* 冻结态：不给整页打边框，只给**选中的选项**打左边框 */
.tb3w-root .ask-option.is-picked{box-shadow:inset 3px 0 0 var(--accent)}
/* ── 自填行：圆圈 + 文本框 ── */
.tb3w-root .ask-option--custom{cursor:default;align-items:center}
.tb3w-root .ask-option--custom .ask-group__custom{flex:1 1 auto;min-width:0;padding:4px 8px;border:1px dashed var(--border-strong,#c5ccd6);border-radius:5px;background:#fafbfc;font:12px/1.5 inherit;color:var(--text)}
.tb3w-root .ask-group__custom-values{font-size:10.5px;color:var(--text-secondary)}
/* 「都不要」+ 自填 */
.tb3w-root .ask-group__actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-top:9px;padding-top:9px;border-top:1px dashed #f0f2f6}
.tb3w-root .ask-group__custom{flex:1 1 200px;min-width:120px;padding:4px 9px;border:1px solid var(--border);border-radius:6px;background:var(--bg-card);color:var(--text);font-family:inherit;font-size:12px}
.tb3w-root .ask-group__custom:focus{outline:none;border-color:var(--accent)}

/* ══════════════════════════════════════════════════════════
   未知 $type / 脏数据（降级成可展开的原始 JSON）
   ══════════════════════════════════════════════════════════ */
.tb3w-root .section-block__unknown{display:flex;flex-direction:column;align-items:flex-start;gap:8px}
.tb3w-root .payload-box{width:100%;max-height:260px;margin:0;padding:9px 11px;overflow:auto;border:1px solid var(--border);border-radius:6px;background:#f6f7f9;font-family:var(--font-mono);font-size:10.5px;line-height:1.7;white-space:pre-wrap;word-break:break-word;cursor:text}
`;

/* 科技树的 CSS 单独放在 pure/techtree-css.ts —— 组件和本文件共用同一份真值（曾复制两份，无自动检查会红）。 */
import { TECHTREE_CSS } from './pure/techtree-css.ts';

export { TECHTREE_CSS };

/**
 * 全部类名 —— **单一来源**。
 *
 * 组件里只用 `CLS.xxx`，不写字面量。写错类名的后果是样式静默失效
 * （不是报错），所以这里集中一处，改名字只需改这里 + CSS。
 */
export const CLS = {
	board: 'tb3-board',
	topbar: 'tb3-topbar',
	select: 'tb3-select',
	btn: 'tb3-btn',
	error: 'tb3-error',
	errorText: 'tb3-error-text',
	body: 'tb3-body',
	list: 'tb3-list',
	detail: 'tb3-detail',
	row: 'tb3-row',
	rowSelected: 'tb3-row-selected',
	rowId: 'tb3-row-id',
	rowTitle: 'tb3-row-title',
	rowTitleDone: 'tb3-row-title-done',
	badge: 'tb3-badge',
	badgeActive: 'tb3-badge-active',
	badgeShelved: 'tb3-badge-shelved',
	badgeEnded: 'tb3-badge-ended',
	detailHead: 'tb3-detail-head',
	detailTitle: 'tb3-detail-title',
	meta: 'tb3-meta',
	section: 'tb3-section',
	sectionLabel: 'tb3-section-label',
	sectionBody: 'tb3-section-body',
	note: 'tb3-note',
	menuWrap: 'tb3-menu-wrap',
	menu: 'tb3-menu',
	menuItem: 'tb3-menu-item',
	menuEmpty: 'tb3-menu-empty',
	empty: 'tb3-empty',
} as const;

/**
 * 全部样式。
 *
 * ⚠ 这是唯一一处写样式的地方。组件里只用类名字符串。
 */
export const STYLES = `
.tb3-board {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  font-size: var(--dsh-content-font-size, 14px);
  color: var(--dsw-alias-text-primary);
  container-type: inline-size;
}

.tb3-topbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  flex: none;
  border-bottom: 1px solid var(--dsw-alias-border-subtle);
}

.tb3-select {
  flex: 1;
  min-width: 0;
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-subtle);
  background: var(--dsw-alias-bg-raised);
  color: var(--dsw-alias-text-primary);
  font: inherit;
}

.tb3-btn {
  flex: none;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-subtle);
  background: transparent;
  color: var(--dsw-alias-text-secondary);
  font: inherit;
  cursor: pointer;
  white-space: nowrap;
}

.tb3-btn:hover:not(:disabled) {
  background: var(--dsw-alias-bg-hover);
  color: var(--dsw-alias-text-primary);
}

.tb3-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.tb3-error {
  margin: 8px 12px 0;
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-subtle);
  background: var(--dsw-alias-bg-raised);
  color: var(--dsw-alias-text-primary);
  font-size: 0.9em;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  flex: none;
}

.tb3-error-text {
  flex: 1;
  min-width: 0;
  word-break: break-word;
}

.tb3-body {
  flex: 1;
  min-height: 0;
  display: flex;
}

.tb3-list {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 8px;
}

.tb3-detail {
  flex: 1.2;
  min-width: 0;
  overflow-y: auto;
  padding: 12px;
  border-left: 1px solid var(--dsw-alias-border-subtle);
}

@container (max-width: 560px) {
  .tb3-body {
    flex-direction: column;
  }
  .tb3-detail {
    border-left: none;
    border-top: 1px solid var(--dsw-alias-border-subtle);
  }
}

.tb3-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  padding: 8px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.tb3-row:hover {
  background: var(--dsw-alias-bg-hover);
}

.tb3-row-selected {
  border-color: var(--dsw-alias-border-subtle);
  background: var(--dsw-alias-bg-hover);
}

.tb3-row-id {
  flex: none;
  font-family: var(--dsh-code-font-family, monospace);
  font-size: 0.85em;
  color: var(--dsw-alias-text-tertiary);
  min-width: 4em;
}

.tb3-row-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tb3-row-title-done {
  text-decoration: line-through;
  opacity: 0.7;
}

.tb3-badge {
  flex: none;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 0.8em;
  line-height: 1.6;
  border: 1px solid var(--dsw-alias-border-subtle);
  background: var(--dsw-alias-bg-raised);
  color: var(--dsw-alias-text-secondary);
  white-space: nowrap;
}

.tb3-badge-active {
  background: var(--dsw-alias-bg-hover);
  color: var(--dsw-alias-text-primary);
}

.tb3-badge-shelved {
  border-style: dashed;
  color: var(--dsw-alias-text-primary);
}

.tb3-badge-ended {
  opacity: 0.65;
}

.tb3-detail-head {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 4px;
}

.tb3-detail-title {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: 1.05em;
  font-weight: 600;
  word-break: break-word;
}

.tb3-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  font-size: 0.85em;
  color: var(--dsw-alias-text-tertiary);
}

.tb3-section {
  margin-bottom: 12px;
}

.tb3-section-label {
  font-size: 0.85em;
  color: var(--dsw-alias-text-tertiary);
  margin-bottom: 4px;
}

.tb3-section-body {
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--dsw-alias-bg-raised);
  white-space: pre-wrap;
  word-break: break-word;
}

.tb3-note {
  font-size: 0.9em;
  color: var(--dsw-alias-text-secondary);
  white-space: pre-wrap;
}

.tb3-menu-wrap {
  position: relative;
  flex: none;
}

.tb3-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 20;
  min-width: 8em;
  padding: 4px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-subtle);
  background: var(--dsw-alias-bg-raised);
  box-shadow: 0 4px 16px rgb(0 0 0 / 20%);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tb3-menu-item {
  padding: 5px 10px;
  border-radius: 5px;
  border: none;
  background: transparent;
  color: var(--dsw-alias-text-primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
  white-space: nowrap;
}

.tb3-menu-item:hover:not(:disabled) {
  background: var(--dsw-alias-bg-hover);
}

.tb3-menu-item:disabled {
  opacity: 0.5;
  cursor: default;
}

.tb3-menu-empty {
  padding: 5px 10px;
  color: var(--dsw-alias-text-tertiary);
  white-space: nowrap;
}

.tb3-empty {
  padding: 24px 12px;
  text-align: center;
  color: var(--dsw-alias-text-tertiary);
  font-size: 0.9em;
}
`;

/**
 * 把样式插进文档（幂等）。
 *
 * ## 为什么不用 `ctx.effect` 管理
 *
 * 样式是**全局的、幂等的**：插一次就够，卸载时移除会让"另一个标签页
 * 还在用"的情况白屏。所以故意不做清理 —— 一个 `<style>` 元素的开销
 * 可以忽略，而漏删比多留危险得多。
 */
export function injectStyles(): void {
	if (typeof document === 'undefined') return;
	if (document.getElementById(STYLE_ID) !== null) return;
	const element = document.createElement('style');
	element.id = STYLE_ID;
	/*
	/*
	 * ⚠ 七段都注入：
	 *   STYLES         旧面板内的（tb3-*）
	 *   CREATE_CSS     全屏建卡页（tb3cc-*）
	 *   WORKSPACE_CSS  V3 工作区（tb3w-* + 六个定稿组件）
	 *   SECTION_CSS    章节渲染（.section-block / .md / .ask-* / .payload-box）
	 *   SEARCHBOX_CSS  工作区尾部搜索框（.search-box）
	 *   DRAWER_CSS     V5 抽屉（tb3d-*：输入框上方展开 + 抽屉作用域下的纵向压缩）
	 *   TECHTREE_CSS   科技树（tb3t-*，来自 pure/techtree-css.ts）
	 *   合成一个 style 标签而不是七个 —— 少六个 DOM 节点，去重逻辑只需要管一个 id。
	 *
	 * ⚠ 顺序有约束：TECHTREE_CSS 放最后。它里面 .tb3t-card .card-id /
	 *   .tb3t-card .badge 与 WORKSPACE_CSS 的 .tb3w-root .card-id /
	 *   .tb3w-root .badge **特异度相同** ⇒ 靠「后写赢」把卡片内的尺寸收到
	 *   科技树自己的规格（颜色仍是 WORKSPACE_CSS 那一份真值）。
	 */
	element.textContent = `${STYLES}\n${CREATE_CSS}\n${WORKSPACE_CSS}\n${SECTION_CSS}\n${SEARCHBOX_CSS}\n${DRAWER_CSS}\n${TECHTREE_CSS}`;
	document.head.appendChild(element);
}
