import { moduleHeading } from "../ui/navigation.js";
import { scanVaultLinkHealth, exportHealthReportToRoot } from '../plugin/health-analytics.js';
import { documentRow } from '../ui/document-list.js';
import { createScanProgressWidget, renderScanEmpty, returnToHub } from './common.js';
import { Notice } from 'obsidian';
import { FileMasterModal as Modal } from '../ui/modal.js';

/**
 * Vault Link Health Check Modal (404 & Dangling WikiLink Finder)
 */
export class HealthCheckModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.step = 1;
    this.activeProgress = null;
    this.options = {
      checkWikiLinks: true,
      checkLocalMarkdown: true,
      checkRemote: false
    };
    this.totalDocsScanned = 0;
    this.issues = [];
    this.activeFilter = 'all';
    this.searchQuery = '';
  }

  onOpen() {
    this.render();
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('fm-wizard-modal');

    if (this.step === 1) {
      this.renderStep1(contentEl);
    } else {
      this.renderStep2(contentEl);
    }
  }

  renderStep1(contentEl) {
    const t = (k, p) => this.plugin.t(k, p);
    moduleHeading(this,contentEl,{title:'actHealthTitle',symbol:'link',step:1,total:2});
    contentEl.createEl('p',{text:t('healthStep1Desc'),cls:'fm-module-summary'});

    const box = contentEl.createDiv({ cls: 'fm-section-box' });
    box.createDiv({ text: t('healthScopeTitle'), cls: 'fm-section-title' });

    this.createCheckbox(box, t('healthCheckWiki'), 'checkWikiLinks');
    this.createCheckbox(box, t('healthCheckLocal'), 'checkLocalMarkdown');
    this.createCheckbox(box, t('healthCheckRemote'), 'checkRemote');

    const progressWidget = createScanProgressWidget(contentEl, this.plugin);
    this.activeProgress = progressWidget;

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const cancelBtn = btnRow.createEl('button', { text: t('btnCancel') });
    cancelBtn.onclick = () => returnToHub(this);

    const startBtn = btnRow.createEl('button', { text: t('healthStartScan'), cls: 'mod-cta' });
    startBtn.onclick = async () => {
      if (!this.options.checkWikiLinks && !this.options.checkLocalMarkdown && !this.options.checkRemote) {
        return;
      }
      startBtn.disabled = true;
      startBtn.setText(t('healthScanning'));
      progressWidget.show();
      try {
        const scanResult = await scanVaultLinkHealth(this.plugin, this.options, {
          signal: progressWidget.signal,
          onProgress: (cur, total, label) => progressWidget.update(cur, total, label)
        });
        this.issues = scanResult.issues;
        this.totalDocsScanned = scanResult.totalDocs;
        this.step = 2;
        this.render();
      } catch (err) {
        progressWidget.hide();
        new Notice(err.message === 'SCAN_ABORTED' ? this.plugin.t('scanCancelled') : '❌ Link health scan failed: ' + err.message);
        startBtn.disabled = false;
        startBtn.setText(t('healthStartScan'));
      }
    };
  }

  createCheckbox(parent, labelText, optKey) {
    const label = parent.createEl('label', { cls: 'fm-check-row' });
    const cb = label.createEl('input', { type: 'checkbox' });
    cb.checked = Boolean(this.options[optKey]);
    cb.onchange = () => {
      this.options[optKey] = cb.checked;
    };
    label.createSpan({ text: labelText });
  }

  renderStep2(contentEl) {
    const t=(key,params)=>this.plugin.t(key,params);
    contentEl.empty();
    moduleHeading(this,contentEl,{title:'actHealthTitle',symbol:'link',step:this.issues.length?2:null,total:2});
    if (!this.issues.length) {
      renderScanEmpty(this,contentEl,'healthNoneFound',{retryLabel:'healthRescan'});
      return;
    }
    contentEl.createEl('p',{text:t('healthStep2Title',{docs:this.totalDocsScanned,issues:this.issues.length}),cls:'fm-module-summary'});
    const toolbar=contentEl.createDiv({cls:'fm-toolbar-row fm-health-toolbar'});
    const search=toolbar.createEl('input',{type:'search',value:this.searchQuery,cls:'fm-gallery-search',attr:{placeholder:t('healthSearchPlaceholder'),'aria-label':t('healthSearchPlaceholder')}});
    const filter=toolbar.createEl('select',{cls:'fm-control-select',attr:{'aria-label':t('healthFilterLabel')}});
    for(const [value,key] of [['all','healthFilterAll'],['wikilink','healthStatWiki'],['local','healthStatLocal'],['remote','healthStatRemote']]) {
      const count=value==='all'?this.issues.length:this.issues.filter(item=>item.category===value).length;
      filter.createEl('option',{value,text:`${t(key)} (${count})`});
    }
    filter.value=this.activeFilter;
    const tools=toolbar.createDiv({cls:'fm-toolbar-actions'});
    tools.createEl('button',{text:t('healthRescan')}).onclick=()=>{this.step=1;this.render();};
    tools.createEl('button',{text:t('btnExportReport')}).onclick=()=>exportHealthReportToRoot(this.plugin,this.issues,this.totalDocsScanned);
    const list=contentEl.createDiv({cls:'fm-scroll-list fm-document-list'});
    search.oninput=()=>{this.searchQuery=search.value.toLowerCase();this.renderIssueList(list);};
    filter.onchange=()=>{this.activeFilter=filter.value;this.renderIssueList(list);};
    this.renderIssueList(list);
    const footer=contentEl.createDiv({cls:'fm-btn-row'});
    footer.createEl('button',{text:t(this.fromHub?'btnCancel':'closeBtn')}).onclick=()=>returnToHub(this);
  }

  renderIssueList(listEl) {
    const t = (k, p) => this.plugin.t(k, p);
    listEl.empty();

    let filtered = this.issues;
    if (this.activeFilter !== 'all') {
      filtered = filtered.filter((i) => i.category === this.activeFilter);
    }
    if (this.searchQuery) {
      filtered = filtered.filter(
        (i) =>
          i.sourcePath.toLowerCase().includes(this.searchQuery) ||
          i.target.toLowerCase().includes(this.searchQuery) ||
          (i.lineText && i.lineText.toLowerCase().includes(this.searchQuery))
      );
    }

    if (filtered.length === 0) {
      listEl.createDiv({
        cls: 'fm-section-box',
        text: t('healthNoMatches'),
        attr: { style: 'text-align: center; padding: 24px;' }
      });
      return;
    }

    for (const item of filtered) {
      const tag=item.category==='wikilink'?(item.type==='wikilink-embed'?'healthTagWikiEmbed':'healthTagDanglingNote'):item.category==='local'?(item.type==='local-embed'?'healthTagMissingImage':'healthTagMissingFile'):'healthTagRemote404';
      documentRow(listEl,this.plugin,{path:item.sourcePath,line:item.line},{
        hoverParent:this,
        location:item.line?t('healthLine',{line:item.line}):null,
        openLabel:t('healthOpenSource'),
        onOpened:()=>this.close(),
        renderDetails:parent=>{
          const issue=parent.createDiv({cls:'fm-health-issue'});
          issue.createSpan({text:t(tag),cls:'fm-health-issue-label'});
          issue.createEl('code',{text:item.target,cls:'fm-health-target'});
          const status=item.reason?.match(/HTTP (\d{3})/);
          if(status)issue.createSpan({text:`HTTP ${status[1]}`,cls:'fm-document-location'});
        }
      });
    }
  }

  onClose() {
    if (this.activeProgress) this.activeProgress.abort();
    this.contentEl.empty();
  }
}
