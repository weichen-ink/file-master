# 📦 FileMaster

[![Obsidian Plugin](https://img.shields.io/badge/Obsidian-Plugin-7C3AED?logo=obsidian&logoColor=white)](https://obsidian.md)
[![Platform](https://img.shields.io/badge/Platform-Desktop%20%7C%20Mobile-blue?logo=obsidian)](https://obsidian.md)
[![Release](https://img.shields.io/github/v/release/weichen-ink/file-master?color=22c55e)](https://github.com/weichen-ink/file-master/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/Tests-Passing-success)](tests/)

> **Enterprise-grade Obsidian asset governance & self-hosted image hosting hub.**  
> *Desktop & Mobile (iOS / Android) · Zero Broken Links · SHA-256 Instant Upload · Canvas & Excalidraw Ready*

[English](#english) | [简体中文](#简体中文)

---

<a name="english"></a>
## 🌟 Why FileMaster?

Obsidian vaults grow heavy over time with duplicate screenshots, unreferenced orphan attachments, and broken links.

**FileMaster** bridges your local Obsidian vault with a self-hosted media server ([FileMaster Server](https://github.com/weichen-ink/file-master-server)). It keeps your notes lightweight, eliminates redundancy with SHA-256 deduplication, and lets you manage cloud assets without leaving Obsidian.

---

## ✨ Key Features

- 📱 **Desktop & Mobile Ready**:
  Fully decoupled from Node.js runtime. Runs seamlessly across **macOS, Windows, Linux, iOS, iPadOS, and Android**.

- ⚡ **Instant Upload & Clipboard Monitor (秒传)**:
  Paste screenshots or drag attachments into your notes. FileMaster checks the content SHA-256 via a lightweight probe query and reuses existing cloud assets instantly without re-uploading file bytes.

- 🎨 **Markdown, Canvas & Excalidraw Compatible**:
  First-class citizen support for standard notes, `.canvas` whiteboards, and Excalidraw drawings (`## Embedded Files`). Engineered to safely preserve drawing embed structures.

- 🛡️ **Robust Link Safety Gate**:
  Every migration and deduplication action follows a strict 2-phase workflow:
  1. Rewrites all backlinks across notes, Canvas, and Excalidraw files.
  2. Runs a **Safety Gate snapshot verification** before any local file can be removed. Lingering references halt deletion automatically.

- 🖼️ **Remote Asset Gallery**:
  Browse and search your cloud media directly within Obsidian via a dedicated sidebar tab or popup dialog. Insert assets into your active note in 1 click.

- 🧹 **Vault Cleanup Suite**:
  - **Duplicate Finder**: Identifies duplicate files across local vault and cloud storage by content hash and merges them safely.
  - **Orphan Cleaner**: Detects unreferenced media and orphan notes with thumbnail previews (including HEIC/HEIF/TIFF support).
  - **Link Health Inspector**: Scans dangling WikiLinks and broken remote 404 links with 1-click line jump and Markdown reports.

- 🌐 **Dual-Track Delivery & Watermarking**:
  Keeps lossless original assets in Obsidian while optionally serving optimized, contrast-adaptive watermarked WebP links (`/pub/*.webp`) for blog publishing (e.g. Astro).

---

## 💡 Typical Workflows

1. **Everyday Writing**:
   Press `Ctrl/Cmd + V` to paste screenshots into your note. FileMaster prompts or auto-saves to your preferred location (Local Vault or Cloud Server) with custom naming patterns like `{note}_{date}_{rand:4}`.

2. **Vault Spring Cleaning**:
   Click the ribbon Hub icon (or run `FileMaster: Open Central Governance Hub`) to inspect link health, purge unused orphan files, or consolidate duplicated images across your vault.

3. **Blog / Public Sharing**:
   Right-click any note editor → select **Copy public note with WebP links** to get blog-ready content with dynamic watermarks copied directly to your clipboard.

---

## 🚀 Installation

### Option 1: Via BRAT (Recommended for Beta & Immediate Updates)
1. Install **BRAT** from Obsidian Community Plugins.
2. In Obsidian command palette (`Cmd/Ctrl + P`), run: `BRAT: Add a beta plugin for testing`.
3. Enter repository URL: `https://github.com/weichen-ink/file-master`.
4. Enable **FileMaster** under **Settings → Community Plugins**.

### Option 2: Manual Installation
1. Download `main.js`, `manifest.json`, and `styles.css` from [Latest Release](https://github.com/weichen-ink/file-master/releases).
2. Create folder in your vault: `<Vault>/.obsidian/plugins/file-master/`.
3. Copy the 3 downloaded files into that folder and restart Obsidian.

---

## ⚙️ Quick Configuration

FileMaster `1.0.5` requires FileMaster Server `1.0.0` or newer.

1. Open **Settings → FileMaster**.
2. **Server Access URL**: Enter your self-hosted server address (e.g. `http://192.168.1.100:3000` or `https://img.yourdomain.com`).
3. **Global API Token**: Enter the `api_token` configured in your server.
4. Click **⚡ Test Connection** to verify bidirectional version contract and connectivity.

| Setting | Default | Description |
| :--- | :--- | :--- |
| **Interface Language** | `Follow Obsidian (Auto)` | Auto-detects Obsidian language, or choose `简体中文` / `English` |
| **Show Sidebar Ribbon Button** | `true` | Left sidebar icon for 1-click quick hub access |
| **Attachment Destination** | `Prompt each time` | `Prompt each time`, `Auto-upload to cloud`, or `Save to local vault` |
| **Default Destination Target** | `Auto-upload to cloud` | Default preselected destination card in attachment insert modal (`Cloud` or `Local Vault`) |
| **Naming Strategy** | `Keep original` | Strategy for incoming attachments: `Keep original`, `Auto-rename pattern`, or `Prompt each time` |
| **Auto-Rename Pattern** | `{note}_{date}_{rand:4}` | Rule for naming attachments (`{note}`, `{date}`, `{time}`, `{rand:4}`, `{hash:8}`) |
| **Handle Non-Image Attachments** | `true` | Enables local saving and cloud migration for audio, video, and PDF attachments |
| **Delete Local After Migrate** | `true` | Safely removes local file once cloud migration and zero-broken-link check succeed |
| **Excluded Local Folders** | `templates, assets/protected` | Comma-separated paths skipped during orphan/dedup scans |

---

## 🗺️ Roadmap

- [x] **Mobile Ready**: Native support for iOS, iPadOS, and Android.
- [x] **Excalidraw & Canvas Integration**: Safe reference rewriting across visual canvases.
- [x] **Dual-Contrast Adaptive Watermark**: Intelligent light/dark watermark switching.
- [ ] **S3 / Cloud Storage Support**: Optional direct integration with Cloudflare R2, MinIO, and AWS S3.
- [ ] **Local Vault Image Compression**: Lossless/lossy WebP optimization directly within local vault.
- [ ] **Visual Media Timeline**: Interactive timeline & calendar view for vault media.

---

<a name="简体中文"></a>
## 🇨🇳 简体中文介绍

随着知识库日渐庞大，大量的截图附件、未清理的游离素材和重复图片会让库越来越臃肿，甚至出现 404 断链。

**FileMaster** 是一款专为 Obsidian 打造的全平台资产治理与自建多媒体图床管理插件，配合自建后端 [FileMaster Server](https://github.com/weichen-ink/file-master-server)，让你的知识库始终轻盈整洁。

### ✨ 核心亮点

* 📱 **全平台原生支持**：不依赖任何 Node.js 运行时，在 **Mac、Windows、Linux、iOS、iPadOS 和 Android** 上均可流畅运行。
* ⚡ **SHA-256 秒传复用**：粘贴或拖入附件时，本地哈希轻量预检；云端已有相同时直接复用，免去重复上传文件体。
* 🎨 **深度兼容 Canvas 与 Excalidraw**：除标准 Markdown 外，支持 Obsidian 白板与 Excalidraw 手绘图（`## Embedded Files`）链接双向重写，保护手绘图内嵌数据结构。
* 🛡️ **断链防御安全闸门**：“双阶段重写 + 快照安全闸门”，任何引用残留都会自动拦截删除，有效预防 404 断链。
* 🖼️ **云端资产侧边栏图库**：拥有专属侧边栏视图与弹出图库，直观翻阅云端素材，一键插图到光标处。
* 🧹 **资产治理三件套**：
  * **内容哈希查重**：跨本地库与云端深度查重，一键合并多份冗余并重定向双链。
  * **孤儿素材清理**：扫描未被引用的图片、音视频、PDF，提供缩略图预览与安全回收。
  * **404 断链体检**：秒级排查悬空 WikiLink 与失效外链，支持一键行定位并导出 Markdown 报告。
* 🌐 **双轨分发与自适应水印**：库内保持高清原图，外部公开发布支持按背景明暗自动适配的 WebP 动态水印。

### 💡 典型使用场景

1. **日常写作无感上云**：在笔记中按 `Ctrl/Cmd + V` 粘贴截图，支持每次弹窗选择保存到本地/云端，或根据模板（如 `{note}_{date}_{rand:4}`）自动重命名。
2. **仓库定期大扫除**：点击侧边栏 Hub 图标，一键运行“断链体检”排查失效引用，或运行“孤儿清理”释放存储空间。
3. **博客一键外发**：在笔记右键菜单选择“复制公开 WebP 笔记内容”，自动将本地素材替换为带自适应水印的公网 WebP 链接，直接粘贴即可发布。

---

### 📄 许可证
[MIT License](LICENSE)
