const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const nodeCrypto = require('node:crypto');

// Extract and evaluate the real computeSha256Pure and computeSha256Hex from src/engine.js
const engineCode = fs.readFileSync(path.resolve(__dirname, '../src/engine.js'), 'utf8');
const shaPureMatch = engineCode.match(/function computeSha256Pure\([\s\S]*?\n\}/);
const shaHexMatch = engineCode.match(/async function computeSha256Hex\([\s\S]*?\n\}/);

assert.ok(shaPureMatch, 'computeSha256Pure must be in engine.js');
assert.ok(shaHexMatch, 'computeSha256Hex must be in engine.js');

const { computeSha256Pure, computeSha256Hex } = new Function(`
  ${shaPureMatch[0]}
  ${shaHexMatch[0]}
  return { computeSha256Pure, computeSha256Hex };
`)();

// Test the real computeSha256Hex and pure JS fallback
test('computeSha256Hex & computeSha256Pure: exact SHA-256 vectors with and without Web Crypto', async () => {
  const testCases = [
    '',
    'hello',
    'The quick brown fox jumps over the lazy dog',
    'Obsidian FileMaster Mobile Verification 2026'
  ];

  for (const text of testCases) {
    const buf = Buffer.from(text);
    const expected = nodeCrypto.createHash('sha256').update(buf).digest('hex');

    // 1. Pure JS algorithm
    const pureHex = computeSha256Pure(new Uint8Array(buf));
    assert.strictEqual(pureHex, expected, `Pure JS SHA-256 must match node crypto for "${text}"`);

    // 2. Real async computeSha256Hex (Web Crypto)
    const webHex = await computeSha256Hex(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    assert.strictEqual(webHex, expected, `Web Crypto SHA-256 must match node crypto for "${text}"`);
  }
});

// Simulate FileMasterPlugin instance
class MockPlugin {
  constructor() {
    this.settings = {
      serverUrl: 'http://localhost:3000',
      apiToken: 'test-token'
    };
    this.probeMock = null;
    this.uploadMock = null;
  }

  getCleanServerUrl() {
    return this.settings.serverUrl;
  }

  async probeRemoteSha256(sha256) {
    if (this.probeMock) {
      return this.probeMock(sha256);
    }
    return null;
  }

  async uploadBufferToServer(
    arrayBuffer,
    filename,
    mimeType = 'application/octet-stream',
    toProtectedFolder = false,
    options = {}
  ) {
    // 1. Instant Upload Probe via local SHA-256 calculation (0 network payload)
    if (!options.skipProbe && !toProtectedFolder) {
      try {
        const fullSha256 = await computeSha256Hex(arrayBuffer);
        const probed = await this.probeRemoteSha256(fullSha256);
        if (probed && probed.exists) {
          probed.isInstant = true;
          return probed;
        }
      } catch { }
    }

    // 2. Mocked standard upload
    if (this.uploadMock) {
      return this.uploadMock(arrayBuffer, filename, mimeType, toProtectedFolder);
    }
    return { success: true, filename, url: `http://localhost:3000/raw/2026/10/${filename}` };
  }
}

test('Instant Upload: reuses existing remote file on probe match (0-payload upload)', async () => {
  const plugin = new MockPlugin();
  const testBytes = Buffer.from('hello-world-image-content-bytes');
  const expectedHash = nodeCrypto.createHash('sha256').update(testBytes).digest('hex');

  let probeCalledWith = null;
  let uploadCalled = false;

  plugin.probeMock = (sha256) => {
    probeCalledWith = sha256;
    return {
      exists: true,
      deduplicated: true,
      year: '2026',
      month: '10',
      filename: 'existing_image.png',
      rawUrl: 'http://localhost:3000/raw/2026/10/existing_image.png'
    };
  };

  plugin.uploadMock = () => {
    uploadCalled = true;
    return { success: true };
  };

  const res = await plugin.uploadBufferToServer(testBytes, 'my_pasted_image.png');

  assert.strictEqual(probeCalledWith, expectedHash, 'Probe must be called with local calculated sha256');
  assert.strictEqual(res.isInstant, true, 'Result must be flagged as instant upload');
  assert.strictEqual(res.filename, 'existing_image.png', 'Must return existing remote filename');
  assert.strictEqual(uploadCalled, false, 'Standard multipart upload MUST NOT be called when probe matches');
});

test('Instant Upload: falls back to regular upload when probe returns exists: false', async () => {
  const plugin = new MockPlugin();
  const testBytes = Buffer.from('brand-new-image-content');

  let probeCalled = false;
  let uploadCalled = false;

  plugin.probeMock = () => {
    probeCalled = true;
    return { exists: false };
  };

  plugin.uploadMock = (buf, filename) => {
    uploadCalled = true;
    return {
      success: true,
      filename,
      url: `http://localhost:3000/raw/2026/10/${filename}`
    };
  };

  const res = await plugin.uploadBufferToServer(testBytes, 'brand_new.png');

  assert.strictEqual(probeCalled, true, 'Probe must be called first');
  assert.strictEqual(uploadCalled, true, 'Must fall back to regular upload');
  assert.strictEqual(res.isInstant, undefined, 'Must not be flagged as instant upload');
  assert.strictEqual(res.filename, 'brand_new.png');
});

