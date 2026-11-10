class FileMasterServerClient extends FileMasterContextMenus {
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
}
