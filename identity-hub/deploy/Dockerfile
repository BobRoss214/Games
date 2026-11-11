# Postern application image.
#
# Build it from the project folder (the folder that contains package.json):
#   docker build -f deploy/Dockerfile -t postern .
# Usually you do not run this command yourself. `docker compose` does it.
#
# The image has one Node.js process. It listens on two ports:
#   8080  web app and API (plain HTTP; the Caddy container adds HTTPS)
#   2525  incoming mail (SMTP)
# The program runs as a user that is not root. A user that is not root must not
# depend on port numbers below 1024. Thus incoming mail uses port 2525 in the
# container, and docker-compose.yml connects port 25 of the server to it.

# ---- Stage 1: get the production packages ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
# --omit=dev        no development packages
# --ignore-scripts  packages cannot run their own programs during the install
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# ---- Stage 2: the image that runs ----
FROM node:22-alpine

# sqlite: the command-line tool that deploy/backup.sh uses.
# openssl: makes the self-signed certificate for incoming mail on the first start.
# The application itself uses the SQLite that is built into Node.js.
RUN apk add --no-cache sqlite openssl \
 && addgroup -S -g 10001 postern \
 && adduser -S -D -H -u 10001 -G postern -s /sbin/nologin postern \
 && mkdir -p /data \
 && chown postern:postern /data \
 && chmod 700 /data

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY server ./server
COPY shared ./shared
COPY web ./web

# The program files belong to root. The program can read them but cannot change them.
RUN chmod -R a+rX,go-w /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    SMTP_HOST=0.0.0.0 \
    SMTP_PORT=2525 \
    DATA_DIR=/data

USER 10001:10001

# All data that must survive a restart is in /data:
#   accounts.db, payments.db, and secret.key (if SECRET_KEY is not set).
VOLUME ["/data"]

EXPOSE 8080 2525

# Healthy = the web server answers GET /api/config. This check uses Node.js
# because the image has no curl.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/api/config').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# node:sqlite prints an "experimental" notice at each start. The flag removes that line.
# The program stops cleanly on SIGTERM (docker stop).
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
