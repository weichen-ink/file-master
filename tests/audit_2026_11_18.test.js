const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPlugin } = require('./helpers/load-plugin');
const { createVaultFixture } = require('./helpers/vault');

test('P0-1: Literal percent signs in notes do not break percent-encoded or relative link migration', async () => {
  const f = createVaultFixture(undefined, { fetch: async () => ({ ok: true }) });
  const asset = f.add('assets/my photo.png', 'PHOTO_BYTES', true);
  f.add('notes/sub/report.md', 'Completion is 100% today!\n\n![diagram](../../assets/my%20photo.png)');

  const result = await f.plugin.executeBatchMigrateSafely([{ rawObj: asset }], { deleteLocalAfter: true });
  assert.equal(result.count, 1);
  const updated = f.contents.get('notes/sub/report.md');
  assert.ok(updated.includes('Completion is 100% today!'));
  assert.ok(updated.includes('![diagram](https://example.com/raw/2026/11/my%20photo.png)'));
  assert.deepEqual(f.trashed, ['assets/my photo.png']);
});

test('P0-2: Markdown table escaped pipe WikiLinks scan cleanly and rewrite without corruption', async () => {
  const f = createVaultFixture(undefined, { fetch: async () => ({ ok: true }) });
  const asset = f.add('assets/photo.png', 'TABLE_IMG', true);
  const note = f.add('table.md', '| Col |\n| --- |\n| ![[assets/photo.png\\|200]] |');

  const broken = f.scanNoteContentForBrokenLinks(
    f.contents.get('table.md'),
    note.path,
    (linkPath) => (linkPath === 'assets/photo.png' ? asset : null)
  );
  assert.equal(broken.length, 0);

  const result = await f.plugin.executeBatchMigrateSafely([{ rawObj: asset }], { deleteLocalAfter: true });
  assert.equal(result.count, 1);
  assert.equal(
    f.contents.get('table.md'),
    '| Col |\n| --- |\n| ![200](https://example.com/raw/2026/11/photo.png) |'
  );
  assert.deepEqual(f.trashed, ['assets/photo.png']);
});

test('P0-3: Canvas file nodes convert to link nodes on remote migration and code spans stay untouched', () => {
  const { rewriteContentLinks } = loadPlugin();
  const localImg = {
    id: 'local:assets/board.png',
    source: 'local',
    name: 'board.png',
    displayPath: 'assets/board.png',
    ext: 'png'
  };
  const remoteImg = {
    id: 'remote:2026/11/board.png',
    source: 'remote',
    name: 'board.png',
    displayPath: '2026/11/board.png',
    ext: 'png',
    rawObj: { rawUrl: 'https://example.com/raw/2026/11/board.png' }
  };

  const canvasIn = JSON.stringify({
    nodes: [
      { id: 'n1', type: 'file', file: 'assets/board.png', x: 0, y: 0, width: 400, height: 300 },
      { id: 'n2', type: 'text', text: 'Keep `![[assets/board.png]]` in code and rewrite ![[assets/board.png]]' }
    ],
    edges: []
  });
  const canvasRemote = JSON.parse(rewriteContentLinks(canvasIn, localImg, remoteImg, 'boards/map.canvas'));
  assert.equal(canvasRemote.nodes[0].type, 'link');
  assert.equal(canvasRemote.nodes[0].url, 'https://example.com/raw/2026/11/board.png');
  assert.equal(canvasRemote.nodes[0].file, undefined);
  assert.ok(canvasRemote.nodes[1].text.includes('`![[assets/board.png]]`'));
  assert.ok(canvasRemote.nodes[1].text.includes('![](https://example.com/raw/2026/11/board.png)'));

  const canvasBackToLocal = JSON.parse(
    rewriteContentLinks(JSON.stringify(canvasRemote), remoteImg, localImg, 'boards/map.canvas')
  );
  assert.equal(canvasBackToLocal.nodes[0].type, 'file');
  assert.equal(canvasBackToLocal.nodes[0].file, 'assets/board.png');
  assert.equal(canvasBackToLocal.nodes[0].url, undefined);

  const mdWithCode = [
    'Inline `![[assets/board.png]]` example',
    '```markdown',
    '![[assets/board.png]]',
    '```',
    'Real embed: ![[assets/board.png]]'
  ].join('\n');
  const mdOut = rewriteContentLinks(mdWithCode, localImg, remoteImg, 'note.md');
  assert.ok(mdOut.includes('Inline `![[assets/board.png]]` example'));
  assert.ok(mdOut.includes('```markdown\n![[assets/board.png]]\n```'));
  assert.ok(mdOut.includes('Real embed: ![](https://example.com/raw/2026/11/board.png)'));
});

