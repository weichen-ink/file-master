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
