import { isLocalPathExcluded, toggleLocalFolderExclusion, isExcalidrawFile } from './vault-utils.js';
import { migrateSingleLocalFileToRemote, migrateActiveNoteAttachments, downloadActiveNoteRemoteAttachments, copyActiveNoteForAstro } from './attachment-ops.js';
import { NEEDS_TRANSCODE_IMAGE_EXTS, isAttachmentExt } from '../constants.js';
import { convertBufferToPreviewUrl, escapeRegExp, getBaseName, getExt } from '../engine.js';
import { BatchMigrateWizardModal } from '../modals/batch-migrate-wizard.js';
import { Notice } from 'obsidian';

// The plugin owns host state; these operations receive it explicitly.
export function registerContextMenus(plugin) {
  plugin.registerEvent(
    plugin.app.workspace.on('file-menu', (menu, abstractFile) => {
      if (!abstractFile) return;

      if (Array.isArray(abstractFile.children)) {
        const folderPath = abstractFile.path;
        if (!folderPath || folderPath === '/') return;

        if (plugin.isRemoteServerReady()) {
          menu.addItem((item) => {
            item
              .setTitle(plugin.t('menuMigrateFolder'))
              .setIcon('upload-cloud')
              .onClick(() => {
                new BatchMigrateWizardModal(plugin.app, plugin, folderPath).open();
              });
          });
        }

        const isExcluded = isLocalPathExcluded(plugin.settings, folderPath);
        menu.addItem((item) => {
          item
            .setTitle(isExcluded ? plugin.t('menuRemoveExclusion') : plugin.t('menuAddExclusion'))
            .setIcon('shield')
            .onClick(() => {
              toggleLocalFolderExclusion(plugin, folderPath);
            });
        });
        return;
      }

      if (abstractFile.extension && isAttachmentExt(abstractFile.extension)) {
        if (plugin.isRemoteServerReady()) {
          menu.addItem((item) => {
            item
              .setTitle(plugin.t('menuUploadCloud'))
              .setIcon('upload-cloud')
              .onClick(async () => {
                await migrateSingleLocalFileToRemote(plugin, abstractFile, {
                  deleteLocal: plugin.settings.deleteLocalAfterMigrate
                });
              });
          });
        }
        return;
      }

      const isNoteOrExcalidraw =
        abstractFile.extension === 'md' ||
        abstractFile.extension === 'excalidraw' ||
        isExcalidrawFile(plugin.app, abstractFile);

      if (isNoteOrExcalidraw && plugin.isRemoteServerReady()) {
        menu.addItem((item) => {
          item
            .setTitle(plugin.t('menuActiveNoteMigrate'))
            .setIcon('upload-cloud')
            .onClick(() => {
              return migrateActiveNoteAttachments(plugin, abstractFile);
            });
        });

        menu.addItem((item) => {
          item
            .setTitle(plugin.t('menuActiveNoteDownload'))
            .setIcon('download-cloud')
            .onClick(() => {
              return downloadActiveNoteRemoteAttachments(plugin, abstractFile);
            });
        });

        menu.addItem((item) => {
          item
            .setTitle(plugin.t('menuActiveNoteAstro'))
            .setIcon('external-link')
            .onClick(() => {
              return copyActiveNoteForAstro(plugin, abstractFile);
            });
        });
      }
    })
  );

  plugin.registerEvent(
    plugin.app.workspace.on('editor-menu', (menu, editor) => {
      if (!plugin.isRemoteServerReady()) return;
      const cursor = editor.getCursor();
      const lineText = editor.getLine(cursor.line) || '';
      if (!lineText.trim()) return;

      const remoteMatch = extractRemoteItemFromLine(plugin, lineText);
      if (remoteMatch) {
        menu.addItem((item) => {
          item
            .setTitle(plugin.t('menuCopyRaw', { name: remoteMatch.filename }))
            .setIcon('copy')
            .onClick(async () => {
              await navigator.clipboard.writeText(remoteMatch.matchedUrl);
              new Notice(plugin.t('noticeCopiedRaw', { name: remoteMatch.filename }));
            });
        });

        menu.addItem((item) => {
          item
            .setTitle(plugin.t('menuCopyWebp'))
            .setIcon('zap')
            .onClick(async () => {
              const base = getBaseName(remoteMatch.filename);
              const optUrl = `${plugin.getCleanServerUrl()}/pub/${remoteMatch.year}/${remoteMatch.month}/${encodeURIComponent(base)}.webp`;
              await navigator.clipboard.writeText(optUrl);
              new Notice(plugin.t('noticeCopiedWebp', { name: base + '.webp' }));
            });
        });

        menu.addItem((item) => {
          item
            .setTitle(plugin.t('menuDownloadToVault', { name: remoteMatch.filename }))
            .setIcon('download')
            .onClick(async () => {
              await plugin.downloadSingleRemoteItemToLocal(remoteMatch);
            });
        });

        menu.addItem((item) => {
          item
            .setTitle(plugin.t('menuLockRemote', { name: remoteMatch.filename }))
            .setIcon('lock')
            .onClick(async () => {
              try {
                await plugin.toggleRemoteFileLock(
                  remoteMatch.year,
                  remoteMatch.month,
                  remoteMatch.filename,
                  true
                );
                new Notice(plugin.t('noticeProtectedRemote', { name: remoteMatch.filename }));
              } catch (err) {
                new Notice(plugin.t('noticeLockFailed', { err: err.message }));
              }
            });
        });
      }

      const localTFile = extractLocalAttachmentFromLine(plugin, lineText);
      if (localTFile) {
        menu.addItem((item) => {
          item
            .setTitle(`${plugin.t('menuUploadCloud')} (${localTFile.name})`)
            .setIcon('upload-cloud')
            .onClick(async () => {
              await migrateSingleLocalFileToRemote(plugin, localTFile, {
                toProtected: false,
                deleteLocal: plugin.settings.deleteLocalAfterMigrate
              });
            });
        });
      }
    })
  );
}

