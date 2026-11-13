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
import { documentRow } from '../ui/document-list.js';
import { RemoteRenameModal } from './remote-rename.js';
let imageCanvasSequence = 0;

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
    modalTitle(this,this.item.name);
    if(remote) {
      const titleBar=modalChrome(this).title;
      titleBar.addClass('fm-asset-title-row');
      const renameBtn=titleBar.createEl('button',{cls:'fm-asset-rename-trigger',attr:{type:'button','aria-label':t('previewRename')}});
      const renameIconWrap=renameBtn.createSpan({cls:'fm-copy-icon'});
      setIcon(renameIconWrap,'pencil');
      const renameSvg=renameIconWrap.querySelector?.('svg');
      if(renameSvg){renameSvg.classList?.remove('svg-icon');renameSvg.style.width='13px';renameSvg.style.height='13px';renameSvg.style.strokeWidth='1.5px';}
      renameBtn.onclick=()=>{
        const currentItem=remote;
        this.close();
        openModal(new RemoteRenameModal(this.app,this.plugin,{
          initialItem:currentItem,
          onReturn:finalItem=>{
            const target=finalItem || currentItem;
            if(finalItem && finalItem.filename!==currentItem.filename) {
              this.onActionChanged?.('renamed',{oldItem:currentItem,item:finalItem});
            }
            openModal(new ImageLightboxModal(this.app,this.plugin,{
              source:'remote',
              name:target.name || target.filename,
              displayPath:`${target.year}/${target.month}/${target.filename}`,
              size:target.size,
              rawObj:target
            },this.onActionChanged,{insertMode:this.insertMode,insertionTarget:this.insertionTarget}))
              .catch(error=>new Notice(error.message));
          }
        })).catch(error=>new Notice(error.message));
      };
    }
    const location=this.item.displayPath?.split('/').slice(0,-1).join(' / ');
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
    const canvasLabel=`fm-image-canvas-${++imageCanvasSequence}`;
    canvas.createSpan({text:t('previewGestures'),attr:{id:canvasLabel,hidden:''}});
    this.stage=canvas.createDiv({cls:'fm-image-stage',attr:{tabindex:'0',role:'region','aria-labelledby':canvasLabel}});
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
      const links=inspector.createDiv({cls:'fm-asset-section fm-asset-panel fm-asset-links'});links.createEl('h4',{text:t('previewLinksTitle')});
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
    const properties=inspector.createDiv({cls:'fm-asset-section fm-asset-panel'});properties.createEl('h4',{text:t('previewProperties')});
    const list=properties.createEl('dl',{cls:'fm-asset-properties'});
    const property=(key,value)=>{list.createEl('dt',{text:t(key)});return list.createEl('dd',{text:String(value)});};
    property(remote?'previewOriginalSize':'previewSizeLabel',formatBytes(this.item.size));
    if(image)this.dimensions=property('previewDimensions','—');
    if(remote?.createdAt) {
      const created=new Date(remote.createdAt);
      if(Number.isFinite(created.getTime())) {
        const locale=this.plugin.settings.language==='zh'?'zh-CN':this.plugin.settings.language==='en'?'en-GB':undefined;
        const value=property('previewCreated','');
        const timestamp=value.createEl('time',{cls:'fm-asset-timestamp',attr:{datetime:created.toISOString()}});
        timestamp.createSpan({text:created.toLocaleDateString(locale,{year:'numeric',month:'2-digit',day:'2-digit'})});
        timestamp.createSpan({text:created.toLocaleTimeString(locale,{hour:'2-digit',minute:'2-digit'}),cls:'fm-asset-time'});
      }
    }
    if(location)property('previewPathLabel',location);
    if(!remote)property('previewSource',t('previewSourceLocal'));
    if(remote) {
      const management=inspector.createDiv({cls:'fm-asset-panel fm-asset-management'});
      const protection=management.createDiv({cls:'fm-asset-section fm-asset-protection'});
      const protectionRow=protection.createDiv({cls:'fm-asset-section-heading'});
      protectionRow.createEl('h4',{text:t('previewProtection')});
      const lock=protectionRow.createEl('button',{cls:'fm-asset-lock-switch',attr:{type:'button',role:'switch'}});
      const protectionHelp=protection.createDiv({cls:'fm-asset-hint'});
      const danger=management.createDiv({cls:'fm-asset-section fm-asset-danger'});
      const dangerRow=danger.createDiv({cls:'fm-asset-section-heading'});
      dangerRow.createEl('h4',{text:t('previewDanger')});
      const del=dangerRow.createEl('button',{cls:'fm-asset-trash-action',text:t('galleryBtnDelete'),attr:{type:'button'}});
      danger.createDiv({text:t('previewTrashHelp'),cls:'fm-asset-hint'});
      const update=()=>{
        lock.setAttribute('aria-label',t(remote.locked?'galleryBtnUnlock':'galleryBtnLock'));
        lock.setAttribute('aria-checked',String(Boolean(remote.locked)));
        protectionHelp.setText(t(remote.locked?'previewProtectionLocked':'previewProtectionHelp'));
        del.disabled=Boolean(remote.locked || this.deleting);
      };update();
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
    this.modalEl.addClass('fm-reference-dialog');
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
      contentEl.createEl('p',{text:t('notePreviewHint'),cls:'fm-inline-hint'});
      const listEl = contentEl.createDiv({ cls: 'fm-scroll-list fm-document-list' });
      for (const notePath of this.refNotePaths) {
        documentRow(listEl,this.plugin || {app:this.app,t},typeof notePath==='string'?{path:notePath}:notePath,{hoverParent:this});
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
