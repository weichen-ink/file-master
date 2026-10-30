/**
 * Helper to create a real-time scan progress bar + cancel button inside wizard modals
 */
function createScanProgressWidget(contentEl, plugin) {
  const abortController = new AbortController();
  const box = contentEl.createDiv({
    cls: 'fm-section-box',
    style: 'display:none; margin-top:10px; border-color: rgba(59, 130, 246, 0.45);'
  });
  const topRow = box.createDiv({
    style: 'display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:6px;'
  });
  const statusText = topRow.createSpan({
    text: plugin ? plugin.t('scanPreparing') : '⏳ Preparing scan...',
    style: 'font-size:12px; color:var(--text-accent); font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;'
  });
  const cancelScanBtn = topRow.createEl('button', {
    text: plugin ? plugin.t('btnCancelScan') : '⏹ Cancel Scan',
    cls: 'fm-mini-btn mod-warning',
    style: 'flex-shrink:0;'
  });
  cancelScanBtn.onclick = () => {
    abortController.abort();
    cancelScanBtn.disabled = true;
  };
  const wrap = box.createDiv({ cls: 'fm-progress-wrap' });
  const bar = wrap.createDiv({ cls: 'fm-progress-bar' });

  return {
    signal: abortController.signal,
    show() {
      box.style.display = 'block';
    },
    hide() {
      box.style.display = 'none';
    },
    abort() {
      abortController.abort();
    },
    update(current, total, label = '') {
      const pct = Math.min(100, Math.round((current / Math.max(1, total)) * 100));
      bar.style.width = `${pct}%`;
      const msg = plugin
        ? plugin.t('scanProgress', { current, total, label })
        : `⏳ Scanning (${current}/${total}): ${label}`;
      statusText.setText(msg);
    }
  };
}

/**
 * Confirmation modal for critical actions like remote file deletion
 */
class ConfirmActionModal extends Modal {
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
class ImageLightboxModal extends Modal {
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
      const url = await this.plugin.getItemPreviewUrl(this.item);
      if (url) img.src = url;
    } else {
      contentEl.createDiv({
        cls: 'fm-section-box',
        text: t('previewNonImageTip', { ext: ext.toUpperCase() }),
        style: 'text-align: center; padding: 30px 16px;'
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
        const ok = this.plugin?.insertMarkdownToActiveEditor(mdSnippet, t('galleryInserted'));
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
class NoteRefsModal extends Modal {
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
        style: 'text-align: center; padding: 24px;'
      });
    } else {
      const listEl = contentEl.createDiv({ cls: 'fm-scroll-list' });
      for (const notePath of this.refNotePaths) {
        const row = listEl.createDiv({ cls: 'fm-list-item' });
        row.createSpan({ text: `📝 ${notePath}`, style: 'word-break: break-all; font-weight: 500;' });
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

/**
 * Renders a 44x44 thumbnail or icon in wizard lists (click to inspect)
 */
function renderItemVisualThumb(parentEl, item, plugin) {
  const t = (k, p) => (plugin ? plugin.t(k, p) : translateUi('auto', k, p));
  const ext = getExt(item.name);
  if (IMAGE_EXTS.has(ext)) {
    const img = parentEl.createEl('img', {
      cls: 'fm-item-thumb',
      attr: { title: t('thumbEnlargeTooltip') }
    });
    img.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      new ImageLightboxModal(plugin.app, plugin, item).open();
    };
    plugin.getItemPreviewUrl(item).then((url) => {
      if (url) img.src = url;
    });
  } else {
    const box = parentEl.createDiv({
      cls: 'fm-item-icon-box',
      attr: { title: t('thumbDetailsTooltip') }
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
      new ImageLightboxModal(plugin.app, plugin, item).open();
    };
  }
}

class IncomingFileModal extends Modal {
  constructor(app, fileInfo, options, callback = null) {
    super(app);
    this.fileInfo = fileInfo; // { arrayBuffer, defaultBaseName, ext, size, mimeType, sha256 }
    this.options = options;   // { askLocation, fixedLocation, promptRename, plugin, editor, activeFile }
    this.callback = callback;
    this.plugin = options.plugin;
    const isRemote = Boolean(this.plugin?.isRemoteServerReady?.());
    if (!isRemote) {
      this.options.askLocation = false;
      this.options.fixedLocation = 'local';
      this.targetLocation = 'local';
      this.step = this.options.promptRename ? 'input' : 'executing';
    } else {
      this.step = (options.askLocation || options.promptRename) ? 'input' : 'executing';
    }
    this.finalFilename = `${fileInfo.defaultBaseName}.${fileInfo.ext}`;
    this.targetLocation = this.options.fixedLocation || (isRemote ? 'remote' : 'local');
    this.result = null;
    this.isDone = false;
  }

  t(k, p) {
    return this.plugin ? this.plugin.t(k, p) : k;
  }

  onOpen() {
    this.render();
    if (this.step === 'executing') {
      this.runExecution();
    }
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('fm-wizard-modal');

    if (this.step === 'input') {
      this.renderInputStep();
    } else if (this.step === 'executing') {
      this.renderExecutingStep();
    } else if (this.step === 'result') {
      this.renderResultStep();
    }
  }

  renderInputStep() {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: this.t('destTitle') });

    // Render thumbnail preview for images (including HEIC/HEIF/TIFF)
    if (IMAGE_EXTS.has(this.fileInfo.ext)) {
      const img = contentEl.createEl('img', { cls: 'fm-preview-thumb' });
      const loadingTip = NEEDS_TRANSCODE_IMAGE_EXTS.has(this.fileInfo.ext)
        ? contentEl.createDiv({
            text: this.t('destTranscodeTip', { ext: this.fileInfo.ext.toUpperCase() }),
            style: 'font-size: 12px; color: var(--text-accent); text-align: center; margin-bottom: 8px;'
          })
        : null;

      convertBufferToPreviewUrl(this.fileInfo.arrayBuffer, this.fileInfo.ext, this.plugin)
        .then((url) => {
          img.src = url;
          if (loadingTip) loadingTip.remove();
        })
        .catch(() => {
          if (loadingTip) loadingTip.setText(this.t('destTranscodeFail'));
        });
    }

    contentEl.createDiv({
      text: this.t('destTypeSize', { ext: this.fileInfo.ext.toUpperCase(), size: formatBytes(this.fileInfo.size) }),
      style: 'font-size: 12px; color: var(--text-muted); margin-bottom: 12px; text-align: center;'
    });

    // Filename input
    const nameBox = contentEl.createDiv({ cls: 'fm-section-box' });
    nameBox.createDiv({
      text: this.t('destFilenameLabel', { ext: this.fileInfo.ext }),
      cls: 'fm-section-title'
    });
    const nameInput = nameBox.createEl('input', {
      type: 'text',
      value: this.fileInfo.defaultBaseName,
      style: 'width: 100%; padding: 8px 10px; font-size: 14px;'
    });

    const triggerExecute = (target) => {
      const cleanBase = sanitizeCleanBaseName(nameInput.value, this.fileInfo.defaultBaseName);
      this.finalFilename = `${cleanBase}.${this.fileInfo.ext}`;
      this.targetLocation = target;
      this.step = 'executing';
      this.render();
      this.runExecution();
    };

    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        triggerExecute(this.options.askLocation ? 'remote' : this.options.fixedLocation);
      }
    });

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const cancelBtn = btnRow.createEl('button', { text: this.t('btnCancel') });
    cancelBtn.onclick = () => {
      this.isDone = true;
      this.close();
      if (this.callback) this.callback({ target: null });
    };

    if (this.options.askLocation) {
      const localBtn = btnRow.createEl('button', { text: this.t('destSaveLocal') });
      localBtn.onclick = () => triggerExecute('local');

      const remoteBtn = btnRow.createEl('button', {
        text: this.t('destSaveRemote'),
        cls: 'mod-cta'
      });
      remoteBtn.onclick = () => triggerExecute('remote');
    } else {
      const label =
        this.options.fixedLocation === 'local'
          ? this.t('destSaveLocal')
          : this.t('destSaveRemote');
      const okBtn = btnRow.createEl('button', { text: label, cls: 'mod-cta' });
      okBtn.onclick = () => triggerExecute(this.options.fixedLocation);
    }

