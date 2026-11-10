import { DEFAULT_SETTINGS } from './constants.js';
import { computeVaultStatsFromEntries, isReportFile, scanNoteContentForBrokenLinks } from './engine.js';
import { translateUi } from './i18n.js';
import { HealthCheckModal } from './modals/health-check.js';
import { VaultAnalyticsModal } from './modals/vault-analytics.js';
import { FileMasterAttachmentOps } from './plugin/attachment-ops.js';

export class FileMasterPlugin extends FileMasterAttachmentOps {
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
