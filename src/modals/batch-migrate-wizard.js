import { moduleHeading } from "../ui/navigation.js";
import { getAllVaultFolderPaths } from '../plugin/vault-utils.js';
import { scanLocalAttachmentsForBatchMigrate } from '../plugin/attachment-ops.js';
import { exportBatchMigrateReportToRoot } from '../plugin/vault-scans.js';
import { formatBytes } from '../engine.js';
import { createScanProgressWidget, renderScanEmpty, returnToHub } from './common.js';
import { fileActionRow, fileMetadata, fileReferenceButton } from '../ui/file-action-list.js';
import { Notice, setIcon } from 'obsidian';
import { FileMasterModal as Modal } from '../ui/modal.js';

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
    moduleHeading(this,contentEl,{title:'actMigrateTitle',symbol:'cloud-upload',step:1,total:2});
    contentEl.createEl('p',{text:t('migrateStep1Desc'),cls:'fm-module-summary'});

    const folderBox = contentEl.createDiv({ cls: 'fm-section-box' });
    folderBox.createDiv({ text: t('migrateFolderScope'), cls: 'fm-section-title' });
    const folderSelect = folderBox.createEl('select', { attr: { style: 'width:100%; padding:8px 10px; border-radius:6px;' } });
    folderSelect.createEl('option', {
      value: '',
      text: t('migrateEntireVault')
    });

    const allFolders = getAllVaultFolderPaths(this.plugin.app);
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
        this.items = await scanLocalAttachmentsForBatchMigrate(this.plugin, this.options, {
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
    moduleHeading(this,contentEl,{title:'actMigrateTitle',symbol:'cloud-upload',step:this.items.length ? 2 : null,total:2});
    if (!this.items.length) {
      renderScanEmpty(this,contentEl,'migrateNoneFound');
      return;
    }
    contentEl.createEl('p',{text:t('migrateStep2Title', { count: this.items.length }),cls:'fm-module-summary'});

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

    const listEl = contentEl.createDiv({ cls: 'fm-scroll-list fm-file-action-list' });
    for (const item of this.items) {
      const {actions} = fileActionRow(listEl,item,this.plugin,{
        selection:parent=>{
          const checkbox=parent.createEl('input',{type:'checkbox',attr:{'aria-label':item.name}});
          checkbox.checked=item.selected;
          checkbox.onchange=()=>{item.selected=checkbox.checked;};
        },
        metadata:parent=>fileMetadata(parent,item,{path:item.displayPath})
      });
      fileReferenceButton(actions,item,this.plugin,item.refNotes,()=>this.close());
    }

    const progressBox = contentEl.createDiv({ attr: { style: 'display:none; margin-bottom:12px;' } });
    const progressHeader = progressBox.createDiv({ attr: { style: 'display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;' } });
    const progressText = progressHeader.createDiv({ attr: { style: 'font-size:12px; color:var(--text-accent); font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:65%;' } });
    const progressSpeed = progressHeader.createDiv({ attr: { style: 'font-size:11.5px; font-family:var(--font-monospace); color:var(--text-muted); font-weight:600; white-space:nowrap;' } });
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
        (cur, total, name, stats) => {
          const pct = Math.round((cur / Math.max(1, total)) * 100);
          progressBar.style.width = `${pct}%`;
          progressText.setText(t('migrateProgress', { current: cur, total, name }));
          if (stats?.speedText) {
            const eta = stats.etaText ? ` · 剩余约 ${stats.etaText}` : '';
            progressSpeed.setText(`⚡ ${stats.speedText}${eta}`);
          }
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
    const title=this.summary?.cancelled ? t('transferCancelled') : isError
      ? t('batchResultErrorTitle') : t('transferUploaded',{count});

    moduleHeading(this,contentEl,{title:'actMigrateTitle',symbol:'cloud-upload'});

    const bannerCls = isError
      ? 'fm-result-banner fm-result-banner-error'
      : (isPartial ? 'fm-result-banner fm-result-banner-warning' : 'fm-result-banner fm-result-banner-success');
    const banner = contentEl.createDiv({ cls: bannerCls });
    banner.createDiv({cls:'fm-result-banner-title',text:title});
    if(this.summary?.cancelled && count>0)banner.createDiv({cls:'fm-result-banner-desc',text:t('transferUploaded',{count})});

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
        cls: 'fm-scroll-list fm-file-action-list',
        attr: { style: 'max-height: 220px; margin-bottom: 0;' }
      });
      for (const pItem of processedItems) {
        const {actions:rightBox}=fileActionRow(listEl,pItem,this.plugin,{metadata:parent=>fileMetadata(parent,pItem,{path:pItem.displayPath})});
        if (pItem.rawUrl) {
          const copyBtn = rightBox.createEl('button', {
            cls: 'fm-icon-button',
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

    const trashFailures=this.summary?.trashFailures || [];
    if(trashFailures.length) {
      const warning=contentEl.createDiv({cls:'fm-section-box'});
      warning.createDiv({cls:'fm-section-title',text:t('activeNoteTrashFailedNotice',{count:trashFailures.length})});
      for(const failure of trashFailures)warning.createDiv({cls:'fm-result-banner-desc',text:`${failure.path}: ${failure.error}`});
    }

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    let createdReportPath = null;

    const exportBtn = btnRow.createEl('button', { text: t('batchExportReport') });
    exportBtn.onclick = async () => {
      exportBtn.disabled = true;
      try {
        createdReportPath = await exportBatchMigrateReportToRoot(this.plugin, this.summary);
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
