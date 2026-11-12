const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadPlugin } = require('./helpers/load-plugin');

test('filterRemoteGallery: sorts items by size, filename, and hits accurately', () => {
  const { filterRemoteGallery } = loadPlugin();
  const items = [
    { year: '2026', month: '11', filename: 'banana.png', size: 1024, hits: 5, createdAt: 100 },
    { year: '2026', month: '11', filename: 'Apple.png', size: 4096, hits: 20, createdAt: 200 },
    { year: '2026', month: '11', filename: 'cherry.png', size: 512, hits: 1, createdAt: 300 }
  ];

  // 1. Size Descending
  let sorted = filterRemoteGallery({ items, selectedBuckets: [], selectedTypes: [], searchQuery: '', selectedSort: 'size_desc' });
  assert.deepEqual(sorted.map(i => i.filename), ['Apple.png', 'banana.png', 'cherry.png']);
  sorted = filterRemoteGallery({ items, selectedBuckets: [], selectedTypes: [], searchQuery: '', selectedSort: 'hits_asc' });
  assert.deepEqual(sorted.map(i => i.filename), ['cherry.png', 'banana.png', 'Apple.png']);

  // 2. Size Ascending
  sorted = filterRemoteGallery({ items, selectedBuckets: [], selectedTypes: [], searchQuery: '', selectedSort: 'size_asc' });
  assert.deepEqual(sorted.map(i => i.filename), ['cherry.png', 'banana.png', 'Apple.png']);

  // 3. Name Ascending (natural order)
  sorted = filterRemoteGallery({ items, selectedBuckets: [], selectedTypes: [], searchQuery: '', selectedSort: 'name_asc' });
  assert.deepEqual(sorted.map(i => i.filename), ['Apple.png', 'banana.png', 'cherry.png']);

  // 4. Name Descending
  sorted = filterRemoteGallery({ items, selectedBuckets: [], selectedTypes: [], searchQuery: '', selectedSort: 'name_desc' });
  assert.deepEqual(sorted.map(i => i.filename), ['cherry.png', 'banana.png', 'Apple.png']);

  // 5. Hits Descending (most viewed)
  sorted = filterRemoteGallery({ items, selectedBuckets: [], selectedTypes: [], searchQuery: '', selectedSort: 'hits_desc' });
  assert.deepEqual(sorted.map(i => i.filename), ['Apple.png', 'banana.png', 'cherry.png']);
});
