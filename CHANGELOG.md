# Changelog (file-master)

## [1.1.8] - 2026-11-13

### Correct pagination with older servers
- Fix file browsers displaying the entire catalog when a running server ignores pagination parameters.
- Normalize full-catalog responses in the shared client: apply search, directory/type filters, and sorting before selecting the requested 20 files.
- Use the same filtering and sorting implementation for local gallery queries and client-side pagination.
- Keep Hub, sidebar, and server-file renaming on the selected page, with correct totals, directory filters, distinct next/previous pages, and the final partial page.
- Preserve native server pagination without slicing pages twice, and keep full-list access for attachment scans.
- Add regression coverage using a 1,024-file response through the actual client and browser handlers.
- Older servers still transfer the full catalog on each request; update the server to enable pagination over the network.

## [1.1.7] - 2026-11-13

### Faster browsing and renaming
- Load the latest 20 images when opening server-file renaming, then request only the selected page.
- Share server pagination between the Hub and sidebar, with search, directory/type filters, and sorting applied across the complete server catalog.
- Put pagination outside the scrolling file list, beside Cancel and Preview changes; wrap the footer on narrow screens.
- Preserve filename drafts when changing pages and offer retry controls when a request fails.
- Find referencing notes during rename preview instead of scanning the vault whenever the file list opens or changes.
- Reuse preview results when applying a rename, checking related notes and notes added or changed since preview. Recover interrupted operations without renaming the server file twice.

### More reliable attachments and links
- Validate the original note, editor, selection, and content before inserting paste/drop uploads or gallery links; preserve edits made while an upload dialog is open.
- Use server-provided original/WebP URLs and the shared link rewriter when copying a note for publishing or copying an image link. Preserve URL parameters and fragments, honor custom prefixes and aliases, and leave unrelated links unchanged.
- Remove hard-coded legacy WebP paths and duplicate editor-insertion logic.
- Correct code-fence handling and remove unsafe metadata-only shortcuts when checking attachment references.
- Share HEIC preview requests and release cached preview resources on eviction or plugin unload.
- Add regression coverage for actual paste/drop and copy entry points, server pagination, rename preview reuse, concurrent note edits, and recovery.
- Validate with 163 passing plugin tests, check wide/narrow layouts in an isolated browser, and rebuild/package the distributed plugin.

## [1.1.6] - 2026-11-13

### A consistent file browser
- Share the same two-row toolbar, filters, sorting, and link preferences between the Hub and sidebar.
- Add multi-select directory trees and file-type filters, with sorting by upload time, size, name, or views in either direction.
- Keep the Hub window height steady while filtering and scroll results within the window.
- Keep card heights consistent in multi-column layouts and let single-column previews follow image proportions.
- Refine list spacing, borders, button colors, dropdown alignment, and narrow-screen controls across light and dark themes.

### Simpler attachment defaults
- Move the default browsing link choice (original or WebP) into settings, removing duplicate browser controls and statistics.
- Remove the redundant "Ask each time" naming option: filenames remain editable before saving in either naming mode.
- Migrate the retired naming option to "Keep filename" and clarify the setting in English and Chinese.
- Remove the image canvas hover tooltip while retaining accessible interaction instructions.

## [1.1.5] - 2026-11-12

### Safer duplicate cleanup
- Recheck both the retained and redundant attachments before updating note links, then verify their contents again before deletion.
- Keep files when their contents change or an ambiguous same-name reference remains; report skipped files instead of removing them.
- Send the expected attachment hash with remote deletion requests so the updated server can reject files changed during cleanup.
- Match complete remote URLs when updating links, preserving queries and avoiding unrelated hosts or longer filenames.

### Defaults and consistency
- Classify Obsidian Bases as notes so default orphan cleanup does not select `.base` files.
- Use `http://localhost:3210` for new installations and empty-address fallbacks, while preserving existing server addresses.
- Share the exact URL rewrite helper between duplicate cleanup and remote renaming.
- Validate with 134 automated tests and rebuild the release bundle.

## [1.1.4] - 2026-11-12

### Remote asset rename & link synchronization
- Add a two-step server rename workflow with editable filename stems, locked extensions, conflict checks, thumbnails, and affected-note previews.
- Rename remote assets and atomically update Markdown, Canvas, and Excalidraw vault links against latest contents.
- Persist pending rename operations in a recovery journal so interrupted or partially completed link updates can resume cleanly.

### Unified references & native hover preview
- Unify attachment and document rows across upload, duplicate, orphan, health, analytics, and rename workflows.
- Count actual reference occurrences, include legacy server aliases, and display consistent reference badges and note actions.
- Add native note hover previews above modal dialogs, with source-line positioning for broken-link results and a clear preview hint in reference dialogs.

