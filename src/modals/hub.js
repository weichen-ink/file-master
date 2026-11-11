import { initGalleryLeaf } from '../plugin/lifecycle.js';
import { isDocFile } from '../plugin/vault-utils.js';
import { copyActiveNoteForAstro } from '../plugin/attachment-ops.js';
import { BatchMigrateWizardModal } from './batch-migrate-wizard.js';
import { DuplicateWizardModal } from './duplicate-wizard.js';
import { HealthCheckModal } from './health-check.js';
import { OrphanWizardModal } from './orphan-wizard.js';
import { RemoteGalleryModal } from './remote-gallery.js';
import { RemoteTrashModal } from './remote-trash.js';
import { ActiveNoteActionModal } from './active-note.js';
import { VaultAnalyticsModal } from './vault-analytics.js';
import { HubNavigator } from '../ui/navigation.js';
import { setIcon, Platform, Notice } from 'obsidian';
import { FileMasterModal as Modal } from '../ui/modal.js';

export class FileMasterHubModal extends Modal {
  constructor(app, plugin) { super(app); this.plugin = plugin; }
  onOpen() {
    this.contentEl.empty();
    this.modalEl.addClass('fm-ui', 'fm-hub-dialog');
    const home=this.contentEl.createDiv({cls:'fm-hub-content'});
    this.navigator=new HubNavigator(this,home);
    const t=(key,params)=>this.plugin.t(key,params);
    this.navigator.chrome.title.empty();
    const header=this.homeHeading=this.navigator.chrome.title.createDiv({cls:'fm-hub-header'});
    setIcon(header.createSpan({cls:'fm-hub-brand-mark',attr:{'aria-hidden':'true'}}),'zap');
    header.createEl('h2',{text:t('hubTitle')});
    header.createSpan({text:'v'+this.plugin.manifest.version,cls:'fm-hub-version'});
    const remote=Boolean(this.plugin.isRemoteServerReady());
    const file=this.app.workspace.getActiveFile();
    const supported=Boolean(file&&isDocFile(this.app,file));
    const show=modal=>this.navigator.show(modal);
    const settings=()=>this.navigator.leave(async()=>{
      if (!this.app.setting) throw new Error(t('hubSettingsUnavailable'));
      await this.app.setting.open();
      await this.app.setting.openTabById(this.plugin.manifest.id);
    });
    const noteAction=mode=>{
      if (!file || this.app.vault.getAbstractFileByPath(file.path)!==file) throw new Error(t('noticeOpenMdFirst'));
      return show(new ActiveNoteActionModal(this.app,this.plugin,file,mode,{fromHub:true}));
    };
    const sections=[
      {title:'catActiveNote',context:supported?file.name:t('hubOpenNote'),actions:[
        {icon:'upload',title:'actNoteUpTitle',disabled:!remote||!supported,run:()=>noteAction('migrate')},
        {icon:'download',title:'actNoteDownTitle',disabled:!remote||!supported,run:()=>noteAction('download')},
        {icon:'copy',title:'actNoteAstroTitle',disabled:!remote||!supported,run:()=>copyActiveNoteForAstro(this.plugin,file)}
      ]},
      {title:'catGovernance',actions:[
        {icon:'cloud-upload',title:'actMigrateTitle',disabled:!remote,run:()=>show(new BatchMigrateWizardModal(this.app,this.plugin))},
        {icon:'link',title:'actHealthTitle',run:()=>show(new HealthCheckModal(this.app,this.plugin))},
        {icon:'files',title:'actDupTitle',run:()=>show(new DuplicateWizardModal(this.app,this.plugin))},
        {icon:'search',title:'actOrphanTitle',run:()=>show(new OrphanWizardModal(this.app,this.plugin))},
        {icon:'chart-no-axes-combined',title:'actAnalyticsTitle',run:()=>show(new VaultAnalyticsModal(this.app,this.plugin))}
      ]},
      {title:'catFiles',actions:remote?[
        {icon:'images',title:'actRemoteGalleryTitle',run:()=>show(new RemoteGalleryModal(this.app,this.plugin))},
        {icon:'panel-right',title:'hubDockGallery',hidden:Platform.isMobile,run:()=>this.navigator.leave(leaf=>this.app.workspace.revealLeaf(leaf),()=>initGalleryLeaf(this.plugin,false))}
      ]:[{icon:'plug',title:'hubConnect',run:settings}]},
      {title:'catPreferences',actions:[
        {icon:'trash-2',title:'remoteTrashTitle',disabled:!remote,run:()=>show(new RemoteTrashModal(this.app,this.plugin))},
        {icon:'settings',title:'actOpenSettingsTitle',run:settings}
      ]}
    ];
    const bind=(button,action)=>{button.onclick=async event=>{
      event.preventDefault();event.stopPropagation();
      if(this.navigator.busy||button.disabled)return;
      this.lastAction=button;this.currentAction={title:t(action.title),icon:action.icon};button.disabled=true;
      try{await action.run();}catch(error){new Notice(error.message||String(error));}
      finally{if(button.isConnected)button.disabled=false;}
    };};
    for(const section of sections){
      const group=home.createDiv({cls:'fm-hub-section'}),title=group.createDiv({cls:'fm-hub-section-heading'});
      title.createEl('h3',{text:t(section.title)});
      if(section.context)title.createSpan({text:section.context,cls:'fm-hub-context'});
      const list=group.createDiv({cls:'fm-hub-list'});
      for(const action of section.actions.filter(action=>!action.hidden)){
        const row=list.createEl('button',{cls:'fm-hub-card',attr:{type:'button'}});
        setIcon(row.createSpan({cls:'fm-hub-card-icon'}),action.icon);
        const text=row.createSpan({cls:'fm-hub-card-text'});
        text.createSpan({text:t(action.title),cls:'fm-hub-card-title'});
        setIcon(row.createSpan({cls:'fm-hub-chevron'}),'chevron-right');
        row.disabled=Boolean(action.disabled);
        if(action.disabled)row.setAttribute('aria-label',`${t(action.title)} · ${t(!remote?'noticeRemoteNotReady':'hubOpenNote')}`);
        bind(row,action);
      }

    }

  }
  onClose(){this.navigator?.dispose();this.contentEl.empty();}
}
