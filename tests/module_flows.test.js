const test = require('node:test');
const assert = require('node:assert/strict');
const { createVaultFixture, bytes } = require('./helpers/vault');
const { loadPlugin } = require('./helpers/load-plugin');

const options = { scanLocal: true, scanRemote: true, typeImage: true, typeAudio: true, typeOther: true };
const remote = (filename, extra = {}) => ({ year: '2026', month: '11', filename,
  rawUrl: `https://example.com/raw/2026/11/${filename}`, size: 1, ...extra });

test('Orphan scan combines local/remote references and respects exclusions and locks', async () => {
  const f = createVaultFixture();
  f.plugin.settings.excludedLocalFolders = 'private';
  f.plugin.settings.excludeLockedRemoteFiles = true;
  f.add('assets/used.png', 'U', true); f.add('assets/orphan.png', 'O', true);
  f.add('private/hidden.png', 'H', true);
  f.add('note.md', '![[assets/used.png]] ![](https://example.com/raw/2026/11/used-remote.png)');
  f.plugin.fetchRemoteFileList = async () => [remote('used-remote.png'), remote('orphan-remote.png'), remote('locked.png', { locked: true })];
  const result = await f.scans.scanUnusedFiles(f.plugin, options);
  assert.deepEqual(result.map((item) => item.name).sort(), ['orphan-remote.png', 'orphan.png']);
});

test('Orphan cleanup rechecks references and retains an item referenced after the initial scan', async () => {
  const f = createVaultFixture();
  const asset = f.add('assets/orphan.png', 'A', true);
  const note = f.add('note.md', 'plain note');
  const items = await f.scans.scanUnusedFiles(f.plugin, { ...options, scanRemote: false });
  assert.equal(items.length, 1);
  f.contents.set(note.path, '![[assets/orphan.png]]');
  let summary;
  await f.scans.cleanSelectedOrphans(f.plugin, items, (result) => { summary = result; });
  assert.deepEqual(f.trashed, []); assert.equal(summary.skipped, 1);
  f.contents.set(note.path, 'plain note');
  await f.scans.cleanSelectedOrphans(f.plugin, items, (result) => { summary = result; });
  assert.deepEqual(f.trashed, [asset.path]); assert.equal(summary.total, 1);
});

test('Duplicate scan hashes content and distinguishes same-size files across local and remote storage', async () => {
  const f = createVaultFixture();
  f.add('assets/a.png', 'A', true); f.add('assets/twin.png', 'A', true); f.add('assets/different.png', 'B', true);
  const sha256 = await f.computeSha256Hex(bytes('A'));
  f.plugin.fetchRemoteFileList = async () => [remote('a.png', { sha256, locked: true })];
  const result = await f.scans.scanDuplicateGroups(f.plugin, 'both', { typeImage: true });
  assert.equal(result.groups.length, 1); assert.equal(result.groups[0].items.length, 3);
  assert.ok(result.groups[0].items.some((item) => item.source === 'remote' && item.locked));
  assert.ok(result.groups[0].items.every((item) => item.name !== 'different.png'));
});

test('Local duplicate merge rewrites Markdown/Excalidraw references before moving the redundant file to trash', async () => {
  const f = createVaultFixture();
  const keep = f.add('assets/keep.png', 'same', true), remove = f.add('assets/remove.png', 'same', true);
  f.add('note.md', '![[assets/remove.png]]');
  f.add('drawing.excalidraw.md', '---\nexcalidraw-plugin: parsed\n---\n## Embedded Files\nimage-id: [[assets/remove.png]]\n%%');
  const scanned = await f.scans.scanDuplicateGroups(f.plugin, 'local', { typeImage: true });
  scanned.groups[0].keepId = `local:${keep.path}`;
  let result;
  await f.attachmentOps.executeDuplicateMergeSafely(f.plugin, scanned.groups, (summary) => { result = summary; });
  assert.equal(result.local, 1); assert.deepEqual(f.trashed, [remove.path]);
  assert.ok(f.contents.get('note.md').includes('keep.png'));
  assert.ok(f.contents.get('drawing.excalidraw.md').includes('keep.png'));
  assert.ok(!f.contents.get('drawing.excalidraw.md').includes('remove.png'));
});

test('Cancelled scans reject rather than reporting partial findings as completed results', async () => {
  const f = createVaultFixture(); f.add('note.md', 'note');
  const controller = new AbortController(); controller.abort();
  for (const operation of [
    () => f.scans.scanUnusedFiles(f.plugin, options, { signal: controller.signal }),
    () => f.scans.scanDuplicateGroups(f.plugin, 'local', null, { signal: controller.signal }),
    () => f.analytics.scanVaultLinkHealth(f.plugin, {}, { signal: controller.signal })
  ]) await assert.rejects(operation(), /SCAN_ABORTED/);
});

test('Health scan checks Markdown and Canvas targets and confirms remote failures by HTTP', async () => {
  const requested = [];
  const f = createVaultFixture(async ({ url, method }) => { requested.push([url, method]); return { status: 404 }; });
  f.add('note.md', '![[missing.png]] ![](https://example.com/missing.png)');
  f.add('board.canvas', JSON.stringify({ nodes: [{ type: 'file', file: 'missing-pdf.pdf' }] }));
  const result = await f.analytics.scanVaultLinkHealth(f.plugin, { checkRemote: true });
  assert.ok(result.issues.some((issue) => issue.category === 'remote'));
  assert.ok(result.issues.some((issue) => issue.target === 'missing.png'));
  assert.ok(result.issues.some((issue) => issue.type === 'canvas-node'));
  assert.ok(requested.some(([url, method]) => url.endsWith('missing.png') && method === 'HEAD'));
});

