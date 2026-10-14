# -*- coding: utf-8 -*-
"""产出落盘与下载地址铸造的单测（**不依赖 mcp、不依赖 BOM 数据**）。

覆盖：产出名白名单（路径穿越）、原子落盘与取回、过期即删、
容量兜底（条数/字节，从旧到新淘汰）、清理只动自己写的东西、地址铸造（编码 + 基址优先级）。

这些性质都跟"**下载端点没有鉴权**"绑在一起：URL 就是凭证，所以清理策略与名字校验
不是"优化项"，而是安全与磁盘两方面的硬要求——测试守的就是这条线。
"""
import importlib
import os

import pytest


def load_store(monkeypatch, **env):
    """按给定环境变量重新加载 bom_store（该模块在导入期读取环境变量）。"""
    for k in ("BOM_ARTIFACT_DIR", "BOM_PUBLIC_BASE_URL", "BOM_ARTIFACT_TTL_S",
              "BOM_ARTIFACT_MAX_FILES", "BOM_ARTIFACT_MAX_BYTES"):
        monkeypatch.delenv(k, raising=False)
    for k, v in env.items():
        monkeypatch.setenv(k, str(v))
    import bom_store
    return importlib.reload(bom_store)


# ---------------------------------------------------------------- 名字白名单


@pytest.mark.parametrize("name", [
    "",                                  # 空
    "a/b.xlsx",                          # 正斜杠
    "a\\b.xlsx",                         # 反斜杠（Linux 上 Path.name 不拦，必须自己判）
    "../x.xlsx",                         # 上跳
    "..\\x.xlsx",
    "..",
    ".",
    "notes.txt",                         # 后缀不在白名单
    "总BOM_x.xlsx.tmp",                  # 中间态不可下载
    "x" * 200 + ".xlsx",                 # 超长（要落进 URL 与响应头）
])
def test_unsafe_names_are_rejected(monkeypatch, name):
    store = load_store(monkeypatch)
    assert store.is_safe_name(name) is False


@pytest.mark.parametrize("name", [
    "bom_1700000000123_a1b2c3d4.xlsx",
    "总BOM_WCCMT-00000B0570_bom_1700000000123_a1b2c3d4.xlsx",   # 中文名（用户下载时看到的就是它）
])
def test_artifact_names_are_accepted(monkeypatch, name):
    store = load_store(monkeypatch)
    assert store.is_safe_name(name) is True


def test_save_refuses_unsafe_name(monkeypatch, tmp_path):
    store = load_store(monkeypatch)
    with pytest.raises(ValueError):
        store.save("../逃逸.xlsx", b"x", path=tmp_path)


# ---------------------------------------------------------------- 落盘与取回


def test_save_then_resolve_round_trip(monkeypatch, tmp_path):
    """落盘 → 取回：字节一致，且**不留中间态**（原子写的目的就在这）。"""
    store = load_store(monkeypatch)
    name = "总BOM_WCCMT-00000B0570_bom_1_ab.xlsx"
    path = store.save(name, b"PK\x03\x04data", path=tmp_path)
    assert path.read_bytes() == b"PK\x03\x04data"
    assert sorted(p.name for p in tmp_path.iterdir()) == [name]      # 没有 .tmp 残留
    assert store.resolve(name, path=tmp_path) == path


def test_resolve_returns_none_for_unsafe_or_missing(monkeypatch, tmp_path):
    store = load_store(monkeypatch)
    assert store.resolve("../../etc/passwd", path=tmp_path) is None
    assert store.resolve("没有这个文件.xlsx", path=tmp_path) is None


def test_resolve_deletes_expired_artifact(monkeypatch, tmp_path):
    """过期文件"取不到 + 顺手删掉"：端点被点到的时候正是最好的清理时机。"""
    store = load_store(monkeypatch, BOM_ARTIFACT_TTL_S=100)
    name = "bom_1_ab.xlsx"
    path = store.save(name, b"x", path=tmp_path)
    old = 1_000_000.0
    os.utime(path, (old, old))
    assert store.resolve(name, path=tmp_path, now=old + 101) is None
    assert not path.exists()


def test_resolve_keeps_fresh_artifact(monkeypatch, tmp_path):
    store = load_store(monkeypatch, BOM_ARTIFACT_TTL_S=100)
    name = "bom_1_ab.xlsx"
    path = store.save(name, b"x", path=tmp_path)
    old = 1_000_000.0
    os.utime(path, (old, old))
    assert store.resolve(name, path=tmp_path, now=old + 99) == path


# ---------------------------------------------------------------- 清理


def test_sweep_drops_expired_and_keeps_fresh(monkeypatch, tmp_path):
    store = load_store(monkeypatch, BOM_ARTIFACT_TTL_S=100)
    old = tmp_path / "老的.xlsx"
    fresh = tmp_path / "新的.xlsx"
    old.write_bytes(b"1")
    fresh.write_bytes(b"2")
    os.utime(old, (1_000.0, 1_000.0))
    os.utime(fresh, (2_000.0, 2_000.0))
    assert store.sweep(path=tmp_path, now=2_050.0) == 1
    assert not old.exists() and fresh.exists()


