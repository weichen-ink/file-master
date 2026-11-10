class FileMasterContextMenus extends FileMasterVaultUtils {
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
}
