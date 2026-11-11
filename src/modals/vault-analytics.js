import { moduleHeading } from "../ui/navigation.js";
import { scanVaultAnalytics, exportAnalyticsReportToRoot } from '../plugin/health-analytics.js';
import { formatBytes } from '../engine.js';
import { returnToHub } from './common.js';
import { FileMasterModal as Modal } from '../ui/modal.js';

/**
 * Vault Wrapped & Storage Analytics Dashboard Modal
 */
export class VaultAnalyticsModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.stats = null;
  }

  async onOpen() {
    const t = (k, p) => this.plugin.t(k, p);
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('fm-wizard-modal');

    moduleHeading(this,contentEl,{title:'actAnalyticsTitle',symbol:'chart-no-axes-combined'});

    const loadingEl = contentEl.createDiv({
      cls: 'fm-section-box',
      text: t('analyticsLoading'),
      attr: { style: 'text-align: center; padding: 32px 20px;' }
    });

    try {
      this.stats = await scanVaultAnalytics(this.plugin);
      loadingEl.remove();
      this.renderDashboard(contentEl);
    } catch (err) {
      loadingEl.setText(t('analyticsFail', { err: err.message }));
    }
  }

  renderDashboard(contentEl) {
    const t = (k, p) => this.plugin.t(k, p);
    const s = this.stats;

    const statGrid = contentEl.createDiv({ cls: 'fm-health-stat-grid' });
    const addStat = (num, label, color) => {
      const card = statGrid.createDiv({ cls: 'fm-health-stat-card' });
      const numEl = card.createDiv({ cls: 'fm-health-stat-num', text: String(num) });
      if (color) numEl.style.color = color;
      card.createDiv({ cls: 'fm-health-stat-label', text: label });
    };

    addStat(s.noteCount + s.canvasCount, `${t('analyticsStatNotes')} (${s.noteCount} md / ${s.canvasCount} canvas)`);
    addStat(s.totalWords.toLocaleString(), t('analyticsStatWords'), '#10b981');
    addStat(s.totalInternalLinks.toLocaleString(), t('analyticsStatLinks'), '#3b82f6');
    addStat(
      formatBytes(s.local.totalBytes + s.remote.rawBytes),
      t('analyticsStatStorage'),
      '#8b5cf6'
    );

    const storageBox = contentEl.createDiv({ cls: 'fm-section-box' });
    storageBox.createDiv({ text: t('analyticsStorageComparison'), cls: 'fm-section-title' });

    const totalCombinedBytes = Math.max(1, s.local.totalBytes + s.remote.rawBytes);
    const localPct = Math.round((s.local.totalBytes / totalCombinedBytes) * 100);
    const remotePct = 100 - localPct;

    const summaryRow = storageBox.createDiv({
      attr: { style: 'display:grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 8px;' }
    });

    const localCard = summaryRow.createDiv({
      attr: { style: 'padding: 12px; border-radius: 8px; background: var(--background-primary); border: 1px solid var(--background-modifier-border);' }
    });
    localCard.createDiv({ text: t('analyticsLocalVault'), attr: { style: 'font-weight: 600; font-size: 13px;' } });
    localCard.createDiv({
      text: `${s.local.totalCount} · ${formatBytes(s.local.totalBytes)} (${localPct}%)`,
      attr: { style: 'font-size: 15px; font-weight: 700; margin-top: 4px; color: var(--text-accent);' }
    });
    localCard.createDiv({
      text: t('analyticsLocalStats', {
        img: s.local.imageCount,
        imgBytes: formatBytes(s.local.imageBytes),
        aud: s.local.audioCount,
        audBytes: formatBytes(s.local.audioBytes),
        oth: s.local.otherCount,
        othBytes: formatBytes(s.local.otherBytes)
      }),
      attr: { style: 'font-size: 11px; color: var(--text-muted); margin-top: 6px;' }
    });

    const remoteCard = summaryRow.createDiv({
      attr: { style: 'padding: 12px; border-radius: 8px; background: var(--background-primary); border: 1px solid var(--background-modifier-border);' }
    });
    remoteCard.createDiv({ text: t('analyticsRemoteServer'), attr: { style: 'font-weight: 600; font-size: 13px;' } });
    remoteCard.createDiv({
      text: `${s.remote.totalCount} · ${formatBytes(s.remote.rawBytes)} (${remotePct}%)`,
      attr: { style: 'font-size: 15px; font-weight: 700; margin-top: 4px; color: #10b981;' }
    });
    remoteCard.createDiv({
      text: t('analyticsRemoteStats', {
        cache: formatBytes(s.remote.cacheBytes),
        locked: s.remote.lockedCount
      }),
      attr: { style: 'font-size: 11px; color: var(--text-muted); margin-top: 6px;' }
    });

    if (s.topLargestAttachments.length > 0) {
      const topBox = contentEl.createDiv({ cls: 'fm-section-box' });
      topBox.createDiv({ text: t('analyticsTopLargest'), cls: 'fm-section-title' });
      const listEl = topBox.createDiv({ cls: 'fm-scroll-list', attr: { style: 'max-height: 210px;' } });
      for (const item of s.topLargestAttachments) {
        const row = listEl.createDiv({ cls: 'fm-list-item' });
        const badge = item.source === 'local' ? t('analyticsBadgeLocal') : t('analyticsBadgeRemote');
        row.createSpan({
          text: `${badge} · ${item.path}`,
          attr: { style: 'font-size: 12px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;' }
        });
        row.createSpan({
          text: formatBytes(item.size),
          attr: { style: 'font-size: 12px; font-weight: 600; color: var(--text-muted); flex-shrink: 0;' }
        });
      }
    }

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const exportBtn = btnRow.createEl('button', {
      text: t('analyticsExportReport'),
      cls: 'mod-cta'
    });
    exportBtn.onclick = async () => {
      await exportAnalyticsReportToRoot(this.plugin, s);
    };

    const closeBtn = btnRow.createEl('button', { text: t(this.fromHub ? 'btnCancel' : 'closeBtn') });
    closeBtn.onclick = () => returnToHub(this);
  }

  onClose() {
    this.contentEl.empty();
  }
}
