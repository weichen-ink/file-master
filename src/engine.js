/**
 * Transcodes HEIC/HEIF/TIFF buffers into browser-renderable JPEG Blob URLs.
 * Standard images render immediately via browser Blob URL;
 * Special raw formats (HEIC/TIFF) delegate safely to FileMaster Server transcode API (/api/image/preview-transcode).
 */
async function convertBufferToPreviewUrl(arrayBuffer, ext = 'heic', plugin = null) {
  const cleanExt = String(ext || '').toLowerCase();
  if (!NEEDS_TRANSCODE_IMAGE_EXTS.has(cleanExt)) {
    const blob = new Blob([arrayBuffer], { type: `image/${cleanExt === 'jpg' ? 'jpeg' : cleanExt}` });
    return URL.createObjectURL(blob);
  }

  // Delegate transcoding to FileMaster Server (/api/image/preview-transcode) using safe requestUrl
  if (plugin && plugin.settings?.serverUrl && plugin.settings?.apiToken) {
    const url = `${plugin.getCleanServerUrl()}/api/image/preview-transcode`;
    const { boundary, arrayBuffer: bodyBuffer } = buildMultipartBuffer(
      arrayBuffer,
      `preview.${cleanExt}`,
      'application/octet-stream'
    );
    const response = await requestUrl({
      url,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${plugin.settings.apiToken}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      },
      body: bodyBuffer,
      throw: false
    });
    if (response.status >= 200 && response.status < 300 && response.arrayBuffer) {
      const blob = new Blob([response.arrayBuffer], { type: 'image/jpeg' });
      return URL.createObjectURL(blob);
    }
  }

  throw new Error('No remote HEIC/TIFF decoder available');
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
  if (e === 'md' || e === 'excalidraw') return 'note';
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

async function computeSha256Hex(input) {
  if (!input) return '';
  let buffer = null;
  if (input instanceof ArrayBuffer) {
    buffer = input;
  } else if (ArrayBuffer.isView(input)) {
    buffer = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
  } else if (typeof input === 'string') {
    buffer = new TextEncoder().encode(input).buffer;
  }
  if (!buffer) return '';

  if (typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.digest) {
    const hashBuf = await crypto.subtle.digest('SHA-256', buffer);
    const bytes = new Uint8Array(hashBuf);
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
      hex += bytes[i].toString(16).padStart(2, '0');
    }
    return hex;
  }
  return '';
}

function getRandomHex(len = 4) {
  const bytesCount = Math.ceil(len / 2);
  const bytes = new Uint8Array(bytesCount);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytesCount; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex.slice(0, len);
}

function normalizePosixPath(filePath) {
  if (!filePath) return '';
  const isAbsolute = filePath.startsWith('/');
  const segments = filePath.split('/');
  const stack = [];
  for (const seg of segments) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (stack.length > 0 && stack[stack.length - 1] !== '..') {
        stack.pop();
      } else if (!isAbsolute) {
        stack.push('..');
      }
    } else {
      stack.push(seg);
    }
  }
  const joined = stack.join('/');
  return isAbsolute ? `/${joined}` : (joined || '.');
}

