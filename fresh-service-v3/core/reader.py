# -*- coding: utf-8 -*-
"""读图路由：**表格走 OCR + 版面层，手写走 LLM 转录**，失败自动回退。

一次调用做三件事：
1. 先用 OCR + 版面层（``core/layout.py``）判断版式，并拿到"OCR 版"的结构化行；
2. 若判为**表格** → 直接用版面层结果（OCR 对印刷表格已足够，且零成本）；
   若判为**手写/列表** → 调 LLM 转录（``core/llm_read.py``），文本交给现有
   ``analyze_order``，后续标准化/匹配/三表/报告完全不变；
3. LLM 未配置、超时、行数明显少于 OCR 时**回退**到版面层结果。

返回 :class:`ReadResult`，其中 ``meta`` 记录实际走了哪条通道、行数与降级原因，
便于日志、报告与后续回归。
"""
from __future__ import annotations

from dataclasses import dataclass, field

from . import llm_read
from .layout import parse_document
from .pipeline import analyze_batch, analyze_document

READER_MODES = ("auto", "llm", "ocr")
#: LLM 行数低于 OCR 行数的这个比例就判定为"漏行"，回退 OCR
MIN_LINE_RATIO = 0.8


@dataclass
class ReadResult:
    auto: list = field(default_factory=list)
    review: list = field(default_factory=list)
    error: list = field(default_factory=list)
    meta: dict = field(default_factory=dict)

    def rows(self) -> list:
        return self.auto + self.review + self.error


def _norm_reader(reader: str) -> str:
    mode = (reader or "auto").strip().lower()
    return mode if mode in READER_MODES else "auto"


def _mark(rows: list, reader: str) -> list:
    """给每行打一个 ``reader`` 标记（llm / ocr），便于审计与回归，不影响导出列。"""
    for row in rows:
        if isinstance(row, dict):
            row.setdefault("reader", reader)
    return rows


def analyze_image(image_path_or_url: str, source_name: str, data,
                  reader: str = "auto", layout: str = "auto") -> ReadResult:
    """图片 -> 三表行 + 路由元信息。

    reader：``auto``（默认，手写走 LLM / 表格走 OCR）/ ``llm``（强制 LLM）/ ``ocr``（强制 OCR）
    layout：``auto`` / ``table`` / ``list`` / ``off``（``off`` 完全退回旧的逐行 OCR 文本链路）
    """
    mode = _norm_reader(reader)
    meta = {"reader": mode, "kind": "", "ocr_rows": 0, "llm_lines": 0,
            "note": "", "llm_configured": llm_read.is_configured()}

    doc = None
    if layout != "off":
        try:
            doc = parse_document(image_path_or_url, force=None if layout == "auto" else layout)
            meta["kind"] = doc.kind
            meta["ocr_rows"] = len(doc.records)
        except Exception as exc:                                # noqa: BLE001
            meta["note"] = f"版面解析失败：{exc.__class__.__name__}: {exc}"

    # ---- 手写 / 列表：优先 LLM --------------------------------------
    want_llm = mode == "llm" or (mode == "auto" and (doc is None or doc.kind == "list"))
    if want_llm and llm_read.is_configured():
        try:
            lines = llm_read.read_lines(image_path_or_url)
        except llm_read.LLMError as exc:
            lines = []
            meta["note"] = f"LLM 不可用，已回退 OCR：{exc}"
        if lines:
            meta["llm_lines"] = len(lines)
            enough = (mode == "llm" or not doc or not doc.records
                      or len(lines) >= max(1, int(len(doc.records) * MIN_LINE_RATIO)))
            if enough:
                auto, review, error = analyze_batch(
                    [(source_name, "\n".join(lines), None)], data)
                meta["reader"] = "llm"
                return ReadResult(_mark(auto, "llm"), _mark(review, "llm"),
                                  _mark(error, "llm"), meta)
            note = (f"LLM 只返回 {len(lines)} 行（OCR 检出 {len(doc.records)} 行），已回退 OCR")
            meta["note"] = f"{meta['note']}；{note}" if meta["note"] else note
    elif want_llm and not llm_read.is_configured():
        meta["note"] = "未配置 LLM Key，手写单按 OCR 处理"

    # ---- 表格 / 回退：OCR + 版面层 ----------------------------------
    if doc is not None and doc.records:
        auto, review, error = analyze_document(
            doc.records, data, source=source_name, unparsed=doc.unparsed)
        meta["reader"] = "ocr"
        return ReadResult(_mark(auto, "ocr"), _mark(review, "ocr"),
                          _mark(error, "ocr"), meta)

    # ---- 兜底：旧的逐行 OCR 文本链路 --------------------------------
    auto, review, error = analyze_batch([(source_name, "", image_path_or_url)], data)
    meta["reader"] = "ocr-legacy"
    if not meta["note"]:
        meta["note"] = "版面层没有解析出商品行，走逐行 OCR"
    return ReadResult(_mark(auto, "ocr-legacy"), _mark(review, "ocr-legacy"),
                      _mark(error, "ocr-legacy"), meta)


def describe(meta: dict) -> str:
    """把路由元信息压成一行日志。"""
    parts = [f"reader={meta.get('reader', '?')}"]
    if meta.get("kind"):
        parts.append(f"kind={meta['kind']}")
    parts.append(f"ocr_rows={meta.get('ocr_rows', 0)}")
    if meta.get("llm_lines"):
        parts.append(f"llm_lines={meta['llm_lines']}")
    if not meta.get("llm_configured"):
        parts.append("llm=off")
    if meta.get("note"):
        parts.append(f"note={meta['note']}")
    return " ".join(parts)
