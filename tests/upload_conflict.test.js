const test = require('node:test');
const assert = require('node:assert/strict');
const { createVaultFixture } = require('./helpers/vault');

test('migrateLocalAttachments handles upload conflicts for reuse, rename, replace, and skip', async () => {
  const f = createVaultFixture();
  const asset = f.add('assets/cover.png', 'local-new-bytes', true);
  const note = f.add('note.md', '![[assets/cover.png]]');

  const conflictMeta = {
    code: 'NAME_CONFLICT',
    year: '2026',
    month: '11',
    filename: 'cover.png',
    size: 123,
    locked: false,
    category: 'image',
    rawUrl: 'https://example.com/raw/2026/11/cover.png',
    pubUrl: 'https://example.com/pub/2026/11/cover.webp',
    markdown: '![cover.png](https://example.com/raw/2026/11/cover.png)'
  };

  // 1. Skip leaves local attachment untouched
  const skipResult = await f.plugin.executeMigrateNoteDirect(note, null, {
    items: [{ tfile: asset, hasConflict: true, conflict: conflictMeta }],
    conflictStrategy: 'skip',
    deleteLocalAfter: true,
    returnDetails: true
  });
  assert.equal(skipResult.count, 0);
  assert.ok(f.contents.get('note.md').includes('![[assets/cover.png]]'));

  // 2. Reuse updates note link to remote URL without uploading
  let uploadCalled = false;
  const origUpload = f.plugin.uploadBufferToServer;
  f.plugin.uploadBufferToServer = async (...args) => {
    uploadCalled = true;
    return origUpload(...args);
  };
  const reuseResult = await f.plugin.executeMigrateNoteDirect(note, null, {
    items: [{ tfile: asset, hasConflict: true, conflict: conflictMeta }],
    conflictStrategy: 'reuse',
    deleteLocalAfter: false,
    returnDetails: true
  });
  assert.equal(uploadCalled, false);
  assert.equal(reuseResult.count, 1);
  assert.ok(f.contents.get('note.md').includes('https://example.com/raw/2026/11/cover.png'));

  // 3. Replace passes conflictStrategy: 'replace' and blocks when remote file is locked
  const f2 = createVaultFixture();
  const asset2 = f2.add('assets/locked.png', 'new-bytes', true);
  const note2 = f2.add('note.md', '![[assets/locked.png]]');
  const lockedResult = await f2.plugin.executeMigrateNoteDirect(note2, null, {
    items: [{ tfile: asset2, hasConflict: true, conflict: { ...conflictMeta, filename: 'locked.png', locked: true } }],
    conflictStrategy: 'replace',
    returnDetails: true
  });
  assert.equal(lockedResult.count, 0);
  assert.equal(lockedResult.failures.length, 1);

  let receivedStrategy = null;
  f2.plugin.uploadBufferToServer = async (_buf, name, _mime, opts) => {
    receivedStrategy = opts?.conflictStrategy;
    return {
      year: '2026',
      month: '11',
      filename: name,
      sha256: 'abc',
      rawUrl: `https://example.com/raw/2026/11/${name}`,
      pubUrl: `https://example.com/pub/2026/11/${name}.webp`,
      markdown: `![${name}](https://example.com/raw/2026/11/${name})`
    };
  };
  const replaceResult = await f2.plugin.executeMigrateNoteDirect(note2, null, {
    items: [{ tfile: asset2, hasConflict: true, conflict: { ...conflictMeta, filename: 'locked.png', locked: false } }],
    conflictStrategy: 'replace',
    returnDetails: true
  });
  assert.equal(receivedStrategy, 'replace');
  assert.equal(replaceResult.count, 1);
});

