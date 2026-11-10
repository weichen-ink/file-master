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
