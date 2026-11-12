import { Notice, setIcon } from 'obsidian';
import { FileMasterModal } from '../ui/modal.js';
import { moduleHeading } from '../ui/navigation.js';
import { returnToHub } from './common.js';
import { fileActionRow, fileReferenceButton, fileSizeBadge } from '../ui/file-action-list.js';
import { documentRow } from '../ui/document-list.js';
import { getEffectiveLanguage } from '../plugin/logging.js';
import { requestRemoteRename, scanRenameReferences, indexRenameReferences, remoteFileKey, executeRemoteRename, loadPendingRename } from '../plugin/remote-rename.js';

/** Edit in the file list, validate on Next, then review before committing. */
export class RemoteRenameModal extends FileMasterModal {
  constructor(app, plugin) {
    super(app);
    this.plugin=plugin; this.revision=0; this.page=0; this.query=''; this.drafts=new Map();
  }
  t(key, params) { return this.plugin.t(key, params); }
  async onOpen() {
    this.closed=false;
    this.modalEl.addClass('fm-ui','fm-rename-dialog');
    this.contentEl.addClass('fm-wizard-modal','fm-rename');
    this.shell();
    this.body.createDiv({text:this.t('renameLoading'),cls:'fm-browser-status'});
    try {
      this.pending=await loadPendingRename(this.plugin);
      if (this.closed) return;
      if (this.pending) return this.recovery();
      this.items=await this.plugin.fetchRemoteFileList();
      if (this.closed) return;
      this.search();
      try { this.referenceDocuments=await indexRenameReferences(this.plugin,this.items); }
      catch { this.referenceCountError=true; }
      if (!this.closed) this.updateCounts();
    } catch (error) { if (!this.closed) this.loadError(error); }
  }
  shell(step,back=null) {
    this.contentEl.empty();
    moduleHeading(this,this.contentEl,{title:'remoteRenameTitle',symbol:'file-pen-line',step,total:2});
    this.body=this.contentEl.createDiv({cls:'fm-rename-body'});
    this.footer=this.contentEl.createDiv({cls:'fm-btn-row'});
    this.cancel=this.button(this.footer,back?'btnBack':'btnCancel',back || (()=>returnToHub(this)));
  }
  button(parent,key,handler,primary=false) {
    const button=parent.createEl('button',{text:this.t(key),cls:primary?'mod-cta':'',attr:{type:'button'}});
    button.onclick=handler;
    return button;
  }
  loadError(error) {
    this.shell();
    this.body.createEl('p',{text:error.message,cls:'fm-rename-error'});
    this.button(this.footer,'previewRetry',()=>this.onOpen());
  }
  splitName(item) {
    const position=item.filename.lastIndexOf('.');
    const base=position>0?item.filename.slice(0,position):item.filename;
    const extension=position>0?item.filename.slice(position):'';
    const duplicate=extension && new RegExp(extension.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?=(_[a-f0-9]{8,64})?$)','i');
    let suggestion=base;
    if(duplicate)while(duplicate.test(suggestion))suggestion=suggestion.replace(duplicate,'');
    return {base,extension,suggestion:suggestion||base};
  }
  visualItem(item) {
    return {name:item.filename,source:'remote',rawObj:item,size:item.size};
  }
  renderEditableFile(parent,item) {
    const {base,suggestion,extension}=this.splitName(item), key=remoteFileKey(item);
    let input,radio,error;
    const select=()=>{
      this.selected=item;
      if(suggestion!==base&&!this.drafts.has(key))this.drafts.set(key,suggestion);
      this.updateSelection();
    };
    const slots=fileActionRow(parent,this.visualItem(item),this.plugin,{
      selection:parent=>{
        radio=parent.createEl('input',{type:'radio',attr:{name:'fm-rename-file','aria-label':this.t('renameChooseFile',{name:item.filename})}});
        radio.onchange=select;
      },
      renderName:parent=>{
        parent.addClass('fm-rename-editor');
        input=parent.createEl('input',{type:'text',value:suggestion,cls:'fm-rename-name-input',attr:{'aria-label':this.t('renameFilenameLabel',{name:item.filename}),spellcheck:'false'}});
        const details=parent.createSpan({cls:'fm-rename-file-details'});
        details.createSpan({text:extension.toLowerCase(),cls:'fm-file-extension'});
        fileSizeBadge(details,item.size);
      }
    });
    error=slots.content.createDiv({cls:'fm-rename-error',attr:{role:'alert'}});
    this.rowControls.set(key,{row:slots.row,input,radio,error,item});
    input.onfocus=select;
    input.oninput=()=>{
      this.drafts.set(key,input.value);this.selected=item;this.preview=null;
      this.validation.empty();input.setAttribute('aria-invalid','false');error.empty();this.updateSelection();
    };
    input.onkeydown=event=>{if (event.key==='Enter'&&!this.next.disabled) {event.preventDefault();this.precheck();}};
    this.countElements.set(key,fileReferenceButton(slots.actions,this.visualItem(item),this.plugin,null,()=>this.close()));
  }
  nameChange(parent,item,newFilename,oldFilename=item.filename) {
    const box=parent.createDiv({cls:'fm-section-box fm-rename-preview'});
    fileActionRow(box,this.visualItem(item),this.plugin,{
      renderName:parent=>{
        const details=parent.createEl('dl',{cls:'fm-rename-names'});
        for (const [key,name] of [['renameBefore',oldFilename],['renameAfter',newFilename]]) {
          details.createEl('dt',{text:this.t(key)});
          details.createEl('dd',{text:name,cls:key==='renameAfter'?'fm-rename-new-name':''});
        }
      }
    });
  }
  search() {
    this.revision++; this.inReview=false;
    this.shell(this.items.length?1:null);
    this.body.createEl('p',{text:this.t('renameStep1Desc'),cls:'fm-module-summary'});
    const toolbar=this.body.createDiv({cls:'fm-toolbar-row'});
    this.searchInput=toolbar.createEl('input',{type:'search',value:this.query,cls:'fm-gallery-search',attr:{placeholder:this.t('renameSearch'),'aria-label':this.t('renameSearch')}});
    this.matchCount=toolbar.createSpan({cls:'fm-file-row-meta'});
    this.list=this.body.createDiv({cls:'fm-scroll-list fm-file-action-list'});
    this.pagination=this.body.createDiv({cls:'fm-gallery-pagination'});
    this.validation=this.body.createDiv({cls:'fm-rename-validation',attr:{'aria-live':'polite'}});
    this.next=this.button(this.footer,'renameNextPreview',()=>this.precheck(),true);
    this.next.hidden=!this.items.length;
    this.searchInput.oninput=()=>{this.query=this.searchInput.value;this.page=0;this.renderList();};
    this.renderList();
  }
  renderList() {
    this.list.empty(); this.pagination.empty();
    this.rowControls=new Map(); this.countElements=new Map();
    const items=this.items.filter(item=>item.filename.toLocaleLowerCase().includes(this.query.trim().toLocaleLowerCase()));
    this.matchCount.setText(this.t('renameFileCount',{count:items.length}));
    const pages=Math.max(1,Math.ceil(items.length/20));
    this.page=Math.min(this.page,pages-1);
    if (!items.length) this.list.createDiv({text:this.t('renameNoFiles'),cls:'fm-empty-state'});
    for (const item of items.slice(this.page*20,this.page*20+20)) this.renderEditableFile(this.list,item);
    if (pages>1) {
      this.button(this.pagination,'pagePrevious',()=>{if (!this.checking) {this.page--;this.renderList();}}).disabled=this.page===0;
      this.pagination.createSpan({text:this.t('pageCount',{current:this.page+1,total:pages})});
      this.button(this.pagination,'pageNext',()=>{if (!this.checking) {this.page++;this.renderList();}}).disabled=this.page===pages-1;
    }
    this.updateSelection(); this.updateCounts();
  }
  updateCounts() {
    for (const [key,control] of this.countElements || []) {
      control.update(this.referenceDocuments ? this.referenceDocuments.get(key) || [] : null,this.referenceCountError);
    }
  }
  updateSelection() {
    const selectedKey=this.selected && remoteFileKey(this.selected);
    for (const [key,{row,input,radio,item}] of this.rowControls) {
      const active=key===selectedKey;
      row.toggleClass('is-selected',active);radio.checked=active;input.readOnly=!active;
      const value=active?(this.drafts.get(key) ?? this.splitName(item).suggestion):this.splitName(item).suggestion;
      if (input.value!==value) input.value=value;
    }
    const draft=selectedKey && this.drafts.get(selectedKey)?.trim().normalize('NFC');
    this.next.disabled=this.checking || !this.rowControls.has(selectedKey) || !draft || draft===this.splitName(this.selected).base;
  }
  async precheck() {
    if (this.next.disabled || this.checking) return;
    this.checking=true;
    const revision=++this.revision, selected=this.selected, key=remoteFileKey(selected);
    const {extension}=this.splitName(selected);
    const request={year:selected.year,month:selected.month,filename:selected.filename,newFilename:`${this.drafts.get(key).trim().normalize('NFC')}${extension}`,expectedSha256:selected.sha256};
    this.validation.empty();
    const status=this.validation.createDiv({text:this.t('renameChecking'),cls:'fm-rename-hint'});
    this.updateSelection();
    // Freeze editing while validating exactly the name that will enter the preview.
    for (const {input} of this.rowControls.values()) input.disabled=true;
    this.searchInput.disabled=true;
    try {
      const preview=await requestRemoteRename(this.plugin,request,true);
      if (this.closed || revision!==this.revision) return;
      const references=await scanRenameReferences(this.plugin,preview.linkMappings);
      if (this.closed || revision!==this.revision) return;
      this.preview={request,preview,references};
      this.review();
    } catch (error) {
      if (!this.closed && revision===this.revision) {
        status.setText('');
        this.rowControls.get(key)?.error.setText(['NAME_CONFLICT','NAME_RESERVED'].includes(error.code)?this.t('renameNameTaken'):error.message);
        const input=this.rowControls.get(key)?.input;
        input?.setAttribute('aria-invalid','true');
      }
    } finally {
      this.checking=false;
      if (!this.closed && revision===this.revision && !this.inReview) {
        for (const {input} of this.rowControls.values()) input.disabled=false;
        this.searchInput.disabled=false;
        this.updateSelection();
      }
    }
  }
  review() {
    this.inReview=true;
    this.shell(2,()=>this.search());
    const {request,preview,references}=this.preview;
    this.nameChange(this.body,preview.oldItem || this.selected,request.newFilename);
    if (!references.documents.length) this.body.createDiv({text:this.t('renameNoReferences'),cls:'fm-rename-hint'});
    this.documentList(this.body,references.documents,{title:'renameAffected',state:'renameReferencesPlanned'});
    this.aliasNotice(preview);
    this.submit=this.button(this.footer,'renameApply',()=>this.execute(),true);
  }
  documentList(parent,documents,{title=null,state='referenceCount'}={}) {
    if (!documents.length) return;
    if (title) parent.createDiv({text:this.t(title,{documents:documents.length}),cls:'fm-section-title'});
    const list=parent.createDiv({cls:'fm-scroll-list fm-document-list'});
    for (const doc of documents) {
      documentRow(list,this.plugin,doc,{hoverParent:this,referenceState:state,onOpened:()=>this.close()});
    }
  }
  aliasNotice(data) {
    const notice=this.body.createDiv({cls:'fm-rename-expiry'});
    setIcon(notice.createSpan({cls:'fm-indicator-icon',attr:{'aria-hidden':'true'}}),'info');
    const expiresAt=Number(data?.aliasExpiresAt);
    const days=Math.max(0,Math.ceil((expiresAt-Date.now())/86400000));
    notice.createSpan({text:this.t(!expiresAt?'renameAliasFallback':days?'renameAliasExpiry':'renameAliasExpired',{
      days,date:expiresAt?new Date(expiresAt).toLocaleDateString(getEffectiveLanguage(this.plugin.settings)==='zh'?'zh-CN':'en-US'):''
    })});
  }
  recovery(error) {
    this.shell();
    this.body.createEl('p',{text:this.t('renamePending')});
    this.body.createDiv({text:`${this.pending.request.filename} → ${this.pending.result?.item?.filename || this.pending.request.newFilename}`,cls:'fm-rename-count'});
    if (this.pending.result) this.aliasNotice(this.pending.result);
    if (error) this.body.createDiv({text:error.message,cls:'fm-rename-error'});
    const same=this.pending.serverUrl===this.plugin.getCleanServerUrl();
    if (!same) this.body.createEl('p',{text:this.t('renameServerMismatch'),cls:'fm-rename-error'});
    this.button(this.footer,'renameContinue',()=>this.execute(this.pending),true).disabled=!same;
  }
  async execute(pending=null) {
    if (this.busy || (!pending&&!this.preview)) return;
    this.busy=true; this.revision++;
    const request=pending?.request || this.preview.request;
    this.shell(); this.cancel.disabled=true;
    const status=this.body.createDiv({text:this.t('renameWorking'),cls:'fm-rename-count',attr:{'aria-live':'polite'}});
    try {
      const report=await executeRemoteRename(this.plugin,request,progress=>{
        if (!this.closed) status.setText(this.t('renameProgress',{current:progress.completed,total:progress.total}));
      },pending);
      if (this.closed) { new Notice(this.t(report.complete?'renameComplete':'renameIncomplete')); return; }
      this.result(report);
    } catch (error) {
      this.pending=await loadPendingRename(this.plugin).catch(()=>pending);
      if (this.closed) { new Notice(error.message); return; }
      if (this.pending) this.recovery(error); else this.loadError(error);
    } finally { this.busy=false; }
  }
  result(report) {
    this.pending=report.complete?null:report.job;
    this.shell();this.cancel.setText(this.t('destBtnDone'));this.cancel.addClass('mod-cta');
    const status=this.body.createDiv({cls:`fm-rename-status${report.complete?'':' is-incomplete'}`,attr:{role:'status'}});
    setIcon(status.createSpan({cls:'fm-rename-status-icon',attr:{'aria-hidden':'true'}}),report.complete?'check':'circle-alert');
    const summary=status.createDiv();
    summary.createDiv({text:this.t(report.complete?'renameComplete':'renameIncomplete'),cls:'fm-rename-status-title'});
    summary.createDiv({text:report.updatedDocuments?this.t('renameUpdated',{documents:report.updatedDocuments,references:report.updatedReferences}):this.t(report.complete?'renameNoReferences':'renameNotesPending'),cls:'fm-rename-status-desc'});
    const file=this.body.createDiv({cls:'fm-section-box fm-rename-preview fm-rename-result-file'});
    fileActionRow(file,this.visualItem(report.item),this.plugin,{
      metadata:parent=>parent.createSpan({text:this.t('renamePreviousName',{name:report.oldFilename})})
    });
    if (report.countsUncertain) this.body.createDiv({text:this.t('renameCountsUncertain'),cls:'fm-rename-hint'});
    this.documentList(this.body,report.documents,{title:'renameDocumentsUpdated',state:'renameReferencesUpdated'});
    for (const failure of report.failures) this.body.createDiv({text:`${failure.path}: ${failure.error}`,cls:'fm-rename-error'});
    this.documentList(this.body,report.remaining,{title:'renameDocumentsRemaining',state:'renameReferencesPlanned'});
    this.aliasNotice(report.job?.result);
    if (!report.complete) {this.cancel.removeClass('mod-cta');this.button(this.footer,'renameContinue',()=>this.execute(report.job),true);}
  }
  onClose() { this.closed=true; this.revision++; this.contentEl.empty(); }
}
