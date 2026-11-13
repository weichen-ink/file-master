import { openModalSafely, updateSidebarRibbonButton } from './plugin/vault-utils.js';
import { onLanguageChange, getCompatibilityMessage } from './plugin/lifecycle.js';
import { checkServerCompatibility } from './plugin/server-client.js';
import { MIN_SERVER_VERSION, displayVersion } from './constants.js';
import { FileMasterHubModal } from './modals/hub.js';
import { OperationLogModal } from './modals/operation-log.js';
import { galleryStore } from './ui/gallery-store.js';
import { Notice, PluginSettingTab, Setting, setIcon } from 'obsidian';

export class FileMasterSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  createNativeHeading(containerEl, label, emoji = '', badge = null) {
    const heading = new Setting(containerEl).setName(label);
    if (typeof heading.setHeading === 'function') heading.setHeading();
    heading.settingEl.addClass('setting-item-heading', 'fm-settings-heading-row');
    heading.descEl?.remove();
    if (emoji) {
      const iconEl = heading.nameEl.createSpan({ cls: 'fm-settings-heading-icon', text: emoji, attr: { 'aria-hidden': 'true' } });
      heading.nameEl.prepend(iconEl);
    }
    if (badge) {
      heading.nameEl.createSpan({
        cls: `fm-settings-status-pill ${badge.cls}`.trim(),
        text: badge.text
      });
    }
    return heading;
  }

  addSettingEmoji(setting, emoji) {
    if (!emoji || !setting?.nameEl) return setting;
    setting.settingEl?.addClass('fm-settings-has-icon');
    const iconEl = setting.nameEl.createSpan({ cls: 'fm-settings-item-icon', text: emoji, attr: { 'aria-hidden': 'true' } });
    setting.nameEl.prepend(iconEl);
    return setting;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('fm-settings');

    const addSection = (titleKey, emoji, renderFn) => {
      const section = containerEl.createDiv({ cls: 'fm-settings-nav-section' });
      this.createNativeHeading(section, this.plugin.t(titleKey), emoji);
      const card = section.createDiv({ cls: 'fm-settings-section' });
      renderFn(card);
      return section;
    };

    addSection('tabServer', '🛰️', (card) => this.renderServerSettings(card));
    addSection('uploadGroupCapture', '📥', (card) => this.renderCaptureSettings(card));
    addSection('uploadGroupLinks', '🔗', (card) => this.renderLinkSettings(card));
    addSection('uploadGroupNaming', '✏️', (card) => this.renderNamingSettings(card));
    addSection('tabGeneral', '🎨', (card) => this.renderGeneralSettings(card));
    addSection('tabExemptions', '🛡️', (card) => this.renderExemptionsSettings(card));
    addSection('settingsToolsGroup', '🪄', (card) => this.renderToolsSettings(card));
    this.renderCompactAbout(containerEl);
  }

  renderToolsSettings(containerEl) {
    const tools = [
      ['hub', 'openHubName', 'openHubDesc', '🧰'],
      ['logs', 'opLogTitle', 'opLogDesc', '📝']
    ];
    for (const [page, label, descKey, emoji] of tools) {
      const setting = this.addSettingEmoji(new Setting(containerEl).setName(this.plugin.t(label)), emoji);
      if (typeof setting.setDesc === 'function') setting.setDesc(this.plugin.t(descKey));
      const row = setting.settingEl;
      row.addClass('fm-settings-nav-item', 'fm-settings-action-item');
      row.setAttribute('role', 'button');
      row.setAttribute('tabindex', '0');
      const open = () => {
        if (page === 'hub') {
          openModalSafely(new FileMasterHubModal(this.app, this.plugin));
          return;
        }
        openModalSafely(new OperationLogModal(this.app, this.plugin));
      };
      row.onclick = open;
      row.onkeydown = (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open();
        }
      };
    }
  }

  renderCompactAbout(containerEl) {
    const manifest = this.plugin.manifest || {};
    const version = displayVersion(manifest.version || '0.1.1');
    const author = manifest.author || 'weichen-ink';
    const authorUrl = manifest.authorUrl || 'https://github.com/weichen-ink';
    const repoUrl = 'https://github.com/weichen-ink/file-master';

    const section = containerEl.createDiv({ cls: 'fm-settings-nav-section' });
    this.createNativeHeading(section, this.plugin.t('settingsInfoGroup'), '🏷️');
    const footer = section.createDiv({ cls: 'fm-settings-about-footer' });

    const header = footer.createDiv({ cls: 'fm-settings-about-header' });
    const titleRow = header.createDiv({ cls: 'fm-settings-about-title-row' });
    const title = titleRow.createDiv({ cls: 'fm-settings-about-title' });
    title.createSpan({ text: 'File Master' });
    title.createSpan({ cls: 'fm-settings-about-sparkle', text: '✨', attr: { 'aria-hidden': 'true' } });

    header.createDiv({ cls: 'fm-settings-about-desc', text: this.plugin.t('aboutDesc') });

    const meta = footer.createDiv({ cls: 'fm-settings-about-grid' });
    const addRow = (label, buildValue) => {
      const item = meta.createDiv({ cls: 'fm-settings-about-item' });
      item.createSpan({ cls: 'fm-settings-about-label', text: label });
      const value = item.createSpan({ cls: 'fm-settings-about-value' });
      buildValue(value);
    };

    const serverVer = this.plugin.lastServerCompatStatus?.serverVersion;
    const serverVerText = !this.plugin.settings.enableRemoteServer
      ? this.plugin.t('serverStatusOff')
      : serverVer
        ? `v${displayVersion(serverVer)}`
        : this.plugin.t('aboutServerOffline');

    addRow(this.plugin.t('aboutPluginVersion'), (el) => {
      el.createSpan({ text: `v${version}` });
    });
    addRow(this.plugin.t('aboutServerVersion'), (el) => {
      el.createSpan({ text: serverVerText });
    });
    addRow(this.plugin.t('aboutAuthor'), (el) => {
      el.createEl('a', { text: author, href: authorUrl, attr: { target: '_blank', rel: 'noopener noreferrer' } });
    });
    addRow(this.plugin.t('aboutRepo'), (el) => {
      el.createEl('a', { text: 'GitHub', href: repoUrl, attr: { target: '_blank', rel: 'noopener noreferrer' } });
    });
    addRow(this.plugin.t('aboutLicense'), (el) => {
      el.createSpan({ text: 'MIT' });
    });
    addRow(this.plugin.t('aboutFeedback'), (el) => {
      el.createEl('a', { text: this.plugin.t('aboutChangelog'), href: `${repoUrl}/blob/main/CHANGELOG.md`, attr: { target: '_blank', rel: 'noopener noreferrer' } });
      el.createSpan({ cls: 'fm-settings-about-sep', text: '/' });
      el.createEl('a', { text: 'Issues', href: `${repoUrl}/issues`, attr: { target: '_blank', rel: 'noopener noreferrer' } });
    });
  }

  renderGeneralSettings(containerEl) {
    this.addSettingEmoji(
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
              onLanguageChange(this.plugin);
              this.display();
            })
        ),
      '🌍'
    );

    this.addSettingEmoji(
      new Setting(containerEl)
        .setName(this.plugin.t('sidebarBtnName'))
        .setDesc(this.plugin.t('sidebarBtnDesc'))
        .addToggle((toggle) =>
          toggle.setValue(this.plugin.settings.enableSidebarButton !== false).onChange(async (value) => {
            this.plugin.settings.enableSidebarButton = value;
            await this.plugin.saveSettings();
            updateSidebarRibbonButton(this.plugin);
          })
        ),
      '📌'
    );
  }

  renderServerSettings(containerEl) {
    this.addSettingEmoji(
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
        ),
      '🔌'
    );

    if (!this.plugin.settings.enableRemoteServer) {
      const hint = containerEl.createDiv({ cls: 'fm-settings-hint' });
      hint.setText(this.plugin.t('serverDisabledHint'));
      return;
    }

    this.addSettingEmoji(
      new Setting(containerEl)
        .setName(this.plugin.t('serverUrlName'))
        .setDesc(this.plugin.t('serverUrlDesc'))
        .addText((text) =>
          text
            .setPlaceholder('https://files.example.com')
            .setValue(this.plugin.settings.serverUrl)
            .onChange(async (value) => {
              this.plugin.settings.serverUrl = value.trim();
              this.plugin.settings.serverVerified = false;
              this.plugin.lastServerCompatStatus = null;
              updateStatusBox(null);
              await this.plugin.saveSettings();
            })
        ),
      '🌐'
    );

    let statusBox;
    const updateStatusBox = (compat) => {
      if (!statusBox) return;
      statusBox.dataset.status = !compat
        ? (this.plugin.settings.serverVerified ? 'success' : 'pending')
        : (compat.ok ? 'success' : compat.status === 'server_outdated' ? 'pending' : 'error');
      statusBox.textContent = getCompatibilityMessage(this.plugin, compat);
    };

    let tokenInput;
    this.addSettingEmoji(
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
          })),
      '🔑'
    );

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
            compat = await checkServerCompatibility(this.plugin);
            updateStatusBox(compat);
            new Notice(getCompatibilityMessage(this.plugin, compat));
          } finally {
            btn.disabled = false;
            btn.setButtonText(this.plugin.t('btnTestConn'));
          }
          if (compat) this.display();
        })
      );
  }

  renderCaptureSettings(captureCard) {
    this.addSettingEmoji(
      new Setting(captureCard)
        .setName(this.plugin.t('clipboardMonitorName'))
        .setDesc(this.plugin.t('clipboardMonitorDesc'))
        .addToggle((toggle) =>
          toggle.setValue(this.plugin.settings.enableClipboardMonitor !== false).onChange(async (value) => {
            this.plugin.settings.enableClipboardMonitor = value;
            await this.plugin.saveSettings();
          })
        ),
      '📋'
    );

    this.addSettingEmoji(
      new Setting(captureCard)
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
        ),
      '📍'
    );

    this.addSettingEmoji(
      new Setting(captureCard)
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
        ),
      '💾'
    );
  }

  renderLinkSettings(linksCard) {
    this.addSettingEmoji(
      new Setting(linksCard)
        .setName(this.plugin.t('insertOptimizedName'))
        .setDesc(this.plugin.t('insertOptimizedDesc'))
        .addToggle((toggle) =>
          toggle.setValue(this.plugin.settings.insertOptimizedLinkOnUpload).onChange(async (value) => {
            this.plugin.settings.insertOptimizedLinkOnUpload = value;
            await this.plugin.saveSettings();
          })
        ),
      '⚡'
    );

    this.addSettingEmoji(
      new Setting(linksCard)
        .setName(this.plugin.t('galleryDefaultLinkName'))
        .setDesc(this.plugin.t('galleryDefaultLinkDesc'))
        .addDropdown((drop) => {
          const store = galleryStore(this.plugin);
          drop.addOption('raw', this.plugin.t('galleryModeRaw'))
            .addOption('webp', this.plugin.t('galleryModeWebp'))
            .setValue(store.state.insertMode)
            .onChange(async (value) => {
              try { await store.setInsertMode(value); }
              catch (error) { drop.setValue(store.state.insertMode); new Notice(error.message); }
            });
        }),
      '🖼️'
    );

    this.addSettingEmoji(
      new Setting(linksCard)
        .setName(this.plugin.t('uploadNonImageName'))
        .setDesc(this.plugin.t('uploadNonImageDesc'))
        .addToggle((toggle) =>
          toggle.setValue(this.plugin.settings.uploadNonImageAttachments !== false).onChange(async (value) => {
            this.plugin.settings.uploadNonImageAttachments = value;
            await this.plugin.saveSettings();
          })
        ),
      '📎'
    );
  }

  renderNamingSettings(namingCard) {
    let patternSetting = null;
    this.addSettingEmoji(
      new Setting(namingCard)
        .setName(this.plugin.t('namingStrategyName'))
        .setDesc(this.plugin.t('namingStrategyDesc'))
        .addDropdown((drop) =>
          drop
            .addOption('keep', this.plugin.t('optNamingKeep'))
            .addOption('rule', this.plugin.t('optNamingRule'))
            .setValue(this.plugin.settings.namingMode || 'keep')
            .onChange(async (value) => {
              this.plugin.settings.namingMode = value;
              await this.plugin.saveSettings();
              if (patternSetting && patternSetting.settingEl) {
                patternSetting.settingEl.style.display = value === 'rule' ? '' : 'none';
              }
            })
        ),
      '🏷️'
    );

    patternSetting = this.addSettingEmoji(
      new Setting(namingCard)
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
        ),
      '🧩'
    );
    if (patternSetting.settingEl) {
      patternSetting.settingEl.style.display = this.plugin.settings.namingMode === 'rule' ? '' : 'none';
    }
  }

  renderExemptionsSettings(containerEl) {
    this.addSettingEmoji(
      new Setting(containerEl)
        .setName(this.plugin.t('excludedFoldersName'))
        .setDesc(this.plugin.t('excludedFoldersDesc'))
        .addText((text) =>
          text
            .setPlaceholder('')
            .setValue(this.plugin.settings.excludedLocalFolders)
            .onChange(async (value) => {
              this.plugin.settings.excludedLocalFolders = value;
              await this.plugin.saveSettings();
            })
        ),
      '📁'
    );

    this.addSettingEmoji(
      new Setting(containerEl)
        .setName(this.plugin.t('excludeLockedRemoteName'))
        .setDesc(this.plugin.t('excludeLockedRemoteDesc'))
        .addToggle((toggle) =>
          toggle.setValue(this.plugin.settings.excludeLockedRemoteFiles).onChange(async (value) => {
            this.plugin.settings.excludeLockedRemoteFiles = value;
            await this.plugin.saveSettings();
          })
        ),
      '🔒'
    );
  }
}
