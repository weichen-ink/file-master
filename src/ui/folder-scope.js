import { Notice, setIcon } from 'obsidian';
import { getAllVaultFolderPaths, normalizeFolderPath } from '../plugin/vault-utils.js';

/**
 * Reusable folder include/exclude scope selector for scan wizards.
 * Mutates `scope.includeFolders` and `scope.excludeFolders` in place for this scan only.
 */
export function renderFolderScopeSection(parentEl, plugin, scope, options = {}) {
  const t = (k, p) => plugin.t(k, p);
  const allFolders = getAllVaultFolderPaths(plugin.app);
  if (!Array.isArray(scope.includeFolders)) scope.includeFolders = [];
  if (!Array.isArray(scope.excludeFolders)) scope.excludeFolders = [];

  const box = parentEl.createDiv({ cls: 'fm-section-box fm-folder-scope-box' });
  box.createDiv({ text: t(options.titleKey || 'folderScopeTitle'), cls: 'fm-section-title' });

  const allFolderSet = new Set(allFolders);
  const commitCallbacks = [];

  const renderField = (fieldKey, labelKey, placeholderKey, emptyHintKey) => {
    const field = box.createDiv({ cls: 'fm-folder-scope-field' });
    field.createDiv({ text: t(labelKey), cls: 'fm-folder-scope-label' });

    const chipsEl = field.createDiv({ cls: 'fm-folder-chips' });
    const pickerWrap = field.createDiv({ cls: 'fm-folder-picker' });
    const input = pickerWrap.createEl('input', {
      type: 'text',
      cls: 'fm-folder-input',
      attr: {
        placeholder: t(placeholderKey),
        'aria-label': t(labelKey),
        autocomplete: 'off'
      }
    });
    const dropdown = pickerWrap.createDiv({ cls: 'fm-folder-dropdown' });
    dropdown.style.display = 'none';

    let activeIndex = -1;
    let currentMatches = [];
    let blurTimer = null;
    let isComposing = false;
    let lastCompositionEndAt = -Infinity;

    const cancelBlurTimer = () => {
      if (blurTimer !== null) {
        clearTimeout(blurTimer);
        blurTimer = null;
      }
    };

    const addFolder = (raw, { preserveSpaces = false } = {}) => {
      const exactRaw = normalizeFolderPath(raw);
      const clean = (preserveSpaces || allFolderSet.has(exactRaw))
        ? exactRaw
        : normalizeFolderPath(String(raw || '').trim());
      if (!clean) return;
      if (!scope[fieldKey].includes(clean)) {
        scope[fieldKey].push(clean);
      }
      input.value = '';
      activeIndex = -1;
      renderChips();
      hideDropdown();
    };

    const removeFolder = (folder) => {
      scope[fieldKey] = scope[fieldKey].filter((item) => item !== folder);
      renderChips();
    };

    const hideDropdown = () => {
      cancelBlurTimer();
      dropdown.style.display = 'none';
      activeIndex = -1;
    };

    const renderDropdown = () => {
      cancelBlurTimer();
      const rawValue = String(input.value || '');
      const query = rawValue.trim().toLowerCase();
      const selected = new Set(scope[fieldKey]);
      currentMatches = allFolders
        .filter((folder) => !selected.has(folder) && (!query || folder.toLowerCase().includes(query)))
        .slice(0, 30);

      dropdown.empty();
      if (!currentMatches.length) {
        const exactRaw = normalizeFolderPath(rawValue);
        const clean = allFolderSet.has(exactRaw) ? exactRaw : normalizeFolderPath(rawValue.trim());
        if (clean && !selected.has(clean)) {
          const custom = dropdown.createEl('button', {
            type: 'button',
            cls: 'fm-folder-option is-custom',
            text: t('folderScopeAddCustom', { path: clean })
          });
          custom.onmousedown = (e) => e.preventDefault();
          custom.onclick = () => addFolder(clean, { preserveSpaces: allFolderSet.has(clean) });
          dropdown.style.display = 'block';
          return;
        }
        hideDropdown();
        return;
      }

      if (activeIndex >= currentMatches.length) activeIndex = currentMatches.length - 1;
      currentMatches.forEach((folder, idx) => {
        const opt = dropdown.createEl('button', {
          type: 'button',
          cls: `fm-folder-option${idx === activeIndex ? ' is-active' : ''}`,
          text: `${folder}/`,
          attr: { 'data-folder': folder }
        });
        opt.onmousedown = (e) => e.preventDefault();
        opt.onclick = () => addFolder(folder, { preserveSpaces: true });
      });
      dropdown.style.display = 'block';
    };

    const commitInput = () => {
      const rawValue = String(input.value || '');
      const exactRaw = normalizeFolderPath(rawValue);
      if (!exactRaw) return true;
      if (allFolderSet.has(exactRaw)) {
        addFolder(exactRaw, { preserveSpaces: true });
        return true;
      }
      if (activeIndex >= 0 && currentMatches[activeIndex]) {
        addFolder(currentMatches[activeIndex], { preserveSpaces: true });
        return true;
      }
      const trimmed = normalizeFolderPath(rawValue.trim());
      if (!trimmed) return true;
      if (allFolderSet.has(trimmed)) {
        addFolder(trimmed, { preserveSpaces: true });
        return true;
      }
      const lower = trimmed.toLowerCase();
      const ciMatch = allFolders.find((folder) => folder.toLowerCase() === lower);
      if (ciMatch) {
        addFolder(ciMatch, { preserveSpaces: true });
        return true;
      }
      const selected = new Set(scope[fieldKey]);
      const partialMatches = allFolders.filter((folder) => !selected.has(folder) && folder.toLowerCase().includes(lower));
      if (partialMatches.length === 1) {
        addFolder(partialMatches[0], { preserveSpaces: true });
        return true;
      }
      if (partialMatches.length > 1) {
        renderDropdown();
        input.focus?.();
        new Notice(t('folderScopeAmbiguous', { query: trimmed }));
        return false;
      }
      addFolder(trimmed);
      return true;
    };
    commitCallbacks.push(commitInput);

    const renderChips = () => {
      chipsEl.empty();
      const list = scope[fieldKey];
      if (!list.length) {
        if (emptyHintKey) {
          chipsEl.createSpan({ text: t(emptyHintKey), cls: 'fm-folder-empty-hint' });
        }
        return;
      }
      for (const folder of list) {
        const chip = chipsEl.createSpan({ cls: `fm-folder-chip is-${fieldKey === 'excludeFolders' ? 'exclude' : 'include'}` });
        const iconSpan = chip.createSpan({ cls: 'fm-folder-chip-icon', attr: { 'aria-hidden': 'true' } });
        setIcon(iconSpan, 'folder');
        chip.createSpan({ text: `${folder}/`, cls: 'fm-folder-chip-text', attr: { title: folder } });
        const removeBtn = chip.createEl('button', {
          type: 'button',
          cls: 'fm-folder-chip-remove',
          attr: { 'aria-label': t('folderScopeRemove', { path: folder }) }
        });
        setIcon(removeBtn, 'x');
        removeBtn.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          removeFolder(folder);
        };
      }
    };

    input.onfocus = () => {
      cancelBlurTimer();
      renderDropdown();
    };
    input.oninput = () => {
      activeIndex = -1;
      renderDropdown();
    };
    input.onblur = () => {
      cancelBlurTimer();
      blurTimer = setTimeout(() => {
        blurTimer = null;
        hideDropdown();
      }, 120);
    };
    input.addEventListener('compositionstart', () => { isComposing = true; });
    input.addEventListener('compositionend', () => {
      isComposing = false;
      lastCompositionEndAt = Date.now();
    });
    input.onkeydown = (e) => {
      if (e.isComposing || e.keyCode === 229 || isComposing) return;
      if (e.key === 'ArrowDown' && currentMatches.length) {
        e.preventDefault();
        activeIndex = (activeIndex + 1) % currentMatches.length;
        renderDropdown();
      } else if (e.key === 'ArrowUp' && currentMatches.length) {
        e.preventDefault();
        activeIndex = (activeIndex - 1 + currentMatches.length) % currentMatches.length;
        renderDropdown();
      } else if (e.key === 'Enter') {
        if (Date.now() - lastCompositionEndAt < 80) return;
        e.preventDefault();
        if (activeIndex >= 0 && currentMatches[activeIndex]) {
          addFolder(currentMatches[activeIndex], { preserveSpaces: true });
        } else if (currentMatches.length === 1) {
          addFolder(currentMatches[0], { preserveSpaces: true });
        } else if (normalizeFolderPath(input.value)) {
          commitInput();
        }
      } else if (e.key === 'Escape') {
        hideDropdown();
      }
    };

    renderChips();
  };

  renderField('includeFolders', 'folderScopeIncludeLabel', 'folderScopeIncludePlaceholder', 'folderScopeAllVault');
  renderField('excludeFolders', 'folderScopeExcludeLabel', 'folderScopeExcludePlaceholder', 'folderScopeNoExclude');

  return {
    box,
    setVisible(visible) {
      box.style.display = visible ? '' : 'none';
    },
    commitPendingInputs() {
      for (const commit of commitCallbacks) {
        if (!commit()) return false;
      }
      return true;
    }
  };
}
