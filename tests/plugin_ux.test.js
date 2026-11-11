const test=require('node:test');
const assert=require('node:assert/strict');
const {loadPlugin}=require('./helpers/load-plugin');
const {Element}=require('./helpers/ui');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(setImmediate);
const host={setIcon(){}};
const setup=()=>loadPlugin(undefined,{host});

test('Hub navigation keeps the first tap inside one host and detaches late renderers on Back',async()=>{
  const {HubNavigator}=setup();const contentEl=new Element(),home=contentEl.createDiv(),modalEl=new Element();let closed=0,opened=0,cleaned=0;
  const host={contentEl,modalEl,plugin:{t:k=>k},close(){closed++;},open(){opened++;}};
  const nav=new HubNavigator(host,home),wait=deferred();
  const child={onOpen(){this.contentEl.createDiv({text:'first tap'});return wait.promise;},onClose(){cleaned++;},open(){throw Error('Must not open a second backdrop');}};
  const run=nav.show(child);assert.equal(home.hidden,true);assert.equal(child.contentEl.children[0].text,'first tap');
  const stale=child.contentEl;nav.back();assert.equal(home.hidden,false);assert.equal(cleaned,1);assert.equal(stale.parentElement.isConnected,false);
  stale.createDiv({text:'late result'});wait.resolve();await run;assert.equal(contentEl.all().some(el=>el.text==='late result'),false);
  await nav.show({onOpen(){},onClose(){}});nav.child.close();assert.equal(closed,1);assert.equal(opened,0);
});

test('Hub external handoff is single flight and can recover after a failed destination',async()=>{
  const {HubNavigator}=setup(),wait=deferred();let prepared=0,closed=0,reopened=0;
  const nav=new HubNavigator({contentEl:new Element(),modalEl:new Element(),close(){closed++;nav.dispose();},open(){reopened++;}},new Element());
  const action=nav.leave(()=>{throw Error('unavailable');},()=>{prepared++;return wait.promise;});
  await nav.leave(()=>{},()=>{prepared++;});assert.equal(prepared,1);assert.equal(closed,0);
  wait.resolve();await action;assert.equal(closed,1);assert.equal(reopened,1);
});

test('Opening a modal never replaces or swallows its normal close method',async()=>{
  const {openModal}=setup();let opened=0,closed=0;const modal={open(){opened++;},close(){closed++;}};const close=modal.close;
  await openModal(modal);modal.close();assert.equal(opened,1);assert.equal(closed,1);assert.equal(modal.close,close);
});

test('Gallery requests are shared; an older response cannot replace a refreshed catalog',async()=>{
  const {GalleryStore}=setup(),a=deferred(),b=deferred();let requests=0;
  const store=new GalleryStore({settings:{},fetchRemoteFileList:()=>++requests===1?a.promise:b.promise});
  const first=store.load(),shared=store.load();await tick();assert.equal(requests,1);
  const latest=store.load(true);await tick();assert.equal(requests,2);
  b.resolve([{filename:'new'}]);await latest;a.resolve([{filename:'old'}]);await first;await shared;
  assert.equal(store.state.items[0].filename,'new');assert.equal(store.state.loading,false);
});

test('Gallery handles synchronous failure, failed preference save and disposed requests',async()=>{
  const {GalleryStore}=setup(),wait=deferred();const plugin={settings:{galleryInsertFormat:'raw',insertOptimizedLinkOnUpload:false},saveSettings:async()=>{throw Error('disk');},fetchRemoteFileList(){throw Error('offline');}};
  const store=new GalleryStore(plugin);await store.load();assert.equal(store.state.error,'offline');assert.equal(store.pending,null);
  await assert.rejects(store.setInsertMode('webp'),/disk/);assert.equal(store.state.insertMode,'raw');assert.equal(plugin.settings.insertOptimizedLinkOnUpload,false);
  plugin.saveSettings=async()=>{};await store.setInsertMode('webp');assert.equal(plugin.settings.galleryInsertFormat,'webp');assert.equal(plugin.settings.insertOptimizedLinkOnUpload,false);
  plugin.fetchRemoteFileList=()=>wait.promise;let notifications=0;store.subscribe(()=>notifications++);const request=store.load(true);await tick();store.clear();const count=notifications;wait.resolve([{filename:'late'}]);await request;assert.equal(store.state.items.length,0);assert.equal(notifications,count);
});

