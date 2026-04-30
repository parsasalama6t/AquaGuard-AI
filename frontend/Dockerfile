# ── Stage 1: deps ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --frozen-lockfile


# ── Stage 2: dev server ───────────────────────────────────────────────────────
# Used by docker-compose for local development — hot reload included.
FROM node:20-alpine AS dev

WORKDIR /app

# Copy installed node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Source is bind-mounted at runtime by docker-compose, so we only need
# the package manifest here to allow npm scripts to run.
COPY package.json ./

EXPOSE 5173

# --host 0.0.0.0 makes Vite reachable outside the container
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]


# ── Stage 3: production build ─────────────────────────────────────────────────
# Run `docker build --target prod -t aquaguard-frontend .` for a static build
# served by nginx.
FROM node:20-alpine AS build

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build


FROM nginx:alpine AS prod

COPY --from=build /app/dist /usr/share/nginx/html

# Minimal nginx config: forward unknown paths to index.html for SPA routing
RUN printf 'server {\n\
    listen 80;\n\
    root /usr/share/nginx/html;\n\
    index index.html;\n\
    location / {\n\
        try_files $uri $uri/ /index.html;\n\
    }\n\
}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 80
