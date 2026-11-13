const test=require('node:test');
const assert=require('node:assert/strict');
const {createVaultFixture}=require('./helpers/vault');
const base='https://example.com';
const item={year:'2026',month:'11',filename:'new.png',sha256:'a'.repeat(64),size:32,rawUrl:`${base}/private/2026/11/new.png`,pubUrl:`${base}/optimized/2026/11/new.webp`};
const mappings=[{from:`${base}/private/2026/11/old.png`,to:item.rawUrl},{from:`${base}/optimized/2026/11/old.webp`,to:item.pubUrl},{from:`${base}/pub/2026/11/old.webp`,to:item.pubUrl}];
const response={success:true,item,linkMappings:mappings};
const request={year:'2026',month:'11',filename:'old.png',newFilename:'new.png',expectedSha256:item.sha256};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('Rename rewriter preserves URL variants, surrounding content, foreign hosts and longer filenames',()=>{
  const f=createVaultFixture();const rewrite=f.createRenameRewriter(mappings,base);
  const sources=[
    `![caption](${mappings[0].from}?raw=1#section "title")`,
    `![](${mappings[1].from}?wm=tile)`,
    `![root](/private/2026/11/old.png)`,
    `id123: ${mappings[0].from}`, // Excalidraw Embedded Files
    JSON.stringify({url:mappings[0].from}),
    JSON.stringify({url:mappings[0].from}).replaceAll('/','\\/'),
    `<img src="${mappings[0].from}" width="300">`
  ];
  for(const source of sources){const result=rewrite(source);assert.equal(result.count,1,source);assert.ok(result.text.includes('new.'));assert.equal(rewrite(result.text).count,0);}
  const variants=rewrite(sources.join('\n'));
  assert.ok(variants.text.includes('?wm=tile'));assert.ok(variants.text.includes('?raw=1#section "title"'));assert.ok(variants.text.includes('id123:'));
  for(const url of [`https://foreign.example/private/2026/11/old.png`,`${mappings[0].from}.bak`,`${mappings[0].from}/nested`,`${mappings[0].from.replace('old.png','prefix-old.png')}`,`${base}/other/2026/11/old.png`])assert.equal(rewrite(url).count,0,url);
  const unicode=f.createRenameRewriter([{from:`${base}/raw/2026/11/图片(旧).png`,to:`${base}/raw/2026/11/图片(新).png`}],base);
  for(const value of [`${base}/raw/2026/11/图片(旧).png`,encodeURI(`${base}/raw/2026/11/图片(旧).png`)])assert.equal(unicode(`<${value}>`).count,1);
});

test('Rename updates all supported vault documents against latest contents, with an honest result',async()=>{
  let calls=0,payload;
  const f=createVaultFixture(async options=>{calls++;payload=JSON.parse(options.body);assert.equal(options.headers.Authorization,'Bearer test-token');return {status:200,json:response};});
  f.plugin.settings.apiToken='test-token';f.plugin.fetchRemoteFileList=async()=>[item];
  f.add('note.md',`![image](${mappings[0].from}?raw=1)`);
  f.add('board.canvas',JSON.stringify({nodes:[{type:'link',url:mappings[1].from+'?wm=text'}]}));
  f.add('drawing.excalidraw.md',`---\nexcalidraw-plugin: parsed\n---\n## Embedded Files\nimage-id: ${mappings[0].from}\n`);
  f.add('drawing.excalidraw',JSON.stringify({files:{id:{dataURL:mappings[0].from}}}));
  f.add('Vault_Analytics_Report_2026-11-11.md',`[reference](${mappings[0].from})`);
  f.add('unrelated.md','Do not change me');f.add('asset.png','bytes',true);
  const preflight=await f.scanRenameReferences(f.plugin,mappings);
  assert.equal(preflight.documents.length,5);assert.equal(preflight.references,5);
  const process=f.plugin.app.vault.process;
  f.plugin.app.vault.process=async(file,transform)=>{if(file.path==='note.md')f.contents.set(file.path,f.contents.get(file.path)+'\nConcurrent edit');await process(file,transform);};
  const result=await f.executeRemoteRename(f.plugin,request);
  assert.equal(calls,1);assert.match(payload.operationId,/^rename-/);assert.equal(payload.expectedSha256,item.sha256);
  assert.equal(result.complete,true);assert.equal(result.updatedDocuments,5);assert.equal(result.updatedReferences,5);
  assert.ok(f.contents.get('note.md').endsWith('Concurrent edit'));assert.ok(f.contents.get('board.canvas').includes('new.webp?wm=text'));
  assert.ok(f.contents.get('drawing.excalidraw.md').includes('image-id: '+item.rawUrl));
  assert.equal(f.contents.get('unrelated.md'),'Do not change me');assert.equal(f.journal.size,0);
});

