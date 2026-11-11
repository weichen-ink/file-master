import { Modal } from 'obsidian';
import { modalChrome } from './navigation.js';

/** All plugin windows use native dismissal with the same navigation shell. */
export class FileMasterModal extends Modal {
  open() {
    modalChrome(this);
    return super.open();
  }
}
