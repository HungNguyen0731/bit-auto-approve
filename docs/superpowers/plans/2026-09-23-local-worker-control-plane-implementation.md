# Local Worker and Control Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add a macOS local worker that pairs once with the web control plane, executes Bitbucket jobs through the workstation VPN, pauses and resumes automatically with connectivity, and retains detailed per-PR logs capped at 300 entries per worker.

**Architecture:** The existing Fastify app remains the control plane and keeps local-mode compatibility. Worker-mode jobs are converted into idempotent execution leases that an outbound-only Node worker claims over HTTPS. Credentials are encrypted in the browser for the worker public key, stored in macOS Keychain, and never persisted in plaintext by the control plane.

**Tech Stack:** Node.js 24, TypeScript 7 backend/worker, Fastify 5, React 18, Vite 6, Web Crypto RSA-OAEP, Node `crypto`, macOS Keychain and LaunchAgent, versioned atomic JSON stores.

**Spec:** `docs/superpowers/specs/2026-09-23-local-worker-control-plane-design.md`

## Global Constraints

- macOS is the first supported worker platform; keep protocol types portable to Windows.
- Preserve all existing local-mode jobs; do not migrate any job automatically.
- Do not create or modify existing tests unless the user explicitly requests it; run unchanged suites and use disposable one-off smokes.
- Do not invoke a real Bitbucket approval during implementation verification.
- Do not stage or commit files unless the user explicitly requests it.
- Keep at most 300 worker item logs per worker in both control-plane persistence and local outbox.
- Never write raw Bitbucket tokens to browser storage, control-plane persistence, logs, process arguments, or installer files.
- Production pairing and worker traffic require HTTPS; development loopback HTTP must be explicitly marked development-only.
- Missed intervals collapse into one future execution; never replay a backlog after VPN recovery.

---

## File Structure

### Shared contracts

- Create `shared/src/worker-types.ts`: worker state, pairing, heartbeat, lease, execution, and worker-log contracts.
- Modify `shared/src/types.ts`: add `executionMode` and `workerId` to approval jobs without breaking existing data.
- Modify `shared/src/index.ts`: export worker contracts.

### Control plane backend

- Create `backend/src/services/versioned-json-store.ts`: atomic schema-versioned JSON persistence primitive.
- Create `backend/src/services/worker-store.ts`: workers, pairing sessions, leases, token envelopes, and retention metadata.
- Create `backend/src/services/worker-log-store.ts`: idempotent batched logs with 300-entry retention.
- Create `backend/src/services/control-plane-auth.ts`: single-owner session and CSRF validation.
- Create `backend/src/services/worker-auth.ts`: hashed worker bearer credentials and request authentication.
- Create `backend/src/services/execution-dispatcher.ts`: due-job leasing, lease renewal, completion, and missed-cycle collapse.
- Create `backend/src/routes/session.ts`: owner login/logout/session routes.
- Create `backend/src/routes/workers.ts`: pairing, heartbeat, claim, token envelope, logs, completion, and update metadata routes.
- Modify `backend/src/services/scheduler.ts`: execute only local-mode jobs and delegate worker-mode scheduling.
- Modify `backend/src/routes/jobs.ts`: validate worker assignment and dispatch manual worker runs.
- Modify `backend/src/server.ts`: initialize and register worker/auth services.

### Local worker package

- Create `worker/package.json`, `worker/tsconfig.json`, and `worker/src/index.ts`.
- Create `worker/src/config.ts`: non-secret worker configuration.
- Create `worker/src/keychain.ts`: macOS Keychain adapter.
- Create `worker/src/identity.ts`: RSA-OAEP identity and worker bearer credential lifecycle.
- Create `worker/src/control-plane-client.ts`: heartbeat, claim, renewal, log-batch, completion, and envelope calls.
- Create `worker/src/vpn-state.ts`: connectivity state machine and anti-flap thresholds.
- Create `worker/src/executor.ts`: Bitbucket job execution using existing shared contracts and backend engine/client code extracted into shared runtime modules.
- Create `worker/src/outbox.ts`: 300-entry offline FIFO with sequence numbers.
- Create `worker/src/updater.ts`: signed update manifest verification and rollback marker.

### macOS lifecycle

