# 📦 FileMaster (Obsidian Asset & Image Manager)

> **Version**: v0.1.0  
> **Companion Server**: [FileMaster Server](../file-master-server)  
> **Core Guarantee**: Zero Broken Links Guarantee · Accurate SHA-256 Deduplication · Vault Slimming

**FileMaster** is a self-hosted attachment and image management plugin tailored for Obsidian. It seamlessly bridges local vault hygiene (orphan cleanup wizards, SHA-256 deduplication, zero-broken-link batch migration) with a self-hosted media backend (lossless raw storage, deletion protection locks, on-the-fly WebP watermarking).

---

## ✨ Features

- 📋 **Smart Clipboard & Drag-and-Drop Interceptor**: Paste screenshots or drop attachments into your notes with options to store locally or auto-upload to your self-hosted server. Configurable dynamic naming patterns (e.g., `{note}_{date}_{rand:4}`).
- 🔒 **Zero Broken Links Guarantee**: Built-in 3-stage transactional safety workflow:
  1. Rewrite all references across your entire vault.
  2. Perform secondary verification to confirm zero dangling references remain.
  3. Safely execute local/remote file deletion.
- 🧹 **Orphan Finder Wizard**: Deeply scan both local vault directories and remote storage to find unreferenced attachments. Includes thumbnail previews (with native HEIC conversion) and backlink verification before deletion.
- 🔍 **Duplicate Finder Wizard**: Uses SHA-256 content hashing to identify duplicate files across local and cloud environments. Consolidates redundant copies and automatically repoints all backlinks safely.
- 🚀 **Batch Cloud Migration Wizard**: Discover existing local attachments and migrate them to your remote server in batches, rewriting all Wikilinks to cloud URLs with zero broken links.
- 🛡️ **Protected Locks & Folder Exemptions**: Mark critical files with a deletion lock (`Protected Lock`) or configure excluded directories to ensure important assets are never accidentally pruned.
- 🖼️ **Dual-Track Delivery**: Keep lossless original images inside Obsidian while serving optimized, watermarked WebP images when building static blogs (e.g., Astro).

---

## 🚀 Installation & Setup

### 1. Installation
- **Manual Installation**:
  1. Download `manifest.json`, `main.js`, and `styles.css` from the latest Release.
  2. Place them in your vault at `.obsidian/plugins/file-master/`.
  3. In Obsidian, navigate to **Settings** -> **Community Plugins** and toggle on **FileMaster**.
- **Via BRAT**:
  Add this repository URL in the Obsidian BRAT plugin to install and track updates automatically.

### 2. Connect to FileMaster Server
1. Go to **Settings** -> **FileMaster**.
2. **Server URL**: Enter `http://your-server-ip:3000` (or your reverse-proxied domain).
3. **API Token**: Enter the `api_token` configured in your server's `config.yaml`.
4. Click **⚡ Test Connection** to verify connectivity.

---

## ⚙️ Configuration Options

| Setting | Default | Description |
| :--- | :--- | :--- |
| **Server URL** | `http://localhost:3000` | Hostname and port of your FileMaster Server |
| **API Token** | `filemaster-api-token-888` | Secret key matching `config.yaml` on the server |
| **Save Location Mode** | `ask` | `remote` (always cloud), `local` (always local), or `ask` (prompt per paste) |
| **Naming Pattern** | `{note}_{date}_{rand:4}` | Rule for automatic file renaming |
| **Delete Local After Migrate** | `true` | Safely remove local binary once migration and link rewrite succeed |
| **Excluded Folders** | `templates, assets/protected` | Local directories excluded from orphan scans |

---

## 📄 License

[MIT License](LICENSE)
