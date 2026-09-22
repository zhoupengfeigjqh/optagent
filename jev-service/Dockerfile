# Jev MCP 服务：TypeSafe System One 决策模型 + FastMCP streamable-http
# 无系统库依赖（纯 HTTP 客户端调用上游 API），镜像远小于 ocr-service
FROM python:3.12-slim

WORKDIR /app

# 日志即时落盘：本服务把结构化日志打 stderr，靠 compose 的 json-file 驱动采集
ENV PYTHONUNBUFFERED=1

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py ./
# 入参校验 / 请求构造 / 重试与错误映射的纯逻辑（server.py 依赖；可脱离 MCP 框架单测，见 tests/）
COPY jev_core.py ./

EXPOSE 8000
CMD ["python", "server.py"]
