import { computeSha256Hex } from '../engine.js';
import { requestUrl } from 'obsidian';
import { isDocFile, safeModifyFileContent } from './vault-utils.js';
import { getLogFilePath } from './logging.js';
import { runAttachmentOperation, throwIfTransferCancelled } from '../transfers.js';
import { galleryStore } from '../ui/gallery-store.js';

import { createUrlRewriter as createRenameRewriter } from '../url-rewrite.js';
export { createRenameRewriter };
export const renameCheckpointPath = plugin => getLogFilePath(plugin).replace(/operation\.log$/, 'rename-pending.json');
export async function requestRemoteRename(plugin, payload, preview = false) {
  const response=await requestUrl({url:`${plugin.getCleanServerUrl()}/api/modules/image-host/rename${preview?'/preview':''}`,method:'POST',headers:{Authorization:`Bearer ${plugin.settings.apiToken}`,'Content-Type':'application/json'},body:JSON.stringify(payload),throw:false});
  if(response.status<200||response.status>=300) {
    const error=new Error(response.status===404 && !response.json?.error ? plugin.t('renameServerUpgrade') : response.json?.error || `HTTP ${response.status}`);
    error.status=response.status;error.code=response.json?.code;throw error;
  }
  if (!response.json?.success || !response.json.item || !Array.isArray(response.json.linkMappings)) throw new Error(plugin.t('renameInvalidResponse'));
  return response.json;
}
export const remoteFileKey = item => `${item.year}/${item.month}/${item.filename}`;

