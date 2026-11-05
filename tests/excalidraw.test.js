const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pluginCode = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');

// Extract definitions from bundled main.js
const getExtMatch = pluginCode.match(/function getExt\([\s\S]*?\n\}/);
const imgExtsMatch = pluginCode.match(/const IMAGE_EXTS = new Set\([\s\S]*?\);/);
const escRegMatch = pluginCode.match(/function escapeRegExp\([\s\S]*?\n\}/);
const isExcalContentMatch = pluginCode.match(/function isExcalidrawContent\([\s\S]*?\n\}/);
const isExcalFileMatch = pluginCode.match(/function isExcalidrawFile\([\s\S]*?\n\}/);
const isDocFileMatch = pluginCode.match(/function isDocFile\([\s\S]*?\n\}/);
const rewriteExcalMatch = pluginCode.match(/function rewriteExcalidrawEmbeddedFiles\([\s\S]*?\n\}/);
const rewriteMatch = pluginCode.match(/rewriteContentLinks\(content, removeItem, keepItem\) {[\s\S]*?\n  \}/);

const isAttachmentExtMatch = pluginCode.match(/function isAttachmentExt\([\s\S]*?\n\}/);
const getFileTypeGroupMatch = pluginCode.match(/function getFileTypeGroup\([\s\S]*?\n\}/);
const obsExtsMatch = pluginCode.match(/const OBSIDIAN_NOTE_EXTS = new Set\([\s\S]*?\);/);

assert.ok(getExtMatch, 'getExt must be present');
assert.ok(imgExtsMatch, 'IMAGE_EXTS must be present');
assert.ok(escRegMatch, 'escapeRegExp must be present');
assert.ok(isAttachmentExtMatch, 'isAttachmentExt must be present');
assert.ok(getFileTypeGroupMatch, 'getFileTypeGroup must be present');
assert.ok(obsExtsMatch, 'OBSIDIAN_NOTE_EXTS must be present');
assert.ok(isExcalContentMatch, 'isExcalidrawContent must be present');
assert.ok(isExcalFileMatch, 'isExcalidrawFile must be present');
assert.ok(isDocFileMatch, 'isDocFile must be present');
assert.ok(rewriteExcalMatch, 'rewriteExcalidrawEmbeddedFiles must be present');
assert.ok(rewriteMatch, 'rewriteContentLinks must be present');

const evalEnv = new Function(
  `${getExtMatch[0]}
   ${imgExtsMatch[0]}
   ${obsExtsMatch[0]}
   ${escRegMatch[0]}
   ${isAttachmentExtMatch[0]}
   ${getFileTypeGroupMatch[0]}
   ${isExcalContentMatch[0]}
   ${isExcalFileMatch[0]}
   ${isDocFileMatch[0]}
   ${rewriteExcalMatch[0]}
   const plugin = { ${rewriteMatch[0]} };
   return {
     isAttachmentExt,
     getFileTypeGroup,
     isExcalidrawContent,
     isExcalidrawFile,
     isDocFile,
     rewriteExcalidrawEmbeddedFiles,
     rewriteContentLinks: (content, rem, keep) => plugin.rewriteContentLinks(content, rem, keep)
   };`
);

const {
  isAttachmentExt,
  getFileTypeGroup,
  isExcalidrawContent,
  isExcalidrawFile,
  isDocFile,
  rewriteExcalidrawEmbeddedFiles,
  rewriteContentLinks
} = evalEnv();

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
  assert.equal(isExcalidrawContent(''), false);
  assert.equal(isExcalidrawContent(null), false);
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
