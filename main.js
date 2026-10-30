const {
  Plugin,
  PluginSettingTab,
  Setting,
  Notice,
  Modal,
  requestUrl,
  MarkdownView,
  ItemView,
  setIcon,
  TFile,
  getLanguage
} = require('obsidian');
const crypto = require('crypto');
const path = require('path');

const DEFAULT_SETTINGS = {
  language: 'auto', // 'auto' | 'zh' | 'en'
  enableRemoteServer: false,
  serverVerified: false,
  serverUrl: 'http://localhost:3000',
  apiToken: 'filemaster-api-token-888',
  enableSidebarButton: true,
  enableClipboardMonitor: true,
  saveLocationMode: 'ask', // 'remote' | 'local' | 'ask'
  namingMode: 'keep',      // 'keep' (keep original) | 'rule' (auto-rename pattern) | 'prompt' (manual rename modal)
  namingPattern: '{note}_{date}_{rand:4}',
  uploadNonImageAttachments: true,
  insertOptimizedLinkOnUpload: false,
  deleteLocalAfterMigrate: true,
  excludedLocalFolders: 'templates, assets/protected',
  excludeLockedRemoteFiles: true
};

const MIN_SERVER_VERSION = '1.0.0';
const VIEW_TYPE_REMOTE_GALLERY = 'file-master-remote-gallery';

// Comprehensive image extensions (Apple HEIC/HEIF, TIFF, BMP, Camera RAW, etc.)
const IMAGE_EXTS = new Set([
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'avif',
  'svg',
  'heic',
  'heif',
  'bmp',
  'tif',
  'tiff',
  'ico',
  'jfif',
  'pjpeg',
  'pjp',
  'apng',
  'raw',
  'cr2',
  'nef',
  'arw',
  'dng',
  'orf',
  'rw2'
]);

// Formats requiring JPEG preview transcoding for Electron/Chromium <img> rendering
const NEEDS_TRANSCODE_IMAGE_EXTS = new Set(['heic', 'heif', 'tif', 'tiff']);

// Comprehensive audio extension support
const AUDIO_EXTS = new Set([
  'mp3',
  'm4a',
  'wav',
  'ogg',
  'oga',
  'flac',
  'aac',
  'wma',
  'opus',
  'amr',
  'mid',
  'midi',
  'aiff',
  'aif',
  'ape',
  'alac',
  'm4b',
  'caf'
]);

// Comprehensive video, document, archive, and design asset extensions
const OTHER_EXTS = new Set([
  'pdf',
  'mp4',
  'webm',
  'mov',
  'mkv',
  'avi',
  'flv',
  'wmv',
  'm4v',
  '3gp',
  'mpeg',
  'mpg',
  'ts',
  'mts',
  'm2ts',
  'ogv',
  'rm',
  'rmvb',
  'zip',
  'tar',
  'gz',
  'tgz',
  '7z',
  'rar',
  'bz2',
  'xz',
  'zst',
  'lz4',
  'dmg',
  'iso',
  'pkg',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'csv',
  'tsv',
  'rtf',
  'txt',
  'odt',
  'ods',
  'odp',
  'pages',
  'numbers',
  'key',
  'epub',
  'mobi',
  'azw',
  'azw3',
  'djvu',
  'chm',
  'psd',
  'psb',
  'ai',
  'eps',
  'ind',
  'indd',
  'fig',
  'sketch',
  'xd',
  'cdr',
  'dwg',
  'dxf',
  'stl',
  'obj',
  'fbx',
  'blend',
  'glb',
  'gltf',
  'xmind',
  'mm',
  'drawio',
  'vsdx',
  'json',
  'yaml',
  'yml',
  'xml',
  'toml',
  'ini',
  'conf',
  'log',
  'sql',
  'db',
  'sqlite',
  'sqlite3',
  'ipynb',
  'ics',
  'vcf',
  'srt',
  'ass',
  'vtt',
  'ttf',
  'otf',
  'woff',
  'woff2',
  'apk',
  'ipa',
  'exe',
  'msi',
  'deb',
  'rpm'
]);

const OBSIDIAN_NOTE_EXTS = new Set(['md', 'canvas', 'base']);
const ALL_ATTACHMENT_EXTS = new Set([...IMAGE_EXTS, ...AUDIO_EXTS, ...OTHER_EXTS]);

function isAttachmentExt(ext) {
  const e = String(ext || '').toLowerCase();
  return Boolean(e) && !OBSIDIAN_NOTE_EXTS.has(e);
}

/**
 * Bilingual UI Strings (zh-CN / en) for FileMaster Obsidian Plugin
 * Pure user-centric terminology without technical variable pollution or bracketed language mixing.
 */
