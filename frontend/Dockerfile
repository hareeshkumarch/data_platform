# Lumen frontend — multi-stage build: Vite → static assets → nginx.
FROM node:20-alpine AS build

WORKDIR /app

# Layer caching
COPY package.json yarn.lock* ./
RUN yarn install --frozen-lockfile || yarn install

COPY . .

ARG REACT_APP_BACKEND_URL
ENV REACT_APP_BACKEND_URL=${REACT_APP_BACKEND_URL}

RUN yarn build


FROM nginx:alpine AS runtime

# Minimal nginx config with SPA fallback and long-lived asset caching.
RUN rm /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

RUN printf 'server {\n  listen 80;\n  root /usr/share/nginx/html;\n  index index.html;\n  location /assets/ {\n    expires 1y;\n    add_header Cache-Control "public, immutable";\n  }\n  location / {\n    try_files $uri /index.html;\n  }\n}\n' \
        > /etc/nginx/conf.d/default.conf

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost/ >/dev/null || exit 1
