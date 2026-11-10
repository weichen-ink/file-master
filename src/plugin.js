import { Plugin } from 'obsidian';
import * as attachmentOps from './plugin/attachment-ops.js';
import * as contextMenus from './plugin/context-menus.js';
import * as healthAnalytics from './plugin/health-analytics.js';
import * as lifecycle from './plugin/lifecycle.js';
import * as linkRewrite from './plugin/link-rewrite.js';
import * as logging from './plugin/logging.js';
import * as serverClient from './plugin/server-client.js';
import * as vaultScans from './plugin/vault-scans.js';
import * as vaultUtils from './plugin/vault-utils.js';
import { DEFAULT_SETTINGS } from './constants.js';
import { computeVaultStatsFromEntries, isReportFile, scanNoteContentForBrokenLinks } from './engine.js';
import { translateUi } from './i18n.js';
import { HealthCheckModal } from './modals/health-check.js';
import { VaultAnalyticsModal } from './modals/vault-analytics.js';

export class FileMasterPlugin extends Plugin {
  executeDuplicateMergeSafely(...args) {
    return attachmentOps.executeDuplicateMergeSafely(this, ...args);
  }

  mergeDuplicateGroups(...args) {
    return attachmentOps.mergeDuplicateGroups(this, ...args);
  }

  migrateSingleLocalFileToRemote(...args) {
    return attachmentOps.migrateSingleLocalFileToRemote(this, ...args);
  }

  resumePendingMigration(...args) {
    return attachmentOps.resumePendingMigration(this, ...args);
  }

  downloadSingleRemoteItemToLocal(...args) {
    return attachmentOps.downloadSingleRemoteItemToLocal(this, ...args);
  }

  downloadRemoteItemToLocal(...args) {
    return attachmentOps.downloadRemoteItemToLocal(this, ...args);
  }

  scanActiveNoteRemoteAttachments(...args) {
    return attachmentOps.scanActiveNoteRemoteAttachments(this, ...args);
  }

  executeDownloadNoteDirect(...args) {
    return attachmentOps.executeDownloadNoteDirect(this, ...args);
  }

  downloadActiveNoteRemoteAttachments(...args) {
    return attachmentOps.downloadActiveNoteRemoteAttachments(this, ...args);
  }

  scanLocalAttachmentsForBatchMigrate(...args) {
    return attachmentOps.scanLocalAttachmentsForBatchMigrate(this, ...args);
  }

  executeBatchMigrateSafely(...args) {
    return attachmentOps.executeBatchMigrateSafely(this, ...args);
  }

  scanActiveNoteLocalAttachments(...args) {
    return attachmentOps.scanActiveNoteLocalAttachments(this, ...args);
  }

  executeMigrateNoteDirect(...args) {
    return attachmentOps.executeMigrateNoteDirect(this, ...args);
  }

  migrateActiveNoteAttachments(...args) {
    return attachmentOps.migrateActiveNoteAttachments(this, ...args);
  }

  copyActiveNoteForAstro(...args) {
    return attachmentOps.copyActiveNoteForAstro(this, ...args);
  }

  registerContextMenus(...args) {
    return contextMenus.registerContextMenus(this, ...args);
  }

  extractRemoteItemFromLine(...args) {
    return contextMenus.extractRemoteItemFromLine(this, ...args);
  }

  extractLocalAttachmentFromLine(...args) {
    return contextMenus.extractLocalAttachmentFromLine(this, ...args);
  }

  setupHeicInlinePreviewObserver(...args) {
    return contextMenus.setupHeicInlinePreviewObserver(this, ...args);
  }

  renderSingleHeicEmbed(...args) {
    return contextMenus.renderSingleHeicEmbed(this, ...args);
  }

  scanVaultLinkHealth(...args) {
    return healthAnalytics.scanVaultLinkHealth(this, ...args);
  }

  exportHealthReportToRoot(...args) {
    return healthAnalytics.exportHealthReportToRoot(this, ...args);
  }

  scanVaultAnalytics(...args) {
    return healthAnalytics.scanVaultAnalytics(this, ...args);
  }

  exportAnalyticsReportToRoot(...args) {
    return healthAnalytics.exportAnalyticsReportToRoot(this, ...args);
  }

  onload(...args) {
    return lifecycle.onload(this, ...args);
  }

  registerPluginCommands(...args) {
    return lifecycle.registerPluginCommands(this, ...args);
  }

  updateCommandNames(...args) {
    return lifecycle.updateCommandNames(this, ...args);
  }

  onLanguageChange(...args) {
    return lifecycle.onLanguageChange(this, ...args);
  }

  getCompatibilityMessage(...args) {
    return lifecycle.getCompatibilityMessage(this, ...args);
  }

  onunload(...args) {
    return lifecycle.onunload(this, ...args);
  }

  initGalleryLeaf(...args) {
    return lifecycle.initGalleryLeaf(this, ...args);
  }

  activateGalleryView(...args) {
    return lifecycle.activateGalleryView(this, ...args);
  }

  insertMarkdownToActiveEditor(...args) {
    return lifecycle.insertMarkdownToActiveEditor(this, ...args);
  }

  rewriteContentLinks(...args) {
    return linkRewrite.rewriteContentLinks(this, ...args);
  }

  getEffectiveLanguage(...args) {
    return logging.getEffectiveLanguage(this, ...args);
  }

  t(...args) {
    return logging.t(this, ...args);
  }

