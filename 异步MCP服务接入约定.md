# `hd_scheduling_submit` 异步 MCP 服务约定

> 服务：`hd`（单工序排产）｜工具：`hd_scheduling_submit`
> 结构范本：`ocr-service`（已跑通）。本文所有平台侧规则均取自其实际实现。
> 更新日期：2026-09-26（§4 结果形状统一：`status` 只有 `success` / `failed`，业务细分码放 `code`）

---

## 1. 原理（三步）

```
① 输入     工具 inputSchema 里声明 result_url      → 平台自动注入（模型看不到）
② 提交     立即返回受理 JSON（含 job_id）           → 模型据此回复"已受理"
③ 回写     算法算完后 POST 回 result_url           → 平台落盘 → "后台记录"出现条目
```

`result_url` 就是**开关**：有值走异步，缺省/不可信走同步。

**改造的收益**：当前同步模式下，工具会阻塞等算法回调（上限 `求解时间 + 60 秒`），而平台单次 MCP 调用超时是 5 分钟 —— 求解超过 4 分钟就必然超时，且**超时后平台会重试 1 次，算法侧收到两次提交**。异步化后调用毫秒级返回，不再有这个问题。

---

## 2. 输入结构

### 2.1 平台要求（三条硬规则）

| # | 规则 |
|---|---|
| 1 | `properties` 里**必须有 `result_url`**（名字逐字一致），类型 `string` 即可 |
| 2 | **不要放进 `required`**（有默认值即不在 required，平台照样注入） |
| 3 | 声明后平台会**从给模型的 schema 中删掉它** —— 模型看不到、填不了；注入时**覆盖**模型填的任何值 |

### 2.2 完整 `inputSchema`（在你现有结构上只加 `result_url`）

```json
{
  "name": "hd_scheduling_submit",
  "description": "提交单工序排产任务。本工具**立即返回受理**（含 job_id），求解在算法侧后台进行，完成后结果自动出现在后台记录里、并可在后续对话中读取，无需重复提交。排产输入配置共 7 个属性：capacityVersion（产能信息数据版本）、lineVersion（产线信息数据版本）、electricityVersion（产线电价信息数据版本）、planVersion（排产计划数据版本）、switchVersion（工单切换时间数据版本）、solvingTime（求解时间，单位秒）、targetPriorities（目标优先级配置列表）。5 个数据版本均为 realRelativePath，即 Excel 解析入库时的 source_value，每一类必须指定且只能指定一个版本，5 类缺一不可。目标优先级规则编码固定为 PR001~PR009，只设置优先级数字，数字越小优先级越高，不设置（留空）表示该规则不参与本次求解。受理后算法侧求解上限为「求解时间 + 60 秒兜底缓冲」：按时完成、超时撤销、求解失败都会产出结果。结果均可在后台记录中查看。",
  "inputSchema": {
    "type": "object",
    "properties": {
      "uid": { "type": "string", "description": "用户ID，用于标记任务归属" },
      "sid": { "type": "string", "description": "会话ID，用于标记任务归属" },
      "input": {
        "type": "object",
        "description": "排产输入配置，包含 7 个属性",
        "properties": {
          "capacityVersion": { "type": "string", "description": "产能信息的数据版本（businessType=1），aps_production_capacity.source_value" },
          "lineVersion": { "type": "string", "description": "产线信息的数据版本（businessType=2），aps_production_line.source_value" },
          "electricityVersion": { "type": "string", "description": "产线电价信息的数据版本（businessType=3），aps_production_line_electricity.source_value" },
          "planVersion": { "type": "string", "description": "排产计划的数据版本（businessType=4），aps_production_plan.source_value" },
          "switchVersion": { "type": "string", "description": "工单切换时间的数据版本（businessType=5），aps_switch_time.source_value" },
          "solvingTime": { "type": "integer", "description": "求解时间（秒）。限制算法侧求解时长；算法侧等待上限为「求解时间 + 60 秒兜底缓冲」，超出即判为超时，不产出可用排产结果" },
          "targetPriorities": {
            "type": "array",
            "description": "目标优先级配置列表，ruleId 固定取 PR001~PR009，rulePriority 越小优先级越高，留空表示该规则不参与本次求解",
            "items": {
              "type": "object",
              "properties": {
                "ruleId": { "type": "string", "enum": ["PR001","PR002","PR003","PR004","PR005","PR006","PR007","PR008","PR009"], "description": "规则编码，固定为 PR001~PR009" },
                "rulePriority": { "type": "integer", "description": "规则优先级，数字越小优先级越高；为空则不考虑该规则" }
              },
              "required": ["ruleId"]
            }
          }
        },
        "required": ["capacityVersion","lineVersion","electricityVersion","planVersion","switchVersion","solvingTime","targetPriorities"]
      },
      "result_url": {
        "type": "string",
        "description": "结果回写地址，由运行环境自动注入，模型无需填写"
      }
    },
    "required": ["uid", "sid", "input"]
  }
}
```

