# REST API & SSE Contracts Specification (Bitbucket Cloud-Only Standard)

All API endpoints are served from the Fastify local backend on `http://127.0.0.1:3100` and prefixed with `/api`.

---

## 1. Response Envelope Format & Strict Zero-Mock Policy

### 🚨 Strict Zero-Mock Runtime Policy
Under NO circumstances does the backend return simulated, synthetic, or mock data in runtime. All responses are derived directly from **Bitbucket Cloud REST API v2.0** (`https://api.bitbucket.org/2.0`). If authentication fails, rate limits occur, or the network is offline, the backend returns a structured error envelope.

```typescript
// Success Response
{
  "success": true,
  "data": { ... }
}

// Error Response
{
  "success": false,
  "error": {
    "code": "AUTH_INVALID_TOKEN" | "RATE_LIMITED" | "NETWORK_OFFLINE" | "WORKSPACE_NOT_FOUND" | "INSUFFICIENT_SCOPES" | "GENERIC_API_ERROR",
    "message": "Failed to authenticate with Bitbucket Cloud. Invalid App Password (HTTP 401).",
    "httpStatus": 401,
    "rateLimitReset": null,
    "details": { ... }
  }
}
```

---

## 2. Endpoints Specification

### 2.1. System & Health

#### `GET /api/health`
- **Purpose**: Quick ping to confirm server is up and verify internet route to `api.bitbucket.org`.
- **Response**:
  ```json
  {
    "success": true,
    "data": {
      "status": "OK",
      "uptimeSeconds": 1420,
      "cloudReachable": true,
      "serverTime": "2026-03-22T10:00:00.000Z"
    }
  }
  ```

#### `GET /api/status`
- **Purpose**: Aggregate statistics for the dashboard.
- **Response**:
  ```json
  {
    "success": true,
    "data": {
      "isRunning": true,
      "activeJobsCount": 2,
      "totalJobsCount": 3,
      "lastExecutionAt": "2026-03-22T09:59:30.000Z",
      "vpnConnected": true,
      "bitbucketStatus": "CONNECTED",
      "totalApprovedCount": 18,
      "uptimeSeconds": 3600
    }
  }
  ```

---

### 2.2. Configuration & Authentication (Bitbucket Cloud)

#### `GET /api/config`
- **Purpose**: Retrieve saved connection settings. **Never returns raw token**.
- **Response**:
  ```json
  {
    "success": true,
    "data": {
      "serverType": "cloud",
      "baseUrl": "https://api.bitbucket.org/2.0",
      "authType": "basic",
      "username": "alexchen@company.com",
      "workspace": "acme-corp",
      "hasToken": true,
      "tokenPreview": "••••••••abcd",
      "skipSslVerification": false,
      "proxyUrl": null,
      "timeoutMs": 15000
    }
  }
  ```

#### `POST /api/config`
- **Purpose**: Save connection settings and securely encrypt the Bitbucket Cloud App Password.
- **Request Body**:
  ```json
  {
    "serverType": "cloud",
    "baseUrl": "https://api.bitbucket.org/2.0",
    "authType": "basic",
    "token": "wY9Xp8...AppPassword...",
    "username": "alexchen@company.com",
    "workspace": "acme-corp",
    "proxyUrl": null,
    "timeoutMs": 15000
  }
  ```
- **Response**: Masked configuration object.

#### `POST /api/config/test`
- **Purpose**: Test credentials or restore a browser session by executing a live handshake against `GET /2.0/user` and `GET /2.0/user/workspaces` on Bitbucket Cloud. When the request omits `token`, the backend uses the encrypted credential already stored on the local machine. Never returns mock data or the raw token.
- **Request Body**: (Same as `POST /api/config`, or `{}` to test currently saved credentials)
- **Response**:
  ```json
  {
    "success": true,
    "data": {
      "valid": true,
      "user": {
        "username": "alexchen",
        "displayName": "Alex Chen",
        "avatarUrl": "https://secure.gravatar.com/avatar/...",
        "serverType": "cloud",
        "isAvailable": true,
        "vpnConnected": true,
        "verifiedAt": "2026-03-22T10:00:00.000Z",
        "serverEdition": "Bitbucket Cloud (REST v2.0)",
        "latencyMs": 115,
        "accountId": "557058:3a1b2c3d",
        "selectedWorkspace": "acme-corp",
        "workspaces": [
          {
            "slug": "acme-corp",
            "name": "Acme Corporation",
            "uuid": "{5b060d4a-3829-43c2-8418-86d11a681d65}",
            "avatarUrl": "https://bitbucket.org/workspaces/acme-corp/avatar"
          }
        ]
      }
    }
  }
  ```