- Create `worker/install/macos/install.sh` and `uninstall.sh`.
- Create `worker/install/macos/com.hungnv.bitbucket-pr-worker.plist.template`.
- Create `worker/install/macos/package.sh`: development `.pkg` builder and production signing hooks.
- Create `worker/install/macos/register-url-handler.sh`: `bitbucket-pr-worker://pair` registration through the packaged app wrapper.

### Frontend

- Create `frontend/src/components/WorkerSetup.tsx`: install and pairing wizard.
- Create `frontend/src/components/WorkerStatus.tsx`: heartbeat/VPN state card.
- Create `frontend/src/components/WorkerExecutionLog.tsx`: per-run and per-PR log explorer.
- Modify `frontend/src/api/client.ts`: session, worker, pairing, lease-log, and installer metadata calls.
- Modify `frontend/src/App.tsx`: worker navigation, SSE updates, and offline/paused banners.
- Modify `frontend/src/components/JobFormModal.tsx`: execution mode and worker assignment.
- Modify `frontend/src/components/ActionLogTable.tsx`: local/worker source and exact skip reason display.

---

### Task 1: Shared Worker Protocol and Job Compatibility

**Files:**
- Create: `bitbucket-pr-approver/shared/src/worker-types.ts`
- Modify: `bitbucket-pr-approver/shared/src/types.ts`
- Modify: `bitbucket-pr-approver/shared/src/index.ts`

**Interfaces:**
- Produces: `WorkerState`, `WorkerRecord`, `PairingSession`, `ExecutionLease`, `WorkerLogEntry`, `HeartbeatRequest`, `ClaimResponse`, `LogBatchRequest`.
- Preserves: Existing `ApprovalJob` JSON defaults to `executionMode: "local"` when the field is absent.

- [x] **Step 1: Add exact protocol unions and records**

```ts
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
export type ExecutionStatus = 'QUEUED' | 'LEASED' | 'RUNNING' | 'RETRYABLE' | 'COMPLETED' | 'FAILED';
export type WorkerLogStatus =
  | 'APPROVED'
  | 'SKIPPED'
  | 'DRY_RUN'
  | 'ALREADY_APPROVED'
  | 'FAILED'
  | 'PAUSED_VPN'
  | 'RESUMED';
```

- [x] **Step 2: Define lease and log payloads with sequence/idempotency fields**

```ts
export interface ExecutionLease {
  executionId: string;
  idempotencyKey: string;
  jobId: string;
  jobRevision: string;
  workerId: string;
  trigger: ExecutionTrigger;
  status: ExecutionStatus;
  leasedUntil: string;
  job: ApprovalJob;
}

export interface WorkerLogEntry {
  id: string;
  workerId: string;
  executionId: string;
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
}
```

- [x] **Step 3: Extend job routing fields compatibly**

```ts
export interface ApprovalJob {
  // existing fields remain unchanged
  executionMode?: 'local' | 'worker';
  workerId?: string;
  revision?: string;
}
```

- [x] **Step 4: Build shared contracts**

Run: `npm run build`

Working directory: `bitbucket-pr-approver/shared`

Expected: TypeScript exits 0 and `dist/worker-types.{js,d.ts}` exists.

### Task 2: Versioned Worker Persistence and 300-log Retention

**Files:**
- Create: `bitbucket-pr-approver/backend/src/services/versioned-json-store.ts`
- Create: `bitbucket-pr-approver/backend/src/services/worker-store.ts`
- Create: `bitbucket-pr-approver/backend/src/services/worker-log-store.ts`
- Modify: `bitbucket-pr-approver/backend/src/services/index.ts`

**Interfaces:**
- Consumes: Task 1 worker contracts.
- Produces: `WorkerStore`, `WorkerLogStore.appendBatch()`, `WorkerLogStore.query()`, `VersionedJsonStore<T>`.

- [x] **Step 1: Implement a schema-versioned atomic store**

```ts
export interface VersionedDocument<T> {
  schemaVersion: number;
  data: T;
}

export class VersionedJsonStore<T> {
  constructor(
    private readonly filePath: string,
    private readonly currentVersion: number,
    private readonly initialValue: () => T,
    private readonly migrate: (document: VersionedDocument<unknown>) => VersionedDocument<T>,
  ) {}

  read(): T;
  write(data: T): void;
}
```

Use a same-directory temporary file, `fsync`, and rename. Never include token plaintext in store types.

