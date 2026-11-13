import { isDocFile } from './vault-utils.js';

// Events supplement timestamps: an edit can preserve both size and mtime.
function changes(plugin) {
  return plugin.renameReferenceChanges ||= {session:`${Date.now()}-${Math.random()}`, revision:0, paths:new Map()};
}
export function trackRenameReferenceChange(plugin, file, oldPath) {
  const state=changes(plugin),revision=++state.revision;
  if (file?.path) state.paths.set(file.path,revision);
  if (oldPath) state.paths.set(oldPath,revision);
}
export function referenceInventory(plugin) {
  const state=changes(plugin);
  return {session:state.session, files:Object.fromEntries(plugin.app.vault.getFiles()
    .filter(file=>isDocFile(plugin.app,file))
    .map(file=>[file.path,{mtime:file.stat?.mtime,size:file.stat?.size,revision:state.paths.get(file.path)||0}]))};
}
export function changedReferencePaths(plugin, previous, current=referenceInventory(plugin)) {
  return Object.keys(current.files).filter(path=>{
    const before=previous?.files?.[path],after=current.files[path];
    return previous?.session!==current.session || !before || after.mtime===undefined || after.size===undefined
      || before.mtime!==after.mtime || before.size!==after.size || before.revision!==after.revision;
  });
}
export function referencePlanMatches(plugin, plan, mappings) {
  return plan?.inventory?.session===changes(plugin).session && JSON.stringify(plan.mappings)===JSON.stringify(mappings);
}
