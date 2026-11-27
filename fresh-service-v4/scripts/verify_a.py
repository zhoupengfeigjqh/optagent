# -*- coding: utf-8 -*-
"""A 阶段自检：单例、连接池复用、缓存单飞、并发闸门。容器内跑：python scripts/verify_a.py"""

from __future__ import annotations

import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import http_pool, ocr                      # noqa: E402
from core.cache import TTLCache                      # noqa: E402


def check_engine() -> None:
    a, b = ocr._engine(), ocr._engine()
    print(f"engine_singleton={a is b}")


def check_pool() -> None:
    a, b = http_pool.client(), http_pool.client()
    print(f"http_pool_singleton={a is b}")


def check_single_flight() -> None:
    cache: TTLCache[int] = TTLCache(ttl_seconds=60, max_entries=8)
    calls = {"n": 0}

    def loader() -> int:
        calls["n"] += 1
        time.sleep(0.5)
        return 42

    out: list[int] = []
    threads = [threading.Thread(target=lambda: out.append(cache.get_or_load("k", loader)))
               for _ in range(5)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    print(f"single_flight loader_calls={calls['n']}（期望 1）values={out}")


def check_gate() -> None:
    import mcp_server

    print(f"gate_size={mcp_server._MAX_CONCURRENT} queue_timeout={mcp_server._QUEUE_TIMEOUT_S}s")
    for _ in range(mcp_server._MAX_CONCURRENT):
        mcp_server._GATE.acquire()
    t0 = time.perf_counter()
    try:
        mcp_server.fresh_order_parse("x", "y")
        print("gate=NOT_ENFORCED")
    except ValueError as exc:
        print(f"gate_enforced after {time.perf_counter() - t0:.1f}s: {exc}")
    finally:
        for _ in range(mcp_server._MAX_CONCURRENT):
            mcp_server._GATE.release()


if __name__ == "__main__":
    check_engine()
    check_pool()
    check_single_flight()
    check_gate()