export function extractRemoteItemFromLine(plugin, lineText) {
  const serverBase = escapeRegExp(plugin.getCleanServerUrl());
  const re = new RegExp(
    `(${serverBase}\\/([^/\\s)]+)\\/(\\d{4})\\/(\\d{2})\\/([^)\\s]+))`,
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

export function extractLocalAttachmentFromLine(plugin, lineText) {
  const activeFile = plugin.app.workspace.getActiveFile();
  const sourcePath = activeFile ? activeFile.path : '';

  const wikiMatch = /!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/.exec(lineText);
  if (wikiMatch) {
    const tf = plugin.app.metadataCache.getFirstLinkpathDest(wikiMatch[1].trim(), sourcePath);
    if (tf && isAttachmentExt(tf.extension)) return tf;
  }

  const mdMatch = /!?\[[^\]]*\]\((?!https?:\/\/)([^)]+)\)/.exec(lineText);
  if (mdMatch) {
    let linkPath = mdMatch[1].trim();
    try {
      linkPath = decodeURIComponent(linkPath);
    } catch { }
    const tf = plugin.app.metadataCache.getFirstLinkpathDest(linkPath, sourcePath);
    if (tf && isAttachmentExt(tf.extension)) return tf;
  }
  return null;
}

export function setupHeicInlinePreviewObserver(plugin) {
  const scanEmbeds = () => {
    const embeds = document.querySelectorAll('.internal-embed[src]');
    embeds.forEach((el) => {
      const rawSrc = el.getAttribute('src') || '';
      const cleanSrc = rawSrc.split('#')[0].split('|')[0].trim();
      const ext = getExt(cleanSrc);
      if (!NEEDS_TRANSCODE_IMAGE_EXTS.has(ext)) return;
      if (el.dataset.fmHeicStatus === 'done' || el.dataset.fmHeicStatus === 'loading') return;

      el.dataset.fmHeicStatus = 'loading';
      renderSingleHeicEmbed(plugin, el, cleanSrc, ext).catch(() => {
        el.dataset.fmHeicStatus = 'error';
      });
    });
  };

  plugin.app.workspace.onLayoutReady(() => {
    scanEmbeds();
    plugin.heicObserver = new MutationObserver(() => scanEmbeds());
    plugin.heicObserver.observe(document.body, { childList: true, subtree: true });
  });

  plugin.registerEvent(plugin.app.workspace.on('layout-change', () => scanEmbeds()));
  plugin.registerEvent(plugin.app.workspace.on('file-open', () => setTimeout(scanEmbeds, 80)));
}

export async function renderSingleHeicEmbed(plugin, embedEl, linkPath, ext) {
  const activeFile = plugin.app.workspace.getActiveFile();
  const sourcePath = activeFile ? activeFile.path : '';
  let tfile = plugin.app.metadataCache.getFirstLinkpathDest(linkPath, sourcePath);
  if (!tfile) {
    tfile = plugin.app.vault.getFiles().find((f) => f.path === linkPath || f.name === linkPath);
  }
  if (!tfile) {
    embedEl.dataset.fmHeicStatus = 'missing';
    return;
  }

  const cacheKey = `${tfile.path}:${tfile.stat?.mtime || 0}`;
  let previewUrl = plugin.heicPreviewCache.get(cacheKey);
  if (!previewUrl) {
    const buf = await plugin.app.vault.readBinary(tfile);
    previewUrl = await convertBufferToPreviewUrl(buf, ext, plugin);
    plugin.heicPreviewCache.set(cacheKey, previewUrl);
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
