# Security & Local Network Model Specification

---

## 1. Local-First Security Principle

The primary rationale for running this tool locally rather than deploying it to a shared cloud environment is **security and boundary inheritance**:
1. **Zero Firewall Ingress**: The application operates purely as an outbound HTTP client. It never opens inbound network ports to the corporate network or the public internet.
2. **Local Loopback Isolation**: The backend server binds **strictly to `127.0.0.1`** (localhost). It refuses connections from other devices on the local LAN or Wi-Fi network.
3. **No Centralized Token Storage**: Tokens are stored solely on the developer's encrypted workstation filesystem. If a cloud server were used, a single database breach would expose tokens for all developers across the organization.

---

## 2. VPN & IP Whitelisting Architecture

```
+-------------------------------------------------------------+
| Developer Workstation (Mac / Linux / Windows)               |
|                                                             |
|  [ Bitbucket PR Approver Backend (127.0.0.1:3100) ]        |
|                         |                                   |
|                         v Node.js HTTP/HTTPS Client         |
|  [ OS Sockets & Routing Table ]                             |
|          |                                                  |
|          +--- If Corporate Host: bitbucket.corp.internal    |
|          |    Routed to: utun3 / tun0 (VPN Interface)       |
|          |                                                  |
|          +--- If Public Cloud: api.bitbucket.org            |
|               Routed to: en0 / eth0 (Default Gateway)       |
+--------------------------|----------------------------------+
                           |
                           v
           [ Corporate VPN Gateway / IP Whitelist ]
              IP: 14.161.x.x (Whitelisted Corp IP)
                           |
                           v
            [ Internal Bitbucket Data Center ]
```

### 2.1. Dynamic VPN State Detection
- The backend performs periodic lightweight connectivity probes (or pinging `GET /plugins/servlet/applinks/whoami` with a 3-second timeout).
- If the probe returns `ENOTFOUND` or `ETIMEDOUT`, the system marks `vpnConnected: false` and halts automatic approval cycles to prevent log spam and failed retry storms.
- When the VPN reconnects, the probe succeeds, the UI status switches to green (`VPN: CONNECTED`), and the scheduler resumes smoothly.

### 2.2. Corporate Forward Proxy & Custom CA Support
- **Corporate Proxies**: In networks requiring outbound proxies, the HTTP client checks standard environment variables:
  - `HTTP_PROXY`
  - `HTTPS_PROXY`
  - `NO_PROXY`
  It also permits an explicit `proxyUrl` (e.g. `http://proxy.internal.corp:8080`) configured in settings.
- **Custom Corporate Root CAs**: Internal corporate networks often use MITM SSL inspection or private enterprise PKI. The backend:
  - Honors `NODE_EXTRA_CA_CERTS=/path/to/corporate-ca.pem`.
  - Provides a controlled setting: `skipSslVerification: boolean`. When enabled, `undici.Agent({ connect: { rejectUnauthorized: false } })` is used. A visible security warning is surfaced in the UI.

---

## 3. Cryptography & Token Protection Model

### 3.1. AES-256-GCM Encryption Architecture

```
                    [ Developer PAT / App Password ]
                                   |
                                   v
             [ Master Key: 256-bit Random Secret ]
             (Stored at ~/.bitbucket-pr-approver-data/master.key with chmod 0600)
                                   |
                                   v
             [ AES-256-GCM Encryption Engine ]
             - Generates unique 12-byte IV per encryption
             - Computes 16-byte Authentication Tag (integrity)
                                   |
                                   v
                     [ Encrypted Storage Record ]
                     {
                       "iv": "9a1f28b7...",
                       "tag": "e4d3c2b1...",
                       "data": "56a7c9f0..."
                     }
```

### 3.2. Master Key Management
1. **Generation**:
   ```javascript
   import crypto from 'node:crypto';
   const key = crypto.randomBytes(32); // 256 bits
   ```
2. **File Permissions**:
   - The file is saved at `~/.bitbucket-pr-approver-data/master.key`.
   - On POSIX (macOS/Linux), the file permission is set strictly to `0600` (`chmod 600`), readable and writable only by the current OS user process.
3. **Decryption on Demand**:
   - The token is decrypted in memory only when an outbound Bitbucket request is dispatched.
   - It is never held in long-lived global variables.

### 3.3. Plaintext Leak Prevention
- **API Redaction**:
  - The `GET /api/config` endpoint **never** includes the raw token.
  - Returns only `{ hasToken: true, tokenPreview: "••••••••abcd" }`.
- **Log Sanitization**:
  - Fastify Pino logger is configured with sanitizing serializers.
  - Regex masks matching Bearer tokens, passwords, and authorization headers (`Authorization: Bearer [REDACTED]`).

### 3.4. Secure Session Restore After Browser Reload

- The frontend never stores the raw token in `localStorage`, `sessionStorage`, cookies, or browser-managed persistence.
- On reload, the UI reads only masked configuration from `GET /api/config`. When `hasToken` is true, it calls `POST /api/config/test` with the active workspace only.
- The loopback backend decrypts the filesystem credential in memory, performs a fresh Bitbucket identity/workspace handshake, and returns a verified profile. The dashboard unlocks only after that live verification succeeds.
- Expired credentials, missing permissions, or network failures leave the onboarding gate closed and never fall back to cached/mock identity data.

---

## 4. Frontend & Localhost Hardening

1. **CORS Restrictions**:
   - CORS is locked strictly to `http://localhost:3100`, `http://127.0.0.1:3100`, or Vite dev server `http://localhost:5173`.
   - Wildcards (`*`) are disallowed.
2. **Content Security Policy (CSP)**:
   - Default source restricted to `'self'`.
   - Script sources restricted to `'self'` (no unsafe inline evaluation).
3. **Request Rate Limiting**:
   - Local endpoints are protected with Fastify rate-limiting (e.g. max 100 requests per minute) to prevent any rogue background scripts or open browser tabs from flooding the backend.

---

## 5. Remote Control Plane and Local Worker

- Production control-plane mode requires `CONTROL_PLANE_OWNER_PASSWORD`; browser sessions use HttpOnly, Secure, SameSite cookies plus CSRF headers.
- Pairing codes are random, stored as SHA-256 hashes, single-use, and expire after ten minutes.
- Worker bearer credentials are returned once; only SHA-256 hashes persist.
- Worker RSA-OAEP private keys, bearer credentials, and Bitbucket tokens live in macOS Keychain through a native Security.framework helper. Secret values travel over stdin, never process arguments.
- Browser token entry uses Web Crypto RSA-OAEP SHA-256. Existing local tokens migrate only after an owner-authorized action and persist on the Control Plane as temporary ciphertext.
- Worker acknowledgement deletes the encrypted envelope.
- The development `Run in Terminal` endpoint is available only when the Control Plane itself is running on macOS loopback. It writes a mode-0600 one-use pairing URL and public runtime under Application Support, opens Terminal locally, and deletes the pairing file after use. No downloaded shell file, Bitbucket token, or Worker bearer credential is involved.
- Control Plane and offline outbox retain at most 300 entries per Worker and redact credentials, authorization headers, private keys, cookies, pairing codes, and connection strings.
- Production pairing and heartbeat require HTTPS. Unsigned development packages are labelled and auto-update only accepts Ed25519-signed manifests with matching SHA-256.