- [x] **Step 2: Implement worker and pairing persistence**

```ts
export class WorkerStore {
  createPairingSession(ownerId: string): PairingSession;
  consumePairingSession(code: string, publicKey: JsonWebKey, metadata: WorkerMetadata): PairResult;
  recordHeartbeat(workerId: string, heartbeat: HeartbeatRequest): WorkerRecord;
  markOfflineBefore(cutoffIso: string): string[];
  saveTokenEnvelope(workerId: string, envelope: EncryptedTokenEnvelope): void;
  claimTokenEnvelope(workerId: string): EncryptedTokenEnvelope | null;
  acknowledgeTokenEnvelope(workerId: string, envelopeId: string): void;
}
```

Hash pairing codes with SHA-256 and compare using `timingSafeEqual`. Expire after ten minutes and reject reuse.

- [x] **Step 3: Implement idempotent log batches and retention**

```ts
appendBatch(workerId: string, executionId: string, sequence: number, items: WorkerLogEntry[]): {
  acceptedThrough: number;
  retained: number;
};
```

Reject sequence gaps, acknowledge replayed sequences without duplication, sort by timestamp/sequence, and retain `entries.slice(-300)` independently per worker.

- [x] **Step 4: Run a disposable retention smoke**

Run a Node one-liner against a temporary directory that appends 350 sequential entries for one worker and 10 for another.

Expected JSON:

```json
{
  "workerA": 300,
  "workerAFirstSequence": 51,
  "workerB": 10,
  "duplicateBatchAdded": 0
}
```

- [x] **Step 5: Run unchanged backend tests and build**

Run: `npm test && npm run build`

Working directory: `bitbucket-pr-approver/backend`

Expected: 69 tests pass and TypeScript exits 0.

### Task 3: Owner Session, Pairing, and Worker Authentication

**Files:**
- Modify: `bitbucket-pr-approver/backend/package.json`
- Create: `bitbucket-pr-approver/backend/src/services/control-plane-auth.ts`
- Create: `bitbucket-pr-approver/backend/src/services/worker-auth.ts`
- Create: `bitbucket-pr-approver/backend/src/routes/session.ts`
- Create: `bitbucket-pr-approver/backend/src/routes/workers.ts`
- Modify: `bitbucket-pr-approver/backend/src/server.ts`

**Interfaces:**
- Consumes: `WorkerStore`.
- Produces: owner session guard, CSRF guard, `authenticateWorker()`, pairing and heartbeat routes.

- [x] **Step 1: Add cookie support**

Run: `npm install @fastify/cookie`

Do not add a password-hashing dependency. Derive the configured owner password with Node `crypto.scrypt` and a persisted random salt; compare with `timingSafeEqual`.

- [x] **Step 2: Implement single-owner sessions**

```ts
export class ControlPlaneAuth {
  login(password: string): { sessionId: string; csrfToken: string; expiresAt: string };
  requireSession(sessionId?: string): OwnerSession;
  requireCsrf(session: OwnerSession, supplied?: string): void;
  logout(sessionId: string): void;
}
```

Cookies are HttpOnly, Secure in production, SameSite=Strict, path `/`, and eight-hour expiry. Store only hashed session IDs.

- [x] **Step 3: Implement worker credentials**

Generate 32 random bytes at pairing completion, return the bearer credential once, and persist only SHA-256 hash plus worker ID and revocation time.

- [x] **Step 4: Add session and pairing routes**

```text
POST /api/session/login
POST /api/session/logout
GET  /api/session
POST /api/workers/pairing-sessions
POST /api/workers/pair
POST /api/workers/:workerId/heartbeat
GET  /api/workers
POST /api/workers/:workerId/revoke
```

Owner routes require session/CSRF. Pair consumes a valid code. Heartbeat requires the worker bearer credential.

- [x] **Step 5: Enforce HTTPS outside development loopback**

Reject pair/heartbeat requests when `NODE_ENV=production` and `x-forwarded-proto !== "https"`. Configure Fastify `trustProxy` only from explicit `TRUST_PROXY` settings.

- [x] **Step 6: Run a pairing smoke**

Use a temporary data directory and an ephemeral server to verify: login succeeds, pairing code is consumed once, second consumption is 409, heartbeat with returned worker token is 200, and an invalid token is 401.

- [x] **Step 7: Run unchanged backend tests and build**

