import { moduleHeading } from "../ui/navigation.js";
import { scanVaultAnalytics, exportAnalyticsReportToRoot } from '../plugin/health-analytics.js';
import { openModalSafely } from '../plugin/vault-utils.js';
import { formatBytes } from '../engine.js';
import { returnToHub } from './common.js';
import { OrphanWizardModal } from './orphan-wizard.js';
import { BatchMigrateWizardModal } from './batch-migrate-wizard.js';
import { DuplicateWizardModal } from './duplicate-wizard.js';
import { FileMasterModal as Modal } from '../ui/modal.js';
import { Notice, setIcon } from 'obsidian';
import { fileActionRow, fileMetadata, fileMetaItem, fileReferenceButton } from '../ui/file-action-list.js';

/**
 * Vault Storage & Asset Analytics Dashboard Modal
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

    moduleHeading(this, contentEl, { title: 'actAnalyticsTitle', symbol: 'chart-no-axes-combined' });

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

    // Core count breakdowns
    const noteCount = s.noteCount + s.canvasCount;
    const remoteImgCount = s.remote.imageCount || s.remote.totalCount || 0;
    const totalImages = s.local.imageCount + remoteImgCount;
    const totalOtherAttachments = Math.max(0, (s.local.totalCount + s.remote.totalCount) - totalImages);
    const totalAllFiles = noteCount + s.local.totalCount + s.remote.totalCount;

    // Storage footprint breakdowns
    const rawCombinedBytes = s.local.totalBytes + s.remote.rawBytes;
    const totalCombinedBytes = Math.max(1, rawCombinedBytes);
    const localPct = rawCombinedBytes > 0 ? Math.round((s.local.totalBytes / totalCombinedBytes) * 100) : 0;
    const remotePct = rawCombinedBytes > 0 ? 100 - localPct : 0;
    const cacheCov = s.remote.totalCount > 0 ? Math.round(((s.remote.cachedCount || 0) / s.remote.totalCount) * 100) : 0;

    // ==========================================
    // 模块一：【全库资产数量】（顶部 4 张卡片）
    // ==========================================
    const statGrid = contentEl.createDiv({ cls: 'fm-health-stat-grid' });
    const addStat = (num, label, sub, color) => {
      const card = statGrid.createDiv({
        cls: 'fm-health-stat-card',
        attr: {
          style: 'padding: 10px 8px; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 80px;'
        }
      });
      const numEl = card.createDiv({
        cls: 'fm-health-stat-num',
        text: String(num),
        attr: { style: 'font-size: 20px; font-weight: 700; line-height: 1.2; font-variant-numeric: tabular-nums;' }
      });
      if (color) numEl.style.color = color;
      card.createDiv({
        cls: 'fm-health-stat-label',
        text: label,
        attr: { style: 'font-size: 11px; font-weight: 600; color: var(--text-muted); margin-top: 3px;' }
      });
      card.createDiv({
        text: sub,
        attr: { style: 'font-size: 10px; color: var(--text-faint); margin-top: 3px; font-variant-numeric: tabular-nums; white-space: nowrap;' }
      });
    };

    addStat(
      noteCount,
      t('analyticsStatNotes'),
      t('analyticsStatNotesSub', { md: s.noteCount, cva: s.canvasCount })
    );
    addStat(
      totalImages,
      t('analyticsStatImages'),
      t('analyticsStatImagesSub', { loc: s.local.imageCount, rem: remoteImgCount }),
      'var(--text-success)'
    );
    addStat(
      totalOtherAttachments,
      t('analyticsStatOtherAttachments'),
      t('analyticsStatOtherSub'),
      'var(--text-accent)'
    );
    addStat(
      totalAllFiles,
      t('analyticsStatTotalFiles'),
      t('analyticsStatTotalSub'),
      'var(--text-accent)'
    );

    // ==========================================
    // 模块二：【存储用量分布】（比例条 + 体积对比）
    // ==========================================
    const storageBox = contentEl.createDiv({ cls: 'fm-section-box' });
    storageBox.createDiv({ text: t('analyticsStorageComparison'), cls: 'fm-section-title' });

    const barTrack = storageBox.createDiv({ cls: 'fm-analytics-bar' });
    const barSegments = [
      { cls: 'is-local', bytes: s.local.totalBytes, label: t('analyticsBarLocal'), pct: localPct },
      { cls: 'is-remote', bytes: s.remote.rawBytes, label: t('analyticsBarRemote'), pct: remotePct }
    ].filter((seg) => seg.bytes > 0);
    for (const seg of barSegments) {
      const pct = Math.max(2, (seg.bytes / totalCombinedBytes) * 100);
      barTrack.createDiv({
        cls: `fm-analytics-bar-seg ${seg.cls}`,
        attr: { style: `width: ${pct.toFixed(2)}%;`, title: `${seg.label}: ${formatBytes(seg.bytes)} (${seg.pct}%)` }
      });
    }

    const summaryRow = storageBox.createDiv({
      cls: 'fm-analytics-storage-grid'
    });

    // 本地存储卡片
    const localCard = summaryRow.createDiv({
      attr: { style: 'padding: 12px; border-radius: 8px; background: var(--background-primary); border: 1px solid var(--background-modifier-border);' }
    });
    localCard.createDiv({ text: t('analyticsLocalVault'), attr: { style: 'font-weight: 600; font-size: 13px;' } });
    localCard.createDiv({
      text: `${formatBytes(s.local.totalBytes)} (${localPct}%)`,
      attr: { style: 'font-size: 15px; font-weight: 700; margin-top: 4px; color: var(--text-accent); font-variant-numeric: tabular-nums;' }
    });
    localCard.createDiv({
      text: t('analyticsLocalStats', {
        imgBytes: formatBytes(s.local.imageBytes),
        othBytes: formatBytes(Math.max(0, s.local.totalBytes - s.local.imageBytes))
      }),
      attr: { style: 'font-size: 11px; color: var(--text-muted); margin-top: 6px; line-height: 1.4;' }
    });

    // 服务器存储卡片
    const remoteCard = summaryRow.createDiv({
      attr: { style: 'padding: 12px; border-radius: 8px; background: var(--background-primary); border: 1px solid var(--background-modifier-border);' }
    });
    remoteCard.createDiv({ text: t('analyticsRemoteServer'), attr: { style: 'font-weight: 600; font-size: 13px;' } });
    remoteCard.createDiv({
      text: `${formatBytes(s.remote.rawBytes)} (${remotePct}%)`,
      attr: { style: 'font-size: 15px; font-weight: 700; margin-top: 4px; color: var(--text-success); font-variant-numeric: tabular-nums;' }
    });
    remoteCard.createDiv({
      text: t('analyticsRemoteStats', {
        cache: formatBytes(s.remote.cacheBytes),
        locked: s.remote.lockedCount
      }),
      attr: { style: 'font-size: 11px; color: var(--text-muted); margin-top: 6px; line-height: 1.4;' }
    });

    // ==========================================
    // 模块三：【资产健康与优化建议】（可行动诊断 + 一键跳转）
    // ==========================================
    const allTop = s.topLargestAttachments || [];
    const insightsBox = contentEl.createDiv({ cls: 'fm-section-box' });
    insightsBox.createDiv({ text: t('analyticsInsightsTitle'), cls: 'fm-section-title' });

    const insightsList = insightsBox.createDiv({ cls: 'fm-analytics-insights' });

    const openActionModal = (ModalClass) => {
      this.close();
      openModalSafely(new ModalClass(this.app, this.plugin));
    };

    const addInsightItem = (statusKind, message, action = null) => {
      const isAction = statusKind === 'action';
      const accentColor = isAction ? 'var(--text-warning, #d97706)' : 'var(--text-success, #079455)';
      const itemEl = insightsList.createDiv({ cls: 'fm-analytics-insight-row' });
      itemEl.createSpan({
        cls: `fm-analytics-status-pill ${isAction ? 'is-action' : 'is-good'}`,
        text: t(isAction ? 'analyticsStatusAction' : 'analyticsStatusGood')
      });
      const textSpan = itemEl.createSpan({ cls: 'fm-analytics-insight-text' });
      const parts = String(message || '').split(/(\*\*[^*]+\*\*)/g);
      for (const part of parts) {
        if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
          textSpan.createEl('strong', {
            text: part.slice(2, -2),
            attr: { style: `color: ${accentColor};` }
          });
        } else if (part) {
          textSpan.createSpan({ text: part });
        }
      }
      if (action) {
        const btn = itemEl.createEl('button', {
          text: action.label,
          cls: 'fm-mini-btn',
          attr: { type: 'button' }
        });
        btn.onclick = action.run;
      }
    };

    const unreferencedTop = allTop.filter((item) => Array.isArray(item.referenceDocuments) && item.referenceDocuments.length === 0);
    if (unreferencedTop.length > 0) {
      const wastedBytes = unreferencedTop.reduce((sum, item) => sum + (Number(item.size) || 0), 0);
      addInsightItem(
        'action',
        t('analyticsInsightUnreferencedTop', { count: unreferencedTop.length, size: formatBytes(wastedBytes) }),
        { label: t('analyticsActionOrphan'), run: () => openActionModal(OrphanWizardModal) }
      );
    }

    if (s.local.totalCount > 0 && s.local.totalBytes > 0) {
      const isRemoteReady = Boolean(this.plugin?.settings?.enableRemoteServer && this.plugin?.isRemoteServerReady?.());
      addInsightItem(
        'action',
        t('analyticsInsightLocalOffload', { count: s.local.totalCount, size: formatBytes(s.local.totalBytes) }),
        isRemoteReady ? { label: t('analyticsActionMigrate'), run: () => openActionModal(BatchMigrateWizardModal) } : null
      );
    } else if (remotePct >= 50 && s.remote.rawBytes > 0) {
      addInsightItem('good', t('analyticsInsightStorageRemote', { pct: remotePct }));
    }

    if (s.remote.totalCount > 0) {
      addInsightItem(
        'good',
        t('analyticsInsightCacheReady', {
          cached: s.remote.cachedCount || 0,
          total: s.remote.totalCount,
          pct: cacheCov,
          cache: formatBytes(s.remote.cacheBytes)
        })
      );
    }

    if (s.remote.lockedCount > 0) {
      addInsightItem('good', t('analyticsInsightLockedSafe', { count: s.remote.lockedCount }));
    }

    if (unreferencedTop.length === 0 && totalImages > 1) {
      addInsightItem(
        'good',
        t('analyticsInsightAllHealthy'),
        { label: t('analyticsActionDuplicate'), run: () => openActionModal(DuplicateWizardModal) }
      );
    }

    // ==========================================
    // 模块四：【大体积附件排行】（统一圆角分段控件 + 每页 5 条分页）
    // ==========================================
    if (allTop.length > 0) {
      const PAGE_SIZE = 5;
      const topBox = contentEl.createDiv({ cls: 'fm-section-box' });
      const topHeaderRow = topBox.createDiv({ cls: 'fm-analytics-top-header' });
      topHeaderRow.createDiv({
        text: t('analyticsTopLargest', { count: allTop.length }),
        cls: 'fm-section-title',
        attr: { style: 'margin: 0;' }
      });

      let currentFilter = 'all'; // 'all' | 'local' | 'remote'
      let currentPage = 1;
      const filterGroup = topHeaderRow.createDiv({
        cls: 'fm-gallery-mode-group fm-analytics-filter-group',
        attr: { role: 'group', 'aria-label': t('analyticsTopLargest', { count: allTop.length }) }
      });

      const listEl = topBox.createDiv({ cls: 'fm-file-action-list fm-analytics-files' });
      const pagerEl = topBox.createDiv({ cls: 'fm-analytics-pager' });

      const renderList = () => {
        listEl.empty();
        pagerEl.empty();
        const filtered = allTop.filter(item => {
          if (currentFilter === 'local') return item.source === 'local';
          if (currentFilter === 'remote') return item.source === 'remote';
          return true;
        });

        if (filtered.length === 0) {
          pagerEl.style.display = 'none';
          listEl.createDiv({
            text: t('analyticsFilterEmpty'),
            attr: { style: 'text-align: center; padding: 18px; color: var(--text-faint); font-size: 12px;' }
          });
          return;
        }

        const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
        currentPage = Math.min(Math.max(1, currentPage), totalPages);
        const start = (currentPage - 1) * PAGE_SIZE;
        const pageItems = filtered.slice(start, start + PAGE_SIZE);

        for (const item of pageItems) {
          const {actions} = fileActionRow(listEl,item,this.plugin,{
            metadata:parent=>{
              fileMetaItem(parent,item.source==='local'?'hard-drive':'cloud',t(item.source==='local'?'analyticsBadgeLocal':'analyticsBadgeRemote'));
              const itemPath = item.displayPath || item.path || '';
              if (itemPath.includes('/')) fileMetadata(parent,item,{path:itemPath});
            }
          });
          const references=fileReferenceButton(actions,item,this.plugin,item.referenceDocuments,()=>this.close());
          if(!item.referenceDocuments)references.update(null,true);
          const copy=actions.createEl('button',{cls:'fm-icon-button',attr:{type:'button','aria-label':t('analyticsClickToCopy')}});
          setIcon(copy,'copy');
          copy.onclick=async()=>{
            try { await navigator.clipboard.writeText(item.name); new Notice(t('analyticsCopiedName',{name:item.name})); }
            catch { new Notice(item.name); }
          };
        }

        if (totalPages > 1) {
          pagerEl.style.display = '';
          pagerEl.createSpan({
            cls: 'fm-analytics-page-info',
            text: t('analyticsPageInfo', { page: currentPage, pages: totalPages })
          });
          const nav = pagerEl.createDiv({ cls: 'fm-analytics-page-actions' });
          const prevBtn = nav.createEl('button', { text: t('analyticsPrevPage'), cls: 'fm-mini-btn', attr: { type: 'button' } });
          prevBtn.disabled = currentPage <= 1;
          prevBtn.onclick = () => { if (currentPage > 1) { currentPage--; renderList(); } };
          const nextBtn = nav.createEl('button', { text: t('analyticsNextPage'), cls: 'fm-mini-btn', attr: { type: 'button' } });
          nextBtn.disabled = currentPage >= totalPages;
          nextBtn.onclick = () => { if (currentPage < totalPages) { currentPage++; renderList(); } };
        } else {
          pagerEl.style.display = 'none';
        }
      };

      const filterBtns = new Map();
      const addFilterBtn = (filterKey, label) => {
        const btn = filterGroup.createEl('button', {
          text: label,
          attr: { type: 'button', 'aria-pressed': String(currentFilter === filterKey) }
        });
        btn.onclick = () => {
          currentFilter = filterKey;
          currentPage = 1;
          for (const [key, b] of filterBtns.entries()) {
            b.setAttribute('aria-pressed', String(key === filterKey));
          }
          renderList();
        };
        filterBtns.set(filterKey, btn);
      };

      addFilterBtn('all', `${t('analyticsFilterAll')} (${allTop.length})`);
      const localCount = allTop.filter(i => i.source === 'local').length;
      const remoteCount = allTop.filter(i => i.source === 'remote').length;
      addFilterBtn('local', `${t('analyticsFilterLocal')} (${localCount})`);
      addFilterBtn('remote', `${t('analyticsFilterRemote')} (${remoteCount})`);

      renderList();
    }

    // 动作按钮（统一 [取消/关闭] 在左、主操作 .mod-cta 在右）
    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const closeBtn = btnRow.createEl('button', { text: t(this.fromHub ? 'btnCancel' : 'closeBtn') });
    closeBtn.onclick = () => returnToHub(this);

    const exportBtn = btnRow.createEl('button', {
      text: t('analyticsExportReport'),
      cls: 'mod-cta'
    });
    exportBtn.onclick = async () => {
      await exportAnalyticsReportToRoot(this.plugin, s);
    };
  }

  onClose() {
    this.contentEl.empty();
  }
}