test('Partial reference writes retain progress and retry without renaming twice',async()=>{
  let calls=0;
  const f=createVaultFixture(async()=>{calls++;return {status:200,json:response};});
  f.plugin.fetchRemoteFileList=async()=>[item];
  f.add('good.md',mappings[0].from);f.add('locked.md',mappings[1].from);
  const process=f.plugin.app.vault.process;
  f.plugin.app.vault.process=async(file,transform)=>{if(file.path==='locked.md')throw new Error('read-only file');return process(file,transform);};
  const first=await f.executeRemoteRename(f.plugin,request);
  assert.equal(first.complete,false);assert.equal(first.failures.length,1);assert.equal(first.updatedReferences,1);assert.ok(f.journal.size);
  const pending=await f.loadPendingRename(f.plugin);
  f.plugin.app.vault.process=process;
  const resumed=await f.executeRemoteRename(f.plugin,pending.request,null,pending);
  assert.equal(calls,1);assert.equal(resumed.complete,true);assert.equal(resumed.updatedDocuments,2);assert.equal(resumed.updatedReferences,2);assert.equal(f.journal.size,0);
});

test('A lost server response retries with the same operation ID; a changed server cannot resume it',async()=>{
  const ids=[];let lose=true;
  const f=createVaultFixture(async options=>{ids.push(JSON.parse(options.body).operationId);if(lose)throw new Error('network lost');return {status:200,json:response};});
  f.add('note.md',mappings[0].from);
  await assert.rejects(f.executeRemoteRename(f.plugin,request),/network lost/);
  let pending=await f.loadPendingRename(f.plugin);assert.ok(pending);assert.equal(pending.result,null);
  f.plugin.settings.serverUrl='https://different.example';
  await assert.rejects(f.executeRemoteRename(f.plugin,pending.request,null,pending),/server address changed/i);
  assert.equal(ids.length,1);
  f.plugin.settings.serverUrl=base;lose=false;
  const report=await f.executeRemoteRename(f.plugin,pending.request,null,pending);
  assert.equal(report.complete,true);assert.equal(ids[0],ids[1]);assert.equal(f.contents.get('note.md'),item.rawUrl);
});

test('Final validation reports unreadable documents and detects references introduced by concurrent edits',async()=>{
  const f=createVaultFixture(async()=>({status:200,json:response}));
  f.add('a.md',mappings[0].from);f.add('b.md',mappings[1].from);
  const read=f.plugin.app.vault.read;
  f.plugin.app.vault.read=async file=>{if(file.path==='a.md')throw new Error('cannot read');return read(file);};
  await assert.rejects(f.scanRenameReferences(f.plugin,mappings),/a.md: cannot read/);
  const first=await f.executeRemoteRename(f.plugin,request);
  assert.equal(first.complete,false);assert.ok(first.failures.some(f=>f.path==='a.md'));
  f.plugin.app.vault.read=read;
  f.contents.set('b.md',f.contents.get('b.md')+' '+mappings[0].from);
  const result=await f.executeRemoteRename(f.plugin,first.job.request,null,first.job);
  assert.equal(result.complete,true);assert.ok(!f.contents.get('b.md').includes('old.png'));
});

test('Deleting a failed document allows recovery to finish; definite name conflicts leave no journal',async()=>{
  const f=createVaultFixture(async()=>({status:200,json:response}));
  f.add('removed.md',mappings[0].from);const process=f.plugin.app.vault.process;
  f.plugin.app.vault.process=async()=>{throw new Error('permission denied');};
  const partial=await f.executeRemoteRename(f.plugin,request);assert.equal(partial.complete,false);
  f.trashed.push('removed.md');f.plugin.app.vault.process=process;
  assert.equal((await f.executeRemoteRename(f.plugin,partial.job.request,null,partial.job)).complete,true);
  const conflict=createVaultFixture(async()=>({status:409,json:{error:'Name reserved',code:'NAME_RESERVED'}}));
  await assert.rejects(conflict.executeRemoteRename(conflict.plugin,request),error=>error.code==='NAME_RESERVED');
  assert.equal(conflict.journal.size,0);
});

