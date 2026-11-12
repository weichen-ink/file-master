import { getBaseName } from './engine.js';

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
          if (!/[\]|#]/.test(text[i + 1] || '')) continue;
        } else if (pattern.boundary) {
          if (start > 0 && !/[\[\(<"':/\\\s]/.test(text[start - 1])) continue;
          if (i + 1 < text.length && !/[\]\)>"'|#?\s]/.test(text[i + 1])) continue;
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
    .replace(/!?\[[^\]]*\]\(https?:\/\/[^)]+\)/gi, '')
    .replace(/https?:\/\/[^\s)"'\]>]+/gi, '');
}

export function createLocalReferenceMatcher(files, isDrawing, onMatch = null) {
  const patterns = [];
  for (const file of files) {
    for (const value of new Set([file.path, file.name])) {
      patterns.push({ value, id: file.path, boundary: true });
    }
    if (file.extension === 'md' || file.extension === 'excalidraw' || isDrawing(file)) {
      patterns.push({ value: `[[${file.basename || getBaseName(file.name)}`, id: file.path, wiki: true });
    }
  }
  return createTextReferenceMatcher(patterns, onMatch);
}

export function addReference(index, target, source) {
  if (target === source) return;
  if (!index.has(target)) index.set(target, new Set());
  index.get(target).add(source);
}
