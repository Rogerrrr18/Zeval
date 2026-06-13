/**
 * 导出 companion-autofind-50sessions.csv（25 正 + 25 负）到 public/sample-data。
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillPath = pathToFileURL(path.join(root, "src/benchmark/agent/skills/autofind-data-skill.ts")).href;
const { runAutoFindDataSkill } = await import(skillPath);

const searched = await runAutoFindDataSkill({
  action: "search",
  requirementText: "情绪陪伴硬件玩具，成年女性用户，关注DAU与流失",
  state: {
    phase: "planned",
    requirementText: "情绪陪伴硬件玩具，成年女性用户，关注DAU与流失",
    positiveCount: 25,
    negativeCount: 25,
    includeEnglishNegative: true,
    sources: [],
    warnings: [],
  },
});

const saved = await runAutoFindDataSkill({
  action: "save",
  state: searched.state,
});

const outPath = path.join(root, "public", "sample-data", saved.state.fileName ?? "companion-autofind-50sessions.csv");
console.log(`exported=${outPath}`);
console.log(`sessions=${saved.state.summary?.sessions ?? 0}, rows=${saved.state.summary?.rows ?? 0}`);
