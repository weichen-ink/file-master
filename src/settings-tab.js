import { openModalSafely, updateSidebarRibbonButton } from './plugin/vault-utils.js';
import { onLanguageChange, getCompatibilityMessage } from './plugin/lifecycle.js';
import { checkServerCompatibility } from './plugin/server-client.js';
import { MIN_SERVER_VERSION, displayVersion } from './constants.js';
import { FileMasterHubModal } from './modals/hub.js';
import { OperationLogModal } from './modals/operation-log.js';
import { Notice, PluginSettingTab, Setting, setIcon } from 'obsidian';

export class FileMasterSettingTab extends PluginSettingTab {
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
      attr: { 'aria-label': this.plugin.t('settingsBack') }
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
            openModalSafely(new FileMasterHubModal(this.app, this.plugin));
            return;
          }
          if (page === 'logs') {
            openModalSafely(new OperationLogModal(this.app, this.plugin));
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
            onLanguageChange(this.plugin);
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
          updateSidebarRibbonButton(this.plugin);
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
          .setPlaceholder('https://files.example.com')
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
      statusBox.textContent = getCompatibilityMessage(this.plugin, compat);
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
          .setPlaceholder('')
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
    const version = displayVersion(manifest.version || '0.1.1');
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
      text: sCompat ? getCompatibilityMessage(this.plugin, sCompat) : this.plugin.t('aboutServerOffline')
    });
    new Setting(containerEl)
      .setName(this.plugin.t('opLogTitle'))
      .setDesc(this.plugin.t('opLogDesc'))
      .addButton((btn) =>
        btn.setButtonText(this.plugin.t('opLogBtnOpen')).onClick(() => {
          openModalSafely(new OperationLogModal(this.app, this.plugin));
        })
      );
    addRow('aboutFeedback').createEl('a', { text: this.plugin.t('aboutFeedbackLink'), href: `${repoUrl}/issues`, attr: { target: '_blank', rel: 'noopener noreferrer' } });
  }
}
