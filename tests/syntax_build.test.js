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

  const content = fs.readFileSync(mainPath, 'utf8');
  assert.ok(content.includes('class FileMasterPlugin'), 'must contain FileMasterPlugin class');
  assert.ok(content.includes('class FileMasterSettingTab'), 'must contain FileMasterSettingTab class');
  assert.ok(content.includes('class FileMasterHubModal'), 'must contain FileMasterHubModal class');
  assert.ok(content.includes('class IncomingFileModal'), 'must contain IncomingFileModal class');
  assert.ok(content.includes('class OrphanWizardModal'), 'must contain OrphanWizardModal class');
  assert.ok(content.includes('class DuplicateWizardModal'), 'must contain DuplicateWizardModal class');
  assert.ok(content.includes('class BatchMigrateWizardModal'), 'must contain BatchMigrateWizardModal class');
  assert.ok(content.includes('class HealthCheckModal'), 'must contain HealthCheckModal class');
  assert.ok(content.includes('class VaultAnalyticsModal'), 'must contain VaultAnalyticsModal class');
});
