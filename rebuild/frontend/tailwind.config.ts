// tailwind.config.ts
// 设计 Token 单一真相源 —— 与《设计资产交接清单.md》§1.2 逐值一致，禁止在业务代码写死 hex。
import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // ── 亮色主题（2026-08 由设计稿统一为暖中性底 + 国漫朱红强调色）──
      // 改这里即可整体换肤；业务代码一律引用令牌，禁止写死 hex。
      colors: {
        root: "#F6F6F7", // 页面暖中性底
        card: "#FFFFFF", // 卡片纯白
        raised: "#F1F1F2", // 输入框 / 悬浮态的浅灰填充（亮色下的"抬起"提示）
        subtle: "#EDEDED", // 1px 细边
        primary: "#18191C", // 主文字（非纯黑）
        secondary: "#6B6760", // 次级文字
        tertiary: "#9A958C", // 弱化文字
        accent: "#E5484D", // 国漫红（克制朱红，降饱和 ~66%）
        "accent-bg": "#FCEBEC", // 激活 / 选中态的浅红底
        success: "#16A34A", // 亮底可读的深绿（状态药丸 / 涨幅）
        warning: "#B45309", // 亮底可读的琥珀（待发布等）
        plat: {
          toutiao: "#FF4D4F",
          baijia: "#3B82F6",
          bilibili: "#FB7299",
          xhs: "#FF2442",
        },
      },
      fontFamily: {
        // 去掉 next/font/google 后，用 CJK 系统字体栈兜底，避免构建期联网拉字体。
        // 有装 Noto Sans SC 的机器优先用它；没有则回退 PingFang SC / 微软雅黑 / 系统默认。
        sans: ['"Noto Sans SC"', '"PingFang SC"', '"Microsoft YaHei"', "system-ui", "sans-serif"],
      },
      borderRadius: {
        card: "14px",
        nav: "8px",
        row: "8px",
        btn: "8px",
        pill: "20px",
      },
      spacing: {
        // 4-up 网格间距
        gap4: "16px",
      },
      maxWidth: {
        // 主内容列
        content: "976px",
      },
    },
  },
} satisfies Config;
