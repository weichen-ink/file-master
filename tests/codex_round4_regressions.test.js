const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadPlugin } = require('./helpers/load-plugin');
const { createVaultFixture } = require('./helpers/vault');

function attachPosixResolver(f) {
  f.plugin.app.metadataCache.getFirstLinkpathDest = (ref, doc = '') => {
    let decoded = String(ref || '');
    try { decoded = decodeURIComponent(decoded); } catch {}
    const docDir = doc && doc.includes('/') ? path.posix.dirname(doc) : '';
    if (decoded.startsWith('./') || decoded.startsWith('../')) {
      const joined = docDir ? `${docDir}/${decoded}` : decoded;
      const parts = joined.split('/');
      const stack = [];
      for (const part of parts) {
        if (!part || part === '.') continue;
        if (part === '..') {
          if (!stack.length) return null;
          stack.pop();
        } else {
          stack.push(part);
        }
      }
      const normalized = stack.join('/');
      return f.files.find((file) => file.path === normalized || (file.extension === 'md' && file.path === `${normalized}.md`)) || null;
    }
    const clean = decoded.replace(/^\/+/, '');
    if (clean.includes('/')) {
      return f.files.find((file) => file.path === clean || (file.extension === 'md' && file.path === `${clean}.md`)) || null;
    }
    const matches = f.files.filter((file) => file.name === clean || (file.extension === 'md' && file.basename === clean));
    return matches.length === 1 ? matches[0] : null;
  };
}

test('FM-01: Migrating root assets/logo.png never rewrites ../assets/logo.png or ./logo.png pointing to other folders', async () => {
  const f = createVaultFixture(undefined, { fetch: async () => ({ ok: true }) });
  const rootAsset = f.add('assets/logo.png', 'ROOT_LOGO', true);
  const siblingAsset = f.add('notes/assets/logo.png', 'SIBLING_LOGO', true);
  const subLocalAsset = f.add('notes/sub/logo.png', 'SUB_LOCAL_LOGO', true);
  const spacedSibling = f.add('notes/assets/my logo.png', 'SPACED_SIBLING', true);
  const spacedRoot = f.add('assets/my logo.png', 'SPACED_ROOT', true);
  attachPosixResolver(f);

  const noteBefore = [
    'Root wiki: ![[assets/logo.png]]',
    'Root deep relative: ![root-rel](../../assets/logo.png)',
    'Root spaced relative: ![root-space](../../assets/my%20logo.png)',
    'Sibling relative: ![](../assets/logo.png)',
    'Sibling spaced: ![](../assets/my%20logo.png)',
    'Same-dir dot: ![](./logo.png)'
  ].join('\n');
  f.add('notes/sub/note.md', noteBefore);

  // Reference scan for sibling/subLocal must not confuse them with rootAsset
  const rootRefs = await f.fileReferenceDocuments(f.plugin, { source: 'local', rawObj: rootAsset });
  assert.deepEqual(rootRefs, [{ path: 'notes/sub/note.md', references: 2 }]);
  const siblingRefs = await f.fileReferenceDocuments(f.plugin, { source: 'local', rawObj: siblingAsset });
  assert.deepEqual(siblingRefs, [{ path: 'notes/sub/note.md', references: 1 }]);
  const subRefs = await f.fileReferenceDocuments(f.plugin, { source: 'local', rawObj: subLocalAsset });
  assert.deepEqual(subRefs, [{ path: 'notes/sub/note.md', references: 1 }]);
  const spacedSiblingRefs = await f.fileReferenceDocuments(f.plugin, { source: 'local', rawObj: spacedSibling });
  assert.deepEqual(spacedSiblingRefs, [{ path: 'notes/sub/note.md', references: 1 }]);

  const migration = await f.plugin.executeBatchMigrateSafely(
    [{ rawObj: rootAsset }, { rawObj: spacedRoot }],
    { deleteLocalAfter: true }
  );
  assert.equal(migration.count, 2);

  const noteAfter = f.contents.get('notes/sub/note.md');
  assert.equal(
    noteAfter,
    [
      'Root wiki: ![](https://example.com/raw/2026/11/logo.png)',
      'Root deep relative: ![root-rel](https://example.com/raw/2026/11/logo.png)',
      'Root spaced relative: ![root-space](https://example.com/raw/2026/11/my%20logo.png)',
      'Sibling relative: ![](../assets/logo.png)',
      'Sibling spaced: ![](../assets/my%20logo.png)',
      'Same-dir dot: ![](./logo.png)'
    ].join('\n')
  );
  assert.deepEqual(f.trashed.sort(), ['assets/logo.png', 'assets/my logo.png']);
});

