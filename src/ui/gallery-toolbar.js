import { setIcon, Notice } from 'obsidian';
export function iconButton(parent, plugin, key, symbol, run) {
  const button=parent.createEl('button',{cls:'fm-icon-button',attr:{type:'button','aria-label':plugin.t(key)}});
  setIcon(button,symbol);
  button.onclick=async event=>{event.preventDefault();event.stopPropagation();if(button.disabled)return;button.disabled=true;try{await run(event);}catch(error){new Notice(error.message||String(error));}finally{if(button.isConnected)button.disabled=false;}};
  return button;
}
const sorts=['time_desc','time_asc','size_desc','size_asc','name_asc','name_desc','hits_desc'];
const sortKeys=['gallerySortTimeDesc','gallerySortTimeAsc','gallerySortSizeDesc','gallerySortSizeAsc','gallerySortNameAsc','gallerySortNameDesc','gallerySortHitsDesc'];
export function galleryToolbar(view,parent) {
  const t=(key,params)=>view.t(key,params),store=view.store,plugin=view.plugin;
  const toolbar=parent.createDiv({cls:'fm-browser-toolbar'});
  const searchRow=toolbar.createDiv({cls:'fm-browser-search-row'});
  const search=searchRow.createEl('input',{type:'search',cls:'fm-gallery-search',attr:{placeholder:t('gallerySearchPlaceholder'),'aria-label':t('gallerySearchPlaceholder')}});
  search.oninput=()=>store.patch({searchQuery:search.value.toLowerCase(),galleryPage:0});
  iconButton(searchRow,plugin,'galleryBtnRefresh','refresh-cw',()=>store.load(true));
  const filters=toolbar.createDiv({cls:'fm-browser-filters'});
  const folder=filters.createEl('select',{attr:{'aria-label':t('galleryFolderLabel')}});
  const type=filters.createEl('select',{attr:{'aria-label':t('galleryTypeLabel')}});
  for(const [value,key] of [['all','galleryFilterAllTypes'],['image','galleryFilterImage'],['audio','galleryFilterAudio'],['other','galleryFilterOther']])type.createEl('option',{value,text:t(key)});
  folder.onchange=()=>store.patch({selectedBucket:folder.value,galleryPage:0});
  type.onchange=()=>store.patch({selectedType:type.value,galleryPage:0});
  const controls=toolbar.createDiv({cls:'fm-browser-control-row'});
  const sortingHost=controls.createDiv({cls:'fm-sort-control'});
  const sorting=sortingHost.createEl('details',{cls:'fm-sort-menu'});
  const summary=sorting.createEl('summary',{cls:'fm-icon-button',attr:{'aria-label':t('gallerySortLabel')}});setIcon(summary,'arrow-down-wide-narrow');
  const menu=sorting.createDiv({cls:'fm-sort-options'}),sortButtons=[];
  sorts.forEach((value,index)=>{const button=menu.createEl('button',{text:t(sortKeys[index]),attr:{type:'button'}});button.onclick=()=>{store.patch({selectedSort:value,galleryPage:0});sorting.open=false;summary.focus();};sortButtons.push(button);});
  sorting.onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();sorting.open=false;summary.focus();}};
  const viewModes=controls.createDiv({cls:'fm-view-controls',attr:{role:'group','aria-label':t('galleryLayoutLabel')}});
  const grid=iconButton(viewModes,plugin,'galleryLayoutGrid','layout-grid',()=>store.patch({layoutMode:'grid'}));
  const list=iconButton(viewModes,plugin,'galleryLayoutList','list',()=>store.patch({layoutMode:'list'}));
  const format=controls.createDiv({cls:'fm-browser-format'});format.createSpan({text:t('galleryInsertFormatLabel')});
  const modeGroup=format.createDiv({cls:'fm-gallery-mode-group',attr:{role:'group','aria-label':t('galleryLinkFormat')}});
  const modes=['raw','webp'].map(mode=>{const button=modeGroup.createEl('button',{text:t(mode==='raw'?'galleryModeRaw':'galleryModeWebp'),attr:{type:'button'}});button.onclick=async()=>{try{await store.setInsertMode(mode);}catch(error){new Notice(error.message);}};return button;});
  const footer=toolbar.createDiv({cls:'fm-browser-summary'}),count=footer.createDiv({cls:'fm-gallery-stats'});
  const outside=event=>{if(!sorting.contains(event.target))sorting.open=false;};
  const ownerDocument=parent.ownerDocument;ownerDocument?.addEventListener('click',outside);
  let folderKey='';
  return {count,dispose(){ownerDocument?.removeEventListener('click',outside);},sync(){
    const state=store.state;
    if(search.value!==state.searchQuery)search.value=state.searchQuery;
    const buckets=[...new Set(state.items.map(item=>`${item.year}/${item.month}`))].sort().reverse();
    const nextKey=buckets.join(',');
    if(nextKey!==folderKey||!folder.children.length){folder.empty();folder.createEl('option',{value:'all',text:t('galleryFilterAllTime')});buckets.forEach(value=>folder.createEl('option',{value,text:value}));folderKey=nextKey;}
    folder.value=state.selectedBucket;type.value=state.selectedType;
    for(const [button,mode] of [[grid,'grid'],[list,'list']]){button.toggleClass('is-active',state.layoutMode===mode);button.setAttribute('aria-pressed',String(state.layoutMode===mode));}
    modes.forEach((button,index)=>{const selected=state.insertMode===['raw','webp'][index];button.toggleClass('is-active',selected);button.setAttribute('aria-pressed',String(selected));});
    sortButtons.forEach((button,index)=>{button.setAttribute('aria-pressed',String(state.selectedSort===sorts[index]));});
  }};
}
