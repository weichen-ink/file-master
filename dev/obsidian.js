const { createVaultFixture } = require('../tests/helpers/vault');
const { Element, Setting } = require('../tests/helpers/ui');

/** Run the current File Master source against a fresh in-memory Obsidian host. */
function createObsidianSimulation({ requestUrl, globals = {} } = {}) {
  const fetch = async () => { throw new Error('Unexpected fetch in Obsidian simulation'); };
  return createVaultFixture(requestUrl, { fetch, ...globals }, { buildFromSource: true });
}

module.exports = { createObsidianSimulation, Element, Setting };
