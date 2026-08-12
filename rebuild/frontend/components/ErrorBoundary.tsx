"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/Button";

interface Props {
  children: ReactNode;
  /** 自定义降级 UI；不传用默认卡片 */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /** 边界标签，用于控制台区分来源（如 "writer"/"assets"） */
  label?: string;
}

interface State {
  error: Error | null;
}

/**
 * 通用 React 错误边界。把「会崩溃的局部」包起来：
 * 即使子组件渲染抛错，也只显示降级卡片，不影响整页/导航。
 *
 * 用法：
 *   <ErrorBoundary label="writer"><ArticleEditorScreen /></ErrorBoundary>
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 当前仅控制台留痕；生产环境可在此接 Sentry/上报
    console.error(
      `[ErrorBoundary${this.props.label ? `·${this.props.label}` : ""}]`,
      error,
      info,
    );
  }

  private reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);
    return <DefaultFallback error={error} reset={this.reset} label={this.props.label} />;
  }
}

function DefaultFallback({
  error,
  reset,
  label,
}: {
  error: Error;
  reset: () => void;
  label?: string;
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <div className="max-w-md rounded-card border border-subtle bg-card p-6">
        <h2 className="text-lg font-semibold text-primary">
          {label ? `「${label}」模块` : "这个模块"}出了点问题
        </h2>
        <p className="mt-2 text-[13px] leading-5 text-secondary">
          渲染时崩了一下，但你的数据没丢。可以重试回到这里；如果反复出错，换个页面操作不受影响。
        </p>
        {error.message ? (
          <pre className="mt-3 max-h-40 overflow-auto rounded-row bg-raised p-3 text-left text-xs text-tertiary">
            {error.message}
          </pre>
        ) : null}
        <div className="mt-4 flex justify-center">
          <Button onClick={reset}>重试</Button>
        </div>
      </div>
    </div>
  );
}