const UI_STRINGS = {
  zh: {
    // 快捷控制中心
    hubBadge: '文件工具',
    hubTitle: 'FileMaster',
    hubSubtitle: '管理知识库文件、链接和服务器文件',
    catFiles: '服务器文件',
    catGovernance: '知识库整理',
    catActiveNote: '当前笔记',
    catSettings: '设置',

    // 向导项
    actHealthTitle: '失效链接',
    actHealthDesc: '检查笔记和白板中缺失的文件，以及无法访问的网页链接。',
    actDupTitle: '重复文件',
    actDupDesc: '查找内容相同的文件，选择保留的副本后更新笔记引用。',
    actOrphanTitle: '未引用文件',
    actOrphanDesc: '查找未被笔记或白板引用的文件。删除前可逐项检查。',
    actMigrateTitle: '批量上传',
    actMigrateDesc: '将选定目录中的附件上传到服务器，并更新笔记中的链接。',
    actAnalyticsTitle: '知识库概览',
    actAnalyticsDesc: '查看笔记、链接和附件的数量，以及本地与服务器的存储用量。',
    actRemoteGalleryTitle: '服务器文件',
    actRemoteGalleryDesc: '在 Obsidian 中浏览服务器文件，复制链接或插入当前笔记。',
    actRemoteGalleryViewTitle: '侧边栏浏览',
    actRemoteGalleryViewDesc: '在侧边栏浏览服务器文件，写笔记时可随时插入。',

    // 当前笔记动作
    actNoteUpTitle: '上传附件',
    actNoteUpDesc: '上传当前笔记引用的本地附件，并更新链接。',
    actNoteDownTitle: '下载附件',
    actNoteDownDesc: '下载当前笔记引用的服务器文件，并更新为本地链接。',
    actNoteAstroTitle: '复制链接',
    actNoteAstroDesc: '复制当前笔记的内容，并将其中的原图链接替换为公开的 WebP 链接。',
    actOpenSettingsTitle: '插件设置',
    actOpenSettingsDesc: '设置语言、服务器连接、附件上传和扫描排除目录。',

    // 扫描控制与通用步骤
    stepOf: '第 {current} / {total} 步',
    btnBack: '⬅ 上一步',
    btnCancel: '取消',
    btnNext: '下一步 ➔',
    btnSelectAll: '全选或取消全选',
    btnExportReport: '导出报告到知识库根目录',
    btnCancelScan: '⏹ 取消扫描',
    scanCancelled: '⏹ 已取消扫描任务',
    scanProgress: '⏳ 正在扫描 ({current}/{total}): {label}',

    // 新素材保存弹窗 (DestinationModal)
    destTitle: '保存新附件',
    destTypeSize: '类型：.{ext}  |  大小：{size}',
    destFilenameLabel: '文件名（自动保留 .{ext} 扩展名）：',
    destSaveLocal: '保存到知识库',
    destSaveRemote: '上传到服务器',
    destTranscodeTip: '⏳ 正在解码 .{ext} 预览...',
    destTranscodeFail: '⚠️ 本地预览暂不可用；上传时服务端将自动转码',

    // 孤儿未引用文件向导 (OrphanFinderModal)
    orphanStep1Title: '未引用文件',
    orphanStep1Desc: '查找未在笔记正文、属性或白板中被引用的文件。未引用不代表可以删除。',
    orphanLocScope: '1. 扫描位置',
    orphanScanLocal: '知识库文件',
    orphanScanRemote: '服务器文件',
    orphanTypeScope: '2. 文件类型',
    orphanTypeNote: '笔记（.md，默认不选）',
    orphanTypeImage: '🖼️ 图片素材 (png, jpg, webp, gif, svg, heic 等)',
    orphanTypeAudio: '🎵 音频素材 (mp3, m4a, wav, flac 等)',
    orphanTypeOther: '📦 其他附件 (视频、PDF、压缩包、各类文档)',
    orphanProtActive: '已跳过受保护的服务器文件{excl}。',
    orphanExclHint: '及本地排除目录 ({folders})',
    orphanLocRequired: '请至少选择一个扫描存储位置（本地或远程）。',
    orphanTypeRequired: '请至少选择一种文件类型。',
    orphanScanning: '⏳ 正在全库解析笔记引用关系...',
    orphanStep2Title: '找到 {count} 个未引用文件',
    orphanNoneFound: '所选范围内没有未引用文件。',
    orphanDeleteSelected: '移入回收站（{count}）',
    orphanDeleteConfirm: '将选中的 {count} 个文件移入回收站？\n请确认这些文件确实不再需要。',
    orphanDeleting: '正在移动文件...',
    orphanDeleteSuccess: '已处理 {count} 个文件。',

    // 重复文件查重向导 (DuplicateFinderModal)
    dupStep1Title: '重复文件',
    dupStep1Desc: '按文件内容查找完全相同的副本，文件名可以不同。',
    dupLocScope: '1. 比对范围',
    dupCompareLocal: '仅知识库文件',
    dupCompareCross: '知识库与服务器文件',
    dupTypeScope: '2. 文件类型',
    dupTypeImage: '🖼️ 图片素材',
    dupTypeAudio: '🎵 音频素材',
    dupTypeOther: '📦 其他媒体与附件',
    dupTypeNote: '笔记（.md，默认不选）',
    dupComparing: '⏳ 正在计算 SHA-256 哈希值并解析全库引用...',
    dupDesignateKeepTitle: '将此文件设为保留副本',
    lockBtnText: '开启防删除保护',
    lockBtnTitle: '防止误删此服务器文件，可随时解除保护',
    dupStep2Title: '找到 {groups} 组重复文件，可清理 {redundant} 个副本',
    dupNoneFound: '所选范围内没有重复文件。',
    dupAutoSelect: '选中可清理的副本',
    dupMergeRewrite: '合并并更新链接（{count}）',
    dupMergeConfirm: '合并选中的 {count} 个副本？\n笔记中指向这些文件的链接将更新为保留副本的链接。',
    dupMerging: '正在合并文件并更新链接...',
    dupMergeSuccess: '已合并 {count} 个重复文件。',

    // 批量上云迁移向导 (MigrationWizardModal)
    migrateStep1Title: '批量上传',
    migrateStep1Desc: '将附件上传到服务器，并更新笔记中的文件链接。',
    migrateFolderScope: '1. 选择目录',
    migrateEntireVault: '整个知识库（跳过排除目录）',
    migrateTypeScope: '2. 附件类型',
    migrateTypeImage: '🖼️ 图片附件 (png, jpg, heic, webp, gif, svg 等)',
    migrateTypeAudio: '🎵 音频附件 (mp3, m4a, wav, flac, ogg 等)',
    migrateTypeOther: '📦 其他附件 (视频, PDF, 压缩包, 办公文档等)',
    migratePolicyTitle: '3. 上传选项',
    migrateDeleteLocal: '上传并更新链接后，将不再被引用的本地文件移入回收站',
    migrateUploadProtected: '上传到服务器保护目录（可解除防删除保护）',
    migrateNextPreview: '预览文件',
    migrateSelectTypeNotice: '请至少勾选一种附件类型',
    migrateScanning: '⏳ 正在扫描指定目录下的附件与引用关系...',
    migrateStep2Title: '待上传文件（{count}）',
    migrateNoneFound: '所选目录中没有符合条件的附件。',
    migrateSelectOnlyRef: '仅选择被引用的文件',
    migrateNoteRefs: '{count} 处引用',
    migrateInspectRefs: '点击查看引用此附件的所有笔记',
    migrateSelectNotice: '请至少勾选一个要迁移的本地附件',
    migrateStart: '上传并更新链接（{count}）',
    migrateProgress: '正在上传（{current}/{total}）：{name}',
    migrateSuccess: '已上传 {count} 个附件，并更新笔记链接。',

    // 404 断链与健康体检 (HealthCheckModal)
    healthStep1Title: '失效链接',
    healthStep1Desc: '检查笔记和白板中的内部链接、本地文件链接及网页链接。',
    healthScopeTitle: '检查范围',
    healthCheckWiki: '检查指向不存在笔记的内部链接',
    healthCheckLocal: '检查缺失的本地文件',
    healthCheckRemote: '检查网页链接的 HTTP 响应（可能需要较长时间）',
    healthScopeHint: '扫描知识库中的 .md 和 .canvas 文件，跳过本插件生成的报告。',
    healthStartScan: '开始检查',
    healthScanning: '⏳ 正在扫描全库笔记中的所有链接引用...',
    healthStep2Title: '已检查 {docs} 个文档，发现 {issues} 处问题',
    healthStatNotes: '已检查文档',
    healthStatWiki: '失效内部链接',
    healthStatLocal: '缺失本地文件',
    healthStatRemote: '网页链接异常',
    healthRescan: '重新检查',
    healthFilterAll: '全部异常',
    healthSearchPlaceholder: '按笔记路径或目标名称过滤...',
    healthNoMatches: '当前筛选条件下未发现异常',
    healthTagWikiEmbed: '🔴 双链嵌入缺失',
    healthTagDanglingNote: '🔴 悬空笔记引用',
    healthTagMissingImage: '📁 本地图片缺失',
    healthTagMissingFile: '📁 本地文件缺失',
    healthTagRemote404: '网页链接异常',
    healthLine: '第 {line} 行',
    healthInNote: '📄 所在笔记: {path}',
    healthJumpToLine: '🎯 打开对应笔记 ➔',
    healthNoneFound: '所选检查范围内未发现链接问题。',

    // 知识库全景统计面板 (VaultAnalyticsModal)
    analyticsTitle: '知识库概览',
    analyticsBadge: '概览',
    analyticsLoading: '正在统计笔记、附件和服务器文件...',
    analyticsStatNotes: '笔记与白板总数',
    analyticsStatWords: '总字数 / 字符数',
    analyticsStatLinks: '双链与嵌入总数',
    analyticsStatStorage: '存储总占用',
    analyticsStorageComparison: '知识库与服务器存储用量',
    analyticsLocalVault: '知识库附件',
    analyticsRemoteServer: '服务器文件',
    analyticsTopLargest: '体积最大的 10 个附件',
    analyticsExportReport: '导出知识库报告（.md）',

    // 弹窗与通用通知
    confirmRemoteOrphanTitle: '移入回收站？',
    confirmRemoteOrphanMsg: '将服务器上的 {count} 个文件（共 {size}）移入回收站？请确认这些文件确实不再需要。',
    confirmRemoteOrphanBtn: '移入回收站（{count}）',
    confirmRemoteDupTitle: '合并服务器文件？',
    confirmRemoteDupMsg: '将 {count} 个服务器副本（共 {size}）移入回收站？笔记链接会先更新为保留副本的链接。',
    confirmRemoteDupBtn: '更新链接并移入回收站（{count}）',
    noDupToProcess: '没有需要处理的重复文件',
    noticeSavedLocal: '💻 已保存至本地知识库: {path}',
    noticeFailedLocal: '❌ 本地保存失败: {err}',
    noticeUploadedRemote: '已上传到服务器并插入链接：{name}',
    noticeUploadFailed: '上传到服务器失败：{err}',
    noticeCopiedRaw: '📎 已复制原始链接: {name}',
    noticeCopiedWebp: '⚡ 已复制 WebP 优化链接: {name}',
    noticeExclAdded: '🛡️ 已将目录 \"{path}\" 加入扫描排除名单',
    noticeExclRemoved: '🔓 已将目录 \"{path}\" 从扫描排除名单移除',
    noticeOpenMdFirst: '请先在编辑器中打开一篇 Markdown 笔记',
    noticeNoRemoteInActive: '当前笔记中没有服务器文件链接',
    noticeNoLocalInActive: '当前笔记中未找到本地附件引用',
    noticeAstroCopied: '✅ 已将包含公开 WebP 链接的笔记内容复制至剪贴板！',

    // 设置面板标签
    settingsTitle: 'FileMaster 设置',
    settingsBack: '返回设置首页',
    settingsSetupGroup: '开始使用',
    settingsPreferencesGroup: '使用偏好',
    settingsToolsGroup: '文件工具',
    settingsInfoGroup: '插件信息',
    tabGeneral: '常规设置',
    tabServer: '服务器连接',
    tabUpload: '附件与链接',
    tabExemptions: '保护与排除',

    // 常规与语言
    langName: '界面语言',
    langDesc: '设置 FileMaster 的界面语言',
    langAuto: '跟随 Obsidian',
    sidebarBtnName: '显示工具栏按钮',
    sidebarBtnDesc: '在 Obsidian 左侧工具栏显示 FileMaster 按钮',
    clipboardMonitorName: '处理粘贴与拖入的附件',
    clipboardMonitorDesc: '按附件保存位置处理粘贴或拖入的文件',

    // 服务端连接
    enableRemoteServerName: '连接服务器',
    enableRemoteServerDesc: '启用服务器上传与文件浏览',
    serverVerifiedBadge: '已连接',
    serverUnverifiedBadge: '待测试',
    serverDisabledHint: '服务器连接已关闭。当前只能使用知识库中的本地文件功能。',
    serverUnverifiedHint: '请先测试服务器连接。连接成功后才能使用服务器文件功能。',
    serverUrlName: '服务器地址',
    serverUrlDesc: '服务器地址，例如 http://192.168.1.100:3000',
    apiTokenName: 'API 令牌',
    apiTokenDesc: '填写服务器提供的 API 令牌',
    showToken: '显示令牌',
    hideToken: '隐藏令牌',
    btnTestConn: '测试连接',
    testConnSuccess: '连接成功。服务器{ver}上有 {count} 个文件。',
    testConnFail: '❌ 连接失败：{err}',
    compatWarn: '⚠️ 兼容性警告：服务端要求插件版本 >= v{minVer}（当前: v{currentVer}），请更新插件。',
    compatWarnServer: '⚠️ 服务端版本过旧警告：当前服务端为 v{serverVer}，本插件推荐 >= v{minServerVer}，部分新特性可能受限。',
    compatStatusChecking: '正在检查连接和版本...',
    compatStatusOk: '已连接 · 服务器 v{serverVer} · {count} 个文件',
    compatStatusServerOld: '服务器版本较旧：v{serverVer}；插件需要 v{minServerVer} 或更新版本。请在服务器控制台更新。',
    compatStatusPluginOld: '🔴 插件版本过旧 · 服务端要求插件 >= v{minPluginVer} (当前: v{currentVer}，请更新插件)',
    compatStatusAuthFail: '🔴 认证失败 · API 令牌无效或未授权 (401)',
    compatStatusOffline: '⚪ 未连接 · 无法连接至该服务端地址 ({err})',

    // 上传与链接
    saveLocationName: '附件保存位置',
    saveLocationDesc: '粘贴或拖入附件时的默认保存位置',
    optSaveAsk: '每次询问',
    optSaveRemote: '上传到服务器',
    optSaveLocal: '保存到知识库',
    insertOptimizedName: '插入 WebP 链接',
    insertOptimizedDesc: '开启后插入 WebP 链接；关闭后插入原文件链接',
    namingStrategyName: '附件命名规则',
    namingStrategyDesc: '设置新附件的文件名',
    optNamingKeep: '保留原名',
    optNamingRule: '按规则命名',
    optNamingPrompt: '每次询问',
    namingPatternName: '自动重命名模板规则',
    namingPatternDesc: '支持变量：{note} 笔记标题, {origin} 原名, {date} 年月日, {time} 时分秒, {timestamp} 时间戳, {rand:4} 随机字符, {hash:8} 哈希',

    // 保护与规则
    excludedFoldersName: '不扫描的目录',
    excludedFoldersDesc: '以逗号分隔的目录相对路径（如 templates, protected）。也可直接在文件树右键目录添加排除',
    excludeLockedRemoteName: '跳过受保护的服务器文件',
    excludeLockedRemoteDesc: '查找未引用文件和重复文件时，跳过开启防删除保护的服务器文件',
    openHubName: '功能面板',
    openHubDesc: '检查链接、整理文件并查看知识库概览',
    btnOpenHub: '打开 FileMaster',

    // 底部信息栏
    aboutTitle: '关于 FileMaster',
    aboutDesc: '在 Obsidian 中管理附件和链接，并通过自建服务器存储与分享文件。',
    aboutAuthor: '开发者',
    aboutRepo: '官方开源仓库',
    aboutFeedback: '问题反馈',
    aboutFeedbackLink: '打开 GitHub Issues',
    aboutServerCompat: '服务端兼容要求',
    aboutServerStatus: '关联服务端状态',
    aboutServerOffline: '未连接',

    // 右键上下文菜单
    menuMigrateFolder: 'FileMaster：批量上传此目录的附件...',
    menuRemoveExclusion: 'FileMaster：不再跳过此目录',
    menuAddExclusion: 'FileMaster：扫描时跳过此目录',
    menuUploadCloud: 'FileMaster：上传到服务器并更新链接',
    menuUploadProtected: 'FileMaster：上传到服务器保护目录',
    menuCopyRaw: 'FileMaster：复制原文件链接（{name}）',
    menuCopyWebp: 'FileMaster：复制 WebP 链接',
    menuDownloadToVault: 'FileMaster：下载到知识库并更新链接（{name}）',
    menuLockRemote: 'FileMaster：开启防删除保护（{name}）',
    menuActiveNoteMigrate: 'FileMaster：上传当前笔记的附件',
    menuActiveNoteDownload: 'FileMaster：下载当前笔记的服务器附件',
    menuActiveNoteAstro: 'FileMaster：复制当前笔记并使用 WebP 链接',

    // 命令面板命令
    cmdOpenHub: '打开 FileMaster',
    cmdScanHealth: '检查失效链接',
    cmdScanOrphan: '查找未引用文件',
    cmdScanDuplicate: '查找重复文件',
    cmdBatchMigrate: '批量上传附件',
    cmdVaultAnalytics: '打开知识库概览',
    cmdMigrateActiveNote: '上传当前笔记的附件',
    cmdDownloadActiveNote: '下载当前笔记的服务器附件',
    cmdCopyAstroLinks: '复制当前笔记并使用 WebP 链接',
    cmdRemoteGallery: '浏览服务器文件',
    cmdRemoteGalleryView: '在侧边栏浏览服务器文件',

    // 全局通知与操作提示
    scanPreparing: '⏳ 正在准备扫描...',
    noticeProtectedRemote: '已为服务器文件开启防删除保护：{name}',
    noticeLockFailed: '❌ 锁定失败：{err}',
    noticeSaveCancelled: '已取消保存附件',
    noticeRemoteUnreachable: '无法连接服务器（{err}），仅显示知识库中的未引用文件。',
    noticeReportGenerated: '📄 已在知识库根目录生成报告：{path}',
    noticeRemoteDeleteFailed: '❌ 删除远程文件失败（{name}）：{err}',
    noticeCleanupComplete: '已处理文件：知识库 {local} 个，服务器 {remote} 个。',
    noticeCannotOpenFile: '无法打开指定文件：{path}',
    noticeUploadingFile: '正在上传“{name}”...',
    noticeMigrateSuccess: '已上传“{name}”到服务器{protected}，并更新 {docs} 篇笔记中的链接。',
    noticeMigrateFailed: '❌ 迁移失败（{name}）：{err}',
    noticeDownloadingFile: '⏳ 正在下载远程附件 "{name}" 回本地...',
    noticeDownloadedToVault: '已将“{name}”保存到知识库（{path}），并更新 {docs} 篇笔记中的链接。',
    noticeDownloadFailed: '❌ 下载至本地失败：{err}',
    noticeDownloadedBatch: '已下载 {count} 个服务器文件到知识库，并更新笔记链接。',
    noticeBatchMigrateSuccess: '已上传 {count} 个文件，更新 {docs} 篇笔记{trashed}。',
    noticeBatchMigrateTrashedPart: '，将 {trashed} 个本地文件移入回收站',
    noticeNoteMigrateSuccess: '已上传当前笔记中的 {count} 个附件，并更新链接。',
    noticeDedupSafetyWarning: '已更新 {modified} 篇笔记；处理知识库文件 {local} 个、服务器文件 {remote} 个。仍被引用的 {skipped} 个文件已保留。',
    noticeDedupSuccess: '已更新 {modified} 篇笔记；处理知识库文件 {local} 个、服务器文件 {remote} 个。',
    previewTitle: '文件预览：{name}',
    previewTitleLabel: '文件预览',
    previewLinksTitle: '复制链接',
    previewSourceLocal: '💻 本地知识库',
    previewSourceRemote: '服务器',
    previewMeta: '{source} · 路径：{path} · 大小：{size}',
    previewPathLabel: '文件位置',
    previewSizeLabel: '文件大小',
    previewCopyMarkdown: '复制 Markdown',
    previewCopyUrl: '复制文件链接',
    previewInsert: '插入当前笔记',
    previewProtected: '已开启防删除保护',
    previewUnprotected: '已解除防删除保护',
    previewLockFailed: '修改保护状态失败：{err}',
    previewDeleteFailed: '移动文件失败：{err}',
    previewOpenBrowser: '在浏览器中打开',
    previewNonImageTip: '这是 .{ext} 文件。可在 Obsidian 或浏览器中打开。',
    btnOpenInObsidian: '📂 在 Obsidian 中打开',
    btnOpenRawInBrowser: '🌐 在浏览器中查看原图',
    noteRefsTitle: '🔗 引用 "{name}" 的笔记 ({count})',
    noteRefsNone: '当前没有任何笔记或白板引用此文件。',
    btnOpenNote: '↗ 打开笔记',
    noteRefsNotFound: '未找到笔记：{path}',
    thumbEnlargeTooltip: '点击放大预览',
    thumbDetailsTooltip: '查看文件详情',
    orphanSelectRequired: '请至少选择一个待清理的文件。',
    dupSelectTypeRequired: '请至少选择一种查重文件类型。',
    analyticsLocalStats: '🖼️ 图片：{img} ({imgBytes}) · 🎵 音频：{aud} ({audBytes}) · 📦 其他：{oth} ({othBytes})',
    analyticsRemoteStats: '⚡ WebP 缓存：{cache} · 🔒 防删锁定：{locked}',
    analyticsBadgeLocal: '💻 本地',
    analyticsBadgeRemote: '☁️ 远程',
    analyticsFail: '❌ 计算知识库统计报告失败：{err}',
    btnConfirm: '确认',
    noticeInstantUpload: '服务器上已有相同文件，已复用现有链接。',

    // 素材处理进度与结果弹窗
    destProcessingTitle: '正在处理附件...',
    destProbeChecking: '正在检查服务器上是否已有相同文件...',
    destUploadingRemote: '正在上传到服务器...',
    destSavingLocal: '💻 正在保存至本地知识库...',
    destResultTitle: '附件已处理',
    destInstantBadge: '服务器上已有相同文件',
    destInstantDesc: '已复用服务器上的文件，无需重新上传文件内容。',
    destSuccessBadge: '已上传到服务器',
    destSuccessDesc: '文件已上传到服务器，并插入链接。',
    destLocalBadge: '已保存到知识库',
    destLocalDesc: '文件已保存到知识库，并插入引用。',
    destInsertedNotice: '✅ 已自动插入当前笔记光标处',
    destLabelRawUrl: '原文件链接：',
    destLabelPubUrl: 'WebP 链接：',
    destLabelLocalPath: '本地知识库存储路径:',
    destLabelMarkdown: '插入的 Markdown 引用语法:',
    destBtnCopy: '复制',
    destBtnCopied: '已复制！',
    destBtnDone: '完成',
    destProcessingError: '❌ 处理失败：{err}',

    // 向导完成结果与当前笔记窗口
    batchResultTitle: '批量上传完成',
    batchResultDesc: '已上传 {count} 个附件，更新 {docs} 篇笔记{trashed}。',
    dupResultTitle: '重复文件已合并',
    dupResultDesc: '已更新 {modified} 篇笔记，处理知识库文件 {local} 个、服务器文件 {remote} 个{skipped}。',
    dupResultSkipped: '；另有 {count} 个仍被引用的文件已保留',
    orphanResultTitle: '未引用文件已处理',
    orphanResultDesc: '已处理 {count} 个文件：知识库 {local} 个，服务器 {remote} 个。',
    activeNoteModalTitle: '当前笔记',
    activeNoteMigrateTitle: '上传附件',
    activeNoteDownloadTitle: '下载附件',
    activeNoteScanning: '⏳ 正在解析当前笔记中的附件引用...',
    activeNoteProcessing: '⏳ 正在处理 ({current}/{total}): {name}...',
    activeNoteMigrateComplete: '上传完成',
    activeNoteDownloadComplete: '下载完成',
    activeNoteMigrateDoneDesc: '已上传当前笔记中的 {count} 个附件，并更新链接。',
    activeNoteDownloadDoneDesc: '已下载当前笔记中的 {count} 个服务器文件，并更新为本地链接。',
    activeNoteNoLocal: '⚠️ 当前笔记中未找到本地附件引用',
    activeNoteNoRemote: '当前笔记中没有服务器文件链接',

    // 远端图床媒体相册 UI
    galleryTitle: '服务器文件',
    galleryViewTitle: '服务器文件',
    galleryLoading: '正在加载服务器文件...',
    galleryLoadFail: '无法加载服务器文件：{err}',
    gallerySearchPlaceholder: '搜索文件名...',
    galleryFilterAllTime: '全部目录',
    galleryFolderLabel: '目录',
    galleryFilterAllTypes: '全部类型',
    galleryTypeLabel: '类型',
    galleryFilterImage: '图片',
    galleryFilterAudio: '音频',
    galleryFilterOther: '其他',
    galleryStats: '{count} 个文件 · 共 {size}',
    galleryFileCount: '{count} 个文件',
    galleryTotalSize: '共 {size}',
    galleryEmpty: '没有符合条件的文件',
    galleryBtnRefresh: '刷新',
    galleryBtnPreview: '大图预览',
    galleryBtnInsert: '插入笔记',
    galleryBtnCopyRaw: '原文件链接',
    galleryBtnCopyWebp: 'WebP 链接',
    galleryBtnCopyMd: 'Markdown',
    galleryBtnUrl: '网址',
    galleryTrackRaw: '原文件',
    galleryTrackWebp: 'WebP',
    galleryInsertModeTooltip: '切换默认插入模式（当前：{mode}，点击切换）',
    galleryModeRaw: '原文件',
    galleryModeWebp: 'WebP',
    galleryLinkFormat: '插入链接格式',
    galleryInsertFormatLabel: '插入格式',
    galleryLayoutGrid: '网格视图',
    galleryLayoutList: '列表视图',
    galleryCopied: '已复制！',
    galleryInserted: '✅ 已将图片插入当前笔记光标处',
    galleryInsertedRaw: '✅ 已将高清原图插入当前笔记光标处',
    galleryInsertedWebp: '✅ 已将 WebP 优化图片插入当前笔记光标处',
    galleryOpenNoteFirst: '请先在编辑器中打开一篇笔记',
    galleryBtnLock: '锁定防删',
    galleryBtnUnlock: '解除锁定',
    galleryBtnDelete: '移入回收站',
    galleryDeleteConfirm: '将服务器文件“{name}”移入回收站？\n笔记中指向此文件的链接将无法使用。',
    galleryDeleteSuccess: '✅ 已成功将 "{name}" 移入回收站',

    closeBtn: '关闭'
  },
  en: {
    // Quick Hub
    hubBadge: 'File tools',
    hubTitle: 'FileMaster',
    hubSubtitle: 'Manage vault files, links, and server files',
    catGovernance: 'Organize vault',
    catFiles: 'Server files',
    catActiveNote: 'Current note',
    catSettings: 'Settings',

    // Wizards
    actHealthTitle: 'Broken links',
    actHealthDesc: 'Check notes and canvases for missing files and unreachable web links.',
    actDupTitle: 'Duplicate files',
    actDupDesc: 'Find identical files, choose which copy to keep, and update note links.',
    actOrphanTitle: 'Unreferenced files',
    actOrphanDesc: 'Find files that no note or canvas references. Review each file before removing it.',
    actMigrateTitle: 'Batch upload',
    actMigrateDesc: 'Upload attachments from selected folders to the server and update note links.',
    actAnalyticsTitle: 'Vault overview',
    actAnalyticsDesc: 'See note, link, and file counts, plus storage use in your vault and on the server.',
    actRemoteGalleryTitle: 'Server files',
    actRemoteGalleryDesc: 'Browse server files in Obsidian, copy links, or insert files into the current note.',
    actRemoteGalleryViewTitle: 'Sidebar browser',
    actRemoteGalleryViewDesc: 'Keep server files in the sidebar while writing notes.',

    // Active Note Tools
    actNoteUpTitle: 'Upload note attachments',
    actNoteUpDesc: 'Upload local attachments referenced by this note and update its links.',
    actNoteDownTitle: 'Download note attachments',
    actNoteDownDesc: 'Download server files referenced by this note and update its links.',
    actNoteAstroTitle: 'Copy with optimized links',
    actNoteAstroDesc: 'Copy this note with original image links replaced by public WebP links.',
    actOpenSettingsTitle: 'Plugin settings',
    actOpenSettingsDesc: 'Set the language, server connection, uploads, and excluded folders.',

    // Scan Control & Common Steps
    stepOf: 'Step {current} of {total}',
    btnBack: '⬅ Back',
    btnCancel: 'Cancel',
    btnNext: 'Next ➔',
    btnSelectAll: 'Select or deselect all',
    btnExportReport: 'Export report to vault root',
    btnCancelScan: '⏹ Cancel Scan',
    scanCancelled: '⏹ Scan cancelled by user',
    scanProgress: '⏳ Scanning ({current}/{total}): {label}',

    // Destination Modal
    destTitle: 'Save attachment',
    destTypeSize: 'Type: .{ext}  |  Size: {size}',
    destFilenameLabel: 'Filename (extension .{ext} preserved automatically):',
    destSaveLocal: 'Save to vault',
    destSaveRemote: 'Upload to server',
    destTranscodeTip: '⏳ Decoding .{ext} preview...',
    destTranscodeFail: '⚠️ Local preview unavailable; server will auto-transcode upon upload',

    // Orphan Finder Wizard
    orphanStep1Title: 'Unreferenced files',
    orphanStep1Desc: 'Find files not referenced in note content, properties, or canvases. An unreferenced file may still be worth keeping.',
    orphanLocScope: '1. Location',
    orphanScanLocal: 'Vault files',
    orphanScanRemote: 'Server files',
    orphanTypeScope: '2. File types',
    orphanTypeNote: 'Notes (.md, off by default)',
    orphanTypeImage: '🖼️ Images (png, jpg, webp, gif, svg, heic, etc.)',
    orphanTypeAudio: '🎵 Audio (mp3, m4a, wav, flac, etc.)',
    orphanTypeOther: '📦 Other Files (Video, PDF, archives, documents)',
    orphanProtActive: 'Protected server files{excl} are skipped.',
    orphanExclHint: ', and excluded local folders ({folders})',
    orphanLocRequired: 'Please select at least one scan location (local or remote).',
    orphanTypeRequired: 'Please select at least one file type.',
    orphanScanning: '⏳ Scanning vault references...',
    orphanStep2Title: 'Found {count} unreferenced files',
    orphanNoneFound: 'No unreferenced files found in the selected scope.',
    orphanDeleteSelected: 'Move to trash ({count})',
    orphanDeleteConfirm: 'Move {count} selected files to trash?\nMake sure you no longer need them.',
    orphanDeleting: 'Moving files...',
    orphanDeleteSuccess: 'Processed {count} files.',

    // Duplicate Files Wizard
    dupStep1Title: 'Duplicate files',
    dupStep1Desc: 'Find files with identical content, even when their names differ.',
    dupLocScope: '1. Compare',
    dupCompareLocal: 'Vault files only',
    dupCompareCross: 'Vault and server files',
    dupTypeScope: '2. File types',
    dupTypeImage: 'Images',
    dupTypeAudio: 'Audio',
    dupTypeOther: '📦 Other Media & Attachments',
    dupTypeNote: 'Notes (.md, off by default)',
    dupComparing: '⏳ Calculating SHA-256 hashes and resolving references...',
    dupDesignateKeepTitle: 'Keep this copy',
    lockBtnText: 'Protect from deletion',
    lockBtnTitle: 'Prevent accidental deletion of this server file; protection can be removed later',
    dupStep2Title: 'Found {groups} duplicate groups and {redundant} extra copies',
    dupNoneFound: 'No duplicate files found in the selected scope.',
    dupAutoSelect: 'Select extra copies',
    dupMergeRewrite: 'Merge and update links ({count})',
    dupMergeConfirm: 'Merge {count} selected copies?\nNote links will be updated to point to the copies you keep.',
    dupMerging: 'Merging files and updating note links...',
    dupMergeSuccess: 'Merged {count} duplicate files.',

    // Batch Cloud Migration Wizard
    migrateStep1Title: 'Batch upload',
    migrateStep1Desc: 'Upload attachments to the server and update links in your notes.',
    migrateFolderScope: '1. Folder',
    migrateEntireVault: 'Entire vault (skip excluded folders)',
    migrateTypeScope: '2. File types',
    migrateTypeImage: '🖼️ Image Attachments (png, jpg, heic, webp, gif, svg, etc.)',
    migrateTypeAudio: '🎵 Audio Attachments (mp3, m4a, wav, flac, ogg, etc.)',
    migrateTypeOther: '📦 Other Attachments (video, PDF, archives, documents, etc.)',
    migratePolicyTitle: '3. Upload options',
    migrateDeleteLocal: 'After upload and link updates, move local files with no remaining references to trash',
    migrateUploadProtected: 'Upload to protected server folder (deletion protection can be removed)',
    migrateNextPreview: 'Preview files',
    migrateSelectTypeNotice: 'Please select at least one attachment type.',
    migrateScanning: '⏳ Scanning local attachments and references...',
    migrateStep2Title: 'Files to upload ({count})',
    migrateNoneFound: 'No matching attachments in the selected folder.',
    migrateSelectOnlyRef: 'Select referenced files only',
    migrateNoteRefs: '{count} references',
    migrateInspectRefs: 'View notes that reference this file',
    migrateSelectNotice: 'Please select at least one local attachment to migrate.',
    migrateStart: 'Upload and update links ({count})',
    migrateProgress: 'Uploading ({current}/{total}): {name}',
    migrateSuccess: 'Uploaded {count} attachments and updated note links.',

    // Vault Link Health Check
    healthStep1Title: 'Broken links',
    healthStep1Desc: 'Check links to notes, local files, and web pages in notes and canvases.',
    healthScopeTitle: 'What to check',
    healthCheckWiki: 'Links to missing notes',
    healthCheckLocal: 'Links to missing local files',
    healthCheckRemote: 'Web links (HTTP check; may take longer)',
    healthScopeHint: 'Scans .md and .canvas files in your vault, except reports generated by this plugin.',
    healthStartScan: 'Check links',
    healthScanning: '⏳ Scanning vault notes for broken link references...',
    healthStep2Title: 'Checked {docs} documents; found {issues} issues',
    healthStatNotes: 'Documents checked',
    healthStatWiki: 'Broken note links',
    healthStatLocal: 'Missing Local Files',
    healthStatRemote: 'Web link errors',
    healthRescan: 'Check again',
    healthFilterAll: 'All Issues',
    healthSearchPlaceholder: 'Filter by note or target...',
    healthNoMatches: 'No issues match the current filter/search.',
    healthTagWikiEmbed: '🔴 Wiki Embed',
    healthTagDanglingNote: '🔴 Dangling Note',
    healthTagMissingImage: '📁 Missing Image',
    healthTagMissingFile: '📁 Missing Local File',
    healthTagRemote404: 'Web link error',
    healthLine: 'Line {line}',
    healthInNote: '📄 In Note: {path}',
    healthJumpToLine: '🎯 Open Note ➔',
    healthNoneFound: 'No link issues found in the selected scope.',

    // Vault Storage Analytics
    analyticsTitle: 'Vault overview',
    analyticsBadge: 'Overview',
    analyticsLoading: 'Counting notes, attachments, and server files...',
    analyticsStatNotes: 'Notes & Canvas Boards',
    analyticsStatWords: 'Total Words / Characters',
    analyticsStatLinks: 'Links & Embeds',
    analyticsStatStorage: 'Total Storage Footprint',
    analyticsStorageComparison: 'Vault and server storage',
    analyticsLocalVault: 'Vault attachments',
    analyticsRemoteServer: 'Server files',
    analyticsTopLargest: '10 largest attachments',
    analyticsExportReport: 'Export vault report (.md)',

    // Confirm Dialogs and Notices
    confirmRemoteOrphanTitle: 'Move to trash?',
    confirmRemoteOrphanMsg: 'Move {count} server files ({size}) to trash? Make sure you no longer need them.',
    confirmRemoteOrphanBtn: 'Move to trash ({count})',
    confirmRemoteDupTitle: 'Merge server files?',
    confirmRemoteDupMsg: 'Move {count} server copies ({size}) to trash? Note links will first be updated to the copies you keep.',
    confirmRemoteDupBtn: 'Update links and move to trash ({count})',
    noDupToProcess: 'No duplicate files to process',
    noticeSavedLocal: '💻 Saved to local vault: {path}',
    noticeFailedLocal: '❌ Failed to save locally: {err}',
    noticeUploadedRemote: 'Uploaded to server and inserted link: {name}',
    noticeUploadFailed: 'Could not upload to server: {err}',
    noticeCopiedRaw: '📎 Copied raw original link: {name}',
    noticeCopiedWebp: '⚡ Copied optimized WebP link: {name}',
    noticeExclAdded: '🛡️ Added folder \"{path}\" to scan exclusion list (ignored in scans)',
    noticeExclRemoved: '🔓 Removed folder \"{path}\" from scan exclusion list',
    noticeOpenMdFirst: 'Please open a Markdown note first.',
    noticeNoRemoteInActive: 'No server file links in this note.',
    noticeNoLocalInActive: 'No local attachments found to migrate in active note.',
    noticeAstroCopied: '✅ Copied active note text with public WebP links to clipboard!',

    // Settings Tabs
    settingsTitle: 'FileMaster settings',
    settingsBack: 'Back to settings',
    settingsSetupGroup: 'Get started',
    settingsPreferencesGroup: 'Preferences',
    settingsToolsGroup: 'File tools',
    settingsInfoGroup: 'Plugin information',
    tabGeneral: 'General',
    tabServer: 'Server connection',
    tabUpload: 'Attachments & links',
    tabExemptions: 'Protection & exclusions',

    // General & Language
    langName: 'Interface Language',
    langDesc: 'Choose the language for FileMaster',
    langAuto: 'Follow Obsidian',
    sidebarBtnName: 'Show ribbon button',
    sidebarBtnDesc: 'Show the FileMaster button in the left Obsidian ribbon',
    clipboardMonitorName: 'Handle pasted and dropped files',
    clipboardMonitorDesc: 'Use your attachment destination for pasted or dropped files',

    // Remote Server
    enableRemoteServerName: 'Connect to server',
    enableRemoteServerDesc: 'Enable server uploads and file browsing',
    serverVerifiedBadge: 'Connected',
    serverUnverifiedBadge: 'Not tested',
    serverDisabledHint: 'Server connection is off. Only local vault features are available.',
    serverUnverifiedHint: 'Test the server connection before using server files.',
    serverUrlName: 'Server URL',
    serverUrlDesc: 'Server address, such as http://localhost:3000',
    apiTokenName: 'API token',
    apiTokenDesc: 'API token from FileMaster Server',
    showToken: 'Show token',
    hideToken: 'Hide token',
    btnTestConn: 'Test connection',
    testConnSuccess: 'Connected. Server{ver} has {count} files.',
    testConnFail: '❌ Connection failed: {err}',
    compatWarn: '⚠️ Compatibility warning: Server requires FileMaster Plugin >= v{minVer} (current: v{currentVer}). Please update the plugin.',
    compatWarnServer: '⚠️ Server version warning: Server is v{serverVer}, plugin recommends >= v{minServerVer}. Some features may be restricted.',
    compatStatusChecking: 'Checking connection and versions...',
    compatStatusOk: 'Connected · Server v{serverVer} · {count} files',
    compatStatusServerOld: 'Server v{serverVer} is too old. The plugin needs v{minServerVer} or later. Update it in the server console.',
    compatStatusPluginOld: '🔴 Plugin outdated · Server requires plugin >= v{minPluginVer} (Current: v{currentVer}, please update plugin)',
    compatStatusAuthFail: '🔴 Authentication failed · API token is invalid or missing (401)',
    compatStatusOffline: '⚪ Offline · Unable to reach server at this address ({err})',

    // Upload & Links
    saveLocationName: 'Where to save attachments',
    saveLocationDesc: 'Default destination for pasted or dropped attachments',
    optSaveAsk: 'Ask every time',
    optSaveRemote: 'Upload to server',
    optSaveLocal: 'Save to vault',
    insertOptimizedName: 'Insert WebP links',
    insertOptimizedDesc: 'Use WebP links when on, original file links when off',
    namingStrategyName: 'Attachment Naming Strategy',
    namingStrategyDesc: 'Choose how new attachments are named',
    optNamingKeep: 'Keep filename',
    optNamingRule: 'Use naming pattern',
    optNamingPrompt: 'Ask each time',
    namingPatternName: 'Auto-Rename Pattern Template',
    namingPatternDesc: 'Variables: {note} Note title, {origin} Original name, {date} YYYYMMDD, {time} HHMMSS, {timestamp} Epoch, {rand:4} Hex, {hash:8} SHA-256',

    // Protection & Rules
    excludedFoldersName: 'Folders to skip',
    excludedFoldersDesc: 'Comma-separated directory paths (e.g. templates, assets/protected). Or right-click any folder in file tree',
    excludeLockedRemoteName: 'Skip protected server files',
    excludeLockedRemoteDesc: 'Skip server files protected from deletion when finding unreferenced or duplicate files',
    openHubName: 'Open file tools',
    openHubDesc: 'Check links, organize files, and view vault statistics',
    btnOpenHub: 'Open FileMaster',

    // About Footer
    aboutTitle: 'About FileMaster',
    aboutDesc: 'Manage attachments and links in Obsidian, with optional self-hosted file storage and sharing.',
    aboutAuthor: 'Author',
    aboutRepo: 'GitHub Repository',
    aboutFeedback: 'Report an Issue',
    aboutFeedbackLink: 'Open GitHub Issues',
    aboutServerCompat: 'Server Compatibility',
    aboutServerStatus: 'Connected Server',
    aboutServerOffline: 'Offline',

    // Context Menus
    menuMigrateFolder: 'FileMaster: Upload attachments in this folder...',
    menuRemoveExclusion: 'FileMaster: Include this folder in scans',
    menuAddExclusion: 'FileMaster: Skip this folder in scans',
    menuUploadCloud: 'FileMaster: Upload to server and update links',
    menuUploadProtected: 'FileMaster: Upload to protected server folder',
    menuCopyRaw: 'FileMaster: Copy original file URL ({name})',
    menuCopyWebp: 'FileMaster: Copy WebP URL',
    menuDownloadToVault: 'FileMaster: Download to vault and update links ({name})',
    menuLockRemote: 'FileMaster: Protect from deletion ({name})',
    menuActiveNoteMigrate: 'FileMaster: Upload attachments in this note',
    menuActiveNoteDownload: 'FileMaster: Download server files in this note',
    menuActiveNoteAstro: 'FileMaster: Copy this note with WebP links',

    // Command Palette
    cmdOpenHub: 'Open FileMaster',
    cmdScanHealth: 'Check broken links',
    cmdScanOrphan: 'Find unreferenced files',
    cmdScanDuplicate: 'Find duplicate files',
    cmdBatchMigrate: 'Upload attachments in batches',
    cmdVaultAnalytics: 'Open vault overview',
    cmdMigrateActiveNote: 'Upload attachments in this note',
    cmdDownloadActiveNote: 'Download server files in this note',
    cmdCopyAstroLinks: 'Copy this note with WebP links',
    cmdRemoteGallery: 'Browse server files',
    cmdRemoteGalleryView: 'Browse server files in sidebar',

    // Notices & Modals
    scanPreparing: '⏳ Preparing scan...',
    noticeProtectedRemote: 'Protected server file from deletion: {name}',
    noticeLockFailed: '❌ Lock failed: {err}',
    noticeSaveCancelled: 'Attachment saving cancelled',
    noticeRemoteUnreachable: 'Could not reach the server ({err}). Showing unreferenced vault files only.',
    noticeReportGenerated: '📄 Generated report in vault root: {path}',
    noticeRemoteDeleteFailed: '❌ Failed to delete remote file ({name}): {err}',
    noticeCleanupComplete: 'Processed {local} vault files and {remote} server files.',
    noticeCannotOpenFile: 'Cannot open file: {path}',
    noticeUploadingFile: 'Uploading "{name}"...',
    noticeMigrateSuccess: 'Uploaded "{name}" to the server{protected} and updated links in {docs} notes.',
    noticeMigrateFailed: '❌ Upload migration failed ({name}): {err}',
    noticeDownloadingFile: '⏳ Downloading remote "{name}" to vault...',
    noticeDownloadedToVault: 'Saved "{name}" to the vault ({path}) and updated links in {docs} notes.',
    noticeDownloadFailed: '❌ Failed to download to vault: {err}',
    noticeDownloadedBatch: '🎉 Downloaded {count} remote attachment(s) to vault and updated links!',
    noticeBatchMigrateSuccess: 'Uploaded {count} files and updated {docs} notes{trashed}.',
    noticeBatchMigrateTrashedPart: ', and moved {trashed} local files to trash',
    noticeNoteMigrateSuccess: 'Uploaded {count} attachments in this note and updated its links.',
    noticeDedupSafetyWarning: 'Updated {modified} notes and processed {local} vault files and {remote} server files. Kept {skipped} files that are still referenced.',
    noticeDedupSuccess: 'Updated {modified} notes and processed {local} vault files and {remote} server files.',
    previewTitle: 'File preview: {name}',
    previewTitleLabel: 'File preview',
    previewLinksTitle: 'Copy links',
    previewSourceLocal: '💻 Local Vault',
    previewSourceRemote: 'Server',
    previewMeta: '{source} · Path: {path} · Size: {size}',
    previewPathLabel: 'Location',
    previewSizeLabel: 'File size',
    previewCopyMarkdown: 'Copy Markdown',
    previewCopyUrl: 'Copy file URL',
    previewInsert: 'Insert into note',
    previewProtected: 'Protected from deletion',
    previewUnprotected: 'Deletion protection removed',
    previewLockFailed: 'Could not change protection: {err}',
    previewDeleteFailed: 'Could not move file: {err}',
    previewOpenBrowser: 'Open in browser',
    previewNonImageTip: 'This is a .{ext} file. Open it in Obsidian or your browser.',
    btnOpenInObsidian: '📂 Open in Obsidian',
    btnOpenRawInBrowser: 'Open original file in browser',
    noteRefsTitle: '🔗 Notes Referencing "{name}" ({count})',
    noteRefsNone: 'This file is currently not referenced by any notes.',
    btnOpenNote: '↗ Open Note',
    noteRefsNotFound: 'Note not found: {path}',
    thumbEnlargeTooltip: 'Click to enlarge preview',
    thumbDetailsTooltip: 'View file details',
    orphanSelectRequired: 'Please select at least one file to clean.',
    dupSelectTypeRequired: 'Please select at least one file type to compare.',
    analyticsLocalStats: '🖼️ Images: {img} ({imgBytes}) · 🎵 Audio: {aud} ({audBytes}) · 📦 Other: {oth} ({othBytes})',
    analyticsRemoteStats: '⚡ WebP Cache: {cache} · 🔒 Protected/Locked: {locked}',
    analyticsBadgeLocal: '💻 Local',
    analyticsBadgeRemote: '☁️ Remote',
    analyticsFail: '❌ Failed to compute vault analytics: {err}',
    btnConfirm: 'Confirm',
    noticeInstantUpload: 'An identical file already exists on the server. Reused its link.',

    // Asset Processing Progress & Result Modal
    destProcessingTitle: 'Processing attachment...',
    destProbeChecking: 'Checking whether this file is already on the server...',
    destUploadingRemote: 'Uploading to server...',
    destSavingLocal: '💻 Saving to local vault...',
    destResultTitle: 'Attachment processed',
    destInstantBadge: 'File already on server',
    destInstantDesc: 'Reused the existing server file without uploading its content again.',
    destSuccessBadge: 'Uploaded to server',
    destSuccessDesc: 'File uploaded to the server and link inserted.',
    destLocalBadge: 'Saved to vault',
    destLocalDesc: 'File saved to the vault and link inserted.',
    destInsertedNotice: '✅ Reference inserted at cursor in active note',
    destLabelRawUrl: 'Raw URL:',
    destLabelPubUrl: 'Public WebP URL:',
    destLabelLocalPath: 'Local Vault Path:',
    destLabelMarkdown: 'Markdown Reference:',
    destBtnCopy: 'Copy',
    destBtnCopied: 'Copied!',
    destBtnDone: 'Done',
    destProcessingError: '❌ Processing Failed: {err}',

    // Wizard Results & Active Note Modal
    batchResultTitle: 'Batch upload complete',
    batchResultDesc: 'Uploaded {count} attachments and updated {docs} notes{trashed}.',
    dupResultTitle: 'Duplicate files merged',
    dupResultDesc: 'Updated {modified} notes and processed {local} vault files and {remote} server files{skipped}.',
    dupResultSkipped: '; kept {count} files that are still referenced',
    orphanResultTitle: 'Unreferenced files processed',
    orphanResultDesc: 'Processed {count} files: {local} in the vault and {remote} on the server.',
    activeNoteModalTitle: 'Current note',
    activeNoteMigrateTitle: 'Upload attachments',
    activeNoteDownloadTitle: 'Download attachments',
    activeNoteScanning: '⏳ Scanning attachments referenced in active note...',
    activeNoteProcessing: '⏳ Processing ({current}/{total}): {name}...',
    activeNoteMigrateComplete: 'Upload complete',
    activeNoteDownloadComplete: 'Download complete',
    activeNoteMigrateDoneDesc: 'Uploaded {count} attachments in this note and updated its links.',
    activeNoteDownloadDoneDesc: 'Downloaded {count} server files in this note and updated their links to local files.',
    activeNoteNoLocal: '⚠️ No local attachments found in active note',
    activeNoteNoRemote: 'No server file links in this note',

    // Remote Asset Gallery UI
    galleryTitle: 'Server files',
    galleryViewTitle: 'Server files',
    galleryLoading: 'Loading server files...',
    galleryLoadFail: 'Could not load server files: {err}',
    gallerySearchPlaceholder: 'Search filenames...',
    galleryFilterAllTime: 'All folders',
    galleryFolderLabel: 'Folder',
    galleryFilterAllTypes: 'All types',
    galleryTypeLabel: 'Type',
    galleryFilterImage: 'Images',
    galleryFilterAudio: 'Audio',
    galleryFilterOther: 'Others',
    galleryStats: '{count} files · {size} total',
    galleryFileCount: '{count} files',
    galleryTotalSize: '{size} total',
    galleryEmpty: 'No matching files',
    galleryBtnRefresh: 'Refresh',
    galleryBtnPreview: 'Preview',
    galleryBtnInsert: 'Insert into note',
    galleryBtnCopyRaw: 'Original URL',
    galleryBtnCopyWebp: 'WebP URL',
    galleryBtnCopyMd: 'Markdown',
    galleryBtnUrl: 'URL',
    galleryTrackRaw: 'Original',
    galleryTrackWebp: 'WebP',
    galleryInsertModeTooltip: 'Toggle default insert mode (Current: {mode})',
    galleryModeRaw: 'Original',
    galleryModeWebp: 'WebP',
    galleryLinkFormat: 'Link format for insertion',
    galleryInsertFormatLabel: 'Insert as',
    galleryLayoutGrid: 'Grid View',
    galleryLayoutList: 'List View',
    galleryCopied: 'Copied!',
    galleryInserted: '✅ Inserted markdown reference into active note',
    galleryInsertedRaw: '✅ Inserted raw original image reference into active note',
    galleryInsertedWebp: '✅ Inserted WebP optimized image reference into active note',
    galleryOpenNoteFirst: 'Please open a markdown note in the editor first',
    galleryBtnLock: 'Lock',
    galleryBtnUnlock: 'Unlock',
    galleryBtnDelete: 'Move to trash',
    galleryDeleteConfirm: 'Move server file "{name}" to trash?\nLinks to this file in notes will stop working.',
    galleryDeleteSuccess: '✅ Successfully moved "{name}" to trash',

    closeBtn: 'Close'
  }
};

