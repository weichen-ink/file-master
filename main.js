const {
  Plugin,
  PluginSettingTab,
  Setting,
  Notice,
  Modal,
  requestUrl
} = require('obsidian');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

// ================= Internationalization (i18n Architecture) =================
const I18N = {
  en: {
    pluginLoaded: '[FileMaster] Plugin loaded successfully',
    confirmActionTitle: 'Confirm Action',
    confirmActionBtn: 'Confirm',
    cancel: 'Cancel',
    close: 'Close',
    back: '⬅ Back',
    next: 'Next',
    all: 'All',
    local: 'Local',
    remote: 'Remote',
    openNote: '↗ Open Note',
    noteNotFound: 'Note not found: {path}',
    clickEnlarge: 'Click thumbnail to enlarge',
    clickDetails: 'Click to view file details',
    savingCancelled: 'Attachment saving cancelled',
    savedToLocal: 'Saved to local vault: {path}',
    saveLocalFailed: 'Failed to save locally: {error}',
    uploadingPlaceholder: '![⏳ Uploading {filename}...]()',
    instantReuse: '⚡ File already exists on server (reused): {filename}',
    uploadedToRemote: '☁️ Uploaded to server: {filename}',
    uploadFailed: '❌ Upload failed: {error}',
    connSuccess: '✅ Connection successful! Server hosts {count} asset(s).',
    connFailed: '❌ Connection failed: {error}',
    step: 'Step {current} of {total}',
    noUnusedFound: '🎉 No unused files found matching your criteria.',
    noDuplicatesFound: '🎉 No duplicate files found in the selected scope.',
    copied: '✅ Copied {label}',
    cleanCompleted: '✅ Cleaned: {local} moved to trash, {remote} deleted from server.'
  }
};
let currentLocale = 'en';

function t(key, vars = {}) {
  const dict = I18N[currentLocale] || I18N.en;
  let str = dict[key] || key;
  for (const [k, v] of Object.entries(vars)) {
    str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
  }
  return str;
}

const DEFAULT_SETTINGS = {
  locale: 'en',
  serverUrl: 'http://localhost:3000',
  apiToken: 'filemaster-api-token-888',
  enableClipboardMonitor: true,
  saveLocationMode: 'ask', // 'remote' | 'local' | 'ask'
  namingMode: 'keep',      // 'keep' (keep original) | 'rule' (auto-rename pattern) | 'prompt' (manual rename modal)
  namingPattern: '{note}_{date}_{rand:4}',
  uploadNonImageAttachments: true,
  deleteLocalAfterMigrate: true,
  excludedLocalFolders: 'templates, assets/protected',
  excludeLockedRemoteFiles: true
};

// Comprehensive image extensions (Apple HEIC/HEIF, TIFF, BMP, Camera RAW, etc.)
const IMAGE_EXTS = new Set([
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'avif',
  'svg',
  'heic',
  'heif',
  'bmp',
  'tif',
  'tiff',
  'ico',
  'jfif',
  'pjpeg',
  'pjp',
  'apng',
  'raw',
  'cr2',
  'nef',
  'arw',
  'dng',
  'orf',
  'rw2'
]);

// Formats requiring JPEG preview transcoding for Electron/Chromium <img> rendering
const NEEDS_TRANSCODE_IMAGE_EXTS = new Set(['heic', 'heif', 'tif', 'tiff']);

// Comprehensive audio extension support
const AUDIO_EXTS = new Set([
  'mp3',
  'm4a',
  'wav',
  'ogg',
  'oga',
  'flac',
  'aac',
  'wma',
  'opus',
  'amr',
  'mid',
  'midi',
  'aiff',
  'aif',
  'ape',
  'alac',
  'm4b',
  'caf'
]);

// Comprehensive video, document, archive, and design asset extensions
const OTHER_EXTS = new Set([
  'pdf',
  'mp4',
  'webm',
  'mov',
  'mkv',
  'avi',
  'flv',
  'wmv',
  'm4v',
  '3gp',
  'mpeg',
  'mpg',
  'ts',
  'mts',
  'm2ts',
  'ogv',
  'rm',
  'rmvb',
  'zip',
  'tar',
  'gz',
  'tgz',
  '7z',
  'rar',
  'bz2',
  'xz',
  'zst',
  'lz4',
  'dmg',
  'iso',
  'pkg',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'csv',
  'tsv',
  'rtf',
  'txt',
  'odt',
  'ods',
  'odp',
  'pages',
  'numbers',
  'key',
  'epub',
  'mobi',
  'azw',
  'azw3',
  'djvu',
  'chm',
  'psd',
  'psb',
  'ai',
  'eps',
  'ind',
  'indd',
  'fig',
  'sketch',
  'xd',
  'cdr',
  'dwg',
  'dxf',
  'stl',
  'obj',
  'fbx',
  'blend',
  'glb',
  'gltf',
  'xmind',
  'mm',
  'drawio',
  'vsdx',
  'json',
  'yaml',
  'yml',
  'xml',
  'toml',
  'ini',
  'conf',
  'log',
  'sql',
  'db',
  'sqlite',
  'sqlite3',
  'ipynb',
  'ics',
  'vcf',
  'srt',
  'ass',
  'vtt',
  'ttf',
  'otf',
  'woff',
  'woff2',
  'apk',
  'ipa',
  'exe',
  'msi',
  'deb',
  'rpm'
]);

const OBSIDIAN_NOTE_EXTS = new Set(['md', 'canvas', 'base']);
const ALL_ATTACHMENT_EXTS = new Set([...IMAGE_EXTS, ...AUDIO_EXTS, ...OTHER_EXTS]);

function isAttachmentExt(ext) {
  const e = String(ext || '').toLowerCase();
  return Boolean(e) && !OBSIDIAN_NOTE_EXTS.has(e);
}

/**
 * Transcodes HEIC/HEIF/TIFF buffers into browser-renderable JPEG Blob URLs
 */
async function convertBufferToPreviewUrl(arrayBuffer, ext = 'heic') {
  const cleanExt = String(ext || '').toLowerCase();
  if (!NEEDS_TRANSCODE_IMAGE_EXTS.has(cleanExt)) {
    const blob = new Blob([arrayBuffer], { type: `image/${cleanExt === 'jpg' ? 'jpeg' : cleanExt}` });
    return URL.createObjectURL(blob);
  }

  const uid = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const tmpIn = path.join(os.tmpdir(), `fm_in_${uid}.${cleanExt}`);
  const tmpOut = path.join(os.tmpdir(), `fm_out_${uid}.jpg`);

  try {
    fs.writeFileSync(tmpIn, Buffer.from(arrayBuffer));
    await new Promise((resolve, reject) => {
      execFile(
        '/usr/bin/sips',
        ['-s', 'format', 'jpeg', '-s', 'formatOptions', '88', '-Z', '1600', tmpIn, '--out', tmpOut],
        (err) => (err ? reject(err) : resolve())
      );
    });
    const outBuf = fs.readFileSync(tmpOut);
    const blob = new Blob([outBuf], { type: 'image/jpeg' });
    return URL.createObjectURL(blob);
  } finally {
    try { if (fs.existsSync(tmpIn)) fs.unlinkSync(tmpIn); } catch {}
    try { if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut); } catch {}
  }
}

function getExt(filename) {
  const idx = String(filename || '').lastIndexOf('.');
  return idx > -1 ? filename.slice(idx + 1).toLowerCase() : '';
}

function getBaseName(filename) {
  const idx = String(filename || '').lastIndexOf('.');
  return idx > -1 ? filename.slice(0, idx) : String(filename || '');
}

function getFileTypeGroup(ext) {
  const e = String(ext || '').toLowerCase();
  if (e === 'md') return 'note';
  if (IMAGE_EXTS.has(e)) return 'image';
  if (AUDIO_EXTS.has(e)) return 'audio';
  return 'other';
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(i > 1 ? 2 : 1) + ' ' + sizes[i];
}

