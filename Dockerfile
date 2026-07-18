# News-Reel Factory — single-process server image (UI + API + queue + render).
# Render runs here on CPU (no GPU, no Smart App Control). Voice cloning needs a
# GPU and runs elsewhere (see docs/DEPLOY.md + docs/EFFICIENT-SELF-HOSTING.md).
FROM node:22-bookworm-slim

# Headless-Chrome runtime libs Remotion needs on Linux (matches the Colab list).
RUN apt-get update && apt-get install -y --no-install-recommends \
      libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
      libgbm1 libasound2 libpango-1.0-0 libcairo2 libxkbcommon0 libxcomposite1 \
      libxdamage1 libxrandr2 libxfixes3 libxi6 libgtk-3-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first (cached layer). Copy the lockfile + every workspace manifest.
COPY package*.json ./
COPY packages/composition/package.json ./packages/composition/
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/
RUN npm ci

# App source, then build the web UI so the single Node process serves it.
COPY . .
RUN npm run build:web
# Pre-fetch Chrome Headless Shell via @remotion/renderer (the standalone
# 'remotion' CLI isn't a dependency here). Non-fatal: it also downloads on the
# first local render, and gdrive+Colab mode never renders here at all.
RUN cd apps/server && node -e "import('@remotion/renderer').then(m=>m.ensureBrowser()).then(()=>process.exit(0)).catch(e=>{console.error('browser prefetch skipped:',String(e));process.exit(0)})"

# Ensure the Linux compositor binaries are executable — npm can drop the +x bit
# in a Docker build, causing ffprobe/ffmpeg to spawn with EACCES (used by the
# Draft-audio duration probe and local rendering).
RUN find node_modules/@remotion -type d -name "compositor-*" -exec sh -c 'chmod +x "$1"/ffprobe "$1"/ffmpeg "$1"/remotion 2>/dev/null || true' _ {} \;

ENV NODE_ENV=production \
    PORT=4000 \
    HOST=0.0.0.0 \
    QUEUE_BACKEND=local \
    STORAGE_DIR=/data/storage \
    QUEUE_DIR=/data/queue \
    SERVER_ORIGIN=http://127.0.0.1:4000

VOLUME ["/data"]
EXPOSE 4000

# Health check — pings whatever port the app runs on (Coolify may inject PORT).
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

WORKDIR /app/apps/server
CMD ["npm", "run", "start"]