test('Statistics and reports work offline in Chinese and English without treating reports as notes', async () => {
  const f = createVaultFixture();
  f.add('note.md', '# Title\nHello 世界 ![[assets/a.png]]'); f.add('assets/a.png', 'A', true);
  f.add('Vault_Analytics_Report_2026-01-01.md', 'generated report should not count as a note');
  f.plugin.fetchRemoteFileList = async () => { throw new Error('offline'); };
  const stats = await f.analytics.scanVaultAnalytics(f.plugin);
  assert.equal(stats.noteCount, 1);
  const reports = new Map();
  f.plugin.writeOrUpdateRootReport = async (name, text) => reports.set(name, text);
  for (const language of ['zh', 'en']) {
    f.plugin.settings.language = language;
    await f.analytics.exportAnalyticsReportToRoot(f.plugin, stats);
    await f.scans.exportOrphanReportToRoot(f.plugin, []);
    await f.scans.exportDuplicateReportToRoot(f.plugin, []);
    assert.ok([...reports.values()].every((text) => !text.includes('undefined') && !text.includes('[object Object]')));
    assert.ok([...reports.values()].some((text) => text.includes(language === 'zh' ? '知识库报告' : 'Vault report')));
  }
});

for (const scenario of [
  { name: 'compatible', version: '1.2.8', code: 200, token: 'test', expected: true },
  { name: 'compatible', version: '1.3.0', code: 200, token: 'test', expected: true },
  { name: 'server_outdated', version: '1.2.7', code: 200, token: 'test', expected: false },
  { name: 'plugin_outdated', version: '1.2.8', pluginVersion: '1.2.8', code: 200, token: 'test', expected: false },
  { name: 'token_missing', version: '1.2.8', code: 200, token: '', expected: false },
  { name: 'auth_failed', version: '1.2.8', code: 401, token: 'bad', expected: false },
  { name: 'server_error', version: '1.2.8', code: 503, token: 'test', expected: false }
]) {
  test(`Server handshake persists the correct readiness for ${scenario.name}`, async () => {
    const loaded = loadPlugin(async ({ url }) => url.endsWith('/version')
      ? { status: 200, json: { version: scenario.version, minPluginVersion: scenario.minPluginVersion || '1.2.9' } }
      : { status: scenario.code, json: { images: [] } });
    const plugin = new loaded.Plugin({}); plugin.manifest = { version: scenario.pluginVersion || '1.2.9' };
    plugin.settings = { enableRemoteServer: true, serverUrl: 'https://example.com', apiToken: scenario.token };
    let saved; plugin.saveData = async (settings) => { saved = { ...settings }; };
    const result = await loaded.serverClient.checkServerCompatibility(plugin);
    assert.equal(result.status, scenario.name); assert.equal(result.ok, scenario.expected);
    assert.equal(saved.serverVerified, scenario.expected);
  });
}

test('Upload checkpoint recovery uses existing files and rejects switching to another server', async () => {
  const opened = [];
  const f = createVaultFixture(undefined, { onModalOpen: (modal) => opened.push(modal) });
  f.plugin.settings.enableRemoteServer = true; f.plugin.settings.serverVerified = true;
  f.add('assets/pending.png', 'A', true);
  const checkpoint = { serverUrl: 'https://example.com', options: {}, items: [{ path: 'assets/pending.png' }, { path: 'removed.png' }] };
  f.journal.set(f.migrationCheckpointPath(f.plugin), JSON.stringify(checkpoint));
  await f.attachmentOps.resumePendingMigration(f.plugin);
  assert.equal(opened.length, 1); assert.equal(opened[0].items.length, 1);
  checkpoint.serverUrl = 'https://another.invalid';
  f.journal.set(f.migrationCheckpointPath(f.plugin), JSON.stringify(checkpoint));
  await assert.rejects(f.attachmentOps.resumePendingMigration(f.plugin), /server|服务器/i);
});