function computeSha256Hex(arrayBuffer) {
  return crypto.createHash('sha256').update(Buffer.from(arrayBuffer)).digest('hex');
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Sanitizes base filename while preserving CJK characters, normalizing spaces/brackets to underscores
 */
function sanitizeCleanBaseName(str, fallback = 'file') {
  return (
    String(str || '')
      .replace(/[\/\\?%*:|"<>#\0]/g, '_')
      .replace(/[\s()[\]]+/g, '_')
      .replace(/_+/g, '_')
      .trim() || fallback
  );
}

/**
 * Generates base filename from dynamic naming pattern (excluding extension)
 */
function applyNamingPattern(pattern, { noteName, originBase, sha256 }) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const timeStr = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const timestamp = String(Math.floor(now.getTime() / 1000));

  let result = String(pattern || '{origin}');
  result = result.replace(/\{note\}/gi, noteName || 'note');
  result = result.replace(/\{origin\}/gi, originBase || 'file');
  result = result.replace(/\{date\}/gi, dateStr);
  result = result.replace(/\{time\}/gi, timeStr);
  result = result.replace(/\{timestamp\}/gi, timestamp);
  result = result.replace(/\{hash(?::(\d+))?\}/gi, (_, len) => {
    const l = Math.min(64, Math.max(4, Number(len) || 8));
    return (sha256 || '').slice(0, l);
  });
  result = result.replace(/\{rand(?::(\d+))?\}/gi, (_, len) => {
    const l = Math.min(16, Math.max(2, Number(len) || 4));
    return crypto.randomBytes(Math.ceil(l / 2)).toString('hex').slice(0, l);
  });

  return sanitizeCleanBaseName(result, `file_${timestamp}`);
}

/**
 * Constructs multipart/form-data ArrayBuffer payload
 */
function buildMultipartBuffer(fileBytes, filename, mimeType = 'application/octet-stream') {
  const boundary = '----FileMasterBoundary' + Date.now().toString(16);
  const enc = new TextEncoder();
  const safeName = String(filename || 'file.png').replace(/"/g, '_');

  const headerStr =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${safeName}"\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n`;
  const footerStr = `\r\n--${boundary}--\r\n`;

  const headerBuf = enc.encode(headerStr);
  const footerBuf = enc.encode(footerStr);
  const bodyUint8 = new Uint8Array(fileBytes);

  const combined = new Uint8Array(headerBuf.byteLength + bodyUint8.byteLength + footerBuf.byteLength);
  combined.set(headerBuf, 0);
  combined.set(bodyUint8, headerBuf.byteLength);
  combined.set(footerBuf, headerBuf.byteLength + bodyUint8.byteLength);

  return {
    boundary,
    arrayBuffer: combined.buffer
  };
}

/**
 * Confirmation modal for critical actions like remote file deletion
 */
class ConfirmActionModal extends Modal {
  constructor(app, title, message, confirmText = 'Confirm', onConfirm) {
    super(app);
    this.title = title;
    this.message = message;
    this.confirmText = confirmText;
    this.onConfirm = onConfirm;
    this.resolved = false;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('fm-wizard-modal');
    contentEl.createEl('h3', { text: this.title });
    const p = contentEl.createEl('p', { text: this.message });
    p.style.lineHeight = '1.6';
    p.style.margin = '12px 0 18px';

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const cancelBtn = btnRow.createEl('button', { text: 'Cancel' });
    cancelBtn.onclick = () => {
      this.resolved = true;
      this.close();
      this.onConfirm(false);
    };

    const okBtn = btnRow.createEl('button', { text: this.confirmText, cls: 'mod-warning' });
    okBtn.onclick = () => {
      this.resolved = true;
      this.close();
      this.onConfirm(true);
    };
  }

  onClose() {
    if (!this.resolved && this.onConfirm) {
      this.onConfirm(false);
    }
    this.contentEl.empty();
  }
}

/**
 * High-res lightbox modal for asset inspection
 */
class ImageLightboxModal extends Modal {
  constructor(app, plugin, item) {
    super(app);
    this.plugin = plugin;
    this.item = item;
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('fm-wizard-modal');

    contentEl.createEl('h3', {
      text: `🔎 Asset Preview: ${this.item.name}`,
      style: 'margin-bottom: 8px; word-break: break-all;'
    });

    const metaRow = contentEl.createDiv({
      text: `${this.item.source === 'local' ? '💻 Local Vault' : '☁️ Remote Server'}  |  Path: ${this.item.displayPath}  |  Size: ${formatBytes(this.item.size)}`,
      style: 'font-size: 12px; color: var(--text-muted); margin-bottom: 10px;'
    });

    const ext = getExt(this.item.name);
    if (IMAGE_EXTS.has(ext)) {
      const img = contentEl.createEl('img', { cls: 'fm-lightbox-img' });
      const url = await this.plugin.getItemPreviewUrl(this.item);
      if (url) img.src = url;
    } else {
      contentEl.createDiv({
        cls: 'fm-section-box',
        text: `📎 File is a .${ext.toUpperCase()} asset. Click below to inspect or open.`,
        style: 'text-align: center; padding: 30px 16px;'
      });
    }

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    if (this.item.source === 'local' && this.item.rawObj) {
      const openBtn = btnRow.createEl('button', { text: '📂 Open in Obsidian', cls: 'mod-cta' });
      openBtn.onclick = async () => {
        const leaf = this.app.workspace.getLeaf(false);
        if (leaf) await leaf.openFile(this.item.rawObj);
        this.close();
      };
    } else if (this.item.source === 'remote' && this.item.rawObj?.rawUrl) {
      const openBtn = btnRow.createEl('button', { text: '🌐 Open Raw Asset in Browser', cls: 'mod-cta' });
      openBtn.onclick = () => {
        window.open(this.item.rawObj.rawUrl, '_blank');
      };
    }

    const closeBtn = btnRow.createEl('button', { text: 'Close' });
    closeBtn.onclick = () => this.close();
  }

  onClose() {
    this.contentEl.empty();
  }
}

/**
 * Modal listing all notes referencing the selected asset
 */
class NoteRefsModal extends Modal {
  constructor(app, itemName, refNotePaths, onJump) {
    super(app);
    this.itemName = itemName;
    this.refNotePaths = refNotePaths || [];
    this.onJump = onJump;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('fm-wizard-modal');

    contentEl.createEl('h3', { text: `🔗 Notes Referencing "${this.itemName}" (${this.refNotePaths.length})` });

    if (this.refNotePaths.length === 0) {
      contentEl.createDiv({
        cls: 'fm-section-box',
        text: 'This file is currently not referenced by any notes.',
        style: 'text-align: center; padding: 24px;'
      });
    } else {
      const listEl = contentEl.createDiv({ cls: 'fm-scroll-list' });
      for (const notePath of this.refNotePaths) {
        const row = listEl.createDiv({ cls: 'fm-list-item' });
        row.createSpan({ text: `📝 ${notePath}`, style: 'word-break: break-all; font-weight: 500;' });
        const jumpBtn = row.createEl('button', {
          text: '↗ Open Note',
          cls: 'fm-mini-btn mod-cta'
        });
        jumpBtn.onclick = async () => {
          const tf = this.app.vault.getAbstractFileByPath(notePath);
          if (tf) {
            const leaf = this.app.workspace.getLeaf(false);
            if (leaf) await leaf.openFile(tf);
            this.close();
            if (this.onJump) this.onJump();
          } else {
            new Notice('Note not found: ' + notePath);
          }
        };
      }
    }

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const closeBtn = btnRow.createEl('button', { text: 'Close' });
    closeBtn.onclick = () => this.close();
  }

  onClose() {
    this.contentEl.empty();
  }
}

/**
 * Renders a 44x44 thumbnail or icon in wizard lists (click to inspect)
 */
function renderItemVisualThumb(parentEl, item, plugin) {
  const ext = getExt(item.name);
  if (IMAGE_EXTS.has(ext)) {
    const img = parentEl.createEl('img', {
      cls: 'fm-item-thumb',
      attr: { title: 'Click to enlarge preview' }
    });
    img.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      new ImageLightboxModal(plugin.app, plugin, item).open();
    };
    plugin.getItemPreviewUrl(item).then((url) => {
      if (url) img.src = url;
    });
  } else {
    const box = parentEl.createDiv({
      cls: 'fm-item-icon-box',
      attr: { title: 'Click to view asset details' }
    });
    const icon =
      ext === 'md'
        ? '📝'
        : AUDIO_EXTS.has(ext)
          ? '🎵'
          : ['mp4', 'webm', 'mov', 'mkv'].includes(ext)
            ? '🎬'
            : ext === 'pdf'
              ? '📄'
              : '📦';
    box.createSpan({ text: icon });
    box.createSpan({ text: (ext || 'FILE').slice(0, 4).toUpperCase(), cls: 'fm-item-icon-ext' });
    box.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      new ImageLightboxModal(plugin.app, plugin, item).open();
    };
  }
}
class IncomingFileModal extends Modal {
  constructor(app, fileInfo, options, callback) {
    super(app);
    this.fileInfo = fileInfo; // { arrayBuffer, defaultBaseName, ext, size, mimeType }
    this.options = options;   // { askLocation, fixedLocation, promptRename }
    this.callback = callback; // ({ target: 'local'|'remote'|null, finalFilename })
    this.submitted = false;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('fm-wizard-modal');

    contentEl.createEl('h3', { text: '📥 New Asset Detected: Choose Destination' });

    // Render thumbnail preview for images (including HEIC/HEIF/TIFF)
    if (IMAGE_EXTS.has(this.fileInfo.ext)) {
      const img = contentEl.createEl('img', { cls: 'fm-preview-thumb' });
      const loadingTip = NEEDS_TRANSCODE_IMAGE_EXTS.has(this.fileInfo.ext)
        ? contentEl.createDiv({
            text: `⏳ Decoding .${this.fileInfo.ext.toUpperCase()} preview...`,
            style: 'font-size: 12px; color: var(--text-accent); text-align: center; margin-bottom: 8px;'
          })
        : null;

      convertBufferToPreviewUrl(this.fileInfo.arrayBuffer, this.fileInfo.ext)
        .then((url) => {
          img.src = url;
          if (loadingTip) loadingTip.remove();
        })
        .catch(() => {
          if (loadingTip) loadingTip.setText('⚠️ Local preview unavailable; server will auto-transcode upon upload');
        });
    }

    const metaDiv = contentEl.createDiv({
      text: `Type: .${this.fileInfo.ext.toUpperCase()}  |  Size: ${formatBytes(this.fileInfo.size)}`,
      style: 'font-size: 12px; color: var(--text-muted); margin-bottom: 12px; text-align: center;'
    });

    // Filename input
    const nameBox = contentEl.createDiv({ cls: 'fm-section-box' });
    nameBox.createDiv({
      text: `Filename (extension .${this.fileInfo.ext} preserved automatically):`,
      cls: 'fm-section-title'
    });
    const nameInput = nameBox.createEl('input', {
      type: 'text',
      value: this.fileInfo.defaultBaseName,
      style: 'width: 100%; padding: 8px 10px; font-size: 14px;'
    });

    const submitChoice = (targetLocation) => {
      if (this.submitted) return;
      this.submitted = true;
      const cleanBase = sanitizeCleanBaseName(nameInput.value, this.fileInfo.defaultBaseName);
      const finalFilename = `${cleanBase}.${this.fileInfo.ext}`;
      this.close();
      this.callback({ target: targetLocation, finalFilename });
    };

    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitChoice(this.options.askLocation ? 'remote' : this.options.fixedLocation);
      }
    });

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const cancelBtn = btnRow.createEl('button', { text: 'Cancel' });
    cancelBtn.onclick = () => {
      this.submitted = true;
      this.close();
      this.callback({ target: null });
    };

    if (this.options.askLocation) {
      const localBtn = btnRow.createEl('button', { text: '💻 Save to Local Vault' });
      localBtn.onclick = () => submitChoice('local');

      const remoteBtn = btnRow.createEl('button', {
        text: '☁️ Upload to Remote Server (Enter)',
        cls: 'mod-cta'
      });
      remoteBtn.onclick = () => submitChoice('remote');
    } else {
      const label =
        this.options.fixedLocation === 'local'
          ? '💻 Confirm Save to Local (Enter)'
          : '☁️ Confirm Upload to Remote (Enter)';
      const okBtn = btnRow.createEl('button', { text: label, cls: 'mod-cta' });
      okBtn.onclick = () => submitChoice(this.options.fixedLocation);
    }

    setTimeout(() => {
      nameInput.focus();
      nameInput.select();
    }, 30);
  }

  onClose() {
    if (!this.submitted && this.callback) {
      this.callback({ target: null });
    }
    this.contentEl.empty();
  }
}

/**
 * Wizard 1: Orphan Finder Wizard
 * Step 1: Select location scope and file types
 * Step 2: Display results, export report, and safely clean selected items
 */
class OrphanWizardModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.step = 1;
    this.options = {
      scanLocal: true,
      scanRemote: true,
      typeNote: false,  // Notes unchecked by default
      typeImage: true,  // Images checked by default
      typeAudio: true,  // Audio checked by default
      typeOther: true   // Other files checked by default
    };
    this.results = []; // [{ id, source: 'local'|'remote', typeGroup, name, pathOrUrl, size, rawObj, selected }]
  }

  onOpen() {
    this.render();
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('fm-wizard-modal');

    if (this.step === 1) {
      this.renderStep1(contentEl);
    } else {
      this.renderStep2(contentEl);
    }
  }

  renderStep1(contentEl) {
    const header = contentEl.createDiv({ cls: 'fm-step-header' });
    header.createSpan({ text: 'Step 1 of 2', cls: 'fm-step-badge' });
    header.createEl('h3', { text: '🧹 Unused Files Wizard — Select Scope & Types', cls: 'fm-step-title' });

    contentEl.createEl('p', {
      text: 'An asset is considered in use if referenced anywhere in notes, frontmatter YAML, or canvas boards. Select the scope and file types to scan:',
      style: 'font-size: 13px; color: var(--text-muted); margin-bottom: 14px;'
    });

    // 1. Scan location scope
    const locBox = contentEl.createDiv({ cls: 'fm-section-box' });
    locBox.createDiv({ text: '📍 1. Scan Location Scope', cls: 'fm-section-title' });
    this.createCheckbox(locBox, '💻 Scan Local Vault Files', 'scanLocal');
    this.createCheckbox(locBox, '☁️ Scan Remote Server Files', 'scanRemote');

    // 2. File types to scan
    const typeBox = contentEl.createDiv({ cls: 'fm-section-box' });
    typeBox.createDiv({ text: '🗂️ 2. File Types to Scan', cls: 'fm-section-title' });
    this.createCheckbox(typeBox, '📝 Notes (.md) — Orphan unreferenced notes (Unchecked by default)', 'typeNote');
    this.createCheckbox(typeBox, '🖼️ Images (png, jpg, heic, heif, webp, gif, svg, avif, bmp, tiff, etc.)', 'typeImage');
    this.createCheckbox(typeBox, '🎵 Audio (mp3, m4a, wav, flac, ogg, aac, opus, etc.)', 'typeAudio');
    this.createCheckbox(typeBox, '📦 Other Files (Video, PDF, archives, documents, design files)', 'typeOther');

    // 3. Deletion protection rules notice
    const exclFolders = this.plugin.getExcludedLocalFolderList();
    const protInfo = contentEl.createDiv({
      cls: 'fm-section-box',
      style: 'font-size: 12px; color: var(--text-muted); padding: 10px 14px;'
    });
    protInfo.createDiv({
      text: `🛡️ Deletion protection active: remote "protected/keep", locked remote files${exclFolders.length ? `, and excluded local folders (${exclFolders.join(', ')})` : ''} are automatically skipped.`
    });

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const cancelBtn = btnRow.createEl('button', { text: 'Cancel' });
    cancelBtn.onclick = () => this.close();

    const nextBtn = btnRow.createEl('button', { text: 'Next: Start Scan ➔', cls: 'mod-cta' });
    nextBtn.onclick = async () => {
      if (!this.options.scanLocal && !this.options.scanRemote) {
        new Notice('Please select at least one scan location (local or remote).');
        return;
      }
      if (!this.options.typeNote && !this.options.typeImage && !this.options.typeAudio && !this.options.typeOther) {
        new Notice('Please select at least one file type.');
        return;
      }
      nextBtn.disabled = true;
      nextBtn.setText('⏳ Scanning vault references...');
      try {
        this.results = await this.plugin.scanUnusedFiles(this.options);
        this.step = 2;
        this.render();
      } catch (err) {
        new Notice('❌ Scan failed: ' + err.message);
        nextBtn.disabled = false;
        nextBtn.setText('Next: Start Scan ➔');
      }
    };
  }

  createCheckbox(parent, labelText, optKey) {
    const label = parent.createEl('label', { cls: 'fm-check-row' });
    const cb = label.createEl('input', { type: 'checkbox' });
    cb.checked = Boolean(this.options[optKey]);
    cb.onchange = () => {
      this.options[optKey] = cb.checked;
    };
    label.createSpan({ text: labelText });
  }

  renderStep2(contentEl) {
    const header = contentEl.createDiv({ cls: 'fm-step-header' });
    header.createSpan({ text: 'Step 2 of 2', cls: 'fm-step-badge' });
    header.createEl('h3', { text: `🧹 Scan Complete: Found ${this.results.length} Unused File(s)`, cls: 'fm-step-title' });

    const toolbar = contentEl.createDiv({ cls: 'fm-toolbar-row' });
    const leftTools = toolbar.createDiv({ style: 'display:flex; gap:8px; align-items:center;' });
    const backBtn = leftTools.createEl('button', { text: '⬅ Back' });
    backBtn.onclick = () => {
      this.step = 1;
      this.render();
    };

    const selectAllBtn = leftTools.createEl('button', { text: 'Toggle Select All' });
    selectAllBtn.onclick = () => {
      const allSelected = this.results.every((r) => r.selected);
      this.results.forEach((r) => { r.selected = !allSelected; });
      this.render();
    };

    const exportBtn = toolbar.createEl('button', {
      text: '📄 Export Report to Root Markdown',
      cls: 'mod-cta'
    });
    exportBtn.onclick = async () => {
      await this.plugin.exportOrphanReportToRoot(this.results);
    };

    if (this.results.length === 0) {
      contentEl.createDiv({
        cls: 'fm-section-box',
        text: '🎉 Congratulations! No unused files were found in the selected scope.',
        style: 'text-align: center; padding: 36px 20px;'
      });
      return;
    }

    const listEl = contentEl.createDiv({ cls: 'fm-scroll-list' });
    for (const item of this.results) {
      const row = listEl.createDiv({ cls: 'fm-list-item' });
      const left = row.createDiv({
        style: 'display:flex; align-items:center; gap:10px; flex:1; overflow:hidden;'
      });

      const cb = left.createEl('input', { type: 'checkbox', style: 'cursor:pointer;' });
      cb.checked = item.selected;
      cb.onchange = () => {
        item.selected = cb.checked;
      };

      // Render thumbnail preview
      renderItemVisualThumb(left, item, this.plugin);

      const infoCol = left.createDiv({ style: 'overflow:hidden; flex:1;' });
      const topLine = infoCol.createDiv({ style: 'display:flex; align-items:center; gap:6px;' });
      topLine.createSpan({
        text: item.source === 'local' ? '💻 Local' : '☁️ Remote',
        cls: `fm-tag ${item.source === 'local' ? 'fm-tag-local' : 'fm-tag-remote'}`
      });
      topLine.createSpan({
        text: item.displayPath,
        style: 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:500;'
      });

      const rightBox = row.createDiv({
        style: 'display:flex; align-items:center; gap:8px; flex-shrink:0;'
      });
      rightBox.createSpan({
        text: formatBytes(item.size),
        style: 'color: var(--text-muted); font-size: 12px;'
      });

      // Lock button for remote files (e.g. assets used in external blogs)
      if (item.source === 'remote') {
        const lockBtn = rightBox.createEl('button', {
          text: '🔒 Lock',
          cls: 'fm-mini-btn',
          attr: { title: 'Mark remote file as protected against deletion' }
        });
        lockBtn.onclick = async () => {
          try {
            await this.plugin.toggleRemoteFileLock(item.rawObj.year, item.rawObj.month, item.rawObj.filename, true);
            new Notice(`🔒 Protected "${item.name}" against deletion and removed from cleanup list.`);
            this.results = this.results.filter((r) => r.id !== item.id);
            this.render();
          } catch (err) {
            new Notice(`❌ Lock failed: ${err.message}`);
          }
        };
      }
    }

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const cleanBtn = btnRow.createEl('button', {
      text: '🗑️ Clean Selected Unused Files',
      cls: 'mod-warning'
    });
    cleanBtn.onclick = async () => {
      const selected = this.results.filter((r) => r.selected);
      if (selected.length === 0) {
        new Notice('Please select at least one file to clean.');
        return;
      }
      await this.plugin.cleanSelectedOrphans(selected, () => {
        const removedIds = new Set(selected.map((s) => s.id));
        this.results = this.results.filter((r) => !removedIds.has(r.id));
        this.render();
      });
    };
  }

  onClose() {
    this.contentEl.empty();
  }
}

