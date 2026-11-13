import { MarkdownView } from 'obsidian';

function captureEditorRange(editor, evt) {
  if (!editor) return null;
  if (evt && typeof evt.clientX === 'number' && typeof evt.clientY === 'number') {
    try {
      if (typeof editor.posAtCoords === 'function') {
        const pos = editor.posAtCoords(evt.clientX, evt.clientY);
        if (pos && typeof pos.line === 'number' && typeof pos.ch === 'number') {
          return { from: { ...pos }, to: { ...pos } };
        }
      }
      if (editor.cm && typeof editor.cm.posAtCoords === 'function' && typeof editor.offsetToPos === 'function') {
        const offset = editor.cm.posAtCoords({ x: evt.clientX, y: evt.clientY });
        if (typeof offset === 'number' && offset >= 0) {
          const pos = editor.offsetToPos(offset);
          if (pos && typeof pos.line === 'number' && typeof pos.ch === 'number') {
            return { from: { ...pos }, to: { ...pos } };
          }
        }
      }
    } catch { }
  }
  const from = editor.getCursor?.('from');
  const to = editor.getCursor?.('to') || from;
  if (from && typeof from.line === 'number' && typeof from.ch === 'number') {
    return { from: { ...from }, to: { ...to } };
  }
  return null;
}

export function captureInsertionTarget(plugin) {
  const target = captureEditorTarget(plugin);
  return target.view && target.file && target.editor ? target : null;
}

export function captureEditorTarget(plugin, { editor = null, evt = null, info = null } = {}) {
  const leaves = plugin?.app?.workspace?.getLeavesOfType?.('markdown') || [];
  let view = null;
  if (editor) {
    view = leaves.find(leaf => leaf.view?.editor === editor)?.view || null;
  }
  if (!view && info && leaves.some(leaf => leaf.view === info) && (!info.editor || !editor || info.editor === editor)) {
    view = info;
  }
  if (!view && !editor) {
    view = plugin?.app?.workspace?.getActiveViewOfType?.(MarkdownView) || null;
    if (!view && leaves.some(leaf => leaf.view === plugin.lastActiveMarkdownView)) view = plugin.lastActiveMarkdownView;
  }

  const file = view?.file?.extension === 'md' ? view.file : null;

  const boundEditor = view?.editor || editor || null;
  const range = captureEditorRange(boundEditor, evt);
  return {
    view,
    file,
    editor: boundEditor,
    from: range?.from || null,
    to: range?.to || null,
    content: typeof boundEditor?.getValue === 'function' ? boundEditor.getValue() : undefined
  };
}

export function isInsertionTargetValid(plugin, target) {
  if (!target?.view || !target.file || !target.editor) return false;
  const leaves = plugin.app.workspace.getLeavesOfType?.('markdown') || [];
  if (!leaves.some(leaf => leaf.view === target.view)) return false;
  if (target.view.file !== target.file) return false;
  if (target.view.editor !== target.editor) return false;
  return plugin.app.vault.getAbstractFileByPath(target.file.path) === target.file;
}

export function refreshInsertionTarget(target) {
  const ed = target?.view?.editor || target?.editor;
  if (!ed) return;
  target.from = ed.getCursor?.('from');
  target.to = ed.getCursor?.('to');
  target.content = ed.getValue?.();
}

export function insertLinkAtTarget(plugin, linkText, insertionTarget, { appendNewlineOnEmptyLine = true } = {}) {
  if (!isInsertionTargetValid(plugin, insertionTarget)) {
    return { inserted: false, reason: plugin?.t?.('galleryOpenNoteFirst') || 'Target note is no longer active' };
  }
  const targetEditor = insertionTarget.editor;
  if (insertionTarget.content !== undefined && typeof targetEditor.getValue === 'function' && insertionTarget.content !== targetEditor.getValue()) {
    return { inserted: false, reason: plugin?.t?.('galleryTargetChanged') || 'Note content changed before insertion' };
  }

  const from = insertionTarget.from || targetEditor.getCursor?.('from');
  const to = insertionTarget.to || targetEditor.getCursor?.('to') || from;
  const lineText = from && typeof targetEditor.getLine === 'function' ? targetEditor.getLine(from.line) : '';
  const isTableOrInline = typeof lineText === 'string' && (lineText.trimStart().startsWith('|') || lineText.trim().length > 0);
  const snippet = appendNewlineOnEmptyLine && !isTableOrInline ? `${linkText}\n` : linkText;

  if (from && to && typeof targetEditor.replaceRange === 'function') {
    targetEditor.replaceRange(snippet, from, to);
    const lines = snippet.split('\n');
    const nextCursor = {
      line: from.line + lines.length - 1,
      ch: lines.length === 1 ? from.ch + lines[0].length : lines[lines.length - 1].length
    };
    targetEditor.setCursor?.(nextCursor);
    refreshInsertionTarget(insertionTarget);
  } else {
    targetEditor.replaceSelection?.(snippet);
    refreshInsertionTarget(insertionTarget);
  }
  targetEditor.focus?.();
  return { inserted: true };
}