---

### 2.3. Job Management

#### `GET /api/jobs`
- **Purpose**: List all configured approval jobs.
- **Response**:
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "e9b1d283-8472-4e31-9c60-a298a0b016e4",
        "name": "Auto Approve Feature PRs",
        "description": "Approves all team PRs into develop",
        "enabled": true,
        "intervalSeconds": 60,
        "dryRun": false,
        "rules": {
          "repositories": ["CORE/*"],
          "authorWhitelist": ["developer-alex", "sarahc"],
          "authorBlacklist": [],
          "excludeSelf": true,
          "targetBranches": ["develop", "release/*"],
          "sourceBranches": ["feature/*"],
          "ignoreDrafts": true,
          "ignoreWithConflicts": true
        },
        "lastRunAt": "2026-03-22T09:59:00Z",
        "nextRunAt": "2026-03-22T10:00:00Z",
        "createdAt": "2026-03-22T08:00:00Z",
        "updatedAt": "2026-03-22T08:00:00Z"
      }
    ]
  }
  ```

#### `POST /api/jobs`
- **Request Body**: `CreateJobDto`
- **Response**: Created `ApprovalJob`.

#### `PUT /api/jobs/:id`
- **Request Body**: `UpdateJobDto`
- **Response**: Updated `ApprovalJob`.

#### `DELETE /api/jobs/:id`
- **Response**: `{ "success": true }`

#### `POST /api/jobs/:id/toggle`
- **Request Body**: Optional `{ "enabled": boolean }`. When omitted, the backend inverts the current state.
- **Response**: Updated job.

#### `POST /api/jobs/:id/run-now`
- **Purpose**: Manually trigger an immediate execution cycle.
- **Request Body**: None. Clients must not send `Content-Type: application/json` when no JSON body is present.
- **Response**: `{ "success": true, "message": "Job execution triggered" }`

---

### 2.4. Rule Preview & Dry-Run

#### `POST /api/prs/preview`
- **Purpose**: Test a rule set against actual open pull requests currently in Bitbucket without modifying anything.
- **Request Body**:
  ```json
  {
    "rules": {
      "repositories": ["CORE/backend-api"],
      "authorWhitelist": ["developer-alex"],
      "excludeSelf": true,
      "targetBranches": ["develop"],
      "ignoreDrafts": true,
      "ignoreWithConflicts": true
    }
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "data": {
      "totalScanned": 5,
      "totalMatched": 2,
      "results": [
        {
          "pr": { "id": 142, "title": "feat(core): cache layer", ... },
          "matched": true,
          "reasons": ["Matched author 'developer-alex'", "Matched target branch 'develop'"],
          "wouldApprove": true
        },
        {
          "pr": { "id": 143, "title": "wip: test", ... },
          "matched": false,
          "reasons": ["Author 'intern' not in whitelist"],
          "wouldApprove": false
        }
      ]
    }
  }
  ```

---

### 2.5. Logs & History

#### `GET /api/logs`
- **Query Params**:
  - `page`: number (default: 1)
  - `limit`: number (default: 20, max: 100)
  - `jobId`: string (optional)
  - `status`: string (`APPROVED` | `DRY_RUN` | `SKIPPED` | `FAILED`)
  - `repo`: string (optional)
- **Response**:
  ```json
  {
    "success": true,
    "data": {
      "items": [
        {
          "id": "6724b1a0-9c12-4211-884b-0129fca88921",
          "jobId": "e9b1d283-8472-4e31-9c60-a298a0b016e4",
          "jobName": "Auto Approve Feature PRs",
          "prId": 142,
          "prTitle": "feat(core): cache layer",
          "prUrl": "https://bitbucket.internal.company.com/projects/CORE/repos/backend-api/pull-requests/142",
          "repository": "CORE/backend-api",
          "author": "developer-alex",
          "sourceBranch": "feature/cache",
          "targetBranch": "develop",
          "status": "APPROVED",
          "reason": "Matched all rules",
          "dryRun": false,
          "timestamp": "2026-03-22T09:59:02Z",
          "durationMs": 138
        }
      ],
      "total": 120,
      "page": 1,
      "limit": 20,
      "totalPages": 6
    }
  }
  ```

#### `DELETE /api/logs`
- **Purpose**: Purge log entries.

---

### 2.6. Real-Time Streaming: Server-Sent Events (SSE)

#### `GET /api/events`
- **Headers**:
  ```http
  Accept: text/event-stream
  Cache-Control: no-cache
  Connection: keep-alive
  ```
- **Event Stream Payload Format**:
  ```http
  event: message
  data: {"type":"pr_approved","timestamp":"2026-03-22T10:15:02.000Z","data":{"jobId":"...","prId":142,"title":"feat(core): cache layer","author":"developer-alex"}}

  event: message
  data: {"type":"job_completed","timestamp":"2026-03-22T10:15:05.000Z","data":{"jobId":"...","scanned":3,"approved":1}}
  ```
- **Supported Event Types**:
  - `job_started`: Background cycle triggered for a job
  - `job_completed`: Cycle finished
  - `pr_evaluated`: Individual PR assessed by filter engine
  - `pr_approved`: PR successfully approved via API
  - `status_changed`: VPN status, active job count, or connection state changed
  - `error`: Network or authentication failure


---

### 2.7. Bitbucket Metadata & Autocomplete Endpoints (Bitbucket Cloud)

See full specification in [`docs/metadata-api-specs.md`](./metadata-api-specs.md).

#### `GET /api/bitbucket/workspaces`
- **Query Params**: None
- **Response**: Array of workspaces accessible by the user with slug, name, uuid, avatarUrl.

#### `GET /api/bitbucket/repositories`
- **Query Params**: `workspace` (string), `query` (string), `limit` (number, default 25)
- **Workspace resolution**: Explicit query workspace, then stored active workspace, then the first accessible `/2.0/user/workspaces` result. Account username/email is not a valid fallback.
- **Response**: Array of repositories with slug, name, fullName, isPrivate, defaultBranch, description.

#### `GET /api/bitbucket/branches`
- **Query Params**: `repository` (string, required), `query` (string), `limit` (number, default 50)
- **Response**: Array of branches with name, displayId, isDefault, latestCommit, type.

#### `GET /api/bitbucket/users`
- **Query Params**: `workspace` (string), `query` (string), `limit` (number, default 25)
- **Response**: Array of workspace members with username, displayName, accountId, avatarUrl, active.
- **Search behavior**: Membership pages come from Bitbucket unchanged; the backend applies `query` locally because nested member display fields are not filterable upstream.

### 2.8. Local Worker Control Plane

```text
POST /api/session/login
POST /api/session/logout
GET  /api/session
POST /api/workers/pairing-sessions
POST /api/workers/pair
GET  /api/workers
POST /api/workers/:workerId/heartbeat
POST /api/workers/:workerId/revoke
POST /api/workers/:workerId/migrate-local-token
POST /api/workers/:workerId/token-envelope
POST /api/workers/:workerId/token-envelope/claim
POST /api/workers/:workerId/token-envelope/:envelopeId/ack
POST /api/workers/:workerId/claims
POST /api/workers/:workerId/executions/:executionId/renew
POST /api/workers/:workerId/executions/:executionId/logs
POST /api/workers/:workerId/executions/:executionId/complete
GET  /api/worker-logs
GET  /api/worker-installer/manifest
GET  /api/worker-installer/macos
POST /api/worker-installer/terminal-run
GET  /api/workers/:workerId/update-manifest
```

`POST /api/worker-installer/terminal-run` is loopback-only and accepts a same-control-plane, unexpired `pairUrl`. The local backend writes an executable `.command`, bundled Node runtime, Worker bundle, and native Keychain helper under the user's Application Support directory, then opens Terminal. A mode-0600 transient file contains the one-use pairing URL and is deleted immediately after pairing. No Bitbucket token or Worker bearer credential is written into the launcher. Later launches reuse Keychain/config state and keep the Worker in the foreground until Terminal closes.

Log batches contain at most 50 entries and use monotonically increasing sequence numbers. Replays are idempotent, gaps return 409, and retention is the newest 300 entries per Worker.
