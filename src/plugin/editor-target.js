import { MarkdownView } from 'obsidian';

export function captureInsertionTarget(plugin) {
  const workspace=plugin.app.workspace;
  let view=workspace.getActiveViewOfType(MarkdownView);
  const leaves=workspace.getLeavesOfType('markdown');
  if(!view&&leaves.some(leaf=>leaf.view===plugin.lastActiveMarkdownView))view=plugin.lastActiveMarkdownView;
  if(!view?.file||view.file.extension!=='md')return null;
  return {view,file:view.file,from:view.editor?.getCursor?.('from'),to:view.editor?.getCursor?.('to'),content:view.editor?.getValue?.()};
}
export function isInsertionTargetValid(plugin,target) {
  return Boolean(target && plugin.app.workspace.getLeavesOfType('markdown').some(leaf=>leaf.view===target.view) && target.view.file===target.file && plugin.app.vault.getAbstractFileByPath(target.file.path)===target.file);
}
export function refreshInsertionTarget(target) {
  target.from=target.view.editor?.getCursor?.('from');target.to=target.view.editor?.getCursor?.('to');target.content=target.view.editor?.getValue?.();
}
