# -*- coding: utf-8 -*-
"""合并报告（``report.py``）单测：纯函数，不碰 MCP、不需要真实数据。

守四条**改坏了用户就看得见**的性质：
1. 用户数据一律转义（编码/描述来自 excel，未转义就能把版面撕开）；
2. 结构树是**原生** ``<details>``（平台是 ``sandbox=""`` 预览，脚本不执行，JS 折叠必然失效）；
3. 有预算上限且**交代缺口**（HTML 撞 5MB 回写上限就整条入口没了）；
4. 自包含：不引任何外链/脚本（内网 + 沙箱，外链要么被拦要么白等）。
"""
import re

import report


def _result(**over):
    base = {
        "status": "success",
        "message": "合并完成：3 行（含根 ROOT），组件 2 个，警告 1 条。",
        "summary": {
            "tree": {"nodes": 3, "components": 2, "max_level": 2, "as_leaf": 1},
            "counts": {"error": 1, "warn": 1},
            "files": {"total": 2, "parsed": 2},
            "root": "ROOT",
            "elapsed_s": 1.25,
        },
        "issues": [
            {"code": "W402", "level": "warn", "stage": "S4", "stage_name": "递归展开",
             "target": "A.xls", "location": "posiz=6", "field": "LEAF-1",
             "message": "未找到子BOM 文件，按叶子零件展开：LEAF-1", "hint": "把子BOM 补进 zip"},
            {"code": "E201", "level": "error", "stage": "S2.4", "stage_name": "重复行",
             "target": "B.xls", "location": "明细第1条", "field": "mat_code",
             "message": "整行完全重复", "hint": "删除重复行"},
        ],
        "_nodes": [
            {"level": 0, "mat_code": "ROOT", "descr": "总成", "qty": 1, "total_qty": 1,
             "is_component": True, "as_leaf": False},
            {"level": 1, "mat_code": "SUB-1", "descr": "子件", "qty": 2, "total_qty": 2,
             "is_component": True, "as_leaf": False},
            {"level": 2, "mat_code": "LEAF-1", "descr": "叶子", "posiz": "6",
             "qty": 3, "total_qty": 6, "is_component": False, "as_leaf": True},
        ],
        "artifact": {"filename": "总BOM_ROOT_bom_1.xlsx", "rows": 3, "bytes": 12345},
    }
    base.update(over)
    return base


def _html(**over) -> str:
    return report.build_report(_result(**over), merged_filename="总BOM_ROOT_bom_1.xlsx",
                               job_id="bom_1", generated_at="2026-10-22 10:00").decode("utf-8")


# ---------------------------------------------------------------- 渲染骨架

def test_renders_summary_tree_and_issues():
    html = _html()
    assert "BOM 合并报告" in html
    assert "ROOT" in html and "合并完成" in html
    # 卡片：行数/组件/错误/警告都能看到
    assert ">3<" in html and "结构行数" in html and "警告" in html
    # 两条问题分组（文件维度）都在
    assert "A.xls" in html and "B.xls" in html
    assert "错误 1 / 警告 0" in html and "警告 1" in html
    # 合并文件只写名字，不写链接（沙箱禁下载，链接必然点不动）
    assert "总BOM_ROOT_bom_1.xlsx" in html


def test_tree_uses_native_details_and_opens_root():
    """无脚本也能展开：``<details>`` 两个（根 + 一级组件），根带 ``open``，叶子是纯行。"""
    html = _html()
    assert html.count("<details") == 2
    assert '<details class="node" open>' in html
    assert html.count('class="kids"') == 2
    # 叶子（无子节点）不包 details，避免空折叠项
    assert '<div class="line">' in html
    assert "按叶子展开" in html


def test_user_text_is_escaped():
    """来自 excel 的编码/描述一律转义：不能出现真的标签。"""
    nodes = _result()["_nodes"]
    nodes[1]["descr"] = '<script>alert("x")</script>'
    nodes[0]["mat_code"] = "ROOT<&>"
    html = _html(_nodes=nodes)
    assert "<script" not in html.lower()
    assert "&lt;script&gt;" in html
    assert "ROOT&lt;&amp;&gt;" in html


def test_self_contained_no_external_resources():
    """内联 CSS、无外链、无脚本：离线/沙箱环境也能正常显示。"""
    html = _html()
    assert "<script" not in html.lower()
    assert "<link" not in html.lower()
    assert not re.search(r"https?://", html)
    assert "<style>" in html


# ---------------------------------------------------------------- 上限与降级

def test_node_budget_truncates_and_explains(monkeypatch):
    """超出节点预算：只渲染前 N 个，并明确写出还有多少行没展示。"""
    monkeypatch.setattr(report, "MAX_REPORT_NODES", 2)
    html = _html()
    assert "另有 1 行未展示" in html
    tree = html.split("结构总览", 1)[1].split("问题清单", 1)[0]
    assert "LEAF-1" not in tree                      # 第三个节点确实没渲染进树


def test_issue_budget_truncates_and_explains(monkeypatch):
    monkeypatch.setattr(report, "MAX_REPORT_ISSUES", 1)
    html = _html()
    assert "另有 1 条未展示" in html
    assert "B.xls" not in html                        # 只列第一条所在分组


def test_empty_nodes_and_issues_degrade_readably():
    html = _html(_nodes=[], issues=[])
    assert "没有可展示的结构行" in html
    assert "没有问题" in html


def test_dirty_fields_do_not_break_rendering():
    """脏数据（level 非数字、缺字段、qty 是字符串）只丢展示，不抛异常。"""
    html = _html(_nodes=[{"level": "x", "mat_code": None},
                         {"level": 1, "mat_code": "A", "qty": "abc", "total_qty": None}])
    assert "（空编码）" in html and "abc" in html


# ---------------------------------------------------------------- 文件名

def test_report_filename_keeps_job_stem():
    assert report.report_filename("总BOM_ROOT_bom_1.xlsx") == "总BOM_ROOT_bom_1_报告.html"


def test_report_filename_tolerates_other_input():
    assert report.report_filename("") == "总BOM_报告.html"
    assert report.report_filename("x.xlsx") == "x_报告.html"
