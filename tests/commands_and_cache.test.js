const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadPlugin } = require('./helpers/load-plugin');

test('All 13 registered commands enforce remote gating and execute cleanly', async () => {
  const opened = [];
  const commands = [];
  const loaded = loadPlugin(async (req) => {
    const url = String(req?.url || '');
    if (url.includes('/api/modules/image-host/list')) {
      return { status: 200, json: { items: [], totalCount: 0, buckets: [] } };
    }
    if (url.includes('/api/platform/version')) {
      return { status: 200, json: { version: '1.2.8', minPluginVersion: '1.2.9', apiVersion: 1 } };
    }
    if (url.includes('/api/platform/status')) {
      return { status: 200, json: { initialized: true, version: '1.2.8' } };
    }
    return { status: 200, json: {} };
  }, {
    onModalOpen: (modal) => opened.push(modal),
    navigator: { clipboard: { writeText: async () => {} } }
  });

  const activeFile = { path: 'note.md', name: 'note.md', basename: 'note', extension: 'md', stat: { size: 20, mtime: 1 } };
  const app = {
    vault: {
      getFiles: () => [activeFile],
      getAbstractFileByPath: (p) => (p === 'note.md' ? activeFile : null),
      cachedRead: async () => '![](https://example.com/raw/2026/11/a.png)',
      read: async () => '![](https://example.com/raw/2026/11/a.png)',
      adapter: { exists: async () => false, read: async () => '' }
    },
    workspace: {
      on: () => ({}),
      offref: () => {},
      getActiveFile: () => activeFile,
      getLeavesOfType: () => [],
      getRightLeaf: () => ({ setViewState: async () => {} }),
      revealLeaf: () => {}
    },
    fileManager: { getNewFileParent: () => ({ path: '' }) }
  };

  const plugin = new loaded.Plugin(app);
  plugin.manifest = { id: 'file-master', version: '1.2.9' };
  plugin.settings = { enableRemoteServer: false, serverVerified: false, serverUrl: 'https://example.com', apiToken: 'tok', language: 'en' };
  plugin.addCommand = (cmd) => commands.push(cmd);
  plugin.registerEvent = () => {};
  plugin.registerView = () => {};
  plugin.addRibbonIcon = () => ({ setAttribute: () => {}, addClass: () => {} });
  plugin.addSettingTab = () => {};
  plugin.t = (k) => k;
  plugin.isRemoteServerReady = () => Boolean(plugin.settings.enableRemoteServer && plugin.settings.serverVerified);
  plugin.getCleanServerUrl = () => 'https://example.com';
  plugin.fetchRemoteFileList = async () => [];
  plugin.heicPreviewCache = new Map();
  plugin.heicPreviewPending = new Map();

  loaded.registerPluginCommands(plugin);
  assert.equal(commands.length, 13);

  // Offline: remote-only commands return false on checkCallback(true)
  const remoteIds = new Set([
    'resume-pending-upload',
    'open-remote-gallery',
    'open-remote-gallery-view',
    'open-batch-migrate-wizard',
    'migrate-current-note-attachments',
    'download-current-note-remote-attachments',
    'copy-note-with-astro-pub-links'
  ]);
  for (const cmd of commands) {
    assert.equal(Boolean(cmd.checkCallback(true)), !remoteIds.has(cmd.id), `offline check failed for ${cmd.id}`);
  }

  // Online: all 13 commands are enabled and execute without throwing
  plugin.settings.enableRemoteServer = true;
  plugin.settings.serverVerified = true;
  for (const cmd of commands) {
    assert.equal(cmd.checkCallback(true), true, `online check failed for ${cmd.id}`);
    cmd.checkCallback(false);
  }
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(opened.length >= 7);
});

test('refreshRemoteImageCache reloads targeted and encoded DOM images without altering markdown', async () => {
  const loaded = loadPlugin();
  const fetched = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    fetched.push({ url, cache: opts?.cache });
    return { ok: true };
  };

  try {
    const imgMatch = {
      src: 'https://example.com/raw/2026/11/%E6%B5%8B%E8%AF%95.png',
      getAttribute: (name) => (name === 'src' ? imgMatch.src : null)
    };
    const imgOtherHost = {
      src: 'https://other.org/pic.png',
      getAttribute: (name) => (name === 'src' ? imgOtherHost.src : null)
    };
    const app = {
      workspace: {
        iterateAllLeaves: (cb) => cb({ view: { containerEl: { querySelectorAll: () => [imgMatch, imgOtherHost] } } })
      }
    };
    const plugin = new loaded.Plugin(app);
    plugin.getCleanServerUrl = () => 'https://example.com';
    plugin.heicPreviewCache = new Map([['a.heic:1', 'blob:fake']]);

    // Targeted refresh matches decoded CJK URL and leaves other hosts untouched
    const res1 = await loaded.refreshRemoteImageCache(plugin, ['https://example.com/raw/2026/11/测试.png']);
    assert.equal(res1.refreshedImages, 1);
    assert.match(imgMatch.src, /_fm_refresh=\d+/);
    assert.equal(imgOtherHost.src, 'https://other.org/pic.png');
    assert.equal(fetched.every((f) => f.cache === 'reload'), true);
    assert.equal(plugin.heicPreviewCache.size, 1);

    // Full refresh clears heicPreviewCache and strips prior _fm_refresh before appending new timestamp
    const res2 = await loaded.refreshRemoteImageCache(plugin);
    assert.equal(res2.refreshedImages, 1);
    assert.equal((imgMatch.src.match(/_fm_refresh=/g) || []).length, 1);
    assert.equal(plugin.heicPreviewCache.size, 0);
  } finally {
    globalThis.fetch = origFetch;
  }
});