/**
 * Wizard 2: Duplicate Finder Wizard
 * Step 1: Select duplicate comparison scope (local & remote / local only / remote only)
 * Step 2: Display duplicate groups, thumbnail previews, note references, and resolution strategies
 */
class DuplicateWizardModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.step = 1;
    this.scope = 'both'; // 'both' (local & remote) | 'local' | 'remote'
    this.processMode = 'auto'; // 'auto' (smart select) | 'prefer-remote' | 'prefer-local'
    this.groups = []; // [{ sha256, size, items: [{ id, source, name, displayPath, size, locked, refNotes: [], rawObj }], keepId }]
  }

  onOpen() {
    this.render();
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('fm-wizard-modal');

    if (this.step === 1) {
      this.renderStep1(contentEl);
    } else {
      this.renderStep2(contentEl);
    }
  }

  renderStep1(contentEl) {
    const header = contentEl.createDiv({ cls: 'fm-step-header' });
    header.createSpan({ text: 'Step 1 of 2', cls: 'fm-step-badge' });
    header.createEl('h3', { text: '🔍 Duplicate Files Wizard — Select Comparison Scope', cls: 'fm-step-title' });

    contentEl.createEl('p', {
      text: 'FileMaster uses exact SHA-256 content hashes to find identical duplicate files. All references across notes are safely updated and verified before duplicate removal.',
      style: 'font-size: 13px; color: var(--text-muted); margin-bottom: 14px;'
    });

    const scopeBox = contentEl.createDiv({ cls: 'fm-section-box' });
    scopeBox.createDiv({ text: '🔍 Choose duplicate comparison scope:', cls: 'fm-section-title' });

    const scopes = [
      { key: 'both', label: '🌐 Compare Local Vault & Remote Server (Recommended: slims local vault)' },
      { key: 'local', label: '💻 Local Vault Only' },
      { key: 'remote', label: '☁️ Remote Server Only' }
    ];

    for (const s of scopes) {
      const row = scopeBox.createEl('label', { cls: 'fm-check-row' });
      const radio = row.createEl('input', { type: 'radio', attr: { name: 'fm_dup_scope' } });
      radio.checked = this.scope === s.key;
      radio.onchange = () => {
        this.scope = s.key;
      };
      row.createSpan({ text: s.label });
    }

    const exclFolders = this.plugin.getExcludedLocalFolderList();
    const protBox = contentEl.createDiv({
      cls: 'fm-section-box',
      style: 'font-size: 12px; color: var(--text-muted); padding: 10px 14px;'
    });
    protBox.createDiv({
      text: `🛡️ Protection Rules: Local excluded folders (${exclFolders.join(', ') || 'none'}) are skipped. Remote files with "🔒 Protected Lock" are prioritized as keep targets and never deleted.`
    });

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const cancelBtn = btnRow.createEl('button', { text: 'Cancel' });
    cancelBtn.onclick = () => this.close();

    const nextBtn = btnRow.createEl('button', { text: 'Next: Start Hash Comparison ➔', cls: 'mod-cta' });
    nextBtn.onclick = async () => {
      nextBtn.disabled = true;
      nextBtn.setText('⏳ Calculating SHA-256 hashes and resolving references...');
      try {
        this.groups = await this.plugin.scanDuplicateGroups(this.scope);
        this.applyProcessMode('auto');
        this.step = 2;
        this.render();
      } catch (err) {
        new Notice('❌ Comparison failed: ' + err.message);
        nextBtn.disabled = false;
        nextBtn.setText('Next: Start Hash Comparison ➔');
      }
    };
  }

  applyProcessMode(mode) {
    this.processMode = mode;
    for (const grp of this.groups) {
      // Prioritize locked remote files as keep targets so they are never marked for deletion
      const lockedItem = grp.items.find((i) => i.locked);
      if (lockedItem) {
        grp.keepId = lockedItem.id;
        continue;
      }

      if (mode === 'prefer-remote') {
        const remoteItem = grp.items.find((i) => i.source === 'remote');
        grp.keepId = remoteItem ? remoteItem.id : grp.items[0].id;
      } else if (mode === 'prefer-local') {
        const localItem = grp.items.find((i) => i.source === 'local');
        grp.keepId = localItem ? localItem.id : grp.items[0].id;
      } else {
        const sorted = [...grp.items].sort((a, b) => {
          if (b.refNotes.length !== a.refNotes.length) return b.refNotes.length - a.refNotes.length;
          if (a.source !== b.source) return a.source === 'remote' ? -1 : 1;
          return 0;
        });
        grp.keepId = sorted[0].id;
      }
    }
  }

  renderStep2(contentEl) {
    const header = contentEl.createDiv({ cls: 'fm-step-header' });
    header.createSpan({ text: 'Step 2 of 2', cls: 'fm-step-badge' });
    header.createEl('h3', {
      text: `🔍 Comparison Complete: Found ${this.groups.length} Duplicate Group(s)`,
      cls: 'fm-step-title'
    });

    // Top toolbar: back button, resolution strategy dropdown, export report
    const toolbar = contentEl.createDiv({ cls: 'fm-toolbar-row' });
    const leftTools = toolbar.createDiv({ style: 'display:flex; gap:8px; align-items:center; flex-wrap:wrap;' });

    const backBtn = leftTools.createEl('button', { text: '⬅ Back' });
    backBtn.onclick = () => {
      this.step = 1;
      this.render();
    };

    leftTools.createSpan({ text: 'Strategy:', style: 'font-size:13px; font-weight:600; margin-left:4px;' });
    const modeSelect = leftTools.createEl('select', { style: 'padding: 5px 8px; border-radius: 6px;' });
    const modeOptions = [
      { value: 'auto', label: '1. Auto-select item to keep (Recommended)' },
      { value: 'prefer-remote', label: '2. Replace local files with remote copies (Vault Slimming)' },
      { value: 'prefer-local', label: '3. Keep local files and remove remote duplicates' }
    ];
    for (const opt of modeOptions) {
      const o = modeSelect.createEl('option', { value: opt.value, text: opt.label });
      if (opt.value === this.processMode) o.selected = true;
    }
    modeSelect.onchange = () => {
      this.applyProcessMode(modeSelect.value);
      this.render();
    };

    const exportBtn = toolbar.createEl('button', {
      text: '📄 Export Report to Root Markdown'
    });
    exportBtn.onclick = async () => {
      await this.plugin.exportDuplicateReportToRoot(this.groups);
    };

    if (this.groups.length === 0) {
      contentEl.createDiv({
        cls: 'fm-section-box',
        text: '🎉 Congratulations! No duplicate files found in the selected scope.',
        style: 'text-align: center; padding: 36px 20px;'
      });
      return;
    }

    const listEl = contentEl.createDiv({ cls: 'fm-scroll-list' });
    this.groups.forEach((grp, idx) => {
      const grpBox = listEl.createDiv({ cls: 'fm-dup-group' });
      const grpHead = grpBox.createDiv({ cls: 'fm-dup-group-header' });
      grpHead.createSpan({
        text: `Duplicate Group #${idx + 1} (SHA-256: ${grp.sha256.slice(0, 12)}... | Size: ${formatBytes(grp.size)})`
      });
      grpHead.createSpan({ text: 'Click thumbnail to inspect; click reference count to view notes' });

      for (const item of grp.items) {
        const isKeep = grp.keepId === item.id;
        const row = grpBox.createDiv({ cls: 'fm-list-item' });
        const left = row.createDiv({
          style: 'display:flex; align-items:center; gap:8px; flex:1; overflow:hidden;'
        });

        const radio = left.createEl('input', {
          type: 'radio',
          attr: { name: `dup_grp_${idx}` },
          style: 'cursor:pointer;'
        });
        radio.checked = isKeep;
        radio.onchange = () => {
          grp.keepId = item.id;
          this.render();
        };

        // Thumbnail preview
        renderItemVisualThumb(left, item, this.plugin);

        left.createSpan({
          text: isKeep ? '✅ Keep' : item.locked ? '🔒 Protected' : '🗑️ Remove',
          style: `font-size:12px; font-weight:700; color:${isKeep ? '#10b981' : item.locked ? '#f59e0b' : '#ef4444'}; width:68px; flex-shrink:0;`
        });

        left.createSpan({
          text: item.source === 'local' ? '💻 Local' : '☁️ Remote',
          cls: `fm-tag ${item.source === 'local' ? 'fm-tag-local' : 'fm-tag-remote'}`
        });

        if (item.locked) {
          left.createSpan({
            text: item.rawObj?.inProtectedFolder ? '🛡️ Protected Folder' : '🔒 Locked',
            cls: 'fm-tag fm-tag-lock'
          });
        }

        left.createSpan({
          text: item.displayPath,
          style: 'word-break:break-all; cursor:pointer;',
          attr: { title: 'Click to designate as keep target' }
        }).onclick = () => {
          grp.keepId = item.id;
          this.render();
        };

        const rightBox = row.createDiv({
          style: 'display:flex; align-items:center; gap:6px; flex-shrink:0;'
        });

        const refBadge = rightBox.createSpan({
          text: `🔗 ${item.refNotes.length} Note Reference(s)`,
          cls: 'fm-tag fm-tag-ref fm-clickable-badge',
          attr: {
            title:
              item.refNotes.length > 0
                ? 'Click to inspect notes referencing this file:\n' + item.refNotes.join('\n')
                : 'Not directly referenced by any notes'
          }
        });
        refBadge.onclick = (e) => {
          e.stopPropagation();
          new NoteRefsModal(this.app, item.name, item.refNotes, () => this.close()).open();
        };
      }
    });

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const execBtn = btnRow.createEl('button', {
      text: '⚡ Safely Rewrite All Note Links & Clean Duplicates',
      cls: 'mod-cta'
    });
    execBtn.onclick = async () => {
      await this.plugin.executeDuplicateMergeSafely(this.groups, () => {
        this.close();
      });
    };
  }

  onClose() {
    this.contentEl.empty();
  }
}

/**
 * Wizard 3: Batch Cloud Migration Wizard
 * Step 1: Select migration folder scope, attachment types, and trash policy
 * Step 2: Preview list, progress bar, upload, and zero-broken-link safe rewrite
 */
class BatchMigrateWizardModal extends Modal {
  constructor(app, plugin, initialFolder = '') {
    super(app);
    this.plugin = plugin;
    this.step = 1;
    this.options = {
      folderPrefix: initialFolder || '', // '' represents entire vault
      typeImage: true,
      typeAudio: true,
      typeOther: true,
      uploadToProtected: false,
      deleteLocalAfter: plugin.settings.deleteLocalAfterMigrate
    };
    this.items = []; // [{ id, source:'local', name, ext, displayPath, size, refNotes, rawObj, selected }]
  }

  onOpen() {
    this.render();
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('fm-wizard-modal');

    if (this.step === 1) {
      this.renderStep1(contentEl);
    } else {
      this.renderStep2(contentEl);
    }
  }

