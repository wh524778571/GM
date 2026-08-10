"use client";

import { useEffect, useState } from "react";
import { AppShell, Section } from "@/components/AppShell";
import { Button } from "@/components/Button";
import { ButtonSecondary } from "@/components/ButtonSecondary";
import { DataSourceNote } from "@/components/DataSourceNote";
import { apiGet, apiPut, ApiError } from "@/lib/clientApi";

// ── 静态元数据（与后端 platforms.yaml / settings_service 对齐）─────────────
const PLATFORMS: { key: string; label: string }[] = [
  { key: "toutiao", label: "今日头条" },
  { key: "baijia", label: "百家号" },
  { key: "bilibili", label: "B站" },
  { key: "xhs", label: "小红书" },
];

const MONETIZATION: { key: string; label: string }[] = [
  { key: "toutiao_original", label: "今日头条 · 原创标签" },
  { key: "baijia_income", label: "百家号 · 收益开通" },
  { key: "bilibili_creator", label: "B站 · 创作激励" },
  { key: "xhs_pgy", label: "小红书 · 蒲公英" },
];

const API_KEYS: { key: string; label: string }[] = [
  { key: "REDFOX_API_KEY", label: "cn-last30days 热点扫描" },
  { key: "GEMINI_API_KEY", label: "nano-banana-pro 配图" },
  { key: "ZHIPU_API_KEY", label: "AI 文章生成" },
];

interface ApiKeyStatus {
  key: string;
  label: string;
  configured: boolean;
}

interface SettingsData {
  accounts: Record<string, string>;
  platforms_enabled: Record<string, boolean>;
  monetization: Record<string, boolean>;
  preferences: { micro_post_min_interval_hours: number };
  api_keys: ApiKeyStatus[];
}

