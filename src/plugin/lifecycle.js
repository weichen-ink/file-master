class FileMasterLifecycle extends FileMasterLogging {
  async onload() {
    await this.loadSettings();
    this.operationLogs = [];
    await this.loadOperationLogs();
    this.heicPreviewCache = new Map();
    this.sidebarRibbonEl = null;
    this.lastServerCompatStatus = null;
    this.lastActiveMarkdownView = null;
    this.referenceRevision = 0;
    for (const event of ['create', 'modify', 'delete', 'rename']) {
      this.registerEvent(this.app.vault.on(event, (file) => {
        if (this.isScannableDocFile(file)) this.referenceRevision++;
      }));
    }

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
        id: 'resume-pending-upload',
        nameKey: 'cmdResumeUpload',
        requiresRemote: true,
        callback: () => this.resumePendingMigration().catch((err) => new Notice(err.message))
      },
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
    this.activeTransferController?.abort();
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
}
