const test=require('node:test');
const assert=require('node:assert/strict');
const {createVaultFixture}=require('./helpers/vault');
const {Element}=require('./helpers/ui');
const tick=()=>new Promise(setImmediate);
const remote={filename:'new.png',year:'2026',month:'11',rawUrl:'https://example.com/raw/2026/11/new.png',pubUrl:'https://example.com/pub/2026/11/new.webp',referenceUrls:['https://example.com/raw/2026/11/old.png'],size:200};

test('Shared reference counts count occurrences, not notes, without counting path/basename twice',async()=>{
  const f=createVaultFixture();
  const file=f.add('assets/picture one.png','image',true);
  f.add('one.md','![[assets/picture one.png]] ![](assets/picture%20one.png)');
  f.add('two.canvas',JSON.stringify({nodes:[{type:'file',file:'assets/picture one.png'}]}));
  f.add('foreign.md','![](https://foreign.example/assets/picture%20one.png)');
  const documents=await f.fileReferenceDocuments(f.plugin,{source:'local',rawObj:file});
  assert.deepEqual(documents,[{path:'one.md',references:2},{path:'two.canvas',references:1}]);
  f.add('web.md',`${remote.rawUrl} ${remote.pubUrl} ${remote.referenceUrls[0]} https://foreign.example/raw/2026/11/new.png ${remote.rawUrl}.bak`);
  assert.deepEqual(await f.fileReferenceDocuments(f.plugin,{source:'remote',rawObj:remote}),[{path:'web.md',references:3}]);
});

test('Every reference button uses the same count and note inspection model, including zero and unavailable',async()=>{
  const opened=[];
  const f=createVaultFixture(undefined,{onModalOpen:modal=>opened.push(modal)});
  f.add('note.md',`${remote.rawUrl} ${remote.rawUrl}`);
  const item={name:remote.filename,source:'remote',rawObj:remote};
  const refs=f.fileReferenceButton(new Element(),item,f.plugin,['note.md']);
  await tick();
  assert.ok(refs.button.all().some(el=>el.text==='2 reference(s)'));
  refs.button.onclick({preventDefault(){},stopPropagation(){}});
  assert.deepEqual(opened[0].refNotePaths,[{path:'note.md',references:2}]);
  await refs.update([]);
  assert.ok(refs.button.disabled);assert.ok(refs.button.all().some(el=>el.text==='0 reference(s)'));
  assert.ok(!refs.button.all().some(el=>el.className==='fm-indicator-icon'));
  await refs.update(['missing.md']);
  assert.ok(refs.button.all().some(el=>el.text==='Reference count unavailable'));
  await refs.update([{path:'note.md',references:2}]);
  assert.ok(refs.button.all().some(el=>el.text==='2 reference(s)'));
});

test('Hover previews in shared note rows never navigate or dismiss the current workflow',()=>{
  const f=createVaultFixture();let closed=0;const events=[];
  f.plugin.app.workspace.trigger=(name,payload)=>events.push({name,payload});
  f.plugin.app.workspace.getLeaf=()=>{throw new Error('Hover must not navigate');};
  const owner={hoverPopover:null};
  const {content,preview}=f.documentRow(new Element(),f.plugin,{path:'notes/Example.md',references:2,line:9},{hoverParent:owner});
  const name=content.children[0],event={clientX:10,clientY:20};
  name.dispatch('mouseenter',event);preview.dispatch('mouseenter',event);
  assert.equal(closed,0);assert.equal(events.length,2);
  const hoverEl=new Element();events[0].payload.hoverParent.hoverPopover={hoverEl};
  assert.ok(hoverEl.className.includes('fm-note-hover'));
  for(const entry of events){assert.equal(entry.name,'hover-link');assert.deepEqual(entry.payload.state,{scroll:8});assert.equal(entry.payload.source,'file-master');assert.equal(entry.payload.linktext,'notes/Example.md');assert.equal(entry.payload.hoverParent,events[0].payload.hoverParent);}
});

test('Analytics uses actual aliases and shared counts instead of a filename substring status',async()=>{
  const f=createVaultFixture();f.plugin.app.vault.getResourcePath=file=>'app://'+file.path;
  f.add('assets/clip.mp4','video',true);
  f.add('note.md',`![[assets/clip.mp4]] ![[assets/clip.mp4]] ${remote.referenceUrls[0]}`);
  f.add('unrelated.md','new.png is a plain filename mention');
  f.plugin.fetchRemoteFileList=async()=>[remote];
  const stats=await f.analytics.scanVaultAnalytics(f.plugin);
  assert.deepEqual(stats.topLargestAttachments.find(item=>item.source==='local').referenceDocuments,[{path:'note.md',references:2}]);
  assert.deepEqual(stats.topLargestAttachments.find(item=>item.source==='remote').referenceDocuments,[{path:'note.md',references:1}]);
  const modal=new f.VaultAnalyticsModal(f.plugin.app,f.plugin);modal.stats=stats;
  modal.renderDashboard(modal.contentEl);await tick();
  const controls=modal.contentEl.all().filter(el=>el.className==='fm-file-ref-button');
  assert.equal(controls.length,2);
  assert.ok(controls.some(el=>el.all().some(child=>child.text==='2 reference(s)')));
  assert.ok(controls.some(el=>el.all().some(child=>child.text==='1 reference(s)')));
  assert.ok(!modal.contentEl.all().some(el=>['[Referenced]','[Unreferenced]'].includes(el.text)));
});

