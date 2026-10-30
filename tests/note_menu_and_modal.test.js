const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

test('Menu Integration: file-menu handles Markdown files for top-right note header menu', () => {
  const mainContent = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');

  // Verify file-menu handles .md files
  assert.ok(mainContent.includes("abstractFile.extension === 'md'"), 'Must handle abstractFile.extension === md');
  assert.ok(mainContent.includes('menuActiveNoteMigrate'), 'Must register menuActiveNoteMigrate');
  assert.ok(mainContent.includes('menuActiveNoteDownload'), 'Must register menuActiveNoteDownload');
  assert.ok(mainContent.includes('menuActiveNoteAstro'), 'Must register menuActiveNoteAstro');
});

test('In-Modal Result UX: IncomingFileModal & ActiveNoteActionModal exist in main bundle', () => {
  const mainContent = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');

  // Verify modal classes
  assert.ok(mainContent.includes('class IncomingFileModal extends Modal'), 'IncomingFileModal must be defined');
  assert.ok(mainContent.includes('class ActiveNoteActionModal extends Modal'), 'ActiveNoteActionModal must be defined');

  // Verify in-modal result banner & copy row usage
  assert.ok(mainContent.includes('fm-result-banner'), 'fm-result-banner must be used in modals');
  assert.ok(mainContent.includes('destInstantBadge'), 'destInstantBadge must be used for instant deduplication');
  assert.ok(mainContent.includes('destBtnDone'), 'destBtnDone must be used as primary confirmation');
  assert.ok(mainContent.includes('destLabelRawUrl'), 'destLabelRawUrl must be rendered with copy button');
});

test('Wizard Modals: Step 3 summary exists for Batch Migration & Deduplication', () => {
  const mainContent = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');

  // Verify batch migrate step 3 summary
  assert.ok(mainContent.includes('batchResultTitle'), 'batchResultTitle must be rendered in step 3');
  assert.ok(mainContent.includes('dupResultTitle'), 'dupResultTitle must be rendered in step 3');
  assert.ok(mainContent.includes('orphanResultTitle'), 'orphanResultTitle must be rendered in step 2 banner');
});

test('Remote Server Gating: enableRemoteServer switch & isRemoteServerReady gates remote features', () => {
  const mainContent = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');

  // Check isRemoteServerReady definition
  assert.ok(mainContent.includes('isRemoteServerReady()'), 'isRemoteServerReady must be defined');
  assert.ok(mainContent.includes('enableRemoteServer: false'), 'enableRemoteServer default must be false');
  assert.ok(mainContent.includes('serverVerified: false'), 'serverVerified default must be false');

  // Verify menus are gated with isRemoteServerReady
  assert.ok(mainContent.includes('this.isRemoteServerReady()'), 'Menus must check isRemoteServerReady');
  assert.ok(mainContent.includes('enableRemoteServerName'), 'enableRemoteServer setting toggle must exist');
});

test('Remote Asset Gallery: RemoteGalleryModal exists and is registered', () => {
  const mainContent = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');

  // Verify class definition
  assert.ok(mainContent.includes('class RemoteGalleryModal extends Modal'), 'RemoteGalleryModal must be defined');

  // Verify command registration
  assert.ok(mainContent.includes("id: 'open-remote-gallery'"), 'open-remote-gallery command must be registered');
  assert.ok(mainContent.includes("nameKey: 'cmdRemoteGallery'"), 'cmdRemoteGallery name key must be used');

  // Verify Hub card integration
  assert.ok(mainContent.includes('actRemoteGalleryTitle'), 'actRemoteGalleryTitle must be in Hub card');

  // Verify key gallery features in modal
  assert.ok(mainContent.includes('gallerySearchPlaceholder'), 'Search input must exist');
  assert.ok(mainContent.includes('galleryBtnInsert'), 'Insert to editor button must exist');
  assert.ok(mainContent.includes('galleryBtnLock'), 'Lock toggle button must exist');
  assert.ok(mainContent.includes('galleryBtnDelete'), 'Delete file button must exist');
});

test('Remote Asset Gallery View: RemoteGalleryView sidebar leaf integration', () => {
  const mainContent = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');

  // Verify view class definition
  assert.ok(mainContent.includes('class RemoteGalleryView extends ItemView'), 'RemoteGalleryView must extend ItemView');

  // Verify view constant and registration
  assert.ok(mainContent.includes("VIEW_TYPE_REMOTE_GALLERY = 'file-master-remote-gallery'"), 'VIEW_TYPE_REMOTE_GALLERY constant must be defined');
  assert.ok(mainContent.includes('this.registerView(') && mainContent.includes('VIEW_TYPE_REMOTE_GALLERY'), 'View must be registered in onload');

  // Verify view command and Hub card
  assert.ok(mainContent.includes("id: 'open-remote-gallery-view'"), 'open-remote-gallery-view command must be registered');
  assert.ok(mainContent.includes('activateGalleryView()'), 'activateGalleryView method must be defined');
  assert.ok(mainContent.includes('actRemoteGalleryViewTitle'), 'actRemoteGalleryViewTitle must be in Hub card');

  // Verify calendar-like persistence and cursor insertion helper
  assert.ok(mainContent.includes('initGalleryLeaf('), 'initGalleryLeaf helper must exist');
  assert.ok(mainContent.includes('insertMarkdownToActiveEditor('), 'insertMarkdownToActiveEditor helper must exist');
  assert.ok(!mainContent.includes('detachLeavesOfType(VIEW_TYPE_REMOTE_GALLERY)'), 'Must not detach gallery leaf in onunload to persist across sessions');
});



