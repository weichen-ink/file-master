# 📦 FileMaster

[![Obsidian Plugin](https://img.shields.io/badge/Obsidian-Plugin-7C3AED?logo=obsidian&logoColor=white)](https://obsidian.md)
[![Release](https://img.shields.io/github/v/release/weichen-ink/file-master?color=blue)](https://github.com/weichen-ink/file-master/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/Tests-Passing-success)](tests/)

> **Enterprise-grade Obsidian asset governance & self-hosted image hosting hub.**  
> *Zero Broken Links Guarantee · SHA-256 Instant Upload (秒传) · Cross-Vault Deduplication · Cloud Migration*

[English](#english) | [简体中文](#简体中文)

---

<a name="english"></a>
## 🌟 Overview

**FileMaster** bridges your local Obsidian vault hygiene with a self-hosted media backend ([FileMaster Server](https://github.com/weichen-ink/file-master-server)). It keeps your vault lightweight, eliminates redundant files, repairs broken links, and uploads attachments with instant SHA-256 deduplication.

---

## ✨ Key Features

- ⚡ **Instant Upload & Clipboard Monitor (秒传)**:
  - Intercepts pasted screenshots and dragged attachments.
  - Computes content SHA-256 locally; reuses existing remote assets in **<5ms with 0 network payload** if already uploaded.
  - Supports custom naming patterns (e.g. `{note}_{date}_{rand:4}`).

- 🛡️ **Zero Broken Links Guarantee**:
  - Every migration and deduplication action follows a strict 2-phase safety workflow:
    1. Rewrites all references across all Markdown notes and Canvas boards.
    2. Runs an automated **Safety Gate snapshot verification** before any file is removed. Lingering references halt deletion automatically.

- 🔗 **Link Health & 404 Inspector**:
  - Scans vault notes and Canvas files for dangling WikiLinks, missing local attachments, broken markdown paths, and dead remote 404 links.
  - Provides 1-click jump-to-line navigation and exports inspection reports to Markdown.

- 🔍 **SHA-256 Duplicate Finder Wizard**:
  - Accurately compares files across local vault and remote server by content hash.
  - Consolidates redundant copies, automatically repoints all backlinks, and safely frees up storage.

- 🧹 **Orphan Attachment Cleaner Wizard**:
  - Scans unreferenced images, audio, video, PDFs, and orphan markdown files.
  - Includes image thumbnail inspection (with HEIC/HEIF/TIFF support) and protection rules.

- ☁️ **Batch Cloud Migration Wizard**:
  - Discovers existing local attachments folder-by-folder and migrates them to your self-hosted server in batches, rewriting all links seamlessly.

- 🖼️ **Dual-Track Delivery & Watermarking**:
  - Keeps lossless original assets in Obsidian while optionally serving optimized, watermarked WebP links (`/pub/*.webp`) for static blog publishing (e.g. Astro).

- 🌐 **Native Bilingual i18n & Context Menus**:
  - Follows Obsidian interface language automatically (`auto` / `zh` / `en`).
  - Dynamic file tree and editor right-click context menus with 1-click migration and deletion protection.

---

## 🚀 Installation

### Option 1: Via BRAT (Recommended for Beta & Immediate Updates)
1. Install the **BRAT** plugin from Obsidian Community Plugins.
2. Open Obsidian command palette (`Cmd/Ctrl + P`) and run:  
   `BRAT: Add a beta plugin for testing`
3. Enter repository URL: `https://github.com/weichen-ink/file-master`
4. Enable **FileMaster** under **Settings → Community Plugins**.

### Option 2: Manual Installation
1. Download `main.js`, `manifest.json`, and `styles.css` from the [Latest Release](https://github.com/weichen-ink/file-master/releases).
2. Create a folder in your vault: `<Vault>/.obsidian/plugins/file-master/`.
3. Copy the 3 downloaded files into that folder.
4. Reload Obsidian and enable **FileMaster** under **Settings → Community Plugins**.

---

## ⚙️ Quick Configuration

FileMaster `1.0.1` requires FileMaster Server `1.0.0` or newer.

1. Open **Settings → FileMaster**.
2. **Server Access URL**: Enter your self-hosted server address (e.g., `http://192.168.1.100:3000` or your reverse-proxy domain `https://img.yourdomain.com`).
3. **Global API Token**: Enter the `api_token` configured in your server.
4. Click **⚡ Test Connection**: The dynamic banner will verify the bidirectional version contract and connectivity in real time.

| Setting | Default | Description |
| :--- | :--- | :--- |
| **Interface Language** | `Follow Obsidian (Auto)` | Auto-detects Obsidian language, or choose `简体中文` / `English` |
| **Show Sidebar Ribbon Button** | `true` | Left sidebar icon for 1-click quick hub access |
| **Attachment Destination** | `Prompt each time` | `Prompt each time`, `Auto-upload to cloud`, or `Save to local vault` |
| **Auto-Rename Pattern** | `{note}_{date}_{rand:4}` | Rule for naming attachments (`{note}`, `{date}`, `{time}`, `{rand:4}`, `{hash:8}`) |
| **Delete Local After Migrate** | `true` | Safely removes local file once cloud migration and zero-broken-link check succeed |
| **Excluded Local Folders** | `templates, assets/protected` | Comma-separated paths skipped during orphan/dedup scans |

---

## 🗺️ Future Roadmap

- [ ] **S3 / Cloud Storage Support**: Optional direct integration with Cloudflare R2, MinIO, and AWS S3.
- [ ] **Local Vault Image Compression**: Lossless/lossy WebP optimization directly within local vault.
- [ ] **Mobile Optimization**: Fine-tuned UX for Obsidian iOS and Android apps.
- [ ] **Vault Asset Gallery & Timeline**: Interactive visual media gallery within Obsidian.
- [ ] **Additional Locales**: Japanese, German, French, and Spanish localization.

---

<a name="简体中文"></a>
## 🇨🇳 简体中文介绍

**FileMaster** 是一款专为 Obsidian 打造的企业级资产治理与自建多媒体图床管理插件。

### ✨ 核心功能
* **⚡ SHA-256 毫秒级秒传**: 粘贴截图或拖入附件时，本地计算哈希预检。云端已有相同文件时 0 流量瞬间秒传复用。
* **🛡️ 零断链安全保障**: 独创“全库引用重写 + 独立快照校验安全闸门”两阶段流程，确保任何文件清理绝对不造成 404 断链。
* **🔗 404 断链与健康体检**: 一键扫描全库悬空 WikiLink、缺失本地附件及失效远程链接，支持一键行跳转与导出 Markdown 报告。
* **🔍 内容哈希查重向导**: 精准识别跨本地与图床的重复素材，合并冗余并自动重写全库双链。
* **🧹 孤儿文件清理向导**: 扫描全库未被任何笔记引用的游离素材，提供缩略图预览与安全删除回收。
* **☁️ 批量本地附件上云**: 按目录一键批量迁移本地图片与附件至自建服务器，全自动无损替换笔记内链接。
* **🖼️ 双轨分发与防删保护**: 本地笔记保持无损原图，外部公开发布支持 WebP 动态水印；重要资产支持锁定防删。

### 📄 许可证
[MIT License](LICENSE)
