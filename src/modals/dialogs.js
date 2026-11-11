import { captureInsertionTarget, isInsertionTargetValid } from '../plugin/editor-target.js';
import { assetUrl, assetMarkdown, hasOptimizedVariant, copyText } from '../ui/links.js';
import { iconButton } from '../ui/gallery-toolbar.js';
import { mountImageViewport } from '../ui/image-viewport.js';
import { openModal, modalChrome, modalTitle } from '../ui/navigation.js';
import { getItemPreviewUrl } from '../plugin/vault-utils.js';
import { insertMarkdownToActiveEditor } from '../plugin/lifecycle.js';
import { IMAGE_EXTS } from '../constants.js';
import { formatBytes, getExt } from '../engine.js';
import { translateUi } from '../i18n.js';
import { Notice, setIcon } from 'obsidian';
import { FileMasterModal as Modal } from '../ui/modal.js';

/**
 * Confirmation modal for critical actions like remote file deletion
 */
export class ConfirmActionModal extends Modal {
  constructor(app, title, message, confirmText = 'Confirm', onConfirm, plugin = null) {
    super(app);
    this.title = title;
    this.message = message;
    this.confirmText = confirmText;
    this.onConfirm = onConfirm;
    this.plugin = plugin;
    this.resolved = false;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.addClass('fm-ui','fm-confirm-dialog');
    modalChrome(this);
    contentEl.addClass('fm-confirm-content');
    modalTitle(this, this.title);
    const p = contentEl.createEl('p', { text: this.message });
    p.style.lineHeight = '1.6';
    p.style.margin = '12px 0 18px';

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const cancelLabel = this.plugin ? this.plugin.t('btnCancel') : translateUi('auto', 'btnCancel');
    const cancelBtn = btnRow.createEl('button', { text: cancelLabel });
    cancelBtn.onclick = () => {
      if (this.resolved) return;
      this.resolved = true;
      this.close();
      return this.onConfirm(false);
    };

    const okBtn = btnRow.createEl('button', { text: this.confirmText, cls: 'mod-warning' });
    okBtn.onclick = () => {
      if (this.resolved) return;
      this.resolved = true;
      this.close();
      return this.onConfirm(true);
    };
  }

  onClose() {
    if (!this.resolved && this.onConfirm) {
      this.resolved = true;
      this.onConfirm(false);
    }
    this.contentEl.empty();
  }
}

/**
 * High-res lightbox modal for asset inspection
 */
