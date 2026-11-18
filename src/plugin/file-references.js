import { createLocalReferenceMatcher, prepareDocumentTextForLocalScan } from '../references.js';
import { createRenameRewriter } from './remote-rename.js';
import { isDocFile, isExcalidrawFile } from './vault-utils.js';

/** Count link occurrences, keeping the owning note for the shared inspection list. */
export async function fileReferenceDocuments(plugin, item, paths = null, documents = null) {
  const remote = item.source === 'remote';
  const file = remote ? item.rawObj || item : item.rawObj || plugin.app.vault.getAbstractFileByPath(item.path || item.displayPath);
  if (!file) throw new Error('Attachment not found');
  let count = 0;
  const vaultFiles = !remote ? plugin.app?.vault?.getFiles?.() : null;
  const knownPaths = !remote
    ? new Set([
        String(file.path || '').toLowerCase(),
        ...(Array.isArray(vaultFiles) ? vaultFiles.map((f) => String(f.path || '').toLowerCase()) : [])
      ])
    : null;
  const match = remote
    ? createRenameRewriter([...new Set([file.rawUrl, file.pubUrl, ...(file.referenceUrls || [])])].filter(Boolean).map(from => ({from, to:'@@file-master-reference@@'})), plugin.getCleanServerUrl())
    : createLocalReferenceMatcher([file], candidate => isExcalidrawFile(plugin.app, candidate), () => count++);
  const wanted = paths && new Set(paths);
  const docs = documents || plugin.app.vault.getFiles().filter(doc => isDocFile(plugin.app, doc)).map(file => ({file, path:file.path}));
  const result = [];
  for (const doc of docs) {
    if (wanted && !wanted.has(doc.path)) continue;
    const text = doc.rawText ?? await plugin.app.vault.read(doc.file);
    if (remote) count = match(text).count;
    else {
      count = 0;
      const docResolveLink = plugin.app?.metadataCache?.getFirstLinkpathDest
        ? (ref) => {
            const dest = plugin.app.metadataCache.getFirstLinkpathDest(ref, doc.path);
            return dest ? dest.path : null;
          }
        : null;
      const prepared = prepareDocumentTextForLocalScan(text, doc.path, knownPaths, docResolveLink);
      match(prepared);
      count = Math.max(count, plugin.app.metadataCache?.resolvedLinks?.[doc.path]?.[file.path] || 0);
    }
    if (count) result.push({path:doc.path, references:count});
  }
  // Do not silently turn missing notes into a trustworthy zero.
  if (wanted && [...wanted].some(path => !docs.some(doc => doc.path === path))) throw new Error('Referencing note not found');
  return result;
}
