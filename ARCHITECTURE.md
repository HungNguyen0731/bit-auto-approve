# Architecture & System Design Specification
## Local Lightweight Bitbucket PR Auto-Approver

### Control Plane + Local Worker Extension

```text
Browser -> HTTPS Control Plane -> execution lease
                                  ^            |
                                  | heartbeat  v
                             Local Worker -> Bitbucket Cloud via workstation VPN
```

The existing loopback backend remains the `local` execution engine. Worker-mode jobs use an outbound-only macOS process with Keychain credentials, VPN state, offline outbox, and signed bundle updates. The Control Plane owns schedules, pairing, idempotent leases, and a 300-entry per-Worker log window. Two failed probes pause claims; two successful probes resume future cycles without replaying missed intervals.

---

## 1. Executive Summary & Objective

In corporate and enterprise environments, code repositories hosted on **Atlassian Bitbucket Data Center / Server** (or restricted Bitbucket Cloud workspaces) are strictly locked down behind corporate VPNs, internal VPCs, or rigorous IP Whitelists. 

Cloud-based automation services (like public GitHub Actions, Zapier, or SaaS webhook receivers) cannot reach these internal repositories without complex, costly, and security-compromising infrastructure (e.g. opening inbound firewall ports, setting up reverse proxy tunnels, or dedicated AWS DirectConnect/Azure ExpressRoute connections).

**Bitbucket PR Auto-Approver** solves this problem by running **locally on the engineer's workstation**. Because the developer is already connected to the corporate VPN (e.g., Cisco AnyConnect, FortiClient, WireGuard, Tailscale) or within the whitelisted office IP range, the local app automatically and securely inherits this network access.

### Core Architecture Pillars:
1. **Ultra-Lightweight & Fast**: Built with **Node.js + Fastify** on the backend and **React 19/18 + Vite + Tailwind CSS** on the frontend. Startup time is under 400ms, and total idle memory usage stays below 35–45 MB RAM.
2. **Dual Bitbucket Support**: First-class support for both **Bitbucket Server / Data Center (REST API v1.0)** and **Bitbucket Cloud (REST API v2.0)** with unified model normalization.
3. **Security-First At-Rest Encryption**: Tokens (Personal Access Tokens / App Passwords) are encrypted using **AES-256-GCM** before touching the disk. Plaintext secrets are never stored and never returned to the frontend.
4. **Local VPN & Corporate Network Harmony**: Works transparently with split-tunnel VPNs, corporate HTTP/HTTPS forward proxies, and internal enterprise Root CAs / self-signed SSL certificates.
5. **Intelligent Rule Filtering Engine**: Granular filtering on repository, author whitelists, source/target branch glob/regex matching, draft PR skipping, merge conflict checking, and idempotency caching.
6. **Background Scheduler Runner**: Flexible cron/interval background worker with dry-run simulation mode and real-time streaming logs via Server-Sent Events (SSE).

---

## 2. System Architecture Diagram