test('Rename review and completion have different states and show the server retention deadline',()=>{
  const f=createVaultFixture();f.plugin.settings.language='zh';
  const modal=new f.RemoteRenameModal(f.plugin.app,f.plugin);
  const expiry=Date.now()+7*86400000;
  const item={...remote,filename:'new.png'},old={...remote,filename:'old.png'};
  const result={item,aliasRetentionDays:7,aliasExpiresAt:expiry};
  modal.selected=old;modal.preview={request:{newFilename:'new.png'},preview:{oldItem:old,...result},references:{documents:[{path:'note.md',references:3}],references:3}};
  modal.review();
  const texts=modal.body.all().map(el=>el.text).filter(Boolean);
  assert.ok(texts.includes('以下 1 篇笔记中的链接将自动更新'));
  assert.ok(texts.includes('将更新 3 处链接'));
  assert.ok(texts.some(text=>text.includes('旧链接还可使用 7 天')&&text.includes('博客')));
  modal.result({complete:true,item,oldFilename:'old.png',updatedDocuments:1,updatedReferences:3,documents:[{path:'note.md',references:3}],remaining:[],failures:[],job:{result}});
  const completed=modal.body.all();
  assert.ok(completed.some(el=>el.text==='文件已改名'));
  assert.ok(completed.some(el=>el.text==='已自动更新 1 篇笔记中的 3 处链接'));
  assert.ok(completed.some(el=>el.text==='已更新 3 处链接'));
  assert.ok(completed.some(el=>el.text==='原名：old.png'));
  assert.ok(!completed.some(el=>el.className==='fm-rename-names'));
  assert.ok(!modal.modalEl.all().some(el=>el.className==='fm-module-heading-step'));
  modal.result({complete:false,item,oldFilename:'old.png',updatedDocuments:0,updatedReferences:0,documents:[],remaining:[{path:'pending.md',references:1}],failures:[],job:{result}});
  assert.ok(modal.body.all().some(el=>el.text==='以下 1 篇笔记仍需更新'));
  assert.ok(modal.footer.all().some(el=>el.text==='继续更新引用'));
});

 test('Health results distinguish the source note, line, missing target and HTTP status',()=>{
  const f=createVaultFixture();f.plugin.settings.language='zh';
  const modal=new f.HealthCheckModal(f.plugin.app,f.plugin);
  modal.step=2;modal.issues=[{category:'wikilink',type:'wikilink',sourcePath:'未命名 1.md',target:'测试',line:3},{category:'remote',sourcePath:'旅行.md',target:'https://example.com/photo.png',line:5,reason:'Remote resource returned HTTP 404'}];
  modal.render();const text=modal.contentEl.all().map(el=>el.text);
  assert.ok(!text.includes('所在笔记：'));
  for(const expected of ['未命名 1.md','第 3 行','找不到笔记：','测试','预览','无法访问链接：','HTTP 404']) assert.ok(text.includes(expected),expected);
});

test('Reference dialogs explain hover previews, and unlocated notes do not receive an invented line',()=>{
  const f=createVaultFixture();f.plugin.settings.language='zh';const events=[];
  f.plugin.app.workspace.trigger=(name,payload)=>events.push(payload);
  const modal=new f.NoteRefsModal(f.plugin.app,'image.png',[{path:'note.md',references:2}],null,f.plugin);modal.onOpen();
  assert.ok(modal.contentEl.all().some(el=>el.text==='悬浮在笔记名或预览按钮上可预览内容。'));
  modal.contentEl.all().find(el=>el.className.includes('fm-document-name')).dispatch('mouseenter');
  assert.equal(events[0].state,undefined);
  const row=f.documentRow(new Element(),f.plugin,{path:'drawing.canvas',line:5});row.preview.dispatch('mouseenter');
  assert.equal(events[1].state,undefined);
});

