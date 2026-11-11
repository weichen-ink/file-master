import { moduleHeading } from "../ui/navigation.js";
import { scanVaultAnalytics, exportAnalyticsReportToRoot } from '../plugin/health-analytics.js';
import { formatBytes } from '../engine.js';
import { returnToHub } from './common.js';
import { FileMasterModal as Modal } from '../ui/modal.js';
import { Notice } from 'obsidian';

/**
 * Vault Storage & Asset Analytics Dashboard Modal
 */
export class VaultAnalyticsModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.stats = null;
    this.hoverPopover = null;
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
    const totalCombinedBytes = Math.max(1, s.local.totalBytes + s.remote.rawBytes);
    const localPct = Math.round((s.local.totalBytes / totalCombinedBytes) * 100);
    const remotePct = 100 - localPct;
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
      '#10b981'
    );
    addStat(
      totalOtherAttachments,
      t('analyticsStatOtherAttachments'),
      t('analyticsStatOtherSub'),
      '#3b82f6'
    );
    addStat(
      totalAllFiles,
      t('analyticsStatTotalFiles'),
      t('analyticsStatTotalSub'),
      '#8b5cf6'
    );

    // ==========================================
    // 模块二：【存储用量分布】（纯粹专注存储体积）
    // ==========================================
    const storageBox = contentEl.createDiv({ cls: 'fm-section-box' });
    storageBox.createDiv({ text: t('analyticsStorageComparison'), cls: 'fm-section-title' });

    const summaryRow = storageBox.createDiv({
      attr: { style: 'display:grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 8px;' }
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
      attr: { style: 'font-size: 15px; font-weight: 700; margin-top: 4px; color: #10b981; font-variant-numeric: tabular-nums;' }
    });
    remoteCard.createDiv({
      text: t('analyticsRemoteStats', {
        cache: formatBytes(s.remote.cacheBytes),
        locked: s.remote.lockedCount
      }),
      attr: { style: 'font-size: 11px; color: var(--text-muted); margin-top: 6px; line-height: 1.4;' }
    });

    // ==========================================
    // 模块三：【资产健康与优化建议】（独立结构化板块）
    // ==========================================
    const insightsBox = contentEl.createDiv({ cls: 'fm-section-box' });
    insightsBox.createDiv({ text: t('analyticsInsightsTitle'), cls: 'fm-section-title' });

    const insightsList = insightsBox.createDiv({
      attr: { style: 'display: flex; flex-direction: column; gap: 6px; margin-top: 8px;' }
    });

    const addInsightItem = (icon, html) => {
      const itemEl = insightsList.createDiv({
        attr: {
          style: 'display: flex; align-items: flex-start; gap: 8px; font-size: 11px; line-height: 1.5; color: var(--text-muted); padding: 2px 0;'
        }
      });
      itemEl.createSpan({ text: icon, attr: { style: 'flex-shrink: 0; font-size: 13px; margin-top: 1px;' } });
      const textSpan = itemEl.createSpan({ attr: { style: 'flex: 1;' } });
      textSpan.innerHTML = html;
    };

    if (localPct >= 70 && s.local.totalBytes > 10 * 1024 * 1024) {
      addInsightItem('📦', t('analyticsInsightStorageLocal', { pct: localPct }));
    } else if (remotePct >= 50) {
      addInsightItem('☁️', t('analyticsInsightStorageRemote', { pct: remotePct }));
    }

    if (cacheCov > 0) {
      addInsightItem('⚡', t('analyticsInsightCacheReady'));
    }

    if (s.remote.lockedCount > 0) {
      addInsightItem('🛡️', t('analyticsInsightLockedSafe', { count: s.remote.lockedCount }));
    }

    // ==========================================
    // 模块四：【体积最大的 10 个附件】（紧凑控件 + 悬浮预览 + 纯文件名复制）
    // ==========================================
    const allTop = s.topLargestAttachments || [];
    if (allTop.length > 0) {
      const topBox = contentEl.createDiv({ cls: 'fm-section-box' });
      const topHeaderRow = topBox.createDiv({
        attr: { style: 'display: flex; align-items: center; justify-content: space-between;' }
      });
      topHeaderRow.createDiv({ text: t('analyticsTopLargest'), cls: 'fm-section-title', attr: { style: 'margin: 0;' } });

      // 收窄精细的微型切换控件
      let currentFilter = 'all'; // 'all' | 'local' | 'remote'
      const filterGroup = topHeaderRow.createDiv({
        attr: {
          style: 'display: flex; gap: 2px; background: var(--background-secondary); padding: 2px; border-radius: 6px; border: 1px solid var(--background-modifier-border);'
        }
      });

      const listEl = topBox.createDiv({ cls: 'fm-scroll-list', attr: { style: 'max-height: 195px; margin-top: 8px;' } });

      const renderList = () => {
        listEl.empty();
        const filtered = allTop.filter(item => {
          if (currentFilter === 'local') return item.source === 'local';
          if (currentFilter === 'remote') return item.source === 'remote';
          return true;
        }).slice(0, 10);

        if (filtered.length === 0) {
          listEl.createDiv({
            text: t('analyticsFilterEmpty'),
            attr: { style: 'text-align: center; padding: 20px; color: var(--text-faint); font-size: 12px;' }
          });
          return;
        }

        for (const item of filtered) {
          const row = listEl.createDiv({
            cls: 'fm-list-item',
            attr: {
              style: 'cursor: pointer; display: flex; align-items: center; justify-content: space-between; padding: 5px 8px; border-radius: 4px;'
            }
          });
          row.title = t('analyticsClickToCopy');

          // 点击仅复制纯文件名（方便直接在全局搜索）
          row.onclick = async () => {
            try {
              await navigator.clipboard.writeText(item.name);
              new Notice(t('analyticsCopiedName', { name: item.name }));
            } catch {
              new Notice(item.name);
            }
          };

          // 悬浮小窗口图片预览（轻量微型 Popover）
          row.onmouseenter = (e) => {
            if (item.group !== 'image') return;
            this.showHoverPreview(e, item);
          };
          row.onmouseleave = () => {
            this.hideHoverPreview();
          };

          const leftCol = row.createDiv({
            attr: { style: 'display: flex; align-items: center; min-width: 0; flex: 1; margin-right: 12px;' }
          });

          // 来源标识：💻 本地 或 ☁️ 远程
          const badgeText = item.source === 'local' ? t('analyticsBadgeLocal') : t('analyticsBadgeRemote');
          leftCol.createSpan({
            text: badgeText,
            attr: { style: 'font-size: 11px; font-weight: 500; margin-right: 6px; flex-shrink: 0;' }
          });

          // 文件路径/名称（无多余格式灰标）
          leftCol.createSpan({
            text: item.path,
            attr: { style: 'font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0;' }
          });

          // 引用状态
          if (item.isReferenced) {
            leftCol.createSpan({
              text: `[${t('analyticsRefUsed')}]`,
              attr: { style: 'font-size: 10px; color: var(--text-muted); margin-left: 6px; flex-shrink: 0;' }
            });
          } else {
            leftCol.createSpan({
              text: `[${t('analyticsRefUnused')}]`,
              attr: { style: 'font-size: 10px; color: var(--text-warning, #f59e0b); margin-left: 6px; flex-shrink: 0;' }
            });
          }

          // 大小
          row.createSpan({
            text: formatBytes(item.size),
            attr: { style: 'font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; font-family: var(--font-monospace); color: var(--text-muted); flex-shrink: 0;' }
          });
        }
      };

      const addFilterBtn = (filterKey, label) => {
        const btn = filterGroup.createEl('button', {
          text: label,
          attr: {
            style: `font-size: 10px; line-height: 1; padding: 2px 7px; height: 20px; border: none; border-radius: 4px; cursor: pointer; transition: all 0.15s ease; background: ${currentFilter === filterKey ? 'var(--background-primary)' : 'transparent'}; color: ${currentFilter === filterKey ? 'var(--text-normal)' : 'var(--text-muted)'}; font-weight: ${currentFilter === filterKey ? '600' : 'normal'}; box-shadow: ${currentFilter === filterKey ? '0 1px 2px rgba(0,0,0,0.1)' : 'none'};`
          }
        });
        btn.onclick = () => {
          currentFilter = filterKey;
          for (const child of filterGroup.children) {
            child.style.background = 'transparent';
            child.style.color = 'var(--text-muted)';
            child.style.fontWeight = 'normal';
            child.style.boxShadow = 'none';
          }
          btn.style.background = 'var(--background-primary)';
          btn.style.color = 'var(--text-normal)';
          btn.style.fontWeight = '600';
          btn.style.boxShadow = '0 1px 2px rgba(0,0,0,0.1)';
          renderList();
        };
      };

      addFilterBtn('all', `${t('analyticsFilterAll')} (${allTop.length})`);
      const localCount = allTop.filter(i => i.source === 'local').length;
      const remoteCount = allTop.filter(i => i.source === 'remote').length;
      addFilterBtn('local', `${t('analyticsFilterLocal')} (${localCount})`);
      addFilterBtn('remote', `${t('analyticsFilterRemote')} (${remoteCount})`);

      renderList();
    }

    // 动作按钮
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

  showHoverPreview(e, item) {
    this.hideHoverPreview();
    let src = '';
    if (item.source === 'local') {
      // 本地图片直接通过 Obsidian 本地协议快速加载
      const file = this.app.vault.getAbstractFileByPath(item.path);
      if (file) src = this.app.vault.getResourcePath(file);
    } else {
      // 远程图片优先使用 WebP 压缩格式，极大提高加载速度与带宽利用率
      const cleanServer = this.plugin.settings.serverUrl ? this.plugin.settings.serverUrl.replace(/\/$/, '') : '';
      const webpPath = String(item.path || '').replace(/\.[^.]+$/, '.webp');
      src = item.pubUrl || (cleanServer ? `${cleanServer}/pub/${webpPath}` : '') || item.rawUrl || (cleanServer ? `${cleanServer}/raw/${item.path}` : '');
    }

    if (!src) return;

    const popover = document.createElement('div');
    popover.className = 'fm-hover-preview-popover';
    popover.style.cssText = `
      position: fixed;
      left: ${Math.min(window.innerWidth - 180, e.clientX + 16)}px;
      top: ${Math.min(window.innerHeight - 160, Math.max(10, e.clientY - 60))}px;
      z-index: 99999;
      pointer-events: none;
      background: var(--background-secondary);
      border: 1px solid var(--background-modifier-border);
      border-radius: 8px;
      padding: 4px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
      animation: fm-fade-in 0.15s ease-out;
    `;

    const img = document.createElement('img');
    img.src = src;
    img.style.cssText = 'max-width: 150px; max-height: 130px; display: block; border-radius: 5px; object-fit: contain;';
    // 若 WebP 派生尚未就绪，自动回退到原图以防裂图
    img.onerror = () => {
      if (item.rawUrl && img.src !== item.rawUrl) {
        img.src = item.rawUrl;
      } else {
        this.hideHoverPreview();
      }
    };

    popover.appendChild(img);
    document.body.appendChild(popover);
    this.hoverPopover = popover;
  }

  hideHoverPreview() {
    if (this.hoverPopover) {
      this.hoverPopover.remove();
      this.hoverPopover = null;
    }
  }

  onClose() {
    this.hideHoverPreview();
    this.contentEl.empty();
  }
}
