# Lessons

## 2026-09-24T07:00:27Z - Cloud browser needs a Mac-side handler for Terminal launch

- Symptom: Cloud UI disabled Run in Terminal because its old endpoint could only open Terminal on the server's own macOS loopback host.
- Root cause: A website cannot directly spawn a user's local process, and the Linux Coolify image did not contain distributable Mac Worker resources.
- Correction: Keep local server-side launch separate; after explicit one-time Mac setup, register a dedicated URL handler pinned to a valid HTTPS Control Plane. Build the portable Worker bundle into the Docker image, require owner/CSRF to mint a short-lived pairing code, and retain encrypted Worker token delivery.
- Prevention: Verify bootstrap resource availability/authorization, URL-handler registration, same-origin binding, reused pairing, unsupported architectures, and certificate-verified remote pairing before declaring cloud rollout successful.
- Evidence: Builds, 69 backend tests, resource smoke, shell syntax, and temporary Mac app/Swift signing checks passed; Docker runtime and public HTTPS pairing remain unverified.
- Recurrence keys: `Run in Terminal`, `Coolify`, `portable Worker`, `custom URL handler`, `Keychain`, `HTTPS`, `Mac bootstrap`.

## 2026-09-24T04:05:40Z - Same-host public access must be accepted by API CORS

- Symptom: After static assets loaded through a direct public IP, owner sign-in still returned `Origin is not allowed`.
- Root cause: API CORS allowlisted `CONTROL_PLANE_ORIGIN`, but a browser accessing the same service through the temporary IP sends that IP as its Origin, which is not the configured public-domain Origin.
- Correction: Permit API CORS when the parsed Origin host exactly equals the incoming request Host, while retaining the configured allowlist and rejecting every other Origin.
- Prevention: Validate owner-login API CORS through each supported public host, including temporary IP access, and verify an unrelated Origin receives `403`.
- Evidence: Backend build and 69 tests passed; same-host IP login CORS header was returned and untrusted Origin remained `403`.
- Recurrence keys: `Origin is not allowed`, `CORS_ORIGIN_DENIED`, `owner sign-in`, `public IP`, `Fastify`, `CONTROL_PLANE_ORIGIN`.

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
