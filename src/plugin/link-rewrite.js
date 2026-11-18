import { createUrlRewriter } from '../url-rewrite.js';
import { isExcalidrawContent, rewriteExcalidrawEmbeddedFiles } from '../engine.js';
import {
  appendUrlFragment,
  decodeValidPercentRuns,
  formatRewrittenLink,
  matchesVaultTargetIdentity,
  protectMarkdownCodeSegments,
  replaceMarkdownAndWikiLinks,
  resolveVaultLinkIdentity,
  splitLinkTargetAndSuffix
} from '../link-syntax.js';

function rewriteCanvasDocument(content, removeItem, keepItem, resolveCtx, rewriteMarkdownFragment) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.nodes)) {
    return null;
  }

  const indentMatch = content.match(/^\{\r?\n([ \t]+)/);
  const indent = indentMatch ? indentMatch[1] : undefined;
  let mutatedStructurally = false;
  let textNodeChanged = false;

  const remoteUrls = removeItem.source === 'remote' && removeItem.rawObj
    ? [...new Set([removeItem.rawObj.rawUrl, removeItem.rawObj.pubUrl, ...(removeItem.rawObj.referenceUrls || [])])].filter(Boolean)
    : [];
  const remoteUrlMatcher = remoteUrls.length
    ? createUrlRewriter(remoteUrls.map((from) => ({ from, to: '@@fm-canvas-match@@' })))
    : null;

  for (const node of parsed.nodes) {
    if (!node || typeof node !== 'object') continue;
    if (node.type === 'file' && typeof node.file === 'string' && removeItem.source === 'local') {
      const identity = resolveVaultLinkIdentity(node.file, resolveCtx);
      if (matchesVaultTargetIdentity(identity, removeItem)) {
        if (keepItem.source === 'local') {
          node.file = keepItem.displayPath;
          mutatedStructurally = true;
        } else if (keepItem.rawObj?.rawUrl) {
          // JSON Canvas spec: external URLs must use type:"link" + url, never type:"file"
          const baseUrl = String(keepItem.rawObj.rawUrl).replace(/ /g, '%20');
          node.type = 'link';
          node.url = appendUrlFragment(baseUrl, node.subpath || '');
          delete node.file;
          delete node.subpath;
          mutatedStructurally = true;
        }
      }
    } else if (node.type === 'link' && typeof node.url === 'string' && removeItem.source === 'remote') {
      const { rawTarget, fragment } = splitLinkTargetAndSuffix(node.url);
      const matched = remoteUrlMatcher ? remoteUrlMatcher(rawTarget) : { count: 0, text: '' };
      if (keepItem.source === 'local' && matched.count === 1 && matched.text === '@@fm-canvas-match@@') {
        node.type = 'file';
        node.file = keepItem.displayPath;
        if (fragment) {
          node.subpath = decodeValidPercentRuns(fragment);
        } else {
          delete node.subpath;
        }
        delete node.url;
        mutatedStructurally = true;
      } else if (keepItem.source === 'remote') {
        const nextUrl = rewriteMarkdownFragment(node.url);
        if (nextUrl !== node.url) {
          node.url = nextUrl;
          textNodeChanged = true;
        }
      }
    } else if (node.type === 'text' && typeof node.text === 'string') {
      const nextText = rewriteMarkdownFragment(node.text);
      if (nextText !== node.text) {
        node.text = nextText;
        textNodeChanged = true;
      }
    }
  }

  if (!mutatedStructurally && !textNodeChanged) {
    return content;
  }
  return JSON.stringify(parsed, null, indent);
}

