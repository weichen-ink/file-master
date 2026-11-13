import { setIcon } from 'obsidian';
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

function previewButton(parent, plugin, path, hoverParent, line = null, label = null) {
  const text = label || plugin.t('btnPreview');
  const btn = parent.createEl('button', { cls: 'fm-document-preview', attr: { type: 'button', 'aria-label': text } });
  setIcon(btn.createSpan({ cls: 'fm-indicator-icon', attr: { 'aria-hidden': 'true' } }), 'eye');
  btn.createSpan({ text });
  noteHoverPreview(plugin, btn, path, hoverParent, line);
  return btn;
}

/** Unified Level-1 note + Level-2 link preview layout for rename, reference inspection, and health checks. */
export function documentRow(parent,plugin,document,{renderDetails=null,referenceState='referenceCount',hoverParent={hoverPopover:null},location=null,previewLabel=null}={}) {
  const row=parent.createDiv({cls:'fm-list-item fm-document-row'});
  const header=row.createDiv({cls:'fm-document-header'});
  setIcon(header.createSpan({cls:'fm-document-icon',attr:{'aria-hidden':'true'}}),'file-text');
  const content=header.createDiv({cls:'fm-document-content'});
  const heading=location ? content.createDiv({cls:'fm-document-heading'}) : content;
  const name=heading.createDiv({text:document.path,cls:'fm-document-name internal-link',attr:{'data-href':document.path}});
  if(location)heading.createSpan({text:location,cls:'fm-document-location'});
  noteHoverPreview(plugin,name,document.path,hoverParent,document.line);
  if(renderDetails)renderDetails(content);
  const actions=header.createDiv({cls:'fm-document-actions'});
  if(typeof document.references==='number') {
    referenceIndicator(actions.createSpan({cls:`fm-reference-indicator${referenceState==='renameReferencesUpdated'?' is-updated':''}`}),plugin,document.references,{state:referenceState,icon:referenceState==='renameReferencesUpdated'?'check':document.references>0?'link':null});
  }
  const hasLinks=Array.isArray(document.links)&&document.links.length>0;
  let preview=hasLinks ? null : previewButton(actions,plugin,document.path,hoverParent,document.line,previewLabel);
  let linksEl=null;
  if(hasLinks) {
    linksEl=row.createDiv({cls:'fm-document-links'});
    for(const link of document.links) {
      const linkRow=linksEl.createDiv({cls:'fm-document-link-row'});
      const info=linkRow.createDiv({cls:'fm-document-link-info'});
      if(link.tag)info.createSpan({text:link.tag,cls:'fm-health-issue-label'});
      if(Number.isFinite(link.line)&&link.line>0)info.createSpan({text:plugin.t('healthLine',{line:link.line}),cls:'fm-document-location'});
      if(link.target)info.createEl('code',{text:link.target,cls:'fm-document-link-target'});
      if(link.status)info.createSpan({text:link.status,cls:'fm-document-location'});
      const btn=previewButton(linkRow,plugin,document.path,hoverParent,link.line??document.line,previewLabel);
      if(!preview)preview=btn;
    }
  }
  return {row,header,content,actions,preview,linksEl};
}