**相比现状，只改三处**：① 新增 `result_url`；② `description` 把"同步等待结果"改成"立即返回受理"（这段文本**直接给模型看**，不改会让模型以为一调用就阻塞几分钟而不敢用）；③ `solvingTime` 说明里去掉"决定本工具最长等待时间"。

---

## 3. 提交后的返回（立即返回给模型）

```json
{
  "job_id": "hd_1790328130074_4005b4b0",
  "status": "accepted",
  "message": "已受理，正在后台求解；完成后结果会自动出现在后台记录与后续对话里，无需重复提交。"
}
```

| 字段 | 说明 |
|---|---|
| `job_id` | `hd_<毫秒时间戳>_<随机8位>`；模型会复述给用户，也是回写 `filename` 的主干 |
| `status` | 固定 `"accepted"` |
| `message` | 含"无需重复提交" —— 否则模型常会再调一次，白排一遍 |

**同步降级**（`result_url` 缺失或不在白名单）：直接返回原来的同步结果，并在前面说明原因：

```
错误：URL 主机 evil 不在允许名单（backend, 192.168.1.7）；请在容器的 HD_URL_ALLOW_HOSTS 中声明该主机
（回写地址不可用，已改为同步返回）
{算法返回的完整结果}
```

---

## 4. 后台完成后的回写

### 4.1 请求形状

```http
POST {result_url}&filename=hd_1790328130074_4005b4b0.json&summary=排产完成（code=80），12 条工单
Content-Type: application/json; charset=utf-8

{统一结果 JSON，见 4.3}
```

| 项 | 规定 |
|---|---|
| **必须保留** `result_url` 原有 query | `u/d/exp/sig/sid/call_id/tool` 一个不丢；否则 403 或写错目录 |
| 追加参数方式 | **用 URL 解析器**追加，不能字符串拼 `&filename=`（URL 可能已有 query / 带 fragment） |
| `filename` | `{job_id}.json`；不含路径分隔符、不含 `..`、非空 |
| `summary` | **MUST 提供**（界面标题的唯一来源），一行 ≤200 字符，且**失败结论前置**（见 4.4） |
| body | **统一结果 JSON**（UTF-8），非空；形状见 4.3 |
| 成功判据 | HTTP `200` 或 `202` |

### 4.2 取值一览

| 项 | 取值 | 说明 |
|---|---|---|
| `job_id` | `hd_<毫秒>_<8位随机>` | 前缀 `hd_` 必须保留：多服务共存时 job_id 全局唯一，否则落盘互相覆盖 |
| `filename` | `{job_id}.json` | 结果是结构化 JSON，用 `.json` |
| `summary` | 由 `status` + `code` 生成（见 4.4） | 界面上那一行标题；**必须提供** |
| body | 统一结果 JSON（见 4.3） | 平台**不解析**，原样存、原样读（模型用 `read_file` 取） |