Run: `npm test && npm run build`

Expected: existing suite remains green and build exits 0.

### Task 4: Execution Leases and Scheduler Delegation

**Files:**
- Create: `bitbucket-pr-approver/backend/src/services/execution-dispatcher.ts`
- Modify: `bitbucket-pr-approver/backend/src/services/scheduler.ts`
- Modify: `bitbucket-pr-approver/backend/src/routes/jobs.ts`
- Modify: `bitbucket-pr-approver/backend/src/routes/workers.ts`
- Modify: `bitbucket-pr-approver/shared/src/types.ts`

**Interfaces:**
- Produces: `ExecutionDispatcher.tick()`, `claim()`, `renew()`, `complete()`, `manualRun()`.
- Guarantees: one active lease per job, one terminal result per idempotency key, missed-cycle collapse.

- [x] **Step 1: Generate deterministic job revisions and idempotency keys**

```ts
const jobRevision = createHash('sha256').update(stableJobJson).digest('hex');
const idempotencyKey = `${job.id}:${scheduledSlotIso}:${jobRevision}`;
```

Manual runs use a generated execution ID as the slot component.

- [x] **Step 2: Implement due-job lease creation**

Worker-mode jobs are eligible only when enabled, assigned worker state is `ONLINE`, no active lease exists, and `nextRunAt <= now`. When offline/paused, update `nextRunAt` to `now + interval` without creating multiple leases.

- [x] **Step 3: Add worker claim, renewal, and completion routes**

```text
POST /api/workers/:workerId/claims
POST /api/workers/:workerId/executions/:executionId/renew
POST /api/workers/:workerId/executions/:executionId/complete
```

Claim returns at most one lease. Renewal extends by 45 seconds. Completion is idempotent and rejects another worker.

- [x] **Step 4: Split scheduler execution by mode**

```ts
if ((job.executionMode ?? 'local') === 'local') {
  await this.executeJob(job.id);
} else {
  this.executionDispatcher.schedule(job, now);
}
```

Do not change local-mode behavior.

- [x] **Step 5: Route Run Now by execution mode**

Local jobs retain existing behavior. Worker jobs call `manualRun(jobId)` and return `409 WORKER_NOT_ONLINE` when the assigned worker is unavailable.

- [x] **Step 6: Run a disposable scheduler smoke**

Use a temporary store with a 15-second worker job. Verify one lease, no duplicate claim, paused worker creates no lease, recovery creates one future lease, and five missed intervals still create only one lease.

- [x] **Step 7: Run unchanged backend tests and build**

Run: `npm test && npm run build`

Expected: existing local scheduler tests remain green.

### Task 5: Worker Runtime, Outbox, and VPN State Machine

**Files:**
- Create: `bitbucket-pr-approver/worker/package.json`
- Create: `bitbucket-pr-approver/worker/tsconfig.json`
- Create: `bitbucket-pr-approver/worker/src/config.ts`
- Create: `bitbucket-pr-approver/worker/src/control-plane-client.ts`
- Create: `bitbucket-pr-approver/worker/src/vpn-state.ts`
- Create: `bitbucket-pr-approver/worker/src/outbox.ts`
- Create: `bitbucket-pr-approver/worker/src/index.ts`

**Interfaces:**
- Consumes: pairing result and Task 4 lease routes.
- Produces: a long-running worker loop and `ConnectivityStateMachine.recordProbe()`.

- [x] **Step 1: Create the worker package**

Use workspace file dependencies for shared contracts and add only `undici` as runtime dependency. Build output is `worker/dist`.

- [x] **Step 2: Define non-secret config**

```ts
export interface WorkerConfig {
  workerId: string;
  controlPlaneUrl: string;
  heartbeatIntervalMs: 10000;
  claimIntervalMs: 5000;
  version: string;
}
```

Store under `~/Library/Application Support/BitbucketPRWorker/config.json` with mode `0600`. Do not store token or bearer credential in this file.

- [x] **Step 3: Implement the VPN state machine**

```ts
recordProbe(success: boolean, classification?: string): WorkerState;
```

Two consecutive failures enter `PAUSED_VPN`; two consecutive successes return `ONLINE`; transitions return an event exactly once. Backoff sequence is 5, 10, 20, 40, 60 seconds plus 0-20% jitter.

- [x] **Step 4: Implement the bounded outbox**

