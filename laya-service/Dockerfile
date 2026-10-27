# Laya 决策模型服务（镜像名 `laya-service`）——**本地自建**
#
# 官方镜像 `chaitin/decis:laya-multilingual-v0.4.0` 在本网络拉不下来（多镜像站 403 /
# 层数据被改写），改为「拉源码 + 本地构建」。与官方 `docker/Dockerfile` 的差异集中在依赖来源，
# 目录布局、uid、健康检查、启动命令逐一保持与官方一致：
#
#   1. 不用 `COPY --from=ghcr.io/astral-sh/uv`：ghcr.io 不可达，改用 pip（hatchling 后端）；
#   2. 不装 `decis[laya]` 整个 extra：它连带 `decis[download]` ⇒ `modelscope>=1.16`，
#      而该包在本网络解析结果为 `from versions: none`（实测），构建必挂。
#      改为**手工装齐**：`laya==0.3.29`（模型库，自带 torch/transformers/safetensors）
#      + `huggingface_hub`（decis 的惰性导入需要它）+ `pip install .`（不含任何 extra）；
#   3. 权重**不从 Hub 下载**，而是构建期从 ModelScope 预先取到构建上下文再 COPY 进来
#      （`models/laya-multilingual/`，614MB safetensors + 33MB tokenizer）。
#      产物 `docker run` 时零外网，与官方"权重烤进镜像"的语义一致。
#
# 构建（项目根）：docker build -t laya-service laya-service
# 运行：docker run -d --name optagent-laya -p 8103:8000 -e DECIS_API_KEY=dev-laya-key laya-service

FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    # 权重目录：`paths.resolve` 首先查 `<DECIS_MODEL_DIR>/<engine id>/`
    DECIS_MODEL_DIR=/models \
    DECIS_DEFAULT_ENGINE=laya-multilingual \
    # 容器内必须能监听 0.0.0.0；非 loopback 且无 token 时服务会拒绝启动
    DECIS_HOST=0.0.0.0 \
    DECIS_PORT=8000

WORKDIR /app

# 依赖层在前：改源码不必重装全世界
COPY upstream/pyproject.toml upstream/README.md upstream/LICENSE ./
COPY upstream/src ./src

# PyPI 直连在容器内不稳（ReadTimeout / IncompleteRead 实测），走国内镜像。
# `--index-url` 可覆盖：docker build --build-arg PIP_INDEX=https://pypi.org/simple ...
ARG PIP_INDEX=https://mirrors.cloud.tencent.com/pypi/simple

# ── torch 变体（默认 CPU）──────────────────────────────────────────────────────
# 本服务实测 `device: cpu, dtype: float32`，推理 219ms/轮，GPU 完全用不上；
# 而 PyPI 的默认 Linux 轮子会连带整套 CUDA 运行时（nvidia/* 3.2GB + triton 0.9GB），
# 因此默认装 **CPU 轮子**（解压后省 ~4.5GB，压缩后省 ~2.4GB）。
#
# **以后要换回 CUDA 版**（例如换成能上 GPU 的机器），只需覆盖这两个 build-arg，其余不动：
#   docker build -t laya-service \
#     --build-arg TORCH_SPEC="torch==2.14.1" \
#     --build-arg TORCH_INDEX="https://download.pytorch.org/whl/cu130" \
#     laya-service
#   说明：版本号必须与 `laya` 允许的 torch 范围一致（它只要 `torch>=2.0`，故跟随 PyTorch
#   官方索引当时的最新版即可，如 2.14.1）；`download.pytorch.org/whl/cu130` 是本仓
#   `upstream/pyproject.toml` 里 uv 指定的 CUDA 索引，换 index 后 nvidia/* 与 triton
#   会作为依赖自动装上。装完用 `docker run --rm laya-service python -c "import
#   torch;print(torch.__version__, torch.cuda.is_available())"` 确认。
#
# 注意：torch 必须在 `laya` **之前**单独装好——先满足 `torch>=2.0`，后面才不会把
# cu 版再拖回来一份。
ARG TORCH_SPEC="torch==2.9.0+cpu"
# 轮子源：官方是 `https://download.pytorch.org/whl/cpu`，但本网络实测会 `incomplete-download`
# （Content-Length 与实际字节不符，重试 5 次仍失败）；改用上海交大镜像（同内容、可下完）。
# 换网络后可覆盖：--build-arg TORCH_INDEX=https://download.pytorch.org/whl/cpu
ARG TORCH_INDEX="https://mirror.sjtu.edu.cn/pytorch-wheels/cpu"
RUN pip install --index-url "$PIP_INDEX" --extra-index-url "$TORCH_INDEX" \
      --timeout 60 --retries 5 "$TORCH_SPEC"

RUN pip install --index-url "$PIP_INDEX" --timeout 60 --retries 5 "laya==0.3.29" "huggingface_hub>=0.30" \
    && pip install --index-url "$PIP_INDEX" --timeout 60 --retries 5 .

# 与官方同款自检：wiring 有问题就让构建失败（doctor 无 API key 时非零，故忽略其状态）
RUN decis doctor || true
RUN python -c "from decis.app import create_app; create_app(load_engine=False); print('app builds')"

# 非 root，固定 uid（先建用户，下面 COPY 才能直接用 --chown 定好属主）
RUN useradd --uid 10001 --create-home --shell /usr/sbin/nologin decis

# 权重来自 ModelScope 镜像仓库（HuggingFace 在本网络不可达），已在宿主机下载好。
#
# **必须用 `--chown` 在复制时就定属主**：Docker 层只读叠加，`COPY` 之后再 `chown -R`
# 会触发 overlayfs 的 copy-up——把 647MB 权重整份复制到新层（旧的还留着，删不掉），
# 磁盘上就是两份。`--chown` 让属主随文件一起写进同一层，只占一份。
COPY --chown=10001:10001 models/laya-multilingual /models/laya-multilingual

# `/app` 只有几百 KB 源码，单独 chown 代价可忽略（不再碰 /models）
RUN chown -R 10001:10001 /app
USER 10001:10001

EXPOSE 8000

# 只探活，不要指向 /readyz：引擎在工作线程里加载，冷启动 75~90s 属正常
HEALTHCHECK --interval=10s --timeout=3s --start-period=180s --retries=6 \
    CMD env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy -u ALL_PROXY -u all_proxy \
    python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=2).status==200 else 1)"

# exec 形式：服务是 PID 1，能直接收到 SIGTERM
CMD ["decis", "serve"]
