const { loadPlugin } = require('./load-plugin');
const bytes = (value) => new TextEncoder().encode(value).buffer;

function createVaultFixture(requestUrl, globals = {}) {
  const loaded = loadPlugin(requestUrl, globals);
  const { Plugin, computeSha256Hex, migrationCheckpointPath } = loaded;
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
    getFirstLinkpathDest: (ref) => files.find((file) => file.path === ref || file.name === ref) }, workspace: { getLeavesOfType: () => [] } });
  plugin.settings = { language: 'en', serverUrl: 'https://example.com', deleteLocalAfterMigrate: true };
  // Most fixtures stub the complete-list client; browsers consume its structured page equivalent.
  plugin.fetchRemoteFilePage = async options => {
    const items=await plugin.fetchRemoteFileList(options);
    return {items,totalCount:items.length,buckets:[...new Set(items.map(item=>`${item.year}/${item.month}`))]};
  };
  plugin.manifest = { dir: 'test-plugin' };
  plugin.logOperation = () => {};
  plugin.uploadBufferToServer = async (buffer, filename) => ({ filename, year: '2026', month: '11',
    rawUrl: `https://example.com/raw/2026/11/${filename}`, sha256: await computeSha256Hex(buffer) });
  return { ...loaded, plugin, files, contents, binaries, journal, writes, trashed, add, computeSha256Hex, migrationCheckpointPath };
}

module.exports = { createVaultFixture, bytes };
