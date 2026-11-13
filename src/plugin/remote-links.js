import { createUrlRewriter } from '../url-rewrite.js';
import { assetUrl } from '../ui/links.js';

const referenceUrls = item => [...new Set([item.rawUrl, item.pubUrl, ...(item.referenceUrls || [])])].filter(Boolean);
const decoded = value => { try { return decodeURI(value); } catch { return value; } };

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
