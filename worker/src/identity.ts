import crypto from 'node:crypto';
import type { PairWorkerResponse, WorkerMetadata } from '@bitbucket-pr-approver/shared';
import { KeychainStore } from './keychain.js';

export const IDENTITY_SERVICE = 'com.hungnv.bitbucket-pr-worker.identity';
export const CREDENTIAL_SERVICE = 'com.hungnv.bitbucket-pr-worker.credential';
export const BITBUCKET_TOKEN_SERVICE = 'com.hungnv.bitbucket-pr-worker.bitbucket-token';

interface WorkerIdentity {
  publicKey: JsonWebKey;
  privateKey: JsonWebKey;
}

export class WorkerIdentityStore {
  constructor(private readonly keychain: KeychainStore) {}

  async getOrCreateIdentity(): Promise<WorkerIdentity> {
    const existing = await this.keychain.get(IDENTITY_SERVICE);
    if (existing) return JSON.parse(existing) as WorkerIdentity;

    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 3072,
      publicExponent: 0x10001,
    });
    const identity: WorkerIdentity = {
      publicKey: publicKey.export({ format: 'jwk' }),
      privateKey: privateKey.export({ format: 'jwk' }),
    };
    await this.keychain.set(IDENTITY_SERVICE, JSON.stringify(identity));
    return identity;
  }

  async storePairing(result: PairWorkerResponse): Promise<void> {
    await this.keychain.set(CREDENTIAL_SERVICE, result.credential);
  }

  async getCredential(): Promise<string | null> {
    return this.keychain.get(CREDENTIAL_SERVICE);
  }

  async decryptEnvelope(ciphertext: string): Promise<string> {
    const identity = await this.getOrCreateIdentity();
    const privateKey = crypto.createPrivateKey({ key: identity.privateKey, format: 'jwk' });
    return crypto
      .privateDecrypt(
        { key: privateKey, oaepHash: 'sha256', padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
        Buffer.from(ciphertext, 'base64url')
      )
      .toString('utf8');
  }

  async storeBitbucketToken(token: string): Promise<void> {
    await this.keychain.set(BITBUCKET_TOKEN_SERVICE, token);
  }

  async getBitbucketToken(): Promise<string | null> {
    return this.keychain.get(BITBUCKET_TOKEN_SERVICE);
  }

  pairingRequest(code: string, metadata: WorkerMetadata, publicKey: JsonWebKey) {
    return { code, metadata, publicKey };
  }
}
