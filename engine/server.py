# -*- coding: utf-8 -*-
"""FastAPI 服务：上传 CSV -> 标准化 -> 分析 -> JSON；并托管前端静态资源。"""
from __future__ import annotations

import json
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, File, UploadFile, Query
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))  # 使 engine/ 可被导入

from loader import read_csv, normalize, load_ontology
from analysis import run_all

BASE = Path(__file__).resolve().parent
ROOT = BASE.parent
APP_DIR = ROOT / "app"
ONTOLOGY_PATH = ROOT / "ontology" / "ontology.json"

app = FastAPI(title="EpiScope · 流行病学数据分析平台", version="0.2.0")


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/ontology")
def get_ontology():
    return JSONResponse(load_ontology(ONTOLOGY_PATH))


@app.post("/api/analyze")
async def analyze(files: List[UploadFile] = File(...), min_cases: int = Query(3, ge=1)):
    """接收一个或多个 CSV（UTF-8/GBK 自动识别），合并分析。"""
    frames, sources = [], []
    for f in files:
        raw = await f.read()
        if not raw:
            continue
        df = read_csv(raw)
        df = normalize(df)
        df["_source"] = f.filename
        frames.append(df)
        sources.append(f.filename)
    if not frames:
        return JSONResponse({"error": "没有可解析的文件"}, status_code=400)
    import pandas as pd
    merged = pd.concat(frames, ignore_index=True)
    result = run_all(merged, min_cases=min_cases)
    result["meta"] = {
        "files": sources,
        "rows": int(len(merged)),
        "schema": "cn_notifiable_disease_card",
        "ontology": "ids-onto/0.1.0",
    }
    return JSONResponse(result)


@app.get("/api/raw_text")
def raw_text(path: str):
    """前端"本地路径加载"用：返回解码后的原始文本（UTF-8/GBK 自动识别）。"""
    p = Path(path)
    if not p.exists():
        return JSONResponse({"error": "文件不存在"}, status_code=404)
    from loader import detect_encoding
    raw = p.read_bytes()
    enc = detect_encoding(raw)
    return JSONResponse({"encoding": enc, "text": raw.decode(enc, errors="replace")})


@app.get("/api/analyze_local")
def analyze_local(path: str, min_cases: int = 3):
    """仅本地开发用：直接读取磁盘 CSV。"""
    p = Path(path)
    if not p.exists():
        return JSONResponse({"error": "文件不存在"}, status_code=404)
    df = read_csv(p)
    norm = normalize(df)
    result = run_all(norm, min_cases=min_cases)
    result["meta"] = {"files": [p.name], "rows": int(len(norm)), "schema": "cn_notifiable_disease_card"}
    return JSONResponse(result)


# 静态资源
app.mount("/static", StaticFiles(directory=str(APP_DIR)), name="static")


@app.get("/")
def index():
    return FileResponse(APP_DIR / "index.html")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)
