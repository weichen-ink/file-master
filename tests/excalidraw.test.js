const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadPlugin } = require('./helpers/load-plugin');
const { isAttachmentExt, getFileTypeGroup, isExcalidrawContent, isExcalidrawFile,
  isDocFile, rewriteExcalidrawEmbeddedFiles, rewriteContentLinks } = loadPlugin();

test('isExcalidrawContent: robustly detects Excalidraw content across multiple formats', () => {
  const standardExcal = `---
excalidraw-plugin: parsed
tags: [excalidraw]
---
# Excalidraw Data
## Text Elements
## Embedded Files
`;
  assert.equal(isExcalidrawContent(standardExcal), true);

  const rawExcal = `---
excalidraw-plugin: raw
---
`;
  assert.equal(isExcalidrawContent(rawExcal), true);

  const booleanExcal = `---
excalidraw: true
---
`;
  assert.equal(isExcalidrawContent(booleanExcal), true);

  const dataOnlyExcal = `# Excalidraw Data\nSome drawing elements`;
  assert.equal(isExcalidrawContent(dataOnlyExcal), true);

  const headersOnlyExcal = `Some text\n## Text Elements\nText 1\n## Embedded Files\nabc: [[img.png]]`;
  assert.equal(isExcalidrawContent(headersOnlyExcal), true);

  const normalMd = `# Project Notes\nThis is a standard markdown note with [[link]] and ![](img.png).`;
  assert.equal(isExcalidrawContent(normalMd), false);
  const bodyCodeblockMd = `---\ntitle: Config Guide\n---\n# Guide\nIn YAML, set \`excalidraw: true\` to enable.`;
  assert.equal(isExcalidrawContent(bodyCodeblockMd), false, 'Body text mentioning excalidraw: true must not trigger false positive');
  assert.equal(isExcalidrawContent(''), false);
  assert.equal(isExcalidrawContent(null), false);
});

test('Reference index avoids substring false positives for short filenames like 1.png', () => {
  const { createLocalReferenceMatcher, stripRemoteReferenceText } = require('./helpers/load-plugin').loadPlugin();
  const file = { name: '1.png', basename: '1', path: 'assets/1.png', extension: 'png' };
  const match = createLocalReferenceMatcher([file], () => false);
  for (const text of ['Here is ![[1.png]]', 'Here is ![[assets/1.png|300]]',
    'Here is ![](assets/1.png)', '{"type":"file","file":"assets/1.png"}']) {
    assert.ok(match(stripRemoteReferenceText(text)).has(file.path));
  }
  assert.equal(match('Here is ![[21.png]] and ![](assets/my_1.png)').size, 0);
});

test('isExcalidrawFile: identifies Excalidraw files regardless of extension renaming', () => {
  // Standard extension
  assert.equal(isExcalidrawFile({ name: 'Architecture.excalidraw.md' }), true);
  assert.equal(isExcalidrawFile({ name: 'Sketch.excalidraw', extension: 'excalidraw' }), true);

  // Renamed to .md but identified via frontmatter metadataCache
  const fakeAppWithFrontmatter = {
    metadataCache: {
      getFileCache: (file) => ({
        frontmatter: { 'excalidraw-plugin': 'parsed' }
      })
    }
  };
  assert.equal(
    isExcalidrawFile({ name: 'RenamedDrawing.md', extension: 'md' }, fakeAppWithFrontmatter),
    true
  );

  // Renamed to .md but identified via content inspection
  const content = `# Excalidraw Data\n## Embedded Files`;
  assert.equal(
    isExcalidrawFile({ name: 'CanvasRenamed.md', extension: 'md' }, null, content),
    true
  );

  // Normal markdown note
  const fakeAppNormal = {
    metadataCache: {
      getFileCache: () => ({ frontmatter: { title: 'My Note' } })
    }
  };
  assert.equal(
    isExcalidrawFile({ name: 'Daily.md', extension: 'md' }, fakeAppNormal, '# Daily Log'),
    false
  );
});

