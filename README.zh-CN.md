# File Master

在 Obsidian 中管理附件，让本地文件和自己的文件服务器配合使用。

**简体中文** · [English](README.md) · [服务端](https://github.com/weichen-ink/file-master-server)

## 功能

- **处理附件**：粘贴或拖入文件，保存到本地或上传服务器。
- **管理当前笔记**：上传或下载附件，自动更新链接；复制含 WebP 图片链接的笔记全文。
- **整理仓库**：批量上传、检查失效链接，查找重复和未引用文件。
- **浏览服务器文件**：预览图片、复制链接、插入笔记，也可在桌面侧栏中浏览。
- **回收站**：恢复误删的服务器文件，或永久删除不再需要的文件。

支持 Markdown、Canvas 和 Excalidraw，适用于桌面和移动端 Obsidian。界面支持中英文并跟随 Obsidian 主题；本地文件整理无需连接服务器。

## 安装

### 使用 BRAT

1. 在 Obsidian 社区插件中安装并启用 **BRAT**。
2. 使用 BRAT 添加 `https://github.com/weichen-ink/file-master`。
3. 在“设置 → 第三方插件”中启用 **File Master**。

### 手动安装

1. 从 [Releases](https://github.com/weichen-ink/file-master/releases) 下载 `main.js`、`manifest.json` 和 `styles.css`。
2. 放入知识库的 `.obsidian/plugins/file-master/` 目录。
3. 重载 Obsidian，在第三方插件中启用 **File Master**。

## 开始使用

点击左侧工具栏的 File Master 图标，即可使用当前文件、仓库管理和服务器文件等功能。当前笔记操作需要先打开一篇笔记；清理文件前请核对扫描结果并备份。

### 连接自己的服务器（可选）

1. 按[服务端说明](https://github.com/weichen-ink/file-master-server)完成部署。
2. 在插件设置中开启服务器连接，填写站点地址和服务端“站点设置”中的上传 API 令牌。
3. 点击“测试连接”，成功后即可上传和浏览文件。

插件和服务端均需 **1.1 或更新版本**。手机上请使用手机能够访问的服务器地址，不能填写 `localhost`。

[更新记录](CHANGELOG.md) · [问题反馈](https://github.com/weichen-ink/file-master/issues) · [MIT 许可证](LICENSE)
