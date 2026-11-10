import { getItemPreviewUrl } from '../plugin/vault-utils.js';
import { insertMarkdownToActiveEditor } from '../plugin/lifecycle.js';
import { IMAGE_EXTS } from '../constants.js';
import { formatBytes, getExt } from '../engine.js';
import { translateUi } from '../i18n.js';
import { Modal, Notice, setIcon } from 'obsidian';

/**
 * Confirmation modal for critical actions like remote file deletion
 */
export class ConfirmActionModal extends Modal {
  constructor(app, title, message, confirmText = 'Confirm', onConfirm, plugin = null) {
    super(app);
    this.title = title;
    this.message = message;
    this.confirmText = confirmText;
    this.onConfirm = onConfirm;
    this.plugin = plugin;
    this.resolved = false;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('fm-wizard-modal');
    contentEl.createEl('h3', { text: this.title });
    const p = contentEl.createEl('p', { text: this.message });
    p.style.lineHeight = '1.6';
    p.style.margin = '12px 0 18px';

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const cancelLabel = this.plugin ? this.plugin.t('btnCancel') : translateUi('auto', 'btnCancel');
    const cancelBtn = btnRow.createEl('button', { text: cancelLabel });
    cancelBtn.onclick = () => {
      this.resolved = true;
      this.close();
      this.onConfirm(false);
    };

    const okBtn = btnRow.createEl('button', { text: this.confirmText, cls: 'mod-warning' });
    okBtn.onclick = () => {
      this.resolved = true;
      this.close();
      this.onConfirm(true);
    };
  }

  onClose() {
    if (!this.resolved && this.onConfirm) {
      this.onConfirm(false);
    }
    this.contentEl.empty();
  }
}

/**
 * High-res lightbox modal for asset inspection
 */