Persist sequence-numbered batches atomically. Retain newest 300 entries. Delete only through `acceptedThrough` acknowledgements.

- [x] **Step 5: Implement the main loop**

Heartbeat always runs when the control plane is reachable. Claiming occurs only in `ONLINE`. `PAUSED_VPN` probes Bitbucket but claims no work. `OFFLINE_CONTROL_PLANE` queues existing execution logs but starts no new execution.

- [x] **Step 6: Run standalone state/outbox smokes**

Expected evidence:

```json
{
  "states": ["ONLINE", "ONLINE", "PAUSED_VPN", "PAUSED_VPN", "ONLINE"],
  "pauseEvents": 1,
  "resumeEvents": 1,
  "outboxRetained": 300
}
```

- [x] **Step 7: Build the worker**

Run: `npm run build`

Expected: TypeScript exits 0 and no credential value appears in `dist` or config fixtures.

### Task 6: Keychain Identity and Encrypted Token Envelope

**Files:**
- Create: `bitbucket-pr-approver/worker/src/keychain.ts`
- Create: `bitbucket-pr-approver/worker/src/identity.ts`
- Modify: `bitbucket-pr-approver/worker/src/control-plane-client.ts`
- Modify: `bitbucket-pr-approver/backend/src/routes/workers.ts`
- Modify: `bitbucket-pr-approver/frontend/src/api/client.ts`

**Interfaces:**
- Produces: `KeychainStore`, RSA-OAEP public JWK registration, encrypted envelope claim/acknowledge.

- [x] **Step 1: Implement Keychain calls without shell interpolation**

Use `spawnFile('/usr/bin/security', args)` with stdin for secret values. Services:

```text
com.hungnv.bitbucket-pr-worker.identity
com.hungnv.bitbucket-pr-worker.credential
com.hungnv.bitbucket-pr-worker.bitbucket-token
```

Never place secrets in command arguments or output.

- [x] **Step 2: Generate and persist RSA-OAEP identity**

Generate 3072-bit RSA-OAEP SHA-256 keys. Store private JWK in Keychain and register public JWK during pairing.

- [x] **Step 3: Add browser envelope creation**

Import the worker public JWK with Web Crypto and encrypt UTF-8 token bytes using RSA-OAEP SHA-256. Send only base64url ciphertext plus envelope ID.

- [x] **Step 4: Add envelope claim and acknowledgement routes**

```text
POST /api/workers/:workerId/token-envelope
POST /api/workers/:workerId/token-envelope/claim
POST /api/workers/:workerId/token-envelope/:envelopeId/ack
```

Owner creates; worker claims/acks. Ack deletes ciphertext from control-plane storage.

- [x] **Step 5: Run a local encryption lifecycle smoke**

Use a synthetic token in a temporary Keychain service name. Verify ciphertext differs from plaintext, backend store contains ciphertext only, worker decrypts exact value, ack deletes envelope, and cleanup deletes the synthetic Keychain item.

- [x] **Step 6: Scan for secret persistence**

Run `rg -n "localStorage|sessionStorage|bitbucketToken|Authorization" frontend/src backend/src worker/src` and inspect every match. Expected: no browser storage and no log/persistence of raw values.

### Task 7: Worker Job Executor and Detailed Decisions

**Files:**
- Create: `bitbucket-pr-approver/shared-runtime/package.json`
- Move with compatibility exports: Bitbucket cloud client, matcher, and filter engine from backend into `shared-runtime/src`.
- Create: `bitbucket-pr-approver/worker/src/executor.ts`
- Modify: `bitbucket-pr-approver/backend/src/bitbucket/index.ts`
- Modify: `bitbucket-pr-approver/backend/src/engine/filter.ts`

**Interfaces:**
- Produces: `WorkerExecutor.execute(lease, credential): Promise<ExecutionResult>`.
- Logs every PR decision with both matched conditions and exact final failure reason.

- [x] **Step 1: Extract provider/filter runtime without behavior change**

Keep backend re-export paths stable so existing imports continue to compile. Shared runtime cannot depend on Fastify or backend storage.

- [x] **Step 2: Preserve full filter evaluation**

```ts
export interface RuleEvaluationResult {
  matched: boolean;
  wouldApprove: boolean;
  isAlreadyApproved: boolean;
  matchedConditions: string[];
  failureReason?: string;
}
```