test('Hub rename workflow uses the shared heading and footer, validates references, and renders results',async()=>{
  const requests=[];
  const f=createVaultFixture(async options=>{requests.push(options.url);return {status:200,json:response};});
  f.plugin.fetchRemoteFileList=async()=>[{...item,filename:'old.png',rawUrl:mappings[0].from}];
  f.add('note.md',mappings[0].from);
  const modal=new f.RemoteRenameModal(f.plugin.app,f.plugin);
  await modal.onOpen();
  assert.equal(modal.modalEl.all().filter(el=>el.className.includes('fm-modal-nav')).length,1);
  assert.equal(modal.next.disabled,true);
  const row=modal.rowControls.values().next().value;
  row.input.onfocus();
  assert.equal(modal.next.disabled,true);
  row.input.value='new';row.input.oninput();
  assert.equal(modal.next.disabled,false);
  await tick();
  assert.ok(!modal.list.all().some(el=>el.className==='fm-file-ref-button'));
  assert.ok(!modal.list.all().some(el=>String(el.text).includes('2026/11')));
  await modal.next.onclick();
  assert.equal(modal.preview.references.references,1);
  assert.equal(modal.inReview,true);
  await modal.submit.onclick();
  assert.equal(requests.length,2);assert.ok(requests[0].endsWith('/rename/preview'));assert.ok(requests[1].endsWith('/rename'));
  assert.ok(modal.body.all().some(el=>el.text==='File renamed'));
  assert.equal(f.contents.get('note.md'),item.rawUrl);
  modal.onClose();await tick();
});


test('Preview discovery includes legacy aliases and supported document types',async()=>{
  const f=createVaultFixture();
  const legacy=base+'/private/2026/11/before-last-rename.png';
  const other={...item,filename:'other.png',rawUrl:base+'/private/2026/11/other.png',pubUrl:base+'/optimized/2026/11/other.webp'};
  f.add('one.md',`${item.rawUrl} ${item.rawUrl}?raw=1 ${item.pubUrl} ${legacy}`);
  f.add('two.canvas',JSON.stringify({nodes:[{url:legacy}]}));
  f.add('three.excalidraw',`${other.rawUrl} ${other.pubUrl}`);
  f.add('foreign.md',`https://foreign.example/private/2026/11/new.png`);
  const plan=await f.scanRenameReferences(f.plugin,[...new Set([item.rawUrl,item.pubUrl,legacy])].map(from=>({from,to:other.rawUrl})));
  assert.deepEqual(plan.documents.map(doc=>doc.path),['one.md','two.canvas']);
  assert.equal(plan.references,5);
});

test('First-step name conflict stays in the editable list, and only Next triggers validation',async()=>{
  let calls=0;
  const f=createVaultFixture(async()=>{calls++;return {status:409,json:{error:'Name already exists',code:'NAME_CONFLICT'}};});
  f.plugin.fetchRemoteFileList=async()=>[{...item,filename:'old.png',rawUrl:mappings[0].from}];
  const modal=new f.RemoteRenameModal(f.plugin.app,f.plugin);await modal.onOpen();
  const row=modal.rowControls.values().next().value;
  row.input.value='taken';row.input.oninput();
  assert.equal(calls,0);assert.equal(modal.next.disabled,false);
  await modal.next.onclick();
  assert.equal(calls,1);assert.equal(modal.inReview,false);assert.equal(modal.preview,null);
  assert.equal(row.input.value,'taken');assert.equal(row.input.disabled,false);assert.equal(row.input['aria-invalid'],'true');
  assert.equal(row.error.text,f.plugin.t('renameNameTaken'));
  row.input.value='available';row.input.oninput();assert.equal(row.input['aria-invalid'],'false');
  modal.onClose();
});

test('A successful note edit interrupted before progress save is counted once on resume',async()=>{
  const f=createVaultFixture(async()=>({status:200,json:response}));
  f.add('note.md',mappings[0].from);
  // Simulate the persisted state immediately before a process interruption after the edit.
  const operationId='rename-interrupted-123';
  const job={version:1,serverUrl:base,operationId,request:{...request,operationId},result:response,documents:{'note.md':{status:'updating',references:0,pendingReferences:1,afterHash:await f.computeSha256Hex(new TextEncoder().encode(item.rawUrl))}}};
  f.contents.set('note.md',item.rawUrl);
  f.journal.set(f.renameCheckpointPath(f.plugin),JSON.stringify(job));
  const report=await f.executeRemoteRename(f.plugin,job.request,null,job);
  assert.equal(report.complete,true);assert.equal(report.updatedDocuments,1);assert.equal(report.updatedReferences,1);assert.equal(report.countsUncertain,false);
});


