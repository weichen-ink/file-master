import { setIcon } from 'obsidian';

/** Identical count, icon and state treatment throughout Hub. */
export function referenceIndicator(element, plugin, count, {state = 'referenceCount', icon = count > 0 ? 'link' : null} = {}) {
  element.empty();
  if (icon) setIcon(element.createSpan({cls:'fm-indicator-icon',attr:{'aria-hidden':'true'}}), icon);
  element.createSpan({text:plugin.t(state,{count})});
  return element;
}
