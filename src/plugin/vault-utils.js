import { IMAGE_EXTS, NEEDS_TRANSCODE_IMAGE_EXTS } from '../constants.js';
import { convertBufferToPreviewUrl, getExt, isDocFile as helperIsDocFile, isExcalidrawFile as helperIsExcalidrawFile, isReportFile } from '../engine.js';
import { FileMasterHubModal } from '../modals/hub.js';
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
      openModalSafely(new FileMasterHubModal(plugin.app, plugin));
    }
  );
}

export function getExcludedLocalFolderList(settings) {
  return String(settings.excludedLocalFolders || '')
    .split(/[,;\n]+/)
    .map((s) => s.trim().replace(/^\/+|\/+$/g, ''))
    .filter(Boolean);
}

export function isLocalPathExcluded(settings, filePath) {
  const p = String(filePath || '').replace(/^\/+/, '');
  const list = getExcludedLocalFolderList(settings);
  return list.some((folder) => p === folder || p.startsWith(folder + '/'));
}

export async function toggleLocalFolderExclusion(plugin, folderPath) {
  const clean = String(folderPath || '').replace(/^\/+|\/+$/g, '');
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
  for (const f of app.vault.getFiles()) {
    const parentPath = f.parent?.path;
    if (parentPath && parentPath !== '/') {
      folderSet.add(parentPath);
    }
  }
  return [...folderSet].sort();
}

export async function getItemPreviewUrl(plugin, item) {
  const ext = getExt(item.name);
  if (!IMAGE_EXTS.has(ext)) return null;

  if (item.source === 'remote') {
    return item.rawObj?.rawUrl || null;
  }

  const tfile = item.rawObj;
  if (!tfile) return null;

  if (NEEDS_TRANSCODE_IMAGE_EXTS.has(ext)) {
    const cacheKey = `${tfile.path}:${tfile.stat?.mtime || 0}`;
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
