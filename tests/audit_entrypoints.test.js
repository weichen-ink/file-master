const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPlugin } = require('./helpers/load-plugin');

function editor(text = 'shared text') {
  return {
    text, from: { line: 0, ch: 0 }, to: { line: 0, ch: 6 },
    getValue() { return this.text; },
    getLine() { return this.text; },
    getCursor(which) { return { ...(which === 'to' ? this.to : this.from) }; },
    replaceRange(value, from, to) { this.text = this.text.slice(0, from.ch) + value + this.text.slice(to.ch); },
    setCursor(position) { this.from = this.to = position; },
    focus() {}
  };
}

async function incomingFixture(text, read = async () => new ArrayBuffer(1)) {
  const handlers = new Map(), opened = [], saved = [], sourcePaths = [];
  const loaded = loadPlugin(undefined, { setTimeout: () => 0, onModalOpen: modal => opened.push(modal) });
  const fileA = { path: 'A.md', extension: 'md', basename: 'A' };
  const fileB = { path: 'B.md', extension: 'md', basename: 'B' };
  const viewA = { file: fileA, editor: editor(text) }, viewB = { file: fileB, editor: editor(text) };
  const app = {
    vault: {
      on: () => ({}),
      getAbstractFileByPath: path => [fileA, fileB].find(file => file.path === path),
      createBinary: async path => { saved.push(path); return { path }; }
    },
    workspace: {
      on(name, callback) { handlers.set(name, callback); return {}; },
      onLayoutReady() {}, getActiveViewOfType: () => viewA,
      getLeavesOfType: () => [{ view: viewA }, { view: viewB }], getActiveFile: () => fileA
    },
    fileManager: {
      getAvailablePathForAttachment: async (name, source) => { sourcePaths.push(source); return `attachments/${name}`; },
      generateMarkdownLink: () => '[[asset.png]]'
    }
  };
  const plugin = new loaded.Plugin(app);
  plugin.loadData = async () => ({ enableSidebarButton: false, enableClipboardMonitor: true,
    enableRemoteServer: false, saveLocationMode: 'local', language: 'en' });
  plugin.addSettingTab = plugin.addCommand = plugin.registerEvent = plugin.registerView = plugin.registerHoverLinkSource = plugin.logOperation = () => {};
  await plugin.onload();
  const file = { name: 'asset.png', type: 'image/png', size: 1, arrayBuffer: read };
  const event = { clipboardData: { files: [file] }, dataTransfer: { files: [file] },
    clientX: 10, clientY: 20, preventDefault() {} };
  const execute = async () => {
    assert.equal(opened.length, 1);
    const modal = opened[0];
    modal.close = () => {};
    await modal.runExecution();
    return modal;
  };
  return { ...loaded, plugin, handlers, opened, saved, sourcePaths, viewA, viewB, fileB, event, execute };
}

for (const kind of ['paste', 'drop']) test(`Release editor-${kind} inserts into the receiving pane, preserving the other pane`, async () => {
  const text = kind === 'drop' ? '| a | b |' : 'shared text';
  const f = await incomingFixture(text);
  f.viewB.editor.posAtCoords = (x, y) => { assert.deepEqual([x, y], [10, 20]); return { line: 0, ch: 6 }; };
  await f.handlers.get(`editor-${kind}`)(f.event, f.viewB.editor, f.viewB);
  const modal = await f.execute();
  assert.equal(modal.options.insertionTarget.view, f.viewB);
  assert.equal(f.viewA.editor.text, text);
  assert.equal(f.viewB.editor.text, kind === 'drop' ? '| a | ![[asset.png]]b |' : '![[asset.png]] text');
  assert.deepEqual(f.sourcePaths, ['B.md']);
  assert.equal(modal.result.inserted, true);
});

for (const changed of ['file', 'content']) test(`Release paste preserves the attachment and rejects an async ${changed} change`, async () => {
  let release;
  const read = new Promise(resolve => { release = resolve; });
  const f = await incomingFixture('shared text', () => read);
  const pending = f.handlers.get('editor-paste')(f.event, f.viewB.editor, f.viewB);
  if (changed === 'file') f.viewB.file = { path: 'C.md', extension: 'md' };
  else f.viewB.editor.text = 'edited while reading attachment';
  const before = f.viewB.editor.text;
  release(new ArrayBuffer(1)); await pending;
  const modal = await f.execute();
  assert.equal(f.viewA.editor.text, 'shared text');
  assert.equal(f.viewB.editor.text, before);
  assert.equal(modal.options.activeFile, f.fileB);
  assert.deepEqual(f.saved, ['attachments/asset.png']);
  assert.equal(modal.result.success, true);
  assert.equal(modal.result.inserted, false);
  assert.ok(modal.result.insertionWarning);
});

test('Release paste never falls back to the active pane for an unbound editor', async () => {
  const f = await incomingFixture('shared text'), unknown = editor();
  await f.handlers.get('editor-paste')(f.event, unknown, { file: f.fileB, editor: unknown });
  const modal = await f.execute();
  assert.equal(modal.result.inserted, false);
  assert.equal(f.viewA.editor.text, 'shared text');
  assert.equal(unknown.text, 'shared text');
  assert.equal(f.saved.length, 1);
  assert.equal(f.insertLinkAtTarget(f.plugin, 'WRONG', undefined).inserted, false);
});