test('Connected attachment scan computes hashes and preflights conflicts', async () => {
  const f = createVaultFixture();
  const asset = f.add('assets/photo.png', 'local-bytes-n01', true);
  const note = f.add('note.md', '![[assets/photo.png]]');

  const checkedPayloads = [];
  f.plugin.app.vault.getResourcePath = () => 'app://local/photo.png';
  f.plugin.isRemoteServerReady = () => true;
  f.plugin.checkUploadConflicts = async (items) => {
    checkedPayloads.push(items);
    return items.map((i) => ({
      filename: i.filename,
      status: 'conflict',
      code: 'NAME_CONFLICT',
      conflict: { year: '2026', month: '11', filename: i.filename, size: 10, locked: false, rawUrl: 'https://example.com/raw/2026/11/photo.png' }
    }));
  };

  const modal = new f.BatchMigrateWizardModal(f.plugin.app, f.plugin);
  modal.renderStep1(modal.contentEl);
  const findButtons = (el) => {
    const out = [];
    if (String(el?.tag || el?.tagName || '').toLowerCase() === 'button') out.push(el);
    for (const c of el?.children || []) out.push(...findButtons(c));
    return out;
  };
  const nextBtn = findButtons(modal.contentEl).find((b) => String(b.className || b.cls || '').includes('mod-cta') || b.hasClass?.('mod-cta'));
  assert.ok(nextBtn);
  await nextBtn.onclick();
  assert.equal(checkedPayloads.length, 1);
  assert.equal(checkedPayloads[0][0].filename, 'photo.png');
  assert.ok(typeof checkedPayloads[0][0].sha256 === 'string' && checkedPayloads[0][0].sha256.length === 64);
  assert.equal(modal.items[0].hasConflict, true);
  assert.equal(asset.path, 'assets/photo.png');
  await new Promise((r) => setTimeout(r, 10));
  modal.close();
});

test('Replacement sends the confirmed target through requestUrl and bypasses content deduplication', async () => {
  const { loadPlugin } = require('./helpers/load-plugin');
  const bytes = new TextEncoder().encode('incoming-content');
  let request;
  const loaded = loadPlugin(async opts => {
    request = opts;
    return { status: 200, json: { filename: '目标.txt', sha256: await loaded.computeSha256Hex(bytes.buffer) } };
  });
  const plugin = new loaded.Plugin({});
  plugin.settings = { serverUrl: 'https://example.com', apiToken: 'test-token' };
  plugin.probeRemoteSha256 = async () => { throw new Error('Replacement must not be redirected by the hash probe'); };
  const sha256 = 'a'.repeat(64);
  await plugin.uploadBufferToServer(bytes.buffer, '目标.txt', 'text/plain', {
    conflictStrategy: 'replace', conflictTargetYear: '2020', conflictTargetMonth: '01',
    conflictTargetFilename: '目标.txt', conflictTargetSha256: sha256
  });
  assert.equal(request.headers['X-Conflict-Strategy'], 'replace');
  assert.equal(request.headers['X-Conflict-Target-Year'], '2020');
  assert.equal(request.headers['X-Conflict-Target-Month'], '01');
  assert.equal(request.headers['X-Conflict-Target-Filename'], encodeURIComponent('目标.txt'));
  assert.equal(request.headers['X-Conflict-Target-Sha256'], sha256);
});

test('Incoming rename validation keeps the original comparison and overwrite target', async () => {
  const { loadPlugin } = require('./helpers/load-plugin');
  const original = { code: 'NAME_CONFLICT', filename: '19797.png', year: '2026', month: '11',
    size: 100, rawUrl: 'https://example.com/original.png', sha256: 'a'.repeat(64) };
  const other = { ...original, filename: '199.png', rawUrl: 'https://example.com/other.png', sha256: 'b'.repeat(64) };
  const { IncomingFileModal } = loadPlugin(async () => ({ status: 200, json: { results: [{ status: 'conflict', conflict: other }] } }));
  const app = { workspace: { getActiveFile: () => null } };
  const plugin = { app, settings: { apiToken: 'fixture' }, isRemoteServerReady: () => true,
    getCleanServerUrl: () => 'https://example.com', t: key => key };
  const modal = new IncomingFileModal(app, { defaultBaseName: '19797', ext: 'png', size: 10, arrayBuffer: new ArrayBuffer(1) }, { plugin });
  modal.step = 'conflict'; modal.conflict = original; modal.render();
  const find = cls => modal.contentEl.all().filter(el => el.className.split(' ').includes(cls));
  assert.equal(find('fm-conflict-file-card').length, 2);
  assert.equal(find('fm-module-summary').length, 0);
  const input = find('fm-incoming-name-input')[0];
  input.value = '199'; input.dispatch('input');
  await new Promise(resolve => setTimeout(resolve, 260));
  assert.equal(modal.conflict, original);
  assert.equal(modal.finalFilename, '19797.png');
  assert.deepEqual(find('fm-conflict-file-name').map(el => el.text), ['19797.png', '19797.png']);
  assert.equal(find('fm-conflict-name-error')[0].text, 'uploadConflictRenameExists');
  let execution;
  modal.render = () => {};
  modal.runExecution = () => { execution = { filename: modal.finalFilename, target: modal.conflictTarget }; };
  const replace = find('fm-incoming-dest-card').find(el => el.all().some(child => child.text === 'uploadConflictBtnReplace'));
  replace.onclick();
  const confirm = modal.contentEl.all().find(el => el.tag === 'button' && el.className.includes('mod-cta'));
  await confirm.onclick();
  assert.deepEqual(execution, { filename: '19797.png', target: original });
  modal.onClose();
});

