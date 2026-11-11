import { Notice, setIcon } from 'obsidian';
import { FileMasterModal as Modal } from '../ui/modal.js';
import { formatBytes } from '../engine.js';
import { galleryStore } from '../ui/gallery-store.js';
import { modalChrome, openModal, moduleHeading } from '../ui/navigation.js';
import { ConfirmActionModal } from './dialogs.js';

/** Restorable server files use the same Hub shell and file-row vocabulary. */
export class RemoteTrashModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.generation = 0;
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
    this.contentEl.empty();
    moduleHeading(this,this.contentEl,{title:'remoteTrashTitle',symbol:'trash-2'});
    this.contentEl.createDiv({text:this.t('remoteTrashLoading'), cls:'fm-browser-status'});
    try {
      const items = await this.plugin.fetchRemoteTrash();
      if (this.closed || generation !== this.generation) return;
      this.contentEl.empty();
      moduleHeading(this,this.contentEl,{title:'remoteTrashTitle',symbol:'trash-2'});
      if (!items.length) {
        this.contentEl.createDiv({text:this.t('remoteTrashEmpty'), cls:'fm-empty-state'});
        return;
      }
      const list = this.contentEl.createDiv({cls:'fm-trash-list'});
      for (const item of items) this.renderFile(list, item);
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
  renderFile(list, item) {
    const row = list.createDiv({cls:'fm-trash-row'});
    setIcon(row.createSpan({cls:'fm-trash-icon'}), 'file');
    const info = row.createDiv({cls:'fm-trash-file'});
    info.createDiv({text:item.filename, cls:'fm-trash-name'});
    info.createDiv({text:`${formatBytes(item.size)} · ${new Date(item.deletedAt).toLocaleString()}`, cls:'fm-gallery-meta'});
    const actions = row.createDiv({cls:'fm-trash-actions'});
    const restore = actions.createEl('button', {text:this.t('remoteTrashRestore'), attr:{type:'button'}});
    const remove = actions.createEl('button', {text:this.t('remoteTrashDelete'), cls:'fm-trash-delete', attr:{type:'button'}});
    let busy = false;
    const setBusy = value => { busy = value; restore.disabled = value; remove.disabled = value; };
    const failure = error => {
      if (!this.closed) {
        new Notice(error.message || this.t('remoteTrashFailed'));
        setBusy(false);
      }
    };
    restore.onclick = async () => {
      if (busy || this.closed) return;
      setBusy(true);
      try {
        await this.plugin.restoreRemoteTrash(item.id);
        galleryStore(this.plugin).load(true);
        if (!this.closed) { new Notice(this.t('remoteTrashRestored')); await this.load(); }
      } catch (error) { failure(error); }
    };
    remove.onclick = async () => {
      if (busy || this.closed) return;
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
  }
  onClose() {
    this.closed = true;
    this.generation++;
    this.contentEl.empty();
  }
}