function getEffectiveLanguage(lang) {
  if (lang === 'zh' || lang === 'en') {
    return lang;
  }
  try {
    const obsLang = (typeof getLanguage === 'function' && getLanguage()) ||
      (typeof document !== 'undefined' && document.documentElement?.lang) ||
      (typeof window !== 'undefined' && window.localStorage?.getItem('language')) ||
      (typeof navigator !== 'undefined' && navigator.language) || 'en';
    return String(obsLang).toLowerCase().startsWith('zh') ? 'zh' : 'en';
  } catch (e) {
    return 'en';
  }
}

function translateUi(lang, key, params = {}) {
  const effective = getEffectiveLanguage(lang);
  const dict = UI_STRINGS[effective] || UI_STRINGS.zh;
  let str = dict[key] || UI_STRINGS.en[key] || UI_STRINGS.zh[key] || key;
  for (const [k, v] of Object.entries(params)) {
    str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
  }
  return str;
}

/**
 * Transcodes HEIC/HEIF/TIFF buffers into browser-renderable JPEG Blob URLs.
 * Standard images render immediately via browser Blob URL;
 * Special raw formats (HEIC/TIFF) delegate safely to FileMaster Server transcode API (/api/image/preview-transcode).
 */
async function convertBufferToPreviewUrl(arrayBuffer, ext = 'heic', plugin = null) {
  const cleanExt = String(ext || '').toLowerCase();
  if (!NEEDS_TRANSCODE_IMAGE_EXTS.has(cleanExt)) {
    const blob = new Blob([arrayBuffer], { type: `image/${cleanExt === 'jpg' ? 'jpeg' : cleanExt}` });
    return URL.createObjectURL(blob);
  }

  // Delegate transcoding to FileMaster Server (/api/image/preview-transcode) using safe requestUrl
  if (plugin && plugin.settings?.serverUrl && plugin.settings?.apiToken) {
    const url = `${plugin.getCleanServerUrl()}/api/image/preview-transcode`;
    const { boundary, arrayBuffer: bodyBuffer } = buildMultipartBuffer(
      arrayBuffer,
      `preview.${cleanExt}`,
      'application/octet-stream'
    );
    const response = await requestUrl({
      url,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${plugin.settings.apiToken}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      },
      body: bodyBuffer,
      throw: false
    });
    if (response.status >= 200 && response.status < 300 && response.arrayBuffer) {
      const blob = new Blob([response.arrayBuffer], { type: 'image/jpeg' });
      return URL.createObjectURL(blob);
    }
  }

  throw new Error('No remote HEIC/TIFF decoder available');
}

function getExt(filename) {
  const idx = String(filename || '').lastIndexOf('.');
  return idx > -1 ? filename.slice(idx + 1).toLowerCase() : '';
}

function getBaseName(filename) {
  const idx = String(filename || '').lastIndexOf('.');
  return idx > -1 ? filename.slice(0, idx) : String(filename || '');
}

function getFileTypeGroup(ext) {
  const e = String(ext || '').toLowerCase();
  if (e === 'md') return 'note';
  if (IMAGE_EXTS.has(e)) return 'image';
  if (AUDIO_EXTS.has(e)) return 'audio';
  return 'other';
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(i > 1 ? 2 : 1) + ' ' + sizes[i];
}

function computeSha256Hex(arrayBuffer) {
  return crypto.createHash('sha256').update(Buffer.from(arrayBuffer)).digest('hex');
}

function compareSemver(v1, v2) {
  const p1 = String(v1 || '0.0.0').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const p2 = String(v2 || '0.0.0').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((p1[i] || 0) > (p2[i] || 0)) return 1;
    if ((p1[i] || 0) < (p2[i] || 0)) return -1;
  }
  return 0;
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Sanitizes base filename while preserving CJK characters, normalizing spaces/brackets to underscores
 */
function sanitizeCleanBaseName(str, fallback = 'file') {
  return (
    String(str || '')
      .replace(/[\/\\?%*:|"<>#\0]/g, '_')
      .replace(/[\s()[\]]+/g, '_')
      .replace(/_+/g, '_')
      .trim() || fallback
  );
}

/**
 * Checks if a file is an auto-generated inspection report
 */
function isReportFile(filename) {
  const name = String(filename || '');
  return (
    name.startsWith('Unused_Files_Report_') ||
    name.startsWith('Duplicate_Files_Report_') ||
    name.startsWith('Broken_Links_Report_') ||
    name.startsWith('Vault_Analytics_Report_')
  );
}

/**
 * Pure analytics engine for Vault Wrapped & Storage Analytics Dashboard
 */
function computeVaultStatsFromEntries(vaultFiles, docTexts, remoteImages = []) {
  let noteCount = 0;
  let canvasCount = 0;
  let totalWords = 0;
  let totalInternalLinks = 0;
  let localImageCount = 0;
  let localImageBytes = 0;
  let localAudioCount = 0;
  let localAudioBytes = 0;
  let localOtherCount = 0;
  let localOtherBytes = 0;
  const attachmentList = [];

  for (const f of vaultFiles || []) {
    if (isReportFile(f.name)) continue;
    const ext = String(f.extension || getExt(f.name)).toLowerCase();
    const size = f.stat?.size ?? f.size ?? 0;

    if (ext === 'md') {
      noteCount++;
    } else if (ext === 'canvas') {
      canvasCount++;
    } else if (isAttachmentExt(ext)) {
      const grp = getFileTypeGroup(ext);
      if (grp === 'image') {
        localImageCount++;
        localImageBytes += size;
      } else if (grp === 'audio') {
        localAudioCount++;
        localAudioBytes += size;
      } else {
        localOtherCount++;
        localOtherBytes += size;
      }
      attachmentList.push({
        name: f.name,
        path: f.path || f.name,
        ext,
        group: grp,
        size,
        source: 'local'
      });
    }
  }

  for (const text of docTexts || []) {
    const str = String(text || '');
    // Count CJK characters + Latin/numeric words
    const cjkMatches = str.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g);
    const wordMatches = str.replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, ' ').match(/[a-zA-Z0-9_]+/g);
    totalWords += (cjkMatches ? cjkMatches.length : 0) + (wordMatches ? wordMatches.length : 0);

    const wikiMatches = str.match(/!?\[\[[^\]\r\n]+\]\]/g);
    const mdMatches = str.match(/!?\[[^\]\r\n]*\]\([^)\r\n]+\)/g);
    totalInternalLinks += (wikiMatches ? wikiMatches.length : 0) + (mdMatches ? mdMatches.length : 0);
  }

  let remoteTotalCount = 0;
  let remoteRawBytes = 0;
  let remoteCacheBytes = 0;
  let remoteLockedCount = 0;

  for (const r of remoteImages || []) {
    remoteTotalCount++;
    remoteRawBytes += Number(r.size) || 0;
    remoteCacheBytes += Number(r.cacheSize) || 0;
    if (r.locked || r.inProtectedFolder) remoteLockedCount++;
    attachmentList.push({
      name: r.filename,
      path: `${r.year}/${r.month}/${r.filename}`,
      ext: String(r.ext || '').replace(/^\./, ''),
      group: r.category || 'image',
      size: Number(r.size) || 0,
      source: 'remote'
    });
  }

  const topLargestAttachments = [...attachmentList]
    .sort((a, b) => b.size - a.size)
    .slice(0, 8);

  const localTotalBytes = localImageBytes + localAudioBytes + localOtherBytes;
  const localTotalCount = localImageCount + localAudioCount + localOtherCount;

  return {
    noteCount,
    canvasCount,
    totalWords,
    totalInternalLinks,
    local: {
      totalCount: localTotalCount,
      totalBytes: localTotalBytes,
      imageCount: localImageCount,
      imageBytes: localImageBytes,
      audioCount: localAudioCount,
      audioBytes: localAudioBytes,
      otherCount: localOtherCount,
      otherBytes: localOtherBytes
    },
    remote: {
      totalCount: remoteTotalCount,
      rawBytes: remoteRawBytes,
      cacheBytes: remoteCacheBytes,
      lockedCount: remoteLockedCount
    },
    topLargestAttachments
  };
}

/**
 * Resolves WikiLink target note or attachment against vault index
 */
function resolveWikiTarget(target, docPath, vaultIndex) {
  if (!target) return true;
  let decoded = target;
  try {
    decoded = decodeURIComponent(target);
  } catch {}

  const candidates = [target, decoded];
  for (const c of candidates) {
    if (vaultIndex.paths.has(c) || vaultIndex.paths.has(c + '.md')) return true;
    if (vaultIndex.names.has(c)) return true;
    if (vaultIndex.basenames.has(c)) return true;

    // Check relative to current document folder
    const docDir = docPath.includes('/') ? docPath.substring(0, docPath.lastIndexOf('/')) : '';
    if (docDir) {
      const rel = path.posix.normalize(`${docDir}/${c}`).replace(/^(\.\/)+/, '');
      if (vaultIndex.paths.has(rel) || vaultIndex.paths.has(rel + '.md')) return true;
    }
  }
  return false;
}

/**
 * Resolves standard markdown file/image target against vault index
 */
function resolveLocalMarkdownTarget(target, docPath, vaultIndex) {
  if (!target) return true;
  let decoded = target;
  try {
    decoded = decodeURIComponent(target);
  } catch {}

  const candidates = [target, decoded];
  for (const c of candidates) {
    const clean = c.startsWith('/') ? c.slice(1) : c;
    if (vaultIndex.paths.has(clean)) return true;
    if (vaultIndex.paths.has(clean + '.md')) return true;

    // Check relative to current document folder
    const docDir = docPath.includes('/') ? docPath.substring(0, docPath.lastIndexOf('/')) : '';
    if (docDir) {
      const rel = path.posix.normalize(`${docDir}/${clean}`).replace(/^(\.\/)+/, '');
      if (vaultIndex.paths.has(rel) || vaultIndex.paths.has(rel + '.md')) return true;
    }

    const fileName = clean.split('/').pop();
    if (vaultIndex.names.has(fileName)) return true;
  }
  return false;
}

/**
 * Scans markdown text content for broken WikiLinks and missing local markdown files
 */
function scanNoteContentForBrokenLinks(docPath, rawText, vaultIndex, options = {}) {
  const issues = [];
  if (!rawText) return issues;

  // 1. Check WikiLinks: ![[...]] and [[...]]
  const wikiRegex = /(!?)\[\[([^\]\n\r]+)\]\]/g;
  let m;
  while ((m = wikiRegex.exec(rawText)) !== null) {
    const isEmbed = Boolean(m[1]);
    const rawInside = m[2].trim();
    const targetPart = rawInside.split(/[|#]/)[0].trim();
    if (!targetPart) continue; // Same-page anchor [[#heading]]

    if (!resolveWikiTarget(targetPart, docPath, vaultIndex)) {
      const prefix = rawText.substring(0, m.index);
      const lineNumber = prefix.split('\n').length;
      const lineStart = prefix.lastIndexOf('\n') + 1;
      let lineEnd = rawText.indexOf('\n', m.index);
      if (lineEnd === -1) lineEnd = rawText.length;
      const lineText = rawText.substring(lineStart, lineEnd).trim();

      issues.push({
        type: isEmbed ? 'wikilink-embed' : 'wikilink',
        category: 'wikilink',
        sourcePath: docPath,
        target: targetPart,
        rawText: m[0],
        line: lineNumber,
        lineText,
        reason: isEmbed ? 'Embedded attachment not found in vault' : 'Linked note not found in vault'
      });
    }
  }

  // 2. Check Standard Markdown Links: ![alt](url) and [alt](url)
  const mdRegex = /(!?)\[([^\]\r\n]*)\]\((\s*<[^>]+>|[^\s)]+)(?:\s+["'][^"']*["'])?\)/g;
  while ((m = mdRegex.exec(rawText)) !== null) {
    const isEmbed = Boolean(m[1]);
    let rawUrl = m[3].trim();
    if (rawUrl.startsWith('<') && rawUrl.endsWith('>')) {
      rawUrl = rawUrl.slice(1, -1).trim();
    }
    if (rawUrl.startsWith('#')) continue; // In-page anchor
    if (/^(?:mailto:|obsidian:|tel:|data:)/i.test(rawUrl)) continue;

    if (/^(?:https?|ftp):\/\//i.test(rawUrl)) {
      if (options.checkRemote) {
        const prefix = rawText.substring(0, m.index);
        const lineNumber = prefix.split('\n').length;
        const lineStart = prefix.lastIndexOf('\n') + 1;
        let lineEnd = rawText.indexOf('\n', m.index);
        if (lineEnd === -1) lineEnd = rawText.length;
        const lineText = rawText.substring(lineStart, lineEnd).trim();

        issues.push({
          type: isEmbed ? 'remote-embed' : 'remote-link',
          category: 'remote',
          sourcePath: docPath,
          target: rawUrl,
          rawText: m[0],
          line: lineNumber,
          lineText,
          reason: 'Remote resource unreachable'
        });
      }
    } else {
      const cleanTarget = rawUrl.split(/[?#]/)[0].trim();
      if (!cleanTarget) continue;

      if (!resolveLocalMarkdownTarget(cleanTarget, docPath, vaultIndex)) {
        const prefix = rawText.substring(0, m.index);
        const lineNumber = prefix.split('\n').length;
        const lineStart = prefix.lastIndexOf('\n') + 1;
        let lineEnd = rawText.indexOf('\n', m.index);
        if (lineEnd === -1) lineEnd = rawText.length;
        const lineText = rawText.substring(lineStart, lineEnd).trim();

        issues.push({
          type: isEmbed ? 'local-embed' : 'local-link',
          category: 'local',
          sourcePath: docPath,
          target: cleanTarget,
          rawText: m[0],
          line: lineNumber,
          lineText,
          reason: isEmbed ? 'Embedded local file missing at path' : 'Target document missing at path'
        });
      }
    }
  }

  return issues;
}

/**
 * Generates base filename from dynamic naming pattern (excluding extension)
 */
function applyNamingPattern(pattern, { noteName, originBase, sha256 }) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const timeStr = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const timestamp = String(Math.floor(now.getTime() / 1000));

  let result = String(pattern || '{origin}');
  result = result.replace(/\{note\}/gi, noteName || 'note');
  result = result.replace(/\{origin\}/gi, originBase || 'file');
  result = result.replace(/\{date\}/gi, dateStr);
  result = result.replace(/\{time\}/gi, timeStr);
  result = result.replace(/\{timestamp\}/gi, timestamp);
  result = result.replace(/\{hash(?::(\d+))?\}/gi, (_, len) => {
    const l = Math.min(64, Math.max(4, Number(len) || 8));
    return (sha256 || '').slice(0, l);
  });
  result = result.replace(/\{rand(?::(\d+))?\}/gi, (_, len) => {
    const l = Math.min(16, Math.max(2, Number(len) || 4));
    return crypto.randomBytes(Math.ceil(l / 2)).toString('hex').slice(0, l);
  });

  return sanitizeCleanBaseName(result, `file_${timestamp}`);
}

