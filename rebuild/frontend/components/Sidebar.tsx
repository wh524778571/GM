"use client";

import { usePathname } from "next/navigation";
import { NavItem } from "./NavItem";
import { NAV_ITEMS } from "./nav";

/** 统一外壳左侧栏：7 个 comp-nav-item，active 态由当前路由决定。 */
export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex w-60 shrink-0 flex-col gap-6 border-r border-subtle bg-card px-5 py-6">
      <div>
        <div className="text-base font-semibold text-primary">Yolo 的国漫笔记</div>
        <div className="mt-1 text-xs text-tertiary">内容工作台 v6.0</div>
      </div>

      <nav className="flex flex-col gap-1" aria-label="主导航">
        {NAV_ITEMS.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return <NavItem key={item.href} {...item} active={active} />;
        })}
      </nav>

      <div className="mt-auto rounded-nav border border-subtle bg-raised px-3 py-3">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-pill bg-plat-xhs" />
          <span className="text-xs font-medium text-primary">小红书 · 主战场</span>
        </div>
        <p className="mt-1 text-xs leading-5 text-tertiary">纯文字无图 ≤1000 字，规则以 platforms.yaml 为准</p>
      </div>
    </aside>
  );
}
