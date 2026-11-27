# ISP-Flow API — Node.js 24 + Express + Sequelize
FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

# Install production dependencies only (cached unless package files change)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server.js ./
COPY src ./src

# Uploaded documents live in a volume (see docker-compose.yml)
RUN mkdir -p /app/uploads && chown -R node:node /app
USER node

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/api/v1/health || exit 1

# Migrations run automatically on start (src/database/migrate.js, Umzug)
CMD ["node", "server.js"]
