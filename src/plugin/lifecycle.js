import { isInsertionTargetValid, refreshInsertionTarget } from './editor-target.js';
import { loadOperationLogs } from './logging.js';
import { isScannableDocFile, updateSidebarRibbonButton, openModalSafely, safeModifyFileContent } from './vault-utils.js';
import { checkServerCompatibility, filterAllowedFiles, handleIncomingBrowserFile } from './server-client.js';
import { setupHeicInlinePreviewObserver, registerContextMenus } from './context-menus.js';
import { resumePendingMigration, migrateActiveNoteAttachments, downloadActiveNoteRemoteAttachments, copyActiveNoteForAstro } from './attachment-ops.js';
import { VIEW_TYPE_REMOTE_GALLERY } from '../constants.js';
import { BatchMigrateWizardModal } from '../modals/batch-migrate-wizard.js';
import { DuplicateWizardModal } from '../modals/duplicate-wizard.js';
import { HealthCheckModal } from '../modals/health-check.js';
import { FileMasterHubModal } from '../modals/hub.js';
import { OperationLogModal } from '../modals/operation-log.js';
import { OrphanWizardModal } from '../modals/orphan-wizard.js';
import { RemoteGalleryModal, RemoteGalleryView } from '../modals/remote-gallery.js';
import { VaultAnalyticsModal } from '../modals/vault-analytics.js';
import { FileMasterSettingTab } from '../settings-tab.js';
import { MarkdownView, Notice, Platform } from 'obsidian';

// The plugin owns host state; these operations receive it explicitly.
export async function onload(plugin) {
  plugin.isUnloading = false;
  await plugin.loadSettings();
  // Page preview source registration was added in Obsidian 1.1.
  plugin.registerHoverLinkSource?.('file-master', { display:'File Master', defaultMod:false });
  plugin.operationLogs = [];
  await loadOperationLogs(plugin);
  plugin.heicPreviewCache = new Map();
  plugin.sidebarRibbonEl = null;
  plugin.lastServerCompatStatus = null;
  plugin.lastActiveMarkdownView = null;
  plugin.referenceRevision = 0;
  for (const event of ['create', 'modify', 'delete', 'rename']) {
    plugin.registerEvent(plugin.app.vault.on(event, (file) => {
      if (isScannableDocFile(plugin, file)) plugin.referenceRevision++;
    }));
  }

  // Initialize configurable left sidebar ribbon button
  updateSidebarRibbonButton(plugin);

  // Register remote asset gallery sidebar view
  plugin.registerView(
    VIEW_TYPE_REMOTE_GALLERY,
    (leaf) => new RemoteGalleryView(leaf, plugin)
  );
  plugin.registerEvent(plugin.app.workspace.on('layout-change', () => reconcileGalleryLeaves(plugin)));

  // Track active markdown editor leaf changes for reliable cursor insertion
  plugin.registerEvent(
    plugin.app.workspace.on('active-leaf-change', (leaf) => {
      if (leaf?.view instanceof MarkdownView) {
        plugin.lastActiveMarkdownView = leaf.view;
      }
    })
  );
  plugin.registerEvent(
    plugin.app.workspace.on('file-open', () => {
      const mdView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
      if (mdView) {
        plugin.lastActiveMarkdownView = mdView;
      }
    })
  );

  // Obsidian restores registered views itself, including during plugin upgrades.
  // Creating a leaf here races its asynchronous view restoration and duplicates tabs.
  plugin.app.workspace.onLayoutReady(() => {
    if (plugin.isUnloading) return;
    const activeMd = plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeMd) {
      plugin.lastActiveMarkdownView = activeMd;
    }
    reconcileGalleryLeaves(plugin);
  });

  // Background non-blocking handshake to verify version contract and connectivity
  plugin.compatCheckTimer = setTimeout(() => {
    plugin.compatCheckTimer = null;
    if (!plugin.isUnloading) {
      checkServerCompatibility(plugin).catch(() => {});
    }
  }, 1200);

  // 1. Listen for clipboard paste events
  plugin.registerEvent(
    plugin.app.workspace.on('editor-paste', async (evt, editor) => {
      if (!plugin.settings.enableClipboardMonitor) return;
      const files = evt.clipboardData?.files;
      if (!files || files.length === 0) return;

      const targetFiles = filterAllowedFiles(plugin.settings, files);
      if (targetFiles.length === 0) return;

      evt.preventDefault();
      const insertionRange = captureEditorRange(editor, null);
      for (const f of targetFiles) {
        await handleIncomingBrowserFile(plugin, f, editor, { insertionRange });
      }
    })
  );

  // 2. Listen for drag-and-drop file events in editor
  plugin.registerEvent(
    plugin.app.workspace.on('editor-drop', async (evt, editor) => {
      if (!plugin.settings.enableClipboardMonitor) return;
      const files = evt.dataTransfer?.files;
      if (!files || files.length === 0) return;

      const targetFiles = filterAllowedFiles(plugin.settings, files);
      if (targetFiles.length === 0) return;

      evt.preventDefault();
      const insertionRange = captureEditorRange(editor, evt);
      for (const f of targetFiles) {
        await handleIncomingBrowserFile(plugin, f, editor, { insertionRange });
      }
    })
  );

  // 3. Render inline previews for local ![[xxx.heic]], ![[xxx.heif]], and ![[xxx.tiff]] embeds
  setupHeicInlinePreviewObserver(plugin);

  // 4. Register file tree context menu items
  registerContextMenus(plugin);

  // 5. Register core commands
  registerPluginCommands(plugin);

  plugin.addSettingTab(new FileMasterSettingTab(plugin.app, plugin));
  console.log('[FileMaster] Plugin loaded successfully');
}