test('Compatibility rejects unknown apiVersion and preflight blocks unsupported remote extensions', async () => {
  const loaded = loadPlugin(() => ({ status: 200, json: { version: '2.0.0', minPluginVersion: '1.1', apiVersion: 2 } }));
  const plugin = new loaded.Plugin({}); plugin.manifest = { version: '1.2.3' };
  plugin.settings = { enableRemoteServer: true, serverUrl: 'https://example.com', apiToken: 'tok' };
  let saved; plugin.saveData = async (s) => { saved = { ...s }; };
  const res = await loaded.serverClient.checkServerCompatibility(plugin);
  assert.equal(res.ok, false);
  assert.equal(res.status, 'api_incompatible');
  assert.equal(saved.serverVerified, false);

  assert.equal(loaded.serverClient.isSupportedRemoteExtension('page.html'), false);
  for (const name of ['photo.png', 'photo.jfif', 'report.wps', 'invoice.ofd', 'design.psd', 'plan.dwg']) {
    assert.equal(loaded.serverClient.isSupportedRemoteExtension(name), true, name);
  }
  await assert.rejects(
    loaded.serverClient.uploadBufferToServer(plugin, new Uint8Array([1, 2, 3]).buffer, 'page.html'),
    /Unsupported remote file extension/
  );

  const opened = [];
  const modalLoaded = loadPlugin(() => ({ status: 200, json: {} }), { onModalOpen: (m) => opened.push(m) });
  const modalPlugin = new modalLoaded.Plugin({});
  modalPlugin.settings = { enableRemoteServer: true, serverVerified: true, saveLocationMode: 'remote', namingMode: 'keep', serverUrl: 'https://example.com', apiToken: 'tok' };
  modalPlugin.lastServerCompatStatus = { ok: true, supportedExtensions: ['.png'] };
  modalPlugin.app = { workspace: { getActiveFile: () => null }, vault: { getAbstractFileByPath: () => null } };
  await modalLoaded.serverClient.handleIncomingBrowserFile(modalPlugin, {
    name: 'image',
    type: 'image/png',
    size: 3,
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer
  });
  assert.equal(opened.length, 1);

  let readCalled = false;
  await assert.rejects(
    modalLoaded.serverClient.handleIncomingBrowserFile(modalPlugin, {
      name: 'page',
      type: 'text/html',
      size: 3,
      arrayBuffer: async () => { readCalled = true; return new Uint8Array([1, 2, 3]).buffer; }
    }),
    /Unsupported remote file extension/
  );
  assert.equal(readCalled, false);
});

test('Resuming pending upload from Hub returns to Hub on cancel, supports discarding task, and cleans up stale checkpoints', async () => {
  const f = createVaultFixture();
  f.plugin.settings.enableRemoteServer = true;
  f.plugin.settings.serverVerified = true;
  f.plugin.settings.language = 'zh';
  f.plugin.manifest = { id: 'file-master', version: '1.2.9' };
  f.plugin.isRemoteServerReady = () => true;
  f.plugin.checkUploadConflicts = async () => [];
  f.add('assets/pending.png', 'A', true);
  const checkpointPath = f.migrationCheckpointPath(f.plugin);
  const checkpoint = { serverUrl: 'https://example.com', options: {}, items: [{ path: 'assets/pending.png' }] };
  f.journal.set(checkpointPath, JSON.stringify(checkpoint));

  f.plugin.app.workspace.getActiveFile = () => null;
  f.plugin.app.vault.getResourcePath = (file) => file.path;
  const hub = new f.FileMasterHubModal(f.plugin.app, f.plugin);
  hub.contentEl.isConnected = true;
  let hubClosed = false;
  hub.close = () => { hubClosed = true; };
  hub.onOpen({ skipHandshake: true });
  await hub.refreshTasks();

  const nodeText = (node) => {
    if (!node) return '';
    return String(node.text || node.textContent || '') + (Array.isArray(node.children) ? node.children.map(nodeText).join('') : '');
  };
  const findButton = (root, text) => {
    const stack = [root];
    while (stack.length) {
      const node = stack.shift();
      if (!node) continue;
      if (node.tag === 'button' && nodeText(node).includes(text)) return node;
      if (Array.isArray(node.children)) stack.push(...node.children);
    }
    return null;
  };

  const resumeCard = findButton(hub.contentEl, '恢复未完成的上传任务');
  assert.ok(resumeCard, 'Hub should show the pending upload task card');
  await resumeCard.onclick({ preventDefault() {}, stopPropagation() {} });
  assert.equal(hubClosed, false, 'Opening pending upload from Hub must not close Hub');
  assert.ok(hub.navigator.child, 'Resumed wizard should be mounted inside Hub');
  assert.equal(hub.navigator.child.fromHub, true);
  assert.equal(hub.navigator.child.isResumed, true);

  // Cancel returns to Hub without deleting checkpoint
  const cancelBtn = findButton(hub.navigator.child.contentEl, '取消');
  assert.ok(cancelBtn);
  cancelBtn.onclick();
  assert.equal(hubClosed, false);
  assert.equal(hub.navigator.child, null, 'Cancel should return to Hub home');
  assert.equal(hub.navigator.home.hidden, false);
  assert.equal(f.journal.has(checkpointPath), true, 'Cancel should preserve checkpoint');

  // Re-enter and click Discard task -> deletes checkpoint, returns to Hub, hides task card
  await hub.refreshTasks();
  const resumeCardAgain = findButton(hub.contentEl, '恢复未完成的上传任务');
  assert.ok(resumeCardAgain);
  await resumeCardAgain.onclick({ preventDefault() {}, stopPropagation() {} });
  const discardBtn = findButton(hub.navigator.child.contentEl, '放弃任务');
  assert.ok(discardBtn, 'Resumed wizard should offer a discard task button');
  await discardBtn.onclick();
  assert.equal(f.journal.has(checkpointPath), false, 'Discard should delete checkpoint');
  assert.equal(hub.navigator.child, null, 'Discard should return to Hub');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(findButton(hub.contentEl, '恢复未完成的上传任务'), null, 'Hub should hide task card after discard');

  // Stale checkpoint whose files no longer exist is auto-removed on resume
  f.journal.set(checkpointPath, JSON.stringify({ serverUrl: 'https://example.com', options: {}, items: [{ path: 'missing.png' }] }));
  const res = await f.attachmentOps.resumePendingMigration(f.plugin);
  assert.equal(res, false);
  assert.equal(f.journal.has(checkpointPath), false, 'Stale checkpoint with no existing files should be removed');
});

