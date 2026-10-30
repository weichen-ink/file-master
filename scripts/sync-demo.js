const fs = require('fs');
const path = require('path');

const srcDir = path.resolve(__dirname, '..');
const demoPluginDir = path.resolve(srcDir, '../demo/.obsidian/plugins/file-master');

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

