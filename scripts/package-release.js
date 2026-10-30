const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'manifest.json'), 'utf8'));
const version = manifest.version || '0.1.0';

// 1. Ensure latest build
require('./build');

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
  execSync(`zip -j "${zipPath}" main.js manifest.json styles.css`, {
    cwd: rootDir,
    stdio: 'inherit'
  });
  console.log(`[package] Successfully generated release zip: ${zipPath}`);
} catch (err) {
  console.error(`[package] Failed to create zip:`, err.message);
}

