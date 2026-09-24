# Lessons

## 2026-09-24T03:30:00Z - Cloud control plane must not become the VPN worker

- Symptom: A Coolify deployment can be mistaken for a replacement for workstation VPN access.
- Root cause: The container runs from the cloud server's egress network, while IP-allowlisted Bitbucket access belongs to the developer workstation's VPN.
- Correction: Deploy only the authenticated control plane to Coolify and retain paired Local Workers for `worker`-mode jobs; document that `local` jobs execute on the cloud container.
- Prevention: Require a persistent data volume, public HTTPS origin, owner password, and explicit worker-mode setup for VPN-bound jobs.
- Evidence: Compose config and all production package builds passed; Docker daemon was unavailable for an image runtime smoke.
- Recurrence keys: `Coolify`, `Docker Compose`, `Local Worker`, `worker mode`, `VPN`, `IP allowlist`, `CONTROL_PLANE_ORIGIN`.
