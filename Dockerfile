# Keyvane server image: Node.js runs the TypeScript sources directly (no build step).
FROM node:22-slim

ENV NODE_ENV=production \
    PORT=8787 \
    DATABASE_PATH=/data/keyvane.db

WORKDIR /app

# Install only the server's production dependencies.
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY packages/sdk/package.json packages/sdk/
COPY examples/pdf-analyzer/package.json examples/pdf-analyzer/
COPY examples/license-cli/package.json examples/license-cli/
RUN npm ci --omit=dev --workspace @keyvane/server --ignore-scripts && npm cache clean --force

COPY apps/server apps/server
COPY docs docs
COPY legal legal

RUN mkdir -p /data && chown -R node:node /data
USER node
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "apps/server/src/index.ts"]
