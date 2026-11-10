const fs = require('fs');
const path = require('path');

const srcDir = path.resolve(__dirname, '..');
const demoObsidianDir = path.resolve(srcDir, '../demo/.obsidian');
const demoPluginDir = path.resolve(demoObsidianDir, 'plugins/file-master');

function syncDemo() {
if (srcDir === demoPluginDir || !fs.existsSync(demoObsidianDir)) {
  console.log('[sync-demo] Already inside demo plugin directory (or no external demo dir), skipping copy.');
  return;
}

if (!fs.existsSync(demoPluginDir)) {
  fs.mkdirSync(demoPluginDir, { recursive: true });
}

const files = ['main.js', 'manifest.json', 'styles.css'];
for (const file of files) {
  const src = path.join(srcDir, file);
  const dest = path.join(demoPluginDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`[sync-demo] Copied ${file} -> demo/.obsidian/plugins/file-master/`);
  }
}
console.log('[sync-demo] Done.');

}

if (require.main === module) syncDemo();
module.exports = { syncDemo };
