FROM node:20-bookworm-slim AS builder

WORKDIR /app

COPY Project/IA/package*.json ./
RUN npm ci

COPY Project/IA/ ./
RUN npm run build && npm prune --omit=dev

FROM node:20-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=5 CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then((res) => { if (!res.ok) throw new Error('healthcheck failed'); }).then(() => process.exit(0)).catch(() => process.exit(1))"

CMD ["node", "dist/api-server.js"]
