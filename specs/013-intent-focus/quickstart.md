# 013 快速开始：意图聚焦（Intent Focus）

- **特性标识**：`013-intent-focus`
- **日期**：2026-10-25
- **适用**：本地开发与验收（宿主机）；容器只承担部署与运行（宪章原则三/八）

---

## 1. 前置

| 依赖 | 要求 |
|---|---|
| Node | ≥ 20（`agent-backend` / `frontend` 既有要求） |
| Docker | 能**本地构建**镜像（基础镜像 `python:3.13-slim` + PyPI + ModelScope 可达） |
| 内存 | 给模型容器预留 **6GB** 上限（官方占位值，实测后调整） |
| GPU | **不需要**（CPU 即可；冷启动约 90 秒） |

> **不要再拉官方镜像**（2026-10-25 实测）：`docker.io` 不可达；
> `docker.m.daocloud.io` / `docker.xuanyuan.me` / `docker.1panel.live` → **403** `not in the allowlist`；
> `dockerproxy.cn` → `EOF`；`hub.1panel.dev` → 证书不匹配；
> `docker.1ms.run` → manifest 可读但**层数据被改写**（`invalid input: magic number mismatch`）。
>
> 改为**本地自建**：源码取 `chaitin/Decis`、权重取 ModelScope `convaiinnovations/laya-multilingual`，
> 产物镜像 `laya-service`。构建细节见 `laya-service/Dockerfile` 头注释。
> 镜像体积（同一镜像，两种口径）：`docker images` **2.91GB**（未压缩磁盘占用）/ `inspect .Size` **0.88GiB**（压缩口径，十进制即 946MB）。
> 默认装 **CPU 版 torch**
> （`torch==2.9.0+cpu`）——实测判定模型就是 `device: cpu, dtype: float32`、单轮 198ms，GPU 用不上；
> 而 PyPI 默认 Linux 轮子会连带 `nvidia/*` 3.2GB + `triton` 0.9GB（那样本地会到 10.5GB）。
>
> **要换回 CUDA 版**（换到有 GPU 的机器）不改 Dockerfile，只覆盖 build-arg：
>
> ```powershell
> docker build -t laya-service `
>   --build-arg TORCH_SPEC="torch==2.14.1" `
>   --build-arg TORCH_INDEX="https://download.pytorch.org/whl/cu130" `
>   laya-service
> ```
>
> 注意两点：① torch 轮子源官方是 `download.pytorch.org/whl/cpu`，但本网络会 `incomplete-download`，
> 默认已改用上海交大镜像（`mirror.sjtu.edu.cn/pytorch-wheels/cpu`）；② CUDA 版装完可用
> `docker run --rm laya-service python -c "import torch;print(torch.__version__, torch.cuda.is_available())"` 核对。

---

## 2. 起模型服务

### 2.0 本地构建镜像（唯一入口）

```powershell
cd d:/公司项目/智能体/optagent

# 前置（首次）：源码与权重（两者都不入 git）
git clone --depth 1 https://github.com/chaitin/Decis.git laya-service/upstream
# 权重：ModelScope convaiinnovations/laya-multilingual → laya-service/models/laya-multilingual/
#   model.safetensors 614MB + tokenizer/tokenizer.json 33MB + config.json / encoder/config.json 等

# 构建（pip 走国内镜像；可用 --build-arg PIP_INDEX= 覆盖）
docker build -t laya-service laya-service
```

构建期会装 `decis` + `laya==0.3.29` → 跑 `decis doctor` 自检 → 把预置权重 COPY 进 `/models/laya-multilingual`，
产物 `docker run` **不需要任何外网**。

### 2.1 直接 docker run（最小验证）

```powershell
docker run -d --name optagent-laya -p 8103:8000 `
  -e DECIS_API_KEY=dev-laya-key `
  -e DECIS_SHUTDOWN_GRACE_MS=25000 `
  --memory 6g `
  --restart unless-stopped `
  laya-service
```

### 2.2 走根编排（部署形态）

```powershell
cd d:/公司项目/智能体/optagent
docker compose up -d laya
```

`docker-compose.yml` 的 `laya` 服务已改为 `build: ./laya-service` + `image: laya-service`；
服务名 `laya`、容器名 `optagent-laya`、容器端口 8000（宿主 8103）。

