# glibc 基础镜像 + Node 22：better-sqlite3 在 musl 及 Node 20 下均段错误
FROM node:22-bookworm-slim AS build
WORKDIR /app

# better-sqlite3 需源码编译（预编译包不可达）
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

# PDF 中文字体只用到 400Regular / 700Bold，删除其余字重以瘦身
RUN rm -rf /app/node_modules/@expo-google-fonts/noto-sans-sc/100Thin \
           /app/node_modules/@expo-google-fonts/noto-sans-sc/200ExtraLight \
           /app/node_modules/@expo-google-fonts/noto-sans-sc/300Light \
           /app/node_modules/@expo-google-fonts/noto-sans-sc/500Medium \
           /app/node_modules/@expo-google-fonts/noto-sans-sc/600SemiBold \
           /app/node_modules/@expo-google-fonts/noto-sans-sc/800ExtraBold \
           /app/node_modules/@expo-google-fonts/noto-sans-sc/900Black

# 字体缺失即构建失败，避免上线后第一次写 PDF 才暴露
RUN test -f /app/node_modules/@expo-google-fonts/noto-sans-sc/400Regular/NotoSansSC_400Regular.ttf \
 && test -f /app/node_modules/@expo-google-fonts/noto-sans-sc/700Bold/NotoSansSC_700Bold.ttf

EXPOSE 3000

CMD ["node", "dist/src/server.js"]
