const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pluginCode = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');

// Extract pure functions
const imageExtsMatch = pluginCode.match(/const IMAGE_EXTS = new Set\([\s\S]*?\);/);
const audioExtsMatch = pluginCode.match(/const AUDIO_EXTS = new Set\([\s\S]*?\);/);
const obsidianExtsMatch = pluginCode.match(/const OBSIDIAN_NOTE_EXTS = new Set\([\s\S]*?\);/);
const isAttachmentExtMatch = pluginCode.match(/function isAttachmentExt\([\s\S]*?\n\}/);
const getExtMatch = pluginCode.match(/function getExt\([\s\S]*?\n\}/);
const getFileTypeGroupMatch = pluginCode.match(/function getFileTypeGroup\([\s\S]*?\n\}/);
const isReportMatch = pluginCode.match(/function isReportFile\([\s\S]*?\n\}/);
const computeStatsMatch = pluginCode.match(/function computeVaultStatsFromEntries\([\s\S]*?\n\}/);
const resolveWikiMatch = pluginCode.match(/function resolveWikiTarget\([\s\S]*?\n\}/);
const resolveLocalMdMatch = pluginCode.match(/function resolveLocalMarkdownTarget\([\s\S]*?\n\}/);
const scanNoteMatch = pluginCode.match(/function scanNoteContentForBrokenLinks\([\s\S]*?\n\}/);

assert.ok(isReportMatch, 'isReportFile must be found in main.js');
assert.ok(computeStatsMatch, 'computeVaultStatsFromEntries must be found in main.js');
assert.ok(resolveWikiMatch, 'resolveWikiTarget must be found in main.js');
assert.ok(resolveLocalMdMatch, 'resolveLocalMarkdownTarget must be found in main.js');
assert.ok(scanNoteMatch, 'scanNoteContentForBrokenLinks must be found in main.js');

const evalEnv = new Function(
  'path',
  `${imageExtsMatch[0]}
   ${audioExtsMatch[0]}
   ${obsidianExtsMatch[0]}
   ${isAttachmentExtMatch[0]}
   ${getExtMatch[0]}
   ${getFileTypeGroupMatch[0]}
   ${isReportMatch[0]}
   ${computeStatsMatch[0]}
   ${resolveWikiMatch[0]}
   ${resolveLocalMdMatch[0]}
   ${scanNoteMatch[0]}
   return { isReportFile, computeVaultStatsFromEntries, resolveWikiTarget, resolveLocalMarkdownTarget, scanNoteContentForBrokenLinks };`
);

const {
  isReportFile,
  computeVaultStatsFromEntries,
  resolveWikiTarget,
  resolveLocalMarkdownTarget,
  scanNoteContentForBrokenLinks
} = evalEnv(path);

test('isReportFile: accurately identifies generated reports', () => {
  assert.strictEqual(isReportFile('Unused_Files_Report_2026-10-29.md'), true);
  assert.strictEqual(isReportFile('Duplicate_Files_Report_2026-10-29.md'), true);
  assert.strictEqual(isReportFile('Broken_Links_Report_2026-10-29.md'), true);
  assert.strictEqual(isReportFile('Vault_Analytics_Report_2026-10-29.md'), true);
  assert.strictEqual(isReportFile('My Notes.md'), false);
  assert.strictEqual(isReportFile('Report_Summary.md'), false);
  assert.strictEqual(isReportFile('attachments/photo.png'), false);
});

test('computeVaultStatsFromEntries: accurately aggregates vault notes, CJK/English words, local attachments, and remote assets', () => {
  const vaultFiles = [
    { name: 'Note1.md', path: 'Note1.md', extension: 'md', size: 1024 },
    { name: 'Board.canvas', path: 'Board.canvas', extension: 'canvas', size: 2048 },
    { name: 'Unused_Files_Report_2026-10-29.md', path: 'Unused_Files_Report_2026-10-29.md', extension: 'md', size: 512 },
    { name: 'banner.png', path: 'assets/banner.png', extension: 'png', size: 50000 },
    { name: 'voice.mp3', path: 'assets/voice.mp3', extension: 'mp3', size: 120000 },
    { name: 'manual.pdf', path: 'docs/manual.pdf', extension: 'pdf', size: 300000 }
  ];
  const docTexts = [
    'Hello world! 你好世界 [[Note2]] and ![[banner.png]] plus [Doc](docs/manual.pdf)'
  ];
  const remoteImages = [
    { filename: 'cloud.png', year: '2026', month: '10', ext: '.png', category: 'image', size: 80000, cacheSize: 20000, locked: true }
  ];

  const stats = computeVaultStatsFromEntries(vaultFiles, docTexts, remoteImages);
  assert.strictEqual(stats.noteCount, 1, 'Should count 1 non-report markdown note');
  assert.strictEqual(stats.canvasCount, 1, 'Should count 1 canvas board');
  assert.ok(stats.totalWords >= 6, 'Should count English words and CJK characters');
  assert.strictEqual(stats.totalInternalLinks, 3, 'Should count 2 WikiLinks + 1 Markdown link');
  assert.strictEqual(stats.local.totalCount, 3, 'Should count 3 local attachments');
  assert.strictEqual(stats.local.totalBytes, 470000, 'Should sum local attachment bytes');
  assert.strictEqual(stats.remote.totalCount, 1, 'Should count 1 remote asset');
  assert.strictEqual(stats.remote.rawBytes, 80000);
  assert.strictEqual(stats.remote.cacheBytes, 20000);
  assert.strictEqual(stats.remote.lockedCount, 1);
  assert.strictEqual(stats.topLargestAttachments[0].name, 'manual.pdf');
});