### 4.3 结果形状（**统一**，2026-09-26）

回写的 body **MUST** 是**标准 JSON**，且**成功与失败同一形状**：

```jsonc
{
  "status": "success" | "failed",   // ★ 统一取值域：平台与界面**只**按它判成败
  "code": 80,                       // 业务细分码（建议提供；语义由本服务自定义）
  "message": "排产完成，12 条工单",  // 一行给人看的说明；失败时是**原因**
  ...                               // 其余业务字段（如 orderCount / orders）
}
```

| 字段 | 必填 | 规定 |
|---|---|---|
| `status` | ✅ | **只能是 `"success"` 或 `"failed"`**。MUST NOT 用数字或其它字符串——平台与界面**不做任何映射**，直接据此判成败 |
| `code` | 建议 | 业务细分码（如排产 `80` 完成 / `2` 超时 / `90` 失败）。可缺省；语义由服务自定 |
| `message` | 建议 | 一行可读说明；失败时是原因。同时作为 `summary` 的取值来源（见 4.4） |
| 其他业务字段 | 可选 | 如 `orderCount` / `orders`；平台不解析，只是原样存给人和模型读 |

- **MUST NOT** 用自然语言纯文本作结果；
- **失败 MUST 照常回写**（否则界面上什么都不出现，用户无法区分"还在算 / 失败了 / 挂了"）；
- **同步路径同样适用**：`result_url` 缺省时的**同步返回** MUST 是**同一形状**（`status: success|failed` + `code`）——
  不得只在异步回写时统一，否则模型在同步/异步两条路径上会看到两套形状；
- 平台对本 JSON **仍不解析**（原样存、原样读）；`status` 的**取值域由服务保证**。

### 4.4 摘要映射（决定界面标题；**硬规则**）

`summary` 参数 **MUST 提供**——它是界面标题的**唯一**来源；且 **MUST 表达业务成败**，
**失败结论 MUST 前置**（标题是**单行省略号**，结论写在末尾会被截掉）。

| `status` / `code` | 建议 `summary` |
|---|---|
| `success` / `80` | `排产完成（code=80），{N} 条工单` |
| `failed` / `2` | `失败 · 排产超时（code=2），本次提交已撤销，可调大 solvingTime 后重试` |
| `failed` / `90` | `失败 · 排产失败（code=90）` |
| 其他 | `排产结束（code={code}）` |

### 4.5 回写示例（成功 / 失败**同一形状**）

**成功（`status=success`，`code=80`）**：

```json
{
  "status": "success",
  "code": 80,
  "message": "排产完成，12 条工单",
  "orderCount": 12,
  "orders": [
    { "orderNo": "WO-1001", "line": "L1", "start": "2026-09-26T08:00:00", "end": "2026-09-26T12:00:00" }
  ]
}
```

**超时 / 失败（`status=failed`，`code=2` / `90`）** —— **也要回写**：

```json
{
  "status": "failed",
  "code": 2,
  "message": "求解超时，本次提交已撤销"
}
```

> 失败不回写的话，界面上什么都不出现，用户无法区分"还在算 / 超时了 / 挂了"。
> 注意：平台 sidecar 里的 `status` 恒为 `done`（回写即完成），业务成败只体现在**正文的 `status`** 和 **`summary`** 里。

### 4.6 平台响应

| 响应 | 含义 |
|---|---|
| `202 {"path":"临时空间/后台产出/…","size":1234}` | 落盘成功 |
| `403 FILE_SIGN_INVALID` | 签名无效/过期（任务超过 24 小时） |
| `400 VALIDATION_FAILED` | `filename` 非法 / body 为空 |
| `413` | body 超过 5MB —— 结果可能很大时，请先判大小、超限则降级为只回写状态 |

---

## 5. Demo（`hd` 服务，可直接跑）

