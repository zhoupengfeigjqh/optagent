# -*- coding: utf-8 -*-
"""产出落盘与下载地址铸造 —— 本服务**唯一**写磁盘的地方。

为什么要保存文件：合并结果是 xlsx **二进制**，只能靠一个 URL 交给用户下载；而平台的签名
读直链**只有平台铸得出来**（HMAC 密钥在平台侧，契约也明令服务不得自行拼接平台入口地址）。
于是改为**服务自管产出、自铸地址**：算完落盘到 ``.data``，返回
``{base}/files/{name}``；平台按契约 §4.7 把它渲染成聊天区入口行（前端已有实现，零改动）。

产出名 = **用户下载时看到的文件名**（``总BOM_{root}_{job_id}.xlsx``，见
``bom_core.artifact_filename``）：落盘名与展示名**用同一个名字**，省掉一份"按 job_id 反查
展示名"的 sidecar；名字里的 ``job_id``（毫秒时间戳 + 8 位随机）不可猜 ⇒ 下载端点**无鉴权**
（``custom_route`` 本就不带鉴权），凭证就是 URL 本身。

正因为"URL 即凭证"，保留策略是硬要求而不是优化项：

- ``BOM_ARTIFACT_DIR``：产出目录，默认 ``.data``。容器部署**必须挂载**（``-v``），
  否则容器重建后聊天记录里的链接全部 404；
- ``BOM_ARTIFACT_TTL_S``：保留秒数，默认 7 天（按 mtime 判定；``<=0`` = 不按时间清理）；
- ``BOM_ARTIFACT_MAX_FILES`` / ``BOM_ARTIFACT_MAX_BYTES``：条数与总字节兜底上限，
  超限按 mtime **从旧到新**淘汰（防"TTL 之内写爆磁盘"）；
- 清理是**惰性的**：启动时一次 + 每次落盘后一次——不引入常驻线程或定时器，
  服务保持"无后台任务"，进程退出即结束。

对外基址 ``BOM_PUBLIC_BASE_URL``：显式配置优先；未配置时由调用方拿请求的
``Host``/``X-Forwarded-Proto`` 兜底（同网段部署可零配置）。铸不出基址时**必须不写链接**
（契约 §4.7：不带 = 本次没有入口），而不是编一个相对路径或半截地址。

分工：本模块只管"文件放哪、地址怎么拼、什么时候删"，不碰任何 BOM 业务规则，
也不依赖 ``mcp`` ⇒ 单测可在宿主机直接跑。
"""
import os
import time
from pathlib import Path
from urllib.parse import quote

# 导入期读取（与 bom_core 同款），单测用 importlib.reload 切换取值。
#: 产出目录（默认相对服务工作目录；容器里用 BOM_ARTIFACT_DIR 指到挂载点）
ARTIFACT_DIR = os.environ.get("BOM_ARTIFACT_DIR", ".data")
#: 显式对外基址；留空 = 由调用方按请求的 scheme+Host 兜底
PUBLIC_BASE_URL = os.environ.get("BOM_PUBLIC_BASE_URL", "").rstrip("/")
#: 保留秒数（0 或负数 = 不按时间清理，只受下面两个上限约束）
TTL_S = float(os.environ.get("BOM_ARTIFACT_TTL_S", str(7 * 24 * 3600)))
#: 条数上限 / 总字节上限
MAX_FILES = int(os.environ.get("BOM_ARTIFACT_MAX_FILES", "500"))
MAX_BYTES = int(os.environ.get("BOM_ARTIFACT_MAX_BYTES", str(2 * 1024 * 1024 * 1024)))

#: 下载路由前缀（与 ``server.py`` 的 custom_route 同一处约定）
URL_PREFIX = "/files"
#: 产出后缀白名单：下载端点**只**服务这些名字（也顺带挡掉 ``.tmp`` 中间态）
SUFFIXES = (".xlsx",)
#: 落盘中间态的最长存活时间（秒）：正常流程毫秒级就 replace 掉了，留着只能是异常残留
TMP_TTL_S = 3600
#: 产出名的长度上限：全路径要落进 URL 与 Content-Disposition，太长对谁都不友好
MAX_NAME_CHARS = 128


def is_safe_name(name: str) -> bool:
    """产出名白名单：单段、无路径分隔符与 ``..``、后缀在允许集合内、长度有界。

    下载端点靠它挡路径穿越（``../../etc/passwd``、``a/b``、``a\\b``、``C:x``）——
    这是端点**唯一**的输入校验，必须自己拿住，不能指望调用方守规矩。
    """
    if not name or len(name) > MAX_NAME_CHARS or name in (".", ".."):
        return False
    if "/" in name or "\\" in name or Path(name).name != name:
        return False
    return name.endswith(SUFFIXES)