test('isDocFile: treats Markdown, Canvas, and Excalidraw as notes (not attachments)', () => {
  assert.equal(isDocFile({ name: 'Note.md', extension: 'md' }), true);
  assert.equal(isDocFile({ name: 'Board.canvas', extension: 'canvas' }), true);
  assert.equal(isDocFile({ name: 'Drawing.excalidraw', extension: 'excalidraw' }), true);
  assert.equal(isDocFile({ name: 'Drawing.excalidraw.md', extension: 'md' }), true);
  assert.equal(isDocFile({ name: 'photo.png', extension: 'png' }), false);
  assert.equal(isDocFile({ name: 'track.mp3', extension: 'mp3' }), false);
  assert.equal(isDocFile({ name: 'document.pdf', extension: 'pdf' }), false);

  // Verify attachment check and file type grouping
  assert.equal(isAttachmentExt('excalidraw'), false, '.excalidraw is a note, not an attachment');
  assert.equal(getFileTypeGroup('excalidraw'), 'note', 'excalidraw group is note');
});

test('rewriteContentLinks in Excalidraw: Local -> Remote converts to bare URL in ## Embedded Files', () => {
  const localItem = {
    id: 'local:attachments/diagram.png',
    source: 'local',
    name: 'diagram.png',
    displayPath: 'attachments/diagram.png',
    ext: 'png'
  };
  const remoteItem = {
    id: 'remote:2026/11/diagram.png',
    source: 'remote',
    name: 'diagram.png',
    displayPath: '2026/11/diagram.png',
    ext: 'png',
    rawObj: {
      rawUrl: 'https://cdn.example.com/raw/2026/11/diagram.png',
      pubUrl: 'https://cdn.example.com/pub/2026/11/diagram.webp'
    }
  };

  const excalidrawDoc = `---
excalidraw-plugin: parsed
---
# Excalidraw Data
## Text Elements
## Embedded Files
c6c05cda63b523c97a04dba571269622d1ae976b: [[attachments/diagram.png]]
4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e: [[other_asset.png]]

%%
# Drawing
`;

  const output = rewriteContentLinks(excalidrawDoc, localItem, remoteItem);

  // Must rewrite diagram.png to bare URL without Markdown []() syntax
  assert.ok(
    output.includes('c6c05cda63b523c97a04dba571269622d1ae976b: https://cdn.example.com/raw/2026/11/diagram.png'),
    'Excalidraw ## Embedded Files must use bare URL without markdown brackets'
  );
  assert.ok(
    !output.includes('[attachments/diagram.png]('),
    'Excalidraw ## Embedded Files must not contain markdown link brackets'
  );
  assert.ok(
    !output.includes('![](https://cdn.example.com/raw/2026/11/diagram.png)'),
    'Excalidraw ## Embedded Files must not contain markdown image embed brackets'
  );

  // Other embedded files must be preserved
  assert.ok(
    output.includes('4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e: [[other_asset.png]]'),
    'Unrelated embedded files must remain untouched'
  );
});

test('rewriteContentLinks in Excalidraw: Remote -> Local converts bare URL back to [[wikilink]]', () => {
  const remoteItem = {
    id: 'remote:2026/11/diagram.png',
    source: 'remote',
    name: 'diagram.png',
    filename: 'diagram.png',
    displayPath: '2026/11/diagram.png',
    ext: 'png',
    rawObj: {
      year: '2026',
      month: '11',
      filename: 'diagram.png',
      rawUrl: 'https://cdn.example.com/raw/2026/11/diagram.png',
      pubUrl: 'https://cdn.example.com/pub/2026/11/diagram.webp'
    }
  };
  const localItem = {
    id: 'local:attachments/diagram.png',
    source: 'local',
    name: 'diagram.png',
    displayPath: 'attachments/diagram.png',
    ext: 'png'
  };

  const excalidrawDoc = `---
excalidraw-plugin: parsed
---
# Excalidraw Data
## Text Elements
## Embedded Files
c6c05cda63b523c97a04dba571269622d1ae976b: https://cdn.example.com/raw/2026/11/diagram.png
4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e: [[other_asset.png]]

%%
# Drawing
`;

  const output = rewriteContentLinks(excalidrawDoc, remoteItem, localItem);

  assert.ok(
    output.includes('c6c05cda63b523c97a04dba571269622d1ae976b: [[attachments/diagram.png]]'),
    'Bare remote URL in ## Embedded Files must be restored to [[displayPath]] wikilink'
  );
  assert.ok(
    output.includes('4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e: [[other_asset.png]]'),
    'Unrelated files must remain untouched'
  );
});