test('First sidebar activation waits for creation and reveal, and retries failed initialization',async()=>{
  const {initGalleryLeaf}=setup(),creation=deferred(),revealed=deferred();let created=0,reveals=0;
  const leaf={setViewState(){created++;return creation.promise;}};
  const plugin={isRemoteServerReady:()=>true,app:{workspace:{getLeavesOfType:()=>[],getRightLeaf:()=>leaf,revealLeaf(){reveals++;return revealed.promise;}}}};
  let done=false;const first=initGalleryLeaf(plugin,true).then(()=>done=true),second=initGalleryLeaf(plugin,false);
  assert.equal(created,1);assert.equal(reveals,0);creation.resolve();await second;await tick();assert.equal(reveals,1);assert.equal(done,false);revealed.resolve();await first;assert.equal(done,true);
  leaf.setViewState=()=>{throw Error('closed');};await assert.rejects(initGalleryLeaf(plugin),/closed/);await tick();leaf.setViewState=async()=>{};assert.equal(await initGalleryLeaf(plugin),leaf);
});

test('Viewport anchored zoom, actual pixels, pan limits and fit are consistent',()=>{
  const {createViewportModel}=setup(),model=createViewportModel();model.resize(824,624,1600,1200);assert.equal(model.state.scale,.5);
  model.actual();model.zoom(2,{x:100,y:50});assert.equal(model.state.scale,2);assert.equal(model.state.x,-100);assert.equal(model.state.y,-50);
  model.pan(1e6,-1e6);assert.equal(model.state.x,1188);assert.equal(model.state.y,-888);
  model.zoom(1e6);assert.equal(model.state.scale,8);model.fit();assert.equal(model.state.scale,.5);assert.equal(model.state.x,0);assert.equal(model.state.y,0);
});

test('Viewport supports two touch points, cancel cleanup, double tap and disposal',()=>{
  const observers=[];class Observer{constructor(fn){this.fn=fn;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}}
  const {mountImageViewport}=loadPlugin(undefined,{host,ResizeObserver:Observer});
  const stage=new Element(),image=new Element('img');Object.assign(stage,{clientWidth:824,clientHeight:624,setPointerCapture(){},getBoundingClientRect:()=>({left:0,top:0})});Object.assign(image,{complete:true,naturalWidth:1600,naturalHeight:1200});
  const scales=[],view=mountImageViewport(stage,image,n=>scales.push(n));assert.equal(scales.at(-1),50);
  const event=(id,x,y,time=0)=>({pointerId:id,clientX:x,clientY:y,pointerType:'touch',button:0,timeStamp:time,preventDefault(){}});
  stage.dispatch('pointerdown',event(1,312,312));stage.dispatch('pointerdown',event(2,512,312));stage.dispatch('pointermove',event(2,712,312));assert.equal(scales.at(-1),100);
  stage.dispatch('pointercancel',event(1,312,312));stage.dispatch('pointercancel',event(2,712,312));
  for(const time of [1000,1200]){stage.dispatch('pointerdown',event(3,412,312,time));stage.dispatch('pointerup',event(3,412,312,time+50));}assert.equal(scales.at(-1),50);
  view.dispose();const count=scales.length;stage.dispatch('wheel',{deltaY:-100,preventDefault(){}});assert.equal(scales.length,count);assert.equal(observers[0].disconnected,true);
});

