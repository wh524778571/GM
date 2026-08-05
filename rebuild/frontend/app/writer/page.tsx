import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/Button";
import { ButtonSecondary } from "@/components/ButtonSecondary";
import { Chip } from "@/components/Chip";
import { PLATFORMS } from "@/lib/platforms";
import {
  SEED_WRITER_CHAR_COUNT,
  SEED_WRITER_OUTLINE,
  SEED_WRITER_PREVIEW,
  SEED_WRITER_TOPIC,
} from "@/lib/seed";
import type { PlatformKey } from "@/lib/types";

export const dynamic = "force-dynamic";

const PLATFORM_ORDER: PlatformKey[] = ["xhs", "toutiao", "baijia", "bilibili"];

export default function WriterPage() {
  // React 默认转义所有插值，不使用 dangerouslySetInnerHTML —— 无字符串模板注入风险。
  const paragraphs = SEED_WRITER_PREVIEW.split("\n\n");

  return (
    <AppShell title="AI 写作" subtitle="选题 → 大纲 → 生成 → 四平台预览 → 导出" actionLabel="新建选题">
      <div className="flex gap-gap4">
        {/* 左：创作设置 */}
        <div className="flex w-[336px] shrink-0 flex-col gap-4">
          <div className="rounded-card border border-subtle bg-card p-4">
            <h2 className="text-[18px] font-semibold text-primary">创作设置</h2>

            <label className="mt-3 block text-[13px] text-secondary" htmlFor="writer-topic">
              选题
            </label>
            <input
              id="writer-topic"
              defaultValue={SEED_WRITER_TOPIC}
              className="mt-1.5 h-9 w-full rounded-btn border border-subtle bg-raised px-3 text-[13px] text-primary focus:border-accent focus:outline-none"
            />

            <label className="mt-4 block text-[13px] text-secondary" htmlFor="writer-type">
              文体
            </label>
            <div id="writer-type" className="mt-1.5 flex gap-2">
              <Chip label="深度文" active />
              <Chip label="资讯速递" />
            </div>

            <label className="mt-4 block text-[13px] text-secondary">目标平台</label>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {PLATFORM_ORDER.map((key, i) => (
                <Chip key={key} label={PLATFORMS[key].name} active={i === 0} />
              ))}
            </div>

            <label className="mt-4 block text-[13px] text-secondary" htmlFor="writer-req">
              额外要求
            </label>
            <textarea
              id="writer-req"
              rows={3}
              defaultValue="保留账号调性：口语化、有观点、少形容词堆砌；结尾抛互动问题。"
              className="mt-1.5 w-full resize-none rounded-btn border border-subtle bg-raised px-3 py-2 text-[13px] leading-6 text-primary focus:border-accent focus:outline-none"
            />

            <div className="mt-4 flex gap-2">
              <Button className="flex-1">生成正文</Button>
              <ButtonSecondary>存草稿</ButtonSecondary>
            </div>
          </div>

          <div className="rounded-card border border-subtle bg-card p-4">
            <h2 className="text-[18px] font-semibold text-primary">大纲</h2>
            <ol className="mt-3 flex flex-col gap-2">
              {SEED_WRITER_OUTLINE.map((item, i) => (
                <li key={item} className="flex gap-2 text-[13px] leading-6 text-secondary">
                  <span className="text-tertiary">{i + 1}.</span>
                  <span className="min-w-0 flex-1">{item}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>

        {/* 右：实时预览 */}
        <div className="flex min-w-0 flex-1 flex-col rounded-card border border-subtle bg-card">
          <div className="flex items-center gap-3 border-b border-subtle px-4 py-3">
            <h2 className="text-[18px] font-semibold text-primary">实时预览</h2>
            <span className="text-xs text-tertiary">
              约 {SEED_WRITER_CHAR_COUNT} 字 · 小红书需纯文字无图 ≤1000 字
            </span>
            <div className="ml-auto flex gap-2">
              <ButtonSecondary className="h-8 px-3">润色去 AI 味</ButtonSecondary>
              <ButtonSecondary className="h-8 px-3">导出 docx</ButtonSecondary>
            </div>
          </div>

          <article className="flex flex-col gap-3 px-5 py-4">
            <h3 className="text-base font-semibold text-primary">{SEED_WRITER_TOPIC}</h3>
            {paragraphs.map((p, i) => {
              const isPlaceholder = p.startsWith("【配图");
              if (isPlaceholder) {
                return (
                  <div
                    key={i}
                    className="rounded-row border border-dashed border-subtle bg-raised px-3 py-6 text-center"
                  >
                    <div className="text-[13px] text-secondary">{p}</div>
                    <div className="mt-1 text-xs text-tertiary">请从素材库选择</div>
                  </div>
                );
              }
              return (
                <p key={i} className="text-[14px] leading-7 text-secondary">
                  {p}
                </p>
              );
            })}
          </article>
        </div>
      </div>

      <p className="mt-8 text-xs text-tertiary">
        生成走后端 /articles/&#123;id&#125;/generate（经同源 /api 代理）；智谱密钥仅存在于后端进程，前端不持有。
      </p>
    </AppShell>
  );
}