export class ImageLightboxModal extends Modal {
  constructor(app, plugin, item, onActionChanged = null) {
    super(app);
    this.plugin = plugin;
    this.item = item;
    this.onActionChanged = onActionChanged;
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('fm-wizard-modal');
    contentEl.addClass('fm-lightbox-modal');
    this.modalEl.addClass('fm-lightbox-dialog');
    const t = (k, p) => (this.plugin ? this.plugin.t(k, p) : translateUi('auto', k, p));

    const header = contentEl.createDiv({ cls: 'fm-lightbox-header' });
    header.createDiv({ cls: 'fm-lightbox-eyebrow', text: t('previewTitleLabel') });
    header.createEl('h3', { text: this.item.name });

    const srcLabel = this.item.source === 'local' ? t('previewSourceLocal') : t('previewSourceRemote');
    const meta = header.createDiv({ cls: 'fm-lightbox-meta' });
    meta.createSpan({ cls: 'fm-lightbox-source', text: srcLabel });
    const details = meta.createDiv({ cls: 'fm-lightbox-details' });
    const pathDetail = details.createDiv({ cls: 'fm-lightbox-detail' });
    pathDetail.createSpan({ cls: 'fm-lightbox-detail-label', text: t('previewPathLabel') });
    pathDetail.createSpan({ cls: 'fm-lightbox-detail-value', text: this.item.displayPath });
    const sizeDetail = details.createDiv({ cls: 'fm-lightbox-detail' });
    sizeDetail.createSpan({ cls: 'fm-lightbox-detail-label', text: t('previewSizeLabel') });
    sizeDetail.createSpan({ cls: 'fm-lightbox-detail-value', text: formatBytes(this.item.size) });

    const ext = getExt(this.item.name);
    const isImg = IMAGE_EXTS.has(ext);
    if (isImg) {
      const img = contentEl.createEl('img', { cls: 'fm-lightbox-img' });
      const url = await getItemPreviewUrl(this.plugin, this.item);
      if (url) img.src = url;
    } else {
      contentEl.createDiv({
        cls: 'fm-section-box',
        text: t('previewNonImageTip', { ext: ext.toUpperCase() }),
        attr: { style: 'text-align: center; padding: 30px 16px;' }
      });
    }

    // Detailed link copy tracks (Raw & WebP)
    if (this.item.source === 'remote' && this.item.rawObj) {
      const remote = this.item.rawObj;
      const fn = this.item.name || remote.filename;

      const tracksBox = contentEl.createDiv({ cls: 'fm-lightbox-tracks' });
      tracksBox.createDiv({ cls: 'fm-lightbox-section-label', text: t('previewLinksTitle') });

      // Track 1: 原图
      const rawRow = tracksBox.createDiv({ cls: 'fm-lightbox-track-row' });
      rawRow.createSpan({ text: t('galleryTrackRaw'), cls: 'fm-lightbox-track-name' });
      const rawMdBtn = rawRow.createEl('button', { text: t('previewCopyMarkdown'), cls: 'fm-lightbox-copy-btn' });
      rawMdBtn.onclick = async () => {
        const mdSnippet = isImg ? `![${fn}](${remote.rawUrl})` : `[${fn}](${remote.rawUrl})`;
        await navigator.clipboard.writeText(mdSnippet);
        rawMdBtn.setText(t('galleryCopied'));
        setTimeout(() => { if (rawMdBtn.isConnected) rawMdBtn.setText(t('previewCopyMarkdown')); }, 1500);
      };
      const rawUrlBtn = rawRow.createEl('button', { text: t('previewCopyUrl'), cls: 'fm-lightbox-copy-btn' });
      rawUrlBtn.onclick = async () => {
        await navigator.clipboard.writeText(remote.rawUrl);
        rawUrlBtn.setText(t('galleryCopied'));
        setTimeout(() => { if (rawUrlBtn.isConnected) rawUrlBtn.setText(t('previewCopyUrl')); }, 1500);
      };

      // Track 2: WebP 优化图 (若存在)
      if (remote.pubUrl) {
        const optRow = tracksBox.createDiv({ cls: 'fm-lightbox-track-row' });
        optRow.createSpan({ text: t('galleryTrackWebp'), cls: 'fm-lightbox-track-name' });
        const optMdBtn = optRow.createEl('button', { text: t('previewCopyMarkdown'), cls: 'fm-lightbox-copy-btn' });
        optMdBtn.onclick = async () => {
          const mdSnippet = isImg ? `![${fn}](${remote.pubUrl})` : `[${fn}](${remote.pubUrl})`;
          await navigator.clipboard.writeText(mdSnippet);
          optMdBtn.setText(t('galleryCopied'));
          setTimeout(() => { if (optMdBtn.isConnected) optMdBtn.setText(t('previewCopyMarkdown')); }, 1500);
        };
        const optUrlBtn = optRow.createEl('button', { text: t('previewCopyUrl'), cls: 'fm-lightbox-copy-btn' });
        optUrlBtn.onclick = async () => {
          await navigator.clipboard.writeText(remote.pubUrl);
          optUrlBtn.setText(t('galleryCopied'));
          setTimeout(() => { if (optUrlBtn.isConnected) optUrlBtn.setText(t('previewCopyUrl')); }, 1500);
        };
      }
    }

    const btnRow = contentEl.createDiv({ cls: 'fm-lightbox-actions' });
    const leftActions = btnRow.createDiv({ cls: 'fm-lightbox-primary-actions' });
    const rightActions = btnRow.createDiv({ cls: 'fm-lightbox-management-actions' });

    if (this.item.source === 'local' && this.item.rawObj) {
      const openBtn = leftActions.createEl('button', { cls: 'mod-cta' });
      setIcon(openBtn.createSpan(), 'external-link');
      openBtn.createSpan({ text: t('btnOpenInObsidian') });
      openBtn.onclick = async () => {
        const leaf = this.app.workspace.getLeaf(false);
        if (leaf) await leaf.openFile(this.item.rawObj);
        this.close();
      };
    } else if (this.item.source === 'remote' && this.item.rawObj) {
      const remote = this.item.rawObj;
      const fn = this.item.name || remote.filename;

      // 1. 一键插入笔记
      const insertBtn = leftActions.createEl('button', { cls: 'mod-cta' });
      setIcon(insertBtn.createSpan(), 'file-input');
      insertBtn.createSpan({ text: t('previewInsert') });
      insertBtn.onmousedown = (e) => {
        e.preventDefault();
      };
      insertBtn.onclick = () => {
        const targetUrl = (this.plugin?.settings?.insertOptimizedLinkOnUpload && remote.pubUrl) ? remote.pubUrl : (remote.rawUrl || remote.pubUrl);
        const mdSnippet = isImg ? `![${fn}](${targetUrl})\n` : `[${fn}](${targetUrl})\n`;
        const ok = (this.plugin == null ? undefined : insertMarkdownToActiveEditor(this.plugin, mdSnippet, t('galleryInserted')));
        if (ok) this.close();
      };

      // 2. 加锁 / 解锁按钮
      const lockBtn = rightActions.createEl('button', { cls: 'fm-lightbox-management-btn' });
      const lockIcon = lockBtn.createSpan();
      const lockText = lockBtn.createSpan();
      const updateLockButton = () => {
        setIcon(lockIcon, remote.locked ? 'lock-open' : 'lock');
        lockText.setText(t(remote.locked ? 'galleryBtnUnlock' : 'galleryBtnLock'));
        lockBtn.setAttribute('title', lockText.textContent);
      };
      updateLockButton();
      lockBtn.onclick = async () => {
        try {
          await this.plugin.toggleRemoteFileLock(remote.year, remote.month, remote.filename, !remote.locked);
          remote.locked = !remote.locked;
          updateLockButton();
          delBtn.disabled = remote.locked;
          new Notice(t(remote.locked ? 'previewProtected' : 'previewUnprotected'));
          if (this.onActionChanged) this.onActionChanged('lock', remote);
        } catch (err) {
          new Notice(t('previewLockFailed', { err: err.message }));
        }
      };

      // 3. 删除至回收站
      const delBtn = rightActions.createEl('button', { cls: 'fm-lightbox-management-btn is-danger', attr: { title: t('galleryBtnDelete') } });
      setIcon(delBtn.createSpan(), 'trash-2');
      delBtn.createSpan({ text: t('galleryBtnDelete') });
      delBtn.disabled = remote.locked;
      delBtn.onclick = () => {
        if (remote.locked) return;
        new ConfirmActionModal(
          this.app,
          fn,
          t('galleryDeleteConfirm', { name: fn }),
          t('galleryBtnDelete'),
          async (confirmed) => {
            if (!confirmed) return;
            try {
              await this.plugin.deleteRemoteFile(remote.year, remote.month, remote.filename);
              new Notice(t('galleryDeleteSuccess', { name: fn }));
              if (this.onActionChanged) this.onActionChanged('deleted', remote);
              this.close();
            } catch (err) {
              new Notice(t('previewDeleteFailed', { err: err.message }));
            }
          },
          this.plugin
        ).open();
      };
      const openBtn = leftActions.createEl('button', { cls: 'fm-lightbox-secondary-btn' });
      setIcon(openBtn.createSpan(), 'external-link');
      openBtn.createSpan({ text: t('previewOpenBrowser') });
      openBtn.onclick = () => {
        window.open(remote.rawUrl, '_blank');
      };
    }

  }