test('Incoming confirmation ignores a name check after the filename or action changes', async t => {
  for (const change of ['filename', 'action']) await t.test(change, async () => {
    const { loadPlugin } = require('./helpers/load-plugin');
    let release;
    const { IncomingFileModal } = loadPlugin(() => new Promise(resolve => {
      release = () => resolve({ status: 200, json: { results: [{ status: 'ok' }] } });
    }));
    const app = { workspace: { getActiveFile: () => null } };
    const plugin = { app, settings: { apiToken: 'fixture' }, isRemoteServerReady: () => true,
      getCleanServerUrl: () => 'https://example.com', t: key => key };
    const modal = new IncomingFileModal(app, { defaultBaseName: 'original', ext: 'txt', size: 1, arrayBuffer: new ArrayBuffer(1) }, { plugin });
    modal.step = 'conflict';
    modal.conflict = { code: 'NAME_CONFLICT', filename: 'original.txt', year: '2026', month: '11' };
    modal.render();
    const find = cls => modal.contentEl.all().filter(el => el.className.split(' ').includes(cls));
    const input = find('fm-incoming-name-input')[0];
    const confirm = modal.contentEl.all().find(el => el.tag === 'button' && el.className.includes('mod-cta'));
    let executions = 0;
    modal.runExecution = () => { executions++; };
    input.value = 'first'; input.dispatch('input');
    const pending = confirm.onclick();
    assert.equal(typeof release, 'function');
    if (change === 'filename') {
      input.value = 'second'; input.dispatch('input');
    } else {
      find('fm-incoming-dest-card').find(el => el.all().some(child => child.text === 'uploadConflictBtnSaveLocal')).onclick();
    }
    release();
    await pending;
    assert.equal(executions, 0, 'A stale confirmation must never start an upload');
    assert.equal(modal.finalFilename, 'original.txt');
    assert.equal(modal.isExecuting, false);
    assert.equal(confirm.disabled, false, 'The current choice remains available for a fresh confirmation');
    modal.onClose();
  });
});

test('Interrupted migration resumes with its saved strategy and a fresh conflict preflight', async () => {
  let resumed;
  const f = createVaultFixture(undefined, { onModalOpen(modal) { resumed = modal; } });
  const asset = f.add('assets/retry.png', 'retry-content', true);
  const note = f.add('note.md', '![[assets/retry.png]]');
  f.plugin.isRemoteServerReady = () => true;
  f.plugin.uploadBufferToServer = async () => { throw new Error('Offline'); };
  await f.plugin.executeMigrateNoteDirect(note, null, {
    items: [{ tfile: asset, hasConflict: true, conflict: { code: 'NAME_CONFLICT' } }],
    conflictStrategy: 'rename', returnDetails: true
  });
  const checkpoint = JSON.parse(f.journal.get(f.migrationCheckpointPath(f.plugin)));
  assert.equal(checkpoint.options.conflictStrategy, 'rename');
  let checks = 0;
  f.plugin.checkUploadConflicts = async () => {
    checks++;
    return [{ status: 'conflict', conflict: { code: 'NAME_CONFLICT', year: '2020', month: '01', filename: 'retry.png' } }];
  };
  await f.attachmentOps.resumePendingMigration(f.plugin);
  assert.equal(checks, 1);
  assert.equal(resumed.items[0].hasConflict, true);
  const strategies = [];
  f.plugin.uploadBufferToServer = async (_bytes, _name, _mime, opts) => {
    strategies.push(opts.conflictStrategy);
    throw new Error('Offline again');
  };
  await f.migrateLocalAttachments(f.plugin, resumed.items, resumed.options);
  assert.deepEqual(strategies, ['rename']);
});