test('rewriteContentLinks in Excalidraw: Local duplicate merge updates wikilink target', () => {
  const duplicateItem = {
    id: 'local:attachments/dup_diagram.png',
    source: 'local',
    name: 'dup_diagram.png',
    displayPath: 'attachments/dup_diagram.png',
    ext: 'png'
  };
  const keptItem = {
    id: 'local:attachments/canonical_diagram.png',
    source: 'local',
    name: 'canonical_diagram.png',
    displayPath: 'attachments/canonical_diagram.png',
    ext: 'png'
  };

  const excalidrawDoc = `## Embedded Files
c6c05cda63b523c97a04dba571269622d1ae976b: [[attachments/dup_diagram.png]]
`;

  const output = rewriteContentLinks(excalidrawDoc, duplicateItem, keptItem);
  assert.ok(
    output.includes('c6c05cda63b523c97a04dba571269622d1ae976b: [[attachments/canonical_diagram.png]]'),
    'Merged duplicate in ## Embedded Files must point to kept canonical wikilink'
  );
});

test('rewriteContentLinks in Excalidraw: heals previously broken markdown bracket links', () => {
  const remoteItem = {
    id: 'remote:2026/11/diagram.png',
    source: 'remote',
    name: 'diagram.png',
    filename: 'diagram.png',
    displayPath: '2026/11/diagram.png',
    ext: 'png',
    rawObj: {
      year: '2026',
      month: '11',
      filename: 'diagram.png',
      rawUrl: 'https://cdn.example.com/raw/2026/11/diagram.png'
    }
  };
  const localItem = {
    id: 'local:attachments/diagram.png',
    source: 'local',
    name: 'diagram.png',
    displayPath: 'attachments/diagram.png',
    ext: 'png'
  };

  // Corrupted format generated by tools that didn't know Excalidraw syntax
  const corruptedDoc = `## Embedded Files
c6c05cda63b523c97a04dba571269622d1ae976b: [diagram.png](https://cdn.example.com/raw/2026/11/diagram.png)
`;

  const output = rewriteContentLinks(corruptedDoc, remoteItem, localItem);
  assert.ok(
    output.includes('c6c05cda63b523c97a04dba571269622d1ae976b: [[attachments/diagram.png]]'),
    'Corrupted bracket link in ## Embedded Files should be healed to clean wikilink'
  );
});

test('rewriteContentLinks in Excalidraw: idempotency and roundtrip', () => {
  const localItem = {
    id: 'local:attachments/photo.png',
    source: 'local',
    name: 'photo.png',
    displayPath: 'attachments/photo.png',
    ext: 'png'
  };
  const remoteItem = {
    id: 'remote:2026/11/photo.png',
    source: 'remote',
    name: 'photo.png',
    filename: 'photo.png',
    displayPath: '2026/11/photo.png',
    ext: 'png',
    rawObj: {
      year: '2026',
      month: '11',
      filename: 'photo.png',
      rawUrl: 'https://cdn.example.com/raw/2026/11/photo.png'
    }
  };

  const initialDoc = `## Embedded Files
abc12345: [[attachments/photo.png]]
`;

  // 1. Upload to remote
  const uploaded = rewriteContentLinks(initialDoc, localItem, remoteItem);
  assert.ok(uploaded.includes('abc12345: https://cdn.example.com/raw/2026/11/photo.png'));

  // 2. Upload called again (idempotent)
  const uploadedAgain = rewriteContentLinks(uploaded, localItem, remoteItem);
  assert.equal(uploaded, uploadedAgain);

  // 3. Download back to local
  const downloaded = rewriteContentLinks(uploaded, remoteItem, localItem);
  assert.ok(downloaded.includes('abc12345: [[attachments/photo.png]]'));

  // 4. Download called again (idempotent)
  const downloadedAgain = rewriteContentLinks(downloaded, remoteItem, localItem);
  assert.equal(downloaded, downloadedAgain);
});