  isRemoteServerReady(...args) {
    return logging.isRemoteServerReady(this, ...args);
  }

  getLogFilePath(...args) {
    return logging.getLogFilePath(this, ...args);
  }

  loadOperationLogs(...args) {
    return logging.loadOperationLogs(this, ...args);
  }

  saveOperationLogs(...args) {
    return logging.saveOperationLogs(this, ...args);
  }

  logOperation(...args) {
    return logging.logOperation(this, ...args);
  }

  clearOperationLogs(...args) {
    return logging.clearOperationLogs(this, ...args);
  }

  formatLogsForExport(...args) {
    return logging.formatLogsForExport(this, ...args);
  }

  filterAllowedFiles(...args) {
    return serverClient.filterAllowedFiles(this, ...args);
  }

  getCleanServerUrl(...args) {
    return serverClient.getCleanServerUrl(this, ...args);
  }

  handleIncomingBrowserFile(...args) {
    return serverClient.handleIncomingBrowserFile(this, ...args);
  }

  probeRemoteSha256(...args) {
    return serverClient.probeRemoteSha256(this, ...args);
  }

  uploadBufferToServer(...args) {
    return serverClient.uploadBufferToServer(this, ...args);
  }

  toggleRemoteFileLock(...args) {
    return serverClient.toggleRemoteFileLock(this, ...args);
  }

  checkServerCompatibility(...args) {
    return serverClient.checkServerCompatibility(this, ...args);
  }

  fetchServerVersion(...args) {
    return serverClient.fetchServerVersion(this, ...args);
  }

  fetchRemoteFileList(...args) {
    return serverClient.fetchRemoteFileList(this, ...args);
  }

  deleteRemoteFile(...args) {
    return serverClient.deleteRemoteFile(this, ...args);
  }

  buildVaultReferenceSnapshot(...args) {
    return vaultScans.buildVaultReferenceSnapshot(this, ...args);
  }

  isReferenceSnapshotCurrent(...args) {
    return vaultScans.isReferenceSnapshotCurrent(this, ...args);
  }

  indexRemoteReferences(...args) {
    return vaultScans.indexRemoteReferences(this, ...args);
  }

  findReferencingNotesForLocalFile(...args) {
    return vaultScans.findReferencingNotesForLocalFile(this, ...args);
  }

  findReferencingNotesForRemoteItem(...args) {
    return vaultScans.findReferencingNotesForRemoteItem(this, ...args);
  }

  scanUnusedFiles(...args) {
    return vaultScans.scanUnusedFiles(this, ...args);
  }

  exportOrphanReportToRoot(...args) {
    return vaultScans.exportOrphanReportToRoot(this, ...args);
  }

  writeOrUpdateRootReport(...args) {
    return vaultScans.writeOrUpdateRootReport(this, ...args);
  }

  cleanSelectedOrphans(...args) {
    return vaultScans.cleanSelectedOrphans(this, ...args);
  }

  cleanOrphanItems(...args) {
    return vaultScans.cleanOrphanItems(this, ...args);
  }

  scanDuplicateGroups(...args) {
    return vaultScans.scanDuplicateGroups(this, ...args);
  }

  exportDuplicateReportToRoot(...args) {
    return vaultScans.exportDuplicateReportToRoot(this, ...args);
  }

  exportBatchMigrateReportToRoot(...args) {
    return vaultScans.exportBatchMigrateReportToRoot(this, ...args);
  }

  openNoteAtLine(...args) {
    return vaultScans.openNoteAtLine(this, ...args);
  }

  isDocFile(...args) {
    return vaultUtils.isDocFile(this, ...args);
  }

  isScannableDocFile(...args) {
    return vaultUtils.isScannableDocFile(this, ...args);
  }

  isExcalidrawFile(...args) {
    return vaultUtils.isExcalidrawFile(this, ...args);
  }

  reloadOpenExcalidrawViews(...args) {
    return vaultUtils.reloadOpenExcalidrawViews(this, ...args);
  }

  safeModifyFileContent(...args) {
    return vaultUtils.safeModifyFileContent(this, ...args);
  }

  openModalSafely(...args) {
    return vaultUtils.openModalSafely(this, ...args);
  }

  updateSidebarRibbonButton(...args) {
    return vaultUtils.updateSidebarRibbonButton(this, ...args);
  }

  getExcludedLocalFolderList(...args) {
    return vaultUtils.getExcludedLocalFolderList(this, ...args);
  }

  isLocalPathExcluded(...args) {
    return vaultUtils.isLocalPathExcluded(this, ...args);
  }

  toggleLocalFolderExclusion(...args) {
    return vaultUtils.toggleLocalFolderExclusion(this, ...args);
  }

  getAllVaultFolderPaths(...args) {
    return vaultUtils.getAllVaultFolderPaths(this, ...args);
  }

  getItemPreviewUrl(...args) {
    return vaultUtils.getItemPreviewUrl(this, ...args);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

FileMasterPlugin.scanNoteContentForBrokenLinks = scanNoteContentForBrokenLinks;
FileMasterPlugin.computeVaultStatsFromEntries = computeVaultStatsFromEntries;
FileMasterPlugin.isReportFile = isReportFile;
FileMasterPlugin.translateUi = translateUi;
FileMasterPlugin.HealthCheckModal = HealthCheckModal;
FileMasterPlugin.VaultAnalyticsModal = VaultAnalyticsModal;

export default FileMasterPlugin;
