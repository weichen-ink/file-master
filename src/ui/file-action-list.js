import { setIcon } from 'obsidian';
import { AUDIO_EXTS, IMAGE_EXTS } from '../constants.js';
import { formatBytes, getExt } from '../engine.js';
import { translateUi } from '../i18n.js';
import { fileReferenceDocuments } from '../plugin/file-references.js';
import { requireModal } from '../plugin/modal-registry.js';
import { getItemPreviewUrl } from '../plugin/vault-utils.js';
import { referenceIndicator } from './reference-indicator.js';

/**
 * Renders a 44x44 thumbnail or icon in wizard lists (click to inspect)
 */
export function renderItemVisualThumb(parentEl, item, plugin) {
  const t = (k, p) => (plugin ? plugin.t(k, p) : translateUi('auto', k, p));
  const ext = getExt(item.name);
  if (IMAGE_EXTS.has(ext)) {
    const img = parentEl.createEl('img', {
      cls: 'fm-item-thumb',
      attr: { 'aria-label': t('thumbEnlargeTooltip') }
    });
    img.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const ImageLightboxModal = requireModal('ImageLightboxModal');
      new ImageLightboxModal(plugin.app, plugin, item).open();
    };
    getItemPreviewUrl(plugin, item).then((url) => {
      if (url) img.src = url;
    });
  } else {
    const box = parentEl.createDiv({
      cls: 'fm-item-icon-box',
      attr: { 'aria-label': t('thumbDetailsTooltip') }
    });
    const icon =
      ext === 'md'
        ? '📝'
        : AUDIO_EXTS.has(ext)
          ? '🎵'
          : ['mp4', 'webm', 'mov', 'mkv'].includes(ext)
            ? '🎬'
            : ext === 'pdf'
              ? '📄'
              : '📦';
    box.createSpan({ text: icon });
    box.createSpan({ text: (ext || 'FILE').slice(0, 4).toUpperCase(), cls: 'fm-item-icon-ext' });
    box.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const ImageLightboxModal = requireModal('ImageLightboxModal');
      new ImageLightboxModal(plugin.app, plugin, item).open();
    };
  }
}

export function fileSizeBadge(parent,size) {
  if(typeof size==='number')return parent.createSpan({text:formatBytes(size),cls:'fm-file-size'});
}

export function fileMetaItem(parent, iconName, text, { cls = '', title = '' } = {}) {
  const item = parent.createSpan({
    cls: cls ? `fm-meta-item ${cls}` : 'fm-meta-item',
    ...(title ? { attr: { title } } : {})
  });
  if (iconName) {
    const iconEl = item.createSpan({ cls: 'fm-meta-icon', attr: { 'aria-hidden': 'true' } });
    setIcon(iconEl, iconName);
  }
  item.createSpan({ text: String(text) });
  return item;
}

/** Only a distinct directory adds location; the filename is never repeated below itself. */
export function fileMetadata(parent,item,{path=null}={}) {
  parent.addClass('fm-file-row-meta');
  const directory=path?.includes('/') ? path.slice(0,path.lastIndexOf('/')) : '';
  if(directory) fileMetaItem(parent, 'folder', directory, { cls: 'fm-file-location' });
}

/** Shared file row for attachment wizards: selection, preview, name, details, actions. */
export function fileActionRow(parent, item, plugin, {selection = null, renderName = null, metadata = null, renderPreview = null} = {}) {
  const row = parent.createDiv({cls:`fm-list-item fm-file-row${selection ? ' has-selection' : ''}`});
  if (selection) selection(row.createDiv({cls:'fm-file-row-selection'}));
  const preview=row.createDiv({cls:'fm-file-row-preview'});
  if(renderPreview)renderPreview(preview);else renderItemVisualThumb(preview, item, plugin);
  const content = row.createDiv({cls:'fm-file-row-content'});
  const name = content.createDiv({cls:'fm-file-row-name'});
  if (renderName) renderName(name);
  else {
    name.createSpan({text:item.name || item.filename || item.displayPath,cls:'fm-file-row-name-text'});
    fileSizeBadge(name,item.size);
  }
  const meta = content.createDiv({cls:'fm-file-row-meta'});
  if(metadata)metadata(meta);else fileMetadata(meta,item);
  const actions = row.createDiv({cls:'fm-file-row-actions'});
  return {row,content,name,meta,actions};
}

/** Distinct note count and note inspection always use the same control. */
export function fileReferenceButton(parent, item, plugin, paths = null, onJump = null, {otherNotes=false}={}) {
  const button = parent.createEl('button',{cls:'fm-file-ref-button',attr:{type:'button','aria-label':plugin.t('migrateInspectRefs')}});
  let revision = 0, lastPaths;
  const update = async (notes, unavailable = false) => {
    const unique=notes ? [...new Set(notes.map(note => typeof note === 'string' ? note : note.path))] : null;
    const signature=unique && JSON.stringify(notes);
    if (signature && signature===lastPaths) return;
    lastPaths=signature;
    const current=++revision;
    let documents=unique?.map(path=>({path}));
    const render=(count,state)=>referenceIndicator(button,plugin,count,{state:state || (otherNotes?'referenceOtherCount':'referenceCount')});
    render(0,unique?.length ? 'renameCounting' : unique ? null : unavailable?'renameCountUnavailable':'renameCounting');
    button.disabled = !unique?.length;
    button.onclick = unique?.length ? event => {
      event.preventDefault();event.stopPropagation();
      const NoteRefsModal = requireModal('NoteRefsModal');
      new NoteRefsModal(plugin.app,item.name,documents,onJump,plugin).open();
    } : null;
    if (!unique?.length) return;
    try {
      const refs = notes.every(note=>typeof note==='object'&&typeof note.references==='number') ? notes : await fileReferenceDocuments(plugin,item,unique);
      if (current!==revision) return;
      documents=refs;
      button.disabled=!refs.length;
      render(refs.reduce((sum,doc)=>sum+doc.references,0));
    } catch {
      if (current===revision) render(0,'renameCountUnavailable');
    }
  };
  update(paths);
  return {button,update};
}