test('FM-01: Duplicate merge only rewrites relative links that resolve to the removed duplicate', async () => {
  const f = createVaultFixture(undefined, { fetch: async () => ({ ok: true }) });
  const keepLogo = f.add('brand/logo.png', 'DUP_BYTES', true);
  const removeRootLogo = f.add('assets/logo.png', 'DUP_BYTES', true);
  f.add('notes/assets/logo.png', 'DIFFERENT_SIBLING_BYTES', true);
  attachPosixResolver(f);

  f.add(
    'notes/sub/doc.md',
    'Remove me: ![](../../assets/logo.png)\nKeep sibling untouched: ![](../assets/logo.png)'
  );

  const dupSha = await f.computeSha256Hex(new TextEncoder().encode('DUP_BYTES').buffer);
  let summary = null;
  await f.attachmentOps.executeDuplicateMergeSafely(
    f.plugin,
    [{
      sha256: dupSha,
      keepId: `local:${keepLogo.path}`,
      items: [
        { id: `local:${keepLogo.path}`, source: 'local', name: keepLogo.name, displayPath: keepLogo.path, ext: 'png', rawObj: keepLogo },
        { id: `local:${removeRootLogo.path}`, source: 'local', name: removeRootLogo.name, displayPath: removeRootLogo.path, ext: 'png', rawObj: removeRootLogo }
      ]
    }],
    (res) => { summary = res; }
  );
  assert.equal(summary.skipped, 0);
  assert.equal(
    f.contents.get('notes/sub/doc.md'),
    'Remove me: ![[brand/logo.png]]\nKeep sibling untouched: ![](../assets/logo.png)'
  );
  assert.deepEqual(f.trashed, ['assets/logo.png']);
});

test('FM-02: Fragments (#page=5, #t=30) and titles survive local<->remote across WikiLinks, Markdown, and Canvas', async () => {
  const f = createVaultFixture(undefined, { fetch: async () => ({ ok: true }) });
  const pdf = f.add('assets/manual.pdf', 'PDF_FIXTURE', true);
  const video = f.add('assets/demo.mp4', 'MP4_FIXTURE', true);

  const mdBefore = [
    '![[assets/manual.pdf#page=5]]',
    '[[assets/manual.pdf#page=3|Chapter 3]]',
    '[manual](assets/manual.pdf#page=7 "Page seven")',
    '![[assets/demo.mp4#t=30]]',
    '`![[assets/manual.pdf#page=9]]`',
    '![[assets/manual.pdf]]'
  ].join('\n');
  f.add('guide.md', mdBefore);

  const canvasBefore = JSON.stringify({
    nodes: [
      { id: 'a', type: 'file', file: 'assets/manual.pdf', subpath: '#page=5', x: 0, y: 0, width: 300, height: 200 }
    ],
    edges: []
  });
  f.add('board.canvas', canvasBefore);

  const migration = await f.plugin.executeBatchMigrateSafely(
    [{ rawObj: pdf }, { rawObj: video }],
    { deleteLocalAfter: true }
  );
  assert.equal(migration.count, 2);
  assert.deepEqual(f.trashed.sort(), ['assets/demo.mp4', 'assets/manual.pdf']);

  assert.equal(
    f.contents.get('guide.md'),
    [
      '[📎 manual.pdf](https://example.com/raw/2026/11/manual.pdf#page=5)',
      '[Chapter 3](https://example.com/raw/2026/11/manual.pdf#page=3)',
      '[manual](https://example.com/raw/2026/11/manual.pdf#page=7 "Page seven")',
      '[📎 demo.mp4](https://example.com/raw/2026/11/demo.mp4#t=30)',
      '`![[assets/manual.pdf#page=9]]`',
      '[📎 manual.pdf](https://example.com/raw/2026/11/manual.pdf)'
    ].join('\n')
  );

  const canvasRemote = JSON.parse(f.contents.get('board.canvas'));
  assert.deepEqual(canvasRemote.nodes[0], {
    id: 'a',
    type: 'link',
    url: 'https://example.com/raw/2026/11/manual.pdf#page=5',
    x: 0,
    y: 0,
    width: 300,
    height: 200
  });

  // Reverse direction: remote -> local preserves fragments in Markdown and Canvas
  const { rewriteContentLinks } = loadPlugin();
  const remotePdf = {
    source: 'remote',
    name: 'manual.pdf',
    displayPath: '2026/11/manual.pdf',
    ext: 'pdf',
    rawObj: { rawUrl: 'https://example.com/raw/2026/11/manual.pdf' }
  };
  const localPdf = {
    source: 'local',
    name: 'manual.pdf',
    displayPath: 'downloads/manual.pdf',
    ext: 'pdf'
  };

  assert.equal(
    rewriteContentLinks('[manual](https://example.com/raw/2026/11/manual.pdf#page=5 "Title")', remotePdf, localPdf, 'guide.md'),
    '[manual](downloads/manual.pdf#page=5 "Title")'
  );
  assert.equal(
    rewriteContentLinks('[manual](https://example.com/raw/2026/11/manual.pdf#page=5)', remotePdf, localPdf, 'guide.md'),
    '[[downloads/manual.pdf#page=5|manual]]'
  );
  assert.equal(
    rewriteContentLinks('![](https://example.com/raw/2026/11/manual.pdf#page=2)', remotePdf, localPdf, 'guide.md'),
    '![[downloads/manual.pdf#page=2]]'
  );

  const canvasBack = JSON.parse(
    rewriteContentLinks(JSON.stringify(canvasRemote), remotePdf, localPdf, 'board.canvas')
  );
  assert.deepEqual(canvasBack.nodes[0], {
    id: 'a',
    type: 'file',
    file: 'downloads/manual.pdf',
    subpath: '#page=5',
    x: 0,
    y: 0,
    width: 300,
    height: 200
  });
});

