FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY shared/package.json shared/package-lock.json ./shared/
RUN npm --prefix shared ci
COPY shared ./shared
RUN npm --prefix shared run build

COPY backend/package.json backend/package-lock.json ./backend/
RUN npm --prefix backend ci
COPY backend ./backend
RUN npm --prefix backend run build

COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN npm --prefix frontend ci
COPY frontend ./frontend
RUN npm --prefix frontend run build

COPY worker/package.json worker/package-lock.json ./worker/
RUN npm --prefix worker ci
COPY worker ./worker
RUN npm --prefix worker run build:bundle

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3100
ENV BITBUCKET_APPROVER_DATA_DIR=/app/data

WORKDIR /app/backend

COPY --from=build /app/shared/package.json /app/shared/package.json
COPY --from=build /app/shared/dist /app/shared/dist
COPY --from=build /app/backend/package.json /app/backend/package.json
COPY --from=build /app/backend/node_modules /app/backend/node_modules
COPY --from=build /app/backend/dist /app/backend/dist
COPY --from=build /app/frontend/dist /app/frontend/dist
COPY --from=build /app/worker/dist/worker-bundle.mjs /app/worker/dist/worker-bundle.mjs
COPY --from=build /app/worker/native/keychain-helper.swift /app/worker/native/keychain-helper.swift
COPY --from=build /app/worker/install/macos/portable-setup.sh /app/worker/install/macos/portable-setup.sh
COPY --from=build /app/worker/install/macos/portable-launcher.sh /app/worker/install/macos/portable-launcher.sh
COPY --from=build /app/worker/install/macos/portable-terminal.command /app/worker/install/macos/portable-terminal.command
COPY --from=build /app/worker/install/macos/portable-handler.applescript /app/worker/install/macos/portable-handler.applescript
COPY macos-app/releases/Bitbucket-PR-Approver-0.3.3-macOS.zip /app/macos-app/releases/Bitbucket-PR-Approver-0.3.3-macOS.zip

RUN mkdir -p /app/data && chown -R node:node /app
USER node

EXPOSE 3100

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3100/api/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/index.js"]
