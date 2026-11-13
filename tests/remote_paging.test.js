const test=require('node:test');
const assert=require('node:assert/strict');
const {createVaultFixture}=require('./helpers/vault');
const {loadPlugin}=require('./helpers/load-plugin');
const {Element}=require('./helpers/ui');
const tick=()=>new Promise(setImmediate);
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const image=n=>({filename:`image-${n}.png`,year:'2026',month:'11',size:n,rawUrl:`https://example.com/raw/2026/11/image-${n}.png`});
const mappings=[{from:image(1).rawUrl,to:image(2).rawUrl}];
const response={success:true,item:image(2),linkMappings:mappings};
const request={year:'2026',month:'11',filename:image(1).filename,newFilename:image(2).filename};

function fixture(){
  const f=createVaultFixture(async()=>({status:200,json:response}));
  f.plugin.fetchRemoteFilePage=async()=>({items:[],totalCount:0,buckets:[]});
  return f;
}

test('Rename keeps pagination outside the list, loads 20 images per page and preserves drafts without scanning notes',async()=>{
  const f=fixture(),calls=[];
  f.add('unrelated.md','unrelated');let reads=0;f.plugin.app.vault.read=async()=>{reads++;return '';};
  f.plugin.fetchRemoteFilePage=async options=>{
    calls.push(options);return {items:Array.from({length:20},(_,i)=>image(options.offset+i)),totalCount:60,buckets:['2026/11']};
  };
  const modal=new f.RemoteRenameModal(f.plugin.app,f.plugin);await modal.onOpen();
  assert.deepEqual(calls[0],{types:['image'],sort:'time_desc',limit:20,offset:0});
  assert.equal(modal.rowControls.size,20);assert.equal(reads,0);
  assert.equal(modal.browserFooter.root.parentElement,modal.contentEl);
  assert.ok(!modal.list.all().includes(modal.browserFooter.pagination));
  assert.equal(modal.cancel.parentElement,modal.browserFooter.actions);
  assert.equal(modal.next.parentElement,modal.browserFooter.actions);
  const first=modal.rowControls.values().next().value;first.input.onfocus();first.input.value='draft';first.input.oninput();
  await modal.browserFooter.next.onclick();
  assert.equal(calls[1].offset,20);assert.equal(modal.rowControls.size,20);assert.equal(reads,0);
  assert.equal(modal.pages.state.pageIndex,1);assert.equal(modal.list.scrollTop,0);
  await modal.browserFooter.previous.onclick();
  assert.equal(modal.rowControls.values().next().value.input.value,'draft');
  modal.query='other';await modal.reloadRemotePage();
  assert.equal(calls.at(-1).offset,0);assert.equal(calls.at(-1).q,'other');assert.equal(reads,0);
  modal.onClose();
});

test('Shared page loader rejects stale responses, shares navigation requests, and retries the failed page',async()=>{
  const {RemoteFilePages}=loadPlugin(),a=deferred(),b=deferred(),calls=[];
  const plugin={fetchRemoteFilePage:options=>{calls.push(options);return calls.length===1?a.promise:b.promise;}};
  const pages=new RemoteFilePages(plugin),first=pages.load();await tick();
  const second=pages.setQuery({q:'new'});await tick();
  b.resolve({items:[image(9)],totalCount:65,buckets:[]});await second;
  a.resolve({items:[image(0)],totalCount:65,buckets:[]});await first;
  assert.equal(pages.state.items[0].filename,image(9).filename);
  let fail=true;plugin.fetchRemoteFilePage=async options=>{calls.push(options);if(fail)throw Error('offline');return {items:[image(options.offset)],totalCount:65,buckets:[]};};
  await pages.goToPage(1);assert.equal(pages.state.pageIndex,0);assert.equal(pages.state.error,'offline');
  fail=false;await Promise.all([pages.retry(),pages.retry()]);assert.equal(calls.length,4);assert.equal(pages.state.pageIndex,1);
  assert.equal(pages.state.items.length,1);assert.equal(calls.at(-1).offset,20);
  await pages.goToPage(2);assert.equal(calls.at(-1).offset,40);
});

