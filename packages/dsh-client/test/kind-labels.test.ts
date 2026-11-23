/*
 * 类别显示名 —— core 的注册表投影成「G 目标」。
 *
 * 用户 2026-11-24：「模板分类那里要用中文的。并且中文前面要有一个大写的G。」
 *
 * ⚠ 重点不在「正常路径」（那是 core 的数据），而在**降级**：
 *   老服务端没有 `kinds`、第三方注册的类别字段不全、displayName 是空串 ——
 *   这些情况下**不许编中文、也不许显示成「G 」**。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { kindLabelsOf, type KindLabelSource } from '../src/pure/kind-labels.ts';

/** core 内置的四个类别（`packages/core/src/template/kinds.ts` 的 BUILTIN_KINDS）。 */
const BUILTIN: readonly KindLabelSource[] = Object.freeze([
	{ id: 'goal', displayName: '目标', letter: 'G' },
	{ id: 'design', displayName: '设计', letter: 'D' },
	{ id: 'work', displayName: '工作', letter: 'W' },
	{ id: 'record', displayName: '记录', letter: 'R' },
]);

describe('kindLabelsOf：正常路径（core 内置四类）', () => {
	const labels = kindLabelsOf(BUILTIN);

	it('徽标是「字母 + 空格 + 中文」', () => {
		assert.equal(labels.badgeOf('goal'), 'G 目标');
		assert.equal(labels.badgeOf('design'), 'D 设计');
		assert.equal(labels.badgeOf('work'), 'W 工作');
		assert.equal(labels.badgeOf('record'), 'R 记录');
	});

	it('中文名与字母分开取（模板选择器「类别」列两段显示）', () => {
		assert.equal(labels.labelOf('goal'), '目标');
		assert.equal(labels.letterOf('goal'), 'G');
	});

	it('空 kind（空模板）⇒ 徽标是空串，不画', () => {
		assert.equal(labels.badgeOf(''), '');
	});
});

describe('kindLabelsOf：降级（不许编中文、不许显示「G 」）', () => {
	const labels = kindLabelsOf([
		{ id: 'goal', displayName: '', letter: 'G' },
		{ id: 'design', displayName: '   ', letter: 'D' },
		{ id: 'work', displayName: '工作', letter: 'w' },
		{ id: 'record', displayName: '记录', letter: 'RR' },
	]);

	it('★ 破坏性验证：displayName 空串 ⇒ 降级成英文 id，不是「G 」', () => {
		assert.equal(labels.labelOf('goal'), 'goal');
		assert.equal(labels.badgeOf('goal'), 'G goal');
		assert.notEqual(labels.badgeOf('goal'), 'G ');
	});

	it('displayName 全空格 ⇒ 同样降级（trim 之后按空串处理）', () => {
		assert.equal(labels.badgeOf('design'), 'D design');
	});

	it('字母非法（小写 / 多字符）⇒ 降级成 id 首字母大写', () => {
		assert.equal(labels.letterOf('work'), 'W');
		assert.equal(labels.letterOf('record'), 'R');
	});

	it('注册表里没有的类别 ⇒ 全降级（id 原文 + 首字母）', () => {
		assert.equal(labels.labelOf('milestone'), 'milestone');
		assert.equal(labels.letterOf('milestone'), 'M');
		assert.equal(labels.badgeOf('milestone'), 'M milestone');
	});
});

describe('kindLabelsOf：注册表本身异常', () => {
	it('空注册表 ⇒ 全部降级（老服务端没有 kinds 字段）', () => {
		const labels = kindLabelsOf([]);
		assert.equal(labels.badgeOf('goal'), 'G goal');
	});

	it('重复 id ⇒ 先注册的赢（后一个当脏数据丢掉）', () => {
		const labels = kindLabelsOf([
			{ id: 'goal', displayName: '目标', letter: 'G' },
			{ id: 'goal', displayName: '错误', letter: 'X' },
		]);
		assert.equal(labels.badgeOf('goal'), 'G 目标');
	});

	it('空 id 的条目被忽略（不能占住 Map 的空键）', () => {
		const labels = kindLabelsOf([
			{ id: '', displayName: '空', letter: 'E' },
			{ id: 'goal', displayName: '目标', letter: 'G' },
		]);
		assert.equal(labels.badgeOf('goal'), 'G 目标');
		assert.equal(labels.badgeOf(''), '');
	});
});
