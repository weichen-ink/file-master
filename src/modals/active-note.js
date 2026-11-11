import { moduleHeading } from "../ui/navigation.js";
import { scanActiveNoteLocalAttachments, scanActiveNoteRemoteAttachments } from '../plugin/attachment-ops.js';
import { exportBatchMigrateReportToRoot } from '../plugin/vault-scans.js';
import { formatBytes } from '../engine.js';
import { formatFriendlyError, returnToHub } from './common.js';
import { NoteRefsModal } from './dialogs.js';
import { renderItemVisualThumb } from './incoming-file.js';
import { Notice } from 'obsidian';
import { FileMasterModal as Modal } from '../ui/modal.js';

/**
 * Modal to execute active note operations with 2-step preview/options (for migrate & download conflict check),
 * real-time progress bar & in-window result list
 */
export class ActiveNoteActionModal extends Modal {
  constructor(app, plugin, targetFile, actionType = 'migrate', options = {}) {
    super(app);
    this.plugin = plugin;
    this.targetFile = targetFile;
    this.actionType = actionType; // 'migrate' | 'download'
    this.fromHub = Boolean(options?.fromHub);
    this.step = 'loading';
    this.items = [];
    this.deleteLocalAfter = Boolean(plugin?.settings?.deleteLocalAfterMigrate);
    this.syncOtherNotes = true;
    this.conflictStrategy = 'reuse'; // 'reuse' | 'rename' | 'overwrite'
    this.hadConflictStep = false;
    this.result = null;
  }

  t(k, p) {
    return this.plugin ? this.plugin.t(k, p) : k;
  }

  getUniqueOtherRefNotes(onlySelected = false) {
    const set = new Set();
    for (const item of this.items) {
      if (onlySelected && !item.selected) continue;
      for (const p of item.otherRefNotes || []) {
        set.add(p);
      }
    }
    return [...set];
  }