function compareSemver(v1, v2) {
  const p1 = String(v1 || '0.0.0').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const p2 = String(v2 || '0.0.0').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((p1[i] || 0) > (p2[i] || 0)) return 1;
    if ((p1[i] || 0) < (p2[i] || 0)) return -1;
  }
  return 0;
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatDateYMD(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
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
 * Checks if a file is an auto-generated inspection report
 */
function isReportFile(filename) {
  const name = String(filename || '');
  return (
    name.startsWith('Unused_Files_Report_') ||
    name.startsWith('Duplicate_Files_Report_') ||
    name.startsWith('Broken_Links_Report_') ||
    name.startsWith('Vault_Analytics_Report_') ||
    name.startsWith('Batch_Migrate_Report_')
  );
}

/**
 * Pure analytics engine for Vault Wrapped & Storage Analytics Dashboard
 */
function computeVaultStatsFromEntries(vaultFiles, docTexts, remoteImages = []) {
  let noteCount = 0;
  let canvasCount = 0;
  let totalWords = 0;
  let totalInternalLinks = 0;
  let localImageCount = 0;
  let localImageBytes = 0;
  let localAudioCount = 0;
  let localAudioBytes = 0;
  let localOtherCount = 0;
  let localOtherBytes = 0;
  const attachmentList = [];

  for (const f of vaultFiles || []) {
    if (isReportFile(f.name)) continue;
    const ext = String(f.extension || getExt(f.name)).toLowerCase();
    const size = f.stat?.size ?? f.size ?? 0;

    if (ext === 'md' || ext === 'excalidraw') {
      noteCount++;
    } else if (ext === 'canvas') {
      canvasCount++;
    } else if (isAttachmentExt(ext)) {
      const grp = getFileTypeGroup(ext);
      if (grp === 'image') {
        localImageCount++;
        localImageBytes += size;
      } else if (grp === 'audio') {
        localAudioCount++;
        localAudioBytes += size;
      } else {
        localOtherCount++;
        localOtherBytes += size;
      }
      attachmentList.push({
        name: f.name,
        path: f.path || f.name,
        ext,
        group: grp,
        size,
        source: 'local'
      });
    }
  }

  for (const text of docTexts || []) {
    const str = String(text || '');
    // Count CJK characters + Latin/numeric words
    const cjkMatches = str.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g);
    const wordMatches = str.replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, ' ').match(/[a-zA-Z0-9_]+/g);
    totalWords += (cjkMatches ? cjkMatches.length : 0) + (wordMatches ? wordMatches.length : 0);

    const wikiMatches = str.match(/!?\[\[[^\]\r\n]+\]\]/g);
    const mdMatches = str.match(/!?\[[^\]\r\n]*\]\([^)\r\n]+\)/g);
    totalInternalLinks += (wikiMatches ? wikiMatches.length : 0) + (mdMatches ? mdMatches.length : 0);
  }

  let remoteTotalCount = 0;
  let remoteRawBytes = 0;
  let remoteCacheBytes = 0;
  let remoteLockedCount = 0;

  for (const r of remoteImages || []) {
    remoteTotalCount++;
    remoteRawBytes += Number(r.size) || 0;
    remoteCacheBytes += Number(r.cacheSize) || 0;
    if (r.locked || r.inProtectedFolder) remoteLockedCount++;
    attachmentList.push({
      name: r.filename,
      path: `${r.year}/${r.month}/${r.filename}`,
      ext: String(r.ext || '').replace(/^\./, ''),
      group: r.category || 'image',
      size: Number(r.size) || 0,
      source: 'remote'
    });
  }

  const topLargestAttachments = [...attachmentList]
    .sort((a, b) => b.size - a.size)
    .slice(0, 8);

  const localTotalBytes = localImageBytes + localAudioBytes + localOtherBytes;
  const localTotalCount = localImageCount + localAudioCount + localOtherCount;

  return {
    noteCount,
    canvasCount,
    totalWords,
    totalInternalLinks,
    local: {
      totalCount: localTotalCount,
      totalBytes: localTotalBytes,
      imageCount: localImageCount,
      imageBytes: localImageBytes,
      audioCount: localAudioCount,
      audioBytes: localAudioBytes,
      otherCount: localOtherCount,
      otherBytes: localOtherBytes
    },
    remote: {
      totalCount: remoteTotalCount,
      rawBytes: remoteRawBytes,
      cacheBytes: remoteCacheBytes,
      lockedCount: remoteLockedCount
    },
    topLargestAttachments
  };
}

/**
 * Resolves WikiLink target note or attachment against vault index
 */
function resolveWikiTarget(target, docPath, vaultIndex) {
  if (!target) return true;
  let decoded = target;
  try {
    decoded = decodeURIComponent(target);
  } catch {}

  const candidates = [target, decoded];
  for (const c of candidates) {
    if (vaultIndex.paths.has(c) || vaultIndex.paths.has(c + '.md')) return true;
    if (vaultIndex.names.has(c)) return true;
    if (vaultIndex.basenames.has(c)) return true;

    // Check relative to current document folder
    const docDir = docPath.includes('/') ? docPath.substring(0, docPath.lastIndexOf('/')) : '';
    if (docDir) {
      const rel = normalizePosixPath(`${docDir}/${c}`).replace(/^(\.\/)+/, '').replace(/^\/+/, '');
      if (vaultIndex.paths.has(rel) || vaultIndex.paths.has(rel + '.md')) return true;
    }
  }
  return false;
}

/**
 * Resolves standard markdown file/image target against vault index
 */
