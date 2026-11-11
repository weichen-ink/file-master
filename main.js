// src/plugin.js
var import_obsidian29 = require("obsidian");

// src/constants.js
var DEFAULT_SETTINGS = {
  language: "auto",
  // 'auto' | 'zh' | 'en'
  enableRemoteServer: false,
  serverVerified: false,
  serverUrl: "http://localhost:3000",
  apiToken: "",
  enableSidebarButton: true,
  enableClipboardMonitor: true,
  saveLocationMode: "ask",
  // 'remote' | 'local' | 'ask'
  defaultSaveLocation: "remote",
  // 'remote' | 'local' (default preselected destination when asking)
  namingMode: "keep",
  // 'keep' (keep original) | 'rule' (auto-rename pattern) | 'prompt' (manual rename modal)
  namingPattern: "{note}_{date}_{rand:4}",
  uploadNonImageAttachments: true,
  insertOptimizedLinkOnUpload: false,
  galleryInsertFormat: null,
  // migrate once from upload preference, then remain independent
  deleteLocalAfterMigrate: true,
  excludedLocalFolders: "",
  excludeLockedRemoteFiles: true
};
var MIN_SERVER_VERSION = "1.1.0";
var displayVersion = (version) => String(version || "").replace(/^(\d+\.\d+)\.0$/, "$1");
var VIEW_TYPE_REMOTE_GALLERY = "file-master-remote-gallery";
var IMAGE_EXTS = /* @__PURE__ */ new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "avif",
  "svg",
  "heic",
  "heif",
  "bmp",
  "tif",
  "tiff",
  "ico",
  "jfif",
  "pjpeg",
  "pjp",
  "apng",
  "raw",
  "cr2",
  "nef",
  "arw",
  "dng",
  "orf",
  "rw2"
]);
var NEEDS_TRANSCODE_IMAGE_EXTS = /* @__PURE__ */ new Set(["heic", "heif", "tif", "tiff"]);
var AUDIO_EXTS = /* @__PURE__ */ new Set([
  "mp3",
  "m4a",
  "wav",
  "ogg",
  "oga",
  "flac",
  "aac",
  "wma",
  "opus",
  "amr",
  "mid",
  "midi",
  "aiff",
  "aif",
  "ape",
  "alac",
  "m4b",
  "caf"
]);
var OTHER_EXTS = /* @__PURE__ */ new Set([
  "pdf",
  "mp4",
  "webm",
  "mov",
  "mkv",
  "avi",
  "flv",
  "wmv",
  "m4v",
  "3gp",
  "mpeg",
  "mpg",
  "ts",
  "mts",
  "m2ts",
  "ogv",
  "rm",
  "rmvb",
  "zip",
  "tar",
  "gz",
  "tgz",
  "7z",
  "rar",
  "bz2",
  "xz",
  "zst",
  "lz4",
  "dmg",
  "iso",
  "pkg",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "csv",
  "tsv",
  "rtf",
  "txt",
  "odt",
  "ods",
  "odp",
  "pages",
  "numbers",
  "key",
  "epub",
  "mobi",
  "azw",
  "azw3",
  "djvu",
  "chm",
  "psd",
  "psb",
  "ai",
  "eps",
  "ind",
  "indd",
  "fig",
  "sketch",
  "xd",
  "cdr",
  "dwg",
  "dxf",
  "stl",
  "obj",
  "fbx",
  "blend",
  "glb",
  "gltf",
  "xmind",
  "mm",
  "drawio",
  "vsdx",
  "json",
  "yaml",
  "yml",
  "xml",
  "toml",
  "ini",
  "conf",
  "log",
  "sql",
  "db",
  "sqlite",
  "sqlite3",
  "ipynb",
  "ics",
  "vcf",
  "srt",
  "ass",
  "vtt",
  "ttf",
  "otf",
  "woff",
  "woff2",
  "apk",
  "ipa",
  "exe",
  "msi",
  "deb",
  "rpm"
]);
var OBSIDIAN_NOTE_EXTS = /* @__PURE__ */ new Set(["md", "canvas", "base", "excalidraw"]);
var ALL_ATTACHMENT_EXTS = /* @__PURE__ */ new Set([...IMAGE_EXTS, ...AUDIO_EXTS, ...OTHER_EXTS]);
function isAttachmentExt(ext) {
  const e = String(ext || "").toLowerCase();
  return Boolean(e) && !OBSIDIAN_NOTE_EXTS.has(e);
}

// src/engine.js
var import_obsidian = require("obsidian");
async function convertBufferToPreviewUrl(arrayBuffer, ext = "heic", plugin = null) {
  var _a, _b;
  const cleanExt = String(ext || "").toLowerCase();
  if (!NEEDS_TRANSCODE_IMAGE_EXTS.has(cleanExt)) {
    const blob = new Blob([arrayBuffer], { type: `image/${cleanExt === "jpg" ? "jpeg" : cleanExt}` });
    return URL.createObjectURL(blob);
  }
  if (plugin && ((_a = plugin.settings) == null ? void 0 : _a.serverUrl) && ((_b = plugin.settings) == null ? void 0 : _b.apiToken)) {
    const url = `${plugin.getCleanServerUrl()}/api/image/preview-transcode`;
    const { boundary, arrayBuffer: bodyBuffer } = buildMultipartBuffer(
      arrayBuffer,
      `preview.${cleanExt}`,
      "application/octet-stream"
    );
    const response = await (0, import_obsidian.requestUrl)({
      url,
      method: "POST",
      headers: {
        Authorization: `Bearer ${plugin.settings.apiToken}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`
      },
      body: bodyBuffer,
      throw: false
    });
    if (response.status >= 200 && response.status < 300 && response.arrayBuffer) {
      const blob = new Blob([response.arrayBuffer], { type: "image/jpeg" });
      return URL.createObjectURL(blob);
    }
  }
  throw new Error("No remote HEIC/TIFF decoder available");
}
function getExt(filename) {
  const idx = String(filename || "").lastIndexOf(".");
  return idx > -1 ? filename.slice(idx + 1).toLowerCase() : "";
}
function getBaseName(filename) {
  const idx = String(filename || "").lastIndexOf(".");
  return idx > -1 ? filename.slice(0, idx) : String(filename || "");
}
function getFileTypeGroup(ext) {
  const e = String(ext || "").toLowerCase();
  if (e === "md" || e === "excalidraw") return "note";
  if (IMAGE_EXTS.has(e)) return "image";
  if (AUDIO_EXTS.has(e)) return "audio";
  return "other";
}
function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(i > 1 ? 2 : 1) + " " + sizes[i];
}
function computeSha256Pure(bytes) {
  const K = [
    1116352408,
    1899447441,
    3049323471,
    3921009573,
    961987163,
    1508970993,
    2453635748,
    2870763221,
    3624381080,
    310598401,
    607225278,
    1426881987,
    1925078388,
    2162078206,
    2614888103,
    3248222580,
    3835390401,
    4022224774,
    264347078,
    604807628,
    770255983,
    1249150122,
    1555081692,
    1996064986,
    2554220882,
    2821834349,
    2952996808,
    3210313671,
    3336571891,
    3584528711,
    113926993,
    338241895,
    666307205,
    773529912,
    1294757372,
    1396182291,
    1695183700,
    1986661051,
    2177026350,
    2456956037,
    2730485921,
    2820302411,
    3259730800,
    3345764771,
    3516065817,
    3600352804,
    4094571909,
    275423344,
    430227734,
    506948616,
    659060556,
    883997877,
    958139571,
    1322822218,
    1537002063,
    1747873779,
    1955562222,
    2024104815,
    2227730452,
    2361852424,
    2428436474,
    2756734187,
    3204031479,
    3329325298
  ];
  let h0 = 1779033703, h1 = 3144134277, h2 = 1013904242, h3 = 2773480762;
  let h4 = 1359893119, h5 = 2600822924, h6 = 528734635, h7 = 1541459225;
  const l = bytes.length;
  const bitLen = l * 8;
  const padLen = l % 64 < 56 ? 56 - l % 64 : 120 - l % 64;
  const totalLen = l + padLen + 8;
  const msg = new Uint8Array(totalLen);
  msg.set(bytes, 0);
  msg[l] = 128;
  const view = new DataView(msg.buffer);
  view.setUint32(totalLen - 4, bitLen >>> 0, false);
  view.setUint32(totalLen - 8, Math.floor(bitLen / 4294967296), false);
  const w = new Uint32Array(64);
  const rotr = (n, x) => x >>> n | x << 32 - n;
  for (let i = 0; i < totalLen; i += 64) {
    for (let j = 0; j < 16; j++) {
      w[j] = view.getUint32(i + j * 4, false);
    }
    for (let j = 16; j < 64; j++) {
      const s0 = rotr(7, w[j - 15]) ^ rotr(18, w[j - 15]) ^ w[j - 15] >>> 3;
      const s1 = rotr(17, w[j - 2]) ^ rotr(19, w[j - 2]) ^ w[j - 2] >>> 10;
      w[j] = w[j - 16] + s0 + w[j - 7] + s1 >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let j = 0; j < 64; j++) {
      const s1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
      const ch = e & f ^ ~e & g;
      const temp1 = h + s1 + ch + K[j] + w[j] >>> 0;
      const s0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
      const maj = a & b ^ a & c ^ b & c;
      const temp2 = s0 + maj >>> 0;
      h = g;
      g = f;
      f = e;
      e = d + temp1 >>> 0;
      d = c;
      c = b;
      b = a;
      a = temp1 + temp2 >>> 0;
    }
    h0 = h0 + a >>> 0;
    h1 = h1 + b >>> 0;
    h2 = h2 + c >>> 0;
    h3 = h3 + d >>> 0;
    h4 = h4 + e >>> 0;
    h5 = h5 + f >>> 0;
    h6 = h6 + g >>> 0;
    h7 = h7 + h >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((x) => x.toString(16).padStart(8, "0")).join("");
}
async function computeSha256Hex(input) {
  if (!input) return "";
  let buffer = null;
  let uint8 = null;
  if (input instanceof ArrayBuffer) {
    buffer = input;
    uint8 = new Uint8Array(input);
  } else if (ArrayBuffer.isView(input)) {
    buffer = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
    uint8 = new Uint8Array(buffer);
  } else if (typeof input === "string") {
    uint8 = new TextEncoder().encode(input);
    buffer = uint8.buffer;
  }
  if (!buffer || !uint8) return "";
  if (typeof crypto !== "undefined" && crypto.subtle && crypto.subtle.digest) {
    try {
      const hashBuf = await crypto.subtle.digest("SHA-256", buffer);
      const bytes = new Uint8Array(hashBuf);
      let hex = "";
      for (let i = 0; i < bytes.length; i++) {
        hex += bytes[i].toString(16).padStart(2, "0");
      }
      return hex;
    } catch (e) {
    }
  }
  return computeSha256Pure(uint8);
}
function getRandomHex(len = 4) {
  const bytesCount = Math.ceil(len / 2);
  const bytes = new Uint8Array(bytesCount);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytesCount; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex.slice(0, len);
}
function normalizePosixPath(filePath) {
  if (!filePath) return "";
  const isAbsolute = filePath.startsWith("/");
  const segments = filePath.split("/");
  const stack = [];
  for (const seg of segments) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (stack.length > 0 && stack[stack.length - 1] !== "..") {
        stack.pop();
      } else if (!isAbsolute) {
        stack.push("..");
      }
    } else {
      stack.push(seg);
    }
  }
  const joined = stack.join("/");
  return isAbsolute ? `/${joined}` : joined || ".";
}
function compareSemver(v1, v2) {
  const p1 = String(v1 || "0.0.0").replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
  const p2 = String(v2 || "0.0.0").replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((p1[i] || 0) > (p2[i] || 0)) return 1;
    if ((p1[i] || 0) < (p2[i] || 0)) return -1;
  }
  return 0;
}
function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function formatDateTimestamp(date = /* @__PURE__ */ new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const d = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const t2 = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `${d}_${t2}`;
}
function sanitizeCleanBaseName(str, fallback = "file") {
  return String(str || "").replace(/[\/\\?%*:|"<>#\0]/g, "_").replace(/[\s()[\]]+/g, "_").replace(/_+/g, "_").trim() || fallback;
}
function isReportFile(filename) {
  const raw = String(filename || "");
  const name = raw.includes("/") ? raw.split("/").pop() : raw.includes("\\") ? raw.split("\\").pop() : raw;
  return name.startsWith("Unused_Files_Report_") || name.startsWith("Duplicate_Files_Report_") || name.startsWith("Broken_Links_Report_") || name.startsWith("Vault_Analytics_Report_") || name.startsWith("Batch_Migrate_Report_");
}
var VIDEO_EXTS = /* @__PURE__ */ new Set(["mp4", "webm", "mov", "mkv", "avi", "flv", "wmv", "m4v"]);
var DOC_EXTS = /* @__PURE__ */ new Set(["pdf", "epub", "docx", "xlsx", "pptx", "doc", "xls", "ppt", "txt"]);
function getDetailedTypeGroup(ext) {
  const e = String(ext || "").toLowerCase();
  if (IMAGE_EXTS.has(e)) return "image";
  if (VIDEO_EXTS.has(e)) return "video";
  if (AUDIO_EXTS.has(e)) return "audio";
  if (DOC_EXTS.has(e)) return "doc";
  return "other";
}
function computeVaultStatsFromEntries(vaultFiles, docTexts, remoteImages = []) {
  var _a, _b, _c;
  let noteCount = 0;
  let canvasCount = 0;
  let totalWords = 0;
  let totalInternalLinks = 0;
  let localImageCount = 0;
  let localImageBytes = 0;
  let localVideoCount = 0;
  let localVideoBytes = 0;
  let localAudioCount = 0;
  let localAudioBytes = 0;
  let localDocCount = 0;
  let localDocBytes = 0;
  let localOtherCount = 0;
  let localOtherBytes = 0;
  const attachmentList = [];
  for (const f of vaultFiles || []) {
    if (isReportFile(f.name)) continue;
    const ext = String(f.extension || getExt(f.name)).toLowerCase();
    const size = (_c = (_b = (_a = f.stat) == null ? void 0 : _a.size) != null ? _b : f.size) != null ? _c : 0;
    if (ext === "md" || ext === "excalidraw") {
      noteCount++;
    } else if (ext === "canvas") {
      canvasCount++;
    } else if (isAttachmentExt(ext)) {
      const detailedGrp = getDetailedTypeGroup(ext);
      if (detailedGrp === "image") {
        localImageCount++;
        localImageBytes += size;
      } else if (detailedGrp === "audio") {
        localAudioCount++;
        localAudioBytes += size;
      } else if (detailedGrp === "video") {
        localVideoCount++;
        localVideoBytes += size;
        localOtherCount++;
        localOtherBytes += size;
      } else if (detailedGrp === "doc") {
        localDocCount++;
        localDocBytes += size;
        localOtherCount++;
        localOtherBytes += size;
      } else {
        localOtherCount++;
        localOtherBytes += size;
      }
      attachmentList.push({
        name: f.name,
        path: f.path || f.name,
        ext,
        group: detailedGrp,
        size,
        source: "local"
      });
    }
  }
  for (const text of docTexts || []) {
    const str = String(text || "");
    const cjkMatches = str.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g);
    const wordMatches = str.replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, " ").match(/[a-zA-Z0-9_]+/g);
    totalWords += (cjkMatches ? cjkMatches.length : 0) + (wordMatches ? wordMatches.length : 0);
    const wikiMatches = str.match(/!?\[\[[^\]\r\n]+\]\]/g);
    const mdMatches = str.match(/!?\[[^\]\r\n]*\]\([^)\r\n]+\)/g);
    totalInternalLinks += (wikiMatches ? wikiMatches.length : 0) + (mdMatches ? mdMatches.length : 0);
  }
  let remoteTotalCount = 0;
  let remoteRawBytes = 0;
  let remoteCacheBytes = 0;
  let remoteLockedCount = 0;
  let remoteCachedCount = 0;
  for (const r of remoteImages || []) {
    remoteTotalCount++;
    remoteRawBytes += Number(r.size) || 0;
    const cacheSize = Number(r.cacheSize) || 0;
    remoteCacheBytes += cacheSize;
    if (cacheSize > 0) remoteCachedCount++;
    if (r.locked || r.inProtectedFolder) remoteLockedCount++;
    const ext = String(r.ext || "").replace(/^\./, "").toLowerCase();
    attachmentList.push({
      name: r.filename,
      path: `${r.year}/${r.month}/${r.filename}`,
      ext,
      group: getDetailedTypeGroup(ext),
      size: Number(r.size) || 0,
      source: "remote"
    });
  }
  const topLargestAttachments = [...attachmentList].sort((a, b) => b.size - a.size).slice(0, 20);
  const combinedDocText = (docTexts || []).join("\n");
  for (const item of topLargestAttachments) {
    const rawName = item.name;
    const base = String(item.name || "").replace(/\.[^.]+$/, "");
    item.isReferenced = combinedDocText.includes(rawName) || combinedDocText.includes(encodeURIComponent(rawName)) || base.length >= 3 && combinedDocText.includes(`[[${base}`);
  }
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
      videoCount: localVideoCount,
      videoBytes: localVideoBytes,
      audioCount: localAudioCount,
      audioBytes: localAudioBytes,
      docCount: localDocCount,
      docBytes: localDocBytes,
      otherCount: localOtherCount,
      otherBytes: localOtherBytes
    },
    remote: {
      totalCount: remoteTotalCount,
      rawBytes: remoteRawBytes,
      cacheBytes: remoteCacheBytes,
      lockedCount: remoteLockedCount,
      cachedCount: remoteCachedCount
    },
    topLargestAttachments
  };
}
function resolveWikiTarget(target, docPath, vaultIndex) {
  if (!target) return true;
  let decoded = target;
  try {
    decoded = decodeURIComponent(target);
  } catch (e) {
  }
  const candidates = [target, decoded];
  for (const c of candidates) {
    if (vaultIndex.paths.has(c) || vaultIndex.paths.has(c + ".md")) return true;
    if (vaultIndex.names.has(c)) return true;
    if (vaultIndex.basenames.has(c)) return true;
    const docDir = docPath.includes("/") ? docPath.substring(0, docPath.lastIndexOf("/")) : "";
    if (docDir) {
      const rel = normalizePosixPath(`${docDir}/${c}`).replace(/^(\.\/)+/, "").replace(/^\/+/, "");
      if (vaultIndex.paths.has(rel) || vaultIndex.paths.has(rel + ".md")) return true;
    }
  }
  return false;
}
function resolveLocalMarkdownTarget(target, docPath, vaultIndex) {
  if (!target) return true;
  let decoded = target;
  try {
    decoded = decodeURIComponent(target);
  } catch (e) {
  }
  const candidates = [target, decoded];
  for (const c of candidates) {
    const clean = c.startsWith("/") ? c.slice(1) : c;
    if (vaultIndex.paths.has(clean)) return true;
    if (vaultIndex.paths.has(clean + ".md")) return true;
    const docDir = docPath.includes("/") ? docPath.substring(0, docPath.lastIndexOf("/")) : "";
    if (docDir) {
      const rel = normalizePosixPath(`${docDir}/${clean}`).replace(/^(\.\/)+/, "").replace(/^\/+/, "");
      if (vaultIndex.paths.has(rel) || vaultIndex.paths.has(rel + ".md")) return true;
    }
    const fileName = clean.split("/").pop();
    if (vaultIndex.names.has(fileName)) return true;
  }
  return false;
}
function scanNoteContentForBrokenLinks(docPath, rawText, vaultIndex, options = {}) {
  const issues = [];
  if (!rawText) return issues;
  if (options.checkWikiLinks !== false) {
    const wikiRegex = /(!?)\[\[([^\]\n\r]+)\]\]/g;
    let m2;
    while ((m2 = wikiRegex.exec(rawText)) !== null) {
      const isEmbed = Boolean(m2[1]);
      const rawInside = m2[2].trim();
      const targetPart = rawInside.split(/[|#]/)[0].trim();
      if (!targetPart) continue;
      if (!resolveWikiTarget(targetPart, docPath, vaultIndex)) {
        const prefix = rawText.substring(0, m2.index);
        const lineNumber = prefix.split("\n").length;
        const lineStart = prefix.lastIndexOf("\n") + 1;
        let lineEnd = rawText.indexOf("\n", m2.index);
        if (lineEnd === -1) lineEnd = rawText.length;
        const lineText = rawText.substring(lineStart, lineEnd).trim();
        issues.push({
          type: isEmbed ? "wikilink-embed" : "wikilink",
          category: "wikilink",
          sourcePath: docPath,
          target: targetPart,
          rawText: m2[0],
          line: lineNumber,
          lineText,
          reason: isEmbed ? "Embedded attachment not found in vault" : "Linked note not found in vault"
        });
      }
    }
  }
  const mdRegex = /(!?)\[([^\]\r\n]*)\]\((\s*<[^>]+>|[^\s)]+)(?:\s+["'][^"']*["'])?\)/g;
  let m;
  while ((m = mdRegex.exec(rawText)) !== null) {
    const isEmbed = Boolean(m[1]);
    let rawUrl = m[3].trim();
    if (rawUrl.startsWith("<") && rawUrl.endsWith(">")) {
      rawUrl = rawUrl.slice(1, -1).trim();
    }
    if (rawUrl.startsWith("#")) continue;
    if (/^(?:mailto:|obsidian:|tel:|data:)/i.test(rawUrl)) continue;
    if (/^(?:https?|ftp):\/\//i.test(rawUrl)) {
      if (options.checkRemote) {
        const prefix = rawText.substring(0, m.index);
        const lineNumber = prefix.split("\n").length;
        const lineStart = prefix.lastIndexOf("\n") + 1;
        let lineEnd = rawText.indexOf("\n", m.index);
        if (lineEnd === -1) lineEnd = rawText.length;
        const lineText = rawText.substring(lineStart, lineEnd).trim();
        issues.push({
          type: isEmbed ? "remote-embed" : "remote-link",
          category: "remote",
          sourcePath: docPath,
          target: rawUrl,
          rawText: m[0],
          line: lineNumber,
          lineText,
          reason: "Remote resource unreachable"
        });
      }
    } else if (options.checkLocalMarkdown !== false) {
      const cleanTarget = rawUrl.split(/[?#]/)[0].trim();
      if (!cleanTarget) continue;
      if (!resolveLocalMarkdownTarget(cleanTarget, docPath, vaultIndex)) {
        const prefix = rawText.substring(0, m.index);
        const lineNumber = prefix.split("\n").length;
        const lineStart = prefix.lastIndexOf("\n") + 1;
        let lineEnd = rawText.indexOf("\n", m.index);
        if (lineEnd === -1) lineEnd = rawText.length;
        const lineText = rawText.substring(lineStart, lineEnd).trim();
        issues.push({
          type: isEmbed ? "local-embed" : "local-link",
          category: "local",
          sourcePath: docPath,
          target: cleanTarget,
          rawText: m[0],
          line: lineNumber,
          lineText,
          reason: isEmbed ? "Embedded local file missing at path" : "Target document missing at path"
        });
      }
    }
  }
  return issues;
}
function applyNamingPattern(pattern, { noteName, originBase, sha256 }) {
  const now = /* @__PURE__ */ new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const timeStr = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const timestamp = String(Math.floor(now.getTime() / 1e3));
  let result = String(pattern || "{origin}");
  result = result.replace(/\{note\}/gi, noteName || "note");
  result = result.replace(/\{origin\}/gi, originBase || "file");
  result = result.replace(/\{date\}/gi, dateStr);
  result = result.replace(/\{time\}/gi, timeStr);
  result = result.replace(/\{timestamp\}/gi, timestamp);
  result = result.replace(/\{hash(?::(\d+))?\}/gi, (_, len) => {
    const l = Math.min(64, Math.max(4, Number(len) || 8));
    return (sha256 || "").slice(0, l);
  });
  result = result.replace(/\{rand(?::(\d+))?\}/gi, (_, len) => {
    const l = Math.min(16, Math.max(2, Number(len) || 4));
    return getRandomHex(l);
  });
  return sanitizeCleanBaseName(result, `file_${timestamp}`);
}
function buildMultipartBuffer(fileBytes, filename, mimeType = "application/octet-stream") {
  const boundary = "----FileMasterBoundary" + Date.now().toString(16);
  const enc = new TextEncoder();
  const safeName = String(filename || "file.png").replace(/"/g, "_");
  const headerStr = `--${boundary}\r
Content-Disposition: form-data; name="file"; filename="${safeName}"\r
Content-Type: ${mimeType}\r
\r
`;
  const footerStr = `\r
--${boundary}--\r
`;
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
function isExcalidrawContent(content) {
  if (typeof content !== "string" || !content) return false;
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (fmMatch) {
    const fm = fmMatch[1];
    if (/^\s*excalidraw-plugin:\s*(?:parsed|raw)\b/im.test(fm) || /^\s*excalidraw:\s*true\b/im.test(fm)) {
      return true;
    }
  }
  return /^#+\s+Excalidraw Data\b/im.test(content) || content.includes("## Embedded Files") && content.includes("## Text Elements") || content.includes("## Embedded files") && content.includes("## Text elements");
}
function isExcalidrawFile(file, app = null, content = null) {
  if (!file) return false;
  const name = String(file.name || "");
  const ext = String(file.extension || getExt(name)).toLowerCase();
  if (name.endsWith(".excalidraw.md") || ext === "excalidraw") {
    return true;
  }
  if (app && app.metadataCache && typeof app.metadataCache.getFileCache === "function") {
    const cache = app.metadataCache.getFileCache(file);
    const fm = cache == null ? void 0 : cache.frontmatter;
    if (fm && (fm["excalidraw-plugin"] || fm["excalidraw"] === true || Array.isArray(fm["tags"]) && fm["tags"].includes("excalidraw"))) {
      return true;
    }
  }
  if (typeof content === "string") {
    return isExcalidrawContent(content);
  }
  return false;
}
function isDocFile(file, app = null) {
  if (!file) return false;
  const ext = String(file.extension || getExt(file.name)).toLowerCase();
  return ext === "md" || ext === "canvas" || ext === "excalidraw" || isExcalidrawFile(file, app);
}
function rewriteExcalidrawEmbeddedFiles(content, removeItem, keepItem, context = {}) {
  if (typeof content !== "string" || !content) return content;
  const sectionRegex = /(^##\s+Embedded [Ff]iles\s*?\r?\n)([\s\S]*?)(?=(?:\r?\n## |\r?\n%%|\r?\n# |$))/m;
  const match = sectionRegex.exec(content);
  if (!match) return content;
  const header = match[1];
  const sectionBody = match[2];
  const lines = sectionBody.split(/\r?\n/);
  const localPathTargets = /* @__PURE__ */ new Set();
  const localNameTargets = /* @__PURE__ */ new Set();
  const remoteUrlTargets = /* @__PURE__ */ new Set();
  const remotePathTargets = /* @__PURE__ */ new Set();
  if (removeItem.source === "local") {
    const disp = (removeItem.displayPath || "").replace(/^\.?\//, "").toLowerCase();
    const name = (removeItem.name || "").toLowerCase();
    if (disp) {
      localPathTargets.add(disp);
      try {
        localPathTargets.add(decodeURIComponent(disp));
        localPathTargets.add(encodeURI(disp).toLowerCase());
      } catch (e) {
      }
    }
    if (name) {
      localNameTargets.add(name);
      try {
        localNameTargets.add(decodeURIComponent(name));
        localNameTargets.add(encodeURIComponent(name).toLowerCase());
      } catch (e) {
      }
    }
  } else {
    const r = removeItem.rawObj || {};
    if (r.rawUrl) {
      const u1 = r.rawUrl.toLowerCase();
      remoteUrlTargets.add(u1);
      remoteUrlTargets.add(u1.split(/[?#]/)[0]);
    }
    if (r.pubUrl) {
      const u2 = r.pubUrl.toLowerCase();
      remoteUrlTargets.add(u2);
      remoteUrlTargets.add(u2.split(/[?#]/)[0]);
    }
    const year = r.year || removeItem.year;
    const month = r.month || removeItem.month;
    const fname = (removeItem.filename || removeItem.name || "").toLowerCase();
    if (year && month && fname) {
      const p1 = `${year}/${month}/${fname}`.toLowerCase();
      remotePathTargets.add(p1);
      try {
        remotePathTargets.add(decodeURIComponent(p1));
        remotePathTargets.add(`${year}/${month}/${encodeURIComponent(fname)}`.toLowerCase());
      } catch (e) {
      }
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
    const cleanRef = rawRef.replace(/^\.?\//, "").trim();
    const cleanRefLower = cleanRef.toLowerCase();
    let decodedRefLower = cleanRefLower;
    try {
      decodedRefLower = decodeURIComponent(cleanRefLower);
    } catch (e) {
    }
    const isUrl = /^https?:\/\//i.test(cleanRef);
    const hasPathSlash = cleanRef.includes("/");
    let isMatch = false;
    if (removeItem.source === "local") {
      if (isUrl) {
        isMatch = false;
      } else if (hasPathSlash) {
        isMatch = localPathTargets.has(cleanRefLower) || localPathTargets.has(decodedRefLower);
      } else {
        if (typeof (context == null ? void 0 : context.resolveLink) === "function") {
          const resolved = context.resolveLink(cleanRef);
          if (resolved) {
            const resLower = resolved.toLowerCase().replace(/^\.?\//, "");
            let decodedResLower = resLower;
            try {
              decodedResLower = decodeURIComponent(resLower);
            } catch (e) {
            }
            isMatch = localPathTargets.has(resLower) || localPathTargets.has(decodedResLower);
          } else {
            isMatch = false;
          }
        } else {
          isMatch = localNameTargets.has(cleanRefLower) || localNameTargets.has(decodedRefLower);
        }
      }
    } else {
      const cleanRefWithoutQuery = cleanRefLower.split(/[?#]/)[0];
      const decodedRefWithoutQuery = decodedRefLower.split(/[?#]/)[0];
      if (isUrl) {
        if (remoteUrlTargets.has(cleanRefLower) || remoteUrlTargets.has(decodedRefLower) || remoteUrlTargets.has(cleanRefWithoutQuery) || remoteUrlTargets.has(decodedRefWithoutQuery)) {
          isMatch = true;
        } else {
          try {
            const u = new URL(cleanRef);
            const pathPart = u.pathname.replace(/^\/(?:raw|pub)\//i, "").replace(/^\//, "").toLowerCase();
            let decodedPathPart = pathPart;
            try {
              decodedPathPart = decodeURIComponent(pathPart);
            } catch (e) {
            }
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
          } catch (e) {
          }
        }
      } else if (hasPathSlash) {
        const p = cleanRefWithoutQuery.replace(/^(?:raw|pub)\//, "");
        const decP = decodedRefWithoutQuery.replace(/^(?:raw|pub)\//, "");
        isMatch = remotePathTargets.has(p) || remotePathTargets.has(decP);
      } else {
        isMatch = false;
      }
    }
    if (!isMatch) return line;
    bodyChanged = true;
    if (keepItem.source === "remote") {
      return `${prefix}${keepItem.rawObj.rawUrl}`;
    } else {
      return `${prefix}[[${keepItem.displayPath}]]`;
    }
  });
  if (!bodyChanged) return content;
  const newSection = header + updatedLines.join("\n");
  return content.slice(0, match.index) + newSection + content.slice(match.index + match[0].length);
}

// src/plugin/editor-target.js
var import_obsidian2 = require("obsidian");
function captureInsertionTarget(plugin) {
  var _a, _b, _c, _d, _e, _f;
  const workspace = plugin.app.workspace;
  let view = workspace.getActiveViewOfType(import_obsidian2.MarkdownView);
  const leaves = workspace.getLeavesOfType("markdown");
  if (!view && leaves.some((leaf) => leaf.view === plugin.lastActiveMarkdownView)) view = plugin.lastActiveMarkdownView;
  if (!(view == null ? void 0 : view.file) || view.file.extension !== "md") return null;
  return { view, file: view.file, from: (_b = (_a = view.editor) == null ? void 0 : _a.getCursor) == null ? void 0 : _b.call(_a, "from"), to: (_d = (_c = view.editor) == null ? void 0 : _c.getCursor) == null ? void 0 : _d.call(_c, "to"), content: (_f = (_e = view.editor) == null ? void 0 : _e.getValue) == null ? void 0 : _f.call(_e) };
}
function isInsertionTargetValid(plugin, target) {
  return Boolean(target && plugin.app.workspace.getLeavesOfType("markdown").some((leaf) => leaf.view === target.view) && target.view.file === target.file && plugin.app.vault.getAbstractFileByPath(target.file.path) === target.file);
}
function refreshInsertionTarget(target) {
  var _a, _b, _c, _d, _e, _f;
  target.from = (_b = (_a = target.view.editor) == null ? void 0 : _a.getCursor) == null ? void 0 : _b.call(_a, "from");
  target.to = (_d = (_c = target.view.editor) == null ? void 0 : _c.getCursor) == null ? void 0 : _d.call(_c, "to");
  target.content = (_f = (_e = target.view.editor) == null ? void 0 : _e.getValue) == null ? void 0 : _f.call(_e);
}

// src/i18n.js
var import_obsidian3 = require("obsidian");
var UI_STRINGS = {
  zh: {
    scanExcludedFolders: "\u626B\u63CF\u65F6\u8DF3\u8FC7\uFF1A{folders}",
    catPreferences: "\u5176\u4ED6",
    hubDockGalleryHelp: "\u5C06\u6587\u4EF6\u5E93\u56FA\u5B9A\u5728\u53F3\u4FA7\uFF0C\u968F\u65F6\u9884\u89C8\u548C\u63D2\u5165\u6587\u4EF6",
    hubSettingsHelp: "\u7BA1\u7406\u670D\u52A1\u5668\u8FDE\u63A5\u3001\u4E0A\u4F20\u65B9\u5F0F\u548C\u6587\u4EF6\u547D\u540D",
    remoteTrashTitle: "\u670D\u52A1\u5668\u56DE\u6536\u7AD9",
    remoteTrashHelp: "\u67E5\u770B\u5DF2\u79FB\u9664\u7684\u670D\u52A1\u5668\u6587\u4EF6\uFF0C\u6062\u590D\u540E\u539F\u6709\u94FE\u63A5\u53EF\u7EE7\u7EED\u4F7F\u7528\u3002",
    remoteTrashLoading: "\u6B63\u5728\u8BFB\u53D6\u56DE\u6536\u7AD9\u2026",
    remoteTrashEmpty: "\u56DE\u6536\u7AD9\u4E3A\u7A7A",
    dupEmptyTitle: "\u672A\u53D1\u73B0\u91CD\u590D\u6587\u4EF6",
    dupChooseScopeAgain: "\u91CD\u65B0\u9009\u62E9\u8303\u56F4",
    remoteTrashDelete: "\u6C38\u4E45\u5220\u9664",
    remoteTrashDeleteTitle: "\u6C38\u4E45\u5220\u9664\u8FD9\u4E2A\u6587\u4EF6\uFF1F",
    remoteTrashDeleteConfirm: "\u201C{name}\u201D\u5C06\u4ECE\u670D\u52A1\u5668\u5F7B\u5E95\u5220\u9664\uFF0C\u65E0\u6CD5\u6062\u590D\u3002",
    remoteTrashDeleted: "\u6587\u4EF6\u5DF2\u6C38\u4E45\u5220\u9664",
    remoteTrashRestore: "\u6062\u590D\u6587\u4EF6",
    remoteTrashRestored: "\u6587\u4EF6\u5DF2\u6062\u590D",
    remoteTrashFailed: "\u64CD\u4F5C\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5",
    remoteTrashSessionError: "\u670D\u52A1\u5668\u5C1A\u672A\u652F\u6301\u63D2\u4EF6\u8BBF\u95EE\u56DE\u6536\u7AD9\u3002\u8BF7\u91CD\u542F\u5DF2\u66F4\u65B0\u7684\u670D\u52A1\u7AEF\uFF0C\u518D\u70B9\u51FB\u91CD\u8BD5\u3002",
    remoteTrashAuthError: "\u65E0\u6CD5\u9A8C\u8BC1\u8FDE\u63A5\uFF0C\u8BF7\u5728\u63D2\u4EF6\u8BBE\u7F6E\u4E2D\u68C0\u67E5\u8BBF\u95EE\u4EE4\u724C\u3002",
    previewTrashConfirmTitle: "\u79FB\u5165\u56DE\u6536\u7AD9\uFF1F",
    previewZoomLabel: "\u56FE\u7247\u7F29\u653E",
    galleryLayoutLabel: "\u663E\u793A\u65B9\u5F0F",
    hubBack: "\u8FD4\u56DE",
    hubSettingsUnavailable: "\u65E0\u6CD5\u6253\u5F00\u63D2\u4EF6\u8BBE\u7F6E",
    hubOpenNote: "\u5148\u6253\u5F00\u4E00\u7BC7\u7B14\u8BB0",
    hubConnect: "\u8FDE\u63A5\u670D\u52A1\u5668",
    hubConnectHelp: "\u8BBE\u7F6E\u670D\u52A1\u5668\u5730\u5740\u4E0E\u8BBF\u95EE\u4EE4\u724C",
    hubDockGallery: "\u5728\u4FA7\u680F\u6D4F\u89C8\u670D\u52A1\u5668\u6587\u4EF6",
    galleryPanelUnavailable: "\u65E0\u6CD5\u6253\u5F00\u6587\u4EF6\u4FA7\u680F\uFF0C\u8BF7\u91CD\u8BD5",
    galleryTargetChanged: "\u7B14\u8BB0\u5185\u5BB9\u5DF2\u53D8\u5316\uFF0C\u8BF7\u8FD4\u56DE\u7B14\u8BB0\u9009\u62E9\u63D2\u5165\u4F4D\u7F6E\u540E\u91CD\u8BD5",
    galleryInsertWebp: "\u63D2\u5165 WebP",
    galleryInsertRaw: "\u63D2\u5165\u539F\u6587\u4EF6",
    copyFailed: "\u590D\u5236\u5931\u8D25\uFF0C\u8BF7\u9009\u62E9\u5185\u5BB9\u624B\u52A8\u590D\u5236",
    previewVariant: "\u9884\u89C8\u7248\u672C",
    previewZoomOut: "\u7F29\u5C0F",
    previewZoomIn: "\u653E\u5927",
    previewFit: "\u9002\u5408\u7A97\u53E3",
    previewActualSize: "\u6309\u539F\u59CB\u5C3A\u5BF8\u663E\u793A\uFF08100%\uFF09",
    previewGestures: "\u56FE\u7247\u753B\u5E03\uFF1A\u6EDA\u8F6E\u6216\u53CC\u6307\u7F29\u653E\uFF0C\u62D6\u52A8\u5E73\u79FB\uFF0C\u53CC\u51FB\u9002\u914D",
    previewProperties: "\u6587\u4EF6\u5C5E\u6027",
    previewDimensions: "\u5F53\u524D\u56FE\u50CF\u5206\u8FA8\u7387",
    previewCreated: "\u4E0A\u4F20\u65F6\u95F4",
    previewSource: "\u6765\u6E90",
    previewProtection: "\u5220\u9664\u4FDD\u62A4",
    previewDanger: "\u5371\u9669\u64CD\u4F5C",
    previewTrashHelp: "\u79FB\u5165\u540E\uFF0C\u53EF\u4ECE Hub \u7684\u56DE\u6536\u7AD9\u6062\u590D\u3002",
    previewLoading: "\u6B63\u5728\u52A0\u8F7D\u9884\u89C8\u2026",
    previewLoadFailed: "\u65E0\u6CD5\u52A0\u8F7D\u56FE\u7247\uFF0C\u6587\u4EF6\u94FE\u63A5\u4ECD\u53EF\u590D\u5236",
    previewRetry: "\u91CD\u8BD5",
    pagePrevious: "\u4E0A\u4E00\u9875",
    pageNext: "\u4E0B\u4E00\u9875",
    pageCount: "\u7B2C {current} / {total} \u9875",
    transferIntegrityFailed: "\u5185\u5BB9\u6821\u9A8C\u5931\u8D25\uFF0C\u5DF2\u4FDD\u7559\u539F\u6587\u4EF6\u548C\u94FE\u63A5\uFF0C\u8BF7\u5237\u65B0\u670D\u52A1\u5668\u5217\u8868\u540E\u91CD\u8BD5\u3002",
    transferReferencesChanged: "\u7B14\u8BB0\u5728\u6700\u7EC8\u68C0\u67E5\u540E\u53D1\u751F\u53D8\u5316\uFF0C\u5DF2\u4FDD\u7559\u672C\u5730\u6587\u4EF6\uFF0C\u53EF\u91CD\u8BD5\u672A\u5B8C\u6210\u9879\u3002",
    transferSourceChanged: "\u9644\u4EF6\u5728\u4E0A\u4F20\u671F\u95F4\u53D1\u751F\u53D8\u5316\uFF0C\u5DF2\u4FDD\u7559\u672C\u5730\u6587\u4EF6\u3002",
    transferBusy: "\u53E6\u4E00\u4E2A\u9644\u4EF6\u64CD\u4F5C\u6B63\u5728\u8FDB\u884C\uFF0C\u8BF7\u7B49\u5F85\u5B8C\u6210\u540E\u518D\u8BD5\u3002",
    transferNothingPending: "\u6CA1\u6709\u53EF\u6062\u590D\u7684\u4E0A\u4F20\u4EFB\u52A1\u3002",
    transferServerChanged: "\u670D\u52A1\u5668\u5730\u5740\u5DF2\u66F4\u6539\uFF0C\u8BF7\u5207\u56DE\u539F\u670D\u52A1\u5668\u540E\u6062\u590D\u4E0A\u4F20\u3002",
    cmdResumeUpload: "\u6062\u590D\u672A\u5B8C\u6210\u4E0A\u4F20",
    transferStop: "\u505C\u6B62\u4F20\u8F93",
    transferStopping: "\u6B63\u5728\u505C\u6B62\uFF0C\u5C06\u5B8C\u6210\u5DF2\u4F20\u8F93\u6587\u4EF6\u7684\u94FE\u63A5\u66F4\u65B0\u2026",
    transferCancelled: "\u5DF2\u505C\u6B62\uFF0C\u5DF2\u5B8C\u6210\u7684\u6587\u4EF6\u5DF2\u5904\u7406\u3002",
    transferRetry: "\u91CD\u8BD5\u672A\u5B8C\u6210\u9879",
    noticeRemoteNotReady: "\u8BF7\u5148\u542F\u7528\u670D\u52A1\u5668\u5E76\u6D4B\u8BD5\u8FDE\u63A5\u3002",
    // 快捷控制中心
    hubBadge: "\u6587\u4EF6\u5DE5\u5177",
    hubTitle: "File Master",
    hubSubtitle: "\u544A\u522B\u5197\u4F59\u9644\u4EF6\u4E0E\u5931\u6548\u94FE\u63A5\uFF0C\u4E91\u7AEF\u79D2\u4F20\u52A0\u901F\u3001\u8FC1\u79FB\u540E\u6821\u9A8C\u5F15\u7528\uFF0C\u8BA9\u77E5\u8BC6\u5E93\u59CB\u7EC8\u8F7B\u91CF\u6574\u6D01",
    catFiles: "\u8FDC\u7A0B\u670D\u52A1\u5668",
    catGovernance: "\u4ED3\u5E93\u7BA1\u7406",
    catActiveNote: "\u5F53\u524D\u6587\u4EF6",
    catSettings: "\u8BBE\u7F6E",
    // 向导项
    actHealthTitle: "\u68C0\u67E5\u5931\u6548\u94FE\u63A5",
    actHealthDesc: "\u68C0\u67E5\u7B14\u8BB0\u548C\u767D\u677F\u4E2D\u7F3A\u5931\u7684\u6587\u4EF6\uFF0C\u4EE5\u53CA\u65E0\u6CD5\u8BBF\u95EE\u7684\u7F51\u9875\u94FE\u63A5\u3002",
    actDupTitle: "\u67E5\u627E\u91CD\u590D\u6587\u4EF6",
    actDupDesc: "\u67E5\u627E\u5185\u5BB9\u76F8\u540C\u7684\u6587\u4EF6\uFF0C\u9009\u62E9\u4FDD\u7559\u7684\u526F\u672C\u540E\u66F4\u65B0\u7B14\u8BB0\u5F15\u7528\u3002",
    actOrphanTitle: "\u67E5\u627E\u672A\u5F15\u7528\u6587\u4EF6",
    actOrphanDesc: "\u67E5\u627E\u672A\u88AB\u7B14\u8BB0\u6216\u767D\u677F\u5F15\u7528\u7684\u6587\u4EF6\u3002\u5220\u9664\u524D\u53EF\u9010\u9879\u68C0\u67E5\u3002",
    actMigrateTitle: "\u6279\u91CF\u4E0A\u4F20\u9644\u4EF6",
    actMigrateDesc: "\u5C06\u9009\u5B9A\u76EE\u5F55\u4E2D\u7684\u9644\u4EF6\u4E0A\u4F20\u5230\u670D\u52A1\u5668\uFF0C\u5E76\u66F4\u65B0\u7B14\u8BB0\u4E2D\u7684\u94FE\u63A5\u3002",
    actAnalyticsTitle: "\u4ED3\u5E93\u6982\u89C8",
    actAnalyticsDesc: "\u67E5\u770B\u7B14\u8BB0\u3001\u94FE\u63A5\u548C\u9644\u4EF6\u7684\u6570\u91CF\uFF0C\u4EE5\u53CA\u672C\u5730\u4E0E\u670D\u52A1\u5668\u7684\u5B58\u50A8\u7528\u91CF\u3002",
    actRemoteGalleryTitle: "\u6D4F\u89C8\u670D\u52A1\u5668\u6587\u4EF6",
    actRemoteGalleryDesc: "\u5728 Obsidian \u4E2D\u6D4F\u89C8\u670D\u52A1\u5668\u6587\u4EF6\uFF0C\u590D\u5236\u94FE\u63A5\u6216\u63D2\u5165\u5F53\u524D\u7B14\u8BB0\u3002",
    actRemoteGalleryViewTitle: "\u4FA7\u8FB9\u680F\u6D4F\u89C8",
    actRemoteGalleryViewDesc: "\u5728\u4FA7\u8FB9\u680F\u6D4F\u89C8\u670D\u52A1\u5668\u6587\u4EF6\uFF0C\u5199\u7B14\u8BB0\u65F6\u53EF\u968F\u65F6\u63D2\u5165\u3002",
    // 当前笔记动作
    actNoteUpTitle: "\u4E0A\u4F20\u9644\u4EF6\u5230\u670D\u52A1\u5668",
    actNoteUpDesc: "\u4E0A\u4F20\u5F53\u524D\u7B14\u8BB0\u5F15\u7528\u7684\u672C\u5730\u9644\u4EF6\uFF0C\u5E76\u66F4\u65B0\u94FE\u63A5\u3002",
    actNoteDownTitle: "\u4E0B\u8F7D\u9644\u4EF6\u5230\u672C\u5730",
    actNoteDownDesc: "\u4E0B\u8F7D\u5F53\u524D\u7B14\u8BB0\u5F15\u7528\u7684\u670D\u52A1\u5668\u6587\u4EF6\uFF0C\u5E76\u66F4\u65B0\u4E3A\u672C\u5730\u94FE\u63A5\u3002",
    actNoteAstroTitle: "\u590D\u5236\u5F53\u524D\u7B14\u8BB0\u5168\u6587\uFF08\u66FF\u6362\u4E3A WebP \u94FE\u63A5\uFF09",
    actNoteAstroDesc: "\u590D\u5236\u5F53\u524D\u7B14\u8BB0\u7684\u5185\u5BB9\uFF0C\u5E76\u5C06\u5176\u4E2D\u7684\u539F\u56FE\u94FE\u63A5\u66FF\u6362\u4E3A\u516C\u5F00\u7684 WebP \u94FE\u63A5\u3002",
    actOpenSettingsTitle: "\u63D2\u4EF6\u8BBE\u7F6E",
    actOpenSettingsDesc: "\u8BBE\u7F6E\u8BED\u8A00\u3001\u670D\u52A1\u5668\u8FDE\u63A5\u3001\u9644\u4EF6\u4E0A\u4F20\u548C\u626B\u63CF\u6392\u9664\u76EE\u5F55\u3002",
    // 扫描控制与通用步骤
    stepOf: "\u7B2C {current} / {total} \u6B65",
    btnBack: "\u4E0A\u4E00\u6B65",
    btnCancel: "\u53D6\u6D88",
    btnInsert: "\u63D2\u5165",
    btnNext: "\u4E0B\u4E00\u6B65 \u2794",
    btnSelectAll: "\u5168\u9009\u6216\u53D6\u6D88\u5168\u9009",
    btnExportReport: "\u5BFC\u51FA\u62A5\u544A\u5230\u77E5\u8BC6\u5E93\u6839\u76EE\u5F55",
    btnCancelScan: "\u23F9 \u53D6\u6D88\u626B\u63CF",
    scanCancelled: "\u23F9 \u5DF2\u53D6\u6D88\u626B\u63CF\u4EFB\u52A1",
    scanProgress: "\u23F3 \u6B63\u5728\u626B\u63CF ({current}/{total}): {label}",
    // 新素材保存弹窗 (DestinationModal)
    destBadge: "\u9644\u4EF6\u63D2\u5165",
    destTitle: "\u63D2\u5165\u9644\u4EF6",
    destSubtitle: "\u9009\u62E9\u9644\u4EF6\u5B58\u50A8\u4F4D\u7F6E",
    destTypeSize: "\u7C7B\u578B\uFF1A.{ext}  |  \u5927\u5C0F\uFF1A{size}",
    destFilenameLabel: "\u6587\u4EF6\u540D",
    destFilenameHint: "\u8F93\u5165\u6587\u4EF6\u540D",
    destTargetNote: "\u76EE\u6807\u7B14\u8BB0\uFF1A{note}",
    destDestTitle: "\u5B58\u50A8\u4F4D\u7F6E",
    destRenameTitle: "\u91CD\u547D\u540D",
    destRenameOptional: "\u4FEE\u6539\u6587\u4EF6\u540D\uFF08\u53EF\u9009\uFF09",
    destSaveLocal: "\u{1F4BB} \u672C\u5730\u77E5\u8BC6\u5E93",
    destSaveLocalDesc: "\u4FDD\u5B58\u5728\u672C\u5730\u9644\u4EF6\u6587\u4EF6\u5939",
    destSaveRemote: "\u2601\uFE0F \u8FDC\u7A0B\u670D\u52A1\u5668",
    destSaveRemoteDesc: "\u4E0A\u4F20\u81F3\u8FDC\u7A0B\u670D\u52A1\u5668",
    destInsertSuccess: "\u2705 \u9644\u4EF6\u5DF2\u4FDD\u5B58\u5E76\u63D2\u5165\u7B14\u8BB0",
    destTranscodeTip: "\u23F3 \u6B63\u5728\u89E3\u7801 .{ext} \u9884\u89C8...",
    destTranscodeFail: "\u26A0\uFE0F \u672C\u5730\u9884\u89C8\u6682\u4E0D\u53EF\u7528\uFF1B\u4E0A\u4F20\u65F6\u670D\u52A1\u7AEF\u5C06\u81EA\u52A8\u8F6C\u7801",
    // 孤儿未引用文件向导 (OrphanFinderModal)
    orphanStep1Title: "\u672A\u5F15\u7528\u6587\u4EF6",
    orphanStep1Desc: "\u67E5\u627E\u672A\u5728\u7B14\u8BB0\u6B63\u6587\u3001\u5C5E\u6027\u6216\u767D\u677F\u4E2D\u88AB\u5F15\u7528\u7684\u6587\u4EF6\u3002\u672A\u5F15\u7528\u4E0D\u4EE3\u8868\u53EF\u4EE5\u5220\u9664\u3002",
    orphanLocScope: "1. \u626B\u63CF\u4F4D\u7F6E",
    orphanScanLocal: "\u77E5\u8BC6\u5E93\u6587\u4EF6",
    orphanScanRemote: "\u670D\u52A1\u5668\u6587\u4EF6",
    orphanTypeScope: "2. \u6587\u4EF6\u7C7B\u578B",
    orphanTypeNote: "\u7B14\u8BB0\uFF08.md\uFF0C\u9ED8\u8BA4\u4E0D\u9009\uFF09",
    orphanTypeImage: "\u{1F5BC}\uFE0F \u56FE\u7247\u7D20\u6750 (png, jpg, webp, gif, svg, heic \u7B49)",
    orphanTypeAudio: "\u{1F3B5} \u97F3\u9891\u7D20\u6750 (mp3, m4a, wav, flac \u7B49)",
    orphanTypeOther: "\u{1F4E6} \u5176\u4ED6\u9644\u4EF6 (\u89C6\u9891\u3001PDF\u3001\u538B\u7F29\u5305\u3001\u5404\u7C7B\u6587\u6863)",
    orphanLocRequired: "\u8BF7\u81F3\u5C11\u9009\u62E9\u4E00\u4E2A\u626B\u63CF\u5B58\u50A8\u4F4D\u7F6E\uFF08\u672C\u5730\u6216\u8FDC\u7A0B\uFF09\u3002",
    orphanTypeRequired: "\u8BF7\u81F3\u5C11\u9009\u62E9\u4E00\u79CD\u6587\u4EF6\u7C7B\u578B\u3002",
    orphanScanning: "\u23F3 \u6B63\u5728\u5168\u5E93\u89E3\u6790\u7B14\u8BB0\u5F15\u7528\u5173\u7CFB...",
    orphanStep2Title: "\u627E\u5230 {count} \u4E2A\u672A\u5F15\u7528\u6587\u4EF6",
    orphanNoneFound: "\u6240\u9009\u8303\u56F4\u5185\u6CA1\u6709\u672A\u5F15\u7528\u6587\u4EF6\u3002",
    orphanDeleteSelected: "\u79FB\u5165\u56DE\u6536\u7AD9\uFF08{count}\uFF09",
    orphanDeleteConfirm: "\u5C06\u9009\u4E2D\u7684 {count} \u4E2A\u6587\u4EF6\u79FB\u5165\u56DE\u6536\u7AD9\uFF1F\n\u8BF7\u786E\u8BA4\u8FD9\u4E9B\u6587\u4EF6\u786E\u5B9E\u4E0D\u518D\u9700\u8981\u3002",
    orphanDeleting: "\u6B63\u5728\u79FB\u52A8\u6587\u4EF6...",
    orphanDeleteSuccess: "\u5DF2\u5904\u7406 {count} \u4E2A\u6587\u4EF6\u3002",
    // 重复文件查重向导 (DuplicateFinderModal)
    dupStep1Title: "\u91CD\u590D\u6587\u4EF6",
    dupStep1Desc: "\u6309\u6587\u4EF6\u5185\u5BB9\u67E5\u627E\u5B8C\u5168\u76F8\u540C\u7684\u526F\u672C\uFF0C\u6587\u4EF6\u540D\u53EF\u4EE5\u4E0D\u540C\u3002",
    dupLocScope: "1. \u6BD4\u5BF9\u8303\u56F4",
    dupCompareLocal: "\u4EC5\u77E5\u8BC6\u5E93\u6587\u4EF6",
    dupCompareCross: "\u77E5\u8BC6\u5E93\u4E0E\u670D\u52A1\u5668\u6587\u4EF6",
    dupCompareRemote: "\u4EC5\u670D\u52A1\u5668\u6587\u4EF6",
    dupStrategyLabel: "\u4FDD\u7559\u7B56\u7565\uFF1A",
    dupStrategyAuto: "1. \u81EA\u52A8\u9009\u62E9\u4FDD\u7559\u526F\u672C\uFF08\u63A8\u8350\uFF09",
    dupStrategyPreferRemote: "2. \u4F18\u5148\u4FDD\u7559\u670D\u52A1\u5668\u6587\u4EF6\uFF0C\u6E05\u7406\u672C\u5730\u526F\u672C\uFF08\u77E5\u8BC6\u5E93\u7626\u8EAB\uFF09",
    dupStrategyPreferLocal: "3. \u4F18\u5148\u4FDD\u7559\u672C\u5730\u6587\u4EF6\uFF0C\u6E05\u7406\u670D\u52A1\u5668\u91CD\u590D\u526F\u672C",
    dupGroupHeader: "\u91CD\u590D\u6587\u4EF6\u7EC4 #{idx}\uFF08SHA-256: {hash}... | \u4F53\u79EF: {size}\uFF09",
    dupGroupSubhint: "\u70B9\u51FB\u7F29\u7565\u56FE\u53EF\u653E\u5927\u9884\u89C8\uFF1B\u70B9\u51FB\u5F15\u7528\u6B21\u6570\u53EF\u67E5\u770B\u5173\u8054\u7B14\u8BB0",
    dupTagKeep: "\u2705 \u4FDD\u7559",
    dupTagProtected: "\u{1F512} \u53D7\u4FDD\u62A4",
    dupTagRemove: "\u{1F5D1}\uFE0F \u6E05\u7406",
    dupTypeScope: "2. \u6587\u4EF6\u7C7B\u578B",
    dupTypeImage: "\u{1F5BC}\uFE0F \u56FE\u7247\u7D20\u6750",
    dupTypeAudio: "\u{1F3B5} \u97F3\u9891\u7D20\u6750",
    dupTypeOther: "\u{1F4E6} \u5176\u4ED6\u5A92\u4F53\u4E0E\u9644\u4EF6",
    dupTypeNote: "\u7B14\u8BB0\uFF08.md\uFF0C\u9ED8\u8BA4\u4E0D\u9009\uFF09",
    dupComparing: "\u23F3 \u6B63\u5728\u8BA1\u7B97 SHA-256 \u54C8\u5E0C\u503C\u5E76\u89E3\u6790\u5168\u5E93\u5F15\u7528...",
    dupDesignateKeepTitle: "\u5C06\u6B64\u6587\u4EF6\u8BBE\u4E3A\u4FDD\u7559\u526F\u672C",
    lockBtnText: "\u5F00\u542F\u9632\u5220\u9664\u4FDD\u62A4",
    lockBtnTitle: "\u9632\u6B62\u8BEF\u5220\u6B64\u670D\u52A1\u5668\u6587\u4EF6\uFF0C\u53EF\u968F\u65F6\u89E3\u9664\u4FDD\u62A4",
    dupStep2Title: "\u627E\u5230 {groups} \u7EC4\u91CD\u590D\u6587\u4EF6\uFF0C\u53EF\u6E05\u7406 {redundant} \u4E2A\u526F\u672C",
    dupNoneFound: "\u6240\u9009\u8303\u56F4\u5185\u6CA1\u6709\u91CD\u590D\u6587\u4EF6\u3002",
    dupAutoSelect: "\u9009\u4E2D\u53EF\u6E05\u7406\u7684\u526F\u672C",
    dupMergeRewrite: "\u5408\u5E76\u5E76\u66F4\u65B0\u94FE\u63A5\uFF08{count}\uFF09",
    dupMergeConfirm: "\u5408\u5E76\u9009\u4E2D\u7684 {count} \u4E2A\u526F\u672C\uFF1F\n\u7B14\u8BB0\u4E2D\u6307\u5411\u8FD9\u4E9B\u6587\u4EF6\u7684\u94FE\u63A5\u5C06\u66F4\u65B0\u4E3A\u4FDD\u7559\u526F\u672C\u7684\u94FE\u63A5\u3002",
    dupMerging: "\u6B63\u5728\u5408\u5E76\u6587\u4EF6\u5E76\u66F4\u65B0\u94FE\u63A5...",
    dupMergeSuccess: "\u5DF2\u5408\u5E76 {count} \u4E2A\u91CD\u590D\u6587\u4EF6\u3002",
    // 批量上云迁移向导 (MigrationWizardModal)
    migrateStep1Title: "\u6279\u91CF\u4E0A\u4F20",
    migrateStep1Desc: "\u5C06\u9644\u4EF6\u4E0A\u4F20\u5230\u670D\u52A1\u5668\uFF0C\u5E76\u66F4\u65B0\u7B14\u8BB0\u4E2D\u7684\u6587\u4EF6\u94FE\u63A5\u3002",
    migrateFolderScope: "1. \u9009\u62E9\u76EE\u5F55",
    migrateEntireVault: "\u6574\u4E2A\u77E5\u8BC6\u5E93\uFF08\u8DF3\u8FC7\u6392\u9664\u76EE\u5F55\uFF09",
    migrateTypeScope: "2. \u9644\u4EF6\u7C7B\u578B",
    migrateTypeImage: "\u{1F5BC}\uFE0F \u56FE\u7247\u9644\u4EF6 (png, jpg, heic, webp, gif, svg \u7B49)",
    migrateTypeAudio: "\u{1F3B5} \u97F3\u9891\u9644\u4EF6 (mp3, m4a, wav, flac, ogg \u7B49)",
    migrateTypeOther: "\u{1F4E6} \u5176\u4ED6\u9644\u4EF6 (\u89C6\u9891, PDF, \u538B\u7F29\u5305, \u529E\u516C\u6587\u6863\u7B49)",
    migratePolicyTitle: "3. \u4E0A\u4F20\u9009\u9879",
    migrateDeleteLocal: "\u4E0A\u4F20\u5E76\u66F4\u65B0\u94FE\u63A5\u540E\uFF0C\u5C06\u4E0D\u518D\u88AB\u5F15\u7528\u7684\u672C\u5730\u6587\u4EF6\u79FB\u5165\u56DE\u6536\u7AD9",
    migrateUploadProtected: "\u4E0A\u4F20\u5230\u670D\u52A1\u5668\u4FDD\u62A4\u76EE\u5F55\uFF08\u53EF\u89E3\u9664\u9632\u5220\u9664\u4FDD\u62A4\uFF09",
    migrateNextPreview: "\u9884\u89C8\u6587\u4EF6",
    migrateSelectTypeNotice: "\u8BF7\u81F3\u5C11\u52FE\u9009\u4E00\u79CD\u9644\u4EF6\u7C7B\u578B",
    migrateScanning: "\u23F3 \u6B63\u5728\u626B\u63CF\u6307\u5B9A\u76EE\u5F55\u4E0B\u7684\u9644\u4EF6\u4E0E\u5F15\u7528\u5173\u7CFB...",
    migrateStep2Title: "\u5F85\u4E0A\u4F20\u6587\u4EF6\uFF08{count}\uFF09",
    migrateNoneFound: "\u6240\u9009\u76EE\u5F55\u4E2D\u6CA1\u6709\u7B26\u5408\u6761\u4EF6\u7684\u9644\u4EF6\u3002",
    migrateSelectOnlyRef: "\u4EC5\u9009\u62E9\u88AB\u5F15\u7528\u7684\u6587\u4EF6",
    migrateNoteRefs: "{count} \u5904\u5F15\u7528",
    migrateInspectRefs: "\u70B9\u51FB\u67E5\u770B\u5F15\u7528\u6B64\u9644\u4EF6\u7684\u6240\u6709\u7B14\u8BB0",
    migrateSelectNotice: "\u8BF7\u81F3\u5C11\u52FE\u9009\u4E00\u4E2A\u8981\u8FC1\u79FB\u7684\u672C\u5730\u9644\u4EF6",
    migrateStart: "\u4E0A\u4F20\u5E76\u66F4\u65B0\u94FE\u63A5\uFF08{count}\uFF09",
    migrateProgress: "\u6B63\u5728\u4E0A\u4F20\uFF08{current}/{total}\uFF09\uFF1A{name}",
    migrateSuccess: "\u5DF2\u4E0A\u4F20 {count} \u4E2A\u9644\u4EF6\uFF0C\u5E76\u66F4\u65B0\u7B14\u8BB0\u94FE\u63A5\u3002",
    // 404 断链与健康体检 (HealthCheckModal)
    healthStep1Title: "\u5931\u6548\u94FE\u63A5",
    healthStep1Desc: "\u53EF\u68C0\u67E5\u7B14\u8BB0\u548C\u767D\u677F\u4E2D\u7684\u5185\u90E8\u94FE\u63A5\u3001\u672C\u5730\u6587\u4EF6\u94FE\u63A5\u53CA\u7F51\u9875\u94FE\u63A5\u3002",
    healthScopeTitle: "\u68C0\u67E5\u8303\u56F4",
    healthCheckWiki: "\u68C0\u67E5\u6307\u5411\u4E0D\u5B58\u5728\u7B14\u8BB0\u7684\u5185\u90E8\u94FE\u63A5",
    healthCheckLocal: "\u68C0\u67E5\u7F3A\u5931\u7684\u672C\u5730\u6587\u4EF6",
    healthCheckRemote: "\u68C0\u67E5\u7F51\u9875\u94FE\u63A5\u7684 HTTP \u54CD\u5E94\uFF08\u53EF\u80FD\u9700\u8981\u8F83\u957F\u65F6\u95F4\uFF09",
    healthScopeHint: "\u626B\u63CF\u77E5\u8BC6\u5E93\u4E2D\u7684 .md \u548C .canvas \u6587\u4EF6\uFF0C\u8DF3\u8FC7\u672C\u63D2\u4EF6\u751F\u6210\u7684\u62A5\u544A\u3002",
    healthStartScan: "\u5F00\u59CB\u68C0\u67E5",
    healthScanning: "\u23F3 \u6B63\u5728\u626B\u63CF\u5168\u5E93\u7B14\u8BB0\u4E2D\u7684\u6240\u6709\u94FE\u63A5\u5F15\u7528...",
    healthStep2Title: "\u5DF2\u68C0\u67E5 {docs} \u4E2A\u6587\u6863\uFF0C\u53D1\u73B0 {issues} \u5904\u95EE\u9898",
    healthStatNotes: "\u5DF2\u68C0\u67E5\u6587\u6863",
    healthStatWiki: "\u5931\u6548\u5185\u90E8\u94FE\u63A5",
    healthStatLocal: "\u7F3A\u5931\u672C\u5730\u6587\u4EF6",
    healthStatRemote: "\u7F51\u9875\u94FE\u63A5\u5F02\u5E38",
    healthRescan: "\u91CD\u65B0\u68C0\u67E5",
    healthFilterAll: "\u5168\u90E8\u5F02\u5E38",
    healthSearchPlaceholder: "\u6309\u7B14\u8BB0\u8DEF\u5F84\u6216\u76EE\u6807\u540D\u79F0\u8FC7\u6EE4...",
    healthNoMatches: "\u5F53\u524D\u7B5B\u9009\u6761\u4EF6\u4E0B\u672A\u53D1\u73B0\u5F02\u5E38",
    healthTagWikiEmbed: "\u{1F534} \u53CC\u94FE\u5D4C\u5165\u7F3A\u5931",
    healthTagDanglingNote: "\u{1F534} \u60AC\u7A7A\u7B14\u8BB0\u5F15\u7528",
    healthTagMissingImage: "\u{1F4C1} \u672C\u5730\u56FE\u7247\u7F3A\u5931",
    healthTagMissingFile: "\u{1F4C1} \u672C\u5730\u6587\u4EF6\u7F3A\u5931",
    healthTagRemote404: "\u7F51\u9875\u94FE\u63A5\u5F02\u5E38",
    healthLine: "\u7B2C {line} \u884C",
    healthInNote: "\u{1F4C4} \u6240\u5728\u7B14\u8BB0: {path}",
    healthJumpToLine: "\u{1F3AF} \u6253\u5F00\u5BF9\u5E94\u7B14\u8BB0 \u2794",
    healthNoneFound: "\u6240\u9009\u68C0\u67E5\u8303\u56F4\u5185\u672A\u53D1\u73B0\u94FE\u63A5\u95EE\u9898\u3002",
    // 知识库全景统计面板 (VaultAnalyticsModal)
    analyticsTitle: "\u4ED3\u5E93\u6982\u89C8",
    analyticsBadge: "\u6982\u89C8",
    analyticsLoading: "\u6B63\u5728\u7EDF\u8BA1\u7B14\u8BB0\u3001\u9644\u4EF6\u548C\u670D\u52A1\u5668\u6587\u4EF6...",
    analyticsStatNotes: "\u7B14\u8BB0\u6570",
    analyticsStatImages: "\u56FE\u7247\u6570",
    analyticsStatOtherAttachments: "\u5176\u4ED6\u9644\u4EF6\u6570",
    analyticsStatTotalFiles: "\u603B\u6570",
    analyticsStatNotesSub: "{md} \u7B14\u8BB0 \xB7 {cva} \u767D\u677F",
    analyticsStatImagesSub: "\u672C\u5730 {loc} \xB7 \u8FDC\u7A0B {rem}",
    analyticsStatOtherSub: "\u89C6\u9891\u3001\u97F3\u9891\u53CA\u6587\u6863",
    analyticsStatTotalSub: "\u5168\u5E93\u7B14\u8BB0\u4E0E\u8D44\u4EA7\u603B\u548C",
    analyticsStorageComparison: "\u5B58\u50A8\u7528\u91CF\u5206\u5E03",
    analyticsLocalVault: "\u77E5\u8BC6\u5E93\u672C\u5730\u9644\u4EF6",
    analyticsRemoteServer: "\u670D\u52A1\u5668\u8FDC\u7A0B\u8D44\u4EA7",
    analyticsLocalStats: "\u56FE\u7247\uFF1A{imgBytes} \xB7 \u5176\u4ED6\uFF1A{othBytes}",
    analyticsRemoteStats: "WebP \u7F13\u5B58\uFF1A{cache} \xB7 \u9632\u5220\u4FDD\u62A4\uFF1A{locked}",
    analyticsInsightsTitle: "\u8D44\u4EA7\u5065\u5EB7\u4E0E\u4F18\u5316\u5EFA\u8BAE",
    analyticsInsightStorageLocal: '\u672C\u5730\u5B58\u50A8\u5360\u6BD4\u504F\u9AD8\uFF08<strong style="color: var(--text-accent);">{pct}%</strong>\uFF09\uFF0C\u5B58\u5728\u8D85\u5927\u5355\u6587\u4EF6\uFF0C\u5EFA\u8BAE\u6309\u9700\u8FC1\u79FB\u81F3\u670D\u52A1\u5668\u91CA\u653E\u672C\u5730\u4E0E\u540C\u6B65\u7A7A\u95F4\u3002',
    analyticsInsightStorageRemote: '\u4E91\u7AEF\u6258\u7BA1\u5360\u6BD4\u4E3B\u5BFC\uFF08<strong style="color: #10b981;">{pct}%</strong>\uFF09\uFF0C\u6709\u6548\u51CF\u8F7B\u672C\u5730\u77E5\u8BC6\u5E93\u53CA\u79FB\u52A8\u7AEF\u591A\u8BBE\u5907\u540C\u6B65\u8D1F\u62C5\u3002',
    analyticsInsightCacheReady: '\u4E91\u7AEF WebP \u884D\u751F\u7F13\u5B58 <strong style="color: #10b981;">100% \u5C31\u7EEA</strong>\uFF0C\u5DF2\u4E3A\u79FB\u52A8\u7AEF\u4E0E\u5BA2\u6237\u7AEF\u63D0\u4F9B\u8F7B\u91CF\u5316\u52A0\u8F7D\u52A0\u901F\u3002',
    analyticsInsightLockedSafe: '\u5DF2\u6709 <strong style="color: #10b981;">{count} \u9879</strong> \u4E91\u7AEF\u5173\u952E\u8D44\u4EA7\u5F00\u542F\u9632\u5220\u4FDD\u62A4\u9501\u5B9A\uFF0C\u9632\u6B62\u610F\u5916\u5220\u9664\u3002',
    analyticsTopLargest: "\u4F53\u79EF\u6700\u5927\u7684 10 \u4E2A\u9644\u4EF6",
    analyticsFilterAll: "\u5168\u90E8",
    analyticsFilterLocal: "\u{1F4BB} \u672C\u5730",
    analyticsFilterRemote: "\u2601\uFE0F \u8FDC\u7A0B",
    analyticsFilterEmpty: "\u5F53\u524D\u7B5B\u9009\u4E0B\u6CA1\u6709\u9644\u4EF6",
    analyticsRefUsed: "\u5DF2\u5F15\u7528",
    analyticsRefUnused: "\u672A\u5F15\u7528",
    analyticsCopiedName: "\u5DF2\u590D\u5236\u6587\u4EF6\u540D\uFF1A{name}",
    analyticsClickToCopy: "\u70B9\u51FB\u590D\u5236\u6587\u4EF6\u540D\uFF0C\u60AC\u6D6E\u9884\u89C8\u7F29\u7565\u56FE",
    analyticsBadgeLocal: "\u{1F4BB} \u672C\u5730",
    analyticsBadgeRemote: "\u2601\uFE0F \u8FDC\u7A0B",
    analyticsFail: "\u83B7\u53D6\u77E5\u8BC6\u5E93\u7EDF\u8BA1\u62A5\u544A\u5931\u8D25\uFF1A{err}",
    analyticsExportReport: "\u5BFC\u51FA\u77E5\u8BC6\u5E93\u62A5\u544A\uFF08.md\uFF09",
    // 弹窗与通用通知
    confirmRemoteOrphanTitle: "\u79FB\u5165\u56DE\u6536\u7AD9\uFF1F",
    confirmRemoteOrphanMsg: "\u5C06\u670D\u52A1\u5668\u4E0A\u7684 {count} \u4E2A\u6587\u4EF6\uFF08\u5171 {size}\uFF09\u79FB\u5165\u56DE\u6536\u7AD9\uFF1F\u8BF7\u786E\u8BA4\u8FD9\u4E9B\u6587\u4EF6\u786E\u5B9E\u4E0D\u518D\u9700\u8981\u3002",
    confirmRemoteOrphanBtn: "\u79FB\u5165\u56DE\u6536\u7AD9\uFF08{count}\uFF09",
    confirmRemoteDupTitle: "\u5408\u5E76\u670D\u52A1\u5668\u6587\u4EF6\uFF1F",
    confirmRemoteDupMsg: "\u5C06 {count} \u4E2A\u670D\u52A1\u5668\u526F\u672C\uFF08\u5171 {size}\uFF09\u79FB\u5165\u56DE\u6536\u7AD9\uFF1F\u7B14\u8BB0\u94FE\u63A5\u4F1A\u5148\u66F4\u65B0\u4E3A\u4FDD\u7559\u526F\u672C\u7684\u94FE\u63A5\u3002",
    confirmRemoteDupBtn: "\u66F4\u65B0\u94FE\u63A5\u5E76\u79FB\u5165\u56DE\u6536\u7AD9\uFF08{count}\uFF09",
    noDupToProcess: "\u6CA1\u6709\u9700\u8981\u5904\u7406\u7684\u91CD\u590D\u6587\u4EF6",
    noticeSavedLocal: "\u{1F4BB} \u5DF2\u4FDD\u5B58\u81F3\u672C\u5730\u77E5\u8BC6\u5E93: {path}",
    noticeFailedLocal: "\u274C \u672C\u5730\u4FDD\u5B58\u5931\u8D25: {err}",
    noticeUploadedRemote: "\u5DF2\u4E0A\u4F20\u5230\u670D\u52A1\u5668\u5E76\u63D2\u5165\u94FE\u63A5\uFF1A{name}",
    noticeUploadFailed: "\u4E0A\u4F20\u5230\u670D\u52A1\u5668\u5931\u8D25\uFF1A{err}",
    noticeCopiedRaw: "\u{1F4CE} \u5DF2\u590D\u5236\u539F\u59CB\u94FE\u63A5: {name}",
    noticeCopiedWebp: "\u26A1 \u5DF2\u590D\u5236 WebP \u4F18\u5316\u94FE\u63A5: {name}",
    noticeExclAdded: '\u{1F6E1}\uFE0F \u5DF2\u5C06\u76EE\u5F55 "{path}" \u52A0\u5165\u626B\u63CF\u6392\u9664\u540D\u5355',
    noticeExclRemoved: '\u{1F513} \u5DF2\u5C06\u76EE\u5F55 "{path}" \u4ECE\u626B\u63CF\u6392\u9664\u540D\u5355\u79FB\u9664',
    noticeOpenMdFirst: "\u8BF7\u5148\u5728\u7F16\u8F91\u5668\u4E2D\u6253\u5F00\u4E00\u7BC7\u7B14\u8BB0\uFF08Markdown\u3001Canvas \u6216 Excalidraw\uFF09",
    noticeNoRemoteInActive: "\u5F53\u524D\u7B14\u8BB0\u4E2D\u6CA1\u6709\u670D\u52A1\u5668\u6587\u4EF6\u94FE\u63A5",
    noticeNoLocalInActive: "\u5F53\u524D\u7B14\u8BB0\u4E2D\u672A\u627E\u5230\u672C\u5730\u9644\u4EF6\u5F15\u7528",
    noticeAstroCopied: "\u2705 \u5DF2\u5C06\u5305\u542B\u516C\u5F00 WebP \u94FE\u63A5\u7684\u7B14\u8BB0\u5185\u5BB9\u590D\u5236\u81F3\u526A\u8D34\u677F\uFF01",
    // 设置面板标签
    settingsTitle: "File Master \u8BBE\u7F6E",
    settingsBack: "\u8FD4\u56DE\u8BBE\u7F6E\u9996\u9875",
    settingsCoreGroup: "\u6838\u5FC3\u529F\u80FD",
    settingsPreferencesGroup: "\u7CFB\u7EDF\u504F\u597D",
    settingsToolsGroup: "\u6587\u4EF6\u5DE5\u5177",
    settingsInfoGroup: "\u63D2\u4EF6\u4FE1\u606F",
    tabGeneral: "\u5E38\u89C4\u504F\u597D",
    tabServer: "\u670D\u52A1\u5668\u8FDE\u63A5",
    tabUpload: "\u9644\u4EF6\u5904\u7406",
    tabExemptions: "\u4FDD\u62A4\u4E0E\u6392\u9664",
    // 常规与语言
    langName: "\u754C\u9762\u8BED\u8A00",
    langDesc: "\u8BBE\u7F6E File Master \u7684\u754C\u9762\u8BED\u8A00",
    langAuto: "\u8DDF\u968F Obsidian",
    sidebarBtnName: "\u663E\u793A\u5DE5\u5177\u680F\u6309\u94AE",
    sidebarBtnDesc: "\u5728 Obsidian \u5DE6\u4FA7\u5DE5\u5177\u680F\u663E\u793A File Master \u6309\u94AE",
    clipboardMonitorName: "\u5904\u7406\u7C98\u8D34\u4E0E\u62D6\u5165\u7684\u9644\u4EF6",
    clipboardMonitorDesc: "\u6309\u9644\u4EF6\u4FDD\u5B58\u4F4D\u7F6E\u5904\u7406\u7C98\u8D34\u6216\u62D6\u5165\u7684\u6587\u4EF6",
    // 服务端连接
    enableRemoteServerName: "\u8FDE\u63A5\u670D\u52A1\u5668",
    enableRemoteServerDesc: "\u542F\u7528\u670D\u52A1\u5668\u4E0A\u4F20\u4E0E\u6587\u4EF6\u6D4F\u89C8",
    serverVerifiedBadge: "\u5DF2\u8FDE\u63A5",
    serverUnverifiedBadge: "\u5F85\u6D4B\u8BD5",
    serverDisabledHint: "\u670D\u52A1\u5668\u8FDE\u63A5\u5DF2\u5173\u95ED\u3002\u5F53\u524D\u53EA\u80FD\u4F7F\u7528\u77E5\u8BC6\u5E93\u4E2D\u7684\u672C\u5730\u6587\u4EF6\u529F\u80FD\u3002",
    serverUnverifiedHint: "\u8BF7\u5148\u6D4B\u8BD5\u670D\u52A1\u5668\u8FDE\u63A5\u3002\u8FDE\u63A5\u6210\u529F\u540E\u624D\u80FD\u4F7F\u7528\u670D\u52A1\u5668\u6587\u4EF6\u529F\u80FD\u3002",
    serverUrlName: "\u670D\u52A1\u5668\u5730\u5740",
    serverUrlDesc: "\u4F8B\u5982 https://files.example.com \u6216 http://192.168.1.100:3210",
    apiTokenName: "API \u4EE4\u724C",
    apiTokenDesc: "\u4ECE\u670D\u52A1\u7AEF\u7684\u201C\u7AD9\u70B9\u8BBE\u7F6E\u201D\u4E2D\u590D\u5236\u4E0A\u4F20 API \u4EE4\u724C",
    showToken: "\u663E\u793A\u4EE4\u724C",
    hideToken: "\u9690\u85CF\u4EE4\u724C",
    btnTestConn: "\u6D4B\u8BD5\u8FDE\u63A5",
    testConnSuccess: "\u8FDE\u63A5\u6210\u529F\u3002\u670D\u52A1\u5668{ver}\u4E0A\u6709 {count} \u4E2A\u6587\u4EF6\u3002",
    testConnFail: "\u274C \u8FDE\u63A5\u5931\u8D25\uFF1A{err}",
    compatWarn: "\u26A0\uFE0F \u517C\u5BB9\u6027\u8B66\u544A\uFF1A\u670D\u52A1\u7AEF\u8981\u6C42\u63D2\u4EF6\u7248\u672C >= v{minVer}\uFF08\u5F53\u524D: v{currentVer}\uFF09\uFF0C\u8BF7\u66F4\u65B0\u63D2\u4EF6\u3002",
    compatWarnServer: "\u26A0\uFE0F \u670D\u52A1\u7AEF\u7248\u672C\u8FC7\u65E7\u8B66\u544A\uFF1A\u5F53\u524D\u670D\u52A1\u7AEF\u4E3A v{serverVer}\uFF0C\u672C\u63D2\u4EF6\u63A8\u8350 >= v{minServerVer}\uFF0C\u90E8\u5206\u65B0\u7279\u6027\u53EF\u80FD\u53D7\u9650\u3002",
    compatStatusChecking: "\u6B63\u5728\u68C0\u67E5\u8FDE\u63A5\u548C\u7248\u672C...",
    compatStatusOk: "\u5DF2\u8FDE\u63A5 \xB7 \u670D\u52A1\u5668 v{serverVer} \xB7 {count} \u4E2A\u6587\u4EF6",
    compatStatusServerOld: "\u670D\u52A1\u5668\u7248\u672C\u8F83\u65E7\uFF1Av{serverVer}\uFF1B\u63D2\u4EF6\u9700\u8981 v{minServerVer} \u6216\u66F4\u65B0\u7248\u672C\u3002\u8BF7\u5728\u670D\u52A1\u5668\u63A7\u5236\u53F0\u66F4\u65B0\u3002",
    compatStatusPluginOld: "\u63D2\u4EF6 v{currentVer} \u9700\u8981\u66F4\u65B0\uFF0C\u8BF7\u5B89\u88C5 v{minPluginVer} \u6216\u66F4\u65B0\u7248\u672C\u3002",
    compatStatusAuthFail: "\u4EE4\u724C\u65E0\u6548\uFF0C\u8BF7\u4ECE\u670D\u52A1\u7AEF\u91CD\u65B0\u590D\u5236\u5E76\u6D4B\u8BD5\u8FDE\u63A5\u3002",
    compatStatusTokenMissing: "\u8BF7\u5148\u586B\u5199\u670D\u52A1\u7AEF\u7684\u4E0A\u4F20 API \u4EE4\u724C\u3002",
    compatStatusServerError: "\u670D\u52A1\u5668\u54CD\u5E94\u5F02\u5E38\uFF08{code}\uFF09\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002",
    compatStatusOffline: "\u65E0\u6CD5\u8FDE\u63A5\uFF0C\u8BF7\u68C0\u67E5\u5730\u5740\u548C\u7F51\u7EDC\u3002{err}",
    // 上传与链接
    saveLocationName: "\u9644\u4EF6\u4FDD\u5B58\u4F4D\u7F6E",
    saveLocationDesc: "\u9009\u62E9\u7C98\u8D34\u6216\u62D6\u5165\u9644\u4EF6\u65F6\u7684\u4FDD\u5B58\u65B9\u5F0F\u3002\u670D\u52A1\u5668\u79BB\u7EBF\u65F6\u4FDD\u5B58\u5230\u672C\u5730\u3002",
    defaultSaveLocationName: "\u8BE2\u95EE\u65F6\u9ED8\u8BA4\u9009\u4E2D",
    defaultSaveLocationDesc: "\u63D2\u5165\u9644\u4EF6\u5F39\u7A97\u4E2D\u9ED8\u8BA4\u9009\u4E2D\u7684\u5B58\u50A8\u76EE\u6807",
    optSaveAsk: "\u6BCF\u6B21\u8BE2\u95EE",
    optSaveRemote: "\u4E0A\u4F20\u5230\u670D\u52A1\u5668",
    optSaveLocal: "\u4FDD\u5B58\u5230\u77E5\u8BC6\u5E93",
    insertOptimizedName: "\u63D2\u5165 WebP \u94FE\u63A5",
    insertOptimizedDesc: "\u5F00\u542F\u540E\u63D2\u5165 WebP \u94FE\u63A5\uFF1B\u5173\u95ED\u540E\u63D2\u5165\u539F\u6587\u4EF6\u94FE\u63A5",
    namingStrategyName: "\u9644\u4EF6\u547D\u540D\u89C4\u5219",
    namingStrategyDesc: "\u8BBE\u7F6E\u65B0\u9644\u4EF6\u7684\u6587\u4EF6\u540D",
    optNamingKeep: "\u4FDD\u7559\u539F\u540D",
    optNamingRule: "\u6309\u89C4\u5219\u547D\u540D",
    optNamingPrompt: "\u6BCF\u6B21\u8BE2\u95EE",
    namingPatternName: "\u547D\u540D\u6A21\u677F",
    namingPatternDesc: "\u652F\u6301\u53D8\u91CF\uFF1A{note} \u7B14\u8BB0\u6807\u9898, {origin} \u539F\u540D, {date} \u5E74\u6708\u65E5, {time} \u65F6\u5206\u79D2, {timestamp} \u65F6\u95F4\u6233, {rand:4} \u968F\u673A\u5B57\u7B26, {hash:8} \u54C8\u5E0C",
    uploadNonImageName: "\u5904\u7406\u975E\u56FE\u7247\u9644\u4EF6",
    uploadNonImageDesc: "\u5F00\u542F\u540E\uFF0C\u97F3\u89C6\u9891\u3001PDF \u7B49\u5E38\u89C1\u9644\u4EF6\u4E5F\u5C06\u652F\u6301\u672C\u5730\u4FDD\u5B58\u6216\u4E91\u7AEF\u8FC1\u79FB",
    destFixedLocalHint: "\u{1F4CC} \u5DF2\u6309\u8BBE\u7F6E\u56FA\u5B9A\u4FDD\u5B58\u81F3\u672C\u5730\u77E5\u8BC6\u5E93",
    destFixedRemoteHint: "\u{1F4CC} \u5DF2\u6309\u8BBE\u7F6E\u56FA\u5B9A\u4E0A\u4F20\u81F3\u670D\u52A1\u5668",
    destFixedRemoteFallbackHint: "\u26A0\uFE0F \u9884\u8BBE\u4E3A\u4E0A\u4F20\u81F3\u670D\u52A1\u5668\uFF0C\u4F46\u5F53\u524D\u670D\u52A1\u5668\u672A\u8FDE\u63A5\uFF0C\u5DF2\u81EA\u52A8\u5207\u6362\u4E3A\u4FDD\u5B58\u5230\u672C\u5730",
    tagLocked: "\u5DF2\u4FDD\u62A4",
    remoteServerRequiredNotice: "\u8BF7\u5148\u5728\u8BBE\u7F6E\u4E2D\u914D\u7F6E\u5E76\u8FDE\u63A5\u6709\u6548\u7684\u670D\u52A1\u5668",
    // 保护与规则
    excludedFoldersName: "\u4E0D\u626B\u63CF\u7684\u76EE\u5F55",
    excludedFoldersDesc: "\u4EE5\u9017\u53F7\u5206\u9694\u7684\u76EE\u5F55\u76F8\u5BF9\u8DEF\u5F84\uFF08\u5982 templates, protected\uFF09\u3002\u4E5F\u53EF\u76F4\u63A5\u5728\u6587\u4EF6\u6811\u53F3\u952E\u76EE\u5F55\u6DFB\u52A0\u6392\u9664",
    excludeLockedRemoteName: "\u8DF3\u8FC7\u53D7\u4FDD\u62A4\u7684\u670D\u52A1\u5668\u6587\u4EF6",
    excludeLockedRemoteDesc: "\u67E5\u627E\u672A\u5F15\u7528\u6587\u4EF6\u548C\u91CD\u590D\u6587\u4EF6\u65F6\uFF0C\u8DF3\u8FC7\u5F00\u542F\u9632\u5220\u9664\u4FDD\u62A4\u7684\u670D\u52A1\u5668\u6587\u4EF6",
    openHubName: "\u529F\u80FD\u9762\u677F",
    openHubDesc: "\u68C0\u67E5\u94FE\u63A5\u3001\u6574\u7406\u6587\u4EF6\u5E76\u67E5\u770B\u77E5\u8BC6\u5E93\u6982\u89C8",
    btnOpenHub: "\u6253\u5F00 File Master",
    // 底部信息栏
    aboutTitle: "\u5173\u4E8E File Master",
    aboutDesc: "\u5728 Obsidian \u4E2D\u7BA1\u7406\u9644\u4EF6\u548C\u94FE\u63A5\uFF0C\u5E76\u901A\u8FC7\u81EA\u5EFA\u670D\u52A1\u5668\u5B58\u50A8\u4E0E\u5206\u4EAB\u6587\u4EF6\u3002",
    aboutAuthor: "\u5F00\u53D1\u8005",
    aboutRepo: "\u5B98\u65B9\u5F00\u6E90\u4ED3\u5E93",
    aboutFeedback: "\u95EE\u9898\u53CD\u9988",
    aboutFeedbackLink: "\u6253\u5F00 GitHub Issues",
    aboutServerCompat: "\u670D\u52A1\u7AEF\u517C\u5BB9\u8981\u6C42",
    aboutServerStatus: "\u5173\u8054\u670D\u52A1\u7AEF\u72B6\u6001",
    aboutServerOffline: "\u672A\u8FDE\u63A5",
    // 右键上下文菜单
    menuMigrateFolder: "File Master\uFF1A\u6279\u91CF\u4E0A\u4F20\u6B64\u76EE\u5F55\u7684\u9644\u4EF6...",
    menuRemoveExclusion: "File Master\uFF1A\u4E0D\u518D\u8DF3\u8FC7\u6B64\u76EE\u5F55",
    menuAddExclusion: "File Master\uFF1A\u626B\u63CF\u65F6\u8DF3\u8FC7\u6B64\u76EE\u5F55",
    menuUploadCloud: "File Master\uFF1A\u4E0A\u4F20\u5230\u670D\u52A1\u5668\u5E76\u66F4\u65B0\u94FE\u63A5",
    menuUploadProtected: "File Master\uFF1A\u4E0A\u4F20\u5230\u670D\u52A1\u5668\u4FDD\u62A4\u76EE\u5F55",
    menuCopyRaw: "File Master\uFF1A\u590D\u5236\u539F\u6587\u4EF6\u94FE\u63A5\uFF08{name}\uFF09",
    menuCopyWebp: "File Master\uFF1A\u590D\u5236 WebP \u94FE\u63A5",
    menuDownloadToVault: "File Master\uFF1A\u4E0B\u8F7D\u5230\u77E5\u8BC6\u5E93\u5E76\u66F4\u65B0\u94FE\u63A5\uFF08{name}\uFF09",
    menuLockRemote: "File Master\uFF1A\u5F00\u542F\u9632\u5220\u9664\u4FDD\u62A4\uFF08{name}\uFF09",
    menuActiveNoteMigrate: "File Master\uFF1A\u4E0A\u4F20\u5F53\u524D\u7B14\u8BB0\u7684\u9644\u4EF6",
    menuActiveNoteDownload: "File Master\uFF1A\u4E0B\u8F7D\u5F53\u524D\u7B14\u8BB0\u7684\u670D\u52A1\u5668\u9644\u4EF6",
    menuActiveNoteAstro: "File Master\uFF1A\u590D\u5236\u5F53\u524D\u7B14\u8BB0\u5E76\u4F7F\u7528 WebP \u94FE\u63A5",
    // 命令面板命令
    cmdOpenHub: "\u6253\u5F00 File Master",
    cmdScanHealth: "\u68C0\u67E5\u5931\u6548\u94FE\u63A5",
    cmdScanOrphan: "\u67E5\u627E\u672A\u5F15\u7528\u6587\u4EF6",
    cmdScanDuplicate: "\u67E5\u627E\u91CD\u590D\u6587\u4EF6",
    cmdBatchMigrate: "\u6279\u91CF\u4E0A\u4F20\u9644\u4EF6",
    cmdVaultAnalytics: "\u4ED3\u5E93\u6982\u89C8",
    cmdMigrateActiveNote: "\u4E0A\u4F20\u5F53\u524D\u7B14\u8BB0\u7684\u9644\u4EF6",
    cmdDownloadActiveNote: "\u4E0B\u8F7D\u5F53\u524D\u7B14\u8BB0\u7684\u670D\u52A1\u5668\u9644\u4EF6",
    cmdCopyAstroLinks: "\u590D\u5236\u5F53\u524D\u7B14\u8BB0\u5168\u6587\uFF08\u66FF\u6362\u4E3A WebP \u94FE\u63A5\uFF09",
    cmdRemoteGallery: "\u6D4F\u89C8\u670D\u52A1\u5668\u6587\u4EF6",
    cmdRemoteGalleryView: "\u5728\u4FA7\u680F\u6D4F\u89C8\u670D\u52A1\u5668\u6587\u4EF6",
    // 全局通知与操作提示
    scanPreparing: "\u23F3 \u6B63\u5728\u51C6\u5907\u626B\u63CF...",
    noticeProtectedRemote: "\u5DF2\u4E3A\u670D\u52A1\u5668\u6587\u4EF6\u5F00\u542F\u9632\u5220\u9664\u4FDD\u62A4\uFF1A{name}",
    noticeLockFailed: "\u274C \u9501\u5B9A\u5931\u8D25\uFF1A{err}",
    noticeSaveCancelled: "\u5DF2\u53D6\u6D88\u4FDD\u5B58\u9644\u4EF6",
    noticeRemoteUnreachable: "\u65E0\u6CD5\u8FDE\u63A5\u670D\u52A1\u5668\uFF08{err}\uFF09\uFF0C\u4EC5\u663E\u793A\u77E5\u8BC6\u5E93\u4E2D\u7684\u672A\u5F15\u7528\u6587\u4EF6\u3002",
    noticeReportGenerated: "\u{1F4C4} \u5DF2\u5728\u77E5\u8BC6\u5E93\u6839\u76EE\u5F55\u751F\u6210\u62A5\u544A\uFF1A{path}",
    noticeRemoteDeleteFailed: "\u274C \u5220\u9664\u8FDC\u7A0B\u6587\u4EF6\u5931\u8D25\uFF08{name}\uFF09\uFF1A{err}",
    noticeCleanupComplete: "\u5DF2\u5904\u7406\u6587\u4EF6\uFF1A\u77E5\u8BC6\u5E93 {local} \u4E2A\uFF0C\u670D\u52A1\u5668 {remote} \u4E2A\u3002",
    noticeCannotOpenFile: "\u65E0\u6CD5\u6253\u5F00\u6307\u5B9A\u6587\u4EF6\uFF1A{path}",
    noticeUploadingFile: "\u6B63\u5728\u4E0A\u4F20\u201C{name}\u201D...",
    noticeMigrateSuccess: "\u5DF2\u4E0A\u4F20\u201C{name}\u201D\u5230\u670D\u52A1\u5668{protected}\uFF0C\u5E76\u66F4\u65B0 {docs} \u7BC7\u7B14\u8BB0\u4E2D\u7684\u94FE\u63A5\u3002",
    noticeMigrateFailed: "\u274C \u8FC1\u79FB\u5931\u8D25\uFF08{name}\uFF09\uFF1A{err}",
    noticeDownloadingFile: '\u23F3 \u6B63\u5728\u4E0B\u8F7D\u8FDC\u7A0B\u9644\u4EF6 "{name}" \u56DE\u672C\u5730...',
    noticeDownloadedToVault: "\u5DF2\u5C06\u201C{name}\u201D\u4FDD\u5B58\u5230\u77E5\u8BC6\u5E93\uFF08{path}\uFF09\uFF0C\u5E76\u66F4\u65B0 {docs} \u7BC7\u7B14\u8BB0\u4E2D\u7684\u94FE\u63A5\u3002",
    noticeDownloadFailed: "\u274C \u4E0B\u8F7D\u81F3\u672C\u5730\u5931\u8D25\uFF1A{err}",
    noticeDownloadedBatch: "\u5DF2\u4E0B\u8F7D {count} \u4E2A\u670D\u52A1\u5668\u6587\u4EF6\u5230\u77E5\u8BC6\u5E93\uFF0C\u5E76\u66F4\u65B0\u7B14\u8BB0\u94FE\u63A5\u3002",
    noticeBatchMigrateSuccess: "\u5DF2\u4E0A\u4F20 {count} \u4E2A\u6587\u4EF6\uFF0C\u66F4\u65B0 {docs} \u7BC7\u7B14\u8BB0{trashed}\u3002",
    noticeBatchMigrateTrashedPart: "\uFF0C\u5C06 {trashed} \u4E2A\u672C\u5730\u6587\u4EF6\u79FB\u5165\u56DE\u6536\u7AD9",
    noticeNoteMigrateSuccess: "\u5DF2\u4E0A\u4F20\u5F53\u524D\u7B14\u8BB0\u4E2D\u7684 {count} \u4E2A\u9644\u4EF6\uFF0C\u5E76\u66F4\u65B0\u94FE\u63A5\u3002",
    noticeDedupSafetyWarning: "\u5DF2\u66F4\u65B0 {modified} \u7BC7\u7B14\u8BB0\uFF1B\u5904\u7406\u77E5\u8BC6\u5E93\u6587\u4EF6 {local} \u4E2A\u3001\u670D\u52A1\u5668\u6587\u4EF6 {remote} \u4E2A\u3002\u4ECD\u88AB\u5F15\u7528\u7684 {skipped} \u4E2A\u6587\u4EF6\u5DF2\u4FDD\u7559\u3002",
    noticeDedupSuccess: "\u5DF2\u66F4\u65B0 {modified} \u7BC7\u7B14\u8BB0\uFF1B\u5904\u7406\u77E5\u8BC6\u5E93\u6587\u4EF6 {local} \u4E2A\u3001\u670D\u52A1\u5668\u6587\u4EF6 {remote} \u4E2A\u3002",
    previewTitle: "\u6587\u4EF6\u9884\u89C8\uFF1A{name}",
    previewTitleLabel: "\u6587\u4EF6\u9884\u89C8",
    previewLinksTitle: "\u590D\u5236\u94FE\u63A5",
    previewSourceLocal: "\u672C\u5730\u77E5\u8BC6\u5E93",
    previewSourceRemote: "\u670D\u52A1\u5668",
    previewMeta: "{source} \xB7 \u8DEF\u5F84\uFF1A{path} \xB7 \u5927\u5C0F\uFF1A{size}",
    previewPathLabel: "\u6587\u4EF6\u4F4D\u7F6E",
    previewSizeLabel: "\u6587\u4EF6\u5927\u5C0F",
    previewCopyMarkdown: "\u590D\u5236 Markdown",
    previewCopyUrl: "\u590D\u5236\u6587\u4EF6\u94FE\u63A5",
    previewInsert: "\u63D2\u5165\u5F53\u524D\u7B14\u8BB0",
    previewProtected: "\u5DF2\u5F00\u542F\u9632\u5220\u9664\u4FDD\u62A4",
    previewUnprotected: "\u5DF2\u89E3\u9664\u9632\u5220\u9664\u4FDD\u62A4",
    previewLockFailed: "\u4FEE\u6539\u4FDD\u62A4\u72B6\u6001\u5931\u8D25\uFF1A{err}",
    previewDeleteFailed: "\u79FB\u52A8\u6587\u4EF6\u5931\u8D25\uFF1A{err}",
    previewOpenBrowser: "\u5728\u6D4F\u89C8\u5668\u4E2D\u6253\u5F00",
    previewNonImageTip: "\u8FD9\u662F .{ext} \u6587\u4EF6\u3002\u53EF\u5728 Obsidian \u6216\u6D4F\u89C8\u5668\u4E2D\u6253\u5F00\u3002",
    btnOpenInObsidian: "\u{1F4C2} \u5728 Obsidian \u4E2D\u6253\u5F00",
    btnOpenRawInBrowser: "\u{1F310} \u5728\u6D4F\u89C8\u5668\u4E2D\u67E5\u770B\u539F\u56FE",
    noteRefsTitle: '\u{1F517} \u5F15\u7528 "{name}" \u7684\u7B14\u8BB0 ({count})',
    noteRefsNone: "\u5F53\u524D\u6CA1\u6709\u4EFB\u4F55\u7B14\u8BB0\u6216\u767D\u677F\u5F15\u7528\u6B64\u6587\u4EF6\u3002",
    btnOpenNote: "\u2197 \u6253\u5F00\u7B14\u8BB0",
    noteRefsNotFound: "\u672A\u627E\u5230\u7B14\u8BB0\uFF1A{path}",
    thumbEnlargeTooltip: "\u70B9\u51FB\u653E\u5927\u9884\u89C8",
    thumbDetailsTooltip: "\u67E5\u770B\u6587\u4EF6\u8BE6\u60C5",
    orphanSelectRequired: "\u8BF7\u81F3\u5C11\u9009\u62E9\u4E00\u4E2A\u5F85\u6E05\u7406\u7684\u6587\u4EF6\u3002",
    dupSelectTypeRequired: "\u8BF7\u81F3\u5C11\u9009\u62E9\u4E00\u79CD\u67E5\u91CD\u6587\u4EF6\u7C7B\u578B\u3002",
    btnConfirm: "\u786E\u8BA4",
    noticeInstantUpload: "\u670D\u52A1\u5668\u4E0A\u5DF2\u6709\u76F8\u540C\u6587\u4EF6\uFF0C\u5DF2\u590D\u7528\u73B0\u6709\u94FE\u63A5\u3002",
    // 素材处理进度与结果弹窗
    destProcessingTitle: "\u6B63\u5728\u5904\u7406\u9644\u4EF6...",
    destProbeChecking: "\u6B63\u5728\u68C0\u67E5\u670D\u52A1\u5668\u4E0A\u662F\u5426\u5DF2\u6709\u76F8\u540C\u6587\u4EF6...",
    destUploadingRemote: "\u6B63\u5728\u4E0A\u4F20\u5230\u670D\u52A1\u5668...",
    destSavingLocal: "\u6B63\u5728\u4FDD\u5B58\u81F3\u672C\u5730\u77E5\u8BC6\u5E93...",
    destResultTitle: "\u9644\u4EF6\u5DF2\u5904\u7406",
    destInstantBadge: "\u670D\u52A1\u5668\u4E0A\u5DF2\u6709\u76F8\u540C\u6587\u4EF6",
    destInstantDesc: "\u5DF2\u590D\u7528\u670D\u52A1\u5668\u4E0A\u7684\u6587\u4EF6\uFF0C\u65E0\u9700\u91CD\u65B0\u4E0A\u4F20\u6587\u4EF6\u5185\u5BB9\u3002",
    destSuccessBadge: "\u5DF2\u4E0A\u4F20\u5230\u670D\u52A1\u5668",
    destSuccessDesc: "\u6587\u4EF6\u5DF2\u4E0A\u4F20\u5230\u670D\u52A1\u5668\uFF0C\u5E76\u63D2\u5165\u94FE\u63A5\u3002",
    destLocalBadge: "\u5DF2\u4FDD\u5B58\u5230\u77E5\u8BC6\u5E93",
    destLocalDesc: "\u6587\u4EF6\u5DF2\u4FDD\u5B58\u5230\u77E5\u8BC6\u5E93\uFF0C\u5E76\u63D2\u5165\u5F15\u7528\u3002",
    destInsertedNotice: "\u2705 \u5DF2\u81EA\u52A8\u63D2\u5165\u5F53\u524D\u7B14\u8BB0\u5149\u6807\u5904",
    destLabelRawUrl: "\u539F\u6587\u4EF6\u94FE\u63A5\uFF1A",
    destLabelPubUrl: "WebP \u94FE\u63A5\uFF1A",
    destLabelLocalPath: "\u672C\u5730\u77E5\u8BC6\u5E93\u5B58\u50A8\u8DEF\u5F84:",
    destLabelMarkdown: "\u63D2\u5165\u7684 Markdown \u5F15\u7528\u8BED\u6CD5:",
    destBtnCopy: "\u590D\u5236",
    destBtnCopied: "\u5DF2\u590D\u5236\uFF01",
    destBtnDone: "\u5B8C\u6210",
    destProcessingError: "\u274C \u5904\u7406\u5931\u8D25\uFF1A{err}",
    // 向导完成结果与当前笔记窗口
    batchResultTitle: "\u6279\u91CF\u4E0A\u4F20\u5B8C\u6210",
    batchResultWarningTitle: "\u6279\u91CF\u4E0A\u4F20\u90E8\u5206\u5B8C\u6210",
    batchResultErrorTitle: "\u6279\u91CF\u4E0A\u4F20\u5931\u8D25",
    batchResultDesc: "\u5DF2\u4E0A\u4F20 {count} \u4E2A\u9644\u4EF6\uFF0C\u66F4\u65B0 {docs} \u7BC7\u7B14\u8BB0{trashed}\u3002",
    batchResultFailuresPart: "\uFF1B\u53E6\u6709 {count} \u4E2A\u6587\u4EF6\u4E0A\u4F20\u5931\u8D25",
    batchResultTrashFailuresPart: "  |  \u26A0\uFE0F {count} \u4E2A\u672C\u5730\u539F\u6587\u4EF6\u6E05\u7406\u5931\u8D25",
    batchResultListTitle: "\u5DF2\u8FC1\u79FB\u9644\u4EF6\u5217\u8868 ({count})",
    batchFailuresTitle: "\u4E0A\u4F20\u5931\u8D25\u9879 ({count})",
    batchExportReport: "\u{1F4C4} \u5BFC\u51FA\u8FC1\u79FB\u62A5\u544A\u5230\u6839\u76EE\u5F55",
    batchOpenReport: "\u{1F4C2} \u6253\u5F00\u62A5\u544A",
    batchReportExported: "\u2705 \u62A5\u544A\u5DF2\u751F\u6210",
    dupResultTitle: "\u91CD\u590D\u6587\u4EF6\u5DF2\u5408\u5E76",
    dupResultDesc: "\u5DF2\u66F4\u65B0 {modified} \u7BC7\u7B14\u8BB0\uFF0C\u5904\u7406\u77E5\u8BC6\u5E93\u6587\u4EF6 {local} \u4E2A\u3001\u670D\u52A1\u5668\u6587\u4EF6 {remote} \u4E2A{skipped}\u3002",
    dupResultSkipped: "\uFF1B\u53E6\u6709 {count} \u4E2A\u4ECD\u88AB\u5F15\u7528\u7684\u6587\u4EF6\u5DF2\u4FDD\u7559",
    orphanResultTitle: "\u672A\u5F15\u7528\u6587\u4EF6\u5DF2\u5904\u7406",
    orphanResultDesc: "\u5DF2\u5904\u7406 {count} \u4E2A\u6587\u4EF6\uFF1A\u77E5\u8BC6\u5E93 {local} \u4E2A\uFF0C\u670D\u52A1\u5668 {remote} \u4E2A\u3002",
    activeNoteModalTitle: "\u5F53\u524D\u7B14\u8BB0",
    activeNoteMigrateTitle: "\u4E0A\u4F20\u5F53\u524D\u7B14\u8BB0\u7684\u9644\u4EF6",
    activeNoteDownloadTitle: "\u4E0B\u8F7D\u5F53\u524D\u7B14\u8BB0\u7684\u670D\u52A1\u5668\u9644\u4EF6",
    activeNoteStep1Desc: "\u68C0\u6D4B\u5230\u5F53\u524D\u7B14\u8BB0\u5F15\u7528\u4E86\u4EE5\u4E0B {count} \u4E2A\u672C\u5730\u9644\u4EF6\uFF0C\u8BF7\u786E\u8BA4\u8981\u4E0A\u4F20\u7684\u6587\u4EF6\u53CA\u9009\u9879\uFF1A",
    activeNoteBtnLockOff: "\u{1F513} \u4E0D\u9501\u5B9A",
    activeNoteBtnLockOn: "\u{1F512} \u9501\u5B9A",
    activeNoteLockExplain: "\u{1F4A1} \u9501\u5B9A\u8BF4\u660E\uFF1A\u5F00\u542F\u9501\u5B9A\u540E\uFF0C\u6587\u4EF6\u4E0A\u4F20\u5230\u670D\u52A1\u5668\u540E\u4F1A\u88AB\u6807\u8BB0\u4E3A\u300C\u9632\u5220\u9664\u4FDD\u62A4\u300D\uFF1B\u540E\u7EED\u5728\u6E05\u7406\u672A\u5F15\u7528\u6587\u4EF6\u6216\u5408\u5E76\u91CD\u590D\u6587\u4EF6\u65F6\u5C06\u81EA\u52A8\u8DF3\u8FC7\u8BE5\u6587\u4EF6\uFF0C\u9632\u6B62\u8BEF\u5220\u3002",
    activeNoteDeleteLocalOpt: "\u4E0A\u4F20\u540E\u5220\u9664\u672C\u5730\u539F\u6587\u4EF6\uFF08\u79FB\u5165\u56DE\u6536\u7AD9\uFF09",
    activeNoteOtherRefsBadge: "\u{1F517} \u5176\u4ED6 {count} \u7BC7\u7B14\u8BB0\u5F15\u7528",
    activeNoteOnlyCurrentRef: "\u4EC5\u672C\u7BC7\u5F15\u7528",
    activeNoteInspectOtherRefs: "\u70B9\u51FB\u67E5\u770B\u540C\u6837\u5F15\u7528\u4E86\u6B64\u9644\u4EF6\u7684\u5176\u4ED6\u7B14\u8BB0",
    activeNoteSyncOtherUploadOpt: "\u540C\u6B65\u66F4\u65B0\u5176\u4ED6\u5F15\u7528\u4E86\u76F8\u540C\u9644\u4EF6\u7684\u7B14\u8BB0\u94FE\u63A5\uFF08\u5171\u6D89\u53CA {count} \u7BC7\u5176\u4ED6\u7B14\u8BB0\uFF09",
    activeNoteSyncOtherUploadHintOn: "\u2705 \u5DF2\u5F00\u542F\u540C\u6B65\u66F4\u65B0\uFF1A\u5176\u4ED6\u7B14\u8BB0\u4E2D\u5BF9\u8BE5\u9644\u4EF6\u7684\u5F15\u7528\u4E5F\u4F1A\u4E00\u5E76\u66F4\u65B0\u4E3A\u670D\u52A1\u5668\u94FE\u63A5\uFF0C\u5220\u9664\u672C\u5730\u539F\u6587\u4EF6\u4E0D\u4F1A\u4EA7\u751F\u4EFB\u4F55\u65AD\u94FE\u3002",
    activeNoteSyncOtherUploadHintOff: "\u{1F6E1}\uFE0F \u672A\u5F00\u542F\u540C\u6B65\u66F4\u65B0\uFF1A\u4EC5\u66F4\u65B0\u5F53\u524D\u7B14\u8BB0\u3002\u4E3A\u9632\u6B62\u5176\u4ED6\u7B14\u8BB0\u51FA\u73B0\u65AD\u94FE\uFF0C\u4ECD\u88AB\u5176\u4ED6\u7B14\u8BB0\u5F15\u7528\u7684\u672C\u5730\u539F\u6587\u4EF6\u5C06\u81EA\u52A8\u4FDD\u7559\u3001\u4E0D\u4F1A\u88AB\u5220\u9664\u3002",
    activeNoteSyncOtherDownloadOpt: "\u540C\u6B65\u5C06\u5176\u4ED6\u5F15\u7528\u4E86\u76F8\u540C\u670D\u52A1\u5668\u94FE\u63A5\u7684\u7B14\u8BB0\u4E5F\u66F4\u65B0\u4E3A\u672C\u5730\u94FE\u63A5\uFF08\u5171\u6D89\u53CA {count} \u7BC7\u5176\u4ED6\u7B14\u8BB0\uFF09",
    activeNoteSyncOtherDownloadHintOn: "\u2705 \u5DF2\u5F00\u542F\u540C\u6B65\u66F4\u65B0\uFF1A\u5176\u4ED6\u7B14\u8BB0\u4E2D\u76F8\u540C\u7684\u670D\u52A1\u5668\u94FE\u63A5\u4E5F\u4F1A\u4E00\u5E76\u66FF\u6362\u4E3A\u4E0B\u8F7D\u540E\u7684\u672C\u5730\u6587\u4EF6\u94FE\u63A5\u3002",
    activeNoteSyncOtherDownloadHintOff: "\u2139\uFE0F \u672A\u5F00\u542F\u540C\u6B65\u66F4\u65B0\uFF1A\u4EC5\u66FF\u6362\u5F53\u524D\u7B14\u8BB0\u4E2D\u7684\u94FE\u63A5\uFF0C\u5176\u4ED6\u7B14\u8BB0\u7EE7\u7EED\u4FDD\u7559\u539F\u6709\u7684\u670D\u52A1\u5668\u94FE\u63A5\u3002",
    activeNoteDownOtherRefsTitle: "\u{1F517} \u68C0\u6D4B\u5230\u6709\u9644\u4EF6\u540C\u65F6\u51FA\u73B0\u5728\u5176\u4ED6 {count} \u7BC7\u7B14\u8BB0\u4E2D",
    activeNoteDownOtherRefsDesc: "\u4EE5\u4E0B\u670D\u52A1\u5668\u9644\u4EF6\u5728\u77E5\u8BC6\u5E93\u7684\u5176\u4ED6\u7B14\u8BB0\u4E2D\u4E5F\u6709\u5F15\u7528\uFF0C\u8BF7\u786E\u8BA4\u4E0B\u8F7D\u9879\u53CA\u662F\u5426\u540C\u6B65\u66F4\u65B0\u5176\u4ED6\u7B14\u8BB0\u7684\u94FE\u63A5\uFF1A",
    activeNoteStartUpload: "\u5F00\u59CB\u4E0A\u4F20 ({count})",
    activeNoteStartDownload: "\u5F00\u59CB\u4E0B\u8F7D ({count})",
    activeNoteSelectRequired: "\u8BF7\u81F3\u5C11\u9009\u62E9\u4E00\u4E2A\u8981\u5904\u7406\u7684\u9644\u4EF6",
    activeNoteFailedTitle: "\u26A0\uFE0F \u6709 {failed} \u4E2A\u9644\u4EF6\u4E0A\u4F20\u5931\u8D25",
    activeNoteDownFailedTitle: "\u26A0\uFE0F \u6709 {failed} \u4E2A\u9644\u4EF6\u4E0B\u8F7D\u5931\u8D25",
    activeNoteFailedTooLarge: "\u6587\u4EF6\u8FC7\u5927\uFF0C\u8D85\u8FC7\u670D\u52A1\u5668\u5355\u6587\u4EF6 100 MB \u9650\u5236",
    activeNoteFailedAuth: "API \u4EE4\u724C\u65E0\u6548\u6216\u672A\u6388\u6743\uFF0C\u8BF7\u68C0\u67E5\u670D\u52A1\u5668\u8FDE\u63A5\u8BBE\u7F6E",
    activeNoteFailedNotFound: "\u670D\u52A1\u5668\u4E0A\u672A\u627E\u5230\u8BE5\u6587\u4EF6 (404)",
    activeNoteFailedNetwork: "\u65E0\u6CD5\u8FDE\u63A5\u5230\u670D\u52A1\u5668\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC\u6216\u670D\u52A1\u5668\u72B6\u6001",
    activeNoteDownConflictTitle: "\u26A0\uFE0F \u68C0\u6D4B\u5230\u672C\u5730\u5DF2\u5B58\u5728 {count} \u4E2A\u91CD\u590D\u6216\u540C\u540D\u6587\u4EF6",
    activeNoteDownConflictDesc: "\u5DF2\u5BF9\u6BD4\u672C\u5730\u6587\u4EF6\u7684\u540D\u79F0\u548C\u5185\u5BB9\uFF0C\u8BF7\u9009\u62E9\u8981\u4E0B\u8F7D\u7684\u9644\u4EF6\u53CA\u540C\u540D\u6587\u4EF6\u5904\u7406\u65B9\u5F0F\uFF1A",
    activeNoteDownTagHashAndName: "\u540D\u79F0\u4E0E\u5185\u5BB9\u76F8\u540C",
    activeNoteDownTagHashOnly: "\u26A1 \u672C\u5730\u5DF2\u6709\u76F8\u540C\u5185\u5BB9\u6587\u4EF6 (SHA-256 \u4E00\u81F4)",
    activeNoteDownTagConflict: "\u26A0\uFE0F \u5DF2\u5B58\u5728\u540C\u540D\u6587\u4EF6\uFF08\u5185\u5BB9\u4E0D\u540C\uFF09",
    activeNoteDownTagReady: "\u2705 \u53EF\u76F4\u63A5\u4E0B\u8F7D",
    activeNoteDownTargetLabel: "\u76EE\u6807\u8DEF\u5F84\uFF1A{path}",
    activeNoteDownExistingMatchLabel: "\u5339\u914D\u672C\u5730\u6587\u4EF6\uFF1A{path}",
    activeNoteDownStrategyTitle: "\u91CD\u590D\u6216\u540C\u540D\u6587\u4EF6\u5904\u7406\u65B9\u5F0F",
    activeNoteDownOptReuse: "\u76F4\u63A5\u590D\u7528\u672C\u5730\u5DF2\u6709\u6587\u4EF6\uFF08\u4E0D\u91CD\u590D\u4E0B\u8F7D\uFF0C\u76F4\u63A5\u66F4\u65B0\u7B14\u8BB0\u94FE\u63A5\uFF09",
    activeNoteDownOptRename: "\u4FDD\u7559\u4E24\u8005\u5E76\u81EA\u52A8\u91CD\u547D\u540D\uFF08\u4E0B\u8F7D\u5E76\u4FDD\u5B58\u4E3A\u65B0\u526F\u672C\uFF09",
    activeNoteDownOptOverwrite: "\u8986\u76D6\u672C\u5730\u5DF2\u6709\u6587\u4EF6\uFF08\u91CD\u65B0\u4E0B\u8F7D\u5E76\u66FF\u6362\u672C\u5730\u6587\u4EF6\uFF09",
    activeNoteResultListTitle: "\u5DF2\u5904\u7406\u7684\u9644\u4EF6\u660E\u7EC6\uFF08{count}\uFF09",
    activeNoteBadgeDownloaded: "\u2705 \u5DF2\u4E0B\u8F7D",
    activeNoteBadgeReused: "\u{1F517} \u5DF2\u590D\u7528\u672C\u5730\u6587\u4EF6",
    activeNoteBadgeOverwritten: "\u{1F504} \u5DF2\u8986\u76D6\u672C\u5730\u6587\u4EF6",
    activeNoteBadgeUploaded: "\u2601\uFE0F \u5DF2\u4E0A\u4F20",
    activeNoteBadgeTrashedLocal: "\u{1F5D1}\uFE0F \u5DF2\u5220\u672C\u5730\u539F\u6587\u4EF6",
    activeNoteBadgeTrashFailed: "\u26A0\uFE0F \u6E05\u7406\u5931\u8D25",
    activeNoteTrashFailedNotice: "\u26A0\uFE0F \u4E0A\u4F20\u6210\u529F\uFF0C\u4F46\u6709 {count} \u4E2A\u672C\u5730\u539F\u6587\u4EF6\u6E05\u7406\u5931\u8D25\uFF08\u8BF7\u68C0\u67E5\u662F\u5426\u6709\u5916\u90E8\u7A0B\u5E8F\u5360\u7528\uFF09",
    activeNoteBadgeKeptForOtherRefs: "\u{1F6E1}\uFE0F \u5176\u4ED6 {count} \u7BC7\u7B14\u8BB0\u4ECD\u5F15\u7528\uFF0C\u5DF2\u4FDD\u7559\u539F\u6587\u4EF6",
    activeNoteBadgeSyncedNotes: "\u{1F517} \u540C\u6B65\u66F4\u65B0\u5176\u4ED6 {count} \u7BC7\u7B14\u8BB0",
    activeNoteScanning: "\u23F3 \u6B63\u5728\u89E3\u6790\u5F53\u524D\u7B14\u8BB0\u4E2D\u7684\u9644\u4EF6\u5F15\u7528...",
    activeNoteProcessing: "\u23F3 \u6B63\u5728\u5904\u7406 ({current}/{total}): {name}...",
    activeNoteMigrateComplete: "\u4E0A\u4F20\u5B8C\u6210",
    activeNoteDownloadComplete: "\u4E0B\u8F7D\u5B8C\u6210",
    activeNoteMigrateDoneDesc: "\u5DF2\u4E0A\u4F20\u5F53\u524D\u7B14\u8BB0\u4E2D\u7684 {count} \u4E2A\u9644\u4EF6\uFF0C\u5E76\u66F4\u65B0\u94FE\u63A5\u3002",
    activeNoteDownloadDoneDesc: "\u5DF2\u4E0B\u8F7D\u5F53\u524D\u7B14\u8BB0\u4E2D\u7684 {count} \u4E2A\u670D\u52A1\u5668\u6587\u4EF6\uFF0C\u5E76\u66F4\u65B0\u4E3A\u672C\u5730\u94FE\u63A5\u3002",
    activeNoteNoLocal: "\u26A0\uFE0F \u5F53\u524D\u7B14\u8BB0\u4E2D\u672A\u627E\u5230\u672C\u5730\u9644\u4EF6\u5F15\u7528",
    activeNoteNoRemote: "\u5F53\u524D\u7B14\u8BB0\u4E2D\u6CA1\u6709\u670D\u52A1\u5668\u6587\u4EF6\u94FE\u63A5",
    // 远端媒体资产库 UI
    galleryTitle: "\u670D\u52A1\u5668\u6587\u4EF6",
    galleryViewTitle: "\u6587\u4EF6\u5E93",
    galleryLoading: "\u6B63\u5728\u52A0\u8F7D\u670D\u52A1\u5668\u6587\u4EF6...",
    galleryLoadFail: "\u65E0\u6CD5\u52A0\u8F7D\u670D\u52A1\u5668\u6587\u4EF6\uFF1A{err}",
    gallerySearchPlaceholder: "\u641C\u7D22\u6587\u4EF6\u540D...",
    galleryFilterAllTime: "\u5168\u90E8\u76EE\u5F55",
    galleryFolderLabel: "\u76EE\u5F55",
    galleryFilterAllTypes: "\u5168\u90E8\u7C7B\u578B",
    galleryTypeLabel: "\u7C7B\u578B",
    galleryFilterImage: "\u56FE\u7247",
    galleryFilterAudio: "\u97F3\u9891",
    galleryFilterOther: "\u5176\u4ED6",
    gallerySortLabel: "\u6392\u5E8F",
    gallerySortTimeDesc: "\u6700\u65B0\u4E0A\u4F20",
    gallerySortTimeAsc: "\u6700\u65E9\u4E0A\u4F20",
    gallerySortSizeDesc: "\u5927\u5C0F\u4ECE\u5927\u5230\u5C0F",
    gallerySortSizeAsc: "\u5927\u5C0F\u4ECE\u5C0F\u5230\u5927",
    gallerySortNameAsc: "\u6587\u4EF6\u540D A-Z",
    gallerySortNameDesc: "\u6587\u4EF6\u540D Z-A",
    gallerySortHitsDesc: "\u8BBF\u95EE\u70ED\u5EA6\u4ECE\u9AD8\u5230\u4F4E",
    galleryStats: "{count} \u4E2A\u6587\u4EF6 \xB7 \u5171 {size}",
    galleryFileCount: "{count} \u4E2A\u6587\u4EF6",
    galleryTotalSize: "\u5171 {size}",
    galleryEmpty: "\u6CA1\u6709\u7B26\u5408\u6761\u4EF6\u7684\u6587\u4EF6",
    galleryBtnRefresh: "\u5237\u65B0",
    galleryBtnPreview: "\u5927\u56FE\u9884\u89C8",
    galleryBtnInsert: "\u63D2\u5165\u7B14\u8BB0",
    galleryBtnCopyRaw: "\u539F\u6587\u4EF6\u94FE\u63A5",
    galleryBtnCopyWebp: "WebP \u94FE\u63A5",
    galleryBtnCopyMd: "Markdown",
    galleryBtnUrl: "\u7F51\u5740",
    galleryTrackRaw: "\u539F\u6587\u4EF6",
    galleryTrackWebp: "WebP",
    galleryInsertModeTooltip: "\u5207\u6362\u9ED8\u8BA4\u63D2\u5165\u6A21\u5F0F\uFF08\u5F53\u524D\uFF1A{mode}\uFF0C\u70B9\u51FB\u5207\u6362\uFF09",
    galleryModeRaw: "\u539F\u6587\u4EF6",
    galleryModeWebp: "WebP",
    galleryLinkFormat: "\u63D2\u5165\u94FE\u63A5\u683C\u5F0F",
    galleryInsertFormatLabel: "\u63D2\u5165\u683C\u5F0F",
    galleryLayoutGrid: "\u7F51\u683C\u89C6\u56FE",
    galleryLayoutList: "\u5217\u8868\u89C6\u56FE",
    galleryCopied: "\u5DF2\u590D\u5236\uFF01",
    galleryInserted: "\u2705 \u5DF2\u5C06\u56FE\u7247\u63D2\u5165\u5F53\u524D\u7B14\u8BB0\u5149\u6807\u5904",
    galleryInsertedRaw: "\u2705 \u5DF2\u5C06\u9AD8\u6E05\u539F\u56FE\u63D2\u5165\u5F53\u524D\u7B14\u8BB0\u5149\u6807\u5904",
    galleryInsertedWebp: "\u2705 \u5DF2\u5C06 WebP \u4F18\u5316\u56FE\u7247\u63D2\u5165\u5F53\u524D\u7B14\u8BB0\u5149\u6807\u5904",
    galleryOpenNoteFirst: "\u8BF7\u5148\u5728\u7F16\u8F91\u5668\u4E2D\u6253\u5F00\u4E00\u7BC7\u7B14\u8BB0",
    galleryBtnLock: "\u9501\u5B9A\u9632\u5220",
    galleryBtnUnlock: "\u89E3\u9664\u9501\u5B9A",
    galleryBtnDelete: "\u79FB\u5165\u56DE\u6536\u7AD9",
    galleryDeleteConfirm: "\u5C06\u670D\u52A1\u5668\u6587\u4EF6\u201C{name}\u201D\u79FB\u5165\u56DE\u6536\u7AD9\uFF1F\n\u7B14\u8BB0\u4E2D\u6307\u5411\u6B64\u6587\u4EF6\u7684\u94FE\u63A5\u5C06\u65E0\u6CD5\u4F7F\u7528\u3002",
    galleryDeleteSuccess: '\u2705 \u5DF2\u6210\u529F\u5C06 "{name}" \u79FB\u5165\u56DE\u6536\u7AD9',
    // 操作与调试日志
    opLogTitle: "\u64CD\u4F5C\u4E0E\u8C03\u8BD5\u65E5\u5FD7",
    opLogDesc: "\u67E5\u770B\u6700\u8FD1\u64CD\u4F5C\u548C\u9519\u8BEF\uFF0C\u590D\u5236\u6216\u5BFC\u51FA\u8BB0\u5F55\u3002",
    opLogBtnOpen: "\u67E5\u770B\u65E5\u5FD7",
    opLogFilterAll: "\u5168\u90E8\u8BB0\u5F55",
    opLogFilterErrors: "\u4EC5\u8B66\u544A\u4E0E\u9519\u8BEF",
    opLogSearchPlaceholder: "\u641C\u7D22\u65E5\u5FD7\u5185\u5BB9\u6216\u6587\u4EF6\u540D...",
    opLogEmpty: "\u6682\u65E0\u7B26\u5408\u6761\u4EF6\u7684\u65E5\u5FD7\u8BB0\u5F55",
    opLogCopyAll: "\u{1F4CB} \u590D\u5236\u5168\u90E8\u65E5\u5FD7",
    opLogCopiedNotice: "\u2705 \u5DF2\u5C06\u8BCA\u65AD\u4E0E\u64CD\u4F5C\u65E5\u5FD7\u590D\u5236\u5230\u526A\u8D34\u677F",
    opLogExportFile: "\u{1F4E5} \u5BFC\u51FA\u65E5\u5FD7\u6587\u4EF6 (.log)",
    opLogClear: "\u{1F5D1}\uFE0F \u6E05\u7A7A\u65E5\u5FD7",
    opLogClearedNotice: "\u5DF2\u6E05\u7A7A\u64CD\u4F5C\u65E5\u5FD7",
    opLogPathHint: "\u65E5\u5FD7\u4FDD\u5B58\u5728\u63D2\u4EF6\u76EE\u5F55\uFF08{path}\uFF09\uFF0C\u4E0D\u4F1A\u51FA\u73B0\u5728\u77E5\u8BC6\u5E93\u6587\u4EF6\u6811\u6216\u88AB\u626B\u63CF\u529F\u80FD\u8BEF\u626B\u3002",
    cmdOpenOpLogs: "\u67E5\u770B\u64CD\u4F5C\u4E0E\u8C03\u8BD5\u65E5\u5FD7",
    closeBtn: "\u5173\u95ED"
  },
  en: {
    scanExcludedFolders: "Skip these folders: {folders}",
    catPreferences: "Other",
    hubDockGalleryHelp: "Keep the library in the sidebar for previewing and inserting files",
    hubSettingsHelp: "Manage the server connection, uploads and file naming",
    remoteTrashTitle: "Server recycle bin",
    remoteTrashHelp: "Restore removed server files so existing links work again.",
    remoteTrashLoading: "Loading the recycle bin\u2026",
    remoteTrashEmpty: "The recycle bin is empty",
    dupEmptyTitle: "No duplicate files found",
    dupChooseScopeAgain: "Choose another scope",
    remoteTrashDelete: "Delete permanently",
    remoteTrashDeleteTitle: "Permanently delete this file?",
    remoteTrashDeleteConfirm: "\u201C{name}\u201D will be deleted from the server. This cannot be undone.",
    remoteTrashDeleted: "File permanently deleted",
    remoteTrashRestore: "Restore file",
    remoteTrashRestored: "File restored",
    remoteTrashFailed: "The operation failed. Try again.",
    remoteTrashSessionError: "Restart the updated server to enable plugin access to the recycle bin, then retry.",
    remoteTrashAuthError: "Check the access token in plugin settings, then retry.",
    previewTrashConfirmTitle: "Move to recycle bin?",
    previewZoomLabel: "Image zoom",
    galleryLayoutLabel: "View mode",
    hubBack: "Back",
    hubSettingsUnavailable: "Plugin settings are unavailable",
    hubOpenNote: "Open a note first",
    hubConnect: "Connect to server",
    hubConnectHelp: "Set up the server address and access token",
    hubDockGallery: "Browse server files in sidebar",
    galleryPanelUnavailable: "Could not open the file sidebar. Please retry.",
    galleryTargetChanged: "The note changed. Return to the note and choose an insertion position.",
    galleryInsertWebp: "Insert WebP",
    galleryInsertRaw: "Insert original",
    copyFailed: "Copy failed. Select the text to copy manually.",
    previewVariant: "Preview version",
    previewZoomOut: "Zoom out",
    previewZoomIn: "Zoom in",
    previewFit: "Fit to window",
    previewActualSize: "Show actual size (100%)",
    previewGestures: "Image canvas: scroll or pinch to zoom, drag to pan, double-click to fit",
    previewProperties: "File properties",
    previewDimensions: "Displayed image dimensions",
    previewCreated: "Uploaded",
    previewSource: "Source",
    previewProtection: "Deletion protection",
    previewDanger: "Danger zone",
    previewTrashHelp: "Restore files from the recycle bin in the Hub.",
    previewLoading: "Loading preview\u2026",
    previewLoadFailed: "Could not load the image. File links are still available.",
    previewRetry: "Retry",
    pagePrevious: "Previous",
    pageNext: "Next",
    pageCount: "Page {current} of {total}",
    transferIntegrityFailed: "Content verification failed. Original files and links were preserved. Refresh the server list and retry.",
    transferReferencesChanged: "Notes changed after the final check. Local files were preserved; retry unfinished files.",
    transferSourceChanged: "The attachment changed during upload. The local file was preserved.",
    transferBusy: "Another attachment operation is running. Wait for it to finish.",
    transferNothingPending: "No unfinished upload is available to resume.",
    transferServerChanged: "The server address changed. Switch back to the original server to resume.",
    cmdResumeUpload: "Resume unfinished upload",
    transferStop: "Stop transfer",
    transferStopping: "Stopping; finishing link updates for transferred files\u2026",
    transferCancelled: "Stopped. Completed transfers have been finalized.",
    transferRetry: "Retry unfinished files",
    noticeRemoteNotReady: "Enable the server and test the connection first.",
    // Quick Hub
    hubBadge: "File tools",
    hubTitle: "File Master",
    hubSubtitle: "Eliminate redundant attachments and broken links \u2014 instant cloud acceleration and verified migration keep your vault fast and clean.",
    catGovernance: "Vault management",
    catFiles: "Remote server",
    catActiveNote: "Current file",
    catSettings: "Settings",
    // Wizards
    actHealthTitle: "Check broken links",
    actHealthDesc: "Check notes and canvases for missing files and unreachable web links.",
    actDupTitle: "Find duplicate files",
    actDupDesc: "Find identical files, choose which copy to keep, and update note links.",
    actOrphanTitle: "Find unreferenced files",
    actOrphanDesc: "Find files that no note or canvas references. Review each file before removing it.",
    actMigrateTitle: "Batch upload",
    actMigrateDesc: "Upload attachments from selected folders to the server and update note links.",
    actAnalyticsTitle: "Vault overview",
    actAnalyticsDesc: "See note, link, and file counts, plus storage use in your vault and on the server.",
    actRemoteGalleryTitle: "Browse server files",
    actRemoteGalleryDesc: "Browse server files in Obsidian, copy links, or insert files into the current note.",
    actRemoteGalleryViewTitle: "Sidebar browser",
    actRemoteGalleryViewDesc: "Keep server files in the sidebar while writing notes.",
    // Active Note Tools
    actNoteUpTitle: "Upload note attachments",
    actNoteUpDesc: "Upload local attachments referenced by this note and update its links.",
    actNoteDownTitle: "Download note attachments",
    actNoteDownDesc: "Download server files referenced by this note and update its links.",
    actNoteAstroTitle: "Copy full note (replace images with WebP links)",
    actNoteAstroDesc: "Copy this note with original image links replaced by public WebP links.",
    actOpenSettingsTitle: "Plugin settings",
    actOpenSettingsDesc: "Set the language, server connection, uploads, and excluded folders.",
    // Scan Control & Common Steps
    stepOf: "Step {current} of {total}",
    btnBack: "Previous step",
    btnCancel: "Cancel",
    btnInsert: "Insert",
    btnNext: "Next \u2794",
    btnSelectAll: "Select or deselect all",
    btnExportReport: "Export report to vault root",
    btnCancelScan: "\u23F9 Cancel Scan",
    scanCancelled: "\u23F9 Scan cancelled by user",
    scanProgress: "\u23F3 Scanning ({current}/{total}): {label}",
    // Destination Modal
    destBadge: "Insert Attachment",
    destTitle: "Insert attachment",
    destSubtitle: "Choose storage location",
    destTypeSize: "Type: .{ext}  |  Size: {size}",
    destFilenameLabel: "Filename",
    destFilenameHint: "Enter filename",
    destTargetNote: "Target note: {note}",
    destDestTitle: "Storage location",
    destRenameTitle: "Rename",
    destRenameOptional: "Edit filename (optional)",
    destSaveLocal: "\u{1F4BB} Local vault",
    destSaveLocalDesc: "Save to local attachment folder",
    destSaveRemote: "\u2601\uFE0F Remote server",
    destSaveRemoteDesc: "Upload to remote server",
    destInsertSuccess: "\u2705 Attachment saved and inserted into note",
    destTranscodeTip: "\u23F3 Decoding .{ext} preview...",
    destTranscodeFail: "\u26A0\uFE0F Local preview unavailable; server will auto-transcode upon upload",
    // Orphan Finder Wizard
    orphanStep1Title: "Unreferenced files",
    orphanStep1Desc: "Find files not referenced in note content, properties, or canvases. An unreferenced file may still be worth keeping.",
    orphanLocScope: "1. Location",
    orphanScanLocal: "Vault files",
    orphanScanRemote: "Server files",
    orphanTypeScope: "2. File types",
    orphanTypeNote: "Notes (.md, off by default)",
    orphanTypeImage: "\u{1F5BC}\uFE0F Images (png, jpg, webp, gif, svg, heic, etc.)",
    orphanTypeAudio: "\u{1F3B5} Audio (mp3, m4a, wav, flac, etc.)",
    orphanTypeOther: "\u{1F4E6} Other Files (Video, PDF, archives, documents)",
    orphanLocRequired: "Please select at least one scan location (local or remote).",
    orphanTypeRequired: "Please select at least one file type.",
    orphanScanning: "\u23F3 Scanning vault references...",
    orphanStep2Title: "Found {count} unreferenced files",
    orphanNoneFound: "No unreferenced files found in the selected scope.",
    orphanDeleteSelected: "Move to trash ({count})",
    orphanDeleteConfirm: "Move {count} selected files to trash?\nMake sure you no longer need them.",
    orphanDeleting: "Moving files...",
    orphanDeleteSuccess: "Processed {count} files.",
    // Duplicate Files Wizard
    dupStep1Title: "Duplicate files",
    dupStep1Desc: "Find files with identical content, even when their names differ.",
    dupLocScope: "1. Compare",
    dupCompareLocal: "Vault files only",
    dupCompareCross: "Vault and server files",
    dupCompareRemote: "Server files only",
    dupStrategyLabel: "Strategy:",
    dupStrategyAuto: "1. Auto-select item to keep (Recommended)",
    dupStrategyPreferRemote: "2. Replace local files with remote copies (Vault Slimming)",
    dupStrategyPreferLocal: "3. Keep local files and remove remote duplicates",
    dupGroupHeader: "Duplicate Group #{idx} (SHA-256: {hash}... | Size: {size})",
    dupGroupSubhint: "Click thumbnail to inspect; click reference count to view notes",
    dupTagKeep: "\u2705 Keep",
    dupTagProtected: "\u{1F512} Protected",
    dupTagRemove: "\u{1F5D1}\uFE0F Remove",
    dupTypeScope: "2. File types",
    dupTypeImage: "Images",
    dupTypeAudio: "Audio",
    dupTypeOther: "\u{1F4E6} Other Media & Attachments",
    dupTypeNote: "Notes (.md, off by default)",
    dupComparing: "\u23F3 Calculating SHA-256 hashes and resolving references...",
    dupDesignateKeepTitle: "Keep this copy",
    lockBtnText: "Protect from deletion",
    lockBtnTitle: "Prevent accidental deletion of this server file; protection can be removed later",
    dupStep2Title: "Found {groups} duplicate groups and {redundant} extra copies",
    dupNoneFound: "No duplicate files found in the selected scope.",
    dupAutoSelect: "Select extra copies",
    dupMergeRewrite: "Merge and update links ({count})",
    dupMergeConfirm: "Merge {count} selected copies?\nNote links will be updated to point to the copies you keep.",
    dupMerging: "Merging files and updating note links...",
    dupMergeSuccess: "Merged {count} duplicate files.",
    // Batch Cloud Migration Wizard
    migrateStep1Title: "Batch upload",
    migrateStep1Desc: "Upload attachments to the server and update links in your notes.",
    migrateFolderScope: "1. Folder",
    migrateEntireVault: "Entire vault (skip excluded folders)",
    migrateTypeScope: "2. File types",
    migrateTypeImage: "\u{1F5BC}\uFE0F Image Attachments (png, jpg, heic, webp, gif, svg, etc.)",
    migrateTypeAudio: "\u{1F3B5} Audio Attachments (mp3, m4a, wav, flac, ogg, etc.)",
    migrateTypeOther: "\u{1F4E6} Other Attachments (video, PDF, archives, documents, etc.)",
    migratePolicyTitle: "3. Upload options",
    migrateDeleteLocal: "After upload and link updates, move local files with no remaining references to trash",
    migrateUploadProtected: "Upload to protected server folder (deletion protection can be removed)",
    migrateNextPreview: "Preview files",
    migrateSelectTypeNotice: "Please select at least one attachment type.",
    migrateScanning: "\u23F3 Scanning local attachments and references...",
    migrateStep2Title: "Files to upload ({count})",
    migrateNoneFound: "No matching attachments in the selected folder.",
    migrateSelectOnlyRef: "Select referenced files only",
    migrateNoteRefs: "{count} references",
    migrateInspectRefs: "View notes that reference this file",
    migrateSelectNotice: "Please select at least one local attachment to migrate.",
    migrateStart: "Upload and update links ({count})",
    migrateProgress: "Uploading ({current}/{total}): {name}",
    migrateSuccess: "Uploaded {count} attachments and updated note links.",
    // Vault Link Health Check
    healthStep1Title: "Broken links",
    healthStep1Desc: "Can check internal links, local file links, and web links in notes and canvases.",
    healthScopeTitle: "What to check",
    healthCheckWiki: "Links to missing notes",
    healthCheckLocal: "Links to missing local files",
    healthCheckRemote: "Web links (HTTP check; may take longer)",
    healthScopeHint: "Scans .md and .canvas files in your vault, except reports generated by this plugin.",
    healthStartScan: "Check links",
    healthScanning: "\u23F3 Scanning vault notes for broken link references...",
    healthStep2Title: "Checked {docs} documents; found {issues} issues",
    healthStatNotes: "Documents checked",
    healthStatWiki: "Broken note links",
    healthStatLocal: "Missing Local Files",
    healthStatRemote: "Web link errors",
    healthRescan: "Check again",
    healthFilterAll: "All Issues",
    healthSearchPlaceholder: "Filter by note or target...",
    healthNoMatches: "No issues match the current filter/search.",
    healthTagWikiEmbed: "\u{1F534} Wiki Embed",
    healthTagDanglingNote: "\u{1F534} Dangling Note",
    healthTagMissingImage: "\u{1F4C1} Missing Image",
    healthTagMissingFile: "\u{1F4C1} Missing Local File",
    healthTagRemote404: "Web link error",
    healthLine: "Line {line}",
    healthInNote: "\u{1F4C4} In Note: {path}",
    healthJumpToLine: "\u{1F3AF} Open Note \u2794",
    healthNoneFound: "No link issues found in the selected scope.",
    // Vault Storage Analytics
    analyticsTitle: "Vault overview",
    analyticsBadge: "Overview",
    analyticsLoading: "Counting notes, attachments, and server files...",
    analyticsStatNotes: "Notes",
    analyticsStatImages: "Images",
    analyticsStatOtherAttachments: "Other Attachments",
    analyticsStatTotalFiles: "Total",
    analyticsStatNotesSub: "{md} notes \xB7 {cva} canvases",
    analyticsStatImagesSub: "Local {loc} \xB7 Remote {rem}",
    analyticsStatOtherSub: "Video, audio, docs, etc.",
    analyticsStatTotalSub: "All notes and assets",
    analyticsStorageComparison: "Storage footprint",
    analyticsLocalVault: "Local attachments",
    analyticsRemoteServer: "Server assets",
    analyticsLocalStats: "Images: {imgBytes} \xB7 Other: {othBytes}",
    analyticsRemoteStats: "WebP cache: {cache} \xB7 Protected: {locked}",
    analyticsInsightsTitle: "Health & optimization insights",
    analyticsInsightStorageLocal: 'Local storage is high (<strong style="color: var(--text-accent);">{pct}%</strong>); consider offloading large files to the server.',
    analyticsInsightStorageRemote: 'Cloud-primary storage (<strong style="color: #10b981;">{pct}%</strong>), reducing local footprint and mobile sync traffic.',
    analyticsInsightCacheReady: 'WebP cache <strong style="color: #10b981;">100% ready</strong>, optimizing client loading bandwidth.',
    analyticsInsightLockedSafe: '<strong style="color: #10b981;">{count}</strong> server assets are locked with delete protection.',
    analyticsTopLargest: "10 largest attachments",
    analyticsFilterAll: "All",
    analyticsFilterLocal: "\u{1F4BB} Local",
    analyticsFilterRemote: "\u2601\uFE0F Remote",
    analyticsFilterEmpty: "No attachments under current filter",
    analyticsRefUsed: "Referenced",
    analyticsRefUnused: "Unreferenced",
    analyticsCopiedName: "Copied file name: {name}",
    analyticsClickToCopy: "Click to copy file name, hover for preview",
    analyticsBadgeLocal: "\u{1F4BB} Local",
    analyticsBadgeRemote: "\u2601\uFE0F Remote",
    analyticsFail: "Failed to compute vault analytics: {err}",
    analyticsExportReport: "Export vault report (.md)",
    // Confirm Dialogs and Notices
    confirmRemoteOrphanTitle: "Move to trash?",
    confirmRemoteOrphanMsg: "Move {count} server files ({size}) to trash? Make sure you no longer need them.",
    confirmRemoteOrphanBtn: "Move to trash ({count})",
    confirmRemoteDupTitle: "Merge server files?",
    confirmRemoteDupMsg: "Move {count} server copies ({size}) to trash? Note links will first be updated to the copies you keep.",
    confirmRemoteDupBtn: "Update links and move to trash ({count})",
    noDupToProcess: "No duplicate files to process",
    noticeSavedLocal: "\u{1F4BB} Saved to local vault: {path}",
    noticeFailedLocal: "\u274C Failed to save locally: {err}",
    noticeUploadedRemote: "Uploaded to server and inserted link: {name}",
    noticeUploadFailed: "Could not upload to server: {err}",
    noticeCopiedRaw: "\u{1F4CE} Copied raw original link: {name}",
    noticeCopiedWebp: "\u26A1 Copied optimized WebP link: {name}",
    noticeExclAdded: '\u{1F6E1}\uFE0F Added folder "{path}" to scan exclusion list (ignored in scans)',
    noticeExclRemoved: '\u{1F513} Removed folder "{path}" from scan exclusion list',
    noticeOpenMdFirst: "Please open an active note (Markdown, Canvas, or Excalidraw) first.",
    noticeNoRemoteInActive: "No server file links in this note.",
    noticeNoLocalInActive: "No local attachments found to migrate in active note.",
    noticeAstroCopied: "\u2705 Copied active note text with public WebP links to clipboard!",
    // Settings Tabs
    settingsTitle: "File Master settings",
    settingsBack: "Back to settings",
    settingsCoreGroup: "Core Features",
    settingsPreferencesGroup: "Preferences",
    settingsToolsGroup: "Tools & Logs",
    settingsInfoGroup: "Plugin Information",
    tabGeneral: "General",
    tabServer: "Server Connection",
    tabUpload: "Attachments",
    tabExemptions: "Exemptions & Protection",
    // General & Language
    langName: "Interface Language",
    langDesc: "Choose the language for File Master",
    langAuto: "Follow Obsidian",
    sidebarBtnName: "Show ribbon button",
    sidebarBtnDesc: "Show the File Master button in the left Obsidian ribbon",
    clipboardMonitorName: "Handle pasted and dropped files",
    clipboardMonitorDesc: "Use your attachment destination for pasted or dropped files",
    // Remote Server
    enableRemoteServerName: "Connect to server",
    enableRemoteServerDesc: "Enable server uploads and file browsing",
    serverVerifiedBadge: "Connected",
    serverUnverifiedBadge: "Not tested",
    serverDisabledHint: "Server connection is off. Only local vault features are available.",
    serverUnverifiedHint: "Test the server connection before using server files.",
    serverUrlName: "Server URL",
    serverUrlDesc: "For example, https://files.example.com or http://192.168.1.100:3210",
    apiTokenName: "API token",
    apiTokenDesc: "Copy the upload API token from Site settings on your server",
    showToken: "Show token",
    hideToken: "Hide token",
    btnTestConn: "Test connection",
    testConnSuccess: "Connected. Server{ver} has {count} files.",
    testConnFail: "\u274C Connection failed: {err}",
    compatWarn: "\u26A0\uFE0F Compatibility warning: Server requires File Master Plugin >= v{minVer} (current: v{currentVer}). Please update the plugin.",
    compatWarnServer: "\u26A0\uFE0F Server version warning: Server is v{serverVer}, plugin recommends >= v{minServerVer}. Some features may be restricted.",
    compatStatusChecking: "Checking connection and versions...",
    compatStatusOk: "Connected \xB7 Server v{serverVer} \xB7 {count} files",
    compatStatusServerOld: "Server v{serverVer} is too old. The plugin needs v{minServerVer} or later. Update it in the server console.",
    compatStatusPluginOld: "Update plugin v{currentVer} to v{minPluginVer} or later.",
    compatStatusAuthFail: "Invalid token. Copy it from the server and test again.",
    compatStatusTokenMissing: "Enter the upload API token from your server first.",
    compatStatusServerError: "Server error ({code}). Try again later.",
    compatStatusOffline: "Cannot connect. Check the address and network. {err}",
    // Upload & Links
    saveLocationName: "Where to save attachments",
    saveLocationDesc: "Choose where pasted or dropped files go. Files are saved locally if the server is offline.",
    defaultSaveLocationName: "Default when asking",
    defaultSaveLocationDesc: "Preselected storage destination when prompting to insert attachments",
    optSaveAsk: "Ask every time",
    optSaveRemote: "Upload to server",
    optSaveLocal: "Save to vault",
    insertOptimizedName: "Insert WebP links",
    insertOptimizedDesc: "Use WebP links when on, original file links when off",
    namingStrategyName: "Attachment Naming Strategy",
    namingStrategyDesc: "Choose how new attachments are named",
    optNamingKeep: "Keep filename",
    optNamingRule: "Use naming pattern",
    optNamingPrompt: "Ask each time",
    namingPatternName: "Naming template",
    namingPatternDesc: "Variables: {note} Note title, {origin} Original name, {date} YYYYMMDD, {time} HHMMSS, {timestamp} Epoch, {rand:4} Hex, {hash:8} SHA-256",
    uploadNonImageName: "Process non-image attachments",
    uploadNonImageDesc: "Support audio, video, PDF and other attachments for local saving or remote migration",
    destFixedLocalHint: "\u{1F4CC} Configured to save to local vault",
    destFixedRemoteHint: "\u{1F4CC} Configured to upload to server",
    destFixedRemoteFallbackHint: "\u26A0\uFE0F Configured to upload to server, but server is offline. Falling back to local vault.",
    tagLocked: "Locked",
    remoteServerRequiredNotice: "Please configure and verify a remote server first.",
    // Protection & Rules
    excludedFoldersName: "Folders to skip",
    excludedFoldersDesc: "Comma-separated directory paths (e.g. templates, assets/protected). Or right-click any folder in file tree",
    excludeLockedRemoteName: "Skip protected server files",
    excludeLockedRemoteDesc: "Skip server files protected from deletion when finding unreferenced or duplicate files",
    openHubName: "Open file tools",
    openHubDesc: "Check links, organize files, and view vault statistics",
    btnOpenHub: "Open File Master",
    // About Footer
    aboutTitle: "About File Master",
    aboutDesc: "Manage attachments and links in Obsidian, with optional self-hosted file storage and sharing.",
    aboutAuthor: "Author",
    aboutRepo: "GitHub Repository",
    aboutFeedback: "Report an Issue",
    aboutFeedbackLink: "Open GitHub Issues",
    aboutServerCompat: "Server Compatibility",
    aboutServerStatus: "Connected Server",
    aboutServerOffline: "Offline",
    // Context Menus
    menuMigrateFolder: "File Master: Upload attachments in this folder...",
    menuRemoveExclusion: "File Master: Include this folder in scans",
    menuAddExclusion: "File Master: Skip this folder in scans",
    menuUploadCloud: "File Master: Upload to server and update links",
    menuUploadProtected: "File Master: Upload to protected server folder",
    menuCopyRaw: "File Master: Copy original file URL ({name})",
    menuCopyWebp: "File Master: Copy WebP URL",
    menuDownloadToVault: "File Master: Download to vault and update links ({name})",
    menuLockRemote: "File Master: Protect from deletion ({name})",
    menuActiveNoteMigrate: "File Master: Upload attachments in this note",
    menuActiveNoteDownload: "File Master: Download server files in this note",
    menuActiveNoteAstro: "File Master: Copy this note with WebP links",
    // Command Palette
    cmdOpenHub: "Open File Master",
    cmdScanHealth: "Check broken links",
    cmdScanOrphan: "Find unreferenced files",
    cmdScanDuplicate: "Find duplicate files",
    cmdBatchMigrate: "Batch upload",
    cmdVaultAnalytics: "Vault overview",
    cmdMigrateActiveNote: "Upload attachments in this note",
    cmdDownloadActiveNote: "Download server files in this note",
    cmdCopyAstroLinks: "Copy full note (replace images with WebP links)",
    cmdRemoteGallery: "Browse server files",
    cmdRemoteGalleryView: "Browse server files in sidebar",
    // Notices & Modals
    scanPreparing: "\u23F3 Preparing scan...",
    noticeProtectedRemote: "Protected server file from deletion: {name}",
    noticeLockFailed: "\u274C Lock failed: {err}",
    noticeSaveCancelled: "Attachment saving cancelled",
    noticeRemoteUnreachable: "Could not reach the server ({err}). Showing unreferenced vault files only.",
    noticeReportGenerated: "\u{1F4C4} Generated report in vault root: {path}",
    noticeRemoteDeleteFailed: "\u274C Failed to delete remote file ({name}): {err}",
    noticeCleanupComplete: "Processed {local} vault files and {remote} server files.",
    noticeCannotOpenFile: "Cannot open file: {path}",
    noticeUploadingFile: 'Uploading "{name}"...',
    noticeMigrateSuccess: 'Uploaded "{name}" to the server{protected} and updated links in {docs} notes.',
    noticeMigrateFailed: "\u274C Upload migration failed ({name}): {err}",
    noticeDownloadingFile: '\u23F3 Downloading remote "{name}" to vault...',
    noticeDownloadedToVault: 'Saved "{name}" to the vault ({path}) and updated links in {docs} notes.',
    noticeDownloadFailed: "\u274C Failed to download to vault: {err}",
    noticeDownloadedBatch: "\u{1F389} Downloaded {count} remote attachment(s) to vault and updated links!",
    noticeBatchMigrateSuccess: "Uploaded {count} files and updated {docs} notes{trashed}.",
    noticeBatchMigrateTrashedPart: ", and moved {trashed} local files to trash",
    noticeNoteMigrateSuccess: "Uploaded {count} attachments in this note and updated its links.",
    noticeDedupSafetyWarning: "Updated {modified} notes and processed {local} vault files and {remote} server files. Kept {skipped} files that are still referenced.",
    noticeDedupSuccess: "Updated {modified} notes and processed {local} vault files and {remote} server files.",
    previewTitle: "File preview: {name}",
    previewTitleLabel: "File preview",
    previewLinksTitle: "Copy links",
    previewSourceLocal: "Local vault",
    previewSourceRemote: "Server",
    previewMeta: "{source} \xB7 Path: {path} \xB7 Size: {size}",
    previewPathLabel: "Location",
    previewSizeLabel: "File size",
    previewCopyMarkdown: "Copy Markdown",
    previewCopyUrl: "Copy file URL",
    previewInsert: "Insert into note",
    previewProtected: "Protected from deletion",
    previewUnprotected: "Deletion protection removed",
    previewLockFailed: "Could not change protection: {err}",
    previewDeleteFailed: "Could not move file: {err}",
    previewOpenBrowser: "Open in browser",
    previewNonImageTip: "This is a .{ext} file. Open it in Obsidian or your browser.",
    btnOpenInObsidian: "\u{1F4C2} Open in Obsidian",
    btnOpenRawInBrowser: "Open original file in browser",
    noteRefsTitle: '\u{1F517} Notes Referencing "{name}" ({count})',
    noteRefsNone: "This file is currently not referenced by any notes.",
    btnOpenNote: "\u2197 Open Note",
    noteRefsNotFound: "Note not found: {path}",
    thumbEnlargeTooltip: "Click to enlarge preview",
    thumbDetailsTooltip: "View file details",
    orphanSelectRequired: "Please select at least one file to clean.",
    dupSelectTypeRequired: "Please select at least one file type to compare.",
    btnConfirm: "Confirm",
    noticeInstantUpload: "An identical file already exists on the server. Reused its link.",
    // Asset Processing Progress & Result Modal
    destProcessingTitle: "Processing attachment...",
    destProbeChecking: "Checking whether this file is already on the server...",
    destUploadingRemote: "Uploading to server...",
    destSavingLocal: "Saving to local vault...",
    destResultTitle: "Attachment processed",
    destInstantBadge: "File already on server",
    destInstantDesc: "Reused the existing server file without uploading its content again.",
    destSuccessBadge: "Uploaded to server",
    destSuccessDesc: "File uploaded to the server and link inserted.",
    destLocalBadge: "Saved to vault",
    destLocalDesc: "File saved to the vault and link inserted.",
    destInsertedNotice: "\u2705 Reference inserted at cursor in active note",
    destLabelRawUrl: "Raw URL:",
    destLabelPubUrl: "Public WebP URL:",
    destLabelLocalPath: "Local Vault Path:",
    destLabelMarkdown: "Markdown Reference:",
    destBtnCopy: "Copy",
    destBtnCopied: "Copied!",
    destBtnDone: "Done",
    destProcessingError: "\u274C Processing Failed: {err}",
    // Wizard Results & Active Note Modal
    batchResultTitle: "Batch upload complete",
    batchResultWarningTitle: "Batch upload partially complete",
    batchResultErrorTitle: "Batch upload failed",
    batchResultDesc: "Uploaded {count} attachments and updated {docs} notes{trashed}.",
    batchResultFailuresPart: "; {count} file(s) failed to upload",
    batchResultTrashFailuresPart: "  |  \u26A0\uFE0F Failed to remove {count} local file(s)",
    batchResultListTitle: "Migrated Assets ({count})",
    batchFailuresTitle: "Upload Failures ({count})",
    batchExportReport: "\u{1F4C4} Export report to vault root",
    batchOpenReport: "\u{1F4C2} Open Report",
    batchReportExported: "\u2705 Report Generated",
    dupResultTitle: "Duplicate files merged",
    dupResultDesc: "Updated {modified} notes and processed {local} vault files and {remote} server files{skipped}.",
    dupResultSkipped: "; kept {count} files that are still referenced",
    orphanResultTitle: "Unreferenced files processed",
    orphanResultDesc: "Processed {count} files: {local} in the vault and {remote} on the server.",
    activeNoteModalTitle: "Current note",
    activeNoteMigrateTitle: "Upload attachments in this note",
    activeNoteDownloadTitle: "Download server files in this note",
    activeNoteStep1Desc: "Found {count} local attachments referenced in this note. Select files and options before uploading:",
    activeNoteBtnLockOff: "\u{1F513} Unlocked",
    activeNoteBtnLockOn: "\u{1F512} Locked",
    activeNoteLockExplain: "\u{1F4A1} About Lock: Locked files are marked with deletion protection on the server and automatically skipped when cleaning unreferenced or duplicate files.",
    activeNoteDeleteLocalOpt: "Delete local files after upload (move to trash)",
    activeNoteOtherRefsBadge: "\u{1F517} Referenced by {count} other note(s)",
    activeNoteOnlyCurrentRef: "Only this note",
    activeNoteInspectOtherRefs: "Click to view other notes referencing this attachment",
    activeNoteSyncOtherUploadOpt: "Also update links in other notes referencing the same attachment ({count} other note(s))",
    activeNoteSyncOtherUploadHintOn: "\u2705 Sync enabled: Other notes referencing this attachment will also be updated to the server URL, so deleting the local file will not break any links.",
    activeNoteSyncOtherUploadHintOff: "\u{1F6E1}\uFE0F Sync disabled: Only this note will be updated. Local files still referenced by other notes will be automatically kept to prevent broken links.",
    activeNoteSyncOtherDownloadOpt: "Also update the same server links in other notes to local links ({count} other note(s))",
    activeNoteSyncOtherDownloadHintOn: "\u2705 Sync enabled: Identical server links in other notes will also be updated to the local file.",
    activeNoteSyncOtherDownloadHintOff: "\u2139\uFE0F Sync disabled: Only links in this note will be updated; other notes will keep their server links.",
    activeNoteDownOtherRefsTitle: "\u{1F517} Attachment links also appear in {count} other note(s)",
    activeNoteDownOtherRefsDesc: "These server attachments are also referenced in other notes. Confirm files to download and whether to sync links in other notes:",
    activeNoteStartUpload: "Upload ({count})",
    activeNoteStartDownload: "Download ({count})",
    activeNoteSelectRequired: "Please select at least one attachment to process",
    activeNoteFailedTitle: "\u26A0\uFE0F {failed} attachment(s) failed to upload",
    activeNoteDownFailedTitle: "\u26A0\uFE0F {failed} attachment(s) failed to download",
    activeNoteFailedTooLarge: "File too large (exceeds server 100 MB limit)",
    activeNoteFailedAuth: "Invalid or unauthorized API token. Check server settings.",
    activeNoteFailedNotFound: "File not found on server (404)",
    activeNoteFailedNetwork: "Could not connect to server. Check network or server status.",
    activeNoteDownConflictTitle: "\u26A0\uFE0F Found {count} duplicate or same-named local file(s)",
    activeNoteDownConflictDesc: "Local filenames and contents have been compared. Choose files to download and how to handle matches:",
    activeNoteDownTagHashAndName: "Same name and content",
    activeNoteDownTagHashOnly: "\u26A1 Identical content exists locally (SHA-256 match)",
    activeNoteDownTagConflict: "\u26A0\uFE0F Same filename exists (different content)",
    activeNoteDownTagReady: "\u2705 Ready to download",
    activeNoteDownTargetLabel: "Target path: {path}",
    activeNoteDownExistingMatchLabel: "Matched local file: {path}",
    activeNoteDownStrategyTitle: "How to handle duplicate or same-named files",
    activeNoteDownOptReuse: "Reuse existing local file (skip download and update note links)",
    activeNoteDownOptRename: "Keep both and auto-rename (download and save as a new copy)",
    activeNoteDownOptOverwrite: "Overwrite existing local file (download and replace existing file)",
    activeNoteResultListTitle: "Processed attachments ({count})",
    activeNoteBadgeDownloaded: "\u2705 Downloaded",
    activeNoteBadgeReused: "\u{1F517} Reused local file",
    activeNoteBadgeOverwritten: "\u{1F504} Overwritten",
    activeNoteBadgeUploaded: "\u2601\uFE0F Uploaded",
    activeNoteBadgeTrashedLocal: "\u{1F5D1}\uFE0F Local file trashed",
    activeNoteBadgeTrashFailed: "\u26A0\uFE0F Cleanup failed",
    activeNoteTrashFailedNotice: "\u26A0\uFE0F Upload succeeded, but {count} local file(s) failed to be moved to trash.",
    activeNoteBadgeKeptForOtherRefs: "\u{1F6E1}\uFE0F Kept (used in {count} other note(s))",
    activeNoteBadgeSyncedNotes: "\u{1F517} Updated {count} other note(s)",
    activeNoteScanning: "\u23F3 Scanning attachments referenced in active note...",
    activeNoteProcessing: "\u23F3 Processing ({current}/{total}): {name}...",
    activeNoteMigrateComplete: "Upload complete",
    activeNoteDownloadComplete: "Download complete",
    activeNoteMigrateDoneDesc: "Uploaded {count} attachments in this note and updated its links.",
    activeNoteDownloadDoneDesc: "Downloaded {count} server files in this note and updated their links to local files.",
    activeNoteNoLocal: "\u26A0\uFE0F No local attachments found in active note",
    activeNoteNoRemote: "No server file links in this note",
    // Remote Asset Gallery UI
    galleryTitle: "Server files",
    galleryViewTitle: "Server files",
    galleryLoading: "Loading server files...",
    galleryLoadFail: "Could not load server files: {err}",
    gallerySearchPlaceholder: "Search filenames...",
    galleryFilterAllTime: "All folders",
    galleryFolderLabel: "Folder",
    galleryFilterAllTypes: "All types",
    galleryTypeLabel: "Type",
    galleryFilterImage: "Images",
    galleryFilterAudio: "Audio",
    galleryFilterOther: "Others",
    gallerySortLabel: "Sort",
    gallerySortTimeDesc: "Newest first",
    gallerySortTimeAsc: "Oldest first",
    gallerySortSizeDesc: "Size: Largest first",
    gallerySortSizeAsc: "Size: Smallest first",
    gallerySortNameAsc: "Filename: A to Z",
    gallerySortNameDesc: "Filename: Z to A",
    gallerySortHitsDesc: "Hits: Most viewed",
    galleryStats: "{count} files \xB7 {size} total",
    galleryFileCount: "{count} files",
    galleryTotalSize: "{size} total",
    galleryEmpty: "No matching files",
    galleryBtnRefresh: "Refresh",
    galleryBtnPreview: "Preview",
    galleryBtnInsert: "Insert into note",
    galleryBtnCopyRaw: "Original URL",
    galleryBtnCopyWebp: "WebP URL",
    galleryBtnCopyMd: "Markdown",
    galleryBtnUrl: "URL",
    galleryTrackRaw: "Original",
    galleryTrackWebp: "WebP",
    galleryInsertModeTooltip: "Toggle default insert mode (Current: {mode})",
    galleryModeRaw: "Original",
    galleryModeWebp: "WebP",
    galleryLinkFormat: "Link format for insertion",
    galleryInsertFormatLabel: "Insert as",
    galleryLayoutGrid: "Grid View",
    galleryLayoutList: "List View",
    galleryCopied: "Copied!",
    galleryInserted: "\u2705 Inserted markdown reference into active note",
    galleryInsertedRaw: "\u2705 Inserted raw original image reference into active note",
    galleryInsertedWebp: "\u2705 Inserted WebP optimized image reference into active note",
    galleryOpenNoteFirst: "Please open a markdown note in the editor first",
    galleryBtnLock: "Lock",
    galleryBtnUnlock: "Unlock",
    galleryBtnDelete: "Move to trash",
    galleryDeleteConfirm: 'Move server file "{name}" to trash?\nLinks to this file in notes will stop working.',
    galleryDeleteSuccess: '\u2705 Successfully moved "{name}" to trash',
    // Operation & Debug Logs
    opLogTitle: "Operation & debug logs",
    opLogDesc: "View recent actions and errors, or copy and export the log.",
    opLogBtnOpen: "View logs",
    opLogFilterAll: "All entries",
    opLogFilterErrors: "Warnings & errors only",
    opLogSearchPlaceholder: "Search logs or filenames...",
    opLogEmpty: "No matching log entries found",
    opLogCopyAll: "\u{1F4CB} Copy all logs",
    opLogCopiedNotice: "\u2705 Copied diagnostic & operation logs to clipboard",
    opLogExportFile: "\u{1F4E5} Export log file (.log)",
    opLogClear: "\u{1F5D1}\uFE0F Clear logs",
    opLogClearedNotice: "Cleared operation logs",
    opLogPathHint: "Logs are saved in the plugin folder ({path}) and will never appear in the vault tree or trigger scans.",
    cmdOpenOpLogs: "View operation & debug logs",
    closeBtn: "Close"
  }
};
function getEffectiveLanguage(lang) {
  var _a, _b;
  if (lang === "zh" || lang === "en") {
    return lang;
  }
  try {
    const obsLang = typeof import_obsidian3.getLanguage === "function" && (0, import_obsidian3.getLanguage)() || typeof document !== "undefined" && ((_a = document.documentElement) == null ? void 0 : _a.lang) || typeof window !== "undefined" && ((_b = window.localStorage) == null ? void 0 : _b.getItem("language")) || typeof navigator !== "undefined" && navigator.language || "en";
    return String(obsLang).toLowerCase().startsWith("zh") ? "zh" : "en";
  } catch (e) {
    return "en";
  }
}
function translateUi(lang, key, params = {}) {
  const effective = getEffectiveLanguage(lang);
  const dict = UI_STRINGS[effective] || UI_STRINGS.zh;
  let str = dict[key] || UI_STRINGS.en[key] || UI_STRINGS.zh[key] || key;
  for (const [k, v] of Object.entries(params)) {
    str = str.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
  }
  return str;
}

// src/plugin/logging.js
function getEffectiveLanguage2(settings) {
  return getEffectiveLanguage(settings == null ? void 0 : settings.language);
}
function t(plugin, key, params = {}) {
  return translateUi(getEffectiveLanguage2(plugin.settings), key, params);
}
function isRemoteServerReady(settings) {
  return Boolean((settings == null ? void 0 : settings.enableRemoteServer) && (settings == null ? void 0 : settings.serverVerified));
}
function getLogFilePath(plugin) {
  var _a, _b, _c, _d;
  const dir = ((_a = plugin.manifest) == null ? void 0 : _a.dir) || `${((_c = (_b = plugin.app) == null ? void 0 : _b.vault) == null ? void 0 : _c.configDir) || ".obsidian"}/plugins/${((_d = plugin.manifest) == null ? void 0 : _d.id) || "file-master"}`;
  return `${dir}/operation.log`;
}
async function loadOperationLogs(plugin) {
  var _a, _b;
  if (!Array.isArray(plugin.operationLogs)) {
    plugin.operationLogs = [];
  }
  try {
    const adapter = (_b = (_a = plugin.app) == null ? void 0 : _a.vault) == null ? void 0 : _b.adapter;
    const logPath = getLogFilePath(plugin);
    if (adapter && await adapter.exists(logPath)) {
      const raw = await adapter.read(logPath);
      const parsed = [];
      for (const line of String(raw || "").split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          parsed.push(JSON.parse(trimmed));
        } catch (e) {
        }
      }
      plugin.operationLogs = parsed.slice(-500);
    }
  } catch (e) {
  }
  return plugin.operationLogs;
}
async function saveOperationLogs(plugin) {
  var _a, _b;
  try {
    const adapter = (_b = (_a = plugin.app) == null ? void 0 : _a.vault) == null ? void 0 : _b.adapter;
    if (!adapter) return;
    const logPath = getLogFilePath(plugin);
    const lines = (plugin.operationLogs || []).slice(-500).map((entry) => JSON.stringify(entry));
    await adapter.write(logPath, lines.join("\n") + (lines.length ? "\n" : ""));
  } catch (e) {
  }
}
function logOperation(plugin, level, action, summary, details = null) {
  if (!Array.isArray(plugin.operationLogs)) {
    plugin.operationLogs = [];
  }
  const now = /* @__PURE__ */ new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const entry = {
    ts,
    level: String(level || "INFO").toUpperCase(),
    action: String(action || "GENERAL"),
    summary: String(summary || "")
  };
  if (details && typeof details === "object" && Object.keys(details).length > 0) {
    entry.details = details;
  }
  plugin.operationLogs.push(entry);
  if (plugin.operationLogs.length > 500) {
    plugin.operationLogs = plugin.operationLogs.slice(-500);
  }
  saveOperationLogs(plugin);
}
async function clearOperationLogs(plugin) {
  plugin.operationLogs = [];
  await saveOperationLogs(plugin);
}
function formatLogsForExport(plugin) {
  var _a, _b, _c;
  const version = ((_a = plugin.manifest) == null ? void 0 : _a.version) || "1.0.2";
  const serverStatus = plugin.lastServerCompatStatus ? `${plugin.lastServerCompatStatus.status} (server v${plugin.lastServerCompatStatus.serverVersion || "?"})` : ((_b = plugin.settings) == null ? void 0 : _b.enableRemoteServer) ? "unverified" : "disabled";
  const header = [
    `# File Master Diagnostic & Operation Logs`,
    `# Plugin Version: v${version}`,
    `# Exported At: ${(/* @__PURE__ */ new Date()).toISOString()}`,
    `# Server Status: ${serverStatus}`,
    `# Excluded Local Folders: ${((_c = plugin.settings) == null ? void 0 : _c.excludedLocalFolders) || "(none)"}`,
    `# Total Entries: ${(plugin.operationLogs || []).length}`,
    `------------------------------------------------------------`
  ];
  const body = (plugin.operationLogs || []).map((e) => {
    const detailStr = e.details ? ` | ${JSON.stringify(e.details)}` : "";
    return `[${e.ts}] [${e.level}] [${e.action}] ${e.summary}${detailStr}`;
  });
  return [...header, ...body].join("\n");
}

// src/ui/navigation.js
var import_obsidian4 = require("obsidian");
var modalHeaders = /* @__PURE__ */ new WeakMap();
function modalChrome(modal) {
  var _a, _b, _c;
  const root = modal.modalEl;
  if (!root) return null;
  let chrome = modalHeaders.get(root);
  if (!chrome) {
    root.addClass("fm-ui", "fm-has-chrome");
    const nativeClose = root.querySelector(".modal-header-button, .modal-close-button, .modal-close");
    if (nativeClose) {
      nativeClose.hidden = true;
      nativeClose.style.display = "none";
    }
    const nativeHeader = root.querySelector(".modal-header");
    if (nativeHeader && !((_a = nativeHeader.textContent) == null ? void 0 : _a.trim())) nativeHeader.style.display = "none";
    const nativeTitle = root.querySelector(".modal-title");
    if (nativeTitle && !((_b = nativeTitle.textContent) == null ? void 0 : _b.trim())) nativeTitle.style.display = "none";
    const bar = root.createDiv({ cls: "fm-modal-nav" });
    const close = bar.createEl("button", { attr: { type: "button" } });
    close.addClass("fm-modal-close");
    const closeLabel = ((_c = modal.plugin) == null ? void 0 : _c.t("closeBtn")) || "Close";
    close.setAttribute("aria-label", closeLabel);
    close.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      modal.close();
    };
    (0, import_obsidian4.setIcon)(close, "x");
    const title = bar.createDiv({ cls: "fm-modal-title", attr: { tabindex: "-1" } });
    bar.appendChild(close);
    root.prepend(bar);
    chrome = { bar, title, close };
    modalHeaders.set(root, chrome);
  }
  return chrome;
}
var nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
async function openModal(modal) {
  if (!modal) return;
  await nextFrame();
  modalChrome(modal);
  modal.open();
  return modal;
}
var HubNavigator = class {
  constructor(host, home) {
    this.host = host;
    this.home = home;
    this.chrome = modalChrome(host);
    this.baseClass = host.modalEl.className;
    this.active = true;
    this.busy = false;
    this.child = null;
  }
  async show(child) {
    if (!this.active || this.busy || this.child) return;
    this.busy = true;
    this.home.hidden = true;
    const panel = this.host.contentEl.createDiv({ cls: "fm-hub-page" });
    child.contentEl = panel;
    child.modalEl = this.host.modalEl;
    child.fromHub = true;
    child.hubAction = this.host.currentAction;
    child.returnToHub = () => this.back();
    child.close = () => this.host.close();
    this.child = child;
    this.host.modalEl.removeClass("fm-hub-dialog");
    this.host.modalEl.addClass("fm-hub-child");
    this.chrome.title.empty();
    child.headingEl = this.chrome.title;
    child.detachedFromHub = false;
    child.contentEl = panel.createDiv({ cls: "fm-module-body" });
    try {
      await child.onOpen();
      if (this.active && this.child === child) this.chrome.title.focus();
    } catch (error) {
      if (this.active && this.child === child) {
        this.back();
        new import_obsidian4.Notice(error.message || String(error));
      }
    } finally {
      this.busy = false;
    }
  }
  cleanupChild() {
    var _a, _b;
    const child = this.child;
    this.child = null;
    if (!child) return;
    child.detachedFromHub = true;
    child.headingEl = null;
    try {
      (_a = child.onClose) == null ? void 0 : _a.call(child);
    } finally {
      (_b = child.contentEl.parentElement) == null ? void 0 : _b.remove();
      this.host.modalEl.className = this.baseClass;
      this.chrome.title.empty();
      if (this.host.homeHeading) this.chrome.title.appendChild(this.host.homeHeading);
    }
  }
  back() {
    var _a;
    if (!this.active) return;
    this.cleanupChild();
    this.busy = false;
    this.home.hidden = false;
    (_a = this.host.lastAction) == null ? void 0 : _a.focus();
  }
  async leave(action, prepare = async () => {
  }) {
    if (!this.active || this.busy) return;
    this.busy = true;
    let closed = false;
    try {
      const ready = await prepare();
      if (!this.active) return;
      this.host.close();
      closed = true;
      await nextFrame();
      await action(ready);
    } catch (error) {
      if (closed) this.host.open();
      new import_obsidian4.Notice(error.message || String(error));
    } finally {
      this.busy = false;
    }
  }
  dispose() {
    this.active = false;
    this.cleanupChild();
  }
};
function modalTitle(modal, text) {
  const target = modalChrome(modal).title;
  target.empty();
  return target.createEl("h3", { text, cls: "fm-module-heading-title" });
}
function moduleHeading(modal, target, { title, symbol, step, total } = {}) {
  var _a, _b, _c;
  const heading = modal.detachedFromHub ? target : modal.headingEl || ((_a = modalChrome(modal)) == null ? void 0 : _a.title) || target;
  if (heading !== target) heading.empty();
  const row = heading.createDiv({ cls: "fm-module-heading" });
  (0, import_obsidian4.setIcon)(row.createSpan({ cls: "fm-module-heading-icon" }), ((_b = modal.hubAction) == null ? void 0 : _b.icon) || symbol || "files");
  row.createEl("h3", { text: ((_c = modal.hubAction) == null ? void 0 : _c.title) || modal.plugin.t(title), cls: "fm-module-heading-title" });
  if (step && total) row.createSpan({ text: `${step}/${total}`, cls: "fm-module-heading-step", attr: { "aria-label": modal.plugin.t("stepOf", { current: step, total }) } });
  return row;
}

// src/modals/common.js
function returnToHub(modal) {
  if (modal.returnToHub) return modal.returnToHub();
  modal.close();
  if (!modal.fromHub) return;
  if (modal.app && modal.plugin) {
    openModalSafely(new FileMasterHubModal(modal.app, modal.plugin));
  }
}
function formatFriendlyError(modal, rawErr) {
  const errStr = String(rawErr || "").trim();
  const t2 = (k, p) => {
    var _a;
    return modal && typeof modal.t === "function" ? modal.t(k, p) : ((_a = modal == null ? void 0 : modal.plugin) == null ? void 0 : _a.t) ? modal.plugin.t(k, p) : errStr;
  };
  if (/file too large|too large|413/i.test(errStr)) {
    return t2("activeNoteFailedTooLarge");
  }
  if (/401|unauthorized|invalid.*token/i.test(errStr)) {
    return t2("activeNoteFailedAuth");
  }
  if (/404|not found/i.test(errStr)) {
    return t2("activeNoteFailedNotFound");
  }
  if (/network|fetch|econnrefused|offline/i.test(errStr)) {
    return t2("activeNoteFailedNetwork");
  }
  return errStr;
}
function createScanProgressWidget(contentEl, plugin) {
  const abortController = new AbortController();
  const box = contentEl.createDiv({
    cls: "fm-section-box fm-scan-progress-box",
    attr: { style: "display:none; margin-top:10px; border-color: rgba(59, 130, 246, 0.45);" }
  });
  box.style.display = "none";
  const topRow = box.createDiv({
    cls: "fm-scan-progress-top",
    attr: { style: "display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:8px; width:100%;" }
  });
  const statusText = topRow.createSpan({
    text: plugin ? plugin.t("scanPreparing") : "\u23F3 Preparing scan...",
    cls: "fm-scan-progress-text",
    attr: { style: "font-size:12px; color:var(--text-accent); font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1;" }
  });
  const cancelScanBtn = topRow.createEl("button", {
    text: plugin ? plugin.t("btnCancelScan") : "\u23F9 Cancel Scan",
    cls: "fm-mini-btn mod-warning fm-scan-cancel-btn",
    attr: { style: "flex-shrink:0; margin-left:auto;" }
  });
  cancelScanBtn.onclick = () => {
    abortController.abort();
    cancelScanBtn.disabled = true;
  };
  const wrap = box.createDiv({ cls: "fm-progress-wrap" });
  const bar = wrap.createDiv({ cls: "fm-progress-bar" });
  return {
    signal: abortController.signal,
    show() {
      box.style.display = "block";
    },
    hide() {
      box.style.display = "none";
    },
    abort() {
      abortController.abort();
    },
    update(current, total, label = "") {
      const pct = Math.min(100, Math.round(current / Math.max(1, total) * 100));
      bar.style.width = `${pct}%`;
      const msg = plugin ? plugin.t("scanProgress", { current, total, label }) : `\u23F3 Scanning (${current}/${total}): ${label}`;
      statusText.setText(msg);
    }
  };
}
function renderExcludedFoldersHint(contentEl, plugin) {
  const folders = getExcludedLocalFolderList(plugin.settings);
  if (!folders.length) return;
  return contentEl.createDiv({ cls: "fm-exclusion-hint", text: plugin.t("scanExcludedFolders", { folders: folders.join(", ") }) });
}

// src/ui/links.js
var import_obsidian5 = require("obsidian");
function hasOptimizedVariant(item) {
  if (!(item == null ? void 0 : item.pubUrl) || item.optimizationEnabled === false || item.isProcessableImage === false) return false;
  return item.isProcessableImage === true || IMAGE_EXTS.has(getExt(item.filename || item.name || ""));
}
function assetUrl(item, mode = "raw") {
  return mode === "webp" && hasOptimizedVariant(item) ? item.pubUrl : item.rawUrl || item.pubUrl;
}
function assetMarkdown(name, url) {
  const label = String(name).replace(/[\[\]\\]/g, (ch) => "\\" + ch);
  const destination = String(url).replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");
  return IMAGE_EXTS.has(getExt(name)) ? `![${label}](${destination})` : `[${label}](${destination})`;
}
async function copyText(plugin, value) {
  try {
    await navigator.clipboard.writeText(value);
    new import_obsidian5.Notice(plugin.t("galleryCopied"));
    return true;
  } catch (e) {
    new import_obsidian5.Notice(plugin.t("copyFailed"));
    return false;
  }
}

// src/ui/gallery-toolbar.js
var import_obsidian6 = require("obsidian");
function iconButton(parent, plugin, key, symbol, run) {
  const button = parent.createEl("button", { cls: "fm-icon-button", attr: { type: "button", "aria-label": plugin.t(key) } });
  (0, import_obsidian6.setIcon)(button, symbol);
  button.onclick = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (button.disabled) return;
    button.disabled = true;
    try {
      await run(event);
    } catch (error) {
      new import_obsidian6.Notice(error.message || String(error));
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  };
  return button;
}
var sorts = ["time_desc", "time_asc", "size_desc", "size_asc", "name_asc", "name_desc", "hits_desc"];
var sortKeys = ["gallerySortTimeDesc", "gallerySortTimeAsc", "gallerySortSizeDesc", "gallerySortSizeAsc", "gallerySortNameAsc", "gallerySortNameDesc", "gallerySortHitsDesc"];
function galleryToolbar(view, parent) {
  const t2 = (key, params) => view.t(key, params), store = view.store, plugin = view.plugin;
  const toolbar = parent.createDiv({ cls: "fm-browser-toolbar" });
  const searchRow = toolbar.createDiv({ cls: "fm-browser-search-row" });
  const search = searchRow.createEl("input", { type: "search", cls: "fm-gallery-search", attr: { placeholder: t2("gallerySearchPlaceholder"), "aria-label": t2("gallerySearchPlaceholder") } });
  search.oninput = () => store.patch({ searchQuery: search.value.toLowerCase(), galleryPage: 0 });
  iconButton(searchRow, plugin, "galleryBtnRefresh", "refresh-cw", () => store.load(true));
  const filters = toolbar.createDiv({ cls: "fm-browser-filters" });
  const folder = filters.createEl("select", { attr: { "aria-label": t2("galleryFolderLabel") } });
  const type = filters.createEl("select", { attr: { "aria-label": t2("galleryTypeLabel") } });
  for (const [value, key] of [["all", "galleryFilterAllTypes"], ["image", "galleryFilterImage"], ["audio", "galleryFilterAudio"], ["other", "galleryFilterOther"]]) type.createEl("option", { value, text: t2(key) });
  folder.onchange = () => store.patch({ selectedBucket: folder.value, galleryPage: 0 });
  type.onchange = () => store.patch({ selectedType: type.value, galleryPage: 0 });
  const controls = toolbar.createDiv({ cls: "fm-browser-control-row" });
  const sortingHost = controls.createDiv({ cls: "fm-sort-control" });
  const sorting = sortingHost.createEl("details", { cls: "fm-sort-menu" });
  const summary = sorting.createEl("summary", { cls: "fm-icon-button", attr: { "aria-label": t2("gallerySortLabel") } });
  (0, import_obsidian6.setIcon)(summary, "arrow-down-wide-narrow");
  const menu = sorting.createDiv({ cls: "fm-sort-options" }), sortButtons = [];
  sorts.forEach((value, index) => {
    const button = menu.createEl("button", { text: t2(sortKeys[index]), attr: { type: "button" } });
    button.onclick = () => {
      store.patch({ selectedSort: value, galleryPage: 0 });
      sorting.open = false;
      summary.focus();
    };
    sortButtons.push(button);
  });
  sorting.onkeydown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      sorting.open = false;
      summary.focus();
    }
  };
  const viewModes = controls.createDiv({ cls: "fm-view-controls", attr: { role: "group", "aria-label": t2("galleryLayoutLabel") } });
  const grid = iconButton(viewModes, plugin, "galleryLayoutGrid", "layout-grid", () => store.patch({ layoutMode: "grid" }));
  const list = iconButton(viewModes, plugin, "galleryLayoutList", "list", () => store.patch({ layoutMode: "list" }));
  const format = toolbar.createDiv({ cls: "fm-browser-format" });
  format.createSpan({ text: t2("galleryInsertFormatLabel") });
  const modeGroup = format.createDiv({ cls: "fm-gallery-mode-group", attr: { role: "group", "aria-label": t2("galleryLinkFormat") } });
  const modes = ["raw", "webp"].map((mode) => {
    const button = modeGroup.createEl("button", { text: t2(mode === "raw" ? "galleryModeRaw" : "galleryModeWebp"), attr: { type: "button" } });
    button.onclick = async () => {
      try {
        await store.setInsertMode(mode);
      } catch (error) {
        new import_obsidian6.Notice(error.message);
      }
    };
    return button;
  });
  const footer = toolbar.createDiv({ cls: "fm-browser-summary" }), count = footer.createDiv({ cls: "fm-gallery-stats" });
  const outside = (event) => {
    if (!sorting.contains(event.target)) sorting.open = false;
  };
  const ownerDocument = parent.ownerDocument;
  ownerDocument == null ? void 0 : ownerDocument.addEventListener("click", outside);
  let folderKey = "";
  return { count, dispose() {
    ownerDocument == null ? void 0 : ownerDocument.removeEventListener("click", outside);
  }, sync() {
    const state = store.state;
    if (search.value !== state.searchQuery) search.value = state.searchQuery;
    const buckets = [...new Set(state.items.map((item) => `${item.year}/${item.month}`))].sort().reverse();
    const nextKey = buckets.join(",");
    if (nextKey !== folderKey || !folder.children.length) {
      folder.empty();
      folder.createEl("option", { value: "all", text: t2("galleryFilterAllTime") });
      buckets.forEach((value) => folder.createEl("option", { value, text: value }));
      folderKey = nextKey;
    }
    folder.value = state.selectedBucket;
    type.value = state.selectedType;
    for (const [button, mode] of [[grid, "grid"], [list, "list"]]) {
      button.toggleClass("is-active", state.layoutMode === mode);
      button.setAttribute("aria-pressed", String(state.layoutMode === mode));
    }
    modes.forEach((button, index) => {
      const selected = state.insertMode === ["raw", "webp"][index];
      button.toggleClass("is-active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    sortButtons.forEach((button, index) => {
      button.setAttribute("aria-pressed", String(state.selectedSort === sorts[index]));
    });
  } };
}

// src/ui/image-viewport.js
function createViewportModel() {
  const state = { width: 1, height: 1, imageWidth: 1, imageHeight: 1, scale: 1, x: 0, y: 0, fitScale: 1 };
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const bound = () => {
    const dx = Math.max(0, (state.imageWidth * state.scale - state.width) / 2), dy = Math.max(0, (state.imageHeight * state.scale - state.height) / 2);
    state.x = clamp(state.x, -dx, dx);
    state.y = clamp(state.y, -dy, dy);
  };
  return {
    state,
    resize(width, height, imageWidth, imageHeight) {
      Object.assign(state, { width: Math.max(1, width), height: Math.max(1, height), imageWidth: Math.max(1, imageWidth), imageHeight: Math.max(1, imageHeight) });
      state.fitScale = Math.max(1e-3, Math.min((state.width - 24) / state.imageWidth, (state.height - 24) / state.imageHeight, 1));
      this.fit();
    },
    fit() {
      state.scale = state.fitScale;
      state.x = state.y = 0;
    },
    actual() {
      state.scale = 1;
      state.x = state.y = 0;
      bound();
    },
    zoom(factor, anchor = { x: 0, y: 0 }) {
      const old = state.scale;
      state.scale = clamp(old * factor, Math.min(state.fitScale, 0.1), 8);
      state.x = anchor.x - (anchor.x - state.x) * state.scale / old;
      state.y = anchor.y - (anchor.y - state.y) * state.scale / old;
      bound();
    },
    pan(dx, dy) {
      state.x += dx;
      state.y += dy;
      bound();
    }
  };
}
function mountImageViewport(stage, image, onScale) {
  const controller = new AbortController(), { signal } = controller, model = createViewportModel(), pointers = /* @__PURE__ */ new Map();
  let lastPinch = null, lastTap = null, tapStart = null;
  const draw = () => {
    const s = model.state;
    image.style.width = s.imageWidth + "px";
    image.style.height = s.imageHeight + "px";
    image.style.transform = `translate(${s.x}px,${s.y}px) scale(${s.scale})`;
    stage.toggleClass("can-pan", s.imageWidth * s.scale > s.width || s.imageHeight * s.scale > s.height);
    onScale(Math.round(s.scale * 100));
  };
  const resize = () => {
    if (!image.naturalWidth) return;
    model.resize(stage.clientWidth, stage.clientHeight, image.naturalWidth, image.naturalHeight);
    draw();
  };
  const center = (event) => {
    const rect = stage.getBoundingClientRect();
    return { x: event.clientX - rect.left - stage.clientWidth / 2, y: event.clientY - rect.top - stage.clientHeight / 2 };
  };
  const pinch = () => {
    const [a, b] = [...pointers.values()];
    return { distance: Math.hypot(a.x - b.x, a.y - b.y), center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  };
  image.draggable = false;
  image.addEventListener("load", resize, { signal });
  if (image.complete && image.naturalWidth) resize();
  stage.addEventListener("wheel", (event) => {
    event.preventDefault();
    model.zoom(Math.exp(-event.deltaY * 2e-3), center(event));
    draw();
  }, { passive: false, signal });
  stage.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || pointers.size >= 2) return;
    event.preventDefault();
    stage.focus({ preventScroll: true });
    pointers.set(event.pointerId, center(event));
    stage.setPointerCapture(event.pointerId);
    tapStart = pointers.size === 1 ? { ...center(event), time: event.timeStamp } : null;
    if (pointers.size === 2) {
      lastPinch = pinch();
      lastTap = null;
    }
    stage.addClass("is-dragging");
  }, { signal });
  stage.addEventListener("pointermove", (event) => {
    if (!pointers.has(event.pointerId)) return;
    const before = pointers.get(event.pointerId), after = center(event);
    pointers.set(event.pointerId, after);
    if (pointers.size === 2) {
      const current = pinch();
      if (lastPinch == null ? void 0 : lastPinch.distance) {
        model.zoom(current.distance / lastPinch.distance, lastPinch.center);
        model.pan(current.center.x - lastPinch.center.x, current.center.y - lastPinch.center.y);
      }
      lastPinch = current;
    } else model.pan(after.x - before.x, after.y - before.y);
    draw();
  }, { signal });
  const release = (event) => {
    if (event.type === "pointerup" && event.pointerType === "touch" && tapStart && pointers.size === 1) {
      const point = center(event), short = event.timeStamp - tapStart.time < 300 && Math.hypot(point.x - tapStart.x, point.y - tapStart.y) < 10;
      if (short && lastTap && event.timeStamp - lastTap.time < 350 && Math.hypot(point.x - lastTap.x, point.y - lastTap.y) < 24) {
        model.fit();
        draw();
        lastTap = null;
      } else lastTap = short ? { ...point, time: event.timeStamp } : null;
    }
    tapStart = null;
    pointers.delete(event.pointerId);
    lastPinch = null;
    if (!pointers.size) stage.removeClass("is-dragging");
  };
  for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) stage.addEventListener(event, release, { signal });
  stage.addEventListener("dblclick", (event) => {
    event.preventDefault();
    model.fit();
    draw();
  }, { signal });
  stage.addEventListener("keydown", (event) => {
    const moves = { ArrowLeft: [32, 0], ArrowRight: [-32, 0], ArrowUp: [0, 32], ArrowDown: [0, -32] };
    if (moves[event.key]) {
      event.preventDefault();
      model.pan(...moves[event.key]);
    } else if (["+", "=", "-", "0"].includes(event.key)) {
      event.preventDefault();
      if (event.key === "0") model.fit();
      else model.zoom(event.key === "-" ? 1 / 1.25 : 1.25);
    } else return;
    draw();
  }, { signal });
  const observer = new ResizeObserver(resize);
  observer.observe(stage);
  return { fit() {
    model.fit();
    draw();
  }, actual() {
    model.actual();
    draw();
  }, zoomIn() {
    model.zoom(1.25);
    draw();
  }, zoomOut() {
    model.zoom(1 / 1.25);
    draw();
  }, dispose() {
    controller.abort();
    observer.disconnect();
    pointers.clear();
  } };
}

// src/modals/dialogs.js
var import_obsidian8 = require("obsidian");

// src/ui/modal.js
var import_obsidian7 = require("obsidian");
var FileMasterModal = class extends import_obsidian7.Modal {
  open() {
    modalChrome(this);
    return super.open();
  }
};

// src/modals/dialogs.js
var ConfirmActionModal = class extends FileMasterModal {
  constructor(app, title, message, confirmText = "Confirm", onConfirm, plugin = null) {
    super(app);
    this.title = title;
    this.message = message;
    this.confirmText = confirmText;
    this.onConfirm = onConfirm;
    this.plugin = plugin;
    this.resolved = false;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.addClass("fm-ui", "fm-confirm-dialog");
    modalChrome(this);
    contentEl.addClass("fm-confirm-content");
    modalTitle(this, this.title);
    const p = contentEl.createEl("p", { text: this.message });
    p.style.lineHeight = "1.6";
    p.style.margin = "12px 0 18px";
    const btnRow = contentEl.createDiv({ cls: "fm-btn-row" });
    const cancelLabel = this.plugin ? this.plugin.t("btnCancel") : translateUi("auto", "btnCancel");
    const cancelBtn = btnRow.createEl("button", { text: cancelLabel });
    cancelBtn.onclick = () => {
      if (this.resolved) return;
      this.resolved = true;
      this.close();
      return this.onConfirm(false);
    };
    const okBtn = btnRow.createEl("button", { text: this.confirmText, cls: "mod-warning" });
    okBtn.onclick = () => {
      if (this.resolved) return;
      this.resolved = true;
      this.close();
      return this.onConfirm(true);
    };
  }
  onClose() {
    if (!this.resolved && this.onConfirm) {
      this.resolved = true;
      this.onConfirm(false);
    }
    this.contentEl.empty();
  }
};
var ImageLightboxModal = class extends FileMasterModal {
  constructor(app, plugin, item, onActionChanged = null, options = {}) {
    var _a;
    super(app);
    Object.assign(this, { plugin, item, onActionChanged });
    this.insertionTarget = (_a = options.insertionTarget) != null ? _a : captureInsertionTarget(plugin);
    this.insertMode = options.insertMode || plugin.settings.galleryInsertFormat || "raw";
    this.generation = 0;
  }
  onOpen() {
    var _a;
    this.closed = false;
    this.contentEl.empty();
    this.contentEl.addClass("fm-asset-viewer");
    this.modalEl.addClass("fm-ui", "fm-lightbox-dialog");
    modalChrome(this);
    const t2 = (key, params) => this.plugin.t(key, params), remote = this.item.source === "remote" ? this.item.rawObj : null;
    const image = IMAGE_EXTS.has(getExt(this.item.name));
    const header = this.contentEl.createDiv({ cls: "fm-asset-header" });
    modalTitle(this, this.item.name);
    const location = (_a = this.item.displayPath) == null ? void 0 : _a.split("/").slice(0, -1).join(" / ");
    if (location) {
      (0, import_obsidian8.setIcon)(header.createSpan({ cls: "fm-asset-path-icon" }), "folder");
      header.createSpan({ text: location, cls: "fm-asset-location" });
    }
    const layout = this.contentEl.createDiv({ cls: "fm-asset-layout" });
    const canvas = layout.createDiv({ cls: "fm-asset-canvas" });
    const tools = canvas.createDiv({ cls: "fm-asset-tools" });
    this.variant = "raw";
    const variants = tools.createDiv({ cls: "fm-gallery-mode-group", attr: { role: "group", "aria-label": t2("previewVariant") } });
    const variantButtons = [];
    if (image) for (const mode of remote && hasOptimizedVariant(remote) ? ["raw", "webp"] : ["raw"]) {
      const button = variants.createEl("button", { text: t2(mode === "raw" ? "galleryModeRaw" : "galleryModeWebp"), attr: { type: "button", "aria-pressed": String(mode === "raw") } });
      button.onclick = () => {
        this.variant = mode;
        variantButtons.forEach(([b, m]) => b.setAttribute("aria-pressed", String(m === mode)));
        this.loadPreview();
      };
      variantButtons.push([button, mode]);
    }
    const zoom = tools.createDiv({ cls: "fm-asset-zoom", attr: { role: "group", "aria-label": t2("previewZoomLabel") } });
    const zoomButtons = [];
    if (image) {
      zoomButtons.push(iconButton(zoom, this.plugin, "previewZoomOut", "minus", () => {
        var _a2;
        return (_a2 = this.viewport) == null ? void 0 : _a2.zoomOut();
      }));
      this.percentage = zoom.createEl("button", { text: "\u2014", attr: { type: "button", "aria-label": t2("previewActualSize") } });
      this.percentage.onclick = () => {
        var _a2;
        return (_a2 = this.viewport) == null ? void 0 : _a2.actual();
      };
      zoomButtons.push(this.percentage);
      zoomButtons.push(iconButton(zoom, this.plugin, "previewZoomIn", "plus", () => {
        var _a2;
        return (_a2 = this.viewport) == null ? void 0 : _a2.zoomIn();
      }));
      zoomButtons.push(iconButton(zoom, this.plugin, "previewFit", "maximize", () => {
        var _a2;
        return (_a2 = this.viewport) == null ? void 0 : _a2.fit();
      }));
    }
    this.zoomButtons = zoomButtons;
    this.stage = canvas.createDiv({ cls: "fm-image-stage", attr: { tabindex: "0", role: "region", "aria-label": t2("previewGestures") } });
    this.status = canvas.createDiv({ cls: "fm-preview-status", attr: { "aria-live": "polite" } });
    const inspector = layout.createDiv({ cls: "fm-asset-inspector" });
    const actions = inspector.createDiv({ cls: "fm-asset-primary" });
    if (remote) {
      const mode = this.insertMode === "webp" && hasOptimizedVariant(remote) ? "webp" : "raw";
      const insert = actions.createEl("button", { text: t2(mode === "webp" ? "galleryInsertWebp" : "galleryInsertRaw"), cls: "mod-cta", attr: { type: "button" } });
      insert.disabled = !isInsertionTargetValid(this.plugin, this.insertionTarget);
      insert.hidden = insert.disabled;
      if (insert.disabled) actions.createDiv({ text: t2("galleryOpenNoteFirst"), cls: "fm-asset-hint" });
      insert.onclick = () => {
        if (insertMarkdownToActiveEditor(this.plugin, assetMarkdown(this.item.name, assetUrl(remote, mode)) + "\n", t2("galleryInserted"), this.insertionTarget)) this.close();
      };
      const links = inspector.createDiv({ cls: "fm-asset-section fm-asset-links" });
      links.createEl("h4", { text: t2("previewLinksTitle") });
      for (const variant of hasOptimizedVariant(remote) ? ["raw", "webp"] : ["raw"]) {
        const url = assetUrl(remote, variant);
        if (!url) continue;
        const group = links.createDiv({ cls: "fm-asset-link-variant" });
        group.createSpan({ text: t2(variant === "raw" ? "galleryTrackRaw" : "galleryTrackWebp"), cls: "fm-asset-link-label" });
        const copyActions = group.createDiv({ cls: "fm-asset-copy-pair" });
        for (const markdown of [false, true]) {
          const label = t2(variant === "raw" ? "galleryTrackRaw" : "galleryTrackWebp") + (markdown ? " \xB7 Markdown" : " \xB7 URL");
          const value = markdown ? assetMarkdown(this.item.name, url) : url;
          const copy = copyActions.createEl("button", { cls: "fm-asset-copy-action", attr: { type: "button", "aria-label": label } });
          (0, import_obsidian8.setIcon)(copy.createSpan({ cls: "fm-copy-icon" }), "copy");
          copy.createSpan({ text: markdown ? "Markdown" : "URL" });
          copy.onclick = () => copyText(this.plugin, value);
        }
      }
    } else if (this.item.rawObj) {
      const open = actions.createEl("button", { text: t2("btnOpenInObsidian"), cls: "mod-cta" });
      open.onclick = async () => {
        if (open.disabled) return;
        open.disabled = true;
        try {
          const leaf = this.app.workspace.getLeaf(false);
          if (leaf) {
            await leaf.openFile(this.item.rawObj);
            this.close();
          }
        } catch (error) {
          new import_obsidian8.Notice(error.message);
        } finally {
          open.disabled = false;
        }
      };
    }
    const properties = inspector.createDiv({ cls: "fm-asset-section" });
    properties.createEl("h4", { text: t2("previewProperties") });
    const list = properties.createEl("dl", { cls: "fm-asset-properties" });
    const property = (key, value) => {
      list.createEl("dt", { text: t2(key) });
      return list.createEl("dd", { text: String(value) });
    };
    property("previewSizeLabel", formatBytes(this.item.size));
    if (image) this.dimensions = property("previewDimensions", "\u2014");
    if (remote == null ? void 0 : remote.createdAt) property("previewCreated", new Date(remote.createdAt).toLocaleString());
    property("previewSource", t2(remote ? "previewSourceRemote" : "previewSourceLocal"));
    if (remote) {
      const management = inspector.createDiv({ cls: "fm-asset-section" });
      management.createEl("h4", { text: t2("previewProtection") });
      const lock = management.createEl("button", { attr: { type: "button" } });
      const danger = inspector.createDiv({ cls: "fm-asset-section fm-asset-danger" });
      danger.createEl("h4", { text: t2("previewDanger") });
      const del = danger.createEl("button", { text: t2("galleryBtnDelete"), attr: { type: "button" } });
      danger.createDiv({ text: t2("previewTrashHelp"), cls: "fm-asset-hint" });
      const update = () => {
        lock.setText(t2(remote.locked ? "galleryBtnUnlock" : "galleryBtnLock"));
        del.disabled = Boolean(remote.locked) || this.deleting;
      };
      update();
      lock.onclick = async () => {
        var _a2;
        if (lock.disabled) return;
        lock.disabled = true;
        del.disabled = true;
        try {
          const locked = !remote.locked;
          await this.plugin.toggleRemoteFileLock(remote.year, remote.month, remote.filename, locked);
          remote.locked = locked;
          if (!this.closed) {
            update();
            new import_obsidian8.Notice(t2(locked ? "previewProtected" : "previewUnprotected"));
          }
          (_a2 = this.onActionChanged) == null ? void 0 : _a2.call(this, "lock", remote);
        } catch (error) {
          new import_obsidian8.Notice(t2("previewLockFailed", { err: error.message }));
        } finally {
          lock.disabled = false;
          if (!this.closed) update();
        }
      };
      del.onclick = async () => {
        if (del.disabled || this.deleting || remote.locked) return;
        del.disabled = true;
        const confirm = new ConfirmActionModal(this.app, t2("previewTrashConfirmTitle"), t2("galleryDeleteConfirm", { name: this.item.name }), t2("galleryBtnDelete"), async (confirmed) => {
          var _a2;
          if (!confirmed || this.closed) {
            if (!this.closed) update();
            return;
          }
          if (remote.locked || this.deleting) {
            update();
            return;
          }
          this.deleting = true;
          lock.disabled = true;
          try {
            await this.plugin.deleteRemoteFile(remote.year, remote.month, remote.filename);
            (_a2 = this.onActionChanged) == null ? void 0 : _a2.call(this, "deleted", remote);
            new import_obsidian8.Notice(t2("galleryDeleteSuccess", { name: this.item.name }));
            this.close();
          } catch (error) {
            new import_obsidian8.Notice(t2("previewDeleteFailed", { err: error.message }));
          } finally {
            this.deleting = false;
            lock.disabled = false;
            if (!this.closed) update();
          }
        }, this.plugin);
        try {
          await openModal(confirm);
        } catch (error) {
          update();
          new import_obsidian8.Notice(error.message);
        }
      };
    }
    if (image) this.loadPreview();
    else {
      this.stage.createDiv({ text: t2("previewNonImageTip", { ext: getExt(this.item.name).toUpperCase() }) });
      this.status.hidden = true;
    }
  }
  async loadPreview() {
    var _a, _b, _c;
    const generation = ++this.generation, t2 = (key) => this.plugin.t(key);
    (_a = this.viewport) == null ? void 0 : _a.dispose();
    this.viewport = null;
    (_b = this.imageEvents) == null ? void 0 : _b.abort();
    this.imageEvents = new AbortController();
    this.stage.empty();
    this.status.empty();
    this.status.createSpan({ text: t2("previewLoading") });
    this.zoomButtons.forEach((button) => button.disabled = true);
    (_c = this.percentage) == null ? void 0 : _c.setText("\u2014");
    if (this.dimensions) this.dimensions.setText("\u2014");
    const current = () => !this.closed && generation === this.generation;
    const failed = () => {
      if (!current()) return;
      this.status.empty();
      this.status.createSpan({ text: t2("previewLoadFailed") });
      const retry = this.status.createEl("button", { text: t2("previewRetry") });
      retry.onclick = () => this.loadPreview();
    };
    try {
      const remote = this.item.source === "remote" ? this.item.rawObj : null;
      const url = remote ? assetUrl(remote, this.variant) : await getItemPreviewUrl(this.plugin, this.item);
      if (!current()) return;
      if (!url) {
        failed();
        return;
      }
      const img = this.stage.createEl("img", { cls: "fm-viewport-image", attr: { alt: this.item.name, draggable: "false" } });
      img.addEventListener("load", () => {
        var _a2;
        if (!current()) return;
        this.status.empty();
        this.zoomButtons.forEach((button) => button.disabled = false);
        (_a2 = this.dimensions) == null ? void 0 : _a2.setText(`${img.naturalWidth} \xD7 ${img.naturalHeight}`);
        this.viewport = mountImageViewport(this.stage, img, (percent) => this.percentage.setText(percent + "%"));
      }, { once: true, signal: this.imageEvents.signal });
      img.addEventListener("error", failed, { once: true, signal: this.imageEvents.signal });
      img.src = url;
    } catch (e) {
      failed();
    }
  }
  onClose() {
    var _a, _b;
    this.closed = true;
    this.generation++;
    (_a = this.imageEvents) == null ? void 0 : _a.abort();
    (_b = this.viewport) == null ? void 0 : _b.dispose();
    this.viewport = null;
    this.contentEl.empty();
  }
};
var NoteRefsModal = class extends FileMasterModal {
  constructor(app, itemName, refNotePaths, onJump, plugin = null) {
    super(app);
    this.itemName = itemName;
    this.refNotePaths = refNotePaths || [];
    this.onJump = onJump;
    this.plugin = plugin;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("fm-wizard-modal");
    const t2 = (k, p) => this.plugin ? this.plugin.t(k, p) : translateUi("auto", k, p);
    modalTitle(this, t2("noteRefsTitle", { name: this.itemName, count: this.refNotePaths.length }));
    if (this.refNotePaths.length === 0) {
      contentEl.createDiv({
        cls: "fm-section-box",
        text: t2("noteRefsNone"),
        attr: { style: "text-align: center; padding: 24px;" }
      });
    } else {
      const listEl = contentEl.createDiv({ cls: "fm-scroll-list" });
      for (const notePath of this.refNotePaths) {
        const row = listEl.createDiv({ cls: "fm-list-item" });
        row.createSpan({ text: `\u{1F4DD} ${notePath}`, attr: { style: "word-break: break-all; font-weight: 500;" } });
        const jumpBtn = row.createEl("button", {
          text: t2("btnOpenNote"),
          cls: "fm-mini-btn mod-cta"
        });
        jumpBtn.onclick = async () => {
          const tf = this.app.vault.getAbstractFileByPath(notePath);
          if (tf) {
            const leaf = this.app.workspace.getLeaf(false);
            if (leaf) await leaf.openFile(tf);
            this.close();
            if (this.onJump) this.onJump();
          } else {
            new import_obsidian8.Notice(t2("noteRefsNotFound", { path: notePath }));
          }
        };
      }
    }
    const btnRow = contentEl.createDiv({ cls: "fm-btn-row" });
    const closeBtn = btnRow.createEl("button", { text: t2("closeBtn") });
    closeBtn.onclick = () => this.close();
  }
  onClose() {
    this.contentEl.empty();
  }
};

// src/modals/incoming-file.js
var import_obsidian9 = require("obsidian");
function renderItemVisualThumb(parentEl, item, plugin) {
  const t2 = (k, p) => plugin ? plugin.t(k, p) : translateUi("auto", k, p);
  const ext = getExt(item.name);
  if (IMAGE_EXTS.has(ext)) {
    const img = parentEl.createEl("img", {
      cls: "fm-item-thumb",
      attr: { "aria-label": t2("thumbEnlargeTooltip") }
    });
    img.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      new ImageLightboxModal(plugin.app, plugin, item).open();
    };
    getItemPreviewUrl(plugin, item).then((url) => {
      if (url) img.src = url;
    });
  } else {
    const box = parentEl.createDiv({
      cls: "fm-item-icon-box",
      attr: { "aria-label": t2("thumbDetailsTooltip") }
    });
    const icon = ext === "md" ? "\u{1F4DD}" : AUDIO_EXTS.has(ext) ? "\u{1F3B5}" : ["mp4", "webm", "mov", "mkv"].includes(ext) ? "\u{1F3AC}" : ext === "pdf" ? "\u{1F4C4}" : "\u{1F4E6}";
    box.createSpan({ text: icon });
    box.createSpan({ text: (ext || "FILE").slice(0, 4).toUpperCase(), cls: "fm-item-icon-ext" });
    box.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      new ImageLightboxModal(plugin.app, plugin, item).open();
    };
  }
}
var IncomingFileModal = class extends FileMasterModal {
  constructor(app, fileInfo, options, callback = null) {
    var _a, _b, _c, _d;
    super(app);
    this.fileInfo = fileInfo;
    this.options = options || {};
    this.callback = callback;
    this.plugin = this.options.plugin;
    const isRemote = Boolean((_b = (_a = this.plugin) == null ? void 0 : _a.isRemoteServerReady) == null ? void 0 : _b.call(_a));
    if (this.options.fixedLocation === "local") {
      this.targetLocation = "local";
    } else if (this.options.fixedLocation === "remote") {
      this.targetLocation = isRemote ? "remote" : "local";
    } else {
      const userPref = ((_d = (_c = this.plugin) == null ? void 0 : _c.settings) == null ? void 0 : _d.defaultSaveLocation) || "remote";
      this.targetLocation = !isRemote || userPref === "local" ? "local" : "remote";
    }
    this.finalFilename = `${fileInfo.defaultBaseName}.${fileInfo.ext}`;
    this.step = "input";
    this.result = null;
    this.isDone = false;
    this.isExecuting = false;
  }
  t(k, p) {
    return this.plugin ? this.plugin.t(k, p) : k;
  }
  onOpen() {
    var _a, _b;
    (_b = (_a = this.modalEl) == null ? void 0 : _a.addClass) == null ? void 0 : _b.call(_a, "fm-incoming-dialog");
    this.render();
  }
  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("fm-incoming-modal-dialog");
    if (this.step === "input") {
      this.renderInputStep();
    } else if (this.step === "executing") {
      this.renderExecutingStep();
    } else if (this.step === "result") {
      this.renderResultStep();
    }
  }
  renderInputStep() {
    var _a, _b, _c, _d, _e, _f;
    const { contentEl } = this;
    modalTitle(this, this.t("destTitle"));
    const card = contentEl.createDiv({ cls: "fm-incoming-card" });
    const thumbWrap = card.createDiv({ cls: "fm-incoming-thumb-wrap" });
    if (IMAGE_EXTS.has(this.fileInfo.ext)) {
      const img = thumbWrap.createEl("img", { cls: "fm-incoming-thumb-img" });
      convertBufferToPreviewUrl(this.fileInfo.arrayBuffer, this.fileInfo.ext, this.plugin).then((url) => {
        if (url) img.src = url;
      }).catch(() => {
      });
    } else {
      const ext = this.fileInfo.ext;
      const icon = ext === "md" ? "\u{1F4DD}" : AUDIO_EXTS.has(ext) ? "\u{1F3B5}" : ["mp4", "webm", "mov", "mkv"].includes(ext) ? "\u{1F3AC}" : ext === "pdf" ? "\u{1F4C4}" : "\u{1F4E6}";
      thumbWrap.createSpan({ text: icon, attr: { style: "font-size: 24px;" } });
    }
    const editCol = card.createDiv({ cls: "fm-incoming-edit-col" });
    const inputRow = editCol.createDiv({ cls: "fm-incoming-input-row" });
    const nameInput = inputRow.createEl("input", {
      type: "text",
      value: this.fileInfo.defaultBaseName,
      cls: "fm-incoming-name-input",
      attr: {
        placeholder: this.t("destFilenameHint"),
        spellcheck: "false"
      }
    });
    inputRow.createSpan({ text: `.${this.fileInfo.ext}`, cls: "fm-incoming-ext-badge" });
    editCol.createDiv({
      cls: "fm-incoming-sub-meta",
      text: formatBytes(this.fileInfo.size)
    });
    if (this.options.promptRename) {
      setTimeout(() => {
        nameInput.focus();
        nameInput.select();
      }, 40);
    }
    const isRemoteReady = Boolean(
      ((_b = (_a = this.plugin) == null ? void 0 : _a.settings) == null ? void 0 : _b.enableRemoteServer) && ((_d = (_c = this.plugin) == null ? void 0 : _c.isRemoteServerReady) == null ? void 0 : _d.call(_c))
    );
    const isAskMode = this.options.askLocation !== false;
    let isRemoteFallback = false;
    if (!isAskMode && this.options.fixedLocation === "local") {
      this.targetLocation = "local";
    } else if (!isAskMode && this.options.fixedLocation === "remote") {
      if (isRemoteReady) {
        this.targetLocation = "remote";
      } else {
        this.targetLocation = "local";
        isRemoteFallback = true;
      }
    } else if (!this.targetLocation) {
      const userPref = ((_f = (_e = this.plugin) == null ? void 0 : _e.settings) == null ? void 0 : _f.defaultSaveLocation) || "remote";
      this.targetLocation = !isRemoteReady || userPref === "local" ? "local" : "remote";
    }
    contentEl.createDiv({
      cls: "fm-section-title",
      text: this.t("destDestTitle"),
      attr: { style: "margin-top: 14px; margin-bottom: 8px;" }
    });
    const grid = contentEl.createDiv({ cls: "fm-incoming-dest-grid" });
    const localCard = grid.createDiv({
      cls: `fm-incoming-dest-card ${this.targetLocation === "local" ? "is-selected" : ""}`
    });
    const localTitle = localCard.createDiv({ cls: "fm-incoming-dest-card-title" });
    localTitle.createSpan({ text: this.t("destSaveLocal") });
    const localCheck = localCard.createSpan({ cls: "fm-incoming-dest-card-check" });
    (0, import_obsidian9.setIcon)(localCheck, "check");
    let remoteCard = null;
    let remoteCheck = null;
    if (isRemoteReady) {
      remoteCard = grid.createDiv({
        cls: `fm-incoming-dest-card ${this.targetLocation === "remote" ? "is-selected" : ""}`
      });
      const remoteTitle = remoteCard.createDiv({ cls: "fm-incoming-dest-card-title" });
      remoteTitle.createSpan({ text: this.t("destSaveRemote") });
      remoteCheck = remoteCard.createSpan({ cls: "fm-incoming-dest-card-check" });
      (0, import_obsidian9.setIcon)(remoteCheck, "check");
    }
    const updateSelection = (loc) => {
      this.targetLocation = loc;
      if (loc === "local") {
        localCard.addClass("is-selected");
        if (remoteCard) remoteCard.removeClass("is-selected");
      } else {
        localCard.removeClass("is-selected");
        if (remoteCard) remoteCard.addClass("is-selected");
      }
    };
    if (isAskMode) {
      localCard.onclick = () => updateSelection("local");
      if (remoteCard) {
        remoteCard.onclick = () => updateSelection("remote");
      }
    } else {
      localCard.style.cursor = "default";
      if (remoteCard) remoteCard.style.cursor = "default";
      let hintText = "";
      if (isRemoteFallback) {
        hintText = this.t("destFixedRemoteFallbackHint");
      } else if (this.targetLocation === "local") {
        hintText = this.t("destFixedLocalHint");
      } else {
        hintText = this.t("destFixedRemoteHint");
      }
      contentEl.createDiv({
        cls: "fm-incoming-fixed-hint",
        text: hintText,
        attr: { style: "font-size: 11px; color: var(--text-muted); margin-top: 6px;" }
      });
    }
    const triggerExecute = () => {
      if (this.isExecuting) return;
      this.isExecuting = true;
      const cleanBase = sanitizeCleanBaseName(nameInput.value, this.fileInfo.defaultBaseName);
      this.finalFilename = `${cleanBase}.${this.fileInfo.ext}`;
      this.step = "executing";
      this.render();
      this.runExecution();
    };
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        triggerExecute();
      }
    });
    contentEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const tag = e.target && e.target.tagName ? e.target.tagName.toLowerCase() : "";
        if (tag === "textarea" || tag === "button" || tag === "input") return;
        e.preventDefault();
        triggerExecute();
      }
    });
    const btnRow = contentEl.createDiv({ cls: "fm-btn-row", attr: { style: "margin-top: 18px;" } });
    const cancelBtn = btnRow.createEl("button", { text: this.t("btnCancel") });
    cancelBtn.onclick = () => {
      this.isDone = true;
      this.close();
      if (this.callback) this.callback({ target: null });
    };
    const insertBtn = btnRow.createEl("button", { text: this.t("btnInsert") || "\u63D2\u5165", cls: "mod-cta" });
    insertBtn.onclick = () => triggerExecute();
  }
  renderExecutingStep() {
    const { contentEl } = this;
    modalTitle(this, this.t("destProcessingTitle"));
    const infoBox = contentEl.createDiv({ cls: "fm-section-box", attr: { style: "margin-bottom: 14px;" } });
    infoBox.createDiv({
      text: `\u{1F4C4} ${this.finalFilename}  (${formatBytes(this.fileInfo.size)})`,
      attr: { style: "font-weight: 600; margin-bottom: 10px;" }
    });
    const progressWrap = infoBox.createDiv({ cls: "fm-progress-wrap" });
    this.progressBar = progressWrap.createDiv({ cls: "fm-progress-bar", attr: { style: "width: 15%;" } });
    this.statusLabel = infoBox.createDiv({
      text: this.targetLocation === "remote" ? this.t("destProbeChecking") : this.t("destSavingLocal"),
      attr: { style: "font-size: 12px; color: var(--text-accent); margin-top: 8px;" }
    });
  }
  async runExecution() {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j;
    try {
      const activeFile = this.options.activeFile || this.app.workspace.getActiveFile();
      const editor = this.options.editor;
      const sourcePath = activeFile ? activeFile.path : "";
      if (this.targetLocation === "local") {
        if (this.progressBar) this.progressBar.style.width = "40%";
        if (this.statusLabel) this.statusLabel.setText(this.t("destSavingLocal"));
        const localPath = await this.app.fileManager.getAvailablePathForAttachment(
          this.finalFilename,
          sourcePath
        );
        if (this.progressBar) this.progressBar.style.width = "75%";
        const createdFile = await this.app.vault.createBinary(localPath, this.fileInfo.arrayBuffer);
        let mdLink = this.app.fileManager.generateMarkdownLink(createdFile, sourcePath);
        if (IMAGE_EXTS.has(this.fileInfo.ext) && !mdLink.startsWith("!")) {
          mdLink = `!${mdLink}`;
        }
        if (editor) {
          editor.replaceSelection(mdLink + "\n");
        }
        if (this.progressBar) this.progressBar.style.width = "100%";
        this.result = {
          success: true,
          target: "local",
          localPath: createdFile.path,
          mdLink,
          inserted: !!editor
        };
        (_b = (_a = this.plugin) == null ? void 0 : _a.logOperation) == null ? void 0 : _b.call(_a, "INFO", "SAVE_LOCAL", `Saved attachment to vault: ${createdFile.path}`, {
          size: this.fileInfo.size,
          note: sourcePath || null
        });
      } else {
        if (this.progressBar) this.progressBar.style.width = "25%";
        if (this.statusLabel) this.statusLabel.setText(this.t("destProbeChecking"));
        const sha256 = this.fileInfo.sha256 || await computeSha256Hex(this.fileInfo.arrayBuffer);
        let res = null;
        const probed = await this.plugin.probeRemoteSha256(sha256);
        if (probed && probed.exists) {
          res = Object.assign({}, probed, { isInstant: true });
          if (this.progressBar) this.progressBar.style.width = "100%";
          if (this.statusLabel) this.statusLabel.setText(this.t("destInstantBadge"));
        } else {
          if (this.progressBar) this.progressBar.style.width = "55%";
          if (this.statusLabel) this.statusLabel.setText(this.t("destUploadingRemote"));
          res = await this.plugin.uploadBufferToServer(
            this.fileInfo.arrayBuffer,
            this.finalFilename,
            this.fileInfo.mimeType || "application/octet-stream",
            { skipProbe: true }
          );
          if (this.progressBar) this.progressBar.style.width = "100%";
        }
        const useOpt = this.plugin.settings.insertOptimizedLinkOnUpload && res.optimizationEnabled !== false && res.category === "image" && res.pubUrl;
        let finalMarkdown = useOpt ? `![](${res.pubUrl})` : res.markdown || `[${this.finalFilename}](${res.rawUrl})`;
        if (IMAGE_EXTS.has(this.fileInfo.ext) && !finalMarkdown.startsWith("!")) {
          finalMarkdown = `!${finalMarkdown}`;
        }
        if (editor) {
          editor.replaceSelection(finalMarkdown + "\n");
        }
        this.result = {
          success: true,
          target: "remote",
          res,
          finalMarkdown,
          isInstant: !!res.isInstant,
          inserted: !!editor
        };
        (_d = (_c = this.plugin) == null ? void 0 : _c.logOperation) == null ? void 0 : _d.call(_c, "INFO", "UPLOAD_REMOTE", `${res.isInstant ? "Reused existing remote file" : "Uploaded attachment to server"}: ${this.finalFilename}`, {
          remotePath: `${res.year}/${res.month}/${res.filename}`,
          isInstant: !!res.isInstant,
          size: this.fileInfo.size,
          note: sourcePath || null
        });
      }
    } catch (err) {
      this.isExecuting = false;
      this.result = {
        success: false,
        error: err.message || String(err)
      };
      (_f = (_e = this.plugin) == null ? void 0 : _e.logOperation) == null ? void 0 : _f.call(_e, "ERROR", "SAVE_ATTACHMENT", `Failed to process attachment "${this.finalFilename}": ${this.result.error}`, {
        target: this.targetLocation,
        size: this.fileInfo.size
      });
    }
    if (this.callback) {
      this.callback({ target: this.targetLocation, finalFilename: this.finalFilename, result: this.result });
    }
    if (((_g = this.result) == null ? void 0 : _g.success) && ((_h = this.result) == null ? void 0 : _h.inserted)) {
      const noticeMsg = this.result.target === "remote" ? this.plugin ? this.plugin.t("noticeUploadedRemote", { name: this.finalFilename }) : `\u5DF2\u4E0A\u4F20\u5230\u670D\u52A1\u5668\u5E76\u63D2\u5165\u94FE\u63A5\uFF1A${this.finalFilename}` : this.t("destInsertSuccess");
      new import_obsidian9.Notice(noticeMsg);
      this.isDone = true;
      this.close();
      return;
    } else if ((_i = this.result) == null ? void 0 : _i.success) {
      new import_obsidian9.Notice(this.t("destInsertSuccess"));
      this.isDone = true;
      this.close();
      return;
    } else {
      new import_obsidian9.Notice(`\u274C ${((_j = this.result) == null ? void 0 : _j.error) || "Insert failed"}`);
      this.isDone = true;
      this.close();
      return;
    }
  }
  renderResultStep() {
    var _a, _b;
    const { contentEl } = this;
    modalTitle(this, this.t("destResultTitle"));
    if (!this.result.success) {
      const errBanner = contentEl.createDiv({ cls: "fm-result-banner fm-result-banner-error" });
      errBanner.createDiv({
        cls: "fm-result-banner-title",
        text: this.t("destProcessingError", { err: formatFriendlyError(this, this.result.error) })
      });
      const btnRow2 = contentEl.createDiv({ cls: "fm-btn-row" });
      const closeBtn = btnRow2.createEl("button", { text: this.t("destBtnDone"), cls: "mod-cta" });
      closeBtn.onclick = () => {
        this.isDone = true;
        this.close();
      };
      return;
    }
    if (this.result.target === "remote") {
      const isInstant = this.result.isInstant;
      const banner = contentEl.createDiv({
        cls: `fm-result-banner ${isInstant ? "fm-result-banner-instant" : "fm-result-banner-success"}`
      });
      banner.createDiv({
        cls: "fm-result-banner-title",
        text: isInstant ? this.t("destInstantBadge") : this.t("destSuccessBadge")
      });
      banner.createDiv({
        cls: "fm-result-banner-desc",
        text: isInstant ? this.t("destInstantDesc") : this.t("destSuccessDesc")
      });
      const detailsBox = contentEl.createDiv({ cls: "fm-section-box" });
      detailsBox.createDiv({
        text: `\u{1F4C4} ${this.finalFilename}  |  ${formatBytes(this.fileInfo.size)}`,
        attr: { style: "font-weight: 600; margin-bottom: 12px; color: var(--text-normal);" }
      });
      const addCopyRow = (label, val) => {
        if (!val) return;
        detailsBox.createDiv({ cls: "fm-copy-row-label", text: label });
        const row = detailsBox.createDiv({ cls: "fm-copy-row" });
        row.createEl("input", { type: "text", value: val, attr: { readonly: true } });
        const copyBtn = row.createEl("button", { text: this.t("destBtnCopy"), cls: "fm-mini-btn" });
        copyBtn.onclick = async () => {
          await navigator.clipboard.writeText(val);
          copyBtn.setText(this.t("destBtnCopied"));
          setTimeout(() => {
            if (copyBtn && copyBtn.isConnected) copyBtn.setText(this.t("destBtnCopy"));
          }, 1800);
        };
      };
      addCopyRow(this.t("destLabelRawUrl"), (_a = this.result.res) == null ? void 0 : _a.rawUrl);
      if ((_b = this.result.res) == null ? void 0 : _b.pubUrl) {
        addCopyRow(this.t("destLabelPubUrl"), this.result.res.pubUrl);
      }
      addCopyRow(this.t("destLabelMarkdown"), this.result.finalMarkdown);
      if (this.result.inserted) {
        detailsBox.createDiv({
          cls: "fm-result-inserted-tip",
          text: this.t("destInsertedNotice")
        });
      }
    } else {
      const banner = contentEl.createDiv({ cls: "fm-result-banner fm-result-banner-local" });
      banner.createDiv({ cls: "fm-result-banner-title", text: this.t("destLocalBadge") });
      banner.createDiv({ cls: "fm-result-banner-desc", text: this.t("destLocalDesc") });
      const detailsBox = contentEl.createDiv({ cls: "fm-section-box" });
      detailsBox.createDiv({
        text: `\u{1F4C4} ${this.finalFilename}  |  ${formatBytes(this.fileInfo.size)}`,
        attr: { style: "font-weight: 600; margin-bottom: 12px; color: var(--text-normal);" }
      });
      const addCopyRow = (label, val) => {
        if (!val) return;
        detailsBox.createDiv({ cls: "fm-copy-row-label", text: label });
        const row = detailsBox.createDiv({ cls: "fm-copy-row" });
        row.createEl("input", { type: "text", value: val, attr: { readonly: true } });
        const copyBtn = row.createEl("button", { text: this.t("destBtnCopy"), cls: "fm-mini-btn" });
        copyBtn.onclick = async () => {
          await navigator.clipboard.writeText(val);
          copyBtn.setText(this.t("destBtnCopied"));
          setTimeout(() => {
            if (copyBtn && copyBtn.isConnected) copyBtn.setText(this.t("destBtnCopy"));
          }, 1800);
        };
      };
      addCopyRow(this.t("destLabelLocalPath"), this.result.localPath);
      addCopyRow(this.t("destLabelMarkdown"), this.result.mdLink);
      if (this.result.inserted) {
        detailsBox.createDiv({
          cls: "fm-result-inserted-tip",
          text: this.t("destInsertedNotice")
        });
      }
    }
    const btnRow = contentEl.createDiv({ cls: "fm-btn-row" });
    const doneBtn = btnRow.createEl("button", { text: this.t("destBtnDone"), cls: "mod-cta" });
    doneBtn.onclick = () => {
      this.isDone = true;
      this.close();
    };
  }
  onClose() {
    if (!this.isDone && this.callback) {
      this.callback({ target: null });
    }
    this.contentEl.empty();
  }
};

// src/references.js
function createTextReferenceMatcher(patterns) {
  const nodes = [{ next: /* @__PURE__ */ new Map(), fail: 0, outputs: [] }];
  for (const pattern of patterns) {
    const value = String(pattern.value || "").toLowerCase();
    if (!value) continue;
    let state = 0;
    for (let i = 0; i < value.length; i++) {
      const char = value[i];
      if (!nodes[state].next.has(char)) {
        nodes[state].next.set(char, nodes.length);
        nodes.push({ next: /* @__PURE__ */ new Map(), fail: 0, outputs: [] });
      }
      state = nodes[state].next.get(char);
    }
    nodes[state].outputs.push({ ...pattern, length: value.length });
  }
  const queue = [...nodes[0].next.values()];
  for (let head = 0; head < queue.length; head++) {
    const state = queue[head];
    for (const [char, next] of nodes[state].next) {
      queue.push(next);
      let fallback = nodes[state].fail;
      while (fallback && !nodes[fallback].next.has(char)) fallback = nodes[fallback].fail;
      nodes[next].fail = nodes[fallback].next.get(char) || 0;
      nodes[next].outputs = nodes[next].outputs.concat(nodes[nodes[next].fail].outputs);
    }
  }
  return (input) => {
    const text = String(input || "").toLowerCase();
    const found = /* @__PURE__ */ new Set();
    let state = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      while (state && !nodes[state].next.has(char)) state = nodes[state].fail;
      state = nodes[state].next.get(char) || 0;
      for (const pattern of nodes[state].outputs) {
        const start = i + 1 - pattern.length;
        if (pattern.wiki) {
          if (!/[\]|#]/.test(text[i + 1] || "")) continue;
        } else if (pattern.boundary) {
          if (start > 0 && !/[\[\(<"':/\\\s]/.test(text[start - 1])) continue;
          if (i + 1 < text.length && !/[\]\)>"'|#?\s]/.test(text[i + 1])) continue;
        }
        found.add(pattern.id);
      }
    }
    return found;
  };
}
function stripRemoteReferenceText(input) {
  return String(input || "").replace(/!?\[[^\]]*\]\(https?:\/\/[^)]+\)/gi, "").replace(/https?:\/\/[^\s)"'\]>]+/gi, "");
}
function createLocalReferenceMatcher(files, isDrawing) {
  const patterns = [];
  for (const file of files) {
    for (const value of /* @__PURE__ */ new Set([file.path, file.name])) {
      patterns.push({ value, id: file.path, boundary: true });
    }
    if (file.extension === "md" || file.extension === "excalidraw" || isDrawing(file)) {
      patterns.push({ value: `[[${file.basename || getBaseName(file.name)}`, id: file.path, wiki: true });
    }
  }
  return createTextReferenceMatcher(patterns);
}
function addReference(index, target, source) {
  if (target === source) return;
  if (!index.has(target)) index.set(target, /* @__PURE__ */ new Set());
  index.get(target).add(source);
}

// src/plugin/vault-scans.js
var import_obsidian10 = require("obsidian");
async function buildVaultReferenceSnapshot(plugin, scanCtx = {}) {
  const { signal, onProgress, freshRead = false } = scanCtx || {};
  const revision = plugin.referenceRevision || 0;
  const allFiles = plugin.app.vault.getFiles();
  const docFiles = allFiles.filter((f) => isScannableDocFile(plugin, f));
  const matchLocal = createLocalReferenceMatcher(allFiles, (file) => isExcalidrawFile2(plugin.app, file));
  const localReferences = /* @__PURE__ */ new Map();
  const docContents = [];
  for (let i = 0; i < docFiles.length; i++) {
    if (signal == null ? void 0 : signal.aborted) throw new Error("SCAN_ABORTED");
    const doc = docFiles[i];
    if (i % 25 === 0) {
      onProgress == null ? void 0 : onProgress(i + 1, docFiles.length, doc.path);
      await new Promise((r) => setTimeout(r, 0));
    }
    const rawText = freshRead ? await plugin.app.vault.read(doc) : await plugin.app.vault.cachedRead(doc);
    let decodedText = rawText;
    try {
      decodedText = decodeURIComponent(rawText);
    } catch (e) {
    }
    for (const target of matchLocal(stripRemoteReferenceText(rawText))) addReference(localReferences, target, doc.path);
    if (decodedText !== rawText) {
      for (const target of matchLocal(stripRemoteReferenceText(decodedText))) addReference(localReferences, target, doc.path);
    }
    docContents.push({
      file: doc,
      path: doc.path,
      rawText,
      decodedText
    });
  }
  if (!freshRead) {
    const resolvedLinks = plugin.app.metadataCache.resolvedLinks || {};
    for (const [sourcePath, targets] of Object.entries(resolvedLinks)) {
      if (isReportFile(sourcePath)) {
        continue;
      }
      for (const targetPath of Object.keys(targets || {})) {
        addReference(localReferences, targetPath, sourcePath);
      }
    }
  }
  return {
    docContents,
    localReferences,
    revision,
    signal,
    stable: revision === (plugin.referenceRevision || 0)
  };
}
function isReferenceSnapshotCurrent(plugin, snapshot) {
  return snapshot.stable && snapshot.revision === (plugin.referenceRevision || 0);
}
async function indexRemoteReferences(items, snapshot) {
  var _a;
  const patterns = [];
  for (const item of items) {
    const id = `${item.year}/${item.month}/${item.filename}`;
    const legacy = `${item.year}/${item.month}/${getBaseName(item.filename)}.webp`;
    for (const value of /* @__PURE__ */ new Set([id, encodeURI(id), legacy, encodeURI(legacy), item.rawUrl, item.pubUrl])) {
      if (value) patterns.push({ value, id });
    }
  }
  const match = createTextReferenceMatcher(patterns);
  snapshot.remoteReferences = new Map(items.map((item) => [`${item.year}/${item.month}/${item.filename}`, /* @__PURE__ */ new Set()]));
  for (let i = 0; i < snapshot.docContents.length; i++) {
    if ((_a = snapshot.signal) == null ? void 0 : _a.aborted) throw new Error("SCAN_ABORTED");
    if (i % 25 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    const doc = snapshot.docContents[i];
    for (const id of match(doc.rawText)) addReference(snapshot.remoteReferences, id, doc.path);
    if (doc.decodedText !== doc.rawText) {
      for (const id of match(doc.decodedText)) addReference(snapshot.remoteReferences, id, doc.path);
    }
  }
}
function findReferencingNotesForLocalFile(tfile, snapshot) {
  return [...snapshot.localReferences.get(tfile.path) || []];
}
function findReferencingNotesForRemoteItem(remoteItem, snapshot) {
  return [...snapshot.remoteReferences.get(`${remoteItem.year}/${remoteItem.month}/${remoteItem.filename}`) || []];
}
async function scanUnusedFiles(plugin, options, scanCtx = {}) {
  var _a;
  const { signal, onProgress } = scanCtx || {};
  const snapshot = await plugin.buildVaultReferenceSnapshot({ signal, onProgress });
  const allowedGroups = /* @__PURE__ */ new Set();
  if (options.typeNote) allowedGroups.add("note");
  if (options.typeImage) allowedGroups.add("image");
  if (options.typeAudio) allowedGroups.add("audio");
  if (options.typeOther) allowedGroups.add("other");
  const unusedList = [];
  if (options.scanLocal) {
    const allFiles = plugin.app.vault.getFiles();
    for (let i = 0; i < allFiles.length; i++) {
      if (signal == null ? void 0 : signal.aborted) throw new Error("SCAN_ABORTED");
      const f = allFiles[i];
      if (onProgress && i % 30 === 0) {
        onProgress(i + 1, allFiles.length, f.path);
        await new Promise((r) => setTimeout(r, 0));
      }
      if (isReportFile(f.name) || f.extension === "canvas") {
        continue;
      }
      if (isLocalPathExcluded(plugin.settings, f.path)) continue;
      const grp = getFileTypeGroup(f.extension);
      if (!allowedGroups.has(grp)) continue;
      const refs = findReferencingNotesForLocalFile(f, snapshot);
      if (refs.length === 0) {
        unusedList.push({
          id: `local:${f.path}`,
          source: "local",
          typeGroup: grp,
          name: f.name,
          displayPath: f.path,
          size: ((_a = f.stat) == null ? void 0 : _a.size) || 0,
          rawObj: f,
          selected: true
        });
      }
    }
  }
  if (options.scanRemote) {
    try {
      if (signal == null ? void 0 : signal.aborted) throw new Error("SCAN_ABORTED");
      const remoteFiles = await plugin.fetchRemoteFileList();
      await indexRemoteReferences(remoteFiles, snapshot);
      for (let i = 0; i < remoteFiles.length; i++) {
        if (signal == null ? void 0 : signal.aborted) throw new Error("SCAN_ABORTED");
        const r = remoteFiles[i];
        if (onProgress && i % 30 === 0) {
          onProgress(i + 1, remoteFiles.length, r.filename);
          await new Promise((res) => setTimeout(res, 0));
        }
        if (plugin.settings.excludeLockedRemoteFiles && (r.locked || r.inProtectedFolder)) {
          continue;
        }
        const ext = getExt(r.filename);
        const grp = getFileTypeGroup(ext);
        if (!allowedGroups.has(grp)) continue;
        const refs = findReferencingNotesForRemoteItem(r, snapshot);
        if (refs.length === 0) {
          unusedList.push({
            id: `remote:${r.year}/${r.month}/${r.filename}`,
            source: "remote",
            typeGroup: grp,
            name: r.filename,
            displayPath: `${r.year}/${r.month}/${r.filename}`,
            size: r.size || 0,
            rawObj: r,
            selected: true
          });
        }
      }
    } catch (err) {
      if (err.message === "SCAN_ABORTED") throw err;
      if (!options.scanLocal) {
        throw err;
      }
      new import_obsidian10.Notice(plugin.t("noticeRemoteUnreachable", { err: err.message }));
    }
  }
  return unusedList;
}
async function exportOrphanReportToRoot(plugin, results) {
  const now = /* @__PURE__ */ new Date();
  const dateStr = formatDateTimestamp(now);
  const reportPath = `Unused_Files_Report_${dateStr}.md`;
  const localItems = results.filter((r) => r.source === "local");
  const remoteItems = results.filter((r) => r.source === "remote");
  const totalBytes = results.reduce((s, r) => s + (r.size || 0), 0);
  const lines = [
    `# \u{1F9F9} Unused Files Inspection Report (${dateStr})`,
    ``,
    `> Generated: ${now.toLocaleString("en-US")}  |  Total Unused Files: **${results.length}**  |  Total Reclaimable Space: **${formatBytes(totalBytes)}**`,
    ``
  ];
  lines.push(`## \u{1F4BB} 1. Local Vault Unused Files (${localItems.length})`);
  if (localItems.length === 0) {
    lines.push(`- No unused local files`);
  } else {
    for (const item of localItems) {
      lines.push(`- [[${item.displayPath}]] \u2014 \`${formatBytes(item.size)}\``);
    }
  }
  lines.push(``);
  lines.push(`## \u2601\uFE0F 2. Remote Server Unused Files (${remoteItems.length})`);
  if (remoteItems.length === 0) {
    lines.push(`- No unused remote files`);
  } else {
    for (const item of remoteItems) {
      lines.push(`- [${item.displayPath}](${item.rawObj.rawUrl}) \u2014 \`${formatBytes(item.size)}\``);
    }
  }
  await plugin.writeOrUpdateRootReport(reportPath, lines.join("\n"));
  new import_obsidian10.Notice(plugin.t("noticeReportGenerated", { path: reportPath }));
}
async function writeOrUpdateRootReport(plugin, reportPath, content) {
  const existing = plugin.app.vault.getAbstractFileByPath(reportPath);
  let targetFile;
  if (existing) {
    await plugin.app.vault.modify(existing, content);
    targetFile = existing;
  } else {
    targetFile = await plugin.app.vault.create(reportPath, content);
  }
  const leaf = plugin.app.workspace.getLeaf(false);
  if (leaf && targetFile) {
    await leaf.openFile(targetFile);
  }
}
async function cleanSelectedOrphans(plugin, selectedItems, onDone) {
  return runAttachmentOperation(plugin, () => cleanOrphanItems(plugin, selectedItems, onDone));
}
async function cleanOrphanItems(plugin, selectedItems, onDone) {
  const remoteToClean = selectedItems.filter((i) => i.source === "remote");
  const localToClean = selectedItems.filter((i) => i.source === "local");
  if (remoteToClean.length > 0) {
    const remoteBytes = remoteToClean.reduce((s, i) => s + (i.size || 0), 0);
    const confirmed = await new Promise((resolve) => {
      new ConfirmActionModal(
        plugin.app,
        plugin.t("confirmRemoteOrphanTitle"),
        plugin.t("confirmRemoteOrphanMsg", { count: remoteToClean.length, size: formatBytes(remoteBytes) }),
        plugin.t("confirmRemoteOrphanBtn", { count: remoteToClean.length }),
        resolve
      ).open();
    });
    if (!confirmed) return;
  }
  let deletedLocal = 0;
  let deletedRemote = 0;
  let skipped = 0;
  const snapshot = await plugin.buildVaultReferenceSnapshot({ freshRead: true });
  await indexRemoteReferences(remoteToClean.map((item) => item.rawObj), snapshot);
  for (const item of localToClean) {
    if (!plugin.isReferenceSnapshotCurrent(snapshot)) {
      skipped++;
      continue;
    }
    if (findReferencingNotesForLocalFile(item.rawObj, snapshot).length) {
      skipped++;
      continue;
    }
    try {
      await plugin.app.vault.trash(item.rawObj, true);
      deletedLocal++;
    } catch (err) {
      console.error("Failed to delete local file:", err);
      plugin.logOperation("ERROR", "ORPHAN_CLEANUP", `Failed to move local file to trash: ${item.displayPath}`, { error: err.message });
    }
  }
  for (const item of remoteToClean) {
    if (!plugin.isReferenceSnapshotCurrent(snapshot)) {
      skipped++;
      continue;
    }
    if (findReferencingNotesForRemoteItem(item.rawObj, snapshot).length) {
      skipped++;
      continue;
    }
    try {
      await plugin.deleteRemoteFile(item.rawObj.year, item.rawObj.month, item.rawObj.filename);
      deletedRemote++;
    } catch (err) {
      new import_obsidian10.Notice(plugin.t("noticeRemoteDeleteFailed", { name: item.name, err: err.message }));
      plugin.logOperation("ERROR", "ORPHAN_CLEANUP", `Failed to delete remote file: ${item.displayPath}`, { error: err.message });
    }
  }
  plugin.logOperation("INFO", "ORPHAN_CLEANUP", `Cleaned unreferenced files: ${deletedLocal} local, ${deletedRemote} remote`, {
    files: selectedItems.map((i) => i.displayPath)
  });
  new import_obsidian10.Notice(plugin.t("noticeCleanupComplete", { local: deletedLocal, remote: deletedRemote }));
  if (onDone) onDone({ local: deletedLocal, remote: deletedRemote, skipped, total: deletedLocal + deletedRemote });
}
async function scanDuplicateGroups(plugin, scope, fileTypeOpts = null, scanCtx = {}) {
  var _a, _b;
  const { signal, onProgress } = scanCtx || {};
  const snapshot = await plugin.buildVaultReferenceSnapshot({ signal, onProgress });
  const hashMap = /* @__PURE__ */ new Map();
  const allowedGroups = /* @__PURE__ */ new Set();
  if (!fileTypeOpts) {
    allowedGroups.add("image");
    allowedGroups.add("audio");
    allowedGroups.add("other");
    allowedGroups.add("note");
  } else {
    if (fileTypeOpts.typeImage) allowedGroups.add("image");
    if (fileTypeOpts.typeAudio) allowedGroups.add("audio");
    if (fileTypeOpts.typeOther) allowedGroups.add("other");
    if (fileTypeOpts.typeNote) allowedGroups.add("note");
  }
  let localScanned = 0;
  let remoteScanned = 0;
  let remoteError = null;
  const addItem = (sha256, itemObj) => {
    if (!sha256) return;
    if (!hashMap.has(sha256)) hashMap.set(sha256, []);
    hashMap.get(sha256).push(itemObj);
  };
  const sizeBuckets = /* @__PURE__ */ new Map();
  const getBucket = (sz) => {
    let b = sizeBuckets.get(sz);
    if (!b) {
      b = { local: [], remote: [] };
      sizeBuckets.set(sz, b);
    }
    return b;
  };
  if (scope === "local" || scope === "both") {
    const allFiles = plugin.app.vault.getFiles();
    for (const f of allFiles) {
      if (signal == null ? void 0 : signal.aborted) throw new Error("SCAN_ABORTED");
      if (isReportFile(f.name) || f.extension === "canvas") {
        continue;
      }
      if (isLocalPathExcluded(plugin.settings, f.path)) continue;
      const grp = getFileTypeGroup(f.extension);
      if (!allowedGroups.has(grp)) continue;
      const size = ((_a = f.stat) == null ? void 0 : _a.size) || 0;
      if (size <= 0) continue;
      getBucket(size).local.push(f);
    }
  }
  if (scope === "remote" || scope === "both") {
    try {
      if (signal == null ? void 0 : signal.aborted) throw new Error("SCAN_ABORTED");
      const remoteFiles = await plugin.fetchRemoteFileList();
      await indexRemoteReferences(remoteFiles, snapshot);
      for (const r of remoteFiles) {
        if (!r.sha256) continue;
        const ext = getExt(r.filename);
        const grp = getFileTypeGroup(ext);
        if (!allowedGroups.has(grp)) continue;
        const size = r.size || 0;
        getBucket(size).remote.push(r);
      }
    } catch (err) {
      if (err.message === "SCAN_ABORTED") throw err;
      if (scope === "remote") {
        throw err;
      }
      remoteError = err.message;
    }
  }
  const bucketEntries = [...sizeBuckets.entries()];
  for (let bIdx = 0; bIdx < bucketEntries.length; bIdx++) {
    if (signal == null ? void 0 : signal.aborted) throw new Error("SCAN_ABORTED");
    const [, bucket] = bucketEntries[bIdx];
    let hasConflict = false;
    if (scope === "both") {
      hasConflict = bucket.local.length + bucket.remote.length >= 2;
    } else if (scope === "local") {
      hasConflict = bucket.local.length >= 2;
    } else if (scope === "remote") {
      hasConflict = bucket.remote.length >= 2;
    }
    if (!hasConflict) continue;
    if (scope === "remote" || scope === "both") {
      for (const r of bucket.remote) {
        if (signal == null ? void 0 : signal.aborted) throw new Error("SCAN_ABORTED");
        remoteScanned++;
        const ext = getExt(r.filename);
        const refNotes = findReferencingNotesForRemoteItem(r, snapshot);
        addItem(r.sha256, {
          id: `remote:${r.year}/${r.month}/${r.filename}`,
          source: "remote",
          name: r.filename,
          ext,
          displayPath: `${r.year}/${r.month}/${r.filename}`,
          size: r.size || 0,
          locked: Boolean(r.locked || r.inProtectedFolder),
          refNotes,
          rawObj: r
        });
      }
    }
    if (scope === "local" || scope === "both") {
      for (const f of bucket.local) {
        if (signal == null ? void 0 : signal.aborted) throw new Error("SCAN_ABORTED");
        if (onProgress) {
          onProgress(bIdx + 1, bucketEntries.length, f.path);
        }
        const buf = await plugin.app.vault.readBinary(f);
        if (!buf || buf.byteLength === 0) continue;
        localScanned++;
        const sha256 = await computeSha256Hex(buf);
        const refNotes = findReferencingNotesForLocalFile(f, snapshot);
        addItem(sha256, {
          id: `local:${f.path}`,
          source: "local",
          name: f.name,
          ext: f.extension.toLowerCase(),
          displayPath: f.path,
          size: ((_b = f.stat) == null ? void 0 : _b.size) || buf.byteLength,
          locked: false,
          refNotes,
          rawObj: f
        });
      }
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
  return {
    groups: duplicateGroups,
    stats: { localScanned, remoteScanned, remoteError }
  };
}
async function exportDuplicateReportToRoot(plugin, groups) {
  const now = /* @__PURE__ */ new Date();
  const dateStr = formatDateTimestamp(now);
  const reportPath = `Duplicate_Files_Report_${dateStr}.md`;
  const lines = [
    `# \u{1F50D} Duplicate Files Inspection Report (${dateStr})`,
    ``,
    `> Generated: ${now.toLocaleString("en-US")}  |  Duplicate Groups: **${groups.length}**`,
    ``
  ];
  if (groups.length === 0) {
    lines.push(`\u{1F389} No duplicate files found.`);
  } else {
    groups.forEach((grp, idx) => {
      lines.push(`## Duplicate Group #${idx + 1} (\`${grp.sha256.slice(0, 12)}...\`, Size: ${formatBytes(grp.size)})`);
      for (const item of grp.items) {
        const isKeep = grp.keepId === item.id ? " **[Current Keep Selection]**" : "";
        const lockTag = item.locked ? " `\u{1F512} Protected`" : "";
        const linkStr = item.source === "local" ? `\u{1F4BB} Local: [[${item.displayPath}]]` : `\u2601\uFE0F Remote: [${item.displayPath}](${item.rawObj.rawUrl})`;
        const refsStr = item.refNotes.length > 0 ? `Referencing Notes: ${item.refNotes.map((n) => `[[${n}]]`).join(", ")}` : `No direct note references`;
        lines.push(`- ${linkStr}${lockTag}${isKeep} \u2014 (${refsStr})`);
      }
      lines.push(``);
    });
  }
  await plugin.writeOrUpdateRootReport(reportPath, lines.join("\n"));
  new import_obsidian10.Notice(plugin.t("noticeReportGenerated", { path: reportPath }));
}
async function exportBatchMigrateReportToRoot(plugin, summary) {
  const now = /* @__PURE__ */ new Date();
  const dateStr = formatDateTimestamp(now);
  const timeStr = now.toLocaleTimeString("zh-CN", { hour12: false });
  const reportPath = `Batch_Migrate_Report_${dateStr}.md`;
  const count = (summary == null ? void 0 : summary.count) || 0;
  const docs = (summary == null ? void 0 : summary.docs) || 0;
  const totalBytes = (summary == null ? void 0 : summary.totalBytes) || 0;
  const trashed = (summary == null ? void 0 : summary.trashed) || 0;
  const items = (summary == null ? void 0 : summary.processedItems) || [];
  const failures = (summary == null ? void 0 : summary.failures) || [];
  const trashFailures = (summary == null ? void 0 : summary.trashFailures) || [];
  const lines = [
    `# \u{1F680} \u6279\u91CF\u4E91\u7AEF\u8FC1\u79FB\u62A5\u544A / Batch Migration Report (${dateStr})`,
    ``,
    `> \u751F\u6210\u65F6\u95F4 / Generated: ${dateStr} ${timeStr}  |  \u6210\u529F\u8FC1\u79FB\u9644\u4EF6 / Uploaded: **${count}** (${formatBytes(totalBytes)})  |  \u66F4\u65B0\u7B14\u8BB0 / Notes Updated: **${docs}**  |  \u672C\u5730\u6E05\u7406 / Trashed: **${trashed}**`,
    ``,
    `## \u{1F4CA} \u8FC1\u79FB\u6C47\u603B\u7EDF\u8BA1 / Summary Statistics`,
    `- **\u6210\u529F\u4E0A\u4F20\u6587\u4EF6 (Total Uploaded)**: ${count} \u4E2A (${formatBytes(totalBytes)})`,
    `- **\u5F15\u7528\u94FE\u63A5\u5DF2\u66F4\u65B0\u7B14\u8BB0 (Notes Updated)**: ${docs} \u7BC7`,
    `- **\u672C\u5730\u539F\u6587\u4EF6\u5DF2\u79FB\u5165\u56DE\u6536\u7AD9 (Local Trashed)**: ${trashed} \u4E2A`,
    `- **\u4E0A\u4F20\u5931\u8D25\u9879 (Failed Uploads)**: ${failures.length} \u4E2A`,
    ...trashFailures.length > 0 ? [`- **\u672C\u5730\u6E05\u7406\u5931\u8D25\u9879 (Failed Local Cleanups)**: ${trashFailures.length} \u4E2A`] : [],
    ``,
    `## \u2601\uFE0F \u5DF2\u8FC1\u79FB\u9644\u4EF6\u6E05\u5355 / Migrated Assets (${items.length})`,
    ``
  ];
  if (items.length === 0) {
    lines.push(`- \u65E0\u5DF2\u8FC1\u79FB\u9644\u4EF6 / No assets were migrated.`);
  } else {
    lines.push(`| # | \u672C\u5730\u539F\u8DEF\u5F84 (Local Path) | \u670D\u52A1\u5668\u94FE\u63A5 (Remote URL) | \u6587\u4EF6\u5927\u5C0F (Size) | \u5F15\u7528\u6570 (Refs) |`);
    lines.push(`|---|---|---|---|---|`);
    items.forEach((item, idx) => {
      const localPath = item.displayPath || item.name;
      const remoteUrl = item.rawUrl || item.rawObj && item.rawObj.rawUrl || "";
      const sizeStr = formatBytes(item.size || 0);
      const refsCount = item.refNotesCount !== void 0 ? `${item.refNotesCount} \u7BC7` : "-";
      const remoteLink = remoteUrl ? `[${item.name || "Link"}](${remoteUrl})` : "-";
      lines.push(`| ${idx + 1} | \`${localPath}\` | ${remoteLink} | ${sizeStr} | ${refsCount} |`);
    });
  }
  if (failures.length > 0) {
    lines.push(``);
    lines.push(`## \u26A0\uFE0F \u4E0A\u4F20\u5931\u8D25\u9879 / Failed Uploads (${failures.length})`);
    lines.push(``);
    failures.forEach((f, idx) => {
      lines.push(`- **#${idx + 1}**: \`${f.path || f.name}\` (${formatBytes(f.size || 0)}) \u2014 \u9519\u8BEF\u539F\u56E0 / Reason: ${f.error}`);
    });
  }
  if (trashFailures.length > 0) {
    lines.push(``);
    lines.push(`## \u26A0\uFE0F \u672C\u5730\u6E05\u7406\u5931\u8D25\u9879 / Failed Local Cleanups (${trashFailures.length})`);
    lines.push(``);
    trashFailures.forEach((tf, idx) => {
      lines.push(`- **#${idx + 1}**: \`${tf.path}\` \u2014 \u9519\u8BEF\u539F\u56E0 / Reason: ${tf.error}`);
    });
  }
  lines.push(``);
  lines.push(`---`);
  lines.push(`*Generated by File Master Obsidian Plugin*`);
  await plugin.writeOrUpdateRootReport(reportPath, lines.join("\n"));
  new import_obsidian10.Notice(plugin.t("noticeReportGenerated", { path: reportPath }));
  return reportPath;
}
async function openNoteAtLine(plugin, filePath, lineNumber) {
  const file = plugin.app.vault.getAbstractFileByPath(filePath);
  if (file && file instanceof import_obsidian10.TFile) {
    const leaf = plugin.app.workspace.getLeaf(false);
    await leaf.openFile(file);
    const view = leaf.view;
    if (view && view.editor && lineNumber) {
      const lineIdx = Math.max(0, lineNumber - 1);
      view.editor.setCursor({ line: lineIdx, ch: 0 });
      view.editor.scrollIntoView(
        { from: { line: lineIdx, ch: 0 }, to: { line: lineIdx, ch: 0 } },
        true
      );
    }
  } else {
    new import_obsidian10.Notice(plugin.t("noticeCannotOpenFile", { path: filePath }));
  }
}

// src/transfers.js
function throwIfTransferCancelled(signal) {
  if (signal == null ? void 0 : signal.aborted) throw Object.assign(new Error("TRANSFER_CANCELLED"), { name: "AbortError" });
}
function transferDelay(ms, signal) {
  return new Promise((resolve, reject) => {
    const cancelled = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error("TRANSFER_CANCELLED"), { name: "AbortError" }));
    };
    const timer = setTimeout(() => {
      signal == null ? void 0 : signal.removeEventListener("abort", cancelled);
      resolve();
    }, ms);
    if (signal == null ? void 0 : signal.aborted) cancelled();
    else signal == null ? void 0 : signal.addEventListener("abort", cancelled, { once: true });
  });
}
async function requestWithBackoff(request, { signal, delay = transferDelay, maxRetries = 4 } = {}) {
  var _a, _b;
  for (let attempt = 0; ; attempt++) {
    throwIfTransferCancelled(signal);
    let response;
    try {
      response = await request();
      if (attempt >= maxRetries || ![429, 500, 502, 503, 504].includes(response.status)) return response;
    } catch (err) {
      if ((signal == null ? void 0 : signal.aborted) || attempt >= maxRetries || err.name === "AbortError") throw err;
    }
    const headers = (response == null ? void 0 : response.headers) || {};
    const retryAfter = (_a = headers["retry-after"]) != null ? _a : headers["Retry-After"];
    let wait = retryAfter !== void 0 && Number.isFinite(Number(retryAfter)) ? Number(retryAfter) * 1e3 : Number.isFinite(Date.parse(retryAfter)) ? Math.max(0, Date.parse(retryAfter) - Date.now()) : null;
    if (wait === null && (response == null ? void 0 : response.status) === 429) {
      try {
        if ((_b = response.json) == null ? void 0 : _b.retryAfter) wait = Number(response.json.retryAfter) * 1e3;
      } catch (e) {
      }
    }
    await delay(Math.min(12e4, Math.max(250, wait != null ? wait : 1e3 * 2 ** attempt + Math.random() * 250)), signal);
  }
}
async function runAttachmentOperation(plugin, task, signal) {
  if (plugin.attachmentOperationRunning) throw new Error(plugin.t("transferBusy"));
  plugin.attachmentOperationRunning = true;
  const controller = new AbortController();
  const cancelled = () => controller.abort();
  if (signal == null ? void 0 : signal.aborted) cancelled();
  else signal == null ? void 0 : signal.addEventListener("abort", cancelled, { once: true });
  plugin.activeTransferController = controller;
  try {
    return await task(controller.signal);
  } finally {
    signal == null ? void 0 : signal.removeEventListener("abort", cancelled);
    plugin.activeTransferController = null;
    plugin.attachmentOperationRunning = false;
  }
}
async function rewriteAttachmentPairs(plugin, pairs, documentPaths = null) {
  const snapshot = await plugin.buildVaultReferenceSnapshot({ freshRead: true });
  const remoteItems = pairs.filter((p) => p.removeItem.source === "remote").map((p) => p.removeItem.rawObj);
  if (remoteItems.length) await indexRemoteReferences(remoteItems, snapshot);
  const allowed = documentPaths ? new Set(documentPaths) : null;
  const byDocument = /* @__PURE__ */ new Map();
  const changedPaths = new Map(pairs.map((pair) => [pair, []]));
  for (const pair of pairs) {
    const refs = pair.removeItem.source === "local" ? findReferencingNotesForLocalFile(pair.removeItem.rawObj, snapshot) : findReferencingNotesForRemoteItem(pair.removeItem.rawObj, snapshot);
    for (const path of refs) {
      if (allowed && !allowed.has(path)) continue;
      if (!byDocument.has(path)) byDocument.set(path, []);
      byDocument.get(path).push(pair);
    }
  }
  const modified = /* @__PURE__ */ new Set();
  for (const doc of snapshot.docContents) {
    const relevant = byDocument.get(doc.path);
    if (!relevant) continue;
    const changedPairs = /* @__PURE__ */ new Set();
    const changed = await safeModifyFileContent(plugin, doc.file, (current) => {
      let next = current;
      for (const pair of relevant) {
        const updated = plugin.rewriteContentLinks(next, pair.removeItem, pair.keepItem, doc.path);
        if (updated !== next) changedPairs.add(pair);
        next = updated;
      }
      return next;
    });
    if (changed) {
      modified.add(doc.path);
      for (const pair of changedPairs) changedPaths.get(pair).push(doc.path);
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return { modified, changedPaths };
}
function migrationCheckpointPath(plugin) {
  return getLogFilePath(plugin).replace(/operation\.log$/, "migration-pending.json");
}
async function saveMigrationCheckpoint(plugin, items, options) {
  const adapter = plugin.app.vault.adapter;
  if (!adapter) return;
  const path = migrationCheckpointPath(plugin);
  if (!items.length) {
    if (await adapter.exists(path)) await adapter.remove(path);
    return;
  }
  await adapter.write(path, JSON.stringify({
    version: 1,
    serverUrl: plugin.getCleanServerUrl(),
    options: { deleteLocalAfter: Boolean(options.deleteLocalAfter), documentPaths: options.documentPaths || null },
    items: items.map((entry) => ({ path: (entry.tfile || entry.rawObj || entry).path, locked: Boolean(entry.locked) }))
  }));
}
function formatSpeed(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec <= 0) return "0 KB/s";
  if (bytesPerSec >= 1024 * 1024) return (bytesPerSec / (1024 * 1024)).toFixed(1) + " MB/s";
  return Math.round(bytesPerSec / 1024) + " KB/s";
}
function formatEta(seconds) {
  if (!seconds || seconds <= 0 || !isFinite(seconds)) return "";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}
async function migrateLocalAttachments(plugin, items, options = {}, onProgress = null) {
  var _a, _b, _c, _d, _e, _f, _g, _h, _i;
  await saveMigrationCheckpoint(plugin, items, options);
  const uploaded = [], failures = [], retryItems = [];
  const batchStart = Date.now();
  let transferredBytes = 0;
  let lastSpeed = "";
  const totalBytes = items.reduce((sum, item) => {
    var _a2;
    const tf = item.tfile || item.rawObj || item;
    return sum + (((_a2 = tf.stat) == null ? void 0 : _a2.size) || 0);
  }, 0);
  for (let i = 0; i < items.length; i++) {
    if ((_a = options.signal) == null ? void 0 : _a.aborted) {
      retryItems.push(...items.slice(i));
      break;
    }
    const entry = items[i];
    const tfile = entry.tfile || entry.rawObj || entry;
    const fileSize = ((_b = tfile.stat) == null ? void 0 : _b.size) || 0;
    const sourceVersion = { ...tfile.stat };
    const elapsedSec = Math.max(0.1, (Date.now() - batchStart) / 1e3);
    const avgSpeed = transferredBytes / elapsedSec;
    const speedText = transferredBytes > 0 ? formatSpeed(avgSpeed) : lastSpeed;
    const remainingBytes = Math.max(0, totalBytes - transferredBytes);
    const etaSec = avgSpeed > 0 ? Math.ceil(remainingBytes / avgSpeed) : 0;
    const etaText = formatEta(etaSec);
    onProgress == null ? void 0 : onProgress(i + 1, items.length, tfile.name, {
      speedText,
      etaText,
      transferredBytes,
      totalBytes
    });
    const fileStart = Date.now();
    try {
      const bytes = await plugin.app.vault.readBinary(tfile);
      const remote = await plugin.uploadBufferToServer(bytes, tfile.name, "application/octet-stream", { signal: options.signal });
      const fileDurationSec = Math.max(0.05, (Date.now() - fileStart) / 1e3);
      const fileSpeed = (bytes.byteLength || fileSize) / fileDurationSec;
      lastSpeed = remote.isInstant ? "\u26A1 \u79D2\u4F20" : formatSpeed(fileSpeed);
      transferredBytes += bytes.byteLength || fileSize;
      if (entry.locked && !remote.locked) {
        await plugin.toggleRemoteFileLock(remote.year, remote.month, remote.filename, true);
        remote.locked = true;
      }
      uploaded.push({
        entry,
        tfile,
        sourceVersion,
        sourceSha: remote.sha256,
        removeItem: { source: "local", name: tfile.name, ext: tfile.extension.toLowerCase(), displayPath: tfile.path, rawObj: tfile },
        keepItem: {
          source: "remote",
          name: remote.filename,
          ext: getExt(remote.filename),
          displayPath: `${remote.year}/${remote.month}/${remote.filename}`,
          rawObj: remote
        }
      });
    } catch (err) {
      retryItems.push(entry);
      if (err.name === "AbortError") {
        retryItems.push(...items.slice(i + 1));
        break;
      }
      failures.push({ name: tfile.name, path: tfile.path, size: ((_c = tfile.stat) == null ? void 0 : _c.size) || 0, error: err.message || String(err) });
      plugin.logOperation("ERROR", "BATCH_UPLOAD", `Failed to upload ${tfile.path}`, { error: err.message });
    }
  }
  for (let i = uploaded.length - 1; i >= 0; i--) {
    const pair = uploaded[i];
    if (pair.sourceVersion.mtime !== ((_d = pair.tfile.stat) == null ? void 0 : _d.mtime) || pair.sourceVersion.size !== ((_e = pair.tfile.stat) == null ? void 0 : _e.size)) {
      if (await computeSha256Hex(await plugin.app.vault.readBinary(pair.tfile)) !== pair.sourceSha) {
        uploaded.splice(i, 1);
        retryItems.push(pair.entry);
        failures.push({
          name: pair.tfile.name,
          path: pair.tfile.path,
          size: ((_f = pair.tfile.stat) == null ? void 0 : _f.size) || 0,
          error: plugin.t("transferSourceChanged")
        });
      }
    }
  }
  const rewritten = uploaded.length ? await rewriteAttachmentPairs(plugin, uploaded, options.documentPaths) : { modified: /* @__PURE__ */ new Set(), changedPaths: /* @__PURE__ */ new Map() };
  const postSnapshot = uploaded.length && options.deleteLocalAfter ? await plugin.buildVaultReferenceSnapshot({ freshRead: true }) : null;
  const trashedFiles = [], trashFailures = [], processedItems = [];
  for (const pair of uploaded) {
    const { tfile, keepItem } = pair;
    const remote = keepItem.rawObj;
    const syncedPaths = (rewritten.changedPaths.get(pair) || []).filter((p) => {
      var _a2;
      return p !== ((_a2 = options.activeFile) == null ? void 0 : _a2.path);
    });
    const remaining = postSnapshot ? findReferencingNotesForLocalFile(tfile, postSnapshot) : [];
    const result = {
      source: "remote",
      name: remote.filename,
      ext: keepItem.ext,
      displayPath: keepItem.displayPath,
      localPath: tfile.path,
      size: ((_g = tfile.stat) == null ? void 0 : _g.size) || 0,
      locked: Boolean(remote.locked),
      rawObj: remote,
      rawUrl: remote.rawUrl,
      pubUrl: remote.pubUrl,
      action: "uploaded",
      trashedLocal: false,
      keptForOtherRefs: remaining.length,
      keptForOtherRefPaths: remaining,
      syncedOtherNotes: syncedPaths.length,
      syncedOtherNotePaths: syncedPaths,
      refNotesCount: ((_h = pair.entry.refNotes) == null ? void 0 : _h.length) || 0
    };
    if (postSnapshot && !remaining.length) {
      try {
        const latest = await plugin.app.vault.readBinary(tfile);
        if (await computeSha256Hex(latest) !== pair.sourceSha) throw new Error(plugin.t("transferSourceChanged"));
        if (!plugin.isReferenceSnapshotCurrent(postSnapshot)) throw new Error(plugin.t("transferReferencesChanged"));
        await plugin.app.vault.trash(tfile, true);
        result.trashedLocal = true;
        trashedFiles.push(tfile.path);
      } catch (err) {
        result.trashError = err.message || String(err);
        trashFailures.push({ path: tfile.path, error: result.trashError });
        retryItems.push(pair.entry);
      }
    }
    processedItems.push(result);
  }
  await saveMigrationCheckpoint(plugin, retryItems, options);
  const summary = {
    count: uploaded.length,
    docs: rewritten.modified.size,
    modifiedNotePaths: [...rewritten.modified],
    trashed: trashedFiles.length,
    trashedFiles,
    processedItems,
    failures,
    trashFailures,
    retryItems,
    cancelled: Boolean((_i = options.signal) == null ? void 0 : _i.aborted),
    totalBytes: processedItems.reduce((sum, item) => sum + item.size, 0)
  };
  plugin.logOperation("INFO", "BATCH_UPLOAD", `Uploaded ${summary.count}, updated ${summary.docs}, trashed ${summary.trashed}`, {
    failures: failures.length,
    unfinished: retryItems.length,
    cancelled: summary.cancelled
  });
  return summary;
}

// src/plugin/server-client.js
var import_obsidian11 = require("obsidian");
function filterAllowedFiles(settings, fileList) {
  const out = [];
  for (let i = 0; i < fileList.length; i++) {
    const f = fileList[i];
    const ext = getExt(f.name) || (f.type.startsWith("image/") ? "png" : "");
    if (IMAGE_EXTS.has(ext)) {
      out.push(f);
    } else if (settings.uploadNonImageAttachments && isAttachmentExt(ext)) {
      out.push(f);
    }
  }
  return out;
}
function getCleanServerUrl(settings) {
  return String(settings.serverUrl || "http://localhost:3000").replace(/\/+$/, "");
}
async function handleIncomingBrowserFile(plugin, file, editor) {
  const arrayBuffer = await file.arrayBuffer();
  const ext = getExt(file.name) || (file.type.startsWith("image/") ? "png" : "bin");
  const rawOriginBase = sanitizeCleanBaseName(getBaseName(file.name), "Pasted_image");
  const sha256 = await computeSha256Hex(arrayBuffer);
  const activeFile = plugin.app.workspace.getActiveFile();
  const noteName = activeFile ? activeFile.basename : "note";
  let defaultBaseName = rawOriginBase;
  if (plugin.settings.namingMode === "rule") {
    defaultBaseName = applyNamingPattern(plugin.settings.namingPattern, {
      noteName,
      originBase: rawOriginBase,
      sha256
    });
  } else if (/^image$/i.test(rawOriginBase)) {
    defaultBaseName = `Pasted_${applyNamingPattern("{date}_{time}", { noteName, originBase: rawOriginBase, sha256 })}`;
  }
  const askLocation = plugin.settings.saveLocationMode === "ask";
  const promptRename = plugin.settings.namingMode === "prompt";
  const fileInfo = {
    arrayBuffer,
    defaultBaseName,
    ext,
    size: file.size || arrayBuffer.byteLength,
    mimeType: file.type || "application/octet-stream",
    sha256
  };
  const modalOptions = {
    askLocation,
    fixedLocation: plugin.settings.saveLocationMode,
    promptRename,
    plugin,
    editor,
    activeFile
  };
  new IncomingFileModal(plugin.app, fileInfo, modalOptions).open();
}
async function probeRemoteSha256(plugin, sha256) {
  var _a;
  try {
    const serverUrl = plugin.getCleanServerUrl();
    if (!serverUrl || !plugin.settings.apiToken || !sha256) return null;
    const response = await (0, import_obsidian11.requestUrl)({
      url: `${serverUrl}/api/image/probe?sha256=${encodeURIComponent(sha256)}`,
      method: "GET",
      headers: {
        Authorization: `Bearer ${plugin.settings.apiToken}`
      },
      throw: false
    });
    if (response.status === 200 && ((_a = response.json) == null ? void 0 : _a.exists)) {
      return response.json;
    }
  } catch (e) {
  }
  return null;
}
async function uploadBufferToServer(plugin, arrayBuffer, filename, mimeType = "application/octet-stream", options = {}) {
  var _a;
  const opts = options || {};
  throwIfTransferCancelled(opts.signal);
  const fullSha256 = await computeSha256Hex(arrayBuffer);
  if (!opts.skipProbe) {
    try {
      const probed = await plugin.probeRemoteSha256(fullSha256);
      if (probed && probed.exists && probed.sha256 === fullSha256) {
        probed.isInstant = true;
        return probed;
      }
    } catch (e) {
    }
  }
  const url = `${plugin.getCleanServerUrl()}/api/image/upload`;
  const { boundary, arrayBuffer: bodyBuffer } = buildMultipartBuffer(arrayBuffer, filename, mimeType);
  const headers = {
    Authorization: `Bearer ${plugin.settings.apiToken}`,
    "X-File-Name": encodeURIComponent(filename),
    "Content-Type": `multipart/form-data; boundary=${boundary}`
  };
  const response = await requestWithBackoff(() => (0, import_obsidian11.requestUrl)({
    url,
    method: "POST",
    headers,
    body: bodyBuffer,
    throw: false
  }), { signal: opts.signal });
  if (response.status < 200 || response.status >= 300) {
    const errMsg = ((_a = response.json) == null ? void 0 : _a.error) || `HTTP ${response.status}`;
    throw new Error(errMsg);
  }
  const result = response.json;
  if (!result.sha256 || result.sha256 !== fullSha256) throw new Error(plugin.t("transferIntegrityFailed"));
  return result;
}
async function toggleRemoteFileLock(plugin, year, month, filename, locked = true) {
  var _a;
  const url = `${plugin.getCleanServerUrl()}/api/modules/image-host/lock`;
  const response = await (0, import_obsidian11.requestUrl)({
    url,
    method: "POST",
    headers: {
      Authorization: `Bearer ${plugin.settings.apiToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ year, month, filename, locked }),
    throw: false
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(((_a = response.json) == null ? void 0 : _a.error) || `Lock operation failed (HTTP ${response.status})`);
  }
  return response.json;
}
async function checkServerCompatibility(plugin) {
  var _a, _b, _c;
  if (!((_a = plugin.settings) == null ? void 0 : _a.enableRemoteServer)) {
    plugin.lastServerCompatStatus = null;
    if (plugin.settings) {
      plugin.settings.serverVerified = false;
      await plugin.saveSettings();
    }
    return null;
  }
  const pluginVer = ((_b = plugin.manifest) == null ? void 0 : _b.version) || "0.1.1";
  const serverUrl = plugin.getCleanServerUrl();
  if (!serverUrl) {
    plugin.lastServerCompatStatus = {
      ok: false,
      status: "offline",
      error: "No URL configured",
      serverVersion: null
    };
    plugin.settings.serverVerified = false;
    await plugin.saveSettings();
    return plugin.lastServerCompatStatus;
  }
  try {
    const verUrl = `${serverUrl}/api/platform/version`;
    const verRes = await (0, import_obsidian11.requestUrl)({
      url: verUrl,
      method: "GET",
      throw: false
    });
    if (verRes.status !== 200) {
      plugin.lastServerCompatStatus = {
        ok: false,
        status: "offline",
        serverVersion: null,
        error: `HTTP ${verRes.status}`
      };
      plugin.settings.serverVerified = false;
      await plugin.saveSettings();
      return plugin.lastServerCompatStatus;
    }
    const verData = verRes.json || {};
    const serverVer = verData.version || "0.1.0";
    const minPluginReq = verData.minPluginVersion || "0.1.0";
    if (compareSemver(pluginVer, minPluginReq) < 0) {
      plugin.lastServerCompatStatus = {
        ok: false,
        status: "plugin_outdated",
        serverVersion: serverVer,
        pluginVersion: pluginVer,
        minPluginVersion: minPluginReq,
        features: verData.features || {}
      };
      plugin.settings.serverVerified = false;
      await plugin.saveSettings();
      return plugin.lastServerCompatStatus;
    }
    if (compareSemver(serverVer, MIN_SERVER_VERSION) < 0) {
      plugin.lastServerCompatStatus = {
        ok: false,
        status: "server_outdated",
        serverVersion: serverVer,
        pluginVersion: pluginVer,
        minServerVersion: MIN_SERVER_VERSION,
        features: verData.features || {}
      };
      plugin.settings.serverVerified = false;
      await plugin.saveSettings();
      return plugin.lastServerCompatStatus;
    }
    let assetCount = 0;
    const token = (plugin.settings.apiToken || "").trim();
    if (!token) {
      plugin.lastServerCompatStatus = {
        ok: false,
        status: "token_missing",
        serverVersion: serverVer,
        pluginVersion: pluginVer,
        features: verData.features || {}
      };
      plugin.settings.serverVerified = false;
      await plugin.saveSettings();
      return plugin.lastServerCompatStatus;
    }
    let listRes;
    try {
      listRes = await (0, import_obsidian11.requestUrl)({
        url: `${serverUrl}/api/modules/image-host/list`,
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        throw: false
      });
    } catch (netErr) {
      plugin.lastServerCompatStatus = {
        ok: false,
        status: "offline",
        serverVersion: serverVer,
        pluginVersion: pluginVer,
        error: netErr.message || String(netErr)
      };
      plugin.settings.serverVerified = false;
      await plugin.saveSettings();
      return plugin.lastServerCompatStatus;
    }
    if (listRes.status === 401 || listRes.status === 403) {
      plugin.lastServerCompatStatus = {
        ok: false,
        status: "auth_failed",
        serverVersion: serverVer,
        pluginVersion: pluginVer,
        features: verData.features || {}
      };
      plugin.settings.serverVerified = false;
      await plugin.saveSettings();
      return plugin.lastServerCompatStatus;
    }
    if (listRes.status !== 200) {
      plugin.lastServerCompatStatus = {
        ok: false,
        status: "server_error",
        statusCode: listRes.status,
        serverVersion: serverVer,
        pluginVersion: pluginVer,
        features: verData.features || {}
      };
      plugin.settings.serverVerified = false;
      await plugin.saveSettings();
      return plugin.lastServerCompatStatus;
    }
    assetCount = (((_c = listRes.json) == null ? void 0 : _c.images) || []).length;
    plugin.lastServerCompatStatus = {
      ok: true,
      status: "compatible",
      serverVersion: serverVer,
      pluginVersion: pluginVer,
      apiVersion: verData.apiVersion || 1,
      assetCount,
      features: verData.features || {}
    };
    plugin.settings.serverVerified = true;
    await plugin.saveSettings();
    return plugin.lastServerCompatStatus;
  } catch (err) {
    plugin.lastServerCompatStatus = {
      ok: false,
      status: "offline",
      serverVersion: null,
      error: err.message || "Network error"
    };
    plugin.settings.serverVerified = false;
    await plugin.saveSettings();
    return plugin.lastServerCompatStatus;
  }
}
async function fetchRemoteFileList(plugin) {
  var _a;
  const url = `${plugin.getCleanServerUrl()}/api/modules/image-host/list`;
  const response = await (0, import_obsidian11.requestUrl)({
    url,
    method: "GET",
    headers: { Authorization: `Bearer ${plugin.settings.apiToken}` },
    throw: false
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(((_a = response.json) == null ? void 0 : _a.error) || `Unable to fetch remote asset list (HTTP ${response.status})`);
  }
  return (response.json.images || []).map((item) => ({ ...item, optimizationEnabled: response.json.optimizationEnabled !== false }));
}
async function deleteRemoteFile(plugin, year, month, filename) {
  var _a;
  const url = `${plugin.getCleanServerUrl()}/api/modules/image-host/item/${encodeURIComponent(year)}/${encodeURIComponent(month)}/${encodeURIComponent(filename)}`;
  const response = await (0, import_obsidian11.requestUrl)({
    url,
    method: "DELETE",
    headers: { Authorization: `Bearer ${plugin.settings.apiToken}` },
    throw: false
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(((_a = response.json) == null ? void 0 : _a.error) || `Failed to delete remote file (HTTP ${response.status})`);
  }
  return true;
}
async function fetchRemoteTrash(plugin) {
  var _a;
  const response = await (0, import_obsidian11.requestUrl)({ url: `${plugin.getCleanServerUrl()}/api/modules/image-host/trash`, method: "GET", headers: { Authorization: `Bearer ${plugin.settings.apiToken}` }, throw: false });
  if (response.status < 200 || response.status >= 300) throw new Error(((_a = response.json) == null ? void 0 : _a.error) || `HTTP ${response.status}`);
  return response.json.items || [];
}
async function restoreRemoteTrash(plugin, id) {
  var _a;
  const response = await (0, import_obsidian11.requestUrl)({ url: `${plugin.getCleanServerUrl()}/api/modules/image-host/trash/${encodeURIComponent(id)}/restore`, method: "POST", headers: { Authorization: `Bearer ${plugin.settings.apiToken}` }, throw: false });
  if (response.status < 200 || response.status >= 300) throw new Error(((_a = response.json) == null ? void 0 : _a.error) || `HTTP ${response.status}`);
  return response.json;
}
async function permanentlyDeleteRemoteTrash(plugin, id) {
  var _a;
  const response = await (0, import_obsidian11.requestUrl)({
    url: `${plugin.getCleanServerUrl()}/api/modules/image-host/trash/${encodeURIComponent(id)}`,
    method: "DELETE",
    headers: { Authorization: `Bearer ${plugin.settings.apiToken}` },
    throw: false
  });
  if (response.status < 200 || response.status >= 300) throw new Error(((_a = response.json) == null ? void 0 : _a.error) || `HTTP ${response.status}`);
  return response.json;
}

// src/modals/batch-migrate-wizard.js
var import_obsidian12 = require("obsidian");
var BatchMigrateWizardModal = class extends FileMasterModal {
  constructor(app, plugin, initialFolder = "") {
    super(app);
    this.plugin = plugin;
    this.step = 1;
    this.activeProgress = null;
    this.options = {
      folderPrefix: initialFolder || "",
      typeImage: true,
      typeAudio: true,
      typeOther: true,
      deleteLocalAfter: plugin.settings.deleteLocalAfterMigrate
    };
    this.items = [];
  }
  onOpen() {
    this.render();
  }
  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("fm-wizard-modal");
    if (this.step === 1) {
      this.renderStep1(contentEl);
    } else if (this.step === 2) {
      this.renderStep2(contentEl);
    } else if (this.step === 3) {
      this.renderStep3(contentEl);
    }
  }
  renderStep1(contentEl) {
    const t2 = (k, p) => this.plugin.t(k, p);
    moduleHeading(this, contentEl, { title: "actMigrateTitle", symbol: "cloud-upload", step: 1, total: 2 });
    contentEl.createEl("p", { text: t2("migrateStep1Desc"), cls: "fm-module-summary" });
    const folderBox = contentEl.createDiv({ cls: "fm-section-box" });
    folderBox.createDiv({ text: t2("migrateFolderScope"), cls: "fm-section-title" });
    const folderSelect = folderBox.createEl("select", { attr: { style: "width:100%; padding:8px 10px; border-radius:6px;" } });
    folderSelect.createEl("option", {
      value: "",
      text: t2("migrateEntireVault")
    });
    const allFolders = getAllVaultFolderPaths(this.plugin.app);
    for (const fp of allFolders) {
      const opt = folderSelect.createEl("option", { value: fp, text: `\u{1F4C1} ${fp}/` });
      if (fp === this.options.folderPrefix) opt.selected = true;
    }
    folderSelect.onchange = () => {
      this.options.folderPrefix = folderSelect.value;
    };
    const typeBox = contentEl.createDiv({ cls: "fm-section-box" });
    typeBox.createDiv({ text: t2("migrateTypeScope"), cls: "fm-section-title" });
    this.createCheck(typeBox, t2("migrateTypeImage"), "typeImage");
    this.createCheck(typeBox, t2("migrateTypeAudio"), "typeAudio");
    this.createCheck(typeBox, t2("migrateTypeOther"), "typeOther");
    const policyBox = contentEl.createDiv({ cls: "fm-section-box" });
    policyBox.createDiv({ text: t2("migratePolicyTitle"), cls: "fm-section-title" });
    this.createCheck(
      policyBox,
      t2("migrateDeleteLocal"),
      "deleteLocalAfter"
    );
    const progressWidget = createScanProgressWidget(contentEl, this.plugin);
    this.activeProgress = progressWidget;
    const btnRow = contentEl.createDiv({ cls: "fm-btn-row" });
    const cancelBtn = btnRow.createEl("button", { text: t2("btnCancel") });
    cancelBtn.onclick = () => {
      if (this.transferController) {
        this.transferController.abort();
        cancelBtn.disabled = true;
        cancelBtn.setText(t2("transferStopping"));
      } else returnToHub(this);
    };
    const nextBtn = btnRow.createEl("button", { text: t2("migrateNextPreview"), cls: "mod-cta" });
    nextBtn.onclick = async () => {
      if (!this.options.typeImage && !this.options.typeAudio && !this.options.typeOther) {
        new import_obsidian12.Notice(t2("migrateSelectTypeNotice"));
        return;
      }
      nextBtn.disabled = true;
      nextBtn.setText(t2("migrateScanning"));
      progressWidget.show();
      try {
        this.items = await scanLocalAttachmentsForBatchMigrate(this.plugin, this.options, {
          signal: progressWidget.signal,
          onProgress: (cur, total, label) => progressWidget.update(cur, total, label)
        });
        this.step = 2;
        this.render();
      } catch (err) {
        progressWidget.hide();
        new import_obsidian12.Notice(err.message === "SCAN_ABORTED" ? this.plugin.t("scanCancelled") : "\u274C Scan failed: " + err.message);
        nextBtn.disabled = false;
        nextBtn.setText(t2("migrateNextPreview"));
      }
    };
  }
  createCheck(parent, labelText, key) {
    const label = parent.createEl("label", { cls: "fm-check-row" });
    const cb = label.createEl("input", { type: "checkbox" });
    cb.checked = Boolean(this.options[key]);
    cb.onchange = () => {
      this.options[key] = cb.checked;
    };
    label.createSpan({ text: labelText });
  }
  renderStep2(contentEl) {
    const t2 = (k, p) => this.plugin.t(k, p);
    moduleHeading(this, contentEl, { title: "actMigrateTitle", symbol: "cloud-upload", step: this.items.length ? 2 : null, total: 2 });
    contentEl.createEl("p", { text: t2("migrateStep2Title", { count: this.items.length }), cls: "fm-module-summary" });
    const toolbar = contentEl.createDiv({ cls: "fm-toolbar-row" });
    const leftTools = toolbar.createDiv({ attr: { style: "display:flex; gap:8px; align-items:center;" } });
    const backBtn = leftTools.createEl("button", { text: t2("btnBack") });
    backBtn.onclick = () => {
      this.step = 1;
      this.render();
    };
    const selectAllBtn = leftTools.createEl("button", { text: t2("btnSelectAll") });
    selectAllBtn.onclick = () => {
      const allSelected = this.items.every((i) => i.selected);
      this.items.forEach((i) => {
        i.selected = !allSelected;
      });
      this.render();
    };
    const onlyRefBtn = leftTools.createEl("button", { text: t2("migrateSelectOnlyRef") });
    onlyRefBtn.onclick = () => {
      this.items.forEach((i) => {
        i.selected = i.refNotes.length > 0;
      });
      this.render();
    };
    if (this.items.length === 0) {
      contentEl.createDiv({
        cls: "fm-section-box",
        text: t2("migrateNoneFound"),
        attr: { style: "text-align: center; padding: 36px 20px;" }
      });
      const emptyBtnRow = contentEl.createDiv({ cls: "fm-btn-row" });
      const cancelBtn2 = emptyBtnRow.createEl("button", { text: t2("btnCancel") });
      cancelBtn2.onclick = () => {
        if (this.transferController) {
          this.transferController.abort();
          cancelBtn2.disabled = true;
          cancelBtn2.setText(t2("transferStopping"));
        } else returnToHub(this);
      };
      return;
    }
    const listEl = contentEl.createDiv({ cls: "fm-scroll-list" });
    for (const item of this.items) {
      const row = listEl.createDiv({ cls: "fm-list-item" });
      const left = row.createDiv({
        attr: { style: "display:flex; align-items:center; gap:10px; flex:1; overflow:hidden;" }
      });
      const cb = left.createEl("input", { type: "checkbox", attr: { style: "cursor:pointer;" } });
      cb.checked = item.selected;
      cb.onchange = () => {
        item.selected = cb.checked;
      };
      renderItemVisualThumb(left, item, this.plugin);
      left.createSpan({
        text: item.displayPath,
        attr: { style: "overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:500;" }
      });
      const rightBox = row.createDiv({
        attr: { style: "display:flex; align-items:center; gap:8px; flex-shrink:0;" }
      });
      rightBox.createSpan({
        text: formatBytes(item.size),
        attr: { style: "color: var(--text-muted); font-size: 12px;" }
      });
      const refBadge = rightBox.createSpan({
        text: t2("migrateNoteRefs", { count: item.refNotes.length }),
        cls: "fm-tag fm-tag-ref fm-clickable-badge",
        attr: { "aria-label": t2("migrateInspectRefs") }
      });
      refBadge.onclick = (e) => {
        e.stopPropagation();
        new NoteRefsModal(this.app, item.name, item.refNotes, () => this.close(), this.plugin).open();
      };
    }
    const progressBox = contentEl.createDiv({ attr: { style: "display:none; margin-bottom:12px;" } });
    const progressHeader = progressBox.createDiv({ attr: { style: "display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;" } });
    const progressText = progressHeader.createDiv({ attr: { style: "font-size:12px; color:var(--text-accent); font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:65%;" } });
    const progressSpeed = progressHeader.createDiv({ attr: { style: "font-size:11.5px; font-family:var(--font-monospace); color:var(--text-muted); font-weight:600; white-space:nowrap;" } });
    const progressWrap = progressBox.createDiv({ cls: "fm-progress-wrap" });
    const progressBar = progressWrap.createDiv({ cls: "fm-progress-bar" });
    const btnRow = contentEl.createDiv({ cls: "fm-btn-row" });
    const cancelBtn = btnRow.createEl("button", { text: t2("btnCancel") });
    cancelBtn.onclick = () => {
      if (this.transferController) {
        this.transferController.abort();
        cancelBtn.disabled = true;
        cancelBtn.setText(t2("transferStopping"));
      } else returnToHub(this);
    };
    const runBtn = btnRow.createEl("button", {
      text: t2("migrateStart", { count: this.items.filter((i) => i.selected).length }),
      cls: "mod-cta"
    });
    runBtn.onclick = async () => {
      const selected = this.items.filter((i) => i.selected);
      if (selected.length === 0) {
        new import_obsidian12.Notice(t2("migrateSelectNotice"));
        return;
      }
      runBtn.disabled = true;
      backBtn.disabled = true;
      progressBox.style.display = "block";
      this.transferController = new AbortController();
      try {
        await this.plugin.executeBatchMigrateSafely(
          selected,
          { ...this.options, signal: this.transferController.signal },
          (cur, total, name, stats) => {
            const pct = Math.round(cur / Math.max(1, total) * 100);
            progressBar.style.width = `${pct}%`;
            progressText.setText(t2("migrateProgress", { current: cur, total, name }));
            if (stats == null ? void 0 : stats.speedText) {
              const eta = stats.etaText ? ` \xB7 \u5269\u4F59\u7EA6 ${stats.etaText}` : "";
              progressSpeed.setText(`\u26A1 ${stats.speedText}${eta}`);
            }
          },
          (summary) => {
            this.step = 3;
            this.summary = summary;
            if (!this.transferClosed) this.render();
          }
        );
      } catch (err) {
        new import_obsidian12.Notice(err.message);
        runBtn.disabled = false;
        backBtn.disabled = false;
      } finally {
        this.transferController = null;
      }
    };
  }
  renderStep3(contentEl) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j;
    const t2 = (k, p) => this.plugin.t(k, p);
    const count = ((_a = this.summary) == null ? void 0 : _a.count) || 0;
    const failures = ((_b = this.summary) == null ? void 0 : _b.failures) || [];
    const processedItems = ((_c = this.summary) == null ? void 0 : _c.processedItems) || [];
    const isPartial = failures.length > 0 && count > 0;
    const isError = count === 0 && failures.length > 0;
    const titleKey = ((_d = this.summary) == null ? void 0 : _d.cancelled) ? "transferCancelled" : isError ? "batchResultErrorTitle" : isPartial ? "batchResultWarningTitle" : "batchResultTitle";
    moduleHeading(this, contentEl, { title: "actMigrateTitle", symbol: "cloud-upload" });
    const bannerCls = isError ? "fm-result-banner fm-result-banner-error" : isPartial ? "fm-result-banner fm-result-banner-warning" : "fm-result-banner fm-result-banner-success";
    const banner = contentEl.createDiv({ cls: bannerCls });
    banner.createDiv({ cls: "fm-result-banner-title", text: t2(titleKey) });
    const trashedText = ((_e = this.summary) == null ? void 0 : _e.trashed) ? t2("noticeBatchMigrateTrashedPart", { trashed: this.summary.trashed }) : "";
    const failText = failures.length > 0 ? t2("batchResultFailuresPart", { count: failures.length }) : "";
    const trashFailures = ((_f = this.summary) == null ? void 0 : _f.trashFailures) || [];
    const trashFailText = trashFailures.length > 0 ? t2("batchResultTrashFailuresPart", { count: trashFailures.length }) : "";
    banner.createDiv({
      cls: "fm-result-banner-desc",
      text: t2("batchResultDesc", {
        count,
        docs: ((_g = this.summary) == null ? void 0 : _g.docs) || 0,
        trashed: trashedText
      }) + failText + trashFailText
    });
    if (processedItems.length > 0) {
      const listBox = contentEl.createDiv({
        cls: "fm-section-box",
        attr: { style: "margin-top: 10px;" }
      });
      listBox.createDiv({
        text: t2("batchResultListTitle", { count: processedItems.length }),
        cls: "fm-section-title"
      });
      const listEl = listBox.createDiv({
        cls: "fm-scroll-list",
        attr: { style: "max-height: 220px; margin-bottom: 0;" }
      });
      for (const pItem of processedItems) {
        const row = listEl.createDiv({ cls: "fm-list-item" });
        const left = row.createDiv({
          attr: { style: "display:flex; align-items:center; gap:10px; flex:1; overflow:hidden;" }
        });
        renderItemVisualThumb(left, pItem, this.plugin);
        const nameCol = left.createDiv({
          attr: { style: "display:flex; flex-direction:column; overflow:hidden; flex:1;" }
        });
        nameCol.createSpan({
          text: pItem.name,
          attr: { style: "overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:500;" }
        });
        nameCol.createSpan({
          text: `${pItem.displayPath} \xB7 ${formatBytes(pItem.size || 0)}`,
          attr: { style: "font-size:11px; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" }
        });
        const rightBox = row.createDiv({
          attr: { style: "display:flex; align-items:center; gap:6px; flex-shrink:0;" }
        });
        if (pItem.rawUrl) {
          const copyBtn = rightBox.createEl("button", {
            cls: "clickable-icon",
            attr: { "aria-label": t2("copyRawUrl") || "Copy URL" }
          });
          (0, import_obsidian12.setIcon)(copyBtn, "copy");
          copyBtn.onclick = async (e) => {
            e.stopPropagation();
            await navigator.clipboard.writeText(pItem.rawUrl);
            new import_obsidian12.Notice(t2("noticeCopied"));
          };
        }
      }
    }
    if (failures.length > 0) {
      const failBox = contentEl.createDiv({
        cls: "fm-section-box",
        attr: { style: "margin-top: 10px; border-color: rgba(239, 68, 68, 0.4);" }
      });
      failBox.createDiv({
        text: t2("batchFailuresTitle", { count: failures.length }),
        cls: "fm-section-title",
        attr: { style: "color: var(--text-error);" }
      });
      for (const f of failures) {
        failBox.createDiv({
          cls: "fm-result-banner-desc",
          text: `\u2022 ${f.path || f.name} (${formatBytes(f.size || 0)}): ${f.error}`,
          attr: { style: "font-size: 12px; color: var(--text-muted); margin-top: 2px;" }
        });
      }
    }
    const btnRow = contentEl.createDiv({ cls: "fm-btn-row" });
    let createdReportPath = null;
    const exportBtn = btnRow.createEl("button", { text: t2("batchExportReport") });
    exportBtn.onclick = async () => {
      exportBtn.disabled = true;
      try {
        createdReportPath = await exportBatchMigrateReportToRoot(this.plugin, this.summary);
        exportBtn.setText(t2("batchReportExported"));
        if (!btnRow.querySelector(".fm-open-report-btn")) {
          const openBtn = btnRow.createEl("button", {
            text: t2("batchOpenReport"),
            cls: "fm-open-report-btn"
          });
          openBtn.onclick = () => {
            if (createdReportPath) {
              this.app.workspace.openLinkText(createdReportPath, "", true);
            }
            this.close();
          };
        }
      } catch (err) {
        new import_obsidian12.Notice("\u274C " + err.message);
        exportBtn.disabled = false;
      }
    };
    if ((_h = this.summary) == null ? void 0 : _h.cancelled) btnRow.createSpan({ text: t2("transferCancelled") });
    if ((_j = (_i = this.summary) == null ? void 0 : _i.retryItems) == null ? void 0 : _j.length) {
      const retry = btnRow.createEl("button", { text: t2("transferRetry") });
      retry.onclick = () => {
        this.items = this.summary.retryItems.map((item) => ({ ...item, selected: true, refNotes: item.refNotes || [] }));
        this.step = 2;
        this.render();
      };
    }
    const doneBtn = btnRow.createEl("button", { text: t2("destBtnDone"), cls: "mod-cta" });
    doneBtn.onclick = () => returnToHub(this);
  }
  onClose() {
    var _a;
    this.transferClosed = true;
    (_a = this.transferController) == null ? void 0 : _a.abort();
    if (this.activeProgress) this.activeProgress.abort();
    this.contentEl.empty();
  }
};

// src/plugin/context-menus.js
var import_obsidian13 = require("obsidian");
function registerContextMenus(plugin) {
  plugin.registerEvent(
    plugin.app.workspace.on("file-menu", (menu, abstractFile) => {
      if (!abstractFile) return;
      if (Array.isArray(abstractFile.children)) {
        const folderPath = abstractFile.path;
        if (!folderPath || folderPath === "/") return;
        if (plugin.isRemoteServerReady()) {
          menu.addItem((item) => {
            item.setTitle(plugin.t("menuMigrateFolder")).setIcon("upload-cloud").onClick(() => {
              new BatchMigrateWizardModal(plugin.app, plugin, folderPath).open();
            });
          });
        }
        const isExcluded = isLocalPathExcluded(plugin.settings, folderPath);
        menu.addItem((item) => {
          item.setTitle(isExcluded ? plugin.t("menuRemoveExclusion") : plugin.t("menuAddExclusion")).setIcon("shield").onClick(() => {
            toggleLocalFolderExclusion(plugin, folderPath);
          });
        });
        return;
      }
      if (abstractFile.extension && isAttachmentExt(abstractFile.extension)) {
        if (plugin.isRemoteServerReady()) {
          menu.addItem((item) => {
            item.setTitle(plugin.t("menuUploadCloud")).setIcon("upload-cloud").onClick(async () => {
              await migrateSingleLocalFileToRemote(plugin, abstractFile, {
                deleteLocal: plugin.settings.deleteLocalAfterMigrate
              });
            });
          });
        }
        return;
      }
      const isNoteOrExcalidraw = abstractFile.extension === "md" || abstractFile.extension === "excalidraw" || isExcalidrawFile2(plugin.app, abstractFile);
      if (isNoteOrExcalidraw && plugin.isRemoteServerReady()) {
        menu.addItem((item) => {
          item.setTitle(plugin.t("menuActiveNoteMigrate")).setIcon("upload-cloud").onClick(() => {
            return migrateActiveNoteAttachments(plugin, abstractFile);
          });
        });
        menu.addItem((item) => {
          item.setTitle(plugin.t("menuActiveNoteDownload")).setIcon("download-cloud").onClick(() => {
            return downloadActiveNoteRemoteAttachments(plugin, abstractFile);
          });
        });
        menu.addItem((item) => {
          item.setTitle(plugin.t("menuActiveNoteAstro")).setIcon("external-link").onClick(() => {
            return copyActiveNoteForAstro(plugin, abstractFile);
          });
        });
      }
    })
  );
  plugin.registerEvent(
    plugin.app.workspace.on("editor-menu", (menu, editor) => {
      if (!plugin.isRemoteServerReady()) return;
      const cursor = editor.getCursor();
      const lineText = editor.getLine(cursor.line) || "";
      if (!lineText.trim()) return;
      const remoteMatch = extractRemoteItemFromLine(plugin, lineText);
      if (remoteMatch) {
        menu.addItem((item) => {
          item.setTitle(plugin.t("menuCopyRaw", { name: remoteMatch.filename })).setIcon("copy").onClick(async () => {
            await navigator.clipboard.writeText(remoteMatch.matchedUrl);
            new import_obsidian13.Notice(plugin.t("noticeCopiedRaw", { name: remoteMatch.filename }));
          });
        });
        menu.addItem((item) => {
          item.setTitle(plugin.t("menuCopyWebp")).setIcon("zap").onClick(async () => {
            const base = getBaseName(remoteMatch.filename);
            const optUrl = `${plugin.getCleanServerUrl()}/pub/${remoteMatch.year}/${remoteMatch.month}/${encodeURIComponent(base)}.webp`;
            await navigator.clipboard.writeText(optUrl);
            new import_obsidian13.Notice(plugin.t("noticeCopiedWebp", { name: base + ".webp" }));
          });
        });
        menu.addItem((item) => {
          item.setTitle(plugin.t("menuDownloadToVault", { name: remoteMatch.filename })).setIcon("download").onClick(async () => {
            await plugin.downloadSingleRemoteItemToLocal(remoteMatch);
          });
        });
        menu.addItem((item) => {
          item.setTitle(plugin.t("menuLockRemote", { name: remoteMatch.filename })).setIcon("lock").onClick(async () => {
            try {
              await plugin.toggleRemoteFileLock(
                remoteMatch.year,
                remoteMatch.month,
                remoteMatch.filename,
                true
              );
              new import_obsidian13.Notice(plugin.t("noticeProtectedRemote", { name: remoteMatch.filename }));
            } catch (err) {
              new import_obsidian13.Notice(plugin.t("noticeLockFailed", { err: err.message }));
            }
          });
        });
      }
      const localTFile = extractLocalAttachmentFromLine(plugin, lineText);
      if (localTFile) {
        menu.addItem((item) => {
          item.setTitle(`${plugin.t("menuUploadCloud")} (${localTFile.name})`).setIcon("upload-cloud").onClick(async () => {
            await migrateSingleLocalFileToRemote(plugin, localTFile, {
              toProtected: false,
              deleteLocal: plugin.settings.deleteLocalAfterMigrate
            });
          });
        });
      }
    })
  );
}
function extractRemoteItemFromLine(plugin, lineText) {
  const serverBase = escapeRegExp(plugin.getCleanServerUrl());
  const re = new RegExp(
    `(${serverBase}\\/([^/\\s)]+)\\/(\\d{4})\\/(\\d{2})\\/([^)\\s]+))`,
    "i"
  );
  const m = re.exec(lineText);
  if (!m) return null;
  let filename = m[5];
  try {
    filename = decodeURIComponent(filename);
  } catch (e) {
  }
  return {
    matchedUrl: m[1],
    routePrefix: m[2],
    year: m[3],
    month: m[4],
    filename
  };
}
function extractLocalAttachmentFromLine(plugin, lineText) {
  const activeFile = plugin.app.workspace.getActiveFile();
  const sourcePath = activeFile ? activeFile.path : "";
  const wikiMatch = /!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/.exec(lineText);
  if (wikiMatch) {
    const tf = plugin.app.metadataCache.getFirstLinkpathDest(wikiMatch[1].trim(), sourcePath);
    if (tf && isAttachmentExt(tf.extension)) return tf;
  }
  const mdMatch = /!?\[[^\]]*\]\((?!https?:\/\/)([^)]+)\)/.exec(lineText);
  if (mdMatch) {
    let linkPath = mdMatch[1].trim();
    try {
      linkPath = decodeURIComponent(linkPath);
    } catch (e) {
    }
    const tf = plugin.app.metadataCache.getFirstLinkpathDest(linkPath, sourcePath);
    if (tf && isAttachmentExt(tf.extension)) return tf;
  }
  return null;
}
function setupHeicInlinePreviewObserver(plugin) {
  const scanEmbeds = () => {
    const embeds = document.querySelectorAll(".internal-embed[src]");
    embeds.forEach((el) => {
      const rawSrc = el.getAttribute("src") || "";
      const cleanSrc = rawSrc.split("#")[0].split("|")[0].trim();
      const ext = getExt(cleanSrc);
      if (!NEEDS_TRANSCODE_IMAGE_EXTS.has(ext)) return;
      if (el.dataset.fmHeicStatus === "done" || el.dataset.fmHeicStatus === "loading") return;
      el.dataset.fmHeicStatus = "loading";
      renderSingleHeicEmbed(plugin, el, cleanSrc, ext).catch(() => {
        el.dataset.fmHeicStatus = "error";
      });
    });
  };
  plugin.app.workspace.onLayoutReady(() => {
    scanEmbeds();
    plugin.heicObserver = new MutationObserver(() => scanEmbeds());
    plugin.heicObserver.observe(document.body, { childList: true, subtree: true });
  });
  plugin.registerEvent(plugin.app.workspace.on("layout-change", () => scanEmbeds()));
  plugin.registerEvent(plugin.app.workspace.on("file-open", () => setTimeout(scanEmbeds, 80)));
}
async function renderSingleHeicEmbed(plugin, embedEl, linkPath, ext) {
  var _a;
  const activeFile = plugin.app.workspace.getActiveFile();
  const sourcePath = activeFile ? activeFile.path : "";
  let tfile = plugin.app.metadataCache.getFirstLinkpathDest(linkPath, sourcePath);
  if (!tfile) {
    tfile = plugin.app.vault.getFiles().find((f) => f.path === linkPath || f.name === linkPath);
  }
  if (!tfile) {
    embedEl.dataset.fmHeicStatus = "missing";
    return;
  }
  const cacheKey = `${tfile.path}:${((_a = tfile.stat) == null ? void 0 : _a.mtime) || 0}`;
  let previewUrl = plugin.heicPreviewCache.get(cacheKey);
  if (!previewUrl) {
    const buf = await plugin.app.vault.readBinary(tfile);
    previewUrl = await convertBufferToPreviewUrl(buf, ext, plugin);
    plugin.heicPreviewCache.set(cacheKey, previewUrl);
  }
  embedEl.empty();
  embedEl.removeClass("file-embed", "mod-generic");
  embedEl.addClass("image-embed", "is-loaded");
  const img = embedEl.createEl("img", {
    attr: {
      src: previewUrl,
      alt: tfile.name
    }
  });
  img.style.maxWidth = "100%";
  img.style.borderRadius = "6px";
  img.style.display = "block";
  embedEl.dataset.fmHeicStatus = "done";
}

// src/modals/duplicate-wizard.js
var import_obsidian14 = require("obsidian");
var DuplicateWizardModal = class extends FileMasterModal {
  constructor(app, plugin) {
    var _a;
    super(app);
    this.plugin = plugin;
    this.step = 1;
    this.activeProgress = null;
    const isRemote = Boolean((_a = plugin == null ? void 0 : plugin.isRemoteServerReady) == null ? void 0 : _a.call(plugin));
    this.scope = isRemote ? "both" : "local";
    this.fileTypes = {
      typeImage: true,
      typeAudio: true,
      typeOther: true,
      typeNote: false
    };
    this.processMode = "auto";
    this.groups = [];
    this.scanStats = { localScanned: 0, remoteScanned: 0, remoteError: null };
  }
  onOpen() {
    this.render();
  }
  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("fm-wizard-modal");
    if (this.step === 1) {
      this.renderStep1(contentEl);
    } else if (this.step === 2) {
      this.renderStep2(contentEl);
    } else if (this.step === 3) {
      this.renderStep3(contentEl);
    }
  }
  renderStep1(contentEl) {
    var _a, _b;
    const t2 = (k, p) => this.plugin.t(k, p);
    moduleHeading(this, contentEl, { title: "actDupTitle", symbol: "files", step: 1, total: 2 });
    contentEl.createEl("p", { text: t2("dupStep1Desc"), cls: "fm-module-summary" });
    const isRemote = Boolean((_b = (_a = this.plugin) == null ? void 0 : _a.isRemoteServerReady) == null ? void 0 : _b.call(_a));
    if (isRemote) {
      const scopeBox = contentEl.createDiv({ cls: "fm-section-box" });
      scopeBox.createDiv({ text: t2("dupLocScope"), cls: "fm-section-title" });
      const scopes = [
        { key: "both", label: t2("dupCompareCross") },
        { key: "local", label: t2("dupCompareLocal") },
        { key: "remote", label: t2("dupCompareRemote") }
      ];
      for (const s of scopes) {
        const row = scopeBox.createEl("label", { cls: "fm-check-row" });
        const radio = row.createEl("input", { type: "radio", attr: { name: "fm_dup_scope" } });
        radio.checked = this.scope === s.key;
        radio.onchange = () => {
          this.scope = s.key;
        };
        row.createSpan({ text: s.label });
      }
    }
    const typeBox = contentEl.createDiv({ cls: "fm-section-box" });
    typeBox.createDiv({ text: t2("dupTypeScope"), cls: "fm-section-title" });
    this.createTypeCheckbox(typeBox, t2("dupTypeImage"), "typeImage");
    this.createTypeCheckbox(typeBox, t2("dupTypeAudio"), "typeAudio");
    this.createTypeCheckbox(typeBox, t2("dupTypeOther"), "typeOther");
    this.createTypeCheckbox(typeBox, t2("dupTypeNote"), "typeNote");
    renderExcludedFoldersHint(contentEl, this.plugin);
    const progressWidget = createScanProgressWidget(contentEl, this.plugin);
    this.activeProgress = progressWidget;
    const btnRow = contentEl.createDiv({ cls: "fm-btn-row" });
    const cancelBtn = btnRow.createEl("button", { text: t2("btnCancel") });
    cancelBtn.onclick = () => returnToHub(this);
    const nextBtn = btnRow.createEl("button", { text: t2("btnNext"), cls: "mod-cta" });
    nextBtn.onclick = async () => {
      if (!this.fileTypes.typeImage && !this.fileTypes.typeAudio && !this.fileTypes.typeOther && !this.fileTypes.typeNote) {
        new import_obsidian14.Notice(this.plugin.t("dupSelectTypeRequired"));
        return;
      }
      nextBtn.disabled = true;
      nextBtn.setText(t2("dupComparing"));
      progressWidget.show();
      try {
        const res = await scanDuplicateGroups(this.plugin, this.scope, this.fileTypes, {
          signal: progressWidget.signal,
          onProgress: (cur, total, label) => progressWidget.update(cur, total, label)
        });
        this.groups = res.groups;
        this.scanStats = res.stats;
        this.applyProcessMode("auto");
        this.step = 2;
        this.render();
      } catch (err) {
        progressWidget.hide();
        new import_obsidian14.Notice(err.message === "SCAN_ABORTED" ? this.plugin.t("scanCancelled") : "\u274C Comparison failed: " + err.message);
        nextBtn.disabled = false;
        nextBtn.setText(t2("btnNext"));
      }
    };
  }
  createTypeCheckbox(parent, labelText, key) {
    const label = parent.createEl("label", { cls: "fm-check-row" });
    const cb = label.createEl("input", { type: "checkbox" });
    cb.checked = Boolean(this.fileTypes[key]);
    cb.onchange = () => {
      this.fileTypes[key] = cb.checked;
    };
    label.createSpan({ text: labelText });
  }
  applyProcessMode(mode) {
    this.processMode = mode;
    for (const grp of this.groups) {
      const lockedItem = grp.items.find((i) => i.locked);
      if (lockedItem) {
        grp.keepId = lockedItem.id;
        continue;
      }
      if (mode === "prefer-remote") {
        const remoteItem = grp.items.find((i) => i.source === "remote");
        grp.keepId = remoteItem ? remoteItem.id : grp.items[0].id;
      } else if (mode === "prefer-local") {
        const localItem = grp.items.find((i) => i.source === "local");
        grp.keepId = localItem ? localItem.id : grp.items[0].id;
      } else {
        const sorted = [...grp.items].sort((a, b) => {
          if (b.refNotes.length !== a.refNotes.length) return b.refNotes.length - a.refNotes.length;
          if (a.source !== b.source) return a.source === "remote" ? -1 : 1;
          return 0;
        });
        grp.keepId = sorted[0].id;
      }
    }
  }
  renderStep2(contentEl) {
    var _a;
    const t2 = (k, p) => this.plugin.t(k, p);
    const totalDupes = this.groups.reduce((acc, g) => acc + Math.max(0, g.items.length - 1), 0);
    moduleHeading(this, contentEl, { title: "actDupTitle", symbol: "files", step: 2, total: 2 });
    contentEl.createEl("p", { text: this.groups.length ? t2("dupStep2Title", { groups: this.groups.length, redundant: totalDupes }) : t2("dupEmptyTitle"), cls: "fm-module-summary" });
    if (!this.groups.length) {
      contentEl.createDiv({ cls: "fm-empty-state", text: t2("dupNoneFound") });
      const actions = contentEl.createDiv({ cls: "fm-btn-row" });
      const choose = actions.createEl("button", { text: t2("dupChooseScopeAgain") });
      choose.onclick = () => {
        this.step = 1;
        this.render();
      };
      return;
    }
    const toolbar = contentEl.createDiv({ cls: "fm-toolbar-row" });
    const leftTools = toolbar.createDiv({ attr: { style: "display:flex; gap:8px; align-items:center; flex-wrap:wrap;" } });
    const backBtn = leftTools.createEl("button", { text: t2("btnBack") });
    backBtn.onclick = () => {
      this.step = 1;
      this.render();
    };
    leftTools.createSpan({ text: t2("dupStrategyLabel"), attr: { style: "font-size:13px; font-weight:600; margin-left:4px;" } });
    const modeSelect = leftTools.createEl("select", { cls: "fm-strategy-select" });
    const modeOptions = [
      { value: "auto", label: t2("dupStrategyAuto") },
      { value: "prefer-remote", label: t2("dupStrategyPreferRemote") },
      { value: "prefer-local", label: t2("dupStrategyPreferLocal") }
    ];
    for (const opt of modeOptions) {
      const o = modeSelect.createEl("option", { value: opt.value, text: opt.label });
      if (opt.value === this.processMode) o.selected = true;
    }
    modeSelect.onchange = () => {
      this.applyProcessMode(modeSelect.value);
      this.render();
    };
    const exportBtn = toolbar.createEl("button", {
      text: t2("btnExportReport")
    });
    exportBtn.onclick = async () => {
      await exportDuplicateReportToRoot(this.plugin, this.groups);
    };
    if ((_a = this.scanStats) == null ? void 0 : _a.remoteError) {
      contentEl.createDiv({
        cls: "fm-section-box",
        text: t2("noticeRemoteUnreachable", { err: this.scanStats.remoteError }),
        attr: { style: "font-size: 12px; color: #f59e0b; border-color: rgba(245, 158, 11, 0.4); padding: 10px 14px;" }
      });
    }
    const listEl = contentEl.createDiv({ cls: "fm-scroll-list" });
    this.groups.forEach((grp, idx) => {
      const grpBox = listEl.createDiv({ cls: "fm-dup-group" });
      const grpHead = grpBox.createDiv({ cls: "fm-dup-group-header" });
      grpHead.createSpan({
        text: t2("dupGroupHeader", { idx: idx + 1, hash: grp.sha256.slice(0, 12), size: formatBytes(grp.size) })
      });
      grpHead.createSpan({ text: t2("dupGroupSubhint") });
      for (const item of grp.items) {
        const isKeep = grp.keepId === item.id;
        const row = grpBox.createDiv({ cls: "fm-list-item" });
        const left = row.createDiv({
          attr: { style: "display:flex; align-items:center; gap:8px; flex:1; overflow:hidden;" }
        });
        const radio = left.createEl("input", {
          type: "radio",
          attr: { name: `dup_grp_${idx}`, style: "cursor:pointer;" }
        });
        radio.checked = isKeep;
        radio.onchange = () => {
          grp.keepId = item.id;
          this.render();
        };
        renderItemVisualThumb(left, item, this.plugin);
        left.createSpan({
          text: isKeep ? t2("dupTagKeep") : item.locked ? t2("dupTagProtected") : t2("dupTagRemove"),
          attr: { style: `font-size:12px; font-weight:700; color:${isKeep ? "#10b981" : item.locked ? "#f59e0b" : "#ef4444"}; width:68px; flex-shrink:0;` }
        });
        left.createSpan({
          text: item.source === "local" ? t2("analyticsBadgeLocal") : t2("analyticsBadgeRemote"),
          cls: `fm-tag ${item.source === "local" ? "fm-tag-local" : "fm-tag-remote"}`
        });
        if (item.locked) {
          left.createSpan({
            text: "\u{1F512} " + (this.t ? this.t("tagLocked") : "Locked"),
            cls: "fm-tag fm-tag-lock"
          });
        }
        left.createSpan({
          text: item.displayPath,
          attr: { "aria-label": t2("dupDesignateKeepTitle"), style: "word-break:break-all; cursor:pointer;" }
        }).onclick = () => {
          grp.keepId = item.id;
          this.render();
        };
        const rightBox = row.createDiv({
          attr: { style: "display:flex; align-items:center; gap:6px; flex-shrink:0;" }
        });
        const refBadge = rightBox.createSpan({
          text: t2("migrateNoteRefs", { count: item.refNotes.length }),
          cls: "fm-tag fm-tag-ref fm-clickable-badge",
          attr: { "aria-label": t2("migrateInspectRefs") }
        });
        refBadge.onclick = (e) => {
          e.stopPropagation();
          new NoteRefsModal(this.app, item.name, item.refNotes, () => this.close(), this.plugin).open();
        };
      }
    });
    const btnRow = contentEl.createDiv({ cls: "fm-btn-row" });
    const cancelBtn = btnRow.createEl("button", { text: t2("btnCancel") });
    cancelBtn.onclick = () => returnToHub(this);
    const execBtn = btnRow.createEl("button", {
      text: t2("dupMergeRewrite", { count: totalDupes }),
      cls: "mod-cta"
    });
    execBtn.onclick = async () => {
      await executeDuplicateMergeSafely(this.plugin, this.groups, (summary) => {
        this.step = 3;
        this.summary = summary;
        this.render();
      });
    };
  }
  renderStep3(contentEl) {
    var _a, _b, _c, _d;
    const t2 = (k, p) => this.plugin.t(k, p);
    moduleHeading(this, contentEl, { title: "actDupTitle", symbol: "files" });
    const banner = contentEl.createDiv({ cls: "fm-result-banner fm-result-banner-success" });
    banner.createDiv({ cls: "fm-result-banner-title", text: t2("dupResultTitle") });
    banner.createDiv({
      cls: "fm-result-banner-desc",
      text: t2("dupResultDesc", {
        modified: ((_a = this.summary) == null ? void 0 : _a.modified) || 0,
        local: ((_b = this.summary) == null ? void 0 : _b.local) || 0,
        remote: ((_c = this.summary) == null ? void 0 : _c.remote) || 0,
        skipped: ((_d = this.summary) == null ? void 0 : _d.skipped) > 0 ? t2("dupResultSkipped", { count: this.summary.skipped }) : ""
      })
    });
    const btnRow = contentEl.createDiv({ cls: "fm-btn-row" });
    const doneBtn = btnRow.createEl("button", { text: t2("destBtnDone"), cls: "mod-cta" });
    doneBtn.onclick = () => returnToHub(this);
  }
  onClose() {
    if (this.activeProgress) this.activeProgress.abort();
    this.contentEl.empty();
  }
};

// src/plugin/health-analytics.js
var import_obsidian15 = require("obsidian");
async function scanVaultLinkHealth(plugin, options = {}, scanCtx = {}) {
  const { signal, onProgress } = scanCtx || {};
  const allFiles = plugin.app.vault.getFiles();
  const docFiles = allFiles.filter(
    (f) => isScannableDocFile(plugin, f) && !isLocalPathExcluded(plugin.settings, f.path)
  );
  const vaultFilePaths = new Set(allFiles.map((f) => f.path));
  const vaultFileNames = new Set(allFiles.map((f) => f.name));
  const vaultFileBasenames = new Set(allFiles.map((f) => f.basename));
  const vaultIndex = {
    paths: vaultFilePaths,
    names: vaultFileNames,
    basenames: vaultFileBasenames
  };
  const issues = [];
  const remoteToCheck = [];
  for (let i = 0; i < docFiles.length; i++) {
    if (signal == null ? void 0 : signal.aborted) throw new Error("SCAN_ABORTED");
    const doc = docFiles[i];
    if (onProgress && i % 15 === 0) {
      onProgress(i + 1, docFiles.length, doc.path);
      await new Promise((r) => setTimeout(r, 0));
    }
    const rawText = await plugin.app.vault.cachedRead(doc);
    if (doc.extension === "canvas") {
      try {
        const data = JSON.parse(rawText);
        if (Array.isArray(data.nodes)) {
          for (const node of data.nodes) {
            if (node.type === "file" && node.file && options.checkLocalMarkdown !== false) {
              if (!vaultFilePaths.has(node.file) && !vaultFileNames.has(node.file.split("/").pop())) {
                issues.push({
                  type: "canvas-node",
                  category: "local",
                  sourcePath: doc.path,
                  target: node.file,
                  rawText: `{"type": "file", "file": "${node.file}"}`,
                  line: 1,
                  lineText: `Canvas File Card: ${node.file}`,
                  reason: "Referenced canvas attachment does not exist in vault"
                });
              }
            } else if (node.type === "text" && node.text) {
              const subIssues = scanNoteContentForBrokenLinks(doc.path, node.text, vaultIndex, {
                checkWikiLinks: options.checkWikiLinks !== false,
                checkLocalMarkdown: options.checkLocalMarkdown !== false,
                checkRemote: options.checkRemote
              });
              for (const iss of subIssues) {
                if (iss.category === "remote") {
                  remoteToCheck.push(iss);
                } else {
                  issues.push(iss);
                }
              }
            }
          }
        }
      } catch (e) {
      }
    } else {
      const docIssues = scanNoteContentForBrokenLinks(doc.path, rawText, vaultIndex, {
        checkWikiLinks: options.checkWikiLinks !== false,
        checkLocalMarkdown: options.checkLocalMarkdown !== false,
        checkRemote: options.checkRemote
      });
      for (const iss of docIssues) {
        if (iss.category === "remote") {
          remoteToCheck.push(iss);
        } else {
          issues.push(iss);
        }
      }
    }
  }
  if (options.checkRemote && remoteToCheck.length > 0) {
    const uniqueUrls = Array.from(new Set(remoteToCheck.map((r) => r.target)));
    const failedUrlMap = /* @__PURE__ */ new Map();
    for (let i = 0; i < uniqueUrls.length; i += 5) {
      if (signal == null ? void 0 : signal.aborted) throw new Error("SCAN_ABORTED");
      const batch = uniqueUrls.slice(i, i + 5);
      if (onProgress) {
        onProgress(i + 1, uniqueUrls.length, batch[0]);
      }
      await Promise.all(
        batch.map(async (url) => {
          try {
            const res = await (0, import_obsidian15.requestUrl)({ url, method: "HEAD", throw: false });
            if (res.status >= 400) {
              failedUrlMap.set(url, `HTTP ${res.status}`);
            }
          } catch (err) {
            failedUrlMap.set(url, err.message || "Network error");
          }
        })
      );
    }
    for (const item of remoteToCheck) {
      if (failedUrlMap.has(item.target)) {
        item.reason = `Remote resource returned ${failedUrlMap.get(item.target)}`;
        issues.push(item);
      }
    }
  }
  plugin.logOperation("INFO", "HEALTH_SCAN", `Scanned ${docFiles.length} document(s), found ${issues.length} broken link issue(s)`, {
    docsScanned: docFiles.length,
    issuesFound: issues.length
  });
  return { issues, totalDocs: docFiles.length };
}
async function exportHealthReportToRoot(plugin, issues, totalDocsScanned) {
  const now = /* @__PURE__ */ new Date();
  const dateStr = formatDateTimestamp(now);
  const reportPath = `Broken_Links_Report_${dateStr}.md`;
  const zh = getEffectiveLanguage2(plugin.settings) === "zh";
  const locale = zh ? "zh-CN" : "en-US";
  const labels = zh ? {
    title: "\u5931\u6548\u94FE\u63A5\u62A5\u544A",
    generated: "\u751F\u6210\u65F6\u95F4",
    checked: "\u5DF2\u68C0\u67E5\u6587\u6863",
    issues: "\u53D1\u73B0\u95EE\u9898",
    summary: "\u6982\u89C8",
    wiki: "\u5931\u6548\u5185\u90E8\u94FE\u63A5",
    local: "\u7F3A\u5931\u672C\u5730\u6587\u4EF6",
    remote: "\u7F51\u9875\u94FE\u63A5\u5F02\u5E38",
    source: "\u6240\u5728\u6587\u6863",
    target: "\u76EE\u6807",
    type: "\u7C7B\u578B",
    line: "\u884C\u53F7",
    context: "\u4E0A\u4E0B\u6587",
    url: "\u7F51\u9875\u94FE\u63A5",
    error: "\u9519\u8BEF",
    link: "\u94FE\u63A5",
    none: "\u6240\u9009\u68C0\u67E5\u8303\u56F4\u5185\u672A\u53D1\u73B0\u94FE\u63A5\u95EE\u9898\u3002"
  } : {
    title: "Broken links report",
    generated: "Generated",
    checked: "Documents checked",
    issues: "Issues found",
    summary: "Overview",
    wiki: "Broken note links",
    local: "Missing local files",
    remote: "Web link errors",
    source: "Document",
    target: "Target",
    type: "Type",
    line: "Line",
    context: "Context",
    url: "Web link",
    error: "Error",
    link: "Link",
    none: "No link issues found in the selected scope."
  };
  const wikiIssues = issues.filter((i) => i.category === "wikilink");
  const localIssues = issues.filter((i) => i.category === "local");
  const remoteIssues = issues.filter((i) => i.category === "remote");
  const lines = [
    `# ${labels.title} (${dateStr})`,
    ``,
    `> ${labels.generated}: ${now.toLocaleString(locale)}  |  ${labels.checked}: **${totalDocsScanned}**  |  ${labels.issues}: **${issues.length}**`,
    ``,
    `## ${labels.summary}`,
    `- ${labels.wiki}: **${wikiIssues.length}**`,
    `- ${labels.local}: **${localIssues.length}**`,
    `- ${labels.remote}: **${remoteIssues.length}**`,
    ``
  ];
  if (wikiIssues.length > 0) {
    lines.push(`## 1. ${labels.wiki} (${wikiIssues.length})`);
    lines.push(`| ${labels.source} | ${labels.target} | ${labels.type} | ${labels.line} | ${labels.context} |`);
    lines.push(`|---|---|---|---|---|`);
    for (const item of wikiIssues) {
      const safeContext = (item.lineText || "").replace(/\|/g, "\\|");
      lines.push(`| [[${item.sourcePath}]] | \`${item.target}\` | ${item.type} | ${item.line} | \`${safeContext}\` |`);
    }
    lines.push(``);
  }
  if (localIssues.length > 0) {
    lines.push(`## 2. ${labels.local} (${localIssues.length})`);
    lines.push(`| ${labels.source} | ${labels.target} | ${labels.type} | ${labels.line} | ${labels.context} |`);
    lines.push(`|---|---|---|---|---|`);
    for (const item of localIssues) {
      const safeContext = (item.lineText || "").replace(/\|/g, "\\|");
      lines.push(`| [[${item.sourcePath}]] | \`${item.target}\` | ${item.type} | ${item.line} | \`${safeContext}\` |`);
    }
    lines.push(``);
  }
  if (remoteIssues.length > 0) {
    lines.push(`## 3. ${labels.remote} (${remoteIssues.length})`);
    lines.push(`| ${labels.source} | ${labels.url} | ${labels.error} | ${labels.line} | ${labels.context} |`);
    lines.push(`|---|---|---|---|---|`);
    for (const item of remoteIssues) {
      const safeContext = (item.lineText || "").replace(/\|/g, "\\|");
      lines.push(`| [[${item.sourcePath}]] | [${labels.link}](${item.target}) | ${item.reason} | ${item.line} | \`${safeContext}\` |`);
    }
    lines.push(``);
  }
  if (issues.length === 0) {
    lines.push(labels.none);
  }
  await plugin.writeOrUpdateRootReport(reportPath, lines.join("\n"));
  new import_obsidian15.Notice(plugin.t("noticeReportGenerated", { path: reportPath }));
}
async function scanVaultAnalytics(plugin) {
  const allFiles = plugin.app.vault.getFiles();
  const docFiles = allFiles.filter((f) => isScannableDocFile(plugin, f));
  const docTexts = [];
  for (const doc of docFiles) {
    try {
      const text = await plugin.app.vault.cachedRead(doc);
      docTexts.push(text);
    } catch (e) {
    }
  }
  let remoteImages = [];
  try {
    remoteImages = await plugin.fetchRemoteFileList();
  } catch (e) {
  }
  return computeVaultStatsFromEntries(allFiles, docTexts, remoteImages);
}
async function exportAnalyticsReportToRoot(plugin, stats) {
  const now = /* @__PURE__ */ new Date();
  const dateStr = formatDateTimestamp(now);
  const reportPath = `Vault_Analytics_Report_${dateStr}.md`;
  const zh = getEffectiveLanguage2(plugin.settings) === "zh";
  const locale = zh ? "zh-CN" : "en-US";
  const noteCount = stats.noteCount + stats.canvasCount;
  const remoteImgCount = stats.remote.imageCount || stats.remote.totalCount || 0;
  const totalImages = stats.local.imageCount + remoteImgCount;
  const totalOther = Math.max(0, stats.local.totalCount + stats.remote.totalCount - totalImages);
  const totalAssets = noteCount + stats.local.totalCount + stats.remote.totalCount;
  const totalBytes = Math.max(1, stats.local.totalBytes + stats.remote.rawBytes);
  const localPct = (stats.local.totalBytes / totalBytes * 100).toFixed(1);
  const remotePct = (100 - parseFloat(localPct)).toFixed(1);
  const labels = zh ? {
    title: "\u77E5\u8BC6\u5E93\u62A5\u544A\uFF1A\u8D44\u4EA7\u5168\u666F\u4E0E\u5B58\u50A8\u5BA1\u8BA1",
    metaGen: "\u751F\u6210\u65F6\u95F4",
    metaTool: "\u5206\u6790\u5DE5\u5177",
    toolName: "File Master \u8D44\u4EA7\u7BA1\u7406\u6A21\u5757",
    secOverview: "\u4E00\u3001\u5168\u5E93\u6838\u5FC3\u8D44\u4EA7\u6982\u89C8",
    colMetric: "\u6307\u6807\u9879",
    colValue: "\u7EDF\u8BA1\u6570\u503C",
    colDesc: "\u8BE6\u7EC6\u8BF4\u660E",
    mNotes: "\u{1F4DD} \u7B14\u8BB0\u4E0E\u767D\u677F",
    mNotesDesc: `${stats.noteCount} \u7BC7 Markdown \u7B14\u8BB0 \xB7 ${stats.canvasCount} \u4E2A Canvas \u767D\u677F`,
    mImages: "\u{1F5BC}\uFE0F \u56FE\u7247\u603B\u6570",
    mImagesDesc: `\u672C\u5730 ${stats.local.imageCount} \u5F20 \xB7 \u4E91\u7AEF ${remoteImgCount} \u5F20`,
    mOther: "\u{1F4E6} \u5176\u4ED6\u9644\u4EF6",
    mOtherDesc: "\u89C6\u9891\u3001\u97F3\u9891\u53CA\u5404\u7C7B\u6587\u6863",
    mTotal: "\u{1F4DA} \u8D44\u4EA7\u603B\u6570",
    mTotalDesc: "\u5168\u5E93\u6240\u6709\u7B14\u8BB0\u4E0E\u7D20\u6750\u603B\u548C",
    mStorage: "\u{1F4BE} \u5B58\u50A8\u603B\u5360\u7528",
    mStorageDesc: "\u5305\u542B\u672C\u5730\u77E5\u8BC6\u5E93\u9644\u4EF6\u4E0E\u670D\u52A1\u5668\u6258\u7BA1\u8D44\u4EA7\u603B\u548C",
    secStorage: "\u4E8C\u3001\u5B58\u50A8\u5BB9\u91CF\u4E0E\u5F62\u6001\u5206\u5E03",
    colStorageType: "\u5B58\u50A8\u5F62\u6001",
    colAssetCount: "\u6587\u4EF6\u6570\u91CF",
    colStorageSize: "\u5360\u7528\u4F53\u79EF",
    colRatio: "\u5360\u6BD4",
    colBreakdown: "\u6784\u6210\u8BF4\u660E",
    localVault: "\u{1F4BB} \u672C\u5730",
    remoteServer: "\u2601\uFE0F \u8FDC\u7A0B",
    localDetail: `\u56FE\u7247 ${formatBytes(stats.local.imageBytes)} \xB7 \u5176\u4ED6 ${formatBytes(Math.max(0, stats.local.totalBytes - stats.local.imageBytes))}`,
    remoteDetail: `\u539F\u6587\u4EF6 ${formatBytes(stats.remote.rawBytes)} \xB7 WebP \u7F13\u5B58 ${formatBytes(stats.remote.cacheBytes)} \xB7 \u9632\u5220\u4FDD\u62A4 ${stats.remote.lockedCount} \u9879`,
    secLargest: "\u4E09\u3001\u9AD8\u5360\u7528\u9644\u4EF6\u6DF1\u5EA6\u5BA1\u8BA1\u6E05\u5355\uFF08TOP 20\uFF09",
    colRank: "\u5E8F\u53F7",
    colName: "\u6587\u4EF6\u540D\u79F0",
    colLocation: "\u5B58\u50A8\u4F4D\u7F6E",
    colType: "\u7C7B\u578B",
    colSize: "\u6587\u4EF6\u5927\u5C0F",
    colPreview: "\u9884\u89C8 / \u5F15\u7528",
    typeImage: "\u{1F5BC}\uFE0F \u56FE\u7247",
    typeVideo: "\u{1F3AC} \u89C6\u9891",
    typeAudio: "\u{1F3B5} \u97F3\u9891",
    typeDoc: "\u{1F4C4} \u6587\u6863",
    typeOther: "\u{1F4E6} \u5176\u4ED6",
    secAdvice: "\u56DB\u3001\u8D44\u4EA7\u5065\u5EB7\u4E0E\u4F18\u5316\u5EFA\u8BAE",
    advStorageRemote: `\u2601\uFE0F **\u4E91\u7AEF\u6258\u7BA1\u4E3A\u4E3B**\uFF1A\u5F53\u524D **${remotePct}%** \u7684\u9644\u4EF6\u6258\u7BA1\u5728\u670D\u52A1\u5668\uFF0C\u6709\u6548\u51CF\u8F7B\u672C\u5730\u77E5\u8BC6\u5E93\u53CA\u79FB\u52A8\u7AEF\u591A\u8BBE\u5907\u540C\u6B65\u8D1F\u62C5\u3002`,
    advStorageLocalHeavy: `\u{1F4E6} **\u672C\u5730\u5B58\u50A8\u4F18\u5316**\uFF1A\u68C0\u6D4B\u5230\u672C\u5730\u9644\u4EF6\u5360\u7528\u504F\u9AD8\uFF08**${localPct}%**\uFF09\uFF0C\u5B58\u5728\u8D85\u5927\u5355\u6587\u4EF6\uFF0C\u5EFA\u8BAE\u5C06\u5927\u4F53\u79EF\u7D20\u6750\u8FC1\u79FB\u81F3\u670D\u52A1\u5668\u4EE5\u91CA\u653E\u672C\u5730\u4E0E\u540C\u6B65\u7A7A\u95F4\u3002`,
    advCacheReady: `\u26A1 **\u8BBF\u95EE\u6027\u80FD\u52A0\u901F**\uFF1A\u4E91\u7AEF WebP \u884D\u751F\u7F13\u5B58\u5DF2\u5C31\u7EEA\uFF0C\u79FB\u52A8\u7AEF\u4E0E\u5BA2\u6237\u7AEF\u6D4F\u89C8\u65F6\u5177\u5907\u8F7B\u91CF\u5316\u52A0\u8F7D\u52A0\u901F\u80FD\u529B\u3002`,
    advLockedSafe: `\u{1F6E1}\uFE0F **\u4E91\u7AEF\u8D44\u4EA7\u5B89\u5168**\uFF1A\u5DF2\u6709 **${stats.remote.lockedCount} \u9879** \u5173\u952E\u4E91\u7AEF\u8D44\u4EA7\u5F00\u542F\u9632\u5220\u4FDD\u62A4\u9501\u5B9A\uFF0C\u9632\u6B62\u610F\u5916\u5931\u6548\u3002`,
    openFile: "\u6253\u5F00\u94FE\u63A5"
  } : {
    title: "Vault report: Asset and storage audit",
    metaGen: "Generated",
    metaTool: "Analyzer",
    toolName: "File Master Asset Management Module",
    secOverview: "1. Core Asset Metrics",
    colMetric: "Metric",
    colValue: "Value",
    colDesc: "Breakdown",
    mNotes: "\u{1F4DD} Notes & Canvases",
    mNotesDesc: `${stats.noteCount} Markdown notes \xB7 ${stats.canvasCount} Canvases`,
    mImages: "\u{1F5BC}\uFE0F Total Images",
    mImagesDesc: `Local ${stats.local.imageCount} \xB7 Remote ${remoteImgCount}`,
    mOther: "\u{1F4E6} Other Attachments",
    mOtherDesc: "Video, audio, documents, etc.",
    mTotal: "\u{1F4DA} Total Assets",
    mTotalDesc: "All notes and media assets combined",
    mStorage: "\u{1F4BE} Total Footprint",
    mStorageDesc: "Combined footprint of local vault attachments and server assets",
    secStorage: "2. Storage Distribution",
    colStorageType: "Storage Mode",
    colAssetCount: "Files",
    colStorageSize: "Size",
    colRatio: "Share",
    colBreakdown: "Composition",
    localVault: "\u{1F4BB} Local",
    remoteServer: "\u2601\uFE0F Remote",
    localDetail: `Images ${formatBytes(stats.local.imageBytes)} \xB7 Other ${formatBytes(Math.max(0, stats.local.totalBytes - stats.local.imageBytes))}`,
    remoteDetail: `Raw ${formatBytes(stats.remote.rawBytes)} \xB7 WebP Cache ${formatBytes(stats.remote.cacheBytes)} \xB7 Protected ${stats.remote.lockedCount}`,
    secLargest: "3. High-Footprint Attachments Audit (TOP 20)",
    colRank: "#",
    colName: "File Name",
    colLocation: "Location",
    colType: "Type",
    colSize: "Size",
    colPreview: "Preview / Reference",
    typeImage: "\u{1F5BC}\uFE0F Image",
    typeVideo: "\u{1F3AC} Video",
    typeAudio: "\u{1F3B5} Audio",
    typeDoc: "\u{1F4C4} Document",
    typeOther: "\u{1F4E6} Other",
    secAdvice: "4. Health & Optimization Insights",
    advStorageRemote: `\u2601\uFE0F **Cloud-Primary Storage**: **${remotePct}%** of attachments are hosted on the server, significantly reducing local footprint and mobile sync traffic.`,
    advStorageLocalHeavy: `\u{1F4E6} **Local Storage Guidance**: Local attachment footprint is notable (**${localPct}%**); consider hosting heavy media on the server to lighten mobile sync load.`,
    advCacheReady: `\u26A1 **Loading Acceleration**: Server WebP cache is ready, optimizing multi-device loading bandwidth.`,
    advLockedSafe: `\u{1F6E1}\uFE0F **Asset Protection**: **${stats.remote.lockedCount}** cloud assets are locked with delete protection.`,
    openFile: "Open Link"
  };
  const lines = [
    `# \u{1F4CA} ${labels.title} (${dateStr})`,
    ``,
    `> \u23F1\uFE0F ${labels.metaGen}: ${now.toLocaleString(locale)}  |  \u{1F6E0}\uFE0F ${labels.metaTool}: ${labels.toolName}`,
    ``,
    `---`,
    ``,
    `## \u{1F4C8} ${labels.secOverview}`,
    ``,
    `| ${labels.colMetric} | ${labels.colValue} | ${labels.colDesc} |`,
    `| :--- | :---: | :--- |`,
    `| ${labels.mNotes} | **${noteCount.toLocaleString(locale)}** | ${labels.mNotesDesc} |`,
    `| ${labels.mImages} | **${totalImages.toLocaleString(locale)}** | ${labels.mImagesDesc} |`,
    `| ${labels.mOther} | **${totalOther.toLocaleString(locale)}** | ${labels.mOtherDesc} |`,
    `| ${labels.mTotal} | **${totalAssets.toLocaleString(locale)}** | ${labels.mTotalDesc} |`,
    `| ${labels.mStorage} | **${formatBytes(stats.local.totalBytes + stats.remote.rawBytes)}** | ${labels.mStorageDesc} |`,
    ``,
    `---`,
    ``,
    `## \u{1F4BE} ${labels.secStorage}`,
    ``,
    `| ${labels.colStorageType} | ${labels.colAssetCount} | ${labels.colStorageSize} | ${labels.colRatio} | ${labels.colBreakdown} |`,
    `| :---: | :---: | :---: | :---: | :--- |`,
    `| ${labels.localVault} | ${stats.local.totalCount} | **${formatBytes(stats.local.totalBytes)}** | ${localPct}% | ${labels.localDetail} |`,
    `| ${labels.remoteServer} | ${stats.remote.totalCount} | **${formatBytes(stats.remote.rawBytes)}** | ${remotePct}% | ${labels.remoteDetail} |`,
    ``,
    `---`,
    ``
  ];
  if (stats.topLargestAttachments && stats.topLargestAttachments.length > 0) {
    lines.push(`## \u{1F4D1} ${labels.secLargest}`);
    lines.push(``);
    lines.push(`| ${labels.colRank} | ${labels.colName} | ${labels.colLocation} | ${labels.colType} | ${labels.colSize} | ${labels.colPreview} |`);
    lines.push(`| :---: | :--- | :---: | :---: | :---: | :---: |`);
    const topItems = stats.topLargestAttachments.slice(0, 20);
    topItems.forEach((item, index) => {
      var _a;
      const srcLabel = item.source === "local" ? labels.localVault : labels.remoteServer;
      let typeLabel = labels.typeOther;
      if (item.group === "image") typeLabel = labels.typeImage;
      else if (item.group === "video") typeLabel = labels.typeVideo;
      else if (item.group === "audio") typeLabel = labels.typeAudio;
      else if (item.group === "doc") typeLabel = labels.typeDoc;
      const rank = String(index + 1).padStart(2, "0");
      let previewCol = "";
      if (item.source === "local") {
        if (item.group === "image") {
          previewCol = `![[${item.path}\\|80]]`;
        } else {
          previewCol = `[[${item.path}]]`;
        }
      } else {
        const cleanServer = ((_a = plugin.settings) == null ? void 0 : _a.serverUrl) ? plugin.settings.serverUrl.replace(/\/$/, "") : "";
        const webpPath = String(item.path || "").replace(/\.[^.]+$/, ".webp");
        const remoteUrl = item.pubUrl || (cleanServer ? `${cleanServer}/pub/${webpPath}` : "") || item.rawUrl || (cleanServer ? `${cleanServer}/raw/${item.path}` : "");
        if (item.group === "image" && remoteUrl) {
          previewCol = `<img src="${remoteUrl}" width="80" style="max-height:80px; object-fit:contain; border-radius:4px;" />`;
        } else if (remoteUrl) {
          previewCol = `[${labels.openFile}](${remoteUrl})`;
        } else {
          previewCol = `\`${item.path}\``;
        }
      }
      lines.push(`| ${rank} | \`${item.name}\` | ${srcLabel} | ${typeLabel} | **${formatBytes(item.size)}** | ${previewCol} |`);
    });
    lines.push(``);
    lines.push(`---`);
    lines.push(``);
  }
  lines.push(`## \u{1F4A1} ${labels.secAdvice}`);
  lines.push(``);
  if (parseFloat(localPct) >= 50) {
    lines.push(`- ${labels.advStorageLocalHeavy}`);
    lines.push(``);
  } else {
    lines.push(`- ${labels.advStorageRemote}`);
    lines.push(``);
  }
  if (stats.remote.cacheBytes > 0) {
    lines.push(`- ${labels.advCacheReady}`);
    lines.push(``);
  }
  if (stats.remote.lockedCount > 0) {
    lines.push(`- ${labels.advLockedSafe}`);
    lines.push(``);
  }
  await plugin.writeOrUpdateRootReport(reportPath, lines.join("\n"));
  new import_obsidian15.Notice(plugin.t("noticeReportGenerated", { path: reportPath }));
}

// src/modals/health-check.js
var import_obsidian16 = require("obsidian");
var HealthCheckModal = class extends FileMasterModal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.step = 1;
    this.activeProgress = null;
    this.options = {
      checkWikiLinks: true,
      checkLocalMarkdown: true,
      checkRemote: false
    };
    this.totalDocsScanned = 0;
    this.issues = [];
    this.activeFilter = "all";
    this.searchQuery = "";
  }
  onOpen() {
    this.render();
  }
  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("fm-wizard-modal");
    if (this.step === 1) {
      this.renderStep1(contentEl);
    } else {
      this.renderStep2(contentEl);
    }
  }
  renderStep1(contentEl) {
    const t2 = (k, p) => this.plugin.t(k, p);
    moduleHeading(this, contentEl, { title: "actHealthTitle", symbol: "link", step: 1, total: 2 });
    contentEl.createEl("p", { text: t2("healthStep1Desc"), cls: "fm-module-summary" });
    const box = contentEl.createDiv({ cls: "fm-section-box" });
    box.createDiv({ text: t2("healthScopeTitle"), cls: "fm-section-title" });
    this.createCheckbox(box, t2("healthCheckWiki"), "checkWikiLinks");
    this.createCheckbox(box, t2("healthCheckLocal"), "checkLocalMarkdown");
    this.createCheckbox(box, t2("healthCheckRemote"), "checkRemote");
    const progressWidget = createScanProgressWidget(contentEl, this.plugin);
    this.activeProgress = progressWidget;
    const btnRow = contentEl.createDiv({ cls: "fm-btn-row" });
    const cancelBtn = btnRow.createEl("button", { text: t2("btnCancel") });
    cancelBtn.onclick = () => returnToHub(this);
    const startBtn = btnRow.createEl("button", { text: t2("healthStartScan"), cls: "mod-cta" });
    startBtn.onclick = async () => {
      if (!this.options.checkWikiLinks && !this.options.checkLocalMarkdown && !this.options.checkRemote) {
        return;
      }
      startBtn.disabled = true;
      startBtn.setText(t2("healthScanning"));
      progressWidget.show();
      try {
        const scanResult = await scanVaultLinkHealth(this.plugin, this.options, {
          signal: progressWidget.signal,
          onProgress: (cur, total, label) => progressWidget.update(cur, total, label)
        });
        this.issues = scanResult.issues;
        this.totalDocsScanned = scanResult.totalDocs;
        this.step = 2;
        this.render();
      } catch (err) {
        progressWidget.hide();
        new import_obsidian16.Notice(err.message === "SCAN_ABORTED" ? this.plugin.t("scanCancelled") : "\u274C Link health scan failed: " + err.message);
        startBtn.disabled = false;
        startBtn.setText(t2("healthStartScan"));
      }
    };
  }
  createCheckbox(parent, labelText, optKey) {
    const label = parent.createEl("label", { cls: "fm-check-row" });
    const cb = label.createEl("input", { type: "checkbox" });
    cb.checked = Boolean(this.options[optKey]);
    cb.onchange = () => {
      this.options[optKey] = cb.checked;
    };
    label.createSpan({ text: labelText });
  }
  renderStep2(contentEl) {
    const t2 = (k, p) => this.plugin.t(k, p);
    const wikiIssues = this.issues.filter((i) => i.category === "wikilink");
    const localIssues = this.issues.filter((i) => i.category === "local");
    const remoteIssues = this.issues.filter((i) => i.category === "remote");
    moduleHeading(this, contentEl, { title: "actHealthTitle", symbol: "link", step: this.issues.length ? 2 : null, total: 2 });
    contentEl.createEl("p", { text: t2("healthStep2Title", { docs: this.totalDocsScanned, issues: this.issues.length }), cls: "fm-module-summary" });
    const statGrid = contentEl.createDiv({ cls: "fm-health-stat-grid" });
    const addStat = (num, label, color) => {
      const card = statGrid.createDiv({ cls: "fm-health-stat-card" });
      const numEl = card.createDiv({ cls: "fm-health-stat-num", text: String(num) });
      if (color) numEl.style.color = color;
      card.createDiv({ cls: "fm-health-stat-label", text: label });
    };
    addStat(this.totalDocsScanned, t2("healthStatNotes"));
    addStat(wikiIssues.length, t2("healthStatWiki"), wikiIssues.length > 0 ? "#ef4444" : void 0);
    addStat(localIssues.length, t2("healthStatLocal"), localIssues.length > 0 ? "#f59e0b" : void 0);
    addStat(remoteIssues.length, t2("healthStatRemote"), remoteIssues.length > 0 ? "#3b82f6" : void 0);
    const toolbar = contentEl.createDiv({ cls: "fm-toolbar-row" });
    const leftTools = toolbar.createDiv({ attr: { style: "display:flex; gap:8px; align-items:center;" } });
    const backBtn = leftTools.createEl("button", { text: t2("healthRescan") });
    backBtn.onclick = () => {
      this.step = 1;
      this.render();
    };
    const exportBtn = toolbar.createEl("button", {
      text: t2("btnExportReport"),
      cls: "mod-cta"
    });
    exportBtn.onclick = async () => {
      await exportHealthReportToRoot(this.plugin, this.issues, this.totalDocsScanned);
    };
    if (this.issues.length === 0) {
      contentEl.createDiv({
        cls: "fm-section-box",
        text: t2("healthNoneFound"),
        attr: { style: "text-align: center; padding: 36px 20px; font-weight: 500;" }
      });
      const btnRow = contentEl.createDiv({ cls: "fm-btn-row" });
      const closeBtn2 = btnRow.createEl("button", { text: t2(this.fromHub ? "btnCancel" : "closeBtn") });
      closeBtn2.onclick = () => returnToHub(this);
      return;
    }
    const filterRow = contentEl.createDiv({
      attr: { style: "display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:10px; flex-wrap:wrap;" }
    });
    const chipBox = filterRow.createDiv({ attr: { style: "display:flex; gap:6px;" } });
    const createChip = (id, label, count) => {
      const chip = chipBox.createEl("button", {
        text: `${label} (${count})`,
        cls: this.activeFilter === id ? "mod-cta" : ""
      });
      chip.onclick = () => {
        this.activeFilter = id;
        this.renderStep2(contentEl);
      };
    };
    createChip("all", t2("healthFilterAll"), this.issues.length);
    createChip("wikilink", t2("healthStatWiki"), wikiIssues.length);
    createChip("local", t2("healthStatLocal"), localIssues.length);
    createChip("remote", t2("healthStatRemote"), remoteIssues.length);
    const searchInput = filterRow.createEl("input", {
      type: "search",
      placeholder: t2("healthSearchPlaceholder"),
      value: this.searchQuery,
      attr: { style: "padding: 4px 10px; border-radius: 6px; border: 1px solid var(--background-modifier-border); min-width: 180px;" }
    });
    searchInput.oninput = (e) => {
      this.searchQuery = e.target.value.toLowerCase();
      this.renderIssueList(listEl);
    };
    const listEl = contentEl.createDiv({ cls: "fm-scroll-list", attr: { style: "max-height: 380px;" } });
    this.renderIssueList(listEl);
    const bottomRow = contentEl.createDiv({ cls: "fm-btn-row" });
    const closeBtn = bottomRow.createEl("button", { text: t2(this.fromHub ? "btnCancel" : "closeBtn") });
    closeBtn.onclick = () => returnToHub(this);
  }
  renderIssueList(listEl) {
    const t2 = (k, p) => this.plugin.t(k, p);
    listEl.empty();
    let filtered = this.issues;
    if (this.activeFilter !== "all") {
      filtered = filtered.filter((i) => i.category === this.activeFilter);
    }
    if (this.searchQuery) {
      filtered = filtered.filter(
        (i) => i.sourcePath.toLowerCase().includes(this.searchQuery) || i.target.toLowerCase().includes(this.searchQuery) || i.lineText && i.lineText.toLowerCase().includes(this.searchQuery)
      );
    }
    if (filtered.length === 0) {
      listEl.createDiv({
        cls: "fm-section-box",
        text: t2("healthNoMatches"),
        attr: { style: "text-align: center; padding: 24px;" }
      });
      return;
    }
    for (const item of filtered) {
      const row = listEl.createDiv({ cls: "fm-list-item" });
      const leftCol = row.createDiv({
        attr: { style: "display:flex; flex-direction:column; gap:4px; flex:1; overflow:hidden;" }
      });
      const topMeta = leftCol.createDiv({ attr: { style: "display:flex; align-items:center; gap:6px;" } });
      let tagCls = "fm-tag-error";
      let tagLabel = "\u{1F534} Broken Link";
      if (item.category === "wikilink") {
        tagCls = "fm-tag-error";
        tagLabel = item.type === "wikilink-embed" ? t2("healthTagWikiEmbed") : t2("healthTagDanglingNote");
      } else if (item.category === "local") {
        tagCls = "fm-tag-warning";
        tagLabel = item.type === "local-embed" ? t2("healthTagMissingImage") : t2("healthTagMissingFile");
      } else if (item.category === "remote") {
        tagCls = "fm-tag-info";
        tagLabel = t2("healthTagRemote404");
      }
      topMeta.createSpan({ text: tagLabel, cls: `fm-tag ${tagCls}` });
      topMeta.createEl("code", { text: item.target, attr: { style: "font-size: 12px; font-weight: 600;" } });
      topMeta.createSpan({
        text: t2("healthLine", { line: item.line }),
        attr: { style: "font-size: 11px; color: var(--text-muted); margin-left: auto;" }
      });
      const noteRef = leftCol.createDiv({
        attr: { style: "font-size: 12px; color: var(--text-muted); display:flex; align-items:center; gap:4px;" }
      });
      noteRef.createSpan({ text: t2("healthInNote", { path: item.sourcePath }) });
      if (item.lineText) {
        leftCol.createDiv({
          text: item.lineText,
          cls: "fm-health-context-quote"
        });
      }
      const openBtn = row.createEl("button", {
        text: t2("healthJumpToLine"),
        attr: { style: "flex-shrink:0; align-self:center;" }
      });
      openBtn.onclick = async () => {
        await openNoteAtLine(this.plugin, item.sourcePath, item.line);
      };
    }
  }
  onClose() {
    if (this.activeProgress) this.activeProgress.abort();
    this.contentEl.empty();
  }
};

// src/modals/operation-log.js
var import_obsidian17 = require("obsidian");
var OperationLogModal = class extends FileMasterModal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.filterMode = "all";
    this.searchQuery = "";
  }
  t(k, p) {
    return this.plugin ? this.plugin.t(k, p) : k;
  }
  async onOpen() {
    if (this.plugin) {
      await loadOperationLogs(this.plugin);
    }
    this.render();
  }
  render() {
    var _a;
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("fm-wizard-modal");
    modalTitle(this, this.t("opLogTitle"));
    contentEl.createDiv({
      text: this.t("opLogPathHint", { path: (this.plugin == null ? void 0 : getLogFilePath(this.plugin)) || ".obsidian/plugins/file-master/operation.log" }),
      attr: { style: "font-size: 12px; color: var(--text-muted); margin-bottom: 12px;" }
    });
    const allLogs = Array.isArray((_a = this.plugin) == null ? void 0 : _a.operationLogs) ? [...this.plugin.operationLogs].reverse() : [];
    const errCount = allLogs.filter((e) => e.level === "ERROR" || e.level === "WARN").length;
    const filterRow = contentEl.createDiv({
      attr: { style: "display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:10px; flex-wrap:wrap;" }
    });
    const chipBox = filterRow.createDiv({ attr: { style: "display:flex; gap:6px;" } });
    const allBtn = chipBox.createEl("button", {
      text: `${this.t("opLogFilterAll")} (${allLogs.length})`,
      cls: this.filterMode === "all" ? "mod-cta" : ""
    });
    allBtn.onclick = () => {
      this.filterMode = "all";
      this.render();
    };
    const errBtn = chipBox.createEl("button", {
      text: `${this.t("opLogFilterErrors")} (${errCount})`,
      cls: this.filterMode === "errors" ? "mod-cta" : ""
    });
    errBtn.onclick = () => {
      this.filterMode = "errors";
      this.render();
    };
    const searchInput = filterRow.createEl("input", {
      type: "search",
      placeholder: this.t("opLogSearchPlaceholder"),
      value: this.searchQuery,
      attr: { style: "padding: 4px 10px; border-radius: 6px; border: 1px solid var(--background-modifier-border); min-width: 190px;" }
    });
    const listEl = contentEl.createDiv({
      cls: "fm-scroll-list",
      attr: { style: "max-height: 360px;" }
    });
    searchInput.oninput = (e) => {
      this.searchQuery = e.target.value.toLowerCase();
      this.renderLogList(listEl, allLogs);
    };
    this.renderLogList(listEl, allLogs);
    const btnRow = contentEl.createDiv({ cls: "fm-btn-row", attr: { style: "justify-content: space-between; flex-wrap: wrap; gap: 8px;" } });
    const leftBtns = btnRow.createDiv({ attr: { style: "display: flex; gap: 8px; flex-wrap: wrap;" } });
    const copyBtn = leftBtns.createEl("button", { text: this.t("opLogCopyAll"), cls: "mod-cta" });
    copyBtn.onclick = async () => {
      const text = (this.plugin == null ? void 0 : formatLogsForExport(this.plugin)) || "";
      await navigator.clipboard.writeText(text);
      new import_obsidian17.Notice(this.t("opLogCopiedNotice"));
    };
    const exportBtn = leftBtns.createEl("button", { text: this.t("opLogExportFile") });
    exportBtn.onclick = () => {
      const text = (this.plugin == null ? void 0 : formatLogsForExport(this.plugin)) || "";
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const now = /* @__PURE__ */ new Date();
      const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
      a.href = url;
      a.download = `file-master-debug-${dateStr}.log`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 2e3);
    };
    const clearBtn = leftBtns.createEl("button", { text: this.t("opLogClear") });
    clearBtn.onclick = async () => {
      if (this.plugin) {
        await clearOperationLogs(this.plugin);
      }
      new import_obsidian17.Notice(this.t("opLogClearedNotice"));
      this.render();
    };
    const closeBtn = btnRow.createEl("button", { text: this.t("closeBtn") });
    closeBtn.onclick = () => this.close();
  }
  renderLogList(listEl, allLogs) {
    listEl.empty();
    let filtered = allLogs;
    if (this.filterMode === "errors") {
      filtered = filtered.filter((e) => e.level === "ERROR" || e.level === "WARN");
    }
    if (this.searchQuery) {
      filtered = filtered.filter((e) => {
        const hay = `${e.ts || ""} ${e.level || ""} ${e.action || ""} ${e.summary || ""} ${e.details ? JSON.stringify(e.details) : ""}`.toLowerCase();
        return hay.includes(this.searchQuery);
      });
    }
    if (filtered.length === 0) {
      listEl.createDiv({
        cls: "fm-section-box",
        text: this.t("opLogEmpty"),
        attr: { style: "text-align: center; padding: 28px 16px; color: var(--text-muted);" }
      });
      return;
    }
    for (const entry of filtered) {
      const row = listEl.createDiv({ cls: "fm-list-item" });
      const col = row.createDiv({
        attr: { style: "display:flex; flex-direction:column; gap:4px; flex:1; overflow:hidden;" }
      });
      const topRow = col.createDiv({
        attr: { style: "display:flex; align-items:center; gap:6px; flex-wrap:wrap;" }
      });
      let levelCls = "fm-tag-info";
      if (entry.level === "ERROR") levelCls = "fm-tag-error";
      else if (entry.level === "WARN") levelCls = "fm-tag-warning";
      topRow.createSpan({ text: entry.level || "INFO", cls: `fm-tag ${levelCls}` });
      if (entry.action) {
        topRow.createEl("code", { text: entry.action, attr: { style: "font-size: 11px;" } });
      }
      topRow.createSpan({
        text: entry.ts || "",
        attr: { style: "font-size: 11px; color: var(--text-muted); margin-left: auto;" }
      });
      col.createDiv({
        text: entry.summary || "",
        attr: { style: "font-size: 12px; font-weight: 500; word-break: break-word;" }
      });
      if (entry.details && Object.keys(entry.details).length > 0) {
        col.createDiv({
          text: JSON.stringify(entry.details),
          cls: "fm-health-context-quote",
          attr: { style: "font-family: var(--font-monospace); font-size: 11px; word-break: break-all;" }
        });
      }
    }
  }
  onClose() {
    this.contentEl.empty();
  }
};

// src/modals/orphan-wizard.js
var import_obsidian18 = require("obsidian");
var OrphanWizardModal = class extends FileMasterModal {
  constructor(app, plugin) {
    var _a;
    super(app);
    this.plugin = plugin;
    this.step = 1;
    this.activeProgress = null;
    const isRemote = Boolean((_a = plugin == null ? void 0 : plugin.isRemoteServerReady) == null ? void 0 : _a.call(plugin));
    this.options = {
      scanLocal: true,
      scanRemote: isRemote,
      typeNote: false,
      typeImage: true,
      typeAudio: true,
      typeOther: true
    };
    this.results = [];
  }
  onOpen() {
    this.render();
  }
  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("fm-wizard-modal");
    if (this.step === 1) {
      this.renderStep1(contentEl);
    } else {
      this.renderStep2(contentEl);
    }
  }
  renderStep1(contentEl) {
    var _a, _b;
    const t2 = (k, p) => this.plugin.t(k, p);
    moduleHeading(this, contentEl, { title: "actOrphanTitle", symbol: "search", step: 1, total: 2 });
    contentEl.createEl("p", { text: t2("orphanStep1Desc"), cls: "fm-module-summary" });
    if ((_b = (_a = this.plugin) == null ? void 0 : _a.isRemoteServerReady) == null ? void 0 : _b.call(_a)) {
      const locBox = contentEl.createDiv({ cls: "fm-section-box" });
      locBox.createDiv({ text: t2("orphanLocScope"), cls: "fm-section-title" });
      this.createCheckbox(locBox, t2("orphanScanLocal"), "scanLocal");
      this.createCheckbox(locBox, t2("orphanScanRemote"), "scanRemote");
    }
    const typeBox = contentEl.createDiv({ cls: "fm-section-box" });
    typeBox.createDiv({ text: t2("orphanTypeScope"), cls: "fm-section-title" });
    this.createCheckbox(typeBox, t2("orphanTypeNote"), "typeNote");
    this.createCheckbox(typeBox, t2("orphanTypeImage"), "typeImage");
    this.createCheckbox(typeBox, t2("orphanTypeAudio"), "typeAudio");
    this.createCheckbox(typeBox, t2("orphanTypeOther"), "typeOther");
    renderExcludedFoldersHint(contentEl, this.plugin);
    const progressWidget = createScanProgressWidget(contentEl, this.plugin);
    this.activeProgress = progressWidget;
    const btnRow = contentEl.createDiv({ cls: "fm-btn-row" });
    const cancelBtn = btnRow.createEl("button", { text: t2("btnCancel") });
    cancelBtn.onclick = () => returnToHub(this);
    const nextBtn = btnRow.createEl("button", { text: t2("btnNext"), cls: "mod-cta" });
    nextBtn.onclick = async () => {
      if (!this.options.scanLocal && !this.options.scanRemote) {
        new import_obsidian18.Notice(t2("orphanLocRequired"));
        return;
      }
      if (!this.options.typeNote && !this.options.typeImage && !this.options.typeAudio && !this.options.typeOther) {
        new import_obsidian18.Notice(t2("orphanTypeRequired"));
        return;
      }
      nextBtn.disabled = true;
      nextBtn.setText(t2("orphanScanning"));
      progressWidget.show();
      try {
        this.results = await scanUnusedFiles(this.plugin, this.options, {
          signal: progressWidget.signal,
          onProgress: (cur, total, label) => progressWidget.update(cur, total, label)
        });
        this.step = 2;
        this.render();
      } catch (err) {
        progressWidget.hide();
        new import_obsidian18.Notice(err.message === "SCAN_ABORTED" ? this.plugin.t("scanCancelled") : "\u274C Scan failed: " + err.message);
        nextBtn.disabled = false;
        nextBtn.setText(t2("btnNext"));
      }
    };
  }
  createCheckbox(parent, labelText, optKey) {
    const label = parent.createEl("label", { cls: "fm-check-row" });
    const cb = label.createEl("input", { type: "checkbox" });
    cb.checked = Boolean(this.options[optKey]);
    cb.onchange = () => {
      this.options[optKey] = cb.checked;
    };
    label.createSpan({ text: labelText });
  }
  renderStep2(contentEl) {
    const t2 = (k, p) => this.plugin.t(k, p);
    moduleHeading(this, contentEl, { title: "actOrphanTitle", symbol: "search", step: this.results.length ? 2 : null, total: 2 });
    contentEl.createEl("p", { text: t2("orphanStep2Title", { count: this.results.length }), cls: "fm-module-summary" });
    if (this.lastCleanSummary) {
      const banner = contentEl.createDiv({ cls: "fm-result-banner fm-result-banner-success" });
      banner.createDiv({ cls: "fm-result-banner-title", text: t2("orphanResultTitle") });
      banner.createDiv({ cls: "fm-result-banner-desc", text: t2("orphanResultDesc", {
        count: this.lastCleanSummary.total || 0,
        local: this.lastCleanSummary.local || 0,
        remote: this.lastCleanSummary.remote || 0
      }) });
    }
    const toolbar = contentEl.createDiv({ cls: "fm-toolbar-row" });
    const leftTools = toolbar.createDiv({ attr: { style: "display:flex; gap:8px; align-items:center;" } });
    const backBtn = leftTools.createEl("button", { text: t2("btnBack") });
    backBtn.onclick = () => {
      this.step = 1;
      this.render();
    };
    const selectAllBtn = leftTools.createEl("button", { text: t2("btnSelectAll") });
    selectAllBtn.onclick = () => {
      const allSelected = this.results.every((r) => r.selected);
      this.results.forEach((r) => {
        r.selected = !allSelected;
      });
      this.render();
    };
    const exportBtn = toolbar.createEl("button", {
      text: t2("btnExportReport"),
      cls: "mod-cta"
    });
    exportBtn.onclick = async () => {
      await exportOrphanReportToRoot(this.plugin, this.results);
    };
    if (this.results.length === 0) {
      contentEl.createDiv({
        cls: "fm-section-box",
        text: t2("orphanNoneFound"),
        attr: { style: "text-align: center; padding: 36px 20px;" }
      });
      const emptyBtnRow = contentEl.createDiv({ cls: "fm-btn-row" });
      const cancelBtn2 = emptyBtnRow.createEl("button", { text: t2("btnCancel") });
      cancelBtn2.onclick = () => returnToHub(this);
      return;
    }
    const listEl = contentEl.createDiv({ cls: "fm-scroll-list" });
    for (const item of this.results) {
      const row = listEl.createDiv({ cls: "fm-list-item" });
      const left = row.createDiv({
        attr: { style: "display:flex; align-items:center; gap:10px; flex:1; overflow:hidden;" }
      });
      const cb = left.createEl("input", { type: "checkbox", attr: { style: "cursor:pointer;" } });
      cb.checked = item.selected;
      cb.onchange = () => {
        item.selected = cb.checked;
      };
      renderItemVisualThumb(left, item, this.plugin);
      const infoCol = left.createDiv({ attr: { style: "overflow:hidden; flex:1;" } });
      const topLine = infoCol.createDiv({ attr: { style: "display:flex; align-items:center; gap:6px;" } });
      topLine.createSpan({
        text: item.source === "local" ? "\u{1F4BB} Local" : "\u2601\uFE0F Remote",
        cls: `fm-tag ${item.source === "local" ? "fm-tag-local" : "fm-tag-remote"}`
      });
      topLine.createSpan({
        text: item.displayPath,
        attr: { style: "overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:500;" }
      });
      const rightBox = row.createDiv({
        attr: { style: "display:flex; align-items:center; gap:8px; flex-shrink:0;" }
      });
      rightBox.createSpan({
        text: formatBytes(item.size),
        attr: { style: "color: var(--text-muted); font-size: 12px;" }
      });
      if (item.source === "remote") {
        const lockBtn = rightBox.createEl("button", {
          text: t2("lockBtnText"),
          cls: "fm-mini-btn",
          attr: { "aria-label": t2("lockBtnTitle") }
        });
        lockBtn.onclick = async () => {
          try {
            await this.plugin.toggleRemoteFileLock(item.rawObj.year, item.rawObj.month, item.rawObj.filename, true);
            new import_obsidian18.Notice(this.plugin.t("noticeProtectedRemote", { name: item.name }));
            this.results = this.results.filter((r) => r.id !== item.id);
            this.render();
          } catch (err) {
            new import_obsidian18.Notice(this.plugin.t("noticeLockFailed", { err: err.message }));
          }
        };
      }
    }
    const btnRow = contentEl.createDiv({ cls: "fm-btn-row" });
    const cancelBtn = btnRow.createEl("button", { text: t2("btnCancel") });
    cancelBtn.onclick = () => returnToHub(this);
    const cleanBtn = btnRow.createEl("button", {
      text: t2("orphanDeleteSelected", { count: this.results.filter((r) => r.selected).length }),
      cls: "mod-warning"
    });
    cleanBtn.onclick = async () => {
      const selected = this.results.filter((r) => r.selected);
      if (selected.length === 0) {
        new import_obsidian18.Notice(this.plugin.t("orphanSelectRequired"));
        return;
      }
      await cleanSelectedOrphans(this.plugin, selected, (summary) => {
        const removedIds = new Set(selected.map((s) => s.id));
        this.results = this.results.filter((r) => !removedIds.has(r.id));
        this.lastCleanSummary = summary;
        this.render();
      });
    };
  }
  onClose() {
    if (this.activeProgress) this.activeProgress.abort();
    this.contentEl.empty();
  }
};

// src/gallery.js
var import_obsidian19 = require("obsidian");
var REMOTE_GALLERY_PAGE_SIZE = 60;
function filterRemoteGallery(view) {
  const filtered = view.items.filter((item) => {
    if (view.selectedBucket !== "all" && `${item.year}/${item.month}` !== view.selectedBucket) return false;
    if (view.selectedType !== "all" && getFileTypeGroup(getExt(item.name || item.filename)) !== view.selectedType) return false;
    return !view.searchQuery || (item.name || item.filename || "").toLowerCase().includes(view.searchQuery);
  });
  const sort = view.selectedSort || "time_desc";
  filtered.sort((a, b) => {
    if (sort === "size_desc") return (b.size || 0) - (a.size || 0);
    if (sort === "size_asc") return (a.size || 0) - (b.size || 0);
    if (sort === "name_asc") {
      const na = a.name || a.filename || "";
      const nb = b.name || b.filename || "";
      return na.localeCompare(nb, void 0, { numeric: true, sensitivity: "base" });
    }
    if (sort === "name_desc") {
      const na = a.name || a.filename || "";
      const nb = b.name || b.filename || "";
      return nb.localeCompare(na, void 0, { numeric: true, sensitivity: "base" });
    }
    if (sort === "hits_desc") {
      return (b.hits || 0) - (a.hits || 0) || (b.createdAt || 0) - (a.createdAt || 0);
    }
    if (sort === "time_asc") return (a.createdAt || 0) - (b.createdAt || 0);
    return (b.createdAt || 0) - (a.createdAt || 0);
  });
  return filtered;
}
function getRemoteGalleryPage(view, filtered) {
  const key = `${view.selectedBucket}:${view.selectedType}:${view.selectedSort || "time_desc"}:${view.searchQuery}`;
  if (key !== view.galleryFilterKey) {
    view.galleryPage = 0;
    view.galleryFilterKey = key;
  }
  const totalPages = Math.max(1, Math.ceil(filtered.length / REMOTE_GALLERY_PAGE_SIZE));
  view.galleryPage = Math.min(Math.max(0, view.galleryPage || 0), totalPages - 1);
  return {
    current: view.galleryPage,
    totalPages,
    items: filtered.slice(view.galleryPage * REMOTE_GALLERY_PAGE_SIZE, (view.galleryPage + 1) * REMOTE_GALLERY_PAGE_SIZE)
  };
}
function renderRemoteGallery(view, containerEl, countLabel) {
  containerEl.empty();
  if (view.layoutMode === "list") {
    containerEl.addClass("is-list");
  } else {
    containerEl.removeClass("is-list");
  }
  const filtered = view.filterItems();
  const totalBytes = filtered.reduce((s, i) => s + (i.size || 0), 0);
  if (countLabel) {
    countLabel.empty();
    countLabel.createSpan({ cls: "fm-gallery-stats-count", text: view.t("galleryFileCount", { count: filtered.length }) });
    countLabel.createSpan({ cls: "fm-gallery-stats-size", text: view.t("galleryTotalSize", { size: formatBytes(totalBytes) }) });
  }
  if (filtered.length === 0) {
    containerEl.createDiv({
      cls: "fm-section-box",
      text: view.t("galleryEmpty"),
      attr: { style: "grid-column: 1 / -1; text-align: center; padding: 30px 10px; color: var(--text-muted); font-size:12px;" }
    });
    return;
  }
  const page = getRemoteGalleryPage(view, filtered);
  for (const item of page.items) {
    const card = containerEl.createDiv({ cls: "fm-gallery-card" + (view.layoutMode === "list" ? " is-list" : "") });
    const thumbWrap = card.createDiv({ cls: "fm-gallery-thumb-wrap" });
    const ext = getExt(item.name || item.filename);
    const isImg = IMAGE_EXTS.has(ext);
    if (isImg) {
      const img = thumbWrap.createEl("img", {
        cls: "fm-gallery-thumb",
        attr: {
          loading: "lazy",
          src: item.thumbnailUrl || item.rawUrl,
          alt: item.name || item.filename
        }
      });
      img.onerror = () => {
        img.style.display = "none";
        (0, import_obsidian19.setIcon)(thumbWrap.createSpan(), "image-off");
      };
    } else {
      thumbWrap.createDiv({
        text: ext.toUpperCase(),
        attr: { style: "font-size: 14px; font-weight: 700; color: var(--text-muted);" }
      });
    }
    if (item.locked) {
      const lockBadge = thumbWrap.createSpan({
        cls: "fm-gallery-lock-badge",
        attr: { "aria-label": view.t("previewProtected") }
      });
      (0, import_obsidian19.setIcon)(lockBadge, "lock");
    }
    const openPreview = () => {
      openModal(new ImageLightboxModal(view.app, view.plugin, {
        source: "remote",
        name: item.name || item.filename,
        displayPath: `${item.year}/${item.month}/${item.filename}`,
        size: item.size,
        rawObj: item
      }, (action, target) => {
        var _a;
        if (action === "deleted") {
          view.items = view.items.filter((i) => !(i.year === target.year && i.month === target.month && i.filename === target.filename));
        }
        (_a = view.store) == null ? void 0 : _a.emit();
      }, { insertMode: view.insertMode, insertionTarget: view.insertionTarget })).catch((error) => new import_obsidian19.Notice(error.message));
    };
    thumbWrap.onclick = openPreview;
    thumbWrap.setAttribute("role", "button");
    thumbWrap.setAttribute("tabindex", "0");
    thumbWrap.setAttribute("aria-label", view.t("galleryBtnPreview"));
    thumbWrap.onkeydown = (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        thumbWrap.click();
      }
    };
    const info = card.createDiv({ cls: "fm-gallery-info" });
    const nameButton = info.createEl("button", {
      cls: "fm-gallery-name",
      text: item.name || item.filename,
      attr: { type: "button", "aria-label": item.name || item.filename }
    });
    nameButton.onclick = openPreview;
    const meta = info.createDiv({ cls: "fm-gallery-meta" });
    meta.createSpan({ text: formatBytes(item.size) });
    const actions = info.createDiv({ cls: "fm-gallery-actions" });
    const isWebpMode = view.insertMode === "webp" && hasOptimizedVariant(item);
    const insertTargetUrl = assetUrl(item, view.insertMode);
    const fn = item.name || item.filename;
    const insertBtn = actions.createEl("button", {
      cls: "fm-icon-button fm-gallery-insert-btn",
      attr: { type: "button", "data-insert-action": "true" }
    });
    (0, import_obsidian19.setIcon)(insertBtn.createSpan(), "file-input");
    insertBtn.setAttribute("aria-label", view.t(isWebpMode ? "galleryInsertWebp" : "galleryInsertRaw"));
    insertBtn.disabled = !isInsertionTargetValid(view.plugin, view.insertionTarget);
    insertBtn.onmousedown = (e) => {
      e.preventDefault();
    };
    insertBtn.onclick = () => {
      const mdSnippet = assetMarkdown(fn, insertTargetUrl) + "\n";
      const noticeMsg = isWebpMode ? view.t("galleryInsertedWebp") : view.t("galleryInsertedRaw");
      if (view.plugin) insertMarkdownToActiveEditor(view.plugin, mdSnippet, noticeMsg, view.insertionTarget);
    };
    const copyBtn = actions.createEl("button", { cls: "fm-icon-button", attr: { type: "button", "aria-label": view.t("previewCopyUrl") } });
    (0, import_obsidian19.setIcon)(copyBtn, "copy");
    copyBtn.onclick = () => copyText(view.plugin, insertTargetUrl);
  }
  if (page.totalPages > 1) {
    const pager = containerEl.createDiv({ cls: "fm-gallery-pagination" });
    const previous = pager.createEl("button", { text: view.t("pagePrevious") });
    previous.disabled = page.current === 0;
    previous.onclick = () => {
      view.galleryPage--;
      view.store ? view.store.emit() : view.renderGrid(containerEl, countLabel);
    };
    pager.createSpan({ text: view.t("pageCount", { current: page.current + 1, total: page.totalPages }) });
    const next = pager.createEl("button", { text: view.t("pageNext") });
    next.disabled = page.current + 1 === page.totalPages;
    next.onclick = () => {
      view.galleryPage++;
      view.store ? view.store.emit() : view.renderGrid(containerEl, countLabel);
    };
  }
}

// src/ui/gallery-store.js
var GalleryStore = class {
  constructor(plugin) {
    this.plugin = plugin;
    this.state = { items: [], loading: false, error: null, loaded: false, searchQuery: "", selectedBucket: "all", selectedType: "all", selectedSort: "time_desc", layoutMode: "list", galleryPage: 0, galleryFilterKey: "", insertMode: plugin.settings.galleryInsertFormat || (plugin.settings.insertOptimizedLinkOnUpload ? "webp" : "raw") };
    this.listeners = /* @__PURE__ */ new Set();
    this.revision = 0;
    this.formatRevision = 0;
    this.pending = null;
  }
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit() {
    this.listeners.forEach((fn) => fn(this.state));
  }
  patch(values) {
    Object.assign(this.state, values);
    this.emit();
  }
  async load(force = false) {
    if (this.pending && !force) return this.pending;
    if (this.state.loaded && !force) return;
    const revision = ++this.revision;
    this.patch({ loading: true, error: null });
    const pending = Promise.resolve().then(async () => {
      try {
        const items = await this.plugin.fetchRemoteFileList();
        if (revision === this.revision) this.patch({ items, loading: false, loaded: true, error: null });
      } catch (error) {
        if (revision === this.revision) this.patch({ loading: false, error: error.message || String(error) });
      } finally {
        if (this.pending === pending) this.pending = null;
      }
    });
    this.pending = pending;
    return pending;
  }
  async setInsertMode(mode) {
    if (!["raw", "webp"].includes(mode)) return;
    const previous = this.state.insertMode, revision = ++this.formatRevision;
    this.plugin.settings.galleryInsertFormat = mode;
    this.patch({ insertMode: mode });
    try {
      await this.plugin.saveSettings();
    } catch (error) {
      if (revision === this.formatRevision) {
        this.plugin.settings.galleryInsertFormat = previous;
        this.patch({ insertMode: previous });
      }
      throw error;
    }
  }
  clear() {
    this.revision++;
    this.pending = null;
    this.listeners.clear();
    this.state.items = [];
    this.state.loaded = false;
  }
};
function galleryStore(plugin) {
  return plugin.galleryStore || (plugin.galleryStore = new GalleryStore(plugin));
}

// src/modals/remote-gallery.js
var import_obsidian20 = require("obsidian");
function openBrowser(host) {
  host.contentEl.empty();
  host.contentEl.addClass("fm-ui", "fm-browser");
  host.store = galleryStore(host.plugin);
  host.insertionTarget = captureInsertionTarget(host.plugin);
  host.browserEvents = new AbortController();
  const updateTarget = () => {
    const target = captureInsertionTarget(host.plugin);
    if (target) host.insertionTarget = target;
    host.contentEl.querySelectorAll("[data-insert-action]").forEach((button) => {
      button.disabled = !isInsertionTargetValid(host.plugin, host.insertionTarget);
    });
  };
  host.contentEl.addEventListener("pointerdown", updateTarget, { capture: true, signal: host.browserEvents.signal });
  host.workspaceEvents = ["active-leaf-change", "file-open"].map((event) => host.app.workspace.on(event, updateTarget));
  if (host instanceof FileMasterModal) moduleHeading(host, host.contentEl, { title: "actRemoteGalleryTitle", symbol: "images" });
  const toolbar = host.toolbar = galleryToolbar(host, host.contentEl), status = host.contentEl.createDiv({ cls: "fm-browser-status", attr: { "aria-live": "polite" } }), grid = host.contentEl.createDiv({ cls: "fm-gallery-grid" });
  host.render = () => {
    const state = host.store.state;
    toolbar.sync();
    status.empty();
    if (state.loading) status.createSpan({ text: host.t("galleryLoading") });
    if (state.error) {
      status.createSpan({ text: host.t("galleryLoadFail", { err: state.error }) });
      const retry = status.createEl("button", { text: host.t("galleryBtnRefresh") });
      retry.onclick = () => host.store.load(true);
    }
    if (!state.loaded && !state.items.length) {
      grid.empty();
      toolbar.count.empty();
    } else host.renderGrid(grid, toolbar.count);
  };
  if (host.fromHub) {
    const footer = host.contentEl.createDiv({ cls: "fm-btn-row" });
    footer.createEl("button", { text: host.t("btnCancel") }).onclick = () => host.returnToHub();
  }
  host.unsubscribe = host.store.subscribe(host.render);
  host.render();
  return host.store.load();
}
function closeBrowser(host) {
  var _a, _b, _c, _d;
  (_a = host.toolbar) == null ? void 0 : _a.dispose();
  (_b = host.workspaceEvents) == null ? void 0 : _b.forEach((ref) => host.app.workspace.offref(ref));
  host.workspaceEvents = [];
  (_c = host.browserEvents) == null ? void 0 : _c.abort();
  (_d = host.unsubscribe) == null ? void 0 : _d.call(host);
  host.unsubscribe = null;
  host.contentEl.empty();
}
function bindState(host) {
  for (const key of ["items", "searchQuery", "selectedBucket", "selectedType", "selectedSort", "layoutMode", "insertMode", "galleryPage", "galleryFilterKey"]) Object.defineProperty(host, key, { get: () => host.store.state[key], set: (value) => {
    host.store.state[key] = value;
  }, configurable: true });
}
var RemoteGalleryModal = class extends FileMasterModal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.store = galleryStore(plugin);
    bindState(this);
  }
  t(key, params) {
    return this.plugin.t(key, params);
  }
  async onOpen() {
    this.modalEl.addClass("fm-ui", "fm-gallery-dialog");
    modalChrome(this);
    return openBrowser(this);
  }
  rebuild() {
    closeBrowser(this);
    return openBrowser(this);
  }
  loadData() {
    return this.store.load(true);
  }
  filterItems() {
    return filterRemoteGallery(this);
  }
  renderGrid(container, count) {
    renderRemoteGallery(this, container, count);
  }
  onClose() {
    closeBrowser(this);
  }
};
var RemoteGalleryView = class extends import_obsidian20.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.store = galleryStore(plugin);
    bindState(this);
  }
  getViewType() {
    return VIEW_TYPE_REMOTE_GALLERY;
  }
  getDisplayText() {
    return this.t("galleryViewTitle");
  }
  getIcon() {
    return "images";
  }
  t(key, params) {
    return this.plugin.t(key, params);
  }
  async onOpen() {
    this.contentEl.addClass("fm-gallery-view-container");
    return openBrowser(this);
  }
  rebuild() {
    closeBrowser(this);
    return openBrowser(this);
  }
  loadData() {
    return this.store.load(true);
  }
  filterItems() {
    return filterRemoteGallery(this);
  }
  renderGrid(container, count) {
    renderRemoteGallery(this, container, count);
  }
  onClose() {
    closeBrowser(this);
  }
};

// src/modals/vault-analytics.js
var import_obsidian21 = require("obsidian");
var VaultAnalyticsModal = class extends FileMasterModal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.stats = null;
    this.hoverPopover = null;
  }
  async onOpen() {
    const t2 = (k, p) => this.plugin.t(k, p);
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("fm-wizard-modal");
    moduleHeading(this, contentEl, { title: "actAnalyticsTitle", symbol: "chart-no-axes-combined" });
    const loadingEl = contentEl.createDiv({
      cls: "fm-section-box",
      text: t2("analyticsLoading"),
      attr: { style: "text-align: center; padding: 32px 20px;" }
    });
    try {
      this.stats = await scanVaultAnalytics(this.plugin);
      loadingEl.remove();
      this.renderDashboard(contentEl);
    } catch (err) {
      loadingEl.setText(t2("analyticsFail", { err: err.message }));
    }
  }
  renderDashboard(contentEl) {
    const t2 = (k, p) => this.plugin.t(k, p);
    const s = this.stats;
    const noteCount = s.noteCount + s.canvasCount;
    const remoteImgCount = s.remote.imageCount || s.remote.totalCount || 0;
    const totalImages = s.local.imageCount + remoteImgCount;
    const totalOtherAttachments = Math.max(0, s.local.totalCount + s.remote.totalCount - totalImages);
    const totalAllFiles = noteCount + s.local.totalCount + s.remote.totalCount;
    const totalCombinedBytes = Math.max(1, s.local.totalBytes + s.remote.rawBytes);
    const localPct = Math.round(s.local.totalBytes / totalCombinedBytes * 100);
    const remotePct = 100 - localPct;
    const cacheCov = s.remote.totalCount > 0 ? Math.round((s.remote.cachedCount || 0) / s.remote.totalCount * 100) : 0;
    const statGrid = contentEl.createDiv({ cls: "fm-health-stat-grid" });
    const addStat = (num, label, sub, color) => {
      const card = statGrid.createDiv({
        cls: "fm-health-stat-card",
        attr: {
          style: "padding: 10px 8px; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 80px;"
        }
      });
      const numEl = card.createDiv({
        cls: "fm-health-stat-num",
        text: String(num),
        attr: { style: "font-size: 20px; font-weight: 700; line-height: 1.2; font-variant-numeric: tabular-nums;" }
      });
      if (color) numEl.style.color = color;
      card.createDiv({
        cls: "fm-health-stat-label",
        text: label,
        attr: { style: "font-size: 11px; font-weight: 600; color: var(--text-muted); margin-top: 3px;" }
      });
      card.createDiv({
        text: sub,
        attr: { style: "font-size: 10px; color: var(--text-faint); margin-top: 3px; font-variant-numeric: tabular-nums; white-space: nowrap;" }
      });
    };
    addStat(
      noteCount,
      t2("analyticsStatNotes"),
      t2("analyticsStatNotesSub", { md: s.noteCount, cva: s.canvasCount })
    );
    addStat(
      totalImages,
      t2("analyticsStatImages"),
      t2("analyticsStatImagesSub", { loc: s.local.imageCount, rem: remoteImgCount }),
      "#10b981"
    );
    addStat(
      totalOtherAttachments,
      t2("analyticsStatOtherAttachments"),
      t2("analyticsStatOtherSub"),
      "#3b82f6"
    );
    addStat(
      totalAllFiles,
      t2("analyticsStatTotalFiles"),
      t2("analyticsStatTotalSub"),
      "#8b5cf6"
    );
    const storageBox = contentEl.createDiv({ cls: "fm-section-box" });
    storageBox.createDiv({ text: t2("analyticsStorageComparison"), cls: "fm-section-title" });
    const summaryRow = storageBox.createDiv({
      attr: { style: "display:grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 8px;" }
    });
    const localCard = summaryRow.createDiv({
      attr: { style: "padding: 12px; border-radius: 8px; background: var(--background-primary); border: 1px solid var(--background-modifier-border);" }
    });
    localCard.createDiv({ text: t2("analyticsLocalVault"), attr: { style: "font-weight: 600; font-size: 13px;" } });
    localCard.createDiv({
      text: `${formatBytes(s.local.totalBytes)} (${localPct}%)`,
      attr: { style: "font-size: 15px; font-weight: 700; margin-top: 4px; color: var(--text-accent); font-variant-numeric: tabular-nums;" }
    });
    localCard.createDiv({
      text: t2("analyticsLocalStats", {
        imgBytes: formatBytes(s.local.imageBytes),
        othBytes: formatBytes(Math.max(0, s.local.totalBytes - s.local.imageBytes))
      }),
      attr: { style: "font-size: 11px; color: var(--text-muted); margin-top: 6px; line-height: 1.4;" }
    });
    const remoteCard = summaryRow.createDiv({
      attr: { style: "padding: 12px; border-radius: 8px; background: var(--background-primary); border: 1px solid var(--background-modifier-border);" }
    });
    remoteCard.createDiv({ text: t2("analyticsRemoteServer"), attr: { style: "font-weight: 600; font-size: 13px;" } });
    remoteCard.createDiv({
      text: `${formatBytes(s.remote.rawBytes)} (${remotePct}%)`,
      attr: { style: "font-size: 15px; font-weight: 700; margin-top: 4px; color: #10b981; font-variant-numeric: tabular-nums;" }
    });
    remoteCard.createDiv({
      text: t2("analyticsRemoteStats", {
        cache: formatBytes(s.remote.cacheBytes),
        locked: s.remote.lockedCount
      }),
      attr: { style: "font-size: 11px; color: var(--text-muted); margin-top: 6px; line-height: 1.4;" }
    });
    const insightsBox = contentEl.createDiv({ cls: "fm-section-box" });
    insightsBox.createDiv({ text: t2("analyticsInsightsTitle"), cls: "fm-section-title" });
    const insightsList = insightsBox.createDiv({
      attr: { style: "display: flex; flex-direction: column; gap: 6px; margin-top: 8px;" }
    });
    const addInsightItem = (icon, html) => {
      const itemEl = insightsList.createDiv({
        attr: {
          style: "display: flex; align-items: flex-start; gap: 8px; font-size: 11px; line-height: 1.5; color: var(--text-muted); padding: 2px 0;"
        }
      });
      itemEl.createSpan({ text: icon, attr: { style: "flex-shrink: 0; font-size: 13px; margin-top: 1px;" } });
      const textSpan = itemEl.createSpan({ attr: { style: "flex: 1;" } });
      textSpan.innerHTML = html;
    };
    if (localPct >= 70 && s.local.totalBytes > 10 * 1024 * 1024) {
      addInsightItem("\u{1F4E6}", t2("analyticsInsightStorageLocal", { pct: localPct }));
    } else if (remotePct >= 50) {
      addInsightItem("\u2601\uFE0F", t2("analyticsInsightStorageRemote", { pct: remotePct }));
    }
    if (cacheCov > 0) {
      addInsightItem("\u26A1", t2("analyticsInsightCacheReady"));
    }
    if (s.remote.lockedCount > 0) {
      addInsightItem("\u{1F6E1}\uFE0F", t2("analyticsInsightLockedSafe", { count: s.remote.lockedCount }));
    }
    const allTop = s.topLargestAttachments || [];
    if (allTop.length > 0) {
      const topBox = contentEl.createDiv({ cls: "fm-section-box" });
      const topHeaderRow = topBox.createDiv({
        attr: { style: "display: flex; align-items: center; justify-content: space-between;" }
      });
      topHeaderRow.createDiv({ text: t2("analyticsTopLargest"), cls: "fm-section-title", attr: { style: "margin: 0;" } });
      let currentFilter = "all";
      const filterGroup = topHeaderRow.createDiv({
        attr: {
          style: "display: flex; gap: 2px; background: var(--background-secondary); padding: 2px; border-radius: 6px; border: 1px solid var(--background-modifier-border);"
        }
      });
      const listEl = topBox.createDiv({ cls: "fm-scroll-list", attr: { style: "max-height: 195px; margin-top: 8px;" } });
      const renderList = () => {
        listEl.empty();
        const filtered = allTop.filter((item) => {
          if (currentFilter === "local") return item.source === "local";
          if (currentFilter === "remote") return item.source === "remote";
          return true;
        }).slice(0, 10);
        if (filtered.length === 0) {
          listEl.createDiv({
            text: t2("analyticsFilterEmpty"),
            attr: { style: "text-align: center; padding: 20px; color: var(--text-faint); font-size: 12px;" }
          });
          return;
        }
        for (const item of filtered) {
          const row = listEl.createDiv({
            cls: "fm-list-item",
            attr: {
              style: "cursor: pointer; display: flex; align-items: center; justify-content: space-between; padding: 5px 8px; border-radius: 4px;"
            }
          });
          row.title = t2("analyticsClickToCopy");
          row.onclick = async () => {
            try {
              await navigator.clipboard.writeText(item.name);
              new import_obsidian21.Notice(t2("analyticsCopiedName", { name: item.name }));
            } catch (e) {
              new import_obsidian21.Notice(item.name);
            }
          };
          row.onmouseenter = (e) => {
            if (item.group !== "image") return;
            this.showHoverPreview(e, item);
          };
          row.onmouseleave = () => {
            this.hideHoverPreview();
          };
          const leftCol = row.createDiv({
            attr: { style: "display: flex; align-items: center; min-width: 0; flex: 1; margin-right: 12px;" }
          });
          const badgeText = item.source === "local" ? t2("analyticsBadgeLocal") : t2("analyticsBadgeRemote");
          leftCol.createSpan({
            text: badgeText,
            attr: { style: "font-size: 11px; font-weight: 500; margin-right: 6px; flex-shrink: 0;" }
          });
          leftCol.createSpan({
            text: item.path,
            attr: { style: "font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0;" }
          });
          if (item.isReferenced) {
            leftCol.createSpan({
              text: `[${t2("analyticsRefUsed")}]`,
              attr: { style: "font-size: 10px; color: var(--text-muted); margin-left: 6px; flex-shrink: 0;" }
            });
          } else {
            leftCol.createSpan({
              text: `[${t2("analyticsRefUnused")}]`,
              attr: { style: "font-size: 10px; color: var(--text-warning, #f59e0b); margin-left: 6px; flex-shrink: 0;" }
            });
          }
          row.createSpan({
            text: formatBytes(item.size),
            attr: { style: "font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; font-family: var(--font-monospace); color: var(--text-muted); flex-shrink: 0;" }
          });
        }
      };
      const addFilterBtn = (filterKey, label) => {
        const btn = filterGroup.createEl("button", {
          text: label,
          attr: {
            style: `font-size: 10px; line-height: 1; padding: 2px 7px; height: 20px; border: none; border-radius: 4px; cursor: pointer; transition: all 0.15s ease; background: ${currentFilter === filterKey ? "var(--background-primary)" : "transparent"}; color: ${currentFilter === filterKey ? "var(--text-normal)" : "var(--text-muted)"}; font-weight: ${currentFilter === filterKey ? "600" : "normal"}; box-shadow: ${currentFilter === filterKey ? "0 1px 2px rgba(0,0,0,0.1)" : "none"};`
          }
        });
        btn.onclick = () => {
          currentFilter = filterKey;
          for (const child of filterGroup.children) {
            child.style.background = "transparent";
            child.style.color = "var(--text-muted)";
            child.style.fontWeight = "normal";
            child.style.boxShadow = "none";
          }
          btn.style.background = "var(--background-primary)";
          btn.style.color = "var(--text-normal)";
          btn.style.fontWeight = "600";
          btn.style.boxShadow = "0 1px 2px rgba(0,0,0,0.1)";
          renderList();
        };
      };
      addFilterBtn("all", `${t2("analyticsFilterAll")} (${allTop.length})`);
      const localCount = allTop.filter((i) => i.source === "local").length;
      const remoteCount = allTop.filter((i) => i.source === "remote").length;
      addFilterBtn("local", `${t2("analyticsFilterLocal")} (${localCount})`);
      addFilterBtn("remote", `${t2("analyticsFilterRemote")} (${remoteCount})`);
      renderList();
    }
    const btnRow = contentEl.createDiv({ cls: "fm-btn-row" });
    const exportBtn = btnRow.createEl("button", {
      text: t2("analyticsExportReport"),
      cls: "mod-cta"
    });
    exportBtn.onclick = async () => {
      await exportAnalyticsReportToRoot(this.plugin, s);
    };
    const closeBtn = btnRow.createEl("button", { text: t2(this.fromHub ? "btnCancel" : "closeBtn") });
    closeBtn.onclick = () => returnToHub(this);
  }
  showHoverPreview(e, item) {
    this.hideHoverPreview();
    let src = "";
    if (item.source === "local") {
      const file = this.app.vault.getAbstractFileByPath(item.path);
      if (file) src = this.app.vault.getResourcePath(file);
    } else {
      const cleanServer = this.plugin.settings.serverUrl ? this.plugin.settings.serverUrl.replace(/\/$/, "") : "";
      const webpPath = String(item.path || "").replace(/\.[^.]+$/, ".webp");
      src = item.pubUrl || (cleanServer ? `${cleanServer}/pub/${webpPath}` : "") || item.rawUrl || (cleanServer ? `${cleanServer}/raw/${item.path}` : "");
    }
    if (!src) return;
    const popover = document.createElement("div");
    popover.className = "fm-hover-preview-popover";
    popover.style.cssText = `
      position: fixed;
      left: ${Math.min(window.innerWidth - 180, e.clientX + 16)}px;
      top: ${Math.min(window.innerHeight - 160, Math.max(10, e.clientY - 60))}px;
      z-index: 99999;
      pointer-events: none;
      background: var(--background-secondary);
      border: 1px solid var(--background-modifier-border);
      border-radius: 8px;
      padding: 4px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
      animation: fm-fade-in 0.15s ease-out;
    `;
    const img = document.createElement("img");
    img.src = src;
    img.style.cssText = "max-width: 150px; max-height: 130px; display: block; border-radius: 5px; object-fit: contain;";
    img.onerror = () => {
      if (item.rawUrl && img.src !== item.rawUrl) {
        img.src = item.rawUrl;
      } else {
        this.hideHoverPreview();
      }
    };
    popover.appendChild(img);
    document.body.appendChild(popover);
    this.hoverPopover = popover;
  }
  hideHoverPreview() {
    if (this.hoverPopover) {
      this.hoverPopover.remove();
      this.hoverPopover = null;
    }
  }
  onClose() {
    this.hideHoverPreview();
    this.contentEl.empty();
  }
};

// src/settings-tab.js
var import_obsidian22 = require("obsidian");
var FileMasterSettingTab = class extends import_obsidian22.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.activePage = "home";
  }
  createHeading(containerEl, tag, icon, label) {
    const heading = containerEl.createEl(tag, { cls: "fm-settings-heading" });
    heading.createSpan({ cls: "fm-settings-heading-icon", text: icon, attr: { "aria-hidden": "true" } });
    heading.createSpan({ text: label });
    return heading;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("fm-settings");
    const pages = {
      general: "tabGeneral",
      server: "tabServer",
      upload: "tabUpload",
      exemptions: "tabExemptions",
      about: "aboutTitle"
    };
    const pageIcons = {
      general: "\u2699\uFE0F",
      server: "\u{1F5A5}\uFE0F",
      upload: "\u{1F4CE}",
      exemptions: "\u{1F6E1}\uFE0F",
      about: "\u2139\uFE0F"
    };
    if (this.activePage === "home" || !pages[this.activePage]) {
      this.activePage = "home";
      this.renderSettingsHome(containerEl);
      return;
    }
    const header = containerEl.createDiv({ cls: "fm-settings-page-header" });
    const back = header.createEl("button", {
      cls: "clickable-icon fm-settings-back",
      attr: { "aria-label": this.plugin.t("settingsBack") }
    });
    (0, import_obsidian22.setIcon)(back, "arrow-left");
    back.onclick = () => {
      this.activePage = "home";
      this.display();
    };
    this.createHeading(header, "h2", pageIcons[this.activePage], this.plugin.t(pages[this.activePage]));
    const section = containerEl.createDiv({ cls: "fm-settings-section" });
    if (this.activePage === "general") this.renderGeneralSettings(section);
    if (this.activePage === "server") this.renderServerSettings(section);
    if (this.activePage === "upload") this.renderUploadSettings(section);
    if (this.activePage === "exemptions") this.renderExemptionsSettings(section);
    if (this.activePage === "about") {
      section.addClass("fm-settings-about");
      this.renderAboutFooter(section);
    }
  }
  renderSettingsHome(containerEl) {
    const group = (title, icon, entries) => {
      var _a;
      const section = containerEl.createDiv({ cls: "fm-settings-nav-section" });
      this.createHeading(section, "h3", icon, this.plugin.t(title));
      const list = section.createDiv({ cls: "fm-settings-nav-list" });
      for (const [page, label, icon2] of entries) {
        const setting = new import_obsidian22.Setting(list).setName(this.plugin.t(label));
        const row = setting.settingEl;
        row.addClass("fm-settings-nav-item");
        (_a = setting.descEl) == null ? void 0 : _a.remove();
        row.setAttribute("role", "button");
        row.setAttribute("tabindex", "0");
        const iconEl = setting.nameEl.createSpan({ cls: "fm-settings-nav-icon" });
        (0, import_obsidian22.setIcon)(iconEl, icon2);
        setting.nameEl.prepend(iconEl);
        (0, import_obsidian22.setIcon)(setting.controlEl.createSpan({ cls: "fm-settings-nav-chevron" }), "chevron-right");
        const open = () => {
          if (page === "hub") {
            openModalSafely(new FileMasterHubModal(this.app, this.plugin));
            return;
          }
          if (page === "logs") {
            openModalSafely(new OperationLogModal(this.app, this.plugin));
            return;
          }
          this.activePage = page;
          this.display();
          containerEl.scrollTop = 0;
        };
        row.onclick = open;
        row.onkeydown = (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            open();
          }
        };
      }
    };
    group("settingsCoreGroup", "\u26A1", [
      ["upload", "tabUpload", "paperclip"],
      ["server", "tabServer", "server"]
    ]);
    group("settingsPreferencesGroup", "\u2699\uFE0F", [
      ["general", "tabGeneral", "sliders-horizontal"],
      ["exemptions", "tabExemptions", "shield"]
    ]);
    group("settingsToolsGroup", "\u{1F9F0}", [
      ["hub", "openHubName", "wrench"],
      ["logs", "opLogTitle", "file-text"]
    ]);
    group("settingsInfoGroup", "\u2139\uFE0F", [
      ["about", "aboutTitle", "info"]
    ]);
  }
  renderGeneralSettings(containerEl) {
    new import_obsidian22.Setting(containerEl).setName(this.plugin.t("langName")).setDesc(this.plugin.t("langDesc")).addDropdown(
      (drop) => drop.addOption("auto", this.plugin.t("langAuto")).addOption("zh", "\u7B80\u4F53\u4E2D\u6587").addOption("en", "English").setValue(this.plugin.settings.language || "auto").onChange(async (value) => {
        this.plugin.settings.language = value;
        await this.plugin.saveSettings();
        onLanguageChange(this.plugin);
        this.display();
      })
    );
    new import_obsidian22.Setting(containerEl).setName(this.plugin.t("sidebarBtnName")).setDesc(this.plugin.t("sidebarBtnDesc")).addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.enableSidebarButton !== false).onChange(async (value) => {
        this.plugin.settings.enableSidebarButton = value;
        await this.plugin.saveSettings();
        updateSidebarRibbonButton(this.plugin);
      })
    );
  }
  renderServerSettings(containerEl) {
    new import_obsidian22.Setting(containerEl).setName(this.plugin.t("enableRemoteServerName")).setDesc(this.plugin.t("enableRemoteServerDesc")).addToggle(
      (toggle) => toggle.setValue(Boolean(this.plugin.settings.enableRemoteServer)).onChange(async (value) => {
        this.plugin.settings.enableRemoteServer = value;
        if (!value) {
          this.plugin.settings.serverVerified = false;
          this.plugin.lastServerCompatStatus = null;
        }
        await this.plugin.saveSettings();
        this.display();
      })
    );
    if (!this.plugin.settings.enableRemoteServer) {
      const hint = containerEl.createDiv({ cls: "fm-settings-hint" });
      hint.setText(this.plugin.t("serverDisabledHint"));
      return;
    }
    new import_obsidian22.Setting(containerEl).setName(this.plugin.t("serverUrlName")).setDesc(this.plugin.t("serverUrlDesc")).addText(
      (text) => text.setPlaceholder("https://files.example.com").setValue(this.plugin.settings.serverUrl).onChange(async (value) => {
        this.plugin.settings.serverUrl = value.trim();
        this.plugin.settings.serverVerified = false;
        this.plugin.lastServerCompatStatus = null;
        updateStatusBox(null);
        await this.plugin.saveSettings();
      })
    );
    let statusBox;
    const updateStatusBox = (compat) => {
      if (!statusBox) return;
      statusBox.dataset.status = !compat ? this.plugin.settings.serverVerified ? "success" : "pending" : compat.ok ? "success" : compat.status === "server_outdated" ? "pending" : "error";
      statusBox.textContent = getCompatibilityMessage(this.plugin, compat);
    };
    let tokenInput;
    new import_obsidian22.Setting(containerEl).setName(this.plugin.t("apiTokenName")).setDesc(this.plugin.t("apiTokenDesc")).addText((text) => {
      tokenInput = text.inputEl;
      tokenInput.type = "password";
      text.setPlaceholder("API token").setValue(this.plugin.settings.apiToken).onChange(async (value) => {
        this.plugin.settings.apiToken = value.trim();
        this.plugin.settings.serverVerified = false;
        this.plugin.lastServerCompatStatus = null;
        updateStatusBox(null);
        await this.plugin.saveSettings();
      });
    }).addExtraButton((btn) => btn.setIcon("eye").setTooltip(this.plugin.t("showToken")).onClick(() => {
      const hidden = tokenInput.type === "password";
      tokenInput.type = hidden ? "text" : "password";
      btn.setIcon(hidden ? "eye-off" : "eye");
      btn.setTooltip(this.plugin.t(hidden ? "hideToken" : "showToken"));
    }));
    const connectionRow = containerEl.createDiv({ cls: "fm-settings-connection-row" });
    statusBox = connectionRow.createDiv({ cls: "fm-server-compat-banner" });
    updateStatusBox(this.plugin.lastServerCompatStatus);
    new import_obsidian22.Setting(connectionRow).addButton(
      (btn) => btn.setButtonText(this.plugin.t("btnTestConn")).onClick(async () => {
        btn.disabled = true;
        btn.setButtonText(this.plugin.t("compatStatusChecking"));
        statusBox.dataset.status = "pending";
        statusBox.textContent = this.plugin.t("compatStatusChecking");
        let compat;
        try {
          compat = await checkServerCompatibility(this.plugin);
          updateStatusBox(compat);
          new import_obsidian22.Notice(getCompatibilityMessage(this.plugin, compat));
        } finally {
          btn.disabled = false;
          btn.setButtonText(this.plugin.t("btnTestConn"));
        }
        if (compat) this.display();
      })
    );
  }
  renderUploadSettings(containerEl) {
    new import_obsidian22.Setting(containerEl).setName(this.plugin.t("clipboardMonitorName")).setDesc(this.plugin.t("clipboardMonitorDesc")).addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.enableClipboardMonitor !== false).onChange(async (value) => {
        this.plugin.settings.enableClipboardMonitor = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian22.Setting(containerEl).setName(this.plugin.t("saveLocationName")).setDesc(this.plugin.t("saveLocationDesc")).addDropdown(
      (drop) => drop.addOption("ask", this.plugin.t("optSaveAsk")).addOption("remote", this.plugin.t("optSaveRemote")).addOption("local", this.plugin.t("optSaveLocal")).setValue(this.plugin.settings.saveLocationMode).onChange(async (value) => {
        this.plugin.settings.saveLocationMode = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian22.Setting(containerEl).setName(this.plugin.t("defaultSaveLocationName")).setDesc(this.plugin.t("defaultSaveLocationDesc")).addDropdown(
      (drop) => drop.addOption("remote", this.plugin.t("destSaveRemote")).addOption("local", this.plugin.t("destSaveLocal")).setValue(this.plugin.settings.defaultSaveLocation || "remote").onChange(async (value) => {
        this.plugin.settings.defaultSaveLocation = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian22.Setting(containerEl).setName(this.plugin.t("insertOptimizedName")).setDesc(this.plugin.t("insertOptimizedDesc")).addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.insertOptimizedLinkOnUpload).onChange(async (value) => {
        this.plugin.settings.insertOptimizedLinkOnUpload = value;
        await this.plugin.saveSettings();
      })
    );
    let patternSetting = null;
    new import_obsidian22.Setting(containerEl).setName(this.plugin.t("namingStrategyName")).setDesc(this.plugin.t("namingStrategyDesc")).addDropdown(
      (drop) => drop.addOption("keep", this.plugin.t("optNamingKeep")).addOption("rule", this.plugin.t("optNamingRule")).addOption("prompt", this.plugin.t("optNamingPrompt")).setValue(this.plugin.settings.namingMode || "keep").onChange(async (value) => {
        this.plugin.settings.namingMode = value;
        await this.plugin.saveSettings();
        if (patternSetting && patternSetting.settingEl) {
          patternSetting.settingEl.style.display = value === "rule" ? "" : "none";
        }
      })
    );
    patternSetting = new import_obsidian22.Setting(containerEl).setName(this.plugin.t("namingPatternName")).setDesc(this.plugin.t("namingPatternDesc")).addText(
      (text) => text.setPlaceholder("{note}_{date}_{rand:4}").setValue(this.plugin.settings.namingPattern || "{note}_{date}_{rand:4}").onChange(async (value) => {
        this.plugin.settings.namingPattern = value.trim() || "{note}_{date}_{rand:4}";
        await this.plugin.saveSettings();
      })
    );
    if (patternSetting.settingEl) {
      patternSetting.settingEl.style.display = this.plugin.settings.namingMode === "rule" ? "" : "none";
    }
    new import_obsidian22.Setting(containerEl).setName(this.plugin.t("uploadNonImageName")).setDesc(this.plugin.t("uploadNonImageDesc")).addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.uploadNonImageAttachments !== false).onChange(async (value) => {
        this.plugin.settings.uploadNonImageAttachments = value;
        await this.plugin.saveSettings();
      })
    );
  }
  renderExemptionsSettings(containerEl) {
    new import_obsidian22.Setting(containerEl).setName(this.plugin.t("excludedFoldersName")).setDesc(this.plugin.t("excludedFoldersDesc")).addText(
      (text) => text.setPlaceholder("").setValue(this.plugin.settings.excludedLocalFolders).onChange(async (value) => {
        this.plugin.settings.excludedLocalFolders = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian22.Setting(containerEl).setName(this.plugin.t("excludeLockedRemoteName")).setDesc(this.plugin.t("excludeLockedRemoteDesc")).addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.excludeLockedRemoteFiles).onChange(async (value) => {
        this.plugin.settings.excludeLockedRemoteFiles = value;
        await this.plugin.saveSettings();
      })
    );
  }
  renderAboutFooter(containerEl) {
    const manifest = this.plugin.manifest || {};
    const version = displayVersion(manifest.version || "0.1.1");
    const author = manifest.author || "weichen-ink";
    const authorUrl = manifest.authorUrl || "https://github.com/weichen-ink";
    const repoUrl = "https://github.com/weichen-ink/file-master";
    const intro = new import_obsidian22.Setting(containerEl).setName("File Master").setDesc(this.plugin.t("aboutDesc"));
    intro.controlEl.createSpan({ text: `v${version}` });
    const addRow = (label) => new import_obsidian22.Setting(containerEl).setName(this.plugin.t(label)).controlEl;
    addRow("aboutAuthor").createEl("a", { text: author, href: authorUrl, attr: { target: "_blank", rel: "noopener noreferrer" } });
    addRow("aboutRepo").createEl("a", { text: "weichen-ink/file-master", href: repoUrl, attr: { target: "_blank", rel: "noopener noreferrer" } });
    addRow("aboutServerCompat").createSpan({ text: `v${MIN_SERVER_VERSION}+` });
    const sCompat = this.plugin.lastServerCompatStatus;
    addRow("aboutServerStatus").createSpan({
      cls: `fm-about-status ${(sCompat == null ? void 0 : sCompat.ok) ? "is-connected" : ""}`,
      text: sCompat ? getCompatibilityMessage(this.plugin, sCompat) : this.plugin.t("aboutServerOffline")
    });
    new import_obsidian22.Setting(containerEl).setName(this.plugin.t("opLogTitle")).setDesc(this.plugin.t("opLogDesc")).addButton(
      (btn) => btn.setButtonText(this.plugin.t("opLogBtnOpen")).onClick(() => {
        openModalSafely(new OperationLogModal(this.app, this.plugin));
      })
    );
    addRow("aboutFeedback").createEl("a", { text: this.plugin.t("aboutFeedbackLink"), href: `${repoUrl}/issues`, attr: { target: "_blank", rel: "noopener noreferrer" } });
  }
};

// src/plugin/lifecycle.js
var import_obsidian23 = require("obsidian");
async function onload(plugin) {
  await plugin.loadSettings();
  plugin.operationLogs = [];
  await loadOperationLogs(plugin);
  plugin.heicPreviewCache = /* @__PURE__ */ new Map();
  plugin.sidebarRibbonEl = null;
  plugin.lastServerCompatStatus = null;
  plugin.lastActiveMarkdownView = null;
  plugin.referenceRevision = 0;
  for (const event of ["create", "modify", "delete", "rename"]) {
    plugin.registerEvent(plugin.app.vault.on(event, (file) => {
      if (isScannableDocFile(plugin, file)) plugin.referenceRevision++;
    }));
  }
  updateSidebarRibbonButton(plugin);
  plugin.registerView(
    VIEW_TYPE_REMOTE_GALLERY,
    (leaf) => new RemoteGalleryView(leaf, plugin)
  );
  plugin.registerEvent(
    plugin.app.workspace.on("active-leaf-change", (leaf) => {
      if ((leaf == null ? void 0 : leaf.view) instanceof import_obsidian23.MarkdownView) {
        plugin.lastActiveMarkdownView = leaf.view;
      }
    })
  );
  plugin.registerEvent(
    plugin.app.workspace.on("file-open", () => {
      const mdView = plugin.app.workspace.getActiveViewOfType(import_obsidian23.MarkdownView);
      if (mdView) {
        plugin.lastActiveMarkdownView = mdView;
      }
    })
  );
  plugin.app.workspace.onLayoutReady(() => {
    const activeMd = plugin.app.workspace.getActiveViewOfType(import_obsidian23.MarkdownView);
    if (activeMd) {
      plugin.lastActiveMarkdownView = activeMd;
    }
    if (!import_obsidian23.Platform.isMobile) initGalleryLeaf(plugin, false).catch((error) => new import_obsidian23.Notice(error.message));
  });
  setTimeout(() => {
    checkServerCompatibility(plugin).catch(() => {
    });
  }, 1200);
  plugin.registerEvent(
    plugin.app.workspace.on("editor-paste", async (evt, editor) => {
      var _a;
      if (!plugin.settings.enableClipboardMonitor) return;
      const files = (_a = evt.clipboardData) == null ? void 0 : _a.files;
      if (!files || files.length === 0) return;
      const targetFiles = filterAllowedFiles(plugin.settings, files);
      if (targetFiles.length === 0) return;
      evt.preventDefault();
      for (const f of targetFiles) {
        await handleIncomingBrowserFile(plugin, f, editor);
      }
    })
  );
  plugin.registerEvent(
    plugin.app.workspace.on("editor-drop", async (evt, editor) => {
      var _a;
      if (!plugin.settings.enableClipboardMonitor) return;
      const files = (_a = evt.dataTransfer) == null ? void 0 : _a.files;
      if (!files || files.length === 0) return;
      const targetFiles = filterAllowedFiles(plugin.settings, files);
      if (targetFiles.length === 0) return;
      evt.preventDefault();
      for (const f of targetFiles) {
        await handleIncomingBrowserFile(plugin, f, editor);
      }
    })
  );
  setupHeicInlinePreviewObserver(plugin);
  registerContextMenus(plugin);
  registerPluginCommands(plugin);
  plugin.addSettingTab(new FileMasterSettingTab(plugin.app, plugin));
  console.log("[FileMaster] Plugin loaded successfully");
}
function registerPluginCommands(plugin) {
  plugin.pluginCommandDefs = [
    {
      id: "resume-pending-upload",
      nameKey: "cmdResumeUpload",
      requiresRemote: true,
      callback: () => resumePendingMigration(plugin).catch((err) => new import_obsidian23.Notice(err.message))
    },
    {
      id: "open-control-center",
      nameKey: "cmdOpenHub",
      callback: () => openModalSafely(new FileMasterHubModal(plugin.app, plugin))
    },
    {
      id: "open-health-check-wizard",
      nameKey: "cmdScanHealth",
      callback: () => openModalSafely(new HealthCheckModal(plugin.app, plugin))
    },
    {
      id: "open-orphan-wizard",
      nameKey: "cmdScanOrphan",
      callback: () => openModalSafely(new OrphanWizardModal(plugin.app, plugin))
    },
    {
      id: "open-duplicate-wizard",
      nameKey: "cmdScanDuplicate",
      callback: () => openModalSafely(new DuplicateWizardModal(plugin.app, plugin))
    },
    {
      id: "open-remote-gallery",
      nameKey: "cmdRemoteGallery",
      requiresRemote: true,
      callback: () => openModalSafely(new RemoteGalleryModal(plugin.app, plugin))
    },
    {
      id: "open-remote-gallery-view",
      nameKey: "cmdRemoteGalleryView",
      requiresRemote: true,
      callback: () => activateGalleryView(plugin)
    },
    {
      id: "open-batch-migrate-wizard",
      nameKey: "cmdBatchMigrate",
      requiresRemote: true,
      callback: () => openModalSafely(new BatchMigrateWizardModal(plugin.app, plugin))
    },
    {
      id: "open-vault-analytics-dashboard",
      nameKey: "cmdVaultAnalytics",
      callback: () => openModalSafely(new VaultAnalyticsModal(plugin.app, plugin))
    },
    {
      id: "migrate-current-note-attachments",
      nameKey: "cmdMigrateActiveNote",
      requiresRemote: true,
      callback: () => migrateActiveNoteAttachments(plugin)
    },
    {
      id: "download-current-note-remote-attachments",
      nameKey: "cmdDownloadActiveNote",
      requiresRemote: true,
      callback: () => downloadActiveNoteRemoteAttachments(plugin)
    },
    {
      id: "copy-note-with-astro-pub-links",
      nameKey: "cmdCopyAstroLinks",
      requiresRemote: true,
      callback: () => copyActiveNoteForAstro(plugin)
    },
    {
      id: "open-operation-logs",
      nameKey: "cmdOpenOpLogs",
      callback: () => openModalSafely(new OperationLogModal(plugin.app, plugin))
    }
  ];
  for (const cmd of plugin.pluginCommandDefs) {
    plugin.addCommand({
      id: cmd.id,
      name: plugin.t(cmd.nameKey),
      checkCallback: (checking) => {
        if (cmd.requiresRemote && !plugin.isRemoteServerReady()) {
          return false;
        }
        if (checking) return true;
        cmd.callback();
      }
    });
  }
}
function updateCommandNames(plugin) {
  var _a, _b;
  if (!plugin.pluginCommandDefs || !((_b = (_a = plugin.app) == null ? void 0 : _a.commands) == null ? void 0 : _b.commands)) return;
  for (const cmd of plugin.pluginCommandDefs) {
    const fullId = `${plugin.manifest.id}:${cmd.id}`;
    const registered = plugin.app.commands.commands[fullId];
    if (registered) {
      registered.name = plugin.t(cmd.nameKey);
    }
  }
}
function onLanguageChange(plugin) {
  var _a, _b, _c, _d, _e, _f;
  updateSidebarRibbonButton(plugin);
  updateCommandNames(plugin);
  for (const leaf of ((_c = (_b = (_a = plugin.app) == null ? void 0 : _a.workspace) == null ? void 0 : _b.getLeavesOfType) == null ? void 0 : _c.call(_b, VIEW_TYPE_REMOTE_GALLERY)) || []) {
    if ((_d = leaf.view) == null ? void 0 : _d.rebuild) leaf.view.rebuild();
    else (_f = (_e = leaf.view) == null ? void 0 : _e.render) == null ? void 0 : _f.call(_e);
  }
}
function getCompatibilityMessage(plugin, compat) {
  if (!compat) return plugin.t(plugin.settings.serverVerified ? "serverVerifiedBadge" : "serverUnverifiedHint");
  switch (compat.status) {
    case "compatible":
      return plugin.t("compatStatusOk", { serverVer: compat.serverVersion, count: compat.assetCount || 0 });
    case "server_outdated":
      return plugin.t("compatStatusServerOld", { serverVer: compat.serverVersion, minServerVer: compat.minServerVersion });
    case "plugin_outdated":
      return plugin.t("compatStatusPluginOld", { minPluginVer: compat.minPluginVersion, currentVer: compat.pluginVersion });
    case "auth_failed":
      return plugin.t("compatStatusAuthFail");
    case "token_missing":
      return plugin.t("compatStatusTokenMissing");
    case "server_error":
      return plugin.t("compatStatusServerError", { code: compat.statusCode || "" });
    default:
      return plugin.t("compatStatusOffline", { err: compat.error || "" });
  }
}
function onunload(plugin) {
  var _a, _b;
  (_a = plugin.activeTransferController) == null ? void 0 : _a.abort();
  (_b = plugin.galleryStore) == null ? void 0 : _b.clear();
  if (plugin.sidebarRibbonEl) {
    plugin.sidebarRibbonEl.remove();
    plugin.sidebarRibbonEl = null;
  }
  if (plugin.heicObserver) {
    plugin.heicObserver.disconnect();
    plugin.heicObserver = null;
  }
}
async function initGalleryLeaf(plugin, reveal = false) {
  if (!plugin.isRemoteServerReady()) return null;
  const { workspace } = plugin.app;
  if (!plugin.galleryLeafPromise) {
    const pending = (async () => {
      let leaf2 = workspace.getLeavesOfType(VIEW_TYPE_REMOTE_GALLERY)[0];
      if (!leaf2) {
        leaf2 = workspace.getRightLeaf(false);
        if (!leaf2) throw new Error(plugin.t("galleryPanelUnavailable"));
        await leaf2.setViewState({ type: VIEW_TYPE_REMOTE_GALLERY, active: false });
      }
      return leaf2;
    })();
    plugin.galleryLeafPromise = pending;
    pending.finally(() => {
      if (plugin.galleryLeafPromise === pending) plugin.galleryLeafPromise = null;
    }).catch(() => {
    });
  }
  const leaf = await plugin.galleryLeafPromise;
  if (reveal && leaf) await workspace.revealLeaf(leaf);
  return leaf;
}
async function activateGalleryView(plugin) {
  if (!plugin.isRemoteServerReady()) {
    new import_obsidian23.Notice(plugin.t("remoteServerRequiredNotice"));
    return;
  }
  if (import_obsidian23.Platform.isMobile) return openModalSafely(new RemoteGalleryModal(plugin.app, plugin));
  return initGalleryLeaf(plugin, true);
}
function insertMarkdownToActiveEditor(plugin, mdSnippet, successNotice, target = void 0) {
  if (target !== void 0 && !isInsertionTargetValid(plugin, target)) {
    new import_obsidian23.Notice(plugin.t("galleryOpenNoteFirst"));
    return false;
  }
  let mdView = (target == null ? void 0 : target.view) || plugin.app.workspace.getActiveViewOfType(import_obsidian23.MarkdownView);
  if (!mdView && plugin.lastActiveMarkdownView) {
    const leaves = plugin.app.workspace.getLeavesOfType("markdown");
    if (leaves.some((l) => l.view === plugin.lastActiveMarkdownView)) {
      mdView = plugin.lastActiveMarkdownView;
    }
  }
  if (!mdView) {
    const leaves = plugin.app.workspace.getLeavesOfType("markdown");
    if (leaves.length > 0) {
      const visibleLeaf = leaves.find((l) => {
        var _a, _b, _c;
        return ((_a = l.view) == null ? void 0 : _a.containerEl) && ((_c = (_b = l.view.containerEl).isShown) == null ? void 0 : _c.call(_b)) !== false;
      });
      mdView = (visibleLeaf || leaves[0]).view;
    }
  }
  const activeFile = (mdView == null ? void 0 : mdView.file) || plugin.app.workspace.getActiveFile();
  if (!activeFile || activeFile.extension !== "md") {
    new import_obsidian23.Notice(plugin.t("galleryOpenNoteFirst") || "Please open a Markdown note first");
    return false;
  }
  if (mdView == null ? void 0 : mdView.editor) {
    const editor = mdView.editor;
    if ((target == null ? void 0 : target.content) !== void 0 && target.content !== editor.getValue()) {
      new import_obsidian23.Notice(plugin.t("galleryTargetChanged"));
      return false;
    }
    if ((target == null ? void 0 : target.from) && (target == null ? void 0 : target.to)) {
      editor.replaceRange(mdSnippet, target.from, target.to);
      const lines = mdSnippet.split("\n");
      editor.setCursor({ line: target.from.line + lines.length - 1, ch: lines.length === 1 ? target.from.ch + lines[0].length : lines.at(-1).length });
    } else editor.replaceSelection(mdSnippet);
    if (target) refreshInsertionTarget(target);
    if (mdView.leaf) {
      plugin.app.workspace.setActiveLeaf(mdView.leaf, { focus: true });
    }
    editor.focus();
    if (successNotice) new import_obsidian23.Notice(successNotice);
    return true;
  } else {
    safeModifyFileContent(plugin, activeFile, (content) => content + "\n" + mdSnippet).then(() => {
      if (successNotice) new import_obsidian23.Notice(successNotice);
    });
    return true;
  }
}

// src/modals/remote-trash.js
var import_obsidian24 = require("obsidian");
var RemoteTrashModal = class extends FileMasterModal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.generation = 0;
  }
  t(key, params) {
    return this.plugin.t(key, params);
  }
  onOpen() {
    this.closed = false;
    this.modalEl.addClass("fm-ui", "fm-trash-dialog");
    modalChrome(this);
    this.contentEl.addClass("fm-trash-browser");
    return this.load();
  }
  async load() {
    const generation = ++this.generation;
    this.contentEl.empty();
    moduleHeading(this, this.contentEl, { title: "remoteTrashTitle", symbol: "trash-2" });
    this.contentEl.createDiv({ text: this.t("remoteTrashLoading"), cls: "fm-browser-status" });
    try {
      const items = await this.plugin.fetchRemoteTrash();
      if (this.closed || generation !== this.generation) return;
      this.contentEl.empty();
      moduleHeading(this, this.contentEl, { title: "remoteTrashTitle", symbol: "trash-2" });
      if (!items.length) {
        this.contentEl.createDiv({ text: this.t("remoteTrashEmpty"), cls: "fm-empty-state" });
        return;
      }
      const list = this.contentEl.createDiv({ cls: "fm-trash-list" });
      for (const item of items) this.renderFile(list, item);
    } catch (error) {
      if (this.closed || generation !== this.generation) return;
      this.contentEl.empty();
      moduleHeading(this, this.contentEl, { title: "remoteTrashTitle", symbol: "trash-2" });
      const message = /invalid or expired session/i.test(error.message) ? this.t("remoteTrashSessionError") : /401|invalid API token|unauthorized/i.test(error.message) ? this.t("remoteTrashAuthError") : error.message;
      this.contentEl.createEl("p", { text: message, cls: "fm-asset-hint" });
      const retry = this.contentEl.createEl("button", { text: this.t("previewRetry") });
      retry.onclick = () => this.load();
    } finally {
      if (this.fromHub && !this.closed && generation === this.generation) {
        const footer = this.contentEl.createDiv({ cls: "fm-btn-row" });
        footer.createEl("button", { text: this.t("btnCancel") }).onclick = () => this.returnToHub();
      }
    }
  }
  renderFile(list, item) {
    const row = list.createDiv({ cls: "fm-trash-row" });
    (0, import_obsidian24.setIcon)(row.createSpan({ cls: "fm-trash-icon" }), "file");
    const info = row.createDiv({ cls: "fm-trash-file" });
    info.createDiv({ text: item.filename, cls: "fm-trash-name" });
    info.createDiv({ text: `${formatBytes(item.size)} \xB7 ${new Date(item.deletedAt).toLocaleString()}`, cls: "fm-gallery-meta" });
    const actions = row.createDiv({ cls: "fm-trash-actions" });
    const restore = actions.createEl("button", { text: this.t("remoteTrashRestore"), attr: { type: "button" } });
    const remove = actions.createEl("button", { text: this.t("remoteTrashDelete"), cls: "fm-trash-delete", attr: { type: "button" } });
    let busy = false;
    const setBusy = (value) => {
      busy = value;
      restore.disabled = value;
      remove.disabled = value;
    };
    const failure = (error) => {
      if (!this.closed) {
        new import_obsidian24.Notice(error.message || this.t("remoteTrashFailed"));
        setBusy(false);
      }
    };
    restore.onclick = async () => {
      if (busy || this.closed) return;
      setBusy(true);
      try {
        await this.plugin.restoreRemoteTrash(item.id);
        galleryStore(this.plugin).load(true);
        if (!this.closed) {
          new import_obsidian24.Notice(this.t("remoteTrashRestored"));
          await this.load();
        }
      } catch (error) {
        failure(error);
      }
    };
    remove.onclick = async () => {
      if (busy || this.closed) return;
      setBusy(true);
      const confirm = new ConfirmActionModal(
        this.app,
        this.t("remoteTrashDeleteTitle"),
        this.t("remoteTrashDeleteConfirm", { name: item.filename }),
        this.t("remoteTrashDelete"),
        async (confirmed) => {
          if (!confirmed || this.closed) {
            setBusy(false);
            return;
          }
          try {
            await this.plugin.permanentlyDeleteRemoteTrash(item.id);
            if (!this.closed) {
              new import_obsidian24.Notice(this.t("remoteTrashDeleted"));
              await this.load();
            }
          } catch (error) {
            failure(error);
          }
        },
        this.plugin
      );
      try {
        await openModal(confirm);
      } catch (error) {
        failure(error);
      }
    };
  }
  onClose() {
    this.closed = true;
    this.generation++;
    this.contentEl.empty();
  }
};

// src/modals/active-note.js
var import_obsidian25 = require("obsidian");
var ActiveNoteActionModal = class extends FileMasterModal {
  constructor(app, plugin, targetFile, actionType = "migrate", options = {}) {
    var _a;
    super(app);
    this.plugin = plugin;
    this.targetFile = targetFile;
    this.actionType = actionType;
    this.fromHub = Boolean(options == null ? void 0 : options.fromHub);
    this.step = "loading";
    this.items = [];
    this.deleteLocalAfter = Boolean((_a = plugin == null ? void 0 : plugin.settings) == null ? void 0 : _a.deleteLocalAfterMigrate);
    this.syncOtherNotes = true;
    this.conflictStrategy = "reuse";
    this.hadConflictStep = false;
    this.result = null;
  }
  t(k, p) {
    return this.plugin ? this.plugin.t(k, p) : k;
  }
  getUniqueOtherRefNotes(onlySelected = false) {
    const set = /* @__PURE__ */ new Set();
    for (const item of this.items) {
      if (onlySelected && !item.selected) continue;
      for (const p of item.otherRefNotes || []) {
        set.add(p);
      }
    }
    return [...set];
  }
  async onOpen() {
    this.render();
    if (this.actionType === "migrate") {
      try {
        this.items = await scanActiveNoteLocalAttachments(this.plugin, this.targetFile);
        if (this.transferClosed) return;
        this.step = "preview";
      } catch (err) {
        this.result = { success: false, message: err.message || String(err) };
        this.step = "result";
      }
      this.render();
    } else {
      try {
        this.items = await scanActiveNoteRemoteAttachments(this.plugin, this.targetFile);
        if (this.transferClosed) return;
        if (this.items.length === 0) {
          this.result = { success: true, count: 0, processedItems: [], failures: [] };
          this.step = "result";
          this.render();
          return;
        }
        const hasConflicts = this.items.some((item) => item.hasConflict);
        const hasOtherRefs = this.items.some((item) => {
          var _a;
          return (((_a = item.otherRefNotes) == null ? void 0 : _a.length) || 0) > 0;
        });
        if (hasConflicts || hasOtherRefs) {
          this.hadConflictStep = true;
          this.step = "conflict";
          this.render();
        } else {
          this.step = "running";
          this.render();
          await this.execute(this.items);
        }
      } catch (err) {
        this.result = { success: false, message: err.message || String(err) };
        this.step = "result";
        this.render();
      }
    }
  }
  render() {
    var _a, _b, _c, _d, _e;
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("fm-wizard-modal");
    const upload = this.actionType === "migrate";
    const withSteps = this.items.length > 0 && !["loading", "result"].includes(this.step) && (upload || this.hadConflictStep || this.step === "conflict");
    const step = ["loading", "preview", "conflict"].includes(this.step) ? 1 : 2;
    moduleHeading(this, contentEl, { title: upload ? "actNoteUpTitle" : "actNoteDownTitle", symbol: upload ? "upload" : "download", step: withSteps ? step : null, total: 2 });
    contentEl.createDiv({
      text: `\u{1F4C4} ${this.targetFile.path}`,
      attr: { style: "font-size: 12px; color: var(--text-muted); margin-bottom: 12px;" }
    });
    if (this.step === "loading") {
      const box = contentEl.createDiv({ cls: "fm-section-box" });
      box.createDiv({
        text: this.t("activeNoteScanning"),
        attr: { style: "font-size: 13px; color: var(--text-accent);" }
      });
      return;
    }
    if (this.step === "conflict") {
      const conflictItems = this.items.filter((i) => i.hasConflict);
      const otherRefNotesAll = this.getUniqueOtherRefNotes(false);
      if (conflictItems.length > 0) {
        const warnBanner = contentEl.createDiv({
          cls: "fm-result-banner fm-result-banner-error",
          attr: { style: "margin-bottom: 12px;" }
        });
        warnBanner.createDiv({
          cls: "fm-result-banner-title",
          text: this.t("activeNoteDownConflictTitle", { count: conflictItems.length }),
          attr: { style: "margin-bottom: 0;" }
        });
      } else if (otherRefNotesAll.length > 0) {
        const infoBanner = contentEl.createDiv({
          cls: "fm-result-banner fm-result-banner-instant",
          attr: { style: "margin-bottom: 12px;" }
        });
        infoBanner.createDiv({
          cls: "fm-result-banner-title",
          text: this.t("activeNoteDownOtherRefsTitle", { count: otherRefNotesAll.length }),
          attr: { style: "margin-bottom: 0;" }
        });
      }
      const listEl = contentEl.createDiv({
        cls: "fm-scroll-list",
        attr: { style: "max-height: 220px;" }
      });
      let runBtn = null;
      const updateRunBtnLabel = () => {
        if (!runBtn) return;
        const selectedCount = this.items.filter((i) => i.selected).length;
        runBtn.setText(this.t("activeNoteStartDownload", { count: selectedCount }));
      };
      for (const item of this.items) {
        const row = listEl.createDiv({ cls: "fm-list-item" });
        const left = row.createDiv({
          attr: { style: "display:flex; align-items:center; gap:10px; flex:1; overflow:hidden;" }
        });
        const cb = left.createEl("input", { type: "checkbox", attr: { style: "cursor:pointer;" } });
        cb.checked = item.selected;
        cb.onchange = () => {
          item.selected = cb.checked;
          updateRunBtnLabel();
        };
        renderItemVisualThumb(left, item, this.plugin);
        const nameCol = left.createDiv({
          attr: { style: "display:flex; flex-direction:column; overflow:hidden; flex:1;" }
        });
        nameCol.createSpan({
          text: item.name,
          attr: { style: "overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:500;" }
        });
        const displayPath = item.hasConflict && item.existingFile ? item.existingFile.path : item.idealPath;
        nameCol.createSpan({
          text: `${displayPath}${item.size ? " \xB7 " + formatBytes(item.size) : ""}`,
          attr: { style: "font-size:11px; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" }
        });
        const otherRefs = item.otherRefNotes || [];
        if (otherRefs.length > 0) {
          const rightBox = row.createDiv({
            attr: { style: "display:flex; align-items:center; gap:6px; flex-shrink:0;" }
          });
          const refBadge = rightBox.createSpan({
            text: this.t("activeNoteOtherRefsBadge", { count: otherRefs.length }),
            cls: "fm-tag fm-tag-ref fm-clickable-badge",
            attr: { "aria-label": this.t("activeNoteInspectOtherRefs") }
          });
          refBadge.onclick = (e) => {
            e.stopPropagation();
            new NoteRefsModal(this.app, item.name, otherRefs, () => this.close(), this.plugin).open();
          };
        }
      }
      if (otherRefNotesAll.length > 0 || conflictItems.length > 0) {
        const optionsBox = contentEl.createDiv({
          cls: "fm-section-box",
          attr: { style: "margin-top: 10px; display: flex; flex-direction: column; gap: 10px;" }
        });
        if (otherRefNotesAll.length > 0) {
          const syncLabel = optionsBox.createEl("label", {
            cls: "fm-check-row",
            attr: { style: "margin: 0; cursor: pointer;" }
          });
          const syncCb = syncLabel.createEl("input", { type: "checkbox" });
          syncCb.checked = this.syncOtherNotes;
          syncCb.onchange = () => {
            this.syncOtherNotes = syncCb.checked;
          };
          syncLabel.createSpan({
            text: this.t("activeNoteSyncOtherDownloadOpt", { count: otherRefNotesAll.length })
          });
        }
        if (conflictItems.length > 0) {
          const strategyWrap = optionsBox.createDiv({
            attr: {
              style: otherRefNotesAll.length > 0 ? "border-top: 1px solid var(--background-modifier-border); padding-top: 10px;" : ""
            }
          });
          strategyWrap.createDiv({
            text: this.t("activeNoteDownStrategyTitle"),
            cls: "fm-section-title"
          });
          const strategies = [
            { value: "reuse", label: this.t("activeNoteDownOptReuse") },
            { value: "rename", label: this.t("activeNoteDownOptRename") },
            { value: "overwrite", label: this.t("activeNoteDownOptOverwrite") }
          ];
          for (const st of strategies) {
            const rowLabel = strategyWrap.createEl("label", {
              cls: "fm-check-row",
              attr: { style: "cursor:pointer;" }
            });
            const radio = rowLabel.createEl("input", {
              type: "radio",
              attr: { name: "fm-down-conflict-strategy", value: st.value }
            });
            radio.checked = this.conflictStrategy === st.value;
            radio.onchange = () => {
              if (radio.checked) this.conflictStrategy = st.value;
            };
            rowLabel.createSpan({ text: st.label });
          }
        }
      }
      const btnRow = contentEl.createDiv({ cls: "fm-btn-row" });
      const cancelBtn = btnRow.createEl("button", { text: this.t("btnCancel") });
      cancelBtn.onclick = () => returnToHub(this);
      runBtn = btnRow.createEl("button", {
        text: this.t("activeNoteStartDownload", { count: this.items.filter((i) => i.selected).length }),
        cls: "mod-cta"
      });
      runBtn.onclick = async () => {
        const selected = this.items.filter((i) => i.selected);
        if (selected.length === 0) {
          new import_obsidian25.Notice(this.t("activeNoteSelectRequired"));
          return;
        }
        this.step = "running";
        this.render();
        await this.execute(selected);
      };
      return;
    }
    if (this.step === "preview") {
      if (this.items.length === 0) {
        const emptyBanner = contentEl.createDiv({
          cls: "fm-section-box",
          attr: { style: "text-align: center; padding: 24px 16px;" }
        });
        emptyBanner.createDiv({
          text: this.t("activeNoteNoLocal"),
          attr: { style: "font-size: 14px; color: var(--text-muted);" }
        });
        const btnRow2 = contentEl.createDiv({ cls: "fm-btn-row" });
        const closeBtn = btnRow2.createEl("button", { text: this.t(this.fromHub ? "btnCancel" : "closeBtn") });
        closeBtn.onclick = () => returnToHub(this);
        return;
      }
      contentEl.createEl("p", {
        text: this.t("activeNoteStep1Desc", { count: this.items.length }),
        cls: "fm-step-desc"
      });
      const listEl = contentEl.createDiv({
        cls: "fm-scroll-list",
        attr: { style: "max-height: 240px;" }
      });
      let runBtn = null;
      const updateRunBtnLabel = () => {
        if (!runBtn) return;
        const selectedCount = this.items.filter((i) => i.selected).length;
        runBtn.setText(this.t("activeNoteStartUpload", { count: selectedCount }));
      };
      for (const item of this.items) {
        const row = listEl.createDiv({ cls: "fm-list-item" });
        const left = row.createDiv({
          attr: { style: "display:flex; align-items:center; gap:10px; flex:1; overflow:hidden;" }
        });
        const cb = left.createEl("input", { type: "checkbox", attr: { style: "cursor:pointer;" } });
        cb.checked = item.selected;
        cb.onchange = () => {
          item.selected = cb.checked;
          updateRunBtnLabel();
        };
        renderItemVisualThumb(left, item, this.plugin);
        const nameCol = left.createDiv({
          attr: { style: "display:flex; flex-direction:column; overflow:hidden; flex:1;" }
        });
        nameCol.createSpan({
          text: item.name,
          attr: { style: "overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:500;" }
        });
        nameCol.createSpan({
          text: `${item.displayPath} \xB7 ${formatBytes(item.size)}`,
          attr: { style: "font-size:11px; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" }
        });
        const rightBox = row.createDiv({
          attr: { style: "display:flex; align-items:center; gap:8px; flex-shrink:0;" }
        });
        const otherRefs = item.otherRefNotes || [];
        if (otherRefs.length > 0) {
          const refBadge = rightBox.createSpan({
            text: this.t("activeNoteOtherRefsBadge", { count: otherRefs.length }),
            cls: "fm-tag fm-tag-ref fm-clickable-badge",
            attr: { "aria-label": this.t("activeNoteInspectOtherRefs") }
          });
          refBadge.onclick = (e) => {
            e.stopPropagation();
            new NoteRefsModal(this.app, item.name, otherRefs, () => this.close(), this.plugin).open();
          };
        }
        const lockBtn = rightBox.createEl("button", {
          type: "button",
          cls: "fm-mini-btn",
          text: item.locked ? this.t("activeNoteBtnLockOn") : this.t("activeNoteBtnLockOff"),
          attr: {
            style: item.locked ? "border-color: var(--interactive-accent); color: var(--text-accent); font-weight: 600;" : "color: var(--text-muted);"
          }
        });
        lockBtn.onclick = (e) => {
          e.stopPropagation();
          item.locked = !item.locked;
          lockBtn.setText(item.locked ? this.t("activeNoteBtnLockOn") : this.t("activeNoteBtnLockOff"));
          lockBtn.style.cssText = item.locked ? "border-color: var(--interactive-accent); color: var(--text-accent); font-weight: 600;" : "color: var(--text-muted);";
        };
      }
      contentEl.createDiv({
        cls: "fm-section-box",
        text: this.t("activeNoteLockExplain"),
        attr: { style: "font-size: 12px; color: var(--text-muted); line-height: 1.5; margin-top: 10px;" }
      });
      const otherRefNotesAll = this.getUniqueOtherRefNotes(false);
      const optBox = contentEl.createDiv({
        cls: "fm-section-box",
        attr: { style: "margin-top: 8px; display: flex; flex-direction: column; gap: 10px;" }
      });
      if (otherRefNotesAll.length > 0) {
        const syncLabel = optBox.createEl("label", {
          cls: "fm-check-row",
          attr: { style: "margin: 0; cursor: pointer;" }
        });
        const syncCb = syncLabel.createEl("input", { type: "checkbox" });
        syncCb.checked = this.syncOtherNotes;
        syncCb.onchange = () => {
          this.syncOtherNotes = syncCb.checked;
        };
        syncLabel.createSpan({
          text: this.t("activeNoteSyncOtherUploadOpt", { count: otherRefNotesAll.length })
        });
      }
      const delWrap = optBox.createDiv({
        attr: {
          style: otherRefNotesAll.length > 0 ? "border-top: 1px solid var(--background-modifier-border); padding-top: 10px;" : ""
        }
      });
      const delLabel = delWrap.createEl("label", {
        cls: "fm-check-row",
        attr: { style: "margin: 0; cursor: pointer;" }
      });
      const delCb = delLabel.createEl("input", { type: "checkbox" });
      delCb.checked = this.deleteLocalAfter;
      delCb.onchange = () => {
        this.deleteLocalAfter = delCb.checked;
      };
      delLabel.createSpan({ text: this.t("activeNoteDeleteLocalOpt") });
      const btnRow = contentEl.createDiv({ cls: "fm-btn-row" });
      const cancelBtn = btnRow.createEl("button", { text: this.t("btnCancel") });
      cancelBtn.onclick = () => returnToHub(this);
      runBtn = btnRow.createEl("button", {
        text: this.t("activeNoteStartUpload", { count: this.items.filter((i) => i.selected).length }),
        cls: "mod-cta"
      });
      runBtn.onclick = async () => {
        const selected = this.items.filter((i) => i.selected);
        if (selected.length === 0) {
          new import_obsidian25.Notice(this.t("activeNoteSelectRequired"));
          return;
        }
        this.step = "running";
        this.render();
        await this.execute(selected);
      };
      return;
    }
    if (this.step === "running") {
      const box = contentEl.createDiv({ cls: "fm-section-box" });
      const progressHeader = box.createDiv({ attr: { style: "display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;" } });
      this.statusText = progressHeader.createDiv({
        text: this.t("activeNoteScanning"),
        attr: { style: "font-size: 12.5px; color: var(--text-accent); font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:65%;" }
      });
      this.speedText = progressHeader.createDiv({
        attr: { style: "font-size: 11.5px; font-family:var(--font-monospace); color: var(--text-muted); font-weight: 600; white-space:nowrap;" }
      });
      const wrap = box.createDiv({ cls: "fm-progress-wrap" });
      this.progressBar = wrap.createDiv({ cls: "fm-progress-bar", attr: { style: "width: 10%; margin-bottom:8px;" } });
      const stop = box.createEl("button", { text: this.t("transferStop") });
      stop.onclick = () => {
        var _a2;
        (_a2 = this.transferController) == null ? void 0 : _a2.abort();
        stop.disabled = true;
        this.statusText.setText(this.t("transferStopping"));
      };
    } else if (this.step === "result") {
      const failures = ((_a = this.result) == null ? void 0 : _a.failures) || [];
      const processedItems = ((_b = this.result) == null ? void 0 : _b.processedItems) || [];
      if (!this.result.success) {
        const errBanner = contentEl.createDiv({ cls: "fm-result-banner fm-result-banner-error" });
        errBanner.createDiv({ cls: "fm-result-banner-title", text: "\u274C " + this.result.message });
      } else {
        if (this.result.count > 0) {
          const banner = contentEl.createDiv({ cls: "fm-result-banner fm-result-banner-success" });
          banner.createDiv({
            cls: "fm-result-banner-title",
            text: this.result.cancelled ? this.t("transferCancelled") : this.actionType === "migrate" ? this.t("activeNoteMigrateComplete") : this.t("activeNoteDownloadComplete")
          });
          banner.createDiv({
            cls: "fm-result-banner-desc",
            text: this.actionType === "migrate" ? this.t("activeNoteMigrateDoneDesc", { count: this.result.count }) : this.t("activeNoteDownloadDoneDesc", { count: this.result.count })
          });
          const trashFailedList = processedItems.filter((p) => p.trashError);
          if (trashFailedList.length > 0) {
            const warnBox = contentEl.createDiv({
              cls: "fm-alert fm-alert-warning",
              attr: { style: "margin-top: 10px; margin-bottom: 6px; font-size: 12px;" }
            });
            warnBox.createSpan({
              text: this.t("activeNoteTrashFailedNotice", { count: trashFailedList.length })
            });
          }
          if (processedItems.length > 0) {
            const listBox = contentEl.createDiv({
              cls: "fm-section-box",
              attr: { style: "margin-top: 10px;" }
            });
            listBox.createDiv({
              text: this.t("activeNoteResultListTitle", { count: processedItems.length }),
              cls: "fm-section-title"
            });
            const listEl = listBox.createDiv({
              cls: "fm-scroll-list",
              attr: { style: "max-height: 220px; margin-bottom: 0;" }
            });
            for (const pItem of processedItems) {
              const row = listEl.createDiv({ cls: "fm-list-item" });
              const left = row.createDiv({
                attr: { style: "display:flex; align-items:center; gap:10px; flex:1; overflow:hidden;" }
              });
              renderItemVisualThumb(left, pItem, this.plugin);
              const nameCol = left.createDiv({
                attr: { style: "display:flex; flex-direction:column; overflow:hidden; flex:1;" }
              });
              nameCol.createSpan({
                text: pItem.name,
                attr: { style: "overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:500;" }
              });
              nameCol.createSpan({
                text: `${pItem.displayPath}${pItem.size ? " \xB7 " + formatBytes(pItem.size) : ""}`,
                attr: { style: "font-size:11px; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" }
              });
              const rightBox = row.createDiv({
                attr: { style: "display:flex; align-items:center; gap:6px; flex-shrink:0; flex-wrap:wrap; justify-content:flex-end;" }
              });
              if (pItem.syncedOtherNotes > 0) {
                const syncedPaths = Array.isArray(pItem.syncedOtherNotePaths) ? pItem.syncedOtherNotePaths : [];
                const syncedBadge = rightBox.createSpan({
                  text: this.t("activeNoteBadgeSyncedNotes", { count: pItem.syncedOtherNotes }),
                  cls: syncedPaths.length > 0 ? "fm-tag fm-tag-ref fm-clickable-badge" : "fm-tag fm-tag-ref",
                  attr: syncedPaths.length > 0 ? { "aria-label": this.t("activeNoteInspectOtherRefs") } : {}
                });
                if (syncedPaths.length > 0) {
                  syncedBadge.onclick = (e) => {
                    e.stopPropagation();
                    new NoteRefsModal(this.app, pItem.name, syncedPaths, () => this.close(), this.plugin).open();
                  };
                }
              }
              if (pItem.trashedLocal) {
                rightBox.createSpan({ text: this.t("activeNoteBadgeTrashedLocal"), cls: "fm-tag fm-tag-info" });
              } else if (pItem.trashError) {
                rightBox.createSpan({
                  text: this.t("activeNoteBadgeTrashFailed"),
                  cls: "fm-tag fm-tag-danger",
                  attr: { "aria-label": String(pItem.trashError) }
                });
              } else if (pItem.keptForOtherRefs > 0) {
                const keptPaths = Array.isArray(pItem.keptForOtherRefPaths) ? pItem.keptForOtherRefPaths : [];
                const keptBadge = rightBox.createSpan({
                  text: this.t("activeNoteBadgeKeptForOtherRefs", { count: pItem.keptForOtherRefs }),
                  cls: keptPaths.length > 0 ? "fm-tag fm-tag-warning fm-clickable-badge" : "fm-tag fm-tag-warning",
                  attr: keptPaths.length > 0 ? { "aria-label": this.t("activeNoteInspectOtherRefs") } : {}
                });
                if (keptPaths.length > 0) {
                  keptBadge.onclick = (e) => {
                    e.stopPropagation();
                    new NoteRefsModal(this.app, pItem.name, keptPaths, () => this.close(), this.plugin).open();
                  };
                }
              }
              if (pItem.locked) {
                rightBox.createSpan({ text: this.t("activeNoteBtnLockOn"), cls: "fm-tag fm-tag-info" });
              }
              let badgeKey = "activeNoteBadgeDownloaded";
              if (pItem.action === "reused") badgeKey = "activeNoteBadgeReused";
              else if (pItem.action === "overwritten") badgeKey = "activeNoteBadgeOverwritten";
              else if (pItem.action === "uploaded") badgeKey = "activeNoteBadgeUploaded";
              rightBox.createSpan({
                text: this.t(badgeKey),
                cls: "fm-tag fm-tag-info"
              });
            }
          }
        } else if (failures.length === 0 && !this.result.cancelled) {
          const emptyBanner = contentEl.createDiv({ cls: "fm-section-box", attr: { style: "text-align: center; padding: 24px 16px;" } });
          emptyBanner.createDiv({
            text: this.actionType === "migrate" ? this.t("activeNoteNoLocal") : this.t("activeNoteNoRemote"),
            attr: { style: "font-size: 14px; color: var(--text-muted);" }
          });
        }
        if (failures.length > 0) {
          const failBanner = contentEl.createDiv({
            cls: "fm-result-banner fm-result-banner-error",
            attr: { style: "margin-top: 10px;" }
          });
          const failTitleKey = this.actionType === "migrate" ? "activeNoteFailedTitle" : "activeNoteDownFailedTitle";
          failBanner.createDiv({
            cls: "fm-result-banner-title",
            text: this.t(failTitleKey, { failed: failures.length })
          });
          for (const f of failures) {
            const reason = formatFriendlyError(this, f.error);
            failBanner.createDiv({
              cls: "fm-result-banner-desc",
              text: `\u2022 ${f.name} (${formatBytes(f.size || 0)}): ${reason}`,
              attr: { style: "margin-top: 4px;" }
            });
          }
        }
      }
      const btnRow = contentEl.createDiv({ cls: "fm-btn-row" });
      if (this.actionType === "migrate" && processedItems.length > 0) {
        let noteReportPath = null;
        const exportBtn = btnRow.createEl("button", { text: this.t("batchExportReport") });
        exportBtn.onclick = async () => {
          exportBtn.disabled = true;
          try {
            noteReportPath = await exportBatchMigrateReportToRoot(this.plugin, {
              count: this.result.count,
              docs: 1,
              trashed: processedItems.filter((p) => p.trashedLocal).length,
              processedItems,
              failures: this.result.failures || [],
              totalBytes: processedItems.reduce((s, p) => s + (p.size || 0), 0)
            });
            exportBtn.setText(this.t("batchReportExported"));
            if (!btnRow.querySelector(".fm-open-report-btn")) {
              const openBtn = btnRow.createEl("button", {
                text: this.t("batchOpenReport"),
                cls: "fm-open-report-btn"
              });
              openBtn.onclick = () => {
                if (noteReportPath) {
                  this.app.workspace.openLinkText(noteReportPath, "", true);
                }
                this.close();
              };
            }
          } catch (err) {
            new import_obsidian25.Notice("\u274C " + err.message);
            exportBtn.disabled = false;
          }
        };
      }
      if ((_c = this.result) == null ? void 0 : _c.cancelled) btnRow.createSpan({ text: this.t("transferCancelled") });
      if ((_e = (_d = this.result) == null ? void 0 : _d.retryItems) == null ? void 0 : _e.length) {
        const retry = btnRow.createEl("button", { text: this.t("transferRetry") });
        retry.onclick = async () => {
          const pending = this.result.retryItems;
          this.step = "running";
          this.render();
          await this.execute(pending);
        };
      }
      const doneBtn = btnRow.createEl("button", { text: this.t("destBtnDone"), cls: "mod-cta" });
      doneBtn.onclick = () => returnToHub(this);
    }
  }
  async execute(selectedItems = null) {
    this.transferController = new AbortController();
    try {
      if (this.actionType === "migrate") {
        const res = await this.plugin.executeMigrateNoteDirect(
          this.targetFile,
          (cur, total, name, stats) => {
            if (this.progressBar) {
              const pct = Math.round(cur / Math.max(1, total) * 100);
              this.progressBar.style.width = `${pct}%`;
            }
            if (this.statusText) {
              this.statusText.setText(this.t("activeNoteProcessing", { current: cur, total, name }));
            }
            if (this.speedText && (stats == null ? void 0 : stats.speedText)) {
              const eta = stats.etaText ? ` \xB7 \u5269\u4F59\u7EA6 ${stats.etaText}` : "";
              this.speedText.setText(`\u26A1 ${stats.speedText}${eta}`);
            }
          },
          {
            items: selectedItems || this.items.filter((i) => i.selected),
            deleteLocalAfter: this.deleteLocalAfter,
            syncOtherNotes: this.syncOtherNotes,
            signal: this.transferController.signal,
            returnDetails: true
          }
        );
        const count = typeof res === "object" ? res.count || 0 : Number(res || 0);
        const processedItems = typeof res === "object" && Array.isArray(res.processedItems) ? res.processedItems : [];
        const failures = typeof res === "object" && Array.isArray(res.failures) ? res.failures : [];
        this.result = { success: true, ...res, count, processedItems, failures };
      } else {
        const res = await this.plugin.executeDownloadNoteDirect(
          this.targetFile,
          (cur, total, name, stats) => {
            if (this.progressBar) {
              const pct = Math.round(cur / Math.max(1, total) * 100);
              this.progressBar.style.width = `${pct}%`;
            }
            if (this.statusText) {
              this.statusText.setText(this.t("activeNoteProcessing", { current: cur, total, name }));
            }
            if (this.speedText && (stats == null ? void 0 : stats.speedText)) {
              const eta = stats.etaText ? ` \xB7 \u5269\u4F59\u7EA6 ${stats.etaText}` : "";
              this.speedText.setText(`\u26A1 ${stats.speedText}${eta}`);
            }
          },
          {
            items: selectedItems || this.items.filter((i) => i.selected),
            conflictStrategy: this.conflictStrategy,
            syncOtherNotes: this.syncOtherNotes,
            signal: this.transferController.signal,
            returnDetails: true
          }
        );
        const count = typeof res === "object" ? res.count || 0 : Number(res || 0);
        const processedItems = typeof res === "object" && Array.isArray(res.processedItems) ? res.processedItems : [];
        const failures = typeof res === "object" && Array.isArray(res.failures) ? res.failures : [];
        this.result = { success: true, ...res, count, processedItems, failures };
      }
    } catch (err) {
      this.result = { success: false, message: err.message };
    }
    this.transferController = null;
    this.step = "result";
    if (!this.transferClosed) this.render();
  }
  onClose() {
    var _a;
    this.transferClosed = true;
    (_a = this.transferController) == null ? void 0 : _a.abort();
    this.contentEl.empty();
  }
};

// src/modals/hub.js
var import_obsidian26 = require("obsidian");
var FileMasterHubModal = class extends FileMasterModal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
  }
  onOpen() {
    this.contentEl.empty();
    this.modalEl.addClass("fm-ui", "fm-hub-dialog");
    const home = this.contentEl.createDiv({ cls: "fm-hub-content" });
    this.navigator = new HubNavigator(this, home);
    const t2 = (key, params) => this.plugin.t(key, params);
    this.navigator.chrome.title.empty();
    const header = this.homeHeading = this.navigator.chrome.title.createDiv({ cls: "fm-hub-header" });
    (0, import_obsidian26.setIcon)(header.createSpan({ cls: "fm-hub-brand-mark", attr: { "aria-hidden": "true" } }), "zap");
    header.createEl("h2", { text: t2("hubTitle") });
    header.createSpan({ text: "v" + displayVersion(this.plugin.manifest.version), cls: "fm-hub-version" });
    const remote = Boolean(this.plugin.isRemoteServerReady());
    const file = this.app.workspace.getActiveFile();
    const supported = Boolean(file && isDocFile2(this.app, file));
    const show = (modal) => this.navigator.show(modal);
    const settings = () => this.navigator.leave(async () => {
      if (!this.app.setting) throw new Error(t2("hubSettingsUnavailable"));
      await this.app.setting.open();
      await this.app.setting.openTabById(this.plugin.manifest.id);
    });
    const noteAction = (mode) => {
      if (!file || this.app.vault.getAbstractFileByPath(file.path) !== file) throw new Error(t2("noticeOpenMdFirst"));
      return show(new ActiveNoteActionModal(this.app, this.plugin, file, mode, { fromHub: true }));
    };
    const sections = [
      { title: "catActiveNote", context: supported ? file.name : t2("hubOpenNote"), actions: [
        { icon: "upload", title: "actNoteUpTitle", disabled: !remote || !supported, run: () => noteAction("migrate") },
        { icon: "download", title: "actNoteDownTitle", disabled: !remote || !supported, run: () => noteAction("download") },
        { icon: "copy", title: "actNoteAstroTitle", disabled: !remote || !supported, run: () => copyActiveNoteForAstro(this.plugin, file) }
      ] },
      { title: "catGovernance", actions: [
        { icon: "cloud-upload", title: "actMigrateTitle", disabled: !remote, run: () => show(new BatchMigrateWizardModal(this.app, this.plugin)) },
        { icon: "link", title: "actHealthTitle", run: () => show(new HealthCheckModal(this.app, this.plugin)) },
        { icon: "files", title: "actDupTitle", run: () => show(new DuplicateWizardModal(this.app, this.plugin)) },
        { icon: "search", title: "actOrphanTitle", run: () => show(new OrphanWizardModal(this.app, this.plugin)) },
        { icon: "chart-no-axes-combined", title: "actAnalyticsTitle", run: () => show(new VaultAnalyticsModal(this.app, this.plugin)) }
      ] },
      { title: "catFiles", actions: remote ? [
        { icon: "images", title: "actRemoteGalleryTitle", run: () => show(new RemoteGalleryModal(this.app, this.plugin)) },
        { icon: "panel-right", title: "hubDockGallery", hidden: import_obsidian26.Platform.isMobile, run: () => this.navigator.leave((leaf) => this.app.workspace.revealLeaf(leaf), () => initGalleryLeaf(this.plugin, false)) }
      ] : [{ icon: "plug", title: "hubConnect", run: settings }] },
      { title: "catPreferences", actions: [
        { icon: "trash-2", title: "remoteTrashTitle", disabled: !remote, run: () => show(new RemoteTrashModal(this.app, this.plugin)) },
        { icon: "settings", title: "actOpenSettingsTitle", run: settings }
      ] }
    ];
    const bind = (button, action) => {
      button.onclick = async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (this.navigator.busy || button.disabled) return;
        this.lastAction = button;
        this.currentAction = { title: t2(action.title), icon: action.icon };
        button.disabled = true;
        try {
          await action.run();
        } catch (error) {
          new import_obsidian26.Notice(error.message || String(error));
        } finally {
          if (button.isConnected) button.disabled = false;
        }
      };
    };
    for (const section of sections) {
      const group = home.createDiv({ cls: "fm-hub-section" }), title = group.createDiv({ cls: "fm-hub-section-heading" });
      title.createEl("h3", { text: t2(section.title) });
      if (section.context) title.createSpan({ text: section.context, cls: "fm-hub-context" });
      const list = group.createDiv({ cls: "fm-hub-list" });
      for (const action of section.actions.filter((action2) => !action2.hidden)) {
        const row = list.createEl("button", { cls: "fm-hub-card", attr: { type: "button" } });
        (0, import_obsidian26.setIcon)(row.createSpan({ cls: "fm-hub-card-icon" }), action.icon);
        const text = row.createSpan({ cls: "fm-hub-card-text" });
        text.createSpan({ text: t2(action.title), cls: "fm-hub-card-title" });
        (0, import_obsidian26.setIcon)(row.createSpan({ cls: "fm-hub-chevron" }), "chevron-right");
        row.disabled = Boolean(action.disabled);
        if (action.disabled) row.setAttribute("aria-label", `${t2(action.title)} \xB7 ${t2(!remote ? "noticeRemoteNotReady" : "hubOpenNote")}`);
        bind(row, action);
      }
    }
  }
  onClose() {
    var _a;
    (_a = this.navigator) == null ? void 0 : _a.dispose();
    this.contentEl.empty();
  }
};

// src/plugin/vault-utils.js
var import_obsidian27 = require("obsidian");
function isDocFile2(app, file) {
  return isDocFile(file, app);
}
function isScannableDocFile(plugin, file) {
  return Boolean(file) && isDocFile2(plugin.app, file) && !isReportFile(file.name);
}
function isExcalidrawFile2(app, file, content = null) {
  return isExcalidrawFile(file, app, content);
}
function reloadOpenExcalidrawViews(plugin, filePath) {
  var _a, _b;
  if (!filePath || !((_a = plugin.app) == null ? void 0 : _a.workspace)) return;
  try {
    const leaves = plugin.app.workspace.getLeavesOfType("excalidraw");
    for (const leaf of leaves) {
      const viewFile = (_b = leaf.view) == null ? void 0 : _b.file;
      if (viewFile && (viewFile.path === filePath || viewFile.name === filePath)) {
        if (typeof leaf.view.reload === "function") {
          leaf.view.reload();
        } else if (typeof leaf.rebuildView === "function") {
          leaf.rebuildView();
        } else if (typeof leaf.setViewState === "function") {
          const state = leaf.getViewState();
          leaf.setViewState(state);
        }
      }
    }
  } catch (err) {
    console.warn("[FileMaster] Could not reload Excalidraw view:", err);
  }
}
async function safeModifyFileContent(plugin, tfile, transformFn) {
  let changed = false;
  if (typeof plugin.app.vault.process === "function") {
    await plugin.app.vault.process(tfile, (data) => {
      const next = transformFn(data);
      if (next !== data) changed = true;
      return next;
    });
  } else {
    const orig = await plugin.app.vault.read(tfile);
    const next = transformFn(orig);
    if (next !== orig) {
      await plugin.app.vault.modify(tfile, next);
      changed = true;
    }
  }
  if (changed && isExcalidrawFile2(plugin.app, tfile)) {
    reloadOpenExcalidrawViews(plugin, tfile.path);
  }
  return changed;
}
function openModalSafely(modal) {
  return openModal(modal).catch((error) => {
    new import_obsidian27.Notice(error.message || String(error));
  });
}
function updateSidebarRibbonButton(plugin) {
  if (plugin.sidebarRibbonEl) {
    plugin.sidebarRibbonEl.remove();
    plugin.sidebarRibbonEl = null;
  }
  if (plugin.settings.enableSidebarButton === false) {
    return;
  }
  plugin.sidebarRibbonEl = plugin.addRibbonIcon(
    "layers",
    plugin.t("hubTitle"),
    () => {
      openModalSafely(new FileMasterHubModal(plugin.app, plugin));
    }
  );
}
function getExcludedLocalFolderList(settings) {
  return String(settings.excludedLocalFolders || "").split(/[,;\n]+/).map((s) => s.trim().replace(/^\/+|\/+$/g, "")).filter(Boolean);
}
function isLocalPathExcluded(settings, filePath) {
  const p = String(filePath || "").replace(/^\/+/, "");
  const list = getExcludedLocalFolderList(settings);
  return list.some((folder) => p === folder || p.startsWith(folder + "/"));
}
async function toggleLocalFolderExclusion(plugin, folderPath) {
  const clean = String(folderPath || "").replace(/^\/+|\/+$/g, "");
  if (!clean) return;
  const list = getExcludedLocalFolderList(plugin.settings);
  const idx = list.indexOf(clean);
  if (idx > -1) {
    list.splice(idx, 1);
    new import_obsidian27.Notice(plugin.t("noticeExclRemoved", { path: clean }));
  } else {
    list.push(clean);
    new import_obsidian27.Notice(plugin.t("noticeExclAdded", { path: clean }));
  }
  plugin.settings.excludedLocalFolders = list.join(", ");
  await plugin.saveSettings();
}
function getAllVaultFolderPaths(app) {
  var _a;
  const folderSet = /* @__PURE__ */ new Set();
  for (const f of app.vault.getFiles()) {
    const parentPath = (_a = f.parent) == null ? void 0 : _a.path;
    if (parentPath && parentPath !== "/") {
      folderSet.add(parentPath);
    }
  }
  return [...folderSet].sort();
}
async function getItemPreviewUrl(plugin, item) {
  var _a, _b;
  const ext = getExt(item.name);
  if (!IMAGE_EXTS.has(ext)) return null;
  if (item.source === "remote") {
    return ((_a = item.rawObj) == null ? void 0 : _a.rawUrl) || null;
  }
  const tfile = item.rawObj;
  if (!tfile) return null;
  if (NEEDS_TRANSCODE_IMAGE_EXTS.has(ext)) {
    const cacheKey = `${tfile.path}:${((_b = tfile.stat) == null ? void 0 : _b.mtime) || 0}`;
    let previewUrl = plugin.heicPreviewCache.get(cacheKey);
    if (!previewUrl) {
      const buf = await plugin.app.vault.readBinary(tfile);
      previewUrl = await convertBufferToPreviewUrl(buf, ext, plugin);
      plugin.heicPreviewCache.set(cacheKey, previewUrl);
    }
    return previewUrl;
  }
  return plugin.app.vault.getResourcePath(tfile);
}

// src/plugin/attachment-ops.js
var import_obsidian28 = require("obsidian");
async function executeDuplicateMergeSafely(plugin, groups, onComplete) {
  return runAttachmentOperation(plugin, () => mergeDuplicateGroups(plugin, groups, onComplete));
}
async function mergeDuplicateGroups(plugin, groups, onComplete) {
  const tasks = [];
  const remoteItemsToDelete = [];
  for (const grp of groups) {
    const keepItem = grp.items.find((i) => i.id === grp.keepId);
    if (!keepItem) continue;
    const removeItems = grp.items.filter((i) => i.id !== grp.keepId);
    if (removeItems.length === 0) continue;
    for (const rem of removeItems) {
      if (rem.source === "remote" && !rem.locked) {
        remoteItemsToDelete.push({ removeItem: rem, keepItem });
      }
    }
    tasks.push({ keepItem, removeItems });
  }
  if (tasks.length === 0) {
    new import_obsidian28.Notice(plugin.t("noDupToProcess"));
    return;
  }
  if (remoteItemsToDelete.length > 0) {
    const totalRemoteBytes = remoteItemsToDelete.reduce((s, x) => s + (x.removeItem.size || 0), 0);
    const confirmed = await new Promise((resolve) => {
      new ConfirmActionModal(
        plugin.app,
        plugin.t("confirmRemoteDupTitle"),
        plugin.t("confirmRemoteDupMsg", { count: remoteItemsToDelete.length, size: formatBytes(totalRemoteBytes) }),
        plugin.t("confirmRemoteDupBtn", { count: remoteItemsToDelete.length }),
        resolve
      ).open();
    });
    if (!confirmed) return;
  }
  const allDocs = plugin.app.vault.getFiles().filter((f) => isScannableDocFile(plugin, f));
  const localPathsBeingRemoved = /* @__PURE__ */ new Set();
  for (const { removeItems } of tasks) {
    for (const rem of removeItems) {
      if (rem.source === "local" && !rem.locked) {
        localPathsBeingRemoved.add(rem.displayPath);
      }
    }
  }
  const pairs = tasks.flatMap(({ keepItem, removeItems }) => removeItems.map((removeItem) => ({ removeItem, keepItem })));
  const rewritten = await rewriteAttachmentPairs(
    plugin,
    pairs,
    allDocs.filter((doc) => !localPathsBeingRemoved.has(doc.path)).map((doc) => doc.path)
  );
  const modifiedDocsCount = rewritten.modified.size;
  const postSnapshot = await plugin.buildVaultReferenceSnapshot({ freshRead: true });
  await indexRemoteReferences(pairs.filter((p) => p.removeItem.source === "remote").map((p) => p.removeItem.rawObj), postSnapshot);
  const localGatePatterns = pairs.filter((pair) => pair.removeItem.source === "local").map(({ removeItem, keepItem }) => ({
    value: keepItem.name === removeItem.name ? removeItem.displayPath : removeItem.name,
    id: removeItem.displayPath
  }));
  const matchLocalGate = createTextReferenceMatcher(localGatePatterns);
  const remainingLocal = /* @__PURE__ */ new Map();
  for (const doc of postSnapshot.docContents) {
    if (localPathsBeingRemoved.has(doc.path)) continue;
    for (const path of matchLocalGate(doc.rawText)) addReference(remainingLocal, path, doc.path);
    if (doc.decodedText !== doc.rawText) {
      for (const path of matchLocalGate(doc.decodedText)) addReference(remainingLocal, path, doc.path);
    }
  }
  let deletedLocalCount = 0;
  let deletedRemoteCount = 0;
  let skippedBySafetyGate = 0;
  for (const { keepItem, removeItems } of tasks) {
    for (const rem of removeItems) {
      if (rem.locked) {
        continue;
      }
      if (!plugin.isReferenceSnapshotCurrent(postSnapshot)) {
        skippedBySafetyGate++;
        continue;
      }
      let remainingRefs = [];
      if (rem.source === "local") {
        remainingRefs = [...remainingLocal.get(rem.displayPath) || []];
      } else {
        remainingRefs = findReferencingNotesForRemoteItem(rem.rawObj, postSnapshot);
      }
      if (remainingRefs.length > 0) {
        console.warn(
          `[FileMaster Safety Gate] Blocked deletion of ${rem.displayPath}; dangling references detected in notes:`,
          remainingRefs
        );
        plugin.logOperation("WARN", "DEDUP_SAFETY_GATE", `Kept ${rem.displayPath} because references remain in notes`, { remainingRefs });
        skippedBySafetyGate++;
        continue;
      }
      if (rem.source === "local") {
        try {
          await plugin.app.vault.trash(rem.rawObj, true);
          deletedLocalCount++;
        } catch (err) {
          skippedBySafetyGate++;
          plugin.logOperation("WARN", "DEDUP_MERGE", `Failed to trash ${rem.displayPath}`, { error: err.message });
        }
      } else {
        try {
          await plugin.deleteRemoteFile(rem.rawObj.year, rem.rawObj.month, rem.rawObj.filename);
          deletedRemoteCount++;
        } catch (err) {
          new import_obsidian28.Notice(plugin.t("noticeRemoteDeleteFailed", { name: rem.name, err: err.message }));
          plugin.logOperation("ERROR", "DEDUP_MERGE", `Failed to delete remote duplicate ${rem.displayPath}`, { error: err.message });
        }
      }
    }
  }
  plugin.logOperation("INFO", "DEDUP_MERGE", `Merged duplicates: updated ${modifiedDocsCount} note(s), removed ${deletedLocalCount} local & ${deletedRemoteCount} remote file(s)`, {
    modifiedDocsCount,
    deletedLocalCount,
    deletedRemoteCount,
    skippedBySafetyGate
  });
  if (skippedBySafetyGate > 0) {
    new import_obsidian28.Notice(
      plugin.t("noticeDedupSafetyWarning", {
        modified: modifiedDocsCount,
        local: deletedLocalCount,
        remote: deletedRemoteCount,
        skipped: skippedBySafetyGate
      })
    );
  } else {
    new import_obsidian28.Notice(
      plugin.t("noticeDedupSuccess", {
        modified: modifiedDocsCount,
        local: deletedLocalCount,
        remote: deletedRemoteCount
      })
    );
  }
  if (onComplete) {
    onComplete({
      modified: modifiedDocsCount,
      local: deletedLocalCount,
      remote: deletedRemoteCount,
      skipped: skippedBySafetyGate
    });
  }
}
async function migrateSingleLocalFileToRemote(plugin, tfile, { deleteLocal = true } = {}) {
  var _a;
  const result = await plugin.executeBatchMigrateSafely([{ rawObj: tfile }], { deleteLocalAfter: deleteLocal });
  if (!result.count) throw new Error(((_a = result.failures[0]) == null ? void 0 : _a.error) || plugin.t("transferIntegrityFailed"));
  new import_obsidian28.Notice(plugin.t("noticeMigrateSuccess", { name: tfile.name, protected: "", docs: result.docs }));
  return result.processedItems[0].rawObj;
}
async function resumePendingMigration(plugin) {
  if (!plugin.isRemoteServerReady()) {
    new import_obsidian28.Notice(plugin.t("noticeRemoteNotReady"));
    return;
  }
  const adapter = plugin.app.vault.adapter;
  const path = migrationCheckpointPath(plugin);
  if (!await adapter.exists(path)) {
    new import_obsidian28.Notice(plugin.t("transferNothingPending"));
    return;
  }
  const checkpoint = JSON.parse(await adapter.read(path));
  if (checkpoint.serverUrl !== plugin.getCleanServerUrl()) throw new Error(plugin.t("transferServerChanged"));
  const snapshot = await plugin.buildVaultReferenceSnapshot({ freshRead: true });
  const items = checkpoint.items.map((entry) => {
    var _a;
    const file = plugin.app.vault.getAbstractFileByPath(entry.path);
    if (!file || Array.isArray(file.children)) return null;
    return {
      name: file.name,
      displayPath: file.path,
      size: ((_a = file.stat) == null ? void 0 : _a.size) || 0,
      rawObj: file,
      locked: Boolean(entry.locked),
      selected: true,
      refNotes: findReferencingNotesForLocalFile(file, snapshot)
    };
  }).filter(Boolean);
  if (!items.length) {
    new import_obsidian28.Notice(plugin.t("transferNothingPending"));
    return;
  }
  const modal = new BatchMigrateWizardModal(plugin.app, plugin);
  modal.options = { ...modal.options, ...checkpoint.options };
  modal.items = items;
  modal.step = 2;
  modal.open();
}
async function downloadSingleRemoteItemToLocal(plugin, remoteMatch, options = {}) {
  const task = (signal) => downloadRemoteItemToLocal(plugin, remoteMatch, { ...options, signal });
  return options.deferRewrite ? task(options.signal) : runAttachmentOperation(plugin, task, options.signal);
}
async function downloadRemoteItemToLocal(plugin, remoteMatch, options = {}) {
  var _a;
  const silent = Boolean(options == null ? void 0 : options.silent);
  try {
    const { year, month, filename } = remoteMatch;
    if (!silent) {
      new import_obsidian28.Notice(plugin.t("noticeDownloadingFile", { name: filename }));
    }
    let remoteObj = remoteMatch.rawObj || null;
    if (!remoteObj) {
      try {
        const list = await plugin.fetchRemoteFileList();
        remoteObj = list.find(
          (r) => r.year === year && r.month === month && r.filename === filename
        );
      } catch (e) {
      }
    }
    const activeFile = (options == null ? void 0 : options.activeFile) || plugin.app.workspace.getActiveFile();
    const sourcePath = activeFile ? activeFile.path : "";
    const availablePath = remoteMatch.availablePath || await plugin.app.fileManager.getAvailablePathForAttachment(
      filename,
      sourcePath
    );
    const slashIdx = availablePath.lastIndexOf("/");
    const targetDir = slashIdx > -1 ? availablePath.slice(0, slashIdx) : "";
    const idealPath = remoteMatch.idealPath || (targetDir ? `${targetDir}/${filename}` : filename);
    let existingFile = remoteMatch.existingFile || null;
    if (!existingFile) {
      const byName = plugin.app.vault.getAbstractFileByPath(idealPath);
      if (byName && !Array.isArray(byName.children)) {
        existingFile = byName;
      }
    }
    const hasConflict = Boolean(existingFile && !Array.isArray(existingFile.children));
    const conflictStrategy = (options == null ? void 0 : options.conflictStrategy) || "rename";
    let targetLocalFile = null;
    let action = "downloaded";
    if (hasConflict && conflictStrategy === "reuse") {
      if (!(remoteObj == null ? void 0 : remoteObj.sha256) || await computeSha256Hex(await plugin.app.vault.readBinary(existingFile)) !== remoteObj.sha256) {
        throw new Error(plugin.t("transferIntegrityFailed"));
      }
      targetLocalFile = existingFile;
      action = "reused";
    } else {
      const downloadUrl = (remoteObj == null ? void 0 : remoteObj.rawUrl) ? `${remoteObj.rawUrl}?download=1` : `${remoteMatch.matchedUrl}?download=1`;
      const response = await requestWithBackoff(() => (0, import_obsidian28.requestUrl)({
        url: downloadUrl,
        method: "GET",
        headers: { Authorization: `Bearer ${plugin.settings.apiToken}` },
        throw: false
      }), { signal: options.signal });
      if (response.status < 200 || response.status >= 300 || !response.arrayBuffer) {
        throw new Error(`Failed to download remote file (HTTP ${response.status})`);
      }
      if (!(remoteObj == null ? void 0 : remoteObj.sha256) || await computeSha256Hex(response.arrayBuffer) !== remoteObj.sha256) {
        throw new Error(plugin.t("transferIntegrityFailed"));
      }
      throwIfTransferCancelled(options.signal);
      if (hasConflict && conflictStrategy === "overwrite") {
        await plugin.app.vault.modifyBinary(existingFile, response.arrayBuffer);
        targetLocalFile = existingFile;
        action = "overwritten";
      } else {
        targetLocalFile = await plugin.app.vault.createBinary(availablePath, response.arrayBuffer);
        action = "downloaded";
      }
    }
    const removeItem = {
      source: "remote",
      name: filename,
      ext: getExt(filename),
      displayPath: `${year}/${month}/${filename}`,
      rawObj: remoteObj || {
        year,
        month,
        filename,
        rawUrl: remoteMatch.matchedUrl,
        pubUrl: `${plugin.getCleanServerUrl()}/pub/${year}/${month}/${getBaseName(filename)}.webp`
      }
    };
    const keepItem = {
      source: "local",
      name: targetLocalFile.name,
      ext: targetLocalFile.extension.toLowerCase(),
      displayPath: targetLocalFile.path,
      rawObj: targetLocalFile
    };
    const syncOtherNotes = (options == null ? void 0 : options.syncOtherNotes) !== void 0 ? Boolean(options.syncOtherNotes) : true;
    const pair = { removeItem, keepItem };
    const rewritten = options.deferRewrite ? null : await rewriteAttachmentPairs(
      plugin,
      [pair],
      !syncOtherNotes && activeFile ? [activeFile.path] : null
    );
    const modifiedCount = (rewritten == null ? void 0 : rewritten.modified.size) || 0;
    const syncedOtherNotePaths = [...(rewritten == null ? void 0 : rewritten.modified) || []].filter((path) => path !== (activeFile == null ? void 0 : activeFile.path));
    if (!silent) {
      new import_obsidian28.Notice(
        plugin.t("noticeDownloadedToVault", {
          name: filename,
          path: targetLocalFile.path,
          docs: modifiedCount
        })
      );
    }
    if (options == null ? void 0 : options.returnDetails) {
      return {
        file: targetLocalFile,
        name: targetLocalFile.name,
        originName: filename,
        displayPath: targetLocalFile.path,
        remotePath: `${year}/${month}/${filename}`,
        size: ((_a = targetLocalFile.stat) == null ? void 0 : _a.size) || (remoteObj == null ? void 0 : remoteObj.size) || 0,
        action,
        pair,
        modifiedDocs: modifiedCount,
        syncedOtherNotes: syncedOtherNotePaths.length,
        syncedOtherNotePaths
      };
    }
    return targetLocalFile;
  } catch (err) {
    if (!silent) {
      new import_obsidian28.Notice(plugin.t("noticeDownloadFailed", { err: err.message }));
    }
    throw err;
  }
}
async function scanActiveNoteRemoteAttachments(plugin, activeFile) {
  var _a;
  const content = await plugin.app.vault.read(activeFile);
  const serverBase = escapeRegExp(plugin.getCleanServerUrl());
  const re = new RegExp(
    `(${serverBase}\\/([^/\\s)]+)\\/(\\d{4})\\/(\\d{2})\\/([^)\\s]+))`,
    "gi"
  );
  const matchesMap = /* @__PURE__ */ new Map();
  let m;
  while ((m = re.exec(content)) !== null) {
    const fullUrl = m[1];
    let filename = m[5].split(/[?#]/)[0];
    try {
      filename = decodeURIComponent(filename);
    } catch (e) {
    }
    const key = `${m[3]}/${m[4]}/${filename}`;
    if (!matchesMap.has(key)) {
      matchesMap.set(key, {
        matchedUrl: fullUrl,
        cleanUrl: fullUrl.split(/[?#]/)[0],
        routePrefix: m[2],
        year: m[3],
        month: m[4],
        filename
      });
    }
  }
  if (matchesMap.size === 0) {
    return [];
  }
  let remoteList = [];
  try {
    remoteList = await plugin.fetchRemoteFileList();
  } catch (e) {
  }
  const snapshot = await plugin.buildVaultReferenceSnapshot();
  await indexRemoteReferences([...remoteList, ...matchesMap.values()], snapshot);
  const remoteByPath = new Map(remoteList.map((item) => [`${item.year}/${item.month}/${item.filename}`, item]));
  const localFilesBySize = /* @__PURE__ */ new Map();
  const localHashCache = /* @__PURE__ */ new Map();
  const getLocalFileSha256 = async (tfile) => {
    if (!tfile || Array.isArray(tfile.children)) return null;
    if (localHashCache.has(tfile.path)) return localHashCache.get(tfile.path);
    try {
      const buf = await plugin.app.vault.readBinary(tfile);
      const h = await computeSha256Hex(buf);
      localHashCache.set(tfile.path, h);
      return h;
    } catch (e) {
      return null;
    }
  };
  for (const f of plugin.app.vault.getFiles()) {
    if (!isAttachmentExt(f.extension)) continue;
    if (isLocalPathExcluded(plugin.settings, f.path)) continue;
    const sz = ((_a = f.stat) == null ? void 0 : _a.size) || 0;
    if (sz <= 0) continue;
    if (!localFilesBySize.has(sz)) localFilesBySize.set(sz, []);
    localFilesBySize.get(sz).push(f);
  }
  const out = [];
  for (const match of matchesMap.values()) {
    const { year, month, filename, matchedUrl, routePrefix } = match;
    const remoteObj = remoteByPath.get(`${year}/${month}/${filename}`);
    const availablePath = await plugin.app.fileManager.getAvailablePathForAttachment(
      filename,
      activeFile.path
    );
    const slashIdx = availablePath.lastIndexOf("/");
    const targetDir = slashIdx > -1 ? availablePath.slice(0, slashIdx) : "";
    const idealPath = targetDir ? `${targetDir}/${filename}` : filename;
    const existingByName = plugin.app.vault.getAbstractFileByPath(idealPath);
    const hasSameName = Boolean(existingByName && !Array.isArray(existingByName.children));
    let existingFile = hasSameName ? existingByName : null;
    let conflictType = null;
    const remoteSha256 = (remoteObj == null ? void 0 : remoteObj.sha256) || null;
    const remoteSize = (remoteObj == null ? void 0 : remoteObj.size) || 0;
    if (remoteSha256) {
      if (hasSameName) {
        const sameNameHash = await getLocalFileSha256(existingByName);
        if (sameNameHash && sameNameHash === remoteSha256) {
          conflictType = "hash_and_name";
          existingFile = existingByName;
        }
      }
      if (!conflictType && remoteSize > 0) {
        const candidates = localFilesBySize.get(remoteSize) || [];
        const sortedCandidates = [...candidates].sort((a, b) => {
          var _a2, _b;
          const aInTarget = (((_a2 = a.parent) == null ? void 0 : _a2.path) || "") === targetDir ? 0 : 1;
          const bInTarget = (((_b = b.parent) == null ? void 0 : _b.path) || "") === targetDir ? 0 : 1;
          return aInTarget - bInTarget;
        });
        for (const cand of sortedCandidates) {
          const candHash = await getLocalFileSha256(cand);
          if (candHash && candHash === remoteSha256) {
            conflictType = cand.path === idealPath ? "hash_and_name" : "hash_only";
            existingFile = cand;
            break;
          }
        }
      }
    }
    if (!conflictType && hasSameName) {
      conflictType = "name_only";
      existingFile = existingByName;
    }
    const hasConflict = Boolean(conflictType && existingFile);
    const refNotes = findReferencingNotesForRemoteItem({ year, month, filename }, snapshot);
    const otherRefNotes = refNotes.filter((p) => p !== activeFile.path);
    out.push({
      id: `remote:${year}/${month}/${filename}`,
      source: "remote",
      name: filename,
      filename,
      ext: getExt(filename),
      year,
      month,
      matchedUrl,
      routePrefix,
      displayPath: `${year}/${month}/${filename}`,
      size: remoteSize,
      sha256: remoteSha256,
      rawObj: remoteObj || {
        year,
        month,
        filename,
        rawUrl: matchedUrl,
        pubUrl: `${plugin.getCleanServerUrl()}/pub/${year}/${month}/${encodeURIComponent(getBaseName(filename))}.webp`
      },
      targetDir: targetDir || "/",
      idealPath,
      availablePath,
      existingFile: hasConflict ? existingFile : null,
      conflictType,
      hasConflict,
      refNotes,
      otherRefNotes,
      selected: true
    });
  }
  return out;
}
async function executeDownloadNoteDirect(plugin, activeFile, onProgress = null, options = {}) {
  return runAttachmentOperation(plugin, async (signal) => {
    const items = Array.isArray(options.items) ? options.items : await scanActiveNoteRemoteAttachments(plugin, activeFile);
    const processedItems = [], failures = [], retryItems = [], pairs = [];
    for (let i = 0; i < items.length; i++) {
      if (signal.aborted) {
        retryItems.push(...items.slice(i));
        break;
      }
      const item = items[i];
      onProgress == null ? void 0 : onProgress(i + 1, items.length, item.filename || item.name);
      try {
        const detail = await plugin.downloadSingleRemoteItemToLocal(item, {
          ...options,
          signal,
          activeFile,
          silent: true,
          returnDetails: true,
          deferRewrite: true
        });
        pairs.push(detail.pair);
        processedItems.push({
          source: "local",
          name: detail.name,
          ext: getExt(detail.name),
          displayPath: detail.displayPath,
          remotePath: detail.remotePath,
          size: detail.size,
          action: detail.action,
          rawObj: detail.file
        });
      } catch (err) {
        retryItems.push(item);
        if (err.name === "AbortError") {
          retryItems.push(...items.slice(i + 1));
          break;
        }
        failures.push({ name: item.filename || item.name, size: item.size || 0, error: err.message || String(err) });
        plugin.logOperation("ERROR", "NOTE_DOWNLOAD", `Failed to download ${item.filename || item.name}`, { error: err.message });
      }
    }
    const rewritten = pairs.length ? await rewriteAttachmentPairs(
      plugin,
      pairs,
      options.syncOtherNotes === false ? [activeFile.path] : null
    ) : null;
    processedItems.forEach((item, i) => {
      item.syncedOtherNotePaths = ((rewritten == null ? void 0 : rewritten.changedPaths.get(pairs[i])) || []).filter((path) => path !== activeFile.path);
      item.syncedOtherNotes = item.syncedOtherNotePaths.length;
    });
    const summary = {
      count: processedItems.length,
      processedItems,
      failures,
      retryItems,
      cancelled: Boolean(signal.aborted)
    };
    return options.returnDetails ? summary : summary.count;
  }, options.signal);
}
async function downloadActiveNoteRemoteAttachments(plugin, targetFile = null, options = {}) {
  const activeFile = targetFile || plugin.app.workspace.getActiveFile();
  if (!activeFile || !isDocFile2(plugin.app, activeFile)) {
    new import_obsidian28.Notice(plugin.t("noticeOpenMdFirst"));
    return;
  }
  const modal = new ActiveNoteActionModal(plugin.app, plugin, activeFile, "download", options);
  if (options == null ? void 0 : options.fromHub) {
    openModalSafely(modal);
  } else {
    modal.open();
  }
}
async function scanLocalAttachmentsForBatchMigrate(plugin, options, scanCtx = {}) {
  var _a;
  const { signal, onProgress } = scanCtx || {};
  const snapshot = await plugin.buildVaultReferenceSnapshot({ signal, onProgress });
  const allowedGroups = /* @__PURE__ */ new Set();
  if (options.typeImage) allowedGroups.add("image");
  if (options.typeAudio) allowedGroups.add("audio");
  if (options.typeOther) allowedGroups.add("other");
  const prefix = String(options.folderPrefix || "").replace(/^\/+|\/+$/g, "");
  const list = [];
  const allFiles = plugin.app.vault.getFiles();
  for (let i = 0; i < allFiles.length; i++) {
    if (signal == null ? void 0 : signal.aborted) throw new Error("SCAN_ABORTED");
    const f = allFiles[i];
    if (onProgress && i % 30 === 0) {
      onProgress(i + 1, allFiles.length, f.path);
      await new Promise((r) => setTimeout(r, 0));
    }
    if (!isAttachmentExt(f.extension)) continue;
    if (plugin.settings.uploadNonImageAttachments === false && !IMAGE_EXTS.has(f.extension.toLowerCase())) {
      continue;
    }
    if (prefix) {
      if (f.path !== prefix && !f.path.startsWith(prefix + "/")) continue;
    } else if (isLocalPathExcluded(plugin.settings, f.path)) {
      continue;
    }
    const grp = getFileTypeGroup(f.extension);
    if (!allowedGroups.has(grp)) continue;
    const refNotes = findReferencingNotesForLocalFile(f, snapshot);
    list.push({
      id: `local:${f.path}`,
      source: "local",
      name: f.name,
      ext: f.extension.toLowerCase(),
      displayPath: f.path,
      size: ((_a = f.stat) == null ? void 0 : _a.size) || 0,
      refNotes,
      rawObj: f,
      selected: true
    });
  }
  return list;
}
async function executeBatchMigrateSafely(plugin, selectedItems, options, onProgress, onDone) {
  const summary = await runAttachmentOperation(
    plugin,
    (signal) => migrateLocalAttachments(plugin, selectedItems, { ...options, signal }, onProgress),
    options == null ? void 0 : options.signal
  );
  onDone == null ? void 0 : onDone(summary);
  return summary;
}
async function scanActiveNoteLocalAttachments(plugin, activeFile) {
  const content = await plugin.app.vault.read(activeFile);
  const wikiRegex = /!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g;
  const mdLinkRegex = /!?\[([^\]]*)\]\((?!https?:\/\/)([^)]+)\)/g;
  const localFilesMap = /* @__PURE__ */ new Map();
  let m;
  while ((m = wikiRegex.exec(content)) !== null) {
    const tf = plugin.app.metadataCache.getFirstLinkpathDest(m[1].trim(), activeFile.path);
    if (tf && isAttachmentExt(tf.extension)) {
      localFilesMap.set(tf.path, tf);
    }
  }
  while ((m = mdLinkRegex.exec(content)) !== null) {
    let rawTarget = m[2].trim().replace(/^<|>$/g, "");
    try {
      rawTarget = decodeURIComponent(rawTarget);
    } catch (e) {
    }
    const tf = plugin.app.metadataCache.getFirstLinkpathDest(rawTarget, activeFile.path);
    if (tf && isAttachmentExt(tf.extension)) {
      localFilesMap.set(tf.path, tf);
    }
  }
  const snapshot = await plugin.buildVaultReferenceSnapshot();
  return Array.from(localFilesMap.values()).map((tf) => {
    var _a;
    const refNotes = findReferencingNotesForLocalFile(tf, snapshot);
    const otherRefNotes = refNotes.filter((p) => p !== activeFile.path);
    return {
      id: `local:${tf.path}`,
      source: "local",
      name: tf.name,
      ext: tf.extension.toLowerCase(),
      displayPath: tf.path,
      size: ((_a = tf.stat) == null ? void 0 : _a.size) || 0,
      rawObj: tf,
      tfile: tf,
      refNotes,
      otherRefNotes,
      selected: true,
      locked: false
    };
  });
}
async function executeMigrateNoteDirect(plugin, activeFile, onProgress = null, options = {}) {
  return runAttachmentOperation(plugin, async (signal) => {
    var _a;
    const items = Array.isArray(options.items) ? options.items : await scanActiveNoteLocalAttachments(plugin, activeFile);
    const summary = await migrateLocalAttachments(plugin, items, {
      ...options,
      signal,
      activeFile,
      deleteLocalAfter: (_a = options.deleteLocalAfter) != null ? _a : plugin.settings.deleteLocalAfterMigrate,
      documentPaths: options.syncOtherNotes === false ? [activeFile.path] : null
    }, onProgress);
    return options.returnDetails ? summary : summary.count;
  }, options.signal);
}
async function migrateActiveNoteAttachments(plugin, targetFile = null, options = {}) {
  const activeFile = targetFile || plugin.app.workspace.getActiveFile();
  if (!activeFile || !isDocFile2(plugin.app, activeFile)) {
    new import_obsidian28.Notice(plugin.t("noticeOpenMdFirst"));
    return;
  }
  const modal = new ActiveNoteActionModal(plugin.app, plugin, activeFile, "migrate", options);
  if (options == null ? void 0 : options.fromHub) {
    openModalSafely(modal);
  } else {
    modal.open();
  }
}
async function copyActiveNoteForAstro(plugin, targetFile = null) {
  const activeFile = targetFile || plugin.app.workspace.getActiveFile();
  if (!activeFile || !isDocFile2(plugin.app, activeFile)) {
    new import_obsidian28.Notice(plugin.t("noticeOpenMdFirst"));
    return;
  }
  const content = await plugin.app.vault.read(activeFile);
  const converted = content.replace(
    /\/[a-zA-Z0-9_-]+\/(\d{4}\/\d{2}\/[^.)\s]+)\.(png|jpg|jpeg|webp|gif|avif|heic|heif|tif|tiff|bmp|jfif)/gi,
    "/pub/$1.webp"
  );
  await navigator.clipboard.writeText(converted);
  new import_obsidian28.Notice(plugin.t("noticeAstroCopied"));
}

// src/plugin/link-rewrite.js
function rewriteContentLinks(plugin, content, removeItem, keepItem, docPathOrContext = "") {
  if (typeof content !== "string" || !content) return content;
  const docPath = typeof docPathOrContext === "string" ? docPathOrContext : (docPathOrContext == null ? void 0 : docPathOrContext.docPath) || "";
  const customResolve = typeof docPathOrContext === "object" && typeof (docPathOrContext == null ? void 0 : docPathOrContext.resolveLink) === "function" ? docPathOrContext.resolveLink : null;
  const resolveLink = (ref) => {
    var _a, _b;
    if (customResolve) return customResolve(ref);
    if ((_b = (_a = plugin.app) == null ? void 0 : _a.metadataCache) == null ? void 0 : _b.getFirstLinkpathDest) {
      const tfile = plugin.app.metadataCache.getFirstLinkpathDest(ref, docPath || "");
      return tfile ? tfile.path : null;
    }
    return null;
  };
  const isDocExcalidraw = docPath && (docPath.endsWith(".excalidraw.md") || docPath.endsWith(".excalidraw")) || !docPath && /(^##\s+Embedded [Ff]iles\s*?\r?\n)/m.test(content) || typeof isExcalidrawContent === "function" && isExcalidrawContent(content);
  let excalSection = null;
  let preSection = content;
  let postSection = "";
  const sectionRegex = /(^##\s+Embedded [Ff]iles\s*?\r?\n)([\s\S]*?)(?=(?:\r?\n## |\r?\n%%|\r?\n# |$))/m;
  const match = isDocExcalidraw ? sectionRegex.exec(content) : null;
  if (match) {
    if (typeof rewriteExcalidrawEmbeddedFiles === "function") {
      excalSection = rewriteExcalidrawEmbeddedFiles(match[0], removeItem, keepItem, { docPath, resolveLink });
    } else {
      excalSection = match[0];
    }
    preSection = content.slice(0, match.index);
    postSection = content.slice(match.index + match[0].length);
  }
  const buildReplacementForWikiEmbed = (aliasOrWidth) => {
    if (keepItem.source === "local") {
      const suffix = aliasOrWidth ? `|${aliasOrWidth}` : "";
      return `![[${keepItem.displayPath}${suffix}]]`;
    } else {
      const alt = aliasOrWidth || "";
      return IMAGE_EXTS.has(keepItem.ext) ? `![${alt}](${keepItem.rawObj.rawUrl})` : `[\u{1F4CE} ${aliasOrWidth || keepItem.name}](${keepItem.rawObj.rawUrl})`;
    }
  };
  const buildReplacementForWikiLink = (aliasText) => {
    if (keepItem.source === "local") {
      const suffix = aliasText ? `|${aliasText}` : "";
      return `[[${keepItem.displayPath}${suffix}]]`;
    } else {
      return `[${aliasText || keepItem.name}](${keepItem.rawObj.rawUrl})`;
    }
  };
  const buildReplacementForMdLink = (isEmbed, altText) => {
    if (keepItem.source === "local") {
      const prefix = isEmbed ? "!" : "";
      const alias = altText ? `|${altText}` : "";
      return `${prefix}[[${keepItem.displayPath}${alias}]]`;
    } else {
      if (isEmbed && IMAGE_EXTS.has(keepItem.ext)) {
        return `![${altText || ""}](${keepItem.rawObj.rawUrl})`;
      }
      return `[${altText || "\u{1F4CE} " + keepItem.name}](${keepItem.rawObj.rawUrl})`;
    }
  };
  const rewriteMarkdownFragment = (fragment) => {
    if (!fragment) return fragment;
    let updated = fragment;
    if (removeItem.source === "local") {
      const candidates = /* @__PURE__ */ new Set([
        removeItem.displayPath,
        removeItem.name,
        encodeURI(removeItem.displayPath),
        encodeURI(removeItem.name),
        encodeURIComponent(removeItem.name)
      ]);
      const isBareCandidate = (c) => !c.includes("/");
      for (const cand of candidates) {
        const esc = escapeRegExp(cand);
        const isBare = isBareCandidate(cand);
        const checkBareMatchAllowed = () => {
          var _a, _b;
          if (!isBare) return true;
          const hasActiveResolver = Boolean(
            customResolve || ((_b = (_a = plugin.app) == null ? void 0 : _a.metadataCache) == null ? void 0 : _b.getFirstLinkpathDest) && docPath
          );
          if (hasActiveResolver) {
            const dest = resolveLink(cand);
            if (!dest) {
              return false;
            }
            const destPath = dest.toLowerCase().replace(/^\.?\//, "");
            const targetPath = (removeItem.displayPath || "").toLowerCase().replace(/^\.?\//, "");
            return destPath === targetPath;
          }
          return true;
        };
        const wikiEmbedRe = new RegExp(`!\\[\\[(?:\\.\\/)?${esc}(?:#[^\\]|]*)?(?:\\|([^\\]]*))?\\]\\]`, "g");
        updated = updated.replace(wikiEmbedRe, (m, alias) => {
          if (!checkBareMatchAllowed()) return m;
          return buildReplacementForWikiEmbed(alias);
        });
        const wikiLinkRe = new RegExp(`(?<!!)\\[\\[(?:\\.\\/)?${esc}(?:#[^\\]|]*)?(?:\\|([^\\]]*))?\\]\\]`, "g");
        updated = updated.replace(wikiLinkRe, (m, alias) => {
          if (!checkBareMatchAllowed()) return m;
          return buildReplacementForWikiLink(alias);
        });
        const mdLinkRe = new RegExp(`(!?)\\[([^\\]]*)\\]\\(<?(?:\\.\\.?\\/)*${esc}(?:[?#][^)\\s>]*)?>?\\)`, "g");
        updated = updated.replace(mdLinkRe, (m, bang, alt) => {
          if (!checkBareMatchAllowed()) return m;
          return buildReplacementForMdLink(bang === "!", alt);
        });
      }
      if (keepItem.source === "local") {
        updated = updated.split(`"${removeItem.displayPath}"`).join(`"${keepItem.displayPath}"`);
      } else {
        updated = updated.split(`"${removeItem.displayPath}"`).join(`"${keepItem.rawObj.rawUrl}"`);
      }
    } else {
      const r = removeItem.rawObj;
      const encodedName = encodeURIComponent(r.filename);
      const urlPatterns = /* @__PURE__ */ new Set([
        r.rawUrl,
        r.pubUrl,
        `${r.year}/${r.month}/${r.filename}`,
        `${r.year}/${r.month}/${encodedName}`
      ]);
      for (const pat of urlPatterns) {
        if (!pat) continue;
        const esc = escapeRegExp(pat);
        const remoteMdRe = new RegExp(`(!?)\\[([^\\]]*)\\]\\(([^)\\s]*${esc})(?:[?#][^)\\s]*)?\\)`, "g");
        updated = updated.replace(
          remoteMdRe,
          (_, bang, alt) => buildReplacementForMdLink(bang === "!", alt)
        );
      }
      if (keepItem.source === "remote") {
        if (r.rawUrl) updated = updated.split(r.rawUrl).join(keepItem.rawObj.rawUrl);
        if (r.pubUrl) updated = updated.split(r.pubUrl).join(keepItem.rawObj.pubUrl);
      }
    }
    return updated;
  };
  const rewrittenPre = rewriteMarkdownFragment(preSection);
  const rewrittenPost = rewriteMarkdownFragment(postSection);
  if (match && excalSection !== null) {
    return rewrittenPre + excalSection + rewrittenPost;
  }
  return rewrittenPre;
}

// src/plugin.js
var FileMasterPlugin = class extends import_obsidian29.Plugin {
  downloadSingleRemoteItemToLocal(remoteMatch, options = {}) {
    return downloadSingleRemoteItemToLocal(this, remoteMatch, options);
  }
  executeDownloadNoteDirect(activeFile, onProgress = null, options = {}) {
    return executeDownloadNoteDirect(this, activeFile, onProgress, options);
  }
  executeBatchMigrateSafely(selectedItems, options, onProgress, onDone) {
    return executeBatchMigrateSafely(this, selectedItems, options, onProgress, onDone);
  }
  executeMigrateNoteDirect(activeFile, onProgress = null, options = {}) {
    return executeMigrateNoteDirect(this, activeFile, onProgress, options);
  }
  onload() {
    return onload(this);
  }
  onunload() {
    return onunload(this);
  }
  rewriteContentLinks(content, removeItem, keepItem, docPathOrContext = "") {
    return rewriteContentLinks(this, content, removeItem, keepItem, docPathOrContext);
  }
  t(key, params = {}) {
    return t(this, key, params);
  }
  isRemoteServerReady() {
    return isRemoteServerReady(this.settings);
  }
  logOperation(level, action, summary, details = null) {
    return logOperation(this, level, action, summary, details);
  }
  getCleanServerUrl() {
    return getCleanServerUrl(this.settings);
  }
  probeRemoteSha256(sha256) {
    return probeRemoteSha256(this, sha256);
  }
  uploadBufferToServer(arrayBuffer, filename, mimeType = "application/octet-stream", options = {}) {
    return uploadBufferToServer(this, arrayBuffer, filename, mimeType, options);
  }
  toggleRemoteFileLock(year, month, filename, locked = true) {
    return toggleRemoteFileLock(this, year, month, filename, locked);
  }
  fetchRemoteTrash() {
    return fetchRemoteTrash(this);
  }
  permanentlyDeleteRemoteTrash(id) {
    return permanentlyDeleteRemoteTrash(this, id);
  }
  restoreRemoteTrash(id) {
    return restoreRemoteTrash(this, id);
  }
  fetchRemoteFileList() {
    return fetchRemoteFileList(this);
  }
  deleteRemoteFile(year, month, filename) {
    return deleteRemoteFile(this, year, month, filename);
  }
  buildVaultReferenceSnapshot(scanCtx = {}) {
    return buildVaultReferenceSnapshot(this, scanCtx);
  }
  isReferenceSnapshotCurrent(snapshot) {
    return isReferenceSnapshotCurrent(this, snapshot);
  }
  writeOrUpdateRootReport(reportPath, content) {
    return writeOrUpdateRootReport(this, reportPath, content);
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    if (!["raw", "webp"].includes(this.settings.galleryInsertFormat)) {
      this.settings.galleryInsertFormat = this.settings.insertOptimizedLinkOnUpload ? "webp" : "raw";
    }
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
};
FileMasterPlugin.scanNoteContentForBrokenLinks = scanNoteContentForBrokenLinks;
FileMasterPlugin.computeVaultStatsFromEntries = computeVaultStatsFromEntries;
FileMasterPlugin.isReportFile = isReportFile;
FileMasterPlugin.translateUi = translateUi;
FileMasterPlugin.HealthCheckModal = HealthCheckModal;
FileMasterPlugin.VaultAnalyticsModal = VaultAnalyticsModal;
var plugin_default = FileMasterPlugin;

// src/main.js
module.exports = plugin_default;