/** One pass through the vault counts distinct referencing documents for all visible assets. */
export async function indexRenameReferences(plugin, items) {
  const markers = new Map(), mappings = [], documents = new Map(items.map(item => [remoteFileKey(item), []]));
  items.forEach((item, index) => {
    const marker = `@@file-master-reference-${index}@@`;
    markers.set(marker, remoteFileKey(item));
    const urls = new Set([item.rawUrl, item.pubUrl, ...(item.referenceUrls || [])]);
    for (const from of urls) if (from) mappings.push({from, to:marker});
  });
  let seen = new Set();
  const rewrite = createRenameRewriter(mappings, plugin.getCleanServerUrl(), marker => seen.add(markers.get(marker)));
  let checked = 0;
  for (const file of plugin.app.vault.getFiles().filter(file => isDocFile(plugin.app, file))) {
    seen = new Set();
    try { rewrite(await plugin.app.vault.read(file)); }
    catch (error) { throw new Error(`${file.path}: ${error.message || error}`); }
    for (const key of seen) documents.get(key).push(file.path);
    if (++checked % 20 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  return documents;
}
export async function scanRenameReferences(plugin, mappings, { tolerant = false } = {}) {
  const rewrite=createRenameRewriter(mappings,plugin.getCleanServerUrl()),documents=[],failures=[];
  for(const file of plugin.app.vault.getFiles().filter(file=>isDocFile(plugin.app,file))) {
    try {
      const current=await plugin.app.vault.read(file),result=rewrite(current);
      if(result.count)documents.push({path:file.path,references:result.count});
    } catch (error) {
      if (!tolerant) throw new Error(`${file.path}: ${error.message || error}`);
      failures.push({path:file.path,error:error.message || String(error)});
    }
  }
  return {documents,failures,references:documents.reduce((sum,doc)=>sum+(doc.references||0),0)};
}
export async function loadPendingRename(plugin) {
  const adapter=plugin.app.vault.adapter,path=renameCheckpointPath(plugin);
  if(!await adapter.exists(path))return null;
  const job=JSON.parse(await adapter.read(path));
  if(job.version!==1||!job.request||!job.operationId||!job.serverUrl||!job.documents||typeof job.documents!=='object'||Array.isArray(job.documents)||(job.result&&!Array.isArray(job.result.linkMappings)))throw new Error(plugin.t('renameInvalidCheckpoint'));
  return job;
}
const saveJob=(plugin,job)=>plugin.app.vault.adapter.write(renameCheckpointPath(plugin),JSON.stringify(job));
export async function executeRemoteRename(plugin, request, onProgress = null, pending = null) {
  return runAttachmentOperation(plugin,async signal=>{
    const job=pending || {version:1,serverUrl:plugin.getCleanServerUrl(),operationId:`rename-${Date.now()}-${Math.random().toString(36).slice(2,14)}`,request,documents:{},result:null};
    if(job.serverUrl!==plugin.getCleanServerUrl())throw new Error(plugin.t('renameServerMismatch'));
    const existing=await loadPendingRename(plugin);
    if(existing&&existing.operationId!==job.operationId)throw new Error(plugin.t('renamePendingFirst'));
    job.request={...job.request,operationId:job.operationId};
    await saveJob(plugin,job); // Persist before the request, including when its response is lost.
    throwIfTransferCancelled(signal);
    if(!job.result) {
      try {job.result=await requestRemoteRename(plugin,job.request);}
      catch(error) {
        if(error.status&&error.status>=400&&error.status<500&&error.status!==408&&error.status!==429)await plugin.app.vault.adapter.remove(renameCheckpointPath(plugin));
        throw error;
      }
      await saveJob(plugin,job);
      galleryStore(plugin).load(true);
    }
    const rewrite=createRenameRewriter(job.result.linkMappings,plugin.getCleanServerUrl());
    const files=plugin.app.vault.getFiles().filter(file=>isDocFile(plugin.app,file));
    const currentPaths = new Set(files.map(file => file.path));
    for (const [path, doc] of Object.entries(job.documents)) { if (doc.status === 'failed' && !currentPaths.has(path)) delete job.documents[path]; }
    const textHash = text => computeSha256Hex(new TextEncoder().encode(text));
    for (let index = 0; index < files.length; index++) {
      throwIfTransferCancelled(signal);
      const file = files[index];
      let previous = job.documents[file.path];
      try {
        const current = await plugin.app.vault.read(file);
        // Recover the small window between a successful note edit and its progress write.
        if (previous?.status === 'updating') {
          const confirmed = await textHash(current) === previous.afterHash;
          previous = job.documents[file.path] = {
            references: (previous.references || 0) + (confirmed ? previous.pendingReferences : 0),
            uncertain: previous.uncertain || !confirmed,
            status: 'updated'
          };
          await saveJob(plugin, job);
        }
        const planned = rewrite(current);
        if (!planned.count) {
          if (previous?.status === 'failed') {
            if (previous.references || previous.uncertain) job.documents[file.path] = { ...previous, status: 'updated', error: undefined };
            else delete job.documents[file.path];
            await saveJob(plugin, job);
          }
        } else {
          job.documents[file.path] = { ...previous, status: 'updating', pendingReferences: planned.count, afterHash: await textHash(planned.text) };
          await saveJob(plugin, job);
          let count = 0;
          const changed = await safeModifyFileContent(plugin, file, latest => {
            const result = rewrite(latest); count = result.count; return result.text;
          });
          job.documents[file.path] = { references: (previous?.references || 0) + (changed ? count : 0), uncertain: previous?.uncertain || false, status: 'updated' };
          await saveJob(plugin, job);
        }
      } catch (error) {
        job.documents[file.path] = { ...previous, status: 'failed', error: error.message || String(error) };
        await saveJob(plugin, job);
      }
      onProgress?.({completed:index+1,total:files.length,path:file.path});
      if (index % 20 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
    // Read again: concurrent edits can introduce references after an earlier document was processed.
    const remaining=await scanRenameReferences(plugin,job.result.linkMappings,{tolerant:true});
    for (const failure of remaining.failures) job.documents[failure.path] = {...job.documents[failure.path],status:'failed',error:failure.error};
    await saveJob(plugin,job);
    const failures=Object.entries(job.documents).filter(([,doc])=>doc.status==='failed').map(([path,doc])=>({path,error:doc.error}));
    const updated=Object.entries(job.documents).filter(([,doc])=>doc.references || doc.uncertain);
    const countsUncertain = updated.some(([,doc]) => doc.uncertain);
    const report={item:job.result.item,oldFilename:job.request.filename,countsUncertain,updatedDocuments:updated.length,updatedReferences:updated.reduce((sum,[,doc])=>sum+(doc.references||0),0),documents:updated.map(([path,doc])=>({path,references:doc.references||0})),failures,remaining:remaining.documents,complete:!failures.length&&!remaining.references,job};
    if(report.complete)await plugin.app.vault.adapter.remove(renameCheckpointPath(plugin));
    plugin.logOperation(report.complete?'INFO':'WARN','REMOTE_RENAME',`${job.request.filename} → ${job.result.item.filename}`,{updatedDocuments:report.updatedDocuments,updatedReferences:report.updatedReferences,failures,remaining:remaining.documents});
    return report;
  });
}