test('Folder include and exclude scopes filter candidates across all four scan engines while preserving full-vault references', async () => {
  const f = createVaultFixture();
  f.plugin.settings.excludedLocalFolders = '';
  f.plugin.settings.uploadNonImageAttachments = true;
  f.plugin.checkUploadConflicts = async () => [];

  // Vault layout:
  // - work/a.png (referenced ONLY from excluded diary/2022/03/day.md)
  // - work/unused.png (unreferenced)
  // - work/archive/old.png (unreferenced, inside excluded subfolder)
  // - work/dup1.png & work/dup2.png (identical bytes)
  // - other/dup3.png (identical bytes, outside include scope)
  // - diary/2022/03/day.md (references work/a.png and broken [[missing-in-diary]])
  // - work/note.md (references other/dup3.png [valid outside scope] and [[missing-in-work]])
  f.add('work/a.png', 'unique-a', true);
  f.add('work/unused.png', 'unique-unused', true);
  f.add('work/archive/old.png', 'unique-old', true);
  f.add('work/dup1.png', 'same-dup-bytes', true);
  f.add('work/dup2.png', 'same-dup-bytes', true);
  f.add('other/dup3.png', 'same-dup-bytes', true);
  f.add('diary/2022/03/day.md', '![[work/a.png]] [[missing-in-diary]]');
  f.add('work/note.md', '![[other/dup3.png]] [[missing-in-work]]');

  // 0. Ancestor folders are exposed for easy selection
  const allFolders = f.getAllVaultFolderPaths(f.plugin.app);
  assert.ok(allFolders.includes('diary'));
  assert.ok(allFolders.includes('diary/2022'));
  assert.ok(allFolders.includes('diary/2022/03'));
  assert.ok(allFolders.includes('work/archive'));

  // 1. Orphan scan: include work, exclude work/archive & diary ->
  //    work/a.png MUST NOT be flagged (still referenced by excluded diary),
  //    work/archive/old.png MUST be excluded, diary/2022/03/day.md MUST be excluded.
  const orphans = await f.scans.scanUnusedFiles(f.plugin, {
    scanLocal: true,
    scanRemote: false,
    typeNote: true,
    typeImage: true,
    typeAudio: false,
    typeOther: false,
    includeFolders: ['work'],
    excludeFolders: ['work/archive', 'diary']
  });
  const orphanPaths = orphans.map((o) => o.displayPath).sort();
  assert.deepEqual(orphanPaths, ['work/dup1.png', 'work/dup2.png', 'work/note.md', 'work/unused.png']);

  // 2. Duplicate scan: include work -> finds dup1 & dup2, excludes other/dup3
  const dupRes = await f.scans.scanDuplicateGroups(f.plugin, 'local', {
    typeImage: true,
    typeAudio: false,
    typeOther: false,
    typeNote: false,
    includeFolders: ['work'],
    excludeFolders: ['work/archive']
  });
  assert.equal(dupRes.groups.length, 1);
  assert.deepEqual(dupRes.groups[0].items.map((i) => i.displayPath).sort(), ['work/dup1.png', 'work/dup2.png']);

  // 3. Health check: include work -> only scans work/note.md, reports [[missing-in-work]],
  //    does NOT report [[missing-in-diary]], and does NOT falsely flag valid link to other/dup3.png!
  const health = await f.analytics.scanVaultLinkHealth(f.plugin, {
    checkWikiLinks: true,
    checkLocalMarkdown: true,
    checkRemote: false,
    includeFolders: ['work'],
    excludeFolders: ['work/archive']
  });
  assert.equal(health.totalDocs, 1);
  assert.deepEqual(health.issues.map((i) => i.target), ['missing-in-work']);

  // 4. Batch migrate: include work, exclude work/archive -> excludes work/archive/old.png and other/dup3.png
  const migrateList = await f.attachmentOps.scanLocalAttachmentsForBatchMigrate(f.plugin, {
    typeImage: true,
    typeAudio: false,
    typeOther: false,
    includeFolders: ['work'],
    excludeFolders: ['work/archive']
  });
  assert.deepEqual(migrateList.map((i) => i.displayPath).sort(), ['work/a.png', 'work/dup1.png', 'work/dup2.png', 'work/unused.png']);
});

