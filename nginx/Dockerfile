# Build static Next explorer, then serve it from nginx alongside the Beacon API proxy.
FROM node:22-alpine AS front
WORKDIR /app

ARG NEXT_PUBLIC_API_BASE_URL=/rnaget-beacon/api
ARG API_BUILD_URL=
ARG MATRIX_IDS=
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV API_BUILD_URL=$API_BUILD_URL
ENV MATRIX_IDS=$MATRIX_IDS

COPY front/package.json front/package-lock.json ./
RUN npm ci

COPY front/ ./
RUN npm run build

FROM nginx:stable-alpine

ARG BASE_PATH=/rnaget-beacon

COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=front /app/out /usr/share/nginx/html${BASE_PATH}

CMD ["nginx", "-g", "daemon off;"]
