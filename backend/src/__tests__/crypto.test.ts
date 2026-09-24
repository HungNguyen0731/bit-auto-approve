import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CryptoService } from '../services/crypto.js';

describe('Crypto Service (AES-256-GCM)', () => {
  let tmpDir: string;
  let keyPath: string;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crypto-test-'));
    keyPath = path.join(tmpDir, 'master.key');
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('generates master key file with proper permissions', () => {
    const service = new CryptoService(keyPath);
    assert.ok(fs.existsSync(keyPath));

    const keyHex = fs.readFileSync(keyPath, 'utf-8').trim();
    assert.equal(Buffer.from(keyHex, 'hex').length, 32);
  });

  it('encrypts and decrypts secrets correctly with AES-256-GCM', () => {
    const service = new CryptoService(keyPath);
    const plaintext = 'super-secret-pat-token-1234567890';

    const encrypted = service.encrypt(plaintext);
    assert.ok(encrypted.iv);
    assert.ok(encrypted.tag);
    assert.ok(encrypted.data);
    assert.notEqual(encrypted.data, plaintext);

    const decrypted = service.decrypt(encrypted);
    assert.equal(decrypted, plaintext);
  });

  it('masks token correctly for UI display', () => {
    assert.equal(CryptoService.maskToken(''), '');
    assert.equal(CryptoService.maskToken('abc'), '••••');
    assert.equal(CryptoService.maskToken('BBAA123456789xyz'), '••••••••9xyz');
  });

  it('fails decryption with tampered ciphertext or tag', () => {
    const service = new CryptoService(keyPath);
    const plaintext = 'sensitive-data';
    const encrypted = service.encrypt(plaintext);

    // Tamper with data
    const tampered = {
      ...encrypted,
      data: '00' + encrypted.data.slice(2),
    };

    assert.throws(() => {
      service.decrypt(tampered);
    });
  });
});
