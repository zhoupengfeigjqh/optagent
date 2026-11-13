"""
OCR：PP-OCRv6 small 模型识别图片文字行，按检测框 y 坐标恢复阅读顺序。
paddleocr 不可用时抛出清晰的 OcrError，提示安装依赖或改用文本模式。
测试用例不依赖真实 OCR（用 mock 或纯文本模式）。
"""

from __future__ import annotations
import tempfile
from pathlib import Path
from . import config


class OcrError(RuntimeError):
    """OCR 不可用或识别失败。"""


# 订单图片后缀白名单：其余（签名 URL 无后缀等）回落 .png
_IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".bmp", ".webp", ".tif", ".tiff", ".gif"}


def _download(url: str) -> Path:
    import httpx

    try:
        resp = httpx.get(url, timeout=config.HTTP_TIMEOUT_SECONDS, follow_redirects=True)
        resp.raise_for_status()
    except Exception as exc:  # noqa: BLE001
        raise OcrError(f"下载图片失败：{url}（{exc}）") from exc
    suffix = Path(url.split("?")[0].split("#")[0]).suffix.lower()
    if suffix not in _IMAGE_SUFFIXES:
        suffix = ".png"
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    tmp.write(resp.content)
    tmp.close()
    return Path(tmp.name)


def _init_engine():
    """懒初始化 PaddleOCR（PP-OCRv6 small det + small rec）。"""
    try:
        from paddleocr import PaddleOCR  # type: ignore
    except ImportError as exc:
        raise OcrError(
            "未安装 paddleocr，无法使用图片识别，请执行pip install paddleocr paddlepaddle。"
        ) from exc
    # 显式指定模型名后，lang / ocr_version 会被忽略（PP-OCRv6_small_rec 本身即中文识别模型）
    return PaddleOCR(
        text_detection_model_name=config.OCR_DET_MODEL,
        text_recognition_model_name=config.OCR_REC_MODEL,
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
        enable_mkldnn=False,  # paddle 3.x + Windows CPU 下开启 oneDNN 会报错，关掉
    )


def ocr_lines(image_path_or_url: str) -> list[str]:
    """识别图片，返回按阅读顺序（检测框 y 坐标排序）的文本行列表。"""
    tmp_path = None
    path = image_path_or_url
    try:
        if path.startswith("http://") or path.startswith("https://"):
            tmp_path = _download(path)
            path = str(tmp_path)
        else:
            p = Path(path)
            if not p.exists():
                alt = config.PROJECT_ROOT / path
                if alt.exists():
                    path = str(alt)
                else:
                    raise OcrError(f"图片不存在：{image_path_or_url}")

        engine = _init_engine()
        try:
            result = engine.predict(path)  # paddleocr >= 3.x
        except AttributeError:
            result = engine.ocr(path, cls=True)  # 2.x 兼容
        texts = _extract_sorted_lines(result)
        lines = [t for t in texts if t.strip()]
        if not lines:
            raise OcrError("OCR 未识别到文字，请检查图片清晰度或改用文本模式")
        return lines
    finally:
        if tmp_path is not None:
            try:
                tmp_path.unlink()
            except OSError:
                pass


def _extract_sorted_lines(result) -> list[str]:
    """从 paddleocr 结果里取 (text, top_y)，按 top_y 排序。兼容 2.x / 3.x 返回形态。"""
    items: list[tuple[str, float]] = []
    pages = result if isinstance(result, (list, tuple)) else [result]
    for page in pages:
        if page is None:
            continue
        payload = None
        if isinstance(page, dict):
            payload = page.get("res", page)
        else:
            for attr in ("json", "res"):
                v = getattr(page, attr, None)
                if isinstance(v, dict):
                    payload = v
                    break

        if isinstance(payload, dict):
            payload = payload.get("res", payload)
            texts = payload.get("rec_texts") or []
            polys = payload.get("rec_polys") or payload.get("dt_polys") or []
            for i, t in enumerate(texts):
                top = _poly_top(polys[i]) if i < len(polys) else 0.0
                items.append((str(t), top))
            continue

        # 2.x：[[box, (text, score)], ...]
        if isinstance(page, (list, tuple)):
            for item in page:
                if (isinstance(item, (list, tuple)) and len(item) >= 2
                        and isinstance(item[1], (list, tuple)) and item[1]):
                    text = str(item[1][0])
                    top = _poly_top(item[0]) if isinstance(item[0], (list, tuple)) else 0.0
                    items.append((text, top))

    items.sort(key=lambda x: x[1])
    return [t for t, _ in items]


def _poly_top(poly) -> float:
    try:
        return float(min(p[1] for p in poly))
    except (TypeError, ValueError, StopIteration):
        return 0.0
