import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// 前端单元测试配置：复用 tsconfig 的 `@/*` 路径别名，纯逻辑测试跑在 node 环境
// （fetch / Response 在 Node 22 已是全局，无需 jsdom）。
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    globals: false,
  },
});
