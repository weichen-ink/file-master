import { insertMarkdownToActiveEditor } from './plugin/lifecycle.js';
import { IMAGE_EXTS } from './constants.js';
import { getExt, getFileTypeGroup } from './engine.js';
import { ImageLightboxModal } from './modals/dialogs.js';
import { assetUrl, assetMarkdown, hasOptimizedVariant, copyText } from './ui/links.js';
import { openModal } from './ui/navigation.js';
import { isInsertionTargetValid } from './plugin/editor-target.js';
import { Notice, setIcon } from 'obsidian';
import { fileActionRow, fileSizeBadge } from './ui/file-action-list.js';

export const REMOTE_GALLERY_PAGE_SIZE = 60;

export function filterRemoteGallery(view) {
  const filtered = view.items.filter((item) => {
    if (view.selectedBuckets?.length && !view.selectedBuckets.includes(`${item.year}/${item.month}`)) return false;
    if (view.selectedTypes?.length && !view.selectedTypes.includes(getFileTypeGroup(getExt(item.name || item.filename)))) return false;
    return !view.searchQuery || (item.name || item.filename || '').toLowerCase().includes(view.searchQuery);
  });

  const sort = view.selectedSort || 'time_desc';
  filtered.sort((a, b) => {
    if (sort === 'size_desc') return (b.size || 0) - (a.size || 0);
    if (sort === 'size_asc') return (a.size || 0) - (b.size || 0);
    if (sort === 'name_asc') {
      const na = a.name || a.filename || '';
      const nb = b.name || b.filename || '';
      return na.localeCompare(nb, undefined, { numeric: true, sensitivity: 'base' });
    }
    if (sort === 'name_desc') {
      const na = a.name || a.filename || '';
      const nb = b.name || b.filename || '';
      return nb.localeCompare(na, undefined, { numeric: true, sensitivity: 'base' });
    }
    if (sort === 'hits_desc' || sort === 'hits_asc') {
      const difference=(a.hits || 0)-(b.hits || 0);
      return (sort === 'hits_asc' ? difference : -difference) || ((b.createdAt || 0) - (a.createdAt || 0));
    }
    if (sort === 'time_asc') return (a.createdAt || 0) - (b.createdAt || 0);
    return (b.createdAt || 0) - (a.createdAt || 0);
  });

  return filtered;
}

export function getRemoteGalleryPage(view, filtered) {
  const key = JSON.stringify([view.selectedBuckets || [],view.selectedTypes || [],view.selectedSort || 'time_desc',view.searchQuery]);
  if (key !== view.galleryFilterKey) { view.galleryPage = 0; view.galleryFilterKey = key; }
  const totalPages = Math.max(1, Math.ceil(filtered.length / REMOTE_GALLERY_PAGE_SIZE));
  view.galleryPage = Math.min(Math.max(0, view.galleryPage || 0), totalPages - 1);
  return { current: view.galleryPage, totalPages,
    items: filtered.slice(view.galleryPage * REMOTE_GALLERY_PAGE_SIZE, (view.galleryPage + 1) * REMOTE_GALLERY_PAGE_SIZE) };
}

export function renderRemoteGallery(view, containerEl) {
  containerEl.empty();
  if (view.layoutMode === 'list') {
    containerEl.addClass('is-list');
  } else {
    containerEl.removeClass('is-list');
  }

  const filtered = view.filterItems();

  if (filtered.length === 0) {
    containerEl.createDiv({
      cls: 'fm-section-box',
      text: view.t('galleryEmpty'),
      attr: { style: 'grid-column: 1 / -1; text-align: center; padding: 30px 10px; color: var(--text-muted); font-size:12px;' }
    });
    return;
  }

  const page = getRemoteGalleryPage(view, filtered);
  for (const item of page.items) {
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

  if (page.totalPages > 1) {
    const pager = containerEl.createDiv({ cls: 'fm-gallery-pagination' });
    const previous = pager.createEl('button', { text: view.t('pagePrevious') });
    previous.disabled = page.current === 0;
    previous.onclick = () => { view.galleryPage--; view.store ? view.store.emit() : view.renderGrid(containerEl); };
    pager.createSpan({ text: view.t('pageCount', { current: page.current + 1, total: page.totalPages }) });
    const next = pager.createEl('button', { text: view.t('pageNext') });
    next.disabled = page.current + 1 === page.totalPages;
    next.onclick = () => { view.galleryPage++; view.store ? view.store.emit() : view.renderGrid(containerEl); };
  }
}
