const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const srcOrder = [
  'src/constants.js',
  'src/i18n.js',
  'src/engine.js',
  'src/references.js',
  'src/transfers.js',
  'src/gallery.js',
  'src/modals/common.js',
  'src/modals/dialogs.js',
  'src/modals/incoming-file.js',
  'src/modals/active-note.js',
  'src/modals/orphan-wizard.js',
  'src/modals/duplicate-wizard.js',
  'src/modals/batch-migrate-wizard.js',
  'src/modals/health-check.js',
  'src/modals/vault-analytics.js',
  'src/modals/remote-gallery.js',
  'src/modals/hub.js',
  'src/modals/operation-log.js',
  'src/plugin.js'
];

const parts = srcOrder.map((relPath) => {
  const fullPath = path.join(rootDir, relPath);
  return fs.readFileSync(fullPath, 'utf8').trim();
});

const outPath = path.join(rootDir, 'main.js');
fs.writeFileSync(outPath, parts.join('\n\n') + '\n', 'utf8');
console.log(`[build] Bundled ${srcOrder.length} modules -> main.js`);

require('./sync-demo');
