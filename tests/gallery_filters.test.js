const test = require('node:test');
const assert = require('node:assert/strict');
const {loadPlugin} = require('./helpers/load-plugin');
const {Element} = require('./helpers/ui');

test('Directory and type selections use OR within a group and AND between groups', () => {
  const {filterRemoteGallery} = loadPlugin();
  const view = {items: [
    {filename:'a.png', year:'2026', month:'11'},
    {filename:'b.mp3', year:'2026', month:'10'},
    {filename:'c.pdf', year:'2026', month:'10'},
    {filename:'d.png', year:'2025', month:'12'}
  ], selectedBuckets:['2026/11','2026/10'], selectedTypes:['image','audio'], searchQuery:'', selectedSort:'name_asc'};
  assert.deepEqual(filterRemoteGallery(view).map(item=>item.filename), ['a.png','b.mp3']);
  view.selectedBuckets = ['2025/12'];
  assert.deepEqual(filterRemoteGallery(view).map(item=>item.filename), ['d.png']);
  view.selectedBuckets = []; view.selectedTypes = [];
  assert.equal(filterRemoteGallery(view).length, 4);
});

test('Shared browser controls synchronize filters and sort choices in both hosts', () => {
  const {galleryStore, galleryToolbar, translateUi} = loadPlugin();
  const plugin = {settings:{}, fetchRemoteFilePage:async()=>({items:[],totalCount:0,buckets:['2026/11','2026/10','2025/12']}), t:(key,params)=>translateUi('zh',key,params)};
  const store = galleryStore(plugin);
  store.state.items = [
    {filename:'a.png',year:'2026',month:'11'},
    {filename:'b.mp3',year:'2026',month:'10'},
    {filename:'c.pdf',year:'2025',month:'12'}
  ];
  store.state.buckets=['2026/11','2026/10','2025/12'];
  const roots = [new Element(),new Element()];
  const toolbars = roots.map(root=>galleryToolbar({plugin,store,t:plugin.t},root));
  const unsubscribe = store.subscribe(()=>toolbars.forEach(toolbar=>toolbar.sync()));
  toolbars.forEach(toolbar=>toolbar.sync());
  const find = (root,tag,label)=>root.all().find(el=>el.tag===tag&&el['aria-label']===label);
  const november = find(roots[0],'input','11'); november.checked = true; november.onchange();
  assert.deepEqual(store.state.selectedBuckets, ['2026/11']);
  assert.equal(find(roots[1],'input','11').checked, true);
  assert.equal(find(roots[1],'input','2026').indeterminate, true);
  const year = find(roots[1],'input','2026'); year.checked = true; year.onchange();
  assert.deepEqual(store.state.selectedBuckets, ['2026/10','2026/11']);
  assert.equal(find(roots[0],'input','2026').indeterminate, false);
  const image = find(roots[0],'input','图片'); image.checked = true; image.onchange();
  const audio = find(roots[1],'input','音频'); audio.checked = true; audio.onchange();
  assert.deepEqual(store.state.selectedTypes, ['audio','image']);
  const oldest = find(roots[0],'input','最早上传'); oldest.checked = true; oldest.onchange();
  assert.equal(store.state.selectedSort, 'time_asc');
  assert.equal(find(roots[1],'input','最早上传').checked, true);
  const newest = find(roots[1],'input','最新上传'); newest.checked = true; newest.onchange();
  assert.equal(store.state.selectedSort, 'time_desc');
  assert.equal(find(roots[0],'input','最新上传').checked, true);
  assert.equal(find(roots[0],'input','最早上传').checked, false);
  const leastViewed = find(roots[0],'input','访问热度从低到高'); leastViewed.checked = true; leastViewed.onchange();
  assert.equal(store.state.selectedSort, 'hits_asc');
  assert.equal(find(roots[1],'input','访问热度从低到高').checked, true);
  roots[0].all().filter(el=>el.tag==='button'&&el.text==='清除').forEach(el=>el.onclick());
  assert.deepEqual(store.state.selectedBuckets, []); assert.deepEqual(store.state.selectedTypes, []);
  unsubscribe(); toolbars.forEach(toolbar=>toolbar.dispose());store.clear();
});