interface FormState {
  accounts: Record<string, string>;
  platforms_enabled: Record<string, boolean>;
  monetization: Record<string, boolean>;
  preferences: { micro_post_min_interval_hours: number };
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-pill transition-colors ${
        checked ? "bg-accent" : "border border-subtle bg-raised"
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-pill bg-white transition-all ${
          checked ? "left-[22px]" : "left-0.5"
        }`}
      />
    </button>
  );
}

function Row({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <div className="text-[14px] text-primary">{title}</div>
        {desc ? <div className="mt-0.5 text-xs text-tertiary">{desc}</div> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function SettingsScreen() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKeyStatus[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => {
    apiGet<SettingsData>("/settings")
      .then((data) => {
        setForm({
          accounts: { ...data.accounts },
          platforms_enabled: { ...data.platforms_enabled },
          monetization: { ...data.monetization },
          preferences: { ...data.preferences },
        });
        setApiKeys(data.api_keys);
        setLoading(false);
      })
      .catch((e) => {
        setError(e instanceof ApiError ? e.message : String(e));
        setLoading(false);
      });
  }, []);

  function patchForm(next: Partial<FormState>) {
    setForm((prev) => (prev ? { ...prev, ...next } : prev));
  }

  async function saveAll() {
    if (!form) return;
    setSaving(true);
    setMessage(null);
    try {
      await apiPut("/settings", form);
      setMessage("已保存 ✓");
    } catch (e) {
      setMessage(e instanceof ApiError ? `保存失败：${e.message}` : "保存失败");
    } finally {
      setSaving(false);
      setTimeout(() => setMessage(null), 2500);
    }
  }

  async function saveKey(key: string) {
    const value = (keyInputs[key] ?? "").trim();
    if (!value) return;
    setSavingKey(key);
    setMessage(null);
    try {
      const next = await apiPut<ApiKeyStatus[]>("/settings/api-keys", { key, value });
      setApiKeys(next);
      setKeyInputs((prev) => ({ ...prev, [key]: "" }));
      setMessage("密钥已写入 .env（不会显示在界面）");
    } catch (e) {
      setMessage(e instanceof ApiError ? `密钥写入失败：${e.message}` : "密钥写入失败");
    } finally {
      setSavingKey(null);
      setTimeout(() => setMessage(null), 2500);
    }
  }

  if (loading) {
    return (
      <AppShell title="设置" subtitle="加载中…">
        <div className="text-tertiary">正在读取配置…</div>
      </AppShell>
    );
  }

  if (!form) {
    return (
      <AppShell title="设置" subtitle="出错了">
        <div className="text-plat-toutiao">{error ?? "未知错误"}</div>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="设置"
      subtitle="账号、平台开关、变现状态与密钥（真实读写）"
      actionLabel={saving ? "保存中…" : "保存更改"}
      onAction={saveAll}
    >
      {message ? (
        <div className="mb-4 rounded-row border border-subtle bg-raised px-4 py-2 text-[13px] text-accent">
          {message}
        </div>
      ) : null}

      {/* 账号配置 */}
      <Section title="账号配置" hint="各平台发布用的账号名">
        <div className="rounded-card border border-subtle bg-card px-4 py-1">
          {PLATFORMS.map((p) => (
            <Row key={p.key} title={p.label}>
              <input
                value={form.accounts[p.key] ?? ""}
                onChange={(e) =>
                  patchForm({
                    accounts: { ...form.accounts, [p.key]: e.target.value },
                  })
                }
                placeholder={p.label}
                className="w-56 rounded-row border border-subtle bg-root px-3 py-1.5 text-[14px] text-primary outline-none focus:border-accent"
              />
            </Row>
          ))}
        </div>
      </Section>

      {/* 平台开关 */}
      <Section title="分发平台" hint="关闭后四平台分发跳过该平台">
        <div className="rounded-card border border-subtle bg-card px-4 py-1">
          {PLATFORMS.map((p) => (
            <Row key={p.key} title={p.label}>
              <Toggle
                checked={form.platforms_enabled[p.key] ?? false}
                onChange={(next) =>
                  patchForm({
                    platforms_enabled: {
                      ...form.platforms_enabled,
                      [p.key]: next,
                    },
                  })
                }
              />
            </Row>
          ))}
        </div>
      </Section>

      {/* 变现 / 功能状态 */}
      <Section title="变现与功能状态" hint="对应待办清单，方便一眼看清还差什么">
        <div className="rounded-card border border-subtle bg-card px-4 py-1">
          {MONETIZATION.map((m) => (
            <Row key={m.key} title={m.label}>
              <Toggle
                checked={form.monetization[m.key] ?? false}
                onChange={(next) =>
                  patchForm({
                    monetization: { ...form.monetization, [m.key]: next },
                  })
                }
              />
            </Row>
          ))}
        </div>
      </Section>

      {/* 发布偏好 */}
      <Section title="发布偏好">
        <div className="rounded-card border border-subtle bg-card px-4 py-3">
          <Row
            title="微头条最小发布间隔（小时）"
            desc="连续发会被算法降权，建议 ≥ 2 小时"
          >
            <input
              type="number"
              min={0}
              max={24}
              value={form.preferences.micro_post_min_interval_hours}
              onChange={(e) => {
                const n = Math.max(0, Math.min(24, Number(e.target.value) || 0));
                patchForm({
                  preferences: { ...form.preferences, micro_post_min_interval_hours: n },
                });
              }}
              className="w-20 rounded-row border border-subtle bg-root px-3 py-1.5 text-center text-[14px] text-primary outline-none focus:border-accent"
            />
          </Row>
        </div>
      </Section>

      {/* API 密钥 */}
      <Section title="AI 密钥" hint="仅写入 .env（已 gitignore），界面不回显">
        <div className="rounded-card border border-subtle bg-card px-4 py-3">
          {API_KEYS.map((k) => {
            const status = apiKeys.find((a) => a.key === k.key);
            const configured = status?.configured ?? false;
            return (
              <div key={k.key} className="py-2.5">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-[14px] text-primary">{k.label}</div>
                    <div className="mt-0.5 text-xs text-tertiary">
                      <code className="text-secondary">{k.key}</code>
                      {configured ? (
                        <span className="ml-2 text-accent">已配置 ✓</span>
                      ) : (
                        <span className="ml-2 text-tertiary">未配置</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex gap-2">
                  <input
                    type="password"
                    value={keyInputs[k.key] ?? ""}
                    onChange={(e) =>
                      setKeyInputs((prev) => ({ ...prev, [k.key]: e.target.value }))
                    }
                    placeholder="粘贴密钥后点保存（不显示在界面）"
                    className="flex-1 rounded-row border border-subtle bg-root px-3 py-1.5 text-[14px] text-primary outline-none focus:border-accent"
                  />
                  <ButtonSecondary
                    onClick={() => saveKey(k.key)}
                    disabled={savingKey === k.key || !(keyInputs[k.key] ?? "").trim()}
                  >
                    {savingKey === k.key ? "写入中…" : "保存密钥"}
                  </ButtonSecondary>
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      <div className="mt-4 flex justify-end">
        <Button onClick={saveAll} disabled={saving}>
          {saving ? "保存中…" : "保存更改"}
        </Button>
      </div>

      <DataSourceNote sources={["backend"]} />
    </AppShell>
  );
}