### Hub & gallery refinement
- Rename quick panel and its entry points to File Master Hub.
- Refine gallery list and card layouts, left-align names and sizes, and use compact, borderless insert/copy controls.
- Improve preview inspector alignment, link-copy columns, timestamps, property typography, and deletion-protection controls.
- Add bilingual retention notices for old URLs and reminders to update external blog references.

## [1.1.3] - 2026-11-11

### CSS performance optimizations
- Remove `:has` selector from modal chrome rules to eliminate selector invalidation warnings and improve rendering performance.
- Handle empty modal header and title hiding directly via element state and DOM checks.

## [1.1.2] - 2026-11-11

### Obsidian review compliance & styling fixes
- Remove `display: contents` in gallery list view to maintain full compatibility across Obsidian versions.
- Eliminate all `!important` declarations by increasing selector specificity across modal and input components.
- Remove broad universal selector `*` on modal root to prevent broad selector performance warnings.
- Exclude standalone release zip package from GitHub Release assets to adhere strictly to Obsidian release standards (`main.js`, `manifest.json`, `styles.css`).

## [1.1.1] - 2026-11-11

### Vault overview & analytics dashboard
- Restructure top summary into 4 evenly aligned count cards: Notes, Images, Other Attachments, and Total Assets.
- Streamline storage footprint module with clear local vs remote metrics and remove redundant dual-track progress bar.
- Redesign health recommendations with clean transparent background and bold/colored highlights on key metrics.
- Compact attachment filter buttons to 20px pills, remove redundant format badges, enable click-to-copy pure filename, and add WebP hover preview.

### Markdown report generation & audit
- Enhance exported Markdown report readability with section dividers (`---`) and structured whitespace hierarchy.
- Refine Top 20 High-Footprint Attachments table with compact location badges (`💻 本地` / `☁️ 远程`) and non-breaking image embeds (`<img width="80" />` for remote images, escaped `![[path\|80]]` for local images).
- Upgrade all report generators to create unique timestamped snapshots (`*_YYYY-MM-DD_HHmmss.md`) without overwriting previous exports.
- Reinforce exclusion verification to ensure auto-generated reports are excluded from note counts, orphan scans, and duplicate checks.

## [1.1.0] - 2026-11-11

### Hub and navigation
- Present the Hub as File Master, with compact cards grouped into current-file, vault, remote-server, and other actions.
- Remove descriptive card text, clarify action names, and retain the full “Copy current note text with WebP links” action.
- Use one modal framework with the module title and close button on the same row, compact step badges, and footer cancellation or confirmation actions.
- Keep Hub child modules inside the same modal instead of closing and immediately opening another overlay.
- Replace timed close suppression with a shared navigation lifecycle and coalesce sidebar initialization to avoid competing first-open requests.
- Open the server gallery as a modal on mobile while retaining the docked sidebar on desktop.

### Gallery and image preview
- Share gallery state, filtering, sorting, pagination, link generation, and toolbar components between the sidebar and modal.
- Align folder and type filters, view controls, and insertion-format options; simplify file rows by removing dates.
- Make filenames and thumbnails open previews, and keep insertion and copying actions compact and consistently styled.
- Use subdued neutral image-action buttons and a single Obsidian tooltip source instead of overlapping native and host tooltips.
- Adapt image previews to the plugin host with responsive layouts, left-aligned properties, and compact original/WebP link actions.
- Add wheel and pinch zoom, image dragging, fit-to-window controls, and preview lifecycle cleanup.
- Capture the intended note and selection before browsing; reject insertion if the target closes or its content changes unexpectedly.

### Recycle bin and scanning
- Add a server recycle-bin entry to the Hub with file previews, restoration, and confirmed permanent deletion.
- Leave excluded folders empty by default and show exclusion reminders only when folders are configured.
- Hide step indicators for empty attachment and scan-result pages.
- Preserve file-protection and reference checks during cleanup operations.

### Documentation and compatibility
- Simplify settings and provide focused Chinese and English user guides with separate development and release instructions.
- Use 1.1.0 for Obsidian release metadata and tags, while displaying 1.1 in the plugin UI. Require server 1.1 or later and accept two-part versions during the compatibility handshake.
- Keep the Obsidian minimum host version separate from the server compatibility requirement.
- Rebuild main.js and package main.js, manifest.json, and styles.css together.
- Validate with 100 automated tests and simulated-host responsive checks. Actual iOS/Android acceptance testing is not implied by these checks.

## [1.0.7] - 2026-11-10
- Expand incoming attachment modal dialog layout to fill window width naturally without blank right margins.
- Support server v1.0.1 smart resolution-aware and aspect-ratio-adaptive watermarking on 4K, portrait, and mobile screenshot assets.
- Full end-to-end compatibility verification with Apple HEIC/HEIF transcode pipelines.

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