def test_sweep_evicts_oldest_over_max_files(monkeypatch, tmp_path):
    """TTL 之内也要有条数上限：否则一次批量调用就能把目录写满。"""
    store = load_store(monkeypatch, BOM_ARTIFACT_MAX_FILES=2)
    for i, stamp in enumerate((1_000.0, 2_000.0, 3_000.0)):
        p = tmp_path / f"{i}.xlsx"
        p.write_bytes(b"x")
        os.utime(p, (stamp, stamp))
    store.sweep(path=tmp_path, now=3_500.0)                          # TTL 内，只触发容量淘汰
    assert sorted(p.name for p in tmp_path.iterdir()) == ["1.xlsx", "2.xlsx"]


def test_sweep_evicts_over_max_bytes(monkeypatch, tmp_path):
    store = load_store(monkeypatch, BOM_ARTIFACT_MAX_BYTES=10)
    for i, stamp in enumerate((1_000.0, 2_000.0)):
        p = tmp_path / f"{i}.xlsx"
        p.write_bytes(b"0123456789")                                 # 每个 10 字节
        os.utime(p, (stamp, stamp))
    store.sweep(path=tmp_path, now=2_500.0)
    assert [p.name for p in tmp_path.iterdir()] == ["1.xlsx"]        # 最旧的被淘汰


def test_sweep_leaves_foreign_files_and_fresh_tmp_alone(monkeypatch, tmp_path):
    """清理只动自己写的东西：别人的文件、以及**还新鲜**的 .tmp 一律不碰。"""
    store = load_store(monkeypatch, BOM_ARTIFACT_TTL_S=100)
    notes = tmp_path / "运维说明.txt"
    notes.write_text("别删我")
    tmp_now = tmp_path / "bom_1_ab.xlsx.tmp"
    tmp_now.write_bytes(b"partial-write")
    os.utime(notes, (1.0, 1.0))
    os.utime(tmp_now, (2_000.0, 2_000.0))
    assert store.sweep(path=tmp_path, now=2_001.0) == 0
    assert notes.exists() and tmp_now.exists()


def test_sweep_removes_stale_tmp(monkeypatch, tmp_path):
    """陈旧的 .tmp 是异常残留（正常流程毫秒级就 replace 掉了），该清掉。"""
    store = load_store(monkeypatch)
    stale = tmp_path / "bom_1_ab.xlsx.tmp"
    stale.write_bytes(b"partial-write")
    os.utime(stale, (1.0, 1.0))
    assert store.sweep(path=tmp_path, now=store.TMP_TTL_S + 2.0) == 1
    assert not stale.exists()


def test_save_does_not_sweep_away_itself(monkeypatch, tmp_path):
    """落盘后顺手清理，但**刚写下的那份必须还在**（上限=1 时也一样）。"""
    store = load_store(monkeypatch, BOM_ARTIFACT_MAX_FILES=1)
    store.save("a.xlsx", b"1", path=tmp_path, now=1_000.0)
    latest = store.save("b.xlsx", b"2", path=tmp_path, now=1_001.0)
    assert latest.exists()
    assert not (tmp_path / "a.xlsx").exists()                        # 旧的被淘汰


# ---------------------------------------------------------------- 地址铸造


def test_public_url_encodes_name_and_trims_base(monkeypatch):
    store = load_store(monkeypatch)
    url = store.public_url("http://bom-service:8000/", "总BOM_X_bom_1_ab.xlsx")
    assert url.startswith("http://bom-service:8000/files/")
    assert url.endswith(".xlsx") and "%" in url                      # 中文名要编码
    assert "总BOM" not in url


def test_base_from_request_prefers_configured(monkeypatch):
    store = load_store(monkeypatch)
    assert store.base_from_request("https://bom.example.com/", host="内网:8000",
                                   scheme="http") == "https://bom.example.com"


def test_base_from_request_falls_back_to_host(monkeypatch):
    store = load_store(monkeypatch)
    assert store.base_from_request("", host="10.0.0.5:8000", scheme="http") == "http://10.0.0.5:8000"


def test_base_from_request_honours_forwarded_proto(monkeypatch):
    """反代后面请求自带 scheme 常是 http，用户看到的却是 https——以 X-Forwarded-Proto 为准。"""
    store = load_store(monkeypatch)
    assert store.base_from_request("", host="mcp.example.com", scheme="http",
                                   forwarded_proto="HTTPS") == "https://mcp.example.com"


def test_base_from_request_empty_when_nothing_known(monkeypatch):
    """铸不出基址就返回空串：调用方据此**不写 viewUrl**，而不是编一个半截地址。"""
    store = load_store(monkeypatch)
    assert store.base_from_request("", host=None) == ""


def test_directory_default_and_override(monkeypatch, tmp_path):
    store = load_store(monkeypatch)
    assert store.directory() == __import__("pathlib").Path(".data")   # 缺省就是 .data
    assert store.directory(tmp_path) == tmp_path
    assert store.ensure_dir(tmp_path) == tmp_path and tmp_path.is_dir()
