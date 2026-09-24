# Local Worker and Control Plane Design

## 1. Purpose

Move Bitbucket execution from the web server to a user-installed local worker so approval jobs always use the user's workstation network path, corporate VPN, and Atlassian IP allowlist. The user configures jobs in the web UI, approves one macOS installation, and does not perform manual worker, scheduler, token-storage, or reconnect configuration afterward.

The first supported platform is macOS. The protocol and data model must remain portable to Windows, but Windows packaging is outside the first implementation.

## 2. Goals

- Keep job authoring, status, and logs in the web control plane.
- Execute Bitbucket reads and approvals only in the paired local worker.
- Never store the raw Bitbucket token in browser storage or control-plane persistence.
- Install the worker once and run it automatically through a macOS LaunchAgent.
- Detect VPN or IP-allowlist loss, pause execution without log spam, and resume automatically after connectivity returns.
- Store and display detailed execution logs while retaining only the newest 300 log entries per worker.
- Avoid duplicate approval when workers reconnect, retry, or receive the same execution more than once.
- Preserve the existing local-only application mode during migration.

## 3. Non-goals

- Installing or configuring the corporate VPN itself.
- Bypassing Atlassian IP allowlists.
- Running jobs inside a closed browser tab.
- Supporting multiple simultaneously active workers for one job in the first version.
- Multi-tenant organizations, role hierarchies, or cross-customer worker sharing in the first version.
- Windows installer, Linux service manager, mobile worker, or browser extension in the first version.
- A real Bitbucket approval during automated verification.

## 4. High-level Architecture

### 4.1. Control Plane

The existing Fastify backend becomes the control plane. It owns:

- Job definitions and schedules.
- Worker registration, pairing sessions, heartbeat state, and capability metadata.
- Execution leases and idempotency identifiers.
- The newest 300 worker log entries.
- SSE updates to the React dashboard.
- Installer bootstrap metadata.

The control plane does not call Bitbucket for worker-managed jobs and does not persist plaintext Bitbucket credentials.

### 4.2. Local Worker

A new Node.js worker package runs as a macOS LaunchAgent. It owns:

- Bitbucket credential storage through macOS Keychain.
- The Bitbucket Cloud client and rule-filter engine.
- VPN/IP-allowlist reachability checks.
- Pull-based job claiming and execution.
- A bounded local outbox for logs and acknowledgements while offline.
- Automatic reconnect with exponential backoff and jitter.

The worker uses outbound HTTPS only. It never opens a public listening port.

### 4.3. Web UI

The React UI gains:

- Install Local Worker call-to-action and macOS detection.
- One-time pairing screen and progress states.
- Worker status: `ONLINE`, `PAUSED_VPN`, `OFFLINE`, `UPDATING`, `ERROR`.
- Last heartbeat, version, host label, and active job count.
- Per-run and per-item logs with filters and details.
- Clear explanation when jobs are paused because the worker or VPN is unavailable.

### 4.4. Control-plane Access

The first remote deployment is single-tenant with one owner account. The deployment operator configures the public HTTPS URL and a bootstrap owner credential; end users do not configure worker endpoints or secrets.

- Browser authentication uses an HttpOnly, Secure, SameSite session cookie.
- Pair confirmation, worker administration, token handoff, and job mutation require the owner session plus CSRF protection.
- Worker bearer credentials are separate from browser sessions and scoped to one worker ID.
- The reverse proxy terminates TLS; production mode refuses pairing and worker traffic over plain HTTP.
- Multi-user roles can be added later without changing the worker protocol because every worker and job already carries an owner scope.

## 5. Pairing and Credential Transfer

### 5.1. Pairing Session

1. The authenticated web UI requests a one-time pairing session from the control plane.
2. The user installs the generic signed worker package and approves the macOS installer prompt.
3. The web UI opens `bitbucket-pr-worker://pair` with the control-plane HTTPS URL and one-time pairing code; the custom URL contains no Bitbucket token.
4. The worker generates an RSA-OAEP key pair, stores the private key in macOS Keychain, and registers its public key using the pairing code.
5. The control plane associates the worker public key with the user's workspace, marks the code consumed, and the web UI observes the first heartbeat.

Pairing codes expire after ten minutes, are single-use, and are stored as hashes.

### 5.2. Bitbucket Token

1. The user enters the Bitbucket token in the web UI.
2. Browser Web Crypto encrypts the token with the paired worker's public key.
3. The control plane relays and temporarily persists only the encrypted envelope.
4. The worker claims the envelope, decrypts it locally, and stores the token in macOS Keychain.
5. The worker acknowledges receipt; the control plane deletes the envelope.

