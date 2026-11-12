const test=require('node:test'),assert=require('node:assert/strict');
const {createVaultFixture,bytes}=require('./helpers/vault');

test('Obsidian documents share classification and Bases are excluded from default orphan cleanup',async()=>{
  const f=createVaultFixture();
  for(const ext of ['md','canvas','base','excalidraw'])assert.equal(f.getFileTypeGroup(ext),'note');
  f.add('library.base','filters:\n  and: []');f.add('attachments/unused.png','same',true);
  const found=await f.scans.scanUnusedFiles(f.plugin,{scanLocal:true,scanRemote:false,typeImage:true,typeAudio:true,typeOther:true,typeNote:false});
  assert.deepEqual(found.map(item=>item.name),['unused.png']);
});
test('New settings and empty-address fallback use port 3210 without changing saved addresses',()=>{
  const f=createVaultFixture();assert.equal(f.DEFAULT_SETTINGS.serverUrl,'http://localhost:3210');
  f.plugin.settings.serverUrl='';assert.equal(f.plugin.getCleanServerUrl(),'http://localhost:3210');
  f.plugin.settings.serverUrl='http://localhost:3000/';assert.equal(f.plugin.getCleanServerUrl(),'http://localhost:3000');
});
for(const changed of ['keep','remove'])test(`Changed ${changed} attachment is retained and references stay untouched`,async()=>{
  const f=createVaultFixture(),keep=f.add('assets/keep.png','same',true),remove=f.add('assets/remove.png','same',true);
  f.add('note.md','![[assets/remove.png]]');
  const scan=await f.scans.scanDuplicateGroups(f.plugin,'local',{typeImage:true});scan.groups[0].keepId='local:'+keep.path;
  f.binaries.set(changed==='keep'?keep.path:remove.path,bytes('changed-after-scan'));
  let result;await f.attachmentOps.executeDuplicateMergeSafely(f.plugin,scan.groups,summary=>{result=summary;});
  assert.deepEqual(f.trashed,[]);assert.equal(f.contents.get('note.md'),'![[assets/remove.png]]');assert.equal(result.skipped,1);
});
test('Ambiguous bare links block deletion when same-named files cannot be resolved',async()=>{
  const f=createVaultFixture(),keep=f.add('a/photo.png','same',true);f.add('b/photo.png','same',true);f.add('note.md','![[photo.png]]');
  f.plugin.app.metadataCache.getFirstLinkpathDest=()=>null;
  const scan=await f.scans.scanDuplicateGroups(f.plugin,'local',{typeImage:true});scan.groups[0].keepId='local:'+keep.path;
  let result;await f.attachmentOps.executeDuplicateMergeSafely(f.plugin,scan.groups,summary=>{result=summary;});
  assert.deepEqual(f.trashed,[]);assert.equal(f.contents.get('note.md'),'![[photo.png]]');assert.equal(result.skipped,1);
});
test('Duplicate rewriting uses exact URLs, preserves suffixes, queries and unrelated hosts',()=>{
  const f=createVaultFixture();
  const remote=name=>({source:'remote',name,ext:'png',displayPath:'2026/11/'+name,rawObj:{year:'2026',month:'11',filename:name,
    rawUrl:'https://example.com/raw/2026/11/'+name,pubUrl:'https://example.com/pub/2026/11/'+name+'.webp'}});
  const from=remote('a.png'),to=remote('b.png');
  const content='![](https://example.com/raw/2026/11/a.png?download=1) https://example.com/raw/2026/11/a.png.bak https://other.example/raw/2026/11/a.png';
  assert.equal(f.plugin.rewriteContentLinks(content,from,to,'note.md'),content.replace('a.png?','b.png?'));
  const canvas=JSON.stringify({nodes:[{type:'text',text:content}]});
  assert.equal(f.plugin.rewriteContentLinks(canvas,from,to,'board.canvas'),canvas.replace('a.png?','b.png?'));
});
test('Remote deletion sends its expected full hash through the public plugin method and surfaces precondition failures',async()=>{
  const calls=[];let status=200;
  const f=createVaultFixture(async request=>{calls.push(request);return {status,json:{error:'Attachment changed'}};});
  const sha='a'.repeat(64);await f.plugin.deleteRemoteFile('2026','11','photo.png',sha);
  assert.equal(calls[0].headers['If-Match'],'"'+sha+'"');assert.equal(calls[0].method,'DELETE');
  status=412;await assert.rejects(f.plugin.deleteRemoteFile('2026','11','photo.png',sha),/Attachment changed/);
});
test('A remote attachment changed during confirmation is retained before any note rewrite',async()=>{
  let changed=false;const original=bytes('same');
  const f=createVaultFixture(async()=>({status:200,arrayBuffer:changed?bytes('different'):original}),{onModalOpen:modal=>{changed=true;modal.onConfirm(true);}});
  const keep=f.add('assets/keep.png','same',true);f.add('note.md','![](https://example.com/raw/2026/11/remote.png)');
  const sha=await f.computeSha256Hex(original);
  const local={id:'local:'+keep.path,source:'local',name:keep.name,displayPath:keep.path,rawObj:keep};
  const remote={id:'remote:2026/11/remote.png',source:'remote',name:'remote.png',displayPath:'2026/11/remote.png',rawObj:{year:'2026',month:'11',filename:'remote.png',rawUrl:'https://example.com/raw/2026/11/remote.png'}};
  let deletes=0;f.plugin.deleteRemoteFile=async()=>{deletes++;};
  await f.attachmentOps.executeDuplicateMergeSafely(f.plugin,[{sha256:sha,items:[local,remote],keepId:local.id}]);
  assert.equal(deletes,0);assert.equal(f.contents.get('note.md'),'![](https://example.com/raw/2026/11/remote.png)');
});