    setTimeout(() => {
      nameInput.focus();
      nameInput.select();
    }, 30);
  }

  renderExecutingStep() {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: this.t('destProcessingTitle') });

    const infoBox = contentEl.createDiv({ cls: 'fm-section-box', style: 'margin-bottom: 14px;' });
    infoBox.createDiv({
      text: `📄 ${this.finalFilename}  (${formatBytes(this.fileInfo.size)})`,
      style: 'font-weight: 600; margin-bottom: 10px;'
    });

    const progressWrap = infoBox.createDiv({ cls: 'fm-progress-wrap' });
    this.progressBar = progressWrap.createDiv({ cls: 'fm-progress-bar', style: 'width: 15%;' });

    this.statusLabel = infoBox.createDiv({
      text: this.targetLocation === 'remote'
        ? this.t('destProbeChecking')
        : this.t('destSavingLocal'),
      style: 'font-size: 12px; color: var(--text-accent); margin-top: 8px;'
    });
  }

  async runExecution() {
    try {
      const activeFile = this.options.activeFile || this.app.workspace.getActiveFile();
      const editor = this.options.editor;

      if (this.targetLocation === 'local') {
        if (this.progressBar) this.progressBar.style.width = '40%';
        if (this.statusLabel) this.statusLabel.setText(this.t('destSavingLocal'));

        const sourcePath = activeFile ? activeFile.path : '';
        const localPath = await this.app.fileManager.getAvailablePathForAttachment(
          this.finalFilename,
          sourcePath
        );

        if (this.progressBar) this.progressBar.style.width = '75%';
        const createdFile = await this.app.vault.createBinary(localPath, this.fileInfo.arrayBuffer);
        const mdLink = this.app.fileManager.generateMarkdownLink(createdFile, sourcePath);

        if (editor) {
          editor.replaceSelection(mdLink + '\n');
        }

        if (this.progressBar) this.progressBar.style.width = '100%';
        this.result = {
          success: true,
          target: 'local',
          localPath: createdFile.path,
          mdLink,
          inserted: !!editor
        };
      } else {
        // Remote upload with Instant SHA-256 Probe check
        if (this.progressBar) this.progressBar.style.width = '25%';
        if (this.statusLabel) this.statusLabel.setText(this.t('destProbeChecking'));

        const sha256 = this.fileInfo.sha256 || computeSha256Hex(this.fileInfo.arrayBuffer);
        let res = null;

        // 1. Probe remote server
        const probed = await this.plugin.probeRemoteSha256(sha256);
        if (probed && probed.exists) {
          res = Object.assign({}, probed, { isInstant: true });
          if (this.progressBar) this.progressBar.style.width = '100%';
          if (this.statusLabel) this.statusLabel.setText(this.t('destInstantBadge'));
        } else {
          // 2. Stream upload to server
          if (this.progressBar) this.progressBar.style.width = '55%';
          if (this.statusLabel) this.statusLabel.setText(this.t('destUploadingRemote'));

          res = await this.plugin.uploadBufferToServer(
            this.fileInfo.arrayBuffer,
            this.finalFilename,
            this.fileInfo.mimeType || 'application/octet-stream',
            false,
            { skipProbe: true }
          );
          if (this.progressBar) this.progressBar.style.width = '100%';
        }

        const useOpt =
          this.plugin.settings.insertOptimizedLinkOnUpload &&
          res.optimizationEnabled !== false &&
          res.category === 'image' &&
          res.pubUrl;
        const finalMarkdown = useOpt ? `![](${res.pubUrl})` : res.markdown;

        if (editor) {
          editor.replaceSelection(finalMarkdown + '\n');
        }

        this.result = {
          success: true,
          target: 'remote',
          res,
          finalMarkdown,
          isInstant: !!res.isInstant,
          inserted: !!editor
        };
      }
    } catch (err) {
      this.result = {
        success: false,
        error: err.message || String(err)
      };
    }

    if (this.callback) {
      this.callback({ target: this.targetLocation, finalFilename: this.finalFilename, result: this.result });
    }

    this.step = 'result';
    this.render();
  }

  renderResultStep() {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: this.t('destResultTitle') });

    if (!this.result.success) {
      const errBanner = contentEl.createDiv({ cls: 'fm-result-banner fm-result-banner-error' });
      errBanner.createDiv({
        cls: 'fm-result-banner-title',
        text: this.t('destProcessingError', { err: this.result.error })
      });
      const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
      const closeBtn = btnRow.createEl('button', { text: this.t('destBtnDone'), cls: 'mod-cta' });
      closeBtn.onclick = () => {
        this.isDone = true;
        this.close();
      };
      return;
    }

    if (this.result.target === 'remote') {
      const isInstant = this.result.isInstant;
      const banner = contentEl.createDiv({
        cls: `fm-result-banner ${isInstant ? 'fm-result-banner-instant' : 'fm-result-banner-success'}`
      });
      banner.createDiv({
        cls: 'fm-result-banner-title',
        text: isInstant ? this.t('destInstantBadge') : this.t('destSuccessBadge')
      });
      banner.createDiv({
        cls: 'fm-result-banner-desc',
        text: isInstant ? this.t('destInstantDesc') : this.t('destSuccessDesc')
      });

      const detailsBox = contentEl.createDiv({ cls: 'fm-section-box' });
      detailsBox.createDiv({
        text: `📄 ${this.finalFilename}  |  ${formatBytes(this.fileInfo.size)}`,
        style: 'font-weight: 600; margin-bottom: 12px; color: var(--text-normal);'
      });

      const addCopyRow = (label, val) => {
        if (!val) return;
        detailsBox.createDiv({ cls: 'fm-copy-row-label', text: label });
        const row = detailsBox.createDiv({ cls: 'fm-copy-row' });
        row.createEl('input', { type: 'text', value: val, attr: { readonly: true } });
        const copyBtn = row.createEl('button', { text: this.t('destBtnCopy'), cls: 'fm-mini-btn' });
        copyBtn.onclick = async () => {
          await navigator.clipboard.writeText(val);
          copyBtn.setText(this.t('destBtnCopied'));
          setTimeout(() => {
            if (copyBtn && copyBtn.isConnected) copyBtn.setText(this.t('destBtnCopy'));
          }, 1800);
        };
      };

      addCopyRow(this.t('destLabelRawUrl'), this.result.res?.rawUrl);
      if (this.result.res?.pubUrl) {
        addCopyRow(this.t('destLabelPubUrl'), this.result.res.pubUrl);
      }
      addCopyRow(this.t('destLabelMarkdown'), this.result.finalMarkdown);

      if (this.result.inserted) {
        detailsBox.createDiv({
          cls: 'fm-result-inserted-tip',
          text: this.t('destInsertedNotice')
        });
      }
    } else {
      // Local result
      const banner = contentEl.createDiv({ cls: 'fm-result-banner fm-result-banner-local' });
      banner.createDiv({ cls: 'fm-result-banner-title', text: this.t('destLocalBadge') });
      banner.createDiv({ cls: 'fm-result-banner-desc', text: this.t('destLocalDesc') });

      const detailsBox = contentEl.createDiv({ cls: 'fm-section-box' });
      detailsBox.createDiv({
        text: `📄 ${this.finalFilename}  |  ${formatBytes(this.fileInfo.size)}`,
        style: 'font-weight: 600; margin-bottom: 12px; color: var(--text-normal);'
      });

      const addCopyRow = (label, val) => {
        if (!val) return;
        detailsBox.createDiv({ cls: 'fm-copy-row-label', text: label });
        const row = detailsBox.createDiv({ cls: 'fm-copy-row' });
        row.createEl('input', { type: 'text', value: val, attr: { readonly: true } });
        const copyBtn = row.createEl('button', { text: this.t('destBtnCopy'), cls: 'fm-mini-btn' });
        copyBtn.onclick = async () => {
          await navigator.clipboard.writeText(val);
          copyBtn.setText(this.t('destBtnCopied'));
          setTimeout(() => {
            if (copyBtn && copyBtn.isConnected) copyBtn.setText(this.t('destBtnCopy'));
          }, 1800);
        };
      };

      addCopyRow(this.t('destLabelLocalPath'), this.result.localPath);
      addCopyRow(this.t('destLabelMarkdown'), this.result.mdLink);

      if (this.result.inserted) {
        detailsBox.createDiv({
          cls: 'fm-result-inserted-tip',
          text: this.t('destInsertedNotice')
        });
      }
    }

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const doneBtn = btnRow.createEl('button', { text: this.t('destBtnDone'), cls: 'mod-cta' });
    doneBtn.onclick = () => {
      this.isDone = true;
      this.close();
    };
  }

  onClose() {
    if (!this.isDone && this.callback) {
      this.callback({ target: null });
    }
    this.contentEl.empty();
  }
}

/**
 * Modal to execute active note operations with real-time progress bar & in-window result
 */
class ActiveNoteActionModal extends Modal {
  constructor(app, plugin, targetFile, actionType = 'migrate') {
    super(app);
    this.plugin = plugin;
    this.targetFile = targetFile;
    this.actionType = actionType; // 'migrate' | 'download'
    this.step = 'running';
    this.result = null;
  }

  t(k, p) {
    return this.plugin ? this.plugin.t(k, p) : k;
  }

  async onOpen() {
    this.render();
    await this.execute();
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('fm-wizard-modal');

    const titleKey = this.actionType === 'migrate' ? 'activeNoteMigrateTitle' : 'activeNoteDownloadTitle';
    contentEl.createEl('h3', { text: this.t(titleKey) });

    contentEl.createDiv({
      text: `📄 ${this.targetFile.path}`,
      style: 'font-size: 12px; color: var(--text-muted); margin-bottom: 12px;'
    });

    if (this.step === 'running') {
      const box = contentEl.createDiv({ cls: 'fm-section-box' });
      this.statusText = box.createDiv({
        text: this.t('activeNoteScanning'),
        style: 'font-size: 13px; color: var(--text-accent); margin-bottom: 8px;'
      });
      const wrap = box.createDiv({ cls: 'fm-progress-wrap' });
      this.progressBar = wrap.createDiv({ cls: 'fm-progress-bar', style: 'width: 10%;' });
    } else if (this.step === 'result') {
      if (!this.result.success) {
        const errBanner = contentEl.createDiv({ cls: 'fm-result-banner fm-result-banner-error' });
        errBanner.createDiv({ cls: 'fm-result-banner-title', text: '❌ ' + this.result.message });
      } else if (this.result.count === 0) {
        const emptyBanner = contentEl.createDiv({ cls: 'fm-section-box', style: 'text-align: center; padding: 24px 16px;' });
        emptyBanner.createDiv({
          text: this.actionType === 'migrate' ? this.t('activeNoteNoLocal') : this.t('activeNoteNoRemote'),
          style: 'font-size: 14px; color: var(--text-muted);'
        });
      } else {
        const banner = contentEl.createDiv({ cls: 'fm-result-banner fm-result-banner-success' });
        banner.createDiv({
          cls: 'fm-result-banner-title',
          text: this.actionType === 'migrate' ? this.t('activeNoteMigrateComplete') : this.t('activeNoteDownloadComplete')
        });
        banner.createDiv({
          cls: 'fm-result-banner-desc',
          text: this.actionType === 'migrate'
            ? this.t('activeNoteMigrateDoneDesc', { count: this.result.count })
            : this.t('activeNoteDownloadDoneDesc', { count: this.result.count })
        });
      }

      const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
      const doneBtn = btnRow.createEl('button', { text: this.t('destBtnDone'), cls: 'mod-cta' });
      doneBtn.onclick = () => this.close();
    }
  }

  async execute() {
    try {
      if (this.actionType === 'migrate') {
        const count = await this.plugin.executeMigrateNoteDirect(
          this.targetFile,
          (cur, total, name) => {
            if (this.progressBar) {
              const pct = Math.round((cur / Math.max(1, total)) * 100);
              this.progressBar.style.width = `${pct}%`;
            }
            if (this.statusText) {
              this.statusText.setText(this.t('activeNoteProcessing', { current: cur, total, name }));
            }
          }
        );
        this.result = { success: true, count };
      } else {
        const count = await this.plugin.executeDownloadNoteDirect(
          this.targetFile,
          (cur, total, name) => {
            if (this.progressBar) {
              const pct = Math.round((cur / Math.max(1, total)) * 100);
              this.progressBar.style.width = `${pct}%`;
            }
            if (this.statusText) {
              this.statusText.setText(this.t('activeNoteProcessing', { current: cur, total, name }));
            }
          }
        );
        this.result = { success: true, count };
      }
    } catch (err) {
      this.result = { success: false, message: err.message };
    }
    this.step = 'result';
    this.render();
  }

  onClose() {
    this.contentEl.empty();
  }
}

/**
 * Wizard 1: Orphan Finder Wizard
 * Step 1: Select location scope and file types (with real-time scan progress + cancel button)
 * Step 2: Display results, export report, and safely clean selected items
 */
class OrphanWizardModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.step = 1;
    this.activeProgress = null;
    const isRemote = Boolean(plugin?.isRemoteServerReady?.());
    this.options = {
      scanLocal: true,
      scanRemote: isRemote,
      typeNote: false,
      typeImage: true,
      typeAudio: true,
      typeOther: true
    };
    this.results = [];
  }

  onOpen() {
    this.render();
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('fm-wizard-modal');

    if (this.step === 1) {
      this.renderStep1(contentEl);
    } else {
      this.renderStep2(contentEl);
    }
  }

  renderStep1(contentEl) {
    const t = (k, p) => this.plugin.t(k, p);
    const header = contentEl.createDiv({ cls: 'fm-step-header' });
    header.createSpan({ text: t('stepOf', { current: 1, total: 2 }), cls: 'fm-step-badge' });
    header.createEl('h3', { text: t('orphanStep1Title'), cls: 'fm-step-title' });

    contentEl.createEl('p', {
      text: t('orphanStep1Desc'),
      style: 'font-size: 13px; color: var(--text-muted); margin-bottom: 14px;'
    });

    if (this.plugin?.isRemoteServerReady?.()) {
      const locBox = contentEl.createDiv({ cls: 'fm-section-box' });
      locBox.createDiv({ text: t('orphanLocScope'), cls: 'fm-section-title' });
      this.createCheckbox(locBox, t('orphanScanLocal'), 'scanLocal');
      this.createCheckbox(locBox, t('orphanScanRemote'), 'scanRemote');
    }

    const typeBox = contentEl.createDiv({ cls: 'fm-section-box' });
    typeBox.createDiv({ text: t('orphanTypeScope'), cls: 'fm-section-title' });
    this.createCheckbox(typeBox, t('orphanTypeNote'), 'typeNote');
    this.createCheckbox(typeBox, t('orphanTypeImage'), 'typeImage');
    this.createCheckbox(typeBox, t('orphanTypeAudio'), 'typeAudio');
    this.createCheckbox(typeBox, t('orphanTypeOther'), 'typeOther');

    const exclFolders = this.plugin.getExcludedLocalFolderList();
    const protInfo = contentEl.createDiv({
      cls: 'fm-section-box',
      style: 'font-size: 12px; color: var(--text-muted); padding: 10px 14px;'
    });
    const exclHint = exclFolders.length ? t('orphanExclHint', { folders: exclFolders.join(', ') }) : '';
    protInfo.createDiv({
      text: t('orphanProtActive', { excl: exclHint })
    });

    const progressWidget = createScanProgressWidget(contentEl, this.plugin);
    this.activeProgress = progressWidget;

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const cancelBtn = btnRow.createEl('button', { text: t('btnCancel') });
    cancelBtn.onclick = () => this.close();

    const nextBtn = btnRow.createEl('button', { text: t('btnNext'), cls: 'mod-cta' });
    nextBtn.onclick = async () => {
      if (!this.options.scanLocal && !this.options.scanRemote) {
        new Notice(t('orphanLocRequired'));
        return;
      }
      if (!this.options.typeNote && !this.options.typeImage && !this.options.typeAudio && !this.options.typeOther) {
        new Notice(t('orphanTypeRequired'));
        return;
      }
      nextBtn.disabled = true;
      nextBtn.setText(t('orphanScanning'));
      progressWidget.show();
      try {
        this.results = await this.plugin.scanUnusedFiles(this.options, {
          signal: progressWidget.signal,
          onProgress: (cur, total, label) => progressWidget.update(cur, total, label)
        });
        this.step = 2;
        this.render();
      } catch (err) {
        progressWidget.hide();
        new Notice(err.message === 'SCAN_ABORTED' ? this.plugin.t('scanCancelled') : '❌ Scan failed: ' + err.message);
        nextBtn.disabled = false;
        nextBtn.setText(t('btnNext'));
      }
    };
  }

  createCheckbox(parent, labelText, optKey) {
    const label = parent.createEl('label', { cls: 'fm-check-row' });
    const cb = label.createEl('input', { type: 'checkbox' });
    cb.checked = Boolean(this.options[optKey]);
    cb.onchange = () => {
      this.options[optKey] = cb.checked;
    };
    label.createSpan({ text: labelText });
  }

  renderStep2(contentEl) {
    const t = (k, p) => this.plugin.t(k, p);
    const header = contentEl.createDiv({ cls: 'fm-step-header' });
    header.createSpan({ text: t('stepOf', { current: 2, total: 2 }), cls: 'fm-step-badge' });
    header.createEl('h3', { text: t('orphanStep2Title', { count: this.results.length }), cls: 'fm-step-title' });

    if (this.lastCleanSummary) {
      const banner = contentEl.createDiv({ cls: 'fm-result-banner fm-result-banner-success' });
      banner.createDiv({ cls: 'fm-result-banner-title', text: t('orphanResultTitle') });
      banner.createDiv({
        cls: 'fm-result-banner-desc',
        text: t('orphanResultDesc', {
          count: this.lastCleanSummary.total || 0,
          local: this.lastCleanSummary.local || 0,
          remote: this.lastCleanSummary.remote || 0
        })
      });
    }

    const toolbar = contentEl.createDiv({ cls: 'fm-toolbar-row' });
    const leftTools = toolbar.createDiv({ style: 'display:flex; gap:8px; align-items:center;' });
    const backBtn = leftTools.createEl('button', { text: t('btnBack') });
    backBtn.onclick = () => {
      this.step = 1;
      this.render();
    };

    const selectAllBtn = leftTools.createEl('button', { text: t('btnSelectAll') });
    selectAllBtn.onclick = () => {
      const allSelected = this.results.every((r) => r.selected);
      this.results.forEach((r) => { r.selected = !allSelected; });
      this.render();
    };

    const exportBtn = toolbar.createEl('button', {
      text: t('btnExportReport'),
      cls: 'mod-cta'
    });
    exportBtn.onclick = async () => {
      await this.plugin.exportOrphanReportToRoot(this.results);
    };

    if (this.results.length === 0) {
      contentEl.createDiv({
        cls: 'fm-section-box',
        text: t('orphanNoneFound'),
        style: 'text-align: center; padding: 36px 20px;'
      });
      return;
    }

    const listEl = contentEl.createDiv({ cls: 'fm-scroll-list' });
    for (const item of this.results) {
      const row = listEl.createDiv({ cls: 'fm-list-item' });
      const left = row.createDiv({
        style: 'display:flex; align-items:center; gap:10px; flex:1; overflow:hidden;'
      });

      const cb = left.createEl('input', { type: 'checkbox', style: 'cursor:pointer;' });
      cb.checked = item.selected;
      cb.onchange = () => {
        item.selected = cb.checked;
      };

      renderItemVisualThumb(left, item, this.plugin);

      const infoCol = left.createDiv({ style: 'overflow:hidden; flex:1;' });
      const topLine = infoCol.createDiv({ style: 'display:flex; align-items:center; gap:6px;' });
      topLine.createSpan({
        text: item.source === 'local' ? '💻 Local' : '☁️ Remote',
        cls: `fm-tag ${item.source === 'local' ? 'fm-tag-local' : 'fm-tag-remote'}`
      });
      topLine.createSpan({
        text: item.displayPath,
        style: 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:500;'
      });

      const rightBox = row.createDiv({
        style: 'display:flex; align-items:center; gap:8px; flex-shrink:0;'
      });
      rightBox.createSpan({
        text: formatBytes(item.size),
        style: 'color: var(--text-muted); font-size: 12px;'
      });

      if (item.source === 'remote') {
        const lockBtn = rightBox.createEl('button', {
          text: t('lockBtnText'),
          cls: 'fm-mini-btn',
          attr: { title: t('lockBtnTitle') }
        });
        lockBtn.onclick = async () => {
          try {
            await this.plugin.toggleRemoteFileLock(item.rawObj.year, item.rawObj.month, item.rawObj.filename, true);
            new Notice(this.plugin.t('noticeProtectedRemote', { name: item.name }));
            this.results = this.results.filter((r) => r.id !== item.id);
            this.render();
          } catch (err) {
            new Notice(this.plugin.t('noticeLockFailed', { err: err.message }));
          }
        };
      }
    }

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const cleanBtn = btnRow.createEl('button', {
      text: t('orphanDeleteSelected', { count: this.results.filter((r) => r.selected).length }),
      cls: 'mod-warning'
    });
    cleanBtn.onclick = async () => {
      const selected = this.results.filter((r) => r.selected);
      if (selected.length === 0) {
        new Notice(this.plugin.t('orphanSelectRequired'));
        return;
      }
      await this.plugin.cleanSelectedOrphans(selected, (summary) => {
        const removedIds = new Set(selected.map((s) => s.id));
        this.results = this.results.filter((r) => !removedIds.has(r.id));
        this.lastCleanSummary = summary;
        this.render();
      });
    };
  }

  onClose() {
    if (this.activeProgress) this.activeProgress.abort();
    this.contentEl.empty();
  }
}

/**
 * Wizard 2: Duplicate Finder Wizard
 * Step 1: Select duplicate comparison scope (with real-time scan progress + cancel button)
 * Step 2: Display duplicate groups, thumbnail previews, note references, and resolution strategies
 */
class DuplicateWizardModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.step = 1;
    this.activeProgress = null;
    const isRemote = Boolean(plugin?.isRemoteServerReady?.());
    this.scope = isRemote ? 'both' : 'local';
    this.fileTypes = {
      typeImage: true,
      typeAudio: true,
      typeOther: true,
      typeNote: false
    };
    this.processMode = 'auto';
    this.groups = [];
    this.scanStats = { localScanned: 0, remoteScanned: 0, remoteError: null };
  }

  onOpen() {
    this.render();
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('fm-wizard-modal');

    if (this.step === 1) {
      this.renderStep1(contentEl);
    } else if (this.step === 2) {
      this.renderStep2(contentEl);
    } else if (this.step === 3) {
      this.renderStep3(contentEl);
    }
  }

  renderStep1(contentEl) {
    const t = (k, p) => this.plugin.t(k, p);
    const header = contentEl.createDiv({ cls: 'fm-step-header' });
    header.createSpan({ text: t('stepOf', { current: 1, total: 2 }), cls: 'fm-step-badge' });
    header.createEl('h3', { text: t('dupStep1Title'), cls: 'fm-step-title' });

    contentEl.createEl('p', {
      text: t('dupStep1Desc'),
      style: 'font-size: 13px; color: var(--text-muted); margin-bottom: 14px;'
    });

    const isRemote = Boolean(this.plugin?.isRemoteServerReady?.());
    if (isRemote) {
      const scopeBox = contentEl.createDiv({ cls: 'fm-section-box' });
      scopeBox.createDiv({ text: t('dupLocScope'), cls: 'fm-section-title' });

      const scopes = [
        { key: 'both', label: t('dupCompareCross') },
        { key: 'local', label: t('dupCompareLocal') },
        { key: 'remote', label: '☁️ Remote Server Only' }
      ];

      for (const s of scopes) {
        const row = scopeBox.createEl('label', { cls: 'fm-check-row' });
        const radio = row.createEl('input', { type: 'radio', attr: { name: 'fm_dup_scope' } });
        radio.checked = this.scope === s.key;
        radio.onchange = () => {
          this.scope = s.key;
        };
        row.createSpan({ text: s.label });
      }
    }

    const typeBox = contentEl.createDiv({ cls: 'fm-section-box' });
    typeBox.createDiv({ text: t('dupTypeScope'), cls: 'fm-section-title' });
    this.createTypeCheckbox(typeBox, t('dupTypeImage'), 'typeImage');
    this.createTypeCheckbox(typeBox, t('dupTypeAudio'), 'typeAudio');
    this.createTypeCheckbox(typeBox, t('dupTypeOther'), 'typeOther');
    this.createTypeCheckbox(typeBox, t('dupTypeNote'), 'typeNote');

    const exclFolders = this.plugin.getExcludedLocalFolderList();
    const protBox = contentEl.createDiv({
      cls: 'fm-section-box',
      style: 'font-size: 12px; color: var(--text-muted); padding: 10px 14px;'
    });
    protBox.createDiv({
      text: `🛡️ Protection Rules: Local excluded folders (${exclFolders.join(', ') || 'none'}) are skipped. Remote files with "🔒 Protected Lock" are prioritized as keep targets and never deleted.`
    });

    const progressWidget = createScanProgressWidget(contentEl, this.plugin);
    this.activeProgress = progressWidget;

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const cancelBtn = btnRow.createEl('button', { text: t('btnCancel') });
    cancelBtn.onclick = () => this.close();

    const nextBtn = btnRow.createEl('button', { text: t('btnNext'), cls: 'mod-cta' });
    nextBtn.onclick = async () => {
      if (
        !this.fileTypes.typeImage &&
        !this.fileTypes.typeAudio &&
        !this.fileTypes.typeOther &&
        !this.fileTypes.typeNote
      ) {
        new Notice(this.plugin.t('dupSelectTypeRequired'));
        return;
      }
      nextBtn.disabled = true;
      nextBtn.setText(t('dupComparing'));
      progressWidget.show();
      try {
        const res = await this.plugin.scanDuplicateGroups(this.scope, this.fileTypes, {
          signal: progressWidget.signal,
          onProgress: (cur, total, label) => progressWidget.update(cur, total, label)
        });
        this.groups = res.groups;
        this.scanStats = res.stats;
        this.applyProcessMode('auto');
        this.step = 2;
        this.render();
      } catch (err) {
        progressWidget.hide();
        new Notice(err.message === 'SCAN_ABORTED' ? this.plugin.t('scanCancelled') : '❌ Comparison failed: ' + err.message);
        nextBtn.disabled = false;
        nextBtn.setText(t('btnNext'));
      }
    };
  }

  createTypeCheckbox(parent, labelText, key) {
    const label = parent.createEl('label', { cls: 'fm-check-row' });
    const cb = label.createEl('input', { type: 'checkbox' });
    cb.checked = Boolean(this.fileTypes[key]);
    cb.onchange = () => {
      this.fileTypes[key] = cb.checked;
    };
    label.createSpan({ text: labelText });
  }

  applyProcessMode(mode) {
    this.processMode = mode;
    for (const grp of this.groups) {
      const lockedItem = grp.items.find((i) => i.locked);
      if (lockedItem) {
        grp.keepId = lockedItem.id;
        continue;
      }

      if (mode === 'prefer-remote') {
        const remoteItem = grp.items.find((i) => i.source === 'remote');
        grp.keepId = remoteItem ? remoteItem.id : grp.items[0].id;
      } else if (mode === 'prefer-local') {
        const localItem = grp.items.find((i) => i.source === 'local');
        grp.keepId = localItem ? localItem.id : grp.items[0].id;
      } else {
        const sorted = [...grp.items].sort((a, b) => {
          if (b.refNotes.length !== a.refNotes.length) return b.refNotes.length - a.refNotes.length;
          if (a.source !== b.source) return a.source === 'remote' ? -1 : 1;
          return 0;
        });
        grp.keepId = sorted[0].id;
      }
    }
  }

  renderStep2(contentEl) {
    const t = (k, p) => this.plugin.t(k, p);
    const totalDupes = this.groups.reduce((acc, g) => acc + Math.max(0, g.items.length - 1), 0);
    const header = contentEl.createDiv({ cls: 'fm-step-header' });
    header.createSpan({ text: t('stepOf', { current: 2, total: 2 }), cls: 'fm-step-badge' });
    header.createEl('h3', {
      text: t('dupStep2Title', { groups: this.groups.length, redundant: totalDupes }),
      cls: 'fm-step-title'
    });

    const toolbar = contentEl.createDiv({ cls: 'fm-toolbar-row' });
    const leftTools = toolbar.createDiv({ style: 'display:flex; gap:8px; align-items:center; flex-wrap:wrap;' });

    const backBtn = leftTools.createEl('button', { text: t('btnBack') });
    backBtn.onclick = () => {
      this.step = 1;
      this.render();
    };

    leftTools.createSpan({ text: 'Strategy:', style: 'font-size:13px; font-weight:600; margin-left:4px;' });
    const modeSelect = leftTools.createEl('select', { style: 'padding: 5px 8px; border-radius: 6px;' });
    const modeOptions = [
      { value: 'auto', label: '1. Auto-select item to keep (Recommended)' },
      { value: 'prefer-remote', label: '2. Replace local files with remote copies (Vault Slimming)' },
      { value: 'prefer-local', label: '3. Keep local files and remove remote duplicates' }
    ];
    for (const opt of modeOptions) {
      const o = modeSelect.createEl('option', { value: opt.value, text: opt.label });
      if (opt.value === this.processMode) o.selected = true;
    }
    modeSelect.onchange = () => {
      this.applyProcessMode(modeSelect.value);
      this.render();
    };

    const exportBtn = toolbar.createEl('button', {
      text: t('btnExportReport')
    });
    exportBtn.onclick = async () => {
      await this.plugin.exportDuplicateReportToRoot(this.groups);
    };

    if (this.scanStats?.remoteError) {
      contentEl.createDiv({
        cls: 'fm-section-box',
        text: `⚠️ Remote server could not be reached (${this.scanStats.remoteError}). Showing local vault comparison results only.`,
        style: 'font-size: 12px; color: #f59e0b; border-color: rgba(245, 158, 11, 0.4); padding: 10px 14px;'
      });
    }

    if (this.groups.length === 0) {
      contentEl.createDiv({
        cls: 'fm-section-box',
        text: t('dupNoneFound'),
        style: 'text-align: center; padding: 36px 20px;'
      });
      const emptyBtnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
      const closeBtn = emptyBtnRow.createEl('button', { text: t('closeBtn'), cls: 'mod-cta' });
      closeBtn.onclick = () => this.close();
      return;
    }

    const listEl = contentEl.createDiv({ cls: 'fm-scroll-list' });
    this.groups.forEach((grp, idx) => {
      const grpBox = listEl.createDiv({ cls: 'fm-dup-group' });
      const grpHead = grpBox.createDiv({ cls: 'fm-dup-group-header' });
      grpHead.createSpan({
        text: `Duplicate Group #${idx + 1} (SHA-256: ${grp.sha256.slice(0, 12)}... | Size: ${formatBytes(grp.size)})`
      });
      grpHead.createSpan({ text: 'Click thumbnail to inspect; click reference count to view notes' });

      for (const item of grp.items) {
        const isKeep = grp.keepId === item.id;
        const row = grpBox.createDiv({ cls: 'fm-list-item' });
        const left = row.createDiv({
          style: 'display:flex; align-items:center; gap:8px; flex:1; overflow:hidden;'
        });

        const radio = left.createEl('input', {
          type: 'radio',
          attr: { name: `dup_grp_${idx}` },
          style: 'cursor:pointer;'
        });
        radio.checked = isKeep;
        radio.onchange = () => {
          grp.keepId = item.id;
          this.render();
        };

        renderItemVisualThumb(left, item, this.plugin);

        left.createSpan({
          text: isKeep ? '✅ Keep' : item.locked ? '🔒 Protected' : '🗑️ Remove',
          style: `font-size:12px; font-weight:700; color:${isKeep ? '#10b981' : item.locked ? '#f59e0b' : '#ef4444'}; width:68px; flex-shrink:0;`
        });

        left.createSpan({
          text: item.source === 'local' ? '💻 Local' : '☁️ Remote',
          cls: `fm-tag ${item.source === 'local' ? 'fm-tag-local' : 'fm-tag-remote'}`
        });

        if (item.locked) {
          left.createSpan({
            text: '🔒 ' + (this.t ? this.t('tagLocked') : 'Locked'),
            cls: 'fm-tag fm-tag-lock'
          });
        }

        left.createSpan({
          text: item.displayPath,
          style: 'word-break:break-all; cursor:pointer;',
          attr: { title: t('dupDesignateKeepTitle') }
        }).onclick = () => {
          grp.keepId = item.id;
          this.render();
        };

        const rightBox = row.createDiv({
          style: 'display:flex; align-items:center; gap:6px; flex-shrink:0;'
        });

        const refBadge = rightBox.createSpan({
          text: t('migrateNoteRefs', { count: item.refNotes.length }),
          cls: 'fm-tag fm-tag-ref fm-clickable-badge',
          attr: { title: t('migrateInspectRefs') }
        });
        refBadge.onclick = (e) => {
          e.stopPropagation();
          new NoteRefsModal(this.app, item.name, item.refNotes, () => this.close(), this.plugin).open();
        };
      }
    });

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const execBtn = btnRow.createEl('button', {
      text: t('dupMergeRewrite', { count: totalDupes }),
      cls: 'mod-cta'
    });
    execBtn.onclick = async () => {
      await this.plugin.executeDuplicateMergeSafely(this.groups, (summary) => {
        this.step = 3;
        this.summary = summary;
        this.render();
      });
    };
  }

  renderStep3(contentEl) {
    const t = (k, p) => this.plugin.t(k, p);
    contentEl.createEl('h3', { text: t('dupResultTitle') });

    const banner = contentEl.createDiv({ cls: 'fm-result-banner fm-result-banner-success' });
    banner.createDiv({ cls: 'fm-result-banner-title', text: t('dupResultTitle') });
    banner.createDiv({
      cls: 'fm-result-banner-desc',
      text: t('dupResultDesc', {
        modified: this.summary?.modified || 0,
        local: this.summary?.local || 0,
        remote: this.summary?.remote || 0,
        skipped: this.summary?.skipped > 0 ? t('dupResultSkipped', { count: this.summary.skipped }) : ''
      })
    });

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const doneBtn = btnRow.createEl('button', { text: t('destBtnDone'), cls: 'mod-cta' });
    doneBtn.onclick = () => this.close();
  }

  onClose() {
    if (this.activeProgress) this.activeProgress.abort();
    this.contentEl.empty();
  }
}

/**
 * Wizard 3: Batch Cloud Migration Wizard
 * Step 1: Select migration folder scope, attachment types, and trash policy (with real-time scan progress + cancel button)
 * Step 2: Preview list, progress bar, upload, and zero-broken-link safe rewrite
 */
class BatchMigrateWizardModal extends Modal {
  constructor(app, plugin, initialFolder = '') {
    super(app);
    this.plugin = plugin;
    this.step = 1;
    this.activeProgress = null;
    this.options = {
      folderPrefix: initialFolder || '',
      typeImage: true,
      typeAudio: true,
      typeOther: true,
      uploadToProtected: false,
      deleteLocalAfter: plugin.settings.deleteLocalAfterMigrate
    };
    this.items = [];
  }

  onOpen() {
    this.render();
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('fm-wizard-modal');

    if (this.step === 1) {
      this.renderStep1(contentEl);
    } else if (this.step === 2) {
      this.renderStep2(contentEl);
    } else if (this.step === 3) {
      this.renderStep3(contentEl);
    }
  }

  renderStep1(contentEl) {
    const t = (k, p) => this.plugin.t(k, p);
    const header = contentEl.createDiv({ cls: 'fm-step-header' });
    header.createSpan({ text: t('stepOf', { current: 1, total: 2 }), cls: 'fm-step-badge' });
    header.createEl('h3', { text: t('migrateStep1Title'), cls: 'fm-step-title' });

    contentEl.createEl('p', {
      text: t('migrateStep1Desc'),
      style: 'font-size: 13px; color: var(--text-muted); margin-bottom: 14px;'
    });

    const folderBox = contentEl.createDiv({ cls: 'fm-section-box' });
    folderBox.createDiv({ text: t('migrateFolderScope'), cls: 'fm-section-title' });
    const folderSelect = folderBox.createEl('select', { style: 'width:100%; padding:8px 10px; border-radius:6px;' });
    folderSelect.createEl('option', {
      value: '',
      text: t('migrateEntireVault')
    });

    const allFolders = this.plugin.getAllVaultFolderPaths();
    for (const fp of allFolders) {
      const opt = folderSelect.createEl('option', { value: fp, text: `📁 ${fp}/` });
      if (fp === this.options.folderPrefix) opt.selected = true;
    }
    folderSelect.onchange = () => {
      this.options.folderPrefix = folderSelect.value;
    };

    const typeBox = contentEl.createDiv({ cls: 'fm-section-box' });
    typeBox.createDiv({ text: t('migrateTypeScope'), cls: 'fm-section-title' });
    this.createCheck(typeBox, t('migrateTypeImage'), 'typeImage');
    this.createCheck(typeBox, t('migrateTypeAudio'), 'typeAudio');
    this.createCheck(typeBox, t('migrateTypeOther'), 'typeOther');

    const policyBox = contentEl.createDiv({ cls: 'fm-section-box' });
    policyBox.createDiv({ text: t('migratePolicyTitle'), cls: 'fm-section-title' });
    this.createCheck(
      policyBox,
      t('migrateDeleteLocal'),
      'deleteLocalAfter'
    );

    const progressWidget = createScanProgressWidget(contentEl, this.plugin);
    this.activeProgress = progressWidget;

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const cancelBtn = btnRow.createEl('button', { text: t('btnCancel') });
    cancelBtn.onclick = () => this.close();

    const nextBtn = btnRow.createEl('button', { text: t('migrateNextPreview'), cls: 'mod-cta' });
    nextBtn.onclick = async () => {
      if (!this.options.typeImage && !this.options.typeAudio && !this.options.typeOther) {
        new Notice(t('migrateSelectTypeNotice'));
        return;
      }
      nextBtn.disabled = true;
      nextBtn.setText(t('migrateScanning'));
      progressWidget.show();
      try {
        this.items = await this.plugin.scanLocalAttachmentsForBatchMigrate(this.options, {
          signal: progressWidget.signal,
          onProgress: (cur, total, label) => progressWidget.update(cur, total, label)
        });
        this.step = 2;
        this.render();
      } catch (err) {
        progressWidget.hide();
        new Notice(err.message === 'SCAN_ABORTED' ? this.plugin.t('scanCancelled') : '❌ Scan failed: ' + err.message);
        nextBtn.disabled = false;
        nextBtn.setText(t('migrateNextPreview'));
      }
    };
  }

  createCheck(parent, labelText, key) {
    const label = parent.createEl('label', { cls: 'fm-check-row' });
    const cb = label.createEl('input', { type: 'checkbox' });
    cb.checked = Boolean(this.options[key]);
    cb.onchange = () => {
      this.options[key] = cb.checked;
    };
    label.createSpan({ text: labelText });
  }

