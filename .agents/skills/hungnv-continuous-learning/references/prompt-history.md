# Prompt History

## 2026-09-24T07:00:27Z - Enable cloud Run in Terminal after one-time Mac setup

- Sanitized prompt: Implement the agreed plan so a user can click Run in Terminal from the Coolify UI and start a VPN-local Worker on their Mac after a one-time setup.
- Previous match: `2026-09-24T03:30:00Z - Deploy Bitbucket PR Approver to Coolify`; that release intentionally disabled server-side Terminal launch in Linux. The subsequent IP/CORS repairs enabled UI and login, but did not provide a Mac-side launcher.
- Result: Built a portable Worker bundle into the container, added public no-secret HTTPS bootstrap resources, a one-time Mac setup script that downloads a verified Node runtime and compiles the Keychain helper locally, and a dedicated custom URL scheme opening Terminal on the user's Mac. Cloud UI creates an owner/CSRF-protected pairing session, with fallback launch link; public HTTP cannot initiate the cloud setup. Existing local launch remains unchanged.
- Changed files: `Dockerfile`, `README.md`, `backend/src/server.ts`, `backend/src/routes/worker-installer.ts`, `frontend/src/components/WorkerSetup.tsx`, `frontend/src/types/index.ts`, `worker/install/macos/portable-*`, `CHANGELOG.md`, and local learning records.
- Verification: Backend/Frontend production builds, Worker bundle build and clean Worker dependency install, 69 backend tests, Compose config, resource/authorization smoke, zsh syntax, temporary AppleScript app compilation and URL-scheme plist, Swift helper compilation, and ad-hoc signing passed. Docker daemon unavailable. Public HTTPS certificate validation failed, so remote Mac-to-Coolify end-to-end pairing remains unverified.
- Outcome: PASS locally, BLOCKED for public rollout until a valid HTTPS certificate and Coolify redeploy; no commit or push was requested.

## 2026-09-24T04:05:40Z - Owner sign-in rejected through public IP

- Sanitized prompt: Correct the `Origin is not allowed` error displayed when signing in through the public IP.
- Previous match: `2026-09-24T03:58:13Z - Coolify UI renders blank through public IP`; the prior correction exempted static assets but correctly retained strict CORS for APIs, exposing that a same-host IP API Origin was not part of the configured domain allowlist.
- Result: API CORS now accepts a browser Origin only when its host exactly matches the current request Host, as well as the configured allowlist; other Origins remain rejected.
- Changed files: `backend/src/server.ts`, `CHANGELOG.md`, and local learning records.
- Verification: Backend production build and `npm test` passed (69 tests). A same-host IP-origin owner-login request returned `409 AUTH_DISABLED` with a matching CORS header (the expected state without initialized owner storage); an untrusted Origin still returned `403`.
- Outcome: PASS locally; Coolify redeployment is required for sign-in through the public endpoint.

## 2026-09-24T03:58:13Z - Coolify UI renders blank through public IP

- Sanitized prompt: Diagnose and correct the blank UI at the public Coolify IP address.
- Previous match: `2026-09-24T03:30:00Z - Deploy Bitbucket PR Approver to Coolify`; that deployment intentionally used a strict `CONTROL_PLANE_ORIGIN`, but it did not verify browser asset requests carrying a different `Origin` header.
- Result: Scoped strict CORS validation to `/api/*`; static HTML, JavaScript, and CSS now bypass API CORS evaluation, preserving the strict API origin allowlist.
- Changed files: `backend/src/server.ts`, `CHANGELOG.md`, and local learning records.
- Verification: Backend and frontend production builds passed; `npm test` passed (69 tests); with `Origin: http://84.247.137.35:3100`, the production JavaScript asset returned `200` and `/api/health` remained `403`.
- Outcome: PASS locally; Coolify redeployment is required for the public endpoint to pick up the commit.

## 2026-09-24T03:30:00Z - Deploy Bitbucket PR Approver to Coolify

- Sanitized prompt: Create Docker Compose for Coolify and push the application to the supplied GitHub repository.
- Previous match: No project-local record. Parent workspace history established that cloud hosting must retain a Local Worker for corporate VPN/IP-allowlisted Bitbucket access.
- Result: Added a multi-stage production image, Coolify Compose service, named persistent volume, required production environment variables, healthcheck, secret-safe Docker/Git ignores, environment template, and deployment documentation.
- Changed files: `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `.gitignore`, `.env.example`, `README.md`, `CHANGELOG.md`, and local learning records.
- Verification: `docker compose config` passed using non-secret validation values; shared, backend, and frontend production builds passed. Docker image build was not run because the local Docker daemon is unavailable.
- Outcome: PASS with Docker runtime verification pending external Docker availability.
