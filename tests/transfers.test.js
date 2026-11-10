const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPlugin } = require('./helpers/load-plugin');
const bytes = (value) => new TextEncoder().encode(value).buffer;

function createVaultFixture(requestUrl) {
  const { Plugin, computeSha256Hex, migrationCheckpointPath } = loadPlugin(requestUrl);
  const files = [], contents = new Map(), binaries = new Map(), journal = new Map(), writes = new Map(), trashed = [];
  const add = (path, value, binary = false) => {
    const name = path.split('/').pop();
    const file = { path, name, extension: name.split('.').pop(), basename: name.replace(/\.[^.]+$/, ''), stat: { size: value.length, mtime: 1 } };
    files.push(file);
    (binary ? binaries : contents).set(path, binary ? bytes(value) : value);
    return file;
  };
  const vault = {
    getFiles: () => files.filter((file) => !trashed.includes(file.path)),
    getAbstractFileByPath: (path) => files.find((file) => file.path === path),
    read: async (file) => contents.get(file.path),
    cachedRead: async (file) => contents.get(file.path),
    readBinary: async (file) => binaries.get(file.path),
    createBinary: async (path, buffer) => add(path, new TextDecoder().decode(buffer), true),
    modifyBinary: async (file, buffer) => binaries.set(file.path, buffer),
    process: async (file, transform) => {
      writes.set(file.path, (writes.get(file.path) || 0) + 1);
      contents.set(file.path, transform(contents.get(file.path)));
    },
    trash: async (file) => trashed.push(file.path),
    adapter: { exists: async (path) => journal.has(path), read: async (path) => journal.get(path),
      write: async (path, value) => journal.set(path, value), remove: async (path) => journal.delete(path) }
  };
  const plugin = new Plugin({ vault, fileManager: { getAvailablePathForAttachment: async (name) => `downloads/${name}` },
    metadataCache: { resolvedLinks: {}, getFileCache: () => ({}),
    getFirstLinkpathDest: (ref) => files.find((file) => file.path === ref || file.name === ref) }, workspace: {} });
  plugin.settings = { language: 'en', serverUrl: 'https://example.com', deleteLocalAfterMigrate: true };
  plugin.manifest = { dir: 'test-plugin' };
  plugin.logOperation = () => {};
  plugin.uploadBufferToServer = async (buffer, filename) => ({ filename, year: '2026', month: '11',
    rawUrl: `https://example.com/raw/2026/11/${filename}`, sha256: await computeSha256Hex(buffer) });
  return { plugin, files, contents, binaries, journal, writes, trashed, add, computeSha256Hex, migrationCheckpointPath };
}

test('Real note migration preserves edits made during upload and checks references before trash', async () => {
  const f = createVaultFixture();
  const asset = f.add('assets/one.png', 'image', true);
  const note = f.add('note.md', '![[assets/one.png]]');
  f.add('other.md', '![[assets/one.png]]');
  const upload = f.plugin.uploadBufferToServer;
  f.plugin.uploadBufferToServer = async (...args) => {
    f.contents.set(note.path, f.contents.get(note.path) + '\nUSER EDIT DURING UPLOAD');
    return upload(...args);
  };
  const result = await f.plugin.executeMigrateNoteDirect(note, null, {
    items: [{ tfile: asset }], syncOtherNotes: false, deleteLocalAfter: true, returnDetails: true
  });
  assert.ok(f.contents.get(note.path).includes('USER EDIT DURING UPLOAD'));
  assert.ok(f.contents.get(note.path).includes('https://example.com/raw/2026/11/one.png'));
  assert.ok(f.contents.get('other.md').includes('![[assets/one.png]]'));
  assert.equal(result.processedItems[0].keptForOtherRefs, 1);
  assert.deepEqual(f.trashed, []);
});

test('Batch migration writes each affected note once and only removes verified local bytes', async () => {
  const f = createVaultFixture();
  const a = f.add('assets/a.png', 'A', true), b = f.add('assets/b.png', 'B', true);
  f.add('note.md', '![[assets/a.png]] ![[assets/b.png]]');
  f.add('unrelated.md', 'No attachments');
  const result = await f.plugin.executeBatchMigrateSafely([{ rawObj: a }, { rawObj: b }], { deleteLocalAfter: true });
  assert.equal(result.count, 2);
  assert.equal(f.writes.get('note.md'), 1);
  assert.equal(f.writes.get('unrelated.md'), undefined);
  assert.deepEqual(f.trashed.sort(), [a.path, b.path].sort());
  assert.equal(f.journal.has(f.migrationCheckpointPath(f.plugin)), false);
});

