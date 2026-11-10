const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

test('main.js bundle syntax and integrity', () => {
  const mainPath = path.resolve(__dirname, '../main.js');
  assert.ok(fs.existsSync(mainPath), 'main.js must exist');

  // Verify node syntax check passes
  execFileSync(process.execPath, ['-c', mainPath]);

  const { Plugin } = require('./helpers/load-plugin').loadPlugin();
  assert.strictEqual(typeof Plugin, 'function');
  for (const method of ['onload', 'onunload', 'rewriteContentLinks', 'executeBatchMigrateSafely']) {
    assert.strictEqual(typeof Plugin.prototype[method], 'function', `release entry must expose ${method}`);
  }

});

test('mobile compatibility: manifest isDesktopOnly is false and main.js has no Node.js dependencies', () => {
  const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../manifest.json'), 'utf8'));
  assert.strictEqual(manifest.isDesktopOnly, false, 'manifest.json must have isDesktopOnly: false');

  const mainPath = path.resolve(__dirname, '../main.js');
  const content = fs.readFileSync(mainPath, 'utf8');

  assert.ok(!content.includes("require('crypto')"), "main.js must not require('crypto') for mobile compatibility");
  assert.ok(!content.includes('require("crypto")'), 'main.js must not require("crypto") for mobile compatibility');
  assert.ok(!content.includes("require('path')"), "main.js must not require('path') for mobile compatibility");
  assert.ok(!content.includes('require("path")'), 'main.js must not require("path") for mobile compatibility');
  assert.ok(!content.includes("require('fs')"), "main.js must not require('fs') for mobile compatibility");
  assert.ok(!content.includes('Buffer.from('), 'main.js must not rely on Node Buffer.from for mobile compatibility');
});

// Host inheritance is the only inheritance needed; services have explicit inputs.
test('Plugin directly extends the Obsidian host and preserves public command methods', () => {
  const { Plugin, HostPlugin } = require('./helpers/load-plugin').loadPlugin();
  assert.strictEqual(Object.getPrototypeOf(Plugin.prototype), HostPlugin.prototype);
  for (const name of ['registerPluginCommands', 'registerContextMenus', 'buildVaultReferenceSnapshot',
    'uploadBufferToServer', 'resumePendingMigration', 'scanVaultLinkHealth', 'loadSettings', 'saveSettings']) {
    assert.strictEqual(typeof Plugin.prototype[name], 'function');
  }
});
