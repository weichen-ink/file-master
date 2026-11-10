import { computeSha256Hex, getExt } from './engine.js';

export function throwIfTransferCancelled(signal) {
  if (signal?.aborted) throw Object.assign(new Error('TRANSFER_CANCELLED'), { name: 'AbortError' });
}

export function transferDelay(ms, signal) {
  return new Promise((resolve, reject) => {
    const cancelled = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error('TRANSFER_CANCELLED'), { name: 'AbortError' }));
    };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', cancelled); resolve(); }, ms);
    if (signal?.aborted) cancelled();
    else signal?.addEventListener('abort', cancelled, { once: true });
  });
}

export async function requestWithBackoff(request, { signal, delay = transferDelay, maxRetries = 4 } = {}) {
  for (let attempt = 0; ; attempt++) {
    throwIfTransferCancelled(signal);
    let response;
    try {
      response = await request();
      if (attempt >= maxRetries || ![429, 500, 502, 503, 504].includes(response.status)) return response;
    } catch (err) {
      if (signal?.aborted || attempt >= maxRetries || err.name === 'AbortError') throw err;
    }
    const headers = response?.headers || {};
    const retryAfter = headers['retry-after'] ?? headers['Retry-After'];
    let wait = retryAfter !== undefined && Number.isFinite(Number(retryAfter))
      ? Number(retryAfter) * 1000 : Number.isFinite(Date.parse(retryAfter))
        ? Math.max(0, Date.parse(retryAfter) - Date.now()) : null;
    if (wait === null && response?.status === 429) {
      try { if (response.json?.retryAfter) wait = Number(response.json.retryAfter) * 1000; } catch {}
    }
    await delay(Math.min(120000, Math.max(250, wait ?? 1000 * (2 ** attempt) + Math.random() * 250)), signal);
  }
}

export async function runAttachmentOperation(plugin, task, signal) {
  if (plugin.attachmentOperationRunning) throw new Error(plugin.t('transferBusy'));
  plugin.attachmentOperationRunning = true;
  const controller = new AbortController();
  const cancelled = () => controller.abort();
  if (signal?.aborted) cancelled();
  else signal?.addEventListener('abort', cancelled, { once: true });
  plugin.activeTransferController = controller;
  try { return await task(controller.signal); }
  finally {
    signal?.removeEventListener('abort', cancelled);
    plugin.activeTransferController = null;
    plugin.attachmentOperationRunning = false;
  }
}

