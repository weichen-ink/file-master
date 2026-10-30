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
    name.startsWith('Vault_Analytics_Report_')
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

    if (ext === 'md') {
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
      const rel = path.posix.normalize(`${docDir}/${c}`).replace(/^(\.\/)+/, '');
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
      const rel = path.posix.normalize(`${docDir}/${clean}`).replace(/^(\.\/)+/, '');
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

  // 2. Check Standard Markdown Links: ![alt](url) and [alt](url)
  const mdRegex = /(!?)\[([^\]\r\n]*)\]\((\s*<[^>]+>|[^\s)]+)(?:\s+["'][^"']*["'])?\)/g;
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
    } else {
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