test('Cancelling a batch finalizes completed uploads and journals unfinished items', async () => {
  const f = createVaultFixture();
  const a = f.add('assets/a.png', 'A', true), b = f.add('assets/b.png', 'B', true);
  f.add('note.md', '![[assets/a.png]] ![[assets/b.png]]');
  const controller = new AbortController();
  const upload = f.plugin.uploadBufferToServer;
  f.plugin.uploadBufferToServer = async (...args) => { const result = await upload(...args); controller.abort(); return result; };
  const result = await f.plugin.executeBatchMigrateSafely([{ rawObj: a }, { rawObj: b }], {
    deleteLocalAfter: true, signal: controller.signal
  });
  assert.equal(result.cancelled, true);
  assert.equal(result.count, 1);
  assert.ok(f.contents.get('note.md').includes('/a.png'));
  assert.ok(f.contents.get('note.md').includes('![[assets/b.png]]'));
  assert.deepEqual(f.trashed, [a.path]);
  const pending = JSON.parse(f.journal.get(f.migrationCheckpointPath(f.plugin)));
  assert.deepEqual(pending.items.map((item) => item.path), [b.path]);
});

test('A failed rewrite retains the checkpoint and every local original', async () => {
  const f = createVaultFixture();
  const asset = f.add('assets/a.png', 'A', true);
  f.add('note.md', '![[assets/a.png]]');
  f.plugin.app.vault.process = async () => { throw new Error('disk failure'); };
  await assert.rejects(f.plugin.executeBatchMigrateSafely([{ rawObj: asset }], { deleteLocalAfter: true }), /disk failure/);
  assert.deepEqual(f.trashed, []);
  assert.ok(f.journal.has(f.migrationCheckpointPath(f.plugin)));
  assert.equal(f.plugin.attachmentOperationRunning, false);
});

test('Edits after the final reference snapshot prevent deletion', async () => {
  const f = createVaultFixture();
  const asset = f.add('assets/a.png', 'A', true);
  f.add('note.md', '![[assets/a.png]]');
  let reads = 0;
  const read = f.plugin.app.vault.readBinary;
  f.plugin.app.vault.readBinary = async (file) => {
    if (++reads === 2) f.plugin.referenceRevision = 1;
    return read(file);
  };
  const result = await f.plugin.executeBatchMigrateSafely([{ rawObj: asset }], { deleteLocalAfter: true });
  assert.deepEqual(f.trashed, []);
  assert.equal(result.trashFailures.length, 1);
});

test('Changing an attachment during upload preserves both its current local link and bytes', async () => {
  const f = createVaultFixture();
  const asset = f.add('assets/a.png', 'A', true);
  f.add('note.md', '![[assets/a.png]]');
  const upload = f.plugin.uploadBufferToServer;
  f.plugin.uploadBufferToServer = async (...args) => {
    const result = await upload(...args);
    f.binaries.set(asset.path, bytes('B'));
    asset.stat.mtime = 2;
    return result;
  };
  const result = await f.plugin.executeBatchMigrateSafely([{ rawObj: asset }], { deleteLocalAfter: true });
  assert.equal(result.count, 0);
  assert.equal(result.failures.length, 1);
  assert.ok(f.contents.get('note.md').includes('![[assets/a.png]]'));
  assert.deepEqual(f.trashed, []);
});

