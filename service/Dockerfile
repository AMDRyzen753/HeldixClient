# Heldix-Dienst als Container.
#   docker build -t heldix-dienst .
#   docker run -d -p 127.0.0.1:8787:8787 -v heldix-dienst-daten:/data heldix-dienst

# 1) Bauen (TypeScript braucht die Entwicklungspakete)
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# 2) Laufen: nur dist/ und die Laufzeitpakete (ws, reines JavaScript)
FROM node:24-alpine
ENV NODE_ENV=production \
    PORT=8787 \
    HELDIX_DIENST_DATA=/data
WORKDIR /app
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/server.js"]