  onClose() {
    this.contentEl.empty();
  }
}

/**
 * Modal listing all notes referencing the selected asset
 */
export class NoteRefsModal extends Modal {
  constructor(app, itemName, refNotePaths, onJump, plugin = null) {
    super(app);
    this.itemName = itemName;
    this.refNotePaths = refNotePaths || [];
    this.onJump = onJump;
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('fm-wizard-modal');
    const t = (k, p) => (this.plugin ? this.plugin.t(k, p) : translateUi('auto', k, p));

    contentEl.createEl('h3', { text: t('noteRefsTitle', { name: this.itemName, count: this.refNotePaths.length }) });

    if (this.refNotePaths.length === 0) {
      contentEl.createDiv({
        cls: 'fm-section-box',
        text: t('noteRefsNone'),
        attr: { style: 'text-align: center; padding: 24px;' }
      });
    } else {
      const listEl = contentEl.createDiv({ cls: 'fm-scroll-list' });
      for (const notePath of this.refNotePaths) {
        const row = listEl.createDiv({ cls: 'fm-list-item' });
        row.createSpan({ text: `📝 ${notePath}`, attr: { style: 'word-break: break-all; font-weight: 500;' } });
        const jumpBtn = row.createEl('button', {
          text: t('btnOpenNote'),
          cls: 'fm-mini-btn mod-cta'
        });
        jumpBtn.onclick = async () => {
          const tf = this.app.vault.getAbstractFileByPath(notePath);
          if (tf) {
            const leaf = this.app.workspace.getLeaf(false);
            if (leaf) await leaf.openFile(tf);
            this.close();
            if (this.onJump) this.onJump();
          } else {
            new Notice(t('noteRefsNotFound', { path: notePath }));
          }
        };
      }
    }

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const closeBtn = btnRow.createEl('button', { text: t('closeBtn') });
    closeBtn.onclick = () => this.close();
  }

  onClose() {
    this.contentEl.empty();
  }
}
