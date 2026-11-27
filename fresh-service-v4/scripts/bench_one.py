# -*- coding: utf-8 -*-
"""单张图诊断：走哪条链路 + 各阶段耗时 + 产出行数。

容器内用法：
    python scripts/bench_one.py -i /tmp/bench/purchase.png
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import reader                      # noqa: E402
from core.data_loader import load_product_data_three  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("-i", "--image", required=True)
    ap.add_argument("-r", "--reader", default="auto")
    ap.add_argument("-l", "--layout", default="auto")
    args = ap.parse_args()

    p = Path(args.image)
    try:
        from PIL import Image
        with Image.open(p) as im:
            print(f"image={p.name} bytes={p.stat().st_size} px={im.size[0]}x{im.size[1]}")
    except Exception:                                        # noqa: BLE001
        print(f"image={p.name} bytes={p.stat().st_size}")

    data = load_product_data_three("", "", "")
    t0 = time.perf_counter()
    res = reader.analyze_image(str(p), p.name, data, reader=args.reader, layout=args.layout)
    wall = time.perf_counter() - t0

    meta = res.meta
    print(f"reader={meta.get('reader')} kind={meta.get('kind')} "
          f"ocr_rows={meta.get('ocr_rows')} llm_lines={meta.get('llm_lines', 0)}")
    print(f"llm_configured={meta.get('llm_configured')} note={meta.get('note') or '-'}")
    print(f"rows: auto={len(res.auto)} review={len(res.review)} error={len(res.error)} "
          f"total={len(res.rows())}")
    print(f"wall={wall:.2f}s")


if __name__ == "__main__":
    main()
