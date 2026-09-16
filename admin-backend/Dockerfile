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

EXPOSE 3000

# 环境变量由 compose 注入（不使用 .env 文件）
CMD ["node", "dist/src/server.js"]
