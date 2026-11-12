import { createUrlRewriter } from '../url-rewrite.js';
import { IMAGE_EXTS } from '../constants.js';
import { escapeRegExp, isExcalidrawContent, rewriteExcalidrawEmbeddedFiles } from '../engine.js';

// The plugin owns host state; these operations receive it explicitly.
export function rewriteContentLinks(plugin, content, removeItem, keepItem, docPathOrContext = '') {
  if (typeof content !== 'string' || !content) return content;

  const docPath = typeof docPathOrContext === 'string' ? docPathOrContext : (docPathOrContext?.docPath || '');
  const customResolve = typeof docPathOrContext === 'object' && typeof docPathOrContext?.resolveLink === 'function'
    ? docPathOrContext.resolveLink
    : null;

  const resolveLink = (ref) => {
    if (customResolve) return customResolve(ref);
    if (plugin.app?.metadataCache?.getFirstLinkpathDest) {
      const tfile = plugin.app.metadataCache.getFirstLinkpathDest(ref, docPath || '');
      return tfile ? tfile.path : null;
    }
    return null;
  };

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
      excalSection = rewriteExcalidrawEmbeddedFiles(match[0], removeItem, keepItem, { docPath, resolveLink });
    } else {
      excalSection = match[0];
    }
    preSection = content.slice(0, match.index);
    postSection = content.slice(match.index + match[0].length);
  }

  const buildReplacementForWikiEmbed = (aliasOrWidth) => {
    if (keepItem.source === 'local') {
      const suffix = aliasOrWidth ? `|${aliasOrWidth}` : '';
      return `![[${keepItem.displayPath}${suffix}]]`;
    } else {
      const alt = aliasOrWidth || '';
      return IMAGE_EXTS.has(keepItem.ext)
        ? `![${alt}](${keepItem.rawObj.rawUrl})`
        : `[📎 ${aliasOrWidth || keepItem.name}](${keepItem.rawObj.rawUrl})`;
    }
  };

  const buildReplacementForWikiLink = (aliasText) => {
    if (keepItem.source === 'local') {
      const suffix = aliasText ? `|${aliasText}` : '';
      return `[[${keepItem.displayPath}${suffix}]]`;
    } else {
      return `[${aliasText || keepItem.name}](${keepItem.rawObj.rawUrl})`;
    }
  };

  const buildReplacementForMdLink = (isEmbed, altText) => {
    if (keepItem.source === 'local') {
      const prefix = isEmbed ? '!' : '';
      const alias = altText ? `|${altText}` : '';
      return `${prefix}[[${keepItem.displayPath}${alias}]]`;
    } else {
      if (isEmbed && IMAGE_EXTS.has(keepItem.ext)) {
        return `![${altText || ''}](${keepItem.rawObj.rawUrl})`;
      }
      return `[${altText || '📎 ' + keepItem.name}](${keepItem.rawObj.rawUrl})`;
    }
  };

  const rewriteMarkdownFragment = (fragment) => {
    if (!fragment) return fragment;
    let updated = fragment;

    if (removeItem.source === 'local') {
      const candidates = new Set([
        removeItem.displayPath,
        removeItem.name,
        encodeURI(removeItem.displayPath),
        encodeURI(removeItem.name),
        encodeURIComponent(removeItem.name)
      ]);

      const isBareCandidate = (c) => !c.includes('/');

      for (const cand of candidates) {
        const esc = escapeRegExp(cand);
        const isBare = isBareCandidate(cand);

        const checkBareMatchAllowed = () => {
          if (!isBare) return true;
          const hasActiveResolver = Boolean(
            customResolve ||
            (plugin.app?.metadataCache?.getFirstLinkpathDest && docPath)
          );
          if (hasActiveResolver) {
            const dest = resolveLink(cand);
            if (!dest) {
              // Link is dangling, ambiguous, or resolves to another file -> do NOT rewrite
              return false;
            }
            const destPath = dest.toLowerCase().replace(/^\.?\//, '');
            const targetPath = (removeItem.displayPath || '').toLowerCase().replace(/^\.?\//, '');
            return destPath === targetPath;
          }
          return true;
        };

        const wikiEmbedRe = new RegExp(`!\\[\\[(?:\\.\\/)?${esc}(?:#[^\\]|]*)?(?:\\|([^\\]]*))?\\]\\]`, 'g');
        updated = updated.replace(wikiEmbedRe, (m, alias) => {
          if (!checkBareMatchAllowed()) return m;
          return buildReplacementForWikiEmbed(alias);
        });

        const wikiLinkRe = new RegExp(`(?<!!)\\[\\[(?:\\.\\/)?${esc}(?:#[^\\]|]*)?(?:\\|([^\\]]*))?\\]\\]`, 'g');
        updated = updated.replace(wikiLinkRe, (m, alias) => {
          if (!checkBareMatchAllowed()) return m;
          return buildReplacementForWikiLink(alias);
        });

        const mdLinkRe = new RegExp(`(!?)\\[([^\\]]*)\\]\\(<?(?:\\.\\.?\\/)*${esc}(?:[?#][^)\\s>]*)?>?\\)`, 'g');
        updated = updated.replace(mdLinkRe, (m, bang, alt) => {
          if (!checkBareMatchAllowed()) return m;
          return buildReplacementForMdLink(bang === '!', alt);
        });
      }

      if (keepItem.source === 'local') {
        updated = updated.split(`"${removeItem.displayPath}"`).join(`"${keepItem.displayPath}"`);
      } else {
        updated = updated.split(`"${removeItem.displayPath}"`).join(`"${keepItem.rawObj.rawUrl}"`);
      }
    } else {
      const r = removeItem.rawObj;
      const urls = [...new Set([r.rawUrl, r.pubUrl, ...(r.referenceUrls || [])])].filter(Boolean);
      if (keepItem.source === 'remote') {
        const mappings = urls.map(from => ({from, to: from === r.pubUrl ? keepItem.rawObj.pubUrl || keepItem.rawObj.rawUrl : keepItem.rawObj.rawUrl}));
        updated = createUrlRewriter(mappings, plugin.getCleanServerUrl?.() || '')(updated).text;
      } else {
        const match = createUrlRewriter(urls.map(from => ({from, to:'@@fm-reference@@'})));
        updated = updated.replace(/(!?)\[([^\]]*)\]\((<?)([^)]+?)>?\)/g, (whole,bang,alt,angle,url) =>
          match(url).count ? buildReplacementForMdLink(bang === '!',alt) : whole);
      }
    }

    return updated;
  };

  const rewrittenPre = rewriteMarkdownFragment(preSection);
  const rewrittenPost = rewriteMarkdownFragment(postSection);

  if (match && excalSection !== null) {
    return rewrittenPre + excalSection + rewrittenPost;
  }
  return rewrittenPre;
}
