# -*- coding: utf-8 -*-
"""
读图链路本地压测（不经 MCP，直接跑 reader.analyze_image）。

用途：对比优化前后的「单请求耗时 / 并发耗时 / 引擎构造次数 / 内存」。
容器内跑（镜像里才有 paddle）：

    python scripts/bench_local.py -c 1,3,5 -n 2

关注两项：
- ``engine_builds`` 必须为 1（模型只构造一次，不该随请求数增长）；
- 同一并发档的 ``p95`` 与 ``rss``：优化后应更平稳。
"""

from __future__ import annotations

import argparse
import statistics
import sys
import threading
import time
from pathlib import Path

# 允许 `python scripts/bench_local.py` 直接跑（把服务根目录加进 sys.path）
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import config, ocr, reader  # noqa: E402
from core.data_loader import load_product_data_three  # noqa: E402

DEFAULT_IMAGE = "单据样例/微信图片_20261119093629_20_337.png"


def _rss_mb() -> float:
    """当前进程 RSS（Linux /proc；取不到就返回 0）。"""
    try:
        for line in Path("/proc/self/status").read_text().splitlines():
            if line.startswith("VmRSS:"):
                return int(line.split()[1]) / 1024
    except OSError:
        pass
    return 0.0


def _run_one(image: str, name: str, data, out: list, idx: int) -> None:
    t0 = time.perf_counter()
    try:
        res = reader.analyze_image(image, name, data, reader="ocr", layout="auto")
        out[idx] = (time.perf_counter() - t0, len(res.rows()), "")
    except Exception as exc:                                # noqa: BLE001
        out[idx] = (time.perf_counter() - t0, 0, f"{exc.__class__.__name__}: {exc}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("-i", "--image", default=DEFAULT_IMAGE)
    ap.add_argument("-c", "--concurrency", default="1,3,5")
    ap.add_argument("-n", "--rounds", type=int, default=2)
    args = ap.parse_args()

    image = str(Path(args.image))
    if not Path(image).is_absolute():
        image = str(config.PROJECT_ROOT / image)

    # 统计引擎构造次数：优化后必须为 1，否则说明仍在按请求重建
    builds = {"n": 0}
    real_init = ocr._init_engine

    def counting_init():
        builds["n"] += 1
        return real_init()

    ocr._init_engine = counting_init

    data = load_product_data_three("", "", "")              # 用镜像内默认三张表
    print(f"image={image}")
    print(f"rss_start={_rss_mb():.0f}MB")

    for conc in [int(x) for x in args.concurrency.split(",")]:
        for rnd in range(args.rounds):
            out = [None] * conc
            threads = [threading.Thread(target=_run_one,
                                        args=(image, Path(image).name, data, out, i))
                       for i in range(conc)]
            t0 = time.perf_counter()
            for t in threads:
                t.start()
            for t in threads:
                t.join()
            wall = time.perf_counter() - t0

            lat = sorted(v[0] for v in out if v)
            rows = [v[1] for v in out if v]
            errs = [v[2] for v in out if v and v[2]]
            p50 = statistics.median(lat) if lat else 0.0
            p95 = lat[min(len(lat) - 1, int(round(0.95 * (len(lat) - 1))))] if lat else 0.0
            print(f"c={conc} round={rnd + 1} wall={wall:.2f}s p50={p50:.2f}s p95={p95:.2f}s "
                  f"rows={rows} errs={len(errs)} rss={_rss_mb():.0f}MB")
            for err in errs:
                print(f"   err: {err}")

    print(f"engine_builds={builds['n']} （预热过应为 0；未预热应为 1；>1 说明仍在按请求重建）")


if __name__ == "__main__":
    main()
