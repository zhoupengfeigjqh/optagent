"""
商品数据加载与校验：读取 商品数据.xlsx 的三个工作表，产出可用的 DataFrame。

工作表（列名严格）：
    SKU清单：SKU编码 | 商品名称 | 别名 | 品类 | 规格 | 单位 | 是否启用
    映射表 ：alias | canonical | match_type | confidence | source | version | note
    噪声词表：noise_word | category | version

加载过程会把 SKU清单.别名 按 | 拆分后合并进映射表（source="sku_alias"），并做一致性校验，任一失败都抛出 DataLoadError。
"""
from __future__ import annotations
import tempfile
from pathlib import Path
import pandas as pd
from . import config
from .cache import TTLCache

# 各工作表的必需列
SKU_COLUMNS = ["SKU编码", "商品名称", "别名", "品类", "规格", "单位", "是否启用"]
SYNONYM_COLUMNS = ["alias", "canonical", "match_type", "confidence", "source", "version", "note"]
NOISE_COLUMNS = ["noise_word", "category", "version"]


class DataLoadError(ValueError):
    """商品数据加载或校验失败"""


# 三个商品数据文件都是 Excel：只接受这些后缀，其余（含签名地址无后缀）回落默认值
_EXCEL_SUFFIXES = {".xlsx", ".xlsm", ".xls"}


def _is_url(path: str) -> bool:
    return path.startswith("http://") or path.startswith("https://")


def _url_suffix(url: str, allowed: set[str], default: str) -> str:
    """从 URL 路径里取后缀（忽略 query/fragment），不在白名单内时用 default。"""
    suffix = Path(url.split("?")[0].split("#")[0]).suffix.lower()
    return suffix if suffix in allowed else default


def _download_to_temp(url: str, timeout: float) -> Path:
    """下载 URL 到临时文件，返回路径，调用方负责清理"""
    import httpx

    try:
        resp = httpx.get(url, timeout=timeout, follow_redirects=True)
        resp.raise_for_status()
    except Exception as exc:  # noqa: BLE001
        raise DataLoadError(f"下载商品数据失败：{url}（{exc}）") from exc
    suffix = _url_suffix(url, _EXCEL_SUFFIXES, ".xlsx")
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    tmp.write(resp.content)
    tmp.close()
    return Path(tmp.name)


def _read_sheets(path: Path) -> dict[str, pd.DataFrame]:
    """读取全部工作表，统一转字符串并去首尾空白"""
    try:
        sheets = pd.read_excel(path, sheet_name=None)
    except Exception as exc:  # noqa: BLE001
        raise DataLoadError(f"读取商品数据 Excel 失败：{path}（{exc}）") from exc
    out: dict[str, pd.DataFrame] = {}
    for name, df in sheets.items():
        df = df.fillna("").astype(str)
        df = df.apply(lambda col: col.str.strip())
        out[name] = df
    return out


def _check_columns(df: pd.DataFrame, required: list[str], sheet_name: str) -> None:
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise DataLoadError(f"工作表「{sheet_name}」缺少列：{missing}（需要 {required}）")


def load_product_data(path_or_url: str) -> dict[str, pd.DataFrame]:
    """
    加载并校验商品数据（单个 Excel，三个工作表），返回 {"sku", "synonyms", "noise"}。
    - 支持本地路径与 HTTP/HTTPS URL；
    - 校验三张表列名、映射表 canonical、alias 重复或冲突、噪声词不碰 SKU 名称；
    - 把 SKU清单.别名 合并进映射表 source="sku_alias"。
    """
    tmp_path = None
    try:
        if _is_url(path_or_url):
            tmp_path = _download_to_temp(path_or_url, config.HTTP_TIMEOUT_SECONDS)
            path = tmp_path
        else:
            path = Path(path_or_url)
            if not path.exists():
                alt = config.PROJECT_ROOT / path_or_url
                if alt.exists():
                    path = alt
                else:
                    raise DataLoadError(f"商品数据文件不存在：{path_or_url}")

        sheets = _read_sheets(path)
        for sheet in (config.SHEET_SKU, config.SHEET_SYNONYMS, config.SHEET_NOISE):
            if sheet not in sheets:
                raise DataLoadError(
                    f"缺少工作表「{sheet}」，请确认三张表齐全"
                    f"（{config.SHEET_SKU}/{config.SHEET_SYNONYMS}/{config.SHEET_NOISE}）"
                )
        sku = sheets[config.SHEET_SKU]
        syn = sheets[config.SHEET_SYNONYMS]
        noise = sheets[config.SHEET_NOISE]
        _check_columns(sku, SKU_COLUMNS, config.SHEET_SKU)
        _check_columns(syn, SYNONYM_COLUMNS, config.SHEET_SYNONYMS)
        _check_columns(noise, NOISE_COLUMNS, config.SHEET_NOISE)
        return _validate_and_merge(sku, syn, noise)
    finally:
        if tmp_path is not None:
            try:
                tmp_path.unlink()
            except OSError:
                pass


def _read_single_sheet(path: str, required_columns: list[str], sheet_label: str) -> pd.DataFrame:
    """读取单个工作表文件（取第一个 sheet），校验列名，返回原始 DataFrame。"""
    tmp_path = None
    try:
        if _is_url(path):
            tmp_path = _download_to_temp(path, config.HTTP_TIMEOUT_SECONDS)
            p = tmp_path
        else:
            p = Path(path)
            if not p.exists():
                alt = config.PROJECT_ROOT / path
                if alt.exists():
                    p = alt
                else:
                    raise DataLoadError(f"{sheet_label}文件不存在：{path}")
        sheets = _read_sheets(p)
        if not sheets:
            raise DataLoadError(f"{sheet_label}文件为空：{path}")
        df = next(iter(sheets.values()))
        _check_columns(df, required_columns, sheet_label)
        return df
    finally:
        if tmp_path is not None:
            try:
                tmp_path.unlink()
            except OSError:
                pass


