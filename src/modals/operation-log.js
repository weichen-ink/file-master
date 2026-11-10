/**
 * Operation & Debug Log Viewer/Exporter Modal
 */
class OperationLogModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.filterMode = 'all'; // 'all' | 'errors'
    this.searchQuery = '';
  }

  t(k, p) {
    return this.plugin ? this.plugin.t(k, p) : k;
  }

  async onOpen() {
    if (this.plugin?.loadOperationLogs) {
      await this.plugin.loadOperationLogs();
    }
    this.render();
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('fm-wizard-modal');

    const header = contentEl.createDiv({ cls: 'fm-step-header' });
    header.createEl('h3', { text: this.t('opLogTitle'), cls: 'fm-step-title' });

    contentEl.createDiv({
      text: this.t('opLogPathHint', { path: this.plugin?.getLogFilePath?.() || '.obsidian/plugins/file-master/operation.log' }),
      attr: { style: 'font-size: 12px; color: var(--text-muted); margin-bottom: 12px;' }
    });

    const allLogs = Array.isArray(this.plugin?.operationLogs) ? [...this.plugin.operationLogs].reverse() : [];
    const errCount = allLogs.filter((e) => e.level === 'ERROR' || e.level === 'WARN').length;

    const filterRow = contentEl.createDiv({
      attr: { style: 'display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:10px; flex-wrap:wrap;' }
    });
    const chipBox = filterRow.createDiv({ attr: { style: 'display:flex; gap:6px;' } });

    const allBtn = chipBox.createEl('button', {
      text: `${this.t('opLogFilterAll')} (${allLogs.length})`,
      cls: this.filterMode === 'all' ? 'mod-cta' : ''
    });
    allBtn.onclick = () => {
      this.filterMode = 'all';
      this.render();
    };

    const errBtn = chipBox.createEl('button', {
      text: `${this.t('opLogFilterErrors')} (${errCount})`,
      cls: this.filterMode === 'errors' ? 'mod-cta' : ''
    });
    errBtn.onclick = () => {
      this.filterMode = 'errors';
      this.render();
    };

    const searchInput = filterRow.createEl('input', {
      type: 'search',
      placeholder: this.t('opLogSearchPlaceholder'),
      value: this.searchQuery,
      attr: { style: 'padding: 4px 10px; border-radius: 6px; border: 1px solid var(--background-modifier-border); min-width: 190px;' }
    });

    const listEl = contentEl.createDiv({
      cls: 'fm-scroll-list',
      attr: { style: 'max-height: 360px;' }
    });

    searchInput.oninput = (e) => {
      this.searchQuery = e.target.value.toLowerCase();
      this.renderLogList(listEl, allLogs);
    };

    this.renderLogList(listEl, allLogs);

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row', attr: { style: 'justify-content: space-between; flex-wrap: wrap; gap: 8px;' } });
    const leftBtns = btnRow.createDiv({ attr: { style: 'display: flex; gap: 8px; flex-wrap: wrap;' } });

    const copyBtn = leftBtns.createEl('button', { text: this.t('opLogCopyAll'), cls: 'mod-cta' });
    copyBtn.onclick = async () => {
      const text = this.plugin?.formatLogsForExport?.() || '';
      await navigator.clipboard.writeText(text);
      new Notice(this.t('opLogCopiedNotice'));
    };

    const exportBtn = leftBtns.createEl('button', { text: this.t('opLogExportFile') });
    exportBtn.onclick = () => {
      const text = this.plugin?.formatLogsForExport?.() || '';
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const now = new Date();
      const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
      a.href = url;
      a.download = `file-master-debug-${dateStr}.log`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    };

    const clearBtn = leftBtns.createEl('button', { text: this.t('opLogClear') });
    clearBtn.onclick = async () => {
      if (this.plugin?.clearOperationLogs) {
        await this.plugin.clearOperationLogs();
      }
      new Notice(this.t('opLogClearedNotice'));
      this.render();
    };

    const closeBtn = btnRow.createEl('button', { text: this.t('closeBtn') });
    closeBtn.onclick = () => this.close();
  }

  renderLogList(listEl, allLogs) {
    listEl.empty();
    let filtered = allLogs;
    if (this.filterMode === 'errors') {
      filtered = filtered.filter((e) => e.level === 'ERROR' || e.level === 'WARN');
    }
    if (this.searchQuery) {
      filtered = filtered.filter((e) => {
        const hay = `${e.ts || ''} ${e.level || ''} ${e.action || ''} ${e.summary || ''} ${e.details ? JSON.stringify(e.details) : ''}`.toLowerCase();
        return hay.includes(this.searchQuery);
      });
    }

    if (filtered.length === 0) {
      listEl.createDiv({
        cls: 'fm-section-box',
        text: this.t('opLogEmpty'),
        attr: { style: 'text-align: center; padding: 28px 16px; color: var(--text-muted);' }
      });
      return;
    }

    for (const entry of filtered) {
      const row = listEl.createDiv({ cls: 'fm-list-item' });
      const col = row.createDiv({
        attr: { style: 'display:flex; flex-direction:column; gap:4px; flex:1; overflow:hidden;' }
      });

      const topRow = col.createDiv({
        attr: { style: 'display:flex; align-items:center; gap:6px; flex-wrap:wrap;' }
      });
      let levelCls = 'fm-tag-info';
      if (entry.level === 'ERROR') levelCls = 'fm-tag-error';
      else if (entry.level === 'WARN') levelCls = 'fm-tag-warning';

      topRow.createSpan({ text: entry.level || 'INFO', cls: `fm-tag ${levelCls}` });
      if (entry.action) {
        topRow.createEl('code', { text: entry.action, attr: { style: 'font-size: 11px;' } });
      }
      topRow.createSpan({
        text: entry.ts || '',
        attr: { style: 'font-size: 11px; color: var(--text-muted); margin-left: auto;' }
      });

      col.createDiv({
        text: entry.summary || '',
        attr: { style: 'font-size: 12px; font-weight: 500; word-break: break-word;' }
      });

      if (entry.details && Object.keys(entry.details).length > 0) {
        col.createDiv({
          text: JSON.stringify(entry.details),
          cls: 'fm-health-context-quote',
          attr: { style: 'font-family: var(--font-monospace); font-size: 11px; word-break: break-all;' }
        });
      }
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
