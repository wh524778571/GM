# Yolo 的国漫笔记 · 前端（Next.js App Router）
#
# 多阶段构建：deps（装依赖）→ builder（next build）→ runner（next start）。
# 前端**不持有任何密钥**：浏览器只访问同源 /api/*，服务端再按 BACKEND_BASE_URL 转发到后端。

# ── 1. 安装完整依赖（含 devDependencies，构建需要） ──────────
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── 2. 构建 ───────────────────────────────────────────────
FROM node:20-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# 产物目录固定为 .next（镜像内无历史产物，无需 NEXT_DIST_DIR 隔离）
RUN NEXT_DIST_DIR=.next npm run build

# ── 3. 运行期依赖（去掉 devDependencies，镜像更小） ─────────
FROM node:20-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ── 4. 运行 ───────────────────────────────────────────────
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    BACKEND_BASE_URL=http://backend:8000

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY package.json next.config.mjs ./

RUN useradd --create-home --uid 10002 nextuser && chown -R nextuser:nextuser /app
USER nextuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "run", "start"]
