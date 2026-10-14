# -*- coding: utf-8 -*-
"""真实数据端到端测试（**只读本地文件，不改动任何输入**）。

数据来源（用户指定）：仓库根目录下
- ``BOM提交/子BOM.zip``      → 输入1（23 个子BOM 打包）
- ``BOM提交/WCCMT-...xls``   → 输入2（总BOM，顶层总成表）
- ``总BOM标准字段.json``     → 输入3a
- ``子BOM字段映射.json``     → 输入3b

做法：用本机 http.server 托管仓库根目录（把文件变成 http 直链，模拟平台的铸造直链），
然后走 ``bom_core.run_from_urls`` 跑完整流程。**计算本身不落盘**；交付那一跳
（算完落盘 + 按名取回）由 ``bom_store`` 负责，这里用 ``tmp_path`` 走一遍真字节。

回归口径：与既有实现（``bom_integrate.py``，24 文件）逐行对齐——展开 327 行（含根）、
明细 326 行、0 阻断性错误。这不是"与真实BOM 的一致性校验"，而是"新旧实现等价性回归"。
"""
import functools
import http.server
import io
import json
import os
import threading
from pathlib import Path
from urllib.parse import quote

import pytest
from openpyxl import load_workbook

REPO = Path(__file__).resolve().parents[2]
SUBMIT = REPO / "BOM提交"
ZIP_NAME = "子BOM.zip"
TOTAL_BOM_NAME = "WCCMT-00000B0570_00_0B.xls"
SCHEMA_NAME = "总BOM标准字段.json"
MAPPING_NAME = "子BOM字段映射.json"

pytestmark = pytest.mark.skipif(
    not (SUBMIT / ZIP_NAME).exists() or not (REPO / SCHEMA_NAME).exists(),
    reason="真实数据不在位（BOM提交/ 或两份 JSON 缺失），跳过端到端测试",
)

#: 旧实现（bom_integrate.py）在同一批数据上的产出：展开行数（含根行）
#: 327 = 原 322 + 5 行"mat_code 空、posiz 有值"的外购/标准件明细（WCCUN-0000147236 1 行、
#: WCCUN-0000147248 3 行、WCCUN-0000147250 1 行）——人工参考总表 WCCMT-00000B0570-B包 里
#: 这 5 行同样存在，属于必须保留的合法明细行（见 bom_core.normalize 的判据注释）
EXPECTED_NODES = 327


@pytest.fixture(scope="module")
def base_url():
    """把仓库根目录托管为 http 服务（模块级复用；只读）。"""
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(REPO))
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        yield f"http://127.0.0.1:{srv.server_address[1]}"
    finally:
        srv.shutdown()
        srv.server_close()


def urls(base_url):
    """core 层入口（``run_from_urls``）的四个入参：名字保持 `*_url`，值就是直链。

    工具签名那一层才是相对路径口径（`*_path`，见 `server.py`）；本文件直接调 core，
    不经过 `server._pipeline_kwargs` 的改名映射，所以这里用 `*_url` 名是刻意的。
    """
    def u(rel_dir, name):
        path = f"{rel_dir}/{name}" if rel_dir else name
        return f"{base_url}/" + quote(path)
    return {
        "sub_bom_zip": u("BOM提交", ZIP_NAME),
        "total_bom": u("BOM提交", TOTAL_BOM_NAME),
        "schema_url": u("", SCHEMA_NAME),
        "mapping_url": u("", MAPPING_NAME),
    }


def test_validate_passes_on_real_data(base_url):
    import bom_core
    result = bom_core.run_from_urls(**urls(base_url))
    assert result["status"] == "success", result["message"]
    assert result["summary"]["counts"]["error"] == 0
    assert result["summary"]["files"]["total"] == 24          # 23 个 zip 内 + 1 个总BOM
    assert result["summary"]["tree"]["nodes"] == EXPECTED_NODES
    assert result["root"] == "WCCMT-00000B0570"               # 由总BOM 文件名去版本后缀推断
    # 提示只有两组：W005（schema 中声明但不在列序的派生列）+ W402（被引用却没有子BOM 的编码）
    assert result["summary"]["counts"]["warn"] == 5
    w402 = [i for i in result["issues"] if i["code"] == "W402"]
    assert {i["field"] for i in w402} == {"WCCUN-0000147246-S", "VCPM6B2FE6ZE",
                                         "WCXXX0000048057", "WCXXX0000048058"}
    assert all(i["level"] == "warn" for i in w402)
    assert result["summary"]["tree"]["as_leaf"] == 4
    # W402 只提示、不改变结果：这些编码按叶子零件正常出现在树上
    leaf_codes = {n["mat_code"] for n in result["_nodes"] if n.get("as_leaf")}
    assert leaf_codes == {i["field"] for i in w402}
    # 外购/标准件明细行（mat_code 空、posiz 有值）必须保留，且按叶子零件出现、不误报缺文件
    blanks = [n for n in result["_nodes"] if n["mat_code"] == ""]
    assert len(blanks) == 5
    assert {n["source_key"] for n in blanks} == {
        "WCCUN-0000147236-S_00_0A", "WCCUN-0000147248-S_00_0A", "WCCUN-0000147250-S_00_0A"}
    assert all(not n["is_component"] and not n["as_leaf"] and n["total_qty"] for n in blanks)