The browser never writes the token to `localStorage`, `sessionStorage`, cookies, IndexedDB, or logs. The control plane never receives the worker private key or plaintext token.

## 6. Worker Protocol

All requests use TLS and a worker-scoped bearer credential created during pairing. The first implementation uses short polling to reduce infrastructure requirements; the protocol can later move to WebSocket without changing domain objects.

### 6.1. Heartbeat

`POST /api/workers/:workerId/heartbeat` every ten seconds:

- Worker version and platform.
- Connectivity state.
- Active execution ID, if any.
- Queue depth and last successful Bitbucket probe.

The control plane marks a worker `OFFLINE` after 35 seconds without heartbeat.

### 6.2. Claim Work

`POST /api/workers/:workerId/claims` returns at most one execution lease:

- `executionId` and idempotency key.
- Job snapshot and revision.
- Lease expiry.
- Control-plane timestamp.

The lease is renewed during execution. An expired lease can be reclaimed, but an idempotency key can reach terminal state only once.

### 6.3. Submit Results

The worker sends logs in batches of at most 50:

- `POST /api/workers/:workerId/executions/:executionId/logs`
- `POST /api/workers/:workerId/executions/:executionId/complete`

Every batch has a monotonically increasing sequence number. Replayed batches are accepted idempotently.

## 7. VPN Pause and Automatic Resume

### 7.1. Connectivity State Machine

The worker state transitions are:

- `STARTING` → test control plane and Bitbucket.
- `ONLINE` → claim and execute work.
- `PAUSED_VPN` → Bitbucket returns a network error or IP-allowlist denial.
- `OFFLINE_CONTROL_PLANE` → Bitbucket may be reachable, but the worker cannot reach the control plane.
- `ONLINE` → probes recover and normal scheduling resumes.
- `ERROR` → non-recoverable local configuration or Keychain failure.

### 7.2. Pause Rules

- Classify DNS, timeout, connection refusal, and configured allowlist responses as connectivity failures.
- Require two consecutive failed probes before entering `PAUSED_VPN` to avoid transient flapping.
- Stop claiming work immediately while paused.
- If a failure occurs mid-run, stop before the next repository or approval action and release the execution as retryable.
- Emit one `PAUSED_VPN` log per transition, not every polling interval.

### 7.3. Resume Rules

- Probe with exponential backoff capped at 60 seconds.
- Require two consecutive successful probes before returning to `ONLINE`.
- Emit one `RESUMED` log.
- Resume on the next scheduler cycle. Do not replay every missed 15-second interval.
- Reclaimed executions reuse their original idempotency key so already-completed approvals are not repeated.

## 8. Scheduling

The control plane calculates due jobs and creates execution leases. It does not execute Bitbucket work.

- A 15-second job becomes eligible every 15 seconds while its worker is online.
- Only one active execution is allowed per job.
- When a worker is paused or offline, due occurrences collapse into one next execution instead of accumulating.
- A manual Run Now creates a high-priority lease but still requires an online worker.
- Jobs keep an immutable snapshot revision inside each execution so logs reflect the actual rules used.

## 9. Logging and Retention

### 9.1. Log Model

Each execution has one summary and multiple item logs.

Execution summary fields:

- `executionId`, `jobId`, job revision, worker ID.
- Trigger: `SCHEDULED`, `MANUAL`, or `RESUMED`.
- Start/end timestamps and duration.
- Counts for repositories, PRs scanned, matched, approved, skipped, failed, and already approved.
- Terminal status.

Item log fields:

- Repository, PR number, title, author, source and target branches.
- Status: `APPROVED`, `SKIPPED`, `DRY_RUN`, `ALREADY_APPROVED`, `FAILED`, `PAUSED_VPN`, or `RESUMED`.
- Complete filter decision, including both matched conditions and the final failure reason.
- Safe provider error code and retry metadata.
- Sequence number and timestamps.

Tokens, authorization headers, cookies, private keys, encrypted credential payloads, and connection strings are always redacted.

### 9.2. Retention

- Keep the newest 300 item logs per worker.
- Keep execution summaries referenced by those entries.
- Delete oldest entries transactionally after every inserted batch.
- Keep a local worker outbox of at most 300 unsent entries using the same FIFO policy.
- UI pagination operates over the retained set and defaults to 50 rows.

### 9.3. UI

