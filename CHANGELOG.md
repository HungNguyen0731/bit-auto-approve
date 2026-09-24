# Changelog

## [Unreleased]

- Added production Docker Compose deployment for Coolify: a multi-stage Node image serving the built frontend and Fastify API, a persistent `/app/data` volume for encrypted state, required public-origin and owner-password environment variables, container healthcheck, build-context secret exclusions, and Coolify deployment guidance. Verified Compose rendering plus shared, backend, and frontend production builds; Docker image execution is pending because the local Docker daemon is unavailable.
