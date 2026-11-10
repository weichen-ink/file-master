import { formatBytes } from '../engine.js';
import { createScanProgressWidget, returnToHub } from './common.js';
import { NoteRefsModal } from './dialogs.js';
import { renderItemVisualThumb } from './incoming-file.js';
import { Modal, Notice, setIcon } from 'obsidian';

/**
 * Wizard 3: Batch Cloud Migration Wizard
 * Step 1: Select migration folder scope, attachment types, and trash policy (with real-time scan progress + cancel button)
 * Step 2: Preview list, progress bar, upload, and verified safe rewrite
 */
export class BatchMigrateWizardModal extends Modal {
  constructor(app, plugin, initialFolder = '') {
    super(app);
    this.plugin = plugin;
    this.step = 1;
    this.activeProgress = null;
    this.options = {
      folderPrefix: initialFolder || '',
      typeImage: true,
      typeAudio: true,
      typeOther: true,
      uploadToProtected: false,
      deleteLocalAfter: plugin.settings.deleteLocalAfterMigrate
    };
    this.items = [];
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
    } else if (this.step === 2) {
      this.renderStep2(contentEl);
    } else if (this.step === 3) {
      this.renderStep3(contentEl);
    }
  }

  renderStep1(contentEl) {
    const t = (k, p) => this.plugin.t(k, p);
    const header = contentEl.createDiv({ cls: 'fm-step-header' });
    header.createSpan({ text: t('stepOf', { current: 1, total: 2 }), cls: 'fm-step-badge' });
    header.createEl('h3', { text: t('migrateStep1Title'), cls: 'fm-step-title' });

    contentEl.createEl('p', {
      text: t('migrateStep1Desc'),
      attr: { style: 'font-size: 13px; color: var(--text-muted); margin-bottom: 14px;' }
    });

    const folderBox = contentEl.createDiv({ cls: 'fm-section-box' });
    folderBox.createDiv({ text: t('migrateFolderScope'), cls: 'fm-section-title' });
    const folderSelect = folderBox.createEl('select', { attr: { style: 'width:100%; padding:8px 10px; border-radius:6px;' } });
    folderSelect.createEl('option', {
      value: '',
      text: t('migrateEntireVault')
    });

    const allFolders = this.plugin.getAllVaultFolderPaths();
    for (const fp of allFolders) {
      const opt = folderSelect.createEl('option', { value: fp, text: `📁 ${fp}/` });
      if (fp === this.options.folderPrefix) opt.selected = true;
    }
    folderSelect.onchange = () => {
      this.options.folderPrefix = folderSelect.value;
    };

    const typeBox = contentEl.createDiv({ cls: 'fm-section-box' });
    typeBox.createDiv({ text: t('migrateTypeScope'), cls: 'fm-section-title' });
    this.createCheck(typeBox, t('migrateTypeImage'), 'typeImage');
    this.createCheck(typeBox, t('migrateTypeAudio'), 'typeAudio');
    this.createCheck(typeBox, t('migrateTypeOther'), 'typeOther');

    const policyBox = contentEl.createDiv({ cls: 'fm-section-box' });
    policyBox.createDiv({ text: t('migratePolicyTitle'), cls: 'fm-section-title' });
    this.createCheck(
      policyBox,
      t('migrateDeleteLocal'),
      'deleteLocalAfter'
    );

    const progressWidget = createScanProgressWidget(contentEl, this.plugin);
    this.activeProgress = progressWidget;

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const cancelBtn = btnRow.createEl('button', { text: t('btnCancel') });
    cancelBtn.onclick = () => {
      if (this.transferController) {
        this.transferController.abort();
        cancelBtn.disabled = true;
        cancelBtn.setText(t('transferStopping'));
      } else returnToHub(this);
    };

    const nextBtn = btnRow.createEl('button', { text: t('migrateNextPreview'), cls: 'mod-cta' });
    nextBtn.onclick = async () => {
      if (!this.options.typeImage && !this.options.typeAudio && !this.options.typeOther) {
        new Notice(t('migrateSelectTypeNotice'));
        return;
      }
      nextBtn.disabled = true;
      nextBtn.setText(t('migrateScanning'));
      progressWidget.show();
      try {
        this.items = await this.plugin.scanLocalAttachmentsForBatchMigrate(this.options, {
          signal: progressWidget.signal,
          onProgress: (cur, total, label) => progressWidget.update(cur, total, label)
        });
        this.step = 2;
        this.render();
      } catch (err) {
        progressWidget.hide();
        new Notice(err.message === 'SCAN_ABORTED' ? this.plugin.t('scanCancelled') : '❌ Scan failed: ' + err.message);
        nextBtn.disabled = false;
        nextBtn.setText(t('migrateNextPreview'));
      }
    };
  }

  createCheck(parent, labelText, key) {
    const label = parent.createEl('label', { cls: 'fm-check-row' });
    const cb = label.createEl('input', { type: 'checkbox' });
    cb.checked = Boolean(this.options[key]);
    cb.onchange = () => {
      this.options[key] = cb.checked;
    };
    label.createSpan({ text: labelText });
  }

  renderStep2(contentEl) {
    const t = (k, p) => this.plugin.t(k, p);
    const header = contentEl.createDiv({ cls: 'fm-step-header' });
    header.createSpan({ text: t('stepOf', { current: 2, total: 2 }), cls: 'fm-step-badge' });
    header.createEl('h3', {
      text: t('migrateStep2Title', { count: this.items.length }),
      cls: 'fm-step-title'
    });

    const toolbar = contentEl.createDiv({ cls: 'fm-toolbar-row' });
    const leftTools = toolbar.createDiv({ attr: { style: 'display:flex; gap:8px; align-items:center;' } });
    const backBtn = leftTools.createEl('button', { text: t('btnBack') });
    backBtn.onclick = () => {
      this.step = 1;
      this.render();
    };

    const selectAllBtn = leftTools.createEl('button', { text: t('btnSelectAll') });
    selectAllBtn.onclick = () => {
      const allSelected = this.items.every((i) => i.selected);
      this.items.forEach((i) => { i.selected = !allSelected; });
      this.render();
    };

    const onlyRefBtn = leftTools.createEl('button', { text: t('migrateSelectOnlyRef') });
    onlyRefBtn.onclick = () => {
      this.items.forEach((i) => { i.selected = i.refNotes.length > 0; });
      this.render();
    };

    if (this.items.length === 0) {
      contentEl.createDiv({
        cls: 'fm-section-box',
        text: t('migrateNoneFound'),
        attr: { style: 'text-align: center; padding: 36px 20px;' }
      });
      const emptyBtnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
      const cancelBtn = emptyBtnRow.createEl('button', { text: t('btnCancel') });
      cancelBtn.onclick = () => {
      if (this.transferController) {
        this.transferController.abort();
        cancelBtn.disabled = true;
        cancelBtn.setText(t('transferStopping'));
      } else returnToHub(this);
    };
      return;
    }

    const listEl = contentEl.createDiv({ cls: 'fm-scroll-list' });
    for (const item of this.items) {
      const row = listEl.createDiv({ cls: 'fm-list-item' });
      const left = row.createDiv({
        attr: { style: 'display:flex; align-items:center; gap:10px; flex:1; overflow:hidden;' }
      });
      const cb = left.createEl('input', { type: 'checkbox', attr: { style: 'cursor:pointer;' } });
      cb.checked = item.selected;
      cb.onchange = () => {
        item.selected = cb.checked;
      };

      renderItemVisualThumb(left, item, this.plugin);

      left.createSpan({
        text: item.displayPath,
        attr: { style: 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:500;' }
      });

      const rightBox = row.createDiv({
        attr: { style: 'display:flex; align-items:center; gap:8px; flex-shrink:0;' }
      });
      rightBox.createSpan({
        text: formatBytes(item.size),
        attr: { style: 'color: var(--text-muted); font-size: 12px;' }
      });

      const refBadge = rightBox.createSpan({
        text: t('migrateNoteRefs', { count: item.refNotes.length }),
        cls: 'fm-tag fm-tag-ref fm-clickable-badge',
        attr: { title: t('migrateInspectRefs') }
      });
      refBadge.onclick = (e) => {
        e.stopPropagation();
        new NoteRefsModal(this.app, item.name, item.refNotes, () => this.close(), this.plugin).open();
      };
    }

    const progressBox = contentEl.createDiv({ attr: { style: 'display:none; margin-bottom:10px;' } });
    const progressText = progressBox.createDiv({ attr: { style: 'font-size:12px; color:var(--text-accent);' } });
    const progressWrap = progressBox.createDiv({ cls: 'fm-progress-wrap' });
    const progressBar = progressWrap.createDiv({ cls: 'fm-progress-bar' });

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const cancelBtn = btnRow.createEl('button', { text: t('btnCancel') });
    cancelBtn.onclick = () => {
      if (this.transferController) {
        this.transferController.abort();
        cancelBtn.disabled = true;
        cancelBtn.setText(t('transferStopping'));
      } else returnToHub(this);
    };
    const runBtn = btnRow.createEl('button', {
      text: t('migrateStart', { count: this.items.filter((i) => i.selected).length }),
      cls: 'mod-cta'
    });
    runBtn.onclick = async () => {
      const selected = this.items.filter((i) => i.selected);
      if (selected.length === 0) {
        new Notice(t('migrateSelectNotice'));
        return;
      }
      runBtn.disabled = true;
      backBtn.disabled = true;
      progressBox.style.display = 'block';
      this.transferController = new AbortController();
      try {
      await this.plugin.executeBatchMigrateSafely(
        selected,
        { ...this.options, signal: this.transferController.signal },
        (cur, total, name) => {
          const pct = Math.round((cur / Math.max(1, total)) * 100);
          progressBar.style.width = `${pct}%`;
          progressText.setText(t('migrateProgress', { current: cur, total, name }));
        },
        (summary) => {
          this.step = 3;
          this.summary = summary;
          if (!this.transferClosed) this.render();
        }
      );
      } catch (err) {
        new Notice(err.message);
        runBtn.disabled = false;
        backBtn.disabled = false;
      } finally { this.transferController = null; }
    };
  }

  renderStep3(contentEl) {
    const t = (k, p) => this.plugin.t(k, p);
    const count = this.summary?.count || 0;
    const failures = this.summary?.failures || [];
    const processedItems = this.summary?.processedItems || [];

    const isPartial = failures.length > 0 && count > 0;
    const isError = count === 0 && failures.length > 0;
    const titleKey = this.summary?.cancelled ? 'transferCancelled' : isError
      ? 'batchResultErrorTitle'
      : (isPartial ? 'batchResultWarningTitle' : 'batchResultTitle');

    contentEl.createEl('h3', { text: t(titleKey) });

    const bannerCls = isError
      ? 'fm-result-banner fm-result-banner-error'
      : (isPartial ? 'fm-result-banner fm-result-banner-warning' : 'fm-result-banner fm-result-banner-success');
    const banner = contentEl.createDiv({ cls: bannerCls });
    banner.createDiv({ cls: 'fm-result-banner-title', text: t(titleKey) });

    const trashedText = this.summary?.trashed
      ? t('noticeBatchMigrateTrashedPart', { trashed: this.summary.trashed })
      : '';
    const failText = failures.length > 0
      ? t('batchResultFailuresPart', { count: failures.length })
      : '';
    const trashFailures = this.summary?.trashFailures || [];
    const trashFailText = trashFailures.length > 0
      ? t('batchResultTrashFailuresPart', { count: trashFailures.length })
      : '';

    banner.createDiv({
      cls: 'fm-result-banner-desc',
      text: t('batchResultDesc', {
        count,
        docs: this.summary?.docs || 0,
        trashed: trashedText
      }) + failText + trashFailText
    });

    if (processedItems.length > 0) {
      const listBox = contentEl.createDiv({
        cls: 'fm-section-box',
        attr: { style: 'margin-top: 10px;' }
      });
      listBox.createDiv({
        text: t('batchResultListTitle', { count: processedItems.length }),
        cls: 'fm-section-title'
      });
      const listEl = listBox.createDiv({
        cls: 'fm-scroll-list',
        attr: { style: 'max-height: 220px; margin-bottom: 0;' }
      });
      for (const pItem of processedItems) {
        const row = listEl.createDiv({ cls: 'fm-list-item' });
        const left = row.createDiv({
          attr: { style: 'display:flex; align-items:center; gap:10px; flex:1; overflow:hidden;' }
        });
        renderItemVisualThumb(left, pItem, this.plugin);
        const nameCol = left.createDiv({
          attr: { style: 'display:flex; flex-direction:column; overflow:hidden; flex:1;' }
        });
        nameCol.createSpan({
          text: pItem.name,
          attr: { style: 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:500;' }
        });
        nameCol.createSpan({
          text: `${pItem.displayPath} · ${formatBytes(pItem.size || 0)}`,
          attr: { style: 'font-size:11px; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;' }
        });

        const rightBox = row.createDiv({
          attr: { style: 'display:flex; align-items:center; gap:6px; flex-shrink:0;' }
        });
        if (pItem.rawUrl) {
          const copyBtn = rightBox.createEl('button', {
            cls: 'clickable-icon',
            attr: { 'aria-label': t('copyRawUrl') || 'Copy URL' }
          });
          setIcon(copyBtn, 'copy');
          copyBtn.onclick = async (e) => {
            e.stopPropagation();
            await navigator.clipboard.writeText(pItem.rawUrl);
            new Notice(t('noticeCopied'));
          };
        }
      }
    }

    if (failures.length > 0) {
      const failBox = contentEl.createDiv({
        cls: 'fm-section-box',
        attr: { style: 'margin-top: 10px; border-color: rgba(239, 68, 68, 0.4);' }
      });
      failBox.createDiv({
        text: t('batchFailuresTitle', { count: failures.length }),
        cls: 'fm-section-title',
        attr: { style: 'color: var(--text-error);' }
      });
      for (const f of failures) {
        failBox.createDiv({
          cls: 'fm-result-banner-desc',
          text: `• ${f.path || f.name} (${formatBytes(f.size || 0)}): ${f.error}`,
          attr: { style: 'font-size: 12px; color: var(--text-muted); margin-top: 2px;' }
        });
      }
    }

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    let createdReportPath = null;

    const exportBtn = btnRow.createEl('button', { text: t('batchExportReport') });
    exportBtn.onclick = async () => {
      exportBtn.disabled = true;
      try {
        createdReportPath = await this.plugin.exportBatchMigrateReportToRoot(this.summary);
        exportBtn.setText(t('batchReportExported'));
        if (!btnRow.querySelector('.fm-open-report-btn')) {
          const openBtn = btnRow.createEl('button', {
            text: t('batchOpenReport'),
            cls: 'fm-open-report-btn'
          });
          openBtn.onclick = () => {
            if (createdReportPath) {
              this.app.workspace.openLinkText(createdReportPath, '', true);
            }
            this.close();
          };
        }
      } catch (err) {
        new Notice('❌ ' + err.message);
        exportBtn.disabled = false;
      }
    };

    if (this.summary?.cancelled) btnRow.createSpan({ text: t('transferCancelled') });
    if (this.summary?.retryItems?.length) {
      const retry = btnRow.createEl('button', { text: t('transferRetry') });
      retry.onclick = () => {
        this.items = this.summary.retryItems.map((item) => ({ ...item, selected: true, refNotes: item.refNotes || [] }));
        this.step = 2;
        this.render();
      };
    }
    const doneBtn = btnRow.createEl('button', { text: t('destBtnDone'), cls: 'mod-cta' });
    doneBtn.onclick = () => returnToHub(this);
  }

  onClose() {
    this.transferClosed = true;
    this.transferController?.abort();
    if (this.activeProgress) this.activeProgress.abort();
    this.contentEl.empty();
  }
}
