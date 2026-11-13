import { DEFAULT_SERVER_URL, IMAGE_EXTS, MIN_SERVER_VERSION, isAttachmentExt } from '../constants.js';
import { applyNamingPattern, buildMultipartBuffer, compareSemver, computeSha256Hex, getBaseName, getExt, sanitizeCleanBaseName } from '../engine.js';
import { IncomingFileModal } from '../modals/incoming-file.js';
import { requestWithBackoff, throwIfTransferCancelled } from '../transfers.js';
import { requestUrl } from 'obsidian';

// The plugin owns host state; these operations receive it explicitly.
export function filterAllowedFiles(settings, fileList) {
  const out = [];
  for (let i = 0; i < fileList.length; i++) {
    const f = fileList[i];
    const ext = getExt(f.name) || (f.type.startsWith('image/') ? 'png' : '');
    if (IMAGE_EXTS.has(ext)) {
      out.push(f);
    } else if (settings.uploadNonImageAttachments && isAttachmentExt(ext)) {
      out.push(f);
    }
  }
  return out;
}

export function getCleanServerUrl(settings) {
  const raw = String(settings.serverUrl || DEFAULT_SERVER_URL).trim().replace(/\/+$/, '');
  if (!raw) return DEFAULT_SERVER_URL;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }
    return raw;
  } catch {
    return raw;
  }
}

export async function handleIncomingBrowserFile(plugin, file, editor, options = {}) {
  let insertionRange = options?.insertionRange || null;
  if (!insertionRange && editor) {
    const from = editor.getCursor?.('from');
    const to = editor.getCursor?.('to') || from;
    if (from && typeof from.line === 'number' && typeof from.ch === 'number') {
      insertionRange = { from: { ...from }, to: { ...to } };
    }
  }
  const arrayBuffer = await file.arrayBuffer();
  const ext = getExt(file.name) || (file.type.startsWith('image/') ? 'png' : 'bin');
  const rawOriginBase = sanitizeCleanBaseName(getBaseName(file.name), 'Pasted_image');
  const sha256 = await computeSha256Hex(arrayBuffer);
  const activeFile = plugin.app.workspace.getActiveFile();
  const noteName = activeFile ? activeFile.basename : 'note';

  let defaultBaseName = rawOriginBase;
  if (plugin.settings.namingMode === 'rule') {
    defaultBaseName = applyNamingPattern(plugin.settings.namingPattern, {
      noteName,
      originBase: rawOriginBase,
      sha256
    });
  } else if (/^image$/i.test(rawOriginBase)) {
    defaultBaseName = `Pasted_${applyNamingPattern('{date}_{time}', { noteName, originBase: rawOriginBase, sha256 })}`;
  }

  const askLocation = plugin.settings.saveLocationMode === 'ask';

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
    fixedLocation: plugin.settings.saveLocationMode,
    plugin: plugin,
    editor,
    activeFile,
    insertionRange
  };

  new IncomingFileModal(plugin.app, fileInfo, modalOptions).open();
}

