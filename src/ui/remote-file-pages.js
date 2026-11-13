export const REMOTE_FILE_BATCH_SIZE = 20;

/** Shared request lifecycle for the rename picker, Hub browser and sidebar. */
export class RemoteFilePages {
  constructor(plugin, query = {}) {
    this.plugin = plugin; this.query = query; this.listeners = new Set(); this.revision = 0; this.pending = null; this.nextOffset = 0;
    this.state = { items: [], buckets: [], totalCount: 0, loaded: false, loading: false, error: null, hasMore: false };
  }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { this.listeners.forEach(fn => fn(this.state)); }
  patch(values) { Object.assign(this.state, values); this.emit(); }
  load(force = false) {
    if (this.pending && !force) return this.pending;
    if (this.state.loaded && !force) return Promise.resolve();
    this.revision++;
    this.nextOffset = 0;
    this.patch({ items: [], loaded: false, hasMore: false, error: null });
    return this.request(false);
  }
  loadMore() {
    if (this.pending) return this.pending;
    if (!this.state.hasMore) return Promise.resolve();
    return this.request(true);
  }
  request(append) {
    const revision = this.revision, offset = append ? this.nextOffset : 0, query = { ...this.query };
    this.patch({ loading: true, error: null });
    const pending = Promise.resolve().then(async () => {
      try {
        const page = await this.plugin.fetchRemoteFilePage({ ...query, limit: REMOTE_FILE_BATCH_SIZE, offset });
        if (revision !== this.revision) return;
        const known = new Map((append ? this.state.items : []).map(item => [`${item.year}/${item.month}/${item.filename}`, item]));
        this.nextOffset = offset + page.items.length;
        page.items.forEach(item => known.set(`${item.year}/${item.month}/${item.filename}`, item));
        this.patch({ items: [...known.values()], totalCount: page.totalCount, buckets: page.buckets,
          loaded: true, loading: false, hasMore: page.items.length > 0 && offset + page.items.length < page.totalCount });
      } catch (error) {
        if (revision === this.revision) this.patch({ loading: false, error: error.message || String(error) });
      } finally { if (this.pending === pending) this.pending = null; }
    });
    this.pending = pending; return pending;
  }
  setQuery(query) { this.query = query; return this.load(true); }
  clear() { this.revision++; this.pending = null; this.listeners.clear(); Object.assign(this.state, {items:[], buckets:[], loaded:false, loading:false, error:null, hasMore:false, totalCount:0}); this.nextOffset = 0; }
}

/** A quiet fallback button keeps loading usable with keyboard navigation and without observers. */
export function scrollLoader(root, control, load) {
  const observer = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting) && !control.hidden && !control.disabled) load(); }, { root, rootMargin: '0px 0px 100px 0px' })
    : null;
  observer?.observe(control);
  control.onclick = load;
  return () => observer?.disconnect();
}
