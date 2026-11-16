import { displayVersion } from '../constants.js';
import { getCompatibilityMessage, initGalleryLeaf } from '../plugin/lifecycle.js';
import { checkServerCompatibility } from '../plugin/server-client.js';
import { isDocFile, refreshRemoteImageCache } from '../plugin/vault-utils.js';
import { copyActiveNoteForAstro, resumePendingMigration } from '../plugin/attachment-ops.js';
import { loadPendingRename } from '../plugin/remote-rename.js';
import { migrationCheckpointPath } from '../transfers.js';
import { BatchMigrateWizardModal } from './batch-migrate-wizard.js';
import { DuplicateWizardModal } from './duplicate-wizard.js';
import { HealthCheckModal } from './health-check.js';
import { OrphanWizardModal } from './orphan-wizard.js';
import { RemoteGalleryModal } from './remote-gallery.js';
import { RemoteRenameModal } from './remote-rename.js';
import { RemoteTrashModal } from './remote-trash.js';
import { ActiveNoteActionModal } from './active-note.js';
import { VaultAnalyticsModal } from './vault-analytics.js';
import { HubNavigator } from '../ui/navigation.js';
import { setIcon, Platform, Notice } from 'obsidian';
import { FileMasterModal as Modal } from '../ui/modal.js';

