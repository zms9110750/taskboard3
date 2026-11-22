/**
 * 建卡流程的**外壳**样式 —— 前缀 `.tb3w-create`（`CreateFlow.tsx` 用）。
 *
 * ## 为什么单独一个文件，而不是并进 `create-css.ts`
 *
 * `CREATE_CSS` 的类名前缀是 `tb3cc-`（建卡**页**本身，一整页）；
 * 这个外壳是**工作区作用域**的（`tb3w-`）—— 它替换掉 `<Workspace>` 挂在
 * 产品 tab 里，外面套的 `.tb3w-root` 也是工作区提供的。
 *
 * 两个前缀混在一个常量里会让 `create-layout.test.ts` 的
 * 「全部类名带 tb3cc- 前缀」断言失效 —— 那条断言是对的，
 * 它防止建卡页的类名和面板内的 `tb3-*` 相撞。所以外壳单独放。
 *
 * 同一个形态见 `searchbox-css.ts` / `section-css.ts` / `fallback-css.ts`。
 *
 * ## 为什么需要 flex 那两条
 *
 * `CreateFlow` 把建卡页挂进产品时**整个替换 `<Workspace>`**
 * （用户 2026-11-22：「点击新建以后不是模态框，而是新建要占满视口」）。
 *
 * 它外面套了一层 `.tb3w-root`（拿产品的作用域 + 底色 + 字体），
 * 但 `.tb3w-root` 是 `display:flex;flex-direction:column`
 * ⇒ 里面的 `.tb3cc-page` 作为 flex 子元素默认 `flex:0 1 auto`，**不会被撑满**。
 *
 * ⚠ 必须 `flex:1 1 auto;min-height:0`：只写 `flex:1` 不带 `min-height:0` 时
 *   子元素的 `overflow-y:auto` 不生效（flex 里最常见的坑，
 *   同 `.tb3cc-page__body` 那条）。
 *
 * ⚠ 本文件是模板字符串 —— 注释里**不能出现反引号**（会提前结束字符串）。
 */
export const CREATE_SHELL_CSS = `

/*
 * ── 建卡流程的外壳（.tb3w-create，CreateFlow.tsx）──
 *
 * CreateFlow 把建卡页挂进产品时整个替换 <Workspace>，
 * 所以外壳要撑满 tab，而不是像模态框那样留边。
 */
.tb3w-create{display:flex;flex-direction:column;height:100%;min-height:0}
.tb3w-create > .tb3cc-page{flex:1 1 auto;min-height:0}

/* 横幅（core 拒绝时显示原话）—— 固定在底部，不挤建卡页的可用高度 */
.tb3w-create > [data-create-banner],
.tb3w-create > [data-template-err]{flex:0 0 auto;padding:8px 18px;border-top:1px solid var(--dsw-alias-border-subtle,#e5e7eb);background:#fef2f2;font-size:12px}
`;
