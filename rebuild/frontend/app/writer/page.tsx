import { Suspense } from "react";
import { ArticleEditorScreen } from "@/components/screens/ArticleEditorScreen";

export const dynamic = "force-dynamic";

export default function WriterPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-tertiary">加载中…</div>}>
      <ArticleEditorScreen />
    </Suspense>
  );
}
