const fs = require('fs');
const path = require('path');
const { execFileSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'manifest.json'), 'utf8'));
const version = manifest.version;
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
  throw new Error('Obsidian release versions must use major.minor.patch, for example 1.1.0');
}

// 1. Ensure latest build
require('./build').build();

// 2. Prepare release directory
const releaseDir = path.join(rootDir, 'release');
if (!fs.existsSync(releaseDir)) {
  fs.mkdirSync(releaseDir, { recursive: true });
}

// 3. Create zip package with manifest.json, main.js, styles.css
const zipName = `file-master-${version}.zip`;
const zipPath = path.join(releaseDir, zipName);
if (fs.existsSync(zipPath)) {
  fs.unlinkSync(zipPath);
}

try {
  execFileSync('zip', ['-j', zipPath, 'main.js', 'manifest.json', 'styles.css'], {
    cwd: rootDir,
    stdio: 'inherit'
  });
  console.log(`[package] Successfully generated release zip: ${zipPath}`);
} catch (err) {
  console.error(`[package] Failed to create zip:`, err.message);
  process.exitCode = 1;
}

