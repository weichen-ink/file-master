import { getExcludedLocalFolderList } from '../plugin/vault-utils.js';
import { scanDuplicateGroups, exportDuplicateReportToRoot } from '../plugin/vault-scans.js';
import { executeDuplicateMergeSafely } from '../plugin/attachment-ops.js';
import { formatBytes } from '../engine.js';
import { createScanProgressWidget, returnToHub } from './common.js';
import { NoteRefsModal } from './dialogs.js';
import { renderItemVisualThumb } from './incoming-file.js';
import { Modal, Notice } from 'obsidian';

/**
 * Wizard 2: Duplicate Finder Wizard
 * Step 1: Select duplicate comparison scope (with real-time scan progress + cancel button)
 * Step 2: Display duplicate groups, thumbnail previews, note references, and resolution strategies
 */
export class DuplicateWizardModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.step = 1;
    this.activeProgress = null;
    const isRemote = Boolean(plugin?.isRemoteServerReady?.());
    this.scope = isRemote ? 'both' : 'local';
    this.fileTypes = {
      typeImage: true,
      typeAudio: true,
      typeOther: true,
      typeNote: false
    };
    this.processMode = 'auto';
    this.groups = [];
    this.scanStats = { localScanned: 0, remoteScanned: 0, remoteError: null };
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
    header.createEl('h3', { text: t('dupStep1Title'), cls: 'fm-step-title' });

    contentEl.createEl('p', {
      text: t('dupStep1Desc'),
      attr: { style: 'font-size: 13px; color: var(--text-muted); margin-bottom: 14px;' }
    });

    const isRemote = Boolean(this.plugin?.isRemoteServerReady?.());
    if (isRemote) {
      const scopeBox = contentEl.createDiv({ cls: 'fm-section-box' });
      scopeBox.createDiv({ text: t('dupLocScope'), cls: 'fm-section-title' });

      const scopes = [
        { key: 'both', label: t('dupCompareCross') },
        { key: 'local', label: t('dupCompareLocal') },
        { key: 'remote', label: t('dupCompareRemote') }
      ];

      for (const s of scopes) {
        const row = scopeBox.createEl('label', { cls: 'fm-check-row' });
        const radio = row.createEl('input', { type: 'radio', attr: { name: 'fm_dup_scope' } });
        radio.checked = this.scope === s.key;
        radio.onchange = () => {
          this.scope = s.key;
        };
        row.createSpan({ text: s.label });
      }
    }

    const typeBox = contentEl.createDiv({ cls: 'fm-section-box' });
    typeBox.createDiv({ text: t('dupTypeScope'), cls: 'fm-section-title' });
    this.createTypeCheckbox(typeBox, t('dupTypeImage'), 'typeImage');
    this.createTypeCheckbox(typeBox, t('dupTypeAudio'), 'typeAudio');
    this.createTypeCheckbox(typeBox, t('dupTypeOther'), 'typeOther');
    this.createTypeCheckbox(typeBox, t('dupTypeNote'), 'typeNote');

    const exclFolders = getExcludedLocalFolderList(this.plugin.settings);
    const protBox = contentEl.createDiv({
      cls: 'fm-section-box',
      attr: { style: 'font-size: 12px; color: var(--text-muted); padding: 10px 14px;' }
    });
    protBox.createDiv({
      text: t('dupProtRuleHint', { folders: exclFolders.join(', ') || '-' })
    });

    const progressWidget = createScanProgressWidget(contentEl, this.plugin);
    this.activeProgress = progressWidget;

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const cancelBtn = btnRow.createEl('button', { text: t('btnCancel') });
    cancelBtn.onclick = () => returnToHub(this);

    const nextBtn = btnRow.createEl('button', { text: t('btnNext'), cls: 'mod-cta' });
    nextBtn.onclick = async () => {
      if (
        !this.fileTypes.typeImage &&
        !this.fileTypes.typeAudio &&
        !this.fileTypes.typeOther &&
        !this.fileTypes.typeNote
      ) {
        new Notice(this.plugin.t('dupSelectTypeRequired'));
        return;
      }
      nextBtn.disabled = true;
      nextBtn.setText(t('dupComparing'));
      progressWidget.show();
      try {
        const res = await scanDuplicateGroups(this.plugin, this.scope, this.fileTypes, {
          signal: progressWidget.signal,
          onProgress: (cur, total, label) => progressWidget.update(cur, total, label)
        });
        this.groups = res.groups;
        this.scanStats = res.stats;
        this.applyProcessMode('auto');
        this.step = 2;
        this.render();
      } catch (err) {
        progressWidget.hide();
        new Notice(err.message === 'SCAN_ABORTED' ? this.plugin.t('scanCancelled') : '❌ Comparison failed: ' + err.message);
        nextBtn.disabled = false;
        nextBtn.setText(t('btnNext'));
      }
    };
  }

  createTypeCheckbox(parent, labelText, key) {
    const label = parent.createEl('label', { cls: 'fm-check-row' });
    const cb = label.createEl('input', { type: 'checkbox' });
    cb.checked = Boolean(this.fileTypes[key]);
    cb.onchange = () => {
      this.fileTypes[key] = cb.checked;
    };
    label.createSpan({ text: labelText });
  }

  applyProcessMode(mode) {
    this.processMode = mode;
    for (const grp of this.groups) {
      const lockedItem = grp.items.find((i) => i.locked);
      if (lockedItem) {
        grp.keepId = lockedItem.id;
        continue;
      }

      if (mode === 'prefer-remote') {
        const remoteItem = grp.items.find((i) => i.source === 'remote');
        grp.keepId = remoteItem ? remoteItem.id : grp.items[0].id;
      } else if (mode === 'prefer-local') {
        const localItem = grp.items.find((i) => i.source === 'local');
        grp.keepId = localItem ? localItem.id : grp.items[0].id;
      } else {
        const sorted = [...grp.items].sort((a, b) => {
          if (b.refNotes.length !== a.refNotes.length) return b.refNotes.length - a.refNotes.length;
          if (a.source !== b.source) return a.source === 'remote' ? -1 : 1;
          return 0;
        });
        grp.keepId = sorted[0].id;
      }
    }
  }

  renderStep2(contentEl) {
    const t = (k, p) => this.plugin.t(k, p);
    const totalDupes = this.groups.reduce((acc, g) => acc + Math.max(0, g.items.length - 1), 0);
    const header = contentEl.createDiv({ cls: 'fm-step-header' });
    header.createSpan({ text: t('stepOf', { current: 2, total: 2 }), cls: 'fm-step-badge' });
    header.createEl('h3', {
      text: t('dupStep2Title', { groups: this.groups.length, redundant: totalDupes }),
      cls: 'fm-step-title'
    });

    const toolbar = contentEl.createDiv({ cls: 'fm-toolbar-row' });
    const leftTools = toolbar.createDiv({ attr: { style: 'display:flex; gap:8px; align-items:center; flex-wrap:wrap;' } });

    const backBtn = leftTools.createEl('button', { text: t('btnBack') });
    backBtn.onclick = () => {
      this.step = 1;
      this.render();
    };

    leftTools.createSpan({ text: t('dupStrategyLabel'), attr: { style: 'font-size:13px; font-weight:600; margin-left:4px;' } });
    const modeSelect = leftTools.createEl('select', { attr: { style: 'padding: 5px 8px; border-radius: 6px;' } });
    const modeOptions = [
      { value: 'auto', label: t('dupStrategyAuto') },
      { value: 'prefer-remote', label: t('dupStrategyPreferRemote') },
      { value: 'prefer-local', label: t('dupStrategyPreferLocal') }
    ];
    for (const opt of modeOptions) {
      const o = modeSelect.createEl('option', { value: opt.value, text: opt.label });
      if (opt.value === this.processMode) o.selected = true;
    }
    modeSelect.onchange = () => {
      this.applyProcessMode(modeSelect.value);
      this.render();
    };

    const exportBtn = toolbar.createEl('button', {
      text: t('btnExportReport')
    });
    exportBtn.onclick = async () => {
      await exportDuplicateReportToRoot(this.plugin, this.groups);
    };

    if (this.scanStats?.remoteError) {
      contentEl.createDiv({
        cls: 'fm-section-box',
        text: t('noticeRemoteUnreachable', { err: this.scanStats.remoteError }),
        attr: { style: 'font-size: 12px; color: #f59e0b; border-color: rgba(245, 158, 11, 0.4); padding: 10px 14px;' }
      });
    }

    if (this.groups.length === 0) {
      contentEl.createDiv({
        cls: 'fm-section-box',
        text: t('dupNoneFound'),
        attr: { style: 'text-align: center; padding: 36px 20px;' }
      });
      const emptyBtnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
      const closeBtn = emptyBtnRow.createEl('button', { text: t('closeBtn'), cls: 'mod-cta' });
      closeBtn.onclick = () => returnToHub(this);
      return;
    }

    const listEl = contentEl.createDiv({ cls: 'fm-scroll-list' });
    this.groups.forEach((grp, idx) => {
      const grpBox = listEl.createDiv({ cls: 'fm-dup-group' });
      const grpHead = grpBox.createDiv({ cls: 'fm-dup-group-header' });
      grpHead.createSpan({
        text: t('dupGroupHeader', { idx: idx + 1, hash: grp.sha256.slice(0, 12), size: formatBytes(grp.size) })
      });
      grpHead.createSpan({ text: t('dupGroupSubhint') });

      for (const item of grp.items) {
        const isKeep = grp.keepId === item.id;
        const row = grpBox.createDiv({ cls: 'fm-list-item' });
        const left = row.createDiv({
          attr: { style: 'display:flex; align-items:center; gap:8px; flex:1; overflow:hidden;' }
        });

        const radio = left.createEl('input', {
          type: 'radio',
          attr: { name: `dup_grp_${idx}`, style: 'cursor:pointer;' }
        });
        radio.checked = isKeep;
        radio.onchange = () => {
          grp.keepId = item.id;
          this.render();
        };

        renderItemVisualThumb(left, item, this.plugin);

        left.createSpan({
          text: isKeep ? t('dupTagKeep') : item.locked ? t('dupTagProtected') : t('dupTagRemove'),
          attr: { style: `font-size:12px; font-weight:700; color:${isKeep ? '#10b981' : item.locked ? '#f59e0b' : '#ef4444'}; width:68px; flex-shrink:0;` }
        });

        left.createSpan({
          text: item.source === 'local' ? t('analyticsBadgeLocal') : t('analyticsBadgeRemote'),
          cls: `fm-tag ${item.source === 'local' ? 'fm-tag-local' : 'fm-tag-remote'}`
        });

        if (item.locked) {
          left.createSpan({
            text: '🔒 ' + (this.t ? this.t('tagLocked') : 'Locked'),
            cls: 'fm-tag fm-tag-lock'
          });
        }

        left.createSpan({
          text: item.displayPath,
          attr: { title: t('dupDesignateKeepTitle'), attr: { style: 'word-break:break-all; cursor:pointer;' } }
        }).onclick = () => {
          grp.keepId = item.id;
          this.render();
        };

        const rightBox = row.createDiv({
          attr: { style: 'display:flex; align-items:center; gap:6px; flex-shrink:0;' }
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
    });

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const cancelBtn = btnRow.createEl('button', { text: t('btnCancel') });
    cancelBtn.onclick = () => returnToHub(this);
    const execBtn = btnRow.createEl('button', {
      text: t('dupMergeRewrite', { count: totalDupes }),
      cls: 'mod-cta'
    });
    execBtn.onclick = async () => {
      await executeDuplicateMergeSafely(this.plugin, this.groups, (summary) => {
        this.step = 3;
        this.summary = summary;
        this.render();
      });
    };
  }

  renderStep3(contentEl) {
    const t = (k, p) => this.plugin.t(k, p);
    contentEl.createEl('h3', { text: t('dupResultTitle') });

    const banner = contentEl.createDiv({ cls: 'fm-result-banner fm-result-banner-success' });
    banner.createDiv({ cls: 'fm-result-banner-title', text: t('dupResultTitle') });
    banner.createDiv({
      cls: 'fm-result-banner-desc',
      text: t('dupResultDesc', {
        modified: this.summary?.modified || 0,
        local: this.summary?.local || 0,
        remote: this.summary?.remote || 0,
        skipped: this.summary?.skipped > 0 ? t('dupResultSkipped', { count: this.summary.skipped }) : ''
      })
    });

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const doneBtn = btnRow.createEl('button', { text: t('destBtnDone'), cls: 'mod-cta' });
    doneBtn.onclick = () => returnToHub(this);
  }

  onClose() {
    if (this.activeProgress) this.activeProgress.abort();
    this.contentEl.empty();
  }
}