const api = 'https://api.example';
function asset(filename = 'photo.jpg', year = '2020', origin = api) {
  return { year, month: '01', filename, isProcessableImage: true,
    rawUrl: `${origin}/originals/${year}/01/${encodeURI(filename)}`,
    pubUrl: `${origin}/optimized/${year}/01/${encodeURI(filename)}.webp` };
}

function linkFixture(items, text = '') {
  const handlers = new Map(), copied = [], notices = [], requests = [];
  let failure = null;
  const loaded = loadPlugin(async request => {
    if (failure) throw failure;
    const url = new URL(request.url); requests.push(url);
    const q = url.searchParams.get('q') || '', limit = Number(url.searchParams.get('limit')) || items.length;
    const matches = items.filter(item => `${item.year}/${item.month}/${item.filename}`.includes(q));
    return { status: 200, json: { images: matches.slice(0, limit), totalCount: matches.length,
      optimizationEnabled: items[0]?.optimizationEnabled !== false } };
  }, { navigator: { clipboard: { writeText: async value => copied.push(value) } },
    host: { Notice: class { constructor(message) { notices.push(message); } } } });
  const file = { path: 'note.md', extension: 'md' };
  const plugin = new loaded.Plugin({
    workspace: { on: (name, callback) => { handlers.set(name, callback); return {}; }, getActiveFile: () => file },
    vault: { read: async () => text }, metadataCache: { getFirstLinkpathDest: () => null }
  });
  plugin.settings = { enableRemoteServer: true, serverVerified: true, serverUrl: api, apiToken: 'fixture' };
  plugin.registerEvent = () => {}; plugin.t = key => key;
  loaded.registerContextMenus(plugin);
  const menu = () => {
    const entries = [];
    return { entries, addItem(callback) {
      const entry = { setTitle(title) { this.title = title; return this; }, setIcon() { return this; }, onClick(fn) { this.click = fn; return this; } };
      callback(entry); entries.push(entry);
    } };
  };
  return { ...loaded, plugin, copied, notices, requests,
    fail(error) { failure = error; },
    async copyNote() {
      const m = menu(); handlers.get('file-menu')(m, file);
      return m.entries.find(entry => entry.title === 'menuActiveNoteAstro').click();
    },
    async copyWebp(url) {
      const m = menu(); handlers.get('editor-menu')(m, { getCursor: () => ({ line: 0 }), getLine: () => `![](${url})` });
      return m.entries.find(entry => entry.title === 'menuCopyWebp').click();
    }
  };
}

test('Note copy uses public URLs and preserves parameters, encoded names, aliases and unrelated links', async () => {
  const remote = asset('照片.jpg', '2020', 'https://public.example');
  remote.referenceUrls = ['https://public.example/originals/2020/01/old.jpg'];
  const other = 'https://other.example/originals/2020/01/照片.jpg';
  const text = `![](${remote.rawUrl}?size=1#image)\n![](${decodeURI(remote.rawUrl)})\n![](${remote.referenceUrls[0]})\n![](${other})\n![](${remote.rawUrl}.bak)`;
  const f = linkFixture([remote], text);
  await f.copyNote();
  assert.deepEqual(f.copied, [`![](${remote.pubUrl}?size=1#image)\n![](${decodeURI(remote.pubUrl)})\n![](${remote.pubUrl})\n![](${other})\n![](${remote.rawUrl}.bak)`]);
});

test('WebP menu resolves the actual file beyond 50 similar names and preserves query/fragment', async () => {
  const remote = asset();
  const others = Array.from({ length: 55 }, (_, i) => asset(`copy-${i}-photo.jpg`, '2026'));
  const f = linkFixture([...others, remote]);
  await f.copyWebp(remote.rawUrl + '?cache=1#image');
  assert.deepEqual(f.copied, [remote.pubUrl + '?cache=1#image']);
  assert.equal(f.requests[0].searchParams.has('limit'), false);
});

test('WebP menu resolves encoded alias URLs from server metadata', async () => {
  const remote = asset('照片.jpg');
  remote.referenceUrls = [api + '/originals/2020/01/old.jpg'];
  const f = linkFixture([remote]);
  await f.copyWebp(remote.referenceUrls[0] + '?cache=1');
  await f.copyWebp(remote.rawUrl);
  assert.deepEqual(f.copied, [remote.pubUrl + '?cache=1', remote.pubUrl]);
});

test('Unavailable optimization is a confirmed raw fallback, and note copy leaves it unchanged', async () => {
  const remote = { ...asset(), optimizationEnabled: false };
  const f = linkFixture([remote], `![](${remote.rawUrl})`);
  await f.copyWebp(remote.pubUrl + '?cache=1');
  await f.copyNote();
  assert.deepEqual(f.copied, [remote.rawUrl + '?cache=1', `![](${remote.rawUrl})`]);
  assert.ok(f.notices.includes('noticeCopiedRaw'));
});

test('Missing files and failed metadata requests never silently copy a raw fallback', async () => {
  const remote = asset(), f = linkFixture([], `![](${remote.rawUrl})`);
  await f.copyWebp(remote.rawUrl);
  assert.deepEqual(f.copied, []);
  assert.equal(f.notices.at(-1), 'remoteFileNotFound');
  f.fail(new Error('offline'));
  await f.copyWebp(remote.rawUrl);
  assert.equal(await f.copyNote(), false);
  assert.deepEqual(f.copied, []);
  assert.equal(f.notices.at(-1), 'galleryLoadFail');
});
