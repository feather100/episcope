# 启动流行病学数据分析平台（本机 127.0.0.1:8000）
cd "$PSScriptRoot"
python -m uvicorn engine.server:app --host 127.0.0.1 --port 8000 --reload