test('Attachment workflows share file rows, distinct-note controls, and native selection inputs',async()=>{
  const opened=[];
  const f=createVaultFixture(undefined,{onModalOpen:modal=>opened.push(modal)});
  f.add('note.md',item.rawUrl);
  const asset={id:'asset-a',name:'old.png',displayPath:'assets/old.png',source:'remote',rawObj:item,size:32,refNotes:['note.md'],selected:true};
  const duplicate=new f.DuplicateWizardModal(f.plugin.app,f.plugin);
  duplicate.step=2;duplicate.groups=[{sha256:item.sha256,size:32,keepId:asset.id,items:[asset,{...asset,id:'asset-b',name:'copy.png'}]}];
  duplicate.render();
  duplicate.contentEl.all().filter(el=>el.className.split(' ').includes('fm-file-row-name'))[1].onclick();
  assert.equal(duplicate.groups[0].keepId,'asset-b');
  const batch=new f.BatchMigrateWizardModal(f.plugin.app,f.plugin);
  batch.step=2;batch.items=[asset];batch.render();
  const orphan=new f.OrphanWizardModal(f.plugin.app,f.plugin);
  orphan.step=2;orphan.results=[asset];orphan.render();
  for(const modal of [duplicate,batch,orphan]){
    const rows=modal.contentEl.all().filter(el=>el.className.split(' ').includes('fm-file-row'));
    assert.ok(rows.length);assert.ok(rows.every(row=>row.all().some(el=>el.tag==='input')));
    assert.ok(rows.every(row=>row.all().some(el=>el.className==='fm-file-row-preview')));
  }
  await tick();
  for(const modal of [duplicate,batch]){
    const reference=modal.contentEl.all().find(el=>el.className==='fm-file-ref-button');
    assert.ok(reference.all().some(el=>el.text==='1 reference(s)'));
    reference.onclick({preventDefault(){},stopPropagation(){}});
    assert.deepEqual(opened.at(-1).refNotePaths,[{path:'note.md',references:1}]);
  }
});

test('Rename uses one selectable editor, locked extension without a premature reference scan',async()=>{
  const opened=[];
  const f=createVaultFixture(undefined,{onModalOpen:modal=>opened.push(modal)});
  const old={...item,filename:'old.png',rawUrl:mappings[0].from};
  f.plugin.fetchRemoteFileList=async()=>[old,{...item,filename:'another.jpg'}];
  f.add('note.md',mappings[0].from+' '+mappings[0].from);
  const modal=new f.RemoteRenameModal(f.plugin.app,f.plugin);await modal.onOpen();
  const rows=[...modal.rowControls.values()];
  assert.ok(rows.every(row=>row.input.readOnly));
  rows[0].radio.onchange();assert.equal(rows[0].input.readOnly,false);
  rows[0].input.value='edited';rows[0].input.oninput();
  rows[1].radio.onchange();assert.equal(rows[0].input.readOnly,true);assert.equal(rows[0].input.value,'old');
  assert.equal(modal.next.disabled,true);
  rows[0].input.onfocus();assert.equal(rows[0].input.value,'edited');assert.equal(rows[0].radio.checked,true);
  assert.ok(!modal.list.all().some(el=>el.className==='fm-file-ref-button'));
  assert.ok(modal.list.all().some(el=>el.className==='fm-file-extension'&&el.text==='.png'));
  modal.onClose();
});

test('Rename suggests a clean stem for duplicated formats but preserves the real source name',async()=>{
  const f=createVaultFixture();
  const old={...item,filename:'IMG_3030.HEIC_043e1854.heic'};
  f.plugin.fetchRemoteFileList=async()=>[old];
  const modal=new f.RemoteRenameModal(f.plugin.app,f.plugin);await modal.onOpen();
  const row=[...modal.rowControls.values()][0];
  assert.equal(row.input.value,'IMG_3030_043e1854');
  assert.equal(row.item.filename,'IMG_3030.HEIC_043e1854.heic');
  assert.equal(modal.next.disabled,true);
  row.input.onfocus();
  assert.equal(modal.next.disabled,false);
  assert.equal(modal.splitName({filename:'report.png.design.png'}).suggestion,'report.png.design');
  assert.equal(modal.splitName({filename:'IMG_3030.HEIC.heic'}).suggestion,'IMG_3030');
  modal.onClose();
});

