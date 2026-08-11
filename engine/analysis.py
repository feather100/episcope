# -*- coding: utf-8 -*-
"""分析引擎：流行曲线、时空分布、聚集检测、人群画像、医院负担、报告质量。
所有输出均为 JSON 可序列化结构，且不含姓名/电话/详细地址等 PII。"""
from __future__ import annotations

import re
from collections import Counter, defaultdict

import pandas as pd

from loader import REGIONS, col

_EMPTY = {".", "", "-", "None", "nan", "null", "无"}
_SCHOOL_CROWDS = {"学生", "幼托儿童", "散居儿童"}
_SCHOOL_PAT = re.compile(r"(幼儿园|小学|中学|学校|学院|大学|班)")
_BAD_UNIT_PAT = re.compile(r"(医院|保健院|诊所|卫生院|疾控|拒绝|家长|无|退休|待业)")


def _clean(v) -> str:
    if v is None:
        return ""
    s = str(v).strip()
    return "" if s in _EMPTY else s


def _counts(series: pd.Series, top: int = 0) -> list[list]:
    c = Counter(_clean(v) for v in series)
    items = sorted(c.items(), key=lambda kv: -kv[1])
    if top:
        items = items[:top]
    return [[k, v] for k, v in items]


def _date_to_dt(s: str):
    """'YYYY-MM-DD' -> pd.Timestamp or None"""
    if not s:
        return None
    try:
        return pd.Timestamp(s)
    except Exception:
        return None


def _days_diff(a: str, b: str):
    """按日期级（忽略时间）返回整天数。"""
    da, db = _date_to_dt(a), _date_to_dt(b)
    if da is None or db is None:
        return None
    return int((db.normalize() - da.normalize()).days)


def _street(addr: str) -> str:
    m = re.search(r"([^\s]+?区)([^\s]+?(?:街道|镇|乡))", addr or "")
    return (m.group(1) + m.group(2)) if m else ""


# ---------------- 概览 ----------------
def overview(norm: pd.DataFrame) -> dict:
    n = len(norm)
    diseases = _counts(col(norm, "Case", "disease_name"))
    case_classes = _counts(col(norm, "Case", "case_class"))
    onsets = [_clean(v) for v in col(norm, "Case", "onset_date")]
    onsets = [v for v in onsets if v]
    districts = {str(v)[:6] for v in col(norm, "Address", "national_code") if _clean(v)}
    orgs = {_clean(v) for v in col(norm, "Organization", "name") if _clean(v)}
    return {
        "total_cases": n,
        "unique_cards": col(norm, "Case", "card_id").nunique() if "Case.card_id" in norm else n,
        "unique_persons": col(norm, "Person", "person_key").nunique() if "Person.person_key" in norm else n,
        "unique_orgs": len(orgs),
        "covered_districts": len(districts),
        "date_range": [min(onsets) if onsets else None, max(onsets) if onsets else None],
        "diseases": diseases[:10],
        "case_classes": case_classes,
    }


# ---------------- 流行曲线 ----------------
def epidemic_curve(norm: pd.DataFrame) -> dict:
    out = {}
    for label, f in [("发病日期", "Case.onset_date"), ("诊断日期", "Case.diag_time"),
                     ("录入日期", "Case.record_time")]:
        if f not in norm.columns:
            continue
        dates = [_clean(v)[:10] for v in norm[f]]
        dates = [v for v in dates if v and v != ""]
        c = Counter(dates)
        items = sorted(c.items())
        out[label] = [{"date": k, "count": v} for k, v in items]
    return out


# ---------------- 地理分布 ----------------
def geo(norm: pd.DataFrame) -> dict:
    # 区级（按现住地址国标前6位）
    dist = Counter()
    unknown = 0
    for v in col(norm, "Address", "national_code"):
        s = _clean(v)
        if not s:
            unknown += 1
            continue
        code = s[:6]
        dist[REGIONS.get(code, code)] += 1
    district_items = sorted(dist.items(), key=lambda kv: -kv[1])
    # 街道级 top30
    streets = Counter(_street(v) for v in col(norm, "Address", "detail"))
    street_items = sorted(((k, v) for k, v in streets.items() if k), key=lambda kv: -kv[1])[:30]
    return {
        "districts": [[k, v] for k, v in district_items],
        "unknown_district": unknown,
        "streets": street_items,
    }


# ---------------- 人群画像 ----------------
def demographics(norm: pd.DataFrame) -> dict:
    crowd = _counts(col(norm, "Person", "crowd"))
    sex = _counts(col(norm, "Person", "sex"))
    # 年龄桶
    buckets = {"0-4": 0, "5-14": 0, "15-24": 0, "25-44": 0, "45-64": 0, "65+": 0, "未知": 0}
    for v in col(norm, "Person", "age"):
        m = re.search(r"(\d+)\s*岁", _clean(v))
        if not m:
            buckets["未知"] += 1
            continue
        a = int(m.group(1))
        if a < 5: buckets["0-4"] += 1
        elif a < 15: buckets["5-14"] += 1
        elif a < 25: buckets["15-24"] += 1
        elif a < 45: buckets["25-44"] += 1
        elif a < 65: buckets["45-64"] += 1
        else: buckets["65+"] += 1
    return {"crowd": crowd[:12], "sex": sex, "age_buckets": [[k, v] for k, v in buckets.items()]}


