const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const options = require('../../scripts/build-config');
let helpersSource;

/** Load release integration code and explicit unit-test exports with the same host boundary. */
function loadPlugin(requestUrl = async () => { throw new Error('Unexpected network request'); }, globals = {}) {
  class Base { constructor(app) { this.app = app; } }
  class HostModal extends Base {
    open() { globals.onModalOpen?.(this); }
    close() {}
  }
  const obsidian = new Proxy({ Modal: HostModal, requestUrl, getLanguage: () => globals.getLanguage?.(), Platform: { isMobile: false }, ...globals.host }, {
    get: (target, key) => key in target ? target[key] : Base
  });
  function evaluate(source) {
    const mod = { exports: {} };
    new Function('require', 'module', 'exports', ...Object.keys(globals), source)((name) => {
      if (name !== 'obsidian') throw new Error('Unexpected runtime dependency: ' + name);
      return obsidian;
    }, mod, mod.exports, ...Object.values(globals));
    return mod.exports;
  }
  helpersSource ||= esbuild.buildSync({ ...options, entryPoints: ['tests/helpers/entry.js'], write: false }).outputFiles[0].text;
  const helpers = evaluate(helpersSource);
  const Plugin = evaluate(fs.readFileSync(path.join(__dirname, '../../main.js'), 'utf8'));
  return { ...helpers, Plugin, HostPlugin: obsidian.Plugin, rewriteContentLinks: (...args) => Plugin.prototype.rewriteContentLinks(...args) };
}
module.exports = { loadPlugin };
