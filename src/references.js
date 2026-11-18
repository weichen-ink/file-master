import { getBaseName } from './engine.js';
import {
  decodeValidPercentRuns,
  replaceMarkdownAndWikiLinks,
  resolveRelativePosixPath,
  resolveVaultLinkIdentity,
  stripMarkdownCodeSegments
} from './link-syntax.js';

export { decodeValidPercentRuns };

/**
 * Resolve relative Markdown and WikiLink targets (`../`, `./`, doc-dir-relative,
 * percent-encoded, and optionally resolver-confirmed bare targets) in-place so
 * occurrence counts and vault reference snapshots match link rewriting 1:1.
 */
export function normalizeRelativeLinksInText(input, docPath = '', knownPaths = null, resolveLink = null) {
  const text = String(input || '');
  if (!text) return text;

  return replaceMarkdownAndWikiLinks(text, {
    onWikiLink(link) {
      const id = resolveVaultLinkIdentity(link.rawTarget, {
        docPath,
        knownPaths,
        resolveLink,
        linkKind: 'wikilink',
        allowExtensionlessMd: true,
        allowDocPathlessFallback: false
      });
      const nextTarget = id && id.kind === 'path'
        ? id.path
        : decodeValidPercentRuns(link.rawTarget);
      if (nextTarget === link.rawTarget) return link.whole;
      const prefix = link.isEmbed ? '!' : '';
      const suffix = link.label !== undefined ? `${link.escapedPipe || ''}|${link.label}` : '';
      return `${prefix}[[${nextTarget}${link.fragment || ''}${suffix}]]`;
    },
    onMarkdownLink(link) {
      const id = resolveVaultLinkIdentity(link.rawTarget, {
        docPath,
        knownPaths,
        resolveLink,
        linkKind: 'markdown',
        allowExtensionlessMd: true,
        allowDocPathlessFallback: false
      });
      let nextTarget = null;
      if (id && id.kind === 'path') {
        nextTarget = id.path;
      } else if (!/^(?:https?:|ftp:|mailto:|obsidian:|tel:|data:|#|\/\/)/i.test(link.rawTarget) && link.rawTarget.includes('%')) {
        nextTarget = decodeValidPercentRuns(link.rawTarget);
      }
      if (!nextTarget) return link.whole;
      const prefix = link.isEmbed ? '!' : '';
      const fullHref = `${nextTarget}${link.query || ''}${link.fragment || ''}`;
      const formattedHref = /[\s()]/.test(fullHref) || link.angleWrapped
        ? `<${fullHref}>`
        : fullHref;
      return `${prefix}[${link.label || ''}](${formattedHref}${link.titlePart || ''})`;
    }
  });
}

function normalizeExcalidrawEmbeddedLines(text, docPath, knownPaths, resolveLink) {
  const sectionRegex = /(^##\s+Embedded [Ff]iles\s*?\r?\n)([\s\S]*?)(?=(?:\r?\n## |\r?\n%%|\r?\n# |$))/m;
  const match = sectionRegex.exec(text);
  if (!match) return text;
  const header = match[1];
  const body = match[2];
  const updatedBody = body.split('\n').map((line) => {
    const lineMatch = line.match(/^([a-zA-Z0-9_-]+:\s*)(.+)$/);
    if (!lineMatch) return line;
    const prefix = lineMatch[1];
    const val = lineMatch[2].trim();
    if (!val || /^!?\[\[|^!?\[|^https?:\/\//i.test(val)) return line;
    const id = resolveVaultLinkIdentity(val, {
      docPath,
      knownPaths,
      resolveLink,
      allowExtensionlessMd: false,
      allowDocPathlessFallback: false
    });
    const nextVal = id && id.kind === 'path' ? id.path : decodeValidPercentRuns(val);
    return `${prefix}[[${nextVal}]]`;
  }).join('\n');
  return text.slice(0, match.index) + header + updatedBody + text.slice(match.index + match[0].length);
}

/**
 * Prepare a document's text for local reference scanning:
 * - Strips fenced/inline Markdown code segments so code examples never count as live links
 * - Parses JSON Canvas `file` and `text` nodes cleanly
 * - Strips remote URLs and resolves relative/encoded local targets against `docPath`
 */
export function prepareDocumentTextForLocalScan(rawText, docPath = '', knownPaths = null, resolveLink = null) {
  const src = String(rawText || '');
  if (!src) return '';

  if (docPath && docPath.toLowerCase().endsWith('.canvas')) {
    try {
      const parsed = JSON.parse(src);
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.nodes)) {
        const chunks = [];
        for (const node of parsed.nodes) {
          if (!node || typeof node !== 'object') continue;
          if (node.type === 'file' && typeof node.file === 'string' && node.file.trim()) {
            const rawFile = node.file.trim();
            let resolvedFile = decodeValidPercentRuns(rawFile);
            if (resolvedFile.startsWith('./') || resolvedFile.startsWith('../')) {
              resolvedFile = resolveRelativePosixPath(docPath, resolvedFile) || resolvedFile;
            } else {
              resolvedFile = resolvedFile.replace(/^\.?\//, '');
            }
            chunks.push(`![[${resolvedFile}]]`);
          } else if (node.type === 'text' && typeof node.text === 'string' && node.text) {
            const noCode = stripMarkdownCodeSegments(node.text);
            const noRemote = stripRemoteReferenceText(noCode);
            chunks.push(normalizeRelativeLinksInText(noRemote, docPath, knownPaths, resolveLink));
          }
        }
        return chunks.join('\n');
      }
    } catch {
      // Fall through to plain-text scan if Canvas JSON is malformed
    }
  }

  const noCode = stripMarkdownCodeSegments(src);
  const noRemote = stripRemoteReferenceText(noCode);
  const normalized = normalizeRelativeLinksInText(noRemote, docPath, knownPaths, resolveLink);
  return normalizeExcalidrawEmbeddedLines(normalized, docPath, knownPaths, resolveLink);
}

function isAllowedWhitespacePrefix(text, start) {
  let k = start - 1;
  while (k >= 0 && (text[k] === ' ' || text[k] === '\t')) k--;
  return k < 0 || /[\[\(<"':\r\n]/.test(text[k]);
}

/** Match all reference candidates in one pass through each document. */
export function createTextReferenceMatcher(patterns, onMatch = null) {
  const nodes = [{ next: new Map(), fail: 0, outputs: [] }];
  for (const pattern of patterns) {
    const value = String(pattern.value || '').toLowerCase();
    if (!value) continue;
    let state = 0;
    for (let i = 0; i < value.length; i++) {
      const char = value[i];
      if (!nodes[state].next.has(char)) {
        nodes[state].next.set(char, nodes.length);
        nodes.push({ next: new Map(), fail: 0, outputs: [] });
      }
      state = nodes[state].next.get(char);
    }
    nodes[state].outputs.push({ ...pattern, length: value.length });
  }
  const queue = [...nodes[0].next.values()];
  for (let head = 0; head < queue.length; head++) {
    const state = queue[head];
    for (const [char, next] of nodes[state].next) {
      queue.push(next);
      let fallback = nodes[state].fail;
      while (fallback && !nodes[fallback].next.has(char)) fallback = nodes[fallback].fail;
      nodes[next].fail = nodes[fallback].next.get(char) || 0;
      nodes[next].outputs = nodes[next].outputs.concat(nodes[nodes[next].fail].outputs);
    }
  }
  return (input) => {
    const text = String(input || '').toLowerCase();
    const found = new Set();
    let state = 0;
    // Code units keep offsets consistent with JavaScript string indices.
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      while (state && !nodes[state].next.has(char)) state = nodes[state].fail;
      state = nodes[state].next.get(char) || 0;
      const matchedHere = onMatch && nodes[state].outputs.length ? new Set() : null;
      for (const pattern of nodes[state].outputs) {
        const start = i + 1 - pattern.length;
        if (pattern.wiki) {
          if (!/[\]|#\\]/.test(text[i + 1] || '')) continue;
        } else if (pattern.boundary) {
          if (start > 0) {
            const prev = text[start - 1];
            if (prev === '/' || prev === '\\') {
              if (!pattern.allowSlashBoundary) continue;
            } else if (prev === ' ' || prev === '\t') {
              if (!isAllowedWhitespacePrefix(text, start)) continue;
            } else if (!/[\[\(<"':\r\n]/.test(prev)) {
              continue;
            }
          }
          if (i + 1 < text.length && !/[\]\)>"'|#?\\\s]/.test(text[i + 1])) continue;
        }
        found.add(pattern.id);
        // A full path and its basename can end at the same reference.
        if (matchedHere && !matchedHere.has(pattern.id)) { onMatch(pattern.id); matchedHere.add(pattern.id); }
      }
    }
    return found;
  };
}

export function stripRemoteReferenceText(input) {
  return String(input || '')
    .replace(/!?\[[^\]]*\]\(\s*(?:<https?:\/\/[^>]+>|https?:\/\/(?:[^()\s]|\([^()\s]*\))+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/gi, '')
    .replace(/https?:\/\/(?:[^\s)"'\]>]+|\([^\s)"'\]>]*\))+/gi, '');
}

export function createLocalReferenceMatcher(files, isDrawing, onMatch = null) {
  const patterns = [];
  for (const file of files) {
    patterns.push({ value: file.path, id: file.path, boundary: true, allowSlashBoundary: false });
    if (file.name && file.name !== file.path) {
      patterns.push({ value: file.name, id: file.path, boundary: true, allowSlashBoundary: false });
    }
    if (file.extension === 'md' || file.extension === 'excalidraw' || isDrawing(file)) {
      const base = file.basename || getBaseName(file.name);
      patterns.push({ value: `[[${base}`, id: file.path, wiki: true });
      if (file.path.includes('/')) {
        const pathWithoutExt = file.path.replace(/\.(md|excalidraw)$/i, '');
        patterns.push({ value: `[[${pathWithoutExt}`, id: file.path, wiki: true });
      }
    }
  }
  return createTextReferenceMatcher(patterns, onMatch);
}

export function addReference(index, target, source) {
  if (target === source) return;
  if (!index.has(target)) index.set(target, new Set());
  index.get(target).add(source);
}
