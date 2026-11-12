import { setIcon } from 'obsidian';

export function toggleGalleryValues(selected, values, checked) {
  const next = new Set(selected);
  for (const value of values) checked ? next.add(value) : next.delete(value);
  return [...next].sort();
}

export function galleryPopover(parent, { t, labelKey }) {
  const root = parent.createEl('details', { cls: 'fm-gallery-filter' });
  const trigger = root.createEl('summary', { cls: 'fm-filter-trigger', attr: { 'aria-label': t(labelKey) } });
  const text = trigger.createSpan();
  setIcon(trigger.createSpan({ cls: 'fm-filter-chevron' }), 'chevron-down');
  const panel = root.createDiv({ cls: 'fm-filter-panel', attr: { role: 'group', 'aria-label': t(labelKey) } });
  const header = panel.createDiv({ cls: 'fm-filter-heading' });
  header.createSpan({ text: t(labelKey) });
  const body = panel.createDiv({ cls: 'fm-filter-options' });
  return { root, trigger, text, header, body };
}

/** Shared multi-select shell. Real checkboxes retain keyboard and screen-reader behavior. */
export function galleryFilter(parent, { t, labelKey, allKey, summaryKey, selected, change, tree = false }) {
  const { root, trigger, text, header, body } = galleryPopover(parent, { t, labelKey });
  const clear = header.createEl('button', { text: t('galleryClearFilters'), attr: { type: 'button' } });
  clear.onclick = () => change([]);
  let signature = '', inputs = [], options = [];

  const checkbox = (parent, title, values) => {
    const label = parent.createEl('label', { cls: 'fm-filter-option' });
    const input = label.createEl('input', { type: 'checkbox', cls: 'fm-filter-checkbox', attr: { 'aria-label': title } });
    const mark = label.createSpan({ cls: 'fm-filter-check-mark', attr: { 'aria-hidden': 'true' } });
    setIcon(mark.createSpan({ cls: 'fm-filter-check-tick' }), 'check');
    setIcon(mark.createSpan({ cls: 'fm-filter-check-mixed' }), 'minus');
    label.createSpan({ text: title });
    input.onchange = () => change(toggleGalleryValues(selected(), values, input.checked));
    inputs.push({ input, values });
  };

  return { root, sync(nextOptions) {
    const nextSignature = JSON.stringify(nextOptions);
    if (signature !== nextSignature) {
      signature = nextSignature; options = nextOptions; inputs = []; body.empty();
      if (tree) {
        const years = new Map();
        for (const option of options) {
          const year = option.value.split('/')[0];
          if (!years.has(year)) years.set(year, []);
          years.get(year).push(option);
        }
        let first = true;
        for (const [year, months] of years) {
          const group = body.createDiv({ cls: 'fm-filter-tree-group' });
          const row = group.createDiv({ cls: 'fm-filter-tree-year' });
          const toggle = row.createEl('button', { cls: 'fm-filter-tree-toggle', attr: { type: 'button', 'aria-label': year, 'aria-expanded': String(first) } });
          setIcon(toggle, 'chevron-right');
          checkbox(row, year, months.map(option => option.value));
          const children = group.createDiv({ cls: 'fm-filter-tree-months' });
          children.hidden = !first; first = false;
          toggle.onclick = () => { children.hidden = !children.hidden; toggle.setAttribute('aria-expanded', String(!children.hidden)); };
          for (const month of months) checkbox(children, month.label, [month.value]);
        }
      } else for (const option of options) checkbox(body, option.label, [option.value]);
      if (!options.length) body.createDiv({ text: t('galleryEmpty'), cls: 'fm-filter-empty' });
    }
    const values = selected();
    const active = values.length > 0;
    text.setText(!active ? t(allKey) : values.length === 1 ? (options.find(option => option.value === values[0])?.summary || values[0]) : t(summaryKey, { count: values.length }));
    trigger.toggleClass('is-filtered', active); clear.disabled = !active;
    for (const { input, values: group } of inputs) {
      const matches = group.filter(value => values.includes(value)).length;
      input.checked = matches === group.length;
      input.indeterminate = matches > 0 && matches < group.length;
    }
  }};
}
