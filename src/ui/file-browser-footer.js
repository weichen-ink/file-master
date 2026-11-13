/** Pagination stays outside the scrolling collection, beside the workflow actions. */
export function fileBrowserFooter(parent, plugin, source) {
  const root=parent.createDiv({cls:'fm-browser-footer'});
  const pagination=root.createEl('nav',{cls:'fm-browser-pagination',attr:{'aria-label':plugin.t('galleryPaginationLabel')}});
  const previous=pagination.createEl('button',{text:plugin.t('pagePrevious'),attr:{type:'button'}});
  const count=pagination.createSpan({cls:'fm-browser-page-count',attr:{'aria-live':'polite'}});
  const next=pagination.createEl('button',{text:plugin.t('pageNext'),attr:{type:'button'}});
  const actions=root.createDiv({cls:'fm-btn-row'});
  const retry=pagination.createEl('button',{text:plugin.t('previewRetry'),attr:{type:'button'}});
  let busy=false;
  const change=index=>{if(!busy && !source.state.loading)return source.goToPage(index);};
  previous.onclick=()=>change(source.state.pageIndex-1);
  next.onclick=()=>change(source.state.pageIndex+1);
  retry.onclick=()=>{if(!busy)return source.retry();};
  return {root,actions,pagination,previous,next,count,sync(disabled=false) {
    busy=disabled;
    const state=source.state,total=source.pageCount;
    pagination.hidden=total<=1 && !state.error;
    previous.disabled=busy||state.loading||state.pageIndex===0;
    next.disabled=busy||state.loading||state.pageIndex>=total-1;
    retry.hidden=!state.error;retry.disabled=busy||state.loading;
    count.setText(plugin.t('pageCount',{current:state.pageIndex+1,total}));
  }};
}
