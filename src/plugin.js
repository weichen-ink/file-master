class FileMasterPlugin extends Plugin {
  getEffectiveLanguage() {
    return getEffectiveLanguage(this.settings?.language);
  }

  t(key, params = {}) {
    return translateUi(this.getEffectiveLanguage(), key, params);
  }

  isRemoteServerReady() {
    return Boolean(this.settings?.enableRemoteServer && this.settings?.serverVerified);
  }

  getLogFilePath() {
    const dir = this.manifest?.dir || `${this.app?.vault?.configDir || '.obsidian'}/plugins/${this.manifest?.id || 'file-master'}`;
    return `${dir}/operation.log`;
  }

  async loadOperationLogs() {
    if (!Array.isArray(this.operationLogs)) {
      this.operationLogs = [];
    }
    try {
      const adapter = this.app?.vault?.adapter;
      const logPath = this.getLogFilePath();
      if (adapter && (await adapter.exists(logPath))) {
        const raw = await adapter.read(logPath);
        const parsed = [];
        for (const line of String(raw || '').split('\n')) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            parsed.push(JSON.parse(trimmed));
          } catch { }
        }
        this.operationLogs = parsed.slice(-500);
      }
    } catch { }
    return this.operationLogs;
  }

  async saveOperationLogs() {
    try {
      const adapter = this.app?.vault?.adapter;
      if (!adapter) return;
      const logPath = this.getLogFilePath();
      const lines = (this.operationLogs || []).slice(-500).map((entry) => JSON.stringify(entry));
      await adapter.write(logPath, lines.join('\n') + (lines.length ? '\n' : ''));
    } catch { }
  }

  logOperation(level, action, summary, details = null) {
    if (!Array.isArray(this.operationLogs)) {
      this.operationLogs = [];
    }
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const entry = {
      ts,
      level: String(level || 'INFO').toUpperCase(),
      action: String(action || 'GENERAL'),
      summary: String(summary || '')
    };
    if (details && typeof details === 'object' && Object.keys(details).length > 0) {
      entry.details = details;
    }
    this.operationLogs.push(entry);
    if (this.operationLogs.length > 500) {
      this.operationLogs = this.operationLogs.slice(-500);
    }
    this.saveOperationLogs();
  }

  async clearOperationLogs() {
    this.operationLogs = [];
    await this.saveOperationLogs();
  }

  formatLogsForExport() {
    const version = this.manifest?.version || '1.0.2';
    const serverStatus = this.lastServerCompatStatus
      ? `${this.lastServerCompatStatus.status} (server v${this.lastServerCompatStatus.serverVersion || '?'})`
      : (this.settings?.enableRemoteServer ? 'unverified' : 'disabled');
    const header = [
      `# File Master Diagnostic & Operation Logs`,
      `# Plugin Version: v${version}`,
      `# Exported At: ${new Date().toISOString()}`,
      `# Server Status: ${serverStatus}`,
      `# Excluded Local Folders: ${this.settings?.excludedLocalFolders || '(none)'}`,
      `# Total Entries: ${(this.operationLogs || []).length}`,
      `------------------------------------------------------------`
    ];
    const body = (this.operationLogs || []).map((e) => {
      const detailStr = e.details ? ` | ${JSON.stringify(e.details)}` : '';
      return `[${e.ts}] [${e.level}] [${e.action}] ${e.summary}${detailStr}`;
    });
    return [...header, ...body].join('\n');
  }

  async onload() {
    await this.loadSettings();
    this.operationLogs = [];
    await this.loadOperationLogs();
    this.heicPreviewCache = new Map();
    this.sidebarRibbonEl = null;
    this.lastServerCompatStatus = null;
    this.lastActiveMarkdownView = null;

    // Initialize configurable left sidebar ribbon button
    this.updateSidebarRibbonButton();

    // Register remote asset gallery sidebar view
    this.registerView(
      VIEW_TYPE_REMOTE_GALLERY,
      (leaf) => new RemoteGalleryView(leaf, this)
    );

    // Track active markdown editor leaf changes for reliable cursor insertion
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', (leaf) => {
        if (leaf?.view instanceof MarkdownView) {
          this.lastActiveMarkdownView = leaf.view;
        }
      })
    );
    this.registerEvent(
      this.app.workspace.on('file-open', () => {
        const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (mdView) {
          this.lastActiveMarkdownView = mdView;
        }
      })
    );

    // Auto-init/dock gallery leaf in right sidebar when workspace is ready, persistent like Calendar
    this.app.workspace.onLayoutReady(() => {
      const activeMd = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (activeMd) {
        this.lastActiveMarkdownView = activeMd;
      }
      this.initGalleryLeaf(false);
    });

    // Background non-blocking handshake to verify version contract and connectivity
    setTimeout(() => {
      this.checkServerCompatibility().catch(() => {});
    }, 1200);

    // 1. Listen for clipboard paste events
    this.registerEvent(
      this.app.workspace.on('editor-paste', async (evt, editor) => {
        if (!this.settings.enableClipboardMonitor) return;
        const files = evt.clipboardData?.files;
        if (!files || files.length === 0) return;

        const targetFiles = this.filterAllowedFiles(files);
        if (targetFiles.length === 0) return;

        evt.preventDefault();
        for (const f of targetFiles) {
          await this.handleIncomingBrowserFile(f, editor);
        }
      })
    );

    // 2. Listen for drag-and-drop file events in editor
    this.registerEvent(
      this.app.workspace.on('editor-drop', async (evt, editor) => {
        if (!this.settings.enableClipboardMonitor) return;
        const files = evt.dataTransfer?.files;
        if (!files || files.length === 0) return;

        const targetFiles = this.filterAllowedFiles(files);
        if (targetFiles.length === 0) return;

        evt.preventDefault();
        for (const f of targetFiles) {
          await this.handleIncomingBrowserFile(f, editor);
        }
      })
    );

    // 3. Render inline previews for local ![[xxx.heic]], ![[xxx.heif]], and ![[xxx.tiff]] embeds
    this.setupHeicInlinePreviewObserver();

    // 4. Register file tree context menu items
    this.registerContextMenus();

    // 5. Register core commands
    this.registerPluginCommands();

    this.addSettingTab(new FileMasterSettingTab(this.app, this));
    console.log('[FileMaster] Plugin loaded successfully');
  }

  registerPluginCommands() {
    this.pluginCommandDefs = [
      {
        id: 'open-control-center',
        nameKey: 'cmdOpenHub',
        callback: () => this.openModalSafely(new FileMasterHubModal(this.app, this))
      },
      {
        id: 'open-health-check-wizard',
        nameKey: 'cmdScanHealth',
        callback: () => this.openModalSafely(new HealthCheckModal(this.app, this))
      },
      {
        id: 'open-orphan-wizard',
        nameKey: 'cmdScanOrphan',
        callback: () => this.openModalSafely(new OrphanWizardModal(this.app, this))
      },
      {
        id: 'open-duplicate-wizard',
        nameKey: 'cmdScanDuplicate',
        callback: () => this.openModalSafely(new DuplicateWizardModal(this.app, this))
      },
      {
        id: 'open-remote-gallery',
        nameKey: 'cmdRemoteGallery',
        requiresRemote: true,
        callback: () => this.openModalSafely(new RemoteGalleryModal(this.app, this))
      },
      {
        id: 'open-remote-gallery-view',
        nameKey: 'cmdRemoteGalleryView',
        requiresRemote: true,
        callback: () => this.activateGalleryView()
      },
      {
        id: 'open-batch-migrate-wizard',
        nameKey: 'cmdBatchMigrate',
        requiresRemote: true,
        callback: () => this.openModalSafely(new BatchMigrateWizardModal(this.app, this))
      },
      {
        id: 'open-vault-analytics-dashboard',
        nameKey: 'cmdVaultAnalytics',
        callback: () => this.openModalSafely(new VaultAnalyticsModal(this.app, this))
      },
      {
        id: 'migrate-current-note-attachments',
        nameKey: 'cmdMigrateActiveNote',
        requiresRemote: true,
        callback: () => this.migrateActiveNoteAttachments()
      },
      {
        id: 'download-current-note-remote-attachments',
        nameKey: 'cmdDownloadActiveNote',
        requiresRemote: true,
        callback: () => this.downloadActiveNoteRemoteAttachments()
      },
      {
        id: 'copy-note-with-astro-pub-links',
        nameKey: 'cmdCopyAstroLinks',
        requiresRemote: true,
        callback: () => this.copyActiveNoteForAstro()
      },
      {
        id: 'open-operation-logs',
        nameKey: 'cmdOpenOpLogs',
        callback: () => this.openModalSafely(new OperationLogModal(this.app, this))
      }
    ];

    for (const cmd of this.pluginCommandDefs) {
      this.addCommand({
        id: cmd.id,
        name: this.t(cmd.nameKey),
        checkCallback: (checking) => {
          if (cmd.requiresRemote && !this.isRemoteServerReady()) {
            return false;
          }
          if (checking) return true;
          cmd.callback();
        }
      });
    }
  }

  updateCommandNames() {
    if (!this.pluginCommandDefs || !this.app?.commands?.commands) return;
    for (const cmd of this.pluginCommandDefs) {
      const fullId = `${this.manifest.id}:${cmd.id}`;
      const registered = this.app.commands.commands[fullId];
      if (registered) {
        registered.name = this.t(cmd.nameKey);
      }
    }
  }

  onLanguageChange() {
    this.updateSidebarRibbonButton();
    this.updateCommandNames();
    for (const leaf of this.app?.workspace?.getLeavesOfType?.(VIEW_TYPE_REMOTE_GALLERY) || []) {
      leaf.view?.render?.();
    }
  }

  getCompatibilityMessage(compat) {
    if (!compat) return this.t(this.settings.serverVerified ? 'serverVerifiedBadge' : 'serverUnverifiedHint');
    switch (compat.status) {
      case 'compatible': return this.t('compatStatusOk', { serverVer: compat.serverVersion, count: compat.assetCount || 0 });
      case 'server_outdated': return this.t('compatStatusServerOld', { serverVer: compat.serverVersion, minServerVer: compat.minServerVersion });
      case 'plugin_outdated': return this.t('compatStatusPluginOld', { minPluginVer: compat.minPluginVersion, currentVer: compat.pluginVersion });
      case 'auth_failed': return this.t('compatStatusAuthFail');
      case 'token_missing': return this.t('compatStatusTokenMissing');
      case 'server_error': return this.t('compatStatusServerError', { code: compat.statusCode || '' });
      default: return this.t('compatStatusOffline', { err: compat.error || '' });
    }
  }

  onunload() {
    // Note: Do NOT detach VIEW_TYPE_REMOTE_GALLERY here, allowing Obsidian workspace layout
    // to persist the docked leaf in the right sidebar across reloads/restarts like Calendar.
    if (this.sidebarRibbonEl) {
      this.sidebarRibbonEl.remove();
      this.sidebarRibbonEl = null;
    }
    if (this.heicObserver) {
      this.heicObserver.disconnect();
      this.heicObserver = null;
    }
  }

  async initGalleryLeaf(reveal = false) {
    if (!this.isRemoteServerReady()) return null;
    const { workspace } = this.app;
    let leaves = workspace.getLeavesOfType(VIEW_TYPE_REMOTE_GALLERY);
    let leaf = leaves[0];
    if (!leaf) {
      const rightLeaf = workspace.getRightLeaf(false);
      if (rightLeaf) {
        await rightLeaf.setViewState({
          type: VIEW_TYPE_REMOTE_GALLERY,
          active: false
        });
        leaf = rightLeaf;
      }
    }
    if (leaf && reveal) {
      workspace.revealLeaf(leaf);
    }
    return leaf;
  }

  async activateGalleryView() {
    if (!this.isRemoteServerReady()) {
      new Notice(this.t('remoteServerRequiredNotice') || 'Remote server not ready');
      return;
    }
    await this.initGalleryLeaf(true);
  }

  insertMarkdownToActiveEditor(mdSnippet, successNotice) {
    let mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!mdView && this.lastActiveMarkdownView) {
      const leaves = this.app.workspace.getLeavesOfType('markdown');
      if (leaves.some(l => l.view === this.lastActiveMarkdownView)) {
        mdView = this.lastActiveMarkdownView;
      }
    }
    if (!mdView) {
      const leaves = this.app.workspace.getLeavesOfType('markdown');
      if (leaves.length > 0) {
        const visibleLeaf = leaves.find(l => l.view?.containerEl && l.view.containerEl.isShown?.() !== false);
        mdView = (visibleLeaf || leaves[0]).view;
      }
    }

    const activeFile = mdView?.file || this.app.workspace.getActiveFile();
    if (!activeFile || activeFile.extension !== 'md') {
      new Notice(this.t('galleryOpenNoteFirst') || 'Please open a Markdown note first');
      return false;
    }

    if (mdView?.editor) {
      const editor = mdView.editor;
      editor.replaceSelection(mdSnippet);
      if (mdView.leaf) {
        this.app.workspace.setActiveLeaf(mdView.leaf, { focus: true });
      }
      editor.focus();
      if (successNotice) new Notice(successNotice);
      return true;
    } else {
      this.safeModifyFileContent(activeFile, (content) => content + '\n' + mdSnippet).then(() => {
        if (successNotice) new Notice(successNotice);
      });
      return true;
    }
  }

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

  registerContextMenus() {
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, abstractFile) => {
        if (!abstractFile) return;

        if (Array.isArray(abstractFile.children)) {
          const folderPath = abstractFile.path;
          if (!folderPath || folderPath === '/') return;

          if (this.isRemoteServerReady()) {
            menu.addItem((item) => {
              item
                .setTitle(this.t('menuMigrateFolder'))
                .setIcon('upload-cloud')
                .onClick(() => {
                  new BatchMigrateWizardModal(this.app, this, folderPath).open();
                });
            });
          }

          const isExcluded = this.isLocalPathExcluded(folderPath);
          menu.addItem((item) => {
            item
              .setTitle(isExcluded ? this.t('menuRemoveExclusion') : this.t('menuAddExclusion'))
              .setIcon('shield')
              .onClick(() => {
                this.toggleLocalFolderExclusion(folderPath);
              });
          });
          return;
        }

        if (abstractFile.extension && isAttachmentExt(abstractFile.extension)) {
          if (this.isRemoteServerReady()) {
            menu.addItem((item) => {
              item
                .setTitle(this.t('menuUploadCloud'))
                .setIcon('upload-cloud')
                .onClick(async () => {
                  await this.migrateSingleLocalFileToRemote(abstractFile, {
                    deleteLocal: this.settings.deleteLocalAfterMigrate
                  });
                });
            });
          }
          return;
        }

        const isNoteOrExcalidraw =
          abstractFile.extension === 'md' ||
          abstractFile.extension === 'excalidraw' ||
          this.isExcalidrawFile(abstractFile);

        if (isNoteOrExcalidraw && this.isRemoteServerReady()) {
          menu.addItem((item) => {
            item
              .setTitle(this.t('menuActiveNoteMigrate'))
              .setIcon('upload-cloud')
              .onClick(() => {
                this.migrateActiveNoteAttachments(abstractFile);
              });
          });

          menu.addItem((item) => {
            item
              .setTitle(this.t('menuActiveNoteDownload'))
              .setIcon('download-cloud')
              .onClick(() => {
                this.downloadActiveNoteRemoteAttachments(abstractFile);
              });
          });

          menu.addItem((item) => {
            item
              .setTitle(this.t('menuActiveNoteAstro'))
              .setIcon('external-link')
              .onClick(() => {
                this.copyActiveNoteForAstro(abstractFile);
              });
          });
        }
      })
    );

    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu, editor) => {
        if (!this.isRemoteServerReady()) return;
        const cursor = editor.getCursor();
        const lineText = editor.getLine(cursor.line) || '';
        if (!lineText.trim()) return;

        const remoteMatch = this.extractRemoteItemFromLine(lineText);
        if (remoteMatch) {
          menu.addItem((item) => {
            item
              .setTitle(this.t('menuCopyRaw', { name: remoteMatch.filename }))
              .setIcon('copy')
              .onClick(async () => {
                await navigator.clipboard.writeText(remoteMatch.matchedUrl);
                new Notice(this.t('noticeCopiedRaw', { name: remoteMatch.filename }));
              });
          });

          menu.addItem((item) => {
            item
              .setTitle(this.t('menuCopyWebp'))
              .setIcon('zap')
              .onClick(async () => {
                const base = getBaseName(remoteMatch.filename);
                const optUrl = `${this.getCleanServerUrl()}/pub/${remoteMatch.year}/${remoteMatch.month}/${encodeURIComponent(base)}.webp`;
                await navigator.clipboard.writeText(optUrl);
                new Notice(this.t('noticeCopiedWebp', { name: base + '.webp' }));
              });
          });

          menu.addItem((item) => {
            item
              .setTitle(this.t('menuDownloadToVault', { name: remoteMatch.filename }))
              .setIcon('download')
              .onClick(async () => {
                await this.downloadSingleRemoteItemToLocal(remoteMatch);
              });
          });

          menu.addItem((item) => {
            item
              .setTitle(this.t('menuLockRemote', { name: remoteMatch.filename }))
              .setIcon('lock')
              .onClick(async () => {
                try {
                  await this.toggleRemoteFileLock(
                    remoteMatch.year,
                    remoteMatch.month,
                    remoteMatch.filename,
                    true
                  );
                  new Notice(this.t('noticeProtectedRemote', { name: remoteMatch.filename }));
                } catch (err) {
                  new Notice(this.t('noticeLockFailed', { err: err.message }));
                }
              });
          });
        }

        const localTFile = this.extractLocalAttachmentFromLine(lineText);
        if (localTFile) {
          menu.addItem((item) => {
            item
              .setTitle(`${this.t('menuUploadCloud')} (${localTFile.name})`)
              .setIcon('upload-cloud')
              .onClick(async () => {
                await this.migrateSingleLocalFileToRemote(localTFile, {
                  toProtected: false,
                  deleteLocal: this.settings.deleteLocalAfterMigrate
                });
              });
          });
        }
      })
    );
  }

  extractRemoteItemFromLine(lineText) {
    const serverBase = escapeRegExp(this.getCleanServerUrl());
    const re = new RegExp(
      `(${serverBase}\\/([^/\\s)]+)\\/(protected|\\d{4})\\/(keep|\\d{2})\\/([^)\\s]+))`,
      'i'
    );
    const m = re.exec(lineText);
    if (!m) return null;
    let filename = m[5];
    try {
      filename = decodeURIComponent(filename);
    } catch { }
    return {
      matchedUrl: m[1],
      routePrefix: m[2],
      year: m[3],
      month: m[4],
      filename
    };
  }

  extractLocalAttachmentFromLine(lineText) {
    const activeFile = this.app.workspace.getActiveFile();
    const sourcePath = activeFile ? activeFile.path : '';

    const wikiMatch = /!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/.exec(lineText);
    if (wikiMatch) {
      const tf = this.app.metadataCache.getFirstLinkpathDest(wikiMatch[1].trim(), sourcePath);
      if (tf && isAttachmentExt(tf.extension)) return tf;
    }

    const mdMatch = /!?\[[^\]]*\]\((?!https?:\/\/)([^)]+)\)/.exec(lineText);
    if (mdMatch) {
      let linkPath = mdMatch[1].trim();
      try {
        linkPath = decodeURIComponent(linkPath);
      } catch { }
      const tf = this.app.metadataCache.getFirstLinkpathDest(linkPath, sourcePath);
      if (tf && isAttachmentExt(tf.extension)) return tf;
    }
    return null;
  }

  setupHeicInlinePreviewObserver() {
    const scanEmbeds = () => {
      const embeds = document.querySelectorAll('.internal-embed[src]');
      embeds.forEach((el) => {
        const rawSrc = el.getAttribute('src') || '';
        const cleanSrc = rawSrc.split('#')[0].split('|')[0].trim();
        const ext = getExt(cleanSrc);
        if (!NEEDS_TRANSCODE_IMAGE_EXTS.has(ext)) return;
        if (el.dataset.fmHeicStatus === 'done' || el.dataset.fmHeicStatus === 'loading') return;

        el.dataset.fmHeicStatus = 'loading';
        this.renderSingleHeicEmbed(el, cleanSrc, ext).catch(() => {
          el.dataset.fmHeicStatus = 'error';
        });
      });
    };

    this.app.workspace.onLayoutReady(() => {
      scanEmbeds();
      this.heicObserver = new MutationObserver(() => scanEmbeds());
      this.heicObserver.observe(document.body, { childList: true, subtree: true });
    });

    this.registerEvent(this.app.workspace.on('layout-change', () => scanEmbeds()));
    this.registerEvent(this.app.workspace.on('file-open', () => setTimeout(scanEmbeds, 80)));
  }

  async renderSingleHeicEmbed(embedEl, linkPath, ext) {
    const activeFile = this.app.workspace.getActiveFile();
    const sourcePath = activeFile ? activeFile.path : '';
    let tfile = this.app.metadataCache.getFirstLinkpathDest(linkPath, sourcePath);
    if (!tfile) {
      tfile = this.app.vault.getFiles().find((f) => f.path === linkPath || f.name === linkPath);
    }
    if (!tfile) {
      embedEl.dataset.fmHeicStatus = 'missing';
      return;
    }

    const cacheKey = `${tfile.path}:${tfile.stat?.mtime || 0}`;
    let previewUrl = this.heicPreviewCache.get(cacheKey);
    if (!previewUrl) {
      const buf = await this.app.vault.readBinary(tfile);
      previewUrl = await convertBufferToPreviewUrl(buf, ext, this);
      this.heicPreviewCache.set(cacheKey, previewUrl);
    }

    embedEl.empty();
    embedEl.removeClass('file-embed', 'mod-generic');
    embedEl.addClass('image-embed', 'is-loaded');
    const img = embedEl.createEl('img', {
      attr: {
        src: previewUrl,
        alt: tfile.name
      }
    });
    img.style.maxWidth = '100%';
    img.style.borderRadius = '6px';
    img.style.display = 'block';
    embedEl.dataset.fmHeicStatus = 'done';
  }

  filterAllowedFiles(fileList) {
    const out = [];
    for (let i = 0; i < fileList.length; i++) {
      const f = fileList[i];
      const ext = getExt(f.name) || (f.type.startsWith('image/') ? 'png' : '');
      if (IMAGE_EXTS.has(ext)) {
        out.push(f);
      } else if (this.settings.uploadNonImageAttachments && isAttachmentExt(ext)) {
        out.push(f);
      }
    }
    return out;
  }

  getCleanServerUrl() {
    return String(this.settings.serverUrl || 'http://localhost:3000').replace(/\/+$/, '');
  }

  async handleIncomingBrowserFile(file, editor) {
    const arrayBuffer = await file.arrayBuffer();
    const ext = getExt(file.name) || (file.type.startsWith('image/') ? 'png' : 'bin');
    const rawOriginBase = sanitizeCleanBaseName(getBaseName(file.name), 'Pasted_image');
    const sha256 = await computeSha256Hex(arrayBuffer);
    const activeFile = this.app.workspace.getActiveFile();
    const noteName = activeFile ? activeFile.basename : 'note';

    let defaultBaseName = rawOriginBase;
    if (this.settings.namingMode === 'rule') {
      defaultBaseName = applyNamingPattern(this.settings.namingPattern, {
        noteName,
        originBase: rawOriginBase,
        sha256
      });
    } else if (/^image$/i.test(rawOriginBase)) {
      defaultBaseName = `Pasted_${applyNamingPattern('{date}_{time}', { noteName, originBase: rawOriginBase, sha256 })}`;
    }

    const askLocation = this.settings.saveLocationMode === 'ask';
    const promptRename = this.settings.namingMode === 'prompt';

    const fileInfo = {
      arrayBuffer,
      defaultBaseName,
      ext,
      size: file.size || arrayBuffer.byteLength,
      mimeType: file.type || 'application/octet-stream',
      sha256
    };

    const modalOptions = {
      askLocation,
      fixedLocation: this.settings.saveLocationMode,
      promptRename,
      plugin: this,
      editor,
      activeFile
    };

    new IncomingFileModal(this.app, fileInfo, modalOptions).open();
  }

  async probeRemoteSha256(sha256) {
    try {
      const serverUrl = this.getCleanServerUrl();
      if (!serverUrl || !this.settings.apiToken || !sha256) return null;
      const response = await requestUrl({
        url: `${serverUrl}/api/image/probe?sha256=${encodeURIComponent(sha256)}`,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.settings.apiToken}`
        },
        throw: false
      });
      if (response.status === 200 && response.json?.exists) {
        return response.json;
      }
    } catch {
      // probe fallback
    }
    return null;
  }

  async uploadBufferToServer(
    arrayBuffer,
    filename,
    mimeType = 'application/octet-stream',
    options = {}
  ) {
    // 1. Instant Upload Probe via local SHA-256 calculation (0 network payload)
    if (!options.skipProbe) {
      try {
        const fullSha256 = await computeSha256Hex(arrayBuffer);
        const probed = await this.probeRemoteSha256(fullSha256);
        if (probed && probed.exists) {
          probed.isInstant = true;
          return probed;
        }
      } catch { }
    }

    // 2. Standard multipart streaming upload
    const url = `${this.getCleanServerUrl()}/api/image/upload`;
    const { boundary, arrayBuffer: bodyBuffer } = buildMultipartBuffer(arrayBuffer, filename, mimeType);

    const headers = {
      Authorization: `Bearer ${this.settings.apiToken}`,
      'X-File-Name': encodeURIComponent(filename),
      'Content-Type': `multipart/form-data; boundary=${boundary}`
    };

    const response = await requestUrl({
      url,
      method: 'POST',
      headers,
      body: bodyBuffer,
      throw: false
    });

    if (response.status < 200 || response.status >= 300) {
      const errMsg = response.json?.error || `HTTP ${response.status}`;
      throw new Error(errMsg);
    }

    return response.json;
  }

  async toggleRemoteFileLock(year, month, filename, locked = true) {
    const url = `${this.getCleanServerUrl()}/api/modules/image-host/lock`;
    const response = await requestUrl({
      url,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.settings.apiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ year, month, filename, locked }),
      throw: false
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(response.json?.error || `Lock operation failed (HTTP ${response.status})`);
    }
    return response.json;
  }

  async checkServerCompatibility() {
    if (!this.settings?.enableRemoteServer) {
      this.lastServerCompatStatus = null;
      if (this.settings) {
        this.settings.serverVerified = false;
        await this.saveSettings();
      }
      return null;
    }
    const pluginVer = this.manifest?.version || '0.1.1';
    const serverUrl = this.getCleanServerUrl();
    if (!serverUrl) {
      this.lastServerCompatStatus = {
        ok: false,
        status: 'offline',
        error: 'No URL configured',
        serverVersion: null
      };
      this.settings.serverVerified = false;
      await this.saveSettings();
      return this.lastServerCompatStatus;
    }

    try {
      const verUrl = `${serverUrl}/api/platform/version`;
      const verRes = await requestUrl({
        url: verUrl,
        method: 'GET',
        throw: false
      });

      if (verRes.status !== 200) {
        this.lastServerCompatStatus = {
          ok: false,
          status: 'offline',
          serverVersion: null,
          error: `HTTP ${verRes.status}`
        };
        this.settings.serverVerified = false;
        await this.saveSettings();
        return this.lastServerCompatStatus;
      }

      const verData = verRes.json || {};
      const serverVer = verData.version || '0.1.0';
      const minPluginReq = verData.minPluginVersion || '0.1.0';

      // 1. Check if plugin is too old for server
      if (compareSemver(pluginVer, minPluginReq) < 0) {
        this.lastServerCompatStatus = {
          ok: false,
          status: 'plugin_outdated',
          serverVersion: serverVer,
          pluginVersion: pluginVer,
          minPluginVersion: minPluginReq,
          features: verData.features || {}
        };
        this.settings.serverVerified = false;
        await this.saveSettings();
        return this.lastServerCompatStatus;
      }

      // 2. Check if server is too old for plugin
      if (compareSemver(serverVer, MIN_SERVER_VERSION) < 0) {
        this.lastServerCompatStatus = {
          ok: false,
          status: 'server_outdated',
          serverVersion: serverVer,
          pluginVersion: pluginVer,
          minServerVersion: MIN_SERVER_VERSION,
          features: verData.features || {}
        };
        this.settings.serverVerified = false;
        await this.saveSettings();
        return this.lastServerCompatStatus;
      }

      // 3. Test API Auth token against image-host list
      let assetCount = 0;
      const token = (this.settings.apiToken || '').trim();
      if (!token) {
        this.lastServerCompatStatus = {
          ok: false,
          status: 'token_missing',
          serverVersion: serverVer,
          pluginVersion: pluginVer,
          features: verData.features || {}
        };
        this.settings.serverVerified = false;
        await this.saveSettings();
        return this.lastServerCompatStatus;
      }

      let listRes;
      try {
        listRes = await requestUrl({
          url: `${serverUrl}/api/modules/image-host/list`,
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
          throw: false
        });
      } catch (netErr) {
        this.lastServerCompatStatus = {
          ok: false,
          status: 'offline',
          serverVersion: serverVer,
          pluginVersion: pluginVer,
          error: netErr.message || String(netErr)
        };
        this.settings.serverVerified = false;
        await this.saveSettings();
        return this.lastServerCompatStatus;
      }

      if (listRes.status === 401 || listRes.status === 403) {
        this.lastServerCompatStatus = {
          ok: false,
          status: 'auth_failed',
          serverVersion: serverVer,
          pluginVersion: pluginVer,
          features: verData.features || {}
        };
        this.settings.serverVerified = false;
        await this.saveSettings();
        return this.lastServerCompatStatus;
      }

      if (listRes.status !== 200) {
        this.lastServerCompatStatus = {
          ok: false,
          status: 'server_error',
          statusCode: listRes.status,
          serverVersion: serverVer,
          pluginVersion: pluginVer,
          features: verData.features || {}
        };
        this.settings.serverVerified = false;
        await this.saveSettings();
        return this.lastServerCompatStatus;
      }

      assetCount = (listRes.json?.images || []).length;

      this.lastServerCompatStatus = {
        ok: true,
        status: 'compatible',
        serverVersion: serverVer,
        pluginVersion: pluginVer,
        apiVersion: verData.apiVersion || 1,
        assetCount,
        features: verData.features || {}
      };
      this.settings.serverVerified = true;
      await this.saveSettings();
      return this.lastServerCompatStatus;
    } catch (err) {
      this.lastServerCompatStatus = {
        ok: false,
        status: 'offline',
        serverVersion: null,
        error: err.message || 'Network error'
      };
      this.settings.serverVerified = false;
      await this.saveSettings();
      return this.lastServerCompatStatus;
    }
  }

  async fetchServerVersion() {
    try {
      const url = `${this.getCleanServerUrl()}/api/platform/version`;
      const response = await requestUrl({
        url,
        method: 'GET',
        throw: false
      });
      if (response.status >= 200 && response.status < 300) {
        return response.json;
      }
    } catch { }
    return null;
  }

  async fetchRemoteFileList() {
    const url = `${this.getCleanServerUrl()}/api/modules/image-host/list`;
    const response = await requestUrl({
      url,
      method: 'GET',
      headers: { Authorization: `Bearer ${this.settings.apiToken}` },
      throw: false
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(response.json?.error || `Unable to fetch remote asset list (HTTP ${response.status})`);
    }
    return response.json.images || [];
  }

  async deleteRemoteFile(year, month, filename) {
    const url = `${this.getCleanServerUrl()}/api/modules/image-host/item/${encodeURIComponent(year)}/${encodeURIComponent(month)}/${encodeURIComponent(filename)}`;
    const response = await requestUrl({
      url,
      method: 'DELETE',
      headers: { Authorization: `Bearer ${this.settings.apiToken}` },
      throw: false
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(response.json?.error || `Failed to delete remote file (HTTP ${response.status})`);
    }
    return true;
  }

  async buildVaultReferenceSnapshot(scanCtx = {}) {
    const { signal, onProgress, freshRead = false } = scanCtx || {};
    const allFiles = this.app.vault.getFiles();
    const docFiles = allFiles.filter((f) => this.isScannableDocFile(f));

    const docContents = [];
    for (let i = 0; i < docFiles.length; i++) {
      if (signal?.aborted) throw new Error('SCAN_ABORTED');
      const doc = docFiles[i];
      if (onProgress && i % 25 === 0) {
        onProgress(i + 1, docFiles.length, doc.path);
        await new Promise((r) => setTimeout(r, 0));
      }
      const rawText = freshRead
        ? await this.app.vault.read(doc)
        : await this.app.vault.cachedRead(doc);
      let decodedText = rawText;
      try {
        decodedText = decodeURIComponent(rawText);
      } catch { }
      docContents.push({
        file: doc,
        path: doc.path,
        rawText,
        decodedText
      });
    }

    const resolvedTargetMap = new Map();
    if (!freshRead) {
      const resolvedLinks = this.app.metadataCache.resolvedLinks || {};
      for (const [sourcePath, targets] of Object.entries(resolvedLinks)) {
        if (isReportFile(sourcePath)) {
          continue;
        }
        for (const targetPath of Object.keys(targets || {})) {
          if (!resolvedTargetMap.has(targetPath)) {
            resolvedTargetMap.set(targetPath, new Set());
          }
          resolvedTargetMap.get(targetPath).add(sourcePath);
        }
      }
    }

    return { docContents, resolvedTargetMap };
  }

  findReferencingNotesForLocalFile(tfile, snapshot) {
    const refNotes = new Set();
    const fromResolved = snapshot.resolvedTargetMap.get(tfile.path);
    if (fromResolved) {
      fromResolved.forEach((p) => refNotes.add(p));
    }

    const isNoteOrExcalidraw =
      tfile.extension === 'md' || tfile.extension === 'excalidraw' || this.isExcalidrawFile(tfile);

    for (const doc of snapshot.docContents) {
      if (doc.path === tfile.path) continue;
      if (doesDocumentReferenceLocalFile(doc.rawText, doc.decodedText, tfile, isNoteOrExcalidraw)) {
        refNotes.add(doc.path);
      }
    }
    return [...refNotes];
  }

  findReferencingNotesForRemoteItem(remoteItem, snapshot) {
    const refNotes = new Set();
    const fname = remoteItem.filename;
    const encodedFname = encodeURIComponent(fname);
    const baseName = getBaseName(fname);
    const webpName = `${baseName}.webp`;
    const encodedWebpName = encodeURIComponent(webpName);
    const relKey = `${remoteItem.year}/${remoteItem.month}/${fname}`;
    const encodedRelKey = `${remoteItem.year}/${remoteItem.month}/${encodedFname}`;
    const pubRelKey = `/pub/${remoteItem.year}/${remoteItem.month}/${webpName}`;
    const encodedPubRelKey = `/pub/${remoteItem.year}/${remoteItem.month}/${encodedWebpName}`;

    for (const doc of snapshot.docContents) {
      if (
        doc.rawText.includes(relKey) ||
        doc.decodedText.includes(relKey) ||
        doc.rawText.includes(encodedRelKey) ||
        doc.rawText.includes(pubRelKey) ||
        doc.decodedText.includes(pubRelKey) ||
        doc.rawText.includes(encodedPubRelKey) ||
        (remoteItem.rawUrl && doc.rawText.includes(remoteItem.rawUrl)) ||
        (remoteItem.pubUrl && doc.rawText.includes(remoteItem.pubUrl))
      ) {
        refNotes.add(doc.path);
      }
    }
    return [...refNotes];
  }

  /**
   * Wizard 1 engine: scans unused assets (supports progress reporting + abortSignal)
   */
  async scanUnusedFiles(options, scanCtx = {}) {
    const { signal, onProgress } = scanCtx || {};
    const snapshot = await this.buildVaultReferenceSnapshot({ signal, onProgress });
    const allowedGroups = new Set();
    if (options.typeNote) allowedGroups.add('note');
    if (options.typeImage) allowedGroups.add('image');
    if (options.typeAudio) allowedGroups.add('audio');
    if (options.typeOther) allowedGroups.add('other');

    const unusedList = [];

    if (options.scanLocal) {
      const allFiles = this.app.vault.getFiles();
      for (let i = 0; i < allFiles.length; i++) {
        if (signal?.aborted) throw new Error('SCAN_ABORTED');
        const f = allFiles[i];
        if (onProgress && i % 30 === 0) {
          onProgress(i + 1, allFiles.length, f.path);
          await new Promise((r) => setTimeout(r, 0));
        }
        if (isReportFile(f.name) || f.extension === 'canvas') {
          continue;
        }
        if (this.isLocalPathExcluded(f.path)) continue;

        const grp = getFileTypeGroup(f.extension);
        if (!allowedGroups.has(grp)) continue;

        const refs = this.findReferencingNotesForLocalFile(f, snapshot);
        if (refs.length === 0) {
          unusedList.push({
            id: `local:${f.path}`,
            source: 'local',
            typeGroup: grp,
            name: f.name,
            displayPath: f.path,
            size: f.stat?.size || 0,
            rawObj: f,
            selected: true
          });
        }
      }
    }

    if (options.scanRemote) {
      try {
        if (signal?.aborted) throw new Error('SCAN_ABORTED');
        const remoteFiles = await this.fetchRemoteFileList();
        for (let i = 0; i < remoteFiles.length; i++) {
          if (signal?.aborted) throw new Error('SCAN_ABORTED');
          const r = remoteFiles[i];
          if (onProgress && i % 30 === 0) {
            onProgress(i + 1, remoteFiles.length, r.filename);
            await new Promise((res) => setTimeout(res, 0));
          }
          if (this.settings.excludeLockedRemoteFiles && (r.locked || r.inProtectedFolder)) {
            continue;
          }
          const ext = getExt(r.filename);
          const grp = getFileTypeGroup(ext);
          if (!allowedGroups.has(grp)) continue;

          const refs = this.findReferencingNotesForRemoteItem(r, snapshot);
          if (refs.length === 0) {
            unusedList.push({
              id: `remote:${r.year}/${r.month}/${r.filename}`,
              source: 'remote',
              typeGroup: grp,
              name: r.filename,
              displayPath: `${r.year}/${r.month}/${r.filename}`,
              size: r.size || 0,
              rawObj: r,
              selected: true
            });
          }
        }
      } catch (err) {
        if (err.message === 'SCAN_ABORTED') throw err;
        if (!options.scanLocal) {
          throw err;
        }
        new Notice(this.t('noticeRemoteUnreachable', { err: err.message }));
      }
    }

    return unusedList;
  }

  async exportOrphanReportToRoot(results) {
    const now = new Date();
    const dateStr = formatDateYMD(now);
    const reportPath = `Unused_Files_Report_${dateStr}.md`;

    const localItems = results.filter((r) => r.source === 'local');
    const remoteItems = results.filter((r) => r.source === 'remote');
    const totalBytes = results.reduce((s, r) => s + (r.size || 0), 0);

    const lines = [
      `# 🧹 Unused Files Inspection Report (${dateStr})`,
      ``,
      `> Generated: ${now.toLocaleString('en-US')}  |  Total Unused Files: **${results.length}**  |  Total Reclaimable Space: **${formatBytes(totalBytes)}**`,
      ``
    ];

    lines.push(`## 💻 1. Local Vault Unused Files (${localItems.length})`);
    if (localItems.length === 0) {
      lines.push(`- No unused local files`);
    } else {
      for (const item of localItems) {
        lines.push(`- [[${item.displayPath}]] — \`${formatBytes(item.size)}\``);
      }
    }

    lines.push(``);
    lines.push(`## ☁️ 2. Remote Server Unused Files (${remoteItems.length})`);
    if (remoteItems.length === 0) {
      lines.push(`- No unused remote files`);
    } else {
      for (const item of remoteItems) {
        lines.push(`- [${item.displayPath}](${item.rawObj.rawUrl}) — \`${formatBytes(item.size)}\``);
      }
    }

    await this.writeOrUpdateRootReport(reportPath, lines.join('\n'));
    new Notice(this.t('noticeReportGenerated', { path: reportPath }));
  }

  async writeOrUpdateRootReport(reportPath, content) {
    const existing = this.app.vault.getAbstractFileByPath(reportPath);
    let targetFile;
    if (existing) {
      await this.app.vault.modify(existing, content);
      targetFile = existing;
    } else {
      targetFile = await this.app.vault.create(reportPath, content);
    }
    const leaf = this.app.workspace.getLeaf(false);
    if (leaf && targetFile) {
      await leaf.openFile(targetFile);
    }
  }

  async cleanSelectedOrphans(selectedItems, onDone) {
    const remoteToClean = selectedItems.filter((i) => i.source === 'remote');
    const localToClean = selectedItems.filter((i) => i.source === 'local');

    if (remoteToClean.length > 0) {
      const remoteBytes = remoteToClean.reduce((s, i) => s + (i.size || 0), 0);
      const confirmed = await new Promise((resolve) => {
        new ConfirmActionModal(
          this.app,
          this.t('confirmRemoteOrphanTitle'),
          this.t('confirmRemoteOrphanMsg', { count: remoteToClean.length, size: formatBytes(remoteBytes) }),
          this.t('confirmRemoteOrphanBtn', { count: remoteToClean.length }),
          resolve
        ).open();
      });
      if (!confirmed) return;
    }

    let deletedLocal = 0;
    let deletedRemote = 0;

    for (const item of localToClean) {
      try {
        await this.app.vault.trash(item.rawObj, true);
        deletedLocal++;
      } catch (err) {
        console.error('Failed to delete local file:', err);
        this.logOperation('ERROR', 'ORPHAN_CLEANUP', `Failed to move local file to trash: ${item.displayPath}`, { error: err.message });
      }
    }

    for (const item of remoteToClean) {
      try {
        await this.deleteRemoteFile(item.rawObj.year, item.rawObj.month, item.rawObj.filename);
        deletedRemote++;
      } catch (err) {
        new Notice(this.t('noticeRemoteDeleteFailed', { name: item.name, err: err.message }));
        this.logOperation('ERROR', 'ORPHAN_CLEANUP', `Failed to delete remote file: ${item.displayPath}`, { error: err.message });
      }
    }

    this.logOperation('INFO', 'ORPHAN_CLEANUP', `Cleaned unreferenced files: ${deletedLocal} local, ${deletedRemote} remote`, {
      files: selectedItems.map((i) => i.displayPath)
    });
    new Notice(this.t('noticeCleanupComplete', { local: deletedLocal, remote: deletedRemote }));
    if (onDone) onDone({ local: deletedLocal, remote: deletedRemote, total: deletedLocal + deletedRemote });
  }

  /**
   * Wizard 2 engine: scans duplicate asset groups with SHA-256 (supports progress + abortSignal)
   */
  async scanDuplicateGroups(scope, fileTypeOpts = null, scanCtx = {}) {
    const { signal, onProgress } = scanCtx || {};
    const snapshot = await this.buildVaultReferenceSnapshot({ signal, onProgress });
    const hashMap = new Map();
    const allowedGroups = new Set();
    if (!fileTypeOpts) {
      allowedGroups.add('image');
      allowedGroups.add('audio');
      allowedGroups.add('other');
      allowedGroups.add('note');
    } else {
      if (fileTypeOpts.typeImage) allowedGroups.add('image');
      if (fileTypeOpts.typeAudio) allowedGroups.add('audio');
      if (fileTypeOpts.typeOther) allowedGroups.add('other');
      if (fileTypeOpts.typeNote) allowedGroups.add('note');
    }

    let localScanned = 0;
    let remoteScanned = 0;
    let remoteError = null;

    const addItem = (sha256, itemObj) => {
      if (!sha256) return;
      if (!hashMap.has(sha256)) hashMap.set(sha256, []);
      hashMap.get(sha256).push(itemObj);
    };

    const sizeBuckets = new Map();
    const getBucket = (sz) => {
      let b = sizeBuckets.get(sz);
      if (!b) {
        b = { local: [], remote: [] };
        sizeBuckets.set(sz, b);
      }
      return b;
    };

    if (scope === 'local' || scope === 'both') {
      const allFiles = this.app.vault.getFiles();
      for (const f of allFiles) {
        if (signal?.aborted) throw new Error('SCAN_ABORTED');
        if (isReportFile(f.name) || f.extension === 'canvas') {
          continue;
        }
        if (this.isLocalPathExcluded(f.path)) continue;

        const grp = getFileTypeGroup(f.extension);
        if (!allowedGroups.has(grp)) continue;

        const size = f.stat?.size || 0;
        if (size <= 0) continue;

        getBucket(size).local.push(f);
      }
    }

    if (scope === 'remote' || scope === 'both') {
      try {
        if (signal?.aborted) throw new Error('SCAN_ABORTED');
        const remoteFiles = await this.fetchRemoteFileList();
        for (const r of remoteFiles) {
          if (!r.sha256) continue;
          const ext = getExt(r.filename);
          const grp = getFileTypeGroup(ext);
          if (!allowedGroups.has(grp)) continue;

          const size = r.size || 0;
          getBucket(size).remote.push(r);
        }
      } catch (err) {
        if (err.message === 'SCAN_ABORTED') throw err;
        if (scope === 'remote') {
          throw err;
        }
        remoteError = err.message;
      }
    }

    const bucketEntries = [...sizeBuckets.entries()];
    for (let bIdx = 0; bIdx < bucketEntries.length; bIdx++) {
      if (signal?.aborted) throw new Error('SCAN_ABORTED');
      const [, bucket] = bucketEntries[bIdx];
      let hasConflict = false;
      if (scope === 'both') {
        hasConflict = (bucket.local.length + bucket.remote.length) >= 2;
      } else if (scope === 'local') {
        hasConflict = bucket.local.length >= 2;
      } else if (scope === 'remote') {
        hasConflict = bucket.remote.length >= 2;
      }

      if (!hasConflict) continue;

      if (scope === 'remote' || scope === 'both') {
        for (const r of bucket.remote) {
          if (signal?.aborted) throw new Error('SCAN_ABORTED');
          remoteScanned++;
          const ext = getExt(r.filename);
          const refNotes = this.findReferencingNotesForRemoteItem(r, snapshot);
          addItem(r.sha256, {
            id: `remote:${r.year}/${r.month}/${r.filename}`,
            source: 'remote',
            name: r.filename,
            ext,
            displayPath: `${r.year}/${r.month}/${r.filename}`,
            size: r.size || 0,
            locked: Boolean(r.locked || r.inProtectedFolder),
            refNotes,
            rawObj: r
          });
        }
      }

      if (scope === 'local' || scope === 'both') {
        for (const f of bucket.local) {
          if (signal?.aborted) throw new Error('SCAN_ABORTED');
          if (onProgress) {
            onProgress(bIdx + 1, bucketEntries.length, f.path);
          }
          const buf = await this.app.vault.readBinary(f);
          if (!buf || buf.byteLength === 0) continue;
          localScanned++;

          const sha256 = await computeSha256Hex(buf);
          const refNotes = this.findReferencingNotesForLocalFile(f, snapshot);

          addItem(sha256, {
            id: `local:${f.path}`,
            source: 'local',
            name: f.name,
            ext: f.extension.toLowerCase(),
            displayPath: f.path,
            size: f.stat?.size || buf.byteLength,
            locked: false,
            refNotes,
            rawObj: f
          });
        }
      }
    }

    const duplicateGroups = [];
    for (const [sha256, items] of hashMap.entries()) {
      if (items.length < 2) continue;
      duplicateGroups.push({
        sha256,
        size: items[0].size || 0,
        items,
        keepId: items[0].id
      });
    }

    return {
      groups: duplicateGroups,
      stats: { localScanned, remoteScanned, remoteError }
    };
  }

  async exportDuplicateReportToRoot(groups) {
    const now = new Date();
    const dateStr = formatDateYMD(now);
    const reportPath = `Duplicate_Files_Report_${dateStr}.md`;

    const lines = [
      `# 🔍 Duplicate Files Inspection Report (${dateStr})`,
      ``,
      `> Generated: ${now.toLocaleString('en-US')}  |  Duplicate Groups: **${groups.length}**`,
      ``
    ];

    if (groups.length === 0) {
      lines.push(`🎉 No duplicate files found.`);
    } else {
      groups.forEach((grp, idx) => {
        lines.push(`## Duplicate Group #${idx + 1} (\`${grp.sha256.slice(0, 12)}...\`, Size: ${formatBytes(grp.size)})`);
        for (const item of grp.items) {
          const isKeep = grp.keepId === item.id ? ' **[Current Keep Selection]**' : '';
          const lockTag = item.locked ? ' `🔒 Protected`' : '';
          const linkStr =
            item.source === 'local'
              ? `💻 Local: [[${item.displayPath}]]`
              : `☁️ Remote: [${item.displayPath}](${item.rawObj.rawUrl})`;
          const refsStr =
            item.refNotes.length > 0
              ? `Referencing Notes: ${item.refNotes.map((n) => `[[${n}]]`).join(', ')}`
              : `No direct note references`;
          lines.push(`- ${linkStr}${lockTag}${isKeep} — (${refsStr})`);
        }
        lines.push(``);
      });
    }

    await this.writeOrUpdateRootReport(reportPath, lines.join('\n'));
    new Notice(this.t('noticeReportGenerated', { path: reportPath }));
  }

  async exportBatchMigrateReportToRoot(summary) {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const dateStr = formatDateYMD(now);
    const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const reportPath = `Batch_Migrate_Report_${dateStr}.md`;

    const count = summary?.count || 0;
    const docs = summary?.docs || 0;
    const totalBytes = summary?.totalBytes || 0;
    const trashed = summary?.trashed || 0;
    const items = summary?.processedItems || [];
    const failures = summary?.failures || [];
    const trashFailures = summary?.trashFailures || [];

    const lines = [
      `# 🚀 批量云端迁移报告 / Batch Migration Report (${dateStr})`,
      ``,
      `> 生成时间 / Generated: ${dateStr} ${timeStr}  |  成功迁移附件 / Uploaded: **${count}** (${formatBytes(totalBytes)})  |  更新笔记 / Notes Updated: **${docs}**  |  本地清理 / Trashed: **${trashed}**`,
      ``,
      `## 📊 迁移汇总统计 / Summary Statistics`,
      `- **成功上传文件 (Total Uploaded)**: ${count} 个 (${formatBytes(totalBytes)})`,
      `- **引用链接已更新笔记 (Notes Updated)**: ${docs} 篇`,
      `- **本地原文件已移入回收站 (Local Trashed)**: ${trashed} 个`,
      `- **上传失败项 (Failed Uploads)**: ${failures.length} 个`,
      ...(trashFailures.length > 0 ? [`- **本地清理失败项 (Failed Local Cleanups)**: ${trashFailures.length} 个`] : []),
      ``,
      `## ☁️ 已迁移附件清单 / Migrated Assets (${items.length})`,
      ``
    ];

    if (items.length === 0) {
      lines.push(`- 无已迁移附件 / No assets were migrated.`);
    } else {
      lines.push(`| # | 本地原路径 (Local Path) | 服务器链接 (Remote URL) | 文件大小 (Size) | 引用数 (Refs) |`);
      lines.push(`|---|---|---|---|---|`);
      items.forEach((item, idx) => {
        const localPath = item.displayPath || item.name;
        const remoteUrl = item.rawUrl || (item.rawObj && item.rawObj.rawUrl) || '';
        const sizeStr = formatBytes(item.size || 0);
        const refsCount = item.refNotesCount !== undefined ? `${item.refNotesCount} 篇` : '-';
        const remoteLink = remoteUrl ? `[${item.name || 'Link'}](${remoteUrl})` : '-';
        lines.push(`| ${idx + 1} | \`${localPath}\` | ${remoteLink} | ${sizeStr} | ${refsCount} |`);
      });
    }

    if (failures.length > 0) {
      lines.push(``);
      lines.push(`## ⚠️ 上传失败项 / Failed Uploads (${failures.length})`);
      lines.push(``);
      failures.forEach((f, idx) => {
        lines.push(`- **#${idx + 1}**: \`${f.path || f.name}\` (${formatBytes(f.size || 0)}) — 错误原因 / Reason: ${f.error}`);
      });
    }

    if (trashFailures.length > 0) {
      lines.push(``);
      lines.push(`## ⚠️ 本地清理失败项 / Failed Local Cleanups (${trashFailures.length})`);
      lines.push(``);
      trashFailures.forEach((tf, idx) => {
        lines.push(`- **#${idx + 1}**: \`${tf.path}\` — 错误原因 / Reason: ${tf.error}`);
      });
    }

    lines.push(``);
    lines.push(`---`);
    lines.push(`*Generated by File Master Obsidian Plugin*`);

    await this.writeOrUpdateRootReport(reportPath, lines.join('\n'));
    new Notice(this.t('noticeReportGenerated', { path: reportPath }));
    return reportPath;
  }

  async openNoteAtLine(filePath, lineNumber) {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (file && file instanceof TFile) {
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(file);
      const view = leaf.view;
      if (view && view.editor && lineNumber) {
        const lineIdx = Math.max(0, lineNumber - 1);
        view.editor.setCursor({ line: lineIdx, ch: 0 });
        view.editor.scrollIntoView(
          { from: { line: lineIdx, ch: 0 }, to: { line: lineIdx, ch: 0 } },
          true
        );
      }
    } else {
      new Notice(this.t('noticeCannotOpenFile', { path: filePath }));
    }
  }

  /**
   * Scans vault notes and canvas files for broken links (supports progress + abortSignal)
   */
  async scanVaultLinkHealth(options = {}, scanCtx = {}) {
    const { signal, onProgress } = scanCtx || {};
    const allFiles = this.app.vault.getFiles();
    const docFiles = allFiles.filter(
      (f) => this.isScannableDocFile(f) && !this.isLocalPathExcluded(f.path)
    );

    const vaultFilePaths = new Set(allFiles.map((f) => f.path));
    const vaultFileNames = new Set(allFiles.map((f) => f.name));
    const vaultFileBasenames = new Set(allFiles.map((f) => f.basename));

    const vaultIndex = {
      paths: vaultFilePaths,
      names: vaultFileNames,
      basenames: vaultFileBasenames
    };

    const issues = [];
    const remoteToCheck = [];

    for (let i = 0; i < docFiles.length; i++) {
      if (signal?.aborted) throw new Error('SCAN_ABORTED');
      const doc = docFiles[i];
      if (onProgress && i % 15 === 0) {
        onProgress(i + 1, docFiles.length, doc.path);
        await new Promise((r) => setTimeout(r, 0));
      }
      const rawText = await this.app.vault.cachedRead(doc);
      if (doc.extension === 'canvas') {
        try {
          const data = JSON.parse(rawText);
          if (Array.isArray(data.nodes)) {
            for (const node of data.nodes) {
              if (node.type === 'file' && node.file && options.checkLocalMarkdown !== false) {
                if (
                  !vaultFilePaths.has(node.file) &&
                  !vaultFileNames.has(node.file.split('/').pop())
                ) {
                  issues.push({
                    type: 'canvas-node',
                    category: 'local',
                    sourcePath: doc.path,
                    target: node.file,
                    rawText: `{"type": "file", "file": "${node.file}"}`,
                    line: 1,
                    lineText: `Canvas File Card: ${node.file}`,
                    reason: 'Referenced canvas attachment does not exist in vault'
                  });
                }
              } else if (node.type === 'text' && node.text) {
                const subIssues = scanNoteContentForBrokenLinks(doc.path, node.text, vaultIndex, {
                  checkWikiLinks: options.checkWikiLinks !== false,
                  checkLocalMarkdown: options.checkLocalMarkdown !== false,
                  checkRemote: options.checkRemote
                });
                for (const iss of subIssues) {
                  if (iss.category === 'remote') {
                    remoteToCheck.push(iss);
                  } else {
                    issues.push(iss);
                  }
                }
              }
            }
          }
        } catch { }
      } else {
        const docIssues = scanNoteContentForBrokenLinks(doc.path, rawText, vaultIndex, {
          checkWikiLinks: options.checkWikiLinks !== false,
          checkLocalMarkdown: options.checkLocalMarkdown !== false,
          checkRemote: options.checkRemote
        });

        for (const iss of docIssues) {
          if (iss.category === 'remote') {
            remoteToCheck.push(iss);
          } else {
            issues.push(iss);
          }
        }
      }
    }

    if (options.checkRemote && remoteToCheck.length > 0) {
      const uniqueUrls = Array.from(new Set(remoteToCheck.map((r) => r.target)));
      const failedUrlMap = new Map();

      for (let i = 0; i < uniqueUrls.length; i += 5) {
        if (signal?.aborted) throw new Error('SCAN_ABORTED');
        const batch = uniqueUrls.slice(i, i + 5);
        if (onProgress) {
          onProgress(i + 1, uniqueUrls.length, batch[0]);
        }
        await Promise.all(
          batch.map(async (url) => {
            try {
              const res = await requestUrl({ url, method: 'HEAD', throw: false });
              if (res.status >= 400) {
                failedUrlMap.set(url, `HTTP ${res.status}`);
              }
            } catch (err) {
              failedUrlMap.set(url, err.message || 'Network error');
            }
          })
        );
      }

      for (const item of remoteToCheck) {
        if (failedUrlMap.has(item.target)) {
          item.reason = `Remote resource returned ${failedUrlMap.get(item.target)}`;
          issues.push(item);
        }
      }
    }

    this.logOperation('INFO', 'HEALTH_SCAN', `Scanned ${docFiles.length} document(s), found ${issues.length} broken link issue(s)`, {
      docsScanned: docFiles.length,
      issuesFound: issues.length
    });
    return { issues, totalDocs: docFiles.length };
  }

  async exportHealthReportToRoot(issues, totalDocsScanned) {
    const now = new Date();
    const dateStr = formatDateYMD(now);
    const reportPath = `Broken_Links_Report_${dateStr}.md`;
    const zh = this.getEffectiveLanguage() === 'zh';
    const locale = zh ? 'zh-CN' : 'en-US';
    const labels = zh ? {
      title: '失效链接报告', generated: '生成时间', checked: '已检查文档', issues: '发现问题',
      summary: '概览', wiki: '失效内部链接', local: '缺失本地文件', remote: '网页链接异常',
      source: '所在文档', target: '目标', type: '类型', line: '行号', context: '上下文',
      url: '网页链接', error: '错误', link: '链接', none: '所选检查范围内未发现链接问题。'
    } : {
      title: 'Broken links report', generated: 'Generated', checked: 'Documents checked', issues: 'Issues found',
      summary: 'Overview', wiki: 'Broken note links', local: 'Missing local files', remote: 'Web link errors',
      source: 'Document', target: 'Target', type: 'Type', line: 'Line', context: 'Context',
      url: 'Web link', error: 'Error', link: 'Link', none: 'No link issues found in the selected scope.'
    };

    const wikiIssues = issues.filter((i) => i.category === 'wikilink');
    const localIssues = issues.filter((i) => i.category === 'local');
    const remoteIssues = issues.filter((i) => i.category === 'remote');

    const lines = [
      `# ${labels.title} (${dateStr})`,
      ``,
      `> ${labels.generated}: ${now.toLocaleString(locale)}  |  ${labels.checked}: **${totalDocsScanned}**  |  ${labels.issues}: **${issues.length}**`,
      ``,
      `## ${labels.summary}`,
      `- ${labels.wiki}: **${wikiIssues.length}**`,
      `- ${labels.local}: **${localIssues.length}**`,
      `- ${labels.remote}: **${remoteIssues.length}**`,
      ``
    ];

    if (wikiIssues.length > 0) {
      lines.push(`## 1. ${labels.wiki} (${wikiIssues.length})`);
      lines.push(`| ${labels.source} | ${labels.target} | ${labels.type} | ${labels.line} | ${labels.context} |`);
      lines.push(`|---|---|---|---|---|`);
      for (const item of wikiIssues) {
        const safeContext = (item.lineText || '').replace(/\|/g, '\\|');
        lines.push(`| [[${item.sourcePath}]] | \`${item.target}\` | ${item.type} | ${item.line} | \`${safeContext}\` |`);
      }
      lines.push(``);
    }

    if (localIssues.length > 0) {
      lines.push(`## 2. ${labels.local} (${localIssues.length})`);
      lines.push(`| ${labels.source} | ${labels.target} | ${labels.type} | ${labels.line} | ${labels.context} |`);
      lines.push(`|---|---|---|---|---|`);
      for (const item of localIssues) {
        const safeContext = (item.lineText || '').replace(/\|/g, '\\|');
        lines.push(`| [[${item.sourcePath}]] | \`${item.target}\` | ${item.type} | ${item.line} | \`${safeContext}\` |`);
      }
      lines.push(``);
    }

    if (remoteIssues.length > 0) {
      lines.push(`## 3. ${labels.remote} (${remoteIssues.length})`);
      lines.push(`| ${labels.source} | ${labels.url} | ${labels.error} | ${labels.line} | ${labels.context} |`);
      lines.push(`|---|---|---|---|---|`);
      for (const item of remoteIssues) {
        const safeContext = (item.lineText || '').replace(/\|/g, '\\|');
        lines.push(`| [[${item.sourcePath}]] | [${labels.link}](${item.target}) | ${item.reason} | ${item.line} | \`${safeContext}\` |`);
      }
      lines.push(``);
    }

    if (issues.length === 0) {
      lines.push(labels.none);
    }

    await this.writeOrUpdateRootReport(reportPath, lines.join('\n'));
    new Notice(this.t('noticeReportGenerated', { path: reportPath }));
  }

  async scanVaultAnalytics() {
    const allFiles = this.app.vault.getFiles();
    const docFiles = allFiles.filter((f) => this.isScannableDocFile(f));

    const docTexts = [];
    for (const doc of docFiles) {
      try {
        const text = await this.app.vault.cachedRead(doc);
        docTexts.push(text);
      } catch { }
    }

    let remoteImages = [];
    try {
      remoteImages = await this.fetchRemoteFileList();
    } catch { }

    return computeVaultStatsFromEntries(allFiles, docTexts, remoteImages);
  }

  async exportAnalyticsReportToRoot(stats) {
    const now = new Date();
    const dateStr = formatDateYMD(now);
    const reportPath = `Vault_Analytics_Report_${dateStr}.md`;
    const zh = this.getEffectiveLanguage() === 'zh';
    const locale = zh ? 'zh-CN' : 'en-US';
    const labels = zh ? {
      title: '知识库报告', generated: '生成时间', overview: '知识库概览',
      notes: '笔记', canvases: '白板', words: '字词数', links: '链接与嵌入',
      storage: '存储用量', location: '位置', count: '文件数', size: '大小',
      details: '分类', vault: '知识库', server: '服务器', images: '图片',
      audio: '音频', other: '其他', cache: 'WebP 缓存', protected: '受保护文件',
      largest: '体积最大的附件', source: '来源', path: '文件路径'
    } : {
      title: 'Vault report', generated: 'Generated', overview: 'Vault overview',
      notes: 'Notes', canvases: 'Canvases', words: 'Words and CJK characters', links: 'Links and embeds',
      storage: 'Storage use', location: 'Location', count: 'Files', size: 'Size',
      details: 'Breakdown', vault: 'Vault', server: 'Server', images: 'Images',
      audio: 'Audio', other: 'Other', cache: 'WebP cache', protected: 'Protected files',
      largest: 'Largest attachments', source: 'Source', path: 'File path'
    };

    const lines = [
      `# ${labels.title} (${dateStr})`,
      ``,
      `> ${labels.generated}: ${now.toLocaleString(locale)}`,
      ``,
      `## 1. ${labels.overview}`,
      `- ${labels.notes}: **${stats.noteCount}**`,
      `- ${labels.canvases}: **${stats.canvasCount}**`,
      `- ${labels.words}: **${stats.totalWords.toLocaleString(locale)}**`,
      `- ${labels.links}: **${stats.totalInternalLinks.toLocaleString(locale)}**`,
      ``,
      `## 2. ${labels.storage}`,
      `| ${labels.location} | ${labels.count} | ${labels.size} | ${labels.details} |`,
      `|---|---|---|---|`,
      `| ${labels.vault} | ${stats.local.totalCount} | ${formatBytes(stats.local.totalBytes)} | ${labels.images}: ${stats.local.imageCount} (${formatBytes(stats.local.imageBytes)}), ${labels.audio}: ${stats.local.audioCount} (${formatBytes(stats.local.audioBytes)}), ${labels.other}: ${stats.local.otherCount} (${formatBytes(stats.local.otherBytes)}) |`,
      `| ${labels.server} | ${stats.remote.totalCount} | ${formatBytes(stats.remote.rawBytes)} | ${labels.cache}: ${formatBytes(stats.remote.cacheBytes)}, ${labels.protected}: ${stats.remote.lockedCount} |`,
      ``
    ];

    if (stats.topLargestAttachments && stats.topLargestAttachments.length > 0) {
      lines.push(`## 3. ${labels.largest}`);
      lines.push(`| ${labels.source} | ${labels.path} | ${labels.details} | ${labels.size} |`);
      lines.push(`|---|---|---|---|`);
      for (const item of stats.topLargestAttachments) {
        const srcLabel = item.source === 'local' ? labels.vault : labels.server;
        const category = item.group === 'image' ? labels.images : item.group === 'audio' ? labels.audio : labels.other;
        lines.push(`| ${srcLabel} | \`${item.path}\` | ${category} | ${formatBytes(item.size)} |`);
      }
      lines.push(``);
    }

    await this.writeOrUpdateRootReport(reportPath, lines.join('\n'));
    new Notice(this.t('noticeReportGenerated', { path: reportPath }));
  }

  rewriteContentLinks(content, removeItem, keepItem) {
    let updated = content;

    if (typeof rewriteExcalidrawEmbeddedFiles === 'function') {
      updated = rewriteExcalidrawEmbeddedFiles(updated, removeItem, keepItem);
    }

    const buildReplacementForWikiEmbed = (aliasOrWidth) => {
      if (keepItem.source === 'local') {
        const suffix = aliasOrWidth ? `|${aliasOrWidth}` : '';
        return `![[${keepItem.displayPath}${suffix}]]`;
      } else {
        const alt = aliasOrWidth || '';
        return IMAGE_EXTS.has(keepItem.ext)
          ? `![${alt}](${keepItem.rawObj.rawUrl})`
          : `[📎 ${aliasOrWidth || keepItem.name}](${keepItem.rawObj.rawUrl})`;
      }
    };

    const buildReplacementForWikiLink = (aliasText) => {
      if (keepItem.source === 'local') {
        const suffix = aliasText ? `|${aliasText}` : '';
        return `[[${keepItem.displayPath}${suffix}]]`;
      } else {
        return `[${aliasText || keepItem.name}](${keepItem.rawObj.rawUrl})`;
      }
    };

    const buildReplacementForMdLink = (isEmbed, altText) => {
      if (keepItem.source === 'local') {
        const prefix = isEmbed ? '!' : '';
        const alias = altText ? `|${altText}` : '';
        return `${prefix}[[${keepItem.displayPath}${alias}]]`;
      } else {
        if (isEmbed && IMAGE_EXTS.has(keepItem.ext)) {
          return `![${altText || ''}](${keepItem.rawObj.rawUrl})`;
        }
        return `[${altText || '📎 ' + keepItem.name}](${keepItem.rawObj.rawUrl})`;
      }
    };

    if (removeItem.source === 'local') {
      const candidates = new Set([
        removeItem.displayPath,
        removeItem.name,
        encodeURI(removeItem.displayPath),
        encodeURI(removeItem.name),
        encodeURIComponent(removeItem.name)
      ]);

      for (const cand of candidates) {
        const esc = escapeRegExp(cand);
        const wikiEmbedRe = new RegExp(`!\\[\\[(?:\\.\\/)?${esc}(?:#[^\\]|]*)?(?:\\|([^\\]]*))?\\]\\]`, 'g');
        updated = updated.replace(wikiEmbedRe, (_, alias) => buildReplacementForWikiEmbed(alias));

        const wikiLinkRe = new RegExp(`(?<!!)\\[\\[(?:\\.\\/)?${esc}(?:#[^\\]|]*)?(?:\\|([^\\]]*))?\\]\\]`, 'g');
        updated = updated.replace(wikiLinkRe, (_, alias) => buildReplacementForWikiLink(alias));

        const mdLinkRe = new RegExp(`(!?)\\[([^\\]]*)\\]\\(<?(?:\\.\\.?\\/)*${esc}(?:[?#][^)\\s>]*)?>?\\)`, 'g');
        updated = updated.replace(mdLinkRe, (_, bang, alt) =>
          buildReplacementForMdLink(bang === '!', alt)
        );
      }

      if (keepItem.source === 'local') {
        updated = updated.split(`"${removeItem.displayPath}"`).join(`"${keepItem.displayPath}"`);
      } else {
        updated = updated.split(`"${removeItem.displayPath}"`).join(`"${keepItem.rawObj.rawUrl}"`);
      }
    } else {
      const r = removeItem.rawObj;
      const encodedName = encodeURIComponent(r.filename);
      const urlPatterns = new Set([
        r.rawUrl,
        r.pubUrl,
        `${r.year}/${r.month}/${r.filename}`,
        `${r.year}/${r.month}/${encodedName}`
      ]);

      for (const pat of urlPatterns) {
        if (!pat) continue;
        const esc = escapeRegExp(pat);
        const remoteMdRe = new RegExp(`(!?)\\[([^\\]]*)\\]\\(([^)\\s]*${esc})\\)`, 'g');
        updated = updated.replace(remoteMdRe, (_, bang, alt) =>
          buildReplacementForMdLink(bang === '!', alt)
        );
      }

      if (keepItem.source === 'remote') {
        if (r.rawUrl) updated = updated.split(r.rawUrl).join(keepItem.rawObj.rawUrl);
        if (r.pubUrl) updated = updated.split(r.pubUrl).join(keepItem.rawObj.pubUrl);
      }
    }

    return updated;
  }

  async executeDuplicateMergeSafely(groups, onComplete) {
    const tasks = [];
    const remoteItemsToDelete = [];

    for (const grp of groups) {
      const keepItem = grp.items.find((i) => i.id === grp.keepId);
      if (!keepItem) continue;
      const removeItems = grp.items.filter((i) => i.id !== grp.keepId);
      if (removeItems.length === 0) continue;

      for (const rem of removeItems) {
        if (rem.source === 'remote' && !rem.locked) {
          remoteItemsToDelete.push({ removeItem: rem, keepItem });
        }
      }
      tasks.push({ keepItem, removeItems });
    }

    if (tasks.length === 0) {
      new Notice(this.t('noDupToProcess'));
      return;
    }

    if (remoteItemsToDelete.length > 0) {
      const totalRemoteBytes = remoteItemsToDelete.reduce((s, x) => s + (x.removeItem.size || 0), 0);
      const confirmed = await new Promise((resolve) => {
        new ConfirmActionModal(
          this.app,
          this.t('confirmRemoteDupTitle'),
          this.t('confirmRemoteDupMsg', { count: remoteItemsToDelete.length, size: formatBytes(totalRemoteBytes) }),
          this.t('confirmRemoteDupBtn', { count: remoteItemsToDelete.length }),
          resolve
        ).open();
      });
      if (!confirmed) return;
    }

    const allDocs = this.app.vault
      .getFiles()
      .filter((f) => this.isScannableDocFile(f));

    const localPathsBeingRemoved = new Set();
    for (const { removeItems } of tasks) {
      for (const rem of removeItems) {
        if (rem.source === 'local' && !rem.locked) {
          localPathsBeingRemoved.add(rem.displayPath);
        }
      }
    }

    let modifiedDocsCount = 0;
    for (const doc of allDocs) {
      if (localPathsBeingRemoved.has(doc.path)) continue;
      const modified = await this.safeModifyFileContent(doc, (content) => {
        let next = content;
        for (const { keepItem, removeItems } of tasks) {
          for (const rem of removeItems) {
            next = this.rewriteContentLinks(next, rem, keepItem);
          }
        }
        return next;
      });
      if (modified) modifiedDocsCount++;
    }

    const postSnapshot = await this.buildVaultReferenceSnapshot();
    let deletedLocalCount = 0;
    let deletedRemoteCount = 0;
    let skippedBySafetyGate = 0;

    for (const { keepItem, removeItems } of tasks) {
      for (const rem of removeItems) {
        if (rem.locked) {
          continue;
        }

        let remainingRefs = [];
        if (rem.source === 'local') {
          for (const doc of postSnapshot.docContents) {
            if (doc.path === rem.displayPath || localPathsBeingRemoved.has(doc.path)) continue;
            if (keepItem.name !== rem.name) {
              if (doc.rawText.includes(rem.name) || doc.decodedText.includes(rem.name)) {
                remainingRefs.push(doc.path);
              }
            } else if (doc.rawText.includes(rem.displayPath) || doc.decodedText.includes(rem.displayPath)) {
              remainingRefs.push(doc.path);
            }
          }
        } else {
          remainingRefs = this.findReferencingNotesForRemoteItem(rem.rawObj, postSnapshot);
        }

        if (remainingRefs.length > 0) {
          console.warn(
            `[FileMaster Safety Gate] Blocked deletion of ${rem.displayPath}; dangling references detected in notes:`,
            remainingRefs
          );
          this.logOperation('WARN', 'DEDUP_SAFETY_GATE', `Kept ${rem.displayPath} because references remain in notes`, { remainingRefs });
          skippedBySafetyGate++;
          continue;
        }

        if (rem.source === 'local') {
          await this.app.vault.trash(rem.rawObj, true).catch(() => { });
          deletedLocalCount++;
        } else {
          try {
            await this.deleteRemoteFile(rem.rawObj.year, rem.rawObj.month, rem.rawObj.filename);
            deletedRemoteCount++;
          } catch (err) {
            new Notice(this.t('noticeRemoteDeleteFailed', { name: rem.name, err: err.message }));
            this.logOperation('ERROR', 'DEDUP_MERGE', `Failed to delete remote duplicate ${rem.displayPath}`, { error: err.message });
          }
        }
      }
    }

    this.logOperation('INFO', 'DEDUP_MERGE', `Merged duplicates: updated ${modifiedDocsCount} note(s), removed ${deletedLocalCount} local & ${deletedRemoteCount} remote file(s)`, {
      modifiedDocsCount,
      deletedLocalCount,
      deletedRemoteCount,
      skippedBySafetyGate
    });

    if (skippedBySafetyGate > 0) {
      new Notice(
        this.t('noticeDedupSafetyWarning', {
          modified: modifiedDocsCount,
          local: deletedLocalCount,
          remote: deletedRemoteCount,
          skipped: skippedBySafetyGate
        })
      );
    } else {
      new Notice(
        this.t('noticeDedupSuccess', {
          modified: modifiedDocsCount,
          local: deletedLocalCount,
          remote: deletedRemoteCount
        })
      );
    }

    if (onComplete) {
      onComplete({
        modified: modifiedDocsCount,
        local: deletedLocalCount,
        remote: deletedRemoteCount,
        skipped: skippedBySafetyGate
      });
    }
  }

  async migrateSingleLocalFileToRemote(tfile, { deleteLocal = true } = {}) {
    try {
      new Notice(this.t('noticeUploadingFile', { name: tfile.name }));
      const buf = await this.app.vault.readBinary(tfile);
      const res = await this.uploadBufferToServer(buf, tfile.name, 'application/octet-stream');

      const removeItem = {
        source: 'local',
        name: tfile.name,
        ext: tfile.extension.toLowerCase(),
        displayPath: tfile.path,
        rawObj: tfile
      };
      const keepItem = {
        source: 'remote',
        name: res.filename,
        ext: getExt(res.filename),
        displayPath: `${res.year}/${res.month}/${res.filename}`,
        rawObj: res
      };

      const allDocs = this.app.vault
        .getFiles()
        .filter((f) => (f.extension === 'md' || f.extension === 'canvas' || f.extension === 'excalidraw' || this.isExcalidrawFile(f)) && !isReportFile(f.name));

      let modifiedCount = 0;
      for (const doc of allDocs) {
        const modified = await this.safeModifyFileContent(doc, (orig) => {
          return this.rewriteContentLinks(orig, removeItem, keepItem);
        });
        if (modified) modifiedCount++;
      }

      if (deleteLocal) {
        const postSnapshot = await this.buildVaultReferenceSnapshot({ freshRead: true });
        const remaining = this.findReferencingNotesForLocalFile(tfile, postSnapshot);
        if (remaining.length === 0) {
          await this.app.vault.trash(tfile, true).catch(() => { });
        }
      }

      new Notice(
        this.t('noticeMigrateSuccess', {
          name: tfile.name,
          protected: '',
          docs: modifiedCount
        })
      );
      return res;
    } catch (err) {
      new Notice(this.t('noticeMigrateFailed', { name: tfile.name, err: err.message }));
      throw err;
    }
  }

  async downloadSingleRemoteItemToLocal(remoteMatch, options = {}) {
    const silent = Boolean(options?.silent);
    try {
      const { year, month, filename } = remoteMatch;
      if (!silent) {
        new Notice(this.t('noticeDownloadingFile', { name: filename }));
      }

      let remoteObj = remoteMatch.rawObj || null;
      if (!remoteObj) {
        try {
          const list = await this.fetchRemoteFileList();
          remoteObj = list.find(
            (r) => r.year === year && r.month === month && r.filename === filename
          );
        } catch { }
      }

      const activeFile = options?.activeFile || this.app.workspace.getActiveFile();
      const sourcePath = activeFile ? activeFile.path : '';
      const availablePath = remoteMatch.availablePath || await this.app.fileManager.getAvailablePathForAttachment(
        filename,
        sourcePath
      );
      const slashIdx = availablePath.lastIndexOf('/');
      const targetDir = slashIdx > -1 ? availablePath.slice(0, slashIdx) : '';
      const idealPath = remoteMatch.idealPath || (targetDir ? `${targetDir}/${filename}` : filename);

      let existingFile = remoteMatch.existingFile || null;
      if (!existingFile) {
        const byName = this.app.vault.getAbstractFileByPath(idealPath);
        if (byName && !Array.isArray(byName.children)) {
          existingFile = byName;
        }
      }
      const hasConflict = Boolean(existingFile && !Array.isArray(existingFile.children));

      const conflictStrategy = options?.conflictStrategy || 'rename';
      let targetLocalFile = null;
      let action = 'downloaded';

      if (hasConflict && conflictStrategy === 'reuse') {
        targetLocalFile = existingFile;
        action = 'reused';
      } else {
        const downloadUrl = remoteObj?.rawUrl
          ? `${remoteObj.rawUrl}?download=1`
          : `${remoteMatch.matchedUrl}?download=1`;

        const response = await requestUrl({
          url: downloadUrl,
          method: 'GET',
          headers: { Authorization: `Bearer ${this.settings.apiToken}` },
          throw: false
        });

        if (response.status < 200 || response.status >= 300 || !response.arrayBuffer) {
          throw new Error(`Failed to download remote file (HTTP ${response.status})`);
        }

        if (hasConflict && conflictStrategy === 'overwrite') {
          await this.app.vault.modifyBinary(existingFile, response.arrayBuffer);
          targetLocalFile = existingFile;
          action = 'overwritten';
        } else {
          targetLocalFile = await this.app.vault.createBinary(availablePath, response.arrayBuffer);
          action = 'downloaded';
        }
      }

      const removeItem = {
        source: 'remote',
        name: filename,
        ext: getExt(filename),
        displayPath: `${year}/${month}/${filename}`,
        rawObj: remoteObj || {
          year,
          month,
          filename,
          rawUrl: remoteMatch.matchedUrl,
          pubUrl: `${this.getCleanServerUrl()}/pub/${year}/${month}/${getBaseName(filename)}.webp`
        }
      };

      const keepItem = {
        source: 'local',
        name: targetLocalFile.name,
        ext: targetLocalFile.extension.toLowerCase(),
        displayPath: targetLocalFile.path,
        rawObj: targetLocalFile
      };

      const syncOtherNotes = options?.syncOtherNotes !== undefined ? Boolean(options.syncOtherNotes) : true;
      const allDocs = (syncOtherNotes || !activeFile)
        ? this.app.vault
            .getFiles()
            .filter((f) => this.isScannableDocFile(f))
        : [activeFile];

      let modifiedCount = 0;
      const syncedOtherNotePaths = [];
      for (const doc of allDocs) {
        const modified = await this.safeModifyFileContent(doc, (orig) => {
          return this.rewriteContentLinks(orig, removeItem, keepItem);
        });
        if (modified) {
          modifiedCount++;
          if (activeFile && doc.path !== activeFile.path) {
            syncedOtherNotePaths.push(doc.path);
          }
        }
      }

      if (!silent) {
        new Notice(
          this.t('noticeDownloadedToVault', {
            name: filename,
            path: targetLocalFile.path,
            docs: modifiedCount
          })
        );
      }

      if (options?.returnDetails) {
        return {
          file: targetLocalFile,
          name: targetLocalFile.name,
          originName: filename,
          displayPath: targetLocalFile.path,
          remotePath: `${year}/${month}/${filename}`,
          size: targetLocalFile.stat?.size || remoteObj?.size || 0,
          action,
          modifiedDocs: modifiedCount,
          syncedOtherNotes: syncedOtherNotePaths.length,
          syncedOtherNotePaths
        };
      }
      return targetLocalFile;
    } catch (err) {
      if (!silent) {
        new Notice(this.t('noticeDownloadFailed', { err: err.message }));
      }
      throw err;
    }
  }

  async scanActiveNoteRemoteAttachments(activeFile) {
    const content = await this.app.vault.read(activeFile);
    const serverBase = escapeRegExp(this.getCleanServerUrl());
    const re = new RegExp(
      `(${serverBase}\\/([^/\\s)]+)\\/(protected|\\d{4})\\/(keep|\\d{2})\\/([^)\\s]+))`,
      'gi'
    );

    const matchesMap = new Map();
    let m;
    while ((m = re.exec(content)) !== null) {
      let filename = m[5];
      try {
        filename = decodeURIComponent(filename);
      } catch { }
      const key = `${m[3]}/${m[4]}/${filename}`;
      if (!matchesMap.has(key)) {
        matchesMap.set(key, {
          matchedUrl: m[1],
          routePrefix: m[2],
          year: m[3],
          month: m[4],
          filename
        });
      }
    }

    if (matchesMap.size === 0) {
      return [];
    }

    let remoteList = [];
    try {
      remoteList = await this.fetchRemoteFileList();
    } catch { }

    const snapshot = await this.buildVaultReferenceSnapshot();

    // Pre-index local attachment files by size for fast SHA-256 content duplicate checks
    const localFilesBySize = new Map();
    const localHashCache = new Map();
    const getLocalFileSha256 = async (tfile) => {
      if (!tfile || Array.isArray(tfile.children)) return null;
      if (localHashCache.has(tfile.path)) return localHashCache.get(tfile.path);
      try {
        const buf = await this.app.vault.readBinary(tfile);
        const h = await computeSha256Hex(buf);
        localHashCache.set(tfile.path, h);
        return h;
      } catch {
        return null;
      }
    };
    for (const f of this.app.vault.getFiles()) {
      if (!isAttachmentExt(f.extension)) continue;
      if (this.isLocalPathExcluded(f.path)) continue;
      const sz = f.stat?.size || 0;
      if (sz <= 0) continue;
      if (!localFilesBySize.has(sz)) localFilesBySize.set(sz, []);
      localFilesBySize.get(sz).push(f);
    }

    const out = [];
    for (const match of matchesMap.values()) {
      const { year, month, filename, matchedUrl, routePrefix } = match;
      const remoteObj = remoteList.find(
        (r) => r.year === year && r.month === month && r.filename === filename
      );
      const availablePath = await this.app.fileManager.getAvailablePathForAttachment(
        filename,
        activeFile.path
      );
      const slashIdx = availablePath.lastIndexOf('/');
      const targetDir = slashIdx > -1 ? availablePath.slice(0, slashIdx) : '';
      const idealPath = targetDir ? `${targetDir}/${filename}` : filename;
      const existingByName = this.app.vault.getAbstractFileByPath(idealPath);
      const hasSameName = Boolean(existingByName && !Array.isArray(existingByName.children));

      let existingFile = hasSameName ? existingByName : null;
      let conflictType = null; // 'hash_and_name' | 'hash_only' | 'name_only' | null
      const remoteSha256 = remoteObj?.sha256 || null;
      const remoteSize = remoteObj?.size || 0;

      if (remoteSha256) {
        if (hasSameName) {
          const sameNameHash = await getLocalFileSha256(existingByName);
          if (sameNameHash && sameNameHash === remoteSha256) {
            conflictType = 'hash_and_name';
            existingFile = existingByName;
          }
        }
        if (!conflictType && remoteSize > 0) {
          const candidates = localFilesBySize.get(remoteSize) || [];
          // Prioritize candidates inside targetDir first
          const sortedCandidates = [...candidates].sort((a, b) => {
            const aInTarget = (a.parent?.path || '') === targetDir ? 0 : 1;
            const bInTarget = (b.parent?.path || '') === targetDir ? 0 : 1;
            return aInTarget - bInTarget;
          });
          for (const cand of sortedCandidates) {
            const candHash = await getLocalFileSha256(cand);
            if (candHash && candHash === remoteSha256) {
              conflictType = cand.path === idealPath ? 'hash_and_name' : 'hash_only';
              existingFile = cand;
              break;
            }
          }
        }
      }

      if (!conflictType && hasSameName) {
        conflictType = 'name_only';
        existingFile = existingByName;
      }

      const hasConflict = Boolean(conflictType && existingFile);
      const refNotes = this.findReferencingNotesForRemoteItem({ year, month, filename }, snapshot);
      const otherRefNotes = refNotes.filter((p) => p !== activeFile.path);

      out.push({
        id: `remote:${year}/${month}/${filename}`,
        source: 'remote',
        name: filename,
        filename,
        ext: getExt(filename),
        year,
        month,
        matchedUrl,
        routePrefix,
        displayPath: `${year}/${month}/${filename}`,
        size: remoteSize,
        sha256: remoteSha256,
        rawObj: remoteObj || {
          year,
          month,
          filename,
          rawUrl: matchedUrl,
          pubUrl: `${this.getCleanServerUrl()}/pub/${year}/${month}/${encodeURIComponent(getBaseName(filename))}.webp`
        },
        targetDir: targetDir || '/',
        idealPath,
        availablePath,
        existingFile: hasConflict ? existingFile : null,
        conflictType,
        hasConflict,
        refNotes,
        otherRefNotes,
        selected: true
      });
    }
    return out;
  }

  async executeDownloadNoteDirect(activeFile, onProgress = null, options = {}) {
    let items = Array.isArray(options?.items) ? options.items : null;
    if (!items) {
      items = await this.scanActiveNoteRemoteAttachments(activeFile);
    }

    if (items.length === 0) {
      return options?.returnDetails ? { count: 0, processedItems: [], failures: [] } : 0;
    }

    let count = 0;
    const processedItems = [];
    const failures = [];
    const conflictStrategy = options?.conflictStrategy || 'rename';
    const syncOtherNotes = options?.syncOtherNotes !== undefined ? Boolean(options.syncOtherNotes) : true;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (onProgress) onProgress(i + 1, items.length, item.filename || item.name);
      try {
        const detail = await this.downloadSingleRemoteItemToLocal(item, {
          activeFile,
          conflictStrategy,
          syncOtherNotes,
          silent: true,
          returnDetails: true
        });
        count++;
        processedItems.push({
          source: 'local',
          name: detail.name,
          ext: getExt(detail.name),
          displayPath: detail.displayPath,
          remotePath: detail.remotePath,
          size: detail.size,
          action: detail.action,
          syncedOtherNotes: detail.syncedOtherNotes || 0,
          syncedOtherNotePaths: detail.syncedOtherNotePaths || [],
          rawObj: detail.file
        });
      } catch (err) {
        this.logOperation('ERROR', 'NOTE_DOWNLOAD', `Failed to download ${item.filename || item.name} in ${activeFile.path}: ${err.message}`, {
          note: activeFile.path,
          remotePath: item.displayPath
        });
        failures.push({
          name: item.filename || item.name,
          size: item.size || 0,
          error: err.message || String(err)
        });
      }
    }
    if (count > 0) {
      this.logOperation('INFO', 'NOTE_DOWNLOAD', `Processed ${count} server attachment(s) in ${activeFile.path}`, {
        note: activeFile.path,
        conflictStrategy,
        syncOtherNotes,
        items: processedItems.map((p) => ({
          name: p.name,
          localPath: p.displayPath,
          action: p.action,
          syncedOtherNotes: p.syncedOtherNotePaths
        }))
      });
    }
    return options?.returnDetails ? { count, processedItems, failures } : count;
  }

  async downloadActiveNoteRemoteAttachments(targetFile = null, options = {}) {
    const activeFile = targetFile || this.app.workspace.getActiveFile();
    if (!activeFile || !this.isDocFile(activeFile)) {
      new Notice(this.t('noticeOpenMdFirst'));
      return;
    }
    const modal = new ActiveNoteActionModal(this.app, this, activeFile, 'download', options);
    if (options?.fromHub) {
      this.openModalSafely(modal);
    } else {
      modal.open();
    }
  }

  /**
   * Wizard 3 engine: scans local attachments eligible for batch migration (supports progress + abortSignal)
   */
  async scanLocalAttachmentsForBatchMigrate(options, scanCtx = {}) {
    const { signal, onProgress } = scanCtx || {};
    const snapshot = await this.buildVaultReferenceSnapshot({ signal, onProgress });
    const allowedGroups = new Set();
    if (options.typeImage) allowedGroups.add('image');
    if (options.typeAudio) allowedGroups.add('audio');
    if (options.typeOther) allowedGroups.add('other');

    const prefix = String(options.folderPrefix || '').replace(/^\/+|\/+$/g, '');
    const list = [];

    const allFiles = this.app.vault.getFiles();
    for (let i = 0; i < allFiles.length; i++) {
      if (signal?.aborted) throw new Error('SCAN_ABORTED');
      const f = allFiles[i];
      if (onProgress && i % 30 === 0) {
        onProgress(i + 1, allFiles.length, f.path);
        await new Promise((r) => setTimeout(r, 0));
      }
      if (!isAttachmentExt(f.extension)) continue;
      if (this.settings.uploadNonImageAttachments === false && !IMAGE_EXTS.has(f.extension.toLowerCase())) {
        continue;
      }
      if (prefix) {
        if (f.path !== prefix && !f.path.startsWith(prefix + '/')) continue;
      } else if (this.isLocalPathExcluded(f.path)) {
        continue;
      }

      const grp = getFileTypeGroup(f.extension);
      if (!allowedGroups.has(grp)) continue;

      const refNotes = this.findReferencingNotesForLocalFile(f, snapshot);
      list.push({
        id: `local:${f.path}`,
        source: 'local',
        name: f.name,
        ext: f.extension.toLowerCase(),
        displayPath: f.path,
        size: f.stat?.size || 0,
        refNotes,
        rawObj: f,
        selected: true
      });
    }

    return list;
  }

  async executeBatchMigrateSafely(selectedItems, options, onProgress, onDone) {
    const uploadedPairs = [];
    const failures = [];
    const total = selectedItems.length;

    for (let i = 0; i < total; i++) {
      const item = selectedItems[i];
      const tfile = item.rawObj;
      if (onProgress) onProgress(i + 1, total, tfile.name);

      try {
        const buf = await this.app.vault.readBinary(tfile);
        const res = await this.uploadBufferToServer(
          buf,
          tfile.name,
          'application/octet-stream',
          Boolean(options.uploadToProtected)
        );

        uploadedPairs.push({
          tfile,
          name: tfile.name,
          displayPath: tfile.path,
          size: tfile.stat?.size || 0,
          rawUrl: res.rawUrl,
          pubUrl: res.pubUrl,
          refNotes: item.refNotes || [],
          removeItem: {
            source: 'local',
            name: tfile.name,
            ext: tfile.extension.toLowerCase(),
            displayPath: tfile.path,
            rawObj: tfile
          },
          keepItem: {
            source: 'remote',
            name: res.filename,
            ext: getExt(res.filename),
            displayPath: `${res.year}/${res.month}/${res.filename}`,
            rawObj: res
          }
        });
      } catch (err) {
        failures.push({
          name: tfile.name,
          path: tfile.path,
          size: tfile.stat?.size || 0,
          error: err.message || String(err)
        });
        new Notice(this.t('noticeMigrateFailed', { name: tfile.name, err: err.message }));
        this.logOperation('ERROR', 'BATCH_UPLOAD', `Batch upload failed for ${tfile.path}: ${err.message}`, {
          file: tfile.path,
          size: tfile.stat?.size || 0
        });
      }
    }

    if (uploadedPairs.length === 0) {
      if (onDone) {
        onDone({
          count: 0,
          docs: 0,
          trashed: 0,
          processedItems: [],
          failures,
          totalBytes: 0
        });
      }
      return;
    }

    const allDocs = this.app.vault
      .getFiles()
      .filter((f) => this.isScannableDocFile(f));

    let modifiedDocsCount = 0;
    const modifiedNotePaths = new Set();
    for (const doc of allDocs) {
      const modified = await this.safeModifyFileContent(doc, (content) => {
        let next = content;
        for (const { removeItem, keepItem } of uploadedPairs) {
          next = this.rewriteContentLinks(next, removeItem, keepItem);
        }
        return next;
      });
      if (modified) {
        modifiedDocsCount++;
        modifiedNotePaths.add(doc.path);
      }
    }

    let trashedCount = 0;
    const trashedFiles = [];
    const trashFailures = [];
    if (options.deleteLocalAfter) {
      const postSnapshot = await this.buildVaultReferenceSnapshot({ freshRead: true });
      for (const { tfile } of uploadedPairs) {
        const remaining = this.findReferencingNotesForLocalFile(tfile, postSnapshot);
        if (remaining.length === 0) {
          try {
            await this.app.vault.trash(tfile, true);
            trashedCount++;
            trashedFiles.push(tfile.path);
          } catch (trashErr) {
            const errStr = trashErr.message || String(trashErr);
            this.logOperation('WARN', 'TRASH_LOCAL', `Failed to trash local file: ${tfile.path}`, {
              error: errStr
            });
            trashFailures.push({ path: tfile.path, error: errStr });
          }
        }
      }
    }

    this.logOperation('INFO', 'BATCH_UPLOAD', `Batch uploaded ${uploadedPairs.length} file(s), updated ${modifiedDocsCount} note(s), trashed ${trashedCount} local file(s)`, {
      uploadedCount: uploadedPairs.length,
      modifiedDocsCount,
      trashedCount,
      failuresCount: failures.length
    });

    if (onDone) {
      onDone({
        count: uploadedPairs.length,
        docs: modifiedDocsCount,
        modifiedNotePaths: Array.from(modifiedNotePaths),
        trashed: trashedCount,
        trashedFiles,
        processedItems: uploadedPairs.map((p) => ({
          name: p.name,
          displayPath: p.displayPath,
          size: p.size,
          rawUrl: p.rawUrl,
          pubUrl: p.pubUrl,
          ext: p.keepItem.ext,
          source: 'remote',
          rawObj: p.keepItem.rawObj,
          refNotesCount: Array.isArray(p.refNotes) ? p.refNotes.length : 0
        })),
        failures,
        trashFailures,
        totalBytes: uploadedPairs.reduce((s, p) => s + (p.size || 0), 0)
      });
    }
  }

  async scanActiveNoteLocalAttachments(activeFile) {
    const content = await this.app.vault.read(activeFile);
    const wikiRegex = /!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g;
    const mdLinkRegex = /!?\[([^\]]*)\]\((?!https?:\/\/)([^)]+)\)/g;

    const localFilesMap = new Map();
    let m;
    while ((m = wikiRegex.exec(content)) !== null) {
      const tf = this.app.metadataCache.getFirstLinkpathDest(m[1].trim(), activeFile.path);
      if (tf && isAttachmentExt(tf.extension)) {
        localFilesMap.set(tf.path, tf);
      }
    }
    while ((m = mdLinkRegex.exec(content)) !== null) {
      let rawTarget = m[2].trim().replace(/^<|>$/g, '');
      try {
        rawTarget = decodeURIComponent(rawTarget);
      } catch { }
      const tf = this.app.metadataCache.getFirstLinkpathDest(rawTarget, activeFile.path);
      if (tf && isAttachmentExt(tf.extension)) {
        localFilesMap.set(tf.path, tf);
      }
    }

    const snapshot = await this.buildVaultReferenceSnapshot();

    return Array.from(localFilesMap.values()).map((tf) => {
      const refNotes = this.findReferencingNotesForLocalFile(tf, snapshot);
      const otherRefNotes = refNotes.filter((p) => p !== activeFile.path);
      return {
        id: `local:${tf.path}`,
        source: 'local',
        name: tf.name,
        ext: tf.extension.toLowerCase(),
        displayPath: tf.path,
        size: tf.stat?.size || 0,
        rawObj: tf,
        tfile: tf,
        refNotes,
        otherRefNotes,
        selected: true,
        locked: false
      };
    });
  }

  async executeMigrateNoteDirect(activeFile, onProgress = null, options = {}) {
    let content = await this.app.vault.read(activeFile);
    let items = Array.isArray(options?.items) ? options.items : null;
    if (!items) {
      items = await this.scanActiveNoteLocalAttachments(activeFile);
    }

    if (items.length === 0) {
      return options?.returnDetails ? { count: 0, processedItems: [], failures: [] } : 0;
    }

    let migratedCount = 0;
    const uploadedPairs = [];
    const processedItems = [];
    const failures = [];
    for (let i = 0; i < items.length; i++) {
      const entry = items[i];
      const tfile = entry.tfile || entry.rawObj || entry;
      const wantLock = Boolean(entry.locked);
      if (onProgress) onProgress(i + 1, items.length, tfile.name);
      try {
        const buf = await this.app.vault.readBinary(tfile);
        const res = await this.uploadBufferToServer(buf, tfile.name);

        if (wantLock && !res.locked && res.year && res.month && res.filename) {
          try {
            await this.toggleRemoteFileLock(res.year, res.month, res.filename, true);
            res.locked = true;
          } catch (lockErr) {
            console.warn(`Failed to lock ${res.filename}:`, lockErr);
          }
        }

        const removeItem = {
          source: 'local',
          name: tfile.name,
          ext: tfile.extension.toLowerCase(),
          displayPath: tfile.path,
          rawObj: tfile
        };
        const keepItem = {
          source: 'remote',
          name: res.filename,
          ext: getExt(res.filename),
          displayPath: `${res.year}/${res.month}/${res.filename}`,
          rawObj: res
        };

        content = this.rewriteContentLinks(content, removeItem, keepItem);
        migratedCount++;
        const otherRefNotes = Array.isArray(entry.otherRefNotes) ? entry.otherRefNotes : [];
        uploadedPairs.push({ tfile, removeItem, keepItem, otherRefNotes });
        processedItems.push({
          source: 'remote',
          name: res.filename,
          ext: getExt(res.filename),
          displayPath: `${res.year}/${res.month}/${res.filename}`,
          size: tfile.stat?.size || res.size || 0,
          locked: Boolean(res.locked || wantLock),
          trashedLocal: false,
          keptForOtherRefs: 0,
          keptForOtherRefPaths: [],
          syncedOtherNotes: 0,
          syncedOtherNotePaths: [],
          action: 'uploaded',
          rawObj: res,
          localPath: tfile.path
        });
      } catch (err) {
        console.error(`Failed to migrate ${tfile.name}:`, err);
        this.logOperation('ERROR', 'NOTE_UPLOAD', `Failed to upload ${tfile.name} in ${activeFile.path}: ${err.message}`, {
          note: activeFile.path,
          file: tfile.path,
          size: tfile.stat?.size || 0
        });
        failures.push({
          name: tfile.name,
          size: tfile.stat?.size || 0,
          error: err.message || String(err)
        });
      }
    }

    if (migratedCount > 0) {
      await this.safeModifyFileContent(activeFile, () => content);
      const shouldDeleteLocal = options?.deleteLocalAfter !== undefined
        ? Boolean(options.deleteLocalAfter)
        : Boolean(this.settings.deleteLocalAfterMigrate);
      const syncOtherNotes = options?.syncOtherNotes !== undefined
        ? Boolean(options.syncOtherNotes)
        : true;

      if (syncOtherNotes) {
        const otherDocs = this.app.vault
          .getFiles()
          .filter((f) => f.path !== activeFile.path && this.isScannableDocFile(f));
        for (let i = 0; i < uploadedPairs.length; i++) {
          const { removeItem, keepItem } = uploadedPairs[i];
          const syncedPaths = [];
          for (const doc of otherDocs) {
            const modified = await this.safeModifyFileContent(doc, (orig) => {
              return this.rewriteContentLinks(orig, removeItem, keepItem);
            });
            if (modified) syncedPaths.push(doc.path);
          }
          if (processedItems[i]) {
            processedItems[i].syncedOtherNotes = syncedPaths.length;
            processedItems[i].syncedOtherNotePaths = syncedPaths;
          }
        }
      }

      if (shouldDeleteLocal) {
        const postSnapshot = !syncOtherNotes
          ? await this.buildVaultReferenceSnapshot({ freshRead: true })
          : null;
        for (let i = 0; i < uploadedPairs.length; i++) {
          const { tfile } = uploadedPairs[i];
          if (!syncOtherNotes && postSnapshot) {
            const remainingRefs = this.findReferencingNotesForLocalFile(tfile, postSnapshot).filter(
              (p) => p !== activeFile.path
            );
            if (remainingRefs.length > 0) {
              if (processedItems[i]) {
                processedItems[i].keptForOtherRefs = remainingRefs.length;
                processedItems[i].keptForOtherRefPaths = remainingRefs;
              }
              continue;
            }
          }
          try {
            await this.app.vault.trash(tfile, true);
            if (processedItems[i]) {
              processedItems[i].trashedLocal = true;
            }
          } catch (trashErr) {
            this.logOperation('WARN', 'TRASH_LOCAL', `Failed to trash local file: ${tfile.path}`, {
              error: trashErr.message || String(trashErr)
            });
            if (processedItems[i]) {
              processedItems[i].trashedLocal = false;
              processedItems[i].trashError = trashErr.message || String(trashErr);
            }
          }
        }
      }

      this.logOperation('INFO', 'NOTE_UPLOAD', `Uploaded ${migratedCount} attachment(s) from ${activeFile.path}`, {
        note: activeFile.path,
        deleteLocalAfter: shouldDeleteLocal,
        syncOtherNotes,
        items: processedItems.map((p) => ({
          name: p.name,
          remotePath: p.displayPath,
          locked: p.locked,
          trashedLocal: p.trashedLocal,
          keptForOtherRefs: p.keptForOtherRefPaths,
          syncedOtherNotes: p.syncedOtherNotePaths
        }))
      });
    }
    return options?.returnDetails ? { count: migratedCount, processedItems, failures } : migratedCount;
  }

  async migrateActiveNoteAttachments(targetFile = null, options = {}) {
    const activeFile = targetFile || this.app.workspace.getActiveFile();
    if (!activeFile || !this.isDocFile(activeFile)) {
      new Notice(this.t('noticeOpenMdFirst'));
      return;
    }
    const modal = new ActiveNoteActionModal(this.app, this, activeFile, 'migrate', options);
    if (options?.fromHub) {
      this.openModalSafely(modal);
    } else {
      modal.open();
    }
  }

  async copyActiveNoteForAstro(targetFile = null) {
    const activeFile = targetFile || this.app.workspace.getActiveFile();
    if (!activeFile || !this.isDocFile(activeFile)) {
      new Notice(this.t('noticeOpenMdFirst'));
      return;
    }
    const content = await this.app.vault.read(activeFile);
    const converted = content.replace(
      /\/[a-zA-Z0-9_-]+\/((?:protected|\d{4})\/(?:keep|\d{2})\/[^.)\s]+)\.(png|jpg|jpeg|webp|gif|avif|heic|heif|tif|tiff|bmp|jfif)/gi,
      '/pub/$1.webp'
    );
    await navigator.clipboard.writeText(converted);
    new Notice(this.t('noticeAstroCopied'));
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class FileMasterSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.activePage = 'home';
  }

  createHeading(containerEl, tag, icon, label) {
    const heading = containerEl.createEl(tag, { cls: 'fm-settings-heading' });
    heading.createSpan({ cls: 'fm-settings-heading-icon', text: icon, attr: { 'aria-hidden': 'true' } });
    heading.createSpan({ text: label });
    return heading;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('fm-settings');

    const pages = {
      general: 'tabGeneral',
      server: 'tabServer',
      upload: 'tabUpload',
      exemptions: 'tabExemptions',
      about: 'aboutTitle'
    };
    const pageIcons = {
      general: '⚙️',
      server: '🖥️',
      upload: '📎',
      exemptions: '🛡️',
      about: 'ℹ️'
    };

    if (this.activePage === 'home' || !pages[this.activePage]) {
      this.activePage = 'home';
      this.renderSettingsHome(containerEl);
      return;
    }

    const header = containerEl.createDiv({ cls: 'fm-settings-page-header' });
    const back = header.createEl('button', {
      cls: 'clickable-icon fm-settings-back',
      attr: { 'aria-label': this.plugin.t('settingsBack'), title: this.plugin.t('settingsBack') }
    });
    setIcon(back, 'arrow-left');
    back.onclick = () => {
      this.activePage = 'home';
      this.display();
    };
    this.createHeading(header, 'h2', pageIcons[this.activePage], this.plugin.t(pages[this.activePage]));
    const section = containerEl.createDiv({ cls: 'fm-settings-section' });
    if (this.activePage === 'general') this.renderGeneralSettings(section);
    if (this.activePage === 'server') this.renderServerSettings(section);
    if (this.activePage === 'upload') this.renderUploadSettings(section);
    if (this.activePage === 'exemptions') this.renderExemptionsSettings(section);
    if (this.activePage === 'about') {
      section.addClass('fm-settings-about');
      this.renderAboutFooter(section);
    }
  }

  renderSettingsHome(containerEl) {
    const group = (title, icon, entries) => {
      const section = containerEl.createDiv({ cls: 'fm-settings-nav-section' });
      this.createHeading(section, 'h3', icon, this.plugin.t(title));
      const list = section.createDiv({ cls: 'fm-settings-nav-list' });
      for (const [page, label, icon] of entries) {
        const setting = new Setting(list).setName(this.plugin.t(label));
        const row = setting.settingEl;
        row.addClass('fm-settings-nav-item');
        setting.descEl?.remove();
        row.setAttribute('role', 'button');
        row.setAttribute('tabindex', '0');
        const iconEl = setting.nameEl.createSpan({ cls: 'fm-settings-nav-icon' });
        setIcon(iconEl, icon);
        setting.nameEl.prepend(iconEl);
        setIcon(setting.controlEl.createSpan({ cls: 'fm-settings-nav-chevron' }), 'chevron-right');
        const open = () => {
          if (page === 'hub') {
            this.plugin.openModalSafely(new FileMasterHubModal(this.app, this.plugin));
            return;
          }
          if (page === 'logs') {
            this.plugin.openModalSafely(new OperationLogModal(this.app, this.plugin));
            return;
          }
          this.activePage = page;
          this.display();
          containerEl.scrollTop = 0;
        };
        row.onclick = open;
        row.onkeydown = (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            open();
          }
        };
      }
    };

    group('settingsCoreGroup', '⚡', [
      ['upload', 'tabUpload', 'paperclip'],
      ['server', 'tabServer', 'server']
    ]);
    group('settingsPreferencesGroup', '⚙️', [
      ['general', 'tabGeneral', 'sliders-horizontal'],
      ['exemptions', 'tabExemptions', 'shield']
    ]);
    group('settingsToolsGroup', '🧰', [
      ['hub', 'openHubName', 'wrench'],
      ['logs', 'opLogTitle', 'file-text']
    ]);
    group('settingsInfoGroup', 'ℹ️', [
      ['about', 'aboutTitle', 'info']
    ]);
  }

  renderGeneralSettings(containerEl) {
    new Setting(containerEl)
      .setName(this.plugin.t('langName'))
      .setDesc(this.plugin.t('langDesc'))
      .addDropdown((drop) =>
        drop
          .addOption('auto', this.plugin.t('langAuto'))
          .addOption('zh', '简体中文')
          .addOption('en', 'English')
          .setValue(this.plugin.settings.language || 'auto')
          .onChange(async (value) => {
            this.plugin.settings.language = value;
            await this.plugin.saveSettings();
            this.plugin.onLanguageChange();
            this.display();
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.t('sidebarBtnName'))
      .setDesc(this.plugin.t('sidebarBtnDesc'))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enableSidebarButton !== false).onChange(async (value) => {
          this.plugin.settings.enableSidebarButton = value;
          await this.plugin.saveSettings();
          this.plugin.updateSidebarRibbonButton();
        })
      );
  }

  renderServerSettings(containerEl) {
    new Setting(containerEl)
      .setName(this.plugin.t('enableRemoteServerName'))
      .setDesc(this.plugin.t('enableRemoteServerDesc'))
      .addToggle((toggle) =>
        toggle
          .setValue(Boolean(this.plugin.settings.enableRemoteServer))
          .onChange(async (value) => {
            this.plugin.settings.enableRemoteServer = value;
            if (!value) {
              this.plugin.settings.serverVerified = false;
              this.plugin.lastServerCompatStatus = null;
            }
            await this.plugin.saveSettings();
            this.display();
          })
      );

    if (!this.plugin.settings.enableRemoteServer) {
      const hint = containerEl.createDiv({ cls: 'fm-settings-hint' });
      hint.setText(this.plugin.t('serverDisabledHint'));
      return;
    }

    new Setting(containerEl)
      .setName(this.plugin.t('serverUrlName'))
      .setDesc(this.plugin.t('serverUrlDesc'))
      .addText((text) =>
        text
          .setPlaceholder('http://localhost:3000')
          .setValue(this.plugin.settings.serverUrl)
          .onChange(async (value) => {
            this.plugin.settings.serverUrl = value.trim();
            this.plugin.settings.serverVerified = false;
            this.plugin.lastServerCompatStatus = null;
            updateStatusBox(null);
            await this.plugin.saveSettings();
          })
      );

    let statusBox;
    const updateStatusBox = (compat) => {
      if (!statusBox) return;
      statusBox.dataset.status = !compat
        ? (this.plugin.settings.serverVerified ? 'success' : 'pending')
        : (compat.ok ? 'success' : compat.status === 'server_outdated' ? 'pending' : 'error');
      statusBox.textContent = this.plugin.getCompatibilityMessage(compat);
    };

    let tokenInput;
    new Setting(containerEl)
      .setName(this.plugin.t('apiTokenName'))
      .setDesc(this.plugin.t('apiTokenDesc'))
      .addText((text) => {
        tokenInput = text.inputEl;
        tokenInput.type = 'password';
        text
          .setPlaceholder('API token')
          .setValue(this.plugin.settings.apiToken)
          .onChange(async (value) => {
            this.plugin.settings.apiToken = value.trim();
            this.plugin.settings.serverVerified = false;
            this.plugin.lastServerCompatStatus = null;
            updateStatusBox(null);
            await this.plugin.saveSettings();
          });
      })
      .addExtraButton((btn) => btn
        .setIcon('eye')
        .setTooltip(this.plugin.t('showToken'))
        .onClick(() => {
          const hidden = tokenInput.type === 'password';
          tokenInput.type = hidden ? 'text' : 'password';
          btn.setIcon(hidden ? 'eye-off' : 'eye');
          btn.setTooltip(this.plugin.t(hidden ? 'hideToken' : 'showToken'));
        }));

    const connectionRow = containerEl.createDiv({ cls: 'fm-settings-connection-row' });
    statusBox = connectionRow.createDiv({ cls: 'fm-server-compat-banner' });
    updateStatusBox(this.plugin.lastServerCompatStatus);
    new Setting(connectionRow)
      .addButton((btn) =>
        btn.setButtonText(this.plugin.t('btnTestConn')).onClick(async () => {
          btn.disabled = true;
          btn.setButtonText(this.plugin.t('compatStatusChecking'));
          statusBox.dataset.status = 'pending';
          statusBox.textContent = this.plugin.t('compatStatusChecking');

          let compat;
          try {
            compat = await this.plugin.checkServerCompatibility();
            updateStatusBox(compat);
            new Notice(this.plugin.getCompatibilityMessage(compat));
          } finally {
            btn.disabled = false;
            btn.setButtonText(this.plugin.t('btnTestConn'));
          }
          if (compat) this.display();
        })
      );
  }

  renderUploadSettings(containerEl) {
    new Setting(containerEl)
      .setName(this.plugin.t('clipboardMonitorName'))
      .setDesc(this.plugin.t('clipboardMonitorDesc'))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enableClipboardMonitor !== false).onChange(async (value) => {
          this.plugin.settings.enableClipboardMonitor = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(this.plugin.t('saveLocationName'))
      .setDesc(this.plugin.t('saveLocationDesc'))
      .addDropdown((drop) =>
        drop
          .addOption('ask', this.plugin.t('optSaveAsk'))
          .addOption('remote', this.plugin.t('optSaveRemote'))
          .addOption('local', this.plugin.t('optSaveLocal'))
          .setValue(this.plugin.settings.saveLocationMode)
          .onChange(async (value) => {
            this.plugin.settings.saveLocationMode = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.t('defaultSaveLocationName'))
      .setDesc(this.plugin.t('defaultSaveLocationDesc'))
      .addDropdown((drop) =>
        drop
          .addOption('remote', this.plugin.t('destSaveRemote'))
          .addOption('local', this.plugin.t('destSaveLocal'))
          .setValue(this.plugin.settings.defaultSaveLocation || 'remote')
          .onChange(async (value) => {
            this.plugin.settings.defaultSaveLocation = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.t('insertOptimizedName'))
      .setDesc(this.plugin.t('insertOptimizedDesc'))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.insertOptimizedLinkOnUpload).onChange(async (value) => {
          this.plugin.settings.insertOptimizedLinkOnUpload = value;
          await this.plugin.saveSettings();
        })
      );

    let patternSetting = null;
    new Setting(containerEl)
      .setName(this.plugin.t('namingStrategyName'))
      .setDesc(this.plugin.t('namingStrategyDesc'))
      .addDropdown((drop) =>
        drop
          .addOption('keep', this.plugin.t('optNamingKeep'))
          .addOption('rule', this.plugin.t('optNamingRule'))
          .addOption('prompt', this.plugin.t('optNamingPrompt'))
          .setValue(this.plugin.settings.namingMode || 'keep')
          .onChange(async (value) => {
            this.plugin.settings.namingMode = value;
            await this.plugin.saveSettings();
            if (patternSetting && patternSetting.settingEl) {
              patternSetting.settingEl.style.display = value === 'rule' ? '' : 'none';
            }
          })
      );

    patternSetting = new Setting(containerEl)
      .setName(this.plugin.t('namingPatternName'))
      .setDesc(this.plugin.t('namingPatternDesc'))
      .addText((text) =>
        text
          .setPlaceholder('{note}_{date}_{rand:4}')
          .setValue(this.plugin.settings.namingPattern || '{note}_{date}_{rand:4}')
          .onChange(async (value) => {
            this.plugin.settings.namingPattern = value.trim() || '{note}_{date}_{rand:4}';
            await this.plugin.saveSettings();
          })
      );
    if (patternSetting.settingEl) {
      patternSetting.settingEl.style.display = this.plugin.settings.namingMode === 'rule' ? '' : 'none';
    }

    new Setting(containerEl)
      .setName(this.plugin.t('uploadNonImageName'))
      .setDesc(this.plugin.t('uploadNonImageDesc'))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.uploadNonImageAttachments !== false).onChange(async (value) => {
          this.plugin.settings.uploadNonImageAttachments = value;
          await this.plugin.saveSettings();
        })
      );
  }

  renderExemptionsSettings(containerEl) {
    new Setting(containerEl)
      .setName(this.plugin.t('excludedFoldersName'))
      .setDesc(this.plugin.t('excludedFoldersDesc'))
      .addText((text) =>
        text
          .setPlaceholder('templates, assets/protected')
          .setValue(this.plugin.settings.excludedLocalFolders)
          .onChange(async (value) => {
            this.plugin.settings.excludedLocalFolders = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.t('excludeLockedRemoteName'))
      .setDesc(this.plugin.t('excludeLockedRemoteDesc'))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.excludeLockedRemoteFiles).onChange(async (value) => {
          this.plugin.settings.excludeLockedRemoteFiles = value;
          await this.plugin.saveSettings();
        })
      );

  }

  renderAboutFooter(containerEl) {
    const manifest = this.plugin.manifest || {};
    const version = manifest.version || '0.1.1';
    const author = manifest.author || 'weichen-ink';
    const authorUrl = manifest.authorUrl || 'https://github.com/weichen-ink';
    const repoUrl = 'https://github.com/weichen-ink/file-master';

    const intro = new Setting(containerEl)
      .setName('File Master')
      .setDesc(this.plugin.t('aboutDesc'));
    intro.controlEl.createSpan({ text: `v${version}` });

    const addRow = (label) => new Setting(containerEl).setName(this.plugin.t(label)).controlEl;
    addRow('aboutAuthor').createEl('a', { text: author, href: authorUrl, attr: { target: '_blank', rel: 'noopener noreferrer' } });
    addRow('aboutRepo').createEl('a', { text: 'weichen-ink/file-master', href: repoUrl, attr: { target: '_blank', rel: 'noopener noreferrer' } });
    addRow('aboutServerCompat').createSpan({ text: `v${MIN_SERVER_VERSION}+` });
    const sCompat = this.plugin.lastServerCompatStatus;
    addRow('aboutServerStatus').createSpan({
      cls: `fm-about-status ${sCompat?.ok ? 'is-connected' : ''}`,
      text: sCompat ? this.plugin.getCompatibilityMessage(sCompat) : this.plugin.t('aboutServerOffline')
    });
    new Setting(containerEl)
      .setName(this.plugin.t('opLogTitle'))
      .setDesc(this.plugin.t('opLogDesc'))
      .addButton((btn) =>
        btn.setButtonText(this.plugin.t('opLogBtnOpen')).onClick(() => {
          this.plugin.openModalSafely(new OperationLogModal(this.app, this.plugin));
        })
      );
    addRow('aboutFeedback').createEl('a', { text: this.plugin.t('aboutFeedbackLink'), href: `${repoUrl}/issues`, attr: { target: '_blank', rel: 'noopener noreferrer' } });
  }
}

FileMasterPlugin.scanNoteContentForBrokenLinks = scanNoteContentForBrokenLinks;
FileMasterPlugin.computeVaultStatsFromEntries = computeVaultStatsFromEntries;
FileMasterPlugin.isReportFile = isReportFile;
FileMasterPlugin.translateUi = translateUi;
FileMasterPlugin.HealthCheckModal = HealthCheckModal;
FileMasterPlugin.VaultAnalyticsModal = VaultAnalyticsModal;

module.exports = FileMasterPlugin;
