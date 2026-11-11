import { modalTitle } from '../ui/navigation.js';
import { getItemPreviewUrl } from '../plugin/vault-utils.js';
import { AUDIO_EXTS, IMAGE_EXTS } from '../constants.js';
import { computeSha256Hex, convertBufferToPreviewUrl, formatBytes, getExt, sanitizeCleanBaseName } from '../engine.js';
import { translateUi } from '../i18n.js';
import { formatFriendlyError } from './common.js';
import { ImageLightboxModal } from './dialogs.js';
import { Notice, setIcon } from 'obsidian';
import { FileMasterModal as Modal } from '../ui/modal.js';

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
      new ImageLightboxModal(plugin.app, plugin, item).open();
    };
  }
}

export class IncomingFileModal extends Modal {
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
    this.modalEl?.addClass?.('fm-incoming-dialog');
    this.render();
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
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
    modalTitle(this, this.t('destTitle'));

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
    modalTitle(this, this.t('destProcessingTitle'));

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
    modalTitle(this, this.t('destResultTitle'));

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
