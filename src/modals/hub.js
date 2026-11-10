import { BatchMigrateWizardModal } from './batch-migrate-wizard.js';
import { DuplicateWizardModal } from './duplicate-wizard.js';
import { HealthCheckModal } from './health-check.js';
import { OrphanWizardModal } from './orphan-wizard.js';
import { RemoteGalleryModal } from './remote-gallery.js';
import { VaultAnalyticsModal } from './vault-analytics.js';
import { Modal, setIcon } from 'obsidian';

/**
 * Quick Action Hub Modal opened from the left sidebar ribbon button (Bilingual zh-CN / en)
 */
export class FileMasterHubModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.addClass('fm-hub-dialog');
    contentEl.addClass('fm-wizard-modal');
    contentEl.addClass('fm-hub-content');

    const t = (key, params) => this.plugin.t(key, params);

    const header = contentEl.createDiv({ cls: 'fm-hub-header' });
    const heading = header.createDiv();
    heading.createEl('h3', { text: t('hubTitle'), cls: 'fm-step-title' });
    heading.createEl('p', { text: t('hubSubtitle') });

    const isRemote = Boolean(this.plugin?.isRemoteServerReady?.());
    const openFromHub = (modal) => {
      modal.fromHub = true;
      this.plugin.openModalSafely(modal);
    };

    const govActions = [
      {
        icon: 'link',
        title: t('actHealthTitle'),
        desc: t('actHealthDesc'),
        run: () => openFromHub(new HealthCheckModal(this.app, this.plugin))
      },
      {
        icon: 'files',
        title: t('actDupTitle'),
        desc: t('actDupDesc'),
        run: () => openFromHub(new DuplicateWizardModal(this.app, this.plugin))
      },
      {
        icon: 'search',
        title: t('actOrphanTitle'),
        desc: t('actOrphanDesc'),
        run: () => openFromHub(new OrphanWizardModal(this.app, this.plugin))
      }
    ];

    govActions.push({
      icon: 'bar-chart-3',
      title: t('actAnalyticsTitle'),
      desc: t('actAnalyticsDesc'),
      run: () => openFromHub(new VaultAnalyticsModal(this.app, this.plugin))
    });

    const sections = [];
    if (isRemote) {
      sections.push({
        category: t('catFiles'),
        actions: [
          {
            icon: 'image',
            title: t('actRemoteGalleryTitle'),
            desc: t('actRemoteGalleryDesc'),
            run: () => openFromHub(new RemoteGalleryModal(this.app, this.plugin))
          },
          {
            icon: 'panel-right',
            title: t('actRemoteGalleryViewTitle'),
            desc: t('actRemoteGalleryViewDesc'),
            run: () => {
              this.close();
              this.plugin.activateGalleryView();
            }
          },
          {
            icon: 'cloud-upload',
            title: t('actMigrateTitle'),
            desc: t('actMigrateDesc'),
            run: () => openFromHub(new BatchMigrateWizardModal(this.app, this.plugin))
          }
        ]
      });
    }

    sections.push({ category: t('catGovernance'), actions: govActions });

    if (isRemote) {
      sections.push({
        category: t('catActiveNote'),
        actions: [
          {
            icon: 'upload',
            title: t('actNoteUpTitle'),
            desc: t('actNoteUpDesc'),
            run: () => this.plugin.migrateActiveNoteAttachments(null, { fromHub: true })
          },
          {
            icon: 'download',
            title: t('actNoteDownTitle'),
            desc: t('actNoteDownDesc'),
            run: () => this.plugin.downloadActiveNoteRemoteAttachments(null, { fromHub: true })
          },
          {
            icon: 'copy',
            title: t('actNoteAstroTitle'),
            desc: t('actNoteAstroDesc'),
            run: () => this.plugin.copyActiveNoteForAstro()
          }
        ]
      });
    }

    sections.push({
      category: t('catSettings'),
      actions: [
        {
          icon: 'settings-2',
          title: t('actOpenSettingsTitle'),
          desc: t('actOpenSettingsDesc'),
          run: () => {
            if (this.app.setting) {
              this.app.setting.open();
              this.app.setting.openTabById(this.plugin.manifest.id);
            }
          }
        }
      ]
    });

    for (const sec of sections) {
      const section = contentEl.createDiv({ cls: 'fm-hub-section' });
      section.createEl('h4', { text: sec.category, cls: 'fm-section-title' });
      const grid = section.createDiv({ cls: 'fm-hub-list' });
      for (const act of sec.actions) {
        const card = grid.createEl('button', { cls: 'fm-hub-card', type: 'button' });
        const left = card.createDiv({ cls: 'fm-hub-card-left' });
        const icon = left.createSpan({ cls: 'fm-hub-card-icon' });
        setIcon(icon, act.icon);
        const textCol = left.createDiv({ cls: 'fm-hub-card-text' });
        textCol.createDiv({ text: act.title, cls: 'fm-hub-card-title' });
        textCol.createDiv({ text: act.desc, cls: 'fm-hub-card-desc' });

        card.onclick = () => {
          this.close();
          act.run();
        };
      }
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
