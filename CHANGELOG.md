# Changelog (file-master)

See root `CHANGELOG.md` for full ecosystem release notes.

## [1.0.6] - 2026-11-10
- Build explicit ESM sources with esbuild while keeping the single CommonJS Obsidian entry and three release assets.
- Replace plugin inheritance layers with ordinary operation modules and a direct Obsidian Plugin subclass.
- Verify behavior through public test exports and release loading; rebuild and test in release CI.
- Unify note and batch migrations, preserve concurrent note edits, and verify local content and references before deletion.
- Index references once per operation and group upload/download link changes by affected document.
- Retry transient transfer failures; support cancellation, unfinished-item retries, and recovery of the most recent upload after restart.
- Share gallery rendering with 60-item pagination and server-provided thumbnails; verify downloaded bytes before writing.
- Establish the pre-upgrade baseline for the batch reliability and scalability improvements.

## [1.0.3] - 2026-11-08
- Added native **Excalidraw drawing attachments support**:
  - Robust Excalidraw drawing detection across `.excalidraw.md`, `.excalidraw`, and renamed `.md` files.
  - Native hyperlinking syntax in `## Embedded Files`: bare URLs (`fileId: url`) without markdown brackets to prevent parser grey boxes.
  - Full bidirectional link rewriting for local upload, remote download, and duplicate file merges.
  - Active Excalidraw view reload protection to avoid in-memory autosave overwrite.
- Enhanced **Batch Cloud Migration & Active Note Upload UX**:
  - In-modal result persistence: upload completion details remain visible in the modal window with thumbnails, paths, sizes, and copy URL buttons.
  - Root directory report generation: added `exportBatchMigrateReportToRoot` to output `Batch_Migrate_Report_YYYY-MM-DD.md`.
  - Removed duplicate fleeting top-right completion notice.

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