test('Audit regressions: stale task discard preserves newer checkpoint, typed folder commits on scan, and leading-space folders stay exact', async () => {
  const f = createVaultFixture();
  f.plugin.settings.enableRemoteServer = true;
  f.plugin.settings.serverVerified = true;
  f.plugin.settings.language = 'zh';
  f.plugin.settings.excludedLocalFolders = '';
  f.plugin.isRemoteServerReady = () => true;
  f.plugin.checkUploadConflicts = async () => [];
  f.plugin.uploadBufferToServer = async () => { throw new Error('Network offline'); };
  f.plugin.app.vault.getResourcePath = (file) => file.path;

  const fileA = f.add('taskA/a.png', 'bytes-a', true);
  const fileB = f.add('taskB/b.png', 'bytes-b', true);
  const checkpointPath = f.migrationCheckpointPath(f.plugin);

  const nodeText = (node) => !node ? '' : String(node.text || node.textContent || '') + (Array.isArray(node.children) ? node.children.map(nodeText).join('') : '');
  const findButton = (root, text) => {
    const stack = [root];
    while (stack.length) {
      const node = stack.shift();
      if (!node) continue;
      if (node.tag === 'button' && nodeText(node).includes(text)) return node;
      if (Array.isArray(node.children)) stack.push(...node.children);
    }
    return null;
  };

  // 1. [P1] Stale Task A result page discard must NOT remove Task B's newer checkpoint
  const modalA = new f.BatchMigrateWizardModal(f.plugin.app, f.plugin);
  modalA.items = [{ name: 'a.png', displayPath: fileA.path, size: 7, rawObj: fileA, selected: true, refNotes: [] }];
  modalA.step = 2;
  modalA.onOpen();
  const runA = findButton(modalA.contentEl, f.plugin.t('migrateStart', { count: 1 }));
  await runA.onclick();
  assert.equal(modalA.step, 3);
  const cpAfterA = JSON.parse(f.journal.get(checkpointPath));
  assert.ok(cpAfterA.operationId);

  const modalB = new f.BatchMigrateWizardModal(f.plugin.app, f.plugin);
  modalB.items = [{ name: 'b.png', displayPath: fileB.path, size: 7, rawObj: fileB, selected: true, refNotes: [] }];
  modalB.step = 2;
  modalB.onOpen();
  const runB = findButton(modalB.contentEl, f.plugin.t('migrateStart', { count: 1 }));
  await runB.onclick();
  assert.equal(modalB.step, 3);
  const cpAfterB = JSON.parse(f.journal.get(checkpointPath));
  assert.notEqual(cpAfterB.operationId, cpAfterA.operationId);

  // Clicking Discard on stale Task A must leave Task B's checkpoint untouched
  const discardA = findButton(modalA.contentEl, '放弃任务');
  assert.ok(discardA);
  await discardA.onclick();
  assert.equal(f.journal.has(checkpointPath), true, 'Discarding stale task A must not delete task B checkpoint');
  assert.equal(JSON.parse(f.journal.get(checkpointPath)).operationId, cpAfterB.operationId);

  // Clicking Discard on Task B itself DOES remove Task B's checkpoint
  const discardB = findButton(modalB.contentEl, '放弃任务');
  assert.ok(discardB);
  await discardB.onclick();
  assert.equal(f.journal.has(checkpointPath), false, 'Discarding current task B should remove its own checkpoint');

  // 2. [P2] Typing a folder without clicking suggestion still commits scope before Orphan scan
  f.add('work/inside.png', 'inside', true);
  f.add('outside/leak.png', 'outside', true);
  const orphanModal = new f.OrphanWizardModal(f.plugin.app, f.plugin);
  orphanModal.options.scanRemote = false;
  orphanModal.onOpen();
  const includeInput = orphanModal.contentEl.all().find((n) => n.tag === 'input' && n.className === 'fm-folder-input');
  assert.ok(includeInput);
  includeInput.value = 'work';
  const nextBtn = findButton(orphanModal.contentEl, '下一步');
  await nextBtn.onclick();
  assert.deepEqual(orphanModal.options.includeFolders, ['work']);
  assert.deepEqual(orphanModal.results.map((r) => r.displayPath), ['work/inside.png']);

  // 3. [P2] Leading/trailing spaces in Obsidian folder paths must not be trimmed
  f.add(' work/spaced.png', 'spaced', true);
  const spacedModal = new f.BatchMigrateWizardModal(f.plugin.app, f.plugin, ' work');
  assert.deepEqual(spacedModal.options.includeFolders, [' work']);
  const scanned = await f.attachmentOps.scanLocalAttachmentsForBatchMigrate(f.plugin, spacedModal.options);
  assert.deepEqual(scanned.map((i) => i.displayPath), [' work/spaced.png']);
});

