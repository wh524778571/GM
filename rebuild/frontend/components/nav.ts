import type { ComponentType } from "react";
import {
  IconChart,
  IconDashboard,
  IconDoc,
  IconFolder,
  IconImage,
  IconPen,
  IconSpark,
  type IconProps,
} from "./icons";

/** 统一信息架构（侧边栏顺序与画布一致）。 */
export interface NavEntry {
  href: string;
  label: string;
  icon: ComponentType<IconProps>;
}

export const NAV_ITEMS: NavEntry[] = [
  { href: "/", label: "工作台", icon: IconDashboard },
  { href: "/writer", label: "文章编辑", icon: IconPen },
  { href: "/topics", label: "今日选题", icon: IconSpark },
  { href: "/articles", label: "文章管理", icon: IconDoc },
  { href: "/analytics", label: "数据看板", icon: IconChart },
  { href: "/assets", label: "配图管理", icon: IconImage },
  { href: "/files", label: "项目文件", icon: IconFolder },
];