/**
 * Constructs multipart/form-data ArrayBuffer payload
 */
function buildMultipartBuffer(fileBytes, filename, mimeType = 'application/octet-stream') {
  const boundary = '----FileMasterBoundary' + Date.now().toString(16);
  const enc = new TextEncoder();
  const safeName = String(filename || 'file.png').replace(/"/g, '_');

  const headerStr =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${safeName}"\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n`;
  const footerStr = `\r\n--${boundary}--\r\n`;

  const headerBuf = enc.encode(headerStr);
  const footerBuf = enc.encode(footerStr);
  const bodyUint8 = new Uint8Array(fileBytes);

  const combined = new Uint8Array(headerBuf.byteLength + bodyUint8.byteLength + footerBuf.byteLength);
  combined.set(headerBuf, 0);
  combined.set(bodyUint8, headerBuf.byteLength);
  combined.set(footerBuf, headerBuf.byteLength + bodyUint8.byteLength);

  return {
    boundary,
    arrayBuffer: combined.buffer
  };
}

/**
 * Helper to create a real-time scan progress bar + cancel button inside wizard modals
 */
function createScanProgressWidget(contentEl, plugin) {
  const abortController = new AbortController();
  const box = contentEl.createDiv({
    cls: 'fm-section-box',
    style: 'display:none; margin-top:10px; border-color: rgba(59, 130, 246, 0.45);'
  });
  const topRow = box.createDiv({
    style: 'display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:6px;'
  });
  const statusText = topRow.createSpan({
    text: plugin ? plugin.t('scanPreparing') : '⏳ Preparing scan...',
    style: 'font-size:12px; color:var(--text-accent); font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;'
  });
  const cancelScanBtn = topRow.createEl('button', {
    text: plugin ? plugin.t('btnCancelScan') : '⏹ Cancel Scan',
    cls: 'fm-mini-btn mod-warning',
    style: 'flex-shrink:0;'
  });
  cancelScanBtn.onclick = () => {
    abortController.abort();
    cancelScanBtn.disabled = true;
  };
  const wrap = box.createDiv({ cls: 'fm-progress-wrap' });
  const bar = wrap.createDiv({ cls: 'fm-progress-bar' });

  return {
    signal: abortController.signal,
    show() {
      box.style.display = 'block';
    },
    hide() {
      box.style.display = 'none';
    },
    abort() {
      abortController.abort();
    },
    update(current, total, label = '') {
      const pct = Math.min(100, Math.round((current / Math.max(1, total)) * 100));
      bar.style.width = `${pct}%`;
      const msg = plugin
        ? plugin.t('scanProgress', { current, total, label })
        : `⏳ Scanning (${current}/${total}): ${label}`;
      statusText.setText(msg);
    }
  };
}

/**
 * Confirmation modal for critical actions like remote file deletion
 */
class ConfirmActionModal extends Modal {
  constructor(app, title, message, confirmText = 'Confirm', onConfirm, plugin = null) {
    super(app);
    this.title = title;
    this.message = message;
    this.confirmText = confirmText;
    this.onConfirm = onConfirm;
    this.plugin = plugin;
    this.resolved = false;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('fm-wizard-modal');
    contentEl.createEl('h3', { text: this.title });
    const p = contentEl.createEl('p', { text: this.message });
    p.style.lineHeight = '1.6';
    p.style.margin = '12px 0 18px';

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const cancelLabel = this.plugin ? this.plugin.t('btnCancel') : translateUi('auto', 'btnCancel');
    const cancelBtn = btnRow.createEl('button', { text: cancelLabel });
    cancelBtn.onclick = () => {
      this.resolved = true;
      this.close();
      this.onConfirm(false);
    };

    const okBtn = btnRow.createEl('button', { text: this.confirmText, cls: 'mod-warning' });
    okBtn.onclick = () => {
      this.resolved = true;
      this.close();
      this.onConfirm(true);
    };
  }

  onClose() {
    if (!this.resolved && this.onConfirm) {
      this.onConfirm(false);
    }
    this.contentEl.empty();
  }
}

/**
 * High-res lightbox modal for asset inspection
 */
class ImageLightboxModal extends Modal {
  constructor(app, plugin, item, onActionChanged = null) {
    super(app);
    this.plugin = plugin;
    this.item = item;
    this.onActionChanged = onActionChanged;
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('fm-wizard-modal');
    contentEl.addClass('fm-lightbox-modal');
    this.modalEl.addClass('fm-lightbox-dialog');
    const t = (k, p) => (this.plugin ? this.plugin.t(k, p) : translateUi('auto', k, p));

    const header = contentEl.createDiv({ cls: 'fm-lightbox-header' });
    header.createDiv({ cls: 'fm-lightbox-eyebrow', text: t('previewTitleLabel') });
    header.createEl('h3', { text: this.item.name });

    const srcLabel = this.item.source === 'local' ? t('previewSourceLocal') : t('previewSourceRemote');
    const meta = header.createDiv({ cls: 'fm-lightbox-meta' });
    meta.createSpan({ cls: 'fm-lightbox-source', text: srcLabel });
    const details = meta.createDiv({ cls: 'fm-lightbox-details' });
    const pathDetail = details.createDiv({ cls: 'fm-lightbox-detail' });
    pathDetail.createSpan({ cls: 'fm-lightbox-detail-label', text: t('previewPathLabel') });
    pathDetail.createSpan({ cls: 'fm-lightbox-detail-value', text: this.item.displayPath });
    const sizeDetail = details.createDiv({ cls: 'fm-lightbox-detail' });
    sizeDetail.createSpan({ cls: 'fm-lightbox-detail-label', text: t('previewSizeLabel') });
    sizeDetail.createSpan({ cls: 'fm-lightbox-detail-value', text: formatBytes(this.item.size) });

    const ext = getExt(this.item.name);
    const isImg = IMAGE_EXTS.has(ext);
    if (isImg) {
      const img = contentEl.createEl('img', { cls: 'fm-lightbox-img' });
      const url = await this.plugin.getItemPreviewUrl(this.item);
      if (url) img.src = url;
    } else {
      contentEl.createDiv({
        cls: 'fm-section-box',
        text: t('previewNonImageTip', { ext: ext.toUpperCase() }),
        style: 'text-align: center; padding: 30px 16px;'
      });
    }

    // Detailed link copy tracks (Raw & WebP)
    if (this.item.source === 'remote' && this.item.rawObj) {
      const remote = this.item.rawObj;
      const fn = this.item.name || remote.filename;

      const tracksBox = contentEl.createDiv({ cls: 'fm-lightbox-tracks' });
      tracksBox.createDiv({ cls: 'fm-lightbox-section-label', text: t('previewLinksTitle') });

      // Track 1: 原图
      const rawRow = tracksBox.createDiv({ cls: 'fm-lightbox-track-row' });
      rawRow.createSpan({ text: t('galleryTrackRaw'), cls: 'fm-lightbox-track-name' });
      const rawMdBtn = rawRow.createEl('button', { text: t('previewCopyMarkdown'), cls: 'fm-lightbox-copy-btn' });
      rawMdBtn.onclick = async () => {
        const mdSnippet = isImg ? `![${fn}](${remote.rawUrl})` : `[${fn}](${remote.rawUrl})`;
        await navigator.clipboard.writeText(mdSnippet);
        rawMdBtn.setText(t('galleryCopied'));
        setTimeout(() => { if (rawMdBtn.isConnected) rawMdBtn.setText(t('previewCopyMarkdown')); }, 1500);
      };
      const rawUrlBtn = rawRow.createEl('button', { text: t('previewCopyUrl'), cls: 'fm-lightbox-copy-btn' });
      rawUrlBtn.onclick = async () => {
        await navigator.clipboard.writeText(remote.rawUrl);
        rawUrlBtn.setText(t('galleryCopied'));
        setTimeout(() => { if (rawUrlBtn.isConnected) rawUrlBtn.setText(t('previewCopyUrl')); }, 1500);
      };

      // Track 2: WebP 优化图 (若存在)
      if (remote.pubUrl) {
        const optRow = tracksBox.createDiv({ cls: 'fm-lightbox-track-row' });
        optRow.createSpan({ text: t('galleryTrackWebp'), cls: 'fm-lightbox-track-name' });
        const optMdBtn = optRow.createEl('button', { text: t('previewCopyMarkdown'), cls: 'fm-lightbox-copy-btn' });
        optMdBtn.onclick = async () => {
          const mdSnippet = isImg ? `![${fn}](${remote.pubUrl})` : `[${fn}](${remote.pubUrl})`;
          await navigator.clipboard.writeText(mdSnippet);
          optMdBtn.setText(t('galleryCopied'));
          setTimeout(() => { if (optMdBtn.isConnected) optMdBtn.setText(t('previewCopyMarkdown')); }, 1500);
        };
        const optUrlBtn = optRow.createEl('button', { text: t('previewCopyUrl'), cls: 'fm-lightbox-copy-btn' });
        optUrlBtn.onclick = async () => {
          await navigator.clipboard.writeText(remote.pubUrl);
          optUrlBtn.setText(t('galleryCopied'));
          setTimeout(() => { if (optUrlBtn.isConnected) optUrlBtn.setText(t('previewCopyUrl')); }, 1500);
        };
      }
    }

    const btnRow = contentEl.createDiv({ cls: 'fm-lightbox-actions' });
    const leftActions = btnRow.createDiv({ cls: 'fm-lightbox-primary-actions' });
    const rightActions = btnRow.createDiv({ cls: 'fm-lightbox-management-actions' });

    if (this.item.source === 'local' && this.item.rawObj) {
      const openBtn = leftActions.createEl('button', { cls: 'mod-cta' });
      setIcon(openBtn.createSpan(), 'external-link');
      openBtn.createSpan({ text: t('btnOpenInObsidian') });
      openBtn.onclick = async () => {
        const leaf = this.app.workspace.getLeaf(false);
        if (leaf) await leaf.openFile(this.item.rawObj);
        this.close();
      };
    } else if (this.item.source === 'remote' && this.item.rawObj) {
      const remote = this.item.rawObj;
      const fn = this.item.name || remote.filename;

      // 1. 一键插入笔记
      const insertBtn = leftActions.createEl('button', { cls: 'mod-cta' });
      setIcon(insertBtn.createSpan(), 'file-input');
      insertBtn.createSpan({ text: t('previewInsert') });
      insertBtn.onmousedown = (e) => {
        e.preventDefault();
      };
      insertBtn.onclick = () => {
        const targetUrl = (this.plugin?.settings?.insertOptimizedLinkOnUpload && remote.pubUrl) ? remote.pubUrl : (remote.rawUrl || remote.pubUrl);
        const mdSnippet = isImg ? `![${fn}](${targetUrl})\n` : `[${fn}](${targetUrl})\n`;
        const ok = this.plugin?.insertMarkdownToActiveEditor(mdSnippet, t('galleryInserted'));
        if (ok) this.close();
      };

      // 2. 加锁 / 解锁按钮
      const lockBtn = rightActions.createEl('button', { cls: 'fm-lightbox-management-btn' });
      const lockIcon = lockBtn.createSpan();
      const lockText = lockBtn.createSpan();
      const updateLockButton = () => {
        setIcon(lockIcon, remote.locked ? 'lock-open' : 'lock');
        lockText.setText(t(remote.locked ? 'galleryBtnUnlock' : 'galleryBtnLock'));
        lockBtn.setAttribute('title', lockText.textContent);
      };
      updateLockButton();
      lockBtn.onclick = async () => {
        try {
          await this.plugin.toggleRemoteFileLock(remote.year, remote.month, remote.filename, !remote.locked);
          remote.locked = !remote.locked;
          updateLockButton();
          delBtn.disabled = remote.locked;
          new Notice(t(remote.locked ? 'previewProtected' : 'previewUnprotected'));
          if (this.onActionChanged) this.onActionChanged('lock', remote);
        } catch (err) {
          new Notice(t('previewLockFailed', { err: err.message }));
        }
      };

      // 3. 删除至回收站
      const delBtn = rightActions.createEl('button', { cls: 'fm-lightbox-management-btn is-danger', attr: { title: t('galleryBtnDelete') } });
      setIcon(delBtn.createSpan(), 'trash-2');
      delBtn.createSpan({ text: t('galleryBtnDelete') });
      delBtn.disabled = remote.locked;
      delBtn.onclick = () => {
        if (remote.locked) return;
        new ConfirmActionModal(
          this.app,
          fn,
          t('galleryDeleteConfirm', { name: fn }),
          t('galleryBtnDelete'),
          async (confirmed) => {
            if (!confirmed) return;
            try {
              await this.plugin.deleteRemoteFile(remote.year, remote.month, remote.filename);
              new Notice(t('galleryDeleteSuccess', { name: fn }));
              if (this.onActionChanged) this.onActionChanged('deleted', remote);
              this.close();
            } catch (err) {
              new Notice(t('previewDeleteFailed', { err: err.message }));
            }
          },
          this.plugin
        ).open();
      };
      const openBtn = leftActions.createEl('button', { cls: 'fm-lightbox-secondary-btn' });
      setIcon(openBtn.createSpan(), 'external-link');
      openBtn.createSpan({ text: t('previewOpenBrowser') });
      openBtn.onclick = () => {
        window.open(remote.rawUrl, '_blank');
      };
    }

  }

  onClose() {
    this.contentEl.empty();
  }
}

/**
 * Modal listing all notes referencing the selected asset
 */
class NoteRefsModal extends Modal {
  constructor(app, itemName, refNotePaths, onJump, plugin = null) {
    super(app);
    this.itemName = itemName;
    this.refNotePaths = refNotePaths || [];
    this.onJump = onJump;
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('fm-wizard-modal');
    const t = (k, p) => (this.plugin ? this.plugin.t(k, p) : translateUi('auto', k, p));

    contentEl.createEl('h3', { text: t('noteRefsTitle', { name: this.itemName, count: this.refNotePaths.length }) });

    if (this.refNotePaths.length === 0) {
      contentEl.createDiv({
        cls: 'fm-section-box',
        text: t('noteRefsNone'),
        style: 'text-align: center; padding: 24px;'
      });
    } else {
      const listEl = contentEl.createDiv({ cls: 'fm-scroll-list' });
      for (const notePath of this.refNotePaths) {
        const row = listEl.createDiv({ cls: 'fm-list-item' });
        row.createSpan({ text: `📝 ${notePath}`, style: 'word-break: break-all; font-weight: 500;' });
        const jumpBtn = row.createEl('button', {
          text: t('btnOpenNote'),
          cls: 'fm-mini-btn mod-cta'
        });
        jumpBtn.onclick = async () => {
          const tf = this.app.vault.getAbstractFileByPath(notePath);
          if (tf) {
            const leaf = this.app.workspace.getLeaf(false);
            if (leaf) await leaf.openFile(tf);
            this.close();
            if (this.onJump) this.onJump();
          } else {
            new Notice(t('noteRefsNotFound', { path: notePath }));
          }
        };
      }
    }

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const closeBtn = btnRow.createEl('button', { text: t('closeBtn') });
    closeBtn.onclick = () => this.close();
  }

  onClose() {
    this.contentEl.empty();
  }
}

/**
 * Renders a 44x44 thumbnail or icon in wizard lists (click to inspect)
 */
function renderItemVisualThumb(parentEl, item, plugin) {
  const t = (k, p) => (plugin ? plugin.t(k, p) : translateUi('auto', k, p));
  const ext = getExt(item.name);
  if (IMAGE_EXTS.has(ext)) {
    const img = parentEl.createEl('img', {
      cls: 'fm-item-thumb',
      attr: { title: t('thumbEnlargeTooltip') }
    });
    img.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      new ImageLightboxModal(plugin.app, plugin, item).open();
    };
    plugin.getItemPreviewUrl(item).then((url) => {
      if (url) img.src = url;
    });
  } else {
    const box = parentEl.createDiv({
      cls: 'fm-item-icon-box',
      attr: { title: t('thumbDetailsTooltip') }
    });
    const icon =
      ext === 'md'
        ? '📝'
        : AUDIO_EXTS.has(ext)
          ? '🎵'
          : ['mp4', 'webm', 'mov', 'mkv'].includes(ext)
            ? '🎬'
            : ext === 'pdf'
              ? '📄'
              : '📦';
    box.createSpan({ text: icon });
    box.createSpan({ text: (ext || 'FILE').slice(0, 4).toUpperCase(), cls: 'fm-item-icon-ext' });
    box.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      new ImageLightboxModal(plugin.app, plugin, item).open();
    };
  }
}

class IncomingFileModal extends Modal {
  constructor(app, fileInfo, options, callback = null) {
    super(app);
    this.fileInfo = fileInfo; // { arrayBuffer, defaultBaseName, ext, size, mimeType, sha256 }
    this.options = options;   // { askLocation, fixedLocation, promptRename, plugin, editor, activeFile }
    this.callback = callback;
    this.plugin = options.plugin;
    const isRemote = Boolean(this.plugin?.isRemoteServerReady?.());
    if (!isRemote) {
      this.options.askLocation = false;
      this.options.fixedLocation = 'local';
      this.targetLocation = 'local';
      this.step = this.options.promptRename ? 'input' : 'executing';
    } else {
      this.step = (options.askLocation || options.promptRename) ? 'input' : 'executing';
    }
    this.finalFilename = `${fileInfo.defaultBaseName}.${fileInfo.ext}`;
    this.targetLocation = this.options.fixedLocation || (isRemote ? 'remote' : 'local');
    this.result = null;
    this.isDone = false;
  }

  t(k, p) {
    return this.plugin ? this.plugin.t(k, p) : k;
  }

  onOpen() {
    this.render();
    if (this.step === 'executing') {
      this.runExecution();
    }
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('fm-wizard-modal');

    if (this.step === 'input') {
      this.renderInputStep();
    } else if (this.step === 'executing') {
      this.renderExecutingStep();
    } else if (this.step === 'result') {
      this.renderResultStep();
    }
  }

