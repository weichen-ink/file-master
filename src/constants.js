const {
  Plugin,
  PluginSettingTab,
  Setting,
  Notice,
  Modal,
  requestUrl,
  MarkdownView,
  ItemView,
  setIcon,
  TFile,
  getLanguage
} = require('obsidian');
const crypto = require('crypto');
const path = require('path');

const DEFAULT_SETTINGS = {
  language: 'auto', // 'auto' | 'zh' | 'en'
  enableRemoteServer: false,
  serverVerified: false,
  serverUrl: 'http://localhost:3000',
  apiToken: 'filemaster-api-token-888',
  enableSidebarButton: true,
  enableClipboardMonitor: true,
  saveLocationMode: 'ask', // 'remote' | 'local' | 'ask'
  namingMode: 'keep',      // 'keep' (keep original) | 'rule' (auto-rename pattern) | 'prompt' (manual rename modal)
  namingPattern: '{note}_{date}_{rand:4}',
  uploadNonImageAttachments: true,
  insertOptimizedLinkOnUpload: false,
  deleteLocalAfterMigrate: true,
  excludedLocalFolders: 'templates, assets/protected',
  excludeLockedRemoteFiles: true
};

const MIN_SERVER_VERSION = '1.0.0';
const VIEW_TYPE_REMOTE_GALLERY = 'file-master-remote-gallery';

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