function resolveLocalMarkdownTarget(target, docPath, vaultIndex) {
  if (!target) return true;
  let decoded = target;
  try {
    decoded = decodeURIComponent(target);
  } catch {}

  const candidates = [target, decoded];
  for (const c of candidates) {
    const clean = c.startsWith('/') ? c.slice(1) : c;
    if (vaultIndex.paths.has(clean)) return true;
    if (vaultIndex.paths.has(clean + '.md')) return true;

    // Check relative to current document folder
    const docDir = docPath.includes('/') ? docPath.substring(0, docPath.lastIndexOf('/')) : '';
    if (docDir) {
      const rel = normalizePosixPath(`${docDir}/${clean}`).replace(/^(\.\/)+/, '').replace(/^\/+/, '');
      if (vaultIndex.paths.has(rel) || vaultIndex.paths.has(rel + '.md')) return true;
    }

    const fileName = clean.split('/').pop();
    if (vaultIndex.names.has(fileName)) return true;
  }
  return false;
}

/**
 * Scans markdown text content for broken WikiLinks and missing local markdown files
 */
function scanNoteContentForBrokenLinks(docPath, rawText, vaultIndex, options = {}) {
  const issues = [];
  if (!rawText) return issues;

  // 1. Check WikiLinks: ![[...]] and [[...]]
  if (options.checkWikiLinks !== false) {
    const wikiRegex = /(!?)\[\[([^\]\n\r]+)\]\]/g;
    let m;
    while ((m = wikiRegex.exec(rawText)) !== null) {
      const isEmbed = Boolean(m[1]);
      const rawInside = m[2].trim();
      const targetPart = rawInside.split(/[|#]/)[0].trim();
      if (!targetPart) continue; // Same-page anchor [[#heading]]

      if (!resolveWikiTarget(targetPart, docPath, vaultIndex)) {
        const prefix = rawText.substring(0, m.index);
        const lineNumber = prefix.split('\n').length;
        const lineStart = prefix.lastIndexOf('\n') + 1;
        let lineEnd = rawText.indexOf('\n', m.index);
        if (lineEnd === -1) lineEnd = rawText.length;
        const lineText = rawText.substring(lineStart, lineEnd).trim();

        issues.push({
          type: isEmbed ? 'wikilink-embed' : 'wikilink',
          category: 'wikilink',
          sourcePath: docPath,
          target: targetPart,
          rawText: m[0],
          line: lineNumber,
          lineText,
          reason: isEmbed ? 'Embedded attachment not found in vault' : 'Linked note not found in vault'
        });
      }
    }
  }

  // 2. Check Standard Markdown Links: ![alt](url) and [alt](url)
  const mdRegex = /(!?)\[([^\]\r\n]*)\]\((\s*<[^>]+>|[^\s)]+)(?:\s+["'][^"']*["'])?\)/g;
  let m;
  while ((m = mdRegex.exec(rawText)) !== null) {
    const isEmbed = Boolean(m[1]);
    let rawUrl = m[3].trim();
    if (rawUrl.startsWith('<') && rawUrl.endsWith('>')) {
      rawUrl = rawUrl.slice(1, -1).trim();
    }
    if (rawUrl.startsWith('#')) continue; // In-page anchor
    if (/^(?:mailto:|obsidian:|tel:|data:)/i.test(rawUrl)) continue;

    if (/^(?:https?|ftp):\/\//i.test(rawUrl)) {
      if (options.checkRemote) {
        const prefix = rawText.substring(0, m.index);
        const lineNumber = prefix.split('\n').length;
        const lineStart = prefix.lastIndexOf('\n') + 1;
        let lineEnd = rawText.indexOf('\n', m.index);
        if (lineEnd === -1) lineEnd = rawText.length;
        const lineText = rawText.substring(lineStart, lineEnd).trim();

        issues.push({
          type: isEmbed ? 'remote-embed' : 'remote-link',
          category: 'remote',
          sourcePath: docPath,
          target: rawUrl,
          rawText: m[0],
          line: lineNumber,
          lineText,
          reason: 'Remote resource unreachable'
        });
      }
    } else if (options.checkLocalMarkdown !== false) {
      const cleanTarget = rawUrl.split(/[?#]/)[0].trim();
      if (!cleanTarget) continue;

      if (!resolveLocalMarkdownTarget(cleanTarget, docPath, vaultIndex)) {
        const prefix = rawText.substring(0, m.index);
        const lineNumber = prefix.split('\n').length;
        const lineStart = prefix.lastIndexOf('\n') + 1;
        let lineEnd = rawText.indexOf('\n', m.index);
        if (lineEnd === -1) lineEnd = rawText.length;
        const lineText = rawText.substring(lineStart, lineEnd).trim();

        issues.push({
          type: isEmbed ? 'local-embed' : 'local-link',
          category: 'local',
          sourcePath: docPath,
          target: cleanTarget,
          rawText: m[0],
          line: lineNumber,
          lineText,
          reason: isEmbed ? 'Embedded local file missing at path' : 'Target document missing at path'
        });
      }
    }
  }

  return issues;
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
    return getRandomHex(l);
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
 * Detects whether text content belongs to an Excalidraw drawing file
 * Checks frontmatter (excalidraw-plugin: parsed/raw or excalidraw: true)
 * as well as body markers (# Excalidraw Data, ## Embedded Files).
 */
function isExcalidrawContent(content) {
  if (typeof content !== 'string' || !content) return false;
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (fmMatch) {
    const fm = fmMatch[1];
    if (
      /^\s*excalidraw-plugin:\s*(?:parsed|raw)\b/im.test(fm) ||
      /^\s*excalidraw:\s*true\b/im.test(fm)
    ) {
      return true;
    }
  }
  return (
    /^#+\s+Excalidraw Data\b/im.test(content) ||
    (content.includes('## Embedded Files') && content.includes('## Text Elements')) ||
    (content.includes('## Embedded files') && content.includes('## Text elements'))
  );
}

/**
 * Checks whether a document references a local file without substring false-positives
 * (e.g., "1.png" must not falsely match "21.png" or "my_1.png").
 */
function doesDocumentReferenceLocalFile(rawText, decodedText, tfile, isNoteOrExcalidraw = false) {
  if (!tfile) return false;
  const name = String(tfile.name || '');
  const baseName = String(tfile.basename || getBaseName(name));
  const relPath = String(tfile.path || name);

  const stripRemoteUrls = (str) =>
    String(str || '')
      .replace(/!?\[[^\]]*\]\(https?:\/\/[^)]+\)/gi, '')
      .replace(/https?:\/\/[^\s)"'\]>]+/gi, '');

  const localRaw = stripRemoteUrls(rawText);
  const localDecoded = decodedText ? stripRemoteUrls(decodedText) : localRaw;

  if (
    isNoteOrExcalidraw &&
    baseName &&
    (localRaw.includes(`[[${baseName}]]`) ||
      localRaw.includes(`[[${baseName}|`) ||
      localRaw.includes(`[[${baseName}#`) ||
      localDecoded.includes(`[[${baseName}]]`) ||
      localDecoded.includes(`[[${baseName}|`) ||
      localDecoded.includes(`[[${baseName}#`))
  ) {
    return true;
  }

  // Fast pre-filter before running boundary regex
  if (
    !localRaw.includes(name) &&
    !localDecoded.includes(name) &&
    !localRaw.includes(relPath) &&
    !localDecoded.includes(relPath)
  ) {
    return false;
  }

  const targets = relPath && relPath !== name ? [relPath, name] : [name];
  for (const target of targets) {
    if (!target) continue;
    const esc = escapeRegExp(target);
    const boundaryRe = new RegExp(`(?:^|[\\[\\(<"':/\\\\\\s])${esc}(?:$|[\\]\\)>"'|#?\\s])`, 'i');
    if (boundaryRe.test(localRaw) || boundaryRe.test(localDecoded)) {
      return true;
    }
  }
  return false;
}

/**
 * Checks whether a file is an Excalidraw drawing note regardless of extension.
 * Handles .excalidraw.md, .excalidraw, frontmatter cache, and file content.
 */
function isExcalidrawFile(file, app = null, content = null) {
  if (!file) return false;
  const name = String(file.name || '');
  const ext = String(file.extension || getExt(name)).toLowerCase();
  if (name.endsWith('.excalidraw.md') || ext === 'excalidraw') {
    return true;
  }
  if (app && app.metadataCache && typeof app.metadataCache.getFileCache === 'function') {
    const cache = app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter;
    if (fm && (fm['excalidraw-plugin'] || fm['excalidraw'] === true || (Array.isArray(fm['tags']) && fm['tags'].includes('excalidraw')))) {
      return true;
    }
  }
  if (typeof content === 'string') {
    return isExcalidrawContent(content);
  }
  return false;
}

/**
 * Checks whether a file is a document/note (Markdown, Canvas, or Excalidraw)
 */
function isDocFile(file, app = null) {
  if (!file) return false;
  const ext = String(file.extension || getExt(file.name)).toLowerCase();
  return ext === 'md' || ext === 'canvas' || ext === 'excalidraw' || isExcalidrawFile(file, app);
}

/**
 * Rewrites image/asset links inside Excalidraw's '## Embedded Files' section.
 * Excalidraw requires bare URLs (e.g. '<fileId>: https://...'), whereas Markdown bracket
 * syntax '[alt](url)' breaks Excalidraw parser and renders grey boxes.
 */
function rewriteExcalidrawEmbeddedFiles(content, removeItem, keepItem) {
  if (typeof content !== 'string' || !content) return content;

  const sectionRegex = /(^##\s+Embedded [Ff]iles\s*?\r?\n)([\s\S]*?)(?=(?:\r?\n## |\r?\n%%|\r?\n# |$))/m;
  const match = sectionRegex.exec(content);
  if (!match) return content;

  const header = match[1];
  const sectionBody = match[2];
  const lines = sectionBody.split(/\r?\n/);

  const localTargets = new Set();
  const remoteTargets = new Set();

  if (removeItem.source === 'local') {
    if (removeItem.name) localTargets.add(removeItem.name.toLowerCase());
    if (removeItem.displayPath) localTargets.add(removeItem.displayPath.toLowerCase());
    try {
      if (removeItem.name) {
        localTargets.add(decodeURIComponent(removeItem.name).toLowerCase());
        localTargets.add(encodeURIComponent(removeItem.name).toLowerCase());
      }
      if (removeItem.displayPath) {
        localTargets.add(decodeURIComponent(removeItem.displayPath).toLowerCase());
        localTargets.add(encodeURI(removeItem.displayPath).toLowerCase());
      }
    } catch {}
  } else {
    const r = removeItem.rawObj || {};
    if (r.rawUrl) remoteTargets.add(r.rawUrl);
    if (r.pubUrl) remoteTargets.add(r.pubUrl);
    const fname = removeItem.filename || removeItem.name;
    if (fname) {
      remoteTargets.add(fname);
      try {
        remoteTargets.add(decodeURIComponent(fname));
        remoteTargets.add(encodeURIComponent(fname));
      } catch {}
    }
    const year = r.year || removeItem.year;
    const month = r.month || removeItem.month;
    if (year && month && fname) {
      remoteTargets.add(`${year}/${month}/${fname}`);
      remoteTargets.add(`${year}/${month}/${encodeURIComponent(fname)}`);
    }
  }

  let bodyChanged = false;
  const updatedLines = lines.map((line) => {
    const lineMatch = line.match(/^([a-zA-Z0-9_\-]+:\s*)(.*)$/);
    if (!lineMatch) return line;

    const prefix = lineMatch[1];
    const val = lineMatch[2].trim();
    if (!val) return line;

    let isMatch = false;

    // Strip markdown image wrapper if any: ![](target)
    let rawRef = val;
    const mdImg = val.match(/^!?\[[^\]]*\]\(([^)]+)\)$/);
    if (mdImg) rawRef = mdImg[1].trim();

    // Strip wikilink wrapper if any: ![[target]] or [[target]]
    const wikiM = rawRef.match(/^!?\[\[([^\]|#]+)/);
    if (wikiM) rawRef = wikiM[1].trim();

    const cleanRef = rawRef.replace(/^\.\//, '').toLowerCase();
    let decodedRef = cleanRef;
    try { decodedRef = decodeURIComponent(cleanRef); } catch {}

    let baseName = cleanRef.split('/').pop();
    let decodedBaseName = decodedRef.split('/').pop();

    if (/^https?:\/\//i.test(rawRef)) {
      try {
        const u = new URL(rawRef);
        const p = u.pathname.replace(/^\//, '').toLowerCase();
        baseName = p.split('/').pop();
        try { decodedBaseName = decodeURIComponent(baseName); } catch {}
      } catch {}
    }

    if (removeItem.source === 'local') {
      if (
        localTargets.has(cleanRef) ||
        localTargets.has(decodedRef) ||
        localTargets.has(baseName) ||
        localTargets.has(decodedBaseName)
      ) {
        isMatch = true;
      }
    } else {
      if (
        remoteTargets.has(val) ||
        remoteTargets.has(rawRef) ||
        remoteTargets.has(cleanRef) ||
        remoteTargets.has(decodedRef) ||
        remoteTargets.has(baseName) ||
        remoteTargets.has(decodedBaseName)
      ) {
        isMatch = true;
      }
    }

    if (!isMatch) return line;

    bodyChanged = true;
    if (keepItem.source === 'remote') {
      return `${prefix}${keepItem.rawObj.rawUrl}`;
    } else {
      return `${prefix}[[${keepItem.displayPath}]]`;
    }
  });

  if (!bodyChanged) return content;

  const newSection = header + updatedLines.join('\n');
  return content.slice(0, match.index) + newSection + content.slice(match.index + match[0].length);
}
