import { Notice, setIcon } from 'obsidian';

const modalHeaders = new WeakMap();

/** One plugin-owned navigation row; native host dismissal remains available via Escape. */
export function modalChrome(modal) {
  const root = modal.modalEl;
  if (!root) return null;
  let chrome = modalHeaders.get(root);
  if (!chrome) {
    root.addClass('fm-ui', 'fm-has-chrome');
    // Obsidian 1.15 renamed the native control; older hosts use modal-close-button.
    const nativeClose = root.querySelector('.modal-header-button, .modal-close-button, .modal-close');
    if (nativeClose) { nativeClose.hidden = true; nativeClose.style.display = 'none'; }
    const nativeHeader = root.querySelector('.modal-header');
    if (nativeHeader && !nativeHeader.textContent?.trim()) nativeHeader.style.display = 'none';
    const bar = root.createDiv({cls:'fm-modal-nav'});
    const close = bar.createEl('button', {attr:{type:'button'}});
    close.addClass('fm-modal-close');
    const closeLabel = modal.plugin?.t('closeBtn') || 'Close';
    close.setAttribute('aria-label', closeLabel);
    close.onclick = event => { event.preventDefault(); event.stopPropagation(); modal.close(); };
    setIcon(close, 'x');
    const title = bar.createDiv({cls:'fm-modal-title',attr:{tabindex:'-1'}});
    bar.appendChild(close);
    root.prepend(bar);
    chrome = {bar, title, close};
    modalHeaders.set(root, chrome);
  }
  return chrome;
}

// Wait for the initiating event to finish without locking close() or using timed guards.
export const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
export async function openModal(modal) {
  if (!modal) return;
  await nextFrame();
  modalChrome(modal);
  modal.open();
  return modal;
}

/** Hub children render inside the existing Obsidian modal; no second backdrop can catch the opening tap. */
export class HubNavigator {
  constructor(host, home) {
    this.host = host;
    this.home = home;
    this.chrome = modalChrome(host);
    this.baseClass = host.modalEl.className;
    this.active = true;
    this.busy = false;
    this.child = null;
  }
  async show(child) {
    if (!this.active || this.busy || this.child) return;
    this.busy = true;
    this.home.hidden = true;
    const panel = this.host.contentEl.createDiv({cls:'fm-hub-page'});
    child.contentEl = panel;
    child.modalEl = this.host.modalEl;
    child.fromHub = true;
    child.hubAction = this.host.currentAction;
    child.returnToHub = () => this.back();
    // An explicitly hosted child closes its host; normal Modal.close is never globally suppressed.
    child.close = () => this.host.close();
    this.child = child;
    this.host.modalEl.removeClass('fm-hub-dialog');
    this.host.modalEl.addClass('fm-hub-child');
    this.chrome.title.empty();
    child.headingEl = this.chrome.title;
    child.detachedFromHub = false;
    child.contentEl = panel.createDiv({cls:'fm-module-body'});
    try {
      await child.onOpen();
      if (this.active && this.child === child) this.chrome.title.focus();
    } catch (error) {
      if (this.active && this.child === child) {
        this.back();
        new Notice(error.message || String(error));
      }
    } finally { this.busy = false; }
  }
  cleanupChild() {
    const child = this.child;
    this.child = null;
    if (!child) return;
    child.detachedFromHub = true;
    child.headingEl = null;
    try { child.onClose?.(); } finally {
      // Async renderers retain only this detached subtree after navigation.
      child.contentEl.parentElement?.remove();
      this.host.modalEl.className = this.baseClass;
      this.chrome.title.empty();
      if (this.host.homeHeading) this.chrome.title.appendChild(this.host.homeHeading);
    }
  }
  back() {
    if (!this.active) return;
    this.cleanupChild();
    this.busy = false;
    this.home.hidden = false;
    this.host.lastAction?.focus();
  }
  async leave(action, prepare = async () => {}) {
    if (!this.active || this.busy) return;
    this.busy = true;
    let closed = false;
    try {
      const ready = await prepare();
      if (!this.active) return;
      this.host.close();
      closed = true;
      await nextFrame();
      await action(ready);
    } catch (error) {
      if (closed) this.host.open();
      new Notice(error.message || String(error));
    } finally { this.busy = false; }
  }
  dispose() {
    this.active = false;
    this.cleanupChild();
  }
}

/** Plain dialog titles share the same heading row as functional modules. */
export function modalTitle(modal, text) {
  const target=modalChrome(modal).title;
  target.empty();
  return target.createEl('h3',{text,cls:'fm-module-heading-title'});
}

/** Module headings reuse the action name and icon, with progress after the title. */
export function moduleHeading(modal, target, {title, symbol, step, total} = {}) {
  const heading = modal.detachedFromHub ? target : modal.headingEl || modalChrome(modal)?.title || target;
  if (heading !== target) heading.empty();
  const row=heading.createDiv({cls:'fm-module-heading'});
  setIcon(row.createSpan({cls:'fm-module-heading-icon'}),modal.hubAction?.icon || symbol || 'files');
  row.createEl('h3',{text:modal.hubAction?.title || modal.plugin.t(title),cls:'fm-module-heading-title'});
  if(step && total)row.createSpan({text:`${step}/${total}`,cls:'fm-module-heading-step',attr:{'aria-label':modal.plugin.t('stepOf',{current:step,total})}});
  return row;
}