test('P0-3 & U-3: Duplicate merge rewrites folder-qualified .md WikiLinks and same-basename sibling folders safely', async () => {
  const f = createVaultFixture();
  const oldMd = f.add('Archive/DupNote.md', 'Identical note');
  const keepMd = f.add('Notes/CanonicalNote.md', 'Identical note');
  f.binaries.set(oldMd.path, new TextEncoder().encode('Identical note').buffer);
  f.binaries.set(keepMd.path, new TextEncoder().encode('Identical note').buffer);
  f.add('index.md', 'Read [[Archive/DupNote|Archived Copy]] and [[Archive/DupNote#Intro]]');

  const mdSha = await f.computeSha256Hex(new TextEncoder().encode('Identical note').buffer);
  let mergeSummary = null;
  await f.attachmentOps.executeDuplicateMergeSafely(
    f.plugin,
    [{
      sha256: mdSha,
      keepId: `local:${keepMd.path}`,
      items: [
        { id: `local:${keepMd.path}`, source: 'local', name: keepMd.name, displayPath: keepMd.path, ext: 'md', rawObj: keepMd },
        { id: `local:${oldMd.path}`, source: 'local', name: oldMd.name, displayPath: oldMd.path, ext: 'md', rawObj: oldMd }
      ]
    }],
    (res) => { mergeSummary = res; }
  );
  assert.equal(mergeSummary.skipped, 0);
  assert.equal(
    f.contents.get('index.md'),
    'Read [[Notes/CanonicalNote|Archived Copy]] and [[Notes/CanonicalNote#Intro]]'
  );
  assert.ok(f.trashed.includes('Archive/DupNote.md'));

  // U-3: Same-basename files in different folders (a/logo.png -> b/logo.png)
  const logoA = f.add('a/logo.png', 'SAME_LOGO', true);
  const logoB = f.add('b/logo.png', 'SAME_LOGO', true);
  f.add('brand.md', 'Header: ![[a/logo.png]]');
  const logoSha = await f.computeSha256Hex(new TextEncoder().encode('SAME_LOGO').buffer);
  let logoSummary = null;
  await f.attachmentOps.executeDuplicateMergeSafely(
    f.plugin,
    [{
      sha256: logoSha,
      keepId: `local:${logoB.path}`,
      items: [
        { id: `local:${logoB.path}`, source: 'local', name: logoB.name, displayPath: logoB.path, ext: 'png', rawObj: logoB },
        { id: `local:${logoA.path}`, source: 'local', name: logoA.name, displayPath: logoA.path, ext: 'png', rawObj: logoA }
      ]
    }],
    (res) => { logoSummary = res; }
  );
  assert.equal(logoSummary.skipped, 0);
  assert.equal(f.contents.get('brand.md'), 'Header: ![[b/logo.png]]');
  assert.ok(f.trashed.includes('a/logo.png'));
});

test('P0-4 & U-4: Reuse conflict strategy trashes local original cleanly, and single-file upload preserves batch checkpoint', async () => {
  const f = createVaultFixture(undefined, { fetch: async () => ({ ok: true }) });
  const localAsset = f.add('assets/banner.png', 'LOCAL_BANNER_V1', true);
  f.add('post.md', '![[assets/banner.png]]');

  // Server already has banner.png with different bytes; user chooses 'reuse'
  const result = await f.plugin.executeBatchMigrateSafely(
    [{
      rawObj: localAsset,
      hasConflict: true,
      conflict: {
        year: '2026',
        month: '10',
        filename: 'banner.png',
        sha256: 'f'.repeat(64),
        rawUrl: 'https://example.com/raw/2026/10/banner.png'
      }
    }],
    { conflictStrategy: 'reuse', deleteLocalAfter: true }
  );
  assert.equal(result.count, 1);
  assert.equal(result.trashFailures.length, 0);
  assert.equal(f.contents.get('post.md'), '![](https://example.com/raw/2026/10/banner.png)');
  assert.deepEqual(f.trashed, ['assets/banner.png']);
  assert.equal(f.journal.has(f.migrationCheckpointPath(f.plugin)), false);

  // U-4: Existing batch checkpoint is not wiped by single-file upload
  const pendingPath = f.migrationCheckpointPath(f.plugin);
  const existingCheckpoint = JSON.stringify({ version: 1, items: [{ path: 'assets/queued.png', locked: false }], options: {} });
  f.journal.set(pendingPath, existingCheckpoint);
  const single = f.add('assets/single.png', 'SINGLE_DATA', true);
  f.add('single.md', '![[assets/single.png]]');
  await f.attachmentOps.migrateSingleLocalFileToRemote(f.plugin, single, { deleteLocal: true });
  assert.equal(f.journal.get(pendingPath), existingCheckpoint);
});

