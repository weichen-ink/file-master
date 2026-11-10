/**
 * Helper to return from a module modal back to the main File Master Hub modal
 * when the modal was opened from the Hub; otherwise simply closes the modal.
 */
function returnToHub(modal) {
  modal.close();
  if (!modal.fromHub) return;
  if (modal.plugin && typeof modal.plugin.openModalSafely === 'function') {
    modal.plugin.openModalSafely(new FileMasterHubModal(modal.app, modal.plugin));
  } else if (modal.app && modal.plugin) {
    new FileMasterHubModal(modal.app, modal.plugin).open();
  }
}

/**
 * Helper to translate raw HTTP/server error strings into localized UI descriptions
 */
function formatFriendlyError(modal, rawErr) {
  const errStr = String(rawErr || '').trim();
  const t = (k, p) => (modal && typeof modal.t === 'function' ? modal.t(k, p) : modal?.plugin?.t ? modal.plugin.t(k, p) : errStr);
  if (/file too large|too large|413/i.test(errStr)) {
    return t('activeNoteFailedTooLarge');
  }
  if (/401|unauthorized|invalid.*token/i.test(errStr)) {
    return t('activeNoteFailedAuth');
  }
  if (/404|not found/i.test(errStr)) {
    return t('activeNoteFailedNotFound');
  }
  if (/network|fetch|econnrefused|offline/i.test(errStr)) {
    return t('activeNoteFailedNetwork');
  }
  return errStr;
}

/**
 * Helper to create a real-time scan progress bar + cancel button inside wizard modals
 */
