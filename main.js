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
  getLanguage,
  Platform
} = require('obsidian');

const DEFAULT_SETTINGS = {
  language: 'auto', // 'auto' | 'zh' | 'en'
  enableRemoteServer: false,
  serverVerified: false,
  serverUrl: 'http://localhost:3000',
  apiToken: '',
  enableSidebarButton: true,
  enableClipboardMonitor: true,
  saveLocationMode: 'ask', // 'remote' | 'local' | 'ask'
  defaultSaveLocation: 'remote', // 'remote' | 'local' (default preselected destination when asking)
  namingMode: 'keep',      // 'keep' (keep original) | 'rule' (auto-rename pattern) | 'prompt' (manual rename modal)
  namingPattern: '{note}_{date}_{rand:4}',
  uploadNonImageAttachments: true,
  insertOptimizedLinkOnUpload: false,
  deleteLocalAfterMigrate: true,
  excludedLocalFolders: 'templates, assets/protected',
  excludeLockedRemoteFiles: true
};

const MIN_SERVER_VERSION = '1.0.1';
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

const OBSIDIAN_NOTE_EXTS = new Set(['md', 'canvas', 'base', 'excalidraw']);
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
    pagePrevious: "上一页",
    pageNext: "下一页",
    pageCount: "第 {current} / {total} 页",
    transferIntegrityFailed: "内容校验失败，已保留原文件和链接，请刷新服务器列表后重试。",
    transferReferencesChanged: '笔记在最终检查后发生变化，已保留本地文件，可重试未完成项。',
    transferSourceChanged: "附件在上传期间发生变化，已保留本地文件。",
    transferBusy: "另一个附件操作正在进行，请等待完成后再试。",
    transferNothingPending: "没有可恢复的上传任务。",
    transferServerChanged: "服务器地址已更改，请切回原服务器后恢复上传。",
    cmdResumeUpload: "恢复未完成上传",
    transferStop: "停止传输",
    transferStopping: "正在停止，将完成已传输文件的链接更新…",
    transferCancelled: "已停止，已完成的文件已处理。",
    transferRetry: "重试未完成项",
    noticeRemoteNotReady: "请先启用服务器并测试连接。",
    // 快捷控制中心
    hubBadge: '文件工具',
    hubTitle: 'File Master',
    hubSubtitle: '告别冗余附件与失效链接，云端秒传加速、零断链迁移，让知识库始终轻量整洁',
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
    btnInsert: '插入',
    btnNext: '下一步 ➔',
    btnSelectAll: '全选或取消全选',
    btnExportReport: '导出报告到知识库根目录',
    btnCancelScan: '⏹ 取消扫描',
    scanCancelled: '⏹ 已取消扫描任务',
    scanProgress: '⏳ 正在扫描 ({current}/{total}): {label}',

    // 新素材保存弹窗 (DestinationModal)
    destBadge: '附件插入',
    destTitle: '插入附件',
    destSubtitle: '选择附件存储位置',
    destTypeSize: '类型：.{ext}  |  大小：{size}',
    destFilenameLabel: '文件名',
    destFilenameHint: '输入文件名',
    destTargetNote: '目标笔记：{note}',
    destDestTitle: '存储位置',
    destRenameTitle: '重命名',
    destRenameOptional: '修改文件名（可选）',
    destSaveLocal: '💻 本地知识库',
    destSaveLocalDesc: '保存在本地附件文件夹',
    destSaveRemote: '☁️ 远程服务器',
    destSaveRemoteDesc: '上传至远程服务器',
    destInsertSuccess: '✅ 附件已保存并插入笔记',
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
    dupCompareRemote: '仅服务器文件',
    dupProtRuleHint: '🛡️ 保护规则：本地排除目录（{folders}）会自动跳过；开启了「🔒 防删除保护」的服务器文件将优先作为保留副本，绝不会被删除。',
    dupStrategyLabel: '保留策略：',
    dupStrategyAuto: '1. 自动选择保留副本（推荐）',
    dupStrategyPreferRemote: '2. 优先保留服务器文件，清理本地副本（知识库瘦身）',
    dupStrategyPreferLocal: '3. 优先保留本地文件，清理服务器重复副本',
    dupGroupHeader: '重复文件组 #{idx}（SHA-256: {hash}... | 体积: {size}）',
    dupGroupSubhint: '点击缩略图可放大预览；点击引用次数可查看关联笔记',
    dupTagKeep: '✅ 保留',
    dupTagProtected: '🔒 受保护',
    dupTagRemove: '🗑️ 清理',
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
    healthStep1Desc: '可检查笔记和白板中的内部链接、本地文件链接及网页链接。',
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
    noticeOpenMdFirst: '请先在编辑器中打开一篇笔记（Markdown、Canvas 或 Excalidraw）',
    noticeNoRemoteInActive: '当前笔记中没有服务器文件链接',
    noticeNoLocalInActive: '当前笔记中未找到本地附件引用',
    noticeAstroCopied: '✅ 已将包含公开 WebP 链接的笔记内容复制至剪贴板！',

    // 设置面板标签
    settingsTitle: 'File Master 设置',
    settingsBack: '返回设置首页',
    settingsCoreGroup: '核心功能',
    settingsPreferencesGroup: '系统偏好',
    settingsToolsGroup: '文件工具',
    settingsInfoGroup: '插件信息',
    tabGeneral: '常规偏好',
    tabServer: '服务器连接',
    tabUpload: '附件处理',
    tabExemptions: '保护与排除',

    // 常规与语言
    langName: '界面语言',
    langDesc: '设置 File Master 的界面语言',
    langAuto: '跟随 Obsidian',
    sidebarBtnName: '显示工具栏按钮',
    sidebarBtnDesc: '在 Obsidian 左侧工具栏显示 File Master 按钮',
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
    compatStatusTokenMissing: '🔴 缺少 API 令牌 · 请先在设置中填写 API Token',
    compatStatusServerError: '🔴 服务器响应异常 · HTTP {code}',
    compatStatusOffline: '⚪ 未连接 · 无法连接至该服务端地址 ({err})',

    // 上传与链接
    saveLocationName: '附件保存位置',
    saveLocationDesc: '粘贴或拖入附件时的默认保存位置（若选择上传服务器且当前离线，将自动安全回退为本地保存）',
    defaultSaveLocationName: '默认高亮存储位置',
    defaultSaveLocationDesc: '插入附件弹窗中默认选中的存储目标',
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
    uploadNonImageName: '处理非图片附件',
    uploadNonImageDesc: '开启后，音视频、PDF 等常见附件也将支持本地保存或云端迁移',
    destFixedLocalHint: '📌 已按设置固定保存至本地知识库',
    destFixedRemoteHint: '📌 已按设置固定上传至服务器',
    destFixedRemoteFallbackHint: '⚠️ 预设为上传至服务器，但当前服务器未连接，已自动切换为保存到本地',
    tagLocked: '已保护',
    remoteServerRequiredNotice: '请先在设置中配置并连接有效的服务器',

    // 保护与规则
    excludedFoldersName: '不扫描的目录',
    excludedFoldersDesc: '以逗号分隔的目录相对路径（如 templates, protected）。也可直接在文件树右键目录添加排除',
    excludeLockedRemoteName: '跳过受保护的服务器文件',
    excludeLockedRemoteDesc: '查找未引用文件和重复文件时，跳过开启防删除保护的服务器文件',
    openHubName: '功能面板',
    openHubDesc: '检查链接、整理文件并查看知识库概览',
    btnOpenHub: '打开 File Master',

    // 底部信息栏
    aboutTitle: '关于 File Master',
    aboutDesc: '在 Obsidian 中管理附件和链接，并通过自建服务器存储与分享文件。',
    aboutAuthor: '开发者',
    aboutRepo: '官方开源仓库',
    aboutFeedback: '问题反馈',
    aboutFeedbackLink: '打开 GitHub Issues',
    aboutServerCompat: '服务端兼容要求',
    aboutServerStatus: '关联服务端状态',
    aboutServerOffline: '未连接',

    // 右键上下文菜单
    menuMigrateFolder: 'File Master：批量上传此目录的附件...',
    menuRemoveExclusion: 'File Master：不再跳过此目录',
    menuAddExclusion: 'File Master：扫描时跳过此目录',
    menuUploadCloud: 'File Master：上传到服务器并更新链接',
    menuUploadProtected: 'File Master：上传到服务器保护目录',
    menuCopyRaw: 'File Master：复制原文件链接（{name}）',
    menuCopyWebp: 'File Master：复制 WebP 链接',
    menuDownloadToVault: 'File Master：下载到知识库并更新链接（{name}）',
    menuLockRemote: 'File Master：开启防删除保护（{name}）',
    menuActiveNoteMigrate: 'File Master：上传当前笔记的附件',
    menuActiveNoteDownload: 'File Master：下载当前笔记的服务器附件',
    menuActiveNoteAstro: 'File Master：复制当前笔记并使用 WebP 链接',

    // 命令面板命令
    cmdOpenHub: '打开 File Master',
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
    batchResultWarningTitle: '批量上传部分完成',
    batchResultErrorTitle: '批量上传失败',
    batchResultDesc: '已上传 {count} 个附件，更新 {docs} 篇笔记{trashed}。',
    batchResultFailuresPart: '；另有 {count} 个文件上传失败',
    batchResultTrashFailuresPart: '  |  ⚠️ {count} 个本地原文件清理失败',
    batchResultListTitle: '已迁移附件列表 ({count})',
    batchFailuresTitle: '上传失败项 ({count})',
    batchExportReport: '📄 导出迁移报告到根目录',
    batchOpenReport: '📂 打开报告',
    batchReportExported: '✅ 报告已生成',
    dupResultTitle: '重复文件已合并',
    dupResultDesc: '已更新 {modified} 篇笔记，处理知识库文件 {local} 个、服务器文件 {remote} 个{skipped}。',
    dupResultSkipped: '；另有 {count} 个仍被引用的文件已保留',
    orphanResultTitle: '未引用文件已处理',
    orphanResultDesc: '已处理 {count} 个文件：知识库 {local} 个，服务器 {remote} 个。',
    activeNoteModalTitle: '当前笔记',
    activeNoteMigrateTitle: '上传当前笔记的附件',
    activeNoteDownloadTitle: '下载当前笔记的服务器附件',
    activeNoteStep1Desc: '检测到当前笔记引用了以下 {count} 个本地附件，请确认要上传的文件及选项：',
    activeNoteBtnLockOff: '🔓 不锁定',
    activeNoteBtnLockOn: '🔒 锁定',
    activeNoteLockExplain: '💡 锁定说明：开启锁定后，文件上传到服务器后会被标记为「防删除保护」；后续在清理未引用文件或合并重复文件时将自动跳过该文件，防止误删。',
    activeNoteDeleteLocalOpt: '上传后删除本地原文件（移入回收站）',
    activeNoteOtherRefsBadge: '🔗 其他 {count} 篇笔记引用',
    activeNoteOnlyCurrentRef: '仅本篇引用',
    activeNoteInspectOtherRefs: '点击查看同样引用了此附件的其他笔记',
    activeNoteSyncOtherUploadOpt: '同步更新其他引用了相同附件的笔记链接（共涉及 {count} 篇其他笔记）',
    activeNoteSyncOtherUploadHintOn: '✅ 已开启同步更新：其他笔记中对该附件的引用也会一并更新为服务器链接，删除本地原文件不会产生任何断链。',
    activeNoteSyncOtherUploadHintOff: '🛡️ 未开启同步更新：仅更新当前笔记。为防止其他笔记出现断链，仍被其他笔记引用的本地原文件将自动保留、不会被删除。',
    activeNoteSyncOtherDownloadOpt: '同步将其他引用了相同服务器链接的笔记也更新为本地链接（共涉及 {count} 篇其他笔记）',
    activeNoteSyncOtherDownloadHintOn: '✅ 已开启同步更新：其他笔记中相同的服务器链接也会一并替换为下载后的本地文件链接。',
    activeNoteSyncOtherDownloadHintOff: 'ℹ️ 未开启同步更新：仅替换当前笔记中的链接，其他笔记继续保留原有的服务器链接。',
    activeNoteDownOtherRefsTitle: '🔗 检测到有附件同时出现在其他 {count} 篇笔记中',
    activeNoteDownOtherRefsDesc: '以下服务器附件在知识库的其他笔记中也有引用，请确认下载项及是否同步更新其他笔记的链接：',
    activeNoteStartUpload: '开始上传 ({count})',
    activeNoteStartDownload: '开始下载 ({count})',
    activeNoteSelectRequired: '请至少选择一个要处理的附件',
    activeNoteFailedTitle: '⚠️ 有 {failed} 个附件上传失败',
    activeNoteDownFailedTitle: '⚠️ 有 {failed} 个附件下载失败',
    activeNoteFailedTooLarge: '文件过大，超过服务器单文件 100 MB 限制',
    activeNoteFailedAuth: 'API 令牌无效或未授权，请检查服务器连接设置',
    activeNoteFailedNotFound: '服务器上未找到该文件 (404)',
    activeNoteFailedNetwork: '无法连接到服务器，请检查网络或服务器状态',
    activeNoteDownConflictTitle: '⚠️ 检测到本地已存在 {count} 个重复或同名文件',
    activeNoteDownConflictDesc: '已通过 SHA-256 内容哈希与文件名比对本地文件，请确认要处理的附件及冲突处理方式：',
    activeNoteDownTagHashAndName: '⚡ 同名且内容完全相同 (SHA-256 一致)',
    activeNoteDownTagHashOnly: '⚡ 本地已有相同内容文件 (SHA-256 一致)',
    activeNoteDownTagConflict: '⚠️ 已存在同名文件（内容不同）',
    activeNoteDownTagReady: '✅ 可直接下载',
    activeNoteDownTargetLabel: '目标路径：{path}',
    activeNoteDownExistingMatchLabel: '匹配本地文件：{path}',
    activeNoteDownStrategyTitle: '重复或同名文件处理方式',
    activeNoteDownOptReuse: '直接复用本地已有文件（不重复下载，直接更新笔记链接）',
    activeNoteDownOptRename: '保留两者并自动重命名（下载并保存为新副本）',
    activeNoteDownOptOverwrite: '覆盖本地已有文件（重新下载并替换本地文件）',
    activeNoteResultListTitle: '已处理的附件明细（{count}）',
    activeNoteBadgeDownloaded: '✅ 已下载',
    activeNoteBadgeReused: '🔗 已复用本地文件',
    activeNoteBadgeOverwritten: '🔄 已覆盖本地文件',
    activeNoteBadgeUploaded: '☁️ 已上传',
    activeNoteBadgeTrashedLocal: '🗑️ 已删本地原文件',
    activeNoteBadgeTrashFailed: '⚠️ 清理失败',
    activeNoteTrashFailedNotice: '⚠️ 上传成功，但有 {count} 个本地原文件清理失败（请检查是否有外部程序占用）',
    activeNoteBadgeKeptForOtherRefs: '🛡️ 其他 {count} 篇笔记仍引用，已保留原文件',
    activeNoteBadgeSyncedNotes: '🔗 同步更新其他 {count} 篇笔记',
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

    // 操作与调试日志
    opLogTitle: '操作与调试日志',
    opLogDesc: '查看插件最近的操作记录与错误详情，支持复制或导出日志文件以便排查问题',
    opLogBtnOpen: '查看日志',
    opLogFilterAll: '全部记录',
    opLogFilterErrors: '仅警告与错误',
    opLogSearchPlaceholder: '搜索日志内容或文件名...',
    opLogEmpty: '暂无符合条件的日志记录',
    opLogCopyAll: '📋 复制全部日志',
    opLogCopiedNotice: '✅ 已将诊断与操作日志复制到剪贴板',
    opLogExportFile: '📥 导出日志文件 (.log)',
    opLogClear: '🗑️ 清空日志',
    opLogClearedNotice: '已清空操作日志',
    opLogPathHint: '日志保存在插件目录（{path}），不会出现在知识库文件树或被扫描功能误扫。',
    cmdOpenOpLogs: '查看操作与调试日志',

    closeBtn: '关闭'
  },
  en: {
    pagePrevious: "Previous",
    pageNext: "Next",
    pageCount: "Page {current} of {total}",
    transferIntegrityFailed: "Content verification failed. Original files and links were preserved. Refresh the server list and retry.",
    transferReferencesChanged: 'Notes changed after the final check. Local files were preserved; retry unfinished files.',
    transferSourceChanged: "The attachment changed during upload. The local file was preserved.",
    transferBusy: "Another attachment operation is running. Wait for it to finish.",
    transferNothingPending: "No unfinished upload is available to resume.",
    transferServerChanged: "The server address changed. Switch back to the original server to resume.",
    cmdResumeUpload: "Resume unfinished upload",
    transferStop: "Stop transfer",
    transferStopping: "Stopping; finishing link updates for transferred files…",
    transferCancelled: "Stopped. Completed transfers have been finalized.",
    transferRetry: "Retry unfinished files",
    noticeRemoteNotReady: "Enable the server and test the connection first.",
    // Quick Hub
    hubBadge: 'File tools',
    hubTitle: 'File Master',
    hubSubtitle: 'Eliminate redundant attachments and broken links — instant cloud acceleration and zero-broken-link migration keep your vault fast and clean.',
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
    btnInsert: 'Insert',
    btnNext: 'Next ➔',
    btnSelectAll: 'Select or deselect all',
    btnExportReport: 'Export report to vault root',
    btnCancelScan: '⏹ Cancel Scan',
    scanCancelled: '⏹ Scan cancelled by user',
    scanProgress: '⏳ Scanning ({current}/{total}): {label}',

    // Destination Modal
    destBadge: 'Insert Attachment',
    destTitle: 'Insert attachment',
    destSubtitle: 'Choose storage location',
    destTypeSize: 'Type: .{ext}  |  Size: {size}',
    destFilenameLabel: 'Filename',
    destFilenameHint: 'Enter filename',
    destTargetNote: 'Target note: {note}',
    destDestTitle: 'Storage location',
    destRenameTitle: 'Rename',
    destRenameOptional: 'Edit filename (optional)',
    destSaveLocal: '💻 Local vault',
    destSaveLocalDesc: 'Save to local attachment folder',
    destSaveRemote: '☁️ Remote server',
    destSaveRemoteDesc: 'Upload to remote server',
    destInsertSuccess: '✅ Attachment saved and inserted into note',
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
    dupCompareRemote: 'Server files only',
    dupProtRuleHint: '🛡️ Protection Rules: Local excluded folders ({folders}) are skipped. Server files with "🔒 Protected Lock" are prioritized as keep targets and never deleted.',
    dupStrategyLabel: 'Strategy:',
    dupStrategyAuto: '1. Auto-select item to keep (Recommended)',
    dupStrategyPreferRemote: '2. Replace local files with remote copies (Vault Slimming)',
    dupStrategyPreferLocal: '3. Keep local files and remove remote duplicates',
    dupGroupHeader: 'Duplicate Group #{idx} (SHA-256: {hash}... | Size: {size})',
    dupGroupSubhint: 'Click thumbnail to inspect; click reference count to view notes',
    dupTagKeep: '✅ Keep',
    dupTagProtected: '🔒 Protected',
    dupTagRemove: '🗑️ Remove',
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
    healthStep1Desc: 'Can check internal links, local file links, and web links in notes and canvases.',
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
    noticeOpenMdFirst: 'Please open an active note (Markdown, Canvas, or Excalidraw) first.',
    noticeNoRemoteInActive: 'No server file links in this note.',
    noticeNoLocalInActive: 'No local attachments found to migrate in active note.',
    noticeAstroCopied: '✅ Copied active note text with public WebP links to clipboard!',

    // Settings Tabs
    settingsTitle: 'File Master settings',
    settingsBack: 'Back to settings',
    settingsCoreGroup: 'Core Features',
    settingsPreferencesGroup: 'Preferences',
    settingsToolsGroup: 'Tools & Logs',
    settingsInfoGroup: 'Plugin Information',
    tabGeneral: 'General',
    tabServer: 'Server Connection',
    tabUpload: 'Attachments',
    tabExemptions: 'Exemptions & Protection',

    // General & Language
    langName: 'Interface Language',
    langDesc: 'Choose the language for File Master',
    langAuto: 'Follow Obsidian',
    sidebarBtnName: 'Show ribbon button',
    sidebarBtnDesc: 'Show the File Master button in the left Obsidian ribbon',
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
    apiTokenDesc: 'API token from File Master Server',
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
    compatStatusAuthFail: '🔴 Authentication failed · API token is invalid or unauthorized (401)',
    compatStatusTokenMissing: '🔴 Missing API Token · Please enter your API Token in settings',
    compatStatusServerError: '🔴 Server error response · HTTP {code}',
    compatStatusOffline: '⚪ Offline · Unable to reach server at this address ({err})',

    // Upload & Links
    saveLocationName: 'Where to save attachments',
    saveLocationDesc: 'Default destination for pasted or dropped attachments (safely falls back to local vault if server is offline)',
    defaultSaveLocationName: 'Default storage destination',
    defaultSaveLocationDesc: 'Preselected storage destination when prompting to insert attachments',
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
    uploadNonImageName: 'Process non-image attachments',
    uploadNonImageDesc: 'Support audio, video, PDF and other attachments for local saving or remote migration',
    destFixedLocalHint: '📌 Configured to save to local vault',
    destFixedRemoteHint: '📌 Configured to upload to server',
    destFixedRemoteFallbackHint: '⚠️ Configured to upload to server, but server is offline. Falling back to local vault.',
    tagLocked: 'Locked',
    remoteServerRequiredNotice: 'Please configure and verify a remote server first.',

    // Protection & Rules
    excludedFoldersName: 'Folders to skip',
    excludedFoldersDesc: 'Comma-separated directory paths (e.g. templates, assets/protected). Or right-click any folder in file tree',
    excludeLockedRemoteName: 'Skip protected server files',
    excludeLockedRemoteDesc: 'Skip server files protected from deletion when finding unreferenced or duplicate files',
    openHubName: 'Open file tools',
    openHubDesc: 'Check links, organize files, and view vault statistics',
    btnOpenHub: 'Open File Master',

    // About Footer
    aboutTitle: 'About File Master',
    aboutDesc: 'Manage attachments and links in Obsidian, with optional self-hosted file storage and sharing.',
    aboutAuthor: 'Author',
    aboutRepo: 'GitHub Repository',
    aboutFeedback: 'Report an Issue',
    aboutFeedbackLink: 'Open GitHub Issues',
    aboutServerCompat: 'Server Compatibility',
    aboutServerStatus: 'Connected Server',
    aboutServerOffline: 'Offline',

    // Context Menus
    menuMigrateFolder: 'File Master: Upload attachments in this folder...',
    menuRemoveExclusion: 'File Master: Include this folder in scans',
    menuAddExclusion: 'File Master: Skip this folder in scans',
    menuUploadCloud: 'File Master: Upload to server and update links',
    menuUploadProtected: 'File Master: Upload to protected server folder',
    menuCopyRaw: 'File Master: Copy original file URL ({name})',
    menuCopyWebp: 'File Master: Copy WebP URL',
    menuDownloadToVault: 'File Master: Download to vault and update links ({name})',
    menuLockRemote: 'File Master: Protect from deletion ({name})',
    menuActiveNoteMigrate: 'File Master: Upload attachments in this note',
    menuActiveNoteDownload: 'File Master: Download server files in this note',
    menuActiveNoteAstro: 'File Master: Copy this note with WebP links',

    // Command Palette
    cmdOpenHub: 'Open File Master',
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
    batchResultWarningTitle: 'Batch upload partially complete',
    batchResultErrorTitle: 'Batch upload failed',
    batchResultDesc: 'Uploaded {count} attachments and updated {docs} notes{trashed}.',
    batchResultFailuresPart: '; {count} file(s) failed to upload',
    batchResultTrashFailuresPart: '  |  ⚠️ Failed to remove {count} local file(s)',
    batchResultListTitle: 'Migrated Assets ({count})',
    batchFailuresTitle: 'Upload Failures ({count})',
    batchExportReport: '📄 Export report to vault root',
    batchOpenReport: '📂 Open Report',
    batchReportExported: '✅ Report Generated',
    dupResultTitle: 'Duplicate files merged',
    dupResultDesc: 'Updated {modified} notes and processed {local} vault files and {remote} server files{skipped}.',
    dupResultSkipped: '; kept {count} files that are still referenced',
    orphanResultTitle: 'Unreferenced files processed',
    orphanResultDesc: 'Processed {count} files: {local} in the vault and {remote} on the server.',
    activeNoteModalTitle: 'Current note',
    activeNoteMigrateTitle: 'Upload attachments in this note',
    activeNoteDownloadTitle: 'Download server files in this note',
    activeNoteStep1Desc: 'Found {count} local attachments referenced in this note. Select files and options before uploading:',
    activeNoteBtnLockOff: '🔓 Unlocked',
    activeNoteBtnLockOn: '🔒 Locked',
    activeNoteLockExplain: '💡 About Lock: Locked files are marked with deletion protection on the server and automatically skipped when cleaning unreferenced or duplicate files.',
    activeNoteDeleteLocalOpt: 'Delete local files after upload (move to trash)',
    activeNoteOtherRefsBadge: '🔗 Referenced by {count} other note(s)',
    activeNoteOnlyCurrentRef: 'Only this note',
    activeNoteInspectOtherRefs: 'Click to view other notes referencing this attachment',
    activeNoteSyncOtherUploadOpt: 'Also update links in other notes referencing the same attachment ({count} other note(s))',
    activeNoteSyncOtherUploadHintOn: '✅ Sync enabled: Other notes referencing this attachment will also be updated to the server URL, so deleting the local file will not break any links.',
    activeNoteSyncOtherUploadHintOff: '🛡️ Sync disabled: Only this note will be updated. Local files still referenced by other notes will be automatically kept to prevent broken links.',
    activeNoteSyncOtherDownloadOpt: 'Also update the same server links in other notes to local links ({count} other note(s))',
    activeNoteSyncOtherDownloadHintOn: '✅ Sync enabled: Identical server links in other notes will also be updated to the local file.',
    activeNoteSyncOtherDownloadHintOff: 'ℹ️ Sync disabled: Only links in this note will be updated; other notes will keep their server links.',
    activeNoteDownOtherRefsTitle: '🔗 Attachment links also appear in {count} other note(s)',
    activeNoteDownOtherRefsDesc: 'These server attachments are also referenced in other notes. Confirm files to download and whether to sync links in other notes:',
    activeNoteStartUpload: 'Upload ({count})',
    activeNoteStartDownload: 'Download ({count})',
    activeNoteSelectRequired: 'Please select at least one attachment to process',
    activeNoteFailedTitle: '⚠️ {failed} attachment(s) failed to upload',
    activeNoteDownFailedTitle: '⚠️ {failed} attachment(s) failed to download',
    activeNoteFailedTooLarge: 'File too large (exceeds server 100 MB limit)',
    activeNoteFailedAuth: 'Invalid or unauthorized API token. Check server settings.',
    activeNoteFailedNotFound: 'File not found on server (404)',
    activeNoteFailedNetwork: 'Could not connect to server. Check network or server status.',
    activeNoteDownConflictTitle: '⚠️ Found {count} duplicate or same-named local file(s)',
    activeNoteDownConflictDesc: 'Compared both SHA-256 content hashes and filenames against local files. Confirm files and how to handle matches:',
    activeNoteDownTagHashAndName: '⚡ Same name & identical content (SHA-256 match)',
    activeNoteDownTagHashOnly: '⚡ Identical content exists locally (SHA-256 match)',
    activeNoteDownTagConflict: '⚠️ Same filename exists (different content)',
    activeNoteDownTagReady: '✅ Ready to download',
    activeNoteDownTargetLabel: 'Target path: {path}',
    activeNoteDownExistingMatchLabel: 'Matched local file: {path}',
    activeNoteDownStrategyTitle: 'How to handle duplicate or same-named files',
    activeNoteDownOptReuse: 'Reuse existing local file (skip download and update note links)',
    activeNoteDownOptRename: 'Keep both and auto-rename (download and save as a new copy)',
    activeNoteDownOptOverwrite: 'Overwrite existing local file (download and replace existing file)',
    activeNoteResultListTitle: 'Processed attachments ({count})',
    activeNoteBadgeDownloaded: '✅ Downloaded',
    activeNoteBadgeReused: '🔗 Reused local file',
    activeNoteBadgeOverwritten: '🔄 Overwritten',
    activeNoteBadgeUploaded: '☁️ Uploaded',
    activeNoteBadgeTrashedLocal: '🗑️ Local file trashed',
    activeNoteBadgeTrashFailed: '⚠️ Cleanup failed',
    activeNoteTrashFailedNotice: '⚠️ Upload succeeded, but {count} local file(s) failed to be moved to trash.',
    activeNoteBadgeKeptForOtherRefs: '🛡️ Kept (used in {count} other note(s))',
    activeNoteBadgeSyncedNotes: '🔗 Updated {count} other note(s)',
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

    // Operation & Debug Logs
    opLogTitle: 'Operation & debug logs',
    opLogDesc: 'View recent plugin operations and error details, or copy/export logs for troubleshooting',
    opLogBtnOpen: 'View logs',
    opLogFilterAll: 'All entries',
    opLogFilterErrors: 'Warnings & errors only',
    opLogSearchPlaceholder: 'Search logs or filenames...',
    opLogEmpty: 'No matching log entries found',
    opLogCopyAll: '📋 Copy all logs',
    opLogCopiedNotice: '✅ Copied diagnostic & operation logs to clipboard',
    opLogExportFile: '📥 Export log file (.log)',
    opLogClear: '🗑️ Clear logs',
    opLogClearedNotice: 'Cleared operation logs',
    opLogPathHint: 'Logs are saved in the plugin folder ({path}) and will never appear in the vault tree or trigger scans.',
    cmdOpenOpLogs: 'View operation & debug logs',

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
  if (e === 'md' || e === 'excalidraw') return 'note';
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

function computeSha256Pure(bytes) {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  const l = bytes.length;
  const bitLen = l * 8;
  const padLen = (l % 64 < 56) ? (56 - (l % 64)) : (120 - (l % 64));
  const totalLen = l + padLen + 8;
  const msg = new Uint8Array(totalLen);
  msg.set(bytes, 0);
  msg[l] = 0x80;

  const view = new DataView(msg.buffer);
  view.setUint32(totalLen - 4, bitLen >>> 0, false);
  view.setUint32(totalLen - 8, Math.floor(bitLen / 0x100000000), false);

  const w = new Uint32Array(64);
  const rotr = (n, x) => (x >>> n) | (x << (32 - n));

  for (let i = 0; i < totalLen; i += 64) {
    for (let j = 0; j < 16; j++) {
      w[j] = view.getUint32(i + j * 4, false);
    }
    for (let j = 16; j < 64; j++) {
      const s0 = rotr(7, w[j - 15]) ^ rotr(18, w[j - 15]) ^ (w[j - 15] >>> 3);
      const s1 = rotr(17, w[j - 2]) ^ rotr(19, w[j - 2]) ^ (w[j - 2] >>> 10);
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let j = 0; j < 64; j++) {
      const s1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + K[j] + w[j]) >>> 0;
      const s0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((x) => x.toString(16).padStart(8, '0')).join('');
}

async function computeSha256Hex(input) {
  if (!input) return '';
  let buffer = null;
  let uint8 = null;
  if (input instanceof ArrayBuffer) {
    buffer = input;
    uint8 = new Uint8Array(input);
  } else if (ArrayBuffer.isView(input)) {
    buffer = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
    uint8 = new Uint8Array(buffer);
  } else if (typeof input === 'string') {
    uint8 = new TextEncoder().encode(input);
    buffer = uint8.buffer;
  }
  if (!buffer || !uint8) return '';

  if (typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.digest) {
    try {
      const hashBuf = await crypto.subtle.digest('SHA-256', buffer);
      const bytes = new Uint8Array(hashBuf);
      let hex = '';
      for (let i = 0; i < bytes.length; i++) {
        hex += bytes[i].toString(16).padStart(2, '0');
      }
      return hex;
    } catch {}
  }
  return computeSha256Pure(uint8);
}

function getRandomHex(len = 4) {
  const bytesCount = Math.ceil(len / 2);
  const bytes = new Uint8Array(bytesCount);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytesCount; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex.slice(0, len);
}

function normalizePosixPath(filePath) {
  if (!filePath) return '';
  const isAbsolute = filePath.startsWith('/');
  const segments = filePath.split('/');
  const stack = [];
  for (const seg of segments) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (stack.length > 0 && stack[stack.length - 1] !== '..') {
        stack.pop();
      } else if (!isAbsolute) {
        stack.push('..');
      }
    } else {
      stack.push(seg);
    }
  }
  const joined = stack.join('/');
  return isAbsolute ? `/${joined}` : (joined || '.');
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

function formatDateYMD(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
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
    name.startsWith('Vault_Analytics_Report_') ||
    name.startsWith('Batch_Migrate_Report_')
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

    if (ext === 'md' || ext === 'excalidraw') {
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
      const rel = normalizePosixPath(`${docDir}/${c}`).replace(/^(\.\/)+/, '').replace(/^\/+/, '');
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
      const rel = normalizePosixPath(`${docDir}/${clean}`).replace(/^(\.\/)+/, '').replace(/^\/+/, '');
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
  if (options.checkWikiLinks !== false) {
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
  }

  // 2. Check Standard Markdown Links: ![alt](url) and [alt](url)
  const mdRegex = /(!?)\[([^\]\r\n]*)\]\((\s*<[^>]+>|[^\s)]+)(?:\s+["'][^"']*["'])?\)/g;
  let m;
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
    } else if (options.checkLocalMarkdown !== false) {
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
    return getRandomHex(l);
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
 * Detects whether text content belongs to an Excalidraw drawing file
 * Checks frontmatter (excalidraw-plugin: parsed/raw or excalidraw: true)
 * as well as body markers (# Excalidraw Data, ## Embedded Files).
 */
function isExcalidrawContent(content) {
  if (typeof content !== 'string' || !content) return false;
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (fmMatch) {
    const fm = fmMatch[1];
    if (
      /^\s*excalidraw-plugin:\s*(?:parsed|raw)\b/im.test(fm) ||
      /^\s*excalidraw:\s*true\b/im.test(fm)
    ) {
      return true;
    }
  }
  return (
    /^#+\s+Excalidraw Data\b/im.test(content) ||
    (content.includes('## Embedded Files') && content.includes('## Text Elements')) ||
    (content.includes('## Embedded files') && content.includes('## Text elements'))
  );
}

/**
 * Checks whether a document references a local file without substring false-positives
 * (e.g., "1.png" must not falsely match "21.png" or "my_1.png").
 */
/**
 * Checks whether a file is an Excalidraw drawing note regardless of extension.
 * Handles .excalidraw.md, .excalidraw, frontmatter cache, and file content.
 */
function isExcalidrawFile(file, app = null, content = null) {
  if (!file) return false;
  const name = String(file.name || '');
  const ext = String(file.extension || getExt(name)).toLowerCase();
  if (name.endsWith('.excalidraw.md') || ext === 'excalidraw') {
    return true;
  }
  if (app && app.metadataCache && typeof app.metadataCache.getFileCache === 'function') {
    const cache = app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter;
    if (fm && (fm['excalidraw-plugin'] || fm['excalidraw'] === true || (Array.isArray(fm['tags']) && fm['tags'].includes('excalidraw')))) {
      return true;
    }
  }
  if (typeof content === 'string') {
    return isExcalidrawContent(content);
  }
  return false;
}

/**
 * Checks whether a file is a document/note (Markdown, Canvas, or Excalidraw)
 */
function isDocFile(file, app = null) {
  if (!file) return false;
  const ext = String(file.extension || getExt(file.name)).toLowerCase();
  return ext === 'md' || ext === 'canvas' || ext === 'excalidraw' || isExcalidrawFile(file, app);
}

/**
 * Rewrites image/asset links inside Excalidraw's '## Embedded Files' section.
 * Excalidraw requires bare URLs (e.g. '<fileId>: https://...'), whereas Markdown bracket
 * syntax '[alt](url)' breaks Excalidraw parser and renders grey boxes.
 */
function rewriteExcalidrawEmbeddedFiles(content, removeItem, keepItem, context = {}) {
  if (typeof content !== 'string' || !content) return content;

  const sectionRegex = /(^##\s+Embedded [Ff]iles\s*?\r?\n)([\s\S]*?)(?=(?:\r?\n## |\r?\n%%|\r?\n# |$))/m;
  const match = sectionRegex.exec(content);
  if (!match) return content;

  const header = match[1];
  const sectionBody = match[2];
  const lines = sectionBody.split(/\r?\n/);

  const localPathTargets = new Set();
  const localNameTargets = new Set();
  const remoteUrlTargets = new Set();
  const remotePathTargets = new Set();

  if (removeItem.source === 'local') {
    const disp = (removeItem.displayPath || '').replace(/^\.?\//, '').toLowerCase();
    const name = (removeItem.name || '').toLowerCase();
    if (disp) {
      localPathTargets.add(disp);
      try {
        localPathTargets.add(decodeURIComponent(disp));
        localPathTargets.add(encodeURI(disp).toLowerCase());
      } catch {}
    }
    if (name) {
      localNameTargets.add(name);
      try {
        localNameTargets.add(decodeURIComponent(name));
        localNameTargets.add(encodeURIComponent(name).toLowerCase());
      } catch {}
    }
  } else {
    const r = removeItem.rawObj || {};
    if (r.rawUrl) {
      const u1 = r.rawUrl.toLowerCase();
      remoteUrlTargets.add(u1);
      remoteUrlTargets.add(u1.split(/[?#]/)[0]);
    }
    if (r.pubUrl) {
      const u2 = r.pubUrl.toLowerCase();
      remoteUrlTargets.add(u2);
      remoteUrlTargets.add(u2.split(/[?#]/)[0]);
    }
    const year = r.year || removeItem.year;
    const month = r.month || removeItem.month;
    const fname = (removeItem.filename || removeItem.name || '').toLowerCase();
    if (year && month && fname) {
      const p1 = `${year}/${month}/${fname}`.toLowerCase();
      remotePathTargets.add(p1);
      try {
        remotePathTargets.add(decodeURIComponent(p1));
        remotePathTargets.add(`${year}/${month}/${encodeURIComponent(fname)}`.toLowerCase());
      } catch {}
    }
  }

  let bodyChanged = false;
  const updatedLines = lines.map((line) => {
    const lineMatch = line.match(/^([a-zA-Z0-9_\-]+:\s*)(.*)$/);
    if (!lineMatch) return line;

    const prefix = lineMatch[1];
    const val = lineMatch[2].trim();
    if (!val) return line;

    let rawRef = val;
    const mdImg = val.match(/^!?\[[^\]]*\]\(([^)]+)\)$/);
    if (mdImg) rawRef = mdImg[1].trim();

    const wikiM = rawRef.match(/^!?\[\[([^\]|#]+)/);
    if (wikiM) rawRef = wikiM[1].trim();

    const cleanRef = rawRef.replace(/^\.?\//, '').trim();
    const cleanRefLower = cleanRef.toLowerCase();
    let decodedRefLower = cleanRefLower;
    try { decodedRefLower = decodeURIComponent(cleanRefLower); } catch {}

    const isUrl = /^https?:\/\//i.test(cleanRef);
    const hasPathSlash = cleanRef.includes('/');

    let isMatch = false;

    if (removeItem.source === 'local') {
      if (isUrl) {
        isMatch = false;
      } else if (hasPathSlash) {
        // Full path matching: prevents attachments/b/diagram.png from matching attachments/a/diagram.png
        isMatch = localPathTargets.has(cleanRefLower) || localPathTargets.has(decodedRefLower);
      } else {
        // Bare filename without path (e.g. [[diagram.png]])
        if (typeof context?.resolveLink === 'function') {
          const resolved = context.resolveLink(cleanRef);
          if (resolved) {
            const resLower = resolved.toLowerCase().replace(/^\.?\//, '');
            let decodedResLower = resLower;
            try { decodedResLower = decodeURIComponent(resLower); } catch {}
            isMatch = localPathTargets.has(resLower) || localPathTargets.has(decodedResLower);
          } else {
            // Cannot resolve or ambiguous destination -> preserve link safely
            isMatch = false;
          }
        } else {
          isMatch = localNameTargets.has(cleanRefLower) || localNameTargets.has(decodedRefLower);
        }
      }
    } else {
      // removeItem.source === 'remote'
      const cleanRefWithoutQuery = cleanRefLower.split(/[?#]/)[0];
      const decodedRefWithoutQuery = decodedRefLower.split(/[?#]/)[0];
      if (isUrl) {
        if (
          remoteUrlTargets.has(cleanRefLower) ||
          remoteUrlTargets.has(decodedRefLower) ||
          remoteUrlTargets.has(cleanRefWithoutQuery) ||
          remoteUrlTargets.has(decodedRefWithoutQuery)
        ) {
          isMatch = true;
        } else {
          try {
            const u = new URL(cleanRef);
            const pathPart = u.pathname.replace(/^\/(?:raw|pub)\//i, '').replace(/^\//, '').toLowerCase();
            let decodedPathPart = pathPart;
            try { decodedPathPart = decodeURIComponent(pathPart); } catch {}
            if (remotePathTargets.has(pathPart) || remotePathTargets.has(decodedPathPart)) {
              const r = removeItem.rawObj || {};
              const targetUrl = r.rawUrl || r.pubUrl;
              if (targetUrl) {
                const targetU = new URL(targetUrl);
                if (u.origin.toLowerCase() === targetU.origin.toLowerCase()) {
                  isMatch = true;
                }
              }
            }
          } catch {}
        }
      } else if (hasPathSlash) {
        const p = cleanRefWithoutQuery.replace(/^(?:raw|pub)\//, '');
        const decP = decodedRefWithoutQuery.replace(/^(?:raw|pub)\//, '');
        isMatch = remotePathTargets.has(p) || remotePathTargets.has(decP);
      } else {
        isMatch = false;
      }
    }

    if (!isMatch) return line;

    bodyChanged = true;
    if (keepItem.source === 'remote') {
      return `${prefix}${keepItem.rawObj.rawUrl}`;
    } else {
      return `${prefix}[[${keepItem.displayPath}]]`;
    }
  });

  if (!bodyChanged) return content;

  const newSection = header + updatedLines.join('\n');
  return content.slice(0, match.index) + newSection + content.slice(match.index + match[0].length);
}

/** Match all reference candidates in one pass through each document. */
function createTextReferenceMatcher(patterns) {
  const nodes = [{ next: new Map(), fail: 0, outputs: [] }];
  for (const pattern of patterns) {
    const value = String(pattern.value || '').toLowerCase();
    if (!value) continue;
    let state = 0;
    for (let i = 0; i < value.length; i++) {
      const char = value[i];
      if (!nodes[state].next.has(char)) {
        nodes[state].next.set(char, nodes.length);
        nodes.push({ next: new Map(), fail: 0, outputs: [] });
      }
      state = nodes[state].next.get(char);
    }
    nodes[state].outputs.push({ ...pattern, length: value.length });
  }
  const queue = [...nodes[0].next.values()];
  for (let head = 0; head < queue.length; head++) {
    const state = queue[head];
    for (const [char, next] of nodes[state].next) {
      queue.push(next);
      let fallback = nodes[state].fail;
      while (fallback && !nodes[fallback].next.has(char)) fallback = nodes[fallback].fail;
      nodes[next].fail = nodes[fallback].next.get(char) || 0;
      nodes[next].outputs = nodes[next].outputs.concat(nodes[nodes[next].fail].outputs);
    }
  }
  return (input) => {
    const text = String(input || '').toLowerCase();
    const found = new Set();
    let state = 0;
    // Code units keep offsets consistent with JavaScript string indices.
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      while (state && !nodes[state].next.has(char)) state = nodes[state].fail;
      state = nodes[state].next.get(char) || 0;
      for (const pattern of nodes[state].outputs) {
        const start = i + 1 - pattern.length;
        if (pattern.wiki) {
          if (!/[\]|#]/.test(text[i + 1] || '')) continue;
        } else if (pattern.boundary) {
          if (start > 0 && !/[\[\(<"':/\\\s]/.test(text[start - 1])) continue;
          if (i + 1 < text.length && !/[\]\)>"'|#?\s]/.test(text[i + 1])) continue;
        }
        found.add(pattern.id);
      }
    }
    return found;
  };
}

function stripRemoteReferenceText(input) {
  return String(input || '')
    .replace(/!?\[[^\]]*\]\(https?:\/\/[^)]+\)/gi, '')
    .replace(/https?:\/\/[^\s)"'\]>]+/gi, '');
}

function createLocalReferenceMatcher(files, isDrawing) {
  const patterns = [];
  for (const file of files) {
    for (const value of new Set([file.path, file.name])) {
      patterns.push({ value, id: file.path, boundary: true });
    }
    if (file.extension === 'md' || file.extension === 'excalidraw' || isDrawing(file)) {
      patterns.push({ value: `[[${file.basename || getBaseName(file.name)}`, id: file.path, wiki: true });
    }
  }
  return createTextReferenceMatcher(patterns);
}

function addReference(index, target, source) {
  if (target === source) return;
  if (!index.has(target)) index.set(target, new Set());
  index.get(target).add(source);
}

function throwIfTransferCancelled(signal) {
  if (signal?.aborted) throw Object.assign(new Error('TRANSFER_CANCELLED'), { name: 'AbortError' });
}

function transferDelay(ms, signal) {
  return new Promise((resolve, reject) => {
    const cancelled = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error('TRANSFER_CANCELLED'), { name: 'AbortError' }));
    };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', cancelled); resolve(); }, ms);
    if (signal?.aborted) cancelled();
    else signal?.addEventListener('abort', cancelled, { once: true });
  });
}

async function requestWithBackoff(request, { signal, delay = transferDelay, maxRetries = 4 } = {}) {
  for (let attempt = 0; ; attempt++) {
    throwIfTransferCancelled(signal);
    let response;
    try {
      response = await request();
      if (attempt >= maxRetries || ![429, 500, 502, 503, 504].includes(response.status)) return response;
    } catch (err) {
      if (signal?.aborted || attempt >= maxRetries || err.name === 'AbortError') throw err;
    }
    const headers = response?.headers || {};
    const retryAfter = headers['retry-after'] ?? headers['Retry-After'];
    let wait = retryAfter !== undefined && Number.isFinite(Number(retryAfter))
      ? Number(retryAfter) * 1000 : Number.isFinite(Date.parse(retryAfter))
        ? Math.max(0, Date.parse(retryAfter) - Date.now()) : null;
    if (wait === null && response?.status === 429) {
      try { if (response.json?.retryAfter) wait = Number(response.json.retryAfter) * 1000; } catch {}
    }
    await delay(Math.min(120000, Math.max(250, wait ?? 1000 * (2 ** attempt) + Math.random() * 250)), signal);
  }
}

async function runAttachmentOperation(plugin, task, signal) {
  if (plugin.attachmentOperationRunning) throw new Error(plugin.t('transferBusy'));
  plugin.attachmentOperationRunning = true;
  const controller = new AbortController();
  const cancelled = () => controller.abort();
  if (signal?.aborted) cancelled();
  else signal?.addEventListener('abort', cancelled, { once: true });
  plugin.activeTransferController = controller;
  try { return await task(controller.signal); }
  finally {
    signal?.removeEventListener('abort', cancelled);
    plugin.activeTransferController = null;
    plugin.attachmentOperationRunning = false;
  }
}

/** One read/atomic transform per affected document, against its latest contents. */
async function rewriteAttachmentPairs(plugin, pairs, documentPaths = null) {
  const snapshot = await plugin.buildVaultReferenceSnapshot({ freshRead: true });
  const remoteItems = pairs.filter((p) => p.removeItem.source === 'remote').map((p) => p.removeItem.rawObj);
  if (remoteItems.length) await plugin.indexRemoteReferences(remoteItems, snapshot);
  const allowed = documentPaths ? new Set(documentPaths) : null;
  const byDocument = new Map();
  const changedPaths = new Map(pairs.map((pair) => [pair, []]));
  for (const pair of pairs) {
    const refs = pair.removeItem.source === 'local'
      ? plugin.findReferencingNotesForLocalFile(pair.removeItem.rawObj, snapshot)
      : plugin.findReferencingNotesForRemoteItem(pair.removeItem.rawObj, snapshot);
    for (const path of refs) {
      if (allowed && !allowed.has(path)) continue;
      if (!byDocument.has(path)) byDocument.set(path, []);
      byDocument.get(path).push(pair);
    }
  }
  const modified = new Set();
  for (const doc of snapshot.docContents) {
    const relevant = byDocument.get(doc.path);
    if (!relevant) continue;
    const changedPairs = new Set();
    const changed = await plugin.safeModifyFileContent(doc.file, (current) => {
      let next = current;
      for (const pair of relevant) {
        const updated = plugin.rewriteContentLinks(next, pair.removeItem, pair.keepItem, doc.path);
        if (updated !== next) changedPairs.add(pair);
        next = updated;
      }
      return next;
    });
    if (changed) {
      modified.add(doc.path);
      for (const pair of changedPairs) changedPaths.get(pair).push(doc.path);
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return { modified, changedPaths };
}

function migrationCheckpointPath(plugin) {
  return plugin.getLogFilePath().replace(/operation\.log$/, 'migration-pending.json');
}

async function saveMigrationCheckpoint(plugin, items, options) {
  const adapter = plugin.app.vault.adapter;
  if (!adapter) return;
  const path = migrationCheckpointPath(plugin);
  if (!items.length) {
    if (await adapter.exists(path)) await adapter.remove(path);
    return;
  }
  await adapter.write(path, JSON.stringify({ version: 1, serverUrl: plugin.getCleanServerUrl(),
    options: { deleteLocalAfter: Boolean(options.deleteLocalAfter), documentPaths: options.documentPaths || null },
    items: items.map((entry) => ({ path: (entry.tfile || entry.rawObj || entry).path, locked: Boolean(entry.locked) })) }));
}

async function migrateLocalAttachments(plugin, items, options = {}, onProgress = null) {
  await saveMigrationCheckpoint(plugin, items, options);
  const uploaded = [], failures = [], retryItems = [];
  for (let i = 0; i < items.length; i++) {
    if (options.signal?.aborted) { retryItems.push(...items.slice(i)); break; }
    const entry = items[i];
    const tfile = entry.tfile || entry.rawObj || entry;
    const sourceVersion = { ...tfile.stat };
    onProgress?.(i + 1, items.length, tfile.name);
    try {
      const bytes = await plugin.app.vault.readBinary(tfile);
      const remote = await plugin.uploadBufferToServer(bytes, tfile.name, 'application/octet-stream', { signal: options.signal });
      if (entry.locked && !remote.locked) {
        await plugin.toggleRemoteFileLock(remote.year, remote.month, remote.filename, true);
        remote.locked = true;
      }
      uploaded.push({ entry, tfile, sourceVersion, sourceSha: remote.sha256,
        removeItem: { source: 'local', name: tfile.name, ext: tfile.extension.toLowerCase(), displayPath: tfile.path, rawObj: tfile },
        keepItem: { source: 'remote', name: remote.filename, ext: getExt(remote.filename),
          displayPath: `${remote.year}/${remote.month}/${remote.filename}`, rawObj: remote } });
    } catch (err) {
      retryItems.push(entry);
      if (err.name === 'AbortError') { retryItems.push(...items.slice(i + 1)); break; }
      failures.push({ name: tfile.name, path: tfile.path, size: tfile.stat?.size || 0, error: err.message || String(err) });
      plugin.logOperation('ERROR', 'BATCH_UPLOAD', `Failed to upload ${tfile.path}`, { error: err.message });
    }
  }

  for (let i = uploaded.length - 1; i >= 0; i--) {
    const pair = uploaded[i];
    if (pair.sourceVersion.mtime !== pair.tfile.stat?.mtime || pair.sourceVersion.size !== pair.tfile.stat?.size) {
      if (await computeSha256Hex(await plugin.app.vault.readBinary(pair.tfile)) !== pair.sourceSha) {
        uploaded.splice(i, 1);
        retryItems.push(pair.entry);
        failures.push({ name: pair.tfile.name, path: pair.tfile.path, size: pair.tfile.stat?.size || 0,
          error: plugin.t('transferSourceChanged') });
      }
    }
  }

  // Finish already completed transfers even when cancellation was requested.
  const rewritten = uploaded.length ? await rewriteAttachmentPairs(plugin, uploaded, options.documentPaths)
    : { modified: new Set(), changedPaths: new Map() };
  const postSnapshot = uploaded.length && options.deleteLocalAfter
    ? await plugin.buildVaultReferenceSnapshot({ freshRead: true }) : null;
  const trashedFiles = [], trashFailures = [], processedItems = [];
  for (const pair of uploaded) {
    const { tfile, keepItem } = pair;
    const remote = keepItem.rawObj;
    const syncedPaths = (rewritten.changedPaths.get(pair) || []).filter((p) => p !== options.activeFile?.path);
    const remaining = postSnapshot ? plugin.findReferencingNotesForLocalFile(tfile, postSnapshot) : [];
    const result = { source: 'remote', name: remote.filename, ext: keepItem.ext, displayPath: keepItem.displayPath,
      localPath: tfile.path, size: tfile.stat?.size || 0, locked: Boolean(remote.locked), rawObj: remote,
      rawUrl: remote.rawUrl, pubUrl: remote.pubUrl, action: 'uploaded', trashedLocal: false,
      keptForOtherRefs: remaining.length, keptForOtherRefPaths: remaining,
      syncedOtherNotes: syncedPaths.length, syncedOtherNotePaths: syncedPaths,
      refNotesCount: pair.entry.refNotes?.length || 0 };
    if (postSnapshot && !remaining.length) {
      try {
        // An attachment may have been edited or replaced during a long upload.
        const latest = await plugin.app.vault.readBinary(tfile);
        if (await computeSha256Hex(latest) !== pair.sourceSha) throw new Error(plugin.t('transferSourceChanged'));
        if (!plugin.isReferenceSnapshotCurrent(postSnapshot)) throw new Error(plugin.t('transferReferencesChanged'));
        await plugin.app.vault.trash(tfile, true);
        result.trashedLocal = true;
        trashedFiles.push(tfile.path);
      } catch (err) {
        result.trashError = err.message || String(err);
        trashFailures.push({ path: tfile.path, error: result.trashError });
        retryItems.push(pair.entry);
      }
    }
    processedItems.push(result);
  }
  await saveMigrationCheckpoint(plugin, retryItems, options);
  const summary = { count: uploaded.length, docs: rewritten.modified.size,
    modifiedNotePaths: [...rewritten.modified], trashed: trashedFiles.length, trashedFiles,
    processedItems, failures, trashFailures, retryItems, cancelled: Boolean(options.signal?.aborted),
    totalBytes: processedItems.reduce((sum, item) => sum + item.size, 0) };
  plugin.logOperation('INFO', 'BATCH_UPLOAD', `Uploaded ${summary.count}, updated ${summary.docs}, trashed ${summary.trashed}`, {
    failures: failures.length, unfinished: retryItems.length, cancelled: summary.cancelled
  });
  return summary;
}

const REMOTE_GALLERY_PAGE_SIZE = 60;

function filterRemoteGallery(view) {
  return view.items.filter((item) => {
    if (view.selectedBucket !== 'all' && `${item.year}/${item.month}` !== view.selectedBucket) return false;
    if (view.selectedType !== 'all' && getFileTypeGroup(getExt(item.name || item.filename)) !== view.selectedType) return false;
    return !view.searchQuery || (item.name || item.filename || '').toLowerCase().includes(view.searchQuery);
  });
}

function getRemoteGalleryPage(view, filtered) {
  const key = `${view.selectedBucket}:${view.selectedType}:${view.searchQuery}`;
  if (key !== view.galleryFilterKey) { view.galleryPage = 0; view.galleryFilterKey = key; }
  const totalPages = Math.max(1, Math.ceil(filtered.length / REMOTE_GALLERY_PAGE_SIZE));
  view.galleryPage = Math.min(Math.max(0, view.galleryPage || 0), totalPages - 1);
  return { current: view.galleryPage, totalPages,
    items: filtered.slice(view.galleryPage * REMOTE_GALLERY_PAGE_SIZE, (view.galleryPage + 1) * REMOTE_GALLERY_PAGE_SIZE) };
}

function renderRemoteGallery(view, containerEl, countLabel) {
  containerEl.empty();
  if (view.layoutMode === 'list') {
    containerEl.addClass('is-list');
  } else {
    containerEl.removeClass('is-list');
  }

  const filtered = view.filterItems();
  const totalBytes = filtered.reduce((s, i) => s + (i.size || 0), 0);

  if (countLabel) {
    countLabel.empty();
    countLabel.createSpan({ cls: 'fm-gallery-stats-count', text: view.t('galleryFileCount', { count: filtered.length }) });
    countLabel.createSpan({ cls: 'fm-gallery-stats-size', text: view.t('galleryTotalSize', { size: formatBytes(totalBytes) }) });
  }

  if (filtered.length === 0) {
    containerEl.createDiv({
      cls: 'fm-section-box',
      text: view.t('galleryEmpty'),
      attr: { style: 'grid-column: 1 / -1; text-align: center; padding: 30px 10px; color: var(--text-muted); font-size:12px;' }
    });
    return;
  }

  const page = getRemoteGalleryPage(view, filtered);
  for (const item of page.items) {
    const card = containerEl.createDiv({ cls: 'fm-gallery-card' + (view.layoutMode === 'list' ? ' is-list' : '') });
    const thumbWrap = card.createDiv({ cls: 'fm-gallery-thumb-wrap' });

    const ext = getExt(item.name || item.filename);
    const isImg = IMAGE_EXTS.has(ext);

    if (isImg) {
      const img = thumbWrap.createEl('img', {
        cls: 'fm-gallery-thumb',
        attr: {
          loading: 'lazy',
          src: item.thumbnailUrl || item.pubUrl || item.rawUrl,
          alt: item.name || item.filename
        }
      });
      img.onerror = () => {
        img.style.display = 'none';
        thumbWrap.createSpan({ text: '🖼️', attr: { style: 'font-size:24px;' } });
      };
    } else {
      thumbWrap.createDiv({
        text: ext.toUpperCase(),
        attr: { style: 'font-size: 14px; font-weight: 700; color: var(--text-muted);' }
      });
    }

    // Lock badge (click to unlock if locked and not protected)
    if (item.locked) {
      const lockBadge = thumbWrap.createSpan({
        cls: 'fm-gallery-lock-badge',
        text: '🔒',
        attr: { title: view.t('galleryBtnUnlock') }
      });
      lockBadge.onclick = async (e) => {
        e.stopPropagation();
        try {
          await view.plugin.toggleRemoteFileLock(item.year, item.month, item.filename, false);
          item.locked = false;
          view.renderGrid(containerEl, countLabel);
        } catch (err) {
          new Notice(view.t('previewLockFailed', { err: err.message }));
        }
      };
    }

    thumbWrap.onclick = () => {
      new ImageLightboxModal(view.app, view.plugin, {
        source: 'remote',
        name: item.name || item.filename,
        displayPath: `${item.year}/${item.month}/${item.filename}`,
        size: item.size,
        rawObj: item
      }, (action, target) => {
        if (action === 'deleted') {
          view.items = view.items.filter((i) => !(i.year === target.year && i.month === target.month && i.filename === target.filename));
        }
        view.renderGrid(containerEl, countLabel);
      }).open();
    };
    thumbWrap.setAttribute('role', 'button');
    thumbWrap.setAttribute('tabindex', '0');
    thumbWrap.setAttribute('aria-label', view.t('galleryBtnPreview'));
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
    const isWebpMode = view.insertMode === 'webp' && item.pubUrl;
    const insertTargetUrl = isWebpMode ? item.pubUrl : (item.rawUrl || item.pubUrl);
    const fn = item.name || item.filename;

    const insertBtn = actions.createEl('button', {
      cls: 'fm-gallery-insert-btn mod-cta',
      attr: { title: isWebpMode ? view.t('galleryInsertedWebp') : view.t('galleryInsertedRaw') }
    });
    setIcon(insertBtn.createSpan(), 'file-input');
    insertBtn.createSpan({ cls: 'fm-gallery-insert-label', text: view.t('galleryBtnInsert') });
    insertBtn.setAttribute('aria-label', view.t('galleryBtnInsert'));
    insertBtn.onmousedown = (e) => {
      // Prevent clicking button from blurring or moving cursor in Markdown editor
      e.preventDefault();
    };
    insertBtn.onclick = () => {
      const mdSnippet = isImg ? `![${fn}](${insertTargetUrl})\n` : `[${fn}](${insertTargetUrl})\n`;
      const noticeMsg = isWebpMode ? view.t('galleryInsertedWebp') : view.t('galleryInsertedRaw');
      view.plugin?.insertMarkdownToActiveEditor(mdSnippet, noticeMsg);
    };
  }

  if (page.totalPages > 1) {
    const pager = containerEl.createDiv({ cls: 'fm-gallery-pagination' });
    const previous = pager.createEl('button', { text: view.t('pagePrevious') });
    previous.disabled = page.current === 0;
    previous.onclick = () => { view.galleryPage--; view.renderGrid(containerEl, countLabel); };
    pager.createSpan({ text: view.t('pageCount', { current: page.current + 1, total: page.totalPages }) });
    const next = pager.createEl('button', { text: view.t('pageNext') });
    next.disabled = page.current + 1 === page.totalPages;
    next.onclick = () => { view.galleryPage++; view.renderGrid(containerEl, countLabel); };
  }
}

/**
 * Helper to return from a module modal back to the main File Master Hub modal
 * when the modal was opened from the Hub; otherwise simply closes the modal.
 */
function returnToHub(modal) {
  modal.close();
  if (!modal.fromHub) return;
  if (modal.plugin && typeof modal.plugin.openModalSafely === 'function') {
    modal.plugin.openModalSafely(new FileMasterHubModal(modal.app, modal.plugin));
  } else if (modal.app && modal.plugin) {
    new FileMasterHubModal(modal.app, modal.plugin).open();
  }
}

/**
 * Helper to translate raw HTTP/server error strings into localized UI descriptions
 */
function formatFriendlyError(modal, rawErr) {
  const errStr = String(rawErr || '').trim();
  const t = (k, p) => (modal && typeof modal.t === 'function' ? modal.t(k, p) : modal?.plugin?.t ? modal.plugin.t(k, p) : errStr);
  if (/file too large|too large|413/i.test(errStr)) {
    return t('activeNoteFailedTooLarge');
  }
  if (/401|unauthorized|invalid.*token/i.test(errStr)) {
    return t('activeNoteFailedAuth');
  }
  if (/404|not found/i.test(errStr)) {
    return t('activeNoteFailedNotFound');
  }
  if (/network|fetch|econnrefused|offline/i.test(errStr)) {
    return t('activeNoteFailedNetwork');
  }
  return errStr;
}

/**
 * Helper to create a real-time scan progress bar + cancel button inside wizard modals
 */
function createScanProgressWidget(contentEl, plugin) {
  const abortController = new AbortController();
  const box = contentEl.createDiv({
    cls: 'fm-section-box fm-scan-progress-box',
    attr: { style: 'display:none; margin-top:10px; border-color: rgba(59, 130, 246, 0.45);' }
  });
  box.style.display = 'none';
  const topRow = box.createDiv({
    cls: 'fm-scan-progress-top',
    attr: { style: 'display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:8px; width:100%;' }
  });
  const statusText = topRow.createSpan({
    text: plugin ? plugin.t('scanPreparing') : '⏳ Preparing scan...',
    cls: 'fm-scan-progress-text',
    attr: { style: 'font-size:12px; color:var(--text-accent); font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1;' }
  });
  const cancelScanBtn = topRow.createEl('button', {
    text: plugin ? plugin.t('btnCancelScan') : '⏹ Cancel Scan',
    cls: 'fm-mini-btn mod-warning fm-scan-cancel-btn',
    attr: { style: 'flex-shrink:0; margin-left:auto;' }
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
        attr: { style: 'text-align: center; padding: 30px 16px;' }
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
        attr: { style: 'text-align: center; padding: 24px;' }
      });
    } else {
      const listEl = contentEl.createDiv({ cls: 'fm-scroll-list' });
      for (const notePath of this.refNotePaths) {
        const row = listEl.createDiv({ cls: 'fm-list-item' });
        row.createSpan({ text: `📝 ${notePath}`, attr: { style: 'word-break: break-all; font-weight: 500;' } });
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
    this.options = options || {};   // { askLocation, fixedLocation, promptRename, plugin, editor, activeFile }
    this.callback = callback;
    this.plugin = this.options.plugin;
    const isRemote = Boolean(this.plugin?.isRemoteServerReady?.());
    if (this.options.fixedLocation === 'local') {
      this.targetLocation = 'local';
    } else if (this.options.fixedLocation === 'remote') {
      this.targetLocation = isRemote ? 'remote' : 'local';
    } else {
      const userPref = this.plugin?.settings?.defaultSaveLocation || 'remote';
      this.targetLocation = (!isRemote || userPref === 'local') ? 'local' : 'remote';
    }
    this.finalFilename = `${fileInfo.defaultBaseName}.${fileInfo.ext}`;
    this.step = 'input';
    this.result = null;
    this.isDone = false;
    this.isExecuting = false;
  }

  t(k, p) {
    return this.plugin ? this.plugin.t(k, p) : k;
  }

  onOpen() {
    this.render();
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('fm-wizard-modal');
    contentEl.addClass('fm-incoming-modal-dialog');

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

    // 1. Clean Title Header
    const header = contentEl.createDiv({ cls: 'fm-step-header' });
    header.createEl('h3', { text: this.t('destTitle'), cls: 'fm-step-title' });

    // 2. Asset Card (Thumbnail + Integrated Input + Size)
    const card = contentEl.createDiv({ cls: 'fm-incoming-card' });
    const thumbWrap = card.createDiv({ cls: 'fm-incoming-thumb-wrap' });

    if (IMAGE_EXTS.has(this.fileInfo.ext)) {
      const img = thumbWrap.createEl('img', { cls: 'fm-incoming-thumb-img' });
      convertBufferToPreviewUrl(this.fileInfo.arrayBuffer, this.fileInfo.ext, this.plugin)
        .then((url) => {
          if (url) img.src = url;
        })
        .catch(() => {});
    } else {
      const ext = this.fileInfo.ext;
      const icon = ext === 'md' ? '📝' : AUDIO_EXTS.has(ext) ? '🎵' : ['mp4', 'webm', 'mov', 'mkv'].includes(ext) ? '🎬' : ext === 'pdf' ? '📄' : '📦';
      thumbWrap.createSpan({ text: icon, attr: { style: 'font-size: 24px;' } });
    }

    const editCol = card.createDiv({ cls: 'fm-incoming-edit-col' });
    const inputRow = editCol.createDiv({ cls: 'fm-incoming-input-row' });
    const nameInput = inputRow.createEl('input', {
      type: 'text',
      value: this.fileInfo.defaultBaseName,
      cls: 'fm-incoming-name-input',
      attr: {
        placeholder: this.t('destFilenameHint'),
        spellcheck: 'false'
      }
    });
    inputRow.createSpan({ text: `.${this.fileInfo.ext}`, cls: 'fm-incoming-ext-badge' });
    editCol.createDiv({
      cls: 'fm-incoming-sub-meta',
      text: formatBytes(this.fileInfo.size)
    });

    if (this.options.promptRename) {
      setTimeout(() => {
        nameInput.focus();
        nameInput.select();
      }, 40);
    }

    // 3. Location Selection
    const isRemoteReady = Boolean(
      this.plugin?.settings?.enableRemoteServer &&
      this.plugin?.isRemoteServerReady?.()
    );

    const isAskMode = this.options.askLocation !== false;
    let isRemoteFallback = false;
    if (!isAskMode && this.options.fixedLocation === 'local') {
      this.targetLocation = 'local';
    } else if (!isAskMode && this.options.fixedLocation === 'remote') {
      if (isRemoteReady) {
        this.targetLocation = 'remote';
      } else {
        this.targetLocation = 'local';
        isRemoteFallback = true;
      }
    } else if (!this.targetLocation) {
      const userPref = this.plugin?.settings?.defaultSaveLocation || 'remote';
      this.targetLocation = (!isRemoteReady || userPref === 'local') ? 'local' : 'remote';
    }

    contentEl.createDiv({
      cls: 'fm-section-title',
      text: this.t('destDestTitle'),
      attr: { style: 'margin-top: 14px; margin-bottom: 8px;' }
    });

    const grid = contentEl.createDiv({ cls: 'fm-incoming-dest-grid' });

    // Local Option Card
    const localCard = grid.createDiv({
      cls: `fm-incoming-dest-card ${this.targetLocation === 'local' ? 'is-selected' : ''}`
    });
    const localTitle = localCard.createDiv({ cls: 'fm-incoming-dest-card-title' });
    localTitle.createSpan({ text: this.t('destSaveLocal') });
    const localCheck = localCard.createSpan({ cls: 'fm-incoming-dest-card-check' });
    setIcon(localCheck, 'check');

    // Remote Option Card (only rendered if remote server is enabled and ready)
    let remoteCard = null;
    let remoteCheck = null;
    if (isRemoteReady) {
      remoteCard = grid.createDiv({
        cls: `fm-incoming-dest-card ${this.targetLocation === 'remote' ? 'is-selected' : ''}`
      });
      const remoteTitle = remoteCard.createDiv({ cls: 'fm-incoming-dest-card-title' });
      remoteTitle.createSpan({ text: this.t('destSaveRemote') });
      remoteCheck = remoteCard.createSpan({ cls: 'fm-incoming-dest-card-check' });
      setIcon(remoteCheck, 'check');
    }

    const updateSelection = (loc) => {
      this.targetLocation = loc;
      if (loc === 'local') {
        localCard.addClass('is-selected');
        if (remoteCard) remoteCard.removeClass('is-selected');
      } else {
        localCard.removeClass('is-selected');
        if (remoteCard) remoteCard.addClass('is-selected');
      }
    };

    if (isAskMode) {
      localCard.onclick = () => updateSelection('local');
      if (remoteCard) {
        remoteCard.onclick = () => updateSelection('remote');
      }
    } else {
      localCard.style.cursor = 'default';
      if (remoteCard) remoteCard.style.cursor = 'default';
      let hintText = '';
      if (isRemoteFallback) {
        hintText = this.t('destFixedRemoteFallbackHint');
      } else if (this.targetLocation === 'local') {
        hintText = this.t('destFixedLocalHint');
      } else {
        hintText = this.t('destFixedRemoteHint');
      }
      contentEl.createDiv({
        cls: 'fm-incoming-fixed-hint',
        text: hintText,
        attr: { style: 'font-size: 11px; color: var(--text-muted); margin-top: 6px;' }
      });
    }

    const triggerExecute = () => {
      if (this.isExecuting) return;
      this.isExecuting = true;
      const cleanBase = sanitizeCleanBaseName(nameInput.value, this.fileInfo.defaultBaseName);
      this.finalFilename = `${cleanBase}.${this.fileInfo.ext}`;
      this.step = 'executing';
      this.render();
      this.runExecution();
    };

    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        triggerExecute();
      }
    });

    contentEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
        if (tag === 'textarea' || tag === 'button' || tag === 'input') return;
        e.preventDefault();
        triggerExecute();
      }
    });

    // 4. Action Buttons (Cancel & Insert)
    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row', attr: { style: 'margin-top: 18px;' } });
    const cancelBtn = btnRow.createEl('button', { text: this.t('btnCancel') });
    cancelBtn.onclick = () => {
      this.isDone = true;
      this.close();
      if (this.callback) this.callback({ target: null });
    };

    const insertBtn = btnRow.createEl('button', { text: this.t('btnInsert') || '插入', cls: 'mod-cta' });
    insertBtn.onclick = () => triggerExecute();
  }

  renderExecutingStep() {
    const { contentEl } = this;
    const header = contentEl.createDiv({ cls: 'fm-step-header' });
    header.createEl('h3', { text: this.t('destProcessingTitle'), cls: 'fm-step-title' });

    const infoBox = contentEl.createDiv({ cls: 'fm-section-box', attr: { style: 'margin-bottom: 14px;' } });
    infoBox.createDiv({
      text: `📄 ${this.finalFilename}  (${formatBytes(this.fileInfo.size)})`,
      attr: { style: 'font-weight: 600; margin-bottom: 10px;' }
    });

    const progressWrap = infoBox.createDiv({ cls: 'fm-progress-wrap' });
    this.progressBar = progressWrap.createDiv({ cls: 'fm-progress-bar', attr: { style: 'width: 15%;' } });

    this.statusLabel = infoBox.createDiv({
      text: this.targetLocation === 'remote'
        ? this.t('destProbeChecking')
        : this.t('destSavingLocal'),
      attr: { style: 'font-size: 12px; color: var(--text-accent); margin-top: 8px;' }
    });
  }

  async runExecution() {
    try {
      const activeFile = this.options.activeFile || this.app.workspace.getActiveFile();
      const editor = this.options.editor;
      const sourcePath = activeFile ? activeFile.path : '';

      if (this.targetLocation === 'local') {
        if (this.progressBar) this.progressBar.style.width = '40%';
        if (this.statusLabel) this.statusLabel.setText(this.t('destSavingLocal'));

        const localPath = await this.app.fileManager.getAvailablePathForAttachment(
          this.finalFilename,
          sourcePath
        );

        if (this.progressBar) this.progressBar.style.width = '75%';
        const createdFile = await this.app.vault.createBinary(localPath, this.fileInfo.arrayBuffer);
        let mdLink = this.app.fileManager.generateMarkdownLink(createdFile, sourcePath);

        // Prepend exclamation mark for image previews if not already present
        if (IMAGE_EXTS.has(this.fileInfo.ext) && !mdLink.startsWith('!')) {
          mdLink = `!${mdLink}`;
        }

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
        this.plugin?.logOperation?.('INFO', 'SAVE_LOCAL', `Saved attachment to vault: ${createdFile.path}`, {
          size: this.fileInfo.size,
          note: sourcePath || null
        });
      } else {
        // Remote upload with Instant SHA-256 Probe check
        if (this.progressBar) this.progressBar.style.width = '25%';
        if (this.statusLabel) this.statusLabel.setText(this.t('destProbeChecking'));

        const sha256 = this.fileInfo.sha256 || (await computeSha256Hex(this.fileInfo.arrayBuffer));
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
            { skipProbe: true }
          );
          if (this.progressBar) this.progressBar.style.width = '100%';
        }

        const useOpt =
          this.plugin.settings.insertOptimizedLinkOnUpload &&
          res.optimizationEnabled !== false &&
          res.category === 'image' &&
          res.pubUrl;
        let finalMarkdown = useOpt
          ? `![](${res.pubUrl})`
          : (res.markdown || `[${this.finalFilename}](${res.rawUrl})`);

        // Prepend exclamation mark for image previews if not already present
        if (IMAGE_EXTS.has(this.fileInfo.ext) && !finalMarkdown.startsWith('!')) {
          finalMarkdown = `!${finalMarkdown}`;
        }

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
        this.plugin?.logOperation?.('INFO', 'UPLOAD_REMOTE', `${res.isInstant ? 'Reused existing remote file' : 'Uploaded attachment to server'}: ${this.finalFilename}`, {
          remotePath: `${res.year}/${res.month}/${res.filename}`,
          isInstant: !!res.isInstant,
          size: this.fileInfo.size,
          note: sourcePath || null
        });
      }
    } catch (err) {
      this.isExecuting = false;
      this.result = {
        success: false,
        error: err.message || String(err)
      };
      this.plugin?.logOperation?.('ERROR', 'SAVE_ATTACHMENT', `Failed to process attachment "${this.finalFilename}": ${this.result.error}`, {
        target: this.targetLocation,
        size: this.fileInfo.size
      });
    }

    if (this.callback) {
      this.callback({ target: this.targetLocation, finalFilename: this.finalFilename, result: this.result });
    }

    // Auto close modal if inserted directly into active note editor
    if (this.result?.success && this.result?.inserted) {
      const noticeMsg = this.result.target === 'remote'
        ? (this.plugin ? this.plugin.t('noticeUploadedRemote', { name: this.finalFilename }) : `已上传到服务器并插入链接：${this.finalFilename}`)
        : this.t('destInsertSuccess');
      new Notice(noticeMsg);
      this.isDone = true;
      this.close();
      return;
    } else if (this.result?.success) {
      new Notice(this.t('destInsertSuccess'));
      this.isDone = true;
      this.close();
      return;
    } else {
      new Notice(`❌ ${this.result?.error || 'Insert failed'}`);
      this.isDone = true;
      this.close();
      return;
    }
  }

  renderResultStep() {
    const { contentEl } = this;
    const header = contentEl.createDiv({ cls: 'fm-step-header' });
    header.createEl('h3', { text: this.t('destResultTitle'), cls: 'fm-step-title' });

    if (!this.result.success) {
      const errBanner = contentEl.createDiv({ cls: 'fm-result-banner fm-result-banner-error' });
      errBanner.createDiv({
        cls: 'fm-result-banner-title',
        text: this.t('destProcessingError', { err: formatFriendlyError(this, this.result.error) })
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
        attr: { style: 'font-weight: 600; margin-bottom: 12px; color: var(--text-normal);' }
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
        attr: { style: 'font-weight: 600; margin-bottom: 12px; color: var(--text-normal);' }
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
 * Modal to execute active note operations with 2-step preview/options (for migrate & download conflict check),
 * real-time progress bar & in-window result list
 */
class ActiveNoteActionModal extends Modal {
  constructor(app, plugin, targetFile, actionType = 'migrate', options = {}) {
    super(app);
    this.plugin = plugin;
    this.targetFile = targetFile;
    this.actionType = actionType; // 'migrate' | 'download'
    this.fromHub = Boolean(options?.fromHub);
    this.step = 'loading';
    this.items = [];
    this.deleteLocalAfter = Boolean(plugin?.settings?.deleteLocalAfterMigrate);
    this.syncOtherNotes = true;
    this.conflictStrategy = 'reuse'; // 'reuse' | 'rename' | 'overwrite'
    this.hadConflictStep = false;
    this.result = null;
  }

  t(k, p) {
    return this.plugin ? this.plugin.t(k, p) : k;
  }

  getUniqueOtherRefNotes(onlySelected = false) {
    const set = new Set();
    for (const item of this.items) {
      if (onlySelected && !item.selected) continue;
      for (const p of item.otherRefNotes || []) {
        set.add(p);
      }
    }
    return [...set];
  }

  async onOpen() {
    this.render();
    if (this.actionType === 'migrate') {
      try {
        this.items = await this.plugin.scanActiveNoteLocalAttachments(this.targetFile);
        this.step = 'preview';
      } catch (err) {
        this.result = { success: false, message: err.message || String(err) };
        this.step = 'result';
      }
      this.render();
    } else {
      try {
        this.items = await this.plugin.scanActiveNoteRemoteAttachments(this.targetFile);
        if (this.items.length === 0) {
          this.result = { success: true, count: 0, processedItems: [], failures: [] };
          this.step = 'result';
          this.render();
          return;
        }
        const hasConflicts = this.items.some((item) => item.hasConflict);
        const hasOtherRefs = this.items.some((item) => (item.otherRefNotes?.length || 0) > 0);
        if (hasConflicts || hasOtherRefs) {
          this.hadConflictStep = true;
          this.step = 'conflict';
          this.render();
        } else {
          this.step = 'running';
          this.render();
          await this.execute(this.items);
        }
      } catch (err) {
        this.result = { success: false, message: err.message || String(err) };
        this.step = 'result';
        this.render();
      }
    }
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('fm-wizard-modal');

    const titleKey = this.actionType === 'migrate' ? 'activeNoteMigrateTitle' : 'activeNoteDownloadTitle';
    if (this.actionType === 'migrate' || this.hadConflictStep || this.step === 'conflict') {
      const stepNum = (this.step === 'loading' || this.step === 'preview' || this.step === 'conflict') ? 1 : 2;
      const header = contentEl.createDiv({ cls: 'fm-step-header' });
      header.createSpan({ text: this.t('stepOf', { current: stepNum, total: 2 }), cls: 'fm-step-badge' });
      header.createEl('h3', { text: this.t(titleKey), cls: 'fm-step-title' });
    } else {
      contentEl.createEl('h3', { text: this.t(titleKey) });
    }

    contentEl.createDiv({
      text: `📄 ${this.targetFile.path}`,
      attr: { style: 'font-size: 12px; color: var(--text-muted); margin-bottom: 12px;' }
    });

    if (this.step === 'loading') {
      const box = contentEl.createDiv({ cls: 'fm-section-box' });
      box.createDiv({
        text: this.t('activeNoteScanning'),
        attr: { style: 'font-size: 13px; color: var(--text-accent);' }
      });
      return;
    }

    if (this.step === 'conflict') {
      const conflictItems = this.items.filter((i) => i.hasConflict);
      const otherRefNotesAll = this.getUniqueOtherRefNotes(false);

      if (conflictItems.length > 0) {
        const warnBanner = contentEl.createDiv({
          cls: 'fm-result-banner fm-result-banner-error',
          attr: { style: 'margin-bottom: 12px;' }
        });
        warnBanner.createDiv({
          cls: 'fm-result-banner-title',
          text: this.t('activeNoteDownConflictTitle', { count: conflictItems.length }),
          attr: { style: 'margin-bottom: 0;' }
        });
      } else if (otherRefNotesAll.length > 0) {
        const infoBanner = contentEl.createDiv({
          cls: 'fm-result-banner fm-result-banner-instant',
          attr: { style: 'margin-bottom: 12px;' }
        });
        infoBanner.createDiv({
          cls: 'fm-result-banner-title',
          text: this.t('activeNoteDownOtherRefsTitle', { count: otherRefNotesAll.length }),
          attr: { style: 'margin-bottom: 0;' }
        });
      }

      const listEl = contentEl.createDiv({
        cls: 'fm-scroll-list',
        attr: { style: 'max-height: 220px;' }
      });

      let runBtn = null;
      const updateRunBtnLabel = () => {
        if (!runBtn) return;
        const selectedCount = this.items.filter((i) => i.selected).length;
        runBtn.setText(this.t('activeNoteStartDownload', { count: selectedCount }));
      };

      for (const item of this.items) {
        const row = listEl.createDiv({ cls: 'fm-list-item' });
        const left = row.createDiv({
          attr: { style: 'display:flex; align-items:center; gap:10px; flex:1; overflow:hidden;' }
        });
        const cb = left.createEl('input', { type: 'checkbox', attr: { style: 'cursor:pointer;' } });
        cb.checked = item.selected;
        cb.onchange = () => {
          item.selected = cb.checked;
          updateRunBtnLabel();
        };

        renderItemVisualThumb(left, item, this.plugin);

        const nameCol = left.createDiv({
          attr: { style: 'display:flex; flex-direction:column; overflow:hidden; flex:1;' }
        });
        nameCol.createSpan({
          text: item.name,
          attr: { style: 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:500;' }
        });
        const displayPath = (item.hasConflict && item.existingFile)
          ? item.existingFile.path
          : item.idealPath;
        nameCol.createSpan({
          text: `${displayPath}${item.size ? ' · ' + formatBytes(item.size) : ''}`,
          attr: { style: 'font-size:11px; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;' }
        });

        const otherRefs = item.otherRefNotes || [];
        if (otherRefs.length > 0) {
          const rightBox = row.createDiv({
            attr: { style: 'display:flex; align-items:center; gap:6px; flex-shrink:0;' }
          });
          const refBadge = rightBox.createSpan({
            text: this.t('activeNoteOtherRefsBadge', { count: otherRefs.length }),
            cls: 'fm-tag fm-tag-ref fm-clickable-badge',
            attr: { title: this.t('activeNoteInspectOtherRefs') }
          });
          refBadge.onclick = (e) => {
            e.stopPropagation();
            new NoteRefsModal(this.app, item.name, otherRefs, () => this.close(), this.plugin).open();
          };
        }
      }

      if (otherRefNotesAll.length > 0 || conflictItems.length > 0) {
        const optionsBox = contentEl.createDiv({
          cls: 'fm-section-box',
          attr: { style: 'margin-top: 10px; display: flex; flex-direction: column; gap: 10px;' }
        });

        if (otherRefNotesAll.length > 0) {
          const syncLabel = optionsBox.createEl('label', {
            cls: 'fm-check-row',
            attr: { style: 'margin: 0; cursor: pointer;' }
          });
          const syncCb = syncLabel.createEl('input', { type: 'checkbox' });
          syncCb.checked = this.syncOtherNotes;
          syncCb.onchange = () => {
            this.syncOtherNotes = syncCb.checked;
          };
          syncLabel.createSpan({
            text: this.t('activeNoteSyncOtherDownloadOpt', { count: otherRefNotesAll.length })
          });
        }

        if (conflictItems.length > 0) {
          const strategyWrap = optionsBox.createDiv({
            attr: {
              style: otherRefNotesAll.length > 0
                ? 'border-top: 1px solid var(--background-modifier-border); padding-top: 10px;'
                : ''
            }
          });
          strategyWrap.createDiv({
            text: this.t('activeNoteDownStrategyTitle'),
            cls: 'fm-section-title'
          });

          const strategies = [
            { value: 'reuse', label: this.t('activeNoteDownOptReuse') },
            { value: 'rename', label: this.t('activeNoteDownOptRename') },
            { value: 'overwrite', label: this.t('activeNoteDownOptOverwrite') }
          ];
          for (const st of strategies) {
            const rowLabel = strategyWrap.createEl('label', {
              cls: 'fm-check-row',
              attr: { style: 'cursor:pointer;' }
            });
            const radio = rowLabel.createEl('input', {
              type: 'radio',
              attr: { name: 'fm-down-conflict-strategy', value: st.value }
            });
            radio.checked = this.conflictStrategy === st.value;
            radio.onchange = () => {
              if (radio.checked) this.conflictStrategy = st.value;
            };
            rowLabel.createSpan({ text: st.label });
          }
        }
      }

      const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
      const cancelBtn = btnRow.createEl('button', { text: this.t('btnCancel') });
      cancelBtn.onclick = () => returnToHub(this);

      runBtn = btnRow.createEl('button', {
        text: this.t('activeNoteStartDownload', { count: this.items.filter((i) => i.selected).length }),
        cls: 'mod-cta'
      });
      runBtn.onclick = async () => {
        const selected = this.items.filter((i) => i.selected);
        if (selected.length === 0) {
          new Notice(this.t('activeNoteSelectRequired'));
          return;
        }
        this.step = 'running';
        this.render();
        await this.execute(selected);
      };
      return;
    }

    if (this.step === 'preview') {
      if (this.items.length === 0) {
        const emptyBanner = contentEl.createDiv({
          cls: 'fm-section-box',
          attr: { style: 'text-align: center; padding: 24px 16px;' }
        });
        emptyBanner.createDiv({
          text: this.t('activeNoteNoLocal'),
          attr: { style: 'font-size: 14px; color: var(--text-muted);' }
        });
        const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
        const closeBtn = btnRow.createEl('button', { text: this.t('closeBtn') });
        closeBtn.onclick = () => returnToHub(this);
        return;
      }

      contentEl.createEl('p', {
        text: this.t('activeNoteStep1Desc', { count: this.items.length }),
        cls: 'fm-step-desc'
      });

      const listEl = contentEl.createDiv({
        cls: 'fm-scroll-list',
        attr: { style: 'max-height: 240px;' }
      });

      let runBtn = null;
      const updateRunBtnLabel = () => {
        if (!runBtn) return;
        const selectedCount = this.items.filter((i) => i.selected).length;
        runBtn.setText(this.t('activeNoteStartUpload', { count: selectedCount }));
      };

      for (const item of this.items) {
        const row = listEl.createDiv({ cls: 'fm-list-item' });
        const left = row.createDiv({
          attr: { style: 'display:flex; align-items:center; gap:10px; flex:1; overflow:hidden;' }
        });
        const cb = left.createEl('input', { type: 'checkbox', attr: { style: 'cursor:pointer;' } });
        cb.checked = item.selected;
        cb.onchange = () => {
          item.selected = cb.checked;
          updateRunBtnLabel();
        };

        renderItemVisualThumb(left, item, this.plugin);

        const nameCol = left.createDiv({
          attr: { style: 'display:flex; flex-direction:column; overflow:hidden; flex:1;' }
        });
        nameCol.createSpan({
          text: item.name,
          attr: { style: 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:500;' }
        });
        nameCol.createSpan({
          text: `${item.displayPath} · ${formatBytes(item.size)}`,
          attr: { style: 'font-size:11px; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;' }
        });

        const rightBox = row.createDiv({
          attr: { style: 'display:flex; align-items:center; gap:8px; flex-shrink:0;' }
        });
        const otherRefs = item.otherRefNotes || [];
        if (otherRefs.length > 0) {
          const refBadge = rightBox.createSpan({
            text: this.t('activeNoteOtherRefsBadge', { count: otherRefs.length }),
            cls: 'fm-tag fm-tag-ref fm-clickable-badge',
            attr: { title: this.t('activeNoteInspectOtherRefs') }
          });
          refBadge.onclick = (e) => {
            e.stopPropagation();
            new NoteRefsModal(this.app, item.name, otherRefs, () => this.close(), this.plugin).open();
          };
        }

        const lockBtn = rightBox.createEl('button', {
          type: 'button',
          cls: 'fm-mini-btn',
          text: item.locked ? this.t('activeNoteBtnLockOn') : this.t('activeNoteBtnLockOff'),
          attr: {
            style: item.locked
              ? 'border-color: var(--interactive-accent); color: var(--text-accent); font-weight: 600;'
              : 'color: var(--text-muted);'
          }
        });
        lockBtn.onclick = (e) => {
          e.stopPropagation();
          item.locked = !item.locked;
          lockBtn.setText(item.locked ? this.t('activeNoteBtnLockOn') : this.t('activeNoteBtnLockOff'));
          lockBtn.style.cssText = item.locked
            ? 'border-color: var(--interactive-accent); color: var(--text-accent); font-weight: 600;'
            : 'color: var(--text-muted);';
        };
      }

      contentEl.createDiv({
        cls: 'fm-section-box',
        text: this.t('activeNoteLockExplain'),
        attr: { style: 'font-size: 12px; color: var(--text-muted); line-height: 1.5; margin-top: 10px;' }
      });

      const otherRefNotesAll = this.getUniqueOtherRefNotes(false);
      const optBox = contentEl.createDiv({
        cls: 'fm-section-box',
        attr: { style: 'margin-top: 8px; display: flex; flex-direction: column; gap: 10px;' }
      });

      if (otherRefNotesAll.length > 0) {
        const syncLabel = optBox.createEl('label', {
          cls: 'fm-check-row',
          attr: { style: 'margin: 0; cursor: pointer;' }
        });
        const syncCb = syncLabel.createEl('input', { type: 'checkbox' });
        syncCb.checked = this.syncOtherNotes;
        syncCb.onchange = () => {
          this.syncOtherNotes = syncCb.checked;
        };
        syncLabel.createSpan({
          text: this.t('activeNoteSyncOtherUploadOpt', { count: otherRefNotesAll.length })
        });
      }

      const delWrap = optBox.createDiv({
        attr: {
          style: otherRefNotesAll.length > 0
            ? 'border-top: 1px solid var(--background-modifier-border); padding-top: 10px;'
            : ''
        }
      });
      const delLabel = delWrap.createEl('label', {
        cls: 'fm-check-row',
        attr: { style: 'margin: 0; cursor: pointer;' }
      });
      const delCb = delLabel.createEl('input', { type: 'checkbox' });
      delCb.checked = this.deleteLocalAfter;
      delCb.onchange = () => {
        this.deleteLocalAfter = delCb.checked;
      };
      delLabel.createSpan({ text: this.t('activeNoteDeleteLocalOpt') });

      const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
      const cancelBtn = btnRow.createEl('button', { text: this.t('btnCancel') });
      cancelBtn.onclick = () => returnToHub(this);

      runBtn = btnRow.createEl('button', {
        text: this.t('activeNoteStartUpload', { count: this.items.filter((i) => i.selected).length }),
        cls: 'mod-cta'
      });
      runBtn.onclick = async () => {
        const selected = this.items.filter((i) => i.selected);
        if (selected.length === 0) {
          new Notice(this.t('activeNoteSelectRequired'));
          return;
        }
        this.step = 'running';
        this.render();
        await this.execute(selected);
      };
      return;
    }

    if (this.step === 'running') {
      const box = contentEl.createDiv({ cls: 'fm-section-box' });
      this.statusText = box.createDiv({
        text: this.t('activeNoteScanning'),
        attr: { style: 'font-size: 13px; color: var(--text-accent); margin-bottom: 8px;' }
      });
      const wrap = box.createDiv({ cls: 'fm-progress-wrap' });
      this.progressBar = wrap.createDiv({ cls: 'fm-progress-bar', attr: { style: 'width: 10%;' } });
      const stop = box.createEl('button', { text: this.t('transferStop') });
      stop.onclick = () => {
        this.transferController?.abort();
        stop.disabled = true;
        this.statusText.setText(this.t('transferStopping'));
      };
    } else if (this.step === 'result') {
      const failures = this.result?.failures || [];
      const processedItems = this.result?.processedItems || [];
      if (!this.result.success) {
        const errBanner = contentEl.createDiv({ cls: 'fm-result-banner fm-result-banner-error' });
        errBanner.createDiv({ cls: 'fm-result-banner-title', text: '❌ ' + this.result.message });
      } else {
        if (this.result.count > 0) {
          const banner = contentEl.createDiv({ cls: 'fm-result-banner fm-result-banner-success' });
          banner.createDiv({
            cls: 'fm-result-banner-title',
            text: this.result.cancelled ? this.t('transferCancelled') : this.actionType === 'migrate' ? this.t('activeNoteMigrateComplete') : this.t('activeNoteDownloadComplete')
          });
          banner.createDiv({
            cls: 'fm-result-banner-desc',
            text: this.actionType === 'migrate'
              ? this.t('activeNoteMigrateDoneDesc', { count: this.result.count })
              : this.t('activeNoteDownloadDoneDesc', { count: this.result.count })
          });

          const trashFailedList = processedItems.filter((p) => p.trashError);
          if (trashFailedList.length > 0) {
            const warnBox = contentEl.createDiv({
              cls: 'fm-alert fm-alert-warning',
              attr: { style: 'margin-top: 10px; margin-bottom: 6px; font-size: 12px;' }
            });
            warnBox.createSpan({
              text: this.t('activeNoteTrashFailedNotice', { count: trashFailedList.length })
            });
          }

          if (processedItems.length > 0) {
            const listBox = contentEl.createDiv({
              cls: 'fm-section-box',
              attr: { style: 'margin-top: 10px;' }
            });
            listBox.createDiv({
              text: this.t('activeNoteResultListTitle', { count: processedItems.length }),
              cls: 'fm-section-title'
            });
            const listEl = listBox.createDiv({
              cls: 'fm-scroll-list',
              attr: { style: 'max-height: 220px; margin-bottom: 0;' }
            });
            for (const pItem of processedItems) {
              const row = listEl.createDiv({ cls: 'fm-list-item' });
              const left = row.createDiv({
                attr: { style: 'display:flex; align-items:center; gap:10px; flex:1; overflow:hidden;' }
              });
              renderItemVisualThumb(left, pItem, this.plugin);
              const nameCol = left.createDiv({
                attr: { style: 'display:flex; flex-direction:column; overflow:hidden; flex:1;' }
              });
              nameCol.createSpan({
                text: pItem.name,
                attr: { style: 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:500;' }
              });
              nameCol.createSpan({
                text: `${pItem.displayPath}${pItem.size ? ' · ' + formatBytes(pItem.size) : ''}`,
                attr: { style: 'font-size:11px; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;' }
              });

              const rightBox = row.createDiv({
                attr: { style: 'display:flex; align-items:center; gap:6px; flex-shrink:0; flex-wrap:wrap; justify-content:flex-end;' }
              });
              if (pItem.syncedOtherNotes > 0) {
                const syncedPaths = Array.isArray(pItem.syncedOtherNotePaths) ? pItem.syncedOtherNotePaths : [];
                const syncedBadge = rightBox.createSpan({
                  text: this.t('activeNoteBadgeSyncedNotes', { count: pItem.syncedOtherNotes }),
                  cls: syncedPaths.length > 0 ? 'fm-tag fm-tag-ref fm-clickable-badge' : 'fm-tag fm-tag-ref',
                  attr: syncedPaths.length > 0 ? { title: this.t('activeNoteInspectOtherRefs') } : {}
                });
                if (syncedPaths.length > 0) {
                  syncedBadge.onclick = (e) => {
                    e.stopPropagation();
                    new NoteRefsModal(this.app, pItem.name, syncedPaths, () => this.close(), this.plugin).open();
                  };
                }
              }
              if (pItem.trashedLocal) {
                rightBox.createSpan({ text: this.t('activeNoteBadgeTrashedLocal'), cls: 'fm-tag fm-tag-info' });
              } else if (pItem.trashError) {
                rightBox.createSpan({
                  text: this.t('activeNoteBadgeTrashFailed'),
                  cls: 'fm-tag fm-tag-danger',
                  attr: { title: String(pItem.trashError) }
                });
              } else if (pItem.keptForOtherRefs > 0) {
                const keptPaths = Array.isArray(pItem.keptForOtherRefPaths) ? pItem.keptForOtherRefPaths : [];
                const keptBadge = rightBox.createSpan({
                  text: this.t('activeNoteBadgeKeptForOtherRefs', { count: pItem.keptForOtherRefs }),
                  cls: keptPaths.length > 0 ? 'fm-tag fm-tag-warning fm-clickable-badge' : 'fm-tag fm-tag-warning',
                  attr: keptPaths.length > 0 ? { title: this.t('activeNoteInspectOtherRefs') } : {}
                });
                if (keptPaths.length > 0) {
                  keptBadge.onclick = (e) => {
                    e.stopPropagation();
                    new NoteRefsModal(this.app, pItem.name, keptPaths, () => this.close(), this.plugin).open();
                  };
                }
              }
              if (pItem.locked) {
                rightBox.createSpan({ text: this.t('activeNoteBtnLockOn'), cls: 'fm-tag fm-tag-info' });
              }
              let badgeKey = 'activeNoteBadgeDownloaded';
              if (pItem.action === 'reused') badgeKey = 'activeNoteBadgeReused';
              else if (pItem.action === 'overwritten') badgeKey = 'activeNoteBadgeOverwritten';
              else if (pItem.action === 'uploaded') badgeKey = 'activeNoteBadgeUploaded';
              rightBox.createSpan({
                text: this.t(badgeKey),
                cls: 'fm-tag fm-tag-info'
              });
            }
          }
        } else if (failures.length === 0 && !this.result.cancelled) {
          const emptyBanner = contentEl.createDiv({ cls: 'fm-section-box', attr: { style: 'text-align: center; padding: 24px 16px;' } });
          emptyBanner.createDiv({
            text: this.actionType === 'migrate' ? this.t('activeNoteNoLocal') : this.t('activeNoteNoRemote'),
            attr: { style: 'font-size: 14px; color: var(--text-muted);' }
          });
        }

        if (failures.length > 0) {
          const failBanner = contentEl.createDiv({
            cls: 'fm-result-banner fm-result-banner-error',
            attr: { style: 'margin-top: 10px;' }
          });
          const failTitleKey = this.actionType === 'migrate' ? 'activeNoteFailedTitle' : 'activeNoteDownFailedTitle';
          failBanner.createDiv({
            cls: 'fm-result-banner-title',
            text: this.t(failTitleKey, { failed: failures.length })
          });
          for (const f of failures) {
            const reason = formatFriendlyError(this, f.error);
            failBanner.createDiv({
              cls: 'fm-result-banner-desc',
              text: `• ${f.name} (${formatBytes(f.size || 0)}): ${reason}`,
              attr: { style: 'margin-top: 4px;' }
            });
          }
        }
      }

      const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
      if (this.actionType === 'migrate' && processedItems.length > 0) {
        let noteReportPath = null;
        const exportBtn = btnRow.createEl('button', { text: this.t('batchExportReport') });
        exportBtn.onclick = async () => {
          exportBtn.disabled = true;
          try {
            noteReportPath = await this.plugin.exportBatchMigrateReportToRoot({
              count: this.result.count,
              docs: 1,
              trashed: processedItems.filter((p) => p.trashedLocal).length,
              processedItems,
              failures: this.result.failures || [],
              totalBytes: processedItems.reduce((s, p) => s + (p.size || 0), 0)
            });
            exportBtn.setText(this.t('batchReportExported'));
            if (!btnRow.querySelector('.fm-open-report-btn')) {
              const openBtn = btnRow.createEl('button', {
                text: this.t('batchOpenReport'),
                cls: 'fm-open-report-btn'
              });
              openBtn.onclick = () => {
                if (noteReportPath) {
                  this.app.workspace.openLinkText(noteReportPath, '', true);
                }
                this.close();
              };
            }
          } catch (err) {
            new Notice('❌ ' + err.message);
            exportBtn.disabled = false;
          }
        };
      }
      if (this.result?.cancelled) btnRow.createSpan({ text: this.t('transferCancelled') });
      if (this.result?.retryItems?.length) {
        const retry = btnRow.createEl('button', { text: this.t('transferRetry') });
        retry.onclick = async () => {
          const pending = this.result.retryItems;
          this.step = 'running';
          this.render();
          await this.execute(pending);
        };
      }
      const doneBtn = btnRow.createEl('button', { text: this.t('destBtnDone'), cls: 'mod-cta' });
      doneBtn.onclick = () => returnToHub(this);
    }
  }

  async execute(selectedItems = null) {
    this.transferController = new AbortController();
    try {
      if (this.actionType === 'migrate') {
        const res = await this.plugin.executeMigrateNoteDirect(
          this.targetFile,
          (cur, total, name) => {
            if (this.progressBar) {
              const pct = Math.round((cur / Math.max(1, total)) * 100);
              this.progressBar.style.width = `${pct}%`;
            }
            if (this.statusText) {
              this.statusText.setText(this.t('activeNoteProcessing', { current: cur, total, name }));
            }
          },
          {
            items: selectedItems || this.items.filter((i) => i.selected),
            deleteLocalAfter: this.deleteLocalAfter,
            syncOtherNotes: this.syncOtherNotes,
            signal: this.transferController.signal,
            returnDetails: true
          }
        );
        const count = typeof res === 'object' ? (res.count || 0) : Number(res || 0);
        const processedItems = typeof res === 'object' && Array.isArray(res.processedItems) ? res.processedItems : [];
        const failures = typeof res === 'object' && Array.isArray(res.failures) ? res.failures : [];
        this.result = { success: true, ...res, count, processedItems, failures };
      } else {
        const res = await this.plugin.executeDownloadNoteDirect(
          this.targetFile,
          (cur, total, name) => {
            if (this.progressBar) {
              const pct = Math.round((cur / Math.max(1, total)) * 100);
              this.progressBar.style.width = `${pct}%`;
            }
            if (this.statusText) {
              this.statusText.setText(this.t('activeNoteProcessing', { current: cur, total, name }));
            }
          },
          {
            items: selectedItems || this.items.filter((i) => i.selected),
            conflictStrategy: this.conflictStrategy,
            syncOtherNotes: this.syncOtherNotes,
            signal: this.transferController.signal,
            returnDetails: true
          }
        );
        const count = typeof res === 'object' ? (res.count || 0) : Number(res || 0);
        const processedItems = typeof res === 'object' && Array.isArray(res.processedItems) ? res.processedItems : [];
        const failures = typeof res === 'object' && Array.isArray(res.failures) ? res.failures : [];
        this.result = { success: true, ...res, count, processedItems, failures };
      }
    } catch (err) {
      this.result = { success: false, message: err.message };
    }
    this.transferController = null;
    this.step = 'result';
    if (!this.transferClosed) this.render();
  }

  onClose() {
    this.transferClosed = true;
    this.transferController?.abort();
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
      attr: { style: 'font-size: 13px; color: var(--text-muted); margin-bottom: 14px;' }
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
      attr: { style: 'font-size: 12px; color: var(--text-muted); padding: 10px 14px;' }
    });
    const exclHint = exclFolders.length ? t('orphanExclHint', { folders: exclFolders.join(', ') }) : '';
    protInfo.createDiv({
      text: t('orphanProtActive', { excl: exclHint })
    });

    const progressWidget = createScanProgressWidget(contentEl, this.plugin);
    this.activeProgress = progressWidget;

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const cancelBtn = btnRow.createEl('button', { text: t('btnCancel') });
    cancelBtn.onclick = () => returnToHub(this);

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
    const leftTools = toolbar.createDiv({ attr: { style: 'display:flex; gap:8px; align-items:center;' } });
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
        attr: { style: 'text-align: center; padding: 36px 20px;' }
      });
      const emptyBtnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
      const cancelBtn = emptyBtnRow.createEl('button', { text: t('btnCancel') });
      cancelBtn.onclick = () => returnToHub(this);
      return;
    }

    const listEl = contentEl.createDiv({ cls: 'fm-scroll-list' });
    for (const item of this.results) {
      const row = listEl.createDiv({ cls: 'fm-list-item' });
      const left = row.createDiv({
        attr: { style: 'display:flex; align-items:center; gap:10px; flex:1; overflow:hidden;' }
      });

      const cb = left.createEl('input', { type: 'checkbox', attr: { style: 'cursor:pointer;' } });
      cb.checked = item.selected;
      cb.onchange = () => {
        item.selected = cb.checked;
      };

      renderItemVisualThumb(left, item, this.plugin);

      const infoCol = left.createDiv({ attr: { style: 'overflow:hidden; flex:1;' } });
      const topLine = infoCol.createDiv({ attr: { style: 'display:flex; align-items:center; gap:6px;' } });
      topLine.createSpan({
        text: item.source === 'local' ? '💻 Local' : '☁️ Remote',
        cls: `fm-tag ${item.source === 'local' ? 'fm-tag-local' : 'fm-tag-remote'}`
      });
      topLine.createSpan({
        text: item.displayPath,
        attr: { style: 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:500;' }
      });

      const rightBox = row.createDiv({
        attr: { style: 'display:flex; align-items:center; gap:8px; flex-shrink:0;' }
      });
      rightBox.createSpan({
        text: formatBytes(item.size),
        attr: { style: 'color: var(--text-muted); font-size: 12px;' }
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
    const cancelBtn = btnRow.createEl('button', { text: t('btnCancel') });
    cancelBtn.onclick = () => returnToHub(this);
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
      attr: { style: 'font-size: 13px; color: var(--text-muted); margin-bottom: 14px;' }
    });

    const isRemote = Boolean(this.plugin?.isRemoteServerReady?.());
    if (isRemote) {
      const scopeBox = contentEl.createDiv({ cls: 'fm-section-box' });
      scopeBox.createDiv({ text: t('dupLocScope'), cls: 'fm-section-title' });

      const scopes = [
        { key: 'both', label: t('dupCompareCross') },
        { key: 'local', label: t('dupCompareLocal') },
        { key: 'remote', label: t('dupCompareRemote') }
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
      attr: { style: 'font-size: 12px; color: var(--text-muted); padding: 10px 14px;' }
    });
    protBox.createDiv({
      text: t('dupProtRuleHint', { folders: exclFolders.join(', ') || '-' })
    });

    const progressWidget = createScanProgressWidget(contentEl, this.plugin);
    this.activeProgress = progressWidget;

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const cancelBtn = btnRow.createEl('button', { text: t('btnCancel') });
    cancelBtn.onclick = () => returnToHub(this);

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
    const leftTools = toolbar.createDiv({ attr: { style: 'display:flex; gap:8px; align-items:center; flex-wrap:wrap;' } });

    const backBtn = leftTools.createEl('button', { text: t('btnBack') });
    backBtn.onclick = () => {
      this.step = 1;
      this.render();
    };

    leftTools.createSpan({ text: t('dupStrategyLabel'), attr: { style: 'font-size:13px; font-weight:600; margin-left:4px;' } });
    const modeSelect = leftTools.createEl('select', { attr: { style: 'padding: 5px 8px; border-radius: 6px;' } });
    const modeOptions = [
      { value: 'auto', label: t('dupStrategyAuto') },
      { value: 'prefer-remote', label: t('dupStrategyPreferRemote') },
      { value: 'prefer-local', label: t('dupStrategyPreferLocal') }
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
        text: t('noticeRemoteUnreachable', { err: this.scanStats.remoteError }),
        attr: { style: 'font-size: 12px; color: #f59e0b; border-color: rgba(245, 158, 11, 0.4); padding: 10px 14px;' }
      });
    }

    if (this.groups.length === 0) {
      contentEl.createDiv({
        cls: 'fm-section-box',
        text: t('dupNoneFound'),
        attr: { style: 'text-align: center; padding: 36px 20px;' }
      });
      const emptyBtnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
      const closeBtn = emptyBtnRow.createEl('button', { text: t('closeBtn'), cls: 'mod-cta' });
      closeBtn.onclick = () => returnToHub(this);
      return;
    }

    const listEl = contentEl.createDiv({ cls: 'fm-scroll-list' });
    this.groups.forEach((grp, idx) => {
      const grpBox = listEl.createDiv({ cls: 'fm-dup-group' });
      const grpHead = grpBox.createDiv({ cls: 'fm-dup-group-header' });
      grpHead.createSpan({
        text: t('dupGroupHeader', { idx: idx + 1, hash: grp.sha256.slice(0, 12), size: formatBytes(grp.size) })
      });
      grpHead.createSpan({ text: t('dupGroupSubhint') });

      for (const item of grp.items) {
        const isKeep = grp.keepId === item.id;
        const row = grpBox.createDiv({ cls: 'fm-list-item' });
        const left = row.createDiv({
          attr: { style: 'display:flex; align-items:center; gap:8px; flex:1; overflow:hidden;' }
        });

        const radio = left.createEl('input', {
          type: 'radio',
          attr: { name: `dup_grp_${idx}`, style: 'cursor:pointer;' }
        });
        radio.checked = isKeep;
        radio.onchange = () => {
          grp.keepId = item.id;
          this.render();
        };

        renderItemVisualThumb(left, item, this.plugin);

        left.createSpan({
          text: isKeep ? t('dupTagKeep') : item.locked ? t('dupTagProtected') : t('dupTagRemove'),
          attr: { style: `font-size:12px; font-weight:700; color:${isKeep ? '#10b981' : item.locked ? '#f59e0b' : '#ef4444'}; width:68px; flex-shrink:0;` }
        });

        left.createSpan({
          text: item.source === 'local' ? t('analyticsBadgeLocal') : t('analyticsBadgeRemote'),
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
          attr: { title: t('dupDesignateKeepTitle'), attr: { style: 'word-break:break-all; cursor:pointer;' } }
        }).onclick = () => {
          grp.keepId = item.id;
          this.render();
        };

        const rightBox = row.createDiv({
          attr: { style: 'display:flex; align-items:center; gap:6px; flex-shrink:0;' }
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
    const cancelBtn = btnRow.createEl('button', { text: t('btnCancel') });
    cancelBtn.onclick = () => returnToHub(this);
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
    doneBtn.onclick = () => returnToHub(this);
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
      attr: { style: 'font-size: 13px; color: var(--text-muted); margin-bottom: 14px;' }
    });

    const folderBox = contentEl.createDiv({ cls: 'fm-section-box' });
    folderBox.createDiv({ text: t('migrateFolderScope'), cls: 'fm-section-title' });
    const folderSelect = folderBox.createEl('select', { attr: { style: 'width:100%; padding:8px 10px; border-radius:6px;' } });
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
    cancelBtn.onclick = () => {
      if (this.transferController) {
        this.transferController.abort();
        cancelBtn.disabled = true;
        cancelBtn.setText(t('transferStopping'));
      } else returnToHub(this);
    };

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
    const leftTools = toolbar.createDiv({ attr: { style: 'display:flex; gap:8px; align-items:center;' } });
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
        attr: { style: 'text-align: center; padding: 36px 20px;' }
      });
      const emptyBtnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
      const cancelBtn = emptyBtnRow.createEl('button', { text: t('btnCancel') });
      cancelBtn.onclick = () => {
      if (this.transferController) {
        this.transferController.abort();
        cancelBtn.disabled = true;
        cancelBtn.setText(t('transferStopping'));
      } else returnToHub(this);
    };
      return;
    }

    const listEl = contentEl.createDiv({ cls: 'fm-scroll-list' });
    for (const item of this.items) {
      const row = listEl.createDiv({ cls: 'fm-list-item' });
      const left = row.createDiv({
        attr: { style: 'display:flex; align-items:center; gap:10px; flex:1; overflow:hidden;' }
      });
      const cb = left.createEl('input', { type: 'checkbox', attr: { style: 'cursor:pointer;' } });
      cb.checked = item.selected;
      cb.onchange = () => {
        item.selected = cb.checked;
      };

      renderItemVisualThumb(left, item, this.plugin);

      left.createSpan({
        text: item.displayPath,
        attr: { style: 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:500;' }
      });

      const rightBox = row.createDiv({
        attr: { style: 'display:flex; align-items:center; gap:8px; flex-shrink:0;' }
      });
      rightBox.createSpan({
        text: formatBytes(item.size),
        attr: { style: 'color: var(--text-muted); font-size: 12px;' }
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

    const progressBox = contentEl.createDiv({ attr: { style: 'display:none; margin-bottom:10px;' } });
    const progressText = progressBox.createDiv({ attr: { style: 'font-size:12px; color:var(--text-accent);' } });
    const progressWrap = progressBox.createDiv({ cls: 'fm-progress-wrap' });
    const progressBar = progressWrap.createDiv({ cls: 'fm-progress-bar' });

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const cancelBtn = btnRow.createEl('button', { text: t('btnCancel') });
    cancelBtn.onclick = () => {
      if (this.transferController) {
        this.transferController.abort();
        cancelBtn.disabled = true;
        cancelBtn.setText(t('transferStopping'));
      } else returnToHub(this);
    };
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
      this.transferController = new AbortController();
      try {
      await this.plugin.executeBatchMigrateSafely(
        selected,
        { ...this.options, signal: this.transferController.signal },
        (cur, total, name) => {
          const pct = Math.round((cur / Math.max(1, total)) * 100);
          progressBar.style.width = `${pct}%`;
          progressText.setText(t('migrateProgress', { current: cur, total, name }));
        },
        (summary) => {
          this.step = 3;
          this.summary = summary;
          if (!this.transferClosed) this.render();
        }
      );
      } catch (err) {
        new Notice(err.message);
        runBtn.disabled = false;
        backBtn.disabled = false;
      } finally { this.transferController = null; }
    };
  }

  renderStep3(contentEl) {
    const t = (k, p) => this.plugin.t(k, p);
    const count = this.summary?.count || 0;
    const failures = this.summary?.failures || [];
    const processedItems = this.summary?.processedItems || [];

    const isPartial = failures.length > 0 && count > 0;
    const isError = count === 0 && failures.length > 0;
    const titleKey = this.summary?.cancelled ? 'transferCancelled' : isError
      ? 'batchResultErrorTitle'
      : (isPartial ? 'batchResultWarningTitle' : 'batchResultTitle');

    contentEl.createEl('h3', { text: t(titleKey) });

    const bannerCls = isError
      ? 'fm-result-banner fm-result-banner-error'
      : (isPartial ? 'fm-result-banner fm-result-banner-warning' : 'fm-result-banner fm-result-banner-success');
    const banner = contentEl.createDiv({ cls: bannerCls });
    banner.createDiv({ cls: 'fm-result-banner-title', text: t(titleKey) });

    const trashedText = this.summary?.trashed
      ? t('noticeBatchMigrateTrashedPart', { trashed: this.summary.trashed })
      : '';
    const failText = failures.length > 0
      ? t('batchResultFailuresPart', { count: failures.length })
      : '';
    const trashFailures = this.summary?.trashFailures || [];
    const trashFailText = trashFailures.length > 0
      ? t('batchResultTrashFailuresPart', { count: trashFailures.length })
      : '';

    banner.createDiv({
      cls: 'fm-result-banner-desc',
      text: t('batchResultDesc', {
        count,
        docs: this.summary?.docs || 0,
        trashed: trashedText
      }) + failText + trashFailText
    });

    if (processedItems.length > 0) {
      const listBox = contentEl.createDiv({
        cls: 'fm-section-box',
        attr: { style: 'margin-top: 10px;' }
      });
      listBox.createDiv({
        text: t('batchResultListTitle', { count: processedItems.length }),
        cls: 'fm-section-title'
      });
      const listEl = listBox.createDiv({
        cls: 'fm-scroll-list',
        attr: { style: 'max-height: 220px; margin-bottom: 0;' }
      });
      for (const pItem of processedItems) {
        const row = listEl.createDiv({ cls: 'fm-list-item' });
        const left = row.createDiv({
          attr: { style: 'display:flex; align-items:center; gap:10px; flex:1; overflow:hidden;' }
        });
        renderItemVisualThumb(left, pItem, this.plugin);
        const nameCol = left.createDiv({
          attr: { style: 'display:flex; flex-direction:column; overflow:hidden; flex:1;' }
        });
        nameCol.createSpan({
          text: pItem.name,
          attr: { style: 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:500;' }
        });
        nameCol.createSpan({
          text: `${pItem.displayPath} · ${formatBytes(pItem.size || 0)}`,
          attr: { style: 'font-size:11px; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;' }
        });

        const rightBox = row.createDiv({
          attr: { style: 'display:flex; align-items:center; gap:6px; flex-shrink:0;' }
        });
        if (pItem.rawUrl) {
          const copyBtn = rightBox.createEl('button', {
            cls: 'clickable-icon',
            attr: { 'aria-label': t('copyRawUrl') || 'Copy URL' }
          });
          setIcon(copyBtn, 'copy');
          copyBtn.onclick = async (e) => {
            e.stopPropagation();
            await navigator.clipboard.writeText(pItem.rawUrl);
            new Notice(t('noticeCopied'));
          };
        }
      }
    }

    if (failures.length > 0) {
      const failBox = contentEl.createDiv({
        cls: 'fm-section-box',
        attr: { style: 'margin-top: 10px; border-color: rgba(239, 68, 68, 0.4);' }
      });
      failBox.createDiv({
        text: t('batchFailuresTitle', { count: failures.length }),
        cls: 'fm-section-title',
        attr: { style: 'color: var(--text-error);' }
      });
      for (const f of failures) {
        failBox.createDiv({
          cls: 'fm-result-banner-desc',
          text: `• ${f.path || f.name} (${formatBytes(f.size || 0)}): ${f.error}`,
          attr: { style: 'font-size: 12px; color: var(--text-muted); margin-top: 2px;' }
        });
      }
    }

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    let createdReportPath = null;

    const exportBtn = btnRow.createEl('button', { text: t('batchExportReport') });
    exportBtn.onclick = async () => {
      exportBtn.disabled = true;
      try {
        createdReportPath = await this.plugin.exportBatchMigrateReportToRoot(this.summary);
        exportBtn.setText(t('batchReportExported'));
        if (!btnRow.querySelector('.fm-open-report-btn')) {
          const openBtn = btnRow.createEl('button', {
            text: t('batchOpenReport'),
            cls: 'fm-open-report-btn'
          });
          openBtn.onclick = () => {
            if (createdReportPath) {
              this.app.workspace.openLinkText(createdReportPath, '', true);
            }
            this.close();
          };
        }
      } catch (err) {
        new Notice('❌ ' + err.message);
        exportBtn.disabled = false;
      }
    };

    if (this.summary?.cancelled) btnRow.createSpan({ text: t('transferCancelled') });
    if (this.summary?.retryItems?.length) {
      const retry = btnRow.createEl('button', { text: t('transferRetry') });
      retry.onclick = () => {
        this.items = this.summary.retryItems.map((item) => ({ ...item, selected: true, refNotes: item.refNotes || [] }));
        this.step = 2;
        this.render();
      };
    }
    const doneBtn = btnRow.createEl('button', { text: t('destBtnDone'), cls: 'mod-cta' });
    doneBtn.onclick = () => returnToHub(this);
  }

  onClose() {
    this.transferClosed = true;
    this.transferController?.abort();
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
      attr: { style: 'font-size: 13px; color: var(--text-muted); margin-bottom: 14px;' }
    });

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
    const leftTools = toolbar.createDiv({ attr: { style: 'display:flex; gap:8px; align-items:center;' } });
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
        attr: { style: 'text-align: center; padding: 36px 20px; font-weight: 500;' }
      });
      const btnRow = contentEl.createDiv({ cls: 'fm-btn-row' });
      const closeBtn = btnRow.createEl('button', { text: t('closeBtn') });
      closeBtn.onclick = () => returnToHub(this);
      return;
    }

    const filterRow = contentEl.createDiv({
      attr: { style: 'display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:10px; flex-wrap:wrap;' }
    });
    const chipBox = filterRow.createDiv({ attr: { style: 'display:flex; gap:6px;' } });
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
      attr: { style: 'padding: 4px 10px; border-radius: 6px; border: 1px solid var(--background-modifier-border); min-width: 180px;' }
    });
    searchInput.oninput = (e) => {
      this.searchQuery = e.target.value.toLowerCase();
      this.renderIssueList(listEl);
    };

    const listEl = contentEl.createDiv({ cls: 'fm-scroll-list', attr: { style: 'max-height: 380px;' } });
    this.renderIssueList(listEl);

    const bottomRow = contentEl.createDiv({ cls: 'fm-btn-row' });
    const closeBtn = bottomRow.createEl('button', { text: t('closeBtn') });
    closeBtn.onclick = () => returnToHub(this);
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
      const row = listEl.createDiv({ cls: 'fm-list-item' });
      const leftCol = row.createDiv({
        attr: { style: 'display:flex; flex-direction:column; gap:4px; flex:1; overflow:hidden;' }
      });

      const topMeta = leftCol.createDiv({ attr: { style: 'display:flex; align-items:center; gap:6px;' } });
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
      topMeta.createEl('code', { text: item.target, attr: { style: 'font-size: 12px; font-weight: 600;' } });
      topMeta.createSpan({
        text: t('healthLine', { line: item.line }),
        attr: { style: 'font-size: 11px; color: var(--text-muted); margin-left: auto;' }
      });

      const noteRef = leftCol.createDiv({
        attr: { style: 'font-size: 12px; color: var(--text-muted); display:flex; align-items:center; gap:4px;' }
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
        attr: { style: 'flex-shrink:0; align-self:center;' }
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
      attr: { style: 'text-align: center; padding: 32px 20px;' }
    });

    try {
      this.stats = await this.plugin.scanVaultAnalytics();
      loadingEl.remove();
      this.renderDashboard(contentEl);
    } catch (err) {
      loadingEl.setText(t('analyticsFail', { err: err.message }));
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
      attr: { style: 'display:grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 8px;' }
    });

    const localCard = summaryRow.createDiv({
      attr: { style: 'padding: 12px; border-radius: 8px; background: var(--background-primary); border: 1px solid var(--background-modifier-border);' }
    });
    localCard.createDiv({ text: t('analyticsLocalVault'), attr: { style: 'font-weight: 600; font-size: 13px;' } });
    localCard.createDiv({
      text: `${s.local.totalCount} · ${formatBytes(s.local.totalBytes)} (${localPct}%)`,
      attr: { style: 'font-size: 15px; font-weight: 700; margin-top: 4px; color: var(--text-accent);' }
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
      attr: { style: 'font-size: 11px; color: var(--text-muted); margin-top: 6px;' }
    });

    const remoteCard = summaryRow.createDiv({
      attr: { style: 'padding: 12px; border-radius: 8px; background: var(--background-primary); border: 1px solid var(--background-modifier-border);' }
    });
    remoteCard.createDiv({ text: t('analyticsRemoteServer'), attr: { style: 'font-weight: 600; font-size: 13px;' } });
    remoteCard.createDiv({
      text: `${s.remote.totalCount} · ${formatBytes(s.remote.rawBytes)} (${remotePct}%)`,
      attr: { style: 'font-size: 15px; font-weight: 700; margin-top: 4px; color: #10b981;' }
    });
    remoteCard.createDiv({
      text: t('analyticsRemoteStats', {
        cache: formatBytes(s.remote.cacheBytes),
        locked: s.remote.lockedCount
      }),
      attr: { style: 'font-size: 11px; color: var(--text-muted); margin-top: 6px;' }
    });

    if (s.topLargestAttachments.length > 0) {
      const topBox = contentEl.createDiv({ cls: 'fm-section-box' });
      topBox.createDiv({ text: t('analyticsTopLargest'), cls: 'fm-section-title' });
      const listEl = topBox.createDiv({ cls: 'fm-scroll-list', attr: { style: 'max-height: 210px;' } });
      for (const item of s.topLargestAttachments) {
        const row = listEl.createDiv({ cls: 'fm-list-item' });
        const badge = item.source === 'local' ? t('analyticsBadgeLocal') : t('analyticsBadgeRemote');
        row.createSpan({
          text: `${badge} · ${item.path}`,
          attr: { style: 'font-size: 12px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;' }
        });
        row.createSpan({
          text: formatBytes(item.size),
          attr: { style: 'font-size: 12px; font-weight: 600; color: var(--text-muted); flex-shrink: 0;' }
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
    closeBtn.onclick = () => returnToHub(this);
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
      const box = contentEl.createDiv({ cls: 'fm-section-box', attr: { style: 'text-align:center; padding:40px 16px;' } });
      box.createDiv({ text: this.t('galleryLoading'), attr: { style: 'font-size:14px; color:var(--text-accent);' } });
      return;
    }

    if (this.error) {
      const box = contentEl.createDiv({ cls: 'fm-result-banner fm-result-banner-error' });
      box.createDiv({ cls: 'fm-result-banner-title', text: this.t('galleryLoadFail', { err: this.error }) });
      const retryBtn = box.createEl('button', { text: this.t('galleryBtnRefresh'), cls: 'fm-mini-btn', attr: { style: 'margin-top:8px;' } });
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
    return filterRemoteGallery(this);
  }

  renderGrid(containerEl, countLabel) {
    renderRemoteGallery(this, containerEl, countLabel);
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
      const box = contentEl.createDiv({ cls: 'fm-section-box', attr: { style: 'text-align:center; padding:30px 12px;' } });
      box.createDiv({ text: this.t('galleryLoading'), attr: { style: 'font-size:12px; color:var(--text-accent);' } });
      return;
    }

    if (this.error) {
      const box = contentEl.createDiv({ cls: 'fm-result-banner fm-result-banner-error', attr: { style: 'margin:8px 0;' } });
      box.createDiv({ cls: 'fm-result-banner-title', text: this.t('galleryLoadFail', { err: this.error }), attr: { style: 'font-size:12px;' } });
      const retryBtn = box.createEl('button', { text: this.t('galleryBtnRefresh'), cls: 'fm-mini-btn', attr: { style: 'margin-top:6px;' } });
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
    return filterRemoteGallery(this);
  }

  renderGrid(containerEl, countLabel) {
    renderRemoteGallery(this, containerEl, countLabel);
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

/**
 * Operation & Debug Log Viewer/Exporter Modal
 */
class OperationLogModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.filterMode = 'all'; // 'all' | 'errors'
    this.searchQuery = '';
  }

  t(k, p) {
    return this.plugin ? this.plugin.t(k, p) : k;
  }

  async onOpen() {
    if (this.plugin?.loadOperationLogs) {
      await this.plugin.loadOperationLogs();
    }
    this.render();
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('fm-wizard-modal');

    const header = contentEl.createDiv({ cls: 'fm-step-header' });
    header.createEl('h3', { text: this.t('opLogTitle'), cls: 'fm-step-title' });

    contentEl.createDiv({
      text: this.t('opLogPathHint', { path: this.plugin?.getLogFilePath?.() || '.obsidian/plugins/file-master/operation.log' }),
      attr: { style: 'font-size: 12px; color: var(--text-muted); margin-bottom: 12px;' }
    });

    const allLogs = Array.isArray(this.plugin?.operationLogs) ? [...this.plugin.operationLogs].reverse() : [];
    const errCount = allLogs.filter((e) => e.level === 'ERROR' || e.level === 'WARN').length;

    const filterRow = contentEl.createDiv({
      attr: { style: 'display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:10px; flex-wrap:wrap;' }
    });
    const chipBox = filterRow.createDiv({ attr: { style: 'display:flex; gap:6px;' } });

    const allBtn = chipBox.createEl('button', {
      text: `${this.t('opLogFilterAll')} (${allLogs.length})`,
      cls: this.filterMode === 'all' ? 'mod-cta' : ''
    });
    allBtn.onclick = () => {
      this.filterMode = 'all';
      this.render();
    };

    const errBtn = chipBox.createEl('button', {
      text: `${this.t('opLogFilterErrors')} (${errCount})`,
      cls: this.filterMode === 'errors' ? 'mod-cta' : ''
    });
    errBtn.onclick = () => {
      this.filterMode = 'errors';
      this.render();
    };

    const searchInput = filterRow.createEl('input', {
      type: 'search',
      placeholder: this.t('opLogSearchPlaceholder'),
      value: this.searchQuery,
      attr: { style: 'padding: 4px 10px; border-radius: 6px; border: 1px solid var(--background-modifier-border); min-width: 190px;' }
    });

    const listEl = contentEl.createDiv({
      cls: 'fm-scroll-list',
      attr: { style: 'max-height: 360px;' }
    });

    searchInput.oninput = (e) => {
      this.searchQuery = e.target.value.toLowerCase();
      this.renderLogList(listEl, allLogs);
    };

    this.renderLogList(listEl, allLogs);

    const btnRow = contentEl.createDiv({ cls: 'fm-btn-row', attr: { style: 'justify-content: space-between; flex-wrap: wrap; gap: 8px;' } });
    const leftBtns = btnRow.createDiv({ attr: { style: 'display: flex; gap: 8px; flex-wrap: wrap;' } });

    const copyBtn = leftBtns.createEl('button', { text: this.t('opLogCopyAll'), cls: 'mod-cta' });
    copyBtn.onclick = async () => {
      const text = this.plugin?.formatLogsForExport?.() || '';
      await navigator.clipboard.writeText(text);
      new Notice(this.t('opLogCopiedNotice'));
    };

    const exportBtn = leftBtns.createEl('button', { text: this.t('opLogExportFile') });
    exportBtn.onclick = () => {
      const text = this.plugin?.formatLogsForExport?.() || '';
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const now = new Date();
      const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
      a.href = url;
      a.download = `file-master-debug-${dateStr}.log`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    };

    const clearBtn = leftBtns.createEl('button', { text: this.t('opLogClear') });
    clearBtn.onclick = async () => {
      if (this.plugin?.clearOperationLogs) {
        await this.plugin.clearOperationLogs();
      }
      new Notice(this.t('opLogClearedNotice'));
      this.render();
    };

    const closeBtn = btnRow.createEl('button', { text: this.t('closeBtn') });
    closeBtn.onclick = () => this.close();
  }

  renderLogList(listEl, allLogs) {
    listEl.empty();
    let filtered = allLogs;
    if (this.filterMode === 'errors') {
      filtered = filtered.filter((e) => e.level === 'ERROR' || e.level === 'WARN');
    }
    if (this.searchQuery) {
      filtered = filtered.filter((e) => {
        const hay = `${e.ts || ''} ${e.level || ''} ${e.action || ''} ${e.summary || ''} ${e.details ? JSON.stringify(e.details) : ''}`.toLowerCase();
        return hay.includes(this.searchQuery);
      });
    }

    if (filtered.length === 0) {
      listEl.createDiv({
        cls: 'fm-section-box',
        text: this.t('opLogEmpty'),
        attr: { style: 'text-align: center; padding: 28px 16px; color: var(--text-muted);' }
      });
      return;
    }

    for (const entry of filtered) {
      const row = listEl.createDiv({ cls: 'fm-list-item' });
      const col = row.createDiv({
        attr: { style: 'display:flex; flex-direction:column; gap:4px; flex:1; overflow:hidden;' }
      });

      const topRow = col.createDiv({
        attr: { style: 'display:flex; align-items:center; gap:6px; flex-wrap:wrap;' }
      });
      let levelCls = 'fm-tag-info';
      if (entry.level === 'ERROR') levelCls = 'fm-tag-error';
      else if (entry.level === 'WARN') levelCls = 'fm-tag-warning';

      topRow.createSpan({ text: entry.level || 'INFO', cls: `fm-tag ${levelCls}` });
      if (entry.action) {
        topRow.createEl('code', { text: entry.action, attr: { style: 'font-size: 11px;' } });
      }
      topRow.createSpan({
        text: entry.ts || '',
        attr: { style: 'font-size: 11px; color: var(--text-muted); margin-left: auto;' }
      });

      col.createDiv({
        text: entry.summary || '',
        attr: { style: 'font-size: 12px; font-weight: 500; word-break: break-word;' }
      });

      if (entry.details && Object.keys(entry.details).length > 0) {
        col.createDiv({
          text: JSON.stringify(entry.details),
          cls: 'fm-health-context-quote',
          attr: { style: 'font-family: var(--font-monospace); font-size: 11px; word-break: break-all;' }
        });
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

  getLogFilePath() {
    const dir = this.manifest?.dir || `${this.app?.vault?.configDir || '.obsidian'}/plugins/${this.manifest?.id || 'file-master'}`;
    return `${dir}/operation.log`;
  }

  async loadOperationLogs() {
    if (!Array.isArray(this.operationLogs)) {
      this.operationLogs = [];
    }
    try {
      const adapter = this.app?.vault?.adapter;
      const logPath = this.getLogFilePath();
      if (adapter && (await adapter.exists(logPath))) {
        const raw = await adapter.read(logPath);
        const parsed = [];
        for (const line of String(raw || '').split('\n')) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            parsed.push(JSON.parse(trimmed));
          } catch { }
        }
        this.operationLogs = parsed.slice(-500);
      }
    } catch { }
    return this.operationLogs;
  }

  async saveOperationLogs() {
    try {
      const adapter = this.app?.vault?.adapter;
      if (!adapter) return;
      const logPath = this.getLogFilePath();
      const lines = (this.operationLogs || []).slice(-500).map((entry) => JSON.stringify(entry));
      await adapter.write(logPath, lines.join('\n') + (lines.length ? '\n' : ''));
    } catch { }
  }

  logOperation(level, action, summary, details = null) {
    if (!Array.isArray(this.operationLogs)) {
      this.operationLogs = [];
    }
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const entry = {
      ts,
      level: String(level || 'INFO').toUpperCase(),
      action: String(action || 'GENERAL'),
      summary: String(summary || '')
    };
    if (details && typeof details === 'object' && Object.keys(details).length > 0) {
      entry.details = details;
    }
    this.operationLogs.push(entry);
    if (this.operationLogs.length > 500) {
      this.operationLogs = this.operationLogs.slice(-500);
    }
    this.saveOperationLogs();
  }

  async clearOperationLogs() {
    this.operationLogs = [];
    await this.saveOperationLogs();
  }

  formatLogsForExport() {
    const version = this.manifest?.version || '1.0.2';
    const serverStatus = this.lastServerCompatStatus
      ? `${this.lastServerCompatStatus.status} (server v${this.lastServerCompatStatus.serverVersion || '?'})`
      : (this.settings?.enableRemoteServer ? 'unverified' : 'disabled');
    const header = [
      `# File Master Diagnostic & Operation Logs`,
      `# Plugin Version: v${version}`,
      `# Exported At: ${new Date().toISOString()}`,
      `# Server Status: ${serverStatus}`,
      `# Excluded Local Folders: ${this.settings?.excludedLocalFolders || '(none)'}`,
      `# Total Entries: ${(this.operationLogs || []).length}`,
      `------------------------------------------------------------`
    ];
    const body = (this.operationLogs || []).map((e) => {
      const detailStr = e.details ? ` | ${JSON.stringify(e.details)}` : '';
      return `[${e.ts}] [${e.level}] [${e.action}] ${e.summary}${detailStr}`;
    });
    return [...header, ...body].join('\n');
  }

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

  isDocFile(file) {
    return isDocFile(file, this.app);
  }

  isScannableDocFile(file) {
    return Boolean(file) && this.isDocFile(file) && !isReportFile(file.name);
  }

  isExcalidrawFile(file, content = null) {
    return isExcalidrawFile(file, this.app, content);
  }

  reloadOpenExcalidrawViews(filePath) {
    if (!filePath || !this.app?.workspace) return;
    try {
      const leaves = this.app.workspace.getLeavesOfType('excalidraw');
      for (const leaf of leaves) {
        const viewFile = leaf.view?.file;
        if (viewFile && (viewFile.path === filePath || viewFile.name === filePath)) {
          if (typeof leaf.view.reload === 'function') {
            leaf.view.reload();
          } else if (typeof leaf.rebuildView === 'function') {
            leaf.rebuildView();
          } else if (typeof leaf.setViewState === 'function') {
            const state = leaf.getViewState();
            leaf.setViewState(state);
          }
        }
      }
    } catch (err) {
      console.warn('[FileMaster] Could not reload Excalidraw view:', err);
    }
  }

  async safeModifyFileContent(tfile, transformFn) {
    let changed = false;
    if (typeof this.app.vault.process === 'function') {
      await this.app.vault.process(tfile, (data) => {
        const next = transformFn(data);
        if (next !== data) changed = true;
        return next;
      });
    } else {
      const orig = await this.app.vault.read(tfile);
      const next = transformFn(orig);
      if (next !== orig) {
        await this.app.vault.modify(tfile, next);
        changed = true;
      }
    }

    if (changed && this.isExcalidrawFile(tfile)) {
      this.reloadOpenExcalidrawViews(tfile.path);
    }

    return changed;
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
    const sha256 = await computeSha256Hex(arrayBuffer);
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
    const opts = typeof options === 'boolean' ? { uploadToProtected: options } : (options || {});
    throwIfTransferCancelled(opts.signal);
    const fullSha256 = await computeSha256Hex(arrayBuffer);
    // 1. Instant Upload Probe via local SHA-256 calculation (0 network payload)
    if (!opts.skipProbe) {
      try {
        const probed = await this.probeRemoteSha256(fullSha256);
        if (probed && probed.exists && probed.sha256 === fullSha256) {
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

    const response = await requestWithBackoff(() => requestUrl({
      url,
      method: 'POST',
      headers,
      body: bodyBuffer,
      throw: false
    }), { signal: opts.signal });

    if (response.status < 200 || response.status >= 300) {
      const errMsg = response.json?.error || `HTTP ${response.status}`;
      throw new Error(errMsg);
    }

    const result = response.json;
    if (!result.sha256 || result.sha256 !== fullSha256) throw new Error(this.t('transferIntegrityFailed'));
    return result;
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
      this.settings.serverVerified = false;
      await this.saveSettings();
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
        this.settings.serverVerified = false;
        await this.saveSettings();
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
        this.settings.serverVerified = false;
        await this.saveSettings();
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
        this.settings.serverVerified = false;
        await this.saveSettings();
        return this.lastServerCompatStatus;
      }

      // 3. Test API Auth token against image-host list
      let assetCount = 0;
      const token = (this.settings.apiToken || '').trim();
      if (!token) {
        this.lastServerCompatStatus = {
          ok: false,
          status: 'token_missing',
          serverVersion: serverVer,
          pluginVersion: pluginVer,
          features: verData.features || {}
        };
        this.settings.serverVerified = false;
        await this.saveSettings();
        return this.lastServerCompatStatus;
      }

      let listRes;
      try {
        listRes = await requestUrl({
          url: `${serverUrl}/api/modules/image-host/list`,
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
          throw: false
        });
      } catch (netErr) {
        this.lastServerCompatStatus = {
          ok: false,
          status: 'offline',
          serverVersion: serverVer,
          pluginVersion: pluginVer,
          error: netErr.message || String(netErr)
        };
        this.settings.serverVerified = false;
        await this.saveSettings();
        return this.lastServerCompatStatus;
      }

      if (listRes.status === 401 || listRes.status === 403) {
        this.lastServerCompatStatus = {
          ok: false,
          status: 'auth_failed',
          serverVersion: serverVer,
          pluginVersion: pluginVer,
          features: verData.features || {}
        };
        this.settings.serverVerified = false;
        await this.saveSettings();
        return this.lastServerCompatStatus;
      }

      if (listRes.status !== 200) {
        this.lastServerCompatStatus = {
          ok: false,
          status: 'server_error',
          statusCode: listRes.status,
          serverVersion: serverVer,
          pluginVersion: pluginVer,
          features: verData.features || {}
        };
        this.settings.serverVerified = false;
        await this.saveSettings();
        return this.lastServerCompatStatus;
      }

      assetCount = (listRes.json?.images || []).length;

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
    const { signal, onProgress, freshRead = false } = scanCtx || {};
    const revision = this.referenceRevision || 0;
    const allFiles = this.app.vault.getFiles();
    const docFiles = allFiles.filter((f) => this.isScannableDocFile(f));
    const matchLocal = createLocalReferenceMatcher(allFiles, (file) => this.isExcalidrawFile(file));
    const localReferences = new Map();

    const docContents = [];
    for (let i = 0; i < docFiles.length; i++) {
      if (signal?.aborted) throw new Error('SCAN_ABORTED');
      const doc = docFiles[i];
      if (i % 25 === 0) {
        onProgress?.(i + 1, docFiles.length, doc.path);
        await new Promise((r) => setTimeout(r, 0));
      }
      const rawText = freshRead
        ? await this.app.vault.read(doc)
        : await this.app.vault.cachedRead(doc);
      let decodedText = rawText;
      try {
        decodedText = decodeURIComponent(rawText);
      } catch { }
      for (const target of matchLocal(stripRemoteReferenceText(rawText))) addReference(localReferences, target, doc.path);
      if (decodedText !== rawText) {
        for (const target of matchLocal(stripRemoteReferenceText(decodedText))) addReference(localReferences, target, doc.path);
      }
      docContents.push({
        file: doc,
        path: doc.path,
        rawText,
        decodedText
      });
    }

    if (!freshRead) {
      const resolvedLinks = this.app.metadataCache.resolvedLinks || {};
      for (const [sourcePath, targets] of Object.entries(resolvedLinks)) {
        if (isReportFile(sourcePath)) {
          continue;
        }
        for (const targetPath of Object.keys(targets || {})) {
          addReference(localReferences, targetPath, sourcePath);
        }
      }
    }

    return { docContents, localReferences, revision, signal,
      stable: revision === (this.referenceRevision || 0) };
  }

  isReferenceSnapshotCurrent(snapshot) {
    return snapshot.stable && snapshot.revision === (this.referenceRevision || 0);
  }

  async indexRemoteReferences(items, snapshot) {
    const patterns = [];
    for (const item of items) {
      const id = `${item.year}/${item.month}/${item.filename}`;
      const legacy = `${item.year}/${item.month}/${getBaseName(item.filename)}.webp`;
      for (const value of new Set([id, encodeURI(id), legacy, encodeURI(legacy), item.rawUrl, item.pubUrl])) {
        if (value) patterns.push({ value, id });
      }
    }
    const match = createTextReferenceMatcher(patterns);
    snapshot.remoteReferences = new Map(items.map((item) => [`${item.year}/${item.month}/${item.filename}`, new Set()]));
    for (let i = 0; i < snapshot.docContents.length; i++) {
      if (snapshot.signal?.aborted) throw new Error('SCAN_ABORTED');
      if (i % 25 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      const doc = snapshot.docContents[i];
      for (const id of match(doc.rawText)) addReference(snapshot.remoteReferences, id, doc.path);
      if (doc.decodedText !== doc.rawText) {
        for (const id of match(doc.decodedText)) addReference(snapshot.remoteReferences, id, doc.path);
      }
    }
  }

  findReferencingNotesForLocalFile(tfile, snapshot) {
    return [...(snapshot.localReferences.get(tfile.path) || [])];
  }

  findReferencingNotesForRemoteItem(remoteItem, snapshot) {
    return [...(snapshot.remoteReferences.get(`${remoteItem.year}/${remoteItem.month}/${remoteItem.filename}`) || [])];
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
        await this.indexRemoteReferences(remoteFiles, snapshot);
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
    const dateStr = formatDateYMD(now);
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
    return runAttachmentOperation(this, () => this.cleanOrphanItems(selectedItems, onDone));
  }

  async cleanOrphanItems(selectedItems, onDone) {
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
    let skipped = 0;
    const snapshot = await this.buildVaultReferenceSnapshot({ freshRead: true });
    await this.indexRemoteReferences(remoteToClean.map((item) => item.rawObj), snapshot);

    for (const item of localToClean) {
      if (!this.isReferenceSnapshotCurrent(snapshot)) { skipped++; continue; }
      if (this.findReferencingNotesForLocalFile(item.rawObj, snapshot).length) { skipped++; continue; }
      try {
        await this.app.vault.trash(item.rawObj, true);
        deletedLocal++;
      } catch (err) {
        console.error('Failed to delete local file:', err);
        this.logOperation('ERROR', 'ORPHAN_CLEANUP', `Failed to move local file to trash: ${item.displayPath}`, { error: err.message });
      }
    }

    for (const item of remoteToClean) {
      if (!this.isReferenceSnapshotCurrent(snapshot)) { skipped++; continue; }
      if (this.findReferencingNotesForRemoteItem(item.rawObj, snapshot).length) { skipped++; continue; }
      try {
        await this.deleteRemoteFile(item.rawObj.year, item.rawObj.month, item.rawObj.filename);
        deletedRemote++;
      } catch (err) {
        new Notice(this.t('noticeRemoteDeleteFailed', { name: item.name, err: err.message }));
        this.logOperation('ERROR', 'ORPHAN_CLEANUP', `Failed to delete remote file: ${item.displayPath}`, { error: err.message });
      }
    }

    this.logOperation('INFO', 'ORPHAN_CLEANUP', `Cleaned unreferenced files: ${deletedLocal} local, ${deletedRemote} remote`, {
      files: selectedItems.map((i) => i.displayPath)
    });
    new Notice(this.t('noticeCleanupComplete', { local: deletedLocal, remote: deletedRemote }));
    if (onDone) onDone({ local: deletedLocal, remote: deletedRemote, skipped, total: deletedLocal + deletedRemote });
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
        await this.indexRemoteReferences(remoteFiles, snapshot);
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

          const sha256 = await computeSha256Hex(buf);
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
    const dateStr = formatDateYMD(now);
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

  async exportBatchMigrateReportToRoot(summary) {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const dateStr = formatDateYMD(now);
    const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const reportPath = `Batch_Migrate_Report_${dateStr}.md`;

    const count = summary?.count || 0;
    const docs = summary?.docs || 0;
    const totalBytes = summary?.totalBytes || 0;
    const trashed = summary?.trashed || 0;
    const items = summary?.processedItems || [];
    const failures = summary?.failures || [];
    const trashFailures = summary?.trashFailures || [];

    const lines = [
      `# 🚀 批量云端迁移报告 / Batch Migration Report (${dateStr})`,
      ``,
      `> 生成时间 / Generated: ${dateStr} ${timeStr}  |  成功迁移附件 / Uploaded: **${count}** (${formatBytes(totalBytes)})  |  更新笔记 / Notes Updated: **${docs}**  |  本地清理 / Trashed: **${trashed}**`,
      ``,
      `## 📊 迁移汇总统计 / Summary Statistics`,
      `- **成功上传文件 (Total Uploaded)**: ${count} 个 (${formatBytes(totalBytes)})`,
      `- **引用链接已更新笔记 (Notes Updated)**: ${docs} 篇`,
      `- **本地原文件已移入回收站 (Local Trashed)**: ${trashed} 个`,
      `- **上传失败项 (Failed Uploads)**: ${failures.length} 个`,
      ...(trashFailures.length > 0 ? [`- **本地清理失败项 (Failed Local Cleanups)**: ${trashFailures.length} 个`] : []),
      ``,
      `## ☁️ 已迁移附件清单 / Migrated Assets (${items.length})`,
      ``
    ];

    if (items.length === 0) {
      lines.push(`- 无已迁移附件 / No assets were migrated.`);
    } else {
      lines.push(`| # | 本地原路径 (Local Path) | 服务器链接 (Remote URL) | 文件大小 (Size) | 引用数 (Refs) |`);
      lines.push(`|---|---|---|---|---|`);
      items.forEach((item, idx) => {
        const localPath = item.displayPath || item.name;
        const remoteUrl = item.rawUrl || (item.rawObj && item.rawObj.rawUrl) || '';
        const sizeStr = formatBytes(item.size || 0);
        const refsCount = item.refNotesCount !== undefined ? `${item.refNotesCount} 篇` : '-';
        const remoteLink = remoteUrl ? `[${item.name || 'Link'}](${remoteUrl})` : '-';
        lines.push(`| ${idx + 1} | \`${localPath}\` | ${remoteLink} | ${sizeStr} | ${refsCount} |`);
      });
    }

    if (failures.length > 0) {
      lines.push(``);
      lines.push(`## ⚠️ 上传失败项 / Failed Uploads (${failures.length})`);
      lines.push(``);
      failures.forEach((f, idx) => {
        lines.push(`- **#${idx + 1}**: \`${f.path || f.name}\` (${formatBytes(f.size || 0)}) — 错误原因 / Reason: ${f.error}`);
      });
    }

    if (trashFailures.length > 0) {
      lines.push(``);
      lines.push(`## ⚠️ 本地清理失败项 / Failed Local Cleanups (${trashFailures.length})`);
      lines.push(``);
      trashFailures.forEach((tf, idx) => {
        lines.push(`- **#${idx + 1}**: \`${tf.path}\` — 错误原因 / Reason: ${tf.error}`);
      });
    }

    lines.push(``);
    lines.push(`---`);
    lines.push(`*Generated by File Master Obsidian Plugin*`);

    await this.writeOrUpdateRootReport(reportPath, lines.join('\n'));
    new Notice(this.t('noticeReportGenerated', { path: reportPath }));
    return reportPath;
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
      (f) => this.isScannableDocFile(f) && !this.isLocalPathExcluded(f.path)
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

    this.logOperation('INFO', 'HEALTH_SCAN', `Scanned ${docFiles.length} document(s), found ${issues.length} broken link issue(s)`, {
      docsScanned: docFiles.length,
      issuesFound: issues.length
    });
    return { issues, totalDocs: docFiles.length };
  }

  async exportHealthReportToRoot(issues, totalDocsScanned) {
    const now = new Date();
    const dateStr = formatDateYMD(now);
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
    const docFiles = allFiles.filter((f) => this.isScannableDocFile(f));

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
    const dateStr = formatDateYMD(now);
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

  rewriteContentLinks(content, removeItem, keepItem, docPathOrContext = '') {
    if (typeof content !== 'string' || !content) return content;

    const docPath = typeof docPathOrContext === 'string' ? docPathOrContext : (docPathOrContext?.docPath || '');
    const customResolve = typeof docPathOrContext === 'object' && typeof docPathOrContext?.resolveLink === 'function'
      ? docPathOrContext.resolveLink
      : null;

    const resolveLink = (ref) => {
      if (customResolve) return customResolve(ref);
      if (this.app?.metadataCache?.getFirstLinkpathDest) {
        const tfile = this.app.metadataCache.getFirstLinkpathDest(ref, docPath || '');
        return tfile ? tfile.path : null;
      }
      return null;
    };

    const isDocExcalidraw =
      (docPath && (docPath.endsWith('.excalidraw.md') || docPath.endsWith('.excalidraw'))) ||
      (!docPath && /(^##\s+Embedded [Ff]iles\s*?\r?\n)/m.test(content)) ||
      (typeof isExcalidrawContent === 'function' && isExcalidrawContent(content));

    let excalSection = null;
    let preSection = content;
    let postSection = '';
    const sectionRegex = /(^##\s+Embedded [Ff]iles\s*?\r?\n)([\s\S]*?)(?=(?:\r?\n## |\r?\n%%|\r?\n# |$))/m;
    const match = isDocExcalidraw ? sectionRegex.exec(content) : null;
    if (match) {
      if (typeof rewriteExcalidrawEmbeddedFiles === 'function') {
        excalSection = rewriteExcalidrawEmbeddedFiles(match[0], removeItem, keepItem, { docPath, resolveLink });
      } else {
        excalSection = match[0];
      }
      preSection = content.slice(0, match.index);
      postSection = content.slice(match.index + match[0].length);
    }

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

    const rewriteMarkdownFragment = (fragment) => {
      if (!fragment) return fragment;
      let updated = fragment;

      if (removeItem.source === 'local') {
        const candidates = new Set([
          removeItem.displayPath,
          removeItem.name,
          encodeURI(removeItem.displayPath),
          encodeURI(removeItem.name),
          encodeURIComponent(removeItem.name)
        ]);

        const isBareCandidate = (c) => !c.includes('/');

        for (const cand of candidates) {
          const esc = escapeRegExp(cand);
          const isBare = isBareCandidate(cand);

          const checkBareMatchAllowed = () => {
            if (!isBare) return true;
            const hasActiveResolver = Boolean(
              customResolve ||
              (this.app?.metadataCache?.getFirstLinkpathDest && docPath)
            );
            if (hasActiveResolver) {
              const dest = resolveLink(cand);
              if (!dest) {
                // Link is dangling, ambiguous, or resolves to another file -> do NOT rewrite
                return false;
              }
              const destPath = dest.toLowerCase().replace(/^\.?\//, '');
              const targetPath = (removeItem.displayPath || '').toLowerCase().replace(/^\.?\//, '');
              return destPath === targetPath;
            }
            return true;
          };

          const wikiEmbedRe = new RegExp(`!\\[\\[(?:\\.\\/)?${esc}(?:#[^\\]|]*)?(?:\\|([^\\]]*))?\\]\\]`, 'g');
          updated = updated.replace(wikiEmbedRe, (m, alias) => {
            if (!checkBareMatchAllowed()) return m;
            return buildReplacementForWikiEmbed(alias);
          });

          const wikiLinkRe = new RegExp(`(?<!!)\\[\\[(?:\\.\\/)?${esc}(?:#[^\\]|]*)?(?:\\|([^\\]]*))?\\]\\]`, 'g');
          updated = updated.replace(wikiLinkRe, (m, alias) => {
            if (!checkBareMatchAllowed()) return m;
            return buildReplacementForWikiLink(alias);
          });

          const mdLinkRe = new RegExp(`(!?)\\[([^\\]]*)\\]\\(<?(?:\\.\\.?\\/)*${esc}(?:[?#][^)\\s>]*)?>?\\)`, 'g');
          updated = updated.replace(mdLinkRe, (m, bang, alt) => {
            if (!checkBareMatchAllowed()) return m;
            return buildReplacementForMdLink(bang === '!', alt);
          });
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
          const remoteMdRe = new RegExp(`(!?)\\[([^\\]]*)\\]\\(([^)\\s]*${esc})(?:[?#][^)\\s]*)?\\)`, 'g');
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
    };

    const rewrittenPre = rewriteMarkdownFragment(preSection);
    const rewrittenPost = rewriteMarkdownFragment(postSection);

    if (match && excalSection !== null) {
      return rewrittenPre + excalSection + rewrittenPost;
    }
    return rewrittenPre;
  }

  async executeDuplicateMergeSafely(groups, onComplete) {
    return runAttachmentOperation(this, () => this.mergeDuplicateGroups(groups, onComplete));
  }

  async mergeDuplicateGroups(groups, onComplete) {
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
      .filter((f) => this.isScannableDocFile(f));

    const localPathsBeingRemoved = new Set();
    for (const { removeItems } of tasks) {
      for (const rem of removeItems) {
        if (rem.source === 'local' && !rem.locked) {
          localPathsBeingRemoved.add(rem.displayPath);
        }
      }
    }

    const pairs = tasks.flatMap(({ keepItem, removeItems }) => removeItems.map((removeItem) => ({ removeItem, keepItem })));
    const rewritten = await rewriteAttachmentPairs(this, pairs,
      allDocs.filter((doc) => !localPathsBeingRemoved.has(doc.path)).map((doc) => doc.path));
    const modifiedDocsCount = rewritten.modified.size;
    const postSnapshot = await this.buildVaultReferenceSnapshot({ freshRead: true });
    await this.indexRemoteReferences(pairs.filter((p) => p.removeItem.source === 'remote').map((p) => p.removeItem.rawObj), postSnapshot);
    const localGatePatterns = pairs.filter((pair) => pair.removeItem.source === 'local').map(({ removeItem, keepItem }) => ({
      value: keepItem.name === removeItem.name ? removeItem.displayPath : removeItem.name,
      id: removeItem.displayPath
    }));
    const matchLocalGate = createTextReferenceMatcher(localGatePatterns);
    const remainingLocal = new Map();
    for (const doc of postSnapshot.docContents) {
      if (localPathsBeingRemoved.has(doc.path)) continue;
      for (const path of matchLocalGate(doc.rawText)) addReference(remainingLocal, path, doc.path);
      if (doc.decodedText !== doc.rawText) {
        for (const path of matchLocalGate(doc.decodedText)) addReference(remainingLocal, path, doc.path);
      }
    }
    let deletedLocalCount = 0;
    let deletedRemoteCount = 0;
    let skippedBySafetyGate = 0;

    for (const { keepItem, removeItems } of tasks) {
      for (const rem of removeItems) {
        if (rem.locked) {
          continue;
        }
        if (!this.isReferenceSnapshotCurrent(postSnapshot)) { skippedBySafetyGate++; continue; }

        let remainingRefs = [];
        if (rem.source === 'local') {
          remainingRefs = [...(remainingLocal.get(rem.displayPath) || [])];
        } else {
          remainingRefs = this.findReferencingNotesForRemoteItem(rem.rawObj, postSnapshot);
        }

        if (remainingRefs.length > 0) {
          console.warn(
            `[FileMaster Safety Gate] Blocked deletion of ${rem.displayPath}; dangling references detected in notes:`,
            remainingRefs
          );
          this.logOperation('WARN', 'DEDUP_SAFETY_GATE', `Kept ${rem.displayPath} because references remain in notes`, { remainingRefs });
          skippedBySafetyGate++;
          continue;
        }

        if (rem.source === 'local') {
          try {
            await this.app.vault.trash(rem.rawObj, true);
            deletedLocalCount++;
          } catch (err) {
            skippedBySafetyGate++;
            this.logOperation('WARN', 'DEDUP_MERGE', `Failed to trash ${rem.displayPath}`, { error: err.message });
          }
        } else {
          try {
            await this.deleteRemoteFile(rem.rawObj.year, rem.rawObj.month, rem.rawObj.filename);
            deletedRemoteCount++;
          } catch (err) {
            new Notice(this.t('noticeRemoteDeleteFailed', { name: rem.name, err: err.message }));
            this.logOperation('ERROR', 'DEDUP_MERGE', `Failed to delete remote duplicate ${rem.displayPath}`, { error: err.message });
          }
        }
      }
    }

    this.logOperation('INFO', 'DEDUP_MERGE', `Merged duplicates: updated ${modifiedDocsCount} note(s), removed ${deletedLocalCount} local & ${deletedRemoteCount} remote file(s)`, {
      modifiedDocsCount,
      deletedLocalCount,
      deletedRemoteCount,
      skippedBySafetyGate
    });

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
    const result = await this.executeBatchMigrateSafely([{ rawObj: tfile }], { deleteLocalAfter: deleteLocal });
    if (!result.count) throw new Error(result.failures[0]?.error || this.t('transferIntegrityFailed'));
    new Notice(this.t('noticeMigrateSuccess', { name: tfile.name, protected: '', docs: result.docs }));
    return result.processedItems[0].rawObj;
  }

  async resumePendingMigration() {
    if (!this.isRemoteServerReady()) { new Notice(this.t('noticeRemoteNotReady')); return; }
    const adapter = this.app.vault.adapter;
    const path = migrationCheckpointPath(this);
    if (!await adapter.exists(path)) { new Notice(this.t('transferNothingPending')); return; }
    const checkpoint = JSON.parse(await adapter.read(path));
    if (checkpoint.serverUrl !== this.getCleanServerUrl()) throw new Error(this.t('transferServerChanged'));
    const snapshot = await this.buildVaultReferenceSnapshot({ freshRead: true });
    const items = checkpoint.items.map((entry) => {
      const file = this.app.vault.getAbstractFileByPath(entry.path);
      if (!file || Array.isArray(file.children)) return null;
      return { name: file.name, displayPath: file.path, size: file.stat?.size || 0,
        rawObj: file, locked: Boolean(entry.locked), selected: true,
        refNotes: this.findReferencingNotesForLocalFile(file, snapshot) };
    }).filter(Boolean);
    if (!items.length) { new Notice(this.t('transferNothingPending')); return; }
    const modal = new BatchMigrateWizardModal(this.app, this);
    modal.options = { ...modal.options, ...checkpoint.options };
    modal.items = items;
    modal.step = 2;
    modal.open();
  }

  async downloadSingleRemoteItemToLocal(remoteMatch, options = {}) {
    const task = (signal) => this.downloadRemoteItemToLocal(remoteMatch, { ...options, signal });
    return options.deferRewrite ? task(options.signal) : runAttachmentOperation(this, task, options.signal);
  }

  async downloadRemoteItemToLocal(remoteMatch, options = {}) {
    const silent = Boolean(options?.silent);
    try {
      const { year, month, filename } = remoteMatch;
      if (!silent) {
        new Notice(this.t('noticeDownloadingFile', { name: filename }));
      }

      let remoteObj = remoteMatch.rawObj || null;
      if (!remoteObj) {
        try {
          const list = await this.fetchRemoteFileList();
          remoteObj = list.find(
            (r) => r.year === year && r.month === month && r.filename === filename
          );
        } catch { }
      }

      const activeFile = options?.activeFile || this.app.workspace.getActiveFile();
      const sourcePath = activeFile ? activeFile.path : '';
      const availablePath = remoteMatch.availablePath || await this.app.fileManager.getAvailablePathForAttachment(
        filename,
        sourcePath
      );
      const slashIdx = availablePath.lastIndexOf('/');
      const targetDir = slashIdx > -1 ? availablePath.slice(0, slashIdx) : '';
      const idealPath = remoteMatch.idealPath || (targetDir ? `${targetDir}/${filename}` : filename);

      let existingFile = remoteMatch.existingFile || null;
      if (!existingFile) {
        const byName = this.app.vault.getAbstractFileByPath(idealPath);
        if (byName && !Array.isArray(byName.children)) {
          existingFile = byName;
        }
      }
      const hasConflict = Boolean(existingFile && !Array.isArray(existingFile.children));

      const conflictStrategy = options?.conflictStrategy || 'rename';
      let targetLocalFile = null;
      let action = 'downloaded';

      if (hasConflict && conflictStrategy === 'reuse') {
        if (!remoteObj?.sha256 || await computeSha256Hex(await this.app.vault.readBinary(existingFile)) !== remoteObj.sha256) {
          throw new Error(this.t('transferIntegrityFailed'));
        }
        targetLocalFile = existingFile;
        action = 'reused';
      } else {
        const downloadUrl = remoteObj?.rawUrl
          ? `${remoteObj.rawUrl}?download=1`
          : `${remoteMatch.matchedUrl}?download=1`;

        const response = await requestWithBackoff(() => requestUrl({
          url: downloadUrl,
          method: 'GET',
          headers: { Authorization: `Bearer ${this.settings.apiToken}` },
          throw: false
        }), { signal: options.signal });

        if (response.status < 200 || response.status >= 300 || !response.arrayBuffer) {
          throw new Error(`Failed to download remote file (HTTP ${response.status})`);
        }
        if (!remoteObj?.sha256 || await computeSha256Hex(response.arrayBuffer) !== remoteObj.sha256) {
          throw new Error(this.t('transferIntegrityFailed'));
        }
        throwIfTransferCancelled(options.signal);

        if (hasConflict && conflictStrategy === 'overwrite') {
          await this.app.vault.modifyBinary(existingFile, response.arrayBuffer);
          targetLocalFile = existingFile;
          action = 'overwritten';
        } else {
          targetLocalFile = await this.app.vault.createBinary(availablePath, response.arrayBuffer);
          action = 'downloaded';
        }
      }

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
        name: targetLocalFile.name,
        ext: targetLocalFile.extension.toLowerCase(),
        displayPath: targetLocalFile.path,
        rawObj: targetLocalFile
      };

      const syncOtherNotes = options?.syncOtherNotes !== undefined ? Boolean(options.syncOtherNotes) : true;
      const pair = { removeItem, keepItem };
      const rewritten = options.deferRewrite ? null : await rewriteAttachmentPairs(this, [pair],
        !syncOtherNotes && activeFile ? [activeFile.path] : null);
      const modifiedCount = rewritten?.modified.size || 0;
      const syncedOtherNotePaths = [...(rewritten?.modified || [])].filter((path) => path !== activeFile?.path);

      if (!silent) {
        new Notice(
          this.t('noticeDownloadedToVault', {
            name: filename,
            path: targetLocalFile.path,
            docs: modifiedCount
          })
        );
      }

      if (options?.returnDetails) {
        return {
          file: targetLocalFile,
          name: targetLocalFile.name,
          originName: filename,
          displayPath: targetLocalFile.path,
          remotePath: `${year}/${month}/${filename}`,
          size: targetLocalFile.stat?.size || remoteObj?.size || 0,
          action,
          pair,
          modifiedDocs: modifiedCount,
          syncedOtherNotes: syncedOtherNotePaths.length,
          syncedOtherNotePaths
        };
      }
      return targetLocalFile;
    } catch (err) {
      if (!silent) {
        new Notice(this.t('noticeDownloadFailed', { err: err.message }));
      }
      throw err;
    }
  }

  async scanActiveNoteRemoteAttachments(activeFile) {
    const content = await this.app.vault.read(activeFile);
    const serverBase = escapeRegExp(this.getCleanServerUrl());
    const re = new RegExp(
      `(${serverBase}\\/([^/\\s)]+)\\/(protected|\\d{4})\\/(keep|\\d{2})\\/([^)\\s]+))`,
      'gi'
    );

    const matchesMap = new Map();
    let m;
    while ((m = re.exec(content)) !== null) {
      const fullUrl = m[1];
      let filename = m[5].split(/[?#]/)[0];
      try {
        filename = decodeURIComponent(filename);
      } catch { }
      const key = `${m[3]}/${m[4]}/${filename}`;
      if (!matchesMap.has(key)) {
        matchesMap.set(key, {
          matchedUrl: fullUrl,
          cleanUrl: fullUrl.split(/[?#]/)[0],
          routePrefix: m[2],
          year: m[3],
          month: m[4],
          filename
        });
      }
    }

    if (matchesMap.size === 0) {
      return [];
    }

    let remoteList = [];
    try {
      remoteList = await this.fetchRemoteFileList();
    } catch { }

    const snapshot = await this.buildVaultReferenceSnapshot();
    await this.indexRemoteReferences([...remoteList, ...matchesMap.values()], snapshot);
    const remoteByPath = new Map(remoteList.map((item) => [`${item.year}/${item.month}/${item.filename}`, item]));

    // Pre-index local attachment files by size for fast SHA-256 content duplicate checks
    const localFilesBySize = new Map();
    const localHashCache = new Map();
    const getLocalFileSha256 = async (tfile) => {
      if (!tfile || Array.isArray(tfile.children)) return null;
      if (localHashCache.has(tfile.path)) return localHashCache.get(tfile.path);
      try {
        const buf = await this.app.vault.readBinary(tfile);
        const h = await computeSha256Hex(buf);
        localHashCache.set(tfile.path, h);
        return h;
      } catch {
        return null;
      }
    };
    for (const f of this.app.vault.getFiles()) {
      if (!isAttachmentExt(f.extension)) continue;
      if (this.isLocalPathExcluded(f.path)) continue;
      const sz = f.stat?.size || 0;
      if (sz <= 0) continue;
      if (!localFilesBySize.has(sz)) localFilesBySize.set(sz, []);
      localFilesBySize.get(sz).push(f);
    }

    const out = [];
    for (const match of matchesMap.values()) {
      const { year, month, filename, matchedUrl, routePrefix } = match;
      const remoteObj = remoteByPath.get(`${year}/${month}/${filename}`);
      const availablePath = await this.app.fileManager.getAvailablePathForAttachment(
        filename,
        activeFile.path
      );
      const slashIdx = availablePath.lastIndexOf('/');
      const targetDir = slashIdx > -1 ? availablePath.slice(0, slashIdx) : '';
      const idealPath = targetDir ? `${targetDir}/${filename}` : filename;
      const existingByName = this.app.vault.getAbstractFileByPath(idealPath);
      const hasSameName = Boolean(existingByName && !Array.isArray(existingByName.children));

      let existingFile = hasSameName ? existingByName : null;
      let conflictType = null; // 'hash_and_name' | 'hash_only' | 'name_only' | null
      const remoteSha256 = remoteObj?.sha256 || null;
      const remoteSize = remoteObj?.size || 0;

      if (remoteSha256) {
        if (hasSameName) {
          const sameNameHash = await getLocalFileSha256(existingByName);
          if (sameNameHash && sameNameHash === remoteSha256) {
            conflictType = 'hash_and_name';
            existingFile = existingByName;
          }
        }
        if (!conflictType && remoteSize > 0) {
          const candidates = localFilesBySize.get(remoteSize) || [];
          // Prioritize candidates inside targetDir first
          const sortedCandidates = [...candidates].sort((a, b) => {
            const aInTarget = (a.parent?.path || '') === targetDir ? 0 : 1;
            const bInTarget = (b.parent?.path || '') === targetDir ? 0 : 1;
            return aInTarget - bInTarget;
          });
          for (const cand of sortedCandidates) {
            const candHash = await getLocalFileSha256(cand);
            if (candHash && candHash === remoteSha256) {
              conflictType = cand.path === idealPath ? 'hash_and_name' : 'hash_only';
              existingFile = cand;
              break;
            }
          }
        }
      }

      if (!conflictType && hasSameName) {
        conflictType = 'name_only';
        existingFile = existingByName;
      }

      const hasConflict = Boolean(conflictType && existingFile);
      const refNotes = this.findReferencingNotesForRemoteItem({ year, month, filename }, snapshot);
      const otherRefNotes = refNotes.filter((p) => p !== activeFile.path);

      out.push({
        id: `remote:${year}/${month}/${filename}`,
        source: 'remote',
        name: filename,
        filename,
        ext: getExt(filename),
        year,
        month,
        matchedUrl,
        routePrefix,
        displayPath: `${year}/${month}/${filename}`,
        size: remoteSize,
        sha256: remoteSha256,
        rawObj: remoteObj || {
          year,
          month,
          filename,
          rawUrl: matchedUrl,
          pubUrl: `${this.getCleanServerUrl()}/pub/${year}/${month}/${encodeURIComponent(getBaseName(filename))}.webp`
        },
        targetDir: targetDir || '/',
        idealPath,
        availablePath,
        existingFile: hasConflict ? existingFile : null,
        conflictType,
        hasConflict,
        refNotes,
        otherRefNotes,
        selected: true
      });
    }
    return out;
  }

  async executeDownloadNoteDirect(activeFile, onProgress = null, options = {}) {
    return runAttachmentOperation(this, async (signal) => {
      const items = Array.isArray(options.items) ? options.items : await this.scanActiveNoteRemoteAttachments(activeFile);
      const processedItems = [], failures = [], retryItems = [], pairs = [];
      for (let i = 0; i < items.length; i++) {
        if (signal.aborted) { retryItems.push(...items.slice(i)); break; }
        const item = items[i];
        onProgress?.(i + 1, items.length, item.filename || item.name);
        try {
          const detail = await this.downloadSingleRemoteItemToLocal(item, {
            ...options, signal, activeFile, silent: true, returnDetails: true, deferRewrite: true
          });
          pairs.push(detail.pair);
          processedItems.push({ source: 'local', name: detail.name, ext: getExt(detail.name),
            displayPath: detail.displayPath, remotePath: detail.remotePath, size: detail.size,
            action: detail.action, rawObj: detail.file });
        } catch (err) {
          retryItems.push(item);
          if (err.name === 'AbortError') { retryItems.push(...items.slice(i + 1)); break; }
          failures.push({ name: item.filename || item.name, size: item.size || 0, error: err.message || String(err) });
          this.logOperation('ERROR', 'NOTE_DOWNLOAD', `Failed to download ${item.filename || item.name}`, { error: err.message });
        }
      }
      const rewritten = pairs.length ? await rewriteAttachmentPairs(this, pairs,
        options.syncOtherNotes === false ? [activeFile.path] : null) : null;
      processedItems.forEach((item, i) => {
        item.syncedOtherNotePaths = (rewritten?.changedPaths.get(pairs[i]) || []).filter((path) => path !== activeFile.path);
        item.syncedOtherNotes = item.syncedOtherNotePaths.length;
      });
      const summary = { count: processedItems.length, processedItems, failures, retryItems,
        cancelled: Boolean(signal.aborted) };
      return options.returnDetails ? summary : summary.count;
    }, options.signal);
  }

  async downloadActiveNoteRemoteAttachments(targetFile = null, options = {}) {
    const activeFile = targetFile || this.app.workspace.getActiveFile();
    if (!activeFile || !this.isDocFile(activeFile)) {
      new Notice(this.t('noticeOpenMdFirst'));
      return;
    }
    const modal = new ActiveNoteActionModal(this.app, this, activeFile, 'download', options);
    if (options?.fromHub) {
      this.openModalSafely(modal);
    } else {
      modal.open();
    }
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
      if (this.settings.uploadNonImageAttachments === false && !IMAGE_EXTS.has(f.extension.toLowerCase())) {
        continue;
      }
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
    const summary = await runAttachmentOperation(this,
      (signal) => migrateLocalAttachments(this, selectedItems, { ...options, signal }, onProgress), options?.signal);
    onDone?.(summary);
    return summary;
  }

  async scanActiveNoteLocalAttachments(activeFile) {
    const content = await this.app.vault.read(activeFile);
    const wikiRegex = /!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g;
    const mdLinkRegex = /!?\[([^\]]*)\]\((?!https?:\/\/)([^)]+)\)/g;

    const localFilesMap = new Map();
    let m;
    while ((m = wikiRegex.exec(content)) !== null) {
      const tf = this.app.metadataCache.getFirstLinkpathDest(m[1].trim(), activeFile.path);
      if (tf && isAttachmentExt(tf.extension)) {
        localFilesMap.set(tf.path, tf);
      }
    }
    while ((m = mdLinkRegex.exec(content)) !== null) {
      let rawTarget = m[2].trim().replace(/^<|>$/g, '');
      try {
        rawTarget = decodeURIComponent(rawTarget);
      } catch { }
      const tf = this.app.metadataCache.getFirstLinkpathDest(rawTarget, activeFile.path);
      if (tf && isAttachmentExt(tf.extension)) {
        localFilesMap.set(tf.path, tf);
      }
    }

    const snapshot = await this.buildVaultReferenceSnapshot();

    return Array.from(localFilesMap.values()).map((tf) => {
      const refNotes = this.findReferencingNotesForLocalFile(tf, snapshot);
      const otherRefNotes = refNotes.filter((p) => p !== activeFile.path);
      return {
        id: `local:${tf.path}`,
        source: 'local',
        name: tf.name,
        ext: tf.extension.toLowerCase(),
        displayPath: tf.path,
        size: tf.stat?.size || 0,
        rawObj: tf,
        tfile: tf,
        refNotes,
        otherRefNotes,
        selected: true,
        locked: false
      };
    });
  }

  async executeMigrateNoteDirect(activeFile, onProgress = null, options = {}) {
    return runAttachmentOperation(this, async (signal) => {
      const items = Array.isArray(options.items) ? options.items : await this.scanActiveNoteLocalAttachments(activeFile);
      const summary = await migrateLocalAttachments(this, items, {
        ...options, signal, activeFile,
        deleteLocalAfter: options.deleteLocalAfter ?? this.settings.deleteLocalAfterMigrate,
        documentPaths: options.syncOtherNotes === false ? [activeFile.path] : null
      }, onProgress);
      return options.returnDetails ? summary : summary.count;
    }, options.signal);
  }

  async migrateActiveNoteAttachments(targetFile = null, options = {}) {
    const activeFile = targetFile || this.app.workspace.getActiveFile();
    if (!activeFile || !this.isDocFile(activeFile)) {
      new Notice(this.t('noticeOpenMdFirst'));
      return;
    }
    const modal = new ActiveNoteActionModal(this.app, this, activeFile, 'migrate', options);
    if (options?.fromHub) {
      this.openModalSafely(modal);
    } else {
      modal.open();
    }
  }

  async copyActiveNoteForAstro(targetFile = null) {
    const activeFile = targetFile || this.app.workspace.getActiveFile();
    if (!activeFile || !this.isDocFile(activeFile)) {
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
          if (page === 'logs') {
            this.plugin.openModalSafely(new OperationLogModal(this.app, this.plugin));
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
      text: sCompat ? this.plugin.getCompatibilityMessage(sCompat) : this.plugin.t('aboutServerOffline')
    });
    new Setting(containerEl)
      .setName(this.plugin.t('opLogTitle'))
      .setDesc(this.plugin.t('opLogDesc'))
      .addButton((btn) =>
        btn.setButtonText(this.plugin.t('opLogBtnOpen')).onClick(() => {
          this.plugin.openModalSafely(new OperationLogModal(this.app, this.plugin));
        })
      );
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