/** One read/atomic transform per affected document, against its latest contents. */
export async function rewriteAttachmentPairs(plugin, pairs, documentPaths = null) {
  const snapshot = await plugin.buildVaultReferenceSnapshot({ freshRead: true });
  const remoteItems = pairs.filter((p) => p.removeItem.source === 'remote').map((p) => p.removeItem.rawObj);
  if (remoteItems.length) await plugin.indexRemoteReferences(remoteItems, snapshot);
  const allowed = documentPaths ? new Set(documentPaths) : null;
  const byDocument = new Map();
  const changedPaths = new Map(pairs.map((pair) => [pair, []]));
  for (const pair of pairs) {
    const refs = pair.removeItem.source === 'local'
      ? plugin.findReferencingNotesForLocalFile(pair.removeItem.rawObj, snapshot)
      : plugin.findReferencingNotesForRemoteItem(pair.removeItem.rawObj, snapshot);
    for (const path of refs) {
      if (allowed && !allowed.has(path)) continue;
      if (!byDocument.has(path)) byDocument.set(path, []);
      byDocument.get(path).push(pair);
    }
  }
  const modified = new Set();
  for (const doc of snapshot.docContents) {
    const relevant = byDocument.get(doc.path);
    if (!relevant) continue;
    const changedPairs = new Set();
    const changed = await plugin.safeModifyFileContent(doc.file, (current) => {
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

export function migrationCheckpointPath(plugin) {
  return plugin.getLogFilePath().replace(/operation\.log$/, 'migration-pending.json');
}

export async function saveMigrationCheckpoint(plugin, items, options) {
  const adapter = plugin.app.vault.adapter;
  if (!adapter) return;
  const path = migrationCheckpointPath(plugin);
  if (!items.length) {
    if (await adapter.exists(path)) await adapter.remove(path);
    return;
  }
  await adapter.write(path, JSON.stringify({ version: 1, serverUrl: plugin.getCleanServerUrl(),
    options: { deleteLocalAfter: Boolean(options.deleteLocalAfter), documentPaths: options.documentPaths || null },
    items: items.map((entry) => ({ path: (entry.tfile || entry.rawObj || entry).path, locked: Boolean(entry.locked) })) }));
}

export async function migrateLocalAttachments(plugin, items, options = {}, onProgress = null) {
  await saveMigrationCheckpoint(plugin, items, options);
  const uploaded = [], failures = [], retryItems = [];
  for (let i = 0; i < items.length; i++) {
    if (options.signal?.aborted) { retryItems.push(...items.slice(i)); break; }
    const entry = items[i];
    const tfile = entry.tfile || entry.rawObj || entry;
    const sourceVersion = { ...tfile.stat };
    onProgress?.(i + 1, items.length, tfile.name);
    try {
      const bytes = await plugin.app.vault.readBinary(tfile);
      const remote = await plugin.uploadBufferToServer(bytes, tfile.name, 'application/octet-stream', { signal: options.signal });
      if (entry.locked && !remote.locked) {
        await plugin.toggleRemoteFileLock(remote.year, remote.month, remote.filename, true);
        remote.locked = true;
      }
      uploaded.push({ entry, tfile, sourceVersion, sourceSha: remote.sha256,
        removeItem: { source: 'local', name: tfile.name, ext: tfile.extension.toLowerCase(), displayPath: tfile.path, rawObj: tfile },
        keepItem: { source: 'remote', name: remote.filename, ext: getExt(remote.filename),
          displayPath: `${remote.year}/${remote.month}/${remote.filename}`, rawObj: remote } });
    } catch (err) {
      retryItems.push(entry);
      if (err.name === 'AbortError') { retryItems.push(...items.slice(i + 1)); break; }
      failures.push({ name: tfile.name, path: tfile.path, size: tfile.stat?.size || 0, error: err.message || String(err) });
      plugin.logOperation('ERROR', 'BATCH_UPLOAD', `Failed to upload ${tfile.path}`, { error: err.message });
    }
  }

  for (let i = uploaded.length - 1; i >= 0; i--) {
    const pair = uploaded[i];
    if (pair.sourceVersion.mtime !== pair.tfile.stat?.mtime || pair.sourceVersion.size !== pair.tfile.stat?.size) {
      if (await computeSha256Hex(await plugin.app.vault.readBinary(pair.tfile)) !== pair.sourceSha) {
        uploaded.splice(i, 1);
        retryItems.push(pair.entry);
        failures.push({ name: pair.tfile.name, path: pair.tfile.path, size: pair.tfile.stat?.size || 0,
          error: plugin.t('transferSourceChanged') });
      }
    }
  }

  // Finish already completed transfers even when cancellation was requested.
  const rewritten = uploaded.length ? await rewriteAttachmentPairs(plugin, uploaded, options.documentPaths)
    : { modified: new Set(), changedPaths: new Map() };
  const postSnapshot = uploaded.length && options.deleteLocalAfter
    ? await plugin.buildVaultReferenceSnapshot({ freshRead: true }) : null;
  const trashedFiles = [], trashFailures = [], processedItems = [];
  for (const pair of uploaded) {
    const { tfile, keepItem } = pair;
    const remote = keepItem.rawObj;
    const syncedPaths = (rewritten.changedPaths.get(pair) || []).filter((p) => p !== options.activeFile?.path);
    const remaining = postSnapshot ? plugin.findReferencingNotesForLocalFile(tfile, postSnapshot) : [];
    const result = { source: 'remote', name: remote.filename, ext: keepItem.ext, displayPath: keepItem.displayPath,
      localPath: tfile.path, size: tfile.stat?.size || 0, locked: Boolean(remote.locked), rawObj: remote,
      rawUrl: remote.rawUrl, pubUrl: remote.pubUrl, action: 'uploaded', trashedLocal: false,
      keptForOtherRefs: remaining.length, keptForOtherRefPaths: remaining,
      syncedOtherNotes: syncedPaths.length, syncedOtherNotePaths: syncedPaths,
      refNotesCount: pair.entry.refNotes?.length || 0 };
    if (postSnapshot && !remaining.length) {
      try {
        // An attachment may have been edited or replaced during a long upload.
        const latest = await plugin.app.vault.readBinary(tfile);
        if (await computeSha256Hex(latest) !== pair.sourceSha) throw new Error(plugin.t('transferSourceChanged'));
        if (!plugin.isReferenceSnapshotCurrent(postSnapshot)) throw new Error(plugin.t('transferReferencesChanged'));
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
  const summary = { count: uploaded.length, docs: rewritten.modified.size,
    modifiedNotePaths: [...rewritten.modified], trashed: trashedFiles.length, trashedFiles,
    processedItems, failures, trashFailures, retryItems, cancelled: Boolean(options.signal?.aborted),
    totalBytes: processedItems.reduce((sum, item) => sum + item.size, 0) };
  plugin.logOperation('INFO', 'BATCH_UPLOAD', `Uploaded ${summary.count}, updated ${summary.docs}, trashed ${summary.trashed}`, {
    failures: failures.length, unfinished: retryItems.length, cancelled: summary.cancelled
  });
  return summary;
}
