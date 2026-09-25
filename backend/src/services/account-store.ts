import path from 'node:path';
import crypto from 'node:crypto';
import { APP_CONSTANTS, type BitbucketAuthType } from '@bitbucket-pr-approver/shared';
import { CryptoService, type EncryptedData } from './crypto.js';
import { VersionedJsonStore } from './versioned-json-store.js';

export interface BitbucketAccount {
  id: string;
  name: string;
  username?: string;
  authType: BitbucketAuthType;
  tokenPreview: string;
  createdAt: string;
  updatedAt: string;
}

interface StoredAccount extends BitbucketAccount {
  encryptedToken: EncryptedData;
}

export class AccountStore {
  private readonly store: VersionedJsonStore<StoredAccount[]>;
  private readonly crypt: CryptoService;

  constructor(dataDir: string) {
    this.store = new VersionedJsonStore(path.join(dataDir, 'accounts.json'), 1, () => []);
    this.crypt = new CryptoService(path.join(dataDir, APP_CONSTANTS.STORAGE.SECRET_KEY_FILE));
  }

  list(): BitbucketAccount[] {
    return this.store.read().map(({ encryptedToken: _encryptedToken, ...account }) => account);
  }

  get(id: string): BitbucketAccount | null {
    return this.list().find((account) => account.id === id) || null;
  }

  getCredential(id: string): { account: BitbucketAccount; token: string } {
    const item = this.store.read().find((account) => account.id === id);
    if (!item) throw Object.assign(new Error('Bitbucket account not found'), { code: 'ACCOUNT_NOT_FOUND', statusCode: 404 });
    const { encryptedToken, ...account } = item;
    return { account, token: this.crypt.decrypt(encryptedToken) };
  }

  save(input: { name: string; username?: string; authType: BitbucketAuthType; token?: string }, id?: string): BitbucketAccount {
    if (!input || typeof input.name !== 'string' || typeof input.authType !== 'string' ||
        (input.username !== undefined && typeof input.username !== 'string') ||
        (input.token !== undefined && typeof input.token !== 'string')) {
      throw Object.assign(new Error('Account name, auth type, and token must be valid strings'), { code: 'VALIDATION_ERROR', statusCode: 400 });
    }
    const now = new Date().toISOString();
    const items = this.store.read();
    const existing = id ? items.find((item) => item.id === id) : undefined;
    if (id && !existing) throw Object.assign(new Error('Bitbucket account not found'), { code: 'ACCOUNT_NOT_FOUND', statusCode: 404 });
    const name = input.name.trim();
    const username = input.username?.trim() || undefined;
    if (!name || name.length > 100 || (username && username.length > 320) || !['basic', 'bearer'].includes(input.authType) ||
        (input.authType === 'basic' && !username) || (!existing && !input.token) ||
        (input.token !== undefined && (!input.token.trim() || Buffer.byteLength(input.token) > 318))) {
      throw Object.assign(new Error('Invalid account name, username, or token (maximum 318 UTF-8 bytes)'), { code: 'VALIDATION_ERROR', statusCode: 400 });
    }
    const token = input.token?.trim();
    const account: StoredAccount = {
      id: existing?.id || crypto.randomUUID(), name, username, authType: input.authType,
      tokenPreview: token ? CryptoService.maskToken(token) : existing!.tokenPreview,
      encryptedToken: token ? this.crypt.encrypt(token) : existing!.encryptedToken,
      createdAt: existing?.createdAt || now, updatedAt: now,
    };
    this.store.write(existing ? items.map((item) => item.id === id ? account : item) : [...items, account]);
    const { encryptedToken: _encryptedToken, ...view } = account;
    return view;
  }

  delete(id: string): boolean {
    const items = this.store.read();
    if (!items.some((item) => item.id === id)) return false;
    this.store.write(items.filter((item) => item.id !== id));
    return true;
  }
}
