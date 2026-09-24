# Prompt History

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
