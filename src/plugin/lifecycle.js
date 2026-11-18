import { trackRenameReferenceChange } from './rename-reference-plan.js';
import { captureEditorTarget } from './editor-target.js';
import { loadOperationLogs } from './logging.js';
import {
  clearHeicPreviewCache,
  getCompatibilityMessage,
  initGalleryLeaf,
  insertMarkdownToActiveEditor,
  isScannableDocFile,
  onLanguageChange,
  openModalSafely,
  reconcileGalleryLeaves,
  updateCommandNames,
  updateSidebarRibbonButton
} from './vault-utils.js';
import { registerPluginModals } from './modal-registry.js';
import { checkServerCompatibility, filterAllowedFiles, handleIncomingBrowserFile } from './server-client.js';
import { setupHeicInlinePreviewObserver, registerContextMenus } from './context-menus.js';
import { resumePendingMigration, migrateActiveNoteAttachments, downloadActiveNoteRemoteAttachments, copyActiveNoteForAstro } from './attachment-ops.js';
import { VIEW_TYPE_REMOTE_GALLERY } from '../constants.js';
import { ActiveNoteActionModal } from '../modals/active-note.js';
import { BatchMigrateWizardModal } from '../modals/batch-migrate-wizard.js';
import { ConfirmActionModal, ImageLightboxModal, NoteRefsModal } from '../modals/dialogs.js';
import { DuplicateWizardModal } from '../modals/duplicate-wizard.js';
import { HealthCheckModal } from '../modals/health-check.js';
import { FileMasterHubModal } from '../modals/hub.js';
import { IncomingFileModal } from '../modals/incoming-file.js';
import { OperationLogModal } from '../modals/operation-log.js';
import { OrphanWizardModal } from '../modals/orphan-wizard.js';
import { RemoteGalleryModal, RemoteGalleryView } from '../modals/remote-gallery.js';
import { VaultAnalyticsModal } from '../modals/vault-analytics.js';
import { FileMasterSettingTab } from '../settings-tab.js';
import { MarkdownView, Notice, Platform } from 'obsidian';

registerPluginModals({
  ActiveNoteActionModal,
  BatchMigrateWizardModal,
  ConfirmActionModal,
  DuplicateWizardModal,
  FileMasterHubModal,
  HealthCheckModal,
  ImageLightboxModal,
  IncomingFileModal,
  NoteRefsModal,
  OperationLogModal,
  OrphanWizardModal,
  RemoteGalleryModal,
  VaultAnalyticsModal
});

export {
  getCompatibilityMessage,
  initGalleryLeaf,
  insertMarkdownToActiveEditor,
  onLanguageChange,
  updateCommandNames
};

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
    plugin.registerEvent(plugin.app.vault.on(event, (file, oldPath) => {
      trackRenameReferenceChange(plugin,file,oldPath);
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
    plugin.app.workspace.on('editor-paste', async (evt, editor, info) => {
      if (!plugin.settings.enableClipboardMonitor) return;
      const files = evt.clipboardData?.files;
      if (!files || files.length === 0) return;

      const targetFiles = filterAllowedFiles(plugin.settings, files);
      if (targetFiles.length === 0) return;

      evt.preventDefault();
      const insertionTarget = captureEditorTarget(plugin, { editor, info });
      for (const f of targetFiles) {
        await handleIncomingBrowserFile(plugin, f, editor, { insertionTarget });
      }
    })
  );

  // 2. Listen for drag-and-drop file events in editor
  plugin.registerEvent(
    plugin.app.workspace.on('editor-drop', async (evt, editor, info) => {
      if (!plugin.settings.enableClipboardMonitor) return;
      const files = evt.dataTransfer?.files;
      if (!files || files.length === 0) return;

      const targetFiles = filterAllowedFiles(plugin.settings, files);
      if (targetFiles.length === 0) return;

      evt.preventDefault();
      const insertionTarget = captureEditorTarget(plugin, { editor, evt, info });
      for (const f of targetFiles) {
        await handleIncomingBrowserFile(plugin, f, editor, { insertionTarget });
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
  clearHeicPreviewCache(plugin);
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

export async function activateGalleryView(plugin) {
  if (!plugin.isRemoteServerReady()) {
    new Notice(plugin.t('remoteServerRequiredNotice'));
    return;
  }
  if (Platform.isMobile) return openModalSafely(new RemoteGalleryModal(plugin.app, plugin));
  return initGalleryLeaf(plugin, true);
}
