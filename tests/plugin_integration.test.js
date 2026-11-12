const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPlugin } = require('./helpers/load-plugin');
const { Element, Setting } = require('./helpers/ui');

test('Settings tools open the hub and log modals with the correct host and plugin', async () => {
  const opened = [];
  const loaded = loadPlugin(undefined, { host: { Setting, setIcon() {} },
    setTimeout: (fn) => fn(), onModalOpen: (modal) => opened.push(modal) });
  const app = {};
  const plugin = new loaded.Plugin(app);
  plugin.settings = { language: 'en' };
  const tab = new loaded.FileMasterSettingTab(app, plugin);
  tab.containerEl = new Element();
  tab.display();
  // Use translation keys here so copy edits cannot hide a missing navigation control.
  for (const key of ['openHubName', 'opLogTitle']) {
    const row = tab.containerEl.all().find((el) => el.name === plugin.t(key));
    assert.ok(row, key);
    row.onclick();
  }
  await new Promise(setImmediate);
  assert.equal(opened.length, 2);
  assert.ok(opened[0] instanceof loaded.FileMasterHubModal);
  assert.ok(opened[1] instanceof loaded.OperationLogModal);
  assert.ok(opened.every((modal) => modal.app === app && modal.plugin === plugin));
});

test('Wizard setup uses vault folders and exclusion settings without forwarding methods', () => {
  const loaded = loadPlugin();
  const plugin = new loaded.Plugin({ vault: { getFiles: () => [{ parent: { path: 'assets' } }] } });
  plugin.settings = { language: 'en', excludedLocalFolders: 'private, templates' };
  for (const Wizard of [loaded.BatchMigrateWizardModal, loaded.DuplicateWizardModal, loaded.OrphanWizardModal]) {
    const modal = new Wizard(plugin.app, plugin);
    const tree = new Element();
    modal.renderStep1(tree);
    const nodes = tree.all();
    if (Wizard === loaded.BatchMigrateWizardModal) {
      assert.ok(nodes.some((node) => node.tag === 'option' && node.value === 'assets'));
    } else {
      assert.ok(nodes.some((node) => String(node.text).includes('private') && String(node.text).includes('templates')));
      for (const empty of ['', '  , ; \n']) {
        plugin.settings.excludedLocalFolders=empty;
        const cleanTree=new Element();modal.renderStep1(cleanTree);
        assert.equal(cleanTree.all().some(node=>node.className==='fm-exclusion-hint'),false);
      }
      plugin.settings.excludedLocalFolders='private, templates';
    }
  }
});

test('Operation log modal loads persisted entries without an internal plugin method', async () => {
  const loaded = loadPlugin();
  const plugin = new loaded.Plugin({ vault: { adapter: {
    exists: async () => true, read: async () => '{"summary":"persisted"}\n'
  } } });
  const modal = new loaded.OperationLogModal(plugin.app, plugin);
  modal.render = () => {};
  await modal.onOpen();
  assert.equal(plugin.operationLogs[0].summary, 'persisted');
});

test('Release onload registers clipboard, commands and menus through explicit modules', async () => {
  const handlers = new Map(), commands = [], settingsTabs = [], opened = [];
  const loaded = loadPlugin(undefined, { setTimeout(fn, delay) { if (delay === 40) fn(); },
    onModalOpen: (modal) => opened.push(modal) });
  const app = { vault: { on: () => ({}) }, workspace: {
    on(event, callback) { handlers.set(event, callback); return {}; }, onLayoutReady() {}, getActiveFile: () => null
  } };
  const plugin = new loaded.Plugin(app);
  plugin.loadData = async () => ({ enableSidebarButton: false, enableClipboardMonitor: true,
    enableRemoteServer: true, serverVerified: true, uploadNonImageAttachments: true });
  plugin.addSettingTab = (tab) => settingsTabs.push(tab);
  plugin.addCommand = (command) => commands.push(command);
  plugin.registerEvent = () => {};
  plugin.registerView = () => {};
  plugin.registerHoverLinkSource=(id,options)=>{assert.equal(id,'file-master');assert.equal(options.defaultMod,false);};
  await plugin.onload();
  assert.ok(commands.some((command) => command.id === 'resume-pending-upload'));
  assert.equal(settingsTabs.length, 1);
  assert.ok(handlers.has('file-menu'));
  let prevented = false;
  const file = { name: 'scan.pdf', type: 'application/pdf', arrayBuffer: async () => new Uint8Array([1]).buffer };
  await handlers.get('editor-paste')({ clipboardData: { files: [file] }, preventDefault() { prevented = true; } }, {});
  assert.equal(prevented, true);
  assert.equal(opened.length, 1, 'non-image attachments should reach the incoming-file modal');
  plugin.onunload();
});

test('Upgrade restoration reuses the existing gallery and removes duplicate tabs without creating new leaves', async () => {
  const handlers = new Map();
  const emit = event => handlers.get(event)?.forEach(callback => callback());
  let ready, created = 0;
  let leaves = [];
  const loaded = loadPlugin(undefined, { setTimeout() {}, document: { querySelectorAll: () => [] } });
  const workspace = {
    on(event, callback) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event).push(callback);
      return {};
    },
    onLayoutReady(callback) { ready ||= callback; },
    getActiveViewOfType: () => null,
    getLeavesOfType: () => leaves,
    getRightLeaf() { created++; throw new Error('Restoration must not create a leaf'); }
  };
  const plugin = new loaded.Plugin({ vault: { on: () => ({}) }, workspace });
  plugin.loadData = async () => ({ enableSidebarButton: false, enableRemoteServer: true, serverVerified: true });
  plugin.addSettingTab = plugin.addCommand = plugin.registerEvent = plugin.registerView = () => {};
  await plugin.onload();
  // During Obsidian's asynchronous view replacement the old leaf is temporarily absent.
  ready();
  assert.equal(created, 0);
  const makeLeaf = () => ({ detach() {
    leaves = leaves.filter(leaf => leaf !== this);
    emit('layout-change');
  } });
  const original = makeLeaf(), duplicate = makeLeaf();
  leaves = [original, duplicate];
  workspace.activeLeaf = duplicate;
  emit('layout-change');
  assert.deepEqual(leaves, [duplicate], 'retain the active gallery and its dock position');
  assert.equal(created, 0);
  assert.equal(await loaded.initGalleryLeaf(plugin), duplicate);
  // Late callbacks from an unloaded instance cannot remove the new instance's tabs.
  plugin.onunload();
  leaves = [original, duplicate];
  ready();
  emit('layout-change');
  assert.equal(leaves.length, 2);
  assert.equal(await loaded.initGalleryLeaf(plugin), null);
});