test('scanNoteContentForBrokenLinks: detects dangling WikiLinks and embeds', () => {
  const vaultIndex = {
    paths: new Set(['notes/ExistingNote.md', 'assets/logo.png', 'folder/sub/Guide.md']),
    names: new Set(['ExistingNote.md', 'logo.png', 'Guide.md']),
    basenames: new Set(['ExistingNote', 'logo', 'Guide'])
  };

  const noteContent = `
# Sample Note
Here is an existing note: [[ExistingNote]].
Here is an existing image: ![[logo.png]].
Here is an existing note with alias: [[ExistingNote|My Alias]].
Here is an in-page heading anchor: [[#Summary]].

Here is a dangling note: [[NonExistentNote]].
Here is a dangling image: ![[missing_banner.png]].
Here is a dangling with alias and anchor: [[MissingTopic#Intro|Topic Intro]].
  `;

  const issues = scanNoteContentForBrokenLinks('notes/TestNote.md', noteContent, vaultIndex);

  const danglingTargets = issues.filter(i => i.category === 'wikilink').map(i => i.target);
  assert.deepStrictEqual(danglingTargets, [
    'NonExistentNote',
    'missing_banner.png',
    'MissingTopic'
  ]);

  const embedIssue = issues.find(i => i.target === 'missing_banner.png');
  assert.strictEqual(embedIssue.type, 'wikilink-embed');
  assert.strictEqual(embedIssue.line, 9);
});

test('scanNoteContentForBrokenLinks: detects missing local relative markdown files', () => {
  const vaultIndex = {
    paths: new Set(['notes/doc.md', 'notes/attachments/chart.png', 'README.md']),
    names: new Set(['doc.md', 'chart.png', 'README.md']),
    basenames: new Set(['doc', 'chart', 'README'])
  };

  const noteContent = `
Check [Documentation](doc.md) or [Readme](../README.md).
See valid chart: ![](attachments/chart.png).

Broken file link: [Missing Specs](missing_spec.pdf).
Broken relative image: ![](../attachments/deleted.png).
Broken bracket url: [Manual](<../docs/not_found.md>).
In-page anchor: [Jump to Top](#top).
Web link: [Google](https://google.com).
  `;

  const issues = scanNoteContentForBrokenLinks('notes/TestNote.md', noteContent, vaultIndex);

  const localBroken = issues.filter(i => i.category === 'local').map(i => i.target);
  assert.deepStrictEqual(localBroken, [
    'missing_spec.pdf',
    '../attachments/deleted.png',
    '../docs/not_found.md'
  ]);

  assert.strictEqual(issues.find(i => i.target === 'missing_spec.pdf').line, 5);
  assert.strictEqual(issues.find(i => i.target === '../attachments/deleted.png').line, 6);
});

test('scanNoteContentForBrokenLinks: handles CJK Unicode and URL encoded paths', () => {
  const vaultIndex = {
    paths: new Set(['笔记/测试文档.md', 'attachments/中文 图片.png']),
    names: new Set(['测试文档.md', '中文 图片.png']),
    basenames: new Set(['测试文档', '中文 图片'])
  };

  const noteContent = `
Existing CJK wiki: [[测试文档]].
Existing CJK encoded markdown: ![](attachments/%E4%B8%AD%E6%96%87%20%E5%9B%BE%E7%89%87.png).

Broken CJK wiki: [[未存在的中文笔记]].
Broken CJK markdown: [丢失文档](%E4%B8%8D%E5%AD%98%E5%9C%A8.pdf).
  `;

  const issues = scanNoteContentForBrokenLinks('notes/Note.md', noteContent, vaultIndex);

  assert.strictEqual(issues.length, 2);
  assert.strictEqual(issues[0].target, '未存在的中文笔记');
  assert.strictEqual(issues[0].category, 'wikilink');
  assert.strictEqual(issues[1].target, '%E4%B8%8D%E5%AD%98%E5%9C%A8.pdf');
  assert.strictEqual(issues[1].category, 'local');
});

test('scanNoteContentForBrokenLinks: captures remote links when checkRemote is true', () => {
  const vaultIndex = {
    paths: new Set([]),
    names: new Set([]),
    basenames: new Set([])
  };

  const content = 'Check [Remote](https://example.com/missing.pdf) and ![Img](https://example.com/pic.png).';

  const defaultIssues = scanNoteContentForBrokenLinks('notes/Note.md', content, vaultIndex, { checkRemote: false });
  assert.strictEqual(defaultIssues.length, 0, 'Should not flag remote URLs when checkRemote is false');

  const remoteIssues = scanNoteContentForBrokenLinks('notes/Note.md', content, vaultIndex, { checkRemote: true });
  assert.strictEqual(remoteIssues.length, 2, 'Should flag remote URLs for probing when checkRemote is true');
  assert.strictEqual(remoteIssues[0].category, 'remote');
  assert.strictEqual(remoteIssues[0].target, 'https://example.com/missing.pdf');
  assert.strictEqual(remoteIssues[1].category, 'remote');
  assert.strictEqual(remoteIssues[1].target, 'https://example.com/pic.png');
});
