# One service: Express API + built Pliant/classic frontends, mock studio by default (public demo costs nothing).
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/* && npm i -g pnpm@12
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build:web
ENV NODE_ENV=production PLIANT_MOCK=1 PLIANT_DEMO=1 PORT=4000
EXPOSE 4000
CMD ["pnpm", "--filter", "chat-backend", "start"]
