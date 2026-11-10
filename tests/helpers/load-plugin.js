const fs = require('node:fs');
const path = require('node:path');

/** Run the actual bundle with only the Obsidian host boundary stubbed. */
function loadPlugin(requestUrl = async () => { throw new Error('Unexpected network request'); }) {
  class Base { constructor(app) { this.app = app; } }
  const obsidian = new Proxy({ requestUrl, getLanguage: () => 'en', Platform: { isMobile: false } }, {
    get: (target, key) => key in target ? target[key] : Base
  });
  const mod = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '../../main.js'), 'utf8');
  return new Function('require', 'module', 'exports', source + `
    return { Plugin: module.exports, createLocalReferenceMatcher, stripRemoteReferenceText,
      requestWithBackoff, getRemoteGalleryPage, filterRemoteGallery, computeSha256Hex,
      migrationCheckpointPath, rewriteAttachmentPairs };
  `)((name) => {
    if (name !== 'obsidian') throw new Error('Unexpected dependency: ' + name);
    return obsidian;
  }, mod, mod.exports);
}

module.exports = { loadPlugin };
