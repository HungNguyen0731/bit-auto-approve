# Changelog

## [Unreleased]

- Fixed the deployed UI rendering blank when accessed by IP or a domain not yet configured as `CONTROL_PLANE_ORIGIN`: CORS validation now applies only to `/api/*`, while same-origin frontend assets remain loadable. Verified backend/frontend production builds, all 69 backend tests, and Origin-specific static/API smoke checks.
- Added production Docker Compose deployment for Coolify: a multi-stage Node image serving the built frontend and Fastify API, a persistent `/app/data` volume for encrypted state, required public-origin and owner-password environment variables, container healthcheck, build-context secret exclusions, and Coolify deployment guidance. Verified Compose rendering plus shared, backend, and frontend production builds; Docker image execution is pending because the local Docker daemon is unavailable.