def test_merge_returns_xlsx_following_schema(base_url):
    import bom_core
    result = bom_core.run_from_urls(**urls(base_url), emit=True)
    assert result["status"] == "success" and result["_xlsx"]

    schema = json.loads((REPO / SCHEMA_NAME).read_text(encoding="utf-8"))
    order = schema["excel_column_order"]
    wb = load_workbook(io.BytesIO(result["_xlsx"]))
    assert wb.sheetnames == ["Total BOM", "校验汇总"]
    ws = wb["Total BOM"]
    # 列集合/列序/表头 100% 由 schema_json 驱动
    assert [c.value for c in ws[1]] == [schema[c]["name_cn"] for c in order]
    assert ws.max_column == len(order)
    assert ws.max_row == EXPECTED_NODES + 1                   # 表头 + 322 行
    # 首行 = 根行（与既有实现一致：mat_code 取输入2 的文件 key）
    assert ws["A2"].value == "WCCMT-00000B0570_00_0B"
    assert ws["A2"].alignment.indent == 0 and ws["A2"].font.bold is True
    assert ws["A3"].alignment.indent == 1
    # 人工维护列（source 非 子BOM映射/计算生成）恒空
    blank_idx = [i for i, c in enumerate(order, start=1)
                 if schema[c]["source"] not in ("子BOM映射", "计算生成")]
    assert blank_idx, "schema 应含留空列"
    for idx in blank_idx:
        assert all(ws.cell(row=r, column=idx).value is None for r in range(2, ws.max_row + 1))
    # 校验汇总 sheet：无错误；仅两类提示——W005(schema 中不输出的派生列) + W402(缺文件的组件)
    ws2 = wb["校验汇总"]
    assert [c.value for c in ws2[1]][:3] == ["错误码", "级别", "阶段"]
    rows = [[ws2.cell(row=r, column=c).value for c in (1, 2, 4, 6)]
            for r in range(2, ws2.max_row + 1)]
    assert {r[0] for r in rows} == {"W005", "W402"}
    assert all(r[1] == "warn" for r in rows)
    hit = next(r for r in rows if r[0] == "W402")
    assert hit[2] == "WCCMT-00000B0570_00_0B" and hit[3] == "WCCUN-0000147246-S"


def test_nodes_match_legacy_pipeline_row_by_row(base_url):
    """新旧实现等价性回归：逐行比对 mat_code / level / posiz / qty / total_qty。"""
    import bom_core
    result = bom_core.run_from_urls(**urls(base_url), emit=True)
    mine = result["_nodes"]
    baseline = Path(os.environ.get("TEMP", "/tmp")) / "bom_baseline_old.xlsx"
    if not baseline.exists():
        pytest.skip("缺少旧实现基准（先运行 python bom_integrate.py --out %TEMP%/bom_baseline_old.xlsx）")
    ws = load_workbook(baseline)["Total BOM"]
    old = [[c.value for c in row] for row in ws.iter_rows(min_row=2)]
    assert len(old) == len(mine)
    for i, (old_row, node) in enumerate(zip(old, mine)):
        # 空编码行（外购/标准件）在 xlsx 里是空单元格 → 读回 None；两边都归一成 "" 再比
        assert (old_row[0] or "") == (node["mat_code"] or ""), f"第{i + 2}行 mat_code 不一致"
        assert (old_row[1] or "") == (node["posiz"] or ""), f"第{i + 2}行 posiz 不一致"
        assert float(old_row[2]) == float(node["qty"]), f"第{i + 2}行 qty 不一致"
        assert float(old_row[3]) == float(node["total_qty"]), f"第{i + 2}行 total_qty 不一致"


def test_output_can_be_stored_and_fetched_back(base_url, tmp_path):
    """交付那一跳：真实产出落盘 → 按名取回 → 字节一模一样，且取回的就是能打开的 xlsx。

    （落盘/取回是 ``bom_store`` 的职责；``server.py`` 只把这一步接在算完之后。）
    """
    import bom_core
    import bom_store
    result = bom_core.run_from_urls(**urls(base_url), emit=True)
    name = bom_core.artifact_filename("bom_1_ab", result["root"])
    assert name == "总BOM_WCCMT-00000B0570_bom_1_ab.xlsx"

    path = bom_store.save(name, result["_xlsx"], path=tmp_path)
    assert path.name == name and path.read_bytes() == result["_xlsx"]
    fetched = bom_store.resolve(name, path=tmp_path)
    assert fetched == path
    assert load_workbook(io.BytesIO(fetched.read_bytes())).sheetnames == ["Total BOM", "校验汇总"]


def test_validator_writes_no_files(base_url, tmp_path, monkeypatch):
    """服务侧零持久化：校验与组装都不在磁盘上留下任何文件。"""
    import bom_core
    monkeypatch.chdir(tmp_path)
    assert os.listdir(tmp_path) == []
    for emit in (False, True):
        result = bom_core.run_from_urls(**urls(base_url), emit=emit)
        assert result["status"] == "success"
    assert os.listdir(tmp_path) == []


def test_sheet_name_must_exist_and_lists_available(base_url):
    """指定不存在的工作表 → 报错并列出全部可用表名（便于定位）。"""
    import bom_core
    result = bom_core.run_from_urls(**urls(base_url), total_bom_sheet="不存在的表")
    assert result["status"] == "failed"
    issue = next(i for i in result["issues"] if i["code"] == "E011")
    assert "不存在的表" in issue["message"]
    assert issue["evidence"]["available_sheets"], "应回带可用工作表清单"
