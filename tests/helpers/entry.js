// Explicit exports for unit tests; this module is never part of the release entry.
export * from '../../src/constants.js';
export * from '../../src/engine.js';
export * from '../../src/references.js';
export * from '../../src/transfers.js';
export * from '../../src/gallery.js';
export * from '../../src/i18n.js';
export * from '../../src/modals/incoming-file.js';
export * from '../../src/modals/active-note.js';
export * from '../../src/modals/batch-migrate-wizard.js';
export * from '../../src/modals/duplicate-wizard.js';
export * from '../../src/modals/remote-gallery.js';

export { registerContextMenus } from '../../src/plugin/context-menus.js';
export { registerPluginCommands } from '../../src/plugin/lifecycle.js';
export { exportBatchMigrateReportToRoot } from '../../src/plugin/vault-scans.js';
export { OperationLogModal } from '../../src/modals/operation-log.js';
export { getExcludedLocalFolderList, isLocalPathExcluded, getOrCreateHeicPreviewUrl, clearHeicPreviewCache } from '../../src/plugin/vault-utils.js';
export { captureEditorTarget, insertLinkAtTarget } from '../../src/plugin/editor-target.js';
export { filterAllowedFiles } from '../../src/plugin/server-client.js';
export { OrphanWizardModal } from '../../src/modals/orphan-wizard.js';
export { FileMasterSettingTab } from '../../src/settings-tab.js';
export { FileMasterHubModal } from '../../src/modals/hub.js';
export * as scans from '../../src/plugin/vault-scans.js';
export * as analytics from '../../src/plugin/health-analytics.js';
export * as attachmentOps from '../../src/plugin/attachment-ops.js';
export * as serverClient from '../../src/plugin/server-client.js';
export * as logging from '../../src/plugin/logging.js';

export * from '../../src/ui/navigation.js';
export * from '../../src/ui/gallery-store.js';
export * from '../../src/ui/gallery-filter.js';
export * from '../../src/ui/gallery-toolbar.js';
export * from '../../src/ui/image-viewport.js';
export * from '../../src/ui/links.js';
export * from '../../src/plugin/editor-target.js';
export { initGalleryLeaf, insertMarkdownToActiveEditor } from '../../src/plugin/lifecycle.js';
export { NoteRefsModal, ImageLightboxModal } from '../../src/modals/dialogs.js';

export { RemoteTrashModal } from '../../src/modals/remote-trash.js';
export { ConfirmActionModal } from '../../src/modals/dialogs.js';
export * from '../../src/plugin/remote-rename.js';
export { RemoteRenameModal } from '../../src/modals/remote-rename.js';
export { HealthCheckModal } from '../../src/modals/health-check.js';

export { VaultAnalyticsModal } from '../../src/modals/vault-analytics.js';
export { fileReferenceDocuments } from '../../src/plugin/file-references.js';
export { documentRow } from '../../src/ui/document-list.js';
export { fileReferenceButton } from '../../src/ui/file-action-list.js';

export * from '../../src/ui/remote-file-pages.js';
export * from '../../src/plugin/rename-reference-plan.js';
