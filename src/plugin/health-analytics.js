import { isScannableDocFile, isLocalPathExcluded } from './vault-utils.js';
import { getEffectiveLanguage } from './logging.js';
import { computeVaultStatsFromEntries, formatBytes, formatDateYMD, formatDateTimestamp, scanNoteContentForBrokenLinks } from '../engine.js';
import { Notice, requestUrl } from 'obsidian';
import { fileReferenceDocuments } from './file-references.js';

// The plugin owns host state; these operations receive it explicitly.
export async function scanVaultLinkHealth(plugin, options = {}, scanCtx = {}) {
  const { signal, onProgress } = scanCtx || {};
  const allFiles = plugin.app.vault.getFiles();
  const docFiles = allFiles.filter(
    (f) => isScannableDocFile(plugin, f) && !isLocalPathExcluded(plugin.settings, f.path)
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
    const rawText = await plugin.app.vault.cachedRead(doc);
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
            let res = await requestUrl({ url, method: 'HEAD', throw: false });
            if (res.status === 405 || res.status === 403 || res.status === 501) {
              res = await requestUrl({
                url,
                method: 'GET',
                headers: { Range: 'bytes=0-0' },
                throw: false
              });
            }
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

  plugin.logOperation('INFO', 'HEALTH_SCAN', `Scanned ${docFiles.length} document(s), found ${issues.length} broken link issue(s)`, {
    docsScanned: docFiles.length,
    issuesFound: issues.length
  });
  return { issues, totalDocs: docFiles.length };
}

export async function exportHealthReportToRoot(plugin, issues, totalDocsScanned) {
  const now = new Date();
  const dateStr = formatDateTimestamp(now);
  const reportPath = `Broken_Links_Report_${dateStr}.md`;
  const zh = getEffectiveLanguage(plugin.settings) === 'zh';
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

  await plugin.writeOrUpdateRootReport(reportPath, lines.join('\n'));
  new Notice(plugin.t('noticeReportGenerated', { path: reportPath }));
}

export async function scanVaultAnalytics(plugin) {
  const allFiles = plugin.app.vault.getFiles();
  const docFiles = allFiles.filter((f) => isScannableDocFile(plugin, f));

  const docTexts = [];
  const documents = [];
  let referencesUnavailable = false;
  for (const doc of docFiles) {
    try {
      const text = await plugin.app.vault.cachedRead(doc);
      docTexts.push(text);
      documents.push({file:doc,path:doc.path,rawText:text});
    } catch { referencesUnavailable = true; }
  }

  let remoteImages = [];
  try {
    remoteImages = await plugin.fetchRemoteFileList();
  } catch { }

  const stats = computeVaultStatsFromEntries(allFiles, docTexts, remoteImages);
  for (const item of stats.topLargestAttachments) {
    item.referenceDocuments = referencesUnavailable ? null : await fileReferenceDocuments(plugin,item,null,documents);
  }
  return stats;
}

export async function exportAnalyticsReportToRoot(plugin, stats) {
  const now = new Date();
  const dateStr = formatDateTimestamp(now);
  const reportPath = `Vault_Analytics_Report_${dateStr}.md`;
  const zh = getEffectiveLanguage(plugin.settings) === 'zh';
  const locale = zh ? 'zh-CN' : 'en-US';

  const noteCount = stats.noteCount + stats.canvasCount;
  const remoteImgCount = stats.remote.imageCount || stats.remote.totalCount || 0;
  const totalImages = stats.local.imageCount + remoteImgCount;
  const totalOther = Math.max(0, (stats.local.totalCount + stats.remote.totalCount) - totalImages);
  const totalAssets = noteCount + stats.local.totalCount + stats.remote.totalCount;

  const totalBytes = Math.max(1, stats.local.totalBytes + stats.remote.rawBytes);
  const localPct = ((stats.local.totalBytes / totalBytes) * 100).toFixed(1);
  const remotePct = (100 - parseFloat(localPct)).toFixed(1);

  const labels = zh ? {
    title: '知识库报告：资产全景与存储审计',
    metaGen: '生成时间',
    metaTool: '分析工具',
    toolName: 'File Master 资产管理模块',
    secOverview: '一、全库核心资产概览',
    colMetric: '指标项',
    colValue: '统计数值',
    colDesc: '详细说明',
    mNotes: '📝 笔记与白板',
    mNotesDesc: `${stats.noteCount} 篇 Markdown 笔记 · ${stats.canvasCount} 个 Canvas 白板`,
    mImages: '🖼️ 图片总数',
    mImagesDesc: `本地 ${stats.local.imageCount} 张 · 云端 ${remoteImgCount} 张`,
    mOther: '📦 其他附件',
    mOtherDesc: '视频、音频及各类文档',
    mTotal: '📚 资产总数',
    mTotalDesc: '全库所有笔记与素材总和',
    mStorage: '💾 存储总占用',
    mStorageDesc: '包含本地知识库附件与服务器托管资产总和',
    secStorage: '二、存储容量与形态分布',
    colStorageType: '存储形态',
    colAssetCount: '文件数量',
    colStorageSize: '占用体积',
    colRatio: '占比',
    colBreakdown: '构成说明',
    localVault: '💻 本地',
    remoteServer: '☁️ 远程',
    localDetail: `图片 ${formatBytes(stats.local.imageBytes)} · 其他 ${formatBytes(Math.max(0, stats.local.totalBytes - stats.local.imageBytes))}`,
    remoteDetail: `原文件 ${formatBytes(stats.remote.rawBytes)} · WebP 缓存 ${formatBytes(stats.remote.cacheBytes)} · 防删保护 ${stats.remote.lockedCount} 项`,
    secLargest: '三、高占用附件深度审计清单（TOP 20）',
    colRank: '序号',
    colName: '文件名称',
    colLocation: '存储位置',
    colType: '类型',
    colSize: '文件大小',
    colPreview: '预览 / 引用',
    typeImage: '🖼️ 图片',
    typeVideo: '🎬 视频',
    typeAudio: '🎵 音频',
    typeDoc: '📄 文档',
    typeOther: '📦 其他',
    secAdvice: '四、资产健康与优化建议',
    advStorageRemote: `☁️ **云端托管为主**：当前 **${remotePct}%** 的附件托管在服务器，有效减轻本地知识库及移动端多设备同步负担。`,
    advStorageLocalHeavy: `📦 **本地存储优化**：检测到本地附件占用偏高（**${localPct}%**），存在超大单文件，建议将大体积素材迁移至服务器以释放本地与同步空间。`,
    advCacheReady: `⚡ **访问性能加速**：云端 WebP 衍生缓存已就绪，移动端与客户端浏览时具备轻量化加载加速能力。`,
    advLockedSafe: `🛡️ **云端资产安全**：已有 **${stats.remote.lockedCount} 项** 关键云端资产开启防删保护锁定，防止意外失效。`,
    openFile: '打开链接'
  } : {
    title: 'Vault report: Asset and storage audit',
    metaGen: 'Generated',
    metaTool: 'Analyzer',
    toolName: 'File Master Asset Management Module',
    secOverview: '1. Core Asset Metrics',
    colMetric: 'Metric',
    colValue: 'Value',
    colDesc: 'Breakdown',
    mNotes: '📝 Notes & Canvases',
    mNotesDesc: `${stats.noteCount} Markdown notes · ${stats.canvasCount} Canvases`,
    mImages: '🖼️ Total Images',
    mImagesDesc: `Local ${stats.local.imageCount} · Remote ${remoteImgCount}`,
    mOther: '📦 Other Attachments',
    mOtherDesc: 'Video, audio, documents, etc.',
    mTotal: '📚 Total Assets',
    mTotalDesc: 'All notes and media assets combined',
    mStorage: '💾 Total Footprint',
    mStorageDesc: 'Combined footprint of local vault attachments and server assets',
    secStorage: '2. Storage Distribution',
    colStorageType: 'Storage Mode',
    colAssetCount: 'Files',
    colStorageSize: 'Size',
    colRatio: 'Share',
    colBreakdown: 'Composition',
    localVault: '💻 Local',
    remoteServer: '☁️ Remote',
    localDetail: `Images ${formatBytes(stats.local.imageBytes)} · Other ${formatBytes(Math.max(0, stats.local.totalBytes - stats.local.imageBytes))}`,
    remoteDetail: `Raw ${formatBytes(stats.remote.rawBytes)} · WebP Cache ${formatBytes(stats.remote.cacheBytes)} · Protected ${stats.remote.lockedCount}`,
    secLargest: '3. High-Footprint Attachments Audit (TOP 20)',
    colRank: '#',
    colName: 'File Name',
    colLocation: 'Location',
    colType: 'Type',
    colSize: 'Size',
    colPreview: 'Preview / Reference',
    typeImage: '🖼️ Image',
    typeVideo: '🎬 Video',
    typeAudio: '🎵 Audio',
    typeDoc: '📄 Document',
    typeOther: '📦 Other',
    secAdvice: '4. Health & Optimization Insights',
    advStorageRemote: `☁️ **Cloud-Primary Storage**: **${remotePct}%** of attachments are hosted on the server, significantly reducing local footprint and mobile sync traffic.`,
    advStorageLocalHeavy: `📦 **Local Storage Guidance**: Local attachment footprint is notable (**${localPct}%**); consider hosting heavy media on the server to lighten mobile sync load.`,
    advCacheReady: `⚡ **Loading Acceleration**: Server WebP cache is ready, optimizing multi-device loading bandwidth.`,
    advLockedSafe: `🛡️ **Asset Protection**: **${stats.remote.lockedCount}** cloud assets are locked with delete protection.`,
    openFile: 'Open Link'
  };

  const lines = [
    `# 📊 ${labels.title} (${dateStr})`,
    ``,
    `> ⏱️ ${labels.metaGen}: ${now.toLocaleString(locale)}  |  🛠️ ${labels.metaTool}: ${labels.toolName}`,
    ``,
    `---`,
    ``,
    `## 📈 ${labels.secOverview}`,
    ``,
    `| ${labels.colMetric} | ${labels.colValue} | ${labels.colDesc} |`,
    `| :--- | :---: | :--- |`,
    `| ${labels.mNotes} | **${noteCount.toLocaleString(locale)}** | ${labels.mNotesDesc} |`,
    `| ${labels.mImages} | **${totalImages.toLocaleString(locale)}** | ${labels.mImagesDesc} |`,
    `| ${labels.mOther} | **${totalOther.toLocaleString(locale)}** | ${labels.mOtherDesc} |`,
    `| ${labels.mTotal} | **${totalAssets.toLocaleString(locale)}** | ${labels.mTotalDesc} |`,
    `| ${labels.mStorage} | **${formatBytes(stats.local.totalBytes + stats.remote.rawBytes)}** | ${labels.mStorageDesc} |`,
    ``,
    `---`,
    ``,
    `## 💾 ${labels.secStorage}`,
    ``,
    `| ${labels.colStorageType} | ${labels.colAssetCount} | ${labels.colStorageSize} | ${labels.colRatio} | ${labels.colBreakdown} |`,
    `| :---: | :---: | :---: | :---: | :--- |`,
    `| ${labels.localVault} | ${stats.local.totalCount} | **${formatBytes(stats.local.totalBytes)}** | ${localPct}% | ${labels.localDetail} |`,
    `| ${labels.remoteServer} | ${stats.remote.totalCount} | **${formatBytes(stats.remote.rawBytes)}** | ${remotePct}% | ${labels.remoteDetail} |`,
    ``,
    `---`,
    ``
  ];

  if (stats.topLargestAttachments && stats.topLargestAttachments.length > 0) {
    lines.push(`## 📑 ${labels.secLargest}`);
    lines.push(``);
    lines.push(`| ${labels.colRank} | ${labels.colName} | ${labels.colLocation} | ${labels.colType} | ${labels.colSize} | ${labels.colPreview} |`);
    lines.push(`| :---: | :--- | :---: | :---: | :---: | :---: |`);
    const topItems = stats.topLargestAttachments.slice(0, 20);
    topItems.forEach((item, index) => {
      const srcLabel = item.source === 'local' ? labels.localVault : labels.remoteServer;
      let typeLabel = labels.typeOther;
      if (item.group === 'image') typeLabel = labels.typeImage;
      else if (item.group === 'video') typeLabel = labels.typeVideo;
      else if (item.group === 'audio') typeLabel = labels.typeAudio;
      else if (item.group === 'doc') typeLabel = labels.typeDoc;

      const rank = String(index + 1).padStart(2, '0');

      // Generate clickable preview/embed
      let previewCol = '';
      if (item.source === 'local') {
        if (item.group === 'image') {
          previewCol = `![[${item.path}\\|80]]`;
        } else {
          previewCol = `[[${item.path}]]`;
        }
      } else {
        const cleanServer = plugin.settings?.serverUrl ? plugin.settings.serverUrl.replace(/\/$/, '') : '';
        const webpPath = String(item.path || '').replace(/\.[^.]+$/, '.webp');
        const remoteUrl = item.pubUrl || (cleanServer ? `${cleanServer}/pub/${webpPath}` : '') || item.rawUrl || (cleanServer ? `${cleanServer}/raw/${item.path}` : '');
        if (item.group === 'image' && remoteUrl) {
          previewCol = `<img src="${remoteUrl}" width="80" style="max-height:80px; object-fit:contain; border-radius:4px;" />`;
        } else if (remoteUrl) {
          previewCol = `[${labels.openFile}](${remoteUrl})`;
        } else {
          previewCol = `\`${item.path}\``;
        }
      }

      lines.push(`| ${rank} | \`${item.name}\` | ${srcLabel} | ${typeLabel} | **${formatBytes(item.size)}** | ${previewCol} |`);
    });
    lines.push(``);
    lines.push(`---`);
    lines.push(``);
  }

  lines.push(`## 💡 ${labels.secAdvice}`);
  lines.push(``);
  if (parseFloat(localPct) >= 50) {
    lines.push(`- ${labels.advStorageLocalHeavy}`);
    lines.push(``);
  } else {
    lines.push(`- ${labels.advStorageRemote}`);
    lines.push(``);
  }
  if (stats.remote.cacheBytes > 0) {
    lines.push(`- ${labels.advCacheReady}`);
    lines.push(``);
  }
  if (stats.remote.lockedCount > 0) {
    lines.push(`- ${labels.advLockedSafe}`);
    lines.push(``);
  }

  await plugin.writeOrUpdateRootReport(reportPath, lines.join('\n'));
  new Notice(plugin.t('noticeReportGenerated', { path: reportPath }));
}