// The plugin owns host state; these operations receive it explicitly.
export function rewriteContentLinks(plugin, content, removeItem, keepItem, docPathOrContext = '') {
  if (typeof content !== 'string' || !content) return content;

  const docPath = typeof docPathOrContext === 'string' ? docPathOrContext : (docPathOrContext?.docPath || '');
  const customResolve = typeof docPathOrContext === 'object' && typeof docPathOrContext?.resolveLink === 'function'
    ? docPathOrContext.resolveLink
    : null;

  const resolveLink = (ref) => {
    if (customResolve) return customResolve(ref);
    if (plugin?.app?.metadataCache?.getFirstLinkpathDest) {
      const tfile = plugin.app.metadataCache.getFirstLinkpathDest(ref, docPath || '');
      return tfile ? tfile.path : null;
    }
    return null;
  };

  const hasActiveResolver = Boolean(
    customResolve ||
    (plugin?.app?.metadataCache?.getFirstLinkpathDest && docPath)
  );
  const vaultFiles = plugin?.app?.vault?.getFiles?.();
  const knownPaths = Array.isArray(vaultFiles) && vaultFiles.length > 0
    ? new Set(vaultFiles.map((f) => String(f.path || '').toLowerCase()))
    : null;

  const resolveCtx = {
    docPath,
    knownPaths,
    resolveLink: hasActiveResolver ? resolveLink : null,
    allowExtensionlessMd: true,
    allowDocPathlessFallback: !docPath && !hasActiveResolver
  };

  const rewriteMarkdownCore = (fragment) => {
    if (!fragment) return fragment;

    if (removeItem.source === 'local') {
      const rewriteIfMatched = (link) => {
        const identity = resolveVaultLinkIdentity(link.rawTarget, {
          ...resolveCtx,
          linkKind: link.kind
        });
        if (!matchesVaultTargetIdentity(identity, removeItem)) return link.whole;
        return formatRewrittenLink(link, keepItem, { docPath, knownPaths });
      };
      return replaceMarkdownAndWikiLinks(fragment, {
        onWikiLink: rewriteIfMatched,
        onMarkdownLink: rewriteIfMatched
      });
    }

    const r = removeItem.rawObj;
    const urls = [...new Set([r.rawUrl, r.pubUrl, ...(r.referenceUrls || [])])].filter(Boolean);
    const serverUrl = plugin?.settings ? (plugin.getCleanServerUrl?.() || '') : '';
    if (keepItem.source === 'remote') {
      const mappings = urls.map((from) => ({
        from,
        to: from === r.pubUrl ? keepItem.rawObj.pubUrl || keepItem.rawObj.rawUrl : keepItem.rawObj.rawUrl
      }));
      return createUrlRewriter(mappings, serverUrl)(fragment).text;
    }

    const match = createUrlRewriter(urls.map((from) => ({ from, to: '@@fm-reference@@' })), serverUrl);
    return replaceMarkdownAndWikiLinks(fragment, {
      onMarkdownLink(link) {
        const matched = match(link.rawTarget);
        if (matched.count === 1 && matched.text === '@@fm-reference@@') {
          return formatRewrittenLink(link, keepItem, { docPath, knownPaths });
        }
        return link.whole;
      }
    });
  };

  if (docPath && docPath.toLowerCase().endsWith('.canvas') && !(removeItem.source === 'remote' && keepItem.source === 'remote')) {
    const canvasRewritten = rewriteCanvasDocument(
      content,
      removeItem,
      keepItem,
      resolveCtx,
      (frag) => protectMarkdownCodeSegments(frag, rewriteMarkdownCore)
    );
    if (canvasRewritten !== null) {
      return canvasRewritten;
    }
  }

  const isDocExcalidraw =
    (docPath && (docPath.endsWith('.excalidraw.md') || docPath.endsWith('.excalidraw'))) ||
    (!docPath && /(^##\s+Embedded [Ff]iles\s*?\r?\n)/m.test(content)) ||
    (typeof isExcalidrawContent === 'function' && isExcalidrawContent(content));

  let excalSection = null;
  let preSection = content;
  let postSection = '';
  const sectionRegex = /(^##\s+Embedded [Ff]iles\s*?\r?\n)([\s\S]*?)(?=(?:\r?\n## |\r?\n%%|\r?\n# |$))/m;
  const match = isDocExcalidraw ? sectionRegex.exec(content) : null;
  if (match) {
    if (typeof rewriteExcalidrawEmbeddedFiles === 'function') {
      excalSection = rewriteExcalidrawEmbeddedFiles(match[0], removeItem, keepItem, {
        docPath,
        knownPaths,
        resolveLink: hasActiveResolver ? resolveLink : null
      });
    } else {
      excalSection = match[0];
    }
    preSection = content.slice(0, match.index);
    postSection = content.slice(match.index + match[0].length);
  }

  const rewrittenPre = protectMarkdownCodeSegments(preSection, rewriteMarkdownCore);
  const rewrittenPost = protectMarkdownCodeSegments(postSection, rewriteMarkdownCore);

  if (match && excalSection !== null) {
    return rewrittenPre + excalSection + rewrittenPost;
  }
  return rewrittenPre;
}
