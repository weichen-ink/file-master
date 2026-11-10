class FileMasterVaultUtils extends FileMasterLifecycle {
  isDocFile(file) {
    return isDocFile(file, this.app);
  }

  isScannableDocFile(file) {
    return Boolean(file) && this.isDocFile(file) && !isReportFile(file.name);
  }

  isExcalidrawFile(file, content = null) {
    return isExcalidrawFile(file, this.app, content);
  }

  reloadOpenExcalidrawViews(filePath) {
    if (!filePath || !this.app?.workspace) return;
    try {
      const leaves = this.app.workspace.getLeavesOfType('excalidraw');
      for (const leaf of leaves) {
        const viewFile = leaf.view?.file;
        if (viewFile && (viewFile.path === filePath || viewFile.name === filePath)) {
          if (typeof leaf.view.reload === 'function') {
            leaf.view.reload();
          } else if (typeof leaf.rebuildView === 'function') {
            leaf.rebuildView();
          } else if (typeof leaf.setViewState === 'function') {
            const state = leaf.getViewState();
            leaf.setViewState(state);
          }
        }
      }
    } catch (err) {
      console.warn('[FileMaster] Could not reload Excalidraw view:', err);
    }
  }

  async safeModifyFileContent(tfile, transformFn) {
    let changed = false;
    if (typeof this.app.vault.process === 'function') {
      await this.app.vault.process(tfile, (data) => {
        const next = transformFn(data);
        if (next !== data) changed = true;
        return next;
      });
    } else {
      const orig = await this.app.vault.read(tfile);
      const next = transformFn(orig);
      if (next !== orig) {
        await this.app.vault.modify(tfile, next);
        changed = true;
      }
    }

    if (changed && this.isExcalidrawFile(tfile)) {
      this.reloadOpenExcalidrawViews(tfile.path);
    }

    return changed;
  }

  openModalSafely(modal) {
    setTimeout(() => {
      modal.open();
      if (modal.bgEl) {
        modal.bgEl.style.pointerEvents = 'none';
        setTimeout(() => {
          if (modal.bgEl) modal.bgEl.style.pointerEvents = '';
        }, 250);
      }
    }, 40);
  }

  updateSidebarRibbonButton() {
    if (this.sidebarRibbonEl) {
      this.sidebarRibbonEl.remove();
      this.sidebarRibbonEl = null;
    }
    if (this.settings.enableSidebarButton === false) {
      return;
    }
    this.sidebarRibbonEl = this.addRibbonIcon(
      'layers',
      this.t('hubTitle'),
      () => {
        this.openModalSafely(new FileMasterHubModal(this.app, this));
      }
    );
  }

  getExcludedLocalFolderList() {
    return String(this.settings.excludedLocalFolders || '')
      .split(/[,;\n]+/)
      .map((s) => s.trim().replace(/^\/+|\/+$/g, ''))
      .filter(Boolean);
  }

  isLocalPathExcluded(filePath) {
    const p = String(filePath || '').replace(/^\/+/, '');
    const list = this.getExcludedLocalFolderList();
    return list.some((folder) => p === folder || p.startsWith(folder + '/'));
  }

  async toggleLocalFolderExclusion(folderPath) {
    const clean = String(folderPath || '').replace(/^\/+|\/+$/g, '');
    if (!clean) return;
    const list = this.getExcludedLocalFolderList();
    const idx = list.indexOf(clean);
    if (idx > -1) {
      list.splice(idx, 1);
      new Notice(this.t('noticeExclRemoved', { path: clean }));
    } else {
      list.push(clean);
      new Notice(this.t('noticeExclAdded', { path: clean }));
    }
    this.settings.excludedLocalFolders = list.join(', ');
    await this.saveSettings();
  }

  getAllVaultFolderPaths() {
    const folderSet = new Set();
    for (const f of this.app.vault.getFiles()) {
      const parentPath = f.parent?.path;
      if (parentPath && parentPath !== '/') {
        folderSet.add(parentPath);
      }
    }
    return [...folderSet].sort();
  }

  async getItemPreviewUrl(item) {
    const ext = getExt(item.name);
    if (!IMAGE_EXTS.has(ext)) return null;

    if (item.source === 'remote') {
      return item.rawObj?.rawUrl || null;
    }

    const tfile = item.rawObj;
    if (!tfile) return null;

    if (NEEDS_TRANSCODE_IMAGE_EXTS.has(ext)) {
      const cacheKey = `${tfile.path}:${tfile.stat?.mtime || 0}`;
      let previewUrl = this.heicPreviewCache.get(cacheKey);
      if (!previewUrl) {
        const buf = await this.app.vault.readBinary(tfile);
        previewUrl = await convertBufferToPreviewUrl(buf, ext, this);
        this.heicPreviewCache.set(cacheKey, previewUrl);
      }
      return previewUrl;
    }

    return this.app.vault.getResourcePath(tfile);
  }
}
