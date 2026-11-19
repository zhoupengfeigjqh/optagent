# fresh_food_mcp_v1 —— 生鲜订货识别 MCP 服务（Streamable HTTP，单镜像）
#
# 构建： docker build -t fresh_food_mcp_v1 .
#        只要 LLM 通道、不要 OCR（体积约 1/4）：docker build --build-arg INSTALL_OCR=0 -t fresh_food_mcp_v1:slim .
# 运行： docker run -d --name fresh_food_mcp_v1 -p 8000:8000 fresh_food_mcp_v1
# 调用： MCP 端点 http://<宿主机IP>:8000/mcp（streamable-http）
#
# 结构：两阶段构建
#   builder  —— 装依赖 + 构建期预热 OCR 模型（把权重复制到 runtime，运行时不联网）
#   runtime  —— 只保留运行所需：site-packages、模型缓存、业务代码
# 说明：本文件只做"工程瘦身"，不改任何业务逻辑；OCR 仍是 PP-OCRv6 small。

ARG PYTHON_IMAGE=python:3.11-slim
# INSTALL_OCR=0：不装 paddle 全家桶，只保留 LLM 通道（体积约 1/4）；
# 默认 1，与改造前行为完全一致。
ARG INSTALL_OCR=1

# ---------------------------------------------------------------- builder
FROM ${PYTHON_IMAGE} AS builder

ARG INSTALL_OCR

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# OCR 运行时系统库：paddle 依赖 libgomp，opencv 依赖 libgl/libglib
# apt 源指向阿里云（构建容器直连 deb.debian.org 会长时间卡在 Packages 下载）
RUN sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || \
    sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt requirements-ocr.txt ./

RUN pip config set global.index-url https://mirrors.aliyun.com/pypi/simple/ \
    && pip config set global.trusted-host mirrors.aliyun.com
RUN pip install -r requirements.txt \
    && if [ "$INSTALL_OCR" = "1" ]; then pip install -r requirements-ocr.txt; fi

COPY core/ core/

# 构建期预热：把 PP-OCRv6 small det/rec 权重打进镜像，运行时无需联网下载。
# 预热放在 COPY mcp_server.py 与数据文件**之前**——改工具签名/描述这类纯业务代码时
# 不会打断模型层缓存，重建无需重新下载权重。
RUN if [ "$INSTALL_OCR" = "1" ]; then \
        python -c "import numpy as np, cv2; from core.ocr import _init_engine; \
cv2.imwrite('/tmp/warm.png', np.full((32, 128, 3), 255, np.uint8)); \
_init_engine().predict('/tmp/warm.png')"; \
    fi \
 && rm -f /tmp/warm.png \
 && mkdir -p /root/.paddlex \
 && rm -rf /usr/local/lib/python3.11/site-packages/paddle/include \
 && find /root/.paddlex -mindepth 2 -maxdepth 2 -type d \
        ! -name 'PP-OCRv6_small_det' ! -name 'PP-OCRv6_small_rec' \
        -exec rm -rf {} + 2>/dev/null || true

# ---------------------------------------------------------------- runtime
FROM ${PYTHON_IMAGE} AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    MCP_HOST=0.0.0.0 \
    MCP_PORT=8000

RUN sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || \
    sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# 只搬运行期需要的东西：已装好的依赖 + 已预热的模型缓存
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin
COPY --from=builder /root/.paddlex /root/.paddlex

WORKDIR /app
COPY core/ core/
COPY mcp_server.py .
COPY sku.xlsx map.xlsx noise.xlsx ./

EXPOSE 8000

CMD ["python", "mcp_server.py"]
