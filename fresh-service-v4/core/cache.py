"""
进程内 TTL + LRU 缓存：供商品数据表（三个 xlsx 地址）复用，避免每次调用重复下载与解析。

约定：
- ttl_seconds <= 0 视为关闭缓存，每次直接调用 loader；
- 超过 max_entries 淘汰最久未使用的条目；
- loader 抛异常时不写缓存（下次调用会重试）；
- 加载动作在锁外执行，避免慢下载阻塞其它 key；**同一 key 用单飞锁串行**
  （并发冷启动只让一个线程去下载解析，其它线程等它就绪，不会各下一遍）。
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
        #: 每个 key 一把单飞锁（条数 = 不同 key 数，业务上限就是几个地址，不会无限增长）
        self._locks: "dict[Hashable, threading.Lock]" = {}

    def _lock_for(self, key: Hashable) -> threading.Lock:
        with self._lock:
            lock = self._locks.get(key)
            if lock is None:
                lock = threading.Lock()
                self._locks[key] = lock
            return lock

    def _hit(self, key: Hashable) -> "tuple[bool, T | None]":
        """锁内查一次：命中且未过期就续期并返回。"""
        hit = self._data.get(key)
        if hit is None:
            return False, None
        expire_at, value = hit
        if expire_at > time.monotonic():
            self._data.move_to_end(key)
            return True, value
        self._data.pop(key, None)
        return False, None

    def get_or_load(self, key: Hashable, loader: Callable[[], T]) -> T:
        """命中未过期则返回缓存值，否则（同一 key 只让一个线程）调用 loader 并写回。"""
        if self._ttl <= 0:
            return loader()

        with self._lock:
            hit, value = self._hit(key)
            if hit:
                return value

        # 未命中：拿到该 key 的单飞锁后再查一次（等待期间别人可能已加载好）
        with self._lock_for(key):
            with self._lock:
                hit, value = self._hit(key)
                if hit:
                    return value

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
