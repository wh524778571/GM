// tailwind.config.ts
// 设计 Token 单一真相源 —— 与《设计资产交接清单.md》§1.2 逐值一致，禁止在业务代码写死 hex。
import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        root: "#0A0A0C",
        card: "#141417",
        raised: "#1C1C20",
        subtle: "#27272A",
        primary: "#EFEBE2",
        secondary: "#A8A298",
        tertiary: "#6B6760",
        accent: "#FF5C3A",
        "accent-bg": "#1E130D",
        success: "#4ADE80",
        warning: "#FBBF24",
        plat: {
          toutiao: "#FF4D4F",
          baijia: "#3B82F6",
          bilibili: "#FB7299",
          xhs: "#FF2442",
        },
      },
      fontFamily: {
        sans: ['"Noto Sans SC"', "system-ui", "sans-serif"],
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
