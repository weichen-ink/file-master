import { moduleHeading } from "../ui/navigation.js";
import { scanUnusedFiles, exportOrphanReportToRoot, cleanSelectedOrphans } from '../plugin/vault-scans.js';
import { formatBytes } from '../engine.js';
import { createScanProgressWidget, renderScanEmpty, returnToHub, renderExcludedFoldersHint } from './common.js';
import { fileActionRow, fileMetadata } from '../ui/file-action-list.js';
import { Notice } from 'obsidian';
import { FileMasterModal as Modal } from '../ui/modal.js';

/**
 * Wizard 1: Orphan Finder Wizard
 * Step 1: Select location scope and file types (with real-time scan progress + cancel button)
 * Step 2: Display results, export report, and safely clean selected items
 */
export class OrphanWizardModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.step = 1;
    this.activeProgress = null;
    const isRemote = Boolean(plugin?.isRemoteServerReady?.());
    this.options = {
      scanLocal: true,
      scanRemote: isRemote,
      typeNote: false,
      typeImage: true,
      typeAudio: true,
      typeOther: true
    };
    this.results = [];
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
    moduleHeading(this,contentEl,{title:'actOrphanTitle',symbol:'search',step:1,total:2});
    contentEl.createEl('p',{text:t('orphanStep1Desc'),cls:'fm-module-summary'});

    if (this.plugin?.isRemoteServerReady?.()) {
      const locBox = contentEl.createDiv({ cls: 'fm-section-box' });
      locBox.createDiv({ text: t('orphanLocScope'), cls: 'fm-section-title' });
      this.createCheckbox(locBox, t('orphanScanLocal'), 'scanLocal');
      this.createCheckbox(locBox, t('orphanScanRemote'), 'scanRemote');
    }

    const typeBox = contentEl.createDiv({ cls: 'fm-section-box' });
    typeBox.createDiv({ text: t('orphanTypeScope'), cls: 'fm-section-title' });
    this.createCheckbox(typeBox, t('orphanTypeNote'), 'typeNote');
    this.createCheckbox(typeBox, t('orphanTypeImage'), 'typeImage');
    this.createCheckbox(typeBox, t('orphanTypeAudio'), 'typeAudio');
    this.createCheckbox(typeBox, t('orphanTypeOther'), 'typeOther');

    renderExcludedFoldersHint(contentEl, this.plugin);

    const progressWidget = createScanProgressWidget(contentEl, this.plugin);
    this.activeProgress = progressWidget;

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const cancelBtn = btnRow.createEl('button', { text: t('btnCancel') });
    cancelBtn.onclick = () => returnToHub(this);

    const nextBtn = btnRow.createEl('button', { text: t('btnNext'), cls: 'mod-cta' });
    nextBtn.onclick = async () => {
      if (!this.options.scanLocal && !this.options.scanRemote) {
        new Notice(t('orphanLocRequired'));
        return;
      }
      if (!this.options.typeNote && !this.options.typeImage && !this.options.typeAudio && !this.options.typeOther) {
        new Notice(t('orphanTypeRequired'));
        return;
      }
      nextBtn.disabled = true;
      nextBtn.setText(t('orphanScanning'));
      progressWidget.show();
      try {
        this.results = await scanUnusedFiles(this.plugin, this.options, {
          signal: progressWidget.signal,
          onProgress: (cur, total, label) => progressWidget.update(cur, total, label)
        });
        this.step = 2;
        this.render();
      } catch (err) {
        progressWidget.hide();
        new Notice(err.message === 'SCAN_ABORTED' ? this.plugin.t('scanCancelled') : '❌ Scan failed: ' + err.message);
        nextBtn.disabled = false;
        nextBtn.setText(t('btnNext'));
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
    moduleHeading(this,contentEl,{title:'actOrphanTitle',symbol:'search',step:this.results.length ? 2 : null,total:2});
    if(this.results.length)contentEl.createEl('p',{text:t('orphanStep2Title', { count: this.results.length }),cls:'fm-module-summary'});
    if (this.lastCleanSummary) {
      const banner = contentEl.createDiv({ cls: 'fm-result-banner fm-result-banner-success' });
      banner.createDiv({ cls: 'fm-result-banner-title', text: t('orphanResultTitle') });
      banner.createDiv({cls:'fm-result-banner-desc',text:t('orphanResultDesc',{
        count:this.lastCleanSummary.total || 0,local:this.lastCleanSummary.local || 0,remote:this.lastCleanSummary.remote || 0
      })});
    }

    if (!this.results.length) {
      renderScanEmpty(this,contentEl,'orphanNoneFound',{showMessage:!this.lastCleanSummary, closeLabel:this.lastCleanSummary ? 'destBtnDone' : null});
      return;
    }

    const toolbar = contentEl.createDiv({ cls: 'fm-toolbar-row' });
    const leftTools = toolbar.createDiv({ attr: { style: 'display:flex; gap:8px; align-items:center;' } });
    const backBtn = leftTools.createEl('button', { text: t('btnBack') });
    backBtn.onclick = () => {
      this.step = 1;
      this.render();
    };

    const selectAllBtn = leftTools.createEl('button', { text: t('btnSelectAll') });
    selectAllBtn.onclick = () => {
      const allSelected = this.results.every((r) => r.selected);
      this.results.forEach((r) => { r.selected = !allSelected; });
      this.render();
    };

    const exportBtn = toolbar.createEl('button', {
      text: t('btnExportReport')
    });
    exportBtn.onclick = async () => {
      await exportOrphanReportToRoot(this.plugin, this.results);
    };

    const listEl = contentEl.createDiv({ cls: 'fm-scroll-list fm-file-action-list' });
    for (const item of this.results) {
      const {actions}=fileActionRow(listEl,item,this.plugin,{
        selection:parent=>{
          const checkbox=parent.createEl('input',{type:'checkbox',attr:{'aria-label':item.name}});
          checkbox.checked=item.selected;
          checkbox.onchange=()=>{item.selected=checkbox.checked;};
        },
        metadata:parent=>{
          parent.createSpan({text:item.source==='local'?t('analyticsBadgeLocal'):t('analyticsBadgeRemote')});
          fileMetadata(parent,item,{path:item.displayPath});
        }
      });
      if (item.source==='remote') {
        const lockBtn=actions.createEl('button',{text:t('lockBtnText'),cls:'fm-mini-btn',attr:{'aria-label':t('lockBtnTitle')}});
        lockBtn.onclick=async()=>{
          try {
            await this.plugin.toggleRemoteFileLock(item.rawObj.year,item.rawObj.month,item.rawObj.filename,true);
            new Notice(this.plugin.t('noticeProtectedRemote',{name:item.name}));
            this.results=this.results.filter(result=>result.id!==item.id);this.render();
          } catch (error) { new Notice(this.plugin.t('noticeLockFailed',{err:error.message})); }
        };
      }
    }

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const cancelBtn = btnRow.createEl('button', { text: t('btnCancel') });
    cancelBtn.onclick = () => returnToHub(this);
    const cleanBtn = btnRow.createEl('button', {
      text: t('orphanDeleteSelected', { count: this.results.filter((r) => r.selected).length }),
      cls: 'mod-warning'
    });
    cleanBtn.onclick = async () => {
      const selected = this.results.filter((r) => r.selected);
      if (selected.length === 0) {
        new Notice(this.plugin.t('orphanSelectRequired'));
        return;
      }
      await cleanSelectedOrphans(this.plugin, selected, (summary) => {
        const removedIds = new Set(selected.map((s) => s.id));
        this.results = this.results.filter((r) => !removedIds.has(r.id));
        this.lastCleanSummary = summary;
        this.render();
      });
    };
  }

  onClose() {
    if (this.activeProgress) this.activeProgress.abort();
    this.contentEl.empty();
  }
}
