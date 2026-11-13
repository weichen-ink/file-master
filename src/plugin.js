import { Plugin } from 'obsidian';
import * as attachmentOps from './plugin/attachment-ops.js';
import * as lifecycle from './plugin/lifecycle.js';
import * as linkRewrite from './plugin/link-rewrite.js';
import * as logging from './plugin/logging.js';
import * as serverClient from './plugin/server-client.js';
import * as vaultScans from './plugin/vault-scans.js';
import { DEFAULT_SETTINGS } from './constants.js';
import { computeVaultStatsFromEntries, isReportFile, scanNoteContentForBrokenLinks } from './engine.js';
import { translateUi } from './i18n.js';
import { HealthCheckModal } from './modals/health-check.js';
import { VaultAnalyticsModal } from './modals/vault-analytics.js';

// Host lifecycle and stable I/O/operation boundaries remain methods so callers can
// supply test adapters. UI and internal operations import their modules directly.
export class FileMasterPlugin extends Plugin {
  downloadSingleRemoteItemToLocal(remoteMatch, options = {}) {
    return attachmentOps.downloadSingleRemoteItemToLocal(this, remoteMatch, options);
  }

  executeDownloadNoteDirect(activeFile, onProgress = null, options = {}) {
    return attachmentOps.executeDownloadNoteDirect(this, activeFile, onProgress, options);
  }

  executeBatchMigrateSafely(selectedItems, options, onProgress, onDone) {
    return attachmentOps.executeBatchMigrateSafely(this, selectedItems, options, onProgress, onDone);
  }

  executeMigrateNoteDirect(activeFile, onProgress = null, options = {}) {
    return attachmentOps.executeMigrateNoteDirect(this, activeFile, onProgress, options);
  }

  onload() {
    return lifecycle.onload(this);
  }

  onunload() {
    return lifecycle.onunload(this);
  }

  rewriteContentLinks(content, removeItem, keepItem, docPathOrContext = '') {
    return linkRewrite.rewriteContentLinks(this, content, removeItem, keepItem, docPathOrContext);
  }

  t(key, params = {}) {
    return logging.t(this, key, params);
  }

  isRemoteServerReady() {
    return logging.isRemoteServerReady(this.settings);
  }

  logOperation(level, action, summary, details = null) {
    return logging.logOperation(this, level, action, summary, details);
  }

  getCleanServerUrl() {
    return serverClient.getCleanServerUrl(this.settings);
  }

  probeRemoteSha256(sha256) {
    return serverClient.probeRemoteSha256(this, sha256);
  }

  uploadBufferToServer(arrayBuffer, filename, mimeType = 'application/octet-stream', options = {}) {
    return serverClient.uploadBufferToServer(this, arrayBuffer, filename, mimeType, options);
  }

  toggleRemoteFileLock(year, month, filename, locked = true) {
    return serverClient.toggleRemoteFileLock(this, year, month, filename, locked);
  }

  fetchRemoteTrash() { return serverClient.fetchRemoteTrash(this); }

  permanentlyDeleteRemoteTrash(id) { return serverClient.permanentlyDeleteRemoteTrash(this,id); }

  restoreRemoteTrash(id) { return serverClient.restoreRemoteTrash(this,id); }

  fetchRemoteFileList(options) {
    return serverClient.fetchRemoteFileList(this, options);
  }

  deleteRemoteFile(year, month, filename, expectedSha256) {
    return serverClient.deleteRemoteFile(this, year, month, filename, expectedSha256);
  }

  buildVaultReferenceSnapshot(scanCtx = {}) {
    return vaultScans.buildVaultReferenceSnapshot(this, scanCtx);
  }

  isReferenceSnapshotCurrent(snapshot) {
    return vaultScans.isReferenceSnapshotCurrent(this, snapshot);
  }

  writeOrUpdateRootReport(reportPath, content) {
    return vaultScans.writeOrUpdateRootReport(this, reportPath, content);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    if (!['keep', 'rule'].includes(this.settings.namingMode)) {
      this.settings.namingMode = 'keep';
    }
    if (!['raw', 'webp'].includes(this.settings.galleryInsertFormat)) {
      this.settings.galleryInsertFormat = this.settings.insertOptimizedLinkOnUpload ? 'webp' : 'raw';
    }
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
