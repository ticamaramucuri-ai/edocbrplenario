FROM oven/bun:1.4.2
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY mini-services/realtime/package.json mini-services/realtime/bun.lock ./mini-services/realtime/
RUN cd mini-services/realtime && bun install --frozen-lockfile

COPY . .
RUN sed -i 's/provider = "sqlite"/provider = "postgresql"/' prisma/schema.prisma \
    && bunx prisma generate

ARG NEXT_PUBLIC_REALTIME_URL=http://127.0.0.1:3103
ENV NEXT_PUBLIC_REALTIME_URL=${NEXT_PUBLIC_REALTIME_URL}
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build
RUN bun run build

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
CMD ["bun", ".next/standalone/server.js"]
