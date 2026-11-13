import { IMAGE_EXTS } from '../constants.js';
import { getExt } from '../engine.js';
import { Notice } from 'obsidian';

export function hasOptimizedVariant(item) {
  if (!item?.pubUrl || item.optimizationEnabled === false || item.isProcessableImage === false) return false;
  return item.isProcessableImage === true || IMAGE_EXTS.has(getExt(item.filename || item.name || ''));
}
export function assetUrl(item, mode = 'raw') {
  return mode === 'webp' && hasOptimizedVariant(item) ? item.pubUrl : item.rawUrl || item.pubUrl;
}
export function assetMarkdown(name, url) {
  const label = String(name).replace(/[\[\]\\]/g, ch => '\\' + ch);
  // Keep URLs intact while escaping characters that would end a Markdown destination.
  const destination = String(url).replace(/ /g,'%20').replace(/\(/g,'%28').replace(/\)/g,'%29');
  return IMAGE_EXTS.has(getExt(name)) ? `![${label}](${destination})` : `[${label}](${destination})`;
}
export async function copyText(plugin, value, successKey = 'galleryCopied', params = {}) {
  try { await navigator.clipboard.writeText(value); new Notice(plugin.t(successKey, params)); return true; }
  catch { new Notice(plugin.t('copyFailed')); return false; }
}
