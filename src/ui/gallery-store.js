import { RemoteFilePages } from './remote-file-pages.js';

export class GalleryStore extends RemoteFilePages {
  constructor(plugin) {
    super(plugin,{sort:'time_desc'});
    this.state={...this.state,searchQuery:'',selectedBuckets:[],selectedTypes:[],selectedSort:'time_desc',layoutMode:'list',galleryPage:0,galleryFilterKey:'',insertMode:plugin.settings.galleryInsertFormat || (plugin.settings.insertOptimizedLinkOnUpload?'webp':'raw')};
    this.formatRevision=0;
  }
  patch(values) {
    const changed = Object.keys(values).some(key => ['searchQuery','selectedBuckets','selectedTypes','selectedSort'].includes(key) && JSON.stringify(this.state[key]) !== JSON.stringify(values[key]));
    Object.assign(this.state, values);
    if (changed) {
      clearTimeout(this.searchTimer);
      if ('searchQuery' in values) this.searchTimer = setTimeout(() => { this.searchTimer = null; this.reloadQuery(); }, 220);
      else this.reloadQuery();
    } else this.emit();
  }
  reloadQuery() {
    const state=this.state;
    this.query={q:state.searchQuery, buckets:state.selectedBuckets, types:state.selectedTypes, sort:state.selectedSort};
    return this.load(true);
  }
  async setInsertMode(mode){
    if(!['raw','webp'].includes(mode))return;
    const previous=this.state.insertMode,revision=++this.formatRevision;
    this.plugin.settings.galleryInsertFormat=mode;this.patch({insertMode:mode});
    try {await this.plugin.saveSettings();}
    catch(error){if(revision===this.formatRevision){this.plugin.settings.galleryInsertFormat=previous;this.patch({insertMode:previous});}throw error;}
  }
  clear(){clearTimeout(this.searchTimer);this.formatRevision++;super.clear();}
}
export function galleryStore(plugin){return plugin.galleryStore || (plugin.galleryStore=new GalleryStore(plugin));}
