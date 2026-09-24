# Bitbucket REST API Integration Guide
## Bitbucket Cloud REST API v2.0 (Cloud-Only Standard)

---

## 1. Overview & Architecture

Bitbucket PR Auto-Approver exclusively integrates with **Bitbucket Cloud REST API v2.0** (`https://api.bitbucket.org/2.0`). All legacy on-premise Server / Data Center (`/rest/api/1.0`) integrations are deprecated.

### Core Principles:
1. **Authentication**: Uses Atlassian account email/username and Bitbucket App Password via HTTP Basic Auth:
   ```http
   Authorization: Basic <base64(username:app_password)>
   ```
2. **Strict Zero-Mock Enforcement**: Every API call directly communicates with `api.bitbucket.org`. No fake or synthetic data is allowed in runtime.
3. **Hierarchy**: User Profile → Workspaces → Repositories → Branches & PRs.

---

## 2. Bitbucket Cloud (v2.0) Endpoints Specification

### 2.1. Verify Current User Profile
- **Endpoint**:
  ```http
  GET /2.0/user
  ```
- **Response Format**:
  ```json
  {
    "username": "alexchen",
    "display_name": "Alex Chen",
    "account_id": "557058:3a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d",
    "uuid": "{3a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d}",
    "is_staff": false,
    "created_on": "2021-04-15T08:30:00+00:00",
    "links": {
      "avatar": {
        "href": "https://secure.gravatar.com/avatar/3a1b2c?d=https%3A%2F%2Favatar-management--avatars.us-west-2.prod.public.atl-paas.net%2Fdefault-avatar.png"
      },
      "html": {
        "href": "https://bitbucket.org/alexchen/"
      }
    }
  }
  ```

---

### 2.2. Workspaces
- **Endpoint**:
  ```http
  GET /2.0/user/workspaces?pagelen=100
  ```

  The response values are workspace-membership records. Normalize `value.workspace` into the application workspace metadata contract.
- **Response Format**:
  ```json
  {
    "pagelen": 100,
    "size": 2,
    "values": [
      {
        "slug": "acme-corp",
        "name": "Acme Corporation",
        "uuid": "{5b060d4a-3829-43c2-8418-86d11a681d65}",
        "is_privacy_enforced": false,
        "links": {
          "avatar": {
            "href": "https://bitbucket.org/workspaces/acme-corp/avatar"
          }
        }
      }
    ]
  }
  ```

---

### 2.3. Repositories
- **Endpoint**:
  ```http
  GET /2.0/repositories/{workspace}?q=name~"{query}"&pagelen={limit}&sort=-updated_on
  ```
- **Response Format**:
  ```json
  {
    "pagelen": 25,
    "values": [
      {
        "slug": "billing-api",
        "name": "Billing API Service",
        "full_name": "acme-corp/billing-api",
        "is_private": true,
        "uuid": "{8e9f0a1b-2c3d-4e5f-6a7b-8c9d0e1f2a3b}",
        "description": "PCI-compliant billing service",
        "mainbranch": {
          "name": "main",
          "type": "branch"
        },
        "updated_on": "2026-03-22T08:12:00.000Z",
        "project": {
          "key": "PAY",
          "name": "Payments"
        }
      }
    ]
  }
  ```

---

### 2.4. Branches
- **Endpoint**:
  ```http
  GET /2.0/repositories/{workspace}/{repo_slug}/refs/branches?q=name~"{query}"&pagelen={limit}
  ```
- **Response Format**:
  ```json
  {
    "pagelen": 50,
    "values": [
      {
        "name": "main",
        "target": {
          "hash": "a1b2c3d4e5f67890123456789abcdef012345678",
          "date": "2026-03-22T09:00:00+00:00"
        },
        "default": true
      },
      {
        "name": "develop",
        "target": {
          "hash": "9876543210fedcba9876543210fedcba98765432",
          "date": "2026-03-22T08:30:00+00:00"
        },
        "default": false
      }
    ]
  }
  ```

---

### 2.5. Workspace Collaborators & Members
- **Endpoint**:
  ```http
  GET /2.0/workspaces/{workspace}/members?pagelen=100
  ```

  Workspace membership does not support filtering by nested user display fields. Filter normalized member name, nickname, and account ID locally.
- **Response Format**:
  ```json
  {
    "pagelen": 25,
    "values": [
      {
        "user": {
          "display_name": "Alex Chen",
          "uuid": "{3a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d}",
          "account_id": "557058:3a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d",
          "nickname": "alexchen",
          "links": {
            "avatar": { "href": "https://secure.gravatar.com/avatar/..." }
          }
        },
        "workspace": { "slug": "acme-corp" }
      }
    ]
  }
  ```

---

### 2.6. Pull Requests Evaluation & Approval
- **List Open PRs**:
  ```http
  GET /2.0/repositories/{workspace}/{repo_slug}/pullrequests?state=OPEN&pagelen=50
  ```
- **Approve Pull Request**:
  ```http
  POST /2.0/repositories/{workspace}/{repo_slug}/pullrequests/{pull_request_id}/approve
  ```
- **Response**: HTTP 200 OK with approval record containing `user` and `approved: true`.

---

## 3. Error Codes & Bitbucket Cloud Diagnostics

| HTTP Status | Error Scenario | Diagnostic Resolution |
|-------------|----------------|-----------------------|
| **401 Unauthorized** | Invalid App Password | Re-generate App Password in Bitbucket settings. |
| **403 Forbidden** | Missing required scopes | Ensure `Account: Read`, `Workspaces: Read`, `Repositories: Read`, `Pull requests: Write`. |
| **404 Not Found** | Workspace or Repo does not exist | Verify workspace slug and repository permissions. |
| **429 Too Many Requests** | Rate limit reached (1,000 req/hr) | Honor `Retry-After` header. Pause background scheduler. |
| **Network Timeout** | Connection failure to api.bitbucket.org | Verify internet connectivity and corporate proxy. |
