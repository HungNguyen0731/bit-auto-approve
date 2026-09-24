import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface EncryptedData {
  iv: string; // Hex string (12 bytes)
  tag: string; // Hex string (16 bytes)
  data: string; // Hex string
}

export class CryptoService {
  private masterKey: Buffer;

  constructor(keyFilePath: string) {
    this.masterKey = this.initMasterKey(keyFilePath);
  }

  private initMasterKey(keyFilePath: string): Buffer {
    const dir = path.dirname(keyFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (fs.existsSync(keyFilePath)) {
      const keyHex = fs.readFileSync(keyFilePath, 'utf-8').trim();
      const keyBuffer = Buffer.from(keyHex, 'hex');
      if (keyBuffer.length === 32) {
        return keyBuffer;
      }
    }

    // Generate new 256-bit key
    const newKey = crypto.randomBytes(32);
    fs.writeFileSync(keyFilePath, newKey.toString('hex'), { mode: 0o600 });
    try {
      fs.chmodSync(keyFilePath, 0o600);
    } catch {
      // Best effort on platforms that don't support chmod (Windows)
    }
    return newKey;
  }

  encrypt(plaintext: string): EncryptedData {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.masterKey, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag();

    return {
      iv: iv.toString('hex'),
      tag: tag.toString('hex'),
      data: encrypted,
    };
  }

  decrypt(payload: EncryptedData): string {
    const iv = Buffer.from(payload.iv, 'hex');
    const tag = Buffer.from(payload.tag, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.masterKey, iv);

    decipher.setAuthTag(tag);
    let decrypted = decipher.update(payload.data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  static maskToken(token?: string): string {
    if (!token) return '';
    if (token.length <= 4) return '••••';
    return `••••••••${token.slice(-4)}`;
  }
}
