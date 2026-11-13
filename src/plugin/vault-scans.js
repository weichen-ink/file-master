import { isScannableDocFile, isExcalidrawFile, isLocalPathExcluded } from './vault-utils.js';
import { computeSha256Hex, formatBytes, formatDateYMD, formatDateTimestamp, getBaseName, getExt, getFileTypeGroup, isReportFile } from '../engine.js';
import { ConfirmActionModal } from '../modals/dialogs.js';
import { addReference, createLocalReferenceMatcher, createTextReferenceMatcher, stripRemoteReferenceText } from '../references.js';
import { runAttachmentOperation } from '../transfers.js';
import { Notice, TFile } from 'obsidian';

// The plugin owns host state; these operations receive it explicitly.
export async function buildVaultReferenceSnapshot(plugin, scanCtx = {}) {
  const {
    signal,
    onProgress,
    freshRead = false,
    includeDocContents = true,
    targetLocalPaths = null
  } = scanCtx || {};
  const revision = plugin.referenceRevision || 0;
  const allFiles = plugin.app.vault.getFiles();
  const docFiles = allFiles.filter((f) => isScannableDocFile(plugin, f));
  const matchLocal = createLocalReferenceMatcher(allFiles, (file) => isExcalidrawFile(plugin.app, file));
  const localReferences = new Map();
  const resolvedLinks = plugin.app.metadataCache?.resolvedLinks || {};
  const unresolvedLinks = plugin.app.metadataCache?.unresolvedLinks || {};
  const hasMetadataGraph = !freshRead && Object.keys(resolvedLinks).length > 0;
  const targetSet = targetLocalPaths instanceof Set ? targetLocalPaths : null;

  const docContents = [];
  for (let i = 0; i < docFiles.length; i++) {
    if (signal?.aborted) throw new Error('SCAN_ABORTED');
    const doc = docFiles[i];
    if (i % 25 === 0) {
      onProgress?.(i + 1, docFiles.length, doc.path);
      await new Promise((r) => setTimeout(r, 0));
    }

    // Lightweight candidate filtering: when scanning only specific local targets on a non-fresh read,
    // skip Markdown files whose Obsidian metadataCache graph shows no matching resolved/unresolved links.
    if (
      !includeDocContents &&
      hasMetadataGraph &&
      targetSet &&
      doc.extension?.toLowerCase() === 'md' &&
      !isExcalidrawFile(plugin.app, doc) &&
      Object.prototype.hasOwnProperty.call(resolvedLinks, doc.path)
    ) {
      const docResolved = resolvedLinks[doc.path] || {};
      const docUnresolved = unresolvedLinks[doc.path] || {};
      const hitsResolved = Object.keys(docResolved).some((p) => targetSet.has(p));
      const hasUnresolved = Object.keys(docUnresolved).length > 0;
      if (!hitsResolved && !hasUnresolved) {
        continue;
      }
    }

    const rawText = freshRead
      ? await plugin.app.vault.read(doc)
      : await plugin.app.vault.cachedRead(doc);
    for (const target of matchLocal(stripRemoteReferenceText(rawText))) addReference(localReferences, target, doc.path);
    if (rawText.includes('%')) {
      let decodedText = rawText;
      try {
        decodedText = decodeURIComponent(rawText);
      } catch { }
      if (decodedText !== rawText) {
        for (const target of matchLocal(stripRemoteReferenceText(decodedText))) addReference(localReferences, target, doc.path);
      }
    }
    if (includeDocContents) {
      docContents.push({
        file: doc,
        path: doc.path,
        rawText
      });
    }
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
    docContents, localReferences, revision, signal,
    stable: revision === (plugin.referenceRevision || 0)
  };
}

export function isReferenceSnapshotCurrent(plugin, snapshot) {
  return snapshot.stable && snapshot.revision === (plugin.referenceRevision || 0);
}