  renderStep2(contentEl) {
    const t = (k, p) => this.plugin.t(k, p);
    const header = contentEl.createDiv({ cls: 'fm-step-header' });
    header.createSpan({ text: t('stepOf', { current: 2, total: 2 }), cls: 'fm-step-badge' });
    header.createEl('h3', {
      text: t('migrateStep2Title', { count: this.items.length }),
      cls: 'fm-step-title'
    });

    const toolbar = contentEl.createDiv({ cls: 'fm-toolbar-row' });
    const leftTools = toolbar.createDiv({ style: 'display:flex; gap:8px; align-items:center;' });
    const backBtn = leftTools.createEl('button', { text: t('btnBack') });
    backBtn.onclick = () => {
      this.step = 1;
      this.render();
    };

    const selectAllBtn = leftTools.createEl('button', { text: t('btnSelectAll') });
    selectAllBtn.onclick = () => {
      const allSelected = this.items.every((i) => i.selected);
      this.items.forEach((i) => { i.selected = !allSelected; });
      this.render();
    };

    const onlyRefBtn = leftTools.createEl('button', { text: t('migrateSelectOnlyRef') });
    onlyRefBtn.onclick = () => {
      this.items.forEach((i) => { i.selected = i.refNotes.length > 0; });
      this.render();
    };

    if (this.items.length === 0) {
      contentEl.createDiv({
        cls: 'fm-section-box',
        text: t('migrateNoneFound'),
        style: 'text-align: center; padding: 36px 20px;'
      });
      return;
    }

    const listEl = contentEl.createDiv({ cls: 'fm-scroll-list' });
    for (const item of this.items) {
      const row = listEl.createDiv({ cls: 'fm-list-item' });
      const left = row.createDiv({
        style: 'display:flex; align-items:center; gap:10px; flex:1; overflow:hidden;'
      });
      const cb = left.createEl('input', { type: 'checkbox', style: 'cursor:pointer;' });
      cb.checked = item.selected;
      cb.onchange = () => {
        item.selected = cb.checked;
      };

      renderItemVisualThumb(left, item, this.plugin);

      left.createSpan({
        text: item.displayPath,
        style: 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:500;'
      });

      const rightBox = row.createDiv({
        style: 'display:flex; align-items:center; gap:8px; flex-shrink:0;'
      });
      rightBox.createSpan({
        text: formatBytes(item.size),
        style: 'color: var(--text-muted); font-size: 12px;'
      });

      const refBadge = rightBox.createSpan({
        text: t('migrateNoteRefs', { count: item.refNotes.length }),
        cls: 'fm-tag fm-tag-ref fm-clickable-badge',
        attr: { title: t('migrateInspectRefs') }
      });
      refBadge.onclick = (e) => {
        e.stopPropagation();
        new NoteRefsModal(this.app, item.name, item.refNotes, () => this.close(), this.plugin).open();
      };
    }

    const progressBox = contentEl.createDiv({ style: 'display:none; margin-bottom:10px;' });
    const progressText = progressBox.createDiv({ style: 'font-size:12px; color:var(--text-accent);' });
    const progressWrap = progressBox.createDiv({ cls: 'fm-progress-wrap' });
    const progressBar = progressWrap.createDiv({ cls: 'fm-progress-bar' });

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const runBtn = btnRow.createEl('button', {
      text: t('migrateStart', { count: this.items.filter((i) => i.selected).length }),
      cls: 'mod-cta'
    });
    runBtn.onclick = async () => {
      const selected = this.items.filter((i) => i.selected);
      if (selected.length === 0) {
        new Notice(t('migrateSelectNotice'));
        return;
      }
      runBtn.disabled = true;
      backBtn.disabled = true;
      progressBox.style.display = 'block';

      await this.plugin.executeBatchMigrateSafely(
        selected,
        this.options,
        (cur, total, name) => {
          const pct = Math.round((cur / Math.max(1, total)) * 100);
          progressBar.style.width = `${pct}%`;
          progressText.setText(t('migrateProgress', { current: cur, total, name }));
        },
        (summary) => {
          this.step = 3;
          this.summary = summary;
          this.render();
        }
      );
    };
  }

  renderStep3(contentEl) {
    const t = (k, p) => this.plugin.t(k, p);
    contentEl.createEl('h3', { text: t('batchResultTitle') });

    const banner = contentEl.createDiv({ cls: 'fm-result-banner fm-result-banner-success' });
    banner.createDiv({ cls: 'fm-result-banner-title', text: t('batchResultTitle') });
    banner.createDiv({
      cls: 'fm-result-banner-desc',
      text: t('batchResultDesc', {
        count: this.summary?.count || 0,
        docs: this.summary?.docs || 0,
        trashed: this.summary?.trashed ? t('noticeBatchMigrateTrashedPart', { trashed: this.summary.trashed }) : ''
      })
    });

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const doneBtn = btnRow.createEl('button', { text: t('destBtnDone'), cls: 'mod-cta' });
    doneBtn.onclick = () => this.close();
  }

  onClose() {
    if (this.activeProgress) this.activeProgress.abort();
    this.contentEl.empty();
  }
}

/**
 * Vault Link Health Check Modal (404 & Dangling WikiLink Finder)
 */
class HealthCheckModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.step = 1;
    this.activeProgress = null;
    this.options = {
      checkWikiLinks: true,
      checkLocalMarkdown: true,
      checkRemote: false
    };
    this.totalDocsScanned = 0;
    this.issues = [];
    this.activeFilter = 'all';
    this.searchQuery = '';
  }

  onOpen() {
    this.render();
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('fm-wizard-modal');

    if (this.step === 1) {
      this.renderStep1(contentEl);
    } else {
      this.renderStep2(contentEl);
    }
  }

  renderStep1(contentEl) {
    const t = (k, p) => this.plugin.t(k, p);
    const header = contentEl.createDiv({ cls: 'fm-step-header' });
    header.createSpan({ text: t('stepOf', { current: 1, total: 2 }), cls: 'fm-step-badge' });
    header.createEl('h3', { text: t('healthStep1Title'), cls: 'fm-step-title' });

    contentEl.createEl('p', {
      text: t('healthStep1Desc'),
      style: 'font-size: 13px; color: var(--text-muted); margin-bottom: 14px;'
    });

    const box = contentEl.createDiv({ cls: 'fm-section-box' });
    box.createDiv({ text: t('healthScopeTitle'), cls: 'fm-section-title' });

    this.createCheckbox(box, t('healthCheckWiki'), 'checkWikiLinks');
    this.createCheckbox(box, t('healthCheckLocal'), 'checkLocalMarkdown');
    if (this.plugin?.isRemoteServerReady?.()) {
      this.createCheckbox(box, t('healthCheckRemote'), 'checkRemote');
    }

    const noticeBox = contentEl.createDiv({
      cls: 'fm-section-box',
      style: 'font-size: 12px; color: var(--text-muted); padding: 10px 14px;'
    });
    noticeBox.createDiv({
      text: t('healthScopeHint')
    });

    const progressWidget = createScanProgressWidget(contentEl, this.plugin);
    this.activeProgress = progressWidget;

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const cancelBtn = btnRow.createEl('button', { text: t('btnCancel') });
    cancelBtn.onclick = () => this.close();

    const startBtn = btnRow.createEl('button', { text: t('healthStartScan'), cls: 'mod-cta' });
    startBtn.onclick = async () => {
      startBtn.disabled = true;
      startBtn.setText(t('healthScanning'));
      progressWidget.show();
      try {
        const scanResult = await this.plugin.scanVaultLinkHealth(this.options, {
          signal: progressWidget.signal,
          onProgress: (cur, total, label) => progressWidget.update(cur, total, label)
        });
        this.issues = scanResult.issues;
        this.totalDocsScanned = scanResult.totalDocs;
        this.step = 2;
        this.render();
      } catch (err) {
        progressWidget.hide();
        new Notice(err.message === 'SCAN_ABORTED' ? this.plugin.t('scanCancelled') : '❌ Link health scan failed: ' + err.message);
        startBtn.disabled = false;
        startBtn.setText(t('healthStartScan'));
      }
    };
  }

  createCheckbox(parent, labelText, optKey) {
    const label = parent.createEl('label', { cls: 'fm-check-row' });
    const cb = label.createEl('input', { type: 'checkbox' });
    cb.checked = Boolean(this.options[optKey]);
    cb.onchange = () => {
      this.options[optKey] = cb.checked;
    };
    label.createSpan({ text: labelText });
  }

  renderStep2(contentEl) {
    const t = (k, p) => this.plugin.t(k, p);
    const wikiIssues = this.issues.filter((i) => i.category === 'wikilink');
    const localIssues = this.issues.filter((i) => i.category === 'local');
    const remoteIssues = this.issues.filter((i) => i.category === 'remote');

    const header = contentEl.createDiv({ cls: 'fm-step-header' });
    header.createSpan({ text: t('stepOf', { current: 2, total: 2 }), cls: 'fm-step-badge' });
    header.createEl('h3', {
      text: t('healthStep2Title', { docs: this.totalDocsScanned, issues: this.issues.length }),
      cls: 'fm-step-title'
    });

    const statGrid = contentEl.createDiv({ cls: 'fm-health-stat-grid' });
    const addStat = (num, label, color) => {
      const card = statGrid.createDiv({ cls: 'fm-health-stat-card' });
      const numEl = card.createDiv({ cls: 'fm-health-stat-num', text: String(num) });
      if (color) numEl.style.color = color;
      card.createDiv({ cls: 'fm-health-stat-label', text: label });
    };
    addStat(this.totalDocsScanned, t('healthStatNotes'));
    addStat(wikiIssues.length, t('healthStatWiki'), wikiIssues.length > 0 ? '#ef4444' : undefined);
    addStat(localIssues.length, t('healthStatLocal'), localIssues.length > 0 ? '#f59e0b' : undefined);
    addStat(remoteIssues.length, t('healthStatRemote'), remoteIssues.length > 0 ? '#3b82f6' : undefined);

    const toolbar = contentEl.createDiv({ cls: 'fm-toolbar-row' });
    const leftTools = toolbar.createDiv({ style: 'display:flex; gap:8px; align-items:center;' });
    const backBtn = leftTools.createEl('button', { text: t('healthRescan') });
    backBtn.onclick = () => {
      this.step = 1;
      this.render();
    };

    const exportBtn = toolbar.createEl('button', {
      text: t('btnExportReport'),
      cls: 'mod-cta'
    });
    exportBtn.onclick = async () => {
      await this.plugin.exportHealthReportToRoot(this.issues, this.totalDocsScanned);
    };

    if (this.issues.length === 0) {
      contentEl.createDiv({
        cls: 'fm-section-box',
        text: t('healthNoneFound'),
        style: 'text-align: center; padding: 36px 20px; font-weight: 500;'
      });
      const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
      const closeBtn = btnRow.createEl('button', { text: t('closeBtn') });
      closeBtn.onclick = () => this.close();
      return;
    }

    const filterRow = contentEl.createDiv({
      style: 'display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:10px; flex-wrap:wrap;'
    });
    const chipBox = filterRow.createDiv({ style: 'display:flex; gap:6px;' });
    const createChip = (id, label, count) => {
      const chip = chipBox.createEl('button', {
        text: `${label} (${count})`,
        cls: this.activeFilter === id ? 'mod-cta' : ''
      });
      chip.onclick = () => {
        this.activeFilter = id;
        this.renderStep2(contentEl);
      };
    };

    createChip('all', t('healthFilterAll'), this.issues.length);
    createChip('wikilink', t('healthStatWiki'), wikiIssues.length);
    createChip('local', t('healthStatLocal'), localIssues.length);
    createChip('remote', t('healthStatRemote'), remoteIssues.length);

    const searchInput = filterRow.createEl('input', {
      type: 'search',
      placeholder: t('healthSearchPlaceholder'),
      value: this.searchQuery,
      style: 'padding: 4px 10px; border-radius: 6px; border: 1px solid var(--background-modifier-border); min-width: 180px;'
    });
    searchInput.oninput = (e) => {
      this.searchQuery = e.target.value.toLowerCase();
      this.renderIssueList(listEl);
    };

    const listEl = contentEl.createDiv({ cls: 'fm-scroll-list', style: 'max-height: 380px;' });
    this.renderIssueList(listEl);

    const bottomRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const closeBtn = bottomRow.createEl('button', { text: t('closeBtn') });
    closeBtn.onclick = () => this.close();
  }

  renderIssueList(listEl) {
    const t = (k, p) => this.plugin.t(k, p);
    listEl.empty();

    let filtered = this.issues;
    if (this.activeFilter !== 'all') {
      filtered = filtered.filter((i) => i.category === this.activeFilter);
    }
    if (this.searchQuery) {
      filtered = filtered.filter(
        (i) =>
          i.sourcePath.toLowerCase().includes(this.searchQuery) ||
          i.target.toLowerCase().includes(this.searchQuery) ||
          (i.lineText && i.lineText.toLowerCase().includes(this.searchQuery))
      );
    }

    if (filtered.length === 0) {
      listEl.createDiv({
        cls: 'fm-section-box',
        text: t('healthNoMatches'),
        style: 'text-align: center; padding: 24px;'
      });
      return;
    }

    for (const item of filtered) {
      const row = listEl.createDiv({ cls: 'fm-list-item' });
      const leftCol = row.createDiv({
        style: 'display:flex; flex-direction:column; gap:4px; flex:1; overflow:hidden;'
      });

      const topMeta = leftCol.createDiv({ style: 'display:flex; align-items:center; gap:6px;' });
      let tagCls = 'fm-tag-error';
      let tagLabel = '🔴 Broken Link';
      if (item.category === 'wikilink') {
        tagCls = 'fm-tag-error';
        tagLabel = item.type === 'wikilink-embed' ? t('healthTagWikiEmbed') : t('healthTagDanglingNote');
      } else if (item.category === 'local') {
        tagCls = 'fm-tag-warning';
        tagLabel = item.type === 'local-embed' ? t('healthTagMissingImage') : t('healthTagMissingFile');
      } else if (item.category === 'remote') {
        tagCls = 'fm-tag-info';
        tagLabel = t('healthTagRemote404');
      }

      topMeta.createSpan({ text: tagLabel, cls: `fm-tag ${tagCls}` });
      topMeta.createEl('code', { text: item.target, style: 'font-size: 12px; font-weight: 600;' });
      topMeta.createSpan({
        text: t('healthLine', { line: item.line }),
        style: 'font-size: 11px; color: var(--text-muted); margin-left: auto;'
      });

      const noteRef = leftCol.createDiv({
        style: 'font-size: 12px; color: var(--text-muted); display:flex; align-items:center; gap:4px;'
      });
      noteRef.createSpan({ text: t('healthInNote', { path: item.sourcePath }) });

      if (item.lineText) {
        leftCol.createDiv({
          text: item.lineText,
          cls: 'fm-health-context-quote'
        });
      }

      const openBtn = row.createEl('button', {
        text: t('healthJumpToLine'),
        style: 'flex-shrink:0; align-self:center;'
      });
      openBtn.onclick = async () => {
        await this.plugin.openNoteAtLine(item.sourcePath, item.line);
      };
    }
  }

  onClose() {
    if (this.activeProgress) this.activeProgress.abort();
    this.contentEl.empty();
  }
}

