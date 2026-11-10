// Minimal Obsidian DOM adapter; tests exercise product handlers against this tree.
class Element {
  constructor(tag = 'div', options = {}) {
    this.tag = tag;
    Object.assign(this, options);
    this.children = [];
    this.style = {};
    this.dataset = {};
  }
  createEl(tag, options) { const child = new Element(tag, options); this.children.push(child); return child; }
  createDiv(options) { return this.createEl('div', options); }
  createSpan(options) { return this.createEl('span', options); }
  addClass() {}
  removeClass() {}
  empty() { this.children = []; }
  setText(text) { this.text = text; }
  setAttribute(name, value) { this[name] = value; }
  prepend() {}
  remove() {}
  all() { return [this, ...this.children.flatMap((child) => child.all())]; }
}
class Setting {
  constructor(parent) {
    this.settingEl = parent.createDiv();
    this.nameEl = this.settingEl.createSpan();
    this.descEl = this.settingEl.createSpan();
    this.controlEl = this.settingEl.createDiv();
  }
  setName(name) { this.settingEl.name = name; return this; }
}
module.exports = { Element, Setting };
