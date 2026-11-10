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

function computeSha256Pure(bytes) {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  const l = bytes.length;
  const bitLen = l * 8;
  const padLen = (l % 64 < 56) ? (56 - (l % 64)) : (120 - (l % 64));
  const totalLen = l + padLen + 8;
  const msg = new Uint8Array(totalLen);
  msg.set(bytes, 0);
  msg[l] = 0x80;

  const view = new DataView(msg.buffer);
  view.setUint32(totalLen - 4, bitLen >>> 0, false);
  view.setUint32(totalLen - 8, Math.floor(bitLen / 0x100000000), false);

  const w = new Uint32Array(64);
  const rotr = (n, x) => (x >>> n) | (x << (32 - n));

  for (let i = 0; i < totalLen; i += 64) {
    for (let j = 0; j < 16; j++) {
      w[j] = view.getUint32(i + j * 4, false);
    }
    for (let j = 16; j < 64; j++) {
      const s0 = rotr(7, w[j - 15]) ^ rotr(18, w[j - 15]) ^ (w[j - 15] >>> 3);
      const s1 = rotr(17, w[j - 2]) ^ rotr(19, w[j - 2]) ^ (w[j - 2] >>> 10);
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let j = 0; j < 64; j++) {
      const s1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + K[j] + w[j]) >>> 0;
      const s0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((x) => x.toString(16).padStart(8, '0')).join('');
}

async function computeSha256Hex(input) {
  if (!input) return '';
  let buffer = null;
  let uint8 = null;
  if (input instanceof ArrayBuffer) {
    buffer = input;
    uint8 = new Uint8Array(input);
  } else if (ArrayBuffer.isView(input)) {
    buffer = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
    uint8 = new Uint8Array(buffer);
  } else if (typeof input === 'string') {
    uint8 = new TextEncoder().encode(input);
    buffer = uint8.buffer;
  }
  if (!buffer || !uint8) return '';

  if (typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.digest) {
    try {
      const hashBuf = await crypto.subtle.digest('SHA-256', buffer);
      const bytes = new Uint8Array(hashBuf);
      let hex = '';
      for (let i = 0; i < bytes.length; i++) {
        hex += bytes[i].toString(16).padStart(2, '0');
      }
      return hex;
    } catch {}
  }
  return computeSha256Pure(uint8);
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

  const localPathTargets = new Set();
  const localNameTargets = new Set();
  const remoteUrlTargets = new Set();
  const remotePathTargets = new Set();

  if (removeItem.source === 'local') {
    const disp = (removeItem.displayPath || '').replace(/^\.?\//, '').toLowerCase();
    const name = (removeItem.name || '').toLowerCase();
    if (disp) {
      localPathTargets.add(disp);
      try {
        localPathTargets.add(decodeURIComponent(disp));
        localPathTargets.add(encodeURI(disp).toLowerCase());
      } catch {}
    }
    if (name) {
      localNameTargets.add(name);
      try {
        localNameTargets.add(decodeURIComponent(name));
        localNameTargets.add(encodeURIComponent(name).toLowerCase());
      } catch {}
    }
  } else {
    const r = removeItem.rawObj || {};
    if (r.rawUrl) remoteUrlTargets.add(r.rawUrl.toLowerCase());
    if (r.pubUrl) remoteUrlTargets.add(r.pubUrl.toLowerCase());
    const year = r.year || removeItem.year;
    const month = r.month || removeItem.month;
    const fname = (removeItem.filename || removeItem.name || '').toLowerCase();
    if (year && month && fname) {
      const p1 = `${year}/${month}/${fname}`.toLowerCase();
      remotePathTargets.add(p1);
      try {
        remotePathTargets.add(decodeURIComponent(p1));
        remotePathTargets.add(`${year}/${month}/${encodeURIComponent(fname)}`.toLowerCase());
      } catch {}
    }
  }

  let bodyChanged = false;
  const updatedLines = lines.map((line) => {
    const lineMatch = line.match(/^([a-zA-Z0-9_\-]+:\s*)(.*)$/);
    if (!lineMatch) return line;

    const prefix = lineMatch[1];
    const val = lineMatch[2].trim();
    if (!val) return line;

    let rawRef = val;
    const mdImg = val.match(/^!?\[[^\]]*\]\(([^)]+)\)$/);
    if (mdImg) rawRef = mdImg[1].trim();

    const wikiM = rawRef.match(/^!?\[\[([^\]|#]+)/);
    if (wikiM) rawRef = wikiM[1].trim();

    const cleanRef = rawRef.replace(/^\.?\//, '').trim();
    const cleanRefLower = cleanRef.toLowerCase();
    let decodedRefLower = cleanRefLower;
    try { decodedRefLower = decodeURIComponent(cleanRefLower); } catch {}

    const isUrl = /^https?:\/\//i.test(cleanRef);
    const hasPathSlash = cleanRef.includes('/');

    let isMatch = false;

    if (removeItem.source === 'local') {
      if (isUrl) {
        isMatch = false;
      } else if (hasPathSlash) {
        // Full path matching: prevents attachments/b/diagram.png from matching attachments/a/diagram.png
        isMatch = localPathTargets.has(cleanRefLower) || localPathTargets.has(decodedRefLower);
      } else {
        // Bare filename without path (e.g. [[diagram.png]])
        isMatch = localNameTargets.has(cleanRefLower) || localNameTargets.has(decodedRefLower);
      }
    } else {
      // removeItem.source === 'remote'
      if (isUrl) {
        if (remoteUrlTargets.has(cleanRefLower) || remoteUrlTargets.has(decodedRefLower)) {
          isMatch = true;
        } else {
          try {
            const u = new URL(cleanRef);
            const pathPart = u.pathname.replace(/^\/(?:raw|pub)\//i, '').replace(/^\//, '').toLowerCase();
            let decodedPathPart = pathPart;
            try { decodedPathPart = decodeURIComponent(pathPart); } catch {}
            if (remotePathTargets.has(pathPart) || remotePathTargets.has(decodedPathPart)) {
              const r = removeItem.rawObj || {};
              const targetUrl = r.rawUrl || r.pubUrl;
              if (targetUrl) {
                const targetU = new URL(targetUrl);
                if (u.origin.toLowerCase() === targetU.origin.toLowerCase()) {
                  isMatch = true;
                }
              }
            }
          } catch {}
        }
      } else if (hasPathSlash) {
        const p = cleanRefLower.replace(/^(?:raw|pub)\//, '');
        const decP = decodedRefLower.replace(/^(?:raw|pub)\//, '');
        isMatch = remotePathTargets.has(p) || remotePathTargets.has(decP);
      } else {
        isMatch = false;
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
