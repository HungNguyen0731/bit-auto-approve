# Bitbucket PR Auto-Approver: Metadata API Specification
## Contract for Backend Engineer (`backend_dev` — Task t2)
### Bitbucket Cloud-Only Standard & Strict Zero-Mock Policy

---

## 1. Overview & Architectural Role

To power the **Dynamic Searchable Comboboxes** and the **Onboarding Gatekeeper**, the backend proxies requests directly to **Bitbucket Cloud REST API v2.0** (`https://api.bitbucket.org/2.0`) using the authenticated user's Atlassian username and App Password (HTTP Basic Auth).

### 🚨 Strict Zero-Mock Policy (Non-Negotiable):
- **NO SYNTHETIC OR FALLBACK MOCK DATA IN RUNTIME**: Under no circumstances should the backend return hardcoded mock repositories, mock branches, or dummy users.
- If Bitbucket Cloud is unreachable, if the token is invalid, or if rate-limited, the backend **MUST** return a structured error response with actionable diagnosis.
- Silent fallback to mock data masks authentication failures and corrupts user trust.

All endpoints adhere to the standard JSON envelope:
```typescript
// Success
{
  "success": true,
  "data": { ... }
}

// Error
{
  "success": false,
  "error": {
    "code": "AUTH_INVALID_TOKEN" | "RATE_LIMITED" | "NETWORK_OFFLINE" | "WORKSPACE_NOT_FOUND" | "INSUFFICIENT_SCOPES" | "API_ERROR",
    "message": string,
    "httpStatus": number,
    "rateLimitReset": number | null,
    "details": unknown
  }
}
```

---

## 2. Endpoints Specification

### 2.1. List User Workspaces
#### `GET /api/bitbucket/workspaces`

- **Purpose**: Retrieve all Bitbucket Cloud workspaces accessible by the authenticated user.
- **Bitbucket Cloud API**:
  `GET https://api.bitbucket.org/2.0/user/workspaces?pagelen=100`. Bitbucket returns workspace-membership records; the backend unwraps each nested `workspace` before returning the frontend metadata shape.
- **Response Format**:
  ```json
  {
    "success": true,
    "data": {
      "items": [
        {
          "slug": "acme-engineering",
          "name": "Acme Engineering",
          "uuid": "{5b060d4a-3829-43c2-8418-86d11a681d65}",
          "avatarUrl": "https://bitbucket.org/workspaces/acme-engineering/avatar",
          "isPersonal": false
        }
      ],
      "total": 1
    }
  }
  ```

---

### 2.2. Search Repositories
#### `GET /api/bitbucket/repositories`

- **Purpose**: Search and list repositories in the active workspace.
- **Query Parameters**:
  - `workspace` (string, optional): Workspace slug. Defaults to the active configured workspace; if legacy config has none, the backend resolves the first accessible workspace from `GET /2.0/user/workspaces`. Username/email is never used as a workspace slug.
  - `query` (string, optional): Filter repo name containing query string.
  - `limit` (number, optional, default `25`, max `100`).
- **Bitbucket Cloud API**:
  - If `query` provided:
    `GET https://api.bitbucket.org/2.0/repositories/{workspace}?q=name~"{query}"&pagelen={limit}&sort=-updated_on`
  - If `query` empty:
    `GET https://api.bitbucket.org/2.0/repositories/{workspace}?pagelen={limit}&sort=-updated_on`
- **Response Format**:
  ```json
  {
    "success": true,
    "data": {
      "items": [
        {
          "slug": "payment-service",
          "name": "Payment Service",
          "workspace": "acme-engineering",
          "uuid": "{3a4b5c6d-7e8f-9a0b-1c2d-3e4f5a6b7c8d}",
          "isPrivate": true,
          "defaultBranch": "main",
          "description": "Core payment processing pipeline",
          "fullName": "acme-engineering/payment-service",
          "projectKey": "PAY"
        }
      ],
      "total": 1
    }
  }
  ```

---

### 2.3. Search Branches
#### `GET /api/bitbucket/branches`

- **Purpose**: Retrieve Git branches for a selected repository.
- **Query Parameters**:
  - `repository` (string, required): Full repo path (`workspace/slug`) or repo slug if workspace is configured.
  - `query` (string, optional): Filter branch names containing query.
  - `limit` (number, optional, default `50`, max `100`).
