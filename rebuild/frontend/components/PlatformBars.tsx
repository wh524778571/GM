import { PLATFORMS } from "@/lib/platforms";
import { formatCompact } from "@/lib/format";
import type { PlatformShare } from "@/lib/types";

/** 平台分布 SVG bars：每条用对应平台色 token（currentColor 由外层类注入）。 */
export function PlatformBars({ items }: { items: PlatformShare[] }) {
  const max = Math.max(...items.map((i) => i.views), 1);

  return (
    <div className="flex flex-col gap-3">
      {items.map((item) => {
        const pct = (item.views / max) * 100;
        const platform = PLATFORMS[item.platform];
        return (
          <div key={item.platform} className={platform.text}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-secondary">{item.name}</span>
              <span className="tabular-nums text-primary">{formatCompact(item.views)}</span>
            </div>
            <svg width="100%" height="10" viewBox="0 0 100 10" preserveAspectRatio="none" role="img" aria-label={`${item.name} 阅读占比`}>
              <rect x="0" y="0" width="100" height="10" rx="5" fill="currentColor" fillOpacity="0.12" />
              <rect x="0" y="0" width={pct.toFixed(1)} height="10" rx="5" fill="currentColor" />
            </svg>
          </div>
        );
      })}
    </div>
  );
}
