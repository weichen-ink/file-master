class FileMasterLogging extends Plugin {
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
}
