# OCR MCP 服务：RapidOCR（PaddleOCR 模型 ONNX 版）+ FastMCP streamable-http
FROM python:3.12-slim

WORKDIR /app

# opencv-python 在 slim 镜像缺 X11/glib 运行库（headless 场景仍需 libgl/libglib）
# RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libxcb1 \
#   && rm -rf /var/lib/apt/lists/*
# 原第 7 行，改为：
RUN sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || \
    sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libxcb1 \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
# pip 源同步指向阿里云（与本文件上方 apt 源同一原因）：Docker 构建容器直连 pypi.org
# 会超时（`ReadTimeoutError ... pypi.org:443`），表现为 `No matching distribution found for mcp`，
# 导致任何一次真实镜像重建都失败。
RUN pip config set global.index-url https://mirrors.aliyun.com/pypi/simple/ \
  && pip config set global.trusted-host mirrors.aliyun.com
# 模型已打包在 rapidocr_onnxruntime wheel 内，无需额外下载
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py ./
# 回源校验与受限下载的纯逻辑（server.py 依赖；可脱离模型单测，见 tests/）
COPY ocr_core.py ./

EXPOSE 8000
CMD ["python", "server.py"]