test('rewriteContentLinks in Excalidraw: avoids substring false positive for similar filenames (diagram.png vs other-diagram.png)', () => {
  const localItem = {
    id: 'local:attachments/diagram.png',
    source: 'local',
    name: 'diagram.png',
    displayPath: 'attachments/diagram.png',
    ext: 'png'
  };
  const remoteItem = {
    id: 'remote:2026/11/diagram.png',
    source: 'remote',
    name: 'diagram.png',
    filename: 'diagram.png',
    displayPath: '2026/11/diagram.png',
    ext: 'png',
    rawObj: {
      year: '2026',
      month: '11',
      filename: 'diagram.png',
      rawUrl: 'https://cdn.example.com/raw/2026/11/diagram.png'
    }
  };

  const doc = `## Embedded Files
id_target: [[attachments/diagram.png]]
id_similar_local: [[attachments/other-diagram.png]]
id_similar_remote: https://example.test/other-diagram.png
id_similar_bare: other-diagram.png
`;

  const result = rewriteContentLinks(doc, localItem, remoteItem);
  assert.ok(result.includes('id_target: https://cdn.example.com/raw/2026/11/diagram.png'), 'Exact target must be rewritten');
  assert.ok(result.includes('id_similar_local: [[attachments/other-diagram.png]]'), 'Similar local name must NOT be rewritten');
  assert.ok(result.includes('id_similar_remote: https://example.test/other-diagram.png'), 'Similar remote URL must NOT be rewritten');
  assert.ok(result.includes('id_similar_bare: other-diagram.png'), 'Similar bare name must NOT be rewritten');
});

test('rewriteContentLinks in Excalidraw: prevents cross-folder and cross-domain collision on same basename (attachments/a/diagram.png vs attachments/b/diagram.png)', () => {
  const localItemA = {
    id: 'local:attachments/a/diagram.png',
    source: 'local',
    name: 'diagram.png',
    displayPath: 'attachments/a/diagram.png',
    ext: 'png'
  };
  const remoteItemA = {
    id: 'remote:2026/11/diagram.png',
    source: 'remote',
    name: 'diagram.png',
    filename: 'diagram.png',
    displayPath: '2026/11/diagram.png',
    ext: 'png',
    rawObj: {
      year: '2026',
      month: '11',
      filename: 'diagram.png',
      rawUrl: 'https://cdn.example.com/raw/2026/11/diagram.png'
    }
  };

  const doc = `## Embedded Files
id_target_a: [[attachments/a/diagram.png]]
id_diff_folder_b: [[attachments/b/diagram.png]]
id_foreign_url: https://other-domain.org/assets/diagram.png
`;

  const result = rewriteContentLinks(doc, localItemA, remoteItemA);
  assert.ok(result.includes('id_target_a: https://cdn.example.com/raw/2026/11/diagram.png'), 'attachments/a/diagram.png must be rewritten');
  assert.ok(result.includes('id_diff_folder_b: [[attachments/b/diagram.png]]'), 'attachments/b/diagram.png must NOT be rewritten');
  assert.ok(result.includes('id_foreign_url: https://other-domain.org/assets/diagram.png'), 'Other domain URL must NOT be rewritten');

  // Test reverse direction (remote -> local)
  const revertDoc = `## Embedded Files
id_target_cdn: https://cdn.example.com/raw/2026/11/diagram.png
id_foreign_url: https://other-domain.org/assets/diagram.png
`;
  const revertResult = rewriteContentLinks(revertDoc, remoteItemA, localItemA);
  assert.ok(revertResult.includes('id_target_cdn: [[attachments/a/diagram.png]]'), 'CDN URL must be reverted to local');
  assert.ok(revertResult.includes('id_foreign_url: https://other-domain.org/assets/diagram.png'), 'Foreign URL must NOT be reverted to local');
});

