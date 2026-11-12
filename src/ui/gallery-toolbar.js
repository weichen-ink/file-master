import { setIcon, Notice } from 'obsidian';
import { galleryFilter, galleryPopover } from './gallery-filter.js';
export function iconButton(parent, plugin, key, symbol, run) {
  const button=parent.createEl('button',{cls:'fm-icon-button',attr:{type:'button','aria-label':plugin.t(key)}});
  setIcon(button,symbol);
  button.onclick=async event=>{event.preventDefault();event.stopPropagation();if(button.disabled)return;button.disabled=true;try{await run(event);}catch(error){new Notice(error.message||String(error));}finally{if(button.isConnected)button.disabled=false;}};
  return button;
}
const sorts=['time_desc','time_asc','size_desc','size_asc','name_asc','name_desc','hits_desc','hits_asc'];
const sortKeys=['gallerySortTimeDesc','gallerySortTimeAsc','gallerySortSizeDesc','gallerySortSizeAsc','gallerySortNameAsc','gallerySortNameDesc','gallerySortHitsDesc','gallerySortHitsAsc'];
const sortSummaryKeys=['gallerySortTimeDesc','gallerySortTimeAsc','gallerySortLargest','gallerySortSmallest','gallerySortNameForward','gallerySortNameReverse','gallerySortMostViewed','gallerySortLeastViewed'];
let sortSequence=0;
export function galleryToolbar(view,parent) {
  const t=(key,params)=>view.t(key,params),store=view.store,plugin=view.plugin;
  const toolbar=parent.createDiv({cls:'fm-browser-toolbar'});
  const searchRow=toolbar.createDiv({cls:'fm-browser-search-row'});
  const search=searchRow.createEl('input',{type:'search',cls:'fm-gallery-search',attr:{placeholder:t('gallerySearchPlaceholder'),'aria-label':t('gallerySearchPlaceholder')}});
  search.oninput=()=>store.patch({searchQuery:search.value.toLowerCase(),galleryPage:0});
  iconButton(searchRow,plugin,'galleryBtnRefresh','refresh-cw',()=>store.load(true));
  const viewModes=searchRow.createDiv({cls:'fm-view-controls',attr:{role:'group','aria-label':t('galleryLayoutLabel')}});
  const grid=iconButton(viewModes,plugin,'galleryLayoutGrid','layout-grid',()=>store.patch({layoutMode:'grid'}));
  const list=iconButton(viewModes,plugin,'galleryLayoutList','list',()=>store.patch({layoutMode:'list'}));
  const filters=toolbar.createDiv({cls:'fm-browser-filters'});
  const folder=galleryFilter(filters,{t,labelKey:'galleryFolderLabel',allKey:'galleryAllFolders',summaryKey:'gallerySelectedFolders',tree:true,selected:()=>store.state.selectedBuckets,change:values=>store.patch({selectedBuckets:values,galleryPage:0})});
  const type=galleryFilter(filters,{t,labelKey:'galleryTypeLabel',allKey:'galleryAllTypes',summaryKey:'gallerySelectedTypes',selected:()=>store.state.selectedTypes,change:values=>store.patch({selectedTypes:values,galleryPage:0})});
  const sort=galleryPopover(filters,{t,labelKey:'gallerySortLabel'});
  sort.body.setAttribute('role','radiogroup');sort.body.setAttribute('aria-label',t('gallerySortLabel'));
  const radioName=`fm-gallery-sort-${++sortSequence}`;
  const sortInputs=sorts.map((value,index)=>{
    const label=sort.body.createEl('label',{cls:'fm-filter-option'});
    const input=label.createEl('input',{type:'radio',cls:'fm-filter-radio',attr:{name:radioName,'aria-label':t(sortKeys[index])}});
    label.createSpan({cls:'fm-filter-radio-mark',attr:{'aria-hidden':'true'}});
    label.createSpan({text:t(sortKeys[index])});
    input.onchange=()=>{
      if(!input.checked)return;
      store.patch({selectedSort:value,galleryPage:0});sort.root.open=false;sort.trigger.focus();
    };
    return input;
  });
  const popups=[folder.root,type.root,sort.root];
  const outside=event=>{for(const popup of popups)if(!popup.contains(event.target))popup.open=false;};
  const escape=event=>{if(event.key==='Escape')for(const popup of popups)if(popup.open&&popup.contains(event.target)){event.preventDefault();event.stopPropagation();popup.open=false;popup.querySelector('summary').focus();}};
  const ownerDocument=parent.ownerDocument;ownerDocument?.addEventListener('click',outside);
  const controller=new AbortController();toolbar.addEventListener('keydown',escape,{signal:controller.signal});
  return {dispose(){ownerDocument?.removeEventListener('click',outside);controller.abort();},sync(){
    const state=store.state;
    if(search.value!==state.searchQuery)search.value=state.searchQuery;
    const buckets=[...new Set(state.items.map(item=>`${item.year}/${item.month}`))].sort().reverse();
    folder.sync(buckets.map(value=>({value,label:value.split('/')[1],summary:value.replace('/',' / ')})));
    type.sync([['image','galleryFilterImage'],['audio','galleryFilterAudio'],['other','galleryFilterOther']].map(([value,key])=>({value,label:t(key),summary:t(key)})));
    for(const [button,mode] of [[grid,'grid'],[list,'list']]){button.toggleClass('is-active',state.layoutMode===mode);button.setAttribute('aria-pressed',String(state.layoutMode===mode));}
    const sortIndex=Math.max(0,sorts.indexOf(state.selectedSort));
    sort.text.setText(t(sortSummaryKeys[sortIndex]));
    sortInputs.forEach((input,index)=>{input.checked=index===sortIndex;});
  }};
}
