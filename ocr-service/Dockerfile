# OCR MCP 服务：RapidOCR（PaddleOCR 模型 ONNX 版）+ FastMCP streamable-http
FROM python:3.12-slim

WORKDIR /app

# opencv-python 在 slim 镜像缺 X11/glib 运行库（headless 场景仍需 libgl/libglib）
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libxcb1 \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
# 模型已打包在 rapidocr_onnxruntime wheel 内，无需额外下载
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py ./
# 回源校验与受限下载的纯逻辑（server.py 依赖；可脱离模型单测，见 tests/）
COPY ocr_core.py ./

EXPOSE 8000
CMD ["python", "server.py"]