test('Link formats escape Markdown names and only offer supported WebP variants',()=>{
  const {assetMarkdown,assetUrl,hasOptimizedVariant}=setup();
  assert.equal(assetMarkdown('a[b]\\x.png','https://test/a (b).png'),'![a\\[b\\]\\\\x.png](https://test/a%20%28b%29.png)');
  const file={filename:'note.pdf',pubUrl:'optimized',rawUrl:'original'};assert.equal(hasOptimizedVariant(file),false);assert.equal(assetUrl(file,'webp'),'original');
  assert.equal(hasOptimizedVariant({...file,filename:'image.png',optimizationEnabled:false}),false);assert.equal(hasOptimizedVariant({...file,filename:'image.png',isProcessableImage:true}),true);
});

function editorFixture(){
  let text='hello',cursor={line:0,ch:5};const file={path:'note.md',extension:'md'},editor={getCursor:()=>({...cursor}),getValue:()=>text,replaceRange(value,from,to){text=text.slice(0,from.ch)+value+text.slice(to.ch);},setCursor(value){cursor=value;},focus(){}};
  const view={file,editor},leaf={view};view.leaf=leaf;const workspace={getActiveViewOfType:()=>view,getLeavesOfType:()=>[leaf],setActiveLeaf(){},getActiveFile:()=>file};
  const plugin={t:k=>k,app:{workspace,vault:{getAbstractFileByPath:()=>file}}};return {plugin,view,file,editor,change:value=>text=value};
}

test('Insertion preserves the captured selection, advances the cursor, and rejects stale content/file',()=>{
  const {captureInsertionTarget,insertMarkdownToActiveEditor}=setup(),{plugin,view,change}=editorFixture(),target=captureInsertionTarget(plugin);
  assert.equal(insertMarkdownToActiveEditor(plugin,' link',null,target),true);assert.equal(target.from.ch,10);assert.equal(view.editor.getValue(),'hello link');
  assert.equal(insertMarkdownToActiveEditor(plugin,'2',null,target),true);assert.equal(view.editor.getValue(),'hello link2');
  change('external edit');assert.equal(insertMarkdownToActiveEditor(plugin,'WRONG',null,target),false);assert.equal(view.editor.getValue(),'external edit');
  view.file={path:'other.md',extension:'md'};assert.equal(insertMarkdownToActiveEditor(plugin,'WRONG',null,target),false);
});

test('Preview renders usable links before image load, ignores late local URLs and hides invalid WebP',async()=>{
  const copied=[],wait=deferred(),{ImageLightboxModal}=loadPlugin(undefined,{host,navigator:{clipboard:{writeText:async value=>copied.push(value)}}});const {plugin}=editorFixture();plugin.settings={};plugin.app.vault.getResourcePath=()=>wait.promise;
  const local=new ImageLightboxModal(plugin.app,plugin,{source:'local',name:'test.png',size:10,rawObj:{path:'test.png'}});local.onOpen();local.onClose();wait.resolve('late.png');await tick();assert.equal(local.contentEl.children.length,0);
  const remote=new ImageLightboxModal(plugin.app,plugin,{source:'remote',name:'test.png',size:10,rawObj:{filename:'test.png',rawUrl:'raw.png',pubUrl:'public.png',optimizationEnabled:false}});remote.onOpen();
  const buttons=remote.contentEl.all().filter(el=>el.className.includes('fm-asset-copy-action'));assert.equal(buttons.length,2);
  for(const button of buttons)await button.onclick();assert.deepEqual(copied,['raw.png','![test.png](raw.png)']);
  const old=remote.stage.children[0];remote.onClose();old.dispatch('error');assert.equal(remote.contentEl.children.length,0);
});

test('Clipboard failures return feedback without leaking rejected promises',async()=>{
  const notices=[];const {copyText}=loadPlugin(undefined,{host:{Notice:class{constructor(value){notices.push(value);}}},navigator:{clipboard:{writeText:async()=>{throw Error('denied');}}}});
  assert.equal(await copyText({t:k=>k},'test'),false);assert.deepEqual(notices,['copyFailed']);
});

