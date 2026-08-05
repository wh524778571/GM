import Link from "next/link";
import type { ComponentType } from "react";
import type { IconProps } from "./icons";

/**
 * comp-nav-item（画布 6:105）：200×40 / 圆角 8。
 * active：bg-accent-bg + text-accent（图标 stroke=currentColor 自动转 accent）；
 * 非 active：text-secondary。
 */
export interface NavItemProps {
  href: string;
  label: string;
  icon: ComponentType<IconProps>;
  active?: boolean;
}

export function NavItem({ href, label, icon: Icon, active = false }: NavItemProps) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={[
        "flex h-10 w-[200px] items-center gap-3 rounded-nav px-3 text-sm font-medium transition-colors",
        active
          ? "bg-accent-bg text-accent"
          : "text-secondary hover:bg-raised hover:text-primary",
      ].join(" ")}
    >
      <Icon size={20} />
      <span className="truncate">{label}</span>
    </Link>
  );
}
