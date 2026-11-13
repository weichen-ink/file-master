import { getExt, getFileTypeGroup } from './engine.js';

/** Apply catalog filters and ordering before selecting a page. */
export function queryRemoteFiles(items, options = {}) {
  const query = String(options.q || '').trim().toLowerCase();
  const filtered = items.filter((item) => {
    if (options.buckets?.length && !options.buckets.includes(`${item.year}/${item.month}`)) return false;
    if (options.types?.length && !options.types.includes(getFileTypeGroup(getExt(item.name || item.filename)))) return false;
    return !query || (item.name || item.filename || '').toLowerCase().includes(query);
  });

  const sort = options.sort || 'time_desc';
  filtered.sort((a, b) => {
    if (sort === 'size_desc') return (b.size || 0) - (a.size || 0);
    if (sort === 'size_asc') return (a.size || 0) - (b.size || 0);
    if (sort === 'name_asc') {
      const na = a.name || a.filename || '';
      const nb = b.name || b.filename || '';
      return na.localeCompare(nb, undefined, { numeric: true, sensitivity: 'base' });
    }
    if (sort === 'name_desc') {
      const na = a.name || a.filename || '';
      const nb = b.name || b.filename || '';
      return nb.localeCompare(na, undefined, { numeric: true, sensitivity: 'base' });
    }
    if (sort === 'hits_desc' || sort === 'hits_asc') {
      const difference=(a.hits || 0)-(b.hits || 0);
      return (sort === 'hits_asc' ? difference : -difference) || ((b.createdAt || 0) - (a.createdAt || 0));
    }
    if (sort === 'time_asc') return (a.createdAt || 0) - (b.createdAt || 0);
    return (b.createdAt || 0) - (a.createdAt || 0);
  });

  return filtered;
}

