import { NextResponse } from "next/server";
import { backendGet } from "@/lib/backend";

export const dynamic = "force-dynamic";

interface HealthResponse {
  status?: string;
  database_ok?: boolean;
  material_count?: number;
  system_prompt_fingerprint?: string;
  // 仅布尔位，永远不会有密钥值本身（ZHIPU_API_KEY 只存在于后端进程环境）
  zhipu_api_key_configured?: boolean;
}

export async function GET() {
  const health = await backendGet<HealthResponse>("/health", 1500);
  if (!health) {
    return NextResponse.json({ online: false, note: "后端未连接，界面使用基线数据" }, { status: 200 });
  }
  return NextResponse.json({
    online: health.status === "ok" || health.database_ok === true,
    databaseOk: health.database_ok ?? false,
    materialCount: health.material_count ?? 0,
    promptFingerprint: health.system_prompt_fingerprint ?? "",
    aiConfigured: health.zhipu_api_key_configured ?? false,
  });
}
