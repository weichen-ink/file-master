import { getEffectiveLanguage as helperGetEffectiveLanguage, translateUi } from '../i18n.js';

// The plugin owns host state; these operations receive it explicitly.
export function getEffectiveLanguage(settings) {
  return helperGetEffectiveLanguage(settings?.language);
}

export function t(plugin, key, params = {}) {
  return translateUi(getEffectiveLanguage(plugin.settings), key, params);
}

export function isRemoteServerReady(settings) {
  return Boolean(settings?.enableRemoteServer && settings?.serverVerified);
}

export function getLogFilePath(plugin) {
  const dir = plugin.manifest?.dir || `${plugin.app?.vault?.configDir || '.obsidian'}/plugins/${plugin.manifest?.id || 'file-master'}`;
  return `${dir}/operation.log`;
}

export async function loadOperationLogs(plugin) {
  if (!Array.isArray(plugin.operationLogs)) {
    plugin.operationLogs = [];
  }
  try {
    const adapter = plugin.app?.vault?.adapter;
    const logPath = getLogFilePath(plugin);
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
      plugin.operationLogs = parsed.slice(-500);
    }
  } catch { }
  return plugin.operationLogs;
}

export async function saveOperationLogs(plugin) {
  const previous = plugin._logWriteQueue || Promise.resolve();
  const next = previous.then(async () => {
    try {
      const adapter = plugin.app?.vault?.adapter;
      if (!adapter) return;
      const logPath = getLogFilePath(plugin);
      const lines = (plugin.operationLogs || []).slice(-500).map((entry) => JSON.stringify(entry));
      await adapter.write(logPath, lines.join('\n') + (lines.length ? '\n' : ''));
    } catch { }
  });
  plugin._logWriteQueue = next.catch(() => {});
  return next;
}

export function logOperation(plugin, level, action, summary, details = null) {
  if (!Array.isArray(plugin.operationLogs)) {
    plugin.operationLogs = [];
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
  plugin.operationLogs.push(entry);
  if (plugin.operationLogs.length > 500) {
    plugin.operationLogs = plugin.operationLogs.slice(-500);
  }
  saveOperationLogs(plugin);
}

export async function clearOperationLogs(plugin) {
  plugin.operationLogs = [];
  await saveOperationLogs(plugin);
}

export function formatLogsForExport(plugin) {
  const version = plugin.manifest?.version || '1.0.2';
  const serverStatus = plugin.lastServerCompatStatus
    ? `${plugin.lastServerCompatStatus.status} (server v${plugin.lastServerCompatStatus.serverVersion || '?'})`
    : (plugin.settings?.enableRemoteServer ? 'unverified' : 'disabled');
  const header = [
    `# File Master Diagnostic & Operation Logs`,
    `# Plugin Version: v${version}`,
    `# Exported At: ${new Date().toISOString()}`,
    `# Server Status: ${serverStatus}`,
    `# Excluded Local Folders: ${plugin.settings?.excludedLocalFolders || '(none)'}`,
    `# Total Entries: ${(plugin.operationLogs || []).length}`,
    `------------------------------------------------------------`
  ];
  const body = (plugin.operationLogs || []).map((e) => {
    const detailStr = e.details ? ` | ${JSON.stringify(e.details)}` : '';
    return `[${e.ts}] [${e.level}] [${e.action}] ${e.summary}${detailStr}`;
  });
  return [...header, ...body].join('\n');
}