export class FileMasterHubModal extends Modal {
  constructor(app, plugin) { super(app); this.plugin = plugin; }
  onOpen(options = {}) {
    this.contentEl.empty();
    this.modalEl.addClass('fm-ui', 'fm-hub-dialog');
    const home=this.contentEl.createDiv({cls:'fm-hub-content'});
    this.navigator=new HubNavigator(this,home);
    const t=(key,params)=>this.plugin.t(key,params);
    this.navigator.chrome.title.empty();
    const header=this.homeHeading=this.navigator.chrome.title.createDiv({cls:'fm-hub-header'});
    setIcon(header.createSpan({cls:'fm-hub-brand-mark',attr:{'aria-hidden':'true'}}),'zap');
    header.createEl('h2',{text:t('hubTitle')});
    header.createSpan({text:'v'+displayVersion(this.plugin.manifest.version),cls:'fm-hub-version'});
    const remote=Boolean(this.plugin.isRemoteServerReady());
    const hasServerConfig=Boolean(
      this.plugin.settings?.enableRemoteServer
      && String(this.plugin.settings?.serverUrl||'').trim()
      && String(this.plugin.settings?.apiToken||'').trim()
    );
    const file=this.app.workspace.getActiveFile();
    const supported=Boolean(file&&isDocFile(this.app,file));
    const show=modal=>this.navigator.show(modal);
    const settings=()=>this.navigator.leave(async()=>{
      if (!this.app.setting) throw new Error(t('hubSettingsUnavailable'));
      await this.app.setting.open();
      await this.app.setting.openTabById(this.plugin.manifest.id);
    });
    if(remote || hasServerConfig){
      const statusEl=remote
        ? header.createSpan({cls:'fm-hub-status is-online'})
        : header.createEl('button',{cls:'fm-hub-status is-offline',attr:{type:'button'}});
      statusEl.createSpan({cls:'fm-hub-status-dot',attr:{'aria-hidden':'true'}});
      const statusTextEl=statusEl.createSpan({text:t(remote?'hubStatusOnline':'hubStatusOffline')});
      if(!remote){
        let retryFailed=false;
        statusEl.onclick=async event=>{
          event.preventDefault();
          if(retryFailed){
            await settings();
            return;
          }
          if(statusEl.disabled)return;
          statusEl.disabled=true;
          statusTextEl.textContent=t('hubStatusConnecting');
          try{
            const compat=await checkServerCompatibility(this.plugin);
            if(compat?.ok){
              new Notice(getCompatibilityMessage(this.plugin,compat));
              if(this.contentEl.isConnected)this.onOpen({skipHandshake:true});
              return;
            }
            retryFailed=true;
            if(statusEl.isConnected){
              statusEl.disabled=false;
              statusEl.classList.remove('is-offline');
              statusEl.classList.add('is-failed');
              statusTextEl.textContent=t('hubStatusFailedSettings');
              statusEl.title=getCompatibilityMessage(this.plugin,compat);
            }
          }catch(err){
            retryFailed=true;
            if(statusEl.isConnected){
              statusEl.disabled=false;
              statusEl.classList.remove('is-offline');
              statusEl.classList.add('is-failed');
              statusTextEl.textContent=t('hubStatusFailedSettings');
              statusEl.title=err.message||String(err);
            }
          }
        };
      }
    }
    if(hasServerConfig && !options?.skipHandshake){
      checkServerCompatibility(this.plugin).then(()=>{
        if(!this.contentEl.isConnected)return;
        if(Boolean(this.plugin.isRemoteServerReady())!==remote){
          this.onOpen({skipHandshake:true});
        }
      }).catch(()=>{});
    }
    const noteAction=mode=>{
      if (!file || this.app.vault.getAbstractFileByPath(file.path)!==file) throw new Error(t('noticeOpenMdFirst'));
      return show(new ActiveNoteActionModal(this.app,this.plugin,file,mode,{fromHub:true}));
    };
    const sections=[
      {title:supported?'catActiveNote':'catActiveNoteIdle',context:supported?file.name:t('hubNoOpenNote'),actions:[
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
        {icon:'file-pen-line',title:'remoteRenameTitle',run:()=>show(new RemoteRenameModal(this.app,this.plugin))},
        {icon:'panel-right',title:'hubDockGallery',hidden:Platform.isMobile,run:()=>this.navigator.leave(leaf=>this.app.workspace.revealLeaf(leaf),()=>initGalleryLeaf(this.plugin,false))}
      ]:[{icon:'plug',title:'hubConnect',run:settings}]},
      {title:'catPreferences',actions:[
        {icon:'trash-2',title:'remoteTrashTitle',disabled:!remote,run:()=>show(new RemoteTrashModal(this.app,this.plugin))},
        {icon:'refresh-cw',title:'actRefreshCacheTitle',disabled:!remote,run:async()=>{
          const res = await refreshRemoteImageCache(this.plugin);
          new Notice(t('noticeCacheRefreshed', { count: res.refreshedUrls }));
        }},
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
    (async()=>{
      const tasks=[];
      if(this.plugin.activeTransferController){
        tasks.push({icon:'loader',title:this.plugin.settings.language==='en'?'Transfer in progress':'正在执行传输任务',run:null});
      }
      try{
        if(remote && await this.app.vault.adapter.exists(migrationCheckpointPath(this.plugin))){
          tasks.push({icon:'rotate-ccw',title:this.plugin.settings.language==='en'?'Resume pending upload':'恢复未完成的上传任务',run:()=>this.navigator.leave(()=>resumePendingMigration(this.plugin))});
        }
      }catch{}
      try{
        if(remote && await loadPendingRename(this.plugin)){
          tasks.push({icon:'file-pen-line',title:this.plugin.settings.language==='en'?'Resume pending rename':'恢复未完成的远程改名',run:()=>show(new RemoteRenameModal(this.app,this.plugin))});
        }
      }catch{}
      if(!tasks.length || !this.contentEl.isConnected)return;
      const group=home.createDiv({cls:'fm-hub-section fm-hub-task-section'});
      if(home.firstChild && home.firstChild !== group) home.insertBefore(group, home.firstChild);
      const list=group.createDiv({cls:'fm-hub-list'});
      for(const task of tasks){
        const row=list.createEl('button',{cls:'fm-hub-card',attr:{type:'button'}});
        setIcon(row.createSpan({cls:'fm-hub-card-icon'}),task.icon);
        const text=row.createSpan({cls:'fm-hub-card-text'});
        text.createSpan({text:task.title,cls:'fm-hub-card-title'});
        if(task.run){
          row.onclick=async event=>{event.preventDefault();event.stopPropagation();try{await task.run();}catch(err){new Notice(err.message||String(err));}};
        }else{
          row.disabled=true;
        }
      }
    })();
    for(const section of sections){
      const group=home.createDiv({cls:'fm-hub-section'}),title=group.createDiv({cls:'fm-hub-section-heading'});
      title.createEl('h3',{text:t(section.title)});
      if(section.context){
        const ctxEl=title.createSpan({cls:`fm-hub-context${supported?' is-active':''}`});
        if(supported) setIcon(ctxEl.createSpan({cls:'fm-hub-context-icon',attr:{'aria-hidden':'true'}}),'file-text');
        ctxEl.createSpan({text:section.context,cls:'fm-hub-context-text',...(supported?{attr:{title:file.path}}:{})});
      }
      const list=group.createDiv({cls:'fm-hub-list'});
      for(const action of section.actions.filter(action=>!action.hidden)){
        const row=list.createEl('button',{cls:'fm-hub-card',attr:{type:'button'}});
        setIcon(row.createSpan({cls:'fm-hub-card-icon'}),action.icon);
        const text=row.createSpan({cls:'fm-hub-card-text'});
        text.createSpan({text:t(action.title),cls:'fm-hub-card-title'});
        const disabledReason=action.disabled?t(!remote?'noticeRemoteNotReady':'hubOpenNote'):'';
        if(disabledReason) text.createSpan({text:disabledReason,cls:'fm-hub-card-hint'});
        setIcon(row.createSpan({cls:'fm-hub-chevron'}),'chevron-right');
        row.disabled=Boolean(action.disabled);
        if(disabledReason)row.setAttribute('aria-label',`${t(action.title)} · ${disabledReason}`);
        bind(row,action);
      }

    }

  }
  onClose(){this.navigator?.dispose();this.contentEl.empty();}
}
