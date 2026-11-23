"""
进程内 TTL + LRU 缓存：供商品数据表（三个 xlsx 地址）复用，避免每次调用重复下载与解析。

约定：
- ttl_seconds <= 0 视为关闭缓存，每次直接调用 loader；
- 超过 max_entries 淘汰最久未使用的条目；
- loader 抛异常时不写缓存（下次调用会重试）；
- 加载动作在锁外执行，避免慢下载阻塞其它 key（并发下同一 key 可能被加载两次，结果一致）。
"""

from __future__ import annotations

import threading
import time
from collections import OrderedDict
from typing import Callable, Generic, Hashable, TypeVar

T = TypeVar("T")


class TTLCache(Generic[T]):
    """带 TTL 与容量上限的线程安全缓存。"""

    def __init__(self, ttl_seconds: float, max_entries: int) -> None:
        self._ttl = float(ttl_seconds)
        self._max = max(1, int(max_entries))
        self._lock = threading.Lock()
        self._data: "OrderedDict[Hashable, tuple[float, T]]" = OrderedDict()

    def get_or_load(self, key: Hashable, loader: Callable[[], T]) -> T:
        """命中未过期则返回缓存值，否则调用 loader 并写回缓存。"""
        if self._ttl <= 0:
            return loader()

        now = time.monotonic()
        with self._lock:
            hit = self._data.get(key)
            if hit is not None:
                expire_at, value = hit
                if expire_at > now:
                    self._data.move_to_end(key)
                    return value
                self._data.pop(key, None)

        value = loader()

        with self._lock:
            self._data[key] = (time.monotonic() + self._ttl, value)
            self._data.move_to_end(key)
            while len(self._data) > self._max:
                self._data.popitem(last=False)
        return value

    def clear(self) -> None:
        with self._lock:
            self._data.clear()

    def __len__(self) -> int:
        with self._lock:
            return len(self._data)
