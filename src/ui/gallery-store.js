export class GalleryStore {
  constructor(plugin) {
    this.plugin=plugin;
    this.state={items:[],loading:false,error:null,loaded:false,searchQuery:'',selectedBucket:'all',selectedType:'all',selectedSort:'time_desc',layoutMode:'list',galleryPage:0,galleryFilterKey:'',insertMode:plugin.settings.galleryInsertFormat || (plugin.settings.insertOptimizedLinkOnUpload?'webp':'raw')};
    this.listeners=new Set();this.revision=0;this.formatRevision=0;this.pending=null;
  }
  subscribe(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn);}
  emit(){this.listeners.forEach(fn=>fn(this.state));}
  patch(values){Object.assign(this.state,values);this.emit();}
  async load(force=false){
    if(this.pending&&!force)return this.pending;
    if(this.state.loaded&&!force)return;
    const revision=++this.revision;
    this.patch({loading:true,error:null});
    const pending=Promise.resolve().then(async()=>{
      try {const items=await this.plugin.fetchRemoteFileList();if(revision===this.revision)this.patch({items,loading:false,loaded:true,error:null});}
      catch(error){if(revision===this.revision)this.patch({loading:false,error:error.message||String(error)});}
      finally{if(this.pending===pending)this.pending=null;}
    });this.pending=pending;return pending;
  }
  async setInsertMode(mode){
    if(!['raw','webp'].includes(mode))return;
    const previous=this.state.insertMode,revision=++this.formatRevision;
    this.plugin.settings.galleryInsertFormat=mode;this.patch({insertMode:mode});
    try {await this.plugin.saveSettings();}
    catch(error){if(revision===this.formatRevision){this.plugin.settings.galleryInsertFormat=previous;this.patch({insertMode:previous});}throw error;}
  }
  clear(){this.revision++;this.pending=null;this.listeners.clear();this.state.items=[];this.state.loaded=false;}
}
export function galleryStore(plugin){return plugin.galleryStore || (plugin.galleryStore=new GalleryStore(plugin));}
