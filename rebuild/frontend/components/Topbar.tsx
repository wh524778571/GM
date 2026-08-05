import { Button } from "./Button";
import { BackendStatus } from "./BackendStatus";

/** 统一外壳顶栏：页面标题 + 搜索框 + 新建主按钮。 */
export interface TopbarProps {
  title: string;
  subtitle?: string;
  searchPlaceholder?: string;
  actionLabel?: string;
}

export function Topbar({
  title,
  subtitle,
  searchPlaceholder = "搜索文章 / 素材…",
  actionLabel = "新建文章",
}: TopbarProps) {
  return (
    <header className="border-b border-subtle bg-root px-6">
      <div className="mx-auto flex h-16 w-full max-w-content items-center gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold text-primary">{title}</h1>
          {subtitle ? <p className="truncate text-xs text-tertiary">{subtitle}</p> : null}
        </div>

        <BackendStatus />

        <label className="sr-only" htmlFor="topbar-search">
          搜索
        </label>
        <input
          id="topbar-search"
          type="search"
          placeholder={searchPlaceholder}
          className="h-9 w-56 rounded-btn border border-subtle bg-card px-3 text-[13px] text-primary placeholder:text-tertiary focus:border-accent focus:outline-none"
        />

        <Button>{actionLabel}</Button>
      </div>
    </header>
  );
}
