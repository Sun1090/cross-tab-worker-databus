<!-- 标题格式：<type>: <一句话描述>，如 feat: 支持 topic 通配符订阅 -->

## 变更说明

<!-- 做了什么、为什么。用户可见变更请说明影响面。 -->

## 变更类型

- [ ] feat（新能力）
- [ ] fix（缺陷修复）
- [ ] docs（文档）
- [ ] refactor / chore / test

## 自查清单

- [ ] `pnpm lint && pnpm check` 全绿
- [ ] 新增/变更行为有对应单元测试（含边界分支）
- [ ] 用户可见变更已在 `CHANGELOG.md` 里为它将要发布的那个版本开一节（`## [x.y.z] - 日期`，直接写在本次 PR 里；仓库不再维护 `[Unreleased]` 段，权威流程见 `docs/release-checklist.md`）
- [ ] 中英文档已同步（README / docs/*.md 与 docs/zh/*.md）
- [ ] 涉及协调平面时已跑过 e2e（`pnpm test:e2e`）

## 补充

<!-- 截图、基准数据、设计取舍等。 -->