test('Audit round 2 regressions: concurrent discard serialization, stale resume start guard, and unique partial folder match', async () => {
  const f = createVaultFixture();
  f.plugin.settings.enableRemoteServer = true;
  f.plugin.settings.serverVerified = true;
  f.plugin.settings.language = 'zh';
  f.plugin.settings.excludedLocalFolders = '';
  f.plugin.isRemoteServerReady = () => true;
  f.plugin.checkUploadConflicts = async () => [];
  f.plugin.uploadBufferToServer = async () => { throw new Error('Network offline'); };
  f.plugin.app.vault.getResourcePath = (file) => file.path;

  const fileA = f.add('taskA/a.png', 'bytes-a', true);
  const fileB = f.add('taskB/b.png', 'bytes-b', true);
  const checkpointPath = f.migrationCheckpointPath(f.plugin);

  // 1. [P1] Concurrent clearMigrationCheckpoint (paused mid-read) vs saveMigrationCheckpoint(B)
  await f.saveMigrationCheckpoint(f.plugin, [fileA], { checkpointId: 'op-A' });
  const origRead = f.plugin.app.vault.adapter.read;
  let releaseRead;
  let paused = false;
  f.plugin.app.vault.adapter.read = async (p) => {
    const val = await origRead(p);
    if (!paused && p === checkpointPath) {
      paused = true;
      await new Promise((resolve) => { releaseRead = resolve; });
    }
    return val;
  };
  const clearPromise = f.clearMigrationCheckpoint(f.plugin, { operationId: 'op-A' });
  await new Promise((r) => setTimeout(r, 0));
  const saveBPromise = f.saveMigrationCheckpoint(f.plugin, [fileB], { checkpointId: 'op-B' });
  releaseRead();
  await Promise.all([clearPromise, saveBPromise]);
  f.plugin.app.vault.adapter.read = origRead;
  assert.equal(f.journal.has(checkpointPath), true, 'Task B checkpoint must survive concurrent discard of Task A');
  assert.equal(JSON.parse(f.journal.get(checkpointPath)).operationId, 'op-B');

  // 2. [P1] Starting upload from a stale resumed page A must NOT overwrite newer Task B checkpoint
  await f.saveMigrationCheckpoint(f.plugin, [fileA], { checkpointId: 'op-A-resumed' });
  let resumedModalA = null;
  await f.attachmentOps.resumePendingMigration(f.plugin, {
    open(modal) { resumedModalA = modal; modal.onOpen(); }
  });
  assert.ok(resumedModalA);
  // Task B fails and writes newer checkpoint op-B-new
  await f.saveMigrationCheckpoint(f.plugin, [fileB], { checkpointId: 'op-B-new' });
  const nodeText = (node) => !node ? '' : String(node.text || node.textContent || '') + (Array.isArray(node.children) ? node.children.map(nodeText).join('') : '');
  const findButton = (root, text) => {
    const stack = [root];
    while (stack.length) {
      const node = stack.shift();
      if (!node) continue;
      if (node.tag === 'button' && nodeText(node).includes(text)) return node;
      if (Array.isArray(node.children)) stack.push(...node.children);
    }
    return null;
  };
  const runStaleA = findButton(resumedModalA.contentEl, f.plugin.t('migrateStart', { count: 1 }));
  await runStaleA.onclick();
  assert.equal(f.journal.has(checkpointPath), true, 'Stale resumed Task A must not clear Task B checkpoint');
  assert.equal(JSON.parse(f.journal.get(checkpointPath)).operationId, 'op-B-new', 'Stale resumed Task A must not overwrite Task B checkpoint');

  // 3. [P2] Typing partial folder name "arch" in exclude input resolves unique suggestion "work/archive"
  f.add('work/keep.png', 'keep', true);
  f.add('work/archive/secret.png', 'secret', true);
  const orphanModal = new f.OrphanWizardModal(f.plugin.app, f.plugin);
  orphanModal.options.scanRemote = false;
  orphanModal.onOpen();
  const folderInputs = orphanModal.contentEl.all().filter((n) => n.tag === 'input' && n.className === 'fm-folder-input');
  assert.equal(folderInputs.length, 2);
  folderInputs[0].value = 'work';
  folderInputs[1].value = 'arch';
  const nextBtn = findButton(orphanModal.contentEl, '下一步');
  await nextBtn.onclick();
  assert.deepEqual(orphanModal.options.excludeFolders, ['work/archive']);
  assert.deepEqual(orphanModal.results.map((r) => r.displayPath), ['work/keep.png']);
});