export async function indexRemoteReferences(items, snapshot) {
  const patterns = [];
  for (const item of items) {
    const id = `${item.year}/${item.month}/${item.filename}`;
    const legacy = `${item.year}/${item.month}/${getBaseName(item.filename)}.webp`;
    for (const value of new Set([id, encodeURI(id), legacy, encodeURI(legacy), item.rawUrl, item.pubUrl])) {
      if (value) patterns.push({ value, id });
    }
  }
  const match = createTextReferenceMatcher(patterns);
  snapshot.remoteReferences = new Map(items.map((item) => [`${item.year}/${item.month}/${item.filename}`, new Set()]));
  for (let i = 0; i < snapshot.docContents.length; i++) {
    if (snapshot.signal?.aborted) throw new Error('SCAN_ABORTED');
    if (i % 25 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    const doc = snapshot.docContents[i];
    for (const id of match(doc.rawText)) addReference(snapshot.remoteReferences, id, doc.path);
    if (doc.rawText.includes('%')) {
      let decodedText = doc.rawText;
      try {
        decodedText = decodeURIComponent(doc.rawText);
      } catch { }
      if (decodedText !== doc.rawText) {
        for (const id of match(decodedText)) addReference(snapshot.remoteReferences, id, doc.path);
      }
    }
  }
}

export function findReferencingNotesForLocalFile(tfile, snapshot) {
  return [...(snapshot.localReferences.get(tfile.path) || [])];
}

export function findReferencingNotesForRemoteItem(remoteItem, snapshot) {
  return [...(snapshot.remoteReferences.get(`${remoteItem.year}/${remoteItem.month}/${remoteItem.filename}`) || [])];
}

export async function scanUnusedFiles(plugin, options, scanCtx = {}) {
  const { signal, onProgress } = scanCtx || {};
  const snapshot = await plugin.buildVaultReferenceSnapshot({
    signal,
    onProgress,
    includeDocContents: Boolean(options?.scanRemote)
  });
  const allowedGroups = new Set();
  if (options.typeNote) allowedGroups.add('note');
  if (options.typeImage) allowedGroups.add('image');
  if (options.typeAudio) allowedGroups.add('audio');
  if (options.typeOther) allowedGroups.add('other');

  const unusedList = [];

  if (options.scanLocal) {
    const allFiles = plugin.app.vault.getFiles();
    for (let i = 0; i < allFiles.length; i++) {
      if (signal?.aborted) throw new Error('SCAN_ABORTED');
      const f = allFiles[i];
      if (onProgress && i % 30 === 0) {
        onProgress(i + 1, allFiles.length, f.path);
        await new Promise((r) => setTimeout(r, 0));
      }
      if (isReportFile(f.name) || f.extension === 'canvas') {
        continue;
      }
      if (isLocalPathExcluded(plugin.settings, f.path)) continue;

      const grp = getFileTypeGroup(f.extension);
      if (!allowedGroups.has(grp)) continue;

      const refs = findReferencingNotesForLocalFile(f, snapshot);
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

  if (options.scanRemote) {
    try {
      if (signal?.aborted) throw new Error('SCAN_ABORTED');
      const remoteFiles = await plugin.fetchRemoteFileList();
      await indexRemoteReferences(remoteFiles, snapshot);
      for (let i = 0; i < remoteFiles.length; i++) {
        if (signal?.aborted) throw new Error('SCAN_ABORTED');
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
    } catch (err) {
      if (err.message === 'SCAN_ABORTED') throw err;
      if (!options.scanLocal) {
        throw err;
      }
      new Notice(plugin.t('noticeRemoteUnreachable', { err: err.message }));
    }
  }

  return unusedList;
}

export async function exportOrphanReportToRoot(plugin, results) {
  const now = new Date();
  const dateStr = formatDateTimestamp(now);
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

  await plugin.writeOrUpdateRootReport(reportPath, lines.join('\n'));
  new Notice(plugin.t('noticeReportGenerated', { path: reportPath }));
}

export async function writeOrUpdateRootReport(plugin, reportPath, content) {
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

export async function cleanSelectedOrphans(plugin, selectedItems, onDone) {
  return runAttachmentOperation(plugin, () => cleanOrphanItems(plugin, selectedItems, onDone));
}

export async function cleanOrphanItems(plugin, selectedItems, onDone) {
  const remoteToClean = selectedItems.filter((i) => i.source === 'remote');
  const localToClean = selectedItems.filter((i) => i.source === 'local');

  if (remoteToClean.length > 0) {
    const remoteBytes = remoteToClean.reduce((s, i) => s + (i.size || 0), 0);
    const confirmed = await new Promise((resolve) => {
      new ConfirmActionModal(
        plugin.app,
        plugin.t('confirmRemoteOrphanTitle'),
        plugin.t('confirmRemoteOrphanMsg', { count: remoteToClean.length, size: formatBytes(remoteBytes) }),
        plugin.t('confirmRemoteOrphanBtn', { count: remoteToClean.length }),
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
    if (!plugin.isReferenceSnapshotCurrent(snapshot)) { skipped++; continue; }
    if (findReferencingNotesForLocalFile(item.rawObj, snapshot).length) { skipped++; continue; }
    try {
      await plugin.app.vault.trash(item.rawObj, true);
      deletedLocal++;
    } catch (err) {
      console.error('Failed to delete local file:', err);
      plugin.logOperation('ERROR', 'ORPHAN_CLEANUP', `Failed to move local file to trash: ${item.displayPath}`, { error: err.message });
    }
  }

  for (const item of remoteToClean) {
    if (!plugin.isReferenceSnapshotCurrent(snapshot)) { skipped++; continue; }
    if (findReferencingNotesForRemoteItem(item.rawObj, snapshot).length) { skipped++; continue; }
    try {
      await plugin.deleteRemoteFile(item.rawObj.year, item.rawObj.month, item.rawObj.filename);
      deletedRemote++;
    } catch (err) {
      new Notice(plugin.t('noticeRemoteDeleteFailed', { name: item.name, err: err.message }));
      plugin.logOperation('ERROR', 'ORPHAN_CLEANUP', `Failed to delete remote file: ${item.displayPath}`, { error: err.message });
    }
  }

  plugin.logOperation('INFO', 'ORPHAN_CLEANUP', `Cleaned unreferenced files: ${deletedLocal} local, ${deletedRemote} remote`, {
    files: selectedItems.map((i) => i.displayPath)
  });
  new Notice(plugin.t('noticeCleanupComplete', { local: deletedLocal, remote: deletedRemote }));
  if (onDone) onDone({ local: deletedLocal, remote: deletedRemote, skipped, total: deletedLocal + deletedRemote });
}

export async function scanDuplicateGroups(plugin, scope, fileTypeOpts = null, scanCtx = {}) {
  const { signal, onProgress } = scanCtx || {};
  const snapshot = await plugin.buildVaultReferenceSnapshot({ signal, onProgress });
  const hashMap = new Map();
  const allowedGroups = new Set();
  if (!fileTypeOpts) {
    allowedGroups.add('image');
    allowedGroups.add('audio');
    allowedGroups.add('other');
    allowedGroups.add('note');
  } else {
    if (fileTypeOpts.typeImage) allowedGroups.add('image');
    if (fileTypeOpts.typeAudio) allowedGroups.add('audio');
    if (fileTypeOpts.typeOther) allowedGroups.add('other');
    if (fileTypeOpts.typeNote) allowedGroups.add('note');
  }

  let localScanned = 0;
  let remoteScanned = 0;
  let remoteError = null;

  const addItem = (sha256, itemObj) => {
    if (!sha256) return;
    if (!hashMap.has(sha256)) hashMap.set(sha256, []);
    hashMap.get(sha256).push(itemObj);
  };

  const sizeBuckets = new Map();
  const getBucket = (sz) => {
    let b = sizeBuckets.get(sz);
    if (!b) {
      b = { local: [], remote: [] };
      sizeBuckets.set(sz, b);
    }
    return b;
  };

  if (scope === 'local' || scope === 'both') {
    const allFiles = plugin.app.vault.getFiles();
    for (const f of allFiles) {
      if (signal?.aborted) throw new Error('SCAN_ABORTED');
      if (isReportFile(f.name) || f.extension === 'canvas') {
        continue;
      }
      if (isLocalPathExcluded(plugin.settings, f.path)) continue;

      const grp = getFileTypeGroup(f.extension);
      if (!allowedGroups.has(grp)) continue;

      const size = f.stat?.size || 0;
      if (size <= 0) continue;

      getBucket(size).local.push(f);
    }
  }

  if (scope === 'remote' || scope === 'both') {
    try {
      if (signal?.aborted) throw new Error('SCAN_ABORTED');
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
      if (err.message === 'SCAN_ABORTED') throw err;
      if (scope === 'remote') {
        throw err;
      }
      remoteError = err.message;
    }
  }

  const bucketEntries = [...sizeBuckets.entries()];
  for (let bIdx = 0; bIdx < bucketEntries.length; bIdx++) {
    if (signal?.aborted) throw new Error('SCAN_ABORTED');
    const [, bucket] = bucketEntries[bIdx];
    let hasConflict = false;
    if (scope === 'both') {
      hasConflict = (bucket.local.length + bucket.remote.length) >= 2;
    } else if (scope === 'local') {
      hasConflict = bucket.local.length >= 2;
    } else if (scope === 'remote') {
      hasConflict = bucket.remote.length >= 2;
    }

    if (!hasConflict) continue;

    if (scope === 'remote' || scope === 'both') {
      for (const r of bucket.remote) {
        if (signal?.aborted) throw new Error('SCAN_ABORTED');
        remoteScanned++;
        const ext = getExt(r.filename);
        const refNotes = findReferencingNotesForRemoteItem(r, snapshot);
        addItem(r.sha256, {
          id: `remote:${r.year}/${r.month}/${r.filename}`,
          source: 'remote',
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

    if (scope === 'local' || scope === 'both') {
      for (const f of bucket.local) {
        if (signal?.aborted) throw new Error('SCAN_ABORTED');
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

export async function exportDuplicateReportToRoot(plugin, groups) {
  const now = new Date();
  const dateStr = formatDateTimestamp(now);
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

  await plugin.writeOrUpdateRootReport(reportPath, lines.join('\n'));
  new Notice(plugin.t('noticeReportGenerated', { path: reportPath }));
}

export async function exportBatchMigrateReportToRoot(plugin, summary) {
  const now = new Date();
  const dateStr = formatDateTimestamp(now);
  const timeStr = now.toLocaleTimeString('zh-CN', { hour12: false });
  const reportPath = `Batch_Migrate_Report_${dateStr}.md`;

  const count = summary?.count || 0;
  const docs = summary?.docs || 0;
  const totalBytes = summary?.totalBytes || 0;
  const trashed = summary?.trashed || 0;
  const items = summary?.processedItems || [];
  const failures = summary?.failures || [];
  const trashFailures = summary?.trashFailures || [];

  const lines = [
    `# 🚀 批量云端迁移报告 / Batch Migration Report (${dateStr})`,
    ``,
    `> 生成时间 / Generated: ${dateStr} ${timeStr}  |  成功迁移附件 / Uploaded: **${count}** (${formatBytes(totalBytes)})  |  更新笔记 / Notes Updated: **${docs}**  |  本地清理 / Trashed: **${trashed}**`,
    ``,
    `## 📊 迁移汇总统计 / Summary Statistics`,
    `- **成功上传文件 (Total Uploaded)**: ${count} 个 (${formatBytes(totalBytes)})`,
    `- **引用链接已更新笔记 (Notes Updated)**: ${docs} 篇`,
    `- **本地原文件已移入回收站 (Local Trashed)**: ${trashed} 个`,
    `- **上传失败项 (Failed Uploads)**: ${failures.length} 个`,
    ...(trashFailures.length > 0 ? [`- **本地清理失败项 (Failed Local Cleanups)**: ${trashFailures.length} 个`] : []),
    ``,
    `## ☁️ 已迁移附件清单 / Migrated Assets (${items.length})`,
    ``
  ];

  if (items.length === 0) {
    lines.push(`- 无已迁移附件 / No assets were migrated.`);
  } else {
    lines.push(`| # | 本地原路径 (Local Path) | 服务器链接 (Remote URL) | 文件大小 (Size) | 引用数 (Refs) |`);
    lines.push(`|---|---|---|---|---|`);
    items.forEach((item, idx) => {
      const localPath = item.displayPath || item.name;
      const remoteUrl = item.rawUrl || (item.rawObj && item.rawObj.rawUrl) || '';
      const sizeStr = formatBytes(item.size || 0);
      const refsCount = item.refNotesCount !== undefined ? `${item.refNotesCount} 篇` : '-';
      const remoteLink = remoteUrl ? `[${item.name || 'Link'}](${remoteUrl})` : '-';
      lines.push(`| ${idx + 1} | \`${localPath}\` | ${remoteLink} | ${sizeStr} | ${refsCount} |`);
    });
  }

  if (failures.length > 0) {
    lines.push(``);
    lines.push(`## ⚠️ 上传失败项 / Failed Uploads (${failures.length})`);
    lines.push(``);
    failures.forEach((f, idx) => {
      lines.push(`- **#${idx + 1}**: \`${f.path || f.name}\` (${formatBytes(f.size || 0)}) — 错误原因 / Reason: ${f.error}`);
    });
  }

  if (trashFailures.length > 0) {
    lines.push(``);
    lines.push(`## ⚠️ 本地清理失败项 / Failed Local Cleanups (${trashFailures.length})`);
    lines.push(``);
    trashFailures.forEach((tf, idx) => {
      lines.push(`- **#${idx + 1}**: \`${tf.path}\` — 错误原因 / Reason: ${tf.error}`);
    });
  }

  lines.push(``);
  lines.push(`---`);
  lines.push(`*Generated by File Master Obsidian Plugin*`);

  await plugin.writeOrUpdateRootReport(reportPath, lines.join('\n'));
  new Notice(plugin.t('noticeReportGenerated', { path: reportPath }));
  return reportPath;
}

export async function openNoteAtLine(plugin, filePath, lineNumber) {
  const file = plugin.app.vault.getAbstractFileByPath(filePath);
  if (file && file instanceof TFile) {
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
    return true;
  } else {
    new Notice(plugin.t('noticeCannotOpenFile', { path: filePath }));
    return false;
  }
}
