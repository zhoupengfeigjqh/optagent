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

# PDF 中文字体（2026-11-17）：`write_file` 的 `.pdf` 模式嵌入 Noto Sans SC，字体在依赖包里。
# 字体包带 9 个字重共 ~91MB，代码只用 400Regular / 700Bold —— 剔掉其余 7 个，镜像瘦 ~71MB。
RUN rm -rf /app/node_modules/@expo-google-fonts/noto-sans-sc/100Thin \
           /app/node_modules/@expo-google-fonts/noto-sans-sc/200ExtraLight \
           /app/node_modules/@expo-google-fonts/noto-sans-sc/300Light \
           /app/node_modules/@expo-google-fonts/noto-sans-sc/500Medium \
           /app/node_modules/@expo-google-fonts/noto-sans-sc/600SemiBold \
           /app/node_modules/@expo-google-fonts/noto-sans-sc/800ExtraBold \
           /app/node_modules/@expo-google-fonts/noto-sans-sc/900Black

# 构建期门禁：字体缺失就让构建失败，而不是等上线后第一次写 PDF 才炸
RUN test -f /app/node_modules/@expo-google-fonts/noto-sans-sc/400Regular/NotoSansSC_400Regular.ttf \
 && test -f /app/node_modules/@expo-google-fonts/noto-sans-sc/700Bold/NotoSansSC_700Bold.ttf

# 运行期数据（config.yaml 由 compose 挂载；.opt-agent 为数据卷）
EXPOSE 3000

# 环境变量由 docker run -e / compose env_file 注入，不依赖 .env 文件
CMD ["node", "dist/src/server.js"]