test('Batch download verifies each file and rewrites a shared note once', async () => {
  const f = createVaultFixture(async (request) => ({ status: 200,
    arrayBuffer: bytes(request.url.includes('/a.png') ? 'A' : 'B') }));
  const a = { year: '2026', month: '11', filename: 'a.png',
    rawUrl: 'https://example.com/raw/2026/11/a.png', sha256: await f.computeSha256Hex(bytes('A')) };
  const b = { ...a, filename: 'b.png', rawUrl: 'https://example.com/raw/2026/11/b.png', sha256: await f.computeSha256Hex(bytes('B')) };
  const note = f.add('note.md', `![](${a.rawUrl}) ![](${b.rawUrl})`);
  const result = await f.plugin.executeDownloadNoteDirect(note, null, {
    items: [a, b].map((rawObj) => ({ ...rawObj, rawObj })), returnDetails: true
  });
  assert.equal(result.count, 2);
  assert.equal(f.writes.get('note.md'), 1);
  assert.ok(f.contents.get('note.md').includes('downloads/a.png'));
  assert.ok(f.contents.get('note.md').includes('downloads/b.png'));
});

test('A checksum mismatch on download leaves the existing local file and note untouched', async () => {
  let writes = 0;
  const { Plugin, computeSha256Hex } = loadPlugin(async () => ({ status: 200, arrayBuffer: bytes('wrong bytes') }));
  const plugin = new Plugin({ vault: { modifyBinary: async () => writes++ },
    workspace: { getActiveFile: () => null }, fileManager: { getAvailablePathForAttachment: async () => 'a.png' } });
  plugin.settings = { language: 'en', apiToken: 'test' };
  const item = { year: '2026', month: '11', filename: 'a.png', availablePath: 'a.png',
    existingFile: { path: 'a.png' }, rawObj: { rawUrl: 'https://example.com/raw/a.png', sha256: await computeSha256Hex(bytes('expected')) } };
  await assert.rejects(plugin.downloadSingleRemoteItemToLocal(item, { silent: true, conflictStrategy: 'overwrite' }), /verification failed/);
  assert.equal(writes, 0);
});

test('Retry policy respects Retry-After, avoids retrying auth errors, and stops after cancellation', async () => {
  const { requestWithBackoff } = loadPlugin();
  let calls = 0;
  const delays = [];
  const result = await requestWithBackoff(async () => ++calls === 1
    ? { status: 429, headers: { 'retry-after': '60' } } : { status: 200 }, {
    delay: async (ms) => delays.push(ms)
  });
  assert.equal(result.status, 200);
  assert.deepEqual(delays, [60000]);
  calls = 0;
  await requestWithBackoff(async () => { calls++; return { status: 401 }; });
  assert.equal(calls, 1);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(requestWithBackoff(async () => { throw new Error('must not run'); }, { signal: controller.signal }), { name: 'AbortError' });
});

test('Reference index handles encoded/CJK/emoji paths, boundaries and duplicate basenames conservatively', () => {
  const { createLocalReferenceMatcher, stripRemoteReferenceText } = loadPlugin();
  const files = ['assets/1.png', 'assets/11.png', 'assets/中文 图片.png', 'assets/😀.png', 'other/1.png'].map((path) => ({
    path, name: path.split('/').pop(), extension: 'png'
  }));
  const match = createLocalReferenceMatcher(files, () => false);
  const text = '![[assets/11.png]] ![[assets/中文 图片.png]] ![[assets/😀.png]] https://example.com/assets/1.png';
  const found = match(stripRemoteReferenceText(text));
  assert.ok(found.has('assets/11.png'));
  assert.ok(found.has('assets/中文 图片.png'));
  assert.ok(found.has('assets/😀.png'));
  assert.ok(!found.has('assets/1.png'));
  assert.ok(!found.has('other/1.png'));
  assert.ok(match('![[1.png]]').has('other/1.png'));
  assert.ok(match(decodeURIComponent('![[assets/%E4%B8%AD%E6%96%87%20%E5%9B%BE%E7%89%87.png]]')).has('assets/中文 图片.png'));
});

test('Gallery pagination bounds rendering and resets when filters change', () => {
  const { getRemoteGalleryPage } = loadPlugin();
  const view = { selectedBucket: 'all', selectedType: 'all', searchQuery: '' };
  const items = Array.from({ length: 1000 }, (_, id) => ({ id }));
  assert.equal(getRemoteGalleryPage(view, items).items.length, 60);
  view.galleryPage = 16;
  assert.equal(getRemoteGalleryPage(view, items).items.length, 40);
  view.searchQuery = 'changed';
  assert.equal(getRemoteGalleryPage(view, items).current, 0);
});
