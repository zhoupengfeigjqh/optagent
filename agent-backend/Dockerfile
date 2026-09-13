# ===== 构建阶段：安装全部依赖并编译 TS =====
# Debian（glibc）基础：better-sqlite3 在 musl 上运行期段错误；
# Node 20.20 下源码编译产物同样段错误，故用 Node 22（vitest 5 也要求 ^22.12）
FROM node:22-bookworm-slim AS build
WORKDIR /app

# better-sqlite3 预编译包下载不可达，需源码编译工具链
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ===== 运行阶段：仅保留 dist + 生产依赖 =====
FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

# 运行期数据（config.yaml 由 compose 挂载；.opt-agent 为数据卷）
EXPOSE 3000

# 环境变量由 docker run -e / compose env_file 注入，不依赖 .env 文件
CMD ["node", "dist/src/server.js"]