test('Stale confirmation blocks upload and result-page retry saves a checkpoint when the slot is free', async () => {
  const f = createVaultFixture();
  f.plugin.settings.enableRemoteServer = true;
  f.plugin.settings.serverVerified = true;
  f.plugin.settings.language = 'zh';
  f.plugin.settings.excludedLocalFolders = '';
  f.plugin.isRemoteServerReady = () => true;
  f.plugin.checkUploadConflicts = async () => [];
  f.plugin.uploadBufferToServer = async () => { throw new Error('Network offline'); };
  f.plugin.app.vault.getResourcePath = (file) => file.path;

  const fileA = f.add('taskA/a.png', 'bytes-a', true);
  const fileB = f.add('taskB/b.png', 'bytes-b', true);
  const checkpointPath = f.migrationCheckpointPath(f.plugin);
  const nodeText = (node) => !node ? '' : String(node.text || node.textContent || '') + (Array.isArray(node.children) ? node.children.map(nodeText).join('') : '');
  const findButton = (root, text) => {
    const stack = [root];
    while (stack.length) {
      const node = stack.shift();
      if (!node) continue;
      if (node.tag === 'button' && nodeText(node).includes(text)) return node;
      if (Array.isArray(node.children)) stack.push(...node.children);
    }
    return null;
  };

  // A stale confirmation stays on the confirmation page.
  await f.saveMigrationCheckpoint(f.plugin, [fileA], { checkpointId: 'op-A-r3' });
  let resumedA = null;
  await f.attachmentOps.resumePendingMigration(f.plugin, {
    open(modal) { resumedA = modal; modal.onOpen(); }
  });
  await f.saveMigrationCheckpoint(f.plugin, [fileB], { checkpointId: 'op-B-r3' });
  await findButton(resumedA.contentEl, f.plugin.t('migrateStart', { count: 1 })).onclick();
  assert.equal(resumedA.step, 2);
  assert.equal(await f.clearMigrationCheckpoint(f.plugin, null), false, 'clearMigrationCheckpoint without expected identity must not delete');
  assert.equal(JSON.parse(f.journal.get(checkpointPath)).operationId, 'op-B-r3');

  // 2. [P1] Normal batch upload A fails, B fails, then Retry from A's Step 3 must NOT overwrite B's checkpoint
  const modalA = new f.BatchMigrateWizardModal(f.plugin.app, f.plugin);
  modalA.items = [{ name: 'a.png', displayPath: fileA.path, size: 7, rawObj: fileA, selected: true, refNotes: [] }];
  modalA.step = 2;
  modalA.onOpen();
  await findButton(modalA.contentEl, f.plugin.t('migrateStart', { count: 1 })).onclick();
  const opA = JSON.parse(f.journal.get(checkpointPath)).operationId;

  const modalB = new f.BatchMigrateWizardModal(f.plugin.app, f.plugin);
  modalB.items = [{ name: 'b.png', displayPath: fileB.path, size: 7, rawObj: fileB, selected: true, refNotes: [] }];
  modalB.step = 2;
  modalB.onOpen();
  await findButton(modalB.contentEl, f.plugin.t('migrateStart', { count: 1 })).onclick();
  const opB = JSON.parse(f.journal.get(checkpointPath)).operationId;
  assert.notEqual(opB, opA);

  // Retry A from its Step 3
  const retryA = findButton(modalA.contentEl, f.plugin.t('transferRetry'));
  assert.ok(retryA);
  retryA.onclick();
  assert.equal(modalA.step, 2);
  await findButton(modalA.contentEl, f.plugin.t('migrateStart', { count: 1 })).onclick();
  assert.equal(JSON.parse(f.journal.get(checkpointPath)).operationId, opB, 'Retrying stale normal batch A must not overwrite B checkpoint');
  assert.equal(modalA.checkpointIdentity, null);
  assert.equal(findButton(modalA.contentEl, '放弃任务'), null, 'Unowned result must not show Discard');

  const resumedB = await f.attachmentOps.resumePendingMigration(f.plugin, { open: (modal) => modal.onOpen() });
  await findButton(resumedB.contentEl, '放弃任务').onclick();
  assert.equal(f.journal.has(checkpointPath), false);

  findButton(modalA.contentEl, f.plugin.t('transferRetry')).onclick();
  await findButton(modalA.contentEl, f.plugin.t('migrateStart', { count: 1 })).onclick();
  const checkpointA = JSON.parse(f.journal.get(checkpointPath));
  assert.equal(checkpointA.operationId, modalA.checkpointIdentity.operationId);
  assert.deepEqual(checkpointA.items.map((item) => item.path), [fileA.path]);
  const restoredA = await f.attachmentOps.resumePendingMigration(f.plugin, { open: (modal) => modal.onOpen() });
  assert.deepEqual(restoredA.items.map((item) => item.displayPath), [fileA.path]);

  // 3. [P2] Ambiguous partial folder name "arch" (matches work/archive & work/archive-old) blocks scan
  f.add('work/archive/a.png', 'a', true);
  f.add('work/archive-old/b.png', 'b', true);
  const orphanModal = new f.OrphanWizardModal(f.plugin.app, f.plugin);
  orphanModal.options.scanRemote = false;
  orphanModal.onOpen();
  const folderInputs = orphanModal.contentEl.all().filter((n) => n.tag === 'input' && n.className === 'fm-folder-input');
  folderInputs[1].value = 'arch';
  await findButton(orphanModal.contentEl, '下一步').onclick();
  assert.equal(orphanModal.step, 1, 'Ambiguous folder input must block scan instead of silently skipping exclusion');
  assert.deepEqual(orphanModal.options.excludeFolders, []);
  assert.equal(orphanModal.results.length, 0);
});