export async function probeRemoteSha256(plugin, sha256) {
  try {
    const serverUrl = plugin.getCleanServerUrl();
    if (!serverUrl || !plugin.settings.apiToken || !sha256) return null;
    const response = await requestUrl({
      url: `${serverUrl}/api/image/probe?sha256=${encodeURIComponent(sha256)}`,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${plugin.settings.apiToken}`
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

export async function uploadBufferToServer(plugin,
  arrayBuffer,
  filename,
  mimeType = 'application/octet-stream',
  options = {}
) {
  const opts = options || {};
  throwIfTransferCancelled(opts.signal);
  const fullSha256 = await computeSha256Hex(arrayBuffer);
  // 1. Instant Upload Probe via local SHA-256 calculation (0 network payload)
  if (!opts.skipProbe) {
    try {
      const probed = await plugin.probeRemoteSha256(fullSha256);
      if (probed && probed.exists && probed.sha256 === fullSha256) {
        probed.isInstant = true;
        return probed;
      }
    } catch { }
  }

  // 2. Standard multipart streaming upload
  const url = `${plugin.getCleanServerUrl()}/api/image/upload`;
  const { boundary, arrayBuffer: bodyBuffer } = buildMultipartBuffer(arrayBuffer, filename, mimeType);

  const headers = {
    Authorization: `Bearer ${plugin.settings.apiToken}`,
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
  if (!result.sha256 || result.sha256 !== fullSha256) throw new Error(plugin.t('transferIntegrityFailed'));
  return result;
}

export async function toggleRemoteFileLock(plugin, year, month, filename, locked = true) {
  const url = `${plugin.getCleanServerUrl()}/api/modules/image-host/lock`;
  const response = await requestUrl({
    url,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${plugin.settings.apiToken}`,
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

export async function checkServerCompatibility(plugin) {
  if (!plugin.settings?.enableRemoteServer) {
    plugin.lastServerCompatStatus = null;
    if (plugin.settings) {
      plugin.settings.serverVerified = false;
      await plugin.saveSettings();
    }
    return null;
  }
  const pluginVer = plugin.manifest?.version || '0.1.1';
  const serverUrl = plugin.getCleanServerUrl();
  if (!serverUrl) {
    plugin.lastServerCompatStatus = {
      ok: false,
      status: 'offline',
      error: 'No URL configured',
      serverVersion: null
    };
    plugin.settings.serverVerified = false;
    await plugin.saveSettings();
    return plugin.lastServerCompatStatus;
  }

  try {
    const verUrl = `${serverUrl}/api/platform/version`;
    const verRes = await requestUrl({
      url: verUrl,
      method: 'GET',
      throw: false
    });

    if (verRes.status !== 200) {
      plugin.lastServerCompatStatus = {
        ok: false,
        status: 'offline',
        serverVersion: null,
        error: `HTTP ${verRes.status}`
      };
      plugin.settings.serverVerified = false;
      await plugin.saveSettings();
      return plugin.lastServerCompatStatus;
    }

    const verData = verRes.json || {};
    const serverVer = verData.version || '0.1.0';
    const minPluginReq = verData.minPluginVersion || '0.1.0';

    // 1. Check if plugin is too old for server
    if (compareSemver(pluginVer, minPluginReq) < 0) {
      plugin.lastServerCompatStatus = {
        ok: false,
        status: 'plugin_outdated',
        serverVersion: serverVer,
        pluginVersion: pluginVer,
        minPluginVersion: minPluginReq,
        features: verData.features || {}
      };
      plugin.settings.serverVerified = false;
      await plugin.saveSettings();
      return plugin.lastServerCompatStatus;
    }

    // 2. Check if server is too old for plugin
    if (compareSemver(serverVer, MIN_SERVER_VERSION) < 0) {
      plugin.lastServerCompatStatus = {
        ok: false,
        status: 'server_outdated',
        serverVersion: serverVer,
        pluginVersion: pluginVer,
        minServerVersion: MIN_SERVER_VERSION,
        features: verData.features || {}
      };
      plugin.settings.serverVerified = false;
      await plugin.saveSettings();
      return plugin.lastServerCompatStatus;
    }

    // 3. Test API Auth token against image-host list
    let assetCount = 0;
    const token = (plugin.settings.apiToken || '').trim();
    if (!token) {
      plugin.lastServerCompatStatus = {
        ok: false,
        status: 'token_missing',
        serverVersion: serverVer,
        pluginVersion: pluginVer,
        features: verData.features || {}
      };
      plugin.settings.serverVerified = false;
      await plugin.saveSettings();
      return plugin.lastServerCompatStatus;
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
      plugin.lastServerCompatStatus = {
        ok: false,
        status: 'offline',
        serverVersion: serverVer,
        pluginVersion: pluginVer,
        error: netErr.message || String(netErr)
      };
      plugin.settings.serverVerified = false;
      await plugin.saveSettings();
      return plugin.lastServerCompatStatus;
    }

    if (listRes.status === 401 || listRes.status === 403) {
      plugin.lastServerCompatStatus = {
        ok: false,
        status: 'auth_failed',
        serverVersion: serverVer,
        pluginVersion: pluginVer,
        features: verData.features || {}
      };
      plugin.settings.serverVerified = false;
      await plugin.saveSettings();
      return plugin.lastServerCompatStatus;
    }

    if (listRes.status !== 200) {
      plugin.lastServerCompatStatus = {
        ok: false,
        status: 'server_error',
        statusCode: listRes.status,
        serverVersion: serverVer,
        pluginVersion: pluginVer,
        features: verData.features || {}
      };
      plugin.settings.serverVerified = false;
      await plugin.saveSettings();
      return plugin.lastServerCompatStatus;
    }

    assetCount = (listRes.json?.images || []).length;

    plugin.lastServerCompatStatus = {
      ok: true,
      status: 'compatible',
      serverVersion: serverVer,
      pluginVersion: pluginVer,
      apiVersion: verData.apiVersion || 1,
      assetCount,
      features: verData.features || {}
    };
    plugin.settings.serverVerified = true;
    await plugin.saveSettings();
    return plugin.lastServerCompatStatus;
  } catch (err) {
    plugin.lastServerCompatStatus = {
      ok: false,
      status: 'offline',
      serverVersion: null,
      error: err.message || 'Network error'
    };
    plugin.settings.serverVerified = false;
    await plugin.saveSettings();
    return plugin.lastServerCompatStatus;
  }
}

export async function fetchServerVersion(plugin) {
  try {
    const url = `${plugin.getCleanServerUrl()}/api/platform/version`;
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

export async function fetchRemoteFileList(plugin, options = {}) {
  const params = new URLSearchParams();
  if (options && typeof options === 'object') {
    if (options.q !== undefined && String(options.q).trim()) {
      params.set('q', String(options.q).trim());
    }
    if (Number.isFinite(options.limit) && options.limit > 0) {
      params.set('limit', String(options.limit));
    }
    if (Number.isFinite(options.offset) && options.offset >= 0) {
      params.set('offset', String(options.offset));
    }
  }
  const qs = params.toString();
  const url = `${plugin.getCleanServerUrl()}/api/modules/image-host/list${qs ? `?${qs}` : ''}`;
  const response = await requestUrl({
    url,
    method: 'GET',
    headers: { Authorization: `Bearer ${plugin.settings.apiToken}` },
    throw: false
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(response.json?.error || `Unable to fetch remote asset list (HTTP ${response.status})`);
  }
  const list = (response.json.images || []).map(item => ({...item, optimizationEnabled:response.json.optimizationEnabled !== false}));
  if (typeof response.json?.totalCount === 'number') {
    Object.defineProperty(list, 'totalCount', { value: response.json.totalCount, enumerable: false });
  }
  return list;
}

export async function deleteRemoteFile(plugin, year, month, filename, expectedSha256) {
  const url = `${plugin.getCleanServerUrl()}/api/modules/image-host/item/${encodeURIComponent(year)}/${encodeURIComponent(month)}/${encodeURIComponent(filename)}`;
  const response = await requestUrl({
    url,
    method: 'DELETE',
    headers: { Authorization: `Bearer ${plugin.settings.apiToken}`, ...(expectedSha256 ? {'If-Match': `"${expectedSha256}"`} : {}) },
    throw: false
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(response.json?.error || `Failed to delete remote file (HTTP ${response.status})`);
  }
  return true;
}

export async function fetchRemoteTrash(plugin) {
  const response=await requestUrl({url:`${plugin.getCleanServerUrl()}/api/modules/image-host/trash`,method:'GET',headers:{Authorization:`Bearer ${plugin.settings.apiToken}`},throw:false});
  if(response.status<200||response.status>=300)throw new Error(response.json?.error || `HTTP ${response.status}`);
  return response.json.items || [];
}
export async function restoreRemoteTrash(plugin,id) {
  const response=await requestUrl({url:`${plugin.getCleanServerUrl()}/api/modules/image-host/trash/${encodeURIComponent(id)}/restore`,method:'POST',headers:{Authorization:`Bearer ${plugin.settings.apiToken}`},throw:false});
  if(response.status<200||response.status>=300)throw new Error(response.json?.error || `HTTP ${response.status}`);
  return response.json;
}

export async function permanentlyDeleteRemoteTrash(plugin, id) {
  const response = await requestUrl({
    url: `${plugin.getCleanServerUrl()}/api/modules/image-host/trash/${encodeURIComponent(id)}`,
    method: 'DELETE',
    headers: {Authorization: `Bearer ${plugin.settings.apiToken}`},
    throw: false
  });
  if (response.status < 200 || response.status >= 300) throw new Error(response.json?.error || `HTTP ${response.status}`);
  return response.json;
}