test('P0-6: documentRow click opens note at target line while mouseenter only triggers hover preview', async () => {
  const f = createVaultFixture();
  const doc = f.add('Notes/Target.md', 'Line 1\nLine 2\nLine 3');
  let hovered = 0;
  let openedFile = null;
  let cursorPos = null;
  let closedModal = false;

  f.plugin.app.workspace.trigger = (name) => {
    if (name === 'hover-link') hovered += 1;
  };
  f.plugin.app.workspace.getLeaf = () => ({
    openFile: async (file) => { openedFile = file; },
    view: {
      editor: {
        setCursor: (pos) => { cursorPos = pos; },
        scrollIntoView: () => {}
      }
    }
  });

  const makeEl = (tag = 'div') => {
    const listeners = {};
    const children = [];
    return {
      tag,
      listeners,
      children,
      addEventListener(type, fn) { listeners[type] = fn; },
      createEl(t, opts = {}) { const c = makeEl(t); Object.assign(c, opts); children.push(c); return c; },
      createDiv(opts = {}) { const c = makeEl('div'); Object.assign(c, opts); children.push(c); return c; },
      createSpan(opts = {}) { const c = makeEl('span'); Object.assign(c, opts); children.push(c); return c; }
    };
  };

  const parent = makeEl();
  const rendered = f.documentRow(parent, f.plugin, { path: doc.path, line: 3 });
  const rowEl = rendered.row || rendered;
  const nameEl = rowEl.children[0].children[1].children[0];

  nameEl.listeners.mouseenter({ currentTarget: nameEl });
  assert.equal(hovered, 1);
  assert.equal(openedFile, null);

  await nameEl.onclick({ preventDefault() {}, stopPropagation() {} });
  assert.equal(openedFile, doc);
  assert.deepEqual(cursorPos, { line: 2, ch: 0 });

  // Custom onSelect callback (e.g. closing modal before navigation)
  const parent2 = makeEl();
  const rendered2 = f.documentRow(parent2, f.plugin, { path: doc.path, line: 2 }, {
    onSelect: (p, ln) => { closedModal = p === doc.path && ln === 2; }
  });
  const rowEl2 = rendered2.row || rendered2;
  await rowEl2.children[0].children[1].children[0].onclick({ preventDefault() {}, stopPropagation() {} });
  assert.equal(closedModal, true);
});

test('U-1 & U-2: Parentheses in remote filenames and WebP pubUrl links work across scan, download, and rename', async () => {
  const rawBytes = new TextEncoder().encode('DIAGRAM_PNG_BYTES').buffer;
  const f = createVaultFixture(async () => ({
    status: 200,
    arrayBuffer: rawBytes,
    headers: {}
  }), { fetch: async () => ({ ok: true }) });
  const rawAsset = {
    year: '2026',
    month: '11',
    filename: 'architecture-diagram (v2).png',
    size: rawBytes.byteLength,
    sha256: await f.computeSha256Hex(rawBytes),
    rawUrl: 'https://example.com/raw/2026/11/architecture-diagram%20(v2).png',
    pubUrl: 'https://example.com/pub/2026/11/architecture-diagram%20(v2).webp'
  };
  f.plugin.fetchRemoteFileList = async () => [rawAsset];

  const note = f.add(
    'arch.md',
    'WebP: ![pub](https://example.com/pub/2026/11/architecture-diagram%20(v2).webp)\nRaw: ![arch](https://example.com/raw/2026/11/architecture-diagram%20%28v2%29.png)'
  );
  const scanned = await f.attachmentOps.scanActiveNoteRemoteAttachments(f.plugin, note);
  assert.equal(scanned.length, 1);
  assert.equal(scanned[0].filename, 'architecture-diagram (v2).png');
  assert.equal(scanned[0].size, rawBytes.byteLength);

  // Download from WebP pubUrl resolves back to rawAsset and rewrites both links to local attachment
  await f.plugin.executeDownloadNoteDirect(note, null, { items: [scanned[0]] });
  assert.ok(f.contents.get('arch.md').includes('architecture-diagram (v2).png'));
  assert.ok(!f.contents.get('arch.md').includes('https://example.com/pub/'));
});
