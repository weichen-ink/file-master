import { Notice, setIcon } from 'obsidian';
import { openNoteAtLine } from '../plugin/vault-scans.js';
import { referenceIndicator } from './reference-indicator.js';

const previewParents = new WeakMap();
function previewParent(owner) {
  if (!previewParents.has(owner)) {
    let current = null;
    previewParents.set(owner,{
      get hoverPopover() { return current; },
      set hoverPopover(popover) {
        current = popover;
        // The public HoverParent property is assigned when the native popover opens.
        popover?.hoverEl?.addClass('fm-note-hover');
      }
    });
  }
  return previewParents.get(owner);
}

export function noteHoverPreview(plugin, element, path, hoverParent, line = null) {
  element.addEventListener('mouseenter', event => {
    plugin.app.workspace.trigger('hover-link', {
      event, source:'file-master', hoverParent:previewParent(hoverParent), targetEl:element,
      linktext:path, sourcePath:'',
      // Native Page preview uses the same zero-based line state as Search results.
      ...(/\.md$/i.test(path) && Number.isFinite(line) && line > 0 ? {state:{scroll:line-1}} : {}),
    });
  });
}

/** A single document/action layout for reference inspection, rename and link checks. */
export function documentRow(parent,plugin,document,{onOpened=null,renderDetails=null,referenceState='referenceCount',hoverParent={hoverPopover:null},location=null,openLabel=null}={}) {
  const row=parent.createDiv({cls:'fm-list-item fm-document-row'});
  setIcon(row.createSpan({cls:'fm-document-icon',attr:{'aria-hidden':'true'}}),'file-text');
  const content=row.createDiv({cls:'fm-document-content'});
  const heading=location ? content.createDiv({cls:'fm-document-heading'}) : content;
  const name=heading.createDiv({text:document.path,cls:'fm-document-name internal-link',attr:{'data-href':document.path}});
  if(location)heading.createSpan({text:location,cls:'fm-document-location'});
  noteHoverPreview(plugin,name,document.path,hoverParent,document.line);
  if(renderDetails)renderDetails(content);
  const actions=row.createDiv({cls:'fm-document-actions'});
  if(typeof document.references==='number') {
    referenceIndicator(actions.createSpan({cls:`fm-reference-indicator${referenceState==='renameReferencesUpdated'?' is-updated':''}`}),plugin,document.references,{state:referenceState,icon:referenceState==='renameReferencesUpdated'?'check':document.references>0?'link':null});
  }
  const label=openLabel || plugin.t('btnOpenNote');
  const open=actions.createEl('button',{cls:'fm-document-open',attr:{type:'button','aria-label':label}});
  setIcon(open.createSpan({cls:'fm-indicator-icon',attr:{'aria-hidden':'true'}}),'arrow-up-right');
  open.createSpan({text:label});
  noteHoverPreview(plugin,open,document.path,hoverParent,document.line);
  open.onclick=async()=>{
    if(open.disabled)return;
    open.disabled=true;
    try {if(await openNoteAtLine(plugin,document.path,document.line))onOpened?.();}
    catch(error){new Notice(error.message || String(error));}
    finally {open.disabled=false;}
  };
  return {row,content,actions,open};
}