  renderInputStep() {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: this.t('destTitle') });

    // Render thumbnail preview for images (including HEIC/HEIF/TIFF)
    if (IMAGE_EXTS.has(this.fileInfo.ext)) {
      const img = contentEl.createEl('img', { cls: 'fm-preview-thumb' });
      const loadingTip = NEEDS_TRANSCODE_IMAGE_EXTS.has(this.fileInfo.ext)
        ? contentEl.createDiv({
            text: this.t('destTranscodeTip', { ext: this.fileInfo.ext.toUpperCase() }),
            style: 'font-size: 12px; color: var(--text-accent); text-align: center; margin-bottom: 8px;'
          })
        : null;

      convertBufferToPreviewUrl(this.fileInfo.arrayBuffer, this.fileInfo.ext, this.plugin)
        .then((url) => {
          img.src = url;
          if (loadingTip) loadingTip.remove();
        })
        .catch(() => {
          if (loadingTip) loadingTip.setText(this.t('destTranscodeFail'));
        });
    }

    contentEl.createDiv({
      text: this.t('destTypeSize', { ext: this.fileInfo.ext.toUpperCase(), size: formatBytes(this.fileInfo.size) }),
      style: 'font-size: 12px; color: var(--text-muted); margin-bottom: 12px; text-align: center;'
    });

    // Filename input
    const nameBox = contentEl.createDiv({ cls: 'fm-section-box' });
    nameBox.createDiv({
      text: this.t('destFilenameLabel', { ext: this.fileInfo.ext }),
      cls: 'fm-section-title'
    });
    const nameInput = nameBox.createEl('input', {
      type: 'text',
      value: this.fileInfo.defaultBaseName,
      style: 'width: 100%; padding: 8px 10px; font-size: 14px;'
    });

    const triggerExecute = (target) => {
      const cleanBase = sanitizeCleanBaseName(nameInput.value, this.fileInfo.defaultBaseName);
      this.finalFilename = `${cleanBase}.${this.fileInfo.ext}`;
      this.targetLocation = target;
      this.step = 'executing';
      this.render();
      this.runExecution();
    };

    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        triggerExecute(this.options.askLocation ? 'remote' : this.options.fixedLocation);
      }
    });

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const cancelBtn = btnRow.createEl('button', { text: this.t('btnCancel') });
    cancelBtn.onclick = () => {
      this.isDone = true;
      this.close();
      if (this.callback) this.callback({ target: null });
    };

    if (this.options.askLocation) {
      const localBtn = btnRow.createEl('button', { text: this.t('destSaveLocal') });
      localBtn.onclick = () => triggerExecute('local');

      const remoteBtn = btnRow.createEl('button', {
        text: this.t('destSaveRemote'),
        cls: 'mod-cta'
      });
      remoteBtn.onclick = () => triggerExecute('remote');
    } else {
      const label =
        this.options.fixedLocation === 'local'
          ? this.t('destSaveLocal')
          : this.t('destSaveRemote');
      const okBtn = btnRow.createEl('button', { text: label, cls: 'mod-cta' });
      okBtn.onclick = () => triggerExecute(this.options.fixedLocation);
    }

    setTimeout(() => {
      nameInput.focus();
      nameInput.select();
    }, 30);
  }

  renderExecutingStep() {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: this.t('destProcessingTitle') });

    const infoBox = contentEl.createDiv({ cls: 'fm-section-box', style: 'margin-bottom: 14px;' });
    infoBox.createDiv({
      text: `📄 ${this.finalFilename}  (${formatBytes(this.fileInfo.size)})`,
      style: 'font-weight: 600; margin-bottom: 10px;'
    });

    const progressWrap = infoBox.createDiv({ cls: 'fm-progress-wrap' });
    this.progressBar = progressWrap.createDiv({ cls: 'fm-progress-bar', style: 'width: 15%;' });

    this.statusLabel = infoBox.createDiv({
      text: this.targetLocation === 'remote'
        ? this.t('destProbeChecking')
        : this.t('destSavingLocal'),
      style: 'font-size: 12px; color: var(--text-accent); margin-top: 8px;'
    });
  }

  async runExecution() {
    try {
      const activeFile = this.options.activeFile || this.app.workspace.getActiveFile();
      const editor = this.options.editor;

      if (this.targetLocation === 'local') {
        if (this.progressBar) this.progressBar.style.width = '40%';
        if (this.statusLabel) this.statusLabel.setText(this.t('destSavingLocal'));

        const sourcePath = activeFile ? activeFile.path : '';
        const localPath = await this.app.fileManager.getAvailablePathForAttachment(
          this.finalFilename,
          sourcePath
        );

        if (this.progressBar) this.progressBar.style.width = '75%';
        const createdFile = await this.app.vault.createBinary(localPath, this.fileInfo.arrayBuffer);
        const mdLink = this.app.fileManager.generateMarkdownLink(createdFile, sourcePath);

        if (editor) {
          editor.replaceSelection(mdLink + '\n');
        }

        if (this.progressBar) this.progressBar.style.width = '100%';
        this.result = {
          success: true,
          target: 'local',
          localPath: createdFile.path,
          mdLink,
          inserted: !!editor
        };
      } else {
        // Remote upload with Instant SHA-256 Probe check
        if (this.progressBar) this.progressBar.style.width = '25%';
        if (this.statusLabel) this.statusLabel.setText(this.t('destProbeChecking'));

        const sha256 = this.fileInfo.sha256 || computeSha256Hex(this.fileInfo.arrayBuffer);
        let res = null;

        // 1. Probe remote server
        const probed = await this.plugin.probeRemoteSha256(sha256);
        if (probed && probed.exists) {
          res = Object.assign({}, probed, { isInstant: true });
          if (this.progressBar) this.progressBar.style.width = '100%';
          if (this.statusLabel) this.statusLabel.setText(this.t('destInstantBadge'));
        } else {
          // 2. Stream upload to server
          if (this.progressBar) this.progressBar.style.width = '55%';
          if (this.statusLabel) this.statusLabel.setText(this.t('destUploadingRemote'));

          res = await this.plugin.uploadBufferToServer(
            this.fileInfo.arrayBuffer,
            this.finalFilename,
            this.fileInfo.mimeType || 'application/octet-stream',
            false,
            { skipProbe: true }
          );
          if (this.progressBar) this.progressBar.style.width = '100%';
        }

        const useOpt =
          this.plugin.settings.insertOptimizedLinkOnUpload &&
          res.optimizationEnabled !== false &&
          res.category === 'image' &&
          res.pubUrl;
        const finalMarkdown = useOpt ? `![](${res.pubUrl})` : res.markdown;

        if (editor) {
          editor.replaceSelection(finalMarkdown + '\n');
        }

        this.result = {
          success: true,
          target: 'remote',
          res,
          finalMarkdown,
          isInstant: !!res.isInstant,
          inserted: !!editor
        };
      }
    } catch (err) {
      this.result = {
        success: false,
        error: err.message || String(err)
      };
    }

    if (this.callback) {
      this.callback({ target: this.targetLocation, finalFilename: this.finalFilename, result: this.result });
    }

    this.step = 'result';
    this.render();
  }

  renderResultStep() {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: this.t('destResultTitle') });

    if (!this.result.success) {
      const errBanner = contentEl.createDiv({ cls: 'fm-result-banner fm-result-banner-error' });
      errBanner.createDiv({
        cls: 'fm-result-banner-title',
        text: this.t('destProcessingError', { err: this.result.error })
      });
      const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
      const closeBtn = btnRow.createEl('button', { text: this.t('destBtnDone'), cls: 'mod-cta' });
      closeBtn.onclick = () => {
        this.isDone = true;
        this.close();
      };
      return;
    }

    if (this.result.target === 'remote') {
      const isInstant = this.result.isInstant;
      const banner = contentEl.createDiv({
        cls: `fm-result-banner ${isInstant ? 'fm-result-banner-instant' : 'fm-result-banner-success'}`
      });
      banner.createDiv({
        cls: 'fm-result-banner-title',
        text: isInstant ? this.t('destInstantBadge') : this.t('destSuccessBadge')
      });
      banner.createDiv({
        cls: 'fm-result-banner-desc',
        text: isInstant ? this.t('destInstantDesc') : this.t('destSuccessDesc')
      });

      const detailsBox = contentEl.createDiv({ cls: 'fm-section-box' });
      detailsBox.createDiv({
        text: `📄 ${this.finalFilename}  |  ${formatBytes(this.fileInfo.size)}`,
        style: 'font-weight: 600; margin-bottom: 12px; color: var(--text-normal);'
      });

      const addCopyRow = (label, val) => {
        if (!val) return;
        detailsBox.createDiv({ cls: 'fm-copy-row-label', text: label });
        const row = detailsBox.createDiv({ cls: 'fm-copy-row' });
        row.createEl('input', { type: 'text', value: val, attr: { readonly: true } });
        const copyBtn = row.createEl('button', { text: this.t('destBtnCopy'), cls: 'fm-mini-btn' });
        copyBtn.onclick = async () => {
          await navigator.clipboard.writeText(val);
          copyBtn.setText(this.t('destBtnCopied'));
          setTimeout(() => {
            if (copyBtn && copyBtn.isConnected) copyBtn.setText(this.t('destBtnCopy'));
          }, 1800);
        };
      };

      addCopyRow(this.t('destLabelRawUrl'), this.result.res?.rawUrl);
      if (this.result.res?.pubUrl) {
        addCopyRow(this.t('destLabelPubUrl'), this.result.res.pubUrl);
      }
      addCopyRow(this.t('destLabelMarkdown'), this.result.finalMarkdown);

      if (this.result.inserted) {
        detailsBox.createDiv({
          cls: 'fm-result-inserted-tip',
          text: this.t('destInsertedNotice')
        });
      }
    } else {
      // Local result
      const banner = contentEl.createDiv({ cls: 'fm-result-banner fm-result-banner-local' });
      banner.createDiv({ cls: 'fm-result-banner-title', text: this.t('destLocalBadge') });
      banner.createDiv({ cls: 'fm-result-banner-desc', text: this.t('destLocalDesc') });

      const detailsBox = contentEl.createDiv({ cls: 'fm-section-box' });
      detailsBox.createDiv({
        text: `📄 ${this.finalFilename}  |  ${formatBytes(this.fileInfo.size)}`,
        style: 'font-weight: 600; margin-bottom: 12px; color: var(--text-normal);'
      });

      const addCopyRow = (label, val) => {
        if (!val) return;
        detailsBox.createDiv({ cls: 'fm-copy-row-label', text: label });
        const row = detailsBox.createDiv({ cls: 'fm-copy-row' });
        row.createEl('input', { type: 'text', value: val, attr: { readonly: true } });
        const copyBtn = row.createEl('button', { text: this.t('destBtnCopy'), cls: 'fm-mini-btn' });
        copyBtn.onclick = async () => {
          await navigator.clipboard.writeText(val);
          copyBtn.setText(this.t('destBtnCopied'));
          setTimeout(() => {
            if (copyBtn && copyBtn.isConnected) copyBtn.setText(this.t('destBtnCopy'));
          }, 1800);
        };
      };

      addCopyRow(this.t('destLabelLocalPath'), this.result.localPath);
      addCopyRow(this.t('destLabelMarkdown'), this.result.mdLink);

      if (this.result.inserted) {
        detailsBox.createDiv({
          cls: 'fm-result-inserted-tip',
          text: this.t('destInsertedNotice')
        });
      }
    }

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const doneBtn = btnRow.createEl('button', { text: this.t('destBtnDone'), cls: 'mod-cta' });
    doneBtn.onclick = () => {
      this.isDone = true;
      this.close();
    };
  }

  onClose() {
    if (!this.isDone && this.callback) {
      this.callback({ target: null });
    }
    this.contentEl.empty();
  }
}

/**
 * Modal to execute active note operations with real-time progress bar & in-window result
 */
class ActiveNoteActionModal extends Modal {
  constructor(app, plugin, targetFile, actionType = 'migrate') {
    super(app);
    this.plugin = plugin;
    this.targetFile = targetFile;
    this.actionType = actionType; // 'migrate' | 'download'
    this.step = 'running';
    this.result = null;
  }

  t(k, p) {
    return this.plugin ? this.plugin.t(k, p) : k;
  }

  async onOpen() {
    this.render();
    await this.execute();
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('fm-wizard-modal');

    const titleKey = this.actionType === 'migrate' ? 'activeNoteMigrateTitle' : 'activeNoteDownloadTitle';
    contentEl.createEl('h3', { text: this.t(titleKey) });

    contentEl.createDiv({
      text: `📄 ${this.targetFile.path}`,
      style: 'font-size: 12px; color: var(--text-muted); margin-bottom: 12px;'
    });

    if (this.step === 'running') {
      const box = contentEl.createDiv({ cls: 'fm-section-box' });
      this.statusText = box.createDiv({
        text: this.t('activeNoteScanning'),
        style: 'font-size: 13px; color: var(--text-accent); margin-bottom: 8px;'
      });
      const wrap = box.createDiv({ cls: 'fm-progress-wrap' });
      this.progressBar = wrap.createDiv({ cls: 'fm-progress-bar', style: 'width: 10%;' });
    } else if (this.step === 'result') {
      if (!this.result.success) {
        const errBanner = contentEl.createDiv({ cls: 'fm-result-banner fm-result-banner-error' });
        errBanner.createDiv({ cls: 'fm-result-banner-title', text: '❌ ' + this.result.message });
      } else if (this.result.count === 0) {
        const emptyBanner = contentEl.createDiv({ cls: 'fm-section-box', style: 'text-align: center; padding: 24px 16px;' });
        emptyBanner.createDiv({
          text: this.actionType === 'migrate' ? this.t('activeNoteNoLocal') : this.t('activeNoteNoRemote'),
          style: 'font-size: 14px; color: var(--text-muted);'
        });
      } else {
        const banner = contentEl.createDiv({ cls: 'fm-result-banner fm-result-banner-success' });
        banner.createDiv({
          cls: 'fm-result-banner-title',
          text: this.actionType === 'migrate' ? this.t('activeNoteMigrateComplete') : this.t('activeNoteDownloadComplete')
        });
        banner.createDiv({
          cls: 'fm-result-banner-desc',
          text: this.actionType === 'migrate'
            ? this.t('activeNoteMigrateDoneDesc', { count: this.result.count })
            : this.t('activeNoteDownloadDoneDesc', { count: this.result.count })
        });
      }

      const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
      const doneBtn = btnRow.createEl('button', { text: this.t('destBtnDone'), cls: 'mod-cta' });
      doneBtn.onclick = () => this.close();
    }
  }

  async execute() {
    try {
      if (this.actionType === 'migrate') {
        const count = await this.plugin.executeMigrateNoteDirect(
          this.targetFile,
          (cur, total, name) => {
            if (this.progressBar) {
              const pct = Math.round((cur / Math.max(1, total)) * 100);
              this.progressBar.style.width = `${pct}%`;
            }
            if (this.statusText) {
              this.statusText.setText(this.t('activeNoteProcessing', { current: cur, total, name }));
            }
          }
        );
        this.result = { success: true, count };
      } else {
        const count = await this.plugin.executeDownloadNoteDirect(
          this.targetFile,
          (cur, total, name) => {
            if (this.progressBar) {
              const pct = Math.round((cur / Math.max(1, total)) * 100);
              this.progressBar.style.width = `${pct}%`;
            }
            if (this.statusText) {
              this.statusText.setText(this.t('activeNoteProcessing', { current: cur, total, name }));
            }
          }
        );
        this.result = { success: true, count };
      }
    } catch (err) {
      this.result = { success: false, message: err.message };
    }
    this.step = 'result';
    this.render();
  }

  onClose() {
    this.contentEl.empty();
  }
}

/**
 * Wizard 1: Orphan Finder Wizard
 * Step 1: Select location scope and file types (with real-time scan progress + cancel button)
 * Step 2: Display results, export report, and safely clean selected items
 */
class OrphanWizardModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.step = 1;
    this.activeProgress = null;
    const isRemote = Boolean(plugin?.isRemoteServerReady?.());
    this.options = {
      scanLocal: true,
      scanRemote: isRemote,
      typeNote: false,
      typeImage: true,
      typeAudio: true,
      typeOther: true
    };
    this.results = [];
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
    const header = contentEl.createDiv({ cls: 'fm-step-header' });
    header.createSpan({ text: t('stepOf', { current: 1, total: 2 }), cls: 'fm-step-badge' });
    header.createEl('h3', { text: t('orphanStep1Title'), cls: 'fm-step-title' });

    contentEl.createEl('p', {
      text: t('orphanStep1Desc'),
      style: 'font-size: 13px; color: var(--text-muted); margin-bottom: 14px;'
    });

    if (this.plugin?.isRemoteServerReady?.()) {
      const locBox = contentEl.createDiv({ cls: 'fm-section-box' });
      locBox.createDiv({ text: t('orphanLocScope'), cls: 'fm-section-title' });
      this.createCheckbox(locBox, t('orphanScanLocal'), 'scanLocal');
      this.createCheckbox(locBox, t('orphanScanRemote'), 'scanRemote');
    }

    const typeBox = contentEl.createDiv({ cls: 'fm-section-box' });
    typeBox.createDiv({ text: t('orphanTypeScope'), cls: 'fm-section-title' });
    this.createCheckbox(typeBox, t('orphanTypeNote'), 'typeNote');
    this.createCheckbox(typeBox, t('orphanTypeImage'), 'typeImage');
    this.createCheckbox(typeBox, t('orphanTypeAudio'), 'typeAudio');
    this.createCheckbox(typeBox, t('orphanTypeOther'), 'typeOther');

    const exclFolders = this.plugin.getExcludedLocalFolderList();
    const protInfo = contentEl.createDiv({
      cls: 'fm-section-box',
      style: 'font-size: 12px; color: var(--text-muted); padding: 10px 14px;'
    });
    const exclHint = exclFolders.length ? t('orphanExclHint', { folders: exclFolders.join(', ') }) : '';
    protInfo.createDiv({
      text: t('orphanProtActive', { excl: exclHint })
    });

    const progressWidget = createScanProgressWidget(contentEl, this.plugin);
    this.activeProgress = progressWidget;

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const cancelBtn = btnRow.createEl('button', { text: t('btnCancel') });
    cancelBtn.onclick = () => this.close();

    const nextBtn = btnRow.createEl('button', { text: t('btnNext'), cls: 'mod-cta' });
    nextBtn.onclick = async () => {
      if (!this.options.scanLocal && !this.options.scanRemote) {
        new Notice(t('orphanLocRequired'));
        return;
      }
      if (!this.options.typeNote && !this.options.typeImage && !this.options.typeAudio && !this.options.typeOther) {
        new Notice(t('orphanTypeRequired'));
        return;
      }
      nextBtn.disabled = true;
      nextBtn.setText(t('orphanScanning'));
      progressWidget.show();
      try {
        this.results = await this.plugin.scanUnusedFiles(this.options, {
          signal: progressWidget.signal,
          onProgress: (cur, total, label) => progressWidget.update(cur, total, label)
        });
        this.step = 2;
        this.render();
      } catch (err) {
        progressWidget.hide();
        new Notice(err.message === 'SCAN_ABORTED' ? this.plugin.t('scanCancelled') : '❌ Scan failed: ' + err.message);
        nextBtn.disabled = false;
        nextBtn.setText(t('btnNext'));
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
    const t = (k, p) => this.plugin.t(k, p);
    const header = contentEl.createDiv({ cls: 'fm-step-header' });
    header.createSpan({ text: t('stepOf', { current: 2, total: 2 }), cls: 'fm-step-badge' });
    header.createEl('h3', { text: t('orphanStep2Title', { count: this.results.length }), cls: 'fm-step-title' });

    if (this.lastCleanSummary) {
      const banner = contentEl.createDiv({ cls: 'fm-result-banner fm-result-banner-success' });
      banner.createDiv({ cls: 'fm-result-banner-title', text: t('orphanResultTitle') });
      banner.createDiv({
        cls: 'fm-result-banner-desc',
        text: t('orphanResultDesc', {
          count: this.lastCleanSummary.total || 0,
          local: this.lastCleanSummary.local || 0,
          remote: this.lastCleanSummary.remote || 0
        })
      });
    }

    const toolbar = contentEl.createDiv({ cls: 'fm-toolbar-row' });
    const leftTools = toolbar.createDiv({ style: 'display:flex; gap:8px; align-items:center;' });
    const backBtn = leftTools.createEl('button', { text: t('btnBack') });
    backBtn.onclick = () => {
      this.step = 1;
      this.render();
    };

    const selectAllBtn = leftTools.createEl('button', { text: t('btnSelectAll') });
    selectAllBtn.onclick = () => {
      const allSelected = this.results.every((r) => r.selected);
      this.results.forEach((r) => { r.selected = !allSelected; });
      this.render();
    };

    const exportBtn = toolbar.createEl('button', {
      text: t('btnExportReport'),
      cls: 'mod-cta'
    });
    exportBtn.onclick = async () => {
      await this.plugin.exportOrphanReportToRoot(this.results);
    };

    if (this.results.length === 0) {
      contentEl.createDiv({
        cls: 'fm-section-box',
        text: t('orphanNoneFound'),
        style: 'text-align: center; padding: 36px 20px;'
      });
      return;
    }

    const listEl = contentEl.createDiv({ cls: 'fm-scroll-list' });
    for (const item of this.results) {
      const row = listEl.createDiv({ cls: 'fm-list-item' });
      const left = row.createDiv({
        style: 'display:flex; align-items:center; gap:10px; flex:1; overflow:hidden;'
      });

      const cb = left.createEl('input', { type: 'checkbox', style: 'cursor:pointer;' });
      cb.checked = item.selected;
      cb.onchange = () => {
        item.selected = cb.checked;
      };

      renderItemVisualThumb(left, item, this.plugin);

      const infoCol = left.createDiv({ style: 'overflow:hidden; flex:1;' });
      const topLine = infoCol.createDiv({ style: 'display:flex; align-items:center; gap:6px;' });
      topLine.createSpan({
        text: item.source === 'local' ? '💻 Local' : '☁️ Remote',
        cls: `fm-tag ${item.source === 'local' ? 'fm-tag-local' : 'fm-tag-remote'}`
      });
      topLine.createSpan({
        text: item.displayPath,
        style: 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:500;'
      });

      const rightBox = row.createDiv({
        style: 'display:flex; align-items:center; gap:8px; flex-shrink:0;'
      });
      rightBox.createSpan({
        text: formatBytes(item.size),
        style: 'color: var(--text-muted); font-size: 12px;'
      });

      if (item.source === 'remote') {
        const lockBtn = rightBox.createEl('button', {
          text: t('lockBtnText'),
          cls: 'fm-mini-btn',
          attr: { title: t('lockBtnTitle') }
        });
        lockBtn.onclick = async () => {
          try {
            await this.plugin.toggleRemoteFileLock(item.rawObj.year, item.rawObj.month, item.rawObj.filename, true);
            new Notice(this.plugin.t('noticeProtectedRemote', { name: item.name }));
            this.results = this.results.filter((r) => r.id !== item.id);
            this.render();
          } catch (err) {
            new Notice(this.plugin.t('noticeLockFailed', { err: err.message }));
          }
        };
      }
    }

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const cleanBtn = btnRow.createEl('button', {
      text: t('orphanDeleteSelected', { count: this.results.filter((r) => r.selected).length }),
      cls: 'mod-warning'
    });
    cleanBtn.onclick = async () => {
      const selected = this.results.filter((r) => r.selected);
      if (selected.length === 0) {
        new Notice(this.plugin.t('orphanSelectRequired'));
        return;
      }
      await this.plugin.cleanSelectedOrphans(selected, (summary) => {
        const removedIds = new Set(selected.map((s) => s.id));
        this.results = this.results.filter((r) => !removedIds.has(r.id));
        this.lastCleanSummary = summary;
        this.render();
      });
    };
  }

  onClose() {
    if (this.activeProgress) this.activeProgress.abort();
    this.contentEl.empty();
  }
}

/**
 * Wizard 2: Duplicate Finder Wizard
 * Step 1: Select duplicate comparison scope (with real-time scan progress + cancel button)
 * Step 2: Display duplicate groups, thumbnail previews, note references, and resolution strategies
 */
class DuplicateWizardModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.step = 1;
    this.activeProgress = null;
    const isRemote = Boolean(plugin?.isRemoteServerReady?.());
    this.scope = isRemote ? 'both' : 'local';
    this.fileTypes = {
      typeImage: true,
      typeAudio: true,
      typeOther: true,
      typeNote: false
    };
    this.processMode = 'auto';
    this.groups = [];
    this.scanStats = { localScanned: 0, remoteScanned: 0, remoteError: null };
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
    } else if (this.step === 2) {
      this.renderStep2(contentEl);
    } else if (this.step === 3) {
      this.renderStep3(contentEl);
    }
  }

  renderStep1(contentEl) {
    const t = (k, p) => this.plugin.t(k, p);
    const header = contentEl.createDiv({ cls: 'fm-step-header' });
    header.createSpan({ text: t('stepOf', { current: 1, total: 2 }), cls: 'fm-step-badge' });
    header.createEl('h3', { text: t('dupStep1Title'), cls: 'fm-step-title' });

    contentEl.createEl('p', {
      text: t('dupStep1Desc'),
      style: 'font-size: 13px; color: var(--text-muted); margin-bottom: 14px;'
    });

    const isRemote = Boolean(this.plugin?.isRemoteServerReady?.());
    if (isRemote) {
      const scopeBox = contentEl.createDiv({ cls: 'fm-section-box' });
      scopeBox.createDiv({ text: t('dupLocScope'), cls: 'fm-section-title' });

      const scopes = [
        { key: 'both', label: t('dupCompareCross') },
        { key: 'local', label: t('dupCompareLocal') },
        { key: 'remote', label: '☁️ Remote Server Only' }
      ];

      for (const s of scopes) {
        const row = scopeBox.createEl('label', { cls: 'fm-check-row' });
        const radio = row.createEl('input', { type: 'radio', attr: { name: 'fm_dup_scope' } });
        radio.checked = this.scope === s.key;
        radio.onchange = () => {
          this.scope = s.key;
        };
        row.createSpan({ text: s.label });
      }
    }

    const typeBox = contentEl.createDiv({ cls: 'fm-section-box' });
    typeBox.createDiv({ text: t('dupTypeScope'), cls: 'fm-section-title' });
    this.createTypeCheckbox(typeBox, t('dupTypeImage'), 'typeImage');
    this.createTypeCheckbox(typeBox, t('dupTypeAudio'), 'typeAudio');
    this.createTypeCheckbox(typeBox, t('dupTypeOther'), 'typeOther');
    this.createTypeCheckbox(typeBox, t('dupTypeNote'), 'typeNote');

    const exclFolders = this.plugin.getExcludedLocalFolderList();
    const protBox = contentEl.createDiv({
      cls: 'fm-section-box',
      style: 'font-size: 12px; color: var(--text-muted); padding: 10px 14px;'
    });
    protBox.createDiv({
      text: `🛡️ Protection Rules: Local excluded folders (${exclFolders.join(', ') || 'none'}) are skipped. Remote files with "🔒 Protected Lock" are prioritized as keep targets and never deleted.`
    });

    const progressWidget = createScanProgressWidget(contentEl, this.plugin);
    this.activeProgress = progressWidget;

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const cancelBtn = btnRow.createEl('button', { text: t('btnCancel') });
    cancelBtn.onclick = () => this.close();

    const nextBtn = btnRow.createEl('button', { text: t('btnNext'), cls: 'mod-cta' });
    nextBtn.onclick = async () => {
      if (
        !this.fileTypes.typeImage &&
        !this.fileTypes.typeAudio &&
        !this.fileTypes.typeOther &&
        !this.fileTypes.typeNote
      ) {
        new Notice(this.plugin.t('dupSelectTypeRequired'));
        return;
      }
      nextBtn.disabled = true;
      nextBtn.setText(t('dupComparing'));
      progressWidget.show();
      try {
        const res = await this.plugin.scanDuplicateGroups(this.scope, this.fileTypes, {
          signal: progressWidget.signal,
          onProgress: (cur, total, label) => progressWidget.update(cur, total, label)
        });
        this.groups = res.groups;
        this.scanStats = res.stats;
        this.applyProcessMode('auto');
        this.step = 2;
        this.render();
      } catch (err) {
        progressWidget.hide();
        new Notice(err.message === 'SCAN_ABORTED' ? this.plugin.t('scanCancelled') : '❌ Comparison failed: ' + err.message);
        nextBtn.disabled = false;
        nextBtn.setText(t('btnNext'));
      }
    };
  }

  createTypeCheckbox(parent, labelText, key) {
    const label = parent.createEl('label', { cls: 'fm-check-row' });
    const cb = label.createEl('input', { type: 'checkbox' });
    cb.checked = Boolean(this.fileTypes[key]);
    cb.onchange = () => {
      this.fileTypes[key] = cb.checked;
    };
    label.createSpan({ text: labelText });
  }

  applyProcessMode(mode) {
    this.processMode = mode;
    for (const grp of this.groups) {
      const lockedItem = grp.items.find((i) => i.locked);
      if (lockedItem) {
        grp.keepId = lockedItem.id;
        continue;
      }

      if (mode === 'prefer-remote') {
        const remoteItem = grp.items.find((i) => i.source === 'remote');
        grp.keepId = remoteItem ? remoteItem.id : grp.items[0].id;
      } else if (mode === 'prefer-local') {
        const localItem = grp.items.find((i) => i.source === 'local');
        grp.keepId = localItem ? localItem.id : grp.items[0].id;
      } else {
        const sorted = [...grp.items].sort((a, b) => {
          if (b.refNotes.length !== a.refNotes.length) return b.refNotes.length - a.refNotes.length;
          if (a.source !== b.source) return a.source === 'remote' ? -1 : 1;
          return 0;
        });
        grp.keepId = sorted[0].id;
      }
    }
  }

  renderStep2(contentEl) {
    const t = (k, p) => this.plugin.t(k, p);
    const totalDupes = this.groups.reduce((acc, g) => acc + Math.max(0, g.items.length - 1), 0);
    const header = contentEl.createDiv({ cls: 'fm-step-header' });
    header.createSpan({ text: t('stepOf', { current: 2, total: 2 }), cls: 'fm-step-badge' });
    header.createEl('h3', {
      text: t('dupStep2Title', { groups: this.groups.length, redundant: totalDupes }),
      cls: 'fm-step-title'
    });

    const toolbar = contentEl.createDiv({ cls: 'fm-toolbar-row' });
    const leftTools = toolbar.createDiv({ style: 'display:flex; gap:8px; align-items:center; flex-wrap:wrap;' });

    const backBtn = leftTools.createEl('button', { text: t('btnBack') });
    backBtn.onclick = () => {
      this.step = 1;
      this.render();
    };

    leftTools.createSpan({ text: 'Strategy:', style: 'font-size:13px; font-weight:600; margin-left:4px;' });
    const modeSelect = leftTools.createEl('select', { style: 'padding: 5px 8px; border-radius: 6px;' });
    const modeOptions = [
      { value: 'auto', label: '1. Auto-select item to keep (Recommended)' },
      { value: 'prefer-remote', label: '2. Replace local files with remote copies (Vault Slimming)' },
      { value: 'prefer-local', label: '3. Keep local files and remove remote duplicates' }
    ];
    for (const opt of modeOptions) {
      const o = modeSelect.createEl('option', { value: opt.value, text: opt.label });
      if (opt.value === this.processMode) o.selected = true;
    }
    modeSelect.onchange = () => {
      this.applyProcessMode(modeSelect.value);
      this.render();
    };

    const exportBtn = toolbar.createEl('button', {
      text: t('btnExportReport')
    });
    exportBtn.onclick = async () => {
      await this.plugin.exportDuplicateReportToRoot(this.groups);
    };

    if (this.scanStats?.remoteError) {
      contentEl.createDiv({
        cls: 'fm-section-box',
        text: `⚠️ Remote server could not be reached (${this.scanStats.remoteError}). Showing local vault comparison results only.`,
        style: 'font-size: 12px; color: #f59e0b; border-color: rgba(245, 158, 11, 0.4); padding: 10px 14px;'
      });
    }

    if (this.groups.length === 0) {
      contentEl.createDiv({
        cls: 'fm-section-box',
        text: t('dupNoneFound'),
        style: 'text-align: center; padding: 36px 20px;'
      });
      const emptyBtnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
      const closeBtn = emptyBtnRow.createEl('button', { text: t('closeBtn'), cls: 'mod-cta' });
      closeBtn.onclick = () => this.close();
      return;
    }

    const listEl = contentEl.createDiv({ cls: 'fm-scroll-list' });
    this.groups.forEach((grp, idx) => {
      const grpBox = listEl.createDiv({ cls: 'fm-dup-group' });
      const grpHead = grpBox.createDiv({ cls: 'fm-dup-group-header' });
      grpHead.createSpan({
        text: `Duplicate Group #${idx + 1} (SHA-256: ${grp.sha256.slice(0, 12)}... | Size: ${formatBytes(grp.size)})`
      });
      grpHead.createSpan({ text: 'Click thumbnail to inspect; click reference count to view notes' });

      for (const item of grp.items) {
        const isKeep = grp.keepId === item.id;
        const row = grpBox.createDiv({ cls: 'fm-list-item' });
        const left = row.createDiv({
          style: 'display:flex; align-items:center; gap:8px; flex:1; overflow:hidden;'
        });

        const radio = left.createEl('input', {
          type: 'radio',
          attr: { name: `dup_grp_${idx}` },
          style: 'cursor:pointer;'
        });
        radio.checked = isKeep;
        radio.onchange = () => {
          grp.keepId = item.id;
          this.render();
        };

        renderItemVisualThumb(left, item, this.plugin);

        left.createSpan({
          text: isKeep ? '✅ Keep' : item.locked ? '🔒 Protected' : '🗑️ Remove',
          style: `font-size:12px; font-weight:700; color:${isKeep ? '#10b981' : item.locked ? '#f59e0b' : '#ef4444'}; width:68px; flex-shrink:0;`
        });

        left.createSpan({
          text: item.source === 'local' ? '💻 Local' : '☁️ Remote',
          cls: `fm-tag ${item.source === 'local' ? 'fm-tag-local' : 'fm-tag-remote'}`
        });

        if (item.locked) {
          left.createSpan({
            text: '🔒 ' + (this.t ? this.t('tagLocked') : 'Locked'),
            cls: 'fm-tag fm-tag-lock'
          });
        }

        left.createSpan({
          text: item.displayPath,
          style: 'word-break:break-all; cursor:pointer;',
          attr: { title: t('dupDesignateKeepTitle') }
        }).onclick = () => {
          grp.keepId = item.id;
          this.render();
        };

        const rightBox = row.createDiv({
          style: 'display:flex; align-items:center; gap:6px; flex-shrink:0;'
        });

        const refBadge = rightBox.createSpan({
          text: t('migrateNoteRefs', { count: item.refNotes.length }),
          cls: 'fm-tag fm-tag-ref fm-clickable-badge',
          attr: { title: t('migrateInspectRefs') }
        });
        refBadge.onclick = (e) => {
          e.stopPropagation();
          new NoteRefsModal(this.app, item.name, item.refNotes, () => this.close(), this.plugin).open();
        };
      }
    });

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const execBtn = btnRow.createEl('button', {
      text: t('dupMergeRewrite', { count: totalDupes }),
      cls: 'mod-cta'
    });
    execBtn.onclick = async () => {
      await this.plugin.executeDuplicateMergeSafely(this.groups, (summary) => {
        this.step = 3;
        this.summary = summary;
        this.render();
      });
    };
  }

  renderStep3(contentEl) {
    const t = (k, p) => this.plugin.t(k, p);
    contentEl.createEl('h3', { text: t('dupResultTitle') });

    const banner = contentEl.createDiv({ cls: 'fm-result-banner fm-result-banner-success' });
    banner.createDiv({ cls: 'fm-result-banner-title', text: t('dupResultTitle') });
    banner.createDiv({
      cls: 'fm-result-banner-desc',
      text: t('dupResultDesc', {
        modified: this.summary?.modified || 0,
        local: this.summary?.local || 0,
        remote: this.summary?.remote || 0,
        skipped: this.summary?.skipped > 0 ? t('dupResultSkipped', { count: this.summary.skipped }) : ''
      })
    });

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const doneBtn = btnRow.createEl('button', { text: t('destBtnDone'), cls: 'mod-cta' });
    doneBtn.onclick = () => this.close();
  }

  onClose() {
    if (this.activeProgress) this.activeProgress.abort();
    this.contentEl.empty();
  }
}

/**
 * Wizard 3: Batch Cloud Migration Wizard
 * Step 1: Select migration folder scope, attachment types, and trash policy (with real-time scan progress + cancel button)
 * Step 2: Preview list, progress bar, upload, and zero-broken-link safe rewrite
 */
class BatchMigrateWizardModal extends Modal {
  constructor(app, plugin, initialFolder = '') {
    super(app);
    this.plugin = plugin;
    this.step = 1;
    this.activeProgress = null;
    this.options = {
      folderPrefix: initialFolder || '',
      typeImage: true,
      typeAudio: true,
      typeOther: true,
      uploadToProtected: false,
      deleteLocalAfter: plugin.settings.deleteLocalAfterMigrate
    };
    this.items = [];
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
    } else if (this.step === 2) {
      this.renderStep2(contentEl);
    } else if (this.step === 3) {
      this.renderStep3(contentEl);
    }
  }

  renderStep1(contentEl) {
    const t = (k, p) => this.plugin.t(k, p);
    const header = contentEl.createDiv({ cls: 'fm-step-header' });
    header.createSpan({ text: t('stepOf', { current: 1, total: 2 }), cls: 'fm-step-badge' });
    header.createEl('h3', { text: t('migrateStep1Title'), cls: 'fm-step-title' });

    contentEl.createEl('p', {
      text: t('migrateStep1Desc'),
      style: 'font-size: 13px; color: var(--text-muted); margin-bottom: 14px;'
    });

    const folderBox = contentEl.createDiv({ cls: 'fm-section-box' });
    folderBox.createDiv({ text: t('migrateFolderScope'), cls: 'fm-section-title' });
    const folderSelect = folderBox.createEl('select', { style: 'width:100%; padding:8px 10px; border-radius:6px;' });
    folderSelect.createEl('option', {
      value: '',
      text: t('migrateEntireVault')
    });

    const allFolders = this.plugin.getAllVaultFolderPaths();
    for (const fp of allFolders) {
      const opt = folderSelect.createEl('option', { value: fp, text: `📁 ${fp}/` });
      if (fp === this.options.folderPrefix) opt.selected = true;
    }
    folderSelect.onchange = () => {
      this.options.folderPrefix = folderSelect.value;
    };

    const typeBox = contentEl.createDiv({ cls: 'fm-section-box' });
    typeBox.createDiv({ text: t('migrateTypeScope'), cls: 'fm-section-title' });
    this.createCheck(typeBox, t('migrateTypeImage'), 'typeImage');
    this.createCheck(typeBox, t('migrateTypeAudio'), 'typeAudio');
    this.createCheck(typeBox, t('migrateTypeOther'), 'typeOther');

    const policyBox = contentEl.createDiv({ cls: 'fm-section-box' });
    policyBox.createDiv({ text: t('migratePolicyTitle'), cls: 'fm-section-title' });
    this.createCheck(
      policyBox,
      t('migrateDeleteLocal'),
      'deleteLocalAfter'
    );

    const progressWidget = createScanProgressWidget(contentEl, this.plugin);
    this.activeProgress = progressWidget;

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const cancelBtn = btnRow.createEl('button', { text: t('btnCancel') });
    cancelBtn.onclick = () => this.close();

    const nextBtn = btnRow.createEl('button', { text: t('migrateNextPreview'), cls: 'mod-cta' });
    nextBtn.onclick = async () => {
      if (!this.options.typeImage && !this.options.typeAudio && !this.options.typeOther) {
        new Notice(t('migrateSelectTypeNotice'));
        return;
      }
      nextBtn.disabled = true;
      nextBtn.setText(t('migrateScanning'));
      progressWidget.show();
      try {
        this.items = await this.plugin.scanLocalAttachmentsForBatchMigrate(this.options, {
          signal: progressWidget.signal,
          onProgress: (cur, total, label) => progressWidget.update(cur, total, label)
        });
        this.step = 2;
        this.render();
      } catch (err) {
        progressWidget.hide();
        new Notice(err.message === 'SCAN_ABORTED' ? this.plugin.t('scanCancelled') : '❌ Scan failed: ' + err.message);
        nextBtn.disabled = false;
        nextBtn.setText(t('migrateNextPreview'));
      }
    };
  }

  createCheck(parent, labelText, key) {
    const label = parent.createEl('label', { cls: 'fm-check-row' });
    const cb = label.createEl('input', { type: 'checkbox' });
    cb.checked = Boolean(this.options[key]);
    cb.onchange = () => {
      this.options[key] = cb.checked;
    };
    label.createSpan({ text: labelText });
  }

  renderStep2(contentEl) {
    const t = (k, p) => this.plugin.t(k, p);
    const header = contentEl.createDiv({ cls: 'fm-step-header' });
    header.createSpan({ text: t('stepOf', { current: 2, total: 2 }), cls: 'fm-step-badge' });
    header.createEl('h3', {
      text: t('migrateStep2Title', { count: this.items.length }),
      cls: 'fm-step-title'
    });

    const toolbar = contentEl.createDiv({ cls: 'fm-toolbar-row' });
    const leftTools = toolbar.createDiv({ style: 'display:flex; gap:8px; align-items:center;' });
    const backBtn = leftTools.createEl('button', { text: t('btnBack') });
    backBtn.onclick = () => {
      this.step = 1;
      this.render();
    };

    const selectAllBtn = leftTools.createEl('button', { text: t('btnSelectAll') });
    selectAllBtn.onclick = () => {
      const allSelected = this.items.every((i) => i.selected);
      this.items.forEach((i) => { i.selected = !allSelected; });
      this.render();
    };

    const onlyRefBtn = leftTools.createEl('button', { text: t('migrateSelectOnlyRef') });
    onlyRefBtn.onclick = () => {
      this.items.forEach((i) => { i.selected = i.refNotes.length > 0; });
      this.render();
    };

    if (this.items.length === 0) {
      contentEl.createDiv({
        cls: 'fm-section-box',
        text: t('migrateNoneFound'),
        style: 'text-align: center; padding: 36px 20px;'
      });
      return;
    }

    const listEl = contentEl.createDiv({ cls: 'fm-scroll-list' });
    for (const item of this.items) {
      const row = listEl.createDiv({ cls: 'fm-list-item' });
      const left = row.createDiv({
        style: 'display:flex; align-items:center; gap:10px; flex:1; overflow:hidden;'
      });
      const cb = left.createEl('input', { type: 'checkbox', style: 'cursor:pointer;' });
      cb.checked = item.selected;
      cb.onchange = () => {
        item.selected = cb.checked;
      };

      renderItemVisualThumb(left, item, this.plugin);

      left.createSpan({
        text: item.displayPath,
        style: 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:500;'
      });

      const rightBox = row.createDiv({
        style: 'display:flex; align-items:center; gap:8px; flex-shrink:0;'
      });
      rightBox.createSpan({
        text: formatBytes(item.size),
        style: 'color: var(--text-muted); font-size: 12px;'
      });

      const refBadge = rightBox.createSpan({
        text: t('migrateNoteRefs', { count: item.refNotes.length }),
        cls: 'fm-tag fm-tag-ref fm-clickable-badge',
        attr: { title: t('migrateInspectRefs') }
      });
      refBadge.onclick = (e) => {
        e.stopPropagation();
        new NoteRefsModal(this.app, item.name, item.refNotes, () => this.close(), this.plugin).open();
      };
    }

    const progressBox = contentEl.createDiv({ style: 'display:none; margin-bottom:10px;' });
    const progressText = progressBox.createDiv({ style: 'font-size:12px; color:var(--text-accent);' });
    const progressWrap = progressBox.createDiv({ cls: 'fm-progress-wrap' });
    const progressBar = progressWrap.createDiv({ cls: 'fm-progress-bar' });

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const runBtn = btnRow.createEl('button', {
      text: t('migrateStart', { count: this.items.filter((i) => i.selected).length }),
      cls: 'mod-cta'
    });
    runBtn.onclick = async () => {
      const selected = this.items.filter((i) => i.selected);
      if (selected.length === 0) {
        new Notice(t('migrateSelectNotice'));
        return;
      }
      runBtn.disabled = true;
      backBtn.disabled = true;
      progressBox.style.display = 'block';

      await this.plugin.executeBatchMigrateSafely(
        selected,
        this.options,
        (cur, total, name) => {
          const pct = Math.round((cur / Math.max(1, total)) * 100);
          progressBar.style.width = `${pct}%`;
          progressText.setText(t('migrateProgress', { current: cur, total, name }));
        },
        (summary) => {
          this.step = 3;
          this.summary = summary;
          this.render();
        }
      );
    };
  }

  renderStep3(contentEl) {
    const t = (k, p) => this.plugin.t(k, p);
    contentEl.createEl('h3', { text: t('batchResultTitle') });

    const banner = contentEl.createDiv({ cls: 'fm-result-banner fm-result-banner-success' });
    banner.createDiv({ cls: 'fm-result-banner-title', text: t('batchResultTitle') });
    banner.createDiv({
      cls: 'fm-result-banner-desc',
      text: t('batchResultDesc', {
        count: this.summary?.count || 0,
        docs: this.summary?.docs || 0,
        trashed: this.summary?.trashed ? t('noticeBatchMigrateTrashedPart', { trashed: this.summary.trashed }) : ''
      })
    });

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const doneBtn = btnRow.createEl('button', { text: t('destBtnDone'), cls: 'mod-cta' });
    doneBtn.onclick = () => this.close();
  }

  onClose() {
    if (this.activeProgress) this.activeProgress.abort();
    this.contentEl.empty();
  }
}

/**
 * Vault Link Health Check Modal (404 & Dangling WikiLink Finder)
 */
class HealthCheckModal extends Modal {
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
    const header = contentEl.createDiv({ cls: 'fm-step-header' });
    header.createSpan({ text: t('stepOf', { current: 1, total: 2 }), cls: 'fm-step-badge' });
    header.createEl('h3', { text: t('healthStep1Title'), cls: 'fm-step-title' });

    contentEl.createEl('p', {
      text: t('healthStep1Desc'),
      style: 'font-size: 13px; color: var(--text-muted); margin-bottom: 14px;'
    });

    const box = contentEl.createDiv({ cls: 'fm-section-box' });
    box.createDiv({ text: t('healthScopeTitle'), cls: 'fm-section-title' });

    this.createCheckbox(box, t('healthCheckWiki'), 'checkWikiLinks');
    this.createCheckbox(box, t('healthCheckLocal'), 'checkLocalMarkdown');
    if (this.plugin?.isRemoteServerReady?.()) {
      this.createCheckbox(box, t('healthCheckRemote'), 'checkRemote');
    }

    const noticeBox = contentEl.createDiv({
      cls: 'fm-section-box',
      style: 'font-size: 12px; color: var(--text-muted); padding: 10px 14px;'
    });
    noticeBox.createDiv({
      text: t('healthScopeHint')
    });

    const progressWidget = createScanProgressWidget(contentEl, this.plugin);
    this.activeProgress = progressWidget;

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const cancelBtn = btnRow.createEl('button', { text: t('btnCancel') });
    cancelBtn.onclick = () => this.close();

    const startBtn = btnRow.createEl('button', { text: t('healthStartScan'), cls: 'mod-cta' });
    startBtn.onclick = async () => {
      startBtn.disabled = true;
      startBtn.setText(t('healthScanning'));
      progressWidget.show();
      try {
        const scanResult = await this.plugin.scanVaultLinkHealth(this.options, {
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
    const t = (k, p) => this.plugin.t(k, p);
    const wikiIssues = this.issues.filter((i) => i.category === 'wikilink');
    const localIssues = this.issues.filter((i) => i.category === 'local');
    const remoteIssues = this.issues.filter((i) => i.category === 'remote');

    const header = contentEl.createDiv({ cls: 'fm-step-header' });
    header.createSpan({ text: t('stepOf', { current: 2, total: 2 }), cls: 'fm-step-badge' });
    header.createEl('h3', {
      text: t('healthStep2Title', { docs: this.totalDocsScanned, issues: this.issues.length }),
      cls: 'fm-step-title'
    });

    const statGrid = contentEl.createDiv({ cls: 'fm-health-stat-grid' });
    const addStat = (num, label, color) => {
      const card = statGrid.createDiv({ cls: 'fm-health-stat-card' });
      const numEl = card.createDiv({ cls: 'fm-health-stat-num', text: String(num) });
      if (color) numEl.style.color = color;
      card.createDiv({ cls: 'fm-health-stat-label', text: label });
    };
    addStat(this.totalDocsScanned, t('healthStatNotes'));
    addStat(wikiIssues.length, t('healthStatWiki'), wikiIssues.length > 0 ? '#ef4444' : undefined);
    addStat(localIssues.length, t('healthStatLocal'), localIssues.length > 0 ? '#f59e0b' : undefined);
    addStat(remoteIssues.length, t('healthStatRemote'), remoteIssues.length > 0 ? '#3b82f6' : undefined);

    const toolbar = contentEl.createDiv({ cls: 'fm-toolbar-row' });
    const leftTools = toolbar.createDiv({ style: 'display:flex; gap:8px; align-items:center;' });
    const backBtn = leftTools.createEl('button', { text: t('healthRescan') });
    backBtn.onclick = () => {
      this.step = 1;
      this.render();
    };

    const exportBtn = toolbar.createEl('button', {
      text: t('btnExportReport'),
      cls: 'mod-cta'
    });
    exportBtn.onclick = async () => {
      await this.plugin.exportHealthReportToRoot(this.issues, this.totalDocsScanned);
    };

    if (this.issues.length === 0) {
      contentEl.createDiv({
        cls: 'fm-section-box',
        text: t('healthNoneFound'),
        style: 'text-align: center; padding: 36px 20px; font-weight: 500;'
      });
      const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
      const closeBtn = btnRow.createEl('button', { text: t('closeBtn') });
      closeBtn.onclick = () => this.close();
      return;
    }

    const filterRow = contentEl.createDiv({
      style: 'display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:10px; flex-wrap:wrap;'
    });
    const chipBox = filterRow.createDiv({ style: 'display:flex; gap:6px;' });
    const createChip = (id, label, count) => {
      const chip = chipBox.createEl('button', {
        text: `${label} (${count})`,
        cls: this.activeFilter === id ? 'mod-cta' : ''
      });
      chip.onclick = () => {
        this.activeFilter = id;
        this.renderStep2(contentEl);
      };
    };

    createChip('all', t('healthFilterAll'), this.issues.length);
    createChip('wikilink', t('healthStatWiki'), wikiIssues.length);
    createChip('local', t('healthStatLocal'), localIssues.length);
    createChip('remote', t('healthStatRemote'), remoteIssues.length);

    const searchInput = filterRow.createEl('input', {
      type: 'search',
      placeholder: t('healthSearchPlaceholder'),
      value: this.searchQuery,
      style: 'padding: 4px 10px; border-radius: 6px; border: 1px solid var(--background-modifier-border); min-width: 180px;'
    });
    searchInput.oninput = (e) => {
      this.searchQuery = e.target.value.toLowerCase();
      this.renderIssueList(listEl);
    };

    const listEl = contentEl.createDiv({ cls: 'fm-scroll-list', style: 'max-height: 380px;' });
    this.renderIssueList(listEl);

    const bottomRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const closeBtn = bottomRow.createEl('button', { text: t('closeBtn') });
    closeBtn.onclick = () => this.close();
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
        style: 'text-align: center; padding: 24px;'
      });
      return;
    }

    for (const item of filtered) {
      const row = listEl.createDiv({ cls: 'fm-list-item' });
      const leftCol = row.createDiv({
        style: 'display:flex; flex-direction:column; gap:4px; flex:1; overflow:hidden;'
      });

      const topMeta = leftCol.createDiv({ style: 'display:flex; align-items:center; gap:6px;' });
      let tagCls = 'fm-tag-error';
      let tagLabel = '🔴 Broken Link';
      if (item.category === 'wikilink') {
        tagCls = 'fm-tag-error';
        tagLabel = item.type === 'wikilink-embed' ? t('healthTagWikiEmbed') : t('healthTagDanglingNote');
      } else if (item.category === 'local') {
        tagCls = 'fm-tag-warning';
        tagLabel = item.type === 'local-embed' ? t('healthTagMissingImage') : t('healthTagMissingFile');
      } else if (item.category === 'remote') {
        tagCls = 'fm-tag-info';
        tagLabel = t('healthTagRemote404');
      }

      topMeta.createSpan({ text: tagLabel, cls: `fm-tag ${tagCls}` });
      topMeta.createEl('code', { text: item.target, style: 'font-size: 12px; font-weight: 600;' });
      topMeta.createSpan({
        text: t('healthLine', { line: item.line }),
        style: 'font-size: 11px; color: var(--text-muted); margin-left: auto;'
      });

      const noteRef = leftCol.createDiv({
        style: 'font-size: 12px; color: var(--text-muted); display:flex; align-items:center; gap:4px;'
      });
      noteRef.createSpan({ text: t('healthInNote', { path: item.sourcePath }) });

      if (item.lineText) {
        leftCol.createDiv({
          text: item.lineText,
          cls: 'fm-health-context-quote'
        });
      }

      const openBtn = row.createEl('button', {
        text: t('healthJumpToLine'),
        style: 'flex-shrink:0; align-self:center;'
      });
      openBtn.onclick = async () => {
        await this.plugin.openNoteAtLine(item.sourcePath, item.line);
      };
    }
  }