```python
"""排产 MCP 服务：hd_scheduling_submit（异步）。结构对齐 ocr-service。"""
import json
import os
import sys
import threading
import time
import uuid
from typing import Annotated, Literal
from urllib.parse import parse_qsl, urlencode, urlparse, urlsplit, urlunsplit

import httpx
from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel, Field

mcp = FastMCP("hd", host="0.0.0.0", port=8002)          # 端口按你的部署改

# ── 常量 ──────────────────────────────────────────────────────
JOB_PREFIX = "hd"                                       # ★ 必须保留：跨服务唯一
RESULT_SUFFIX = ".json"
SUMMARY_MAX_CHARS = 200
MAX_BODY_BYTES = 5 * 1024 * 1024                        # 平台上限 5MB，超出回写会 413
UPLOAD_TIMEOUT = float(os.environ.get("HD_UPLOAD_TIMEOUT_S", "10"))
ALLOW_HOSTS = {                                         # 值 = 平台 PUBLIC_BASE_URL 的 host
    h.strip().lower()
    for h in os.environ.get("HD_URL_ALLOW_HOSTS", "").split(",")
    if h.strip()
}


# ── 输入结构（pydantic → FastMCP 自动生成 inputSchema）──────────
class TargetPriority(BaseModel):
    ruleId: Literal["PR001", "PR002", "PR003", "PR004", "PR005", "PR006", "PR007", "PR008", "PR009"] = Field(
        description="规则编码，固定为 PR001~PR009"
    )
    rulePriority: int | None = Field(
        default=None, description="规则优先级，数字越小优先级越高；为空则不考虑该规则"
    )


class SchedulingInput(BaseModel):
    capacityVersion: str = Field(description="产能信息的数据版本（businessType=1），aps_production_capacity.source_value")
    lineVersion: str = Field(description="产线信息的数据版本（businessType=2），aps_production_line.source_value")
    electricityVersion: str = Field(description="产线电价信息的数据版本（businessType=3），aps_production_line_electricity.source_value")
    planVersion: str = Field(description="排产计划的数据版本（businessType=4），aps_production_plan.source_value")
    switchVersion: str = Field(description="工单切换时间的数据版本（businessType=5），aps_switch_time.source_value")
    solvingTime: int = Field(description="求解时间（秒）。算法侧等待上限为「求解时间 + 60 秒兜底缓冲」，超出即判为超时，不产出可用排产结果")
    targetPriorities: list[TargetPriority] = Field(
        description="目标优先级配置列表，ruleId 固定取 PR001~PR009，rulePriority 越小越高，留空表示不参与"
    )


# ── 工具入口：立即受理 ─────────────────────────────────────────
@mcp.tool()
def hd_scheduling_submit(
    uid: Annotated[str, Field(description="用户ID，用于标记任务归属")],
    sid: Annotated[str, Field(description="会话ID，用于标记任务归属")],
    input: SchedulingInput,  # noqa: A002  参数名与既有 schema 一致
    result_url: Annotated[
        str | None,
        Field(
            description=(
                "结果回写地址。**由平台自动注入，请勿自行填写**；"
                "留空（默认）时按同步方式阻塞返回统一结果 JSON（§4.3）"
            )
        ),
    ] = None,
) -> str:
    """提交单工序排产任务。

    本工具**立即返回受理**（含 job_id），求解在算法侧后台进行；完成后结果自动出现在
    后台记录里、并可在后续对话中读取，无需重复提交。留空 result_url 时按同步方式返回
    **统一结果 JSON**（§4.3，`status` 同样是 success/failed）。
    """
    if result_url:
        err = check_url(result_url)
        if err:
            # 回写地址不可信（模型幻觉 / 被篡改）：忽略它并降级为同步。
            # 不能照样 POST（SSRF）；也不能静默丢弃（调用方会一直等不到结果）。
            return f"{err}\n（回写地址不可用，已改为同步返回）\n" + json.dumps(
                result_payload(submit_and_wait(uid, sid, input)), ensure_ascii=False
            )
        job_id = make_job_id()
        threading.Thread(
            target=_submit_and_post, args=(job_id, uid, sid, input, result_url), daemon=True
        ).start()
        return accepted_payload(job_id)
    # 无 result_url = 同步：同样返回**统一结果形状**（平台/模型看到的形状与异步路径一致）
    return json.dumps(result_payload(submit_and_wait(uid, sid, input)), ensure_ascii=False)


# ── 后台线程体：求解 → 回写 ────────────────────────────────────
def _submit_and_post(
    job_id: str, uid: str, sid: str, cfg: SchedulingInput, result_url: str
) -> None:
    """失败**只记 stderr**：受理早就返回了，这里没有第二条通道可回话。"""
    result = submit_and_wait(uid, sid, cfg)          # 原阻塞逻辑，现在跑在后台线程里
    payload = result_payload(result)                 # ★ 统一结果形状（§4.3）
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    if len(body) > MAX_BODY_BYTES:                   # 超限会 413（产出丢失）→ 降级为只回状态
        body = json.dumps(
            {"status": payload["status"], "code": payload["code"],
             "message": f"结果过大（{len(body)} 字节），未回写正文"},
            ensure_ascii=False,
        ).encode("utf-8")
    err = post_result(
        with_filename(result_url, result_filename(job_id), payload["message"]), body
    )
    if err:
        print(f"异步任务 {job_id} {err}", file=sys.stderr)


# ── ★ 你的算法调用（原有同步逻辑原样复用）──────────────────────
def submit_and_wait(uid: str, sid: str, cfg: SchedulingInput) -> dict:
    """提交算法 + 阻塞等回调（上限 solvingTime + 60 秒）；返回**算法结果** dict。

    算法结果须含 `status` 作为**业务细分码**：80 完成 / 2 超时 / 90 失败。
    `result_payload` 会把它转成统一的 `{status: success|failed, code}` 形状（§4.3）——
    即平台看到的从来不是 80/2/90，而是 success/failed。
    """
    raise NotImplementedError("替换为现有的算法提交逻辑")


# ── 通用工具函数（可从 ocr_core.py 整段照抄）───────────────────
def check_url(url: str) -> str | None:
    """校验回写地址；返回错误文案，None 表示放行。"""
    try:
        u = urlparse(url)
    except Exception:
        return "错误：无效的 URL"
    if u.scheme not in ("http", "https"):
        return "错误：仅支持 http/https URL"
    host = (u.hostname or "").lower()
    if host not in ALLOW_HOSTS:
        allowed = ", ".join(sorted(ALLOW_HOSTS)) or "未配置任何允许主机"
        return (
            f"错误：URL 主机 {host or '(空)'} 不在允许名单（{allowed}）；"
            "请在容器的 HD_URL_ALLOW_HOSTS 中声明该主机"
        )
    return None


def make_job_id(now: float | None = None) -> str:
    """`hd_<毫秒时间戳>_<随机8位>`：时间戳便于人眼排序，随机后缀防同毫秒碰撞。"""
    stamp = int((now if now is not None else time.time()) * 1000)
    return f"{JOB_PREFIX}_{stamp}_{uuid.uuid4().hex[:8]}"


def result_filename(job_id: str) -> str:
    """回写正文的文件名（平台会再补 `{prefix}_` 前缀）。"""
    return f"{job_id}{RESULT_SUFFIX}"


def result_payload(algorithm_result: dict) -> dict:
    """算法结果 → **统一结果形状**（§4.3）。

    - `status` 只有 `success` / `failed`（平台与界面据此**统一**判成败）
    - 业务细分码 80/2/90 放 `code`
    - `message` 即界面标题用的那行摘要（**失败结论前置**）
    - 其余业务字段原样带上（平台不解析，供人和模型读）
    """
    code = algorithm_result.get("status")
    payload: dict = {
        "status": "success" if code == 80 else "failed",
        "code": code,
        "message": summary_of(code, algorithm_result),
    }
    payload.update(
        {k: v for k, v in algorithm_result.items() if k not in ("status", "message")}
    )
    return payload


def summary_of(code: object, algorithm_result: dict) -> str:
    """业务细分码 → 一行摘要（≤200 字符）：成功说结果、失败说原因，**失败结论前置**。"""
    if code == 80:
        count = algorithm_result.get("orderCount")
        text = (
            f"排产完成（code=80），{count} 条工单"
            if count is not None
            else "排产完成（code=80）"
        )
        return text[:SUMMARY_MAX_CHARS]
    if code == 2:
        return "失败 · 排产超时（code=2），本次提交已撤销，可调大 solvingTime 后重试"
    if code == 90:
        return "失败 · 排产失败（code=90）"
    return f"排产结束（code={code}）"


def with_filename(url: str, filename: str, summary: str | None = None) -> str:
    """追加 filename / summary，**保留原有 query**（u/d/exp/sig/sid/call_id/tool 一个不丢）。"""
    parts = urlsplit(url)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    query["filename"] = filename
    if summary:
        query["summary"] = summary
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


def accepted_payload(job_id: str) -> str:
    """受理响应（立即返回给模型）。"""
    return json.dumps(
        {
            "job_id": job_id,
            "status": "accepted",
            "message": "已受理，正在后台求解；完成后结果会自动出现在后台记录与后续对话里，无需重复提交。",
        },
        ensure_ascii=False,
    )


def post_result(url: str, body: bytes) -> str | None:
    """POST 结果；200/202 视为成功，失败返回错误文案（不抛异常）。"""
    try:
        with httpx.Client(timeout=UPLOAD_TIMEOUT, follow_redirects=False) as client:
            r = client.post(
                url,
                content=body,
                headers={"content-type": "application/json; charset=utf-8"},
            )
            return None if r.status_code in (200, 202) else f"回写失败（HTTP {r.status_code}）"
    except httpx.HTTPError as e:
        return f"回写失败（{e.__class__.__name__}）"


if __name__ == "__main__":
    if not ALLOW_HOSTS:
        print("警告：未配置 HD_URL_ALLOW_HOSTS，异步模式将拒绝所有回写", file=sys.stderr)
    mcp.run(transport="streamable-http")
```

