const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadPlugin } = require('./helpers/load-plugin');

function menuFixture() {
  const loaded = loadPlugin();
  const handlers = new Map();
  const plugin = new loaded.Plugin({ workspace: { on: (event, callback) => handlers.set(event, callback) } });
  plugin.settings = { enableRemoteServer: true, serverVerified: true, serverUrl: 'https://example.com', apiToken: 'test' };
  plugin.registerEvent = () => {};
  plugin.t = (key) => key;
  plugin.registerContextMenus();
  const entries = [];
  const menu = { addItem(callback) {
    const entry = { setTitle(title) { this.title = title; return this; }, setIcon() { return this; }, onClick(fn) { this.click = fn; return this; } };
    callback(entry); entries.push(entry);
  } };
  return { ...loaded, plugin, handlers, entries, menu };
}

test('Menu Integration: Markdown actions invoke migration, download and public-link commands', () => {
  const f = menuFixture();
  const file = { path: 'note.md', extension: 'md' };
  const invoked = [];
  for (const name of ['migrateActiveNoteAttachments', 'downloadActiveNoteRemoteAttachments', 'copyActiveNoteForAstro']) {
    f.plugin[name] = (target) => invoked.push([name, target]);
  }
  f.handlers.get('file-menu')(f.menu, file);
  assert.deepEqual(f.entries.map((e) => e.title), ['menuActiveNoteMigrate', 'menuActiveNoteDownload', 'menuActiveNoteAstro']);
  f.entries.forEach((entry) => entry.click());
  assert.equal(invoked.length, 3);
  assert.ok(invoked.every(([, target]) => target === file));
});

test('In-modal result: local image insertion preserves embed syntax and closes the modal', async () => {
  const { IncomingFileModal } = loadPlugin();
  let inserted;
  const app = { workspace: { getActiveFile: () => null },
    fileManager: { getAvailablePathForAttachment: async () => 'a.png', generateMarkdownLink: () => '[[a.png]]' },
    vault: { createBinary: async () => ({ path: 'a.png' }) } };
  const modal = new IncomingFileModal(app, { defaultBaseName: 'a', ext: 'png', arrayBuffer: new ArrayBuffer(1) },
    { editor: { replaceSelection: (value) => { inserted = value; } } });
  let closed = false;
  modal.close = () => { closed = true; };
  await modal.runExecution();
  assert.equal(closed, true);
  assert.equal(inserted, '![[a.png]]\n');
  assert.equal(modal.result.success, true);
});

test('Wizard result steps dispatch to batch and duplicate summaries', () => {
  const { BatchMigrateWizardModal, DuplicateWizardModal } = loadPlugin();
  for (const Wizard of [BatchMigrateWizardModal, DuplicateWizardModal]) {
    const modal = new Wizard({}, { settings: {} });
    const el = { empty() {}, addClass() {} };
    modal.contentEl = el;
    modal.step = 3;
    let rendered = false;
    modal.renderStep3 = (target) => { assert.equal(target, el); rendered = true; };
    modal.render();
    assert.equal(rendered, true);
  }
});

test('Remote gating: unverified servers expose no remote note actions', () => {
  const f = menuFixture();
  f.plugin.settings.serverVerified = false;
  f.handlers.get('file-menu')(f.menu, { extension: 'md' });
  assert.deepEqual(f.entries, []);
  assert.equal(f.plugin.isRemoteServerReady(), false);
});

test('Remote gallery command is registered and gated by server readiness', () => {
  const { plugin } = menuFixture();
  const commands = [];
  plugin.addCommand = (command) => commands.push(command);
  plugin.registerPluginCommands();
  const gallery = commands.find((command) => command.id === 'open-remote-gallery');
  assert.ok(gallery);
  assert.equal(gallery.checkCallback(true), true);
  plugin.settings.enableRemoteServer = false;
  assert.equal(gallery.checkCallback(true), false);
});

test('Gallery lifecycle: commands activate sidebar and unload preserves docked leaves', () => {
  const { plugin } = menuFixture();
  const commands = [];
  let activated = false, aborted = false;
  plugin.addCommand = (command) => commands.push(command);
  plugin.activateGalleryView = () => { activated = true; };
  plugin.activeTransferController = { abort: () => { aborted = true; } };
  plugin.app.workspace.detachLeavesOfType = () => { throw new Error('must preserve docked gallery'); };
  plugin.registerPluginCommands();
  commands.find((command) => command.id === 'open-remote-gallery-view').checkCallback(false);
  assert.equal(activated, true);
  plugin.onunload();
  assert.equal(aborted, true);
});

test('Batch report includes uploaded files and failures', async () => {
  const { Plugin } = loadPlugin();
  const plugin = new Plugin({});
  plugin.settings = { language: 'en' };
  let output;
  plugin.writeOrUpdateRootReport = async (name, contents) => { output = { name, contents }; };
  await plugin.exportBatchMigrateReportToRoot({ count: 1, docs: 2,
    processedItems: [{ name: 'a.png', rawUrl: 'https://example.com/a.png', size: 5 }], failures: [{ path: 'b.png', error: 'offline' }] });
  assert.match(output.name, /^Batch_Migrate_Report_/);
  assert.ok(output.contents.includes('https://example.com/a.png'));
  assert.ok(output.contents.includes('offline'));
});

test('Incoming attachment: unavailable remote destination falls back to local input', () => {
  const { IncomingFileModal } = loadPlugin();
  const modal = new IncomingFileModal({}, { defaultBaseName: 'a', ext: 'png' }, { fixedLocation: 'remote' });
  assert.equal(modal.step, 'input');
  assert.equal(modal.targetLocation, 'local');
  assert.equal(modal.finalFilename, 'a.png');
});
