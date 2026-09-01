# GitHub 发布清单

## 法务与归属

- [ ] 确认拥有全部源代码、文案、图标和测试数据的发布权。
- [ ] `LICENSE`、`NOTICE`、`THIRD_PARTY_NOTICES.md`、`THIRD_PARTY_LICENSES.txt` 和 `MPL_SOURCE_OFFER.md` 均存在。
- [ ] `pnpm license:check` 通过，第三方组件清单与锁定依赖一致。
- [ ] 确认 Apache-2.0、仓库名称、维护者和 `Knowledge Workbench contributors` 版权信息仍符合发布主体要求。
- [ ] 确认新增图片、图标、字体、文案和测试数据均有明确来源或发布权。

## 数据清理

- [ ] `pnpm release:check` 通过。
- [ ] 仓库中没有 `data/`、`WorkbenchBackups/`、`.env`、附件或数据库文件。
- [ ] 搜索邮箱、手机号、域名、内网地址、用户名、真实品牌名和客户名。
- [ ] 检查图片、PDF、Office 文件和 Git 历史中的元数据。
- [ ] 确认没有把原项目 `.git` 文件或目录带入。

## 质量

- [ ] `pnpm install --frozen-lockfile` 成功。
- [ ] `pnpm lint` 通过。
- [ ] `pnpm test` 通过。
- [ ] 检查 `dist/standalone` 内的项目许可证、第三方许可证和 MPL 源码说明未被删除。
- [ ] 使用全新的临时数据目录完成首次管理员初始化。
- [ ] 验证登录、创建分类、创建文档、上传/下载附件和备份恢复。

## GitHub 设置

- [ ] 在本目录重新初始化 Git，不复用原仓库历史。
- [ ] 首次提交前逐项检查 `git status` 和 `git diff --cached`。
- [ ] 启用分支保护、Dependabot 和 secret scanning（仓库方案支持时）。
- [ ] 设置安全联系渠道和 issue/PR 模板。
- [ ] 首次公开前再次从空目录克隆并按 README 验证。
