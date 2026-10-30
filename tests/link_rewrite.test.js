const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const pluginCode = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');

// Extract pure functions and definitions from main.js
const imgExtsMatch = pluginCode.match(/const IMAGE_EXTS = new Set\([\s\S]*?\);/);
const escRegMatch = pluginCode.match(/function escapeRegExp\([\s\S]*?\n\}/);
const rewriteMatch = pluginCode.match(/rewriteContentLinks\(content, removeItem, keepItem\) {[\s\S]*?\n  \}/);

assert.ok(imgExtsMatch, 'IMAGE_EXTS must be found in main.js');
assert.ok(escRegMatch, 'escapeRegExp must be found in main.js');
assert.ok(rewriteMatch, 'rewriteContentLinks must be found in main.js');

const rewriteContentLinks = new Function(
  'content, removeItem, keepItem',
  imgExtsMatch[0] + '\n' + escRegMatch[0] + '\nconst self = {' + rewriteMatch[0] + '};\nreturn self.rewriteContentLinks(content, removeItem, keepItem);'
);

test('rewriteContentLinks: WikiLink image embed replacement', () => {
  const localItem = {
    id: 'local:attachments/photo.png',
    source: 'local',
    name: 'photo.png',
    displayPath: 'attachments/photo.png',
    ext: 'png'
  };
  const remoteItem = {
    id: 'remote:2026/10/photo.png',
    source: 'remote',
    name: 'photo.png',
    displayPath: '2026/10/photo.png',
    ext: 'png',
    rawObj: {
      rawUrl: 'https://cdn.example.com/raw-secret/2026/10/photo.png',
      pubUrl: 'https://cdn.example.com/pub/2026/10/photo.webp'
    }
  };

  const input = 'Note start: ![[attachments/photo.png]] and ![[photo.png|400x300]] end.';
  const output = rewriteContentLinks(input, localItem, remoteItem);
  assert.strictEqual(
    output,
    'Note start: ![](https://cdn.example.com/raw-secret/2026/10/photo.png) and ![400x300](https://cdn.example.com/raw-secret/2026/10/photo.png) end.'
  );
});

test('rewriteContentLinks: Document WikiLink and aliases', () => {
  const localPdf = {
    id: 'local:docs/manual.pdf',
    source: 'local',
    name: 'manual.pdf',
    displayPath: 'docs/manual.pdf',
    ext: 'pdf'
  };
  const remotePdf = {
    id: 'remote:2026/10/manual.pdf',
    source: 'remote',
    name: 'manual.pdf',
    displayPath: '2026/10/manual.pdf',
    ext: 'pdf',
    rawObj: {
      rawUrl: 'https://cdn.example.com/raw-secret/2026/10/manual.pdf'
    }
  };

  const input = 'See [[docs/manual.pdf]] or [[manual.pdf|User Guide]] for details.';
  const output = rewriteContentLinks(input, localPdf, remotePdf);
  assert.strictEqual(
    output,
    'See [manual.pdf](https://cdn.example.com/raw-secret/2026/10/manual.pdf) or [User Guide](https://cdn.example.com/raw-secret/2026/10/manual.pdf) for details.'
  );
});

test('rewriteContentLinks: Relative markdown links and fragments', () => {
  const localPdf = {
    id: 'local:docs/manual.pdf',
    source: 'local',
    name: 'manual.pdf',
    displayPath: 'docs/manual.pdf',
    ext: 'pdf'
  };
  const remotePdf = {
    id: 'remote:2026/10/manual.pdf',
    source: 'remote',
    name: 'manual.pdf',
    displayPath: '2026/10/manual.pdf',
    ext: 'pdf',
    rawObj: {
      rawUrl: 'https://cdn.example.com/raw-secret/2026/10/manual.pdf'
    }
  };

  const input = 'Check [Spec](../docs/manual.pdf#page=2) and [Alt](<./manual.pdf?w=100>).';
  const output = rewriteContentLinks(input, localPdf, remotePdf);
  assert.strictEqual(
    output,
    'Check [Spec](https://cdn.example.com/raw-secret/2026/10/manual.pdf) and [Alt](https://cdn.example.com/raw-secret/2026/10/manual.pdf).'
  );
});

test('rewriteContentLinks: CJK Unicode and space encoded links', () => {
  const localDoc = {
    id: 'local:附件/测试 文档.pdf',
    source: 'local',
    name: '测试 文档.pdf',
    displayPath: '附件/测试 文档.pdf',
    ext: 'pdf'
  };
  const remoteDoc = {
    id: 'remote:2026/10/测试_文档.pdf',
    source: 'remote',
    name: '测试_文档.pdf',
    displayPath: '2026/10/测试_文档.pdf',
    ext: 'pdf',
    rawObj: {
      rawUrl: 'https://cdn.example.com/raw/2026/10/%E6%B5%8B%E8%AF%95_%E6%96%87%E6%A1%A3.pdf'
    }
  };

  const input = '下载：[[附件/测试 文档.pdf]] 或者 [文件](%E9%99%84%E4%BB%B6/%E6%B5%8B%E8%AF%95%20%E6%96%87%E6%A1%A3.pdf)';
  const output = rewriteContentLinks(input, localDoc, remoteDoc);
  assert.ok(output.includes('https://cdn.example.com/raw/2026/10/%E6%B5%8B%E8%AF%95_%E6%96%87%E6%A1%A3.pdf'));
});

test('rewriteContentLinks: Strict idempotency', () => {
  const localItem = {
    id: 'local:photo.png',
    source: 'local',
    name: 'photo.png',
    displayPath: 'photo.png',
    ext: 'png'
  };
  const remoteItem = {
    id: 'remote:2026/10/photo.png',
    source: 'remote',
    name: 'photo.png',
    displayPath: '2026/10/photo.png',
    ext: 'png',
    rawObj: {
      rawUrl: 'https://cdn.example.com/raw/2026/10/photo.png'
    }
  };

  const input = 'Sample text ![[photo.png]] and more text.';
  const once = rewriteContentLinks(input, localItem, remoteItem);
  const twice = rewriteContentLinks(once, localItem, remoteItem);
  assert.strictEqual(once, twice, 'Repeated link rewrite should not change content');
});

