import { createScanProgressWidget, returnToHub } from './common.js';
import { Modal, Notice } from 'obsidian';

/**
 * Vault Link Health Check Modal (404 & Dangling WikiLink Finder)
 */
export class HealthCheckModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.step = 1;
    this.activeProgress = null;
    this.options = {
      checkWikiLinks: true,
      checkLocalMarkdown: true,
      checkRemote: false
    };
    this.totalDocsScanned = 0;
    this.issues = [];
    this.activeFilter = 'all';
    this.searchQuery = '';
  }

  onOpen() {
    this.render();
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('fm-wizard-modal');

    if (this.step === 1) {
      this.renderStep1(contentEl);
    } else {
      this.renderStep2(contentEl);
    }
  }

  renderStep1(contentEl) {
    const t = (k, p) => this.plugin.t(k, p);
    const header = contentEl.createDiv({ cls: 'fm-step-header' });
    header.createSpan({ text: t('stepOf', { current: 1, total: 2 }), cls: 'fm-step-badge' });
    header.createEl('h3', { text: t('healthStep1Title'), cls: 'fm-step-title' });

    contentEl.createEl('p', {
      text: t('healthStep1Desc'),
      attr: { style: 'font-size: 13px; color: var(--text-muted); margin-bottom: 14px;' }
    });

    const box = contentEl.createDiv({ cls: 'fm-section-box' });
    box.createDiv({ text: t('healthScopeTitle'), cls: 'fm-section-title' });

    this.createCheckbox(box, t('healthCheckWiki'), 'checkWikiLinks');
    this.createCheckbox(box, t('healthCheckLocal'), 'checkLocalMarkdown');
    this.createCheckbox(box, t('healthCheckRemote'), 'checkRemote');

    const progressWidget = createScanProgressWidget(contentEl, this.plugin);
    this.activeProgress = progressWidget;

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const cancelBtn = btnRow.createEl('button', { text: t('btnCancel') });
    cancelBtn.onclick = () => returnToHub(this);

    const startBtn = btnRow.createEl('button', { text: t('healthStartScan'), cls: 'mod-cta' });
    startBtn.onclick = async () => {
      if (!this.options.checkWikiLinks && !this.options.checkLocalMarkdown && !this.options.checkRemote) {
        return;
      }
      startBtn.disabled = true;
      startBtn.setText(t('healthScanning'));
      progressWidget.show();
      try {
        const scanResult = await this.plugin.scanVaultLinkHealth(this.options, {
          signal: progressWidget.signal,
          onProgress: (cur, total, label) => progressWidget.update(cur, total, label)
        });
        this.issues = scanResult.issues;
        this.totalDocsScanned = scanResult.totalDocs;
        this.step = 2;
        this.render();
      } catch (err) {
        progressWidget.hide();
        new Notice(err.message === 'SCAN_ABORTED' ? this.plugin.t('scanCancelled') : '❌ Link health scan failed: ' + err.message);
        startBtn.disabled = false;
        startBtn.setText(t('healthStartScan'));
      }
    };
  }

  createCheckbox(parent, labelText, optKey) {
    const label = parent.createEl('label', { cls: 'fm-check-row' });
    const cb = label.createEl('input', { type: 'checkbox' });
    cb.checked = Boolean(this.options[optKey]);
    cb.onchange = () => {
      this.options[optKey] = cb.checked;
    };
    label.createSpan({ text: labelText });
  }

  renderStep2(contentEl) {
    const t = (k, p) => this.plugin.t(k, p);
    const wikiIssues = this.issues.filter((i) => i.category === 'wikilink');
    const localIssues = this.issues.filter((i) => i.category === 'local');
    const remoteIssues = this.issues.filter((i) => i.category === 'remote');

    const header = contentEl.createDiv({ cls: 'fm-step-header' });
    header.createSpan({ text: t('stepOf', { current: 2, total: 2 }), cls: 'fm-step-badge' });
    header.createEl('h3', {
      text: t('healthStep2Title', { docs: this.totalDocsScanned, issues: this.issues.length }),
      cls: 'fm-step-title'
    });

    const statGrid = contentEl.createDiv({ cls: 'fm-health-stat-grid' });
    const addStat = (num, label, color) => {
      const card = statGrid.createDiv({ cls: 'fm-health-stat-card' });
      const numEl = card.createDiv({ cls: 'fm-health-stat-num', text: String(num) });
      if (color) numEl.style.color = color;
      card.createDiv({ cls: 'fm-health-stat-label', text: label });
    };
    addStat(this.totalDocsScanned, t('healthStatNotes'));
    addStat(wikiIssues.length, t('healthStatWiki'), wikiIssues.length > 0 ? '#ef4444' : undefined);
    addStat(localIssues.length, t('healthStatLocal'), localIssues.length > 0 ? '#f59e0b' : undefined);
    addStat(remoteIssues.length, t('healthStatRemote'), remoteIssues.length > 0 ? '#3b82f6' : undefined);

    const toolbar = contentEl.createDiv({ cls: 'fm-toolbar-row' });
    const leftTools = toolbar.createDiv({ attr: { style: 'display:flex; gap:8px; align-items:center;' } });
    const backBtn = leftTools.createEl('button', { text: t('healthRescan') });
    backBtn.onclick = () => {
      this.step = 1;
      this.render();
    };

    const exportBtn = toolbar.createEl('button', {
      text: t('btnExportReport'),
      cls: 'mod-cta'
    });
    exportBtn.onclick = async () => {
      await this.plugin.exportHealthReportToRoot(this.issues, this.totalDocsScanned);
    };

    if (this.issues.length === 0) {
      contentEl.createDiv({
        cls: 'fm-section-box',
        text: t('healthNoneFound'),
        attr: { style: 'text-align: center; padding: 36px 20px; font-weight: 500;' }
      });
      const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
      const closeBtn = btnRow.createEl('button', { text: t('closeBtn') });
      closeBtn.onclick = () => returnToHub(this);
      return;
    }

    const filterRow = contentEl.createDiv({
      attr: { style: 'display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:10px; flex-wrap:wrap;' }
    });
    const chipBox = filterRow.createDiv({ attr: { style: 'display:flex; gap:6px;' } });
    const createChip = (id, label, count) => {
      const chip = chipBox.createEl('button', {
        text: `${label} (${count})`,
        cls: this.activeFilter === id ? 'mod-cta' : ''
      });
      chip.onclick = () => {
        this.activeFilter = id;
        this.renderStep2(contentEl);
      };
    };

    createChip('all', t('healthFilterAll'), this.issues.length);
    createChip('wikilink', t('healthStatWiki'), wikiIssues.length);
    createChip('local', t('healthStatLocal'), localIssues.length);
    createChip('remote', t('healthStatRemote'), remoteIssues.length);

    const searchInput = filterRow.createEl('input', {
      type: 'search',
      placeholder: t('healthSearchPlaceholder'),
      value: this.searchQuery,
      attr: { style: 'padding: 4px 10px; border-radius: 6px; border: 1px solid var(--background-modifier-border); min-width: 180px;' }
    });
    searchInput.oninput = (e) => {
      this.searchQuery = e.target.value.toLowerCase();
      this.renderIssueList(listEl);
    };

    const listEl = contentEl.createDiv({ cls: 'fm-scroll-list', attr: { style: 'max-height: 380px;' } });
    this.renderIssueList(listEl);

    const bottomRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const closeBtn = bottomRow.createEl('button', { text: t('closeBtn') });
    closeBtn.onclick = () => returnToHub(this);
  }

  renderIssueList(listEl) {
    const t = (k, p) => this.plugin.t(k, p);
    listEl.empty();

    let filtered = this.issues;
    if (this.activeFilter !== 'all') {
      filtered = filtered.filter((i) => i.category === this.activeFilter);
    }
    if (this.searchQuery) {
      filtered = filtered.filter(
        (i) =>
          i.sourcePath.toLowerCase().includes(this.searchQuery) ||
          i.target.toLowerCase().includes(this.searchQuery) ||
          (i.lineText && i.lineText.toLowerCase().includes(this.searchQuery))
      );
    }

    if (filtered.length === 0) {
      listEl.createDiv({
        cls: 'fm-section-box',
        text: t('healthNoMatches'),
        attr: { style: 'text-align: center; padding: 24px;' }
      });
      return;
    }

    for (const item of filtered) {
      const row = listEl.createDiv({ cls: 'fm-list-item' });
      const leftCol = row.createDiv({
        attr: { style: 'display:flex; flex-direction:column; gap:4px; flex:1; overflow:hidden;' }
      });

      const topMeta = leftCol.createDiv({ attr: { style: 'display:flex; align-items:center; gap:6px;' } });
      let tagCls = 'fm-tag-error';
      let tagLabel = '🔴 Broken Link';
      if (item.category === 'wikilink') {
        tagCls = 'fm-tag-error';
        tagLabel = item.type === 'wikilink-embed' ? t('healthTagWikiEmbed') : t('healthTagDanglingNote');
      } else if (item.category === 'local') {
        tagCls = 'fm-tag-warning';
        tagLabel = item.type === 'local-embed' ? t('healthTagMissingImage') : t('healthTagMissingFile');
      } else if (item.category === 'remote') {
        tagCls = 'fm-tag-info';
        tagLabel = t('healthTagRemote404');
      }

      topMeta.createSpan({ text: tagLabel, cls: `fm-tag ${tagCls}` });
      topMeta.createEl('code', { text: item.target, attr: { style: 'font-size: 12px; font-weight: 600;' } });
      topMeta.createSpan({
        text: t('healthLine', { line: item.line }),
        attr: { style: 'font-size: 11px; color: var(--text-muted); margin-left: auto;' }
      });

      const noteRef = leftCol.createDiv({
        attr: { style: 'font-size: 12px; color: var(--text-muted); display:flex; align-items:center; gap:4px;' }
      });
      noteRef.createSpan({ text: t('healthInNote', { path: item.sourcePath }) });

      if (item.lineText) {
        leftCol.createDiv({
          text: item.lineText,
          cls: 'fm-health-context-quote'
        });
      }

      const openBtn = row.createEl('button', {
        text: t('healthJumpToLine'),
        attr: { style: 'flex-shrink:0; align-self:center;' }
      });
      openBtn.onclick = async () => {
        await this.plugin.openNoteAtLine(item.sourcePath, item.line);
      };
    }
  }

  onClose() {
    if (this.activeProgress) this.activeProgress.abort();
    this.contentEl.empty();
  }
}
