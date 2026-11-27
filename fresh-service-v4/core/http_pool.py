"""
进程内共享 HTTP 客户端：复用 TCP/TLS 连接（keep-alive），避免每次请求重开连接。

为什么需要：
- 一次解析要下载图片、下载三张数据表、回写 xlsx，若都走模块级 `httpx.get/post`，
  每个动作都会新建连接（本机多几十毫秒，HTTPS 直链还要付 TLS 握手）；
- 并发上来后瞬间开一堆连接，既慢又容易打满本机临时端口。

约定：
- 共享客户端由本模块懒建，`httpx.Client` 本身可被多线程并发使用；
- 单次请求仍可用 `timeout=` / `follow_redirects=` 覆盖默认值；
- 测试要注入假响应时别用这里，`core/llm_read._post(transport=...)` 会自己建临时客户端。
"""

from __future__ import annotations

import threading

import httpx

from . import config

#: 连接池上限：并发 3–5 时远用不满，留余量给「图片 + 三表 + 回写」同时在路上
_POOL_LIMITS = httpx.Limits(max_connections=20, max_keepalive_connections=10)

_LOCK = threading.Lock()
_CLIENT: "httpx.Client | None" = None


def client() -> httpx.Client:
    """返回进程内共享客户端（首次调用时创建）。"""
    global _CLIENT
    if _CLIENT is None:
        with _LOCK:
            if _CLIENT is None:
                _CLIENT = httpx.Client(
                    timeout=config.HTTP_TIMEOUT_SECONDS,
                    follow_redirects=True,
                    limits=_POOL_LIMITS,
                )
    return _CLIENT


def close() -> None:
    """关闭连接池（测试收尾/进程退出时用）。"""
    global _CLIENT
    with _LOCK:
        if _CLIENT is not None:
            _CLIENT.close()
            _CLIENT = None
