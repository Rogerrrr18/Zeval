import { NextResponse } from "next/server";
import { buildRemediationPackage, createRemediationPackageStore } from "@/remediation";
import { remediationPackageCreateBodySchema } from "@/schemas/remediation";

/**
 * List saved remediation packages.
 */
export async function GET() {
  try {
    const store = createRemediationPackageStore();
    const packages = await store.list();
    return NextResponse.json({ packages, count: packages.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "读取调优包列表失败。", detail: message }, { status: 500 });
  }
}

/**
 * Create one remediation package from the current evaluation result.
 *
 * @param request Incoming HTTP request.
 */
export async function POST(request: Request) {
  try {
    const parsedBody = remediationPackageCreateBodySchema.safeParse(await request.json());
    if (!parsedBody.success) {
      return NextResponse.json({ error: "请求体不合法。", details: parsedBody.error.flatten() }, { status: 400 });
    }

    const body = parsedBody.data;
    const assets = body.evaluate.badCaseAssets;
    if (body.selectedCaseKeys.length > 0) {
      const matched = assets.filter((asset) => body.selectedCaseKeys.includes(asset.caseKey));
      if (matched.length === 0) {
        return NextResponse.json(
          {
            error: "selectedCaseKeys 未匹配到任何 bad case。",
            detail: `可用 caseKeys: ${assets.map((asset) => asset.caseKey).join(", ") || "(空)"}`,
          },
          { status: 400 },
        );
      }
    }

    const result = buildRemediationPackage(body);
    if (result.skipped) {
      return NextResponse.json(result);
    }

    const snapshot = result.package;
    const store = createRemediationPackageStore();
    await store.save(snapshot);

    return NextResponse.json({ package: snapshot, skipped: false, skillFolder: snapshot.skillFolder });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "生成调优包失败。", detail: message }, { status: 500 });
  }
}
