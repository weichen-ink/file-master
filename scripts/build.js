const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const srcOrder = [
  'src/constants.js',
  'src/i18n.js',
  'src/engine.js',
  'src/modals.js',
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