```
+-----------------------------------------------------------------------------------------+
|                                DEVELOPER WORKSTATION                                    |
|                                                                                         |
|  +-----------------------------------------------------------------------------------+  |
|  |                     Web Browser (http://127.0.0.1:3100)                           |  |
|  |   - React + Vite + Tailwind CSS Single Page Application                           |  |
|  |   - Token Management, Job Rule Builder, Live Execution Monitor, Dry-run Preview   |  |
|  +------------------------------------------^----------------------------------------+  |
|                                             | REST API / SSE                               |
|  +------------------------------------------v----------------------------------------+  |
|  |                       Node.js + Fastify Local Backend Server                      |  |
|  |                                                                                   |  |
|  |   [ HTTP REST API & SSE Gateway ]                                                 |  |
|  |      ├── /api/auth/verify-token       ├── /api/jobs                               |  |
|  |      ├── /api/config                  ├── /api/logs                               |  |
|  |      └── /api/events (SSE Stream)     └── /api/prs/preview                        |  |
|  |                                                                                   |  |
|  |   [ Security & Crypto Service ]       [ Rule Filtering Engine ]                   |  |
|  |      - AES-256-GCM Token Encryption      - Author Whitelist / Self-Exclude        |  |
|  |      - Redaction & Log Masking           - Branch Glob / Regex Matching           |  |
|  |                                          - Draft & Conflict Guards                |  |
|  |                                                                                   |  |
|  |   [ Scheduler Runner Service ]        [ Persistence Store (JSON/SQLite) ]         |  |
|  |      - Interval / Cron Timer Loops       - config.json (Encrypted Secrets)        |  |
|  |      - Idempotency & Approve Cache       - jobs.json (Rule Sets)                  |  |
|  |      - Concurrency & Error Throttling    - logs.json (Approval History)           |  |
|  |                                                                                   |  |
|  |   [ Unified Bitbucket Client Adapter ]                                            |  |
|  |      ├── BitbucketServerClient (REST API v1.0)                                    |  |
|  |      └── BitbucketCloudClient  (REST API v2.0)                                    |  |
|  |      └── Undici / HTTP Dispatcher (Proxy, Corporate CA SSL, Timeout, Keep-Alive)  |  |
|  +------------------------------------------^----------------------------------------+  |
|                                             |                                           |
|                                      OS Network Stack                                   |
|                          (VPN Adapter / Split-Tunnel Routing)                           |
+---------------------------------------------|-------------------------------------------+
                                              |
                     Corporate VPN Tunnel / IP Whitelisted Route
                                              |
                                              v
           +-------------------------------------------------------------+
           |          ENTERPRISE INFRASTRUCTURE / CLOUD WORKSPACE        |
           |                                                             |
           |   [ Bitbucket Data Center / Server (v1.0) ]                 |
           |     https://bitbucket.internal.company.com/rest/api/1.0      |
           |                                                             |
           |   [ Bitbucket Cloud (v2.0) - IP Whitelisted ]               |
           |     https://api.bitbucket.org/2.0                           |
           +-------------------------------------------------------------+
```

---

## 3. Technology Stack Selection & Rationale

| Layer | Selected Technology | Why Selected & Performance Rationale |
|---|---|---|
| **Backend Runtime** | Node.js (>= 20 LTS / 24) | Native ESM, built-in `fetch` with `undici` for high-throughput HTTP connections, zero runtime dependencies. |
| **Web Framework** | Fastify v5 | Up to 2x faster than Express; low overhead (<10MB base memory); built-in schema compilation (`fast-json-stringify` & `Ajv`); native plugin architecture. |
| **Data Persistence** | Lightweight JSON File Store / Lowdb with Atomic File Write | Zero C++ compile dependencies (avoids node-gyp issues on developer machines across macOS/Linux/Windows); atomic `rename` writes prevent corruption; instant startup; human-auditable backup. |
| **Frontend Framework** | React 19 / 18 + Vite | Lightning-fast HMR (<50ms); optimized production bundle (<150KB gzip); clean declarative component model. |
| **Styling** | Tailwind CSS v4 / v3 | Utility-first CSS; zero runtime JS overhead; responsive and clean modern UI theme. |
| **Realtime Sync** | Server-Sent Events (SSE) | Native browser `EventSource`, unidirectional backend-to-frontend streaming, simpler and lighter than WebSockets, automatic reconnection. |
| **Cryptography** | Node.js `node:crypto` | Native hardware-accelerated AES-256-GCM cipher and PBKDF2/scrypt key derivation. No external crypto libraries required. |

---

## 4. Local-First & VPN / Corporate Network Model

### 4.1. Network Inheritance via Local Loopback
- The backend server binds **exclusively to `127.0.0.1`** (port `3100` by default). It is never exposed to the local area network (LAN) unless explicitly overridden by the developer.
- All outbound requests to Bitbucket are initiated from the developer's operating system network stack. When the developer activates their corporate VPN client (Cisco AnyConnect, FortiClient, GlobalProtect, OpenVPN, Tailscale):
  1. The OS routing table routes traffic designated for the corporate Bitbucket domain or CIDR block through the virtual tunnel interface (`utun*` or `tun0`).
  2. The corporate gateway verifies the client's VPN certificate and assigns an internal enterprise IP address.
  3. Bitbucket sees the incoming request as originating from a trusted, whitelisted enterprise IP address.

