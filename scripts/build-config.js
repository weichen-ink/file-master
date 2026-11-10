const path = require('node:path');
const root = path.resolve(__dirname, '..');
module.exports = {
  absWorkingDir: root,
  entryPoints: ['src/main.js'],
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  target: 'es2018',
  external: ['obsidian'],
  outfile: path.join(root, 'main.js'),
  logLevel: 'warning'
};
