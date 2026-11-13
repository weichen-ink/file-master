export const REMOTE_FILE_BATCH_SIZE = 20;

/** One server request per page, shared by rename, Hub and sidebar. */
export class RemoteFilePages {
  constructor(plugin, query = {}) {
    this.plugin=plugin;this.query=query;this.listeners=new Set();this.revision=0;this.pending=null;
    this.state={items:[],buckets:[],totalCount:0,pageIndex:0,loaded:false,loading:false,error:null};
  }
  subscribe(fn) { this.listeners.add(fn);return ()=>this.listeners.delete(fn); }
  emit() { this.listeners.forEach(fn=>fn(this.state)); }
  patch(values) { Object.assign(this.state,values);this.emit(); }
  get pageCount() { return Math.max(1,Math.ceil(this.state.totalCount/REMOTE_FILE_BATCH_SIZE)); }
  load(force=false) {
    if (this.pending && !force) return this.pending;
    if (this.state.loaded && !force) return Promise.resolve();
    this.revision++;
    this.patch({items:[],pageIndex:0,loaded:false,error:null});
    return this.request(0);
  }
  goToPage(index) {
    if (this.pending) return this.pending;
    const page=Math.min(this.pageCount-1,Math.max(0,Math.trunc(index)||0));
    if (page===this.state.pageIndex && this.state.loaded && !this.state.error) return Promise.resolve();
    return this.request(page);
  }
  retry() { return this.pending || this.request(this.failedPage ?? this.state.pageIndex); }
  request(index) {
    const revision=this.revision,query={...this.query};
    this.patch({loading:true,error:null});
    const pending=Promise.resolve().then(async()=>{
      try {
        let pageIndex=index;
        let page=await this.plugin.fetchRemoteFilePage({...query,limit:REMOTE_FILE_BATCH_SIZE,offset:pageIndex*REMOTE_FILE_BATCH_SIZE});
        if (revision!==this.revision) return;
        // Files may have been deleted while the user was on a later page.
        const last=Math.max(0,Math.ceil(page.totalCount/REMOTE_FILE_BATCH_SIZE)-1);
        if (pageIndex>last) {
          pageIndex=last;
          page=await this.plugin.fetchRemoteFilePage({...query,limit:REMOTE_FILE_BATCH_SIZE,offset:pageIndex*REMOTE_FILE_BATCH_SIZE});
          if (revision!==this.revision) return;
        }
        this.failedPage=null;
        this.patch({items:page.items,buckets:page.buckets,totalCount:page.totalCount,pageIndex,loaded:true,loading:false,error:null});
      } catch(error) {
        if (revision===this.revision) {this.failedPage=index;this.patch({loading:false,error:error.message||String(error)});}
      } finally {if(this.pending===pending)this.pending=null;}
    });
    this.pending=pending;return pending;
  }
  setQuery(query) {this.query=query;return this.load(true);}
  clear() {
    this.revision++;this.pending=null;this.failedPage=null;this.listeners.clear();
    Object.assign(this.state,{items:[],buckets:[],totalCount:0,pageIndex:0,loaded:false,loading:false,error:null});
  }
}
