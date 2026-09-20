# ===== 构建阶段：安装全部依赖并编译 TS =====
# 与 agent-backend 同构（Debian/glibc + Node 22），但**不含** better-sqlite3，
# 故无需 python3/make/g++ 构建工具链。
FROM node:22-bookworm-slim AS build
WORKDIR /app

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

# 与本地形态同一口径统一 3001（2026-09-20）；EXPOSE 仅为元数据声明，
# 不绑定/发布端口，容器间互访走 compose 网络 + 服务名，实际监听以 PORT 环境变量为准
EXPOSE 3001

# 环境变量由 compose env_file 注入（容器形态配置 = 入库的 .env；不使用 .env.local）
CMD ["node", "dist/src/server.js"]
