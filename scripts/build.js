const esbuild = require('esbuild');
const options = require('./build-config');
const { syncDemo } = require('./sync-demo');
function build() {
  esbuild.buildSync(options);
  syncDemo();
  console.log('[build] Built Obsidian CommonJS entry: main.js');
}
if (require.main === module) build();
module.exports = { build };
