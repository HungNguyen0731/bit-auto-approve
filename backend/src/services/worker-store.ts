import crypto from 'node:crypto';
import path from 'node:path';
import type {
  EncryptedTokenEnvelope,
  ExecutionLease,
  HeartbeatRequest,
  PairingSession,
  PairingSessionView,
  PairWorkerResponse,
  WorkerMetadata,
  WorkerRecord,
} from '@bitbucket-pr-approver/shared';
import { VersionedJsonStore, type VersionedDocument } from './versioned-json-store.js';

interface StoredWorkerRecord extends WorkerRecord {
  credentialHash: string;
}

interface WorkerStoreData {
  workers: StoredWorkerRecord[];
  pairingSessions: PairingSession[];
  tokenEnvelopes: EncryptedTokenEnvelope[];
  leases: ExecutionLease[];
}

const SCHEMA_VERSION = 1;
const PAIRING_TTL_MS = 10 * 60 * 1000;

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function safeHexEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function publicWorker(worker: StoredWorkerRecord): WorkerRecord {
  const { credentialHash: _credentialHash, ...record } = worker;
  return record;
}

function migrate(document: VersionedDocument<unknown>): VersionedDocument<WorkerStoreData> {
  if (document.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`Unsupported worker store schema version ${document.schemaVersion}`);
  }
  return document as VersionedDocument<WorkerStoreData>;
}

export class WorkerStore {
  private readonly store: VersionedJsonStore<WorkerStoreData>;

  constructor(dataDir: string) {
    this.store = new VersionedJsonStore(
      path.join(dataDir, 'workers.json'),
      SCHEMA_VERSION,
      () => ({ workers: [], pairingSessions: [], tokenEnvelopes: [], leases: [] }),
      migrate
    );
  }

  createPairingSession(
    ownerId: string,
    controlPlaneUrl: string,
    now: Date = new Date()
  ): PairingSessionView {
    const code = crypto.randomBytes(6).toString('base64url').toUpperCase();
    const session: PairingSession = {
      id: crypto.randomUUID(),
      ownerId,
      codeHash: sha256(code),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + PAIRING_TTL_MS).toISOString(),
    };

    this.store.update((data) => ({
      ...data,
      pairingSessions: [
        ...data.pairingSessions.filter(
          (item) => !item.consumedAt && new Date(item.expiresAt).getTime() > now.getTime()
        ),
        session,
      ],
    }));

    const pairUrl = new URL('bitbucket-pr-worker://pair');
    pairUrl.searchParams.set('controlPlane', controlPlaneUrl);
    pairUrl.searchParams.set('code', code);

