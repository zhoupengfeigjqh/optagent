# BOM 合并 MCP 服务：FastMCP（streamable-http）
FROM python:3.12-slim

WORKDIR /app

# 日志即时落盘：服务把启动/落盘失败信息打 stderr，靠 compose 的 json-file 驱动采集
ENV PYTHONUNBUFFERED=1

# 无系统库依赖（pandas/openpyxl/xlrd 均为纯 wheel，不装 apt 包），故不需要改 apt 源。
COPY requirements.txt ./
# pip 源指向阿里云：Docker 构建容器直连 pypi.org 会超时
# （`ReadTimeoutError ... pypi.org:443`），表现为 `No matching distribution found for mcp`，
# 导致任何一次真实镜像重建都失败。
RUN pip config set global.index-url https://mirrors.aliyun.com/pypi/simple/ \
  && pip config set global.trusted-host mirrors.aliyun.com
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py ./
# 全部业务规则（server.py 依赖；可脱离 mcp 单测，见 tests/）
COPY bom_core.py ./
# 产出落盘与下载地址铸造（同样可脱离 mcp 单测）
COPY bom_store.py ./

# 产出目录：合并算完的 xlsx 落在这里，下载路由从这里读。
# **部署时必须挂载**（compose 里是 `./bom-service/.data:/app/.data`），否则容器重建后
# 聊天记录里的下载链接全部 404。
ENV BOM_ARTIFACT_DIR=/app/.data
RUN mkdir -p /app/.data
# 对外基址（服务铸下载地址用它）：**容器部署必须显式配置**，取值 = 宿主机上 8102 那个发布
# 端口所在的地址，如 `http://192.168.1.3:8102`（见 compose 的 ports）。
# 为什么必须配：下载链接是给**用户浏览器**点的，而平台是从**容器内**调本服务的 —— 按请求
# Host 兜底只会得到 `bom:8000` 这种浏览器解析不了的地址，聊天区里那条入口点开就是死链。
# 本机私产放 `.env.local`（gitignore；env_file 优先于本行），样板见 .env.example。
# 缺省留空 = 退回按请求 Host 兜底：仅当"浏览器与服务同机且用 localhost 访问"时才恰好可用。
ENV BOM_PUBLIC_BASE_URL=""

# 只提供 streamable-http（下载地址要求进程真的在监听端口），监听 8000
# （与 ocr-service 同号；容器各有网络命名空间，不冲突；可用 BOM_MCP_PORT 覆盖）
EXPOSE 8000
CMD ["python", "server.py"]
