# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY . .
ARG EXPO_PUBLIC_AGENT_API_URL=
ARG EXPO_PUBLIC_GOOGLE_CLIENT_ID=
ENV EXPO_PUBLIC_AGENT_API_URL=$EXPO_PUBLIC_AGENT_API_URL
ENV EXPO_PUBLIC_GOOGLE_CLIENT_ID=$EXPO_PUBLIC_GOOGLE_CLIENT_ID
RUN npm run web:export

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV AGENT_SERVER_PORT=8080
ENV WEB_DIST_DIR=/app/dist
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY scripts ./scripts
EXPOSE 8080
CMD ["node", "server/agent-server.mjs"]
