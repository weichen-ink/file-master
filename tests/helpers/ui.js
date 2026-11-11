// Minimal Obsidian DOM adapter; tests exercise product handlers against this tree.
class Element {
  constructor(tag = 'div', options = {}) {
    this.tag = tag;
    Object.assign(this, options);
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.className=options.cls || "";this.isConnected=true;this.events=new Map();
    for(const [name,value] of Object.entries(options.attr||{}))this.setAttribute(name,value);
  }
  createEl(tag, options) { const child = new Element(tag, options); child.parentElement=this;this.children.push(child); return child; }
  createDiv(options) { return this.createEl('div', options); }
  createSpan(options) { return this.createEl('span', options); }
  addClass(...names) { this.className+=' '+names.join(' '); }
  removeClass(name) {this.className=this.className.split(' ').filter(c=>c!==name).join(' ');}
  toggleClass(name,enabled){if(enabled)this.addClass(name);else this.removeClass(name);}
  focus(){this.focused=true;}
  select(){this.selected=true;}
  addEventListener(name,fn,options={}){if(!this.events.has(name))this.events.set(name,new Set());this.events.get(name).add(fn);options.signal?.addEventListener('abort',()=>this.events.get(name).delete(fn),{once:true});}
  dispatch(name,event={}){event.type=name;this.events.get(name)?.forEach(fn=>fn(event));}
  querySelectorAll(selector){return this.all().filter(el=>selector==='[data-insert-action]'&&el['data-insert-action']);}
  empty() { this.children.forEach(child=>{child.parentElement=null;child.isConnected=false;});this.children = []; }
  setText(text) { this.text = text; }
  setAttribute(name, value) { this[name] = value; }
  appendChild(child) { child.remove();child.parentElement=this;child.isConnected=true;this.children.push(child);return child; }
  prepend(child) { child.remove();child.parentElement=this;child.isConnected=true;this.children.unshift(child); }
  querySelector(selector) { return this.all().find(el=>selector.split(',').some(part=>el.className.split(' ').includes(part.trim().slice(1)))); }
  remove() { if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.parentElement=null;this.isConnected=false;}
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
