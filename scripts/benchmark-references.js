const { performance } = require('node:perf_hooks');
const { loadPlugin } = require('../tests/helpers/load-plugin');
const { createLocalReferenceMatcher, stripRemoteReferenceText } = loadPlugin();

for (const count of [1000, 3000]) {
  const files = Array.from({ length: count }, (_, i) => ({ path: `attachments/asset-${i}.png`,
    name: `asset-${i}.png`, extension: 'png' }));
  const docs = Array.from({ length: count }, (_, i) => '# note ' + i + '\n' +
    'Some text with a remote image ![](https://example.com/test.png) and other text.\n'.repeat(120) +
    `\n![[asset-${i}.png]]`);
  const start = performance.now();
  const match = createLocalReferenceMatcher(files, () => false);
  let hits = 0;
  for (const doc of docs) hits += match(stripRemoteReferenceText(doc)).size;
  if (hits !== count) throw new Error(`Unexpected reference count: ${hits}`);
  console.log(JSON.stringify({ attachments: count, notes: count, charsPerNote: docs[0].length,
    hits, buildAndMatchMs: Math.round(performance.now() - start) }));
}
