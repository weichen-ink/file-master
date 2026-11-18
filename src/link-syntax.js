import { IMAGE_EXTS } from './constants.js';

/** Safely decode valid percent-encoded UTF-8 sequences without failing on literal '%' (e.g. "100%"). */
export function decodeValidPercentRuns(input) {
  const str = String(input || '');
  if (!str.includes('%')) return str;
  return str.replace(/(?:%[0-9A-Fa-f]{2})+/g, (seq) => {
    try {
      return decodeURIComponent(seq);
    } catch {
      return seq;
    }
  });
}

/**
 * Mask CommonMark fenced code blocks (``` / ~~~) and inline code spans (`...`)
 * before link scanning or rewriting, restoring them verbatim afterwards.
 */
export function protectMarkdownCodeSegments(text, transform) {
  const src = String(text ?? '');
  if (!src) return src;
  const stash = [];
  const token = (idx) => `\u0000FM_CODE_${idx}\u0000`;
  const lines = src.split('\n');
  let fence = null;
  let blockStart = -1;
  const outLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineBody = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (!fence) {
      const openMatch = lineBody.match(/^[ \t]{0,3}(`{3,}|~{3,})(.*)$/);
      if (openMatch && !(openMatch[1][0] === '`' && openMatch[2].includes('`'))) {
        fence = { char: openMatch[1][0], len: openMatch[1].length };
        blockStart = i;
      } else {
        outLines.push(line);
      }
    } else {
      const closeMatch = lineBody.match(/^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/);
      if (closeMatch && closeMatch[1][0] === fence.char && closeMatch[1].length >= fence.len) {
        const idx = stash.length;
        stash.push(lines.slice(blockStart, i + 1).join('\n'));
        outLines.push(token(idx));
        fence = null;
        blockStart = -1;
      }
    }
  }
  if (fence && blockStart >= 0) {
    const idx = stash.length;
    stash.push(lines.slice(blockStart).join('\n'));
    outLines.push(token(idx));
  }

  const masked = outLines.join('\n').replace(/(`+)([^`\n]|[^`\n][\s\S]*?[^`\n])\1/g, (span) => {
    const idx = stash.length;
    stash.push(span);
    return token(idx);
  });

  const rewritten = transform(masked);
  return rewritten.replace(/\u0000FM_CODE_(\d+)\u0000/g, (_, idx) => stash[Number(idx)] ?? '');
}

/** Replace fenced code blocks and inline code spans with spaces for read-only reference scanning. */
export function stripMarkdownCodeSegments(text) {
  let stripped = '';
  protectMarkdownCodeSegments(text, (masked) => {
    stripped = masked.replace(/\u0000FM_CODE_\d+\u0000/g, ' ');
    return masked;
  });
  return stripped;
}

/** Split a Markdown link destination into { rawTarget, query, fragment }. */
export function splitLinkTargetAndSuffix(rawHref) {
  const href = String(rawHref || '').trim();
  const hashIdx = href.indexOf('#');
  const beforeHash = hashIdx >= 0 ? href.slice(0, hashIdx) : href;
  const fragment = hashIdx >= 0 ? href.slice(hashIdx) : '';
  const queryIdx = beforeHash.indexOf('?');
  const rawTarget = queryIdx >= 0 ? beforeHash.slice(0, queryIdx) : beforeHash;
  const query = queryIdx >= 0 ? beforeHash.slice(queryIdx) : '';
  return { rawTarget, query, fragment };
}

/**
 * Resolve a POSIX path relative to `docPath`'s parent directory.
 * Returns null if `..` traverses above the vault root.
 */
export function resolveRelativePosixPath(docPath, relativeTarget) {
  const normDoc = String(docPath || '').replace(/\\/g, '/');
  const slashIdx = normDoc.lastIndexOf('/');
  const docDir = slashIdx > 0 ? normDoc.slice(0, slashIdx) : '';
  const stack = docDir ? docDir.split('/').filter(Boolean) : [];
  const parts = String(relativeTarget || '').replace(/\\/g, '/').split('/');
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (stack.length === 0) return null;
      stack.pop();
    } else {
      stack.push(part);
    }
  }
  return stack.length > 0 ? stack.join('/') : null;
}

function isExternalOrSpecialTarget(target) {
  return !target || /^(?:https?:|ftp:|mailto:|obsidian:|tel:|data:|#|\/\/)/i.test(target);
}

export function computeRelativePosixPath(fromDocPath, targetPath) {
  if (!fromDocPath || !targetPath || !fromDocPath.includes('/')) return null;
  const fromParts = String(fromDocPath).replace(/\\/g, '/').split('/').slice(0, -1).filter(Boolean);
  const toParts = String(targetPath).replace(/\\/g, '/').split('/').filter(Boolean);
  if (!fromParts.length || !toParts.length) return null;
  let common = 0;
  while (common < fromParts.length && common < toParts.length - 1 && fromParts[common] === toParts[common]) {
    common++;
  }
  const ups = Array(fromParts.length - common).fill('..');
  const rest = toParts.slice(common);
  return [...ups, ...rest].join('/');
}

/**
 * Resolve a parsed WikiLink or Markdown link target to a canonical vault identity:
 * - `{ kind: 'path', path }` when resolved to a concrete vault-relative path
 * - `{ kind: 'bare', name }` ONLY when standalone (no `docPath` and no `resolveLink`)
 * - `null` when external, invalid, escaping root, or an unresolvable/ambiguous bare name
 */
export function resolveVaultLinkIdentity(rawTarget, options = {}) {
  const {
    docPath = '',
    knownPaths = null,
    resolveLink = null,
    linkKind = '',
    allowExtensionlessMd = true,
    allowDocPathlessFallback = false
  } = options || {};

  const trimmed = String(rawTarget || '').trim();
  if (isExternalOrSpecialTarget(trimmed)) return null;

  const unescaped = trimmed.replace(/\\+$/, '').trim();
  if (!unescaped) return null;
  const decoded = decodeValidPercentRuns(unescaped).replace(/\\/g, '/');

  const matchKnown = (candidate) => {
    if (!candidate) return null;
    if (!knownPaths || knownPaths.size === 0) return null;
    if (knownPaths.has(candidate.toLowerCase())) return candidate;
    if (allowExtensionlessMd && !/\.[a-z0-9]+$/i.test(candidate)) {
      for (const ext of ['.md', '.excalidraw.md', '.excalidraw']) {
        const withExt = `${candidate}${ext}`;
        if (knownPaths.has(withExt.toLowerCase())) return withExt;
      }
    }
    return null;
  };

  // 1. Explicit dot-relative path (./ or ../)
  if (decoded.startsWith('./') || decoded.startsWith('../')) {
    if (docPath) {
      const rel = resolveRelativePosixPath(docPath, decoded);
      if (!rel) return null;
      const known = matchKnown(rel);
      return { kind: 'path', path: known || rel };
    }
    if (allowDocPathlessFallback) {
      const stripped = decoded.replace(/^(?:\.\.?\/)+/, '');
      if (!stripped) return null;
      if (stripped.includes('/')) {
        const norm = resolveRelativePosixPath('', stripped);
        return norm ? { kind: 'path', path: norm } : null;
      }
      return { kind: 'bare', name: stripped };
    }
    const rootRel = resolveRelativePosixPath('', decoded);
    return rootRel ? { kind: 'path', path: rootRel } : null;
  }

  // 2. Slash-qualified path (e.g. assets/logo.png or Archive/DupNote)
  if (decoded.includes('/') || decoded.startsWith('/')) {
    const isRootAnchored = decoded.startsWith('/');
    const clean = decoded.replace(/^\/+/, '');
    const normClean = resolveRelativePosixPath('', clean);
    if (!normClean) return null;

    if (isRootAnchored) {
      const rootKnown = matchKnown(normClean);
      return { kind: 'path', path: rootKnown || normClean };
    }

    // Honor authoritative host link resolution before falling back to path heuristics
    if (typeof resolveLink === 'function') {
      const resolved = resolveLink(normClean)
        || (allowExtensionlessMd && !/\.[a-z0-9]+$/i.test(normClean) ? resolveLink(`${normClean}.md`) : null);
      if (resolved) {
        return { kind: 'path', path: String(resolved).replace(/^\.?\//, '') };
      }
    }

    const checkDocRelative = () => {
      if (!docPath || !docPath.includes('/')) return null;
      const docRel = resolveRelativePosixPath(docPath, `./${normClean}`);
      return matchKnown(docRel);
    };

    if (linkKind === 'markdown') {
      const relKnown = checkDocRelative();
      if (relKnown) return { kind: 'path', path: relKnown };
      const rootKnown = matchKnown(normClean);
      if (rootKnown) return { kind: 'path', path: rootKnown };
    } else {
      const rootKnown = matchKnown(normClean);
      if (rootKnown) return { kind: 'path', path: rootKnown };
      const relKnown = checkDocRelative();
      if (relKnown) return { kind: 'path', path: relKnown };
    }

    return { kind: 'path', path: normClean };
  }

  // 3. Bare filename or note basename (no '/')
  if (typeof resolveLink === 'function') {
    const resolved = resolveLink(decoded)
      || (allowExtensionlessMd && !/\.[a-z0-9]+$/i.test(decoded) ? resolveLink(`${decoded}.md`) : null);
    if (!resolved) return null;
    return { kind: 'path', path: String(resolved).replace(/^\.?\//, '') };
  }

  if (!docPath && allowDocPathlessFallback) {
    return { kind: 'bare', name: decoded };
  }

  return null;
}

/** Check whether a resolved link identity refers to `targetItem` (`{ displayPath, name, ext }`). */
export function matchesVaultTargetIdentity(identity, targetItem) {
  if (!identity || !targetItem) return false;
  const targetPath = String(targetItem.displayPath || '').replace(/^\.?\//, '').toLowerCase();
  const targetNoMd = targetItem.ext === 'md' ? targetPath.replace(/\.md$/i, '') : targetPath;
  if (identity.kind === 'path') {
    const candidate = String(identity.path || '').replace(/^\.?\//, '').toLowerCase();
    return candidate === targetPath || (targetItem.ext === 'md' && candidate === targetNoMd);
  }
  if (identity.kind === 'bare') {
    const bare = String(identity.name || '').toLowerCase();
    const itemName = String(targetItem.name || '').toLowerCase();
    const itemBase = targetItem.ext === 'md' ? itemName.replace(/\.md$/i, '') : itemName;
    return bare === itemName || (targetItem.ext === 'md' && bare === itemBase);
  }
  return false;
}

const WIKILINK_TOKEN_RE = /(!?)\[\[([^\]|#\r\n]+?)(#[^\]|\r\n]*?)?(?:(\\?)\|([^\]\r\n]*))?\]\]/g;
const MDLINK_TOKEN_RE = /(!?)\[([^\]\r\n]*)\]\(\s*(?:<([^>\r\n]+)>|((?:[^()\s<>]|\([^()\s<>]*\))+))(\s+(?:"[^"\r\n]*"|'[^'\r\n]*'))?\s*\)/g;

/**
 * Single-pass syntax tokenizer/replacer for WikiLinks and Markdown links/embeds.
 * Uses linear-time patterns with zero nested-quantifier backtracking.
 */
export function replaceMarkdownAndWikiLinks(text, { onWikiLink = null, onMarkdownLink = null } = {}) {
  let out = String(text ?? '');
  if (!out) return out;

  if (typeof onWikiLink === 'function') {
    out = out.replace(WIKILINK_TOKEN_RE, (whole, bang, rawTarget, fragment = '', pipeEsc = '', label) => {
      const cleanTarget = pipeEsc ? rawTarget : rawTarget.replace(/\\+$/, '');
      const inferredEsc = pipeEsc || (cleanTarget !== rawTarget && label !== undefined ? '\\' : '');
      const replacement = onWikiLink({
        kind: 'wikilink',
        whole,
        isEmbed: bang === '!',
        rawTarget: cleanTarget,
        fragment: fragment || '',
        escapedPipe: inferredEsc,
        label
      });
      return typeof replacement === 'string' ? replacement : whole;
    });
  }

  if (typeof onMarkdownLink === 'function') {
    out = out.replace(MDLINK_TOKEN_RE, (whole, bang, label = '', angleHref, bareHref, titlePart = '') => {
      const rawHref = angleHref !== undefined ? angleHref : (bareHref || '');
      const { rawTarget, query, fragment } = splitLinkTargetAndSuffix(rawHref);
      const replacement = onMarkdownLink({
        kind: 'markdown',
        whole,
        isEmbed: bang === '!',
        label,
        rawHref,
        rawTarget,
        query,
        fragment,
        titlePart: titlePart || '',
        angleWrapped: angleHref !== undefined
      });
      return typeof replacement === 'string' ? replacement : whole;
    });
  }

  return out;
}

export function encodeMarkdownUrl(rawUrl) {
  return String(rawUrl || '')
    .replace(/ /g, '%20')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');
}

export function appendUrlFragment(rawUrl, fragment, { encodeParens = false } = {}) {
  const base = String(rawUrl || '');
  if (!fragment) return base;
  const rawFrag = String(fragment).startsWith('#') ? String(fragment).slice(1) : String(fragment);
  if (!rawFrag) return base;
  let safeFrag = rawFrag.replace(/ /g, '%20');
  if (encodeParens) {
    safeFrag = safeFrag.replace(/\(/g, '%28').replace(/\)/g, '%29');
  }
  const baseWithoutHash = base.split('#')[0];
  return `${baseWithoutHash}#${safeFrag}`;
}

/**
 * Format a rewritten link (WikiLink <-> Markdown, local <-> remote) while preserving
 * fragments (`#page=5`, `#t=30`), aliases/alt text, escaped table pipes, and Markdown titles.
 */
export function formatRewrittenLink(parsedLink, keepItem, options = {}) {
  const { docPath = '', knownPaths = null } = options || {};
  const isWiki = parsedLink.kind === 'wikilink';
  const isEmbed = Boolean(parsedLink.isEmbed);
  const label = parsedLink.label ?? '';
  const fragment = parsedLink.fragment || '';
  const titlePart = parsedLink.titlePart || '';

  if (keepItem.source === 'local') {
    const decodedFrag = isWiki ? fragment : decodeValidPercentRuns(fragment);
    if (isWiki && isEmbed) {
      const suffix = label !== '' ? `${parsedLink.escapedPipe || ''}|${label}` : '';
      return `![[${keepItem.displayPath}${decodedFrag}${suffix}]]`;
    }
    if (isWiki && !isEmbed) {
      const targetPath = keepItem.ext === 'md'
        ? keepItem.displayPath.replace(/\.md$/i, '')
        : keepItem.displayPath;
      const suffix = label !== '' ? `${parsedLink.escapedPipe || ''}|${label}` : '';
      return `[[${targetPath}${decodedFrag}${suffix}]]`;
    }
    // Preserve Markdown syntax when a hover title is present since WikiLinks cannot represent titles
    if (titlePart.trim() !== '') {
      let localTarget = keepItem.displayPath;
      if (docPath && docPath.includes('/') && knownPaths && knownPaths.size > 0) {
        const docRelShadow = resolveRelativePosixPath(docPath, `./${localTarget}`);
        if (
          docRelShadow &&
          docRelShadow.toLowerCase() !== localTarget.toLowerCase() &&
          knownPaths.has(docRelShadow.toLowerCase())
        ) {
          localTarget = computeRelativePosixPath(docPath, localTarget) || localTarget;
        }
      }
      const encodedTarget = appendUrlFragment(encodeMarkdownUrl(localTarget), decodedFrag, { encodeParens: true });
      const formattedHref = parsedLink.angleWrapped ? `<${localTarget}${decodedFrag}>` : encodedTarget;
      const prefix = isEmbed ? '!' : '';
      return `${prefix}[${label}](${formattedHref}${titlePart})`;
    }
    const prefix = isEmbed ? '!' : '';
    const alias = label ? `|${label}` : '';
    return `${prefix}[[${keepItem.displayPath}${decodedFrag}${alias}]]`;
  }

  // keepItem.source === 'remote'
  const baseRemoteUrl = encodeMarkdownUrl(keepItem.rawObj.rawUrl);
  const targetUrl = appendUrlFragment(baseRemoteUrl, fragment, { encodeParens: true });

  if (isWiki && isEmbed) {
    return IMAGE_EXTS.has(keepItem.ext)
      ? `![${label}](${targetUrl})`
      : `[📎 ${label || keepItem.name}](${targetUrl})`;
  }
  if (isWiki && !isEmbed) {
    return `[${label || keepItem.name}](${targetUrl})`;
  }

  if (isEmbed && IMAGE_EXTS.has(keepItem.ext)) {
    return `![${label}](${targetUrl}${titlePart})`;
  }
  return `[${label || `📎 ${keepItem.name}`}](${targetUrl}${titlePart})`;
}