    return {
      id: session.id,
      code,
      expiresAt: session.expiresAt,
      pairUrl: pairUrl.toString(),
    };
  }

  consumePairingSession(
    code: string,
    publicKey: JsonWebKey,
    metadata: WorkerMetadata,
    now: Date = new Date()
  ): PairWorkerResponse {
    const data = this.store.read();
    const suppliedHash = sha256(code);
    const session = data.pairingSessions.find(
      (item) => !item.consumedAt && safeHexEqual(item.codeHash, suppliedHash)
    );

    if (!session) {
      throw Object.assign(new Error('Pairing code is invalid or already consumed'), {
        code: 'PAIRING_INVALID',
        statusCode: 409,
      });
    }
    if (new Date(session.expiresAt).getTime() <= now.getTime()) {
      throw Object.assign(new Error('Pairing code has expired'), {
        code: 'PAIRING_EXPIRED',
        statusCode: 410,
      });
    }

    const credential = crypto.randomBytes(32).toString('base64url');
    const worker: StoredWorkerRecord = {
      id: crypto.randomUUID(),
      ownerId: session.ownerId,
      state: 'STARTING',
      publicKey,
      credentialHash: sha256(credential),
      pairedAt: now.toISOString(),
      queueDepth: 0,
      ...metadata,
    };

    session.consumedAt = now.toISOString();
    data.workers.push(worker);
    this.store.write(data);

    return { worker: publicWorker(worker), credential };
  }

  authenticateWorker(workerId: string, credential: string): WorkerRecord | null {
    const worker = this.store.read().workers.find((item) => item.id === workerId && !item.revokedAt);
    if (!worker) return null;
    return safeHexEqual(worker.credentialHash, sha256(credential)) ? publicWorker(worker) : null;
  }

  listWorkers(ownerId?: string): WorkerRecord[] {
    return this.store
      .read()
      .workers.filter((worker) => !ownerId || worker.ownerId === ownerId)
      .map(publicWorker);
  }

  getWorker(workerId: string): WorkerRecord | null {
    const worker = this.store.read().workers.find((item) => item.id === workerId);
    return worker ? publicWorker(worker) : null;
  }

  recordHeartbeat(workerId: string, heartbeat: HeartbeatRequest, now: Date = new Date()): WorkerRecord {
    let updated: StoredWorkerRecord | undefined;
    this.store.update((data) => ({
      ...data,
      workers: data.workers.map((worker) => {
        if (worker.id !== workerId || worker.revokedAt) return worker;
        updated = {
          ...worker,
          state: heartbeat.state,
          version: heartbeat.version,
          platform: heartbeat.platform,
          architecture: heartbeat.architecture,
          activeExecutionId: heartbeat.activeExecutionId,
          queueDepth: heartbeat.queueDepth,
          hasLegacyToken: heartbeat.hasLegacyToken,
          supportsAccountLeases: heartbeat.supportsAccountLeases === true,
          lastBitbucketProbeAt: heartbeat.lastBitbucketProbeAt,
          lastHeartbeatAt: now.toISOString(),
        };
        return updated;
      }),
    }));

    if (!updated) {
      throw Object.assign(new Error('Worker not found or revoked'), {
        code: 'WORKER_NOT_FOUND',
        statusCode: 404,
      });
    }
    return publicWorker(updated);
  }

  markOfflineBefore(cutoffIso: string): string[] {
    const changed: string[] = [];
    const cutoff = new Date(cutoffIso).getTime();
    this.store.update((data) => ({
      ...data,
      workers: data.workers.map((worker) => {
        if (
          worker.revokedAt ||
          worker.state === 'OFFLINE' ||
          !worker.lastHeartbeatAt ||
          new Date(worker.lastHeartbeatAt).getTime() >= cutoff
        ) {
          return worker;
        }
        changed.push(worker.id);
        return { ...worker, state: 'OFFLINE' };
      }),
    }));
    return changed;
  }

  revokeWorker(workerId: string, now: Date = new Date()): WorkerRecord | null {
    let revoked: StoredWorkerRecord | null = null;
    this.store.update((data) => ({
      ...data,
      workers: data.workers.map((worker) => {
        if (worker.id !== workerId) return worker;
        revoked = { ...worker, state: 'OFFLINE', revokedAt: now.toISOString() };
        return revoked;
      }),
    }));
    return revoked ? publicWorker(revoked) : null;
  }

  saveTokenEnvelope(envelope: EncryptedTokenEnvelope): void {
    this.store.update((data) => ({
      ...data,
      tokenEnvelopes: [
        ...data.tokenEnvelopes.filter((item) => item.workerId !== envelope.workerId),
        envelope,
      ],
    }));
  }

  claimTokenEnvelope(workerId: string, now: Date = new Date()): EncryptedTokenEnvelope | null {
    let claimed: EncryptedTokenEnvelope | null = null;
    this.store.update((data) => ({
      ...data,
      tokenEnvelopes: data.tokenEnvelopes.map((envelope) => {
        if (
          envelope.workerId !== workerId ||
          new Date(envelope.expiresAt).getTime() <= now.getTime()
        ) {
          return envelope;
        }
        claimed = { ...envelope, claimedAt: now.toISOString() };
        return claimed;
      }),
    }));
    return claimed;
  }

  acknowledgeTokenEnvelope(workerId: string, envelopeId: string): boolean {
    let removed = false;
    this.store.update((data) => ({
      ...data,
      tokenEnvelopes: data.tokenEnvelopes.filter((envelope) => {
        const matches = envelope.workerId === workerId && envelope.id === envelopeId;
        if (matches) removed = true;
        return !matches;
      }),
    }));
    return removed;
  }

  getLeases(): ExecutionLease[] {
    return this.store.read().leases.map((lease) => ({ ...lease }));
  }

  saveLeases(leases: ExecutionLease[]): void {
    const active = leases.filter((lease) => !['COMPLETED', 'FAILED'].includes(lease.status));
    const recent = leases.filter((lease) => ['COMPLETED', 'FAILED'].includes(lease.status))
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
      .slice(0, 300);
    this.store.update((data) => ({ ...data, leases: [...active, ...recent] }));
  }
}
