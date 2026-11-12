import { createLocalReferenceMatcher, stripRemoteReferenceText } from '../references.js';
import { createRenameRewriter } from './remote-rename.js';
import { isDocFile, isExcalidrawFile } from './vault-utils.js';

/** Count link occurrences, keeping the owning note for the shared inspection list. */
export async function fileReferenceDocuments(plugin, item, paths = null, documents = null) {
  const remote = item.source === 'remote';
  const file = remote ? item.rawObj || item : item.rawObj || plugin.app.vault.getAbstractFileByPath(item.path || item.displayPath);
  if (!file) throw new Error('Attachment not found');
  let count = 0;
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
      let decoded = text;
      try { decoded = decodeURIComponent(text); } catch {}
      match(stripRemoteReferenceText(decoded));
      count = Math.max(count, plugin.app.metadataCache?.resolvedLinks?.[doc.path]?.[file.path] || 0);
    }
    if (count) result.push({path:doc.path, references:count});
  }
  // Do not silently turn missing notes into a trustworthy zero.
  if (wanted && [...wanted].some(path => !docs.some(doc => doc.path === path))) throw new Error('Referencing note not found');
  return result;
}
