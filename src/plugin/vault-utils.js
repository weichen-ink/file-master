import { IMAGE_EXTS, NEEDS_TRANSCODE_IMAGE_EXTS, VIEW_TYPE_REMOTE_GALLERY } from '../constants.js';
import { convertBufferToPreviewUrl, getExt, isDocFile as helperIsDocFile, isExcalidrawFile as helperIsExcalidrawFile, isReportFile } from '../engine.js';
import { requireModal } from './modal-registry.js';
import { captureInsertionTarget, insertLinkAtTarget } from './editor-target.js';
import { Notice } from 'obsidian';
import { openModal } from '../ui/navigation.js';

// The plugin owns host state; these operations receive it explicitly.
export function isDocFile(app, file) {
  return helperIsDocFile(file, app);
}

export function isScannableDocFile(plugin, file) {
  return Boolean(file) && isDocFile(plugin.app, file) && !isReportFile(file.name);
}

export function isExcalidrawFile(app, file, content = null) {
  return helperIsExcalidrawFile(file, app, content);
}

export function reloadOpenExcalidrawViews(plugin, filePath) {
  if (!filePath || !plugin.app?.workspace) return;
  try {
    const leaves = plugin.app.workspace.getLeavesOfType('excalidraw');
    for (const leaf of leaves) {
      const viewFile = leaf.view?.file;
      if (viewFile && (viewFile.path === filePath || viewFile.name === filePath)) {
        if (typeof leaf.view.reload === 'function') {
          leaf.view.reload();
        } else if (typeof leaf.rebuildView === 'function') {
          leaf.rebuildView();
        } else if (typeof leaf.setViewState === 'function') {
          const state = leaf.getViewState();
          leaf.setViewState(state);
        }
      }
    }
  } catch (err) {
    console.warn('[FileMaster] Could not reload Excalidraw view:', err);
  }
}

export async function safeModifyFileContent(plugin, tfile, transformFn) {
  let changed = false;
  if (typeof plugin.app.vault.process === 'function') {
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

  if (changed && isExcalidrawFile(plugin.app, tfile)) {
    reloadOpenExcalidrawViews(plugin, tfile.path);
  }

  return changed;
}

export function openModalSafely(modal) {
  return openModal(modal).catch(error => { new Notice(error.message || String(error)); });
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

export function updateSidebarRibbonButton(plugin) {
  if (plugin.sidebarRibbonEl) {
    plugin.sidebarRibbonEl.remove();
    plugin.sidebarRibbonEl = null;
  }
  if (plugin.settings.enableSidebarButton === false) {
    return;
  }
  plugin.sidebarRibbonEl = plugin.addRibbonIcon(
    'layers',
    plugin.t('hubTitle'),
    () => {
      const FileMasterHubModal = requireModal('FileMasterHubModal');
      openModalSafely(new FileMasterHubModal(plugin.app, plugin));
    }
  );
}

export function normalizeFolderPath(folderPath) {
  return String(folderPath || '').replace(/^\/+|\/+$/g, '');
}

export function normalizeFolderList(folders) {
  if (!Array.isArray(folders)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of folders) {
    const clean = normalizeFolderPath(raw);
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      out.push(clean);
    }
  }
  return out;
}

export function getExcludedLocalFolderList(settings) {
  return normalizeFolderList(
    String(settings?.excludedLocalFolders || '')
      .split(/[,;\n]+/)
      .map((s) => s.trim())
  );
}

export function isLocalPathExcluded(settings, filePath) {
  const p = String(filePath || '').replace(/^\/+/, '');
  const list = getExcludedLocalFolderList(settings);
  return list.some((folder) => p === folder || p.startsWith(folder + '/'));
}

export function createDefaultFolderScope(settings, initialInclude = []) {
  return {
    includeFolders: normalizeFolderList(Array.isArray(initialInclude) ? initialInclude : [initialInclude]),
    excludeFolders: getExcludedLocalFolderList(settings)
  };
}

export function resolveLocalFolderScope(settings, options = null) {
  const hasExplicitInclude = Array.isArray(options?.includeFolders);
  const legacyPrefix = normalizeFolderPath(options?.folderPrefix);
  const includeFolders = hasExplicitInclude
    ? normalizeFolderList(options.includeFolders)
    : (legacyPrefix ? [legacyPrefix] : []);

  let excludeFolders;
  if (Array.isArray(options?.excludeFolders)) {
    excludeFolders = normalizeFolderList(options.excludeFolders);
  } else if (!hasExplicitInclude && legacyPrefix) {
    excludeFolders = [];
  } else {
    excludeFolders = getExcludedLocalFolderList(settings);
  }

  return { includeFolders, excludeFolders };
}

export function matchesLocalFolderScope(filePath, scope) {
  const p = String(filePath || '').replace(/^\/+/, '');
  const include = scope?.includeFolders || [];
  const exclude = scope?.excludeFolders || [];
  if (include.length > 0 && !include.some((folder) => p === folder || p.startsWith(folder + '/'))) {
    return false;
  }
  if (exclude.length > 0 && exclude.some((folder) => p === folder || p.startsWith(folder + '/'))) {
    return false;
  }
  return true;
}

export async function toggleLocalFolderExclusion(plugin, folderPath) {
  const clean = normalizeFolderPath(folderPath);
  if (!clean) return;
  const list = getExcludedLocalFolderList(plugin.settings);
  const idx = list.indexOf(clean);
  if (idx > -1) {
    list.splice(idx, 1);
    new Notice(plugin.t('noticeExclRemoved', { path: clean }));
  } else {
    list.push(clean);
    new Notice(plugin.t('noticeExclAdded', { path: clean }));
  }
  plugin.settings.excludedLocalFolders = list.join(', ');
  await plugin.saveSettings();
}

export function getAllVaultFolderPaths(app) {
  const folderSet = new Set();
  const files = app?.vault?.getFiles?.() || [];
  for (const f of files) {
    const parentPath = f.parent?.path && f.parent.path !== '/'
      ? f.parent.path
      : (typeof f.path === 'string' && f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '');
    if (!parentPath) continue;
    const parts = parentPath.split('/').filter(Boolean);
    let acc = '';
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      folderSet.add(acc);
    }
  }
  return [...folderSet].sort();
}

