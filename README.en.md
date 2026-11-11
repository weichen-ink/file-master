# File Master

Manage attachments in Obsidian, with local files and your own file server working together.

[简体中文](README.md) · **English** · [Server](https://github.com/weichen-ink/file-master-server)

## Features

- **Handle attachments**: paste or drop files and save them locally or upload them to your server.
- **Manage the current note**: upload or download attachments and update links automatically; copy the full note with WebP image links.
- **Organize your vault**: batch upload, check broken links, and find duplicate or unreferenced files.
- **Browse server files**: preview images, copy links, and insert files into notes; desktop users can also browse in the sidebar.
- **Recycle bin**: restore accidentally deleted server files or permanently remove items you no longer need.

Supports Markdown, Canvas, and Excalidraw on desktop and mobile Obsidian. The interface supports Chinese and English and follows your Obsidian theme. Local cleanup works without a server.

## Install

### With BRAT

1. Install and enable **BRAT** from Obsidian Community Plugins.
2. Use BRAT to add `https://github.com/weichen-ink/file-master`.
3. Enable **File Master** in Settings → Community Plugins.

### Manually

1. Download `main.js`, `manifest.json`, and `styles.css` from [Releases](https://github.com/weichen-ink/file-master/releases).
2. Place them in your vault's `.obsidian/plugins/file-master/` directory.
3. Reload Obsidian and enable **File Master** in Community Plugins.

## Start using it

Click the File Master ribbon icon to access current-file actions, vault tools, and server files. Open a note before using current-note actions. Review scan results and back up your vault before cleaning up files.

### Connect your own server (optional)

1. Deploy the server using the [server guide](https://github.com/weichen-ink/file-master-server).
2. Enable the server connection in plugin settings. Enter the site URL and upload API token from the server's Site settings.
3. Click Test Connection. Once connected, you can upload and browse files.

Both products must be version **1.1 or later**. On mobile, use a server address reachable from your phone rather than `localhost`.

[Changelog](CHANGELOG.md) · [Report an issue](https://github.com/weichen-ink/file-master/issues) · [MIT license](LICENSE)
