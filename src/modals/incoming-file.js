import { modalTitle } from '../ui/navigation.js';
import { getItemPreviewUrl, revokeBlobUrl, refreshRemoteImageCache } from '../plugin/vault-utils.js';
import { checkUploadConflicts } from '../plugin/server-client.js';
import { insertLinkAtTarget } from '../plugin/editor-target.js';
import { AUDIO_EXTS, IMAGE_EXTS } from '../constants.js';
import { computeSha256Hex, convertBufferToPreviewUrl, formatBytes, getExt, sanitizeCleanBaseName } from '../engine.js';
import { translateUi } from '../i18n.js';
import { formatFriendlyError } from './common.js';
import { ImageLightboxModal } from './dialogs.js';
import { fileMetaItem, renderItemVisualThumb } from '../ui/file-action-list.js';
import { Notice, setIcon } from 'obsidian';
import { FileMasterModal as Modal } from '../ui/modal.js';
export { renderItemVisualThumb };

export class IncomingFileModal extends Modal {
  constructor(app, fileInfo, options, callback = null) {
    super(app);
    this.fileInfo = fileInfo; // { arrayBuffer, defaultBaseName, ext, size, mimeType, sha256 }
    this.options = options || {};   // { askLocation, fixedLocation, plugin, editor, activeFile }
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
    this.conflict = null;
    this.conflictStrategy = null;
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
    } else if (this.step === 'conflict') {
      this.renderConflictStep();
    } else if (this.step === 'executing') {
      this.renderExecutingStep();
    } else if (this.step === 'result') {
      this.renderResultStep();
    }
  }

  renderInputStep() {
    const { contentEl } = this;

    // 1. Clean Title Header
    modalTitle(this, this.t('destTitle'), 'paperclip');

    // A stable preview card sits beside the editable fields.
    const layout = contentEl.createDiv({ cls: 'fm-incoming-layout' });
    const card = layout.createDiv({ cls: 'fm-gallery-card fm-incoming-card' });
    const thumbWrap = card.createDiv({ cls: 'fm-gallery-thumb-wrap fm-incoming-thumb-wrap' });

    if (IMAGE_EXTS.has(this.fileInfo.ext)) {
      const img = thumbWrap.createEl('img', { cls: 'fm-gallery-thumb fm-incoming-thumb-img', attr: { alt: this.finalFilename } });
      convertBufferToPreviewUrl(this.fileInfo.arrayBuffer, this.fileInfo.ext, this.plugin)
        .then((url) => {
          if (!url) return;
          if (this.closed) {
            revokeBlobUrl(url);
            return;
          }
          revokeBlobUrl(this.previewBlobUrl);
          this.previewBlobUrl = url;
          img.src = url;
        })
        .catch(() => { });
    } else {
      const ext = this.fileInfo.ext;
      const icon = ext === 'md' ? '📝' : AUDIO_EXTS.has(ext) ? '🎵' : ['mp4', 'webm', 'mov', 'mkv'].includes(ext) ? '🎬' : ext === 'pdf' ? '📄' : '📦';
      thumbWrap.addClass('fm-gallery-placeholder');
      thumbWrap.createSpan({ text: icon, attr: { style: 'font-size: 24px;' } });
    }

    const assetInfo = card.createDiv({ cls: 'fm-gallery-info fm-incoming-asset-info' });
    assetInfo.createDiv({ cls: 'fm-incoming-asset-name', text: this.finalFilename });
    const subMeta = assetInfo.createDiv({ cls: 'fm-gallery-meta fm-incoming-sub-meta' });
    fileMetaItem(subMeta, 'hard-drive', formatBytes(this.fileInfo.size));
    const formEl = layout.createDiv({ cls: 'fm-incoming-form' });
    const editCol = formEl.createDiv({ cls: 'fm-incoming-edit-col' });
    editCol.createEl('label', { text: this.t('destFilenameLabel'), cls: 'fm-incoming-label', attr: { for: 'fm-incoming-filename' } });
    const inputRow = editCol.createDiv({ cls: 'fm-incoming-input-row' });
    const nameInput = inputRow.createEl('input', {
      type: 'text',
      value: this.fileInfo.defaultBaseName,
      cls: 'fm-incoming-name-input',
      attr: {
        id: 'fm-incoming-filename',
        placeholder: this.t('destFilenameHint'),
        spellcheck: 'false'
      }
    });
    inputRow.createSpan({ text: `.${this.fileInfo.ext}`, cls: 'fm-incoming-ext-badge' });
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

    formEl.createDiv({
      cls: 'fm-incoming-label',
      text: this.t('destDestTitle'),
      attr: { id: 'fm-incoming-destination' }
    });

    const grid = formEl.createDiv({ cls: 'fm-incoming-dest-grid', attr: { role: 'radiogroup', 'aria-labelledby': 'fm-incoming-destination' } });

    // Local Option Card
    const localCard = grid.createEl('button', {
      attr: { type: 'button', role: 'radio', 'aria-checked': String(this.targetLocation === 'local') },
      cls: `fm-incoming-dest-card ${this.targetLocation === 'local' ? 'is-selected' : ''}`
    });
    const localTitle = localCard.createDiv({ cls: 'fm-incoming-dest-card-title' });
    setIcon(localTitle.createSpan({ cls: 'fm-incoming-option-icon', attr: { 'aria-hidden': 'true' } }), 'hard-drive');
    localTitle.createSpan({ text: this.t('destSaveLocal') });
    const localCheck = localCard.createSpan({ cls: 'fm-incoming-dest-card-check' });
    setIcon(localCheck, 'check');

    // Remote Option Card (only rendered if remote server is enabled and ready)
    let remoteCard = null;
    let remoteCheck = null;
    if (isRemoteReady) {
      remoteCard = grid.createEl('button', {
        attr: { type: 'button', role: 'radio', 'aria-checked': String(this.targetLocation === 'remote') },
        cls: `fm-incoming-dest-card ${this.targetLocation === 'remote' ? 'is-selected' : ''}`
      });
      const remoteTitle = remoteCard.createDiv({ cls: 'fm-incoming-dest-card-title' });
      setIcon(remoteTitle.createSpan({ cls: 'fm-incoming-option-icon', attr: { 'aria-hidden': 'true' } }), 'cloud');
      remoteTitle.createSpan({ text: this.t('destSaveRemote') });
      remoteCheck = remoteCard.createSpan({ cls: 'fm-incoming-dest-card-check' });
      setIcon(remoteCheck, 'check');
    }

    const updateSelection = (loc) => {
      this.targetLocation = loc;
      localCard.setAttribute('aria-checked', String(loc === 'local'));
      localCard.setAttribute('tabindex', loc === 'local' ? '0' : '-1');
      remoteCard?.setAttribute('tabindex', loc === 'remote' ? '0' : '-1');
      remoteCard?.setAttribute('aria-checked', String(loc === 'remote'));
      if (loc === 'local') {
        localCard.addClass('is-selected');
        if (remoteCard) remoteCard.removeClass('is-selected');
      } else {
        localCard.removeClass('is-selected');
        if (remoteCard) remoteCard.addClass('is-selected');
      }
    };

    updateSelection(this.targetLocation);
    if (isAskMode) {
      localCard.onclick = () => updateSelection('local');
      if (remoteCard) {
        remoteCard.onclick = () => updateSelection('remote');
      }
      const cards = [localCard, remoteCard].filter(Boolean);
      cards.forEach((card, index) => {
        card.onkeydown = event => {
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? cards.length - 1
            : (index + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) + cards.length) % cards.length;
          updateSelection(next === 0 ? 'local' : 'remote');
          cards[next].focus();
        };
      });
    } else {
      localCard.disabled = true;
      localCard.style.cursor = 'default';
      if (remoteCard) { remoteCard.disabled = true; remoteCard.style.cursor = 'default'; }
      let hintText = '';
      if (isRemoteFallback) {
        hintText = this.t('destFixedRemoteFallbackHint');
      } else if (this.targetLocation === 'local') {
        hintText = this.t('destFixedLocalHint');
      } else {
        hintText = this.t('destFixedRemoteHint');
      }
      formEl.createDiv({
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

    let isComposing = false;
    let lastCompositionEndAt = 0;
    nameInput.addEventListener('compositionstart', () => {
      isComposing = true;
    });
    nameInput.addEventListener('compositionend', () => {
      isComposing = false;
      lastCompositionEndAt = Date.now();
    });

    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (e.isComposing || e.keyCode === 229 || isComposing || (Date.now() - lastCompositionEndAt < 80)) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        triggerExecute();
      }
    });

    contentEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (e.isComposing || e.keyCode === 229 || isComposing || (Date.now() - lastCompositionEndAt < 80)) {
          return;
        }
        const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
        if (tag === 'textarea' || tag === 'button' || tag === 'input') return;
        e.preventDefault();
        triggerExecute();
      }
    });

    // 4. Action Buttons (Cancel & Insert)
    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const cancelBtn = btnRow.createEl('button', { text: this.t('btnCancel') });
    cancelBtn.onclick = () => {
      this.isDone = true;
      this.close();
      if (this.callback) this.callback({ target: null });
    };

    const insertBtn = btnRow.createEl('button', { text: this.t('btnInsert') || '插入', cls: 'mod-cta' });
    insertBtn.onclick = () => triggerExecute();
  }

  renderConflictStep() {
    const { contentEl } = this;
    const conflict = this.conflict || {};
    modalTitle(this, this.t('uploadConflictTitle'), 'alert-triangle');

    const localThumbUrl = this.previewObjectUrl || (IMAGE_EXTS.has(this.fileInfo.ext)
      ? (() => {
        this.previewObjectUrl = URL.createObjectURL(new Blob([this.fileInfo.arrayBuffer], { type: this.fileInfo.mimeType || 'image/png' }));
        return this.previewObjectUrl;
      })()
      : '');

    const localPreviewItem = {
      source: 'local',
      name: this.finalFilename,
      filename: this.finalFilename,
      ext: this.fileInfo.ext,
      size: this.fileInfo.size,
      rawObj: null,
      loadPreviewUrl: localThumbUrl
        ? async () => URL.createObjectURL(new Blob([this.fileInfo.arrayBuffer], { type: this.fileInfo.mimeType || 'image/png' }))
        : null
    };
    const remotePreviewItem = {
      source: 'remote',
      name: conflict.filename || this.finalFilename,
      filename: conflict.filename || this.finalFilename,
      ext: getExt(conflict.filename || this.finalFilename),
      size: conflict.size || 0,
      year: conflict.year,
      month: conflict.month,
      locked: Boolean(conflict.locked),
      rawObj: conflict
    };

    const compare = contentEl.createDiv({ cls: 'fm-conflict-compare' });
    const renderCard = (item, label, previewUrl) => {
      const column = compare.createDiv({ cls: 'fm-conflict-column' });
      column.createDiv({ cls: 'fm-incoming-label', text: label });
      const card = column.createDiv({ cls: 'fm-gallery-card fm-conflict-file-card' });
      const preview = card.createDiv({ cls: 'fm-gallery-thumb-wrap fm-conflict-preview' });
      if (previewUrl && IMAGE_EXTS.has(item.ext)) {
        const image = preview.createEl('img', {
          cls: 'fm-gallery-thumb fm-conflict-preview-img',
          attr: { src: previewUrl, alt: item.name, title: this.t('thumbEnlargeTooltip') }
        });
        image.onclick = () => new ImageLightboxModal(this.app, this.plugin, item).open();
      } else {
        preview.addClass('fm-gallery-placeholder');
        setIcon(preview.createSpan({ cls: 'fm-conflict-preview-empty' }), 'file');
      }
      const info = card.createDiv({ cls: 'fm-gallery-info fm-conflict-file-info' });
      info.createDiv({ cls: 'fm-conflict-file-name', text: item.name, attr: { title: item.name } });
      const meta = info.createDiv({ cls: 'fm-gallery-meta fm-conflict-file-meta' });
      fileMetaItem(meta, 'hard-drive', formatBytes(item.size));
      if (item.year && item.month) {
        meta.createSpan({ cls: 'fm-meta-sep', attr: { 'aria-hidden': 'true' } });
        fileMetaItem(meta, 'folder', `${item.year}/${item.month}`, { cls: 'fm-file-location' });
      }
      if (item.locked) {
        meta.createSpan({ cls: 'fm-meta-sep', attr: { 'aria-hidden': 'true' } });
        fileMetaItem(meta, 'lock', this.t('activeNoteBtnLockOn'));
      }
    };
    renderCard(localPreviewItem, this.t('uploadConflictLocal'), localThumbUrl);
    renderCard(remotePreviewItem, this.t('uploadConflictRemote'), conflict.rawUrl);

    const activeConflict = conflict;
    const extSuffix = `.${this.fileInfo.ext}`;
    const initialBase = this.finalFilename.replace(/\.[^.]+$/, '');
    const normalizeBase = (v) => String(v || '').trim().replace(/[\s_]+/g, '_').toLowerCase();
    const resolution = contentEl.createDiv({ cls: 'fm-conflict-resolution' });

    const getOptions = (targetConflict) => {
      const list = [
        {
          id: 'rename',
          title: this.t('uploadConflictBtnRename'),
          desc: this.t('uploadConflictDescRename'),
          run: null
        }
      ];
      if (targetConflict.rawUrl) {
        list.push({
          id: 'reuse',
          title: this.t('uploadConflictBtnUseRemote'),
          desc: this.t('uploadConflictDescUseRemote'),
          run: () => {
            const activeFile = this.options.activeFile || this.app.workspace.getActiveFile();
            const sourcePath = activeFile ? activeFile.path : '';
            this.finalizeRemoteResult(Object.assign({}, activeConflict, { reusedExisting: true }), this.options.editor, sourcePath);
            this.completeExecution();
          }
        });
      }
      {
        list.push({
          id: 'replace',
          unavailable: targetConflict.code !== 'NAME_CONFLICT' || targetConflict.locked,
          reason: this.t(targetConflict.locked ? 'uploadConflictLockedHint' : 'uploadConflictReservedHint'),
          title: this.t('uploadConflictBtnReplace'),
          desc: this.t('uploadConflictDescReplace'),
          danger: true,
          run: () => {
            if (this.isExecuting || targetConflict.locked || targetConflict.code !== 'NAME_CONFLICT') return;
            this.isExecuting = true;
            this.finalFilename = targetConflict.filename || this.finalFilename;
            this.conflictTarget = targetConflict;
            this.conflictStrategy = 'replace';
            this.step = 'executing';
            this.render();
            this.runExecution();
          }
        });
      }
      list.push({
        id: 'local',
        title: this.t('uploadConflictBtnSaveLocal'),
        desc: this.t('uploadConflictDescSaveLocal'),
        run: () => {
          if (this.isExecuting) return;
          this.isExecuting = true;
          this.targetLocation = 'local';
          this.conflict = null;
          this.conflictStrategy = null;
          this.step = 'executing';
          this.render();
          this.runExecution();
        }
      });
      return list;
    };

    resolution.createDiv({
      cls: 'fm-incoming-label',
      text: this.t('uploadConflictActionTitle'),
      attr: { id: 'fm-conflict-actions-title' }
    });
    let options = getOptions(activeConflict);
    let selectedId = options[0].id;
    const grid = resolution.createDiv({ cls: 'fm-incoming-dest-grid fm-conflict-options', attr: { role: 'radiogroup', 'aria-labelledby': 'fm-conflict-actions-title' } });
    const descHint = resolution.createDiv({
      text: options[0].desc, cls: 'fm-conflict-option-hint', attr: { role: 'status' }
    });

    const renameWrap = resolution.createDiv({
      cls: 'fm-conflict-rename'
    });
    renameWrap.createEl('label', { cls: 'fm-incoming-label', text: this.t('uploadConflictNewFilenameLabel'), attr: { for: 'fm-conflict-filename' } });
    const renameRow = renameWrap.createDiv({ cls: 'fm-incoming-input-row' });
    const renameInput = renameRow.createEl('input', {
      type: 'text',
      value: initialBase,
      cls: 'fm-incoming-name-input',
      attr: {
        id: 'fm-conflict-filename',
        placeholder: this.t('destFilenameHint'),
        spellcheck: 'false'
      }
    });
    renameRow.createSpan({ text: extSuffix, cls: 'fm-incoming-ext-badge' });
    const renameFeedback = renameWrap.createDiv({
      cls: 'fm-conflict-feedback'
    });

    const cardMap = new Map();
    let checkTimer = null;
    let checkSeq = 0;
    let lastCheckedName = '';
    let lastCheckedItem = null;

    const buildTargetName = () => {
      const cleanBase = sanitizeCleanBaseName(renameInput.value, '');
      return cleanBase ? `${cleanBase}${extSuffix}` : '';
    };

    const setConfirmEnabled = (enabled) => {
      confirmBtn.disabled = !enabled;
    };

    const renderOptionCards = () => {
      grid.empty();
      cardMap.clear();
      for (const opt of options) {
        const card = grid.createDiv({
          cls: `fm-incoming-dest-card${opt.danger ? ' is-danger' : ''}${opt.id === selectedId ? ' is-selected' : ''}`,
          attr: { tabindex: opt.id === selectedId ? '0' : '-1', role: 'radio', 'aria-checked': String(opt.id === selectedId), 'aria-disabled': String(Boolean(opt.unavailable)), title: opt.unavailable ? opt.reason : '' }
        });
        const titleEl = card.createDiv({ cls: 'fm-incoming-dest-card-title' });
        titleEl.createSpan({ text: opt.title });
        const checkEl = card.createSpan({ cls: 'fm-incoming-dest-card-check' });
        setIcon(checkEl, 'check');
        card.onclick = () => { selectOption(opt.id); card.focus(); };
        card.onkeydown = (e) => {
          const navigation = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
          if (navigation.includes(e.key)) {
            e.preventDefault();
            const index = options.findIndex(o => o.id === selectedId);
            const next = e.key === 'Home' ? 0 : e.key === 'End' ? options.length - 1
              : (index + (['ArrowLeft', 'ArrowUp'].includes(e.key) ? -1 : 1) + options.length) % options.length;
            selectOption(options[next].id);
            cardMap.get(options[next].id)?.focus();
          } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            selectOption(opt.id);
          }
        };
        cardMap.set(opt.id, card);
      }
    };

    const syncConfirmState = () => {
      const opt = options.find((o) => o.id === selectedId);
      if (opt) {
        confirmBtn.textContent = opt.title;
        confirmBtn.toggleClass('mod-warning', Boolean(opt.danger));
      }
      if (selectedId !== 'rename') {
        setConfirmEnabled(true);
        return;
      }
      const raw = String(renameInput.value || '').trim();
      const targetName = buildTargetName();
      const changed = Boolean(raw) && Boolean(targetName) && normalizeBase(raw) !== normalizeBase(initialBase);
      if (!changed) {
        setConfirmEnabled(false);
        return;
      }
      if (lastCheckedName === targetName && lastCheckedItem?.status === 'conflict') {
        setConfirmEnabled(false);
        return;
      }
      setConfirmEnabled(true);
    };

    const selectOption = (id) => {
      const choice = options.find(o => o.id === id);
      if (choice?.unavailable) { descHint.textContent = choice.reason; return; }
      selectedId = id;
      for (const [optId, el] of cardMap.entries()) {
        const isSel = optId === id;
        el.toggleClass('is-selected', isSel);
        el.setAttribute('aria-checked', String(isSel));
        el.setAttribute('tabindex', isSel ? '0' : '-1');
      }
      const opt = options.find((o) => o.id === id);
      if (opt) descHint.textContent = opt.desc;
      renameWrap.style.display = id === 'rename' ? '' : 'none';
      syncConfirmState();
      if (id === 'rename') {
        renameInput.focus();
      }
    };

    const showRenameConflict = (targetName) => {
      // Keep both comparison cards and the confirmed overwrite identity unchanged.
      renameFeedback.empty();
      renameFeedback.createSpan({ text: this.t('uploadConflictRenameExists', { name: targetName }), cls: 'fm-conflict-name-error' });
      renameInput.setAttribute('aria-invalid', 'true');
      syncConfirmState();
    };

    renameInput.addEventListener('input', () => {
      if (checkTimer) {
        clearTimeout(checkTimer);
        checkTimer = null;
      }
      const raw = String(renameInput.value || '').trim();
      const targetName = buildTargetName();
      const changed = Boolean(raw) && Boolean(targetName) && normalizeBase(raw) !== normalizeBase(initialBase);
      renameFeedback.empty();
      renameInput.setAttribute('aria-invalid', 'false');
      if (!changed) {
        lastCheckedName = '';
        lastCheckedItem = null;
        syncConfirmState();
        return;
      }
      if (lastCheckedName === targetName && lastCheckedItem?.status === 'conflict') {
        showRenameConflict(targetName);
        return;
      }
      syncConfirmState();
      const seq = ++checkSeq;
      checkTimer = setTimeout(async () => {
        if (this.closed || seq !== checkSeq) return;
        renameFeedback.empty();
        renameFeedback.createSpan({
          text: this.t('uploadConflictChecking'),
          attr: { style: 'color: var(--text-muted);' }
        });
        const results = await checkUploadConflicts(this.plugin, [{ filename: targetName }]);
        if (this.closed || seq !== checkSeq || buildTargetName() !== targetName) return;
        const item = results[0] || { status: 'unavailable' };
        lastCheckedName = targetName;
        lastCheckedItem = item;
        if (item.status === 'conflict' && item.conflict) {
          showRenameConflict(targetName);
        } else if (item.status === 'ok' || item.status === 'instant') {
          renameFeedback.empty();
          renameFeedback.createSpan({
            text: this.t('uploadConflictRenameAvailable'),
            attr: { style: 'color: var(--text-success, #16a34a);' }
          });
          syncConfirmState();
        } else {
          renameFeedback.empty();
          renameFeedback.createSpan({
            text: this.t('uploadConflictCheckUnavailable'),
            attr: { style: 'color: var(--text-muted);' }
          });
          syncConfirmState();
        }
      }, 220);
    });

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const cancelBtn = btnRow.createEl('button', { text: this.t('btnCancel') });
    cancelBtn.onclick = () => {
      if (checkTimer) clearTimeout(checkTimer);
      this.isDone = true;
      this.close();
      if (this.callback) this.callback({ target: null });
    };
    const confirmBtn = btnRow.createEl('button', { cls: 'mod-cta', text: this.t('btnConfirm') || 'Confirm' });
    confirmBtn.onclick = async () => {
      if (selectedId !== 'rename') {
        const opt = options.find((o) => o.id === selectedId);
        if (opt && !opt.unavailable && opt.run) opt.run();
        return;
      }
      const targetName = buildTargetName();
      if (!targetName || confirmBtn.disabled) return;
      if (lastCheckedName !== targetName) {
        setConfirmEnabled(false);
        renameFeedback.empty();
        renameFeedback.createSpan({
          text: this.t('uploadConflictChecking'),
          attr: { style: 'color: var(--text-muted);' }
        });
        const results = await checkUploadConflicts(this.plugin, [{ filename: targetName }]);
        if (this.closed) return;
        // A pending name check must not submit an action the user has since changed.
        if (selectedId !== 'rename' || buildTargetName() !== targetName) {
          syncConfirmState();
          return;
        }
        const item = results[0] || { status: 'unavailable' };
        lastCheckedName = targetName;
        lastCheckedItem = item;
        if (item.status === 'conflict' && item.conflict) {
          showRenameConflict(targetName);
          renameInput.focus();
          renameInput.select();
          return;
        }
      }
      if (this.isExecuting) return;
      this.finalFilename = targetName;
      this.conflict = null;
      this.conflictStrategy = null;
      this.isExecuting = true;
      this.step = 'executing';
      this.render();
      this.runExecution();
    };

    renderOptionCards();
    syncConfirmState();
  }

  finalizeRemoteResult(res, editor, sourcePath) {
    this.finalFilename = res.filename || this.finalFilename;
    const useOpt =
      this.plugin.settings.insertOptimizedLinkOnUpload &&
      res.optimizationEnabled !== false &&
      res.category === 'image' &&
      res.pubUrl;
    let finalMarkdown = useOpt
      ? `![](${res.pubUrl})`
      : (res.markdown || `[${this.finalFilename}](${res.rawUrl})`);

    if (IMAGE_EXTS.has(this.fileInfo.ext) && !finalMarkdown.startsWith('!')) {
      finalMarkdown = `!${finalMarkdown}`;
    }

    let inserted = false;
    let insertionWarning = null;
    if (editor || this.options.insertionTarget) {
      const insertResult = insertLinkAtTarget(this.plugin, finalMarkdown, this.options.insertionTarget);
      inserted = insertResult.inserted;
      insertionWarning = insertResult.reason || null;
    }

    this.result = {
      success: true,
      target: 'remote',
      res,
      finalMarkdown,
      isInstant: !!res.isInstant,
      reusedExisting: !!res.reusedExisting,
      inserted,
      insertionWarning
    };
    this.plugin?.logOperation?.('INFO', 'UPLOAD_REMOTE', `${res.reusedExisting ? 'Selected server version' : res.isInstant ? 'Reused identical remote content' : 'Uploaded attachment to server'}: ${this.finalFilename}`, {
      remotePath: `${res.year}/${res.month}/${res.filename}`,
      isInstant: !!res.isInstant,
      reusedExisting: !!res.reusedExisting,
      size: this.fileInfo.size,
      note: sourcePath || null
    });
  }

  completeExecution() {
    if (this.callback) {
      this.callback({ target: this.targetLocation, finalFilename: this.finalFilename, result: this.result });
    }
    if (this.result?.success && this.result?.inserted) {
      const noticeMsg = this.result.target === 'remote'
        ? (this.plugin ? this.plugin.t('noticeUploadedRemote', { name: this.finalFilename }) : `已上传到服务器并插入链接：${this.finalFilename}`)
        : this.t('destInsertSuccess');
      new Notice(noticeMsg);
      this.isDone = true;
      this.close();
      return;
    }
    if (this.result?.success) {
      if (this.result.insertionWarning) {
        new Notice(this.result.insertionWarning);
        this.step = 'result';
        this.render();
        return;
      }
      new Notice(this.t('destInsertSuccess'));
      this.isDone = true;
      this.close();
      return;
    }
    new Notice(`❌ ${this.result?.error || 'Insert failed'}`);
    this.isDone = true;
    this.close();
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

        let inserted = false;
        let insertionWarning = null;
        if (editor || this.options.insertionTarget) {
          const insertResult = insertLinkAtTarget(this.plugin, mdLink, this.options.insertionTarget);
          inserted = insertResult.inserted;
          insertionWarning = insertResult.reason || null;
        }

        if (this.progressBar) this.progressBar.style.width = '100%';
        this.result = {
          success: true,
          target: 'local',
          localPath: createdFile.path,
          mdLink,
          inserted,
          insertionWarning
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
        const probed = this.conflictStrategy === 'replace' ? null : await this.plugin.probeRemoteSha256(sha256);
        if (probed && probed.exists) {
          res = Object.assign({}, probed, { isInstant: true });
          if (this.progressBar) this.progressBar.style.width = '100%';
          if (this.statusLabel) this.statusLabel.setText(this.t('destInstantBadge'));
        } else {
          // 2. Stream upload to server
          if (this.progressBar) this.progressBar.style.width = '55%';
          if (this.statusLabel) this.statusLabel.setText(this.t('destUploadingRemote'));

          const uploadOpts = { skipProbe: true, conflictStrategy: this.conflictStrategy || undefined };
          if (this.conflictStrategy === 'replace' && this.conflictTarget) {
            uploadOpts.conflictTargetYear = this.conflictTarget.year || '';
            uploadOpts.conflictTargetMonth = this.conflictTarget.month || '';
            uploadOpts.conflictTargetFilename = this.conflictTarget.filename || '';
            uploadOpts.conflictTargetSha256 = this.conflictTarget.sha256 || '';
          }
          res = await this.plugin.uploadBufferToServer(
            this.fileInfo.arrayBuffer,
            this.finalFilename,
            this.fileInfo.mimeType || 'application/octet-stream',
            uploadOpts
          );
          if (this.progressBar) this.progressBar.style.width = '100%';
        }

        this.finalizeRemoteResult(res, editor, sourcePath);
        if (this.conflictStrategy === 'replace' && res) {
          refreshRemoteImageCache(this.plugin, [res.rawUrl, res.pubUrl].filter(Boolean)).catch(() => { });
        }
      }
    } catch (err) {
      this.isExecuting = false;
      if (err?.status === 409 && err?.conflict) {
        this.conflict = err.conflict;
        this.step = 'conflict';
        this.render();
        return;
      }
      this.result = {
        success: false,
        error: err.message || String(err)
      };
      this.plugin?.logOperation?.('ERROR', 'SAVE_ATTACHMENT', `Failed to process attachment "${this.finalFilename}": ${this.result.error}`, {
        target: this.targetLocation,
        size: this.fileInfo.size
      });
    }

    this.completeExecution();
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
        text: this.result.reusedExisting ? this.t('uploadReusedBadge') : isInstant ? this.t('destInstantBadge') : this.t('destSuccessBadge')
      });
      if (this.result.reusedExisting) banner.createDiv({ cls: 'fm-result-banner-desc', text: this.t('uploadReusedDesc') });
      if (isInstant) banner.createDiv({ cls: 'fm-result-banner-desc', text: this.t('destInstantDesc') });

      const detailsBox = contentEl.createDiv({ cls: 'fm-section-box' });
      detailsBox.createDiv({
        text: `📄 ${this.finalFilename}  |  ${formatBytes(this.result.reusedExisting ? this.result.res.size : this.fileInfo.size)}`,
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

      const detailsBox = contentEl.createDiv({ cls: 'fm-section-box' });
      detailsBox.createDiv({
        text: `📄 ${this.finalFilename}  |  ${formatBytes(this.result.reusedExisting ? this.result.res.size : this.fileInfo.size)}`,
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
    this.closed = true;
    revokeBlobUrl(this.previewBlobUrl);
    revokeBlobUrl(this.previewObjectUrl);
    this.previewBlobUrl = null;
    this.previewObjectUrl = null;
    if (!this.isDone && this.callback) {
      this.callback({ target: null });
    }
    this.contentEl.empty();
  }
}
