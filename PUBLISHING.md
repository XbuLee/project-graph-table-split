# GitHub 发布与扩展市场收录

依据作者的[扩展市场文档](https://graphif.dev/docs/extension/distribution/marketplace)整理，核对日期：2026-11-06。

## 官方收录条件

1. GitHub 仓库必须开源且为 **Public**。
2. 仓库必须添加 **`extprg` Topic**。package.json 的 keywords 不能替代 GitHub Topic。
3. 默认分支根目录必须有合规的 `metadata.msgpack`，或由 `create-extprg` 生成的 `package.json`。
4. 至少一个公开 Release，附件包含 `.prg` 文件。

本项目采用文档支持的直接开发格式，以根目录 `metadata.msgpack` 满足第 3 条，不将自写 package.json 冒充 create-extprg 生成的工程。官方文档更推荐 extprg 工具链，但市场收录规则也接受直接开发格式。

## 首次发布

计划仓库名：`project-graph-table-split`，作者：`XbuLee`。发布时以实际创建的仓库地址为准。

1. 将**本目录的内容**放到独立仓库根目录。不要把整个 Project Graph 工程上传，也不要多套一层 table-split 目录。
2. 检查 `metadata.json` 和 `package.json` 的名称、描述、作者及版本一致。扩展 ID 保持为 `local.table-split`，避免已安装用户变成两个扩展。
3. 执行 `npm ci`、`npm run check`、`npm test`、`npm run package`，提交生成的根目录 `metadata.msgpack`。
4. 在官方程序中新建临时工程，安装 `.prg` 后完成：Tab 示例、自定义分隔符、取消、空单元格、长文字换行、撤销/重做、保存及重开检查。按实际结果更新 README 的验证状态。
5. 创建 Public 仓库，在 About / Topics 中添加 `extprg`。默认分支应包含源码、README、LICENSE、package-lock.json、metadata.json 和 metadata.msgpack。
6. 推送默认分支，再推送与 package.json 一致的版本标签，例如 `v1.1.0`。
7. 仓库内的 Release 工作流会再次检查和打包，并创建 Release，附上 `local.table-split.prg`。

如果关闭 GitHub Actions，也可手动创建同版本 Release 并上传这个 `.prg` 文件。

文档说明服务器会定期扫描符合条件的仓库，提交后至少等待 5 分钟。满足文件条件不等于已确认收录；以市场实际显示为准。

## 后续版本

同步修改 package.json 和 metadata.json 的版本，更新 CHANGELOG，再打包并提交根目录 metadata.msgpack。推送对应版本标签后，Release 工作流会生成新的安装包。

工作流只在推送 `v*` 标签时发布；普通提交和 Pull Request 只做验证。

## 当前状态

本地代码、独立依赖、元数据和发布工作流已准备。尚未创建 GitHub 仓库、设置 Topic、发布 Release 或确认市场收录；官方应用人工验收尚待完成。