test('Audit round 4 regressions: active-note retry guard, abandoned resume block, invalid identity rejection, and blur timer cancel', async () => {
  const f = createVaultFixture();
  f.plugin.settings.enableRemoteServer = true;
  f.plugin.settings.serverVerified = true;
  f.plugin.settings.language = 'zh';
  f.plugin.settings.excludedLocalFolders = '';
  f.plugin.isRemoteServerReady = () => true;
  f.plugin.checkUploadConflicts = async () => [];
  let uploadCalls = 0;
  f.plugin.uploadBufferToServer = async () => { uploadCalls++; throw new Error('Network offline'); };
  f.plugin.app.vault.getResourcePath = (file) => file.path;

  const note = f.add('note.md', '![[taskA/a.png]]');
  const fileA = f.add('taskA/a.png', 'bytes-a', true);
  const fileB = f.add('taskB/b.png', 'bytes-b', true);
  const checkpointPath = f.migrationCheckpointPath(f.plugin);
  const nodeText = (node) => !node ? '' : String(node.text || node.textContent || '') + (Array.isArray(node.children) ? node.children.map(nodeText).join('') : '');
  const findButton = (root, text) => {
    const stack = [root];
    while (stack.length) {
      const node = stack.shift();
      if (!node) continue;
      if (node.tag === 'button' && nodeText(node).includes(text)) return node;
      if (Array.isArray(node.children)) stack.push(...node.children);
    }
    return null;
  };

  // 1. [P1] Active-note upload A fails, Batch B fails, Retry on A must NOT overwrite B's checkpoint
  const noteModal = new f.ActiveNoteActionModal(f.plugin.app, f.plugin, note, 'migrate');
  noteModal.items = [{ name: 'a.png', displayPath: fileA.path, size: 7, rawObj: fileA, tfile: fileA, selected: true, refNotes: [note.path] }];
  await noteModal.execute(noteModal.items);
  noteModal.render();
  const opNoteA = JSON.parse(f.journal.get(checkpointPath)).operationId;
  assert.ok(opNoteA);

  await f.saveMigrationCheckpoint(f.plugin, [fileB], { checkpointId: 'op-batch-B' });
  const retryNoteBtn = findButton(noteModal.contentEl, f.plugin.t('transferRetry'));
  assert.ok(retryNoteBtn);
  await retryNoteBtn.onclick();
  assert.equal(JSON.parse(f.journal.get(checkpointPath)).operationId, 'op-batch-B', 'Active-note retry must not overwrite newer Batch B checkpoint');
  assert.equal(noteModal.checkpointIdentity, null);
  assert.equal(await f.clearMigrationCheckpoint(f.plugin, { operationId: 'op-batch-B' }), true);
  await findButton(noteModal.contentEl, f.plugin.t('transferRetry')).onclick();
  const noteCheckpoint = JSON.parse(f.journal.get(checkpointPath));
  assert.equal(noteCheckpoint.operationId, noteModal.checkpointIdentity.operationId);
  assert.deepEqual(noteCheckpoint.items.map((item) => item.path), [fileA.path]);

  // 2. [P2] Two resumed pages for the same task: discard on A1 blocks A2 from uploading or recreating checkpoint
  await f.saveMigrationCheckpoint(f.plugin, [fileA], { checkpointId: 'op-shared-A' });
  let resumed1 = null;
  let resumed2 = null;
  await f.attachmentOps.resumePendingMigration(f.plugin, { open(m) { resumed1 = m; m.onOpen(); } });
  await f.attachmentOps.resumePendingMigration(f.plugin, { open(m) { resumed2 = m; m.onOpen(); } });
  await findButton(resumed1.contentEl, '放弃任务').onclick();
  assert.equal(f.journal.has(checkpointPath), false);
  const callsBeforeA2 = uploadCalls;
  await findButton(resumed2.contentEl, f.plugin.t('migrateStart', { count: 1 })).onclick();
  assert.equal(uploadCalls, callsBeforeA2, 'Second resumed page must not upload after task was discarded');
  assert.equal(f.journal.has(checkpointPath), false, 'Second resumed page must not recreate discarded checkpoint');

  // 3. [P3] clearMigrationCheckpoint rejects empty/invalid identities ({}, { operationId: '' }, { raw: '' })
  await f.saveMigrationCheckpoint(f.plugin, [fileB], { checkpointId: 'op-keep-B' });
  await findButton(resumed2.contentEl, f.plugin.t('migrateStart', { count: 1 })).onclick();
  assert.equal(uploadCalls, callsBeforeA2, 'A different pending operation must also block the discarded resume');
  assert.equal(JSON.parse(f.journal.get(checkpointPath)).operationId, 'op-keep-B');
  assert.equal(await f.clearMigrationCheckpoint(f.plugin, {}), false);
  assert.equal(await f.clearMigrationCheckpoint(f.plugin, { operationId: '' }), false);
  assert.equal(await f.clearMigrationCheckpoint(f.plugin, { operationId: '   ' }), false);
  assert.equal(await f.clearMigrationCheckpoint(f.plugin, { raw: '' }), false);
  assert.equal(f.journal.has(checkpointPath), true, 'Invalid checkpoint identity must never delete existing checkpoint');

  // 4. [P3] Blur timer scheduled before clicking Next is cancelled when ambiguous dropdown reopens
  f.add('work/archive/a.png', 'a', true);
  f.add('work/archive-old/b.png', 'b', true);
  const orphanModal = new f.OrphanWizardModal(f.plugin.app, f.plugin);
  orphanModal.options.scanRemote = false;
  orphanModal.onOpen();
  const folderInputs = orphanModal.contentEl.all().filter((n) => n.tag === 'input' && n.className === 'fm-folder-input');
  const dropdowns = orphanModal.contentEl.all().filter((n) => n.className === 'fm-folder-dropdown');
  folderInputs[1].value = 'arch';
  folderInputs[1].onblur(); // schedules 120ms hideDropdown timer
  await findButton(orphanModal.contentEl, '下一步').onclick(); // cancels timer and reopens dropdown
  assert.equal(dropdowns[1].style.display, 'block');
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(dropdowns[1].style.display, 'block', 'Reopened ambiguous dropdown must stay open after 120ms blur delay');
});

test('Folder inputs leave IME confirmation to the editor and accept the composed path on the next Enter', () => {
  let now = 1000;
  const f = createVaultFixture(undefined, { Date: class extends Date { static now() { return now; } } });
  f.plugin.isRemoteServerReady = () => false;
  f.add('项目/a.png', 'project file', true);
  const modal = new f.OrphanWizardModal(f.plugin.app, f.plugin);
  modal.onOpen();
  const inputs = modal.contentEl.all().filter((node) => node.className === 'fm-folder-input');

  for (const [index, field] of ['includeFolders', 'excludeFolders'].entries()) {
    const input = inputs[index];
    let prevented = false;
    const enter = { key: 'Enter', preventDefault() { prevented = true; } };
    input.value = 'xiangmu';
    input.oninput();
    input.onkeydown({ ...enter, isComposing: true });
    input.onkeydown({ ...enter, keyCode: 229 });
    input.dispatch('compositionstart');
    input.onkeydown(enter);
    assert.equal(prevented, false);
    assert.equal(input.value, 'xiangmu');
    assert.deepEqual(modal.options[field], []);

    input.value = '项目';
    input.dispatch('compositionend');
    input.oninput();
    input.onkeydown(enter);
    assert.equal(prevented, false);
    assert.equal(input.value, '项目');
    now += 100;
    input.onkeydown(enter);
    assert.equal(prevented, true);
    assert.deepEqual(modal.options[field], ['项目']);
  }
});