Map legacy `reasons` to `matchedConditions` at compatibility boundaries.

- [x] **Step 3: Implement execution checkpoints**

Before each repository and before each approval, verify lease validity and VPN state. Stop with `RETRYABLE` on connectivity loss.

- [x] **Step 4: Enforce dry-run verification mode**

Worker `--verification-mode` rejects any lease with `dryRun=false`. Use this mode for all implementation smokes.

- [x] **Step 5: Run a dry-run/no-target end-to-end smoke**

Pair a temporary worker, assign a dry-run job with no repositories, claim it, complete it, and confirm one execution summary with zero PR activity and no provider write call.

- [x] **Step 6: Run existing backend tests, frontend tests, and all builds**

Run shared, shared-runtime, backend, worker, and frontend builds plus unchanged backend/frontend tests.

### Task 8: macOS LaunchAgent, Installer, and Signed Update Flow

**Files:**
- Create: `bitbucket-pr-approver/worker/install/macos/com.hungnv.bitbucket-pr-worker.plist.template`
- Create: `bitbucket-pr-approver/worker/install/macos/install.sh`
- Create: `bitbucket-pr-approver/worker/install/macos/uninstall.sh`
- Create: `bitbucket-pr-approver/worker/install/macos/register-url-handler.sh`
- Create: `bitbucket-pr-approver/worker/install/macos/package.sh`
- Create: `bitbucket-pr-approver/worker/src/updater.ts`
- Create: `bitbucket-pr-approver/backend/src/routes/worker-updates.ts`

**Interfaces:**
- Produces: installable development package, LaunchAgent label `com.hungnv.bitbucket-pr-worker`, signed update manifest contract.

- [x] **Step 1: Generate a least-privilege LaunchAgent**

Run at login, restart on failure, use explicit application paths, and write stdout/stderr under `~/Library/Logs/BitbucketPRWorker/`. Do not embed secrets in plist environment variables.

- [x] **Step 2: Implement idempotent install/uninstall**

Install creates directories with user-only permissions, copies runtime, loads LaunchAgent, and opens the pairing URL. Re-running upgrades files without creating duplicate agents. Uninstall unloads and removes files; Keychain deletion requires explicit `--delete-credentials`.

- [x] **Step 3: Register the custom URL scheme**

Package a minimal macOS app wrapper declaring `bitbucket-pr-worker` in `CFBundleURLTypes`; pass pairing URL contents to the worker bootstrap through a user-only temporary file and delete it after consumption.

- [x] **Step 4: Implement signed update manifests**

Manifest fields: version, minimum control-plane protocol, package URL, SHA-256, Ed25519 signature. Embed only the update verification public key in the worker.

- [x] **Step 5: Implement atomic update and rollback**

Download to a versioned staging directory, verify, switch a `current` symlink, restart LaunchAgent, and roll back if no healthy heartbeat arrives within 60 seconds.

- [x] **Step 6: Build and inspect a development package**

Expected: package contents include worker runtime/app/plist only; `pkgutil --payload-files` contains no config, token, bearer credential, private key, or user path.

- [ ] **Step 7: Verify lifecycle on macOS** — external gate: development package was built and inspected, but system installation/LaunchAgent restart/uninstall was not performed on the user's machine.

Install, confirm LaunchAgent running, terminate worker and confirm restart, run uninstall, and confirm files/agent removed while synthetic Keychain credentials remain unless explicitly deleted.

### Task 9: Worker Setup, Status, Job Assignment, and Logs UI

**Files:**
- Create: `bitbucket-pr-approver/frontend/src/components/WorkerSetup.tsx`
- Create: `bitbucket-pr-approver/frontend/src/components/WorkerStatus.tsx`
- Create: `bitbucket-pr-approver/frontend/src/components/WorkerExecutionLog.tsx`
- Modify: `bitbucket-pr-approver/frontend/src/App.tsx`
- Modify: `bitbucket-pr-approver/frontend/src/api/client.ts`
- Modify: `bitbucket-pr-approver/frontend/src/components/JobFormModal.tsx`
- Modify: `bitbucket-pr-approver/frontend/src/components/ActionLogTable.tsx`

**Interfaces:**
- Consumes: owner session, pairing, worker list, job assignment, execution-log APIs.
- Produces: end-user install/pair flow and live worker execution observability.

