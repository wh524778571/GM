import type { TrendPoint } from "@/lib/types";
import { formatCompact } from "@/lib/format";

/** 阅读趋势 SVG polyline（颜色走 currentColor / token 类，不写裸 hex）。 */
export function TrendChart({ points, width = 592, height = 200 }: { points: TrendPoint[]; width?: number; height?: number }) {
  const padX = 8;
  const padY = 16;
  const max = Math.max(...points.map((p) => p.views), 1);
  const stepX = points.length > 1 ? (width - padX * 2) / (points.length - 1) : 0;

  const coords = points.map((p, i) => {
    const x = padX + i * stepX;
    const y = padY + (1 - p.views / max) * (height - padY * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const line = coords.join(" ");
  const area = `${padX},${height - padY} ${line} ${(padX + (points.length - 1) * stepX).toFixed(1)},${height - padY}`;

  return (
    <div className="text-accent">
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="近 14 日阅读量趋势"
      >
        <polygon points={area} fill="currentColor" fillOpacity="0.12" />
        <polyline
          points={line}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      <div className="mt-2 flex justify-between text-xs text-tertiary">
        <span>{points[0]?.date}</span>
        <span>峰值 {formatCompact(max)}</span>
        <span>{points[points.length - 1]?.date}</span>
      </div>
    </div>
  );
}
