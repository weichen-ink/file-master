# Development / 开发

Run `npm ci`, then `npm test`. Tests rebuild `main.js` first. Commit the generated bundle with source changes. `npm run package` produces the three-file release archive: `main.js`, `manifest.json`, and `styles.css`.

运行 `npm ci` 后使用 `npm test`，测试前会重建 `main.js`，源码和生成产物需要一起提交。`npm run package` 生成包含 `main.js`、`manifest.json`、`styles.css` 的发布包。

## Compatibility / 兼容性

Keep `package.json`, the root version entries in `package-lock.json`, `manifest.json`, and `versions.json` in sync. `versions.json` maps plugin releases to the minimum Obsidian version, not the server version. Server compatibility is controlled by `MIN_SERVER_VERSION` and the server's `minPluginVersion` response. Release 1.1 requires 1.1 on both sides.

同步维护包信息、锁文件、插件清单及 `versions.json`。`versions.json` 对应最低 Obsidian 版本，不是服务端版本；双方兼容要求分别由插件的 `MIN_SERVER_VERSION` 和服务端的 `minPluginVersion` 控制。1.1 版本要求两端均为 1.1 或更新版本。

Obsidian release versions must use three-part semantic versioning, such as `1.1.0`, in metadata and tags. The interface may show the shorter product label `1.1`.

Obsidian 发布元数据和 tag 必须使用 `1.1.0` 这样的三段版本号；界面可以显示简写 `1.1`。

## Release checks / 发布检查

- Run `npm test` and `npm run package`; publish the rebuilt assets together.
- Test clipboard upload, batch migration, cancel/retry, previews, and Canvas/Excalidraw links in a test vault on real desktop and mobile Obsidian.
- Verify local files and note references before and after cleanup. Automated host adapters do not replace device testing.
- Keep Chinese and English UI strings and READMEs consistent. See [server storage/recovery guidance](https://github.com/weichen-ink/file-master-server/blob/main/docs/SCALABILITY.md).

发布前运行测试与打包，并在真实桌面、移动端 Obsidian 的测试库中验证上传、批量操作、取消重试、预览和 Canvas/Excalidraw 引用。核对清理前后的文件及链接；自动化宿主不能代替实机。中英文界面与 README 需同步更新。
