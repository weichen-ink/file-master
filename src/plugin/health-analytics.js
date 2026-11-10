import { computeVaultStatsFromEntries, formatBytes, formatDateYMD, scanNoteContentForBrokenLinks } from '../engine.js';
import { Notice, requestUrl } from 'obsidian';

// The plugin owns host state; these operations receive it explicitly.
export async function scanVaultLinkHealth(plugin, options = {}, scanCtx = {}) {
  const { signal, onProgress } = scanCtx || {};
  const allFiles = plugin.app.vault.getFiles();
  const docFiles = allFiles.filter(
    (f) => plugin.isScannableDocFile(f) && !plugin.isLocalPathExcluded(f.path)
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

  plugin.logOperation('INFO', 'HEALTH_SCAN', `Scanned ${docFiles.length} document(s), found ${issues.length} broken link issue(s)`, {
    docsScanned: docFiles.length,
    issuesFound: issues.length
  });
  return { issues, totalDocs: docFiles.length };
}

export async function exportHealthReportToRoot(plugin, issues, totalDocsScanned) {
  const now = new Date();
  const dateStr = formatDateYMD(now);
  const reportPath = `Broken_Links_Report_${dateStr}.md`;
  const zh = plugin.getEffectiveLanguage() === 'zh';
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
  const docFiles = allFiles.filter((f) => plugin.isScannableDocFile(f));

  const docTexts = [];
  for (const doc of docFiles) {
    try {
      const text = await plugin.app.vault.cachedRead(doc);
      docTexts.push(text);
    } catch { }
  }

  let remoteImages = [];
  try {
    remoteImages = await plugin.fetchRemoteFileList();
  } catch { }

  return computeVaultStatsFromEntries(allFiles, docTexts, remoteImages);
}

export async function exportAnalyticsReportToRoot(plugin, stats) {
  const now = new Date();
  const dateStr = formatDateYMD(now);
  const reportPath = `Vault_Analytics_Report_${dateStr}.md`;
  const zh = plugin.getEffectiveLanguage() === 'zh';
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

  await plugin.writeOrUpdateRootReport(reportPath, lines.join('\n'));
  new Notice(plugin.t('noticeReportGenerated', { path: reportPath }));
}
