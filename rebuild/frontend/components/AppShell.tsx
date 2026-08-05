import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

/** 7 屏统一外壳：左侧栏（7 nav）+ 顶栏；主内容列固定 976px 居中。 */
export interface AppShellProps {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  children: ReactNode;
}

export function AppShell({ title, subtitle, actionLabel, children }: AppShellProps) {
  return (
    <div className="flex min-h-screen w-full overflow-x-hidden bg-root">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar title={title} subtitle={subtitle} actionLabel={actionLabel} />
        <main className="flex-1 px-6 py-6">
          <div className="mx-auto w-full max-w-content">{children}</div>
        </main>
      </div>
    </div>
  );
}

/** 区块标题（section 18/SemiBold）+ 可选右侧操作。 */
export function Section({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mt-6 first:mt-0">
      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-[18px] font-semibold text-primary">{title}</h2>
        {hint ? <span className="text-xs text-tertiary">{hint}</span> : null}
        {action ? <div className="ml-auto">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}