/**
 * Vault Wrapped & Storage Analytics Dashboard Modal
 */
class VaultAnalyticsModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.stats = null;
  }

  async onOpen() {
    const t = (k, p) => this.plugin.t(k, p);
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('fm-wizard-modal');

    const header = contentEl.createDiv({ cls: 'fm-step-header' });
    header.createSpan({ text: t('analyticsBadge'), cls: 'fm-step-badge' });
    header.createEl('h3', { text: t('analyticsTitle'), cls: 'fm-step-title' });

    const loadingEl = contentEl.createDiv({
      cls: 'fm-section-box',
      text: t('analyticsLoading'),
      style: 'text-align: center; padding: 32px 20px;'
    });

    try {
      this.stats = await this.plugin.scanVaultAnalytics();
      loadingEl.remove();
      this.renderDashboard(contentEl);
    } catch (err) {
      loadingEl.setText('❌ Failed to compute vault analytics: ' + err.message);
    }
  }

  renderDashboard(contentEl) {
    const t = (k, p) => this.plugin.t(k, p);
    const s = this.stats;

    const statGrid = contentEl.createDiv({ cls: 'fm-health-stat-grid' });
    const addStat = (num, label, color) => {
      const card = statGrid.createDiv({ cls: 'fm-health-stat-card' });
      const numEl = card.createDiv({ cls: 'fm-health-stat-num', text: String(num) });
      if (color) numEl.style.color = color;
      card.createDiv({ cls: 'fm-health-stat-label', text: label });
    };

    addStat(s.noteCount + s.canvasCount, `${t('analyticsStatNotes')} (${s.noteCount} md / ${s.canvasCount} canvas)`);
    addStat(s.totalWords.toLocaleString(), t('analyticsStatWords'), '#10b981');
    addStat(s.totalInternalLinks.toLocaleString(), t('analyticsStatLinks'), '#3b82f6');
    addStat(
      formatBytes(s.local.totalBytes + s.remote.rawBytes),
      t('analyticsStatStorage'),
      '#8b5cf6'
    );

    const storageBox = contentEl.createDiv({ cls: 'fm-section-box' });
    storageBox.createDiv({ text: t('analyticsStorageComparison'), cls: 'fm-section-title' });

    const totalCombinedBytes = Math.max(1, s.local.totalBytes + s.remote.rawBytes);
    const localPct = Math.round((s.local.totalBytes / totalCombinedBytes) * 100);
    const remotePct = 100 - localPct;

    const summaryRow = storageBox.createDiv({
      style: 'display:grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 8px;'
    });

    const localCard = summaryRow.createDiv({
      style: 'padding: 12px; border-radius: 8px; background: var(--background-primary); border: 1px solid var(--background-modifier-border);'
    });
    localCard.createDiv({ text: t('analyticsLocalVault'), style: 'font-weight: 600; font-size: 13px;' });
    localCard.createDiv({
      text: `${s.local.totalCount} · ${formatBytes(s.local.totalBytes)} (${localPct}%)`,
      style: 'font-size: 15px; font-weight: 700; margin-top: 4px; color: var(--text-accent);'
    });
    localCard.createDiv({
      text: t('analyticsLocalStats', {
        img: s.local.imageCount,
        imgBytes: formatBytes(s.local.imageBytes),
        aud: s.local.audioCount,
        audBytes: formatBytes(s.local.audioBytes),
        oth: s.local.otherCount,
        othBytes: formatBytes(s.local.otherBytes)
      }),
      style: 'font-size: 11px; color: var(--text-muted); margin-top: 6px;'
    });

    const remoteCard = summaryRow.createDiv({
      style: 'padding: 12px; border-radius: 8px; background: var(--background-primary); border: 1px solid var(--background-modifier-border);'
    });
    remoteCard.createDiv({ text: t('analyticsRemoteServer'), style: 'font-weight: 600; font-size: 13px;' });
    remoteCard.createDiv({
      text: `${s.remote.totalCount} · ${formatBytes(s.remote.rawBytes)} (${remotePct}%)`,
      style: 'font-size: 15px; font-weight: 700; margin-top: 4px; color: #10b981;'
    });
    remoteCard.createDiv({
      text: t('analyticsRemoteStats', {
        cache: formatBytes(s.remote.cacheBytes),
        locked: s.remote.lockedCount
      }),
      style: 'font-size: 11px; color: var(--text-muted); margin-top: 6px;'
    });

    if (s.topLargestAttachments.length > 0) {
      const topBox = contentEl.createDiv({ cls: 'fm-section-box' });
      topBox.createDiv({ text: t('analyticsTopLargest'), cls: 'fm-section-title' });
      const listEl = topBox.createDiv({ cls: 'fm-scroll-list', style: 'max-height: 210px;' });
      for (const item of s.topLargestAttachments) {
        const row = listEl.createDiv({ cls: 'fm-list-item' });
        const badge = item.source === 'local' ? t('analyticsBadgeLocal') : t('analyticsBadgeRemote');
        row.createSpan({
          text: `${badge} · ${item.path}`,
          style: 'font-size: 12px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;'
        });
        row.createSpan({
          text: formatBytes(item.size),
          style: 'font-size: 12px; font-weight: 600; color: var(--text-muted); flex-shrink: 0;'
        });
      }
    }

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const exportBtn = btnRow.createEl('button', {
      text: t('analyticsExportReport'),
      cls: 'mod-cta'
    });
    exportBtn.onclick = async () => {
      await this.plugin.exportAnalyticsReportToRoot(s);
    };

    const closeBtn = btnRow.createEl('button', { text: t('closeBtn') });
    closeBtn.onclick = () => this.close();
  }

  onClose() {
    this.contentEl.empty();
  }
}

/**
 * Remote Asset Gallery & Media Album Modal
 * Enables browsing, searching, previewing, and managing remote files directly inside Obsidian
 */
class RemoteGalleryModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.items = [];
    this.loading = true;
    this.error = null;
    this.searchQuery = '';
    this.selectedBucket = 'all';
    this.selectedType = 'all';
    this.insertMode = this.plugin?.settings?.insertOptimizedLinkOnUpload ? 'webp' : 'raw';
  }

  t(k, p) {
    return this.plugin ? this.plugin.t(k, p) : k;
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.addClass('fm-gallery-dialog');
    contentEl.addClass('fm-wizard-modal');
    contentEl.addClass('fm-gallery-modal');
    this.render();
    await this.loadData();
  }

  async loadData() {
    this.loading = true;
    this.error = null;
    this.render();
    try {
      this.items = await this.plugin.fetchRemoteFileList();
    } catch (err) {
      this.error = err.message || String(err);
    } finally {
      this.loading = false;
      this.render();
    }
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();

    const header = contentEl.createDiv({ cls: 'fm-step-header' });
    header.createEl('h3', { text: this.t('galleryTitle'), cls: 'fm-step-title' });

    if (this.loading) {
      const box = contentEl.createDiv({ cls: 'fm-section-box', style: 'text-align:center; padding:40px 16px;' });
      box.createDiv({ text: this.t('galleryLoading'), style: 'font-size:14px; color:var(--text-accent);' });
      return;
    }

    if (this.error) {
      const box = contentEl.createDiv({ cls: 'fm-result-banner fm-result-banner-error' });
      box.createDiv({ cls: 'fm-result-banner-title', text: this.t('galleryLoadFail', { err: this.error }) });
      const retryBtn = box.createEl('button', { text: this.t('galleryBtnRefresh'), cls: 'fm-mini-btn', style: 'margin-top:8px;' });
      retryBtn.onclick = () => this.loadData();
      return;
    }

    // Build filter buckets
    const bucketSet = new Set();
    let totalBytes = 0;
    for (const item of this.items) {
      bucketSet.add(`${item.year}/${item.month}`);
      totalBytes += (item.size || 0);
    }
    const buckets = Array.from(bucketSet).sort().reverse();

    // Toolbar
    const toolbar = contentEl.createDiv({ cls: 'fm-gallery-toolbar' });
    const leftControls = toolbar.createDiv({ cls: 'fm-gallery-search-row' });

    // Search input
    const searchInput = leftControls.createEl('input', {
      type: 'text',
      placeholder: this.t('gallerySearchPlaceholder'),
      value: this.searchQuery,
      cls: 'fm-gallery-search'
    });
    searchInput.oninput = (e) => {
      this.searchQuery = e.target.value.trim().toLowerCase();
      this.renderGrid(gridContainer, countLabel);
    };

    const refreshBtn = leftControls.createEl('button', {
      cls: 'fm-icon-button',
      attr: { title: this.t('galleryBtnRefresh'), 'aria-label': this.t('galleryBtnRefresh') }
    });
    setIcon(refreshBtn, 'refresh-cw');
    refreshBtn.onclick = () => this.loadData();

    const filters = toolbar.createDiv({ cls: 'fm-gallery-filter-row' });
    const bucketSelect = filters.createEl('select', { attr: { 'aria-label': this.t('galleryFilterAllTime') } });
    bucketSelect.createEl('option', { value: 'all', text: this.t('galleryFilterAllTime') });
    for (const b of buckets) {
      bucketSelect.createEl('option', { value: b, text: b });
    }
    bucketSelect.value = this.selectedBucket;
    bucketSelect.onchange = (e) => {
      this.selectedBucket = e.target.value;
      this.renderGrid(gridContainer, countLabel);
    };

    // Type filter dropdown
    const typeSelect = filters.createEl('select', { attr: { 'aria-label': this.t('galleryFilterAllTypes') } });
    typeSelect.createEl('option', { value: 'all', text: this.t('galleryFilterAllTypes') });
    typeSelect.createEl('option', { value: 'image', text: this.t('galleryFilterImage') });
    typeSelect.createEl('option', { value: 'audio', text: this.t('galleryFilterAudio') });
    typeSelect.createEl('option', { value: 'other', text: this.t('galleryFilterOther') });
    typeSelect.value = this.selectedType;
    typeSelect.onchange = (e) => {
      this.selectedType = e.target.value;
      this.renderGrid(gridContainer, countLabel);
    };

    const modeSelect = filters.createEl('select', { attr: { 'aria-label': this.t('galleryLinkFormat') } });
    modeSelect.createEl('option', { value: 'raw', text: this.t('galleryModeRaw') });
    modeSelect.createEl('option', { value: 'webp', text: this.t('galleryModeWebp') });
    modeSelect.value = this.insertMode;
    modeSelect.onchange = async () => {
      this.insertMode = modeSelect.value;
      if (this.plugin) {
        this.plugin.settings.insertOptimizedLinkOnUpload = (this.insertMode === 'webp');
        await this.plugin.saveSettings();
      }
      this.renderGrid(gridContainer, countLabel);
    };

    const countLabel = toolbar.createSpan({ cls: 'fm-gallery-stats' });

    // Grid container
    const gridContainer = contentEl.createDiv({ cls: 'fm-gallery-grid' });
    this.renderGrid(gridContainer, countLabel);

  }

  filterItems() {
    return this.items.filter((item) => {
      if (this.selectedBucket !== 'all' && `${item.year}/${item.month}` !== this.selectedBucket) {
        return false;
      }
      if (this.selectedType !== 'all') {
        const grp = getFileTypeGroup(getExt(item.name || item.filename));
        if (grp !== this.selectedType) return false;
      }
      if (this.searchQuery) {
        const fn = (item.name || item.filename || '').toLowerCase();
        if (!fn.includes(this.searchQuery)) return false;
      }
      return true;
    });
  }

  renderGrid(containerEl, countLabel) {
    containerEl.empty();
    const filtered = this.filterItems();
    const totalBytes = filtered.reduce((s, i) => s + (i.size || 0), 0);

    if (countLabel) {
      countLabel.setText(this.t('galleryStats', { count: filtered.length, size: formatBytes(totalBytes) }));
    }

    if (filtered.length === 0) {
      containerEl.createDiv({
        cls: 'fm-section-box',
        text: this.t('galleryEmpty'),
        style: 'grid-column: 1 / -1; text-align: center; padding: 40px 16px; color: var(--text-muted);'
      });
      return;
    }

    for (const item of filtered) {
      const card = containerEl.createDiv({ cls: 'fm-gallery-card' });
      const thumbWrap = card.createDiv({ cls: 'fm-gallery-thumb-wrap' });

      const ext = getExt(item.name || item.filename);
      const isImg = IMAGE_EXTS.has(ext);

      if (isImg) {
        const img = thumbWrap.createEl('img', {
          cls: 'fm-gallery-thumb',
          attr: {
            loading: 'lazy',
            src: item.pubUrl || item.rawUrl,
            alt: item.name || item.filename
          }
        });
        img.onerror = () => {
          img.style.display = 'none';
          thumbWrap.createSpan({ text: '🖼️', style: 'font-size:32px;' });
        };
      } else {
        thumbWrap.createDiv({
          text: ext.toUpperCase(),
          style: 'font-size: 16px; font-weight: 700; color: var(--text-muted);'
        });
      }

      if (item.locked) {
        const lockBadge = thumbWrap.createSpan({
          cls: 'fm-gallery-lock-badge',
          text: '🔒',
          attr: { title: this.t('galleryBtnUnlock') }
        });
        lockBadge.onclick = async (e) => {
          e.stopPropagation();
          try {
            await this.plugin.toggleRemoteFileLock(item.year, item.month, item.filename, false);
            item.locked = false;
            this.renderGrid(containerEl, countLabel);
          } catch (err) {
            new Notice(this.t('previewLockFailed', { err: err.message }));
          }
        };
      }

      thumbWrap.onclick = () => {
        new ImageLightboxModal(this.app, this.plugin, {
          source: 'remote',
          name: item.name || item.filename,
          displayPath: `${item.year}/${item.month}/${item.filename}`,
          size: item.size,
          rawObj: item
        }, (action, target) => {
          if (action === 'deleted') {
            this.items = this.items.filter((i) => !(i.year === target.year && i.month === target.month && i.filename === target.filename));
          }
          this.renderGrid(containerEl, countLabel);
        }).open();
      };

      const info = card.createDiv({ cls: 'fm-gallery-info' });
      info.createDiv({
        cls: 'fm-gallery-name',
        text: item.name || item.filename,
        attr: { title: item.name || item.filename }
      });

      const meta = info.createDiv({ cls: 'fm-gallery-meta' });
      meta.createSpan({ text: `${item.year}/${item.month}` });
      meta.createSpan({ text: formatBytes(item.size) });

      const actions = card.createDiv({ cls: 'fm-gallery-actions' });

      // Clean single action: 📝 插入笔记
      const isWebpMode = this.insertMode === 'webp' && item.pubUrl;
      const insertTargetUrl = isWebpMode ? item.pubUrl : (item.rawUrl || item.pubUrl);
      const fn = item.name || item.filename;

      const insertBtn = actions.createEl('button', {
        cls: 'fm-gallery-insert-btn mod-cta',
        attr: { title: isWebpMode ? this.t('galleryInsertedWebp') : this.t('galleryInsertedRaw') }
      });
      setIcon(insertBtn.createSpan(), 'file-input');
      insertBtn.createSpan({ text: this.t('galleryBtnInsert') });
      insertBtn.onmousedown = (e) => {
        // Prevent clicking button from blurring or moving cursor in Markdown editor
        e.preventDefault();
      };
      insertBtn.onclick = () => {
        const mdSnippet = isImg ? `![${fn}](${insertTargetUrl})\n` : `[${fn}](${insertTargetUrl})\n`;
        const noticeMsg = isWebpMode ? this.t('galleryInsertedWebp') : this.t('galleryInsertedRaw');
        this.plugin?.insertMarkdownToActiveEditor(mdSnippet, noticeMsg);
      };
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

/**
 * Remote Media Gallery Sidebar View (Bilingual zh-CN / en)
 */
class RemoteGalleryView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.items = [];
    this.loading = true;
    this.error = null;
    this.searchQuery = '';
    this.selectedBucket = 'all';
    this.selectedType = 'all';
    this.layoutMode = 'list'; // 'grid' | 'list'
    this.insertMode = this.plugin?.settings?.insertOptimizedLinkOnUpload ? 'webp' : 'raw';
  }

  getViewType() {
    return VIEW_TYPE_REMOTE_GALLERY;
  }

  getDisplayText() {
    return this.t('galleryViewTitle');
  }

  getIcon() {
    return 'image';
  }

  t(k, p) {
    return this.plugin ? this.plugin.t(k, p) : k;
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('fm-gallery-view-container');
    this.render();
    await this.loadData();
  }

  async loadData() {
    this.loading = true;
    this.error = null;
    this.render();
    try {
      this.items = await this.plugin.fetchRemoteFileList();
    } catch (err) {
      this.error = err.message || String(err);
    } finally {
      this.loading = false;
      this.render();
    }
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();

    if (this.loading) {
      const box = contentEl.createDiv({ cls: 'fm-section-box', style: 'text-align:center; padding:30px 12px;' });
      box.createDiv({ text: this.t('galleryLoading'), style: 'font-size:12px; color:var(--text-accent);' });
      return;
    }

    if (this.error) {
      const box = contentEl.createDiv({ cls: 'fm-result-banner fm-result-banner-error', style: 'margin:8px 0;' });
      box.createDiv({ cls: 'fm-result-banner-title', text: this.t('galleryLoadFail', { err: this.error }), style: 'font-size:12px;' });
      const retryBtn = box.createEl('button', { text: this.t('galleryBtnRefresh'), cls: 'fm-mini-btn', style: 'margin-top:6px;' });
      retryBtn.onclick = () => this.loadData();
      return;
    }

    // Build filter buckets
    const bucketSet = new Set();
    for (const item of this.items) {
      bucketSet.add(`${item.year}/${item.month}`);
    }
    const buckets = Array.from(bucketSet).sort().reverse();

    // Keep controls in distinct rows so narrow Obsidian sidebars never need horizontal scrolling.
    const toolbar = contentEl.createDiv({ cls: 'fm-gallery-toolbar' });

    // Row 1: Search input + refresh + layout switch
    const row1 = toolbar.createDiv({ cls: 'fm-gallery-toolbar-row' });
    const searchInput = row1.createEl('input', {
      type: 'text',
      placeholder: this.t('gallerySearchPlaceholder'),
      value: this.searchQuery,
      cls: 'fm-gallery-search'
    });
    searchInput.oninput = (e) => {
      this.searchQuery = e.target.value.trim().toLowerCase();
      this.renderGrid(gridContainer, countLabel);
    };

    const layoutBtn = row1.createEl('button', {
      cls: 'fm-icon-button',
      attr: { title: this.layoutMode === 'list' ? this.t('galleryLayoutGrid') : this.t('galleryLayoutList'), 'aria-label': this.layoutMode === 'list' ? this.t('galleryLayoutGrid') : this.t('galleryLayoutList') }
    });
    setIcon(layoutBtn, this.layoutMode === 'list' ? 'layout-grid' : 'list');
    layoutBtn.onclick = () => {
      this.layoutMode = this.layoutMode === 'list' ? 'grid' : 'list';
      setIcon(layoutBtn, this.layoutMode === 'list' ? 'layout-grid' : 'list');
      const label = this.layoutMode === 'list' ? this.t('galleryLayoutGrid') : this.t('galleryLayoutList');
      layoutBtn.setAttribute('title', label);
      layoutBtn.setAttribute('aria-label', label);
      this.renderGrid(gridContainer, countLabel);
    };

    const refreshBtn = row1.createEl('button', {
      cls: 'fm-icon-button',
      attr: { title: this.t('galleryBtnRefresh'), 'aria-label': this.t('galleryBtnRefresh') }
    });
    setIcon(refreshBtn, 'refresh-cw');
    refreshBtn.onclick = () => this.loadData();

    const row2 = toolbar.createDiv({ cls: 'fm-gallery-toolbar-row fm-gallery-filter-fields' });
    const folderField = row2.createDiv({ cls: 'fm-gallery-filter-field' });
    folderField.createEl('label', { text: this.t('galleryFolderLabel') });
    const bucketSelect = folderField.createEl('select', { attr: { 'aria-label': this.t('galleryFolderLabel') } });
    bucketSelect.createEl('option', { value: 'all', text: this.t('galleryFilterAllTime') });
    for (const b of buckets) {
      bucketSelect.createEl('option', { value: b, text: b });
    }
    bucketSelect.value = this.selectedBucket;
    bucketSelect.onchange = (e) => {
      this.selectedBucket = e.target.value;
      this.renderGrid(gridContainer, countLabel);
    };

    const typeField = row2.createDiv({ cls: 'fm-gallery-filter-field' });
    typeField.createEl('label', { text: this.t('galleryTypeLabel') });
    const typeSelect = typeField.createEl('select', { attr: { 'aria-label': this.t('galleryTypeLabel') } });
    typeSelect.createEl('option', { value: 'all', text: this.t('galleryFilterAllTypes') });
    typeSelect.createEl('option', { value: 'image', text: this.t('galleryFilterImage') });
    typeSelect.createEl('option', { value: 'audio', text: this.t('galleryFilterAudio') });
    typeSelect.createEl('option', { value: 'other', text: this.t('galleryFilterOther') });
    typeSelect.value = this.selectedType;
    typeSelect.onchange = (e) => {
      this.selectedType = e.target.value;
      this.renderGrid(gridContainer, countLabel);
    };

    const row3 = toolbar.createDiv({ cls: 'fm-gallery-summary-row' });
    const countLabel = row3.createDiv({ cls: 'fm-gallery-stats' });
    const formatControl = row3.createDiv({ cls: 'fm-gallery-format-control' });
    formatControl.createSpan({ text: this.t('galleryInsertFormatLabel') });
    const modeGroup = formatControl.createDiv({ cls: 'fm-gallery-mode-group', attr: { role: 'group', 'aria-label': this.t('galleryLinkFormat') } });
    const modeButtons = ['raw', 'webp'].map((mode) => {
      const btn = modeGroup.createEl('button', {
        text: this.t(mode === 'raw' ? 'galleryModeRaw' : 'galleryModeWebp'),
        cls: this.insertMode === mode ? 'is-active' : '',
        attr: { type: 'button', 'aria-pressed': String(this.insertMode === mode) }
      });
      btn.onclick = async () => {
        this.insertMode = mode;
        modeButtons.forEach((button, index) => {
          const active = ['raw', 'webp'][index] === mode;
          button.toggleClass('is-active', active);
          button.setAttribute('aria-pressed', String(active));
        });
        if (this.plugin) {
          this.plugin.settings.insertOptimizedLinkOnUpload = mode === 'webp';
          await this.plugin.saveSettings();
        }
        this.renderGrid(gridContainer, countLabel);
      };
      return btn;
    });

    // Grid container
    const gridContainer = contentEl.createDiv({ cls: 'fm-gallery-grid' + (this.layoutMode === 'list' ? ' is-list' : '') });
    this.renderGrid(gridContainer, countLabel);
  }

  filterItems() {
    return this.items.filter((item) => {
      if (this.selectedBucket !== 'all' && `${item.year}/${item.month}` !== this.selectedBucket) {
        return false;
      }
      if (this.selectedType !== 'all') {
        const grp = getFileTypeGroup(getExt(item.name || item.filename));
        if (grp !== this.selectedType) return false;
      }
      if (this.searchQuery) {
        const fn = (item.name || item.filename || '').toLowerCase();
        if (!fn.includes(this.searchQuery)) return false;
      }
      return true;
    });
  }

  renderGrid(containerEl, countLabel) {
    containerEl.empty();
    if (this.layoutMode === 'list') {
      containerEl.addClass('is-list');
    } else {
      containerEl.removeClass('is-list');
    }

    const filtered = this.filterItems();
    const totalBytes = filtered.reduce((s, i) => s + (i.size || 0), 0);

    if (countLabel) {
      countLabel.empty();
      countLabel.createSpan({ cls: 'fm-gallery-stats-count', text: this.t('galleryFileCount', { count: filtered.length }) });
      countLabel.createSpan({ cls: 'fm-gallery-stats-size', text: this.t('galleryTotalSize', { size: formatBytes(totalBytes) }) });
    }

    if (filtered.length === 0) {
      containerEl.createDiv({
        cls: 'fm-section-box',
        text: this.t('galleryEmpty'),
        style: 'grid-column: 1 / -1; text-align: center; padding: 30px 10px; color: var(--text-muted); font-size:12px;'
      });
      return;
    }

    for (const item of filtered) {
      const card = containerEl.createDiv({ cls: 'fm-gallery-card' + (this.layoutMode === 'list' ? ' is-list' : '') });
      const thumbWrap = card.createDiv({ cls: 'fm-gallery-thumb-wrap' });

      const ext = getExt(item.name || item.filename);
      const isImg = IMAGE_EXTS.has(ext);

      if (isImg) {
        const img = thumbWrap.createEl('img', {
          cls: 'fm-gallery-thumb',
          attr: {
            loading: 'lazy',
            src: item.pubUrl || item.rawUrl,
            alt: item.name || item.filename
          }
        });
        img.onerror = () => {
          img.style.display = 'none';
          thumbWrap.createSpan({ text: '🖼️', style: 'font-size:24px;' });
        };
      } else {
        thumbWrap.createDiv({
          text: ext.toUpperCase(),
          style: 'font-size: 14px; font-weight: 700; color: var(--text-muted);'
        });
      }

      // Lock badge (click to unlock if locked and not protected)
      if (item.locked) {
        const lockBadge = thumbWrap.createSpan({
          cls: 'fm-gallery-lock-badge',
          text: '🔒',
          attr: { title: this.t('galleryBtnUnlock') }
        });
        lockBadge.onclick = async (e) => {
          e.stopPropagation();
          try {
            await this.plugin.toggleRemoteFileLock(item.year, item.month, item.filename, false);
            item.locked = false;
            this.renderGrid(containerEl, countLabel);
          } catch (err) {
            new Notice(this.t('previewLockFailed', { err: err.message }));
          }
        };
      }

      thumbWrap.onclick = () => {
        new ImageLightboxModal(this.app, this.plugin, {
          source: 'remote',
          name: item.name || item.filename,
          displayPath: `${item.year}/${item.month}/${item.filename}`,
          size: item.size,
          rawObj: item
        }, (action, target) => {
          if (action === 'deleted') {
            this.items = this.items.filter((i) => !(i.year === target.year && i.month === target.month && i.filename === target.filename));
          }
          this.renderGrid(containerEl, countLabel);
        }).open();
      };
      thumbWrap.setAttribute('role', 'button');
      thumbWrap.setAttribute('tabindex', '0');
      thumbWrap.setAttribute('aria-label', this.t('galleryBtnPreview'));
      thumbWrap.onkeydown = (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          thumbWrap.click();
        }
      };

      const info = card.createDiv({ cls: 'fm-gallery-info' });
      info.createDiv({
        cls: 'fm-gallery-name',
        text: item.name || item.filename,
        attr: { title: item.name || item.filename }
      });

      const meta = info.createDiv({ cls: 'fm-gallery-meta' });
      meta.createSpan({ text: `${item.year}/${item.month} · ${formatBytes(item.size)}` });

      const actions = card.createDiv({ cls: 'fm-gallery-actions' });

      // Clean single action: 📝 插入笔记
      const isWebpMode = this.insertMode === 'webp' && item.pubUrl;
      const insertTargetUrl = isWebpMode ? item.pubUrl : (item.rawUrl || item.pubUrl);
      const fn = item.name || item.filename;

      const insertBtn = actions.createEl('button', {
        cls: 'fm-gallery-insert-btn mod-cta',
        attr: { title: isWebpMode ? this.t('galleryInsertedWebp') : this.t('galleryInsertedRaw') }
      });
      setIcon(insertBtn.createSpan(), 'file-input');
      insertBtn.createSpan({ cls: 'fm-gallery-insert-label', text: this.t('galleryBtnInsert') });
      insertBtn.setAttribute('aria-label', this.t('galleryBtnInsert'));
      insertBtn.onmousedown = (e) => {
        // Prevent clicking button from blurring or moving cursor in Markdown editor
        e.preventDefault();
      };
      insertBtn.onclick = () => {
        const mdSnippet = isImg ? `![${fn}](${insertTargetUrl})\n` : `[${fn}](${insertTargetUrl})\n`;
        const noticeMsg = isWebpMode ? this.t('galleryInsertedWebp') : this.t('galleryInsertedRaw');
        this.plugin?.insertMarkdownToActiveEditor(mdSnippet, noticeMsg);
      };
    }
  }

  async onClose() {
    this.contentEl.empty();
  }
}