export function registerPluginCommands(plugin) {
  plugin.pluginCommandDefs = [
    {
      id: 'resume-pending-upload',
      nameKey: 'cmdResumeUpload',
      requiresRemote: true,
      callback: () => resumePendingMigration(plugin).catch((err) => new Notice(err.message))
    },
    {
      id: 'open-control-center',
      nameKey: 'cmdOpenHub',
      callback: () => openModalSafely(new FileMasterHubModal(plugin.app, plugin))
    },
    {
      id: 'open-health-check-wizard',
      nameKey: 'cmdScanHealth',
      callback: () => openModalSafely(new HealthCheckModal(plugin.app, plugin))
    },
    {
      id: 'open-orphan-wizard',
      nameKey: 'cmdScanOrphan',
      callback: () => openModalSafely(new OrphanWizardModal(plugin.app, plugin))
    },
    {
      id: 'open-duplicate-wizard',
      nameKey: 'cmdScanDuplicate',
      callback: () => openModalSafely(new DuplicateWizardModal(plugin.app, plugin))
    },
    {
      id: 'open-remote-gallery',
      nameKey: 'cmdRemoteGallery',
      requiresRemote: true,
      callback: () => openModalSafely(new RemoteGalleryModal(plugin.app, plugin))
    },
    {
      id: 'open-remote-gallery-view',
      nameKey: 'cmdRemoteGalleryView',
      requiresRemote: true,
      callback: () => activateGalleryView(plugin)
    },
    {
      id: 'open-batch-migrate-wizard',
      nameKey: 'cmdBatchMigrate',
      requiresRemote: true,
      callback: () => openModalSafely(new BatchMigrateWizardModal(plugin.app, plugin))
    },
    {
      id: 'open-vault-analytics-dashboard',
      nameKey: 'cmdVaultAnalytics',
      callback: () => openModalSafely(new VaultAnalyticsModal(plugin.app, plugin))
    },
    {
      id: 'migrate-current-note-attachments',
      nameKey: 'cmdMigrateActiveNote',
      requiresRemote: true,
      callback: () => migrateActiveNoteAttachments(plugin)
    },
    {
      id: 'download-current-note-remote-attachments',
      nameKey: 'cmdDownloadActiveNote',
      requiresRemote: true,
      callback: () => downloadActiveNoteRemoteAttachments(plugin)
    },
    {
      id: 'copy-note-with-astro-pub-links',
      nameKey: 'cmdCopyAstroLinks',
      requiresRemote: true,
      callback: () => copyActiveNoteForAstro(plugin)
    },
    {
      id: 'open-operation-logs',
      nameKey: 'cmdOpenOpLogs',
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
    case 'auth_failed': return plugin.t('compatStatusAuthFail');
    case 'token_missing': return plugin.t('compatStatusTokenMissing');
    case 'server_error': return plugin.t('compatStatusServerError', { code: compat.statusCode || '' });
    default: return plugin.t('compatStatusOffline', { err: compat.error || '' });
  }
}

export function onunload(plugin) {
  plugin.isUnloading = true;
  if (plugin.compatCheckTimer) {
    clearTimeout(plugin.compatCheckTimer);
    plugin.compatCheckTimer = null;
  }
  if (plugin.heicScanTimer) {
    clearTimeout(plugin.heicScanTimer);
    plugin.heicScanTimer = null;
  }
  if (plugin.heicPreviewCache) {
    for (const url of plugin.heicPreviewCache.values()) {
      if (typeof url === 'string' && url.startsWith('blob:')) {
        try { URL.revokeObjectURL(url); } catch { }
      }
    }
    plugin.heicPreviewCache.clear();
  }
  plugin.activeTransferController?.abort();
  plugin.galleryStore?.clear();
  // Note: Do NOT detach VIEW_TYPE_REMOTE_GALLERY here, allowing Obsidian workspace layout
  // to persist the docked leaf in the right sidebar across reloads/restarts like Calendar.
  if (plugin.sidebarRibbonEl) {
    plugin.sidebarRibbonEl.remove();
    plugin.sidebarRibbonEl = null;
  }
  if (plugin.heicObserver) {
    plugin.heicObserver.disconnect();
    plugin.heicObserver = null;
  }
}

function reconcileGalleryLeaves(plugin) {
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
  const {workspace} = plugin.app;
  if (!plugin.galleryLeafPromise) {
    const pending = (async () => {
      let leaf = reconcileGalleryLeaves(plugin);
      if (!leaf) {
        leaf = workspace.getRightLeaf(false);
        if (!leaf) throw new Error(plugin.t('galleryPanelUnavailable'));
        await leaf.setViewState({type:VIEW_TYPE_REMOTE_GALLERY, active:false});
      }
      return leaf;
    })();
    plugin.galleryLeafPromise = pending;
    pending.finally(() => { if(plugin.galleryLeafPromise === pending) plugin.galleryLeafPromise = null; }).catch(() => {});
  }
  const leaf = await plugin.galleryLeafPromise;
  if (!plugin.isUnloading && reveal && leaf) await workspace.revealLeaf(leaf);
  return leaf;
}

export async function activateGalleryView(plugin) {
  if (!plugin.isRemoteServerReady()) {
    new Notice(plugin.t('remoteServerRequiredNotice'));
    return;
  }
  if (Platform.isMobile) return openModalSafely(new RemoteGalleryModal(plugin.app, plugin));
  return initGalleryLeaf(plugin, true);
}

function captureEditorRange(editor, evt) {
  if (!editor) return null;
  if (evt && typeof evt.clientX === 'number' && typeof evt.clientY === 'number') {
    try {
      if (typeof editor.posAtCoords === 'function') {
        const pos = editor.posAtCoords(evt.clientX, evt.clientY);
        if (pos && typeof pos.line === 'number' && typeof pos.ch === 'number') {
          return { from: { ...pos }, to: { ...pos } };
        }
      }
      if (editor.cm && typeof editor.cm.posAtCoords === 'function' && typeof editor.offsetToPos === 'function') {
        const offset = editor.cm.posAtCoords({ x: evt.clientX, y: evt.clientY });
        if (typeof offset === 'number' && offset >= 0) {
          const pos = editor.offsetToPos(offset);
          if (pos && typeof pos.line === 'number' && typeof pos.ch === 'number') {
            return { from: { ...pos }, to: { ...pos } };
          }
        }
      }
    } catch { }
  }
  const from = editor.getCursor?.('from');
  const to = editor.getCursor?.('to') || from;
  if (from && typeof from.line === 'number' && typeof from.ch === 'number') {
    return { from: { ...from }, to: { ...to } };
  }
  return null;
}

export function insertMarkdownToActiveEditor(plugin, mdSnippet, successNotice, target = undefined) {
  if (target !== undefined && !isInsertionTargetValid(plugin,target)) {new Notice(plugin.t("galleryOpenNoteFirst"));return false;}
  let mdView = target?.view || plugin.app.workspace.getActiveViewOfType(MarkdownView);
  if (!mdView && plugin.lastActiveMarkdownView) {
    const leaves = plugin.app.workspace.getLeavesOfType('markdown');
    if (leaves.some(l => l.view === plugin.lastActiveMarkdownView)) {
      mdView = plugin.lastActiveMarkdownView;
    }
  }
  if (!mdView) {
    const leaves = plugin.app.workspace.getLeavesOfType('markdown');
    if (leaves.length > 0) {
      const visibleLeaf = leaves.find(l => l.view?.containerEl && l.view.containerEl.isShown?.() !== false);
      mdView = (visibleLeaf || leaves[0]).view;
    }
  }

  const activeFile = mdView?.file || plugin.app.workspace.getActiveFile();
  if (!activeFile || activeFile.extension !== 'md') {
    new Notice(plugin.t('galleryOpenNoteFirst') || 'Please open a Markdown note first');
    return false;
  }

  if (mdView?.editor) {
    const editor = mdView.editor;
    if(target?.content !== undefined && target.content !== editor.getValue()) {new Notice(plugin.t('galleryTargetChanged'));return false;}
    if(target?.from && target?.to) {
      editor.replaceRange(mdSnippet,target.from,target.to);
      const lines=mdSnippet.split('\n');
      editor.setCursor({line:target.from.line+lines.length-1,ch:lines.length===1?target.from.ch+lines[0].length:lines.at(-1).length});
    }
    else editor.replaceSelection(mdSnippet);
    if(target) refreshInsertionTarget(target);
    if (mdView.leaf) {
      plugin.app.workspace.setActiveLeaf(mdView.leaf, { focus: true });
    }
    editor.focus();
    if (successNotice) new Notice(successNotice);
    return true;
  } else {
    safeModifyFileContent(plugin, activeFile, (content) => content + '\n' + mdSnippet).then(() => {
      if (successNotice) new Notice(successNotice);
    });
    return true;
  }
}