### 4.2. Corporate Proxy & Custom CA Support
In many enterprise environments, outbound traffic must traverse an authenticating corporate proxy or internal SSL inspection proxy:
- **Proxy Configuration**: Supports `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` environment variables, or a dedicated UI field `proxyUrl` (e.g. `http://proxy.corp.internal:8080`).
- **Corporate Root CA**: Supports `NODE_EXTRA_CA_CERTS=/path/to/corporate-ca.crt` or an in-app toggle `skipSslVerification` (with explicit security warning) to accommodate internal development servers with self-signed TLS certificates.
- **Fail-Fast VPN Check**: If the target Bitbucket host fails to resolve (DNS `ENOTFOUND`) or times out (`ETIMEDOUT`), the system classifies the error as `VPN_REQUIRED` and displays a prominent warning in the UI: *"Cannot connect to Bitbucket. Please check if your corporate VPN is connected."*

---

## 5. Security & Token Storage Model

### 5.1. Encryption At Rest (AES-256-GCM)
Personal Access Tokens (PATs) and App Passwords grant significant repository permissions. They must never be stored in plaintext.
- **Algorithm**: `aes-256-gcm` (Authenticated Encryption with Associated Data).
- **Master Key Generation**:
  - Upon first launch, the application generates a cryptographically secure 256-bit key (`master.key`) saved with strict POSIX permissions (`0600` - read/write only by the current user).
  - Location: `~/.bitbucket-pr-approver/master.key` (or project-relative `.bitbucket-pr-approver-data/master.key`).
- **Encrypted Payload Structure**:
  ```json
  {
    "iv": "3f9b8c2d...",
    "tag": "a1b2c3d4...",
    "data": "e5f6g7h8..."
  }
  ```
- **In-Memory Hygiene**: Decrypted tokens are held in memory only for the duration of the active API call and are garbage-collected immediately.
- **Frontend Masking**: The REST API response for credentials always returns:
  ```json
  {
    "hasToken": true,
    "tokenPreview": "••••••••abcd",
    "verifiedAt": "2026-03-22T10:00:00Z"
  }
  ```
  The full token is never echoed back over the HTTP interface.

---

## 6. Bitbucket REST API Client Normalization

Bitbucket Cloud (API v2.0) and Bitbucket Server/Data Center (API v1.0) possess radically divergent REST structures. The application defines a uniform TypeScript interface `IBitbucketClient` and implements concrete adapters.

### 6.1. Unified Interface (`IBitbucketClient`)
```typescript
export interface IBitbucketClient {
  testConnection(): Promise<BitbucketUserProfile>;
  getCurrentUser(): Promise<BitbucketUserProfile>;
  listRepositories(projectOrWorkspace?: string): Promise<RepositoryInfo[]>;
  listOpenPullRequests(repo: RepositoryRef): Promise<PullRequest[]>;
  getPullRequest(repo: RepositoryRef, prId: number): Promise<PullRequest>;
  approvePullRequest(repo: RepositoryRef, prId: number): Promise<{ success: boolean; message: string }>;
}
```

### 6.2. REST API Comparison & Mapping

| Capability | Bitbucket Server / Data Center (v1.0) | Bitbucket Cloud (v2.0) |
|---|---|---|
| **Base URL** | `https://<corp-domain>/rest/api/1.0` | `https://api.bitbucket.org/2.0` |
| **Auth Header** | `Authorization: Bearer <PAT>` | `Authorization: Basic <base64(user:token)>` or `Bearer` |
| **Current User** | `GET /plugins/servlet/applinks/whoami` or `GET /rest/api/1.0/users/{slug}` | `GET /2.0/user` |
| **List PRs** | `GET /projects/{proj}/repos/{repo}/pull-requests?state=OPEN` | `GET /repositories/{workspace}/{repo}/pullrequests?state=OPEN` |
| **PR Details** | `GET /projects/{proj}/repos/{repo}/pull-requests/{id}` | `GET /repositories/{workspace}/{repo}/pullrequests/{id}` |
| **Approve PR** | `POST /projects/{proj}/repos/{repo}/pull-requests/{id}/approve` | `POST /repositories/{workspace}/{repo}/pullrequests/{id}/approve` |
| **Author Extraction** | `res.author.user.name` | `res.author.nickname` or `res.author.account_id` |
| **Branch Extraction** | `fromRef.displayId` / `toRef.displayId` | `source.branch.name` / `destination.branch.name` |
| **Reviewers** | `res.reviewers[].status == 'APPROVED'` | `res.participants[].approved == true` |

---

## 7. Intelligent Rule Filtering Engine