export class ImageLightboxModal extends Modal {
  constructor(app, plugin, item, onActionChanged = null, options = {}) {
    super(app);
    Object.assign(this, {plugin,item,onActionChanged});
    this.insertionTarget=options.insertionTarget ?? captureInsertionTarget(plugin);
    this.insertMode=options.insertMode || plugin.settings.galleryInsertFormat || 'raw';
    this.generation=0;
  }
  onOpen() {
    this.closed=false;
    this.contentEl.empty();
    this.contentEl.addClass('fm-asset-viewer');
    this.modalEl.addClass('fm-ui','fm-lightbox-dialog');
    modalChrome(this);
    const t=(key,params)=>this.plugin.t(key,params),remote=this.item.source==='remote'?this.item.rawObj:null;
    const image=IMAGE_EXTS.has(getExt(this.item.name));
    const header=this.contentEl.createDiv({cls:'fm-asset-header'});
    modalTitle(this,this.item.name);
    const location=this.item.displayPath?.split('/').slice(0,-1).join(' / ');
    if(location){setIcon(header.createSpan({cls:'fm-asset-path-icon'}),'folder');header.createSpan({text:location,cls:'fm-asset-location'});}
    const layout=this.contentEl.createDiv({cls:'fm-asset-layout'});
    const canvas=layout.createDiv({cls:'fm-asset-canvas'});
    const tools=canvas.createDiv({cls:'fm-asset-tools'});
    this.variant='raw';
    const variants=tools.createDiv({cls:'fm-gallery-mode-group',attr:{role:'group','aria-label':t('previewVariant')}});
    const variantButtons=[];
    if(image) for(const mode of remote&&hasOptimizedVariant(remote)?['raw','webp']:['raw']) {
      const button=variants.createEl('button',{text:t(mode==='raw'?'galleryModeRaw':'galleryModeWebp'),attr:{type:'button','aria-pressed':String(mode==='raw')}});
      button.onclick=()=>{this.variant=mode;variantButtons.forEach(([b,m])=>b.setAttribute('aria-pressed',String(m===mode)));this.loadPreview();};
      variantButtons.push([button,mode]);
    }
    const zoom=tools.createDiv({cls:'fm-asset-zoom',attr:{role:'group','aria-label':t('previewZoomLabel')}});
    const zoomButtons=[];
    if(image) {
      zoomButtons.push(iconButton(zoom,this.plugin,'previewZoomOut','minus',()=>this.viewport?.zoomOut()));
      this.percentage=zoom.createEl('button',{text:'—',attr:{type:'button','aria-label':t('previewActualSize')}});
      this.percentage.onclick=()=>this.viewport?.actual();zoomButtons.push(this.percentage);
      zoomButtons.push(iconButton(zoom,this.plugin,'previewZoomIn','plus',()=>this.viewport?.zoomIn()));
      zoomButtons.push(iconButton(zoom,this.plugin,'previewFit','maximize',()=>this.viewport?.fit()));
    }
    this.zoomButtons=zoomButtons;
    this.stage=canvas.createDiv({cls:'fm-image-stage',attr:{tabindex:'0',role:'region','aria-label':t('previewGestures')}});
    this.status=canvas.createDiv({cls:'fm-preview-status',attr:{'aria-live':'polite'}});
    const inspector=layout.createDiv({cls:'fm-asset-inspector'});
    const actions=inspector.createDiv({cls:'fm-asset-primary'});
    if(remote) {
      const mode=this.insertMode==='webp'&&hasOptimizedVariant(remote)?'webp':'raw';
      const insert=actions.createEl('button',{text:t(mode==='webp'?'galleryInsertWebp':'galleryInsertRaw'),cls:'mod-cta',attr:{type:'button'}});
      insert.disabled=!isInsertionTargetValid(this.plugin,this.insertionTarget);
      insert.hidden=insert.disabled;
      if(insert.disabled)actions.createDiv({text:t('galleryOpenNoteFirst'),cls:'fm-asset-hint'});
      insert.onclick=()=>{if(insertMarkdownToActiveEditor(this.plugin,assetMarkdown(this.item.name,assetUrl(remote,mode))+'\n',t('galleryInserted'),this.insertionTarget))this.close();};
      const links=inspector.createDiv({cls:'fm-asset-section fm-asset-links'});links.createEl('h4',{text:t('previewLinksTitle')});
      for(const variant of hasOptimizedVariant(remote)?['raw','webp']:['raw']) {
        const url=assetUrl(remote,variant);
        if(!url)continue;
        const group=links.createDiv({cls:'fm-asset-link-variant'});
        group.createSpan({text:t(variant==='raw'?'galleryTrackRaw':'galleryTrackWebp'),cls:'fm-asset-link-label'});
        const copyActions=group.createDiv({cls:'fm-asset-copy-pair'});
        for(const markdown of [false,true]) {
          const label=t(variant==='raw'?'galleryTrackRaw':'galleryTrackWebp')+(markdown?' · Markdown':' · URL');
          const value=markdown?assetMarkdown(this.item.name,url):url;
          const copy=copyActions.createEl('button',{cls:'fm-asset-copy-action',attr:{type:'button','aria-label':label}});
          setIcon(copy.createSpan({cls:'fm-copy-icon'}),'copy');copy.createSpan({text:markdown?'Markdown':'URL'});
          copy.onclick=()=>copyText(this.plugin,value);

        }
      }
    } else if(this.item.rawObj) {
      const open=actions.createEl('button',{text:t('btnOpenInObsidian'),cls:'mod-cta'});
      open.onclick=async()=>{if(open.disabled)return;open.disabled=true;try{const leaf=this.app.workspace.getLeaf(false);if(leaf){await leaf.openFile(this.item.rawObj);this.close();}}catch(error){new Notice(error.message);}finally{open.disabled=false;}};
    }
    const properties=inspector.createDiv({cls:'fm-asset-section'});properties.createEl('h4',{text:t('previewProperties')});
    const list=properties.createEl('dl',{cls:'fm-asset-properties'});
    const property=(key,value)=>{list.createEl('dt',{text:t(key)});return list.createEl('dd',{text:String(value)});};
    property('previewSizeLabel',formatBytes(this.item.size));
    if(image)this.dimensions=property('previewDimensions','—');
    if(remote?.createdAt)property('previewCreated',new Date(remote.createdAt).toLocaleString());
    property('previewSource',t(remote?'previewSourceRemote':'previewSourceLocal'));
    if(remote) {
      const management=inspector.createDiv({cls:'fm-asset-section'});management.createEl('h4',{text:t('previewProtection')});
      const lock=management.createEl('button',{attr:{type:'button'}});
      const danger=inspector.createDiv({cls:'fm-asset-section fm-asset-danger'});danger.createEl('h4',{text:t('previewDanger')});
      const del=danger.createEl('button',{text:t('galleryBtnDelete'),attr:{type:'button'}});
      danger.createDiv({text:t('previewTrashHelp'),cls:'fm-asset-hint'});
      const update=()=>{lock.setText(t(remote.locked?'galleryBtnUnlock':'galleryBtnLock'));del.disabled=Boolean(remote.locked)||this.deleting;};update();
      lock.onclick=async()=>{
        if(lock.disabled)return;lock.disabled=true;del.disabled=true;
        try{const locked=!remote.locked;await this.plugin.toggleRemoteFileLock(remote.year,remote.month,remote.filename,locked);remote.locked=locked;if(!this.closed){update();new Notice(t(locked?'previewProtected':'previewUnprotected'));}this.onActionChanged?.('lock',remote);}
        catch(error){new Notice(t('previewLockFailed',{err:error.message}));}
        finally{lock.disabled=false;if(!this.closed)update();}
      };
      del.onclick=async()=>{
        if(del.disabled||this.deleting||remote.locked)return;del.disabled=true;
        const confirm=new ConfirmActionModal(this.app,t('previewTrashConfirmTitle'),t('galleryDeleteConfirm',{name:this.item.name}),t('galleryBtnDelete'),async confirmed=>{
          if(!confirmed||this.closed){if(!this.closed)update();return;}
          if(remote.locked||this.deleting){update();return;}
          this.deleting=true;lock.disabled=true;
          try{await this.plugin.deleteRemoteFile(remote.year,remote.month,remote.filename);this.onActionChanged?.('deleted',remote);new Notice(t('galleryDeleteSuccess',{name:this.item.name}));this.close();}
          catch(error){new Notice(t('previewDeleteFailed',{err:error.message}));}
          finally{this.deleting=false;lock.disabled=false;if(!this.closed)update();}
        },this.plugin);
        try{await openModal(confirm);}catch(error){update();new Notice(error.message);}
      };
    }
    if(image)this.loadPreview();
    else {this.stage.createDiv({text:t('previewNonImageTip',{ext:getExt(this.item.name).toUpperCase()})});this.status.hidden=true;}
  }
  async loadPreview() {
    const generation=++this.generation,t=(key)=>this.plugin.t(key);
    this.viewport?.dispose();this.viewport=null;
    this.imageEvents?.abort();this.imageEvents=new AbortController();
    this.stage.empty();this.status.empty();this.status.createSpan({text:t('previewLoading')});
    this.zoomButtons.forEach(button=>button.disabled=true);this.percentage?.setText('—');
    if(this.dimensions)this.dimensions.setText('—');
    const current=()=>!this.closed&&generation===this.generation;
    const failed=()=>{
      if(!current())return;
      this.status.empty();this.status.createSpan({text:t('previewLoadFailed')});
      const retry=this.status.createEl('button',{text:t('previewRetry')});retry.onclick=()=>this.loadPreview();
    };
    try {
      const remote=this.item.source==='remote'?this.item.rawObj:null;
      const url=remote?assetUrl(remote,this.variant):await getItemPreviewUrl(this.plugin,this.item);
      if(!current())return;if(!url){failed();return;}
      const img=this.stage.createEl('img',{cls:'fm-viewport-image',attr:{alt:this.item.name,draggable:'false'}});
      img.addEventListener('load',()=>{
        if(!current())return;
        this.status.empty();this.zoomButtons.forEach(button=>button.disabled=false);
        this.dimensions?.setText(`${img.naturalWidth} × ${img.naturalHeight}`);
        this.viewport=mountImageViewport(this.stage,img,percent=>this.percentage.setText(percent+'%'));
      },{once:true,signal:this.imageEvents.signal});
      img.addEventListener('error',failed,{once:true,signal:this.imageEvents.signal});img.src=url;
    } catch {failed();}
  }
  onClose() {
    this.closed=true;this.generation++;
    this.imageEvents?.abort();this.viewport?.dispose();this.viewport=null;
    this.contentEl.empty();
  }
}

