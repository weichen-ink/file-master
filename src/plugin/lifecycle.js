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
import { MarkdownView, Notice } from 'obsidian';

// The plugin owns host state; these operations receive it explicitly.
export async function onload(plugin) {
  await plugin.loadSettings();
  plugin.operationLogs = [];
  await plugin.loadOperationLogs();
  plugin.heicPreviewCache = new Map();
  plugin.sidebarRibbonEl = null;
  plugin.lastServerCompatStatus = null;
  plugin.lastActiveMarkdownView = null;
  plugin.referenceRevision = 0;
  for (const event of ['create', 'modify', 'delete', 'rename']) {
    plugin.registerEvent(plugin.app.vault.on(event, (file) => {
      if (plugin.isScannableDocFile(file)) plugin.referenceRevision++;
    }));
  }

  // Initialize configurable left sidebar ribbon button
  plugin.updateSidebarRibbonButton();

  // Register remote asset gallery sidebar view
  plugin.registerView(
    VIEW_TYPE_REMOTE_GALLERY,
    (leaf) => new RemoteGalleryView(leaf, plugin)
  );

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

  // Auto-init/dock gallery leaf in right sidebar when workspace is ready, persistent like Calendar
  plugin.app.workspace.onLayoutReady(() => {
    const activeMd = plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeMd) {
      plugin.lastActiveMarkdownView = activeMd;
    }
    plugin.initGalleryLeaf(false);
  });

  // Background non-blocking handshake to verify version contract and connectivity
  setTimeout(() => {
    plugin.checkServerCompatibility().catch(() => {});
  }, 1200);

  // 1. Listen for clipboard paste events
  plugin.registerEvent(
    plugin.app.workspace.on('editor-paste', async (evt, editor) => {
      if (!plugin.settings.enableClipboardMonitor) return;
      const files = evt.clipboardData?.files;
      if (!files || files.length === 0) return;

      const targetFiles = plugin.filterAllowedFiles(files);
      if (targetFiles.length === 0) return;

      evt.preventDefault();
      for (const f of targetFiles) {
        await plugin.handleIncomingBrowserFile(f, editor);
      }
    })
  );

  // 2. Listen for drag-and-drop file events in editor
  plugin.registerEvent(
    plugin.app.workspace.on('editor-drop', async (evt, editor) => {
      if (!plugin.settings.enableClipboardMonitor) return;
      const files = evt.dataTransfer?.files;
      if (!files || files.length === 0) return;

      const targetFiles = plugin.filterAllowedFiles(files);
      if (targetFiles.length === 0) return;

      evt.preventDefault();
      for (const f of targetFiles) {
        await plugin.handleIncomingBrowserFile(f, editor);
      }
    })
  );

  // 3. Render inline previews for local ![[xxx.heic]], ![[xxx.heif]], and ![[xxx.tiff]] embeds
  plugin.setupHeicInlinePreviewObserver();

  // 4. Register file tree context menu items
  plugin.registerContextMenus();

  // 5. Register core commands
  plugin.registerPluginCommands();

  plugin.addSettingTab(new FileMasterSettingTab(plugin.app, plugin));
  console.log('[FileMaster] Plugin loaded successfully');
}