# ---------------- 医院负担 ----------------
def hospitals(norm: pd.DataFrame) -> dict:
    orgs = _counts(col(norm, "Organization", "name"), top=15)
    org_types = _counts(col(norm, "Organization", "org_type"), top=10)
    # 报告单位 × 患者现住区（top15 流向）
    flow = Counter()
    for org, addr in zip(col(norm, "Organization", "name"), col(norm, "Address", "national_code")):
        o, a = _clean(org), _clean(addr)
        if not o or not a:
            continue
        flow[(o, REGIONS.get(a[:6], a[:6]))] += 1
    flow_items = sorted(((o, d, c) for (o, d), c in flow.items()), key=lambda t: -t[2])[:15]
    return {
        "top_orgs": orgs,
        "org_types": org_types,
        "flow": [{"org": o, "district": d, "count": c} for o, d, c in flow_items],
    }


# ---------------- 聚集检测 ----------------
def clusters(norm: pd.DataFrame, min_cases: int = 3) -> dict:
    """学校/班级聚集：学龄人群按 工作单位(班级/学校) 聚合。"""
    groups = defaultdict(list)
    for work, crowd, onset, person_key, addr in zip(
            col(norm, "Person", "work_unit"), col(norm, "Person", "crowd"),
            col(norm, "Case", "onset_date"), col(norm, "Person", "person_key"),
            col(norm, "Address", "national_code")):
        w = _clean(work)
        if not w or w in {"无", "退休", "待业", "0"}:
            continue
        if _clean(crowd) not in _SCHOOL_CROWDS:
            continue
        if _BAD_UNIT_PAT.search(w) or not _SCHOOL_PAT.search(w):
            continue
        groups[w].append((person_key, onset, addr))
    rows = []
    for w, items in groups.items():
        if len(items) < min_cases:
            continue
        persons = {p for p, _, _ in items}
        dates = sorted({_clean(o) for _, o, _ in items if _clean(o)})
        dists = {REGIONS.get(_clean(a)[:6], _clean(a)[:6]) for _, _, a in items if _clean(a)}
        rows.append({
            "unit": w,
            "cases": len(items),
            "persons": len(persons),
            "date_from": dates[0] if dates else "",
            "date_to": dates[-1] if dates else "",
            "districts": sorted(d for d in dists if d),
        })
    rows.sort(key=lambda r: -r["cases"])
    return {"rows": rows, "min_cases": min_cases}


# ---------------- 报告时延与质量 ----------------
def latency(norm: pd.DataFrame) -> dict:
    onset_diag, onset_record = [], []
    for onset, diag, record in zip(
            col(norm, "Case", "onset_date"), col(norm, "Case", "diag_time"),
            col(norm, "Case", "record_time")):
        d1 = _days_diff(onset, diag)
        d2 = _days_diff(onset, record)
        if d1 is not None:
            onset_diag.append(d1)
        if d2 is not None:
            onset_record.append(d2)

    def summarize(arr):
        if not arr:
            return {"n": 0, "mean": None, "p50": None, "p90": None}
        s = pd.Series(arr)
        return {"n": len(s), "mean": float(round(s.mean(), 2)),
                "p50": float(s.median()), "p90": float(s.quantile(0.9))}

    def hist(arr, edges):
        h = [0] * (len(edges) - 1)
        for v in arr:
            for i in range(len(edges) - 1):
                if edges[i] <= v < edges[i + 1]:
                    h[i] += 1
                    break
        return [[f"{edges[i]}-{edges[i+1]}天", h[i]] for i in range(len(h))]

    edges = [0, 1, 2, 3, 5, 7, 14]
    return {
        "onset_diag": {**summarize(onset_diag), "hist": hist(onset_diag, edges)},
        "onset_record": {**summarize(onset_record), "hist": hist(onset_record, edges)},
        "late_cases": sum(1 for v in onset_record if v is not None and v > 2),
    }


def quality(norm: pd.DataFrame) -> dict:
    status = _counts(col(norm, "Case", "card_status"))
    audit = _counts(col(norm, "Case", "audit_status"))
    # 疑似重复（同人同发病日）
    dup = Counter()
    for pk, onset in zip(col(norm, "Person", "person_key"), col(norm, "Case", "onset_date")):
        if _clean(pk):
            dup[(pk, _clean(onset))] += 1
    dup_count = sum(1 for k, c in dup.items() if c > 1 and k[1])
    # 缺失率
    fields = {
        "发病日期": "Case.onset_date", "诊断时间": "Case.diag_time", "疾病名称": "Case.disease_name",
        "现住详细地址": "Address.detail", "人群分类": "Person.crowd", "性别": "Person.sex",
    }
    missing = []
    for label, f in fields.items():
        if f in norm.columns:
            rate = round(float((norm[f].map(_clean) == "").mean() * 100), 2)
            missing.append([label, rate])
    return {
        "card_status": status,
        "audit_status": audit,
        "dup_pairs": dup_count,
        "missing_rate": missing,
    }


# ---------------- 汇总入口 ----------------
def run_all(norm: pd.DataFrame, min_cases: int = 3) -> dict:
    return {
        "overview": overview(norm),
        "curve": epidemic_curve(norm),
        "geo": geo(norm),
        "demographics": demographics(norm),
        "hospitals": hospitals(norm),
        "clusters": clusters(norm, min_cases),
        "latency": latency(norm),
        "quality": quality(norm),
    }