/**
 * Modal listing all notes referencing the selected asset
 */
export class NoteRefsModal extends Modal {
  constructor(app, itemName, refNotePaths, onJump, plugin = null) {
    super(app);
    this.itemName = itemName;
    this.refNotePaths = refNotePaths || [];
    this.onJump = onJump;
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('fm-wizard-modal');
    const t = (k, p) => (this.plugin ? this.plugin.t(k, p) : translateUi('auto', k, p));

    modalTitle(this, t('noteRefsTitle', { name: this.itemName, count: this.refNotePaths.length }));

    if (this.refNotePaths.length === 0) {
      contentEl.createDiv({
        cls: 'fm-section-box',
        text: t('noteRefsNone'),
        attr: { style: 'text-align: center; padding: 24px;' }
      });
    } else {
      const listEl = contentEl.createDiv({ cls: 'fm-scroll-list' });
      for (const notePath of this.refNotePaths) {
        const row = listEl.createDiv({ cls: 'fm-list-item' });
        row.createSpan({ text: `📝 ${notePath}`, attr: { style: 'word-break: break-all; font-weight: 500;' } });
        const jumpBtn = row.createEl('button', {
          text: t('btnOpenNote'),
          cls: 'fm-mini-btn mod-cta'
        });
        jumpBtn.onclick = async () => {
          const tf = this.app.vault.getAbstractFileByPath(notePath);
          if (tf) {
            const leaf = this.app.workspace.getLeaf(false);
            if (leaf) await leaf.openFile(tf);
            this.close();
            if (this.onJump) this.onJump();
          } else {
            new Notice(t('noteRefsNotFound', { path: notePath }));
          }
        };
      }
    }

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const closeBtn = btnRow.createEl('button', { text: t('closeBtn') });
    closeBtn.onclick = () => this.close();
  }

  onClose() {
    this.contentEl.empty();
  }
}