test('rewriteContentLinks in Excalidraw: bare link [[diagram.png]] uses resolveLink to disambiguate identical filenames', () => {
  const localItemA = {
    id: 'local:attachments/a/diagram.png',
    source: 'local',
    name: 'diagram.png',
    displayPath: 'attachments/a/diagram.png',
    ext: 'png'
  };
  const remoteItemA = {
    id: 'remote:2026/11/diagram.png',
    source: 'remote',
    name: 'diagram.png',
    filename: 'diagram.png',
    displayPath: '2026/11/diagram.png',
    ext: 'png',
    rawObj: {
      rawUrl: 'https://cdn.example.com/raw/2026/11/diagram.png'
    }
  };

  const doc = `## Embedded Files
id_bare: [[diagram.png]]
`;

  // Case 1: resolveLink resolves bare link to attachments/b/diagram.png (different file) -> must NOT rewrite
  const contextResolvesToB = {
    docPath: 'drawing.excalidraw.md',
    resolveLink: (ref) => (ref === 'diagram.png' ? 'attachments/b/diagram.png' : null)
  };
  const resultB = rewriteContentLinks(doc, localItemA, remoteItemA, contextResolvesToB);
  assert.ok(resultB.includes('id_bare: [[diagram.png]]'), 'Bare link resolving to b must NOT be rewritten when migrating a');

  // Case 2: resolveLink resolves bare link to attachments/a/diagram.png (target file) -> must rewrite
  const contextResolvesToA = {
    docPath: 'drawing.excalidraw.md',
    resolveLink: (ref) => (ref === 'diagram.png' ? 'attachments/a/diagram.png' : null)
  };
  const resultA = rewriteContentLinks(doc, localItemA, remoteItemA, contextResolvesToA);
  assert.ok(resultA.includes('id_bare: https://cdn.example.com/raw/2026/11/diagram.png'), 'Bare link resolving to a must be rewritten');
});

test('rewriteContentLinks in Markdown: unresolvable bare link (resolveLink returns null) is NOT rewritten', () => {
  const localItem = {
    id: 'local:attachments/a/diagram.png',
    source: 'local',
    name: 'diagram.png',
    displayPath: 'attachments/a/diagram.png',
    ext: 'png'
  };
  const remoteItem = {
    id: 'remote:2026/11/diagram.png',
    source: 'remote',
    name: 'diagram.png',
    filename: 'diagram.png',
    displayPath: '2026/11/diagram.png',
    ext: 'png',
    rawObj: {
      rawUrl: 'https://cdn.example.com/raw/2026/11/diagram.png'
    }
  };

  const noteContent = `Here is an unresolvable or ambiguous embed: ![[diagram.png]]`;
  const contextNull = {
    docPath: 'notes/MyNote.md',
    resolveLink: () => null // cannot resolve
  };

  const res = rewriteContentLinks(noteContent, localItem, remoteItem, contextNull);
  assert.strictEqual(res, noteContent, 'Unresolvable bare link must remain untouched');
});

test('rewriteContentLinks in Markdown: normal note with ## Embedded Files is not treated as Excalidraw drawing', () => {
  const localItem = {
    id: 'local:attachments/diagram.png',
    source: 'local',
    name: 'diagram.png',
    displayPath: 'attachments/diagram.png',
    ext: 'png'
  };
  const remoteItem = {
    id: 'remote:2026/11/diagram.png',
    source: 'remote',
    name: 'diagram.png',
    filename: 'diagram.png',
    displayPath: '2026/11/diagram.png',
    ext: 'png',
    rawObj: {
      rawUrl: 'https://cdn.example.com/raw/2026/11/diagram.png'
    }
  };

  const normalDoc = `## Embedded Files
id: [[attachments/diagram.png]]
`;
  const contextNormal = {
    docPath: 'notes/Architecture.md',
    resolveLink: (ref) => (ref.includes('diagram.png') ? 'attachments/diagram.png' : null)
  };

  const res = rewriteContentLinks(normalDoc, localItem, remoteItem, contextNormal);
  // Normal markdown note replaces wikilink with [name](url) markdown link, NOT bare URL!
  assert.ok(res.includes('id: [diagram.png](https://cdn.example.com/raw/2026/11/diagram.png)'), 'Normal note must format as markdown link, not bare Excalidraw URL');
  assert.ok(!res.includes('id: https://cdn.example.com/raw/2026/11/diagram.png'), 'Must not inject bare URL into normal Markdown note');
});
