const assert = require('node:assert/strict');
const { createObsidianSimulation } = require('../dev/obsidian');

async function main() {
  const { plugin, add, OrphanWizardModal } = createObsidianSimulation();
  add('work/used.png', 'referenced image', true);
  add('work/unused.png', 'unreferenced image', true);
  add('elsewhere/unused.png', 'out-of-scope image', true);
  add('notes/intro.md', '![[work/used.png]]');

  const modal = new OrphanWizardModal(plugin.app, plugin);
  modal.onOpen();
  const include = modal.contentEl.querySelector('.fm-folder-input');
  include.value = 'work';
  include.oninput();
  const next = modal.contentEl.all().find((node) => node.tag === 'button' && node.text === plugin.t('btnNext'));
  assert.ok(next, 'The orphan scan wizard should have a Next button');
  await next.onclick();
  assert.equal(modal.step, 2);

  const orphanPaths = modal.results.map((item) => item.displayPath);
  assert.deepEqual(orphanPaths, ['work/unused.png']);
  console.log(JSON.stringify({ scenario: 'scoped-orphan-scan', orphanPaths }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