test('R1: Unprefixed subdirectory Markdown links (assets/logo.png) honor resolver over root path in migration and dedup', async () => {
  // 1. Batch migration with both root assets/logo.png and notes/sub/assets/logo.png
  {
    const f = createVaultFixture(undefined, { fetch: async () => ({ ok: true }) });
    const rootAsset = f.add('assets/logo.png', 'ROOT_BYTES', true);
    const subAsset = f.add('notes/sub/assets/logo.png', 'SIBLING_BYTES', true);
    const docPath = 'notes/sub/note.md';
    f.add(docPath, 'Root: ![](../../assets/logo.png)\nSibling: ![](assets/logo.png)');

    f.plugin.app.metadataCache.getFirstLinkpathDest = (ref, doc = '') => {
      const decoded = decodeURIComponent(ref);
      const docDir = doc && doc.includes('/') ? path.posix.dirname(doc) : '';
      const rel = path.posix.normalize(path.posix.join(docDir, decoded));
      return f.files.find((file) => file.path === rel) || null;
    };

    assert.deepEqual(
      await f.fileReferenceDocuments(f.plugin, { source: 'local', rawObj: rootAsset }),
      [{ path: docPath, references: 1 }]
    );
    assert.deepEqual(
      await f.fileReferenceDocuments(f.plugin, { source: 'local', rawObj: subAsset }),
      [{ path: docPath, references: 1 }]
    );

    const migration = await f.plugin.executeBatchMigrateSafely(
      [{ rawObj: rootAsset }],
      { deleteLocalAfter: true }
    );
    assert.equal(migration.count, 1);
    assert.equal(
      f.contents.get(docPath),
      'Root: ![](https://example.com/raw/2026/11/logo.png)\nSibling: ![](assets/logo.png)'
    );
    assert.deepEqual(f.trashed, ['assets/logo.png']);
  }

  // 2. Duplicate merge with both root assets/logo.png and notes/sub/assets/logo.png
  {
    const f = createVaultFixture(undefined, { fetch: async () => ({ ok: true }) });
    const keepLogo = f.add('brand/logo.png', 'DUP_ROOT_BYTES', true);
    const removeRootLogo = f.add('assets/logo.png', 'DUP_ROOT_BYTES', true);
    f.add('notes/sub/assets/logo.png', 'DISTINCT_SUB_BYTES', true);
    const docPath = 'notes/sub/doc.md';
    f.add(docPath, 'Remove: ![](../../assets/logo.png)\nSibling: ![](assets/logo.png)');

    f.plugin.app.metadataCache.getFirstLinkpathDest = (ref, doc = '') => {
      const decoded = decodeURIComponent(ref);
      const docDir = doc && doc.includes('/') ? path.posix.dirname(doc) : '';
      const rel = path.posix.normalize(path.posix.join(docDir, decoded));
      return f.files.find((file) => file.path === rel) || f.files.find((file) => file.path === decoded) || null;
    };

    const dupSha = await f.computeSha256Hex(new TextEncoder().encode('DUP_ROOT_BYTES').buffer);
    let summary = null;
    await f.attachmentOps.executeDuplicateMergeSafely(
      f.plugin,
      [{
        sha256: dupSha,
        keepId: `local:${keepLogo.path}`,
        items: [
          { id: `local:${keepLogo.path}`, source: 'local', name: keepLogo.name, displayPath: keepLogo.path, ext: 'png', rawObj: keepLogo },
          { id: `local:${removeRootLogo.path}`, source: 'local', name: removeRootLogo.name, displayPath: removeRootLogo.path, ext: 'png', rawObj: removeRootLogo }
        ]
      }],
      (res) => { summary = res; }
    );
    assert.equal(summary.skipped, 0);
    assert.equal(
      f.contents.get(docPath),
      'Remove: ![[brand/logo.png]]\nSibling: ![](assets/logo.png)'
    );
    assert.deepEqual(f.trashed, ['assets/logo.png']);
  }
});