export function revokeBlobUrl(url) {
  if (typeof url === 'string' && url.startsWith('blob:')) {
    try { URL.revokeObjectURL(url); } catch { }
  }
}

export function clearHeicPreviewCache(plugin) {
  if (plugin?.heicPreviewPending) {
    plugin.heicPreviewPending.clear();
  }
  if (!plugin?.heicPreviewCache) return;
  for (const url of plugin.heicPreviewCache.values()) {
    revokeBlobUrl(url);
  }
  plugin.heicPreviewCache.clear();
}

/**
 * Forces Obsidian's HTTP/DOM image cache to reload modified remote assets without touching note markdown.
 */
export async function refreshRemoteImageCache(plugin, targetUrls = []) {
  const normalizeUrlKey = (u) => {
    const base = String(u || '').split('#')[0].split('?')[0];
    try { return decodeURIComponent(base); } catch { return base; }
  };
  const stripRefreshParam = (u) => String(u || '')
    .replace(/([?&])_fm_refresh=\d+&?/g, '$1')
    .replace(/[?&]$/, '');
  const targets = new Set((Array.isArray(targetUrls) ? targetUrls : []).filter(Boolean).map(normalizeUrlKey));
  const isTargeted = targets.size > 0;
  if (!isTargeted) {
    clearHeicPreviewCache(plugin);
  }

  const serverBase = typeof plugin?.getCleanServerUrl === 'function' ? plugin.getCleanServerUrl() : '';
  const urlsToReload = new Set(isTargeted ? targetUrls.filter(Boolean).map(stripRefreshParam) : []);
  const matchedImages = [];

  const workspace = plugin?.app?.workspace;
  const leaves = [];
  if (typeof workspace?.iterateAllLeaves === 'function') {
    workspace.iterateAllLeaves((leaf) => leaves.push(leaf));
  } else if (typeof workspace?.getLeavesOfType === 'function') {
    leaves.push(...(workspace.getLeavesOfType('markdown') || []));
  }

  for (const leaf of leaves) {
    const container = leaf?.view?.containerEl;
    if (!container?.querySelectorAll) continue;
    for (const img of container.querySelectorAll('img')) {
      const src = img.getAttribute('src') || img.src || '';
      if (!/^https?:\/\//i.test(src)) continue;
      const cleanSrc = stripRefreshParam(src);
      const key = normalizeUrlKey(cleanSrc);
      const hit = isTargeted
        ? targets.has(key)
        : (serverBase ? key.startsWith(normalizeUrlKey(serverBase)) : false);
      if (hit) {
        urlsToReload.add(cleanSrc);
        matchedImages.push({ img, cleanSrc });
      }
    }
  }

  if (typeof fetch === 'function' && urlsToReload.size > 0) {
    const list = [...urlsToReload];
    for (let i = 0; i < list.length; i += 6) {
      await Promise.all(list.slice(i, i + 6).map((url) =>
        fetch(url, { cache: 'reload' }).catch(() => null)
      ));
    }
  }

  const bust = Date.now();
  for (const { img, cleanSrc } of matchedImages) {
    const [baseAndQuery, hash = ''] = cleanSrc.split('#');
    const sep = baseAndQuery.includes('?') ? '&' : '?';
    const nextSrc = `${baseAndQuery}${sep}_fm_refresh=${bust}${hash ? `#${hash}` : ''}`;
    try {
      img.src = nextSrc;
    } catch { }
  }

  return { refreshedUrls: urlsToReload.size, refreshedImages: matchedImages.length };
}

export async function getOrCreateHeicPreviewUrl(plugin, tfile, ext) {
  if (!plugin || !tfile || plugin.isUnloading) return null;
  const cacheKey = `${tfile.path}:${tfile.stat?.mtime || 0}`;
  const existing = plugin.heicPreviewCache.get(cacheKey);
  if (existing) return existing;

  if (!plugin.heicPreviewPending) plugin.heicPreviewPending = new Map();
  const inFlight = plugin.heicPreviewPending.get(cacheKey);
  if (inFlight) return inFlight;

  const task = (async () => {
    const buf = await plugin.app.vault.readBinary(tfile);
    if (plugin.isUnloading) return null;

    const previewUrl = await convertBufferToPreviewUrl(buf, ext, plugin);
    if (!previewUrl) return null;

    if (plugin.isUnloading) {
      revokeBlobUrl(previewUrl);
      return null;
    }

    const cached = plugin.heicPreviewCache.get(cacheKey);
    if (cached) {
      revokeBlobUrl(previewUrl);
      return cached;
    }

    if (plugin.heicPreviewCache.size >= 100) {
      const oldestKey = plugin.heicPreviewCache.keys().next().value;
      const oldestUrl = plugin.heicPreviewCache.get(oldestKey);
      plugin.heicPreviewCache.delete(oldestKey);
      revokeBlobUrl(oldestUrl);
    }
    plugin.heicPreviewCache.set(cacheKey, previewUrl);
    return previewUrl;
  })();

  plugin.heicPreviewPending.set(cacheKey, task);
  try {
    return await task;
  } finally {
    if (plugin.heicPreviewPending.get(cacheKey) === task) {
      plugin.heicPreviewPending.delete(cacheKey);
    }
  }
}

export async function getItemPreviewUrl(plugin, item) {
  const ext = getExt(item.name);
  if (!IMAGE_EXTS.has(ext)) return null;

  if (typeof item.loadThumbUrl === 'function') {
    return item.loadThumbUrl();
  }

  if (typeof item.loadPreviewUrl === 'function') {
    return item.loadPreviewUrl();
  }

  if (item.source === 'remote') {
    return item.rawObj?.rawUrl || null;
  }

  const tfile = item.rawObj;
  if (!tfile) return null;

  if (NEEDS_TRANSCODE_IMAGE_EXTS.has(ext)) {
    return getOrCreateHeicPreviewUrl(plugin, tfile, ext);
  }

  return plugin.app.vault.getResourcePath(tfile);
}

export function updateCommandNames(plugin) {
  if (!plugin.pluginCommandDefs || !plugin.app?.commands?.commands) return;
  for (const cmd of plugin.pluginCommandDefs) {
    const fullId = `${plugin.manifest.id}:${cmd.id}`;
    const registered = plugin.app.commands.commands[fullId];
    if (registered) {
      registered.name = plugin.t(cmd.nameKey);
    }
  }
}

export function onLanguageChange(plugin) {
  updateSidebarRibbonButton(plugin);
  updateCommandNames(plugin);
  for (const leaf of plugin.app?.workspace?.getLeavesOfType?.(VIEW_TYPE_REMOTE_GALLERY) || []) {
    if (leaf.view?.rebuild) leaf.view.rebuild();
    else leaf.view?.render?.();
  }
}

export function getCompatibilityMessage(plugin, compat) {
  if (!compat) return plugin.t(plugin.settings.serverVerified ? 'serverVerifiedBadge' : 'serverUnverifiedHint');
  switch (compat.status) {
    case 'compatible': return plugin.t('compatStatusOk', { serverVer: compat.serverVersion, count: compat.assetCount || 0 });
    case 'server_outdated': return plugin.t('compatStatusServerOld', { serverVer: compat.serverVersion, minServerVer: compat.minServerVersion });
    case 'plugin_outdated': return plugin.t('compatStatusPluginOld', { minPluginVer: compat.minPluginVersion, currentVer: compat.pluginVersion });
    case 'api_incompatible': return plugin.t('compatStatusApiIncompatible', { apiVer: compat.apiVersion ?? '?', supportedVer: compat.supportedApiVersion ?? 1 });
    case 'auth_failed': return plugin.t('compatStatusAuthFail');
    case 'token_missing': return plugin.t('compatStatusTokenMissing');
    case 'server_error': return plugin.t('compatStatusServerError', { code: compat.statusCode || '' });
    default: return plugin.t('compatStatusOffline', { err: compat.error || '' });
  }
}

export function reconcileGalleryLeaves(plugin) {
  if (plugin.isUnloading || plugin.reconcilingGalleryLeaves) return null;
  const workspace = plugin.app.workspace;
  const leaves = workspace.getLeavesOfType?.(VIEW_TYPE_REMOTE_GALLERY) || [];
  const keep = leaves.includes(workspace.activeLeaf) ? workspace.activeLeaf : leaves[0];
  plugin.reconcilingGalleryLeaves = true;
  try {
    for (const leaf of leaves) if (leaf !== keep) leaf.detach();
  } finally {
    plugin.reconcilingGalleryLeaves = false;
  }
  return keep || null;
}

export async function initGalleryLeaf(plugin, reveal = false) {
  if (plugin.isUnloading || !plugin.isRemoteServerReady()) return null;
  const { workspace } = plugin.app;
  if (!plugin.galleryLeafPromise) {
    const pending = (async () => {
      let leaf = reconcileGalleryLeaves(plugin);
      if (!leaf) {
        leaf = workspace.getRightLeaf(false);
        if (!leaf) throw new Error(plugin.t('galleryPanelUnavailable'));
        await leaf.setViewState({ type: VIEW_TYPE_REMOTE_GALLERY, active: false });
      }
      return leaf;
    })();
    plugin.galleryLeafPromise = pending;
    pending.finally(() => { if (plugin.galleryLeafPromise === pending) plugin.galleryLeafPromise = null; }).catch(() => {});
  }
  const leaf = await plugin.galleryLeafPromise;
  if (!plugin.isUnloading && reveal && leaf) await workspace.revealLeaf(leaf);
  return leaf;
}

export function insertMarkdownToActiveEditor(plugin, mdSnippet, successNotice, target = undefined) {
  const insertionTarget = target === undefined ? captureInsertionTarget(plugin) : target;
  const result = insertLinkAtTarget(plugin, mdSnippet, insertionTarget, { appendNewlineOnEmptyLine: false });
  if (!result.inserted) {
    new Notice(result.reason);
    return false;
  }
  const leaf = insertionTarget.view.leaf;
  if (leaf) plugin.app.workspace.setActiveLeaf(leaf, { focus: true });
  if (successNotice) new Notice(successNotice);
  return true;
}