### 2.3 部署核对清单（MUST 逐项确认一次）

| # | 核对项 | 期望 |
|---|---|---|
| C1 | 镜像 tag 是否为**版本化** tag | `laya-multilingual-v0.4.0`（不是 `latest`） |
| C2 | `DECIS_API_KEY` 是否已设 | 已设；未设且非 loopback 时服务会**拒绝启动** |
| C3 | `DECIS_ALLOW_NO_AUTH` | **未设**（保持鉴权开启） |
| C4 | `DECIS_SHUTDOWN_GRACE_MS` | `25000` |
| C5 | 上游 `configuration.md` 的其它变量 | 按镜像默认；若镜像要求必设项，补进 `.env.local` 并在 `plan.md` 复杂度跟踪登记 |
| C6 | `/healthz` | 200（进程存活） |
| C7 | `/readyz` | 冷启动期 503 属正常；**持续 503 是终态故障**，需告警而非重试 |
| C8 | `/v1/models` | 返回含 `laya-multilingual` |

```powershell
curl.exe -s http://127.0.0.1:8103/healthz
curl.exe -s http://127.0.0.1:8103/readyz
curl.exe -s -H "Authorization: Bearer dev-laya-key" http://127.0.0.1:8103/v1/models
```

---

## 3. 运行侧配置

`agent-backend/config.yaml` 追加（本地直跑用 `127.0.0.1`，容器内用服务名 `laya`）：

```yaml
intent_focus:
  base_url: http://127.0.0.1:8103
  model: laya-multilingual
  api_key: $DECIS_API_KEY
  timeout_ms: 10000      # 300~10000
  threshold: 0.6         # 0~1；2026-10-26 命题改版后的标定拐点
                         # 注意：不再有 max_actions（入选按阈值全量筛选，留着该键会启动失败）
```

`agent-backend/.env.local`：

```ini
DECIS_API_KEY=dev-laya-key
# 判定阈值（可选）：0~1，优先于 config.yaml 的 intent_focus.threshold
INTENT_FOCUS_THRESHOLD=0.6
```

> 阈值是唯一支持"环境变量 + 配置文件"双源的参数，**环境变量优先**；改 `INTENT_FOCUS_THRESHOLD`
> 后重启 backend 即生效，无需改挂载的 `config.yaml`。

> 未配置整块也能启动：功能按"未配置"降级（不判定、不追加提示、留档标注）。

---

## 4. 门禁命令（本地，单命令一条链）

```powershell
cd agent-backend;   npm run lint; npm run typecheck; npm run test; npm run test:integration; npm run test:coverage; npm run build
cd frontend;        npm run lint; npm run typecheck; npm run test:coverage; npm run build
cd admin-backend;   npm run lint; npm run typecheck; npm run test:coverage; npm run build
cd admin-frontend;  npm run lint; npm run typecheck; npm run test:coverage; npm run build
```

**硬门禁复核**（改完必测）：

| 文件 | 基线 | 要求 |
|---|---|---|
| `agent-backend/src/domain/run-manager.ts` | **539** | 拆分后 **≤500** |
| `agent-backend/src/server.ts` | **498** | 装配外移后 **≤500**（预计 ~470） |
| `agent-backend/src/domain/intent-focus.ts` | 新增 | ≤500，且 ≥80% 覆盖 |
| `agent-backend/src/infra/laya-client.ts` | 新增 | ≤500，且 ≥80% 覆盖 |
| `admin-backend/.../soul-design.ts` | 490 | 改动后 **≤500** |

---

## 5. 端到端场景（人工验收）

> 前置：数字人在管理台勾选「意图聚焦」→ 保存 → 部署；聊天前台选中该数字人。

| # | 场景 | 期望 |
|---|---|---|
| S1 | 手输与工具强相关的输入（如"这批订单能不能插单"） | 回答正常；`intent-focus.jsonl` 新增一行 `focused`；`focus_prompt` 含 `order_query` 类工具名 |
| S2 | 手输闲聊（如"你好"） | 回答正常；记录 `empty`；素材中无聚焦提示 |
| S3 | 点击回答下方的下一步动作卡片 → 确认发送 | 记录 `skipped`，`reason=skip:next_action_card`；卡片自带引导照常生效 |
| S4 | 点击首屏问题实例卡片 | 记录 `skipped`，`reason=skip:starter_card` |
| S5 | 管理台取消勾选 → 保存 → 部署，再对话 | **无新增记录**、无判定调用（看日志无 `intent-focus.*`） |
| S6 | 停掉 Laya 容器，再手输 | 回答正常、无错误提示；记录 `degraded`（`timeout` 或连接失败），日志 `alert: true` |
| S7 | 注释掉 `intent_focus` 配置块并重启 backend，再对话 | 记录 `unconfigured`；回答正常 |
| S8 | 连续两轮手输 | 两轮各自独立记录；第二轮素材**不含**第一轮的聚焦提示（检查方法见 §6.3） |