test('Hub and sidebar use one footer outside results and send global filters to the 20-item loader',async()=>{
  const f=fixture(),calls=[];
  f.plugin.app.workspace.on=()=>({});f.plugin.app.workspace.offref=()=>{};
  f.plugin.fetchRemoteFilePage=async options=>{calls.push(options);return {items:[image(options.offset)],totalCount:45,buckets:['2025/01','2026/11']};};
  const hub=new f.RemoteGalleryModal(f.plugin.app,f.plugin);hub.fromHub=true;hub.returnToHub=()=>{};await hub.onOpen();
  const sidebar=new f.RemoteGalleryView({},f.plugin);sidebar.app=f.plugin.app;sidebar.contentEl=new Element();await sidebar.onOpen();
  assert.equal(hub.store,sidebar.store);
  for(const host of [hub,sidebar]){
    const results=host.contentEl.querySelector('.fm-browser-results');
    assert.ok(!results.all().includes(host.browserFooter.root));
    assert.equal(host.browserFooter.root.parentElement,host.contentEl);
    assert.equal(results.querySelector('.fm-gallery-pagination'),undefined);
  }
  await hub.browserFooter.next.onclick();assert.equal(calls.at(-1).offset,20);
  assert.equal(sidebar.store.state.pageIndex,1);
  hub.store.patch({selectedBuckets:['2025/01'],selectedTypes:['image'],selectedSort:'hits_asc'});await hub.store.pending;
  assert.deepEqual(calls.at(-1),{q:'',buckets:['2025/01'],types:['image'],sort:'hits_asc',limit:20,offset:0});
  const count=calls.length;hub.store.patch({layoutMode:'grid'});assert.equal(calls.length,count);
  assert.deepEqual(hub.store.state.buckets,['2025/01','2026/11']);hub.onClose();sidebar.onClose();hub.store.clear();
});

test('Deleting files from a later page clamps to the last existing page',async()=>{
  const {RemoteFilePages}=loadPlugin(),calls=[];
  const pages=new RemoteFilePages({fetchRemoteFilePage:async options=>{calls.push(options);return {items:[image(options.offset)],totalCount:calls.length===1?65:21,buckets:[]};}});
  await pages.load();await pages.goToPage(3);
  assert.equal(calls[1].offset,60);assert.equal(calls[2].offset,20);assert.equal(pages.state.pageIndex,1);assert.equal(pages.pageCount,2);
});

test('Commit reuses preview discovery and never rereads unchanged unrelated notes',async()=>{
  const f=fixture();f.add('linked.md',mappings[0].from);
  for(let i=0;i<60;i++)f.add(`other-${i}.md`,'unrelated');
  const plan=await f.scanRenameReferences(f.plugin,mappings),reads=[];const read=f.plugin.app.vault.read;
  f.plugin.app.vault.read=async file=>{reads.push(file.path);return read(file);};
  const report=await f.executeRemoteRename(f.plugin,request,null,null,plan);
  assert.equal(report.complete,true);assert.equal(report.updatedDocuments,1);assert.ok(reads.length>0);
  assert.ok(reads.every(path=>path==='linked.md'));assert.equal(f.contents.get('linked.md'),mappings[0].to);
});

test('Commit includes new, renamed and edited notes after preview, even with unchanged timestamps',async()=>{
  const f=fixture();f.add('original.md',mappings[0].from);const edited=f.add('edited.md','unrelated'),renamed=f.add('before.md','unrelated');
  const plan=await f.scanRenameReferences(f.plugin,mappings);
  f.contents.set('edited.md',mappings[0].from);f.trackRenameReferenceChange(f.plugin,edited);
  renamed.path='after.md';f.contents.set('after.md',mappings[0].from);f.trackRenameReferenceChange(f.plugin,renamed,'before.md');
  f.add('new.md',mappings[0].from);
  const report=await f.executeRemoteRename(f.plugin,request,null,null,plan);
  assert.equal(report.complete,true);assert.equal(report.updatedDocuments,4);
  for(const path of ['original.md','edited.md','after.md','new.md'])assert.equal(f.contents.get(path),mappings[0].to);
});

