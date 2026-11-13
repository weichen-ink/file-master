const test=require('node:test'),assert=require('node:assert/strict');
const {createVaultFixture,bytes}=require('./helpers/vault');
const {loadPlugin}=require('./helpers/load-plugin');

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

test('Broken-link scanner ignores CommonMark longer-closing and unclosed fenced code blocks', () => {
  const { scanNoteContentForBrokenLinks } = loadPlugin();
  const vaultIndex = { paths: new Set(['note.md']), names: new Set(['note.md']), basenames: new Set(['note']) };
  const longerFenceDoc = '```\n[[missing-1]]\n````\n';
  assert.deepEqual(scanNoteContentForBrokenLinks('note.md', longerFenceDoc, vaultIndex), []);

  const unclosedFenceDoc = '~~~\n[[missing-2]]\n';
  assert.deepEqual(scanNoteContentForBrokenLinks('note.md', unclosedFenceDoc, vaultIndex), []);

  const outsideDoc = '```\n[[missing-1]]\n```\n[[real-missing]]\n';
  const issues = scanNoteContentForBrokenLinks('note.md', outsideDoc, vaultIndex);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].target, 'real-missing');
  assert.equal(issues[0].line, 4);
});

test('IncomingFileModal refuses to insert into a different or modified note and preserves saved attachment', async () => {
  const { IncomingFileModal } = loadPlugin();
  let currentContent = 'note B text';
  let replaced = false;
  const noteA = { path: 'a.md', extension: 'md', basename: 'a' };
  const noteB = { path: 'b.md', extension: 'md', basename: 'b' };
  const view = { file: noteB, editor: { getValue: () => currentContent } };
  const app = {
    vault: {
      getAbstractFileByPath: (p) => (p === 'a.md' ? noteA : noteB),
      createBinary: async (p) => ({ path: p, name: 'pic.png', extension: 'png' })
    },
    workspace: {
      getLeavesOfType: () => [{ view }],
      getActiveFile: () => noteB
    },
    fileManager: {
      getAvailablePathForAttachment: async (name) => `attachments/${name}`,
      generateMarkdownLink: (f) => `![[${f.path}]]`
    }
  };
  const editor = {
    getValue: () => currentContent,
    getCursor: () => ({ line: 0, ch: 0 }),
    getLine: () => currentContent,
    replaceRange: () => { replaced = true; },
    replaceSelection: () => { replaced = true; }
  };
  const modal = new IncomingFileModal(
    app,
    { defaultBaseName: 'pic', ext: 'png', arrayBuffer: new ArrayBuffer(4), size: 4 },
    {
      plugin: { app, t: (k) => k },
      fixedLocation: 'local',
      askLocation: false,
      editor,
      activeFile: noteA,
      insertionTarget: { view, file: noteA, from: { line: 0, ch: 0 }, to: { line: 0, ch: 0 }, content: 'note A text' }
    }
  );
  modal.finalFilename = 'pic.png';
  modal.targetLocation = 'local';
  modal.render = () => {};
  await modal.runExecution();

  assert.equal(replaced, false);
  assert.equal(modal.result.success, true);
  assert.equal(modal.result.inserted, false);
  assert.ok(modal.result.insertionWarning);
});

test('Broken-link scanner handles CRLF fenced code blocks identically to LF', () => {
  const { scanNoteContentForBrokenLinks } = loadPlugin();
  const vaultIndex = { paths: new Set(['note.md']), names: new Set(['note.md']), basenames: new Set(['note']) };
  const crlfDoc = '```\r\n[[inside]]\r\n```\r\n[[outside]]\r\n';
  const issues = scanNoteContentForBrokenLinks('note.md', crlfDoc, vaultIndex);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].target, 'outside');
  assert.equal(issues[0].line, 4);
});

