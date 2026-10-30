const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Extract UI_STRINGS and helper functions from main.js or src/i18n.js
const i18nCode = fs.readFileSync(path.resolve(__dirname, '../src/i18n.js'), 'utf8');

// Evaluate in sandbox context
const sandbox = {
  UI_STRINGS: null,
  getEffectiveLanguage: null,
  translateUi: null,
  window: { localStorage: { getItem: () => null } }
};
const fn = new Function('sandbox', `
  with(sandbox) {
    ${i18nCode}
    sandbox.UI_STRINGS = UI_STRINGS;
    sandbox.getEffectiveLanguage = getEffectiveLanguage;
    sandbox.translateUi = translateUi;
  }
`);
fn(sandbox);

const { UI_STRINGS, getEffectiveLanguage, translateUi } = sandbox;

test('i18n: language resolution follows Obsidian language when auto', () => {
  // 1. Explicit languages
  assert.strictEqual(getEffectiveLanguage('zh'), 'zh');
  assert.strictEqual(getEffectiveLanguage('en'), 'en');

  // 2. Auto with window.localStorage 'zh', 'zh-CN', 'zh-TW'
  sandbox.window.localStorage.getItem = (k) => (k === 'language' ? 'zh-CN' : null);
  assert.strictEqual(getEffectiveLanguage('auto'), 'zh');

  sandbox.window.localStorage.getItem = (k) => (k === 'language' ? 'zh-TW' : null);
  assert.strictEqual(getEffectiveLanguage('auto'), 'zh');

  // 3. Auto with window.localStorage 'en' or other
  sandbox.window.localStorage.getItem = (k) => (k === 'language' ? 'en' : null);
  assert.strictEqual(getEffectiveLanguage('auto'), 'en');

  sandbox.window.localStorage.getItem = (k) => (k === 'language' ? 'ja' : null);
  assert.strictEqual(getEffectiveLanguage('auto'), 'en');

  // Obsidian's own UI language takes precedence over stale localStorage.
  sandbox.window.localStorage.getItem = () => 'en';
  sandbox.getLanguage = () => 'zh-CN';
  assert.strictEqual(getEffectiveLanguage('auto'), 'zh');
  sandbox.getLanguage = () => 'en';
  assert.strictEqual(getEffectiveLanguage('auto'), 'en');
  sandbox.getLanguage = undefined;
  sandbox.window.localStorage.getItem = () => null;
  sandbox.document = { documentElement: { lang: 'zh-CN' } };
  assert.strictEqual(getEffectiveLanguage('auto'), 'zh');
});

test('i18n: translation keys exist in both zh and en dictionaries', () => {
  const zhKeys = Object.keys(UI_STRINGS.zh);
  const enKeys = Object.keys(UI_STRINGS.en);

  const missingInEn = zhKeys.filter((k) => !(k in UI_STRINGS.en));
  const missingInZh = enKeys.filter((k) => !(k in UI_STRINGS.zh));

  assert.deepStrictEqual(missingInEn, [], 'All zh keys must have an English translation');
  assert.deepStrictEqual(missingInZh, [], 'All en keys must have a Chinese translation');
});

test('i18n: context menus and command keys are localized', () => {
  const sampleKeys = [
    'menuMigrateFolder',
    'menuRemoveExclusion',
    'menuAddExclusion',
    'menuUploadCloud',
    'menuUploadProtected',
    'menuCopyRaw',
    'menuCopyWebp',
    'menuDownloadToVault',
    'menuLockRemote',
    'cmdOpenHub',
    'cmdScanHealth',
    'cmdScanOrphan',
    'cmdScanDuplicate',
    'cmdBatchMigrate',
    'cmdVaultAnalytics',
    'cmdMigrateActiveNote',
    'cmdDownloadActiveNote',
    'cmdCopyAstroLinks'
  ];

  for (const k of sampleKeys) {
    const zhVal = translateUi('zh', k, { name: 'test.png' });
    const enVal = translateUi('en', k, { name: 'test.png' });

    assert.ok(zhVal && zhVal !== k, `Key ${k} should have valid zh string`);
    assert.ok(enVal && enVal !== k, `Key ${k} should have valid en string`);
    assert.notStrictEqual(zhVal, enVal, `Key ${k} should differ between zh and en`);
  }
});

