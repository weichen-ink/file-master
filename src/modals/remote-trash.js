import { Notice } from 'obsidian';
import { FileMasterModal as Modal } from '../ui/modal.js';
import { formatBytes } from '../engine.js';
import { galleryStore } from '../ui/gallery-store.js';
import { fileActionRow, fileMetaItem, fileSizeBadge } from '../ui/file-action-list.js';
import { modalChrome, openModal, moduleHeading } from '../ui/navigation.js';
import { ConfirmActionModal, ImageLightboxModal } from './dialogs.js';

/** Restorable server files use the same Hub shell and file-row vocabulary. */
export class RemoteTrashModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.generation = 0;
    this.selected = new Set();
    this.lastIndex = null;
    this.busy = false;
    this.thumbUrls = [];
  }
  revokeThumbUrls() {
    for (const url of this.thumbUrls) {
      if (typeof url === 'string' && url.startsWith('blob:')) URL.revokeObjectURL(url);
    }
    this.thumbUrls = [];
  }
  t(key, params) { return this.plugin.t(key, params); }
  onOpen() {
    this.closed = false;
    this.modalEl.addClass('fm-ui', 'fm-trash-dialog');
    modalChrome(this);
    this.contentEl.addClass('fm-trash-browser');
    return this.load();
  }
  async load() {
    const generation = ++this.generation;
    this.revokeThumbUrls();
    this.contentEl.empty();
    moduleHeading(this,this.contentEl,{title:'remoteTrashTitle',symbol:'trash-2'});
    this.contentEl.createDiv({text:this.t('remoteTrashLoading'), cls:'fm-browser-status'});
    try {
      const items = await this.plugin.fetchRemoteTrash();
      if (this.closed || generation !== this.generation) return;
      this.selected = new Set();
      this.lastIndex = null;
      this.busy = false;
      this.contentEl.empty();
      moduleHeading(this,this.contentEl,{title:'remoteTrashTitle',symbol:'trash-2'});
      if (!items.length) {
        this.contentEl.createDiv({text:this.t('remoteTrashEmpty'), cls:'fm-empty-state'});
        return;
      }
      this.renderTrashWorkspace(items);
    } catch (error) {
      if (this.closed || generation !== this.generation) return;
      this.contentEl.empty();
      moduleHeading(this,this.contentEl,{title:'remoteTrashTitle',symbol:'trash-2'});
      const message = /invalid or expired session/i.test(error.message) ? this.t('remoteTrashSessionError') : /401|invalid API token|unauthorized/i.test(error.message) ? this.t('remoteTrashAuthError') : error.message;
      this.contentEl.createEl('p', {text:message, cls:'fm-asset-hint'});
      const retry = this.contentEl.createEl('button', {text:this.t('previewRetry')});
      retry.onclick = () => this.load();
    } finally {
      if(this.fromHub && !this.closed && generation===this.generation){
        const footer=this.contentEl.createDiv({cls:'fm-btn-row'});
        footer.createEl('button',{text:this.t('btnCancel')}).onclick=()=>this.returnToHub();
      }
    }
  }
  renderTrashWorkspace(items) {
    const toolbar = this.contentEl.createDiv({ cls: 'fm-trash-toolbar' });
    const list = this.contentEl.createDiv({ cls: 'fm-scroll-list fm-file-action-list' });
    const totalBytes = items.reduce((sum, item) => sum + (Number(item.size) || 0), 0);
    const rowControls = [];

    const syncToolbar = () => {
      toolbar.empty();
      const count = this.selected.size;
      const picked = items.filter((item) => this.selected.has(item.id));
      const pickedBytes = picked.reduce((sum, item) => sum + (Number(item.size) || 0), 0);

      const selectLabel = toolbar.createEl('label', { cls: 'fm-trash-select-all' });
      const selectAll = selectLabel.createEl('input', { attr: { type: 'checkbox', 'aria-label': this.t('remoteTrashSelectAll') } });
      selectAll.checked = items.length > 0 && count === items.length;
      selectAll.indeterminate = count > 0 && count < items.length;
      selectAll.disabled = this.busy;
      selectLabel.createSpan({ text: this.t('remoteTrashSelectAll') });
      selectAll.onchange = () => {
        if (selectAll.checked) {
          for (const item of items) this.selected.add(item.id);
        } else {
          this.selected.clear();
        }
        this.lastIndex = null;
        syncAll();
      };

      toolbar.createSpan({
        cls: 'fm-trash-summary',
        text: count > 0
          ? this.t('remoteTrashSelectedSummary', { count, size: formatBytes(pickedBytes) })
          : this.t('remoteTrashSummary', { count: items.length, size: formatBytes(totalBytes) })
      });

      const actions = toolbar.createDiv({ cls: 'fm-trash-toolbar-actions' });
      if (count > 0) {
        const clearBtn = actions.createEl('button', { text: this.t('remoteTrashClearSelection'), attr: { type: 'button' } });
        clearBtn.disabled = this.busy;
        clearBtn.onclick = () => {
          this.selected.clear();
          this.lastIndex = null;
          syncAll();
        };

        const restoreBtn = actions.createEl('button', {
          text: `${this.t('remoteTrashBatchRestore')} (${count})`,
          cls: 'mod-cta',
          attr: { type: 'button' }
        });
        restoreBtn.disabled = this.busy;
        restoreBtn.onclick = async () => {
          if (this.busy || this.closed || !picked.length) return;
          this.busy = true;
          syncAll();
          try {
            const res = await this.plugin.restoreRemoteTrashBatch(picked.map((item) => item.id));
            const okCount = res.restored?.length || 0;
            const failCount = res.failed?.length || 0;
            if (okCount) galleryStore(this.plugin).load(true);
            if (!this.closed) {
              new Notice(failCount
                ? this.t('remoteTrashBatchPartial', { ok: okCount, failed: failCount })
                : this.t('remoteTrashBatchRestored', { count: okCount }));
              await this.load();
            }
          } catch (error) {
            if (!this.closed) {
              new Notice(error.message || this.t('remoteTrashFailed'));
              this.busy = false;
              syncAll();
            }
          }
        };

        const deleteBtn = actions.createEl('button', {
          text: `${this.t('remoteTrashBatchDelete')} (${count})`,
          cls: 'mod-warning',
          attr: { type: 'button' }
        });
        deleteBtn.disabled = this.busy;
        deleteBtn.onclick = () => {
          if (this.busy || this.closed || !picked.length) return;
          this.busy = true;
          syncAll();
          const confirm = new ConfirmActionModal(
            this.app,
            this.t('remoteTrashBatchDelete'),
            this.t('remoteTrashBatchDeleteConfirm', { count: picked.length, size: formatBytes(pickedBytes) }),
            this.t('remoteTrashBatchDelete'),
            async (confirmed) => {
              if (!confirmed || this.closed) { this.busy = false; syncAll(); return; }
              try {
                const res = await this.plugin.deleteRemoteTrashBatch(picked.map((item) => item.id));
                const okCount = res.deleted?.length || 0;
                const failCount = res.failed?.length || 0;
                if (!this.closed) {
                  new Notice(failCount
                    ? this.t('remoteTrashBatchPartial', { ok: okCount, failed: failCount })
                    : this.t('remoteTrashBatchDeleted', { count: okCount }));
                  await this.load();
                }
              } catch (error) {
                if (!this.closed) {
                  new Notice(error.message || this.t('remoteTrashFailed'));
                  this.busy = false;
                  syncAll();
                }
              }
            }
          );
          confirm.open();
        };
      } else {
        const emptyBtn = actions.createEl('button', {
          text: this.t('remoteTrashEmptyAction'),
          cls: 'fm-btn-danger-outline',
          attr: { type: 'button' }
        });
        emptyBtn.disabled = this.busy;
        emptyBtn.onclick = () => {
          if (this.busy || this.closed || !items.length) return;
          this.busy = true;
          syncAll();
          const confirm = new ConfirmActionModal(
            this.app,
            this.t('remoteTrashEmptyAction'),
            this.t('remoteTrashEmptyConfirm', { count: items.length, size: formatBytes(totalBytes) }),
            this.t('remoteTrashEmptyAction'),
            async (confirmed) => {
              if (!confirmed || this.closed) { this.busy = false; syncAll(); return; }
              try {
                const res = await this.plugin.emptyRemoteTrash(items.map((item) => item.id));
                const okCount = res.deleted?.length || 0;
                const failCount = res.failed?.length || 0;
                if (!this.closed) {
                  new Notice(failCount
                    ? this.t('remoteTrashBatchPartial', { ok: okCount, failed: failCount })
                    : this.t('remoteTrashBatchDeleted', { count: okCount }));
                  await this.load();
                }
              } catch (error) {
                if (!this.closed) {
                  new Notice(error.message || this.t('remoteTrashFailed'));
                  this.busy = false;
                  syncAll();
                }
              }
            }
          );
          confirm.open();
        };
      }
    };

    const syncAll = () => {
      for (const ctrl of rowControls) ctrl.sync();
      syncToolbar();
    };

    items.forEach((item, idx) => {
      rowControls.push(this.renderFile(list, item, idx, items, syncAll));
    });
    syncToolbar();
  }
  renderFile(list, item, idx, items, syncAll) {
    const rowItem = {
      id: item.id,
      name: item.filename,
      size: item.size,
      source: 'trash',
      displayPath: item.year && item.month ? `${item.year}/${item.month}/${item.filename}` : item.filename,
      loadThumbUrl: async () => {
        const url = await this.plugin.fetchRemoteTrashPreviewUrl?.(item.id, { thumbnail: true });
        if (url && url.startsWith('blob:')) this.thumbUrls.push(url);
        return url;
      },
      loadPreviewUrl: () => this.plugin.fetchRemoteTrashPreviewUrl?.(item.id, { thumbnail: false }),
    };
    let check;
    const { row, actions } = fileActionRow(list, rowItem, this.plugin, {
      selection: (parent) => {
        check = parent.createEl('input', {
          attr: { type: 'checkbox', 'aria-label': item.filename }
        });
        check.onclick = (event) => {
          const checked = check.checked;
          if (event.shiftKey && this.lastIndex !== null) {
            const start = Math.min(this.lastIndex, idx);
            const end = Math.max(this.lastIndex, idx);
            for (let i = start; i <= end; i++) {
              const target = items[i];
              if (!target) continue;
              if (checked) this.selected.add(target.id);
              else this.selected.delete(target.id);
            }
          } else {
            if (checked) this.selected.add(item.id);
            else this.selected.delete(item.id);
          }
          this.lastIndex = idx;
          syncAll();
        };
      },
      renderName: (nameEl) => {
        const previewTrigger = nameEl.createEl('button', {
          text: item.filename,
          cls: 'fm-file-row-name-text fm-file-preview-trigger',
          attr: { type: 'button', title: item.filename }
        });
        previewTrigger.onclick = () => new ImageLightboxModal(this.app, this.plugin, rowItem).open();
        fileSizeBadge(nameEl, item.size);
      },
      metadata: (metaEl) => {
        fileMetaItem(metaEl, 'trash-2', new Date(item.deletedAt).toLocaleString());
        if (item.year && item.month) {
          fileMetaItem(metaEl, 'folder', `${item.year}/${item.month}`, { cls: 'fm-file-location' });
        }
      }
    });
    const restore = actions.createEl('button', {text:this.t('remoteTrashRestore'), cls:'fm-mini-btn', attr:{type:'button'}});
    const remove = actions.createEl('button', {text:this.t('remoteTrashDelete'), cls:'fm-mini-btn fm-mini-btn-danger', attr:{type:'button'}});
    let rowBusy = false;
    const sync = () => {
      const checked = this.selected.has(item.id);
      check.checked = checked;
      check.disabled = this.busy || rowBusy;
      restore.disabled = this.busy || rowBusy;
      remove.disabled = this.busy || rowBusy;
      row.toggleClass('is-selected', checked);
    };
    const setBusy = value => { rowBusy = value; sync(); };
    const failure = error => {
      if (!this.closed) {
        new Notice(error.message || this.t('remoteTrashFailed'));
        setBusy(false);
      }
    };
    restore.onclick = async () => {
      if (rowBusy || this.busy || this.closed) return;
      setBusy(true);
      try {
        await this.plugin.restoreRemoteTrash(item.id);
        galleryStore(this.plugin).load(true);
        if (!this.closed) { new Notice(this.t('remoteTrashRestored')); await this.load(); }
      } catch (error) { failure(error); }
    };
    remove.onclick = async () => {
      if (rowBusy || this.busy || this.closed) return;
      setBusy(true);
      const confirm = new ConfirmActionModal(
        this.app, this.t('remoteTrashDeleteTitle'),
        this.t('remoteTrashDeleteConfirm', {name:item.filename}),
        this.t('remoteTrashDelete'),
        async confirmed => {
          if (!confirmed || this.closed) { setBusy(false); return; }
          try {
            await this.plugin.permanentlyDeleteRemoteTrash(item.id);
            if (!this.closed) { new Notice(this.t('remoteTrashDeleted')); await this.load(); }
          } catch (error) { failure(error); }
        }, this.plugin
      );
      try { await openModal(confirm); } catch (error) { failure(error); }
    };
    return { sync };
  }
  onClose() {
    this.closed = true;
    this.generation++;
    this.revokeThumbUrls();
    this.contentEl.empty();
  }
}