test('captureEditorTarget binds to the event editor view and insertLinkAtTarget rejects pane reuse with identical text', () => {
  const { captureEditorTarget, insertLinkAtTarget } = loadPlugin();
  const noteA = { path: 'A.md', extension: 'md', basename: 'A' };
  const noteB = { path: 'B.md', extension: 'md', basename: 'B' };
  const noteC = { path: 'C.md', extension: 'md', basename: 'C' };
  let replaced = false;
  const editorA = { getValue: () => 'A text', getCursor: () => ({ line: 0, ch: 0 }), replaceRange: () => { replaced = true; } };
  const editorB = { getValue: () => 'shared text', getCursor: () => ({ line: 0, ch: 0 }), getLine: () => 'shared text', replaceRange: () => { replaced = true; } };
  const viewA = { file: noteA, editor: editorA };
  const viewB = { file: noteB, editor: editorB };
  const plugin = {
    t: (k) => k,
    app: {
      vault: { getAbstractFileByPath: (p) => ({ 'A.md': noteA, 'B.md': noteB, 'C.md': noteC }[p] || null) },
      workspace: {
        getActiveViewOfType: () => viewA,
        getLeavesOfType: () => [{ view: viewA }, { view: viewB }],
        getActiveFile: () => noteA
      }
    }
  };

  // Active pane is A, but event fires in editorB: target must bind to viewB / noteB, never noteA.
  const target = captureEditorTarget(plugin, { editor: editorB });
  assert.equal(target.view, viewB);
  assert.equal(target.file, noteB);

  // Now viewB is reused to display noteC with identical text: insertion must be rejected.
  viewB.file = noteC;
  const res = insertLinkAtTarget(plugin, '![[asset.png]]', target);
  assert.equal(res.inserted, false);
  assert.equal(replaced, false);

  // Unverified view:null target must also be rejected.
  const nullViewRes = insertLinkAtTarget(plugin, '![[asset.png]]', { view: null, file: noteA, editor: editorA, content: 'A text' });
  assert.equal(nullViewRes.inserted, false);
  assert.equal(replaced, false);
});

test('getOrCreateHeicPreviewUrl deduplicates concurrent requests and revokes all generated blob URLs on clear', async () => {
  let blobSeq = 0;
  const revoked = [];
  const { getOrCreateHeicPreviewUrl, clearHeicPreviewCache } = loadPlugin(
    async () => ({ status: 200, arrayBuffer: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer }),
    {
      URL: {
        createObjectURL: () => `blob:fixture-${blobSeq++}`,
        revokeObjectURL: (u) => revoked.push(u)
      },
      Blob: class { constructor(parts) { this.parts = parts; } }
    }
  );
  let reads = 0;
  const tfile = { path: 'pic.heic', stat: { mtime: 100 } };
  const plugin = {
    isUnloading: false,
    heicPreviewCache: new Map(),
    settings: { serverUrl: 'https://example.com', apiToken: 'tok' },
    isRemoteServerReady: () => true,
    getCleanServerUrl: () => 'https://example.com',
    app: {
      vault: {
        readBinary: async () => {
          reads++;
          await new Promise((r) => setTimeout(r, 10));
          return new Uint8Array([0x00, 0x00, 0x00, 0x18]).buffer;
        }
      }
    }
  };

  const [u1, u2] = await Promise.all([
    getOrCreateHeicPreviewUrl(plugin, tfile, 'heic'),
    getOrCreateHeicPreviewUrl(plugin, tfile, 'heic')
  ]);
  assert.equal(reads, 1);
  assert.equal(blobSeq, 1);
  assert.equal(u1, 'blob:fixture-0');
  assert.equal(u2, 'blob:fixture-0');

  clearHeicPreviewCache(plugin);
  assert.deepEqual(revoked, ['blob:fixture-0']);
});

test('RemoteRenameModal reveals Next button when recovering from empty list to non-empty search results', async () => {
  const { RemoteRenameModal, RemoteFilePages } = loadPlugin();
  let remoteItems = [];
  const plugin = {
    t: (k) => k,
    fetchRemoteFilePage: async () => ({items:[...remoteItems],totalCount:remoteItems.length,buckets:[]}),
    app: {
      vault: { getFiles: () => [] },
      loadLocalStorage: () => null,
      saveLocalStorage: () => {}
    }
  };
  const modal = new RemoteRenameModal(plugin.app, plugin);
  modal.items = [];
  modal.pages=new RemoteFilePages(plugin);
  modal.pages.subscribe(state=>{modal.items=state.items;modal.renderList();});
  modal.totalCount = 0;
  modal.fetchSeq = 0;
  modal.search();
  assert.equal(modal.next.hidden, true);

  remoteItems = [{ year: '2026', month: '11', filename: 'photo.png', size: 123 }];
  await modal.reloadRemotePage();
  assert.equal(modal.next.hidden, false);
});