test('Notes changed during execution are caught by delta validation and can be retried',async()=>{
  const f=fixture();f.add('linked.md',mappings[0].from);const other=f.add('other.md','unrelated');
  const plan=await f.scanRenameReferences(f.plugin,mappings),process=f.plugin.app.vault.process;
  f.plugin.app.vault.process=async(file,transform)=>{await process(file,transform);f.contents.set('other.md',mappings[0].from);f.trackRenameReferenceChange(f.plugin,other);};
  const report=await f.executeRemoteRename(f.plugin,request,null,null,plan);
  assert.equal(report.complete,false);assert.deepEqual(report.remaining.map(doc=>doc.path),['other.md']);
  f.plugin.app.vault.process=process;
  assert.equal((await f.executeRemoteRename(f.plugin,request,null,report.job)).complete,true);
});

test('A persisted preview from an earlier plugin session safely rediscovers references',async()=>{
  const f=fixture();f.add('a.md',mappings[0].from);const other=f.add('b.md','unrelated');
  const plan=await f.scanRenameReferences(f.plugin,mappings);f.contents.set('b.md',mappings[0].from);
  // Reload loses the old event journal; metadata alone is insufficient.
  delete f.plugin.renameReferenceChanges;
  const report=await f.executeRemoteRename(f.plugin,request,null,null,JSON.parse(JSON.stringify(plan)));
  assert.equal(report.complete,true);assert.equal(report.updatedDocuments,2);assert.equal(f.contents.get(other.path),mappings[0].to);
});

test('The client sends paging filters while complete-list consumers retain every result',async()=>{
  const calls=[],images=Array.from({length:45},(_,i)=>image(i));
  const {serverClient}=loadPlugin(async options=>{
    calls.push(options);const params=new URL(options.url).searchParams;
    const items=params.has('limit')?images.slice(Number(params.get('offset')),Number(params.get('offset'))+Number(params.get('limit'))):images;
    return {status:200,json:{images:items,totalCount:45,buckets:['2026/11']}};
  });
  const plugin={settings:{apiToken:'secret'},getCleanServerUrl:()=> 'https://example.com'};
  const page=await serverClient.fetchRemoteFilePage(plugin,{q:'图片',types:['image','audio'],buckets:['2025/01','2026/11'],sort:'hits_asc',limit:20,offset:20});
  const query=new URL(calls[0].url).searchParams;
  assert.equal(query.get('q'),'图片');assert.equal(query.get('types'),'image,audio');assert.equal(query.get('buckets'),'2025/01,2026/11');
  assert.equal(query.get('sort'),'hits_asc');assert.equal(query.get('limit'),'20');assert.equal(query.get('offset'),'20');
  assert.equal(calls[0].headers.Authorization,'Bearer secret');assert.equal(page.totalCount,45);
  assert.deepEqual(page.items.map(item=>item.filename),images.slice(20,40).map(item=>item.filename));
  assert.equal((await serverClient.fetchRemoteFileList(plugin)).length,45);
  assert.equal(new URL(calls[1].url).search,'');
});