test('Upload preview shows inline size without duplicating the extension or filename',async()=>{
  const f=createVaultFixture();
  f.add('clip.mp4','video',true);f.add('other.md','![[clip.mp4]]');
  const modal=new f.ActiveNoteActionModal(f.plugin.app,f.plugin,{path:'note.md'},'migrate');
  modal.step='preview';modal.items=[{name:'clip.mp4',displayPath:'clip.mp4',source:'local',size:100,selected:true,otherRefNotes:['other.md']}];
  modal.render();
  const rows=modal.contentEl.all().filter(el=>el.className.split(' ').includes('fm-file-row'));
  assert.equal(rows.length,1);
  assert.equal(rows[0].all().filter(el=>el.text==='clip.mp4').length,1);
  const size=rows[0].all().find(el=>el.className==='fm-file-size');
  assert.ok(size);assert.equal(size.parentElement.className,'fm-file-row-name');
  assert.ok(!rows[0].all().some(el=>el.className==='fm-file-format'));
  const badge=rows[0].all().find(el=>el.className==='fm-file-ref-button');
  await tick();
  assert.ok(badge.all().some(el=>el.text==='1 reference(s) in other notes'));
});

test('Rename preview and results hover-preview affected documents without closing the modal',async()=>{
  const hovered=[];
  class TFile {static [Symbol.hasInstance](file){return !!file?.path;}}
  const f=createVaultFixture(async()=>({status:200,json:response}),{host:{TFile}});
  f.add('note.md',`intro\n${mappings[0].from}`);
  f.plugin.app.workspace.getLeaf=()=>{throw new Error('Preview must not open a leaf');};
  f.plugin.app.workspace.trigger=(name,payload)=>{if(name==='hover-link')hovered.push(payload);};
  f.plugin.fetchRemoteFileList=async()=>[{...item,filename:'old.png'}];
  const modal=new f.RemoteRenameModal(f.plugin.app,f.plugin);await modal.onOpen();
  const row=[...modal.rowControls.values()][0];row.input.value='new';row.input.oninput();await modal.precheck();
  let closed=0;modal.close=()=>{closed++;};
  modal.body.all().find(el=>el.className==='fm-document-preview').dispatch('mouseenter');
  assert.equal(closed,0);assert.equal(hovered[0].linktext,'note.md');assert.deepEqual(hovered[0].state,{scroll:1});
  await modal.execute();
  modal.body.all().find(el=>el.className==='fm-document-preview').dispatch('mouseenter');
  assert.equal(hovered.length,2);assert.equal(hovered[1].linktext,'note.md');
  modal.onClose();
});

test('Health result filters update one list and grouped link previews retain line numbers',async()=>{
  const hovered=[];
  class TFile {static [Symbol.hasInstance](file){return !!file?.path;}}
  const f=createVaultFixture(undefined,{host:{TFile}});
  f.add('note.md','line1\nline2\nline3');
  f.plugin.app.workspace.getLeaf=()=>{throw new Error('Preview must not open a leaf');};
  f.plugin.app.workspace.trigger=(name,payload)=>{if(name==='hover-link')hovered.push(payload);};
  const modal=new f.HealthCheckModal(f.plugin.app,f.plugin);
  modal.step=2;modal.totalDocsScanned=3;modal.issues=[{category:'wikilink',type:'wikilink',sourcePath:'note.md',target:'missing',line:3},{category:'remote',sourcePath:'note.md',target:'https://example.com/missing',line:2}];
  modal.render();
  const filter=modal.contentEl.all().find(el=>el.className==='fm-control-select');
  const list=modal.contentEl.all().find(el=>el.className==='fm-scroll-list fm-document-list');
  assert.equal(list.children.length,1);
  assert.equal(list.all().filter(el=>el.className==='fm-document-preview').length,2);
  filter.value='wikilink';filter.onchange();
  assert.equal(list.children.length,1);
  filter.value='remote';filter.onchange();
  assert.equal(list.children.length,1);
  assert.equal(modal.contentEl.all().filter(el=>el.className==='fm-scroll-list fm-document-list').length,1);
  list.all().find(el=>el.className==='fm-document-preview').dispatch('mouseenter');
  assert.deepEqual(hovered[0].state,{scroll:1});
});
