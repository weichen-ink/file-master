import { queryRemoteFiles } from './remote-file-query.js';
import { insertMarkdownToActiveEditor } from './plugin/lifecycle.js';
import { IMAGE_EXTS } from './constants.js';
import { getExt } from './engine.js';
import { ImageLightboxModal } from './modals/dialogs.js';
import { assetUrl, assetMarkdown, hasOptimizedVariant, copyText } from './ui/links.js';
import { openModal } from './ui/navigation.js';
import { isInsertionTargetValid } from './plugin/editor-target.js';
import { Notice, setIcon } from 'obsidian';
import { fileActionRow, fileSizeBadge } from './ui/file-action-list.js';

export function filterRemoteGallery(view) {
  return queryRemoteFiles(view.items, {
    buckets: view.selectedBuckets,
    types: view.selectedTypes,
    q: view.searchQuery,
    sort: view.selectedSort
  });
}

export function renderRemoteGallery(view, containerEl) {
  containerEl.empty();
  if (view.layoutMode === 'list') {
    containerEl.addClass('is-list');
  } else {
    containerEl.removeClass('is-list');
  }

  const filtered = view.serverPaged ? view.items : view.filterItems();

  if (filtered.length === 0) {
    containerEl.createDiv({
      cls: 'fm-section-box',
      text: view.t('galleryEmpty'),
      attr: { style: 'grid-column: 1 / -1; text-align: center; padding: 30px 10px; color: var(--text-muted); font-size:12px;' }
    });
    return;
  }

  for (const item of filtered) {
    let card,thumbWrap,nameButton,actions;
    const filename=item.name || item.filename;
    const createName=parent=>parent.createEl('button',{cls:'fm-gallery-name',text:filename,attr:{type:'button','aria-label':filename}});
    if(view.layoutMode==='list') {
      const slots=fileActionRow(containerEl,{name:filename,size:item.size},view.plugin,{
        renderPreview:parent=>{thumbWrap=parent.createDiv({cls:'fm-gallery-thumb-wrap'});},
        renderName:parent=>{parent.addClass('fm-gallery-details');nameButton=createName(parent);fileSizeBadge(parent,item.size);}
      });
      card=slots.row;card.addClass('fm-gallery-list-row');actions=slots.actions;
    } else {
      card=containerEl.createDiv({cls:'fm-gallery-card'});
      thumbWrap=card.createDiv({cls:'fm-gallery-thumb-wrap'});
    }

    const ext = getExt(item.name || item.filename);
    const isImg = IMAGE_EXTS.has(ext);

    if (isImg) {
      const img = thumbWrap.createEl('img', {
        cls: 'fm-gallery-thumb',
        attr: {
          loading: 'lazy',
          src: item.thumbnailUrl || item.rawUrl,
          alt: item.name || item.filename
        }
      });
      img.onerror = () => {
        img.style.display = 'none';
        thumbWrap.addClass('fm-gallery-placeholder');
        setIcon(thumbWrap.createSpan(), 'image-off');
      };
    } else {
      thumbWrap.addClass('fm-gallery-placeholder');
      thumbWrap.createSpan({text: ext.toUpperCase()});
    }

    // Protection is changed in the preview, never accidentally on a thumbnail.
    if (item.locked) {
      const lockBadge = thumbWrap.createSpan({
        cls: 'fm-gallery-lock-badge',
        attr: { 'aria-label':view.t('previewProtected') }
      });
      setIcon(lockBadge,'lock');
    }

    const openPreview = () => {
      openModal(new ImageLightboxModal(view.app, view.plugin, {
        source: 'remote',
        name: item.name || item.filename,
        displayPath: `${item.year}/${item.month}/${item.filename}`,
        size: item.size,
        rawObj: item
      }, (action, target) => {
        if (action === 'deleted') {
          view.items = view.items.filter((i) => !(i.year === target.year && i.month === target.month && i.filename === target.filename));
        }
        view.store?.emit();
      }, {insertMode:view.insertMode, insertionTarget:view.insertionTarget})).catch(error=>new Notice(error.message));
    };
    thumbWrap.onclick = openPreview;
    thumbWrap.setAttribute('role', 'button');
    thumbWrap.setAttribute('tabindex', '0');
    thumbWrap.setAttribute('aria-label', view.t('galleryBtnPreview'));
    thumbWrap.onkeydown = (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        thumbWrap.click();
      }
    };

    if(view.layoutMode!=='list') {
      const info=card.createDiv({cls:'fm-gallery-info'});
      const details=info.createDiv({cls:'fm-gallery-details'});
      nameButton=createName(details);
      fileSizeBadge(details,item.size);
      actions=info.createDiv();
    }
    nameButton.onclick=openPreview;
    actions.addClass('fm-gallery-actions');

    // Clean single action: 📝 插入笔记
    const isWebpMode = view.insertMode === 'webp' && hasOptimizedVariant(item);
    const insertTargetUrl = assetUrl(item,view.insertMode);
    const fn = item.name || item.filename;

    const insertBtn = actions.createEl('button', {
      cls: 'fm-icon-button fm-gallery-insert-btn',
      attr: { type:'button', 'data-insert-action':'true' }
    });
    setIcon(insertBtn.createSpan(), 'file-input');
    insertBtn.setAttribute('aria-label', view.t(isWebpMode?'galleryInsertWebp':'galleryInsertRaw'));
    insertBtn.disabled=!isInsertionTargetValid(view.plugin,view.insertionTarget);
    insertBtn.onmousedown = (e) => {
      // Prevent clicking button from blurring or moving cursor in Markdown editor
      e.preventDefault();
    };
    insertBtn.onclick = () => {
      const mdSnippet = assetMarkdown(fn,insertTargetUrl)+"\n";
      const noticeMsg = isWebpMode ? view.t('galleryInsertedWebp') : view.t('galleryInsertedRaw');
      if (view.plugin) insertMarkdownToActiveEditor(view.plugin, mdSnippet, noticeMsg, view.insertionTarget);
    };
    const copyBtn=actions.createEl('button',{cls:'fm-icon-button',attr:{type:'button','aria-label':view.t('previewCopyUrl')}});
    setIcon(copyBtn,'copy');copyBtn.onclick=()=>copyText(view.plugin,insertTargetUrl);
  }

}