test('Bilingual strings cover every literal UI key in the changed components',()=>{
  const fs=require('node:fs'),{UI_STRINGS}=setup();for(const file of ['src/modals/hub.js','src/modals/remote-gallery.js','src/modals/dialogs.js','src/ui/gallery-toolbar.js','src/modals/remote-trash.js','src/ui/navigation.js']){
    const source=fs.readFileSync(file,'utf8');for(const match of source.matchAll(/\bt\('([^']+)'/g))for(const language of ['zh','en'])assert.ok(UI_STRINGS[language][match[1]],`${file}: ${language}.${match[1]}`);
  }
});

test('Closing the browser removes workspace subscriptions and late loads cannot render into it',async()=>{
  const {RemoteGalleryModal}=setup(),wait=deferred(),{plugin}=editorFixture(),events=new Set();plugin.settings={};plugin.fetchRemoteFileList=()=>wait.promise;
  plugin.app.workspace.on=(name,callback)=>{const ref={name,callback};events.add(ref);return ref;};plugin.app.workspace.offref=ref=>events.delete(ref);
  const browser=new RemoteGalleryModal(plugin.app,plugin),pending=browser.onOpen();assert.equal(events.size,2);assert.equal(plugin.galleryStore.listeners.size,1);
  browser.onClose();assert.equal(events.size,0);assert.equal(plugin.galleryStore.listeners.size,0);wait.resolve([{filename:'late.png'}]);await pending;assert.equal(browser.contentEl.children.length,0);
});

test('Mobile Hub keeps connection setup visible and omits the desktop docking action',()=>{
  const {FileMasterHubModal}=loadPlugin(undefined,{host:{...host,Platform:{isMobile:true}}}),{plugin}=editorFixture();Object.assign(plugin,{manifest:{version:'1.1',id:'file-master'},isRemoteServerReady:()=>false});
  const hub=new FileMasterHubModal(plugin.app,plugin);hub.onOpen();assert.ok(hub.contentEl.all().some(el=>el.text==='hubConnect'));assert.equal(hub.contentEl.all().some(el=>el.text==='hubDockGallery'),false);
  const actions=hub.contentEl.all().filter(el=>el.tag==='button'&&el.disabled);assert.equal(actions.length,5);hub.onClose();
});


test('Clicking a gallery filename opens the same preview as its thumbnail',async()=>{
  const opened=[],api=loadPlugin(undefined,{host,onModalOpen:modal=>opened.push(modal)}),{plugin}=editorFixture();plugin.settings={};
  const item={filename:'readable.png',year:'2026',month:'11',size:30,rawUrl:'raw.png'};
  const view={plugin,app:plugin.app,items:[item],filterItems:()=>[item],t:key=>key,layoutMode:'list'};
  const container=new Element();api.renderRemoteGallery(view,container);
  const filename=container.all().find(el=>el.tag==='button'&&el.className.includes('fm-gallery-name'));
  filename.onclick();await tick();assert.equal(opened.length,1);assert.equal(opened[0].item.rawObj,item);
});

test('Hub exposes sidebar, settings and recycle bin as equal action cards',()=>{
  const {FileMasterHubModal}=setup(),{plugin}=editorFixture();Object.assign(plugin,{manifest:{version:'1.1',id:'file-master'},isRemoteServerReady:()=>true});
  const hub=new FileMasterHubModal(plugin.app,plugin);hub.onOpen();
  for(const key of ['hubDockGallery','actOpenSettingsTitle','remoteTrashTitle']){
    const title=hub.contentEl.all().find(el=>el.text===key);assert.ok(title);assert.ok(title.parentElement.parentElement.className.includes('fm-hub-card'));
  }
  hub.onClose();
});

test('Trash restores once, refreshes the catalog and ignores a response after close',async()=>{
  const {RemoteTrashModal}=setup(),{plugin}=editorFixture();let restores=0,catalog=0,reads=0;
  Object.assign(plugin,{settings:{},fetchRemoteTrash:async()=>++reads===1?[{id:'test-id',filename:'test.png',size:30,deletedAt:Date.now()}]:[],restoreRemoteTrash:async id=>{assert.equal(id,'test-id');restores++;},fetchRemoteFileList:async()=>{catalog++;return [];}});
  const modal=new RemoteTrashModal(plugin.app,plugin);await modal.onOpen();const restore=modal.contentEl.all().find(el=>el.text==='remoteTrashRestore');
  await Promise.all([restore.onclick(),restore.onclick()]);assert.equal(restores,1);assert.equal(catalog,1);assert.ok(modal.contentEl.all().some(el=>el.text==='remoteTrashEmpty'));
  const wait=deferred();plugin.fetchRemoteTrash=()=>wait.promise;const pending=modal.load();modal.onClose();wait.resolve([{filename:'late'}]);await pending;assert.equal(modal.contentEl.children.length,0);
});

test('Recycle bin client uses bearer authentication and encodes restoration ids',async()=>{
  const calls=[],{serverClient}=loadPlugin(async request=>{calls.push(request);return {status:200,json:request.method==='GET'?{items:[{id:'test'}]}:{ok:true}};});
  const plugin={getCleanServerUrl:()=> 'https://example.test',settings:{apiToken:'test-only'}};
  assert.equal((await serverClient.fetchRemoteTrash(plugin))[0].id,'test');await serverClient.restoreRemoteTrash(plugin,'a/b');await serverClient.permanentlyDeleteRemoteTrash(plugin,'a/b');
  assert.equal(calls[0].headers.Authorization,'Bearer test-only');assert.equal(calls[1].url,'https://example.test/api/modules/image-host/trash/a%2Fb/restore');assert.equal(calls[1].method,'POST');assert.equal(calls[2].url,'https://example.test/api/modules/image-host/trash/a%2Fb');assert.equal(calls[2].method,'DELETE');
});


test('Hub title and close share a row; children cancel back without another navigation button',async()=>{
  const {FileMasterHubModal,moduleHeading}=setup(),{plugin}=editorFixture();Object.assign(plugin,{manifest:{version:'1.1',id:'file-master'},isRemoteServerReady:()=>true,fetchRemoteTrash:async()=>[]});
  const hub=new FileMasterHubModal(plugin.app,plugin);hub.onOpen();
  const chrome=hub.navigator.chrome;
  assert.equal(hub.homeHeading.parentElement,chrome.title);
  assert.equal(chrome.title.parentElement,chrome.close.parentElement);
  const card=hub.contentEl.all().find(el=>el.text==='remoteTrashTitle').parentElement.parentElement;
  await card.onclick({preventDefault(){},stopPropagation(){}});
  assert.ok(chrome.title.all().some(el=>el.text==='remoteTrashTitle'));
  moduleHeading(hub.navigator.child,hub.navigator.child.contentEl,{title:'remoteTrashTitle',step:1,total:2});
  const step=chrome.title.all().find(el=>el.className==='fm-module-heading-step');
  assert.equal(step.text,'1/2');assert.equal(step['aria-label'],'stepOf');
  assert.equal(hub.modalEl.all().some(el=>el.className.includes('fm-modal-back')),false);
  const cancel=hub.contentEl.all().find(el=>el.text==='btnCancel');assert.ok(cancel);
  cancel.onclick();assert.equal(hub.navigator.home.hidden,false);
  assert.equal(hub.homeHeading.parentElement,chrome.title);
  assert.ok(!chrome.title.all().some(el=>el.text==='remoteTrashTitle'));
  hub.onClose();
});

test('Permanent deletion requires confirmation; cancel and repeated confirm cannot send a second request',async()=>{
  const opened=[],{RemoteTrashModal}=loadPlugin(undefined,{host,onModalOpen:modal=>opened.push(modal)}),{plugin}=editorFixture();let deletes=0;
  Object.assign(plugin,{settings:{},fetchRemoteTrash:async()=>deletes?[]:[{id:'sample',filename:'long-file.png',size:10,deletedAt:Date.now()}],permanentlyDeleteRemoteTrash:async()=>{deletes++;}});
  const trash=new RemoteTrashModal(plugin.app,plugin);await trash.onOpen();let remove=trash.contentEl.all().find(el=>el.text==='remoteTrashDelete');
  await remove.onclick();let dialog=opened.at(-1);dialog.onOpen();await dialog.contentEl.all().find(el=>el.text==='btnCancel').onclick();assert.equal(deletes,0);assert.equal(remove.disabled,false);
  await remove.onclick();dialog=opened.at(-1);dialog.onOpen();const confirm=dialog.contentEl.all().find(el=>el.text==='remoteTrashDelete');
  await confirm.onclick();await confirm.onclick();assert.equal(deletes,1);assert.ok(trash.contentEl.all().some(el=>el.text==='remoteTrashEmpty'));
});


test('Duplicate empty result offers another scope without irrelevant merge controls',()=>{
  const {DuplicateWizardModal}=setup(),{plugin}=editorFixture();plugin.settings={};const modal=new DuplicateWizardModal(plugin.app,plugin);modal.step=2;modal.onOpen();
  assert.ok(modal.contentEl.all().some(el=>el.text==='dupEmptyTitle'));assert.equal(modal.contentEl.all().some(el=>el.text==='dupStrategyLabel'),false);
  const choose=modal.contentEl.all().find(el=>el.text==='dupChooseScopeAgain');assert.ok(choose);choose.onclick();assert.equal(modal.step,1);
});


test('Hub cards expose only action names and the hosted recycle bin renders returned files',async()=>{
 const {FileMasterHubModal}=setup(),{plugin}=editorFixture();Object.assign(plugin,{manifest:{version:'1.1',id:'file-master'},isRemoteServerReady:()=>true,fetchRemoteTrash:async()=>[{id:'sample',filename:'Recovered image.png',size:30,deletedAt:Date.now()}]});
 const hub=new FileMasterHubModal(plugin.app,plugin);hub.onOpen();
 assert.equal(hub.contentEl.all().some(el=>el.className.includes('fm-hub-card-desc')),false);
 const title=hub.contentEl.all().find(el=>el.text==='remoteTrashTitle'),card=title.parentElement.parentElement;
 await card.onclick({preventDefault(){},stopPropagation(){}});
 assert.ok(hub.contentEl.all().some(el=>el.text==='Recovered image.png'));assert.equal(hub.modalEl.className.includes('fm-hub-dialog'),false);
 hub.navigator.back();assert.equal(hub.modalEl.className.includes('fm-hub-dialog'),true);hub.onClose();
});


test('An empty current-note upload has no step badge and offers Cancel',async()=>{
  const {ActiveNoteActionModal,DEFAULT_SETTINGS}=setup(),{plugin,file}=editorFixture();
  assert.equal(DEFAULT_SETTINGS.excludedLocalFolders,'');
  plugin.settings={};plugin.app.vault.read=async()=>'';plugin.buildVaultReferenceSnapshot=async()=>({});
  const modal=new ActiveNoteActionModal(plugin.app,plugin,file,'migrate',{fromHub:true});
  await modal.onOpen();
  assert.equal(modal.modalEl.all().some(el=>el.className==='fm-module-heading-step'),false);
  assert.ok(modal.contentEl.all().some(el=>el.text==='btnCancel'));
  modal.onClose();
});

test('Gallery action controls have one accessible tooltip source and sizes omit dates',()=>{
  const {renderRemoteGallery}=setup(),{plugin}=editorFixture();plugin.settings={};
  const item={filename:'preview.png',year:'2026',month:'11',size:30,rawUrl:'raw.png'};
  const view={plugin,app:plugin.app,items:[item],filterItems:()=>[item],t:key=>key,layoutMode:'list'};
  const container=new Element();renderRemoteGallery(view,container);
  const actions=container.all().filter(el=>el.tag==='button'&&el.className.includes('fm-icon-button'));
  assert.equal(actions.length,2);
  assert.ok(actions.every(el=>el['aria-label']&&!el.title));
  assert.equal(container.all().some(el=>String(el.text).includes('2026/11')),false);
});