---

## 6. 部署与配置

| # | 事项 | 取值 |
|---|---|---|
| 1 | 平台声明异步工具 | `"async_tools": ["hd_scheduling_submit"]`（**原始工具名，不含 `hd__` 前缀**） |
| 2 | 服务侧白名单 | `HD_URL_ALLOW_HOSTS=backend,192.168.1.7`（值 = 平台 `PUBLIC_BASE_URL` 的 host） |
| 3 | 改过 `.env.local` 后 | **重建**容器：`docker compose up -d hd --force-recreate`（`restart` 不更新 env） |
| 4 | 平台侧保存后 | 无需重启后端 —— 配置物化后按指纹自动重建实例 |

---

## 附：全链路时序

```
模型 hd_scheduling_submit(uid, sid, input, result_url=<平台注入>)
  → 平台注入 result_url（覆盖模型填的任何值；HITL 确认窗里看不到它）
  → 服务：check_url 通过 → 返回受理 JSON（含 job_id）→ 模型复述给用户
  → 后台线程：submit_and_wait(…)（阻塞至算法回调，上限 solvingTime+60s）
             → 算法结果 → 统一形状（status=success|failed + code）→ 生成 summary
             → POST 回写（filename + summary + 统一结果 JSON）
  → 平台落盘（正文 .json + sidecar）→ 推 SSE 信号 → 铃铛"后台记录"出现新条目
  → 模型在后续对话中可 read_file 读取该产出的正文
```
