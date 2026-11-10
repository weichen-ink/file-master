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
export { getExcludedLocalFolderList, isLocalPathExcluded } from '../../src/plugin/vault-utils.js';
export { filterAllowedFiles } from '../../src/plugin/server-client.js';
export { OrphanWizardModal } from '../../src/modals/orphan-wizard.js';
export { FileMasterSettingTab } from '../../src/settings-tab.js';
export { FileMasterHubModal } from '../../src/modals/hub.js';