test('R2: Markdown links with titles preserve title, fragment, and label on remote download and local duplicate merge', async () => {
  // 1. Remote download back to local vault
  {
    const pdfBytes = new TextEncoder().encode('REMOTE_PDF_BYTES').buffer;
    const f = createVaultFixture(async () => ({ status: 200, arrayBuffer: pdfBytes }));
    const sha256 = await f.computeSha256Hex(pdfBytes);
    const remoteItem = {
      year: '2026',
      month: '11',
      filename: 'manual.pdf',
      sha256,
      size: pdfBytes.byteLength,
      rawUrl: 'https://example.com/raw/2026/11/manual.pdf',
      pubUrl: ''
    };
    f.plugin.fetchRemoteFileList = async () => [remoteItem];
    f.plugin.settings.apiToken = 'test-token';

    const note = f.add(
      'chapter.md',
      [
        '[manual](https://example.com/raw/2026/11/manual.pdf#page=5 "Chapter five")',
        '[plain](https://example.com/raw/2026/11/manual.pdf#page=2)'
      ].join('\n')
    );

    await f.attachmentOps.downloadSingleRemoteItemToLocal(
      f.plugin,
      {
        year: '2026',
        month: '11',
        filename: 'manual.pdf',
        matchedUrl: remoteItem.rawUrl,
        rawObj: remoteItem
      },
      { activeFile: note, silent: true }
    );

    assert.equal(
      f.contents.get('chapter.md'),
      [
        '[manual](downloads/manual.pdf#page=5 "Chapter five")',
        '[[downloads/manual.pdf#page=2|plain]]'
      ].join('\n')
    );
  }

  // 2. Local duplicate merge with titled Markdown links & image embeds (including spaced paths)
  {
    const f = createVaultFixture();
    const keepPdf = f.add('library/my manual.pdf', 'SAME_PDF', true);
    const dupPdf = f.add('assets/dup.pdf', 'SAME_PDF', true);
    const keepImg = f.add('library/diagram.png', 'SAME_IMG', true);
    const dupImg = f.add('assets/dup.png', 'SAME_IMG', true);

    f.add(
      'spec.md',
      [
        '[Spec Doc](assets/dup.pdf#page=5 "Chapter five")',
        '![Architecture](assets/dup.png \'System overview\')'
      ].join('\n')
    );

    const pdfSha = await f.computeSha256Hex(new TextEncoder().encode('SAME_PDF').buffer);
    const imgSha = await f.computeSha256Hex(new TextEncoder().encode('SAME_IMG').buffer);
    let summary = null;
    await f.attachmentOps.executeDuplicateMergeSafely(
      f.plugin,
      [
        {
          sha256: pdfSha,
          keepId: `local:${keepPdf.path}`,
          items: [
            { id: `local:${keepPdf.path}`, source: 'local', name: keepPdf.name, displayPath: keepPdf.path, ext: 'pdf', rawObj: keepPdf },
            { id: `local:${dupPdf.path}`, source: 'local', name: dupPdf.name, displayPath: dupPdf.path, ext: 'pdf', rawObj: dupPdf }
          ]
        },
        {
          sha256: imgSha,
          keepId: `local:${keepImg.path}`,
          items: [
            { id: `local:${keepImg.path}`, source: 'local', name: keepImg.name, displayPath: keepImg.path, ext: 'png', rawObj: keepImg },
            { id: `local:${dupImg.path}`, source: 'local', name: dupImg.name, displayPath: dupImg.path, ext: 'png', rawObj: dupImg }
          ]
        }
      ],
      (res) => { summary = res; }
    );

    assert.equal(summary.skipped, 0);
    assert.equal(
      f.contents.get('spec.md'),
      [
        '[Spec Doc](library/my%20manual.pdf#page=5 "Chapter five")',
        '![Architecture](library/diagram.png \'System overview\')'
      ].join('\n')
    );
    assert.deepEqual(f.trashed.sort(), ['assets/dup.pdf', 'assets/dup.png']);
  }
});