export function registerPluginCommands(plugin) {
  plugin.pluginCommandDefs = [
    {
      id: 'resume-pending-upload',
      nameKey: 'cmdResumeUpload',
      requiresRemote: true,
      callback: () => plugin.resumePendingMigration().catch((err) => new Notice(err.message))
    },
    {
      id: 'open-control-center',
      nameKey: 'cmdOpenHub',
      callback: () => plugin.openModalSafely(new FileMasterHubModal(plugin.app, plugin))
    },
    {
      id: 'open-health-check-wizard',
      nameKey: 'cmdScanHealth',
      callback: () => plugin.openModalSafely(new HealthCheckModal(plugin.app, plugin))
    },
    {
      id: 'open-orphan-wizard',
      nameKey: 'cmdScanOrphan',
      callback: () => plugin.openModalSafely(new OrphanWizardModal(plugin.app, plugin))
    },
    {
      id: 'open-duplicate-wizard',
      nameKey: 'cmdScanDuplicate',
      callback: () => plugin.openModalSafely(new DuplicateWizardModal(plugin.app, plugin))
    },
    {
      id: 'open-remote-gallery',
      nameKey: 'cmdRemoteGallery',
      requiresRemote: true,
      callback: () => plugin.openModalSafely(new RemoteGalleryModal(plugin.app, plugin))
    },
    {
      id: 'open-remote-gallery-view',
      nameKey: 'cmdRemoteGalleryView',
      requiresRemote: true,
      callback: () => plugin.activateGalleryView()
    },
    {
      id: 'open-batch-migrate-wizard',
      nameKey: 'cmdBatchMigrate',
      requiresRemote: true,
      callback: () => plugin.openModalSafely(new BatchMigrateWizardModal(plugin.app, plugin))
    },
    {
      id: 'open-vault-analytics-dashboard',
      nameKey: 'cmdVaultAnalytics',
      callback: () => plugin.openModalSafely(new VaultAnalyticsModal(plugin.app, plugin))
    },
    {
      id: 'migrate-current-note-attachments',
      nameKey: 'cmdMigrateActiveNote',
      requiresRemote: true,
      callback: () => plugin.migrateActiveNoteAttachments()
    },
    {
      id: 'download-current-note-remote-attachments',
      nameKey: 'cmdDownloadActiveNote',
      requiresRemote: true,
      callback: () => plugin.downloadActiveNoteRemoteAttachments()
    },
    {
      id: 'copy-note-with-astro-pub-links',
      nameKey: 'cmdCopyAstroLinks',
      requiresRemote: true,
      callback: () => plugin.copyActiveNoteForAstro()
    },
    {
      id: 'open-operation-logs',
      nameKey: 'cmdOpenOpLogs',
      callback: () => plugin.openModalSafely(new OperationLogModal(plugin.app, plugin))
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
  plugin.updateSidebarRibbonButton();
  plugin.updateCommandNames();
  for (const leaf of plugin.app?.workspace?.getLeavesOfType?.(VIEW_TYPE_REMOTE_GALLERY) || []) {
    leaf.view?.render?.();
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
  plugin.activeTransferController?.abort();
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

export async function initGalleryLeaf(plugin, reveal = false) {
  if (!plugin.isRemoteServerReady()) return null;
  const { workspace } = plugin.app;
  let leaves = workspace.getLeavesOfType(VIEW_TYPE_REMOTE_GALLERY);
  let leaf = leaves[0];
  if (!leaf) {
    const rightLeaf = workspace.getRightLeaf(false);
    if (rightLeaf) {
      await rightLeaf.setViewState({
        type: VIEW_TYPE_REMOTE_GALLERY,
        active: false
      });
      leaf = rightLeaf;
    }
  }
  if (leaf && reveal) {
    workspace.revealLeaf(leaf);
  }
  return leaf;
}

export async function activateGalleryView(plugin) {
  if (!plugin.isRemoteServerReady()) {
    new Notice(plugin.t('remoteServerRequiredNotice') || 'Remote server not ready');
    return;
  }
  await plugin.initGalleryLeaf(true);
}

export function insertMarkdownToActiveEditor(plugin, mdSnippet, successNotice) {
  let mdView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
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
    editor.replaceSelection(mdSnippet);
    if (mdView.leaf) {
      plugin.app.workspace.setActiveLeaf(mdView.leaf, { focus: true });
    }
    editor.focus();
    if (successNotice) new Notice(successNotice);
    return true;
  } else {
    plugin.safeModifyFileContent(activeFile, (content) => content + '\n' + mdSnippet).then(() => {
      if (successNotice) new Notice(successNotice);
    });
    return true;
  }
}