test('Full-catalog server responses show only the selected 20 files in rename, Hub and sidebar',async()=>{
  const images=Array.from({length:1024},(_,i)=>({...image(i),createdAt:i}));
  const f=createVaultFixture(async()=>({status:200,json:{images,optimizationEnabled:false,stats:{}}}));
  // Exercise the actual client boundary, not the fixture's list-to-page adapter.
  f.plugin.fetchRemoteFilePage=options=>f.serverClient.fetchRemoteFilePage(f.plugin,options);
  f.plugin.app.workspace.on=()=>({});f.plugin.app.workspace.offref=()=>{};
  const rename=new f.RemoteRenameModal(f.plugin.app,f.plugin);await rename.onOpen();
  const names=()=>[...rename.rowControls.values()].map(control=>control.input.value);
  assert.equal(rename.rowControls.size,20);assert.equal(rename.pages.state.totalCount,1024);
  assert.equal(rename.pages.state.items[0].filename,'image-1023.png');const first=names();
  await rename.browserFooter.next.onclick();
  assert.equal(rename.rowControls.size,20);assert.equal(rename.pages.state.items[0].filename,'image-1003.png');
  assert.ok(names().every(name=>!first.includes(name)));
  await rename.browserFooter.previous.onclick();assert.deepEqual(names(),first);rename.onClose();

  const hub=new f.RemoteGalleryModal(f.plugin.app,f.plugin);await hub.onOpen();
  const sidebar=new f.RemoteGalleryView({},f.plugin);sidebar.app=f.plugin.app;sidebar.contentEl=new Element();await sidebar.onOpen();
  const rowCount=host=>host.contentEl.all().filter(el=>el.className.split(' ').includes('fm-gallery-list-row')).length;
  assert.equal(rowCount(hub),20);assert.equal(rowCount(sidebar),20);
  await hub.browserFooter.next.onclick();
  assert.equal(rowCount(hub),20);assert.equal(rowCount(sidebar),20);
  assert.equal(hub.store.state.items[0].filename,'image-1003.png');
  await hub.store.goToPage(51);assert.equal(rowCount(hub),4);assert.equal(rowCount(sidebar),4);
  assert.equal(hub.store.state.items[0].filename,'image-3.png');
  hub.onClose();sidebar.onClose();hub.store.clear();
});

test('Full-catalog fallback filters and sorts globally before slicing, retains facets and complete-list access',async()=>{
  const images=Array.from({length:80},(_,i)=>({...image(i),filename:`Photo-${i}.png`,year:i<40?'2025':'2026',createdAt:i,hits:80-i}));
  images.push({...image(999),filename:'Photo-999.mp3',year:'2024'});
  const {serverClient}=loadPlugin(async()=>({status:200,json:{images}}));
  const plugin={settings:{apiToken:'test'},getCleanServerUrl:()=> 'https://example.com'};
  const page=await serverClient.fetchRemoteFilePage(plugin,{q:'PHOTO',types:['image'],buckets:['2026/11'],sort:'size_desc',limit:20,offset:20});
  assert.equal(page.totalCount,40);assert.equal(page.items.length,20);
  assert.deepEqual(page.items.map(item=>item.size),Array.from({length:20},(_,i)=>59-i));
  assert.deepEqual(page.buckets,['2024/11','2025/11','2026/11']);
  const hits=await serverClient.fetchRemoteFilePage(plugin,{types:['image'],sort:'hits_asc',limit:20,offset:0});
  assert.equal(hits.items[0].filename,'Photo-79.png');
  const empty=await serverClient.fetchRemoteFilePage(plugin,{q:'missing',limit:20,offset:0});
  assert.equal(empty.totalCount,0);assert.deepEqual(empty.items,[]);assert.equal(empty.buckets.length,3);
  assert.equal((await serverClient.fetchRemoteFileList(plugin)).length,81);
});

test('Oversized responses cannot bypass pagination even if they include a total count',async()=>{
  const images=Array.from({length:45},(_,i)=>({...image(i),createdAt:i}));
  const {serverClient}=loadPlugin(async()=>({status:200,json:{images,totalCount:45}}));
  const page=await serverClient.fetchRemoteFilePage({settings:{},getCleanServerUrl:()=> 'https://example.com'},{limit:20,offset:40});
  assert.equal(page.items.length,5);assert.equal(page.items[0].filename,'image-4.png');assert.equal(page.totalCount,45);
});