---

## 6. 非交互冒烟（部署后，MUST NOT 替代测试结论）

### 6.1 服务可达

```powershell
curl.exe -s -o NUL -w "%{http_code}`n" http://127.0.0.1:82/api/models
curl.exe -s -o NUL -w "%{http_code}`n" -H "Authorization: Bearer dev-laya-key" http://127.0.0.1:8103/v1/models
```

### 6.2 跳过标记被接受（不改变状态码与事件序列）

```powershell
curl.exe -s -X POST http://127.0.0.1:82/api/threads/<threadId>/messages `
  -H "Content-Type: application/json" `
  -d "{\"content\":\"测试\",\"skip_intent_focus\":true}"
```

期望：与不带该字段时的响应形状、状态码、SSE 事件序列**完全一致**。

### 6.3 上下文隔离抽查（S8）

```powershell
# 记录文件（应有两行，disposition 分别为 focused/empty，视输入而定）
Get-Content agent-backend/.opt-agent/users/<uid>/user-data/<agentName>/threads/<threadId>/intent-focus.jsonl

# 历史文件（MUST NOT 出现 focus_prompt 原文）
Select-String -Path agent-backend/.opt-agent/users/<uid>/user-data/<agentName>/threads/<threadId>/history.jsonl `
  -Pattern "本轮可优先考虑以下工具（仅供参考，不必局限）" -SimpleMatch
```

期望：第二条命令**无输出**。

---

## 7. 阈值与题量标定（实现期一次性）

Laya 的真值概率在"多题同批"下是否仍可比较，需要一次标定（写入 `tasks.md` 的验收证据）：

| 步骤 | 做法 | 期望 |
|---|---|---|
| B1 | 取 10 条真实输入 × 该数字人真实工具清单（N≈8） | — |
| B2 | 用 `node scripts/calibrate-intent-focus.mjs --prompt current --threshold 0.6` 跑一遍，看 top1 / 入选精确率 / 召回 / 误选最高分 | 相关工具入选、无关工具不入选 |
| B3 | 调 `--threshold`（0.5 / 0.55 / 0.6 / 0.65）扫一遍，看召回与误选最高分的变化拐点；定下来的值再写进**环境变量** `INTENT_FOCUS_THRESHOLD`（改完重启 backend，无需动 `config.yaml`） | 找到召回与噪声的平衡点（现行 0.6） |
| B4 | 记录 P90 判定耗时（`round_ms`）与 N 的关系 | P90 ≤ 2s（规格 SC-002） |
| B5 | 把结论写入 `research.md` 附录或 `tasks.md` 验收记录 | 可复现 |

---

## 8. 常见问题

| 现象 | 排查 |
|---|---|
| 记录全为 `unconfigured` | `config.yaml` 的 `intent_focus` 是否挂进容器（compose 挂载了整份 `config.yaml`）；`DECIS_API_KEY` 是否已注入 |
| 记录全为 `degraded` 且 `status=401` | 两侧 token 不一致（容器 `DECIS_API_KEY` ≠ 运行侧 `api_key`） |
| `degraded` 且 `invalid_response` | 请求打到了非 Laya 的地址（检查 `base_url` 是否含 `/v1/systemone` 之外的路径拼接错误） |
| 判定总是 `empty` | 工具清单为空（该数字人未配工具）；或阈值过高（按 §7 标定） |
| 首轮耗时明显变长 | 冷启动：Laya 首次加载约 2 分钟，`/readyz` 未就绪时判定会超时降级；属预期，等就绪即可 |
| 部署后功能"消失" | 检查 `SOUL.md` frontmatter 是否**没有** `intent_focus` 键（关闭态不写键，属预期） |
