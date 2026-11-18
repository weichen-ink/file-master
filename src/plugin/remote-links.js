import { createUrlRewriter } from '../url-rewrite.js';
import { assetUrl } from '../ui/links.js';

const referenceUrls = item => [...new Set([item.rawUrl, item.pubUrl, ...(item.referenceUrls || [])])].filter(Boolean);
const decoded = value => {
  try { return decodeURI(value); } catch {}
  return String(value || '').replace(/(?:%[0-9A-Fa-f]{2})+/g, seq => {
    try { return decodeURIComponent(seq); } catch { return seq; }
  });
};
const encodeParens = value => String(value || '').replace(/\(/g, '%28').replace(/\)/g, '%29');

export function remoteCandidateUrls(item, serverUrl = '') {
  let apiOrigin = '';
  try { apiOrigin = new URL(serverUrl).origin; } catch {}
  const out = new Set();
  const addVariants = (val) => {
    const dec = decoded(val);
    const enc = encodeURI(dec);
    out.add(val);
    out.add(dec);
    out.add(enc);
    out.add(encodeParens(enc));
    out.add(encodeParens(dec));
  };
  for (const value of referenceUrls(item)) {
    addVariants(value);
    try {
      const parsed = new URL(value);
      if (apiOrigin && parsed.origin !== apiOrigin) {
        const apiUrl = `${apiOrigin}${parsed.pathname}${parsed.search}${parsed.hash}`;
        addVariants(apiUrl);
      }
    } catch {}
  }
  return [...out].filter(Boolean);
}

/** Use server metadata for both public URLs and the same paths reached through the API origin. */
export function findRemoteAsset(items, reference, serverUrl = '') {
  let source, apiOrigin;
  try { source = new URL(reference); } catch { return null; }
  try { apiOrigin = new URL(serverUrl).origin; } catch { }
  return items.find(item => referenceUrls(item).some(value => {
    let candidate;
    try { candidate = new URL(value); } catch { return false; }
    return decoded(source.pathname) === decoded(candidate.pathname)
      && (source.origin === candidate.origin || source.origin === apiOrigin);
  })) || null;
}

/** Share the existing URL boundary, encoding, query and fragment handling with rename operations. */
export function createAssetLinkRewriter(items, serverUrl = '', mode = 'webp') {
  const mappings = items.flatMap(item => referenceUrls(item).map(from => ({ from, to: assetUrl(item, mode) })));
  return createUrlRewriter(mappings, serverUrl);
}