  renderStep1(contentEl) {
    const header = contentEl.createDiv({ cls: 'fm-step-header' });
    header.createSpan({ text: 'Step 1 of 2', cls: 'fm-step-badge' });
    header.createEl('h3', { text: '☁️ Batch Cloud Migration Wizard — Select Scope', cls: 'fm-step-title' });

    contentEl.createEl('p', {
      text: 'Upload local attachments to your FileMaster Server in batches. All notes (.md and .canvas) are safely rewritten to cloud links with zero broken links verification before slimming local storage.',
      style: 'font-size: 13px; color: var(--text-muted); margin-bottom: 14px;'
    });

    // 1. Select folder scope
    const folderBox = contentEl.createDiv({ cls: 'fm-section-box' });
    folderBox.createDiv({ text: '📂 1. Select local folder to scan:', cls: 'fm-section-title' });
    const folderSelect = folderBox.createEl('select', { style: 'width:100%; padding:8px 10px; border-radius:6px;' });
    folderSelect.createEl('option', {
      value: '',
      text: '🌐 Entire Vault (skips excluded directories automatically)'
    });

    const allFolders = this.plugin.getAllVaultFolderPaths();
    for (const fp of allFolders) {
      const opt = folderSelect.createEl('option', { value: fp, text: `📁 ${fp}/` });
      if (fp === this.options.folderPrefix) opt.selected = true;
    }
    folderSelect.onchange = () => {
      this.options.folderPrefix = folderSelect.value;
    };

    // 2. Select attachment types
    const typeBox = contentEl.createDiv({ cls: 'fm-section-box' });
    typeBox.createDiv({ text: '🗂️ 2. Select attachment types to migrate:', cls: 'fm-section-title' });
    this.createCheck(typeBox, '🖼️ Image Attachments (png, jpg, heic, webp, gif, svg, etc.)', 'typeImage');
    this.createCheck(typeBox, '🎵 Audio Attachments (mp3, m4a, wav, flac, ogg, etc.)', 'typeAudio');
    this.createCheck(typeBox, '📦 Other Attachments (video, PDF, archives, documents, etc.)', 'typeOther');

    // 3. Migration policy options
    const policyBox = contentEl.createDiv({ cls: 'fm-section-box' });
    policyBox.createDiv({ text: '🛡️ 3. Migration & Deletion Policy:', cls: 'fm-section-title' });
    this.createCheck(
      policyBox,
      '🗑️ Move local file to trash after verifying 100% zero-broken-link rewrite across all notes',
      'deleteLocalAfter'
    );
    this.createCheck(
      policyBox,
      '🛡️ Upload to server "protected/keep" folder (permanently deletion-locked)',
      'uploadToProtected'
    );

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const cancelBtn = btnRow.createEl('button', { text: 'Cancel' });
    cancelBtn.onclick = () => this.close();

    const nextBtn = btnRow.createEl('button', { text: 'Next: Preview Attachments ➔', cls: 'mod-cta' });
    nextBtn.onclick = async () => {
      if (!this.options.typeImage && !this.options.typeAudio && !this.options.typeOther) {
        new Notice('Please select at least one attachment type.');
        return;
      }
      nextBtn.disabled = true;
      nextBtn.setText('⏳ Scanning local attachments and references...');
      try {
        this.items = await this.plugin.scanLocalAttachmentsForBatchMigrate(this.options);
        this.step = 2;
        this.render();
      } catch (err) {
        new Notice('❌ Scan failed: ' + err.message);
        nextBtn.disabled = false;
        nextBtn.setText('Next: Preview Attachments ➔');
      }
    };
  }

  createCheck(parent, labelText, key) {
    const label = parent.createEl('label', { cls: 'fm-check-row' });
    const cb = label.createEl('input', { type: 'checkbox' });
    cb.checked = Boolean(this.options[key]);
    cb.onchange = () => {
      this.options[key] = cb.checked;
    };
    label.createSpan({ text: labelText });
  }

  renderStep2(contentEl) {
    const header = contentEl.createDiv({ cls: 'fm-step-header' });
    header.createSpan({ text: 'Step 2 of 2', cls: 'fm-step-badge' });
    header.createEl('h3', {
      text: `☁️ Local Attachments to Migrate: Found ${this.items.length} file(s)`,
      cls: 'fm-step-title'
    });

    const toolbar = contentEl.createDiv({ cls: 'fm-toolbar-row' });
    const leftTools = toolbar.createDiv({ style: 'display:flex; gap:8px; align-items:center;' });
    const backBtn = leftTools.createEl('button', { text: '⬅ Back' });
    backBtn.onclick = () => {
      this.step = 1;
      this.render();
    };

    const selectAllBtn = leftTools.createEl('button', { text: 'Toggle Select All' });
    selectAllBtn.onclick = () => {
      const allSelected = this.items.every((i) => i.selected);
      this.items.forEach((i) => { i.selected = !allSelected; });
      this.render();
    };

    const onlyRefBtn = leftTools.createEl('button', { text: 'Select Only Referenced Assets' });
    onlyRefBtn.onclick = () => {
      this.items.forEach((i) => { i.selected = i.refNotes.length > 0; });
      this.render();
    };

    if (this.items.length === 0) {
      contentEl.createDiv({
        cls: 'fm-section-box',
        text: '🎉 No local attachments found to migrate in the selected scope.',
        style: 'text-align: center; padding: 36px 20px;'
      });
      return;
    }

    const listEl = contentEl.createDiv({ cls: 'fm-scroll-list' });
    for (const item of this.items) {
      const row = listEl.createDiv({ cls: 'fm-list-item' });
      const left = row.createDiv({
        style: 'display:flex; align-items:center; gap:10px; flex:1; overflow:hidden;'
      });
      const cb = left.createEl('input', { type: 'checkbox', style: 'cursor:pointer;' });
      cb.checked = item.selected;
      cb.onchange = () => {
        item.selected = cb.checked;
      };

      renderItemVisualThumb(left, item, this.plugin);

      left.createSpan({
        text: item.displayPath,
        style: 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:500;'
      });

      const rightBox = row.createDiv({
        style: 'display:flex; align-items:center; gap:8px; flex-shrink:0;'
      });
      rightBox.createSpan({
        text: formatBytes(item.size),
        style: 'color: var(--text-muted); font-size: 12px;'
      });

      const refBadge = rightBox.createSpan({
        text: `🔗 ${item.refNotes.length} Note Reference(s)`,
        cls: 'fm-tag fm-tag-ref fm-clickable-badge',
        attr: { title: 'Click to inspect notes referencing this asset' }
      });
      refBadge.onclick = (e) => {
        e.stopPropagation();
        new NoteRefsModal(this.app, item.name, item.refNotes, () => this.close()).open();
      };
    }

    const progressBox = contentEl.createDiv({ style: 'display:none; margin-bottom:10px;' });
    const progressText = progressBox.createDiv({ style: 'font-size:12px; color:var(--text-accent);' });
    const progressWrap = progressBox.createDiv({ cls: 'fm-progress-wrap' });
    const progressBar = progressWrap.createDiv({ cls: 'fm-progress-bar' });

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const runBtn = btnRow.createEl('button', {
      text: '🚀 Start Batch Migration & Rewrite Vault Links',
      cls: 'mod-cta'
    });
    runBtn.onclick = async () => {
      const selected = this.items.filter((i) => i.selected);
      if (selected.length === 0) {
        new Notice('Please select at least one local attachment to migrate.');
        return;
      }
      runBtn.disabled = true;
      backBtn.disabled = true;
      progressBox.style.display = 'block';

      await this.plugin.executeBatchMigrateSafely(
        selected,
        this.options,
        (cur, total, name) => {
          const pct = Math.round((cur / Math.max(1, total)) * 100);
          progressBar.style.width = `${pct}%`;
          progressText.setText(`⏳ Migrating (${cur}/${total}): ${name}...`);
        },
        () => {
          this.close();
        }
      );
    };
  }

  onClose() {
    this.contentEl.empty();
  }
}

class FileMasterPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.heicPreviewCache = new Map();

    // Ribbon icon shortcuts
    this.addRibbonIcon('Files', 'FileMaster: Unused Files Wizard', () => {
      new OrphanWizardModal(this.app, this).open();
    });

    this.addRibbonIcon('Copy', 'FileMaster: Duplicate Files Wizard', () => {
      new DuplicateWizardModal(this.app, this).open();
    });

    this.addRibbonIcon('UploadCloud', 'FileMaster: Batch Cloud Migration Wizard', () => {
      new BatchMigrateWizardModal(this.app, this).open();
    });

    // 1. Listen for clipboard paste events
    this.registerEvent(
      this.app.workspace.on('editor-paste', async (evt, editor) => {
        if (!this.settings.enableClipboardMonitor) return;
        const files = evt.clipboardData?.files;
        if (!files || files.length === 0) return;

        const targetFiles = this.filterAllowedFiles(files);
        if (targetFiles.length === 0) return;

        evt.preventDefault();
        for (const f of targetFiles) {
          await this.handleIncomingBrowserFile(f, editor);
        }
      })
    );

    // 2. Listen for drag-and-drop file events in editor
    this.registerEvent(
      this.app.workspace.on('editor-drop', async (evt, editor) => {
        if (!this.settings.enableClipboardMonitor) return;
        const files = evt.dataTransfer?.files;
        if (!files || files.length === 0) return;

        const targetFiles = this.filterAllowedFiles(files);
        if (targetFiles.length === 0) return;

        evt.preventDefault();
        for (const f of targetFiles) {
          await this.handleIncomingBrowserFile(f, editor);
        }
      })
    );

    // 3. Render inline previews for local ![[xxx.heic]], ![[xxx.heif]], and ![[xxx.tiff]] embeds
    this.setupHeicInlinePreviewObserver();

    // 4. Register file tree context menu items
    this.registerContextMenus();

    // 5. Register core commands
    this.addCommand({
      id: 'open-orphan-wizard',
      name: '🧹 Open Unused Files (Orphan Finder) Wizard',
      callback: () => new OrphanWizardModal(this.app, this).open()
    });

    this.addCommand({
      id: 'open-duplicate-wizard',
      name: '🔍 Open Duplicate Files (Deduplication) Wizard',
      callback: () => new DuplicateWizardModal(this.app, this).open()
    });

    this.addCommand({
      id: 'open-batch-migrate-wizard',
      name: '☁️ Open Batch Cloud Migration Wizard',
      callback: () => new BatchMigrateWizardModal(this.app, this).open()
    });

    this.addCommand({
      id: 'migrate-current-note-attachments',
      name: '🚀 Migrate Local Attachments in Active Note to Cloud',
      callback: () => this.migrateActiveNoteAttachments()
    });

    this.addCommand({
      id: 'download-current-note-remote-attachments',
      name: '💻 Download Remote Attachments in Active Note to Vault',
      callback: () => this.downloadActiveNoteRemoteAttachments()
    });

    this.addCommand({
      id: 'copy-note-with-astro-pub-links',
      name: '🌐 Copy Active Note with Astro Watermarked WebP Links',
      callback: () => this.copyActiveNoteForAstro()
    });

    this.addSettingTab(new FileMasterSettingTab(this.app, this));
    console.log('[FileMaster] Plugin loaded successfully');
  }

  onunload() {
    if (this.heicObserver) {
      this.heicObserver.disconnect();
      this.heicObserver = null;
    }
  }

  /**
   * Returns normalized list of local excluded directory paths
   */
  getExcludedLocalFolderList() {
    return String(this.settings.excludedLocalFolders || '')
      .split(/[,;\n]+/)
      .map((s) => s.trim().replace(/^\/+|\/+$/g, ''))
      .filter(Boolean);
  }

  /**
   * Checks whether a local path resides in an excluded folder
   */
  isLocalPathExcluded(filePath) {
    const p = String(filePath || '').replace(/^\/+/, '');
    const list = this.getExcludedLocalFolderList();
    return list.some((folder) => p === folder || p.startsWith(folder + '/'));
  }

  /**
   * Toggles folder exclusion status
   */
  async toggleLocalFolderExclusion(folderPath) {
    const clean = String(folderPath || '').replace(/^\/+|\/+$/g, '');
    if (!clean) return;
    const list = this.getExcludedLocalFolderList();
    const idx = list.indexOf(clean);
    if (idx > -1) {
      list.splice(idx, 1);
      new Notice(`🔓 Removed folder "${clean}" from scan exclusion list`);
    } else {
      list.push(clean);
      new Notice(`🛡️ Added folder "${clean}" to scan exclusion list (ignored in scans)`);
    }
    this.settings.excludedLocalFolders = list.join(', ');
    await this.saveSettings();
  }

  /**
   * Returns list of all vault folder paths for migration selection
   */
  getAllVaultFolderPaths() {
    const folderSet = new Set();
    for (const f of this.app.vault.getFiles()) {
      const parentPath = f.parent?.path;
      if (parentPath && parentPath !== '/') {
        folderSet.add(parentPath);
      }
    }
    return [...folderSet].sort();
  }

  /**
   * Returns image preview URL for local or remote asset item
   */
  async getItemPreviewUrl(item) {
    const ext = getExt(item.name);
    if (!IMAGE_EXTS.has(ext)) return null;

    if (item.source === 'remote') {
      return item.rawObj?.rawUrl || null;
    }

    const tfile = item.rawObj;
    if (!tfile) return null;

    if (NEEDS_TRANSCODE_IMAGE_EXTS.has(ext)) {
      const cacheKey = `${tfile.path}:${tfile.stat?.mtime || 0}`;
      let previewUrl = this.heicPreviewCache.get(cacheKey);
      if (!previewUrl) {
        const buf = await this.app.vault.readBinary(tfile);
        previewUrl = await convertBufferToPreviewUrl(buf, ext);
        this.heicPreviewCache.set(cacheKey, previewUrl);
      }
      return previewUrl;
    }

    return this.app.vault.getResourcePath(tfile);
  }

  /**
   * Registers context menus for file explorer and editor
   */
  registerContextMenus() {
    // 1. File explorer context menu
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, abstractFile) => {
        if (!abstractFile) return;

        // If folder clicked
        if (Array.isArray(abstractFile.children)) {
          const folderPath = abstractFile.path;
          if (!folderPath || folderPath === '/') return;

          menu.addItem((item) => {
            item
              .setTitle('☁️ FileMaster: Batch migrate attachments in folder to cloud...')
              .setIcon('upload-cloud')
              .onClick(() => {
                new BatchMigrateWizardModal(this.app, this, folderPath).open();
              });
          });

          const isExcluded = this.isLocalPathExcluded(folderPath);
          menu.addItem((item) => {
            item
              .setTitle(
                isExcluded
                  ? '🔓 FileMaster: Remove folder from scan exclusion list'
                  : '🛡️ FileMaster: Add folder to scan exclusion list (Protected)'
              )
              .setIcon('shield')
              .onClick(() => {
                this.toggleLocalFolderExclusion(folderPath);
              });
          });
          return;
        }

        // If single attachment clicked
        if (abstractFile.extension && isAttachmentExt(abstractFile.extension)) {
          menu.addItem((item) => {
            item
              .setTitle('☁️ FileMaster: Upload to cloud and update vault links')
              .setIcon('upload-cloud')
              .onClick(async () => {
                await this.migrateSingleLocalFileToRemote(abstractFile, {
                  toProtected: false,
                  deleteLocal: this.settings.deleteLocalAfterMigrate
                });
              });
          });

          menu.addItem((item) => {
            item
              .setTitle('🛡️ FileMaster: Upload to protected folder (Permanent keep)')
              .setIcon('shield')
              .onClick(async () => {
                await this.migrateSingleLocalFileToRemote(abstractFile, {
                  toProtected: true,
                  deleteLocal: this.settings.deleteLocalAfterMigrate
                });
              });
          });
        }
      })
    );

    // 2. Editor context menu for inline asset actions
    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu, editor) => {
        const cursor = editor.getCursor();
        const lineText = editor.getLine(cursor.line) || '';
        if (!lineText.trim()) return;

        // Check if current line contains remote server link
        const remoteMatch = this.extractRemoteItemFromLine(lineText);
        if (remoteMatch) {
          menu.addItem((item) => {
            item
              .setTitle(`💻 FileMaster: Download remote "${remoteMatch.filename}" to vault (Update links)`)
              .setIcon('download')
              .onClick(async () => {
                await this.downloadSingleRemoteItemToLocal(remoteMatch);
              });
          });

          menu.addItem((item) => {
            item
              .setTitle(`🔒 FileMaster: Lock remote "${remoteMatch.filename}" against deletion`)
              .setIcon('lock')
              .onClick(async () => {
                try {
                  await this.toggleRemoteFileLock(
                    remoteMatch.year,
                    remoteMatch.month,
                    remoteMatch.filename,
                    true
                  );
                  new Notice(`🔒 Protected remote asset against deletion: ${remoteMatch.filename}`);
                } catch (err) {
                  new Notice(`❌ Lock failed: ${err.message}`);
                }
              });
          });
        }

        // Check if current line contains local attachment link
        const localTFile = this.extractLocalAttachmentFromLine(lineText);
        if (localTFile) {
          menu.addItem((item) => {
            item
              .setTitle(`☁️ FileMaster: Upload local "${localTFile.name}" to cloud (Update links)`)
              .setIcon('upload-cloud')
              .onClick(async () => {
                await this.migrateSingleLocalFileToRemote(localTFile, {
                  toProtected: false,
                  deleteLocal: this.settings.deleteLocalAfterMigrate
                });
              });
          });
        }
      })
    );
  }

  /**
   * Parses remote attachment info { year, month, filename, matchedUrl } from single line
   */
  extractRemoteItemFromLine(lineText) {
    const serverBase = escapeRegExp(this.getCleanServerUrl());
    const re = new RegExp(
      `(${serverBase}\\/([^/\\s)]+)\\/(protected|\\d{4})\\/(keep|\\d{2})\\/([^)\\s]+))`,
      'i'
    );
    const m = re.exec(lineText);
    if (!m) return null;
    let filename = m[5];
    try {
      filename = decodeURIComponent(filename);
    } catch {}
    return {
      matchedUrl: m[1],
      routePrefix: m[2],
      year: m[3],
      month: m[4],
      filename
    };
  }

  /**
   * Parses local attachment TFile from single line
   */
  extractLocalAttachmentFromLine(lineText) {
    const activeFile = this.app.workspace.getActiveFile();
    const sourcePath = activeFile ? activeFile.path : '';

    const wikiMatch = /!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/.exec(lineText);
    if (wikiMatch) {
      const tf = this.app.metadataCache.getFirstLinkpathDest(wikiMatch[1].trim(), sourcePath);
      if (tf && isAttachmentExt(tf.extension)) return tf;
    }

    const mdMatch = /!?\[[^\]]*\]\((?!https?:\/\/)([^)]+)\)/.exec(lineText);
    if (mdMatch) {
      let linkPath = mdMatch[1].trim();
      try {
        linkPath = decodeURIComponent(linkPath);
      } catch {}
      const tf = this.app.metadataCache.getFirstLinkpathDest(linkPath, sourcePath);
      if (tf && isAttachmentExt(tf.extension)) return tf;
    }
    return null;
  }

  /**
   * Transcodes and renders local .heic/.heif/.tiff embeds (![[IMG.heic]]) as visible images in notes
   */
  setupHeicInlinePreviewObserver() {
    const scanEmbeds = () => {
      const embeds = document.querySelectorAll('.internal-embed[src]');
      embeds.forEach((el) => {
        const rawSrc = el.getAttribute('src') || '';
        const cleanSrc = rawSrc.split('#')[0].split('|')[0].trim();
        const ext = getExt(cleanSrc);
        if (!NEEDS_TRANSCODE_IMAGE_EXTS.has(ext)) return;
        if (el.dataset.fmHeicStatus === 'done' || el.dataset.fmHeicStatus === 'loading') return;

        el.dataset.fmHeicStatus = 'loading';
        this.renderSingleHeicEmbed(el, cleanSrc, ext).catch(() => {
          el.dataset.fmHeicStatus = 'error';
        });
      });
    };

    this.app.workspace.onLayoutReady(() => {
      scanEmbeds();
      this.heicObserver = new MutationObserver(() => scanEmbeds());
      this.heicObserver.observe(document.body, { childList: true, subtree: true });
    });

    this.registerEvent(this.app.workspace.on('layout-change', () => scanEmbeds()));
    this.registerEvent(this.app.workspace.on('file-open', () => setTimeout(scanEmbeds, 80)));
  }

  async renderSingleHeicEmbed(embedEl, linkPath, ext) {
    const activeFile = this.app.workspace.getActiveFile();
    const sourcePath = activeFile ? activeFile.path : '';
    let tfile = this.app.metadataCache.getFirstLinkpathDest(linkPath, sourcePath);
    if (!tfile) {
      tfile = this.app.vault.getFiles().find((f) => f.path === linkPath || f.name === linkPath);
    }
    if (!tfile) {
      embedEl.dataset.fmHeicStatus = 'missing';
      return;
    }

    const cacheKey = `${tfile.path}:${tfile.stat?.mtime || 0}`;
    let previewUrl = this.heicPreviewCache.get(cacheKey);
    if (!previewUrl) {
      const buf = await this.app.vault.readBinary(tfile);
      previewUrl = await convertBufferToPreviewUrl(buf, ext);
      this.heicPreviewCache.set(cacheKey, previewUrl);
    }

    embedEl.empty();
    embedEl.removeClass('file-embed', 'mod-generic');
    embedEl.addClass('image-embed', 'is-loaded');
    const img = embedEl.createEl('img', {
      attr: {
        src: previewUrl,
        alt: tfile.name
      }
    });
    img.style.maxWidth = '100%';
    img.style.borderRadius = '6px';
    img.style.display = 'block';
    embedEl.dataset.fmHeicStatus = 'done';
  }

  filterAllowedFiles(fileList) {
    const out = [];
    for (let i = 0; i < fileList.length; i++) {
      const f = fileList[i];
      const ext = getExt(f.name) || (f.type.startsWith('image/') ? 'png' : '');
      if (IMAGE_EXTS.has(ext)) {
        out.push(f);
      } else if (this.settings.uploadNonImageAttachments && isAttachmentExt(ext)) {
        out.push(f);
      }
    }
    return out;
  }

  getCleanServerUrl() {
    return String(this.settings.serverUrl || 'http://localhost:3000').replace(/\/+$/, '');
  }

  /**
   * Handles paste/drop events based on storage destination and renaming strategy
   */
  async handleIncomingBrowserFile(file, editor) {
    const arrayBuffer = await file.arrayBuffer();
    const ext = getExt(file.name) || (file.type.startsWith('image/') ? 'png' : 'bin');
    const rawOriginBase = sanitizeCleanBaseName(getBaseName(file.name), 'Pasted_image');
    const sha256 = computeSha256Hex(arrayBuffer);
    const activeFile = this.app.workspace.getActiveFile();
    const noteName = activeFile ? activeFile.basename : 'note';

    // Calculate default base filename (excluding extension)
    let defaultBaseName = rawOriginBase;
    if (this.settings.namingMode === 'rule') {
      defaultBaseName = applyNamingPattern(this.settings.namingPattern, {
        noteName,
        originBase: rawOriginBase,
        sha256
      });
    } else if (/^image$/i.test(rawOriginBase)) {
      // Browser screenshots default to image.png; add timestamp to avoid collisions
      defaultBaseName = `Pasted_${applyNamingPattern('{date}_{time}', { noteName, originBase: rawOriginBase, sha256 })}`;
    }

    const askLocation = this.settings.saveLocationMode === 'ask';
    const promptRename = this.settings.namingMode === 'prompt';

    let chosenTarget = this.settings.saveLocationMode;
    let finalFilename = `${defaultBaseName}.${ext}`;

    // Prompt destination or rename modal if configured
    if (askLocation || promptRename) {
      const choice = await new Promise((resolve) => {
        new IncomingFileModal(
          this.app,
          {
            arrayBuffer,
            defaultBaseName,
            ext,
            size: file.size || arrayBuffer.byteLength,
            mimeType: file.type
          },
          {
            askLocation,
            fixedLocation: this.settings.saveLocationMode,
            promptRename
          },
          resolve
        ).open();
      });

      if (!choice || !choice.target) {
        new Notice('Attachment saving cancelled');
        return;
      }
      chosenTarget = choice.target;
      finalFilename = choice.finalFilename;
    }

    // Execute saving: local vault vs remote server
    if (chosenTarget === 'local') {
      try {
        const sourcePath = activeFile ? activeFile.path : '';
        const localPath = await this.app.fileManager.getAvailablePathForAttachment(
          finalFilename,
          sourcePath
        );
        const createdFile = await this.app.vault.createBinary(localPath, arrayBuffer);
        const mdLink = this.app.fileManager.generateMarkdownLink(createdFile, sourcePath);
        editor.replaceSelection(mdLink + '\n');
        new Notice(`💻 Saved to local vault: ${createdFile.path}`);
      } catch (err) {
        new Notice(`❌ Failed to save locally: ${err.message}`);
      }
    } else {
      const placeholder = `![⏳ Uploading ${finalFilename}...]()`;
      editor.replaceSelection(placeholder + '\n');
      try {
        const res = await this.uploadBufferToServer(
          arrayBuffer,
          finalFilename,
          file.type || 'application/octet-stream'
        );
        const content = editor.getValue();
        editor.setValue(content.replace(placeholder, res.markdown));
        new Notice(
          res.deduplicated
            ? `⚡ Identical file already exists on remote server (Instantly deduplicated): ${res.filename}`
            : `☁️ Uploaded to remote server: ${res.filename}`
        );
      } catch (err) {
        const content = editor.getValue();
        editor.setValue(content.replace(placeholder, `<!-- Upload failed: ${finalFilename} (${err.message}) -->`));
        new Notice(`❌ Remote upload failed: ${err.message}`);
      }
    }
  }

  /**
   * Uploads binary asset to remote server (supports optional protected/keep folder)
   */
  async uploadBufferToServer(
    arrayBuffer,
    filename,
    mimeType = 'application/octet-stream',
    toProtectedFolder = false
  ) {
    const url = `${this.getCleanServerUrl()}/api/image/upload`;
    const { boundary, arrayBuffer: bodyBuffer } = buildMultipartBuffer(arrayBuffer, filename, mimeType);

    const headers = {
      Authorization: `Bearer ${this.settings.apiToken}`,
      'X-File-Name': encodeURIComponent(filename),
      'Content-Type': `multipart/form-data; boundary=${boundary}`
    };
    if (toProtectedFolder) {
      headers['X-Protected-Folder'] = '1';
    }

    const response = await requestUrl({
      url,
      method: 'POST',
      headers,
      body: bodyBuffer,
      throw: false
    });

    if (response.status < 200 || response.status >= 300) {
      const errMsg = response.json?.error || `HTTP ${response.status}`;
      throw new Error(errMsg);
    }

    return response.json;
  }

  /**
   * Toggles remote file deletion protection lock
   */
  async toggleRemoteFileLock(year, month, filename, locked = true) {
    const url = `${this.getCleanServerUrl()}/api/modules/image-host/lock`;
    const response = await requestUrl({
      url,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.settings.apiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ year, month, filename, locked }),
      throw: false
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(response.json?.error || `Lock operation failed (HTTP ${response.status})`);
    }
    return response.json;
  }

  async fetchRemoteFileList() {
    const url = `${this.getCleanServerUrl()}/api/modules/image-host/list`;
    const response = await requestUrl({
      url,
      method: 'GET',
      headers: { Authorization: `Bearer ${this.settings.apiToken}` },
      throw: false
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(response.json?.error || `Unable to fetch remote asset list (HTTP ${response.status})`);
    }
    return response.json.images || [];
  }

  async deleteRemoteFile(year, month, filename) {
    const url = `${this.getCleanServerUrl()}/api/modules/image-host/item/${encodeURIComponent(year)}/${encodeURIComponent(month)}/${encodeURIComponent(filename)}`;
    const response = await requestUrl({
      url,
      method: 'DELETE',
      headers: { Authorization: `Bearer ${this.settings.apiToken}` },
      throw: false
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(response.json?.error || `Failed to delete remote file (HTTP ${response.status})`);
    }
    return true;
  }

  /**
   * Reads all referencable documents (.md and .canvas) and Obsidian resolvedLinks across vault
   * Core principle: As long as a file is referenced anywhere in the vault, it is considered active!
   */
  async buildVaultReferenceSnapshot() {
    const allFiles = this.app.vault.getFiles();
    const docFiles = allFiles.filter(
      (f) =>
        (f.extension === 'md' || f.extension === 'canvas') &&
        !f.name.startsWith('Unused_Files_Report_') &&
        !f.name.startsWith('Duplicate_Files_Report_')
    );

    const docContents = [];
    for (const doc of docFiles) {
      const rawText = await this.app.vault.cachedRead(doc);
      let decodedText = rawText;
      try {
        decodedText = decodeURIComponent(rawText);
      } catch {}
      docContents.push({
        file: doc,
        path: doc.path,
        rawText,
        decodedText
      });
    }

    const resolvedLinks = this.app.metadataCache.resolvedLinks || {};
    const resolvedTargetMap = new Map(); // targetPath -> Set(sourceNotePath)
    for (const [sourcePath, targets] of Object.entries(resolvedLinks)) {
      if (
        sourcePath.startsWith('Unused_Files_Report_') ||
        sourcePath.startsWith('Duplicate_Files_Report_')
      ) {
        continue;
      }
      for (const targetPath of Object.keys(targets || {})) {
        if (!resolvedTargetMap.has(targetPath)) {
          resolvedTargetMap.set(targetPath, new Set());
        }
        resolvedTargetMap.get(targetPath).add(sourcePath);
      }
    }

    return { docContents, resolvedTargetMap };
  }

  /**
   * Finds all notes referencing a local file
   */
  findReferencingNotesForLocalFile(tfile, snapshot) {
    const refNotes = new Set();
    const fromResolved = snapshot.resolvedTargetMap.get(tfile.path);
    if (fromResolved) {
      fromResolved.forEach((p) => refNotes.add(p));
    }

    const name = tfile.name;
    const baseName = tfile.basename;
    const relPath = tfile.path;

    for (const doc of snapshot.docContents) {
      if (doc.path === tfile.path) continue;
      if (
        doc.rawText.includes(name) ||
        doc.decodedText.includes(name) ||
        doc.rawText.includes(relPath) ||
        doc.decodedText.includes(relPath) ||
        (tfile.extension === 'md' &&
          (doc.rawText.includes(`[[${baseName}]]`) ||
            doc.rawText.includes(`[[${baseName}|`) ||
            doc.rawText.includes(`[[${baseName}#`)))
      ) {
        refNotes.add(doc.path);
      }
    }
    return [...refNotes];
  }

  /**
   * Finds all notes referencing a remote file
   */
  findReferencingNotesForRemoteItem(remoteItem, snapshot) {
    const refNotes = new Set();
    const fname = remoteItem.filename;
    const encodedFname = encodeURIComponent(fname);
    const relKey = `${remoteItem.year}/${remoteItem.month}/${fname}`;
    const encodedRelKey = `${remoteItem.year}/${remoteItem.month}/${encodedFname}`;

    for (const doc of snapshot.docContents) {
      if (
        doc.rawText.includes(fname) ||
        doc.decodedText.includes(fname) ||
        doc.rawText.includes(encodedFname) ||
        doc.rawText.includes(relKey) ||
        doc.rawText.includes(encodedRelKey)
      ) {
        refNotes.add(doc.path);
      }
    }
    return [...refNotes];
  }

  /**
   * Wizard 1 engine: scans unused assets (skips excluded folders and locked remote files)
   */
  async scanUnusedFiles(options) {
    const snapshot = await this.buildVaultReferenceSnapshot();
    const allowedGroups = new Set();
    if (options.typeNote) allowedGroups.add('note');
    if (options.typeImage) allowedGroups.add('image');
    if (options.typeAudio) allowedGroups.add('audio');
    if (options.typeOther) allowedGroups.add('other');

    const unusedList = [];

    // 1. Scan local vault (skips excluded folders)
    if (options.scanLocal) {
      const allFiles = this.app.vault.getFiles();
      for (const f of allFiles) {
        if (
          f.name.startsWith('Unused_Files_Report_') ||
          f.name.startsWith('Duplicate_Files_Report_') ||

          f.extension === 'canvas'
        ) {
          continue;
        }
        if (this.isLocalPathExcluded(f.path)) continue;

        const grp = getFileTypeGroup(f.extension);
        if (!allowedGroups.has(grp)) continue;

        const refs = this.findReferencingNotesForLocalFile(f, snapshot);
        if (refs.length === 0) {
          unusedList.push({
            id: `local:${f.path}`,
            source: 'local',
            typeGroup: grp,
            name: f.name,
            displayPath: f.path,
            size: f.stat?.size || 0,
            rawObj: f,
            selected: true
          });
        }
      }
    }

    // 2. Scan remote server (skips deletion-locked and protected files)
    if (options.scanRemote) {
      const remoteFiles = await this.fetchRemoteFileList();
      for (const r of remoteFiles) {
        if (this.settings.excludeLockedRemoteFiles && (r.locked || r.inProtectedFolder)) {
          continue;
        }
        const ext = getExt(r.filename);
        const grp = getFileTypeGroup(ext);
        if (!allowedGroups.has(grp)) continue;

        const refs = this.findReferencingNotesForRemoteItem(r, snapshot);
        if (refs.length === 0) {
          unusedList.push({
            id: `remote:${r.year}/${r.month}/${r.filename}`,
            source: 'remote',
            typeGroup: grp,
            name: r.filename,
            displayPath: `${r.year}/${r.month}/${r.filename}`,
            size: r.size || 0,
            rawObj: r,
            selected: true
          });
        }
      }
    }

    return unusedList;
  }

  /**
   * Exports unused files inspection report to root Markdown document
   */
  async exportOrphanReportToRoot(results) {
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const reportPath = `Unused_Files_Report_${dateStr}.md`;

    const localItems = results.filter((r) => r.source === 'local');
    const remoteItems = results.filter((r) => r.source === 'remote');
    const totalBytes = results.reduce((s, r) => s + (r.size || 0), 0);

    const lines = [
      `# 🧹 Unused Files Inspection Report (${dateStr})`,
      ``,
      `> Generated: ${now.toLocaleString('en-US')}  |  Total Unused Files: **${results.length}**  |  Total Reclaimable Space: **${formatBytes(totalBytes)}**`,
      ``
    ];

    lines.push(`## 💻 1. Local Vault Unused Files (${localItems.length})`);
    if (localItems.length === 0) {
      lines.push(`- No unused local files`);
    } else {
      for (const item of localItems) {
        lines.push(`- [[${item.displayPath}]] — \`${formatBytes(item.size)}\``);
      }
    }

    lines.push(``);
    lines.push(`## ☁️ 2. Remote Server Unused Files (${remoteItems.length})`);
    if (remoteItems.length === 0) {
      lines.push(`- No unused remote files`);
    } else {
      for (const item of remoteItems) {
        lines.push(`- [${item.displayPath}](${item.rawObj.rawUrl}) — \`${formatBytes(item.size)}\``);
      }
    }

    await this.writeOrUpdateRootReport(reportPath, lines.join('\n'));
    new Notice(`📄 Generated report in vault root: ${reportPath}`);
  }

  async writeOrUpdateRootReport(reportPath, content) {
    const existing = this.app.vault.getAbstractFileByPath(reportPath);
    let targetFile;
    if (existing) {
      await this.app.vault.modify(existing, content);
      targetFile = existing;
    } else {
      targetFile = await this.app.vault.create(reportPath, content);
    }
    const leaf = this.app.workspace.getLeaf(false);
    if (leaf && targetFile) {
      await leaf.openFile(targetFile);
    }
  }

  /**
   * Cleans selected unused files with safety confirmation and zero-reference verification
   */
  async cleanSelectedOrphans(selectedItems, onDone) {
    const remoteToClean = selectedItems.filter((i) => i.source === 'remote');
    const localToClean = selectedItems.filter((i) => i.source === 'local');

    if (remoteToClean.length > 0) {
      const remoteBytes = remoteToClean.reduce((s, i) => s + (i.size || 0), 0);
      const confirmed = await new Promise((resolve) => {
        new ConfirmActionModal(
          this.app,
          '⚠️ Confirm Deletion from Remote Server?',
          `You selected ${remoteToClean.length} unused file(s) on the remote server (totaling ${formatBytes(remoteBytes)}). Deleted files cannot be restored. Are you sure you want to proceed?`,
          `Delete Remote Files (${remoteToClean.length})`,
          resolve
        ).open();
      });
      if (!confirmed) return;
    }

    let deletedLocal = 0;
    let deletedRemote = 0;

    for (const item of localToClean) {
      try {
        await this.app.vault.trash(item.rawObj, true);
        deletedLocal++;
      } catch (err) {
        console.error('Failed to delete local file:', err);
      }
    }

    for (const item of remoteToClean) {
      try {
        await this.deleteRemoteFile(item.rawObj.year, item.rawObj.month, item.rawObj.filename);
        deletedRemote++;
      } catch (err) {
        new Notice(`❌ Failed to delete remote file (${item.name}): ${err.message}`);
      }
    }

    new Notice(`✅ Cleanup complete: moved ${deletedLocal} to trash, deleted ${deletedRemote} from server.`);
    if (onDone) onDone();
  }

  /**
   * Wizard 2 engine: scans duplicate asset groups with SHA-256 (skips excluded folders, respects protected locks)
   */
  async scanDuplicateGroups(scope) {
    const snapshot = await this.buildVaultReferenceSnapshot();
    const hashMap = new Map(); // sha256 -> items[]

    const addItem = (sha256, itemObj) => {
      if (!sha256) return;
      if (!hashMap.has(sha256)) hashMap.set(sha256, []);
      hashMap.get(sha256).push(itemObj);
    };

    // 1. Scan local attachments (skips excluded folders)
    if (scope === 'local' || scope === 'both') {
      const allFiles = this.app.vault.getFiles();
      for (const f of allFiles) {
        if (!isAttachmentExt(f.extension)) continue;
        if (this.isLocalPathExcluded(f.path)) continue;

        const buf = await this.app.vault.readBinary(f);
        const sha256 = computeSha256Hex(buf);
        const refNotes = this.findReferencingNotesForLocalFile(f, snapshot);

        addItem(sha256, {
          id: `local:${f.path}`,
          source: 'local',
          name: f.name,
          ext: f.extension.toLowerCase(),
          displayPath: f.path,
          size: f.stat?.size || buf.byteLength,
          locked: false,
          refNotes,
          rawObj: f
        });
      }
    }

    // 2. Scan remote attachments (includes locked state)
    if (scope === 'remote' || scope === 'both') {
      const remoteFiles = await this.fetchRemoteFileList();
      for (const r of remoteFiles) {
        if (!r.sha256) continue;
        const refNotes = this.findReferencingNotesForRemoteItem(r, snapshot);
        addItem(r.sha256, {
          id: `remote:${r.year}/${r.month}/${r.filename}`,
          source: 'remote',
          name: r.filename,
          ext: getExt(r.filename),
          displayPath: `${r.year}/${r.month}/${r.filename}`,
          size: r.size || 0,
          locked: Boolean(r.locked || r.inProtectedFolder),
          refNotes,
          rawObj: r
        });
      }
    }

    const duplicateGroups = [];
    for (const [sha256, items] of hashMap.entries()) {
      if (items.length < 2) continue;
      duplicateGroups.push({
        sha256,
        size: items[0].size || 0,
        items,
        keepId: items[0].id
      });
    }

    return duplicateGroups;
  }

  /**
   * Exports duplicate files inspection report to root Markdown document
   */
  async exportDuplicateReportToRoot(groups) {
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const reportPath = `Duplicate_Files_Report_${dateStr}.md`;

    const lines = [
      `# 🔍 Duplicate Files Inspection Report (${dateStr})`,
      ``,
      `> Generated: ${now.toLocaleString('en-US')}  |  Duplicate Groups: **${groups.length}**`,
      ``
    ];

    if (groups.length === 0) {
      lines.push(`🎉 No duplicate files found.`);
    } else {
      groups.forEach((grp, idx) => {
        lines.push(`## Duplicate Group #${idx + 1} (\`${grp.sha256.slice(0, 12)}...\`, Size: ${formatBytes(grp.size)})`);
        for (const item of grp.items) {
          const isKeep = grp.keepId === item.id ? ' **[Current Keep Selection]**' : '';
          const lockTag = item.locked ? ' `🔒 Protected`' : '';
          const linkStr =
            item.source === 'local'
              ? `💻 Local: [[${item.displayPath}]]`
              : `☁️ Remote: [${item.displayPath}](${item.rawObj.rawUrl})`;
          const refsStr =
            item.refNotes.length > 0
              ? `Referencing Notes: ${item.refNotes.map((n) => `[[${n}]]`).join(', ')}`
              : `No direct note references`;
          lines.push(`- ${linkStr}${lockTag}${isKeep} — (${refsStr})`);
        }
        lines.push(``);
      });
    }

    await this.writeOrUpdateRootReport(reportPath, lines.join('\n'));
    new Notice(`📄 Generated report in vault root: ${reportPath}`);
  }

  /**
   * Rewrites all references to removeItem into keepItem across note content
   */
  rewriteContentLinks(content, removeItem, keepItem) {
    let updated = content;

    const buildReplacementForWikiEmbed = (aliasOrWidth) => {
      if (keepItem.source === 'local') {
        const suffix = aliasOrWidth ? `|${aliasOrWidth}` : '';
        return `![[${keepItem.displayPath}${suffix}]]`;
      } else {
        const alt = aliasOrWidth || '';
        return IMAGE_EXTS.has(keepItem.ext)
          ? `![${alt}](${keepItem.rawObj.rawUrl})`
          : `[📎 ${aliasOrWidth || keepItem.name}](${keepItem.rawObj.rawUrl})`;
      }
    };

    const buildReplacementForWikiLink = (aliasText) => {
      if (keepItem.source === 'local') {
        const suffix = aliasText ? `|${aliasText}` : '';
        return `[[${keepItem.displayPath}${suffix}]]`;
      } else {
        return `[${aliasText || keepItem.name}](${keepItem.rawObj.rawUrl})`;
      }
    };

    const buildReplacementForMdLink = (isEmbed, altText) => {
      if (keepItem.source === 'local') {
        const prefix = isEmbed ? '!' : '';
        const alias = altText ? `|${altText}` : '';
        return `${prefix}[[${keepItem.displayPath}${alias}]]`;
      } else {
        if (isEmbed && IMAGE_EXTS.has(keepItem.ext)) {
          return `![${altText || ''}](${keepItem.rawObj.rawUrl})`;
        }
        return `[${altText || '📎 ' + keepItem.name}](${keepItem.rawObj.rawUrl})`;
      }
    };

    if (removeItem.source === 'local') {
      const candidates = new Set([
        removeItem.displayPath,
        removeItem.name,
        encodeURI(removeItem.displayPath),
        encodeURI(removeItem.name),
        encodeURIComponent(removeItem.name)
      ]);

      for (const cand of candidates) {
        const esc = escapeRegExp(cand);
        const wikiEmbedRe = new RegExp(`!\\[\\[(?:\\.\\/)?${esc}(?:#[^\\]|]*)?(?:\\|([^\\]]*))?\\]\\]`, 'g');
        updated = updated.replace(wikiEmbedRe, (_, alias) => buildReplacementForWikiEmbed(alias));

        const wikiLinkRe = new RegExp(`(?<!!)\\[\\[(?:\\.\\/)?${esc}(?:#[^\\]|]*)?(?:\\|([^\\]]*))?\\]\\]`, 'g');
        updated = updated.replace(wikiLinkRe, (_, alias) => buildReplacementForWikiLink(alias));

        const mdLinkRe = new RegExp(`(!?)\\[([^\\]]*)\\]\\(<?(?:\\.\\/)?${esc}>?\\)`, 'g');
        updated = updated.replace(mdLinkRe, (_, bang, alt) =>
          buildReplacementForMdLink(bang === '!', alt)
        );
      }

      if (keepItem.source === 'local') {
        updated = updated.split(`"${removeItem.displayPath}"`).join(`"${keepItem.displayPath}"`);
      } else {
        updated = updated.split(`"${removeItem.displayPath}"`).join(`"${keepItem.rawObj.rawUrl}"`);
      }
    } else {
      const r = removeItem.rawObj;
      const encodedName = encodeURIComponent(r.filename);
      const urlPatterns = new Set([
        r.rawUrl,
        r.pubUrl,
        `${r.year}/${r.month}/${r.filename}`,
        `${r.year}/${r.month}/${encodedName}`
      ]);

      for (const pat of urlPatterns) {
        if (!pat) continue;
        const esc = escapeRegExp(pat);
        const remoteMdRe = new RegExp(`(!?)\\[([^\\]]*)\\]\\(([^)\\s]*${esc})\\)`, 'g');
        updated = updated.replace(remoteMdRe, (_, bang, alt) =>
          buildReplacementForMdLink(bang === '!', alt)
        );
      }

      if (keepItem.source === 'remote') {
        if (r.rawUrl) updated = updated.split(r.rawUrl).join(keepItem.rawObj.rawUrl);
        if (r.pubUrl) updated = updated.split(r.pubUrl).join(keepItem.rawObj.pubUrl);
      }
    }

    return updated;
  }

  /**
   * Safely executes duplicate file merging
   * Rule: First rewrite all note links -> verify zero dangling references in vault -> finally delete redundant files!
   */
  async executeDuplicateMergeSafely(groups, onComplete) {
    const tasks = [];
    const remoteItemsToDelete = [];

    for (const grp of groups) {
      const keepItem = grp.items.find((i) => i.id === grp.keepId);
      if (!keepItem) continue;
      const removeItems = grp.items.filter((i) => i.id !== grp.keepId);
      if (removeItems.length === 0) continue;

      for (const rem of removeItems) {
        if (rem.source === 'remote' && !rem.locked) {
          remoteItemsToDelete.push({ removeItem: rem, keepItem });
        }
      }
      tasks.push({ keepItem, removeItems });
    }

    if (tasks.length === 0) {
      new Notice('No duplicate files to process');
      return;
    }

    if (remoteItemsToDelete.length > 0) {
      const totalRemoteBytes = remoteItemsToDelete.reduce((s, x) => s + (x.removeItem.size || 0), 0);
      const confirmed = await new Promise((resolve) => {
        new ConfirmActionModal(
          this.app,
          '⚠️ Confirm Deletion of Replaced Remote Files?',
          `You selected to keep local (or other) files; ${remoteItemsToDelete.length} remote file(s) (totaling ${formatBytes(totalRemoteBytes)}) will be removed. All note links will first be safely updated to the kept file and verified before any remote files are deleted. Proceed?`,
          `Replace Links and Delete Remote (${remoteItemsToDelete.length})`,
          resolve
        ).open();
      });
      if (!confirmed) return;
    }

    // Phase 1: Rewrite all note links pointing from removeItem to keepItem across vault
    const allDocs = this.app.vault
      .getFiles()
      .filter(
        (f) =>
          (f.extension === 'md' || f.extension === 'canvas') &&
          !f.name.startsWith('Unused_Files_Report_') &&
          !f.name.startsWith('Duplicate_Files_Report_')
      );

    let modifiedDocsCount = 0;
    for (const doc of allDocs) {
      const origContent = await this.app.vault.read(doc);
      let newContent = origContent;

      for (const { keepItem, removeItems } of tasks) {
        for (const rem of removeItems) {
          newContent = this.rewriteContentLinks(newContent, rem, keepItem);
        }
      }

      if (newContent !== origContent) {
        await this.app.vault.modify(doc, newContent);
        modifiedDocsCount++;
      }
    }

    // Phase 2: Verification Gate - verify zero remaining references before deletion
    const postSnapshot = await this.buildVaultReferenceSnapshot();
    let deletedLocalCount = 0;
    let deletedRemoteCount = 0;
    let skippedBySafetyGate = 0;

    for (const { keepItem, removeItems } of tasks) {
      for (const rem of removeItems) {
        if (rem.locked) {
          // Intercept deletion if locked
          continue;
        }

        let remainingRefs = [];
        if (rem.source === 'local') {
          for (const doc of postSnapshot.docContents) {
            if (keepItem.name !== rem.name) {
              if (doc.rawText.includes(rem.name) || doc.decodedText.includes(rem.name)) {
                remainingRefs.push(doc.path);
              }
            } else if (doc.rawText.includes(rem.displayPath) || doc.decodedText.includes(rem.displayPath)) {
              remainingRefs.push(doc.path);
            }
          }
        } else {
          remainingRefs = this.findReferencingNotesForRemoteItem(rem.rawObj, postSnapshot);
        }

        if (remainingRefs.length > 0) {
          console.warn(
            `[FileMaster Safety Gate] Blocked deletion of ${rem.displayPath}; dangling references detected in notes:`,
            remainingRefs
          );
          skippedBySafetyGate++;
          continue;
        }

        // Phase 3: Safely execute deletion once zero dangling references confirmed
        if (rem.source === 'local') {
          await this.app.vault.trash(rem.rawObj, true).catch(() => {});
          deletedLocalCount++;
        } else {
          try {
            await this.deleteRemoteFile(rem.rawObj.year, rem.rawObj.month, rem.rawObj.filename);
            deletedRemoteCount++;
          } catch (err) {
            new Notice(`❌ Failed to delete remote file (${rem.name}): ${err.message}`);
          }
        }
      }
    }

    if (skippedBySafetyGate > 0) {
      new Notice(
        `⚠️ Updated ${modifiedDocsCount} note(s); removed ${deletedLocalCount} local and ${deletedRemoteCount} remote file(s). ${skippedBySafetyGate} file(s) retained because safety verification detected lingering references. Zero broken links preserved!`
      );
    } else {
      new Notice(
        `🎉 Deduplication complete! Safely updated ${modifiedDocsCount} note(s) (zero broken links verified); removed ${deletedLocalCount} local and ${deletedRemoteCount} remote copy(ies).`
      );
    }

    if (onComplete) onComplete();
  }

  /**
   * Migrates single local attachment to cloud with link rewrite and verification gate
   */
  async migrateSingleLocalFileToRemote(tfile, { toProtected = false, deleteLocal = true } = {}) {
    try {
      new Notice(`⏳ Uploading "${tfile.name}" to remote server...`);
      const buf = await this.app.vault.readBinary(tfile);
      const res = await this.uploadBufferToServer(buf, tfile.name, 'application/octet-stream', toProtected);

      const removeItem = {
        source: 'local',
        name: tfile.name,
        ext: tfile.extension.toLowerCase(),
        displayPath: tfile.path,
        rawObj: tfile
      };
      const keepItem = {
        source: 'remote',
        name: res.filename,
        ext: getExt(res.filename),
        displayPath: `${res.year}/${res.month}/${res.filename}`,
        rawObj: res
      };

      const allDocs = this.app.vault
        .getFiles()
        .filter(
          (f) =>
            (f.extension === 'md' || f.extension === 'canvas') &&
            !f.name.startsWith('Unused_Files_Report_') &&
            !f.name.startsWith('Duplicate_Files_Report_')
        );

      let modifiedCount = 0;
      for (const doc of allDocs) {
        const orig = await this.app.vault.read(doc);
        const updated = this.rewriteContentLinks(orig, removeItem, keepItem);
        if (updated !== orig) {
          await this.app.vault.modify(doc, updated);
          modifiedCount++;
        }
      }

      if (deleteLocal) {
        const postSnapshot = await this.buildVaultReferenceSnapshot();
        const remaining = this.findReferencingNotesForLocalFile(tfile, postSnapshot);
        if (remaining.length === 0) {
          await this.app.vault.trash(tfile, true).catch(() => {});
        }
      }

      new Notice(
        `✅ Uploaded "${tfile.name}" to remote server${toProtected ? ' (protected)' : ''} and updated links in ${modifiedCount} note(s)!`
      );
      return res;
    } catch (err) {
      new Notice(`❌ Upload migration failed (${tfile.name}): ${err.message}`);
      throw err;
    }
  }

  /**
   * Downloads single remote asset to local vault and updates links across notes
   */
  async downloadSingleRemoteItemToLocal(remoteMatch) {
    try {
      const { year, month, filename } = remoteMatch;
      new Notice(`⏳ Downloading remote "${filename}" to vault...`);

      // Resolve rawUrl/pubUrl from asset list; fallback to matchedUrl
      let remoteObj = null;
      try {
        const list = await this.fetchRemoteFileList();
        remoteObj = list.find(
          (r) => r.year === year && r.month === month && r.filename === filename
        );
      } catch {}

      const downloadUrl = remoteObj
        ? `${remoteObj.rawUrl}?download=1`
        : `${remoteMatch.matchedUrl}?download=1`;

      const response = await requestUrl({
        url: downloadUrl,
        method: 'GET',
        headers: { Authorization: `Bearer ${this.settings.apiToken}` },
        throw: false
      });

      if (response.status < 200 || response.status >= 300 || !response.arrayBuffer) {
        throw new Error(`Failed to download remote file (HTTP ${response.status})`);
      }

      const activeFile = this.app.workspace.getActiveFile();
      const sourcePath = activeFile ? activeFile.path : '';
      const localPath = await this.app.fileManager.getAvailablePathForAttachment(
        filename,
        sourcePath
      );
      const createdFile = await this.app.vault.createBinary(localPath, response.arrayBuffer);

      const removeItem = {
        source: 'remote',
        name: filename,
        ext: getExt(filename),
        displayPath: `${year}/${month}/${filename}`,
        rawObj: remoteObj || {
          year,
          month,
          filename,
          rawUrl: remoteMatch.matchedUrl,
          pubUrl: `${this.getCleanServerUrl()}/pub/${year}/${month}/${getBaseName(filename)}.webp`
        }
      };

      const keepItem = {
        source: 'local',
        name: createdFile.name,
        ext: createdFile.extension.toLowerCase(),
        displayPath: createdFile.path,
        rawObj: createdFile
      };

      const allDocs = this.app.vault
        .getFiles()
        .filter(
          (f) =>
            (f.extension === 'md' || f.extension === 'canvas') &&
            !f.name.startsWith('Unused_Files_Report_') &&
            !f.name.startsWith('Duplicate_Files_Report_')
        );

      let modifiedCount = 0;
      for (const doc of allDocs) {
        const orig = await this.app.vault.read(doc);
        const updated = this.rewriteContentLinks(orig, removeItem, keepItem);
        if (updated !== orig) {
          await this.app.vault.modify(doc, updated);
          modifiedCount++;
        }
      }

      new Notice(
        `💻 Saved remote "${filename}" to vault (${createdFile.path}) and updated links in ${modifiedCount} note(s)!`
      );
      return createdFile;
    } catch (err) {
      new Notice(`❌ Failed to download to vault: ${err.message}`);
      throw err;
    }
  }

  /**
   * Downloads all remote assets in active note to local vault
   */
  async downloadActiveNoteRemoteAttachments() {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile || activeFile.extension !== 'md') {
      new Notice('Please open a Markdown note first.');
      return;
    }

    const content = await this.app.vault.read(activeFile);
    const serverBase = escapeRegExp(this.getCleanServerUrl());
    const re = new RegExp(
      `(${serverBase}\\/([^/\\s)]+)\\/(protected|\\d{4})\\/(keep|\\d{2})\\/([^)\\s]+))`,
      'gi'
    );

    const matchesMap = new Map();
    let m;
    while ((m = re.exec(content)) !== null) {
      let filename = m[5];
      try {
        filename = decodeURIComponent(filename);
      } catch {}
      const key = `${m[3]}/${m[4]}/${filename}`;
      if (!matchesMap.has(key)) {
        matchesMap.set(key, {
          matchedUrl: m[1],
          routePrefix: m[2],
          year: m[3],
          month: m[4],
          filename
        });
      }
    }

    if (matchesMap.size === 0) {
      new Notice('No remote attachment links found in active note.');
      return;
    }

    let count = 0;
    for (const item of matchesMap.values()) {
      try {
        await this.downloadSingleRemoteItemToLocal(item);
        count++;
      } catch {}
    }

    if (count > 0) {
      new Notice(`🎉 Downloaded ${count} remote attachment(s) to vault and updated links!`);
    }
  }

  /**
   * Wizard 3 engine: scans local attachments eligible for batch migration
   */
  async scanLocalAttachmentsForBatchMigrate(options) {
    const snapshot = await this.buildVaultReferenceSnapshot();
    const allowedGroups = new Set();
    if (options.typeImage) allowedGroups.add('image');
    if (options.typeAudio) allowedGroups.add('audio');
    if (options.typeOther) allowedGroups.add('other');

    const prefix = String(options.folderPrefix || '').replace(/^\/+|\/+$/g, '');
    const list = [];

    for (const f of this.app.vault.getFiles()) {
      if (!isAttachmentExt(f.extension)) continue;
      if (prefix) {
        if (f.path !== prefix && !f.path.startsWith(prefix + '/')) continue;
      } else if (this.isLocalPathExcluded(f.path)) {
        continue;
      }

      const grp = getFileTypeGroup(f.extension);
      if (!allowedGroups.has(grp)) continue;

      const refNotes = this.findReferencingNotesForLocalFile(f, snapshot);
      list.push({
        id: `local:${f.path}`,
        source: 'local',
        name: f.name,
        ext: f.extension.toLowerCase(),
        displayPath: f.path,
        size: f.stat?.size || 0,
        refNotes,
        rawObj: f,
        selected: true
      });
    }

    return list;
  }

  /**
   * Batch-uploads selected local assets to remote server and rewrites links safely
   */
  async executeBatchMigrateSafely(selectedItems, options, onProgress, onDone) {
    const uploadedPairs = []; // [{ tfile, removeItem, keepItem }]
    const total = selectedItems.length;

    for (let i = 0; i < total; i++) {
      const item = selectedItems[i];
      const tfile = item.rawObj;
      if (onProgress) onProgress(i + 1, total, tfile.name);

      try {
        const buf = await this.app.vault.readBinary(tfile);
        const res = await this.uploadBufferToServer(
          buf,
          tfile.name,
          'application/octet-stream',
          Boolean(options.uploadToProtected)
        );

        uploadedPairs.push({
          tfile,
          removeItem: {
            source: 'local',
            name: tfile.name,
            ext: tfile.extension.toLowerCase(),
            displayPath: tfile.path,
            rawObj: tfile
          },
          keepItem: {
            source: 'remote',
            name: res.filename,
            ext: getExt(res.filename),
            displayPath: `${res.year}/${res.month}/${res.filename}`,
            rawObj: res
          }
        });
      } catch (err) {
        new Notice(`❌ Upload failed (${tfile.name}): ${err.message}`);
      }
    }

    if (uploadedPairs.length === 0) {
      if (onDone) onDone();
      return;
    }

    // Rewrite all notes for uploaded attachments across vault
    const allDocs = this.app.vault
      .getFiles()
      .filter(
        (f) =>
          (f.extension === 'md' || f.extension === 'canvas') &&
          !f.name.startsWith('Unused_Files_Report_') &&
          !f.name.startsWith('Duplicate_Files_Report_')
      );

    let modifiedDocsCount = 0;
    for (const doc of allDocs) {
      const origContent = await this.app.vault.read(doc);
      let newContent = origContent;
      for (const { removeItem, keepItem } of uploadedPairs) {
        newContent = this.rewriteContentLinks(newContent, removeItem, keepItem);
      }
      if (newContent !== origContent) {
        await this.app.vault.modify(doc, newContent);
        modifiedDocsCount++;
      }
    }

    // Verification Gate: confirm zero remaining references before moving to trash
    let trashedCount = 0;
    if (options.deleteLocalAfter) {
      const postSnapshot = await this.buildVaultReferenceSnapshot();
      for (const { tfile } of uploadedPairs) {
        const remaining = this.findReferencingNotesForLocalFile(tfile, postSnapshot);
        if (remaining.length === 0) {
          await this.app.vault.trash(tfile, true).catch(() => {});
          trashedCount++;
        }
      }
    }

    new Notice(
      `🎉 Batch migration complete! Successfully uploaded ${uploadedPairs.length} file(s), safely updated links in ${modifiedDocsCount} note(s)${options.deleteLocalAfter ? `, removed ${trashedCount} local file(s)` : ''}!`
    );
    if (onDone) onDone();
  }

  /**
   * Migrates all local attachments in active note to cloud with zero-broken-link safety
   */
  async migrateActiveNoteAttachments() {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile || activeFile.extension !== 'md') {
      new Notice('Please open a Markdown note first.');
      return;
    }

    let content = await this.app.vault.read(activeFile);
    const wikiRegex = /!\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g;
    const mdLinkRegex = /!\[([^\]]*)\]\((?!https?:\/\/)([^)]+)\)/g;

    const localFilesToMigrate = new Map(); // path -> TFile
    let m;
    while ((m = wikiRegex.exec(content)) !== null) {
      const tf = this.app.metadataCache.getFirstLinkpathDest(m[1].trim(), activeFile.path);
      if (tf && isAttachmentExt(tf.extension)) {
        localFilesToMigrate.set(tf.path, tf);
      }
    }
    while ((m = mdLinkRegex.exec(content)) !== null) {
      const tf = this.app.metadataCache.getFirstLinkpathDest(
        decodeURIComponent(m[2].trim()),
        activeFile.path
      );
      if (tf && isAttachmentExt(tf.extension)) {
        localFilesToMigrate.set(tf.path, tf);
      }
    }

    if (localFilesToMigrate.size === 0) {
      new Notice('No local attachments found to migrate in active note.');
      return;
    }

    let migratedCount = 0;
    for (const [, tfile] of localFilesToMigrate.entries()) {
      try {
        const buf = await this.app.vault.readBinary(tfile);
        const res = await this.uploadBufferToServer(buf, tfile.name);

        const removeItem = {
          source: 'local',
          name: tfile.name,
          ext: tfile.extension.toLowerCase(),
          displayPath: tfile.path,
          rawObj: tfile
        };
        const keepItem = {
          source: 'remote',
          name: res.filename,
          ext: getExt(res.filename),
          displayPath: `${res.year}/${res.month}/${res.filename}`,
          rawObj: res
        };

        content = this.rewriteContentLinks(content, removeItem, keepItem);
        migratedCount++;
      } catch (err) {
        new Notice(`❌ Failed to migrate ${tfile.name}: ${err.message}`);
      }
    }

    if (migratedCount > 0) {
      await this.app.vault.modify(activeFile, content);
      if (this.settings.deleteLocalAfterMigrate) {
        const snapshot = await this.buildVaultReferenceSnapshot();
        for (const [, tfile] of localFilesToMigrate.entries()) {
          const otherRefs = this.findReferencingNotesForLocalFile(tfile, snapshot);
          if (otherRefs.length === 0) {
            await this.app.vault.trash(tfile, true).catch(() => {});
          }
        }
      }
      new Notice(`🎉 Safely migrated ${migratedCount} local attachment(s) in active note to cloud links!`);
    }
  }

  async copyActiveNoteForAstro() {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile || activeFile.extension !== 'md') {
      new Notice('Please open a Markdown note first.');
      return;
    }
    const content = await this.app.vault.read(activeFile);
    const converted = content.replace(
      /\/[a-zA-Z0-9_-]+\/((?:protected|\d{4})\/(?:keep|\d{2})\/[^.)\s]+)\.(png|jpg|jpeg|webp|gif|avif|heic|heif|tif|tiff|bmp|jfif)/gi,
      '/pub/$1.webp'
    );
    await navigator.clipboard.writeText(converted);
    new Notice('✅ Copied active note text with Astro public watermarked links to clipboard!');
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class FileMasterSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: '📦 FileMaster Settings' });

    // 1. Server Connection
    containerEl.createEl('h3', { text: '🌐 1. Remote Server Connection' });

    new Setting(containerEl)
      .setName('Server URL')
      .setDesc('Hostname and port of your FileMaster Server (e.g. http://localhost:3000)')
      .addText((text) =>
        text
          .setPlaceholder('http://localhost:3000')
          .setValue(this.plugin.settings.serverUrl)
          .onChange(async (value) => {
            this.plugin.settings.serverUrl = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('API Token')
      .setDesc('Secret API token configured in server config.yaml')
      .addText((text) =>
        text
          .setPlaceholder('filemaster-api-token-888')
          .setValue(this.plugin.settings.apiToken)
          .onChange(async (value) => {
            this.plugin.settings.apiToken = value.trim();
            await this.plugin.saveSettings();
          })
      )
      .addButton((btn) =>
        btn.setButtonText('⚡ Test Connection').onClick(async () => {
          try {
            const list = await this.plugin.fetchRemoteFileList();
            new Notice(`✅ Connection successful! Server currently hosts ${list.length} asset(s).`);
          } catch (err) {
            new Notice(`❌ Connection failed: ${err.message}`);
          }
        })
      );

    // 2. Clipboard Monitoring & Storage Strategy
    containerEl.createEl('h3', { text: '📋 2. Clipboard & Storage Strategy' });

    new Setting(containerEl)
      .setName('Enable Clipboard and Drag-and-Drop Monitoring')
      .setDesc('Listens for paste (Ctrl/Cmd+V) and file drop events in the editor')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enableClipboardMonitor).onChange(async (value) => {
          this.plugin.settings.enableClipboardMonitor = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('1. Save Location Strategy')
      .setDesc('Destination routing when attachments are pasted or dropped into notes')
      .addDropdown((drop) =>
        drop
          .addOption('ask', 'Prompt each time (Ask whether to save locally or to cloud)')
          .addOption('remote', 'Automatically upload to remote server')
          .addOption('local', 'Automatically save to local vault')
          .setValue(this.plugin.settings.saveLocationMode)
          .onChange(async (value) => {
            this.plugin.settings.saveLocationMode = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('2. File Renaming Strategy')
      .setDesc('Rule used to name new attachments (Keep original -> Auto-rename -> Prompt)')
      .addDropdown((drop) =>
        drop
          .addOption('keep', '1. Keep original filename (Default)')
          .addOption('rule', '2. Auto-rename with pattern (Configure template below)')
          .addOption('prompt', '3. Prompt for custom name every time')
          .setValue(this.plugin.settings.namingMode)
          .onChange(async (value) => {
            this.plugin.settings.namingMode = value;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    if (this.plugin.settings.namingMode === 'rule') {
      new Setting(containerEl)
        .setName('Auto-Rename Pattern Template')
        .setDesc(
          'Variables: {note} Note title, {origin} Original name, {date} YYYYMMDD, {time} HHMMSS, {timestamp} Unix epoch, {rand:4} Random hex, {hash:8} SHA-256 hash'
        )
        .addText((text) =>
          text
            .setPlaceholder('{note}_{date}_{rand:4}')
            .setValue(this.plugin.settings.namingPattern)
            .onChange(async (value) => {
              this.plugin.settings.namingPattern = value.trim() || '{origin}';
              await this.plugin.saveSettings();
            })
        );
    }

    // 3. Deletion Protection & Excluded Directories
    containerEl.createEl('h3', { text: '🛡️ 3. Deletion Protection & Directory Exemptions' });

    new Setting(containerEl)
      .setName('Excluded Local Folders')
      .setDesc('Comma-separated directory paths (e.g. templates, assets/protected). You can also right-click any folder in the file tree to toggle exclusion.')
      .addText((text) =>
        text
          .setPlaceholder('templates, assets/protected')
          .setValue(this.plugin.settings.excludedLocalFolders)
          .onChange(async (value) => {
            this.plugin.settings.excludedLocalFolders = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Auto-Exempt Remote Locked & protected/keep Files')
      .setDesc('Automatically skip deletion-locked and protected folder files in orphan scans, and lock them as keep targets in deduplication.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.excludeLockedRemoteFiles).onChange(async (value) => {
          this.plugin.settings.excludeLockedRemoteFiles = value;
          await this.plugin.saveSettings();
        })
      );

    // 4. Wizard Shortcuts
    containerEl.createEl('h3', { text: '🧭 4. Asset Health & Wizard Shortcuts' });

    new Setting(containerEl)
      .setName('Unused Files Wizard (Orphan Finder)')
      .setDesc('Step-by-step scanner with thumbnail previews, deletion protection, and report generation.')
      .addButton((btn) =>
        btn
          .setButtonText('🧹 Launch Orphan Wizard')
          .setCta()
          .onClick(() => new OrphanWizardModal(this.app, this.plugin).open())
      );

    new Setting(containerEl)
      .setName('Duplicate Files Wizard (Duplicate Finder)')
      .setDesc('Cross-vault SHA-256 deduplication with zero broken links verification and report generation.')
      .addButton((btn) =>
        btn
          .setButtonText('🔍 Launch Duplicate Wizard')
          .setCta()
          .onClick(() => new DuplicateWizardModal(this.app, this.plugin).open())
      );

    new Setting(containerEl)
      .setName('Batch Cloud Migration Wizard')
      .setDesc('Batch-migrate local vault attachments to remote cloud storage with automatic link rewriting.')
      .addButton((btn) =>
        btn
          .setButtonText('☁️ Launch Migration Wizard')
          .setCta()
          .onClick(() => new BatchMigrateWizardModal(this.app, this.plugin).open())
      );
  }
}

module.exports = FileMasterPlugin;
