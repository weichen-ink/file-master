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
  { name: 'compatible', version: '1.0.1', code: 200, token: 'test', expected: true },
  { name: 'server_outdated', version: '0.1.0', code: 200, token: 'test', expected: false },
  { name: 'plugin_outdated', version: '1.0.1', minPluginVersion: '9.0.0', code: 200, token: 'test', expected: false },
  { name: 'token_missing', version: '1.0.1', code: 200, token: '', expected: false },
  { name: 'auth_failed', version: '1.0.1', code: 401, token: 'bad', expected: false },
  { name: 'server_error', version: '1.0.1', code: 503, token: 'test', expected: false }
]) {
  test(`Server handshake persists the correct readiness for ${scenario.name}`, async () => {
    const loaded = loadPlugin(async ({ url }) => url.endsWith('/version')
      ? { status: 200, json: { version: scenario.version, minPluginVersion: scenario.minPluginVersion || '1.0.0' } }
      : { status: scenario.code, json: { images: [] } });
    const plugin = new loaded.Plugin({}); plugin.manifest = { version: '1.0.7' };
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
