# Changelog (file-master)

See root `CHANGELOG.md` for full ecosystem release notes.

## [0.2.5] - 2026-10-30
- Reworked the Obsidian settings navigation and About page around native setting rows, consistent typography, and bilingual copy.
- Improved the remote asset gallery, preview actions, and language changes when following Obsidian.
- Raised the minimum compatible server version to `0.1.4`; the initial `0.1.0` server did not expose the required version endpoint.

## [0.2.0] - 2026-10-29
- Added **🖼️ Remote Asset Gallery & Media Album (远端图床媒体相册与资产库)**: Browse, filter by date/type, search, preview (Lightbox), copy Raw/WebP/Markdown links, and 1-click insert into active note at cursor.
- Added **📌 Persistent Remote Gallery Sidebar View (侧边栏常驻媒体画廊)**: Native Obsidian `ItemView` docked in right sidebar for continuous browsing and writing.
- Added **🔗 Vault Link Health Check (404 & Dangling Links)** wizard and report export.
- Added **🏆 Vault Wrapped & Storage Analytics Dashboard** and report export.
- Added **Real-time Scan Progress Bar & Cancel Button** across vault governance wizards.
- Added **In-Modal Result UX & Instant Deduplication**: Probe-first zero-payload upload notification and in-modal copyable URLs.
- Added **Remote Server Verification Gating**: Hide remote menus and commands when remote server is disabled or unverified.
- Added **Active Note Header Menu & Actions**: Migrate local attachments to cloud, download remote attachments back to local vault, and copy note with public WebP links.
- Added **Bilingual UI Switch (`简体中文` / `English`)** in plugin settings with automatic Obsidian language detection.
- Modularized plugin source code under `src/` with automated build (`npm run build`) and unit test suite (`npm test`).