  onClose() {
    if (this.activeProgress) this.activeProgress.abort();
    this.contentEl.empty();
  }
}

/**
 * Vault Wrapped & Storage Analytics Dashboard Modal
 */
class VaultAnalyticsModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.stats = null;
  }

  async onOpen() {
    const t = (k, p) => this.plugin.t(k, p);
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('fm-wizard-modal');

    const header = contentEl.createDiv({ cls: 'fm-step-header' });
    header.createSpan({ text: t('analyticsBadge'), cls: 'fm-step-badge' });
    header.createEl('h3', { text: t('analyticsTitle'), cls: 'fm-step-title' });

    const loadingEl = contentEl.createDiv({
      cls: 'fm-section-box',
      text: t('analyticsLoading'),
      style: 'text-align: center; padding: 32px 20px;'
    });

    try {
      this.stats = await this.plugin.scanVaultAnalytics();
      loadingEl.remove();
      this.renderDashboard(contentEl);
    } catch (err) {
      loadingEl.setText('❌ Failed to compute vault analytics: ' + err.message);
    }
  }

  renderDashboard(contentEl) {
    const t = (k, p) => this.plugin.t(k, p);
    const s = this.stats;

    const statGrid = contentEl.createDiv({ cls: 'fm-health-stat-grid' });
    const addStat = (num, label, color) => {
      const card = statGrid.createDiv({ cls: 'fm-health-stat-card' });
      const numEl = card.createDiv({ cls: 'fm-health-stat-num', text: String(num) });
      if (color) numEl.style.color = color;
      card.createDiv({ cls: 'fm-health-stat-label', text: label });
    };

    addStat(s.noteCount + s.canvasCount, `${t('analyticsStatNotes')} (${s.noteCount} md / ${s.canvasCount} canvas)`);
    addStat(s.totalWords.toLocaleString(), t('analyticsStatWords'), '#10b981');
    addStat(s.totalInternalLinks.toLocaleString(), t('analyticsStatLinks'), '#3b82f6');
    addStat(
      formatBytes(s.local.totalBytes + s.remote.rawBytes),
      t('analyticsStatStorage'),
      '#8b5cf6'
    );

    const storageBox = contentEl.createDiv({ cls: 'fm-section-box' });
    storageBox.createDiv({ text: t('analyticsStorageComparison'), cls: 'fm-section-title' });

    const totalCombinedBytes = Math.max(1, s.local.totalBytes + s.remote.rawBytes);
    const localPct = Math.round((s.local.totalBytes / totalCombinedBytes) * 100);
    const remotePct = 100 - localPct;

    const summaryRow = storageBox.createDiv({
      style: 'display:grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 8px;'
    });

    const localCard = summaryRow.createDiv({
      style: 'padding: 12px; border-radius: 8px; background: var(--background-primary); border: 1px solid var(--background-modifier-border);'
    });
    localCard.createDiv({ text: t('analyticsLocalVault'), style: 'font-weight: 600; font-size: 13px;' });
    localCard.createDiv({
      text: `${s.local.totalCount} · ${formatBytes(s.local.totalBytes)} (${localPct}%)`,
      style: 'font-size: 15px; font-weight: 700; margin-top: 4px; color: var(--text-accent);'
    });
    localCard.createDiv({
      text: t('analyticsLocalStats', {
        img: s.local.imageCount,
        imgBytes: formatBytes(s.local.imageBytes),
        aud: s.local.audioCount,
        audBytes: formatBytes(s.local.audioBytes),
        oth: s.local.otherCount,
        othBytes: formatBytes(s.local.otherBytes)
      }),
      style: 'font-size: 11px; color: var(--text-muted); margin-top: 6px;'
    });

    const remoteCard = summaryRow.createDiv({
      style: 'padding: 12px; border-radius: 8px; background: var(--background-primary); border: 1px solid var(--background-modifier-border);'
    });
    remoteCard.createDiv({ text: t('analyticsRemoteServer'), style: 'font-weight: 600; font-size: 13px;' });
    remoteCard.createDiv({
      text: `${s.remote.totalCount} · ${formatBytes(s.remote.rawBytes)} (${remotePct}%)`,
      style: 'font-size: 15px; font-weight: 700; margin-top: 4px; color: #10b981;'
    });
    remoteCard.createDiv({
      text: t('analyticsRemoteStats', {
        cache: formatBytes(s.remote.cacheBytes),
        locked: s.remote.lockedCount
      }),
      style: 'font-size: 11px; color: var(--text-muted); margin-top: 6px;'
    });

    if (s.topLargestAttachments.length > 0) {
      const topBox = contentEl.createDiv({ cls: 'fm-section-box' });
      topBox.createDiv({ text: t('analyticsTopLargest'), cls: 'fm-section-title' });
      const listEl = topBox.createDiv({ cls: 'fm-scroll-list', style: 'max-height: 210px;' });
      for (const item of s.topLargestAttachments) {
        const row = listEl.createDiv({ cls: 'fm-list-item' });
        const badge = item.source === 'local' ? t('analyticsBadgeLocal') : t('analyticsBadgeRemote');
        row.createSpan({
          text: `${badge} · ${item.path}`,
          style: 'font-size: 12px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;'
        });
        row.createSpan({
          text: formatBytes(item.size),
          style: 'font-size: 12px; font-weight: 600; color: var(--text-muted); flex-shrink: 0;'
        });
      }
    }

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const exportBtn = btnRow.createEl('button', {
      text: t('analyticsExportReport'),
      cls: 'mod-cta'
    });
    exportBtn.onclick = async () => {
      await this.plugin.exportAnalyticsReportToRoot(s);
    };

    const closeBtn = btnRow.createEl('button', { text: t('closeBtn') });
    closeBtn.onclick = () => this.close();
  }

  onClose() {
    this.contentEl.empty();
  }
}

/**
 * Remote Asset Gallery & Media Album Modal
 * Enables browsing, searching, previewing, and managing remote files directly inside Obsidian
 */
class RemoteGalleryModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.items = [];
    this.loading = true;
    this.error = null;
    this.searchQuery = '';
    this.selectedBucket = 'all';
    this.selectedType = 'all';
    this.insertMode = this.plugin?.settings?.insertOptimizedLinkOnUpload ? 'webp' : 'raw';
  }

  t(k, p) {
    return this.plugin ? this.plugin.t(k, p) : k;
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.addClass('fm-gallery-dialog');
    contentEl.addClass('fm-wizard-modal');
    contentEl.addClass('fm-gallery-modal');
    this.render();
    await this.loadData();
  }

  async loadData() {
    this.loading = true;
    this.error = null;
    this.render();
    try {
      this.items = await this.plugin.fetchRemoteFileList();
    } catch (err) {
      this.error = err.message || String(err);
    } finally {
      this.loading = false;
      this.render();
    }
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();

    const header = contentEl.createDiv({ cls: 'fm-step-header' });
    header.createEl('h3', { text: this.t('galleryTitle'), cls: 'fm-step-title' });

    if (this.loading) {
      const box = contentEl.createDiv({ cls: 'fm-section-box', style: 'text-align:center; padding:40px 16px;' });
      box.createDiv({ text: this.t('galleryLoading'), style: 'font-size:14px; color:var(--text-accent);' });
      return;
    }

    if (this.error) {
      const box = contentEl.createDiv({ cls: 'fm-result-banner fm-result-banner-error' });
      box.createDiv({ cls: 'fm-result-banner-title', text: this.t('galleryLoadFail', { err: this.error }) });
      const retryBtn = box.createEl('button', { text: this.t('galleryBtnRefresh'), cls: 'fm-mini-btn', style: 'margin-top:8px;' });
      retryBtn.onclick = () => this.loadData();
      return;
    }

    // Build filter buckets
    const bucketSet = new Set();
    let totalBytes = 0;
    for (const item of this.items) {
      bucketSet.add(`${item.year}/${item.month}`);
      totalBytes += (item.size || 0);
    }
    const buckets = Array.from(bucketSet).sort().reverse();

    // Toolbar
    const toolbar = contentEl.createDiv({ cls: 'fm-gallery-toolbar' });
    const leftControls = toolbar.createDiv({ cls: 'fm-gallery-search-row' });

    // Search input
    const searchInput = leftControls.createEl('input', {
      type: 'text',
      placeholder: this.t('gallerySearchPlaceholder'),
      value: this.searchQuery,
      cls: 'fm-gallery-search'
    });
    searchInput.oninput = (e) => {
      this.searchQuery = e.target.value.trim().toLowerCase();
      this.renderGrid(gridContainer, countLabel);
    };

    const refreshBtn = leftControls.createEl('button', {
      cls: 'fm-icon-button',
      attr: { title: this.t('galleryBtnRefresh'), 'aria-label': this.t('galleryBtnRefresh') }
    });
    setIcon(refreshBtn, 'refresh-cw');
    refreshBtn.onclick = () => this.loadData();

    const filters = toolbar.createDiv({ cls: 'fm-gallery-filter-row' });
    const bucketSelect = filters.createEl('select', { attr: { 'aria-label': this.t('galleryFilterAllTime') } });
    bucketSelect.createEl('option', { value: 'all', text: this.t('galleryFilterAllTime') });
    for (const b of buckets) {
      bucketSelect.createEl('option', { value: b, text: b });
    }
    bucketSelect.value = this.selectedBucket;
    bucketSelect.onchange = (e) => {
      this.selectedBucket = e.target.value;
      this.renderGrid(gridContainer, countLabel);
    };

    // Type filter dropdown
    const typeSelect = filters.createEl('select', { attr: { 'aria-label': this.t('galleryFilterAllTypes') } });
    typeSelect.createEl('option', { value: 'all', text: this.t('galleryFilterAllTypes') });
    typeSelect.createEl('option', { value: 'image', text: this.t('galleryFilterImage') });
    typeSelect.createEl('option', { value: 'audio', text: this.t('galleryFilterAudio') });
    typeSelect.createEl('option', { value: 'other', text: this.t('galleryFilterOther') });
    typeSelect.value = this.selectedType;
    typeSelect.onchange = (e) => {
      this.selectedType = e.target.value;
      this.renderGrid(gridContainer, countLabel);
    };

    const modeSelect = filters.createEl('select', { attr: { 'aria-label': this.t('galleryLinkFormat') } });
    modeSelect.createEl('option', { value: 'raw', text: this.t('galleryModeRaw') });
    modeSelect.createEl('option', { value: 'webp', text: this.t('galleryModeWebp') });
    modeSelect.value = this.insertMode;
    modeSelect.onchange = async () => {
      this.insertMode = modeSelect.value;
      if (this.plugin) {
        this.plugin.settings.insertOptimizedLinkOnUpload = (this.insertMode === 'webp');
        await this.plugin.saveSettings();
      }
      this.renderGrid(gridContainer, countLabel);
    };

    const countLabel = toolbar.createSpan({ cls: 'fm-gallery-stats' });

    // Grid container
    const gridContainer = contentEl.createDiv({ cls: 'fm-gallery-grid' });
    this.renderGrid(gridContainer, countLabel);

  }

  filterItems() {
    return this.items.filter((item) => {
      if (this.selectedBucket !== 'all' && `${item.year}/${item.month}` !== this.selectedBucket) {
        return false;
      }
      if (this.selectedType !== 'all') {
        const grp = getFileTypeGroup(getExt(item.name || item.filename));
        if (grp !== this.selectedType) return false;
      }
      if (this.searchQuery) {
        const fn = (item.name || item.filename || '').toLowerCase();
        if (!fn.includes(this.searchQuery)) return false;
      }
      return true;
    });
  }

  renderGrid(containerEl, countLabel) {
    containerEl.empty();
    const filtered = this.filterItems();
    const totalBytes = filtered.reduce((s, i) => s + (i.size || 0), 0);

    if (countLabel) {
      countLabel.setText(this.t('galleryStats', { count: filtered.length, size: formatBytes(totalBytes) }));
    }

    if (filtered.length === 0) {
      containerEl.createDiv({
        cls: 'fm-section-box',
        text: this.t('galleryEmpty'),
        style: 'grid-column: 1 / -1; text-align: center; padding: 40px 16px; color: var(--text-muted);'
      });
      return;
    }

    for (const item of filtered) {
      const card = containerEl.createDiv({ cls: 'fm-gallery-card' });
      const thumbWrap = card.createDiv({ cls: 'fm-gallery-thumb-wrap' });

      const ext = getExt(item.name || item.filename);
      const isImg = IMAGE_EXTS.has(ext);

      if (isImg) {
        const img = thumbWrap.createEl('img', {
          cls: 'fm-gallery-thumb',
          attr: {
            loading: 'lazy',
            src: item.pubUrl || item.rawUrl,
            alt: item.name || item.filename
          }
        });
        img.onerror = () => {
          img.style.display = 'none';
          thumbWrap.createSpan({ text: '🖼️', style: 'font-size:32px;' });
        };
      } else {
        thumbWrap.createDiv({
          text: ext.toUpperCase(),
          style: 'font-size: 16px; font-weight: 700; color: var(--text-muted);'
        });
      }

      if (item.locked) {
        const lockBadge = thumbWrap.createSpan({
          cls: 'fm-gallery-lock-badge',
          text: '🔒',
          attr: { title: this.t('galleryBtnUnlock') }
        });
        lockBadge.onclick = async (e) => {
          e.stopPropagation();
          try {
            await this.plugin.toggleRemoteFileLock(item.year, item.month, item.filename, false);
            item.locked = false;
            this.renderGrid(containerEl, countLabel);
          } catch (err) {
            new Notice(this.t('previewLockFailed', { err: err.message }));
          }
        };
      }

      thumbWrap.onclick = () => {
        new ImageLightboxModal(this.app, this.plugin, {
          source: 'remote',
          name: item.name || item.filename,
          displayPath: `${item.year}/${item.month}/${item.filename}`,
          size: item.size,
          rawObj: item
        }, (action, target) => {
          if (action === 'deleted') {
            this.items = this.items.filter((i) => !(i.year === target.year && i.month === target.month && i.filename === target.filename));
          }
          this.renderGrid(containerEl, countLabel);
        }).open();
      };

      const info = card.createDiv({ cls: 'fm-gallery-info' });
      info.createDiv({
        cls: 'fm-gallery-name',
        text: item.name || item.filename,
        attr: { title: item.name || item.filename }
      });

      const meta = info.createDiv({ cls: 'fm-gallery-meta' });
      meta.createSpan({ text: `${item.year}/${item.month}` });
      meta.createSpan({ text: formatBytes(item.size) });

      const actions = card.createDiv({ cls: 'fm-gallery-actions' });

      // Clean single action: 📝 插入笔记
      const isWebpMode = this.insertMode === 'webp' && item.pubUrl;
      const insertTargetUrl = isWebpMode ? item.pubUrl : (item.rawUrl || item.pubUrl);
      const fn = item.name || item.filename;

      const insertBtn = actions.createEl('button', {
        cls: 'fm-gallery-insert-btn mod-cta',
        attr: { title: isWebpMode ? this.t('galleryInsertedWebp') : this.t('galleryInsertedRaw') }
      });
      setIcon(insertBtn.createSpan(), 'file-input');
      insertBtn.createSpan({ text: this.t('galleryBtnInsert') });
      insertBtn.onmousedown = (e) => {
        // Prevent clicking button from blurring or moving cursor in Markdown editor
        e.preventDefault();
      };
      insertBtn.onclick = () => {
        const mdSnippet = isImg ? `![${fn}](${insertTargetUrl})\n` : `[${fn}](${insertTargetUrl})\n`;
        const noticeMsg = isWebpMode ? this.t('galleryInsertedWebp') : this.t('galleryInsertedRaw');
        this.plugin?.insertMarkdownToActiveEditor(mdSnippet, noticeMsg);
      };
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

/**
 * Remote Media Gallery Sidebar View (Bilingual zh-CN / en)
 */
class RemoteGalleryView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.items = [];
    this.loading = true;
    this.error = null;
    this.searchQuery = '';
    this.selectedBucket = 'all';
    this.selectedType = 'all';
    this.layoutMode = 'list'; // 'grid' | 'list'
    this.insertMode = this.plugin?.settings?.insertOptimizedLinkOnUpload ? 'webp' : 'raw';
  }

  getViewType() {
    return VIEW_TYPE_REMOTE_GALLERY;
  }

  getDisplayText() {
    return this.t('galleryViewTitle');
  }

  getIcon() {
    return 'image';
  }

  t(k, p) {
    return this.plugin ? this.plugin.t(k, p) : k;
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('fm-gallery-view-container');
    this.render();
    await this.loadData();
  }

  async loadData() {
    this.loading = true;
    this.error = null;
    this.render();
    try {
      this.items = await this.plugin.fetchRemoteFileList();
    } catch (err) {
      this.error = err.message || String(err);
    } finally {
      this.loading = false;
      this.render();
    }
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();

    if (this.loading) {
      const box = contentEl.createDiv({ cls: 'fm-section-box', style: 'text-align:center; padding:30px 12px;' });
      box.createDiv({ text: this.t('galleryLoading'), style: 'font-size:12px; color:var(--text-accent);' });
      return;
    }

    if (this.error) {
      const box = contentEl.createDiv({ cls: 'fm-result-banner fm-result-banner-error', style: 'margin:8px 0;' });
      box.createDiv({ cls: 'fm-result-banner-title', text: this.t('galleryLoadFail', { err: this.error }), style: 'font-size:12px;' });
      const retryBtn = box.createEl('button', { text: this.t('galleryBtnRefresh'), cls: 'fm-mini-btn', style: 'margin-top:6px;' });
      retryBtn.onclick = () => this.loadData();
      return;
    }

    // Build filter buckets
    const bucketSet = new Set();
    for (const item of this.items) {
      bucketSet.add(`${item.year}/${item.month}`);
    }
    const buckets = Array.from(bucketSet).sort().reverse();

    // Keep controls in distinct rows so narrow Obsidian sidebars never need horizontal scrolling.
    const toolbar = contentEl.createDiv({ cls: 'fm-gallery-toolbar' });

    // Row 1: Search input + refresh + layout switch
    const row1 = toolbar.createDiv({ cls: 'fm-gallery-toolbar-row' });
    const searchInput = row1.createEl('input', {
      type: 'text',
      placeholder: this.t('gallerySearchPlaceholder'),
      value: this.searchQuery,
      cls: 'fm-gallery-search'
    });
    searchInput.oninput = (e) => {
      this.searchQuery = e.target.value.trim().toLowerCase();
      this.renderGrid(gridContainer, countLabel);
    };

    const layoutBtn = row1.createEl('button', {
      cls: 'fm-icon-button',
      attr: { title: this.layoutMode === 'list' ? this.t('galleryLayoutGrid') : this.t('galleryLayoutList'), 'aria-label': this.layoutMode === 'list' ? this.t('galleryLayoutGrid') : this.t('galleryLayoutList') }
    });
    setIcon(layoutBtn, this.layoutMode === 'list' ? 'layout-grid' : 'list');
    layoutBtn.onclick = () => {
      this.layoutMode = this.layoutMode === 'list' ? 'grid' : 'list';
      setIcon(layoutBtn, this.layoutMode === 'list' ? 'layout-grid' : 'list');
      const label = this.layoutMode === 'list' ? this.t('galleryLayoutGrid') : this.t('galleryLayoutList');
      layoutBtn.setAttribute('title', label);
      layoutBtn.setAttribute('aria-label', label);
      this.renderGrid(gridContainer, countLabel);
    };

    const refreshBtn = row1.createEl('button', {
      cls: 'fm-icon-button',
      attr: { title: this.t('galleryBtnRefresh'), 'aria-label': this.t('galleryBtnRefresh') }
    });
    setIcon(refreshBtn, 'refresh-cw');
    refreshBtn.onclick = () => this.loadData();

    const row2 = toolbar.createDiv({ cls: 'fm-gallery-toolbar-row fm-gallery-filter-fields' });
    const folderField = row2.createDiv({ cls: 'fm-gallery-filter-field' });
    folderField.createEl('label', { text: this.t('galleryFolderLabel') });
    const bucketSelect = folderField.createEl('select', { attr: { 'aria-label': this.t('galleryFolderLabel') } });
    bucketSelect.createEl('option', { value: 'all', text: this.t('galleryFilterAllTime') });
    for (const b of buckets) {
      bucketSelect.createEl('option', { value: b, text: b });
    }
    bucketSelect.value = this.selectedBucket;
    bucketSelect.onchange = (e) => {
      this.selectedBucket = e.target.value;
      this.renderGrid(gridContainer, countLabel);
    };

    const typeField = row2.createDiv({ cls: 'fm-gallery-filter-field' });
    typeField.createEl('label', { text: this.t('galleryTypeLabel') });
    const typeSelect = typeField.createEl('select', { attr: { 'aria-label': this.t('galleryTypeLabel') } });
    typeSelect.createEl('option', { value: 'all', text: this.t('galleryFilterAllTypes') });
    typeSelect.createEl('option', { value: 'image', text: this.t('galleryFilterImage') });
    typeSelect.createEl('option', { value: 'audio', text: this.t('galleryFilterAudio') });
    typeSelect.createEl('option', { value: 'other', text: this.t('galleryFilterOther') });
    typeSelect.value = this.selectedType;
    typeSelect.onchange = (e) => {
      this.selectedType = e.target.value;
      this.renderGrid(gridContainer, countLabel);
    };

    const row3 = toolbar.createDiv({ cls: 'fm-gallery-summary-row' });
    const countLabel = row3.createDiv({ cls: 'fm-gallery-stats' });
    const formatControl = row3.createDiv({ cls: 'fm-gallery-format-control' });
    formatControl.createSpan({ text: this.t('galleryInsertFormatLabel') });
    const modeGroup = formatControl.createDiv({ cls: 'fm-gallery-mode-group', attr: { role: 'group', 'aria-label': this.t('galleryLinkFormat') } });
    const modeButtons = ['raw', 'webp'].map((mode) => {
      const btn = modeGroup.createEl('button', {
        text: this.t(mode === 'raw' ? 'galleryModeRaw' : 'galleryModeWebp'),
        cls: this.insertMode === mode ? 'is-active' : '',
        attr: { type: 'button', 'aria-pressed': String(this.insertMode === mode) }
      });
      btn.onclick = async () => {
        this.insertMode = mode;
        modeButtons.forEach((button, index) => {
          const active = ['raw', 'webp'][index] === mode;
          button.toggleClass('is-active', active);
          button.setAttribute('aria-pressed', String(active));
        });
        if (this.plugin) {
          this.plugin.settings.insertOptimizedLinkOnUpload = mode === 'webp';
          await this.plugin.saveSettings();
        }
        this.renderGrid(gridContainer, countLabel);
      };
      return btn;
    });

    // Grid container
    const gridContainer = contentEl.createDiv({ cls: 'fm-gallery-grid' + (this.layoutMode === 'list' ? ' is-list' : '') });
    this.renderGrid(gridContainer, countLabel);
  }

  filterItems() {
    return this.items.filter((item) => {
      if (this.selectedBucket !== 'all' && `${item.year}/${item.month}` !== this.selectedBucket) {
        return false;
      }
      if (this.selectedType !== 'all') {
        const grp = getFileTypeGroup(getExt(item.name || item.filename));
        if (grp !== this.selectedType) return false;
      }
      if (this.searchQuery) {
        const fn = (item.name || item.filename || '').toLowerCase();
        if (!fn.includes(this.searchQuery)) return false;
      }
      return true;
    });
  }

  renderGrid(containerEl, countLabel) {
    containerEl.empty();
    if (this.layoutMode === 'list') {
      containerEl.addClass('is-list');
    } else {
      containerEl.removeClass('is-list');
    }

    const filtered = this.filterItems();
    const totalBytes = filtered.reduce((s, i) => s + (i.size || 0), 0);

    if (countLabel) {
      countLabel.empty();
      countLabel.createSpan({ cls: 'fm-gallery-stats-count', text: this.t('galleryFileCount', { count: filtered.length }) });
      countLabel.createSpan({ cls: 'fm-gallery-stats-size', text: this.t('galleryTotalSize', { size: formatBytes(totalBytes) }) });
    }

    if (filtered.length === 0) {
      containerEl.createDiv({
        cls: 'fm-section-box',
        text: this.t('galleryEmpty'),
        style: 'grid-column: 1 / -1; text-align: center; padding: 30px 10px; color: var(--text-muted); font-size:12px;'
      });
      return;
    }

    for (const item of filtered) {
      const card = containerEl.createDiv({ cls: 'fm-gallery-card' + (this.layoutMode === 'list' ? ' is-list' : '') });
      const thumbWrap = card.createDiv({ cls: 'fm-gallery-thumb-wrap' });

      const ext = getExt(item.name || item.filename);
      const isImg = IMAGE_EXTS.has(ext);

      if (isImg) {
        const img = thumbWrap.createEl('img', {
          cls: 'fm-gallery-thumb',
          attr: {
            loading: 'lazy',
            src: item.pubUrl || item.rawUrl,
            alt: item.name || item.filename
          }
        });
        img.onerror = () => {
          img.style.display = 'none';
          thumbWrap.createSpan({ text: '🖼️', style: 'font-size:24px;' });
        };
      } else {
        thumbWrap.createDiv({
          text: ext.toUpperCase(),
          style: 'font-size: 14px; font-weight: 700; color: var(--text-muted);'
        });
      }

      // Lock badge (click to unlock if locked and not protected)
      if (item.locked) {
        const lockBadge = thumbWrap.createSpan({
          cls: 'fm-gallery-lock-badge',
          text: '🔒',
          attr: { title: this.t('galleryBtnUnlock') }
        });
        lockBadge.onclick = async (e) => {
          e.stopPropagation();
          try {
            await this.plugin.toggleRemoteFileLock(item.year, item.month, item.filename, false);
            item.locked = false;
            this.renderGrid(containerEl, countLabel);
          } catch (err) {
            new Notice(this.t('previewLockFailed', { err: err.message }));
          }
        };
      }

      thumbWrap.onclick = () => {
        new ImageLightboxModal(this.app, this.plugin, {
          source: 'remote',
          name: item.name || item.filename,
          displayPath: `${item.year}/${item.month}/${item.filename}`,
          size: item.size,
          rawObj: item
        }, (action, target) => {
          if (action === 'deleted') {
            this.items = this.items.filter((i) => !(i.year === target.year && i.month === target.month && i.filename === target.filename));
          }
          this.renderGrid(containerEl, countLabel);
        }).open();
      };
      thumbWrap.setAttribute('role', 'button');
      thumbWrap.setAttribute('tabindex', '0');
      thumbWrap.setAttribute('aria-label', this.t('galleryBtnPreview'));
      thumbWrap.onkeydown = (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          thumbWrap.click();
        }
      };

      const info = card.createDiv({ cls: 'fm-gallery-info' });
      info.createDiv({
        cls: 'fm-gallery-name',
        text: item.name || item.filename,
        attr: { title: item.name || item.filename }
      });

      const meta = info.createDiv({ cls: 'fm-gallery-meta' });
      meta.createSpan({ text: `${item.year}/${item.month} · ${formatBytes(item.size)}` });

      const actions = card.createDiv({ cls: 'fm-gallery-actions' });

      // Clean single action: 📝 插入笔记
      const isWebpMode = this.insertMode === 'webp' && item.pubUrl;
      const insertTargetUrl = isWebpMode ? item.pubUrl : (item.rawUrl || item.pubUrl);
      const fn = item.name || item.filename;

      const insertBtn = actions.createEl('button', {
        cls: 'fm-gallery-insert-btn mod-cta',
        attr: { title: isWebpMode ? this.t('galleryInsertedWebp') : this.t('galleryInsertedRaw') }
      });
      setIcon(insertBtn.createSpan(), 'file-input');
      insertBtn.createSpan({ cls: 'fm-gallery-insert-label', text: this.t('galleryBtnInsert') });
      insertBtn.setAttribute('aria-label', this.t('galleryBtnInsert'));
      insertBtn.onmousedown = (e) => {
        // Prevent clicking button from blurring or moving cursor in Markdown editor
        e.preventDefault();
      };
      insertBtn.onclick = () => {
        const mdSnippet = isImg ? `![${fn}](${insertTargetUrl})\n` : `[${fn}](${insertTargetUrl})\n`;
        const noticeMsg = isWebpMode ? this.t('galleryInsertedWebp') : this.t('galleryInsertedRaw');
        this.plugin?.insertMarkdownToActiveEditor(mdSnippet, noticeMsg);
      };
    }
  }

  async onClose() {
    this.contentEl.empty();
  }
}