def _validate_and_merge(sku: pd.DataFrame, syn: pd.DataFrame, noise: pd.DataFrame) -> dict:
    """校验三表（canonical/alias/噪声词）并把 SKU别名 合并进映射表。"""
    # 只保留有效行（关键列为空的行丢弃）
    sku = sku[sku["商品名称"].ne("")].reset_index(drop=True)
    syn = syn[syn["alias"].ne("")].reset_index(drop=True)
    noise = noise[noise["noise_word"].ne("")].reset_index(drop=True)

    # 映射表 canonical 必须存在于 SKU清单.商品名称
    canonical_set = set(sku["商品名称"].tolist())
    bad_canon = sorted(set(syn["canonical"].tolist()) - canonical_set)
    if bad_canon:
        raise DataLoadError(
            f"映射表 canonical 不存在于「{config.SHEET_SKU}.商品名称」：{bad_canon}"
        )

    # 噪声词不得出现在任何 SKU 商品名称中
    sku_names = [n for n in sku["商品名称"].tolist() if n]
    noise_hits = []
    for nw in noise["noise_word"].tolist():
        for name in sku_names:
            if nw and nw in name:
                noise_hits.append(f"{nw!r} ⊂ {name!r}")
    if noise_hits:
        raise DataLoadError(f"噪声词不能出现在商品名称中（会误删）：{noise_hits}")

    # 映射表内部 alias 不允许重复
    dup_aliases = syn["alias"][syn["alias"].duplicated()].tolist()
    if dup_aliases:
        raise DataLoadError(f"映射表 alias 重复：{sorted(set(dup_aliases))}")

    # 合并 SKU清单.别名 进映射表 source="sku_alias"
    merged = merge_sku_aliases(sku, syn)
    return {"sku": sku, "synonyms": merged, "noise": noise}


def _load_three_product_data(
    sku_path: str,
    synonyms_path: str,
    noise_path: str,
) -> dict[str, pd.DataFrame]:
    """真正执行「下载/读取三张表 → 校验 → 合并别名」，不含缓存。"""
    sku = _read_single_sheet(sku_path or config.DEFAULT_SKU_PATH, SKU_COLUMNS, config.SHEET_SKU)
    syn = _read_single_sheet(
        synonyms_path or config.DEFAULT_SYNONYMS_PATH, SYNONYM_COLUMNS, config.SHEET_SYNONYMS
    )
    noise = _read_single_sheet(
        noise_path or config.DEFAULT_NOISE_PATH, NOISE_COLUMNS, config.SHEET_NOISE
    )
    return _validate_and_merge(sku, syn, noise)


# 三个地址组合 -> 解析结果；只缓存只读数据，调用方不得修改返回的 DataFrame
_DATA_CACHE: TTLCache[dict[str, pd.DataFrame]] = TTLCache(
    config.DATA_CACHE_TTL_SECONDS, config.DATA_CACHE_MAX_ENTRIES
)


def clear_product_data_cache() -> None:
    """清空商品数据表缓存（换数据后需要立刻生效时调用）。"""
    _DATA_CACHE.clear()


def load_product_data_three(
    sku_path: str = "",
    synonyms_path: str = "",
    noise_path: str = "",
) -> dict[str, pd.DataFrame]:
    """加载三个独立的商品数据文件（各一个 sheet），返回 {"sku", "synonyms", "noise"}。

    三个参数都支持本地路径 / HTTP URL，留空时用 config 里的默认文件。
    同一组地址在 DATA_CACHE_TTL_SECONDS 内复用上次的解析结果（见 core/cache.py）。
    """
    sku = sku_path or config.DEFAULT_SKU_PATH
    syn = synonyms_path or config.DEFAULT_SYNONYMS_PATH
    noise = noise_path or config.DEFAULT_NOISE_PATH
    return _DATA_CACHE.get_or_load(
        (sku, syn, noise), lambda: _load_three_product_data(sku, syn, noise)
    )



def merge_sku_aliases(sku: pd.DataFrame, syn: pd.DataFrame) -> pd.DataFrame:
    """
    把 SKU清单.别名 按 | 拆分后合并进映射表，source="sku_alias"。
    同一 alias 指向不同 canonical 视为冲突并报错；同名同目标则去重。
    """
    existing: dict[str, str] = {}
    rows: list[dict] = []
    for _, r in syn.iterrows():
        alias, canonical = r["alias"], r["canonical"]
        existing.setdefault(alias, canonical)
        rows.append({c: r[c] for c in SYNONYM_COLUMNS})

    for _, r in sku.iterrows():
        canonical = r["商品名称"]
        alias_cell = r.get("别名") or ""
        for alias in alias_cell.split("|"):
            alias = alias.strip()
            if not alias:
                continue
            prev = existing.get(alias)
            if prev is not None and prev != canonical:
                raise DataLoadError(
                    f"别名冲突：「{alias}」同时指向「{prev}」和「{canonical}」"
                )
            if prev == canonical:
                continue  # 同名同目标，去重
            existing[alias] = canonical
            rows.append({
                "alias": alias,
                "canonical": canonical,
                "match_type": "exact",
                "confidence": "strict",
                "source": "sku_alias",
                "version": "1",
                "note": "自动从 SKU清单.别名 合并",
            })

    if not rows:
        return pd.DataFrame(columns=SYNONYM_COLUMNS)
    return pd.DataFrame(rows, columns=SYNONYM_COLUMNS)