def directory(path: str | os.PathLike | None = None) -> Path:
    """产出目录（``path`` 仅供测试注入）。"""
    return Path(path or ARTIFACT_DIR)


def ensure_dir(path=None) -> Path:
    """确保产出目录存在（启动与落盘各调一次；重复调用无副作用）。"""
    d = directory(path)
    d.mkdir(parents=True, exist_ok=True)
    return d


def _unlink(p: Path) -> int:
    """删一个文件；返回删除条数。清理不是关键路径，删不掉（并发删/权限）就当没删。"""
    try:
        p.unlink()
        return 1
    except OSError:
        return 0


def _entries(d: Path) -> list[Path]:
    try:
        return [p for p in d.iterdir() if p.is_file()]
    except FileNotFoundError:
        return []


def save(name: str, data: bytes, *, path=None, now: float | None = None) -> Path:
    """原子落盘并顺手清理；返回最终路径。

    先写 ``{name}.tmp`` 再 ``os.replace``：URL 是写完之后才返回给调用方的，正常读不到半截文件，
    但原子写几乎零成本，能一次性消灭"下载到 0 字节 / 半截 zip"这类极难复现的故障。

    :param path: 产出目录（仅供测试注入）。
    :param now: 清理用的"当前时刻"（仅供测试注入）。
    """
    if not is_safe_name(name):
        raise ValueError(f"非法产出名：{name!r}")
    d = ensure_dir(path)
    tmp = d / f"{name}.tmp"
    tmp.write_bytes(data)
    os.replace(tmp, d / name)
    sweep(path=d, now=now)
    return d / name


def resolve(name: str, *, path=None, now: float | None = None) -> Path | None:
    """取回**未过期**的产出；名字不合法 / 不存在 / 已过期 → ``None``。

    过期文件顺手删掉：端点被点到时正是清理的最佳时机（此外只有启动与落盘会扫）。
    """
    if not is_safe_name(name):
        return None
    p = directory(path) / name
    try:
        st = p.stat()
    except OSError:
        return None
    now_s = time.time() if now is None else now
    if TTL_S > 0 and now_s - st.st_mtime > TTL_S:
        _unlink(p)
        return None
    return p


def sweep(*, path=None, now: float | None = None) -> int:
    """清理过期与超限产出（按 mtime 从旧到新淘汰）；返回删除条数。

    只认 ``SUFFIXES`` 的产出，以及**陈旧**的 ``.tmp`` 残留；其它文件（运维放的说明之类）
    一律不碰——清理做到"只删自己写的东西"才不会变成事故。
    """
    d = directory(path)
    now_s = time.time() if now is None else now
    removed = 0
    kept: list[tuple[float, Path, int]] = []                 # (mtime, 路径, 字节数)
    for p in _entries(d):
        try:
            st = p.stat()
        except OSError:                                     # 与并发删除赛跑：跳过
            continue
        if p.name.endswith(".tmp"):
            if now_s - st.st_mtime > TMP_TTL_S:
                removed += _unlink(p)
            continue
        if not p.name.endswith(SUFFIXES):
            continue
        if TTL_S > 0 and now_s - st.st_mtime > TTL_S:
            removed += _unlink(p)
            continue
        kept.append((st.st_mtime, p, st.st_size))
    # 容量兜底：TTL 之内的文件也要有上限，否则一次批量调用就能把磁盘写满
    kept.sort(key=lambda it: it[0])
    total = sum(it[2] for it in kept)
    while kept and (len(kept) > MAX_FILES or total > MAX_BYTES):
        _mtime, p, size = kept.pop(0)
        removed += _unlink(p)
        total -= size
    return removed


def public_url(base: str, name: str) -> str:
    """产出地址：``{base}/files/{name}``（``name`` 会做 URL 编码，中文名照常可用）。

    ``base`` 为空串时调用方**不应**调用本函数——铸不出可点地址就不写 ``viewUrl``。
    """
    return f"{(base or '').rstrip('/')}{URL_PREFIX}/{quote(name)}"


def base_from_request(configured: str = "", host: str | None = None,
                      scheme: str | None = None, forwarded_proto: str | None = None) -> str:
    """铸造对外基址：**显式配置优先** → 否则用请求的 scheme+Host → 都没有则空串。

    反代部署下请求自带的 scheme 常是 ``http``，故 ``X-Forwarded-Proto`` 优先于 URL scheme；
    两者都没有就退回 ``http``（本服务是内网服务，这是最可能的真相）。

    :param configured: ``BOM_PUBLIC_BASE_URL``（已 trim）；非空即胜出。
    :param host: 请求的 ``Host`` 头（``host:port``）。
    """
    if configured:
        return configured.rstrip("/")
    if not host:
        return ""
    return f"{(forwarded_proto or scheme or 'http').strip().lower()}://{host}"
