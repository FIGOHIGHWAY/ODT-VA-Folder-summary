FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# ssh client is needed to run Nuclei scans remotely on its VM (see
# lib/server/nuclei.js) — the target VM has no HTTP API of its own.
RUN apk add --no-cache openssh-client
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/build ./build
EXPOSE 3000
CMD ["node", "build"]
