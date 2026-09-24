# Lessons

## 2026-09-24T03:58:13Z - Strict API CORS must not block same-origin static assets

- Symptom: The public deployment returned `200` for its HTML shell but rendered a blank page; JavaScript and CSS asset requests with the public IP Origin returned `403 CORS_ORIGIN_DENIED`.
- Root cause: The global Fastify CORS plugin ran before static-file delivery and rejected all unlisted Origins, including browser requests for frontend assets when users accessed the server through a temporary IP instead of `CONTROL_PLANE_ORIGIN`.
- Correction: Use the Fastify CORS request delegator to enforce the allowlist only for `/api/*`; disable CORS processing for non-API/static routes.
- Prevention: For every strict CORS deployment, verify both an asset request and an API request with an unlisted Origin. Assets must return `200`; API must stay rejected.
- Evidence: Backend/frontend production builds and 69 backend tests passed; local Origin-specific smoke returned asset `200` and API `403`.
- Recurrence keys: `CORS_ORIGIN_DENIED`, `blank UI`, `Coolify`, `Fastify`, `@fastify/cors`, `CONTROL_PLANE_ORIGIN`, `static assets`.

## 2026-09-24T03:30:00Z - Cloud control plane must not become the VPN worker

- Symptom: A Coolify deployment can be mistaken for a replacement for workstation VPN access.
- Root cause: The container runs from the cloud server's egress network, while IP-allowlisted Bitbucket access belongs to the developer workstation's VPN.
- Correction: Deploy only the authenticated control plane to Coolify and retain paired Local Workers for `worker`-mode jobs; document that `local` jobs execute on the cloud container.
- Prevention: Require a persistent data volume, public HTTPS origin, owner password, and explicit worker-mode setup for VPN-bound jobs.
- Evidence: Compose config and all production package builds passed; Docker daemon was unavailable for an image runtime smoke.
- Recurrence keys: `Coolify`, `Docker Compose`, `Local Worker`, `worker mode`, `VPN`, `IP allowlist`, `CONTROL_PLANE_ORIGIN`.