When the scheduler scans open pull requests for a given repository, it passes each PR through the `RuleFilteringEngine`. Every rule must evaluate to `PASS` for an automatic approval to be granted.

```
       [ Open Pull Request ]
                 |
                 v
   +---------------------------+
   | 1. Author Filter Check    | ----[ FAIL ]----> Log: "Author not in whitelist" (SKIP)
   |    - In authorWhitelist?  |
   |    - Not in blacklist?    |
   |    - Exclude self check   |
   +-------------+-------------+
                 | PASS
                 v
   +---------------------------+
   | 2. Target Branch Check    | ----[ FAIL ]----> Log: "Target branch doesn't match" (SKIP)
   |    - Match target pattern?|
   +-------------+-------------+
                 | PASS
                 v
   +---------------------------+
   | 3. Source Branch Check    | ----[ FAIL ]----> Log: "Source branch doesn't match" (SKIP)
   |    - Match source pattern?|
   +-------------+-------------+
                 | PASS
                 v
   +---------------------------+
   | 4. Draft & Conflict Guard | ----[ FAIL ]----> Log: "PR is draft or has conflicts" (SKIP)
   |    - Not draft?           |
   |    - No merge conflicts?  |
   +-------------+-------------+
                 | PASS
                 v
   +---------------------------+
   | 5. Already Approved?      | ----[ YES ]-----> Log: "Already approved by user" (NO-OP)
   |    - Current user status? |
   |    - In Memory Cache?     |
   +-------------+-------------+
                 | NO
                 v
   +---------------------------+
   | 6. Dry Run Check          | ----[ DRY RUN ]-> Log: "Matched rules [DRY RUN]" (SIMULATE)
   +-------------+-------------+
                 | EXECUTE
                 v
   +---------------------------+
   | 7. POST Approve API Call  | =================> Send Bitbucket Approval API Request
   +---------------------------+
```

### 7.1. Glob & Regex Matching Specifications
- Patterns support standard wildcards:
  - `*` matches any characters within a segment (e.g., `feature/*` matches `feature/auth` but not `feature/auth/login`).
  - `**` matches multi-level segments (e.g., `feature/**` matches `feature/auth/login`).
  - Optional prefix `regex:` allows pure regular expression evaluation: e.g., `regex:^(release|hotfix)\/v\d+\.\d+`.
- Case-insensitivity is enabled by default for branch and author names to prevent casing mismatches.

---

## 8. Scheduler Runner & Background Worker

### 8.1. Execution Loop
1. The scheduler operates an asynchronous timer loop (using `setTimeout` chaining rather than `setInterval` to prevent overlapping runs when requests take longer than the interval).
2. For each enabled job:
   - Evaluates whether `Date.now() >= nextRunAt`.
   - Resolves the repository list (supporting wildcard expansion if configured, e.g. `CORE/*`).
   - Fetches open PRs from Bitbucket.
   - Evaluates each PR through the `RuleFilteringEngine`.
   - If `dryRun == true`: Emits a `DRY_RUN` log entry and broadcasts an SSE event.
   - If `dryRun == false`: Calls `bitbucketClient.approvePullRequest()`, caches the PR ID, records an `APPROVED` log entry, and broadcasts an SSE event.
   - Updates `lastRunAt` and calculates `nextRunAt = Date.now() + intervalSeconds * 1000`.

### 8.2. Idempotency & Rate Limit Protection
- **PR Approval Cache**: Keeps an in-memory Set of `{prId, commitHash}` pairs approved in the last 24 hours. If Bitbucket returns a cached PR, the system bypasses redundant network calls.
- **Throttling**: Enforces a minimum 250ms delay between consecutive approval calls to avoid triggering Bitbucket Server rate limiting or DoS protection.

---

## 9. Data Storage Schema (JSON / File Store)

Data is stored under `~/.bitbucket-pr-approver-data/` (or configured directory):

### 9.1. `config.json`
```json
{
  "serverType": "server",
  "baseUrl": "https://bitbucket.internal.company.com",
  "authType": "bearer",
  "encryptedToken": {
    "iv": "3f9b8c2d...",
    "tag": "a1b2c3d4...",
    "data": "e5f6g7h8..."
  },
  "username": "hungnv",
  "skipSslVerification": true,
  "proxyUrl": null,
  "timeoutMs": 15000,
  "updatedAt": "2026-03-22T08:00:00Z"
}
```

