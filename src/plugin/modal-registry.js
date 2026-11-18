const registry = Object.create(null);

export function registerPluginModals(modals) {
  if (!modals || typeof modals !== 'object') return;
  Object.assign(registry, modals);
}

export function requireModal(name) {
  const ModalClass = registry[name];
  if (!ModalClass) {
    throw new Error(`Modal "${name}" is not registered`);
  }
  return ModalClass;
}
