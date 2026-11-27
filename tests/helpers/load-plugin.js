const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const options = require('../../scripts/build-config');
let helpersSource;

function buildSource(entryPoints) {
  return esbuild.buildSync({ ...options, entryPoints, write: false }).outputFiles[0].text;
}

/** Load release integration code and explicit unit-test exports with the same host boundary. */
function loadPlugin(requestUrl = async () => { throw new Error('Unexpected network request'); }, globals = {}, { buildFromSource = false } = {}) {
  class Base { constructor(app) { this.app = app; } }
  class HostModal extends Base {
    constructor(app) { super(app); const {Element}=require('./ui'); this.containerEl=new Element();this.modalEl=this.containerEl.createDiv();this.contentEl=this.modalEl.createDiv(); }
    open() { globals.onModalOpen?.(this); }
    close() {}
  }
  const obsidian = new Proxy({ Modal: HostModal, setIcon() {}, requestUrl, getLanguage: () => globals.getLanguage?.(), Platform: { isMobile: false }, ...globals.host }, {
    get: (target, key) => key in target ? target[key] : Base
  });
  const runtimeGlobals={requestAnimationFrame: callback => setImmediate(callback), ...globals};
  function evaluate(source) {
    const mod = { exports: {} };
    new Function('require', 'module', 'exports', ...Object.keys(runtimeGlobals), source)((name) => {
      if (name !== 'obsidian') throw new Error('Unexpected runtime dependency: ' + name);
      return obsidian;
    }, mod, mod.exports, ...Object.values(runtimeGlobals));
    return mod.exports;
  }
  const helperEntry = ['tests/helpers/entry.js'];
  const helperBundle = buildFromSource ? buildSource(helperEntry) : (helpersSource ||= buildSource(helperEntry));
  const pluginBundle = buildFromSource
    ? buildSource(options.entryPoints)
    : fs.readFileSync(path.join(__dirname, '../../main.js'), 'utf8');
  const helpers = evaluate(helperBundle);
  const Plugin = evaluate(pluginBundle);
  return { ...helpers, Plugin, HostPlugin: obsidian.Plugin, rewriteContentLinks: (...args) => Plugin.prototype.rewriteContentLinks(...args) };
}
module.exports = { loadPlugin };
