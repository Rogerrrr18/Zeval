import { NextResponse } from "next/server";
import { getMergedSettings, saveLocalSettings } from "@/lib/settings";

/**
 * 读取当前生效的 SiliconFlow 配置（不含完整密钥）。
 */
export async function GET() {
  const s = getMergedSettings();
  return NextResponse.json({
    baseUrl: s.baseUrl,
    model: s.model,
    enableThinking: s.enableThinking,
    hasApiKey: Boolean(s.apiKey),
    apiKeySuffix: s.apiKey ? s.apiKey.slice(-4) : "",
  });
}

/**
 * 保存 SiliconFlow 密钥等到 local.settings.json。
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Record<string, string | undefined>;
    const allowed = [
      "ZEVAL_JUDGE_API_KEY",
      "ZEVAL_INTENT_EXPERIMENT_API_KEY",
      "ZEVAL_JUDGE_BASE_URL",
      "ZEVAL_JUDGE_MODEL",
      "ZEVAL_JUDGE_ENABLE_THINKING",
    ];
    const patch: Record<string, string> = {};
    for (const k of allowed) {
      if (body[k] !== undefined && body[k] !== "") {
        patch[k] = String(body[k]);
      }
    }
    saveLocalSettings(patch);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