### 9.2. `jobs.json`
```json
[
  {
    "id": "e9b1d283-8472-4e31-9c60-a298a0b016e4",
    "name": "Auto Approve Feature PRs to Develop",
    "description": "Approves all team pull requests targeting develop branch",
    "enabled": true,
    "intervalSeconds": 60,
    "dryRun": false,
    "rules": {
      "repositories": ["DIGI/digifact-core-*"],
      "authorWhitelist": ["dev-lead", "senior-dev", "partner-team"],
      "authorBlacklist": ["intern-unverified"],
      "excludeSelf": true,
      "targetBranches": ["develop", "release/*"],
      "sourceBranches": ["feature/*", "bugfix/*"],
      "titleKeywordsExclude": ["[WIP]", "[DO NOT MERGE]"],
      "ignoreDrafts": true,
      "ignoreWithConflicts": true
    },
    "lastRunAt": "2026-03-22T10:15:00Z",
    "nextRunAt": "2026-03-22T10:16:00Z",
    "createdAt": "2026-03-22T08:30:00Z",
    "updatedAt": "2026-03-22T08:30:00Z"
  }
]
```

### 9.3. `logs.json`
```json
[
  {
    "id": "6724b1a0-9c12-4211-884b-0129fca88921",
    "jobId": "e9b1d283-8472-4e31-9c60-a298a0b016e4",
    "jobName": "Auto Approve Feature PRs to Develop",
    "prId": 482,
    "prTitle": "feat(auth): add OAuth2 refresh token handling",
    "prUrl": "https://bitbucket.internal.company.com/projects/DIGI/repos/digifact-core-fe/pull-requests/482",
    "repository": "DIGI/digifact-core-fe",
    "author": "senior-dev",
    "sourceBranch": "feature/auth-refresh",
    "targetBranch": "develop",
    "status": "APPROVED",
    "reason": "Matched author whitelist and target branch 'develop'",
    "dryRun": false,
    "timestamp": "2026-03-22T10:15:02Z",
    "durationMs": 142
  }
]
```

---

## 10. API Route Contracts

All REST routes are prefixed with `/api`.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Healthcheck and VPN reachability indicator |
| `GET` | `/api/status` | Current scheduler status, active jobs, uptime, metrics |
| `GET` | `/api/config` | Read current connection configuration (with masked token) |
| `POST` | `/api/config` | Update connection config & encrypt new token |
| `POST` | `/api/config/test` | Test Bitbucket connection with provided or saved token |
| `GET` | `/api/jobs` | List all configured approval jobs |
| `POST` | `/api/jobs` | Create a new job |
| `GET` | `/api/jobs/:id` | Get details of a single job |
| `PUT` | `/api/jobs/:id` | Update an existing job |
| `DELETE` | `/api/jobs/:id` | Remove a job |
| `POST` | `/api/jobs/:id/toggle` | Enable or pause a job |
| `POST` | `/api/jobs/:id/run-now` | Trigger an immediate manual execution cycle |
| `POST` | `/api/prs/preview` | Preview PR evaluation results against rules without approving |
| `GET` | `/api/logs` | Fetch approval history (pagination, filter by job/status/repo) |
| `DELETE` | `/api/logs` | Clear logs history |
| `GET` | `/api/events` | **Server-Sent Events (SSE)** endpoint for live log streaming and status |

---

## 11. Testing & Verification Strategy

1. **Unit Tests**:
   - `CryptoService`: Verify encryption, decryption, authentication tag verification, tampered payload rejection.
   - `RuleFilteringEngine`: Exhaustive test matrix for whitelist matching, blacklist precedence, self-exclusion, branch glob/regex matching, draft PR and conflict handling.
   - `BitbucketClient`: Mocked responses for Bitbucket Server v1.0 and Cloud v2.0 REST endpoints to guarantee normalized output parity.
2. **Integration Tests**:
   - Fastify route tests using `app.inject()` (zero socket port binding, fast and clean).
   - Scheduler runner execution cycle with mock Bitbucket client verifying idempotency and dry-run flag.
3. **Performance Benchmarks**:
   - Verification of RAM footprint (< 45 MB).
   - Fastify response times (< 10 ms for local endpoints).
   - Frontend bundle size (< 150 KB gzipped).
