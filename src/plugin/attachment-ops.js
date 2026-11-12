import { isScannableDocFile, isLocalPathExcluded, isDocFile, openModalSafely } from './vault-utils.js';
import { indexRemoteReferences, findReferencingNotesForRemoteItem, findReferencingNotesForLocalFile } from './vault-scans.js';
import { IMAGE_EXTS, isAttachmentExt } from '../constants.js';
import { computeSha256Hex, escapeRegExp, formatBytes, getBaseName, getExt, getFileTypeGroup } from '../engine.js';
import { ActiveNoteActionModal } from '../modals/active-note.js';
import { BatchMigrateWizardModal } from '../modals/batch-migrate-wizard.js';
import { ConfirmActionModal } from '../modals/dialogs.js';
import { migrateLocalAttachments, migrationCheckpointPath, requestWithBackoff, rewriteAttachmentPairs, runAttachmentOperation, throwIfTransferCancelled } from '../transfers.js';
import { Notice, requestUrl } from 'obsidian';

// The plugin owns host state; these operations receive it explicitly.
export async function executeDuplicateMergeSafely(plugin, groups, onComplete) {
  return runAttachmentOperation(plugin, () => mergeDuplicateGroups(plugin, groups, onComplete));
}

export async function mergeDuplicateGroups(plugin, groups, onComplete) {
  const tasks = [];
  const remoteItemsToDelete = [];
  let skippedBySafetyGate = 0;
  const currentHash = async item => {
    if (item.source === 'local') return computeSha256Hex(await plugin.app.vault.readBinary(item.rawObj));
    const url = new URL(item.rawObj.rawUrl); url.searchParams.set('download','1'); url.searchParams.set('raw','1');
    const response = await requestUrl({url:url.href,method:'GET',throw:false});
    if (response.status !== 200 || !response.arrayBuffer) throw new Error('Unable to verify attachment content');
    return computeSha256Hex(response.arrayBuffer);
  };

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
    tasks.push({ keepItem, removeItems, sha256:grp.sha256 });
  }

  if (tasks.length === 0) {
    new Notice(plugin.t('noDupToProcess'));
    onComplete?.({modified:0,local:0,remote:0,skipped:skippedBySafetyGate});
    return;
  }

  if (remoteItemsToDelete.length > 0) {
    const totalRemoteBytes = remoteItemsToDelete.reduce((s, x) => s + (x.removeItem.size || 0), 0);
    const confirmed = await new Promise((resolve) => {
      new ConfirmActionModal(
        plugin.app,
        plugin.t('confirmRemoteDupTitle'),
        plugin.t('confirmRemoteDupMsg', { count: remoteItemsToDelete.length, size: formatBytes(totalRemoteBytes) }),
        plugin.t('confirmRemoteDupBtn', { count: remoteItemsToDelete.length }),
        resolve
      ).open();
    });
    if (!confirmed) return;
  }

  const allDocs = plugin.app.vault
    .getFiles()
    .filter((f) => isScannableDocFile(plugin, f));

  // Confirmation can remain open while files change. Revalidate immediately before rewriting.
  for (let i = tasks.length - 1; i >= 0; i--) {
    const task = tasks[i];
    try {
      if (await currentHash(task.keepItem) !== task.sha256) throw new Error('Retained attachment changed');
      const verified = [];
      for (const item of task.removeItems) {
        try { if (await currentHash(item) !== task.sha256) throw new Error('Attachment changed'); verified.push(item); }
        catch (error) { skippedBySafetyGate++; plugin.logOperation('WARN','DEDUP_SAFETY_GATE',`Kept ${item.displayPath}`,{error:error.message}); }
      }
      task.removeItems = verified;
    } catch (error) {
      skippedBySafetyGate += task.removeItems.length; tasks.splice(i,1);
      plugin.logOperation('WARN','DEDUP_SAFETY_GATE',`Kept duplicate group because ${task.keepItem.displayPath} changed`,{error:error.message});
    }
  }

  const pairs = tasks.flatMap(({ keepItem, removeItems }) => removeItems.map((removeItem) => ({ removeItem, keepItem })));
  const rewritten = await rewriteAttachmentPairs(plugin, pairs,
    allDocs.map((doc) => doc.path));
  const modifiedDocsCount = rewritten.modified.size;
  const postSnapshot = await plugin.buildVaultReferenceSnapshot({ freshRead: true });
  await indexRemoteReferences(pairs.filter((p) => p.removeItem.source === 'remote').map((p) => p.removeItem.rawObj), postSnapshot);
  let deletedLocalCount = 0;
  let deletedRemoteCount = 0;
  for (const { keepItem, removeItems, sha256 } of tasks) {
    for (const rem of removeItems) {
      if (rem.locked) {
        continue;
      }
      if (!plugin.isReferenceSnapshotCurrent(postSnapshot)) { skippedBySafetyGate++; continue; }

      let remainingRefs = [];
      if (rem.source === 'local') {
        remainingRefs = findReferencingNotesForLocalFile(rem.rawObj, postSnapshot);
      } else {
        remainingRefs = findReferencingNotesForRemoteItem(rem.rawObj, postSnapshot);
      }

      if (remainingRefs.length > 0) {
        console.warn(
          `[FileMaster Safety Gate] Blocked deletion of ${rem.displayPath}; dangling references detected in notes:`,
          remainingRefs
        );
        plugin.logOperation('WARN', 'DEDUP_SAFETY_GATE', `Kept ${rem.displayPath} because references remain in notes`, { remainingRefs });
        skippedBySafetyGate++;
        continue;
      }

      try {
        if (await currentHash(keepItem) !== sha256 || await currentHash(rem) !== sha256 || !plugin.isReferenceSnapshotCurrent(postSnapshot)) throw new Error('Attachment content or references changed');
      } catch (error) { skippedBySafetyGate++; plugin.logOperation('WARN','DEDUP_SAFETY_GATE',`Kept ${rem.displayPath}`,{error:error.message}); continue; }

      if (rem.source === 'local') {
        try {
          await plugin.app.vault.trash(rem.rawObj, true);
          deletedLocalCount++;
        } catch (err) {
          skippedBySafetyGate++;
          plugin.logOperation('WARN', 'DEDUP_MERGE', `Failed to trash ${rem.displayPath}`, { error: err.message });
        }
      } else {
        try {
          await plugin.deleteRemoteFile(rem.rawObj.year, rem.rawObj.month, rem.rawObj.filename, sha256);
          deletedRemoteCount++;
        } catch (err) {
          new Notice(plugin.t('noticeRemoteDeleteFailed', { name: rem.name, err: err.message }));
          plugin.logOperation('ERROR', 'DEDUP_MERGE', `Failed to delete remote duplicate ${rem.displayPath}`, { error: err.message });
        }
      }
    }
  }

  plugin.logOperation('INFO', 'DEDUP_MERGE', `Merged duplicates: updated ${modifiedDocsCount} note(s), removed ${deletedLocalCount} local & ${deletedRemoteCount} remote file(s)`, {
    modifiedDocsCount,
    deletedLocalCount,
    deletedRemoteCount,
    skippedBySafetyGate
  });

  if (skippedBySafetyGate > 0) {
    new Notice(
      plugin.t('noticeDedupSafetyWarning', {
        modified: modifiedDocsCount,
        local: deletedLocalCount,
        remote: deletedRemoteCount,
        skipped: skippedBySafetyGate
      })
    );
  } else {
    new Notice(
      plugin.t('noticeDedupSuccess', {
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

export async function migrateSingleLocalFileToRemote(plugin, tfile, { deleteLocal = true } = {}) {
  const result = await plugin.executeBatchMigrateSafely([{ rawObj: tfile }], { deleteLocalAfter: deleteLocal });
  if (!result.count) throw new Error(result.failures[0]?.error || plugin.t('transferIntegrityFailed'));
  new Notice(plugin.t('noticeMigrateSuccess', { name: tfile.name, protected: '', docs: result.docs }));
  return result.processedItems[0].rawObj;
}

export async function resumePendingMigration(plugin) {
  if (!plugin.isRemoteServerReady()) { new Notice(plugin.t('noticeRemoteNotReady')); return; }
  const adapter = plugin.app.vault.adapter;
  const path = migrationCheckpointPath(plugin);
  if (!await adapter.exists(path)) { new Notice(plugin.t('transferNothingPending')); return; }
  const checkpoint = JSON.parse(await adapter.read(path));
  if (checkpoint.serverUrl !== plugin.getCleanServerUrl()) throw new Error(plugin.t('transferServerChanged'));
  const snapshot = await plugin.buildVaultReferenceSnapshot({ freshRead: true });
  const items = checkpoint.items.map((entry) => {
    const file = plugin.app.vault.getAbstractFileByPath(entry.path);
    if (!file || Array.isArray(file.children)) return null;
    return { name: file.name, displayPath: file.path, size: file.stat?.size || 0,
      rawObj: file, locked: Boolean(entry.locked), selected: true,
      refNotes: findReferencingNotesForLocalFile(file, snapshot) };
  }).filter(Boolean);
  if (!items.length) { new Notice(plugin.t('transferNothingPending')); return; }
  const modal = new BatchMigrateWizardModal(plugin.app, plugin);
  modal.options = { ...modal.options, ...checkpoint.options };
  modal.items = items;
  modal.step = 2;
  modal.open();
}

export async function downloadSingleRemoteItemToLocal(plugin, remoteMatch, options = {}) {
  const task = (signal) => downloadRemoteItemToLocal(plugin, remoteMatch, { ...options, signal });
  return options.deferRewrite ? task(options.signal) : runAttachmentOperation(plugin, task, options.signal);
}

export async function downloadRemoteItemToLocal(plugin, remoteMatch, options = {}) {
  const silent = Boolean(options?.silent);
  try {
    const { year, month, filename } = remoteMatch;
    if (!silent) {
      new Notice(plugin.t('noticeDownloadingFile', { name: filename }));
    }

    let remoteObj = remoteMatch.rawObj || null;
    if (!remoteObj) {
      try {
        const list = await plugin.fetchRemoteFileList();
        remoteObj = list.find(
          (r) => r.year === year && r.month === month && r.filename === filename
        );
      } catch { }
    }

    const activeFile = options?.activeFile || plugin.app.workspace.getActiveFile();
    const sourcePath = activeFile ? activeFile.path : '';
    const availablePath = remoteMatch.availablePath || await plugin.app.fileManager.getAvailablePathForAttachment(
      filename,
      sourcePath
    );
    const slashIdx = availablePath.lastIndexOf('/');
    const targetDir = slashIdx > -1 ? availablePath.slice(0, slashIdx) : '';
    const idealPath = remoteMatch.idealPath || (targetDir ? `${targetDir}/${filename}` : filename);

    let existingFile = remoteMatch.existingFile || null;
    if (!existingFile) {
      const byName = plugin.app.vault.getAbstractFileByPath(idealPath);
      if (byName && !Array.isArray(byName.children)) {
        existingFile = byName;
      }
    }
    const hasConflict = Boolean(existingFile && !Array.isArray(existingFile.children));

    const conflictStrategy = options?.conflictStrategy || 'rename';
    let targetLocalFile = null;
    let action = 'downloaded';

    if (hasConflict && conflictStrategy === 'reuse') {
      if (!remoteObj?.sha256 || await computeSha256Hex(await plugin.app.vault.readBinary(existingFile)) !== remoteObj.sha256) {
        throw new Error(plugin.t('transferIntegrityFailed'));
      }
      targetLocalFile = existingFile;
      action = 'reused';
    } else {
      const downloadUrl = remoteObj?.rawUrl
        ? `${remoteObj.rawUrl}?download=1`
        : `${remoteMatch.matchedUrl}?download=1`;

      const response = await requestWithBackoff(() => requestUrl({
        url: downloadUrl,
        method: 'GET',
        headers: { Authorization: `Bearer ${plugin.settings.apiToken}` },
        throw: false
      }), { signal: options.signal });

      if (response.status < 200 || response.status >= 300 || !response.arrayBuffer) {
        throw new Error(`Failed to download remote file (HTTP ${response.status})`);
      }
      if (!remoteObj?.sha256 || await computeSha256Hex(response.arrayBuffer) !== remoteObj.sha256) {
        throw new Error(plugin.t('transferIntegrityFailed'));
      }
      throwIfTransferCancelled(options.signal);

      if (hasConflict && conflictStrategy === 'overwrite') {
        await plugin.app.vault.modifyBinary(existingFile, response.arrayBuffer);
        targetLocalFile = existingFile;
        action = 'overwritten';
      } else {
        targetLocalFile = await plugin.app.vault.createBinary(availablePath, response.arrayBuffer);
        action = 'downloaded';
      }
    }

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
        pubUrl: `${plugin.getCleanServerUrl()}/pub/${year}/${month}/${getBaseName(filename)}.webp`
      }
    };

    const keepItem = {
      source: 'local',
      name: targetLocalFile.name,
      ext: targetLocalFile.extension.toLowerCase(),
      displayPath: targetLocalFile.path,
      rawObj: targetLocalFile
    };

    const syncOtherNotes = options?.syncOtherNotes !== undefined ? Boolean(options.syncOtherNotes) : true;
    const pair = { removeItem, keepItem };
    const rewritten = options.deferRewrite ? null : await rewriteAttachmentPairs(plugin, [pair],
      !syncOtherNotes && activeFile ? [activeFile.path] : null);
    const modifiedCount = rewritten?.modified.size || 0;
    const syncedOtherNotePaths = [...(rewritten?.modified || [])].filter((path) => path !== activeFile?.path);

    if (!silent) {
      new Notice(
        plugin.t('noticeDownloadedToVault', {
          name: filename,
          path: targetLocalFile.path,
          docs: modifiedCount
        })
      );
    }

    if (options?.returnDetails) {
      return {
        file: targetLocalFile,
        name: targetLocalFile.name,
        originName: filename,
        displayPath: targetLocalFile.path,
        remotePath: `${year}/${month}/${filename}`,
        size: targetLocalFile.stat?.size || remoteObj?.size || 0,
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
      new Notice(plugin.t('noticeDownloadFailed', { err: err.message }));
    }
    throw err;
  }
}

export async function scanActiveNoteRemoteAttachments(plugin, activeFile) {
  const content = await plugin.app.vault.read(activeFile);
  const serverBase = escapeRegExp(plugin.getCleanServerUrl());
  const re = new RegExp(
    `(${serverBase}\\/([^/\\s)]+)\\/(\\d{4})\\/(\\d{2})\\/([^)\\s]+))`,
    'gi'
  );

  const matchesMap = new Map();
  let m;
  while ((m = re.exec(content)) !== null) {
    const fullUrl = m[1];
    let filename = m[5].split(/[?#]/)[0];
    try {
      filename = decodeURIComponent(filename);
    } catch { }
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
  } catch { }

  const snapshot = await plugin.buildVaultReferenceSnapshot();
  await indexRemoteReferences([...remoteList, ...matchesMap.values()], snapshot);
  const remoteByPath = new Map(remoteList.map((item) => [`${item.year}/${item.month}/${item.filename}`, item]));

  // Pre-index local attachment files by size for fast SHA-256 content duplicate checks
  const localFilesBySize = new Map();
  const localHashCache = new Map();
  const getLocalFileSha256 = async (tfile) => {
    if (!tfile || Array.isArray(tfile.children)) return null;
    if (localHashCache.has(tfile.path)) return localHashCache.get(tfile.path);
    try {
      const buf = await plugin.app.vault.readBinary(tfile);
      const h = await computeSha256Hex(buf);
      localHashCache.set(tfile.path, h);
      return h;
    } catch {
      return null;
    }
  };
  for (const f of plugin.app.vault.getFiles()) {
    if (!isAttachmentExt(f.extension)) continue;
    if (isLocalPathExcluded(plugin.settings, f.path)) continue;
    const sz = f.stat?.size || 0;
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
    const slashIdx = availablePath.lastIndexOf('/');
    const targetDir = slashIdx > -1 ? availablePath.slice(0, slashIdx) : '';
    const idealPath = targetDir ? `${targetDir}/${filename}` : filename;
    const existingByName = plugin.app.vault.getAbstractFileByPath(idealPath);
    const hasSameName = Boolean(existingByName && !Array.isArray(existingByName.children));

    let existingFile = hasSameName ? existingByName : null;
    let conflictType = null; // 'hash_and_name' | 'hash_only' | 'name_only' | null
    const remoteSha256 = remoteObj?.sha256 || null;
    const remoteSize = remoteObj?.size || 0;

    if (remoteSha256) {
      if (hasSameName) {
        const sameNameHash = await getLocalFileSha256(existingByName);
        if (sameNameHash && sameNameHash === remoteSha256) {
          conflictType = 'hash_and_name';
          existingFile = existingByName;
        }
      }
      if (!conflictType && remoteSize > 0) {
        const candidates = localFilesBySize.get(remoteSize) || [];
        // Prioritize candidates inside targetDir first
        const sortedCandidates = [...candidates].sort((a, b) => {
          const aInTarget = (a.parent?.path || '') === targetDir ? 0 : 1;
          const bInTarget = (b.parent?.path || '') === targetDir ? 0 : 1;
          return aInTarget - bInTarget;
        });
        for (const cand of sortedCandidates) {
          const candHash = await getLocalFileSha256(cand);
          if (candHash && candHash === remoteSha256) {
            conflictType = cand.path === idealPath ? 'hash_and_name' : 'hash_only';
            existingFile = cand;
            break;
          }
        }
      }
    }

    if (!conflictType && hasSameName) {
      conflictType = 'name_only';
      existingFile = existingByName;
    }

    const hasConflict = Boolean(conflictType && existingFile);
    const refNotes = findReferencingNotesForRemoteItem({ year, month, filename }, snapshot);
    const otherRefNotes = refNotes.filter((p) => p !== activeFile.path);

    out.push({
      id: `remote:${year}/${month}/${filename}`,
      source: 'remote',
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
      targetDir: targetDir || '/',
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

export async function executeDownloadNoteDirect(plugin, activeFile, onProgress = null, options = {}) {
  return runAttachmentOperation(plugin, async (signal) => {
    const items = Array.isArray(options.items) ? options.items : await scanActiveNoteRemoteAttachments(plugin, activeFile);
    const processedItems = [], failures = [], retryItems = [], pairs = [];
    for (let i = 0; i < items.length; i++) {
      if (signal.aborted) { retryItems.push(...items.slice(i)); break; }
      const item = items[i];
      onProgress?.(i + 1, items.length, item.filename || item.name);
      try {
        const detail = await plugin.downloadSingleRemoteItemToLocal(item, {
          ...options, signal, activeFile, silent: true, returnDetails: true, deferRewrite: true
        });
        pairs.push(detail.pair);
        processedItems.push({ source: 'local', name: detail.name, ext: getExt(detail.name),
          displayPath: detail.displayPath, remotePath: detail.remotePath, size: detail.size,
          action: detail.action, rawObj: detail.file });
      } catch (err) {
        retryItems.push(item);
        if (err.name === 'AbortError') { retryItems.push(...items.slice(i + 1)); break; }
        failures.push({ name: item.filename || item.name, size: item.size || 0, error: err.message || String(err) });
        plugin.logOperation('ERROR', 'NOTE_DOWNLOAD', `Failed to download ${item.filename || item.name}`, { error: err.message });
      }
    }
    const rewritten = pairs.length ? await rewriteAttachmentPairs(plugin, pairs,
      options.syncOtherNotes === false ? [activeFile.path] : null) : null;
    processedItems.forEach((item, i) => {
      item.syncedOtherNotePaths = (rewritten?.changedPaths.get(pairs[i]) || []).filter((path) => path !== activeFile.path);
      item.syncedOtherNotes = item.syncedOtherNotePaths.length;
    });
    const summary = { count: processedItems.length, processedItems, failures, retryItems,
      cancelled: Boolean(signal.aborted) };
    return options.returnDetails ? summary : summary.count;
  }, options.signal);
}

export async function downloadActiveNoteRemoteAttachments(plugin, targetFile = null, options = {}) {
  const activeFile = targetFile || plugin.app.workspace.getActiveFile();
  if (!activeFile || !isDocFile(plugin.app, activeFile)) {
    new Notice(plugin.t('noticeOpenMdFirst'));
    return;
  }
  const modal = new ActiveNoteActionModal(plugin.app, plugin, activeFile, 'download', options);
  if (options?.fromHub) {
    openModalSafely(modal);
  } else {
    modal.open();
  }
}

export async function scanLocalAttachmentsForBatchMigrate(plugin, options, scanCtx = {}) {
  const { signal, onProgress } = scanCtx || {};
  const snapshot = await plugin.buildVaultReferenceSnapshot({ signal, onProgress });
  const allowedGroups = new Set();
  if (options.typeImage) allowedGroups.add('image');
  if (options.typeAudio) allowedGroups.add('audio');
  if (options.typeOther) allowedGroups.add('other');

  const prefix = String(options.folderPrefix || '').replace(/^\/+|\/+$/g, '');
  const list = [];

  const allFiles = plugin.app.vault.getFiles();
  for (let i = 0; i < allFiles.length; i++) {
    if (signal?.aborted) throw new Error('SCAN_ABORTED');
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
      if (f.path !== prefix && !f.path.startsWith(prefix + '/')) continue;
    } else if (isLocalPathExcluded(plugin.settings, f.path)) {
      continue;
    }

    const grp = getFileTypeGroup(f.extension);
    if (!allowedGroups.has(grp)) continue;

    const refNotes = findReferencingNotesForLocalFile(f, snapshot);
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

export async function executeBatchMigrateSafely(plugin, selectedItems, options, onProgress, onDone) {
  const summary = await runAttachmentOperation(plugin,
    (signal) => migrateLocalAttachments(plugin, selectedItems, { ...options, signal }, onProgress), options?.signal);
  onDone?.(summary);
  return summary;
}

export async function scanActiveNoteLocalAttachments(plugin, activeFile) {
  const content = await plugin.app.vault.read(activeFile);
  const wikiRegex = /!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g;
  const mdLinkRegex = /!?\[([^\]]*)\]\((?!https?:\/\/)([^)]+)\)/g;

  const localFilesMap = new Map();
  let m;
  while ((m = wikiRegex.exec(content)) !== null) {
    const tf = plugin.app.metadataCache.getFirstLinkpathDest(m[1].trim(), activeFile.path);
    if (tf && isAttachmentExt(tf.extension)) {
      localFilesMap.set(tf.path, tf);
    }
  }
  while ((m = mdLinkRegex.exec(content)) !== null) {
    let rawTarget = m[2].trim().replace(/^<|>$/g, '');
    try {
      rawTarget = decodeURIComponent(rawTarget);
    } catch { }
    const tf = plugin.app.metadataCache.getFirstLinkpathDest(rawTarget, activeFile.path);
    if (tf && isAttachmentExt(tf.extension)) {
      localFilesMap.set(tf.path, tf);
    }
  }

  const snapshot = await plugin.buildVaultReferenceSnapshot();

  return Array.from(localFilesMap.values()).map((tf) => {
    const refNotes = findReferencingNotesForLocalFile(tf, snapshot);
    const otherRefNotes = refNotes.filter((p) => p !== activeFile.path);
    return {
      id: `local:${tf.path}`,
      source: 'local',
      name: tf.name,
      ext: tf.extension.toLowerCase(),
      displayPath: tf.path,
      size: tf.stat?.size || 0,
      rawObj: tf,
      tfile: tf,
      refNotes,
      otherRefNotes,
      selected: true,
      locked: false
    };
  });
}

export async function executeMigrateNoteDirect(plugin, activeFile, onProgress = null, options = {}) {
  return runAttachmentOperation(plugin, async (signal) => {
    const items = Array.isArray(options.items) ? options.items : await scanActiveNoteLocalAttachments(plugin, activeFile);
    const summary = await migrateLocalAttachments(plugin, items, {
      ...options, signal, activeFile,
      deleteLocalAfter: options.deleteLocalAfter ?? plugin.settings.deleteLocalAfterMigrate,
      documentPaths: options.syncOtherNotes === false ? [activeFile.path] : null
    }, onProgress);
    return options.returnDetails ? summary : summary.count;
  }, options.signal);
}

export async function migrateActiveNoteAttachments(plugin, targetFile = null, options = {}) {
  const activeFile = targetFile || plugin.app.workspace.getActiveFile();
  if (!activeFile || !isDocFile(plugin.app, activeFile)) {
    new Notice(plugin.t('noticeOpenMdFirst'));
    return;
  }
  const modal = new ActiveNoteActionModal(plugin.app, plugin, activeFile, 'migrate', options);
  if (options?.fromHub) {
    openModalSafely(modal);
  } else {
    modal.open();
  }
}

export async function copyActiveNoteForAstro(plugin, targetFile = null) {
  const activeFile = targetFile || plugin.app.workspace.getActiveFile();
  if (!activeFile || !isDocFile(plugin.app, activeFile)) {
    new Notice(plugin.t('noticeOpenMdFirst'));
    return;
  }
  const content = await plugin.app.vault.read(activeFile);
  const converted = content.replace(
    /\/[a-zA-Z0-9_-]+\/(\d{4}\/\d{2}\/[^.)\s]+)\.(png|jpg|jpeg|webp|gif|avif|heic|heif|tif|tiff|bmp|jfif)/gi,
    '/pub/$1.webp'
  );
  await navigator.clipboard.writeText(converted);
  new Notice(plugin.t('noticeAstroCopied'));
}
