# Development / 开发

Run `npm ci`, then `npm test`. Tests rebuild `main.js` first. Commit the generated bundle with source changes. `npm run package` produces the three-file release archive: `main.js`, `manifest.json`, and `styles.css`.

运行 `npm ci` 后使用 `npm test`，测试前会重建 `main.js`，源码和生成产物需要一起提交。`npm run package` 生成包含 `main.js`、`manifest.json`、`styles.css` 的发布包。

## Obsidian simulation

`npm run simulate:obsidian` runs an orphan scan through the wizard's Next button and checks the returned paths. Use `npm run --silent simulate:obsidian` for JSON output from the plugin checkout.

`npm run simulate:obsidian` 会调用孤儿附件扫描向导的「下一步」处理函数，并校验返回的路径。从插件仓库执行 `npm run --silent simulate:obsidian` 可直接取得 JSON 输出。

For a custom reproduction, run this example from the plugin checkout. Each call provides a fresh vault, the plugin instance, and the feature modules used by the tests.

需要复现其他问题时，可从插件仓库运行下面的示例。每次调用都会创建独立的内存知识库，返回插件实例及测试使用的功能模块。

```sh
node <<'NODE'
const assert = require('node:assert/strict');
const { createObsidianSimulation } = require('./dev/obsidian');

async function main() {
  const { plugin, add, scans } = createObsidianSimulation();
  add('assets/used.png', 'sample bytes', true);
  add('assets/unused.png', 'other bytes', true);
  add('note.md', '![[assets/used.png]]');

  const files = await scans.scanUnusedFiles(plugin, {
    scanLocal: true,
    scanRemote: false,
    typeImage: true
  });
  assert.deepEqual(files.map((file) => file.displayPath), ['assets/unused.png']);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
NODE
```

Pass `{ requestUrl }` to supply Obsidian HTTP responses or `{ globals: { host, fetch } }` to override host APIs and browser fetch. The default HTTP handlers reject unexpected calls. Use `contents`, `journal`, and `trashed` on the returned simulation to inspect file edits, recovery records, and trash actions. The simulated UI exposes its element tree and handlers for workflow tests. Use real Obsidian for layout, native input methods, and device behavior.

通过 `{ requestUrl }` 提供模拟的 Obsidian HTTP 响应，通过 `{ globals: { host, fetch } }` 替换宿主 API 或浏览器请求。默认 HTTP 处理器会拒绝意外调用。返回对象的 `contents`、`journal` 和 `trashed` 可用于检查文件修改、恢复记录和回收站操作。界面模拟提供元素树及事件处理函数，布局、原生输入法及设备行为需在真实 Obsidian 中验证。

## Compatibility / 兼容性

Keep `package.json`, the root version entries in `package-lock.json`, `manifest.json`, and `versions.json` in sync. `versions.json` maps plugin releases to the minimum Obsidian version, not the server version. Server compatibility is controlled by `MIN_SERVER_VERSION` and the server's `minPluginVersion` response. Plugin 1.2.9+ requires server 1.2.8+ and vice versa.

同步维护包信息、锁文件、插件清单及 `versions.json`。`versions.json` 对应最低 Obsidian 版本，不是服务端版本；双方兼容要求分别由插件的 `MIN_SERVER_VERSION` 和服务端的 `minPluginVersion` 控制。插件 1.2.9+ 与服务端 1.2.8+ 要求双向同步升级。

Starting with `1.3.0`, increment the minor version for every plugin release and keep the patch version at zero. The sequence is `1.3.0`, `1.4.0`, `1.5.0`, and so on. Use the full three-part version in Obsidian metadata and Git tags. The interface may show the shorter product label, such as `1.3`.

从 `1.3.0` 起，每次发布插件只递增第二位，第三位固定为 `0`，依次使用 `1.3.0`、`1.4.0`、`1.5.0`。Obsidian 发布元数据和 Git 标签使用完整三段版本号。界面可以显示 `1.3` 这样的简写。

## Release checks / 发布检查

- Run `npm test` and `npm run package`; publish the rebuilt assets together.
- Test clipboard upload, batch migration, cancel/retry, previews, and Canvas/Excalidraw links in a test vault on real desktop and mobile Obsidian.
- Verify local files and note references before and after cleanup. Automated host adapters do not replace device testing.
- Keep Chinese and English UI strings and READMEs consistent. See [server storage/recovery guidance](https://github.com/weichen-ink/file-master-server/blob/main/docs/SCALABILITY.md).

发布前运行测试与打包，并在真实桌面、移动端 Obsidian 的测试库中验证上传、批量操作、取消重试、预览和 Canvas/Excalidraw 引用。核对清理前后的文件及链接；自动化宿主不能代替实机。中英文界面与 README 需同步更新。
