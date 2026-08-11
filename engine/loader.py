# -*- coding: utf-8 -*-
"""CSV 读取与标准化：自动识别编码(UTF-8/GBK)，按本体 sourceMapping 归一化列名。"""
from __future__ import annotations

import io
import json
import re
import sys
from pathlib import Path
from typing import Optional

import pandas as pd

# ---- 本体 schema 加载 ----
_ONTOLOGY_PATH = Path(__file__).resolve().parent.parent / "ontology" / "ontology.json"


def load_ontology(path: Path = _ONTOLOGY_PATH) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


ONTOLOGY = load_ontology()

# 所有 sourceSchemas 的列映射合并：中文列名 -> (ObjectType, propertyId)
COLUMN_MAP: dict[str, tuple[str, str]] = {}
for schema in ONTOLOGY.get("sourceSchemas", []):
    COLUMN_MAP.update(schema["columnMapping"])

REGIONS: dict[str, str] = ONTOLOGY.get("vocabularies", {}).get("regions", {})


# ---- 编码识别 ----
def detect_encoding(raw: bytes) -> str:
    for enc in ("utf-8-sig", "utf-8"):
        try:
            raw.decode(enc)
            return enc
        except UnicodeDecodeError:
            continue
    return "gbk"  # 兜底 GBK


def read_csv(path_or_bytes, **kwargs) -> pd.DataFrame:
    """读取 CSV（支持路径或 bytes），自动识别 UTF-8/GBK。"""
    if isinstance(path_or_bytes, (bytes, bytearray)):
        raw = bytes(path_or_bytes)
    else:
        raw = Path(path_or_bytes).read_bytes()
    enc = detect_encoding(raw)
    text = raw.decode(enc, errors="replace")
    df = pd.read_csv(io.StringIO(text), dtype=str, keep_default_na=False, **kwargs)
    # 去掉常见脏字符
    df.columns = [str(c).strip().lstrip("\ufeff").strip() for c in df.columns]
    for col in df.columns:
        df[col] = df[col].astype(str).str.strip()
    return df


# ---- 日期解析 ----
_DATE_RE = re.compile(r"(\d{4})/(\d{1,2})/(\d{1,2})")
_EMPTY = {".", "", "-", "None", "nan", "null", "无"}


def _norm(v: str) -> str:
    return "" if v in _EMPTY else v


def parse_date(s: str) -> Optional[str]:
    """'2025/12/3' -> '2025-12-03'；无法解析返回 None。"""
    s = _norm(s)
    if not s:
        return None
    m = _DATE_RE.search(s)
    if not m:
        return None
    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    return f"{y:04d}-{mo:02d}-{d:02d}"


def parse_datetime(s: str) -> Optional[str]:
    s = _norm(s)
    if not s:
        return None
    m = _DATE_RE.search(s)
    if not m:
        return None
    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    date_part = f"{y:04d}-{mo:02d}-{d:02d}"
    tm = re.search(r"(\d{1,2}):(\d{2})(?::(\d{2}))?", s)
    if tm:
        hh, mm = int(tm.group(1)), int(tm.group(2))
        ss = int(tm.group(3)) if tm.group(3) else 0
        return f"{date_part} {hh:02d}:{mm:02d}:{ss:02d}"
    return date_part


# ---- 归一化 ----
def normalize(df: pd.DataFrame) -> pd.DataFrame:
    """按本体映射把中文列名转成统一字段；未映射列保留 raw_ 前缀。"""
    out = {}
    used = set()
    for col in df.columns:
        if col in COLUMN_MAP:
            obj, prop = COLUMN_MAP[col]
            key = f"{obj}.{prop}"
            out.setdefault(key, df[col])
            used.add(col)
        else:
            out[f"raw_{col}"] = df[col]
    norm = pd.DataFrame(out)
    # 统一日期字段
    date_fields = [
        "Case.onset_date", "Case.fill_date", "Person.birth_date", "Case.death_date",
    ]
    dt_fields = [
        "Case.diag_time", "Case.record_time", "Case.district_audit_time",
        "Case.city_audit_time", "Case.province_audit_time",
        "Case.correct_report_time", "Case.correct_final_time",
    ]
    for f in date_fields:
        if f in norm.columns:
            norm[f] = norm[f].map(parse_date)
    for f in dt_fields:
        if f in norm.columns:
            norm[f] = norm[f].map(parse_datetime)
    # 卡片ID：去掉行首单引号
    if "Case.card_id" in norm.columns:
        norm["Case.card_id"] = norm["Case.card_id"].str.replace(r"^'", "", regex=True)
    # 派生：唯一人 key（姓名+性别+出生年）
    if all(k in norm.columns for k in ("Person.name", "Person.sex", "Person.birth_date")):
        yr = norm["Person.birth_date"].str.slice(0, 4)
        norm["Person.person_key"] = norm["Person.name"] + "|" + norm["Person.sex"] + "|" + yr
    return norm


# ---- 便捷访问 ----
def obj_cols(norm: pd.DataFrame, obj: str) -> list[str]:
    return [c for c in norm.columns if c.startswith(obj + ".")]


def col(norm: pd.DataFrame, obj: str, prop: str) -> pd.Series:
    return norm[f"{obj}.{prop}"]


def main():  # pragma: no cover
    if len(sys.argv) < 2:
        print("usage: python loader.py <csv>")
        return
    df = read_csv(sys.argv[1])
    norm = normalize(df)
    print("原始列数:", df.shape[1], "行数:", df.shape[0])
    print("映射命中列数:", len([c for c in norm.columns if "." in c]))
    print(norm.head(3).to_string())


if __name__ == "__main__":
    main()