- **Bitbucket Cloud API**:
  - If `query` provided:
    `GET https://api.bitbucket.org/2.0/repositories/{workspace}/{repo_slug}/refs/branches?q=name~"{query}"&pagelen={limit}`
  - If `query` empty:
    `GET https://api.bitbucket.org/2.0/repositories/{workspace}/{repo_slug}/refs/branches?pagelen={limit}`
- **Response Format**:
  ```json
  {
    "success": true,
    "data": {
      "items": [
        {
          "name": "main",
          "displayId": "main",
          "isDefault": true,
          "latestCommit": "d3b07384d113edec49eaa6238ad5ff00",
          "type": "default"
        },
        {
          "name": "develop",
          "displayId": "develop",
          "isDefault": false,
          "latestCommit": "c0535e4be2b79f1d0828ac803c44289",
          "type": "default"
        },
        {
          "name": "release/2026.04",
          "displayId": "release/2026.04",
          "isDefault": false,
          "latestCommit": "ef2d127de37b942baad06145e54b0c61",
          "type": "release"
        }
      ],
      "total": 3
    }
  }
  ```

---

### 2.4. Search Workspace Members & Users
#### `GET /api/bitbucket/users`

- **Purpose**: Retrieve real collaborators and team members from Bitbucket Cloud workspace.
- **Query Parameters**:
  - `workspace` (string, optional): Target workspace slug.
  - `query` (string, optional): Filter by user display name or username.
  - `limit` (number, optional, default `25`, max `100`).
- **Bitbucket Cloud API**:
  - Upstream request:
    `GET https://api.bitbucket.org/2.0/workspaces/{workspace}/members?pagelen=100`
  - Bitbucket does not support filtering membership results by nested `user.display_name`. When `query` is provided, the backend paginates accessible memberships and filters normalized display name, nickname, or account ID locally before applying the requested limit.
- **Response Format**:
  ```json
  {
    "success": true,
    "data": {
      "items": [
        {
          "username": "hungnv",
          "displayName": "Nguyen Van Hung",
          "email": null,
          "avatarUrl": "https://secure.gravatar.com/avatar/...",
          "accountId": "557058:3b4582f1-6789-4a0b-8d12-9c1234567890",
          "uuid": "{557058-3b45-82f1-6789-4a0b8d129c12}",
          "active": true
        }
      ],
      "total": 1
    }
  }
  ```

---

## 3. Pull Requests Evaluation & Approval Endpoints

### 3.1. Fetch Open Pull Requests
- **Bitbucket Cloud API**:
  `GET https://api.bitbucket.org/2.0/repositories/{workspace}/{repo_slug}/pullrequests?state=OPEN&pagelen=50`
- Fetches real open PRs with:
  * `id`: numeric PR ID
  * `title`: PR title
  * `author`: `user` object with `display_name`, `username`, `account_id`
  * `source`: `branch.name`
  * `destination`: `branch.name`
  * `reviewers`: list of assigned reviewers and approval status
  * `links.html.href`: direct web URL to PR

### 3.2. Approve Pull Request
- **Bitbucket Cloud API**:
  `POST https://api.bitbucket.org/2.0/repositories/{workspace}/{repo_slug}/pullrequests/{pull_request_id}/approve`
- Submits official approval on behalf of the authenticated Atlassian account.

---

## 4. Rate Limiting, Caching & Error Handling

1. **In-Memory TTL Caching**:
   - Workspaces and repository lists are cached in-memory with a **60-second TTL** to stay well below Bitbucket Cloud's 1,000 requests/hour limit.
   - Cache bypass can be triggered with `?fresh=true` or when user clicks refresh.
2. **HTTP 429 Handling**:
   - The backend intercepts HTTP 429 and parses header `Retry-After`.
   - Propagates `{ success: false, error: { code: "RATE_LIMITED", rateLimitReset: 30 } }`.
3. **HTTP 401 Handling**:
   - Immediately flags `{ success: false, error: { code: "AUTH_INVALID_TOKEN", message: "Bitbucket App Password revoked or expired" } }`.
