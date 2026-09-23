## 这个 PR 做了什么

<!-- 一两句话说明改动内容与动机 -->

## 关联 issue

<!-- 例如：Closes #12 -->

## 如何验证

<!-- 说明你跑了什么、看到了什么 -->

## 检查清单

- [ ] 跑过 `node scripts/selftest.js`，78 项全绿
- [ ] 未提交 `docs/data/raw/`（抓取原始 payload，见 `.gitignore`）
- [ ] 未引入 npm 运行时依赖（保持零依赖）
- [ ] 未引入大模型生成内容（保持零 LLM）
- [ ] 若改数据源/许可 → 已更新 `NOTICE.md` 与 README「数据来源」表
- [ ] 若新增原厂 → 已在 `scripts/vendor-registry.js` 登记
- [ ] 若改目录/命令 → 已更新 README 说明
