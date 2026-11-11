import { VIEW_TYPE_REMOTE_GALLERY } from '../constants.js';
import { filterRemoteGallery, renderRemoteGallery } from '../gallery.js';
import { galleryStore } from '../ui/gallery-store.js';
import { galleryToolbar } from '../ui/gallery-toolbar.js';
import { modalChrome, moduleHeading } from '../ui/navigation.js';
import { captureInsertionTarget, isInsertionTargetValid } from '../plugin/editor-target.js';
import { ItemView } from 'obsidian';
import { FileMasterModal as Modal } from '../ui/modal.js';

/** Modal and sidebar use the same controls, query and rendering, with separate host lifetimes. */
function openBrowser(host) {
  host.contentEl.empty();host.contentEl.addClass('fm-ui', 'fm-browser');
  host.store=galleryStore(host.plugin);
  host.insertionTarget=captureInsertionTarget(host.plugin);
  host.browserEvents=new AbortController();
  const updateTarget=()=>{
    const target=captureInsertionTarget(host.plugin);
    if(target)host.insertionTarget=target;
    host.contentEl.querySelectorAll('[data-insert-action]').forEach(button=>{button.disabled=!isInsertionTargetValid(host.plugin,host.insertionTarget);});
  };
  host.contentEl.addEventListener('pointerdown',updateTarget,{capture:true,signal:host.browserEvents.signal});
  host.workspaceEvents=['active-leaf-change','file-open'].map(event=>host.app.workspace.on(event,updateTarget));
  if(host instanceof Modal)moduleHeading(host,host.contentEl,{title:'actRemoteGalleryTitle',symbol:'images'});
  const toolbar=host.toolbar=galleryToolbar(host,host.contentEl),status=host.contentEl.createDiv({cls:'fm-browser-status',attr:{'aria-live':'polite'}}),grid=host.contentEl.createDiv({cls:'fm-gallery-grid'});
  host.render=()=>{
    const state=host.store.state;toolbar.sync();status.empty();
    if(state.loading)status.createSpan({text:host.t('galleryLoading')});
    if(state.error){status.createSpan({text:host.t('galleryLoadFail',{err:state.error})});const retry=status.createEl('button',{text:host.t('galleryBtnRefresh')});retry.onclick=()=>host.store.load(true);}
    if(!state.loaded && !state.items.length){grid.empty();toolbar.count.empty();}else host.renderGrid(grid,toolbar.count);
  };
  if(host.fromHub){const footer=host.contentEl.createDiv({cls:'fm-btn-row'});footer.createEl('button',{text:host.t('btnCancel')}).onclick=()=>host.returnToHub();}
  host.unsubscribe=host.store.subscribe(host.render);host.render();
  return host.store.load();
}
function closeBrowser(host){host.toolbar?.dispose();host.workspaceEvents?.forEach(ref=>host.app.workspace.offref(ref));host.workspaceEvents=[];host.browserEvents?.abort();host.unsubscribe?.();host.unsubscribe=null;host.contentEl.empty();}
function bindState(host){
  // The renderer's existing query interface is backed by one shared store.
  for(const key of ['items','searchQuery','selectedBucket','selectedType','selectedSort','layoutMode','insertMode','galleryPage','galleryFilterKey'])Object.defineProperty(host,key,{get:()=>host.store.state[key],set:value=>{host.store.state[key]=value;},configurable:true});
}
export class RemoteGalleryModal extends Modal {
  constructor(app,plugin){super(app);this.plugin=plugin;this.store=galleryStore(plugin);bindState(this);}
  t(key,params){return this.plugin.t(key,params);}
  async onOpen(){this.modalEl.addClass('fm-ui', 'fm-gallery-dialog');modalChrome(this);return openBrowser(this);}
  rebuild(){closeBrowser(this);return openBrowser(this);}
  loadData(){return this.store.load(true);}
  filterItems(){return filterRemoteGallery(this);}
  renderGrid(container,count){renderRemoteGallery(this,container,count);}
  onClose(){closeBrowser(this);}
}
export class RemoteGalleryView extends ItemView {
  constructor(leaf,plugin){super(leaf);this.plugin=plugin;this.store=galleryStore(plugin);bindState(this);}
  getViewType(){return VIEW_TYPE_REMOTE_GALLERY;}
  getDisplayText(){return this.t('galleryViewTitle');}
  getIcon(){return 'images';}
  t(key,params){return this.plugin.t(key,params);}
  async onOpen(){this.contentEl.addClass('fm-gallery-view-container');return openBrowser(this);}
  rebuild(){closeBrowser(this);return openBrowser(this);}
  loadData(){return this.store.load(true);}
  filterItems(){return filterRemoteGallery(this);}
  renderGrid(container,count){renderRemoteGallery(this,container,count);}
  onClose(){closeBrowser(this);}
}
