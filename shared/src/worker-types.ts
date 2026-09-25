import type { ApprovalJob, BitbucketConnectionConfig } from './types.js';

export type WorkerState =
  | 'STARTING'
  | 'ONLINE'
  | 'PAUSED_VPN'
  | 'OFFLINE_CONTROL_PLANE'
  | 'OFFLINE'
  | 'UPDATING'
  | 'ERROR_AUTH'
  | 'ERROR';

export type ExecutionTrigger = 'SCHEDULED' | 'MANUAL' | 'RESUMED';

export type ExecutionStatus =
  | 'QUEUED'
  | 'LEASED'
  | 'RUNNING'
  | 'RETRYABLE'
  | 'COMPLETED'
  | 'FAILED';

export type WorkerLogStatus =
  | 'APPROVED'
  | 'SKIPPED'
  | 'DRY_RUN'
  | 'ALREADY_APPROVED'
  | 'FAILED'
  | 'PAUSED_VPN'
  | 'RESUMED';

export interface WorkerMetadata {
  name: string;
  platform: 'darwin' | 'win32' | 'linux';
  architecture: string;
  hostname?: string;
  version: string;
}

export interface WorkerRecord extends WorkerMetadata {
  id: string;
  ownerId: string;
  state: WorkerState;
  publicKey: JsonWebKey;
  pairedAt: string;
  lastHeartbeatAt?: string;
  lastBitbucketProbeAt?: string;
  activeExecutionId?: string;
  queueDepth: number;
  hasLegacyToken?: boolean;
  supportsAccountLeases?: boolean;
  revokedAt?: string;
}

export interface PairingSession {
  id: string;
  ownerId: string;
  codeHash: string;
  createdAt: string;
  expiresAt: string;
  consumedAt?: string;
}

export interface PairingSessionView {
  id: string;
  code: string;
  expiresAt: string;
  pairUrl: string;
}

export interface PairWorkerRequest {
  code: string;
  publicKey: JsonWebKey;
  metadata: WorkerMetadata;
}

export interface PairWorkerResponse {
  worker: WorkerRecord;
  credential: string;
}

export interface HeartbeatRequest {
  state: WorkerState;
  version: string;
  platform: WorkerMetadata['platform'];
  architecture: string;
  activeExecutionId?: string;
  queueDepth: number;
  hasLegacyToken?: boolean;
  supportsAccountLeases?: boolean;
  lastBitbucketProbeAt?: string;
}

export interface EncryptedTokenEnvelope {
  id: string;
  workerId: string;
  algorithm: 'RSA-OAEP-256';
  ciphertext: string;
  createdAt: string;
  expiresAt: string;
  claimedAt?: string;
}

export interface ExecutionLease {
  executionId: string;
  idempotencyKey: string;
  jobId: string;
  jobRevision: string;
  workerId: string;
  trigger: ExecutionTrigger;
  status: ExecutionStatus;
  scheduledFor: string;
  createdAt: string;
  leasedUntil?: string;
  startedAt?: string;
  completedAt?: string;
  lastSequence: number;
  job: ApprovalJob;
  bitbucketConfig: Omit<BitbucketConnectionConfig, 'token'>;
  manualTokenCiphertext?: string;
  accountTokenCiphertext?: string;
  result?: ExecutionResultSummary;
}

export interface WorkerRunRecord {
  executionId: string;
  jobId: string;
  jobName: string;
  workerId: string;
  trigger: ExecutionTrigger;
  status: ExecutionStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  result?: ExecutionResultSummary;
}

export interface ClaimResponse {
  lease: ExecutionLease | null;
  serverTime: string;
}

export interface WorkerLogEntry {
  id: string;
  workerId: string;
  executionId: string;
  jobId: string;
  sequence: number;
  status: WorkerLogStatus;
  timestamp: string;
  repository?: string;
  prId?: number;
  prTitle?: string;
  author?: string;
  sourceBranch?: string;
  targetBranch?: string;
  matchedConditions: string[];
  failureReason?: string;
  providerErrorCode?: string;
  retryable?: boolean;
  durationMs?: number;
}

export interface LogBatchRequest {
  sequence: number;
  items: WorkerLogEntry[];
}

export interface LogBatchResponse {
  acceptedThrough: number;
  retained: number;
}

export interface ExecutionResultSummary {
  executionId: string;
  workerId: string;
  jobId: string;
  status: Extract<ExecutionStatus, 'RETRYABLE' | 'COMPLETED' | 'FAILED'>;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  repositoriesScanned: number;
  pullRequestsScanned: number;
  matched: number;
  approved: number;
  skipped: number;
  failed: number;
  alreadyApproved: number;
  failureReason?: string;
}

export interface WorkerLogQuery {
  workerId?: string;
  jobId?: string;
  executionId?: string;
  status?: WorkerLogStatus;
  repository?: string;
  search?: string;
  limit?: number;
}
