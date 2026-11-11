import { insertMarkdownToActiveEditor } from './plugin/lifecycle.js';
import { IMAGE_EXTS } from './constants.js';
import { formatBytes, getExt, getFileTypeGroup } from './engine.js';
import { ImageLightboxModal } from './modals/dialogs.js';
import { assetUrl, assetMarkdown, hasOptimizedVariant, copyText } from './ui/links.js';
import { openModal } from './ui/navigation.js';
import { isInsertionTargetValid } from './plugin/editor-target.js';
import { Notice, setIcon } from 'obsidian';

export const REMOTE_GALLERY_PAGE_SIZE = 60;

export function filterRemoteGallery(view) {
  const filtered = view.items.filter((item) => {
    if (view.selectedBucket !== 'all' && `${item.year}/${item.month}` !== view.selectedBucket) return false;
    if (view.selectedType !== 'all' && getFileTypeGroup(getExt(item.name || item.filename)) !== view.selectedType) return false;
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
    if (sort === 'hits_desc') {
      return ((b.hits || 0) - (a.hits || 0)) || ((b.createdAt || 0) - (a.createdAt || 0));
    }
    if (sort === 'time_asc') return (a.createdAt || 0) - (b.createdAt || 0);
    return (b.createdAt || 0) - (a.createdAt || 0);
  });

  return filtered;
}

export function getRemoteGalleryPage(view, filtered) {
  const key = `${view.selectedBucket}:${view.selectedType}:${view.selectedSort || 'time_desc'}:${view.searchQuery}`;
  if (key !== view.galleryFilterKey) { view.galleryPage = 0; view.galleryFilterKey = key; }
  const totalPages = Math.max(1, Math.ceil(filtered.length / REMOTE_GALLERY_PAGE_SIZE));
  view.galleryPage = Math.min(Math.max(0, view.galleryPage || 0), totalPages - 1);
  return { current: view.galleryPage, totalPages,
    items: filtered.slice(view.galleryPage * REMOTE_GALLERY_PAGE_SIZE, (view.galleryPage + 1) * REMOTE_GALLERY_PAGE_SIZE) };
}

export function renderRemoteGallery(view, containerEl, countLabel) {
  containerEl.empty();
  if (view.layoutMode === 'list') {
    containerEl.addClass('is-list');
  } else {
    containerEl.removeClass('is-list');
  }

  const filtered = view.filterItems();
  const totalBytes = filtered.reduce((s, i) => s + (i.size || 0), 0);

  if (countLabel) {
    countLabel.empty();
    countLabel.createSpan({ cls: 'fm-gallery-stats-count', text: view.t('galleryFileCount', { count: filtered.length }) });
    countLabel.createSpan({ cls: 'fm-gallery-stats-size', text: view.t('galleryTotalSize', { size: formatBytes(totalBytes) }) });
  }

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
    const card = containerEl.createDiv({ cls: 'fm-gallery-card' + (view.layoutMode === 'list' ? ' is-list' : '') });
    const thumbWrap = card.createDiv({ cls: 'fm-gallery-thumb-wrap' });

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
        setIcon(thumbWrap.createSpan(), 'image-off');
      };
    } else {
      thumbWrap.createDiv({
        text: ext.toUpperCase(),
        attr: { style: 'font-size: 14px; font-weight: 700; color: var(--text-muted);' }
      });
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

    const info = card.createDiv({ cls: 'fm-gallery-info' });
    const nameButton=info.createEl('button',{
      cls: 'fm-gallery-name',
      text: item.name || item.filename,
      attr: { type:'button', 'aria-label': item.name || item.filename }
    });
    nameButton.onclick=openPreview;

    const meta = info.createDiv({ cls: 'fm-gallery-meta' });
    meta.createSpan({ text: formatBytes(item.size) });

    const actions = info.createDiv({ cls: 'fm-gallery-actions' });

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
    previous.onclick = () => { view.galleryPage--; view.store ? view.store.emit() : view.renderGrid(containerEl, countLabel); };
    pager.createSpan({ text: view.t('pageCount', { current: page.current + 1, total: page.totalPages }) });
    const next = pager.createEl('button', { text: view.t('pageNext') });
    next.disabled = page.current + 1 === page.totalPages;
    next.onclick = () => { view.galleryPage++; view.store ? view.store.emit() : view.renderGrid(containerEl, countLabel); };
  }
}