- [x] **Step 1: Add API client methods and typed error handling**

Add session login, create pairing, list/revoke worker, token envelope, worker logs, execution detail, installer metadata, and worker-mode manual run methods. Keep raw token parameters local to the encryption function.

- [x] **Step 2: Build the install/pair wizard**

States: detect macOS, download, await install, open custom URL, await heartbeat, encrypt token, ready. Show explicit recovery for expired pairing and unsupported platform.

- [x] **Step 3: Build worker status cards**

Display state, last heartbeat, version, active job, VPN status, and actions. `PAUSED_VPN` uses warning styling and text `Jobs paused until the workstation VPN or IP allowlist route recovers`.

- [x] **Step 4: Add job execution mode and worker assignment**

New jobs default to local mode until at least one online worker exists. Worker mode requires a selected worker. Migration is an explicit user action and preserves all rules.

- [x] **Step 5: Build execution and item log views**

Show summaries and expandable per-PR rows. Render matched conditions and failure reason separately. Provide filters for worker, job, execution, status, repository, and text. Show `Showing the newest 300 worker events`.

- [x] **Step 6: Integrate SSE updates**

Add `worker_status_changed`, `worker_log_batch`, and `execution_completed`. Merge by stable log ID and cap client state at 300 per active worker.

- [x] **Step 7: Verify responsive/accessibility behavior**

Browser-check 375, 768, 1024, and 1440px; keyboard-only pairing and log filtering; focus visibility; no horizontal overflow; reduced motion; and complete icon labels.

- [x] **Step 8: Run unchanged frontend tests and build**

Run: `npm test && npm run build`

Expected: 47 tests pass and production build exits 0.

### Task 10: Compatibility Migration, Documentation, and Final Verification

**Files:**
- Modify: `bitbucket-pr-approver/docs/api-contracts.md`
- Modify: `bitbucket-pr-approver/docs/security-model.md`
- Modify: `bitbucket-pr-approver/docs/job-schema.md`
- Modify: `bitbucket-pr-approver/ARCHITECTURE.md`
- Modify: `bitbucket-pr-approver/README.md`
- Modify: `/Users/hungnv/DigifactoryBTM/CHANGELOG.md`
- Append once: `.agents/skills/hungnv-continuous-learning/references/prompt-history.md`
- Append once: `.agents/skills/hungnv-continuous-learning/references/lessons.md`

**Interfaces:**
- Confirms the complete spec and preserves existing local operation.

- [x] **Step 1: Add startup migration defaults**

Jobs without `executionMode` become local in memory and are persisted with `executionMode: "local"` only on their next user-authorized save. Existing token/config files are untouched.

- [x] **Step 2: Document deployment and trust boundaries**

Document owner login, HTTPS reverse proxy, worker install/pair, Keychain storage, worker revocation, VPN states, 300-log retention, update signing, uninstall, and recovery.

- [x] **Step 3: Run the complete unchanged verification matrix**

Run:

```text
shared build
shared-runtime build
backend 69-test suite and build
worker build and state/outbox smokes
frontend 47-test suite and build
```

- [x] **Step 4: Run a local-mode regression smoke**

Use a disposable no-target dry-run local job. Verify Run Now 200, completion timestamp, cleanup, and original job count unchanged.

- [x] **Step 5: Run the worker-mode end-to-end smoke**

Use a disposable temporary data directory and synthetic credential. Verify pair, heartbeat, dry-run claim, execution logs, completion, 300 retention, VPN pause, no claim during pause, two-success resume, no catch-up burst, worker revocation, and cleanup. Do not call the approval endpoint.

- [x] **Step 6: Inspect security-sensitive outputs**

Scan source, built bundles, JSON stores, plist, package payload, logs, process arguments, and learning records for the synthetic token, bearer credential, private key, and authorization headers. Expected: zero plaintext matches after cleanup.

- [x] **Step 7: Update learning records exactly once**

Record sanitized result, changed files, verification evidence, residual production signing/deployment gates, and a durable lesson about outbound workers, lease idempotency, and transition-based VPN logs. Never include credentials.

- [x] **Step 8: Report residual gates honestly**

Separate local verified behavior from production-only requirements: public HTTPS deployment, owner credential provisioning, Apple Developer ID signing/notarization, and real corporate VPN/IP-allowlist validation.
