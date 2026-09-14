# 003: OCR MCP 服务与签名直链文件分发（2026-09-13）

## 背景与目标

引入图片文字识别能力，并确立"MCP 服务取用户文件"的统一范式：

- OCR 以独立 MCP 服务运行（RapidOCR，Python FastMCP，Streamable HTTP 传输），容器化部署
- MCP 服务（本地容器或未来远程服务）**无磁盘访问权**，取文件一律走 backend 签发的签名直链回源
- LLM 与前端只接触 **user-data 相对路径**（**2026-09-13 修订**：示例为 `临时空间/a.png`，三空间中文目录名），绝对路径不出 backend
- 基础设施与文件类型无关：未来任意 MCP 服务收文件（PDF/Excel/…）复用同一套机制

## 架构

```
用户 @ 引用图片 → 引用段 "[引用文件] 临时空间/a.png"（统一相对路径）
→ LLM 调 ocr__ocr_image(image="临时空间/a.png")
→ backend 适配层命中 file_args 声明：
    FileAccess.resolveVerified() 沙箱校验（拒绝对路径/防穿越/目录白名单/realpath/必须真实文件）
    → mintSignedUrl() 铸签名直链（HMAC-SHA256 绑定 u/p/exp，24h 时效）
    → 参数原位置换为 URL 发给 MCP 服务
→ OCR 服务：host 白名单校验（防 SSRF）→ GET URL → 限 2MB/10s 下载
→ backend GET /api/files/raw：验签 + FileAccess 再校验 → 流出文件
→ OCR：cv2.imdecode 内存识别（不落盘）→ 文本回喂 LLM
```

与内置工具的关系：@ 引用 → 相对路径 → FileAccess 沙箱校验为共用主干；
校验通过后分叉——内置工具本地直读磁盘，MCP 工具铸签名 URL 回源。

## 关键决策

| 决策 | 结论 | 理由 |
|---|---|---|
| 传路径 / base64 / URL | **签名 URL** | base64 体积 +33%、2MB 上限外不可扩展；URL 是通用"文件对外分发"设施，远程部署天然支持 |
| LLM 传相对还是绝对路径 | **相对**（与内置工具统一） | LLM 世界观只有一种路径形式；绝对路径/沙箱结构不外泄 |
| OCR 容器共享数据卷 | **已移除** | 最小权限：OCR 只能拿到 URL 签名的那一个文件 |
| 签名密钥 FILE_SIGN_SECRET | 服务端 .env 统一管理 | 基础设施印章，非用户资产；将来可派生子密钥（K_user = HMAC(master, userId)） |
| 签名时效 | 24h | 远程服务可能跨时段回源 |
| OCR 图片上限 | 2MB（OCR_MAX_BYTES 可配） | 大图识别慢且收益低 |

## 配置契约

### MCP.json 新增 file_args 声明（数字人级）

```json
{ "name": "ocr", "transport": "http", "url": "http://ocr:8000/mcp",
  "file_args": { "ocr_image": { "image": "url" } } }
```

- 工具名 → { 参数名: "url" }；命中声明的参数在调用前做 相对路径→签名URL 置换
- 未声明的 server/工具/参数原样透传；参数名必须与服务端工具签名一致

### backend 环境变量

- `PUBLIC_BASE_URL`：签名链对外基址（MCP 服务回源可达的地址；缺省 `http://localhost:{PORT}`，Docker 内设 `http://backend:3000`）
- `FILE_SIGN_SECRET`：HMAC 密钥（≥16 字符；缺省启动随机生成——重启后已签发 URL 失效，生产必须固定）

### OCR 服务环境变量

- `OCR_URL_ALLOW_HOSTS`：回源 host 白名单（SSRF 防护，缺省 `backend`）
- `OCR_MAX_BYTES`：图片上限（缺省 2MB）
- `OCR_DOWNLOAD_TIMEOUT_S`：下载超时（缺省 10s）

## API 变更

### GET /api/files/raw（新增）

签名直链回源端点，URL 即凭证（无会话）：

- 参数：`u`（用户）、`p`（user-data 相对路径）、`exp`（过期 epoch ms）、`sig`（HMAC hex）
- `200`：文件字节，Content-Type 按扩展名映射，`Cache-Control: no-store`
- `403 FILE_SIGN_INVALID`：验签失败/过期；`404 FILE_NOT_FOUND`：文件不存在或越权；`400`：缺参

### POST /api/files/upload（扩展名放开）

- 白名单新增图片：`.jpg/.jpeg/.png/.bmp/.webp/.gif/.tif/.tiff`
- 前端预览新增 `image` 分派（`.tif/.tiff` 浏览器不支持，归下载回退）

## 组件清单

| 组件 | 位置 |
|---|---|
| 签名铸造/验签 | `src/infra/file-sign.ts`（mintSignedUrl / verifyRef / signRef） |
| 回源端点 | `src/routes/files.ts` GET /api/files/raw |
| 适配层转换 | `src/infra/mcp/mcp-tool-adapter.ts` rewriteFileArgs（沙箱拒绝→文本工具结果，LLM 可自我纠正） |
| 依赖注入 | `src/infra/agent-factory.ts` runWith（按 server.fileArgs 构造 FileAccess + mintUrl 闭包） |
| 配置解析 | `src/types.ts` McpServerConfig.fileArgs；`src/domain/agent-instance.ts` parseFileArgs |
| 沙箱 | `src/domain/file-access.ts` resolveVerified（新增公开方法） |
| OCR 服务 | `ocr-service/server.py`（FastMCP + RapidOCR + httpx 回源下载） |
| 前端 | `constants/limits.ts` 上传白名单；`utils/file-kind.ts` image 分派；`usePreview.ts` / `WorkspacePanel.vue` `<img>` 预览 |

## 安全模型

- LLM 只见相对路径；绝对路径仅存在于 backend 内存
- 双侧把关：铸造时 FileAccess 校验，下载时端点再校验（即使密钥泄露，URL 也指不出沙箱）
- 签名绑定 userId：跨用户篡改验签即失败
- SSRF：OCR 仅允许回源白名单 host；拒绝重定向（follow_redirects=False）
- FILE_SIGN_SECRET 等价于文件签发权：不入库、不回传、不入 git

## 部署（Docker Compose）

- `gateway`（nginx，宿主 82 端口）→ `frontend`（静态）/ `backend:3000` / 内网 `ocr:8000`
- `ocr` 无卷挂载；`backend` 挂 `optagent-data` 卷 + `config.yaml` + `.env`
- 已知镜像约束：better-sqlite3 源码编译在 Node 20 上 SIGSEGV，须 `node:22-bookworm-slim`

## 测试

- 单测：`file-sign.test.ts`（往返/过期/篡改/格式）、`mcp-tool-adapter.test.ts`（置换/沙箱拒绝/透传）
- 集成：`files-raw.test.ts`（200/403/404/400）
- 端到端（容器）：上传图片 → @ 引用 → LLM 调 ocr__ocr_image → 无盘 OCR 容器回源识别成功；SSRF host 拦截实测

## 已知遗留

- **MCP 建连竞态**：选中数字人后立即发首条消息，MCP 连接可能未就绪导致该轮无 OCR 工具（重发即可）。候选修复：后端等 connectAll 落定再放行，或前端建连完成前禁发
- 用户级 LLM 配置（BYOK）与登录体系：已分析待实施（settings/llm.json，用户自配模型 key；FILE_SIGN_SECRET 维持服务端统一管理）
