# fresh_food_mcp_v1 —— 生鲜订货识别 MCP 服务（Streamable HTTP，单镜像）
#
# 构建：  docker build -t fresh_food_mcp_v1 .
# 运行：  docker run -d --name fresh_food_mcp_v1 -p 8000:8000 fresh_food_mcp_v1
# 调用：  MCP 端点 http://<宿主机IP>:8000/mcp（streamable-http）

# 基础镜像用 3.11：paddlepaddle 的多版本 wheel 覆盖最稳
FROM python:3.11-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    MCP_HOST=0.0.0.0 \
    MCP_PORT=8000

# 1、OCR 运行时系统库：paddle 依赖 libgomp，opencv 依赖 libgl/libglib
# apt 源同步指向阿里云（与 ocr-service 同一原因）：构建容器直连 deb.debian.org 会长时间卡在
# `Get:4 .../debian trixie/main amd64 Packages [9678 kB]`，实测 5 分钟零进度。
RUN sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || \
    sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# 2、Python 依赖（基础依赖 + 图片 OCR：paddleocr / paddlepaddle）
# pip 源同样指向阿里云：直连 pypi.org 会 ReadTimeout，表现为 No matching distribution found。
COPY requirements.txt requirements-ocr.txt ./
RUN pip config set global.index-url https://mirrors.aliyun.com/pypi/simple/ \
    && pip config set global.trusted-host mirrors.aliyun.com
RUN pip install -r requirements.txt -r requirements-ocr.txt

# 3、core 代码 + 构建期预热 OCR 模型：把 PP-OCRv6 small det/rec 权重打进镜像，运行时无需联网下载。
# 顺序有意为之：预热只依赖 core/，放在 COPY mcp_server.py 与数据文件**之前**——
# 改工具签名/描述这类纯业务代码时不会打断模型层缓存，重建无需重新下载权重。
COPY core/ core/
RUN python -c "import numpy as np, cv2; from core.ocr import _init_engine; cv2.imwrite('/tmp/warm.png', np.full((32, 128, 3), 255, np.uint8)); _init_engine().predict('/tmp/warm.png')" \
    && rm -f /tmp/warm.png

# 4、服务入口 + 默认商品数据文件（三个独立文件，地址留空时使用）
COPY mcp_server.py .
COPY SKU清单.xlsx 映射表.xlsx 噪声词表.xlsx ./

EXPOSE 8000

CMD ["python", "mcp_server.py"]
