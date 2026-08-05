# Yolo 的国漫笔记 · 后端（FastAPI）
#
# 跨平台去耦（Phase 4 / Epic 4.2）：
#   - 镜像内不含任何密钥。ZHIPU_API_KEY / DATABASE_URL 全部由运行时环境注入。
#   - 图片处理走 Pillow（requirements.txt），不依赖 macOS 专有的 sips。
#   - 数据库文件默认落在 /data 卷，容器重建不丢数据；换 Postgres 只需改 DATABASE_URL。
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# 依赖层单独缓存：requirements 不变则不重装
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# 以非 root 运行；/data 是数据库与产物的唯一可写目录
RUN useradd --create-home --uid 10001 appuser \
    && mkdir -p /data /app/var \
    && chown -R appuser:appuser /data /app
USER appuser

# 默认单一数据源指向卷内文件；生产可整体换成 postgresql+psycopg://...
ENV DATABASE_URL=sqlite:////data/app.db \
    APP_ENV=prod \
    PORT=8000

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys;\
sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health',timeout=4).status==200 else 1)"

# 先跑迁移再起服务：迁移失败就退出，绝不带着半截 schema 假装启动成功。
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000"]