- Live stream of new logs through SSE.
- Filters for worker, job, execution, status, repository, and free text.
- Expand an execution to view each repository and PR decision.
- Show exact failure reason for skipped PRs.
- Display retained count and the message `Showing the newest 300 worker events`.

## 10. Persistence

Introduce versioned JSON stores initially, preserving the lightweight deployment model:

- `workers.json`
- `pairing-sessions.json`
- `execution-leases.json`
- `worker-logs.json`

Writes remain atomic. Each store has a schema version and startup migration. A later database migration can preserve the protocol and domain types.

## 11. Installer and Lifecycle

The macOS installer contains:

- Bundled Node worker runtime.
- Worker binary and default configuration.
- LaunchAgent plist with restart-on-failure.
- Pairing bootstrap application/script.
- Uninstaller that removes the LaunchAgent and application files, with a separate explicit option to delete Keychain credentials.

Installation is signed and notarized for production distribution. Development verification can use an unsigned local package, clearly labelled non-production.

The worker checks a signed update manifest daily. It downloads a versioned package, verifies its signature and checksum, performs an atomic replacement, restarts through LaunchAgent, and rolls back if the new process does not produce a healthy heartbeat within 60 seconds. Automatic updates are enabled by default and can be paused by the control-plane owner. Unsigned development builds disable auto-update.

## 12. Migration and Compatibility

- Preserve `local` execution mode for the current single-machine application.
- Add `executionMode: "local" | "worker"` to jobs; existing jobs default to `local`.
- A worker-managed job requires `workerId`.
- UI offers an explicit migration action after a worker is paired.
- No existing job is moved automatically.
- The existing encrypted backend token remains for local-mode jobs and is never copied to the worker without explicit user confirmation.

## 13. Error Handling

- Pairing expiry: generate a new code without creating duplicate workers.
- Worker offline: queue one future execution and show an actionable status.
- Token rejected: mark worker `ERROR_AUTH`, pause jobs, and request a new encrypted token envelope.
- VPN unavailable: use `PAUSED_VPN`, not `FAILED`.
- Control plane unavailable: queue logs locally and retry; do not approve new work without a valid lease.
- Invalid or replayed log batch: acknowledge the last accepted sequence and request resend from the next sequence.

## 14. Verification Strategy

Do not call real approval endpoints during automated verification.

- Unit-check state transitions, lease expiry, idempotency, batch sequencing, and 300-entry retention.
- Integration-check pairing expiry, worker authentication, encrypted envelope lifecycle, job claim/complete, and reconnect replay.
- Use a dry-run/no-target job for end-to-end smoke.
- Simulate Bitbucket timeout/403 to verify `PAUSED_VPN`, no additional claims, one pause log, two-success recovery, `RESUMED`, and no catch-up burst.
- Verify installer output, LaunchAgent loading, restart after process kill, and uninstall cleanup on macOS.
- Verify UI worker status, detailed logs, filtering, and accessibility without modifying existing tests unless explicitly requested.

## 15. Delivery Phases

### Phase 1: Protocol and State Machine

Single-tenant control-plane authentication, shared worker types, versioned persistence, pairing/heartbeat/claim/log endpoints, execution lease scheduler, VPN state machine, and 300-entry retention.

### Phase 2: Local Worker

Worker runtime, Keychain adapter, encrypted token receipt, Bitbucket execution, local outbox, reconnect, pause/resume, and safe dry-run smoke.

### Phase 3: macOS Installation

LaunchAgent generation, install/uninstall scripts, pairing bootstrap, signed update manifest support, atomic update/rollback, installer packaging, and lifecycle verification.

### Phase 4: Web Experience

Install/pair wizard, worker status and heartbeat, job assignment, manual Run Now dispatch, execution detail logs, filters, and migration from local jobs.

## 16. Acceptance Criteria

- A user installs once, confirms pairing, enters a token once, and performs no worker configuration.
- Closing the browser does not stop job execution.
- A paired worker runs a 15-second dry-run job while online.
- VPN loss pauses the job and produces exactly one transition log.
- VPN recovery resumes future cycles without replaying missed intervals.
- No raw token exists in the browser or control plane.
- Each run exposes per-PR matched and failed conditions.
- The control plane and local outbox retain no more than 300 item logs per worker.
- Existing local-mode jobs continue to work until explicitly migrated.
- Remote pairing and worker traffic require authenticated HTTPS control-plane access.
- A healthy production worker can install a signed update and roll back automatically after a failed heartbeat.