/**
 * Quick Action Hub Modal opened from the left sidebar ribbon button (Bilingual zh-CN / en)
 */
class FileMasterHubModal extends Modal {
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
    const currentEff = this.plugin.getEffectiveLanguage();
    const langBtn = header.createEl('button', {
      text: currentEff === 'en' ? '简体中文' : 'English',
      cls: 'fm-hub-language',
      attr: { title: t('langName') }
    });
    langBtn.onclick = async () => {
      this.plugin.settings.language = currentEff === 'en' ? 'zh' : 'en';
      await this.plugin.saveSettings();
      this.plugin.onLanguageChange();
      this.onOpen();
    };

    const isRemote = Boolean(this.plugin?.isRemoteServerReady?.());

    const govActions = [
      {
        icon: 'link',
        title: t('actHealthTitle'),
        desc: t('actHealthDesc'),
        run: () => this.plugin.openModalSafely(new HealthCheckModal(this.app, this.plugin))
      },
      {
        icon: 'files',
        title: t('actDupTitle'),
        desc: t('actDupDesc'),
        run: () => this.plugin.openModalSafely(new DuplicateWizardModal(this.app, this.plugin))
      },
      {
        icon: 'search',
        title: t('actOrphanTitle'),
        desc: t('actOrphanDesc'),
        run: () => this.plugin.openModalSafely(new OrphanWizardModal(this.app, this.plugin))
      }
    ];

    govActions.push({
      icon: 'bar-chart-3',
      title: t('actAnalyticsTitle'),
      desc: t('actAnalyticsDesc'),
      run: () => this.plugin.openModalSafely(new VaultAnalyticsModal(this.app, this.plugin))
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
            run: () => this.plugin.openModalSafely(new RemoteGalleryModal(this.app, this.plugin))
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
            run: () => this.plugin.openModalSafely(new BatchMigrateWizardModal(this.app, this.plugin))
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
            run: () => this.plugin.migrateActiveNoteAttachments()
          },
          {
            icon: 'download',
            title: t('actNoteDownTitle'),
            desc: t('actNoteDownDesc'),
            run: () => this.plugin.downloadActiveNoteRemoteAttachments()
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
        const arrow = card.createSpan({ cls: 'fm-hub-card-arrow' });
        setIcon(arrow, 'arrow-up-right');

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

  async onload() {
    await this.loadSettings();
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

  async safeModifyFileContent(tfile, transformFn) {
    if (typeof this.app.vault.process === 'function') {
      let changed = false;
      await this.app.vault.process(tfile, (data) => {
        const next = transformFn(data);
        if (next !== data) changed = true;
        return next;
      });
      return changed;
    } else {
      const orig = await this.app.vault.read(tfile);
      const next = transformFn(orig);
      if (next !== orig) {
        await this.app.vault.modify(tfile, next);
        return true;
      }
      return false;
    }
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

        if (abstractFile.extension === 'md' && this.isRemoteServerReady()) {
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
              .setTitle(`☁️ FileMaster: Upload local "${localTFile.name}" to cloud (Update links)`)
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
    const sha256 = computeSha256Hex(arrayBuffer);
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
        const fullSha256 = crypto
          .createHash('sha256')
          .update(Buffer.from(arrayBuffer))
          .digest('hex');
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
        return this.lastServerCompatStatus;
      }

      // 3. Test API Auth token against image-host list
      let assetCount = 0;
      if (this.settings.apiToken) {
        try {
          const listRes = await requestUrl({
            url: `${serverUrl}/api/modules/image-host/list`,
            method: 'GET',
            headers: { Authorization: `Bearer ${this.settings.apiToken}` },
            throw: false
          });
          if (listRes.status === 401 || listRes.status === 403) {
            this.lastServerCompatStatus = {
              ok: false,
              status: 'auth_failed',
              serverVersion: serverVer,
              pluginVersion: pluginVer,
              features: verData.features || {}
            };
            return this.lastServerCompatStatus;
          }
          if (listRes.status === 200) {
            assetCount = (listRes.json?.images || []).length;
          }
        } catch { }
      }

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
    const { signal, onProgress } = scanCtx || {};
    const allFiles = this.app.vault.getFiles();
    const docFiles = allFiles.filter(
      (f) =>
        (f.extension === 'md' || f.extension === 'canvas') &&
        !isReportFile(f.name)
    );

    const docContents = [];
    for (let i = 0; i < docFiles.length; i++) {
      if (signal?.aborted) throw new Error('SCAN_ABORTED');
      const doc = docFiles[i];
      if (onProgress && i % 25 === 0) {
        onProgress(i + 1, docFiles.length, doc.path);
        await new Promise((r) => setTimeout(r, 0));
      }
      const rawText = await this.app.vault.cachedRead(doc);
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

    const resolvedLinks = this.app.metadataCache.resolvedLinks || {};
    const resolvedTargetMap = new Map();
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

    return { docContents, resolvedTargetMap };
  }

  findReferencingNotesForLocalFile(tfile, snapshot) {
    const refNotes = new Set();
    const fromResolved = snapshot.resolvedTargetMap.get(tfile.path);
    if (fromResolved) {
      fromResolved.forEach((p) => refNotes.add(p));
    }

    const name = tfile.name;
    const baseName = tfile.basename;
    const relPath = tfile.path;

    for (const doc of snapshot.docContents) {
      if (doc.path === tfile.path) continue;
      if (
        doc.rawText.includes(name) ||
        doc.decodedText.includes(name) ||
        doc.rawText.includes(relPath) ||
        doc.decodedText.includes(relPath) ||
        (tfile.extension === 'md' &&
          (doc.rawText.includes(`[[${baseName}]]`) ||
            doc.rawText.includes(`[[${baseName}|`) ||
            doc.rawText.includes(`[[${baseName}#`)))
      ) {
        refNotes.add(doc.path);
      }
    }
    return [...refNotes];
  }

  findReferencingNotesForRemoteItem(remoteItem, snapshot) {
    const refNotes = new Set();
    const fname = remoteItem.filename;
    const encodedFname = encodeURIComponent(fname);
    const relKey = `${remoteItem.year}/${remoteItem.month}/${fname}`;
    const encodedRelKey = `${remoteItem.year}/${remoteItem.month}/${encodedFname}`;

    for (const doc of snapshot.docContents) {
      if (
        doc.rawText.includes(fname) ||
        doc.decodedText.includes(fname) ||
        doc.rawText.includes(encodedFname) ||
        doc.rawText.includes(relKey) ||
        doc.rawText.includes(encodedRelKey)
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
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
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
      }
    }

    for (const item of remoteToClean) {
      try {
        await this.deleteRemoteFile(item.rawObj.year, item.rawObj.month, item.rawObj.filename);
        deletedRemote++;
      } catch (err) {
        new Notice(this.t('noticeRemoteDeleteFailed', { name: item.name, err: err.message }));
      }
    }

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

          const sha256 = computeSha256Hex(buf);
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
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
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
      (f) => (f.extension === 'md' || f.extension === 'canvas') && !isReportFile(f.name)
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
              if (node.type === 'file' && node.file) {
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
                  checkRemote: false
                });
                issues.push(...subIssues);
              }
            }
          }
        } catch { }
      } else {
        const docIssues = scanNoteContentForBrokenLinks(doc.path, rawText, vaultIndex, {
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

    return { issues, totalDocs: docFiles.length };
  }

  async exportHealthReportToRoot(issues, totalDocsScanned) {
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
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
    const docFiles = allFiles.filter(
      (f) => (f.extension === 'md' || f.extension === 'canvas') && !isReportFile(f.name)
    );

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
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
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
      .filter((f) => (f.extension === 'md' || f.extension === 'canvas') && !isReportFile(f.name));

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
          }
        }
      }
    }

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
        .filter((f) => (f.extension === 'md' || f.extension === 'canvas') && !isReportFile(f.name));

      let modifiedCount = 0;
      for (const doc of allDocs) {
        const modified = await this.safeModifyFileContent(doc, (orig) => {
          return this.rewriteContentLinks(orig, removeItem, keepItem);
        });
        if (modified) modifiedCount++;
      }

      if (deleteLocal) {
        const postSnapshot = await this.buildVaultReferenceSnapshot();
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

  async downloadSingleRemoteItemToLocal(remoteMatch) {
    try {
      const { year, month, filename } = remoteMatch;
      new Notice(this.t('noticeDownloadingFile', { name: filename }));

      let remoteObj = null;
      try {
        const list = await this.fetchRemoteFileList();
        remoteObj = list.find(
          (r) => r.year === year && r.month === month && r.filename === filename
        );
      } catch { }

      const downloadUrl = remoteObj
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

      const activeFile = this.app.workspace.getActiveFile();
      const sourcePath = activeFile ? activeFile.path : '';
      const localPath = await this.app.fileManager.getAvailablePathForAttachment(
        filename,
        sourcePath
      );
      const createdFile = await this.app.vault.createBinary(localPath, response.arrayBuffer);

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
        name: createdFile.name,
        ext: createdFile.extension.toLowerCase(),
        displayPath: createdFile.path,
        rawObj: createdFile
      };

      const allDocs = this.app.vault
        .getFiles()
        .filter((f) => (f.extension === 'md' || f.extension === 'canvas') && !isReportFile(f.name));

      let modifiedCount = 0;
      for (const doc of allDocs) {
        const modified = await this.safeModifyFileContent(doc, (orig) => {
          return this.rewriteContentLinks(orig, removeItem, keepItem);
        });
        if (modified) modifiedCount++;
      }

      new Notice(
        this.t('noticeDownloadedToVault', {
          name: filename,
          path: createdFile.path,
          docs: modifiedCount
        })
      );
      return createdFile;
    } catch (err) {
      new Notice(this.t('noticeDownloadFailed', { err: err.message }));
      throw err;
    }
  }

  async executeDownloadNoteDirect(activeFile, onProgress = null) {
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
      return 0;
    }

    let count = 0;
    const items = Array.from(matchesMap.values());
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (onProgress) onProgress(i + 1, items.length, item.filename);
      try {
        await this.downloadSingleRemoteItemToLocal(item);
        count++;
      } catch { }
    }
    return count;
  }

  async downloadActiveNoteRemoteAttachments(targetFile = null) {
    const activeFile = targetFile || this.app.workspace.getActiveFile();
    if (!activeFile || activeFile.extension !== 'md') {
      new Notice(this.t('noticeOpenMdFirst'));
      return;
    }
    new ActiveNoteActionModal(this.app, this, activeFile, 'download').open();
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
        new Notice(this.t('noticeMigrateFailed', { name: tfile.name, err: err.message }));
      }
    }

    if (uploadedPairs.length === 0) {
      if (onDone) onDone();
      return;
    }

    const allDocs = this.app.vault
      .getFiles()
      .filter((f) => (f.extension === 'md' || f.extension === 'canvas') && !isReportFile(f.name));

    let modifiedDocsCount = 0;
    for (const doc of allDocs) {
      const modified = await this.safeModifyFileContent(doc, (content) => {
        let next = content;
        for (const { removeItem, keepItem } of uploadedPairs) {
          next = this.rewriteContentLinks(next, removeItem, keepItem);
        }
        return next;
      });
      if (modified) modifiedDocsCount++;
    }

    let trashedCount = 0;
    if (options.deleteLocalAfter) {
      const postSnapshot = await this.buildVaultReferenceSnapshot();
      for (const { tfile } of uploadedPairs) {
        const remaining = this.findReferencingNotesForLocalFile(tfile, postSnapshot);
        if (remaining.length === 0) {
          await this.app.vault.trash(tfile, true).catch(() => { });
          trashedCount++;
        }
      }
    }

    const trashedPart = options.deleteLocalAfter
      ? this.t('noticeBatchMigrateTrashedPart', { trashed: trashedCount })
      : '';
    new Notice(
      this.t('noticeBatchMigrateSuccess', {
        count: uploadedPairs.length,
        docs: modifiedDocsCount,
        trashed: trashedPart
      })
    );
    if (onDone) {
      onDone({
        count: uploadedPairs.length,
        docs: modifiedDocsCount,
        trashed: trashedCount
      });
    }
  }

  async executeMigrateNoteDirect(activeFile, onProgress = null) {
    let content = await this.app.vault.read(activeFile);
    const wikiRegex = /!\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g;
    const mdLinkRegex = /!\[([^\]]*)\]\((?!https?:\/\/)([^)]+)\)/g;

    const localFilesToMigrate = new Map();
    let m;
    while ((m = wikiRegex.exec(content)) !== null) {
      const tf = this.app.metadataCache.getFirstLinkpathDest(m[1].trim(), activeFile.path);
      if (tf && isAttachmentExt(tf.extension)) {
        localFilesToMigrate.set(tf.path, tf);
      }
    }
    while ((m = mdLinkRegex.exec(content)) !== null) {
      const tf = this.app.metadataCache.getFirstLinkpathDest(
        decodeURIComponent(m[2].trim()),
        activeFile.path
      );
      if (tf && isAttachmentExt(tf.extension)) {
        localFilesToMigrate.set(tf.path, tf);
      }
    }

    if (localFilesToMigrate.size === 0) {
      return 0;
    }

    let migratedCount = 0;
    const items = Array.from(localFilesToMigrate.values());
    for (let i = 0; i < items.length; i++) {
      const tfile = items[i];
      if (onProgress) onProgress(i + 1, items.length, tfile.name);
      try {
        const buf = await this.app.vault.readBinary(tfile);
        const res = await this.uploadBufferToServer(buf, tfile.name);

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
      } catch (err) {
        console.error(`Failed to migrate ${tfile.name}:`, err);
      }
    }

    if (migratedCount > 0) {
      await this.safeModifyFileContent(activeFile, () => content);
      if (this.settings.deleteLocalAfterMigrate) {
        const snapshot = await this.buildVaultReferenceSnapshot();
        for (const tfile of items) {
          const otherRefs = this.findReferencingNotesForLocalFile(tfile, snapshot);
          if (otherRefs.length === 0) {
            await this.app.vault.trash(tfile, true).catch(() => { });
          }
        }
      }
    }
    return migratedCount;
  }

  async migrateActiveNoteAttachments(targetFile = null) {
    const activeFile = targetFile || this.app.workspace.getActiveFile();
    if (!activeFile || activeFile.extension !== 'md') {
      new Notice(this.t('noticeOpenMdFirst'));
      return;
    }
    new ActiveNoteActionModal(this.app, this, activeFile, 'migrate').open();
  }

  async copyActiveNoteForAstro(targetFile = null) {
    const activeFile = targetFile || this.app.workspace.getActiveFile();
    if (!activeFile || activeFile.extension !== 'md') {
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

    group('settingsSetupGroup', '🧭', [
      ['server', 'tabServer', 'server'],
      ['upload', 'tabUpload', 'paperclip']
    ]);
    group('settingsPreferencesGroup', '⚙️', [
      ['general', 'tabGeneral', 'sliders-horizontal'],
      ['exemptions', 'tabExemptions', 'shield']
    ]);
    group('settingsToolsGroup', '🧰', [
      ['hub', 'openHubName', 'wrench']
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

    new Setting(containerEl)
      .setName(this.plugin.t('clipboardMonitorName'))
      .setDesc(this.plugin.t('clipboardMonitorDesc'))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enableClipboardMonitor !== false).onChange(async (value) => {
          this.plugin.settings.enableClipboardMonitor = value;
          await this.plugin.saveSettings();
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
      .setName(this.plugin.t('insertOptimizedName'))
      .setDesc(this.plugin.t('insertOptimizedDesc'))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.insertOptimizedLinkOnUpload).onChange(async (value) => {
          this.plugin.settings.insertOptimizedLinkOnUpload = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(this.plugin.t('namingStrategyName'))
      .setDesc(this.plugin.t('namingStrategyDesc'))
      .addDropdown((drop) =>
        drop
          .addOption('keep', this.plugin.t('optNamingKeep'))
          .addOption('rule', this.plugin.t('optNamingRule'))
          .addOption('prompt', this.plugin.t('optNamingPrompt'))
          .setValue(this.plugin.settings.namingMode)
          .onChange(async (value) => {
            this.plugin.settings.namingMode = value;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    if (this.plugin.settings.namingMode === 'rule') {
      new Setting(containerEl)
        .setName(this.plugin.t('namingPatternName'))
        .setDesc(this.plugin.t('namingPatternDesc'))
        .addText((text) =>
          text
            .setPlaceholder('{note}_{date}_{rand:4}')
            .setValue(this.plugin.settings.namingPattern)
            .onChange(async (value) => {
              this.plugin.settings.namingPattern = value.trim() || '{origin}';
              await this.plugin.saveSettings();
            })
        );
    }
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
      .setName('FileMaster')
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