test('Completed and stopped uploads keep one headline without hiding failure details or retry actions',()=>{
  const f=createVaultFixture();f.plugin.settings.language='zh';
  const active=new f.ActiveNoteActionModal(f.plugin.app,f.plugin,{path:'note.md'});
  active.step='result';active.result={success:true,count:2,processedItems:[]};active.render();
  let banner=active.contentEl.all().find(el=>el.className==='fm-result-banner fm-result-banner-success');
  assert.deepEqual(banner.children.map(el=>el.text),['成功上传 2 个附件']);
  active.result.cancelled=true;active.render();
  assert.equal(active.contentEl.all().filter(el=>el.text===f.plugin.t('transferCancelled')).length,1);
  const batch=new f.BatchMigrateWizardModal(f.plugin.app,f.plugin);batch.step=3;
  batch.summary={count:2,docs:1,processedItems:[],failures:[],trashFailures:[]};batch.render();
  banner=batch.contentEl.all().find(el=>el.className==='fm-result-banner fm-result-banner-success');
  assert.deepEqual(banner.children.map(el=>el.text),['成功上传 2 个附件']);
  batch.summary={...batch.summary,cancelled:true,failures:[{name:'failed.png',error:'upload failed'}],trashFailures:[{path:'kept.png',error:'trash failed'}],retryItems:[{}]};batch.render();
  const texts=batch.contentEl.all().map(el=>el.text).filter(Boolean);
  assert.equal(texts.filter(text=>text===f.plugin.t('transferCancelled')).length,1);
  assert.ok(texts.some(text=>text.includes('failed.png')&&text.includes('upload failed')));
  assert.ok(texts.some(text=>text.includes('kept.png')&&text.includes('trash failed')));
  assert.ok(texts.includes(f.plugin.t('transferRetry')));
});

test('Empty scan pages give one explanation, remove result-only controls, and allow rescanning',()=>{
  const f=createVaultFixture();f.plugin.settings.language='zh';
  for(const [Modal,message] of [[f.DuplicateWizardModal,'dupNoneFound'],[f.OrphanWizardModal,'orphanNoneFound'],[f.BatchMigrateWizardModal,'migrateNoneFound'],[f.HealthCheckModal,'healthNoneFound']]) {
    const modal=new Modal(f.plugin.app,f.plugin);modal.step=2;modal.render();
    const elements=modal.contentEl.all();
    assert.equal(elements.filter(el=>el.text===f.plugin.t(message)).length,1);
    assert.ok(!elements.some(el=>el.className.includes('fm-toolbar-row')||el.className.includes('fm-module-summary')));
    assert.ok(!modal.modalEl.all().some(el=>el.className==='fm-module-heading-step'));
    const retry=elements.find(el=>el.text===f.plugin.t(Modal===f.HealthCheckModal?'healthRescan':'scanChooseScopeAgain'));
    assert.ok(retry);retry.onclick();assert.equal(modal.step,1);
  }
});

test('Preview protection exposes its state, blocks trash while locked, and recovers from server errors',async()=>{
  const f=createVaultFixture();f.plugin.settings.language='zh';const calls=[];
  f.plugin.app.workspace.getActiveViewOfType=()=>null;
  f.plugin.toggleRemoteFileLock=async(...args)=>calls.push(args);
  const remoteFile={...remote,filename:'Guide.pdf',locked:true,createdAt:Date.now()};
  const modal=new f.ImageLightboxModal(f.plugin.app,f.plugin,{source:'remote',name:'Guide.pdf',size:200,rawObj:remoteFile});modal.onOpen();
  const lock=modal.contentEl.all().find(el=>el.role==='switch');
  const trash=modal.contentEl.all().find(el=>el.className==='fm-asset-trash-action');
  assert.equal(lock['aria-checked'],'true');assert.equal(trash.disabled,true);
  await lock.onclick();assert.equal(lock['aria-checked'],'false');assert.equal(trash.disabled,false);assert.equal(calls[0][3],false);
  f.plugin.toggleRemoteFileLock=async()=>{throw Error('offline');};await lock.onclick();
  assert.equal(remoteFile.locked,false);assert.equal(lock['aria-checked'],'false');assert.equal(lock.disabled,false);assert.equal(trash.disabled,false);
  const text=modal.contentEl.all().map(el=>el.text);assert.ok(text.includes('原文件大小'));assert.ok(text.some(value=>value?.includes('回收站')));
});

test('Shared documentRow renders Level-1 note and Level-2 link preview buttons with per-line hover state',async()=>{
  const f=createVaultFixture();f.plugin.settings.language='zh';const events=[];
  f.plugin.app.workspace.trigger=(name,payload)=>events.push({name,payload});
  f.add('guide.md',`line 1\n![a](${remote.rawUrl})\nline 3\n![b](${remote.pubUrl})`);
  const plan=await f.scanRenameReferences(f.plugin,[{from:remote.rawUrl,to:'https://example.com/new.png'},{from:remote.pubUrl,to:'https://example.com/p/new.png'}]);
  assert.equal(plan.documents.length,1);
  assert.deepEqual(plan.documents[0].links,[{line:2,target:remote.rawUrl},{line:4,target:remote.pubUrl}]);
  const {row,linksEl}=f.documentRow(new Element(),f.plugin,plan.documents[0],{referenceState:'renameReferencesPlanned'});
  const buttons=linksEl.all().filter(el=>el.className==='fm-document-preview');
  assert.equal(buttons.length,2);
  buttons[0].dispatch('mouseenter');buttons[1].dispatch('mouseenter');
  assert.deepEqual(events.map(e=>e.payload.state),[{scroll:1},{scroll:3}]);
  assert.ok(row.all().some(el=>el.text==='guide.md'));
});
