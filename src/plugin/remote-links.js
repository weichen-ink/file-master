import { createUrlRewriter } from '../url-rewrite.js';
import { assetUrl } from '../ui/links.js';

const referenceUrls = item => [...new Set([item.rawUrl, item.pubUrl, ...(item.referenceUrls || [])])].filter(Boolean);
const decoded = value => { try { return decodeURI(value); } catch { return value; } };

export function remoteCandidateUrls(item, serverUrl = '') {
  let apiOrigin = '';
  try { apiOrigin = new URL(serverUrl).origin; } catch {}
  const out = new Set();
  for (const value of referenceUrls(item)) {
    out.add(value);
    out.add(encodeURI(value));
    out.add(decoded(value));
    try {
      const parsed = new URL(value);
      if (apiOrigin && parsed.origin !== apiOrigin) {
        const apiUrl = `${apiOrigin}${parsed.pathname}${parsed.search}${parsed.hash}`;
        out.add(apiUrl);
        out.add(encodeURI(apiUrl));
        out.add(decoded(apiUrl));
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