function createScanProgressWidget(contentEl, plugin) {
  const abortController = new AbortController();
  const box = contentEl.createDiv({
    cls: 'fm-section-box fm-scan-progress-box',
    attr: { style: 'display:none; margin-top:10px; border-color: rgba(59, 130, 246, 0.45);' }
  });
  box.style.display = 'none';
  const topRow = box.createDiv({
    cls: 'fm-scan-progress-top',
    attr: { style: 'display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:8px; width:100%;' }
  });
  const statusText = topRow.createSpan({
    text: plugin ? plugin.t('scanPreparing') : '⏳ Preparing scan...',
    cls: 'fm-scan-progress-text',
    attr: { style: 'font-size:12px; color:var(--text-accent); font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1;' }
  });
  const cancelScanBtn = topRow.createEl('button', {
    text: plugin ? plugin.t('btnCancelScan') : '⏹ Cancel Scan',
    cls: 'fm-mini-btn mod-warning fm-scan-cancel-btn',
    attr: { style: 'flex-shrink:0; margin-left:auto;' }
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
    this.options = options || {};   // { askLocation, fixedLocation, promptRename, plugin, editor, activeFile }
    this.callback = callback;
    this.plugin = this.options.plugin;
    const isRemote = Boolean(this.plugin?.isRemoteServerReady?.());
    if (this.options.fixedLocation === 'local') {
      this.targetLocation = 'local';
    } else if (this.options.fixedLocation === 'remote') {
      this.targetLocation = isRemote ? 'remote' : 'local';
    } else {
      const userPref = this.plugin?.settings?.defaultSaveLocation || 'remote';
      this.targetLocation = (!isRemote || userPref === 'local') ? 'local' : 'remote';
    }
    this.finalFilename = `${fileInfo.defaultBaseName}.${fileInfo.ext}`;
    this.step = 'input';
    this.result = null;
    this.isDone = false;
    this.isExecuting = false;
  }

  t(k, p) {
    return this.plugin ? this.plugin.t(k, p) : k;
  }

  onOpen() {
    this.render();
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('fm-wizard-modal');
    contentEl.addClass('fm-incoming-modal-dialog');

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

    // 1. Clean Title Header
    const header = contentEl.createDiv({ cls: 'fm-step-header' });
    header.createEl('h3', { text: this.t('destTitle'), cls: 'fm-step-title' });

    // 2. Asset Card (Thumbnail + Integrated Input + Size)
    const card = contentEl.createDiv({ cls: 'fm-incoming-card' });
    const thumbWrap = card.createDiv({ cls: 'fm-incoming-thumb-wrap' });

    if (IMAGE_EXTS.has(this.fileInfo.ext)) {
      const img = thumbWrap.createEl('img', { cls: 'fm-incoming-thumb-img' });
      convertBufferToPreviewUrl(this.fileInfo.arrayBuffer, this.fileInfo.ext, this.plugin)
        .then((url) => {
          if (url) img.src = url;
        })
        .catch(() => {});
    } else {
      const ext = this.fileInfo.ext;
      const icon = ext === 'md' ? '📝' : AUDIO_EXTS.has(ext) ? '🎵' : ['mp4', 'webm', 'mov', 'mkv'].includes(ext) ? '🎬' : ext === 'pdf' ? '📄' : '📦';
      thumbWrap.createSpan({ text: icon, attr: { style: 'font-size: 24px;' } });
    }

    const editCol = card.createDiv({ cls: 'fm-incoming-edit-col' });
    const inputRow = editCol.createDiv({ cls: 'fm-incoming-input-row' });
    const nameInput = inputRow.createEl('input', {
      type: 'text',
      value: this.fileInfo.defaultBaseName,
      cls: 'fm-incoming-name-input',
      attr: {
        placeholder: this.t('destFilenameHint'),
        spellcheck: 'false'
      }
    });
    inputRow.createSpan({ text: `.${this.fileInfo.ext}`, cls: 'fm-incoming-ext-badge' });
    editCol.createDiv({
      cls: 'fm-incoming-sub-meta',
      text: formatBytes(this.fileInfo.size)
    });

    if (this.options.promptRename) {
      setTimeout(() => {
        nameInput.focus();
        nameInput.select();
      }, 40);
    }

    // 3. Location Selection
    const isRemoteReady = Boolean(
      this.plugin?.settings?.enableRemoteServer &&
      this.plugin?.isRemoteServerReady?.()
    );

    const isAskMode = this.options.askLocation !== false;
    let isRemoteFallback = false;
    if (!isAskMode && this.options.fixedLocation === 'local') {
      this.targetLocation = 'local';
    } else if (!isAskMode && this.options.fixedLocation === 'remote') {
      if (isRemoteReady) {
        this.targetLocation = 'remote';
      } else {
        this.targetLocation = 'local';
        isRemoteFallback = true;
      }
    } else if (!this.targetLocation) {
      const userPref = this.plugin?.settings?.defaultSaveLocation || 'remote';
      this.targetLocation = (!isRemoteReady || userPref === 'local') ? 'local' : 'remote';
    }

    contentEl.createDiv({
      cls: 'fm-section-title',
      text: this.t('destDestTitle'),
      attr: { style: 'margin-top: 14px; margin-bottom: 8px;' }
    });

    const grid = contentEl.createDiv({ cls: 'fm-incoming-dest-grid' });

    // Local Option Card
    const localCard = grid.createDiv({
      cls: `fm-incoming-dest-card ${this.targetLocation === 'local' ? 'is-selected' : ''}`
    });
    const localTitle = localCard.createDiv({ cls: 'fm-incoming-dest-card-title' });
    localTitle.createSpan({ text: this.t('destSaveLocal') });
    const localCheck = localCard.createSpan({ cls: 'fm-incoming-dest-card-check' });
    setIcon(localCheck, 'check');

    // Remote Option Card (only rendered if remote server is enabled and ready)
    let remoteCard = null;
    let remoteCheck = null;
    if (isRemoteReady) {
      remoteCard = grid.createDiv({
        cls: `fm-incoming-dest-card ${this.targetLocation === 'remote' ? 'is-selected' : ''}`
      });
      const remoteTitle = remoteCard.createDiv({ cls: 'fm-incoming-dest-card-title' });
      remoteTitle.createSpan({ text: this.t('destSaveRemote') });
      remoteCheck = remoteCard.createSpan({ cls: 'fm-incoming-dest-card-check' });
      setIcon(remoteCheck, 'check');
    }

    const updateSelection = (loc) => {
      this.targetLocation = loc;
      if (loc === 'local') {
        localCard.addClass('is-selected');
        if (remoteCard) remoteCard.removeClass('is-selected');
      } else {
        localCard.removeClass('is-selected');
        if (remoteCard) remoteCard.addClass('is-selected');
      }
    };

    if (isAskMode) {
      localCard.onclick = () => updateSelection('local');
      if (remoteCard) {
        remoteCard.onclick = () => updateSelection('remote');
      }
    } else {
      localCard.style.cursor = 'default';
      if (remoteCard) remoteCard.style.cursor = 'default';
      let hintText = '';
      if (isRemoteFallback) {
        hintText = this.t('destFixedRemoteFallbackHint');
      } else if (this.targetLocation === 'local') {
        hintText = this.t('destFixedLocalHint');
      } else {
        hintText = this.t('destFixedRemoteHint');
      }
      contentEl.createDiv({
        cls: 'fm-incoming-fixed-hint',
        text: hintText,
        attr: { style: 'font-size: 11px; color: var(--text-muted); margin-top: 6px;' }
      });
    }

    const triggerExecute = () => {
      if (this.isExecuting) return;
      this.isExecuting = true;
      const cleanBase = sanitizeCleanBaseName(nameInput.value, this.fileInfo.defaultBaseName);
      this.finalFilename = `${cleanBase}.${this.fileInfo.ext}`;
      this.step = 'executing';
      this.render();
      this.runExecution();
    };

    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        triggerExecute();
      }
    });

    contentEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
        if (tag === 'textarea' || tag === 'button' || tag === 'input') return;
        e.preventDefault();
        triggerExecute();
      }
    });

    // 4. Action Buttons (Cancel & Insert)
    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row', attr: { style: 'margin-top: 18px;' } });
    const cancelBtn = btnRow.createEl('button', { text: this.t('btnCancel') });
    cancelBtn.onclick = () => {
      this.isDone = true;
      this.close();
      if (this.callback) this.callback({ target: null });
    };

    const insertBtn = btnRow.createEl('button', { text: this.t('btnInsert') || '插入', cls: 'mod-cta' });
    insertBtn.onclick = () => triggerExecute();
  }

  renderExecutingStep() {
    const { contentEl } = this;
    const header = contentEl.createDiv({ cls: 'fm-step-header' });
    header.createEl('h3', { text: this.t('destProcessingTitle'), cls: 'fm-step-title' });

    const infoBox = contentEl.createDiv({ cls: 'fm-section-box', attr: { style: 'margin-bottom: 14px;' } });
    infoBox.createDiv({
      text: `📄 ${this.finalFilename}  (${formatBytes(this.fileInfo.size)})`,
      attr: { style: 'font-weight: 600; margin-bottom: 10px;' }
    });

    const progressWrap = infoBox.createDiv({ cls: 'fm-progress-wrap' });
    this.progressBar = progressWrap.createDiv({ cls: 'fm-progress-bar', attr: { style: 'width: 15%;' } });

    this.statusLabel = infoBox.createDiv({
      text: this.targetLocation === 'remote'
        ? this.t('destProbeChecking')
        : this.t('destSavingLocal'),
      attr: { style: 'font-size: 12px; color: var(--text-accent); margin-top: 8px;' }
    });
  }

  async runExecution() {
    try {
      const activeFile = this.options.activeFile || this.app.workspace.getActiveFile();
      const editor = this.options.editor;
      const sourcePath = activeFile ? activeFile.path : '';

      if (this.targetLocation === 'local') {
        if (this.progressBar) this.progressBar.style.width = '40%';
        if (this.statusLabel) this.statusLabel.setText(this.t('destSavingLocal'));

        const localPath = await this.app.fileManager.getAvailablePathForAttachment(
          this.finalFilename,
          sourcePath
        );

        if (this.progressBar) this.progressBar.style.width = '75%';
        const createdFile = await this.app.vault.createBinary(localPath, this.fileInfo.arrayBuffer);
        let mdLink = this.app.fileManager.generateMarkdownLink(createdFile, sourcePath);

        // Prepend exclamation mark for image previews if not already present
        if (IMAGE_EXTS.has(this.fileInfo.ext) && !mdLink.startsWith('!')) {
          mdLink = `!${mdLink}`;
        }

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
        this.plugin?.logOperation?.('INFO', 'SAVE_LOCAL', `Saved attachment to vault: ${createdFile.path}`, {
          size: this.fileInfo.size,
          note: sourcePath || null
        });
      } else {
        // Remote upload with Instant SHA-256 Probe check
        if (this.progressBar) this.progressBar.style.width = '25%';
        if (this.statusLabel) this.statusLabel.setText(this.t('destProbeChecking'));

        const sha256 = this.fileInfo.sha256 || (await computeSha256Hex(this.fileInfo.arrayBuffer));
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
            { skipProbe: true }
          );
          if (this.progressBar) this.progressBar.style.width = '100%';
        }

        const useOpt =
          this.plugin.settings.insertOptimizedLinkOnUpload &&
          res.optimizationEnabled !== false &&
          res.category === 'image' &&
          res.pubUrl;
        let finalMarkdown = useOpt
          ? `![](${res.pubUrl})`
          : (res.markdown || `[${this.finalFilename}](${res.rawUrl})`);

        // Prepend exclamation mark for image previews if not already present
        if (IMAGE_EXTS.has(this.fileInfo.ext) && !finalMarkdown.startsWith('!')) {
          finalMarkdown = `!${finalMarkdown}`;
        }

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
        this.plugin?.logOperation?.('INFO', 'UPLOAD_REMOTE', `${res.isInstant ? 'Reused existing remote file' : 'Uploaded attachment to server'}: ${this.finalFilename}`, {
          remotePath: `${res.year}/${res.month}/${res.filename}`,
          isInstant: !!res.isInstant,
          size: this.fileInfo.size,
          note: sourcePath || null
        });
      }
    } catch (err) {
      this.isExecuting = false;
      this.result = {
        success: false,
        error: err.message || String(err)
      };
      this.plugin?.logOperation?.('ERROR', 'SAVE_ATTACHMENT', `Failed to process attachment "${this.finalFilename}": ${this.result.error}`, {
        target: this.targetLocation,
        size: this.fileInfo.size
      });
    }

    if (this.callback) {
      this.callback({ target: this.targetLocation, finalFilename: this.finalFilename, result: this.result });
    }

    // Auto close modal if inserted directly into active note editor
    if (this.result?.success && this.result?.inserted) {
      const noticeMsg = this.result.target === 'remote'
        ? (this.plugin ? this.plugin.t('noticeUploadedRemote', { name: this.finalFilename }) : `已上传到服务器并插入链接：${this.finalFilename}`)
        : this.t('destInsertSuccess');
      new Notice(noticeMsg);
      this.isDone = true;
      this.close();
      return;
    } else if (this.result?.success) {
      new Notice(this.t('destInsertSuccess'));
      this.isDone = true;
      this.close();
      return;
    } else {
      new Notice(`❌ ${this.result?.error || 'Insert failed'}`);
      this.isDone = true;
      this.close();
      return;
    }
  }

  renderResultStep() {
    const { contentEl } = this;
    const header = contentEl.createDiv({ cls: 'fm-step-header' });
    header.createEl('h3', { text: this.t('destResultTitle'), cls: 'fm-step-title' });

    if (!this.result.success) {
      const errBanner = contentEl.createDiv({ cls: 'fm-result-banner fm-result-banner-error' });
      errBanner.createDiv({
        cls: 'fm-result-banner-title',
        text: this.t('destProcessingError', { err: formatFriendlyError(this, this.result.error) })
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
        attr: { style: 'font-weight: 600; margin-bottom: 12px; color: var(--text-normal);' }
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
        attr: { style: 'font-weight: 600; margin-bottom: 12px; color: var(--text-normal);' }
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
 * Modal to execute active note operations with 2-step preview/options (for migrate & download conflict check),
 * real-time progress bar & in-window result list
 */
class ActiveNoteActionModal extends Modal {
  constructor(app, plugin, targetFile, actionType = 'migrate', options = {}) {
    super(app);
    this.plugin = plugin;
    this.targetFile = targetFile;
    this.actionType = actionType; // 'migrate' | 'download'
    this.fromHub = Boolean(options?.fromHub);
    this.step = 'loading';
    this.items = [];
    this.deleteLocalAfter = Boolean(plugin?.settings?.deleteLocalAfterMigrate);
    this.syncOtherNotes = true;
    this.conflictStrategy = 'reuse'; // 'reuse' | 'rename' | 'overwrite'
    this.hadConflictStep = false;
    this.result = null;
  }

  t(k, p) {
    return this.plugin ? this.plugin.t(k, p) : k;
  }

  getUniqueOtherRefNotes(onlySelected = false) {
    const set = new Set();
    for (const item of this.items) {
      if (onlySelected && !item.selected) continue;
      for (const p of item.otherRefNotes || []) {
        set.add(p);
      }
    }
    return [...set];
  }

  async onOpen() {
    this.render();
    if (this.actionType === 'migrate') {
      try {
        this.items = await this.plugin.scanActiveNoteLocalAttachments(this.targetFile);
        this.step = 'preview';
      } catch (err) {
        this.result = { success: false, message: err.message || String(err) };
        this.step = 'result';
      }
      this.render();
    } else {
      try {
        this.items = await this.plugin.scanActiveNoteRemoteAttachments(this.targetFile);
        if (this.items.length === 0) {
          this.result = { success: true, count: 0, processedItems: [], failures: [] };
          this.step = 'result';
          this.render();
          return;
        }
        const hasConflicts = this.items.some((item) => item.hasConflict);
        const hasOtherRefs = this.items.some((item) => (item.otherRefNotes?.length || 0) > 0);
        if (hasConflicts || hasOtherRefs) {
          this.hadConflictStep = true;
          this.step = 'conflict';
          this.render();
        } else {
          this.step = 'running';
          this.render();
          await this.execute(this.items);
        }
      } catch (err) {
        this.result = { success: false, message: err.message || String(err) };
        this.step = 'result';
        this.render();
      }
    }
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('fm-wizard-modal');

    const titleKey = this.actionType === 'migrate' ? 'activeNoteMigrateTitle' : 'activeNoteDownloadTitle';
    if (this.actionType === 'migrate' || this.hadConflictStep || this.step === 'conflict') {
      const stepNum = (this.step === 'loading' || this.step === 'preview' || this.step === 'conflict') ? 1 : 2;
      const header = contentEl.createDiv({ cls: 'fm-step-header' });
      header.createSpan({ text: this.t('stepOf', { current: stepNum, total: 2 }), cls: 'fm-step-badge' });
      header.createEl('h3', { text: this.t(titleKey), cls: 'fm-step-title' });
    } else {
      contentEl.createEl('h3', { text: this.t(titleKey) });
    }

    contentEl.createDiv({
      text: `📄 ${this.targetFile.path}`,
      attr: { style: 'font-size: 12px; color: var(--text-muted); margin-bottom: 12px;' }
    });

    if (this.step === 'loading') {
      const box = contentEl.createDiv({ cls: 'fm-section-box' });
      box.createDiv({
        text: this.t('activeNoteScanning'),
        attr: { style: 'font-size: 13px; color: var(--text-accent);' }
      });
      return;
    }

    if (this.step === 'conflict') {
      const conflictItems = this.items.filter((i) => i.hasConflict);
      const otherRefNotesAll = this.getUniqueOtherRefNotes(false);

      if (conflictItems.length > 0) {
        const warnBanner = contentEl.createDiv({
          cls: 'fm-result-banner fm-result-banner-error',
          attr: { style: 'margin-bottom: 12px;' }
        });
        warnBanner.createDiv({
          cls: 'fm-result-banner-title',
          text: this.t('activeNoteDownConflictTitle', { count: conflictItems.length }),
          attr: { style: 'margin-bottom: 0;' }
        });
      } else if (otherRefNotesAll.length > 0) {
        const infoBanner = contentEl.createDiv({
          cls: 'fm-result-banner fm-result-banner-instant',
          attr: { style: 'margin-bottom: 12px;' }
        });
        infoBanner.createDiv({
          cls: 'fm-result-banner-title',
          text: this.t('activeNoteDownOtherRefsTitle', { count: otherRefNotesAll.length }),
          attr: { style: 'margin-bottom: 0;' }
        });
      }

      const listEl = contentEl.createDiv({
        cls: 'fm-scroll-list',
        attr: { style: 'max-height: 220px;' }
      });

      let runBtn = null;
      const updateRunBtnLabel = () => {
        if (!runBtn) return;
        const selectedCount = this.items.filter((i) => i.selected).length;
        runBtn.setText(this.t('activeNoteStartDownload', { count: selectedCount }));
      };

      for (const item of this.items) {
        const row = listEl.createDiv({ cls: 'fm-list-item' });
        const left = row.createDiv({
          attr: { style: 'display:flex; align-items:center; gap:10px; flex:1; overflow:hidden;' }
        });
        const cb = left.createEl('input', { type: 'checkbox', attr: { style: 'cursor:pointer;' } });
        cb.checked = item.selected;
        cb.onchange = () => {
          item.selected = cb.checked;
          updateRunBtnLabel();
        };

        renderItemVisualThumb(left, item, this.plugin);

        const nameCol = left.createDiv({
          attr: { style: 'display:flex; flex-direction:column; overflow:hidden; flex:1;' }
        });
        nameCol.createSpan({
          text: item.name,
          attr: { style: 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:500;' }
        });
        const displayPath = (item.hasConflict && item.existingFile)
          ? item.existingFile.path
          : item.idealPath;
        nameCol.createSpan({
          text: `${displayPath}${item.size ? ' · ' + formatBytes(item.size) : ''}`,
          attr: { style: 'font-size:11px; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;' }
        });

        const otherRefs = item.otherRefNotes || [];
        if (otherRefs.length > 0) {
          const rightBox = row.createDiv({
            attr: { style: 'display:flex; align-items:center; gap:6px; flex-shrink:0;' }
          });
          const refBadge = rightBox.createSpan({
            text: this.t('activeNoteOtherRefsBadge', { count: otherRefs.length }),
            cls: 'fm-tag fm-tag-ref fm-clickable-badge',
            attr: { title: this.t('activeNoteInspectOtherRefs') }
          });
          refBadge.onclick = (e) => {
            e.stopPropagation();
            new NoteRefsModal(this.app, item.name, otherRefs, () => this.close(), this.plugin).open();
          };
        }
      }

      if (otherRefNotesAll.length > 0 || conflictItems.length > 0) {
        const optionsBox = contentEl.createDiv({
          cls: 'fm-section-box',
          attr: { style: 'margin-top: 10px; display: flex; flex-direction: column; gap: 10px;' }
        });

        if (otherRefNotesAll.length > 0) {
          const syncLabel = optionsBox.createEl('label', {
            cls: 'fm-check-row',
            attr: { style: 'margin: 0; cursor: pointer;' }
          });
          const syncCb = syncLabel.createEl('input', { type: 'checkbox' });
          syncCb.checked = this.syncOtherNotes;
          syncCb.onchange = () => {
            this.syncOtherNotes = syncCb.checked;
          };
          syncLabel.createSpan({
            text: this.t('activeNoteSyncOtherDownloadOpt', { count: otherRefNotesAll.length })
          });
        }

        if (conflictItems.length > 0) {
          const strategyWrap = optionsBox.createDiv({
            attr: {
              style: otherRefNotesAll.length > 0
                ? 'border-top: 1px solid var(--background-modifier-border); padding-top: 10px;'
                : ''
            }
          });
          strategyWrap.createDiv({
            text: this.t('activeNoteDownStrategyTitle'),
            cls: 'fm-section-title'
          });

          const strategies = [
            { value: 'reuse', label: this.t('activeNoteDownOptReuse') },
            { value: 'rename', label: this.t('activeNoteDownOptRename') },
            { value: 'overwrite', label: this.t('activeNoteDownOptOverwrite') }
          ];
          for (const st of strategies) {
            const rowLabel = strategyWrap.createEl('label', {
              cls: 'fm-check-row',
              attr: { style: 'cursor:pointer;' }
            });
            const radio = rowLabel.createEl('input', {
              type: 'radio',
              attr: { name: 'fm-down-conflict-strategy', value: st.value }
            });
            radio.checked = this.conflictStrategy === st.value;
            radio.onchange = () => {
              if (radio.checked) this.conflictStrategy = st.value;
            };
            rowLabel.createSpan({ text: st.label });
          }
        }
      }

      const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
      const cancelBtn = btnRow.createEl('button', { text: this.t('btnCancel') });
      cancelBtn.onclick = () => returnToHub(this);

      runBtn = btnRow.createEl('button', {
        text: this.t('activeNoteStartDownload', { count: this.items.filter((i) => i.selected).length }),
        cls: 'mod-cta'
      });
      runBtn.onclick = async () => {
        const selected = this.items.filter((i) => i.selected);
        if (selected.length === 0) {
          new Notice(this.t('activeNoteSelectRequired'));
          return;
        }
        this.step = 'running';
        this.render();
        await this.execute(selected);
      };
      return;
    }

    if (this.step === 'preview') {
      if (this.items.length === 0) {
        const emptyBanner = contentEl.createDiv({
          cls: 'fm-section-box',
          attr: { style: 'text-align: center; padding: 24px 16px;' }
        });
        emptyBanner.createDiv({
          text: this.t('activeNoteNoLocal'),
          attr: { style: 'font-size: 14px; color: var(--text-muted);' }
        });
        const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
        const closeBtn = btnRow.createEl('button', { text: this.t('closeBtn') });
        closeBtn.onclick = () => returnToHub(this);
        return;
      }

      contentEl.createEl('p', {
        text: this.t('activeNoteStep1Desc', { count: this.items.length }),
        cls: 'fm-step-desc'
      });

      const listEl = contentEl.createDiv({
        cls: 'fm-scroll-list',
        attr: { style: 'max-height: 240px;' }
      });

      let runBtn = null;
      const updateRunBtnLabel = () => {
        if (!runBtn) return;
        const selectedCount = this.items.filter((i) => i.selected).length;
        runBtn.setText(this.t('activeNoteStartUpload', { count: selectedCount }));
      };

      for (const item of this.items) {
        const row = listEl.createDiv({ cls: 'fm-list-item' });
        const left = row.createDiv({
          attr: { style: 'display:flex; align-items:center; gap:10px; flex:1; overflow:hidden;' }
        });
        const cb = left.createEl('input', { type: 'checkbox', attr: { style: 'cursor:pointer;' } });
        cb.checked = item.selected;
        cb.onchange = () => {
          item.selected = cb.checked;
          updateRunBtnLabel();
        };

        renderItemVisualThumb(left, item, this.plugin);

        const nameCol = left.createDiv({
          attr: { style: 'display:flex; flex-direction:column; overflow:hidden; flex:1;' }
        });
        nameCol.createSpan({
          text: item.name,
          attr: { style: 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:500;' }
        });
        nameCol.createSpan({
          text: `${item.displayPath} · ${formatBytes(item.size)}`,
          attr: { style: 'font-size:11px; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;' }
        });

        const rightBox = row.createDiv({
          attr: { style: 'display:flex; align-items:center; gap:8px; flex-shrink:0;' }
        });
        const otherRefs = item.otherRefNotes || [];
        if (otherRefs.length > 0) {
          const refBadge = rightBox.createSpan({
            text: this.t('activeNoteOtherRefsBadge', { count: otherRefs.length }),
            cls: 'fm-tag fm-tag-ref fm-clickable-badge',
            attr: { title: this.t('activeNoteInspectOtherRefs') }
          });
          refBadge.onclick = (e) => {
            e.stopPropagation();
            new NoteRefsModal(this.app, item.name, otherRefs, () => this.close(), this.plugin).open();
          };
        }

        const lockBtn = rightBox.createEl('button', {
          type: 'button',
          cls: 'fm-mini-btn',
          text: item.locked ? this.t('activeNoteBtnLockOn') : this.t('activeNoteBtnLockOff'),
          attr: {
            style: item.locked
              ? 'border-color: var(--interactive-accent); color: var(--text-accent); font-weight: 600;'
              : 'color: var(--text-muted);'
          }
        });
        lockBtn.onclick = (e) => {
          e.stopPropagation();
          item.locked = !item.locked;
          lockBtn.setText(item.locked ? this.t('activeNoteBtnLockOn') : this.t('activeNoteBtnLockOff'));
          lockBtn.style.cssText = item.locked
            ? 'border-color: var(--interactive-accent); color: var(--text-accent); font-weight: 600;'
            : 'color: var(--text-muted);';
        };
      }

      contentEl.createDiv({
        cls: 'fm-section-box',
        text: this.t('activeNoteLockExplain'),
        attr: { style: 'font-size: 12px; color: var(--text-muted); line-height: 1.5; margin-top: 10px;' }
      });

      const otherRefNotesAll = this.getUniqueOtherRefNotes(false);
      const optBox = contentEl.createDiv({
        cls: 'fm-section-box',
        attr: { style: 'margin-top: 8px; display: flex; flex-direction: column; gap: 10px;' }
      });

      if (otherRefNotesAll.length > 0) {
        const syncLabel = optBox.createEl('label', {
          cls: 'fm-check-row',
          attr: { style: 'margin: 0; cursor: pointer;' }
        });
        const syncCb = syncLabel.createEl('input', { type: 'checkbox' });
        syncCb.checked = this.syncOtherNotes;
        syncCb.onchange = () => {
          this.syncOtherNotes = syncCb.checked;
        };
        syncLabel.createSpan({
          text: this.t('activeNoteSyncOtherUploadOpt', { count: otherRefNotesAll.length })
        });
      }

      const delWrap = optBox.createDiv({
        attr: {
          style: otherRefNotesAll.length > 0
            ? 'border-top: 1px solid var(--background-modifier-border); padding-top: 10px;'
            : ''
        }
      });
      const delLabel = delWrap.createEl('label', {
        cls: 'fm-check-row',
        attr: { style: 'margin: 0; cursor: pointer;' }
      });
      const delCb = delLabel.createEl('input', { type: 'checkbox' });
      delCb.checked = this.deleteLocalAfter;
      delCb.onchange = () => {
        this.deleteLocalAfter = delCb.checked;
      };
      delLabel.createSpan({ text: this.t('activeNoteDeleteLocalOpt') });

      const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
      const cancelBtn = btnRow.createEl('button', { text: this.t('btnCancel') });
      cancelBtn.onclick = () => returnToHub(this);

      runBtn = btnRow.createEl('button', {
        text: this.t('activeNoteStartUpload', { count: this.items.filter((i) => i.selected).length }),
        cls: 'mod-cta'
      });
      runBtn.onclick = async () => {
        const selected = this.items.filter((i) => i.selected);
        if (selected.length === 0) {
          new Notice(this.t('activeNoteSelectRequired'));
          return;
        }
        this.step = 'running';
        this.render();
        await this.execute(selected);
      };
      return;
    }

    if (this.step === 'running') {
      const box = contentEl.createDiv({ cls: 'fm-section-box' });
      this.statusText = box.createDiv({
        text: this.t('activeNoteScanning'),
        attr: { style: 'font-size: 13px; color: var(--text-accent); margin-bottom: 8px;' }
      });
      const wrap = box.createDiv({ cls: 'fm-progress-wrap' });
      this.progressBar = wrap.createDiv({ cls: 'fm-progress-bar', attr: { style: 'width: 10%;' } });
      const stop = box.createEl('button', { text: this.t('transferStop') });
      stop.onclick = () => {
        this.transferController?.abort();
        stop.disabled = true;
        this.statusText.setText(this.t('transferStopping'));
      };
    } else if (this.step === 'result') {
      const failures = this.result?.failures || [];
      const processedItems = this.result?.processedItems || [];
      if (!this.result.success) {
        const errBanner = contentEl.createDiv({ cls: 'fm-result-banner fm-result-banner-error' });
        errBanner.createDiv({ cls: 'fm-result-banner-title', text: '❌ ' + this.result.message });
      } else {
        if (this.result.count > 0) {
          const banner = contentEl.createDiv({ cls: 'fm-result-banner fm-result-banner-success' });
          banner.createDiv({
            cls: 'fm-result-banner-title',
            text: this.result.cancelled ? this.t('transferCancelled') : this.actionType === 'migrate' ? this.t('activeNoteMigrateComplete') : this.t('activeNoteDownloadComplete')
          });
          banner.createDiv({
            cls: 'fm-result-banner-desc',
            text: this.actionType === 'migrate'
              ? this.t('activeNoteMigrateDoneDesc', { count: this.result.count })
              : this.t('activeNoteDownloadDoneDesc', { count: this.result.count })
          });

          const trashFailedList = processedItems.filter((p) => p.trashError);
          if (trashFailedList.length > 0) {
            const warnBox = contentEl.createDiv({
              cls: 'fm-alert fm-alert-warning',
              attr: { style: 'margin-top: 10px; margin-bottom: 6px; font-size: 12px;' }
            });
            warnBox.createSpan({
              text: this.t('activeNoteTrashFailedNotice', { count: trashFailedList.length })
            });
          }

          if (processedItems.length > 0) {
            const listBox = contentEl.createDiv({
              cls: 'fm-section-box',
              attr: { style: 'margin-top: 10px;' }
            });
            listBox.createDiv({
              text: this.t('activeNoteResultListTitle', { count: processedItems.length }),
              cls: 'fm-section-title'
            });
            const listEl = listBox.createDiv({
              cls: 'fm-scroll-list',
              attr: { style: 'max-height: 220px; margin-bottom: 0;' }
            });
            for (const pItem of processedItems) {
              const row = listEl.createDiv({ cls: 'fm-list-item' });
              const left = row.createDiv({
                attr: { style: 'display:flex; align-items:center; gap:10px; flex:1; overflow:hidden;' }
              });
              renderItemVisualThumb(left, pItem, this.plugin);
              const nameCol = left.createDiv({
                attr: { style: 'display:flex; flex-direction:column; overflow:hidden; flex:1;' }
              });
              nameCol.createSpan({
                text: pItem.name,
                attr: { style: 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:500;' }
              });
              nameCol.createSpan({
                text: `${pItem.displayPath}${pItem.size ? ' · ' + formatBytes(pItem.size) : ''}`,
                attr: { style: 'font-size:11px; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;' }
              });

              const rightBox = row.createDiv({
                attr: { style: 'display:flex; align-items:center; gap:6px; flex-shrink:0; flex-wrap:wrap; justify-content:flex-end;' }
              });
              if (pItem.syncedOtherNotes > 0) {
                const syncedPaths = Array.isArray(pItem.syncedOtherNotePaths) ? pItem.syncedOtherNotePaths : [];
                const syncedBadge = rightBox.createSpan({
                  text: this.t('activeNoteBadgeSyncedNotes', { count: pItem.syncedOtherNotes }),
                  cls: syncedPaths.length > 0 ? 'fm-tag fm-tag-ref fm-clickable-badge' : 'fm-tag fm-tag-ref',
                  attr: syncedPaths.length > 0 ? { title: this.t('activeNoteInspectOtherRefs') } : {}
                });
                if (syncedPaths.length > 0) {
                  syncedBadge.onclick = (e) => {
                    e.stopPropagation();
                    new NoteRefsModal(this.app, pItem.name, syncedPaths, () => this.close(), this.plugin).open();
                  };
                }
              }
              if (pItem.trashedLocal) {
                rightBox.createSpan({ text: this.t('activeNoteBadgeTrashedLocal'), cls: 'fm-tag fm-tag-info' });
              } else if (pItem.trashError) {
                rightBox.createSpan({
                  text: this.t('activeNoteBadgeTrashFailed'),
                  cls: 'fm-tag fm-tag-danger',
                  attr: { title: String(pItem.trashError) }
                });
              } else if (pItem.keptForOtherRefs > 0) {
                const keptPaths = Array.isArray(pItem.keptForOtherRefPaths) ? pItem.keptForOtherRefPaths : [];
                const keptBadge = rightBox.createSpan({
                  text: this.t('activeNoteBadgeKeptForOtherRefs', { count: pItem.keptForOtherRefs }),
                  cls: keptPaths.length > 0 ? 'fm-tag fm-tag-warning fm-clickable-badge' : 'fm-tag fm-tag-warning',
                  attr: keptPaths.length > 0 ? { title: this.t('activeNoteInspectOtherRefs') } : {}
                });
                if (keptPaths.length > 0) {
                  keptBadge.onclick = (e) => {
                    e.stopPropagation();
                    new NoteRefsModal(this.app, pItem.name, keptPaths, () => this.close(), this.plugin).open();
                  };
                }
              }
              if (pItem.locked) {
                rightBox.createSpan({ text: this.t('activeNoteBtnLockOn'), cls: 'fm-tag fm-tag-info' });
              }
              let badgeKey = 'activeNoteBadgeDownloaded';
              if (pItem.action === 'reused') badgeKey = 'activeNoteBadgeReused';
              else if (pItem.action === 'overwritten') badgeKey = 'activeNoteBadgeOverwritten';
              else if (pItem.action === 'uploaded') badgeKey = 'activeNoteBadgeUploaded';
              rightBox.createSpan({
                text: this.t(badgeKey),
                cls: 'fm-tag fm-tag-info'
              });
            }
          }
        } else if (failures.length === 0 && !this.result.cancelled) {
          const emptyBanner = contentEl.createDiv({ cls: 'fm-section-box', attr: { style: 'text-align: center; padding: 24px 16px;' } });
          emptyBanner.createDiv({
            text: this.actionType === 'migrate' ? this.t('activeNoteNoLocal') : this.t('activeNoteNoRemote'),
            attr: { style: 'font-size: 14px; color: var(--text-muted);' }
          });
        }

        if (failures.length > 0) {
          const failBanner = contentEl.createDiv({
            cls: 'fm-result-banner fm-result-banner-error',
            attr: { style: 'margin-top: 10px;' }
          });
          const failTitleKey = this.actionType === 'migrate' ? 'activeNoteFailedTitle' : 'activeNoteDownFailedTitle';
          failBanner.createDiv({
            cls: 'fm-result-banner-title',
            text: this.t(failTitleKey, { failed: failures.length })
          });
          for (const f of failures) {
            const reason = formatFriendlyError(this, f.error);
            failBanner.createDiv({
              cls: 'fm-result-banner-desc',
              text: `• ${f.name} (${formatBytes(f.size || 0)}): ${reason}`,
              attr: { style: 'margin-top: 4px;' }
            });
          }
        }
      }

      const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
      if (this.actionType === 'migrate' && processedItems.length > 0) {
        let noteReportPath = null;
        const exportBtn = btnRow.createEl('button', { text: this.t('batchExportReport') });
        exportBtn.onclick = async () => {
          exportBtn.disabled = true;
          try {
            noteReportPath = await this.plugin.exportBatchMigrateReportToRoot({
              count: this.result.count,
              docs: 1,
              trashed: processedItems.filter((p) => p.trashedLocal).length,
              processedItems,
              failures: this.result.failures || [],
              totalBytes: processedItems.reduce((s, p) => s + (p.size || 0), 0)
            });
            exportBtn.setText(this.t('batchReportExported'));
            if (!btnRow.querySelector('.fm-open-report-btn')) {
              const openBtn = btnRow.createEl('button', {
                text: this.t('batchOpenReport'),
                cls: 'fm-open-report-btn'
              });
              openBtn.onclick = () => {
                if (noteReportPath) {
                  this.app.workspace.openLinkText(noteReportPath, '', true);
                }
                this.close();
              };
            }
          } catch (err) {
            new Notice('❌ ' + err.message);
            exportBtn.disabled = false;
          }
        };
      }
      if (this.result?.cancelled) btnRow.createSpan({ text: this.t('transferCancelled') });
      if (this.result?.retryItems?.length) {
        const retry = btnRow.createEl('button', { text: this.t('transferRetry') });
        retry.onclick = async () => {
          const pending = this.result.retryItems;
          this.step = 'running';
          this.render();
          await this.execute(pending);
        };
      }
      const doneBtn = btnRow.createEl('button', { text: this.t('destBtnDone'), cls: 'mod-cta' });
      doneBtn.onclick = () => returnToHub(this);
    }
  }

  async execute(selectedItems = null) {
    this.transferController = new AbortController();
    try {
      if (this.actionType === 'migrate') {
        const res = await this.plugin.executeMigrateNoteDirect(
          this.targetFile,
          (cur, total, name) => {
            if (this.progressBar) {
              const pct = Math.round((cur / Math.max(1, total)) * 100);
              this.progressBar.style.width = `${pct}%`;
            }
            if (this.statusText) {
              this.statusText.setText(this.t('activeNoteProcessing', { current: cur, total, name }));
            }
          },
          {
            items: selectedItems || this.items.filter((i) => i.selected),
            deleteLocalAfter: this.deleteLocalAfter,
            syncOtherNotes: this.syncOtherNotes,
            signal: this.transferController.signal,
            returnDetails: true
          }
        );
        const count = typeof res === 'object' ? (res.count || 0) : Number(res || 0);
        const processedItems = typeof res === 'object' && Array.isArray(res.processedItems) ? res.processedItems : [];
        const failures = typeof res === 'object' && Array.isArray(res.failures) ? res.failures : [];
        this.result = { success: true, ...res, count, processedItems, failures };
      } else {
        const res = await this.plugin.executeDownloadNoteDirect(
          this.targetFile,
          (cur, total, name) => {
            if (this.progressBar) {
              const pct = Math.round((cur / Math.max(1, total)) * 100);
              this.progressBar.style.width = `${pct}%`;
            }
            if (this.statusText) {
              this.statusText.setText(this.t('activeNoteProcessing', { current: cur, total, name }));
            }
          },
          {
            items: selectedItems || this.items.filter((i) => i.selected),
            conflictStrategy: this.conflictStrategy,
            syncOtherNotes: this.syncOtherNotes,
            signal: this.transferController.signal,
            returnDetails: true
          }
        );
        const count = typeof res === 'object' ? (res.count || 0) : Number(res || 0);
        const processedItems = typeof res === 'object' && Array.isArray(res.processedItems) ? res.processedItems : [];
        const failures = typeof res === 'object' && Array.isArray(res.failures) ? res.failures : [];
        this.result = { success: true, ...res, count, processedItems, failures };
      }
    } catch (err) {
      this.result = { success: false, message: err.message };
    }
    this.transferController = null;
    this.step = 'result';
    if (!this.transferClosed) this.render();
  }

  onClose() {
    this.transferClosed = true;
    this.transferController?.abort();
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
      attr: { style: 'font-size: 13px; color: var(--text-muted); margin-bottom: 14px;' }
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
      attr: { style: 'font-size: 12px; color: var(--text-muted); padding: 10px 14px;' }
    });
    const exclHint = exclFolders.length ? t('orphanExclHint', { folders: exclFolders.join(', ') }) : '';
    protInfo.createDiv({
      text: t('orphanProtActive', { excl: exclHint })
    });

    const progressWidget = createScanProgressWidget(contentEl, this.plugin);
    this.activeProgress = progressWidget;

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const cancelBtn = btnRow.createEl('button', { text: t('btnCancel') });
    cancelBtn.onclick = () => returnToHub(this);

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
    const leftTools = toolbar.createDiv({ attr: { style: 'display:flex; gap:8px; align-items:center;' } });
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
        attr: { style: 'text-align: center; padding: 36px 20px;' }
      });
      const emptyBtnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
      const cancelBtn = emptyBtnRow.createEl('button', { text: t('btnCancel') });
      cancelBtn.onclick = () => returnToHub(this);
      return;
    }

    const listEl = contentEl.createDiv({ cls: 'fm-scroll-list' });
    for (const item of this.results) {
      const row = listEl.createDiv({ cls: 'fm-list-item' });
      const left = row.createDiv({
        attr: { style: 'display:flex; align-items:center; gap:10px; flex:1; overflow:hidden;' }
      });

      const cb = left.createEl('input', { type: 'checkbox', attr: { style: 'cursor:pointer;' } });
      cb.checked = item.selected;
      cb.onchange = () => {
        item.selected = cb.checked;
      };

      renderItemVisualThumb(left, item, this.plugin);

      const infoCol = left.createDiv({ attr: { style: 'overflow:hidden; flex:1;' } });
      const topLine = infoCol.createDiv({ attr: { style: 'display:flex; align-items:center; gap:6px;' } });
      topLine.createSpan({
        text: item.source === 'local' ? '💻 Local' : '☁️ Remote',
        cls: `fm-tag ${item.source === 'local' ? 'fm-tag-local' : 'fm-tag-remote'}`
      });
      topLine.createSpan({
        text: item.displayPath,
        attr: { style: 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:500;' }
      });

      const rightBox = row.createDiv({
        attr: { style: 'display:flex; align-items:center; gap:8px; flex-shrink:0;' }
      });
      rightBox.createSpan({
        text: formatBytes(item.size),
        attr: { style: 'color: var(--text-muted); font-size: 12px;' }
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
    const cancelBtn = btnRow.createEl('button', { text: t('btnCancel') });
    cancelBtn.onclick = () => returnToHub(this);
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
      attr: { style: 'font-size: 13px; color: var(--text-muted); margin-bottom: 14px;' }
    });

    const isRemote = Boolean(this.plugin?.isRemoteServerReady?.());
    if (isRemote) {
      const scopeBox = contentEl.createDiv({ cls: 'fm-section-box' });
      scopeBox.createDiv({ text: t('dupLocScope'), cls: 'fm-section-title' });

      const scopes = [
        { key: 'both', label: t('dupCompareCross') },
        { key: 'local', label: t('dupCompareLocal') },
        { key: 'remote', label: t('dupCompareRemote') }
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
      attr: { style: 'font-size: 12px; color: var(--text-muted); padding: 10px 14px;' }
    });
    protBox.createDiv({
      text: t('dupProtRuleHint', { folders: exclFolders.join(', ') || '-' })
    });

    const progressWidget = createScanProgressWidget(contentEl, this.plugin);
    this.activeProgress = progressWidget;

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const cancelBtn = btnRow.createEl('button', { text: t('btnCancel') });
    cancelBtn.onclick = () => returnToHub(this);

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
    const leftTools = toolbar.createDiv({ attr: { style: 'display:flex; gap:8px; align-items:center; flex-wrap:wrap;' } });

    const backBtn = leftTools.createEl('button', { text: t('btnBack') });
    backBtn.onclick = () => {
      this.step = 1;
      this.render();
    };

    leftTools.createSpan({ text: t('dupStrategyLabel'), attr: { style: 'font-size:13px; font-weight:600; margin-left:4px;' } });
    const modeSelect = leftTools.createEl('select', { attr: { style: 'padding: 5px 8px; border-radius: 6px;' } });
    const modeOptions = [
      { value: 'auto', label: t('dupStrategyAuto') },
      { value: 'prefer-remote', label: t('dupStrategyPreferRemote') },
      { value: 'prefer-local', label: t('dupStrategyPreferLocal') }
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
        text: t('noticeRemoteUnreachable', { err: this.scanStats.remoteError }),
        attr: { style: 'font-size: 12px; color: #f59e0b; border-color: rgba(245, 158, 11, 0.4); padding: 10px 14px;' }
      });
    }

    if (this.groups.length === 0) {
      contentEl.createDiv({
        cls: 'fm-section-box',
        text: t('dupNoneFound'),
        attr: { style: 'text-align: center; padding: 36px 20px;' }
      });
      const emptyBtnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
      const closeBtn = emptyBtnRow.createEl('button', { text: t('closeBtn'), cls: 'mod-cta' });
      closeBtn.onclick = () => returnToHub(this);
      return;
    }

    const listEl = contentEl.createDiv({ cls: 'fm-scroll-list' });
    this.groups.forEach((grp, idx) => {
      const grpBox = listEl.createDiv({ cls: 'fm-dup-group' });
      const grpHead = grpBox.createDiv({ cls: 'fm-dup-group-header' });
      grpHead.createSpan({
        text: t('dupGroupHeader', { idx: idx + 1, hash: grp.sha256.slice(0, 12), size: formatBytes(grp.size) })
      });
      grpHead.createSpan({ text: t('dupGroupSubhint') });

      for (const item of grp.items) {
        const isKeep = grp.keepId === item.id;
        const row = grpBox.createDiv({ cls: 'fm-list-item' });
        const left = row.createDiv({
          attr: { style: 'display:flex; align-items:center; gap:8px; flex:1; overflow:hidden;' }
        });

        const radio = left.createEl('input', {
          type: 'radio',
          attr: { name: `dup_grp_${idx}`, style: 'cursor:pointer;' }
        });
        radio.checked = isKeep;
        radio.onchange = () => {
          grp.keepId = item.id;
          this.render();
        };

        renderItemVisualThumb(left, item, this.plugin);

        left.createSpan({
          text: isKeep ? t('dupTagKeep') : item.locked ? t('dupTagProtected') : t('dupTagRemove'),
          attr: { style: `font-size:12px; font-weight:700; color:${isKeep ? '#10b981' : item.locked ? '#f59e0b' : '#ef4444'}; width:68px; flex-shrink:0;` }
        });

        left.createSpan({
          text: item.source === 'local' ? t('analyticsBadgeLocal') : t('analyticsBadgeRemote'),
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
          attr: { title: t('dupDesignateKeepTitle'), attr: { style: 'word-break:break-all; cursor:pointer;' } }
        }).onclick = () => {
          grp.keepId = item.id;
          this.render();
        };

        const rightBox = row.createDiv({
          attr: { style: 'display:flex; align-items:center; gap:6px; flex-shrink:0;' }
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
    const cancelBtn = btnRow.createEl('button', { text: t('btnCancel') });
    cancelBtn.onclick = () => returnToHub(this);
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
    doneBtn.onclick = () => returnToHub(this);
  }

  onClose() {
    if (this.activeProgress) this.activeProgress.abort();
    this.contentEl.empty();
  }
}

/**
 * Wizard 3: Batch Cloud Migration Wizard
 * Step 1: Select migration folder scope, attachment types, and trash policy (with real-time scan progress + cancel button)
 * Step 2: Preview list, progress bar, upload, and verified safe rewrite
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
      attr: { style: 'font-size: 13px; color: var(--text-muted); margin-bottom: 14px;' }
    });

    const folderBox = contentEl.createDiv({ cls: 'fm-section-box' });
    folderBox.createDiv({ text: t('migrateFolderScope'), cls: 'fm-section-title' });
    const folderSelect = folderBox.createEl('select', { attr: { style: 'width:100%; padding:8px 10px; border-radius:6px;' } });
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
    cancelBtn.onclick = () => {
      if (this.transferController) {
        this.transferController.abort();
        cancelBtn.disabled = true;
        cancelBtn.setText(t('transferStopping'));
      } else returnToHub(this);
    };

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
    const leftTools = toolbar.createDiv({ attr: { style: 'display:flex; gap:8px; align-items:center;' } });
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
        attr: { style: 'text-align: center; padding: 36px 20px;' }
      });
      const emptyBtnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
      const cancelBtn = emptyBtnRow.createEl('button', { text: t('btnCancel') });
      cancelBtn.onclick = () => {
      if (this.transferController) {
        this.transferController.abort();
        cancelBtn.disabled = true;
        cancelBtn.setText(t('transferStopping'));
      } else returnToHub(this);
    };
      return;
    }

    const listEl = contentEl.createDiv({ cls: 'fm-scroll-list' });
    for (const item of this.items) {
      const row = listEl.createDiv({ cls: 'fm-list-item' });
      const left = row.createDiv({
        attr: { style: 'display:flex; align-items:center; gap:10px; flex:1; overflow:hidden;' }
      });
      const cb = left.createEl('input', { type: 'checkbox', attr: { style: 'cursor:pointer;' } });
      cb.checked = item.selected;
      cb.onchange = () => {
        item.selected = cb.checked;
      };

      renderItemVisualThumb(left, item, this.plugin);

      left.createSpan({
        text: item.displayPath,
        attr: { style: 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:500;' }
      });

      const rightBox = row.createDiv({
        attr: { style: 'display:flex; align-items:center; gap:8px; flex-shrink:0;' }
      });
      rightBox.createSpan({
        text: formatBytes(item.size),
        attr: { style: 'color: var(--text-muted); font-size: 12px;' }
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

    const progressBox = contentEl.createDiv({ attr: { style: 'display:none; margin-bottom:10px;' } });
    const progressText = progressBox.createDiv({ attr: { style: 'font-size:12px; color:var(--text-accent);' } });
    const progressWrap = progressBox.createDiv({ cls: 'fm-progress-wrap' });
    const progressBar = progressWrap.createDiv({ cls: 'fm-progress-bar' });

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const cancelBtn = btnRow.createEl('button', { text: t('btnCancel') });
    cancelBtn.onclick = () => {
      if (this.transferController) {
        this.transferController.abort();
        cancelBtn.disabled = true;
        cancelBtn.setText(t('transferStopping'));
      } else returnToHub(this);
    };
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
      this.transferController = new AbortController();
      try {
      await this.plugin.executeBatchMigrateSafely(
        selected,
        { ...this.options, signal: this.transferController.signal },
        (cur, total, name) => {
          const pct = Math.round((cur / Math.max(1, total)) * 100);
          progressBar.style.width = `${pct}%`;
          progressText.setText(t('migrateProgress', { current: cur, total, name }));
        },
        (summary) => {
          this.step = 3;
          this.summary = summary;
          if (!this.transferClosed) this.render();
        }
      );
      } catch (err) {
        new Notice(err.message);
        runBtn.disabled = false;
        backBtn.disabled = false;
      } finally { this.transferController = null; }
    };
  }

  renderStep3(contentEl) {
    const t = (k, p) => this.plugin.t(k, p);
    const count = this.summary?.count || 0;
    const failures = this.summary?.failures || [];
    const processedItems = this.summary?.processedItems || [];

    const isPartial = failures.length > 0 && count > 0;
    const isError = count === 0 && failures.length > 0;
    const titleKey = this.summary?.cancelled ? 'transferCancelled' : isError
      ? 'batchResultErrorTitle'
      : (isPartial ? 'batchResultWarningTitle' : 'batchResultTitle');

    contentEl.createEl('h3', { text: t(titleKey) });

    const bannerCls = isError
      ? 'fm-result-banner fm-result-banner-error'
      : (isPartial ? 'fm-result-banner fm-result-banner-warning' : 'fm-result-banner fm-result-banner-success');
    const banner = contentEl.createDiv({ cls: bannerCls });
    banner.createDiv({ cls: 'fm-result-banner-title', text: t(titleKey) });

    const trashedText = this.summary?.trashed
      ? t('noticeBatchMigrateTrashedPart', { trashed: this.summary.trashed })
      : '';
    const failText = failures.length > 0
      ? t('batchResultFailuresPart', { count: failures.length })
      : '';
    const trashFailures = this.summary?.trashFailures || [];
    const trashFailText = trashFailures.length > 0
      ? t('batchResultTrashFailuresPart', { count: trashFailures.length })
      : '';

    banner.createDiv({
      cls: 'fm-result-banner-desc',
      text: t('batchResultDesc', {
        count,
        docs: this.summary?.docs || 0,
        trashed: trashedText
      }) + failText + trashFailText
    });

    if (processedItems.length > 0) {
      const listBox = contentEl.createDiv({
        cls: 'fm-section-box',
        attr: { style: 'margin-top: 10px;' }
      });
      listBox.createDiv({
        text: t('batchResultListTitle', { count: processedItems.length }),
        cls: 'fm-section-title'
      });
      const listEl = listBox.createDiv({
        cls: 'fm-scroll-list',
        attr: { style: 'max-height: 220px; margin-bottom: 0;' }
      });
      for (const pItem of processedItems) {
        const row = listEl.createDiv({ cls: 'fm-list-item' });
        const left = row.createDiv({
          attr: { style: 'display:flex; align-items:center; gap:10px; flex:1; overflow:hidden;' }
        });
        renderItemVisualThumb(left, pItem, this.plugin);
        const nameCol = left.createDiv({
          attr: { style: 'display:flex; flex-direction:column; overflow:hidden; flex:1;' }
        });
        nameCol.createSpan({
          text: pItem.name,
          attr: { style: 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:500;' }
        });
        nameCol.createSpan({
          text: `${pItem.displayPath} · ${formatBytes(pItem.size || 0)}`,
          attr: { style: 'font-size:11px; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;' }
        });

        const rightBox = row.createDiv({
          attr: { style: 'display:flex; align-items:center; gap:6px; flex-shrink:0;' }
        });
        if (pItem.rawUrl) {
          const copyBtn = rightBox.createEl('button', {
            cls: 'clickable-icon',
            attr: { 'aria-label': t('copyRawUrl') || 'Copy URL' }
          });
          setIcon(copyBtn, 'copy');
          copyBtn.onclick = async (e) => {
            e.stopPropagation();
            await navigator.clipboard.writeText(pItem.rawUrl);
            new Notice(t('noticeCopied'));
          };
        }
      }
    }

    if (failures.length > 0) {
      const failBox = contentEl.createDiv({
        cls: 'fm-section-box',
        attr: { style: 'margin-top: 10px; border-color: rgba(239, 68, 68, 0.4);' }
      });
      failBox.createDiv({
        text: t('batchFailuresTitle', { count: failures.length }),
        cls: 'fm-section-title',
        attr: { style: 'color: var(--text-error);' }
      });
      for (const f of failures) {
        failBox.createDiv({
          cls: 'fm-result-banner-desc',
          text: `• ${f.path || f.name} (${formatBytes(f.size || 0)}): ${f.error}`,
          attr: { style: 'font-size: 12px; color: var(--text-muted); margin-top: 2px;' }
        });
      }
    }

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    let createdReportPath = null;

    const exportBtn = btnRow.createEl('button', { text: t('batchExportReport') });
    exportBtn.onclick = async () => {
      exportBtn.disabled = true;
      try {
        createdReportPath = await this.plugin.exportBatchMigrateReportToRoot(this.summary);
        exportBtn.setText(t('batchReportExported'));
        if (!btnRow.querySelector('.fm-open-report-btn')) {
          const openBtn = btnRow.createEl('button', {
            text: t('batchOpenReport'),
            cls: 'fm-open-report-btn'
          });
          openBtn.onclick = () => {
            if (createdReportPath) {
              this.app.workspace.openLinkText(createdReportPath, '', true);
            }
            this.close();
          };
        }
      } catch (err) {
        new Notice('❌ ' + err.message);
        exportBtn.disabled = false;
      }
    };

    if (this.summary?.cancelled) btnRow.createSpan({ text: t('transferCancelled') });
    if (this.summary?.retryItems?.length) {
      const retry = btnRow.createEl('button', { text: t('transferRetry') });
      retry.onclick = () => {
        this.items = this.summary.retryItems.map((item) => ({ ...item, selected: true, refNotes: item.refNotes || [] }));
        this.step = 2;
        this.render();
      };
    }
    const doneBtn = btnRow.createEl('button', { text: t('destBtnDone'), cls: 'mod-cta' });
    doneBtn.onclick = () => returnToHub(this);
  }

  onClose() {
    this.transferClosed = true;
    this.transferController?.abort();
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
      attr: { style: 'font-size: 13px; color: var(--text-muted); margin-bottom: 14px;' }
    });

    const box = contentEl.createDiv({ cls: 'fm-section-box' });
    box.createDiv({ text: t('healthScopeTitle'), cls: 'fm-section-title' });

    this.createCheckbox(box, t('healthCheckWiki'), 'checkWikiLinks');
    this.createCheckbox(box, t('healthCheckLocal'), 'checkLocalMarkdown');
    this.createCheckbox(box, t('healthCheckRemote'), 'checkRemote');

    const progressWidget = createScanProgressWidget(contentEl, this.plugin);
    this.activeProgress = progressWidget;

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const cancelBtn = btnRow.createEl('button', { text: t('btnCancel') });
    cancelBtn.onclick = () => returnToHub(this);

    const startBtn = btnRow.createEl('button', { text: t('healthStartScan'), cls: 'mod-cta' });
    startBtn.onclick = async () => {
      if (!this.options.checkWikiLinks && !this.options.checkLocalMarkdown && !this.options.checkRemote) {
        return;
      }
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
    const leftTools = toolbar.createDiv({ attr: { style: 'display:flex; gap:8px; align-items:center;' } });
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
        attr: { style: 'text-align: center; padding: 36px 20px; font-weight: 500;' }
      });
      const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
      const closeBtn = btnRow.createEl('button', { text: t('closeBtn') });
      closeBtn.onclick = () => returnToHub(this);
      return;
    }

    const filterRow = contentEl.createDiv({
      attr: { style: 'display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:10px; flex-wrap:wrap;' }
    });
    const chipBox = filterRow.createDiv({ attr: { style: 'display:flex; gap:6px;' } });
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
      attr: { style: 'padding: 4px 10px; border-radius: 6px; border: 1px solid var(--background-modifier-border); min-width: 180px;' }
    });
    searchInput.oninput = (e) => {
      this.searchQuery = e.target.value.toLowerCase();
      this.renderIssueList(listEl);
    };

    const listEl = contentEl.createDiv({ cls: 'fm-scroll-list', attr: { style: 'max-height: 380px;' } });
    this.renderIssueList(listEl);

    const bottomRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const closeBtn = bottomRow.createEl('button', { text: t('closeBtn') });
    closeBtn.onclick = () => returnToHub(this);
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
        attr: { style: 'text-align: center; padding: 24px;' }
      });
      return;
    }

    for (const item of filtered) {
      const row = listEl.createDiv({ cls: 'fm-list-item' });
      const leftCol = row.createDiv({
        attr: { style: 'display:flex; flex-direction:column; gap:4px; flex:1; overflow:hidden;' }
      });

      const topMeta = leftCol.createDiv({ attr: { style: 'display:flex; align-items:center; gap:6px;' } });
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
      topMeta.createEl('code', { text: item.target, attr: { style: 'font-size: 12px; font-weight: 600;' } });
      topMeta.createSpan({
        text: t('healthLine', { line: item.line }),
        attr: { style: 'font-size: 11px; color: var(--text-muted); margin-left: auto;' }
      });

      const noteRef = leftCol.createDiv({
        attr: { style: 'font-size: 12px; color: var(--text-muted); display:flex; align-items:center; gap:4px;' }
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
        attr: { style: 'flex-shrink:0; align-self:center;' }
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
      attr: { style: 'text-align: center; padding: 32px 20px;' }
    });

    try {
      this.stats = await this.plugin.scanVaultAnalytics();
      loadingEl.remove();
      this.renderDashboard(contentEl);
    } catch (err) {
      loadingEl.setText(t('analyticsFail', { err: err.message }));
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
      attr: { style: 'display:grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 8px;' }
    });

    const localCard = summaryRow.createDiv({
      attr: { style: 'padding: 12px; border-radius: 8px; background: var(--background-primary); border: 1px solid var(--background-modifier-border);' }
    });
    localCard.createDiv({ text: t('analyticsLocalVault'), attr: { style: 'font-weight: 600; font-size: 13px;' } });
    localCard.createDiv({
      text: `${s.local.totalCount} · ${formatBytes(s.local.totalBytes)} (${localPct}%)`,
      attr: { style: 'font-size: 15px; font-weight: 700; margin-top: 4px; color: var(--text-accent);' }
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
      attr: { style: 'font-size: 11px; color: var(--text-muted); margin-top: 6px;' }
    });

    const remoteCard = summaryRow.createDiv({
      attr: { style: 'padding: 12px; border-radius: 8px; background: var(--background-primary); border: 1px solid var(--background-modifier-border);' }
    });
    remoteCard.createDiv({ text: t('analyticsRemoteServer'), attr: { style: 'font-weight: 600; font-size: 13px;' } });
    remoteCard.createDiv({
      text: `${s.remote.totalCount} · ${formatBytes(s.remote.rawBytes)} (${remotePct}%)`,
      attr: { style: 'font-size: 15px; font-weight: 700; margin-top: 4px; color: #10b981;' }
    });
    remoteCard.createDiv({
      text: t('analyticsRemoteStats', {
        cache: formatBytes(s.remote.cacheBytes),
        locked: s.remote.lockedCount
      }),
      attr: { style: 'font-size: 11px; color: var(--text-muted); margin-top: 6px;' }
    });

    if (s.topLargestAttachments.length > 0) {
      const topBox = contentEl.createDiv({ cls: 'fm-section-box' });
      topBox.createDiv({ text: t('analyticsTopLargest'), cls: 'fm-section-title' });
      const listEl = topBox.createDiv({ cls: 'fm-scroll-list', attr: { style: 'max-height: 210px;' } });
      for (const item of s.topLargestAttachments) {
        const row = listEl.createDiv({ cls: 'fm-list-item' });
        const badge = item.source === 'local' ? t('analyticsBadgeLocal') : t('analyticsBadgeRemote');
        row.createSpan({
          text: `${badge} · ${item.path}`,
          attr: { style: 'font-size: 12px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;' }
        });
        row.createSpan({
          text: formatBytes(item.size),
          attr: { style: 'font-size: 12px; font-weight: 600; color: var(--text-muted); flex-shrink: 0;' }
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
    closeBtn.onclick = () => returnToHub(this);
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
      const box = contentEl.createDiv({ cls: 'fm-section-box', attr: { style: 'text-align:center; padding:40px 16px;' } });
      box.createDiv({ text: this.t('galleryLoading'), attr: { style: 'font-size:14px; color:var(--text-accent);' } });
      return;
    }

    if (this.error) {
      const box = contentEl.createDiv({ cls: 'fm-result-banner fm-result-banner-error' });
      box.createDiv({ cls: 'fm-result-banner-title', text: this.t('galleryLoadFail', { err: this.error }) });
      const retryBtn = box.createEl('button', { text: this.t('galleryBtnRefresh'), cls: 'fm-mini-btn', attr: { style: 'margin-top:8px;' } });
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
    return filterRemoteGallery(this);
  }

  renderGrid(containerEl, countLabel) {
    renderRemoteGallery(this, containerEl, countLabel);
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
      const box = contentEl.createDiv({ cls: 'fm-section-box', attr: { style: 'text-align:center; padding:30px 12px;' } });
      box.createDiv({ text: this.t('galleryLoading'), attr: { style: 'font-size:12px; color:var(--text-accent);' } });
      return;
    }

    if (this.error) {
      const box = contentEl.createDiv({ cls: 'fm-result-banner fm-result-banner-error', attr: { style: 'margin:8px 0;' } });
      box.createDiv({ cls: 'fm-result-banner-title', text: this.t('galleryLoadFail', { err: this.error }), attr: { style: 'font-size:12px;' } });
      const retryBtn = box.createEl('button', { text: this.t('galleryBtnRefresh'), cls: 'fm-mini-btn', attr: { style: 'margin-top:6px;' } });
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
    return filterRemoteGallery(this);
  }

  renderGrid(containerEl, countLabel) {
    renderRemoteGallery(this, containerEl, countLabel);
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

    const isRemote = Boolean(this.plugin?.isRemoteServerReady?.());
    const openFromHub = (modal) => {
      modal.fromHub = true;
      this.plugin.openModalSafely(modal);
    };

    const govActions = [
      {
        icon: 'link',
        title: t('actHealthTitle'),
        desc: t('actHealthDesc'),
        run: () => openFromHub(new HealthCheckModal(this.app, this.plugin))
      },
      {
        icon: 'files',
        title: t('actDupTitle'),
        desc: t('actDupDesc'),
        run: () => openFromHub(new DuplicateWizardModal(this.app, this.plugin))
      },
      {
        icon: 'search',
        title: t('actOrphanTitle'),
        desc: t('actOrphanDesc'),
        run: () => openFromHub(new OrphanWizardModal(this.app, this.plugin))
      }
    ];

    govActions.push({
      icon: 'bar-chart-3',
      title: t('actAnalyticsTitle'),
      desc: t('actAnalyticsDesc'),
      run: () => openFromHub(new VaultAnalyticsModal(this.app, this.plugin))
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
            run: () => openFromHub(new RemoteGalleryModal(this.app, this.plugin))
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
            run: () => openFromHub(new BatchMigrateWizardModal(this.app, this.plugin))
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
            run: () => this.plugin.migrateActiveNoteAttachments(null, { fromHub: true })
          },
          {
            icon: 'download',
            title: t('actNoteDownTitle'),
            desc: t('actNoteDownDesc'),
            run: () => this.plugin.downloadActiveNoteRemoteAttachments(null, { fromHub: true })
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

/**
 * Operation & Debug Log Viewer/Exporter Modal
 */
class OperationLogModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.filterMode = 'all'; // 'all' | 'errors'
    this.searchQuery = '';
  }

  t(k, p) {
    return this.plugin ? this.plugin.t(k, p) : k;
  }

  async onOpen() {
    if (this.plugin?.loadOperationLogs) {
      await this.plugin.loadOperationLogs();
    }
    this.render();
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('fm-wizard-modal');

    const header = contentEl.createDiv({ cls: 'fm-step-header' });
    header.createEl('h3', { text: this.t('opLogTitle'), cls: 'fm-step-title' });

    contentEl.createDiv({
      text: this.t('opLogPathHint', { path: this.plugin?.getLogFilePath?.() || '.obsidian/plugins/file-master/operation.log' }),
      attr: { style: 'font-size: 12px; color: var(--text-muted); margin-bottom: 12px;' }
    });

    const allLogs = Array.isArray(this.plugin?.operationLogs) ? [...this.plugin.operationLogs].reverse() : [];
    const errCount = allLogs.filter((e) => e.level === 'ERROR' || e.level === 'WARN').length;

    const filterRow = contentEl.createDiv({
      attr: { style: 'display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:10px; flex-wrap:wrap;' }
    });
    const chipBox = filterRow.createDiv({ attr: { style: 'display:flex; gap:6px;' } });

    const allBtn = chipBox.createEl('button', {
      text: `${this.t('opLogFilterAll')} (${allLogs.length})`,
      cls: this.filterMode === 'all' ? 'mod-cta' : ''
    });
    allBtn.onclick = () => {
      this.filterMode = 'all';
      this.render();
    };

    const errBtn = chipBox.createEl('button', {
      text: `${this.t('opLogFilterErrors')} (${errCount})`,
      cls: this.filterMode === 'errors' ? 'mod-cta' : ''
    });
    errBtn.onclick = () => {
      this.filterMode = 'errors';
      this.render();
    };

    const searchInput = filterRow.createEl('input', {
      type: 'search',
      placeholder: this.t('opLogSearchPlaceholder'),
      value: this.searchQuery,
      attr: { style: 'padding: 4px 10px; border-radius: 6px; border: 1px solid var(--background-modifier-border); min-width: 190px;' }
    });

    const listEl = contentEl.createDiv({
      cls: 'fm-scroll-list',
      attr: { style: 'max-height: 360px;' }
    });

    searchInput.oninput = (e) => {
      this.searchQuery = e.target.value.toLowerCase();
      this.renderLogList(listEl, allLogs);
    };

    this.renderLogList(listEl, allLogs);

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row', attr: { style: 'justify-content: space-between; flex-wrap: wrap; gap: 8px;' } });
    const leftBtns = btnRow.createDiv({ attr: { style: 'display: flex; gap: 8px; flex-wrap: wrap;' } });

    const copyBtn = leftBtns.createEl('button', { text: this.t('opLogCopyAll'), cls: 'mod-cta' });
    copyBtn.onclick = async () => {
      const text = this.plugin?.formatLogsForExport?.() || '';
      await navigator.clipboard.writeText(text);
      new Notice(this.t('opLogCopiedNotice'));
    };

    const exportBtn = leftBtns.createEl('button', { text: this.t('opLogExportFile') });
    exportBtn.onclick = () => {
      const text = this.plugin?.formatLogsForExport?.() || '';
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const now = new Date();
      const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
      a.href = url;
      a.download = `file-master-debug-${dateStr}.log`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    };

    const clearBtn = leftBtns.createEl('button', { text: this.t('opLogClear') });
    clearBtn.onclick = async () => {
      if (this.plugin?.clearOperationLogs) {
        await this.plugin.clearOperationLogs();
      }
      new Notice(this.t('opLogClearedNotice'));
      this.render();
    };

    const closeBtn = btnRow.createEl('button', { text: this.t('closeBtn') });
    closeBtn.onclick = () => this.close();
  }

  renderLogList(listEl, allLogs) {
    listEl.empty();
    let filtered = allLogs;
    if (this.filterMode === 'errors') {
      filtered = filtered.filter((e) => e.level === 'ERROR' || e.level === 'WARN');
    }
    if (this.searchQuery) {
      filtered = filtered.filter((e) => {
        const hay = `${e.ts || ''} ${e.level || ''} ${e.action || ''} ${e.summary || ''} ${e.details ? JSON.stringify(e.details) : ''}`.toLowerCase();
        return hay.includes(this.searchQuery);
      });
    }

    if (filtered.length === 0) {
      listEl.createDiv({
        cls: 'fm-section-box',
        text: this.t('opLogEmpty'),
        attr: { style: 'text-align: center; padding: 28px 16px; color: var(--text-muted);' }
      });
      return;
    }

    for (const entry of filtered) {
      const row = listEl.createDiv({ cls: 'fm-list-item' });
      const col = row.createDiv({
        attr: { style: 'display:flex; flex-direction:column; gap:4px; flex:1; overflow:hidden;' }
      });

      const topRow = col.createDiv({
        attr: { style: 'display:flex; align-items:center; gap:6px; flex-wrap:wrap;' }
      });
      let levelCls = 'fm-tag-info';
      if (entry.level === 'ERROR') levelCls = 'fm-tag-error';
      else if (entry.level === 'WARN') levelCls = 'fm-tag-warning';

      topRow.createSpan({ text: entry.level || 'INFO', cls: `fm-tag ${levelCls}` });
      if (entry.action) {
        topRow.createEl('code', { text: entry.action, attr: { style: 'font-size: 11px;' } });
      }
      topRow.createSpan({
        text: entry.ts || '',
        attr: { style: 'font-size: 11px; color: var(--text-muted); margin-left: auto;' }
      });

      col.createDiv({
        text: entry.summary || '',
        attr: { style: 'font-size: 12px; font-weight: 500; word-break: break-word;' }
      });

      if (entry.details && Object.keys(entry.details).length > 0) {
        col.createDiv({
          text: JSON.stringify(entry.details),
          cls: 'fm-health-context-quote',
          attr: { style: 'font-family: var(--font-monospace); font-size: 11px; word-break: break-all;' }
        });
      }
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
