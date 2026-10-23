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
# 合并报告的 HTML 渲染（server.py 依赖，纯函数；漏拷这里容器会直接 ImportError 起不来）
COPY report.py ./

# 本服务**不写磁盘**（2026-10-21）：合并产出的 xlsx 与 HTML 报告算完直接从内存回写到运行环境
# 注入的 `resultUrl`（平台落进调用者的文件空间），因此镜像里没有产出目录、也没有对外基址配置。

# 只提供 streamable-http，监听 8000
# （与 ocr-service 同号；容器各有网络命名空间，不冲突；可用 BOM_MCP_PORT 覆盖）
EXPOSE 8000
CMD ["python", "server.py"]