/**
 * Quick Action Hub Modal opened from the left sidebar ribbon button (Bilingual zh-CN / en)
 */
class FileMasterHubModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.addClass('fm-hub-dialog');
    contentEl.addClass('fm-wizard-modal');
    contentEl.addClass('fm-hub-content');

    const t = (key, params) => this.plugin.t(key, params);

    const header = contentEl.createDiv({ cls: 'fm-hub-header' });
    const heading = header.createDiv();
    heading.createEl('h3', { text: t('hubTitle'), cls: 'fm-step-title' });
    heading.createEl('p', { text: t('hubSubtitle') });
    const currentEff = this.plugin.getEffectiveLanguage();
    const langBtn = header.createEl('button', {
      text: currentEff === 'en' ? '简体中文' : 'English',
      cls: 'fm-hub-language',
      attr: { title: t('langName') }
    });
    langBtn.onclick = async () => {
      this.plugin.settings.language = currentEff === 'en' ? 'zh' : 'en';
      await this.plugin.saveSettings();
      this.plugin.onLanguageChange();
      this.onOpen();
    };

    const isRemote = Boolean(this.plugin?.isRemoteServerReady?.());

    const govActions = [
      {
        icon: 'link',
        title: t('actHealthTitle'),
        desc: t('actHealthDesc'),
        run: () => this.plugin.openModalSafely(new HealthCheckModal(this.app, this.plugin))
      },
      {
        icon: 'files',
        title: t('actDupTitle'),
        desc: t('actDupDesc'),
        run: () => this.plugin.openModalSafely(new DuplicateWizardModal(this.app, this.plugin))
      },
      {
        icon: 'search',
        title: t('actOrphanTitle'),
        desc: t('actOrphanDesc'),
        run: () => this.plugin.openModalSafely(new OrphanWizardModal(this.app, this.plugin))
      }
    ];

    govActions.push({
      icon: 'bar-chart-3',
      title: t('actAnalyticsTitle'),
      desc: t('actAnalyticsDesc'),
      run: () => this.plugin.openModalSafely(new VaultAnalyticsModal(this.app, this.plugin))
    });

    const sections = [];
    if (isRemote) {
      sections.push({
        category: t('catFiles'),
        actions: [
          {
            icon: 'image',
            title: t('actRemoteGalleryTitle'),
            desc: t('actRemoteGalleryDesc'),
            run: () => this.plugin.openModalSafely(new RemoteGalleryModal(this.app, this.plugin))
          },
          {
            icon: 'panel-right',
            title: t('actRemoteGalleryViewTitle'),
            desc: t('actRemoteGalleryViewDesc'),
            run: () => {
              this.close();
              this.plugin.activateGalleryView();
            }
          },
          {
            icon: 'cloud-upload',
            title: t('actMigrateTitle'),
            desc: t('actMigrateDesc'),
            run: () => this.plugin.openModalSafely(new BatchMigrateWizardModal(this.app, this.plugin))
          }
        ]
      });
    }

    sections.push({ category: t('catGovernance'), actions: govActions });

    if (isRemote) {
      sections.push({
        category: t('catActiveNote'),
        actions: [
          {
            icon: 'upload',
            title: t('actNoteUpTitle'),
            desc: t('actNoteUpDesc'),
            run: () => this.plugin.migrateActiveNoteAttachments()
          },
          {
            icon: 'download',
            title: t('actNoteDownTitle'),
            desc: t('actNoteDownDesc'),
            run: () => this.plugin.downloadActiveNoteRemoteAttachments()
          },
          {
            icon: 'copy',
            title: t('actNoteAstroTitle'),
            desc: t('actNoteAstroDesc'),
            run: () => this.plugin.copyActiveNoteForAstro()
          }
        ]
      });
    }

    sections.push({
      category: t('catSettings'),
      actions: [
        {
          icon: 'settings-2',
          title: t('actOpenSettingsTitle'),
          desc: t('actOpenSettingsDesc'),
          run: () => {
            if (this.app.setting) {
              this.app.setting.open();
              this.app.setting.openTabById(this.plugin.manifest.id);
            }
          }
        }
      ]
    });

    for (const sec of sections) {
      const section = contentEl.createDiv({ cls: 'fm-hub-section' });
      section.createEl('h4', { text: sec.category, cls: 'fm-section-title' });
      const grid = section.createDiv({ cls: 'fm-hub-list' });
      for (const act of sec.actions) {
        const card = grid.createEl('button', { cls: 'fm-hub-card', type: 'button' });
        const left = card.createDiv({ cls: 'fm-hub-card-left' });
        const icon = left.createSpan({ cls: 'fm-hub-card-icon' });
        setIcon(icon, act.icon);
        const textCol = left.createDiv({ cls: 'fm-hub-card-text' });
        textCol.createDiv({ text: act.title, cls: 'fm-hub-card-title' });
        textCol.createDiv({ text: act.desc, cls: 'fm-hub-card-desc' });
        const arrow = card.createSpan({ cls: 'fm-hub-card-arrow' });
        setIcon(arrow, 'arrow-up-right');

        card.onclick = () => {
          this.close();
          act.run();
        };
      }
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