  async onOpen() {
    this.render();
    if (this.actionType === 'migrate') {
      try {
        this.items = await scanActiveNoteLocalAttachments(this.plugin, this.targetFile);
        if (this.transferClosed) return;
        this.step = 'preview';
      } catch (err) {
        this.result = { success: false, message: err.message || String(err) };
        this.step = 'result';
      }
      this.render();
    } else {
      try {
        this.items = await scanActiveNoteRemoteAttachments(this.plugin, this.targetFile);
        if (this.transferClosed) return;
        if (this.items.length === 0) {
          this.result = { success: true, count: 0, processedItems: [], failures: [] };
          this.step = 'result';
          this.render();
          return;
        }
        const hasConflicts = this.items.some((item) => item.hasConflict);
        const hasOtherRefs = this.items.some((item) => (item.otherRefNotes?.length || 0) > 0);
        if (hasConflicts || hasOtherRefs) {
          this.hadConflictStep = true;
          this.step = 'conflict';
          this.render();
        } else {
          this.step = 'running';
          this.render();
          await this.execute(this.items);
        }
      } catch (err) {
        this.result = { success: false, message: err.message || String(err) };
        this.step = 'result';
        this.render();
      }
    }
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('fm-wizard-modal');

    const upload = this.actionType === 'migrate';
    const withSteps = this.items.length > 0 && !['loading','result'].includes(this.step) && (upload || this.hadConflictStep || this.step === 'conflict');
    const step = ['loading','preview','conflict'].includes(this.step) ? 1 : 2;
    moduleHeading(this,contentEl,{title:upload?'actNoteUpTitle':'actNoteDownTitle',symbol:upload?'upload':'download',step:withSteps?step:null,total:2});

    contentEl.createDiv({
      text: `📄 ${this.targetFile.path}`,
      attr: { style: 'font-size: 12px; color: var(--text-muted); margin-bottom: 12px;' }
    });

    if (this.step === 'loading') {
      const box = contentEl.createDiv({ cls: 'fm-section-box' });
      box.createDiv({
        text: this.t('activeNoteScanning'),
        attr: { style: 'font-size: 13px; color: var(--text-accent);' }
      });
      return;
    }

    if (this.step === 'conflict') {
      const conflictItems = this.items.filter((i) => i.hasConflict);
      const otherRefNotesAll = this.getUniqueOtherRefNotes(false);

      if (conflictItems.length > 0) {
        const warnBanner = contentEl.createDiv({
          cls: 'fm-result-banner fm-result-banner-error',
          attr: { style: 'margin-bottom: 12px;' }
        });
        warnBanner.createDiv({
          cls: 'fm-result-banner-title',
          text: this.t('activeNoteDownConflictTitle', { count: conflictItems.length }),
          attr: { style: 'margin-bottom: 0;' }
        });
      } else if (otherRefNotesAll.length > 0) {
        const infoBanner = contentEl.createDiv({
          cls: 'fm-result-banner fm-result-banner-instant',
          attr: { style: 'margin-bottom: 12px;' }
        });
        infoBanner.createDiv({
          cls: 'fm-result-banner-title',
          text: this.t('activeNoteDownOtherRefsTitle', { count: otherRefNotesAll.length }),
          attr: { style: 'margin-bottom: 0;' }
        });
      }

      const listEl = contentEl.createDiv({
        cls: 'fm-scroll-list',
        attr: { style: 'max-height: 220px;' }
      });

      let runBtn = null;
      const updateRunBtnLabel = () => {
        if (!runBtn) return;
        const selectedCount = this.items.filter((i) => i.selected).length;
        runBtn.setText(this.t('activeNoteStartDownload', { count: selectedCount }));
      };

      for (const item of this.items) {
        const row = listEl.createDiv({ cls: 'fm-list-item' });
        const left = row.createDiv({
          attr: { style: 'display:flex; align-items:center; gap:10px; flex:1; overflow:hidden;' }
        });
        const cb = left.createEl('input', { type: 'checkbox', attr: { style: 'cursor:pointer;' } });
        cb.checked = item.selected;
        cb.onchange = () => {
          item.selected = cb.checked;
          updateRunBtnLabel();
        };

        renderItemVisualThumb(left, item, this.plugin);

        const nameCol = left.createDiv({
          attr: { style: 'display:flex; flex-direction:column; overflow:hidden; flex:1;' }
        });
        nameCol.createSpan({
          text: item.name,
          attr: { style: 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:500;' }
        });
        const displayPath = (item.hasConflict && item.existingFile)
          ? item.existingFile.path
          : item.idealPath;
        nameCol.createSpan({
          text: `${displayPath}${item.size ? ' · ' + formatBytes(item.size) : ''}`,
          attr: { style: 'font-size:11px; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;' }
        });

        const otherRefs = item.otherRefNotes || [];
        if (otherRefs.length > 0) {
          const rightBox = row.createDiv({
            attr: { style: 'display:flex; align-items:center; gap:6px; flex-shrink:0;' }
          });
          const refBadge = rightBox.createSpan({
            text: this.t('activeNoteOtherRefsBadge', { count: otherRefs.length }),
            cls: 'fm-tag fm-tag-ref fm-clickable-badge',
            attr: { 'aria-label': this.t('activeNoteInspectOtherRefs') }
          });
          refBadge.onclick = (e) => {
            e.stopPropagation();
            new NoteRefsModal(this.app, item.name, otherRefs, () => this.close(), this.plugin).open();
          };
        }
      }

      if (otherRefNotesAll.length > 0 || conflictItems.length > 0) {
        const optionsBox = contentEl.createDiv({
          cls: 'fm-section-box',
          attr: { style: 'margin-top: 10px; display: flex; flex-direction: column; gap: 10px;' }
        });

        if (otherRefNotesAll.length > 0) {
          const syncLabel = optionsBox.createEl('label', {
            cls: 'fm-check-row',
            attr: { style: 'margin: 0; cursor: pointer;' }
          });
          const syncCb = syncLabel.createEl('input', { type: 'checkbox' });
          syncCb.checked = this.syncOtherNotes;
          syncCb.onchange = () => {
            this.syncOtherNotes = syncCb.checked;
          };
          syncLabel.createSpan({
            text: this.t('activeNoteSyncOtherDownloadOpt', { count: otherRefNotesAll.length })
          });
        }

        if (conflictItems.length > 0) {
          const strategyWrap = optionsBox.createDiv({
            attr: {
              style: otherRefNotesAll.length > 0
                ? 'border-top: 1px solid var(--background-modifier-border); padding-top: 10px;'
                : ''
            }
          });
          strategyWrap.createDiv({
            text: this.t('activeNoteDownStrategyTitle'),
            cls: 'fm-section-title'
          });

          const strategies = [
            { value: 'reuse', label: this.t('activeNoteDownOptReuse') },
            { value: 'rename', label: this.t('activeNoteDownOptRename') },
            { value: 'overwrite', label: this.t('activeNoteDownOptOverwrite') }
          ];
          for (const st of strategies) {
            const rowLabel = strategyWrap.createEl('label', {
              cls: 'fm-check-row',
              attr: { style: 'cursor:pointer;' }
            });
            const radio = rowLabel.createEl('input', {
              type: 'radio',
              attr: { name: 'fm-down-conflict-strategy', value: st.value }
            });
            radio.checked = this.conflictStrategy === st.value;
            radio.onchange = () => {
              if (radio.checked) this.conflictStrategy = st.value;
            };
            rowLabel.createSpan({ text: st.label });
          }
        }
      }

      const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
      const cancelBtn = btnRow.createEl('button', { text: this.t('btnCancel') });
      cancelBtn.onclick = () => returnToHub(this);

      runBtn = btnRow.createEl('button', {
        text: this.t('activeNoteStartDownload', { count: this.items.filter((i) => i.selected).length }),
        cls: 'mod-cta'
      });
      runBtn.onclick = async () => {
        const selected = this.items.filter((i) => i.selected);
        if (selected.length === 0) {
          new Notice(this.t('activeNoteSelectRequired'));
          return;
        }
        this.step = 'running';
        this.render();
        await this.execute(selected);
      };
      return;
    }

    if (this.step === 'preview') {
      if (this.items.length === 0) {
        const emptyBanner = contentEl.createDiv({
          cls: 'fm-section-box',
          attr: { style: 'text-align: center; padding: 24px 16px;' }
        });
        emptyBanner.createDiv({
          text: this.t('activeNoteNoLocal'),
          attr: { style: 'font-size: 14px; color: var(--text-muted);' }
        });
        const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
        const closeBtn = btnRow.createEl('button', { text: this.t(this.fromHub ? 'btnCancel' : 'closeBtn') });
        closeBtn.onclick = () => returnToHub(this);
        return;
      }

      contentEl.createEl('p', {
        text: this.t('activeNoteStep1Desc', { count: this.items.length }),
        cls: 'fm-step-desc'
      });

      const listEl = contentEl.createDiv({
        cls: 'fm-scroll-list',
        attr: { style: 'max-height: 240px;' }
      });

      let runBtn = null;
      const updateRunBtnLabel = () => {
        if (!runBtn) return;
        const selectedCount = this.items.filter((i) => i.selected).length;
        runBtn.setText(this.t('activeNoteStartUpload', { count: selectedCount }));
      };

      for (const item of this.items) {
        const row = listEl.createDiv({ cls: 'fm-list-item' });
        const left = row.createDiv({
          attr: { style: 'display:flex; align-items:center; gap:10px; flex:1; overflow:hidden;' }
        });
        const cb = left.createEl('input', { type: 'checkbox', attr: { style: 'cursor:pointer;' } });
        cb.checked = item.selected;
        cb.onchange = () => {
          item.selected = cb.checked;
          updateRunBtnLabel();
        };

        renderItemVisualThumb(left, item, this.plugin);

        const nameCol = left.createDiv({
          attr: { style: 'display:flex; flex-direction:column; overflow:hidden; flex:1;' }
        });
        nameCol.createSpan({
          text: item.name,
          attr: { style: 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:500;' }
        });
        nameCol.createSpan({
          text: `${item.displayPath} · ${formatBytes(item.size)}`,
          attr: { style: 'font-size:11px; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;' }
        });

        const rightBox = row.createDiv({
          attr: { style: 'display:flex; align-items:center; gap:8px; flex-shrink:0;' }
        });
        const otherRefs = item.otherRefNotes || [];
        if (otherRefs.length > 0) {
          const refBadge = rightBox.createSpan({
            text: this.t('activeNoteOtherRefsBadge', { count: otherRefs.length }),
            cls: 'fm-tag fm-tag-ref fm-clickable-badge',
            attr: { 'aria-label': this.t('activeNoteInspectOtherRefs') }
          });
          refBadge.onclick = (e) => {
            e.stopPropagation();
            new NoteRefsModal(this.app, item.name, otherRefs, () => this.close(), this.plugin).open();
          };
        }

        const lockBtn = rightBox.createEl('button', {
          type: 'button',
          cls: 'fm-mini-btn',
          text: item.locked ? this.t('activeNoteBtnLockOn') : this.t('activeNoteBtnLockOff'),
          attr: {
            style: item.locked
              ? 'border-color: var(--interactive-accent); color: var(--text-accent); font-weight: 600;'
              : 'color: var(--text-muted);'
          }
        });
        lockBtn.onclick = (e) => {
          e.stopPropagation();
          item.locked = !item.locked;
          lockBtn.setText(item.locked ? this.t('activeNoteBtnLockOn') : this.t('activeNoteBtnLockOff'));
          lockBtn.style.cssText = item.locked
            ? 'border-color: var(--interactive-accent); color: var(--text-accent); font-weight: 600;'
            : 'color: var(--text-muted);';
        };
      }

      contentEl.createDiv({
        cls: 'fm-section-box',
        text: this.t('activeNoteLockExplain'),
        attr: { style: 'font-size: 12px; color: var(--text-muted); line-height: 1.5; margin-top: 10px;' }
      });

      const otherRefNotesAll = this.getUniqueOtherRefNotes(false);
      const optBox = contentEl.createDiv({
        cls: 'fm-section-box',
        attr: { style: 'margin-top: 8px; display: flex; flex-direction: column; gap: 10px;' }
      });

      if (otherRefNotesAll.length > 0) {
        const syncLabel = optBox.createEl('label', {
          cls: 'fm-check-row',
          attr: { style: 'margin: 0; cursor: pointer;' }
        });
        const syncCb = syncLabel.createEl('input', { type: 'checkbox' });
        syncCb.checked = this.syncOtherNotes;
        syncCb.onchange = () => {
          this.syncOtherNotes = syncCb.checked;
        };
        syncLabel.createSpan({
          text: this.t('activeNoteSyncOtherUploadOpt', { count: otherRefNotesAll.length })
        });
      }

      const delWrap = optBox.createDiv({
        attr: {
          style: otherRefNotesAll.length > 0
            ? 'border-top: 1px solid var(--background-modifier-border); padding-top: 10px;'
            : ''
        }
      });
      const delLabel = delWrap.createEl('label', {
        cls: 'fm-check-row',
        attr: { style: 'margin: 0; cursor: pointer;' }
      });
      const delCb = delLabel.createEl('input', { type: 'checkbox' });
      delCb.checked = this.deleteLocalAfter;
      delCb.onchange = () => {
        this.deleteLocalAfter = delCb.checked;
      };
      delLabel.createSpan({ text: this.t('activeNoteDeleteLocalOpt') });

      const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
      const cancelBtn = btnRow.createEl('button', { text: this.t('btnCancel') });
      cancelBtn.onclick = () => returnToHub(this);

      runBtn = btnRow.createEl('button', {
        text: this.t('activeNoteStartUpload', { count: this.items.filter((i) => i.selected).length }),
        cls: 'mod-cta'
      });
      runBtn.onclick = async () => {
        const selected = this.items.filter((i) => i.selected);
        if (selected.length === 0) {
          new Notice(this.t('activeNoteSelectRequired'));
          return;
        }
        this.step = 'running';
        this.render();
        await this.execute(selected);
      };
      return;
    }

    if (this.step === 'running') {
      const box = contentEl.createDiv({ cls: 'fm-section-box' });
      const progressHeader = box.createDiv({ attr: { style: 'display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;' } });
      this.statusText = progressHeader.createDiv({
        text: this.t('activeNoteScanning'),
        attr: { style: 'font-size: 12.5px; color: var(--text-accent); font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:65%;' }
      });
      this.speedText = progressHeader.createDiv({
        attr: { style: 'font-size: 11.5px; font-family:var(--font-monospace); color: var(--text-muted); font-weight: 600; white-space:nowrap;' }
      });
      const wrap = box.createDiv({ cls: 'fm-progress-wrap' });
      this.progressBar = wrap.createDiv({ cls: 'fm-progress-bar', attr: { style: 'width: 10%; margin-bottom:8px;' } });
      const stop = box.createEl('button', { text: this.t('transferStop') });
      stop.onclick = () => {
        this.transferController?.abort();
        stop.disabled = true;
        this.statusText.setText(this.t('transferStopping'));
      };
    } else if (this.step === 'result') {
      const failures = this.result?.failures || [];
      const processedItems = this.result?.processedItems || [];
      if (!this.result.success) {
        const errBanner = contentEl.createDiv({ cls: 'fm-result-banner fm-result-banner-error' });
        errBanner.createDiv({ cls: 'fm-result-banner-title', text: '❌ ' + this.result.message });
      } else {
        if (this.result.count > 0) {
          const banner = contentEl.createDiv({ cls: 'fm-result-banner fm-result-banner-success' });
          banner.createDiv({
            cls: 'fm-result-banner-title',
            text: this.result.cancelled ? this.t('transferCancelled') : this.actionType === 'migrate' ? this.t('activeNoteMigrateComplete') : this.t('activeNoteDownloadComplete')
          });
          banner.createDiv({
            cls: 'fm-result-banner-desc',
            text: this.actionType === 'migrate'
              ? this.t('activeNoteMigrateDoneDesc', { count: this.result.count })
              : this.t('activeNoteDownloadDoneDesc', { count: this.result.count })
          });

          const trashFailedList = processedItems.filter((p) => p.trashError);
          if (trashFailedList.length > 0) {
            const warnBox = contentEl.createDiv({
              cls: 'fm-alert fm-alert-warning',
              attr: { style: 'margin-top: 10px; margin-bottom: 6px; font-size: 12px;' }
            });
            warnBox.createSpan({
              text: this.t('activeNoteTrashFailedNotice', { count: trashFailedList.length })
            });
          }

          if (processedItems.length > 0) {
            const listBox = contentEl.createDiv({
              cls: 'fm-section-box',
              attr: { style: 'margin-top: 10px;' }
            });
            listBox.createDiv({
              text: this.t('activeNoteResultListTitle', { count: processedItems.length }),
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
                text: `${pItem.displayPath}${pItem.size ? ' · ' + formatBytes(pItem.size) : ''}`,
                attr: { style: 'font-size:11px; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;' }
              });

              const rightBox = row.createDiv({
                attr: { style: 'display:flex; align-items:center; gap:6px; flex-shrink:0; flex-wrap:wrap; justify-content:flex-end;' }
              });
              if (pItem.syncedOtherNotes > 0) {
                const syncedPaths = Array.isArray(pItem.syncedOtherNotePaths) ? pItem.syncedOtherNotePaths : [];
                const syncedBadge = rightBox.createSpan({
                  text: this.t('activeNoteBadgeSyncedNotes', { count: pItem.syncedOtherNotes }),
                  cls: syncedPaths.length > 0 ? 'fm-tag fm-tag-ref fm-clickable-badge' : 'fm-tag fm-tag-ref',
                  attr: syncedPaths.length > 0 ? { 'aria-label': this.t('activeNoteInspectOtherRefs') } : {}
                });
                if (syncedPaths.length > 0) {
                  syncedBadge.onclick = (e) => {
                    e.stopPropagation();
                    new NoteRefsModal(this.app, pItem.name, syncedPaths, () => this.close(), this.plugin).open();
                  };
                }
              }
              if (pItem.trashedLocal) {
                rightBox.createSpan({ text: this.t('activeNoteBadgeTrashedLocal'), cls: 'fm-tag fm-tag-info' });
              } else if (pItem.trashError) {
                rightBox.createSpan({
                  text: this.t('activeNoteBadgeTrashFailed'),
                  cls: 'fm-tag fm-tag-danger',
                  attr: { 'aria-label': String(pItem.trashError) }
                });
              } else if (pItem.keptForOtherRefs > 0) {
                const keptPaths = Array.isArray(pItem.keptForOtherRefPaths) ? pItem.keptForOtherRefPaths : [];
                const keptBadge = rightBox.createSpan({
                  text: this.t('activeNoteBadgeKeptForOtherRefs', { count: pItem.keptForOtherRefs }),
                  cls: keptPaths.length > 0 ? 'fm-tag fm-tag-warning fm-clickable-badge' : 'fm-tag fm-tag-warning',
                  attr: keptPaths.length > 0 ? { 'aria-label': this.t('activeNoteInspectOtherRefs') } : {}
                });
                if (keptPaths.length > 0) {
                  keptBadge.onclick = (e) => {
                    e.stopPropagation();
                    new NoteRefsModal(this.app, pItem.name, keptPaths, () => this.close(), this.plugin).open();
                  };
                }
              }
              if (pItem.locked) {
                rightBox.createSpan({ text: this.t('activeNoteBtnLockOn'), cls: 'fm-tag fm-tag-info' });
              }
              let badgeKey = 'activeNoteBadgeDownloaded';
              if (pItem.action === 'reused') badgeKey = 'activeNoteBadgeReused';
              else if (pItem.action === 'overwritten') badgeKey = 'activeNoteBadgeOverwritten';
              else if (pItem.action === 'uploaded') badgeKey = 'activeNoteBadgeUploaded';
              rightBox.createSpan({
                text: this.t(badgeKey),
                cls: 'fm-tag fm-tag-info'
              });
            }
          }
        } else if (failures.length === 0 && !this.result.cancelled) {
          const emptyBanner = contentEl.createDiv({ cls: 'fm-section-box', attr: { style: 'text-align: center; padding: 24px 16px;' } });
          emptyBanner.createDiv({
            text: this.actionType === 'migrate' ? this.t('activeNoteNoLocal') : this.t('activeNoteNoRemote'),
            attr: { style: 'font-size: 14px; color: var(--text-muted);' }
          });
        }

        if (failures.length > 0) {
          const failBanner = contentEl.createDiv({
            cls: 'fm-result-banner fm-result-banner-error',
            attr: { style: 'margin-top: 10px;' }
          });
          const failTitleKey = this.actionType === 'migrate' ? 'activeNoteFailedTitle' : 'activeNoteDownFailedTitle';
          failBanner.createDiv({
            cls: 'fm-result-banner-title',
            text: this.t(failTitleKey, { failed: failures.length })
          });
          for (const f of failures) {
            const reason = formatFriendlyError(this, f.error);
            failBanner.createDiv({
              cls: 'fm-result-banner-desc',
              text: `• ${f.name} (${formatBytes(f.size || 0)}): ${reason}`,
              attr: { style: 'margin-top: 4px;' }
            });
          }
        }
      }

      const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
      if (this.actionType === 'migrate' && processedItems.length > 0) {
        let noteReportPath = null;
        const exportBtn = btnRow.createEl('button', { text: this.t('batchExportReport') });
        exportBtn.onclick = async () => {
          exportBtn.disabled = true;
          try {
            noteReportPath = await exportBatchMigrateReportToRoot(this.plugin, {
              count: this.result.count,
              docs: 1,
              trashed: processedItems.filter((p) => p.trashedLocal).length,
              processedItems,
              failures: this.result.failures || [],
              totalBytes: processedItems.reduce((s, p) => s + (p.size || 0), 0)
            });
            exportBtn.setText(this.t('batchReportExported'));
            if (!btnRow.querySelector('.fm-open-report-btn')) {
              const openBtn = btnRow.createEl('button', {
                text: this.t('batchOpenReport'),
                cls: 'fm-open-report-btn'
              });
              openBtn.onclick = () => {
                if (noteReportPath) {
                  this.app.workspace.openLinkText(noteReportPath, '', true);
                }
                this.close();
              };
            }
          } catch (err) {
            new Notice('❌ ' + err.message);
            exportBtn.disabled = false;
          }
        };
      }
      if (this.result?.cancelled) btnRow.createSpan({ text: this.t('transferCancelled') });
      if (this.result?.retryItems?.length) {
        const retry = btnRow.createEl('button', { text: this.t('transferRetry') });
        retry.onclick = async () => {
          const pending = this.result.retryItems;
          this.step = 'running';
          this.render();
          await this.execute(pending);
        };
      }
      const doneBtn = btnRow.createEl('button', { text: this.t('destBtnDone'), cls: 'mod-cta' });
      doneBtn.onclick = () => returnToHub(this);
    }
  }

  async execute(selectedItems = null) {
    this.transferController = new AbortController();
    try {
      if (this.actionType === 'migrate') {
        const res = await this.plugin.executeMigrateNoteDirect(
          this.targetFile,
          (cur, total, name, stats) => {
            if (this.progressBar) {
              const pct = Math.round((cur / Math.max(1, total)) * 100);
              this.progressBar.style.width = `${pct}%`;
            }
            if (this.statusText) {
              this.statusText.setText(this.t('activeNoteProcessing', { current: cur, total, name }));
            }
            if (this.speedText && stats?.speedText) {
              const eta = stats.etaText ? ` · 剩余约 ${stats.etaText}` : '';
              this.speedText.setText(`⚡ ${stats.speedText}${eta}`);
            }
          },
          {
            items: selectedItems || this.items.filter((i) => i.selected),
            deleteLocalAfter: this.deleteLocalAfter,
            syncOtherNotes: this.syncOtherNotes,
            signal: this.transferController.signal,
            returnDetails: true
          }
        );
        const count = typeof res === 'object' ? (res.count || 0) : Number(res || 0);
        const processedItems = typeof res === 'object' && Array.isArray(res.processedItems) ? res.processedItems : [];
        const failures = typeof res === 'object' && Array.isArray(res.failures) ? res.failures : [];
        this.result = { success: true, ...res, count, processedItems, failures };
      } else {
        const res = await this.plugin.executeDownloadNoteDirect(
          this.targetFile,
          (cur, total, name, stats) => {
            if (this.progressBar) {
              const pct = Math.round((cur / Math.max(1, total)) * 100);
              this.progressBar.style.width = `${pct}%`;
            }
            if (this.statusText) {
              this.statusText.setText(this.t('activeNoteProcessing', { current: cur, total, name }));
            }
            if (this.speedText && stats?.speedText) {
              const eta = stats.etaText ? ` · 剩余约 ${stats.etaText}` : '';
              this.speedText.setText(`⚡ ${stats.speedText}${eta}`);
            }
          },
          {
            items: selectedItems || this.items.filter((i) => i.selected),
            conflictStrategy: this.conflictStrategy,
            syncOtherNotes: this.syncOtherNotes,
            signal: this.transferController.signal,
            returnDetails: true
          }
        );
        const count = typeof res === 'object' ? (res.count || 0) : Number(res || 0);
        const processedItems = typeof res === 'object' && Array.isArray(res.processedItems) ? res.processedItems : [];
        const failures = typeof res === 'object' && Array.isArray(res.failures) ? res.failures : [];
        this.result = { success: true, ...res, count, processedItems, failures };
      }
    } catch (err) {
      this.result = { success: false, message: err.message };
    }
    this.transferController = null;
    this.step = 'result';
    if (!this.transferClosed) this.render();
  }

  onClose() {
    this.transferClosed = true;
    this.transferController?.abort();
    this.contentEl.empty();
  }
}
